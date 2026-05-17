// bentoclick SPA helpers — pure, side-effect-free.
//
// Pulled out of spa.js so they become importable in tests (v8
// coverage tracks imports; source-slicing via `new Function` does
// not). spa.js loads this as an ES module via the standard import
// path; the iframe boot never touches these — chart panels live in
// dash.js + charts.js.
//
// Keep this file pure: no DOM, no fetch, no localStorage, no
// crypto. The boundary check: each export must be safe to call from
// unit tests with no global state.

// Allowlist for URL-shaped identifiers (owner emails, dashboard
// slugs, page names). Quote-escaping via sqlStr() still happens
// downstream; this is defense in depth so a SQL injection requires
// two failures, not one.
export const SAFE_PATTERN = /^[A-Za-z0-9._+@-]+$/;

// Escape a string for HTML text content or attribute value. Quotes
// are escaped too, so the same helper works in both contexts.
export function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c];
  });
}

// Format a byte count as B / KB / MB.
export function fmtBytes(b) {
  var n = Number(b) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n/1024).toFixed(1) + ' KB';
  return (n/1048576).toFixed(1) + ' MB';
}

// SQL string literal — wrap in single quotes and double any embedded
// single quotes. ClickHouse syntax.
export function sqlStr(s) {
  return "'" + s.replace(/'/g, "''") + "'";
}

// Reject identifiers outside the SAFE allowlist. Throws on bad input.
// Used by fetchDashboard / fetchPage / renderIndex before splicing
// the value into SQL.
export function assertSafe(name, v) {
  if (!SAFE_PATTERN.test(v)) throw new Error('Invalid ' + name + ': only [A-Za-z0-9._+@-] allowed');
  if (v.length > 128) throw new Error(name + ' too long');
}

// Sanitize an OAuth `return_to` path against open-redirect abuse.
// Accepts only same-origin absolute paths, rejects protocol-relative
// `//evil.com`, rejects the OAuth callback path (to prevent
// self-redirect loops), caps length at 2048.
export function safeReturnTo(s) {
  if (typeof s !== 'string' || s.length === 0 || s.length > 2048) return '/';
  if (!/^\/[^/]/.test(s)) return '/';
  if (/^\/mcp-callback(?:[/?#]|$)/.test(s)) return '/';
  return s;
}

// Parse a CH HTTP `JSONCompact` response ({meta, data}) OR an MCP
// `execute_query` response ({columns, rows}) into a plain
// row-of-objects array. Numeric `j.rows` (CH's row-count field) is
// ignored — only arrays are iterated.
export function jsonCompactRows(j) {
  var cols = j.columns || (j.meta ? j.meta.map(function(c){ return c.name; }) : []);
  var data = Array.isArray(j.data) ? j.data
           : Array.isArray(j.rows) ? j.rows
           : [];
  return data.map(function(row) {
    var o = {};
    cols.forEach(function(c, i) { o[c] = row[i]; });
    return o;
  });
}

// Convert an ES-module source string into a classic-script-compatible
// equivalent. Strips top-level `import …` statements (including the
// multi-line `import { a, b } from './x.js'` form) and the `export`
// keyword on named declarations. Leaves the body otherwise untouched;
// in particular the trailing `window.DASH = …` assignment survives so
// the iframe boot can still reach renderSpec through DASH.
export function moduleToClassic(src) {
  return src
    .replace(/^import\s+(?:[\s\S]+?from\s+)?['"][^'"]+['"]\s*;?/gm, '')
    .replace(/^export\s+(async\s+function|function|class|const|let|var)\s+/gm, '$1 ')
    .replace(/^export\s+\{[^}]*\};?$/gm, '');
}
