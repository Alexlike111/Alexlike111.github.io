// Heat + local wind field. Heat cell = HS x HS world cells (20 cm). Temperatures in degC.
// Units are "game units", not SI: air cell has C=1, snow ~30*dens/300 (see composition table below).
// Everything runs per REAL second (the game clock is 60x faster; constants are tuned for that).
import { W, H, HS, HW, HH, M, mat, dens, bond, flags, idx, inb, set, groundY, noise1 } from './world';
import { G } from './state';
import { pnow, pend } from './prof';

export const T = new Float32Array(HW * HH);    // temperature per heat cell
export const WND = new Float32Array(HW * HH);  // local horizontal wind, m/s (+ toward +x)
export const surf = new Int16Array(W);         // y of the topmost non-AIR/non-NEEDLE cell per column

// ---------------- tuning constants ----------------
const GK_AIR = 1.0;        // scale of air<->air conduction (k_air_eff 0.35 * GK)
const GK_SOLID = 0.15;     // scale of any conduction pair touching a solid (film resistance at walls)
const SRC = 1 / 400;       // W -> heat units/s: a 4000 W fire = 10 u/s (Q/Ccell K/s into the cell it lands in)
const FIRE_AIR = 5.2;        // multiplier on the share of fire power that warms the air around the flame (a campfire heats a closed shelter in ~1 min)
const FIRE_CONTACT = 8;    // multiplier on the share of fire power going into the cell right below the flame
const BUOY = 0.9;          // 1/s: warm air hands heat to the air cell above
const VENT_SKY = 0.05;     // 1/s ventilation of sky-open air cells towards ambient
const VENT_LEAK = 0.006;   // 1/s leak of roofed air cells (cracks, breathing)
const VENT_WIND = 0.12;    // extra 1/s per m/s of local wind
const ROOF_WIND = 0.25;    // roofed cells only exchange this share of the wind-driven ventilation (draught through openings)
const SKY_COOL = 0.012;    // 1/s: exposed surface snow relaxes to ambient-2
const GROUND_T = -2, GROUND_RATE = 0.1, GROUND_DEEP = 6; // dirt/rock deeper than 6 cells below groundY is pinned
const DEEP_SNOW_T = -4, SNOW_PROFILE_LEN = 40;           // initial snow profile: ambient at surface -> -4 at depth
const MELT_E = 6;          // energy (units of Ccell*K) to melt one dens=300 snow cell (scales with dens); real would be ~160 K*C
const FREEZE_RATE = 0.6;   // 1/s share of water cells in a heat cell that freeze when T < FREEZE_T
const FREEZE_T = -0.5, FREEZE_HEAT = 0.4; // freezing returns 40% of MELT_E (T goes up slightly)
const WIND_DECAY = 0.94;   // shelter retained per heat cell travelled downwind of an obstacle
const MARGIN = 8;          // heat cells simulated beyond G.win
// The solver integrates at most every HEAT_DT real seconds, using the accumulated dt (heat is slow: time constants of seconds).
// Explicit conduction stays stable for any sub-step <= 0.1 s (fastest cell rate ~1.5 1/s), so 20 Hz is well inside the limit.
const HEAT_DT = 0.05;
const COMP_STRIDE = 8;     // composition: each heat row is re-read every 8 solver runs (~0.4 s; the surface and phase passes keep their own rhythm)
const WIND_EVERY = 2;      // wind / sky / ventilation rates refresh every WIND_EVERY solver runs

// ---------------- per-material tables ----------------
const SK = new Float32Array(1024), SC = new Float32Array(1024);
for (let d = 0; d < 1024; d++) {
  const r = Math.max(0.03, d / 1000);
  SK[d] = Math.max(0.03, 0.138 - 1.01 * r + 3.233 * r * r);           // Sturm 1997
  SC[d] = Math.max(6, Math.min(60, 30 * d / 300));
}
// [k, C] by material (snow handled by tables). Air k is the effective (convective) value.
const MK = new Float32Array(16), MC = new Float32Array(16);
const setM = (m: number, k: number, c: number) => { MK[m] = k; MC[m] = c; };
setM(M.AIR, 0.35, 1); setM(M.NEEDLE, 0.3, 2); setM(M.ASH, 0.2, 5); setM(M.SNOW, 0.126, 30);
setM(M.ICE, 2.2, 60); setM(M.WATER, 0.56, 70); setM(M.DIRT, 1.2, 60); setM(M.ROCK, 2.0, 60); setM(M.BEDROCK, 2.0, 60);
setM(M.WOOD, 0.12, 25); setM(M.CRATE, 0.12, 25); setM(M.PLANK, 0.12, 25); setM(M.POLE, 0.12, 25); setM(M.DOOR, 0.12, 25);
// blocking for wind / shelter / sky: solid enough to stop air
const BLOCK = new Uint8Array(16);
for (const m of [M.SNOW, M.ICE, M.DIRT, M.ROCK, M.WOOD, M.PLANK, M.DOOR, M.CRATE, M.BEDROCK]) BLOCK[m] = 1;
const WATER_F = new Uint8Array(16), GND_F = new Uint8Array(16);   // water count / ground (dirt, rock, bedrock) count per cell
WATER_F[M.WATER] = 1; GND_F[M.DIRT] = 1; GND_F[M.ROCK] = 1; GND_F[M.BEDROCK] = 1;

