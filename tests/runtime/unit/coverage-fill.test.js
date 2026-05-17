// Targeted tests to close remaining branch-coverage gaps.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PANELS,
  buildParamControls,
  layoutPanels,
  renderPanelShell,
  pickBadgeClass,
  makeDashFetch,
  createLedger,
  fmt,
} from '../../../runtime/v1/dash.js';

function ctx() { return { api: { fmt }, spec: null }; }

describe('CSV button click triggers download path', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('clicking the Export CSV button invokes the download codepath', () => {
    // Stub URL.createObjectURL & revokeObjectURL so jsdom/happy-dom does
    // not error in environments where Blob → URL isn't wired.
    URL.createObjectURL = () => 'blob:fake';
    URL.revokeObjectURL = () => {};
    const panel = {
      type: 'table', id: 'csv-test',
      columns: [{ key: 'a', label: 'A' }],
    };
    const state = { id: 'csv-test', rows: [{ a: 1 }, { a: 2 }], update: () => {} };
    const el = PANELS.table(panel, state, ctx());
    document.body.appendChild(el);
    const btn = el.querySelector('button.btn-mini');
    expect(btn).toBeTruthy();
    // Click should not throw and should run through buildCsv → Blob → click.
    expect(() => btn.click()).not.toThrow();
  });
});

describe('buildParamControls — placeholder + initial value', () => {
  it('string control with placeholder sets the attribute', () => {
    const bar = buildParamControls(
      [{ name: 's', type: 'string', placeholder: 'search...' }],
      { s: '' },
      () => {},
    );
    expect(bar.querySelector('input[type=search]').placeholder).toBe('search...');
  });
  it('enum control receives the current value as default', () => {
    const bar = buildParamControls(
      [{ name: 'c', type: 'enum', options: ['A', 'B'] }],
      { c: 'B' },
      () => {},
    );
    expect(bar.querySelector('select').value).toBe('B');
  });
});

describe('layoutPanels — partial fills', () => {
  it('width=6 with one panel emits a partially filled row', () => {
    const root = document.createElement('div');
    root.appendChild(layoutPanels([{ width: 6 }], () => document.createElement('span')));
    expect(root.querySelector('.row-2')).toBeTruthy();
    expect(root.querySelector('.row-2').children.length).toBe(1);
  });
  it('mixed widths break out of the pack when widths change', () => {
    const panels = [{ width: 6 }, { width: 12 }, { width: 6 }];
    const root = document.createElement('div');
    let count = 0;
    root.appendChild(layoutPanels(panels, () => {
      count++;
      return document.createElement('span');
    }));
    expect(count).toBe(3);
  });
});

describe('pickBadgeClass — fallback to smallest threshold for very low values', () => {
  it('returns the last threshold when input is below all', () => {
    const spec = { '10+': 'high', '5+': 'mid' };  // no "0+" fallback
    expect(pickBadgeClass(spec, 1)).toBe('mid');
  });
});

describe('renderPanelShell — error tile reuses panel.type when no title', () => {
  it('uses panel.type as h2 when no title is set', () => {
    const state = { update: () => {} };
    const el = renderPanelShell({ type: 'mystery' }, state, ctx());
    expect(el.querySelector('h2').textContent).toBe('mystery');
  });
});

describe('script panel — missing html shell still mounts', () => {
  it('mounts with no html field', async () => {
    const state = { id: 's', update: () => {} };
    const el = PANELS.script({
      type: 'script', id: 's',
      script: "/* noop */",
    }, state, { api: { fmt } });
    document.body.appendChild(el);
    await state.update();
    expect(el.classList.contains('script-panel')).toBe(true);
  });
  it('renders title h2 when provided', () => {
    const state = { id: 's', update: () => {} };
    const el = PANELS.script({
      type: 'script', id: 's', title: 'Details',
      html: '<div></div>', script: '',
    }, state, { api: { fmt } });
    expect(el.querySelector('h2').textContent).toBe('Details');
  });
});

