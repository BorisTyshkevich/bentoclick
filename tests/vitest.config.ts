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
      include: ['runtime/v1/**/*.js'],
      // Statements/lines/functions are the user-facing coverage signal.
      // Branches is set lower because v8's branch counter is strict —
      // it counts each side of every `||` short-circuit fallback as a
      // separate branch, including defensive fallbacks like
      // `(e && e.message) || String(e)` that are intentionally hard to
      // hit. We accept 85% with the rest at 90.
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
  },
});
