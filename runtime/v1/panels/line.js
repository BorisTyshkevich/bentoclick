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
import { wireOnClick, makePanelHead, formatStamp } from './_shared.js';
import {
  resolveSeries,
  seriesValueAt,
  chartEmpty,
  pickXTicks,
  yScaleFromValues,
  drawAnnotations,
  buildLegend,
  installHoverCrosshair,
  subscribeAnnotations,
} from './chart-helpers.js';

export function renderLine(panel, state, ctx) {
  const card = document.createElement('div');
  card.className = 'card panel-shell';
  if (panel.accent) card.setAttribute('data-accent', panel.accent);
  const head = makePanelHead(panel);
  card.appendChild(head.el);
  const body = document.createElement('div');
  body.className = 'panel-body';
  card.appendChild(body);

  const xFmt = (v) => applyFormat(ctx.api, panel.x_format || 'raw', v);
  const yFmt = (v) => applyFormat(ctx.api, panel.y_format || 'num', v);

  function draw(rows) {
    body.innerHTML = '';
    if (!rows || !rows.length) return chartEmpty(body, panel);
    const { series, xs, byX } = resolveSeries(panel, rows);
    // viewBox tuned to match the v2 design's chart proportions
    // (`bc-charts.js: lineChart` uses 880×280). With width:100% the
    // SVG scales; a larger viewBox keeps tick-label / axis text from
    // ballooning past ~12px at typical panel widths.
    const root = svgRoot({ width: 880, height: 280 });
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
    installHoverCrosshair(root.svg, root.plot, body, {
      xs, xScale, ih: root.ih, iw: root.iw, pad: root.pad,
      xFormat: xFmt,
      series: series.map((s, i) => ({
        label: s.label || String(s.key),
        color: colorOf(s, i),
        // line.js supports pivoted long format → use byX lookup by xLabel.
        get: (_idx, xLabel) => seriesValueAt(panel, rows, byX, s, xLabel),
        format: yFmt,
      })),
    });
    if (series.length > 1) {
      const items = series.map((s, i) => ({
        kind: 'line',
        label: s.label || String(s.key),
        color: colorOf(s, i),
        key: 'line:' + (s.key || s.label || i),
      }));
      body.appendChild(buildLegend(items));
    }
  }

  function refreshStamp() {
    const xs = (state.rows || []).map((r) => r[panel.x_key]);
    let range = '';
    if (xs.length) {
      const first = String(xs[0] == null ? '' : xs[0]);
      const last  = String(xs[xs.length - 1] == null ? '' : xs[xs.length - 1]);
      range = first === last ? first : (first + ' – ' + last);
    }
    head.setStamp(formatStamp(range, state.elapsedMs));
  }
  state.update = function (rows) {
    state.rows = rows || [];
    draw(state.rows);
    refreshStamp();
  };
  subscribeAnnotations(state, panel, ctx, () => {
    draw(state.rows || []);
    refreshStamp();
  });
  return card;
}