// ---------------- per heat-cell state ----------------
// composition (refreshed by compose, staggered over rows)
const cap = new Float32Array(HW * HH).fill(1);     // mean heat capacity per cell
const kk = new Float32Array(HW * HH).fill(0.35);   // mean conductivity
const nSol = new Uint8Array(HW * HH);              // blocking cells of 16
const nSnow = new Uint8Array(HW * HH);
const nWat = new Uint8Array(HW * HH);
const nGnd = new Uint8Array(HW * HH);              // dirt/rock/bedrock
const sDens = new Uint16Array(HW * HH);            // mean snow density
const sky = new Uint8Array(HW * HH);               // 1 = no blocking heat cell above in the column
// conduction coefficients derived from the composition (refreshed with it, so the solver does no divisions per step)
const ic = new Float32Array(HW * HH).fill(1);      // 1 / cap
const air = new Uint8Array(HW * HH);               // 1 = air-like cell (cap <= 2)
const gR = new Float32Array(HW * HH);              // conductance of the pair (h, h+1)
const gD = new Float32Array(HW * HH);              // conductance of the pair (h, h+HW)
// per-cell relaxation rates (1/s): vR / sR from the wind and sky pass, gndR from the composition
const vR = new Float32Array(HW * HH);              // ventilation towards ambient
const sR = new Float32Array(HW * HH);              // sky cooling of exposed snow towards ambient-2
const gndR = new Float32Array(HW * HH);            // deep ground relaxing towards GROUND_T
const tn = new Float32Array(HW * HH);              // conduction scratch (interior cells of one sub-step)
const dirty = new Int32Array(HW * HH);             // heat cells whose conduction inputs changed (queue for applyDirty)
let nDirty = 0;

function compose(hx: number, hy: number) {
  const h = hy * HW + hx;
  let i0 = hy * HS * W + hx * HS;
  let sk = 0, sc = 0, ns = 0, nsn = 0, nw = 0, ng = 0, sd = 0;
  for (let j = 0; j < HS; j++, i0 += W) {
    for (let i = i0, e = i0 + HS; i < e; i++) {
      const m = mat[i];
      if (m === M.SNOW) { const d = dens[i] > 1023 ? 1023 : dens[i]; sk += SK[d]; sc += SC[d]; ns++; nsn++; sd += d; }
      else { sk += MK[m]; sc += MC[m]; ns += BLOCK[m]; nw += WATER_F[m]; ng += GND_F[m]; }
    }
  }
  const nk = sk / 16, nc = sc / 16;
  // conduction coefficients only follow a real change of the mean conductivity / capacity (queued for applyDirty)
  if (nk !== kk[h] || nc !== cap[h]) { kk[h] = nk; cap[h] = nc; dirty[nDirty++] = h; }
  nSol[h] = ns; nSnow[h] = nsn; nWat[h] = nw; nGnd[h] = ng; sDens[h] = nsn ? (sd / nsn) | 0 : 0;
  // deep ground relaxes towards GROUND_T (static geometry, so it is decided with the composition)
  gndR[h] = ng >= 8 && hy * HS + 2 > groundY[Math.min(W - 1, hx * HS + 2)] + GROUND_DEEP ? GROUND_RATE : 0;
}

/** conduction coefficients of one heat cell: its own 1/C, air flag, and the pairs it owns (right, down) and the pairs ending in it (left, up).
 *  Pairs with a neighbour that is also queued are recomputed when that neighbour is processed, so the final state is consistent. */
