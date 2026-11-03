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

it('dbg', () => {
  for (let r = 0; r < 4; r++) { const w = [0, 0, 0, 0, 0]; w[3] = 1; (CONFIG.items.weights as any)[r].w = w; }
  const sim = new Sim({ track: TRACKS.find((t) => t.id === 't1')!, cars: field(), seed: 1 });
  let t = 0, last = 0; const hist: any[] = [];
  while (t < 120 && sim.respawns < 1) {
    sim.update(1 / 60); t += 1 / 60; sim.drainEvents();
    if (Math.round(t * 60) % 30 === 0) hist.push({ t: +t.toFixed(1), c: sim.cars.map((c) => { const n = sim.track.nearest(c.x, c.y); const tg = sim.track.sampleAt(n.s); const dh = Math.atan2(Math.sin(c.angle - Math.atan2(tg.ty, tg.tx)), Math.cos(c.angle - Math.atan2(tg.ty, tg.tx))); return `${c.id}:s${n.s.toFixed(0)} l${n.lateral.toFixed(1)} v${c.speed.toFixed(0)} h${dh.toFixed(1)} sp${(c.spinT ?? 0).toFixed(1)}`; }).join(' | '), oils: sim.oils.filter((o) => o.active).map((o) => { const n = sim.track.nearest(o.x, o.y); return `s${n.s.toFixed(0)}l${n.lateral.toFixed(1)}`; }).join(',') });
  }
  console.log('DBG respawn at', t.toFixed(1)); for (const h of hist.slice(-14)) console.log('DBG', h.t, h.c, 'OILS', h.oils);
}, 100000);

it('dbg2', () => {
  const sim = new Sim({ track: TRACKS.find((t) => t.id === 't3')!, cars: field(), seed: 1 });
  let t = 0; const log: string[] = [];
  const tr = sim.track;
  const where = (id: number) => { const c = sim.cars.find((q) => q.id === id)!; const n = tr.nearest(c.x, c.y); return `s${n.s.toFixed(0)}l${n.lateral.toFixed(1)}v${c.speed.toFixed(0)}`; };
  while (t < 120 && sim.respawns < 3) {
    sim.update(1 / 60); t += 1 / 60;
    for (const e of sim.drainEvents()) {
      if (e.type === 'itemUse') log.push(`${t.toFixed(1)} car${e.carId} uses ${e.item} at ${where(e.carId)}`);
      if (e.type === 'oilSpin') log.push(`${t.toFixed(1)} car${e.carId} oilSpin ${where(e.carId)}`);
      if (e.type === 'pickup') log.push(`${t.toFixed(1)} car${e.carId} picks ${e.item}`);
    }
    if (Math.round(t * 60) % 60 === 0 && t > 36 && t < 46) log.push(`${t.toFixed(0)}  ` + sim.cars.map((c) => c.id + ':' + where(c.id)).join(' '));
  }
  console.log('DBG2 respawns', sim.respawns, 't', t.toFixed(1)); for (const l of log) console.log('DBG2', l);
}, 100000);
