import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react() as any],
  resolve: {
    alias: {
      '@okw/core': path.resolve(__dirname, '../../packages/core/src'),
      '@okw/vault': path.resolve(__dirname, '../../packages/vault/src'),
      '@okw/markdown': path.resolve(__dirname, '../../packages/markdown/src'),
      '@okw/index': path.resolve(__dirname, '../../packages/index/src'),
    },
  },
  server: {
    port: 3000,
  },
});
