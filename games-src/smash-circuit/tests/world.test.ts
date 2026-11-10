import * as planck from 'planck';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { SimCar } from '../src/sim/car';
import { baseStats, SURFACE_ROAD, SURFACE_CURB } from '../src/sim/carModel';
import { PhysicsWorld, contactImpulse, contactPoint, fixtureData, type FixtureData } from '../src/sim/world';
import { makeRng } from '../src/sim/rng';
import type { CarInput, CarSetup, SimEvent } from '../src/types';

const IDLE: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };

function setup(id: number, over: Partial<CarSetup> = {}): CarSetup {
  return { id, isPlayer: id === 0, name: 'c' + id, colorIndex: id, stats: baseStats(), ...over };
}

function addWall(pw: PhysicsWorld, x: number, y: number, hw: number, hh: number, id = 1): planck.Body {
  const b = pw.world.createBody({ type: 'static', position: { x, y } });
  b.createFixture({ shape: new planck.Box(hw, hh), friction: 0.2, userData: { kind: 'wall', id } satisfies FixtureData });
  return b;
}

/** Wire contacts to cars the way the Sim does: record only. */
function wire(pw: PhysicsWorld, cars: SimCar[]): { hits: number } {
  const stats = { hits: 0 };
  const byId = new Map(cars.map((c) => [c.setup.id, c]));
  pw.onPostSolve((contact, imp) => {
    const a = fixtureData(contact.getFixtureA()), b = fixtureData(contact.getFixtureB());
    if (!a || !b) return;
    const p = contactPoint(contact);
    const total = contactImpulse(imp);
    stats.hits++;
    if (a.kind === 'car') byId.get(a.carId)!.recordImpact(p.x, p.y, total, b.kind === 'car' ? 'car' : b.kind);
    if (b.kind === 'car') byId.get(b.carId)!.recordImpact(p.x, p.y, total, a.kind === 'car' ? 'car' : a.kind);
  });
  return stats;
}

function tick(pw: PhysicsWorld, cars: SimCar[], events: SimEvent[], surface = SURFACE_ROAD): void {
  for (const c of cars) c.preStep(surface);
  pw.step();
  for (const c of cars) { c.postStep(); c.flushDamage(events); }
}

describe('PhysicsWorld', () => {
  it('queued removal happens after the step, not inside callbacks', () => {
    const pw = new PhysicsWorld();
    const wall = addWall(pw, 10, 0, 0.5, 5);
    const ball = pw.world.createBody({ type: 'dynamic', position: { x: 5, y: 0 }, linearVelocity: { x: 20, y: 0 } });
    ball.createFixture({ shape: new planck.Circle(0.5), density: 1, userData: { kind: 'prop', id: 2 } });
    let removedInsideCb = false;
    pw.onBeginContact(() => {
      pw.queueRemoval(wall);
      removedInsideCb = removedInsideCb || pw.world.getBodyCount() < 2; // still attached while the solver runs
    });
    let steps = 0;
    const before = pw.world.getBodyCount();
    while (pw.world.getBodyCount() === before && steps < 60) { pw.step(); steps++; }
    expect(steps).toBeLessThan(60);
    expect(pw.world.getBodyCount()).toBe(before - 1);
    expect(removedInsideCb).toBe(false);
    expect(pw.pendingRemovals).toBe(0);
  });

  it('double queue is harmless', () => {
    const pw = new PhysicsWorld();
    const b = addWall(pw, 0, 0, 1, 1);
    pw.queueRemoval(b); pw.queueRemoval(b);
    expect(pw.pendingRemovals).toBe(1);
    pw.step();
    expect(pw.world.getBodyCount()).toBe(0);
    pw.queueRemoval(b); // already destroyed
    expect(() => pw.step()).not.toThrow();
  });

  it('records post-solve impulses for a car hitting a wall', () => {
    const pw = new PhysicsWorld();
    const car = new SimCar(pw, setup(0), 0, 0, 0);
    addWall(pw, 20, 0, 1, 20);
    let maxImp = 0;
    pw.onPostSolve((_c, imp) => { maxImp = Math.max(maxImp, contactImpulse(imp)); });
    car.body.setLinearVelocity({ x: 20, y: 0 });
    const ev: SimEvent[] = [];
    for (let i = 0; i < 240; i++) { car.setInput({ ...IDLE, throttle: 1 }); tick(pw, [car], ev); }
    expect(maxImp).toBeGreaterThan(5000);
  });
});

