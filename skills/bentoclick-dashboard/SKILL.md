---
name: bentoclick-dashboard
description: >
  Build dashboards backed by a ClickHouse cluster and save them so they
  can be shared by URL. Trigger when the user asks to build, visualize,
  or save a dashboard / chart / report.
---

# bentoclick-dashboard

Dashboards are rows in `dashboards.dashboards`, served at
`https://<spa-origin>/v/<owner>/<slug>` behind OAuth. The viewer's
bearer authenticates ClickHouse queries; the dashboard's SQL runs as
the viewer.

There is one dashboard shape: a **spec** — a small set of typed
columns (`title`, `subtitle`, `params`, `panels`, …) that the SPA
renders to HTML at view time. No raw-HTML dashboards. No "dynamic
mode" — every spec is dynamic (panels refetch on param change).

## Panel types

| `type` | Use for |
|---|---|
| `kpi-strip` | One-row query → tile per measurable |
| `table`     | Sticky-header table, formatters, threshold badges |
| `bars`      | Horizontal share bars |
| `markdown`  | Narrative text, no query |
| `hero`      | Templated sentence anchored to another panel's first row |
| `html`      | Static markup (sanitized server-side); optional templated `query` |
| `script`    | JS escape hatch (drill-down, third-party libs). Last resort. |

Catalog with examples: [`references/spec-mode.md`](references/spec-mode.md).
`script` has its own page with a two-of-three decision gate: [`references/script-panels.md`](references/script-panels.md). Read it before reaching for `script`.

## Save

The writer role only has INSERT on `dashboards_raw` (Null engine). A
materialized view sanitizes panels (`<script>`, `<iframe>`, event
handlers, `javascript:` URLs are stripped) and writes to `dashboards`
with `owner = currentUser()` and `updated_at = now()`.

```sql
INSERT INTO dashboards.dashboards_raw
  (slug, title, subtitle, spec_version, params, panels)
SELECT 'my-slug', 'Title', '', 1,
       JSONExtract('[...params...]', 'Array(JSON)'),
       JSONExtract('[...panels...]', 'Array(JSON)');
```

**Always SELECT-form, never `VALUES (...)`** — CH 26.x has a
`currentUser()` quirk in the VALUES path that drops the owner.
**Always `JSONExtract(..., 'Array(JSON)')`** — `CAST(... AS Array(JSON))`
doesn't parse JSON-array strings.

The MCP reflects `dashboards_raw` into a `save_*_dashboard` tool, but
today it only exposes scalar columns (`slug`, `title`, `subtitle`,
`concurrent`, `spec_version`). For full content (`params`, `panels`,
`meta`, `tags`) use direct SQL.

Full details: [`references/save-flow.md`](references/save-flow.md).

## Share URL

Read `dashboards.whoami` once per conversation:

```sql
SELECT spa_origin, localpart, my_dashboards_prefix FROM dashboards.whoami
```

Share URL = `<my_dashboards_prefix><slug>`. Never guess the host —
the MCP origin and the SPA origin are different.

## spec_version

Always pin `spec_version: 1`. The SPA loads `/lib/v<N>/dash.js` to
render; old dashboards keep working when v2 ships.

## Don'ts

- Don't INSERT into `dashboards.dashboards` — only `dashboards_raw`.
- Don't use `INSERT ... VALUES (...)` — SELECT-form.
- Don't paste user input into SQL — declare a `param` and use `{{name}}`.
- Don't embed bearer tokens or `Authorization` headers in panels —
  `DASH.spec.fetch` handles auth.
- Don't reach for `localStorage`, cookies, or `parent.*` from `script`
  panels — the sandbox blocks them.
- Don't reach for `script` when a data panel can do it. Read
  `references/script-panels.md` first.
