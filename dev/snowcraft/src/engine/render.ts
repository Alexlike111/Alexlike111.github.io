// World renderer (SPEC §3). One low-res canvas, 1 canvas pixel = 1 cell, CSS-upscaled by an integer factor (pixelated) with the
// sub-cell camera offset applied as a CSS transform. Pipeline per frame:
//   sky (canvas ops) -> terrain pass (CPU, per cell: texture × shade × edge shading × bilinear tile light) -> lit sprite layers (z<0, masked
//   multiply by the light map) -> emissive layers (0<=z<100, 'lighter') -> bloom -> weather -> top layers (z>=100) -> vignette.
import { G, View, DrawFn } from '../game/state';
import { W, H, TW, mat, shade, bg, aux } from './grid';
import { MATS, PHASE, P_SOLID, P_POWDER, P_LIQUID, P_GAS, P_FIRE, P_EMPTY, MAT } from '../content/materials';
import { initTextures, TEX, BGTEX } from './tex';
import { drawSky } from './sky';
import { computeLight, lt, lightR, lightG, lightB, lightRGBA, glowRGBA } from './light';
import { clampCamera } from './camera';

// ---------------------------------------------------------------------------------------------------------------------
// per-material render tables
const NM = MATS.length;
const MODE = new Uint8Array(256);       // 0 empty, 1 solid/powder, 2 liquid, 3 gas, 4 emissive (fire/lava/ember), 5 fixture (shows background)
const OPEN = new Uint8Array(256);       // 1 = neighbour counts as "air" for edge shading
const TOPB = new Int16Array(256);       // top rim brightness boost (256 = +100%)
const SPARK = new Uint8Array(256);      // surface sparkles
const TRANS = new Uint8Array(256);      // 0..255 blend toward the background wall behind it
const VARMUL = new Int16Array(256 * 256);
const TEXM: Uint32Array[] = [];

function initTables() {
  for (let m = 0; m < NM; m++) {
    const d = MATS[m], ph = PHASE[m];
    MODE[m] = ph === P_EMPTY ? 0 : ph === P_SOLID || ph === P_POWDER ? 1 : ph === P_LIQUID ? 2 : ph === P_GAS ? 3 : 4;
    if (d.key === 'LAVA' || d.key === 'EMBER') MODE[m] = 4;
    if (d.key === 'FIXTURE') MODE[m] = 5;
    OPEN[m] = ph === P_EMPTY || ph === P_GAS || ph === P_FIRE || ph === P_LIQUID || d.key === 'FIXTURE' ? 1 : 0;
    TOPB[m] = 20;
    if (d.key === 'SNOW' || d.key === 'PACKED' || d.key === 'SNOWBLOCK') { TOPB[m] = 46; SPARK[m] = 1; }
    else if (d.key === 'ICE') { TOPB[m] = 38; SPARK[m] = 1; TRANS[m] = 70; }
    else if (d.key === 'GLASS') { TOPB[m] = 30; SPARK[m] = 1; TRANS[m] = 110; }
    else if (d.key === 'CRYSTAL') { TOPB[m] = 30; SPARK[m] = 1; }
    else if (d.key === 'METAL') TOPB[m] = 30;
    else if (d.key === 'NEEDLES') TOPB[m] = 26;
    else if (d.key === 'WOOD' || d.key === 'LOG' || d.key === 'PLANK') TOPB[m] = 16;
    for (let s = 0; s < 256; s++) VARMUL[m * 256 + s] = Math.round(256 + (s / 255 - 0.5) * 2 * d.vary * 256 * 0.9);
  }
}

