// Steering retune (player feedback: "the car turns very reluctantly / heavily"): light, immediate, powerful steering.
// Full lock gives a small turning radius at every speed (arcade grip + full-lock over-turn that scrubs speed), a key press
// reaches the full turn rate in ~0.11 s, touch has more authority at small finger offsets, full lock never spins the car,
// and the edge assist never takes turn-in away from the player.
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { steerAxis } from '../src/input/input';
import { assistedInput } from '../src/sim/assist';
import {
  NO_DAMAGE, SURFACE_ROAD, baseStats, forwardSpeed, fullLockRadius, integrateCar, wrapAngle, type CarKinematics,
} from '../src/sim/carModel';
import { DRIFT_AUTO, DriftTracker } from '../src/sim/drift';
import { Sim } from '../src/sim/sim';
import { buildTrackGeometry } from '../src/track/spline';
import { TRACKS } from '../src/track/tracks';
import type { CarInput, CarState } from '../src/types';

const dt = CONFIG.physics.dt;
const C = CONFIG.car;
const IDLE: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false, drift: 0 };
const start = (kmh: number): CarKinematics => ({ x: 0, y: 0, angle: 0, vx: kmh / 3.6, vy: 0, angularVel: 0, steer: 0 });
const slip = (k: CarKinematics): number => wrapAngle(k.angle - Math.atan2(k.vy, k.vx));

/** model (+ drift tracker) step and pose advance, as SimCar / planck do it; `hold` keeps the speed (cruise) */
function step(k: CarKinematics, i: CarInput, tr: DriftTracker | null = null, hold = 0): CarKinematics {
  let kk = k;
  if (tr) {
    const sp = Math.hypot(k.vx, k.vy);
    const pre = tr.pre(i, forwardSpeed(k), sp, sp > 1 ? slip(k) : 0, true, dt);
    if (pre.kick > 0) kk = { ...k, vx: k.vx + Math.cos(k.angle) * pre.kick, vy: k.vy + Math.sin(k.angle) * pre.kick };
  }
  const o = integrateCar(kk, i, baseStats(), NO_DAMAGE, SURFACE_ROAD, dt, tr ? tr.ctl : null);
  let vx = o.vx, vy = o.vy;
  if (hold > 0) { const sc = hold / Math.hypot(vx, vy); vx *= sc; vy *= sc; }
  return { ...o, vx, vy, x: o.x + o.vx * dt, y: o.y + o.vy * dt, angle: o.angle + o.angularVel * dt };
}

/** steady full-lock state at a held speed */
function lockAt(kmh: number, steer = 1): CarKinematics {
  let k = start(kmh);
  for (let i = 0; i < 240; i++) k = step(k, { ...IDLE, throttle: 1, steer }, null, kmh / 3.6);
  return k;
}

describe('turning radius and arcade grip', () => {
  // track corner radii (centre line, from the splines) for the report: t1 sweepers 31-40 m, t2 21-37 m + one 12 m hairpin,
  // t3 hairpins 10-13 m and 17-27 m bends
  const LIMIT: Record<number, number> = { 80: 10, 120: 22, 160: 38, 200: 60 };
  for (const kmh of [80, 120, 160, 200]) {
    it(`full lock at ${kmh} km/h turns on a radius of at most ${LIMIT[kmh]} m`, () => {
      const k = lockAt(kmh);
      const R = (kmh / 3.6) / Math.abs(k.angularVel);
      expect(R).toBeLessThanOrEqual(LIMIT[kmh]);
      expect(Math.abs(R / fullLockRadius(kmh / 3.6) - 1)).toBeLessThan(0.02);   // the pure helper matches the model
    });
  }

  it('arcade lateral grip: ~40 m/s^2 without speed loss at 70% stick, >= 50 m/s^2 at full lock (which scrubs speed)', () => {
    for (const kmh of [120, 160, 200]) {
      const a70 = Math.abs(lockAt(kmh, 0.7).angularVel) * kmh / 3.6;
      const aFull = Math.abs(lockAt(kmh, 1).angularVel) * kmh / 3.6;
      expect(a70, `${kmh}`).toBeGreaterThan(35);
      expect(aFull, `${kmh}`).toBeGreaterThan(50);
    }
    // 70% stick: the car keeps its speed at full throttle; full lock bleeds speed (that is what brings it onto the line)
    const after1s = (s: number): number => { let k = start(160); for (let i = 0; i < 120; i++) k = step(k, { ...IDLE, throttle: 1, steer: s }); return Math.hypot(k.vx, k.vy) * 3.6; };
    expect(after1s(0.7)).toBeGreaterThan(150);
    expect(after1s(1)).toBeLessThan(after1s(0.7) - 8);
    expect(after1s(1)).toBeGreaterThan(110);   // ... but it is no brake
  });

  it('full lock is stable at every speed: small slip, no drift flag needed to turn', () => {
    for (const kmh of [30, 60, 100, 150, 200]) {
      let k = start(kmh), maxSlip = 0;
      for (let i = 0; i < 360; i++) {
        k = step(k, { ...IDLE, throttle: 1, steer: 1 });
        if (Math.hypot(k.vx, k.vy) > 3) maxSlip = Math.max(maxSlip, Math.abs(slip(k)));
      }
      expect(maxSlip * 57.3, `${kmh} km/h`).toBeLessThan(12);
    }
  });
});

