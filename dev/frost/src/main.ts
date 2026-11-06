import { W, H, M, mat, dens, bond, idx, inb, generate, START_X, surfaceAt, crates, CELL } from './world';
import { G } from './state';
import { P } from './particles';
import { initHeat, stepHeat, tempAt } from './heat';
import { stepSim } from './sim';
import { initBodies, stepBodies, allBodies, setEngine, engine, spawnStressTest } from './phys';
const bodies = { values: () => allBodies().values(), get size() { return allBodies().size; } };
import { stepStructure } from './structure';
import { pl, stepPlayer, stepBody, resetPlayer, events, PH, PW, die } from './player';
import { TOOLS, tool, inv, usePrimary, useSecondary, idleTool, interact, eat, placeFire, stepFires, ghostMargin, reachPoint, resetTools, bindSound, inReach } from './tools';
import { Renderer } from './render';
import { Input } from './input';
import { UI, HudData } from './ui';
import { Sound } from './audio';

const glCanvas = document.getElementById('gl') as HTMLCanvasElement;
const fx = document.getElementById('fx') as HTMLCanvasElement;
const ctx = fx.getContext('2d')!;
const input = new Input(glCanvas);
const ui = new UI(document.getElementById('ui')!, input);
const sound = new Sound();
bindSound(sound);
let renderer: Renderer;
try { renderer = new Renderer(glCanvas); }
catch (e) { const p = document.createElement('p'); p.style.cssText = 'color:#e8f0f6;background:#0c1420;font:16px system-ui;padding:24px;margin:0;min-height:100%'; p.textContent = 'Игра не смогла запустить графику: ' + ((e as Error).message || e) + '. Нужен браузер с WebGL2 (Chrome, Edge, Safari 15+, Firefox).'; document.body.replaceChildren(p); throw e; }

G.mobile = input.mobile || matchMedia('(pointer: coarse)').matches;
G.quality = G.mobile ? 0 : 1;

let running = false, paused = false, ended = false;
let cssW = 0, cssH = 0, dpr = 1;
function resize() {
  cssW = window.innerWidth; cssH = window.innerHeight; dpr = Math.min(2, window.devicePixelRatio || 1);
  renderer.resize(cssW, cssH, dpr);
  fx.width = Math.round(cssW * dpr); fx.height = Math.round(cssH * dpr);
  fx.style.width = cssW + 'px'; fx.style.height = cssH + 'px';
  // ~24 m wide view on phones, ~30 m on desktop; never less than 9 m tall
  const viewW = G.mobile ? 420 : 560;
  G.cam.zoom = Math.max(cssW / viewW, cssH / 300);
}
window.addEventListener('resize', resize);
resize();

// ---------------- weather & clock ----------------
const SUNRISE = 8.5 * 60, SUNSET = 16.5 * 60;
function weather(dt: number) {
  const t = G.time, day = Math.floor(t / 1440) + 1, m = t % 1440;
  // daylight with civil twilight
  const sun = m < SUNRISE - 40 || m > SUNSET + 40 ? 0 : m < SUNRISE ? (m - (SUNRISE - 40)) / 40 * 0.35 : m > SUNSET ? (1 - (m - SUNSET) / 40) * 0.35 : 0.35 + 0.65 * Math.sin(Math.PI * (m - SUNRISE) / (SUNSET - SUNRISE));
  G.daylight = sun;
  G.sunAngle = (m - SUNRISE) / (SUNSET - SUNRISE) * Math.PI - 0.1;
  // storms: night 2 (day 2 19:00 → day 3 05:00), day 3 13:00 → 17:00
  const T = (d: number, h: number) => (d - 1) * 1440 + h * 60;
  const storms = [[T(2, 19), T(3, 5)], [T(3, 13), T(3, 17.5)]];
  let storm = 0, warn: string | null = null;
  for (const [a, b] of storms) {
    if (t >= a && t <= b) storm = Math.max(storm, Math.min(1, (t - a) / 60, (b - t) / 60));
    else if (t < a && a - t < 150) warn = `Барометр падает: буря через ${Math.ceil((a - t) / 60)} ч`;
  }
  if (storm > 0) warn = 'Буря. Укройся и разведи огонь';
  G.storm += (storm - G.storm) * Math.min(1, dt * 0.5);
  const noise = Math.sin(t * 0.013) * 1.5 + Math.sin(t * 0.0041 + 1) * 2;
  const night = 1 - Math.min(1, sun / 0.35);
  G.ambientT = -23 - 13 * night - (day - 1) * 1.5 + noise - G.storm * 6;
  const gust = Math.sin(G.realTime * 0.7) * 0.6 + Math.sin(G.realTime * 2.3) * 0.3;
  G.wind = (3.5 + 3 * night * 0.3 + G.storm * 13 + gust * (1 + G.storm * 3)) * (1 + 0.2 * Math.sin(t * 0.002));
  G.snowfall = 0.012 + 0.02 * (0.5 + 0.5 * Math.sin(t * 0.003)) + G.storm * 0.09;
  G.moon = 0.55;
  return { day, warn };
}
const clockStr = () => { const m = Math.floor(G.time % 1440); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };

