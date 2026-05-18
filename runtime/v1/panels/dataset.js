// bentoclick runtime — dataset panel.
//
// A dataset panel runs SQL, exposes its rows as `state.rows` for
// consumers that reference it via `source`, and (when not hidden)
// renders a preview table of its own rows so authors can inspect the
// raw feed behind their derived panels.
//
//   state: "hidden"    → zero-height placeholder. Default.
//   state: "collapsed" → title + meta + first ~5 rows behind a fade,
//                        with a "Show all rows · N" CTA. Default chrome
//                        when an author opts the dataset into being
//                        visible-for-debug.
//   state: "visible"   → title + meta + full table, Collapse CTA.
//
// The runtime's `_runPanel` populates `state.rows` and calls
// `state.update(rows)`; the renderer derives columns from the first
// row's keys and refreshes thead + tbody on each update.

import { fmt } from '../core/fmt.js';
import { installCollapsibleChrome } from './_shared.js';

export function renderDataset(panel, state) {
  const isHidden = panel.state !== 'visible' && panel.state !== 'collapsed';
  if (isHidden) {
    const placeholder = document.createElement('div');
    placeholder.className = 'card dataset-placeholder';
    placeholder.style.cssText = 'display:none';
    state.update = function () {};
    return placeholder;
  }
  const card = document.createElement('div');
  card.className = 'card dataset';
  if (panel.title) {
    const h = document.createElement('h2');
    h.textContent = panel.title;
    card.appendChild(h);
  }
  const meta = document.createElement('div');
  meta.className = 'dataset-meta';
  meta.style.cssText = 'font-size:12px;color:var(--fg-dim);display:flex;gap:12px;margin-bottom:8px';
  const idTag = document.createElement('span');
  idTag.textContent = 'id: ' + (panel.id || '');
  const countTag = document.createElement('span');
  countTag.className = 'dataset-rows';
  countTag.textContent = 'rows: —';
  meta.appendChild(idTag);
  meta.appendChild(countTag);
  card.appendChild(meta);

  // The preview table renders inside `.tbl-wrap` so the panel-
  // collapsible gradient + max-height anchor to it the same way they
  // do for the table panel.
  const tblWrap = document.createElement('div');
  tblWrap.className = 'tbl-wrap';
  const tbl = document.createElement('table');
  tbl.className = 'bc-tbl';
  const thead = document.createElement('thead');
  const tbody = document.createElement('tbody');
  tbl.appendChild(thead);
  tbl.appendChild(tbody);
  tblWrap.appendChild(tbl);
  card.appendChild(tblWrap);

  const setRowCount = installCollapsibleChrome(card, {
    startCollapsed: panel.state !== 'visible',
  });

  state.update = function (rows) {
    const n = rows ? rows.length : 0;
    countTag.textContent = 'rows: ' + n;
    setRowCount(n);
    if (!n) {
      thead.innerHTML = '';
      tbody.innerHTML = '<tr><td style="color:var(--fg-dim)">no rows</td></tr>';
      return;
    }
    const cols = Object.keys(rows[0]);
    thead.innerHTML = '<tr>' + cols.map((c) =>
      '<th>' + fmt.esc(c) + '</th>'
    ).join('') + '</tr>';
    tbody.innerHTML = rows.map((r) =>
      '<tr>' + cols.map((c) => {
        const v = r[c];
        return '<td>' + fmt.esc(v == null ? '' : String(v)) + '</td>';
      }).join('') + '</tr>'
    ).join('');
  };
  return card;
}
