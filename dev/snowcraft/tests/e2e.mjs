// SNOWCRAFT e2e / screenshot harness (Playwright + Chromium). Builds the single-file bundle, opens dist/index.html via file://,
// fails on console errors, runs scripted scenarios through window.__sc and saves PNGs to shots/.
//   node tests/e2e.mjs            full run (desktop 1600x900 + phone 844x390)
//   node tests/e2e.mjs --nobuild  skip `vite build`
//   node tests/e2e.mjs --only=desktop,night   filter profiles / scenario names (substring match)
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = createRequire('/usr/lib/node_modules/')('playwright'); }
const { chromium } = playwright;

const args = process.argv.slice(2);
const only = (args.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
if (!args.includes('--nobuild')) {
  console.log('building...');
  execSync('npx vite build', { cwd: root, stdio: 'inherit' });
}
const shots = path.join(root, 'shots');
if (!existsSync(shots)) mkdirSync(shots, { recursive: true });
const url = pathToFileURL(path.join(root, 'dist', 'index.html')).href;

const PROFILES = [
  { name: 'desktop', viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, hasTouch: false, isMobile: false },
  { name: 'phone', viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
];

// scenarios: time in hours, camera centre (cells) may be a function of the site registry
const site = (sites, key) => sites.find(s => s.key === key);
const SCENES = [
  { name: 'surface-noon', time: 12, at: () => [1042, 252] },
  { name: 'surface-dusk', time: 18.35, lit: true, at: () => [1000, 252] },
  { name: 'surface-night-aurora', time: 22.5, aurora: 1, lit: true, at: () => [1010, 252] },
  { name: 'station', time: 15, at: () => [990, 248] },
  { name: 'station-night-lit', time: 21, aurora: 0.6, lit: true, at: () => [990, 248] },
  { name: 'forest', time: 12, at: () => [420, 218] },
  { name: 'lake', time: 11, at: (s) => { const l = site(s, 'lake'); return [l.x, l.y - 14]; } },
  { name: 'ridge', time: 10, at: (s) => { const r = site(s, 'ridge'); return [r.x + 10, r.y - 10]; } },
  { name: 'wreck', time: 13, at: (s) => { const w = site(s, 'wreck'); return [w.x, w.y - 6]; } },
  { name: 'tower', time: 9, at: (s) => { const w = site(s, 'tower'); return [w.x, w.y + 10]; } },
  { name: 'hotspring', time: 14, at: (s) => { const w = site(s, 'spring'); return [w.x, w.y - 18]; } },
  { name: 'blizzard', time: 14, weather: { storm: 1, snowfall: 1, visibility: 0.35, wind: 14 }, at: () => [1042, 252] },
  { name: 'icecave', time: 12, torch: true, at: (s) => { const w = site(s, 'icecave'); return [w.x, w.y]; } },
  { name: 'grotto', time: 12, torch: true, at: (s) => { const w = site(s, 'grotto'); return [w.x, w.y]; } },
  { name: 'crystal-lava', time: 12, torch: true, at: (s) => { const w = site(s, 'crystals'); return [w.x - 40, w.y]; } },
];

let failures = 0;
const log = (...a) => console.log(...a);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const prof of PROFILES) {
  if (only.length && !only.some(o => prof.name.includes(o) || SCENES.some(s => s.name.includes(o)))) continue;
  const ctx = await browser.newContext({ viewport: prof.viewport, deviceScaleFactor: prof.deviceScaleFactor, hasTouch: prof.hasTouch, isMobile: prof.isMobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + (e.stack || e.message)));
  await page.goto(url);
  await page.waitForFunction(() => window.__sc && window.__sc.ready, null, { timeout: 30000 });
  const info = await page.evaluate(() => ({ genMs: window.__sc.genMs, sites: window.__sc.sites(), scale: window.__sc.G.cam.scale, vw: window.__sc.G.cam.viewW, vh: window.__sc.G.cam.viewH }));
  log(`[${prof.name}] worldgen ${info.genMs.toFixed(0)} ms, scale ${info.scale}, view ${info.vw.toFixed(0)}x${info.vh.toFixed(0)} cells, sites: ${info.sites.map(s => s.key).join(',')}`);
  for (const sc of SCENES) {
    if (only.length && !only.some(o => sc.name.includes(o) || prof.name.includes(o))) continue;
    const [x, y] = sc.at(info.sites);
    const scp = { time: sc.time, aurora: sc.aurora, lit: sc.lit, torch: sc.torch, weather: sc.weather };
    await page.evaluate(({ sc, x, y }) => {
      const S = window.__sc;
      S.setWeather(Object.assign({ storm: 0, snowfall: 0.15, visibility: 1, wind: 3 }, sc.weather || {}, { aurora: sc.aurora ?? 1 }));
      S.setTime(sc.time * 60);
      S.lightStation(!!sc.lit);
      S.viewerLight(!!sc.torch);
      S.teleport(x, y);
    }, { sc: scp, x, y });
    await page.waitForFunction(() => window.__sc.shotReady, null, { timeout: 15000 });
    await page.waitForTimeout(250);
    const file = path.join(shots, `${prof.name}-${sc.name}.png`);
    await page.screenshot({ path: file });
    const p = await page.evaluate(() => window.__sc.perf());
    log(`  ${sc.name.padEnd(22)} render avg ${p.avg.toFixed(2)} ms  (sky ${p.last.sky.toFixed(1)} light ${p.last.light.toFixed(1)} terrain ${p.last.terrain.toFixed(1)} layers ${p.last.layers.toFixed(1)})`);
  }
  if (errors.length) { failures += errors.length; log(`[${prof.name}] ERRORS:\n  ` + errors.join('\n  ')); }
  await ctx.close();
}
await browser.close();
if (failures) { console.error(`FAILED: ${failures} console error(s)`); process.exit(1); }
log('e2e ok');
