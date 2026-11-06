// Tile light map (SPEC §3). One light value per tile (4×4 cells) for the visible tiles + margin.
//  sky field  : scalar energy entering through open columns (G.daylight / moon / aurora), spread sideways, attenuated by LIGHT[]
//  point field: RGB energy from G.lights + glowing materials (fire, lava, crystal ...), flood-propagated with falloff
// The two are summed, tone-mapped per channel (shadows go blue) and written to lightR/G/B (display multipliers, may exceed 1).
// Render upsamples this bilinearly. Everything is typed arrays; no per-frame allocations once capacity is reached.
import { G } from '../game/state';
import { W, H, TW, TH, mat } from './grid';
import { LIGHT, GLOW_R, GLOW_G, GLOW_B, GLOW_RAD } from '../content/materials';

const STEP_AIR_SKY = 0.09;     // sky energy lost per tile of open air when spreading sideways
const K_OP_SKY = 0.30;         // extra loss per tile = opacity * K_OP_SKY (sideways spread)
const K_OP_SEED = 0.30;        // loss per tile when sky light travels DOWN through material
const STEP_PT = 0.1;           // point light: energy lost per air tile  (source energy = rad * STEP_PT)
const K_OP_PT = 0.62;
const DIAG = 1.4142;

/** Region of tiles currently covered by the light arrays. */
export const lt = { tx0: 0, ty0: 0, w: 0, h: 0 };
export let lightR = new Float32Array(0), lightG = new Float32Array(0), lightB = new Float32Array(0);   // display multipliers (physical light, no bloom)
export let glowR = new Float32Array(0), glowG = new Float32Array(0), glowB = new Float32Array(0);      // bloom (point lights only), additive
export let lightRGBA = new Uint8ClampedArray(0);   // lt.w × lt.h RGBA of the light multiplier (for the GPU upsample)
export let glowRGBA = new Uint8ClampedArray(0);
export const skyTint = { r: 1, g: 1, b: 1, e: 1 }; // current sky light colour/energy (for debugging & sprites)

let cap = 0;
let opac = new Float32Array(0), costSky = new Float32Array(0), costPt = new Float32Array(0), skyE = new Float32Array(0);
let pR = new Float32Array(0), pG = new Float32Array(0), pB = new Float32Array(0);

function ensure(n: number) {
  if (n <= cap) return;
  cap = n + 256;
  opac = new Float32Array(cap); costSky = new Float32Array(cap); costPt = new Float32Array(cap); skyE = new Float32Array(cap);
  pR = new Float32Array(cap); pG = new Float32Array(cap); pB = new Float32Array(cap);
  lightR = new Float32Array(cap); lightG = new Float32Array(cap); lightB = new Float32Array(cap);
  glowR = new Float32Array(cap); glowG = new Float32Array(cap); glowB = new Float32Array(cap);
  lightRGBA = new Uint8ClampedArray(cap * 4); glowRGBA = new Uint8ClampedArray(cap * 4);
}

