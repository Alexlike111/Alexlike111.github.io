import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
// `vite build` (default mode): the single-file preview in dist/, __PG__ = false.
// `vite build --mode pg` (npm run build:pg): the Playgama build in dist-pg/, __PG__ = true (Bridge, Bridge storage, no localStorage / IndexedDB code).

// The Playgama build ships no in-game self-tests: each *.selftest.ts becomes an empty module (main.ts globs them eagerly; their test code
// uses localStorage to restore settings, which the archive must not contain).
const noSelftests = (on: boolean): Plugin => ({
  name: 'pg-no-selftests',
  enforce: 'pre',
  load(id) { if (on && /\.selftest\.ts$/.test(id)) return 'export {};'; return null; },
});

export default defineConfig(({ mode }) => {
  const pg = mode === 'pg';
  return {
    base: './',
    define: { __PG__: JSON.stringify(pg) },
    plugins: [noSelftests(pg), viteSingleFile()],
    build: { target: 'es2022', outDir: pg ? 'dist-pg' : 'dist', emptyOutDir: true, assetsInlineLimit: 100000000, cssCodeSplit: false, reportCompressedSize: false },
    server: { host: true, port: 5180 },
  };
});
