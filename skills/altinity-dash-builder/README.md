# altinity-dash-builder

A Claude skill for authoring dashboards on a ClickHouse cluster running
the `dash` SPA. Three modes:

- **Spec** (primary) — tiny JSON describing panels, queries, layout.
  Server-rendered at view time. Most dashboards.
- **Hybrid** — spec + a small HTML/JS fragment for things the spec
  can't express (row-click drill-down, custom panels, libraries).
- **HTML** (escape hatch) — full HTML written by hand. Dynamic
  (queries via `CH_FETCH`) or static (data baked in).

Dashboards live as rows in `dashboards.dashboards`. The bearer never
enters the dashboard iframe — a stored-XSS dashboard cannot exfiltrate
a reusable credential.

Entrypoint: `SKILL.md`. References:

- `spec-mode.md`   — primary path: spec schema, panel types, params, hybrid.
- `dynamic-mode.md` — HTML escape hatch with view-time queries.
- `static-mode.md`  — HTML escape hatch with data baked in (snapshots).
- `save-flow.md`   — INSERT mechanics, quoting, edit-by-re-INSERT.
- `data-fetch.md`  — `CH_FETCH` / `DASH.fetch` contract (used by hybrid + HTML).
- `theme.md`       — `:root` tokens, class library, charts.

To iterate, re-INSERT with the same `(owner, slug)`. URL stays stable.
