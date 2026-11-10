// Playgama archive: run after `vite build --mode pg` (npm run build:pg does both).
//  1. injects <script src="playgama-bridge.js"></script> as the FIRST script of <head> in dist-pg/index.html (plain, not async, not added later from code);
//  2. copies the Bridge SDK (node_modules/@playgama/bridge/dist/playgama-bridge.js) and playgama/playgama-bridge-config.json next to index.html;
//  3. verifies the archive: Latin file names, index.html in the root, total size (≤300 MB), no external http(s) resources in index.html
//     (the SVG namespace strings are not requests), no localStorage / sessionStorage / indexedDB / cookie use in index.html;
//  4. writes release/snowcraft-playgama.zip (index.html at the root of the archive).
import { readFileSync, writeFileSync, copyFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, relative, resolve, dirname, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, 'dist-pg');     // optional: another build folder (the zip then goes next to it)
const SDK = join(ROOT, 'node_modules/@playgama/bridge/dist/playgama-bridge.js');
const CFG = join(ROOT, 'playgama/playgama-bridge-config.json');
const REL = process.argv[2] ? join(dirname(OUT), basename(OUT) + '-release') : join(ROOT, 'release'), ZIP = join(REL, 'snowcraft-playgama.zip');
const MAX_BYTES = 300 * 1024 * 1024;
const problems = [], notes = [];
const fail = (m) => problems.push(m);

if (!existsSync(join(OUT, 'index.html'))) { console.error('pg-pack: dist-pg/index.html is missing: run `vite build --mode pg` first'); process.exit(1); }
if (!existsSync(SDK)) { console.error('pg-pack: the Bridge SDK is missing (npm i -D @playgama/bridge): ' + SDK); process.exit(1); }
if (!existsSync(CFG)) { console.error('pg-pack: playgama/playgama-bridge-config.json is missing'); process.exit(1); }

// 1. SDK first in <head>
let html = readFileSync(join(OUT, 'index.html'), 'utf8');
const headOpen = html.match(/<head[^>]*>/i);
if (!headOpen) { console.error('pg-pack: no <head> in index.html'); process.exit(1); }
const tag = '<script src="playgama-bridge.js"></script>';
if (html.includes('playgama-bridge.js')) fail('index.html already references playgama-bridge.js');
html = html.slice(0, headOpen.index + headOpen[0].length) + '\n    ' + tag + html.slice(headOpen.index + headOpen[0].length);
const firstScript = html.search(/<script[\s>]/i);
if (firstScript !== headOpen.index + headOpen[0].length + 5) fail('the Bridge script is not the first script in <head>');
writeFileSync(join(OUT, 'index.html'), html);

// 2. SDK and config next to index.html
copyFileSync(SDK, join(OUT, 'playgama-bridge.js'));
copyFileSync(CFG, join(OUT, 'playgama-bridge-config.json'));

// 3. verification
const files = [];
const walk = (dir, rel = '') => { for (const e of readdirSync(dir)) { const p = join(dir, e), r = rel ? rel + '/' + e : e; if (statSync(p).isDirectory()) walk(p, r); else files.push(r); } };
walk(OUT);
let total = 0;
for (const f of files) {
  total += statSync(join(OUT, f)).size;
  if (!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(f)) fail('file name is not Latin: ' + f);
}
if (!files.includes('index.html')) fail('index.html is not in the archive root');
if (total > MAX_BYTES) fail('archive is larger than 300 MB');
const page = readFileSync(join(OUT, 'index.html'), 'utf8');
const urls = [...new Set(page.match(/https?:\/\/[^\s"'`<>)\\]+/g) ?? [])];
const harmless = /^https?:\/\/www\.w3\.org\/(2000\/svg|1999\/xhtml)$/;
for (const u of urls) if (!harmless.test(u)) fail('index.html refers to an external address: ' + u.slice(0, 120));
for (const bad of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie']) if (page.includes(bad)) fail('index.html uses ' + bad);
const sdk = readFileSync(SDK, 'utf8');
notes.push('SDK file uses localStorage: ' + (sdk.includes('localStorage') ? 'yes (Playgama code, not the game)' : 'no'));
notes.push('navigator.language in index.html: ' + (page.includes('navigator.language') ? 'present (check it is not reached in the PG build)' : 'absent'));

// 4. zip (index.html at the root)
mkdirSync(REL, { recursive: true });
const pyScript = `
import sys, zipfile, os
out, src = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, _, names in os.walk(src):
        for n in sorted(names):
            p = os.path.join(root, n)
            z.write(p, os.path.relpath(p, src).replace(os.sep, '/'))
print(os.path.getsize(out))
`;
let zipSize = 0;
try { zipSize = Number(execFileSync('python3', ['-c', pyScript, ZIP, OUT]).toString().trim()); }
catch (e) { fail('zip failed: ' + e.message.split('\n')[0]); }

console.log('pg-pack: ' + files.length + ' files, ' + (total / 1024).toFixed(1) + ' KB in dist-pg/ (' + relative(ROOT, OUT) + ')');
console.log('pg-pack: ' + relative(ROOT, ZIP) + ' ' + (zipSize / 1024).toFixed(1) + ' KB');
for (const f of files) console.log('   ' + f + '  ' + (statSync(join(OUT, f)).size / 1024).toFixed(1) + ' KB');
for (const n of notes) console.log('pg-pack note: ' + n);
if (problems.length) { for (const p of problems) console.error('pg-pack FAIL: ' + p); process.exit(1); }
console.log('pg-pack: all archive checks passed');
