// FX particles (struct-of-arrays) + flying cells that re-enter the grid where they land.
// Pure data + integration: no allocation in stepParticles / drawParticles.
import { W, H, mat, aux, shade, flags, setCell } from './grid';
import { MATS, WALK, PHASE, GLOW_RAD, P_GAS, P_FIRE, P_EMPTY } from '../content/materials';
import { G } from '../game/state';
import type { View } from '../game/state';

export type FxKind = 'flake' | 'spark' | 'smoke' | 'dust' | 'chip' | 'blood' | 'steam' | 'breath' | 'debris';
export const FX_KINDS: FxKind[] = ['flake', 'spark', 'smoke', 'dust', 'chip', 'blood', 'steam', 'breath', 'debris'];
export const K_FLAKE = 0, K_SPARK = 1, K_SMOKE = 2, K_DUST = 3, K_CHIP = 4, K_BLOOD = 5, K_STEAM = 6, K_BREATH = 7, K_DEBRIS = 8;

const MAXFX = 3200;
export const FX = {
  n: 0,
  kind: new Uint8Array(MAXFX),
  x: new Float32Array(MAXFX), y: new Float32Array(MAXFX),
  vx: new Float32Array(MAXFX), vy: new Float32Array(MAXFX),
  life: new Float32Array(MAXFX), max: new Float32Array(MAXFX),
  r: new Uint8Array(MAXFX), g: new Uint8Array(MAXFX), b: new Uint8Array(MAXFX),
  size: new Uint8Array(MAXFX),
  glow: new Uint8Array(MAXFX),   // 1 = drawn in the emissive pass
};

const MAXFC = 4096;
export const FC = {                // flying cells
  n: 0,
  x: new Float32Array(MAXFC), y: new Float32Array(MAXFC),
  vx: new Float32Array(MAXFC), vy: new Float32Array(MAXFC),
  m: new Uint8Array(MAXFC), a: new Uint8Array(MAXFC), s: new Uint8Array(MAXFC),
  age: new Float32Array(MAXFC),
};

// per-kind constants: gravity (cells/s², + = down), drag (1/s), collides with terrain, bounce, default colour, default size
const GRAV = [14, 150, -22, 6, 260, 240, -34, -10, 300];
const DRAG = [0.9, 0.35, 1.0, 1.8, 0.1, 0.1, 0.9, 1.6, 0.05];
const COLL = [0, 1, 0, 0, 1, 1, 0, 0, 1];
const BOUNCE = [0, 0, 0, 0, 0.25, 0, 0, 0, 0.3];
const DEF_RGB: [number, number, number][] = [
  [240, 246, 255], [255, 200, 90], [74, 74, 80], [200, 205, 215], [150, 120, 90], [172, 30, 30], [215, 222, 232], [228, 236, 246], [120, 110, 100],
];
const AMBIENT_KIND = [1, 0, 1, 1, 0, 0, 1, 1, 0]; // kinds thinned out by G.quality

let rs = 1234567;
function rnd() { rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5; return (rs >>> 0) / 4294967296; }
export function seedFx(n: number) { rs = (n >>> 0) || 1; }

const kindId = (k: FxKind | number) => (typeof k === 'number' ? k : FX_KINDS.indexOf(k));

/** Spawn an FX particle. rgb = 0xRRGGBB or [r,g,b]; omitted → kind default. Positions in cells, velocities cells/s, life seconds. */
export function spawnFx(kind: FxKind | number, x: number, y: number, vx: number, vy: number, life: number, rgb?: number | [number, number, number], size = 1): void {
  const k = kindId(kind);
  if (k < 0) return;
  if (AMBIENT_KIND[k] && G.quality < 2 && rnd() > (G.quality === 0 ? 0.35 : 0.7)) return;
  let i = FX.n;
  if (i >= MAXFX) { if (k !== K_SPARK) return; i = (rnd() * MAXFX) | 0; } else FX.n++;
  let r: number, g: number, b: number;
  if (rgb === undefined) { const d = DEF_RGB[k]; r = d[0]; g = d[1]; b = d[2]; }
  else if (typeof rgb === 'number') { r = (rgb >> 16) & 255; g = (rgb >> 8) & 255; b = rgb & 255; }
  else { r = rgb[0]; g = rgb[1]; b = rgb[2]; }
  FX.kind[i] = k; FX.x[i] = x; FX.y[i] = y; FX.vx[i] = vx; FX.vy[i] = vy;
  FX.life[i] = life; FX.max[i] = life; FX.r[i] = r; FX.g[i] = g; FX.b[i] = b; FX.size[i] = size;
  FX.glow[i] = k === K_SPARK || (k === K_DEBRIS && r > 190 && b < 110) ? 1 : 0;
}

