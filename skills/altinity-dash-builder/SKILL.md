---
name: altinity-dash-builder
description: >
  Build dashboards backed by a ClickHouse cluster running bentoclick
  (the SPA at /v/<owner>/<slug>) and save them so they can be shared
  by URL. Trigger when the user asks to build, visualize, or save a
  dashboard / chart / report. v1 stores dashboards as typed columns
  (title, subtitle, params, panels, meta) — all writes go through the
  sanitizing materialized view `dashboards_mv`. Pair with a
  schema-aware companion that knows the SQL.
---

# altinity-dash-builder

Dashboards live as rows in `dashboards.dashboards`, served at
`https://<spa-origin>/v/<owner>/<slug>` behind OAuth. The viewer's
bearer authenticates ClickHouse queries; the dashboard's SQL runs as
the viewer.

## One mode, seven panel types

In v1 there is **one dashboard mode**: spec. Writers populate typed
columns; the SPA reads them and renders panels.

| Panel `type` | Use for | Reference |
|---|---|---|
| `kpi-strip` | One-row query → tile per measurable | `references/spec-mode.md` § kpi-strip |
| `table`     | Sticky-header table, formatters, badges | § table |
| `bars`      | Horizontal share bars | § bars |
| `markdown`  | Narrative text, no query | § markdown |
| `hero`      | Templated sentence anchored to another panel's first row | § hero |
| `html`      | Static markup + optional `query` + `template` binding | § html |
| `script`    | **Last resort** — row-click drill-down, custom JS panels. Sandboxed; owner-authored JS is executable by any viewer (v1 trust model). | `references/script-panels.md` |

`script` panels are powerful and risky. Read `references/script-panels.md`
*before* using one — there's a two-of-three decision gate at the top.

## Write path

The agent never INSERTs into `dashboards.dashboards` directly. Two paths:

1. **Reflected MCP write tool** (preferred): the altinity-mcp server
   reflects `dashboards.dashboards_raw` into a `save_*_dashboard` tool
   with typed parameters (`title`, `subtitle`, `concurrent`,
   `spec_version`, `params`, `panels`, `meta`, `tags`). Call it
   directly with the spec values as separate args.
2. **Direct SQL** (fallback when the tool isn't available):

   ```sql
   INSERT INTO dashboards.dashboards_raw
     (slug, title, subtitle, spec_version, params, panels)
   SELECT 'my-slug', 'Title', '', 1,
          JSONExtract('[...]', 'Array(JSON)'),
          JSONExtract('[...]', 'Array(JSON)');
   ```

   Always **SELECT-form**, never `VALUES (...)` — CH 26.3 has a
   `currentUser()` quirk in the VALUES path that leaves `owner = ''`.

The `dashboards_mv` materialized view sanitizes `panels` (strips
`<script>`, `<iframe>`, event handlers, `javascript:` URLs from
`html` panels) and computes `owner = currentUser()`, `updated_at =
now()`. Direct INSERT into `dashboards` is forbidden — the writer
role only has INSERT grants on `dashboards_raw`.

Full save-flow details: `references/save-flow.md`.

## Share URL

**Get the full URL from `dashboards.whoami`. Never guess the host.**

```sql
SELECT spa_origin, localpart, my_dashboards_prefix FROM dashboards.whoami
```

Returns `email`, `localpart`, `spa_origin`, `my_dashboards_prefix`.
The share URL is:

```
<my_dashboards_prefix><slug>
```

equivalent to `<spa_origin>/v/<localpart>/<slug>`.

**Do not** use the MCP host (e.g. `https://...-mcp...`) — it's a
different origin from the SPA. The `whoami` view exists specifically
so you don't have to know which host is which.

Cache `whoami` once per conversation; you don't need to call it again.

## spec_version

All dashboards pin a `spec_version` (UInt8, default 1). The SPA
loads `/lib/v<spec_version>/dash.js` to render — adding a future v2
runtime never breaks v1 dashboards. Always set it explicitly:
`spec_version: 1` (the current contract).

## Hard do-nots

- Don't paste user input into SQL unvalidated. Use the spec's
  `params` (strict regex/type-checked at substitution).
- Don't INSERT directly into `dashboards.dashboards` — the writer
  role doesn't have that grant. Always target `dashboards_raw`.
- Don't use `INSERT ... VALUES (...)` — use `SELECT`-form. (CH 26.3
  currentUser() bug.)
- Don't embed bearer tokens or `Authorization` headers in saved
  panels — `DASH.spec.fetch` handles auth from the parent.
- Don't reach for `localStorage`, cookies, or `parent.*` from inside
  a `script` panel — sandbox blocks it.
- Don't reach for `script` when a spec-only panel could do it. Read
  the decision gate in `references/script-panels.md` first.
- For spec mode, leave the default sequential panel fetching unless
  every query is cheap and parallelism is worth it —
  `concurrent: true` in the spec opts in.
