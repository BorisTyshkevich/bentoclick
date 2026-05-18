// bentoclick runtime — tweaks panel.
//
// Floating bottom-right panel that lets viewers swap accent / theme /
// density / narrative visibility live. Reads + writes localStorage
// keys (`bc-accent`, `bc-theme`, `bc-density`, `bc-narrative`) so the
// preference survives reloads. Applies `data-accent` /
// `data-theme` / `data-density` attributes on <html> at the parent
// SPA shell, and posts `{type:"tokens", data:{…}}` into the
// sandboxed dashboard iframe so the iframe re-applies the same
// attributes on its own <html>.
//
// Exported as named functions so vitest can import without a DOM
// boot. mount() requires a document — it's a no-op-safe wrapper if
// the host page hasn't loaded its body yet (lazy attach on
// DOMContentLoaded).

const KEYS = {
  accent:    'bc-accent',
  theme:     'bc-theme',
  density:   'bc-density',
  narrative: 'bc-narrative',
};

const DEFAULTS = {
  accent:    'teal',          // teal | violet | amber | rose | sky
  theme:     'dark',          // dark | light
  density:   'comfortable',   // comfortable | dense
  narrative: 'on',            // on | off
};

const ACCENTS = ['teal', 'violet', 'amber', 'rose', 'sky'];
const ACCENT_COLORS = {
  teal:   '#2dd4bf',
  violet: '#a78bfa',
  amber:  '#fbbf24',
  rose:   '#fb7185',
  sky:    '#60a5fa',
};