// palettes for emissive materials (packed ABGR, 64 entries)
function pal(stops: [number, number, number, number][]) {
  const out = new Uint32Array(64);
  for (let i = 0; i < 64; i++) {
    const p = i / 63; let k = 0; while (k < stops.length - 2 && p > stops[k + 1][0]) k++;
    const a = stops[k], b = stops[k + 1], t = Math.max(0, Math.min(1, (p - a[0]) / (b[0] - a[0])));
    const r = a[1] + (b[1] - a[1]) * t, g = a[2] + (b[2] - a[2]) * t, bl = a[3] + (b[3] - a[3]) * t;
    out[i] = 0xff000000 | ((bl | 0) << 16) | ((g | 0) << 8) | (r | 0);
  }
  return out;
}
const FIREPAL = pal([[0, 120, 30, 16], [0.22, 214, 56, 18], [0.45, 255, 120, 28], [0.7, 255, 190, 70], [1, 255, 244, 190]]);
const LAVAPAL = pal([[0, 58, 12, 10], [0.3, 150, 30, 10], [0.55, 232, 84, 16], [0.8, 255, 158, 40], [1, 255, 224, 110]]);
const EMBERPAL = pal([[0, 70, 20, 14], [0.5, 190, 66, 22], [1, 255, 160, 60]]);

// ---------------------------------------------------------------------------------------------------------------------
// canvases & state
let cv: HTMLCanvasElement, ctx: CanvasRenderingContext2D;
let tc: HTMLCanvasElement, tctx: CanvasRenderingContext2D, timg: ImageData, t32: Uint32Array;     // terrain buffer
let sc: HTMLCanvasElement, sctx: CanvasRenderingContext2D;                                          // lit sprite layer
let lm: HTMLCanvasElement, lmctx: CanvasRenderingContext2D;                                          // light mask
let lightC: HTMLCanvasElement | null = null, lightCtx: CanvasRenderingContext2D, lightImg: ImageData | null = null;
let glowC: HTMLCanvasElement | null = null, glowCtx: CanvasRenderingContext2D, glowImg: ImageData | null = null;
let vig: HTMLCanvasElement | null = null;
let lastLightW = 0, lastLightH = 0;
let cw = 0, ch = 0, dpr = 1, scale = 3;
let tAcc = 0;
export const view: View = { x0: 0, y0: 0, w: 0, h: 0, scale: 3, t: 0 };
let subX = 0, subY = 0, camLeft = 0, camTop = 0;   // exact (float) top-left of the screen in cells
export const perf = { total: 0, sky: 0, light: 0, terrain: 0, layers: 0, frames: 0 };

interface Layer { z: number; fn: DrawFn }
const layers: Layer[] = [];
/** Register a draw layer. z<0 lit world space, 0..99 emissive (lighter), >=100 top. Returns a remover. */
export function addLayer(z: number, fn: DrawFn): () => void {
  const l = { z, fn }; layers.push(l); layers.sort((a, b) => a.z - b.z);
  return () => { const i = layers.indexOf(l); if (i >= 0) layers.splice(i, 1); };
}

export function initRender(canvas: HTMLCanvasElement) {
  initTextures(); initTables();
  for (let m = 0; m < NM; m++) TEXM.push(TEX[m]);
  cv = canvas; ctx = cv.getContext('2d', { alpha: false })!;
  const st = cv.style;
  st.position = 'absolute'; st.left = '0'; st.top = '0'; st.imageRendering = 'pixelated'; st.transformOrigin = '0 0'; st.willChange = 'transform'; st.display = 'block';
  const parent = cv.parentElement;
  if (parent) { const ps = parent.style; ps.position = 'fixed'; ps.left = ps.top = ps.right = ps.bottom = '0'; ps.overflow = 'hidden'; ps.background = '#05080f'; }
  tc = document.createElement('canvas'); sc = document.createElement('canvas'); lm = document.createElement('canvas');
  tctx = tc.getContext('2d')!; sctx = sc.getContext('2d')!; lmctx = lm.getContext('2d')!;
  window.addEventListener('resize', resize);
  resize();
}

