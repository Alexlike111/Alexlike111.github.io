// «Чутьё» (senses mode, key X / touch button): the world dims and the simulation becomes visible knowledge, in our own visual language.
//   снег    — density of snow / packed snow / placed blocks as a calm ramp: рыхлый (slate blue) -> хороший для блоков (bright mint band, 250..380 kg/m3)
//             -> плотный (lavender). The band is the one the snow knife needs, so it is the loudest colour.
//   тепло   — tinted air per heat tile (cold blue ... warm amber) with soft contour bands every 6 deg; the tile image is upscaled with smoothing.
//   сквозняк — short streaks that follow the heat.ts wind field: pale outdoors, bright cyan where the wind leaks into a roofed space (a gap in a wall).
//   запах   — drifting dots carried downwind from you / food / a lit lamp (the same sources and wind as game/fauna.ts' scent field, whose strength fades
//             them) and a faint haze above the ground where the bear's scent field is strong. Walls stop the dots: a closed igloo keeps your smell in.
// Zero cost when off (the layer returns at once). When on: one cell-resolution snow pass every 2nd frame, one tile-resolution heat pass every 4th frame.
// Labels and the legend are DOM (ui/sensesui.ts) driven by the exported state.
import { G } from '../game/state';
import type { View } from '../game/state';
import { addLayer } from './render';
import { W, H, TW, TH, TS, mat, aux } from './grid';
import { MAT, PHASE, P_EMPTY, P_GAS, P_FIRE, P_LIQUID } from '../content/materials';
import { temp, wind, sky } from './heat';
import { densityOf } from '../game/items';
import { scentAt } from '../game/fauna';
import { count } from '../game/inventory';
import { initWindowGlow } from './windows';

export type SensesLayer = 'snow' | 'heat' | 'wind' | 'scent';
export const LAYERS: SensesLayer[] = ['snow', 'heat', 'wind', 'scent'];
export const senses = { on: false, k: 0, layers: { snow: true, heat: true, wind: true, scent: true } as Record<SensesLayer, boolean> };
/** Density band the snow knife wants (items.ts snowClass): [GOOD_LO, GOOD_HI] kg/m3. */
export const GOOD_LO = 250, GOOD_HI = 380;
/** Draw counters (self-test: every layer actually drew something). */
export const drawn = { snow: 0, heat: 0, wind: 0, scent: 0, frames: 0, dots: 0, ms: 0 };

const listeners: (() => void)[] = [];
export function onSensesChange(f: () => void) { listeners.push(f); }
const fire = () => { for (const f of listeners) f(); };
export function toggleSenses(on?: boolean) { senses.on = on ?? !senses.on; fire(); }
export function setSensesLayer(l: SensesLayer, on?: boolean) { senses.layers[l] = on ?? !senses.layers[l]; fire(); }
export const sensesActive = () => senses.k > 0.01;

// ---------------------------------------------------------------------------------------------------------------------
// colour helpers
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Packed ABGR (little endian) for ImageData. */
const px = (r: number, g: number, b: number, a: number) => ((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);

/** Density ramp (kg/m3) -> [r,g,b]. Exported for the legend. */
export function snowRamp(d: number): [number, number, number] {
  if (d < GOOD_LO) { const t = clamp((d - 60) / 190, 0, 1); return [lerp(70, 118, t), lerp(88, 146, t), lerp(150, 214, t)]; }   // slate -> periwinkle
  if (d <= GOOD_HI) { const t = (d - GOOD_LO) / (GOOD_HI - GOOD_LO); return [lerp(96, 150, Math.sin(t * Math.PI)), lerp(238, 255, Math.sin(t * Math.PI)), lerp(190, 222, Math.sin(t * Math.PI))]; }   // the mint band
  const t = clamp((d - GOOD_HI) / 140, 0, 1); return [lerp(176, 232, t), lerp(146, 220, t), 255];                                    // lavender -> pale violet
}
/** Temperature (deg C) -> [r,g,b]: deep blue ... ice ... soft amber ... orange. Exported for the legend. */
export function heatRamp(T: number): [number, number, number] {
  const S: [number, number, number, number][] = [[-40, 40, 58, 190], [-28, 62, 104, 226], [-16, 92, 160, 246], [-6, 140, 206, 255], [-0.5, 190, 232, 255], [0.5, 255, 232, 164], [8, 255, 190, 96], [18, 255, 140, 60], [32, 255, 96, 52]];
  if (T <= S[0][0]) return [S[0][1], S[0][2], S[0][3]];
  for (let i = 1; i < S.length; i++) if (T <= S[i][0]) { const a = S[i - 1], b = S[i], t = (T - a[0]) / (b[0] - a[0]); return [lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)]; }
  const e = S[S.length - 1]; return [e[1], e[2], e[3]];
}

