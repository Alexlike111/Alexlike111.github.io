#!/usr/bin/env node
// Release gate (audit #24). Plain Node, no dependencies.
//
//   node scripts/check-release.mjs            source checks + dist checks (dist checks are skipped with a note if dist/ is missing)
//   node scripts/check-release.mjs --src      source checks only (this is what `npm run build` runs as `prebuild`)
//   node scripts/check-release.mjs --dist     dist checks only; a missing dist/ is a failure
//   node scripts/check-release.mjs --strict   owner blockers (placeholders, synthesized audio) also fail the run
//
// Severity:
//   FAIL     always exits 1 (a bug the repo can fix by itself)
//   BLOCKER  needs the owner (real SaaS token, recorded audio). A warning normally, exits 1 with --strict / RELEASE_STRICT=1.
//   WARN     worth a look, never fails
// See docs/RELEASE.md for the full Playgama checklist.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const strict = args.includes('--strict') || process.env.RELEASE_STRICT === '1';
const onlySrc = args.includes('--src');
const onlyDist = args.includes('--dist');
const runSrc = !onlyDist;
const runDist = !onlySrc;

// ---------------------------------------------------------------------------------------------------------------- budgets
const KB = 1024;
const MB = 1024 * KB;
const BUDGET = {
  jsGzip: 340 * KB,          // all game JS chunks, gzip (0.1.7: ~306 KB; the audit target was ~280 KB)
  cssGzip: 20 * KB,          // all CSS, gzip (0.1.7: ~12 KB)
  gameGzip: 365 * KB,        // JS + CSS + HTML, gzip
  bridgeRaw: 450 * KB,       // the Playgama Bridge loader (local copy, 378 KB raw in 2.4.0). Not ours to shrink, but watch for growth.
  distRaw: 15 * MB,          // whole dist/. Playgama accepts 300 MB; we want a fast first load.
  fileRaw: 5 * MB,           // any single file except the Bridge loader
  sfxRaw: 8 * MB,            // dist/sfx (placeholders are ~0.5 MB; a real 60-120 s music loop in ogg + mp3 takes a few MB)
};

// ---------------------------------------------------------------------------------------------------------------- reporting
const rows = [];
let fails = 0, blockers = 0, warns = 0;
function rec(level, name, detail = '') {
  rows.push({ level, name, detail });
  if (level === 'FAIL') fails++;
  else if (level === 'BLOCKER') blockers++;
  else if (level === 'WARN') warns++;
  const tag = { PASS: 'PASS   ', FAIL: 'FAIL   ', BLOCKER: 'BLOCKER', WARN: 'WARN   ', INFO: 'INFO   ' }[level];
  console.log(`${tag} ${name}${detail ? '  - ' + detail : ''}`);
}
const pass = (n, d) => rec('PASS', n, d);
const fail = (n, d) => rec('FAIL', n, d);
const blocker = (n, d) => rec('BLOCKER', n, d);
const warn = (n, d) => rec('WARN', n, d);
const info = (n, d) => rec('INFO', n, d);
/** ok -> PASS, otherwise the given level */
const expect = (ok, name, detail, level = 'FAIL') => (ok ? pass(name) : rec(level, name, detail));

// ---------------------------------------------------------------------------------------------------------------- helpers
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => existsSync(path.join(ROOT, p));
function walk(dir, out = []) {
  const abs = path.join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    const p = path.posix.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
/** Source text with comments removed (naive: good enough to ignore prose such as "no localStorage" in a header comment). */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
}
function grepCode(files, re, { skip = () => false } = {}) {
  const hits = [];
  for (const f of files) {
    if (skip(f)) continue;
    const lines = code(read(f)).split('\n');
    lines.forEach((l, i) => { if (re.test(l)) hits.push(`${f}:${i + 1}`); });
  }
  return hits;
}
const short = (a, n = 6) => a.slice(0, n).join(', ') + (a.length > n ? ` (+${a.length - n} more)` : '');
const gz = (buf) => gzipSync(buf, { level: 9 }).length;
const fmt = (n) => (n >= MB ? (n / MB).toFixed(2) + ' MB' : (n / KB).toFixed(1) + ' KB');

