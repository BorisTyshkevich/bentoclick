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
  svgEl,
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

// buildLegend — emit the design's `.chart-legend > .item` shape.
//
//   items: [{ kind: 'bar' | 'line', label, color, key? }, ...]
//
// `bar` items get a 10×10 swatch; `line` items get a 2px-tall 14px-wide
// strip (the design's `.sw.line`). `key` is optional metadata for
// click-to-toggle wiring in Stage 4 — `.item[data-legend-key]` is the
// anchor the legend toggle handler looks for.
export function buildLegend(items) {
  const wrap = document.createElement('div');
  wrap.className = 'chart-legend';
  items.forEach((it) => {
    const item = document.createElement('span');
    item.className = 'item';
    if (it.key != null) item.setAttribute('data-legend-key', String(it.key));
    const sw = document.createElement('span');
    sw.className = it.kind === 'line' ? 'sw line' : 'sw';
    sw.style.background = it.color;
    item.appendChild(sw);
    item.appendChild(document.createTextNode(it.label));
    wrap.appendChild(item);
  });
  return wrap;
}

// installLegendToggle — clicking a `.chart-legend .item[data-legend-key]`
// toggles `.off` on the item (CSS fades it via `opacity: 0.4`) and
// flips `display` on every `[data-legend-key="…"]` element under
// `container` whose key matches. Renderers tag the bars/line/points
// they want togglable with the same `data-legend-key` they wrote
// onto the legend item — see combo.js (`bar:<category>` / `line`)
// and line.js (`line:<seriesKey>`).
export function installLegendToggle(legend, container) {
  if (!legend) return;
  legend.querySelectorAll('.item[data-legend-key]').forEach((item) => {
    item.addEventListener('click', () => {
      const key = item.getAttribute('data-legend-key');
      const off = item.classList.toggle('off');
      container.querySelectorAll('[data-legend-key="' + key + '"]').forEach((el) => {
        // Only mutate SVG/HTML chart elements — never the legend item
        // (which has its own selector under `.chart-legend`).
        if (el === item) return;
        el.style.display = off ? 'none' : '';
      });
    });
  });
}

