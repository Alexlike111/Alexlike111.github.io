// Cellular-automaton simulation (SPEC §2). Fixed 60 Hz ticks over awake chunks inside G.win (+margin).
// Hot loops use typed arrays only; no allocations per tick.
import {
  W, H, TW, CS, CW, CHN, mat, aux, shade, flags, awake, wake, onEdit, edited,
  F_TICK, F_WET, F_BURN, F_LIT, F_PLACED,
} from './grid';
import {
  MAT, PHASE, DENS, WALK, FLAM, BURN_TO, BURN_LIFE, SLIDE, FLOW, MELT_AT, MELT_TO, FREEZE_AT, BOIL_AT, LIFE_MIN, LIFE_MAX,
  P_SOLID, P_POWDER, P_LIQUID, P_GAS, P_FIRE,
} from '../content/materials';
import { G } from '../game/state';
import { temp, wind, drainHeat } from './heat';
import { throwCell } from './particles';

// ------------------------------------------------------------------ constants
const TICK = 1 / 60;
const MARGIN = 16;          // cells around G.win that still simulate
const SLEEP_TICKS = 30;     // a chunk with no motion goes to sleep after this many ticks
const SAMPLE_PERIOD = 240;  // each window cell is visited by the slow stochastic pass about every N ticks
const MAXB = 8192;          // max simultaneously burning solid cells
const AIR = 0;
const SNOW = MAT.SNOW, PACKED = MAT.PACKED, SNOWBLOCK = MAT.SNOWBLOCK, ICE = MAT.ICE, WATER = MAT.WATER, LAVA = MAT.LAVA, OIL = MAT.OIL;
const FIRE = MAT.FIRE, EMBER = MAT.EMBER, ASH = MAT.ASH, SMOKE = MAT.SMOKE, STEAM = MAT.STEAM, BASALT = MAT.BASALT, NEEDLES = MAT.NEEDLES;

// ------------------------------------------------------------------ state
let tickN = 0, acc = 0;
let rs = 2463534242;
function rnd(): number { rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5; return (rs >>> 0) * 2.3283064365386963e-10; }
export function seedSim(n: number) { rs = (n >>> 0) || 1; }

const act = new Uint8Array(CW * CHN);        // chunks that did something this tick
const surf = new Int16Array(W).fill(-1);     // cached surface rows
const colSnow = new Float32Array(W);         // snow accumulated while a column is outside the window
const burnIdx = new Int32Array(MAXB), burnT = new Uint16Array(MAXB);
let nBurn = 0;
const stamp = new Uint16Array(W * H);        // scratch visited marks for BFS (level / methane)
let stampN = 0;
let depAcc = 0;
/** Snowfall deposition scale (DESIGN §13). 1 = the raw engine rate (0.25 cells / s / column at G.snowfall 1, what the headless sim tests measure); the game sets a
 *  lower one in main.ts so a calm hour adds a few cells and a storm a metre, instead of burying the dug-out door within minutes. */
export const snowCfg = { rate: 1, curve: 1 };       // curve > 1: calm snowfall adds almost nothing, storms add most of it (deposition ~ snowfall^curve)
let prevX0 = -1, prevX1 = -1;
let inited = false;

export const simStats = { ticks: 0, moved: 0, chunks: 0, burning: 0, booms: 0 };

// dirty rectangles reported to grid.edited() (structure solver, heat tile refresh, surface cache) once per frame
const dRect = { n: 0, x0: new Int32Array(8), y0: new Int32Array(8), x1: new Int32Array(8), y1: new Int32Array(8) };
function dirty(x: number, y: number) {
  for (let k = 0; k < dRect.n; k++) {
    if (x >= dRect.x0[k] - 10 && x <= dRect.x1[k] + 10 && y >= dRect.y0[k] - 10 && y <= dRect.y1[k] + 10) {
      if (x < dRect.x0[k]) dRect.x0[k] = x; if (x > dRect.x1[k]) dRect.x1[k] = x;
      if (y < dRect.y0[k]) dRect.y0[k] = y; if (y > dRect.y1[k]) dRect.y1[k] = y;
      return;
    }
  }
  if (dRect.n < 8) { const k = dRect.n++; dRect.x0[k] = dRect.x1[k] = x; dRect.y0[k] = dRect.y1[k] = y; }
  else { dRect.x0[0] = Math.min(dRect.x0[0], x); dRect.x1[0] = Math.max(dRect.x1[0], x); dRect.y0[0] = Math.min(dRect.y0[0], y); dRect.y1[0] = Math.max(dRect.y1[0], y); }
}
function flushDirty() {
  const n = dRect.n; dRect.n = 0;
  for (let k = 0; k < n; k++) edited(dRect.x0[k], dRect.y0[k], dRect.x1[k], dRect.y1[k]);
}

