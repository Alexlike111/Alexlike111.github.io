// Drift mechanic (src/sim/drift.ts + carModel drift dynamics) and the arcade steering model.
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import {
  NO_DAMAGE, SURFACE_ROAD, baseStats, driftSteerForCurvature, forwardSpeed, integrateCar, steerForCurvature, turnRateCap, wrapAngle,
  type CarKinematics,
} from '../src/sim/carModel';
import { DRIFT_AUTO, DRIFT_HOLD, DriftTracker, driftCoins } from '../src/sim/drift';
import { PhysicsWorld } from '../src/sim/world';
import { SimCar } from '../src/sim/car';
import type { CarInput, CarSetup, SimEvent } from '../src/types';

const dt = CONFIG.physics.dt;
const D = CONFIG.drift;
const IDLE: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false, drift: 0 };

function start(kmh: number): CarKinematics {
  return { x: 0, y: 0, angle: 0, vx: kmh / 3.6, vy: 0, angularVel: 0, steer: 0 };
}
const slip = (k: CarKinematics): number => wrapAngle(k.angle - Math.atan2(k.vy, k.vx));

/** model + tracker step, as SimCar.preStep does it */
function step(k: CarKinematics, i: CarInput, tr: DriftTracker, player = true): { k: CarKinematics; kick: number } {
  const sp = Math.hypot(k.vx, k.vy);
  const pre = tr.pre(i, forwardSpeed(k), sp, sp > 1 ? slip(k) : 0, player, dt);
  let kk = k;
  if (pre.kick > 0) kk = { ...k, vx: k.vx + Math.cos(k.angle) * pre.kick, vy: k.vy + Math.sin(k.angle) * pre.kick };
  const o = integrateCar(kk, i, baseStats(), NO_DAMAGE, SURFACE_ROAD, dt, tr.ctl);
  return { k: { ...o, x: o.x + o.vx * dt, y: o.y + o.vy * dt, angle: o.angle + o.angularVel * dt }, kick: pre.kick };
}

function run(k: CarKinematics, i: CarInput, tr: DriftTracker, seconds: number, player = true): { k: CarKinematics; kick: number } {
  let kick = 0;
  for (let n = 0; n < Math.round(seconds / dt); n++) { const r = step(k, i, tr, player); k = r.k; kick = Math.max(kick, r.kick); }
  return { k, kick };
}

describe('drift entry', () => {
  it('Space (handbrake) + steer at speed starts a drift within a few tenths and swings the tail out', () => {
    const tr = new DriftTracker();
    let k = start(100);
    let t15 = -1;
    for (let n = 0; n < 120; n++) {
      k = step(k, { ...IDLE, throttle: 1, steer: 1, handbrake: true }, tr).k;
      if (t15 < 0 && Math.abs(slip(k)) > 15 / 57.3) t15 = (n + 1) * dt;
    }
    expect(tr.active).toBe(true);
    expect(tr.dir).toBe(-1);                               // steer right = clockwise drift
    expect(t15).toBeGreaterThan(0);
    expect(t15).toBeLessThan(0.3);
    expect(slip(k)).toBeLessThan(0);                       // right drift: the nose points right of the travel direction
  });

  it('the DRIFT button (hold request) works like Space', () => {
    const tr = new DriftTracker();
    run(start(80), { ...IDLE, throttle: 1, steer: -0.8, drift: DRIFT_HOLD }, tr, 0.3);
    expect(tr.active).toBe(true);
    expect(tr.dir).toBe(1);
  });

  it('no drift below the minimum speed: the handbrake is just a handbrake there', () => {
    const tr = new DriftTracker();
    run(start((D.minSpeed - 2) * 3.6), { ...IDLE, steer: 1, handbrake: true }, tr, 0.5);
    expect(tr.active).toBe(false);
  });

  it('a hard touch steer starts an auto drift only above ~60 km/h', () => {
    const slow = new DriftTracker();
    run(start(50), { ...IDLE, throttle: 0.2, steer: 1, drift: DRIFT_AUTO }, slow, 0.3);
    expect(slow.active).toBe(false);
    const fast = new DriftTracker();
    run(start(90), { ...IDLE, throttle: 1, steer: 1, drift: DRIFT_AUTO }, fast, 0.1);
    expect(fast.active).toBe(true);
    const soft = new DriftTracker();
    run(start(90), { ...IDLE, throttle: 1, steer: 0.7, drift: DRIFT_AUTO }, soft, 0.3);
    expect(soft.active).toBe(false);                       // ordinary touch cornering stays grip
  });

  it('a brake TAP + hard steer starts a drift (player), held braking into a corner does not', () => {
    const tap = new DriftTracker();
    let k = run(start(100), { ...IDLE, brake: 1, steer: 1 }, tap, 0.15).k;
    expect(tap.active).toBe(false);
    run(k, { ...IDLE, throttle: 1, steer: 1 }, tap, 0.05);
    expect(tap.active).toBe(true);
    const held = new DriftTracker();
    k = run(start(100), { ...IDLE, brake: 1, steer: 1 }, held, 0.8).k;
    run(k, { ...IDLE, throttle: 1, steer: 1 }, held, 0.1);
    expect(held.active).toBe(false);
    const ai = new DriftTracker();
    k = run(start(100), { ...IDLE, brake: 1, steer: 1 }, ai, 0.15, false).k;
    run(k, { ...IDLE, throttle: 1, steer: 1 }, ai, 0.05, false);
    expect(ai.active).toBe(false);                         // AI cars never brake-tap into a drift
  });
});

