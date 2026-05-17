import { describe, it, expect, beforeEach } from 'vitest';
import { createLedger } from '../../../runtime/v1/dash.js';

describe('createLedger', () => {
  let ledger;
  let mount;

  beforeEach(() => {
    ledger = createLedger();
    document.body.innerHTML = '<table><tbody id="ledger"></tbody></table>';
    mount = document.getElementById('ledger');
    ledger.mount(mount);
  });

  it('adds an entry with default status Pending', () => {
    ledger.add('q1', 'count', 'primary');
    expect(ledger._items().q1.status).toBe('Pending');
    expect(ledger._order()).toEqual(['q1']);
  });

  it('preserves insertion order across multiple adds', () => {
    ledger.add('a', 'A');
    ledger.add('b', 'B');
    ledger.add('c', 'C');
    expect(ledger._order()).toEqual(['a', 'b', 'c']);
  });

  it('does not duplicate order entries on re-add', () => {
    ledger.add('a', 'A');
    ledger.add('a', 'A again');
    expect(ledger._order()).toEqual(['a']);
    expect(ledger._items().a.label).toBe('A again');
  });

  it('updates status, rows, and sql via up()', () => {
    ledger.add('q', 'count');
    ledger.up('q', 'OK', 42, 'SELECT 1');
    expect(ledger._items().q.status).toBe('OK');
    expect(ledger._items().q.rows).toBe(42);
    expect(ledger._items().q.sql).toBe('SELECT 1');
  });

  it('up() with undefined fields leaves them alone', () => {
    ledger.add('q', 'count');
    ledger.up('q', 'Failed');
    expect(ledger._items().q.status).toBe('Failed');
    expect(ledger._items().q.rows).toBe('—');
  });

  it('up() on unknown id is a no-op', () => {
    expect(() => ledger.up('nope', 'OK', 0)).not.toThrow();
  });

  it('renders one row per item in the mount target', () => {
    ledger.add('a', 'Alpha');
    ledger.add('b', 'Beta');
    ledger.up('a', 'OK', 5);
    const rows = mount.querySelectorAll('tr[data-led-i]:not(.ledger-row-sql)');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Alpha');
    expect(rows[0].textContent).toContain('OK');
    expect(rows[1].textContent).toContain('Pending');
  });

  it('expands the sql row on click of the summary row', () => {
    ledger.add('a', 'Alpha');
    ledger.up('a', 'OK', 5, 'SELECT * FROM t');
    const summary = mount.querySelector('tr[data-led-i="0"]:not(.ledger-row-sql)');
    const sqlRow = mount.querySelector('tr.ledger-row-sql[data-led-i="0"]');
    expect(sqlRow.classList.contains('open')).toBe(false);
    summary.click();
    expect(sqlRow.classList.contains('open')).toBe(true);
    summary.click();
    expect(sqlRow.classList.contains('open')).toBe(false);
  });

  it('omits the toggle arrow when no SQL', () => {
    ledger.add('a', 'A');
    expect(mount.innerHTML).not.toContain('ledger-toggle');
  });

  it('handles items added before mount() (render fires on mount)', () => {
    const l2 = createLedger();
    l2.add('a', 'before');
    const m = document.createElement('tbody');
    l2.mount(m);
    expect(m.querySelectorAll('tr[data-led-i]:not(.ledger-row-sql)').length).toBe(1);
  });
});
