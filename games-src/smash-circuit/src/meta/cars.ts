// Car roster (10 cars, every one selectable): stats per model, garage bars, badges and the rival field. PURE (no DOM / three).
// The numbers live in CONFIG.cars; this module turns them into CarStats and UI values.
import { CONFIG, type CarDefConfig } from '../config';
import type { CarStats, RivalMode, SaveData, UpgradeLevels } from '../types';
import { enginePush } from '../sim/carModel';

export type CarId = string;
const CC = CONFIG.cars;
const U = CONFIG.upgrades;

/** Roster in garage order. */
export const CAR_IDS: readonly CarId[] = CC.order;

export function isCarId(id: unknown): id is CarId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(CC.defs, id);
}

/** Valid id or the starter car. */
export function carIdOr(id: unknown): CarId {
  return isCarId(id) ? id : CC.starter;
}

export function carDef(id: CarId): CarDefConfig {
  return CC.defs[carIdOr(id)];
}

const clampLevel = (n: number): number => Math.max(0, Math.min(U.maxLevel, Math.floor(Number.isFinite(n) ? n : 0)));

export const NO_UPGRADES: UpgradeLevels = Object.freeze({ engine: 0, grip: 0, armor: 0 }) as UpgradeLevels;

/**
 * Final stats of model `id` with upgrade levels. Engine: power and ceiling; tyres: grip rate and the cornering limit
 * (so the grip upgrade is felt); armor: damage divisor. Size, mass, drift ease and the trait come with the model.
 */
export function carStats(id: CarId, levels: UpgradeLevels = NO_UPGRADES): CarStats {
  const mid = carIdOr(id);
  const d = CC.defs[mid];
  const e = clampLevel(levels.engine), g = clampLevel(levels.grip), a = clampLevel(levels.armor);
  return {
    enginePower: d.power * (1 + U.engine.powerPerLevel * e),
    topSpeed: d.top * (1 + U.engine.topSpeedPerLevel * e),
    grip: d.grip * (1 + U.grip.gripPerLevel * g),
    armor: d.armor * (1 + U.armor.armorPerLevel * a),
    mass: d.mass,
    modelId: mid,
    latAccel: d.lat * (1 + U.grip.latPerLevel * g),
    brakeDecel: d.brake,
    length: d.length,
    width: d.width,
    drift: d.drift,
    traits: d.traits,
  };
}

/** Upgrade levels of car `id` in a save (zero for a car never upgraded). */
export function levelsOf(save: Pick<SaveData, 'carUpgrades'>, id: CarId): UpgradeLevels {
  const l = save.carUpgrades[carIdOr(id)];
  return l ? { engine: clampLevel(l.engine), grip: clampLevel(l.grip), armor: clampLevel(l.armor) } : { ...NO_UPGRADES };
}

// ------------------------------------------------------------------------------------------------ measured numbers

/** 0 -> 100 km/h time (s) of a stats block on a flat road at full throttle (the car model's own engine curve and drag). */
export function zeroTo100(s: CarStats): number {
  const C = CONFIG.car;
  const dt = 1 / 240;
  let v = 0, t = 0;
  const fx = { powerMul: 1, topSpeedMul: 1, gripMul: 1, steerPull: 0, smoke: 0, sparks: 0 };
  while (v < 100 / 3.6 && t < 30) {
    const a = enginePush(v, s.topSpeed, s, fx) - C.rollingDrag - C.airDrag * v * v;
    v += a * dt; t += dt;
  }
  return t;
}

/** Highest speed (m/s) the car settles at on a long straight (ceiling taper vs drag). */
export function settledTopSpeed(s: CarStats): number {
  const C = CONFIG.car;
  const fx = { powerMul: 1, topSpeedMul: 1, gripMul: 1, steerPull: 0, smoke: 0, sparks: 0 };
  let v = 0;
  for (let i = 0; i < 240 * 60; i++) {
    const a = enginePush(v, s.topSpeed, s, fx) - C.rollingDrag - C.airDrag * v * v;
    v += a / 240;
  }
  return v;
}

/** Cornering limit (m/s^2) at a typical racing speed (downforce included at 75% of the ceiling). */
export function corneringAt(s: CarStats, frac = 0.75): number {
  const df = s.traits?.downforce ?? 0;
  return (s.latAccel ?? CONFIG.car.maxLatAccel) * (1 + df * Math.max(0, Math.min(1, (frac - 0.5) / 0.5)));
}

