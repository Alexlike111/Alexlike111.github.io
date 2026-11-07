// Per-tile temperature, wind and shelter. See SPEC §2 "Heat".
//
// Model (units: °C, seconds, tile = 4×4 cells):
//  * every tile has an effective conductivity k (mean of COND, air counted as K_AIR because of convective mixing)
//    and a heat capacity C (mean of CAP). Neighbouring tiles exchange energy  q = g·ΔT·dt,  g = harmonic mean of k.
//  * sky-open tiles (no blocking tile above them in their column) relax fast to G.ambientT, faster with wind.
//    Everything else relaxes only slowly to the geothermal profile → a closed room with a fire gets warm.
//  * sources: cells with HEAT[] (fire, embers: power per cell; lava: thermostat), burning solids, addHeat() (fixtures).
//  * wind: G.wind scaled by exposure (a per-row sweep: blocking tiles kill it, it recovers slowly in the lee).
// Only tiles inside G.win + margin are simulated each frame; chunks that re-enter the window get an analytic catch-up.
import { W, TS, TW, TH, CS, CW, CHN, mat, flags, F_BURN, onEdit } from './grid';
import { MAT, PHASE, COND, CAP, WIND, HEAT, P_LIQUID, P_GAS, P_FIRE, P_EMPTY } from '../content/materials';
import { G } from '../game/state';

export const temp = new Float32Array(TW * TH);   // °C
export const wind = new Float32Array(TW * TH);   // m/s, + = east
export const sky = new Uint8Array(TW * TH);      // 1 = open to sky

/** Suggested addHeat() powers (units: ≈ °C/s of one air tile with no losses). */
export const HEAT_POWER = { torch: 6, campfire: 90, furnace: 150, stove: 210, lantern: 2, player: 1 };

// ---- tuning ----
const K_AIR = 6.0;            // effective conductivity of air tiles (convective mixing)
const AIR_CAP = 2.0;          // effective heat capacity of an air tile (air + furniture + humidity)
const RS_SURF = 0.12;         // the exposed surface tile of a column relaxes towards ambient too
const RS_BASE = 0.5;          // sky-open relaxation rate to ambient (1/s)
const RS_WIND = 0.12;         // + per m/s of local wind
const SHAFT = 0.08;           // a sky-open tile boxed in by non-sky tiles on both sides (a roof vent above a room) exchanges heat with the sky only through its small opening
const RG_SOLID = 0.0015;      // relaxation of enclosed/solid tiles to the geothermal profile (1/s)
const RG_AIR = 0.004;         // same for enclosed air
const POWER_PER_HEAT = 0.012; // cell HEAT (°C) → source power
const BURN_POWER = 4.5;       // burning solid cell
const LAVA_T = 110;           // thermostat temperature of a fully-lava tile (tile temps are capped; real lava is hotter)
const HM = 8;                 // simulation margin around G.win (tiles)
const CATCHUP_AFTER = 2.0;    // seconds out of the window before a chunk gets an analytic catch-up

// ---- per-tile caches ----
const kt = new Float32Array(TW * TH);     // conductivity
const ict = new Float32Array(TW * TH);    // 1 / capacity
const blk = new Uint8Array(TW * TH);      // 1 = blocks air/wind (≥ half of the cells are wind-blocking)
const srcP = new Float32Array(TW * TH);   // source power
const lavaN = new Uint8Array(TW * TH);    // lava cells in the tile
const watN = new Uint8Array(TW * TH);     // water-ish liquid cells in the tile
const pend = new Float32Array(TW * TH);   // energy queued by addHeat()
const expo = new Uint8Array(TW * TH);     // wind exposure 0..255
const colTop = new Int16Array(TW);        // first blocking tile row of each column (TH if none)
const chunkClock = new Float32Array(CW * CHN).fill(-1);

// per-material helper tables
const KK = new Float32Array(256), SRC = new Float32Array(256), CAPT = new Float32Array(256);
for (let m = 0; m < 256; m++) {
  const ph = PHASE[m];
  KK[m] = (m === 0 || ph === P_GAS || ph === P_FIRE || ph === P_EMPTY) ? K_AIR : COND[m];
  CAPT[m] = (m === 0 || ph === P_GAS || ph === P_FIRE || ph === P_EMPTY) ? AIR_CAP : CAP[m];
  SRC[m] = (HEAT[m] === HEAT[m] && ph !== P_LIQUID) ? HEAT[m] * POWER_PER_HEAT : 0;
}

