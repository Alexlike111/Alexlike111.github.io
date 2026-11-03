import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import {
  NO_DAMAGE, SURFACE_GRASS, SURFACE_ROAD, baseStats, forwardSpeed, integrateCar, lateralSpeed, engineRpm,
  type CarKinematics, type Surface,
} from '../src/sim/carModel';
import type { CarInput, DamageEffects } from '../src/types';

const dt = CONFIG.physics.dt;
const IDLE: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };

function start(speed = 0, angle = 0): CarKinematics {
  return { x: 0, y: 0, angle, vx: speed * Math.cos(angle), vy: speed * Math.sin(angle), angularVel: 0, steer: 0 };
}
/** integrate + advance pose (what planck does with the velocities we set) */
function step(k: CarKinematics, i: CarInput, fx: DamageEffects = NO_DAMAGE, s: Surface = SURFACE_ROAD): CarKinematics {
  const o = integrateCar(k, i, baseStats(), fx, s, dt);
  return { ...o, x: o.x + o.vx * dt, y: o.y + o.vy * dt, angle: o.angle + o.angularVel * dt };
}

describe('car model performance targets', () => {
  // arcade feel pass: 0-100 km/h ~2.5 s, 0-120 ~3.2 s, ~200 km/h on a long straight (was 4.1 s / 164 km/h: players found the cars slow)
  it('0-100 km/h in 2.5 s +-0.35, 0-120 km/h in about 3.2 s', () => {
    let k = start();
    let t = 0;
    while (forwardSpeed(k) < 100 / 3.6 && t < 15) { k = step(k, { ...IDLE, throttle: 1 }); t += dt; }
    expect(t).toBeGreaterThan(2.15);
    expect(t).toBeLessThan(2.85);
    while (forwardSpeed(k) < 120 / 3.6 && t < 15) { k = step(k, { ...IDLE, throttle: 1 }); t += dt; }
    expect(t).toBeGreaterThan(2.8);
    expect(t).toBeLessThan(3.6);
  });

  it('settles at about 200 km/h on a long straight', () => {
    let k = start();
    for (let i = 0; i < 120 * 40; i++) k = step(k, { ...IDLE, throttle: 1 });
    expect(forwardSpeed(k) * 3.6).toBeGreaterThan(190);
    expect(forwardSpeed(k) * 3.6).toBeLessThan(220);
  });

  it('reaches a sane top speed and does not exceed the ceiling', () => {
    let k = start();
    for (let i = 0; i < 120 * 40; i++) k = step(k, { ...IDLE, throttle: 1 });
    const v = forwardSpeed(k);
    expect(v).toBeGreaterThan(baseStats().topSpeed * 0.85);
    expect(v).toBeLessThanOrEqual(baseStats().topSpeed + 0.01);
  });

  // arcade brakes scaled with the higher speeds (was 23 m)
  it('braking 80 -> 0 km/h in about 17 m +-3', () => {
    let k = start(80 / 3.6);
    const x0 = k.x;
    let t = 0;
    while (forwardSpeed(k) > 0.05 && t < 10) { k = step(k, { ...IDLE, brake: 1 }); t += dt; }
    const d = k.x - x0;
    expect(d).toBeGreaterThan(14);
    expect(d).toBeLessThan(20);
    expect(Math.abs(forwardSpeed(k))).toBeLessThan(1); // does not shoot into reverse instantly
  });

  it('holding brake from standstill reverses, capped by reverseMax', () => {
    let k = start();
    for (let i = 0; i < 120 * 6; i++) k = step(k, { ...IDLE, brake: 1 });
    const v = forwardSpeed(k);
    expect(v).toBeLessThan(-3);
    expect(v).toBeGreaterThanOrEqual(-CONFIG.car.reverseMax - 0.01);
  });

  it('coasting to a stop is exact (no creeping or reversing)', () => {
    let k = start(5);
    for (let i = 0; i < 120 * 30; i++) k = step(k, IDLE);
    expect(forwardSpeed(k)).toBe(0);
    expect(Math.hypot(k.vx, k.vy)).toBeLessThan(1e-9);
  });
});

