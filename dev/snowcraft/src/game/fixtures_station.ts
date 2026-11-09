// DESIGN §15 «станция оживает»: every object is a small system (state in fixture.data, a visible and audible reaction, a gameplay consequence,
// a prompt label, a first-use hint with one journal line). Wired into fixtures.ts by five hooks: stationInteract (E), stationStep, stationLights,
// stationLabel, burnMult / heatMult (stove damper). Placement is in stationobjects.ts; the radio dial and the weather balloon are in fixtures_radio.ts,
// the bell and the coal cart in fixtures_world.ts.
//  * generator  - hold E (or tap) to pull the cord; may fail in the cold unless warmed (a lamp or the stove nearby); burns diesel; powers the house
//                 lights, the receiver and an electric heater (no CO); loud (the bear smells/hears it); stalls when snow buries the exhaust pipe
//  * medkit     - bandages and spirit against frostnip / frostbite (limited charges)
//  * kettle     - brews tea from water and tea leaves over the stove / a lamp
//  * gramophone - wind-up, three synthesised records; rest and sleep nearby restore a little energy, the dog dozes beside it
//  * shutter    - swaps the window glass for planks (really: the heat sim sees the difference)
//  * hatch      - ladder to the roof (clear the snow load, dig the exhaust out)
//  * damper     - stove damper: open = hotter and shorter, closed = longer burn and smoke / CO in the room
import { G, toast, type Fixture, type Light } from './state';
import { emit, on } from './bus';
import { strings, fmt } from '../content/i18n';
import { TS, W, mat, setCell, edited } from '../engine/grid';
import { MAT, WALK } from '../content/materials';
import { addHeat, tempAt, windAt } from '../engine/heat';
import { spawnFx } from '../engine/particles';
import { addShake } from '../engine/camera';
import { input, isKeyDown } from '../engine/input';
import { inv, remove, count, find, add } from './inventory';
import { itemName } from './items';
import { body } from './player';
import { bridge } from './stationbridge';
import { fixtureNear, heated } from './fixtures';
import { LOC } from './locations';
import { cen, dd, num, clamp, hintOnce, logJournal, playerDist } from './stationkit';
import { stationRadio as _sr, radioStep, sondeStep, sondeInteract, sondeLabel, radioLabel, installRadioHooks, initRevealLayer, radio, closeRadio } from './fixtures_radio';
import { bellRing, worldStep, cartLabel, bellLabel } from './fixtures_world';
import { renderPull } from './stationpull';

export { stationRadio } from './fixtures_radio';
void _sr;

