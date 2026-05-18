// bentoclick runtime — line panel.
//
// Single- or multi-series line chart with optional annotations.
// Series come from explicit `series:[]` (wide format) or
// `series_key` + `value_key` (pivoted from long). Points are
// click-targets for cross-panel `on_click` filtering.

import { applyFormat } from '../core/fmt.js';
import {
  chartPalette,
  linePath,
  svgRoot,
  axisBottom,
  axisY,
  bandScale,
  svgEl,
} from '../charts.js';
import { makeCard, wireOnClick } from './_shared.js';
import {
  resolveSeries,
  seriesValueAt,
  chartEmpty,
  pickXTicks,
  yScaleFromValues,
  drawAnnotations,
  buildLegend,
  subscribeAnnotations,
} from './chart-helpers.js';

export function renderLine(panel, state, ctx) {
  const card = makeCard(panel);
  const body = document.createElement('div');
  card.appendChild(body);

  const xFmt = (v) => applyFormat(ctx.api, panel.x_format || 'raw', v);
  const yFmt = (v) => applyFormat(ctx.api, panel.y_format || 'num', v);

  function draw(rows) {
    body.innerHTML = '';
    if (!rows || !rows.length) return chartEmpty(body, panel);
    const { series, xs, byX } = resolveSeries(panel, rows);
    const root = svgRoot({ width: 480, height: 220 });
    const xScale = bandScale(xs, [0, root.iw], 0);
    const allYs = [];
    series.forEach((s) => xs.forEach((x) => {
      const v = seriesValueAt(panel, rows, byX, s, x);
      if (isFinite(v)) allYs.push(v);
    }));
    if (!allYs.length) allYs.push(0, 1);
    const { ticks, scale: yScale } = yScaleFromValues(allYs, root.ih);
    root.plot.appendChild(axisY({ ticks, scale: yScale, iw: root.iw, ih: root.ih, format: yFmt }));
    root.plot.appendChild(axisBottom({ ticks: pickXTicks(xs), scale: xScale, iw: root.iw, ih: root.ih, format: xFmt }));
    const colorOf = (s, i) => s.color || chartPalette[i % chartPalette.length];
    series.forEach((s, i) => {
      const pts = xs.map((x) => [xScale(x), yScale(seriesValueAt(panel, rows, byX, s, x))]);
      const path = svgEl('path', {
        d: linePath(pts),
        class: 'chart-line',
        stroke: colorOf(s, i),
      });
      root.plot.appendChild(path);
      pts.forEach(([cx, cy], pi) => {
        if (!isFinite(cx) || !isFinite(cy)) return;
        const dot = svgEl('circle', {
          cx, cy, r: 3, fill: colorOf(s, i), class: 'chart-point',
        });
        const xv = xs[pi];
        if (panel.on_click) {
          const row = (byX && byX[String(xv)]) ? { [panel.x_key]: xv } : (rows.find((r) => String(r[panel.x_key]) === String(xv)) || { [panel.x_key]: xv });
          wireOnClick(dot, panel, row, ctx);
        }
        root.plot.appendChild(dot);
      });
    });
    drawAnnotations(root.plot, panel, xScale, root.ih, ctx);
    body.appendChild(root.svg);
    if (series.length > 1) body.appendChild(buildLegend(series, (s) => colorOf(s, series.indexOf(s))));
  }

  state.update = function (rows) {
    state.rows = rows || [];
    draw(state.rows);
  };
  subscribeAnnotations(state, panel, ctx, () => draw(state.rows || []));
  return card;
}