describe('a player at full throttle takes every corner', () => {
  // keyboard-style bot: bang-bang steering at the centre line through the keyboard ramp, full throttle all lap.
  // `liftForHairpins`: lifts / brakes only for bends tighter than 15 m (t3's hairpins)
  function lapRun(ti: number, liftForHairpins: boolean): { walls: number; laps: number; minKmh: number } {
    const sim = new Sim({ track: TRACKS[ti], cars: [{ id: 0, isPlayer: true, name: 'p', colorIndex: 0, stats: baseStats() }], seed: 1, powerUps: false });
    const tr = sim.track, P = sim.cars[0];
    let kb = 0, t = 0, walls = 0, laps = 0, minV = Infinity;
    while (t < 90 && laps < 2) {
      const n = tr.nearest(P.x, P.y);
      const v = Math.max(0, P.speed);
      const tp = tr.sampleAt(n.s + 6 + 0.35 * v);
      const alpha = wrapAngle(Math.atan2(tp.y - P.y, tp.x - P.x) - P.angle);
      const want = Math.abs(alpha) > 0.05 ? -Math.sign(alpha) : 0;
      const r = CONFIG.controls.keySteerRise * dt;
      kb += Math.max(-r, Math.min(r, want - kb));
      let throttle = 1, brake = 0;
      if (liftForHairpins) {
        let vT = 99;
        for (let d = 0; d < 100; d += 3) {
          const kk = Math.abs(tr.sampleAt(n.s + d).curvature);
          if (kk > 1 / 15) vT = Math.min(vT, Math.sqrt(C.maxLatAccel * 0.8 / kk + 2 * 10 * Math.max(0, d - 4)));
        }
        if (v > vT) throttle = 0;
        if (v > vT + 3) brake = 1;
      }
      sim.setPlayerInput({ throttle, brake, steer: kb, handbrake: false, drift: 0 });
      sim.update(dt); t += dt;
      for (const e of sim.drainEvents()) {
        if (e.type === 'impact' && e.carId === 0 && (e.other === 'wall' || e.other === 'guardrail') && e.strength > 0.15) walls++;   // scrapes (strength < 0.15, no damage) do not count
        if (e.type === 'lap' && e.carId === 0) laps++;
      }
      if (sim.race.phase === 'racing' && t > 8) minV = Math.min(minV, v);
    }
    return { walls, laps, minKmh: minV * 3.6 };
  }

  it('t1 and t2 flat out (never lifting), t3 lifting only for the hairpins: no wall hits', () => {
    const t1 = lapRun(0, false), t2 = lapRun(1, false), t3 = lapRun(2, true);
    for (const [id, r] of [['t1', t1], ['t2', t2], ['t3', t3]] as const) {
      expect(r.laps, id).toBe(2);
      expect(r.walls, id).toBe(0);
    }
    expect(t1.minKmh).toBeGreaterThan(120);   // the sweepers are taken fast, the full-lock scrub is no brake
  }, 60000);

  it('the track corners fit: every bend of 20 m or more fits a full-lock circle at 120 km/h', () => {
    const R120 = fullLockRadius(120 / 3.6);
    for (const def of TRACKS) {
      const g = buildTrackGeometry(def);
      for (const s of g.samples) {
        const R = 1 / Math.max(1e-6, Math.abs(s.curvature));
        if (R >= 20) expect(R120, def.id).toBeLessThanOrEqual(R);
      }
    }
  });
});

