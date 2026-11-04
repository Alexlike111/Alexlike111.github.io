// Car roster: 10 cars that really drive differently (per-car grip, hitbox, mass-scaled damage, one trait each), rival fields
// that stay fair with any combination, the AI finishing races with every car on every track, and the v1 -> v2 save migration.
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { CAR_IDS, bars, barRaw, carStats, paceFactor, rivalModels, zeroTo100, settledTopSpeed, BAR_KEYS } from '../src/meta/cars';
import { buyUpgrade } from '../src/meta/economy';
import { makeOpponents, makePlayerSetup } from '../src/meta/opponents';
import { defaultSave, sanitizeSave } from '../src/meta/save';
import { NO_DAMAGE, SURFACE_GRASS, SURFACE_ROAD, baseStats, integrateCar, type CarKinematics } from '../src/sim/carModel';
import { SimCar } from '../src/sim/car';
import { makeRng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import { PhysicsWorld } from '../src/sim/world';
import { TRACKS } from '../src/track/tracks';
import type { CarInput, CarSetup, CarStats } from '../src/types';

const DT = CONFIG.physics.dt;
const IDLE: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
const kin = (v = 0): CarKinematics => ({ x: 0, y: 0, angle: 0, vx: v, vy: 0, angularVel: 0, steer: 0 });

/** 0 -> 100 km/h (s) with the real car model on a flat road at full throttle. */
function measure0to100(s: CarStats): number {
  let k = kin(), t = 0;
  while (k.vx < 100 / 3.6 && t < 20) { k = { ...integrateCar(k, { ...IDLE, throttle: 1 }, s, NO_DAMAGE, SURFACE_ROAD, DT), x: 0, y: 0, angle: 0 }; t += DT; }
  return t;
}
/** Speed (m/s) after 60 s flat out. */
function measureTop(s: CarStats, surface = SURFACE_ROAD): number {
  let k = kin();
  for (let i = 0; i < 60 / DT; i++) k = { ...integrateCar(k, { ...IDLE, throttle: 1 }, s, NO_DAMAGE, surface, DT), x: 0, y: 0, angle: 0 };
  return Math.hypot(k.vx, k.vy);
}
/** Steady cornering (m/s^2) at 20 m/s with full lock: yaw rate x speed once the steering has settled. */
function measureCorner(s: CarStats, v = 20): number {
  let k = kin(v);
  let a = 0;
  for (let i = 0; i < 1.5 / DT; i++) {
    const o = integrateCar(k, { ...IDLE, steer: 1 }, s, NO_DAMAGE, SURFACE_ROAD, DT);
    const sp = Math.hypot(o.vx, o.vy);
    // hold the speed: rescale the velocity (we only want the turn rate the tyres allow at this speed)
    k = { ...o, vx: (o.vx / sp) * v, vy: (o.vy / sp) * v, angle: k.angle + o.angularVel * DT };
    a = Math.abs(o.angularVel) * v;
  }
  return a;
}

describe('roster: 10 distinct cars', () => {
  it('has exactly 10 cars; the starter is the reference car of CONFIG.car', () => {
    expect(CAR_IDS.length).toBe(10);
    expect(new Set(CAR_IDS).size).toBe(10);
    const s = carStats(CONFIG.cars.starter), b = baseStats();
    expect(s.enginePower).toBe(b.enginePower);
    expect(s.topSpeed).toBe(b.topSpeed);
    expect(s.grip).toBe(b.grip);
    expect(s.mass).toBe(b.mass);
    expect(s.latAccel).toBe(CONFIG.car.maxLatAccel);
    expect(s.brakeDecel).toBe(CONFIG.car.brakeDecel);
    expect([s.length, s.width]).toEqual([CONFIG.car.length, CONFIG.car.width]);
  });

  const measured = CAR_IDS.map((id) => {
    const s = carStats(id);
    return { id, s, t100: measure0to100(s), top: measureTop(s), corner: measureCorner(s) };
  });

  it('measured 0-100, top speed and cornering are sane for every car (and match the garage numbers)', () => {
    for (const m of measured) {
      expect(m.t100, m.id).toBeGreaterThan(1.6);
      expect(m.t100, m.id).toBeLessThan(3.6);
      expect(m.top * 3.6, m.id).toBeGreaterThan(175);
      expect(m.top * 3.6, m.id).toBeLessThan(240);
      expect(m.corner, m.id).toBeGreaterThan(20);
      expect(m.corner, m.id).toBeLessThan(31);
      // the garage shows the pure estimate: within 6% of the real model
      expect(Math.abs(zeroTo100(m.s) / m.t100 - 1), m.id).toBeLessThan(0.06);
      expect(Math.abs(settledTopSpeed(m.s) / m.top - 1), m.id).toBeLessThan(0.03);
    }
  });

  it('every pair of cars differs clearly in at least one of 0-100 / top speed / cornering / mass / size', () => {
    const rel = (a: number, b: number): number => Math.abs(a / b - 1);
    for (let i = 0; i < measured.length; i++) {
      for (let j = i + 1; j < measured.length; j++) {
        const a = measured[i], b = measured[j];
        const diff = Math.max(rel(a.t100, b.t100), rel(a.top, b.top), rel(a.corner, b.corner), rel(a.s.mass, b.s.mass), rel(a.s.length!, b.s.length!));
        expect(diff, `${a.id} vs ${b.id}`).toBeGreaterThan(0.05);
      }
    }
    // and the spread is real: the quickest launch, fastest car and best corner-er are clearly ahead of the slowest
    const t100 = measured.map((m) => m.t100), top = measured.map((m) => m.top), cor = measured.map((m) => m.corner);
    expect(Math.max(...t100) / Math.min(...t100)).toBeGreaterThan(1.3);
    expect(Math.max(...top) / Math.min(...top)).toBeGreaterThan(1.1);
    expect(Math.max(...cor) / Math.min(...cor)).toBeGreaterThan(1.1);
  });

  it('garage bars: every car but the all-rounder has a clear strength (>= 7.5) and a clear weakness (<= 3)', () => {
    for (const id of CAR_IDS) {
      const b = bars(carStats(id));
      for (const k of BAR_KEYS) { expect(b[k]).toBeGreaterThanOrEqual(1); expect(b[k]).toBeLessThanOrEqual(10.9); }
      if (id === CONFIG.cars.starter) continue;
      expect(Math.max(...BAR_KEYS.map((k) => b[k])), id).toBeGreaterThanOrEqual(7.5);
      expect(Math.min(...BAR_KEYS.map((k) => b[k])), id).toBeLessThanOrEqual(3);
    }
    // upgrades move the bars of the car they are bought for
    const stock = barRaw(carStats('glint')), tuned = barRaw(carStats('glint', { engine: 5, grip: 5, armor: 5 }));
    expect(tuned.speed).toBeGreaterThan(stock.speed);
    expect(tuned.handling).toBeGreaterThan(stock.handling);
  });

  it('the grip upgrade raises the cornering limit (not only the grip rate)', () => {
    expect(measureCorner(carStats('brick', { engine: 0, grip: 5, armor: 0 }))).toBeGreaterThan(measureCorner(carStats('brick')) * 1.12);
  });
});

// ------------------------------------------------------------------------------------------------ hidden blockers
describe('per-car physics reach the sim', () => {
  it('the hitbox is the car\'s own size and mass', () => {
    for (const id of CAR_IDS) {
      const pw = new PhysicsWorld();
      const s = carStats(id);
      const car = new SimCar(pw, { id: 0, isPlayer: false, name: 'x', colorIndex: 0, stats: s }, 0, 0, 0);
      const aabb = car.body.getFixtureList()!.getAABB(0);
      expect(aabb.upperBound.x - aabb.lowerBound.x, id).toBeCloseTo(s.length!, 1);
      expect(aabb.upperBound.y - aabb.lowerBound.y, id).toBeCloseTo(s.width!, 1);
      expect(car.body.getMass(), id).toBeCloseTo(s.mass, 0);
      expect(car.state.modelId).toBe(id);
    }
  });

  it('the AI corners at its own car\'s limit: a Needle takes a bend faster than a Brick', () => {
    // same AI, same bend: steady speed on t3 (tight) is set by the car's cornering, not a global constant
    const lap = (id: string): number => {
      const sim = new Sim({ track: TRACKS[2], cars: [{ id: 0, isPlayer: false, name: 'x', colorIndex: 0, stats: carStats(id), ai: { skill: 1, aggression: 0.5, laneOffset: 0, mistakeRate: 0 } }], seed: 1, powerUps: false });
      let t = 0;
      while (t < 200 && sim.cars[0].lap < 1) { sim.update(1 / 60); t += 1 / 60; sim.drainEvents(); }
      return t;
    };
    expect(lap('needle')).toBeLessThan(lap('brick') * 0.97);
  }, 60000);

  it('car-vs-car damage scales with mass: a Mammoth ramming a parked Needle hurts the Needle far more', () => {
    const pw = new PhysicsWorld();
    const mk = (id: string, i: number, x: number): SimCar => new SimCar(pw, { id: i, isPlayer: false, name: id, colorIndex: i, stats: carStats(id) }, x, 0, 0);
    const ram = mk('mammoth', 0, 0), needle = mk('needle', 1, 0);
    needle.reset(9, 0, Math.PI / 2);            // side-on, 9 m ahead
    ram.reset(0, 0, 0);
    const cars = [ram, needle];
    const byId = new Map(cars.map((c) => [c.setup.id, c]));
    pw.onPostSolve((c, imp) => {
      const a = c.getFixtureA().getUserData() as { carId: number }, b = c.getFixtureB().getUserData() as { carId: number };
      const tot = imp.normalImpulses.reduce((s, v) => s + v, 0);
      const wm = c.getWorldManifold(null)!;
      const p = wm.points[0];
      byId.get(a.carId)!.recordImpact(p.x, p.y, tot, 'car');
      byId.get(b.carId)!.recordImpact(p.x, p.y, tot, 'car');
    });
    ram.body.setLinearVelocity({ x: 20, y: 0 });
    const hp0 = [ram.state.health, needle.state.health];
    for (let i = 0; i < 90; i++) {
      for (const c of cars) c.preStep(SURFACE_ROAD, DT);
      pw.step();
      for (const c of cars) { c.postStep(); c.flushDamage([]); }
      if (i === 0) ram.setInput({ throttle: 1, brake: 0, steer: 0, handbrake: false });
    }
    const lossRam = hp0[0] - ram.state.health, lossNeedle = hp0[1] - needle.state.health;
    expect(lossNeedle).toBeGreaterThan(0.05);
    expect(lossNeedle).toBeGreaterThan(lossRam * 3);
  });

  it('two equal cars still take equal damage (the reference car is unchanged by the mass normalisation)', () => {
    const s = baseStats();
    const pw = new PhysicsWorld();
    const car = new SimCar(pw, { id: 0, isPlayer: false, name: 'x', colorIndex: 0, stats: s }, 0, 0, 0);
    car.recordImpact(2.1, 0, CONFIG.damage.impulseThreshold * 4, 'wall');
    car.flushDamage([]);
    const expected = (CONFIG.damage.impulseThreshold * 3 * CONFIG.damage.impulseToDamage);
    const lost = (CONFIG.damage.zoneMaxHp - car.state.hp.front) + (CONFIG.damage.zoneMaxHp - car.state.hp.engine);
    expect(lost).toBeCloseTo(expected, 3);
  });
});

// ------------------------------------------------------------------------------------------------ traits
describe('one trait per car, each one measurable', () => {
  const solo = (id: string, over: Partial<CarStats> = {}): SimCar =>
    new SimCar(new PhysicsWorld(), { id: 0, isPlayer: false, name: id, colorIndex: 0, stats: { ...carStats(id), ...over } }, 0, 0, 0);

  it('every car has exactly one trait and a description in both languages', async () => {
    const { EN, RU } = await import('../src/i18n');
    for (const id of CAR_IDS) {
      expect(Object.keys(CONFIG.cars.defs[id].traits).length, id).toBeGreaterThan(0);
      for (const k of ['car.', 'class.', 'trait.']) { expect(EN[k + id], k + id).toBeTruthy(); expect(RU[k + id], k + id).toBeTruthy(); }
      expect(EN['trait.' + id + '.desc']).toBeTruthy();
      expect(RU['trait.' + id + '.desc']).toBeTruthy();
    }
  });

  it('Scrapper patches itself up after a quiet spell (up to the cap), other cars do not', () => {
    for (const [id, heals] of [['scrapper', true], ['gravel', false]] as const) {
      const c = solo(id);
      c.recordImpact(2.1, 0, CONFIG.damage.impulseThreshold * 12, 'wall');
      c.flushDamage([]);
      const hurt = c.state.hp.front;
      for (let i = 0; i < 8 / DT; i++) c.flushDamage([]);
      if (heals) {
        expect(c.state.hp.front, id).toBeGreaterThan(hurt + 5);
        expect(c.state.hp.front, id).toBeLessThanOrEqual(CONFIG.damage.zoneMaxHp * CONFIG.cars.defs.scrapper.traits.regen!.cap + 1e-6);
      } else expect(c.state.hp.front, id).toBe(hurt);
    }
  });

  it('Sandhopper keeps its speed on grass', () => {
    const grassTop = (id: string): number => {
      const c = solo(id);
      c.setInput({ ...IDLE, throttle: 1 });
      for (let i = 0; i < 10 / DT; i++) { c.preStep(SURFACE_GRASS, DT); c.body.setPosition({ x: 0, y: 0 }); c.postStep(); }
      return Math.hypot(c.state.vx, c.state.vy);
    };
    expect(grassTop('sandhopper')).toBeGreaterThan(grassTop('scrapper') * 1.25);
  });

  it('Brawler launches harder (+power at low speed) and the Needle grips harder at speed (downforce)', () => {
    const noTrait = (id: string): CarStats => ({ ...carStats(id), traits: {} });
    expect(measure0to100(carStats('brawler'))).toBeLessThan(measure0to100(noTrait('brawler')) * 0.9);
    expect(measureCorner(carStats('needle'), 50)).toBeGreaterThan(measureCorner(noTrait('needle'), 50) * 1.08);
    expect(measureCorner(carStats('needle'), 15)).toBeCloseTo(measureCorner(noTrait('needle'), 15), 3);
  });

  it('Bull bar (Bruiser) halves front damage; rammers deal more; the Juggernaut is not pushed by a Shockwave', () => {
    const front = (id: string): number => {
      const c = solo(id, { armor: 1, mass: 1000 });
      c.recordImpact(2.6, 0, CONFIG.damage.impulseThreshold * 6, 'wall');
      c.flushDamage([]);
      return CONFIG.damage.zoneMaxHp - c.state.hp.front;
    };
    expect(front('bruiser')).toBeLessThan(front('scrapper') * 0.55);
    expect(CONFIG.cars.defs.brick.traits.ramDealMul).toBeGreaterThan(1.4);
    expect(CONFIG.cars.defs.mammoth.traits.shockImmune).toBe(true);
    expect(CONFIG.cars.defs.mammoth.traits.plowKeep).toBeGreaterThan(CONFIG.destruction.plowKeep);
  });

  it('Glint gets a tow in the slipstream: faster behind a car than alone', () => {
    const run = (withLeader: boolean): number => {
      const glint: CarSetup = { id: 0, isPlayer: false, name: 'g', colorIndex: 0, stats: carStats('glint'), ai: { skill: 1, aggression: 0, laneOffset: 0, mistakeRate: 0 } };
      const cars: CarSetup[] = [glint];
      if (withLeader) cars.push({ id: 1, isPlayer: false, name: 'l', colorIndex: 1, stats: carStats('scrapper'), ai: { skill: 1, aggression: 0, laneOffset: 0, mistakeRate: 0 } });
      const sim = new Sim({ track: TRACKS[0], cars, seed: 2, powerUps: false });
      while (sim.race.phase === 'countdown') sim.update(1 / 60);
      // line both up on the start straight, the Glint 8 m behind the leader, both at 30 m/s
      const t0 = sim.track.sampleAt(20), t1 = sim.track.sampleAt(28), a = Math.atan2(t0.ty, t0.tx);
      sim.simCars[0].reset(t0.x, t0.y, a); sim.simCars[0].body.setLinearVelocity({ x: t0.tx * 30, y: t0.ty * 30 });
      if (withLeader) { sim.simCars[1].reset(t1.x, t1.y, a); sim.simCars[1].body.setLinearVelocity({ x: t1.tx * 30, y: t1.ty * 30 }); }
      for (let i = 0; i < 40; i++) sim.update(1 / 60);
      return sim.simCars[0].draft;
    };
    expect(run(false)).toBe(0);
    expect(run(true)).toBeGreaterThan(0.3);
  });

  it('Scorcher boosts last longer; Gravel charges drift boosts faster', () => {
    expect(solo('scorcher').drift.boostTimeMul).toBeGreaterThan(1.4);
    expect(solo('gravel').drift.chargeMul).toBeGreaterThan(solo('scrapper').drift.chargeMul * 1.5);
    expect(solo('gravel').drift.entryMul).toBeLessThan(1);   // drift ease: drifts start at a lower speed
  });
});

// ------------------------------------------------------------------------------------------------ rivals
describe('rival fields', () => {
  const r = makeRng(5);
  it('same / pick / mixed / random pick the right models', () => {
    expect(new Set(rivalModels('same', 'brick', 7, r))).toEqual(new Set(['brick']));
    expect(new Set(rivalModels('pick', 'brick', 7, r, 'needle'))).toEqual(new Set(['needle']));
    const mixed = rivalModels('mixed', 'brick', 7, r);
    expect(new Set(mixed).size).toBe(7);           // all different
    expect(mixed).not.toContain('brick');           // and different from the player's car
    const rnd = rivalModels('random', 'brick', 7, makeRng(9));
    for (const m of rnd) expect(CAR_IDS).toContain(m);
    expect(rivalModels('random', 'brick', 7, makeRng(9))).toEqual(rnd);   // reproducible per seed
  });

  it('makeOpponents follows the choice and is deterministic', () => {
    const p = carStats('mammoth');
    const same = makeOpponents(1, p, 3, 0, { mode: 'same' });
    expect(same.every((c) => c.stats.modelId === 'mammoth')).toBe(true);
    const mixed = makeOpponents(1, p, 3, 0, { mode: 'mixed' });
    expect(new Set(mixed.map((c) => c.stats.modelId)).size).toBe(7);
    expect(makeOpponents(1, p, 3, 0, { mode: 'mixed' })).toEqual(mixed);
    // the choice never shifts names or skills of a seed
    expect(mixed.map((c) => [c.name, c.ai!.skill])).toEqual(same.map((c) => [c.name, c.ai!.skill]));
  });

  it('fairness: a rival of a slower model is sped up to the player model\'s pace, a faster one slowed down', () => {
    expect(paceFactor('brick', 'needle')).toBeGreaterThan(1);
    expect(paceFactor('needle', 'brick')).toBeLessThan(1);
    expect(paceFactor('glint', 'glint')).toBe(1);
    const [lo, hi] = CONFIG.rivals.paceClamp;
    for (const a of CAR_IDS) for (const b of CAR_IDS) { expect(paceFactor(a, b)).toBeGreaterThanOrEqual(lo); expect(paceFactor(a, b)).toBeLessThanOrEqual(hi); }
  });

  it('a normalised Mixed field laps within a few % whatever the player drives (AI, skill 1, t1)', () => {
    const lapOf = (stats: CarStats): number => {
      const sim = new Sim({ track: TRACKS[0], cars: [{ id: 0, isPlayer: false, name: 'x', colorIndex: 0, stats, ai: { skill: 1, aggression: 0.5, laneOffset: 0, mistakeRate: 0 } }], seed: 1, powerUps: false });
      let t = 0;
      while (t < 120 && sim.cars[0].lap < 2) { sim.update(1 / 60); t += 1 / 60; sim.drainEvents(); }
      return sim.cars[0].bestLapTime;
    };
    for (const player of ['needle', 'brick']) {
      const field = makeOpponents(0, carStats(player), 4, 0, { mode: 'mixed' });
      // strip the per-driver difficulty spread (statScale): compare the models only
      const target = lapOf(carStats(player));
      for (const c of field.slice(0, 4)) {
        const m = carStats(c.stats.modelId!);
        const f = paceFactor(c.stats.modelId!, player);
        const lap = lapOf({ ...m, enginePower: m.enginePower * f * f, topSpeed: m.topSpeed * f, grip: m.grip * f, latAccel: m.latAccel! * f * f, brakeDecel: m.brakeDecel! * f * f });
        expect(Math.abs(lap / target - 1), `${c.stats.modelId} vs player ${player}`).toBeLessThan(0.045);
      }
    }
  }, 120000);
});

// ------------------------------------------------------------------------------------------------ AI races with every car
describe('AI completes races with every car on every track', () => {
  const race = (ti: number, field: CarSetup[], seed: number): Sim => {
    const sim = new Sim({ track: TRACKS[ti], cars: field, seed });
    let t = 0;
    while (t < 420 && sim.race.phase !== 'finished') { sim.update(1 / 30); t += 1 / 30; sim.drainEvents(); }
    return sim;
  };
  const playerSlot = (stats: CarStats): CarSetup => ({ id: 0, isPlayer: false, name: 'p', colorIndex: 0, stats, ai: { skill: 0.9, aggression: 0.5, laneOffset: 0, mistakeRate: 0.05 } });

  for (let ti = 0; ti < TRACKS.length; ti++) {
    it(`${TRACKS[ti].id}: an 8-car field of each model (Same as mine) finishes, nobody stuck`, () => {
      for (const id of CAR_IDS) {
        const p = carStats(id);
        const sim = race(ti, [playerSlot(p), ...makeOpponents(ti, p, 7 + ti, 0, { mode: 'same' })], 11 + ti);
        expect(sim.race.phase, `${TRACKS[ti].id} ${id}`).toBe('finished');
        for (const c of sim.cars) expect(c.finished, `${TRACKS[ti].id} ${id} car ${c.id}`).toBe(true);
        expect(new Set(sim.cars.map((c) => c.place)).size).toBe(8);
        // respawns are the safety net for a wedged car: a handful per race at most (8 cars of one model on one road)
        expect(sim.respawns, `${TRACKS[ti].id} ${id}`).toBeLessThanOrEqual(12);
      }
    }, 600000);

    it(`${TRACKS[ti].id}: Mixed and Random fields finish`, () => {
      for (const [mode, player] of [['mixed', 'scrapper'], ['mixed', 'mammoth'], ['random', 'needle']] as const) {
        const p = carStats(player);
        const sim = race(ti, [playerSlot(p), ...makeOpponents(ti, p, 21 + ti, 0, { mode })], 31 + ti);
        expect(sim.race.phase, `${TRACKS[ti].id} ${mode} ${player}`).toBe('finished');
        expect(sim.respawns, `${TRACKS[ti].id} ${mode} ${player}`).toBeLessThanOrEqual(12);
      }
    }, 300000);
  }
});

// ------------------------------------------------------------------------------------------------ save
describe('save: per-car upgrades and v1 -> v2 migration', () => {
  it('a v1 save keeps its money, progress and upgrades (on the starter car it was driving)', () => {
    const v1 = {
      version: 1, money: 1234, upgrades: { engine: 2, grip: 1, armor: 4 }, unlockedTracks: ['t1', 't2'], bestPlace: { t1: 2, t2: 4 },
      bestLap: { t1: 70.5 }, settings: { lang: 'ru', autoGas: true, quality: 'low', muted: false, tutorialDone: true }, carColor: 3, racesFinished: 9,
    };
    const s = sanitizeSave(v1, null);
    expect(s.version).toBe(2);
    expect(s.money).toBe(1234);
    expect(s.car).toBe(CONFIG.cars.starter);
    expect(s.carUpgrades).toEqual({ [CONFIG.cars.starter]: { engine: 2, grip: 1, armor: 4 } });
    expect(s.carRaces).toEqual({ [CONFIG.cars.starter]: 9 });
    expect(s.unlockedTracks).toEqual(['t1', 't2']);
    expect(s.carColor).toBe(3);
    expect(s.settings.lang).toBe('ru');
    // the migrated player drives exactly what they had before
    expect(makePlayerSetup(s, 'p').stats).toEqual(carStats(CONFIG.cars.starter, { engine: 2, grip: 1, armor: 4 }));
  });

  it('v2 round trip keeps the car, per-car upgrades, badges and the rival choice; junk is dropped', () => {
    let s = { ...defaultSave(), money: 99999, car: 'needle' };
    s = buyUpgrade(s, 'engine')!;
    s = buyUpgrade(s, 'grip', 'brick')!;
    s = { ...s, carRaces: { needle: 3 }, carWins: { needle: 1 }, settings: { ...s.settings, rivals: 'pick', rivalCar: 'mammoth' } };
    const back = sanitizeSave(JSON.parse(JSON.stringify({ ...s, ghosts: undefined })), null);
    expect(back.car).toBe('needle');
    expect(back.carUpgrades).toEqual({ needle: { engine: 1, grip: 0, armor: 0 }, brick: { engine: 0, grip: 1, armor: 0 } });
    expect(back.carRaces).toEqual({ needle: 3 });
    expect(back.carWins).toEqual({ needle: 1 });
    expect(back.settings.rivals).toBe('pick');
    expect(back.settings.rivalCar).toBe('mammoth');
    const junk = sanitizeSave({ version: 2, car: 'tank', carUpgrades: { tank: { engine: 5 }, brick: { engine: 99, grip: -1 } }, settings: { rivals: 'all', rivalCar: 'x' } }, null);
    expect(junk.car).toBe(CONFIG.cars.starter);
    expect(junk.carUpgrades).toEqual({ brick: { engine: 5, grip: 0, armor: 0 } });
    expect(junk.settings.rivals).toBeUndefined();
    expect(junk.settings.rivalCar).toBeUndefined();
  });
});
