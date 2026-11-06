// Gear for «Белая Мгла»: the sled that trails the hero, snowshoes worn or not, torches planted in the snow, the light of the
// hand torch and the lantern, sleeping in the bag (G.sleeping, sleepTick), and the drawing of all of it.
// Pure state + drawing: imports world (surface), state (G), items / craft (pack, bag rules). It does not import tools.ts (no cycle);
// tools.ts and main.ts call into it. Units: world cells (5 cm), y grows downward, (x, y) of the hero are his feet.
import { W, surfaceAt } from './world';
import { G, type Light } from './state';
import { has, count, take, add, type Pack } from './items';
import { canSleep, burnTorch, pot, potPhase, benches, SLEEP_WAKE_C, TORCH_MIN, type CraftResult } from './craft';

/** The sled trails this many cells behind the hero (0.9 m: the rope is slack when he stands still). */
export const ROPE = 18;
/** Walking with a sled in tow costs the hero this share of his speed while the sled moves. */
const SLED_DRAG = 0.85;
/** Torches the hero can plant in the snow at once. */
export const MAX_PLANTED = 4;
/** Hour (game minutes into the day) of the first light; a night sleep ends there. */
const MORNING = 8.5 * 60;
/** A nap in daylight (sleep started between 08:30 and 16:40) ends after this many game minutes. */
const NAP_MIN = 180;

export interface PlantedTorch { x: number; y: number; fuel: number }

/** Gear state that belongs to the world, not to the pack: worn flag, sled position, planted torches, the sleep. */
export const gear = {
  shoesOn: true,            // snowshoes on the feet (only when owned)
  sledX: NaN,               // sled centre column; NaN until the sled is first owned
  sledY: 0,                 // sled surface row
  sledMoving: false,        // the sled moved this frame (the hero pulls it: drag)
  torches: [] as PlantedTorch[],
  sleepFrom: 0,             // G.time when the sleep began
  sleepEnd: 0,              // G.time at which a nap / night sleep ends by itself (0 = never)
  wakeWhy: '',              // why the last sleep ended (a hint line)
};

/** Clears the gear state for a new game. */
export function resetGear(): void {
  gear.shoesOn = true; gear.sledX = NaN; gear.sledY = 0; gear.sledMoving = false; gear.torches.length = 0;
  gear.sleepFrom = 0; gear.sleepEnd = 0; gear.wakeWhy = '';
  G.sleeping = false;
}

/** Carry caps: logs 6 by hand, 12 with the sled; blocks 8 by hand, 24 with the sled (spec «Санки»). */
export function carryCap(pack: Pack, kind: 'logs' | 'blocks'): number {
  const sled = has(pack, 'sled');
  return kind === 'logs' ? (sled ? 12 : 6) : (sled ? 24 : 8);
}

/** Snowshoes: owned and worn. Toggles worn; false when not owned. */
export function toggleShoes(pack: Pack): boolean {
  if (!has(pack, 'snowshoes')) return false;
  gear.shoesOn = !gear.shoesOn;
  return true;
}

/** The hero as the gear code reads him. snowshoes and sledDrag are written back for player.ts. */
export interface GearHero { x: number; y: number; face: number; snowshoes: boolean; sledDrag: number }

/**
 * One frame of gear (dt real seconds, gm game minutes of the frame = realDt * G.timeScale).
 * held: the id of the tool in hand (TOOLS id). Burns the hand torch (torch in hand) or the lantern (1/3 rate), the planted torches,
 * moves the sled behind the hero and sets the snowshoes flag for player.ts.
 */