describe('SpecRuntime _rerun branch coverage', () => {
  it('reruns all panels when called with undefined changedName', async () => {
    const { SpecRuntime } = await import('../../../runtime/v1/dash.js');
    const root = document.createElement('div');
    document.body.appendChild(root);
    const seen = [];
    const rt = new SpecRuntime({
      params: [{ name: 'y', type: 'int', default: 1 }],
      panels: [
        { id: 'a', type: 'kpi-strip', query: 'SELECT 1', tiles: [{ key: 'x' }] },
        { id: 'b', type: 'kpi-strip', query: 'SELECT 2', tiles: [{ key: 'x' }] },
      ],
    }, root, {
      api: { fmt }, ledger: createLedger(),
      fetch: async (id) => { seen.push(id); return { rows: [{ x: 1 }], count: 1 }; },
    });
    await rt.boot();
    seen.length = 0;
    rt._rerun(undefined);
    await new Promise(r => setTimeout(r, 0));
    expect(seen.sort()).toEqual(['a', 'b']);
  });

  it('skips no-query panels when filtering by changed param', async () => {
    const { SpecRuntime } = await import('../../../runtime/v1/dash.js');
    const root = document.createElement('div');
    document.body.appendChild(root);
    const seen = [];
    const rt = new SpecRuntime({
      params: [{ name: 'y', type: 'int', default: 1 }],
      panels: [
        { id: 'm', type: 'markdown', text: 'no query' },
        { id: 'k', type: 'kpi-strip', query: 'WHERE Y={{y}}', tiles: [{ key: 'x' }] },
      ],
    }, root, {
      api: { fmt }, ledger: createLedger(),
      fetch: async (id) => { seen.push(id); return { rows: [{ x: 1 }], count: 1 }; },
    });
    await rt.boot();
    seen.length = 0;
    rt._rerun('y');
    await new Promise(r => setTimeout(r, 0));
    expect(seen).toEqual(['k']);   // markdown skipped (no query)
  });

  it('matches the {{ name }} whitespace variant', async () => {
    const { SpecRuntime } = await import('../../../runtime/v1/dash.js');
    const root = document.createElement('div');
    document.body.appendChild(root);
    const seen = [];
    const rt = new SpecRuntime({
      params: [{ name: 'y', type: 'int', default: 1 }],
      panels: [
        { id: 'k', type: 'kpi-strip', query: 'WHERE Y={{ y }}', tiles: [{ key: 'x' }] },
      ],
    }, root, {
      api: { fmt }, ledger: createLedger(),
      fetch: async (id) => { seen.push(id); return { rows: [{ x: 1 }], count: 1 }; },
    });
    await rt.boot();
    seen.length = 0;
    rt._rerun('y');
    await new Promise(r => setTimeout(r, 0));
    expect(seen).toEqual(['k']);
  });
});

describe('SpecRuntime — defensive branches', () => {
  it('non-Error throw still surfaces a stringified message', async () => {
    const { SpecRuntime } = await import('../../../runtime/v1/dash.js');
    const root = document.createElement('div');
    document.body.appendChild(root);
    const rt = new SpecRuntime({
      panels: [{ id: 'k', type: 'kpi-strip', query: 'SELECT 1', tiles: [{ key: 'x' }] }],
    }, root, {
      api: { fmt }, ledger: createLedger(),
      // eslint-disable-next-line no-throw-literal
      fetch: () => { throw 'plain-string-thrown'; },
    });
    await rt.boot();
    expect(root.textContent).toContain('plain-string-thrown');
  });

  it('stale epoch result is ignored', async () => {
    const { SpecRuntime } = await import('../../../runtime/v1/dash.js');
    const root = document.createElement('div');
    document.body.appendChild(root);
    let resolveFirst;
    let firstCalled = 0;
    const rt = new SpecRuntime({
      panels: [{ id: 'k', type: 'kpi-strip', query: 'SELECT 1', tiles: [{ key: 'x' }] }],
    }, root, {
      api: { fmt }, ledger: createLedger(),
      fetch: () => {
        firstCalled++;
        if (firstCalled === 1) {
          return new Promise(r => { resolveFirst = r; });
        }
        return Promise.resolve({ rows: [{ x: 'second' }], count: 1 });
      },
    });
    // Start boot but don't await yet.
    const booted = rt.boot();
    // Wait one tick so the first call is in flight.
    await new Promise(r => setTimeout(r, 0));
    // Kick off a second fetch on the same panel via _runPanel directly.
    const state = rt.panels.k;
    const second = rt._runPanel(rt._spec.panels[0], state);
    // Resolve the first (now stale) fetch with different data.
    resolveFirst({ rows: [{ x: 'first-stale' }], count: 1 });
    await second;
    await booted;
    // The panel should show the SECOND result, not the stale first.
    expect(root.textContent).toContain('second');
    expect(root.textContent).not.toContain('first-stale');
  });
});

