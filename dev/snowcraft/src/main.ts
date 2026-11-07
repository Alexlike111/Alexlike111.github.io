/// <reference types="vite/client" />
// SNOWCRAFT — boot, fixed-step game loop, render layers, window.__sc dev/test API (SPEC §8).
// Order inside one 60 Hz step: weather -> player -> tools -> drops -> fixtures -> shelter -> sim -> heat -> structure -> bodies -> particles.
import { G, toast, DIFFS } from './game/state';
import { on, emit } from './game/bus';
import { generateWorld } from './game/worldgen';
import { initRender, render, resize, addLayer, screenToWorld, worldToScreen } from './engine/render';
import { updateCamera, addShake } from './engine/camera';
import { W, H, wakeRect, mat, aux as auxArr, TS } from './engine/grid';
import { WALK } from './content/materials';
import { initSim, stepSim, snowCfg, simStats } from './engine/sim';
import { initHeat, stepHeat, addHeat } from './engine/heat';
import { initStructure, stepStructure } from './engine/structure';
import { stepBodies, clearBodies, drawBodies, clusterHitsBox } from './engine/bodies';
import { stepParticles, clearParticles, drawParticles } from './engine/particles';
import { input, initInput, poll, endFrame, simKey, simMouse, resetInput } from './engine/input';
import { stepZoom, setZoomIndex, zoomIndex, zoomCount, zoomCells, zoomScales, resetZoom } from './engine/zoom';
import { initTouch } from './ui/touch';
import { initZoomUi, updateZoomUi } from './ui/zoomui';
import * as i18nMod from './content/i18n';
import './content/langpacks';          // registers src/content/lang/*.json (translations)
import { initMenu } from './ui/menu';
import { initSenses, toggleSenses } from './engine/senses';
import { initSensesUi } from './ui/sensesui';
import { initHud, updateHud, setFreeCamLabel } from './ui/devhud';
import { initTitle } from './ui/title';
import { initFauna, stepFauna } from './game/fauna';
import * as faunaMod from './game/fauna';
import * as driftMod from './game/drift';
import * as questMod from './game/quest';
import { initDrift, stepDrift, drawDrift } from './game/drift';
import { stepQuest, takeLoaded } from './game/quest';
import { initOverlay, updateOverlay } from './game/overlay';
import * as overlayMod from './game/overlay';
import { resetRun } from './game/runreset';
import { seedStarterDrift } from './game/starter';
import { purgeMethane } from './game/mine';
import { applySave, applyQuestAgain, type SaveData } from './game/save';
import { initWeather, stepWeather, setDay, setClock, wx } from './game/weather';
import { stepUnstuck } from './game/unstuck';
import { initPlayer, stepPlayer, applyDifficulty, damage, die, bodyHeat, body, setRespawn } from './game/player';
import { stepTools, stepDrops, collectHeldLights, target, heldInfo, toolState, cutRegion } from './game/tools';
import { stepFixtures, collectLights, resetFixtures } from './game/fixtures';
import { stepShelter, resetShelter, evalShelterNow } from './game/shelter';
import { giveStartKit, add, inv, select, selected, hitchSled } from './game/inventory';
import { RECIPES, canCraft, craft } from './game/recipes';
import { stationsAt } from './game/fixtures';
import { drawPlayer, drawAnimal, drawFixture, drawFixtureEmissive, setSplitFixturePass, drawDrop, drawTarget, drawSled, type HeldInfo } from './game/draw';
import { initSfxHooks, updateAmbient } from './game/sfxhooks';
import './game/sfxhooks_use';
import { runSelfTest } from './game/selftest';
import * as testkit from './game/testkit';
import * as fixtures from './game/fixtures';
import * as shelter from './game/shelter';
import * as playerMod from './game/player';
import * as toolsMod from './game/tools';
import * as weatherMod from './game/weather';
import * as seasonsMod from './game/seasons';
import * as invMod from './game/inventory';

import.meta.glob('./**/*.selftest.ts', { eager: true });

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('world') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;
G.mobile = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
G.quality = (params.has('q') ? Math.max(0, Math.min(2, +params.get('q')!)) : G.mobile ? 1 : 2) as 0 | 1 | 2;
const ladder = !params.has('q') && !params.has('noladder');

