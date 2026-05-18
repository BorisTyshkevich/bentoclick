import { describe, it, expect, beforeEach } from 'vitest';
import { PANELS, fmt } from '../../../runtime/v1/dash.js';

function makeSpecStub(panels) {
  const handlers = {};
  return {
    panels,
    on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    _emit(ev, payload) { (handlers[ev] || []).forEach((f) => f(payload)); },
  };
}

function ctx(specStub) { return { api: { fmt }, spec: specStub || null }; }
function makeState() { return { id: 'co', rows: [], update: () => {} }; }

describe('renderCallouts', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  const base = {
    type: 'callouts',
    anchor: 'handoffs',
    template: '**{{year}}** — {{old}} → {{new!}}: {{margin|num}}',
  };

  it('shows waiting state when anchor has no rows', () => {
    const stub = makeSpecStub({ handoffs: { rows: [] } });
    const state = makeState();
    const el = PANELS.callouts(base, state, ctx(stub));
    state.update([]);
    expect(el.textContent).toContain('waiting for');
  });

  it('renders one card per anchor row when rows="all"', () => {
    const stub = makeSpecStub({
      handoffs: { rows: [
        { year: 1990, old: 'DL', new: 'US', margin: 1000 },
        { year: 1992, old: 'US', new: 'DL', margin: 2000 },
        { year: 2000, old: 'DL', new: 'WN', margin: 3000 },
      ] },
    });
    const state = makeState();
    const el = PANELS.callouts({ ...base, rows: 'all' }, state, ctx(stub));
    state.update([]);
    expect(el.querySelectorAll('.callout').length).toBe(3);
    // Narrative tweak hook — same as hero.
    expect(el.hasAttribute('data-narrative')).toBe(true);
    expect(el.textContent).toContain('1990');
    expect(el.textContent).toContain('DL');
    expect(el.querySelectorAll('.hl').length).toBe(3); // {{new!}} per row
  });

  it('honors rows=N as a head limit', () => {
    const stub = makeSpecStub({
      handoffs: { rows: [
        { year: 1990, old: 'a', new: 'b', margin: 1 },
        { year: 1991, old: 'a', new: 'b', margin: 2 },
        { year: 1992, old: 'a', new: 'b', margin: 3 },
      ] },
    });
    const state = makeState();
    const el = PANELS.callouts({ ...base, rows: 2 }, state, ctx(stub));
    state.update([]);
    expect(el.querySelectorAll('.callout').length).toBe(2);
  });

  it('honors rows as an explicit index list', () => {
    const stub = makeSpecStub({
      handoffs: { rows: [
        { year: 1990, old: 'a', new: 'b', margin: 1 },
        { year: 1991, old: 'a', new: 'b', margin: 2 },
        { year: 1992, old: 'a', new: 'b', margin: 3 },
      ] },
    });
    const state = makeState();
    const el = PANELS.callouts({ ...base, rows: [0, 2] }, state, ctx(stub));
    state.update([]);
    expect(el.querySelectorAll('.callout').length).toBe(2);
    expect(el.textContent).toContain('1990');
    expect(el.textContent).toContain('1992');
    expect(el.textContent).not.toContain('1991');
  });

  it('formats values with {{key|fmt}}', () => {
    const stub = makeSpecStub({
      handoffs: { rows: [{ year: 1990, old: 'a', new: 'b', margin: 12345 }] },
    });
    const state = makeState();
    const el = PANELS.callouts(base, state, ctx(stub));
    state.update([]);
    expect(el.textContent).toContain('12,345');
  });

  it('redraws when the anchor panel:loaded event fires', () => {
    const stub = makeSpecStub({ handoffs: { rows: [] } });
    const state = makeState();
    const el = PANELS.callouts(base, state, ctx(stub));
    state.update([]);
    expect(el.textContent).toContain('waiting for');
    stub.panels.handoffs.rows = [
      { year: 1990, old: 'DL', new: 'US', margin: 10 },
    ];
    stub._emit('panel:loaded', { id: 'handoffs', rows: stub.panels.handoffs.rows });
    expect(el.querySelectorAll('.callout').length).toBe(1);
    expect(el.textContent).toContain('1990');
  });

  it('does not crash with no spec context', () => {
    const state = makeState();
    const el = PANELS.callouts(base, state, ctx(null));
    state.update([]);
    expect(el.querySelector('.callouts')).not.toBeNull();
  });

  it('escapes raw row values reaching the template (XSS regression)', () => {
    // Each placeholder value runs through applyFormat -> fmt.raw -> fmt.esc
    // before being parked behind a NUL sentinel, so HTML in the row value
    // must render as literal text, never as DOM.
    const stub = makeSpecStub({
      handoffs: { rows: [{
        year: '<img src=x onerror=alert(1)>',
        old: 'DL', new: 'US', margin: 0,
      }] },
    });
    const state = makeState();
    const el = PANELS.callouts(base, state, ctx(stub));
    state.update([]);
    expect(el.querySelectorAll('img').length).toBe(0);
    expect(el.querySelectorAll('script').length).toBe(0);
    expect(el.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
