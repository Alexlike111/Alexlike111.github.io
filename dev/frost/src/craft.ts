// Crafting, workbench, kettle (snow -> melt -> water -> tea), drinks and meat, torch, sleep rules and crate loot
// for «Белая Мгла». Pure logic on plain values: the caller passes the pack (inv), the fires, the hero position
// and the kettle state. Nothing here reads G or pl, and nothing runs at import time (the bench list starts empty).
// Phase 1: no game module imports this yet (see the integration note in items_spec.md).
import type { Fire } from './state';
import type { Pack, CountId, GearId, ItemId } from './items';
import { add, has, take, count, label, joinLabels, isGear, fmtNum } from './items';

/** A point in world cells (5 cm). */
export interface Pos { x: number; y: number }

/** Result of a craft, a workbench placement, a pour or a meal. msg is shown on the hint card. */
export interface CraftResult { ok: boolean; msg: string; variant: number }

const ok = (msg: string, variant = -1): CraftResult => ({ ok: true, msg, variant });
const fail = (msg: string): CraftResult => ({ ok: false, msg, variant: -1 });

/** Calls f for every entry that is set (undefined entries are skipped). */
function each<T>(o: Partial<Record<string, T>>, f: (k: string, v: T) => void): void {
  for (const k of Object.keys(o)) { const v = o[k]; if (v !== undefined) f(k, v); }
}

// ---------------- recipes ----------------

/** Counted ingredients (cost) and what a recipe grants: counts, or gear flags set to true. */
export type Cost = Partial<Record<CountId, number>>;
export type Yield = Partial<Record<CountId, number>> & Partial<Record<GearId, true>>;

/** One way to make a recipe: the ingredients it consumes and what it yields. */
export interface Variant { needs: Cost; result: Yield }

export type RecipeId = 'torch' | 'snowshoes' | 'sled' | 'trap' | 'hearth' | 'cord' | 'planks';

/**
 * A craft recipe. needs / result are the primary way; alt lists other ways (tried in order, the first affordable one is used).
 * needsWorkbench: a placed workbench (верстак) must be within BENCH_R cells of the hero.
 */
export interface Recipe extends Variant {
  id: RecipeId;
  name: string;
  description: string;
  needsWorkbench: boolean;
  alt?: readonly Variant[];
}

/** Recipe table v1 (spec «Верстак / крафт»). */
export const RECIPES: readonly Recipe[] = [
  {
    id: 'torch', name: 'Факел', needsWorkbench: false,
    description: 'Ветка с комом смолы или верёвкой. Горит 40 минут, светит в руке и греет руки.',
    needs: { branches: 1, resin: 1 }, result: { torches: 1 },
    alt: [{ needs: { branches: 1, cord: 1 }, result: { torches: 1 } }],
  },
  {
    id: 'snowshoes', name: 'Снегоступы', needsWorkbench: false,
    description: 'Давление на снег в три раза меньше: проваливаешься меньше. Надеваются в экипировку.',
    needs: { branches: 2, cord: 1 }, result: { snowshoes: true },
  },
  {
    id: 'sled', name: 'Санки', needsWorkbench: true,
    description: 'Тащатся за тобой. Вмещают 12 брёвен или 24 блока. Нужен верстак рядом.',
    needs: { logs: 2, cord: 1 }, result: { sled: true },
  },
  {
    id: 'trap', name: 'Силок', needsWorkbench: false,
    description: 'Петля из верёвки на ветке. Ставь на звериной тропе: ловит с шансом за игровой час.',
    needs: { cord: 1, branches: 1 }, result: { traps: 1 },
  },
  {
    id: 'hearth', name: 'Очаг из камней', needsWorkbench: false,
    description: 'Костёр на камнях не тонет в снегу и горит на 30% дольше.',
    needs: { stones: 6 }, result: { hearths: 1 },
  },
  {
    id: 'cord', name: 'Верёвка', needsWorkbench: false,
    description: 'Из веток (лыко) или из шкурки, нарезанной на полосы: из шкурки выходит две верёвки.',
    needs: { branches: 3 }, result: { cord: 1 },
    alt: [{ needs: { pelt: 1 }, result: { cord: 2 } }],
  },
  {
    id: 'planks', name: 'Доски', needsWorkbench: true,
    description: 'Бревно распиливается на две доски. Нужен верстак рядом.',
    needs: { logs: 1 }, result: { planks: 2 },
  },
];