let hclock = 0, frameN = 0, lastDt = 1 / 60;
const profile = new Float32Array(TH);     // geothermal target per tile row
function geo(y: number) {
  if (y < 330) return -4;
  if (y < 600) return -4 + (y - 330) * (12 / 270);
  return 8 + (y - 600) * (6 / 168);
}
for (let ty = 0; ty < TH; ty++) profile[ty] = geo(ty * TS + 2);

// ---- thermal zones (hot springs, geothermal sites): persistent attractors, applied inside the window ----
interface Zone { tx: number; ty: number; r: number; T: number }
const zones: Zone[] = [];
/** Persistent warm/cold zone (cells). Tiles inside the circle are pulled towards T. */
export function addThermalZone(x: number, y: number, rCells: number, T: number) { zones.push({ tx: x / TS, ty: y / TS, r: rCells / TS, T }); }
export function clearThermalZones() { zones.length = 0; }

// ---- tile property refresh ----
function refreshTile(tx: number, ty: number) {
  const t = ty * TW + tx;
  let i = ty * TS * W + tx * TS;
  let sk = 0, sc = 0, nb = 0, sp = 0, lv = 0, wt = 0;
  for (let j = 0; j < TS; j++, i += W - TS) {
    for (let k = 0; k < TS; k++, i++) {
      const m = mat[i];
      sk += KK[m]; sc += CAPT[m]; sp += SRC[m];
      if (WIND[m] >= 0.9) nb++;
      if (PHASE[m] === P_LIQUID) { if (m === MAT.LAVA) lv++; else wt++; }
      if (flags[i] & F_BURN) sp += BURN_POWER;
    }
  }
  kt[t] = sk / 16; ict[t] = 16 / sc; blk[t] = nb >= 8 ? 1 : 0; srcP[t] = sp; lavaN[t] = lv; watN[t] = wt;
}

function refreshColumn(tx: number) {
  let top = 0;
  while (top < TH && !blk[top * TW + tx]) top++;
  colTop[tx] = top;
  for (let ty = 0; ty < TH; ty++) sky[ty * TW + tx] = ty < top ? 1 : 0;
}

function targetOf(t: number, ty: number) {
  let p = profile[ty];
  if (watN[t] >= 8 && p < -1) p = -1;   // liquid water under ice does not drop below freezing on its own
  return p;
}

/** Seed the whole world: sky-open tiles at ambient, the rest at the geothermal profile (+ warmth around lava/zones). */
export function initHeat() {
  for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) refreshTile(tx, ty);
  for (let tx = 0; tx < TW; tx++) refreshColumn(tx);
  for (let ty = 0; ty < TH; ty++) {
    for (let tx = 0; tx < TW; tx++) {
      const t = ty * TW + tx;
      temp[t] = sky[t] ? G.ambientT : targetOf(t, ty);
    }
  }
  // warmth around lava pools: T = max(profile, LAVA_T·exp(-d/4.5))
  for (let ty = 0; ty < TH; ty++) {
    for (let tx = 0; tx < TW; tx++) {
      if (!lavaN[ty * TW + tx]) continue;
      for (let dy = -10; dy <= 10; dy++) for (let dx = -10; dx <= 10; dx++) {
        const x = tx + dx, y = ty + dy;
        if (x < 0 || y < 0 || x >= TW || y >= TH) continue;
        const v = LAVA_T * Math.exp(-Math.sqrt(dx * dx + dy * dy) / 4.5);
        const q = y * TW + x;
        if (v > temp[q] && !sky[q]) temp[q] = v;
      }
    }
  }
  for (const z of zones) {
    const r = Math.ceil(z.r);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = Math.round(z.tx) + dx, y = Math.round(z.ty) + dy;
      if (x < 0 || y < 0 || x >= TW || y >= TH || dx * dx + dy * dy > z.r * z.r) continue;
      temp[y * TW + x] = z.T;
    }
  }
  wind.fill(0); pend.fill(0); chunkClock.fill(-1);
  hclock = 0; frameN = 0;
  updateWind(0, 0, TW - 1, TH - 1);
}

