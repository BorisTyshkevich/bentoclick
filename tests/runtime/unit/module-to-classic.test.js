// Integration regression for the iframe boot path: charts.js + dash.js
// bundled, stripped via moduleToClassic, evaluated as a classic <script>.
//
// dash.js + charts.js are loaded via vitest's ESM resolver in every
// other test file in this directory, but production loads them by
// fetching the source as text, running it through moduleToClassic,
// and inlining the result as a *classic* <script> in the dashboard
// iframe srcdoc (see spa.js:synthesizeSpecWrapper). PR #1's split
// introduced an `import { ... } from './charts.js'` that survived
// the original strip-export pass and crashed the iframe boot with
// SyntaxError — that's the regression this file pins.
//
// Unit-level coverage for moduleToClassic itself lives in
// spa.helpers.test.js (the helper now exports from spa-helpers.js).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { moduleToClassic } from '../../../runtime/v1/spa-helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const runtimeDir = join(here, '../../../runtime/v1');

const chartsSrc = readFileSync(join(runtimeDir, 'charts.js'),  'utf8');
const dashSrc   = readFileSync(join(runtimeDir, 'dash.js'),    'utf8');

describe('moduleToClassic — real runtime bundle', () => {
  it('produces parseable classic script for charts.js + dash.js', () => {
    const bundled = moduleToClassic([chartsSrc, dashSrc].join('\n'));
    expect(bundled).not.toMatch(/^import\b/m);
    expect(bundled).not.toMatch(/^export\b/m);
    expect(() => new Function(bundled)).not.toThrow();
  });

  it('leaves the runtime`s `window.DASH = …` assignment intact', () => {
    const bundled = moduleToClassic([chartsSrc, dashSrc].join('\n'));
    expect(bundled).toMatch(/window\.DASH\s*=/);
  });
});