export function recipe(id: string): Recipe | undefined { return RECIPES.find((r) => r.id === id); }

/** Every way to make a recipe: the primary one first, then alt. */
export function variantsOf(r: Recipe): Variant[] { return [{ needs: r.needs, result: r.result }, ...(r.alt ?? [])]; }

// ---------------- workbench (верстак) ----------------

/** A workbench is craftable within this distance (cells: 40 = 2 m, the same reach as feeding a fire). */
export const BENCH_R = 40;
/** Logs that a workbench costs to put down. */
export const BENCH_LOGS = 2;

/** Placed workbenches (phase 2 pushes into it when a bench is put down, and clears it on a new game). */
export const benches: Pos[] = [];

/** True when a placed workbench is within BENCH_R of the position. A null position never has one. */
export function benchNear(at: Pos | null): boolean {
  if (!at) return false;
  for (const b of benches) if (Math.hypot(b.x - at.x, b.y - at.y) <= BENCH_R) return true;
  return false;
}

/** Puts a workbench down at (x, y) for BENCH_LOGS logs. The caller checks that the spot is free ground in reach. */
export function placeWorkbench(pack: Pack, x: number, y: number): CraftResult {
  if (!take(pack, 'logs', BENCH_LOGS)) return fail(`Для верстака нужно ${label('logs', BENCH_LOGS)}`);
  benches.push({ x, y });
  return ok('Верстак поставлен. Крафт с ним — рядом (2 м)');
}

/** Clears placed workbenches (new game, reset). */
export function resetCraft(): void { benches.length = 0; }

// ---------------- crafting ----------------

export interface CraftCheck { ok: boolean; reason: string; variant: number }

/** Ingredients still missing for a cost, as labels («1 верёвка»). */
function missing(pack: Pack, cost: Cost): string[] {
  const out: string[] = [];
  each(cost, (k, n) => {
    const id = k as CountId;
    if (!has(pack, id, n)) out.push(label(id, n - count(pack, id)));
  });
  return out;
}

/**
 * Can the recipe be made now? Checks: the gear is not owned yet, the first affordable variant (in order),
 * and the workbench in reach when the recipe needs one. at is the hero position (null = unknown, no workbench).
 */
export function canCraft(pack: Pack, id: RecipeId, at: Pos | null): CraftCheck {
  const r = recipe(id);
  if (!r) return { ok: false, reason: 'Нет такого рецепта', variant: -1 };
  for (const k of Object.keys(r.result)) {
    if (isGear(k) && has(pack, k)) return { ok: false, reason: `Уже есть: ${label(k)}`, variant: -1 };
  }
  const vs = variantsOf(r);
  let firstMissing: string[] = [];
  for (let v = 0; v < vs.length; v++) {
    const miss = missing(pack, vs[v].needs);
    if (miss.length === 0) {
      if (r.needsWorkbench && !benchNear(at)) return { ok: false, reason: 'Нужен верстак рядом (2 м): поставь его из 2 брёвен', variant: v };
      return { ok: true, reason: '', variant: v };
    }
    if (v === 0) firstMissing = miss;
  }
  return { ok: false, reason: `Не хватает: ${firstMissing.join(', ')}`, variant: -1 };
}

/** Makes the recipe if canCraft says so: consumes the variant's ingredients and grants its yield, all or nothing. */
export function craft(pack: Pack, id: RecipeId, at: Pos | null): CraftResult {
  const c = canCraft(pack, id, at);
  if (!c.ok) return fail(c.reason);
  const r = recipe(id) as Recipe;
  const v = variantsOf(r)[c.variant];
  each(v.needs, (k, n) => { take(pack, k as CountId, n); });
  const got: string[] = [];
  each(v.result as Partial<Record<string, number | true>>, (k, n) => {
    if (n === true) { add(pack, k as GearId); got.push(label(k as GearId)); }
    else { add(pack, k as CountId, n); got.push(label(k as CountId, n)); }
  });
  return ok(`Сделано: ${r.name.toLowerCase()}. Получено: ${got.join(', ')}`, c.variant);
}

/** One menu row for the craft list (ui.ts, phase 2). ways: each variant as «ingredients → yield». */
export interface RecipeRow {
  id: RecipeId; name: string; description: string;
  ways: string[]; bench: boolean; ok: boolean; reason: string;
}