// grid edits: refresh the touched tiles right away (cheap), columns lazily with the next sweep
const dirtyCols = new Uint8Array(TW);
onEdit((x0, y0, x1, y1) => {
  const tx0 = Math.max(0, x0 >> 2), tx1 = Math.min(TW - 1, x1 >> 2), ty0 = Math.max(0, y0 >> 2), ty1 = Math.min(TH - 1, y1 >> 2);
  if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 4000) return; // huge edits are picked up by the normal sweep
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) refreshTile(tx, ty);
  for (let tx = tx0; tx <= tx1; tx++) dirtyCols[tx] = 1;
});

// ---- queries (cell coordinates) ----
const clampT = (v: number, hi: number) => (v < 0 ? 0 : v > hi ? hi : v);
/** Temperature (°C) at a cell position, bilinearly interpolated between tile centres. */
export function tempAt(x: number, y: number): number {
  const fx = clampT(x / TS - 0.5, TW - 1.001), fy = clampT(y / TS - 0.5, TH - 1.001);
  const tx = fx | 0, ty = fy | 0, ax = fx - tx, ay = fy - ty, t = ty * TW + tx;
  return (temp[t] * (1 - ax) + temp[t + 1] * ax) * (1 - ay) + (temp[t + TW] * (1 - ax) + temp[t + TW + 1] * ax) * ay;
}
export function tempAtTile(tx: number, ty: number): number { return temp[clampT(ty, TH - 1) * TW + clampT(tx, TW - 1)]; }
export function windAt(x: number, y: number): number { return wind[clampT(y >> 2, TH - 1) * TW + clampT(x >> 2, TW - 1)]; }
/** 0..1: how sheltered a position is (1 = closed room, 0 = open ground in full wind). */
export function shelterAt(x: number, y: number): number {
  const tx = clampT(x >> 2, TW - 1), ty = clampT(y >> 2, TH - 1);
  let s = 0, n = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const a = tx + i, b = ty + j;
    if (a < 0 || b < 0 || a >= TW || b >= TH) continue;
    s += sky[b * TW + a]; n++;
  }
  const skyF = n ? s / n : 0, windF = expo[ty * TW + tx] / 255;
  const v = 1 - 0.55 * skyF - 0.45 * windF;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
export function isSkyOpen(x: number, y: number): boolean { return sky[clampT(y >> 2, TH - 1) * TW + clampT(x >> 2, TW - 1)] === 1; }

/** Queue heat (power in HEAT_POWER units, per second — call once per frame) at a cell position. */
export function addHeat(x: number, y: number, power: number): void {
  const tx = x >> 2, ty = y >> 2;
  if (tx < 0 || ty < 0 || tx >= TW || ty >= TH) return;
  const w = G.win;   // tiles outside the simulated window would only pile up energy that is never consumed
  if (tx < (w.x0 >> 2) - HM || tx > (w.x1 >> 2) + HM || ty < (w.y0 >> 2) - HM || ty > (w.y1 >> 2) + HM) return;
  pend[ty * TW + tx] += power * lastDt;
}
/** One-off temperature change spread over a radius (cells): explosions, lightning, splashes. */
export function burstHeat(x: number, y: number, rCells: number, dT: number): void {
  const r = Math.max(1, Math.ceil(rCells / TS)), cx = x >> 2, cy = y >> 2;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const tx = cx + dx, ty = cy + dy;
    if (tx < 0 || ty < 0 || tx >= TW || ty >= TH) continue;
    const f = 1 - Math.sqrt(dx * dx + dy * dy) / (r + 1);
    if (f > 0) temp[ty * TW + tx] += dT * f;
  }
}
/** Remove thermal energy from the tile at a cell position (latent heat of melting). */
export function drainHeat(x: number, y: number, energy: number): void {
  const t = (y >> 2) * TW + (x >> 2);
  temp[t] -= energy * ict[t];
}

