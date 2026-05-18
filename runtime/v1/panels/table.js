// bentoclick runtime — table panel.
//
// Sticky-header table with per-column formatters and optional
// threshold badges. Emits `<table class="bc-tbl">` so the v2 theme's
// modern table styling applies; the panels.css `table.bc-tbl`
// selector has no plain-`table` fallback.
//
// `panel.export !== false` adds a CSV download button at the
// bottom. Row click dispatches via wireOnClick when the spec is
// in scope.

import { fmt, applyFormat } from '../core/fmt.js';
import { pickBadgeClass } from '../core/badge.js';
import { triggerCsvDownload } from '../core/csv.js';
import { wireOnClick } from './_shared.js';

export function renderTable(panel, state, ctx) {
  const card = document.createElement('div');
  card.className = 'card';
  if (panel.accent) card.setAttribute('data-accent', panel.accent);
  if (panel.title) {
    const h = document.createElement('h2');
    h.textContent = panel.title;
    card.appendChild(h);
  }
  const tbl = document.createElement('table');
  tbl.className = 'bc-tbl';
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  (panel.columns || []).forEach((c) => {
    const th = document.createElement('th');
    if (c.align === 'right') th.className = 'right';
    th.textContent = c.label || c.key;
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  tbl.appendChild(thead);
  const tbody = document.createElement('tbody');
  const colCount = (panel.columns || []).length || 1;
  let skel = '';
  for (let sr = 0; sr < 3; sr++) {
    skel += '<tr>';
    for (let sc = 0; sc < colCount; sc++) {
      skel += '<td><span class="skeleton" style="display:inline-block;width:'
        + (sc === 0 ? 60 : 40 + (sc * 7) % 30)
        + '%;height:10px"></span></td>';
    }
    skel += '</tr>';
  }
  tbody.innerHTML = skel;
  tbl.appendChild(tbody);
  card.appendChild(tbl);

  if (panel.export !== false) {
    const actions = document.createElement('div');
    actions.className = 'table-actions';
    const btn = document.createElement('button');
    btn.className = 'btn-mini';
    btn.type = 'button';
    btn.textContent = 'Export CSV';
    btn.addEventListener('click', () => triggerCsvDownload(panel, state.rows || []));
    actions.appendChild(btn);
    card.appendChild(actions);
  }

  state.update = function (rows) {
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="' + colCount + '" style="color:var(--fg-dim)">'
        + fmt.esc(panel.empty_text || 'no data') + '</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((r, ri) => {
      return '<tr data-row-index="' + ri + '">' + (panel.columns || []).map((c) => {
        const raw = r[c.key];
        let cell = applyFormat(ctx.api, c.format || 'raw', raw, c.format_fn);
        const badgeCls = pickBadgeClass(c.badge, raw);
        if (badgeCls) {
          cell = '<span class="cell-badge cell-badge-' + fmt.esc(badgeCls) + '">'
            + cell + '</span>';
        }
        return '<td' + (c.align === 'right' ? ' class="right"' : '') + '>' + cell + '</td>';
      }).join('') + '</tr>';
    }).join('');
    // wireOnClick early-returns when on_click / spec / spec.setParam
    // are absent, so the iteration is cheap to run unconditionally.
    tbody.querySelectorAll('tr[data-row-index]').forEach((tr) => {
      const row = rows[Number(tr.getAttribute('data-row-index'))];
      if (row) wireOnClick(tr, panel, row, ctx);
    });
  };
  state.tbodyEl = tbody;
  return card;
}
