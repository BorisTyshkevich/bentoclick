// End-to-end spec render: instantiate SpecRuntime against a mocked
// CH_FETCH, walk through a multi-panel spec (combo + table + callouts
// + on_click), and assert that the rendered DOM contains the
// cross-panel artifacts (annotations, callout cards, param-driven
// re-fetch). Lives in tests/e2e/ so it runs through the same vitest
// + happy-dom config as the unit tests.

import { describe, it, expect, beforeEach } from 'vitest';
import { renderSpec } from '../../runtime/v1/dash.js';

function makeFetcher(map) {
  const calls = [];
  function fetch(sql) {
    calls.push(sql);
    for (const re of Object.keys(map)) {
      if (new RegExp(re).test(sql)) {
        const rows = typeof map[re] === 'function' ? map[re](sql) : map[re];
        return Promise.resolve({ rows, count: rows.length });
      }
    }
    return Promise.resolve({ rows: [], count: 0 });
  }
  fetch._calls = calls;
  return fetch;
}

describe('spec-render: combo + annotations + callouts + on_click', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('renders all panels and wires cross-panel features', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const trend = [
      { year: 1998, leader: 'DL', flights: 1200, margin: 30 },
      { year: 1999, leader: 'DL', flights: 1300, margin: 25 },
      { year: 2000, leader: 'WN', flights: 1500, margin: 80 },
      { year: 2001, leader: 'WN', flights: 1600, margin: 100 },
    ];
    const handoffs = [
      { year_of_change: 2000, old_leader: 'DL', new_leader: 'WN', margin_this_year: 1500 },
    ];

    const focusCalls = [];
    const chFetch = makeFetcher({
      'WITH ranked': trend,
      'leadership_handoffs': handoffs,
      'focus_year_kpis': (sql) => {
        focusCalls.push(sql);
        return [{ flights: 42, airlines: 3 }];
      },
    });

    const spec = {
      title: 'Yearly leaders',
      spec_version: 1,
      concurrent: true,
      params: [
        { name: 'focus_year', type: 'int', default: 1999, min: 1987, max: 2025 },
      ],
      panels: [
        {
          id: 'chart', type: 'combo', title: 'Leader and margin',
          query: 'WITH ranked AS (SELECT 1) SELECT * FROM ranked',
          x_key: 'year',
          bars: { key: 'flights', color_by: 'leader', label: 'Flights' },
          line: { key: 'margin', axis: 'right', label: 'Margin' },
          annotations: { source: 'flips', x_key: 'year_of_change', label_key: 'new_leader' },
        },
        {
          id: 'flips', type: 'table', title: 'Handoffs',
          query: 'SELECT * FROM leadership_handoffs',
          columns: [
            { key: 'year_of_change', label: 'Year' },
            { key: 'new_leader', label: 'To' },
          ],
          on_click: { set_param: 'focus_year', from: 'year_of_change' },
        },
        {
          id: 'callouts', type: 'callouts',
          anchor: 'flips', rows: 'all',
          template: '**{{year_of_change}}** {{old_leader}} → {{new_leader!}}',
        },
        {
          id: 'kpis', type: 'kpi-strip',
          query: 'SELECT count() AS flights FROM focus_year_kpis WHERE Year = {{focus_year}}',
          tiles: [{ key: 'flights', label: 'Flights', format: 'num' }],
        },
      ],
    };

    const rt = await renderSpec(spec, root, { chFetch });
    await rt.ready;

    // Combo panel rendered with bars.
    const bars = root.querySelectorAll('#dash-root rect.chart-bar, rect.chart-bar');
    expect(bars.length).toBe(4);

    // Annotation from the handoffs table is overlaid on the chart.
    expect(root.querySelectorAll('.chart-annotation').length).toBe(1);
    expect(root.querySelector('.chart-annotation-label').textContent).toBe('WN');

    // Callouts rendered one card per handoff row.
    expect(root.querySelectorAll('.callout').length).toBe(1);
    expect(root.querySelector('.callout').textContent).toContain('2000');

    // The KPI strip ran with focus_year=1999.
    expect(focusCalls.length).toBe(1);
    expect(focusCalls[0]).toMatch(/Year = 1999/);

    // Click a handoffs row → setParam('focus_year', 2000) → kpi re-fetches.
    const trh = root.querySelector('tr[data-row-index="0"]');
    expect(trh).not.toBeNull();
    trh.dispatchEvent(new Event('click', { bubbles: true }));
    // Allow microtasks for the rerun to fire.
    await Promise.resolve();
    await Promise.resolve();
    expect(focusCalls.length).toBe(2);
    expect(focusCalls[1]).toMatch(/Year = 2000/);
    expect(rt.params.focus_year).toBe(2000);
  });
});
