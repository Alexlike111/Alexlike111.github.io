import { W, H, M, mat, dens, bond, idx, inb, generate, START_X, surfaceAt, crates, CELL, body, flags, treeId, F_TREE, isGranular } from './world';
import { G, FORCE } from './state';
import { P } from './particles';
import { initHeat, stepHeat, tempAt, surf } from './heat';
import { stepSim, pendingTotal } from './sim';
import { initBodies, stepBodies, allBodies, initPhysics, spawnStressTest } from './phys';
const bodies = { values: () => allBodies().values(), get size() { return allBodies().size; } };
import { stepStructure } from './structure';
import { pl, stepPlayer, stepBody, resetPlayer, events, PH, PW, die } from './player';
import { TOOLS, BEAM_MODES, BEAM_MODE_NAMES, aimTarget, DIG, TILE, setSmart, spoilInFlight, type DigTarget, tool, inv, usePrimary, useSecondary, idleTool, interact, eat, placeFire, stepFires, ghostMargin, reachPoint, resetTools, bindSound, inReach, sawCheck, sawProbe, sawProgress, beamShape, shoulder, REACH, simulateClump, planSpoil, CLUMP_G, CLUMP_LIFE, isTrunkOf, trunkRow, toolHud, beamModesLine } from './tools';
import { plural } from './ru';
import { Renderer } from './render';
import { Input } from './input';
import { UI, HudData, Enclosure } from './ui';
import { Sound } from './audio';
import { prof, pnow, pend } from './prof';
import { createBench, makeReport } from './bench';

const glCanvas = document.getElementById('gl') as HTMLCanvasElement;
const fx = document.getElementById('fx') as HTMLCanvasElement;
const ctx = fx.getContext('2d')!;
const input = new Input(glCanvas);
// Ctrl (PC): the smart cursor on / off; a short tool message says which (touch is always smart)
input.onSmart = (on) => { setSmart(on); tool.msg = on ? 'Умный курсор включён: цель липнет к снегу в пределах 2 м' : 'Умный курсор выключен'; tool.msgSec = 3; };
const ui = new UI(document.getElementById('ui')!, input);
const sound = new Sound();
bindSound(sound);
let renderer: Renderer;
try { renderer = new Renderer(glCanvas); }
catch (e) { const p = document.createElement('p'); p.style.cssText = 'color:#e8f0f6;background:#0c1420;font:16px system-ui;padding:24px;margin:0;min-height:100%'; p.textContent = 'Игра не смогла запустить графику: ' + ((e as Error).message || e) + '. Нужен браузер с WebGL2 (Chrome, Edge, Safari 15+, Firefox).'; document.body.replaceChildren(p); throw e; }

G.mobile = input.mobile || matchMedia('(pointer: coarse)').matches;
// start low on phones and on software / old GPUs; the adaptive controller below walks quality up (touch: the QLADDER steps) or dynamic resolution down (desktop)
G.quality =G.mobile || /swiftshader|llvmpipe|softpipe|software|mali-4|mali-t[0-7]|adreno \(tm\) [2-4]\d\d|powervr (sgx|ge8)/.test(renderer.gpu) ? 0 : 1;

let running = false, paused = false, ended = false;
let cssW = 0, cssH = 0, dpr = 1;
/** bench.ts: render at a different viewport size (phone / desktop) without touching the window */
let vpOverride: { w: number; h: number; dpr: number; mobile: boolean } | null = null;
function resize() {
  cssW = vpOverride ? vpOverride.w : window.innerWidth; cssH = vpOverride ? vpOverride.h : window.innerHeight;
  // touch devices: device pixel ratio capped at 1.5 (screen pass and overlay canvas scale with dpr^2)
  const dprCap = (vpOverride ? vpOverride.mobile : G.mobile) ? 1.5 : 2;
  dpr = Math.min(dprCap, vpOverride ? vpOverride.dpr : (window.devicePixelRatio || 1));
  renderer.resize(cssW, cssH, dpr);
  fx.width = Math.round(cssW * dpr); fx.height = Math.round(cssH * dpr);
  fx.style.width = cssW + 'px'; fx.style.height = cssH + 'px';
  // ~17 m wide view on phones, ~22 m on desktop (zoomed in for readability); never less than 13 m tall
  const viewW = (vpOverride ? vpOverride.mobile : G.mobile) ? 340 : 440;
  G.cam.zoom = Math.max(cssW / viewW, cssH / 260);
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
  if (FORCE.storm === FORCE.storm) G.storm = FORCE.storm;
  const noise = Math.sin(t * 0.013) * 1.5 + Math.sin(t * 0.0041 + 1) * 2;
  const night = 1 - Math.min(1, sun / 0.35);
  G.ambientT = -23 - 13 * night - (day - 1) * 1.5 + noise - G.storm * 6;
  const gust = Math.sin(G.realTime * 0.7) * 0.6 + Math.sin(G.realTime * 2.3) * 0.3;
  G.wind = (3.5 + 3 * night * 0.3 + G.storm * 13 + gust * (1 + G.storm * 3)) * (1 + 0.2 * Math.sin(t * 0.002));
  G.snowfall = 0.012 + 0.02 * (0.5 + 0.5 * Math.sin(t * 0.003)) + G.storm * 0.09;
  if (FORCE.snowfall === FORCE.snowfall) G.snowfall = FORCE.snowfall;
  if (FORCE.wind === FORCE.wind) G.wind = FORCE.wind;
  G.moon = 0.55;
  return { day, warn };
}
const clockStr = () => { const m = Math.floor(G.time % 1440); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };

// ---------------- camera & window ----------------
function updateCamera(dt: number, snap = false) {
  const tx = pl.x + pl.face * 30, ty = pl.y - pl.h * 0.6 - 20;
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
let hintT = 0, hintText: string | null = null, tutorial = 0, tut1At = -1; // tut1At: when step 1 («Снег с лопаты сам летит…») began
let tipCrawlUntil = -1, tipCrawlDone = false, tipDoorUntil = -1, tipDoorDone = false;
function newGame(seed = 20261106 + Math.floor(Math.random() * 1000)) {
  generate(seed);
  initHeat(); initBodies(); resetTools();
  G.time = 9 * 60; G.timeScale = 1;
  const sx = START_X; const sy = surfaceAt(sx);
  resetPlayer(sx, sy - 1);
  renderer.invalidate();
  P.n = 0; ended = false; paused = false; tutorial = 0; tut1At = -1; tipCrawlUntil = tipDoorUntil = -1; tipCrawlDone = tipDoorDone = false;
  tipSeen.clear(); tipShow = null; pitSince = -1; enclNext = 0; enclNow = { st: 'none', ang: null }; pocketNow = new Set();
  updateCamera(0, true);
  // pre-warm weather / heat
  for (let k = 0; k < 30; k++) { weather(0.1); stepHeat(0.1); }
}

/** Tutorial chain: 0 move+dig, 1 throw, 2 find a crate, 3 choose a shelter, 4 fire inside + wait for night, 5 (fire lit) wait. Advances on real events. */
function advanceTutorial() {
  if (tutorial < 5 && tool.built.has('fire')) tutorial = 5;
  else if (tutorial < 3 && crates.some((c) => c.opened)) tutorial = 3;
  else if (tutorial === 3 && (inv.blocks.length > 0 || inv.logs > 0 || tool.built.size > 0 || pl.shelter > 0.7)) tutorial = 4;
}
// ---------------- shelter status: the air pocket around the hero and the pit he stands in (read at 4 Hz) ----------------
const ENCL_CAP = 3000;                                            // air cells searched; a pocket this big with no sky reached reads «большая полость»
const topStamp = new Uint32Array(W), topRow = new Int32Array(W); // per-column cache of topOf(), valid for one reading (topCall)
let topCall = 0;
/** first row of column x that holds anything but air or needles (H when the column is open to the top) */
function topOf(x: number): number {
  if (topStamp[x] === topCall) return topRow[x];
  let y = 0;
  while (y < H && (mat[y * W + x] === M.AIR || mat[y * W + x] === M.NEEDLE)) y++;
  topStamp[x] = topCall; topRow[x] = y;
  return y;
}
/** flood fill over air from the hero's body (nearest cell first). A cell with nothing solid above it in its column is open to the sky:
 *  the first one reached gives the arrow toward the opening; a fill that ends with none is a closed pocket (its cells come back for the fire check). */
function enclosureAt(): { enc: Enclosure; pocket: Set<number> } {
  topCall++;
  const x0 = Math.round(pl.x);
  let s0 = -1;
  for (const yy of [pl.y - pl.h * 0.6, pl.y - pl.h * 0.3, pl.y - 2, pl.y - pl.h + 3]) {   // body centre first, then other parts of the body
    const y = Math.round(yy);
    if (inb(x0, y) && (mat[y * W + x0] === M.AIR || mat[y * W + x0] === M.NEEDLE)) { s0 = y * W + x0; break; }
  }
  if (s0 < 0) return { enc: { st: 'none', ang: null }, pocket: new Set() };
  const sx = s0 % W, sy = (s0 - sx) / W;
  const seen = new Set<number>([s0]), q: number[] = [s0];
  const add = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const j = y * W + x;
    if (seen.has(j) || (mat[j] !== M.AIR && mat[j] !== M.NEEDLE)) return;
    seen.add(j); q.push(j);
  };
  // standing in the open: no arrow. Otherwise the first sky cell proves the pocket open; the search runs on a little longer
  // so the arrow can point at the highest sky cell it reached (the mouth of a shaft or the gap in a roof, not the shaft beside the hero)
  let first = -1, mouth = -1, mouthY = H;
  for (let k = 0; k < q.length; k++) {
    const i = q[k], x = i % W, y = (i - x) / W;
    if (y < topOf(x)) {
      if (i === s0) return { enc: { st: 'open', ang: null }, pocket: seen };
      if (first < 0) first = k;
      if (y < mouthY) { mouthY = y; mouth = i; }
    }
    if (first >= 0 && k - first > 350) break;
    if (first < 0 && q.length > ENCL_CAP) return { enc: { st: 'big', ang: null }, pocket: seen };
    add(x + 1, y); add(x - 1, y); add(x, y + 1); add(x, y - 1);
  }
  if (first >= 0) { const mx = mouth % W, my = (mouth - mx) / W; return { enc: { st: 'open', ang: Math.atan2(my - sy, mx - sx) * 180 / Math.PI }, pocket: seen }; }
  return { enc: { st: 'closed', ang: null }, pocket: seen };
}
/** metres the hero's feet are below the ground within 3 m either side. The ground is the quarter of the columns that stand highest:
 *  a dug pit (and a tree top or a single post) does not lift it, so flat snow reads about 0 and a pit reads its depth */