// lookup per snow material x aux: surface alpha is loud, interior alpha is calmer so a drift reads as a body
const MS = MAT.SNOW, MP = MAT.PACKED, MB = MAT.SNOWBLOCK;
const SNOW_SURF = new Uint32Array(3 * 256), SNOW_IN = new Uint32Array(3 * 256), SNOW_GOOD = new Uint8Array(3 * 256);
{
  const keys = ['SNOW', 'PACKED', 'SNOWBLOCK'];
  for (let k = 0; k < 3; k++) for (let a = 0; a < 256; a++) {
    const d = densityOf(keys[k], a), [r, g, b] = snowRamp(d), good = d >= GOOD_LO && d <= GOOD_HI;
    SNOW_SURF[k * 256 + a] = px(r, g, b, good ? 168 : 150);
    SNOW_IN[k * 256 + a] = px(r, g, b, good ? 96 : 70);
    SNOW_GOOD[k * 256 + a] = good ? 1 : 0;
  }
}
const KIND = new Int8Array(256).fill(-1); KIND[MS] = 0; KIND[MP] = 1; KIND[MB] = 2;
const OPENM = new Uint8Array(256); for (let m = 0; m < 256; m++) OPENM[m] = m === 0 || PHASE[m] === P_EMPTY || PHASE[m] === P_GAS || PHASE[m] === P_FIRE || PHASE[m] === P_LIQUID ? 1 : 0;
const AIRM = new Uint8Array(256); for (let m = 0; m < 256; m++) AIRM[m] = m === 0 || PHASE[m] === P_EMPTY || PHASE[m] === P_GAS || PHASE[m] === P_FIRE ? 1 : 0;

// ---------------------------------------------------------------------------------------------------------------------
// offscreen buffers (cell-resolution snow, tile-resolution heat)
let snowC: HTMLCanvasElement | null = null, snowX: CanvasRenderingContext2D, snowImg: ImageData, snow32: Uint32Array, snowOx = 0, snowOy = 0, snowAge = 99;
let heatC: HTMLCanvasElement | null = null, heatX: CanvasRenderingContext2D, heatImg: ImageData, heat32: Uint32Array, heatTx = 0, heatTy = 0, heatW = 0, heatH = 0, heatAge = 99;
// cell-resolution mask for the heat tint: air cells take it fully, solids and water only a whisper, so walls stay crisp while the air inside is smooth
let maskC: HTMLCanvasElement | null = null, maskX: CanvasRenderingContext2D, maskImg: ImageData, mask32: Uint32Array, maskOx = 0, maskOy = 0, maskAge = 99;
let bigC: HTMLCanvasElement | null = null, bigX: CanvasRenderingContext2D;
let rampPhase = 0;

