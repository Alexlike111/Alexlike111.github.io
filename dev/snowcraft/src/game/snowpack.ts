// Deep snow (DESIGN §13): "по крышу в сугробах". Layered on top of the terrain that worldgen.ts builds, with its OWN hash noise (no rand() draws),
// so the random stream of everything generated after it (and the world tests that depend on it) does not move.
//   pass A  (before the places are stamped)  lee drifts of the cape hill, the tundra strip and the lee snow field east of the cairn hill (it ends in a ramp down to the station)
//   pass B  (after the places are stamped)   the lee drift against the station house (its east door is buried); the thick roof snow is laid by locations.ts cabin()
//   pass C  (last)                           cornices on cliff edges, background walls behind the new snow
// Snow structure everywhere: a loose crown of 2-4 cells (SNOW, sleeps once settled), below it PACKED snow only (never ticks, so the deep pack is free
// for the simulation): a crust, a wind slab (aux 140-200 = 290-380 kg/m3, the best block snow) in the drifts, settled pack deeper down.
import { W, H, TW, mat, aux, flags, bg } from '../engine/grid';
import { MAT } from '../content/materials';
import { LOC, Terrain, topSolid, worldInfo } from './locations';

const AIR = MAT.AIR, SNOW = MAT.SNOW, PACKED = MAT.PACKED;

let K = 0;                                                    // seed salt
const hash = (a: number, b = 0, c = 0) => { let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177) + Math.imul(K, -1640531535)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const vn = (x: number, s: number) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash(i, s) * (1 - u) + hash(i + 1, s) * u; };
const vf = (x: number, s: number, oct = 3) => { let a = 0.5, t = 0, n = 0; for (let o = 0; o < oct; o++) { t += a * vn(x, s + o * 17); n += a; x *= 2.03; a *= 0.5; } return t / n; };
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const ss = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** What a cell `d` cells below the new surface of column x is made of. slab 0..1 = how wind-packed the drift is. */
function snowCell(x: number, y: number, d: number, slab: number): [number, number] {
  const loose = 2 + ((hash(x, 5) * 3) | 0);                    // loose crown 2..4
  const n = hash(x, y, 9);
  if (d < loose) return [SNOW, Math.round(8 + n * 30 + d * 4)];
  if (d < loose + 2) return [PACKED, Math.round(96 + slab * 40 + n * 20)];                                     // crust
  if (slab > 0.35 && d < loose + 2 + 16 * slab) return [PACKED, Math.round(clamp(138 + slab * 36 + n * 22, 70, 235))];   // wind slab: the block snow
  return [PACKED, Math.round(clamp(100 + slab * 24 + n * 20 + Math.min(d, 40) * 0.7, 70, 235))];              // settled pack
}

/** Lay `h` cells of snow on column x above its current surface row `base` (AIR cells only: boulders, fixtures and walls stay as they are). The
 *  old loose crown under the new load is pressed into pack so the deep snow has no weak flowing layer. */
function lay(x: number, base: number, h: number, slab: number): number {
  if (h <= 0) return base;
  const top = base - h;
  for (let y = base - 1; y >= top; y--) {
    const i = y * W + x;
    if (mat[i] !== AIR) continue;
    const [m, a] = snowCell(x, y, y - top, slab);
    mat[i] = m; aux[i] = a; flags[i] = 0;
  }
  if (h >= 3) for (let y = base; y < base + 6; y++) { const i = y * W + x; if (mat[i] !== SNOW) break; mat[i] = PACKED; aux[i] = Math.min(200, aux[i] + 96); }
  return top;
}

// ---------------------------------------------------------------------------------------------------------------------
/** Pass A: snow added on top of the natural surface, per column. Target depth (snow above the ground, cells): plains 18-28 (1.6-2.5 m), the lee side of
 *  a rise up to ~45; the existing snow counts toward it. Untouched: the mine portal and its trench (x 255-380), the cairn hill and the signal-fire
 *  summit (a wind-scoured crest), the lichen patches (thin snow: the ptarmigan feed there), the station plateau (pass B). */
/** Column of the snow cliff at the east end of the cape's lee drift (a wind-cut face ~25 cells high with a cornice on top; off every route). */
export const CLIFF = 236;

