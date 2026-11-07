// The player (DESIGN §3): movement (walk/run/jump/step-up/swim), and the whole body model: core temperature, extremities,
// hydration, food, energy, wetness (incl. sweat and the parka vent), CO, HP, shivering, sleep, named deaths, respawn.
// Rates are per "body second" (bdt = real seconds at normal speed; sleep time-warp multiplies it) and tuned for NORMAL difficulty;
// G.diff.cold / hunger multiply them.
import { G, toast, DIFFS, type Player } from './state';
import { emit, on } from './bus';
import { strings, fmt } from '../content/i18n';
import { input } from '../engine/input';
import { moveBox, matBelow } from '../engine/phys';
import { tempAt, windAt, shelterAt, addHeat } from '../engine/heat';
import { spawnFx, burstFx } from '../engine/particles';
import { addShake } from '../engine/camera';
import { MAT, FRIC } from '../content/materials';
import { inv, weight, WEIGHT_SOFT, WEIGHT_MAX, WEIGHT_RUN, runLimit, overload, removeFromSlot, takeAll, giveStartKit, spawnDrop, backpacks, add, remove, count, held, clearInventory, find, select } from './inventory';
import { getItem, itemName, type WearSlot } from './items';
import { radiantWarmth, dryBoost, nearStation } from './fixtures';
import { H, W } from '../engine/grid';
import { dogWarmth } from './fauna';
import { resetUseState } from './useitems';
import { mods } from './usemods';

const S = strings('player', {
  frostnip: 'Белеет {part}: обморожение близко',
  frostbite: 'Обморожение: {part}!',
  partHands: 'руки', partFeet: 'ноги', partFace: 'лицо',
  shiver: 'Тебя трясёт: пора греться',
  confused: 'Мысли путаются… согревайся',
  coWarn: 'Голова тяжелеет — нечем дышать. Открой отдушину!',
  hungry: 'Живот сводит: поешь',
  thirsty: 'Хочется пить: растопи снег',
  tired: 'Ты валишься с ног: пора спать',
  wetWarn: 'Одежда мокрая — просушись у огня',
  sweat: 'Ты потеешь: расстегни парку (V)',
  parkaOpen: 'Парка расстёгнута', parkaClosed: 'Парка застёгнута',
  cantSleepCold: 'Слишком холодно спать: согрейся и найди укрытие',
  cantSleepNot: 'Спать не хочется',
  cantSleepOpen: 'В открытом месте не уснуть: нужно укрытие',
  wakeCold: 'Ты замерзаешь во сне: проснулся!',
  wakeCo: 'Угарный газ! Проснулся с трудом',
  slept: 'Ты проспал {h} ч',
  waterShock: 'Ледяная вода! Выбирайся скорее',
  rolled: 'Снег впитал воду с одежды',
  ate: 'Съел: {name}', drank: 'Выпил: {name}',
  nothing: 'Нечего есть и пить',
  flaskFrozen: 'Вода во фляге замёрзла: спрячь её под парку (в сумку) или поставь к огню',
  respawn: 'Ты очнулся на станции…',
  causeCold: 'замёрз', causeFrost: 'обморожение и истощение', causeDrown: 'утонул в полынье', causeBear: 'медведь',
  causeCo: 'угарный газ', causeCollapse: 'обвал в шахте', causeFall: 'упал', causeHunger: 'голод', causeThirst: 'жажда', causeOther: 'погиб',
});
export const CAUSES = {
  cold: () => S.causeCold, frost: () => S.causeFrost, drown: () => S.causeDrown, bear: () => S.causeBear, co: () => S.causeCo,
  collapse: () => S.causeCollapse, fall: () => S.causeFall, hunger: () => S.causeHunger, thirst: () => S.causeThirst,
} as const;
export type CauseKey = keyof typeof CAUSES;

// ---------------------------------------------------------------------------------------------------------------------
export const TUNE = {
  walk: 27, run: 46, accel: 380, gravity: 360, jumpV: 102, swimV: 20, termV: 280, coyote: 0.09, buffer: 0.12, stepUp: 8, cutV: -70,
  fallSafe: 175, fallDmg: 0.33,
  // heat balance
  L0: 0.075, KC: 0.0055, coldGain: 0.2, shiverMax: 1.6, shelterK: 0.6, waterLoss: 6, bedBonus: 1.45, skinBonus: 1.7,
  // needs (per body second)
  waterDrain: 100 / 900, foodDrain: 100 / 1200, energyDrain: 100 / 1000, sleepGain: 0.5,
  hpRegen: 0.25,
};

