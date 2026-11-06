// Cellular snow simulation: granular flow, water, compaction (mass-conserving settlement),
// sintering, wind transport (saltation), snowfall deposition, particles.
import {
  W, H, CH, CW, CHH, M, F_DIST, F_WET, F_DRIFT, BOND_SOLID, mat, dens, bond, flags, body, stamp, awake, idx, inb,
  wakeArea, wakeOwn, wakeLanding, touch, putCell, rigidAt, solidChanged, freshDens, CELL, AWAKE_T,
} from './world';
import { G } from './state';
import { P, PK, spawn, kill } from './particles';
import { tempAt, windAt, surf } from './heat';
import { pnow, pend } from './prof';

let frameStamp = 1;
const pending = new Float32Array(W); // fresh snow (cells) waiting to be deposited per column (outside window)
const acc = new Float32Array(W);     // fractional deposit accumulator per column (inside window)
const PENDING_MAX = 60;
const clampX = (x: number) => (x < 1 ? 1 : x > W - 2 ? W - 2 : x);
const POLE_OFFS = [1, -1, 2, -2, 3, -3, 4, -4];

// ---------- zones ----------
// Near zone = the view plus 1/8 of its size on each side (1.25x the view), run every frame. The rest of G.win (2x the view)
// is the far zone: its automaton chunks run every 8th frame and its slow-pass columns every 16th (over the near rows only).
// Nothing is frozen: every visit covers the real time since the last one, and mass only moves between cells, never created.
const NEAR_K = 0.625;     // near half-size as a share of the G.win half-size (G.win = view +- view)
const FAR_CA_EVERY = 8;   // far chunks run the automaton every 8th frame (power of two)
const SLOW_NEAR = 10;     // near columns are visited by the slow pass every 10th frame ...
const SLOW_FAR = 16;      // ... far columns every 16th; each visit covers the frames since the last one (time-scaled)
let nX0 = 0, nX1 = -1, nY0 = 0, nY1 = -1;
let slowNear = 0, slowFar = 0;
/** Near-zone rectangle in cells: camera centre +- NEAR_K x the view half-size (taken from the larger side, so world-edge clamping of G.win does not shrink it). Allocation-free. */
function updateNear() {
  const w = G.win, c = G.cam;
  const vx = Math.max(c.x - w.x0, w.x1 - c.x), vy = Math.max(c.y - w.y0, w.y1 - c.y);
  nX0 = Math.max(w.x0, Math.floor(c.x - vx * NEAR_K)); nX1 = Math.min(w.x1, Math.ceil(c.x + vx * NEAR_K));
  nY0 = Math.max(w.y0, Math.floor(c.y - vy * NEAR_K)); nY1 = Math.min(w.y1, Math.ceil(c.y + vy * NEAR_K));
}

/** Return a mass-carrying particle's mass to the books (never destroy it). */
function refund(i: number) {
  const k = P.kind[i];
  if (k === PK.FLAKE) { if (P.layer[i] === 0 && P.m[i] > 0) acc[clampX(P.x[i] | 0)] += P.m[i]; }
  else if (k === PK.DRIFT || k === PK.CLUMP) {
    const c = clampX(P.x[i] | 0);
    pending[c] = Math.min(PENDING_MAX, pending[c] + P.d[i] / Math.max(1, freshDens(G.ambientT)));
  }
}
/** Would a grain at air cell (x,y) come to rest on top of a marker pole? (snow must never pile into a standable pillar there) */
function onPole(x: number, y: number): boolean {
  let b = y + 1; while (b < H - 2 && mat[idx(x, b)] === M.AIR) b++;
  return mat[idx(x, b)] === M.POLE;
}
/** Place d at the nearest free air cell at/above (x,y) (also tries neighbour columns). */
function depositNear(x: number, y: number, d: number, fl: number, b: number): boolean {
  x = clampX(x | 0); y = Math.max(1, Math.min(H - 3, y | 0));
  for (let q = 0; q < 3; q++) {
    const xx = x + (q === 0 ? 0 : q === 1 ? 1 : -1);
    if (xx < 1 || xx >= W - 1) continue;
    for (let up = 0; up <= 6; up++) {
      const yy = y - up; if (yy < 1) break;
      const i = idx(xx, yy);
      if (mat[i] === M.AIR && !body[i] && !onPole(xx, yy)) {
        putCell(xx, yy, M.SNOW, d, mat[i + W] !== M.AIR ? b : 0, fl);
        wakeLanding(xx, yy);
        if (surf[xx] > yy) surf[xx] = yy;
        return true;
      }
    }
  }
  return false;
}