const pkg = JSON.parse(read('package.json'));
const version = pkg.version;

// ================================================================================================================ SOURCE
function sourceChecks() {
  console.log('\n== source ==');
  const srcFiles = walk('src').filter((f) => /\.(ts|css|html)$/.test(f));
  const prodSrc = srcFiles.filter((f) => !f.startsWith('src/editor/'));   // the level editor is a dev page, not part of the build

  // required files
  const required = ['index.html', 'package.json', 'vite.config.ts', 'tsconfig.json', 'src/main.ts', 'src/platform/bridge.ts',
    'public/playgama-bridge-config.json', 'docs/RELEASE.md', 'docs/AUDIO.md'];
  const missing = required.filter((f) => !exists(f));
  expect(missing.length === 0, 'required source files present', `missing: ${missing.join(', ')}`);
  expect(/playgamaBridge\(/.test(read('vite.config.ts')), 'vite.config.ts uses the playgamaBridge plugin (Bridge script ships and loads first)');

  // version label
  expect(/^\d+\.\d+\.\d+$/.test(version), 'package.json version is semver', version);
  const html = read('index.html');
  expect(/id="ver"[^>]*>\s*__BUILD__/.test(html), 'index.html has the #ver build label placeholder (__BUILD__)');
  expect(/__BUILD__/.test(read('vite.config.ts')) && /package\.json/.test(read('vite.config.ts')), 'vite.config.ts stamps the label from package.json');
  if (exists('package-lock.json')) {
    try {
      const lock = JSON.parse(read('package-lock.json'));
      const lv = lock.version ?? lock.packages?.['']?.version;
      expect(lv === version, 'package-lock.json version matches package.json', `lock ${lv} vs package ${version}`, 'WARN');
    } catch { warn('package-lock.json is not valid JSON'); }
  }

  // bridge config
  let cfg = null;
  try { cfg = JSON.parse(read('public/playgama-bridge-config.json')); pass('playgama-bridge-config.json is valid JSON'); }
  catch (e) { fail('playgama-bridge-config.json is valid JSON', String(e.message)); }
  if (cfg) {
    const adv = cfg.advertisement ?? {};
    expect(typeof adv.minimumDelayBetweenInterstitial === 'number' && typeof adv.initialInterstitialDelay === 'number',
      'config sets the interstitial delays (Bridge decides when an ad shows, the game has no timers)');
    const lbs = Array.isArray(cfg.leaderboards) ? cfg.leaderboards : [];
    const trackIds = [...read('src/track/tracks.ts').matchAll(/\bid:\s*'(t\d+)'/g)].map((m) => m[1]);
    const prefix = (read('src/config.ts').match(/leaderboardPrefix:\s*'([^']+)'/) ?? [])[1];
    if (prefix && trackIds.length) {
      const want = trackIds.map((id) => prefix + id);
      const have = new Set(lbs.map((l) => l.id));
      const lack = want.filter((id) => !have.has(id));
      expect(lack.length === 0, `config declares a leaderboard for every track (${want.join(', ')})`, `missing: ${lack.join(', ')}`);
    } else warn('could not derive the leaderboard ids from src/config.ts + src/track/tracks.ts');
    expect(lbs.filter((l) => l.isMain).length <= 1, 'at most one main leaderboard');
  }

  // owner blockers: placeholders
  const textExt = /\.(ts|js|mjs|json|html|css|md|yml|yaml|txt)$/;
  const scan = [...walk('src'), ...walk('public').filter((f) => textExt.test(f)), 'index.html', 'vite.config.ts', 'package.json'];
  const ph = [];
  for (const f of scan) {
    if (!exists(f)) continue;
    read(f).split('\n').forEach((l, i) => { if (/REPLACE_WITH/.test(l)) ph.push(`${f}:${i + 1}`); });
  }
  if (ph.length) blocker('no REPLACE_WITH placeholders left', `${short(ph)}  (owner: fill in the real Playgama SaaS public token)`);
  else pass('no REPLACE_WITH placeholders left');
  if (cfg && cfg.saas && !cfg.saas.publicToken) blocker('SaaS public token is set', 'saas.publicToken is empty');

  // audio
  const audioDoc = exists('docs/AUDIO.md') ? read('docs/AUDIO.md') : '';
  if (/STATUS:\s*PLACEHOLDERS/i.test(audioDoc) || /NOT ALLOWED FOR PUBLISHING/i.test(audioDoc)) {
    blocker('audio is recorded, licensed, not synthesized (Playgama 3.3.1 / 3.3.2)', 'docs/AUDIO.md still says PLACEHOLDERS (owner: supply CC0/licensed recordings, fill in the licence table)');
  } else pass('docs/AUDIO.md has no placeholder status');
  if (exists('public/sfx')) {
    const files = readdirSync(path.join(ROOT, 'public/sfx')).filter((f) => /\.(ogg|mp3)$/.test(f));   // LICENSES.txt etc. are not sounds
    const names = new Set(files.map((f) => f.replace(/\.(ogg|mp3)$/, '')));
    const unpaired = [...names].filter((n) => !(files.includes(n + '.ogg') && files.includes(n + '.mp3')));
    expect(unpaired.length === 0, 'every sound ships as ogg + mp3 (Safari fallback)', `unpaired: ${short(unpaired)}`);
    // names the AudioManager loads
    const a = exists('src/audio/audio.ts') ? read('src/audio/audio.ts') : '';
    const fam = a.match(/const FAMILIES = \{([\s\S]*?)\}\s*as const/);
    const loops = a.match(/const LOOPS[^=]*=\s*\[([^\]]*)\]/);
    const plain = a.match(/const PLAIN[^=]*=\s*\[([^\]]*)\]/);
    if (fam && loops && plain) {
      const need = [];
      for (const m of loops[1].matchAll(/'([^']+)'/g)) need.push(m[1]);
      for (const m of plain[1].matchAll(/'([^']+)'/g)) need.push(m[1]);
      for (const m of fam[1].matchAll(/(\w+)\s*:\s*(\d+)/g)) for (let i = 1; i <= Number(m[2]); i++) need.push(`${m[1]}_${i}`);
      const lack = need.filter((n) => !names.has(n));
      expect(lack.length === 0, `all ${need.length} sounds the audio manager loads exist in public/sfx`, `missing: ${short(lack)}`);
    } else warn('could not parse the sound list from src/audio/audio.ts (check skipped)');
  } else fail('public/sfx exists');

  // hygiene (production sources only)
  const logs = grepCode(prodSrc.filter((f) => f.endsWith('.ts')), /\bconsole\.(log|debug|info|trace)\s*\(/);
  expect(logs.length === 0, 'no console.log / debug / info / trace in src (warn and error are fine)', short(logs));
  const store = grepCode(prodSrc.filter((f) => f.endsWith('.ts')), /\b(localStorage|sessionStorage|indexedDB|document\.cookie)\b/);
  expect(store.length === 0, 'no localStorage / sessionStorage / IndexedDB / cookies (Playgama 3.2.1: Bridge storage only)', short(store));
  const esc = grepCode(prodSrc.filter((f) => f.endsWith('.ts')), /(['"`]Escape['"`]|['"`]Esc['"`]|keyCode\s*={2,3}\s*27|which\s*={2,3}\s*27)/);
  expect(esc.length === 0, 'the Esc key is not bound (Playgama 1.5.2)', short(esc));
  const analytics = grepCode([...prodSrc, 'index.html'].filter(exists), /(googletagmanager|google-analytics|\bgtag\s*\(|\bga\s*\(\s*['"]send)/i);
  expect(analytics.length === 0, 'no external analytics (Playgama 1.2.4)', short(analytics));
  const ext = [];
  for (const f of [...prodSrc.filter((x) => /\.(css|html)$/.test(x)), 'index.html']) {
    read(f).split('\n').forEach((l, i) => { if (/(src|href)\s*=\s*["']https?:\/\/|url\(\s*["']?https?:|@import\s+(url\()?["']?https?:/i.test(l)) ext.push(`${f}:${i + 1}`); });
  }
  expect(ext.length === 0, 'no external resources in html / css (Playgama 1.2.5: everything ships in the archive)', short(ext));
  const urls = grepCode(prodSrc.filter((f) => f.endsWith('.ts')), /['"`]https?:\/\/(?!www\.w3\.org)/);
  expect(urls.length === 0, 'no hard-coded http(s) URLs in game code (no external fetches)', short(urls), 'WARN');
}

// ================================================================================================================ DIST
function distChecks() {
  console.log('\n== dist ==');
  if (!exists('dist/index.html')) {
    if (onlyDist) fail('dist/ is built', 'run `npm run build` first');
    else info('dist/ not built - dist checks skipped', 'run `npm run build`, then `npm run check-release`');
    return;
  }
  const all = walk('dist');
  const size = (f) => statSync(path.join(ROOT, f)).size;
  const bytes = (f) => readFileSync(path.join(ROOT, f));
  const html = read('dist/index.html');

  // required files
  const needed = ['dist/index.html', 'dist/playgama-bridge-config.json', 'dist/playgama-bridge.js'];
  const lack = needed.filter((f) => !exists(f));
  expect(lack.length === 0, 'dist has index.html + playgama-bridge-config.json + playgama-bridge.js at the root (Playgama 1.3.2, required step 1)', lack.join(', '));
  const jsFiles = all.filter((f) => /^dist\/assets\/.*\.js$/.test(f));
  const cssFiles = all.filter((f) => /^dist\/assets\/.*\.css$/.test(f));
  expect(jsFiles.length > 0, 'dist/assets has the game JS');
  const sfxDist = all.filter((f) => f.startsWith('dist/sfx/')).length;
  const sfxSrc = walk('public/sfx').length;
  expect(sfxDist === sfxSrc && sfxDist > 0, `dist/sfx has all ${sfxSrc} sound files`, `${sfxDist} in dist vs ${sfxSrc} in public/sfx`);
  const bad = all.filter((f) => !/^[A-Za-z0-9._\-\/]+$/.test(f.slice(5)));
  expect(bad.length === 0, 'file and folder names are Latin only (Playgama 1.3.2)', short(bad));
  const maps = all.filter((f) => f.endsWith('.map'));
  expect(maps.length === 0, 'no source maps in dist', short(maps), 'WARN');

  // Bridge first in <head>, loaded normally (required step 2)
  const head = (html.match(/<head[^>]*>([\s\S]*?)<\/head>/i) ?? [])[1] ?? '';
  const firstScript = (head.match(/<script\b[^>]*>/i) ?? [])[0] ?? '';
  expect(/src=["']\.?\/?playgama-bridge\.js["']/.test(firstScript) && !/\b(async|defer)\b/i.test(firstScript) && !/type=["']module/i.test(firstScript),
    'the Bridge script is the first <script> in <head>, not async / defer / module (required step 2)', firstScript || 'no script found');

  // version label
  expect(!html.includes('__BUILD__'), 'build label was stamped (no __BUILD__ left in dist/index.html)');
  const label = (html.match(/id="ver"[^>]*>([^<]*)</) ?? [])[1] ?? '';
  expect(label.includes(`v${version}`), `build label shows v${version}`, JSON.stringify(label));

  // config
  if (exists('dist/playgama-bridge-config.json')) {
    const cfgText = read('dist/playgama-bridge-config.json');
    try { JSON.parse(cfgText); pass('dist config is valid JSON'); } catch (e) { fail('dist config is valid JSON', String(e.message)); }
    if (/REPLACE_WITH/.test(cfgText)) blocker('dist config has no REPLACE_WITH placeholder', 'owner: real SaaS public token');
  }
  const phDist = all.filter((f) => /\.(js|html|json|css)$/.test(f) && f !== 'dist/playgama-bridge.js' && /REPLACE_WITH/.test(read(f)) && f !== 'dist/playgama-bridge-config.json');
  expect(phDist.length === 0, 'no REPLACE_WITH in the built game files', short(phDist), 'BLOCKER');

  // external resources / analytics in what we ship
  const own = [...jsFiles, ...cssFiles, 'dist/index.html'];
  const ana = own.filter((f) => /(googletagmanager|google-analytics\.com)/i.test(read(f)));
  expect(ana.length === 0, 'no external analytics in the built game files (Playgama 1.2.4)', short(ana));
  const extHtml = /(src|href)\s*=\s*["']https?:\/\//i.test(html);
  expect(!extHtml, 'dist/index.html loads nothing from the network (Playgama 1.2.5)');

  // budgets
  console.log('\n== budgets ==');
  const gzOf = (files) => files.reduce((s, f) => s + gz(bytes(f)), 0);
  const jsGz = gzOf(jsFiles), cssGz = gzOf(cssFiles), htmlGz = gz(bytes('dist/index.html'));
  const budget = (name, value, limit, level = 'FAIL') =>
    expect(value <= limit, `${name}: ${fmt(value)} <= ${fmt(limit)}`, `${fmt(value)} exceeds the ${fmt(limit)} budget (${Math.round((value / limit) * 100)}%)`, level);
  budget('game JS (gzip)', jsGz, BUDGET.jsGzip);
  budget('game CSS (gzip)', cssGz, BUDGET.cssGzip);
  budget('JS + CSS + HTML (gzip)', jsGz + cssGz + htmlGz, BUDGET.gameGzip);
  if (exists('dist/playgama-bridge.js')) budget('Bridge loader (raw)', size('dist/playgama-bridge.js'), BUDGET.bridgeRaw, 'WARN');
  const total = all.reduce((s, f) => s + size(f), 0);
  budget('whole dist/ (raw)', total, BUDGET.distRaw);
  const sfxTotal = all.filter((f) => f.startsWith('dist/sfx/')).reduce((s, f) => s + size(f), 0);
  budget('dist/sfx (raw)', sfxTotal, BUDGET.sfxRaw);
  const big = all.filter((f) => f !== 'dist/playgama-bridge.js' && size(f) > BUDGET.fileRaw);
  expect(big.length === 0, `no single file over ${fmt(BUDGET.fileRaw)}`, short(big));
  info(`dist: ${all.length} files, ${fmt(total)} raw; JS ${fmt(jsGz)} gz, CSS ${fmt(cssGz)} gz`);
}

// ================================================================================================================ run
console.log(`Smash Circuit release check  v${version}${strict ? '  (strict: owner blockers fail the run)' : ''}`);
if (runSrc) sourceChecks();
if (runDist) distChecks();

console.log(`\nresult: ${fails} fail, ${blockers} owner blocker${blockers === 1 ? '' : 's'}${strict ? '' : ' (not failing without --strict)'}, ${warns} warning${warns === 1 ? '' : 's'}`);
if (fails > 0) { console.log('RELEASE CHECK FAILED'); process.exit(1); }
if (strict && blockers > 0) { console.log('RELEASE CHECK FAILED (strict): owner actions are still open, see docs/RELEASE.md'); process.exit(1); }
console.log(blockers > 0 ? 'release check passed, but owner actions are still open (docs/RELEASE.md)' : 'release check passed');
