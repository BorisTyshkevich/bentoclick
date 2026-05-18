import { describe, it, expect, beforeEach } from 'vitest';
import { readPrefs, writePref, applyToRoot, applyMessage, mount } from '../../../runtime/v1/tweaks.js';

function memStore() {
  const m = {};
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
    setItem(k, v) { m[k] = String(v); },
    removeItem(k) { delete m[k]; },
    _raw: m,
  };
}

describe('tweaks.readPrefs', () => {
  it('returns defaults when storage is empty', () => {
    const p = readPrefs(memStore());
    expect(p).toEqual({ accent: 'teal', theme: 'dark', density: 'comfortable', narrative: 'on' });
  });

  it('falls back to an in-memory store when localStorage throws', () => {
    // Replicates the sandbox-without-same-origin iframe environment
    // where every localStorage access raises SecurityError.
    const orig = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new Error('SecurityError'); },
    });
    try {
      // No `storage` arg → tweaks.safeStorage() is invoked, hits the catch.
      const p = readPrefs();
      expect(p).toEqual({ accent: 'teal', theme: 'dark', density: 'comfortable', narrative: 'on' });
      // writePref + readPrefs through the same in-memory fallback round-trip.
      writePref('accent', 'amber');
      // Each call creates its own mem store; the round-trip behaviour we
      // care about is just that neither call throws.
      expect(() => writePref('theme', 'light')).not.toThrow();
    } finally {
      if (orig) Object.defineProperty(globalThis, 'localStorage', orig);
      else delete globalThis.localStorage;
    }
  });

  it('returns stored values when present', () => {
    const s = memStore();
    s.setItem('bc-accent', 'violet');
    s.setItem('bc-theme', 'light');
    s.setItem('bc-density', 'dense');
    s.setItem('bc-narrative', 'off');
    expect(readPrefs(s)).toEqual({
      accent: 'violet', theme: 'light', density: 'dense', narrative: 'off',
    });
  });

  it('rejects values outside the allowed set', () => {
    const s = memStore();
    s.setItem('bc-accent', 'evil');
    s.setItem('bc-theme', 'glow');
    s.setItem('bc-density', 'sparse');
    s.setItem('bc-narrative', 'maybe');
    expect(readPrefs(s)).toEqual({
      accent: 'teal', theme: 'dark', density: 'comfortable', narrative: 'on',
    });
  });
});

describe('tweaks.writePref', () => {
  it('persists to storage by canonical key', () => {
    const s = memStore();
    writePref('accent', 'amber', s);
    writePref('theme', 'light', s);
    expect(s.getItem('bc-accent')).toBe('amber');
    expect(s.getItem('bc-theme')).toBe('light');
  });

  it('ignores unknown keys (defense against caller typos)', () => {
    const s = memStore();
    writePref('color', 'pink', s);
    expect(s.getItem('bc-color')).toBeNull();
  });
});

describe('tweaks.applyToRoot', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-accent');
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-density');
    document.body.innerHTML = '';
  });

  it('sets data-accent only when non-default', () => {
    applyToRoot(document.documentElement, { accent: 'violet', theme: 'dark', density: 'comfortable', narrative: 'on' });
    expect(document.documentElement.getAttribute('data-accent')).toBe('violet');
    applyToRoot(document.documentElement, { accent: 'teal', theme: 'dark', density: 'comfortable', narrative: 'on' });
    expect(document.documentElement.hasAttribute('data-accent')).toBe(false);
  });

  it('toggles data-theme on light/dark', () => {
    applyToRoot(document.documentElement, { theme: 'light' });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    applyToRoot(document.documentElement, { theme: 'dark' });
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('toggles data-density on dense/comfortable', () => {
    applyToRoot(document.documentElement, { density: 'dense' });
    expect(document.documentElement.getAttribute('data-density')).toBe('dense');
    applyToRoot(document.documentElement, { density: 'comfortable' });
    expect(document.documentElement.hasAttribute('data-density')).toBe(false);
  });

  it('hides [data-narrative] panels when narrative=off', () => {
    document.body.innerHTML = '<section data-narrative></section><section></section>';
    applyToRoot(document.documentElement, { narrative: 'off' });
    expect(document.querySelector('section[data-narrative]').hasAttribute('data-hidden-by-tweak')).toBe(true);
    applyToRoot(document.documentElement, { narrative: 'on' });
    expect(document.querySelector('section[data-narrative]').hasAttribute('data-hidden-by-tweak')).toBe(false);
  });

  it('is a no-op on null root', () => {
    expect(() => applyToRoot(null, { accent: 'violet' })).not.toThrow();
  });
});

