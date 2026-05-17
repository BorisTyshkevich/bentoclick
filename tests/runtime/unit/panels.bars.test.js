import { describe, it, expect, beforeEach } from 'vitest';
import { PANELS, fmt } from '../../../runtime/v1/dash.js';

function ctx() { return { api: { fmt }, spec: null }; }
function makeState() { return { id: 'b', rows: [], update: () => {} }; }

describe('renderBars', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  const panel = {
    type: 'bars',
    title: 'Monthly',
    label_key: 'label',
    value_key: 'value',
    format: 'num',
  };

  it('renders title and skeleton rows initially', () => {
    const state = makeState();
    const el = PANELS.bars(panel, state, ctx());
    expect(el.querySelector('h2').textContent).toBe('Monthly');
    expect(el.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
  });

  it('scales bar widths to the max value', () => {
    const state = makeState();
    const el = PANELS.bars(panel, state, ctx());
    state.update([
      { label: 'a', value: 100 },
      { label: 'b', value: 50 },
      { label: 'c', value: 25 },
    ]);
    const fills = el.querySelectorAll('.bar-fill');
    expect(fills.length).toBe(3);
    expect(fills[0].style.width).toBe('100.0%');
    expect(fills[1].style.width).toBe('50.0%');
    expect(fills[2].style.width).toBe('25.0%');
  });

  it('formats trailing values with panel.format', () => {
    const state = makeState();
    const el = PANELS.bars(panel, state, ctx());
    state.update([{ label: 'x', value: 12345 }]);
    expect(el.textContent).toContain('12,345');
  });

  it('shows empty_text when rows empty', () => {
    const state = makeState();
    const el = PANELS.bars({ ...panel, empty_text: 'no flights' }, state, ctx());
    state.update([]);
    expect(el.textContent).toContain('no flights');
  });

  it('falls back to defaults when label_key/value_key omitted', () => {
    const state = makeState();
    const el = PANELS.bars({ type: 'bars' }, state, ctx());
    state.update([{ label: 'a', value: 5 }]);
    expect(el.querySelector('.bar-fill')).toBeTruthy();
  });

  it('handles all-zero values (max clamped to 1)', () => {
    const state = makeState();
    const el = PANELS.bars(panel, state, ctx());
    state.update([
      { label: 'a', value: 0 },
      { label: 'b', value: 0 },
    ]);
    const fills = el.querySelectorAll('.bar-fill');
    expect(fills[0].style.width).toBe('0.0%');
  });
});
