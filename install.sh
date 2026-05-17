#!/usr/bin/env bash
# bentoclick installer.
#
# Applies the v1 schema to a ClickHouse instance, pushes the SPA runtime
# (runtime/v1/) and HTTP handlers (handlers/) to user_files via
# INSERT INTO FUNCTION file(), substitutes config templates with
# install-time values, and inserts the four sample dashboards through
# the sanitizing MV.
#
# This script is intentionally generic. ACM-specific deployment glue
# (cluster lifecycle, Auth0 OIDC client, secret rotation) is the
# caller's job — wrap this script with whatever your environment
# needs.
#
# Usage:
#   ./install.sh \
#     --ch-host=https://<host>:<port>   \   # ClickHouse HTTPS root
#     --ch-user=<admin>                 \   # admin user with CREATE/INSERT
#     --ch-password=<pw>                \   # admin password (or empty)
#     --mcp-url=https://<host>/mcp      \   # MCP origin for OAuth bootstrap
#     --spa-origin=https://<host>       \   # SPA's public origin
#     [--db=dashboards]                 \   # dashboard database name
#     [--brand-name=bentoclick]         \   # browser-tab title
#     [--email-domain=example.com]      \   # used to expand owner localparts
#     [--accent=#00d4aa]                    # primary accent color

set -euo pipefail

# ---- defaults ----
DB="dashboards"
BRAND_NAME="bentoclick"
EMAIL_DOMAIN=""
ACCENT="#00d4aa"

# ---- arg parse ----
for arg in "$@"; do
  case "$arg" in
    --ch-host=*)      CH_HOST="${arg#*=}" ;;
    --ch-user=*)      CH_USER="${arg#*=}" ;;
    --ch-password=*)  CH_PASSWORD="${arg#*=}" ;;
    --mcp-url=*)      MCP_URL="${arg#*=}" ;;
    --spa-origin=*)   SPA_ORIGIN="${arg#*=}" ;;
    --db=*)           DB="${arg#*=}" ;;
    --brand-name=*)   BRAND_NAME="${arg#*=}" ;;
    --email-domain=*) EMAIL_DOMAIN="${arg#*=}" ;;
    --accent=*)       ACCENT="${arg#*=}" ;;
    *) echo "ERROR: unknown arg: $arg" >&2; exit 2 ;;
  esac
done

: "${CH_HOST:?--ch-host required}"
: "${CH_USER:?--ch-user required}"
: "${MCP_URL:?--mcp-url required}"
: "${SPA_ORIGIN:?--spa-origin required}"
CH_PASSWORD="${CH_PASSWORD:-}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

# ---- ClickHouse helpers ----
ch_curl() {
  curl -fsS \
    --user "${CH_USER}:${CH_PASSWORD}" \
    "$@"
}

ch_query() {
  # stdin = SQL; runs as the admin user.
  ch_curl --data-binary @- "${CH_HOST}/?multi_statements=1&database=${DB}"
}

ch_file_upload() {
  # $1 = relative path inside user_files (e.g. dash/spa.js)
  # $2 = local file
  # Encodes the file as base64 and INSERTs into a file() function with
  # base64Decode() — the canonical way to push binary blobs into CH.
  local path="$1" local_file="$2"
  local b64
  b64="$(base64 < "$local_file" | tr -d '\n')"
  printf "INSERT INTO FUNCTION file(%s, 'RawBLOB', 'String') SELECT base64Decode(%s)" \
    "$(printf "'%s'" "$path")" \
    "$(printf "'%s'" "$b64")" \
    | ch_query
}

echo "==> bentoclick install"
echo "    CH:    $CH_HOST"
echo "    DB:    $DB"
echo "    MCP:   $MCP_URL"
echo "    SPA:   $SPA_ORIGIN"

# ---- 1. Apply schema ----
echo "==> applying schema/*.sql"
for sql in schema/01-database.sql schema/02-roles.sql; do
  sed -e "s|\${DB}|${DB}|g" -e "s|\${SPA_ORIGIN}|${SPA_ORIGIN}|g" "$sql" | ch_query
done

# ---- 2. Push runtime assets ----
echo "==> pushing runtime/v1/* to user_files"
for f in runtime/v1/*; do
  base="$(basename "$f")"
  ch_file_upload "dash/${base}" "$f"
done

# ---- 3. Push HTTP handlers ----
echo "==> pushing handlers/* to user_files"
for f in handlers/*; do
  base="$(basename "$f")"
  ch_file_upload "dash/${base}" "$f"
done

# ---- 4. Render config.json + client.json ----
echo "==> rendering and pushing config templates"
tmp_config="$(mktemp)"
sed -e "s|\${CH_URL}|${CH_HOST}|g" \
    -e "s|\${MCP_URL}|${MCP_URL}|g" \
    -e "s|\${SPA_ORIGIN}|${SPA_ORIGIN}|g" \
    -e "s|\${DB}|${DB}|g" \
    -e "s|\${BRAND_NAME}|${BRAND_NAME}|g" \
    -e "s|\${EMAIL_DOMAIN}|${EMAIL_DOMAIN}|g" \
    -e "s|\${ACCENT}|${ACCENT}|g" \
    config/config.json.tmpl > "$tmp_config"
ch_file_upload "dash/config.json" "$tmp_config"

tmp_client="$(mktemp)"
sed -e "s|\${SPA_ORIGIN}|${SPA_ORIGIN}|g" \
    -e "s|\${BRAND_NAME}|${BRAND_NAME}|g" \
    config/client.json.tmpl > "$tmp_client"
ch_file_upload "dash/client.json" "$tmp_client"

rm -f "$tmp_config" "$tmp_client"

# ---- 5. Insert sample dashboards ----
# Through dashboards_raw so the MV runs sanitization. Each sample lives
# as a JSON file in samples/ and is inserted as a single row with
# title=slug-title, panels=loaded JSON, params=loaded JSON.
echo "==> inserting sample dashboards"
for spec in samples/*.spec.json; do
  slug="$(basename "$spec" .spec.json)"
  title="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('title', sys.argv[2]))" "$spec" "$slug")"
  subtitle="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('subtitle', ''))" "$spec")"
  params_json="$(python3 -c "import json,sys; print(json.dumps(json.load(open(sys.argv[1])).get('params', [])))" "$spec")"
  panels_json="$(python3 -c "import json,sys; print(json.dumps(json.load(open(sys.argv[1])).get('panels', [])))" "$spec")"
  spec_version="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('spec_version', 1))" "$spec")"
  # SELECT-form INSERT — CH 26.3 currentUser()-in-VALUES quirk avoidance.
  # Quote dollar signs in params/panels JSON before splicing into SQL.
  printf "INSERT INTO ${DB}.dashboards_raw (slug, title, subtitle, spec_version, params, panels) SELECT '%s', '%s', '%s', %s, JSONExtract('%s', 'Array(JSON)'), JSONExtract('%s', 'Array(JSON)')" \
    "$slug" \
    "${title//\'/\'\'}" \
    "${subtitle//\'/\'\'}" \
    "$spec_version" \
    "${params_json//\'/\'\'}" \
    "${panels_json//\'/\'\'}" \
    | ch_query
  echo "    + $slug"
done

echo "==> done. Open ${SPA_ORIGIN}/app to see your dashboards."
