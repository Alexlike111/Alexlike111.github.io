// Closed centripetal Catmull-Rom track geometry. PURE: no three.js, no DOM, no physics.
// Coordinates: metres, angle 0 = +x, CCW positive. Normal is LEFT of travel direction.
import type { TrackDef, TrackGeometry, TrackSample, Vec2 } from '../types';

/** Target spacing of the resampled centre line (metres). The real spacing is length / count (close to this). */
const TARGET_SPACING = 1;
/** Sub-steps per metre of chord used for the dense pre-sampling of every spline segment. */
const DENSE_PER_METRE = 4;
/** Half window (in samples) of the hinted nearest() search. */
const HINT_WINDOW = 24;
/** If the hinted search ends further than this from the centre line, fall back to a global search. */
const HINT_FALLBACK_DIST = 30;
/** ... and also when it ends further than this beyond the road edge (m). */
const HINT_OFFROAD_MARGIN = 1;

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Barry-Goldman evaluation of one centripetal Catmull-Rom segment (p1 -> p2) at u in [0,1]. */
function crPoint(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, u: number, out: Vec2): void {
  const d01 = Math.max(Math.sqrt(Math.hypot(p1.x - p0.x, p1.y - p0.y)), 1e-4);
  const d12 = Math.max(Math.sqrt(Math.hypot(p2.x - p1.x, p2.y - p1.y)), 1e-4);
  const d23 = Math.max(Math.sqrt(Math.hypot(p3.x - p2.x, p3.y - p2.y)), 1e-4);
  const t0 = 0, t1 = t0 + d01, t2 = t1 + d12, t3 = t2 + d23;
  const t = t1 + (t2 - t1) * u;
  const lerp = (a: Vec2, b: Vec2, ta: number, tb: number): Vec2 => {
    const k = (t - ta) / (tb - ta);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  const c = lerp(b1, b2, t1, t2);
  out.x = c.x; out.y = c.y;
}

/** Dense closed polyline (not evenly spaced) through the control points. Returns points WITHOUT repeating the first. */
function densePolyline(ctrl: Vec2[]): Vec2[] {
  const n = ctrl.length;
  const out: Vec2[] = [];
  const tmp = { x: 0, y: 0 };
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
    const chord = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const steps = Math.max(16, Math.ceil(chord * DENSE_PER_METRE));
    for (let k = 0; k < steps; k++) {
      crPoint(p0, p1, p2, p3, k / steps, tmp);
      out.push({ x: tmp.x, y: tmp.y });
    }
  }
  return out;
}

class TrackGeometryImpl implements TrackGeometry {
  readonly def: TrackDef;
  readonly length: number;
  readonly samples: TrackSample[];
  readonly startS = 0;
  /** Real distance between consecutive samples (length / count). */
  readonly spacing: number;
  private readonly n: number;

  constructor(def: TrackDef, samples: TrackSample[], length: number) {
    this.def = def;
    this.samples = samples;
    this.length = length;
    this.n = samples.length;
    this.spacing = length / samples.length;
  }

  sampleAt(s: number): TrackSample {
    const L = this.length;
    let w = s % L;
    if (w < 0) w += L;
    const f = w / this.spacing;
    let i = Math.floor(f);
    if (i >= this.n) i = this.n - 1;
    const t = f - i;
    const a = this.samples[i], b = this.samples[(i + 1) % this.n];
    let tx = a.tx + (b.tx - a.tx) * t;
    let ty = a.ty + (b.ty - a.ty) * t;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    return {
      s: w,
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      tx, ty, nx: -ty, ny: tx,
      curvature: a.curvature + (b.curvature - a.curvature) * t,
    };
  }

  nearest(x: number, y: number, hintS?: number): { s: number; lateral: number } {
    let best: { s: number; lateral: number; d2: number };
    if (hintS !== undefined && Number.isFinite(hintS)) {
      let h = hintS % this.length;
      if (h < 0) h += this.length;
      const centre = Math.round(h / this.spacing);
      best = this.search(x, y, centre - HINT_WINDOW, centre + HINT_WINDOW);
      // off the road (beyond the edge + 1 m) another part of the track can be closer than the hinted one (an infield gap or
      // a wall breach narrower than the window): check globally and keep the closer answer
      const off = Math.min(HINT_FALLBACK_DIST, this.def.width / 2 + HINT_OFFROAD_MARGIN);
      if (best.d2 > off * off) {
        const g = this.search(x, y, 0, this.n - 1);
        if (g.d2 < best.d2) best = g;
      }
    } else {
      best = this.search(x, y, 0, this.n - 1);
    }
    return { s: best.s, lateral: best.lateral };
  }

  /** Brute-force over segments i..i+1 for i in [from, to] (indices wrap). */
  private search(x: number, y: number, from: number, to: number): { s: number; lateral: number; d2: number } {
    const n = this.n, S = this.samples;
    let bestD2 = Infinity, bestS = 0, bestLat = 0;
    for (let k = from; k <= to; k++) {
      const i = ((k % n) + n) % n;
      const a = S[i], b = S[(i + 1) % n];
      let ex = b.x - a.x, ey = b.y - a.y;
      // wrap-around guard (never needed for closed track but keeps maths safe)
      const el2 = ex * ex + ey * ey;
      let t = el2 > 1e-12 ? ((x - a.x) * ex + (y - a.y) * ey) / el2 : 0;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const px = a.x + ex * t, py = a.y + ey * t;
      const dx = x - px, dy = y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        let nx = a.nx + (b.nx - a.nx) * t, ny = a.ny + (b.ny - a.ny) * t;
        const nl = Math.hypot(nx, ny) || 1;
        nx /= nl; ny /= nl;
        bestLat = dx * nx + dy * ny;
        bestS = (i + t) * this.spacing;
      }
    }
    if (bestS >= this.length) bestS -= this.length;
    return { s: bestS, lateral: bestLat, d2: bestD2 };
  }
}