/** Recompute integer scale & canvas size from the window. */
export function resize() {
  dpr = window.devicePixelRatio || 1;
  const devW = Math.max(1, Math.round(window.innerWidth * dpr)), devH = Math.max(1, Math.round(window.innerHeight * dpr));
  let best = 3, bd = 1e9;
  for (let s = 2; s <= 6; s++) { const d = Math.abs(devW / s - 410); if (d < bd) { bd = d; best = s; } }
  scale = best;
  G.cam.scale = scale; G.cam.viewW = devW / scale; G.cam.viewH = devH / scale;
  const nw = Math.ceil(G.cam.viewW) + 2, nh = Math.ceil(G.cam.viewH) + 2;
  if (nw !== cw || nh !== ch) {
    cw = nw; ch = nh;
    for (const c of [cv, tc, sc, lm]) { c.width = cw; c.height = ch; }
    timg = tctx.createImageData(cw, ch); t32 = new Uint32Array(timg.data.buffer);
    for (const c of [ctx, sctx, lmctx, tctx]) c.imageSmoothingEnabled = false;
    vig = null;
  }
  cv.style.width = (cw * scale / dpr) + 'px'; cv.style.height = (ch * scale / dpr) + 'px';
  view.scale = scale; view.w = cw; view.h = ch;
  clampCamera();
}

/** CSS px (client coords) -> world cells. */
export function screenToWorld(sx: number, sy: number): [number, number] {
  return [camLeft + (sx * dpr) / scale, camTop + (sy * dpr) / scale];
}
/** World cells -> CSS px (client coords). */
export function worldToScreen(x: number, y: number): [number, number] {
  return [((x - camLeft) * scale) / dpr, ((y - camTop) * scale) / dpr];
}

// bilinear weights of a cell inside its 4-cell tile toward the neighbouring tile
const WS = [0.625, 0.875, 0.875, 0.625], WNB = [0.375, 0.125, 0.125, 0.375], DNB = [-1, -1, 1, 1];
let rowR = new Float32Array(0), rowG = new Float32Array(0), rowB = new Float32Array(0);

function hash32(x: number, y: number, s: number) { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1274126177); h = Math.imul(h ^ (h >>> 13), 1103515245); return (h ^ (h >>> 16)) >>> 0; }

