import { it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { baseStats } from '../src/sim/carModel';
import { TRACKS } from '../src/track/tracks';
import type { CarSetup } from '../src/types';
function field(): CarSetup[] {
  const out: CarSetup[] = [];
  for (let i = 0; i < 8; i++) { const f = i / 7;
    out.push({ id: i, isPlayer: false, name: 'c' + i, colorIndex: i, stats: baseStats(),
      ai: { skill: 0.95 - f * 0.35, aggression: 0.15 + (((i * 31 + 17) % 10) / 10) * 0.8, laneOffset: (((i + 1) % 5) - 2) / 2.5, mistakeRate: 0.03 + f * 0.1 } }); }
  return out;
}
it('scratch', () => {
  for (const id of ['t2', 't3']) {
    const tr = TRACKS.find((t) => t.id === id)!;
    const sim = new Sim({ track: tr, cars: field(), seed: 1 });
    console.log(id, 'pads', sim.pads.map((p) => p.x.toFixed(0) + ',' + p.y.toFixed(0)).join(' | '), 'boxes', sim.boxes.length);
    let last = 0; let t = 0;
    const log: string[] = [];
    while (t < 200 && sim.race.phase !== 'finished') {
      sim.update(1 / 60); t += 1 / 60;
      for (const e of sim.drainEvents()) {
        if (e.type === 'itemUse') log.push(`${t.toFixed(1)} car${e.carId} uses ${e.item}`);
        if (e.type === 'oilSpin') log.push(`${t.toFixed(1)} car${e.carId} oilSpin`);
      }
      if (sim.respawns !== last) { last = sim.respawns; const c = sim.cars; log.push(`${t.toFixed(1)} RESPAWN #${last}: ` + c.map((q) => `${q.id}:${q.speed.toFixed(0)}/${(q.boostT ?? 0).toFixed(1)}/${(q.shieldT ?? 0).toFixed(1)}/${(q.spinT ?? 0).toFixed(1)}/${q.health.toFixed(2)}`).join(' ')); }
    }
    console.log(id, 'time', t.toFixed(1), 'respawns', sim.respawns); console.log(log.join('\n'));
  }
}, 120000);