// uniquePreserveOrder — small util used by renderers to derive a
// stable legend for a `color_by` column without dropping the first-seen
// order of values across the rows.
export function uniquePreserveOrder(values) {
  const seen = new Set();
  const out = [];
  for (const v of values) {
    if (v == null) continue;
    const s = String(v);
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

// installHoverCrosshair — adds a `.chart-hover-line` vertical guide
// (rendered inside the SVG plot) and a `.chart-tooltip` element in
// the panel body. mousemove resolves the nearest x band and shows
// per-series values formatted by each series' `format` callback.
//
//   svg, plot, body — the SVG root, the inner `<g>` plot group, and
//     the surrounding `.panel-body` DOM element (positioned-relative).
//   opts.xs       — array of x labels (same order as scale domain).
//   opts.xScale   — band scale mapping label → x in plot coords.
//   opts.ih, iw   — plot inner dims (height/width inside padding).
//   opts.pad      — padding object from `svgRoot`.
//   opts.series   — [{ label, color, get(idx, xLabel), format(v) }].
//     get(idx, xLabel) returns the series' value at that x position.
//     Renderers that have one row per x (combo, chart) can pull from
//     rows[idx]; renderers with pivoted long format (line) can use
//     idx + xLabel to query their byX index.
//   opts.xFormat  — optional formatter for the tooltip's x label.
//
// Returns `{ destroy() }` so a redraw can remove the prior listeners.
// `state.update` calls draw() which builds a fresh SVG; old helper
// instances die with the old SVG (no detach needed). The tooltip
// is appended to `body`, so it survives redraws — we clean it up
// only when state.update is called again.
export function installHoverCrosshair(svg, plot, body, opts) {
  const { xs, xScale, ih, iw, pad, series, xFormat } = opts;
  if (!xs.length) return { destroy() {} };

  // Reuse a single tooltip per panel body, so successive redraws
  // don't pile up stale tooltips.
  let tip = body.querySelector(':scope > .chart-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tooltip';
    body.appendChild(tip);
  }

  // Hover guide line — invisible by default, snaps to the nearest x.
  const hoverLine = svgEl('line', {
    x1: 0, x2: 0, y1: 0, y2: ih, class: 'chart-hover-line',
  });
  hoverLine.style.opacity = '0';
  plot.appendChild(hoverLine);

  // Transparent overlay catches mousemove without per-glyph wiring.
  const overlay = svgEl('rect', {
    x: 0, y: 0, width: iw, height: ih, fill: 'transparent',
    class: 'chart-hover-overlay',
  });
  overlay.style.cursor = 'crosshair';
  plot.appendChild(overlay);

  function pointerPlotX(ev) {
    // Browser path: use the SVG's screen-coords matrix.
    if (svg.createSVGPoint && svg.getScreenCTM) {
      try {
        const pt = svg.createSVGPoint();
        pt.x = ev.clientX; pt.y = ev.clientY;
        const ctm = svg.getScreenCTM();
        if (ctm && typeof ctm.inverse === 'function' && typeof pt.matrixTransform === 'function') {
          const p = pt.matrixTransform(ctm.inverse());
          return p.x - (pad ? pad.left : 0);
        }
      } catch (_e) { /* fall through to rect-based path */ }
    }
    // Fallback: linear-scale clientX → viewBox x via getBoundingClientRect.
    // Works in happy-dom tests and in environments where SVG transforms
    // aren't fully implemented.
    const rect = svg.getBoundingClientRect();
    if (!rect || !rect.width) return -1;
    const vb = (svg.viewBox && svg.viewBox.baseVal)
      ? svg.viewBox.baseVal
      : { width: iw + (pad ? pad.left + pad.right : 0) };
    const localX = (ev.clientX - rect.left) * (vb.width / rect.width);
    return localX - (pad ? pad.left : 0);
  }

  function nearestIndex(x) {
    let best = -1, bestDist = Infinity;
    for (let i = 0; i < xs.length; i++) {
      const cx = xScale(xs[i]);
      const d = Math.abs(cx - x);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }

  function show(ev) {
    const x = pointerPlotX(ev);
    if (x < 0 || x > iw) return hide();
    const idx = nearestIndex(x);
    if (idx < 0) return hide();
    const cx = xScale(xs[idx]);
    hoverLine.setAttribute('x1', cx);
    hoverLine.setAttribute('x2', cx);
    hoverLine.style.opacity = '1';
    const xLabel = xFormat ? xFormat(xs[idx]) : String(xs[idx]);
    tip.innerHTML =
      '<div class="tt-x">' + fmt.esc(xLabel) + '</div>'
      + series.map((s) => {
        const v = s.get(idx, xs[idx]);
        const text = s.format ? s.format(v) : (v == null ? '' : String(v));
        return '<div class="tt-row">'
          + '<span class="sw" style="background:' + fmt.esc(s.color || 'var(--accent)') + '"></span>'
          + '<span class="lbl">' + fmt.esc(s.label) + '</span>'
          + '<span class="v">' + fmt.esc(text) + '</span>'
          + '</div>';
      }).join('');
    // Position tooltip over the hover line in panel-body coords.
    const svgRect = svg.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    // SVG width in CSS pixels; convert viewBox cx (plot-space) to px.
    const vb = (svg.viewBox && svg.viewBox.baseVal) ? svg.viewBox.baseVal : null;
    const vbW = vb ? vb.width : (pad ? (iw + pad.left + pad.right) : iw);
    const vbX = (cx + (pad ? pad.left : 0));
    const xPx = (vbX / vbW) * svgRect.width;
    tip.style.left = (svgRect.left - bodyRect.left + xPx) + 'px';
    tip.style.top  = (svgRect.top  - bodyRect.top) + 'px';
    tip.classList.add('on');
  }

  function hide() {
    hoverLine.style.opacity = '0';
    tip.classList.remove('on');
  }

  overlay.addEventListener('mousemove', show);
  overlay.addEventListener('mouseleave', hide);
  return { destroy() { overlay.removeEventListener('mousemove', show); overlay.removeEventListener('mouseleave', hide); } };
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
