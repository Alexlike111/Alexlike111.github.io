// Shared helpers for check / covers: a tiny static server for dist/ and a browser launcher.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

/** Serves `dir` on a free port; extra = { '/path': absoluteFile } for files outside dir. */
export function serve(dir, extra = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = extra[p] ?? path.join(dir, path.normalize(p));
      if (!extra[p] && !file.startsWith(dir)) throw new Error('outside');
      const s = await stat(file);
      if (!s.isFile()) throw new Error('not file');
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

export async function launch() {
  const { chromium } = await import('@playwright/test');
  try {
    return await chromium.launch();
  } catch (e) {
    for (const p of ['/opt/pw-browsers/chromium']) {
      if (existsSync(p)) return chromium.launch({ executablePath: p });
    }
    throw e;
  }
}
