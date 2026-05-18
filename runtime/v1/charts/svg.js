// bentoclick runtime — SVG element builders + axes.
//
// All return DOM nodes via `document.createElementNS(SVG_NS, ...)`.
// `svgRoot({width, height, padding})` is the entry: builds an SVG
// with a translated <g> ready for content; renders responsive via
// viewBox + width:100%, capped by CSS `max-width` on `.chart-svg`.

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgEl(name, attrs) {
  const e = document.createElementNS(SVG_NS, name);
  if (attrs) {
    for (const k in attrs) {
      if (attrs[k] != null) e.setAttribute(k, String(attrs[k]));
    }
  }
  return e;
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

// svgRoot({width, height, padding}) → { svg, plot, w, h, pad, iw, ih }
// where `plot` is a translated <g> for content drawn within the inner
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

// Horizontal axis along the bottom of the plot area. `ticks` are the
// values to label; `scale` maps value -> x; `format` is called for
// each tick label.
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
