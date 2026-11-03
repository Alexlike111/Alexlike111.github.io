// Player-view release gate. Run on a production build: `npm run build && node e2e/player-checks.mjs`.
// Every check is something a player noticed (or would notice) in the hands. Any failure -> exit code 1 -> no release.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'e2e', 'out', 'player');
mkdirSync(OUT, { recursive: true });
const PORT = 4400 + Math.floor(Math.random() * 400);
const version = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
await sleep(2500);
const browser = await chromium.launch();

async function openRace(ctxOpts, label) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://localhost:${PORT}/?debug`);
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 30000 });
  const ver = await page.$eval('#ver', (e) => e.textContent).catch(() => '');
  check(`[${label}] build label shows v${version}`, ver.includes(`v${version}`), ver);
  await page.screenshot({ path: path.join(OUT, `${label}-menu.png`) });
  await page.evaluate(() => { window.__game.save.settings.tutorialDone = true; window.__game.startRace('t1'); });
  await page.waitForFunction(() => window.__game.sim && window.__game.sim.race.phase === 'racing', null, { timeout: 30000 });
  return { ctx, page, errors };
}

// Headless Chromium renders in software and the sim caps sub-steps per frame, so game time runs slower than
// wall time. All waits are in GAME seconds.
async function waitSim(page, sec) {
  const t0 = await page.evaluate(() => window.__game.sim.race.time);
  await page.waitForFunction((t) => window.__game.sim.race.time >= t, t0 + sec, { timeout: 60000, polling: 50 });
}
// Put the player on the calmest straight away from the pack, rolling at v m/s along the track.
async function onStraight(page, v) {
  await page.evaluate((v) => {
    const sim = window.__game.sim, tr = sim.track; let bestS = 0, bestK = 1e9;
    for (let s = 0; s < tr.length; s += 5) {
      let k = 0; for (let d = 0; d < 60; d += 5) k += Math.abs(tr.sampleAt(s + d).curvature);
      let crowd = 0; for (const c of sim.cars) { const n = tr.nearest(c.x, c.y); const ds = Math.abs(((n.s - s) % tr.length + tr.length) % tr.length); if (ds < 70 || ds > tr.length - 30) crowd++; }
      const score = k + crowd * 10; if (score < bestK) { bestK = score; bestS = s; }
    }
    const p = tr.sampleAt(bestS), a = Math.atan2(p.ty, p.tx);
    const c = sim.simCars[0]; c.reset(p.x, p.y, a); c.body.setLinearVelocity({ x: p.tx * v, y: p.ty * v });
  }, v);
}

const angle = (page) => page.evaluate(() => window.__game.sim.cars[0].angle);
const unwrap = (d) => Math.atan2(Math.sin(d), Math.cos(d));

// Teleport the player car (physics coords) and give it speed along its nose.
async function place(page, x, y, a, v) {
  await page.evaluate(([x, y, a, v]) => {
    const sim = window.__game.sim; const c = sim.simCars[0];
    c.reset(x, y, a);
    c.body.setLinearVelocity({ x: Math.cos(a) * v, y: Math.sin(a) * v });
  }, [x, y, a, v]);
}