export function tundraSnow(T: Terrain, seed: number) {
  K = (seed * 2654435761) | 0;
  const x0 = 94, x1 = 556;
  const top = (x: number) => { let y = Math.max(60, T.surf[x] - 40); while (y < H - 1 && mat[y * W + x] === AIR) y++; return y; };
  const d0 = (x: number) => { let y = top(x), n = 0; while (n < 80 && (mat[y * W + x] === SNOW || mat[y * W + x] === PACKED)) { y++; n++; } return n; };
  const E = new Float32Array(W), slab = new Float32Array(W);
  for (let x = x0; x < x1; x++) {
    const slopeE = (T.surf[Math.min(W - 1, x + 12)] - T.surf[Math.max(0, x - 12)]) / 24;           // > 0: the ground falls away to the east = the lee of the westerly wind
    const lee = clamp(slopeE, 0, 0.6) / 0.6;
    const n = vf(x / 23 + 3, 1);
    let want = 18 + 10 * n + 24 * lee * ss(0.3, 0.8, vf(x / 41 + 9, 2));                            // target total depth
    const zone = Math.max(x < CLIFF ? ss(140, 176, x) : 0,                                            // the lee side of the cape hill (its windward crest stays scoured), ending in a wind-cut cliff
                          ss(380, 404, x) * (1 - ss(414, 434, x)) * 0.8,                              // tundra strip between the portal and the cairn hill
                          ss(494, 520, x));                                                          // the lee field east of the cairn hill, down to the station hollow
    E[x] = Math.max(0, want - d0(x)) * zone;
    slab[x] = clamp(0.3 + 0.7 * lee, 0, 1);
  }
  // wind-sculpted swell on top (sastrugi), then keep every slope <= 45 degrees (the loose crown must not slide), never higher than the summit, and
  // the field ends in a long ramp that meets the plateau at its own height
  const Y = new Float32Array(W);
  for (let x = x0; x < x1; x++) { const sw = E[x] > 5 ? (vf(x / 5.5 + 40, 4, 2) - 0.45) * 3.2 : 0; Y[x] = T.surf[x] - Math.max(0, E[x] + sw); if (x >= 494) Y[x] = Math.max(Y[x], 228); Y[x] = Math.min(Y[x], T.surf[x]); }
  const relax = (a: number, b: number, left: number, right: number) => {                              // the added snow tapers off at 45 degrees (a seed of -1e9: no taper = a cliff)
    Y[a - 1] = left; Y[b] = right;
    for (let x = a; x < b; x++) Y[x] = Math.max(Y[x], Y[x - 1] - 1);
    for (let x = b - 1; x >= a; x--) Y[x] = Math.max(Y[x], Y[x + 1] - 1);
    for (let x = a; x < b; x++) Y[x] = Math.min(Y[x], T.surf[x]);
  };
  relax(x0, CLIFF, T.surf[x0 - 1], -1e9);
  relax(CLIFF, x1, T.surf[CLIFF - 1] + 99, T.surf[x1]);
  for (let x = x0; x < x1; x++) {
    const h = Math.round(T.surf[x] - Y[x]);
    if (h <= 0) continue;
    T.surf[x] = lay(x, T.surf[x], h, slab[x]);
  }
  // the lichen patches stay bare: the wind scours a bowl around each one (the ptarmigan feed there; steep packed walls)
  for (const l of worldInfo.lichen) {
    if (l.x >= 494) continue;                         // the lee field east of the cairn hill buries its lichen under the drift (the sheltered pocket under the snow)
    for (let x = Math.max(x0, l.x - 9); x <= Math.min(x1 - 1, l.x + l.w + 9); x++) {
      const d = Math.max(0, l.x - x, x - (l.x + l.w)), g = lichenTop(x);
      if (g < 0) continue;
      const allow = g - 1 - Math.floor(d * 1.4);
      for (let y = top(x); y < allow; y++) { const i = y * W + x; if (mat[i] === SNOW || mat[i] === PACKED) { mat[i] = AIR; aux[i] = 0; } }
      T.surf[x] = Math.max(T.surf[x], Math.min(top(x), allow));
    }
  }
}
/** Row of the top of the lichen / ground at column x under the snow (first cell that is not air or snow), or -1. */
function lichenTop(x: number): number { let y = 60; while (y < H - 1 && (mat[y * W + x] === AIR || mat[y * W + x] === SNOW || mat[y * W + x] === PACKED)) y++; return y >= H - 1 ? -1 : y; }

// ---------------------------------------------------------------------------------------------------------------------
/** The buried east door's front (cells): the quest checks that it is clear. crest = how high the drift is above the floor (0 = no drift: nothing to dig). */
export const DOOR = { x0: 0, x1: 0, y0: 0, y1: 0, crest: 0 };