/** Convenience: n particles in a random radial burst. */
export function burstFx(kind: FxKind | number, x: number, y: number, n: number, speed: number, life: number, rgb?: number | [number, number, number], up = 0) {
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, s = speed * (0.25 + rnd() * 0.75);
    spawnFx(kind, x, y, Math.cos(a) * s, Math.sin(a) * s - up, life * (0.6 + rnd() * 0.8), rgb);
  }
}

const isWalk = (x: number, y: number) => {
  if (x < 0 || x >= W || y >= H) return true;
  if (y < 0) return false;
  return WALK[mat[y * W + x]] === 1;
};

/** Throw a cell of material m (already removed from the grid by the caller) as a flying cell. It re-enters the grid where it lands. */
export function throwCell(x: number, y: number, m: number, a: number, vx: number, vy: number): boolean {
  if (m === 0) return false;
  const ph = PHASE[m];
  if (ph === P_GAS || ph === P_FIRE || ph === P_EMPTY) { spawnFx('smoke', x, y, vx * 0.3, vy * 0.3, 1.2); return false; }
  if (FC.n >= MAXFC) return false;
  const i = FC.n++;
  FC.x[i] = x; FC.y[i] = y; FC.vx[i] = vx; FC.vy[i] = vy; FC.m[i] = m; FC.a[i] = a; FC.s[i] = (rnd() * 256) | 0; FC.age[i] = 0;
  return true;
}

// candidate landing offsets, nearest first, preferring up/sideways over down
const LAND: number[] = (() => {
  const o: [number, number, number][] = [];
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) o.push([dx, dy, dx * dx + dy * dy * 1.4 + (dy > 0 ? 3 : 0)]);
  o.sort((p, q) => p[2] - q[2]);
  const r: number[] = [];
  for (const e of o) r.push(e[0], e[1]);
  return r;
})();

function landCell(i: number, px: number, py: number): boolean {
  const m = FC.m[i];
  for (let k = 0; k < LAND.length; k += 2) {
    const x = px + LAND[k], y = py + LAND[k + 1];
    if (x < 1 || x >= W - 1 || y < 1 || y >= H - 1) continue;
    const j = y * W + x, t = mat[j];
    if (t === 0 || PHASE[t] === P_GAS || PHASE[t] === P_FIRE) {
      setCell(x, y, m, FC.a[i], 0, true); shade[j] = FC.s[i];
      return true;
    }
  }
  return false;
}

export function stepParticles(dt: number): void {
  if (dt > 0.05) dt = 0.05;
  if (dt <= 0) return;
  // ---- FX ----
  const { kind, x, y, vx, vy, life, max, size } = FX;
  let n = FX.n;
  for (let i = 0; i < n;) {
    const k = kind[i];
    let l = life[i] - dt;
    if (l <= 0) { n--; copyFx(n, i); continue; }
    life[i] = l;
    let ax = 0;
    if (k === K_FLAKE || k === K_DUST) ax = Math.sin((y[i] + l * 3) * 0.7 + i) * 6;
    else if (k === K_SMOKE || k === K_STEAM) ax = (rnd() - 0.5) * 30;
    const d = Math.exp(-DRAG[k] * dt);
    vx[i] = vx[i] * d + ax * dt;
    vy[i] = vy[i] * d + GRAV[k] * dt;
    const nx = x[i] + vx[i] * dt, ny = y[i] + vy[i] * dt;
    if (COLL[k] && isWalk(Math.floor(nx), Math.floor(ny))) {
      if (BOUNCE[k] > 0 && Math.abs(vy[i]) > 8) { vy[i] = -vy[i] * BOUNCE[k]; vx[i] *= 0.6; }
      else { life[i] = 0; continue; }
    } else { x[i] = nx; y[i] = ny; }
    if (k === K_SMOKE && size[i] < 3 && rnd() < dt * 0.8) size[i]++;
    i++;
  }
  FX.n = n;

  // ---- flying cells ----
  const fc = FC;
  let m = fc.n;
  for (let i = 0; i < m;) {
    fc.age[i] += dt;
    fc.vy[i] += 230 * dt;
    fc.vx[i] *= Math.exp(-0.15 * dt);
    const dx = fc.vx[i] * dt, dy = fc.vy[i] * dt;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
    const sx = dx / steps, sy = dy / steps;
    let cx = fc.x[i], cy = fc.y[i];
    let pxc = Math.floor(cx), pyc = Math.floor(cy);
    let dead = false;
    for (let s = 0; s < steps; s++) {
      const nx = cx + sx, ny = cy + sy;
      const ix = Math.floor(nx), iy = Math.floor(ny);
      if (ix === pxc && iy === pyc) { cx = nx; cy = ny; continue; }
      if (ix < 0 || ix >= W || iy >= H) { dead = true; break; }
      if (iy >= 0) {
        const t = mat[iy * W + ix];
        if (!(t === 0 || PHASE[t] === P_GAS || PHASE[t] === P_FIRE)) {
          // hit something: settle in the last free cell
          landCell(i, pxc, pyc);
          dead = true; break;
        }
      }
      cx = nx; cy = ny; pxc = ix; pyc = iy;
    }
    if (!dead && (fc.age[i] > 12)) { landCell(i, pxc, pyc); dead = true; }
    if (dead) { m--; copyFc(m, i); continue; }
    fc.x[i] = cx; fc.y[i] = cy;
    i++;
  }
  fc.n = m;
}