function safeStorage() {
  try { localStorage.getItem('__probe__'); return localStorage; }
  catch (_) {
    const mem = {};
    return {
      getItem(k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      setItem(k, v) { mem[k] = String(v); },
      removeItem(k) { delete mem[k]; },
    };
  }
}

export function readPrefs(storage) {
  const s = storage || safeStorage();
  const out = {};
  for (const k in KEYS) {
    const v = s.getItem(KEYS[k]);
    out[k] = (v == null || v === '') ? DEFAULTS[k] : v;
  }
  if (!ACCENTS.includes(out.accent)) out.accent = DEFAULTS.accent;
  if (out.theme !== 'light' && out.theme !== 'dark') out.theme = DEFAULTS.theme;
  if (out.density !== 'dense' && out.density !== 'comfortable') out.density = DEFAULTS.density;
  if (out.narrative !== 'on' && out.narrative !== 'off') out.narrative = DEFAULTS.narrative;
  return out;
}

export function writePref(key, value, storage) {
  const s = storage || safeStorage();
  if (!Object.prototype.hasOwnProperty.call(KEYS, key)) return;
  s.setItem(KEYS[key], String(value));
}

// Apply prefs to a document root (toggling data-* attributes on
// <html>). Exported for symmetry with the iframe-side listener.
export function applyToRoot(root, prefs) {
  if (!root) return;
  if (prefs.accent && prefs.accent !== DEFAULTS.accent) root.setAttribute('data-accent', prefs.accent);
  else root.removeAttribute('data-accent');
  if (prefs.theme === 'light') root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');
  if (prefs.density === 'dense') root.setAttribute('data-density', 'dense');
  else root.removeAttribute('data-density');
  // Narrative is per-element: panels marked [data-narrative] get
  // [data-hidden-by-tweak] when narrative is "off".
  const hide = (prefs.narrative === 'off');
  const els = root.ownerDocument ? root.ownerDocument.querySelectorAll('[data-narrative]')
            : (root.querySelectorAll ? root.querySelectorAll('[data-narrative]') : []);
  els.forEach((el) => {
    if (hide) el.setAttribute('data-hidden-by-tweak', '');
    else el.removeAttribute('data-hidden-by-tweak');
  });
}

// Build the floating UI. Returns the root element (already appended
// to document.body if a body exists). Callers wire onChange to react
// to user input — typical use: postMessage the prefs into the
// dashboard iframe.
export function mount(opts) {
  const o = opts || {};
  // Explicit `null` is a "no document available" signal (e.g. SSR
  // probes); undefined falls back to the ambient `document`.
  const doc = ('document' in o) ? o.document
            : (typeof document !== 'undefined' ? document : null);
  if (!doc) return null;
  const storage = o.storage || safeStorage();
  const prefs = readPrefs(storage);
  const onChange = typeof o.onChange === 'function' ? o.onChange : null;
  applyToRoot(doc.documentElement, prefs);

  const root = doc.createElement('div');
  root.className = 'tweaks';
  root.setAttribute('aria-label', 'Display tweaks');
  root.innerHTML =
    '<div class="tw-head"><span class="t">Tweaks</span></div>' +
    '<div class="tw-row"><span class="l">Accent</span>' +
      '<div class="swatches">' +
        ACCENTS.map((a) =>
          '<span class="swatch" data-accent="' + a +
          '" style="background:' + ACCENT_COLORS[a] + '" title="' + a + '"></span>'
        ).join('') +
      '</div></div>' +
    '<div class="tw-row"><span class="l">Theme</span>' +
      '<span class="seg">' +
        '<button type="button" data-key="theme" data-val="dark">Dark</button>' +
        '<button type="button" data-key="theme" data-val="light">Light</button>' +
      '</span></div>' +
    '<div class="tw-row"><span class="l">Density</span>' +
      '<span class="seg">' +
        '<button type="button" data-key="density" data-val="comfortable">Cozy</button>' +
        '<button type="button" data-key="density" data-val="dense">Dense</button>' +
      '</span></div>';
  // Narrative show/hide is plumbed end-to-end (storage → applyToRoot
  // → iframe postMessage), but no Phase-1 panel renderer emits the
  // [data-narrative] attribute yet — surfacing the toggle would be a
  // no-op and confusing UI. The control returns in Phase 2 when
  // `hero` / `callouts` and the new narrative-shaped panels opt in.
  // applyMessage / applyToRoot still honor a `narrative:"off"`
  // payload for manual testing via localStorage.

  function refreshSelections() {
    root.querySelectorAll('.swatch').forEach((sw) => {
      sw.classList.toggle('on', sw.getAttribute('data-accent') === prefs.accent);
    });
    root.querySelectorAll('.seg button').forEach((b) => {
      const k = b.getAttribute('data-key');
      const v = b.getAttribute('data-val');
      b.classList.toggle('on', prefs[k] === v);
    });
  }

  root.addEventListener('click', (ev) => {
    const sw = ev.target.closest && ev.target.closest('.swatch');
    if (sw) {
      const a = sw.getAttribute('data-accent');
      if (a) {
        prefs.accent = a;
        writePref('accent', a, storage);
        applyToRoot(doc.documentElement, prefs);
        refreshSelections();
        if (onChange) onChange(Object.assign({}, prefs));
      }
      return;
    }
    const btn = ev.target.closest && ev.target.closest('.seg button');
    if (btn) {
      const k = btn.getAttribute('data-key');
      const v = btn.getAttribute('data-val');
      if (k && v) {
        prefs[k] = v;
        writePref(k, v, storage);
        applyToRoot(doc.documentElement, prefs);
        refreshSelections();
        if (onChange) onChange(Object.assign({}, prefs));
      }
    }
  });

  refreshSelections();
  if (doc.body) doc.body.appendChild(root);
  return root;
}

// Convenience: the iframe-side listener. Called from the boot script
// inside the sandboxed iframe to react to `{type:"tokens"}` messages
// from the parent.
export function applyMessage(doc, data) {
  if (!doc || !data || typeof data !== 'object') return;
  applyToRoot(doc.documentElement, {
    accent:    data.accent    || DEFAULTS.accent,
    theme:     data.theme     || DEFAULTS.theme,
    density:   data.density   || DEFAULTS.density,
    narrative: data.narrative || DEFAULTS.narrative,
  });
}
