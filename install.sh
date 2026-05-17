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
#     [--db=bentoclick]                 \   # dashboard database name
#     [--cluster='{cluster}']           \   # CH cluster name (default: the {cluster} macro)
#     [--migrate-from=<old-db>]         \   # copy rows from old DB after schema apply
#     [--brand-name=bentoclick]         \   # browser-tab title
#     [--email-domain=example.com]      \   # used to expand owner localparts
#     [--accent=#00d4aa]                    # primary accent color

set -euo pipefail

# ---- defaults ----
DB="bentoclick"
# Cluster name for ON CLUSTER + clusterAllReplicas-based asset
# distribution. Default to the literal {cluster} macro which CH
# expands at parse time on any cluster that defines the macro
# (antalya does; the test image's clickhouse-config.xml does).
CLUSTER="{cluster}"
MIGRATE_FROM=""
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
    --cluster=*)      CLUSTER="${arg#*=}" ;;
    --migrate-from=*) MIGRATE_FROM="${arg#*=}" ;;
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
# Password is written to a per-run .netrc tempfile rather than passed
# via --user, which would appear in `ps` for the duration of each curl.
HOST_FOR_NETRC="$(printf '%s' "$CH_HOST" | sed -e 's|^https*://||' -e 's|[:/].*$||')"
NETRC_FILE="$(mktemp)"
chmod 600 "$NETRC_FILE"
printf 'machine %s\n  login %s\n  password %s\n' \
  "$HOST_FOR_NETRC" "$CH_USER" "$CH_PASSWORD" > "$NETRC_FILE"
trap 'rm -f "$NETRC_FILE"' EXIT

ch_curl() {
  curl -fsS --netrc-file "$NETRC_FILE" "$@"
}

ch_query() {
  # stdin = SQL; runs as the admin user.
  # Antalya CH 26.1 doesn't accept the `multi_statements` setting,
  # and the HTTP path requires one statement per request anyway.
  # Callers that need multi-statement files must split first.
  ch_curl --data-binary @- "${CH_HOST}/"
}

# Apply a SQL file by splitting it on bare `;` lines and sending each
# statement separately. Sufficient for our schema files; not a full
# SQL parser.
ch_apply_file() {
  local file="$1"
  python3 - <<PY
import re, sys, urllib.request, base64, ssl, os

raw = open("${file}").read()
# Substitute templates.
raw = raw.replace("\${DB}", "${DB}").replace("\${SPA_ORIGIN}", "${SPA_ORIGIN}")

# Strip comment-only lines, then split on lines that END with ';'.
stmts, buf = [], []
for line in raw.splitlines():
    s = line.strip()
    if not s or s.startswith("--"):
        continue
    buf.append(line)
    if s.endswith(";"):
        stmt = "\n".join(buf).rstrip().rstrip(";").strip()
        if stmt:
            stmts.append(stmt)
        buf = []
if buf:
    tail = "\n".join(buf).strip().rstrip(";").strip()
    if tail:
        stmts.append(tail)

with open("${NETRC_FILE}") as f:
    netrc = f.read()
import re as _re
m = _re.search(r"login\s+(\S+).*?password\s+(\S+)", netrc, _re.S)
user, pw = m.group(1), m.group(2)

auth = "Basic " + base64.b64encode(f"{user}:{pw}".encode()).decode()
for i, stmt in enumerate(stmts):
    req = urllib.request.Request("${CH_HOST}/", data=stmt.encode(),
                                  headers={"Authorization": auth})
    try:
        urllib.request.urlopen(req).read()
    except urllib.error.HTTPError as e:
        sys.stderr.write(f"\n[ch_apply_file {os.path.basename('${file}')}] stmt {i+1} failed:\n{stmt[:200]}\n--\n{e.read().decode(errors='replace')[:500]}\n")
        raise SystemExit(1)
PY
}