/** The whole recipe list with the affordability of each row, for the «Крафт» menu. */
export function recipeRows(pack: Pack, at: Pos | null): RecipeRow[] {
  return RECIPES.map((r) => {
    const c = canCraft(pack, r.id, at);
    return {
      id: r.id, name: r.name, description: r.description,
      ways: variantsOf(r).map((v) => `${joinLabels(v.needs)} → ${joinLabels(v.result as Partial<Record<ItemId, number | boolean>>)}`),
      bench: r.needsWorkbench, ok: c.ok, reason: c.reason,
    };
  });
}

// ---------------- kettle (котелок): snow -> melt -> water -> tea ----------------

/** Litres of water-equivalent that fit in the kettle (frozen and liquid together). */
export const POT_CAP_L = 2.5;
/** Volume of one 5 cm world cell in litres (0.05 m)^3. A snow tile gives CELL_L * dens / 1000 litres of water. */
export const CELL_L = 0.125;
/** Snow density (kg/m3) used when the caller does not pass the cell's own dens. */
export const SNOW_DENS = 300;
/** Spec: a tile of ice counts as water x1.1. Physically ice gives about 0.92 of that volume: kept as the spec says, see notes. */
export const ICE_TILE_K = 1.1;
/** Share of the fire's power that reaches the kettle. */
export const POT_EFF = 0.35;
/** A lit fire within this many cells (2 m) heats a kettle. Its heat falls off linearly to half at the edge. */
export const FIRE_POT_R = 40;
/** Game seconds of brewing in water at or above BREW_MIN_C. */
export const STEEP_S = 240;
export const BREW_MIN_C = 80;
/** Liquid cools toward the air with this time constant (game seconds) when the kettle is off the fire. */
export const COOL_TAU_S = 900;
/** Litres of tea per portion (one cup). */
export const TEA_PORTION_L = 0.25;

const LF = 334000;  // J/kg, melting ice (1 kg of water = 1 L)
const CW = 4186;    // J/(kg K), water
const LV = 2.26e6; // J/kg, evaporation (the boiling rest steams away)
const EPS = 1e-9;
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * Kettle contents. frozenL: unmelted snow or ice (water-equivalent L); waterL: liquid L; tempC: liquid temperature
 * (0 while anything is still frozen); needles: spruce needles are in the water; steepS: seconds brewed;
 * heated: the last step had heat applied.
 */
export interface KettleState {
  frozenL: number; waterL: number; tempC: number; needles: boolean; steepS: number; heated: boolean;
}

export type KettlePhase = 'empty' | 'snow' | 'melting' | 'water' | 'brewing' | 'tea';

export function emptyKettle(): KettleState {
  return { frozenL: 0, waterL: 0, tempC: 0, needles: false, steepS: 0, heated: false };
}

/**
 * State machine: empty -> snow (filled, cold) -> melting (heat on the snow) -> water (all liquid, hot or cold)
 * -> brewing (needles in water at >= 80 C) -> tea (brewed for STEEP_S). Pouring returns to empty.
 */
export function kettlePhase(k: KettleState): KettlePhase {
  if (k.frozenL > EPS) return k.heated ? 'melting' : 'snow';
  if (k.waterL <= EPS) return 'empty';
  if (k.needles && k.steepS >= STEEP_S) return 'tea';
  if (k.needles && k.tempC >= BREW_MIN_C) return 'brewing';
  return 'water';
}

export interface KettleFill { state: KettleState; added: number; msg: string }

/**
 * Puts snow or ice tiles into the kettle. A tile of snow gives CELL_L * dens / 1000 litres of water (about 37 mL at dens 300).
 * Warm water in the pot gives up its heat to melt the new snow first, so it cools. Refused while tea is brewing or ready.
 */
