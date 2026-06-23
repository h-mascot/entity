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
  },
});