function passSnow(v: View) {
  const w = v.w, h = v.h;
  if (!snowC || snowC.width !== w || snowC.height !== h) {
    snowC = document.createElement('canvas'); snowC.width = w; snowC.height = h; snowX = snowC.getContext('2d')!;
    snowImg = snowX.createImageData(w, h); snow32 = new Uint32Array(snowImg.data.buffer);
  }
  snow32.fill(0);
  const x0 = v.x0, y0 = v.y0, ph = rampPhase;
  let n = 0;
  const ys = Math.max(2, -y0), ye = Math.min(h, H - 2 - y0), xs = Math.max(1, -x0), xe = Math.min(w, W - 1 - x0);
  for (let cy = ys; cy < ye; cy++) {
    const row = (y0 + cy) * W + x0, o = cy * w;
    for (let cx = xs; cx < xe; cx++) {
      const i = row + cx, m = mat[i], k = KIND[m];
      if (k < 0) continue;
      const a = k * 256 + aux[i];
      const surf = OPENM[mat[i - W]] | OPENM[mat[i - 1]] | OPENM[mat[i + 1]] | OPENM[mat[i + W]];
      let c = surf ? SNOW_SURF[a] : SNOW_IN[a];
      if (SNOW_GOOD[a] && surf) {                                      // a slow shimmer travels over the good band so it is the first thing the eye finds
        const s = (((x0 + cx) * 5 + (y0 + cy) * 3 + ph) & 63);
        if (s < 5) c = px(210, 255, 238, 255);
      }
      snow32[o + cx] = c; n++;
    }
  }
  snowX.putImageData(snowImg, 0, 0);
  snowOx = x0; snowOy = y0; snowAge = 0; drawn.snow = n;
}

function passMask(v: View) {
  const w = v.w, h = v.h;
  if (!maskC || maskC.width !== w || maskC.height !== h) {
    maskC = document.createElement('canvas'); maskC.width = w; maskC.height = h; maskX = maskC.getContext('2d')!;
    maskImg = maskX.createImageData(w, h); mask32 = new Uint32Array(maskImg.data.buffer);
    bigC = document.createElement('canvas'); bigC.width = w; bigC.height = h; bigX = bigC.getContext('2d')!;
  }
  const x0 = v.x0, y0 = v.y0, AIRPX = px(255, 255, 255, 255), WHISPER = px(255, 255, 255, 72);
  mask32.fill(0);
  const ys = Math.max(0, -y0), ye = Math.min(h, H - y0), xs = Math.max(0, -x0), xe = Math.min(w, W - x0);
  for (let cy = ys; cy < ye; cy++) {
    const row = (y0 + cy) * W + x0, o = cy * w;
    for (let cx = xs; cx < xe; cx++) { const m = mat[row + cx]; mask32[o + cx] = AIRM[m] || m === MAT.FIXTURE ? AIRPX : WHISPER; }
  }
  maskX.putImageData(maskImg, 0, 0); maskOx = x0; maskOy = y0; maskAge = 0;
}

function passHeat(v: View) {
  const tx0 = Math.max(0, (v.x0 >> 2) - 1), ty0 = Math.max(0, (v.y0 >> 2) - 1);
  const tx1 = Math.min(TW - 1, ((v.x0 + v.w) >> 2) + 1), ty1 = Math.min(TH - 1, ((v.y0 + v.h) >> 2) + 1);
  const w = tx1 - tx0 + 1, h = ty1 - ty0 + 1;
  if (w <= 0 || h <= 0) return;
  if (!heatC || heatW !== w || heatH !== h) {
    heatC = document.createElement('canvas'); heatC.width = w; heatC.height = h; heatX = heatC.getContext('2d')!;
    heatImg = heatX.createImageData(w, h); heat32 = new Uint32Array(heatImg.data.buffer); heatW = w; heatH = h;
  }
  let n = 0;
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const t = ty * TW + tx, T = temp[t], o = (ty - ty0) * w + (tx - tx0);
      const [r, g, b] = heatRamp(T);
      // outdoor sky tiles stay calm; enclosed air carries the information (the cell mask keeps walls crisp)
      let a = sky[t] ? 0.2 : 0.42;
      const band = Math.floor(T / 6);
      if (tx < tx1 && Math.floor(temp[t + 1] / 6) !== band) a += 0.16;
      else if (ty < ty1 && Math.floor(temp[t + TW] / 6) !== band) a += 0.16;
      heat32[o] = px(r, g, b, Math.round(clamp(a, 0, 1) * 255)); n++;
    }
  }
  heatX.putImageData(heatImg, 0, 0);
  heatTx = tx0; heatTy = ty0; heatAge = 0; drawn.heat = n;
}

