// Polar-night sky (DESIGN §2 "Visual identity"). Driven by G.sunElev / G.noonElev / G.moon / G.moonPhase / G.aurora / G.storm:
//  * the sun never rises until day 12: the only daylight is a twilight band on the southern horizon that widens and warms with
//    the day number (day 1: thin steel-blue glow, day 10-11: pink-orange, day 12 noon: the rim of the sun),
//  * stars, a moon with phases, aurora curtains on clear nights,
//  * parallax: far arctic mountains, glacier cliffs and icebergs on the sea horizon (NO forests), a distant dark sea plane.
// Drawn first on the low-res world canvas (crisp 1-px columns/rows); the terrain is composited on top.
import { G } from '../game/state';

type RGB = [number, number, number];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mix = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const ss = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const rgb = (c: RGB) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const rgba = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
function hash(n: number) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

/** World row of the far sea horizon. Parallax layers stand on it; the dark sea plane lies below it up to the near water (row 300). */
export const HORIZON_Y = 294;
const SKYH = 175;                // cells above the horizon where the gradient reaches the zenith colour

/** Per-frame derived sky state (render.ts calls updateSkyState() once per frame; light.ts reads it). */
export const skyState = {
  elev: -12, light: 0 /* 0..1 twilight level */, warm: 0 /* 0 steel-blue .. 1 pink-orange */, night: 1,
  moon: 0 /* moonlight 0..1 incl. altitude */, moonAlt: -1, moonX: 0.5, illum: 0, aurora: 0, storm: 0, sunX: 0.5, sunUp: 0,
  starFade: 1,
};
/** Colour of the horizon glow right now (water / far silhouettes tint themselves with it). */
export const horizonRGB: RGB = [9, 17, 40];
export const zenithRGB: RGB = [4, 7, 20];

const NIGHT_Z: RGB = [4, 7, 20], NIGHT_H: RGB = [9, 17, 40];
// twilight colours at full strength: zenith / mid-sky / horizon, for warm = 0 and warm = 1
const TW_Z: [RGB, RGB] = [[24, 48, 108], [60, 70, 138]];
const TW_M: [RGB, RGB] = [[46, 86, 150], [160, 98, 148]];
const TW_H: [RGB, RGB] = [[92, 146, 196], [255, 154, 100]];

export function updateSkyState() {
  const s = skyState;
  const e = G.sunElev;
  s.elev = e;
  s.light = ss(-12.5, 0.8, e);
  s.warm = ss(-8.6, -1.1, e);
  s.night = 1 - s.light;
  s.storm = clamp(G.storm, 0, 1);
  const hour = ((G.time % 1440) + 1440) % 1440 / 60;
  const p = G.moonPhase;
  s.illum = (1 - Math.cos(2 * Math.PI * p)) / 2;
  const phi = 2 * Math.PI * (hour / 24 - p) - Math.PI;                // 0 = moon in the south (transit), ± = east/west
  const ph = Math.atan2(Math.sin(phi), Math.cos(phi));
  s.moonAlt = Math.cos(ph);
  s.moonX = 0.5 + 0.46 * clamp(ph / 2.1, -1, 1);
  s.moon = G.moon;
  s.aurora = clamp(G.aurora, 0, 1);
  s.sunX = 0.5 + clamp((hour - 12) * 0.05, -0.4, 0.4);
  s.sunUp = ss(-2.4, -0.2, e);
  s.starFade = (1 - ss(0.15, 0.7, s.light)) * (1 - s.storm * 0.92);
  // horizon / zenith colours for everything that wants to match the sky
  const w = s.warm, L = Math.pow(s.light, 0.8);
  const hT = mix(TW_H[0], TW_H[1], w), zT = mix(TW_Z[0], TW_Z[1], w);
  const gray: RGB = [86 + 40 * s.light, 98 + 44 * s.light, 116 + 46 * s.light];
  let hc = mix(NIGHT_H, hT, L), zc = mix(NIGHT_Z, zT, L);
  hc = mix(hc, gray, s.storm * 0.8); zc = mix(zc, gray, s.storm * 0.75);
  horizonRGB[0] = hc[0]; horizonRGB[1] = hc[1]; horizonRGB[2] = hc[2];
  zenithRGB[0] = zc[0]; zenithRGB[1] = zc[1]; zenithRGB[2] = zc[2];
}

