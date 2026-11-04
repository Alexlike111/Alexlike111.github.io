// Impact layer and crash state (audit #13, P1 / P2): what a collision does to a car is kept apart from the arcade model,
// so the tyres neither turn a broadside shove into forward speed nor damp a spin out within a fraction of a second.
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { SURFACE_ROAD, baseStats } from '../src/sim/carModel';
import { SimCar } from '../src/sim/car';
import { Sim } from '../src/sim/sim';
import { PhysicsWorld, contactImpulse, contactPoint, fixtureData } from '../src/sim/world';
import { TRACKS } from '../src/track/tracks';
import type { CarInput, SimEvent } from '../src/types';

const DT = CONFIG.physics.dt;
const IDLE: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };

function solo(): { sim: Sim; s: number } {
  const sim = new Sim({ track: TRACKS[0], cars: [{ id: 0, isPlayer: true, name: 'p', colorIndex: 0, stats: baseStats() }], seed: 1, powerUps: false });
  sim.playerAssist = false;
  for (let i = 0; i < 120 * 4; i++) sim.update(DT);
  sim.drainEvents();
  const S = sim.track.samples;
  for (let i = 0; i < S.length; i++) {
    let ok = true;
    for (let k = 0; k < 60 && ok; k++) if (Math.abs(S[(i + k) % S.length].curvature) > 0.002) ok = false;
    if (ok) return { sim, s: S[(i + 10) % S.length].s };
  }
  throw new Error('no straight');
}

/** Two bare SimCars in an empty world, wired like the Sim (car-car contacts recorded as impacts). */
function duel(bx: number, by: number, bAngle: number, bSpeed: number) {
  const pw = new PhysicsWorld();
  const a = new SimCar(pw, { id: 0, isPlayer: true, name: 'a', colorIndex: 0, stats: baseStats() }, 0, 0, 0);
  const b = new SimCar(pw, { id: 1, isPlayer: false, name: 'b', colorIndex: 1, stats: baseStats() }, bx, by, bAngle);
  const cars = [a, b];
  pw.onPostSolve((c, imp) => {
    const da = fixtureData(c.getFixtureA()), db = fixtureData(c.getFixtureB());
    if (!da || !db || da.kind !== 'car' || db.kind !== 'car') return;
    const p = contactPoint(c), t = contactImpulse(imp);
    cars[da.carId].recordImpact(p.x, p.y, t, 'car');
    cars[db.carId].recordImpact(p.x, p.y, t, 'car');
  });
  b.body.setLinearVelocity({ x: Math.cos(bAngle) * bSpeed, y: Math.sin(bAngle) * bSpeed });
  let touched = false;
  const ev: SimEvent[] = [];
  const step = (): void => {
    a.setInput(IDLE);
    b.setInput(touched ? { ...IDLE, brake: 1 } : { ...IDLE, throttle: 0.2 });
    a.preStep(SURFACE_ROAD, DT); b.preStep(SURFACE_ROAD, DT);
    pw.step();
    a.postStep(); b.postStep();
    a.flushDamage(ev); b.flushDamage(ev);
    if (ev.some((e) => e.type === 'impact')) touched = true;
  };
  return { a, b, step, touched: () => touched };
}

describe('impact layer', () => {
  it('a standing car rammed broadside slides sideways and does not drive off forward or backward (P1)', () => {
    const d = duel(0, -5, Math.PI / 2, 10);      // b comes from the right, square into a's side
    let t = 0;
    while (!d.touched() && t < 2) { d.step(); t += DT; }
    expect(d.touched()).toBe(true);
    d.step();
    const shove = Math.abs(d.a.state.vy);         // a's sideways speed right after the hit
    expect(shove).toBeGreaterThan(2);
    let maxFwd = 0;
    for (let i = 0; i < 120; i++) { d.step(); maxFwd = Math.max(maxFwd, Math.abs(d.a.state.speed)); }
    expect(maxFwd).toBeLessThan(0.2 * shove);
    expect(Math.abs(d.a.state.x)).toBeLessThan(0.3);   // no travel along the nose
    expect(d.a.state.y).toBeGreaterThan(0.5);           // it slid the way it was pushed
  });

  it('a hit on the rear quarter spins the car much further than yaw damping alone allowed (P2), and the spin dies out', () => {
    const IM = CONFIG.car.impact as { minDw: number };
    const spin = (layer: boolean): { turned: number; w: number } => {
      const keep = IM.minDw;
      if (!layer) IM.minDw = 1e9;
      try {
        const d = duel(-1.6, -5, Math.PI / 2, 12);     // into the rear corner
        for (let i = 0; i < 180; i++) d.step();
        return { turned: Math.abs(d.a.state.angle) * 180 / Math.PI, w: Math.abs(d.a.state.angularVel) };
      } finally { IM.minDw = keep; }
    };
    const on = spin(true), off = spin(false);
    expect(on.turned).toBeGreaterThan(10);
    expect(on.turned).toBeGreaterThan(off.turned * 2);
    expect(on.w).toBeLessThan(0.2);
  });

  it("boost kicks are the car's own speed: not an impact", () => {
    const { sim, s } = solo();
    const t = sim.track.sampleAt(s), a = Math.atan2(t.ty, t.tx);
    sim.simCars[0].reset(t.x, t.y, a);
    sim.simCars[0].body.setLinearVelocity({ x: Math.cos(a) * 20, y: Math.sin(a) * 20 });
    sim.setPlayerInput(IDLE);
    sim.update(DT);
    // a sideways "boost" would normally be swung onto the nose by the tyres; as a boost it is the car's own speed
    sim.simCars[0].kick(-Math.sin(a) * 4, Math.cos(a) * 4);
    for (let i = 0; i < 60; i++) sim.update(DT);
    const c = sim.cars[0];
    const lat = -c.vx * Math.sin(c.angle) + c.vy * Math.cos(c.angle);
    expect(Math.abs(lat)).toBeLessThan(0.5);
  });

  it('a heavy wall hit starts a short crash state (steering suspended), a light one does not', () => {
    const { sim, s } = solo();
    const half = sim.track.def.width / 2;
    const t = sim.track.sampleAt(s - 10), a = Math.atan2(t.ty, t.tx) + Math.PI / 2;      // square into the left barrier
    const car = sim.simCars[0];
    const crashMax = (kmh: number): number => {
      car.repair();
      car.reset(t.x + t.nx * (half - 3), t.y + t.ny * (half - 3), a);
      car.body.setLinearVelocity({ x: Math.cos(a) * kmh / 3.6, y: Math.sin(a) * kmh / 3.6 });
      let m = 0;
      for (let i = 0; i < 90; i++) { sim.setPlayerInput({ ...IDLE, steer: 1 }); sim.update(DT); m = Math.max(m, car.crashTime); }
      sim.drainEvents();
      return m;
    };
    expect(crashMax(15)).toBe(0);
    const m = crashMax(70);
    expect(m).toBeGreaterThan(CONFIG.car.impact.crashTime[0] - 0.02);
    expect(m).toBeLessThanOrEqual(CONFIG.car.impact.crashTime[1] + 1e-9);
  });
});
