// Headless AI races on EVERY layout (forward and reverse): the whole field finishes without getting stuck or respawning often,
// lap times are sensible, and the pace follows the skill / difficulty ramp.
import { describe, expect, it } from 'vitest';
import { makeOpponents } from '../src/meta/opponents';
import { AiDriver } from '../src/sim/ai';
import { baseStats } from '../src/sim/carModel';
import { makeRng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import { ALL_TRACKS, baseTrackId } from '../src/track/tracks';
import type { CarSetup } from '../src/types';

const DT = 1 / 60;
/** Best lap (s) of a clean car per base track (same road, either direction; see tests/aiPace.test.ts). */
const OPTIMAL_LAP: Record<string, number> = { t1: 18.0, t2: 21.4, t3: 22.2 };

function solo(trackIdx: number, skill: number): { lap: number; respawns: number } {
  const sim = new Sim({
    track: ALL_TRACKS[trackIdx],
    cars: [{ id: 0, isPlayer: false, name: 'x', colorIndex: 0, stats: baseStats(), ai: { skill, aggression: 0.4, laneOffset: 0, mistakeRate: 0 } }],
    seed: 4, powerUps: false, laps: 2,
  });
  let t = 0;
  while (t < 120 && sim.race.phase !== 'finished') { sim.update(DT); t += DT; sim.drainEvents(); }
  return { lap: sim.cars[0].bestLapTime, respawns: sim.respawns };
}

describe('AI races on every layout', () => {
  for (let ti = 0; ti < ALL_TRACKS.length; ti++) {
    const def = ALL_TRACKS[ti];
    it(`${def.id}: a full field (a human-like driver plus 7 rivals with characters) finishes, nobody is stuck, laps are sensible`, () => {
      const diff = Math.min(2, ['t1', 't2', 't3'].indexOf(baseTrackId(def.id)));
      const seed = 5 + ti;
      const cars: CarSetup[] = [{ id: 0, isPlayer: true, name: 'p', colorIndex: 0, stats: baseStats() }, ...makeOpponents(diff, baseStats(), seed, 0)];
      const sim = new Sim({ track: def, cars, seed, laps: 2 });
      const brain = new AiDriver({ skill: 0.8, aggression: 0.2, laneOffset: 0, mistakeRate: 0.03 }, makeRng(seed + 99));
      let t = 0;
      while (t < 200 && !sim.cars.every((c) => c.finished)) {
        if (sim.race.phase === 'racing' && !sim.cars[0].finished) sim.setPlayerInput(brain.think(sim.cars[0], sim.cars.slice(1), sim.track, DT, sim.tracker.hints[0]));
        sim.update(DT); t += DT; sim.drainEvents();
      }
      expect(sim.cars.filter((c) => c.finished).length).toBe(8);
      expect(sim.respawns).toBeLessThanOrEqual(2);
      expect(new Set(sim.cars.map((c) => c.place)).size).toBe(8);
      const laps = sim.cars.map((c) => c.bestLapTime).filter((x) => x > 0).sort((a, b) => a - b);
      const opt = OPTIMAL_LAP[baseTrackId(def.id)];
      expect(laps.length).toBeGreaterThanOrEqual(7);
      expect(laps[0]).toBeGreaterThan(opt * 0.95);                 // not faster than physics allows
      expect(laps[0]).toBeLessThan(opt * 1.2);                     // the best car of the pack races at pace
      expect(laps[laps.length - 1]).toBeLessThan(opt * 1.6);       // nobody crawls
    }, 240000);

    it(`${def.id}: the same road both ways is driven at the same pace, and lap time falls with AI skill`, () => {
      const a = solo(ti, 0.6), b = solo(ti, 0.8), c = solo(ti, 1);
      expect(a.respawns + b.respawns + c.respawns).toBe(0);
      expect(c.lap).toBeLessThan(b.lap);
      expect(b.lap).toBeLessThan(a.lap);
      expect(a.lap / c.lap).toBeLessThan(1.3);                     // the weakest line is slower, not hopeless
      const opt = OPTIMAL_LAP[baseTrackId(def.id)];
      expect(c.lap).toBeGreaterThan(opt * 0.97);
      expect(c.lap).toBeLessThan(opt * 1.06);
    }, 120000);
  }
});
