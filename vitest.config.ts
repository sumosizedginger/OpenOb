import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'packages/**/*.{test,spec}.ts',
      'apps/**/*.{test,spec}.{ts,tsx}',
      'tests/**/*.{test,spec}.ts'
    ],
  },
  resolve: {
    alias: {
      '@okw/core': path.resolve(__dirname, './packages/core/src'),
      '@okw/vault': path.resolve(__dirname, './packages/vault/src'),
      '@okw/markdown': path.resolve(__dirname, './packages/markdown/src'),
      '@okw/index': path.resolve(__dirname, './packages/index/src'),
      '@okw/ai': path.resolve(__dirname, './packages/ai/src'),
      '@okw/plugin': path.resolve(__dirname, './packages/plugin/src'),
    },
  },
});
