// applyPanelState — chrome behavior for the three state values.

import { describe, it, expect } from 'vitest';
import { applyPanelState, renderPanelShell } from '../../../runtime/v1/dash.js';

describe('applyPanelState', () => {
  it('sets data-state=visible by default for non-dataset panels', () => {
    const el = document.createElement('div');
    applyPanelState(el, { type: 'table' });
    expect(el.getAttribute('data-state')).toBe('visible');
  });

  it('defaults to hidden for dataset panels', () => {
    const el = document.createElement('div');
    applyPanelState(el, { type: 'dataset' });
    expect(el.getAttribute('data-state')).toBe('hidden');
  });

  it('honors explicit state="collapsed"', () => {
    const el = document.createElement('div');
    applyPanelState(el, { type: 'table', state: 'collapsed' });
    expect(el.getAttribute('data-state')).toBe('collapsed');
  });

  it('honors explicit state="hidden" on visual panels', () => {
    const el = document.createElement('div');
    applyPanelState(el, { type: 'table', state: 'hidden' });
    expect(el.getAttribute('data-state')).toBe('hidden');
  });

  it('honors explicit state="visible" on datasets', () => {
    const el = document.createElement('div');
    applyPanelState(el, { type: 'dataset', state: 'visible' });
    expect(el.getAttribute('data-state')).toBe('visible');
  });

  it('falls back to default when state is an unrecognized value', () => {
    const el = document.createElement('div');
    applyPanelState(el, { type: 'table', state: 'bogus' });
    expect(el.getAttribute('data-state')).toBe('visible');
  });

  it('is a no-op for missing card', () => {
    expect(() => applyPanelState(null, { type: 'table' })).not.toThrow();
  });
});

describe('renderPanelShell — state attribute applied', () => {
  it('sets data-state on the rendered card via renderPanelShell', () => {
    const panel = { type: 'markdown', text: 'hi', state: 'collapsed' };
    const state = { rows: [], update: () => {} };
    const el = renderPanelShell(panel, state, { api: {}, spec: null });
    expect(el.getAttribute('data-state')).toBe('collapsed');
  });

  it('unknown panel type yields a card and still gets data-state', () => {
    const panel = { type: 'no-such-type', title: 'x' };
    const state = { rows: [], update: () => {} };
    const el = renderPanelShell(panel, state, { api: {}, spec: null });
    expect(el.textContent).toContain('Unknown panel type');
    // Unknown-type path returns before applyPanelState — that branch is
    // intentionally not state-aware, so it should not carry data-state.
    expect(el.getAttribute('data-state')).toBeNull();
  });
});
