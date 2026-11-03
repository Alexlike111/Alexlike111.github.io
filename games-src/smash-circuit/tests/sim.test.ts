import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { AiDriver } from '../src/sim/ai';
import { baseStats } from '../src/sim/carModel';
import { makeRng } from '../src/sim/rng';
import { Sim, createSim } from '../src/sim/sim';
import { TRACKS } from '../src/track/tracks';
import type { CarInput, CarSetup, GhostData, SimEvent, TrackDef } from '../src/types';

const DT = 1 / 60;
const IDLE: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };

/** 7 AI drivers (+ player or an 8th AI) with a spread of skills and characters. */
function field(opts: { player: boolean; seed?: number }): CarSetup[] {
  const out: CarSetup[] = [];
  const sd = opts.seed ?? 1;
  for (let i = 0; i < 8; i++) {
    const f = i / 7;
    const j = ((i * 31 + sd * 17) % 10) / 10;
    out.push({
      id: i, isPlayer: opts.player && i === 0, name: 'car' + i, colorIndex: i, stats: baseStats(),
      ai: { skill: 0.95 - f * 0.35, aggression: 0.15 + j * 0.8, laneOffset: (((i + sd) % 5) - 2) / 2.5, mistakeRate: 0.03 + f * 0.1 },
    });
  }
  return out;
}

function trackOf(id: string): TrackDef { return TRACKS.find((t) => t.id === id)!; }

interface RaceRun { sim: Sim; time: number; events: SimEvent[]; placeSetsOk: boolean; swaps: number }

const cache = new Map<string, RaceRun>();

/** Whole all-AI race (3 laps), memoised so several tests can look at the same run. */
function aiRace(trackId: string, seed: number): RaceRun {
  const key = trackId + '/' + seed;
  const hit = cache.get(key);
  if (hit) return hit;
  const sim = new Sim({ track: trackOf(trackId), cars: field({ player: false, seed }), seed });
  const events: SimEvent[] = [];
  let t = 0, placeSetsOk = true, swaps = 0;
  const prev = sim.cars.map((c) => c.place);
  while (t < 400 && sim.race.phase !== 'finished') {
    sim.update(DT);
    t += DT;
    events.push(...sim.drainEvents());
    if (sim.race.phase === 'racing') sim.cars.forEach((c, i) => { if (c.place !== prev[i]) { swaps++; prev[i] = c.place; } });
    if (Math.round(t / DT) % 30 === 0 && new Set(sim.cars.map((c) => c.place)).size !== sim.cars.length) placeSetsOk = false;
  }
  const run = { sim, time: t, events, placeSetsOk, swaps: swaps / 2 };
  cache.set(key, run);
  return run;
}

