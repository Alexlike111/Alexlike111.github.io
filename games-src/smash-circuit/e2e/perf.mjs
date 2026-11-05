// Performance probe (Playwright): boot time, click-to-GO time, frame cost on a CPU-throttled phone, draw calls / triangles.
// Usage: node e2e/perf.mjs [--no-build] [--rate=4] [--track=t1] [--secs=8] [--label=name]
// Serves dist/ with `vite preview` on :4196 (E2E_PORT overrides). Prints one JSON line; headless Chromium renders with software GL,
// so absolute ms are pessimistic: compare before / after on the same machine.
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const PORT = Number(process.env.E2E_PORT) || 4196;
const RATE = Number(opt('rate', 4));
const TRACK = opt('track', 't1');
const SECS = Number(opt('secs', 8));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!args.includes('--no-build')) {
  const b = spawnSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: root, encoding: 'utf8' });
  if (b.status !== 0) { console.error(b.stdout, b.stderr); process.exit(2); }
}
const server = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'],
  { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
for (let i = 0; i < 240; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch { /* not up yet */ } await sleep(500); }

const browser = await chromium.launch();
const res = { label: opt('label', ''), rate: RATE, track: TRACK };
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const cdp = await ctx.newCDPSession(page);
  if (RATE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE });
  const t0 = Date.now();
  await page.goto(`http://localhost:${PORT}/?debug`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.state === 'menu', null, { timeout: 90000 });
  res.menuMs = Date.now() - t0;
  await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 30000 });
  res.bootGoneMs = Date.now() - t0;
  // a player spends a few seconds on the menu: wait for the idle-time warm-up (when this build has one) before the first race
  const w0 = Date.now();
  res.warmed = await page.waitForFunction(() => window.__render?.warm || false, null, { timeout: Number(opt('warmwait', 25)) * 1000 }).then(() => true).catch(() => false);
  res.warmWaitMs = Date.now() - w0;
  res.warm = await page.evaluate(() => window.__render?.warm ?? null);
  res.programsMenu = await page.evaluate(() => window.__render?.programs ?? null);
  const progBefore = await page.evaluate(() => window.__render?.programList?.() ?? []);
  await sleep(500);
  // skip the first-run pickers
  await page.evaluate(() => { const g = window.__game; g.setSettings({ ...g.save.settings, controls: 'buttons', controlsPicked: true, tutorialDone: true }); });

  // click-to-GO: rAF gaps from the click on show the stall of the race build
  await page.evaluate(() => {
    window.__gaps = []; window.__lastRaf = performance.now(); window.__rafOn = true;
    const tick = (n) => { window.__gaps.push(n - window.__lastRaf); window.__lastRaf = n; if (window.__rafOn) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await page.click('[data-act=play]');
  await sleep(500);
  const clickAt = await page.evaluate(() => performance.now());
  await page.evaluate(() => { window.__gaps.length = 0; });
  await page.evaluate(() => {
    for (const ev of ['pointerdown', 'click']) document.addEventListener(ev, () => { if (!window.__clickT) window.__clickT = performance.now(); }, true);
    window.__long = [];
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([Math.round(e.startTime - (window.__clickT || 0)), Math.round(e.duration)]); }).observe({ entryTypes: ['longtask'] }); } catch { /* no longtask support */ }
  });
  await page.click(`[data-act=track][data-id=${TRACK}]`);
  await page.waitForFunction(() => window.__game?.state === 'racing', null, { timeout: 60000 });
  const realClick = await page.evaluate(() => window.__clickT);
  res.clickLagMs = Math.round(realClick - clickAt);
  res.clickToRacingMs = Math.round((await page.evaluate(() => performance.now())) - realClick);
  await page.waitForFunction(() => window.__game.sim?.race.phase === 'racing', null, { timeout: 30000 });
  res.clickToGoMs = Math.round((await page.evaluate(() => performance.now())) - realClick);
  res.load = await page.evaluate(() => window.__render.load);
  res.quality0 = await page.evaluate(() => window.__render.quality);
  res.longTasks = await page.evaluate(() => window.__long.filter((l) => l[0] > -50 && l[0] < 4000));
  res.programsAtGo = await page.evaluate(() => window.__render?.programs ?? null);
  if (opt('programs', '')) {
    const after = await page.evaluate(() => window.__render?.programList?.() ?? []);
    const had = new Set(progBefore);
    res.newPrograms = after.filter((x) => !had.has(x));
  }
  res.maxGapToGoMs = await page.evaluate(() => Math.round(Math.max(...window.__gaps)));
  res.gapsOver100ToGo = await page.evaluate(() => window.__gaps.filter((g) => g > 100).length);

  // drive with a pure pursuit for SECS and sample the frame cost
  await page.evaluate(() => {
    window.__gaps = []; window.__samples = [];
    window.__sampT = setInterval(() => { const r = window.__render; if (r) window.__samples.push({ dc: r.drawCalls, tr: r.triangles, cpu: r.cpuMs, fps: r.fps, q: r.quality }); }, 250);
  });
  const steerNow = () => page.evaluate(() => {
    const s = window.__game.sim; const c = s.cars[0];
    const p = s.track.nearest(c.x, c.y);
    const tp = s.track.sampleAt(p.s + 14 + Math.abs(c.speed) * 0.45);
    let err = Math.atan2(tp.y - c.y, tp.x - c.x) - c.angle;
    while (err > Math.PI) err -= 2 * Math.PI;
    while (err < -Math.PI) err += 2 * Math.PI;
    return Math.max(-1, Math.min(1, -err * 1.8));
  });
  const tEnd = Date.now() + SECS * 1000;
  while (Date.now() < tEnd) { await steerNow(); await sleep(100); }
  const stats = await page.evaluate(() => {
    clearInterval(window.__sampT);
    const g = window.__gaps.slice(2).sort((a, b) => a - b);
    const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
    const S = window.__samples;
    return {
      frames: g.length, frameAvgMs: +avg(g).toFixed(1), frameP95Ms: +(g[Math.floor(g.length * 0.95)] || 0).toFixed(1), frameMaxMs: +(g[g.length - 1] || 0).toFixed(1),
      drawCalls: Math.round(avg(S.map((s) => s.dc))), triangles: Math.round(avg(S.map((s) => s.tr))), cpuMs: +avg(S.map((s) => s.cpu)).toFixed(2),
      fps: +avg(S.map((s) => s.fps)).toFixed(1), quality: S[S.length - 1]?.q,
      stepMs: +window.__game.sim.stepMs.toFixed(2),
    };
  });
  Object.assign(res, stats);

  // frozen idle: pause, then count rAF / draw calls
  await page.evaluate(() => window.__game.pause());
  await sleep(600);
  res.pausedDrawCalls = await page.evaluate(() => window.__render.drawCalls);

  // second load of the same track (retry): stall of the rebuild
  await page.evaluate(() => window.__game.resume());
  await page.evaluate(() => window.__game.menu());
  await sleep(600);
  await page.evaluate(() => {
    window.__gaps = []; window.__rafOn = true; window.__lastRaf = performance.now();
    const tick = (n) => { window.__gaps.push(n - window.__lastRaf); window.__lastRaf = n; if (window.__rafOn) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const c2 = await page.evaluate(() => performance.now());
  await page.evaluate((id) => window.__game.startRace(id), TRACK);
  await page.waitForFunction(() => window.__game?.state === 'racing', null, { timeout: 60000 });
  res.secondLoadMs = Math.round((await page.evaluate(() => performance.now())) - c2);
  await sleep(1500);
  res.secondMaxGapMs = await page.evaluate(() => { window.__rafOn = false; return Math.round(Math.max(...window.__gaps)); });
  res.errors = errors;
} catch (e) { res.fatal = String((e && e.stack) || e); }
await browser.close();
server.kill();
console.log(JSON.stringify(res));
