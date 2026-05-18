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

  it('renders the CSV export icon-btn in the panel-head .ph-meta by default', () => {
    const state = makeState();
    const el = PANELS.table(panel, state, ctx());
    const btn = el.querySelector('.panel-head .ph-meta button.icon-btn');
    expect(btn).toBeTruthy();
    expect(btn.getAttribute('title')).toBe('Export CSV');
  });

  it('omits the CSV button when panel.export === false', () => {
    const state = makeState();
    const el = PANELS.table({ ...panel, export: false }, state, ctx());
    expect(el.querySelector('button.icon-btn')).toBeNull();
  });

  it('builds the panel-head shell with title, optional subtitle, and a row-count stamp', () => {
    const state = makeState();
    const el = PANELS.table({ ...panel, subtitle: 'sub line' }, state, ctx());
    expect(el.classList.contains('panel-shell')).toBe(true);
    expect(el.querySelector('.panel-head .ph-title').textContent).toBe('Top items');
    expect(el.querySelector('.panel-head .ph-sub').textContent).toBe('sub line');
    state.update([{ name: 'a', count: 1 }, { name: 'b', count: 2 }]);
    expect(el.querySelector('.panel-head .ph-stamp').textContent).toBe('2 rows');
    state.update([{ name: 'a', count: 1 }]);
    expect(el.querySelector('.ph-stamp').textContent).toBe('1 row');
  });

  it('applies cell modifier classes when column hints are set', () => {
    const state = makeState();
    const p = {
      ...panel,
      columns: [
        { key: 'name', label: 'Name', mono: true, strong: true },
        { key: 'count', label: 'Count', format: 'num', align: 'right', dim: true },
      ],
    };
    const el = PANELS.table(p, state, ctx());
    state.update([{ name: 'x', count: 7 }]);
    const tds = el.querySelectorAll('tbody td');
    expect(tds[0].className).toContain('cell-mono');
    expect(tds[0].className).toContain('cell-strong');
    expect(tds[1].className).toContain('right');
    expect(tds[1].className).toContain('cell-dim');
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

describe('renderTable — collapsible', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  const basePanel = {
    type: 'table',
    title: 'Items',
    columns: [{ key: 'n', label: 'N', format: 'num', align: 'right' }],
  };
  function rowsN(n) { return Array.from({ length: n }, (_, i) => ({ n: i })); }

  it('wraps the table in .tbl-wrap so the collapse gradient has a host', () => {
    const state = makeState();
    const el = PANELS.table(basePanel, state, ctx());
    const wrap = el.querySelector('.tbl-wrap');
    expect(wrap).toBeTruthy();
    expect(wrap.querySelector('table.bc-tbl')).toBeTruthy();
  });

  it('installs collapsible chrome when collapsible:true is set explicitly', () => {
    const state = makeState();
    const el = PANELS.table({ ...basePanel, collapsible: true }, state, ctx());
    state.update([{ n: 1 }, { n: 2 }]);
    expect(el.classList.contains('panel-collapsible')).toBe(true);
    expect(el.classList.contains('collapsed')).toBe(true);
    expect(el.querySelector('.ph-collapse')).toBeTruthy();
    const toggle = el.querySelector('.panel-toggle');
    expect(toggle).toBeTruthy();
    expect(toggle.querySelector('.row-count').textContent).toBe('2');
  });

  it('auto-enables collapsible at rows.length >= 50', () => {
    const state = makeState();
    const el = PANELS.table(basePanel, state, ctx());
    state.update(rowsN(50));
    expect(el.classList.contains('panel-collapsible')).toBe(true);
    expect(el.querySelector('.panel-toggle .row-count').textContent).toBe('50');
  });

  it('does not collapse below the threshold without opt-in', () => {
    const state = makeState();
    const el = PANELS.table(basePanel, state, ctx());
    state.update(rowsN(49));
    expect(el.classList.contains('panel-collapsible')).toBe(false);
    expect(el.querySelector('.panel-toggle')).toBeNull();
  });

  it('collapsible:false suppresses auto-trigger even on long results', () => {
    const state = makeState();
    const el = PANELS.table({ ...basePanel, collapsible: false }, state, ctx());
    state.update(rowsN(120));
    expect(el.classList.contains('panel-collapsible')).toBe(false);
  });

  it('bottom toggle click flips .collapsed', () => {
    const state = makeState();
    const el = PANELS.table({ ...basePanel, collapsible: true }, state, ctx());
    state.update([{ n: 1 }]);
    expect(el.classList.contains('collapsed')).toBe(true);
    el.querySelector('.panel-toggle').click();
    expect(el.classList.contains('collapsed')).toBe(false);
    el.querySelector('.panel-toggle').click();
    expect(el.classList.contains('collapsed')).toBe(true);
  });

  it('header chevron click flips .collapsed independently', () => {
    const state = makeState();
    const el = PANELS.table({ ...basePanel, collapsible: true }, state, ctx());
    state.update([{ n: 1 }]);
    el.querySelector('.ph-collapse').click();
    expect(el.classList.contains('collapsed')).toBe(false);
  });

  it('state:"visible" overrides the default collapsed-on-install', () => {
    const state = makeState();
    const el = PANELS.table(
      { ...basePanel, collapsible: true, state: 'visible' },
      state,
      ctx(),
    );
    state.update([{ n: 1 }]);
    expect(el.classList.contains('panel-collapsible')).toBe(true);
    expect(el.classList.contains('collapsed')).toBe(false);
  });

  it('row-count chip stays in sync across multiple state.update calls', () => {
    const state = makeState();
    const el = PANELS.table({ ...basePanel, collapsible: true }, state, ctx());
    state.update(rowsN(3));
    expect(el.querySelector('.panel-toggle .row-count').textContent).toBe('3');
    state.update(rowsN(17));
    expect(el.querySelector('.panel-toggle .row-count').textContent).toBe('17');
    // Chrome was only installed once.
    expect(el.querySelectorAll('.panel-toggle').length).toBe(1);
    expect(el.querySelectorAll('.ph-collapse').length).toBe(1);
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