describe('drift control (no spin-outs, small speed loss)', () => {
  it('holding full steer keeps a steady angle, never spins, keeps most of the speed', () => {
    const tr = new DriftTracker();
    let k = start(100);
    const v0 = Math.hypot(k.vx, k.vy);
    let maxSlip = 0, maxW = 0, sum = 0, n = 0;
    for (let i = 0; i < 120 * 3; i++) {
      k = step(k, { ...IDLE, throttle: 1, steer: 1, handbrake: true }, tr).k;
      maxSlip = Math.max(maxSlip, Math.abs(slip(k)));
      maxW = Math.max(maxW, Math.abs(k.angularVel));
      if (i > 120) { sum += Math.abs(slip(k)); n++; }
    }
    expect(tr.active).toBe(true);
    expect(maxSlip).toBeLessThan(D.angleMax + 0.05);       // the angle converges on the target, it never overshoots into a spin
    expect(sum / n).toBeGreaterThan(D.angleMax * 0.85);
    expect(maxW).toBeLessThanOrEqual(CONFIG.car.maxYawRate + D.angleMax * D.angleRate);
    expect(Math.hypot(k.vx, k.vy) / v0).toBeGreaterThan(0.75);
  });

  it('steering sets the angle: neutral is smaller than full, counter-steer straightens the car out of the drift', () => {
    const a = new DriftTracker(), b = new DriftTracker();
    let ka = run(start(90), { ...IDLE, throttle: 1, steer: 1, handbrake: true }, a, 0.2).k;
    let kb = run(start(90), { ...IDLE, throttle: 1, steer: 1, handbrake: true }, b, 0.2).k;
    ka = run(ka, { ...IDLE, throttle: 1, steer: 1, handbrake: true }, a, 1).k;
    kb = run(kb, { ...IDLE, throttle: 1, steer: 0, handbrake: true }, b, 1).k;
    expect(Math.abs(slip(kb))).toBeLessThan(Math.abs(slip(ka)) - 0.1);
    const c = new DriftTracker();
    let kc = run(start(90), { ...IDLE, throttle: 1, steer: 1, drift: DRIFT_AUTO }, c, 1).k;
    expect(c.active).toBe(true);
    kc = run(kc, { ...IDLE, throttle: 1, steer: -1, drift: DRIFT_AUTO }, c, 0.3).k;
    expect(c.active).toBe(false);                          // a hard counter-steer straightens, it does not flick into the other way
    kc = run(kc, { ...IDLE, throttle: 1, steer: 0 }, c, 0.6).k;
    expect(Math.abs(slip(kc))).toBeLessThan(0.08);         // grip takes over again
  });

  it('a drift turns tighter than grip cornering (it pays in hairpins)', () => {
    // curvature of the travelled path (velocity heading change per metre) after settling, drift vs grip at full steer
    const curv = (i: CarInput, tr: DriftTracker | null): number => {
      let k = start(80);
      const t = tr ?? new DriftTracker();
      for (let n = 0; n < 120; n++) k = step(k, i, t).k;
      const h0 = Math.atan2(k.vy, k.vx);
      let dist = 0;
      for (let n = 0; n < 24; n++) { k = step(k, i, t).k; dist += Math.hypot(k.vx, k.vy) * dt; }
      return Math.abs(wrapAngle(Math.atan2(k.vy, k.vx) - h0)) / dist;
    };
    const drift = curv({ ...IDLE, throttle: 0.5, steer: 1, handbrake: true }, new DriftTracker());
    const grip = curv({ ...IDLE, throttle: 0.5, steer: 1 }, null);
    expect(drift).toBeGreaterThan(grip * 1.05);
  });
});

