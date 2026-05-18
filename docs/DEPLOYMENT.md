# Deployment

Agent-readable runbook for installing and updating a bentoclick
cluster. The installer is intentionally generic — ACM-specific glue
(cluster lifecycle, OIDC client provisioning, secret rotation) is the
caller's responsibility.

## What `install.sh` actually does

Steps, in order, all run against the `--ch-host` HTTPS endpoint as
the `--ch-user` admin:

1. **Apply schema** — `schema/00-definer.sql`,
   `schema/01-database.sql`, `schema/02-roles.sql` via the
   per-statement applier. Every DDL is `IF NOT EXISTS` /
   `CREATE OR REPLACE`, so re-runs are no-ops.
2. **Optional `--migrate-from=<old-db>`** — copies rows from
   `<old-db>.dashboards` into `${DB}.dashboards`. **Only pass once.**
   Re-passing duplicates rows; `ReplacingMergeTree` de-dupes them
   eventually but it's cosmetically odd in `system.parts` until then.
3. **Push `runtime/v1/*`** to `user_files/dash/<file>` on every
   replica via `INSERT INTO FUNCTION clusterAllReplicas(...)`. Each
   asset has a per-cluster `_asset_<safe-name>` File-engine table
   created `ON CLUSTER … IF NOT EXISTS`; the INSERT uses
   `engine_file_truncate_on_insert = 1` so re-deploys overwrite.
