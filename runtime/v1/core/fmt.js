// bentoclick runtime — formatters + format resolution.
//
// Pure helpers: input → string. No DOM, no fetch, no state. Each
// formatter handles its own null/empty fallbacks so callers never
// need to guard.
//
// Extracted from runtime/v1/dash.js during the dash split. dash.js
// re-exports `fmt`, `resolveFormatFn`, and `applyFormat` so existing
// importers (tests, panel renderers) keep working.

export const fmt = {
  cost(v) {
    const n = Number(v) || 0;
    return n >= 10 ? '$' + n.toFixed(2) : '$' + n.toFixed(3);
  },
  num(v) {
    return (Number(v) || 0).toLocaleString();
  },
  pct(v, digits) {
    return ((Number(v) || 0) * 100).toFixed(digits == null ? 1 : digits) + '%';
  },
  esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },
  raw(s) { return fmt.esc(s); },
  date(v) { return String(v == null ? '' : v).slice(0, 10); },
  day(v)  { return fmt.date(v); },
  shortEmail(e) {
    if (!e) return '(unknown)';
    return String(e).split('@')[0];
  },
  // hhmm (UInt16, e.g. 1305) → 'hh:mm'. Null/undefined/'' → ''.
  time(v) {
    if (v == null || v === '') return '';
    const s = String(v).padStart(4, '0');
    return s.slice(0, s.length - 2) + ':' + s.slice(-2);
  },
  // minutes (number) → 'Xh YYm'. Negative/null/undefined → ''.
  duration(v) {
    if (v == null || v === '') return '';
    const n = Number(v);
    if (!isFinite(n) || n < 0) return '';
    const h = Math.floor(n / 60);
    const m = Math.round(n % 60);
    return h + 'h ' + String(m).padStart(2, '0') + 'm';
  },
  // bytes (number) → '123 B' / '12.3 KB' / '4.5 MB'.
  bytes(v) {
    const n = Number(v) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  },
};

// Look up a fmt helper by dotted path ("fmt.shortEmail" → fmt.shortEmail).
// Returns null if the path doesn't resolve to a function.
export function resolveFormatFn(api, dottedPath) {
  if (!dottedPath || typeof dottedPath !== 'string') return null;
  const parts = dottedPath.split('.');
  let ref = api;
  for (let i = 0; i < parts.length && ref; i++) ref = ref[parts[i]];
  return typeof ref === 'function' ? ref : null;
}

export function applyFormat(api, name, v, fnOverride) {
  const fn = resolveFormatFn(api, fnOverride);
  if (fn) return fn(v);
  const f = fmt[name];
  if (typeof f === 'function') return f(v);
  return fmt.esc(v);
}
