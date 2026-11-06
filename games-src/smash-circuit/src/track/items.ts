// Where the boost pads and item boxes go on a track. PURE and deterministic (reads the spline only), so every
// track gets the same layout on every load and the dev editor / tests can ask for it.
//
// Pads: the exits of the tightest corners (drift -> pad), plus the start of the longest straight.
// Boxes: a row of `perRow` boxes across the road about every `rowEvery` metres, on calm road, away from pads and the start line.
import { CONFIG } from '../config';
import type { TrackGeometry } from '../types';

const P = CONFIG.items.pad;
const B = CONFIG.items.box;

export interface PadDef { s: number; x: number; y: number; angle: number; length: number; width: number }
export interface BoxDef { s: number; x: number; y: number; row: number }
export interface ItemLayout { pads: PadDef[]; boxes: BoxDef[] }

/** Distance along the loop from s to the start line (s = 0), in [0, L/2]. */
function lineDist(s: number, L: number): number {
  const d = ((s % L) + L) % L;
  return Math.min(d, L - d);
}
function loopDist(a: number, b: number, L: number): number {
  const d = Math.abs(((a - b) % L + L) % L);
  return Math.min(d, L - d);
}

interface Run { s0: number; s1: number; peak: number }

/** Cyclic runs where pred(sample) holds; gaps shorter than `gap` samples are merged. */
function runs(g: TrackGeometry, pred: (k: number) => boolean, gap: number): Run[] {
  const S = g.samples, n = S.length, step = g.length / n;
  const hot = S.map((s) => pred(Math.abs(s.curvature)));
  const first = hot.indexOf(false);
  if (first < 0) return [{ s0: 0, s1: g.length, peak: 0 }];
  const out: Run[] = [];
  let cur: { a: number; b: number; peak: number } | null = null;
  let quiet = 0;
  for (let q = 1; q <= n; q++) {
    const i = (first + q) % n;
    if (hot[i]) {
      if (!cur) cur = { a: q, b: q, peak: 0 };
      cur.b = q; quiet = 0;
      cur.peak = Math.max(cur.peak, Math.abs(S[i].curvature));
    } else if (cur) {
      quiet++;
      if (quiet > gap) { out.push({ s0: ((first + cur.a) % n) * step, s1: ((first + cur.b) % n) * step, peak: cur.peak }); cur = null; quiet = 0; }
    }
  }
  if (cur) out.push({ s0: ((first + cur.a) % n) * step, s1: ((first + cur.b) % n) * step, peak: cur.peak });
  return out;
}

function runLen(r: Run, L: number): number { return ((r.s1 - r.s0) % L + L) % L; }

export function planItems(track: TrackGeometry): ItemLayout {
  const L = track.length;
  const pads: PadDef[] = [];
  const makePad = (s: number): PadDef => {
    const t = track.sampleAt(s);
    return { s: ((s % L) + L) % L, x: t.x, y: t.y, angle: Math.atan2(t.ty, t.tx), length: P.length, width: P.width };
  };
  const padOk = (s: number): boolean => {
    if (lineDist(s, L) < P.minFromLine) return false;
    for (const p of pads) if (loopDist(p.s, s, L) < P.minSpacing) return false;
    // the whole pad must lie on a calm piece of road (a pad in the middle of a hairpin cannot be hit)
    for (let d = -P.length / 2; d <= P.length / 2; d += 1.5) if (Math.abs(track.sampleAt(s + d).curvature) > 0.02) return false;
    return true;
  };

  // ---- corner exits, tightest first
  const want = P.cornersPerTrack[track.def.id] ?? P.cornersDefault;
  const corners = runs(track, (k) => k > CONFIG.destruction.cornerCurvature, 14).sort((a, b) => b.peak - a.peak);
  let placed = 0;
  for (const c of corners) {
    if (placed >= want) break;
    for (const off of [P.exitOffset, P.exitOffset + 8, P.exitOffset + 16, P.exitOffset - 5]) {
      const s = c.s1 + off;
      if (padOk(s)) { pads.push(makePad(s)); placed++; break; }
    }
  }

  // ---- start of the longest straight
  const straights = runs(track, (k) => k < P.straightMaxCurv, 4).sort((a, b) => runLen(b, L) - runLen(a, L));
  for (const st of straights) {
    let done = false;
    for (let off = P.straightOffset; off < Math.min(runLen(st, L) - 10, 120) && !done; off += 12) {
      const s = st.s0 + off;
      if (padOk(s)) { pads.push(makePad(s)); done = true; }
    }
    if (done) break;
  }

  // ---- item box rows
  const boxes: BoxDef[] = [];
  const rows = Math.max(2, Math.round(L / B.rowEvery));
  const calm = (s: number): number => {
    let worst = 0;
    for (let d = -B.calmSpan; d <= B.calmSpan; d += 5) worst = Math.max(worst, Math.abs(track.sampleAt(s + d).curvature));
    return worst;
  };
  const rowOk = (s: number): boolean => {
    if (lineDist(s, L) < B.minFromLine) return false;
    for (const p of pads) if (loopDist(p.s, s, L) < B.padClear) return false;
    return true;
  };
  for (let r = 0; r < rows; r++) {
    const ideal = ((r + 0.5) / rows) * L;
    let best = -1, bestScore = Infinity;
    for (let off = 0; off <= B.search; off += 4) {
      for (const sg of off === 0 ? [1] : [1, -1]) {
        const s = ideal + sg * off;
        if (!rowOk(s)) continue;
        const k = calm(s);
        const score = (k > B.calmCurv ? 1000 + k * 1000 : 0) + off * 0.01;
        if (score < bestScore) { bestScore = score; best = s; }
      }
    }
    if (best < 0) continue;
    const t = track.sampleAt(best);
    const half = ((B.perRow - 1) / 2);
    for (let i = 0; i < B.perRow; i++) {
      const lat = (i - half) * B.lane * track.def.width;
      boxes.push({ s: ((best % L) + L) % L, x: t.x + t.nx * lat, y: t.y + t.ny * lat, row: r });
    }
  }
  return { pads, boxes };
}

