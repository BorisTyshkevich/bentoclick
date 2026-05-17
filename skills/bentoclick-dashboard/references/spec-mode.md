# Spec mode

A small JSON spec stored in `dashboards.dashboards.spec`. The SPA loads
the runtime and renders the spec to HTML at view time. The model never
writes the HTML — just the spec.

## Top-level shape

```jsonc
{
  "title":    "string, required",     // <h1> + page <title>
  "subtitle": "string, optional",     // small muted line under H1

  "concurrent": false,                // optional; fetch panels in parallel
                                      // instead of sequentially. Default is
                                      // sequential — only flip on if every
                                      // panel query is cheap.

  "params": [ /* see Params */ ],     // optional, default []
  "panels": [ /* see Panels */ ]      // required
}
```

## Params

Render as `<input>` / `<select>` / date-picker in a toolbar above the
panels. The current value is substituted into each panel's query
template via `{{name}}`, with strict per-type validation:

| `type`   | Default validation                                       | Splice form |
|---|---|---|
| `int`    | `Number(x)`, integer, optional `min`/`max`                | literal: `123` |
| `enum`   | must be one of `options`                                  | `'value'` (single-quoted, escaped) |
| `date`   | matches `^\d{4}-\d{2}-\d{2}$`                             | `'2024-01-15'` |
| `string` | matches `pattern` (default `^[A-Za-z0-9 _.+@-]*$`); `max_length` | `'value'` (single-quotes doubled) |

Any failure aborts the query and shows the error inline in the panel —
never sent to CH.

```jsonc
"params": [
  { "name": "year",    "type": "int", "default": 2023, "min": 1987, "max": 2025 },
  { "name": "carrier", "type": "enum", "options": ["WN","DL","AA","UA"], "default": "WN" },
  { "name": "from",    "type": "date", "default": "2024-01-01" }
]
```

## Panels

Auto-flow layout: panels with `width: 12` (default) are full-row;
consecutive `width: 6` pair side-by-side; consecutive `width: 4` triple.
No nested grids.

### `kpi-strip`

One query returning a single row; one tile per measurable. Each tile is
**value / label / optional italic note** — use the note for one-line
interpretation ("Established schedule", "9 airports").

```jsonc
{
  "id": "kpis", "type": "kpi-strip", "width": 12,
  "query": "SELECT count() AS flights, uniqExact(Reporting_Airline) AS airlines, 'Most flown' AS flights_note FROM ontime.fact_ontime WHERE Year = {{year}}",
  "tiles": [
    { "key": "flights",  "label": "Flights",  "format": "num",
      "note_key": "flights_note" },                 // 3rd line from a column
    { "key": "airlines", "label": "Airlines", "format": "num",
      "note": "distinct carriers" }                 // 3rd line, literal string
  ]
}
```

Tile fields: `key`, `label`, `format`, `format_fn`, `note` (literal),
`note_key` (column ref), `note_format`, `note_format_fn`.

### `table`

```jsonc
{
  "id": "longest", "type": "table", "width": 6, "title": "Top 10 longest",
  "query": "SELECT ... ORDER BY miles DESC LIMIT 10",
  "columns": [
    { "key": "tail",  "label": "Tail" },
    { "key": "miles", "label": "Miles", "format": "num",      "align": "right" },
    { "key": "air",   "label": "Air",   "format": "duration", "align": "right" },
    { "key": "hops",  "label": "Hops",  "format": "num",      "align": "right",
      "badge": { "8+": "high", "7+": "mid", "0+": "low" } }  // pill-chip per cell
  ],
  "empty_text": "No rotations matching the filter",
  "export": true   // default; set false to hide the CSV download button
}
```

**Column `badge` map** encodes thresholds → CSS class. Two forms:

- `{"20+": "high", "5+": "mid", "0+": "low"}` — explicit, descending. First match wins. Use `"0+"` as the fallback (matches any non-negative value).
- `{"high": 20, "mid": 5, "low": 0}` — compact; the values are interpreted as min thresholds for each named class.

Class names are appended to `cell-badge-` and styled in `dash-theme.css`
(`high` = accent green, `mid` = warn amber, `low` = error red). Bring
your own class names + CSS in the dashboard's `<style>` block for other
palettes.

Tables render with sticky headers (no extra config). Rows have hover
styles; hybrid `content` scripts can add `tr.click` / `tr.sel` classes
to make them click-selectable.

### `bars`

Horizontal share bars. `value_key` drives bar width and the trailing
number; `label_key` is the row label.

```jsonc
{
  "id": "monthly", "type": "bars", "title": "Monthly volume",
  "query": "SELECT ... GROUP BY label ORDER BY label",
  "label_key": "label", "value_key": "value", "format": "num"
}
```

### `markdown`

No query. `text` field renders with a minimal markdown subset (headings,
**bold**, *italic*, `code`, [links](https://…), bullet lists).

```jsonc
{ "type": "markdown", "text": "Snapshot of **2023** activity. Source: [BTS](https://www.transtats.bts.gov/)." }
```

## Formatters

`format` values applied to cell / tile values:

| name        | example output             |
|---|---|
| `raw`       | HTML-escaped only (default)  |
| `num`       | `12,345`                     |
| `pct`       | `42.0%` (input is a fraction 0..1) |
| `cost`      | `$12.34` or `$12.345` by magnitude |
| `date` / `day` | `YYYY-MM-DD` (first 10 chars of a date-ish value) |
| `time`      | `13:05` (from a `hhmm` integer like `1305`) |
| `duration`  | `2h 15m` (from minutes)      |
| `bytes`     | `12.3 KB`                    |

Use `format_fn` to reference any `DASH.fmt.*` helper by dotted path —
e.g. `"format_fn": "fmt.shortEmail"` to display only the localpart of an
email column.

### `html`

Static markup, optionally with a templated query that re-renders on
data load. The MV sanitizes panel content at save time, so the
runtime trusts what it reads.

```jsonc
{
  "type": "html", "width": 12,
  "html": "<div class='note'>Snapshot taken at install time.</div>"
}
```

With a query + template:

```jsonc
{
  "type": "html", "id": "lead", "width": 12,
  "query": "SELECT max(amount) AS top FROM expenses",
  "template": "<div>Top expense: <strong>{{rows[0].top}}</strong></div>"
}
```

`{{rows[N].field}}` substitution is HTML-escaped. `<script>` tags are
rejected at the MV layer — use `script` panels for JS.

### `script` — escape hatch (read the decision gate first)

JavaScript escape hatch for row-click drill-down, third-party widgets,
and panels with custom behavior. **Last resort** — most cases can be
expressed with the spec panels above. See
`references/script-panels.md` for the full API, decision gate, and
pitfalls before reaching for it.

```jsonc
{
  "type": "script", "id": "drill", "width": 12,
  "html": "<div id='r'>Click a row above</div>",
  "script": "await DASH.spec.ready; /* … */"
}
```

## Worked example

A full ontime dashboard in ~1 KB of spec:

```jsonc
{
  "title": "US Airline On-Time",
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

## Anything more dynamic?

If you need row-click drill-down, a third-party chart library, or
DOM manipulation beyond what the spec panels above express, use a
`script` panel — see `references/script-panels.md`. Static layout
beyond markdown belongs in an `html` panel.

For most BI-style dashboards (KPIs, tables, bars, narrative markdown,
hero takeaway), the seven spec panel types are enough.
