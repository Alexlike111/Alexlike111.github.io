import { it } from 'vitest';
import { CONFIG } from '../src/config';
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
it('iso', () => {
  const names = ['nitro', 'shield', 'repair', 'oil', 'shock', 'none'];
  const orig = CONFIG.items.weights.map((r) => ({ ...r, w: [...r.w] }));
  for (let k = 0; k < 6; k++) {
    for (let r = 0; r < 4; r++) { const w = [0, 0, 0, 0, 0]; if (k < 5) w[k] = 1; else w[0] = 0.0001; (CONFIG.items.weights as any)[r].w = w; }
    const res: string[] = [];
    for (const id of ['t1', 't2', 't3']) {
      const sim = new Sim({ track: TRACKS.find((t) => t.id === id)!, cars: field(), seed: 1 });
      let t = 0; while (t < 300 && sim.race.phase !== 'finished') { sim.update(1 / 60); t += 1 / 60; sim.drainEvents(); }
      res.push(id + ':' + sim.respawns + '@' + t.toFixed(0));
    }
    console.log('ONLY', names[k], res.join(' '));
  }
  for (let r = 0; r < 4; r++) (CONFIG.items.weights as any)[r].w = orig[r].w;
}, 300000);
