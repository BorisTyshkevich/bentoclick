// bentoclick runtime — bars panel.
//
// Horizontal share bars rendered in the v2 design shape:
//   <div class="bc-bars" [data-multi]>
//     <div class="row-b">
//       <span class="lbl">label</span>
//       <div class="track"><div class="fill" style="width:N%[;--c:#hex]"></div></div>
//       <span class="val">formatted value</span>
//     </div>
//     ...
//   </div>
// CSS in dash-theme.css turns this into an 8px-track rail with a
// 100px label column and right-aligned value. `value_key` drives bar
// width and `label_key` is the row label. Per-row color comes from
// `color_key` (a hex value in the row) or `color_by` mapping to the
// chart palette; the `--c` custom property feeds the track fill via
// `.bc-bars[data-multi] .row-b .fill { background: var(--c) }`.

import { fmt, applyFormat } from '../core/fmt.js';
import { colorFor } from '../charts.js';
import { installCollapsibleChrome, shouldBeCollapsible } from './_shared.js';

export function renderBars(panel, state, ctx) {
  const card = document.createElement('div');
  card.className = 'card';
  if (panel.accent) card.setAttribute('data-accent', panel.accent);
  if (panel.title) {
    const h = document.createElement('h2');
    h.textContent = panel.title;
    card.appendChild(h);
  }
  if (panel.subtitle) {
    const p = document.createElement('p');
    p.className = 'ph-sub';
    p.style.cssText = 'margin:-8px 0 12px';
    p.textContent = panel.subtitle;
    card.appendChild(p);
  }
  const wrap = document.createElement('div');
  wrap.className = 'bc-bars';
  card.appendChild(wrap);

  // Skeleton — same row-b shape so the layout doesn't jump on load.
  let skel = '';
  for (let bi = 0; bi < 4; bi++) {
    const w = 60 + bi * 10;
    skel += '<div class="row-b">'
      + '<span class="lbl"><span class="skeleton" style="display:inline-block;height:10px;width:80%"></span></span>'
      + '<div class="track"><div class="fill skeleton" style="width:' + w + '%"></div></div>'
      + '<span class="val"><span class="skeleton" style="display:inline-block;height:10px;width:50%"></span></span>'
      + '</div>';
  }
  wrap.innerHTML = skel;

  const labelKey   = panel.label_key || 'label';
  const valueKey   = panel.value_key || 'value';
  const colorKey   = panel.color_key || null;   // row column carrying a CSS color
  const colorBy    = panel.color_by || null;    // row column whose value picks a palette slot
  const formatName = panel.format || 'num';
  const isMulti    = Boolean(colorKey || colorBy);

  if (isMulti) wrap.setAttribute('data-multi', '');

  let setRowCount = null;
  state.update = function (rows) {
    if (shouldBeCollapsible(panel, rows.length)) {
      if (!setRowCount) {
        setRowCount = installCollapsibleChrome(card, {
          startCollapsed: panel.state !== 'visible',
        });
      }
      setRowCount(rows.length);
    }
    if (!rows.length) {
      wrap.innerHTML = '<div style="color:var(--fg-dim);font-size:12px;padding:8px 0">'
        + fmt.esc(panel.empty_text || 'no data') + '</div>';
      return;
    }
    const max = Math.max(1, ...rows.map((r) => Number(r[valueKey]) || 0));
    wrap.innerHTML = rows.map((r) => {
      const v   = Number(r[valueKey]) || 0;
      const pct = (100 * v / max).toFixed(1);
      let style = 'width:' + pct + '%';
      if (colorKey && r[colorKey]) {
        style += ';--c:' + fmt.esc(String(r[colorKey]));
      } else if (colorBy && r[colorBy] != null) {
        style += ';--c:' + colorFor(String(r[colorBy]));
      }
      return '<div class="row-b">'
        + '<span class="lbl">' + fmt.esc(String(r[labelKey] == null ? '' : r[labelKey])) + '</span>'
        + '<div class="track"><div class="fill" style="' + style + '"></div></div>'
        + '<span class="val">' + applyFormat(ctx.api, formatName, v) + '</span>'
        + '</div>';
    }).join('');
  };
  return card;
}