// ---------------------------------------------------------------------------------------------------------------------
// terrain pass
function drawTerrain(v: View, t: number) {
  const x0 = v.x0, y0 = v.y0, w = v.w, h = v.h, q = G.quality;
  const ltx0 = lt.tx0, lty0 = lt.ty0, lw = lt.w, lh = lt.h;
  if (rowR.length < lw + 2) { rowR = new Float32Array(lw + 2); rowG = new Float32Array(lw + 2); rowB = new Float32Array(lw + 2); }
  const tt = (t * 2.4) | 0, ti = (t * 6) | 0, wob = (t * 7) | 0;
  const edges = q > 0, sparkle = q > 0;
  const xs = Math.max(0, 2 - x0), xe = Math.min(w, W - 2 - x0);
  const dayLevel = G.daylight;
  for (let cy = 0; cy < h; cy++) {
    const wy = y0 + cy, o0 = cy * w;
    if (wy < 2 || wy >= H - 2) { t32.fill(wy >= 0 && wy < H ? 0xff0a0a10 : 0xff000000, o0, o0 + w); continue; }
    // vertical blend of light rows
    const ty = (wy >> 2) - lty0, oy = wy & 3;
    let ty2 = oy < 2 ? ty - 1 : ty + 1; const wn = WNB[oy], ws = 1 - wn;
    const tyc = ty < 0 ? 0 : ty >= lh ? lh - 1 : ty; ty2 = ty2 < 0 ? 0 : ty2 >= lh ? lh - 1 : ty2;
    const ra = tyc * lw, rb = ty2 * lw;
    for (let k = 0; k < lw; k++) {
      rowR[k + 1] = (lightR[ra + k] * ws + lightR[rb + k] * wn) * 256;
      rowG[k + 1] = (lightG[ra + k] * ws + lightG[rb + k] * wn) * 256;
      rowB[k + 1] = (lightB[ra + k] * ws + lightB[rb + k] * wn) * 256;
    }
    rowR[0] = rowR[1]; rowG[0] = rowG[1]; rowB[0] = rowB[1]; rowR[lw + 1] = rowR[lw]; rowG[lw + 1] = rowG[lw]; rowB[lw + 1] = rowB[lw];
    const rowBase = wy * W, bgBase = (wy >> 2) * TW, tyIdx = (wy & 63) << 6;
    for (let cx = 0; cx < xs; cx++) t32[o0 + cx] = 0xff0a0a10;
    for (let cx = xe; cx < w; cx++) t32[o0 + cx] = 0xff0a0a10;
    for (let cx = xs; cx < xe; cx++) {
      const wx = x0 + cx, i = rowBase + wx, o = o0 + cx;
      const m = mat[i], mode = MODE[m];
      // light at this cell (tile coords relative to the light region)
      const tx = (wx >> 2) - ltx0, ox = wx & 3;
      let k0 = tx + 1, k1 = k0 + DNB[ox];
      if (k0 < 0) k0 = 0; else if (k0 > lw + 1) k0 = lw + 1; if (k1 < 0) k1 = 0; else if (k1 > lw + 1) k1 = lw + 1;
      const a = WS[ox], b = WNB[ox];
      let lr = (rowR[k0] * a + rowR[k1] * b) | 0, lg = (rowG[k0] * a + rowG[k1] * b) | 0, lb = (rowB[k0] * a + rowB[k1] * b) | 0;
      const bgid = bg[bgBase + (wx >> 2)];
      const tix = tyIdx | (wx & 63);

      if (mode === 1) {
        // ---- solid / powder ----
        let mul = VARMUL[(m << 8) | shade[i]];
        let tcx = TEXM[m][tix];
        if (edges) {
          if (OPEN[mat[i - W]]) {
            mul += TOPB[m];
            if (sparkle && SPARK[m] && ((hash32(wx, wy, tt) & 255) < 5)) mul += 150 + (dayLevel * 60) | 0;
          } else if (OPEN[mat[i - W - W]]) mul += TOPB[m] >> 1;
          if (OPEN[mat[i + W]]) mul -= 58;
          if (OPEN[mat[i - 1]]) mul += 8; if (OPEN[mat[i + 1]]) mul -= 14;
        }
        if (TRANS[m] !== 0 && bgid !== 0) {
          // translucent (ice/glass): blend toward the lit wall behind
          const bt = BGTEX[bgid][tix], tr = TRANS[m];
          const br = ((bt & 255) * ((lr + 256) >> 1)) >> 8, bgc = (((bt >> 8) & 255) * ((lg + 256) >> 1)) >> 8, bb = (((bt >> 16) & 255) * ((lb + 256) >> 1)) >> 8;
          const mr = (mul * lr) >> 8, mg = (mul * lg) >> 8, mb = (mul * lb) >> 8;
          let r = ((tcx & 255) * mr) >> 8, g = (((tcx >> 8) & 255) * mg) >> 8, bl = (((tcx >> 16) & 255) * mb) >> 8;
          r = r + (((br - r) * tr) >> 8); g = g + (((bgc - g) * tr) >> 8); bl = bl + (((bb - bl) * tr) >> 8);
          t32[o] = 0xff000000 | ((bl > 255 ? 255 : bl) << 16) | ((g > 255 ? 255 : g) << 8) | (r > 255 ? 255 : r);
          continue;
        }
        let mr = (mul * lr) >> 8, mg = (mul * lg) >> 8, mb = (mul * lb) >> 8;
        if (m === MAT_CRYSTAL) {   // self-lit, shimmering
          const e = 250 + ((shade[i] & 31) << 1) + ((Math.sin(t * 2 + wx * 0.3 + wy * 0.2) * 22) | 0);
          if (mr < e * 0.8) mr = (e * 0.8) | 0; if (mg < e) mg = e; if (mb < e * 1.1) mb = (e * 1.1) | 0;
        }
        const r = ((tcx & 255) * mr) >> 8, g = (((tcx >> 8) & 255) * mg) >> 8, bl = (((tcx >> 16) & 255) * mb) >> 8;
        t32[o] = 0xff000000 | ((bl > 255 ? 255 : bl) << 16) | ((g > 255 ? 255 : g) << 8) | (r > 255 ? 255 : r);
        continue;
      }

      if (mode === 0 || mode === 5) {
        // ---- empty: background wall or sky (transparent) ----
        if (bgid === 0) { t32[o] = 0; continue; }
        const bt = BGTEX[bgid][tix];
        const r = ((bt & 255) * lr) >> 8, g = (((bt >> 8) & 255) * lg) >> 8, bl = (((bt >> 16) & 255) * lb) >> 8;
        t32[o] = 0xff000000 | ((bl > 255 ? 255 : bl) << 16) | ((g > 255 ? 255 : g) << 8) | (r > 255 ? 255 : r);
        continue;
      }

      // ---- liquid / gas / emissive: composite over background if there is one ----
      let br = 0, bgc = 0, bb = 0, hasBg = false;
      if (bgid !== 0) {
        const bt = BGTEX[bgid][tix];
        br = ((bt & 255) * lr) >> 8; bgc = (((bt >> 8) & 255) * lg) >> 8; bb = (((bt >> 16) & 255) * lb) >> 8; hasBg = true;
      }
      if (mode === 2) {
        // water / oil: scrolling ripples, bright surface line, sparkle
        const tcx = TEXM[m][(((wy + ((Math.sin(wx * 0.21 + t * 1.3) * 1.4) | 0)) & 63) << 6) | ((wx + wob) & 63)];
        let mul = 256;
        const up = mat[i - W];
        let surf = 0;
        if (up !== m) {
          if (MODE[up] !== 1) { surf = 1; } else surf = 0;
        } else if (mat[i - W - W] !== m && MODE[mat[i - W - W]] !== 1) surf = 2;
        let r = tcx & 255, g = (tcx >> 8) & 255, bl = (tcx >> 16) & 255;
        if (surf === 1) {
          const sh = Math.sin(wx * 0.33 + t * 2.3) + Math.sin(wx * 0.11 - t * 1.2) + Math.sin(wx * 0.9 + t * 3.1) * 0.5;
          const k = sh > 1.25 ? 0.75 : 0.4 + 0.12 * sh;
          r += (205 - r) * k; g += (234 - g) * k; bl += (255 - bl) * k; mul = 270;
        } else if (surf === 2) { r += (150 - r) * 0.18; g += (190 - g) * 0.18; bl += (240 - bl) * 0.18; }
        const mr = (mul * lr) >> 8, mg = (mul * lg) >> 8, mb = (mul * lb) >> 8;
        r = (r * mr) >> 8; g = (g * mg) >> 8; bl = (bl * mb) >> 8;
        if (hasBg) { r = (r * 205 + br * 51) >> 8; g = (g * 205 + bgc * 51) >> 8; bl = (bl * 205 + bb * 51) >> 8; }
        t32[o] = 0xff000000 | ((bl > 255 ? 255 : bl) << 16) | ((g > 255 ? 255 : g) << 8) | (r > 255 ? 255 : r);
        continue;
      }
      if (mode === 3) {
        // gas: alpha from life; methane shimmers
        const d = MATS[m];
        const tcx = TEXM[m][(((wy + (ti >> 1)) & 63) << 6) | ((wx + (ti >> 2)) & 63)];
        const lum = (tcx & 255) / 255;
        let alpha: number;
        if (d.key === 'METHANE') alpha = 0.1 + 0.1 * lum + 0.07 * Math.sin(t * 1.7 + wx * 0.21 + wy * 0.17 + (shade[i] & 7));
        else { const life = aux[i]; alpha = Math.min(1, life / 70) * (0.28 + 0.5 * lum); if (d.key === 'STEAM') alpha *= 0.85; }
        if (alpha < 0.03) { if (hasBg) t32[o] = 0xff000000 | (bb << 16) | (bgc << 8) | br; else t32[o] = 0; continue; }
        const mr = lr, mg = lg, mb = lb;
        let r = (d.color[0] * mr) >> 8, g = (d.color[1] * mg) >> 8, bl = (d.color[2] * mb) >> 8;
        if (d.key === 'METHANE') { g = Math.max(g, 70); r = Math.max(r, 30); }
        const al = (alpha * 255) | 0;
        if (hasBg) {
          r = (r * al + br * (255 - al)) / 255 | 0; g = (g * al + bgc * (255 - al)) / 255 | 0; bl = (bl * al + bb * (255 - al)) / 255 | 0;
          t32[o] = 0xff000000 | ((bl > 255 ? 255 : bl) << 16) | ((g > 255 ? 255 : g) << 8) | (r > 255 ? 255 : r);
        } else t32[o] = (al << 24) | ((bl > 255 ? 255 : bl) << 16) | ((g > 255 ? 255 : g) << 8) | (r > 255 ? 255 : r);
        continue;
      }
      // mode 4: fire / lava / ember (self-lit)
      {
        const key = m;
        const hsh = hash32(wx, wy, ti);
        if (key === MAT_FIRE) {
          const n = (TEXM[m][(((wy + ti * 3) & 63) << 6) | ((wx + (hsh & 3)) & 63)] & 255) / 255;
          const life = Math.min(1, aux[i] / 40);
          let p = n * 0.5 + life * 0.55 + ((hsh >> 8) & 15) / 15 * 0.12 - 0.05;
          if (!OPEN[mat[i - W]]) p += 0.1;
          if (p < 0.2) { t32[o] = hasBg ? (0xff000000 | (bb << 16) | (bgc << 8) | br) : 0; continue; }
          p = p > 1 ? 1 : p;
          const c = FIREPAL[(p * 63) | 0];
          const al = p < 0.34 ? 140 : p < 0.5 ? 205 : 245;
          if (hasBg) {
            const r = (((c & 255) * al + br * (255 - al)) / 255) | 0, g = ((((c >> 8) & 255) * al + bgc * (255 - al)) / 255) | 0, bl = ((((c >> 16) & 255) * al + bb * (255 - al)) / 255) | 0;
            t32[o] = 0xff000000 | (bl << 16) | (g << 8) | r;
          } else t32[o] = (al << 24) | (c & 0xffffff);
        } else if (key === MAT_LAVA) {
          const n = (TEXM[m][(((wy + (t * 3 | 0)) & 63) << 6) | ((wx + (Math.sin(t * 0.7 + wy * 0.1) * 6 | 0) + (t * 4 | 0)) & 63)] & 255) / 255;
          let p = n * 0.9 + 0.08 + Math.sin(t * 1.4 + wx * 0.09 + wy * 0.13) * 0.08;
          if (OPEN[mat[i - W]]) p += 0.22;
          p = p < 0 ? 0 : p > 1 ? 1 : p;
          const c = LAVAPAL[(p * 63) | 0];
          t32[o] = c;
        } else { // ember
          const p = 0.35 + 0.35 * ((hsh >> 5) & 15) / 15 + 0.25 * Math.sin(t * 3 + wx * 1.7 + wy);
          t32[o] = EMBERPAL[(Math.max(0, Math.min(1, p)) * 63) | 0];
        }
      }
    }
  }
  tctx.putImageData(timg, 0, 0);
}
const MAT_CRYSTAL = MAT.CRYSTAL, MAT_FIRE = MAT.FIRE, MAT_LAVA = MAT.LAVA;