// ------------------------------------------------------------------ helpers
/** Chunk activity bookkeeping: keep this chunk (and a neighbour if the cell is near the border) awake. */
function mark(x: number, y: number) {
  const cx = x >> 5, cy = y >> 5, c = cy * CW + cx;
  act[c] = 1; if (awake[c] === 0) awake[c] = 1;
  const lx = x & 31, ly = y & 31;
  if (lx < 4 || lx > 27 || ly < 4 || ly > 27) markEdge(cx, cy, lx, ly);
  simStats.moved++;
}
function markEdge(cx: number, cy: number, lx: number, ly: number) {
  const ax = lx < 4 ? -1 : lx > 27 ? 1 : 0, ay = ly < 4 ? -1 : ly > 27 ? 1 : 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if ((dx === 0 && dy === 0) || (dx !== 0 && dx !== ax) || (dy !== 0 && dy !== ay)) continue;
    const x = cx + dx, y = cy + dy;
    if (x < 0 || y < 0 || x >= CW || y >= CHN) continue;
    const c = y * CW + x; act[c] = 1; if (awake[c] === 0) awake[c] = 1;
  }
}
function swap(i: number, j: number) {
  const m = mat[i], a = aux[i], s = shade[i], f = flags[i];
  mat[i] = mat[j]; aux[i] = aux[j]; shade[i] = shade[j]; flags[i] = flags[j];
  mat[j] = m; aux[j] = a; shade[j] = s; flags[j] = f;
}
const isFluidCell = (t: number) => t === 0 || PHASE[t] >= P_LIQUID;                                   // air, liquid, gas, fire
// powders/liquids pass through air and gases and sink through lighter liquids; flames are not displaced (burning oil must stay burning)
const canFall = (t: number, d: number) => t === 0 || PHASE[t] === P_GAS || (PHASE[t] === P_LIQUID && DENS[t] < d);
const gasLike = (t: number) => t === 0 || PHASE[t] >= P_GAS;
const gasLife = (m: number) => (LIFE_MIN[m] + rnd() * (LIFE_MAX[m] - LIFE_MIN[m])) >> 1;
function put(i: number, m: number, a: number, f: number) { mat[i] = m; aux[i] = a; flags[i] = f; shade[i] = (rnd() * 256) | 0; }
function setFire(i: number) { put(i, FIRE, LIFE_MIN[FIRE] + ((rnd() * (LIFE_MAX[FIRE] - LIFE_MIN[FIRE])) | 0), 0); const y = (i / W) | 0; mark(i - y * W, y); }
const OFF = [-W, 1, W, -1];

// slow-pass classes
const SK = new Uint8Array(256);
SK[SNOW] = 1; SK[PACKED] = 2; SK[SNOWBLOCK] = 2; SK[ICE] = 2; SK[WATER] = 3; SK[LAVA] = 4;

// ------------------------------------------------------------------ surface cache
export function surfaceY(x: number): number {
  x = x < 0 ? 0 : x >= W ? W - 1 : x | 0;
  let y = surf[x];
  if (y >= 1 && y < H - 1) {
    const i = y * W + x;
    if (!gasLike(mat[i]) && gasLike(mat[i - W]) && (y < 2 || gasLike(mat[i - 2 * W]))) return y;
  }
  y = 0;
  while (y < H - 1 && gasLike(mat[y * W + x])) y++;
  surf[x] = y;
  return y;
}

// ------------------------------------------------------------------ fire / burning
function addBurn(i: number, m: number): boolean {
  if (nBurn >= MAXB) return false;
  burnIdx[nBurn] = i;
  burnT[nBurn] = Math.max(8, (BURN_LIFE[m] * (0.75 + rnd() * 0.5)) | 0);
  nBurn++;
  return true;
}
function igniteCell(n: number) {
  const m = mat[n];
  const f = FLAM[m];
  if (f <= 0) return;
  const ph = PHASE[m];
  if (ph === P_LIQUID) { if (!(flags[n] & F_BURN)) { flags[n] |= F_BURN; const y = (n / W) | 0; mark(n - y * W, y); } return; }   // burning liquid keeps flowing (see burnLiquid)
  if (ph === P_SOLID) {
    if (flags[n] & F_BURN) return;
    if (!addBurn(n, m)) return;
    flags[n] |= F_BURN;
    const y = (n / W) | 0; mark(n - y * W, y);
  }
}
/** Set fire to whatever is at (x,y): flammable solids burn, gas explodes, air gets a flame. */
export function ignite(x: number, y: number): void {
  if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return;
  const i = y * W + x, m = mat[i];
  if (m === AIR || PHASE[m] === P_GAS) { if (m === AIR) setFire(i); wake(x, y); return; }
  igniteCell(i);
  wake(x, y);
}
function meltCell(n: number) {
  const y = (n / W) | 0, x = n - y * W;
  mat[n] = WATER; aux[n] = 0; flags[n] = 0;
  mark(x, y); dirty(x, y);
}
function extinguishSteam(i: number) { mat[i] = STEAM; aux[i] = gasLife(STEAM); flags[i] = 0; }

