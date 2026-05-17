// Regression test for spa.js:moduleToClassic.
//
// dash.js + charts.js are loaded via vitest's ESM resolver in every
// other test file in this directory, but production loads them by
// fetching the source as text, running it through moduleToClassic,
// and inlining the result as a *classic* <script> in the dashboard
// iframe srcdoc (see spa.js:synthesizeSpecWrapper). A top-level
// `import { ... } from './charts.js'` survives the strip-export pass
// and crashes the iframe boot with SyntaxError — that was the
// regression this test pins.
//
// moduleToClassic lives inside spa.js (a classic script with no
// exports), so we extract the function definition by source-slicing
// and rehydrate it via `new Function`.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const runtimeDir = join(here, '../../../runtime/v1');

const spaSrc    = readFileSync(join(runtimeDir, 'spa.js'),     'utf8');
const chartsSrc = readFileSync(join(runtimeDir, 'charts.js'),  'utf8');
const dashSrc   = readFileSync(join(runtimeDir, 'dash.js'),    'utf8');

const fnMatch = spaSrc.match(/function moduleToClassic\s*\([^)]*\)\s*\{[\s\S]*?^\}/m);
if (!fnMatch) throw new Error('could not extract moduleToClassic from spa.js');
const moduleToClassic = new Function(fnMatch[0] + '\nreturn moduleToClassic;')();

describe('moduleToClassic', () => {
  it('strips a multi-line `import { ... } from "./x.js"` block', () => {
    const src = 'import {\n  a,\n  b as c,\n} from "./x.js";\nconst y = 1;\n';
    const out = moduleToClassic(src);
    expect(out).not.toMatch(/^import\b/m);
    expect(out).toMatch(/const y = 1;/);
  });

  it('strips a single-line bare `import "./x.js"` side-effect form', () => {
    const src = 'import "./side.js";\nconst y = 1;\n';
    const out = moduleToClassic(src);
    expect(out).not.toMatch(/^import\b/m);
  });

  it('strips `export` from declarations and named-export lists', () => {
    const src = 'export const fmt = {};\nexport function f() {}\nexport { fmt, f };\n';
    const out = moduleToClassic(src);
    expect(out).not.toMatch(/^export\b/m);
    expect(out).toMatch(/const fmt = \{\}/);
    expect(out).toMatch(/function f\(\)/);
  });

  it('produces parseable classic script for the real charts.js + dash.js bundle', () => {
    const bundled = moduleToClassic([chartsSrc, dashSrc].join('\n'));
    expect(bundled).not.toMatch(/^import\b/m);
    expect(bundled).not.toMatch(/^export\b/m);
    expect(() => new Function(bundled)).not.toThrow();
  });

  it('leaves the runtime`s `window.DASH = …` assignment intact after stripping', () => {
    const bundled = moduleToClassic([chartsSrc, dashSrc].join('\n'));
    expect(bundled).toMatch(/window\.DASH\s*=/);
  });
});
