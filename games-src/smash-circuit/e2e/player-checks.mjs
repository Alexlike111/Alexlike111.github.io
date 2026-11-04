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
  await page.evaluate(() => { window.__game.save.settings.tutorialDone = true; window.__game.save.settings.controlsPicked = true; window.__game.startRace('t1'); });
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

  // ---------------- phone: every control scheme ----------------
  // Multi-touch through CDP: every call sends the full list of fingers that are down.
  const touchKit = async (ctx, page) => {
    const cdp = await ctx.newCDPSession(page);
    const pts = new Map();
    const send = (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...pts].map(([id, p]) => ({ x: p.x, y: p.y, id })) });
    return {
      async down(id, x, y) { pts.set(id, { x, y }); await send('touchStart'); },
      async downBoth(a, b) { pts.set(a[0], { x: a[1], y: a[2] }); pts.set(b[0], { x: b[1], y: b[2] }); await send('touchStart'); },
      async move(id, x, y) { pts.set(id, { x, y }); await send('touchMove'); },
      async up(id) { pts.delete(id); await send('touchEnd'); },
      async upAll() { if (!pts.size) return; pts.clear(); await send('touchEnd'); },
    };
  };
  const center = (page, sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; }).catch(() => null);
  const setControls = (page, controls, extra = {}) => page.evaluate(([c, x]) => { const g = window.__game; g.setSettings({ ...g.save.settings, controls: c, controlsPicked: true, ...x }); }, [controls, extra]);
  // measure the heading change over 0.3 s of game time from a clean straight at 15 m/s
  const turnOf = async (page, act) => {
    await onStraight(page, 15); await waitSim(page, 0.2);
    const a0 = await angle(page);
    await act();
    await waitSim(page, 0.3);
    return unwrap((await angle(page)) - a0);
  };
  const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
  const speedOf = (page) => page.evaluate(() => window.__game.sim.cars[0].speed);
  const brakeOf = (page) => page.evaluate(() => window.__game.sim.cars[0].brake);

  // ---- Buttons (the default) in portrait, with the layout rules
  {
    const { ctx, page, errors } = await openRace(PHONE, 'phone');
    const def = await page.evaluate(() => window.__game.save.settings.controls);
    check('[phone] default control scheme is Buttons', def === 'buttons', def);
    const T = await touchKit(ctx, page);
    await waitSim(page, 1.2);
    const sp = await speedOf(page);
    check('[phone] auto gas drives forward without touching anything', sp > 5, `speed=${sp.toFixed(1)} m/s`);
    const L = await center(page, '.steer-btn.left'), R = await center(page, '.steer-btn.right');
    const BR = await center(page, '.brake-btn'), DR = await center(page, '.drift-btn');
    if (!L || !R || !BR || !DR) check('[phone] steer / BRAKE / DRIFT buttons visible', false);
    else {
      check('[phone] steer buttons are >= 22% of the screen width, side by side bottom-left', L.w / 390 >= 0.22 && R.w / 390 >= 0.22 && R.x > L.x && R.x < 390 * 0.5 && L.y > 844 * 0.8, `w=${L.w.toFixed(0)}/${R.w.toFixed(0)} at (${L.x.toFixed(0)},${L.y.toFixed(0)})`);
      check('[phone] BRAKE and DRIFT are under the right thumb', BR.x > 390 * 0.45 && DR.x > 390 * 0.6 && BR.y > 844 * 0.8 && DR.y > 844 * 0.8, `brake ${BR.x.toFixed(0)},${BR.y.toFixed(0)} drift ${DR.x.toFixed(0)},${DR.y.toFixed(0)}`);
      const dl = await turnOf(page, () => T.down(1, L.x, L.y));
      check('[phone] holding the left arrow turns left', dl > 0.15, `dAngle=${dl.toFixed(2)}`);
      await page.screenshot({ path: path.join(OUT, 'phone-buttons-left.png') });
      await T.upAll();
      const dr = await turnOf(page, () => T.down(1, R.x, R.y));
      check('[phone] holding the right arrow turns right', dr < -0.15, `dAngle=${dr.toFixed(2)}`);
      await T.upAll();
      const db = await turnOf(page, () => T.downBoth([1, L.x, L.y], [2, R.x, R.y]));
      check('[phone] pressing both arrows = no steering', Math.abs(db) < 0.3, `dAngle=${db.toFixed(2)}`);
      await T.upAll();
      // multi-touch: left thumb steers while the right thumb brakes
      await onStraight(page, 18); await waitSim(page, 0.2);
      const a0 = await angle(page);
      await T.down(1, L.x, L.y); await T.down(2, BR.x, BR.y);
      await waitSim(page, 0.3);
      const br = await brakeOf(page), da = unwrap((await angle(page)) - a0);
      check('[phone] multi-touch: steer with the left thumb while holding BRAKE with the right', br > 0.5 && da > 0.1, `brake=${br} dAngle=${da.toFixed(2)}`);
      await T.move(2, DR.x, DR.y).catch(() => {});
      await T.upAll();
      // steering ramps up fast (full lock in ~0.1 s): the car's steer value after 0.15 s
      await onStraight(page, 15); await waitSim(page, 0.1);
      await T.down(1, R.x, R.y);
      await waitSim(page, 0.15);
      const st = await page.evaluate(() => window.__game.sim.cars[0].steer);
      check('[phone] steer buttons ramp quickly (|steer| > 0.5 after 0.15 s)', Math.abs(st) > 0.5, `steer=${st.toFixed(2)}`);
      await T.upAll();
      // item button geometry: above DRIFT, not overlapping any other button
      await page.evaluate(() => { const g = window.__game; const c = g.sim.cars[0]; c.item = 'nitro'; });
      await sleep(400);
      const geo = await page.evaluate(() => {
        const q = (s) => { const e = document.querySelector(s); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return r.width ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null; };
        return { item: q('.item-slot'), drift: q('.drift-btn'), brake: q('.brake-btn'), l: q('.steer-btn.left'), r: q('.steer-btn.right'), W: innerWidth, H: innerHeight };
      });
      const hit = (a, b) => a && b && !(a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t);
      if (geo.item) check('[phone] item button sits near the right thumb, clear of the other buttons', geo.item.l > geo.W * 0.55 && !hit(geo.item, geo.drift) && !hit(geo.item, geo.brake) && !hit(geo.item, geo.r), JSON.stringify(geo.item));
      else check('[phone] item button shown while holding an item', false);
    }
    await page.screenshot({ path: path.join(OUT, 'phone-buttons.png') });
    // ---- heading-up camera on a straight: the car points up the screen within 20 degrees (auto gas, no finger needed)
    await onStraight(page, 20);
    await waitSim(page, 2.5);
    const head = await page.evaluate(() => { const c = window.__game.sim.cars[0], r = window.__render.camera; const a = r.project(c.x, c.y), b = r.project(c.x + Math.cos(c.angle) * 4, c.y + Math.sin(c.angle) * 4); const W = innerWidth, H = innerHeight; return { az: r.azimuth, ang: Math.atan2((b.x - a.x) * W, (b.y - a.y) * H) }; });
    check('[phone] on a straight the car points up the screen (within 20 deg)', Math.abs(head.ang) * 180 / Math.PI < 20, `${(head.ang * 180 / Math.PI).toFixed(1)} deg`);
    // ---- camera framing on a real lap
    await page.evaluate(() => { const sim = window.__game.sim; const p = sim.track.sampleAt(0); const c = sim.simCars[0]; c.reset(p.x, p.y, Math.atan2(p.ty, p.tx)); });
    const lapP = await cameraLap(page, 'phone', 32);
    check('[phone] camera rotates with the track (portrait, touch default)', lapP.azMax - lapP.azMin > 1, `azimuth ${lapP.azMin.toFixed(2)}..${lapP.azMax.toFixed(2)}`);
    check('[phone] no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ---- Buttons on the other phone sizes (screenshots + hit test of the real elements)
  for (const [w, h, name] of [[360, 640, 'small'], [844, 390, 'landscape']]) {
    const { ctx, page, errors } = await openRace({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, `phone-${name}`);
    const T = await touchKit(ctx, page);
    const L = await center(page, '.steer-btn.left'), R = await center(page, '.steer-btn.right');
    if (!L || !R) check(`[phone-${name}] steer buttons visible`, false);
    else {
      const hitOk = await page.evaluate(([a, b]) => document.elementFromPoint(a.x, a.y)?.closest('.steer-btn.left') && document.elementFromPoint(b.x, b.y)?.closest('.steer-btn.right'), [L, R]);
      check(`[phone-${name}] steer buttons are hittable`, !!hitOk);
      const dl = await turnOf(page, () => T.down(1, L.x, L.y));
      check(`[phone-${name}] left arrow turns left`, dl > 0.15, `dAngle=${dl.toFixed(2)}`);
      await page.screenshot({ path: path.join(OUT, `phone-${name}-buttons.png`) });
      await T.upAll();
      const dr = await turnOf(page, () => T.down(1, R.x, R.y));
      check(`[phone-${name}] right arrow turns right`, dr < -0.15, `dAngle=${dr.toFixed(2)}`);
      await T.upAll();
    }
    check(`[phone-${name}] no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ---- the other schemes: left turns left, right turns right
  for (const scheme of ['finger', 'slide', 'joystick', 'tilt', 'tap']) {
    const { ctx, page, errors } = await openRace(PHONE, `phone-${scheme}`);
    const T = await touchKit(ctx, page);
    // headless Chromium reports requestPermission() as denied (no real prompt): stand in for an iOS player who tapped Allow
    if (scheme === 'tilt') await page.evaluate(() => { try { Object.defineProperty(DeviceOrientationEvent, 'requestPermission', { value: async () => 'granted', configurable: true }); } catch { /* ignore */ } });
    await setControls(page, scheme, scheme === 'finger' ? { autoGas: false } : {});
    await sleep(300);
    let dl, dr;
    if (scheme === 'finger') {
      const g = await center(page, '.gas-btn');
      await T.down(1, g.x, g.y); await waitSim(page, 1.2);
      check('[phone-finger] holding GAS drives forward', (await speedOf(page)) > 5);
      dl = await turnOf(page, async () => { for (let i = 1; i <= 6; i++) { await T.move(1, g.x - i * 15, g.y); await sleep(30); } });
      await T.move(1, g.x, g.y);
      dr = await turnOf(page, async () => { for (let i = 1; i <= 6; i++) { await T.move(1, g.x + i * 15, g.y); await sleep(30); } });
      await T.move(1, g.x, g.y);
      await onStraight(page, 20); await T.move(1, g.x, g.y + 0.5 * g.w); await waitSim(page, 0.6);
      check('[phone-finger] pulling the GAS finger down brakes', (await brakeOf(page)) > 0.5);
    } else if (scheme === 'slide' || scheme === 'joystick') {
      const x0 = 150, y0 = 600;
      dl = await turnOf(page, async () => { await T.down(1, x0, y0); for (let i = 1; i <= 4; i++) { await T.move(1, x0 - i * 14, y0); await sleep(30); } });
      await page.screenshot({ path: path.join(OUT, `phone-${scheme}-steer.png`) });
      await T.upAll();
      dr = await turnOf(page, async () => { await T.down(1, x0, y0); for (let i = 1; i <= 4; i++) { await T.move(1, x0 + i * 14, y0); await sleep(30); } });
      await T.upAll();
      if (scheme === 'joystick') {
        await onStraight(page, 20);
        await T.down(1, x0, y0); await T.move(1, x0, y0 + 40); await T.move(1, x0, y0 + 80); await waitSim(page, 0.6);
        check('[phone-joystick] pulling the stick down brakes', (await brakeOf(page)) > 0.5);
        await T.upAll();
      }
    } else if (scheme === 'tilt') {
      const tilt = (gamma) => page.evaluate((gm) => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 50, gamma: gm, absolute: false })), gamma);
      await tilt(0); await waitSim(page, 0.1);
      await page.evaluate(() => window.__game.input.recenter());
      dl = await turnOf(page, () => tilt(-35).then(() => sleep(80)));
      await tilt(0); await sleep(150);
      dr = await turnOf(page, () => tilt(35).then(() => sleep(80)));
      await tilt(0);
      await page.screenshot({ path: path.join(OUT, 'phone-tilt.png') });
      const fb = await page.evaluate(() => window.__game.save.settings.controls);
      check('[phone-tilt] stays on Tilt while orientation events arrive', fb === 'tilt', fb);
    } else {
      dl = await turnOf(page, () => T.down(1, 90, 600));
      await page.screenshot({ path: path.join(OUT, 'phone-tap-left.png') });
      await T.upAll();
      dr = await turnOf(page, () => T.down(1, 300, 600));
      await T.upAll();
      await onStraight(page, 20);
      await T.downBoth([1, 90, 600], [2, 300, 600]); await waitSim(page, 0.5);
      check('[phone-tap] touching both halves brakes', (await brakeOf(page)) > 0.5);
      await T.upAll();
    }
    check(`[phone-${scheme}] left turns left`, dl > 0.15, `dAngle=${dl.toFixed(2)}`);
    check(`[phone-${scheme}] right turns right`, dr < -0.15, `dAngle=${dr.toFixed(2)}`);
    await T.upAll();
    check(`[phone-${scheme}] no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ---- Tilt without orientation events falls back to Buttons with a toast
  {
    const { ctx, page } = await openRace(PHONE, 'phone-tiltfail');
    await setControls(page, 'tilt');
    await page.waitForFunction(() => window.__game.save.settings.controls === 'buttons', null, { timeout: 5000 }).catch(() => {});
    const c = await page.evaluate(() => window.__game.save.settings.controls);
    check('[phone-tilt] no orientation events -> falls back to Buttons', c === 'buttons', c);
    await ctx.close();
  }

  // ---- first launch on a touch device: the skippable controls picker before the first race
  {
    const ctx = await browser.newContext(PHONE);
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PORT}/?debug`);
    await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 30000 });
    await page.evaluate(() => { window.__game.save.settings.tutorialDone = true; window.__game.startRace('t1'); });
    await sleep(500);
    const shown = await page.$('.ctlpick');
    check('[phone] first race shows the one-time controls picker', !!shown);
    if (shown) {
      const on = await page.$eval('.ctl-card.on', (e) => e.dataset.v);
      check('[phone] picker highlights Buttons by default', on === 'buttons', on);
      await page.screenshot({ path: path.join(OUT, 'phone-picker.png') });
      await page.click('[data-act=ctlPickSel][data-v=slide]');
      await page.click('[data-act=ctlPickOk]');
      await page.waitForFunction(() => window.__game.sim && window.__game.sim.race.phase === 'racing', null, { timeout: 30000 });
      const st = await page.evaluate(() => ({ c: window.__game.save.settings.controls, p: window.__game.save.settings.controlsPicked }));
      check('[phone] picking Slide in the picker starts the race with it, never shown again', st.c === 'slide' && st.p === true, JSON.stringify(st));
      // pause menu has the quick switch
      await page.evaluate(() => window.__game.pause());
      await sleep(400);
      await page.screenshot({ path: path.join(OUT, 'phone-pause.png') });
      await page.click('.ctl-ic[data-v=tap]');
      const c2 = await page.evaluate(() => window.__game.save.settings.controls);
      check('[phone] pause menu switches the control scheme', c2 === 'tap', c2);
    }
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
