import { describe, it, expect } from 'vitest';
import { PANELS, renderTinyMarkdown, fmt } from '../../../runtime/v1/dash.js';

function ctx() { return { api: { fmt }, spec: null }; }

describe('renderMarkdown panel', () => {
  it('renders text immediately, no query needed', () => {
    const panel = { type: 'markdown', text: '# Hello' };
    const state = { id: 'm', update: () => {} };
    const el = PANELS.markdown(panel, state, ctx());
    expect(el.innerHTML).toContain('<h2');
    expect(el.textContent).toContain('Hello');
  });
  it('renders an empty card for missing text', () => {
    const state = { id: 'm', update: () => {} };
    const el = PANELS.markdown({ type: 'markdown' }, state, ctx());
    expect(el.className).toContain('card');
  });
  it('shows title above body when provided', () => {
    const state = { id: 'm', update: () => {} };
    const el = PANELS.markdown(
      { type: 'markdown', title: 'About', text: 'body' }, state, ctx());
    expect(el.querySelector('h2').textContent).toBe('About');
  });
});

describe('renderTinyMarkdown', () => {
  it('renders headings', () => {
    expect(renderTinyMarkdown('# Big')).toContain('<h2');
    expect(renderTinyMarkdown('## Medium')).toContain('<h2');
    expect(renderTinyMarkdown('### Small')).toContain('<h3');
  });
  it('renders inline bold and italic', () => {
    expect(renderTinyMarkdown('**bold**')).toContain('<strong>bold</strong>');
    expect(renderTinyMarkdown('say *hi* now')).toContain('<em>hi</em>');
  });
  it('renders inline code', () => {
    expect(renderTinyMarkdown('use `cmd` here')).toContain('<code>cmd</code>');
  });
  it('renders links with target=_blank and rel=noopener', () => {
    const out = renderTinyMarkdown('[BTS](https://bts.gov/x)');
    expect(out).toContain('<a href="https://bts.gov/x"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener"');
  });
  it('renders ul from "- " prefixed lines', () => {
    const out = renderTinyMarkdown('- one\n- two\n- three');
    expect(out).toContain('<ul>');
    expect((out.match(/<li>/g) || []).length).toBe(3);
  });
  it('renders paragraphs for plain text', () => {
    expect(renderTinyMarkdown('hello world')).toContain('<p>hello world</p>');
  });
  it('escapes HTML inside markdown', () => {
    const out = renderTinyMarkdown('<script>alert(1)</script>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });
  it('XSS in link href is escaped (no javascript: passthrough as live link)', () => {
    const out = renderTinyMarkdown('[bad](javascript:alert(1))');
    // The link pattern requires https?: at the start, so javascript: is not a link.
    expect(out).not.toMatch(/href="javascript/);
  });
  it('handles multiple blocks separated by blank lines', () => {
    const out = renderTinyMarkdown('first\n\nsecond');
    expect(out).toContain('<p>first</p>');
    expect(out).toContain('<p>second</p>');
  });
});
