// bentoclick runtime — chart panel (categorical bars).
//
// Vertical bars (default) render as an SVG with axes. Horizontal bars
// render as the v2 design's `.bc-bars > .row-b > .lbl + .track + .fill
// + .val` HTML rail — slim 8px tracks with mono labels and a right-
// aligned value, matching `bars.js` and the `.bc-bars` block in
// `dash-theme.css`. The SVG horizontal layout (chunky 24px-tall bars
// with axis ticks) was replaced because it dwarfed the design
// language; time-series and vertical comparison stay SVG.
//
// Color behavior:
//   - `panel.color_by` keys the chart palette per row → wrapper gets
//     `data-multi` and each `.fill` carries a `--c` custom property.
//   - Without `color_by`, the fill picks up `--accent` via CSS.

import { fmt, applyFormat } from '../core/fmt.js';
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
      // HTML .bc-bars rail — matches the design's slim 8px-track shape
      // and reuses dash-theme.css. SVG rendering would compete with
      // bars.js for visual language; one canonical horizontal-bar look
      // is the v2 design's call.
      const wrap = document.createElement('div');
      wrap.className = 'bc-bars';
      if (panel.color_by) wrap.setAttribute('data-multi', '');
      const vMax = Math.max(1, ...values);
      wrap.innerHTML = rows.map((r, i) => {
        const v = values[i];
        const pct = (100 * v / vMax).toFixed(1);
        const label = String(labels[i] == null ? '' : labels[i]);
        let style = 'width:' + pct + '%';
        if (panel.color_by && r[panel.color_by] != null) {
          style += ';--c:' + colorFor(String(r[panel.color_by]));
        }
        return '<div class="row-b" data-row-index="' + i + '">'
          + '<span class="lbl">' + fmt.esc(label) + '</span>'
          + '<div class="track"><div class="fill" style="' + style + '"></div></div>'
          + '<span class="val">' + yFmt(v) + '</span>'
          + '</div>';
      }).join('');
      body.appendChild(wrap);
      wrap.querySelectorAll('.row-b[data-row-index]').forEach((el) => {
        const row = rows[Number(el.getAttribute('data-row-index'))];
        if (row) wireOnClick(el, panel, row, ctx);
      });
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
