// Extra tracks (t4+): geometry sanity, clear start grid, and full headless AI races (power-ups on) that must finish
// every lap through the ordered checkpoints with sensible lap times and (almost) no respawns.
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { EN, RU } from '../src/i18n';
import { makeOpponents } from '../src/meta/opponents';
import { baseStats } from '../src/sim/carModel';
import { Sim } from '../src/sim/sim';
import { buildTrackGeometry } from '../src/track/spline';
import { TRACKS, trackById } from '../src/track/tracks';

const DT = 1 / 60;
const EXTRA = ['t4'];

describe('extra tracks', () => {
  it('are registered after the original three, unlockable in order, with EN/RU names', () => {
    for (const id of EXTRA) {
      const def = trackById(id);
      expect(TRACKS.indexOf(def)).toBeGreaterThanOrEqual(3);
      expect(CONFIG.meta.trackOrder).toContain(id);
      for (const dict of [EN, RU] as Record<string, string>[]) { expect(dict[def.nameKey]).toBeTruthy(); expect(dict[def.nameKey + '.desc']).toBeTruthy(); }
    }
  });

  it('have a ~1 km lap, no self-overlap and a clear start grid', () => {
    for (const id of EXTRA) {
      const def = trackById(id);
      const g = buildTrackGeometry(def);
      expect(g.length).toBeGreaterThan(850);
      expect(g.length).toBeLessThan(1200);
      // every sample's nearest point is itself (no two stretches of road closer than a road width)
      for (let k = 0; k < g.samples.length; k += 3) {
        const s = g.samples[k];
        const n = g.nearest(s.x, s.y);
        expect(Math.abs(n.lateral)).toBeLessThan(0.5);
      }
      // nothing solid on the road in the 80 m grid zone behind the line
      for (const p of def.props) {
        const n = g.nearest(p.x, p.y);
        if (n.s > g.length - 80 || n.s < 16) expect(Math.abs(n.lateral)).toBeGreaterThan(def.width / 2);
      }
    }
  });

  for (const id of EXTRA) {
    it(`${id}: full AI races finish every lap, lap times 20-38 s, rare respawns`, () => {
      const ti = TRACKS.findIndex((t) => t.id === id);
      const stats: { best: number[]; respawns: number; finished: number; cars: number } = { best: [], respawns: 0, finished: 0, cars: 0 };
      for (const seed of [1, 2, 3, 4]) {
        const sim = new Sim({
          track: TRACKS[ti],
          cars: [
            { id: 0, isPlayer: false, name: 'a', colorIndex: 0, stats: baseStats(), ai: { skill: 0.8, aggression: 0.5, laneOffset: 0, mistakeRate: 0.02 } },
            ...makeOpponents(Math.min(ti, CONFIG.meta.opponents.skill.length - 1), baseStats(), seed, 0),
          ],
          seed,
          powerUps: true,
        });
        let t = 0;
        while (t < 240 && !sim.cars.every((c) => c.finishTime > 0)) { sim.update(DT); t += DT; sim.drainEvents(); }
        stats.respawns += sim.respawns;
        stats.cars += sim.cars.length;
        for (const c of sim.cars) {
          if (c.finishTime > 0) stats.finished++;
          stats.best.push(c.bestLapTime);
        }
      }
      // eslint-disable-next-line no-console
      console.log(`[${id}] finished ${stats.finished}/${stats.cars}, respawns ${stats.respawns}, best laps ${Math.min(...stats.best).toFixed(1)}-${Math.max(...stats.best).toFixed(1)} s`);
      expect(stats.finished).toBe(stats.cars);
      expect(stats.respawns).toBeLessThanOrEqual(Math.ceil(stats.cars * 0.1));
      for (const b of stats.best) { expect(b).toBeGreaterThan(20); expect(b).toBeLessThan(38); }
    }, 120000);
  }
});