function hash3(a: number, b: number, c: number) { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

// ---- sweeps -------------------------------------------------------------------------------------------------------
function sweep1(E: Float32Array, cost: Float32Array, w: number, h: number, iters: number) {
  for (let it = 0; it < iters; it++) {
    for (let y = 0; y < h; y++) {
      let i = y * w;
      for (let x = 0; x < w; x++, i++) {
        const c = cost[i]; let v = E[i], t: number;
        if (x > 0) { t = E[i - 1] - c; if (t > v) v = t; }
        if (y > 0) {
          t = E[i - w] - c; if (t > v) v = t;
          const cd = c * DIAG;
          if (x > 0) { t = E[i - w - 1] - cd; if (t > v) v = t; }
          if (x < w - 1) { t = E[i - w + 1] - cd; if (t > v) v = t; }
        }
        E[i] = v;
      }
    }
    for (let y = h - 1; y >= 0; y--) {
      let i = y * w + w - 1;
      for (let x = w - 1; x >= 0; x--, i--) {
        const c = cost[i]; let v = E[i], t: number;
        if (x < w - 1) { t = E[i + 1] - c; if (t > v) v = t; }
        if (y < h - 1) {
          t = E[i + w] - c; if (t > v) v = t;
          const cd = c * DIAG;
          if (x > 0) { t = E[i + w - 1] - cd; if (t > v) v = t; }
          if (x < w - 1) { t = E[i + w + 1] - cd; if (t > v) v = t; }
        }
        E[i] = v;
      }
    }
  }
}

/** 3-channel sweep restricted to the box [bx0,bx1]×[by0,by1] (region-local tile coords, inclusive). */
function sweep3(R: Float32Array, Gc: Float32Array, B: Float32Array, cost: Float32Array, w: number, bx0: number, by0: number, bx1: number, by1: number, iters: number) {
  for (let it = 0; it < iters; it++) {
    for (let y = by0; y <= by1; y++) {
      let i = y * w + bx0;
      for (let x = bx0; x <= bx1; x++, i++) {
        const c = cost[i], cd = c * DIAG;
        let r = R[i], g = Gc[i], b = B[i], t: number;
        if (x > bx0) { const j = i - 1; t = R[j] - c; if (t > r) r = t; t = Gc[j] - c; if (t > g) g = t; t = B[j] - c; if (t > b) b = t; }
        if (y > by0) {
          let j = i - w; t = R[j] - c; if (t > r) r = t; t = Gc[j] - c; if (t > g) g = t; t = B[j] - c; if (t > b) b = t;
          if (x > bx0) { j = i - w - 1; t = R[j] - cd; if (t > r) r = t; t = Gc[j] - cd; if (t > g) g = t; t = B[j] - cd; if (t > b) b = t; }
          if (x < bx1) { j = i - w + 1; t = R[j] - cd; if (t > r) r = t; t = Gc[j] - cd; if (t > g) g = t; t = B[j] - cd; if (t > b) b = t; }
        }
        R[i] = r; Gc[i] = g; B[i] = b;
      }
    }
    for (let y = by1; y >= by0; y--) {
      let i = y * w + bx1;
      for (let x = bx1; x >= bx0; x--, i--) {
        const c = cost[i], cd = c * DIAG;
        let r = R[i], g = Gc[i], b = B[i], t: number;
        if (x < bx1) { const j = i + 1; t = R[j] - c; if (t > r) r = t; t = Gc[j] - c; if (t > g) g = t; t = B[j] - c; if (t > b) b = t; }
        if (y < by1) {
          let j = i + w; t = R[j] - c; if (t > r) r = t; t = Gc[j] - c; if (t > g) g = t; t = B[j] - c; if (t > b) b = t;
          if (x > bx0) { j = i + w - 1; t = R[j] - cd; if (t > r) r = t; t = Gc[j] - cd; if (t > g) g = t; t = B[j] - cd; if (t > b) b = t; }
          if (x < bx1) { j = i + w + 1; t = R[j] - cd; if (t > r) r = t; t = Gc[j] - cd; if (t > g) g = t; t = B[j] - cd; if (t > b) b = t; }
        }
        R[i] = r; Gc[i] = g; B[i] = b;
      }
    }
  }
}

// ---- sky colour/energy from the clock ---------------------------------------------------------------------------------
const bell = (h: number, c: number, w: number) => { const d = (h - c) / w; return Math.exp(-d * d); };
function updateSky() {
  const hour = ((G.time % 1440) + 1440) % 1440 / 60;
  const day = Math.max(0, Math.min(1, G.daylight));
  const warm = Math.min(1, bell(hour, 7.6, 0.8) + bell(hour, 18.4, 0.8)) * Math.min(1, 0.35 + day);
  const aur = G.aurora * (1 - day);
  const moon = G.moon;
  const night = 1 - day;
  // energy
  let e = day * 1.0 + night * (0.13 + 0.16 * moon + 0.07 * aur);
  e *= 1 - 0.4 * G.storm;
  // tint: night is deep blue, aurora adds green, twilight is orange
  let r = day + night * 0.42, g = day + night * 0.64, b = day + night * 1.0;
  r += -0.1 * aur; g += 0.3 * aur; b += 0.12 * aur;
  r += (1.0 - r) * warm * 0.9; g += (0.66 - g) * warm; b += (0.46 - b) * warm;
  skyTint.r = r; skyTint.g = g; skyTint.b = b; skyTint.e = e;
}

// tone curve per channel: shadows pick up blue
const KR = 1.45, KG = 1.62, KB = 2.0;
const NR = 1 / (1 - Math.exp(-KR)), NG = 1 / (1 - Math.exp(-KG)), NB = 1 / (1 - Math.exp(-KB));
const AMBIENT = 0.012;

/** Compute the light map for the view (cells: x0,y0,w,h of the canvas) + margin. Call once per frame before drawing. */
export function computeLight(vx0: number, vy0: number, vw: number, vh: number, time: number) {
  updateSky();
  const q = G.quality;
  const M = q === 0 ? 6 : q === 1 ? 8 : 11;
  const tx0 = Math.max(0, (vx0 >> 2) - M), ty0 = Math.max(0, (vy0 >> 2) - M);
  const tx1 = Math.min(TW, ((vx0 + vw) >> 2) + 1 + M), ty1 = Math.min(TH, ((vy0 + vh) >> 2) + 1 + M);
  const w = Math.max(1, tx1 - tx0), h = Math.max(1, ty1 - ty0), n = w * h;
  ensure(n);
  lt.tx0 = tx0; lt.ty0 = ty0; lt.w = w; lt.h = h;

  // 1. tile opacity + glow sources (16 cells per tile)
  let sMinX = 1e9, sMinY = 1e9, sMaxX = -1, sMaxY = -1, nSrc = 0;
  pR.fill(0, 0, n); pG.fill(0, 0, n); pB.fill(0, 0, n);
  const flick = 0.9 + 0.1 * Math.sin(time * 11);
  for (let ty = 0; ty < h; ty++) {
    const cy0 = (ty0 + ty) * 4;
    for (let tx = 0; tx < w; tx++) {
      const cx0 = (tx0 + tx) * 4, i = ty * w + tx;
      let o = 0, gr = 0, gg = 0, gb = 0;
      for (let dy = 0; dy < 4; dy++) {
        let ci = (cy0 + dy) * W + cx0;
        for (let dx = 0; dx < 4; dx++, ci++) {
          const m = mat[ci];
          o += LIGHT[m];
          const rad = GLOW_RAD[m];
          if (rad > 0) { gr += GLOW_R[m] * rad; gg += GLOW_G[m] * rad; gb += GLOW_B[m] * rad; }
        }
      }
      o *= 0.0625;
      opac[i] = o;
      costSky[i] = STEP_AIR_SKY + o * K_OP_SKY;
      costPt[i] = STEP_PT + o * K_OP_PT;
      if (gr + gg + gb > 0) {
        const f = STEP_PT * 0.0625 * 2.4 * (0.85 + 0.15 * hash3(tx0 + tx, ty0 + ty, (time * 9) | 0)) * flick;
        pR[i] = gr * f; pG[i] = gg * f; pB[i] = gb * f;
        nSrc++;
        if (tx < sMinX) sMinX = tx; if (tx > sMaxX) sMaxX = tx; if (ty < sMinY) sMinY = ty; if (ty > sMaxY) sMaxY = ty;
      }
    }
  }
  // 2. dynamic point lights
  const L = G.lights;
  for (let k = 0; k < L.length; k++) {
    const l = L[k];
    const tx = ((l.x / 4) | 0) - tx0, ty = ((l.y / 4) | 0) - ty0;
    const R = l.rad;
    if (tx < -R || ty < -R || tx >= w + R || ty >= h + R) continue;
    const cx = Math.max(0, Math.min(w - 1, tx)), cy = Math.max(0, Math.min(h - 1, ty));
    const i = cy * w + cx, e = R * STEP_PT * (tx === cx && ty === cy ? 1 : 0.7);
    if (l.r * e > pR[i]) pR[i] = l.r * e;
    if (l.g * e > pG[i]) pG[i] = l.g * e;
    if (l.b * e > pB[i]) pB[i] = l.b * e;
    nSrc++;
    const x0 = Math.floor(cx - R), x1 = Math.ceil(cx + R), y0 = Math.floor(cy - R), y1 = Math.ceil(cy + R);
    if (x0 < sMinX) sMinX = x0; if (x1 > sMaxX) sMaxX = x1; if (y0 < sMinY) sMinY = y0; if (y1 > sMaxY) sMaxY = y1;
  }
  // grow the box by the longest glow radius so propagation has room
  if (nSrc > 0) {
    const g = 12;
    const bx0 = Math.max(0, sMinX - g), by0 = Math.max(0, sMinY - g), bx1 = Math.min(w - 1, sMaxX + g), by1 = Math.min(h - 1, sMaxY + g);
    sweep3(pR, pG, pB, costPt, w, bx0, by0, bx1, by1, q === 0 ? 1 : 2);
  }

  // 3. sky seeds: walk each column from the world top; light enters through transparent tiles
  const skyOn = skyTint.e > 0.001;
  if (skyOn) {
    for (let tx = 0; tx < w; tx++) {
      const wx = (tx0 + tx) * 4 + 2;
      let E = 1;
      // above the region: coarse (single sample per tile)
      for (let ty = 0; ty < ty0 && E > 0.01; ty++) {
        const o = LIGHT[mat[(ty * 4 + 2) * W + wx]];
        if (o > 0) E -= o * K_OP_SEED;
      }
      for (let ty = 0; ty < h; ty++) {
        const i = ty * w + tx;
        if (E > 0.001) { E -= opac[i] * K_OP_SEED; if (E < 0) E = 0; }
        skyE[i] = E;
      }
    }
    sweep1(skyE, costSky, w, h, q === 0 ? 1 : 2);
  } else skyE.fill(0, 0, n);

  // 4. compose + tone map
  const se = skyTint.e, sr = skyTint.r * se, sg = skyTint.g * se, sb = skyTint.b * se;
  const bloom = q === 0 ? 0 : 0.5;
  for (let i = 0; i < n; i++) {
    const s = skyE[i];
    const er = s * sr + pR[i], eg = s * sg + pG[i], eb = s * sb + pB[i];
    const mr = (1 - Math.exp(-KR * er)) * NR, mg = (1 - Math.exp(-KG * eg)) * NG, mb = (1 - Math.exp(-KB * eb)) * NB;
    const lr = mr + AMBIENT, lg = mg + AMBIENT * 1.2, lb = mb + AMBIENT * 1.8;
    lightR[i] = lr; lightG[i] = lg; lightB[i] = lb;
    const j = i * 4;
    lightRGBA[j] = lr * 255; lightRGBA[j + 1] = lg * 255; lightRGBA[j + 2] = lb * 255; lightRGBA[j + 3] = 255;
    // bloom: only point lights, squared so it hugs the sources
    const br = pR[i], bg = pG[i], bb = pB[i];
    const gr = br * br * bloom, gg = bg * bg * bloom, gb = bb * bb * bloom;
    glowR[i] = gr; glowG[i] = gg; glowB[i] = gb;
    glowRGBA[j] = gr * 255; glowRGBA[j + 1] = gg * 255; glowRGBA[j + 2] = gb * 255; glowRGBA[j + 3] = 255;
  }
}

const tmp: [number, number, number] = [0, 0, 0];
/** Light multiplier at a world cell (shared array — copy if you keep it). Outside the computed region returns the nearest tile. */
export function lightAt(x: number, y: number): [number, number, number] {
  if (lt.w === 0) { tmp[0] = tmp[1] = tmp[2] = 1; return tmp; }
  let tx = (x >> 2) - lt.tx0, ty = (y >> 2) - lt.ty0;
  if (tx < 0) tx = 0; else if (tx >= lt.w) tx = lt.w - 1;
  if (ty < 0) ty = 0; else if (ty >= lt.h) ty = lt.h - 1;
  const i = ty * lt.w + tx;
  tmp[0] = lightR[i]; tmp[1] = lightG[i]; tmp[2] = lightB[i];
  return tmp;
}
/** Overall brightness 0..1.25 at a world cell (for gameplay: stealth, spawn rules, "too dark" hints). */
export function brightnessAt(x: number, y: number) { const l = lightAt(x, y); return (l[0] + l[1] + l[2]) / 3; }