function coefCell(h: number) {
  const c = cap[h]; ic[h] = 1 / c; air[h] = c <= 2 ? 1 : 0;
  const hy = (h / HW) | 0, hx = h - hy * HW;
  if (hx < HW - 1) { const ki = kk[h], kj = kk[h + 1]; gR[h] = (ki * kj * 2 / (ki + kj)) * ((air[h] & air[h + 1]) ? GK_AIR : GK_SOLID); }
  if (hy < HH - 1) { const ki = kk[h], kj = kk[h + HW]; gD[h] = (ki * kj * 2 / (ki + kj)) * ((air[h] & air[h + HW]) ? GK_AIR : GK_SOLID); }
  if (hx > 0) { const ki = kk[h - 1], kj = kk[h]; gR[h - 1] = (ki * kj * 2 / (ki + kj)) * ((air[h - 1] & air[h]) ? GK_AIR : GK_SOLID); }
  if (hy > 0) { const ki = kk[h - HW], kj = kk[h]; gD[h - HW] = (ki * kj * 2 / (ki + kj)) * ((air[h - HW] & air[h]) ? GK_AIR : GK_SOLID); }
}
/** refresh the conduction coefficients of every queued cell, then empty the queue */
function applyDirty() {
  for (let q = 0; q < nDirty; q++) coefCell(dirty[q]);
  nDirty = 0;
}

function profileT(hx: number, hy: number): number {
  const h = hy * HW + hx, amb = G.ambientT;
  const cy = hy * HS + 2, d = cy - surf[Math.min(W - 1, hx * HS + 2)];
  if (nGnd[h] >= 8) return GROUND_T;
  if (nSol[h] < 8 && d <= 0) return amb;                       // open air above the surface
  const ts = DEEP_SNOW_T + (amb - DEEP_SNOW_T) * Math.exp(-Math.max(0, d) / SNOW_PROFILE_LEN);
  return nSol[h] < 8 ? Math.min(amb, ts + 2) : ts;            // cavities below the surface sit near the snow temperature
}

function scanSurf(x: number, hint: number, full = false) {
  let y = full ? 0 : Math.max(0, hint - 24);
  const m0 = mat[y * W + x]; if (m0 !== M.AIR && m0 !== M.NEEDLE) y = 0;
  for (; y < H; y++) { const m = mat[y * W + x]; if (m !== M.AIR && m !== M.NEEDLE) break; }
  surf[x] = y;
}

export function initHeat() {
  nDirty = 0;
  for (let x = 0; x < W; x++) scanSurf(x, 0);
  for (let hy = 0; hy < HH; hy++) for (let hx = 0; hx < HW; hx++) compose(hx, hy);
  for (let h = 0; h < HW * HH; h++) dirty[h] = h;   // every cell: start from exact coefficients
  nDirty = HW * HH; applyDirty();
  for (let hy = 0; hy < HH; hy++) for (let hx = 0; hx < HW; hx++) T[hy * HW + hx] = profileT(hx, hy);
  WND.fill(0); vR.fill(0); sR.fill(0); meltAcc.fill(0); prevValid = false;
}

// ---------------- window ----------------
let hx0 = 0, hx1 = 0, hy0 = 0, hy1 = 0, prevValid = false, tick = 0, dtAvg = 1 / 60, hAcc = 0;
const meltAcc = new Float32Array(HW * HH);

function updateWindow() {
  const w = G.win;
  const nx0 = Math.max(0, (w.x0 >> 2) - MARGIN), nx1 = Math.min(HW - 1, (w.x1 >> 2) + MARGIN);
  const ny0 = Math.max(0, (w.y0 >> 2) - MARGIN), ny1 = Math.min(HH - 1, (w.y1 >> 2) + MARGIN);
  if (prevValid && nx0 === hx0 && nx1 === hx1 && ny0 === hy0 && ny1 === hy1) return;
  const ox0 = hx0, ox1 = hx1, oy0 = hy0, oy1 = hy1, had = prevValid;
  hx0 = nx0; hx1 = nx1; hy0 = ny0; hy1 = ny1; prevValid = true;
  if (!had) return;
  // freshly entered cells: recompose and re-seed from the profile so stale remote heat does not pop in
  for (let x = hx0 * HS; x < (hx1 + 1) * HS; x++) if (x < ox0 * HS || x >= (ox1 + 1) * HS) scanSurf(x, surf[x]);
  for (let hy = hy0; hy <= hy1; hy++) for (let hx = hx0; hx <= hx1; hx++) {
    if (hx >= ox0 && hx <= ox1 && hy >= oy0 && hy <= oy1) continue;
    compose(hx, hy); T[hy * HW + hx] = profileT(hx, hy);
  }
}

