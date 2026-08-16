import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: process.env.VITE_BASE_PATH || './',
  plugins: [react() as any],
  resolve: {
    alias: [
      {
        find: /.*\/node-fs-storage(\.js)?$/,
        replacement: path.resolve(
          __dirname,
          '../../packages/vault/src/node-fs-storage-browser-stub.ts'
        ),
      },
      { find: '@okw/core', replacement: path.resolve(__dirname, '../../packages/core/src') },
      { find: '@okw/vault', replacement: path.resolve(__dirname, '../../packages/vault/src') },
      {
        find: '@okw/markdown',
        replacement: path.resolve(__dirname, '../../packages/markdown/src'),
      },
      { find: '@okw/index', replacement: path.resolve(__dirname, '../../packages/index/src') },
      { find: '@okw/ai', replacement: path.resolve(__dirname, '../../packages/ai/src') },
      { find: '@okw/plugin', replacement: path.resolve(__dirname, '../../packages/plugin/src') },
    ],
  },
  server: {
    port: 3100,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'lucide-react'],
          'codemirror-vendor': [
            '@codemirror/view',
            '@codemirror/state',
            '@codemirror/commands',
            '@codemirror/lang-markdown',
            '@codemirror/language',
          ],
        },
      },
    },
  },
});
