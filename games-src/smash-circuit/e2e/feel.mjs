// Driving-feel measurements on a production build: `npx vite build && node e2e/feel.mjs [trackId ...]`.
// Prints acceleration (0-100 / 0-120 km/h), top speed, steering response, drift entry / angle / boost (pure car model via
// window.__game.model), and an autopilot race: lap times, wall hits, max speeds, AI speeds, a 25-degree wall glance and the
// game-time / wall-time ratio. The sim is stepped by hand at the fixed dt while the game is paused, so the numbers do not
// depend on the (software-rendered, slow) headless frame rate. Writes e2e/out/feel.json.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = process.env.FEEL_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url))), 'out');
mkdirSync(OUT, { recursive: true });
const PORT = 4800 + Math.floor(Math.random() * 300);
const TRACKS = process.argv.slice(2).filter((a) => /^t\d$/.test(a));
if (!TRACKS.length) TRACKS.push('t1', 't2', 't3');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
await sleep(2500);
const browser = await chromium.launch();
const report = { model: null, tracks: {}, timing: null };

async function open(trackId) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${PORT}/?debug`);
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 30000 });
  await page.evaluate((id) => {
    const g = window.__game;
    g.save.settings.tutorialDone = true;
    if (!g.save.unlockedTracks.includes(id)) g.save.unlockedTracks.push(id);
    g.startRace(id);
  }, trackId);
  await page.waitForFunction(() => window.__game.sim, null, { timeout: 30000 });
  return { ctx, page, errors };
}

try {
  // ------------------------------------------------------------------ pure model (needs window.__game.model)
  {
    const { ctx, page } = await open('t1');
    report.model = await page.evaluate(() => {
      const M = window.__game.model;
      if (!M) return null;
      const dt = 1 / 120;
      const stats = M.baseStats(), fx = M.NO_DAMAGE, road = M.SURFACE_ROAD;
      const IDLE = { throttle: 0, brake: 0, steer: 0, handbrake: false, drift: 0 };
      const step = (k, i, tr) => {
        let kick = 0;
        if (tr) {
          const sp = Math.hypot(k.vx, k.vy), f = k.vx * Math.cos(k.angle) + k.vy * Math.sin(k.angle);
          const beta = sp > 1 ? M.wrapAngle(k.angle - Math.atan2(k.vy, k.vx)) : 0;
          kick = tr.pre(i, f, sp, beta, true, dt).kick;
          if (kick > 0) { k = { ...k, vx: k.vx + Math.cos(k.angle) * kick, vy: k.vy + Math.sin(k.angle) * kick }; }
        }
        const o = M.integrateCar(k, i, stats, fx, road, dt, tr ? tr.ctl : null);
        return { ...o, x: o.x + o.vx * dt, y: o.y + o.vy * dt, angle: o.angle + o.angularVel * dt, kick };
      };
      const r = {};
      // acceleration
      let k = { x: 0, y: 0, angle: 0, vx: 0, vy: 0, angularVel: 0, steer: 0 };
      for (let t = 0; t < 40; t += dt) {
        k = step(k, { ...IDLE, throttle: 1 });
        const v = M.forwardSpeed(k) * 3.6;
        for (const m of [100, 120, 160, 200]) if (v >= m && r['t0_' + m] === undefined) r['t0_' + m] = +t.toFixed(2);
      }
      r.topKmh = +(M.forwardSpeed(k) * 3.6).toFixed(1);
      // braking 100 -> 0
      k = { x: 0, y: 0, angle: 0, vx: 100 / 3.6, vy: 0, angularVel: 0, steer: 0 };
      while (M.forwardSpeed(k) > 0.05) k = step(k, { ...IDLE, brake: 1 });
      r.brake100m = +k.x.toFixed(1);
      // steering response: keyboard ramp (CONFIG.controls.keySteerRise / keySteerReturn) + model, at a held speed (cruise: full
      // lock scrubs speed, which would raise the turn rate and blur the response); time until the yaw rate reaches 90% of its
      // steady value, and after the key is released, until it is back under 10%
      const rise = 25, ret = 28;
      const cruise = (c, v0) => { const sc = v0 / Math.max(1e-6, Math.hypot(c.vx, c.vy)); return { ...c, vx: c.vx * sc, vy: c.vy * sc }; };
      for (const kmh of [60, 120, 180]) {
        const v0 = kmh / 3.6;
        let c = { x: 0, y: 0, angle: 0, vx: v0, vy: 0, angularVel: 0, steer: 0 }, s = 0; const ws = [];
        for (let i = 0; i < 360; i++) { s = Math.min(1, s + rise * dt); c = cruise(step(c, { ...IDLE, throttle: 0.6, steer: s }), v0); ws.push(Math.abs(c.angularVel)); }
        const wss = ws[ws.length - 1];
        r['steer90_' + kmh] = +((ws.findIndex((w) => w >= 0.9 * wss) + 1) * dt).toFixed(3);
        r['yaw_' + kmh] = +wss.toFixed(2);
        let n = 0;
        while (n < 240 && (n === 0 || Math.abs(c.angularVel) > 0.1 * wss)) { s = Math.max(0, s - ret * dt); c = cruise(step(c, { ...IDLE, throttle: 0.6, steer: s }), v0); n++; }
        r['release10_' + kmh] = +(n * dt).toFixed(3);
        // linearity: 30% stick gives this share of the full-stick turn rate
        let h = { x: 0, y: 0, angle: 0, vx: v0, vy: 0, angularVel: 0, steer: 0 };
        for (let i = 0; i < 240; i++) h = cruise(step(h, { ...IDLE, throttle: 0.6, steer: 0.3 }), v0);
        r['lin30_' + kmh] = +(Math.abs(h.angularVel) / wss).toFixed(2);
      }
      // full-lock turning radius / lateral acceleration at a held speed, and the speed full lock scrubs off in 1 s at full throttle
      r.lock = {};
      for (const kmh of [80, 120, 160, 200]) {
        const v0 = kmh / 3.6;
        let c = { x: 0, y: 0, angle: 0, vx: v0, vy: 0, angularVel: 0, steer: 0 };
        for (let i = 0; i < 240; i++) c = cruise(step(c, { ...IDLE, throttle: 1, steer: 1 }), v0);
        let u = { x: 0, y: 0, angle: 0, vx: v0, vy: 0, angularVel: 0, steer: 0 };
        for (let i = 0; i < 120; i++) u = step(u, { ...IDLE, throttle: 1, steer: 1 });
        let p70 = { x: 0, y: 0, angle: 0, vx: v0, vy: 0, angularVel: 0, steer: 0 };
        for (let i = 0; i < 240; i++) p70 = cruise(step(p70, { ...IDLE, throttle: 1, steer: 0.7 }), v0);
        r.lock[kmh] = { R: +(v0 / Math.abs(c.angularVel)).toFixed(1), lat: +(Math.abs(c.angularVel) * v0).toFixed(1),
          lat70: +(Math.abs(p70.angularVel) * v0).toFixed(1), kmh1s: +(Math.hypot(u.vx, u.vy) * 3.6).toFixed(0) };
      }
      // drift: 100 km/h, hold Space + full steer for 2 s, then release
      if (M.DriftTracker) {
        const tr = new M.DriftTracker();
        let d = { x: 0, y: 0, angle: 0, vx: 100 / 3.6, vy: 0, angularVel: 0, steer: 0 };
        let entry = -1, angSum = 0, angN = 0, maxAng = 0, maxW = 0;
        const v0 = Math.hypot(d.vx, d.vy);
        for (let i = 0; i < 240; i++) {
          d = step(d, { ...IDLE, throttle: 1, steer: 1, handbrake: true }, tr);
          const beta = Math.abs(M.wrapAngle(d.angle - Math.atan2(d.vy, d.vx)));
          if (entry < 0 && beta > 0.25) entry = (i + 1) * dt;
          if (i > 60) { angSum += beta; angN++; }
          maxAng = Math.max(maxAng, beta); maxW = Math.max(maxW, Math.abs(d.angularVel));
        }
        const vEnd = Math.hypot(d.vx, d.vy);
        const tier = tr.tier;
        let kick = 0;
        for (let i = 0; i < 12; i++) { d = step(d, { ...IDLE, throttle: 1, steer: 0 }, tr); kick = Math.max(kick, d.kick); }
        r.drift = {
          entry15deg: +entry.toFixed(3), heldDeg: +((angSum / angN) * 57.3).toFixed(1), maxDeg: +(maxAng * 57.3).toFixed(1),
          maxYaw: +maxW.toFixed(2), speedKeep: +(vEnd / v0).toFixed(2), tier, boostKick: kick, boostT: tr.boostT, points: tr.score,
        };
        // counter-steer straightens it out
        const t2 = new M.DriftTracker();
        let e = { x: 0, y: 0, angle: 0, vx: 100 / 3.6, vy: 0, angularVel: 0, steer: 0 };
        for (let i = 0; i < 120; i++) e = step(e, { ...IDLE, throttle: 1, steer: 1, drift: 1 }, t2);
        let out = -1;
        for (let i = 0; i < 240 && out < 0; i++) { e = step(e, { ...IDLE, throttle: 1, steer: -1, drift: 1 }, t2); if (!t2.active) out = (i + 1) * dt; }
        r.drift.touchAutoEntered = t2.clean > 0 || t2.active || out >= 0;
        r.drift.counterExit = +out.toFixed(3);
        // touch full lock (steer 1 + auto drift request, full throttle): heading turned in 0.6 s and the largest slip angle in 2 s
        r.touchLock = {};
        for (const kmh of [40, 70, 100, 150, 200]) {
          const t3 = new M.DriftTracker();
          let q = { x: 0, y: 0, angle: 0, vx: kmh / 3.6, vy: 0, angularVel: 0, steer: 0 };
          let head06 = 0, maxSlip = 0;
          for (let i = 0; i < 240; i++) {
            q = step(q, { ...IDLE, throttle: 1, steer: 1, drift: 1 }, t3);
            if (i === 71) head06 = Math.abs(q.angle);
            if (Math.hypot(q.vx, q.vy) > 2) maxSlip = Math.max(maxSlip, Math.abs(M.wrapAngle(q.angle - Math.atan2(q.vy, q.vx))));
          }
          r.touchLock[kmh] = { head06: +(head06 * 57.3).toFixed(0), maxSlip: +(maxSlip * 57.3).toFixed(0) };
        }
      }
      return r;
    });
    // game time vs wall time, live on a fresh race (headless renders in software: low fps shows the frame-time clamp)
    await page.waitForFunction(() => window.__game.sim.race.phase === 'racing', null, { timeout: 60000 });
    await page.keyboard.down('ArrowUp');
    report.timing = await page.evaluate(async () => {
      const sim = window.__game.sim;
      let frames = 0, run = true; const f = () => { frames++; if (run) requestAnimationFrame(f); }; requestAnimationFrame(f);
      const w0 = performance.now(), s0 = sim.race.time;
      await new Promise((res) => setTimeout(res, 3000));
      run = false;
      const wall = (performance.now() - w0) / 1000;
      return { fps: +(frames / wall).toFixed(1), ratio: +((sim.race.time - s0) / wall).toFixed(2), stepMs: +sim.avgStepMs.toFixed(2), kmh: +(sim.cars[0].speed * 3.6).toFixed(0) };
    });
    await page.keyboard.up('ArrowUp');
    await ctx.close();
  }

  // ------------------------------------------------------------------ autopilot race per track
  for (const id of TRACKS) {
    const { ctx, page, errors } = await open(id);
    await page.waitForFunction(() => window.__game.sim.race.phase === 'racing', null, { timeout: 60000 });
    await page.evaluate(() => window.__game.pause());
    const r = await page.evaluate(() => {
      const sim = window.__game.sim, tr = sim.track, P = sim.cars[0];
      const dt = 1 / 120, wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
      // a casual-but-tidy driver: pure pursuit on the centre line, plans corners at 72% of the car's grip (29 of 40 m/s^2;
      // was 18 of 25 before the steering retune)
      const drive = () => {
        const n = tr.nearest(P.x, P.y);
        const v = Math.max(0, P.speed);
        const look = 7 + 0.42 * v;
        const tp = tr.sampleAt(n.s + look);
        const alpha = wrap(Math.atan2(tp.y - P.y, tp.x - P.x) - P.angle);
        let vT = 120;
        for (let d = 0; d < 160; d += 3) {
          const kk = Math.abs(tr.sampleAt(n.s + d).curvature);
          if (kk < 0.003) continue;
          vT = Math.min(vT, Math.sqrt(Math.sqrt(29 / kk) ** 2 + 2 * 11 * Math.max(0, d - 4)));
        }
        const steer = Math.max(-1, Math.min(1, -alpha * 2.6));
        return { throttle: v < vT - 0.5 ? 1 : 0, brake: v > vT + 2 ? 1 : 0, steer, handbrake: false, drift: 0 };
      };
      let t = 0, wall = 0, car = 0, prop = 0, vmax = 0, aiMax = 0, lapsDone = 0, glance = null;
      const lapT = [];
      while (t < 150 && P.lap < 3 && !P.finished) {
        sim.setPlayerInput(drive());
        sim.update(dt); t += dt;
        for (const e of sim.drainEvents()) {
          if (e.type === 'impact' && e.carId === P.id) { if (e.other === 'wall' || e.other === 'guardrail') wall++; else if (e.other === 'car') car++; else prop++; }
          if (e.type === 'lap' && e.carId === P.id) lapT.push(+e.lapTime.toFixed(2));
        }
        vmax = Math.max(vmax, P.speed);
        for (const c of sim.cars) if (!c.isPlayer) aiMax = Math.max(aiMax, c.speed);
      }
      lapsDone = P.lap;
      const aiBest = sim.cars.filter((c) => !c.isPlayer && c.bestLapTime > 0).map((c) => c.bestLapTime);
      // 25-degree wall glance at 108 km/h on the calmest straight: speed kept 1 s after the hit
      {
        let bestS = 0, bestK = 1e9;
        for (let s = 0; s < tr.length; s += 5) { let k = 0; for (let d = -20; d < 40; d += 5) k += Math.abs(tr.sampleAt(s + d).curvature); if (k < bestK) { bestK = k; bestS = s; } }
        const smp = tr.sampleAt(bestS), a0 = Math.atan2(smp.ty, smp.tx) + 0.436;   // 25 deg toward the left wall
        const c = sim.simCars[0]; c.repair(); c.reset(smp.x, smp.y, a0);
        c.body.setLinearVelocity({ x: Math.cos(a0) * 30, y: Math.sin(a0) * 30 });
        let hit = -1, tt = 0;
        while (tt < 3) {
          sim.setPlayerInput({ throttle: 0, brake: 0, steer: 0, handbrake: false, drift: 0 });
          sim.update(dt); tt += dt;
          for (const e of sim.drainEvents()) if (e.type === 'impact' && e.carId === P.id && hit < 0) hit = tt;
          if (hit >= 0 && tt >= hit + 1) break;
        }
        glance = { hit: hit >= 0, keep: +(Math.hypot(P.vx, P.vy) / 30).toFixed(2) };
      }
      return {
        laps: lapT, lapsDone, simTime: +t.toFixed(1), wallHits: wall, carHits: car, propHits: prop,
        maxKmh: +(vmax * 3.6).toFixed(0), aiMaxKmh: +(aiMax * 3.6).toFixed(0),
        aiBestLap: aiBest.length ? +Math.min(...aiBest).toFixed(2) : null,
        aiMedianLap: aiBest.length ? +aiBest.sort((a, b) => a - b)[Math.floor(aiBest.length / 2)].toFixed(2) : null,
        glance, playerDriftScore: P.driftScore ?? null,
      };
    });
    r.errors = errors.length;
    report.tracks[id] = r;
    await ctx.close();
  }
} finally {
  await browser.close();
  srv.kill();
}

const m = report.model;
if (m) {
  console.log(`0-100 km/h ${m.t0_100} s | 0-120 ${m.t0_120} s | 0-160 ${m.t0_160 ?? '-'} s | 0-200 ${m.t0_200 ?? '-'} s | top ${m.topKmh} km/h | 100-0 in ${m.brake100m} m`);
  console.log(`steering (keyboard ramp) t90: 60 km/h ${m.steer90_60} s, 120 km/h ${m.steer90_120} s, 180 km/h ${m.steer90_180} s | release to 10%: ${m.release10_60}/${m.release10_120}/${m.release10_180} s | full-lock yaw ${m.yaw_60}/${m.yaw_120}/${m.yaw_180} rad/s | 30% stick = ${m.lin30_60}/${m.lin30_120}/${m.lin30_180} of full`);
  if (m.lock) console.log('full lock: ' + Object.entries(m.lock).map(([k, v]) => `${k} km/h R ${v.R} m, ${v.lat} m/s^2 (70% stick ${v.lat70}), ${v.kmh1s} km/h after 1 s flat out`).join(' | '));
  if (m.touchLock) console.log('touch full lock (auto drift): ' + Object.entries(m.touchLock).map(([k, v]) => `${k} km/h: ${v.head06} deg in 0.6 s, max slip ${v.maxSlip} deg`).join(' | '));
  if (m.drift) console.log(`drift @100 km/h (Space + full steer 2 s): 15 deg after ${m.drift.entry15deg} s, held ${m.drift.heldDeg} deg (max ${m.drift.maxDeg}), max yaw ${m.drift.maxYaw} rad/s, speed kept ${m.drift.speedKeep}, tier ${m.drift.tier}, boost +${m.drift.boostKick} m/s for ${m.drift.boostT} s, ${m.drift.points} pts | touch auto drift ${m.drift.touchAutoEntered}, counter-steer exit ${m.drift.counterExit} s`);
} else console.log('(no window.__game.model in this build: pure-model numbers skipped)');
for (const [id, r] of Object.entries(report.tracks)) {
  console.log(`${id}: autopilot laps ${r.laps.join(' / ')} s (${r.lapsDone} laps in ${r.simTime} s) | wall hits ${r.wallHits}, car ${r.carHits}, prop ${r.propHits} | max ${r.maxKmh} km/h | AI best ${r.aiBestLap} s, median ${r.aiMedianLap} s, AI max ${r.aiMaxKmh} km/h | 25deg wall glance at 108 km/h keeps ${r.glance.keep} of speed${r.errors ? ` | ${r.errors} page errors` : ''}`);
}
if (report.timing) console.log(`live: ${report.timing.fps} fps headless, game/wall time ratio ${report.timing.ratio} (1.0 expected at >= ${Math.ceil(1 / 0.15)} fps), sim step ${report.timing.stepMs} ms`);
writeFileSync(path.join(OUT, 'feel.json'), JSON.stringify(report, null, 2));