// ---------------- wind + sky pass ----------------
const PROF = new Float32Array(512);
for (let k = 0; k < 512; k++) {
  const z = Math.max(0.05, k * 0.05);
  PROF[k] = Math.max(0, Math.min(1.2, Math.log(z / 0.001) / Math.log(10 / 0.001)));
}
function windPass() {
  const dir = G.wind >= 0 ? 1 : -1;
  const amp = 0.25 + 0.25 * G.storm, t = G.realTime;
  const gust = Math.max(0.2, 1 + (noise1(t * 0.25) * 2 - 1) * amp * 0.8 + (noise1(t * 1.3 + 50) * 2 - 1) * amp * 0.4);
  const wg = G.wind * gust;
  for (let hy = hy0; hy <= hy1; hy++) {
    let s = 0;
    const cy = hy * HS + 2, row = hy * HW;
    const xa = dir > 0 ? hx0 : hx1, xb = dir > 0 ? hx1 : hx0;
    for (let hx = xa; ; hx += dir) {
      const h = row + hx;
      if (nSol[h] >= 8) { s = 1; WND[h] = 0; }
      else {
        s *= WIND_DECAY;
        const k = surf[hx * HS + 2] - cy;
        WND[h] = wg * PROF[k <= 0 ? 0 : k > 511 ? 511 : k] * (1 - s);
      }
      if (hx === xb) break;
    }
  }
  // sky exposure (nothing blocking above in this column) and the per-cell relaxation rates the conduction uses
  for (let hx = hx0; hx <= hx1; hx++) {
    let open = 1;
    for (let hy = hy0; hy <= hy1; hy++) {
      const h = hy * HW + hx, ns = nSol[h];
      sky[h] = open;
      if (ns <= 4) {                                                // (mostly) air cells: ventilation
        const aw = Math.abs(WND[h]);
        vR[h] = open ? VENT_SKY + VENT_WIND * aw : VENT_LEAK + VENT_WIND * ROOF_WIND * aw;
        sR[h] = 0;
      } else {
        vR[h] = 0;
        sR[h] = ns < 16 && nSnow[h] >= 4 && hy > hy0 && sky[h - HW] ? SKY_COOL : 0;   // sky radiative cooling of the exposed surface
      }
      if (ns >= 8) open = 0;
    }
  }
}

// ---------------- melting / freezing / wetting (staggered rows) ----------------
function phase(hx: number, hy: number, dtRow: number) {
  const h = hy * HW + hx;
  const t = T[h];
  const base = hy * HS * W + hx * HS;
  if (t > 0 && nSnow[h] > 0) {
    const cost = MELT_E * Math.max(0.25, sDens[h] / 300);        // energy per cell
    let n = (cap[h] * t) / cost;                                  // all energy above 0 degC goes to melting
    n = Math.min(nSnow[h], 6, Math.floor(n + Math.random()));
    if (n > 0) {
      let done = 0; const r = (Math.random() * 16) | 0;
      for (let q = 0; q < 16 && done < n; q++) {                  // prefer snow cells touching air/water
        const o = (q + r) & 15, x = hx * HS + (o & 3), y = hy * HS + (o >> 2), i = y * W + x;
        if (mat[i] !== M.SNOW) continue;
        if (!exposed(x, y)) continue;
        set(x, y, M.WATER, dens[i], 0, 0); done++; // water keeps the snow's mass
      }
      T[h] = Math.max(-1, t - (done * cost) / cap[h]);
      if (done === 0) T[h] = t * 0.995;                           // buried snow: no air to drain into, stays wet
    }
  } else if (nWat[h] > 0 && t < FREEZE_T) {
    const n = Math.min(nWat[h], Math.round(nWat[h] * Math.min(1, FREEZE_RATE * dtRow) + Math.random() - 0.5));
    let done = 0;
    for (let q = 0; q < 16 && done < n; q++) {
      const i = base + (q >> 2) * W + (q & 3);
      if (mat[i] !== M.WATER) continue;
      set(hx * HS + (q & 3), hy * HS + (q >> 2), M.ICE, dens[i], 255, 0); done++; // ice keeps the water's mass
    }
    T[h] += (done * MELT_E * FREEZE_HEAT) / cap[h];
  }
  if (nWat[h] > 0) {                                              // wet snow beside water
    for (let q = 0; q < 16; q++) {
      const x = hx * HS + (q & 3), y = hy * HS + (q >> 2), i = y * W + x;
      if (mat[i] === M.SNOW && !(flags[i] & 2) && (nb(x + 1, y) === M.WATER || nb(x - 1, y) === M.WATER || nb(x, y + 1) === M.WATER || nb(x, y - 1) === M.WATER)) flags[i] |= 2;
    }
  }
}
const nb = (x: number, y: number) => (inb(x, y) ? mat[y * W + x] : M.ROCK);
const exposed = (x: number, y: number) => { let m = nb(x, y - 1); if (m === M.AIR || m === M.WATER) return true; m = nb(x + 1, y); if (m === M.AIR || m === M.WATER) return true; m = nb(x - 1, y); if (m === M.AIR || m === M.WATER) return true; m = nb(x, y + 1); return m === M.AIR || m === M.WATER; };

