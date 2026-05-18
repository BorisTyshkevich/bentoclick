// bentoclick runtime — kpi-strip panel.
//
// Auto-flow row of measurables from a single one-row query. Each
// tile reads one field from the first result row and applies the
// tile's configured formatter. Loading state shows a skeleton block.

import { applyFormat } from '../core/fmt.js';

export function renderKpiStrip(panel, state, ctx) {
  const strip = document.createElement('div');
  strip.className = 'kpi-strip';
  const tileEls = (panel.tiles || []).map((t) => {
    const c = document.createElement('div');
    c.className = 'card kpi';
    if (t.accent) c.setAttribute('data-accent', t.accent);
    const v = document.createElement('div'); v.className = 'v loading skeleton';
    const l = document.createElement('div'); l.className = 'l';
    l.textContent = t.label || t.key;
    c.appendChild(v); c.appendChild(l);
    let n = null;
    if (t.note_key || t.note) {
      n = document.createElement('div');
      n.className = 'n';
      c.appendChild(n);
    }
    strip.appendChild(c);
    return { tile: t, v, n };
  });
  state.update = function (rows) {
    const row = rows[0] || {};
    tileEls.forEach((te) => {
      te.v.classList.remove('loading', 'skeleton');
      te.v.textContent = applyFormat(
        ctx.api, te.tile.format || 'raw', row[te.tile.key], te.tile.format_fn);
      if (te.n) {
        const raw = te.tile.note_key ? row[te.tile.note_key] : te.tile.note;
        te.n.textContent = applyFormat(
          ctx.api, te.tile.note_format || 'raw', raw, te.tile.note_format_fn);
      }
    });
  };
  return strip;
}
