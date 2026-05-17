import { describe, it, expect, beforeEach } from 'vitest';
import { PANELS, fmt } from '../../../runtime/v1/dash.js';
import { colorFor } from '../../../runtime/v1/charts.js';

function makeSpecStub(panels) {
  const handlers = {};
  return {
    panels,
    on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    _emit(ev, payload) { (handlers[ev] || []).forEach((f) => f(payload)); },
  };
}
function ctx(specStub) { return { api: { fmt }, spec: specStub || null }; }
function makeState() { return { id: 'ch', rows: [], update: () => {} }; }

describe('renderChart', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  const panel = {
    type: 'chart',
    title: 'Yearly leaders',
    x_key: 'year',
    value_key: 'flights',
    color_by: 'airline',
  };

  it('renders title and accent', () => {
    const state = makeState();
    const el = PANELS.chart({ ...panel, accent: 'warm' }, state, ctx());
    expect(el.querySelector('h2').textContent).toBe('Yearly leaders');
    expect(el.getAttribute('data-accent')).toBe('warm');
  });

  it('renders vertical bars by default with color_by', () => {
    const state = makeState();
    const el = PANELS.chart(panel, state, ctx());
    state.update([
      { year: 2000, flights: 100, airline: 'WN' },
      { year: 2001, flights: 110, airline: 'DL' },
      { year: 2002, flights: 95, airline: 'WN' },
    ]);
    const bars = el.querySelectorAll('rect.chart-bar');
    expect(bars.length).toBe(3);
    expect(bars[0].getAttribute('fill')).toBe(colorFor('WN'));
    expect(bars[0].getAttribute('fill')).toBe(bars[2].getAttribute('fill'));
    expect(bars[0].getAttribute('fill')).not.toBe(bars[1].getAttribute('fill'));
  });

  it('renders horizontal bars when orientation=horizontal', () => {
    const state = makeState();
    const el = PANELS.chart({ ...panel, orientation: 'horizontal' }, state, ctx());
    state.update([
      { year: 2000, flights: 100, airline: 'WN' },
      { year: 2001, flights: 200, airline: 'DL' },
    ]);
    const bars = el.querySelectorAll('rect.chart-bar');
    expect(bars.length).toBe(2);
    // Horizontal: x=0, width scales with value. Higher value → wider bar.
    const w0 = Number(bars[0].getAttribute('width'));
    const w1 = Number(bars[1].getAttribute('width'));
    expect(w1).toBeGreaterThan(w0);
  });

  it('shows empty_text on no rows', () => {
    const state = makeState();
    const el = PANELS.chart({ ...panel, empty_text: 'no data' }, state, ctx());
    state.update([]);
    expect(el.textContent).toContain('no data');
  });

  it('falls back to a single color when color_by is omitted', () => {
    const state = makeState();
    const el = PANELS.chart({ ...panel, color_by: undefined }, state, ctx());
    state.update([
      { year: 2000, flights: 1, airline: 'WN' },
      { year: 2001, flights: 2, airline: 'DL' },
    ]);
    const bars = el.querySelectorAll('rect.chart-bar');
    expect(bars[0].getAttribute('fill')).toBe(bars[1].getAttribute('fill'));
  });

  it('overlays annotations from a sibling panel on vertical bars', () => {
    // drawAnnotations is called from renderChart but was previously
    // untested on chart panels; combo already had this coverage.
    const stub = makeSpecStub({
      flips: { rows: [{ year: 2001, who: 'WN→DL' }] },
    });
    const state = makeState();
    const p = {
      ...panel,
      annotations: { source: 'flips', x_key: 'year', label_key: 'who' },
    };
    const el = PANELS.chart(p, state, ctx(stub));
    state.update([
      { year: 2000, flights: 1, airline: 'WN' },
      { year: 2001, flights: 2, airline: 'DL' },
    ]);
    expect(el.querySelectorAll('.chart-annotation').length).toBe(1);
    expect(el.querySelector('.chart-annotation-label').textContent).toBe('WN→DL');
  });

  it('survives null value rows without NaN width attributes', () => {
    const state = makeState();
    const el = PANELS.chart(panel, state, ctx());
    state.update([
      { year: 2000, flights: 10,   airline: 'WN' },
      { year: 2001, flights: null, airline: 'DL' },
      { year: 2002, flights: 30,   airline: 'WN' },
    ]);
    const heights = Array.from(el.querySelectorAll('rect.chart-bar'))
      .map((r) => r.getAttribute('height'));
    heights.forEach((h) => expect(h).not.toMatch(/NaN/));
  });
});
