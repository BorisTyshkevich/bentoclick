import { describe, it, expect } from 'vitest';
import {
  chartPalette,
  colorFor,
  linearScale,
  bandScale,
  niceTicks,
  linePath,
  svgRoot,
  axisBottom,
  axisY,
  annotationLine,
  svgEl,
} from '../../../runtime/v1/charts.js';

describe('charts: primitives', () => {
  it('chartPalette has 8 colors', () => {
    expect(chartPalette.length).toBe(8);
    chartPalette.forEach((c) => expect(c).toMatch(/^#[0-9a-f]{6}$/i));
  });

  it('colorFor is stable across calls', () => {
    const a = colorFor('WN');
    const b = colorFor('WN');
    expect(a).toBe(b);
  });

  it('colorFor maps null/undefined to a chartPalette color', () => {
    expect(chartPalette).toContain(colorFor(null));
    expect(chartPalette).toContain(colorFor(undefined));
  });

  it('colorFor uses provided chartPalette', () => {
    const c = colorFor('x', ['#fff']);
    expect(c).toBe('#fff');
  });

  it('linearScale maps domain endpoints to range endpoints', () => {
    const s = linearScale([0, 100], [0, 200]);
    expect(s(0)).toBe(0);
    expect(s(50)).toBe(100);
    expect(s(100)).toBe(200);
  });

  it('linearScale collapses zero-span domain to range midpoint', () => {
    const s = linearScale([5, 5], [0, 100]);
    expect(s(5)).toBe(50);
    expect(s(99)).toBe(50);
  });

  it('bandScale centers bands within the range', () => {
    const s = bandScale(['a', 'b', 'c'], [0, 300], 0);
    // step = 100, so centers at 50, 150, 250.
    expect(s('a')).toBe(50);
    expect(s('b')).toBe(150);
    expect(s('c')).toBe(250);
    expect(s('missing')).toBe(null);
    expect(s.bandwidth).toBe(100);
  });

  it('bandScale honors paddingInner', () => {
    const s = bandScale(['a', 'b'], [0, 100], 0.5);
    expect(s.bandwidth).toBeCloseTo(25, 6);
  });

  it('niceTicks produces rounded boundaries', () => {
    const t = niceTicks(0, 100, 5);
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(100);
    // Each step should be a power-of-10 multiple of {1,2,5,10}.
    const step = t[1] - t[0];
    expect([1, 2, 5, 10, 20, 50, 100]).toContain(step);
  });

  it('niceTicks handles min == max', () => {
    expect(niceTicks(0, 0)).toEqual([0, 1]);
    const t = niceTicks(5, 5);
    expect(t).toContain(5);
    expect(t.length).toBe(3);
  });

  it('niceTicks handles non-finite as a singleton', () => {
    expect(niceTicks(Infinity, -Infinity)).toEqual([0]);
  });

  it('niceTicks picks a 2-step when the rough step is in the 1.5..3 band', () => {
    const t = niceTicks(0, 20, 10);
    const step = t[1] - t[0];
    expect(step).toBe(2);
  });

  it('niceTicks picks a 5-step when the rough step is in the 3..7 band', () => {
    const t = niceTicks(0, 50, 10);
    const step = t[1] - t[0];
    expect(step).toBe(5);
  });

  it('niceTicks picks a 10-step when the rough step rounds up past 7', () => {
    const t = niceTicks(0, 80, 10);
    const step = t[1] - t[0];
    expect(step).toBe(10);
  });

  it('linePath builds M then L commands', () => {
    expect(linePath([[0, 0], [10, 20], [20, 40]])).toBe('M0,0L10,20L20,40');
  });

  it('linePath skips non-finite points', () => {
    expect(linePath([[0, 0], [NaN, 5], [10, 10]])).toBe('M0,0L10,10');
    expect(linePath([])).toBe('');
  });

  it('svgRoot returns inner-dim helpers', () => {
    const r = svgRoot({ width: 100, height: 50 });
    expect(r.iw).toBe(100 - r.pad.left - r.pad.right);
    expect(r.ih).toBe(50 - r.pad.top - r.pad.bottom);
    expect(r.svg.querySelector('g')).toBe(r.plot);
  });

  it('axisBottom emits a line and one tick per value', () => {
    const xScale = bandScale(['a', 'b'], [0, 100], 0);
    const g = axisBottom({ ticks: ['a', 'b'], scale: xScale, iw: 100, ih: 80 });
    expect(g.querySelector('.chart-axis-line')).not.toBeNull();
    expect(g.querySelectorAll('.chart-tick').length).toBe(2);
    expect(g.querySelectorAll('.chart-tick-label').length).toBe(2);
  });

  it('axisY emits grid lines unless disabled', () => {
    const yScale = linearScale([0, 10], [80, 0]);
    const g = axisY({ ticks: [0, 5, 10], scale: yScale, iw: 100, ih: 80 });
    expect(g.querySelectorAll('.chart-grid').length).toBe(3);
    const g2 = axisY({ ticks: [0, 5, 10], scale: yScale, iw: 100, ih: 80, grid: false });
    expect(g2.querySelectorAll('.chart-grid').length).toBe(0);
  });

  it('axisY right-orient anchors text on the right side', () => {
    const yScale = linearScale([0, 10], [80, 0]);
    const g = axisY({ ticks: [0, 10], scale: yScale, iw: 100, ih: 80, orient: 'right' });
    expect(g.classList.contains('chart-axis-right')).toBe(true);
    const label = g.querySelector('.chart-tick-label');
    expect(label.getAttribute('text-anchor')).toBe('start');
  });

  it('annotationLine renders a vertical line and label', () => {
    const g = annotationLine({ x: 42, ih: 80, label: 'flip' });
    expect(g.querySelector('line').getAttribute('x1')).toBe('42');
    expect(g.querySelector('text').textContent).toBe('flip');
  });

  it('annotationLine omits the label element when label is empty', () => {
    const g = annotationLine({ x: 10, ih: 80, label: '' });
    expect(g.querySelector('text')).toBeNull();
  });

  it('svgEl sets only non-null attributes', () => {
    const e = svgEl('rect', { x: 0, y: 1, width: null, fill: '#fff' });
    expect(e.getAttribute('x')).toBe('0');
    expect(e.getAttribute('fill')).toBe('#fff');
    expect(e.hasAttribute('width')).toBe(false);
  });
});
