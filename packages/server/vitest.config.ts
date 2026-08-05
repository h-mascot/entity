import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '../../../../packages/db/src/index': resolve(__dirname, '../db/src/index.ts'),
    },
  },
  test: {
    exclude: ['dist/**', 'node_modules/**'],
    // Full parallel suite (~174 files) can inflate individual test wall-time
    // under ordinary machine contention (tests pass in isolation in <1s).
    // Bounded global timeouts tolerate contention while still surfacing genuine
    // hangs; do NOT set 0 (hides hangs) or bump without keeping a ceiling.
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
