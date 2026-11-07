// Tile light map (SPEC §3). One light value per tile (4×4 cells) for the visible tiles + margin.
//  sky field  : scalar energy entering through open columns (G.daylight / moon / aurora), spread sideways, attenuated by LIGHT[]
//  point field: RGB energy from G.lights + glowing materials (fire, lava, crystal ...), flood-propagated with falloff
// The two are summed, tone-mapped per channel (shadows go blue) and written to lightR/G/B (display multipliers, may exceed 1).
// Render upsamples this bilinearly. Everything is typed arrays; no per-frame allocations once capacity is reached.
import { G } from '../game/state';
import { W, H, TW, TH, mat } from './grid';
import { LIGHT, GLOW_R, GLOW_G, GLOW_B, GLOW_RAD } from '../content/materials';
import { skyState } from './sky';

const STEP_AIR_SKY = 0.09;     // sky energy lost per tile when spreading through open air
const K_IN_SKY = 0.09;         // entering a solid tile costs STEP + opacity * K (gentle: surfaces glow, depth fades over ~30 cells)
const K_LEAVE_SKY = 1.1;       // leaving a solid tile into open air costs opacity * K (closed rooms stay dim; windows let light in)
const STEP_PT = 0.1;           // point light: energy lost per air tile  (source energy = rad * STEP_PT)
const K_IN_PT = 0.09;          // point light entering a translucent snow/ice tile (walls of an igloo glow instead of swallowing the light)
const K_IN_DENSE = 0.5;        // extra cost for opaque tiles (wood, stone, metal): opacity above 0.7 ramps up to this
const K_LEAVE_PT = 0.42;
const SCATTER = 2.0;          // subsurface glow gain of lit snow / ice walls (iconic amber igloo)
const DIAG = 1.4142;
const AIR_T = 0.3;             // tile opacity below this counts as open air
const SOLID_AMBIENT = 0.2;    // floor so rock silhouettes / strata / tunnel walls stay readable in the polar night (DESIGN: silhouettes >= ~3:1 vs the sky)
const INDOOR_MIN = 0.1, INDOOR_SKY = 0.4;   // dim blue fill of enclosed air (rooms, igloos, tunnels): a minimum + a share of the sky light (windows, roof gaps)
const RIM = 0.3;              // cool moon/aurora rim on solid edges that face open sky

/** Region of tiles currently covered by the light arrays. */
export const lt = { tx0: 0, ty0: 0, w: 0, h: 0 };
export let lightR = new Float32Array(0), lightG = new Float32Array(0), lightB = new Float32Array(0);   // display multipliers (physical light, no bloom)
export let glowR = new Float32Array(0), glowG = new Float32Array(0), glowB = new Float32Array(0);      // bloom (point lights only), additive
export let lightRGBA = new Uint8ClampedArray(0);   // lt.w × lt.h RGBA of the light multiplier (for the GPU upsample)
export let glowRGBA = new Uint8ClampedArray(0);
export const skyTint = { r: 1, g: 1, b: 1, e: 1 }; // current sky light colour/energy (for debugging & sprites)
/** 1 = open-air tile under a roof (inside an igloo / room / porch): the renderer paints a wall behind it instead of the sky. */
export let indoor = new Uint8Array(0);
const OPEN_T = 0.1;                 // tile opacity below this is open (air, glass, thin gas)
const ROOF_CELLS = 12;              // a tile with at least this many solid cells (of 16) counts as a roof

let cap = 0;
let roofT = new Uint8Array(0);
let opac = new Float32Array(0), cinSky = new Float32Array(0), lvSky = new Float32Array(0), cinPt = new Float32Array(0), lvPt = new Float32Array(0), airF = new Float32Array(0), skyE = new Float32Array(0);
let pR = new Float32Array(0), pG = new Float32Array(0), pB = new Float32Array(0);

function ensure(n: number) {
  if (n <= cap) return;
  cap = n + 256;
  opac = new Float32Array(cap); cinSky = new Float32Array(cap); lvSky = new Float32Array(cap); cinPt = new Float32Array(cap); lvPt = new Float32Array(cap); airF = new Float32Array(cap); skyE = new Float32Array(cap);
  pR = new Float32Array(cap); pG = new Float32Array(cap); pB = new Float32Array(cap);
  indoor = new Uint8Array(cap); roofT = new Uint8Array(cap);
  lightR = new Float32Array(cap); lightG = new Float32Array(cap); lightB = new Float32Array(cap);
  glowR = new Float32Array(cap); glowG = new Float32Array(cap); glowB = new Float32Array(cap);
  lightRGBA = new Uint8ClampedArray(cap * 4); glowRGBA = new Uint8ClampedArray(cap * 4);
}

