import { defineConfig } from 'vite';
import playgamaBridge from '@playgama/bridge/vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    playgamaBridge({ mode: 'local' }),
    {
      // classic deferred script instead of a module: the zip must also start from file:// (double click),
      // where browsers block module scripts and crossorigin assets
      name: 'classic-script',
      enforce: 'post',
      transformIndexHtml: (html: string) =>
        html.replace(/<script type="module" crossorigin src=/g, '<script defer src=').replace(/<link rel="stylesheet" crossorigin /g, '<link rel="stylesheet" '),
    },
  ],
  build: {
    target: 'es2019',
    assetsInlineLimit: 0,
    modulePreload: false,
    sourcemap: false,
    cssCodeSplit: false,
    rollupOptions: { output: { format: 'iife', inlineDynamicImports: true } },
  },
});
