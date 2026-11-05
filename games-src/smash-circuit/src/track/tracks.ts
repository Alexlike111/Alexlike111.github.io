// The three race tracks. Control points are hand designed (see docs); props are placed by a deterministic,
// seeded generator that reads the spline (corners get hay/tyres/cones/barrels, straights get sparse clutter,
// the outside of the walls gets trees / rocks). The result is plain TrackDef data, identical on every load,
// and exactly what the dev editor exports.
import { CONFIG } from '../config';
import type { PropDef, PropType, TrackDef, TrackGeometry, Vec2 } from '../types';
import { buildTrackGeometry } from './spline';

type Pt = [number, number];
const pts = (a: Pt[]): Vec2[] => a.map(([x, y]) => ({ x, y }));

// ---------------------------------------------------------------------------------------------
// Deterministic prop generator
// ---------------------------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Corner { s0: number; s1: number; apex: number; sign: number; len: number }

/** Contiguous stretches where |curvature| exceeds the corner threshold (cyclic, short gaps merged). */
function findCorners(g: TrackGeometry): Corner[] {
  const S = g.samples, n = S.length, L = g.length;
  const thr = CONFIG.destruction.cornerCurvature;
  const hot: boolean[] = S.map((s) => Math.abs(s.curvature) > thr);
  // close gaps shorter than 14 samples so chicanes stay a single corner
  const GAP = 14;
  const first = hot.indexOf(false);
  if (first < 0) return [];
  const runs: { a: number; b: number }[] = [];
  let cur: { a: number; b: number } | null = null;
  for (let k = 0; k < n; k++) {
    const idx = (first + k) % n;
    if (hot[idx]) {
      if (!cur) cur = { a: k, b: k };
      else if (k - cur.b <= GAP) cur.b = k; // merge
      else { runs.push(cur); cur = { a: k, b: k }; }
    }
  }
  if (cur) runs.push(cur);
  const out: Corner[] = [];
  for (const r of runs) {
    const len = r.b - r.a + 1;
    if (len < 8) continue;
    let apexIdx = (first + r.a) % n, best = 0;
    for (let k = r.a; k <= r.b; k++) {
      const idx = (first + k) % n;
      const kk = S[idx].curvature;
      if (Math.abs(kk) > best) { best = Math.abs(kk); apexIdx = idx; }
    }
    const sp = L / n;
    out.push({
      s0: ((first + r.a) % n) * sp,
      s1: ((first + r.b) % n) * sp,
      apex: apexIdx * sp,
      sign: S[apexIdx].curvature >= 0 ? 1 : -1,
      len: len * sp,
    });
  }
  return out;
}

export interface GenOptions {
  seed: number;
  /** relative weights of corner dressing */
  hay: number; tyres: number; cones: number; barrels: number; crates: number;
  /** straight-section clutter density (0..1 chance per 40 m) */
  clutter: number;
  trees: number; rocks: number;
  /** max distance beyond the wall where decor is scattered */
  decorReach: number;
}

