// Economy & progression rules. PURE (no DOM, no three.js): runs under Vitest in Node.
import { CONFIG } from '../config';
import type { CarStats, SaveData, UpgradeBranch, UpgradeLevels } from '../types';
import { carIdOr, carStats, levelsOf, type CarId } from './cars';

const U = CONFIG.upgrades;

export function maxLevel(): number { return U.maxLevel; }

/** Cost of buying the NEXT level when the branch is at `level` (0..max). null when maxed. */
export function upgradeCost(level: number): number | null {
  if (!Number.isFinite(level) || level < 0) return null;
  const l = Math.floor(level);
  if (l >= U.maxLevel) return null;
  return U.cost[l] ?? null;
}

const clampLevel = (n: number): number => Math.max(0, Math.min(U.maxLevel, Math.floor(Number.isFinite(n) ? n : 0)));

/** Final car stats of roster car `modelId` (default: the starter) at the given upgrade levels. */
export function statsFor(upgrades: UpgradeLevels, modelId: CarId = CONFIG.cars.starter): CarStats {
  return carStats(modelId, upgrades);
}

/** Can the player buy the next level of `branch` for car `carId` (default: the selected car)? Upgrades are per car. */
export function canBuy(save: SaveData, branch: UpgradeBranch, carId: CarId = save.car): boolean {
  const c = upgradeCost(levelsOf(save, carId)[branch]);
  return c !== null && save.money >= c;
}

/** Returns a new save with one more level of `branch` bought for car `carId` (default: the selected car), or null if not possible. */
export function buyUpgrade(save: SaveData, branch: UpgradeBranch, carId: CarId = save.car): SaveData | null {
  const id = carIdOr(carId);
  const lv = levelsOf(save, id);
  const c = upgradeCost(lv[branch]);
  if (c === null || save.money < c) return null;
  return { ...save, money: save.money - c, carUpgrades: { ...save.carUpgrades, [id]: { ...lv, [branch]: clampLevel(lv[branch]) + 1 } } };
}

/** Race reward in money: prize by place * track multiplier + bonus per segment the player destroyed. */
export function raceReward(trackId: string, place: number, brokenByPlayer: number): number {
  const prizes = CONFIG.economy.prizeByPlace;
  const idx = Math.max(0, Math.min(prizes.length - 1, Math.floor(place) - 1));
  const mul = CONFIG.economy.trackPrizeMul[trackId] ?? 1;
  const broken = Math.max(0, Math.floor(brokenByPlayer || 0));
  return Math.round(prizes[idx] * mul) + broken * CONFIG.economy.destructionBonus;
}

/** Money for one broken piece, by object type: walls/guardrails/road pay, cones pay nothing, curbs nothing. */
export function smashValue(kind: string, propType?: string): number {
  const P = CONFIG.economy.smashPay;
  if (kind === 'prop') return propType !== undefined && propType in P.prop ? P.prop[propType] : P.kind.prop;
  return P.kind[kind] ?? 0;
}

/** Split reward: place prize (x track multiplier) and the capped smash money. */
export function raceRewardParts(trackId: string, place: number, smashMoney: number): { prize: number; smash: number; total: number } {
  const prize = raceReward(trackId, place, 0);
  const smash = Math.max(0, Math.min(CONFIG.economy.smashPay.cap, Math.round(Number.isFinite(smashMoney) ? smashMoney : 0)));
  return { prize, smash, total: prize + smash };
}

/** Repair price for the missing hit points summed over all zones. 0 when nothing is damaged. */
export function repairCost(missingHp: number): number {
  if (!(missingHp > 0.5)) return 0;
  return Math.max(CONFIG.economy.repairMinCost, Math.round(missingHp * CONFIG.economy.repairCostPerHp));
}

/** Id of the track unlocked after `trackId`, or null if it is the last one. */
export function nextTrackId(trackId: string): string | null {
  const order = CONFIG.meta.trackOrder;
  const i = order.indexOf(trackId);
  return i >= 0 && i + 1 < order.length ? order[i + 1] : null;
}

/**
 * Applies a finished race: adds the reward, records best place / best lap, counts the race and unlocks the next
 * track for a top-N finish. Pure: returns a new save.
 */
export function applyRaceResult(
  save: SaveData, trackId: string, place: number, reward: number, lapTime: number,
): { save: SaveData; unlocked: string | null } {
  const bestPlace = { ...save.bestPlace };
  const prevPlace = bestPlace[trackId];
  if (!prevPlace || place < prevPlace) bestPlace[trackId] = place;

  const bestLap = { ...save.bestLap };
  if (lapTime > 0 && (!bestLap[trackId] || lapTime < bestLap[trackId])) bestLap[trackId] = lapTime;

  let unlocked: string | null = null;
  const unlockedTracks = save.unlockedTracks.slice();
  if (place <= CONFIG.economy.unlockPlace) {
    const next = nextTrackId(trackId);
    if (next && !unlockedTracks.includes(next)) { unlockedTracks.push(next); unlocked = next; }
  }

  // per-car tallies (cosmetic badges only)
  const car = carIdOr(save.car);
  const carRaces = { ...save.carRaces, [car]: (save.carRaces[car] ?? 0) + 1 };
  const carWins = place === 1 ? { ...save.carWins, [car]: (save.carWins[car] ?? 0) + 1 } : save.carWins;

  return {
    save: {
      ...save,
      money: save.money + Math.max(0, Math.round(reward)),
      bestPlace, bestLap, unlockedTracks,
      racesFinished: save.racesFinished + 1,
      carRaces, carWins,
    },
    unlocked,
  };
}