const isAirLike = (i: number) => mat[i] === M.AIR;
function canEnter(i: number, m: number) {
  const t = mat[i];
  if (body[i]) return false;
  if (t === M.AIR) return true;
  if (m !== M.WATER && t === M.WATER) return true; // heavier grains sink through water
  return false;
}
/** A move: swap the two cells, then mark both for upload and wake the chunks near each (a move can unblock its neighbours). */
function swap(a: number, b: number) {
  const m = mat[a], d = dens[a], bo = bond[a], f = flags[a];
  mat[a] = mat[b]; dens[a] = dens[b]; bond[a] = bond[b]; flags[a] = flags[b];
  mat[b] = m; dens[b] = d; bond[b] = bo; flags[b] = f;
  stamp[a] = stamp[b] = frameStamp;
  moveMark(a); moveMark(b);
}
function moveMark(i: number) { const x = i % W, y = (i / W) | 0; touch(x, y); wakeArea(x, y); }

/** Set by a grain or ash that was due to slide or creep but whose random roll said wait: its chunk must stay awake. */
let cand = false;

/** Fast pass: granular snow, ash and water motion. Near chunks every frame, far chunks every FAR_CA_EVERY frames.
 *  A chunk sleeps once a full pass changes nothing (no move, no pending slide) for AWAKE_T passes in a row. */
function stepCA() {
  frameStamp = (frameStamp + 1) & 255 || 1;
  const { x0, y0, x1, y1 } = G.win;
  const cx0 = Math.max(0, (x0 / CH) | 0), cx1 = Math.min(CW - 1, (x1 / CH) | 0);
  const cy0 = Math.max(0, (y0 / CH) | 0), cy1 = Math.min(CHH - 1, (y1 / CH) | 0);
  const nc0 = (nX0 / CH) | 0, nc1 = (nX1 / CH) | 0, nr0 = (nY0 / CH) | 0, nr1 = (nY1 / CH) | 0;
  const dirFlip = (G.frame & 1) === 0;
  for (let cy = cy1; cy >= cy0; cy--) {
    const nearRow = cy >= nr0 && cy <= nr1;
    for (let k = 0; k <= cx1 - cx0; k++) {
      const cx = dirFlip ? cx0 + k : cx1 - k;
      const c = cy * CW + cx;
      if (awake[c] === 0) continue;
      const near = nearRow && cx >= nc0 && cx <= nc1;
      if (!near && ((G.frame + c) & (FAR_CA_EVERY - 1)) !== 0) continue;
      let moved = false;
      cand = false;
      const yy0 = cy * CH, yy1 = Math.min(H - 2, yy0 + CH - 1);
      const xx0 = cx * CH, xx1 = Math.min(W - 2, xx0 + CH - 1);
      for (let y = yy1; y >= yy0; y--) {
        const ltr = ((y + G.frame) & 1) === 0;
        for (let q = 0; q <= xx1 - xx0; q++) {
          const x = ltr ? xx0 + q : xx1 - q;
          if (x < 1) continue;
          const i = y * W + x;
          const m = mat[i];
          if (m === M.AIR || stamp[i] === frameStamp || body[i]) continue;
          if (m === M.SNOW) {
            if (bond[i] >= BOND_SOLID || dens[i] >= 420) continue;
            if (moveGrain(i, x, y, m)) moved = true;
          } else if (m === M.ASH) { if (moveGrain(i, x, y, m)) moved = true; }
          else if (m === M.WATER) { if (moveWater(i, x, y)) moved = true; }
        }
      }
      if (moved || cand) awake[c] = AWAKE_T; else awake[c]--;
    }
  }
}

