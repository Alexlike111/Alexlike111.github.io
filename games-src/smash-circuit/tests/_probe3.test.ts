import { it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { TRACKS } from '../src/track/tracks';
import { CAR_IDS, carStats } from '../src/meta/cars';
import { makeOpponents } from '../src/meta/opponents';
const DT = 1 / 30;
it('probe', () => {
  for (const ti of [0, 1, 2]) for (const id of CAR_IDS) {
    const t0 = performance.now();
    const base = carStats(id);
    const ai = makeOpponents(ti, base, 7 + ti, 0, { mode: 'same' });
    const cars = [{ id: 0, isPlayer: false, name: 'p', colorIndex: 0, stats: base, ai: { skill: 0.85, aggression: 0.5, laneOffset: 0, mistakeRate: 0.1 } }, ...ai];
    const sim = new Sim({ track: TRACKS[ti], cars, seed: 11 + ti });
    let t = 0;
    while (t < 400 && !sim.cars.every((c) => c.finished)) { sim.update(DT); t += DT; sim.drainEvents(); }
    const fin = sim.cars.filter((c) => c.finished).length;
    console.log(TRACKS[ti].id, id.padEnd(11), 'fin', fin, 't', t.toFixed(0), 'resp', sim.respawns, 'ms', (performance.now() - t0).toFixed(0), 'minH', Math.min(...sim.cars.map((c) => c.health)).toFixed(2));
  }
}, 900000);
