// Impact layer and crash state (audit #13, P1 / P2): what a collision does to a car is kept apart from the arcade model,
// so the tyres neither turn a broadside shove into forward speed nor damp a spin out within a fraction of a second.
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { baseStats } from '../src/sim/carModel';
import { Sim } from '../src/sim/sim';
import { TRACKS } from '../src/track/tracks';
import type { CarInput } from '../src/types';

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

/** What a solver hit does between two steps: change the body's velocity / spin (the impact layer sees it at the next preStep). */
function hit(sim: Sim, dvLat: number, dw = 0): void {
  const b = sim.simCars[0].body, a = b.getAngle(), v = b.getLinearVelocity();
  b.setLinearVelocity({ x: v.x - Math.sin(a) * dvLat, y: v.y + Math.cos(a) * dvLat });
  b.setAngularVelocity(b.getAngularVelocity() + dw);
}

describe('impact layer', () => {
  for (const shove of [5, 10]) {
    it(`a standing car shoved broadside at ${shove} m/s slides sideways and does not drive off forward or backward`, () => {
      const { sim, s } = solo();
      const t = sim.track.sampleAt(s), a = Math.atan2(t.ty, t.tx);
      sim.simCars[0].reset(t.x, t.y, a);
      sim.setPlayerInput(IDLE);
      sim.update(DT);
      hit(sim, shove);
      for (let i = 0; i < 120; i++) sim.update(DT);
      const c = sim.cars[0];
      const fwd = c.vx * Math.cos(c.angle) + c.vy * Math.sin(c.angle);
      expect(Math.abs(fwd)).toBeLessThan(0.2 * shove);
      const dx = c.x - t.x, dy = c.y - t.y;
      expect(Math.abs(dx * Math.cos(a) + dy * Math.sin(a))).toBeLessThan(0.3);     // no travel along the nose
      expect(-dx * Math.sin(a) + dy * Math.cos(a)).toBeGreaterThan(0.3);            // it did slide the way it was pushed
    });
  }

  it('a spin kick at 20 m/s turns the car well past what yaw damping alone allowed (4 deg), and dies out', () => {
    const { sim, s } = solo();
    const t = sim.track.sampleAt(s), a = Math.atan2(t.ty, t.tx);
    sim.simCars[0].reset(t.x, t.y, a);
    sim.simCars[0].body.setLinearVelocity({ x: Math.cos(a) * 20, y: Math.sin(a) * 20 });
    sim.setPlayerInput({ ...IDLE, throttle: 0.5 });
    sim.update(DT);
    const a0 = sim.cars[0].angle;
    hit(sim, 0, 1.3);
    for (let i = 0; i < 120; i++) sim.update(DT);
    const turned = Math.abs(sim.cars[0].angle - a0) * 180 / Math.PI;
    expect(turned).toBeGreaterThan(15);
    expect(turned).toBeLessThan(60);
    expect(Math.abs(sim.cars[0].angularVel)).toBeLessThan(0.1);
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