// ---------------- main step ----------------
export function stepHeat(dt: number) {
  const w = G.win;
  if (w.x1 <= w.x0 || w.y1 <= w.y0) return;
  dt = Math.min(dt, 0.25);
  // fast frames: integrate every HEAT_DT with the accumulated dt instead of every frame (same physics, a fraction of the CPU)
  hAcc += dt;
  if (hAcc < HEAT_DT && prevValid) return;
  dt = Math.min(hAcc, 0.25); hAcc = 0;
  tick++; dtAvg += (dt - dtAvg) * 0.2;
  updateWindow();
  const amb = G.ambientT;

  let pt = pnow();
  // staggered: surface scan (a quarter of the columns), composition (a quarter of the rows); changed cells update their conduction coefficients
  // every 16th visit of a column does a full rescan from the top (catches structures built >24 cells above the old surface)
  for (let x = (hx0 * HS) + (tick & 3); x < (hx1 + 1) * HS; x += 4) scanSurf(x, surf[x], (((tick >> 2) + (x >> 2)) & 15) === 0);
  const dtRow = Math.min(0.5, dtAvg * 4);
  for (let hy = hy0 + (tick & (COMP_STRIDE - 1)); hy <= hy1; hy += COMP_STRIDE) for (let hx = hx0; hx <= hx1; hx++) compose(hx, hy);
  applyDirty();
  pend('hCompose', pt); pt = pnow();
  if (tick % WIND_EVERY === 0) windPass();
  pend('hWind', pt); pt = pnow();
  for (let hy = hy0 + (tick & 3); hy <= hy1; hy += 4) for (let hx = hx0; hx <= hx1; hx++) {
    const h = hy * HW + hx;
    if ((nSnow[h] > 0 && T[h] > 0) || nWat[h] > 0) phase(hx, hy, dtRow);
  }
  pend('hPhase', pt); pt = pnow();

  // sources
  for (const f of G.fires) {
    if (!f.lit) continue;
    const fx = (f.x / HS) | 0, fy = ((f.y - 2) / HS) | 0;
    if (fx <= hx0 + 1 || fx >= hx1 - 1 || fy <= hy0 + 2 || fy >= hy1 - 1) continue;
    const q = f.power * SRC * dt;
    const add = (x: number, y: number, wgt: number) => { const h = y * HW + x; T[h] += q * wgt * ic[h]; };
    const fa = FIRE_AIR;
    add(fx, fy, 0.25 * fa); add(fx, fy - 1, 0.2 * fa); add(fx, fy - 2, 0.1 * fa); add(fx - 1, fy, 0.1 * fa); add(fx + 1, fy, 0.1 * fa);
    add(fx, fy + 1, 0.25 * FIRE_CONTACT);   // flame touching the ground/snow underneath (extra, non-conserved, so fires sink into powder)
  }
  {
    const p = G.player, px = (p.x / HS) | 0, py = ((p.y - p.h * 0.6) / HS) | 0;
    if (px > hx0 && px < hx1 && py > hy0 && py < hy1) { const h = py * HW + px; T[h] += p.heat * SRC * dt * ic[h]; }
  }

  // conduction + buoyancy + ventilation: explicit Jacobi sub-steps (fastest cell rate ~1.5 1/s, so sdt <= 0.1 s is stable)
  const n = Math.max(1, Math.min(4, Math.ceil(dt * 10)));
  const sdt = dt / n;
  const bb = Math.min(0.3, BUOY * sdt);                     // buoyancy transfer cap per sub-step
  const x0 = hx0 + 1, x1 = hx1 - 1, y0 = hy0 + 1, y1 = hy1 - 1;
  for (let s = 0; s < n; s++) {
    for (let hy = y0; hy <= y1; hy++) {
      for (let h = hy * HW + x0, e = hy * HW + x1; h <= e; h++) {
        const ti = T[h];
        // conduction: sum over the four neighbours of g * (T_nb - T) / C (gather form of the pairwise flux)
        const dc = gR[h] * (T[h + 1] - ti) + gR[h - 1] * (T[h - 1] - ti) + gD[h] * (T[h + HW] - ti) + gD[h - HW] * (T[h - HW] - ti);
        let t = ti + dc * sdt * ic[h];
        // buoyancy between air cells: warm air hands heat to the air cell above, receives from the one below
        if (air[h]) {
          const tu = T[h - HW], tb = T[h + HW];
          if (air[h - HW] && ti > tu) t -= bb * (ti - tu);
          if (air[h + HW] && tb > ti) t += bb * (tb - ti);
        }
        // ventilation of (mostly) air cells, sky cooling of exposed snow
        const v = vR[h];
        if (v > 0) t += (amb - t) * Math.min(0.5, v * sdt);
        else { const k = sR[h]; if (k > 0) t += (amb - 2 - t) * k * sdt; }
        const gn = gndR[h];
        if (gn > 0) t += (GROUND_T - t) * Math.min(0.5, gn * sdt);
        tn[h] = t < -80 ? -80 : t > 400 ? 400 : t;
      }
    }
    for (let hy = y0; hy <= y1; hy++) for (let h = hy * HW + x0, e = hy * HW + x1; h <= e; h++) T[h] = tn[h];
  }
  pend('hCond', pt);
  // boundary: open air at the window edge and the top rows is ambient
  for (let hx = hx0; hx <= hx1; hx++) for (let hy = hy0; hy <= hy0 + 1; hy++) { const h = hy * HW + hx; if (nSol[h] < 8) T[h] = amb; }
  for (let hy = hy0; hy <= hy1; hy++) { let h = hy * HW + hx0; if (nSol[h] < 8) T[h] = amb; h = hy * HW + hx1; if (nSol[h] < 8) T[h] = amb; }
}

