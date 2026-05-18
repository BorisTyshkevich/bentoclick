// bentoclick runtime — table panel.
//
// Renders the v2 design's table panel shape: a chromeless card
// (`panel-shell`) wrapping a `.panel-head` header (title + optional
// subtitle + ph-meta with row-count stamp + CSV icon button) and a
// `.panel-body.nopad` containing the `.tbl-wrap > <table.bc-tbl>`.
// Sticky-header table with per-column formatters and optional
// threshold badges. Row click dispatches via wireOnClick.
//
// Authoring fields (all optional):
//   - `subtitle` → renders as `<p class="ph-sub">`.
//   - `export !== false` → CSV icon-btn in the header meta.
//   - `collapsible` → see `_shared.installCollapsibleChrome`.
//   - column `mono: true` / `strong: true` / `dim: true` map to
//     `.cell-mono` / `.cell-strong` / `.cell-dim` on the cell.

import { fmt, applyFormat } from '../core/fmt.js';
import { pickBadgeClass } from '../core/badge.js';
import { triggerCsvDownload } from '../core/csv.js';
import { wireOnClick, installCollapsibleChrome, shouldBeCollapsible } from './_shared.js';

const CSV_ICON_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true">'
  + '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>'
  + '</svg>';

export function renderTable(panel, state, ctx) {
  const card = document.createElement('div');
  card.className = 'card panel-shell';
  if (panel.accent) card.setAttribute('data-accent', panel.accent);

  // ── Header ──────────────────────────────────────────────────────
  const head = document.createElement('div');
  head.className = 'panel-head';
  const titleWrap = document.createElement('div');
  if (panel.title) {
    const h = document.createElement('h2');
    h.className = 'ph-title';
    h.textContent = panel.title;
    titleWrap.appendChild(h);
  }
  if (panel.subtitle) {
    const sub = document.createElement('p');
    sub.className = 'ph-sub';
    sub.textContent = panel.subtitle;
    titleWrap.appendChild(sub);
  }
  head.appendChild(titleWrap);
  const meta = document.createElement('div');
  meta.className = 'ph-meta';
  const stamp = document.createElement('span');
  stamp.className = 'ph-stamp';
  stamp.textContent = '—';
  meta.appendChild(stamp);
  // The chevron (when collapsible installs) lands between the stamp
  // and the CSV button via installCollapsibleChrome's .ph-meta probe.
  if (panel.export !== false) {
    const csvBtn = document.createElement('button');
    csvBtn.type = 'button';
    csvBtn.className = 'icon-btn';
    csvBtn.title = 'Export CSV';
    csvBtn.setAttribute('aria-label', 'Export CSV');
    csvBtn.innerHTML = CSV_ICON_SVG;
    csvBtn.addEventListener('click', () => triggerCsvDownload(panel, state.rows || []));
    meta.appendChild(csvBtn);
  }
  head.appendChild(meta);
  card.appendChild(head);

  // ── Body ────────────────────────────────────────────────────────
  const body = document.createElement('div');
  body.className = 'panel-body nopad';
  const tblWrap = document.createElement('div');
  tblWrap.className = 'tbl-wrap';
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
  tblWrap.appendChild(tbl);
  body.appendChild(tblWrap);
  card.appendChild(body);

  let setRowCount = null;
  state.update = function (rows) {
    stamp.textContent = rows.length + (rows.length === 1 ? ' row' : ' rows');
    if (shouldBeCollapsible(panel, rows.length)) {
      if (!setRowCount) {
        setRowCount = installCollapsibleChrome(card, {
          startCollapsed: panel.state !== 'visible',
        });
      }
      setRowCount(rows.length);
    }
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
        const tdClasses = [];
        if (c.align === 'right') tdClasses.push('right');
        if (c.mono)   tdClasses.push('cell-mono');
        if (c.strong) tdClasses.push('cell-strong');
        if (c.dim)    tdClasses.push('cell-dim');
        const clsAttr = tdClasses.length ? ' class="' + tdClasses.join(' ') + '"' : '';
        return '<td' + clsAttr + '>' + cell + '</td>';
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
