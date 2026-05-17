# `line`

Time-series or any ordered x-axis. Multiple series via an explicit
`series` array (wide format) or `series_key` + `value_key` (pivoted
from long format).

```jsonc
{
  "id": "yearly_leaders", "type": "line",
  "query": "SELECT Year AS year, count() AS flights FROM ontime.fact_ontime GROUP BY year ORDER BY year",
  "x_key": "year",
  "series": [
    { "key": "flights", "label": "Total flights" }
  ]
}
```

Long-format pivot:

```jsonc
{
  "id": "by_carrier", "type": "line",
  "query": "SELECT Year AS year, Reporting_Airline AS k, count() AS v FROM ontime.fact_ontime GROUP BY year, k",
  "x_key": "year",
  "series_key": "k",
  "value_key":  "v"
}
```

## Fields

| Field | Purpose |
|---|---|
| `query`       | rows in x-order |
| `x_key`       | column for the x-axis value |
| `series`      | array of `{ key, label, color? }` — wide format |
| `series_key`  | column whose distinct values become series labels — long format |
| `value_key`   | column for the numeric y value when using `series_key` |
| `x_format`    | formatter for x tick labels (default `"raw"`) |
| `y_format`    | formatter for y tick labels (default `"num"`) |
| `annotations` | see [SKILL.md → Annotations](../SKILL.md#annotations) |
| `on_click`    | see [SKILL.md → Cross-panel filtering](../SKILL.md#cross-panel-filtering) |
| `accent`      | left-border accent (`primary` / `secondary` / `warm` / `rose`) |
| `title`, `empty_text` | as usual |

## Edges

- The y-axis is clamped to include `0` so growth-from-zero series
  read accurately. Override by widening the data range.
- With > 12 x-values the renderer decimates x-axis tick labels to
  ~8 visible labels. The path itself still draws all points.
- Non-finite values are skipped in the path (no NaN segments).