// ---------------- camera & window ----------------
function updateCamera(dt: number, snap = false) {
  const tx = pl.x + pl.face * 30, ty = pl.y - PH * 0.6 - 20;
  const k = snap ? 1 : Math.min(1, dt * 4);
  G.cam.x += (tx - G.cam.x) * k; G.cam.y += (ty - G.cam.y) * k;
  const vw = cssW / G.cam.zoom, vh = cssH / G.cam.zoom;
  G.cam.x = Math.max(vw / 2, Math.min(W - vw / 2, G.cam.x));
  G.cam.y = Math.max(vh / 2, Math.min(H - vh / 2, G.cam.y));
  const mx = vw * 0.5, my = vh * 0.5;
  G.win.x0 = Math.max(1, Math.floor(G.cam.x - vw / 2 - mx)); G.win.x1 = Math.min(W - 2, Math.ceil(G.cam.x + vw / 2 + mx));
  G.win.y0 = Math.max(1, Math.floor(G.cam.y - vh / 2 - my)); G.win.y1 = Math.min(H - 2, Math.ceil(G.cam.y + vh / 2 + my));
}

// ---------------- game lifecycle ----------------
let shake = 0, stats = { built: [] as string[] };
let hintT = 0, hintText: string | null = null, tutorial = 0;
function newGame() {
  generate(20261106 + Math.floor(Math.random() * 1000));
  initHeat(); initBodies(); resetTools();
  G.time = 9 * 60; G.timeScale = 1;
  const sx = START_X; const sy = surfaceAt(sx);
  resetPlayer(sx, sy - 1);
  renderer.invalidate();
  P.n = 0; ended = false; paused = false; tutorial = 0;
  updateCamera(0, true);
  // pre-warm weather / heat
  for (let k = 0; k < 30; k++) { weather(0.1); stepHeat(0.1); }
}

function hint(): string | null {
  if (tool.msg) { const m = tool.msg; if (hintT <= 0) { hintText = m; hintT = 3.2; tool.msg = ''; } }
  if (hintT > 0) return hintText;
  const mob = G.mobile;
  if (tutorial === 0) return mob ? 'Стик слева: идти. Коснись снега справа и держи: копать лопатой' : 'A/D идти, Shift бежать. Зажми ЛКМ на снегу: копать лопатой';
  if (tutorial === 1) return mob ? '«Положить»: бросить снег из лопаты туда, куда целишься' : 'ПКМ: бросить снег из лопаты туда, куда целишься';
  if (tutorial === 2) return 'Найди ящики под оранжевыми вешками. Там еда и спички';
  if (pl.core < 35.5 && G.fires.length === 0) return 'Ты замерзаешь. Уйди от ветра в укрытие и разведи костёр (6)';
  if (pl.wet > 0.4) return 'Одежда мокрая и плохо греет. Посуши её у огня';
  return null;
}

// ---------------- draw player & overlays (2D canvas) ----------------
// The character is rasterised in software at cell resolution (1 sprite px = 1 world cell), outlined and rim-lit,
// then blitted with smoothing off so it stays pixel-crisp next to the cell world.
type C3 = [number, number, number];
const SPW = 112, SPH = 104, SOX = 56, SOY = 76;
const spCanvas = document.createElement('canvas'); spCanvas.width = SPW; spCanvas.height = SPH;
const spCtx = spCanvas.getContext('2d')!;
const spImg = spCtx.createImageData(SPW, SPH);
const spBuf = new Uint32Array(spImg.data.buffer);
const spC = (r: number, g: number, b: number) => (255 << 24) | (Math.min(255, b | 0) << 16) | (Math.min(255, g | 0) << 8) | Math.min(255, r | 0);
const PAL = {
  parka: [138, 78, 54] as C3, parkaHi: [166, 98, 68] as C3, parkaSh: [106, 58, 40] as C3, hem: [84, 44, 32] as C3, quilt: [118, 66, 46] as C3,
  trouser: [52, 58, 72] as C3, trouserB: [38, 43, 56] as C3,
  felt: [128, 112, 96] as C3, feltHi: [156, 140, 120] as C3, sole: [40, 34, 32] as C3,
  mitt: [88, 66, 48] as C3, mittHi: [118, 92, 66] as C3,
  fur: [214, 204, 184] as C3, furHi: [240, 234, 220] as C3, furLo: [160, 148, 128] as C3,
  skin: [222, 170, 140] as C3, scarf: [78, 98, 132] as C3, pack: [84, 94, 70] as C3, packHi: [104, 116, 86] as C3, strap: [46, 52, 40] as C3,
  wood: [148, 108, 70] as C3, woodSh: [108, 78, 50] as C3, steel: [170, 182, 194] as C3, steelHi: [226, 234, 242] as C3, steelSh: [104, 116, 128] as C3,
  outline: [12, 16, 26] as C3,
};
let sL: C3 = [1, 1, 1], spF = 1, spJx = 0, spBob = 0, spLean = 0, spDrop = 0;
const lc = (c: C3, k = 1) => spC(c[0] * sL[0] * k, c[1] * sL[1] * k, c[2] * sL[2] * k);
function spPut(ax: number, ay: number, col: number) {
  const x = SOX + ax | 0, y = SOY + ay | 0;
  if (x < 0 || y < 0 || x >= SPW || y >= SPH) return;
  spBuf[y * SPW + x] = col;
}
/** facing-relative rect (x forward, y up negative). tier 1 = upper body: bobs, leans and drops with the pose. */
function spR(x0: number, y0: number, w: number, h: number, col: number, tier = 1) {
  for (let yy = y0; yy < y0 + h; yy++) {
    const sh = tier ? Math.round(spLean * Math.max(0, Math.min(1.15, (-yy - 12) / 24))) : 0;
    const ay = yy + (tier ? spDrop + spBob : 0);
    const lx = x0 + sh;
    const ax = spF > 0 ? lx : -(lx + w);
    for (let xx = 0; xx < w; xx++) spPut(ax + xx + spJx, ay, col);
  }
}
function spDisc(cx: number, cy: number, r: number, col: number, tier = 1) {
  const ri = Math.ceil(r);
  for (let dy = -ri; dy <= ri; dy++) {
    const dx = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy) + 0.25));
    spR(Math.round(cx) - dx, Math.round(cy) + dy, dx * 2 + 1, 1, col, tier);
  }
}
/** thick line in absolute (not mirrored) sprite coordinates */
function spLine(x0: number, y0: number, x1: number, y1: number, th: number, col: number) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.5));
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
    for (let dy = 0; dy < th; dy++) for (let dx = 0; dx < th; dx++) spPut(Math.round(x - th / 2 + 0.5) + dx + spJx, Math.round(y - th / 2 + 0.5) + dy, col);
  }
}
const hash1 = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

