// bentoclick runtime — markdown panel.
//
// Static prose, no query. Rendered through the minimal markdown
// pass from core/markdown.js (backtick code, [text](url) links,
// **bold**, *italic*, headings, lists). Input is HTML-escaped
// before the markdown pass.

import { renderTinyMarkdown } from '../core/markdown.js';

export function renderMarkdown(panel, state) {
  const card = document.createElement('div');
  card.className = 'card';
  if (panel.accent) card.setAttribute('data-accent', panel.accent);
  if (panel.title) {
    const h = document.createElement('h2');
    h.textContent = panel.title;
    card.appendChild(h);
  }
  const body = document.createElement('div');
  body.style.cssText = 'font-size:13px;line-height:1.5';
  body.innerHTML = renderTinyMarkdown(panel.text || '');
  card.appendChild(body);
  state.update = function () {};
  return card;
}