export const body = {
  scar: { hands: 0, feet: 0, face: 0 },
  fineT: 0,          // seconds of bare-handed fine work left
  warmT: 0, warmPow: 0,
  working: 0,        // 0..1 effort set by tools each frame
  shockT: 0, drownT: 0,
  sleepT: 0, sleepFix: null as null | { x: number; y: number }, sleptMin: 0, bedKind: '',
  met: 1, loss: 0, net: 0, shiver: 0, sink: 0, feetMat: 0,
  rolling: 0, deadT: 0, lastStep: 0, hpPrev: 100,
  respawnX: 0, respawnY: 0,
  warned: { hands: false, feet: false, face: false, co: false, hungry: false, thirsty: false, tired: false, shiver: false, wet: false, sweat: false, confused: false },
  stats: { daysSurvived: 0, deaths: 0, use: { hints: [] as string[], d: {} as Record<string, number> } },      // `use`: usable-item state (useitems.ts), saved with the body
};

export function applyDifficulty(level: 0 | 1 | 2, hardcore = false) {
  G.diff.level = level; Object.assign(G.diff, DIFFS[level]); G.diff.hardcore = hardcore;
}

export function initPlayer(x: number, y: number): Player {
  const p: Player = {
    x, y, vx: 0, vy: 0, w: 8, h: 20, face: 1, onGround: false, inWater: 0, hp: 100, maxHp: 100, core: 37, food: 85, stamina: 100, wet: 0,
    insul: 1, airT: -20, feelT: -20, shelter: 0, alive: true, cause: '', anim: { state: 'idle', t: 0 }, hurtT: 0,
    water: 85, energy: 90, frost: { hands: 0, feet: 0, face: 0 }, co: 0, parkaOpen: false, carry: 0, sleeping: false,
  };
  G.player = p;
  body.scar.hands = body.scar.feet = body.scar.face = 0;
  body.fineT = body.warmT = body.warmPow = body.working = body.shockT = body.drownT = body.sleepT = body.sink = 0;
  body.respawnX = x; body.respawnY = y; body.deadT = 0; body.hpPrev = 100;
  for (const k in body.warned) (body.warned as Record<string, boolean>)[k] = false;
  G.timeScale = 1;
  resetUseState();
  return p;
}
export function setRespawn(x: number, y: number) { body.respawnX = x; body.respawnY = y; }

// ---------------------------------------------------------------------------------------------------------------------
// environment helpers
/** Environment Canada wind chill with a smooth fade-in below 4.8 km/h. */
export function windChill(T: number, windMs: number): number {
  const v = windMs * 3.6;
  if (T > 10) return T;
  const wc = (kmh: number) => 13.12 + 0.6215 * T - 11.37 * Math.pow(kmh, 0.16) + 0.3965 * T * Math.pow(kmh, 0.16);
  if (v >= 4.8) return Math.min(T, wc(v));
  return T + (Math.min(T, wc(4.8)) - T) * (v / 4.8);
}
function wearIns(): { insul: number; hands: number; feet: number; face: number } {
  let insul = 0.35, hands = 0, feet = 0, face = 0.05;
  for (const slot of ['head', 'body', 'hands', 'feet', 'face'] as WearSlot[]) {
    const id = inv.wear[slot]; if (!id) continue;
    const w = getItem(id).wear; if (!w) continue;
    let ins = w.insul;
    if (slot === 'body' && G.player.parkaOpen) ins *= 0.5;
    insul += ins;
    if (slot === 'hands') hands = w.prot; else if (slot === 'feet') feet = w.prot; else if (slot === 'head') face = Math.max(face, w.prot); else if (slot === 'face') face = 1 - (1 - face) * (1 - w.prot);
  }
  return { insul, hands, feet, face };
}
export const handsFactor = () => { const f = G.player.frost.hands; return f >= 80 ? 0.6 : f >= 55 ? 0.85 : 1; };
export const handsFrozen = () => G.player.frost.hands >= 80;
/** Aim sway (cells) caused by shivering. */
export function aimSway(t: number): [number, number] {
  const p = G.player; const s = body.shiver; if (s <= 0.05) return [0, 0];
  return [Math.sin(t * 31) * s * 2.2, Math.cos(t * 27) * s * 2.2];
}