// ---------------------------------------------------------------------------------------------------------------------
// drafts
function hash2(a: number, b: number) { let h = Math.imul(a, 374761393) + Math.imul(b, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function drawDrafts(ctx: CanvasRenderingContext2D, v: View, k: number) {
  const t = v.t;
  const tx0 = Math.max(1, v.x0 >> 2), tx1 = Math.min(TW - 2, (v.x0 + v.w) >> 2), ty0 = Math.max(1, v.y0 >> 2), ty1 = Math.min(TH - 2, (v.y0 + v.h) >> 2);
  let n = 0;
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const ti = ty * TW + tx, wv = wind[ti], aw = wv < 0 ? -wv : wv;
      if (aw < 0.15) continue;
      const open = sky[ti] === 1;
      const m = mat[(ty * TS + 2) * W + tx * TS + 2];
      if (!AIRM[m]) continue;
      const hs = hash2(tx, ty);
      if (open) { if (hs > 0.028 + 0.004 * Math.min(aw, 8) || aw < 0.5) continue; }   // outdoors: a sparse, calm flow
      else if (hs > 0.55 + 0.3 * Math.min(1, aw / 3)) continue;                 // a roofed space with wind in it: this is a leak, show it densely
      const dir = wv > 0 ? 1 : -1;
      const sp = 0.35 + aw * 0.05, len = Math.min(16, (open ? 3 : 6) + aw * 1.8) | 0;
      const u = ((t * sp + hs * 7.3) % 1 + 1) % 1;
      const hx = tx * TS + (dir > 0 ? u * (TS + len) : (1 - u) * (TS + len)) - (dir > 0 ? 0 : 0);
      const hy = ty * TS + ((hs * 977) % TS | 0) + Math.round(Math.sin(t * 2 + hs * 40) * 0.6);
      const col = open ? '196,228,255' : '150,240,255';
      const steps = open ? 4 : 6, th = open ? 1 : 2;
      for (let s = 0; s < steps; s++) {
        const a = (open ? 0.3 : 0.9) * (1 - s / steps) * k * (open ? 1 : 0.85 + 0.15 * Math.sin(t * 6 + hs * 9));
        ctx.fillStyle = `rgba(${col},${a.toFixed(3)})`;
        const sx = hx - dir * (s * len / steps) - v.x0;
        ctx.fillRect(Math.round(dir > 0 ? sx - len / steps : sx), hy - v.y0, Math.max(1, Math.round(len / steps)), th);
      }
      n++;
    }
  }
  drawn.wind = n;
}