export function stepGear(dt: number, gm: number, hero: GearHero, pack: Pack, held: string): void {
  hero.snowshoes = has(pack, 'snowshoes') && gear.shoesOn;
  hero.sledDrag = 1;
  gear.sledMoving = false;
  if (has(pack, 'sled')) {
    if (!Number.isFinite(gear.sledX)) gear.sledX = hero.x - hero.face * ROPE;
    const want = hero.x - hero.face * ROPE;
    const dx = want - gear.sledX;
    if (Math.abs(dx) > 0.05) {
      // the sled runs at the hero's pace (up to 45 cells/s = 2.2 m/s) and catches up quickly when he stops
      const sp = Math.min(Math.abs(dx), (45 + 3 * Math.abs(dx)) * dt);
      gear.sledX += Math.sign(dx) * sp;
      gear.sledMoving = sp > 0.02;
    }
    gear.sledX = Math.max(4, Math.min(W - 4, gear.sledX));
    gear.sledY = surfaceAt(Math.round(gear.sledX));
    if (gear.sledMoving) hero.sledDrag = SLED_DRAG;
  }
  for (let k = gear.torches.length - 1; k >= 0; k--) {
    gear.torches[k].fuel -= gm;
    if (gear.torches[k].fuel <= 0) gear.torches.splice(k, 1);
  }
  if (count(pack, 'torchFuel') > 0) {
    if (held === 'torch') burnTorch(pack, gm);
    else if (has(pack, 'lantern')) burnTorch(pack, gm / 3);
  }
}

/** Heat a lit hand torch gives the hero (W, player.ts adds it to the radiant term). */
export const TORCH_HEAT_W = 150;

/** Lights for G.lights (main clears the list each frame and calls this after the fires): hand torch, lantern, planted torches. */
export function gearLights(pack: Pack, held: string, hero: { x: number; y: number; face: number }, out: Light[]): void {
  const flick = 0.92 + 0.08 * Math.sin(G.realTime * 13.7) + 0.04 * Math.sin(G.realTime * 5.1);
  if (out.length >= 8) return;
  if (held === 'torch' && count(pack, 'torchFuel') > 0) {
    out.push({ x: hero.x + hero.face * 6, y: hero.y - 24, r: 80, power: 0.6 * flick, color: [1, 0.72, 0.42] });
  } else if (has(pack, 'lantern') && count(pack, 'torchFuel') > 0) {
    out.push({ x: hero.x, y: hero.y - 22, r: 150, power: 0.7, color: [1, 0.8, 0.52] });
  }
  for (const t of gear.torches) if (out.length < 8) out.push({ x: t.x, y: t.y - 10, r: 80, power: 0.55 * flick, color: [1, 0.72, 0.42] });
}

/** Torch in hand (held and lit) gives heat: TORCH_HEAT_W, else 0. */
export function torchHeat(pack: Pack, held: string): number {
  return held === 'torch' && count(pack, 'torchFuel') > 0 ? TORCH_HEAT_W : 0;
}

/**
 * Plants the lit hand torch in the snow at (x, y): it keeps burning there (TORCH_MIN game minutes at most, the fuel it has left).
 * The caller checks that the spot is snow under the aim, in reach.
 */
export function plantTorch(pack: Pack, x: number, y: number): CraftResult {
  const f = count(pack, 'torchFuel');
  if (f <= 0) return { ok: false, msg: 'Факел не горит: зажги его (ЛКМ)', variant: -1 };
  if (gear.torches.length >= MAX_PLANTED) return { ok: false, msg: `Больше ${MAX_PLANTED} факелов в снегу не держат`, variant: -1 };
  take(pack, 'torchFuel', f);
  gear.torches.push({ x: Math.round(x), y: Math.round(y), fuel: f });
  return { ok: true, msg: `Факел воткнут в снег: горит ещё ${Math.round(f)} мин`, variant: -1 };
}

/** Lights a spare torch from the pack for the hand (craft lightTorch). Kept here so tools.ts has one place for the torch rules. */
export function lightSpare(pack: Pack): CraftResult {
  if (count(pack, 'torchFuel') > 0) return { ok: false, msg: 'Факел уже горит', variant: -1 };
  if (!take(pack, 'torches', 1)) return { ok: false, msg: 'Нет факелов. Сделай из ветки и смолы или верёвки', variant: -1 };
  add(pack, 'torchFuel', TORCH_MIN);
  return { ok: true, msg: `Факел зажжён: ${TORCH_MIN} мин`, variant: -1 };
}

