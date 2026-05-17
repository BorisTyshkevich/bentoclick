import { describe, it, expect, beforeEach } from 'vitest';
import { PANELS, fmt, SpecRuntime, createLedger } from '../../../runtime/v1/dash.js';

function makeSpecStub() {
  const calls = [];
  return {
    calls,
    panels: {},
    setParam(name, value) { calls.push([name, value]); },
    on() {},
  };
}

function ctx(spec) { return { api: { fmt }, spec }; }

describe('on_click cross-panel filtering', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('table row click calls spec.setParam with the configured column', () => {
    const stub = makeSpecStub();
    const state = { id: 't', rows: [], update: () => {} };
    const el = PANELS.table({
      type: 'table',
      columns: [{ key: 'year' }, { key: 'who' }],
      on_click: { set_param: 'year', from: 'year' },
    }, state, ctx(stub));
    document.body.appendChild(el);
    state.update([{ year: 1990, who: 'DL' }, { year: 2000, who: 'WN' }]);
    const rows = el.querySelectorAll('tbody tr[data-row-index]');
    expect(rows.length).toBe(2);
    rows[1].dispatchEvent(new Event('click', { bubbles: true }));
    expect(stub.calls).toEqual([['year', 2000]]);
  });

  it('table omits on_click wiring when set_param is missing', () => {
    const stub = makeSpecStub();
    const state = { id: 't', rows: [], update: () => {} };
    const el = PANELS.table({
      type: 'table',
      columns: [{ key: 'year' }],
    }, state, ctx(stub));
    state.update([{ year: 1990 }]);
    const tr = el.querySelector('tbody tr[data-row-index]');
    expect(tr.classList.contains('chart-clickable')).toBe(false);
    tr.dispatchEvent(new Event('click', { bubbles: true }));
    expect(stub.calls.length).toBe(0);
  });

  it('chart bar click sets the param from the row', () => {
    const stub = makeSpecStub();
    const state = { id: 'b', rows: [], update: () => {} };
    const el = PANELS.chart({
      type: 'chart',
      x_key: 'year', value_key: 'flights',
      on_click: { set_param: 'year', from: 'year' },
    }, state, ctx(stub));
    state.update([
      { year: 1990, flights: 10 },
      { year: 2000, flights: 20 },
    ]);
    const bars = el.querySelectorAll('rect.chart-bar');
    bars[1].dispatchEvent(new Event('click', { bubbles: true }));
    expect(stub.calls).toEqual([['year', 2000]]);
  });

  it('combo bar click sets the param from the row', () => {
    const stub = makeSpecStub();
    const state = { id: 'b', rows: [], update: () => {} };
    const el = PANELS.combo({
      type: 'combo',
      x_key: 'year',
      bars: { key: 'flights' },
      line: { key: 'margin' },
      on_click: { set_param: 'year', from: 'year' },
    }, state, ctx(stub));
    state.update([
      { year: 1990, flights: 10, margin: 1 },
      { year: 2000, flights: 20, margin: 2 },
    ]);
    el.querySelectorAll('rect.chart-bar')[0].dispatchEvent(new Event('click', { bubbles: true }));
    expect(stub.calls).toEqual([['year', 1990]]);
  });

  it('line dot click sets the param from the matching row', () => {
    // The line renderer wires on_click on each `circle.chart-point`
    // (one per data point per series). Coverage gap pinned: this is
    // the only on_click branch on the line panel.
    const stub = makeSpecStub();
    const state = { id: 'l', rows: [], update: () => {} };
    const el = PANELS.line({
      type: 'line',
      x_key: 'year',
      series: [{ key: 'flights' }],
      on_click: { set_param: 'year', from: 'year' },
    }, state, ctx(stub));
    state.update([
      { year: 1990, flights: 10 },
      { year: 2000, flights: 20 },
    ]);
    const dots = el.querySelectorAll('circle.chart-point');
    expect(dots.length).toBe(2);
    dots[1].dispatchEvent(new Event('click', { bubbles: true }));
    expect(stub.calls).toEqual([['year', 2000]]);
  });
});

describe('SpecRuntime.setParam', () => {
  function mountSpec(spec) {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const ledger = createLedger();
    const calls = [];
    const fetch = (id, label, sql) => {
      calls.push({ id, label, sql });
      return Promise.resolve({ rows: [], count: 0 });
    };
    const api = { fmt };
    const rt = new SpecRuntime(spec, root, { api, fetch, ledger });
    return { rt, calls, root };
  }

  it('updates params, syncs the toolbar input, and re-runs affected panels', async () => {
    const spec = {
      title: 'X',
      params: [{ name: 'year', type: 'int', default: 2020, min: 1987, max: 2025 }],
      panels: [
        { id: 'q', type: 'kpi-strip', query: 'SELECT 1 WHERE Year = {{year}}',
          tiles: [{ key: 'n', label: 'N' }] },
      ],
    };
    const { rt, calls, root } = mountSpec(spec);
    await rt.boot();
    expect(rt.params.year).toBe(2020);
    const ok = rt.setParam('year', '1990');
    expect(ok).toBe(true);
    expect(rt.params.year).toBe(1990); // coerced to int
    const input = root.querySelector('input[type="number"]');
    expect(input.value).toBe('1990');
    // The boot run + the setParam re-run both fetch.
    const yearsHit = calls.filter((c) => /Year = 1990/.test(c.sql));
    expect(yearsHit.length).toBe(1);
  });

  it('returns false on unknown params', async () => {
    const { rt } = mountSpec({
      title: 'X',
      params: [{ name: 'year', type: 'int', default: 2020 }],
      panels: [],
    });
    await rt.boot();
    expect(rt.setParam('nope', 1)).toBe(false);
  });

  it('returns false when int coercion fails', async () => {
    const { rt } = mountSpec({
      title: 'X',
      params: [{ name: 'year', type: 'int', default: 2020 }],
      panels: [],
    });
    await rt.boot();
    expect(rt.setParam('year', 'banana')).toBe(false);
    expect(rt.params.year).toBe(2020);
  });

  it('handles string and date param types', async () => {
    const { rt } = mountSpec({
      title: 'X',
      params: [
        { name: 'carrier', type: 'string', default: 'WN' },
        { name: 'from', type: 'date', default: '2020-01-01' },
      ],
      panels: [],
    });
    await rt.boot();
    rt.setParam('carrier', 'DL');
    expect(rt.params.carrier).toBe('DL');
    rt.setParam('from', '2024-06-01');
    expect(rt.params.from).toBe('2024-06-01');
  });
});