ch_file_upload() {
  # $1 = relative path inside user_files (e.g. dash/spa.js)
  # $2 = local file
  #
  # Cluster-distribution model: one File-engine table per asset,
  # created ON CLUSTER so every replica has its own table pointing
  # at the SAME absolute path on its OWN local user_files/ disk.
  # `INSERT INTO FUNCTION clusterAllReplicas(...)` then fans the
  # bytes out to every replica's local file().
  #
  # Why not `INSERT INTO FUNCTION clusterAllReplicas('{cluster}', file(...))`?
  # CH rejects table functions inside clusterAllReplicas — it expects
  # a db.table reference (Code: 60. UNKNOWN_TABLE: Both table name
  # and UUID are empty). Same goes for cluster() and remote(). The
  # File-engine table is the indirection that makes the fan-out work.
  #
  # Each replica is a separate write; there is no quorum or atomic
  # rotation. During the brief inconsistency window an unlucky reader
  # behind a non-sticky LB might fetch stale bytes from one replica
  # while another has the new bytes. Acceptable for SPA assets — the
  # browser cache headers (no-store on spa.js, no-cache on dash.js
  # via spa.js fetchRuntime) re-fetch on next page load.
  local path="$1" local_file="$2"
  # Asset path → CH-safe table name: 'dash/spa.js' → '_asset_dash_spa_js'.
  local table_name
  table_name="_asset_$(printf '%s' "$path" | tr -c 'A-Za-z0-9_' '_')"
  local b64
  b64="$(base64 < "$local_file" | tr -d '\n')"
  # 1. Idempotent CREATE on every replica. File engine accepts an
  #    absolute path under user_files (CH 26+ resolves it relative
  #    to user_files_path when it's a subdir).
  printf "CREATE TABLE IF NOT EXISTS %s.%s ON CLUSTER '%s' (content String) ENGINE = File('RawBLOB', '/var/lib/clickhouse/user_files/%s')" \
    "$DB" "$table_name" "$CLUSTER" "$path" \
    | ch_query > /dev/null
  # 2. clusterAllReplicas INSERT — bytes fanned out to every replica's
  #    local File-engine table, truncate-on-insert so re-deploys
  #    overwrite cleanly.
  printf "INSERT INTO FUNCTION clusterAllReplicas('%s', '%s', '%s') SETTINGS engine_file_truncate_on_insert = 1 SELECT base64Decode('%s')" \
    "$CLUSTER" "$DB" "$table_name" "$b64" \
    | ch_query > /dev/null
}

echo "==> bentoclick install"
echo "    CH:    $CH_HOST"
echo "    DB:    $DB"
echo "    MCP:   $MCP_URL"
echo "    SPA:   $SPA_ORIGIN"

# ---- 1. Apply schema ----
echo "==> applying schema/*.sql"
for sql in schema/00-definer.sql schema/01-database.sql schema/02-roles.sql; do
  ch_apply_file "$sql"
done

# ---- 1b. Optional: copy data from a previous DB ----
# Use case: renaming the dashboard database (e.g. `dashboards` →
# `bentoclick`) without losing user content. The MV doesn't fire on
# this direct INSERT into the destination — that's correct, the
# source rows were already sanitized at original write time.
if [[ -n "${MIGRATE_FROM}" ]]; then
  echo "==> migrating data from ${MIGRATE_FROM} → ${DB}"
  printf "INSERT INTO %s.dashboards SELECT * FROM %s.dashboards FINAL" \
    "$DB" "$MIGRATE_FROM" | ch_query
fi

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
  # SELECT-form INSERT (CH 26.3 currentUser()-in-VALUES quirk avoidance).
  # SQL string literals interpret `\n`, `\t`, etc.; we must double every
  # backslash before splicing JSON so the JSON parser sees the original
  # `\n` escape sequence (two chars), not a real newline. Single quotes
  # are doubled by SQL convention. Order matters: backslash first, then
  # single quote, so the second pass doesn't escape the doubling.
  esc() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\'/\'\'}"
    printf '%s' "$s"
  }
  # dashboards_raw stores params and panels as plain String now (the MV
  # JSONExtract's on the way to `dashboards`). Just splice the JSON text
  # in — no JSONExtract wrap needed at this layer.
  printf "INSERT INTO ${DB}.dashboards_raw (slug, title, subtitle, spec_version, params, panels) SELECT '%s', '%s', '%s', %s, '%s', '%s'" \
    "$(esc "$slug")" \
    "$(esc "$title")" \
    "$(esc "$subtitle")" \
    "$spec_version" \
    "$(esc "$params_json")" \
    "$(esc "$panels_json")" \
    | ch_query
  echo "    + $slug"
done

echo "==> done. Open ${SPA_ORIGIN}/app to see your dashboards."