function generateProps(def: TrackDef, opt: GenOptions): PropDef[] {
  const g = buildTrackGeometry({ ...def, props: [] });
  const L = g.length, w = def.width, half = w / 2;
  const D = CONFIG.destruction;
  const wallInner = half + D.wallOffset - D.wall.thickness / 2;   // inner face of the wall (lateral)
  const wallOuter = half + D.wallOffset + D.wall.thickness / 2;   // outer face
  const rnd = mulberry32(opt.seed);
  const props: PropDef[] = [];
  const hash = new Map<string, { x: number; y: number; r: number }[]>();
  const CELL = 6;
  const key = (cx: number, cy: number): string => cx + ',' + cy;

  const radius = (t: PropType): number => {
    const p = D.props[t];
    return Math.max(p.w, p.h) / 2;
  };
  /** half extent across the road when the prop is aligned with the track direction */
  const latExtent = (t: PropType): number => {
    const p = D.props[t];
    return p.shape === 'box' ? p.h / 2 : p.w / 2;
  };
  const free = (x: number, y: number, r: number): boolean => {
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    for (let ix = -1; ix <= 1; ix++) for (let iy = -1; iy <= 1; iy++) {
      const b = hash.get(key(cx + ix, cy + iy));
      if (!b) continue;
      for (const o of b) if (Math.hypot(o.x - x, o.y - y) < o.r + r + 0.15) return false;
    }
    return true;
  };
  const inStartZone = (s: number): boolean => s > L - 80 || s < 16;

  /** Try to place a prop at (s, lat). lat > 0 = left. Returns true when placed. */
  const place = (type: PropType, s: number, lat: number, angle?: number): boolean => {
    const sm = ((s % L) + L) % L;
    const c = g.sampleAt(sm);
    const x = c.x + c.nx * lat, y = c.y + c.ny * lat;
    const r = radius(type);
    const absLat = Math.abs(lat);
    if (inStartZone(sm) && absLat < half + 1.8) return false;
    if (!free(x, y, r)) return false;
    // nothing may sit on a different stretch of road / its walls
    const nn = g.nearest(x, y);
    if (Math.abs(nn.lateral) < absLat - 0.5) return false;
    if (absLat > wallOuter && Math.abs(nn.lateral) < wallOuter + r + 0.4) return false;
    // runoff props must not poke into the walls
    if (absLat < wallInner && absLat + latExtent(type) > wallInner + 0.05 && type !== 'cone') return false;
    const a = angle ?? Math.atan2(c.ty, c.tx);
    props.push({ type, x: +x.toFixed(2), y: +y.toFixed(2), angle: +a.toFixed(3) });
    const k = key(Math.floor(x / CELL), Math.floor(y / CELL));
    let b = hash.get(k);
    if (!b) { b = []; hash.set(k, b); }
    b.push({ x, y, r });
    return true;
  };

  const pick = <T,>(items: [T, number][]): T => {
    let tot = 0;
    for (const [, wgt] of items) tot += wgt;
    let r = rnd() * tot;
    for (const [it, wgt] of items) { r -= wgt; if (r <= 0) return it; }
    return items[items.length - 1][0];
  };

  const runoff = half + 0.85; // lateral of the run-off dressing between road edge and wall

  // ---- corner dressing
  const corners = findCorners(g);
  for (const cn of corners) {
    const outer = -cn.sign; // side of the outside of the turn
    const latOut = outer * runoff, latIn = -outer * runoff;
    const mid = cn.apex;
    // outer run-off: hay bales and tyre stacks around the apex
    const span = Math.max(8, cn.len * 0.45);
    for (let d = -span; d <= span; d += 6.5) {
      const t = pick<PropType>([['hayBale', opt.hay], ['tireStack', opt.tyres * 0.8], ['barrel', opt.barrels * 0.4]]);
      place(t, mid + d, latOut);
    }
    // clipping point: tyres on the inside at the apex
    for (let d = -4; d <= 4; d += 4.5) if (rnd() < 0.7) place('tireStack', mid + d, latIn);
    // entry cones on both edges, a short gauntlet
    const nCones = Math.round(2 + opt.cones * 4);
    for (let i = 0; i < nCones; i++) {
      const s = cn.s0 - 4 - i * 3.5;
      place('cone', s, latOut + (outer > 0 ? -1 : 1) * 1.15);       // on the road edge, outside
      if (rnd() < 0.6) place('cone', s - 1.2, latIn + (outer > 0 ? 1 : -1) * 1.15);
    }
    // exit: barrel cluster + crates on the outer run-off
    const exitS = cn.s1 + 6;
    if (rnd() < 0.4 + opt.barrels * 0.6) {
      for (let i = 0; i < 4; i++) place('barrel', exitS + i * 1.1, latOut);
    }
    if (rnd() < 0.3 + opt.crates * 0.7) {
      const s = exitS + 14;
      place('crate', s, latOut);
      place('crate', s + 1.25, latOut);
    }
    // braking-board sign outside the wall, facing the road
    place('sign', cn.s0 - 24, outer * (wallOuter + 0.9), undefined);
    place('sign', cn.s0 - 24, -outer * (wallOuter + 0.9), undefined);
  }

  // ---- straight clutter
  for (let s = 20; s < L - 20; s += 38) {
    if (rnd() > opt.clutter) continue;
    const side = rnd() < 0.5 ? 1 : -1;
    const lat = side * runoff;
    const t = pick<PropType>([['barrel', opt.barrels], ['tireStack', opt.tyres], ['crate', opt.crates], ['hayBale', opt.hay], ['cone', opt.cones * 0.7]]);
    if (t === 'cone') {
      for (let i = 0; i < 3; i++) place('cone', s + i * 3, side * (half - 0.7));
    } else {
      place(t, s, lat);
      if (rnd() < 0.5) place(t, s + (t === 'hayBale' ? 2 : 1.1), lat);
    }
  }
  // start/finish dressing: tyre stacks right behind the wall line on both sides of the pit straight
  for (const side of [-1, 1]) for (let d = 0; d < 2; d++) place('tireStack', 6 + d * 1.2, side * runoff);

  // ---- decor beyond the walls (trees, rocks)
  const decor = (type: PropType, count: number, minGap: number): void => {
    let placed = 0, tries = 0;
    const mine: { x: number; y: number }[] = [];
    while (placed < count && tries < count * 40) {
      tries++;
      const s = rnd() * L;
      const side = rnd() < 0.5 ? 1 : -1;
      const lat = side * (wallOuter + 1.6 + Math.pow(rnd(), 1.4) * opt.decorReach);
      const c = g.sampleAt(s);
      const x = c.x + c.nx * lat, y = c.y + c.ny * lat;
      let tooClose = false;
      for (const m of mine) if (Math.hypot(m.x - x, m.y - y) < minGap) { tooClose = true; break; }
      if (tooClose) continue;
      if (place(type, s, lat, rnd() * Math.PI * 2)) { mine.push({ x, y }); placed++; }
    }
  };
  decor('tree', opt.trees, 4.2);
  decor('rock', opt.rocks, 4.5);

  return props;
}

