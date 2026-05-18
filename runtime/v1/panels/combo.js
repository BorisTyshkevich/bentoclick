// bentoclick runtime — combo panel.
//
// Bars + line on (optionally dual) axes — the analytical workhorse
// for "count + ratio" type queries. `bars.color_by` colors each
// bar by a categorical column. Either axis can host the line via
// `line.axis: 'right'`.

import { applyFormat } from '../core/fmt.js';
import {
  chartPalette,
  colorFor,
  linePath,
  svgRoot,
  axisBottom,
  axisY,
  bandScale,
  svgEl,
} from '../charts.js';
import { wireOnClick, makePanelHead, formatStamp } from './_shared.js';
import {
  chartEmpty,
  pickXTicks,
  yScaleFromValues,
  drawAnnotations,
  buildLegend,
  subscribeAnnotations,
} from './chart-helpers.js';

export function renderCombo(panel, state, ctx) {
  const card = document.createElement('div');
  card.className = 'card panel-shell';
  if (panel.accent) card.setAttribute('data-accent', panel.accent);
  const head = makePanelHead(panel);
  card.appendChild(head.el);
  const body = document.createElement('div');
  body.className = 'panel-body';
  card.appendChild(body);
  const xFmt = (v) => applyFormat(ctx.api, panel.x_format || 'raw', v);
  const lFmt = (v) => applyFormat(ctx.api, panel.y_format_left || 'num', v);
  const rFmt = (v) => applyFormat(ctx.api, panel.y_format_right || 'num', v);
  const barsCfg = panel.bars || {};
  const lineCfg = panel.line || {};

  function draw(rows) {
    body.innerHTML = '';
    if (!rows || !rows.length) return chartEmpty(body, panel);
    const xs = rows.map((r) => r[panel.x_key]);
    const root = svgRoot({ width: 480, height: 240, padding: { top: 10, right: 56, bottom: 28, left: 52 } });
    const xScale = bandScale(xs, [0, root.iw], 0.15);

    const barVals = rows.map((r) => Number(r[barsCfg.key]) || 0);
    const lineVals = rows.map((r) => Number(r[lineCfg.key]) || 0);
    const { ticks: lTicks, scale: lScale } = yScaleFromValues(barVals,  root.ih);
    const { ticks: rTicks, scale: rScale } = yScaleFromValues(lineVals, root.ih);

    root.plot.appendChild(axisY({ ticks: lTicks, scale: lScale, iw: root.iw, ih: root.ih, format: lFmt }));
    if (lineCfg.axis === 'right') {
      root.plot.appendChild(axisY({ ticks: rTicks, scale: rScale, iw: root.iw, ih: root.ih, format: rFmt, orient: 'right', grid: false }));
    }
    root.plot.appendChild(axisBottom({ ticks: pickXTicks(xs), scale: xScale, iw: root.iw, ih: root.ih, format: xFmt }));

    const bw = xScale.bandwidth;
    const zeroY = lScale(0);
    rows.forEach((r, i) => {
      const v = barVals[i];
      const cx = xScale(xs[i]);
      const y = lScale(v);
      const h = Math.abs(zeroY - y);
      const color = barsCfg.color_by
        ? colorFor(r[barsCfg.color_by])
        : chartPalette[0];
      const rect = svgEl('rect', {
        x: cx - bw / 2, y: Math.min(zeroY, y), width: bw, height: h,
        fill: color, class: 'chart-bar',
      });
      wireOnClick(rect, panel, r, ctx);
      root.plot.appendChild(rect);
    });

    const lineColor = lineCfg.color || chartPalette[2];
    const lineUsesRight = lineCfg.axis === 'right';
    const yL = lineUsesRight ? rScale : lScale;
    const pts = rows.map((r, i) => [xScale(xs[i]), yL(lineVals[i])]);
    root.plot.appendChild(svgEl('path', {
      d: linePath(pts), class: 'chart-line', stroke: lineColor,
    }));
    pts.forEach(([cx, cy], i) => {
      if (!isFinite(cx) || !isFinite(cy)) return;
      const dot = svgEl('circle', {
        cx, cy, r: 3, fill: lineColor, class: 'chart-point',
      });
      wireOnClick(dot, panel, rows[i], ctx);
      root.plot.appendChild(dot);
    });

    drawAnnotations(root.plot, panel, xScale, root.ih, ctx);
    body.appendChild(root.svg);

    // Legend if labels are provided. buildLegend reads `.label` + the
    // colorOf callback; mixed-color marker for `color_by` bars
    // collapses to a neutral grey since one swatch can't carry the map.
    const legendSeries = [];
    if (barsCfg.label) legendSeries.push({ label: barsCfg.label, _color: barsCfg.color_by ? '#888' : chartPalette[0] });
    if (lineCfg.label) legendSeries.push({ label: lineCfg.label, _color: lineColor });
    if (legendSeries.length) body.appendChild(buildLegend(legendSeries, (s) => s._color));
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
    // event-pin shows the annotation count once anchor rows arrive.
    const annSrc = panel.annotations && panel.annotations.source
      ? (ctx.spec && ctx.spec.panels && ctx.spec.panels[panel.annotations.source])
      : null;
    const annRows = annSrc && annSrc.rows ? annSrc.rows : null;
    const annLabel = panel.annotations && panel.annotations.label;
    if (annRows && annRows.length) {
      head.setEventPin(annRows.length + ' ' + (annLabel || 'events'));
    } else {
      head.setEventPin('');
    }
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