// ---------------- queries (x, y in world cells) ----------------
function bil(a: Float32Array, x: number, y: number): number {
  const fx = Math.max(0, Math.min(HW - 1.001, x / HS - 0.5)), fy = Math.max(0, Math.min(HH - 1.001, y / HS - 0.5));
  const ix = fx | 0, iy = fy | 0, ux = fx - ix, uy = fy - iy, h = iy * HW + ix;
  return (a[h] * (1 - ux) + a[h + 1] * ux) * (1 - uy) + (a[h + HW] * (1 - ux) + a[h + HW + 1] * ux) * uy;
}
export function tempAt(x: number, y: number): number { return bil(T, x, y); }
export function windAt(x: number, y: number): number { return bil(WND, x, y); }

// 16 rays: 8 horizontal-ish/diagonal (weight 1), 8 upward fan (weight 1.5)
const RAY_DEG = [0, 180, 22, 158, 45, 135, -8, 188, 55, 65, 75, 85, 95, 105, 115, 125];
const RAY_DX = RAY_DEG.map(a => Math.cos(a * Math.PI / 180)), RAY_DY = RAY_DEG.map(a => -Math.sin(a * Math.PI / 180));
const RAY_W = RAY_DEG.map((_, i) => (i < 8 ? 1 : 1.5));
const RAY_WSUM = RAY_W.reduce((a, b) => a + b, 0);
export function shelterAt(x: number, y: number): number {
  let acc = 0;
  for (let r = 0; r < 16; r++) {
    const dx = RAY_DX[r], dy = RAY_DY[r];
    let px = x, py = y, needles = 0, b = 0;
    for (let s = 0; s < 60; s++) {
      px += dx; py += dy;
      const ix = px | 0, iy = py | 0;
      if (iy < 0) break;                                    // out through the top: open sky
      if (ix < 0 || ix >= W || iy >= H) break;
      const m = mat[iy * W + ix];
      if (BLOCK[m]) { b = 1; break; }
      if (m === M.NEEDLE) { needles += 0.3; if (needles >= 1) { b = 1; break; } }
    }
    acc += RAY_W[r] * Math.max(b, Math.min(1, needles));
  }
  return acc / RAY_WSUM;
}
