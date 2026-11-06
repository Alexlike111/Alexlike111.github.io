// Standalone world viewer (dev tool): the generated world + free camera + keys to step the polar-night calendar (day 1..12), time of day,
// storm, aurora and moon phase. Serve with `npx vite --port 5181` and open http://localhost:5181/tests/viewer.html
// Playwright drives it through window.__view (see tests/world-shots.mjs). No simulation runs here: the world is static on purpose.
import { G } from '../game/state';
import { generateWorld, worldInfo } from '../game/worldgen';
import { sites, collectFixtureLights, LOC } from '../game/locations';
import { initRender, render, resize, addLayer, perf, screenToWorld } from '../engine/render';
import { updateCamera } from '../engine/camera';
import { W, H, mat, aux, flags, shade, wake } from '../engine/grid';
import { MAT } from '../content/materials';
import type { View } from '../game/state';

const canvas = document.getElementById('world') as HTMLCanvasElement;
const hud = document.getElementById('hud')!, help = document.getElementById('help')!;
G.mobile = matchMedia('(pointer: coarse)').matches;
G.quality = G.mobile ? 1 : 2;
let seed = 1;
const t0 = performance.now();
const spawn = generateWorld(seed);
const genMs = performance.now() - t0;
initRender(canvas);

// ---------------------------------------------------------------------------------------------------------------------
// clock: same formulas as game/weather.ts (duplicated so the viewer has no gameplay dependencies)
const ss = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const noonElevAt = (tm: number) => clamp(-9 + 9.5 * ((tm / 1440 - 0.5) / 11), -9.5, 1.2);
const sunElevAt = (tm: number) => { const h = ((tm % 1440) + 1440) % 1440 / 60; return noonElevAt(tm) - 17 * (1 - Math.cos(2 * Math.PI * (h - 12) / 24)) / 2; };
const st = { day: 6, hour: 12, storm: 0, aurora: -1 as number, moon: -1 as number, lamp: false, lit: false };
const igloos: { x: number; y: number }[] = [];
const extraLights: { x: number; y: number; r: number; g: number; b: number; rad: number }[] = [];

function applyClock() {
  const tm = (st.day - 1) * 1440 + st.hour * 60;
  G.time = tm; G.day = st.day;
  G.noonElev = noonElevAt((st.day - 1) * 1440 + 720);
  G.sunElev = sunElevAt(tm);
  G.daylight = Math.pow(ss(-10.5, 0.5, G.sunElev), 1.15);
  const p = st.moon >= 0 ? st.moon : (((0.5 + (tm / 1440 - 5.5) / 29.53) % 1) + 1) % 1;
  G.moonPhase = p;
  const illum = (1 - Math.cos(2 * Math.PI * p)) / 2;
  const up = ss(-0.3, 0.7, -Math.cos(2 * Math.PI * (st.hour / 24 - p)));
  G.moon = illum * (0.3 + 0.7 * up);
  G.storm = st.storm;
  G.wind = st.storm > 0 ? 14 : 3;
  G.snowfall = st.storm > 0 ? 1 : 0.12;
  G.visibility = st.storm > 0 ? 0.38 : 1;
  const base = st.aurora >= 0 ? st.aurora : 0.75;
  G.aurora = base * (1 - Math.min(1, st.storm * 1.5));
  G.ambientT = -28;
}
applyClock();

// ---------------------------------------------------------------------------------------------------------------------
// camera + input
const cam = { x: spawn.spawnX, y: spawn.spawnY - 14 };
const pressed = new Set<string>();
let shotFrames = 0, shotReady = false;
function teleport(x: number, y: number) { cam.x = x; cam.y = y; updateCamera(0, x, y, true); shotReady = false; shotFrames = 0; }
const ZONES: Record<string, [number, number]> = {
  cape: [150, 168], summit: [150, 168], portal: [330, 246], mineA: [276, 250], collapse: [236, 250], ramp: [150, 296], hut: [153, 316], methane: [92, 318], lake: [322, 360],
  cairn: [445, 224], tundra: [500, 244], station: [654, 252], house: [654, 252], shed: [812, 254], mast: [770, 254],
  beach: [960, 268], whale: [1010, 262], tide: [1090, 282], fast: [1200, 282], seal: [1150, 280], iceberg: [1372, 262], icecave: [1372, 268],
  pack: [1560, 280], ridge: [1556, 276], lead: [1605, 284], ship: [1752, 262], cabin: [1692, 272], hold: [1790, 306], sea: [1990, 282],
};
const KEYZONE: Record<string, string> = { Digit1: 'cape', Digit2: 'portal', Digit3: 'hut', Digit4: 'lake', Digit5: 'cairn', Digit6: 'station', Digit7: 'beach', Digit8: 'seal', Digit9: 'iceberg', Digit0: 'pack', Minus: 'ship', Equal: 'sea' };
function goZone(k: string) { const z = ZONES[k]; if (z) teleport(z[0], z[1]); }