function stepFire(i: number, x: number, y: number) {
  mark(x, y);
  let a = aux[i];
  if (a === 0) a = LIFE_MIN[FIRE] + ((rnd() * (LIFE_MAX[FIRE] - LIFE_MIN[FIRE])) | 0);
  a--;
  let wet = false;
  for (let d = 0; d < 4; d++) {
    const n = i + OFF[d], nm = mat[n];
    if (nm === AIR) continue;
    if (nm === WATER) { wet = true; continue; }
    const f = FLAM[nm];
    if (f > 0) { if (rnd() < f) igniteCell(n); }
    else if (MELT_AT[nm] < 1e8 && PHASE[nm] !== P_LIQUID && rnd() < 0.05) { meltCell(n); a -= 3; }
  }
  if (wet && rnd() < 0.35) { extinguishSteam(i); return; }
  if (a <= 0) {
    if (rnd() < 0.3) { mat[i] = SMOKE; aux[i] = gasLife(SMOKE); } else mat[i] = AIR;
    return;
  }
  aux[i] = a;
  // rise and flicker
  const u = i - W;
  if (rnd() < 0.5) {
    if (mat[u] === AIR) { swap(i, u); flags[u] |= F_TICK; return; }
    const dd = rnd() < 0.5 ? -1 : 1;
    if (mat[u + dd] === AIR && mat[i + dd] === AIR) { swap(i, u + dd); flags[u + dd] |= F_TICK; }
  }
}

/** Burning solids only progress (age, spread) inside the processed window. Outside they are parked, like every other
 *  process of the CA, and resume when the window reaches them. If the budget gets tight, parked fires are put out instead. */
function stepBurning(x0: number, y0: number, x1: number, y1: number) {
  const squeeze = nBurn >= MAXB * 0.75;
  for (let k = 0; k < nBurn;) {
    const i = burnIdx[k], m = mat[i];
    if (!(flags[i] & F_BURN) || BURN_LIFE[m] === 0) { burnIdx[k] = burnIdx[--nBurn]; burnT[k] = burnT[nBurn]; continue; }
    const y = (i / W) | 0, x = i - y * W;
    if (x < x0 || x > x1 || y < y0 || y > y1) {
      if (squeeze) { flags[i] &= ~F_BURN; burnIdx[k] = burnIdx[--nBurn]; burnT[k] = burnT[nBurn]; continue; }
      k++; continue;
    }
    mark(x, y);
    let t = burnT[k] - 1;
    let doused = false;
    for (let d = 0; d < 4; d++) {
      const n = i + OFF[d], nm = mat[n];
      if (nm === AIR) {
        if (d === 0 && rnd() < 0.2) setFire(n);
        else if ((d & 1) && rnd() < 0.04) setFire(n);
        continue;
      }
      if (nm === WATER) { if (rnd() < 0.15) doused = true; continue; }
      const f = FLAM[nm];
      if (f > 0) { if (rnd() < f * 0.7) igniteCell(n); }
      else if (MELT_AT[nm] < 1e8 && PHASE[nm] !== P_LIQUID && rnd() < 0.025) meltCell(n);
    }
    if (doused) {
      flags[i] &= ~F_BURN;
      burnIdx[k] = burnIdx[--nBurn]; burnT[k] = burnT[nBurn];
      continue;
    }
    if (t <= 0) {
      const bt = BURN_TO[m];
      if (bt === EMBER) { mat[i] = EMBER; aux[i] = 200 + ((rnd() * 55) | 0); flags[i] = F_LIT; }
      else if (bt === AIR) { mat[i] = AIR; aux[i] = 0; flags[i] = 0; if (rnd() < 0.3 && mat[i - W] === AIR) { mat[i - W] = SMOKE; aux[i - W] = gasLife(SMOKE); } }
      else { mat[i] = bt; aux[i] = 0; flags[i] = 0; }
      dirty(x, y);
      burnIdx[k] = burnIdx[--nBurn]; burnT[k] = burnT[nBurn];
      continue;
    }
    burnT[k] = t; k++;
  }
  simStats.burning = nBurn;
}

