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

// Gear icon SVG used by the FAB. From the design handoff
// (Panels.html) — single path matching the lucide "settings" glyph.
const GEAR_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="3"/>' +
  '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' +
  '</svg>';

// Build the FAB + collapsible panel pair from the design handoff
// (claude.ai/design, project Panels.html). The panel starts hidden;
// clicking the FAB opens it, the close button or Escape closes it,
// pressing T anywhere on the page opens it. Returns the panel
// element (so callers / tests can poke at .swatch / .seg buttons
// directly); the FAB lives at root.dataset.fab via a sibling.
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

  // FAB — closed state. Replaced by panel on click.
  const fab = doc.createElement('button');
  fab.type = 'button';
  fab.className = 'tweaks-fab';
  fab.setAttribute('aria-label', 'Open tweaks');
  fab.setAttribute('title', 'Tweaks');
  fab.innerHTML = GEAR_SVG + '<span class="kbd">Press T</span>';

  // Panel — open state. Hidden until the FAB is clicked. Narrative
  // is a checkbox to match the design; toggling it writes "on"/"off"
  // to localStorage. Until panels emit [data-narrative] the toggle
  // has no visible effect, but the plumbing is here and tested.
  const panel = doc.createElement('div');
  panel.className = 'tweaks';
  panel.setAttribute('aria-label', 'Display tweaks');
  panel.hidden = true;
  panel.innerHTML =
    '<div class="tw-head">' +
      '<span class="t">Tweaks</span>' +
      '<button type="button" class="tw-close" aria-label="Close" title="Close (Esc)">×</button>' +
    '</div>' +
    '<div class="tw-row"><span class="l">Accent</span>' +
      '<div class="swatches">' +
        ACCENTS.map((a) =>
          '<span class="swatch" data-accent="' + a +
          '" style="background:' + ACCENT_COLORS[a] + '" title="' + a + '"></span>'
        ).join('') +
      '</div></div>' +
    '<div class="tw-row"><span class="l">Theme</span>' +
      '<div class="seg">' +
        '<button type="button" data-key="theme" data-val="dark">Dark</button>' +
        '<button type="button" data-key="theme" data-val="light">Light</button>' +
      '</div></div>' +
    '<div class="tw-row"><span class="l">Density</span>' +
      '<div class="seg">' +
        '<button type="button" data-key="density" data-val="comfortable">Comfy</button>' +
        '<button type="button" data-key="density" data-val="dense">Dense</button>' +
      '</div></div>' +
    '<div class="tw-row"><span class="l">Narrative</span>' +
      '<input type="checkbox" class="tw-narrative" style="accent-color:var(--accent)">' +
    '</div>';

  function refreshSelections() {
    panel.querySelectorAll('.swatch').forEach((sw) => {
      sw.classList.toggle('on', sw.getAttribute('data-accent') === prefs.accent);
    });
    panel.querySelectorAll('.seg button').forEach((b) => {
      const k = b.getAttribute('data-key');
      const v = b.getAttribute('data-val');
      b.classList.toggle('on', prefs[k] === v);
    });
    const nt = panel.querySelector('.tw-narrative');
    if (nt) nt.checked = (prefs.narrative !== 'off');
  }

  function emitChange() { if (onChange) onChange(Object.assign({}, prefs)); }

  function openPanel()  { panel.hidden = false; fab.style.display = 'none'; }
  function closePanel() { panel.hidden = true;  fab.style.display = ''; }

  fab.addEventListener('click', openPanel);

  panel.addEventListener('click', (ev) => {
    if (ev.target.closest('.tw-close')) { closePanel(); return; }
    const sw = ev.target.closest && ev.target.closest('.swatch');
    if (sw) {
      const a = sw.getAttribute('data-accent');
      if (a) {
        prefs.accent = a;
        writePref('accent', a, storage);
        applyToRoot(doc.documentElement, prefs);
        refreshSelections();
        emitChange();
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
        emitChange();
      }
    }
  });

  panel.addEventListener('change', (ev) => {
    if (ev.target.classList && ev.target.classList.contains('tw-narrative')) {
      prefs.narrative = ev.target.checked ? 'on' : 'off';
      writePref('narrative', prefs.narrative, storage);
      applyToRoot(doc.documentElement, prefs);
      emitChange();
    }
  });

  // Keyboard: Escape closes (when open), T opens (when closed).
  // Bail when the user is typing in an input/textarea so the
  // shortcut doesn't steal keystrokes.
  doc.addEventListener('keydown', (ev) => {
    const tag = ev.target && ev.target.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || (ev.target && ev.target.isContentEditable);
    if (ev.key === 'Escape' && !panel.hidden) { closePanel(); return; }
    if ((ev.key === 't' || ev.key === 'T') && panel.hidden && !typing && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      openPanel();
    }
  });

  refreshSelections();
  if (doc.body) { doc.body.appendChild(fab); doc.body.appendChild(panel); }
  return panel;
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