const THEME_DEFAULTS: Record<TrackDef['theme'], Omit<GenOptions, 'seed'>> = {
  meadow: { hay: 1.0, tyres: 0.5, cones: 0.8, barrels: 0.5, crates: 0.4, clutter: 0.55, trees: 150, rocks: 14, decorReach: 34 },
  desert: { hay: 0.4, tyres: 0.8, cones: 0.9, barrels: 1.0, crates: 0.9, clutter: 0.6, trees: 46, rocks: 70, decorReach: 40 },
  snow:   { hay: 0.7, tyres: 1.0, cones: 0.7, barrels: 0.7, crates: 0.6, clutter: 0.5, trees: 110, rocks: 36, decorReach: 30 },
};

/** Auto-dress a track (used by the dev editor for new layouts): corner dressing, clutter, decor, by theme. Deterministic per seed. */
export function autoProps(def: TrackDef, seed = 1): PropDef[] {
  return generateProps(def, { seed, ...THEME_DEFAULTS[def.theme] });
}

function makeTrack(def: Omit<TrackDef, 'props'>, opt: GenOptions): TrackDef {
  const full: TrackDef = { ...def, props: [] };
  full.props = generateProps(full, opt);
  return full;
}

// ---------------------------------------------------------------------------------------------
// Tracks. Start line = first control point (s = 0); the grid sits on the straight BEFORE it.
// ---------------------------------------------------------------------------------------------

const T1_OPT: GenOptions = { seed: 1101, hay: 1.0, tyres: 0.5, cones: 0.8, barrels: 0.5, crates: 0.4, clutter: 0.55, trees: 150, rocks: 14, decorReach: 34 };
const T2_OPT: GenOptions = { seed: 2202, hay: 0.4, tyres: 0.8, cones: 0.9, barrels: 1.0, crates: 0.9, clutter: 0.6, trees: 46, rocks: 70, decorReach: 40 };
const T3_OPT: GenOptions = { seed: 3303, hay: 0.7, tyres: 1.0, cones: 0.7, barrels: 0.7, crates: 0.6, clutter: 0.5, trees: 110, rocks: 36, decorReach: 30 };

/** t1 Meadow: wide (14 m), flowing kidney shape, only gentle bends and one lazy S. Beginner. ~880 m. */
const T1 = makeTrack({
  id: 't1', nameKey: 'track.t1', theme: 'meadow', laps: 3, width: 14, wallStyle: 'fence',
  points: pts([[51, 0], [85, 0], [145, -7], [191, 13], [217, 51], [213, 98], [179, 128], [136, 128], [98, 102], [60, 98], [21, 119], [-21, 145], [-72, 146], [-115, 119], [-127, 72], [-110, 26], [-51, 0], [-17, 0], [17, 0]]),
}, T1_OPT);