snowCfg.rate = 0.12; snowCfg.curve = 2;          // DESIGN §13: a storm adds ~0.03 cells/s per column (a 12 h storm ~ 9 cells), calm weather almost nothing
const STEP = 1 / 60;
let acc = 0, ready = false, freeCam = false, shotFrames = 0, genMs = 0;
let fpsAvg = 60, fpsMin = 60;
const free = { x: 0, y: 0 };

// ---------------------------------------------------------------------------------------------------------------------
function updateWindow() {
  // margin around the view; shrinks when zoomed out so the simulated area (and its cost) stays near what a default view needs (DESIGN §14)
  const c = G.cam, m = (G.quality === 2 ? 0.28 : G.quality === 1 ? 0.2 : 0.1) * Math.max(0.3, Math.min(1, 420 / Math.max(1, c.viewW)));
  const hw = c.viewW / 2, hh = c.viewH / 2;
  G.win.x0 = Math.max(0, Math.floor(c.x - hw - c.viewW * m)); G.win.x1 = Math.min(W - 1, Math.ceil(c.x + hw + c.viewW * m));
  G.win.y0 = Math.max(0, Math.floor(c.y - hh - c.viewH * m)); G.win.y1 = Math.min(H - 1, Math.ceil(c.y + hh + c.viewH * m));
}

function freeSpot(x: number, y: number): [number, number] {
  // lift the feet out of solids (world generators put spawn on the surface)
  let yy = Math.floor(y);
  for (let k = 0; k < 80; k++) {
    let bad = false;
    for (let j = 1; j <= 20 && !bad; j++) for (let i = -4; i < 4; i++) { const xx = Math.floor(x) + i, y2 = yy - j; if (y2 >= 0 && WALK[mat[y2 * W + xx]]) { bad = true; break; } }
    if (!bad) break; yy--;
  }
  return [x, yy];
}

export interface StartOpts { seed?: number; diff?: 0 | 1 | 2; hardcore?: boolean; save?: SaveData }
function newGame(o: StartOpts = {}) {
  ready = false;
  resetRun();
  if (freeCam) toggleFreeCam();
  const seed = o.seed ?? (params.has('seed') ? +params.get('seed')! : 1);
  G.diff.level = (o.diff ?? (params.has('diff') ? +params.get('diff')! : 1)) as 0 | 1 | 2;
  applyDifficulty(G.diff.level, o.hardcore ?? params.has('hard'));
  const t0 = performance.now();
  G.fixtures.length = 0; G.drops.length = 0; G.animals.length = 0; G.toasts.length = 0; G.lights.length = 0;
  const spawn = generateWorld(seed);
  purgeMethane();
  seedStarterDrift(spawn.spawnX);
  genMs = performance.now() - t0;
  wx.override = null; G.storm = 0; G.timeScale = 1; G.paused = false;
  initWeather(seed);
  clearBodies(); clearParticles(); resetShelter();
  const [sx, sy] = freeSpot(spawn.spawnX, spawn.spawnY);
  initPlayer(sx, sy);
  giveStartKit();
  { const k = inv.slots.findIndex(s => s && s.id === 'shovel'); if (k >= 0 && k < 6) select(k); }       // the first job is digging out the door
  setRespawn(sx, sy);
  if (o.save) applySave(o.save);                       // Продолжить: saved cells / fixtures / body laid over the regenerated world (before the caches are built)
  const px = G.player.x, py = G.player.y;
  updateCamera(0, px, py - 12, true);
  updateWindow();
  initSim(); initStructure(); initHeat();
  { const L = takeLoaded(); initDrift(seed, L?.drift); initFauna(px, py, !!L); }
  wakeRect(px - 80, py - 60, px + 80, py + 40, 120);
  resetInput();
  toolState.dome = false; toolState.smart = false;
  ready = true; shotFrames = 0;
  emit('new_game', { seed });
  if (o.save) applyQuestAgain(o.save);                 // quest.ts resets on 'new_game': lay the saved objective progress back
  takeLoaded();                                         // the save handoff is single-use: never leak into the next New Game
  return { spawnX: sx, spawnY: sy };
}

