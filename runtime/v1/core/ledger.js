// bentoclick runtime — query ledger.
//
// `createLedger()` returns an object that tracks the status of each
// panel's query (Pending → OK / Failed) and renders into a sticky
// table at the top of the dashboard. Click a row to expand the SQL.
// The `script` panel's `DASH.ledger` API surfaces add() / up() to
// authors who need to thread custom queries into the same display.

import { fmt } from './fmt.js';

export function createLedger() {
  const items = {};
  const order = [];
  let mountEl = null;

  function render() {
    if (!mountEl) return;
    mountEl.innerHTML = order.map((id, i) => {
      const d = items[id];
      if (!d) return '';
      const cls = d.status === 'OK' ? 'led-ok'
        : d.status === 'Failed' ? 'led-fail'
        : 'led-pend';
      const arrow = d.sql ? '<span class="ledger-toggle">▸</span> ' : '';
      const summary = '<tr data-led-i="' + i + '" style="cursor:'
        + (d.sql ? 'pointer' : 'default') + '">'
        + '<td>' + arrow + fmt.esc(d.label) + '</td>'
        + '<td class="' + cls + '">' + fmt.esc(d.status) + '</td>'
        + '<td>' + fmt.esc(String(d.rows)) + '</td></tr>';
      const sql = d.sql
        ? '<tr class="ledger-row-sql" data-led-i="' + i + '"><td colspan="3"><pre>'
          + fmt.esc(d.sql) + '</pre></td></tr>'
        : '';
      return summary + sql;
    }).join('');
    mountEl.querySelectorAll('tr[data-led-i]:not(.ledger-row-sql)').forEach((tr) => {
      tr.addEventListener('click', () => {
        const idx = tr.getAttribute('data-led-i');
        const sqlRow = mountEl.querySelector(
          'tr.ledger-row-sql[data-led-i="' + idx + '"]');
        const toggle = tr.querySelector('.ledger-toggle');
        if (sqlRow) {
          const open = sqlRow.classList.toggle('open');
          if (toggle) toggle.classList.toggle('open', open);
        }
      });
    });
  }

  return {
    mount(el) { mountEl = el; render(); },
    add(id, label, role) {
      if (!items[id]) order.push(id);
      items[id] = {
        label: label || id,
        role: role || 'primary',
        status: 'Pending',
        rows: '—',
        sql: '',
      };
      render();
    },
    up(id, status, rows, sql) {
      const it = items[id];
      if (!it) return;
      if (status !== undefined) it.status = status;
      if (rows !== undefined) it.rows = rows;
      if (sql !== undefined) it.sql = sql;
      render();
    },
    // Test-facing: read raw state.
    _items: () => items,
    _order: () => order.slice(),
  };
}
