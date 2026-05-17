import { describe, it, expect, beforeEach } from 'vitest';
import { PANELS, fmt } from '../../../runtime/v1/dash.js';
import { colorFor } from '../../../runtime/v1/charts.js';

function ctx() { return { api: { fmt }, spec: null }; }
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
});
