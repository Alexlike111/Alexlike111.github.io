import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { target: 'es2022', outDir: 'dist', assetsInlineLimit: 100000000, cssCodeSplit: false, reportCompressedSize: false },
  server: { host: true },
});