// ---------------- sleep ----------------

export interface SleepIn {
  want: boolean;        // «Ждать» is on and the spot is fit to wait in (shelter or a lit fire)
  moving: boolean;      // moving, jumping or using a tool: the sleeper wakes
  nearFire: boolean;    // a lit fire within reach
  shelter: number;      // 0..1
  airT: number;         // air temperature at the hero, °C
  core: number;         // core temperature, °C
  shiver: number;       // 0..1 shivering
}
export type SleepEvent = 'sleep' | 'woke' | null;

/** Start and end of the sleep. Starts from «Ждать» with a sleeping bag in the pack, in a shelter or by a fire (craft canSleep).
 *  Ends on movement, when the cold wakes the sleeper (core below 35.5 °C, shivering, air below −15 °C with no fire), at dawn, or after a nap. */
export function sleepTick(pack: Pack, s: SleepIn): SleepEvent {
  if (!G.sleeping) {
    if (!s.want || s.moving || !has(pack, 'sleepingBag')) return null;
    if (!canSleep(s.shelter, s.airT, s.nearFire, true).ok) return null;
    G.sleeping = true;
    gear.sleepFrom = G.time;
    const day = G.time % 1440;
    const nap = day >= MORNING && day < 16.67 * 60;
    const dayStart = Math.floor(G.time / 1440) * 1440;
    gear.sleepEnd = nap ? G.time + NAP_MIN : dayStart + MORNING + (day >= MORNING ? 1440 : 0);
    gear.wakeWhy = '';
    return 'sleep';
  }
  let why = '';
  if (s.moving) why = 'Ты проснулся: двинулся';
  else if (s.core < 35.5 || s.shiver > 0.5) why = 'Проснулся: тело дрожит от холода. Нужен костёр или тёплое укрытие';
  else if (s.airT < SLEEP_WAKE_C && !s.nearFire) why = 'Проснулся от холода: в укрытии ниже −15 °C';
  else if (gear.sleepEnd > 0 && G.time >= gear.sleepEnd) why = gear.sleepEnd - gear.sleepFrom <= NAP_MIN + 1 ? 'Ты отдохнул' : 'Рассвет. Ты выспался';
  if (why) {
    G.sleeping = false;
    gear.wakeWhy = why;
    gear.sleepEnd = 0;
    return 'woke';
  }
  return 'sleep';
}

// ---------------- drawing ----------------
// Drawn in world cells with the world transform set (main's drawOverlay). Back = before the hero (sled, bench, kettle, planted torches),
// front = after him (snowshoes on the feet, the tool in hand).

export interface DrawCtx {
  ctx: CanvasRenderingContext2D;
  hero: { x: number; y: number; face: number; h: number };
  pack: Pack;
  held: string;
  night: number;          // 0 day .. 1 night
}

const WOOD = '#8a6a44', WOOD_DK = '#4d3822', WOOD_LT = '#c9a06c', SLED_RED = '#a8442e', METAL = '#8f9aa6';

/** Sled, planted torches, the workbench(es) and the kettle on the fire. Drawn before the hero. */
export function drawGearBack(d: DrawCtx): void {
  const c = d.ctx;
  c.save();
  c.lineCap = 'round'; c.lineJoin = 'round';
  if (has(d.pack, 'sled') && Number.isFinite(gear.sledX)) drawSled(c, d.hero);
  for (const b of benches) drawBench(c, b.x, b.y);
  if (pot.on) drawKettle(c, pot.x, pot.y);
  for (const t of gear.torches) drawStickTorch(c, t.x, t.y, t.fuel > 0, G.realTime + t.x);
  c.restore();
}

/** Snowshoes on the feet and the tool in hand. Drawn after the hero. */
export function drawGearFront(d: DrawCtx): void {
  const c = d.ctx;
  c.save();
  c.lineCap = 'round'; c.lineJoin = 'round';
  if (has(d.pack, 'snowshoes') && gear.shoesOn) drawSnowshoes(c, d.hero.x, d.hero.y, d.hero.face);
  drawHandTool(c, d);
  c.restore();
}