const S = strings('stn', {
  // generator (the state words are the tooltip; the fuel in hours is only in the bag / journal)
  genNoFuelW5: 'Бак пуст: возьми солярку в руку и залей (действие)',
  genFueledW5: 'Залил солярку',
  genFull: 'Бак полон',
  genCoughW5: 'Не схватило: погрей лампой или печью',
  genCoughWarm: 'Не схватило. Ещё рывок',
  genStart: 'Дизель завёлся. В доме загорелся свет',
  genStop: 'Заглушил дизель',
  genOut: 'Солярка кончилась: дизель встал',
  genStallW5: 'Выхлоп завален: откопай трубу',
  genBuriedW5: 'Труба занесена: откопай на крыше',
  genPulling: 'Тяни шнур: держи действие',
  hintGen: 'Дизель-генератор: тяни шнур (держи действие). На морозе не схватит без тепла рядом. Даёт свет, ток рации и обогревателю без угара. Шумит — слышно далеко. Трубу выхлопа заносит снегом.',
  hintGenT: 'Дизель: держи действие, чтобы завести',
  lbGenOnW5: 'Работает', lbGenOffW5: 'Стоит', lbWarmW5: 'Тёплый', lbColdW5: 'Холодный', lbLow: 'Мало солярки', lbNoFuel: 'Нет топлива', lbBuryW5: 'Труба занесена',
  // heater / lamps
  heaterOn: 'Обогреватель включён', heaterOff: 'Обогреватель выключен', heaterNoPower: 'Обогреватель не греет: нет тока',
  lbHeaterOnW5: 'Греет', lbHeaterOffW5: 'Выключен', lbHeaterNoW5: 'Нет тока',
  // medkit
  medNoneW5: 'Лечить нечего',
  medEmpty: 'Бинты кончились',
  medTreatW5: 'Перевязал: {part}',
  medTreatSpW5: 'Перевязал спиртом: {part}',
  partHands: 'руки', partFeet: 'ноги', partFace: 'лицо',
  hintMed: 'Аптечка: бинты и спирт для обмороженных рук, ног и лица. Заряды ограничены.',
  hintMedT: 'Аптечка: бинты и спирт',
  lbMedAll: 'Бинты и спирт', lbMedBand: 'Бинты', lbMedNone: 'Бинтов нет',
  // kettle
  kPourW5: 'Налил воды в чайник',
  kTea: 'Засыпал чай',
  kFull: 'Чайник полон',
  kTakeW5: 'Налил горячего чая',
  kReady: 'Чай заварился',
  kNeedW5: 'Налей воды и положи чай',
  hintKettle: 'Чайник на печи: вода и сухой чай дают горячий чай. Он греет изнутри и не даёт мёрзнуть.',
  hintKettleT: 'Чайник: вода и чай',
  lbKHot: 'Горячий чай', lbKFull: 'Полный', lbKWarm: 'Греется', lbKCold: 'Холодная вода', lbKNoWater: 'Нет воды', lbKEmpty: 'Пусто',
  // gramophone
  gWind: 'Завёл пружину: играет «{name}»',
  gNext: 'Сменил пластинку: «{name}»',
  gOff: 'Снял иглу',
  gDown: 'Пружина кончилась, пластинка затихла',
  gDog: 'Север лёг у патефона',
  hintGram: 'Патефон: три пластинки. Пока играет, в тепле быстрее отдыхаешь и спишь, а Север ложится рядом.',
  hintGramT: 'Патефон: действие — завести',
  rec1: 'Вальс «Метель»', rec2: 'Колыбельная для льдов', rec3: 'Полька «Огни мыса»',
  lbGramOnW5: 'Играет', lbGramOff: 'Завести',
  // shutters
  shOpen: 'Ставни открыты', shClosed: 'Ставни закрыты: окно не тянет тепло',
  hintShutter: 'Ставни: на ночь закрывай — стекло теряет много тепла. Верёвка внизу.',
  hintShutterT: 'Ставни: на ночь закрывай',
  lbShOpenW5: 'Открыты', lbShClosedW5: 'Закрыты',
  // hatch
  hUp: 'Поднялся на крышу', hDown: 'Спустился вниз',
  hintHatch: 'Крыша: расчисти снег лопатой, пока не продавил; откапывай трубу дизеля. Спуск: лестница или просто шагни с края.',
  hintHatchT: 'Крыша: расчисти снег лопатой',
  lbHatchUp: 'На крышу', lbHatchDown: 'Вниз',
  roofLoadW5: 'Крыша скрипит: расчисти снег',
  // damper
  dOpenW5: 'Заслонка открыта: жарче',
  dHalf: 'Заслонка приоткрыта: обычный ход',
  dClosedW5: 'Заслонка закрыта: дым в комнату!',
  dSmokeW5: 'Дым в комнату: открой заслонку',
  hintDamper: 'Заслонка в трубе: открыта — жарче и быстрее горит, закрыта — тихо тлеет долго, но без отдушины это угар.',
  hintDamperT: 'Заслонка: жарче или тише',
  lbD0W5: 'Закрыта', lbD1W5: 'Приоткрыта', lbD2W5: 'Открыта',
});

/** First use of an object: a SHORT toast, and the full explanation in the journal (once per object, saved in its data). */
export function hintTip(f: Fixture, key: string, short: string, long: string) {
  const h = (dd(f).h as Record<string, number> | undefined) ?? (dd(f).h = {});
  if (h[key]) return;
  h[key] = 1; toast(short, 'info'); logJournal(long);
}

// ---------------------------------------------------------------------------------------------------------------------
// power
let powerOn = false;
/** True while a generator runs (lights, receiver and heater are powered). */
export const isPowered = () => powerOn;
export const GEN = { cap: 480, unit: 120 };
const WARM_KINDS = new Set(['campfire', 'brazier', 'stove', 'fat_lamp', 'signal_fire', 'lantern']);