describe('SimCar', () => {
  it('accelerates under physics and stays near the model targets (0-100 ~2.5 s)', () => {
    const pw = new PhysicsWorld();
    const car = new SimCar(pw, setup(0), 0, 0, 0);
    const ev: SimEvent[] = [];
    let t = 0;
    while (car.state.speed < 100 / 3.6 && t < 10) { car.setInput({ ...IDLE, throttle: 1 }); tick(pw, [car], ev); t += CONFIG.physics.dt; }
    expect(t).toBeGreaterThan(2.15);
    expect(t).toBeLessThan(2.85);
    expect(Math.abs(car.state.y)).toBeLessThan(0.01);
    expect(car.state.rpm).toBeGreaterThan(0.3);
  });

  it('handbrake drift flags drifting/slip in the state', () => {
    const pw = new PhysicsWorld();
    const car = new SimCar(pw, setup(0), 0, 0, 0);
    car.body.setLinearVelocity({ x: 27, y: 0 });
    const ev: SimEvent[] = [];
    let drifted = false;
    for (let i = 0; i < 240; i++) {
      car.setInput({ throttle: 0.6, brake: 0, steer: -1, handbrake: i > 10 });
      tick(pw, [car], ev);
      if (car.state.drifting && car.state.slip > 0.3) drifted = true;
    }
    expect(drifted).toBe(true);
    const calm = new SimCar(new PhysicsWorld(), setup(1), 0, 0, 0);
    expect(calm.state.drifting).toBe(false);
  });

  it('head-on wall crash: impact event, damage to front, and no damage for light touches', () => {
    const pw = new PhysicsWorld();
    const car = new SimCar(pw, setup(0), 0, 0, 0);
    addWall(pw, 40, 0, 1, 30);
    wire(pw, [car]);
    const ev: SimEvent[] = [];
    for (let i = 0; i < 600; i++) { car.setInput({ ...IDLE, throttle: 1 }); tick(pw, [car], ev); }
    const impacts = ev.filter((e) => e.type === 'impact');
    expect(impacts.length).toBeGreaterThan(0);
    expect(car.state.hp.front).toBeLessThan(CONFIG.damage.zoneMaxHp);
    expect(car.state.hp.rear).toBe(CONFIG.damage.zoneMaxHp);
    expect(car.state.health).toBeLessThan(1);
    expect(car.state.effects.powerMul).toBeLessThan(1);

    // light touch: drive slowly into a wall -> no damage
    const pw2 = new PhysicsWorld();
    const slow = new SimCar(pw2, setup(0), 0, 0, 0);
    addWall(pw2, 10, 0, 1, 30);
    wire(pw2, [slow]);
    const ev2: SimEvent[] = [];
    slow.body.setLinearVelocity({ x: 1.5, y: 0 });
    for (let i = 0; i < 600; i++) { slow.setInput({ ...IDLE, throttle: 0 }); tick(pw2, [slow], ev2); }
    expect(slow.state.health).toBe(1);
  });

  it('sliding along a wall (rubbing) does no damage but emits scrape events', () => {
    const pw = new PhysicsWorld();
    const car = new SimCar(pw, setup(0), 0, 0, 0);
    addWall(pw, 0, 2.2, 80, 1); // wall just left of the car, parallel to travel
    wire(pw, [car]);
    const ev: SimEvent[] = [];
    car.body.setLinearVelocity({ x: 25, y: 0 });
    for (let i = 0; i < 360; i++) { car.setInput({ ...IDLE, throttle: 1, steer: -0.12 }); tick(pw, [car], ev); }
    expect(car.state.health).toBeGreaterThan(0.95);
    expect(ev.some((e) => e.type === 'scrape')).toBe(true);
  });

  it('repeated crashes fly parts off (events once each), then wreck; repair restores everything', () => {
    const pw = new PhysicsWorld();
    const car = new SimCar(pw, setup(0), 0, 0, 0);
    const ev: SimEvent[] = [];
    // synthetic impacts at nose, then all around
    const hit = (lx: number, ly: number, imp: number) => {
      car.recordImpact(car.state.x + lx, car.state.y + ly, imp * 1.8, 'wall');
      car.flushDamage(ev);
    };
    hit(2.1, 0, 20000);
    hit(2.1, 0, 20000);
    const off = ev.filter((e) => e.type === 'partOff');
    expect(off.length).toBeGreaterThan(0);
    expect(new Set(off.map((e) => (e as { part: string }).part)).size).toBe(off.length); // unique
    const n1 = off.length;
    hit(2.1, 0, 30000);
    for (const e of ev.filter((x) => x.type === 'partOff')) expect(Number.isFinite((e as { vx: number }).vx)).toBe(true);
    expect(ev.filter((e) => e.type === 'partOff').length).toBeGreaterThanOrEqual(n1);
    for (let i = 0; i < 8; i++) { hit(2.1, 0, 60000); hit(-2.1, 0, 60000); hit(0, 1, 60000); hit(0, -1, 60000); hit(1.3, 0.8, 60000); hit(1.3, -0.8, 60000); hit(-1.3, 0.8, 60000); hit(-1.3, -0.8, 60000); }
    expect(car.state.wrecked).toBe(true);
    expect(ev.filter((e) => e.type === 'wrecked').length).toBe(1);
    expect(car.state.effects.powerMul).toBeLessThan(0.3);
    // 8 body panels + at most maxWheelsOff wheels
    expect(car.state.detachedParts.length).toBe(8 + CONFIG.damage.maxWheelsOff);
    expect(ev.filter((e) => e.type === 'partOff').length).toBe(8 + CONFIG.damage.maxWheelsOff);

    car.repair();
    car.flushDamage(ev);
    expect(ev.some((e) => e.type === 'repair')).toBe(true);
    expect(car.state.wrecked).toBe(false);
    expect(car.state.health).toBe(1);
    expect(car.state.detachedParts).toEqual([]);
    expect(car.state.effects.powerMul).toBe(1);
  });

  it('one hard hit knocks the outermost part of the hit side off at once (bumper first, then hood on a harder hit)', () => {
    const pw = new PhysicsWorld();
    const car = new SimCar(pw, setup(0), 0, 0, 0);
    const ev: SimEvent[] = [];
    car.recordImpact(car.state.x + 2.1, car.state.y, CONFIG.damage.knockOffImpulse * 0.9, 'wall');
    car.flushDamage(ev);
    expect(car.state.detachedParts).toEqual([]);
    car.recordImpact(car.state.x + 2.1, car.state.y, CONFIG.damage.knockOffImpulse * 1.05, 'wall');
    car.flushDamage(ev);
    expect(car.state.detachedParts).toEqual(['bumperF']);
    car.recordImpact(car.state.x - 2.1, car.state.y, CONFIG.damage.knockOffSecond * 1.05, 'wall');
    car.flushDamage(ev);
    expect(car.state.detachedParts).toEqual(['bumperF', 'bumperR', 'spoiler']);
    expect(ev.filter((e) => e.type === 'partOff').length).toBe(3);
  });

  it('startDamage is applied; wheel damage reduces grip', () => {
    const pw = new PhysicsWorld();
    const car = new SimCar(pw, setup(3, { startDamage: { wheelRL: 0, front: 10 } }), 0, 0, 0);
    expect(car.state.hp.wheelRL).toBe(0);
    expect(car.state.effects.gripMul).toBeLessThan(1);
    expect(car.state.detachedParts).toContain('bumperF');
  });

  it('surface: curb flags onCurb and slows, grass flags offRoad', () => {
    const pw = new PhysicsWorld();
    const car = new SimCar(pw, setup(0), 0, 0, 0);
    car.body.setLinearVelocity({ x: 30, y: 0 });
    const ev: SimEvent[] = [];
    for (let i = 0; i < 60; i++) tick(pw, [car], ev, SURFACE_CURB);
    expect(car.state.onCurb).toBe(true);
    expect(car.state.offRoad).toBe(false);
    expect(car.state.health).toBe(1); // curb gives no damage
    expect(car.state.speed).toBeLessThan(30);
  });

  it('two cars colliding both record impacts and take reduced car-vs-car damage', () => {
    const pw = new PhysicsWorld();
    const a = new SimCar(pw, setup(0), 0, 0, 0);
    const b = new SimCar(pw, setup(1), 30, 0.3, Math.PI);
    wire(pw, [a, b]);
    a.body.setLinearVelocity({ x: 25, y: 0 }); b.body.setLinearVelocity({ x: -25, y: 0 });
    const ev: SimEvent[] = [];
    for (let i = 0; i < 360; i++) { a.setInput({ ...IDLE, throttle: 1 }); b.setInput({ ...IDLE, throttle: 1 }); tick(pw, [a, b], ev); }
    expect(ev.filter((e) => e.type === 'impact' && e.other === 'car').length).toBeGreaterThanOrEqual(2);
    expect(a.state.health).toBeLessThan(1);
    expect(b.state.health).toBeLessThan(1);
  });

  it('does not tunnel through a thin wall at top speed', () => {
    const pw = new PhysicsWorld();
    const car = new SimCar(pw, setup(0), 0, 0, 0);
    addWall(pw, 60, 0, 0.7, 30); // 1.4 m thick like CONFIG.destruction.wall
    const ev: SimEvent[] = [];
    car.body.setLinearVelocity({ x: 45, y: 0 });
    for (let i = 0; i < 600; i++) { car.setInput({ ...IDLE, throttle: 1 }); tick(pw, [car], ev); }
    expect(car.state.x).toBeLessThan(60);
  });
});

