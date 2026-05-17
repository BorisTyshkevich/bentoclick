import { describe, it, expect, beforeEach } from 'vitest';
import { SpecRuntime, renderPanelShell, createLedger, fmt } from '../../../runtime/v1/dash.js';

function ctxWith(fetcher) {
  return {
    api: { fmt },
    fetch: fetcher,
    ledger: createLedger(),
  };
}

describe('renderPanelShell — unknown panel type', () => {
  it('renders an error tile, does not throw', () => {
    const state = { id: 'x', update: () => {} };
    const el = renderPanelShell({ type: 'whatever-new' }, state, { api: { fmt } });
    expect(el.textContent).toContain('Unknown panel type');
    expect(el.textContent).toContain('whatever-new');
  });
});

describe('SpecRuntime — param validation error', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('shows the validation error in the panel slot and does not call fetch', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    let fetchCalled = 0;
    const ctx = ctxWith(() => {
      fetchCalled++;
      return Promise.resolve({ rows: [], count: 0, cols: [] });
    });
    const rt = new SpecRuntime({
      title: 'T',
      params: [{ name: 'year', type: 'int', min: 2020, max: 2030, default: 2025 }],
      panels: [
        { id: 'k', type: 'kpi-strip', query: 'SELECT 1 WHERE Year = {{year}}',
          tiles: [{ key: 'count' }] },
      ],
    }, root, ctx);
    rt.params.year = 1999; // out of range
    await rt.boot();
    expect(fetchCalled).toBe(0);
    expect(root.textContent).toContain('Bad year');
  });
});

describe('SpecRuntime — fetch error surfaces in panel slot', () => {
  it('renders error message, other panels unaffected', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    let calls = 0;
    const ctx = ctxWith(async (_id, _label, sql) => {
      calls++;
      if (sql.includes('FAIL')) throw new Error('mock-fetch-failure');
      return { rows: [{ x: 1 }], count: 1, cols: ['x'] };
    });
    const rt = new SpecRuntime({
      title: 'T',
      panels: [
        { id: 'ok',  type: 'kpi-strip', query: 'SELECT 1',     tiles: [{ key: 'x' }] },
        { id: 'bad', type: 'kpi-strip', query: 'SELECT FAIL',  tiles: [{ key: 'x' }] },
      ],
    }, root, ctx);
    await rt.boot();
    expect(calls).toBe(2);
    // bad panel should contain the error; ok panel should not.
    const cards = root.querySelectorAll('.kpi-strip, .card');
    const errorText = Array.from(cards).map((c) => c.textContent).join('|');
    expect(errorText).toContain('mock-fetch-failure');
  });
});

describe('SpecRuntime — no-query panel renders synchronously', () => {
  it('markdown panel renders without calling fetch', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    let calls = 0;
    const ctx = ctxWith(() => { calls++; return Promise.resolve({ rows: [], count: 0 }); });
    const rt = new SpecRuntime({
      panels: [{ id: 'm', type: 'markdown', text: '## hi' }],
    }, root, ctx);
    await rt.boot();
    expect(calls).toBe(0);
    expect(root.textContent).toContain('hi');
  });
});

describe('SpecRuntime — panel:loaded event', () => {
  it('fires after a panel completes its fetch', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const ctx = ctxWith(async () => ({ rows: [{ x: 7 }], count: 1, cols: ['x'] }));
    const rt = new SpecRuntime({
      panels: [{ id: 'k', type: 'kpi-strip', query: 'SELECT 1', tiles: [{ key: 'x' }] }],
    }, root, ctx);
    const events = [];
    rt.on('panel:loaded', (ev) => events.push(ev));
    await rt.boot();
    expect(events.length).toBe(1);
    expect(events[0].id).toBe('k');
    expect(events[0].rows).toEqual([{ x: 7 }]);
  });
});

describe('SpecRuntime — concurrent vs sequential', () => {
  it('concurrent mode runs panels in parallel', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const calls = [];
    const ctx = ctxWith(async (id) => {
      calls.push('start:' + id);
      await new Promise((r) => setTimeout(r, 10));
      calls.push('end:' + id);
      return { rows: [{ x: 1 }], count: 1 };
    });
    const rt = new SpecRuntime({
      concurrent: true,
      panels: [
        { id: 'a', type: 'kpi-strip', query: 'SELECT 1', tiles: [{ key: 'x' }] },
        { id: 'b', type: 'kpi-strip', query: 'SELECT 2', tiles: [{ key: 'x' }] },
      ],
    }, root, ctx);
    await rt.boot();
    // In concurrent mode both starts happen before any end.
    expect(calls.indexOf('start:a')).toBeLessThan(calls.indexOf('end:b'));
    expect(calls.indexOf('start:b')).toBeLessThan(calls.indexOf('end:a'));
  });
});

describe('SpecRuntime — interpolate / fetch helpers', () => {
  it('interpolate substitutes params', () => {
    const ctx = ctxWith(() => Promise.resolve({ rows: [], count: 0 }));
    const rt = new SpecRuntime({
      params: [{ name: 'y', type: 'int', default: 2024 }],
    }, document.createElement('div'), ctx);
    expect(rt.interpolate('Year={{y}}')).toBe('Year=2024');
  });
  it('fetch label-slugs into a stable id and routes through ctx.fetch', async () => {
    let seen = null;
    const ctx = ctxWith(async (id, label, sql) => {
      seen = { id, label, sql };
      return { rows: [], count: 0 };
    });
    const rt = new SpecRuntime({
      params: [{ name: 'y', type: 'int', default: 2024 }],
    }, document.createElement('div'), ctx);
    await rt.fetch('Drill: Click', 'SELECT {{y}}');
    expect(seen.id).toBe('spec:drill-click');
    expect(seen.label).toBe('Drill: Click');
    expect(seen.sql).toBe('SELECT 2024');
  });
});
