import { W, H, M, mat, dens, bond, idx, inb, generate, START_X, surfaceAt, crates, CELL } from './world';
import { G } from './state';
import { P } from './particles';
import { initHeat, stepHeat, tempAt } from './heat';
import { stepSim } from './sim';
import { initBodies, stepBodies, bodies } from './bodies';
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
const input = new Input(glCanvas.parentElement || document.body);
const ui = new UI(document.getElementById('ui')!, input);
const sound = new Sound();
bindSound(sound);
let renderer: Renderer;
try { renderer = new Renderer(glCanvas); }
catch (e) { document.body.innerHTML = '<p style="color:#e8f0f6;font:16px system-ui;padding:24px">Нужен браузер с WebGL2 (Chrome, Edge, Safari 15+, Firefox).</p>'; throw e; }

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
function drawOverlay(aim: [number, number] | null) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, fx.width, fx.height);
  const s = G.cam.zoom * dpr;
  ctx.setTransform(s, 0, 0, s, (cssW / 2 - G.cam.x * G.cam.zoom) * dpr + (Math.random() - 0.5) * shake * dpr, (cssH / 2 - G.cam.y * G.cam.zoom) * dpr + (Math.random() - 0.5) * shake * dpr);
  // light on the player from fires & day
  let lit = 0.35 + 0.65 * G.daylight;
  for (const f of G.fires) if (f.lit) lit += Math.max(0, 1 - Math.hypot(f.x - pl.x, f.y - pl.y) / 90) * 0.8;
  lit = Math.min(1.15, lit);
  const sh = (r: number, g: number, b: number, a = 1) => `rgba(${Math.round(r * lit)},${Math.round(g * lit)},${Math.round(b * Math.min(1.1, lit + 0.15))},${a})`;
  const x = pl.x, y = pl.y, f = pl.face;
  const ph = pl.walkPhase * Math.PI * 2;
  const legA = Math.sin(ph) * 0.5 * Math.min(1, Math.abs(pl.vx) / 20);
  ctx.save(); ctx.translate(x, y);
  if (!pl.alive) { ctx.rotate(f * 1.4); ctx.translate(0, -4); }
  const shiver = pl.shiver * (Math.random() - 0.5) * 0.8;
  ctx.translate(shiver, 0);
  // legs (dark wool trousers + felt boots)
  const leg = (a: number) => { ctx.save(); ctx.translate(0, -15); ctx.rotate(a); ctx.fillStyle = sh(38, 44, 58); ctx.fillRect(-2, 0, 4, 12); ctx.fillStyle = sh(70, 52, 40); ctx.fillRect(-2.4, 11, 5 + f * 0.6, 4); if (pl.snowshoes) { ctx.fillStyle = sh(120, 90, 60); ctx.fillRect(-6, 14.3, 12, 1.2); } ctx.restore(); };
  leg(-legA); leg(legA);
  // parka body
  ctx.fillStyle = sh(150, 52, 38);
  ctx.beginPath(); ctx.moveTo(-5.5, -15); ctx.lineTo(5.5, -15); ctx.lineTo(4.5, -29); ctx.quadraticCurveTo(0, -31.5, -4.5, -29); ctx.closePath(); ctx.fill();
  ctx.fillStyle = sh(120, 40, 30); ctx.fillRect(-5.5, -17, 11, 2); // hem
  // backpack
  ctx.fillStyle = sh(78, 86, 60); ctx.fillRect(-f * 7.5 - 2.5, -28, 5, 10);
  // hood with fur ruff
  ctx.fillStyle = sh(150, 52, 38); ctx.beginPath(); ctx.arc(f * 0.5, -32, 4.6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = sh(214, 200, 178); ctx.beginPath(); ctx.arc(f * 1.6, -32, 3.3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = sh(232, 196, 170); ctx.beginPath(); ctx.arc(f * 2.2, -32, 2.1, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = sh(40, 50, 70); ctx.fillRect(f * 2.6 - 0.5, -33, 1, 1); // eye
  // scarf
  ctx.fillStyle = sh(60, 80, 130); ctx.fillRect(-3, -29.5, 6, 2);
  // snow on clothes
  if (pl.snowOn > 0.05) { ctx.fillStyle = `rgba(240,246,255,${Math.min(0.85, pl.snowOn)})`; ctx.fillRect(-4.5, -30, 9, 1.2); ctx.fillRect(-5, -18, 10, 1.5 * pl.snowOn * 2); }
  // arm + tool toward aim
  let ang = f > 0 ? 0.4 : Math.PI - 0.4;
  if (aim) ang = Math.atan2(aim[1] - (y - PH * 0.72), aim[0] - x);
  const swing = pl.work > 0 ? Math.sin(G.realTime * 16) * 0.35 : 0;
  ctx.save(); ctx.translate(0, -PH * 0.72); ctx.rotate(ang + swing);
  ctx.fillStyle = sh(140, 48, 36); ctx.fillRect(0, -1.5, 8, 3);
  ctx.fillStyle = sh(60, 50, 44); ctx.fillRect(7.5, -1.6, 2.4, 3.2); // mitten
  const id = TOOLS[tool.cur].id;
  ctx.translate(9, 0);
  if (id === 'shovel') { ctx.fillStyle = sh(110, 80, 50); ctx.fillRect(-2, -0.6, 14, 1.2); ctx.fillStyle = sh(150, 160, 170); ctx.fillRect(11, -2.8, 6, 5.6); if (tool.load > 0) { ctx.fillStyle = sh(240, 246, 255); ctx.fillRect(11.5, -4 - Math.min(3, tool.load / 14), 5, Math.min(3, tool.load / 14) + 1.4); } }
  else if (id === 'saw') { ctx.fillStyle = sh(110, 80, 50); ctx.fillRect(-1, -1, 4, 2); ctx.fillStyle = sh(175, 182, 190); ctx.fillRect(3, -1.4, 13, 2.8); }
  else if (id === 'axe') { ctx.fillStyle = sh(110, 80, 50); ctx.fillRect(-1, -0.7, 13, 1.4); ctx.fillStyle = sh(120, 128, 136); ctx.beginPath(); ctx.moveTo(10, -1); ctx.lineTo(14, -4); ctx.lineTo(14, 3); ctx.lineTo(10, 1); ctx.fill(); }
  else if (id === 'beam') { ctx.fillStyle = sh(120, 84, 52); ctx.fillRect(-2, -2, 16, 4); }
  else if (id === 'block') { ctx.fillStyle = sh(230, 238, 248); ctx.fillRect(0, -2.5, 10, 5); }
  else { ctx.fillStyle = sh(220, 150, 60); ctx.fillRect(0, -0.5, 4, 1); }
  ctx.restore();
  ctx.restore();
  // aim reticle & ghost
  if (aim && pl.alive) {
    const [ax, ay] = reachPoint(aim[0], aim[1]);
    const id = TOOLS[tool.cur].id;
    ctx.lineWidth = 0.6;
    if (id === 'block' || id === 'beam' || (id === 'saw' && inv.blocks.length > 0 && false)) {
      const g = ghostMargin(id === 'beam' ? 'beam' : 'block', ax, ay);
      const have = id === 'beam' ? inv.logs > 0 : inv.blocks.length > 0;
      const mg = g.blocked ? 0 : g.margin;
      const col = !have ? 'rgba(160,170,190,0.5)' : mg <= 0.02 ? 'rgba(255,92,60,0.75)' : mg < 0.35 ? 'rgba(255,190,70,0.75)' : 'rgba(120,230,160,0.75)';
      ctx.strokeStyle = col; ctx.fillStyle = col.replace(/0\.75\)$/, '0.18)').replace(/0\.5\)$/, '0.12)');
      ctx.fillRect(g.x0, g.y0, g.w, g.h); ctx.strokeRect(g.x0, g.y0, g.w, g.h);
    } else if (id === 'saw') {
      const vert = tool.rot % 2 === 1; const w = vert ? 5 : 10, h = vert ? 10 : 5;
      ctx.strokeStyle = 'rgba(200,225,255,0.8)'; ctx.setLineDash([1.2, 1]); ctx.strokeRect(Math.round(ax - w / 2), Math.round(ay - h / 2), w, h); ctx.setLineDash([]);
      if (tool.sawT > 0) { ctx.fillStyle = 'rgba(255,200,120,0.85)'; ctx.fillRect(Math.round(ax - w / 2), Math.round(ay - h / 2) - 2, w * Math.min(1, tool.sawT / 1.6), 0.8); }
    } else {
      ctx.strokeStyle = inReach(aim[0], aim[1]) ? 'rgba(235,244,255,0.85)' : 'rgba(235,244,255,0.4)';
      ctx.beginPath(); ctx.arc(ax, ay, id === 'shovel' ? 4.5 : 2.5, 0, Math.PI * 2); ctx.stroke();
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
  let dt = Math.min(0.05, (now - last) / 1000); last = now;
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 1) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; if (fps < 40 && G.quality === 1) { lowFpsT++; if (lowFpsT > 3) { G.quality = 0; resize(); } } else lowFpsT = 0; }
  const s = input.state;
  if (s.pausePressed && running && !ended) { paused = !paused; if (paused) ui.showPause(() => { paused = false; ui.hide(); }, () => { ui.hide(); newGame(); }); else ui.hide(); }
  if (!running || paused) { input.endFrame(); renderer.render(dt); drawOverlay(null); return; }
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
  if (s.xrayPressed) G.xray = (G.xray + 1) % 4;
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
  for (const f of G.fires) if (f.lit && G.lights.length < 8) G.lights.push({ x: f.x, y: f.y - 5, r: 160, power: f.power / 4200 * (0.9 + Math.random() * 0.15), color: [1, 0.62, 0.32] });
  // audio ambient
  let fireNear = 0; for (const f of G.fires) if (f.lit) fireNear = Math.max(fireNear, 1 - Math.hypot(f.x - pl.x, f.y - pl.y) / 200);
  sound.update({ wind: Math.abs(pl.wind), exposure: 1 - pl.shelter, storm: G.storm, fire: Math.max(0, fireNear), airTemp: pl.airT, night: 1 - G.daylight, coreTemp: pl.core }, dt);
  // dawn bonus / win
  const nightsSurvived = Math.floor((G.time - 9 * 60 + 15 * 60) / 1440); // count of 08:30 crossings approx
  if (G.time >= 3 * 1440 + 8.5 * 60 && !ended && pl.alive) { ended = true; sound.dawn(); ui.showEnd(true, '', { days: 4, hours: Math.round((G.time - 540) / 60), built: [...tool.built] }, () => { ui.hide(); newGame(); }); }
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
newGame();
requestAnimationFrame(frame);
ui.showTitle(() => { sound.init(); running = true; ui.hide(); last = performance.now(); });

// ---------------- debug / test API ----------------
(window as unknown as Record<string, unknown>).__frost = {
  G, pl, inv, tool, bodies, mat, dens, bond, W, H, idx, inb, CELL,
  start: () => { running = true; ui.hide(); },
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