describe('SpecRuntime — defensive catch branches', () => {
  it('swallows a thrown null (e && e.message branch with e falsy)', async () => {
    const { SpecRuntime } = await import('../../../runtime/v1/dash.js');
    const root = document.createElement('div');
    document.body.appendChild(root);
    const rt = new SpecRuntime({
      panels: [{ id: 'k', type: 'kpi-strip', query: 'SELECT 1', tiles: [{ key: 'x' }] }],
    }, root, {
      api: { fmt }, ledger: createLedger(),
      // eslint-disable-next-line no-throw-literal
      fetch: () => { throw null; },
    });
    await rt.boot();
    // Falsy throw → "" / null surfaces as String(e) in the inline error.
    expect(root.textContent).toContain('null');
  });

  it('renderer update() that throws is swallowed by sequential boot', async () => {
    const { SpecRuntime } = await import('../../../runtime/v1/dash.js');
    const root = document.createElement('div');
    document.body.appendChild(root);
    let called = false;
    const rt = new SpecRuntime({
      panels: [{
        id: 'm', type: 'markdown', text: 'ok',
        // No query → goes through `state.update([])` path which we wrap
        // in try/catch. Force the renderer's update to throw.
      }, {
        id: 'after', type: 'markdown', text: 'after-marker',
      }],
    }, root, { api: { fmt }, ledger: createLedger(), fetch: async () => ({ rows: [], count: 0 }) });
    // Sneak in a state.update that throws after the markdown panel mounts.
    const origRun = rt._runPanel.bind(rt);
    rt._runPanel = async function (panel, state) {
      if (panel.id === 'm') {
        state.update = () => { called = true; throw new Error('renderer-boom'); };
      }
      return origRun(panel, state);
    };
    await rt.boot();
    expect(called).toBe(true);
    // The 'after' panel still rendered, proving the throw was contained.
    expect(root.textContent).toContain('after-marker');
  });

  it('panel without id uses pN index in _rerun lookups', async () => {
    const { SpecRuntime } = await import('../../../runtime/v1/dash.js');
    const root = document.createElement('div');
    document.body.appendChild(root);
    const seen = [];
    const rt = new SpecRuntime({
      params: [{ name: 'y', type: 'int', default: 1 }],
      // No `id` — should be assigned 'p0' at boot, and _rerun finds it via that path.
      panels: [{ type: 'kpi-strip', query: 'WHERE Y={{y}}', tiles: [{ key: 'x' }] }],
    }, root, {
      api: { fmt }, ledger: createLedger(),
      fetch: async (id) => { seen.push(id); return { rows: [{ x: 1 }], count: 1 }; },
    });
    await rt.boot();
    seen.length = 0;
    rt._rerun('y');
    await new Promise(r => setTimeout(r, 0));
    expect(seen).toEqual(['p0']);
  });
});

describe('attachErrorHelper without title', () => {
  it('renders just the error paragraph when panel has no title', async () => {
    const { SpecRuntime } = await import('../../../runtime/v1/dash.js');
    const root = document.createElement('div');
    document.body.appendChild(root);
    const rt = new SpecRuntime({
      // No panel title; error helper should not emit an h2.
      panels: [{ id: 'k', type: 'kpi-strip', query: 'SELECT 1', tiles: [{ key: 'x' }] }],
    }, root, {
      api: { fmt }, ledger: createLedger(),
      fetch: () => Promise.reject(new Error('boom')),
    });
    await rt.boot();
    expect(root.textContent).toContain('boom');
    // The panel slot should have no h2 (no title configured).
    const errCard = root.querySelector('.kpi-strip') || root.querySelector('.card');
    if (errCard) {
      expect(errCard.querySelector('h2')).toBeNull();
    }
  });
});

