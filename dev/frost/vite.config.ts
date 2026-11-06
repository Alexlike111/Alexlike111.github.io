import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')) },
  build: { target: 'es2022', outDir: 'dist', assetsInlineLimit: 100000000, cssCodeSplit: false, reportCompressedSize: false },
  server: { host: true },
});
