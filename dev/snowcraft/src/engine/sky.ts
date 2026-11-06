// Sky: time-of-day gradient, stars, sun/moon, aurora curtains, 3 parallax mountain layers + distant spruce forest.
// Drawn first on the low-res world canvas (crisp 1-px columns/rows); terrain is composited on top.
import { G } from '../game/state';

type RGB = [number, number, number];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mix = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const css = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const bell = (h: number, c: number, w: number) => { const d = (h - c) / w; return Math.exp(-d * d); };
function hash(n: number) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

// hour, zenith colour, horizon colour
const KEYS: [number, RGB, RGB][] = [
  [0, [6, 9, 24], [12, 22, 46]],
  [6.2, [6, 9, 24], [12, 22, 46]],
  [7.0, [28, 36, 86], [112, 78, 116]],
  [7.7, [66, 96, 170], [255, 158, 112]],
  [8.8, [66, 132, 210], [186, 224, 248]],
  [12, [52, 118, 206], [170, 216, 246]],
  [17.2, [60, 122, 208], [196, 220, 242]],
  [18.2, [58, 66, 148], [255, 138, 92]],
  [19.1, [26, 28, 72], [124, 60, 102]],
  [20.2, [7, 10, 28], [14, 26, 54]],
  [24, [6, 9, 24], [12, 22, 46]],
];
const skyTop: RGB = [0, 0, 0], skyHor: RGB = [0, 0, 0];
function skyColors(hour: number) {
  let i = 0; while (i < KEYS.length - 2 && hour >= KEYS[i + 1][0]) i++;
  const a = KEYS[i], b = KEYS[i + 1], t0 = Math.max(0, Math.min(1, (hour - a[0]) / (b[0] - a[0]))), t = t0 * t0 * (3 - 2 * t0);
  for (let k = 0; k < 3; k++) { skyTop[k] = lerp(a[1][k], b[1][k], t); skyHor[k] = lerp(a[2][k], b[2][k], t); }
}

// ---- static procedural data ----
const NS = 2048;
const mtn: Float32Array[] = [];      // 3 layers of heights 0..1
const forest = new Float32Array(NS);
const stars = { x: new Float32Array(420), y: new Float32Array(420), b: new Float32Array(420), ph: new Float32Array(420) };
interface Cloud { x: number; y: number; w: number; spans: number[]; speed: number }   // spans: [row, x0, x1] triples relative to (x,y)
const clouds: Cloud[] = [];
let inited = false;
function ridged(x: number, f: number, seed: number) {
  // sum of ridged triangle waves with hashed lattice
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
  const cfg = [{ f: 0.16, seed: 11, p: 1.6 }, { f: 0.28, seed: 47, p: 1.9 }, { f: 0.45, seed: 91, p: 1.5 }];
  for (const c of cfg) {
    const a = new Float32Array(NS);
    for (let x = 0; x < NS; x++) a[x] = Math.pow(ridged(x, c.f, c.seed), c.p);
    for (let pass = 0; pass < 3; pass++) { const b = a.slice(); for (let x = 0; x < NS; x++) a[x] = (b[(x + NS - 2) % NS] + b[(x + NS - 1) % NS] + b[x] * 2 + b[(x + 1) % NS] + b[(x + 2) % NS]) / 6; }
    mtn.push(a);
  }
  // distant spruce silhouettes: overlapping tiered triangles
  for (let t = 0; t < 360; t++) {
    const cx = hash(t * 3.1) * NS, hw = 3 + hash(t * 5.7) * 4.5, hh = 12 + hash(t * 9.3) * 18;
    for (let dx = -Math.ceil(hw); dx <= Math.ceil(hw); dx++) {
      const k = 1 - Math.abs(dx) / hw; if (k <= 0) continue;
      const tier = 0.86 + 0.14 * ((Math.floor((1 - k) * 7) & 1));
      const hgt = hh * k * tier + 2;
      const xi = (((Math.floor(cx) + dx) % NS) + NS) % NS;
      if (hgt > forest[xi]) forest[xi] = hgt;
    }
  }
  for (let c = 0; c < 14; c++) {
    const w = 34 + hash(c * 4.1) * 50, h = 5 + Math.floor(hash(c * 6.7) * 5), spans: number[] = [];
    const lumps = 2 + Math.floor(hash(c * 2.3) * 3);
    for (let r = 0; r < h; r++) {
      // union of a few ellipses stacked along x gives a cumulus-like flat-bottomed puff
      let x0 = 1e9, x1 = -1e9;
      for (let k = 0; k < lumps; k++) {
        const ex = (k / Math.max(1, lumps - 1) - 0.5) * w * 0.7, er = w * (0.2 + 0.13 * hash(c * 9 + k)), ey = h * (0.55 + 0.35 * hash(c * 5 + k * 3));
        const dy = (r + 0.5) / ey - 0.92; const q = 1 - dy * dy; if (q <= 0) continue;
        const hw = er * Math.sqrt(q); x0 = Math.min(x0, ex - hw); x1 = Math.max(x1, ex + hw);
      }
      if (x1 > x0) spans.push(r, Math.round(x0), Math.round(x1));
    }
    clouds.push({ x: hash(c * 3.9) * 760, y: 14 + hash(c * 8.3) * 88, w, spans, speed: 0.6 + hash(c * 1.7) * 1.2 });
  }
  for (let i = 0; i < 420; i++) {
    stars.x[i] = hash(i * 1.37) * NS; stars.y[i] = hash(i * 7.71) * 215;
    const b = hash(i * 3.3); stars.b[i] = b * b; stars.ph[i] = hash(i * 9.1) * 6.28;
  }
}