/** Slide to a free diagonal below (either side)? Geometry only, no random roll. */
function slideOpen(i: number, below: number, m: number): boolean {
  return (canEnter(i + 1, m) && canEnter(below + 1, m)) || (canEnter(i - 1, m) && canEnter(below - 1, m));
}
/** Lateral creep of one grain into the air beside it, with a free cell beyond. Geometry only. */
function creepStep(i: number, x: number, dx: number, m: number): boolean {
  const xx = x + 2 * dx;
  if (xx < 1 || xx >= W - 1) return false;
  return canEnter(i + dx, m) && !canEnter(i + dx + W, m) && canEnter(i + 2 * dx + W, m);
}
function creepOpen(i: number, x: number, m: number): boolean {
  return creepStep(i, x, 1, m) || creepStep(i, x, -1, m);
}

function moveGrain(i: number, x: number, y: number, m: number): boolean {
  const below = i + W;
  // fall (up to 2 cells per frame)
  if (canEnter(below, m)) {
    let j = below;
    if (y + 2 < H && canEnter(j + W, m)) j += W;
    swap(i, j); return true;
  }
  if (mat[below] === M.POLE && m === M.SNOW) { // a grain perched on a marker pole top slides off (no standable snow pillar)
    const d0 = Math.random() < 0.5 ? -1 : 1;
    for (let s = 0; s < 2; s++) { const dx = s === 0 ? d0 : -d0; if (canEnter(i + dx, m)) { swap(i, i + dx); return true; } }
  }
  // cohesion: dry cold fresh snow slides freely (angle of repose ~38°), bonded/wet snow holds steeper
  const b = bond[i];
  const wet = (flags[i] & F_WET) !== 0;
  let p = 1 - b / BOND_SOLID; // 1 .. 0
  if (wet) p *= 0.25;
  if (m === M.ASH) p = 0.9;
  if (p <= 0.02) return false;
  const creep = p > 0.85;
  if (Math.random() > p) { // rolled to hold this frame: still unstable if it could slide or creep
    if (slideOpen(i, below, m) || (creep && creepOpen(i, x, m))) cand = true;
    return false;
  }
  const d = Math.random() < 0.5 ? -1 : 1;
  for (let s = 0; s < 2; s++) {
    const dx = s === 0 ? d : -d;
    const side = i + dx, diag = below + dx;
    if (canEnter(side, m) && canEnter(diag, m)) { swap(i, diag); return true; }
  }
  // lateral creep only for very loose snow -> repose slightly below 45°
  if (creep) {
    if (Math.random() < 0.18) {
      for (let s = 0; s < 2; s++) {
        const dx = s === 0 ? d : -d;
        if (creepStep(i, x, dx, m)) { swap(i, i + dx); return true; }
      }
    } else if (creepOpen(i, x, m)) cand = true;
  }
  return false;
}

