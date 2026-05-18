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
