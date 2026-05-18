// bentoclick runtime — panel-shared scaffolding.
//
// `makeCard` builds the standard `.card` wrapper with optional
// title + accent border. Used by most renderers; legacy renderers
// inline the same DOM and are gradually converging on this helper.
//
// `wireOnClick` attaches the cross-panel filter behaviour to a
// click target. No-op when `ctx.spec.setParam` is missing (e.g.
// unit tests without a spec). Rejected values flash a brief red
// outline so the click registers visually even if the value falls
// outside the param's validator.

export function makeCard(panel, extraClass) {
  const card = document.createElement('div');
  card.className = 'card' + (extraClass ? ' ' + extraClass : '');
  if (panel.accent) card.setAttribute('data-accent', panel.accent);
  if (panel.title) {
    const h = document.createElement('h2');
    h.textContent = panel.title;
    card.appendChild(h);
  }
  return card;
}

// applyPanelState — sets `data-state` on the card root so the CSS
// in dash-theme.css can hide the body (collapsed) or the whole card
// (hidden). Renderers don't need to know about state; renderPanelShell
// calls this after the renderer returns its element.
export function applyPanelState(card, panel) {
  if (!card || !card.setAttribute) return;
  const raw = panel && panel.state;
  const explicit = raw === 'visible' || raw === 'collapsed' || raw === 'hidden';
  const defaulted = (panel && panel.type === 'dataset') ? 'hidden' : 'visible';
  card.setAttribute('data-state', explicit ? raw : defaulted);
}

// installCollapsibleChrome — adds the `.panel-collapsible` UX to a
// rendered panel card: a small chevron button (in the `.panel-head
// .ph-meta` slot when present, otherwise floated top-right on the
// card) and a full-width "Show all rows · N" / "Collapse" button at
// the bottom. Both triggers flip the `.collapsed` class on the card;
// CSS in dash-theme.css does the rest (max-height, gradient, hide
// actions).
//
// Returns a `setRowCount(n)` function the caller invokes on every
// state.update so the row-count chip text stays in sync.
//
// Idempotent: if the chrome is already on the card (e.g. state.update
// called a second time), the existing nodes are reused — only the
// row-count text refreshes.
export function installCollapsibleChrome(card, opts) {
  opts = opts || {};
  card.classList.add('panel-collapsible');
  if (opts.startCollapsed) card.classList.add('collapsed');
  const flip = () => card.classList.toggle('collapsed');

  let chev = card.querySelector('.ph-collapse');
  if (!chev) {
    chev = document.createElement('button');
    chev.type = 'button';
    chev.className = 'ph-collapse';
    chev.setAttribute('title', 'Toggle');
    chev.setAttribute('aria-label', 'Toggle panel');
    chev.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>';
    chev.addEventListener('click', flip);
    // Prefer the panel-head's .ph-meta slot when the renderer built
    // one — keeps the chevron sized/positioned with the other header
    // controls instead of floating absolutely over the card edge.
    const phMeta = card.querySelector(':scope > .panel-head .ph-meta');
    if (phMeta) phMeta.insertBefore(chev, phMeta.firstChild);
    else card.appendChild(chev);
  }

  let toggle = card.querySelector(':scope > .panel-toggle');
  let countEl;
  if (!toggle) {
    toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'panel-toggle';
    toggle.innerHTML =
      '<span class="when-collapsed">'
      + '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>'
      + 'Show all rows'
      + '<span class="row-count">0</span>'
      + '</span>'
      + '<span class="when-expanded">'
      + '<svg viewBox="0 0 24 24" style="transform:rotate(180deg)"><path d="M6 9l6 6 6-6"/></svg>'
      + 'Collapse'
      + '</span>';
    toggle.addEventListener('click', flip);
    card.appendChild(toggle);
  }
  countEl = toggle.querySelector('.row-count');

  return function setRowCount(n) {
    if (countEl) countEl.textContent = String(n);
  };
}

// Resolve the collapsible decision for a visual panel. Used by
// table.js and bars.js so the rule lives in one place.
//   - explicit `collapsible: true`  → always
//   - explicit `collapsible: false` → never (even at high row count)
//   - omitted                       → auto when rows.length ≥ 50
export function shouldBeCollapsible(panel, rowCount) {
  if (panel.collapsible === true) return true;
  if (panel.collapsible === false) return false;
  return rowCount >= 50;
}

export function wireOnClick(target, panel, row, ctx) {
  const oc = panel.on_click;
  if (!oc || !oc.set_param || !ctx || !ctx.spec || !ctx.spec.setParam) return;
  const fromKey = oc.from || oc.set_param;
  if (!(fromKey in row)) return;
  target.classList.add('chart-clickable');
  target.style.cursor = 'pointer';
  target.addEventListener('click', () => {
    if (ctx.spec.setParam(oc.set_param, row[fromKey])) return;
    target.classList.add('chart-click-rejected');
    setTimeout(() => target.classList.remove('chart-click-rejected'), 400);
  });
}
