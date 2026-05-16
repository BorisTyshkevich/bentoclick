import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

export default defineConfig({
  root: here,
  test: {
    environment: 'happy-dom',
    include: ['unit/**/*.test.js', '../e2e/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: resolve(here, 'coverage'),
      include: [resolve(repoRoot, 'runtime/v1/**/*.js')],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
    },
  },
});
