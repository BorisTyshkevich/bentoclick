// dataset panel — hidden / visible / collapsed render modes.

import { describe, it, expect } from 'vitest';
import { renderDataset } from '../../../runtime/v1/dash.js';

function mkState() { return { rows: [], update: () => {} }; }

describe('renderDataset', () => {
  it('returns a hidden placeholder by default', () => {
    const state = mkState();
    const el = renderDataset({ id: 'd', type: 'dataset' }, state);
    expect(el.classList.contains('dataset-placeholder')).toBe(true);
    expect(el.style.display).toBe('none');
    // update is a no-op in hidden mode but must be callable.
    expect(() => state.update([{ a: 1 }])).not.toThrow();
  });

  it('returns a hidden placeholder for state="hidden"', () => {
    const el = renderDataset({ id: 'd', type: 'dataset', state: 'hidden' }, mkState());
    expect(el.classList.contains('dataset-placeholder')).toBe(true);
  });

  it('renders title + meta + preview table for state="visible"', () => {
    const state = mkState();
    const el = renderDataset(
      { id: 'd', type: 'dataset', state: 'visible', title: 'My data' },
      state,
    );
    expect(el.classList.contains('dataset')).toBe(true);
    expect(el.querySelector('h2').textContent).toBe('My data');
    expect(el.querySelector('.dataset-rows').textContent).toBe('rows: —');
    // tbl-wrap + bc-tbl form the host for the partial-collapse CSS.
    expect(el.querySelector('.tbl-wrap')).toBeTruthy();
    expect(el.querySelector('table.bc-tbl')).toBeTruthy();
    state.update([{ x: 1, y: 'a' }, { x: 2, y: 'b' }]);
    expect(el.querySelector('.dataset-rows').textContent).toBe('rows: 2');
    // Columns derived from row keys.
    const headers = Array.from(el.querySelectorAll('thead th')).map(t => t.textContent);
    expect(headers).toEqual(['x', 'y']);
    // Two body rows.
    expect(el.querySelectorAll('tbody tr').length).toBe(2);
  });

  it('starts collapsed with full chrome when state="collapsed"', () => {
    const state = mkState();
    const el = renderDataset(
      { id: 'd', type: 'dataset', state: 'collapsed', title: 'C' },
      state,
    );
    expect(el.classList.contains('panel-collapsible')).toBe(true);
    expect(el.classList.contains('collapsed')).toBe(true);
    expect(el.querySelector('.ph-collapse')).toBeTruthy();
    expect(el.querySelector('.panel-toggle')).toBeTruthy();
    state.update([{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }, { a: 5 }, { a: 6 }]);
    expect(el.querySelector('.panel-toggle .row-count').textContent).toBe('6');
  });

  it('starts expanded with chrome when state="visible"', () => {
    const state = mkState();
    const el = renderDataset(
      { id: 'd', type: 'dataset', state: 'visible' },
      state,
    );
    expect(el.classList.contains('panel-collapsible')).toBe(true);
    expect(el.classList.contains('collapsed')).toBe(false);
    expect(el.querySelector('.panel-toggle')).toBeTruthy();
  });

  it('clicking the toggle flips .collapsed', () => {
    const state = mkState();
    const el = renderDataset(
      { id: 'd', type: 'dataset', state: 'collapsed' },
      state,
    );
    el.querySelector('.panel-toggle').click();
    expect(el.classList.contains('collapsed')).toBe(false);
    el.querySelector('.ph-collapse').click();
    expect(el.classList.contains('collapsed')).toBe(true);
  });

  it('omits the title h2 when visible without a title', () => {
    const el = renderDataset({ id: 'd', type: 'dataset', state: 'visible' }, mkState());
    expect(el.querySelector('h2')).toBeNull();
  });

  it('renders a no-rows placeholder for empty/null updates without throwing', () => {
    const state = mkState();
    const el = renderDataset({ id: 'd', type: 'dataset', state: 'visible' }, state);
    expect(() => state.update(null)).not.toThrow();
    expect(el.querySelector('tbody').textContent).toContain('no rows');
    state.update([]);
    expect(el.querySelector('tbody').textContent).toContain('no rows');
  });

  it('escapes cell content (no raw HTML injection)', () => {
    const state = mkState();
    const el = renderDataset({ id: 'd', type: 'dataset', state: 'visible' }, state);
    state.update([{ name: '<img src=x>' }]);
    // The literal tag text should appear, not an injected img element.
    expect(el.querySelector('tbody').innerHTML).toContain('&lt;img');
    expect(el.querySelector('tbody img')).toBeNull();
  });

  it('caps the preview to 50 rows by default and annotates the meta', () => {
    const state = mkState();
    const el = renderDataset({ id: 'd', type: 'dataset', state: 'visible' }, state);
    state.update(Array.from({ length: 1000 }, (_, i) => ({ n: i })));
    expect(el.querySelectorAll('tbody tr').length).toBe(50);
    expect(el.querySelector('.dataset-rows').textContent).toContain('rows: 1000');
    expect(el.querySelector('.dataset-rows').textContent).toContain('showing first 50');
  });

  it('preview_limit lets authors widen or shrink the cap', () => {
    const state = mkState();
    const el = renderDataset(
      { id: 'd', type: 'dataset', state: 'visible', preview_limit: 5 },
      state,
    );
    state.update(Array.from({ length: 100 }, (_, i) => ({ n: i })));
    expect(el.querySelectorAll('tbody tr').length).toBe(5);
    expect(el.querySelector('.dataset-rows').textContent).toContain('showing first 5');
  });
});