describe('drift exit: tiers, boost, points, combo, cancel', () => {
  const driftFor = (seconds: number, tr = new DriftTracker(), from = start(110)): { kick: number; tr: DriftTracker; k: CarKinematics } => {
    let k = run(from, { ...IDLE, throttle: 1, steer: 1, handbrake: true }, tr, seconds).k;
    const r = run(k, { ...IDLE, throttle: 1, steer: 0 }, tr, 0.3);
    k = r.k;
    return { kick: r.kick, tr, k };
  };

  it('tiers 1-3 by charge time, each with a bigger exit kick and boost', () => {
    const short = driftFor(0.3);
    expect(short.kick).toBe(0);
    expect(short.tr.boostTier).toBe(0);
    const kicks: number[] = [];
    for (const [i, s] of [[1, D.tierTime[0] + 0.25], [2, D.tierTime[1] + 0.25], [3, D.tierTime[2] + 0.25]] as [number, number][]) {
      const r = driftFor(s);
      expect(r.tr.boostTier).toBe(i);
      expect(r.kick).toBeCloseTo(D.boostKick[i - 1], 6);
      expect(r.tr.boostT).toBeGreaterThan(0);
      kicks.push(r.kick);
    }
    expect(kicks[1]).toBeGreaterThan(kicks[0]);
    expect(kicks[2]).toBeGreaterThan(kicks[1]);
  });

  it('the exit boost really adds speed versus the same drift without it', () => {
    const tr = new DriftTracker();
    let k = run(start(110), { ...IDLE, throttle: 1, steer: 1, handbrake: true }, tr, D.tierTime[1] + 0.2).k;
    const before = Math.hypot(k.vx, k.vy);
    k = run(k, { ...IDLE, throttle: 1, steer: 0 }, tr, 0.05).k;
    expect(Math.hypot(k.vx, k.vy)).toBeGreaterThan(before + D.boostKick[1] * 0.6);
  });

  it('a clean exit banks points; chaining drifts raises the combo; a hit cancels the drift, its points and the combo', () => {
    const tr = new DriftTracker();
    let { k } = driftFor(1.2, tr);
    const first = tr.score;
    expect(first).toBeGreaterThan(50);
    expect(tr.lastBank).toBe(first);
    // second drift right away: combo x2
    k = run(k, { ...IDLE, throttle: 1, steer: -1, handbrake: true }, tr, 0.6).k;
    expect(tr.active).toBe(true);
    expect(tr.combo).toBe(2);
    expect(tr.livePoints).toBeGreaterThan(0);
    // wall hit
    tr.cancel();
    expect(tr.active).toBe(false);
    expect(tr.combo).toBe(1);
    expect(tr.score).toBe(first);                          // the cancelled drift scored nothing
    expect(tr.cancelT).toBe(0);
    // after a cancel nothing chains
    run(k, { ...IDLE, throttle: 1, steer: 1, handbrake: true }, tr, 0.4);
    expect(tr.combo).toBe(1);
  });

  it('drift points become coins at the race end (capped)', () => {
    expect(driftCoins(0)).toBe(0);
    expect(driftCoins(2000)).toBe(Math.floor(2000 * D.coinsPerPoint));
    expect(driftCoins(1e9)).toBe(D.maxCoins);
  });

  it('SimCar: a hard wall-like impact during a drift cancels it; state exposes the drift', () => {
    const pw = new PhysicsWorld();
    const setup: CarSetup = { id: 0, isPlayer: true, name: 'p', colorIndex: 0, stats: baseStats() };
    const car = new SimCar(pw, setup, 0, 0, 0);
    car.body.setLinearVelocity({ x: 28, y: 0 });
    const ev: SimEvent[] = [];
    for (let i = 0; i < 60; i++) { car.setInput({ ...IDLE, throttle: 1, steer: 1, handbrake: true }); car.preStep(); pw.step(); car.postStep(); car.flushDamage(ev); }
    expect(car.state.driftActive).toBe(true);
    expect(car.state.drifting).toBe(true);
    expect(car.state.driftAngle ?? 0).toBeGreaterThan(0.2);
    car.recordImpact(car.state.x + 2, car.state.y, D.cancelImpulse * 1.5, 'wall');
    car.flushDamage(ev);
    car.setInput({ ...IDLE, throttle: 1, steer: 1, handbrake: true }); car.preStep(); pw.step(); car.postStep();
    expect(car.state.driftCancelT ?? 99).toBeLessThan(0.1);
  });
});