function drawSled(c: CanvasRenderingContext2D, h: { x: number; y: number; face: number }) {
  const sx = gear.sledX, sy = gear.sledY;
  const front = h.x >= sx ? 1 : -1;
  // rope from the sled's near end to the hero's hip
  c.strokeStyle = 'rgba(40,30,22,0.85)'; c.lineWidth = 0.9;
  c.beginPath(); c.moveTo(sx + front * 10, sy - 5); c.lineTo(h.x - front * 1, h.y - 15); c.stroke();
  // runners (curled up at both ends) and the body with its boards
  c.strokeStyle = METAL; c.lineWidth = 1.1;
  c.beginPath(); c.moveTo(sx - 12, sy - 1.2); c.lineTo(sx + 11, sy - 1.2); c.stroke();
  c.beginPath(); c.moveTo(sx - 12, sy - 1.2); c.quadraticCurveTo(sx - 14, sy - 3, sx - 11.5, sy - 3.5); c.stroke();
  c.beginPath(); c.moveTo(sx + 11, sy - 1.2); c.quadraticCurveTo(sx + 13, sy - 3, sx + 10.5, sy - 3.5); c.stroke();
  c.fillStyle = SLED_RED; c.fillRect(sx - 10, sy - 6, 20, 4);
  c.fillStyle = WOOD_LT; c.fillRect(sx - 10, sy - 6, 20, 0.9);
  c.strokeStyle = WOOD_DK; c.lineWidth = 0.6;
  for (let k = -8; k <= 8; k += 4) { c.beginPath(); c.moveTo(sx + k, sy - 6); c.lineTo(sx + k, sy - 2); c.stroke(); }
}

function drawBench(c: CanvasRenderingContext2D, x: number, y: number) {
  c.fillStyle = WOOD; c.fillRect(x - 9, y - 10, 18, 3);
  c.fillStyle = WOOD_LT; c.fillRect(x - 9, y - 10, 18, 0.8);
  c.strokeStyle = WOOD_DK; c.lineWidth = 1.2;
  c.beginPath(); c.moveTo(x - 7, y - 7); c.lineTo(x - 7, y); c.moveTo(x + 7, y - 7); c.lineTo(x + 7, y); c.stroke();
}

/** The kettle hangs over the fire: body, rim, and the contents coloured by phase (snow white, water blue-grey, tea brown). */
function drawKettle(c: CanvasRenderingContext2D, x: number, y: number) {
  const ph = potPhase();
  const fill = ph === 'empty' ? null : ph === 'snow' || ph === 'melting' ? '#e6eef6' : ph === 'tea' ? '#7a4a22' : ph === 'brewing' ? '#9c6a36' : '#7fa0bd';
  c.strokeStyle = '#1b1d22'; c.lineWidth = 1.1;
  c.beginPath(); c.moveTo(x - 6, y - 19); c.quadraticCurveTo(x, y - 25, x + 6, y - 19); c.stroke(); // bail
  c.fillStyle = '#2b2e35';
  c.beginPath(); c.ellipse(x, y - 14, 6.5, 5, 0, 0, Math.PI * 2); c.fill();
  if (fill) { c.fillStyle = fill; c.beginPath(); c.ellipse(x, y - 16.5, 5.2, 1.8, 0, 0, Math.PI * 2); c.fill(); }
  c.strokeStyle = METAL; c.lineWidth = 0.9;
  c.beginPath(); c.moveTo(x - 8, y - 12); c.lineTo(x - 11, y - 3); c.moveTo(x + 8, y - 12); c.lineTo(x + 11, y - 3); c.stroke();
}

