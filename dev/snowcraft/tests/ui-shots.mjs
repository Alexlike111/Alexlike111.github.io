// UI / «Чутьё» screenshots + the ui / senses self-test groups, desktop 1600x900 and phone 844x390 (touch, dpr 2).
//   node tests/ui-shots.mjs                 builds dist/index.html and opens it via file://
//   node tests/ui-shots.mjs --url=http://localhost:5180/   use a running dev server instead (no build)
// Output: shots/ui-<profile>-<scene>[-senses].png, shots/ui-<profile>-title-{main,new}.png, report on stdout; exit code 1 if a self-test fails or the console shows errors.
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch {
  for (const dir of ['/opt/node-tools/node_modules/', '/usr/lib/node_modules/', '/usr/local/lib/node_modules/']) { try { playwright = createRequire(dir)('playwright'); break; } catch { /* next */ } }
  if (!playwright) throw new Error('playwright not found (npm i -g playwright)');
}
const args = process.argv.slice(2);
const urlArg = (args.find(a => a.startsWith('--url=')) || '').slice(6);
const only = (args.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
if (!urlArg && !args.includes('--nobuild')) { console.log('building...'); execSync('npx vite build', { cwd: root, stdio: 'inherit' }); }
const base = urlArg || pathToFileURL(path.join(root, 'dist', 'index.html')).href;
const shots = path.join(root, 'shots');
if (!existsSync(shots)) mkdirSync(shots, { recursive: true });

const PROFILES = [
  { name: 'desktop', viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, hasTouch: false, isMobile: false, q: 2 },
  { name: 'phone', viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, q: 1 },
];
const browser = await playwright.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failures = 0;
const log = (...a) => console.log(...a);

async function open(prof, query = '', hash = '') {
  const ctx = await browser.newContext({ viewport: prof.viewport, deviceScaleFactor: prof.deviceScaleFactor, hasTouch: prof.hasTouch, isMobile: prof.isMobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + (e.stack || e.message)));
  await page.goto(base + `?q=${prof.q}${query}${hash}`);
  await page.waitForFunction(() => window.__sc && window.__sc.ready, null, { timeout: 60000 });
  await page.waitForTimeout(400);
  return { ctx, page, errors };
}
const settle = (page, n = 16) => page.evaluate((k) => { for (let i = 0; i < k; i++) window.__sc.render(0.1); }, n);

for (const prof of PROFILES) {
  if (only.length && !only.includes(prof.name)) continue;
  log(`\n[${prof.name}] ${prof.viewport.width}x${prof.viewport.height}`);
  const { ctx, page, errors } = await open(prof);
  const shot = async (tag) => { await settle(page); await page.waitForTimeout(200); await page.screenshot({ path: path.join(shots, `ui-${prof.name}-${tag}.png`) }); };
  const pair = async (tag) => {
    await shot(tag);
    await page.evaluate(() => window.__sc.senses(true)); await shot(tag + '-senses');
    await page.evaluate(() => window.__sc.senses(false)); await settle(page);
  };
  // day 1 twilight at the station
  await page.evaluate(() => { const s = window.__sc; s.setDay(1, 11); s.setWeather({ wind: 3, snowfall: 0.1, storm: 0, aurora: 0.2 }); s.teleport(692, 272); s.step(30); });
  await pair('day1');
  // deep night, the stove burns, the player stands in the house (warm windows)
  await page.evaluate(() => { const s = window.__sc, G = s.G; s.setDay(6, 1); s.setWeather({ wind: 2, snowfall: 0, storm: 0, aurora: 0.8 }); const st = G.fixtures.find(f => f.kind === 'stove'); st.lit = true; st.fuel = 900; s.teleport((152 + 9) * 4, 272); s.stepFast(60 * 20); s.step(5); });
  await pair('night-house');
  // storm outside
  await page.evaluate(() => { const s = window.__sc; s.setDay(3, 20); s.setWeather({ wind: 12, snowfall: 1, storm: 1, visibility: 0.5, ambientT: -34 }); s.teleport(752, 272); s.stepFast(60 * 4); s.step(5); });
  await pair('storm');
  // an igloo with a lamp (heat) and a draughty stone hut (leaks)
  await page.evaluate(() => {
    const s = window.__sc, G = s.G, tk = s.testkit, F = s.mods.fixtures;
    G.fixtures.find(f => f.kind === 'stove').lit = false;
    s.setDay(2, 1); s.setWeather({ ambientT: -30, wind: 5, storm: 0, snowfall: 0.1, aurora: 0.5 });
    s.arena(1000, 272, { dens: 310, loose: 0, depth: 40, up: 70, halfW: 100 });
    for (let x = 905; x < 945; x++) for (let y = 272; y < 290; y++) tk.put(x, y, 2, 50 + ((x * 7) % 20));                   // loose patch
    for (let x = 1058; x < 1098; x++) for (let y = 272; y < 290; y++) tk.put(x, y, 2, 236 + ((x * 3) % 12));              // dense patch
    for (let tx = 240; tx <= 252; tx++) tk.tileBlock(tx, 60, 1, 1, 8, 0, 0);                                                // stone hut with a gap in the windward wall
    for (let ty = 61; ty <= 67; ty++) { if (!(ty >= 65 && ty <= 66)) tk.tileBlock(240, ty, 1, 1, 8, 0, 0); tk.tileBlock(252, ty, 1, 1, 8, 0, 0); }
    const ig = tk.igloo(1060, 68, { iw: 6, wallRows: 6, door: false, vent: true });
    s.teleport(1000, 272); s.stepFast(20);
    F.placeFixture('fat_lamp', 247, 67, { force: true, fuel: 600, lit: true });
    F.placeFixture('fat_lamp', ig.L + 3, 67, { force: true, fuel: 600, lit: true });
    s.stepFast(60 * 40);
  });
  await pair('igloo-hut');
  if (errors.length) { failures++; log('  console errors:', errors.slice(0, 5)); }
  await ctx.close();

  // the self-test groups run on a fresh page (the scenes above freeze and rebuild the world)
  const st = await open(prof);
  const reps = await st.page.evaluate(async () => { await window.__sc.selftest('senses'); const a = window.__selftestReport; await window.__sc.selftest('ui'); return [a, window.__selftestReport]; });
  for (const rep of reps) { log(rep.split('\n')[0]); for (const l of rep.split('\n')) if (l.startsWith('FAIL')) { failures++; log('  ' + l); } }
  if (st.errors.length) { failures++; log('  self-test console errors:', st.errors.slice(0, 5)); }
  await st.ctx.close();

  // title: composed scene (igloo + Север), main and new-game views
  const t = await open(prof, '&title=1');
  await t.page.waitForTimeout(1200);
  await t.page.screenshot({ path: path.join(shots, `ui-${prof.name}-title-main.png`) });
  await t.page.click('[data-a="new"]'); await t.page.waitForTimeout(300);
  await t.page.screenshot({ path: path.join(shots, `ui-${prof.name}-title-new.png`) });
  if (t.errors.length) { failures++; log('  title console errors:', t.errors.slice(0, 5)); }
  await t.ctx.close();
}
await browser.close();
log(failures ? `\n${failures} problem(s)` : '\nall ui / senses checks passed');
process.exit(failures ? 1 : 0);