describe('arcade steering', () => {
  it('half stick is about half the turn at every speed (no saturation at speed)', () => {
    for (const kmh of [60, 120, 190]) {
      const yaw = (s: number): number => {
        let k = start(kmh);
        for (let i = 0; i < 180; i++) {
          const o = integrateCar(k, { ...IDLE, throttle: 0.6, steer: s }, baseStats(), NO_DAMAGE, SURFACE_ROAD, dt);
          k = { ...o, x: o.x + o.vx * dt, y: o.y + o.vy * dt, angle: o.angle + o.angularVel * dt };
        }
        return Math.abs(k.angularVel);
      };
      const r = yaw(0.5) / yaw(1);
      expect(r).toBeGreaterThan(0.35);
      expect(r).toBeLessThan(0.6);
    }
  });

  it('responds within ~0.25 s at speed (yaw reaches 90% of steady state)', () => {
    let k = start(120);
    const ws: number[] = [];
    for (let i = 0; i < 240; i++) {
      const o = integrateCar(k, { ...IDLE, throttle: 0.6, steer: 1 }, baseStats(), NO_DAMAGE, SURFACE_ROAD, dt);
      k = { ...o, x: o.x + o.vx * dt, y: o.y + o.vy * dt, angle: o.angle + o.angularVel * dt };
      ws.push(Math.abs(k.angularVel));
    }
    const i90 = ws.findIndex((w) => w >= 0.9 * ws[ws.length - 1]);
    expect(i90 * dt).toBeLessThan(0.25);
  });

  it('steerForCurvature / driftSteerForCurvature invert the model (the AI drives with them)', () => {
    for (const v of [12, 25, 45]) {
      const kappa = 0.6 * turnRateCap(v) / v;
      const s = steerForCurvature(kappa, v);
      let k = start(v * 3.6);
      for (let i = 0; i < 240; i++) {
        const o = integrateCar(k, { ...IDLE, throttle: 0, steer: s }, baseStats(), NO_DAMAGE, SURFACE_ROAD, dt);
        const sc = v / Math.hypot(o.vx, o.vy);              // hold the speed (cruise) so the curvature can settle
        k = { ...o, vx: o.vx * sc, vy: o.vy * sc, x: o.x + o.vx * dt, y: o.y + o.vy * dt, angle: o.angle + o.angularVel * dt };
      }
      expect(s).toBeLessThan(0);                           // left curve = steer left
      expect(k.angularVel / forwardSpeed(k)).toBeCloseTo(kappa, 2);
    }
    // drift inverse: neutral path for the mid share, full steer into the drift for the full drift path
    const v = 20;
    expect(driftSteerForCurvature((D.latAccel * D.pathMid) / (v * v), v, 1)).toBeCloseTo(0, 6);
    expect(driftSteerForCurvature(D.latAccel / (v * v), v, 1)).toBeCloseTo(-1, 6);
    expect(driftSteerForCurvature(-D.latAccel / (v * v), v, -1)).toBeCloseTo(1, 6);
  });
});