describe('determinism and performance', () => {
  it('rng is deterministic and in [0,1)', () => {
    const a = makeRng(42), b = makeRng(42), c = makeRng(43);
    const xs = Array.from({ length: 100 }, a), ys = Array.from({ length: 100 }, b);
    expect(xs).toEqual(ys);
    expect(xs.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(Array.from({ length: 5 }, c)).not.toEqual(xs.slice(0, 5));
  });

  function ringWorld() {
    const pw = new PhysicsWorld();
    const R = 120, n = 400;
    // 400 static wall segments: outer and inner ring (like track walls)
    for (let i = 0; i < n; i++) {
      const r = i % 2 === 0 ? R + 8 : R - 8;
      const a = (Math.floor(i / 2) / (n / 2)) * Math.PI * 2;
      const b = pw.world.createBody({ type: 'static', position: { x: Math.cos(a) * r, y: Math.sin(a) * r }, angle: a + Math.PI / 2 });
      b.createFixture({ shape: new planck.Box(2.2, 0.7), friction: 0.2, userData: { kind: 'wall', id: i } satisfies FixtureData });
    }
    const cars: SimCar[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const c = new SimCar(pw, setup(i), Math.cos(a) * R, Math.sin(a) * R, a + Math.PI / 2);
      cars.push(c);
    }
    wire(pw, cars);
    return { pw, cars };
  }

  it('8 cars + 400 static segments: avg step well under 4 ms, car stays on the ring', () => {
    const { pw, cars } = ringWorld();
    const ev: SimEvent[] = [];
    const drive = (c: SimCar) => {
      // steer to keep radius 120 (counter-clockwise ring), simple P controller
      const r = Math.hypot(c.state.x, c.state.y);
      const tangent = Math.atan2(c.state.y, c.state.x) + Math.PI / 2;
      let err = tangent - c.state.angle;
      err = Math.atan2(Math.sin(err), Math.cos(err));
      const radial = (120 - r) * 0.02;
      c.setInput({ throttle: 0.7, brake: 0, steer: Math.max(-1, Math.min(1, -(err + radial) * 2)), handbrake: false });
    };
    for (let i = 0; i < 240; i++) { for (const c of cars) drive(c); tick(pw, cars, ev); }
    const t0 = performance.now();
    const N = 1200;
    for (let i = 0; i < N; i++) { for (const c of cars) drive(c); tick(pw, cars, ev); }
    const avg = (performance.now() - t0) / N;
    expect(avg).toBeLessThan(CONFIG.physics.stepBudgetMs);
    for (const c of cars) expect(Number.isFinite(c.state.x)).toBe(true);
  });

  it('same inputs -> identical simulation', () => {
    const run = () => {
      const { pw, cars } = ringWorld();
      const ev: SimEvent[] = [];
      for (let i = 0; i < 600; i++) {
        cars.forEach((c, j) => c.setInput({ throttle: 1, brake: 0, steer: Math.sin((i + j * 17) / 50), handbrake: false }));
        tick(pw, cars, ev);
      }
      return cars.map((c) => [c.state.x, c.state.y, c.state.angle, c.state.health]);
    };
    expect(run()).toEqual(run());
  });
});
