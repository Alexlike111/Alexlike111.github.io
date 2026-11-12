// Visual effects: paper scraps, dust, rings, post-warps, ink stains. Purely cosmetic, never touches physics.
import { Renderer, Ink, ink, inkAlpha, Blend } from './gl';
import { T } from '../core/tune';
import { vrng } from '../core/rng';
import { TAU } from '../core/math';

const N = T.budget.particles;
export const enum PK { Scrap = 0, Dust = 1, Spark = 2, Drop = 3, Sheet = 4 }

export interface Ring { x: number; y: number; r0: number; r1: number; w: number; t: number; life: number; k: Ink; add: boolean }
export interface Warp { x: number; y: number; r0: number; r1: number; str: number; t: number; life: number }
export interface Stain { x: number; y: number; r: number; k: Ink; seed: number }

export class Fx {
  // struct of arrays
  x = new Float32Array(N); y = new Float32Array(N); vx = new Float32Array(N); vy = new Float32Array(N);
  rot = new Float32Array(N); av = new Float32Array(N); size = new Float32Array(N); life = new Float32Array(N); max = new Float32Array(N);
  kind = new Uint8Array(N); col = new Uint32Array(N);
  n = 0;
  rings: Ring[] = []; warps: Warp[] = []; stains: Stain[] = [];
  groundY = 1e9;
  private add(kind: PK, x: number, y: number, vx: number, vy: number, size: number, k: Ink, life: number): number {
    let i = this.n;
    if (i >= N) { i = (Math.random() * N) | 0; } else this.n++;
    this.kind[i] = kind; this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy; this.size[i] = size; this.col[i] = k; this.life[i] = this.max[i] = life;
    this.rot[i] = Math.random() * TAU; this.av[i] = (Math.random() - 0.5) * 16; return i;
  }
  scrap(x: number, y: number, vx: number, vy: number, size: number, k: Ink, life = 0) { this.add(PK.Scrap, x, y, vx, vy, size, k, life || vrng.range(0.7, 1.5)); }
  sheet(x: number, y: number, vx: number, vy: number, size: number, k: Ink) { this.add(PK.Sheet, x, y, vx, vy, size, k, vrng.range(1.6, 3.2)); }
  dust(x: number, y: number, r: number, k: Ink, vx = 0, vy = 0) { const i = this.add(PK.Dust, x, y, vx + vrng.range(-0.6, 0.6), vy + vrng.range(-0.9, 0.1), r, k, vrng.range(0.5, 0.95)); this.av[i] = 0; }
  spark(x: number, y: number, vx: number, vy: number, k: Ink, life = 0.25, size = 0.05) { this.add(PK.Spark, x, y, vx, vy, size, k, life * vrng.range(0.6, 1.3)); }
  drop(x: number, y: number, vx: number, vy: number, size: number, k: Ink) { this.add(PK.Drop, x, y, vx, vy, size, k, vrng.range(0.5, 1.1)); }
  burst(x: number, y: number, n: number, speed: number, k: Ink, kind: 'spark' | 'scrap' | 'drop' = 'spark', dirx = 0, diry = 0, spread = TAU) {
    const base = Math.atan2(diry, dirx);
    for (let i = 0; i < n; i++) {
      const a = (dirx || diry) ? base + vrng.range(-spread, spread) * 0.5 : vrng.range(0, TAU); const s = speed * vrng.range(0.35, 1);
      if (kind === 'spark') this.spark(x, y, Math.cos(a) * s, Math.sin(a) * s, k);
      else if (kind === 'drop') this.drop(x, y, Math.cos(a) * s, Math.sin(a) * s, vrng.range(0.04, 0.1), k);
      else this.scrap(x, y, Math.cos(a) * s, Math.sin(a) * s, vrng.range(0.05, 0.13), k);
    }
  }
  ring(x: number, y: number, r0: number, r1: number, w: number, life: number, k: Ink, add = false) { if (this.rings.length < 40) this.rings.push({ x, y, r0, r1, w, t: 0, life, k, add }); }
  warp(x: number, y: number, r0: number, r1: number, str: number, life: number) { if (this.warps.length >= 6) this.warps.shift(); this.warps.push({ x, y, r0, r1, str, t: 0, life }); }
  stain(x: number, y: number, r: number, k: Ink) { if (this.stains.length > 140) this.stains.shift(); this.stains.push({ x, y, r, k, seed: Math.random() * 1000 }); }
  clear() { this.n = 0; this.rings.length = 0; this.warps.length = 0; this.stains.length = 0; }