try {
  // ---------------- desktop / keyboard ----------------
  {
    const { ctx, page, errors } = await openRace({ viewport: { width: 1280, height: 720 } }, 'desktop');
    await page.keyboard.down('ArrowUp');
    await onStraight(page, 15); await waitSim(page, 0.3);
    const a0 = await angle(page);
    await page.keyboard.down('ArrowRight'); await waitSim(page, 0.6);
    const a1 = await angle(page);
    await page.keyboard.up('ArrowRight');
    // physics CCW is positive; the scene is mirrored back so physics clockwise == clockwise on screen == a right turn
    check('[desktop] Right arrow turns the car right (clockwise on screen)', unwrap(a1 - a0) < -0.15, `dAngle=${unwrap(a1 - a0).toFixed(2)}`);
    await onStraight(page, 15); await waitSim(page, 0.3);
    const a1b = await angle(page);
    await page.keyboard.down('ArrowLeft'); await waitSim(page, 0.6);
    const a2 = await angle(page);
    await page.keyboard.up('ArrowLeft');
    check('[desktop] Left arrow turns the car left', unwrap(a2 - a1b) > 0.15, `dAngle=${unwrap(a2 - a1b).toFixed(2)}`);
    const mirror = await page.evaluate(() => (window.__render && window.__render.sceneMirrorZ) ?? null);
    if (mirror !== null) check('[desktop] scene mirrored back along z (screen handedness)', mirror === -1, String(mirror));

    // ---- props are thrown clear, never ride on the bonnet
    const prop = await page.evaluate(() => {
      const sim = window.__game.sim; const c = sim.cars[0];
      let best = null, bd = 1e9;
      for (const d of sim.destructibles) {
        if (d.kind !== 'prop' || !d.dynamic || d.broken) continue;
        const dist = Math.hypot(d.x - c.x, d.y - c.y);
        if (dist < bd) { bd = dist; best = d; }
      }
      return best && { id: best.id, x: best.x, y: best.y, type: best.propType };
    });
    if (!prop) check('[desktop] found a dynamic prop to test', false);
    else {
      const a = 0.3;
      await place(page, prop.x - Math.cos(a) * 14, prop.y - Math.sin(a) * 14, a, 18);
      await waitSim(page, 1.6);
      const r = await page.evaluate((id) => { const s = window.__game.sim; const d = s.destructibles[id]; const c = s.cars[0]; return { broken: d.broken, dist: Math.hypot(d.x - c.x, d.y - c.y) }; }, prop.id);
      await page.screenshot({ path: path.join(OUT, 'desktop-prop.png') });
      check(`[desktop] ${prop.type} is thrown clear, not stuck on the bonnet`, r.broken || r.dist > 4, `broken=${r.broken} dist=${r.dist.toFixed(1)}m`);
    }

    // ---- hard wall crash: visible damage and parts fly off
    const wall = await page.evaluate(() => {
      const sim = window.__game.sim; const c = sim.cars[0];
      let best = null, bd = 1e9;
      for (const d of sim.destructibles) {
        if ((d.kind !== 'wall' && d.kind !== 'guardrail') || d.broken) continue;
        const dist = Math.hypot(d.x - c.x, d.y - c.y);
        if (dist < bd && dist > 20) { bd = dist; best = d; }
      }
      if (!best) return null;
      const n = sim.track.nearest(best.x, best.y);
      const s = sim.track.sampleAt(n.s);
      let nx = s.x - best.x, ny = s.y - best.y; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
      return { x: best.x, y: best.y, nx, ny };
    });
    if (!wall) check('[desktop] found a wall to crash into', false);
    else {
      await page.evaluate(() => window.__game.repair && window.__game.repair());
      const before = await page.evaluate(() => ({ h: window.__game.sim.cars[0].health, p: window.__game.sim.cars[0].detachedParts.length }));
      await page.evaluate(() => { window.__game.sim.drainEvents && 0; window.__pc = []; });
      await place(page, wall.x + wall.nx * 12, wall.y + wall.ny * 12, Math.atan2(-wall.ny, -wall.nx), 25);
      await waitSim(page, 0.5);
      await page.screenshot({ path: path.join(OUT, 'desktop-crash-impact.png') });
      await waitSim(page, 1.0);
      await page.screenshot({ path: path.join(OUT, 'desktop-crash-after.png') });
      const after = await page.evaluate(() => ({ h: window.__game.sim.cars[0].health, p: window.__game.sim.cars[0].detachedParts.length }));
      check('[desktop] 90 km/h wall crash damages the car', after.h < before.h - 0.05, `health ${before.h.toFixed(2)} -> ${after.h.toFixed(2)}`);
      check('[desktop] 90 km/h wall crash knocks a part off', after.p > before.p, `parts ${before.p} -> ${after.p}`);
    }
    await page.keyboard.up('ArrowUp');
    check('[desktop] no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ---------------- phone / one finger ----------------
  {
    const { ctx, page, errors } = await openRace({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, 'phone');
    const box = await page.$eval('.gas-btn', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }).catch(() => null);
    if (!box) check('[phone] GAS button visible', false);
    else {
      const cdp = await ctx.newCDPSession(page);
      const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
      await touch('touchStart', box.x, box.y); await waitSim(page, 1.2);
      const sp = await page.evaluate(() => window.__game.sim.cars[0].speed);
      check('[phone] holding GAS drives forward', sp > 5, `speed=${sp.toFixed(1)} m/s`);
      // one finger: slide the GAS finger to the left of the button centre -> steer left
      await onStraight(page, 15); await waitSim(page, 0.2);
      const a0 = await angle(page);
      for (let i = 1; i <= 6; i++) { await touch('touchMove', box.x - i * 15, box.y); await sleep(30); }
      await waitSim(page, 0.6);
      const a1 = await angle(page);
      check('[phone] sliding the GAS finger left turns left', unwrap(a1 - a0) > 0.15, `dAngle=${unwrap(a1 - a0).toFixed(2)}`);
      await touch('touchMove', box.x, box.y);
      await onStraight(page, 15); await waitSim(page, 0.2);
      const a1b = await angle(page);
      for (let i = 1; i <= 6; i++) { await touch('touchMove', box.x + i * 15, box.y); await sleep(30); }
      await waitSim(page, 0.6);
      const a2 = await angle(page);
      check('[phone] sliding the GAS finger right turns right', unwrap(a2 - a1b) < -0.15, `dAngle=${unwrap(a2 - a1b).toFixed(2)}`);
      await page.screenshot({ path: path.join(OUT, 'phone-steer.png') });
      await touch('touchEnd', 0, 0);
    }
    check('[phone] no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
} catch (e) {
  check('player checks ran to completion', false, String(e && e.stack || e));
} finally {
  await browser.close();
  srv.kill();
}

const failed = results.filter((r) => !r.ok);
writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ version, passed: results.length - failed.length, failed: failed.length, results }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} player checks passed. Screens: ${OUT}`);
process.exit(failed.length ? 1 : 0);