4. **Push `handlers/*`** to `user_files/dash/<file>`. Each XML is
   piped through `sed` to substitute `${MCP_ORIGIN}` with the
   scheme+authority of `--mcp-url` (e.g. `https://mcp.example.com`)
   before upload. See [Templating](#templating) below.
5. **Render `config/*.json.tmpl`** with the install-time args
   (`${CH_URL}`, `${MCP_URL}`, `${SPA_ORIGIN}`, `${DB}`,
   `${BRAND_NAME}`, `${ACCENT}`) and upload as
   `dash/config.json` and `dash/client.json`.
6. **Insert sample dashboards** from `samples/*.spec.json` into
   `${DB}.dashboards_raw`. The SECURITY DEFINER materialized view
   sets `owner = currentUser()`, which means the **installer admin**
   becomes the owner — users won't see these samples in `/app`
   unless they log in as the admin. Re-running refreshes
   `updated_at`; it doesn't touch user-saved dashboards because
   they have a different `(owner, slug)` key.

## Templating

Three placeholders are substituted by `install.sh` at deploy time:

| Placeholder | Source | Used in |
|---|---|---|
| `${MCP_ORIGIN}` | scheme+authority of `--mcp-url` | `handlers/bentoclick.xml` CSP `connect-src` |
| `${MCP_URL}`, `${CH_URL}`, `${SPA_ORIGIN}`, `${DB}`, `${BRAND_NAME}`, `${ACCENT}` | install-time args | `config/config.json.tmpl` |
| `${SPA_ORIGIN}`, `${BRAND_NAME}` | install-time args | `config/client.json.tmpl` |

**If you see a literal `${MCP_ORIGIN}` in the deployed handler XML,
the substitution was skipped — re-run install.sh.** Browsers parse
the literal as a malformed CSP source and silently drop it, leaving
`connect-src 'self'`. That only works when MCP and SPA share an
origin; if they're on different origins, the SPA's RFC 9728
discovery fetch is blocked and OAuth login breaks with no visible
error in the UI (look for a CSP violation in DevTools).

## First-time install

```bash
./install.sh \
  --ch-host=https://<host>:<port>        \
  --ch-user=<admin>                      \
  --ch-password=<pw>                     \
  --mcp-url=https://<mcp-host>           \
  --spa-origin=https://<spa-host>        \
  [--db=bentoclick]                      \
  [--cluster='{cluster}']                \
  [--brand-name=bentoclick]              \
  [--accent='#00d4aa']
```

Verification (from any host that can hit the cluster's HTTPS
endpoint):

```bash
SPA=https://<spa-host>
curl -fsSI "$SPA/app"               | head -1   # expect 200
curl -fsS  "$SPA/lib/v1/dash.js"    | head -3   # expect JS, "// bentoclick runtime v1"
curl -fsS  "$SPA/lib/v1/tweaks.js"  | head -3   # expect JS, tweaks panel module
curl -fsS  "$SPA/config.json" | jq '.mcp_url, .ch_url'  # expect the install-time values
curl -fsS  "$SPA/app" -D - -o /dev/null | grep -i content-security-policy
# Confirm the CSP contains the literal MCP origin (e.g. https://mcp.example.com),
# NOT the placeholder ${MCP_ORIGIN}.
```

## Re-deploy (update existing cluster)

A re-run upgrades runtime assets, handler XML, and config templates
in place. **It is safe to re-run with the same args** — every step
except `--migrate-from` is idempotent.

```bash
./install.sh \
  --ch-host=https://<host>:<port>  \
  --ch-user=<admin>                \
  --ch-password=<pw>               \
  --mcp-url=https://<mcp-host>     \
  --spa-origin=https://<spa-host>  \
  --db=<same-db-as-before>
# DO NOT pass --migrate-from on a re-run.
```

### What changes on a re-run

- Runtime + handler assets get the new bytes (truncate-on-insert per
  replica).
- `config.json` / `client.json` re-rendered with current args.
- Samples re-inserted under the installer admin's identity — new
  `updated_at`, same content.

### What does *not* change

- User-saved dashboards (different `(owner, slug)` from samples).
- OAuth state in browsers (lives in `localStorage`).
- Already-issued bearers (still valid until the AS-set TTL).
- Schema objects (`CREATE IF NOT EXISTS`).

### Asset rotation window

`INSERT INTO FUNCTION clusterAllReplicas` fans bytes to each replica
sequentially, **not atomically across replicas**. For ~1-2s during
the push, a browser behind a non-sticky LB can fetch replica A's
new `dash.js` and replica B's old `dash-theme.css`. The
`Cache-Control: no-store` (spa.js, spa-helpers.js, tweaks.js,
config.json) and `no-cache` (dash.js, charts.js, dash-theme.css)
headers mean the next refresh resolves it. Prefer a low-traffic
window if avoidable; not a hard requirement.

## Verifying a deploy made the change you expect

After re-deploy, check that the assets actually rotated:

```bash
SPA=https://<spa-host>
# Pull the live runtime and diff its first line against the repo.
curl -fsS "$SPA/lib/v1/dash.js" | head -1
head -1 runtime/v1/dash.js
# Identical → asset rotated. Mismatch → check replica fan-out,
# clear browser cache, re-fetch with `?_=$(date +%s)` cache-bust.

# Check CSP for substituted MCP origin
curl -fsSI "$SPA/app" | grep -i content-security-policy | grep -E 'connect-src[^;]+'
# Should contain the actual MCP host, not the literal `${MCP_ORIGIN}`.
```

## Rollback

There is no built-in rollback. Options:

1. **`git checkout <prev-tag> && ./install.sh ...`** — re-runs the
   installer with the previous tag's runtime + handlers. User
   dashboards are untouched.
2. **`./uninstall.sh ...`** — drops the entire `${DB}` schema +
   user-files assets. Destroys all user-saved dashboards. **Only
   use for a clean-slate redeploy.**

## Troubleshooting

| Symptom | Likely cause | Check |
|---|---|---|
| `/app` loads, dashboards show "renderSpec error" | Stale `dash.js` cached by browser | Hard reload. If persists, check `curl $SPA/lib/v1/dash.js` matches `runtime/v1/dash.js` |
| OAuth login redirects then fails silently | CSP blocking MCP discovery | `curl -I $SPA/app` and look for literal `${MCP_ORIGIN}` in CSP. Re-run install.sh |
| `/v/<owner>/<slug>` 404 | Handler XML overwritten by another `config.d` fragment | Confirm `<rule name="…">` is present on every rule (`grep '<rule' handlers/bentoclick.xml`). See [upstream issue 70636](https://github.com/ClickHouse/ClickHouse/issues/70636) |
| User sees old dashboards listed in `/app` | `/app` index queries `dashboards FINAL WHERE owner = currentUser()` — they're saved as a different OAuth identity | Check `currentUser()` in CH for that bearer matches the row's `owner` |
| Sample dashboards missing | Samples are owned by the installer admin, not the viewer | Log in as admin to see them, or copy spec into user's account via the `save_dashboard` MCP tool |