/** Is the exhaust outlet of a generator covered by snow? (the pipe top is recorded at placement: data.exX / data.exY) */
export function exhaustBuried(f: Fixture): boolean {
  const x = num(f, 'exX', -1), y = num(f, 'exY', -1); if (x < 0) return false;
  let n = 0;
  for (let j = -3; j <= -1; j++) for (let i = -1; i <= 2; i++) {
    const m = mat[(y + j) * W + x + i];
    if (m === MAT.SNOW || m === MAT.PACKED || m === MAT.SNOWBLOCK || m === MAT.ICE || m === MAT.GRAVEL || m === MAT.DIRT) n++;
  }
  return n >= 7;
}
/** Chance 0..1 of a start pull from the local air temperature and how warm the unit is (data.warm 0..1). */
export function startChance(f: Fixture): number {
  const [cx, cy] = cen(f);
  const T = tempAt(cx, cy - 6) + 16 * num(f, 'warm', 0);
  return clamp(0.96 - 0.034 * Math.max(0, -T - 4), 0.07, 0.96);
}
export function startGenerator(f: Fixture, quiet = false): boolean {
  if ((f.fuel ?? 0) <= 0 || f.lit) return false;
  f.lit = true; dd(f).bury = 0; dd(f).stalled = false; dd(f).fail = 0; powerOn = true;
  if (!quiet) toast(S.genStart, 'good');
  emit('gen_start', { fixture: f, x: cen(f)[0] });
  const dog = bridge.fauna?.dog, a = dog ? bridge.aiOf?.(dog) : null;
  if (dog && a && Math.abs(dog.x - cen(f)[0]) < 140) a.hold = Math.max(a.hold, 1.6);
  return true;
}
export function stopGenerator(f: Fixture, why: 'user' | 'fuel' | 'stall' = 'user') {
  if (!f.lit) return;
  f.lit = false;
  if (why === 'user') toast(S.genStop, 'info');
  else if (why === 'fuel') { f.fuel = 0; toast(S.genOut, 'warn'); }
  else { dd(f).stalled = true; toast(S.genStallW5, 'bad'); }
  emit('gen_stop', { fixture: f, why, x: cen(f)[0] });
}
export function refuelGenerator(f: Fixture): boolean {
  if (count('diesel') <= 0) return false;
  if ((f.fuel ?? 0) + GEN.unit > GEN.cap + 20) { toast(S.genFull, 'info'); return true; }
  remove('diesel', 1); f.fuel = (f.fuel ?? 0) + GEN.unit;
  toast(S.genFueledW5, 'good'); emit('gen_fuel', { fixture: f });
  return true;
}
// the cord: tap E to add a pull, hold E to keep pulling; at 1.0 the engine tries to catch
export const pull = { f: null as Fixture | null, v: 0, t: 0, fails: 0 };
function genInteract(f: Fixture): boolean {
  hintTip(f, 'gen', S.hintGenT, S.hintGen);
  const sel = inv.slots[inv.sel];
  if (sel && sel.id === 'diesel') return refuelGenerator(f) || true;
  if (f.lit) { stopGenerator(f, 'user'); return true; }
  if ((f.fuel ?? 0) <= 0) { if (refuelGenerator(f)) return true; toast(S.genNoFuelW5, 'info'); return true; }
  if (exhaustBuried(f)) { toast(S.genBuriedW5, 'warn'); return true; }
  if (pull.f !== f) { pull.f = f; pull.v = 0; pull.t = 0; }
  pull.v += 0.34; pull.t = 0;
  emit('gen_pull', { x: cen(f)[0] });
  return true;
}
function pullStep(dt: number) {
  const f = pull.f; if (!f) return;
  if (f.lit || !G.fixtures.includes(f) || playerDist(f) > 40 || !G.player?.alive) { pull.f = null; pull.v = 0; return; }
  if (isKeyDown('KeyE')) { pull.v += dt * 0.6; pull.t = 0; if (Math.random() < dt * 5) emit('gen_pull', { x: cen(f)[0] }); }
  else { pull.t += dt; pull.v -= dt * 0.28; }
  if (pull.v <= 0) { pull.v = 0; if (pull.t > 1.5) { pull.f = null; } return; }
  if (pull.v >= 1) {
    pull.v = 0;
    attemptStart(f);
  }
}
/** One catch attempt (also used by the tests with a forced roll). */
export function attemptStart(f: Fixture, roll = Math.random()): boolean {
  if (exhaustBuried(f)) { toast(S.genBuriedW5, 'warn'); return false; }
  const ch = startChance(f);
  if (roll < ch) { pull.f = null; startGenerator(f); return true; }
  dd(f).fail = num(f, 'fail', 0) + 1; pull.fails++;
  toast(num(f, 'warm', 0) > 0.5 ? S.genCoughWarm : S.genCoughW5, 'warn'); emit('gen_cough', { x: cen(f)[0] });
  return false;
}

