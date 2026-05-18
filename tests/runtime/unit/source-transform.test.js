// Source / transform plumbing in SpecRuntime + the runTransform helper.

import { describe, it, expect } from 'vitest';
import {
  renderSpec,
  runTransform,
  createLedger,
  SpecRuntime,
  fmt,
} from '../../../runtime/v1/dash.js';

function mkCtx(rowsById) {
  return {
    api: { fmt },
    ledger: createLedger(),
    fetch: async (id) => ({ rows: rowsById[id] || [], count: (rowsById[id] || []).length }),
  };
}

describe('runTransform — sandbox', () => {
  it('runs a sync function body and returns the result array', () => {
    const out = runTransform('return rows.map(r => ({ y: r.x * 2 }));', [{ x: 1 }, { x: 2 }]);
    expect(out).toEqual([{ y: 2 }, { y: 4 }]);
  });

  it('passes params through frozen', () => {
    const out = runTransform('return [{ p: params.k }];', [], { k: 'v' });
    expect(out).toEqual([{ p: 'v' }]);
  });

  it('freezes input rows (mutation throws in strict mode)', () => {
    expect(() => runTransform(
      'rows[0].x = 99; return rows;',
      [{ x: 1 }],
    )).toThrow();
  });

  it('throws if transform does not return an array', () => {
    expect(() => runTransform('return 42;', [])).toThrow(/must return an array/);
    expect(() => runTransform('return null;', [])).toThrow(/null/);
  });

  it('does not receive ctx/spec/runtime references as bindings', () => {
    // The runtime contract: transform sees only `rows` and `params`
    // as bindings — no DASH/ctx/spec passed in. `new Function` does
    // not close over the caller's locals.
    const out = runTransform('return [{ ctx: typeof ctx, spec: typeof spec }];', []);
    expect(out[0].ctx).toBe('undefined');
    expect(out[0].spec).toBe('undefined');
  });

  it('propagates exceptions raised inside the body', () => {
    expect(() => runTransform('throw new Error("boom");', [])).toThrow('boom');
  });
});

describe('SpecRuntime — source resolution', () => {
  it('passes the source panel rows to the consumer via state.update', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const ctx = mkCtx({ src: [{ a: 1 }, { a: 2 }] });
    const rt = new SpecRuntime({
      panels: [
        { id: 'src', type: 'dataset', query: 'SELECT a' },
        { id: 'con', type: 'table', source: 'src', columns: [{ key: 'a' }] },
      ],
    }, root, ctx);
    await rt.boot();
    expect(rt.panels.con.rows).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('applies transform before passing rows to the consumer', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const ctx = mkCtx({ src: [{ a: 1 }, { a: 2 }] });
    const rt = new SpecRuntime({
      panels: [
        { id: 'src', type: 'dataset', query: 'SELECT a' },
        {
          id: 'con',
          type: 'table',
          source: 'src',
          transform: 'return rows.map(r => ({ b: r.a + 10 }));',
          columns: [{ key: 'b' }],
        },
      ],
    }, root, ctx);
    await rt.boot();
    expect(rt.panels.con.rows).toEqual([{ b: 11 }, { b: 12 }]);
  });

  it('errors when both query and source are set', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const rt = new SpecRuntime({
      panels: [
        { id: 'src', type: 'dataset', query: 'SELECT 1' },
        { id: 'con', type: 'table', source: 'src', query: 'SELECT 1' },
      ],
    }, root, mkCtx({ src: [] }));
    await rt.boot();
    expect(rt.panels.con.el.textContent).toContain('cannot set both');
  });

  it('errors on unknown source', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const rt = new SpecRuntime({
      panels: [
        { id: 'con', type: 'table', source: 'nope' },
      ],
    }, root, mkCtx({}));
    await rt.boot();
    expect(rt.panels.con.el.textContent).toContain('unknown source');
  });

  it('errors on forward reference (source declared after consumer)', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const rt = new SpecRuntime({
      panels: [
        { id: 'con', type: 'table', source: 'src' },
        { id: 'src', type: 'dataset', query: 'SELECT 1' },
      ],
    }, root, mkCtx({ src: [] }));
    await rt.boot();
    expect(rt.panels.con.el.textContent).toContain('must be declared before consumer');
  });

  it('routes a throwing transform to the panel-level error helper', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const rt = new SpecRuntime({
      panels: [
        { id: 'src', type: 'dataset', query: 'SELECT 1' },
        {
          id: 'con',
          type: 'table',
          source: 'src',
          transform: 'return 1;',
          columns: [],
        },
      ],
    }, root, mkCtx({ src: [{ a: 1 }] }));
    await rt.boot();
    expect(rt.panels.con.el.textContent).toContain('must return an array');
  });

  it('works in concurrent mode — consumers wait for their source', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    let resolveSrc;
    const ctx = {
      api: { fmt },
      ledger: createLedger(),
      fetch: (id) => new Promise((res) => {
        if (id === 'src') resolveSrc = () => res({ rows: [{ a: 7 }], count: 1 });
        else res({ rows: [], count: 0 });
      }),
    };
    const rt = new SpecRuntime({
      concurrent: true,
      panels: [
        { id: 'src', type: 'dataset', query: 'SELECT a' },
        {
          id: 'con',
          type: 'table',
          source: 'src',
          transform: 'return rows.map(r => ({ b: r.a }));',
          columns: [{ key: 'b' }],
        },
      ],
    }, root, ctx);
    const booted = rt.boot();
    // Resolve source after a tick to confirm con awaits.
    await new Promise((r) => setTimeout(r, 0));
    expect(rt.panels.con.rows).toEqual([]);
    resolveSrc();
    await booted;
    expect(rt.panels.con.rows).toEqual([{ b: 7 }]);
  });

  it('re-runs consumers when a param re-triggers the source', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    let n = 0;
    const ctx = {
      api: { fmt },
      ledger: createLedger(),
      fetch: async () => { n++; return { rows: [{ a: n }], count: 1 }; },
    };
    const rt = new SpecRuntime({
      params: [{ name: 'y', type: 'int', default: 1 }],
      panels: [
        { id: 'src', type: 'dataset', query: 'SELECT {{y}}' },
        {
          id: 'con',
          type: 'table',
          source: 'src',
          transform: 'return rows;',
          columns: [{ key: 'a' }],
        },
      ],
    }, root, ctx);
    await rt.boot();
    expect(rt.panels.con.rows).toEqual([{ a: 1 }]);
    rt.setParam('y', 2);
    await new Promise((r) => setTimeout(r, 5));
    expect(rt.panels.con.rows).toEqual([{ a: 2 }]);
  });
});

describe('renderSpec end-to-end with dataset+source', () => {
  it('renders one SQL call per dataset, fan-out to consumers', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    let sqlCalls = 0;
    await renderSpec({
      panels: [
        { id: 'src', type: 'dataset', query: 'SELECT 1', state: 'hidden' },
        {
          id: 'c1', type: 'table', source: 'src',
          transform: 'return rows.map(r => ({ ...r, n: 1 }));',
          columns: [{ key: 'n' }],
        },
        {
          id: 'c2', type: 'table', source: 'src',
          transform: 'return rows.map(r => ({ ...r, n: 2 }));',
          columns: [{ key: 'n' }],
        },
      ],
    }, root, {
      chFetch: async () => { sqlCalls++; return { rows: [{ x: 1 }], count: 1 }; },
    });
    expect(sqlCalls).toBe(1);
  });
});
