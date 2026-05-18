// bentoclick runtime — chart panel (categorical bars).
//
// Single-axis bar chart, vertical (default) or horizontal. Colors
// can vary per-bar via `color_by` keyed off a categorical column.
// The horizontal orientation is preferred for long labels (carrier
// names, route codes) since they get y-axis space; vertical is the
// default for time-series-like categorical x axes.

import { applyFormat } from '../core/fmt.js';
import {
  chartPalette,
  colorFor,
  linearScale,
  niceTicks,
  svgRoot,
  axisBottom,
  axisY,
  bandScale,
  svgEl,
} from '../charts.js';
import { makeCard, wireOnClick } from './_shared.js';
import {
  chartEmpty,
  pickXTicks,
  yScaleFromValues,
  drawAnnotations,
  subscribeAnnotations,
} from './chart-helpers.js';

export function renderChart(panel, state, ctx) {
  const card = makeCard(panel);
  const body = document.createElement('div');
  card.appendChild(body);
  const xFmt = (v) => applyFormat(ctx.api, panel.x_format || 'raw', v);
  const yFmt = (v) => applyFormat(ctx.api, panel.format || 'num', v);
  const orientation = panel.orientation === 'horizontal' ? 'horizontal' : 'vertical';
  const valueKey = panel.value_key || 'value';
  const xKey = panel.x_key || panel.label_key || 'label';

  function draw(rows) {
    body.innerHTML = '';
    if (!rows || !rows.length) return chartEmpty(body, panel);
    const labels = rows.map((r) => r[xKey]);
    const values = rows.map((r) => Number(r[valueKey]) || 0);
    const colorOf = (r) => panel.color_by
      ? colorFor(r[panel.color_by])
      : chartPalette[0];

    if (orientation === 'horizontal') {
      const root = svgRoot({
        width: 480, height: Math.max(120, rows.length * 24 + 40),
        padding: { top: 8, right: 12, bottom: 24, left: 120 },
      });
      const yScale = bandScale(labels, [0, root.ih], 0.2);
      const vMax = Math.max(1, ...values);
      const xTicks = niceTicks(0, vMax, 4);
      const xScale = linearScale([0, xTicks[xTicks.length - 1]], [0, root.iw]);
      root.plot.appendChild(axisBottom({ ticks: xTicks, scale: xScale, iw: root.iw, ih: root.ih, format: yFmt }));
      // Labels on the left.
      labels.forEach((lab) => {
        const cy = yScale(lab);
        const t = svgEl('text', {
          x: -6, y: cy + 4, 'text-anchor': 'end', class: 'chart-tick-label',
        });
        t.textContent = String(lab);
        root.plot.appendChild(t);
      });
      rows.forEach((r, i) => {
        const cy = yScale(labels[i]);
        const w = xScale(values[i]);
        const rect = svgEl('rect', {
          x: 0, y: cy - yScale.bandwidth / 2, width: Math.max(0, w), height: yScale.bandwidth,
          fill: colorOf(r), class: 'chart-bar',
        });
        wireOnClick(rect, panel, r, ctx);
        root.plot.appendChild(rect);
      });
      body.appendChild(root.svg);
      return;
    }

    // Vertical bars.
    const root = svgRoot({ width: 480, height: 220 });
    const xScale = bandScale(labels, [0, root.iw], 0.2);
    const { ticks, scale: yScale } = yScaleFromValues(values, root.ih);
    root.plot.appendChild(axisY({ ticks, scale: yScale, iw: root.iw, ih: root.ih, format: yFmt }));
    root.plot.appendChild(axisBottom({ ticks: pickXTicks(labels), scale: xScale, iw: root.iw, ih: root.ih, format: xFmt }));
    const bw = xScale.bandwidth;
    const zeroY = yScale(0);
    rows.forEach((r, i) => {
      const cx = xScale(labels[i]);
      const y = yScale(values[i]);
      const h = Math.abs(zeroY - y);
      const rect = svgEl('rect', {
        x: cx - bw / 2, y: Math.min(zeroY, y), width: bw, height: h,
        fill: colorOf(r), class: 'chart-bar',
      });
      wireOnClick(rect, panel, r, ctx);
      root.plot.appendChild(rect);
    });
    drawAnnotations(root.plot, panel, xScale, root.ih, ctx);
    body.appendChild(root.svg);
  }

  state.update = function (rows) {
    state.rows = rows || [];
    draw(state.rows);
  };
  subscribeAnnotations(state, panel, ctx, () => draw(state.rows || []));
  return card;
}