function setStorm(v: number | boolean) { st.storm = typeof v === 'boolean' ? (v ? 1 : 0) : v; applyClock(); }
function lampOn(on: boolean) { st.lamp = on; }
function fixturesLit(on: boolean) { st.lit = on; for (const f of G.fixtures) if (f.kind === 'stove' || f.kind === 'campfire' || f.kind === 'torch' || f.kind === 'fat_lamp') { f.lit = on; f.fuel = on ? 600 : 0; } }
/** Build an igloo (snow-block dome with an entrance tunnel) on the ground under x, with a fat lamp inside. */
function igloo(x: number) {
  x = Math.round(x);
  let top = 100; while (top < H - 1 && (mat[top * W + x] === MAT.AIR || mat[top * W + x] === MAT.FIXTURE)) top++;
  const rx = 22, ry = 19, floor = Math.floor(top / 4) * 4;       // tile aligned floor line
  const cy = floor;
  for (let y = cy - ry - 6; y <= cy + 3; y++) for (let xx = x - rx - 8; xx <= x + rx + 22; xx++) {
    const dx = (xx - x) / rx, dy = (y - cy) / ry, d = Math.hypot(dx, dy);
    const i = y * W + xx;
    if (y < cy && d <= 1 + 4.5 / rx) { if (d >= 1) { mat[i] = MAT.SNOWBLOCK; aux[i] = 150; flags[i] = 2; } else { mat[i] = MAT.AIR; aux[i] = 0; flags[i] = 0; } }
  }
  // entrance tunnel to the east, low and long (cold trap below the sleeping platform)
  for (let xx = x + rx - 2; xx < x + rx + 18; xx++) for (let y = cy - 14; y < cy; y++) { const i = y * W + xx; const wall = y < cy - 10; mat[i] = wall ? MAT.SNOWBLOCK : MAT.AIR; aux[i] = 150; flags[i] = wall ? 2 : 0; }
  for (let xx = x - rx; xx < x + rx + 18; xx++) for (let y = cy; y < cy + 3; y++) { const i = y * W + xx; mat[i] = MAT.PACKED; aux[i] = 190; }
  // outside piled snow
  for (let xx = x - rx - 6; xx < x - rx; xx++) for (let k = 0; k < (xx - (x - rx - 6)) * 0.6; k++) { const i = (cy - 1 - k) * W + xx; if (mat[i] === MAT.AIR) { mat[i] = MAT.PACKED; aux[i] = 150; } }
  igloos.push({ x, y: cy });
  extraLights.push({ x, y: cy - 8, r: 1.0, g: 0.66, b: 0.3, rad: 8 });
  wake(x, cy);
  return { x, y: cy };
}