// ------------------------------------------------------------------ powders
function stepEmber(i: number, x: number, y: number): boolean {
  mark(x, y);
  let a = aux[i];
  if (a === 0) a = 230;
  for (let d = 0; d < 4; d++) {
    const n = i + OFF[d], nm = mat[n];
    if (nm === AIR) continue;
    if (nm === WATER) { mat[i] = ASH; aux[i] = 0; flags[i] = 0; if (rnd() < 0.5) { mat[n] = STEAM; aux[n] = gasLife(STEAM); } return true; }
    const f = FLAM[nm];
    if (f > 0) { if (rnd() < f * 0.4) igniteCell(n); }
    else if (MELT_AT[nm] < 1e8 && PHASE[nm] !== P_LIQUID && rnd() < 0.01) meltCell(n);
  }
  if (rnd() < 0.5) a--;
  if (a <= 0) { mat[i] = ASH; aux[i] = 0; flags[i] = 0; return true; }
  aux[i] = a;
  return false;
}

function stepPowder(i: number, x: number, y: number, m: number) {
  if (m === EMBER && stepEmber(i, x, y)) return;
  const d = DENS[m], b = i + W, mb = mat[b];
  if (canFall(mb, d)) {
    if (PHASE[mb] === P_LIQUID && rnd() > 0.55) { mark(x, y); return; }
    let j = b;
    if ((mb === AIR || PHASE[mb] === P_GAS) && y < H - 2) { const t2 = mat[b + W]; if (t2 === AIR || PHASE[t2] === P_GAS) j = b + W; }   // two cells per tick through air / gas
    swap(i, j); mark(x, y);
    return;
  }
  const f = flags[i];
  const sl = SLIDE[m] * ((f & F_WET) ? 0.3 : 1);
  if (sl > 0 && rnd() < sl) {
    const s = rnd() < 0.5 ? -1 : 1;
    for (let k = 0; k < 2; k++) {
      const dd = k === 0 ? s : -s;
      if (canFall(mat[b + dd], d) && isFluidCell(mat[i + dd])) { swap(i, b + dd); mark(x, y); return; }
    }
  }
}

// ------------------------------------------------------------------ liquids
let levelBudget = 0;
function levelAttempt(i: number, x: number, y: number, m: number) {
  // find a lower free surface slot connected through the same liquid and move this surface cell there (communicating vessels)
  stampN = (stampN + 1) & 0xffff; if (stampN === 0) { stamp.fill(0); stampN = 1; }
  const q = levelQ;
  let head = 0, tail = 0;
  q[tail++] = i; stamp[i] = stampN;
  while (head < tail && tail < 700) {
    const u = q[head++];
    const uy = (u / W) | 0;
    // free slot above this liquid cell?
    const above = u - W;
    if (uy - 1 >= y + 1 && gasLike(mat[above]) && uy > 1) {
      swap(i, above); flags[above] &= ~F_TICK;   // swap (not overwrite) so a gas cell up there is conserved
      const ax = above - (uy - 1) * W;
      mark(x, y); mark(ax, uy - 1); dirty(ax, uy - 1);
      return;
    }
    for (let d = 0; d < 4; d++) {
      const v = u + OFF[d];
      if (v < 0 || v >= W * H || stamp[v] === stampN || mat[v] !== m) continue;
      stamp[v] = stampN; q[tail++] = v;
    }
  }
}
const levelQ = new Int32Array(720);

function stepLava(i: number, x: number, y: number): boolean {
  mark(x, y);
  for (let d = 0; d < 4; d++) {
    const n = i + OFF[d], nm = mat[n];
    if (nm === AIR || nm === LAVA) continue;
    if (nm === WATER) { mat[i] = BASALT; aux[i] = 0; flags[i] = 0; mat[n] = STEAM; aux[n] = gasLife(STEAM); flags[n] = 0; dirty(x, y); return true; }
    const f = FLAM[nm];
    if (f > 0) { if (rnd() < Math.min(1, f * 5 + 0.05)) igniteCell(n); }
    else if (MELT_AT[nm] < 1e8 && PHASE[nm] !== P_LIQUID && rnd() < 0.2) {
      if (nm === SNOW) { mat[n] = STEAM; aux[n] = gasLife(STEAM); flags[n] = 0; } else meltCell(n);
      if (rnd() < 0.3) { mat[i] = BASALT; aux[i] = 0; flags[i] = 0; dirty(x, y); return true; }
    }
  }
  return false;
}

