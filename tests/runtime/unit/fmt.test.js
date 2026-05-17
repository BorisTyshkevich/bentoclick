// Tests for DASH formatters in runtime/v1/dash.js.

import { describe, it, expect } from 'vitest';
import { fmt, applyFormat, resolveFormatFn } from '../../../runtime/v1/dash.js';

describe('fmt.num', () => {
  it('formats integers with thousands separators', () => {
    expect(fmt.num(12345)).toBe('12,345');
  });
  it('coerces strings', () => {
    expect(fmt.num('12345')).toBe('12,345');
  });
  it('returns "0" for null/undefined/NaN', () => {
    expect(fmt.num(null)).toBe('0');
    expect(fmt.num(undefined)).toBe('0');
    expect(fmt.num('not-a-number')).toBe('0');
  });
  it('handles negatives', () => {
    expect(fmt.num(-7000)).toBe('-7,000');
  });
});

describe('fmt.pct', () => {
  it('renders a fractional value as percent with one decimal', () => {
    expect(fmt.pct(0.42)).toBe('42.0%');
  });
  it('supports custom precision', () => {
    expect(fmt.pct(0.4267, 2)).toBe('42.67%');
  });
  it('returns 0% for null', () => {
    expect(fmt.pct(null)).toBe('0.0%');
  });
});

describe('fmt.cost', () => {
  it('shows two decimals at >=10', () => {
    expect(fmt.cost(12.345)).toBe('$12.35');
    expect(fmt.cost(10)).toBe('$10.00');
  });
  it('shows three decimals at <10', () => {
    expect(fmt.cost(0.123)).toBe('$0.123');
    expect(fmt.cost(9.999)).toBe('$9.999');
  });
  it('coerces null to $0.000', () => {
    expect(fmt.cost(null)).toBe('$0.000');
  });
});

describe('fmt.esc', () => {
  it('HTML-escapes the dangerous five', () => {
    expect(fmt.esc('<a href="x" onclick=\'go()\'>&amp;')).toBe(
      '&lt;a href=&quot;x&quot; onclick=&#39;go()&#39;&gt;&amp;amp;'
    );
  });
  it('handles null/undefined', () => {
    expect(fmt.esc(null)).toBe('');
    expect(fmt.esc(undefined)).toBe('');
  });
  it('passes plain text', () => {
    expect(fmt.esc('hello world')).toBe('hello world');
  });
});

describe('fmt.date / fmt.day', () => {
  it('truncates to the first 10 chars', () => {
    expect(fmt.date('2024-01-15T13:05:00Z')).toBe('2024-01-15');
    expect(fmt.day('2024-01-15')).toBe('2024-01-15');
  });
  it('handles null', () => {
    expect(fmt.date(null)).toBe('');
  });
});

describe('fmt.time', () => {
  it('formats hhmm integer as hh:mm', () => {
    expect(fmt.time(1305)).toBe('13:05');
    expect(fmt.time(700)).toBe('07:00');
    expect(fmt.time(0)).toBe('00:00');
  });
  it('handles null/empty', () => {
    expect(fmt.time(null)).toBe('');
    expect(fmt.time('')).toBe('');
  });
});

describe('fmt.duration', () => {
  it('formats minutes as Xh YYm', () => {
    expect(fmt.duration(125)).toBe('2h 05m');
    expect(fmt.duration(60)).toBe('1h 00m');
    expect(fmt.duration(0)).toBe('0h 00m');
  });
  it('rounds seconds component', () => {
    expect(fmt.duration(125.4)).toBe('2h 05m');
    expect(fmt.duration(125.7)).toBe('2h 06m');
  });
  it('returns empty for negatives / NaN', () => {
    expect(fmt.duration(-1)).toBe('');
    expect(fmt.duration('not-a-number')).toBe('');
    expect(fmt.duration(null)).toBe('');
  });
});

describe('fmt.bytes', () => {
  it('shows B for <1 KiB', () => {
    expect(fmt.bytes(512)).toBe('512 B');
    expect(fmt.bytes(0)).toBe('0 B');
  });
  it('shows KB for <1 MiB', () => {
    expect(fmt.bytes(1024)).toBe('1.0 KB');
    expect(fmt.bytes(12544)).toBe('12.3 KB');
  });
  it('shows MB above 1 MiB', () => {
    expect(fmt.bytes(1048576)).toBe('1.0 MB');
    expect(fmt.bytes(5 * 1048576)).toBe('5.0 MB');
  });
  it('coerces null', () => {
    expect(fmt.bytes(null)).toBe('0 B');
  });
});

describe('fmt.shortEmail', () => {
  it('returns the local part of an email', () => {
    expect(fmt.shortEmail('alice@example.com')).toBe('alice');
  });
  it('returns "(unknown)" for empty/null', () => {
    expect(fmt.shortEmail(null)).toBe('(unknown)');
    expect(fmt.shortEmail('')).toBe('(unknown)');
  });
  it('handles values without @ by returning input unchanged', () => {
    expect(fmt.shortEmail('alice')).toBe('alice');
  });
});

describe('resolveFormatFn', () => {
  it('resolves dotted paths against an api', () => {
    const api = { fmt };
    expect(resolveFormatFn(api, 'fmt.num')).toBe(fmt.num);
    expect(resolveFormatFn(api, 'fmt.shortEmail')).toBe(fmt.shortEmail);
  });
  it('returns null for unknown paths', () => {
    const api = { fmt };
    expect(resolveFormatFn(api, 'fmt.nope')).toBe(null);
    expect(resolveFormatFn(api, 'fmt.num.nope')).toBe(null);
  });
  it('returns null for empty/non-string input', () => {
    expect(resolveFormatFn({}, '')).toBe(null);
    expect(resolveFormatFn({}, null)).toBe(null);
    expect(resolveFormatFn({}, undefined)).toBe(null);
  });
});

describe('applyFormat', () => {
  const api = { fmt };
  it('uses a named formatter', () => {
    expect(applyFormat(api, 'num', 12345)).toBe('12,345');
  });
  it('uses format_fn override when provided', () => {
    expect(applyFormat(api, 'raw', 'alice@example.com', 'fmt.shortEmail')).toBe('alice');
  });
  it('falls through to esc for unknown formatters', () => {
    expect(applyFormat(api, 'unknown', '<x>')).toBe('&lt;x&gt;');
  });
  it('falls through to the formatter when the fn override is unresolved', () => {
    expect(applyFormat(api, 'num', 7, 'fmt.bogus')).toBe('7');
  });
});
