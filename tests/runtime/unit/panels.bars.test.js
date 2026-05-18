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
    const fills = el.querySelectorAll('.bc-bars .row-b .fill');
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
    expect(el.querySelector('.bc-bars .row-b .fill')).toBeTruthy();
  });

  it('handles all-zero values (max clamped to 1)', () => {
    const state = makeState();
    const el = PANELS.bars(panel, state, ctx());
    state.update([
      { label: 'a', value: 0 },
      { label: 'b', value: 0 },
    ]);
    const fills = el.querySelectorAll('.bc-bars .row-b .fill');
    expect(fills[0].style.width).toBe('0.0%');
  });

  it('emits the design DOM shape (row-b > lbl + track > fill + val)', () => {
    const state = makeState();
    const el = PANELS.bars(panel, state, ctx());
    state.update([{ label: 'AAA', value: 8 }, { label: 'BBB', value: 2 }]);
    const rows = el.querySelectorAll('.bc-bars > .row-b');
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector('.lbl').textContent).toBe('AAA');
    expect(rows[0].querySelector('.track > .fill')).toBeTruthy();
    expect(rows[0].querySelector('.val').textContent).toBe('8');
    expect(rows[1].querySelector('.val').textContent).toBe('2');
  });

  it('color_key sets the per-row --c custom property + data-multi on wrapper', () => {
    const state = makeState();
    const el = PANELS.bars({ ...panel, color_key: 'col' }, state, ctx());
    state.update([{ label: 'a', value: 1, col: '#ff0000' }]);
    expect(el.querySelector('.bc-bars').hasAttribute('data-multi')).toBe(true);
    const fill = el.querySelector('.fill');
    expect(fill.getAttribute('style')).toMatch(/--c: ?#ff0000/);
  });

  it('color_by maps row values into the chart palette', () => {
    const state = makeState();
    const el = PANELS.bars({ ...panel, color_by: 'group' }, state, ctx());
    state.update([{ label: 'a', value: 1, group: 'WN' }]);
    expect(el.querySelector('.bc-bars').hasAttribute('data-multi')).toBe(true);
    expect(el.querySelector('.fill').getAttribute('style')).toMatch(/--c: ?#/);
  });

  it('subtitle renders below the title when set', () => {
    const state = makeState();
    const el = PANELS.bars({ ...panel, subtitle: 'sub line' }, state, ctx());
    expect(el.querySelector('.ph-sub').textContent).toBe('sub line');
  });
});

describe('renderBars — collapsible', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  const base = { type: 'bars', title: 'B' };
  function rowsN(n) {
    return Array.from({ length: n }, (_, i) => ({ label: 'r' + i, value: i + 1 }));
  }

  it('tags the bars container with bc-bars so collapse CSS matches', () => {
    const state = makeState();
    const el = PANELS.bars(base, state, ctx());
    expect(el.querySelector('.bc-bars')).toBeTruthy();
  });

  it('auto-enables collapsible at rows.length >= 50', () => {
    const state = makeState();
    const el = PANELS.bars(base, state, ctx());
    state.update(rowsN(50));
    expect(el.classList.contains('panel-collapsible')).toBe(true);
    expect(el.querySelector('.panel-toggle .row-count').textContent).toBe('50');
  });

  it('explicit collapsible:true installs chrome regardless of row count', () => {
    const state = makeState();
    const el = PANELS.bars({ ...base, collapsible: true }, state, ctx());
    state.update(rowsN(3));
    expect(el.classList.contains('panel-collapsible')).toBe(true);
    expect(el.classList.contains('collapsed')).toBe(true);
  });

  it('clicking the bottom toggle expands and re-collapses', () => {
    const state = makeState();
    const el = PANELS.bars({ ...base, collapsible: true }, state, ctx());
    state.update(rowsN(2));
    el.querySelector('.panel-toggle').click();
    expect(el.classList.contains('collapsed')).toBe(false);
  });
});
