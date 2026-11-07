// Fixtures (DESIGN §5): placement/removal and the behaviour of every FixtureKind: fuel, heat, light, smoke, pot (melts snow/ice),
// drying rack, beds, doors, caches/chests, snares, radio, drum -> brazier, barometer, mast. Fire needs matches/flint + tinder;
// the wind blows weak flames out in the open. Fixtures with a solid footprint write MAT.FIXTURE + F_FIXTURE cells.
import { G, newId, toast, type Fixture, type FixtureKind, type Light, type Slot } from './state';
import { emit, on } from './bus';
import { strings, fmt, registerSource, tr } from '../content/i18n';
import { W, H, TS, mat, flags, aux, setCell, edited, wake, F_FIXTURE } from '../engine/grid';
import { MAT, WALK } from '../content/materials';
import { addHeat, windAt, isSkyOpen, HEAT_POWER } from '../engine/heat';
import { spawnFx, burstFx } from '../engine/particles';
import { add, count, remove, inv, spawnDrop, addOrDrop, held, find, changed } from './inventory';
import { getItem, fuelMinutes, itemName } from './items';
import { MIN_PER_SEC, readBarometer } from './weather';
import { floodEnclosure } from './shelter';
import type { Stations } from './recipes';
import { openContainer, stashSelected } from './search';
import { stationInteract, stationStep, stationLights, stationLabel, stationRadio, burnMult, heatMult } from './fixtures_station';

const S = strings('fix', {
  noFuelW5: 'Нечем топить: дрова, уголь, жир',
  fed: 'Подкинул: {name}',
  full: 'Топливник полон',
  noFire: 'Нечем зажечь: нужны спички или огниво',
  noTinder: 'Нужен трут: ягель или парусина',
  windOut: 'Ветер задул пламя — прикрой его',
  windMatch: 'Ветер гасит спичку',
  flintFail: 'Искры не берут. Ещё раз',
  lit: 'Зажёг: {name}',
  burnedOut: '{name} прогорел',
  noIndoorW5: 'В доме костёр душит дымом',
  doorOpen: 'Открыл', doorClosed: 'Закрыл',
  chestEmpty: 'Пусто',
  took: 'Взял: {list}',
  stashed: 'Убрал: {name}',
  potAdded: 'В котелок: {name}',
  potWaterW5: 'Вода готова',
  potTookW5: 'Набрал воды',
  potEmptyW5: 'Котелок пуст: нужен снег или лёд',
  potCold: 'Котелку нужен огонь рядом',
  rackNote: 'Сушилка: у огня одежда сохнет быстрее',
  snareSet: 'Силок взведён',
  snareCatch: 'В силке: {name}',
  snareEmpty: 'Силок пуст',
  radioPart: 'Вставил в рацию: {name}',
  radioNeed: 'В рации не хватает: {list}',
  radioMastW5: 'Нет антенны: подними мачту',
  radioOk: 'Рация починена! Ледокол выходит',
  radioFixed: 'Рация работает. Ждём ледокол',
  drumBrazier: 'Бочка стала жаровней',
  drumDieselW5: 'Налил солярки',
  drumEmpty: 'В бочке пусто',
  drumFullW5: 'Сначала слей солярку (E)',
  potFull: 'Котелок полон',
  fuelBack: 'Топливо вернулось в сумку',
  mastUp: 'Мачта стоит',
  mastNeedW5: 'Для мачты нужны доски и верёвки',
  bedSleep: 'Ложишься спать…',
  pickup: 'Подобрал: {name}',
  cannotPlace: 'Здесь не поставить',
  blocked: 'Мешает {what}',
  noSupport: 'Нужна опора под ногами',
  sign: '{text}',
  // state words (tooltips and the E toast): no numbers, the exact hours and litres are in the bag and the journal
  fuelState: '{name}: {state}',
  stBurning: 'Горит', stSoon: 'Скоро погаснет', stOut: 'Потухла', stUnlit: 'Не горит', stNoFuel: 'Нет топлива',
  stEmpty: 'Пусто', stFull: 'Полный', stSnowMelt: 'Снег тает', stSnowCold: 'Холодный снег',
  stHotWater: 'Горячая вода', stColdWater: 'Холодная вода',
});

