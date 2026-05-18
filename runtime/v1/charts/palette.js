// bentoclick runtime — chart color palette + stable per-key mapping.
//
// 8-color ordinal palette chosen for high contrast on the dark
// theme. Not tied to --accent CSS vars: SVG paint inheritance
// through `currentColor` is too blunt when we need stable
// color-per-key across panels.

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

// Stable hash → chartPalette index. Pure FNV-1a-ish over the string
// form so the same `value` always picks the same color across
// renders and across panels.
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