/** A burning liquid cell (F_BURN travels with the cell): flames above it, spreads to flammable neighbours, is slowly consumed. */
function burnLiquid(i: number, x: number, y: number) {
  mark(x, y);
  for (let d = 0; d < 4; d++) {
    const n = i + OFF[d], nm = mat[n];
    if (nm === AIR) { if (d === 0 ? rnd() < 0.3 : rnd() < 0.04) setFire(n); continue; }
    if (nm === WATER) { if (rnd() < 0.3) { flags[i] &= ~F_BURN; return; } continue; }
    const f = FLAM[nm];
    if (f > 0) { if (rnd() < f * 0.4) igniteCell(n); }
  }
  if (rnd() < 0.006) { setFire(i); aux[i] = 20 + ((rnd() * 20) | 0); }
}

function stepLiquid(i: number, x: number, y: number, m: number, dir: number) {
  if (flags[i] & F_BURN) { burnLiquid(i, x, y); if (mat[i] !== m) return; }
  if (m === LAVA) { if (stepLava(i, x, y)) return; if (rnd() > 0.25) return; }
  const d = DENS[m], b = i + W, mb = mat[b];
  if (canFall(mb, d)) {
    let j = b;
    if (mb === AIR && y < H - 2 && mat[b + W] === AIR) j = b + W;
    swap(i, j); mark(x, y);
    return;
  }
  const s = rnd() < 0.5 ? -1 : 1;
  for (let k = 0; k < 2; k++) {
    const dd = k === 0 ? s : -s;
    if (canFall(mat[b + dd], d) && isFluidCell(mat[i + dd])) { swap(i, b + dd); mark(x, y); return; }
  }
  const fl = FLOW[m] | 0;
  if (fl > 0) {
    for (let k = 0; k < 2; k++) {
      const dd = k === 0 ? s : -s;
      let j = -1;
      for (let c = 1; c <= fl; c++) {
        const xx = x + dd * c;
        if (xx < 1 || xx > W - 2) break;
        const t = mat[i + dd * c];
        if (!canFall(t, d)) break;
        j = i + dd * c;
        if (canFall(mat[j + W], d)) break;
      }
      if (j >= 0) { swap(i, j); if (dd === dir) flags[j] |= F_TICK; mark(x, y); return; }
    }
  }
  // stuck: maybe a lower free surface exists elsewhere in this body (U-tubes)
  if (levelBudget > 0 && gasLike(mat[i - W]) && rnd() < 0.04) { levelBudget--; levelAttempt(i, x, y, m); }
}

// ------------------------------------------------------------------ gases
function stepGas(i: number, x: number, y: number, m: number, dir: number) {
  if (LIFE_MAX[m] > 0) {
    mark(x, y);
    if ((tickN & 1) === 0) {
      const a = aux[i];
      if (a <= 1) {
        const t = temp[(y >> 2) * TW + (x >> 2)];
        if (m === STEAM) {
          if (t < 0) { mat[i] = SNOW; aux[i] = 0; flags[i] = 0; return; }
          if (WALK[mat[i - W]]) { mat[i] = WATER; aux[i] = 0; flags[i] = 0; return; }
        }
        mat[i] = AIR; aux[i] = 0; return;
      }
      aux[i] = a - 1;
    }
    if (m === STEAM && FREEZE_AT[m] > -1e8) {
      const t = temp[(y >> 2) * TW + (x >> 2)];
      if (t < FREEZE_AT[m] && rnd() < 0.04) { mat[i] = MAT.SNOW; aux[i] = 0; flags[i] = 0; return; }
    }
  }
  const dm = DENS[m], u = i - W;
  if (y > 1 && rnd() < 0.8) {
    const t = mat[u];
    if (t === AIR || ((PHASE[t] >= P_LIQUID) && DENS[t] > dm)) { swap(i, u); flags[u] |= F_TICK; if (LIFE_MAX[m] === 0) mark(x, y); return; }
    const dd = rnd() < 0.5 ? -1 : 1;
    const ud = u + dd, td = mat[ud];
    if (td === AIR && isFluidCell(mat[i + dd])) { swap(i, ud); flags[ud] |= F_TICK; if (LIFE_MAX[m] === 0) mark(x, y); return; }
  }
  // lateral drift (wind biased)
  const w = wind[(y >> 2) * TW + (x >> 2)];
  const aw = w < 0 ? -w : w;
  if (rnd() < FLOW[m] * 0.45 + aw * 0.04) {
    const dd = (aw > 0.5 && rnd() < 0.5 + aw * 0.05) ? (w > 0 ? 1 : -1) : (rnd() < 0.5 ? -1 : 1);
    const xx = x + dd;
    if (xx > 0 && xx < W - 1 && mat[i + dd] === AIR) { swap(i, i + dd); if (dd === dir) flags[i + dd] |= F_TICK; }
  }
}

