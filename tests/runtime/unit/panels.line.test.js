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
function makeState() { return { id: 'l', rows: [], update: () => {} }; }

describe('renderLine', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('renders title and accent', () => {
    const state = makeState();
    const el = PANELS.line({
      type: 'line', title: 'Yearly', accent: 'primary',
      x_key: 'year', series: [{ key: 'v', label: 'V' }],
    }, state, ctx());
    expect(el.querySelector('h2').textContent).toBe('Yearly');
    expect(el.getAttribute('data-accent')).toBe('primary');
  });

  it('shows empty_text when rows are empty', () => {
    const state = makeState();
    const el = PANELS.line({
      type: 'line', x_key: 'year', series: [{ key: 'v', label: 'V' }],
      empty_text: 'no flights',
    }, state, ctx());
    state.update([]);
    expect(el.textContent).toContain('no flights');
  });

  it('draws a path with multiple points for a single series', () => {
    const state = makeState();
    const el = PANELS.line({
      type: 'line', x_key: 'year', series: [{ key: 'v', label: 'V' }],
    }, state, ctx());
    state.update([
      { year: 2020, v: 10 },
      { year: 2021, v: 20 },
      { year: 2022, v: 30 },
    ]);
    const path = el.querySelector('path.chart-line');
    expect(path).not.toBeNull();
    expect(path.getAttribute('d')).toMatch(/^M\d/);
    // Three data points → three circles.
    expect(el.querySelectorAll('circle.chart-point').length).toBe(3);
  });

  it('renders multiple series and a legend', () => {
    const state = makeState();
    const el = PANELS.line({
      type: 'line', x_key: 'year',
      series: [
        { key: 'a', label: 'Alpha' },
        { key: 'b', label: 'Beta' },
      ],
    }, state, ctx());
    state.update([
      { year: 2020, a: 5, b: 50 },
      { year: 2021, a: 8, b: 80 },
    ]);
    expect(el.querySelectorAll('path.chart-line').length).toBe(2);
    expect(el.querySelector('.chart-legend')).not.toBeNull();
    expect(el.querySelector('.chart-legend').textContent).toContain('Alpha');
    expect(el.querySelector('.chart-legend').textContent).toContain('Beta');
  });

  it('pivots from series_key + value_key long format', () => {
    const state = makeState();
    const el = PANELS.line({
      type: 'line', x_key: 'year', series_key: 'k', value_key: 'v',
    }, state, ctx());
    state.update([
      { year: 2020, k: 'a', v: 1 },
      { year: 2020, k: 'b', v: 2 },
      { year: 2021, k: 'a', v: 3 },
      { year: 2021, k: 'b', v: 4 },
    ]);
    expect(el.querySelectorAll('path.chart-line').length).toBe(2);
    // Multi-series triggers the legend, each item rendered with the
    // 2px line-swatch variant (.sw.line).
    const items = el.querySelectorAll('.chart-legend .item');
    expect(items.length).toBe(2);
    items.forEach((it) => {
      expect(it.querySelector('.sw').classList.contains('line')).toBe(true);
    });
  });

  it('draws annotations when source panel has rows', () => {
    const stub = makeSpecStub({
      handoffs: { rows: [{ y: 2000, who: 'WN' }, { y: 1990, who: 'US' }] },
    });
    const state = makeState();
    const el = PANELS.line({
      type: 'line', x_key: 'year', series: [{ key: 'v' }],
      annotations: { source: 'handoffs', x_key: 'y', label_key: 'who' },
    }, state, ctx(stub));
    state.update([
      { year: 1990, v: 1 }, { year: 2000, v: 2 }, { year: 2010, v: 3 },
    ]);
    const ann = el.querySelectorAll('.chart-annotation');
    expect(ann.length).toBe(2);
    const labels = Array.from(el.querySelectorAll('.chart-annotation-label')).map((t) => t.textContent);
    expect(labels).toContain('WN');
    expect(labels).toContain('US');
  });

  it('redraws annotations when source panel emits panel:loaded', () => {
    const stub = makeSpecStub({ src: { rows: [] } });
    const state = makeState();
    const el = PANELS.line({
      type: 'line', x_key: 'year', series: [{ key: 'v' }],
      annotations: { source: 'src', x_key: 'y', label_key: 'l' },
    }, state, ctx(stub));
    state.update([{ year: 2000, v: 1 }, { year: 2001, v: 2 }]);
    expect(el.querySelectorAll('.chart-annotation').length).toBe(0);
    stub.panels.src.rows = [{ y: 2000, l: 'A' }];
    stub._emit('panel:loaded', { id: 'src', rows: stub.panels.src.rows });
    expect(el.querySelectorAll('.chart-annotation').length).toBe(1);
  });

  it('survives null series values without emitting NaN in the path', () => {
    const state = makeState();
    const el = PANELS.line({
      type: 'line', x_key: 'year', series: [{ key: 'v' }],
    }, state, ctx());
    state.update([
      { year: 2000, v: null },
      { year: 2001, v: 5 },
      { year: 2002, v: null },
      { year: 2003, v: 10 },
    ]);
    const d = el.querySelector('path.chart-line').getAttribute('d');
    expect(d).not.toMatch(/NaN/);
  });

  it('decimates x ticks when there are many points', () => {
    const state = makeState();
    const el = PANELS.line({
      type: 'line', x_key: 'year', series: [{ key: 'v' }],
    }, state, ctx());
    const rows = [];
    for (let i = 0; i < 40; i++) rows.push({ year: 1987 + i, v: i });
    state.update(rows);
    const labels = el.querySelectorAll('.chart-axis-x .chart-tick-label');
    // Decimation cap is 8 visible ticks.
    expect(labels.length).toBeLessThanOrEqual(8);
  });

  it('wraps the SVG in panel-shell + panel-head + panel-body, with auto stamp', () => {
    const state = makeState();
    state.elapsedMs = 73;
    const el = PANELS.line({
      type: 'line', title: 'L', subtitle: 'sub', x_key: 'year', series: [{ key: 'v' }],
    }, state, ctx());
    expect(el.classList.contains('panel-shell')).toBe(true);
    expect(el.querySelector('.panel-head .ph-title').textContent).toBe('L');
    expect(el.querySelector('.panel-head .ph-sub').textContent).toBe('sub');
    state.update([{ year: 1987, v: 1 }, { year: 1990, v: 2 }, { year: 2025, v: 3 }]);
    expect(el.querySelector('.ph-stamp').textContent).toBe('1987 – 2025 · 73 ms');
    // Single-x case collapses to a single value, not a range.
    state.update([{ year: 2020, v: 5 }]);
    expect(el.querySelector('.ph-stamp').textContent).toBe('2020 · 73 ms');
  });

  it('multi-series legend falls back to key when series has no label', () => {
    const state = makeState();
    const el = PANELS.line({
      type: 'line', x_key: 'year',
      series: [{ key: 'a' }, { key: 'b' }],
    }, state, ctx());
    state.update([{ year: 2024, a: 1, b: 2 }]);
    const labels = Array.from(el.querySelectorAll('.chart-legend .item'))
      .map((it) => it.textContent);
    expect(labels).toEqual(['a', 'b']);
  });

  it('stamp handles null x values without throwing', () => {
    const state = makeState();
    const el = PANELS.line({
      type: 'line', title: 'L', x_key: 'year', series: [{ key: 'v' }],
    }, state, ctx());
    state.update([{ year: null, v: 1 }, { year: 2025, v: 2 }]);
    // First x is null → coerces to empty string; last is 2025.
    expect(el.querySelector('.ph-stamp').textContent).toContain('2025');
  });

  it('stamp omits the ·ms suffix when no elapsedMs is known', () => {
    const state = makeState();
    const el = PANELS.line({
      type: 'line', title: 'L', x_key: 'year', series: [{ key: 'v' }],
    }, state, ctx());
    state.update([{ year: 2024, v: 1 }, { year: 2025, v: 2 }]);
    expect(el.querySelector('.ph-stamp').textContent).toBe('2024 – 2025');
  });
});