export type BarKey = 'speed' | 'accel' | 'handling' | 'drift' | 'armor' | 'weight';
export const BAR_KEYS: BarKey[] = ['speed', 'accel', 'handling', 'drift', 'armor', 'weight'];

/** Raw value per bar (bigger = more of it; acceleration as 1 / 0-100 time). */
export function barRaw(s: CarStats): Record<BarKey, number> {
  return {
    speed: settledTopSpeed(s),
    accel: 1 / zeroTo100(s),
    handling: corneringAt(s) * (0.7 + 0.3 * s.grip / CONFIG.car.baseGrip),
    drift: s.drift ?? 1,
    armor: s.armor,
    weight: s.mass,
  };
}

let stockRange: Record<BarKey, [number, number]> | null = null;
function ranges(): Record<BarKey, [number, number]> {
  if (stockRange) return stockRange;
  const r = {} as Record<BarKey, [number, number]>;
  for (const k of BAR_KEYS) r[k] = [Infinity, -Infinity];
  for (const id of CAR_IDS) {
    const raw = barRaw(carStats(id));
    for (const k of BAR_KEYS) { r[k][0] = Math.min(r[k][0], raw[k]); r[k][1] = Math.max(r[k][1], raw[k]); }
  }
  stockRange = r;
  return r;
}

/** Garage bars 1..10 (fractional) across the stock roster; upgraded cars can go past 10 (clamped to 10.9 for display). */
export function bars(s: CarStats): Record<BarKey, number> {
  const raw = barRaw(s), r = ranges(), out = {} as Record<BarKey, number>;
  const n = CC.bars;
  for (const k of BAR_KEYS) {
    const [lo, hi] = r[k];
    out[k] = Math.max(1, Math.min(n + 0.9, 1 + ((raw[k] - lo) / Math.max(1e-9, hi - lo)) * (n - 1)));
  }
  return out;
}

/** Cosmetic badge 0..3 stars for a car: drove it, drove it often, won with it. Never locks anything. */
export function badgeStars(save: Pick<SaveData, 'carRaces' | 'carWins'>, id: CarId): number {
  const B = CC.badge;
  const races = save.carRaces[id] ?? 0, wins = save.carWins[id] ?? 0;
  if (wins >= B.wins3) return 3;
  if (races >= B.races2) return 2;
  if (races >= B.races1) return 1;
  return 0;
}

// ------------------------------------------------------------------------------------------------ rival field

function shuffle<T>(a: T[], r: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}

/**
 * Models the rivals drive. same: the player's model; mixed: all different (the player's own model last, so 7 rivals cover the
 * other 9 models without repeats); random: any model, repeats allowed; pick: `picked` for all.
 */
export function rivalModels(mode: RivalMode, playerCar: CarId, count: number, r: () => number, picked?: CarId): CarId[] {
  const pc = carIdOr(playerCar);
  switch (mode) {
    case 'same': return Array.from({ length: count }, () => pc);
    case 'pick': { const m = carIdOr(picked ?? pc); return Array.from({ length: count }, () => m); }
    case 'random': return Array.from({ length: count }, () => CAR_IDS[Math.floor(r() * CAR_IDS.length) % CAR_IDS.length]);
    case 'mixed':
    default: {
      const others = shuffle(CAR_IDS.filter((c) => c !== pc), r);
      const out: CarId[] = [];
      for (let i = 0; i < count; i++) out.push(i < others.length ? others[i] : (i === others.length ? pc : others[i % others.length]));
      return out;
    }
  }
}

/** Valid rival mode or the default. */
export function rivalModeOr(m: unknown): RivalMode {
  return m === 'same' || m === 'mixed' || m === 'random' || m === 'pick' ? m : CONFIG.rivals.default;
}

/**
 * Speed factor for an AI car of `model` racing a player in `playerModel`: > 1 makes a slower model faster. Applied as
 * ceiling x f, engine and cornering x f^2 (all speeds scale by f, the lap time by 1/f), so every rival model has the player's pace.
 */
export function paceFactor(model: CarId, playerModel: CarId): number {
  const [lo, hi] = CONFIG.rivals.paceClamp;
  return Math.max(lo, Math.min(hi, carDef(model).pace / carDef(playerModel).pace));
}
