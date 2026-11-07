// Screenshots of every zone of the arctic world through the dev viewer:  node tests/world-shots.mjs [zone ...]
// Starts `vite --port 5181` itself when nothing answers there. Output: shots/world-<device>-<zone>-<when>.png
// Conditions: day 1 noon, day 6 night (moon + aurora), day 11 noon, storm (day 6 noon).  Devices: desktop 1600x900, phone 844x390 @2x.
import { createRequire } from 'module';
import { spawn } from 'child_process';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 5181, BASE = `http://localhost:${PORT}/tests/viewer.html`;
const ALL = ['cape', 'portal', 'mineA', 'collapse', 'hut', 'methane', 'lake', 'cairn', 'tundra', 'station', 'shed', 'beach', 'whale', 'tide', 'fast', 'seal', 'iceberg', 'icecave', 'pack', 'lead', 'ship', 'cabin', 'hold', 'sea'];
const REPRESENTATIVE = ['station', 'beach', 'fast', 'pack', 'ship', 'cape'];
const argv = process.argv.slice(2);
// default = a few representative zones (the full set is 192 PNGs and takes ~10 min): pass --all or zone names
const zones = argv.includes('--all') ? ALL : argv.filter(a => !a.startsWith('--')).length ? argv.filter(a => !a.startsWith('--')) : REPRESENTATIVE;
const CONDS = [
  { id: 'd1noon', day: 1, hour: 12, storm: 0, extra: '' },
  { id: 'd6night', day: 6, hour: 0, storm: 0, extra: 'v.setMoon && v.setMoon(0.5); v.setAurora && v.setAurora(1);' },
  { id: 'd11noon', day: 11, hour: 12, storm: 0, extra: '' },
  { id: 'storm', day: 6, hour: 12, storm: 1, extra: '' },
];
const DEVICES = [
  { id: 'desktop', opts: { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 } },
  { id: 'phone', opts: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } },
];
// --deep: the deep-snow views (DESIGN §13) and the zoom range (DESIGN §14): the buried station door, the lee field, the cape lee, the iceberg cornices;
// day 1 noon and night, at the default zoom and at both ends of the zoom range.  Output: shots/world-<device>-deep-<place>-<cond>[-z<i>].png
const DEEP = [
  { id: 'door', x: 702, y: 252 }, { id: 'roofs', x: 650, y: 250 }, { id: 'field', x: 524, y: 236 }, { id: 'capelee', x: 190, y: 168 }, { id: 'berg', x: 1380, y: 250 }, { id: 'fastice', x: 1200, y: 282 },
];
const DEEP_CONDS = [CONDS[0], CONDS[1]];
const up = async () => { try { return (await fetch(BASE)).ok; } catch { return false; } };
let server = null;
if (!(await up())) {
  server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 60 && !(await up()); i++) await new Promise(r => setTimeout(r, 500));
}
fs.mkdirSync('shots', { recursive: true });
const deep = argv.includes('--deep');
// clear our own previous output for the zones about to be shot, so stale frames never get mixed in
if (!deep) for (const f of fs.readdirSync('shots')) if (/^world-(desktop|phone)-/.test(f) && !f.includes('-deep-') && zones.some(z => f.includes('-' + z + '-'))) fs.unlinkSync('shots/' + f);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errs = []; let n = 0;
for (const dev of DEVICES) {
  const ctx = await browser.newContext(dev.opts);
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  await page.goto(BASE);
  await page.waitForFunction(() => window.__view && window.__view.ready, null, { timeout: 90000 });
  if (deep) {
    for (const f of fs.readdirSync('shots')) if (new RegExp('^world-' + dev.id + '-deep-').test(f)) fs.unlinkSync('shots/' + f);
    const zoom = await page.evaluate(() => import('/src/engine/zoom.ts').then(m => ({ n: m.zoomCount() })));
    for (const place of DEEP) for (const c of DEEP_CONDS) for (const zi of [-1, 0, zoom.n - 1]) {
      await page.evaluate(async ([place, c, zi]) => {
        const v = window.__view, z = await import('/src/engine/zoom.ts');
        v.hud(false); v.clearIgloos && v.clearIgloos(); v.lamp(false);
        v.setDay(c.day); v.setHour(c.hour); v.setStorm(0);
        if (v.setAurora) v.setAurora(0); if (v.setMoon) v.setMoon(0.3);
        if (zi < 0) z.resetZoom(); else z.setZoomIndex(zi);
        v.teleport(place.x, place.y);
        if (c.extra) new Function('v', c.extra)(v);
      }, [place, c, zi]);
      await page.waitForTimeout(120);
      await page.evaluate(() => window.__view.step(6));
      await page.waitForTimeout(250);
      await page.screenshot({ path: `shots/world-${dev.id}-deep-${place.id}-${c.id}${zi < 0 ? '' : '-z' + zi}.png`, timeout: 120000 });
      n++;
    }
    await page.evaluate(() => import('/src/engine/zoom.ts').then(m => m.resetZoom()));
    await ctx.close();
    continue;
  }
  for (const z of zones) for (const c of CONDS) {
    await page.evaluate(([z, c]) => {
      const v = window.__view;
      v.hud(false); v.clearIgloos && v.clearIgloos(); v.lamp(false);
      v.setDay(c.day); v.setHour(c.hour); v.setStorm(c.storm ? 1 : 0);
      if (v.setAurora) v.setAurora(0); if (v.setMoon) v.setMoon(0.3);
      v.goZone(z);
      if (c.extra) new Function('v', c.extra)(v);
    }, [z, c]);
    await page.waitForTimeout(120);
    await page.evaluate(() => window.__view.step(6));
    await page.waitForTimeout(250);
    await page.screenshot({ path: `shots/world-${dev.id}-${z}-${c.id}.png` });
    n++;
  }
  await ctx.close();
}
await browser.close();
if (server) server.kill();
console.log(`saved ${n} screenshots to shots/world-*.png; errors:`, errs.length ? errs.slice(0, 5) : 'none');
