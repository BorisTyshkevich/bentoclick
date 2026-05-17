// Unit tests for the pure helpers exported from runtime/v1/spa-helpers.js.
//
// These were previously source-sliced out of spa.js (a classic <script>
// with no exports) and re-hydrated via `new Function`, which worked for
// behaviour but left v8 coverage at 0% — the instrumentation tracks
// the original file, not the eval'd snippet. spa-helpers.js is a proper
// ESM module imported by spa.js (with `<script type="module">`) AND by
// these tests, so coverage now flows through naturally.

import { describe, it, expect } from 'vitest';
import {
  escHtml,
  fmtBytes,
  sqlStr,
  assertSafe,
  SAFE_PATTERN,
  safeReturnTo,
  jsonCompactRows,
  moduleToClassic,
} from '../../../runtime/v1/spa-helpers.js';

describe('spa-helpers — escHtml', () => {
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

describe('spa-helpers — fmtBytes', () => {
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

describe('spa-helpers — sqlStr', () => {
  it('wraps and doubles internal single quotes', () => {
    expect(sqlStr('hello')).toBe("'hello'");
    expect(sqlStr("o'reilly")).toBe("'o''reilly'");
    expect(sqlStr("'; DROP TABLE x; --")).toBe("'''; DROP TABLE x; --'");
  });

  it('handles empty string', () => {
    expect(sqlStr('')).toBe("''");
  });
});

describe('spa-helpers — assertSafe + SAFE_PATTERN', () => {
  it('SAFE_PATTERN regex matches the documented character class', () => {
    expect(SAFE_PATTERN.test('aZ09._+@-')).toBe(true);
    expect(SAFE_PATTERN.test('contains space')).toBe(false);
    expect(SAFE_PATTERN.test('contains/slash')).toBe(false);
    expect(SAFE_PATTERN.test("contains'quote")).toBe(false);
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

describe('spa-helpers — safeReturnTo (open-redirect guard)', () => {
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
    expect(safeReturnTo('/app?dashboard=alice/sales')).toBe('/app?dashboard=alice/sales');
  });
});

describe('spa-helpers — jsonCompactRows', () => {
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
    const j = { meta: [{ name: 'x' }], data: [[1]], rows: 1 };
    expect(jsonCompactRows(j)).toEqual([{ x: 1 }]);
  });
});

describe('spa-helpers — moduleToClassic', () => {
  it('strips a multi-line `import { ... } from "./x.js"` block', () => {
    const src = 'import {\n  a,\n  b as c,\n} from "./x.js";\nconst y = 1;\n';
    const out = moduleToClassic(src);
    expect(out).not.toMatch(/^import\b/m);
    expect(out).toMatch(/const y = 1;/);
  });

  it('strips a single-line bare `import "./x.js"` side-effect form', () => {
    const src = 'import "./side.js";\nconst y = 1;\n';
    expect(moduleToClassic(src)).not.toMatch(/^import\b/m);
  });

  it('strips `export` from declarations and named-export lists', () => {
    const src = 'export const fmt = {};\nexport function f() {}\nexport { fmt, f };\n';
    const out = moduleToClassic(src);
    expect(out).not.toMatch(/^export\b/m);
    expect(out).toMatch(/const fmt = \{\}/);
    expect(out).toMatch(/function f\(\)/);
  });
});
