# `combo`

Bars + line on dual axes. The single most useful shape for an
analytical dashboard: primary metric as bars (often `color_by` a
category column), derived metric (delta, ratio, share) as the line
on the right axis.

```jsonc
{
  "id": "leader_with_margin", "type": "combo",
  "query": "SELECT year, leader_airline, leader_flights, margin FROM yearly_leaders ORDER BY year",
  "x_key": "year",
  "bars":  { "key": "leader_flights", "color_by": "leader_airline", "label": "Flights" },
  "line":  { "key": "margin", "axis": "right", "label": "Margin over #2" }
}
```

## Fields

| Field | Purpose |
|---|---|
| `query`        | one row per x value |
| `x_key`        | column for the x-axis value |
| `bars.key`     | column for bar height |
| `bars.color_by`| optional column; same value → same color across renders |
| `bars.label`   | legend label for the bar series |
| `line.key`     | column for the line value |
| `line.axis`    | `"left"` (default) or `"right"` — dual axis |
| `line.label`   | legend label |
| `line.color`   | override the default line color |
| `x_format`, `y_format_left`, `y_format_right` | formatters |
| `annotations`  | see [SKILL.md → Annotations](../SKILL.md#annotations) |
| `on_click`     | see [SKILL.md → Cross-panel filtering](../SKILL.md#cross-panel-filtering) |
| `accent`, `title`, `empty_text` | as usual |

## Edges

- `color_by` uses a stable hash → 8-color palette. The same key
  always picks the same color, including across sibling panels.
- The left axis is clamped to include `0`. The right axis follows
  the line's data range (use `line.axis: "left"` to share the
  primary scale when units are comparable).
- The grid lines belong to the left axis; the right axis is
  axis-only (no overlapping grid).