let snd = 0, scentT = 0, puffT = 0;
function genStep(f: Fixture, dt: number, gm: number) {
  const d = dd(f);
  d.pullv = pull.f === f ? pull.v : 0;
  const [cx, cy] = cen(f);
  // warmth of the unit: a lit lamp / stove / fire near it warms the block; a running engine keeps itself warm
  let warm = num(f, 'warm', 0);
  const src = f.lit ? null : fixtureNear(cx, cy, 8 * TS, o => !!o.lit && WARM_KINDS.has(o.kind));
  if (f.lit) warm = 1; else if (src) warm = Math.min(1, warm + dt / 22); else warm = Math.max(0, warm - dt / 140);
  d.warm = warm;
  if (!f.lit) return;
  // fuel; the electric heater and the receiver add load
  let load = 1;
  for (const o of G.fixtures) if (o.kind === 'heater' && o.lit) load += 0.6;
  if (radio.on) load += 0.1;
  f.fuel = (f.fuel ?? 0) - gm * load;
  if ((f.fuel ?? 0) <= 0) { stopGenerator(f, 'fuel'); return; }
  if (exhaustBuried(f)) {
    d.bury = num(f, 'bury', 0) + dt;
    if (Number(d.bury) > 3.5) { stopGenerator(f, 'stall'); return; }
    if (Number(d.bury) > 0.4 && Math.random() < dt * 4) spawnFx('smoke', cx + (Math.random() - 0.5) * 8, f.ty * TS - 2, (Math.random() - 0.5) * 6, -4, 1.2);
  } else d.bury = 0;
  // exhaust puffs on the roof, rumble, and the smell/noise that carries over the snow
  puffT -= dt;
  const ex = num(f, 'exX', -1), ey = num(f, 'exY', -1);
  if (puffT <= 0 && ex >= 0 && !exhaustBuried(f)) { puffT = 0.16; spawnFx('smoke', ex + 1 + (Math.random() - 0.5), ey - 1, windAt(ex, ey) * 0.6 + (Math.random() - 0.5) * 2, -9 - Math.random() * 5, 2 + Math.random()); }
  snd -= dt; if (snd <= 0) { snd = 2.3; emit('gen_run', { x: cx }); }
  scentT -= dt;
  if (scentT <= 0) { scentT = 0.25; const sc = bridge.scent; if (sc) { const b = Math.max(0, Math.min(sc.length - 1, Math.floor(cx / (W / sc.length)))); sc[b] += 0.3; } }
  const p = G.player; if (p && Math.abs(p.x - cx) < 70 && Math.abs(p.y - cy) < 40) addShake(0.12);
}

