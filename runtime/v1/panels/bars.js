// bentoclick runtime — bars panel.
//
// Horizontal share bars. Each row becomes a flex grid of
// label / proportional fill / formatted value. Lightweight visual
// for "top-N share" queries that don't need the full chart panel.

import { fmt, applyFormat } from '../core/fmt.js';

export function renderBars(panel, state, ctx) {
  const card = document.createElement('div');
  card.className = 'card';
  if (panel.accent) card.setAttribute('data-accent', panel.accent);
  if (panel.title) {
    const h = document.createElement('h2');
    h.textContent = panel.title;
    card.appendChild(h);
  }
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
  card.appendChild(wrap);
  let skel = '';
  for (let bi = 0; bi < 4; bi++) {
    skel += '<div style="display:grid;grid-template-columns:120px 1fr 100px;gap:8px;align-items:center">'
      + '<span class="skeleton" style="height:10px;width:80%"></span>'
      + '<span class="skeleton" style="height:10px;width:' + (60 + bi * 10) + '%"></span>'
      + '<span class="skeleton" style="height:10px;width:50%"></span>'
      + '</div>';
  }
  wrap.innerHTML = skel;

  const labelKey = panel.label_key || 'label';
  const valueKey = panel.value_key || 'value';
  const formatName = panel.format || 'num';

  state.update = function (rows) {
    if (!rows.length) {
      wrap.innerHTML = '<div style="color:var(--fg-dim)">'
        + fmt.esc(panel.empty_text || 'no data') + '</div>';
      return;
    }
    const max = Math.max(1, ...rows.map((r) => Number(r[valueKey]) || 0));
    wrap.innerHTML = rows.map((r) => {
      const v = Number(r[valueKey]) || 0;
      const pctW = (100 * v / max).toFixed(1);
      return '<div style="display:grid;grid-template-columns:120px 1fr 100px;gap:8px;align-items:center;font-size:12px">'
        + '<span>' + fmt.esc(r[labelKey]) + '</span>'
        + '<div class="bar-bg"><div class="bar-fill" style="width:' + pctW + '%"></div></div>'
        + '<span style="text-align:right">' + applyFormat(ctx.api, formatName, v) + '</span>'
        + '</div>';
    }).join('');
  };
  return card;
}
