// bentoclick runtime — minimal markdown subset.
//
// `mdInline` handles backtick code, [text](https://url) links,
// **bold**, *italic*. The URL regex restricts hrefs to http(s) so
// `javascript:` URLs can't slip through. Input is expected to be
// HTML-escaped already; `renderTinyMarkdown` runs `fmt.esc` per
// block before passing to `mdInline`.

import { fmt } from './fmt.js';

export function mdInline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\W)\*([^*]+)\*(\W|$)/g, '$1<em>$2</em>$3');
}

export function renderTinyMarkdown(src) {
  const esc = fmt.esc;
  const blocks = String(src).split(/\n\s*\n+/);
  return blocks.map((b0) => {
    const b = b0.replace(/\r/g, '');
    let m;
    if ((m = b.match(/^###\s+(.*)$/m))) return '<h3>' + mdInline(esc(m[1])) + '</h3>';
    if ((m = b.match(/^##\s+(.*)$/m)))  return '<h2 style="text-transform:none;font-size:14px">' + mdInline(esc(m[1])) + '</h2>';
    if ((m = b.match(/^#\s+(.*)$/m)))   return '<h2 style="text-transform:none;font-size:16px">' + mdInline(esc(m[1])) + '</h2>';
    if (/^\s*-\s+/.test(b)) {
      const items = b.split(/\n/).map((line) => {
        const im = line.match(/^\s*-\s+(.*)$/);
        return im ? '<li>' + mdInline(esc(im[1])) + '</li>' : '';
      }).join('');
      return '<ul>' + items + '</ul>';
    }
    return '<p>' + mdInline(esc(b)) + '</p>';
  }).join('\n');
}
