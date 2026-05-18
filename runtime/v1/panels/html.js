// bentoclick runtime — html panel.
//
// Static markup with optional template binding to a query result.
// The html string is rendered into the card body; if `template`
// (in lieu of `html`) is set, `{{rows[N].field}}` placeholders are
// replaced after each query reload.
//
// IMPORTANT: html is set via innerHTML. The sanitize_panel MV
// (server side) is the security boundary. Don't trust panels read
// from localStorage or from sources that bypass the MV.

import { fmt } from '../core/fmt.js';

export function renderHtml(panel, state) {
  const card = document.createElement('div');
  card.className = 'card';
  if (panel.accent) card.setAttribute('data-accent', panel.accent);
  if (panel.title) {
    const h = document.createElement('h2');
    h.textContent = panel.title;
    card.appendChild(h);
  }
  const body = document.createElement('div');
  body.className = 'dash-html-body';
  card.appendChild(body);

  function renderTemplate(rows) {
    const tpl = String(panel.template || panel.html || '');
    if (!panel.template) return tpl;
    return tpl.replace(/\{\{\s*rows\[(\d+)\]\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,
      (_m, idx, key) => {
        const row = rows[+idx];
        if (!row) return '';
        return fmt.esc(row[key]);
      });
  }

  if (!panel.query) {
    // Static: render once from `html` field.
    body.innerHTML = String(panel.html || '');
    state.update = function () {};
  } else {
    // Templated: re-render each time the query reloads.
    body.innerHTML = '<span class="skeleton" style="height:14px;width:60%"></span>';
    state.update = function (rows) {
      body.innerHTML = renderTemplate(rows || []);
    };
  }
  return card;
}