function moveWater(i: number, x: number, y: number): boolean {
  const below = i + W;
  const bm = mat[below];
  if (bm === M.AIR && !body[below]) { swap(i, below); return true; }
  // soak into loose snow -> slush
  if (bm === M.SNOW && bond[below] < 200 && dens[below] < 520) {
    const add = Math.min(dens[i], 917 - dens[below]);
    if (add <= 0) return false;
    dens[below] += add; flags[below] |= F_WET; bond[below] = Math.min(255, bond[below] + 30);
    if (add >= dens[i]) { mat[i] = M.AIR; dens[i] = 0; flags[i] = 0; } else dens[i] -= add;
    wakeArea(x, y); touch(x, y); touch(x, y + 1);
    return true;
  }
  const d = Math.random() < 0.5 ? -1 : 1;
  for (let s = 0; s < 2; s++) {
    const dx = s === 0 ? d : -d;
    if (mat[below + dx] === M.AIR && mat[i + dx] === M.AIR && !body[below + dx]) { swap(i, below + dx); return true; }
  }
  for (let s = 0; s < 2; s++) {
    const dx = s === 0 ? d : -d;
    for (let r = 1; r <= 3; r++) {
      const j = i + dx * r;
      if (x + dx * r < 1 || x + dx * r >= W - 1) break;
      if (mat[j] !== M.AIR || body[j]) break;
      if (r === 3 || mat[j + W] === M.AIR) { swap(i, j); return true; }
    }
  }
  return false;
}

// ---------- slow pass: compaction + sintering, staggered ----------
const COMPACT_K = 0.3; // 1/h per unit of density deficit at visc=1
// Temperature factors of sintering (arr) and viscosity (visc), tabulated at 1/64 °C: exp() per snow cell was the slow pass's main cost.
// Rounding to the nearest 1/64 °C moves a rate by < 0.1 %, below anything visible.
const LUT_N = 60 * 64 + 1;
const ARR_LUT = new Float64Array(LUT_N), VISC_LUT = new Float64Array(LUT_N);
for (let k = 0; k < LUT_N; k++) { ARR_LUT[k] = Math.exp(0.085 * (5 - k / 64)); VISC_LUT[k] = Math.exp(0.07 * (5 - k / 64)); }
const lutIdx = (Tc: number) => { const k = Math.round(-Tc * 64); return k < 0 ? 0 : k >= LUT_N ? LUT_N - 1 : k; };

/** One column of the slow pass over rows ya..yb, `dtGameH` game hours since its last visit. */
function slowColumn(x: number, ya: number, yb: number, dtGameH: number) {
  // scan column from top: running overburden load (kg/m²)
  let load = 0, found = 0; // found: rows of tamped foundation left under a placed beam/crate/post (those cells do not flow away)
  for (let y = ya; y <= yb; y++) {
    const i = y * W + x;
    const m = mat[i];
    if (m === M.AIR || m === M.NEEDLE) { load = 0; found = 0; continue; }
    if (m !== M.SNOW || body[i]) { if (m === M.WATER) load += 50; else load += 20; found = (m === M.PLANK || m === M.DOOR || m === M.CRATE || m === M.POLE) && !body[i] ? 7 : 0; continue; }
    const d = dens[i];
    load += d * CELL;
    const T = tempAt(x, y);
    const Tc = Math.min(0, T);
    // --- sintering: Arrhenius-like, fastest near 0..-5 °C, slow when very cold ---
    const lk = lutIdx(Tc);
    if (bond[i] < 255) {
      const arr = ARR_LUT[lk]; // -5 → 1, -30 → 0.12
      let rate = 70 * arr * (0.4 + d / 350); // bond units per game hour
      if (flags[i] & F_DIST) rate *= 2.6;   // mixing different-temperature grains sinters fast (quinzhee)
      if (flags[i] & F_DRIFT) rate *= 1.6;
      if (flags[i] & F_WET && T < 0) rate *= 4;
      // only sinter when resting on something (no free-falling grains)
      const bm = mat[i + W];
      if (bm !== M.AIR) {
        const nb = Math.min(255, bond[i] + rate * dtGameH + Math.random());
        const was = bond[i] >= BOND_SOLID;
        bond[i] = nb | 0;
        // crossing into rigid changes only this cell's own motion (neighbours see mat, not bond): own chunk, no neighbour wake
        if (!was && bond[i] >= BOND_SOLID) { wakeOwn(x, y); touch(x, y); }
      }
    }
    // --- compaction: transfer mass from this cell into the one below if below is under-dense ---
    const j = i + W;
    if (found > 0) found--;
    else if (mat[j] === M.SNOW && !body[j] && !((flags[i] & F_DIST) && bond[i] >= 150)) { // placed / well-sintered blocks keep their mass (no settling out of the apex course)
      const target = Math.min(560, 140 + 135 * Math.log10(1 + load / 4)); // kg/m³ for given overburden
      const dj = dens[j];
      if (dj < target) {
        const visc = VISC_LUT[lk] * (1 + (flags[j] & F_WET ? 3 : 0));
        const diff = target - dj;
        // stochastic rounding: exact integer mass moved, no truncation loss, works for tiny rates
        let n = Math.floor(Math.min(d, diff, diff * COMPACT_K * visc * dtGameH) + Math.random());
        n = Math.min(n, d, 917 - dj);
        if (n > 0) {
          dens[j] = dj + n;
          let left = d - n;
          if (left < 22) { // top cell has collapsed: move ALL remaining mass down (cap 917)
            const m2 = Math.min(left, 917 - dens[j]);
            dens[j] += m2; left -= m2;
          }
          if (left <= 0) { mat[i] = M.AIR; dens[i] = 0; bond[i] = 0; flags[i] = 0; wakeArea(x, y); }
          else dens[i] = left;
          touch(x, y);
        }
      }
    }
    if ((flags[i] & F_DIST) && bond[i] > 200) flags[i] &= ~F_DIST;
  }
}

