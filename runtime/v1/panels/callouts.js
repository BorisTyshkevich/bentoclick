// bentoclick runtime — callouts panel.
//
// Narrative pinned to N rows of an anchor panel. Sibling to `hero`,
// which is single-row only. Reuses the same `{{key|fmt!}}` template
// grammar via renderTemplate from chart-helpers.

import { fmt } from '../core/fmt.js';
import { makeCard } from './_shared.js';
import { renderTemplate, subscribeAnchor } from './chart-helpers.js';

export function renderCallouts(panel, state, ctx) {
  const card = makeCard(panel, 'callouts-card');
  card.setAttribute('data-accent', panel.accent || 'primary');
  const list = document.createElement('div');
  list.className = 'callouts';
  card.appendChild(list);

  function selectRows(rows) {
    const sel = panel.rows == null ? 'all' : panel.rows;
    if (sel === 'all') return rows.slice();
    if (Array.isArray(sel)) {
      return sel.map((i) => rows[i]).filter((r) => r != null);
    }
    if (typeof sel === 'number' && isFinite(sel)) {
      return rows.slice(0, Math.max(0, Math.floor(sel)));
    }
    return rows.slice();
  }

  function tryRefresh() {
    const spec = ctx.spec;
    if (!spec || !spec.panels) { list.innerHTML = ''; return; }
    const anchor = spec.panels[panel.anchor];
    if (!anchor || !Array.isArray(anchor.rows) || !anchor.rows.length) {
      list.innerHTML = '<div style="color:var(--fg-dim);font-size:12px">(waiting for '
        + fmt.esc(panel.anchor || '?') + ')</div>';
      return;
    }
    list.innerHTML = '';
    selectRows(anchor.rows).forEach((r) => {
      const div = document.createElement('div');
      div.className = 'callout';
      div.innerHTML = renderTemplate(panel.template, r, ctx);
      list.appendChild(div);
    });
  }

  state.update = function () {
    tryRefresh();
    subscribeAnchor(state, panel, ctx, tryRefresh);
  };
  return card;
}