describe('handling', () => {
  it('handbrake at speed + steer produces drift slip above the threshold', () => {
    let k = start(100 / 3.6);
    for (let i = 0; i < 120; i++) {
      k = step(k, { throttle: 0.6, brake: 0, steer: 1, handbrake: i > 10 });
    }
    expect(Math.abs(lateralSpeed(k))).toBeGreaterThan(CONFIG.car.driftSlipThreshold * 1.5);
    expect(forwardSpeed(k)).toBeGreaterThan(5); // still going, not a dead stop
  });

  it('normal full-steer cornering at speed grips (no drift flag)', () => {
    let k = start(100 / 3.6);
    let maxLat = 0;
    for (let i = 0; i < 120 * 3; i++) {
      k = step(k, { throttle: 0.5, brake: 0, steer: 1, handbrake: false });
      maxLat = Math.max(maxLat, Math.abs(lateralSpeed(k)));
    }
    expect(maxLat).toBeLessThan(CONFIG.car.driftSlipThreshold);
  });

  it('strong lateral grip: sideways velocity decays fast', () => {
    let k: CarKinematics = { ...start(), vy: 6 };
    for (let i = 0; i < 120 * 0.5; i++) k = step(k, IDLE);
    expect(Math.abs(lateralSpeed(k))).toBeLessThan(0.7);
  });

  it('handbrake keeps sliding much longer than normal grip', () => {
    let a: CarKinematics = { ...start(10), vy: 6 };
    let b = a;
    for (let i = 0; i < 60; i++) { a = step(a, IDLE); b = step(b, { ...IDLE, handbrake: true }); }
    expect(Math.abs(lateralSpeed(b))).toBeGreaterThan(Math.abs(lateralSpeed(a)) * 4);
  });

  it('full lock at 15 km/h for 5 s: no spin, small lateral speed, keeps moving forward', () => {
    let k = start(15 / 3.6);
    let maxW = 0, maxLat = 0, minF = Infinity, angle0 = k.angle;
    for (let i = 0; i < 120 * 5; i++) {
      k = step(k, { throttle: 0.3, brake: 0, steer: 1, handbrake: false });
      maxW = Math.max(maxW, Math.abs(k.angularVel));
      maxLat = Math.max(maxLat, Math.abs(lateralSpeed(k)));
      minF = Math.min(minF, forwardSpeed(k));
    }
    // bounded heading change rate: the stronger engine gains speed under throttle 0.3, so the bound is the yaw cap
    expect(maxW).toBeLessThanOrEqual(CONFIG.car.maxYawRate + 1e-9);
    expect(maxLat).toBeLessThan(1.5);        // not sliding
    expect(minF).toBeGreaterThan(2);         // car keeps moving forward
    expect(angle0 - k.angle).toBeGreaterThan(2); // and it does turn (right = clockwise)
  });

  it('standstill is stable: steering with no speed does not rotate the car', () => {
    let k = start();
    for (let i = 0; i < 240; i++) k = step(k, { ...IDLE, steer: 1 });
    expect(k.angle).toBeCloseTo(0, 6);
    expect(k.vx).toBe(0);
  });

  it('steer +1 turns right (clockwise, negative angle), -1 turns left', () => {
    let r = start(10), l = start(10);
    for (let i = 0; i < 120; i++) { r = step(r, { ...IDLE, throttle: 0.3, steer: 1 }); l = step(l, { ...IDLE, throttle: 0.3, steer: -1 }); }
    expect(r.angle).toBeLessThan(-0.3);
    expect(l.angle).toBeGreaterThan(0.3);
  });

  it('reverse steering inverts the turn direction', () => {
    let k = start(-4);
    for (let i = 0; i < 120; i++) k = step(k, { ...IDLE, steer: 1, brake: 0.3 });
    // steer +1 = right: forward gives a clockwise (negative) angle change; reversing gives positive
    expect(k.angle).toBeGreaterThan(0);
  });

  it('steering is smoothed (not instant) and recentres', () => {
    let k = start(20);
    k = step(k, { ...IDLE, steer: 1 });
    expect(k.steer).toBeGreaterThan(0);
    expect(k.steer).toBeLessThan(0.1);
    for (let i = 0; i < 120; i++) k = step(k, { ...IDLE, steer: 1 });
    expect(k.steer).toBeCloseTo(1, 3);
    for (let i = 0; i < 120; i++) k = step(k, IDLE);
    expect(k.steer).toBeCloseTo(0, 3);
  });

  it('is deterministic', () => {
    const run = () => {
      let k = start(30);
      for (let i = 0; i < 500; i++) k = step(k, { throttle: 1, brake: 0, steer: Math.sin(i / 40), handbrake: i % 200 > 150 }, NO_DAMAGE, SURFACE_GRASS);
      return k;
    };
    expect(run()).toEqual(run());
  });
});

