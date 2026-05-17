// Unit tests for the pure helpers inside `runtime/v1/spa.js`.
//
// spa.js is a classic <script> (no exports) — the top-level IIFE
// `main()` touches `location.replace`, OAuth state, the iframe boot
// flow, etc., which is why this file isn't directly importable like
// dash.js is. To exercise the file's pure helpers in isolation we
// source-slice each top-level declaration and re-hydrate it via
// `new Function`. Side-effect-free helpers only — anything that
// reaches into the DOM or kicks off a fetch stays in the chrome-mcp
// e2e suite, not here.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const spaSrc = readFileSync(join(here, '../../../runtime/v1/spa.js'), 'utf8');

// Pull a set of named declarations (functions, vars, consts) out of
// spa.js's source by regex, concatenate them, and return them via
// `new Function`. Each declaration must be one of:
//   - `function NAME(...) { ... }` with `}` on its own line
//   - `var NAME = ...;` on a single line
function extract(...names) {
  const parts = names.map((name) => {
    const fn = spaSrc.match(new RegExp(`^function ${name}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`, 'm'));
    if (fn) return fn[0];
    const v = spaSrc.match(new RegExp(`^var ${name}\\s*=[^;]+;`, 'm'));
    if (v) return v[0];
    throw new Error('not found in spa.js: ' + name);
  });
  return new Function(parts.join('\n') + `\nreturn { ${names.join(', ')} };`)();
}

describe('spa.js — escHtml', () => {
  const { escHtml } = extract('escHtml');

  it('escapes &<>"\' so attacker HTML renders as literal text', () => {
    expect(escHtml('<script>alert(1)</script>'))
      .toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(escHtml('a"b\'c')).toBe('a&quot;b&#39;c');
    expect(escHtml('a&b')).toBe('a&amp;b');
  });

  it('coerces null/undefined to empty string', () => {
    expect(escHtml(null)).toBe('');
    expect(escHtml(undefined)).toBe('');
  });

  it('passes numbers through stringified', () => {
    expect(escHtml(42)).toBe('42');
    expect(escHtml(0)).toBe('0');
  });
});

describe('spa.js — fmtBytes', () => {
  const { fmtBytes } = extract('fmtBytes');

  it('formats bytes below 1KB', () => {
    expect(fmtBytes(0)).toBe('0 B');
    expect(fmtBytes(1023)).toBe('1023 B');
  });

  it('switches to KB at the 1024 boundary', () => {
    expect(fmtBytes(1024)).toBe('1.0 KB');
    expect(fmtBytes(2048)).toBe('2.0 KB');
  });

  it('switches to MB at 1MB', () => {
    expect(fmtBytes(1048576)).toBe('1.0 MB');
    expect(fmtBytes(5 * 1048576)).toBe('5.0 MB');
  });

  it('handles non-numeric input by coercing to 0', () => {
    expect(fmtBytes(null)).toBe('0 B');
    expect(fmtBytes('not a number')).toBe('0 B');
  });
});

describe('spa.js — sqlStr', () => {
  const { sqlStr } = extract('sqlStr');

  it('wraps and doubles internal single quotes', () => {
    expect(sqlStr('hello')).toBe("'hello'");
    expect(sqlStr("o'reilly")).toBe("'o''reilly'");
    expect(sqlStr("'; DROP TABLE x; --")).toBe("'''; DROP TABLE x; --'");
  });

  it('handles empty string', () => {
    expect(sqlStr('')).toBe("''");
  });
});

