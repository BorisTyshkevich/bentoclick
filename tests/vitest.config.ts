import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

export default defineConfig({
  // Treat the repo root as vitest's root; include patterns below are
  // relative to it. This lets coverage include `runtime/v1/**/*.js`
  // unambiguously.
  root: repoRoot,
  test: {
    environment: 'happy-dom',
    include: [
      'tests/runtime/unit/**/*.test.js',
      'tests/e2e/**/*.test.js',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: resolve(here, 'runtime/coverage'),
      // dash.js + charts.js are the renderable runtime — happy-dom-testable
      // in unit form, gated at 90/85/90/90.
      //
      // spa-helpers.js holds the pure OAuth/HTML/SQL helpers that spa.js
      // imports as an ES module. Tests import it directly so v8 coverage
      // tracks the actual file. Gated at the same level as dash.js.
      //
      // spa.js is the OAuth/routing bootstrap that hits real browser
      // globals (location, crypto.subtle, OAuth servers). Most of it
      // is still verified via the chrome-mcp + claude.ai antalya e2e
      // suite, not unit tests. Included for visibility (gaps surface
      // as uncovered lines in the HTML report) but ungated until more
      // of its DOM/OAuth pathways grow unit tests.
      include: [
        'runtime/v1/dash.js',
        'runtime/v1/charts.js',
        'runtime/v1/spa-helpers.js',
        'runtime/v1/spa.js',
        'runtime/v1/tweaks.js',
      ],
      // Statements/lines/functions are the user-facing coverage signal.
      // Branches is set lower because v8's branch counter is strict —
      // it counts each side of every `||` short-circuit fallback as a
      // separate branch, including defensive fallbacks like
      // `(e && e.message) || String(e)` that are intentionally hard to
      // hit. Per-file thresholds (no global aggregate) so spa.js's
      // low coverage doesn't mask dash.js/charts.js regressions.
      thresholds: {
        'runtime/v1/dash.js': {
          statements: 90, branches: 85, functions: 90, lines: 90,
        },
        'runtime/v1/charts.js': {
          statements: 90, branches: 85, functions: 90, lines: 90,
        },
        'runtime/v1/spa-helpers.js': {
          statements: 90, branches: 85, functions: 90, lines: 90,
        },
        'runtime/v1/spa.js': {
          statements: 0, branches: 0, functions: 0, lines: 0,
        },
        // tweaks.js is the floating display-tweaks panel — same 90%
        // floor as the other testable modules.
        'runtime/v1/tweaks.js': {
          statements: 90, branches: 85, functions: 90, lines: 90,
        },
      },
    },
  },
});
