import { describe, it, expect, beforeEach } from 'vitest';
import { PANELS, fmt } from '../../../runtime/v1/dash.js';

function ctx() {
  return { api: { fmt }, spec: null };
}

function makeState() {
  return { id: 'k', panel: null, rows: [], update: () => {} };
}

describe('renderKpiStrip', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('renders one tile per measurable', () => {
    const panel = {
      type: 'kpi-strip',
      tiles: [
        { key: 'a', label: 'Alpha' },
        { key: 'b', label: 'Beta' },
        { key: 'c', label: 'Gamma' },
      ],
    };
    const state = makeState();
    const el = PANELS['kpi-strip'](panel, state, ctx());
    document.body.appendChild(el);
    expect(el.classList.contains('kpi-strip')).toBe(true);
    expect(el.querySelectorAll('.card.kpi').length).toBe(3);
  });

  it('starts with skeleton loading state', () => {
    const panel = {
      type: 'kpi-strip',
      tiles: [{ key: 'a', label: 'A' }],
    };
    const state = makeState();
    const el = PANELS['kpi-strip'](panel, state, ctx());
    const v = el.querySelector('.v');
    expect(v.classList.contains('loading')).toBe(true);
    expect(v.classList.contains('skeleton')).toBe(true);
  });

  it('writes formatted values on update', () => {
    const panel = {
      type: 'kpi-strip',
      tiles: [
        { key: 'count', label: 'Count', format: 'num' },
        { key: 'rate', label: 'Rate', format: 'pct' },
      ],
    };
    const state = makeState();
    const el = PANELS['kpi-strip'](panel, state, ctx());
    state.update([{ count: 12345, rate: 0.423 }]);
    const vs = el.querySelectorAll('.v');
    expect(vs[0].textContent).toBe('12,345');
    expect(vs[1].textContent).toBe('42.3%');
    expect(vs[0].classList.contains('loading')).toBe(false);
    expect(vs[0].classList.contains('skeleton')).toBe(false);
  });

  it('handles a missing measurable as empty', () => {
    const panel = {
      type: 'kpi-strip',
      tiles: [{ key: 'missing', label: 'X', format: 'raw' }],
    };
    const state = makeState();
    const el = PANELS['kpi-strip'](panel, state, ctx());
    state.update([{}]);
    expect(el.querySelector('.v').textContent).toBe('');
  });

  it('renders the third "note" line from a literal', () => {
    const panel = {
      type: 'kpi-strip',
      tiles: [{ key: 'a', label: 'A', note: 'literal note' }],
    };
    const state = makeState();
    const el = PANELS['kpi-strip'](panel, state, ctx());
    state.update([{ a: 1 }]);
    expect(el.querySelector('.n').textContent).toBe('literal note');
  });

  it('renders the third "note" line from a column', () => {
    const panel = {
      type: 'kpi-strip',
      tiles: [{ key: 'a', label: 'A', note_key: 'detail' }],
    };
    const state = makeState();
    const el = PANELS['kpi-strip'](panel, state, ctx());
    state.update([{ a: 1, detail: 'extra info' }]);
    expect(el.querySelector('.n').textContent).toBe('extra info');
  });

  it('uses format_fn for value when provided', () => {
    const panel = {
      type: 'kpi-strip',
      tiles: [{ key: 'who', label: 'Who', format_fn: 'fmt.shortEmail' }],
    };
    const state = makeState();
    const el = PANELS['kpi-strip'](panel, state, ctx());
    state.update([{ who: 'alice@example.com' }]);
    expect(el.querySelector('.v').textContent).toBe('alice');
  });

  it('applies tile accent attribute', () => {
    const panel = {
      type: 'kpi-strip',
      tiles: [{ key: 'a', label: 'A', accent: 'primary' }],
    };
    const state = makeState();
    const el = PANELS['kpi-strip'](panel, state, ctx());
    expect(el.querySelector('.card.kpi').getAttribute('data-accent')).toBe('primary');
  });

  it('survives empty rows array (renders nothing)', () => {
    const panel = {
      type: 'kpi-strip',
      tiles: [{ key: 'a', label: 'A' }],
    };
    const state = makeState();
    const el = PANELS['kpi-strip'](panel, state, ctx());
    state.update([]);
    expect(el.querySelector('.v').textContent).toBe('');
  });
});