function drawSnowshoes(c: CanvasRenderingContext2D, x: number, y: number, face: number) {
  // one oval frame under the feet, a lattice of sinew, the tail up
  const cx = x, cy = y - 1.6;
  c.fillStyle = 'rgba(214,176,124,0.92)';
  c.beginPath(); c.ellipse(cx, cy, 8.6, 2.6, 0, 0, Math.PI * 2); c.fill();
  c.strokeStyle = WOOD_DK; c.lineWidth = 0.6;
  c.beginPath(); c.ellipse(cx, cy, 8.6, 2.6, 0, 0, Math.PI * 2); c.stroke();
  c.lineWidth = 0.35;
  for (let k = -6; k <= 6; k += 3) { c.beginPath(); c.moveTo(cx + k - 1.2, cy - 2.2); c.lineTo(cx + k + 1.2, cy + 2.2); c.stroke(); }
  c.beginPath(); c.moveTo(cx - 3, cy - 1.8); c.lineTo(cx + 3, cy - 1.8); c.stroke();
  c.beginPath(); c.moveTo(cx - 3, cy + 1.8); c.lineTo(cx + 3, cy + 1.8); c.stroke();
  void face;
}

function drawStickTorch(c: CanvasRenderingContext2D, x: number, y: number, lit: boolean, t: number) {
  c.strokeStyle = WOOD_DK; c.lineWidth = 1.6;
  c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - 11); c.stroke();
  c.fillStyle = '#3c2f25'; c.fillRect(x - 1.4, y - 13, 2.8, 2.4);
  if (lit) flame(c, x, y - 13.5, t, 1);
}

/** A flame: an inner and an outer teardrop that flicker on their own sines. */
function flame(c: CanvasRenderingContext2D, x: number, y: number, t: number, k: number) {
  const f = 0.85 + 0.15 * Math.sin(t * 11) + 0.05 * Math.sin(t * 23);
  c.fillStyle = 'rgba(255,150,60,0.82)';
  c.beginPath(); c.ellipse(x, y - 2.6 * k * f, 2.1 * k, 3.6 * k * f, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = 'rgba(255,236,170,0.95)';
  c.beginPath(); c.ellipse(x, y - 1.6 * k, 1.0 * k, 1.8 * k * f, 0, 0, Math.PI * 2); c.fill();
}

function drawHandTool(c: CanvasRenderingContext2D, d: DrawCtx) {
  const { x, y, face, h } = d.hero;
  const hx = x + face * 5, hy = y - h * 0.6;     // the hand, at the chest
  if (d.held === 'torch') {
    const lit = count(d.pack, 'torchFuel') > 0;
    c.strokeStyle = WOOD_DK; c.lineWidth = 1.6;
    c.beginPath(); c.moveTo(hx, hy + 2); c.lineTo(hx + face * 7, hy - 12); c.stroke();
    c.fillStyle = lit ? '#3a2b20' : '#2a2320'; c.fillRect(hx + face * 7 - 1.6, hy - 14, 3.2, 2.6);
    if (lit) flame(c, hx + face * 7, hy - 14.2, G.realTime, 1.1);
  } else if (d.held === 'pickaxe') {
    c.strokeStyle = WOOD; c.lineWidth = 1.4;
    c.beginPath(); c.moveTo(hx - face * 2, hy + 7); c.lineTo(hx + face * 8, hy - 9); c.stroke();
    c.strokeStyle = METAL; c.lineWidth = 1.6;
    c.beginPath(); c.moveTo(hx + face * 5, hy - 10.5); c.quadraticCurveTo(hx + face * 12, hy - 14, hx + face * 13, hy - 6); c.stroke();
  } else if (d.held === 'trap') {
    c.strokeStyle = WOOD_DK; c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(hx, hy + 2); c.lineTo(hx + face * 6, hy - 6); c.stroke();
    c.strokeStyle = '#d7dde4'; c.lineWidth = 0.6;
    c.beginPath(); c.ellipse(hx + face * 8, hy - 9, 3, 2, 0.5 * face, 0, Math.PI * 2); c.stroke();
  }
}

/** Torch flame glow strength for the HUD / overlay (0..1). */
export function torchGlow(pack: Pack, held: string): number {
  return held === 'torch' && count(pack, 'torchFuel') > 0 ? 1 : 0;
}