// ------------------------------------------------------------------ slow stochastic pass (melting, freezing, sintering…)
function exposed(i: number): boolean {
  return isFluidCell(mat[i - W]) || isFluidCell(mat[i + 1]) || isFluidCell(mat[i - 1]) || isFluidCell(mat[i + W]);
}
function slowCell(i: number, x: number, y: number, m: number) {
  const t = temp[(y >> 2) * TW + (x >> 2)];
  switch (SK[m]) {
    case 1: { // loose snow
      if (t > MELT_AT[SNOW]) {
        const p = (t - MELT_AT[SNOW]) * 0.02 * (exposed(i) ? 1 : 0.3);
        if (rnd() < p) { mat[i] = WATER; aux[i] = 0; flags[i] = 0; drainHeat(x, y, 2); mark(x, y); return; }
      }
      let f = flags[i];
      if (!(f & F_WET) && (mat[i - W] === WATER || mat[i + 1] === WATER || mat[i - 1] === WATER || mat[i + W] === WATER)) { f |= F_WET; flags[i] = f; }
      if (f & F_WET) {
        if (t < -2 && rnd() < 0.3) { mat[i] = ICE; aux[i] = 0; flags[i] = f & F_PLACED; return; }
        if (t > 0.5 && !(mat[i - W] === WATER || mat[i + 1] === WATER || mat[i - 1] === WATER || mat[i + W] === WATER) && rnd() < 0.1) flags[i] = f & ~F_WET;
      }
      if (WALK[mat[i + W]]) {
        let load = 0;
        for (let k = 1; k <= 6; k++) { const a = mat[i - k * W]; if (a === SNOW || PHASE[a] === P_SOLID) load++; else break; }
        const tf = t >= 0 ? 1.4 : t > -1 ? 1 + 0.4 * (t + 1) : t < -25 ? 0.15 : 0.35 + 0.65 * (t + 25) / 24;
        let inc = (1 + load * 1.5) * tf * ((f & F_WET) ? 3 : 1);
        let a = aux[i] + inc;
        if (a >= 200) { mat[i] = PACKED; aux[i] = 0; flags[i] = f & F_PLACED; return; }
        // stochastic rounding keeps the slow rates correct with 8-bit storage
        const fl = Math.floor(a); a = fl + (rnd() < a - fl ? 1 : 0);
        aux[i] = a > 255 ? 255 : a;
      }
      return;
    }
    case 2: { // PACKED / SNOWBLOCK / ICE melt
      const ma = MELT_AT[m];
      if (t > ma) {
        const p = (t - ma) * 0.012 * (exposed(i) ? 1 : 0.08);
        if (rnd() < p) { mat[i] = MELT_TO[m]; aux[i] = 0; flags[i] = 0; drainHeat(x, y, 2); mark(x, y); dirty(x, y); }
      }
      return;
    }
    case 3: { // water: freeze (surface first) / boil
      const fa = FREEZE_AT[WATER];
      if (t < fa) {
        const up = mat[i - W];
        let ex = (gasLike(up) || up === ICE) ? 1 : (mat[i - 1] === ICE || mat[i + 1] === ICE || gasLike(mat[i - 1]) || gasLike(mat[i + 1])) ? 0.35 : 0.04;
        if (mat[i + W] === ICE && ex < 0.25) ex = 0.25;
        const p = Math.min(0.6, (fa - t) * 0.03 * ex);
        if (rnd() < p) { mat[i] = ICE; aux[i] = 0; flags[i] = 0; drainHeat(x, y, -2); }
      } else if (t > BOIL_AT[WATER]) {
        mat[i] = STEAM; aux[i] = gasLife(STEAM); flags[i] = 0; drainHeat(x, y, 3); mark(x, y);
      }
      return;
    }
    case 4: { // stray lava cools into basalt
      let n = 0;
      if (mat[i - W] === LAVA) n++; if (mat[i + W] === LAVA) n++; if (mat[i - 1] === LAVA) n++; if (mat[i + 1] === LAVA) n++;
      // lava is a thermostat at ~110 C in the tile map: a lone cell in hot ground lingers, one in cold ground cools quickly
      const p = n === 0 ? (t < 90 ? 0.3 : 0.04) : gasLike(mat[i - W]) ? 0.012 : 0;
      if (rnd() < p) { mat[i] = BASALT; aux[i] = 0; flags[i] = 0; }
      return;
    }
  }
}