function copyFx(from: number, to: number) {
  if (from === to) return;
  FX.kind[to] = FX.kind[from]; FX.x[to] = FX.x[from]; FX.y[to] = FX.y[from]; FX.vx[to] = FX.vx[from]; FX.vy[to] = FX.vy[from];
  FX.life[to] = FX.life[from]; FX.max[to] = FX.max[from]; FX.r[to] = FX.r[from]; FX.g[to] = FX.g[from]; FX.b[to] = FX.b[from];
  FX.size[to] = FX.size[from]; FX.glow[to] = FX.glow[from];
}
function copyFc(from: number, to: number) {
  if (from === to) return;
  FC.x[to] = FC.x[from]; FC.y[to] = FC.y[from]; FC.vx[to] = FC.vx[from]; FC.vy[to] = FC.vy[from];
  FC.m[to] = FC.m[from]; FC.a[to] = FC.a[from]; FC.s[to] = FC.s[from]; FC.age[to] = FC.age[from];
}

export function clearParticles() { FX.n = 0; FC.n = 0; }

/** Material colour × per-cell shade as 0xRRGGBB (used by flying cells, falling clusters, toppling trees). */
export function cellColor(m: number, s: number): number {
  const d = MATS[m];
  const f = 1 + ((s / 255) - 0.5) * 2 * d.vary;
  const r = Math.min(255, Math.max(0, (d.color[0] * f) | 0));
  const g = Math.min(255, Math.max(0, (d.color[1] * f) | 0));
  const b = Math.min(255, Math.max(0, (d.color[2] * f) | 0));
  return (r << 16) | (g << 8) | b;
}

const styleCache = new Map<number, string>();
function style(rgb: number): string {
  let s = styleCache.get(rgb);
  if (s === undefined) { s = '#' + (rgb | 0x1000000).toString(16).slice(1); styleCache.set(rgb, s); }
  return s;
}
const cellStyle: (string | undefined)[] = new Array(256 * 16);

/** emissive=false (z −10, lit): everything but glowing kinds. emissive=true (z 10, additive): sparks, hot debris, glowing flying cells. */
export function drawParticles(ctx: CanvasRenderingContext2D, v: View, emissive: boolean): void {
  const e = emissive ? 1 : 0;
  const x0 = v.x0, y0 = v.y0, x1 = x0 + v.w, y1 = y0 + v.h;
  const prevAlpha = ctx.globalAlpha;
  let lastRgb = -1;
  for (let i = 0; i < FX.n; i++) {
    if (FX.glow[i] !== e) continue;
    const px = FX.x[i], py = FX.y[i];
    if (px < x0 - 4 || px > x1 + 4 || py < y0 - 4 || py > y1 + 4) continue;
    const k = FX.kind[i];
    const t = FX.life[i] / FX.max[i];
    let a = t;
    if (k === K_FLAKE) a = t > 0.2 ? 0.95 : t * 4.5;
    else if (k === K_SMOKE) a = 0.55 * t;
    else if (k === K_STEAM) a = 0.5 * t;
    else if (k === K_BREATH) a = 0.5 * t;
    else if (k === K_DUST) a = 0.7 * t;
    else if (k === K_SPARK) a = Math.min(1, t * 2);
    else a = Math.min(1, t * 3);
    const rgb = (FX.r[i] << 16) | (FX.g[i] << 8) | FX.b[i];
    if (rgb !== lastRgb) { ctx.fillStyle = style(rgb); lastRgb = rgb; }
    ctx.globalAlpha = a;
    const s = FX.size[i];
    ctx.fillRect(Math.floor(px - x0), Math.floor(py - y0), s, s);
  }
  ctx.globalAlpha = emissive ? 0.9 : 1;
  for (let i = 0; i < FC.n; i++) {
    const m = FC.m[i];
    if ((GLOW_RAD[m] > 0 ? 1 : 0) !== e) continue;
    const px = FC.x[i], py = FC.y[i];
    if (px < x0 - 2 || px > x1 + 2 || py < y0 - 2 || py > y1 + 2) continue;
    const key = m * 16 + (FC.s[i] >> 4);
    let st = cellStyle[key];
    if (st === undefined) { st = style(cellColor(m, (FC.s[i] & 0xf0) | 8)); cellStyle[key] = st; }
    ctx.fillStyle = st;
    ctx.fillRect(Math.floor(px - x0), Math.floor(py - y0), 1, 1);
  }
  ctx.globalAlpha = prevAlpha;
}

// silence unused-import lint for tables used only by other modules' typing
void aux; void flags;