const pitCols = new Int16Array(121);
function pitDepth(): number {
  const cx = Math.round(pl.x);
  let n = 0;
  for (let x = Math.max(0, cx - 60); x <= Math.min(W - 1, cx + 60); x++) pitCols[n++] = surf[x];
  const ground = pitCols.subarray(0, n).sort();
  return (pl.y + 1 - ground[Math.floor(n / 4)]) * CELL;
}
let enclNow: Enclosure = { st: 'none', ang: null }, pocketNow = new Set<number>(), enclNext = 0;
let pitSince = -1;   // real time the hero first stood at least 1.2 m down in a pit (-1: not in one)
/** shelter readings, throttled to 4 Hz: the enclosure chip, the pocket for the fire check, and how long the hero has stood in a deep pit */
function updateEnclosure() {
  if (G.realTime < enclNext) return;
  enclNext = G.realTime + 0.25;
  const r = enclosureAt();
  enclNow = r.enc; pocketNow = r.pocket;
  pitSince = pl.alive && pitDepth() >= 1.2 ? (pitSince < 0 ? G.realTime : pitSince) : -1;
}
// one-time shelter tips, per game: each shows once, one at a time, while its condition holds (the tip keeps its text on screen for its own time)
const TIP_PIT = 'Землянка: камера и ход не ниже 1,8 м, чтобы встать в полный рост. Шахту накрой брусьями или блоками — тёплый воздух уходит вверх';
const TIP_CLOSED = 'Закрыто. Разведи костёр (6) — станет тепло';
const TIP_IGLOO = 'Иглу: выкопай яму ~1 м, по её краям поставь блоки стоймя в 2 ряда, сверху плоские внахлёст к центру — внутри нужно 1,8 м';
const tipSeen = new Set<string>();
let tipShow: { text: string; until: number } | null = null;
/** the tip on screen, else the first unseen tip whose condition holds now (null = none) */
function shelterTip(): string | null {
  if (tipShow && G.realTime < tipShow.until) return tipShow.text;
  const show = (key: string, text: string): string | null => {
    if (tipSeen.has(key)) return null;
    tipSeen.add(key); tipShow = { text, until: G.realTime + Math.max(5, text.length * 0.08 + 1) };
    return text;
  };
  // a lit fire whose flame air lies inside the pocket
  const fireInPocket = (f: { x: number; y: number }) => { for (let dy = 1; dy <= 3; dy++) for (let dx = -1; dx <= 1; dx++) if (pocketNow.has((Math.round(f.y) - dy) * W + Math.round(f.x) + dx)) return true; return false; };
  if (pitSince >= 0 && G.realTime - pitSince > 5) { const t = show('pit', TIP_PIT); if (t) return t; }
  if (enclNow.st === 'closed' && !G.fires.some((f) => f.lit && fireInPocket(f))) { const t = show('closed', TIP_CLOSED); if (t) return t; }
  const id = TOOLS[tool.cur].id;
  if (id === 'saw' || id === 'block') { const t = show('igloo', TIP_IGLOO); if (t) return t; }
  return null;
}
let hintSig = '', hintLast = '', hintLastT = -99;
/** tool messages: live <= 2.5 s; any successful action (snow dug / thrown, inventory or build change, tool switch) wipes a stale message at once; the same refusal is not repeated for 4 s while a button is held */
function hint(): string | null {
  const sig = `${tool.cur}|${tool.digs}|${inv.logs}|${inv.branches}|${inv.matches}|${inv.food}|${inv.crackers}|${inv.blocks.length}|${tool.built.size}`;
  if (sig !== hintSig) { if (hintSig) { hintT = 0; hintText = null; } hintSig = sig; }
  if (tool.msg) {
    const m = tool.msg, sec = tool.msgSec; tool.msg = ''; tool.msgSec = 2.5;
    if (m !== hintLast || G.realTime - hintLastT > 4) { hintText = m; hintT = sec; hintLast = m; hintLastT = G.realTime; }
  }
  if (hintT > 0 && hintText) return hintText;
  advanceTutorial();
  const mob = G.mobile;
  // one-shot tip: door mode after the first placed beam
  if (!tipDoorDone && tool.built.has('wood')) { tipDoorDone = true; tipDoorUntil = G.realTime + 7; }
  if (G.realTime < tipDoorUntil) return mob ? 'Дверь: на кнопке поворота выбери режим «дверь» — проходима, но держит ветер и тепло' : 'Дверь: нажми R, пока не будет режим «дверь» — проходима, но держит ветер и тепло';
  const shelter = shelterTip();
  if (shelter) return shelter;
  if (tutorial === 0) return mob ? 'Стик слева: идти. Коснись снега справа и держи: копать лопатой' : 'A/D идти, Shift бежать. Зажми ЛКМ на снегу: копать лопатой';
  if (tutorial === 1) return mob ? 'Снег с лопаты сам летит за спину. «Положить» — утрамбовать' : 'Снег с лопаты сам летит за спину. ПКМ — утрамбовать';
  if (tutorial === 2) return mob ? 'Найди ящик под оранжевой вешкой, подкопай и жми «Взять»' : 'Найди ящик под оранжевой вешкой, подкопай к нему и жми E';
  if (tutorial === 3) return 'Укрытие: землянка (копай в сугроб), иглу (пила по насту, ПКМ), дом (топор по ели, 4)';
  if (tutorial === 4) return mob ? 'Разведи костёр в укрытии (кнопка 6) и жди ночь («Ждать»)' : 'Разведи костёр в укрытии (6) и жди ночь (T)';
  if (pl.core < 35.5 && G.fires.length === 0) return 'Ты замерзаешь. Уйди от ветра в укрытие и разведи костёр (6)';
  if (pl.wet > 0.4) return 'Одежда мокрая и плохо греет. Посуши её у огня';
  if (tutorial === 5 && G.daylight > 0.2 && G.fires.length > 0) return mob ? 'Подкидывай брёвна в огонь («Взять»), жди ночь («Ждать»)' : 'Подкидывай брёвна в огонь (E), жди ночь (T)';
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

// Tool colours: module constants (the sampler runs once per pixel of the tool box every frame, so no literals inside it)
const TC = {
  alu: [186, 196, 208] as C3, aluHi: [238, 243, 249] as C3, aluSh: [122, 134, 148] as C3,
  steel: [172, 184, 196] as C3, steelHi: [236, 242, 250] as C3, steelSh: [102, 114, 128] as C3, steelDk: [66, 76, 90] as C3,
  woodHi: [174, 130, 88] as C3, cut: [222, 186, 132] as C3, cutRing: [186, 142, 94] as C3, bark: [104, 72, 44] as C3, barkLt: [138, 100, 62] as C3,
  grip: [52, 50, 56] as C3, hOr: [222, 120, 56] as C3, hOrDk: [168, 80, 34] as C3,
  snow: [226, 236, 248] as C3, snowHi: [246, 250, 255] as C3, snowSh: [166, 188, 212] as C3, snowCut: [196, 212, 232] as C3,
  fOut: [236, 84, 34] as C3, fMid: [255, 150, 56] as C3, fIn: [255, 214, 120] as C3, fCore: [255, 248, 222] as C3,
  white: [238, 244, 252] as C3,
};
let toolCarry = false, toolT = 0;     // set by drawPlayer before the tool is sampled: log carried on the shoulder; time for the flame flicker
/** Tool silhouettes sampled in tool space (u along the tool from the hand, v across; base units, drawn x1.3). */
function toolSample(id: string, u: number, v: number, load: number): number {
  const W_ = PAL.wood, WS = PAL.woodSh;
  const inR = (a: number, b: number, c: number, d: number) => u >= a && u < b && v >= c && v < d;
  switch (id) {
    case 'shovel': {
      // avalanche shovel: D-grip, wood shaft, steel socket, aluminium spade with a rib and a lit rim
      if (inR(-3.8, -1.6, -2.4, 2.4) && !(v > -1.2 && v < 1.2 && u > -3.4)) return lc(W_);
      if (inR(-3.8, 0.2, -2.4, -1.2) || inR(-3.8, 0.2, 1.2, 2.4)) return lc(W_);
      if (inR(-1.6, 15.4, -0.85, 0.85)) return lc(v > 0.2 ? WS : W_);
      if (inR(15, 18.4, -1.7, 1.7)) return lc(TC.steelSh);
      if (u >= 18.4 && u < 29.4) {
        const hw = 3.9 - Math.max(0, u - 24.6) * 0.8;
        if (hw > 0.4 && v >= -hw && v < hw) {
          if (v < -hw + 1) return lc(TC.aluHi);
          if (v > hw - 1) return lc(TC.aluSh);
          if (Math.abs(v) < 0.5 && u > 20.5 && u < 27.5) return lc(TC.aluSh);
          return lc(TC.alu, 1 - (u - 18.4) * 0.01);
        }
      }
      if (load > 0 && u > 19 && u < 28 && v < -3.2 && v > -3.2 - (1.2 + load * 4.4) * Math.sin((u - 19) / 9 * Math.PI)) return lc(TC.white);
      return 0;
    }
    case 'saw': {
      // snow saw: rounded grip at the back, steel blade with a lit spine, sawtooth edge on the lower side, sloped tip
      if (inR(-1.2, 4.6, -2.1, 2.1)) {
        if (inR(0.2, 1.8, -0.5, 0.5)) return 0;
        return lc(v < -0.7 ? TC.hOr : TC.hOrDk);
      }
      if (u >= 4.6 && u < 27) {
        const tipTop = u > 25.2 ? -1.2 + (u - 25.2) * 0.7 : -1.2;
        if (v >= tipTop && v < 1.2) return lc(v < -0.6 ? TC.steelHi : TC.steel);
        const f = ((u - 4.6) % 1.6) / 1.6;                          // one tooth per 1.6 units
        if (v >= 1.2 && v < 1.2 + 1.5 * f && u < 25.6) return lc(f > 0.5 ? TC.steelSh : TC.steelHi);
      }
      return 0;
    }
    case 'axe': {
      // ash haft (lit upper edge), steel head: dark poll, a sheen band, bright bit
      if (inR(-2.4, 19, -0.95, 0.95)) return lc(v < -0.35 ? TC.woodHi : v > 0.45 ? WS : W_);
      if (inR(-2.4, -0.6, -1.4, 1.4)) return lc(WS);                                // knob
      if (u >= 11.6 && u < 22.2) {
        const top = u < 14.5 ? -2.2 : u < 17 ? -2.4 : -2.4 - (u - 17) * 0.95;
        const bot = u < 14.5 ? 2.2 : u < 17 ? 2.4 : 2.4 + (u - 17) * 0.75;
        if (v >= top && v <= bot) {
          if (u > 20.8) return lc(TC.steelHi);                                      // cutting edge catches the light
          if (u < 14.5) return lc(TC.steelDk);                                      // poll
          if (Math.abs(v + 0.4 - (u - 16) * 0.25) < 0.55) return lc(TC.steelHi);    // sheen band across the head
          return lc(v < -0.2 ? TC.steel : TC.steelSh);
        }
      }
      return 0;
    }
    case 'beam': {
      // log: bark sides, cut end with rings. Carried on the shoulder the log runs back from the hand (cut end behind)
      const back = toolCarry;
      if (back && inR(-24.6, -23.2, -2.6, 2.6)) return lc(Math.abs(v) < 1.3 ? TC.cutRing : TC.cut);
      if (inR(back ? -23.2 : -1, back ? 1.6 : 17, -2.8, 2.8)) {
        const bark = Math.floor(v * 2 + Math.floor(u * 0.7)) % 3 === 0;
        return lc(bark ? TC.bark : TC.barkLt, v < -1.2 ? 1.15 : v > 1.6 ? 0.82 : 1);
      }
      if (!back && inR(17, 18.4, -2.4, 2.4)) return lc(TC.cut);
      return 0;
    }
    case 'block': {
      // snow block centred on the hand: lit top, cooler far and lower faces, saw-cut courses on the front, eased corners
      if (inR(-6, 6, -5, 5) && !(Math.abs(u) > 5.2 && Math.abs(v) > 4.2)) {
        if (v < -3.6) return lc(TC.snowHi);
        if (u > 4.2 || v > 3.6) return lc(TC.snowSh);
        if ((v + 5) % 3.2 < 0.9) return lc(TC.snowCut);
        return lc(TC.snow);
      }
      return 0;
    }
    case 'fire': {
      // dry branch held in the hand with a flame tuft at its tip, flickering with toolT
      if (inR(-1, 8.8, -0.85, 0.85)) return lc(v < -0.25 ? TC.woodHi : WS);
      if (u >= 8.4 && u < 17) {
        const k = (u - 8.4) / 8.6;                                   // 0 at the branch end, 1 at the tip
        const sway = Math.sin(toolT * 11 + u * 1.9) * 0.45 * k;
        const hw = 2.7 * Math.pow(Math.max(0, 1 - k), 0.6) * Math.min(1, (k + 0.25) * 2.5);
        const d = Math.abs(v - sway);
        if (d < hw) {
          if (d < hw * 0.38 && k < 0.7) return lc(k < 0.3 && d < 0.8 ? TC.fCore : TC.fIn, 1.25);
          if (d < hw * 0.7) return lc(TC.fMid, 1.2);
          return lc(TC.fOut, 1.15);
        }
      }
      return 0;
    }
    default:
      if (inR(-1, 9, -0.8, 0.8)) return lc(W_);
      if (inR(9, 11.2, -1.4, 1.4)) return lc([255, 130, 50] as C3, 1.3);
      return 0;
  }
}

let deadAt = -1, spCr = 0;
function drawPlayer(aim: [number, number] | null, shakeX: number, shakeY: number) {
  const x = pl.x, y = pl.y, t = G.realTime;
  // ---- lighting on the character ----
  const sh = pl.shelter;
  const dayK = G.daylight * (1 - 0.5 * sh);
  const base = 0.58 + 0.42 * dayK;
  let fk = 0, nf: typeof G.fires[number] | null = null, nfd = 1e9;
  for (const f of G.fires) if (f.lit) { const d = Math.hypot(f.x - x, f.y - 6 - y); if (d < nfd) { nfd = d; nf = f; } fk += Math.pow(Math.max(0, 1 - d / 240), 1.3); }
  fk = Math.min(1, fk);
  // night: starlight on the parka lifts the sprite a little (in the dark it sat at ~55 % and sank into the snow); a cool lift, not a torch
  const nk = Math.max(0, Math.min(1, 1 - G.daylight));
  sL = [Math.min(1.15, base * 0.94 + 0.5 * fk + 0.12 * nk), Math.min(1.15, base * 0.99 + 0.26 * fk + 0.15 * nk), Math.min(1.15, base * 1.06 + 0.04 * fk + 0.2 * nk)];
  // ---- pose ----
  let vf = pl.face;
  if (aim && pl.alive && Math.abs(aim[0] - x) > 3) vf = aim[0] > x ? 1 : -1;
  spF = vf;
  const moving = pl.alive && pl.onGround && Math.abs(pl.vx) > 4;
  const ph = pl.walkPhase * Math.PI * 2;
  const amt = Math.min(1, Math.abs(pl.vx) / 22);
  const working = pl.alive && pl.work > 0;
  const holdBlock = pl.alive && !aim && !working && TOOLS[tool.cur].id === 'block';   // idle with a block: both hands on it
  if (pl.alive) deadAt = -1; else if (deadAt < 0) deadAt = t;
  const dT = pl.alive ? 0 : t - deadAt, kneel = Math.min(1, dT / 0.55), slump = Math.max(0, Math.min(1, (dT - 0.5) / 1.0));
  const q = Math.floor(t * 24), jr = (k: number) => hash1(q * 3.1 + k) - 0.5;
  spJx = pl.alive && pl.shiver > 0.05 ? Math.round(jr(1) * 2.2 * pl.shiver) : 0;
  spBob = moving && Math.abs(Math.sin(ph)) > 0.72 ? 1 : 0;
  spLean = (moving && Math.abs(pl.vx) > 40 ? 2 : working ? 1 : 0) + Math.round(kneel * 2 + slump * 14 + spCr * 6);
  spCr += ((pl.alive && pl.h < PH ? 1 : 0) - spCr) * 0.35;
  spDrop = Math.round(kneel * 5 + slump * 6 + spCr * 13);
  if (pl.alive && !pl.onGround) spBob = pl.vy < 0 ? -1 : 0;
  spBuf.fill(0);
  const dim = (c: C3, k: number): C3 => [c[0] * k, c[1] * k, c[2] * k];
  // ---- back arm (limp / swinging), behind the torso ----
  const shY = -24 + spBob + spDrop, shX = vf * 0.5;
  const swingB = pl.alive ? Math.sin(ph + Math.PI) * 0.6 * amt : 0.15;
  const armL = 9;
  if (!holdBlock) {     // the free arm hangs; with a block held, both hands are drawn after the tool (see below)
    const a = Math.PI / 2 + (pl.alive ? swingB * vf : 0.5 * vf * kneel + 0.6 * vf * slump);
    const sxp = -vf * 3 + (spLean ? vf * Math.round(spLean * 0.5) : 0);
    const hx = sxp + Math.cos(a) * armL * 0.95, hy = shY + Math.sin(a) * armL * 0.95;
    spLine(sxp, shY, hx, hy, 3, lc(PAL.parkaSh));
    spLine(hx, hy, hx + Math.cos(a) * 3, hy + Math.sin(a) * 3, 3, lc(PAL.mitt));
  }
  // ---- backpack ----
  spR(-9, -29, 5, 12, lc(PAL.pack)); spR(-9, -29, 5, 2, lc(PAL.packHi)); spR(-8, -23, 3, 1, lc(PAL.strap)); spR(-10, -17, 6, 2, lc([108, 90, 62] as C3));
  // ---- legs & felt boots ----
  const kneeling = kneel > 0.01 || spCr > 0.5;
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
    const id = TOOLS[tool.cur].id;
    // a log carried on the shoulder: the hand is held level in front and the log runs back over the shoulder
    const carry = id === 'beam' && !aim && !working;
    let ang = vf > 0 ? (carry ? 0.2 : 0.55) : Math.PI - (carry ? 0.2 : 0.55);
    if (aim) ang = Math.atan2(aim[1] - worldSy, aim[0] - worldSx);
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
    const load = 0; // the blade carries no snow: each dug tile is thrown clear at once
    toolCarry = carry; toolT = t;
    for (let py = -R; py <= R; py++) for (let px = -R; px <= R; px++) {
      const rx = px + 0.5, ry = py + 0.5;
      const u = (rx * dx + ry * dy) / sc, v = (-rx * dy + ry * dx) / sc * flipY;
      if (u < -25 || u > 30 || v < -9 || v > 6) continue;
      const col = toolSample(id, u, v, load);
      if (col) spPut(Math.round(hx) + px, Math.round(hy) + py, col);
    }
    // mitten over the grip
    spLine(hx - dx * 2, hy - dy * 2, hx + dx * 1, hy + dy * 1, 3, lc(PAL.mitt));
    spPut(Math.round(hx - dx * 2 - dy), Math.round(hy - dy * 2 + dx), lc(PAL.mittHi));
    if (holdBlock) {
      // block in both hands: the near hand grips its top edge, the free arm comes across from the far shoulder to its lower edge
      const px = -dy * flipY, py = dx * flipY, sxF = -vf * 3 + (spLean ? vf * Math.round(spLean * 0.5) : 0);
      const nx = hx - px * 5, ny = hy - py * 5, fx = hx + px * 5, fy = hy + py * 5;
      spLine(sxF, shY, fx, fy, 3, lc(PAL.parkaSh));
      spLine(nx - dx * 1.5, ny - dy * 1.5, nx + dx * 1.5, ny + dy * 1.5, 3, lc(PAL.mitt));
      spLine(fx - dx * 1.5, fy - dy * 1.5, fx + dx * 1.5, fy + dy * 1.5, 3, lc(PAL.mitt));
    }
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
  if (nf && nfd < 320) { rimLx = Math.abs(nf.x - x) < 4 ? 0 : nf.x > x ? 1 : -1; rimStr = Math.min(1, 0.4 + (1 - nfd / 320) * 1.2); rimWarm = true; }
  const tod = ((G.time / 60) % 24 + 24) % 24;
  const skyX = G.daylight > 0.25 ? Math.sign(12.5 - tod) || 1 : Math.sign(0.5 - Math.max(0, Math.min(1, ((tod - 17 + 24) % 24) / 14))) || -1;
  const skyStr = 0.28 + 0.2 * (1 - G.daylight), nightRim = 0.5 * nk;
  const rw: C3 = rimWarm ? [255, 168, 86] : [168, 200, 255];
  for (let y = 1; y < SPH - 1; y++) for (let x2 = 1; x2 < SPW - 1; x2++) {
    const i = y * SPW + x2;
    if (!filled(i)) {
      if (filled(i - 1) || filled(i + 1) || filled(i - SPW) || filled(i + SPW)) spBuf[i] = oc;
      continue;
    }
    let rs = 0, wr = false;
    if (rimWarm && rimLx !== 0 && !filled(i + rimLx)) { rs = rimStr; wr = true; }
    else if (rimWarm && rimLx !== 0 && !filled(i + 2 * rimLx)) { rs = rimStr * 0.55; wr = true; }     // second cell: warm glow on the fire-facing side
    else if (rimWarm && rimLx === 0 && !filled(i - SPW)) { rs = rimStr; wr = true; }
    if (!wr || rs < 0.5) {
      const c2 = !filled(i + skyX) ? skyStr : !filled(i - SPW) ? skyStr * 0.6 : 0;
      if (c2 > rs) { rs = c2; wr = false; }
    }
    // night: a faint cool rim all round the silhouette, so the dark parka reads against dark snow and dark sky
    if (nightRim > rs && (!filled(i - 1) || !filled(i + 1) || !filled(i - SPW) || !filled(i + SPW))) { rs = nightRim; wr = false; }
    if (rs > 0) {
      const cc = wr ? rw : [168, 200, 255] as C3;
      const p = src[i], pr = p & 255, pg = (p >> 8) & 255, pb = (p >> 16) & 255;
      const k = Math.min(0.8, rs * 0.75);
      spBuf[i] = spC(pr + (cc[0] - pr) * k, pg + (cc[1] - pg) * k, pb + (cc[2] - pb) * k);
    }
  }
  void N;
  // the sprite's filled box in world cells (tool and arm included): the overlay labels keep out of it
  let qx0 = SPW, qy0 = SPH, qx1 = -1, qy1 = -1;
  for (let yy = 0; yy < SPH; yy++) for (let xx = 0; xx < SPW; xx++) {
    if (spBuf[yy * SPW + xx] >>> 24) { if (xx < qx0) qx0 = xx; if (xx > qx1) qx1 = xx; if (yy < qy0) qy0 = yy; if (yy > qy1) qy1 = yy; }
  }
  const ox = Math.round(x) - SOX + shakeX, oy = Math.round(y) - SOY + shakeY;
  heroBox.ok = qx1 >= 0; heroBox.x0 = ox + qx0; heroBox.y0 = oy + qy0; heroBox.x1 = ox + qx1 + 1; heroBox.y1 = oy + qy1 + 1;
  spCtx.putImageData(spImg, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(spCanvas, ox, oy);
}
const mix3c = (a: C3, b: C3, t: number): C3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Glowing log base of every campfire: 3 small crossed logs with an ember glow (the flames themselves are GL particles). */
function drawFireBase() {
  const t = G.realTime, vw = cssW / G.cam.zoom;
  for (const f of G.fires) {
    if (Math.abs(f.x - G.cam.x) > vw * 0.6) continue;
    const lit = f.lit, pw = lit ? Math.min(1, f.fuel / 30) : 0;
    const fl = 0.85 + 0.15 * Math.sin(t * 9 + f.id * 2.1) + 0.08 * Math.sin(t * 23 + f.id);
    const by = f.y - 1.2;
    const logs: [number, number, number, number][] = [[-0.42, -4.2, 0.4, 7.2], [0.38, 4.2, 0.2, 7.2], [0.02, 0, -1.7, 6.2]];   // [tilt, dx, dy, half-length]
    ctx.save();
    ctx.translate(f.x, by);
    for (let k = 0; k < 3; k++) {
      const [tilt, dx, dy, hl] = logs[k];
      ctx.save(); ctx.translate(dx, dy); ctx.rotate(tilt);
      ctx.fillStyle = '#1c110a'; ctx.fillRect(-hl - 0.4, -1.9, hl * 2 + 0.8, 3.8);        // dark outline
      ctx.fillStyle = k === 2 ? '#4a2f1b' : '#3d2616'; ctx.fillRect(-hl, -1.5, hl * 2, 3);
      ctx.fillStyle = '#6a4527'; ctx.fillRect(-hl, -1.5, hl * 2, 0.9);                      // lit top edge
      ctx.fillStyle = '#2a1a0f'; ctx.fillRect(-hl + 1, 0.2, hl * 2 - 2, 0.5);               // bark groove
      if (lit) {                                                                            // glowing, charred ends
        ctx.fillStyle = `rgba(255,${(110 + 80 * fl) | 0},40,${0.85 * pw})`;
        ctx.fillRect(-hl, -1.5, 1.8, 3); ctx.fillRect(hl - 1.8, -1.5, 1.8, 3);
        ctx.fillStyle = `rgba(255,60,10,${0.55 * pw * fl})`; ctx.fillRect(-hl + 1.8, 0.4, hl * 2 - 3.6, 0.7);
      }
      ctx.restore();
    }
    ctx.restore();
    if (lit) {                                                                              // ember glow
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const r = 15 * (0.55 + 0.45 * pw) * fl, g = ctx.createRadialGradient(f.x, by - 1, 0, f.x, by - 1, r);
      g.addColorStop(0, `rgba(255,150,60,${0.6 * pw})`); g.addColorStop(0.45, `rgba(255,90,20,${0.22 * pw})`); g.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.fillStyle = g; ctx.fillRect(f.x - r, by - 1 - r, r * 2, r * 2);
      ctx.restore();
    } else if (f.fuel > 0) {
      ctx.fillStyle = `rgba(200,50,20,${0.5 + 0.3 * Math.sin(t * 2 + f.id)})`; ctx.fillRect(f.x - 1, by - 1.6, 2, 1);
    }
  }
}
/** soft elliptical contact shadow on the snow under the feet */
function drawContactShadow() {
  const x = pl.x, y = pl.y + 1;
  let lift = 0; if (!pl.onGround) { for (let k = 0; k < 40; k++) { if (mat[idx(x | 0, Math.min(H - 1, (y | 0) + k))] !== M.AIR) { lift = k; break; } lift = 40; } }
  const k = Math.max(0, 1 - lift / 30);
  if (k <= 0.02) return;
  const a = (0.42 + 0.16 * G.daylight) * k, rx = 13 * (0.7 + 0.3 * k);
  ctx.save(); ctx.translate(x, y + lift); ctx.scale(1, 0.22);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(14,26,58,${a})`); g.addColorStop(0.6, `rgba(14,26,58,${a * 0.55})`); g.addColorStop(1, 'rgba(14,26,58,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// ---------------- aim overlay: ghosts, reticles, live verdicts, throw and fall previews ----------------
// Verdict colours are the ghost palette (rgb triplets: green ok, yellow weak, red refused). Labels are Jura 12 css px with a dark halo,
// drawn in world units (px = one css px in world units), so they keep their size at any zoom.
const OV_GREEN = '110,230,150', OV_YELLOW = '255,190,70', OV_RED = '255,92,60';
const OV_TXT = 'rgb(234,243,251)', OV_BAD = 'rgb(255,150,120)', OV_DARK = 'rgba(8,14,26,0.78)';
const OV_TAU = Math.PI * 2;
const OV_FONT = 12, OV_LINE = 15, OV_GAP = 4;   // label font, line pitch and gap from a ghost box (css px)
type Box = { x0: number; y0: number; x1: number; y1: number };
/** the hero sprite's filled box in world cells (drawPlayer sets it each frame, tool and arm included): labels keep out of it */
const heroBox = { ok: false, x0: 0, y0: 0, x1: 0, y1: 0 };
/** label boxes placed in this frame's overlay: a new label avoids them, so labels stack instead of overlapping */
const ovPlaced: Box[] = [];
let ovFontStr = '', ovFontPx = -1;
function ovFont(px: number) {
  if (px !== ovFontPx) { ovFontPx = px; ovFontStr = `500 ${OV_FONT * px}px Jura, "Segoe UI", system-ui, sans-serif`; }
  ctx.font = ovFontStr;
}
function ovText(s: string, x: number, y: number, col: string, px: number, align: CanvasTextAlign = 'center', base: CanvasTextBaseline = 'bottom') {
  ovFont(px); ctx.textAlign = align; ctx.textBaseline = base;
  ctx.lineJoin = 'round'; ctx.lineWidth = 3 * px; ctx.strokeStyle = 'rgba(8,14,26,0.9)'; ctx.strokeText(s, x, y);
  ctx.fillStyle = col; ctx.fillText(s, x, y);
}
/** A label block beside a box (a ghost). Takes the first spot in `order` that is on screen and clear of the hero, the box and the labels
 *  placed so far; if none is clear it stacks above the placed labels (unless `stack` is off: then nothing is drawn and false comes back).
 *  A label that sits off its box gets a short leader line. */
function ovLabel(lines: { s: string; col: string }[], g: Box, px: number, order: ('above' | 'below' | 'right' | 'left')[], stack = true): boolean {
  if (!lines.length) return false;
  ovFont(px);
  let W = 0; for (const l of lines) W = Math.max(W, ctx.measureText(l.s).width);
  const LH = OV_LINE * px, H = LH * lines.length, gap = OV_GAP * px;
  const cx = (g.x0 + g.x1) / 2, cy = (g.y0 + g.y1) / 2;
  const cand = (k: string): Box => k === 'above' ? { x0: cx - W / 2, y0: g.y0 - gap - H, x1: cx + W / 2, y1: g.y0 - gap }
    : k === 'below' ? { x0: cx - W / 2, y0: g.y1 + gap, x1: cx + W / 2, y1: g.y1 + gap + H }
    : k === 'right' ? { x0: g.x1 + gap, y0: cy - H / 2, x1: g.x1 + gap + W, y1: cy + H / 2 }
    : { x0: g.x0 - gap - W, y0: cy - H / 2, x1: g.x0 - gap, y1: cy + H / 2 };
  const hit = (a: Box, b: Box, m: number) => a.x0 < b.x1 + m && a.x1 > b.x0 - m && a.y0 < b.y1 + m && a.y1 > b.y0 - m;
  const vx0 = G.cam.x - cssW / 2 / G.cam.zoom, vx1 = G.cam.x + cssW / 2 / G.cam.zoom, vy0 = G.cam.y - cssH / 2 / G.cam.zoom, vy1 = G.cam.y + cssH / 2 / G.cam.zoom;
  const clear = (b: Box) => b.x0 >= vx0 && b.x1 <= vx1 && b.y0 >= vy0 && b.y1 <= vy1 && !(heroBox.ok && hit(b, heroBox, 2 * px)) && !ovPlaced.some((p) => hit(b, p, px));
  let B: Box | null = null, kind = '';
  for (const k of order) { const b = cand(k); if (clear(b)) { B = b; kind = k; break; } }
  if (!B) {                                     // nothing clear beside the box: stack above the labels already placed (the hero is the last thing to give way)
    if (!stack) return false;
    let b = cand('above'); kind = 'stack';
    for (let n = 0; n < 8; n++) { const p = ovPlaced.find((q) => hit(b, q, px)); if (!p) break; b = { x0: b.x0, x1: b.x1, y0: p.y0 - gap - H, y1: p.y0 - gap }; }
    B = b;
  }
  const box: Box = B;
  ovPlaced.push(box);
  // leader line when the label sits off its box (more than the usual gap away)
  const dx = Math.max(0, box.x0 - g.x1, g.x0 - box.x1), dy = Math.max(0, box.y0 - g.y1, g.y0 - box.y1);
  if (Math.hypot(dx, dy) > gap * 1.5) {
    const ax = Math.min(Math.max((box.x0 + box.x1) / 2, g.x0), g.x1), ay = Math.min(Math.max((box.y0 + box.y1) / 2, g.y0), g.y1);
    const lx = Math.min(Math.max(cx, box.x0), box.x1), ly = Math.min(Math.max(cy, box.y0), box.y1);
    ctx.setLineDash([]); ctx.lineCap = 'round';
    ctx.lineWidth = 2.6 * px; ctx.strokeStyle = OV_DARK; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(lx, ly); ctx.stroke();
    ctx.lineWidth = px; ctx.strokeStyle = 'rgba(234,243,251,0.8)'; ctx.stroke();
  }
  // text: centred over its box, or flush with the ghost when it sits beside it
  const align: CanvasTextAlign = kind === 'right' ? 'left' : kind === 'left' ? 'right' : 'center';
  const tx = kind === 'right' ? box.x0 : kind === 'left' ? box.x1 : (box.x0 + box.x1) / 2;
  for (let i = 0; i < lines.length; i++) ovText(lines[i].s, tx, box.y0 + i * LH, lines[i].col, px, align, 'top');
  return true;
}
/** Where a beam or door has to stand: a small marker on the first solid surface under each column, scanned down from its foot. */
function ovSupportMarks(xs: number[], yb: number, px: number) {
  for (const x of xs) {
    const cx = Math.round(x), y0 = Math.round(yb);
    let ys = -1;
    for (let y = y0; y < y0 + 40 && inb(cx, y); y++) {
      const i = idx(cx, y), m = mat[i];
      if (m !== M.AIR && m !== M.NEEDLE && !(m === M.SNOW && isGranular(i))) { ys = y; break; }
    }
    if (ys < 0) continue;
    ctx.setLineDash([2.4 * px, 2 * px]); ctx.lineWidth = 1.4 * px; ctx.strokeStyle = 'rgba(143,211,255,0.9)';
    ctx.beginPath(); ctx.moveTo(cx, y0); ctx.lineTo(cx, ys); ctx.stroke(); ctx.setLineDash([]);
    const r = 3 * px;
    ctx.beginPath(); ctx.moveTo(cx, ys - r); ctx.lineTo(cx + r, ys); ctx.lineTo(cx, ys + r); ctx.lineTo(cx - r, ys); ctx.closePath();
    ctx.fillStyle = 'rgb(143,211,255)'; ctx.fill(); ctx.lineWidth = 1.6 * px; ctx.strokeStyle = OV_DARK; ctx.stroke();
  }
}
const needTxt: string[] = [];   // "Нужно N брёвен" by count: built once, so the frame loop does not allocate it
function needLogsTxt(n: number): string { return needTxt[n] ??= `Нужно ${n} ${plural(n, 'бревно', 'бревна', 'брёвен')}`; }

/** Beyond the 2 m reach: the limit as a faint dashed ring round the shoulder, and a hollow dot at the cursor (the reticle sits on the ring, at the clamped point). */
function ovReach(aim: [number, number], px: number) {
  const [sx, sy] = shoulder();
  ctx.setLineDash([3 * px, 3 * px]);
  ctx.lineWidth = px * 2.2; ctx.strokeStyle = 'rgba(8,14,26,0.2)';
  ctx.beginPath(); ctx.arc(sx, sy, REACH, 0, OV_TAU); ctx.stroke();
  ctx.lineWidth = px; ctx.strokeStyle = 'rgba(214,236,255,0.55)';
  ctx.beginPath(); ctx.arc(sx, sy, REACH, 0, OV_TAU); ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineWidth = px * 2; ctx.strokeStyle = 'rgba(8,14,26,0.5)';
  ctx.beginPath(); ctx.arc(aim[0], aim[1], 3 * px, 0, OV_TAU); ctx.stroke();
  ctx.lineWidth = px; ctx.strokeStyle = 'rgba(234,243,251,0.85)';
  ctx.beginPath(); ctx.arc(aim[0], aim[1], 3 * px, 0, OV_TAU); ctx.stroke();
}
/** What a beam rests on: placed timber (posts, or a beam on posts) reads «на столбах»; snow, ground or rock under it reads «опора». */
function restsOn(g: { x0: number; y0: number; w: number; h: number }): string {
  const yb = g.y0 + g.h;
  for (let x = g.x0; x < g.x0 + g.w; x++) {
    if (!inb(x, yb)) continue;
    const i = idx(x, yb);
    if (!body[i] && (mat[i] === M.PLANK || mat[i] === M.DOOR)) return 'на столбах';
  }
  return 'опора';
}
/** Block / beam ghost with its live verdict: the refusals place() gives, in the same order, shown before the click. Beam: mode name beside it.
 *  A refused door shows the clear opening it needs (dashed); a beam that would hang shows its support points under its ends (under the foot for a post or door). */
function ovGhost(beam: boolean, ax: number, ay: number, px: number) {
  const g = ghostMargin(beam ? 'beam' : 'block', ax, ay);
  const bs = beam ? beamShape() : null;
  const need = bs ? bs.logs : 1;
  const have = beam ? inv.logs >= need : inv.blocks.length > 0;
  const mg = g.blocked ? 0 : g.margin;
  const rgb = !have || g.blocked || mg <= 0.02 ? OV_RED : mg < 0.35 ? OV_YELLOW : OV_GREEN;
  ctx.fillStyle = `rgba(${rgb},0.35)`; ctx.fillRect(g.x0, g.y0, g.w, g.h);
  ctx.lineWidth = px * 1.2; ctx.strokeStyle = OV_DARK; ctx.strokeRect(g.x0 - px * 1.1, g.y0 - px * 1.1, g.w + px * 2.2, g.h + px * 2.2);
  ctx.lineWidth = px * 1.6; ctx.strokeStyle = `rgba(${rgb},0.95)`; ctx.strokeRect(g.x0, g.y0, g.w, g.h);
  const box: Box = { x0: g.x0, y0: g.y0, x1: g.x0 + g.w, y1: g.y0 + g.h };
  const hung = have && !g.blocked && mg <= 0.02;     // no support path: place() refuses a beam here, a block is not refused (it would crumble)
  let s = '', col = OV_BAD;
  if (g.blocked) s = g.reason;
  else if (!have) s = beam ? needLogsTxt(need) : 'нет блоков: вырежь пилой';
  else if (hung) s = 'повиснет: нужна опора';
  else if (beam) { s = restsOn(g); col = `rgb(${rgb})`; }
  const refused = g.blocked || hung;
  if (g.door && refused) {                           // the clear opening a standing hero needs: the body's width (PW) by the door's height, dashed, centred on the door
    const cx = g.x0 + g.w / 2;
    ctx.setLineDash([3 * px, 2.4 * px]); ctx.lineWidth = px * 1.4; ctx.strokeStyle = 'rgba(234,243,251,0.95)';
    ctx.strokeRect(cx - PW / 2, g.y0, PW, g.h); ctx.setLineDash([]);
  }
  if (hung) ovSupportMarks(bs && !bs.vert ? [g.x0 + 2, g.x0 + g.w - 3] : [g.x0 + g.w / 2], g.y0 + g.h, px);
  const lines: { s: string; col: string }[] = [];
  if (s) lines.push({ s, col });
  if (g.door && refused) lines.push({ s: 'нужен проём 1,8 м × 0,5 м без преград', col: OV_TXT });
  // the mode name beside the beam; with no free side it heads the status block instead (no leader line through the text)
  const mode = { s: BEAM_MODE_NAMES[tool.rot % BEAM_MODES], col: OV_TXT };
  if (beam && !ovLabel([mode], box, px, ['right', 'left'], false)) lines.unshift(mode);
  ovLabel(lines, box, px, ['above', 'below', 'right', 'left']);
}
/** Saw reticle: green when a cut here would make a block, red when not, with the density and the reason (the same tests saw() runs). */
function ovSaw(ax: number, ay: number, px: number) {
  const vert = tool.rot % 2 === 1, w = vert ? 5 : 10, h = vert ? 10 : 5;
  const rx = Math.round(ax - w / 2), ry = Math.round(ay - h / 2);
  const sc = sawCheck(ax, ay);
  ctx.setLineDash([]); ctx.lineWidth = px * 3; ctx.strokeStyle = OV_DARK; ctx.strokeRect(rx, ry, w, h);
  ctx.lineWidth = px * 1.5; ctx.strokeStyle = `rgba(${sc.ok ? OV_GREEN : OV_RED},0.95)`; ctx.setLineDash([1.4, 1]); ctx.strokeRect(rx, ry, w, h); ctx.setLineDash([]);
  if (tool.sawT > 0) { const f = sawProgress(); ctx.fillStyle = OV_DARK; ctx.fillRect(rx - px, ry - 2.6, w + px * 2, 1.4); ctx.fillStyle = 'rgba(255,200,120,0.95)'; ctx.fillRect(rx, ry - 2.3, w * f, 0.8); }
  const cx = rx + w / 2;
  let y = ry - 10 * px;                                   // labels stack upwards from the progress bar
  if (sc.avg > 0) { ovText(`${Math.round(sc.avg)} кг/м³`, cx, y, sc.ok ? OV_TXT : OV_BAD, px); y -= 13 * px; }
  if (!sc.ok) {
    const p = sawProbe(ax, ay);
    ovText(!p.solid ? 'здесь не снег или пустота' : p.avg < 170 ? 'рыхлый: нужен наст от 170' : 'слабо спечён: пила не возьмёт', cx, y, OV_BAD, px);
  }
}

// shovel: where the dug snow lands (auto: planSpoil, the plan tickSpoil throws with). Re-planned only when the hero moves or about once a second.
const TH = { k0: NaN, k1: NaN, k2: NaN, k3: NaN, k4: NaN, ok: false, lx: 0, ly: 0, arc: new Float32Array(2 * 130), n: 0 };
function ovThrow(px: number) {
  const [sx, sy] = shoulder();
  const k0 = pl.x | 0, k1 = pl.y | 0, k2 = tool.digDir, k3 = pl.face, k4 = (G.frame / 60) | 0;
  if (TH.k0 !== k0 || TH.k1 !== k1 || TH.k2 !== k2 || TH.k3 !== k3 || TH.k4 !== k4) {
    TH.k0 = k0; TH.k1 = k1; TH.k2 = k2; TH.k3 = k3; TH.k4 = k4;
    const p = planSpoil(sx, sy);
    const vx = p.ux * p.sp, vy = p.uy * p.sp - 25;
    const [lx, ly] = simulateClump(sx, sy, vx, vy);
    TH.ok = ly < 1e4; TH.lx = lx; TH.ly = ly;
    // flight path: gravity and 1/30 s steps as in stepParticles, up to the landing
    let x = sx, y = sy, wx = vx, wy = vy, n = 1;
    TH.arc[0] = x; TH.arc[1] = y;
    if (TH.ok) for (let t = 0; t < CLUMP_LIFE && n < 130; t += 1 / 30) {
      wy += CLUMP_G / 30; x += wx / 30; y += wy / 30;
      TH.arc[2 * n] = x; TH.arc[2 * n + 1] = y; n++;
      if (Math.hypot(x - lx, y - ly) < 1.2) break;
    }
    TH.n = n;
  }
  if (!TH.ok) return;
  ctx.beginPath(); ctx.moveTo(TH.arc[0], TH.arc[1]);
  for (let k = 1; k < TH.n; k++) ctx.lineTo(TH.arc[2 * k], TH.arc[2 * k + 1]);
  ctx.setLineDash([]); ctx.lineWidth = px * 2.2; ctx.strokeStyle = 'rgba(8,14,26,0.2)'; ctx.stroke();
  ctx.setLineDash([2.6 * px, 2.2 * px]); ctx.lineWidth = px; ctx.strokeStyle = 'rgba(190,228,255,0.9)'; ctx.stroke(); ctx.setLineDash([]);
  ctx.lineWidth = px * 2; ctx.strokeStyle = OV_DARK; ctx.beginPath(); ctx.arc(TH.lx, TH.ly, 3.2 * px, 0, OV_TAU); ctx.stroke();
  ctx.lineWidth = px; ctx.strokeStyle = 'rgba(190,228,255,0.95)'; ctx.beginPath(); ctx.arc(TH.lx, TH.ly, 2.8 * px, 0, OV_TAU); ctx.stroke();
  ovText('авто', TH.lx, TH.ly + 6 * px, OV_TXT, px, 'center', 'top');
}
/** crack lines on one tile: stage 0 none, 1 two, 2 four, 3 seven. Deterministic per tile, so the cracks grow in the same places. */
function ovCracks(tx: number, ty: number, stage: number, px: number) {
  const n = [0, 2, 4, 7][stage];
  if (!n) return;
  let r = ((tx * 73856093) ^ (ty * 19349663)) >>> 0 || 1;
  const rnd = () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r / 4294967296; };
  ctx.setLineDash([]); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.lineWidth = px * 1.5; ctx.strokeStyle = 'rgba(10,18,30,0.9)';
  ctx.beginPath();
  for (let k = 0; k < n; k++) {
    let x = tx * TILE + rnd() * TILE, y = ty * TILE + rnd() * TILE;
    ctx.moveTo(x, y);
    for (let j = 0, seg = 2 + Math.floor(rnd() * 2); j < seg; j++) { x += (rnd() - 0.5) * 3.4; y += (rnd() - 0.5) * 3.4; ctx.lineTo(x, y); }
  }
  ctx.stroke();
}
/** Shovel target: the tile under the cursor is outlined - white = can dig, red = beyond the 2 m reach, grey = why not (a short label).
 *  While it is dug: crack stages (3) on its tiles, following the progress. */
function ovDig(t: DigTarget, px: number) {
  const bx = t.tx * TILE, by = t.ty * TILE;
  const col = t.ok ? 'rgba(240,248,255,0.95)' : t.far ? 'rgba(255,120,100,0.95)' : 'rgba(176,190,204,0.9)';
  ctx.setLineDash([]);
  ctx.fillStyle = t.ok ? 'rgba(240,248,255,0.1)' : t.far ? 'rgba(255,92,60,0.12)' : 'rgba(150,164,178,0.08)';
  ctx.fillRect(bx, by, TILE, TILE);
  if (t.ok) for (const u of t.tiles) if (u.tx !== t.tx || u.ty !== t.ty) { ctx.lineWidth = px * 1.2; ctx.strokeStyle = 'rgba(240,248,255,0.6)'; ctx.strokeRect(u.tx * TILE, u.ty * TILE, TILE, TILE); }
  ctx.lineWidth = px * 3; ctx.strokeStyle = OV_DARK; ctx.strokeRect(bx, by, TILE, TILE);
  ctx.lineWidth = px * 1.6; ctx.strokeStyle = col; ctx.strokeRect(bx, by, TILE, TILE);
  if (DIG.key && DIG.key === t.key && DIG.p > 0) {
    const stage = DIG.p < 0.25 ? 0 : DIG.p < 0.5 ? 1 : DIG.p < 0.75 ? 2 : 3;
    for (const u of DIG.tiles) ovCracks(u.tx, u.ty, stage, px);
  }
  if (!t.ok) ovLabel([{ s: t.reason, col: t.far ? OV_BAD : OV_TXT }], { x0: bx, y0: by, x1: bx + TILE, y1: by + TILE }, px, ['above', 'below', 'right', 'left']);
}

// axe over a standing trunk: dashed arrow from its base in the direction it falls (chop() drops it away from the hero), as long as the tree is tall
const FA = { cx: -1, cy: -1, f: -1, ok: false, bx: 0, by: 0, tx: 0 };
function ovFall(ax: number, ay: number, px: number) {
  const cx = Math.round(ax), cy = Math.round(ay), f = G.frame >> 4;
  if (FA.cx !== cx || FA.cy !== cy || FA.f !== f) {
    FA.cx = cx; FA.cy = cy; FA.f = f; FA.ok = false;
    const i = inb(cx, cy) ? idx(cx, cy) : -1;
    if (i >= 0 && isTrunkOf(i, treeId[i])) {
      const tid = treeId[i], hit = trunkRow(cy, cx, tid);
      if (hit.length) {
        const xc = (hit[0] + hit[hit.length - 1]) / 2;
        if (Math.abs(xc - pl.x) >= 1.5) {                   // in line with the trunk: chop() refuses, no direction
          let base = cy; while (base < H - 1 && base - cy < 240 && trunkRow(base + 1, cx, tid).length) base++;
          let top = cy; while (top > 0 && cy - top < 240 && trunkRow(top - 1, cx, tid).length) top--;
          FA.ok = true; FA.bx = xc; FA.by = base + 1; FA.tx = xc + (xc > pl.x ? 1 : -1) * (base - top + 1);
        }
      }
    }
  }
  if (!FA.ok) return;
  const { bx, by, tx } = FA, d = Math.sign(tx - bx), hs = 5 * px;
  ctx.setLineDash([]); ctx.lineWidth = px * 2.2; ctx.strokeStyle = OV_DARK;
  ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, by); ctx.stroke();
  ctx.setLineDash([3 * px, 2.4 * px]); ctx.lineWidth = px * 1.2; ctx.strokeStyle = 'rgba(143,211,255,0.95)';
  ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, by); ctx.stroke(); ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(tx - d * hs, by - hs * 0.6); ctx.lineTo(tx, by); ctx.lineTo(tx - d * hs, by + hs * 0.6); ctx.stroke();
  ovText('падает', tx, by - 4 * px, OV_TXT, px);
}

function drawOverlay(aim: [number, number] | null, moveX = 0) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, fx.width, fx.height);
  ovPlaced.length = 0;   // labels are placed afresh each frame
  const s = G.cam.zoom * dpr;
  ctx.setTransform(s, 0, 0, s, (cssW / 2 - G.cam.x * G.cam.zoom) * dpr + (Math.random() - 0.5) * shake * dpr, (cssH / 2 - G.cam.y * G.cam.zoom) * dpr + (Math.random() - 0.5) * shake * dpr);
  ctx.imageSmoothingEnabled = false;
  drawFireBase();
  drawContactShadow();
  drawPlayer(aim, 0, 0);
  // warm firelight on the parka: source-atop only tints what is already drawn (sprite, shadow, logs), stronger on the side facing the fire
  for (const f of G.fires) {
    if (!f.lit) continue;
    const d = Math.hypot(f.x - pl.x, f.y - 8 - pl.y); if (d > 150) continue;
    const k = (1 - d / 150) * Math.min(1, f.fuel / 20) * (0.85 + 0.15 * Math.sin(G.realTime * 9 + f.id));
    ctx.save(); ctx.globalCompositeOperation = 'source-atop';
    const g = ctx.createRadialGradient(f.x, f.y - 7, 3, f.x, f.y - 7, 85);
    g.addColorStop(0, `rgba(255,150,60,${0.26 * k})`); g.addColorStop(0.5, `rgba(255,120,40,${0.1 * k})`); g.addColorStop(1, 'rgba(255,100,30,0)');
    ctx.fillStyle = g; ctx.fillRect(f.x - 90, f.y - 95, 180, 100);
    ctx.restore();
  }
  // aim: reach limit, reticle, ghost with its live verdict, and the throw / fall previews
  if (aim && pl.alive) {
    const [ax, ay] = reachPoint(aim[0], aim[1]);
    const id = TOOLS[tool.cur].id;
    const px = 1 / G.cam.zoom;                 // one screen pixel in world cells
    const near = inReach(aim[0], aim[1]);
    if (!near) ovReach(aim, px);
    if (id === 'block' || id === 'beam') ovGhost(id === 'beam', ax, ay, px);
    else if (id === 'saw') ovSaw(ax, ay, px);
    else if (id === 'shovel') {
      const t = aimTarget(aim[0], aim[1], moveX);   // the tile a dig takes now (the same target usePrimary digs)
      ovDig(t, px);
      if (t.ok) ovThrow(px);
    } else {
      const bite = { rx: 2.5, ry: 2.5 };
      ctx.setLineDash([]);
      ctx.lineWidth = px * 3; ctx.strokeStyle = near ? OV_DARK : 'rgba(8,14,26,0.45)';
      ctx.beginPath(); ctx.ellipse(ax, ay, bite.rx, bite.ry, 0, 0, OV_TAU); ctx.stroke();
      ctx.lineWidth = px * 1.5; ctx.strokeStyle = near ? 'rgba(240,248,255,0.95)' : 'rgba(235,244,255,0.5)';
      ctx.beginPath(); ctx.ellipse(ax, ay, bite.rx, bite.ry, 0, 0, OV_TAU); ctx.stroke();
      if (id === 'axe') ovFall(ax, ay, px);
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


// ---------------- adaptive quality ----------------
// Frame-time EMA drives (1) dynamic resolution of the screen pass (nearest upscale, UI stays crisp), (2) auto drop to quality 0.
// The GPU headroom is invisible while vsync-locked, so resolution is raised again by probing: try a step up after a hold-off, undo and back off if it hurts.
const AD = { avg: 16.7, work: 6, last: 6, n: 0, t: 0, good: 0, probing: false, probeT: 0, backoff: 3, cool: 0, deep: 0, promoted: false, noPromote: false };
const AD_BUDGET = 16.7;
function adaptWork(ms: number) { AD.last = Math.min(ms, 100); AD.work += (AD.last - AD.work) * 0.1; }   // CPU+submit time of a frame: the only headroom visible under vsync
function adaptQuality(ms: number) {
  if ((window as unknown as { __noAdapt?: boolean }).__noAdapt) return;
  if (ms > 1000 || paused) { AD.n = 0; return; }                          // tab switch / pause: not representative (the title screen renders the world too, so it adapts)
  AD.avg += (ms - AD.avg) * 0.1; AD.t += ms / 1000; AD.n++;
  if (AD.n < 20 || AD.t < 0.6) return;
  const step = AD.t; AD.t = 0;
  const dyn = renderer.getDyn(), lo = renderer.dynMin();
  AD.cool = Math.max(0, AD.cool - step);
  if (AD.avg > 22) {                                                      // under ~45 fps: step down
    AD.good = 0;
    if (AD.probing) { AD.probing = false; AD.backoff = Math.min(40, AD.backoff * 2); AD.cool = AD.backoff; }  // failed probe: back off exponentially
    if (dyn > lo + 0.01) { renderer.setDyn(Math.max(lo, dyn * 0.85)); AD.n = 0; AD.cool = Math.max(AD.cool, AD.backoff); }
    else if (G.quality === 1) { G.quality = 0; renderer.setDyn(1); resize(); AD.n = 0; if (AD.promoted) AD.noPromote = true; AD.promoted = false; AD.cool = 20; }
    return;
  }
  const headroom = AD.work < AD_BUDGET * 0.7 && AD.avg < 19;              // EMA of frame work under 70% of budget and holding ~60 fps
  AD.good = headroom ? AD.good + step : 0;
  if (AD.probing) {                                                       // probe survives 2.4 s without falling: keep it, relax back-off
    AD.probeT += step;
    if (AD.probeT > 2.4) { AD.probing = false; AD.backoff = Math.max(3, AD.backoff * 0.7); AD.good = 0; }
    return;
  }
  if (dyn < 0.999) {
    if (AD.good >= 3 && AD.cool <= 0) { AD.probing = true; AD.probeT = 0; AD.good = 0; renderer.setDyn(Math.min(1, dyn / 0.85)); AD.n = 0; }
  } else if (G.quality === 0 && !AD.noPromote && AD.work < AD_BUDGET * 0.5 && AD.good >= 15 && AD.cool <= 0) {
    G.quality = 1; AD.promoted = true; AD.probing = true; AD.probeT = 0; AD.good = 0; resize(); AD.n = 0;   // sustained headroom at full resolution
  }
}

// ---------------- touch: quality ladder ----------------
// Phones start at quality 0 and climb this ladder while there is sustained headroom. Frame times are vsync-locked, so headroom shows
// as the CPU work estimate (AD.last) staying well under the budget, and the frame p90 staying at the display rate. Desktop keeps adaptQuality above.
/** quality and screen-pass canvas px per css px (capped by dpr in render.ts); one step per promotion */
const QLADDER: { q: 0 | 1; s: number }[] = [{ q: 0, s: 0.6 }, { q: 0, s: 0.8 }, { q: 0, s: 1 }, { q: 1, s: 1 }, { q: 1, s: 1.5 }];
const QL_KEY = 'frost.qlevel';                                             // last stable level on this device; the next session starts one step below it
const QL_REFRESH = [8.33, 11.11, 13.89, 16.67];                            // frame intervals of 120 / 90 / 72 / 60 Hz
const QL_WIN = 3000, QL_FAST = 1000, QL_DROP = 20, QL_BLOCK = 30000;       // ms: decision window, fast-drop window, drop threshold, re-promotion block

const pctOf = (a: number[], p: number): number => {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
};
/** display frame interval: the largest standard interval that the 10th-percentile frame still reaches */
const snapRefresh = (p10: number): number => { let r = QL_REFRESH[0]; for (const c of QL_REFRESH) if (p10 >= 0.9 * c) r = c; return r; };

/**
 * Touch quality ladder as a state machine over (timestamp ms, frame ms, work ms). No DOM, so __frost.qctl can drive it with synthetic frames.
 * - a 3 s window with p90 frame <= 1.05 x refresh (17.5 ms at 60 Hz) and p90 work <= 70% of refresh promotes one step, as a probe;
 * - the window after a promotion decides the probe: p90 frame over the limit undoes it;
 * - any 1 s stretch with p90 frame > 20 ms demotes at once (on the bottom step: a dynamic-resolution drop instead);
 * - a demoted step is not promoted into again for 30 s, so the ladder cannot chatter.
 * save() is called with each level that passes a window (a probe that passed counts), i.e. the last stable one.
 */
function createLadder(o: { start: number; apply: (level: number) => void; save: (level: number) => void; emergency: () => void }) {
  const N = QLADDER.length;
  let level = Math.max(0, Math.min(N - 1, o.start | 0)), probe = false, saved = -1, refresh = 16.67, lastFast = -1e9, winStart = 0, lastT = 0;
  const blocked = new Array<number>(N).fill(-1e9);
  let win: { t: number; ms: number; w: number }[] = [];
  const set = (i: number) => { level = i; o.apply(i); };
  const commit = () => { if (level !== saved) { saved = level; o.save(level); } };
  const demote = (now: number) => {
    win = [];
    if (level === 0) { o.emergency(); return; }
    blocked[level] = now + QL_BLOCK; probe = false; set(level - 1);
  };
  const decide = (now: number) => {
    const p90 = pctOf(win.map((s) => s.ms), 0.9), w90 = pctOf(win.map((s) => s.w), 0.9);
    refresh = snapRefresh(pctOf(win.map((s) => s.ms), 0.1));
    const ok = 1.05 * refresh;
    win = []; winStart = now;
    if (probe) {                                                            // the step taken last window: keep it or undo it
      probe = false;
      if (p90 > ok) { blocked[level] = now + QL_BLOCK; set(level - 1); return; }
    } else if (p90 > ok) return;                                            // 17.5-20 ms: hold where we are
    commit();
    if (level < N - 1 && w90 <= 0.7 * refresh && now >= blocked[level + 1]) { set(level + 1); probe = true; }   // one step per window
  };
  return {
    feed(now: number, ms: number, work: number) {
      lastT = now;
      if (!win.length) winStart = now;
      win.push({ t: now, ms, w: work });
      if (now - lastFast >= 250 && win[0].t <= now - 0.9 * QL_FAST) {
        lastFast = now;
        if (pctOf(win.filter((s) => s.t > now - QL_FAST).map((s) => s.ms), 0.9) > QL_DROP) { demote(now); return; }
      }
      if (now - winStart >= QL_WIN) decide(now);
    },
    reset() { win = []; },
    level: () => level,
    state: () => ({ level, quality: QLADDER[level].q, scale: QLADDER[level].s, probe, refresh, saved, blockedSec: blocked.map((b) => Math.max(0, Math.round((b - lastT) / 1000))) }),
  };
}

let QL: ReturnType<typeof createLadder> | null = null;   // touch only; created at boot
function qlStart(): number {
  try { const v = parseInt(localStorage.getItem(QL_KEY) || '', 10); if (v >= 0) return Math.max(0, v - 1); } catch { /* storage blocked: start at 0 */ }
  return 0;
}
function applyQLevel(i: number) {
  const L = QLADDER[i];
  G.quality = L.q; renderer.setScaleOverride(L.s); renderer.setDyn(1); resize();
}
function saveQLevel(i: number) { try { localStorage.setItem(QL_KEY, String(i)); } catch { /* storage blocked: not remembered */ } }
/** bottom step only: drop the dynamic resolution, as the desktop rule does (the fast check waits for a fresh second of frames, so this runs about once a second at most) */
function qlEmergency() { const d = renderer.getDyn(), lo = renderer.dynMin(); if (d > lo + 0.01) renderer.setDyn(Math.max(lo, d * 0.85)); }
function qlInit() {
  if (!G.mobile) return;
  QL = createLadder({ start: qlStart(), apply: applyQLevel, save: saveQLevel, emergency: qlEmergency });
  applyQLevel(QL.level());
}
/** touch: feed the frame times of real gameplay only (title, pause, portrait hold and the benchmark are not representative) */
function qlFrame(now: number, ms: number, play: boolean) {
  if (!QL || (window as unknown as { __noAdapt?: boolean }).__noAdapt) return;
  if (!play || ms > 1000) { QL.reset(); return; }
  QL.feed(now, ms, AD.last);
}

// ---------------- main loop ----------------
let last = performance.now(), fpsAcc = 0, fpsN = 0, fps = 60;
let aimWorld: [number, number] | null = null;
let waitToggle = false, waitMsgT = -99;
function frame(now: number) {
  requestAnimationFrame(frame);
  if (!bench.active) { frameBody(now); return; }
  if (input.state.pausePressed) { input.state.pausePressed = false; bench.cancel(); }   // Esc stops the benchmark
  bench.beginFrame(now);
  const tw0 = performance.now();
  frameBody(now);
  bench.endFrame(performance.now() - tw0);
}
function frameBody(now: number) {
  if ((window as unknown as { __freeze?: boolean }).__freeze) { renderer.render(0); return; }   // dev/test: hold the world still, keep rendering
  const t0 = pnow(), tw = performance.now();
  const rawMs = now - last;
  const realDt = Math.max(0, Math.min(0.25, rawMs / 1000)); last = now; // wall clock: game time, survival, fires, weather
  const dt = Math.min(0.05, realDt);                                          // physics / CA / bodies step (2 substeps when the frame is slow)
  fpsAcc += realDt; fpsN++;
  if (prof.on) prof.frameMs = prof.frameMs === undefined ? realDt * 1000 : prof.frameMs + (realDt * 1000 - prof.frameMs) * 0.1;
  if (fpsAcc > 1) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  if (G.mobile) qlFrame(now, rawMs, running && !paused && !(input.mobile && window.innerHeight > window.innerWidth));   // touch: quality ladder
  else adaptQuality(rawMs);
  const s = bench.active ? bench.input : input.state;
  if (s.pausePressed && running && !ended) { paused = !paused; if (paused) ui.showPause(() => { paused = false; ui.hide(); }, () => { ui.hide(); newGame(); }); else ui.hide(); }
  const portraitPause = input.mobile && window.innerHeight > window.innerWidth; // touch device held upright: sim waits
  if (!running || paused || portraitPause) { input.endFrame(); renderer.render(dt); drawOverlay(null); adaptWork(performance.now() - tw); return; }   // title / pause: still feeds the work estimate that adaptQuality uses
  if (ended) { // after win/death: world keeps living in the background but ignores game input
    G.realTime += realDt; G.frame++; updateCamera(realDt); stepHeat(realDt); stepSim(dt, realDt); stepBodies(dt); input.endFrame(); renderer.render(dt); drawOverlay(null); return;
  }
  G.realTime += realDt; G.frame++;
  // waiting (time compression) only when calm and in a place to wait: not moving / digging, sheltered (shelter >= 0.5) or within 40 cells of a burning fire
  if (s.waitHeld !== waitToggle) waitToggle = s.waitHeld;
  const calm = Math.abs(s.moveX) < 0.1 && !s.primary;
  const waitSpot = pl.shelter >= 0.5 || G.fires.some((f) => f.lit && Math.hypot(f.x - pl.x, f.y - pl.y) < 40);
  const canWait = pl.alive && calm && waitSpot;
  if (waitToggle && pl.alive && calm && !waitSpot && G.realTime - waitMsgT > 3) { waitMsgT = G.realTime; tool.msg = 'Ждать можно только в укрытии или у костра'; }
  G.timeScale += ((waitToggle && canWait ? 12 : 1) - G.timeScale) * Math.min(1, realDt * 3);
  G.time += realDt * G.timeScale;
  let pt = pnow();
  const { day, warn } = weather(realDt);
  pend('weatherMain', pt);
  // aim
  if (bench.active) aimWorld = bench.input.aim;
  else if (s.hasAim) aimWorld = renderer.screenToWorld(s.aimX, s.aimY);
  // tools
  if (s.toolSelect >= 0 && s.toolSelect < TOOLS.length) { tool.cur = s.toolSelect; sound.uiClick(); }
  if (s.rotatePressed) {
    const bm = TOOLS[tool.cur].id === 'beam', back = !bench.active && input.state.rotateBack;   // Shift+R: the previous mode
    tool.rot = bm ? (((tool.rot % BEAM_MODES) + (back ? BEAM_MODES - 1 : 1)) % BEAM_MODES) : (tool.rot + 1) % 2;
    if (bm) { tool.msg = beamModesLine(); tool.msgSec = 4; }   // every mode, the current one in brackets
    else if (TOOLS[tool.cur].id === 'block') tool.msg = 'Блок: ' + (tool.rot % 2 ? 'стоймя' : 'плашмя');
    sound.uiClick();
  }
  if (s.xrayPressed) { G.xray = (G.xray + 1) % 4; (ui as any).setXray?.(G.xray); }
  let working = false;
  pt = pnow();
  if (pl.alive) {
    if (s.primary && aimWorld) { usePrimary(aimWorld[0], aimWorld[1], realDt, s.moveX); working = true; if (tutorial === 0 && tool.digs > 0) { tutorial = 1; tut1At = G.realTime; } }
    else if (!s.primary) idleTool(realDt); // button still held but aim lost for a frame: keep the one-per-press latches
    if (s.secondaryPressed && aimWorld) { useSecondary(aimWorld[0], aimWorld[1]); if (tutorial === 1) tutorial = 2; }
    if (tutorial === 1 && tut1At >= 0 && G.realTime - tut1At > 8) tutorial = 2;   // the one-time tip shows ~8 s; the tamp (RMB) also moves on
    if (s.interactPressed) { if (!interact()) sound.uiDeny(); }
    if (s.eatPressed) eat();
    if (s.firePressed && aimWorld) placeFire(aimWorld[0], aimWorld[1]);
  }
  pend('tools', pt); pt = pnow();
  stepBody(realDt, Math.abs(s.moveX), s.run); // survival runs on wall-clock time
  updateCamera(realDt);
  pend('survival', pt);
  pt = pnow(); stepFires(realDt); pend('fires', pt);
  pt = pnow();
  stepHeat(realDt); pend('heat', pt);
  const nSub = realDt > 0.05 ? 2 : 1;
  for (let sub = 0; sub < nSub; sub++) {
    pt = pnow();
    stepPlayer({ moveX: s.moveX, jump: s.jump, run: s.run, working, dt });
    for (const st of events.steps) sound.footstep(st.dens, tempAt(pl.x | 0, pl.y | 0), st.run, st.sink);
    if (events.landed > 120) { sound.thump(80); shake = 1; }
    pend('player', pt);
    stepSim(dt, realDt / nSub);
    pt = pnow();
    const br = stepBodies(dt);
    for (const im of br.impacts) { if (im.massKg > 20 && Math.abs(im.x - pl.x) < 300) { sound.thump(im.massKg); shake = Math.min(3, shake + im.massKg / 200); } }
    pend('bodies', pt); pt = pnow();
    const sr = stepStructure(dt);
    if (sr.collapsed > 30) { sound.collapse(Math.min(1, sr.collapsed / 400)); shake = Math.min(3, shake + 0.8); }
    pend('structure', pt);
  }
  shake *= Math.pow(0.02, realDt);
  // falling slab / log hitting the player
  // (bodies stamped over the player's head push the player down via collision; heavy impact = injury → cold)
  // lights
  G.lights.length = 0;
  for (const f of G.fires) if (f.lit && G.lights.length < 8) G.lights.push({ x: f.x, y: f.y - 11, r: 240 * (1 + 0.08 * (0.6 * Math.sin(G.realTime * 7.3 + f.id * 1.9) + 0.4 * Math.sin(G.realTime * 13.1 + f.id * 3.3))), power: f.power / 4200 * 1.4 * (0.9 + 0.06 * Math.sin(G.realTime * 11 + f.id * 2.7) + Math.random() * 0.08), color: [1, 0.62, 0.32] });
  // audio ambient
  let fireNear = 0; for (const f of G.fires) if (f.lit) fireNear = Math.max(fireNear, 1 - Math.hypot(f.x - pl.x, f.y - pl.y) / 200);
  pt = pnow();
  sound.update({ wind: Math.abs(pl.wind), exposure: 1 - pl.shelter, storm: G.storm, fire: Math.max(0, fireNear), airTemp: pl.airT, night: 1 - G.daylight, coreTemp: pl.core }, dt);
  pend('audio', pt);
  // dawn bonus / win
  const nightsSurvived = Math.floor((G.time - 9 * 60 + 15 * 60) / 1440); // count of 08:30 crossings approx
  if (G.time >= 3 * 1440 + 8.5 * 60 && !ended && pl.alive) { ended = true; sound.dawn(); ui.showEnd(true, '', { days: day, hours: Math.round((G.time - 540) / 60), built: [...tool.built] }, () => { ui.hide(); newGame(); }); }
  if (!pl.alive && !ended) { ended = true; sound.death(); setTimeout(() => ui.showEnd(false, pl.cause, { days: day, hours: Math.round((G.time - 540) / 60), built: [...tool.built] }, () => { ui.hide(); newGame(); }), 1400); }
  void nightsSurvived;
  hintT -= realDt;
  updateEnclosure();   // shelter status at 4 Hz: the chip below and the shelter tips in hint() read it
  // HUD
  const h: HudData = {
    core: pl.core, food: pl.food, stamina: pl.stamina, wet: pl.wet,
    airT: pl.airT, feelT: pl.feelT, wind: pl.wind, shelter: pl.shelter,
    day, clock: clockStr(), night: G.daylight < 0.2, warning: warn,
    tool: tool.cur,
    tools: TOOLS.map((t) => ({ id: t.id, name: t.name, key: t.key, enabled: t.id === 'saw' ? inv.saw : true,
      count: t.id === 'beam' ? inv.logs : t.id === 'block' ? inv.blocks.length : t.id === 'fire' ? Math.min(inv.matches, inv.logs, Math.floor(inv.branches / 2)) : undefined })),
    inv: { logs: inv.logs, branches: inv.branches, matches: inv.matches, food: inv.food + inv.crackers, blocks: inv.blocks.length, snowshoes: inv.snowshoes, thermos: inv.thermos },
    hint: hint(), waiting: G.timeScale > 2,
    ...toolHud(),
    encl: enclNow,
  };
  pt = pnow();
  ui.update(h);
  input.endFrame();
  pend('hud', pt); pt = pnow();
  renderer.render(dt);
  pend('render', pt); pt = pnow();
  drawOverlay(aimWorld, s.moveX);
  pend('overlay', pt);
  if (prof.on) pend('frameJS', t0);
  adaptWork(performance.now() - tw);
}

ui.onSound = (on) => { sound.init(); sound.setMuted(!on); };
sound.setVolume(ui.volume);
ui.onVolume = (v) => { sound.setVolume(v); };

// ---------------- physics lab (pause menu): stress test ----------------
(ui as any).onStress = () => spawnStressTest(40, pl.x, pl.y - 140);
window.addEventListener('keydown', (e) => { if (e.repeat || !running || ended) return; if (e.code === 'KeyK') spawnStressTest(40, pl.x, pl.y - 140); });
setInterval(() => { (ui as any).setPhysInfo?.(`Rapier 2D · ${Math.round(fps)} к/с · тел ${allBodies().size}`); }, 500);

function showTitleScreen() { ui.showTitle(() => { sound.init(); running = true; ui.hide(); last = performance.now(); }); }

// ---------------- benchmark (bench.ts): scripted scenarios through the normal game loop ----------------
const bench = createBench({
  ui, renderer,
  newGame: (seed) => { newGame(seed); },
  setLoop: (r, p) => { running = r; paused = p; if (r) last = performance.now(); },
  snapCam: () => updateCamera(0, true),
  blocked: () => input.mobile && window.innerHeight > window.innerWidth,
  setQuality: (q) => { G.quality = q; renderer.setScaleOverride(null); renderer.setDyn(1); resize(); },
  getViewport: () => ({ w: cssW, h: cssH, dpr }),
  setViewport: (v) => { vpOverride = v; resize(); updateCamera(0, true); },
  mute: (on) => { sound.setMuted(on || !(ui as unknown as { soundOn: boolean }).soundOn); },
  noAdapt: (on) => { (window as unknown as { __noAdapt?: boolean }).__noAdapt = on; AD.n = 0; if (!on && QL) { QL.reset(); applyQLevel(QL.level()); } },   // the bench changed quality: put the ladder's step back
  mobile: () => G.mobile,
  fps: () => fps,
  closed: () => { newGame(); running = false; paused = false; showTitleScreen(); },
});
ui.onBench = (fromPause) => { sound.init(); void bench.start({ source: fromPause ? 'pause' : 'title' }); };

async function boot() {
  qlInit();
  try { await initPhysics(); } catch (e) { console.error('Rapier failed to load', e); }
  newGame();
  requestAnimationFrame(frame);
  setTimeout(() => { try { renderer.prewarm(); } catch (e) { console.warn('shader prewarm', e); } }, 400);
  const bq = /[?&]bench(?:=([a-z]*))?(?:&|$)/.exec(location.search);
  if (bq) { void bench.start({ source: 'url', quick: bq[1] === 'quick' }); }   // ?bench[=quick]: run at once, no title card
  else showTitleScreen();
}
boot();

// ---------------- debug / test API ----------------
(window as unknown as Record<string, unknown>).__frost = {
  G, pl, inv, tool, bodies, mat, dens, bond, W, H, idx, inb, CELL,
  start: () => { running = true; ui.hide(); },
  engine: () => 'rapier', stress: (n: number) => spawnStressTest(n, pl.x, pl.y - 140),
  teleport: (x: number) => { pl.x = x; pl.y = surfaceAt(x) - 1; pl.vy = 0; updateCamera(0, true); },
  give: (k: string, n: number) => { const o = inv as unknown as Record<string, unknown>; if (k === 'blocks') for (let i = 0; i < n; i++) inv.blocks.push(320); else if (typeof o[k] === 'number') o[k] = (o[k] as number) + n; else o[k] = true; },
  setTime: (min: number) => { G.time = min; },
  kill: () => die('тест'),
  // act with a tool at world cell (x,y): primary for `sec` seconds, or one secondary use
  act: (toolId: string, x: number, y: number, secondary = false, sec = 0.5) => {
    const k = TOOLS.findIndex((t) => t.id === toolId); if (k >= 0) tool.cur = k;
    if (secondary) { useSecondary(x, y); return; }
    idleTool(0);
    for (let t = 0; t < sec; t += 1 / 60) usePrimary(x, y, 1 / 60);
    idleTool(0);
  },
  rot: (r: number) => { tool.rot = r; },
  interact: () => interact(),
  eat: () => eat(),
  fps: () => fps, prof, dyn: () => renderer.getDyn(),
  /** touch quality ladder: current step index (-1 on desktop), its state, and the controller factory for synthetic-frame tests */
  qlevel: () => (QL ? QL.level() : -1), qstate: () => (QL ? QL.state() : null), qladder: QLADDER, qctl: createLadder,
  /** automatic benchmark: Promise of the JSON result (see bench.ts); opts: { quick, only: string[] } */
  bench: (opts?: { quick?: boolean; only?: string[] }) => bench.start({ source: 'api', ...opts }),
  benchResult: () => bench.last(),
  benchReport: () => { const r = bench.last(); return r ? makeReport(r) : ''; },
  sawCheck, tutorial: () => tutorial,
  spoil: () => spoilInFlight(), pendingSnow: () => pendingTotal(), P, FORCE,
  aimDig: (x: number, y: number, mv = 0) => { const t = aimTarget(x, y, mv); return { tx: t.tx, ty: t.ty, ok: t.ok, far: t.far, reason: t.reason, snapped: t.snapped, n: t.tiles.length, time: +t.time.toFixed(3), key: t.key }; },
  digState: () => ({ key: DIG.key, p: DIG.p }),
};
void PW; void dens; void bond;
