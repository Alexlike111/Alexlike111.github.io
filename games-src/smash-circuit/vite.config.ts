/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { playgamaBridge } from '@playgama/bridge/vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Build label shown in the corner of the test build: version · UTC date time · git commit
function buildLabel(): string {
  const v = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
  let sha = 'dev';
  try { sha = execSync('git rev-parse --short HEAD').toString().trim(); } catch { /* not a git checkout */ }
  const d = new Date().toISOString().slice(0, 16).replace('T', ' ');
  return `v${v} · ${d} UTC · ${sha}`;
}

export default defineConfig({
  base: './',
  plugins: [playgamaBridge({ mode: 'local' }), { name: 'build-label', transformIndexHtml: (html: string) => html.replace('__BUILD__', buildLabel()) }],
  build: { target: 'es2020', assetsInlineLimit: 0, chunkSizeWarningLimit: 1500,
    rollupOptions: { input: { main: 'index.html' } } },
  server: { host: true, port: 5173 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