// ---------------------------------------------------------------------------------------------------------------------
// weather & vignette
function drawWeather(c: CanvasRenderingContext2D, v: View, t: number) {
  const vis = Math.max(0, Math.min(1, G.visibility)), storm = Math.min(1, G.storm);
  const fog = (1 - vis) * 0.78 + storm * 0.1;
  if (fog > 0.01) {
    const day = Math.max(0.2, G.daylight);
    const r = (196 * day + 20) | 0, g = (208 * day + 26) | 0, b = (226 * day + 36) | 0;
    c.fillStyle = `rgba(${r},${g},${b},${Math.min(0.88, fog)})`;
    c.fillRect(0, 0, v.w, v.h);
  }
  const bl = storm * 0.9 + (1 - vis) * 0.4;
  if (bl > 0.05) {
    const n = Math.min(260, (bl * 220) | 0), dir = G.wind >= 0 ? 1 : -1, sp = 140 + Math.abs(G.wind) * 30;
    const day = Math.max(0.35, G.daylight);
    c.fillStyle = `rgba(${(235 * day + 20) | 0},${(242 * day + 20) | 0},255,${0.16 + 0.22 * bl})`;
    for (let i = 0; i < n; i++) {
      const hx = hashf(i * 7.13), hy = hashf(i * 3.71 + 9), l = 8 + hashf(i * 1.9) * 22;
      const x = (((hx * v.w * 1.3 + dir * t * sp * (0.6 + hashf(i * 5.3))) % (v.w + 40)) + v.w + 40) % (v.w + 40) - 20;
      const y = hy * v.h + Math.sin(t * 0.7 + i) * 2;
      c.fillRect(dir > 0 ? x : x - l, y | 0, l | 0, 1);
    }
  }
}
function hashf(n: number) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

