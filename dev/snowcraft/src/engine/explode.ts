// Explosions: carve a crater by hardness, throw cells as flying cells, light fires, heat the area, notify listeners.
import { W, H, mat, aux, shade, flags, setCell, wakeRect, edited } from './grid';
import { MATS, MAT, PHASE, FLAM, P_SOLID, P_POWDER, P_LIQUID, P_GAS, P_FIRE } from '../content/materials';
import { throwCell, spawnFx, burstFx } from './particles';
import { burstHeat } from './heat';
import { G } from '../game/state';

type BlastFn = (x: number, y: number, radius: number, power: number) => void;
const blastFns: BlastFn[] = [];
/** Listen for blasts (damage to player / animals / fixtures). radius in cells, power ≈ 0..1+. */
export function onBlast(fn: BlastFn): () => void {
  blastFns.push(fn);
  return () => { const i = blastFns.indexOf(fn); if (i >= 0) blastFns.splice(i, 1); };   // unsubscribe on new game / load
}

const HARD = new Float32Array(256);
MATS.forEach((m, i) => { HARD[i] = m.hard; });

const HARD_SCALE = 2.6;     // hardness destroyed at the centre of a power-1 blast
const MAX_THROWN = 700;

let rs = 987654321;
const rnd = () => { rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5; return (rs >>> 0) / 4294967296; };

/** Blast at (cx,cy) (cells). Returns the number of destroyed (removed) cells. */
export function explode(cx: number, cy: number, radius: number, power: number): { destroyed: number } {
  const R = Math.max(1, radius);
  const x0 = Math.max(1, Math.floor(cx - R)), x1 = Math.min(W - 2, Math.ceil(cx + R));
  const y0 = Math.max(1, Math.floor(cy - R)), y1 = Math.min(H - 2, Math.ceil(cy + R));
  const R2 = R * R;
  let destroyed = 0, thrown = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d2 = dx * dx + dy * dy;
      if (d2 > R2) continue;
      const i = y * W + x, m = mat[i];
      if (m === 0) continue;
      const d = Math.sqrt(d2), f = 1 - d / R;
      const ph = PHASE[m];
      let remove = false;
      if (ph === P_GAS || ph === P_FIRE) remove = true;
      else if (HARD[m] !== Infinity) remove = HARD[m] <= power * HARD_SCALE * Math.pow(f, 0.7) + (ph === P_POWDER || ph === P_LIQUID ? 1 : 0);
      if (!remove) {
        // survives: scorch flammables with fire next to them
        if (FLAM[m] > 0 && rnd() < f * 0.8 && y > 0 && mat[i - W] === 0) setCell(x, y - 1, MAT.FIRE, 20 + ((rnd() * 24) | 0));
        continue;
      }
      const a = aux[i], s = shade[i];
      const inv = d > 0.01 ? 1 / d : 0;
      destroyed++;
      mat[i] = 0; aux[i] = 0; flags[i] = 0;
      if (ph === P_GAS || ph === P_FIRE) continue;
      // outward velocity
      const sp = (50 + 170 * power) * (0.4 + f * 0.9) * (0.6 + rnd() * 0.8);
      const vx = dx * inv * sp, vy = dy * inv * sp - 25 * power;
      // inner third vaporises (fire), the rest is thrown
      if (f > 0.66 && ph === P_SOLID && rnd() < 0.5) { if (rnd() < 0.35) setCell(x, y, MAT.FIRE, 18 + ((rnd() * 30) | 0)); continue; }
      const keep = ph === P_LIQUID ? 1 : ph === P_POWDER ? 0.7 : 0.4;
      if (thrown < MAX_THROWN && rnd() < keep) {
        if (throwCell(x, y, m, a, vx, vy)) { thrown++; continue; }
      }
      if (ph === P_SOLID && rnd() < 0.5) spawnFx('debris', x, y, vx * 0.5, vy * 0.5, 0.6 + rnd() * 0.6, undefined);
      void s;
    }
  }
  // flames in the crater, dust and sparks
  const nf = Math.min(90, Math.floor(R * R * 0.35 * power));
  for (let k = 0; k < nf; k++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * R * 0.85;
    const x = Math.floor(cx + Math.cos(a) * r), y = Math.floor(cy + Math.sin(a) * r);
    if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
    const i = y * W + x;
    if (mat[i] === 0) { mat[i] = MAT.FIRE; aux[i] = 16 + ((rnd() * 30) | 0); flags[i] = 0; shade[i] = (rnd() * 256) | 0; }
  }
  burstFx('dust', cx, cy, Math.floor(18 + R * 3), 40 + R * 4, 1.4, undefined);
  burstFx('spark', cx, cy, Math.floor(10 + R * 2), 90 + R * 8, 0.7);
  burstFx('smoke', cx, cy, Math.floor(6 + R), 18, 2.4, undefined, 12);
  burstHeat(cx | 0, cy | 0, R * 1.2, 60 * power);
  wakeRect(x0 - 8, y0 - 8, x1 + 8, y1 + 8, 90);
  edited(x0 - 1, y0 - 1, x1 + 1, y1 + 1);
  const sh = Math.min(10, power * 6 * Math.min(1, 40 / (40 + Math.hypot(cx - G.cam.x, cy - G.cam.y) * 0.15)));
  if (G.cam.shake < sh) G.cam.shake = sh;
  for (const fn of blastFns) fn(cx, cy, R, power);
  return { destroyed };
}
