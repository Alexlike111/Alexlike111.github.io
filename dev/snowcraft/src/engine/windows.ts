// Warm window glow: while a stove / brazier / fat lamp burns inside a building, its glass tiles glow amber and spill a soft pool of light on the snow outside.
// Purely visual (an additive layer after the light pass, so it also reads on the dark side of a building); the igloo's own glow comes from light.ts and is untouched.
// Glass tiles near lit indoor fixtures are re-scanned once a second, so it costs a handful of cell reads per second and nothing when nothing burns.
import { G } from '../game/state';
import type { View } from '../game/state';
import { addLayer } from './render';
import { W, H, TS, mat } from './grid';
import { MAT } from '../content/materials';

interface Win { x: number; y: number; w: number; h: number; dir: 1 | -1; k: number }
const wins: Win[] = [];
const WARM_KIND: Record<string, number> = { stove: 1, brazier: 0.85, fat_lamp: 0.55, lantern: 0.35, ceiling_lamp: 0.9, heater: 0.4 };
let scanT = -9, lastT = 0;
export const windowGlow = { count: 0 };

function scan() {
  wins.length = 0;
  const seen = new Set<number>();
  for (const f of G.fixtures) {
    const k = WARM_KIND[f.kind]; if (!k || !f.lit) continue;
    const fx = f.tx * TS + f.tw * 2, fy = f.ty * TS + f.th * 2;
    const x0 = Math.max(1, fx - 84), x1 = Math.min(W - 2, fx + 84), y0 = Math.max(1, fy - 44), y1 = Math.min(H - 2, fy + 24);
    for (let ty = y0 >> 2; ty <= y1 >> 2; ty++) for (let tx = x0 >> 2; tx <= x1 >> 2; tx++) {
      let n = 0;
      for (let j = 0; j < TS; j++) for (let i = 0; i < TS; i++) if (mat[(ty * TS + j) * W + tx * TS + i] === MAT.GLASS) n++;
      if (n < 6) continue;
      const key = ty * 4096 + tx;
      const old = seen.has(key); seen.add(key);
      const wx = tx * TS, wy = ty * TS;
      const dir: 1 | -1 = wx + 2 < fx ? -1 : 1;
      if (old) { const w = wins.find(q => q.x === wx && q.y === wy); if (w && k > w.k) w.k = k; continue; }
      wins.push({ x: wx, y: wy, w: TS, h: TS, dir, k });
    }
  }
  windowGlow.count = wins.length;
}

function draw(ctx: CanvasRenderingContext2D, v: View) {
  const dt = Math.min(0.5, Math.max(0, v.t - lastT)); lastT = v.t; void dt;
  if (v.t - scanT > 1 || v.t < scanT) { scanT = v.t; scan(); }
  if (!wins.length) return;
  const night = 0.55 + 0.45 * (1 - Math.max(0, Math.min(1, G.daylight)));
  for (const w of wins) {
    if (w.x + 40 < v.x0 || w.x - 40 > v.x0 + v.w || w.y + 40 < v.y0 || w.y - 40 > v.y0 + v.h) continue;
    const fl = 0.9 + 0.1 * Math.sin(v.t * 11 + w.x) * Math.sin(v.t * 5.3 + w.y);
    const a = w.k * fl * night;
    const cx = w.x + w.w / 2 - v.x0, cy = w.y + w.h / 2 - v.y0;
    // soft pool of light on the snow in front of the window (outside = the side away from the fire)
    const ox = cx + w.dir * 7, oy = cy + 7;
    const g = ctx.createRadialGradient(ox, oy, 1, ox, oy, 36);
    g.addColorStop(0, `rgba(255,176,86,${(0.42 * a).toFixed(3)})`); g.addColorStop(0.5, `rgba(255,140,60,${(0.11 * a).toFixed(3)})`); g.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = g; ctx.fillRect(ox - 37, oy - 37, 74, 74);
    // the pane: warm core, a bright 2x2 heart, a dark mullion cross is left to the wall behind (additive blending cannot darken)
    ctx.fillStyle = `rgba(255,170,70,${(0.85 * a).toFixed(3)})`; ctx.fillRect(w.x - v.x0, w.y - v.y0, w.w, w.h);
    ctx.fillStyle = `rgba(255,232,170,${(0.7 * a).toFixed(3)})`; ctx.fillRect(w.x - v.x0 + 1, w.y - v.y0 + 1, 2, 2);
    // a faint halo around the frame
    ctx.fillStyle = `rgba(255,150,60,${(0.22 * a).toFixed(3)})`;
    ctx.fillRect(w.x - v.x0 - 1, w.y - v.y0 - 1, w.w + 2, 1); ctx.fillRect(w.x - v.x0 - 1, w.y - v.y0 + w.h, w.w + 2, 1);
    ctx.fillRect(w.x - v.x0 - 1, w.y - v.y0, 1, w.h); ctx.fillRect(w.x - v.x0 + w.w, w.y - v.y0, 1, w.h);
  }
}

export function initWindowGlow() { addLayer(7, draw); }
