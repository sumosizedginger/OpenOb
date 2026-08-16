import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'packages/**/*.{test,spec}.ts',
      'apps/**/*.{test,spec}.{ts,tsx}',
      'tests/**/*.{test,spec}.ts',
    ],
    exclude: ['tests/e2e/**', 'tests/_reaudit-tmp/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.{ts,tsx}'],
      exclude: ['**/*.d.ts', '**/__tests__/**', '**/node-fs-storage-browser-stub.ts'],
    },
  },
  resolve: {
    alias: {
      '@okw/core': path.resolve(__dirname, './packages/core/src'),
      '@okw/vault': path.resolve(__dirname, './packages/vault/src'),
      '@okw/markdown': path.resolve(__dirname, './packages/markdown/src'),
      '@okw/index': path.resolve(__dirname, './packages/index/src'),
      '@okw/ai': path.resolve(__dirname, './packages/ai/src'),
      '@okw/plugin': path.resolve(__dirname, './packages/plugin/src'),
      '@okw/desktop': path.resolve(__dirname, './packages/desktop/src'),
    },
  },
});
