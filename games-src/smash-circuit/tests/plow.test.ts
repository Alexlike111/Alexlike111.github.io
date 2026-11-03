// Plow-through: a static piece that breaks under a car must not stop the car dead or bounce it back.
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { baseStats } from '../src/sim/carModel';
import { Sim } from '../src/sim/sim';
import { buildTrackGeometry } from '../src/track/spline';
import { TRACKS } from '../src/track/tracks';
import type { CarInput, PropType, TrackDef } from '../src/types';

const DT = CONFIG.physics.dt;
const IDLE: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
const player = () => ({ id: 0, isPlayer: true, name: 'p', colorIndex: 0, stats: baseStats() });

function solo(def: TrackDef): Sim {
  const sim = new Sim({ track: def, cars: [player()], seed: 1 });
  for (let i = 0; i < 120 * 4; i++) sim.update(DT);
  sim.drainEvents();
  return sim;
}

/** Drive the car at a wall / guardrail segment at `kmh`, `angDeg` off perpendicular. Returns normal speed samples. */
function wallHit(kind: 'wall' | 'guardrail', kmh: number, angDeg = 0) {
  const sim = solo(TRACKS[0]);
  const half = sim.track.def.width / 2;
  const w = sim.destructibles.filter((d) => d.kind === kind)[3];
  const nn = sim.track.nearest(w.x, w.y);
  const side = nn.lateral > 0 ? 1 : -1;
  const t = sim.track.sampleAt(nn.s - 20);
  const a = Math.atan2(t.ty, t.tx) + side * (90 - angDeg) * Math.PI / 180;
  const car = sim.simCars[0];
  car.reset(t.x + t.nx * side * (half - 3), t.y + t.ny * side * (half - 3), a);
  const v0 = kmh / 3.6;
  car.body.setLinearVelocity({ x: Math.cos(a) * v0, y: Math.sin(a) * v0 });
  sim.setPlayerInput(IDLE);
  let broke = false, minAlong = Infinity, hitStep = -1;
  const ux = Math.cos(a), uy = Math.sin(a);
  for (let i = 0; i < 120; i++) {
    sim.update(DT);
    for (const e of sim.drainEvents()) if (e.type === 'break' && (e.kind === 'wall' || e.kind === 'guardrail')) { broke = true; if (hitStep < 0) hitStep = i; }
    const c = sim.cars[0];
    minAlong = Math.min(minAlong, c.vx * ux + c.vy * uy);
  }
  const c = sim.cars[0];
  return { sim, broke, v0, along: c.vx * ux + c.vy * uy, minAlong, health: c.health, speed: Math.hypot(c.vx, c.vy), hitStep };
}

describe('plow-through of broken static pieces', () => {
  it('a guardrail hit at 90 km/h breaks and the car keeps driving on instead of bouncing back', () => {
    const r = wallHit('guardrail', 90);
    expect(r.broke).toBe(true);
    expect(r.minAlong).toBeGreaterThan(0);               // never reverses along its original heading
    expect(r.along).toBeGreaterThan(r.v0 * 0.3);         // still clearly moving through the gap after a second
    expect(r.health).toBeGreaterThan(0.8);               // and the crash did not wreck it
  });

  it('130 km/h costs speed but no more than ~half of the health that the old bounce cost', () => {
    const r = wallHit('guardrail', 130);
    expect(r.broke).toBe(true);
    expect(r.minAlong).toBeGreaterThan(0);
    expect(r.health).toBeGreaterThan(0.7);
  });

  it('a corner wall (thicker, more hp) is also plowed through at high speed', () => {
    const r = wallHit('wall', 140);
    expect(r.broke).toBe(true);
    expect(r.minAlong).toBeGreaterThan(0);
  });

  it('a hit too weak to break the piece still bounces the car back', () => {
    const r = wallHit('guardrail', 25);
    expect(r.broke).toBe(false);
    expect(r.minAlong).toBeLessThan(0);
  });

  it('a harder break costs more damage than a gentler one (damage is still monotonic)', () => {
    const slow = wallHit('guardrail', 60), fast = wallHit('guardrail', 130);
    expect(fast.health).toBeLessThanOrEqual(slow.health);
  });

  function propHit(type: PropType, kmh: number) {
    const base = TRACKS[0];
    const g = buildTrackGeometry(base);
    // a straight stretch of 60 m for the run-up
    let s100 = -1;
    for (let i = 0; i < g.samples.length && s100 < 0; i++) {
      let ok = true;
      for (let k = 0; k < 60 && ok; k++) if (Math.abs(g.samples[(i + k) % g.samples.length].curvature) > 0.002) ok = false;
      if (ok) s100 = g.samples[i].s + 40;
    }
    const t = g.sampleAt(s100);
    const def: TrackDef = { ...base, props: [{ type, x: t.x, y: t.y, angle: 0 }] };
    const sim = solo(def);
    const a = Math.atan2(t.ty, t.tx);
    const s0 = g.sampleAt(s100 - 25);
    const car = sim.simCars[0];
    car.reset(s0.x, s0.y, a);
    car.body.setLinearVelocity({ x: Math.cos(a) * kmh / 3.6, y: Math.sin(a) * kmh / 3.6 });
    sim.setPlayerInput(IDLE);
    for (let i = 0; i < 120 * 3.2; i++) sim.update(DT);
    const prop = sim.destructibles.find((d) => d.kind === 'prop')!;
    const c = sim.cars[0];
    return { broken: prop.broken, health: c.health, along: c.vx * Math.cos(a) + c.vy * Math.sin(a), v0: kmh / 3.6 };
  }

  it('a sign (hp 25) breaks at 40 km/h and hardly slows or hurts the car; at 130 km/h it is cheap too', () => {
    const slow = propHit('sign', 40);
    expect(slow.broken).toBe(true);
    expect(slow.along).toBeGreaterThan(slow.v0 * 0.6);
    expect(slow.health).toBeGreaterThan(0.95);
    const fast = propHit('sign', 130);
    expect(fast.broken).toBe(true);
    expect(fast.health).toBeGreaterThan(0.9);
    expect(fast.along).toBeGreaterThan(fast.v0 * 0.55);
  });

  it('a tree that holds still stops the car (only pieces that break are plowed through)', () => {
    const r = propHit('tree', 40);
    expect(r.broken).toBe(false);
    expect(r.along).toBeLessThan(r.v0 * 0.2);
  });
});
