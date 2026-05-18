// bentoclick runtime — hero panel.
//
// Templated sentence anchored to another panel's first row. The
// hero card resubscribes to the anchor panel's `panel:loaded` event
// so it refreshes when the upstream data lands. Uses the same
// `{{key|fmt!}}` grammar as callouts.

import { fmt } from '../core/fmt.js';
import { renderTemplate, subscribeAnchor } from './chart-helpers.js';

export function renderHero(panel, state, ctx) {
  const card = document.createElement('div');
  card.className = 'card hero-card';
  card.setAttribute('data-accent', panel.accent || 'primary');
  // `data-narrative` is the hook for the tweaks "Narrative" toggle —
  // when the viewer turns narrative off, `tweaks.js` flips
  // `data-hidden-by-tweak` on every `[data-narrative]` element and
  // dash-theme.css collapses them out of layout. Hero panels are
  // narrative by definition.
  card.setAttribute('data-narrative', '');
  if (panel.title) {
    const h = document.createElement('h2');
    h.textContent = panel.title;
    card.appendChild(h);
  }
  const p = document.createElement('p');
  card.appendChild(p);

  function tryRefresh() {
    const spec = ctx.spec;
    if (!spec || !spec.panels) return;
    const anchor = spec.panels[panel.anchor];
    if (!anchor || !anchor.rows || !anchor.rows.length) {
      p.innerHTML = '<span style="color:var(--fg-dim)">(waiting for '
        + fmt.esc(panel.anchor || '?') + ')</span>';
      return;
    }
    p.innerHTML = renderTemplate(panel.template, anchor.rows[0], ctx);
  }

  state.update = function () {
    tryRefresh();
    subscribeAnchor(state, panel, ctx, tryRefresh);
  };
  return card;
}