// aurora buffer (half resolution, additive)
let aurC: HTMLCanvasElement | null = null, aurCtx: CanvasRenderingContext2D | null = null, aurImg: ImageData | null = null, aur32: Uint32Array | null = null;
let aurW = 0, aurH = 0;
const colBase = new Float32Array(1024), colRay = new Float32Array(1024), colBase2 = new Float32Array(1024), colRay2 = new Float32Array(1024);

function drawAurora(ctx: CanvasRenderingContext2D, w: number, horizonY: number, x0: number, t: number, strength: number) {
  const aw = Math.min(1023, (w + 1) >> 1), ah = Math.max(8, (horizonY >> 1));
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
        // green at the base -> teal -> violet at the top
        const R = lerp(0.25, 0.62, k2 * k2), Gc = lerp(1.0, 0.3, k2 * k2 * 0.9), B = lerp(0.52, 1.0, Math.sqrt(k2));
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

export interface SkyOut { horizonY: number }

/** Draw the sky for the canvas whose top-left is world cell (x0,y0), size w×h. */
export function drawSky(ctx: CanvasRenderingContext2D, w: number, h: number, x0: number, y0: number, camX: number, camY: number, t: number, q: number) {
  initSky();
  const hour = ((G.time % 1440) + 1440) % 1440 / 60;
  skyColors(hour);
  const day = Math.max(0, Math.min(1, G.daylight));
  const storm = Math.min(1, G.storm);
  const warm = Math.min(1, bell(hour, 7.6, 0.8) + bell(hour, 18.4, 0.8));
  // storm greys the sky
  const gray: RGB = [96 + 40 * day, 108 + 44 * day, 124 + 46 * day];
  const top = mix(skyTop, mix(gray, [skyTop[0], skyTop[1], skyTop[2]], 0.15 + 0.4 * (1 - day)), storm * 0.75);
  const hor = mix(skyHor, mix(gray, [skyHor[0], skyHor[1], skyHor[2]], 0.15 + 0.4 * (1 - day)), storm * 0.8);

  // world-fixed vertical gradient: zenith at world y=ZY, horizon at HY
  const ZY = 40, HY = 290;
  const rows = h;
  for (let y = 0; y < rows; y++) {
    const s = Math.max(0, Math.min(1, (y0 + y - ZY) / (HY - ZY)));
    const k = s * s * (0.7 + 0.3 * s);           // concentrate the glow near the horizon
    ctx.fillStyle = css(mix(top, hor, k));
    ctx.fillRect(0, y, w, 1);
  }
  const horizonY = Math.max(8, Math.min(h, HY - y0 - 20));   // canvas row of the visual horizon (for aurora / celestial arcs)

  // stars
  const night = 1 - day;
  if (night > 0.02) {
    const vis = night * (1 - storm * 0.9);
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 420; i++) {
      const xx = (((stars.x[i] - camX * 0.04) % NS) + NS) % NS;
      if (xx >= w) continue;
      const yy = (stars.y[i] / 215) * (horizonY - 6) - (camY - 270) * 0.05;
      if (yy < 0 || yy >= horizonY - 6) continue;
      const tw = 0.7 + 0.3 * Math.sin(t * (1.2 + stars.b[i] * 2) + stars.ph[i]);
      const a = vis * (0.25 + 0.75 * stars.b[i]) * tw * (1 - Math.max(0, yy / horizonY - 0.6) * 1.8);
      if (a < 0.04) continue;
      ctx.globalAlpha = Math.min(1, a);
      ctx.fillRect(xx | 0, yy | 0, 1, 1);
      if (stars.b[i] > 0.82 && a > 0.4) { ctx.globalAlpha = a * 0.4; ctx.fillRect((xx | 0) - 1, yy | 0, 3, 1); ctx.fillRect(xx | 0, (yy | 0) - 1, 1, 3); }
    }
    ctx.globalAlpha = 1;
  }

  // aurora
  if (G.aurora > 0.02 && night > 0.3 && q > 0) drawAurora(ctx, w, horizonY + 20, x0, t, G.aurora * Math.min(1, (night - 0.3) * 2) * (1 - storm * 0.8));

  // sun & moon along a low arc
  const sunP = (hour - 7.4) / 11.6;     // 0 at sunrise .. 1 at sunset
  if (sunP > -0.06 && sunP < 1.06) {
    const sx = w * (0.1 + 0.8 * Math.max(0, Math.min(1, sunP))), sy = horizonY - Math.sin(Math.PI * Math.max(0, Math.min(1, sunP))) * horizonY * 0.52 + 8;
    const sa = (1 - storm) * Math.min(1, 0.5 + warm);
    const halo = ctx.createRadialGradient(sx, sy, 2, sx, sy, 40 + 22 * warm);
    halo.addColorStop(0, `rgba(255,${(226 - 50 * warm) | 0},${(160 - 70 * warm) | 0},${0.42 * sa})`); halo.addColorStop(1, 'rgba(255,200,140,0)');
    ctx.fillStyle = halo; ctx.fillRect(sx - 70, sy - 70, 140, 140);
    ctx.fillStyle = css(mix([255, 246, 214], [255, 190, 120], warm), sa);
    disc(ctx, sx, sy, 5);
  }
  const moonH = hour < 7.4 ? hour + 24 : hour;
  const moonP = (moonH - 18.6) / 12.6;
  if (moonP > -0.05 && moonP < 1.05 && night > 0.1) {
    const mp = Math.max(0, Math.min(1, moonP));
    const mx = w * (0.14 + 0.72 * mp), my = horizonY - Math.sin(Math.PI * mp) * horizonY * 0.6 + 14;
    const halo = ctx.createRadialGradient(mx, my, 3, mx, my, 34);
    halo.addColorStop(0, `rgba(190,210,255,${0.2 * night})`); halo.addColorStop(1, 'rgba(160,190,255,0)');
    ctx.fillStyle = halo; ctx.fillRect(mx - 40, my - 40, 80, 80);
    ctx.fillStyle = css([226, 232, 246], Math.min(1, night * 1.3) * (1 - storm * 0.7));
    const ph = 1 - Math.max(0, Math.min(1, G.moon));
    crescent(ctx, mx, my, 4.2, 7 * ph + 0.5, ph);
  }

  // clouds (soft pixel cumulus drifting slowly); dim and bluish at night, warm at dusk/dawn
  {
    const vis = (1 - storm * 0.3) * (day * 0.95 + night * 0.28);
    if (vis > 0.05) {
      const top = mix([78, 96, 140], [255, 255, 255], day), body = mix([46, 60, 102], [226, 234, 246], day), under = mix([28, 38, 76], [150, 170, 204], day);
      const tt = mix(top, [255, 206, 170], warm * 0.7), bb = mix(body, [236, 170, 150], warm * 0.6), uu = mix(under, [150, 110, 140], warm * 0.5);
      const ctop = css(tt, vis), cbody = css(bb, vis), cunder = css(uu, vis);
      for (const c of clouds) {
        const span = 760;
        let cx = ((c.x - camX * 0.12 + t * c.speed) % span + span) % span - 60;
        if (cx > w + 60) continue;
        const cy = c.y * (horizonY / 150) - (camY - 270) * 0.05;
        const n = c.spans.length;
        for (let k = 0; k < n; k += 3) {
          const r = c.spans[k], x0 = Math.round(cx + c.spans[k + 1]), x1 = Math.round(cx + c.spans[k + 2]);
          ctx.fillStyle = r < 2 ? ctop : r >= (n / 3) - 2 ? cunder : cbody;
          ctx.fillRect(x0, Math.round(cy) + r, x1 - x0, 1);
        }
      }
    }
  }

  // mountains (3 layers) + forest
  const tone = (far: RGB, mid: RGB, near: RGB, k: number): RGB => (k === 0 ? far : k === 1 ? mid : near);
  const dayTone: RGB[] = [[150, 178, 216], [118, 148, 192], [88, 114, 160]];
  const nightTone: RGB[] = [[22, 34, 66], [16, 26, 52], [12, 19, 40]];
  const capDay: RGB[] = [[240, 246, 255], [236, 243, 253], [226, 236, 250]];
  const capNight: RGB[] = [[70, 90, 140], [56, 74, 120], [44, 60, 100]];
  const pxk = [0.1, 0.22, 0.4], pyk = [0.28, 0.48, 0.72];
  const baseY = [276, 282, 288], amp = [66, 46, 32];
  for (let L = 0; L < 3; L++) {
    let c = mix(nightTone[L], dayTone[L], day);
    let cap = mix(capNight[L], capDay[L], day);
    c = mix(c, hor, warm * 0.28 * (1 - L * 0.25)); cap = mix(cap, [255, 190, 150], warm * 0.35);
    c = mix(c, gray, storm * 0.5); cap = mix(cap, gray, storm * 0.4);
    const yShift = baseY[L] + (camY - 270) * (1 - pyk[L]) - y0;     // canvas row of the layer baseline
    const m = mtn[L];
    const u0 = Math.floor(x0 * pxk[L]) + 5000 * L;
    const cs = css(c), cc = css(cap), cca = css(mix(cap, c, 0.45));
    const shadeCol = `rgba(${(c[0] * 0.5) | 0},${(c[1] * 0.55) | 0},${Math.min(255, c[2] * 0.75) | 0},0.34)`;
    const litCol = `rgba(255,255,255,0.09)`;
    for (let i = 0; i < w; i++) {
      const u = (((u0 + i) % NS) + NS) % NS, un = (u + 3) % NS, up = (u + NS - 3) % NS;
      const hgt = m[u] * amp[L];
      const top = yShift - hgt;
      if (top >= h) continue;
      const slope = m[un] - m[up];
      const y1 = Math.max(0, Math.floor(top));
      ctx.fillStyle = cs; ctx.fillRect(i, y1, 1, h - y1);
      const face = Math.min(hgt * 0.8, 10 + hgt * 0.45) | 0;
      if (slope > 0.01) { ctx.fillStyle = shadeCol; ctx.fillRect(i, y1, 1, face); }
      else if (slope < -0.01) { ctx.fillStyle = litCol; ctx.fillRect(i, y1, 1, face); }
      if (m[u] > 0.4) {
        const capLen = Math.min(hgt * 0.5, (m[u] - 0.4) * amp[L] * 0.9 + 1);
        ctx.fillStyle = slope > 0.01 ? cca : cc;
        ctx.fillRect(i, y1, 1, Math.max(1, capLen | 0));
      }
    }
    // aerial perspective: fade the lower part of the layer toward the horizon colour
    const hz = ctx.createLinearGradient(0, yShift - amp[L] * 0.5, 0, yShift + 2);
    hz.addColorStop(0, css(hor, 0)); hz.addColorStop(1, css(hor, 0.42 - L * 0.08));
    ctx.fillStyle = hz; ctx.fillRect(0, Math.max(0, yShift - amp[L] * 0.5), w, h);
  }
  // spruce forest silhouette (front-most background layer)
  {
    const pf = 0.55, pyf = 0.85, by = 292 + (camY - 270) * (1 - pyf) - y0;
    const fc = mix([12, 18, 36], [30, 54, 72], day), c = mix(fc, gray, storm * 0.4);
    ctx.fillStyle = css(mix(c, hor, warm * 0.18));
    const u0 = Math.floor(x0 * pf);
    for (let i = 0; i < w; i++) {
      const u = (((u0 + i) % NS) + NS) % NS, hh = forest[u];
      if (hh <= 0) { ctx.fillRect(i, Math.floor(by - 3), 1, h); continue; }
      const top = Math.floor(by - hh);
      if (top < h) ctx.fillRect(i, Math.max(0, top), 1, h);
    }
    // snow dusting on the forest
    ctx.fillStyle = css(mix([70, 90, 120], [210, 226, 244], day), 0.5);
    for (let i = 0; i < w; i += 1) {
      const u = (((u0 + i) % NS) + NS) % NS, hh = forest[u];
      if (hh > 8 && ((u * 7) & 3) === 0) ctx.fillRect(i, Math.floor(by - hh), 1, 1);
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

/** Moon disc minus a shifted shadow disc (spans per row, no background colour needed). */
function crescent(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, shift: number, phase: number) {
  const ri = Math.ceil(r), X = Math.round(cx), Y = Math.round(cy);
  for (let dy = -ri; dy <= ri; dy++) {
    const hw = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy) + 0.25));
    if (phase < 0.06) { ctx.fillRect(X - hw, Y + dy, hw * 2 + 1, 1); continue; }
    // shadow disc centred at +shift
    const sh = Math.sqrt(Math.max(0, r * r - dy * dy));
    const s0 = Math.round(shift - sh), s1 = Math.round(shift + sh);
    // lit = [-hw, hw] minus [s0, s1]
    if (s1 < -hw || s0 > hw) { ctx.fillRect(X - hw, Y + dy, hw * 2 + 1, 1); continue; }
    if (s0 > -hw) ctx.fillRect(X - hw, Y + dy, s0 + hw, 1);
    if (s1 < hw) ctx.fillRect(X + s1 + 1, Y + dy, hw - s1, 1);
  }
}