export type FuelClass = 'campfire' | 'stove' | 'lamp' | 'brazier';
export interface FixtureDef {
  size: [number, number]; solid: boolean; fuel?: FuelClass; cap: number; heat: number; light: [number, number, number, number];
  portable?: boolean; open?: boolean /* wind-sensitive */; tinder?: boolean; radiant?: number; flame?: number; storage?: number;
}
const D: Partial<Record<FixtureKind, FixtureDef>> = {
  campfire: { size: [2, 1], solid: false, fuel: 'campfire', cap: 360, heat: HEAT_POWER.campfire, light: [1.0, 0.6, 0.26, 10], portable: true, open: true, tinder: true, radiant: 50, flame: 3 },
  signal_fire: { size: [3, 2], solid: false, fuel: 'campfire', cap: 600, heat: 120, light: [1.0, 0.62, 0.3, 18], tinder: true, radiant: 34, flame: 4 },
  fat_lamp: { size: [1, 1], solid: false, fuel: 'lamp', cap: 480, heat: 65, light: [1.0, 0.72, 0.4, 5.5], portable: true, open: true, radiant: 12, flame: 1 },
  brazier: { size: [2, 2], solid: true, fuel: 'brazier', cap: 480, heat: 110, light: [1.0, 0.58, 0.24, 9], portable: true, radiant: 50, flame: 3 },
  stove: { size: [2, 2], solid: true, fuel: 'stove', cap: 600, heat: HEAT_POWER.stove, light: [1.0, 0.55, 0.22, 12], radiant: 60 }   /* stoves and braziers have kindling inside: no tinder needed */,
  torch: { size: [1, 2], solid: false, fuel: 'campfire', cap: 60, heat: HEAT_POWER.torch, light: [1.0, 0.66, 0.32, 7], open: true, radiant: 4, flame: 1.2 },
  lantern: { size: [1, 1], solid: false, cap: 360, heat: 2, light: [1.0, 0.82, 0.5, 10], radiant: 2 },
  pot: { size: [1, 1], solid: false, cap: 0, heat: 0, light: [0, 0, 0, 0], portable: true },
  drying_rack: { size: [3, 2], solid: false, cap: 0, heat: 0, light: [0, 0, 0, 0], portable: true },
  skin_bed: { size: [4, 1], solid: false, cap: 0, heat: 0, light: [0, 0, 0, 0], portable: true },
  bed: { size: [4, 1], solid: false, cap: 0, heat: 0, light: [0, 0, 0, 0] },
  hide_door: { size: [3, 6], solid: true, cap: 0, heat: 0, light: [0, 0, 0, 0], portable: true },
  door: { size: [1, 5], solid: true, cap: 0, heat: 0, light: [0, 0, 0, 0] },
  cache: { size: [2, 2], solid: true, cap: 0, heat: 0, light: [0, 0, 0, 0], portable: true, storage: 8 },
  cart: { size: [4, 2], solid: false, cap: 0, heat: 0, light: [0, 0, 0, 0] },
  cairn: { size: [2, 2], solid: false, cap: 0, heat: 0, light: [0, 0, 0, 0], storage: 4 },
  chest: { size: [2, 2], solid: true, cap: 0, heat: 0, light: [0, 0, 0, 0], storage: 12 },
  shelf: { size: [2, 2], solid: true, cap: 0, heat: 0, light: [0, 0, 0, 0], storage: 12 },
  snare: { size: [1, 1], solid: false, cap: 0, heat: 0, light: [0, 0, 0, 0], portable: true },
  radio: { size: [2, 2], solid: true, cap: 0, heat: 0, light: [0, 0, 0, 0] },
  drum: { size: [2, 2], solid: true, cap: 0, heat: 0, light: [0, 0, 0, 0] },
  mast: { size: [1, 6], solid: false, cap: 0, heat: 0, light: [0, 0, 0, 0] },
  barometer: { size: [1, 1], solid: false, cap: 0, heat: 0, light: [0, 0, 0, 0] },
  table: { size: [3, 2], solid: false, cap: 0, heat: 0, light: [0, 0, 0, 0] },
  workbench: { size: [3, 2], solid: false, cap: 0, heat: 0, light: [0, 0, 0, 0] },
  // DESIGN §15: interactive objects (behaviour in fixtures_station.ts). Lamps are D-less on purpose (never picked as the E target).
  generator: { size: [3, 2], solid: true, cap: 480, heat: 0, light: [0, 0, 0, 0] },
  heater: { size: [2, 1], solid: false, cap: 0, heat: 0, light: [0, 0, 0, 0] },
  medkit: { size: [2, 2], solid: false, cap: 0, heat: 0, light: [0, 0, 0, 0] },
  kettle: { size: [1, 1], solid: false, cap: 0, heat: 0, light: [0, 0, 0, 0] },
  sonde: { size: [2, 4], solid: false, cap: 0, heat: 0, light: [0, 0, 0, 0] },
  gramophone: { size: [2, 1], solid: false, cap: 0, heat: 0, light: [0, 0, 0, 0] },
  hatch: { size: [1, 8], solid: false, cap: 0, heat: 0, light: [0, 0, 0, 0] },
  shutter: { size: [1, 8], solid: false, cap: 0, heat: 0, light: [0, 0, 0, 0] },
  damper: { size: [1, 1], solid: false, cap: 0, heat: 0, light: [0, 0, 0, 0] },
  bell: { size: [1, 2], solid: false, cap: 0, heat: 0, light: [0, 0, 0, 0] },
};
export const FIXTURE_DEFS = D;
export const fixtureDef = (k: FixtureKind): FixtureDef | undefined => D[k];

const NAMES: Record<string, string> = {
  campfire: 'Костёр', signal_fire: 'Сигнальный костёр', fat_lamp: 'Жировая лампа', brazier: 'Бочка-жаровня', stove: 'Печка', torch: 'Факел',
  lantern: 'Фонарь', pot: 'Котелок', drying_rack: 'Сушилка', skin_bed: 'Лежанка из шкур', bed: 'Кровать', hide_door: 'Полог', door: 'Дверь',
  cache: 'Каменный тайник', chest: 'Сундук', shelf: 'Полка', snare: 'Силок', radio: 'Рация', drum: 'Бочка с соляркой', mast: 'Мачта',
  barometer: 'Барометр', table: 'Стол', workbench: 'Верстак', flag: 'Флаг', cairn: 'Тур', cart: 'Вагонетка', kennel: 'Конура', sign: 'Табличка',
  generator: 'Дизель-генератор', ceiling_lamp: 'Лампа', heater: 'Электрообогреватель', medkit: 'Аптечка', kettle: 'Чайник', sonde: 'Площадка метеозонда',
  gramophone: 'Патефон', hatch: 'Лестница на крышу', shutter: 'Ставни', damper: 'Печная заслонка', bell: 'Колокол',
};
for (const k in NAMES) registerSource('fix.name.' + k, NAMES[k]);
export const fixtureName = (k: string) => tr('fix.name.' + k, NAMES[k] ?? k);