/** Tool silhouettes sampled in tool space (u along the shaft from the hand, v across; base units, drawn x1.3). */
function toolSample(id: string, u: number, v: number, load: number): number {
  const W_ = PAL.wood, WS = PAL.woodSh;
  const inR = (a: number, b: number, c: number, d: number) => u >= a && u < b && v >= c && v < d;
  switch (id) {
    case 'shovel':
      if (inR(-3.6, -1.8, -2.4, 2.4) && !(v > -1.2 && v < 1.2 && u > -3.2)) return lc(W_);        // D-grip
      if (inR(-3.6, 0.2, -2.4, -1.2) || inR(-3.6, 0.2, 1.2, 2.4)) return lc(W_);
      if (inR(-1.8, 16, -0.8, 0.8)) return lc(v > 0.1 ? WS : W_);                                  // shaft
      if (inR(15, 18.5, -1.5, 1.5)) return lc(PAL.steelSh);                                         // socket
      if (u >= 18.5 && u < 29) {                                                                    // spade blade, tapering to a rounded tip
        const hw = 3.6 - Math.max(0, u - 24.5) * 0.75;
        if (hw > 0.4 && v >= -hw && v < hw) return lc(v < -hw + 1.1 ? PAL.steelHi : v > hw - 1.1 ? [74, 88, 104] as C3 : [118, 134, 152] as C3, 1 - (u - 18.5) * 0.01);
      }
      if (load > 0 && u > 19 && u < 28 && v < -3.2 && v > -3.2 - (1.2 + load * 4.4) * Math.sin((u - 19) / 9 * Math.PI)) return lc([238, 244, 252] as C3);
      return 0;
    case 'saw': {
      if (inR(-1, 5.5, -1.7, 1.7)) return lc([48, 46, 52] as C3);                                   // handle
      if (inR(5.5, 7.4, -7.6, 1.5) || inR(25.6, 27.5, -7.6, 1.5)) return lc([196, 98, 44] as C3);   // bow uprights
      if (inR(5.5, 27.5, -7.6, -6.2)) return lc([214, 112, 52] as C3);                             // bow bar
      if (inR(7.4, 25.6, 0, 1.4)) return lc(PAL.steelHi);                                           // blade
      if (inR(7.4, 25.6, 1.4, 2.8) && Math.floor(u * 1.25) % 2 === 0) return lc(PAL.steel);        // teeth
      if (inR(-1, 5.5, -1.7, -0.7)) return lc([78, 74, 84] as C3);
      return 0;
    }
    case 'axe': {
      if (inR(-2.4, 19, -0.9, 0.9)) return lc(v > 0.05 ? WS : W_);                                  // haft
      if (inR(-2.4, -0.4, -1.3, 1.3)) return lc(WS);                                                // knob
      if (u >= 12 && u < 22) {                                                                      // poll, cheek, flared bit
        const top = u < 14.5 ? -2.2 : u < 17 ? -2.4 : -2.4 - (u - 17) * 0.95;
        const bot = u < 14.5 ? 2.2 : u < 17 ? 2.4 : 2.4 + (u - 17) * 0.75;
        if (v >= top && v <= bot) {
          if (u > 21) return lc(PAL.steelHi);                                                       // cutting edge
          if (u < 14.5) return lc([70, 80, 92] as C3);                                              // poll
          return lc(v < -0.2 ? [132, 146, 160] as C3 : [88, 100, 114] as C3);
        }
      }
      return 0;
    }
    case 'beam':
      if (inR(-1, 17, -2.8, 2.8)) { const bark = Math.floor(v * 2 + Math.floor(u * 0.7)) % 3 === 0; return lc(bark ? [104, 72, 44] as C3 : [138, 100, 62] as C3, v < -1.2 ? 1.15 : v > 1.6 ? 0.82 : 1); }
      if (inR(17, 18.4, -2.4, 2.4)) return lc([214, 176, 122] as C3);
      return 0;
    case 'block':
      if (inR(1, 13, -5, 5)) return lc(u > 11.2 || v > 3.6 ? [168, 190, 214] as C3 : v < -3.6 || u < 2.6 ? [246, 250, 255] as C3 : [226, 236, 248] as C3);
      return 0;
    default:
      if (inR(-1, 9, -0.8, 0.8)) return lc(W_);
      if (inR(9, 11.2, -1.4, 1.4)) return lc([255, 130, 50] as C3, 1.3);
      return 0;
  }
}