// ------------------------------------------------------------------ snowfall
function depositAt(x: number): boolean {
  const y = surfaceY(x);
  if (y < 3 || y >= H - 2) return false;
  const top = mat[y * W + x];
  if (top === FIRE || top === LAVA) return false;
  // snow rests on spruce boughs only in thin layers
  let k = 0, j = y;
  while (k < 4 && mat[j * W + x] === SNOW) { k++; j++; }
  if (k >= 3 && mat[j * W + x] === NEEDLES) return false;
  const t = (y - 1) * W + x;
  if (!gasLike(mat[t])) return false;
  put(t, SNOW, 0, 0);
  surf[x] = y - 1;
  mark(x, y - 1);
  return true;
}
function snowfallTick(x0: number, x1: number) {
  const sf = G.snowfall;
  if (sf <= 0.001) return;
  const ncol = x1 - x0 + 1;
  depAcc += ncol * (snowCfg.curve === 1 ? sf : Math.pow(sf, snowCfg.curve)) * (1 / 240) * snowCfg.rate;
  while (depAcc >= 1) { depAcc -= 1; depositAt(x0 + ((rnd() * ncol) | 0)); }
}

/** Strong wind (> 8 m/s) lifts loose surface snow as flying cells; it comes down further downwind → drifts in the lee. */
function windLift(x0: number, x1: number) {
  const aw = Math.abs(G.wind);
  if (aw <= 8) return;
  const want = (aw - 8) * 1.4;
  const n = (want | 0) + (rnd() < want - (want | 0) ? 1 : 0);
  for (let k = 0; k < n; k++) {
    const x = x0 + ((rnd() * (x1 - x0 + 1)) | 0);
    const y = surfaceY(x), i = y * W + x;
    if (y < 3 || mat[i] !== SNOW || (flags[i] & F_WET) || !gasLike(mat[i - W])) continue;
    const w = wind[((y - 1) >> 2) * TW + (x >> 2)];
    if (w > -6 && w < 6) continue;   // sheltered column
    if (!throwCell(x, y - 1, SNOW, 0, w * 7 + (rnd() - 0.5) * 20, -10 - rnd() * 26)) continue;   // flying-cell pool full: leave the snow where it is
    mat[i] = AIR; aux[i] = 0; flags[i] = 0; surf[x] = -1;
    mark(x, y);
  }
}

// ------------------------------------------------------------------ main tick
function tick() {
  tickN++;
  simStats.ticks++;
  const w = G.win;
  const x0 = Math.max(1, w.x0 - MARGIN), x1 = Math.min(W - 2, w.x1 + MARGIN);
  const y0 = Math.max(1, w.y0 - MARGIN), y1 = Math.min(H - 2, w.y1 + MARGIN);
  if (x1 <= x0 || y1 <= y0) return;
  const cx0 = x0 >> 5, cx1 = x1 >> 5, cy0 = y0 >> 5, cy1 = y1 >> 5;
  levelBudget = 6;

  stepBurning(x0, y0, x1, y1);

  for (let cy = cy1; cy >= cy0; cy--) {
    const crow = cy * CW;
    let any = false;
    for (let cx = cx0; cx <= cx1; cx++) if (awake[crow + cx]) { any = true; break; }
    if (!any) continue;
    const yTop = Math.max(y0, cy * CS), yBot = Math.min(y1, cy * CS + CS - 1);
    for (let y = yBot; y >= yTop; y--) {
      const row = y * W;
      const dir = ((y + tickN) & 1) ? 1 : -1;
      if (dir > 0) {
        for (let cx = cx0; cx <= cx1; cx++) {
          if (!awake[crow + cx]) continue;
          const xs = Math.max(x0, cx * CS), xe = Math.min(x1, cx * CS + CS - 1);
          for (let x = xs; x <= xe; x++) scanCell(row + x, x, y, dir);
        }
      } else {
        for (let cx = cx1; cx >= cx0; cx--) {
          if (!awake[crow + cx]) continue;
          const xs = Math.max(x0, cx * CS), xe = Math.min(x1, cx * CS + CS - 1);
          for (let x = xe; x >= xs; x--) scanCell(row + x, x, y, dir);
        }
      }
    }
  }

  snowfallTick(x0, x1);
  windLift(x0, x1);

  // slow stochastic pass
  const nS = ((x1 - x0 + 1) * (y1 - y0 + 1)) / SAMPLE_PERIOD;
  const nI = nS | 0, extra = rnd() < nS - nI ? 1 : 0;
  const ww = x1 - x0 + 1, hh = y1 - y0 + 1;
  for (let k = 0; k < nI + extra; k++) {
    const x = x0 + ((rnd() * ww) | 0), y = y0 + ((rnd() * hh) | 0);
    const i = y * W + x, m = mat[i];
    if (SK[m]) slowCell(i, x, y, m);
  }

  // chunk sleep bookkeeping
  let aw = 0;
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const c = cy * CW + cx;
    if (act[c]) { act[c] = 0; if (awake[c] < SLEEP_TICKS) awake[c] = SLEEP_TICKS; }
    else if (awake[c] > 0) awake[c]--;
    if (awake[c]) aw++;
  }
  simStats.chunks = aw;
}