// ---------------------------------------------------------------------------------------------------------------------
// scent: dots carried downwind from the sources, stopped by walls, faded by the fauna scent field
interface Dot { x: number; y: number; life: number; max: number; r: number; hot: boolean; w: number }
const dots: Dot[] = [];
const MAXDOTS = 220;
let lastT = 0, spawnAcc = 0, foodAcc = 0, lampAcc = 0;
function playerStrength(): number {
  let s = 1;
  for (const id of ['seal_meat', 'fat', 'fish', 'cooked_meat', 'ptarmigan', 'fish_cooked']) { const n = count(id); if (n > 0) s += 0.25 + Math.min(0.5, n * 0.05); }
  const p = G.player; if (p && p.hp < 60) s += 0.4;
  const sh = G.shelter; if (sh && sh.closed && p.shelter > 0.55) s *= sh.vent ? 0.55 : 0.4;
  return s;
}
function windFactor(x: number, y: number): number {
  const wb = G.wind < 0 ? -G.wind : G.wind; if (wb < 0.05) return 0;
  const wl = wind[clamp(y >> 2, 0, TH - 1) * TW + clamp(x >> 2, 0, TW - 1)]; return clamp((wl < 0 ? -wl : wl) / wb, 0, 1);
}
function emit(x: number, y: number, hot: boolean, spread = 6) {
  if (dots.length >= MAXDOTS) return;
  dots.push({ x: x + (Math.random() - 0.5) * spread, y: y + (Math.random() - 0.5) * spread, life: 0, max: 5 + Math.random() * 5, r: 1 + (Math.random() < 0.25 ? 1 : 0), hot, w: Math.random() * 6.28 });
}
function stepScent(dt: number, v: View) {
  const p = G.player;
  if (p && p.alive) {
    spawnAcc += dt * 7 * playerStrength();
    while (spawnAcc >= 1) { spawnAcc -= 1; emit(p.x, p.y - 12, false, 6); }
  }
  foodAcc += dt * 3; lampAcc += dt * 2;
  if (foodAcc >= 1) {
    foodAcc = 0;
    for (const d of G.drops) if ((d.item === 'seal_meat' || d.item === 'fat' || d.item === 'fish' || d.item === 'sealskin') && d.x > v.x0 - 60 && d.x < v.x0 + v.w + 60) emit(d.x, d.y - 3, true, 4);
  }
  if (lampAcc >= 1) {
    lampAcc = 0;
    for (const f of G.fixtures) if (f.kind === 'fat_lamp' && f.lit) emit(f.tx * TS + f.tw * 2, f.ty * TS - 2, true, 4);
  }
  const wb = G.wind;
  for (let i = dots.length - 1; i >= 0; i--) {
    const d = dots[i];
    d.life += dt;
    if (d.life >= d.max) { dots[i] = dots[dots.length - 1]; dots.pop(); continue; }
    const f = windFactor(d.x, d.y);
    const nx = d.x + wb * 11 * (0.12 + 0.88 * f) * dt * (0.8 + 0.4 * Math.sin(d.w));
    const ny = d.y - 2.2 * dt + Math.sin(d.life * 1.7 + d.w) * 4 * dt;
    const xi = nx | 0, yi = ny | 0;
    if (xi < 1 || xi >= W - 1 || yi < 2 || yi >= H - 2 || !OPENM[mat[yi * W + xi]]) {                            // a wall: the smell stops (and piles up inside shelters)
      if (!OPENM[mat[yi * W + xi]]) { d.life += dt * 3; continue; }
      dots[i] = dots[dots.length - 1]; dots.pop(); continue;
    }
    d.x = nx; d.y = ny;
  }
}
function drawScent(ctx: CanvasRenderingContext2D, v: View, k: number) {
  // haze: the bear's scent field (1-D along x) shown as a soft rose band above the ground
  const x0 = v.x0, y0 = v.y0, p = G.player;
  if (p) {
    const gy = Math.floor(p.y);
    for (let cx = 0; cx < v.w; cx += 4) {
      const s = scentAt(x0 + cx + 2); if (s < 0.25) continue;
      const a = Math.min(0.26, 0.05 + s * 0.035) * k;
      // ground height of this column near the player's level (first solid downward from 40 cells above the player)
      let y = Math.max(2, gy - 40); const xi = x0 + cx + 2; if (xi < 1 || xi >= W - 1) continue;
      while (y < H - 3 && OPENM[mat[y * W + xi]]) y++;
      const hh = 8 + Math.min(26, s * 3.2);
      const g = ctx.createLinearGradient(0, y - hh - y0, 0, y - y0);
      g.addColorStop(0, 'rgba(255,150,200,0)'); g.addColorStop(1, `rgba(255,150,200,${a.toFixed(3)})`);
      ctx.fillStyle = g; ctx.fillRect(cx, y - hh - y0, 4, hh);
    }
  }
  let n = 0;
  for (const d of dots) {
    const fade = Math.min(1, d.life / 0.6) * Math.min(1, (d.max - d.life) / 1.8);
    const fieldK = 0.4 + 0.6 * Math.min(1, scentAt(d.x) / 3);
    const a = 0.85 * fade * fieldK * k;
    if (a < 0.03) continue;
    const sx = Math.round(d.x - v.x0), sy = Math.round(d.y - v.y0);
    ctx.fillStyle = d.hot ? `rgba(255,128,120,${(a * 0.45).toFixed(3)})` : `rgba(255,150,210,${(a * 0.4).toFixed(3)})`;
    ctx.fillRect(sx - d.r, sy - d.r, d.r * 2 + 1, d.r * 2 + 1);                                                     // soft halo
    ctx.fillStyle = d.hot ? `rgba(255,190,170,${a.toFixed(3)})` : `rgba(255,214,236,${a.toFixed(3)})`;
    ctx.fillRect(sx, sy, d.r, d.r); n++;
  }
  drawn.scent = n;
}