export function kettleFill(k: KettleState, kind: 'snow' | 'ice', tiles: number, dens = SNOW_DENS): KettleFill {
  const ph = kettlePhase(k);
  if (ph === 'brewing' || ph === 'tea') return { state: k, added: 0, msg: 'В котелке заваривается чай. Сначала слей его' };
  const tileL = kind === 'ice' ? CELL_L * ICE_TILE_K : CELL_L * dens / 1000;
  const room = POT_CAP_L - (k.frozenL + k.waterL);
  const n = Math.min(Math.floor(tiles), Math.floor(room / tileL + EPS));
  if (n <= 0) return { state: k, added: 0, msg: tiles < 1 ? 'Нет снега для котелка' : 'Котелок полон' };
  const m = n * tileL;                                              // litres of water-equivalent going in
  const liquidHeat = k.waterL > EPS && k.tempC > 0 ? k.waterL * CW * k.tempC : 0; // J the warm water can give up down to 0 C
  const melted = Math.min(m * LF, liquidHeat) / LF;                  // litres that melt straight away
  const waterL = k.waterL + melted;
  const tempC = waterL > EPS ? Math.max(0, (liquidHeat - melted * LF) / (waterL * CW)) : 0;
  const state: KettleState = { ...k, frozenL: k.frozenL + (m - melted), waterL, tempC };
  const msg = melted >= m - EPS ? `В котелок: ${n} ${kind === 'ice' ? 'кусков льда' : 'тайлов снега'}, всё растаяло` : `В котелок: ${n} ${kind === 'ice' ? 'кусков льда' : 'тайлов снега'}. Держи над огнём: тает`;
  return { state, added: n, msg };
}

/** Heat the kettle gets from the fires (W, before POT_EFF): the nearest lit fire within FIRE_POT_R, falling off to half at the edge. */
export function kettleFireHeat(fires: readonly Fire[], x: number, y: number): number {
  let best = 0, bestD = Infinity;
  for (const f of fires) {
    if (!f.lit) continue;
    const d = Math.hypot(f.x - x, f.y - y);
    if (d <= FIRE_POT_R && d < bestD) { bestD = d; best = f.power * (1 - 0.5 * d / FIRE_POT_R); }
  }
  return best;
}

/**
 * Advances the kettle by dtGameS game seconds with heatW watts reaching it (see kettleFireHeat). Heat goes to melting
 * first, then to warming the water up to 100 C, then evaporates. Off the fire the liquid cools toward airC (not below 0 C).
 * Brewing time counts only while the water is at or above BREW_MIN_C and nothing is frozen.
 */
export function kettleStep(k: KettleState, dtGameS: number, heatW: number, airC = -20): KettleState {
  let { frozenL, waterL, tempC, steepS } = k;
  const dt = Math.max(0, dtGameS);
  let heated = false;
  if (heatW > 0 && dt > 0 && (frozenL > EPS || waterL > EPS)) {
    heated = true;
    let E = heatW * POT_EFF * dt; // J into the pot
    if (frozenL > EPS) {
      const melt = Math.min(frozenL * LF, E);
      const mL = melt / LF;
      frozenL = Math.max(0, frozenL - mL);
      waterL += mL;
      E -= melt;
    }
    if (E > 0 && waterL > EPS) {
      const toBoil = Math.max(0, 100 - tempC) * waterL * CW;
      if (E <= toBoil) tempC += E / (waterL * CW);
      else { E -= toBoil; tempC = 100; waterL = Math.max(0, waterL - E / LV); }
    }
  } else if (waterL > EPS && dt > 0) {
    tempC = Math.max(0, airC + (tempC - airC) * Math.exp(-dt / COOL_TAU_S));
  }
  if (k.needles && frozenL <= EPS && waterL > EPS && tempC >= BREW_MIN_C) steepS = Math.min(STEEP_S, steepS + dt);
  if (waterL <= EPS) { waterL = 0; tempC = 0; }
  return { frozenL: r6(frozenL), waterL: r6(waterL), tempC, needles: k.needles, steepS, heated };
}

export interface KettleAct { state: KettleState; ok: boolean; msg: string }

/** Puts spruce needles into hot-enough water (liquid only, nothing frozen, not brewed yet). The brewing starts once the water is at 80 C. */
export function kettleNeedles(k: KettleState): KettleAct {
  const ph = kettlePhase(k);
  if (ph === 'empty') return { state: k, ok: false, msg: 'Котелок пуст: сначала набей снега' };
  if (ph === 'snow' || ph === 'melting') return { state: k, ok: false, msg: 'Сначала растопи снег' };
  if (ph === 'tea' || ph === 'brewing' || k.needles) return { state: k, ok: false, msg: 'Хвоя уже в воде' };
  return { state: { ...k, needles: true, steepS: 0 }, ok: true, msg: 'Хвоя в воде. Заварится, когда вода согреется' };
}

/**
 * Pours the kettle out. Liquid water goes to pack.water (litres). Brewed tea goes to pack.tea (one portion per TEA_PORTION_L).
 * The kettle is empty afterwards, unless the pour is refused.
 */