// ---------------------------------------------------------------------------------------------------------------------
// damage / healing / death
export function damage(n: number, cause: CauseKey | string = 'cold') {
  const p = G.player; if (!p || !p.alive || n <= 0) return;
  if (p.hurtT > 0 && n < 12) return;
  p.hp -= n; p.hurtT = 0.45; p.anim.state = 'hurt'; p.anim.t = 0;
  const text = typeof cause === 'string' && cause in CAUSES ? CAUSES[cause as CauseKey]() : String(cause);
  if (p.sleeping && n > 1.5) wake(S.wakeCold);
  emit('hurt', { cause: text, n });
  addShake(Math.min(5, n * 0.25));
  if (p.hp <= 0) die(text);
}
function dot(n: number, cause: CauseKey) {         // damage over time: no flash, no invulnerability
  const p = G.player; if (!p.alive) return;
  p.hp -= n;
  if (p.hp <= 0) die(CAUSES[cause]());
}
export function heal(n: number) { const p = G.player; if (p.alive) p.hp = Math.min(p.maxHp, p.hp + n); }
export function die(cause: string) {
  const p = G.player; if (!p.alive) return;
  p.alive = false; p.hp = 0; p.cause = cause; p.anim.state = 'dead'; p.sleeping = false; G.timeScale = 1; body.deadT = 0;
  body.stats.deaths++;
  // the pack stays where you fell
  const items = takeAll();
  if (items.length) {
    const d = spawnDrop('backpack', 1, p.x, p.y - 4, 0, -20, undefined, true);
    if (d) backpacks.set(d.id, items);
  }
  held.torchLit = held.lanternLit = false; held.load = 0;
  emit('died', { cause, hardcore: G.diff.hardcore });
}
/** Return to the station with fresh vitals and a basic kit (not on hardcore). */
export function respawn(): boolean {
  const p = G.player; if (p.alive || G.diff.hardcore) return false;
  p.alive = true; p.hp = 60; p.core = 36.4; p.food = 45; p.water = 45; p.energy = 60; p.wet = 0; p.co = 0; p.sleeping = false;
  p.frost.hands = p.frost.feet = p.frost.face = 0; body.scar.hands = body.scar.feet = body.scar.face = 0;
  p.x = body.respawnX; p.y = body.respawnY; p.vx = p.vy = 0; p.anim.state = 'idle'; p.hurtT = 1.5; p.cause = '';
  body.warmT = body.shockT = body.drownT = 0; G.timeScale = 1; body.sleepFix = null; body.working = 0; body.fineT = 0;
  for (const k in body.warned) (body.warned as Record<string, boolean>)[k] = false;
  clearInventory(true);
  add('snow_knife', 1); add('shovel', 1); add('matches', 5); add('can', 1);
  inv.wear.hands = 'wool_mittens'; inv.wear.feet = 'felt_boots'; inv.wear.body = 'station_parka'; inv.wear.head = 'wool_hat';
  toast(S.respawn, 'info'); emit('respawn', {});
  return true;
}
/** Pick up a dead player's backpack: returns what did not fit. */
export function openBackpack(dropId: number): boolean {
  const items = backpacks.get(dropId); if (!items) return false;
  const rest = [];
  for (const s of items) { const left = add(s.id, s.n, s.dur); if (left > 0) rest.push({ ...s, n: left }); }
  if (rest.length) backpacks.set(dropId, rest); else backpacks.delete(dropId);
  return rest.length === 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// eating & drinking
export function eatSlot(i: number): boolean {
  const p = G.player; const s = inv.slots[i]; if (!s || !p.alive) return false;
  const d = getItem(s.id); const f = d.food; if (!f) return false;
  if (s.id === 'flask') return drinkFlask(i);
  if (f.drink && f.water && p.water > 96 && !f.warm) return false;
  if (!f.drink && (f.food ?? 0) > 0 && p.food > 97) return false;
  removeFromSlot(i, 1);
  p.food = Math.min(100, p.food + (f.food ?? 0));
  p.water = Math.min(100, p.water + (f.water ?? 0));
  if (f.core) p.core += f.core;
  if (f.warm) { body.warmT = Math.max(body.warmT, f.warm); body.warmPow = Math.max(body.warmPow, f.warmPow ?? 1); }
  if (f.raw && f.sick && Math.random() < f.sick) { p.water = Math.max(0, p.water - 8); }
  emit(f.drink ? 'drank' : 'ate', { item: s.id });
  toast(fmt(f.drink ? S.drank : S.ate, { name: itemName(s.id) }), 'good');
  return true;
}
function drinkFlask(i: number): boolean {
  const p = G.player, s = inv.slots[i]!;
  if ((s.dur ?? 0) >= 50) { toast(S.flaskFrozen, 'warn'); return false; }
  if ((s.dur ?? 0) <= 0 || p.water > 94) return false;
  s.dur = (s.dur ?? 0) - 1; p.water = Math.min(100, p.water + 26);
  emit('drank', { item: 'flask' }); toast(fmt(S.drank, { name: itemName('water') }), 'good'); return true;
}
/** F key: drink if thirstier than hungry, else eat; prefers cooked food, then the selected item. */
export function eatBest(): boolean {
  const p = G.player;
  const sel = inv.slots[inv.sel];
  if (sel && (getItem(sel.id).food || sel.id === 'flask') && eatSlot(inv.sel)) return true;
  const thirst = 100 - p.water, hunger = 100 - p.food;
  const cands: { i: number; score: number }[] = [];
  for (let i = 0; i < inv.slots.length; i++) {
    const s = inv.slots[i]; if (!s) continue;
    const f = getItem(s.id).food; if (!f && s.id !== 'flask') continue;
    if (s.id === 'snow') continue;
    let sc = 0;
    if (s.id === 'flask') sc = (s.dur ?? 0) > 0 && (s.dur ?? 0) < 50 ? thirst * 1.0 : -1;
    else if (f) sc = (f.food ?? 0) * (hunger / 60) + (f.water ?? 0) * (thirst / 40) - (f.raw ? 6 : 0);
    cands.push({ i, score: sc });
  }
  cands.sort((a, b) => b.score - a.score);
  for (const c of cands) if (c.score > 0 && eatSlot(c.i)) return true;
  if (p.water < 60 && count('snow') > 0) { for (let i = 0; i < inv.slots.length; i++) if (inv.slots[i]?.id === 'snow') return eatSlot(i); }
  toast(S.nothing, 'warn'); return false;
}

// ---------------------------------------------------------------------------------------------------------------------
// sleep
export function startSleep(force = false): boolean {
  const p = G.player;
  if (!p.alive || p.sleeping) return false;
  const sh = G.shelter;
  if (!force) {
    if (p.energy > 88) { toast(S.cantSleepNot, 'info'); return false; }
    if (p.core < 35.5) { toast(S.cantSleepCold, 'warn'); return false; }
    const warmEnough = p.airT > -12;
    if (!(sh && sh.closed) && !warmEnough) { toast(S.cantSleepOpen, 'warn'); return false; }
    if (sh && sh.co > 30) { toast(S.coWarn, 'warn'); return false; }
  }
  p.sleeping = true; p.vx = 0; G.timeScale = 20; body.sleepT = 0; body.sleptMin = 0; p.anim.state = 'idle';
  return true;
}
export function wake(msg?: string) {
  const p = G.player; if (!p.sleeping) return;
  p.sleeping = false; G.timeScale = 1;
  if (msg) toast(msg, 'warn');
  const h = Math.round(body.sleptMin / 6) / 10;
  if (h >= 0.5) { toast(fmt(S.slept, { h }), 'info'); emit('slept', { hours: h }); }
}
on('sleep_request', (d: { fixture: { tx: number; ty: number; tw: number; th: number; kind: string } }) => {
  const p = G.player; if (!p?.alive) return;
  if (startSleep()) {
    body.sleepFix = { x: d.fixture.tx * 4 + d.fixture.tw * 2, y: (d.fixture.ty + d.fixture.th) * 4 };
    p.x = body.sleepFix.x; p.y = body.sleepFix.y - 1;
    setRespawn(p.x, p.y);
    body.bedKind = d.fixture.kind;
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// the step
let breathT = 0, stepDist = 0, jumpBuf = 0, coyote = 0, bodyTick = 0;
export function stepPlayer(dt: number) {
  const p = G.player; if (!p || G.paused) return;
  if (!p.alive) { body.deadT += dt; p.vx *= 0.9; p.vy = Math.min(TUNE.termV, p.vy + TUNE.gravity * dt); moveBox(p, dt); return; }
  p.hurtT = Math.max(0, p.hurtT - dt);
  p.anim.t += dt;
  if (p.sleeping) { stepSleep(dt); } else stepMove(dt);
  // the body model runs at 20 Hz of body time to stay cheap, using accumulated bdt
  bodyTick += dt * G.timeScale;
  if (bodyTick >= 0.05) { const b = bodyTick; bodyTick = 0; stepBody(b); }
  breath(dt);
}

function stepSleep(dt: number) {
  const p = G.player;
  p.vx = 0; p.vy = 0;
  body.sleepT += dt;
  body.sleptMin += dt * 2.4 * G.timeScale;
  if (body.sleepT > 1.2 && (input.anyKey || Math.abs(input.moveX) > 0.3 || input.jumpHeld || input.primaryPressed)) wake();
  else if (p.core < 35.5) wake(S.wakeCold);
  else if (p.energy >= 99 && body.sleptMin > 180) wake();
  else if (G.shelter && G.shelter.co > 55) wake(S.wakeCo);
}

function stepMove(dt: number) {
  const p = G.player;
  const inw = p.inWater;
  const swim = inw > 0.45;
  // carry weight
  p.carry = weight();
  const heavy = overload(p.carry);       // DESIGN §12: 0 up to the comfortable load (25 kg), 1 at WEIGHT_MAX
  let mult = 1 - heavy * 0.55;
  if (p.frost.feet >= 80) mult *= 0.7;
  if (p.core < 35) mult *= 0.9; if (p.core < 32.5) mult *= 0.75;
  if (p.energy < 15) mult *= 0.85;
  if (p.co > 40) mult *= 0.75;
  if (body.sink > 1) mult *= 0.88;
  const fric = FRIC[body.feetMat] || 1;
  const ix = Math.abs(input.moveX) < 0.12 ? 0 : input.moveX;
  const run = input.run && !swim && p.energy > 5 && p.carry <= runLimit();       // above 140 % of the load nobody runs
  let target = ix * (run ? TUNE.run : TUNE.walk) * mult;
  if (swim) target = ix * TUNE.swimV;
  if (p.core < 32 && Math.random() < 0.02) target *= -0.5;   // stumbles
  const accel = (p.onGround ? TUNE.accel * Math.min(1, 0.25 + fric * 0.75) : 120) * dt;
  const brake = (p.onGround ? TUNE.accel * Math.min(1, 0.12 + fric * 0.88) : 40) * dt;
  if (Math.abs(target) > Math.abs(p.vx) || Math.sign(target) !== Math.sign(p.vx)) p.vx += Math.max(-accel, Math.min(accel, target - p.vx));
  else p.vx += Math.max(-brake, Math.min(brake, target - p.vx));
  if (ix !== 0) p.face = ix > 0 ? 1 : -1;
  else if (input.hasAim && input.aimMode !== 'touch') { /* face follows aim set by tools */ }

  // jump (buffered + coyote)
  jumpBuf = input.jumpPressed ? TUNE.buffer : Math.max(0, jumpBuf - dt);
  coyote = p.onGround ? TUNE.coyote : Math.max(0, coyote - dt);
  if (swim) {
    p.vy += (input.jumpHeld ? -140 : input.moveY > 0.5 ? 70 : 28) * dt;
    p.vy = Math.max(-TUNE.swimV * 1.6, Math.min(TUNE.swimV * 2, p.vy));
  } else {
    p.vy = Math.min(TUNE.termV, p.vy + TUNE.gravity * dt);
    if (jumpBuf > 0 && coyote > 0) {
      p.vy = -TUNE.jumpV * (1 - heavy * 0.2) * (p.frost.feet >= 80 ? 0.9 : 1); jumpBuf = 0; coyote = 0; p.onGround = false;
      p.anim.state = 'jump'; p.anim.t = 0; emit('jump', {});
    }
    if (!input.jumpHeld && p.vy < TUNE.cutV) p.vy += TUNE.gravity * 0.9 * dt;     // variable jump height: a tap is cut short, a hold is not
  }
  const wasGround = p.onGround, wasWater = inw, preVy = p.vy;
  const r = moveBox(p, dt, { stepUp: TUNE.stepUp, swim });
  p.inWater = r.inWater;
  const landed = !wasGround && p.onGround && !swim ? Math.max(r.landedSpeed, preVy) : 0;   // a fall that ends exactly on a cell boundary has no penetration
  if (landed > 0) {
    emit('land', { speed: landed, mat: matBelow(p.x, p.y) });
    if (landed > TUNE.fallSafe) damage((landed - TUNE.fallSafe) * TUNE.fallDmg, 'fall');
    if (landed > 40) burstFx('dust', p.x, p.y, 4, 14, 0.5, undefined, 2);
  }
  // walking into a closed door opens it
  if (r.hitWall && ix !== 0) emit('bump', { dir: ix > 0 ? 1 : -1, x: p.x, y: p.y });
  // standing material, sinking into loose snow
  body.feetMat = matBelow(p.x, p.y);
  const sinkT = body.feetMat === MAT.SNOW && p.onGround ? 1.8 : 0;
  body.sink += (sinkT - body.sink) * Math.min(1, dt * 8);
  // water transitions
  if (r.inWater > 0.45 && wasWater <= 0.45) {
    p.wet = 1; body.shockT = 20; toast(S.waterShock, 'bad'); p.core -= 0.3; emit('splash', { x: p.x, y: p.y, speed: Math.abs(p.vy) });
    burstFx('dust', p.x, p.y - 6, 10, 26, 0.7, 0xcfe4f6, 8);
  }
  // footsteps
  if (p.onGround && Math.abs(p.vx) > 4) {
    stepDist += Math.abs(p.vx) * dt;
    const stride = run ? 17 : 12;
    if (stepDist > stride) { stepDist = 0; emit('step', { mat: body.feetMat, run }); if (body.feetMat === MAT.SNOW) spawnFx('dust', p.x - p.face * 2, p.y - 1, -p.face * 5 + (Math.random() - 0.5) * 4, -6 - Math.random() * 6, 0.45, 0xdde8f4); }
  }
  p.anim.state = swim ? 'swim' : !p.onGround ? (p.vy < 0 ? 'jump' : 'fall') : Math.abs(p.vx) > 3 ? (run ? 'run' : 'walk') : (body.working > 0.3 ? 'dig' : 'idle');
  if (p.y > H - 4 || p.x < 2 || p.x > W - 2) { p.x = Math.max(4, Math.min(W - 4, p.x)); if (p.y > H - 4) die(S.causeOther); }
  // roll in the snow to blot water: hold down on loose snow
  if (input.moveY > 0.5 && p.onGround && body.feetMat === MAT.SNOW && p.wet > 0.12) {
    body.rolling = Math.min(1, body.rolling + dt * 2);
    if (Math.random() < dt * 12) spawnFx('dust', p.x + (Math.random() - 0.5) * 8, p.y - 2, (Math.random() - 0.5) * 20, -10 - Math.random() * 10, 0.5, 0xeaf2fb);
  } else body.rolling = Math.max(0, body.rolling - dt * 3);
}

function breath(dt: number) {
  const p = G.player;
  if (p.airT > -2) return;
  breathT -= dt * (p.sleeping ? 0.5 : 1) * (1 + Math.min(1.5, Math.abs(p.vx) / 40));
  if (breathT <= 0) {
    breathT = 1.2 + Math.random() * 0.5;
    const strength = Math.min(1, (-p.airT) / 25);
    const hx = p.x + p.face * 3, hy = p.y - (p.sleeping ? 4 : 17);
    spawnFx('breath', hx, hy, p.face * (3 + 4 * strength) + G.wind * 0.3, -2 - 2 * strength, 0.7 + 0.5 * strength, 0xdce9f5, 1 + (strength > 0.6 ? 1 : 0));
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// the body
export function stepBody(bdt: number) {
  const p = G.player;
  const diff = G.diff;
  const cx = p.x, cy = p.y - 10;
  // inputs are sanitised: one NaN from the heat/wind fields must never poison the body permanently
  const fin = (v: number, d: number) => (Number.isFinite(v) ? v : d);
  p.airT = fin(tempAt(cx, cy), fin(G.ambientT, -20));
  const windLocal = Math.abs(fin(windAt(cx, cy), 0));
  p.shelter = Math.max(0, Math.min(1, fin(shelterAt(cx, cy), 0)));
  const swimming = p.inWater > 0.45;
  const rad = swimming ? 0 : radiantWarmth(cx, cy) + (held.torchLit ? 3 : 0) + dogWarmth(cx, cy, p.sleeping);
  let feel = swimming ? -45 : windChill(p.airT, windLocal) + 0.5 * rad;
  p.feelT = feel;
  const wr = wearIns();
  p.insul = wr.insul;
  // activity -> metabolism
  const speedFrac = Math.min(1, Math.abs(p.vx) / TUNE.run);
  let met = p.sleeping ? 0.8 : 1;
  if (!p.sleeping) {
    if (swimming) met = 5;
    else if (p.onGround && Math.abs(p.vx) > 3) met = 1 + 3.2 * speedFrac + (Math.abs(p.vx) > TUNE.walk * 1.2 ? 0.6 : 0);
    else met = 1 + 3.5 * body.working;
    met += Math.min(1.5, p.carry * 0.03) + overload(p.carry) * 1.2;      // heavy load: more effort -> more sweat
    met += 0.09 * rad;            // radiant heat from fires warms the body directly
  }
  if (body.warmT > 0) { met += body.warmPow; body.warmT -= bdt; if (body.warmT <= 0) body.warmPow = 0; }
  // shivering
  const shiverBase = p.sleeping ? 0.5 : 1;
  body.shiver = p.core < 36.4 && p.core > 29 ? Math.min(1, (36.4 - p.core) / 1.4) * (p.core < 32 ? Math.max(0, (p.core - 29) / 3) : 1) : 0;
  met += body.shiver * TUNE.shiverMax * shiverBase;
  // heat loss
  let ins = wr.insul;
  if (p.sleeping) { const bed = nearStation(['skin_bed', 'bed'], cx, cy, 3); if (bed) ins *= bed.kind === 'skin_bed' ? TUNE.skinBonus : TUNE.bedBonus; }
  const coldMult = 1 + TUNE.coldGain * Math.max(0, 37 - p.core);
  let loss = (TUNE.L0 * Math.max(0, 34 - feel) * coldMult * (1 + 1.2 * p.wet) * diff.cold) / (ins * (1 + TUNE.shelterK * p.shelter));
  if (swimming) loss *= TUNE.waterLoss * 0.6;
  // eating snow etc. adjust the core directly; here the balance
  const net = met - loss;
  body.met = met; body.loss = loss; body.net = net;
  let dCore = TUNE.KC * net * bdt;
  if (dCore > 0) dCore *= Math.max(0, Math.min(1, (37.9 - p.core) / 1.1));
  p.core += dCore;
  if (body.shockT > 0) { body.shockT -= bdt; if (swimming) p.core -= 0.06 * bdt; }
  // sweat
  if (!swimming && p.core > 37.3 && net > 1.2) p.wet = Math.min(1, p.wet + Math.min(5, net - 1.2) * 0.0045 * bdt * mods.sweat);
  if (net > 1.2 && p.core > 37.3 && !body.warned.sweat && !p.parkaOpen && p.wet > 0.15) { body.warned.sweat = true; toast(S.sweat, 'info'); }
  if (p.core < 37.2) body.warned.sweat = false;
  // wetness: water soaks, warm air dries (fire/stove/rack faster), cold only slowly
  if (swimming) p.wet = 1;
  else if (p.wet > 0) {
    const warm = Math.max(0, Math.min(1, (p.airT + 20) / 30));
    let dry = (0.0004 + 0.008 * warm * warm) * dryBoost(cx, cy);
    if (p.parkaOpen) dry *= 1.4;
    p.wet = Math.max(0, p.wet - dry * bdt);
    if (body.rolling > 0.5) p.wet = Math.max(0, p.wet - 0.28 * bdt);
    if (body.rolling > 0.5 && !body.warned.wet) { body.warned.wet = true; toast(S.rolled, 'info'); }
    if (p.wet < 0.05) body.warned.wet = false;
  }
  if (p.wet > 0.5 && p.core < 36 && !body.warned.wet) { body.warned.wet = true; toast(S.wetWarn, 'warn'); }

  // extremities
  const eRaw = Math.max(0, Math.min(1.5, (-feel - 8) / 32));
  const act = p.onGround && Math.abs(p.vx) > 3 ? 0.6 : 1;
  const bare = body.fineT > 0; if (bare) body.fineT -= bdt;
  const wetF = p.wet > 0.4 ? 1.3 : 1;
  const vaso = p.core < 35.5 ? 1.5 : 1;
  const calm = eRaw < 0.05;
  const parts: [keyof Player['frost'], number, number][] = [['hands', 2.6, bare ? 0 : wr.hands], ['feet', 1.8, wr.feet], ['face', 1.0, wr.face]];
  for (const [k, base, prot] of parts) {
    let fr = p.frost[k];
    if (eRaw * (1 - prot) > 0.04) fr += base * eRaw * (1 - prot) * (k === 'face' ? 1 : act) * wetF * vaso * diff.cold * bdt * (k === 'hands' ? mods.frostHands : k === 'face' ? mods.frostFace : mods.frostFeet);
    else if (calm || eRaw * (1 - prot) <= 0.04) fr -= (0.7 + radiantWarmth(cx, cy) * 0.09) * bdt;
    if (k === 'hands' && mods.warmHands > 0) fr -= mods.warmHands * bdt;
    const floor = body.scar[k];
    fr = Math.max(floor, Math.min(100, fr));
    if (fr >= 40 && p.frost[k] < 40) toast(fmt(S.frostnip, { part: partName(k) }), 'warn');
    if (fr >= 80 && p.frost[k] < 80) { toast(fmt(S.frostbite, { part: partName(k) }), 'bad'); body.scar[k] = Math.min(45, body.scar[k] + 14); emit('frostbite', { part: k }); }
    p.frost[k] = fr;
  }
  // scars heal in warm rest
  if (p.core > 36.4 && p.airT > 8 && (p.sleeping || Math.abs(p.vx) < 2)) {
    for (const k of ['hands', 'feet', 'face'] as const) body.scar[k] = Math.max(0, body.scar[k] - (p.sleeping ? 3.5 : 1.2) * (bdt * 2.4) / 60);
  }
  // hydration, food, energy
  const act2 = 1 + 0.5 * Math.max(0, met - 1) / 4;
  p.water = Math.max(0, p.water - TUNE.waterDrain * act2 * diff.hunger * (p.sleeping ? 0.5 : 1) * bdt);
  p.food = Math.max(0, p.food - TUNE.foodDrain * (0.7 + 0.5 * Math.max(0, met - 1) / 4 + body.shiver * 0.4) * diff.hunger * (p.sleeping ? 0.5 : 1) * bdt);
  if (p.sleeping) {
    const ok = p.core > 35.5 ? 1 : 0.3;
    p.energy = Math.min(100, p.energy + TUNE.sleepGain * ok * bdt);
  } else {
    p.energy = Math.max(0, p.energy - TUNE.energyDrain * (0.7 + 0.5 * body.working + (p.core < 35.5 ? 0.4 : 0)) * bdt);
  }
  p.stamina = Math.min(100, Math.max(0, p.stamina + (input.run && Math.abs(p.vx) > 20 ? -12 * (1 + overload(p.carry)) : 14 * (1 - 0.4 * overload(p.carry))) * bdt));
  // carbon monoxide follows the enclosure
  const coT = G.shelter ? G.shelter.co : 0;
  p.co += (coT - p.co) * (coT > p.co ? 0.18 : 0.07) * Math.min(bdt, 1.5);
  if (p.co < 0.05) p.co = 0;
  if (p.co > 25 && !body.warned.co) { body.warned.co = true; toast(S.coWarn, 'bad'); }
  if (p.co < 10) body.warned.co = false;
  // HP
  const down = (n: number, c: CauseKey) => dot(n * bdt, c);
  if (p.core < 32) down(0.5 * (32 - p.core), p.frost.hands >= 80 || p.frost.feet >= 80 ? 'frost' : 'cold');
  if (p.core <= 30) { die(p.frost.hands >= 80 && p.frost.feet >= 60 ? S.causeFrost : S.causeCold); return; }
  if (p.core > 39) down(0.6 * (p.core - 39), 'cold');
  if (p.food <= 0) down(0.3, 'hunger');
  if (p.water <= 0) down(0.6, 'thirst');
  if (p.co > 55) down(p.sleeping ? 2.4 : 0.9 * (p.co - 50) / 25, 'co');
  if (p.alive && p.core > 36 && p.food > 25 && p.water > 25 && p.co < 10 && p.frost.hands < 80) {
    const rest = p.sleeping ? 3 : Math.abs(p.vx) < 2 ? 2 : 1;
    heal(TUNE.hpRegen * rest * bdt);
  }
  // drowning under the ice
  if (p.inWater > 0.97) { body.drownT += bdt; if (body.drownT > 25) down(8, 'drown'); } else body.drownT = Math.max(0, body.drownT - bdt * 2);
  // warnings
  warnOnce('shiver', body.shiver > 0.3, S.shiver, 'warn');
  warnOnce('confused', p.core < 32.5, S.confused, 'bad');
  warnOnce('hungry', p.food < 15, S.hungry, 'warn');
  warnOnce('thirsty', p.water < 15, S.thirsty, 'warn');
  warnOnce('tired', p.energy < 12, S.tired, 'warn');
  body.hpPrev = p.hp;
  if (!Number.isFinite(p.core)) p.core = 36;
  if (!Number.isFinite(p.wet)) p.wet = 0;
  for (const k of ['hands', 'feet', 'face'] as const) if (!Number.isFinite(p.frost[k])) p.frost[k] = 0;
  if (!Number.isFinite(p.hp)) p.hp = 50;
}
function warnOnce(k: keyof typeof body.warned, cond: boolean, text: string, kind: 'warn' | 'bad') {
  if (cond && !body.warned[k]) { body.warned[k] = true; toast(text, kind); }
  else if (!cond) body.warned[k] = false;
}
const partName = (k: string) => (k === 'hands' ? S.partHands : k === 'feet' ? S.partFeet : S.partFace);

/** Toggle the parka vent (V). */
export function toggleParka() {
  const p = G.player; p.parkaOpen = !p.parkaOpen; toast(p.parkaOpen ? S.parkaOpen : S.parkaClosed, 'info');
}
// fine work (crafting bare-handed)
on('fine_work', (d: { t: number }) => { body.fineT = Math.max(body.fineT, d.t); });
// small body heat into the room
export function bodyHeat() { const p = G.player; if (p && p.alive) addHeat(p.x, p.y - 8, 1.2); }
export const quickSelectFirst = (id: string) => { const i = find(s => s.id === id); if (i >= 0 && i < 6) select(i); };
void remove;