// ---------------------------------------------------------------------------------------------------------------------
// queries
export function fixtureAtTile(tx: number, ty: number): Fixture | null {
  for (const f of G.fixtures) if (tx >= f.tx && tx < f.tx + f.tw && ty >= f.ty && ty < f.ty + f.th) return f;
  return null;
}
/** A meteo mast stands if it is marked up or not marked fallen (the world stamps {fallen:true}). */
export const mastUp = (f: Fixture) => !!(f.data && (f.data.up === true || (f.data.up === undefined && f.data.fallen !== true)));
const center = (f: Fixture): [number, number] => [f.tx * TS + (f.tw * TS) / 2, f.ty * TS + (f.th * TS) / 2];
/** Nearest fixture to a world point within `range` cells (distance to its rectangle), optionally filtered. */
export function fixtureNear(x: number, y: number, range: number, pred?: (f: Fixture) => boolean): Fixture | null {
  let best: Fixture | null = null, bd = range * range;
  for (const f of G.fixtures) {
    if (pred && !pred(f)) continue;
    const dx = Math.max(f.tx * TS - x, 0, x - (f.tx + f.tw) * TS), dy = Math.max(f.ty * TS - y, 0, y - (f.ty + f.th) * TS);
    const d = dx * dx + dy * dy;
    if (d <= bd) { bd = d; best = f; }
  }
  return best;
}
/** A fixture of this kind within `tiles` tiles (centre distance) of the point. */
export function nearStation(kind: FixtureKind | FixtureKind[], x: number, y: number, tiles = 5, lit = false): Fixture | null {
  const ks = Array.isArray(kind) ? kind : [kind];
  return fixtureNear(x, y, tiles * TS, f => ks.includes(f.kind) && (!lit || !!f.lit));
}
const FIRE_KINDS: FixtureKind[] = ['campfire', 'brazier', 'stove', 'signal_fire', 'fat_lamp'];
/** Stations available around a point (recipes). */
export function stationsAt(x: number, y: number): Stations {
  return {
    none: true,
    table: !!nearStation(['table', 'workbench'], x, y, 5),
    fire: !!nearStation(FIRE_KINDS, x, y, 5, true),
    drum: !!nearStation('drum', x, y, 5),
    antenna: !!G.fixtures.find(f => f.kind === 'mast' && !mastUp(f) && Math.hypot(center(f)[0] - x, center(f)[1] - y) < 5 * TS * 2),
  };
}
/** Radiant warmth (°C added to the feels-like temperature) from burning fixtures near a point. */
export function radiantWarmth(x: number, y: number): number {
  let w = 0;
  for (const f of G.fixtures) {
    if (!f.lit) continue;
    const d = D[f.kind]; if (!d || !d.radiant) continue;
    const [cx, cy] = center(f);
    const dd = Math.hypot(cx - x, cy - y) / TS;
    w += d.radiant / (1 + (dd * dd) / 6);
  }
  return Math.min(w, 48);
}
/** Drying rate multiplier near fire / stove / rack (1 = ambient). */
export function dryBoost(x: number, y: number): number {
  let b = 1;
  const fire = nearStation(FIRE_KINDS, x, y, 5, true);
  if (fire) b += fire.kind === 'stove' ? 4 : 2.5;
  if (fire && nearStation('drying_rack', x, y, 6)) b += 3;
  return b;
}

// ---------------------------------------------------------------------------------------------------------------------
// cells
function writeCells(f: Fixture, on: boolean) {
  const x0 = f.tx * TS, y0 = f.ty * TS, x1 = (f.tx + f.tw) * TS, y1 = (f.ty + f.th) * TS;
  for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
    const i = y * W + x;
    if (on) { mat[i] = MAT.FIXTURE; aux[i] = 0; flags[i] = F_FIXTURE; }
    else if (mat[i] === MAT.FIXTURE) { mat[i] = 0; aux[i] = 0; flags[i] = 0; }
  }
  wake(x0, y0); edited(x0, y0, x1, y1);
}
const isDoor = (k: FixtureKind) => k === 'door' || k === 'hide_door';
const solidNow = (f: Fixture) => !!D[f.kind]?.solid && (!isDoor(f.kind) || !f.open);

