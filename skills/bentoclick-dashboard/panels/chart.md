# `chart`

Categorical bars with `color_by`, optional horizontal layout, and
`on_click` cross-panel filtering. Use this when `bars` runs out —
specifically when you need per-row color from a column, an actual
axis, or annotations.

```jsonc
{
  "id": "yearly_leaders", "type": "chart",
  "query": "SELECT Year AS year, leader_airline, leader_flights FROM yearly_leaders ORDER BY year",
  "x_key": "year",
  "value_key": "leader_flights",
  "color_by":  "leader_airline",
  "on_click":  { "set_param": "year", "from": "year" }
}
```

## Fields

| Field | Purpose |
|---|---|
| `query`       | one row per bar |
| `x_key`       | column for the x label (also `label_key`) |
| `value_key`   | column for the numeric value |
| `color_by`    | optional column; same value → same color across renders |
| `orientation` | `"vertical"` (default) or `"horizontal"` |
| `format`      | formatter for y-axis labels (default `"num"`) |
| `annotations` | see [SKILL.md → Annotations](../SKILL.md#annotations) |
| `on_click`    | see [SKILL.md → Cross-panel filtering](../SKILL.md#cross-panel-filtering) |
| `accent`, `title`, `empty_text` | as usual |

## Edges

- Vertical mode caps visible x-axis tick labels at ~8 to keep them
  readable; the bars themselves still draw for every row.
- Horizontal mode is variable-height: each bar gets ~24px vertical
  band. Useful for top-N rankings where labels are long.
- Bars without `color_by` use a single palette color. The shorthand
  for "all the same color" is to omit `color_by`.
