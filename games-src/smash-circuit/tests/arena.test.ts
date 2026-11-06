import { describe, expect, it } from 'vitest';
import { ARENA, ARENA_TRACK, ArenaMatch, HuntDriver, attachArena, stepArena } from '../src/sim/arena';
import { baseStats } from '../src/sim/carModel';
import { Sim } from '../src/sim/sim';
import type { CarSetup, CarState } from '../src/types';

function setup(id: number, isPlayer = false): CarSetup {
  return { id, isPlayer, name: 'c' + id, colorIndex: id, stats: baseStats() };
}

function car(id: number, x: number, y: number, over: Partial<CarState> = {}): CarState {
  return { id, isPlayer: false, x, y, angle: 0, vx: 0, vy: 0, speed: 0, health: 1, wrecked: false, ...over } as CarState;
}

function view(cars: CarState[], broken = 0) {
  return { cars, race: { phase: 'racing' }, brokenByPlayer: broken };
}

describe('Demolition Arena: scoring', () => {
  it('scores damage the player deals, props and wrecks, with a combo multiplier', () => {
    const m = new ArenaMatch(90);
    const p = car(0, 0, 0, { isPlayer: true });
    const r = car(1, 3, 0);
    const v = view([p, r, car(2, 40, 40)]);
    m.update(v, 0.1);
    expect(m.score).toBe(0);
    r.health = 0.8;               // player rammed it: 0.2 of a car
    m.update(v, 0.1);
    expect(m.damageDealt).toBeCloseTo(0.2, 5);
    expect(m.score).toBe(Math.round(0.2 * ARENA.dmgPoints));
    expect(m.combo).toBe(1);
    // a second hit inside the combo window is worth more
    m.update(v, 0.5);
    r.health = 0.6;
    m.update(v, 0.1);
    expect(m.combo).toBe(2);
    expect(m.score).toBe(Math.round(0.2 * ARENA.dmgPoints) + Math.round(0.2 * ARENA.dmgPoints * 2));
    // props smashed by the player
    const before = m.score;
    v.brokenByPlayer = 2;
    m.update(v, 0.5);
    expect(m.props).toBe(2);
    expect(m.score).toBeGreaterThan(before);
    // wreck credit
    r.health = 0.05; r.wrecked = true;
    m.update(v, 0.5);
    expect(m.wrecks).toBe(1);
    expect(m.dead.has(1)).toBe(true);
    expect(m.coins()).toBe(Math.round(m.score * ARENA.coinsPerPoint));
  });

  it('damage between two AI cars far from the player scores nothing; combo resets after the window', () => {
    const m = new ArenaMatch(90);
    const p = car(0, 0, 0, { isPlayer: true });
    const a = car(1, 50, 0), b = car(2, 53, 0);
    const v = view([p, a, b]);
    m.update(v, 0.1);
    a.health = 0.5;
    m.update(v, 0.1);
    expect(m.score).toBe(0);
    m.addScore('prop', 10);
    m.update(v, ARENA.comboWindow + 0.1);
    expect(m.combo).toBe(1);
  });
});

describe('Demolition Arena: round end', () => {
  it('ends on time', () => {
    const m = new ArenaMatch(5);
    const v = view([car(0, 0, 0, { isPlayer: true }), car(1, 30, 0)]);
    for (let i = 0; i < 49 && !m.ended; i++) m.update(v, 0.1);
    expect(m.ended).toBeNull();
    m.update(v, 0.2);
    expect(m.ended).toBe('time');
  });

  it('ends when the player is the last car standing, or when the player is wrecked', () => {
    const m = new ArenaMatch(90);
    const r = car(1, 30, 0);
    const v = view([car(0, 0, 0, { isPlayer: true }), r]);
    m.update(v, 0.1);
    r.wrecked = true;
    m.update(v, 0.1);
    expect(m.ended).toBe('lastStanding');

    const m2 = new ArenaMatch(90);
    const p2 = car(0, 0, 0, { isPlayer: true });
    const v2 = view([p2, car(1, 30, 0)]);
    m2.update(v2, 0.1);
    p2.wrecked = true;
    m2.update(v2, 0.1);
    expect(m2.ended).toBe('wrecked');
  });

  it('does not run the clock during the countdown', () => {
    const m = new ArenaMatch(90);
    m.update({ cars: [car(0, 0, 0, { isPlayer: true })], race: { phase: 'countdown' }, brokenByPlayer: 0 }, 1);
    expect(m.time).toBe(0);
  });
});

describe('Demolition Arena: hunt AI', () => {
  it('picks the nearest / weakest live car', () => {
    const me = car(1, 0, 0);
    const near = car(2, 10, 0), weakFar = car(3, 14, 0, { health: 0.1 }), dead = car(4, 2, 0);
    const pick = HuntDriver.pick(me, [me, near, weakFar, dead], (c) => c.id !== 4);
    expect(pick?.id).toBe(3);
    expect(HuntDriver.pick(me, [me, near], () => true)?.id).toBe(2);
  });

  it('steers at the target and throttles', () => {
    const d = new HuntDriver();
    const me = car(1, 0, 0, { angle: 0 });
    const out = d.think(me, [me, car(2, 0, 20)], 1 / 120, () => true);
    expect(d.targetId).toBe(2);
    expect(out.throttle).toBeGreaterThan(0.5);
    expect(out.steer).toBeGreaterThan(0.5);   // target is to the left (+y)
  });

  it('backs off when stuck and retries', () => {
    const d = new HuntDriver();
    const me = car(1, 0, 0);
    const cars = [me, car(2, 20, 0)];
    let reversed = false;
    for (let i = 0; i < 240; i++) if (d.think(me, cars, 1 / 120, () => true).brake > 0.5) reversed = true;
    expect(reversed).toBe(true);
  });

  it('in a headless arena sim the hunters make contact and deal damage', () => {
    const cars = [setup(0), setup(1), setup(2), setup(3)];
    const sim = new Sim({ track: ARENA_TRACK, cars, seed: 7, laps: 99 });
    const match = new ArenaMatch(90);
    const drivers = attachArena(sim, match);
    const dt = 1 / 30;
    let minGap = Infinity;
    for (let t = 0; t < 14; t += dt) {
      sim.update(dt);
      sim.drainEvents();
      stepArena(sim, match, dt);
      if (sim.race.phase === 'racing') {
        for (let i = 0; i < sim.cars.length; i++) for (let j = i + 1; j < sim.cars.length; j++) {
          minGap = Math.min(minGap, Math.hypot(sim.cars[i].x - sim.cars[j].x, sim.cars[i].y - sim.cars[j].y));
        }
      }
    }
    expect(drivers.some((d) => d.targetId >= 0)).toBe(true);
    expect(minGap).toBeLessThan(5);
    const lost = sim.cars.reduce((s, c) => s + (1 - c.health), 0);
    expect(lost).toBeGreaterThan(0.05);
    console.log('arena headless: minGap', minGap.toFixed(2), 'lost', lost.toFixed(3), 'score', match.score);
    sim.dispose();
  }, 60000);
});
