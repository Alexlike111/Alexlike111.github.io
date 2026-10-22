// npm run zip: dist/ -> releases/<slug>-v<version>.zip with index.html at the archive root.
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';
import { ROOT } from './lib.mjs';

const DIST = path.join(ROOT, 'dist');
if (!existsSync(path.join(DIST, 'index.html'))) {
  console.error('dist/index.html missing: run npm run build (or npm run check) first');
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const cfg = JSON.parse(readFileSync(path.join(ROOT, 'game.config.json'), 'utf8'));

const entries = {};
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else entries[path.relative(DIST, p).split(path.sep).join('/')] = [readFileSync(p), { level: 9, mtime: new Date('2026-01-01') }];
  }
})(DIST);

const out = path.join(ROOT, 'releases');
mkdirSync(out, { recursive: true });
const name = `${cfg.slug}-v${pkg.version}.zip`;
const buf = zipSync(entries);
writeFileSync(path.join(out, name), buf);
console.log(`releases/${name}  ${(buf.length / 1024).toFixed(0)} KB, ${Object.keys(entries).length} files`);
if (buf.length > 300 * 1048576) {
  console.error('over the 300 MB Playgama limit');
  process.exit(1);
}