export function kettlePour(k: KettleState, pack: Pack): KettleAct {
  const ph = kettlePhase(k);
  if (ph === 'empty') return { state: k, ok: false, msg: 'Котелок пуст' };
  if (ph === 'snow' || ph === 'melting') return { state: k, ok: false, msg: 'Снег ещё тает' };
  if (ph === 'brewing') return { state: k, ok: false, msg: 'Чай заваривается, подожди' };
  if (ph === 'water') {
    if (k.needles) return { state: k, ok: false, msg: 'Вода ещё не согрелась: хвоя не заварилась' };
    add(pack, 'water', r6(k.waterL));
    return { state: emptyKettle(), ok: true, msg: `Слил воду: ${label('water', k.waterL)}` };
  }
  const portions = Math.floor(k.waterL / TEA_PORTION_L + EPS);
  if (portions < 1) return { state: k, ok: false, msg: 'Чая слишком мало на одну порцию' };
  add(pack, 'tea', portions);
  return { state: emptyKettle(), ok: true, msg: `Чай готов: ${label('tea', portions)}` };
}

// ---------------- drinks and food ----------------

/** Effects returned to the caller (player.ts applies them). core and food are gauge deltas, thirst is a 0..1 delta. */
export interface DrinkEffect { core: number; food: number; thirst: number }

/** Thirst gauge relief for one cup (0..1 scale). */
export const THIRST_CUP = 0.15;
/** A cup is a quarter litre. */
export const CUP_L = 0.25;

/** What a drink does. hot: the water is warm (boiled, poured while steaming). Tea is always hot. */
export function drinkEffect(kind: 'tea' | 'water', hot = false): DrinkEffect {
  if (kind === 'tea') return { core: 0.4, food: 0.02, thirst: THIRST_CUP };
  return hot ? { core: 0.3, food: 0, thirst: THIRST_CUP } : { core: -0.1, food: 0, thirst: THIRST_CUP };
}

export interface DrinkResult extends DrinkEffect { ok: boolean; msg: string }

/** Drinks one cup of tea or water from the pack. On refusal the effects are zero and nothing is consumed. */
export function drink(pack: Pack, kind: 'tea' | 'water', hot = false): DrinkResult {
  const none = { core: 0, food: 0, thirst: 0 };
  if (kind === 'tea') {
    if (!take(pack, 'tea', 1)) return { ok: false, ...none, msg: 'Чая нет. Вскипяти воду в котелке и заварь хвою' };
    const e = drinkEffect('tea');
    return { ok: true, ...e, msg: `Чай: +${fmtNum(e.core)} °C` };
  }
  if (!take(pack, 'water', CUP_L)) return { ok: false, ...none, msg: 'Воды нет. Растопи снег в котелке' };
  const e = drinkEffect('water', hot);
  return { ok: true, ...e, msg: hot ? 'Тёплая вода: +0,3 °C' : 'Холодная вода: −0,1 °C' };
}

/** Eating one tile of raw snow: it cools the body and gives a little thirst relief. Nothing is consumed from the pack. */
export function eatSnow(): DrinkEffect {
  return { core: -0.15, food: 0, thirst: 0.05 };
}

export interface MealResult { ok: boolean; food: number; risk: number; msg: string }

/** Roasting: one raw meat becomes one cooked meat when the meat is by the fire (nearFire: the caller's check). */
export function roast(pack: Pack, nearFire: boolean): CraftResult {
  if (!has(pack, 'meat')) return fail('Нет сырого мяса');
  if (!nearFire) return fail('Положи мясо на костёр или к огню: тогда оно зажарится');
  take(pack, 'meat', 1);
  add(pack, 'cooked', 1);
  return ok('Мясо зажарено');
}

/**
 * Eats a cooked or raw meat piece. Cooked: food +0.25 (about 500 kcal on the 2000 kcal gauge), no risk.
 * Raw: food +0.2 and a 25 % risk that the caller turns into illness.
 */
export function eatMeat(pack: Pack, cooked: boolean): MealResult {
  if (cooked) {
    if (!take(pack, 'cooked', 1)) return { ok: false, food: 0, risk: 0, msg: 'Нет жареного мяса' };
    return { ok: true, food: 0.25, risk: 0, msg: 'Жареное мясо: +500 ккал' };
  }
  if (!take(pack, 'meat', 1)) return { ok: false, food: 0, risk: 0, msg: 'Нет сырого мяса' };
  return { ok: true, food: 0.2, risk: 0.25, msg: 'Сырое мясо: сытно, но может заболеть' };
}

