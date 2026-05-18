// bentoclick runtime — scale builders.
//
// All three return functions of `(value) -> coord`:
//   - `linearScale([d0,d1], [r0,r1])` — affine map, midpoint
//     fallback when domain collapses to a point so a single-point
//     chart doesn't go NaN.
//   - `bandScale(values, [r0,r1], paddingInner=0.2)` — discrete
//     positions for categorical axes; exposes `.bandwidth` for bar
//     widths.
//   - `niceTicks(min, max, target=5)` — round-number tick array
//     spanning the range with roughly `target` ticks.

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