describe('spa.js — assertSafe + SAFE', () => {
  const { assertSafe, SAFE } = extract('SAFE', 'assertSafe');

  it('SAFE regex matches the documented character class', () => {
    expect(SAFE.test('aZ09._+@-')).toBe(true);
    expect(SAFE.test('contains space')).toBe(false);
    expect(SAFE.test('contains/slash')).toBe(false);
    expect(SAFE.test("contains'quote")).toBe(false);
  });

  it('accepts valid identifiers without throwing', () => {
    expect(() => assertSafe('slug', 'aa-worst-month-2024')).not.toThrow();
    expect(() => assertSafe('owner', 'user@example.com')).not.toThrow();
    expect(() => assertSafe('name', 'a.b+c@example.com')).not.toThrow();
  });

  it('rejects characters outside the allowlist', () => {
    expect(() => assertSafe('slug', 'has space')).toThrow(/only \[A-Za-z0-9\._\+@-\] allowed/);
    expect(() => assertSafe('slug', 'a/b')).toThrow();
    expect(() => assertSafe('slug', "a'b")).toThrow();
  });

  it('rejects values longer than 128 characters', () => {
    expect(() => assertSafe('slug', 'a'.repeat(129))).toThrow(/too long/);
    expect(() => assertSafe('slug', 'a'.repeat(128))).not.toThrow();
  });
});

describe('spa.js — safeReturnTo (open-redirect guard)', () => {
  const { safeReturnTo } = extract('safeReturnTo');

  it('returns "/" for non-strings, empty, or oversized inputs', () => {
    expect(safeReturnTo(null)).toBe('/');
    expect(safeReturnTo(undefined)).toBe('/');
    expect(safeReturnTo(123)).toBe('/');
    expect(safeReturnTo('')).toBe('/');
    expect(safeReturnTo('/' + 'a'.repeat(2048))).toBe('/');
  });

  it('rejects protocol-relative and scheme-prefixed redirects', () => {
    expect(safeReturnTo('//evil.com')).toBe('/');
    expect(safeReturnTo('//evil.com/abc')).toBe('/');
  });

  it('rejects values that don\'t start with /', () => {
    expect(safeReturnTo('evil.com')).toBe('/');
    expect(safeReturnTo('https://evil.com')).toBe('/');
    expect(safeReturnTo('javascript:alert(1)')).toBe('/');
  });

  it('rejects /mcp-callback to prevent self-redirect loops', () => {
    expect(safeReturnTo('/mcp-callback')).toBe('/');
    expect(safeReturnTo('/mcp-callback?x=1')).toBe('/');
    expect(safeReturnTo('/mcp-callback/foo')).toBe('/');
  });

  it('accepts plausible same-origin paths', () => {
    expect(safeReturnTo('/app')).toBe('/app');
    expect(safeReturnTo('/v/owner/slug')).toBe('/v/owner/slug');
    expect(safeReturnTo('/p/page?x=1')).toBe('/p/page?x=1');
  });
});

describe('spa.js — jsonCompactRows', () => {
  const { jsonCompactRows } = extract('jsonCompactRows');

  it('parses CH HTTP {meta, data} shape', () => {
    const j = {
      meta: [{ name: 'a', type: 'String' }, { name: 'b', type: 'Int' }],
      data: [['x', 1], ['y', 2]],
    };
    expect(jsonCompactRows(j)).toEqual([{ a: 'x', b: 1 }, { a: 'y', b: 2 }]);
  });

  it('parses MCP {columns, rows} shape', () => {
    const j = { columns: ['a', 'b'], rows: [['x', 1], ['y', 2]] };
    expect(jsonCompactRows(j)).toEqual([{ a: 'x', b: 1 }, { a: 'y', b: 2 }]);
  });

  it('returns [] on empty data', () => {
    expect(jsonCompactRows({ meta: [], data: [] })).toEqual([]);
    expect(jsonCompactRows({ columns: [], rows: [] })).toEqual([]);
    expect(jsonCompactRows({})).toEqual([]);
  });

  it('ignores a numeric `rows` field (CH-style row count)', () => {
    // CH HTTP returns rows:N (a number) alongside data:[[...]]; the
    // helper must not treat the number as iterable.
    const j = { meta: [{ name: 'x' }], data: [[1]], rows: 1 };
    expect(jsonCompactRows(j)).toEqual([{ x: 1 }]);
  });
});
