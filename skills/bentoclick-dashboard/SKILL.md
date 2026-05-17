---
name: bentoclick-dashboard
description: >
  Build dashboards backed by a ClickHouse cluster and save them so they
  can be shared by URL. Trigger when the user asks to build, visualize,
  or save a dashboard / chart / report.
---

# bentoclick-dashboard

Dashboards are rows in `bentoclick.dashboards`, served at
`https://<spa-origin>/v/<owner>/<slug>` behind OAuth. The viewer's
bearer authenticates ClickHouse queries; the dashboard's SQL runs as
the viewer.

There is one dashboard shape: a **spec** — a small JSON object the SPA
renders to HTML at view time. Every spec is dynamic (panels re-fetch
on param change). No raw-HTML dashboards.

## Spec shape

```jsonc
{
  "title":        "string, required",  // <h1> + page <title>
  "subtitle":     "string, optional",  // muted line under H1
  "spec_version": 1,                   // pin to 1; bumps are breaking
  "concurrent":   false,               // panels fetch sequentially by default
  "params":       [ /* see Params */ ],
  "panels":       [ /* see Panels */ ]
}
```

## Save

Call the **`save_dashboard`** MCP tool with the spec values as
arguments. `slug` and `title` are required; the rest are optional and
map to the columns: `subtitle`, `concurrent`, `spec_version`, plus
`params`, `panels`, `meta`, `tags` — these last four are passed as
**JSON-encoded text strings** (the agent stringifies them; the server
parses on the way in).

The server writes through a sanitizing materialized view that strips
`<script>`, `<iframe>`, event handlers, and `javascript:` URLs from
`html` panels, then computes `owner = currentUser()` (the actual
caller; the MV uses `SQL SECURITY DEFINER` for privilege purposes
but `currentUser()` still resolves to the session user) and
`updated_at = now()`. A new INSERT under the same `(owner, slug)`
replaces the previous row.

## Share URL

Read once per conversation:

```sql
SELECT spa_origin, localpart, my_dashboards_prefix FROM bentoclick.whoami
```

Share URL = `<my_dashboards_prefix><slug>`. Never guess the host —
the MCP origin and the SPA origin are different.

## Params

Render as `<input>` / `<select>` / date-picker above the panels. The
current value substitutes into each panel's query via `{{name}}`,
with strict per-type validation. Failure aborts the query and shows
inline in the panel — never sent to CH.

| `type`   | Validation | Splice form |
|---|---|---|
| `int`    | integer, optional `min` / `max` | literal: `123` |
| `enum`   | must be one of `options` | `'value'` (single-quoted) |
| `date`   | matches `^\d{4}-\d{2}-\d{2}$` | `'2024-01-15'` |
| `string` | matches `pattern` (default `^[A-Za-z0-9 _.+@-]*$`), `max_length` | `'value'` (quotes doubled) |

```jsonc
"params": [
  { "name": "year",    "type": "int",  "default": 2023, "min": 1987, "max": 2025 },
  { "name": "carrier", "type": "enum", "options": ["WN","DL","AA","UA"], "default": "WN" },
  { "name": "from",    "type": "date", "default": "2024-01-01" }
]
```

## Picking the dashboard shape

Decide the **shape** before picking panels. The shape determines
whether the period belongs in a param at the top of the page or
inside a chart axis.

- **Snapshot** — one period, many slices. Use a `param` for the
  period; panels slice that period (kpi-strip + tables + bars). The
  worked example below is this shape.
