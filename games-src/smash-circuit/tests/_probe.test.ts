import { it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { TRACKS } from '../src/track/tracks';
import { CAR_IDS, carStats, zeroTo100, settledTopSpeed, corneringAt, bars } from '../src/meta/cars';
const DT = 1 / 60;
function soloLap(ti: number, id: string): { lap: number; respawns: number; health: number } {
  const sim = new Sim({ track: TRACKS[ti], cars: [{ id: 0, isPlayer: false, name: 'x', colorIndex: 0, stats: carStats(id), ai: { skill: 1, aggression: 0.5, laneOffset: 0, mistakeRate: 0 } }], seed: 1, powerUps: false });
  let t = 0;
  while (t < 200 && sim.race.phase !== 'finished') { sim.update(DT); t += DT; sim.drainEvents(); }
  return { lap: sim.cars[0].bestLapTime, respawns: sim.respawns, health: sim.cars[0].health };
}
it('probe', () => {
  const ref = [0, 1, 2].map((ti) => soloLap(ti, 'scrapper').lap);
  for (const id of CAR_IDS) {
    const s = carStats(id);
    const laps = [0, 1, 2].map((ti) => soloLap(ti, id));
    const rel = laps.map((l, i) => l.lap / ref[i]);
    const b = bars(s);
    console.log(id.padEnd(11), '0-100', zeroTo100(s).toFixed(2), 'top', (settledTopSpeed(s) * 3.6).toFixed(0), 'lat', corneringAt(s).toFixed(1),
      'laps', laps.map((l) => l.lap.toFixed(2) + (l.respawns ? 'R' + l.respawns : '') + ' h' + l.health.toFixed(2)).join(' '),
      'pace', (rel.reduce((a, b) => a + b) / 3).toFixed(3), rel.map((r) => r.toFixed(3)).join('/'),
      'bars', Object.entries(b).map(([k, v]) => k[0] + v.toFixed(1)).join(' '));
  }
}, 600000);