describe('turn-in time (keyboard) and recentre', () => {
  it('a held key reaches 90% of the full turn rate in <= 0.12 s and is back under 10% <= 0.12 s after release', () => {
    for (const kmh of [60, 120, 180]) {
      const v0 = kmh / 3.6;
      let k = start(kmh), s = 0;
      const ws: number[] = [];
      for (let i = 0; i < 240; i++) {
        s = Math.min(1, s + CONFIG.controls.keySteerRise * dt);
        k = step(k, { ...IDLE, throttle: 0.6, steer: s }, null, v0);
        ws.push(Math.abs(k.angularVel));
      }
      const full = ws[ws.length - 1];
      expect((ws.findIndex((w) => w >= 0.9 * full) + 1) * dt, `${kmh} km/h turn-in`).toBeLessThanOrEqual(0.12);
      let n = 0;
      while (n < 120 && (n === 0 || Math.abs(k.angularVel) > 0.1 * full)) {
        s = Math.max(0, s - CONFIG.controls.keySteerReturn * dt);
        k = step(k, { ...IDLE, throttle: 0.6, steer: s }, null, v0);
        n++;
      }
      expect(n * dt, `${kmh} km/h recentre`).toBeLessThanOrEqual(0.12);
    }
  });
});

describe('touch: authority at small offsets, stable full lock', () => {
  it('the touch curve gives more steer for small finger offsets, full lock at the same distance', () => {
    const W = 800, home = 400, dead = CONFIG.controls.steerDeadZone * W, full = CONFIG.controls.steerFullAt * W;
    const at = (frac: number): number => steerAxis(home + dead + frac * (full - dead), home, W, false);
    expect(at(0.1)).toBeGreaterThan(0.2);
    expect(at(0.5)).toBeGreaterThan(0.6);
    expect(at(1)).toBe(1);
    let prev = 0;
    for (let f = 0; f <= 1.0001; f += 0.05) { const v = at(f); expect(v).toBeGreaterThanOrEqual(prev); prev = v; }
    // the auto drift asks for the finger near the full-lock distance, as before the curve
    expect(at(0.65)).toBeLessThan(CONFIG.drift.autoSteer);
  });

  it('full touch lock (auto drift request) never spins: heading < 130 deg in 0.6 s (a hairpin turn, not a spin round), slip bounded, straightens on release', () => {
    for (const kmh of [40, 70, 100, 150, 200]) {
      const tr = new DriftTracker();
      let k = start(kmh), maxSlip = 0, head06 = 0;
      for (let i = 0; i < 240; i++) {
        k = step(k, { ...IDLE, throttle: 1, steer: 1, drift: DRIFT_AUTO }, tr);
        if (i === Math.round(0.6 / dt) - 1) head06 = Math.abs(k.angle);
        if (Math.hypot(k.vx, k.vy) > 2) maxSlip = Math.max(maxSlip, Math.abs(slip(k)));
      }
      expect(head06 * 57.3, `${kmh} km/h heading in 0.6 s`).toBeLessThan(130);
      expect(maxSlip, `${kmh} km/h slip`).toBeLessThanOrEqual(CONFIG.drift.angleMax + 0.08);
      for (let i = 0; i < 120; i++) k = step(k, { ...IDLE, throttle: 1, steer: 0, drift: DRIFT_AUTO }, tr);
      expect(Math.abs(slip(k)) * 57.3, `${kmh} km/h after release`).toBeLessThan(8);
    }
  });
});

describe('edge assist never reduces the turn-in the player asks for', () => {
  it('assisted steer is never smaller than the player\'s in the player\'s direction, and never flips it', () => {
    const g = buildTrackGeometry(TRACKS[2]);
    let checked = 0, active = 0;
    for (let s = 0; s < g.length; s += 7) {
      const smp = g.sampleAt(s);
      const th = Math.atan2(smp.ty, smp.tx);
      for (const lat of [-3.5, -2, 0, 2, 3.5]) {
        for (const he of [-0.5, -0.2, 0, 0.2, 0.5]) {
          const st = {
            x: smp.x + smp.nx * lat, y: smp.y + smp.ny * lat, angle: th + he, speed: 30, driftActive: false, offRoad: false,
          } as CarState;
          for (const steer of [-1, -0.6, -0.2, 0, 0.2, 0.6, 1]) {
            const out = assistedInput({ ...IDLE, steer }, st, g, s).steer;
            if (out !== steer) active++;
            if (steer !== 0) {
              expect(Math.sign(out)).toBe(Math.sign(steer));
              expect(Math.abs(out)).toBeGreaterThanOrEqual(Math.abs(steer));
            }
            expect(Math.abs(out - steer)).toBeLessThanOrEqual(CONFIG.car.assistMax + 1e-9);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(active).toBeGreaterThan(0);   // it still helps a car drifting toward the edge with no / little steer
  });
});