/** t2 Desert: clockwise, long start straight, fast double-apex sweeper, an S-kink chicane on the back straight and a tight final hairpin-ish right. ~975 m. */
const T2 = makeTrack({
  id: 't2', nameKey: 'track.t2', theme: 'desert', laps: 3, width: 12, wallStyle: 'concrete',
  points: pts([[43, 0], [86, 0], [163, 0], [215, -7], [258, -30], [277, -73], [258, -112], [215, -129], [168, -127], [133, -120], [108, -110], [86, -126], [67, -148], [39, -153], [7, -146], [-30, -133], [-73, -120], [-107, -103], [-129, -69], [-127, -30], [-107, -7], [-77, 0], [-38, 0], [0, 0]]),
}, T2_OPT);

/** t3 Snow: narrow (9 m), three real hairpins (R 12-15 m), kinks between them. Technical. ~780 m. */
const T3 = makeTrack({
  id: 't3', nameKey: 'track.t3', theme: 'snow', laps: 3, width: 9, wallStyle: 'tires',
  points: pts([[35, 0], [60, 0], [105, 0], [115.6, 4.4], [120, 15], [115.6, 25.6], [105, 30], [80, 30], [62, 35], [44, 26], [25, 30], [14.4, 34.4], [10, 45], [14.4, 55.6], [25, 60], [50, 60], [80, 60], [115, 60], [123.5, 63.5], [127, 72], [123.5, 80.5], [115, 84], [92, 84], [66, 93], [36, 82], [10, 84], [-60, 84], [-89.7, 71.7], [-102, 42], [-89.7, 12.3], [-60, 0], [-25, 0], [10, 0]]),
}, T3_OPT);

/**
 * Reverse layout: the same road driven the other way round (stable id `<id>r`). The control points are reversed and rotated so the
 * start line sits on `start` (a control point on a long straight: the grid needs 40 m of straight behind the line).
 * Props are regenerated by the seeded generator with seed + 1, so braking cones, signs and run-off move to the new braking zones.
 */
export function reverseTrack(def: TrackDef, start: Vec2, opt: GenOptions): TrackDef {
  const rev = def.points.slice().reverse();
  const k = rev.findIndex((p) => p.x === start.x && p.y === start.y);
  if (k < 0) throw new Error(`reverseTrack ${def.id}: start point ${start.x},${start.y} is not a control point`);
  const points = rev.slice(k).concat(rev.slice(0, k)).map((p) => ({ x: p.x, y: p.y }));
  return makeTrack({
    id: def.id + 'r', nameKey: 'track.' + def.id + 'r', theme: def.theme, laps: def.laps, width: def.width, wallStyle: def.wallStyle,
    points, reverseOf: def.id,
  }, { ...opt, seed: opt.seed + 1 });
}

const T1R = reverseTrack(T1, { x: 17, y: 0 }, T1_OPT);
const T2R = reverseTrack(T2, { x: 43, y: 0 }, T2_OPT);
const T3R = reverseTrack(T3, { x: 10, y: 0 }, T3_OPT);

/** Exactly three tracks, in unlock order (the track select, the economy and the save work on these). */
export const TRACKS: TrackDef[] = [T1, T2, T3];

/** The same three roads driven the other way round (`t1r`, `t2r`, `t3r`). Not part of the track select; career and quick race pick them by id. */
export const REVERSE_TRACKS: TrackDef[] = [T1R, T2R, T3R];

/** Every layout: the three forward tracks first, then the reverse ones. New layouts are only ever appended; ids are stable. */
export const ALL_TRACKS: TrackDef[] = [...TRACKS, ...REVERSE_TRACKS];

/** `t2r` -> `t2`; a forward id is returned unchanged (the unlock / difficulty slot of a layout is its base track's). */
export function baseTrackId(id: string): string {
  return ALL_TRACKS.find((t) => t.id === id)?.reverseOf ?? id;
}

export function trackById(id: string): TrackDef {
  const t = ALL_TRACKS.find((x) => x.id === id);
  if (!t) throw new Error(`unknown track id: ${id}`);
  return t;
}