function tileFreeOfSolids(tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= W / TS || ty >= H / TS) return false;
  for (let j = 0; j < TS; j++) for (let i = 0; i < TS; i++) if (WALK[mat[(ty * TS + j) * W + tx * TS + i]]) return false;
  return true;
}
function tileSolidish(tx: number, ty: number): boolean {
  let n = 0;
  for (let j = 0; j < TS; j++) for (let i = 0; i < TS; i++) if (WALK[mat[(ty * TS + j) * W + tx * TS + i]]) n++;
  return n >= 8;
}
export interface Plan { ok: boolean; tx: number; ty: number; tw: number; th: number; reason?: string }
/** Where would `kind` go if the player aims at tile (aimTx, aimTy)? The aimed tile is the bottom-centre; it falls to the ground. */
export function planFixture(kind: FixtureKind, aimTx: number, aimTy: number): Plan {
  const d = D[kind]; const [tw, th] = d?.size ?? [1, 1];
  let tx = aimTx - ((tw - 1) >> 1), ty = aimTy - (th - 1);
  const plan: Plan = { ok: false, tx, ty, tw, th };
  // fall to the ground (up to 6 tiles)
  let guard = 0;
  while (guard++ < 6) {
    let supported = false;
    for (let x = tx; x < tx + tw; x++) if (tileSolidish(x, ty + th)) { supported = true; break; }
    if (supported) break;
    ty++;
  }
  plan.ty = ty;
  for (let y = ty; y < ty + th; y++) for (let x = tx; x < tx + tw; x++) {
    if (!tileFreeOfSolids(x, y)) {
      const fx = fixtureAtTile(x, y);
      if (fx && kind === 'pot' && FIRE_KINDS.includes(fx.kind)) continue;
      plan.reason = fx ? fmt(S.blocked, { what: fixtureName(fx.kind) }) : S.cannotPlace; return plan;
    }
    const fx = fixtureAtTile(x, y);
    if (fx && !(kind === 'pot' && FIRE_KINDS.includes(fx.kind))) { plan.reason = fmt(S.blocked, { what: fixtureName(fx.kind) }); return plan; }
  }
  let sup = false;
  for (let x = tx; x < tx + tw; x++) if (tileSolidish(x, ty + th)) sup = true;
  if (!sup) { plan.reason = S.noSupport; return plan; }
  const p = G.player;
  if (d?.solid && p) {
    const px0 = p.x - p.w / 2, px1 = p.x + p.w / 2, py0 = p.y - p.h, py1 = p.y;
    if (px1 > tx * TS && px0 < (tx + tw) * TS && py1 > ty * TS && py0 < (ty + th) * TS) { plan.reason = fmt(S.blocked, { what: '—' }); return plan; }
  }
  plan.ok = true; return plan;
}