describe('renderSpec — default rootEl resolution', () => {
  it('falls back to #dash-root when rootEl is omitted', async () => {
    const { renderSpec } = await import('../../../runtime/v1/dash.js');
    document.body.innerHTML = '<div id="dash-root"></div>';
    await renderSpec({ panels: [{ type: 'markdown', text: 'hi' }] }, undefined, {
      chFetch: () => Promise.resolve({ rows: [], count: 0 }),
    });
    expect(document.getElementById('dash-root').textContent).toContain('hi');
  });
  it('falls back to document.body if no #dash-root', async () => {
    const { renderSpec } = await import('../../../runtime/v1/dash.js');
    document.body.innerHTML = '';
    await renderSpec({ panels: [{ type: 'markdown', text: 'fallback' }] }, undefined, {
      chFetch: () => Promise.resolve({ rows: [], count: 0 }),
    });
    expect(document.body.textContent).toContain('fallback');
  });
});

describe('SpecRuntime boot — toolbar change wires through to _rerun', () => {
  it('triggers _rerun via the toolbar callback after boot', async () => {
    const { SpecRuntime } = await import('../../../runtime/v1/dash.js');
    const root = document.createElement('div');
    document.body.appendChild(root);
    const calls = [];
    const ctxObj = {
      api: { fmt },
      ledger: createLedger(),
      fetch: async (id) => { calls.push(id); return { rows: [{ x: 1 }], count: 1 }; },
    };
    const rt = new SpecRuntime({
      params: [{ name: 'y', type: 'int', default: 2024 }],
      panels: [
        { id: 'k', type: 'kpi-strip', query: 'SELECT 1 WHERE Y={{y}}', tiles: [{ key: 'x' }] },
      ],
    }, root, ctxObj);
    await rt.boot();
    expect(calls).toEqual(['k']);
    // Trigger the toolbar input change → boot's closure → _rerun → re-runs k.
    const input = root.querySelector('input[type=number]');
    input.value = '2025';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    expect(calls).toEqual(['k', 'k']);
  });
});

describe('makeDashFetch — no-id-yet branch', () => {
  it('adds entry on first call even when ledger has prior items', async () => {
    const ledger = createLedger();
    ledger.add('seed', 'seed');
    const fetch = makeDashFetch({}, async () => ({ rows: [], count: 0 }), ledger);
    await fetch('new', 'New', 'SELECT 1');
    expect(ledger._order()).toEqual(['seed', 'new']);
  });
});

describe('table — null/missing value cell with badge', () => {
  it('does not crash when cell value is null and badge map present', () => {
    const panel = {
      type: 'table',
      columns: [
        { key: 'count', label: 'Count', format: 'num',
          badge: { '20+': 'high', '0+': 'low' } },
      ],
    };
    const state = { id: 't', rows: [], update: () => {} };
    const el = PANELS.table(panel, state, ctx());
    state.update([{ count: null }, { count: 'oops' }]);
    expect(el.querySelectorAll('tbody tr').length).toBe(2);
  });
});

describe('SpecRuntime — Auth expired path does not call _showError', () => {
  it('swallows Auth expired silently', async () => {
    const { SpecRuntime } = await import('../../../runtime/v1/dash.js');
    const root = document.createElement('div');
    document.body.appendChild(root);
    const rt = new SpecRuntime({
      panels: [{ id: 'k', type: 'kpi-strip', query: 'SELECT 1', tiles: [{ key: 'x' }] }],
    }, root, {
      api: { fmt },
      ledger: createLedger(),
      fetch: () => Promise.reject(new Error('Auth expired')),
    });
    await rt.boot();
    // The panel's slot should NOT contain an error text — Auth expired is
    // handled by the SPA shell (token refresh), not surfaced inline.
    expect(root.textContent).not.toContain('Auth expired');
  });
});