let deadAt = -1;
function drawPlayer(aim: [number, number] | null, shakeX: number, shakeY: number) {
  const x = pl.x, y = pl.y, t = G.realTime;
  // ---- lighting on the character ----
  const sh = pl.shelter;
  const dayK = G.daylight * (1 - 0.5 * sh);
  const base = 0.58 + 0.42 * dayK;
  let fk = 0, nf: typeof G.fires[number] | null = null, nfd = 1e9;
  for (const f of G.fires) if (f.lit) { const d = Math.hypot(f.x - x, f.y - 6 - y); if (d < nfd) { nfd = d; nf = f; } fk += Math.pow(Math.max(0, 1 - d / 240), 1.3); }
  fk = Math.min(1, fk);
  sL = [Math.min(1.15, base * 0.94 + 0.5 * fk), Math.min(1.15, base * 0.99 + 0.26 * fk), Math.min(1.15, base * 1.06 + 0.04 * fk)];
  // ---- pose ----
  let vf = pl.face;
  if (aim && pl.alive && Math.abs(aim[0] - x) > 3) vf = aim[0] > x ? 1 : -1;
  spF = vf;
  const moving = pl.alive && pl.onGround && Math.abs(pl.vx) > 4;
  const ph = pl.walkPhase * Math.PI * 2;
  const amt = Math.min(1, Math.abs(pl.vx) / 22);
  const working = pl.alive && pl.work > 0;
  if (pl.alive) deadAt = -1; else if (deadAt < 0) deadAt = t;
  const dT = pl.alive ? 0 : t - deadAt, kneel = Math.min(1, dT / 0.55), slump = Math.max(0, Math.min(1, (dT - 0.5) / 1.0));
  const q = Math.floor(t * 24), jr = (k: number) => hash1(q * 3.1 + k) - 0.5;
  spJx = pl.alive && pl.shiver > 0.05 ? Math.round(jr(1) * 2.2 * pl.shiver) : 0;
  spBob = moving && Math.abs(Math.sin(ph)) > 0.72 ? 1 : 0;
  spLean = (moving && Math.abs(pl.vx) > 40 ? 2 : working ? 1 : 0) + Math.round(kneel * 2 + slump * 14);
  spDrop = Math.round(kneel * 5 + slump * 6);
  if (pl.alive && !pl.onGround) spBob = pl.vy < 0 ? -1 : 0;
  spBuf.fill(0);
  const dim = (c: C3, k: number): C3 => [c[0] * k, c[1] * k, c[2] * k];
  // ---- back arm (limp / swinging), behind the torso ----
  const shY = -24 + spBob + spDrop, shX = vf * 0.5;
  const swingB = pl.alive ? Math.sin(ph + Math.PI) * 0.6 * amt : 0.15;
  const armL = 9;
  {
    const a = Math.PI / 2 + (pl.alive ? swingB * vf : 0.5 * vf * kneel + 0.6 * vf * slump);
    const sxp = -vf * 3 + (spLean ? vf * Math.round(spLean * 0.5) : 0);
    const hx = sxp + Math.cos(a) * armL * 0.95, hy = shY + Math.sin(a) * armL * 0.95;
    spLine(sxp, shY, hx, hy, 3, lc(PAL.parkaSh));
    spLine(hx, hy, hx + Math.cos(a) * 3, hy + Math.sin(a) * 3, 3, lc(PAL.mitt));
  }
  // ---- backpack ----
  spR(-9, -29, 5, 12, lc(PAL.pack)); spR(-9, -29, 5, 2, lc(PAL.packHi)); spR(-8, -23, 3, 1, lc(PAL.strap)); spR(-10, -17, 6, 2, lc([108, 90, 62] as C3));
  // ---- legs & felt boots ----
  const kneeling = kneel > 0.01;
  if (!kneeling) {
    for (let i = 0; i < 2; i++) {
      const front = i === 0;
      const sw = pl.alive ? (pl.onGround ? Math.sin(ph + i * Math.PI) * amt : (front ? 0.7 : -0.5)) : 0;
      const lift = pl.onGround ? Math.max(0, -Math.cos(ph + i * Math.PI)) * amt * 2.2 : 1;
      const lx = Math.round(sw * 3.4) + (front ? 1 : -2), ly = Math.round(lift);
      const trs = front ? PAL.trouser : PAL.trouserB;
      spR(lx - 1, -16, 5, 12 - ly, lc(trs), 0);
      spR(lx - 2, -5 - ly, 8, 4, lc(front ? PAL.felt : dim(PAL.felt, 0.82)), 0);        // felt boot
      spR(lx - 2, -5 - ly, 5, 1, lc(front ? PAL.feltHi : PAL.felt), 0);                   // turned-down rim
      spR(lx - 2, -1 - ly, 9, 1, lc(PAL.sole), 0);
      if (pl.snowshoes) { spR(lx - 6, 0 - ly, 15, 1, lc(PAL.wood), 0); spR(lx - 5, -1 - ly, 1, 1, lc(PAL.woodSh), 0); spR(lx + 7, -1 - ly, 1, 1, lc(PAL.woodSh), 0); }
    }
  } else {
    const kx = Math.round(-slump * 1);
    spR(-12 + kx, -4, 11, 4, lc(PAL.trouserB), 0);                                         // shin on the snow
    spR(-16 + kx, -5, 5, 4, lc(PAL.felt), 0); spR(-16 + kx, -1, 5, 1, lc(PAL.sole), 0);    // boot sole up
    spR(-2 + kx, -13, 6, 12, lc(PAL.trouser), 0);                                          // thigh, knee down
    spR(2 + kx, -3, 5, 3, lc(PAL.felt), 0);
  }
  // ---- parka ----
  const topY = -29, hemY = -14;
  for (let yy = topY; yy <= hemY; yy++) {
    const fl = yy > -19 ? Math.round((yy + 19) * 0.22) : 0;                                 // flared hem
    const wf = 6 + fl, wb = 5 + fl;
    const tt = (yy - topY) / (hemY - topY);
    let c = tt < 0.18 ? PAL.parkaHi : tt > 0.84 ? PAL.hem : PAL.parka;
    spR(-wb, yy, wb + wf, 1, lc(c));
    spR(-wb, yy, 2, 1, lc(PAL.parkaSh));                                                    // back shade
    if (tt > 0.18 && tt < 0.84) spR(wf - 2, yy, 2, 1, lc(PAL.parkaHi, 0.92));              // lit chest edge
  }
  for (const qy of [-26, -22]) spR(-5, qy, 11, 1, lc(PAL.quilt));                           // quilted seams
  spR(-5, -19, 12, 1, lc([52, 36, 28] as C3));                                              // belt
  spR(1, -19, 2, 1, lc([196, 170, 110] as C3));                                             // buckle
  spR(0, -28, 1, 13, lc(PAL.parkaSh, 1.05));                                                // zip
  if (pl.snowOn > 0.05) { const c = lc([242, 248, 255] as C3); spR(-5, topY, 10, 1, c); if (pl.snowOn > 0.4) { spR(-3, topY - 1, 6, 1, c); spR(-6, -14, 12, 1, c); } }
  // ---- hood, fur ruff, face ----
  const hy0 = -32;
  spDisc(-0.5, hy0, 5.3, lc(PAL.parka));
  spDisc(-2.5, hy0 + 1, 3.2, lc(PAL.parkaSh));
  const fcx = 3, fcy = hy0 + 0.5;
  const cold = Math.max(0, Math.min(1, (36.6 - pl.core) / 3));
  const skin = mix3c(PAL.skin, [196, 160, 160] as C3, cold);
  for (let dy = -7; dy <= 7; dy++) for (let dx = -8; dx <= 6; dx++) {
    const px = Math.round(fcx) + dx, py = Math.round(fcy) + dy;
    const ei = Math.hypot(dx / 2.3, dy / 3.1), eo = Math.hypot(dx / 5.3, dy / 5.7);
    if (eo > 1) continue;
    if (ei < 1) { spR(px, py, 1, 1, lc(dx > 1 ? dim(skin, 0.88) : skin)); continue; }
    const hsh = hash1(px * 7.3 + py * 13.1);
    spR(px, py, 1, 1, lc(hsh > 0.7 ? PAL.furHi : hsh < 0.26 ? PAL.furLo : PAL.fur));
  }
  spR(Math.round(fcx) + 1, Math.round(fcy) - 1, 1, 1, lc([30, 36, 52] as C3));              // eye
  if (!pl.alive || (pl.shiver > 0.3 && jr(5) > 0.3)) spR(Math.round(fcx) + 1, Math.round(fcy) - 1, 1, 1, lc(skin));   // eyes shut
  spR(Math.round(fcx) + 2, Math.round(fcy), 1, 1, lc([226, 130, 120] as C3));               // red nose
  spR(-3, -28, 9, 2, lc(PAL.scarf)); spR(-3, -28, 9, 1, lc(PAL.scarf, 1.2));                // scarf
  // frozen breath rime on the ruff
  if (G.ambientT < -20) { spR(Math.round(fcx) + 2, Math.round(fcy) + 3, 2, 1, lc(PAL.furHi)); }
  // ---- aim arm + tool ----
  if (pl.alive) {
    const sx = shX + (spLean ? vf * Math.round(spLean * 0.6) : 0), sy = shY;
    const worldSx = x + sx + spJx, worldSy = y + sy;
    let ang = vf > 0 ? 0.55 : Math.PI - 0.55;
    if (aim) ang = Math.atan2(aim[1] - worldSy, aim[0] - worldSx);
    const id = TOOLS[tool.cur].id;
    let tr = 0, raise = 0;
    if (working) {
      if (id === 'shovel') { const s = Math.sin(t * 15); tr = s * 2.2; raise = (0.5 + 0.5 * s) * 0.5 - 0.15; }
      else if (id === 'saw') { tr = Math.sin(t * 17) * 4; }
      else if (id === 'axe') { const u = (t * 2.6) % 1; raise = u < 0.7 ? -0.1 + 1.25 * (u / 0.7) : 1.15 - 1.5 * ((u - 0.7) / 0.3); }
      else { tr = Math.sin(t * 12) * 1.2; }
    } else if (!aim) raise = Math.sin(t * 1.8) * 0.03;
    if (pl.shiver > 0.05) raise += jr(9) * 0.07 * pl.shiver;
    const a2 = ang - vf * raise;
    const dx = Math.cos(a2), dy = Math.sin(a2);
    const hx = sx + dx * (armL + tr), hy = sy + dy * (armL + tr);
    spLine(sx, sy, hx - dx * 1, hy - dy * 1, 3, lc(PAL.parka));
    spLine(sx, sy, sx + dx * 4, sy + dy * 4, 3, lc(PAL.parkaHi, 0.96));
    // tool (inverse-sampled so rotated shapes stay pixel-solid)
    const sc = 1.3, flipY = dx < 0 ? -1 : 1, R = 40;
    const load = id === 'shovel' ? Math.min(1, tool.load / 46) : 0;
    for (let py = -R; py <= R; py++) for (let px = -R; px <= R; px++) {
      const rx = px + 0.5, ry = py + 0.5;
      const u = (rx * dx + ry * dy) / sc, v = (-rx * dy + ry * dx) / sc * flipY;
      if (u < -4.5 || u > 30 || v < -9 || v > 6) continue;
      const col = toolSample(id, u, v, load);
      if (col) spPut(Math.round(hx) + px, Math.round(hy) + py, col);
    }
    // mitten over the grip
    spLine(hx - dx * 2, hy - dy * 2, hx + dx * 1, hy + dy * 1, 3, lc(PAL.mitt));
    spPut(Math.round(hx - dx * 2 - dy), Math.round(hy - dy * 2 + dx), lc(PAL.mittHi));
  } else {
    const a = Math.PI / 2 - vf * (0.2 + 0.9 * slump);
    const sxp = vf * 1 + vf * Math.round(spLean * 0.6), sy = shY;
    spLine(sxp, sy, sxp + Math.cos(a) * armL, sy + Math.sin(a) * armL, 3, lc(PAL.parka));
    spLine(sxp + Math.cos(a) * armL, sy + Math.sin(a) * armL, sxp + Math.cos(a) * (armL + 3), sy + Math.sin(a) * (armL + 3), 3, lc(PAL.mitt));
  }
  // ---- outline + rim light ----
  const N = SPW * SPH;
  const src = spBuf.slice();
  const filled = (i: number) => (src[i] >>> 24) !== 0;
  const oc = spC(PAL.outline[0], PAL.outline[1], PAL.outline[2]);
  // rim colour and direction
  let rimLx = 0, rimStr = 0, rimWarm = false;
  if (nf && nfd < 260) { rimLx = Math.abs(nf.x - x) < 4 ? 0 : nf.x > x ? 1 : -1; rimStr = Math.min(1, 0.3 + (1 - nfd / 260) * 1.1); rimWarm = true; }
  const tod = ((G.time / 60) % 24 + 24) % 24;
  const skyX = G.daylight > 0.25 ? Math.sign(12.5 - tod) || 1 : Math.sign(0.5 - Math.max(0, Math.min(1, ((tod - 17 + 24) % 24) / 14))) || -1;
  const skyStr = 0.28 + 0.2 * (1 - G.daylight);
  const rw: C3 = rimWarm ? [255, 168, 86] : [168, 200, 255];
  for (let y = 1; y < SPH - 1; y++) for (let x2 = 1; x2 < SPW - 1; x2++) {
    const i = y * SPW + x2;
    if (!filled(i)) {
      if (filled(i - 1) || filled(i + 1) || filled(i - SPW) || filled(i + SPW)) spBuf[i] = oc;
      continue;
    }
    let rs = 0, wr = false;
    if (rimWarm && rimLx !== 0 && !filled(i + rimLx)) { rs = rimStr; wr = true; }
    else if (rimWarm && rimLx === 0 && !filled(i - SPW)) { rs = rimStr; wr = true; }
    if (!wr || rs < 0.5) {
      const c2 = !filled(i + skyX) ? skyStr : !filled(i - SPW) ? skyStr * 0.6 : 0;
      if (c2 > rs) { rs = c2; wr = false; }
    }
    if (rs > 0) {
      const cc = wr ? rw : [168, 200, 255] as C3;
      const p = src[i], pr = p & 255, pg = (p >> 8) & 255, pb = (p >> 16) & 255;
      const k = Math.min(0.8, rs * 0.75);
      spBuf[i] = spC(pr + (cc[0] - pr) * k, pg + (cc[1] - pg) * k, pb + (cc[2] - pb) * k);
    }
  }
  void N;
  spCtx.putImageData(spImg, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(spCanvas, Math.round(x) - SOX + shakeX, Math.round(y) - SOY + shakeY);
}
const mix3c = (a: C3, b: C3, t: number): C3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function drawOverlay(aim: [number, number] | null) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, fx.width, fx.height);
  const s = G.cam.zoom * dpr;
  ctx.setTransform(s, 0, 0, s, (cssW / 2 - G.cam.x * G.cam.zoom) * dpr + (Math.random() - 0.5) * shake * dpr, (cssH / 2 - G.cam.y * G.cam.zoom) * dpr + (Math.random() - 0.5) * shake * dpr);
  ctx.imageSmoothingEnabled = false;
  drawPlayer(aim, 0, 0);
  // aim reticle & ghost (dark under-stroke so they read on white snow)
  if (aim && pl.alive) {
    const [ax, ay] = reachPoint(aim[0], aim[1]);
    const id = TOOLS[tool.cur].id;
    const px = 1 / G.cam.zoom;                 // one screen pixel in world cells
    const dark = 'rgba(8,14,26,0.78)';
    if (id === 'block' || id === 'beam') {
      const g = ghostMargin(id === 'beam' ? 'beam' : 'block', ax, ay);
      const have = id === 'beam' ? inv.logs > 0 : inv.blocks.length > 0;
      const mg = g.blocked ? 0 : g.margin;
      const rgb = !have || g.blocked || mg <= 0.02 ? '255,92,60' : mg < 0.35 ? '255,190,70' : '110,230,150';
      ctx.fillStyle = `rgba(${rgb},0.35)`; ctx.fillRect(g.x0, g.y0, g.w, g.h);
      ctx.lineWidth = px * 1.2; ctx.strokeStyle = dark; ctx.strokeRect(g.x0 - px * 1.1, g.y0 - px * 1.1, g.w + px * 2.2, g.h + px * 2.2);
      ctx.lineWidth = px * 1.6; ctx.strokeStyle = `rgba(${rgb},0.95)`; ctx.strokeRect(g.x0, g.y0, g.w, g.h);
    } else if (id === 'saw') {
      const vert = tool.rot % 2 === 1; const w = vert ? 5 : 10, h = vert ? 10 : 5;
      const rx = Math.round(ax - w / 2), ry = Math.round(ay - h / 2);
      ctx.setLineDash([]); ctx.lineWidth = px * 3; ctx.strokeStyle = dark; ctx.strokeRect(rx, ry, w, h);
      ctx.lineWidth = px * 1.5; ctx.strokeStyle = 'rgba(214,234,255,0.95)'; ctx.setLineDash([1.4, 1]); ctx.strokeRect(rx, ry, w, h); ctx.setLineDash([]);
      if (tool.sawT > 0) { const f = Math.min(1, tool.sawT / 1.6); ctx.fillStyle = dark; ctx.fillRect(rx - px, ry - 2.6, w + px * 2, 1.4); ctx.fillStyle = 'rgba(255,200,120,0.95)'; ctx.fillRect(rx, ry - 2.3 + 0, w * f, 0.8); }
    } else {
      const r = id === 'shovel' ? 4.5 : 2.5, near = inReach(aim[0], aim[1]);
      ctx.lineWidth = px * 3; ctx.strokeStyle = near ? dark : 'rgba(8,14,26,0.45)';
      ctx.beginPath(); ctx.arc(ax, ay, r, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = px * 1.5; ctx.strokeStyle = near ? 'rgba(240,248,255,0.95)' : 'rgba(235,244,255,0.5)';
      ctx.beginPath(); ctx.arc(ax, ay, r, 0, Math.PI * 2); ctx.stroke();
    }
  }
  // crate pole flags flutter (cheap)
  for (const c of crates) {
    if (c.opened) continue;
    const sx = c.x + 3; let sy = c.y; while (sy > 0 && mat[idx(sx, sy - 1)] === M.POLE) sy--;
    if (Math.abs(sx - G.cam.x) > cssW / G.cam.zoom) continue;
    const wv = Math.sin(G.realTime * 6 + c.x) * 1.5;
    ctx.fillStyle = 'rgba(255,110,40,0.95)';
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + 7 * Math.sign(G.wind || 1), sy + 2 + wv * 0.3); ctx.lineTo(sx, sy + 4); ctx.fill();
  }
}