// ---------------------------------------------------------------------------------------------------------------------
// medkit
const PARTS = ['hands', 'feet', 'face'] as const;
const partName = (k: string) => (k === 'hands' ? S.partHands : k === 'feet' ? S.partFeet : S.partFace);
function medkitUse(f: Fixture): boolean {
  const d = dd(f), p = G.player;
  if (d.bandage === undefined) d.bandage = 4; if (d.spirit === undefined) d.spirit = 2;
  hintTip(f, 'med', S.hintMedT, S.hintMed);
  let best: (typeof PARTS)[number] | null = null, score = 0;
  for (const k of PARTS) {
    if (p.frost[k] < 40 && body.scar[k] <= 0) continue;
    const s = p.frost[k] + body.scar[k] * 1.6;
    if (s > score) { score = s; best = k; }
  }
  if (!best) { toast(S.medNoneW5, 'info'); return true; }
  if (Number(d.bandage) <= 0) { toast(S.medEmpty, 'warn'); return true; }
  d.bandage = Number(d.bandage) - 1;
  const bitten = p.frost[best] >= 80 || body.scar[best] >= 14;
  const spirit = bitten && Number(d.spirit) > 0;
  if (spirit) d.spirit = Number(d.spirit) - 1;
  const eff = spirit ? 1 : 0.6;
  body.scar[best] = Math.max(0, body.scar[best] - 16 * eff);
  p.frost[best] = Math.max(body.scar[best], p.frost[best] - 38 * eff);
  toast(fmt(spirit ? S.medTreatSpW5 : S.medTreatW5, { part: partName(best) }), 'good');
  d.openT = 0.7;
  emit('medkit', { part: best, spirit });
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// kettle
const KETTLE_CAP = 3;
function kettleUse(f: Fixture): boolean {
  const d = dd(f);
  hintTip(f, 'kettle', S.hintKettleT, S.hintKettle);
  const hot = num(f, 'hot', 0), w = num(f, 'water', 0), tea = num(f, 'tea', 0);
  if (hot > 0) {
    // a cup goes straight into the pack (hot_tea stack 2); what does not fit stays in the kettle
    const give = Math.min(hot, 2), left = add('hot_tea', give), ok = give - left;
    d.hot = hot - ok; if (ok > 0) { toast(S.kTakeW5, 'good'); emit('kettle_take', {}); }
    return true;
  }
  let did = false;
  if (w < KETTLE_CAP && count('water') > 0) {
    const n = Math.min(KETTLE_CAP - w, count('water')); remove('water', n); d.water = w + n; toast(S.kPourW5, 'good'); did = true;
  }
  if (tea <= 0 && count('tea') > 0 && (num(f, 'water', 0) > 0)) { remove('tea', 1); d.tea = 3; toast(S.kTea, 'good'); did = true; }
  if (did) { emit('kettle_fill', {}); return true; }
  if (w >= KETTLE_CAP && tea > 0) { toast(S.kFull, 'info'); return true; }
  toast(w > 0 || tea > 0 ? kettleWord(f) : S.kNeedW5, 'info');
  return true;
}
function kettleStep(f: Fixture, gm: number, dt: number) {
  const d = dd(f);
  const w = num(f, 'water', 0), tea = num(f, 'tea', 0);
  const src = heated(f);
  if (!src || w <= 0) { if (num(f, 'prog', 0) > 0) d.prog = Math.max(0, num(f, 'prog', 0) - gm * 0.5); return; }
  const [cx, cy] = cen(f);
  if (Math.random() < dt * 2.5) spawnFx('steam', cx + (Math.random() - 0.5) * 2, cy - 4, 0, -7, 1.3);
  if (tea <= 0 || num(f, 'hot', 0) >= KETTLE_CAP) return;
  d.prog = num(f, 'prog', 0) + gm * (src.kind === 'fat_lamp' ? 0.5 : 1);
  if (Number(d.prog) >= 10) {
    d.prog = 0; d.water = w - 1; d.tea = tea - 1; d.hot = num(f, 'hot', 0) + 1;
    emit('kettle_boil', { x: cx });
    if (playerDist(f) < 90) toast(S.kReady, 'good');
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// gramophone
export const RECORD_LEN = [28.8, 32, 21.8];
const recName = (i: number) => (i === 1 ? S.rec1 : i === 2 ? S.rec2 : S.rec3);
export const gramPlaying = (f: Fixture) => !!f.data?.play;
const SPRING = 150;                    // seconds of play per winding
function gramUse(f: Fixture): boolean {
  const d = dd(f);
  hintTip(f, 'gram', S.hintGramT, S.hintGram);
  const rec = num(f, 'rec', 0);
  if (!d.play) { const r = rec >= 1 && rec <= 3 ? rec : 1; d.rec = r; d.play = true; d.left = SPRING; d.pos = 0; toast(fmt(S.gWind, { name: recName(r) }), 'good'); emit('record', { x: cen(f)[0], rec: r, fixture: f }); return true; }
  const next = rec % 3 + 1;
  if (rec === 3) { d.play = false; d.rec = 1; toast(S.gOff, 'info'); emit('record_stop', { x: cen(f)[0] }); return true; }   // 1 -> 2 -> 3 -> off
  d.rec = next; d.left = SPRING; d.pos = 0; toast(fmt(S.gNext, { name: recName(next) }), 'good'); emit('record', { x: cen(f)[0], rec: next, fixture: f });
  return true;
}
function gramStep(f: Fixture, dt: number) {
  const d = dd(f);
  if (!d.play) return;
  const p = G.player;
  d.left = num(f, 'left', 0) - dt; d.pos = num(f, 'pos', 0) + dt;
  const rec = num(f, 'rec', 1);
  if (Number(d.pos) >= (RECORD_LEN[rec - 1] ?? 28)) { d.pos = 0; emit('record', { x: cen(f)[0], rec, fixture: f }); }
  if (Number(d.left) <= 0) { d.play = false; toast(S.gDown, 'info'); emit('record_stop', { x: cen(f)[0], wind: true }); return; }
  if (!p || !p.alive) return;
  const [cx, cy] = cen(f);
  const near = Math.abs(p.x - cx) < 70 && Math.abs(p.y - cy) < 36;
  // resting or asleep in earshot: a little energy back, a little faster
  if (near && p.core > 35.5 && (p.sleeping || Math.abs(p.vx) < 2)) p.energy = Math.min(100, p.energy + 0.32 * dt * (p.sleeping ? G.timeScale : 1));
  // the dog lies down by the gramophone when you are indoors with it
  const dog = bridge.fauna?.dog;
  if (dog && dog.state !== 'dead' && near && Math.abs(dog.x - cx) < 60 && (dog.state === 'sit' || dog.state === 'idle' || dog.state === 'walk') && Math.abs(dog.vx) < 4) {
    dog.state = 'sleep'; if (!d.dogSaid) { d.dogSaid = 1; toast(S.gDog, 'info'); }
  }
  if (Math.random() < dt * 0.9) spawnFx('flake', cx + (Math.random() - 0.5) * 6, cy - 10, (Math.random() - 0.5) * 6, -9, 1.6, [255, 226, 160]);
}

// ---------------------------------------------------------------------------------------------------------------------
// shutters: the window tile (data.wx, data.wy in tiles) switches between GLASS and PLANK
function windowCells(f: Fixture): [number, number] { return [num(f, 'wx', f.tx), num(f, 'wy', f.ty)]; }
export function setShutter(f: Fixture, closed: boolean) {
  const [wx, wy] = windowCells(f), d = dd(f);
  d.closed = closed;
  for (let j = 0; j < TS; j++) for (let i = 0; i < TS; i++) {
    const x = wx * TS + i, y = wy * TS + j, m = mat[y * W + x];
    if (closed && m === MAT.GLASS) setCell(x, y, MAT.PLANK);
    else if (!closed && m === MAT.PLANK) setCell(x, y, MAT.GLASS);
  }
  edited(wx * TS, wy * TS, wx * TS + TS, wy * TS + TS);
}
function shutterToggle(f: Fixture): boolean {
  hintTip(f, 'shut', S.hintShutterT, S.hintShutter);
  const closed = !f.data?.closed;
  setShutter(f, closed);
  toast(closed ? S.shClosed : S.shOpen, 'info'); emit('shutter', { fixture: f, closed });
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// ladder to the roof
function standBox(x: number, y: number): boolean {       // can the 8x20 box with feet at (x,y) stand there?
  for (let yy = y - 20; yy < y; yy++) for (let xx = x - 4; xx < x + 4; xx++) if (WALK[mat[yy * W + xx]]) return false;
  return true;
}
export function roofSpot(f: Fixture): { x: number; y: number } {
  const x = f.tx * TS + 6;
  let y = 90; while (y < 300 && !WALK[mat[y * W + x]]) y++;
  let g = 0; while (!standBox(x, y) && g++ < 16) y--;
  return { x, y: y };
}
function climb(f: Fixture): boolean {
  const p = G.player;
  hintTip(f, 'hatch', S.hintHatchT, S.hintHatch);
  const top = f.ty * TS, bot = (f.ty + f.th) * TS;
  if (p.y < top + 6) { p.x = f.tx * TS; p.y = bot - 1; p.vx = p.vy = 0; toast(S.hDown, 'info'); emit('ladder', { x: p.x, up: false }); return true; }
  const s = roofSpot(f);
  p.x = s.x; p.y = s.y - 1; p.vx = p.vy = 0; toast(S.hUp, 'info'); emit('ladder', { x: p.x, up: true });
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// stove damper
export const dampLevel = (stove: Fixture): number => num(stove, 'dmp', 1);
export function burnMult(f: Fixture): number {
  if (f.kind !== 'stove') return 1;
  const k = dampLevel(f); return k === 0 ? 0.45 : k >= 2 ? 1.6 : 1;
}
export function heatMult(f: Fixture): number {
  if (f.kind !== 'stove') return 1;
  const k = dampLevel(f); return k === 0 ? 0.55 : k >= 2 ? 1.3 : 1;
}
function damperTurn(f: Fixture): boolean {
  hintTip(f, 'damp', S.hintDamperT, S.hintDamper);
  const k = (num(f, 'd', 1) + 1) % 3;       // 1 (half) -> 2 (open) -> 0 (closed) -> 1
  dd(f).d = k;
  toast(k === 2 ? S.dOpenW5 : k === 1 ? S.dHalf : S.dClosedW5, k === 0 ? 'warn' : 'info'); emit('damper', { fixture: f, level: k });
  return true;
}
let smokeT = 0;
function stoveStep(f: Fixture, dt: number) {
  const dmp = fixtureNear(...cen(f), 5 * TS, o => o.kind === 'damper');
  const k = dmp ? num(dmp, 'd', 1) : 1, d = dd(f);
  d.dmp = k;
  if (k === 0 && f.lit) {
    d.chimney = false;                                     // shelter.ts counts a stove without a draught as an open flame (CO)
    smokeT -= dt;
    if (smokeT <= 0) { smokeT = 0.3; const [cx] = cen(f); spawnFx('smoke', cx + (Math.random() - 0.5) * 6, f.ty * TS - 1, (Math.random() - 0.5) * 5, -5, 2.2); }
    if (!d.smokeSaid && playerDist(f) < 60) { d.smokeSaid = 1; toast(S.dSmokeW5, 'warn'); }
  } else if (d.chimney === false) delete d.chimney;
}

// ---------------------------------------------------------------------------------------------------------------------
// roof load: a storm piles snow on the roof; the house creaks (the ladder is the cure)
let roofT = 0, roofWarn = 0;
/** Mean depth (cells) of the snow lying on the house roof over the interior (sampled in 5 columns). */
export function roofSnowDepth(): number {
  const { L, R } = LOC.house; let sum = 0, n = 0;
  for (let k = 0; k < 5; k++) {
    const x = Math.round((L + 3 + ((R - L - 6) * k) / 4) * TS) + 1;
    let y = 100; while (y < 260 && mat[y * W + x] === MAT.AIR) y++;
    let d = 0; while (y < 260 && (mat[y * W + x] === MAT.SNOW || mat[y * W + x] === MAT.PACKED)) { y++; d++; }
    sum += d; n++;
  }
  return n ? sum / n : 0;
}
function roofStep(dt: number) {
  roofT -= dt; roofWarn -= dt; if (roofT > 0) return; roofT = 2;
  const p = G.player;
  if (roofWarn > 0 || !p || G.storm < 0.3 || Math.abs(p.x - ((LOC.house.L + LOC.house.R) * TS) / 2) > 120) return;
  if (roofSnowDepth() > 24) { roofWarn = 90; toast(S.roofLoadW5, 'warn'); emit('roof_creak', { x: p.x }); }
}

// ---------------------------------------------------------------------------------------------------------------------
// dispatch
export function stationInteract(f: Fixture): boolean {
  switch (f.kind) {
    case 'generator': return genInteract(f);
    case 'heater': {
      hintOnce(f, 'heat', S.heaterOn, 'info');
      if (!powerOn) { toast(S.heaterNoPower, 'info'); return true; }
      const off = !f.data?.off; dd(f).off = off; toast(off ? S.heaterOff : S.heaterOn, 'info'); emit('heater', { fixture: f, off }); return true;
    }
    case 'medkit': return medkitUse(f);
    case 'kettle': return kettleUse(f);
    case 'sonde': return sondeInteract(f);
    case 'gramophone': return gramUse(f);
    case 'hatch': return climb(f);
    case 'shutter': return shutterToggle(f);
    case 'damper': return damperTurn(f);
    case 'bell': return bellRing(f);
  }
  return false;
}
let ready = false;
export function stationStep(dt: number, gm: number) {
  if (!ready) { ready = true; installRadioHooks(); initRevealLayer(); }
  let on = false;
  const list = G.fixtures;
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    switch (f.kind) {
      case 'generator': genStep(f, dt, gm); if (f.lit) on = true; break;
      case 'kettle': kettleStep(f, gm, dt); break;
      case 'gramophone': gramStep(f, dt); break;
      case 'stove': stoveStep(f, dt); break;
      case 'medkit': if (num(f, 'openT', 0) > 0) dd(f).openT = Math.max(0, num(f, 'openT', 0) - dt); break;
    }
  }
  powerOn = on;
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    if (f.kind === 'ceiling_lamp') f.lit = on;
    else if (f.kind === 'heater') { f.lit = on && !f.data?.off; if (f.lit) { const [cx, cy] = cen(f); addHeat(cx, cy - 2, 130); } }
  }
  pullStep(dt);
  radioStep(dt);
  sondeStep(dt);
  worldStep(dt, gm);
  roofStep(dt);
  renderPull(pull.f, pull.v, startChance);
  void input;
}
/** Lights of the powered lamps / the heater glow (pooled by fixtures.collectLights). */
export function stationLights(take: (x: number, y: number, r: number, g: number, b: number, rad: number) => void) {
  const t = G.realTime;
  for (const f of G.fixtures) {
    if (!f.lit) continue;
    if (f.kind === 'ceiling_lamp') { const [cx, cy] = cen(f); const fl = 0.97 + 0.03 * Math.sin(t * 40 + f.id); take(cx, cy + 4, 1.0 * fl, 0.9 * fl, 0.62 * fl, 9); }
    else if (f.kind === 'heater') { const [cx, cy] = cen(f); take(cx, cy, 1.0, 0.42, 0.18, 4); }
  }
}
/** Prompt line of a fixture (appended to the tooltip). */
/** Generator state words: buried exhaust, no fuel, running / standing (warm or cold), low fuel. */
function genWord(f: Fixture): string {
  if (exhaustBuried(f)) return S.lbBuryW5;
  if ((f.fuel ?? 0) <= 0) return S.lbNoFuel;
  const low = (f.fuel ?? 0) < GEN.unit;
  if (f.lit) return low ? S.lbGenOnW5 + ' · ' + S.lbLow : S.lbGenOnW5;
  if (low) return S.lbGenOffW5 + ' · ' + S.lbLow;
  return S.lbGenOffW5 + ' · ' + (num(f, 'warm', 0) > 0.5 ? S.lbWarmW5 : S.lbColdW5);
}
/** Medkit state word: bandage and spirit left, bandage only, no bandage. */
function medWord(f: Fixture): string {
  if (num(f, 'bandage', 4) <= 0) return S.lbMedNone;
  return num(f, 'spirit', 2) > 0 ? S.lbMedAll : S.lbMedBand;
}
/** Kettle state word: hot tea, full, warming, cold water, no water, empty. */
export function kettleWord(f: Fixture): string {
  const w = num(f, 'water', 0), tea = num(f, 'tea', 0), hot = num(f, 'hot', 0);
  if (hot > 0) return S.lbKHot;
  if (w >= KETTLE_CAP) return S.lbKFull;
  if (w > 0) return heated(f) ? S.lbKWarm : S.lbKCold;
  return tea > 0 ? S.lbKNoWater : S.lbKEmpty;
}
export function stationLabel(f: Fixture): string {
  switch (f.kind) {
    case 'generator': return genWord(f);
    case 'heater': return !powerOn ? S.lbHeaterNoW5 : f.data?.off ? S.lbHeaterOffW5 : S.lbHeaterOnW5;
    case 'medkit': return medWord(f);
    case 'kettle': return kettleWord(f);
    case 'gramophone': return f.data?.play ? S.lbGramOnW5 : S.lbGramOff;
    case 'shutter': return f.data?.closed ? S.lbShClosedW5 : S.lbShOpenW5;
    case 'hatch': return G.player && G.player.y < f.ty * TS + 6 ? S.lbHatchDown : S.lbHatchUp;
    case 'damper': return [S.lbD0W5, S.lbD1W5, S.lbD2W5][num(f, 'd', 1)] ?? '';
    case 'sonde': return sondeLabel(f);
    case 'radio': return radioLabel(f);
    case 'bell': return bellLabel(f);
    case 'cart': return cartLabel(f);
  }
  return '';
}
export function resetStation() {
  powerOn = false; pull.f = null; pull.v = 0; pull.fails = 0; closeRadio();
}
on('new_game', () => resetStation());
on('respawn', () => { closeRadio(); pull.f = null; pull.v = 0; });
void find; void itemName; void addHeat; void tempAt;
export type { Light };
