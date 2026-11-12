export const TAU = Math.PI * 2;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const sat = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smooth = (t: number) => { t = sat(t); return t * t * (3 - 2 * t); };
export const sign = (v: number) => (v < 0 ? -1 : v > 0 ? 1 : 0);
export const hypot = Math.hypot;
export const approach = (v: number, target: number, maxDelta: number) =>
  v < target ? Math.min(v + maxDelta, target) : Math.max(v - maxDelta, target);
/** frame-rate independent exponential smoothing factor */
export const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - sat(t), 3);
export const easeOutBack = (t: number) => { t = sat(t); const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
export const easeInCubic = (t: number) => { t = sat(t); return t * t * t; };
export const angDiff = (a: number, b: number) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

export interface V2 { x: number; y: number }
export const v2 = (x = 0, y = 0): V2 => ({ x, y });

/** spring (semi-implicit) helper: returns [pos, vel] */
export function spring(pos: number, vel: number, target: number, k: number, d: number, dt: number): [number, number] {
  const a = -k * (pos - target) - d * vel;
  vel += a * dt; pos += vel * dt;
  return [pos, vel];
}

// ---------- convex polygon helpers (flat arrays [x0,y0,x1,y1,...]) ----------
export function polyArea(p: ArrayLike<number>): number {
  let a = 0; const n = p.length;
  for (let i = 0; i < n; i += 2) { const j = (i + 2) % n; a += p[i] * p[j + 1] - p[j] * p[i + 1]; }
  return a * 0.5;
}
export function polyCentroid(p: ArrayLike<number>): [number, number, number] {
  let a = 0, cx = 0, cy = 0; const n = p.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n; const c = p[i] * p[j + 1] - p[j] * p[i + 1];
    a += c; cx += (p[i] + p[j]) * c; cy += (p[i + 1] + p[j + 1]) * c;
  }
  if (Math.abs(a) < 1e-9) { let sx = 0, sy = 0; for (let i = 0; i < n; i += 2) { sx += p[i]; sy += p[i + 1]; } return [sx / (n / 2), sy / (n / 2), 0]; }
  return [cx / (3 * a), cy / (3 * a), a * 0.5];
}
/** Clip convex polygon by half-plane: keep points where (p - o)·n <= 0 */
export function clipHalfPlane(p: number[], ox: number, oy: number, nx: number, ny: number): number[] {
  const out: number[] = []; const n = p.length;
  if (n < 6) return out;
  let px = p[n - 2], py = p[n - 1]; let pd = (px - ox) * nx + (py - oy) * ny;
  for (let i = 0; i < n; i += 2) {
    const x = p[i], y = p[i + 1]; const d = (x - ox) * nx + (y - oy) * ny;
    if (d <= 0) {
      if (pd > 0) { const t = pd / (pd - d); out.push(px + (x - px) * t, py + (y - py) * t); }
      out.push(x, y);
    } else if (pd <= 0) { const t = pd / (pd - d); out.push(px + (x - px) * t, py + (y - py) * t); }
    px = x; py = y; pd = d;
  }
  return out;
}
export function pointInConvex(p: ArrayLike<number>, x: number, y: number): boolean {
  const n = p.length; let s = 0;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n; const c = (p[j] - p[i]) * (y - p[i + 1]) - (p[j + 1] - p[i + 1]) * (x - p[i]);
    if (c !== 0) { if (s === 0) s = c > 0 ? 1 : -1; else if ((c > 0 ? 1 : -1) !== s) return false; }
  }
  return true;
}
/** remove near-duplicate / collinear verts; returns null if degenerate */
export function cleanPoly(p: number[], eps = 0.004): number[] | null {
  const out: number[] = []; const n = p.length;
  for (let i = 0; i < n; i += 2) {
    const x = p[i], y = p[i + 1]; const m = out.length;
    if (m >= 2 && Math.abs(out[m - 2] - x) < eps && Math.abs(out[m - 1] - y) < eps) continue;
    out.push(x, y);
  }
  let m = out.length;
  if (m >= 4 && Math.abs(out[0] - out[m - 2]) < eps && Math.abs(out[1] - out[m - 1]) < eps) { out.length = m - 2; m -= 2; }
  if (m < 6) return null;
  return out;
}
