import { defineConfig } from 'vite';
import playgamaBridge from '@playgama/bridge/vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [playgamaBridge({ mode: 'local' })],
  build: {
    target: 'es2019',
    assetsInlineLimit: 0,
    modulePreload: false,
    sourcemap: false,
  },
});
