// Coverage for entry points + helpers that the per-panel tests don't reach:
// renderSpec(), makeDashFetch(), buildParamControls(), layoutPanels(),
// _rerun on param change, subtitle rendering, default panel id when omitted,
// browser global wiring.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  renderSpec,
  makeDashFetch,
  createLedger,
  buildParamControls,
  layoutPanels,
  SpecRuntime,
  fmt,
} from '../../../runtime/v1/dash.js';

describe('makeDashFetch', () => {
  it('adds an entry on first call and updates to OK on success', async () => {
    const ledger = createLedger();
    const chFetch = async () => ({ rows: [{ x: 1 }], count: 1 });
    const fetch = makeDashFetch({}, chFetch, ledger);
    const r = await fetch('q1', 'count', 'SELECT 1');
    expect(r.rows).toEqual([{ x: 1 }]);
    expect(ledger._items().q1.status).toBe('OK');
    expect(ledger._items().q1.rows).toBe(1);
  });
  it('updates to Failed on rejection and rethrows', async () => {
    const ledger = createLedger();
    const fetch = makeDashFetch({}, () => Promise.reject(new Error('bad')), ledger);
    await expect(fetch('q', 'label', 'SQL')).rejects.toThrow('bad');
    expect(ledger._items().q.status).toBe('Failed');
  });
  it('rethrows Auth expired without marking Failed', async () => {
    const ledger = createLedger();
    const fetch = makeDashFetch({}, () => Promise.reject(new Error('Auth expired')), ledger);
    await expect(fetch('q', 'label', 'SQL')).rejects.toThrow('Auth expired');
    // Status stays Pending (not Failed) because the caller will reload.
    expect(ledger._items().q.status).toBe('Pending');
  });
  it('does not duplicate ledger entries across calls for the same id', async () => {
    const ledger = createLedger();
    const fetch = makeDashFetch({}, async () => ({ rows: [], count: 0 }), ledger);
    await fetch('q', 'A', 'x');
    await fetch('q', 'A', 'x');
    expect(ledger._order()).toEqual(['q']);
  });
});

describe('buildParamControls', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('renders one control per param', () => {
    const bar = buildParamControls(
      [
        { name: 'y', type: 'int', default: 2024 },
        { name: 'c', type: 'enum', options: ['A', 'B'], default: 'A' },
        { name: 'd', type: 'date', default: '2024-01-01' },
        { name: 's', type: 'string', default: '' },
      ],
      { y: 2024, c: 'A', d: '2024-01-01', s: '' },
      () => {},
    );
    document.body.appendChild(bar);
    expect(bar.querySelectorAll('label').length).toBe(4);
    expect(bar.querySelector('input[type=number]')).toBeTruthy();
    expect(bar.querySelector('select')).toBeTruthy();
    expect(bar.querySelector('input[type=date]')).toBeTruthy();
    expect(bar.querySelector('input[type=search]')).toBeTruthy();
  });

  it('writes through to the values map on change', () => {
    const values = { y: 2024 };
    let changes = 0;
    const bar = buildParamControls(
      [{ name: 'y', type: 'int' }],
      values,
      () => { changes++; },
    );
    const input = bar.querySelector('input[type=number]');
    input.value = '2025';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(values.y).toBe(2025);
    expect(changes).toBe(1);
  });

  it('commits on Enter as well as change', () => {
    const values = { s: '' };
    let changes = 0;
    const bar = buildParamControls(
      [{ name: 's', type: 'string' }],
      values,
      () => { changes++; },
    );
    const input = bar.querySelector('input[type=search]');
    input.value = 'foo';
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    input.dispatchEvent(ev);
    expect(values.s).toBe('foo');
    expect(changes).toBe(1);
  });

  it('applies int min/max to the input', () => {
    const bar = buildParamControls(
      [{ name: 'y', type: 'int', min: 1987, max: 2025 }],
      { y: 2020 },
      () => {},
    );
    const input = bar.querySelector('input[type=number]');
    expect(input.min).toBe('1987');
    expect(input.max).toBe('2025');
  });
});