// ---------------------------------------------------------------------------------------------------------------------
// static procedural data
const NS = 2048;
const mtn: Float32Array[] = [];                 // 2 mountain layers, heights 0..1
const cliffH = new Float32Array(NS);            // glacier cliffs: flat tops with steps
const cliffS = new Uint8Array(NS);              // 0 plain, 1 crevasse, 2 ice-layer stripe
interface Berg { x: number; w: number; h: number; peak: number; flat: number; shade: number }
const bergs: Berg[] = [];
const stars = { x: new Float32Array(520), y: new Float32Array(520), b: new Float32Array(520), ph: new Float32Array(520) };
let inited = false;
function ridged(x: number, f: number, seed: number) {
  let s = 0, a = 1, n = 0;
  for (let o = 0; o < 4; o++) {
    const u = x * f * (1 << o) / NS * 64, i = Math.floor(u), t = u - i;
    const v = hash(((i % (64 * (1 << o))) + seed + o * 17)) * (1 - t) + hash((((i + 1) % (64 * (1 << o))) + seed + o * 17)) * t;
    s += (1 - Math.abs(v * 2 - 1)) * a; n += a; a *= 0.5;
  }
  return s / n;
}
function initSky() {
  if (inited) return; inited = true;
  const cfg = [{ f: 0.26, seed: 11, p: 1.7 }, { f: 0.44, seed: 47, p: 1.5 }];
  for (const c of cfg) {
    const a = new Float32Array(NS);
    for (let x = 0; x < NS; x++) a[x] = Math.pow(ridged(x, c.f, c.seed), c.p);
    for (let pass = 0; pass < 2; pass++) { const b = a.slice(); for (let x = 0; x < NS; x++) a[x] = (b[(x + NS - 1) % NS] + b[x] * 2 + b[(x + 1) % NS]) / 4; }
    mtn.push(a);
  }
  // glacier fronts: long low ice cliffs with ramps, a few vertical faces and crevasses
  {
    const node: number[] = []; for (let i = 0; i <= NS / 26 + 2; i++) node.push(2 + 20 * Math.pow(hash(i * 3.17 + 1), 1.4));
    for (let x = 0; x < NS; x++) {
      const u = x / 26, i = Math.floor(u), f = u - i, sm = f * f * (3 - 2 * f);
      let h = node[i] * (1 - sm) + node[i + 1] * sm;
      h = Math.round(h / 2) * 2;                                // terraced, like layered ice
      cliffH[x] = h;
      cliffS[x] = hash(x * 0.61 + 7) < 0.035 ? 1 : 0;           // crevasse
    }
  }
  for (let i = 0; i < 22; i++) {
    const w = 14 + hash(i * 3.1) * 34, h = 7 + hash(i * 5.3) * 22;
    bergs.push({ x: (i + hash(i * 7.7) * 0.8) * (NS / 22), w, h, peak: hash(i * 9.1), flat: hash(i * 1.3) < 0.45 ? 1 : 0, shade: hash(i * 2.9) });
  }
  for (let i = 0; i < 520; i++) {
    stars.x[i] = hash(i * 1.37) * NS; stars.y[i] = hash(i * 7.71);
    const b = hash(i * 3.3); stars.b[i] = b * b; stars.ph[i] = hash(i * 9.1) * 6.28;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// aurora buffer (half resolution, additive)
let aurC: HTMLCanvasElement | null = null, aurCtx: CanvasRenderingContext2D | null = null, aurImg: ImageData | null = null, aur32: Uint32Array | null = null;
let aurW = 0, aurH = 0;
const colBase = new Float32Array(1024), colRay = new Float32Array(1024), colBase2 = new Float32Array(1024), colRay2 = new Float32Array(1024);

function drawAurora(ctx: CanvasRenderingContext2D, w: number, horizonY: number, x0: number, t: number, strength: number) {
  const aw = Math.min(1023, (w + 1) >> 1), ah = clamp(horizonY >> 1, 8, 140);
  if (!aurC || aurW !== aw || aurH !== ah) {
    aurC = document.createElement('canvas'); aurC.width = aurW = aw; aurC.height = aurH = ah;
    aurCtx = aurC.getContext('2d')!; aurImg = aurCtx.createImageData(aw, ah); aur32 = new Uint32Array(aurImg.data.buffer);
  }
  const px = aur32!; px.fill(0xff000000);
  const u0 = x0 * 0.12;
  for (let ax = 0; ax < aw; ax++) {
    const u = ax * 2 + u0;
    colBase[ax] = ah * (0.62 + Math.sin(u * 0.011 + t * 0.22) * 0.1 + Math.sin(u * 0.027 - t * 0.37) * 0.045 + Math.sin(u * 0.005 + t * 0.07 + 2) * 0.08);
    const r = 0.5 + 0.5 * Math.sin(u * 0.17 + Math.sin(u * 0.045 + t * 0.9) * 3.2 + t * 0.7);
    colRay[ax] = 0.18 + 0.82 * r * r * (0.55 + 0.45 * Math.sin(u * 0.021 + t * 0.3 + 1));
    colBase2[ax] = ah * (0.42 + Math.sin(u * 0.0085 - t * 0.17 + 3) * 0.1 + Math.sin(u * 0.031 + t * 0.3) * 0.04);
    const r2 = 0.5 + 0.5 * Math.sin(u * 0.13 + Math.sin(u * 0.05 - t * 0.6) * 3 - t * 0.5 + 1.7);
    colRay2[ax] = 0.1 + 0.9 * r2 * r2 * (0.5 + 0.5 * Math.sin(u * 0.016 - t * 0.2));
  }
  const magenta = Math.max(0, strength - 0.55) * 1.6;
  for (let c = 0; c < 2; c++) {
    const base = c ? colBase2 : colBase, ray = c ? colRay2 : colRay, hgt = ah * (c ? 0.42 : 0.55), amp = c ? 0.5 : 0.85;
    for (let ax = 0; ax < aw; ax++) {
      const b = base[ax], rr = ray[ax] * amp;
      const top = Math.max(0, (b - hgt) | 0), bot = Math.min(ah - 1, (b + 3) | 0);
      for (let ay = top; ay <= bot; ay++) {
        const d = b - ay;
        let v: number;
        if (d < 0) v = Math.exp(d * 0.9); else { v = 1 - d / hgt; v = v * v * (0.55 + 0.45 * v); }
        v *= rr * strength; if (v < 0.01) continue;
        const k = Math.min(1, d / hgt), k2 = Math.max(0, k);
        // green at the base (magenta fringe on strong nights) -> teal -> violet at the top
        const R = lerp(0.25, 0.62, k2 * k2) + (d < 0 ? magenta * 0.7 * Math.min(1, -d / 3) : 0), Gc = lerp(1.0, 0.3, k2 * k2 * 0.9) * (d < 0 ? 1 - magenta * 0.45 * Math.min(1, -d / 3) : 1), B = lerp(0.52, 1.0, Math.sqrt(k2)) + (d < 0 ? magenta * 0.5 : 0);
        const i = ay * aw + ax, o = px[i];
        let r8 = (o & 255) + R * v * 150, g8 = ((o >> 8) & 255) + Gc * v * 190, b8 = ((o >> 16) & 255) + B * v * 140;
        if (r8 > 255) r8 = 255; if (g8 > 255) g8 = 255; if (b8 > 255) b8 = 255;
        px[i] = 0xff000000 | (b8 << 16) | (g8 << 8) | r8;
      }
    }
  }
  aurCtx!.putImageData(aurImg!, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(aurC!, 0, 0, aw, ah, 0, 0, aw * 2, ah * 2);
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------------------------------
const tmpC: RGB = [0, 0, 0];
/** Draw the sky for the canvas whose top-left is world cell (x0,y0), size w×h. camX/camY = camera centre (cells). */
export function drawSky(ctx: CanvasRenderingContext2D, w: number, h: number, x0: number, y0: number, camX: number, camY: number, t: number, q: number) {
  initSky();
  const st = skyState;
  const L = st.light, Lm = Math.pow(L, 0.62), warm = st.warm, storm = st.storm, night = st.night;
  const hY = HORIZON_Y - y0;                                  // canvas row of the horizon
  const gray: RGB = [86 + 40 * L, 98 + 44 * L, 116 + 46 * L];

  // ---- gradient: the band of twilight light hugs the horizon and grows with the day number ----
  const hT = mix(TW_H[0], TW_H[1], warm), mT = mix(TW_M[0], TW_M[1], warm), zT = mix(TW_Z[0], TW_Z[1], warm);
  const bandK = 0.2 + 0.85 * L;
  const rows = Math.min(h, Math.max(0, hY));
  for (let y = 0; y < rows; y++) {
    const hh = hY - y;                                        // cells above the horizon
    const s = clamp(hh / SKYH, 0, 1);
    const sn = Math.pow(s, 0.62);
    const nc = mix(NIGHT_H, NIGHT_Z, sn);
    const se = clamp(s / bandK, 0, 1);
    const tc = se < 0.3 ? mix(hT, mT, se / 0.3) : mix(mT, zT, Math.pow((se - 0.3) / 0.7, 0.8));
    let c = mix(nc, tc, Lm);
    if (storm > 0) c = mix(c, gray, storm * (0.55 + 0.25 * s));
    ctx.fillStyle = rgb(c);
    ctx.fillRect(0, y, w, 1);
  }
  // warm glow patch around the southern point of the sun (wide ellipse); stronger when the sun is close to the horizon
  if (L > 0.05 && storm < 0.9 && hY > 4) {
    const gx = w * st.sunX, gw = w * (0.55 + 0.4 * L), gh = 24 + 70 * L;
    const gcol = mix(hT, [255, 196, 130], warm * 0.6);
    ctx.save(); ctx.translate(gx, hY); ctx.scale(gw / gh, 1);
    const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, gh);
    gr.addColorStop(0, rgba(gcol, 0.55 * Lm * (1 - storm))); gr.addColorStop(0.5, rgba(gcol, 0.18 * Lm * (1 - storm))); gr.addColorStop(1, rgba(gcol, 0));
    ctx.fillStyle = gr; ctx.fillRect(-gh - 4, -gh, gh * 2 + 8, gh + 1); ctx.restore();
  }

  // ---- stars ----
  const sf = st.starFade;
  if (sf > 0.02) {
    ctx.fillStyle = '#fff';
    const span = Math.max(40, hY - 6);
    for (let i = 0; i < 520; i++) {
      const xx = (((stars.x[i] - camX * 0.05) % NS) + NS) % NS;
      if (xx >= w) continue;
      const yy = (1 - stars.y[i]) * SKYH * 0.98;               // cells above the horizon
      const cy = hY - yy;
      if (cy < 0 || cy >= hY - 3) continue;
      const near = 1 - ss(0, 0.28, yy / SKYH);                  // fade near the glowing horizon
      const tw = 0.7 + 0.3 * Math.sin(t * (1.2 + stars.b[i] * 2) + stars.ph[i]);
      const a = sf * (0.2 + 0.8 * stars.b[i]) * tw * (1 - near * 0.85) * (1 - L * 0.9);
      if (a < 0.05) continue;
      ctx.globalAlpha = Math.min(1, a);
      ctx.fillRect(xx | 0, cy | 0, 1, 1);
      if (stars.b[i] > 0.8 && a > 0.4) { ctx.globalAlpha = a * 0.4; ctx.fillRect((xx | 0) - 1, cy | 0, 3, 1); ctx.fillRect(xx | 0, (cy | 0) - 1, 1, 3); }
    }
    ctx.globalAlpha = 1; void span;
  }

  // ---- aurora (clear nights) ----
  if (st.aurora > 0.02 && night > 0.3 && q > 0 && hY > 12) drawAurora(ctx, w, hY + 16, x0, t, st.aurora * Math.min(1, (night - 0.3) * 2) * (1 - storm * 0.85));

  // ---- moon with phases ----
  if (st.moonAlt > -0.08 && storm < 0.95) {
    const mx = w * st.moonX, my = hY - (st.moonAlt + 0.08) * 105 - 6;
    const vis = (1 - storm * 0.8) * (1 - 0.7 * Lm);
    const halo = ctx.createRadialGradient(mx, my, 3, mx, my, 38);
    halo.addColorStop(0, `rgba(190,210,255,${0.26 * st.illum * vis})`); halo.addColorStop(1, 'rgba(160,190,255,0)');
    ctx.fillStyle = halo; ctx.fillRect(mx - 40, my - 40, 80, 80);
    moonDisc(ctx, mx, my, 6, G.moonPhase, vis);
  }
  // ---- the sun: only its rim, and only on day 12 (a sliver of glow just before) ----
  if (st.sunUp > 0.01 && storm < 0.9) {
    const e = st.elev, sx = w * st.sunX, rim = clamp((e + 0.6) * 7, 0, 12);       // cells of disc above the horizon
    const sy = hY - rim + 6;
    const sa = (1 - storm);
    const halo = ctx.createRadialGradient(sx, hY, 2, sx, hY, 46 + 26 * warm);
    halo.addColorStop(0, `rgba(255,${(214 - 50 * warm) | 0},${(150 - 60 * warm) | 0},${0.5 * sa * st.sunUp})`); halo.addColorStop(1, 'rgba(255,170,120,0)');
    ctx.fillStyle = halo; ctx.fillRect(sx - 90, hY - 90, 180, 90);
    ctx.fillStyle = rgba(mix([255, 238, 190], [255, 176, 100], warm), sa * Math.min(1, st.sunUp * 1.5));
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, hY); ctx.clip();
    disc(ctx, sx, sy, 6);
    ctx.restore();
  }

  // ---- far mountains (arctic ranges: pale, jagged, snow capped) ----
  const moonLit = st.moon * (1 - 0.6 * Lm);
  const hz = horizonRGB;
  const mtnDay: RGB[] = [mix([88, 112, 156], hz, 0.45), mix([66, 90, 134], hz, 0.3)];
  const mtnNight: RGB[] = [[13, 22, 46], [10, 17, 36]];
  const pxk = [0.05, 0.1], amp = [78, 46], base = [4, 2];
  for (let Ly = 0; Ly < 2; Ly++) {
    let c = mix(mtnNight[Ly], mtnDay[Ly], Math.pow(L, 0.85));
    c = mix(c, [30 + 70 * moonLit, 44 + 80 * moonLit, 70 + 90 * moonLit], moonLit * 0.35);
    c = mix(c, gray, storm * 0.55);
    let cap = mix([46, 62, 104], mix([226, 236, 250], [255, 214, 196], warm * 0.6), Math.pow(L, 0.9));
    cap = mix(cap, [150 + 80 * moonLit, 170 + 70 * moonLit, 210 + 40 * moonLit], moonLit * 0.4);
    cap = mix(cap, gray, storm * 0.5);
    const m = mtn[Ly], u0 = Math.floor((x0 + camX * 0) * pxk[Ly]) + 700 * Ly;
    const cs = rgb(c), cc = rgb(cap), shadeCol = rgba(mix(c, [0, 4, 14], 0.45), 0.5), litCol = rgba(mix(cap, c, 0.4), 0.4);
    const par = camX * pxk[Ly];
    for (let i = 0; i < w; i++) {
      const u = ((Math.floor(par + i) % NS) + NS) % NS, un = (u + 3) % NS, up = (u + NS - 3) % NS;
      const hgt = m[u] * amp[Ly] + 2 - base[Ly];
      if (hgt < 1) continue;
      const top = Math.floor(hY - hgt);
      if (top >= hY) continue;
      const slope = m[un] - m[up];
      const y1 = Math.max(0, top), hh = Math.min(hY, hY + 2) - y1;
      ctx.fillStyle = cs; ctx.fillRect(i, y1, 1, hh);
      const face = Math.min(hgt * 0.8, 8 + hgt * 0.4) | 0;
      if (slope > 0.012) { ctx.fillStyle = shadeCol; ctx.fillRect(i, y1, 1, face); } else if (slope < -0.012) { ctx.fillStyle = litCol; ctx.fillRect(i, y1, 1, face); }
      if (m[u] > 0.38) { const capLen = Math.min(hgt * 0.55, (m[u] - 0.38) * amp[Ly] * 1.1 + 1); ctx.fillStyle = cc; ctx.fillRect(i, y1, 1, Math.max(1, capLen | 0)); }
    }
    void u0;
  }
  // ---- glacier cliffs (tabular ice with vertical faces) ----
  {
    let c = mix([14, 26, 52], mix([118, 160, 196], hz, 0.35), Math.pow(L, 0.85));
    c = mix(c, [38 + 60 * moonLit, 60 + 70 * moonLit, 92 + 70 * moonLit], moonLit * 0.4); c = mix(c, gray, storm * 0.5);
    const top = mix(c, [255, 255, 255], 0.25 + 0.3 * Lm), face = mix(c, [0, 8, 24], 0.3);
    const cs = rgb(c), ct = rgb(top), cf = rgb(face), par = camX * 0.16;
    for (let i = 0; i < w; i++) {
      const u = ((Math.floor(par + i) % NS) + NS) % NS, hh = cliffH[u];
      if (hh <= 0) continue;
      const y1 = Math.floor(hY - hh);
      ctx.fillStyle = cs; ctx.fillRect(i, y1, 1, Math.min(hY, hY + 2) - y1);
      ctx.fillStyle = ct; ctx.fillRect(i, y1, 1, 1 + (hh > 14 ? 1 : 0));
      if (cliffS[u]) { ctx.fillStyle = cf; ctx.fillRect(i, y1 + 1, 1, hh | 0); }
      else if (((u >> 2) * 7 + (u >> 5)) % 5 === 0) { ctx.fillStyle = cf; ctx.fillRect(i, y1 + 4, 1, 1); if (hh > 12) ctx.fillRect(i, y1 + 9, 1, 1); }
    }
  }
  // ---- the sea plane below the horizon (dark water reflecting the glow), up to the near water ----
  if (hY < h) {
    const rows2 = Math.min(h - hY, 40);
    const near = mix([6, 15, 28], [10, 24, 40], L), farC = mix(near, mix(hz, [8, 16, 30], 0.45), 0.55 * Lm + 0.1);
    for (let y = 0; y < rows2; y++) {
      const k = Math.min(1, y / 14);
      let c = mix(farC, near, k * 0.8);
      if (storm > 0) c = mix(c, gray, storm * 0.5 * (1 - k * 0.4));
      ctx.fillStyle = rgb(c); ctx.fillRect(0, hY + y, w, 1);
    }
    // glints on the far water near the glow
    if (Lm > 0.1 || st.moon > 0.2) {
      const gcol: RGB = st.moon > 0.2 && Lm < 0.4 ? [180, 200, 240] : mix(hz, [255, 230, 200], 0.4);
      const gx = w * (Lm > 0.1 ? st.sunX : st.moonX), ga = (Lm > 0.1 ? Lm * 0.35 : st.moon * 0.4) * (1 - storm);
      ctx.fillStyle = rgba(gcol, ga);
      for (let y = 0; y < 18; y++) {
        const half = 6 + y * 3.2, jit = Math.sin(t * 1.3 + y * 1.9) * 3;
        const cnt = 1 + (y >> 2);
        for (let k = 0; k < cnt; k++) { const dx = (hash(y * 13.1 + k * 7.3 + Math.floor(t * 0.5)) - 0.5) * 2 * half; ctx.fillRect((gx + dx + jit) | 0, hY + y + 1, 2 + (y >> 3), 1); }
      }
    }
    // thin pale pack ice line right at the horizon (ice blink)
    ctx.fillStyle = rgba(mix(hz, [225, 236, 250], 0.35 + 0.3 * Lm), 0.28 + 0.4 * Lm);
    for (let i = 0; i < w; i += 3) { const u = ((Math.floor(camX * 0.12 + i) % NS) + NS) % NS; if (hash(u * 0.37) > 0.35) ctx.fillRect(i, hY, 3 + ((u * 5) & 3), 1); }
  }
  // ---- icebergs standing on the horizon ----
  {
    const lit = mix([22, 40, 74], mix([200, 226, 244], hz, 0.3), Math.pow(L, 0.8));
    const shd = mix([10, 20, 42], mix([88, 122, 170], hz, 0.3), Math.pow(L, 0.8));
    const litC = mix(mix(lit, [90 + 120 * moonLit, 120 + 110 * moonLit, 170 + 70 * moonLit], moonLit * 0.4), gray, storm * 0.55);
    const shdC = mix(shd, gray, storm * 0.5);
    const cl = rgb(litC), cd = rgb(shdC), cw = rgb(mix(litC, [255, 255, 255], 0.35));
    const par = camX * 0.26;
    for (const b of bergs) {
      let bx = ((b.x - par) % NS + NS) % NS; if (bx > NS - 60) bx -= NS;
      if (bx + b.w < -4 || bx > w + 4) continue;
      const peakAt = b.w * (0.25 + 0.5 * b.peak);
      for (let i = 0; i < b.w; i++) {
        const xx = Math.round(bx + i); if (xx < 0 || xx >= w) continue;
        const u = i / b.w;
        // faceted outline: rises with steps to the peak (or a flat table top), then falls steeply
        let hh: number;
        if (b.flat) hh = b.h * (0.55 + 0.45 * Math.min(1, Math.min(u, 1 - u) * 5)) + (hash(i * 0.7 + b.x) > 0.8 ? 2 : 0);
        else { const t2 = i < peakAt ? i / peakAt : 1 - (i - peakAt) / (b.w - peakAt); hh = b.h * (0.25 + 0.75 * Math.pow(Math.max(0, t2), 0.8)) + Math.floor(hash(i * 0.6 + b.x) * 2); }
        const y1 = Math.floor(hY - hh + 2);
        const sunward = (i / b.w) < (0.3 + 0.4 * b.shade);
        ctx.fillStyle = sunward ? cl : cd; ctx.fillRect(xx, y1, 1, Math.floor(hh));
        if (sunward && hash(i * 1.9 + b.x) > 0.6) { ctx.fillStyle = cw; ctx.fillRect(xx, y1, 1, 1); }
      }
      // reflection stub
    }
  }
}

function disc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const ri = Math.ceil(r);
  for (let dy = -ri; dy <= ri; dy++) {
    const hw = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy) + 0.25));
    ctx.fillRect(Math.round(cx) - hw, Math.round(cy) + dy, hw * 2 + 1, 1);
  }
}

