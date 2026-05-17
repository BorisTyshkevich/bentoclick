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
      // spa.js is the OAuth/routing bootstrap that hits real browser globals
      // (location, crypto.subtle, OAuth servers); it's a classic <script>
      // with no exports. Its pure helpers ARE covered by behaviour-level
      // unit tests (spa.helpers.test.js, module-to-classic.test.js) but
      // those tests source-slice each function and re-hydrate it via
      // `new Function(...)`, so v8 coverage on the spa.js file itself
      // stays at 0% — instrumentation tracks the original script, not the
      // eval'd snippet. The file is in `include` for visibility in the
      // HTML coverage report (gaps surface as uncovered lines for follow-
      // up work); thresholds gated at 0 acknowledge the limitation.
      // To gate spa.js properly, refactor its pure helpers into a sibling
      // ESM module (e.g. `runtime/v1/spa-helpers.js`) that tests can
      // import directly and the iframe boot bundles with moduleToClassic
      // alongside charts.js. Tracked separately.
      include: [
        'runtime/v1/dash.js',
        'runtime/v1/charts.js',
        'runtime/v1/spa.js',
      ],
      // Statements/lines/functions are the user-facing coverage signal.
      // Branches is set lower because v8's branch counter is strict —
      // it counts each side of every `||` short-circuit fallback as a
      // separate branch, including defensive fallbacks like
      // `(e && e.message) || String(e)` that are intentionally hard to
      // hit.
      //
      // Per-file thresholds (no global aggregate) — spa.js sits at 0%
      // for the reason above and would drag any global average down
      // sub-threshold, hiding real regressions in dash.js/charts.js.
      thresholds: {
        'runtime/v1/dash.js': {
          statements: 90, branches: 85, functions: 90, lines: 90,
        },
        'runtime/v1/charts.js': {
          statements: 90, branches: 85, functions: 90, lines: 90,
        },
        'runtime/v1/spa.js': {
          statements: 0, branches: 0, functions: 0, lines: 0,
        },
      },
    },
  },
});
