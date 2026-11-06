// Runs the in-game sim self-test scenarios headlessly (tsx) to verify they pass and leave the world untouched:  npx tsx tests/selftest-sim.ts
import { simScenarios } from '../src/engine/sim.selftest';
import { mat, aux, flags, setCell } from '../src/engine/grid';
import { MAT } from '../src/content/materials';
import { G } from '../src/game/state';
import { initSim } from '../src/engine/sim';
import { initHeat } from '../src/engine/heat';

// a tiny "real world" that must survive every scenario
Object.assign(G.win, { x0: 100, y0: 100, x1: 200, y1: 200 });
for (let y = 150; y < 160; y++) for (let x = 100; x < 200; x++) setCell(x, y, MAT.STONE);
for (let x = 120; x < 140; x++) setCell(x, 149, MAT.SNOW);
initSim(); initHeat();
const hash = () => { let h = 0; for (let i = 0; i < mat.length; i += 7) h = (h * 31 + mat[i] + aux[i] * 3 + flags[i] * 5) | 0; return h; };
const h0 = hash();

let fails = 0;
for (const sc of simScenarios) {
  const notes: string[] = [], metrics: string[] = [];
  let ok = true;
  const t0 = performance.now();
  const ctx = {
    sc: null, frames: async () => {}, wait: async () => {}, log: (m: string) => notes.push(m),
    expect: (c: boolean, m: string) => { if (!c) { ok = false; notes.push('x ' + m); } },
    metric: (n: string, v: number, u = '') => metrics.push(`${n}=${Math.round(v * 100) / 100}${u}`),
    fps: async () => ({ avg: 60, min: 60, p95ms: 16 }),
  };
  try { sc.fn(ctx as never); } catch (e) { ok = false; notes.push('exception: ' + (e as Error).message); }
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${sc.name}  (${(performance.now() - t0).toFixed(0)} ms) ${metrics.join(' ')} ${notes.join(' | ')}`);
}
const same = hash() === h0;
console.log(`world restored after all scenarios: ${same ? 'yes' : 'NO'}`);
console.log(`${simScenarios.length - fails}/${simScenarios.length} passed`);
(globalThis as unknown as { process: { exit(n: number): void } }).process.exit(fails || !same ? 1 : 0);
