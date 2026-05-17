import { describe, it, expect } from 'vitest';
import { makeInterpolator } from '../../../runtime/v1/dash.js';

function build(paramDefs, values) {
  return makeInterpolator(paramDefs, values);
}

describe('makeInterpolator — int', () => {
  const defs = [{ name: 'year', type: 'int', min: 1987, max: 2025 }];

  it('substitutes a valid integer', () => {
    const i = build(defs, { year: 2023 });
    expect(i('SELECT * WHERE Year = {{year}}')).toBe('SELECT * WHERE Year = 2023');
  });

  it('rejects non-integers', () => {
    const i = build(defs, { year: 'abc' });
    expect(() => i('WHERE Year = {{year}}')).toThrow(/not an integer/);
  });

  it('enforces min', () => {
    const i = build(defs, { year: 1900 });
    expect(() => i('{{year}}')).toThrow(/< 1987/);
  });

  it('enforces max', () => {
    const i = build(defs, { year: 9999 });
    expect(() => i('{{year}}')).toThrow(/> 2025/);
  });

  it('accepts numeric strings', () => {
    const i = build(defs, { year: '2023' });
    expect(i('{{year}}')).toBe('2023');
  });

  it('rejects fractional values', () => {
    const i = build(defs, { year: 2023.5 });
    expect(() => i('{{year}}')).toThrow(/not an integer/);
  });
});

describe('makeInterpolator — enum', () => {
  const defs = [{ name: 'carrier', type: 'enum', options: ['WN', 'DL', 'AA'] }];

  it('substitutes a valid option, quoted', () => {
    const i = build(defs, { carrier: 'WN' });
    expect(i("WHERE c = {{carrier}}")).toBe("WHERE c = 'WN'");
  });

  it('rejects values not in options', () => {
    const i = build(defs, { carrier: 'XX' });
    expect(() => i('{{carrier}}')).toThrow(/not in options/);
  });

  it('escapes single quotes by doubling', () => {
    const defs2 = [{ name: 'x', type: 'enum', options: ["a'b"] }];
    const i = build(defs2, { x: "a'b" });
    expect(i("{{x}}")).toBe("'a''b'");
  });
});

describe('makeInterpolator — date', () => {
  const defs = [{ name: 'from', type: 'date' }];

  it('accepts YYYY-MM-DD', () => {
    const i = build(defs, { from: '2024-01-15' });
    expect(i("WHERE d = {{from}}")).toBe("WHERE d = '2024-01-15'");
  });

  it('rejects malformed dates', () => {
    expect(() => build(defs, { from: '2024-1-15' })('{{from}}')).toThrow(/expected YYYY-MM-DD/);
    expect(() => build(defs, { from: 'not-a-date' })('{{from}}')).toThrow(/expected YYYY-MM-DD/);
  });
});

describe('makeInterpolator — string', () => {
  it('accepts default-pattern alphanumerics', () => {
    const i = build([{ name: 's', type: 'string' }], { s: 'foo.bar+1' });
    expect(i('{{s}}')).toBe("'foo.bar+1'");
  });

  it('rejects characters outside the default allowlist', () => {
    const i = build([{ name: 's', type: 'string' }], { s: '<script>' });
    expect(() => i('{{s}}')).toThrow(/pattern mismatch/);
  });

  it('respects custom pattern', () => {
    const i = build([{ name: 's', type: 'string', pattern: '^[a-z]+$' }], { s: 'foo' });
    expect(i('{{s}}')).toBe("'foo'");
  });

  it('enforces max_length', () => {
    const i = build([{ name: 's', type: 'string', max_length: 3 }], { s: 'long' });
    expect(() => i('{{s}}')).toThrow(/too long/);
  });

  it('doubles internal quotes (param value has apostrophe)', () => {
    const i = build([
      { name: 's', type: 'string', pattern: ".*" }
    ], { s: "a'b" });
    expect(i('{{s}}')).toBe("'a''b'");
  });

  it('treats null as empty string', () => {
    const i = build([{ name: 's', type: 'string' }], { s: null });
    expect(i('{{s}}')).toBe("''");
  });
});

describe('makeInterpolator — undefined param', () => {
  it('throws on an unknown placeholder', () => {
    const i = build([], {});
    expect(() => i('{{nope}}')).toThrow(/Unknown param/);
  });
});

describe('makeInterpolator — multiple placeholders', () => {
  it('substitutes every occurrence in one pass', () => {
    const i = build([
      { name: 'y', type: 'int' },
      { name: 'c', type: 'enum', options: ['A', 'B'] },
    ], { y: 2024, c: 'A' });
    expect(i('Year={{y}} AND c={{c}} AND y={{y}}'))
      .toBe("Year=2024 AND c='A' AND y=2024");
  });

  it('handles whitespace inside braces', () => {
    const i = build([{ name: 'x', type: 'int' }], { x: 7 });
    expect(i('{{  x  }}')).toBe('7');
  });
});