addEventListener('keydown', e => {
  pressed.add(e.code);
  const c = e.code;
  if (c === 'BracketLeft' || c === 'PageDown') { st.day = Math.max(1, st.day - 1); applyClock(); }
  if (c === 'BracketRight' || c === 'PageUp') { st.day = Math.min(12, st.day + 1); applyClock(); }
  if (c === 'Comma') { st.hour = (st.hour + 23.5) % 24; applyClock(); }
  if (c === 'Period') { st.hour = (st.hour + 0.5) % 24; applyClock(); }
  if (c === 'KeyT') { const pre = [12, 15, 18, 22, 0, 4, 9]; const i = pre.findIndex(p => Math.abs(st.hour - p) < 0.01); st.hour = pre[(i + 1) % pre.length]; applyClock(); }
  if (c === 'KeyS') setStorm(st.storm > 0 ? 0 : 1);
  if (c === 'KeyN') { st.aurora = st.aurora < 0 ? 0 : st.aurora === 0 ? 1 : -1; applyClock(); }
  if (c === 'KeyM') { st.moon = st.moon < 0 ? 0.02 : st.moon < 0.1 ? 0.27 : st.moon < 0.4 ? 0.5 : -1; applyClock(); }
  if (c === 'KeyL') lampOn(!st.lamp);
  if (c === 'KeyF') fixturesLit(!st.lit);
  if (c === 'KeyI') igloo(cam.x);
  if (c === 'KeyX') G.xray = G.xray === 3 ? 0 : 3;
  if (c === 'KeyH') help.style.display = help.style.display === 'block' ? 'none' : 'block';
  if (c === 'KeyR') regen(seed + 1);
  if (KEYZONE[c]) goZone(KEYZONE[c]);
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
function regen(s: number) { seed = s; igloos.length = 0; extraLights.length = 0; generateWorld(seed); fixturesLit(st.lit); }

// fixtures as simple coloured blocks (the real sprites belong to the art pass; this keeps interiors readable)
const FX: Record<string, string> = { stove: '#c4622d', bed: '#4f6f9a', table: '#8a6a44', shelf: '#7a5a3a', chest: '#9a7440', radio: '#4a5a52', drum: '#3d6aa0', door: '#6e4a2c', barometer: '#d8d2b8', flag: '#c04040', mast: '#8a949c', kennel: '#7c5c3c', cart: '#5a4a3a', signal_fire: '#7a5a3a', campfire: '#a0501c', fat_lamp: '#d8a84a', torch: '#d8a84a' };
addLayer(-5, (ctx, v: View) => {
  for (const f of G.fixtures) {
    const x = f.tx * 4 - v.x0, y = f.ty * 4 - v.y0, w = f.tw * 4, h = f.th * 4;
    if (x > v.w || y > v.h || x + w < 0 || y + h < 0) continue;
    if (f.kind === 'door' && f.open) continue;
    ctx.fillStyle = FX[f.kind] || '#8a6a4a'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(x, y, w, 1);
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(x, y + h - 1, w, 1);
    if (f.kind === 'chest') { ctx.fillStyle = '#3a2a18'; ctx.fillRect(x + 1, y + (h >> 1), w - 2, 1); ctx.fillStyle = '#d0b050'; ctx.fillRect(x + (w >> 1) - 1, y + (h >> 1) - 1, 2, 3); }
    if (f.kind === 'stove') { ctx.fillStyle = f.lit ? '#ffb050' : '#2a2018'; ctx.fillRect(x + 2, y + h - 5, w - 4, 3); }
  }
});
addLayer(5, (ctx, v: View) => {          // emissive: glow of lit things (windows & stoves)
  ctx.fillStyle = 'rgba(255,170,80,.35)';
  for (const f of G.fixtures) if (f.lit && f.kind !== 'chest') { const x = f.tx * 4 - v.x0, y = f.ty * 4 - v.y0; ctx.fillRect(x + 2, y + f.th * 4 - 6, f.tw * 4 - 4, 4); }
});

// ---------------------------------------------------------------------------------------------------------------------
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
  if (pressed.has('KeyS') && !pressed.has('KeyW') && false) cam.y += sp;
  if (pressed.has('ArrowDown')) cam.y += sp;
  cam.x = Math.max(8, Math.min(W - 8, cam.x)); cam.y = Math.max(8, Math.min(H - 8, cam.y));
  updateCamera(dt, cam.x, cam.y);
  G.lights.length = 0;
  collectFixtureLights(G.lights);
  for (const l of extraLights) G.lights.push(l);
  if (st.lamp) G.lights.push({ x: G.cam.x, y: G.cam.y, r: 1, g: 0.78, b: 0.5, rad: 9 });
  render(dt);
  perfAcc += perf.total; perfN++; perfMax = Math.max(perfMax, perf.total);
  if (perfN >= 60) { perfAvg = perfAcc / perfN; perfAcc = 0; perfN = 0; }
  if (++shotFrames >= 4) shotReady = true;
  if ((G.frame & 7) === 0) hud.textContent = `день ${st.day} · ${String(Math.floor(st.hour)).padStart(2, '0')}:${st.hour % 1 ? '30' : '00'} · солнце ${G.sunElev.toFixed(1)}° (полдень ${G.noonElev.toFixed(1)}°) · луна ${G.moonPhase.toFixed(2)}${st.storm ? ' · ПУРГА' : ''}   x=${cam.x | 0} y=${cam.y | 0}   [H] справка`;
}
addEventListener('resize', () => { resize(); });
requestAnimationFrame(frame);

declare global { interface Window { __view: unknown } }
window.__view = {
  G, genMs, spawn, worldInfo, LOC,
  get ready() { return true; },
  get shotReady() { return shotReady; },
  setDay(d: number) { st.day = clamp(Math.round(d), 1, 12); applyClock(); },
  setHour(h: number) { st.hour = ((h % 24) + 24) % 24; applyClock(); },
  setStorm, setAurora(v: number) { st.aurora = v; applyClock(); }, setMoon(p: number) { st.moon = p; applyClock(); },
  lamp: lampOn, lit: fixturesLit, igloo, goZone, teleport, zones: () => Object.keys(ZONES),
  clearIgloos() { extraLights.length = 0; },
  hud(on: boolean) { document.body.classList.toggle('shot', !on); },
  setQuality(q: 0 | 1 | 2) { G.quality = q; },
  step(frames = 1) { for (let i = 0; i < frames; i++) step(1 / 60); },
  sites: () => sites.map(s => ({ key: s.key, name: s.name, x: s.x, y: s.y, w: s.w, h: s.h })),
  fixtures: () => G.fixtures.map(f => ({ id: f.id, kind: f.kind, tx: f.tx, ty: f.ty, tw: f.tw, th: f.th, n: f.items?.length })),
  perf: () => ({ avg: perfAvg, max: perfMax, last: { ...perf } }),
  cell: (x: number, y: number) => mat[y * W + x],
  screenToWorld, shade,
};
