// Small helpers shared by the render modules (no three.js import here).

/** mulberry32. Render-side randomness (decor placement, particle jitter); the sim has its own seeded rng. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Frame-rate independent exponential smoothing factor. */
export const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);
export const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Uniform grid of points for "distance to the track" queries (decor placement). */
export class PointGrid {
  private cells = new Map<number, number[]>();
  constructor(private xs: number[], private ys: number[], readonly cell: number) {
    for (let i = 0; i < xs.length; i++) {
      const k = this.key(Math.floor(xs[i] / cell), Math.floor(ys[i] / cell));
      let c = this.cells.get(k);
      if (!c) this.cells.set(k, (c = []));
      c.push(i);
    }
  }
  private key(cx: number, cy: number): number { return (cx + 4096) * 8192 + (cy + 4096); }
  /** Min distance to any stored point, searching +-1 cell (exact for distances < cell). Returns >= cell if nothing near. */
  nearest(x: number, y: number): number {
    const cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell);
    let best = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const c = this.cells.get(this.key(cx + dx, cy + dy));
        if (!c) continue;
        for (const i of c) {
          const d = Math.hypot(this.xs[i] - x, this.ys[i] - y);
          if (d < best) best = d;
        }
      }
    }
    return best;
  }
}
