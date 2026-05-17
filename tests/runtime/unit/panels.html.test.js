import { describe, it, expect } from 'vitest';
import { PANELS, fmt } from '../../../runtime/v1/dash.js';

function ctx() { return { api: { fmt }, spec: null }; }
function makeState() { return { id: 'h', update: () => {} }; }

describe('renderHtml — static', () => {
  it('renders the html field verbatim into the body', () => {
    const state = makeState();
    const el = PANELS.html({
      type: 'html',
      html: '<div class="note">hello world</div>',
    }, state, ctx());
    expect(el.querySelector('.dash-html-body').innerHTML).toBe(
      '<div class="note">hello world</div>'
    );
  });

  it('preserves benign HTML untouched', () => {
    // Note: sanitization is the MV's job, NOT this renderer's. The
    // assumption is that anything reaching the renderer has already
    // been sanitized server-side.
    const state = makeState();
    const el = PANELS.html({
      type: 'html',
      html: '<b>bold</b> and <i>italic</i>',
    }, state, ctx());
    expect(el.textContent).toBe('bold and italic');
    expect(el.querySelector('.dash-html-body b')).toBeTruthy();
    expect(el.querySelector('.dash-html-body i')).toBeTruthy();
  });

  it('renders title above body when provided', () => {
    const state = makeState();
    const el = PANELS.html({
      type: 'html', title: 'Note', html: '<p>x</p>',
    }, state, ctx());
    expect(el.querySelector('h2').textContent).toBe('Note');
  });
});

describe('renderHtml — templated', () => {
  it('shows skeleton until first update', () => {
    const state = makeState();
    const el = PANELS.html({
      type: 'html',
      query: 'SELECT 1',
      template: 'value: {{rows[0].x}}',
    }, state, ctx());
    expect(el.querySelector('.skeleton')).toBeTruthy();
  });

  it('substitutes {{rows[N].field}} after update', () => {
    const state = makeState();
    const el = PANELS.html({
      type: 'html',
      query: 'SELECT x FROM t',
      template: 'first={{rows[0].x}}, second={{rows[1].x}}',
    }, state, ctx());
    state.update([{ x: 'apple' }, { x: 'banana' }]);
    expect(el.querySelector('.dash-html-body').textContent).toBe(
      'first=apple, second=banana'
    );
  });

  it('renders empty for missing rows', () => {
    const state = makeState();
    const el = PANELS.html({
      type: 'html',
      query: 'SELECT 1',
      template: 'val={{rows[0].v}}',
    }, state, ctx());
    state.update([]);
    expect(el.querySelector('.dash-html-body').textContent).toBe('val=');
  });

  it('escapes HTML from row values (defense-in-depth)', () => {
    const state = makeState();
    const el = PANELS.html({
      type: 'html',
      query: 'SELECT 1',
      template: 'name={{rows[0].name}}',
    }, state, ctx());
    state.update([{ name: '<script>x</script>' }]);
    const out = el.querySelector('.dash-html-body').innerHTML;
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });
});