/** Create a fixture with its top-left footprint tile at (tx,ty). `force` skips the placement checks (world stamping, tests). */
export function placeFixture(kind: FixtureKind, tx: number, ty: number, o: { force?: boolean; fuel?: number; lit?: boolean; data?: Record<string, unknown>; items?: Slot[]; open?: boolean } = {}): Fixture | null {
  const d = D[kind]; const [tw, th] = d?.size ?? [1, 1];
  if (!o.force) {
    const pl = planFixture(kind, tx + ((tw - 1) >> 1), ty + th - 1);
    if (!pl.ok || pl.tx !== tx || pl.ty !== ty) return null;
  }
  const f: Fixture = { id: newId(), kind, tx, ty, tw, th };
  if (d?.fuel || kind === 'lantern') { f.fuel = o.fuel ?? 0; f.lit = !!o.lit && (f.fuel ?? 0) > 0; }
  if (isDoor(kind)) f.open = o.open ?? false;
  if (d?.storage) f.items = o.items ?? [];
  f.data = { ...(o.data ?? {}) };
  if (kind === 'pot') Object.assign(f.data, { snow: 0, ice: 0, water: 0, prog: 0 });
  if (kind === 'drum' && f.data.diesel === undefined && f.data.n === undefined) f.data.diesel = 6;
  if (kind === 'snare') Object.assign(f.data, { set: false, t: 0, catch: '' });
  G.fixtures.push(f);
  if (solidNow(f)) writeCells(f, true);
  emit('placed', { kind, fixture: f });
  return f;
}
/** Remove a fixture; clears its cells. */
export function removeFixture(f: Fixture) {
  const i = G.fixtures.indexOf(f); if (i < 0) return;
  G.fixtures.splice(i, 1);
  if (D[f.kind]?.solid) writeCells(f, false);
}
/** Pick up a portable fixture into the inventory (items inside are returned too). */
export function pickupFixture(f: Fixture): boolean {
  const d = D[f.kind]; if (!d?.portable) return false;
  if (f.lit) return false;
  if (d.storage && f.items?.length) return false;
  const [cx, cy] = center(f);
  const id = f.kind === 'torch' ? 'torch' : f.kind;
  if (getItem(id).kind === 'misc' && !getItem(id).fixture && !(id in { torch: 1 })) return false;
  const dur = f.kind === 'torch' ? Math.max(1, Math.round(f.fuel ?? 60)) : undefined;
  const left = add(id, 1, dur);
  if (left > 0) spawnDrop(id, 1, cx, cy - 4, 0, -20, dur);
  if (f.kind === 'pot') {
    const w = Number(f.data?.water ?? 0); if (w > 0) addOrDrop('water', w, cx, cy);
    const sn = Number(f.data?.snow ?? 0), ic = Number(f.data?.ice ?? 0);
    if (sn > 0) addOrDrop('snow', sn, cx, cy);
    if (ic > 0) addOrDrop('ice', ic, cx, cy);
  }
  // unburnt fuel comes back as items (logs for fires, fat for a lamp); a torch keeps its own burn time
  const cls = d.fuel;
  if (cls && f.kind !== 'torch' && (f.fuel ?? 0) > 0) {
    const fuelItem = cls === 'lamp' ? 'fat' : 'log';
    const per = fuelMinutes(fuelItem, cls);
    const n = per > 0 ? Math.floor((f.fuel ?? 0) / per) : 0;
    if (n > 0) { addOrDrop(fuelItem, n, cx, cy); toast(S.fuelBack, 'info'); }
  }
  removeFixture(f);
  toast(fmt(S.pickup, { name: itemName(id) }), 'info');
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// fire
function sourceNear(f: Fixture): boolean {
  const [cx, cy] = center(f);
  if (held.torchLit) { const p = G.player; if (p && Math.hypot(p.x - cx, p.y - 10 - cy) < 24) return true; }
  return !!G.fixtures.find(o => o !== f && o.lit && Math.hypot(center(o)[0] - cx, center(o)[1] - cy) < 14);
}
/** Try to light a fixture. Returns true if it burns now. */
export function tryLight(f: Fixture, quiet = false): boolean {
  const d = D[f.kind]; if (!d) return false;
  if (f.lit) return true;
  const say = (t: string, k: 'info' | 'warn' | 'bad' | 'good' = 'warn') => { if (!quiet) toast(t, k); };
  if ((f.fuel ?? 0) <= 0) { say(S.noFuelW5); return false; }
  const [cx, cy] = center(f);
  if (f.kind === 'campfire' || f.kind === 'brazier') {
    const e = floodEnclosure(cx >> 2, (cy >> 2) - 0);
    if (!e.open && e.tiles < 400 && f.kind === 'campfire') { say(S.noIndoorW5); return false; }
  }
  if (!sourceNear(f)) {
    if (d.tinder && count('lichen') + count('canvas') <= 0) { say(S.noTinder); return false; }
    const windy = d.open && isSkyOpen(cx, cy) && Math.abs(windAt(cx, cy)) > 7;
    if (count('matches') > 0) {
      remove('matches', 1);
      if (windy && Math.random() < 0.6) { say(S.windMatch); return false; }
    } else if (count('flint') > 0) {
      burstFx('spark', cx, cy - 2, 6, 24, 0.5);
      if (Math.random() < 0.65 || windy && Math.random() < 0.2) { say(S.flintFail); return false; }
    } else { say(S.noFire); return false; }
    if (d.tinder) { if (!remove('lichen', 1)) remove('canvas', 1); }
  }
  f.lit = true; (f.data ??= {}).age = 0;
  burstFx('spark', cx, cy - 2, 8, 22, 0.6);
  emit('fire_lit', { kind: f.kind, fixture: f });
  if (!quiet) toast(fmt(S.lit, { name: fixtureName(f.kind) }), 'good');
  return true;
}
function fuelClassOf(f: Fixture): FuelClass | null { return D[f.kind]?.fuel ?? null; }
const SOON_MIN = 20;              // a lit fire with less fuel than this (game minutes) reads «Скоро погаснет»
/** State word of a fuel fixture: burning, about to go out, out (fuel left), never lit, no fuel. The hours stay in the bag / journal. */
export function fuelWord(f: Fixture): string {
  if ((f.fuel ?? 0) <= 0) return S.stNoFuel;
  if (!f.lit) return f.data?.age !== undefined ? S.stOut : S.stUnlit;
  return (f.fuel ?? 0) < SOON_MIN ? S.stSoon : S.stBurning;
}
/** State word of the pot: hot water, warm snow (melting), cold snow, full, empty. */
export function potWord(f: Fixture): string {
  const dd = f.data ?? {};
  const water = Number(dd.water ?? 0), load = Number(dd.snow ?? 0) + Number(dd.ice ?? 0);
  if (water > 0) return heated(f) ? S.stHotWater : S.stColdWater;
  if (load <= 0) return S.stEmpty;
  if (load >= POT_CAP) return S.stFull;
  return heated(f) ? S.stSnowMelt : S.stSnowCold;
}
/** Best fuel item in the inventory for a class (selected item first). */
function pickFuel(cls: FuelClass): string | null {
  const sel = inv.slots[inv.sel];
  if (sel && fuelMinutes(sel.id, cls) > 0) return sel.id;
  const pref = cls === 'lamp' ? ['fat'] : cls === 'stove' ? ['coal', 'log', 'plank'] : cls === 'brazier' ? ['diesel', 'coal', 'log', 'plank'] : ['log', 'plank', 'coal', 'fat'];
  for (const id of pref) if (count(id) > 0 && fuelMinutes(id, cls) > 0) return id;
  return null;
}
/** Add one unit of fuel. Returns the item used or null. */
export function addFuel(f: Fixture, id?: string): string | null {
  const cls = fuelClassOf(f), d = D[f.kind]; if (!cls || !d) return null;
  const use = id ?? pickFuel(cls);
  if (!use || count(use) <= 0) return null;
  const m = fuelMinutes(use, cls); if (m <= 0) return null;
  if ((f.fuel ?? 0) + m > d.cap + 20) { toast(S.full, 'info'); return null; }
  remove(use, 1);
  f.fuel = (f.fuel ?? 0) + m;
  return use;
}

// ---------------------------------------------------------------------------------------------------------------------
// interaction (E)
const dist2 = (f: Fixture) => { const p = G.player; const [cx, cy] = center(f); return Math.hypot(p.x - cx, p.y - 8 - cy); };
export function interact(f: Fixture): boolean {
  const k = f.kind, d = D[k];
  const p = G.player;
  const sel = inv.slots[inv.sel];
  if (!d) return false;
  if (d.fuel) {
    const cls = d.fuel;
    if (k === 'torch') { if (!f.lit) return tryLight(f); return true; }
    // selected fuel -> feed; unlit with fuel -> light; unlit & empty -> feed then light; nothing to do -> pick up
    if (sel && fuelMinutes(sel.id, cls) > 0) { const u = addFuel(f, sel.id); if (u) { toast(fmt(S.fed, { name: itemName(u) }), 'info'); if (!f.lit && (count('matches') > 0 || count('flint') > 0 || sourceNear(f))) tryLight(f); return true; } }
    if (!f.lit && (f.fuel ?? 0) > 0) return tryLight(f);
    if ((f.fuel ?? 0) < d.cap * 0.5) { const u = addFuel(f); if (u) { toast(fmt(S.fed, { name: itemName(u) }), 'info'); if (!f.lit && (count('matches') > 0 || count('flint') > 0 || sourceNear(f))) tryLight(f); return true; } }
    if (!f.lit && d.portable) return pickupFixture(f);
    toast(fmt(S.fuelState, { name: fixtureName(k), state: fuelWord(f) }), 'info');
    return true;
  }
  switch (k) {
    case 'door': case 'hide_door': {
      f.open = !f.open;
      writeCells(f, !f.open);
      toast(f.open ? S.doorOpen : S.doorClosed, 'info');
      f.data = f.data ?? {}; f.data.t = 0;
      emit('door', { fixture: f, open: f.open });
      return true;
    }
    case 'chest': case 'shelf': case 'cache': case 'cairn': {
      // DESIGN §12: opens the container panel; the contents are SEARCHED with time (search.ts). An empty portable stash is picked up as before.
      if (!(f.items ?? []).length && d.portable) { if (pickupFixture(f)) return true; toast(S.chestEmpty, 'info'); return true; }
      emit('chest_opened', { fixture: f });
      return openContainer(f);
    }
    case 'bed': case 'skin_bed': emit('sleep_request', { fixture: f }); return true;
    case 'pot': return interactPot(f);
    case 'drying_rack': toast(S.rackNote, 'info'); return true;
    case 'snare': {
      const dd = f.data ?? (f.data = {});
      if (dd.catch) { const id = String(dd.catch); addOrDrop(id, 1, p.x, p.y - 6); dd.catch = ''; dd.set = false; toast(fmt(S.snareCatch, { name: itemName(id) }), 'good'); emit('snare_taken', { fixture: f }); return true; }
      if (!dd.set) { dd.set = true; dd.t = 0; toast(S.snareSet, 'info'); emit('snare_set', { fixture: f, x: center(f)[0], y: center(f)[1] }); return true; }
      return pickupFixture(f) || (toast(S.snareEmpty, 'info'), true);
    }
    case 'barometer': readBarometer(); return true;
    case 'cart': {
      const dd = f.data ?? (f.data = {});
      if (!dd.loaded && !(f.items ?? []).length) { toast(S.chestEmpty, 'info'); return true; }
      return openContainer(f);          // the cargo (data.loaded) turns into f.items on the first opening
    }
    case 'radio': return interactRadio(f);
    case 'drum': return interactDrum(f);
    case 'mast': {
      if (mastUp(f)) { toast(S.mastUp, 'info'); return true; }
      toast(S.mastNeedW5, 'info'); return true;
    }
    case 'sign': { const t = String(f.data?.text ?? ''); if (t) toast(fmt(S.sign, { text: t }), 'info'); return true; }
    case 'generator': case 'heater': case 'medkit': case 'kettle': case 'sonde': case 'gramophone': case 'hatch': case 'shutter': case 'damper': case 'bell':
      return stationInteract(f);
    case 'lantern': return false;
  }
  void dist2;
  return false;
}
/** G key: put the selected stack into a storage fixture. */
export function stash(f: Fixture): boolean {
  const d = D[f.kind]; if (!d?.storage) return false;
  const sel = inv.slots[inv.sel]; if (!sel) return false;
  return stashSelected(f);          // search.ts: what the player puts in is known at once (not hidden behind the unsearched part)
}

const POT_CAP = 6;
function interactPot(f: Fixture): boolean {
  const dd = f.data!;
  const sel = inv.slots[inv.sel];
  const room = () => POT_CAP - Number(dd.snow ?? 0) - Number(dd.ice ?? 0);
  const put = (id: 'snow' | 'ice', n = 1) => { dd[id] = Number(dd[id] ?? 0) + n; toast(fmt(S.potAdded, { name: itemName(id) }), 'info'); return true; };
  if (sel && (sel.id === 'snow' || sel.id === 'ice')) { if (room() < 1) { toast(S.potFull, 'info'); return true; } remove(sel.id, 1); return put(sel.id); }
  if (held.load >= 8) {
    // one bag (8 cells) of shovelled snow = 1 snow; the rest stays on the blade
    if (room() < 1) { toast(S.potFull, 'info'); return true; }
    const bags = Math.min(Math.floor(held.load / 8), room());
    held.load -= bags * 8; return put('snow', bags);
  }
  const w = Number(dd.water ?? 0);
  if (w > 0) {
    const fi = find(s => s.id === 'flask');
    let taken = 0;
    if (fi >= 0) { const fl = inv.slots[fi]!; const room = 4 - (fl.dur ?? 0); const k = Math.min(room, w); if (k > 0) { fl.dur = (fl.dur ?? 0) + k; taken += k; } }
    if (taken < w) { const k = w - taken; const left = add('water', k); taken += k - left; }
    dd.water = w - taken;
    if (taken > 0) { toast(S.potTookW5, 'good'); return true; }
  }
  const load = Number(dd.snow ?? 0) + Number(dd.ice ?? 0);
  if (load < POT_CAP) {
    if (count('ice') > 0) { remove('ice', 1); return put('ice'); }
    if (count('snow') > 0) { remove('snow', 1); return put('snow'); }
  }
  if (load > 0) { toast(heated(f) ? S.potEmptyW5 : S.potCold, 'info'); return true; }
  if (!heated(f)) { pickupFixture(f); return true; }
  toast(S.potEmptyW5, 'info'); return true;
}
export function heated(f: Fixture): Fixture | null {
  const [cx, cy] = center(f);
  return fixtureNear(cx, cy, 3 * TS, o => o !== f && !!o.lit && FIRE_KINDS.includes(o.kind));
}
function interactRadio(f: Fixture): boolean {
  // DESIGN §15: with nothing to insert the radio is a receiver (dial minigame, needs the generator); the repair flow below is unchanged
  const have0 = (f.data?.have as string[] | undefined) ?? [];
  const spare = ['radio_triode', 'radio_coil', 'battery'].some(i => !have0.includes(i) && count(i) > 0);
  if (!spare && stationRadio(f)) return true;
  return interactRadioRepair(f);
}
function interactRadioRepair(f: Fixture): boolean {
  const dd = f.data ?? (f.data = {});
  if (dd.fixed) { toast(S.radioFixed, 'info'); return true; }
  const have = (dd.have as string[] | undefined) ?? (dd.have = []);
  for (const id of ['radio_triode', 'radio_coil', 'battery']) {
    if (!have.includes(id) && count(id) > 0) { remove(id, 1); have.push(id); toast(fmt(S.radioPart, { name: itemName(id) }), 'good'); emit('radio_part', { id }); }
  }
  dd.parts = have.length;
  if (have.length < 3) {
    const need = ['radio_triode', 'radio_coil', 'battery'].filter(i => !have.includes(i)).map(itemName);
    toast(fmt(S.radioNeed, { list: need.join(', ') }), 'info'); return true;
  }
  if (!G.fixtures.some(m => m.kind === 'mast' && mastUp(m))) { toast(S.radioMastW5, 'info'); return true; }
  dd.fixed = true; toast(S.radioOk, 'good'); emit('radio_fixed', {}); return true;
}
function interactDrum(f: Fixture): boolean {
  const sel = inv.slots[inv.sel];
  const dd = f.data ?? (f.data = {});
  if (sel && (sel.id === 'axe' || sel.id === 'pick')) {
    if (Number(dd.diesel ?? dd.n ?? 0) > 0) { toast(S.drumFullW5, 'warn'); return true; }
    f.kind = 'brazier'; f.fuel = 0; f.lit = false; f.tw = 2; f.th = 2;
    toast(S.drumBrazier, 'good'); emit('drum_brazier', { fixture: f }); return true;
  }
  const dl = Number(dd.diesel ?? dd.n ?? 0);
  if (dl <= 0) { toast(S.drumEmpty, 'info'); return true; }
  const li = find(s => s.id === 'lantern');
  if (li >= 0 && (inv.slots[li]!.dur ?? 0) < 60) { inv.slots[li]!.dur = 360; dd.diesel = dd.n = dl - 1; toast(S.drumDieselW5, 'good'); return true; }
  const left = add('diesel', 1);
  if (left === 0) { dd.diesel = dd.n = dl - 1; toast(S.drumDieselW5, 'good'); }
  return true;
}
/** Craft 'mast' at a fallen antenna: raises the nearest one. */
export function raiseMast(): boolean {
  const p = G.player;
  const m = G.fixtures.filter(f => f.kind === 'mast' && !mastUp(f)).sort((a, b) => Math.hypot(center(a)[0] - p.x, center(a)[1] - p.y) - Math.hypot(center(b)[0] - p.x, center(b)[1] - p.y))[0];
  if (!m) return false;
  (m.data ??= {}).up = true; m.data.fallen = false; toast(S.mastUp, 'good'); emit('mast_up', { fixture: m }); return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// per-step behaviour
let snareFallback = true;
export function setSnareFallback(on: boolean) { snareFallback = on; }
let smokeAcc = 0;
export function stepFixtures(dt: number) {
  if (G.paused) return;
  const gm = dt * MIN_PER_SEC * G.timeScale;
  smokeAcc += dt;
  const doSmoke = smokeAcc >= 0.07; if (doSmoke) smokeAcc = 0;
  const p = G.player;
  for (let i = 0; i < G.fixtures.length; i++) {
    const f = G.fixtures[i], d = D[f.kind];
    if (!d) continue;
    const dd = f.data ?? (f.data = {});
    if (d.fuel && f.lit) {
      const [cx, cy] = center(f);
      f.fuel = (f.fuel ?? 0) - gm * burnMult(f); dd.age = Number(dd.age ?? 0) + dt;
      let out = (f.fuel ?? 0) <= 0;
      // the wind blows a weak or open flame out
      if (!out && d.open && isSkyOpen(cx, cy)) {
        const w = Math.abs(windAt(cx, cy));
        const weak = Number(dd.age) < 12 || (f.fuel ?? 0) < 20 || f.kind === 'torch';
        const pBlow = Math.max(0, (w - (weak ? 5 : 13)) / 14) * (weak ? 0.5 : 0.12) * (f.kind === 'fat_lamp' ? 1.4 : 1);
        if (pBlow > 0 && Math.random() < pBlow * dt) { out = true; if (p && Math.hypot(p.x - cx, p.y - cy) < 90) toast(S.windOut, 'warn'); }
      }
      if (out) {
        f.lit = false; if ((f.fuel ?? 0) < 0) f.fuel = 0;
        if ((f.fuel ?? 0) <= 0 && p && Math.hypot(p.x - cx, p.y - cy) < 120) toast(fmt(S.burnedOut, { name: fixtureName(f.kind) }), 'warn');
        emit('fire_out', { fixture: f });
        continue;
      }
      // solid fixtures (stove, brazier) are poor conductors: the heat goes into the air tile right above them, not into the iron
      addHeat(cx, d.solid ? f.ty * TS - 2 : cy - 2, d.heat * heatMult(f));
      if (doSmoke) smokeFx(f, cx, cy, d);
    }
    switch (f.kind) {
      case 'pot': stepPot(f, dt, gm); break;
      case 'hide_door': case 'door': {
        if (f.open && f.kind === 'hide_door' && p) {
          const [cx, cy] = center(f);
          const near = Math.abs(p.x - cx) < 10 && p.y > f.ty * TS && p.y - p.h < (f.ty + f.th) * TS;
          dd.t = near ? 0 : Number(dd.t ?? 0) + dt;
          if (Number(dd.t) > 3 && !near) { f.open = false; writeCells(f, true); dd.t = 0; }
        }
        break;
      }
      case 'snare': if (dd.set && !dd.catch && snareFallback) {
        dd.t = Number(dd.t ?? 0) + gm;
        if (Number(dd.t) > 180 && Math.random() < 0.006 * gm) { dd.catch = 'ptarmigan'; emit('snare_caught', { fixture: f, item: 'ptarmigan' }); }
      } break;
      case 'torch': break;
    }
  }
  stationStep(dt, gm);
}
function smokeFx(f: Fixture, cx: number, cy: number, d: FixtureDef) {
  const k = d.flame ?? 0;
  if (f.kind === 'stove') {
    const sx = Number(f.data?.smokeX ?? cx), sy = Number(f.data?.smokeY ?? cy - 20);
    spawnFx('smoke', sx + Math.random() * 2 - 1, sy, (Math.random() - 0.5) * 3, -10 - Math.random() * 6, 2.2 + Math.random());
    return;
  }
  if (k <= 0) return;
  const open = isSkyOpen(cx, cy);
  if (Math.random() < 0.5 * Math.min(1, k)) spawnFx('smoke', cx + (Math.random() - 0.5) * f.tw * 2, cy - f.th * 2 - 4, (Math.random() - 0.5) * 3 + G.wind * 0.6, -8 - Math.random() * 5, open ? 2.4 : 1.4, undefined);
  if (k >= 3 && Math.random() < 0.35) spawnFx('spark', cx + (Math.random() - 0.5) * 6, cy - 3, (Math.random() - 0.5) * 8 + G.wind * 0.8, -16 - Math.random() * 14, 0.7 + Math.random() * 0.6);
}
function stepPot(f: Fixture, dt: number, gm: number) {
  const dd = f.data!;
  const hot = heated(f);
  if (!hot) { if (Number(dd.prog) > 0) dd.prog = Math.max(0, Number(dd.prog) - gm * 0.5); return; }
  const rate = hot.kind === 'fat_lamp' ? 0.5 : 1;
  const ice = Number(dd.ice ?? 0), snow = Number(dd.snow ?? 0), water = Number(dd.water ?? 0);
  if (water >= 4 || (ice < 1 && snow < 2)) return;
  dd.prog = Number(dd.prog ?? 0) + gm * rate;
  const need = ice >= 1 ? 20 : 30;
  if (Number(dd.prog) >= need) {
    dd.prog = 0;
    if (ice >= 1) dd.ice = ice - 1; else dd.snow = snow - 2;
    dd.water = water + 1;
    const [cx, cy] = center(f);
    burstFx('steam', cx, cy - 4, 4, 6, 1.2, undefined, 6);
    emit('pot_water', { fixture: f, n: dd.water });
    const p = G.player; if (p && Math.hypot(p.x - cx, p.y - cy) < 80) toast(S.potWaterW5, 'good');
  }
  if (Math.random() < dt * 2) { const [cx, cy] = center(f); spawnFx('steam', cx + (Math.random() - 0.5) * 3, cy - 5, 0, -6, 1.4); }
}

// ---------------------------------------------------------------------------------------------------------------------
// lights (pooled; called once per frame)
const pool: Light[] = [];
export function collectLights(out: Light[]): number {
  let n = 0;
  const take = (x: number, y: number, r: number, g: number, b: number, rad: number) => {
    const l = pool[n] ?? (pool[n] = { x: 0, y: 0, r: 0, g: 0, b: 0, rad: 0 });
    l.x = x; l.y = y; l.r = r; l.g = g; l.b = b; l.rad = rad; n++; out.push(l);
  };
  const t = G.realTime;
  for (const f of G.fixtures) {
    if (!f.lit) continue;
    const d = D[f.kind]; if (!d || d.light[3] <= 0) continue;
    const fl = 0.9 + 0.1 * Math.sin(t * 13 + f.id * 3.1) * Math.sin(t * 7.3 + f.id);
    const [cx, cy] = center(f);
    const lamp = f.kind === 'fat_lamp';
    take(cx, cy - (lamp ? 2 : 4), d.light[0] * fl, d.light[1] * fl, d.light[2] * fl, d.light[3]);
  }
  stationLights(take);
  return n;
}

/** Tooltip line for a fixture. */
export function fixtureLabel(f: Fixture): string {
  const d = D[f.kind];
  let s = fixtureName(f.kind);
  if (d?.fuel) s += ' · ' + fuelWord(f);
  if (f.kind === 'pot') s += ' · ' + potWord(f);
  const x = stationLabel(f); if (x) s += ' · ' + x;
  return s;
}
export function resetFixtures() { G.fixtures.length = 0; }

// walking into a closed door opens it
on('bump', (d: { dir: number; x: number; y: number }) => {
  const tx = Math.floor((d.x + d.dir * 6) / TS), ty = Math.floor((d.y - 6) / TS);
  const f = fixtureAtTile(tx, ty);
  if (f && isDoor(f.kind) && !f.open) interact(f);
});