// ---------------- main loop ----------------
let last = performance.now(), fpsAcc = 0, fpsN = 0, fps = 60, lowFpsT = 0;
let aimWorld: [number, number] | null = null;
let waitToggle = false;
function frame(now: number) {
  requestAnimationFrame(frame);
  let dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 1) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; if (fps < 40 && G.quality === 1) { lowFpsT++; if (lowFpsT > 3) { G.quality = 0; resize(); } } else lowFpsT = 0; }
  const s = input.state;
  if (s.pausePressed && running && !ended) { paused = !paused; if (paused) ui.showPause(() => { paused = false; ui.hide(); }, () => { ui.hide(); newGame(); }); else ui.hide(); }
  const portraitPause = input.mobile && window.innerHeight > window.innerWidth; // touch device held upright: sim waits
  if (!running || paused || portraitPause) { input.endFrame(); renderer.render(dt); drawOverlay(null); return; }
  if (ended) { // after win/death: world keeps living in the background but ignores game input
    G.realTime += dt; G.frame++; updateCamera(dt); stepHeat(dt); stepSim(dt); stepBodies(dt); input.endFrame(); renderer.render(dt); drawOverlay(null); return;
  }
  G.realTime += dt; G.frame++;
  // waiting (time compression) only when calm: not moving, sheltered or by a fire
  if (s.waitHeld !== waitToggle) waitToggle = s.waitHeld;
  const canWait = pl.alive && Math.abs(s.moveX) < 0.1 && !s.primary;
  G.timeScale += ((waitToggle && canWait ? 12 : 1) - G.timeScale) * Math.min(1, dt * 3);
  G.time += dt * G.timeScale;
  const { day, warn } = weather(dt);
  // aim
  if (s.hasAim) aimWorld = renderer.screenToWorld(s.aimX, s.aimY);
  // tools
  if (s.toolSelect >= 0 && s.toolSelect < TOOLS.length) { tool.cur = s.toolSelect; sound.uiClick(); }
  if (s.rotatePressed) { tool.rot++; sound.uiClick(); }
  if (s.xrayPressed) { G.xray = (G.xray + 1) % 4; (ui as any).setXray?.(G.xray); }
  let working = false;
  if (pl.alive) {
    if (s.primary && aimWorld) { usePrimary(aimWorld[0], aimWorld[1], dt); working = true; if (tutorial === 0 && tool.load > 0) tutorial = 1; }
    else idleTool(dt);
    if (s.secondaryPressed && aimWorld) { useSecondary(aimWorld[0], aimWorld[1]); if (tutorial === 1) tutorial = 2; }
    if (s.interactPressed) { if (!interact()) sound.uiDeny(); else if (tutorial === 2) tutorial = 3; }
    if (s.eatPressed) eat();
    if (s.firePressed && aimWorld) placeFire(aimWorld[0], aimWorld[1]);
  }
  stepPlayer({ moveX: s.moveX, jump: s.jump, run: s.run, working, dt });
  for (const st of events.steps) sound.footstep(st.dens, tempAt(pl.x | 0, pl.y | 0), st.run, st.sink);
  if (events.landed > 120) { sound.thump(80); shake = 1; }
  stepBody(dt, Math.abs(s.moveX), s.run);
  // world
  updateCamera(dt);
  stepFires(dt);
  stepHeat(dt);
  stepSim(dt);
  const br = stepBodies(dt);
  for (const im of br.impacts) { if (im.massKg > 20 && Math.abs(im.x - pl.x) < 300) { sound.thump(im.massKg); shake = Math.min(3, shake + im.massKg / 200); } }
  const sr = stepStructure(dt);
  if (sr.collapsed > 30) { sound.collapse(Math.min(1, sr.collapsed / 400)); shake = Math.min(3, shake + 0.8); }
  shake *= Math.pow(0.02, dt);
  // falling slab / log hitting the player
  // (bodies stamped over the player's head push the player down via collision; heavy impact = injury → cold)
  // lights
  G.lights.length = 0;
  for (const f of G.fires) if (f.lit && G.lights.length < 8) G.lights.push({ x: f.x, y: f.y - 5, r: 240, power: f.power / 4200 * 1.4 * (0.9 + 0.06 * Math.sin(G.realTime * 11 + f.id * 2.7) + Math.random() * 0.08), color: [1, 0.62, 0.32] });
  // audio ambient
  let fireNear = 0; for (const f of G.fires) if (f.lit) fireNear = Math.max(fireNear, 1 - Math.hypot(f.x - pl.x, f.y - pl.y) / 200);
  sound.update({ wind: Math.abs(pl.wind), exposure: 1 - pl.shelter, storm: G.storm, fire: Math.max(0, fireNear), airTemp: pl.airT, night: 1 - G.daylight, coreTemp: pl.core }, dt);
  // dawn bonus / win
  const nightsSurvived = Math.floor((G.time - 9 * 60 + 15 * 60) / 1440); // count of 08:30 crossings approx
  if (G.time >= 3 * 1440 + 8.5 * 60 && !ended && pl.alive) { ended = true; sound.dawn(); ui.showEnd(true, '', { days: day, hours: Math.round((G.time - 540) / 60), built: [...tool.built] }, () => { ui.hide(); newGame(); }); }
  if (!pl.alive && !ended) { ended = true; sound.death(); setTimeout(() => ui.showEnd(false, pl.cause, { days: day, hours: Math.round((G.time - 540) / 60), built: [...tool.built] }, () => { ui.hide(); newGame(); }), 1400); }
  void nightsSurvived;
  hintT -= dt;
  // HUD
  const h: HudData = {
    core: pl.core, food: pl.food, stamina: pl.stamina, wet: pl.wet,
    airT: pl.airT, feelT: pl.feelT, wind: pl.wind, shelter: pl.shelter,
    day, clock: clockStr(), night: G.daylight < 0.2, warning: warn,
    tool: tool.cur,
    tools: TOOLS.map((t) => ({ id: t.id, name: t.name, key: t.key, enabled: t.id === 'saw' ? inv.saw : true,
      count: t.id === 'beam' ? inv.logs : t.id === 'block' ? inv.blocks.length : t.id === 'fire' ? Math.min(inv.matches, inv.logs, Math.floor(inv.branches / 2)) : undefined })),
    inv: { logs: inv.logs, branches: inv.branches, matches: inv.matches, food: inv.food + inv.crackers, blocks: inv.blocks.length, snowshoes: inv.snowshoes, thermos: inv.thermos },
    hint: hint(), shovelLoad: Math.min(1, tool.load / 46), waiting: G.timeScale > 2,
  };
  ui.update(h);
  input.endFrame();
  renderer.render(dt);
  drawOverlay(aimWorld);
}

