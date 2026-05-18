// bentoclick runtime — chart-renderer plumbing.
//
// Shared pipeline for `line` / `combo` / `chart`: parse rows into
// x/series values, build scales, draw axes + glyphs into an SVG.
// Also covers the narrative `{{key|fmt!}}` template grammar used by
// `hero` and `callouts` (kept here because they share `subscribeAnchor`).
//
// Each helper is local to the chart-renderer family — the spec
// contract is the panel fields, not these helper APIs.

import { fmt, applyFormat } from '../core/fmt.js';
import { mdInline } from '../core/markdown.js';
import {
  linearScale,
  niceTicks,
  annotationLine,
} from '../charts.js';

export function resolveSeries(panel, rows) {
  // Returns { series: [{ key, label, color? }], xs: [unique x values] }.
  // Two shapes supported:
  //   1. Explicit `series: [{key, label, color?}]` — wide format.
  //   2. `series_key` + `value_key` — pivot from long format. The
  //      distinct values in `series_key` become series labels.
  if (Array.isArray(panel.series) && panel.series.length) {
    const xs = [];
    const seen = new Set();
    rows.forEach((r) => {
      const x = r[panel.x_key];
      const k = String(x);
      if (!seen.has(k)) { seen.add(k); xs.push(x); }
    });
    return { series: panel.series.slice(), xs, byX: null };
  }
  if (panel.series_key && panel.value_key) {
    const xs = [];
    const xSeen = new Set();
    const sSeen = new Set();
    const series = [];
    rows.forEach((r) => {
      const xk = String(r[panel.x_key]);
      if (!xSeen.has(xk)) { xSeen.add(xk); xs.push(r[panel.x_key]); }
      const sk = String(r[panel.series_key]);
      if (!sSeen.has(sk)) {
        sSeen.add(sk);
        series.push({ key: r[panel.series_key], label: String(r[panel.series_key]) });
      }
    });
    // byX[xstr][series.key] = value
    const byX = {};
    rows.forEach((r) => {
      const xk = String(r[panel.x_key]);
      const sk = String(r[panel.series_key]);
      (byX[xk] = byX[xk] || {})[sk] = r[panel.value_key];
    });
    return { series, xs, byX };
  }
  // Single-series fallback: value_key only.
  const vk = panel.value_key || 'value';
  const xs = rows.map((r) => r[panel.x_key]);
  return {
    series: [{ key: vk, label: panel.label || vk }],
    xs,
    byX: null,
  };
}

export function seriesValueAt(panel, rows, byX, seriesObj, x) {
  if (byX) {
    const xk = String(x);
    const sk = String(seriesObj.key);
    const v = byX[xk] && byX[xk][sk];
    return Number(v);
  }
  // Wide format: find the row whose x_key matches, read seriesObj.key.
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][panel.x_key]) === String(x)) {
      return Number(rows[i][seriesObj.key]);
    }
  }
  return NaN;
}

export function chartEmpty(body, panel) {
  body.innerHTML = '<div style="color:var(--fg-dim);padding:8px 0">'
    + fmt.esc(panel.empty_text || 'no data') + '</div>';
}

// Downsample x-axis tick labels to ~8 when the band count exceeds 12,
// keeping every Nth label. Used by line/combo/chart so years-or-months
// don't overlap visually.
export function pickXTicks(xs) {
  return xs.length > 12
    ? xs.filter((_, i) => i % Math.ceil(xs.length / 8) === 0)
    : xs;
}

// `min(0, ...) → max(0, ...) → niceTicks → linearScale([ih,0])` is the
// stock y-axis recipe for line/combo/chart. The min(0,...) anchor keeps
// zero on the axis whenever values straddle zero or are all positive.
export function yScaleFromValues(values, ih) {
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values), 5);
  return { ticks, scale: linearScale([ticks[0], ticks[ticks.length - 1]], [ih, 0]) };
}

// Render a `{{key|fmt!}}` template against one row. Used by hero (one
// row) and callouts (N rows). Each placeholder is replaced by its
// (already-formatted, already-escaped) value via a NUL sentinel so the
// outer mdInline pass can operate on the template text without
// touching the value content.
export function renderTemplate(template, row, ctx) {
  const rendered = [];
  const re = /\{\{\s*(\w+)(?:\s*\|\s*(\w+))?\s*(!)?\s*\}\}/g;
  const withSentinels = String(template || '').replace(re, (_m, key, format, hl) => {
    const raw = row[key];
    const v = applyFormat(ctx.api, format || 'raw', raw == null ? '—' : raw);
    rendered.push(hl ? '<span class="hl">' + v + '</span>' : v);
    return '\x00' + (rendered.length - 1) + '\x00';
  });
  return mdInline(fmt.esc(withSentinels))
    .replace(/\x00(\d+)\x00/g, (_m, i) => rendered[+i]);
}

// Re-run `refresh` when the anchor panel emits `panel:loaded`. Used by
// hero and callouts to keep their narrative in sync with the upstream
// query. Idempotent — one subscription per state instance.
export function subscribeAnchor(state, panel, ctx, refresh) {
  if (state._anchorSub) return;
  if (!ctx || !ctx.spec || !ctx.spec.on) return;
  state._anchorSub = true;
  ctx.spec.on('panel:loaded', (ev) => {
    if (ev && ev.id === panel.anchor) refresh();
  });
}

export function getAnnotationRows(panel, ctx) {
  const a = panel.annotations;
  if (!a || !a.source || !ctx || !ctx.spec || !ctx.spec.panels) return [];
  const src = ctx.spec.panels[a.source];
  if (!src || !Array.isArray(src.rows)) return [];
  return src.rows;
}

export function drawAnnotations(plot, panel, xScale, ih, ctx) {
  const a = panel.annotations;
  if (!a || !a.x_key) return;
  const rows = getAnnotationRows(panel, ctx);
  if (!rows.length) return;
  rows.forEach((r) => {
    const xv = r[a.x_key];
    if (xv == null) return;
    const x = xScale(xv);
    if (x == null || !isFinite(x)) return;
    const label = a.label_key ? r[a.label_key] : null;
    plot.appendChild(annotationLine({ x, ih, label }));
  });
}

export function buildLegend(seriesList, colorOf) {
  const wrap = document.createElement('div');
  wrap.className = 'chart-legend';
  seriesList.forEach((s) => {
    const item = document.createElement('span');
    const sw = document.createElement('span');
    sw.className = 'sw';
    sw.style.background = colorOf(s);
    item.appendChild(sw);
    item.appendChild(document.createTextNode(s.label || String(s.key)));
    wrap.appendChild(item);
  });
  return wrap;
}

export function subscribeAnnotations(state, panel, ctx, redraw) {
  if (!panel.annotations || !panel.annotations.source) return;
  if (!ctx || !ctx.spec || !ctx.spec.on) return;
  if (state._annSub) return;
  state._annSub = true;
  ctx.spec.on('panel:loaded', (ev) => {
    if (ev && ev.id === panel.annotations.source) redraw();
  });
}
