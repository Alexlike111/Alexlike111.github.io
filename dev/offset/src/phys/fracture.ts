// Voronoi fracture of convex polygons by half-plane clipping. All results are convex → cheap convex-hull colliders.
import { clipHalfPlane, cleanPoly, polyArea } from '../core/math';
import type { Rng } from '../core/rng';

/** Split convex `poly` into Voronoi cells of `seeds` (flat xy). Returns cells with |area| > minArea. */
export function voronoi(poly: number[], seeds: number[], minArea = 0.0008): number[][] {
  const n = seeds.length >> 1; const out: number[][] = [];
  if (n <= 1) return [poly.slice()];
  const order: number[] = new Array(n - 1);
  for (let i = 0; i < n; i++) {
    const sx = seeds[i * 2], sy = seeds[i * 2 + 1];
    let k = 0; for (let j = 0; j < n; j++) if (j !== i) order[k++] = j;
    order.sort((a, b) => ((seeds[a * 2] - sx) ** 2 + (seeds[a * 2 + 1] - sy) ** 2) - ((seeds[b * 2] - sx) ** 2 + (seeds[b * 2 + 1] - sy) ** 2));
    let cell = poly; let maxR2 = 0;
    for (let v = 0; v < cell.length; v += 2) maxR2 = Math.max(maxR2, (cell[v] - sx) ** 2 + (cell[v + 1] - sy) ** 2);
    for (let q = 0; q < order.length; q++) {
      const j = order[q]; const dx = seeds[j * 2] - sx, dy = seeds[j * 2 + 1] - sy; const d2 = dx * dx + dy * dy;
      if (d2 > 4 * maxR2) break; // bisector is beyond the cell
      if (d2 < 1e-10) continue;
      cell = clipHalfPlane(cell, sx + dx * 0.5, sy + dy * 0.5, dx, dy);
      if (cell.length < 6) break;
      maxR2 = 0; for (let v = 0; v < cell.length; v += 2) maxR2 = Math.max(maxR2, (cell[v] - sx) ** 2 + (cell[v + 1] - sy) ** 2);
    }
    const c = cleanPoly(cell); if (c && Math.abs(polyArea(c)) > minArea) out.push(c);
  }
  return out;
}

export function polyBounds(p: ArrayLike<number>): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < p.length; i += 2) { if (p[i] < x0) x0 = p[i]; if (p[i] > x1) x1 = p[i]; if (p[i + 1] < y0) y0 = p[i + 1]; if (p[i + 1] > y1) y1 = p[i + 1]; }
  return [x0, y0, x1, y1];
}

/** jittered grid seeds covering the polygon's bounds */
export function gridSeeds(poly: number[], cell: number, rng: Rng, jitter = 0.38, stretchX = 1): number[] {
  const [x0, y0, x1, y1] = polyBounds(poly); const s: number[] = [];
  const cw = cell * stretchX; const nx = Math.max(1, Math.round((x1 - x0) / cw)), ny = Math.max(1, Math.round((y1 - y0) / cell));
  const dx = (x1 - x0) / nx, dy = (y1 - y0) / ny;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const off = (j & 1) ? 0.25 : -0.25;
    s.push(x0 + (i + 0.5 + off * (nx > 1 ? 1 : 0)) * dx + rng.range(-jitter, jitter) * dx, y0 + (j + 0.5) * dy + rng.range(-jitter, jitter) * dy);
  }
  return s;
}

/** seeds clustered around an impact point (more, smaller pieces near the hit). aniso>1 → long splinters along angle `ang` */
export function impactSeeds(poly: number[], hx: number, hy: number, count: number, rng: Rng, aniso = 1, ang = 0): number[] {
  const [x0, y0, x1, y1] = polyBounds(poly); const s: number[] = [];
  const cx = Math.min(x1, Math.max(x0, hx)), cy = Math.min(y1, Math.max(y0, hy));
  const R = Math.hypot(x1 - x0, y1 - y0) * 0.6; const c = Math.cos(ang), sn = Math.sin(ang);
  for (let i = 0; i < count; i++) {
    const a = rng.range(0, Math.PI * 2); const r = R * Math.pow(rng.next(), 1.6) + 0.02;
    let lx = Math.cos(a) * r * aniso, ly = Math.sin(a) * r / aniso;
    s.push(Math.min(x1, Math.max(x0, cx + lx * c - ly * sn)), Math.min(y1, Math.max(y0, cy + lx * sn + ly * c)));
  }
  return s;
}

/** brick / plank pattern: array of rect polys inside an axis-aligned rect */
export function bricks(x: number, y: number, w: number, h: number, bw: number, bh: number, stagger = true): number[][] {
  const rows = Math.max(1, Math.round(h / bh)); const rh = h / rows; const out: number[][] = [];
  const cols = Math.max(1, Math.round(w / bw)); const cw = w / cols;
  for (let r = 0; r < rows; r++) {
    const yy = y + r * rh; const odd = stagger && (r & 1) === 1 && cols > 1;
    if (!odd) { for (let c = 0; c < cols; c++) out.push(rectPoly(x + c * cw, yy, cw, rh)); }
    else {
      out.push(rectPoly(x, yy, cw * 0.5, rh));
      for (let c = 0; c < cols - 1; c++) out.push(rectPoly(x + cw * 0.5 + c * cw, yy, cw, rh));
      out.push(rectPoly(x + w - cw * 0.5, yy, cw * 0.5, rh));
    }
  }
  return out;
}
export const rectPoly = (x: number, y: number, w: number, h: number): number[] => [x, y, x + w, y, x + w, y + h, x, y + h];
