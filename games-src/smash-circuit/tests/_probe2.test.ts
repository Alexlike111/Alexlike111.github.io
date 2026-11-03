import { it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { TRACKS } from '../src/track/tracks';
import { carStats } from '../src/meta/cars';
import { baseStats } from '../src/sim/carModel';
const DT = 1 / 60;
function soloLap(ti: number, stats: any) {
  const sim = new Sim({ track: TRACKS[ti], cars: [{ id: 0, isPlayer: false, name: 'x', colorIndex: 0, stats, ai: { skill: 1, aggression: 0.5, laneOffset: 0, mistakeRate: 0 } }], seed: 1, powerUps: false });
  let t = 0;
  while (t < 200 && sim.race.phase !== 'finished') { sim.update(DT); t += DT; sim.drainEvents(); }
  return { lap: sim.cars[0].bestLapTime, respawns: sim.respawns, health: sim.cars[0].health };
}
it('probe', () => {
  console.log('base', JSON.stringify(soloLap(2, baseStats())));
  const s = carStats('scrapper');
  console.log('scr', JSON.stringify(soloLap(2, s)));
  console.log('scr-noregen', JSON.stringify(soloLap(2, { ...s, traits: undefined })));
  console.log('scr-nolat', JSON.stringify(soloLap(2, { ...s, latAccel: undefined, brakeDecel: undefined })));
}, 600000);
