# Theme

```html
<link rel="stylesheet" href="/lib/v1/dash-theme.css">
```

Cached at the edge for 5 min. Per-dashboard overrides go in a `<style>`
block after the link tag. The spec runtime injects this link
automatically; only hybrid `content` fragments or full-HTML dashboards
need to reference it explicitly.

## `:root` tokens — use the variable, never the hex

| Token | Hex | Use |
|---|---|---|
| `--bg`           | `#1a1a2e`  | page background |
| `--bg-2`         | `#22223e`  | card background |
| `--fg`           | `#e0e0e0`  | default text |
| `--fg-dim`       | `#9090a8`  | secondary text |
| `--accent`       | `#00d4aa`  | primary accent |
| `--accent-hover` | `#00b894`  | button hover |
| `--error`        | `#e94560`  | errors |
| `--warn`         | `#f5a623`  | warnings |
| `--rule`         | `#2a2a3e`  | dividers, table borders |
| `--link`         | `#5cd1ff`  | links, secondary series |
| `--shadow`       | `0 1px 3px rgba(0,0,0,0.4)` | card shadow |
| `--radius`       | `6px`      | corner radius |

## Classes the spec runtime emits

| Class | What |
|---|---|
| `.card`                             | bg-2 surface with padding/radius/shadow |
| `.kpi-strip`                        | auto-fit grid of KPI tiles (responsive, no media query) |
| `.kpi .v`, `.kpi .l`, `.kpi .n`     | big value / small-caps label / italic note (3rd line, opt-in) |
| `.row-2`, `.row-3`                  | 2- / 3-column layout grids (collapse to 1 on ≤800 px) |
| `.bar-cell`, `.bar-bg`, `.bar-fill` | horizontal share/progress bar |
| `.cell-badge`, `.cell-badge-high`, `.cell-badge-mid`, `.cell-badge-low` | pill chips inside table cells (used by column `badge` thresholds) |
| `.table-actions`, `.btn-mini`       | toolbar at the bottom of a `.card` table (CSV export button) |
| `.status-ok`, `.status-err`         | green / red status text |
| `.led-ok`, `.led-pend`, `.led-fail` | ledger row colors (used by `DASH.ledger`) |
| `.ledger-row-sql`, `.ledger-row-sql.open`, `.ledger-toggle.open` | collapsible SQL rows under each ledger entry |

## Table behavior (no spec config required)

- **Sticky headers** — `thead th` is `position: sticky; top: 0;` so long
  tables scroll cleanly inside `.card`.
- **Row hover** — any `<tr class="click">` gets a subtle hover background
  + pointer cursor. Apply this from a hybrid `content` script when you
  want to make rows interactive.
- **Selected-row outline** — `<tr class="sel">` or `<tr class="selected-row">`
  gets a 2px accent outline + tinted background. Use to mark which row's
  detail is currently shown in a drill-down panel below.

## Charts

For simple things (sparklines, mini-bars, horizontal share bars) inline
SVG and `display: flex` beat any library. Reach for Chart.js (or similar)
only when you need axes, legends, multi-series.

If you load Chart.js, call `DASH.chart.defaults()` once to apply the
dark-theme colors. Per-series palette: `var(--accent)` primary,
`var(--link)` secondary, `var(--warn)` tertiary, `var(--error)` bad. Keep
to ≤5 series — switch to small multiples beyond that.

