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


// ---- camera framing: an autopilot lap, sampled every rendered frame ----
// The autopilot replaces the player's input (pure pursuit along the spline, corner-limited speed) so the lap is real physics.
// Per frame we project the player car and the track point 1.5 s ahead with the camera that was just rendered (window.__render.camera).
async function startAutopilot(page, cruise) {
  await page.evaluate((cruise) => {
    const sim = window.__game.sim, tr = sim.track, orig = sim.setPlayerInput.bind(sim);
    const S = (window.__ap = { samples: [], done: false, prog: 0, last: null, t0: sim.race.time, hint: undefined, shots: 0, azMin: 9, azMax: -9, corner: false });
    sim.setPlayerInput = (inp) => {
      const c = sim.cars[0];
      const n = tr.nearest(c.x, c.y, S.hint); S.hint = n.s;
      const L = 7 + 0.55 * c.speed, tp = tr.sampleAt(n.s + L);
      let e = Math.atan2(tp.y - c.y, tp.x - c.x) - c.angle; e = Math.atan2(Math.sin(e), Math.cos(e));
      let kmax = 0; for (let d = 0; d <= 45; d += 5) kmax = Math.max(kmax, Math.abs(tr.sampleAt(n.s + d).curvature));
      const vT = Math.min(cruise, Math.sqrt(16 / Math.max(kmax, 1e-4)));
      const err = c.speed - vT;
      orig({ ...inp, throttle: err < 0 ? 1 : 0, brake: err > 3 ? Math.min(1, err / 10) : 0, steer: Math.max(-1, Math.min(1, -2.2 * e)), handbrake: false, drift: 0 });
      S.corner = kmax > 0.012;
    };
    const L = tr.length;
    const tick = () => {
      const c = sim.cars[0], r = window.__render && window.__render.camera;
      if (!S.done && r && sim.race.phase === 'racing') {
        const n = tr.nearest(c.x, c.y, S.last === null ? undefined : S.last);
        if (S.last !== null) { let d = n.s - S.last; if (d < -L / 2) d += L; if (d > L / 2) d -= L; S.prog += d; }
        S.last = n.s;
        const car = r.project(c.x, c.y), ah = tr.sampleAt(n.s + 1.5 * c.speed), a = r.project(ah.x, ah.y);
        const nose = r.project(c.x + Math.cos(c.angle) * 4, c.y + Math.sin(c.angle) * 4);
        S.azMin = Math.min(S.azMin, r.azimuth); S.azMax = Math.max(S.azMax, r.azimuth);
        if (sim.race.time - S.t0 > 3.5 && c.speed > 12) S.samples.push([car.x, car.y, a.x, a.y, c.speed, Math.atan2(nose.x - car.x, nose.y - car.y)]);
        if (S.prog >= L * 0.97) S.done = true;
      }
      if (!S.done) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, cruise);
}

async function cameraLap(page, label, cruise) {
  await page.evaluate(() => { window.__game.repair && window.__game.repair(); });
  await startAutopilot(page, cruise);
  let shot = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 240000) {
    const st = await page.evaluate(() => ({ done: window.__ap.done, corner: window.__ap.corner, n: window.__ap.samples.length, speed: window.__game.sim.cars[0].speed }));
    if (st.done) break;
    if (!shot && st.corner && st.n > 150 && st.speed > 18) { shot = true; await page.screenshot({ path: path.join(OUT, `${label}-corner.png`) }); }
    await sleep(120);
  }
  const r = await page.evaluate(() => { const S = window.__ap; return { done: S.done, prog: S.prog, samples: S.samples, azMin: S.azMin, azMax: S.azMax }; });
  const n = r.samples.length;
  const maxCar = Math.max(0, ...r.samples.map((v) => Math.max(Math.abs(v[0]), Math.abs(v[1]))));
  const offAhead = r.samples.filter((v) => Math.abs(v[2]) > 0.98 || Math.abs(v[3]) > 0.98).length;
  const meanSpeed = n ? r.samples.reduce((a, v) => a + v[4], 0) / n : 0;
  check(`[${label}] autopilot completed a lap with camera samples`, r.done && n > 100, `n=${n} progress=${r.prog.toFixed(0)}m mean ${meanSpeed.toFixed(1)} m/s`);
  check(`[${label}] car stays inside the central 60% of the screen all lap`, maxCar <= 0.6, `max |ndc|=${maxCar.toFixed(2)}`);
  check(`[${label}] track point 1.5 s ahead is on screen (>= 97% of frames)`, offAhead <= n * 0.03, `off-screen ${offAhead}/${n}`);
  return r;
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
    // ---- camera framing on a real lap (fixed north-up is the desktop default)
    await page.evaluate(() => { const sim = window.__game.sim; const p = sim.track.sampleAt(0); const c = sim.simCars[0]; c.reset(p.x, p.y, Math.atan2(p.ty, p.tx)); });
    const lapD = await cameraLap(page, 'desktop', 32);
    check('[desktop] camera is fixed north-up by default', lapD.azMin === 0 && lapD.azMax === 0, `azimuth ${lapD.azMin.toFixed(2)}..${lapD.azMax.toFixed(2)}`);
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
      // ---- heading-up camera on a straight: the car points up the screen within 20 degrees
      await onStraight(page, 20);
      await touch('touchStart', box.x, box.y);
      await waitSim(page, 2.5);
      await touch('touchEnd', 0, 0);
      const head = await page.evaluate(() => { const c = window.__game.sim.cars[0], r = window.__render.camera; const a = r.project(c.x, c.y), b = r.project(c.x + Math.cos(c.angle) * 4, c.y + Math.sin(c.angle) * 4); const W = innerWidth, H = innerHeight; return { az: r.azimuth, ang: Math.atan2((b.x - a.x) * W, (b.y - a.y) * H) }; });
      check('[phone] on a straight the car points up the screen (within 20 deg)', Math.abs(head.ang) * 180 / Math.PI < 20, `${(head.ang * 180 / Math.PI).toFixed(1)} deg`);
      // ---- camera framing on a real lap
      await page.evaluate(() => { const sim = window.__game.sim; const p = sim.track.sampleAt(0); const c = sim.simCars[0]; c.reset(p.x, p.y, Math.atan2(p.ty, p.tx)); });
      const lapP = await cameraLap(page, 'phone', 32);
      check('[phone] camera rotates with the track (portrait, touch default)', lapP.azMax - lapP.azMin > 1, `azimuth ${lapP.azMin.toFixed(2)}..${lapP.azMax.toFixed(2)}`);
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