ui.onSound = (on) => { sound.init(); sound.setMuted(!on); };

// ---------------- physics engine switch (compare planck vs Rapier) ----------------
async function toggleEngine() { await setEngine(engine === 'rapier' ? 'planck' : 'rapier'); ui.toast('Движок физики: ' + (engine === 'rapier' ? 'Rapier 2D (wasm)' : 'planck.js'), 'info'); }
(ui as any).onEngine = toggleEngine;
(ui as any).onStress = () => spawnStressTest(40, pl.x, pl.y - 140);
window.addEventListener('keydown', (e) => { if (e.repeat || !running || ended) return; if (e.code === 'KeyP') toggleEngine(); if (e.code === 'KeyK') spawnStressTest(40, pl.x, pl.y - 140); });
setInterval(() => { (ui as any).setPhysInfo?.(`${engine === 'rapier' ? 'Rapier 2D' : 'planck.js'} · ${Math.round(fps)} к/с · тел ${allBodies().size}`); }, 500);

async function boot() {
  try { await setEngine('rapier'); } catch (e) { console.warn('Rapier failed, using planck', e); }
  newGame();
  requestAnimationFrame(frame);
  ui.showTitle(() => { sound.init(); running = true; ui.hide(); last = performance.now(); });
}
boot();

// ---------------- debug / test API ----------------
(window as unknown as Record<string, unknown>).__frost = {
  G, pl, inv, tool, bodies, mat, dens, bond, W, H, idx, inb, CELL,
  start: () => { running = true; ui.hide(); },
  setEngine, engine: () => engine, stress: (n: number) => spawnStressTest(n, pl.x, pl.y - 140),
  teleport: (x: number) => { pl.x = x; pl.y = surfaceAt(x) - 1; pl.vy = 0; updateCamera(0, true); },
  give: (k: string, n: number) => { const o = inv as unknown as Record<string, unknown>; if (k === 'blocks') for (let i = 0; i < n; i++) inv.blocks.push(320); else if (typeof o[k] === 'number') o[k] = (o[k] as number) + n; else o[k] = true; },
  setTime: (min: number) => { G.time = min; },
  kill: () => die('тест'),
  // act with a tool at world cell (x,y): primary for `sec` seconds, or one secondary use
  act: (toolId: string, x: number, y: number, secondary = false, sec = 0.5) => {
    const k = TOOLS.findIndex((t) => t.id === toolId); if (k >= 0) tool.cur = k;
    if (secondary) { useSecondary(x, y); return; }
    for (let t = 0; t < sec; t += 1 / 60) usePrimary(x, y, 1 / 60);
  },
  rot: (r: number) => { tool.rot = r; },
  interact: () => interact(),
  eat: () => eat(),
  fps: () => fps,
};
void PW; void dens; void bond;