/** The start: on the lee drift a few cells east of the buried door (snow 12-26 cells above the pad, clear 8x20 box).
 *  Returns the spawn column and the row of the ground under the player (the highest surface under the 8-wide box). */
export function makeSpawn(): { x: number; y: number } {
  const wall = LOC.house.R * 4 + 4;
  let sx = wall + 12;
  for (let x = wall + 6; x < wall + 70; x++) {
    const top = topSolid(x, 150), depth = LOC.station.y - top;
    if (depth < 12 || depth > 26) continue;
    let ok = true;
    for (let y = top - 28; y < top && ok; y++) for (let xx = x - 4; xx < x + 4; xx++) if (mat[y * W + xx] !== AIR) { ok = false; break; }
    if (ok) { sx = x; break; }
  }
  let level = 9999; for (let xx = sx - 4; xx < sx + 4; xx++) level = Math.min(level, topSolid(xx, 150));
  return { x: sx, y: level };
}

/** Tests: switch the deep snow passes off (worldgen.ts checks it). */
export const snowpackCfg = { on: true };

/** Pass B: the drift against the station house (its east door is buried): a wind-slab wedge, 30 cells high at the wall, 46 long. */
export function stationSnow(T: Terrain) {
  const F = LOC.station.y;                                              // pad row (floor of the house)
  const R = LOC.house.R, wall = R * 4 + 4;                              // first cell east of the east end wall
  const CREST = 30, LEN = 46;                                           // door is 24 cells tall: the crest buries it with a metre of snow above
  DOOR.x0 = wall; DOOR.x1 = wall + 8; DOOR.y0 = F - 22; DOOR.y1 = F; DOOR.crest = CREST;
  for (let x = wall; x < wall + LEN; x++) {
    const d = x - wall, t = 1 - d / LEN;
    const h = Math.round(CREST * Math.pow(t, 1.7) * (0.96 + 0.08 * vn(x * 0.3, 21)));
    if (h <= 0) continue;
    lay(x, T.surf[x], h, 1);                                             // slab: the best block snow of the first minutes
  }
}

// ---------------------------------------------------------------------------------------------------------------------
/** A snow cornice on the crest at column cx (topY = its top solid row): a cap of packed snow on the crest and a lip hanging out over the drop,
 *  `dir` = +1 east / -1 west. It stands (span <= 6) until the root is cut or something hits it; then it falls as a cluster. */
export function cornice(cx: number, topY: number, dir: 1 | -1, len: number, th: number): number {
  let placed = 0;
  for (let j = -2; j <= len; j++) {
    const x = cx + dir * j, t = j <= 0 ? th : Math.max(1, Math.round(th * (1 - 0.6 * (j - 1) / Math.max(1, len - 1))));
    for (let k = 0; k < t; k++) {
      const y = topY - 1 - k, i = y * W + x;
      if (mat[i] !== AIR) continue;
      const top = k === t - 1;
      mat[i] = top ? SNOW : PACKED; aux[i] = top ? 30 : 150 + ((hash(x, y, 2) * 30) | 0); flags[i] = 0; placed++;
    }
  }
  return placed;
}

/** Pass C: cornices and the background wall behind every new snow cell (so a trench dug into a drift shows snow behind it, not the sky). */
export function finishSnow(T: Terrain) {
  const bt = (x: number) => topSolid(x, 150);
  // cliff edges (the surface falls >= 7 cells within one column towards the east): the cape snow cliff. The iceberg crest carries none: a lip there closes the
  // only way across the fast ice (the walkers, the bear included, climb its east slope).
  for (let x = 100; x < 270; x++) {
    const a = bt(x), b = bt(x + 1);
    if (b - a >= 7 && mat[a * W + x] !== AIR) { cornice(x, a, 1, 8, 5); x += 20; }
  }
  // background wall (snow) behind snow that now stands above the old surface
  for (let ty = 25; ty < 90; ty++) {
    for (let tx = 20; tx < 275; tx++) {
      const i = ty * TW + tx; if (bg[i] !== 0) continue;
      let s = 0; const cx = tx * 4, cy = ty * 4;
      for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) { const m = mat[(cy + dy) * W + cx + dx]; if (m === SNOW || m === PACKED) s++; }
      if (s === 16) bg[i] = 3;                         // only tiles that are snow all through: the edge tiles of a surface keep the sky
    }
  }
  void T;
}