function makeVignette() {
  vig = document.createElement('canvas'); vig.width = 64; vig.height = 36;
  const c = vig.getContext('2d')!;
  const g = c.createRadialGradient(32, 18, 10, 32, 18, 42);
  g.addColorStop(0, 'rgba(4,8,20,0)'); g.addColorStop(0.65, 'rgba(4,8,20,0.08)'); g.addColorStop(1, 'rgba(4,8,20,0.5)');
  c.fillStyle = g; c.fillRect(0, 0, 64, 36);
}

// ---------------------------------------------------------------------------------------------------------------------
export function render(dt: number) {
  const tStart = performance.now();
  tAcc += dt; const t = tAcc; G.frame++;
  if (!cv) return;
  const cam = G.cam;
  // camera -> view (shake is a pseudo-random sub-cell offset)
  let cx = cam.x, cy = cam.y;
  if (cam.shake > 0) { cx += Math.sin(t * 61.7) * cam.shake; cy += Math.sin(t * 47.3 + 1.3) * cam.shake; }
  camLeft = cx - cam.viewW / 2; camTop = cy - cam.viewH / 2;
  // keep the canvas inside the world where possible
  const x0 = Math.floor(camLeft), y0 = Math.floor(camTop);
  subX = camLeft - x0; subY = camTop - y0;
  view.x0 = x0; view.y0 = y0; view.t = t; view.scale = scale;
  const v = view;
  // css transform: sub-cell offset snapped to device pixels
  const ox = Math.round(subX * scale) / dpr, oy = Math.round(subY * scale) / dpr;
  cv.style.transform = `translate(${-ox}px,${-oy}px)`;

  // light
  const t1 = performance.now();
  computeLight(x0, y0, v.w, v.h, t);
  const t2 = performance.now();

  // sky
  drawSky(ctx, v.w, v.h, x0, y0, cam.x, cam.y, t, G.quality);
  const t3 = performance.now();

  // terrain
  drawTerrain(v, t);
  ctx.drawImage(tc, 0, 0);
  const t4 = performance.now();

  // lit sprite layers (z < 0)
  let i = 0;
  const n = layers.length;
  if (n > 0 && layers[0].z < 0) {
    sctx.globalCompositeOperation = 'source-over'; sctx.clearRect(0, 0, v.w, v.h);
    for (; i < n && layers[i].z < 0; i++) layers[i].fn(sctx, v);
    ensureLightCanvas();
    lmctx.globalCompositeOperation = 'source-over'; lmctx.imageSmoothingEnabled = true;
    lmctx.clearRect(0, 0, v.w, v.h);
    lmctx.drawImage(lightC!, lt.tx0 * 4 - x0, lt.ty0 * 4 - y0, lt.w * 4, lt.h * 4);
    lmctx.globalCompositeOperation = 'destination-in'; lmctx.drawImage(sc, 0, 0);
    sctx.globalCompositeOperation = 'multiply'; sctx.drawImage(lm, 0, 0); sctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(sc, 0, 0);
  }
  // emissive
  ctx.globalCompositeOperation = 'lighter';
  for (; i < n && layers[i].z < 100; i++) layers[i].fn(ctx, v);
  // bloom from point lights
  if (G.quality > 0) {
    ensureGlowCanvas();
    ctx.imageSmoothingEnabled = true; ctx.globalAlpha = 0.85;
    ctx.drawImage(glowC!, lt.tx0 * 4 - x0, lt.ty0 * 4 - y0, lt.w * 4, lt.h * 4);
    ctx.globalAlpha = 1; ctx.imageSmoothingEnabled = false;
  }
  ctx.globalCompositeOperation = 'source-over';
  // weather then top layers
  drawWeather(ctx, v, t);
  for (; i < n; i++) layers[i].fn(ctx, v);
  if (G.xray === 3) { ensureLightCanvas(); ctx.globalAlpha = 0.7; ctx.imageSmoothingEnabled = true; ctx.drawImage(lightC!, lt.tx0 * 4 - x0, lt.ty0 * 4 - y0, lt.w * 4, lt.h * 4); ctx.globalAlpha = 1; ctx.imageSmoothingEnabled = false; }
  // vignette
  if (!vig) makeVignette();
  ctx.imageSmoothingEnabled = true; ctx.drawImage(vig!, 0, 0, v.w, v.h); ctx.imageSmoothingEnabled = false;

  const t5 = performance.now();
  perf.sky = t3 - t2; perf.light = t2 - t1; perf.terrain = t4 - t3; perf.layers = t5 - t4; perf.total = t5 - tStart; perf.frames++;
}

function ensureLightCanvas() {
  if (!lightC || lastLightW !== lt.w || lastLightH !== lt.h || lightImg!.data.buffer !== lightRGBA.buffer) {
    lightC = document.createElement('canvas'); lightC.width = lt.w; lightC.height = lt.h; lightCtx = lightC.getContext('2d')!;
    lightImg = new ImageData(lightRGBA.subarray(0, lt.w * lt.h * 4), lt.w, lt.h);
    lastLightW = lt.w; lastLightH = lt.h;
    glowC = null;
  }
  lightCtx.putImageData(lightImg!, 0, 0);
}
function ensureGlowCanvas() {
  if (!glowC || glowImg!.data.buffer !== glowRGBA.buffer || glowC.width !== lt.w || glowC.height !== lt.h) {
    glowC = document.createElement('canvas'); glowC.width = lt.w; glowC.height = lt.h; glowCtx = glowC.getContext('2d')!;
    glowImg = new ImageData(glowRGBA.subarray(0, lt.w * lt.h * 4), lt.w, lt.h);
  }
  glowCtx.putImageData(glowImg!, 0, 0);
}

/** Current view (valid after the first render()). */
export function getView(): View { return view; }
export function getScale() { return scale; }
