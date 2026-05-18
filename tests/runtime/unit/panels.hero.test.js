import { describe, it, expect, beforeEach } from 'vitest';
import { PANELS, fmt } from '../../../runtime/v1/dash.js';

function makeSpecStub(panels) {
  // Minimal spec stub that the hero needs: panels by id, on() event hooks.
  const handlers = {};
  return {
    panels,
    on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    _emit(ev, payload) { (handlers[ev] || []).forEach((f) => f(payload)); },
  };
}

function makeState() { return { id: 'h', update: () => {} }; }
function ctxWith(specStub) { return { api: { fmt }, spec: specStub }; }

describe('renderHero', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('renders a card with title and accent', () => {
    const state = makeState();
    const el = PANELS.hero({
      type: 'hero', title: 'Lead', template: 'No anchor', anchor: 'x',
    }, state, ctxWith(makeSpecStub({})));
    expect(el.classList.contains('hero-card')).toBe(true);
    expect(el.getAttribute('data-accent')).toBe('primary');
    expect(el.querySelector('h2').textContent).toBe('Lead');
    // Narrative tweak hook — tweaks.js flips data-hidden-by-tweak on
    // every [data-narrative] element when the viewer turns the
    // Narrative toggle off.
    expect(el.hasAttribute('data-narrative')).toBe(true);
  });

  it('shows waiting message when anchor has no rows', () => {
    const stub = makeSpecStub({ x: { rows: [] } });
    const state = makeState();
    const el = PANELS.hero({
      type: 'hero', anchor: 'x', template: 'plain',
    }, state, ctxWith(stub));
    state.update([]);
    expect(el.textContent).toContain('waiting for');
  });

  it('substitutes {{field}} from the anchor row', () => {
    const stub = makeSpecStub({ x: { rows: [{ tail: 'N12345', hops: 7 }] } });
    const state = makeState();
    const el = PANELS.hero({
      type: 'hero', anchor: 'x',
      template: 'tail {{tail}} flew {{hops}} legs',
    }, state, ctxWith(stub));
    state.update([]);
    expect(el.querySelector('p').textContent).toBe('tail N12345 flew 7 legs');
  });

  it('formats with {{field|fmt}}', () => {
    const stub = makeSpecStub({ x: { rows: [{ miles: 12345, air: 125 }] } });
    const state = makeState();
    const el = PANELS.hero({
      type: 'hero', anchor: 'x',
      template: '{{miles|num}} miles in {{air|duration}}',
    }, state, ctxWith(stub));
    state.update([]);
    expect(el.querySelector('p').textContent).toBe('12,345 miles in 2h 05m');
  });

  it('highlights with {{field!}}', () => {
    const stub = makeSpecStub({ x: { rows: [{ tail: 'N1' }] } });
    const state = makeState();
    const el = PANELS.hero({
      type: 'hero', anchor: 'x',
      template: 'flag {{tail!}}',
    }, state, ctxWith(stub));
    state.update([]);
    expect(el.innerHTML).toContain('<span class="hl">N1</span>');
  });

  it('substitutes missing field as em-dash, not undefined', () => {
    const stub = makeSpecStub({ x: { rows: [{}] } });
    const state = makeState();
    const el = PANELS.hero({
      type: 'hero', anchor: 'x',
      template: '{{nope}}',
    }, state, ctxWith(stub));
    state.update([]);
    expect(el.textContent.trim()).toBe('—');
  });

  it('inline markdown (bold/italic/code) in template', () => {
    const stub = makeSpecStub({ x: { rows: [{ tail: 'N1' }] } });
    const state = makeState();
    const el = PANELS.hero({
      type: 'hero', anchor: 'x',
      template: '**bold** *em* `code` {{tail}}',
    }, state, ctxWith(stub));
    state.update([]);
    const html = el.querySelector('p').innerHTML;
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>em</em>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('N1');
  });

  it('re-renders when the anchor panel:loaded event fires', () => {
    const stub = makeSpecStub({ x: { rows: [{ v: 1 }] } });
    const state = makeState();
    const el = PANELS.hero({
      type: 'hero', anchor: 'x', template: 'v={{v}}',
    }, state, ctxWith(stub));
    state.update([]);
    expect(el.querySelector('p').textContent).toBe('v=1');
    // Simulate a re-fetch by mutating the rows and emitting panel:loaded.
    stub.panels.x.rows = [{ v: 2 }];
    stub._emit('panel:loaded', { id: 'x', rows: stub.panels.x.rows });
    expect(el.querySelector('p').textContent).toBe('v=2');
  });
});