function scanCell(i: number, x: number, y: number, dir: number) {
  const m = mat[i];
  if (m === 0) return;
  const ph = PHASE[m];
  if (ph === P_SOLID) return;
  const f = flags[i];
  if (f & F_TICK) { flags[i] = f & ~F_TICK; return; }
  switch (ph) {
    case P_POWDER: stepPowder(i, x, y, m); break;
    case P_LIQUID: stepLiquid(i, x, y, m, dir); break;
    case P_GAS: stepGas(i, x, y, m, dir); break;
    case P_FIRE: stepFire(i, x, y); break;
  }
}

// ------------------------------------------------------------------ public API
export function initSim() {
  tickN = 0; acc = 0; depAcc = 0;
  act.fill(0); surf.fill(-1); colSnow.fill(0); stamp.fill(0); stampN = 0;
  nBurn = 0;
  for (let i = 0; i < W * H && nBurn < MAXB; i++) {
    if ((flags[i] & F_BURN) && BURN_LIFE[mat[i]] > 0) addBurn(i, mat[i]);
    else if ((flags[i] & F_BURN) && !(PHASE[mat[i]] === P_LIQUID && FLAM[mat[i]] > 0)) flags[i] &= ~F_BURN;   // burning liquids carry F_BURN without a timer
  }
  prevX0 = prevX1 = -1;
  dRect.n = 0;
  if (!inited) {
    inited = true;
    // edits invalidate the cached surface of the touched columns
    onEdit((ex0, _y0, ex1) => { for (let x = Math.max(0, ex0); x <= Math.min(W - 1, ex1); x++) surf[x] = -1; });
  }
}

export function stepSim(dt: number): void {
  if (dt > 0.25) dt = 0.25;
  acc += dt;
  let n = 0;
  while (acc >= TICK && n < 3) { tick(); acc -= TICK; n++; }
  if (acc > TICK) acc = acc % TICK;

  const w = G.win;
  const x0 = Math.max(1, w.x0 - MARGIN), x1 = Math.min(W - 2, w.x1 + MARGIN);
  if (x1 > x0) {
    // snow accumulates on columns outside the window; columns entering it receive their share
    const rate = (snowCfg.curve === 1 ? G.snowfall : Math.pow(G.snowfall, snowCfg.curve)) * dt * 0.25 * snowCfg.rate;
    if (rate > 0) for (let x = 0; x < W; x++) if ((x < x0 || x > x1) && colSnow[x] < 12) colSnow[x] += rate;
    if (prevX0 >= 0) {
      const lo = Math.min(x0, prevX0), hi = Math.max(x1, prevX1);
      for (let x = lo; x <= hi; x++) {
        const inNow = x >= x0 && x <= x1, inPrev = x >= prevX0 && x <= prevX1;
        if (inNow && !inPrev) {
          const k = Math.min(10, colSnow[x] | 0);
          for (let j = 0; j < k; j++) if (!depositAt(x)) break;
          colSnow[x] = 0;
        }
      }
    }
    prevX0 = x0; prevX1 = x1;
    // keep the surface cache honest for a few random window columns
    for (let k = 0; k < 8; k++) surf[x0 + ((rnd() * (x1 - x0 + 1)) | 0)] = -1;
  }
  flushDirty();
}
