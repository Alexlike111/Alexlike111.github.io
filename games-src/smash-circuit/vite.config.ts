/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { playgamaBridge } from '@playgama/bridge/vite';

export default defineConfig({
  base: './',
  plugins: [playgamaBridge({ mode: 'local' })],
  build: { target: 'es2020', assetsInlineLimit: 0, chunkSizeWarningLimit: 1500,
    rollupOptions: { input: { main: 'index.html' } } },
  server: { host: true, port: 5173 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