/** Flood fill of non-blocking tiles from the position (≤ 900 tiles). closed = it never reaches the open sky or the map edge. */
const seenStamp = new Int32Array(TW * TH);
let stampN = 0;
const queue = new Int32Array(1024);
export function enclosure(x: number, y: number): { closed: boolean; tiles: number } {
  const tx0 = x >> 2, ty0 = y >> 2;
  if (tx0 < 0 || ty0 < 0 || tx0 >= TW || ty0 >= TH) return { closed: false, tiles: 0 };
  const startT = ty0 * TW + tx0;
  if (tileBlocked(tx0, ty0)) return { closed: false, tiles: 0 };
  stampN++;
  let head = 0, tail = 0, count = 0;
  queue[tail++] = startT; seenStamp[startT] = stampN;
  while (head < tail) {
    const t = queue[head++];
    count++;
    const tx = t % TW, ty = (t / TW) | 0;
    if (sky[t]) return { closed: false, tiles: count };
    if (count > 900) return { closed: false, tiles: count };
    if (tx === 0 || ty === 0 || tx === TW - 1 || ty === TH - 1) return { closed: false, tiles: count };
    for (let d = 0; d < 4; d++) {
      const n = d === 0 ? t - 1 : d === 1 ? t + 1 : d === 2 ? t - TW : t + TW;
      if (seenStamp[n] === stampN) continue;
      seenStamp[n] = stampN;
      const nx = d === 0 ? tx - 1 : d === 1 ? tx + 1 : tx, ny = d === 2 ? ty - 1 : d === 3 ? ty + 1 : ty;
      if (tileBlocked(nx, ny)) continue;
      if (tail >= queue.length) return { closed: false, tiles: count };
      queue[tail++] = n;
    }
  }
  return { closed: true, tiles: count };
}
function tileBlocked(tx: number, ty: number): boolean {
  let i = ty * TS * W + tx * TS, nb = 0;
  for (let j = 0; j < TS; j++, i += W - TS) for (let k = 0; k < TS; k++, i++) if (WIND[mat[i]] >= 0.9) nb++;
  return nb >= 8;
}

// ---- wind field ----
function updateWind(tx0: number, ty0: number, tx1: number, ty1: number) {
  const base = G.wind;
  if (Math.abs(base) < 0.02) {
    for (let ty = ty0; ty <= ty1; ty++) { const r = ty * TW; for (let tx = tx0; tx <= tx1; tx++) { wind[r + tx] = 0; expo[r + tx] = 0; } }
    return;
  }
  const dir = base > 0 ? 1 : -1;
  const startX = dir > 0 ? Math.max(0, tx0 - 40) : Math.min(TW - 1, tx1 + 40);
  const endX = dir > 0 ? tx1 : tx0;
  for (let ty = ty0; ty <= ty1; ty++) {
    const r = ty * TW;
    let e = 1;
    for (let tx = startX; dir > 0 ? tx <= endX : tx >= endX; tx += dir) {
      const t = r + tx;
      let vp = 1;
      if (blk[t]) e = 0;
      else if (sky[t]) { e += (1 - e) * 0.1; const h = colTop[tx] - ty; vp = 0.45 + 0.55 * (h >= 10 ? 1 : h / 10); }
      else e *= 0.45;
      if (tx >= tx0 && tx <= tx1) { wind[t] = blk[t] ? 0 : base * e * vp; expo[t] = (e * 255) | 0; }
    }
  }
}

// ---- main step ----
function catchUp(c: number, dtAway: number) {
  const cx = c % CW, cy = (c / CW) | 0;
  const tx0 = cx * (CS / TS), ty0 = cy * (CS / TS), n = CS / TS;
  for (let ty = ty0; ty < ty0 + n; ty++) for (let tx = tx0; tx < tx0 + n; tx++) refreshTile(tx, ty);
  for (let tx = tx0; tx < tx0 + n; tx++) refreshColumn(tx);
  const fSky = 1 - Math.exp(-dtAway * 0.5), fGnd = 1 - Math.exp(-dtAway * 0.02);
  for (let ty = ty0; ty < ty0 + n; ty++) for (let tx = tx0; tx < tx0 + n; tx++) {
    const t = ty * TW + tx;
    if (sky[t]) temp[t] += (G.ambientT - temp[t]) * fSky;
    else temp[t] += (targetOf(t, ty) - temp[t]) * fGnd;
  }
}