// ---------------------------------------------------------------------------------------------------------------------
// layers
const heldScratch: HeldInfo = { item: null, aim: 0, swing: 0, using: false, load: 0 };
const pScratch = { ...({} as object) } as typeof G.player;
function initLayers() {
  addLayer(-20, drawBodies);
  addLayer(-12, (ctx, v) => {
    const fx = G.fixtures;
    for (let i = 0; i < fx.length; i++) {
      const f = fx[i];
      if ((f.tx + f.tw + 4) * TS < v.x0 || (f.tx - 4) * TS > v.x0 + v.w || (f.ty + f.th + 8) * TS < v.y0 || (f.ty - 8) * TS > v.y0 + v.h) continue;
      drawFixture(ctx, v, f, v.t);
    }
  });
  setSplitFixturePass(true);
  addLayer(5, (ctx, v) => {
    const fx = G.fixtures;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < fx.length; i++) {
      const f = fx[i]; if (!f.lit) continue;
      if ((f.tx + f.tw + 6) * TS < v.x0 || (f.tx - 6) * TS > v.x0 + v.w || (f.ty + f.th + 10) * TS < v.y0 || (f.ty - 10) * TS > v.y0 + v.h) continue;
      drawFixtureEmissive(ctx, v, f, v.t);
    }
    ctx.restore();
  });
  addLayer(-11, (ctx, v) => {
    const d = G.drops;
    for (let i = 0; i < d.length; i++) { const e = d[i]; if (e.x < v.x0 - 8 || e.x > v.x0 + v.w + 8 || e.y < v.y0 - 8 || e.y > v.y0 + v.h + 8) continue; drawDrop(ctx, v, e, v.t); }
  });
  addLayer(-10, (ctx, v) => { const s = inv.sled; if (s) drawSled(ctx, v, s.x, s.y, s.slots.filter(Boolean).length / 30); });
  addLayer(-9, (ctx, v) => {
    const a = G.animals;
    for (let i = 0; i < a.length; i++) { const e = a[i]; if (e.state === 'hidden' || e.x < v.x0 - 40 || e.x > v.x0 + v.w + 40) continue; drawAnimal(ctx, v, e, v.t); }
  });
  addLayer(-8, (ctx, v) => {
    const p = G.player; if (!p) return;
    Object.assign(pScratch, p); pScratch.y = p.y + body.sink * 0.8;
    drawPlayer(ctx, v, pScratch, heldInfo(heldScratch));
  });
  addLayer(-6, (ctx, v) => drawParticles(ctx, v, false));
  addLayer(10, (ctx, v) => drawParticles(ctx, v, true));
  addLayer(120, (ctx, v) => drawDrift(ctx, v));
  addLayer(150, (ctx, v) => {
    const p = G.player; if (!p || !p.alive || freeCam || G.paused) return;
    const T = target();
    if (T.mode === 'none' && !T.fixture) return;
    drawTarget(ctx, v, T);
  });
  // body overlays: frost creeping over the screen edges, damage flash, hypothermia dimming
  let frostC: HTMLCanvasElement | null = null;
  addLayer(160, (ctx, v) => {
    const p = G.player; if (!p) return;
    const frost = Math.max(p.frost.face / 100 * 0.85, Math.max(0, (35.5 - p.core) / 5) * 0.8);
    if (frost > 0.04) {
      if (!frostC) {
        frostC = document.createElement('canvas'); frostC.width = 64; frostC.height = 36;
        const c = frostC.getContext('2d')!; const g = c.createRadialGradient(32, 18, 8, 32, 18, 40);
        g.addColorStop(0, 'rgba(210,235,255,0)'); g.addColorStop(0.55, 'rgba(210,235,255,0.15)'); g.addColorStop(1, 'rgba(235,248,255,0.95)');
        c.fillStyle = g; c.fillRect(0, 0, 64, 36);
      }
      ctx.globalAlpha = Math.min(1, frost); ctx.imageSmoothingEnabled = true; ctx.drawImage(frostC, 0, 0, v.w, v.h); ctx.imageSmoothingEnabled = false; ctx.globalAlpha = 1;
    }
    if (p.hurtT > 0.05) { ctx.fillStyle = `rgba(200,30,20,${Math.min(0.35, p.hurtT * 0.6)})`; ctx.fillRect(0, 0, v.w, v.h); }
    if (p.sleeping) { ctx.fillStyle = 'rgba(4,8,20,0.45)'; ctx.fillRect(0, 0, v.w, v.h); }
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// one fixed step
function tick(dt: number) {
  const p = G.player;
  stepWeather(dt);
  if (!freeCam) {
    stepPlayer(dt);
    stepUnstuck(dt);
    stepTools(dt);
  } else {
    const sp = (input.run ? 220 : 90) * dt;
    free.x += input.moveX * sp; free.y += (input.jumpHeld ? -sp : input.moveY > 0.5 ? sp : 0);
  }
  stepDrops(dt);
  stepFauna(dt);
  stepDrift(dt);
  stepQuest(dt);
  stepSled(dt);
  stepFixtures(dt);
  stepShelter(dt);
  stepSim(dt); stepHeat(dt); stepStructure(dt);
  const { impacts } = stepBodies(dt);
  void impacts;
  if (p.alive) {
    const h = clusterHitsBox(p.x, p.y, p.w, p.h);
    if (h.hit && h.speed > 35) damage(Math.min(70, 8 + h.mass * h.speed * 0.012), 'collapse');
    bodyHeat();
  }
  stepParticles(dt);
}
function stepSled(dt: number) {
  const s = inv.sled, p = G.player;
  if (!s || !s.hitched || !p) return;
  const want = p.x - p.face * 20;
  s.x += (want - s.x) * Math.min(1, dt * 5);
  if (Math.abs(p.x - s.x) > 30) s.x = p.x - Math.sign(p.x - s.x) * 30;
  let y = Math.floor(p.y) - 6; let n = 0;
  while (y < H - 2 && !WALK[mat[y * W + Math.floor(s.x)]] && n++ < 24) y++;
  s.y = y;
}

let last = performance.now(), fAcc = 0, fN = 0, fMax = 0, ladderT = 0, ladderBad = 0;
function advance(dt: number, realDt: number) {
  acc += dt;
  let n = 0;
  const hadAcc = acc >= STEP;
  if (hadAcc) { updateHud(dt, realDt); }
  while (acc >= STEP && n < 5) {
    if (!G.paused && ready) { G.realTime += STEP; G.frame++; tick(STEP); }
    if (n === 0) endFrame();
    acc -= STEP; n++;
  }
  if (acc > STEP) acc = acc % STEP;
  return n;
}
function frame(now: number) {
  const rawDt = (now - last) / 1000; last = now;
  const dt = Math.min(0.1, rawDt);
  poll();
  if (input.freeCamPressed) { input.freeCamPressed = false; toggleFreeCam(); }
  if (input.sensesPressed) { input.sensesPressed = false; if (ready && !document.body.classList.contains('title-open')) toggleSenses(); }
  const ticks = advance(dt, dt);
  updateOverlay(dt); updateZoomUi();
  void ticks;
  if (ready) {
    const p = G.player;
    if (freeCam) { G.cam.x = free.x; G.cam.y = free.y; } else updateCamera(dt, p.x, p.y - 12);
    updateWindow();
    G.lights.length = 0;
    collectLights(G.lights);
    if (!freeCam) collectHeldLights(G.lights);
    updateAmbient(dt);
    render(dt);
    if (++shotFrames >= 3) shotReady = true;
  }
  // fps bookkeeping + quality ladder (SPEC §8)
  fAcc += rawDt; fN++; if (rawDt > fMax) fMax = rawDt;       // slowest frame -> the real minimum fps
  if (fAcc >= 1) { fpsAvg = fN / fAcc; fpsMin = 1 / Math.max(fMax, 1e-3); fAcc = 0; fN = 0; fMax = 0; }
  if (ladder && ready) {
    ladderT += rawDt;
    if (rawDt > 0.02) ladderBad += rawDt;
    if (ladderT > 3) { if (ladderBad > 2.0 && G.quality > 0) { G.quality = (G.quality - 1) as 0 | 1; resize(); } ladderT = 0; ladderBad = 0; }
  }
  requestAnimationFrame(frame);
}
let shotReady = false;

function toggleFreeCam() {
  freeCam = !freeCam; free.x = G.cam.x; free.y = G.cam.y; setFreeCamLabel(freeCam);
}

// ---------------------------------------------------------------------------------------------------------------------
// deaths from the world
on('hurt', () => { if (navigator.vibrate) { try { navigator.vibrate(30); } catch { /* ignore */ } } });
on('died', () => { if (navigator.vibrate) { try { navigator.vibrate([80, 40, 120]); } catch { /* ignore */ } } });

// ---------------------------------------------------------------------------------------------------------------------
// dev / test API
function aimAtWorld(x: number, y: number) {
  const [sx, sy] = worldToScreen(x, y);
  input.aimX = sx; input.aimY = sy; input.hasAim = true; input.aimMode = 'mouse';
}
function stepFrames(n: number, render_ = true) {
  for (let i = 0; i < n; i++) { poll(); advanceOne(); }
  if (render_ && ready) { updateCamera(0.016, G.player.x, G.player.y - 12); updateWindow(); G.lights.length = 0; collectLights(G.lights); collectHeldLights(G.lights); render(1 / 60); }
}
function advanceOne() { acc += STEP; updateHudSafe(); if (!G.paused) { G.realTime += STEP; G.frame++; tick(STEP); } endFrame(); acc = 0; }
function updateHudSafe() { updateHud(STEP, STEP); }

const sc = {
  G, ready: false as boolean, get shotReady() { return shotReady; }, get genMs() { return genMs; },
  start: (o?: StartOpts) => newGame(o),
  step: (frames = 1) => stepFrames(frames),
  stepFast: (frames = 1) => stepFrames(frames, false),
  teleport(x: number, y: number) {
    const [fx, fy] = freeSpot(x, y);
    const p = G.player; p.x = fx; p.y = fy; p.vx = p.vy = 0;
    updateCamera(0, fx, fy - 12, true); updateWindow(); wakeRect(fx - 80, fy - 60, fx + 80, fy + 40, 90);
    shotReady = false; shotFrames = 0;
    return [fx, fy];
  },
  give: (id: string, n = 1, dur?: number) => add(id, n, dur),
  select: (i: number) => select(i),
  selectItem(id: string) { const i = inv.slots.findIndex((s, k) => s && s.id === id && k < 6); if (i >= 0) { select(i); return true; } const j = inv.slots.findIndex(s => s && s.id === id); if (j < 0) return false; const k = inv.slots.findIndex((s, q) => !s && q < 6); const slot = k >= 0 ? k : 5; const t = inv.slots[slot]; inv.slots[slot] = inv.slots[j]; inv.slots[j] = t; select(slot); return true; },
  setTime: (min: number) => setClock(min),
  setDay: (n: number, hour = 10) => setDay(n, hour),
  setWeather(o: Partial<Pick<typeof G, 'storm' | 'snowfall' | 'visibility' | 'wind' | 'ambientT' | 'aurora' | 'daylight'>> | null) { wx.override = o; if (o) Object.assign(G, o); else setClock(G.time); },
  aim: aimAtWorld,
  render: (dt = 0) => { updateWindow(); render(dt); },
  act(kind: string, x: number, y: number, seconds = 0.5) {
    if (kind === 'interact') { aimAtWorld(x, y); input.interactPressed = true; stepFrames(2); return; }
    render(0);
    aimAtWorld(x, y);
    simMouse(0, true);
    stepFrames(Math.max(2, Math.round(seconds * 60)), false);
    simMouse(0, false);
    stepFrames(1);
  },
  place(id: string, tx: number, ty: number) {
    if (!invMod.count(id)) add(id, 1);
    sc.selectItem(id);
    render(0);
    aimAtWorld(tx * TS + 2, ty * TS + 2);
    input.hasAim = true; input.aimMode = 'mouse';
    const before = invMod.count(id);
    simMouse(0, true); stepFrames(3, false); simMouse(0, false); stepFrames(1);
    const T = target();
    return { placed: invMod.count(id) < before, ok: T.ok, reason: T.reason };
  },
  craft(which: number | string) {
    const r = typeof which === 'number' ? RECIPES[which] : RECIPES.find(x => x.result === which || x.key === which);
    if (!r) return false;
    const p = G.player;
    return craft(r, stationsAt(p.x, p.y - 8), playerMod.handsFrozen());
  },
  canCraft(which: string) { const r = RECIPES.find(x => x.result === which || x.key === which); if (!r) return null; const p = G.player; return canCraft(r, stationsAt(p.x, p.y - 8), playerMod.handsFrozen()); },
  key: (code: string, down = true) => simKey(code, down),
  tap(code: string) { simKey(code, true); stepFrames(2, false); simKey(code, false); stepFrames(1, false); },
  mouse: simMouse,
  kill: (cause = 'cold') => die(cause),
  eat: () => playerMod.eatBest(),
  sleep: (force = true) => playerMod.startSleep(force),
  hitchSled: () => hitchSled(G.player.x, G.player.y),
  evalShelter: () => { evalShelterNow(); return G.shelter; },
  stats() {
    const p = G.player;
    return {
      time: G.time, day: G.day, cycle: G.cycle, hour: +(((G.time % 1440) / 60).toFixed(2)), sunElev: G.sunElev, daylight: G.daylight, ambientT: G.ambientT, wind: G.wind, storm: G.storm,
      x: p.x, y: p.y, hp: p.hp, core: p.core, water: p.water, food: p.food, energy: p.energy, wet: p.wet, co: p.co, frost: { ...p.frost }, airT: p.airT, feelT: p.feelT, alive: p.alive, cause: p.cause,
      sleeping: p.sleeping, shelter: G.shelter ? { ...G.shelter } : null, weight: invMod.weight(), met: body.met, loss: body.loss, net: body.net,
      belt: inv.slots.slice(0, 6).map(s => s && { id: s.id, n: s.n, dur: s.dur }), sel: inv.sel, fixtures: G.fixtures.length, drops: G.drops.length, quality: G.quality,
    };
  },
  fps: () => ({ avg: fpsAvg, min: fpsMin }),
  arena: (cx = 1000, y = 270, o?: testkit.ArenaOpts) => { const a = testkit.arena(cx, y, o); return a; },
  testkit,
  cell: (x: number, y: number) => mat[y * W + x],
  aux: (x: number, y: number) => auxArr[y * W + x],
  /** ASCII picture of a region (dev): one char per `step` cells. */
  ascii(x0: number, y0: number, x1: number, y1: number, step = 1) {
    const ch = '.sPBi~dgSHXWnLpbcQQQaeEZ%%mMlLoOMXfGw?SLa????';
    const out: string[] = [];
    for (let y = y0; y <= y1; y += step) { let r = ''; for (let x = x0; x <= x1; x += step) r += ch[mat[y * W + x]] ?? '?'; out.push(r); }
    return out.join('\n');
  },
  selftest: (filter?: string) => runSelfTest(filter),
  cutRegion, selected,
  mods: { i18n: i18nMod, fixtures, shelter, player: playerMod, tools: toolsMod, weather: weatherMod, seasons: seasonsMod, overlay: overlayMod, inv: invMod, fauna: faunaMod, drift: driftMod, quest: questMod },
  screenToWorld, worldToScreen,
  senses: (on?: boolean) => { toggleSenses(on); },
  freeCam: (on?: boolean) => { if (on === undefined || on !== freeCam) toggleFreeCam(); },
  setQuality(q: 0 | 1 | 2) { G.quality = q; resize(); },
  simStats, snowCfg,
  zoom: { step: stepZoom, set: setZoomIndex, index: zoomIndex, count: zoomCount, cells: zoomCells, scales: () => zoomScales(), reset: resetZoom },
  viewerLight() { /* kept for old harnesses */ },
};
declare global { interface Window { __sc: typeof sc } }
window.__sc = sc;

// ---------------------------------------------------------------------------------------------------------------------
async function boot() {
  { // language: ?lang=xx, else the stored choice, else Russian for the automated tests (navigator.webdriver) and for #selftest (the checks read the Russian wording), else the browser's
    let L: string | null = params.get('lang'); const ok = (x: string | null) => (i18nMod.LANGS as readonly string[]).includes(x ?? '');
    if (!ok(L)) { try { L = localStorage.getItem('sc.lang'); } catch { L = null; } }
    if (!ok(L)) L = (navigator as Navigator & { webdriver?: boolean }).webdriver || location.hash.includes('selftest') ? 'ru' : i18nMod.detectLang();
    i18nMod.setLang(L as i18nMod.Lang); }
  initRender(canvas);
  initInput(canvas);
  initHud(uiRoot);
  initTouch(uiRoot);
  initZoomUi(uiRoot);
  initMenu(uiRoot);
  initOverlay(uiRoot, { start: (o) => { newGame(o); }, restart: () => { newGame({ seed: G.seed, diff: G.diff.level, hardcore: G.diff.hardcore }); } });
  initSfxHooks();
  initLayers();
  initSenses(); initSensesUi(uiRoot);
  addEventListener('resize', () => { resize(); });
  newGame();
  void initTitle({ start: (o) => { newGame(o); } });
  sc.ready = true;
  requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });
  void DIFFS; void toast; void addHeat; void screenToWorld;
  if (location.hash.includes('selftest')) setTimeout(() => { void runSelfTest(); }, 800);
}
boot();