describe('Sim: headless AI races', () => {
  for (const tr of TRACKS) {
    it(`8 AI cars finish 3 laps on ${tr.id} without getting stuck`, () => {
      const r = aiRace(tr.id, 1);
      const { sim } = r;
      expect(sim.race.phase).toBe('finished');
      expect(r.time).toBeLessThan(250);
      expect(sim.race.totalLaps).toBe(3);
      for (const c of sim.cars) {
        expect(c.finished).toBe(true);
        expect(c.lap).toBeGreaterThanOrEqual(3);
        expect(c.finishTime).toBeGreaterThan(0);
        expect(c.bestLapTime).toBeGreaterThan(sim.track.length / 70);
      }
      expect(sim.cars.map((c) => c.place).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(r.placeSetsOk).toBe(true);
      expect(sim.respawns).toBeLessThanOrEqual(1);
      // nobody was left behind: slowest finisher within 40% of the winner
      const times = sim.cars.map((c) => c.finishTime);
      expect(Math.max(...times) / Math.min(...times)).toBeLessThan(1.4);
      // events: 8 finish events with unique places, 24 lap events
      const fin = r.events.filter((e) => e.type === 'finish') as { place: number }[];
      expect(fin.length).toBe(8);
      expect(new Set(fin.map((f) => f.place)).size).toBe(8);
      expect(r.events.filter((e) => e.type === 'lap').length).toBe(24);
      expect(sim.race.results.length).toBe(8);
    }, 120000);

    it(`step time stays inside the budget on ${tr.id}`, () => {
      const { sim } = aiRace(tr.id, 1);
      expect(sim.avgStepMs).toBeLessThan(CONFIG.physics.stepBudgetMs);
      expect(sim.stepMs).toBeGreaterThanOrEqual(0);
    }, 120000);
  }

  it('AI lap times on t1 are stable across seeds but not identical', () => {
    const laps = [1, 2, 3].map((seed) => {
      const { sim } = aiRace('t1', seed);
      const best = sim.cars.map((c) => c.bestLapTime).sort((a, b) => a - b);
      return best[Math.floor(best.length / 2)];     // median driver
    });
    expect(Math.max(...laps) / Math.min(...laps)).toBeLessThan(1.15);
    expect(new Set(laps.map((l) => l.toFixed(3))).size).toBeGreaterThan(1);
  }, 120000);

  it('the order of the field changes during the race (overtakes happen)', () => {
    const total = TRACKS.reduce((a, tr) => a + aiRace(tr.id, 1).swaps, 0);
    expect(total).toBeGreaterThanOrEqual(5);
  }, 120000);

  it('finished AI cars stop colliding so they cannot block the others', () => {
    const { sim } = aiRace('t2', 1);
    for (const sc of sim.simCars) {
      expect(sc.state.finished).toBe(true);
      expect(sc.body.getFixtureList()!.isSensor()).toBe(true);
    }
  }, 120000);

  it('is deterministic for a seed', () => {
    const run = (seed: number) => {
      const sim = new Sim({ track: trackOf('t2'), cars: field({ player: false }), seed });
      for (let i = 0; i < 60 * 25; i++) sim.update(DT);
      return sim.cars.map((c) => [c.x, c.y, c.angle, c.health]);
    };
    expect(run(5)).toEqual(run(5));
    expect(run(5)).not.toEqual(run(6));
  }, 60000);
});

describe('Sim: stepping and countdown', () => {
  function make(player = true): Sim {
    return new Sim({ track: trackOf('t1'), cars: field({ player }), seed: 3 });
  }

  it('uses a fixed-step accumulator with interpolation alpha', () => {
    const sim = make();
    const dt = CONFIG.physics.dt;
    expect(sim.update(dt * 6.5)).toBe(6);
    expect(sim.alpha).toBeCloseTo(0.5, 5);
    expect(sim.update(dt * 0.2)).toBe(0);
    expect(sim.alpha).toBeCloseTo(0.7, 5);
    expect(sim.update(dt * 0.4)).toBe(1);
    expect(sim.alpha).toBeGreaterThanOrEqual(0);
    expect(sim.alpha).toBeLessThan(1);
    expect(sim.update(10)).toBe(CONFIG.physics.maxSubSteps);   // huge frame: capped, no spiral of death
    expect(sim.update(0)).toBe(0);
    expect(sim.stepMs).toBeGreaterThan(0);
  });

  it('cars are frozen during the countdown, which emits 3, 2, 1, 0', () => {
    const sim = make();
    const start = sim.cars.map((c) => [c.x, c.y]);
    sim.setPlayerInput({ throttle: 1, brake: 0, steer: 0, handbrake: false });
    const events: SimEvent[] = [...sim.drainEvents()];
    let t = 0;
    while (sim.race.phase === 'countdown' && t < 5) {
      sim.update(DT); t += DT;
      events.push(...sim.drainEvents());
      if (sim.race.phase === 'countdown') {
        sim.cars.forEach((c, i) => { expect(c.x).toBeCloseTo(start[i][0], 3); expect(c.y).toBeCloseTo(start[i][1], 3); });
      }
    }
    expect(events.filter((e) => e.type === 'countdown').map((e) => (e as { value: number }).value)).toEqual([3, 2, 1, 0]);
    expect(t).toBeGreaterThan(CONFIG.race.countdown - 0.1);
    expect(t).toBeLessThan(CONFIG.race.countdown + 0.1);
    for (let i = 0; i < 120; i++) sim.update(DT);
    expect(sim.cars[0].speed).toBeGreaterThan(5);        // player moves after GO
  });

  it('puts the player on its grid slot behind the line, AI in a seeded shuffled order, all on the road', () => {
    const sim = make();
    const g = sim.track;
    const pl = sim.cars[0];
    const near = g.nearest(pl.x, pl.y);
    expect(pl.place).toBe(CONFIG.race.playerGridSlot + 1);
    expect(sim.cars.every((c) => c.progress < 0)).toBe(true);
    for (const c of sim.cars) expect(Math.abs(g.nearest(c.x, c.y).lateral)).toBeLessThan(g.def.width / 2);
    expect(near.s).toBeGreaterThan(g.length / 2);          // behind the start line
    // every grid slot is used exactly once
    expect(sim.cars.map((c) => c.place).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('grid order of the AI is not sorted by skill, differs between seeds and is reproducible', () => {
    const orderFor = (seed: number): number[] => {
      const sim = new Sim({ track: trackOf('t1'), cars: field({ player: true }), seed });
      return sim.cars.filter((c) => !c.isPlayer).sort((a, b) => a.place - b.place).map((c) => c.id);
    };
    const orders = [1, 2, 3, 4, 5, 6].map(orderFor);
    // field(): lower id = higher skill, so "sorted by skill" means ascending ids (the old behaviour)
    const ladder = (ids: number[]): boolean => ids.every((v, i) => i === 0 || ids[i - 1] < v);
    expect(orders.filter(ladder).length).toBe(0);
    expect(new Set(orders.map((o) => o.join(','))).size).toBeGreaterThanOrEqual(5);
    expect(orderFor(3)).toEqual(orderFor(3));
  });

  it('exposes previous poses for render interpolation', () => {
    const sim = make();
    for (let i = 0; i < 60 * 5; i++) sim.update(DT);
    const c = sim.cars[1], p = sim.prevPoses[1];
    const moved = Math.hypot(c.x - p.x, c.y - p.y);
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(1);                         // one 1/120 s step
  });

  it('dispose stops the sim', () => {
    const sim = createSim({ track: trackOf('t1'), cars: field({ player: true }), seed: 1 });
    sim.update(0.1);
    sim.dispose();
    expect(sim.update(0.1)).toBe(0);
  });
});

describe('Sim: player, damage and destruction', () => {
  function started(): Sim {
    const sim = new Sim({ track: trackOf('t1'), cars: field({ player: true }), seed: 3 });
    while (sim.race.phase === 'countdown') sim.update(DT);
    sim.drainEvents();
    return sim;
  }

  it('hitting a wall hurts the car, emits impact events and wears the wall', () => {
    const sim = started();
    sim.setPlayerInput({ throttle: 1, brake: 0, steer: 0.15, handbrake: false });   // drift to the right wall
    const events: SimEvent[] = [];
    for (let i = 0; i < 60 * 14 && !events.some((e) => e.type === 'impact' && e.carId === 0 && e.strength > 0.3); i++) {
      sim.update(DT);
      events.push(...sim.drainEvents());
    }
    const hits = events.filter((e) => e.type === 'impact' && e.carId === 0) as Extract<SimEvent, { type: 'impact' }>[];
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.other === 'wall' || h.other === 'guardrail' || h.other === 'prop' || h.other === 'car')).toBe(true);
    expect(sim.cars[0].health).toBeLessThan(1);
    const worn = sim.destructibles.some((d) => d.crack > 0 || d.broken);
    expect(worn).toBe(true);
  }, 60000);

  it('repairPlayer restores the car and reports it', () => {
    const sim = started();
    sim.setPlayerInput({ throttle: 1, brake: 0, steer: 0.2, handbrake: false });
    for (let i = 0; i < 60 * 12; i++) sim.update(DT);
    sim.drainEvents();
    const before = sim.cars[0].health;
    expect(before).toBeLessThan(1);
    sim.repairPlayer();
    sim.update(DT);
    expect(sim.cars[0].health).toBe(1);
    expect(sim.cars[0].detachedParts.length).toBe(0);
    expect(sim.drainEvents().some((e) => e.type === 'repair' && e.carId === 0)).toBe(true);
  }, 60000);

  it('counts what the player smashes', () => {
    const sim = started();
    sim.setPlayerInput({ throttle: 1, brake: 0, steer: 0.1, handbrake: false });
    for (let i = 0; i < 60 * 40; i++) {
      sim.update(DT);
      // keep ramming: when the car stops, back off and go again
      const c = sim.cars[0];
      if (Math.abs(c.speed) < 1) sim.setPlayerInput({ throttle: 0, brake: 1, steer: -0.3, handbrake: false });
      else if (c.speed > 8) sim.setPlayerInput({ throttle: 1, brake: 0, steer: 0.12, handbrake: false });
    }
    const broken = sim.destructibles.filter((d) => d.broken).length;
    expect(sim.brokenByPlayer).toBeLessThanOrEqual(broken);
    expect(sim.brokenByPlayer).toBeGreaterThanOrEqual(0);
    sim.drainEvents();
  }, 60000);

  it('AI cars get around an idle player and still finish', () => {
    const sim = new Sim({ track: trackOf('t2'), cars: field({ player: true }), seed: 9 });
    let t = 0;
    while (t < 300 && !sim.cars.slice(1).every((c) => c.finished)) { sim.update(DT); t += DT; }
    sim.drainEvents();
    expect(sim.cars.slice(1).every((c) => c.finished)).toBe(true);
    expect(sim.respawns).toBeLessThanOrEqual(1);
    expect(sim.cars[0].health).toBeGreaterThan(0.5);        // AI mostly avoid a parked car
  }, 120000);
});

describe('Sim: AI recovers from a smashed wall', () => {
  it('drives back onto the road from beyond a gap', () => {
    const sim = new Sim({ track: trackOf('t1'), cars: field({ player: true }), seed: 4 });
    while (sim.race.phase === 'countdown') sim.update(DT);
    const g = sim.track;
    // knock out every wall/guardrail piece around s = 90..160
    const ids: number[] = [];
    for (const d of sim.destructibles) {
      if (d.kind !== 'wall' && d.kind !== 'guardrail') continue;
      const s = g.nearest(d.x, d.y).s;
      if (s > 80 && s < 170) ids.push(d.id);
    }
    expect(ids.length).toBeGreaterThan(4);
    const ev: SimEvent[] = [];
    for (const id of ids) sim.destruction.recordHit(id, 1e6, 0, 0, 0, 0);
    for (let i = 0; i < 40; i++) { sim.destruction.flush(ev); sim.update(DT); }
    expect(ids.every((id) => sim.destructibles[id].broken)).toBe(true);
    // throw an AI car 10 m outside the road, facing away
    const i = 3;
    const c = sim.cars[i];
    const t = g.sampleAt(120);
    const x = t.x + t.nx * 11, y = t.y + t.ny * 11;
    sim.simCars[i].reset(x, y, Math.atan2(t.ny, t.nx));
    let back = -1;
    for (let k = 0; k < 60 * 25; k++) {
      sim.update(DT);
      if (Math.abs(g.nearest(c.x, c.y).lateral) < g.def.width / 2 - 1) { back = k * DT; break; }
    }
    expect(back).toBeGreaterThan(0);
    expect(back).toBeLessThan(25);
  }, 60000);
});

describe('Sim: ghost', () => {
  /** A bot drives the player car with the same AI code; returns the finished sim. */
  function botRace(ghost?: GhostData, record?: (sim: Sim, t: number) => void): Sim {
    const cars = field({ player: true });
    const sim = new Sim({ track: trackOf('t1'), cars, seed: 12, ghost });
    const bot = new AiDriver({ skill: 0.9, aggression: 0.2, laneOffset: 0, mistakeRate: 0 }, makeRng(77));
    let t = 0;
    while (t < 200 && !sim.race.playerFinished) {
      if (sim.race.phase !== 'countdown') {
        sim.setPlayerInput(bot.think(sim.cars[0], sim.cars.slice(1), sim.track, DT, sim.tracker.hints[0]));
      } else sim.setPlayerInput(IDLE);
      sim.update(DT); t += DT;
      record?.(sim, t);
    }
    sim.drainEvents();
    return sim;
  }

  it('records the best flying lap and plays it back next race', () => {
    const first = botRace();
    expect(first.race.playerFinished).toBe(true);
    const g = first.bestGhost();
    expect(g).not.toBeNull();
    expect(g!.trackId).toBe('t1');
    expect(g!.frames.length).toBeGreaterThan(g!.lapTime * CONFIG.race.ghostHz * 0.9);
    // the ghost lap is one of the player's flying laps
    expect(g!.lapTime).toBeGreaterThan(first.track.length / 60);
    expect(g!.lapTime).toBeLessThanOrEqual(first.cars[0].bestLapTime + 0.01);

    let nullInLap1 = true, seen = 0, maxDist = 0;
    botRace(g!, (sim) => {
      const p = sim.ghostPose();
      if (sim.cars[0].lap < CONFIG.race.ghostMinLap) { if (p !== null) nullInLap1 = false; return; }
      if (p) {
        seen++;
        maxDist = Math.max(maxDist, Math.hypot(p.x - sim.cars[0].x, p.y - sim.cars[0].y));
      }
    });
    expect(nullInLap1).toBe(true);
    expect(seen).toBeGreaterThan(60);
    expect(maxDist).toBeLessThan(80);                     // same bot: the ghost runs alongside
  }, 120000);

  it('a slower race does not replace the saved ghost', () => {
    const first = botRace();
    const g = first.bestGhost()!;
    const slowGhost: GhostData = { ...g, lapTime: g.lapTime - 5 };   // pretend the saved one is much faster
    const second = botRace(slowGhost);
    expect(second.bestGhost()).toBeNull();
  }, 120000);
});

describe('Sim: finish flow', () => {
  it('after the player finishes the race closes within the grace time with unique places', () => {
    const sim = new Sim({ track: trackOf('t3'), cars: field({ player: true }), seed: 21 });
    const bot = new AiDriver({ skill: 0.7, aggression: 0.2, laneOffset: 0, mistakeRate: 0.02 }, makeRng(5));
    const events: SimEvent[] = [];
    let t = 0, tFinish = -1;
    while (t < 300 && sim.race.phase !== 'finished') {
      sim.setPlayerInput(sim.race.phase === 'countdown' ? IDLE : bot.think(sim.cars[0], sim.cars.slice(1), sim.track, DT, sim.tracker.hints[0]));
      sim.update(DT); t += DT;
      events.push(...sim.drainEvents());
      if (tFinish < 0 && sim.race.playerFinished) tFinish = sim.race.time;
    }
    expect(sim.race.phase).toBe('finished');
    expect(tFinish).toBeGreaterThan(0);
    expect(sim.race.time - tFinish).toBeLessThanOrEqual(15);
    const res = sim.race.results;
    expect(res.length).toBe(8);
    expect(res.map((r) => r.place)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (let i = 1; i < res.length; i++) expect(res[i].time).toBeGreaterThanOrEqual(res[i - 1].time);
    const player = res.find((r) => r.carId === 0)!;
    expect(sim.cars[0].place).toBe(player.place);
    expect(player.time).toBeCloseTo(sim.cars[0].finishTime, 6);
    expect(events.filter((e) => e.type === 'finish').length).toBe(8);
  }, 120000);
});