/** Moon disc with its terminator (phase 0 new, 0.5 full; waxing is lit on the right). Dark side shows faint earthshine. */
function moonDisc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, phase: number, vis: number) {
  const ri = Math.ceil(r), X = Math.round(cx), Y = Math.round(cy);
  const c = Math.cos(2 * Math.PI * phase), waxing = phase < 0.5;
  ctx.fillStyle = `rgba(60,72,110,${0.45 * vis})`; disc(ctx, cx, cy, r);
  ctx.fillStyle = `rgba(228,234,248,${Math.min(1, vis * 1.3)})`;
  for (let dy = -ri; dy <= ri; dy++) {
    const hw = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy) + 0.25));
    const xt = Math.round(c * hw);
    let a: number, b: number;
    if (waxing) { a = xt; b = hw; } else { a = -hw; b = -xt; }
    if (b >= a) ctx.fillRect(X + a, Y + dy, b - a + 1, 1);
  }
  // maria
  ctx.fillStyle = `rgba(150,160,190,${0.5 * vis})`;
  const mar: [number, number, number][] = [[-2, -2, 2], [1, 1, 2], [2, -3, 1], [-1, 3, 1]];
  for (const [mx, my, mr] of mar) { const lit = waxing ? mx > c * 4 - 1 : mx < -c * 4 + 1; if (lit && c < 0.9) ctx.fillRect(X + mx, Y + my, mr, mr); }
}