// ---------------- torch (факел) ----------------

/** Game minutes one torch burns (spec: 40). */
export const TORCH_MIN = 40;

/** Lights a spare torch: it takes one from torches and burns TORCH_MIN minutes (torchFuel). Refused while one is already lit. */
export function lightTorch(pack: Pack): CraftResult {
  if (count(pack, 'torchFuel') > 0) return fail('Факел уже горит');
  if (!take(pack, 'torches', 1)) return fail('Нет факелов. Сделай из ветки и смолы');
  pack.torchFuel = TORCH_MIN;
  return ok(`Факел зажжён: ${label('torchFuel', TORCH_MIN)}`);
}

/** Burns the lit torch for gameMin game minutes. Returns true while it still burns. */
export function burnTorch(pack: Pack, gameMin: number): boolean {
  const f = count(pack, 'torchFuel');
  if (f <= 0) return false;
  pack.torchFuel = Math.max(0, r6(f - Math.max(0, gameMin)));
  return count(pack, 'torchFuel') > 0;
}

// ---------------- sleep (спальник и сон) ----------------

/** Sleeping needs a roof and walls (shelter at least this) or a fire nearby. */
export const SLEEP_SHELTER_MIN = 0.5;
/** Shelter air colder than this wakes the sleeper with shivering. */
export const SLEEP_WAKE_C = -15;
/** Time scale while asleep (game minutes per real second). */
export const SLEEP_TIMESCALE = 30;
/** Share of the heat loss left inside a sleeping bag. */
export const BAG_HEAT_LOSS = 0.4;

export interface SleepCheck { ok: boolean; wakeRisk: boolean; msg: string }

/**
 * Can the hero sleep here? shelter: 0..1 from heat.ts shelterAt; airTemp: °C at the hero; nearFire: a lit fire within reach.
 * Open snow with no shelter and no fire is refused. Cold air (below -15 °C) is allowed with wakeRisk: shivering wakes the sleeper.
 */
export function canSleep(shelter: number, airTemp: number, nearFire: boolean, hasBag: boolean): SleepCheck {
  if (!nearFire && shelter < SLEEP_SHELTER_MIN) {
    return { ok: false, wakeRisk: false, msg: 'На открытом снегу спать нельзя. Нужны крыша и стены или костёр рядом' };
  }
  if (airTemp < SLEEP_WAKE_C) {
    return {
      ok: true, wakeRisk: true,
      msg: hasBag ? 'Холодно: ниже −15 °C дрожь будет будить. Лучше у костра' : 'Холодно: ниже −15 °C без спальника дрожь будет будить. Нужен костёр',
    };
  }
  return { ok: true, wakeRisk: false, msg: hasBag ? 'Спишь в спальнике: тепло уходит медленнее' : 'Можно спать в укрытии' };
}

/** Sleep rates: time scale while asleep and the factor on heat loss (0.4 inside a sleeping bag, 1 otherwise). */
export function sleepRates(hasBag: boolean): { timeScale: number; heatLoss: number } {
  return { timeScale: SLEEP_TIMESCALE, heatLoss: hasBag ? BAG_HEAT_LOSS : 1 };
}

// ---------------- crate loot (not wired yet) ----------------

export interface LootEntry { id: ItemId; n: number }

/**
 * Extra items per crate, by crate index: the index of the crate in world.ts (the order of the cx array / loots list).
 * Kettle in crate 1, sleeping bag in crate 4, cord in crate 2, lantern in crate 5, resin in crate 7.
 */
const CRATE_EXTRA: Readonly<Record<number, readonly LootEntry[]>> = {
  1: [{ id: 'kettle', n: 1 }],        // food, food
  2: [{ id: 'cord', n: 3 }],          // snowshoes, food
  4: [{ id: 'sleepingBag', n: 1 }],   // food, crackers, crackers
  5: [{ id: 'lantern', n: 1 }],       // thermos, matches, food
  7: [{ id: 'resin', n: 2 }],         // matches, food, thermos
};

/** Extra items (copies) the crate with this index holds on top of its listed loot. Empty for other crates. */
export function lootTable(crateIndex: number): LootEntry[] {
  const e = CRATE_EXTRA[crateIndex];
  return e ? e.map((x) => ({ ...x })) : [];
}