function hash3(a: number, b: number, c: number) { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

// ---- sweeps -------------------------------------------------------------------------------------------------------
// cost of moving from tile j into tile i = cin[i] + (air[i] ? lv[j] : 0)   (diagonals ×1.414)
function sweep1(E: Float32Array, cin: Float32Array, lv: Float32Array, w: number, h: number, iters: number) {
  for (let it = 0; it < iters; it++) {
    for (let y = 0; y < h; y++) {
      let i = y * w;
      for (let x = 0; x < w; x++, i++) {
        const c = cin[i], a = airF[i]; let v = E[i], t: number;
        if (x > 0) { t = E[i - 1] - c - a * lv[i - 1]; if (t > v) v = t; }
        if (y > 0) {
          t = E[i - w] - c - a * lv[i - w]; if (t > v) v = t;
          if (x > 0) { t = E[i - w - 1] - (c + a * lv[i - w - 1]) * DIAG; if (t > v) v = t; }
          if (x < w - 1) { t = E[i - w + 1] - (c + a * lv[i - w + 1]) * DIAG; if (t > v) v = t; }
        }
        E[i] = v;
      }
    }
    for (let y = h - 1; y >= 0; y--) {
      let i = y * w + w - 1;
      for (let x = w - 1; x >= 0; x--, i--) {
        const c = cin[i], a = airF[i]; let v = E[i], t: number;
        if (x < w - 1) { t = E[i + 1] - c - a * lv[i + 1]; if (t > v) v = t; }
        if (y < h - 1) {
          t = E[i + w] - c - a * lv[i + w]; if (t > v) v = t;
          if (x > 0) { t = E[i + w - 1] - (c + a * lv[i + w - 1]) * DIAG; if (t > v) v = t; }
          if (x < w - 1) { t = E[i + w + 1] - (c + a * lv[i + w + 1]) * DIAG; if (t > v) v = t; }
        }
        E[i] = v;
      }
    }
  }
}

/** 3-channel sweep restricted to the box [bx0,bx1]×[by0,by1] (region-local tile coords, inclusive). */
function sweep3(R: Float32Array, Gc: Float32Array, B: Float32Array, cin: Float32Array, lv: Float32Array, w: number, bx0: number, by0: number, bx1: number, by1: number, iters: number) {
  for (let it = 0; it < iters; it++) {
    for (let y = by0; y <= by1; y++) {
      let i = y * w + bx0;
      for (let x = bx0; x <= bx1; x++, i++) {
        const ci = cin[i], a = airF[i];
        let r = R[i], g = Gc[i], b = B[i], t: number, j: number, c: number;
        if (x > bx0) { j = i - 1; c = ci + a * lv[j]; t = R[j] - c; if (t > r) r = t; t = Gc[j] - c; if (t > g) g = t; t = B[j] - c; if (t > b) b = t; }
        if (y > by0) {
          j = i - w; c = ci + a * lv[j]; t = R[j] - c; if (t > r) r = t; t = Gc[j] - c; if (t > g) g = t; t = B[j] - c; if (t > b) b = t;
          if (x > bx0) { j = i - w - 1; c = (ci + a * lv[j]) * DIAG; t = R[j] - c; if (t > r) r = t; t = Gc[j] - c; if (t > g) g = t; t = B[j] - c; if (t > b) b = t; }
          if (x < bx1) { j = i - w + 1; c = (ci + a * lv[j]) * DIAG; t = R[j] - c; if (t > r) r = t; t = Gc[j] - c; if (t > g) g = t; t = B[j] - c; if (t > b) b = t; }
        }
        R[i] = r; Gc[i] = g; B[i] = b;
      }
    }
    for (let y = by1; y >= by0; y--) {
      let i = y * w + bx1;
      for (let x = bx1; x >= bx0; x--, i--) {
        const ci = cin[i], a = airF[i];
        let r = R[i], g = Gc[i], b = B[i], t: number, j: number, c: number;
        if (x < bx1) { j = i + 1; c = ci + a * lv[j]; t = R[j] - c; if (t > r) r = t; t = Gc[j] - c; if (t > g) g = t; t = B[j] - c; if (t > b) b = t; }
        if (y < by1) {
          j = i + w; c = ci + a * lv[j]; t = R[j] - c; if (t > r) r = t; t = Gc[j] - c; if (t > g) g = t; t = B[j] - c; if (t > b) b = t;
          if (x > bx0) { j = i + w - 1; c = (ci + a * lv[j]) * DIAG; t = R[j] - c; if (t > r) r = t; t = Gc[j] - c; if (t > g) g = t; t = B[j] - c; if (t > b) b = t; }
          if (x < bx1) { j = i + w + 1; c = (ci + a * lv[j]) * DIAG; t = R[j] - c; if (t > r) r = t; t = Gc[j] - c; if (t > g) g = t; t = B[j] - c; if (t > b) b = t; }
        }
        R[i] = r; Gc[i] = g; B[i] = b;
      }
    }
  }
}

// ---- sky colour/energy: twilight band (cool -> pink-orange with the day number), moon (silver), aurora (green), stars ----
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function updateSky() {
  const sk = skyState;
  const L = sk.light, w = sk.warm, night = sk.night, storm = sk.storm;
  const eT = 0.04 + 0.9 * Math.pow(L, 1.35);
  const tr = lerp(0.5, 1.0, w), tg = lerp(0.72, 0.7, w), tb = lerp(1.0, 0.55, w);
  const moonE = sk.moon * 0.46 * (1 - 0.55 * L), aurE = sk.aurora * night * 0.14 * (1 - storm), starE = 0.04 * night;
  let r = eT * tr + moonE * 0.8 + aurE * 0.22 + starE * 0.4;
  let g = eT * tg + moonE * 0.9 + aurE * 1.0 + starE * 0.58;
  let b = eT * tb + moonE * 1.0 + aurE * 0.5 + starE * 1.0;
  const k = 1 - 0.4 * storm;                       // storm: less light, greyer
  r *= k; g *= k; b *= k;
  if (storm > 0) { const m = (r + g + b) / 3; r = lerp(r, m * 1.05, storm * 0.45); g = lerp(g, m * 1.05, storm * 0.45); b = lerp(b, m * 1.08, storm * 0.3); }
  const e = Math.max(r, g, b, 1e-4);
  skyTint.r = r / e; skyTint.g = g / e; skyTint.b = b / e; skyTint.e = e;
}

// tone curve per channel: shadows pick up blue
const KR = 1.45, KG = 1.62, KB = 2.0;
const NR = 1 / (1 - Math.exp(-KR)), NG = 1 / (1 - Math.exp(-KG)), NB = 1 / (1 - Math.exp(-KB));


/** Compute the light map for the view (cells: x0,y0,w,h of the canvas) + margin. Call once per frame before drawing. */
export function computeLight(v: { x0: number; y0: number; w: number; h: number }, time: number) {
  const vx0 = v.x0, vy0 = v.y0, vw = v.w, vh = v.h;
  updateSky();
  const q = G.quality;
  const M = q === 0 ? 6 : q === 1 ? 8 : 11;
  // constant region size (shifted, not clipped, at the world edges) so the GPU canvases are never recreated while panning
  const w = Math.min(TW, Math.ceil(vw / 4) + 3 + 2 * M), h = Math.min(TH, Math.ceil(vh / 4) + 3 + 2 * M), n = w * h;
  const tx0 = Math.max(0, Math.min(TW - w, (vx0 >> 2) - M)), ty0 = Math.max(0, Math.min(TH - h, (vy0 >> 2) - M));
  // low/mid quality: the light map only needs refreshing at 30 Hz while the covered region is unchanged
  if (q <= 1 && (G.frame & 1) === 1 && lt.w === w && lt.h === h && lt.tx0 === tx0 && lt.ty0 === ty0 && cap >= n) return;
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
      let o = 0, gr = 0, gg = 0, gb = 0, sc = 0;
      for (let dy = 0; dy < 4; dy++) {
        let ci = (cy0 + dy) * W + cx0;
        for (let dx = 0; dx < 4; dx++, ci++) {
          const m = mat[ci];
          const lm = LIGHT[m]; o += lm; if (lm > 0.3) sc++;
          const rad = GLOW_RAD[m];
          if (rad > 0) { gr += GLOW_R[m] * rad; gg += GLOW_G[m] * rad; gb += GLOW_B[m] * rad; }
        }
      }
      o *= 0.0625;
      opac[i] = o; roofT[i] = sc >= ROOF_CELLS ? 1 : 0;
      const isAir = o < AIR_T;
      airF[i] = isAir ? 1 : 0;
      cinSky[i] = isAir ? STEP_AIR_SKY : 0.05 + o * K_IN_SKY;
      lvSky[i] = o * K_LEAVE_SKY;
      cinPt[i] = isAir ? STEP_PT : STEP_PT + o * K_IN_PT + Math.max(0, o - 0.7) * (K_IN_DENSE / 0.3);
      lvPt[i] = o * K_LEAVE_PT;
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
    sweep3(pR, pG, pB, cinPt, lvPt, w, bx0, by0, bx1, by1, q === 0 ? 1 : 2);
    for (let i = by0 * w; i < (by1 + 1) * w; i++) if (airF[i] === 0 && opac[i] < 0.8) { pR[i] *= SCATTER; pG[i] *= SCATTER * 1.18; pB[i] *= SCATTER * 1.35; }
  }

  // 3. sky seeds: walk each column from the world top; light enters through transparent tiles
  const skyOn = skyTint.e > 0.001;
  if (skyOn) {
    for (let tx = 0; tx < w; tx++) {
      const wx = (tx0 + tx) * 4 + 2;
      let E = 1, prev = 0, roofed = false;
      // above the region: coarse (single sample per tile)
      for (let ty = 0; ty < ty0 && (E > 0.01 || !roofed); ty++) {
        const o = LIGHT[mat[(ty * 4 + 2) * W + wx]];
        if (o > 0.3) roofed = true;
        if (o < AIR_T) { if (prev >= AIR_T) E -= prev * K_LEAVE_SKY; } else E -= 0.05 + o * K_IN_SKY;
        prev = o;
      }
      if (E < 0) E = 0;
      for (let ty = 0; ty < h; ty++) {
        const i = ty * w + tx, o = opac[i];
        if (roofT[i]) roofed = true;
        indoor[i] = roofed && o < OPEN_T ? 1 : 0;
        if (E > 0.001) {
          if (o < AIR_T) { if (prev >= AIR_T) E -= prev * K_LEAVE_SKY; } else E -= 0.05 + o * K_IN_SKY;
          if (E < 0) E = 0;
        }
        prev = o;
        skyE[i] = E;
      }
    }
    sweep1(skyE, cinSky, lvSky, w, h, q === 0 ? 1 : 2);
  } else { skyE.fill(0, 0, n); indoor.fill(0, 0, n); }

  // 4. compose + tone map
  const se = skyTint.e, sr = skyTint.r * se, sg = skyTint.g * se, sb = skyTint.b * se;
  const bloom = q === 0 ? 0 : 0.3;
  const AMBIENT = 0.07 + 0.05 * skyState.light;
  const solidAmb = SOLID_AMBIENT * (0.6 + 0.4 * skyState.light);
  const rimE = skyOn ? RIM + 0.5 * Math.min(1, se) : 0;
  const finR = 0.62 * rimE, finG = 0.8 * rimE, finB = 1.0 * rimE;
  const inE = INDOOR_MIN + INDOOR_SKY * Math.min(1, se);
  for (let i = 0; i < n; i++) {
    const s = skyE[i];
    const er = Math.max(0, s * sr + pR[i]), eg = Math.max(0, s * sg + pG[i]), eb = Math.max(0, s * sb + pB[i]);
    const mr = (1 - Math.exp(-KR * er)) * NR, mg = (1 - Math.exp(-KG * eg)) * NG, mb = (1 - Math.exp(-KB * eb)) * NB;
    const solid = opac[i] > 0.5;
    const sa = solid ? solidAmb : 0;
    let lr = mr + AMBIENT + sa * 0.8, lg = mg + AMBIENT * 1.2 + sa * 0.9, lb = mb + AMBIENT * 1.8 + sa * 1.2;
    if (indoor[i]) { const f = inE * (skyOn ? 1 : 0.7); lr += f * (0.5 + 0.3 * skyTint.r); lg += f * (0.66 + 0.2 * skyTint.g); lb += f * (0.92 + 0.1 * skyTint.b); }
    else if (solid && skyOn) {
      // rim light: a solid tile whose upper / side neighbour is open sky
      const x = i % w, y = (i / w) | 0;
      let k = 0;
      if (y > 0 && airF[i - w] === 1 && skyE[i - w] > 0.3) k = 1;
      else if ((x > 0 && airF[i - 1] === 1 && skyE[i - 1] > 0.3) || (x < w - 1 && airF[i + 1] === 1 && skyE[i + 1] > 0.3)) k = 0.6;
      if (k > 0) { lr += finR * k; lg += finG * k; lb += finB * k; }
    }
    lightR[i] = lr; lightG[i] = lg; lightB[i] = lb;
    const j = i * 4;
    lightRGBA[j] = lr * 255; lightRGBA[j + 1] = lg * 255; lightRGBA[j + 2] = lb * 255; lightRGBA[j + 3] = 255;
    // bloom: only point lights, squared so it hugs the sources
    const br = pR[i], bg = pG[i], bb = pB[i];
    const gr = Math.min(0.32, br * br * bloom), gg = Math.min(0.32, bg * bg * bloom), gb = Math.min(0.32, bb * bb * bloom);
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
