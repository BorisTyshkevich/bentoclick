import { describe, it, expect, beforeEach } from 'vitest';
import { PANELS, pickBadgeClass, buildCsv, fmt } from '../../../runtime/v1/dash.js';

function ctx() { return { api: { fmt }, spec: null }; }
function makeState() {
  return { id: 't', rows: [], update: () => {} };
}

describe('renderTable', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  const panel = {
    type: 'table',
    title: 'Top items',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'count', label: 'Count', format: 'num', align: 'right' },
    ],
  };

  it('renders header from columns', () => {
    const state = makeState();
    const el = PANELS.table(panel, state, ctx());
    const headers = Array.from(el.querySelectorAll('thead th')).map(t => t.textContent);
    expect(headers).toEqual(['Name', 'Count']);
    expect(el.querySelector('thead th.right')).toBeTruthy();
  });

  it('emits <table class="bc-tbl"> so the refreshed table styling applies', () => {
    const state = makeState();
    const el = PANELS.table(panel, state, ctx());
    const tbl = el.querySelector('table');
    expect(tbl).toBeTruthy();
    expect(tbl.classList.contains('bc-tbl')).toBe(true);
  });

  it('renders a row per data item with formatters', () => {
    const state = makeState();
    const el = PANELS.table(panel, state, ctx());
    state.update([
      { name: 'a', count: 12345 },
      { name: 'b', count: 6 },
    ]);
    const rows = el.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    expect(rows[0].cells[0].textContent).toBe('a');
    expect(rows[0].cells[1].textContent).toBe('12,345');
    expect(rows[0].cells[1].classList.contains('right')).toBe(true);
  });

  it('shows empty_text when rows is empty', () => {
    const p2 = { ...panel, empty_text: 'no matches' };
    const state = makeState();
    const el = PANELS.table(p2, state, ctx());
    state.update([]);
    expect(el.querySelector('tbody').textContent).toContain('no matches');
  });

  it('exposes state.tbodyEl for click-hookups', () => {
    const state = makeState();
    PANELS.table(panel, state, ctx());
    expect(state.tbodyEl).toBeTruthy();
    expect(state.tbodyEl.tagName).toBe('TBODY');
  });

  it('renders the CSV export button by default', () => {
    const state = makeState();
    const el = PANELS.table(panel, state, ctx());
    expect(el.querySelector('button.btn-mini')).toBeTruthy();
  });

  it('omits the CSV button when panel.export === false', () => {
    const state = makeState();
    const el = PANELS.table({ ...panel, export: false }, state, ctx());
    expect(el.querySelector('button.btn-mini')).toBeNull();
  });

  it('applies a badge class via thresholds', () => {
    const p3 = {
      ...panel,
      columns: [
        { key: 'name', label: 'Name' },
        { key: 'count', label: 'Count', format: 'num',
          badge: { '20+': 'high', '5+': 'mid', '0+': 'low' } },
      ],
    };
    const state = makeState();
    const el = PANELS.table(p3, state, ctx());
    state.update([
      { name: 'a', count: 25 },
      { name: 'b', count: 7 },
      { name: 'c', count: 1 },
    ]);
    const badges = el.querySelectorAll('.cell-badge');
    expect(badges.length).toBe(3);
    expect(badges[0].className).toContain('cell-badge-high');
    expect(badges[1].className).toContain('cell-badge-mid');
    expect(badges[2].className).toContain('cell-badge-low');
  });
});

describe('pickBadgeClass', () => {
  it('returns null without spec', () => {
    expect(pickBadgeClass(null, 5)).toBe(null);
    expect(pickBadgeClass({}, 5)).toBe(null);
  });
  it('matches descending thresholds, first match wins', () => {
    const spec = { '20+': 'high', '5+': 'mid', '0+': 'low' };
    expect(pickBadgeClass(spec, 25)).toBe('high');
    expect(pickBadgeClass(spec, 20)).toBe('high');
    expect(pickBadgeClass(spec, 19)).toBe('mid');
    expect(pickBadgeClass(spec, 5)).toBe('mid');
    expect(pickBadgeClass(spec, 0)).toBe('low');
  });
  it('handles compact form { high: N, mid: M, low: 0 }', () => {
    const spec = { high: 20, mid: 5, low: 0 };
    expect(pickBadgeClass(spec, 25)).toBe('high');
    expect(pickBadgeClass(spec, 10)).toBe('mid');
    expect(pickBadgeClass(spec, 0)).toBe('low');
  });
  it('returns null for non-numeric strings', () => {
    const spec = { '20+': 'high', '0+': 'low' };
    expect(pickBadgeClass(spec, 'oops')).toBe(null);
    expect(pickBadgeClass(spec, undefined)).toBe(null);
  });

  it('coerces null to 0 (Number(null) === 0)', () => {
    const spec = { '20+': 'high', '0+': 'low' };
    expect(pickBadgeClass(spec, null)).toBe('low');
  });
});

describe('buildCsv', () => {
  it('produces RFC-4180-style quoted output', () => {
    const panel = {
      columns: [
        { key: 'a', label: 'A' },
        { key: 'b', label: 'B' },
      ],
    };
    const csv = buildCsv(panel, [
      { a: 'hello', b: 1 },
      { a: 'has "quote"', b: null },
    ]);
    expect(csv).toBe('"A","B"\n"hello","1"\n"has ""quote""",""');
  });
  it('uses column key when label missing', () => {
    const csv = buildCsv(
      { columns: [{ key: 'x' }] },
      [{ x: 7 }],
    );
    expect(csv).toBe('"x"\n"7"');
  });
  it('handles empty rows', () => {
    const csv = buildCsv(
      { columns: [{ key: 'a', label: 'A' }] },
      [],
    );
    expect(csv).toBe('"A"');
  });
});