describe('tweaks.applyMessage', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-accent');
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-density');
  });

  it('applies a {type:tokens} message payload', () => {
    applyMessage(document, { accent: 'rose', theme: 'light', density: 'dense', narrative: 'on' });
    expect(document.documentElement.getAttribute('data-accent')).toBe('rose');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.getAttribute('data-density')).toBe('dense');
  });

  it('is safe with null / non-object data', () => {
    expect(() => applyMessage(document, null)).not.toThrow();
    expect(() => applyMessage(document, 'oops')).not.toThrow();
    expect(() => applyMessage(null, {})).not.toThrow();
  });
});

describe('tweaks.mount', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-accent');
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-density');
  });

  it('renders the floating tweaks panel under document.body', () => {
    const root = mount({ document, storage: memStore() });
    expect(root).toBeTruthy();
    expect(root.classList.contains('tweaks')).toBe(true);
    expect(document.querySelector('.tweaks')).toBe(root);
    expect(root.querySelectorAll('.swatch').length).toBe(5);
  });

  it('updates prefs, storage, and root attributes on a swatch click', () => {
    const s = memStore();
    let cb = null;
    const root = mount({ document, storage: s, onChange: (p) => { cb = p; } });
    const violet = root.querySelector('.swatch[data-accent="violet"]');
    violet.click();
    expect(s.getItem('bc-accent')).toBe('violet');
    expect(document.documentElement.getAttribute('data-accent')).toBe('violet');
    expect(cb && cb.accent).toBe('violet');
    expect(violet.classList.contains('on')).toBe(true);
  });

  it('updates prefs on a segment-button click', () => {
    const s = memStore();
    const root = mount({ document, storage: s });
    const lightBtn = root.querySelector('.seg button[data-key="theme"][data-val="light"]');
    lightBtn.click();
    expect(s.getItem('bc-theme')).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('returns null when no document is available', () => {
    expect(mount({ document: null })).toBe(null);
  });

  it('uses safeStorage() when no storage is passed', () => {
    // No storage arg → mount() falls back to safeStorage() (the
    // `||`-branch we want to cover). With localStorage available
    // (happy-dom), this still works.
    const root = mount({ document });
    expect(root).toBeTruthy();
  });

  it('handles a seg-button click without an onChange callback', () => {
    const root = mount({ document, storage: memStore() /* no onChange */ });
    const denseBtn = root.querySelector('.seg button[data-key="density"][data-val="dense"]');
    expect(() => denseBtn.click()).not.toThrow();
    expect(document.documentElement.getAttribute('data-density')).toBe('dense');
  });
});

describe('tweaks.applyMessage — default fallbacks', () => {
  it('fills missing fields with DEFAULTS', () => {
    // Each `data.x || DEFAULTS.x` branch in applyMessage needs to
    // exercise the falsy side. An empty payload covers all four.
    document.documentElement.removeAttribute('data-accent');
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-density');
    applyMessage(document, {});
    // Defaults: accent=teal (no attribute), theme=dark (no attribute),
    // density=comfortable (no attribute) — all should be absent.
    expect(document.documentElement.hasAttribute('data-accent')).toBe(false);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(document.documentElement.hasAttribute('data-density')).toBe(false);
  });
});