export function stepHeat(dt: number): void {
  if (dt <= 0) return;
  if (dt > 0.05) dt = 0.05;
  lastDt = dt;
  hclock += dt; frameN++;
  const w = G.win;
  const x0 = Math.max(1, (w.x0 >> 2) - HM), x1 = Math.min(TW - 2, (w.x1 >> 2) + HM);
  const y0 = Math.max(1, (w.y0 >> 2) - HM), y1 = Math.min(TH - 2, (w.y1 >> 2) + HM);
  if (x1 <= x0 || y1 <= y0) return;

  // chunk bookkeeping + catch-up
  const cx0 = (x0 * TS) >> 5, cx1 = (x1 * TS) >> 5, cy0 = (y0 * TS) >> 5, cy1 = (y1 * TS) >> 5;
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const c = cy * CW + cx, last = chunkClock[c];
    if (last >= 0 && hclock - last > CATCHUP_AFTER) catchUp(c, hclock - last);
    chunkClock[c] = hclock;
  }

  // property refresh, interleaved by rows: each row is refreshed every 8th frame
  const phase = frameN & 7;
  for (let ty = y0; ty <= y1; ty++) {
    if ((ty & 7) !== phase) continue;
    for (let tx = x0; tx <= x1; tx++) refreshTile(tx, ty);
  }
  if (phase === 7 || (frameN & 63) === 1) {
    for (let tx = x0; tx <= x1; tx++) refreshColumn(tx);
  } else {
    for (let tx = x0; tx <= x1; tx++) if (dirtyCols[tx]) { refreshColumn(tx); dirtyCols[tx] = 0; }
  }
  if ((frameN % 6) === 0) updateWind(x0, y0, x1, y1);

  // ---- diffusion / relaxation / sources ----
  const amb = G.ambientT;
  for (let ty = y0; ty <= y1; ty++) {
    const row = ty * TW, prof = profile[ty];
    for (let tx = x0; tx <= x1; tx++) {
      const t = row + tx;
      let T = temp[t];
      const ic = ict[t];
      if (sky[t]) {
        const wv = wind[t];
        let rs = RS_BASE + RS_WIND * (wv < 0 ? -wv : wv);
        if (!sky[t - 1] && !sky[t + 1]) rs *= SHAFT;
        T += (amb - T) * Math.min(0.9, rs * dt);
      } else {
        const p = (watN[t] >= 8 && prof < -1) ? -1 : prof;
        T += (p - T) * (blk[t] ? RG_SOLID : RG_AIR) * dt;
        const dpt = ty - colTop[tx];
        if (dpt === 0) T += (amb - T) * RS_SURF * dt;            // exposed surface follows the air
        else if (dpt === 1) T += (amb - T) * (RS_SURF * 0.25) * dt;
      }
      const e = srcP[t] * dt + pend[t];
      if (e !== 0) { T += e * ic; pend[t] = 0; if (T > 160) T = 160; }   // runaway guard: a burning house must not boil the map
      const lv = lavaN[t];
      if (lv) T += (LAVA_T - T) * Math.min(1, lv * 0.125 * dt);
      // conduction to the right and downward neighbours (energy-conserving pair exchange, never overshoots)
      const k = kt[t];
      let n = t + 1;
      {
        const kn = kt[n], g = (2 * k * kn) / (k + kn) * dt;
        const Tn = temp[n], d = T - Tn, icn = ict[n];
        let q = g * d;
        const lim = d / (ic + icn) * 0.9;
        if (d > 0 ? q > lim : q < lim) q = lim;
        T -= q * ic; temp[n] = Tn + q * icn;
      }
      n = t + TW;
      {
        const kn = kt[n], g = (2 * k * kn) / (k + kn) * dt;
        const Tn = temp[n], d = T - Tn, icn = ict[n];
        let q = g * d;
        const lim = d / (ic + icn) * 0.9;
        if (d > 0 ? q > lim : q < lim) q = lim;
        T -= q * ic; temp[n] = Tn + q * icn;
      }
      temp[t] = T;
    }
  }
  // the left and top neighbours were already handled by their own pair exchange; apply zones
  if (zones.length) {
    for (const z of zones) {
      const r = Math.ceil(z.r), cxz = Math.round(z.tx), cyz = Math.round(z.ty);
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = cxz + dx, y = cyz + dy;
        if (x < x0 || x > x1 || y < y0 || y > y1 || dx * dx + dy * dy > z.r * z.r) continue;
        const t = y * TW + x;
        temp[t] += (z.T - temp[t]) * Math.min(1, 2 * dt);
      }
    }
  }
}
