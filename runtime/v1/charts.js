// bentoclick runtime v1 — SVG chart primitives.
//
// Internal module imported by the chart-shaped panel renderers in
// dash.js (line / combo / chart). Not part of the dashboard spec
// surface — authors interact with these only through panel fields.
//
// Hand-rolled SVG, no chart-library dependency. The functions are
// pure (input -> SVG element or value), which keeps them trivially
// unit-testable in happy-dom and avoids the per-render allocations
// that a wrapper layer would impose.

const SVG_NS = 'http://www.w3.org/2000/svg';

// 8-color ordinal chartPalette. Chosen for high contrast on the dark
// theme defined in dash-theme.css; not tied to the --accent CSS
// vars because SVG paint inheritance through `currentColor` is too
// blunt when we need stable color-per-key.
export const chartPalette = [
  '#00d4aa', // primary teal
  '#5cd1ff', // sky
  '#f5a623', // amber
  '#e94560', // rose
  '#a78bfa', // violet
  '#76d672', // lime
  '#ff8e72', // coral
  '#7bdcb5', // mint
];

// Stable hash → chartPalette index. Pure FNV-1a-ish over the string form
// so the same `value` always picks the same color across renders
// and across panels.
export function colorFor(value, pal) {
  const p = pal || chartPalette;
  const s = String(value == null ? '' : value);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return p[h % p.length];
}

export function svgEl(name, attrs) {
  const e = document.createElementNS(SVG_NS, name);
  if (attrs) {
    for (const k in attrs) {
      if (attrs[k] != null) e.setAttribute(k, String(attrs[k]));
    }
  }
  return e;
}

// linearScale(domain=[min,max], range=[from,to]) → fn(value) → coord.
// Domain min==max is collapsed to the range midpoint, which keeps a
// single-point chart from going NaN.
export function linearScale(domain, range) {
  const d0 = +domain[0], d1 = +domain[1];
  const r0 = +range[0], r1 = +range[1];
  const span = d1 - d0;
  if (!span) {
    const mid = (r0 + r1) / 2;
    return () => mid;
  }
  return (v) => r0 + (r1 - r0) * ((+v - d0) / span);
}

// bandScale(values, range=[from,to]) → fn(value) → center coord;
// also exposes `.bandwidth` for bar width. `paddingInner` (0..1)
// reserves a gap between bands.
export function bandScale(values, range, paddingInner) {
  const r0 = +range[0], r1 = +range[1];
  const pad = paddingInner == null ? 0.2 : paddingInner;
  const n = values.length || 1;
  const step = (r1 - r0) / n;
  const bw = step * (1 - pad);
  const index = new Map();
  values.forEach((v, i) => { index.set(String(v), i); });
  function s(v) {
    const i = index.get(String(v));
    if (i == null) return null;
    return r0 + step * (i + 0.5);
  }
  s.bandwidth = bw;
  s.step = step;
  return s;
}

// niceTicks(min, max, target) → array of round numbers spanning the
// range with roughly `target` ticks (default 5). Used for y axis.
export function niceTicks(min, max, target) {
  if (!isFinite(min) || !isFinite(max)) return [0];
  if (min === max) {
    if (min === 0) return [0, 1];
    const m = Math.abs(min);
    return [min - m * 0.5, min, min + m * 0.5];
  }
  const t = target || 5;
  const span = max - min;
  const step0 = span / t;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  let step;
  if (norm < 1.5) step = 1 * mag;
  else if (norm < 3) step = 2 * mag;
  else if (norm < 7) step = 5 * mag;
  else step = 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step * 0.5; v += step) {
    out.push(Number(v.toFixed(12)));
  }
  return out;
}

// linePath(points) → SVG path `d` for a poly-line. `points` is an
// array of [x, y]. Filters non-finite values rather than emitting NaN.
export function linePath(points) {
  const seg = [];
  let started = false;
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i];
    if (!isFinite(x) || !isFinite(y)) continue;
    seg.push((started ? 'L' : 'M') + x + ',' + y);
    started = true;
  }
  return seg.join('');
}