- **Time-series** — many periods, one or two metrics. Do **not** put
  a period param at the top; the time axis lives inside a `line` or
  `combo` panel. Params should constrain non-time dimensions
  (carrier, airport, region). Cross-period questions ("which year
  did X overtake Y") render on one screen.
- **Event log** — a small list of notable moments. Drive the page
  from one `table` panel; use `callouts` to narrate the rows; use
  `annotations` to mark the events on any time-series panel beside
  the table.

If the user's question spans periods, the answer is almost never
"add a year picker." Reach for `line`, `combo`, or `chart` with an
`annotations` source instead.

## Panels

Auto-flow layout: `width: 12` (default) is full-row; consecutive
`width: 6` pair side-by-side; consecutive `width: 4` triple. No
nested grids.

| `type` | Use for | Reference |
|---|---|---|
| `kpi-strip` | One-row query → tile per measurable | [panels/kpi-strip.md](panels/kpi-strip.md) |
| `table`     | Sticky-header table, formatters, threshold badges | [panels/table.md](panels/table.md) |
| `bars`      | Horizontal share bars (quick shortcut) | [panels/bars.md](panels/bars.md) |
| `chart`     | Categorical bars with `color_by`, vertical or horizontal | [panels/chart.md](panels/chart.md) |
| `line`      | Time-series / ordered x-axis with one or more series | [panels/line.md](panels/line.md) |
| `combo`     | Bars + line on dual axes — analytical workhorse | [panels/combo.md](panels/combo.md) |
| `markdown`  | Narrative text, no query | [panels/markdown.md](panels/markdown.md) |
| `hero`      | Templated sentence anchored to another panel's first row | [panels/hero.md](panels/hero.md) |
| `callouts`  | Templated cards anchored to N rows of another panel | [panels/callouts.md](panels/callouts.md) |
| `html`      | Static markup (sanitized) + optional templated `query` | [panels/html.md](panels/html.md) |
| `script`    | JS escape hatch — drill-down, third-party libs. Last resort. | [panels/script.md](panels/script.md) |

`script` has a two-of-three decision gate at the top of its page.
Read it before reaching for `script`.

## Cross-panel filtering

Any `table`, `chart`, `combo`, or `line` panel can drive a param
update on click via `on_click`:

```jsonc
{
  "id": "handoffs", "type": "table",
  "columns": [ /* … */ ],
  "on_click": { "set_param": "year", "from": "year_of_change" }
}
```

Clicking a row (or a bar / point) writes `row[from]` to the named
param. Panels whose query interpolates `{{year}}` re-run; the rest
are untouched. The toolbar input syncs automatically.

`on_click` is the right answer when a click on a row should drill
into a snapshot of the corresponding period or entity. It is the
wrong answer for free-form filters — those are still params.

## Annotations

`line`, `combo`, and `chart` accept an `annotations` block that
overlays vertical reference lines from another panel's rows:

```jsonc
"annotations": {
  "source":    "handoffs",        // another panel id
  "x_key":     "year_of_change",  // matched against this chart's x_key
  "label_key": "new_leader"       // optional text label
}
```

Pairs naturally with the **event log** shape: a `table` lists the
moments, a `combo` plots the underlying metric, and the annotations
tie them together visually.

## Formatters

`format` values for tile/cell values:

| name | example |
|---|---|
| `raw` (default) | HTML-escape only |
| `num`        | `12,345` |
| `pct`        | `42.0%` (input is a fraction 0..1) |
| `cost`       | `$12.34` (`$12.345` below $10) |
| `date` / `day` | `YYYY-MM-DD` (first 10 chars) |
| `time`       | `13:05` (from hhmm integer like `1305`) |
| `duration`   | `2h 15m` (from minutes) |
| `bytes`      | `12.3 KB` |

`format_fn` references any `DASH.fmt.*` helper by dotted path —
e.g. `"format_fn": "fmt.shortEmail"` for the localpart of an email.

## spec_version

Always pin `spec_version: 1`. The SPA loads `/lib/v<N>/dash.js` to
render; old dashboards keep working when v2 ships.

## Don'ts

- Don't paste user input into SQL — declare a `param` and use `{{name}}`.
- Don't embed bearer tokens or `Authorization` headers in panels —
  `DASH.spec.fetch` handles auth.
- Don't reach for `localStorage`, cookies, or `parent.*` from `script`
  panels — the sandbox blocks them.
- Don't reach for `script` when a data panel can do it. Read
  [panels/script.md](panels/script.md) first.
- Don't set `concurrent: true` unless every panel query is cheap.
  Default sequential fetching keeps peak memory bounded.

## Worked example

```jsonc
{
  "title":        "US Airline On-Time",
  "spec_version": 1,
  "params": [{ "name": "year", "type": "int", "default": 2023, "min": 1987, "max": 2025 }],
  "panels": [
    {
      "id": "kpis", "type": "kpi-strip",
      "query": "SELECT count() AS flights, countIf(Cancelled=1) AS cancelled FROM ontime.fact_ontime WHERE Year = {{year}}",
      "tiles": [
        { "key": "flights",   "label": "Flights",   "format": "num" },
        { "key": "cancelled", "label": "Cancelled", "format": "num" }
      ]
    },
    {
      "id": "airlines", "type": "table", "width": 6, "title": "Top 10 airlines",
      "query": "SELECT Reporting_Airline AS airline, count() AS flights FROM ontime.fact_ontime WHERE Year = {{year}} GROUP BY airline ORDER BY flights DESC LIMIT 10",
      "columns": [
        { "key": "airline", "label": "Airline" },
        { "key": "flights", "label": "Flights", "format": "num", "align": "right" }
      ]
    },
    {
      "id": "airports", "type": "table", "width": 6, "title": "Top 10 origins",
      "query": "SELECT OriginCode AS code, count() AS flights FROM ontime.fact_ontime WHERE Year = {{year}} GROUP BY code ORDER BY flights DESC LIMIT 10",
      "columns": [
        { "key": "code",    "label": "Code" },
        { "key": "flights", "label": "Flights", "format": "num", "align": "right" }
      ]
    }
  ]
}
```
