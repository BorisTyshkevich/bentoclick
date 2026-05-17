# `bars`

Horizontal share bars. `value_key` drives bar width and the trailing
number; `label_key` is the row label. Order is whatever the query
returns — don't rely on the renderer to sort.

```jsonc
{
  "id": "monthly", "type": "bars", "title": "Monthly volume",
  "query": "SELECT label, value FROM monthly_counts ORDER BY label",
  "label_key": "label",
  "value_key": "value",
  "format":    "num"
}
```

## Fields

| Field | Purpose |
|---|---|
| `query`       | one row per bar |
| `label_key`   | column for the row label (default `"label"`) |
| `value_key`   | column for the numeric value (default `"value"`) |
| `format`      | formatter for the trailing value (default `"num"`) |
| `title`       | h2 above the panel |
| `empty_text`  | shown when the result set is empty |

## Edges

- Bar widths scale to the row with the max value (`max = 1` minimum
  so an all-zero series doesn't divide by zero).
- Labels are HTML-escaped before render.
- No legend, no axis ticks. For more chart shapes use a `script`
  panel with a third-party library.