/**
 * Build TrackGeometry from a TrackDef: closed centripetal Catmull-Rom through def.points,
 * resampled to evenly spaced samples (~1 m apart, last != first).
 */
export function buildTrackGeometry(def: TrackDef): TrackGeometry {
  if (def.points.length < 3) throw new Error(`track ${def.id}: need at least 3 control points`);
  const dense = densePolyline(def.points);
  const m = dense.length;
  // cumulative arc length
  const cum = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) {
    const a = dense[i], b = dense[(i + 1) % m];
    cum[i + 1] = cum[i] + Math.hypot(b.x - a.x, b.y - a.y);
  }
  const total = cum[m];
  const count = Math.max(8, Math.round(total / TARGET_SPACING));
  const spacing = total / count;

  // uniform resample
  const px = new Float64Array(count), py = new Float64Array(count);
  let j = 0;
  for (let i = 0; i < count; i++) {
    const target = i * spacing;
    while (j < m - 1 && cum[j + 1] <= target) j++;
    const a = dense[j], b = dense[(j + 1) % m];
    const segLen = cum[j + 1] - cum[j];
    const t = segLen > 1e-9 ? (target - cum[j]) / segLen : 0;
    px[i] = a.x + (b.x - a.x) * t;
    py[i] = a.y + (b.y - a.y) * t;
  }

  // tangents (central differences) and heading
  const tx = new Float64Array(count), ty = new Float64Array(count), th = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const a = (i - 1 + count) % count, b = (i + 1) % count;
    let dx = px[b] - px[a], dy = py[b] - py[a];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    tx[i] = dx; ty[i] = dy; th[i] = Math.atan2(dy, dx);
  }
  // curvature = d(heading)/ds, smoothed with a cyclic box filter
  const kraw = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const a = (i - 2 + count) % count, b = (i + 2) % count;
    kraw[i] = wrapAngle(th[b] - th[a]) / (4 * spacing);
  }
  const SM = 2;
  const samples: TrackSample[] = new Array(count);
  for (let i = 0; i < count; i++) {
    let k = 0;
    for (let d = -SM; d <= SM; d++) k += kraw[(i + d + count) % count];
    k /= 2 * SM + 1;
    samples[i] = {
      s: i * spacing,
      x: px[i], y: py[i],
      tx: tx[i], ty: ty[i],
      nx: -ty[i], ny: tx[i],
      curvature: k,
    };
  }
  return new TrackGeometryImpl(def, samples, total);
}

// ---------------------------------------------------------------------------------------------
// Validation helpers (used by tests and by the dev editor)
// ---------------------------------------------------------------------------------------------

export interface TrackStats {
  length: number;
  /** Largest |curvature| (1/m). */
  maxCurvature: number;
  /** Smallest turn radius of the centre line (m). */
  minRadius: number;
  /** Smallest distance between centre-line points that are far apart along the track (m). */
  minSeparation: number;
  /** Samples (index pairs) closer than `required`. */
  conflicts: { i: number; j: number; dist: number }[];
}

/**
 * Required centre-line clearance between two different parts of the track so that roads, run-off and
 * both walls of the parts never overlap. `wallOffset`/`wallThickness` come from CONFIG.destruction.
 */
export function requiredClearance(width: number, wallOffset: number, wallThickness: number, margin = 2): number {
  return width + 2 * wallOffset + wallThickness + margin;
}

/** Analyse a built track: curvature extremes and self-clearance. O(n^2), fine for ~1000 samples. */
export function analyseTrack(geom: TrackGeometry, required: number, maxConflicts = 64): TrackStats {
  const S = geom.samples, n = S.length;
  const spacing = geom.length / n;
  let maxK = 0;
  for (const s of S) maxK = Math.max(maxK, Math.abs(s.curvature));
  // points closer than this along the track are "the same part" (grows with the clearance: chord >= 2a/pi)
  const minArc = Math.max(45, (Math.PI * required) / 2 + 8);
  const minIdx = Math.ceil(minArc / spacing);
  let minSep = Infinity;
  const conflicts: { i: number; j: number; dist: number }[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let di = j - i;
      if (di > n - di) di = n - di;
      if (di < minIdx) continue;
      const dx = S[i].x - S[j].x, dy = S[i].y - S[j].y;
      const d2 = dx * dx + dy * dy;
      if (d2 < minSep * minSep || minSep === Infinity) minSep = Math.sqrt(d2);
      if (d2 < required * required && conflicts.length < maxConflicts) conflicts.push({ i, j, dist: Math.sqrt(d2) });
    }
  }
  return {
    length: geom.length,
    maxCurvature: maxK,
    minRadius: maxK > 1e-9 ? 1 / maxK : Infinity,
    minSeparation: minSep,
    conflicts,
  };
}