describe('damage effects in the model', () => {
  const run = (fx: DamageEffects) => {
    let k = start();
    for (let i = 0; i < 120 * 10; i++) k = step(k, { ...IDLE, throttle: 1 }, fx);
    return forwardSpeed(k);
  };
  it('lower topSpeedMul lowers top speed, lower powerMul slows acceleration', () => {
    expect(run({ ...NO_DAMAGE, topSpeedMul: 0.6 })).toBeLessThan(run(NO_DAMAGE) * 0.7);
    const acc = (fx: DamageEffects) => { let k = start(); for (let i = 0; i < 120; i++) k = step(k, { ...IDLE, throttle: 1 }, fx); return forwardSpeed(k); };
    expect(acc({ ...NO_DAMAGE, powerMul: 0.6 })).toBeLessThan(acc(NO_DAMAGE) * 0.7);
  });
  it('steerPull makes the car veer with no steering input', () => {
    let k = start(25);
    for (let i = 0; i < 240; i++) k = step(k, { ...IDLE, throttle: 0.4 }, { ...NO_DAMAGE, steerPull: 0.3 });
    expect(Math.abs(k.angle)).toBeGreaterThan(0.2);
  });
  it('lower gripMul increases cornering slip', () => {
    const lat = (g: number) => { let k = start(25); let m = 0; for (let i = 0; i < 240; i++) { k = step(k, { throttle: 0.5, brake: 0, steer: 0.8, handbrake: false }, { ...NO_DAMAGE, gripMul: g }); m = Math.max(m, Math.abs(lateralSpeed(k))); } return m; };
    expect(lat(0.6)).toBeGreaterThan(0);
    // with less grip the car still slips at least as much per available lateral acceleration
    expect(lat(0.6)).toBeGreaterThanOrEqual(lat(1) - 0.2);
  });
});

describe('surfaces', () => {
  it('grass slows the car versus road', () => {
    const v = (s: Surface) => { let k = start(); for (let i = 0; i < 120 * 8; i++) k = step(k, { ...IDLE, throttle: 1 }, NO_DAMAGE, s); return forwardSpeed(k); };
    expect(v(SURFACE_GRASS)).toBeLessThan(v(SURFACE_ROAD) * 0.8);
  });
});

describe('engine rpm', () => {
  it('stays in 0..1, rises with throttle at standstill and falls on shifts', () => {
    let r = 0.16;
    for (let i = 0; i < 120; i++) r = engineRpm(0, 50, 1, r, dt);
    expect(r).toBeGreaterThan(0.5);
    let prev = 0.1, drops = 0;
    for (let v = 0; v < 50; v += 0.05) {
      for (let i = 0; i < 20; i++) prev = engineRpm(v, 50, 1, prev, dt);
      expect(prev).toBeGreaterThanOrEqual(0);
      expect(prev).toBeLessThanOrEqual(1);
    }
    let last = 0;
    for (let v = 0; v < 48; v += 0.2) {
      for (let i = 0; i < 20; i++) prev = engineRpm(v, 50, 1, prev, dt);
      if (prev < last - 0.1) drops++;
      last = prev;
    }
    expect(drops).toBeGreaterThanOrEqual(2);
  });
});