/** Near columns every SLOW_NEAR frames over the near rows; far columns (rest of G.win) every SLOW_FAR frames.
 *  Each column's dt is its own visit interval, so settling runs at real-time speed in both zones. */
function stepSlow(dtReal: number) {
  const dtN = (dtReal * SLOW_NEAR * 60 * G.timeScale) / 3600; // game hours since a near column was visited
  const dtF = (dtReal * SLOW_FAR * 60 * G.timeScale) / 3600;  // ... since a far column was visited
  slowNear = (slowNear + 1) % SLOW_NEAR;
  slowFar = (slowFar + 1) % SLOW_FAR;
  const { x0, x1 } = G.win;
  const xa = Math.max(1, x0), xb = Math.min(W - 2, x1);
  const ya = Math.max(1, nY0), yb = Math.min(H - 2, nY1);
  const na = Math.max(xa, nX0), nb = Math.min(xb, nX1);
  for (let x = xa + slowFar; x <= xb; x += SLOW_FAR) if (x < na || x > nb) slowColumn(x, ya, yb, dtF);
  for (let x = na + slowNear; x <= nb; x += SLOW_NEAR) slowColumn(x, ya, yb, dtN);
}

// ---------- snowfall & wind ----------
let flakeAcc = 0, lowSkip = false;
function stepWeather(dt: number) {
  const { x0, x1, y0 } = G.win;
  const gs = 60 * G.timeScale;
  const cellsPerSecPerCol = (G.snowfall / CELL) * (gs / 3600); // fresh snow cells per column per real second
  // outside window: accumulate statistically
  for (let x = 0; x < W; x += 1) {
    if (x >= x0 && x <= x1) continue;
    pending[x] = Math.min(PENDING_MAX, pending[x] + cellsPerSecPerCol * dt * (0.8 + 0.4 * Math.random()));
  }
  // visual + mass-carrying flakes in window
  const cols = x1 - x0;
  const flakeRate = cols * (0.35 + G.snowfall * 25) * (G.quality ? 1 : 0.5) * Math.min(4, G.timeScale);
  flakeAcc += flakeRate * dt;
  const massPerFlake = (cellsPerSecPerCol * cols) / Math.max(1, flakeRate);
  const top = Math.max(0, y0 - 10);
  const wind = G.wind;
  while (flakeAcc > 1) {
    flakeAcc -= 1;
    const r = Math.random();
    const layer = r < 0.62 ? 0 : r < 0.92 ? 1 : 2;
    if (layer !== 0 && G.quality === 0 && (lowSkip = !lowSkip)) continue;           // quality 0: half of the (massless) decorative flakes
    const x = clampX(x0 - wind * 6 + Math.random() * (cols + Math.abs(wind) * 12));
    const fall = 14 + Math.random() * 14; // 0.7–1.4 m/s
    const fm = layer === 0 ? massPerFlake * 1.6 : 0;
    if (spawn(PK.FLAKE, x, top + Math.random() * 30, wind * 20 * 0.8, fall, 40, fm, 0, layer) < 0 && fm > 0) pending[clampX(x | 0)] = Math.min(PENDING_MAX, pending[clampX(x | 0)] + fm);
  }
  // deposit pending for columns entering the window
  for (let x = Math.max(1, x0); x < Math.min(W - 1, x1); x++) {
    if (pending[x] > PENDING_MAX) pending[x] = PENDING_MAX;
    if (pending[x] >= 1) {
      let n = Math.min(4, Math.floor(pending[x])); pending[x] -= n;
      while (n-- > 0) { if (!depositAt(x, freshDens(G.ambientT), 0)) pending[x] += 1; }
    }
  }
  // saltation: lift surface powder in strong local wind
  const tries = (cols * 0.12) | 0;
  for (let k = 0; k < tries; k++) {
    const x = (x0 + Math.random() * cols) | 0; if (x < 2 || x > W - 3) continue;
    const y = surf[x]; if (y <= 1 || y >= H - 2) continue;
    const i = idx(x, y);
    if (mat[i] !== M.SNOW || body[i] || mat[i - W] !== M.AIR) continue;
    const u = Math.abs(windAt(x, y - 2));
    const thr = 5 + (bond[i] / 255) * 9 + Math.max(0, dens[i] - 100) / 60;
    if (u < thr) continue;
    if (Math.random() > (u - thr) * 0.25 * dt * 10) continue;
    const d = dens[i];
    if (spawn(PK.DRIFT, x, y - 1, Math.sign(G.wind) * u * 20 * 0.5, -(10 + Math.random() * 30), 6, 1, d, 0) < 0) continue;
    putCell(x, y, M.AIR, 0, 0, 0);
    wakeArea(x, y);
  }
}

