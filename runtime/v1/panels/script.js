// bentoclick runtime — script panel.
//
// JS escape hatch. Mounts `html` as the DOM shell, then executes
// `script` inside an async wrapper with access to DASH.* (the
// public API global). Wraps in try/catch so a thrown error appears
// in the panel slot and doesn't break siblings.
//
// v1 trust model: ANY authenticated viewer who can load the
// dashboard executes the JS. The sandboxed iframe limits blast
// radius. A future ACL would gate by author.

export function renderScript(panel, state, ctx) {
  const card = document.createElement('div');
  card.className = 'card script-panel';
  if (panel.accent) card.setAttribute('data-accent', panel.accent);
  if (panel.title) {
    const h = document.createElement('h2');
    h.textContent = panel.title;
    card.appendChild(h);
  }
  card.insertAdjacentHTML('beforeend', String(panel.html || ''));

  state.update = async function () {
    if (state._scriptRan) return;
    state._scriptRan = true;
    try {
      // Build an async function from the panel's script body. The
      // function has access to DASH (the public API global) so it can
      // call DASH.spec.fetch, DASH.spec.panels, etc.
      // eslint-disable-next-line no-new-func
      const fn = new Function('DASH', 'panel', 'state',
        '"use strict";\nreturn (async () => {\n' + String(panel.script || '') + '\n})();');
      await fn(ctx.api, panel, state);
    } catch (e) {
      const err = document.createElement('p');
      err.style.cssText = 'color:var(--error);font-size:12px';
      err.textContent = 'Script error: ' + ((e && e.message) || String(e));
      card.appendChild(err);
    }
  };
  return card;
}