// ---------------------------------------------------------------------------------------------------------------------
// the layer
let removeLayer: (() => void) | null = null;
function draw(ctx: CanvasRenderingContext2D, v: View) {
  const t0 = performance.now();
  drawInner(ctx, v);
  if (senses.k >= 0.01) drawn.ms += (performance.now() - t0 - drawn.ms) * 0.1;
}
function drawInner(ctx: CanvasRenderingContext2D, v: View) {
  const dt0 = Math.min(0.1, Math.max(0, v.t - lastT)); lastT = v.t;
  const target = senses.on ? 1 : 0;
  if (senses.k !== target) senses.k = Math.abs(target - senses.k) < dt0 * 6 ? target : senses.k + Math.sign(target - senses.k) * dt0 * 6;
  if (senses.k < 0.01) { if (dots.length) dots.length = 0; snowAge = heatAge = maskAge = 99; return; }
  const k = senses.k, L = senses.layers;
  drawn.frames++; rampPhase = (v.t * 9) | 0;
  // dim the world, keeping a clearer pocket around the player so you are never lost
  const p = G.player;
  const px0 = p ? p.x - v.x0 : v.w / 2, py0 = p ? p.y - 10 - v.y0 : v.h / 2;
  ctx.save();
  const g = ctx.createRadialGradient(px0, py0, 12, px0, py0, Math.max(60, v.h * 0.34));
  g.addColorStop(0, `rgba(3,8,20,${(0.2 * k).toFixed(3)})`); g.addColorStop(1, `rgba(3,8,20,${(0.44 * k).toFixed(3)})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, v.w, v.h);

  if (L.heat) {
    if (!heatC || heatAge >= 4) passHeat(v); else heatAge++;
    if (!maskC || maskAge >= 2 || maskC.width !== v.w || maskC.height !== v.h) passMask(v); else maskAge++;
    if (heatC && maskC && bigC) {
      bigX.globalCompositeOperation = 'source-over'; bigX.clearRect(0, 0, v.w, v.h);
      bigX.imageSmoothingEnabled = true;
      bigX.drawImage(heatC, heatTx * TS - v.x0, heatTy * TS - v.y0, heatW * TS, heatH * TS);
      bigX.globalCompositeOperation = 'destination-in';
      bigX.drawImage(maskC, maskOx - v.x0, maskOy - v.y0);
      ctx.globalAlpha = k; ctx.drawImage(bigC, 0, 0); ctx.globalAlpha = 1;
    }
  }
  if (L.snow) {
    if (!snowC || snowAge >= 2 || snowC.width !== v.w || snowC.height !== v.h) passSnow(v); else snowAge++;
    ctx.globalAlpha = k; ctx.drawImage(snowC!, snowOx - v.x0, snowOy - v.y0); ctx.globalAlpha = 1;
  }
  if (L.wind) drawDrafts(ctx, v, k);
  if (L.scent) { stepScent(dt0, v); drawScent(ctx, v, k); drawn.dots = dots.length; } else if (dots.length) dots.length = 0;
  ctx.restore();
}

export function initSenses() {
  if (removeLayer) return;
  removeLayer = addLayer(110, draw);
  (window as unknown as { __senses?: unknown }).__senses = { senses, drawn, dots };      // dev / test handle
  initWindowGlow();                                                    // warm window glow (engine/windows.ts) shares the registration
}
/** Test helper: run the scent particle step by `s` seconds without rendering. */
export function _stepScentForTest(s: number, v: View) { for (let t = 0; t < s; t += 0.05) stepScent(0.05, v); return dots.length; }