/** Put one cell of snow on top of column x (at the first air cell above the surface found from y hint). */
export function depositAt(x: number, d: number, fl: number, yHint = -1, b = 0): boolean {
  if (x < 1 || x >= W - 1) return false;
  let y = yHint >= 0 ? yHint : Math.max(1, surf[x] - 1);
  // find first air cell scanning up from hint if occupied, or down if floating
  let i = idx(x, y);
  if (mat[i] !== M.AIR) { while (y > 1 && mat[idx(x, y)] !== M.AIR) y--; }
  else { while (y < H - 2 && mat[idx(x, y + 1)] === M.AIR) y++; }
  i = idx(x, y);
  if (mat[i] !== M.AIR || body[i]) return false;
  if (mat[i + W] === M.POLE) { // never stack snow on a marker pole top: put it on the ground beside the pole instead
    for (let o = 0; o < POLE_OFFS.length; o++) {
      const xx = x + POLE_OFFS[o]; if (xx < 1 || xx >= W - 1) continue;
      let yy = Math.min(H - 3, y + 1);
      if (mat[idx(xx, yy)] !== M.AIR) { while (yy > 1 && mat[idx(xx, yy)] !== M.AIR) yy--; }
      else { while (yy < H - 2 && mat[idx(xx, yy + 1)] === M.AIR) yy++; }
      const j = idx(xx, yy);
      if (mat[j] !== M.AIR || body[j] || mat[j + W] === M.POLE) continue;
      putCell(xx, yy, M.SNOW, d, b, fl);
      wakeLanding(xx, yy);
      if (surf[xx] > yy) surf[xx] = yy;
      return true;
    }
    return false;
  }
  putCell(x, y, M.SNOW, d, b, fl);
  wakeLanding(x, y);
  if (surf[x] > y) surf[x] = y;
  return true;
}