  update(dt: number) {
    const g = T.gravity; const gy = this.groundY;
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { const l = --this.n; if (i !== l) { this.x[i] = this.x[l]; this.y[i] = this.y[l]; this.vx[i] = this.vx[l]; this.vy[i] = this.vy[l]; this.rot[i] = this.rot[l]; this.av[i] = this.av[l]; this.size[i] = this.size[l]; this.life[i] = this.life[l]; this.max[i] = this.max[l]; this.kind[i] = this.kind[l]; this.col[i] = this.col[l]; } i--; continue; }
      const k = this.kind[i];
      if (k === PK.Dust) { this.vx[i] *= 1 - 2.5 * dt; this.vy[i] *= 1 - 2.5 * dt; this.vy[i] -= 0.6 * dt; }
      else if (k === PK.Sheet) { this.vy[i] += g * 0.12 * dt; this.vx[i] += Math.sin(this.life[i] * 7 + i) * 9 * dt; this.vx[i] *= 1 - 1.8 * dt; this.vy[i] *= 1 - 2.2 * dt; }
      else if (k === PK.Spark) { this.vy[i] += g * 0.35 * dt; this.vx[i] *= 1 - 3 * dt; this.vy[i] *= 1 - 3 * dt; }
      else { this.vy[i] += g * (k === PK.Drop ? 0.9 : 0.8) * dt; this.vx[i] *= 1 - 0.9 * dt; }
      this.x[i] += this.vx[i] * dt; this.y[i] += this.vy[i] * dt; this.rot[i] += this.av[i] * dt;
      if (this.y[i] > gy && k !== PK.Dust) {
        this.y[i] = gy;
        if (k === PK.Drop) { this.stain(this.x[i], gy - 0.02, this.size[i] * 1.6, this.col[i]); this.life[i] = 0; }
        else { this.vy[i] *= -0.25; this.vx[i] *= 0.6; this.av[i] *= 0.5; if (Math.abs(this.vy[i]) < 0.8) { this.vy[i] = 0; this.av[i] = 0; } }
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) { const r = this.rings[i]; r.t += dt; if (r.t >= r.life) this.rings.splice(i, 1); }
    for (let i = this.warps.length - 1; i >= 0; i--) { const w = this.warps[i]; w.t += dt; if (w.t >= w.life) this.warps.splice(i, 1); }
  }
  drawStains(R: Renderer) {
    for (const s of this.stains) {
      R.circle(s.x, s.y, s.r, s.k, 9);
      const a = s.seed; R.circle(s.x + Math.cos(a) * s.r * 1.1, s.y + Math.sin(a) * s.r * 0.9, s.r * 0.45, s.k, 7); R.circle(s.x + Math.cos(a * 2.3) * s.r * 1.4, s.y + Math.sin(a * 2.3) * s.r * 1.2, s.r * 0.25, s.k, 6);
    }
  }
  draw(R: Renderer) {
    // dust first (soft, behind crisp particles)
    for (let i = 0; i < this.n; i++) {
      if (this.kind[i] !== PK.Dust) continue;
      const t = 1 - this.life[i] / this.max[i]; const r = this.size[i] * (0.5 + 0.9 * Math.sqrt(t));
      R.circle(this.x[i], this.y[i], r, inkAlpha(this.col[i], (1 - t) * 0.85), 12);
    }
    for (let i = 0; i < this.n; i++) {
      const k = this.kind[i]; if (k === PK.Dust) continue;
      const t = this.life[i] / this.max[i]; const s = this.size[i] * (t < 0.25 ? t * 4 : 1); const x = this.x[i], y = this.y[i];
      if (k === PK.Spark) { const vx = this.vx[i], vy = this.vy[i]; R.taper(x, y, x - vx * 0.045, y - vy * 0.045, s * 1.4, 0.004, this.col[i]); }
      else if (k === PK.Drop) { R.circle(x, y, s, this.col[i], 7); }
      else {
        const c = Math.cos(this.rot[i]) * s, sn = Math.sin(this.rot[i]) * s; const fl = k === PK.Sheet ? Math.cos(this.rot[i] * 1.7) : 0.7;
        R.quad(x - c - sn * fl, y - sn + c * fl, x + c - sn * fl, y + sn + c * fl, x + c * 0.7 + sn * fl, y + sn * 0.7 - c * fl, x - c * 1.1 + sn * fl, y - sn * 1.1 - c * fl, this.col[i]);
      }
    }
    for (const r of this.rings) {
      const t = r.t / r.life; const e = 1 - Math.pow(1 - t, 3); const rad = r.r0 + (r.r1 - r.r0) * e;
      if (r.add) R.setBlend(Blend.Add);
      R.ring(r.x, r.y, rad, r.w * (1 - t) + 0.01, inkAlpha(r.k, 1 - t * t));
      if (r.add) R.setBlend(Blend.Alpha);
    }
  }
  /** write warps into renderer (screen px). toScreen maps world→device px */
  applyWarps(R: Renderer, toScreenX: (x: number) => number, toScreenY: (y: number) => number, ppm: number) {
    const w = R.warps; w.fill(0);
    for (let i = 0; i < this.warps.length && i < 6; i++) {
      const q = this.warps[i]; const t = q.t / q.life; const e = 1 - Math.pow(1 - t, 2.2);
      w[i * 4] = toScreenX(q.x); w[i * 4 + 1] = R.h - toScreenY(q.y); w[i * 4 + 2] = Math.max(1, (q.r0 + (q.r1 - q.r0) * e) * ppm); w[i * 4 + 3] = q.str * ppm * (1 - t) * (1 - t);
    }
  }
}
export const fxInk = { coral: ink(0, 1, 0), indigo: ink(1, 0, 0), sun: ink(0, 0, 1), paper: ink(0, 0, 0), dark: ink(1, 1, 0) };
