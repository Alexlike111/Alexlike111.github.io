// TEMPORARY world viewer (world/render agent). The gameplay agent replaces this file: it boots worldgen + render + camera, gives a
// free camera (WASD/arrows/drag), cycles time of day on T and exposes window.__sc for the screenshot tests.
import { G } from './game/state';
import { generateWorld } from './game/worldgen';
import { sites, collectFixtureLights } from './game/locations';
import { initRender, render, resize, addLayer, perf, screenToWorld } from './engine/render';
import { updateCamera } from './engine/camera';
import { drawFixtureSprites, drawFixtureGlow } from './engine/sprites';
import { W, H, mat } from './engine/grid';

const canvas = document.getElementById('world') as HTMLCanvasElement;
G.mobile = matchMedia('(pointer: coarse)').matches;
G.quality = G.mobile ? 1 : 2;

const t0 = performance.now();
const spawn = generateWorld(1);
const genMs = performance.now() - t0;

initRender(canvas);
addLayer(-5, drawFixtureSprites);
addLayer(5, drawFixtureGlow);

// ---- viewer state ----
const cam = { x: spawn.spawnX, y: spawn.spawnY - 14 };
let auroraSetting = 1, viewerLight = false, running = false, shotFrames = 0;
const pressed = new Set<string>();
let shotReady = false;

function applyTime() {
  const h = ((G.time % 1440) + 1440) % 1440 / 60;
  const ss = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  G.daylight = ss(7, 8, h) * (1 - ss(18, 19, h));
  G.moon = 0.8;
  G.aurora = auroraSetting * (1 - G.daylight);
}
G.time = 12 * 60; applyTime();

function setTime(min: number) { G.time = min; applyTime(); }
function teleport(x: number, y: number) { cam.x = x; cam.y = y; updateCamera(0, x, y, true); shotReady = false; shotFrames = 0; }
function setWeather(o: Partial<Pick<typeof G, 'storm' | 'snowfall' | 'visibility' | 'wind' | 'ambientT'>> & { aurora?: number }) {
  if (o.aurora !== undefined) auroraSetting = o.aurora;
  Object.assign(G, { ...o, aurora: G.aurora });
  applyTime();
}
function lightStation(on: boolean) {
  for (const f of G.fixtures) if (f.kind === 'stove' || f.kind === 'campfire' || f.kind === 'torch') { f.lit = on; f.fuel = on ? 600 : 0; }
}

// ---- input ----
addEventListener('keydown', e => {
  pressed.add(e.code);
  if (e.code === 'KeyT') { const presets = [12, 18.3, 21.5, 3, 7.5]; const cur = presets.findIndex(p => Math.abs(((G.time / 60) % 24) - p) < 0.05); setTime(presets[(cur + 1) % presets.length] * 60); }
  if (e.code === 'KeyN') { auroraSetting = auroraSetting ? 0 : 1; applyTime(); }
  if (e.code === 'KeyL') viewerLight = !viewerLight;
  if (e.code === 'KeyF') lightStation(!G.fixtures.some(f => f.lit));
  if (e.code === 'Digit1') setWeather({ storm: 0, snowfall: 0.1, visibility: 1 });
  if (e.code === 'Digit2') setWeather({ storm: 0.3, snowfall: 0.5, visibility: 0.8 });
  if (e.code === 'Digit3') setWeather({ storm: 1, snowfall: 1, visibility: 0.35, wind: 14 });
  if (e.code === 'KeyX') G.xray = G.xray === 3 ? 0 : 3;
});
addEventListener('keyup', e => pressed.delete(e.code));
let drag: { x: number; y: number } | null = null;
canvas.parentElement!.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; });
addEventListener('pointerup', () => { drag = null; });
addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = (e.clientX - drag.x) * (devicePixelRatio / G.cam.scale), dy = (e.clientY - drag.y) * (devicePixelRatio / G.cam.scale);
  cam.x -= dx; cam.y -= dy; drag = { x: e.clientX, y: e.clientY };
});

// ---- loop ----
let last = performance.now(), perfAcc = 0, perfN = 0, perfAvg = 0, perfMax = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  step(dt);
  requestAnimationFrame(frame);
}
function step(dt: number) {
  G.realTime += dt;
  const sp = (pressed.has('ShiftLeft') ? 420 : 140) * dt;
  if (pressed.has('KeyA') || pressed.has('ArrowLeft')) cam.x -= sp;
  if (pressed.has('KeyD') || pressed.has('ArrowRight')) cam.x += sp;
  if (pressed.has('KeyW') || pressed.has('ArrowUp')) cam.y -= sp;
  if (pressed.has('KeyS') || pressed.has('ArrowDown')) cam.y += sp;
  cam.x = Math.max(8, Math.min(W - 8, cam.x)); cam.y = Math.max(8, Math.min(H - 8, cam.y));
  if (running) { G.time += dt * 1.2; applyTime(); }

  // ---- SIM HOOK (gameplay agent): stepSim(dt); stepHeat(dt); stepStructure(dt); stepBodies(dt); stepParticles(dt); stepWeather(dt) go here.
  //      The world renders statically for now. ----

  updateCamera(dt, cam.x, cam.y);
  G.lights.length = 0;
  collectFixtureLights(G.lights);
  if (viewerLight) G.lights.push({ x: G.cam.x, y: G.cam.y, r: 1, g: 0.78, b: 0.5, rad: 9 });
  render(dt);
  perfAcc += perf.total; perfN++; perfMax = Math.max(perfMax, perf.total);
  if (perfN >= 60) { perfAvg = perfAcc / perfN; perfAcc = 0; perfN = 0; }
  if (++shotFrames >= 3) shotReady = true;
}
addEventListener('resize', () => { resize(); });
requestAnimationFrame(frame);

declare global { interface Window { __sc: unknown } }
window.__sc = {
  G, genMs, spawn,
  get ready() { return true; },
  get shotReady() { return shotReady; },
  teleport, setTime, setWeather, lightStation,
  setQuality(q: 0 | 1 | 2) { G.quality = q; },
  run(on: boolean) { running = on; },
  step(frames = 1) { for (let i = 0; i < frames; i++) step(1 / 60); },
  sites: () => sites.map(s => ({ key: s.key, name: s.name, x: s.x, y: s.y, w: s.w, h: s.h })),
  fixtures: () => G.fixtures.map(f => ({ id: f.id, kind: f.kind, tx: f.tx, ty: f.ty, tw: f.tw, th: f.th, n: f.items?.length })),
  perf: () => ({ avg: perfAvg, max: perfMax, last: { ...perf } }),
  cell: (x: number, y: number) => mat[y * W + x],
  screenToWorld,
  viewerLight(on: boolean) { viewerLight = on; },
};