/** A DRIFT/CLUMP grain comes to rest after hitting solid cell c from air cell (px0,py0). Mass-exact. */
function landGrain(i: number, k: number, c: number, px0: number, py0: number) {
  let d = P.d[i];
  const drift = k === PK.DRIFT;
  const fl = F_DIST | (drift ? F_DRIFT : 0);
  if (drift && mat[c] === M.SNOW && !body[c] && dens[c] < 330) {
    // wind packing: many grains merge into the slab they hit
    const add = Math.min(d, 917 - dens[c]);
    const was = rigidAt(c);
    dens[c] += add; d -= add;
    flags[c] |= fl;
    if (mat[c + W] !== M.AIR) bond[c] = Math.max(bond[c], 60);
    const cx = c % W, cy = (c / W) | 0;
    touch(cx, cy); wakeOwn(cx, cy); // density only rises here: neighbours can only lose moves, so the own chunk is enough
    if (was !== rigidAt(c)) solidChanged(cx, cy);
    if (d <= 0) return;
  }
  if (k === PK.CLUMP && Math.random() < 0.4) spawn(PK.DUST, px0 + 0.5, py0 + 0.5, (Math.random() - 0.5) * 26, -(6 + Math.random() * 20), 0.45 + Math.random() * 0.4, 1.3, 0, 0);   // powder puff where a tossed clump lands
  if (!depositNear(px0, py0, d, fl, drift ? 60 : 0)) {
    const col = clampX(px0 | 0);
    pending[col] = Math.min(PENDING_MAX, pending[col] + d / Math.max(1, freshDens(G.ambientT)));
  }
}