describe('layoutPanels', () => {
  it('packs consecutive width:6 panels into row-2 rows', () => {
    const panels = [
      { width: 6 }, { width: 6 },
      { width: 12 },
      { width: 6 }, { width: 6 },
    ];
    const root = document.createElement('div');
    root.appendChild(layoutPanels(panels, (p) => {
      const el = document.createElement('div');
      el.dataset.w = String(p.width);
      return el;
    }));
    const row2Rows = root.querySelectorAll('.row-2');
    expect(row2Rows.length).toBe(2);
    expect(row2Rows[0].children.length).toBe(2);
    expect(row2Rows[1].children.length).toBe(2);
  });

  it('packs width:4 panels three per row', () => {
    const panels = [{ width: 4 }, { width: 4 }, { width: 4 }];
    const root = document.createElement('div');
    root.appendChild(layoutPanels(panels, () => document.createElement('span')));
    expect(root.querySelector('.row-3').children.length).toBe(3);
  });

  it('handles mixed widths without dropping panels', () => {
    const panels = [{ width: 6 }, { width: 6 }, { width: 4 }, { width: 4 }];
    const root = document.createElement('div');
    let made = 0;
    root.appendChild(layoutPanels(panels, () => {
      made++;
      return document.createElement('span');
    }));
    expect(made).toBe(4);
  });
});

describe('SpecRuntime — subtitle and default panel id', () => {
  it('renders subtitle when set', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const rt = new SpecRuntime(
      { title: 'T', subtitle: 'lead muted line', panels: [] },
      root,
      { api: { fmt }, fetch: async () => ({ rows: [], count: 0 }), ledger: createLedger() },
    );
    await rt.boot();
    expect(root.querySelector('p.muted').textContent).toBe('lead muted line');
  });

  it('assigns default id="pN" to panels without explicit id', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const rt = new SpecRuntime(
      { panels: [{ type: 'markdown', text: '#a' }, { type: 'markdown', text: '#b' }] },
      root,
      { api: { fmt }, fetch: async () => ({ rows: [], count: 0 }), ledger: createLedger() },
    );
    await rt.boot();
    expect(Object.keys(rt.panels)).toEqual(['p0', 'p1']);
  });
});

describe('SpecRuntime — _rerun on param change', () => {
  it('only re-runs panels whose query mentions the changed param', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const calls = [];
    const ctx = {
      api: { fmt },
      ledger: createLedger(),
      fetch: async (id) => { calls.push(id); return { rows: [{ x: 1 }], count: 1 }; },
    };
    const rt = new SpecRuntime({
      params: [
        { name: 'y', type: 'int', default: 2024 },
        { name: 'z', type: 'int', default: 1 },
      ],
      panels: [
        { id: 'a', type: 'kpi-strip', query: 'SELECT 1 WHERE Y={{y}}', tiles: [{ key: 'x' }] },
        { id: 'b', type: 'kpi-strip', query: 'SELECT 1 WHERE Z={{z}}', tiles: [{ key: 'x' }] },
      ],
    }, root, ctx);
    await rt.boot();
    expect(calls).toEqual(['a', 'b']);
    rt.params.y = 2025;
    rt._rerun('y');
    // Wait a tick for async _runPanel to dispatch the fetch.
    await new Promise(r => setTimeout(r, 0));
    expect(calls).toEqual(['a', 'b', 'a']);
  });

  it("emits a 'params' event with the changed name + snapshot", async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const ctx = {
      api: { fmt },
      ledger: createLedger(),
      fetch: async () => ({ rows: [], count: 0 }),
    };
    const rt = new SpecRuntime({
      params: [{ name: 'y', type: 'int', default: 1 }],
      panels: [],
    }, root, ctx);
    await rt.boot();
    let seen = null;
    rt.on('params', (ev) => { seen = ev; });
    rt.params.y = 2;
    rt._rerun('y');
    expect(seen).toEqual({ changed: 'y', params: { y: 2 } });
  });
});

describe('renderSpec — top-level entry', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('parses a JSON-string spec', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const spec = JSON.stringify({
      title: 'JSON spec',
      panels: [{ type: 'markdown', text: '## from string' }],
    });
    await renderSpec(spec, root, {
      chFetch: () => Promise.resolve({ rows: [], count: 0 }),
    });
    expect(root.textContent).toContain('JSON spec');
    expect(root.textContent).toContain('from string');
  });

  it('renders an error block for malformed JSON', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    await renderSpec('not json', root, { chFetch: () => Promise.resolve({}) });
    expect(root.textContent).toContain('Bad spec JSON');
  });

  it('exposes window.DASH with the spec runtime', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    await renderSpec(
      { panels: [{ type: 'markdown', text: 'hi' }] },
      root,
      { chFetch: () => Promise.resolve({ rows: [], count: 0 }) },
    );
    expect(window.DASH.spec).toBeTruthy();
    expect(window.DASH.fmt).toBe(fmt);
  });

  it('throws via fetch helper when CH_FETCH is not configured and a query runs', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    // No opts.chFetch; window.CH_FETCH undefined → fetch helper throws on call.
    await renderSpec(
      { panels: [{ id: 'k', type: 'kpi-strip', query: 'SELECT 1', tiles: [{ key: 'x' }] }] },
      root,
    );
    expect(root.textContent).toContain('CH_FETCH not configured');
  });
});