// svgRoot({width, height, padding}) → { svg, plot, w, h, pad } where
// `plot` is a translated <g> for content drawn within the inner
// rectangle. `padding` defaults to {top:8,right:12,bottom:24,left:48}.
export function svgRoot(opts) {
  const w = opts.width || 480;
  const h = opts.height || 220;
  const pad = Object.assign({ top: 8, right: 12, bottom: 24, left: 48 }, opts.padding || {});
  // No `preserveAspectRatio: 'none'` and no fixed `height` attribute —
  // the SVG scales uniformly with its container width, so circles stay
  // round and text spacing stays proportional. CSS `max-width` on
  // .chart-svg in dash-theme.css caps the upper bound so wide-screen
  // dashboards don't grow charts to viewport-tall proportions.
  const svg = svgEl('svg', {
    viewBox: '0 0 ' + w + ' ' + h,
    width: '100%',
    class: 'chart-svg',
  });
  const plot = svgEl('g', { transform: 'translate(' + pad.left + ',' + pad.top + ')' });
  svg.appendChild(plot);
  return { svg, plot, w, h, pad, iw: w - pad.left - pad.right, ih: h - pad.top - pad.bottom };
}

// Horizontal axis along the bottom of the plot area. `ticks` are
// the values to label; `scale` maps value -> x; `format` is called
// for each tick label.
export function axisBottom(opts) {
  const g = svgEl('g', { class: 'chart-axis chart-axis-x' });
  const y = opts.ih;
  g.appendChild(svgEl('line', { x1: 0, x2: opts.iw, y1: y, y2: y, class: 'chart-axis-line' }));
  (opts.ticks || []).forEach((t) => {
    const x = opts.scale(t);
    if (x == null || !isFinite(x)) return;
    g.appendChild(svgEl('line', { x1: x, x2: x, y1: y, y2: y + 4, class: 'chart-tick' }));
    const txt = svgEl('text', { x, y: y + 16, 'text-anchor': 'middle', class: 'chart-tick-label' });
    txt.textContent = opts.format ? opts.format(t) : String(t);
    g.appendChild(txt);
  });
  return g;
}

// Vertical axis on the left (or right via `orient: 'right'`).
export function axisY(opts) {
  const orient = opts.orient === 'right' ? 'right' : 'left';
  const g = svgEl('g', { class: 'chart-axis chart-axis-y chart-axis-' + orient });
  const x = orient === 'right' ? opts.iw : 0;
  g.appendChild(svgEl('line', { x1: x, x2: x, y1: 0, y2: opts.ih, class: 'chart-axis-line' }));
  const labelX = orient === 'right' ? x + 6 : x - 6;
  const anchor = orient === 'right' ? 'start' : 'end';
  (opts.ticks || []).forEach((t) => {
    const y = opts.scale(t);
    if (y == null || !isFinite(y)) return;
    if (opts.grid !== false) {
      g.appendChild(svgEl('line', {
        x1: 0, x2: opts.iw, y1: y, y2: y, class: 'chart-grid',
      }));
    }
    const txt = svgEl('text', {
      x: labelX, y: y + 4, 'text-anchor': anchor, class: 'chart-tick-label',
    });
    txt.textContent = opts.format ? opts.format(t) : String(t);
    g.appendChild(txt);
  });
  return g;
}

// Vertical annotation line at `x`, with label text. Returns a <g>.
export function annotationLine(opts) {
  const g = svgEl('g', { class: 'chart-annotation' });
  const x = opts.x;
  g.appendChild(svgEl('line', { x1: x, x2: x, y1: 0, y2: opts.ih, class: 'chart-annotation-line' }));
  if (opts.label != null && opts.label !== '') {
    const txt = svgEl('text', {
      x: x + 3, y: 10, 'text-anchor': 'start', class: 'chart-annotation-label',
    });
    txt.textContent = String(opts.label);
    g.appendChild(txt);
  }
  return g;
}