// ---------- particles ----------
export function stepParticles(dt: number) {
  const g = 196; // cells/s² (9.8 m/s²)
  for (let i = 0; i < P.n; i++) {
    P.life[i] -= dt;
    if (P.life[i] <= 0) { refund(i); kill(i); i--; continue; }
    const k = P.kind[i];
    let x = P.x[i], y = P.y[i];
    if (k === PK.FLAKE) {
      const s = P.seed[i];
      const u = P.layer[i] === 0 ? windAt(x | 0, y | 0) : G.wind;
      const tvx = u * 20 + Math.sin(G.realTime * (1.5 + s * 2) + s * 40) * 8; // flutter
      P.vx[i] += (tvx - P.vx[i]) * Math.min(1, dt * 3);
      x += P.vx[i] * dt; y += P.vy[i] * dt * (P.layer[i] === 2 ? 1.6 : 1);
      P.x[i] = x; P.y[i] = y;
      if (P.layer[i] !== 0) { if (y > G.win.y1 + 40) { kill(i); i--; } continue; }
      const cx = x | 0, cy = y | 0;
      if (!inb(cx, cy) || cy >= H - 2) { refund(i); kill(i); i--; continue; }
      const c = idx(cx, cy);
      if (mat[c] !== M.AIR) {
        // landed: add mass to the column accumulator (boughs catch snow too)
        const lx = clampX(cx);
        acc[lx] += P.m[i];
        for (let t = 0; t < 4 && acc[lx] >= 1; t++) {
          acc[lx] -= 1;
          if (!depositAt(lx, freshDens(G.ambientT), 0, cy - 1)) { acc[lx] += 1; break; }
        }
        if (acc[lx] > 8) acc[lx] = 8;
        kill(i); i--; continue;
      }
      continue;
    }
    if (k === PK.DRIFT || k === PK.CLUMP) {
      const u = windAt(x | 0, y | 0) * 20;
      if (k === PK.DRIFT) P.vx[i] += (u - P.vx[i]) * Math.min(1, dt * 4);
      P.vy[i] += g * dt * (k === PK.DRIFT ? 0.35 : 1);
      const nx = x + P.vx[i] * dt, ny = y + P.vy[i] * dt;
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(nx - x), Math.abs(ny - y))));
      let landed = false, bounced = false;
      for (let s = 1; s <= steps; s++) {
        const px = x + ((nx - x) * s) / steps, py = y + ((ny - y) * s) / steps;
        const cx = px | 0, cy = py | 0;
        if (!inb(cx, cy) || cy >= H - 2 || cx < 1 || cx >= W - 1) { refund(i); landed = true; break; }
        const c = idx(cx, cy);
        if (mat[c] !== M.AIR || body[c]) {
          const px0 = (x + ((nx - x) * (s - 1)) / steps) | 0, py0 = (y + ((ny - y) * (s - 1)) / steps) | 0;
          // drift settles only where wind drops (lee) — else bounce on
          const lu = Math.abs(windAt(px0, py0));
          if (k === PK.DRIFT && lu > 6 && Math.random() < 0.7 && P.life[i] > 0.5) {
            P.vy[i] = -Math.abs(P.vy[i]) * 0.5 - 8; P.x[i] = px0; P.y[i] = Math.max(0, py0 - 1); bounced = true; break;
          }
          landGrain(i, k, c, px0, py0);
          landed = true; break;
        }
      }
      if (bounced) continue;
      if (landed) { kill(i); i--; continue; }
      if (P.life[i] < 0.05 && k === PK.DRIFT) { // ran out of time aloft: deposit where it is
        const cx = nx | 0, cy = ny | 0;
        if (!(inb(cx, cy) && mat[idx(cx, cy)] === M.AIR && depositAt(cx, P.d[i], F_DRIFT | F_DIST, cy, 60))) refund(i);
        kill(i); i--; continue;
      }
      P.x[i] = nx; P.y[i] = ny;
      continue;
    }
    // decorative particles
    if (k === PK.SMOKE || k === PK.STEAM || k === PK.BREATH) {
      const u = windAt(x | 0, y | 0) * 20;
      P.vx[i] += (u * 0.7 - P.vx[i]) * dt * 1.5;
      P.vy[i] += (-14 - P.vy[i]) * dt * (k === PK.BREATH ? 0.5 : 1);
    } else if (k === PK.FLAME) {
      P.vy[i] -= 60 * dt; P.vx[i] *= 1 - dt * 3;
    } else if (k === PK.SPARK) {
      P.vy[i] -= 30 * dt; P.vx[i] += (windAt(x | 0, y | 0) * 20 - P.vx[i]) * dt;
    } else { // CHIP, DUST
      P.vy[i] += g * dt * (k === PK.DUST ? 0.15 : 1);
      P.vx[i] += (windAt(x | 0, y | 0) * 20 - P.vx[i]) * dt * (k === PK.DUST ? 2 : 0.2);
      const c = idx(Math.max(0, Math.min(W - 1, x | 0)), Math.max(0, Math.min(H - 1, y | 0)));
      if (k === PK.CHIP && mat[c] !== M.AIR) { P.vx[i] = 0; P.vy[i] = 0; P.life[i] = Math.min(P.life[i], 0.6); }
    }
    P.x[i] = x + P.vx[i] * dt; P.y[i] = y + P.vy[i] * dt;
  }
}

/** dt: physics step (clamped by the caller); dtReal: wall-clock share of this step, used for weather and sintering/compaction so game time does not crawl on slow devices. */
export function stepSim(dt: number, dtReal: number = dt) {
  let t = pnow();
  updateNear();
  stepWeather(dtReal); pend('weather', t); t = pnow();
  stepCA(); pend('ca', t); t = pnow();
  stepSlow(dtReal); pend('slow', t); t = pnow();
  stepParticles(dt); pend('particles', t);
}

export { rigidAt, isAirLike };
