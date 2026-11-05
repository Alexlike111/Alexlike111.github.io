// Career mode: cups (series of races), championship points, per-race star goals, unlocks and rewards.
// PURE (no DOM, no three.js, no sim): runs under Vitest in Node. The save shape lives in types.ts (CareerSave).
import { CONFIG } from '../config';
import type { AiPersonality, CareerRun, CareerSave, CarSetup, CarStats, CupRecord } from '../types';
import { DRIVER_NAMES, makeOpponents, type RivalChoice } from './opponents';

// ------------------------------------------------------------------ cup tables

/** One star goal. Evaluated independently of the other two stars of the race. */
export type Goal =
  | { k: 'place'; n: number }     // finish in the top n (n = 1: win the race)
  | { k: 'smash'; n: number }     // break at least n objects
  | { k: 'health'; f: number }    // finish with at least this share of the car left (0..1)
  | { k: 'noRepair' };            // finish without paying for a repair

export type Goals = [Goal, Goal, Goal];

export interface CupRace { track: string; laps: number; /** rival tier (0..2), see CONFIG.meta.opponents */ tier: number; goals: Goals }
export interface Cup {
  id: string;
  nameKey: string;
  /** rival strength shift of the whole cup (negative = easier than the track tier, positive = harder) */
  shift: number;
  races: CupRace[];
}

const top = (n: number): Goal => ({ k: 'place', n });
const smash = (n: number): Goal => ({ k: 'smash', n });
const hp = (f: number): Goal => ({ k: 'health', f });
const NO_REPAIR: Goal = { k: 'noRepair' };

/**
 * Four cups over the existing tracks. Star 1 is the "finish well" goal, star 2 a harder place goal, star 3 a skill/style
 * goal that does not depend on the place (a weaker driver can still earn it by smashing or driving clean).
 */
export const CUPS: readonly Cup[] = [
  { id: 'rookie', nameKey: 'cup.rookie', shift: -0.08, races: [
    { track: 't1', laps: 2, tier: 0, goals: [top(3), top(1), smash(12)] },
    { track: 't2', laps: 2, tier: 0, goals: [top(3), top(1), hp(0.6)] },
    { track: 't1', laps: 3, tier: 0, goals: [top(3), top(1), smash(20)] },
  ] },
  { id: 'turbo', nameKey: 'cup.turbo', shift: 0, races: [
    { track: 't2', laps: 3, tier: 1, goals: [top(3), top(1), smash(20)] },
    { track: 't1', laps: 3, tier: 1, goals: [top(3), top(2), NO_REPAIR] },
    { track: 't3', laps: 2, tier: 1, goals: [top(4), top(2), hp(0.5)] },
    { track: 't2', laps: 3, tier: 1, goals: [top(3), top(1), smash(25)] },
  ] },
  { id: 'frost', nameKey: 'cup.frost', shift: 0.06, races: [
    { track: 't3', laps: 3, tier: 2, goals: [top(4), top(2), smash(15)] },
    { track: 't1', laps: 3, tier: 1, goals: [top(3), top(1), NO_REPAIR] },
    { track: 't3', laps: 3, tier: 2, goals: [top(3), top(1), hp(0.5)] },
    { track: 't2', laps: 3, tier: 2, goals: [top(3), top(1), smash(30)] },
  ] },
  { id: 'grand', nameKey: 'cup.grand', shift: 0.12, races: [
    { track: 't2', laps: 3, tier: 2, goals: [top(3), top(1), NO_REPAIR] },
    { track: 't3', laps: 3, tier: 2, goals: [top(3), top(1), hp(0.6)] },
    { track: 't1', laps: 4, tier: 2, goals: [top(3), top(1), smash(35)] },
    { track: 't3', laps: 3, tier: 2, goals: [top(3), top(1), NO_REPAIR] },
  ] },
];

export const cupIndex = (id: string): number => CUPS.findIndex((c) => c.id === id);
export const cupById = (id: string): Cup | undefined => CUPS.find((c) => c.id === id);
export const raceKey = (cupId: string, i: number): string => `${cupId}:${i}`;

// ------------------------------------------------------------------ save shape

export function defaultCareer(): CareerSave { return { stars: {}, cups: {}, run: null }; }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const int = (v: unknown, lo: number, hi: number, d: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : d;

/** Merges stored career data over the defaults, dropping anything invalid (unknown cups, impossible results). Never throws. */
export function sanitizeCareer(v: unknown): CareerSave {
  const out = defaultCareer();
  if (!isObj(v)) return out;
  if (isObj(v.stars)) {
    for (const cup of CUPS) cup.races.forEach((_, i) => {
      const key = raceKey(cup.id, i);
      const m = int((v.stars as Record<string, unknown>)[key], 0, 7, 0);
      if (m > 0) out.stars[key] = m;
    });
  }
  if (isObj(v.cups)) {
    for (const cup of CUPS) {
      const c = (v.cups as Record<string, unknown>)[cup.id];
      if (!isObj(c)) continue;
      const rec: CupRecord = { done: c.done === true, best: int(c.best, 0, CONFIG.race.cars, 0), claimed: int(c.claimed, 0, 1e8, 0) };
      if (rec.done || rec.best > 0 || rec.claimed > 0) out.cups[cup.id] = rec;
    }
  }
  const r = v.run;
  if (isObj(r) && typeof r.cup === 'string' && Array.isArray(r.results)) {
    const cup = cupById(r.cup);
    const n = CONFIG.race.cars;
    const valid = (row: unknown): row is number[] => Array.isArray(row) && row.length === n
      && new Set(row).size === n && row.every((p) => Number.isInteger(p) && p >= 1 && p <= n);
    if (cup && r.results.length <= cup.races.length && r.results.every(valid)) {
      out.run = { cup: cup.id, seed: int(r.seed, 0, 0x7fffffff, 1), results: (r.results as number[][]).map((row) => row.slice()) };
    }
  }
  return out;
}

// ------------------------------------------------------------------ points, standings

export function pointsFor(place: number): number {
  const P = CONFIG.career.points;
  const i = Math.floor(place) - 1;
  return i >= 0 && i < P.length ? P[i] : 0;
}

export interface Standing { driver: number; points: number; wins: number; best: number; last: number; pos: number }

/**
 * Championship table after `results` (one row of 8 places per race, driver 0 = the player).
 * Order: points, then wins, then best single place, then the latest race, then driver number (the player is 0).
 */
export function standings(results: number[][]): Standing[] {
  const n = CONFIG.race.cars;
  const rows: Standing[] = Array.from({ length: n }, (_, d) => ({ driver: d, points: 0, wins: 0, best: n + 1, last: n, pos: 0 }));
  results.forEach((res, ri) => {
    for (let d = 0; d < n; d++) {
      const p = res[d] ?? n;
      const r = rows[d];
      r.points += pointsFor(p);
      if (p === 1) r.wins++;
      if (p < r.best) r.best = p;
      if (ri === results.length - 1) r.last = p;
    }
  });
  rows.sort((a, b) => b.points - a.points || b.wins - a.wins || a.best - b.best || a.last - b.last || a.driver - b.driver);
  rows.forEach((r, i) => { r.pos = i + 1; });
  return rows;
}

/** Turns "place per car id" (index = car id, 0 = player) into a clean 1..n permutation; the player keeps `playerPlace` when it is free. */
export function normalizePlaces(placeById: number[], playerPlace: number): number[] {
  const n = CONFIG.race.cars;
  const keys = Array.from({ length: n }, (_, d) => ({ d, p: d === 0 ? playerPlace : (placeById[d] ?? n + 1) }));
  // the player wins ties against a car reporting the same place (the player's place was announced at the line)
  keys.sort((a, b) => a.p - b.p || (a.d === 0 ? -1 : b.d === 0 ? 1 : a.d - b.d));
  const out = new Array<number>(n).fill(n);
  keys.forEach((k, i) => { out[k.d] = i + 1; });
  return out;
}

// ------------------------------------------------------------------ stars

export interface RaceOutcome {
  place: number;
  /** objects the player broke */
  broken: number;
  /** player health at the finish, 0..1 */
  health: number;
  /** paid repairs during the race */
  repairs: number;
}

export function evaluateGoal(g: Goal, o: RaceOutcome): boolean {
  switch (g.k) {
    case 'place': return o.place >= 1 && o.place <= g.n;
    case 'smash': return o.broken >= g.n;
    case 'health': return o.health >= g.f;
    case 'noRepair': return o.repairs === 0;
    default: return false;
  }
}

export function evaluateStars(goals: Goals, o: RaceOutcome): [boolean, boolean, boolean] {
  return [evaluateGoal(goals[0], o), evaluateGoal(goals[1], o), evaluateGoal(goals[2], o)];
}

export const maskOf = (s: readonly boolean[]): number => (s[0] ? 1 : 0) | (s[1] ? 2 : 0) | (s[2] ? 4 : 0);
export const starsOfMask = (m: number): [boolean, boolean, boolean] => [(m & 1) !== 0, (m & 2) !== 0, (m & 4) !== 0];
export const countBits = (m: number): number => ((m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1));

export function raceStars(c: CareerSave, cupId: string, i: number): [boolean, boolean, boolean] { return starsOfMask(c.stars[raceKey(cupId, i)] ?? 0); }
export function cupStars(c: CareerSave, cupId: string): number {
  const cup = cupById(cupId);
  if (!cup) return 0;
  return cup.races.reduce((n, _, i) => n + countBits(c.stars[raceKey(cupId, i)] ?? 0), 0);
}
export const cupMaxStars = (cup: Cup): number => cup.races.length * 3;
export function totalStars(c: CareerSave): number { return CUPS.reduce((n, cup) => n + cupStars(c, cup.id), 0); }
export const maxStars = (): number => CUPS.reduce((n, cup) => n + cupMaxStars(cup), 0);

// ------------------------------------------------------------------ unlocks

export interface CupLock { unlocked: boolean; needStars: number; missingStars: number; needPrev: boolean }

/**
 * Cup 0 is always open. Cup k opens when cup k-1 has been completed once AND the total star count (from ANY cup, so a hard
 * race can be made up elsewhere) has reached CONFIG.career.unlockStars[k].
 */
export function cupLock(c: CareerSave, idx: number): CupLock {
  if (idx <= 0) return { unlocked: true, needStars: 0, missingStars: 0, needPrev: false };
  const need = CONFIG.career.unlockStars[idx] ?? Infinity;
  const have = totalStars(c);
  const needPrev = !c.cups[CUPS[idx - 1]?.id ?? '']?.done;
  const missing = Math.max(0, need - have);
  return { unlocked: !needPrev && missing === 0, needStars: need, missingStars: missing, needPrev };
}
export const cupUnlocked = (c: CareerSave, idx: number): boolean => cupLock(c, idx).unlocked;

/** The cup to highlight: the first unlocked cup that is not completed yet, else the last unlocked one. */
export function currentCupIndex(c: CareerSave): number {
  let last = 0;
  for (let i = 0; i < CUPS.length; i++) {
    if (!cupUnlocked(c, i)) break;
    last = i;
    if (!c.cups[CUPS[i].id]?.done) return i;
  }
  return last;
}

// ------------------------------------------------------------------ runs

/** Races already played in the run of `cupId` (0 when there is no run, or it belongs to another cup). */
export function runProgress(c: CareerSave, cupId: string): number {
  return c.run && c.run.cup === cupId ? c.run.results.length : 0;
}
export function runActive(c: CareerSave, cupId: string): boolean {
  const cup = cupById(cupId);
  return !!cup && !!c.run && c.run.cup === cupId && c.run.results.length < cup.races.length;
}
export function runFinished(c: CareerSave, cupId: string): boolean {
  const cup = cupById(cupId);
  return !!cup && !!c.run && c.run.cup === cupId && c.run.results.length >= cup.races.length;
}

/** A fresh run of a cup (replaces any run in progress). Returns the same career when the cup is unknown or locked. */
export function startRun(c: CareerSave, cupId: string, seed: number): CareerSave {
  const i = cupIndex(cupId);
  if (i < 0 || !cupUnlocked(c, i)) return c;
  return { ...c, run: { cup: cupId, seed: int(seed, 0, 0x7fffffff, 1), results: [] } };
}

export function abandonRun(c: CareerSave): CareerSave { return c.run ? { ...c, run: null } : c; }

export function cupBonus(idx: number, pos: number): number {
  const base = CONFIG.career.cupBonusBase[Math.max(0, Math.min(CONFIG.career.cupBonusBase.length - 1, idx))] ?? 0;
  const f = CONFIG.career.cupBonusFactor[pos - 1] ?? CONFIG.career.cupBonusOtherFactor;
  return Math.round(base * f);
}

export interface RaceCommit {
  career: CareerSave;
  /** stars earned in THIS race (this attempt) and the ones that are new best-ever */
  stars: [boolean, boolean, boolean];
  newStars: [boolean, boolean, boolean];
  starCoins: number;
  /** championship points of the player for this race and the table after it */
  points: number;
  table: Standing[];
  playerPos: number;
  cupDone: boolean;
  /** coins of the final standing paid now (0 when already claimed) */
  cupCoins: number;
  /** id of a cup that this result opened */
  unlockedCup: string | null;
}

/**
 * Commits a finished career race: records the places (a repeated attempt of the same race index replaces the old result and
 * drops later ones), saves best-ever stars, and, when the last race is in, closes the cup (record, bonus coins, next cup).
 * Pure: returns a new CareerSave. `places[d]` is the finishing place of driver d (0 = the player).
 */
export function commitRace(c: CareerSave, cupId: string, raceIdx: number, places: number[], o: RaceOutcome): RaceCommit {
  const ci = cupIndex(cupId);
  const cup = CUPS[ci];
  if (!cup || raceIdx < 0 || raceIdx >= cup.races.length) {
    return { career: c, stars: [false, false, false], newStars: [false, false, false], starCoins: 0, points: 0, table: standings([]), playerPos: 0, cupDone: false, cupCoins: 0, unlockedCup: null };
  }
  // races are played in order: an attempt of race k replaces the old result of k and drops everything after it
  const prior = c.run && c.run.cup === cupId ? c.run.results : [];
  const run: CareerRun = { cup: cupId, seed: c.run && c.run.cup === cupId ? c.run.seed : 1, results: prior.slice(0, Math.min(raceIdx, prior.length)) };
  run.results.push(places.slice());

  const stars = evaluateStars(cup.races[raceIdx].goals, o);
  const key = raceKey(cupId, raceIdx);
  const oldMask = c.stars[key] ?? 0;
  const mask = oldMask | maskOf(stars);
  const newBits = mask & ~oldMask;
  const newStars = starsOfMask(newBits);
  const starCoins = countBits(newBits) * CONFIG.career.starBonus;

  const before = CUPS.map((_, i) => cupUnlocked(c, i));
  const cups = { ...c.cups };
  const table = standings(run.results);
  const playerPos = table.find((r) => r.driver === 0)?.pos ?? CONFIG.race.cars;
  const cupDone = run.results.length >= cup.races.length;
  let cupCoins = 0;
  if (cupDone) {
    const rec: CupRecord = cups[cupId] ?? { done: false, best: 0, claimed: 0 };
    const bonus = cupBonus(ci, playerPos);
    cupCoins = Math.max(0, bonus - rec.claimed);
    cups[cupId] = { done: true, best: rec.best > 0 ? Math.min(rec.best, playerPos) : playerPos, claimed: Math.max(rec.claimed, bonus) };
  }
  const career: CareerSave = { stars: mask > 0 ? { ...c.stars, [key]: mask } : c.stars, cups, run };
  const unlockedIdx = CUPS.findIndex((_, i) => !before[i] && cupUnlocked(career, i));
  const points = pointsFor(places[0]);
  return { career, stars, newStars, starCoins, points, table, playerPos, cupDone, cupCoins, unlockedCup: unlockedIdx >= 0 ? CUPS[unlockedIdx].id : null };
}

// ------------------------------------------------------------------ rivals of a cup

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: readonly T[], r: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** The 7 AI drivers of a cup run: fixed names (driver 1..7) for the whole run, so the standings table makes sense. */
export function cupNames(seed: number): string[] {
  return shuffle(DRIVER_NAMES, rng((seed ^ 0x51ed270b) >>> 0)).slice(0, CONFIG.race.cars - 1);
}

/** Paint of the AI drivers of a cup run (never the player's colour). */
export function cupColors(seed: number, playerColor: number): number[] {
  const all = CONFIG.render.carColors.map((_, i) => i).filter((i) => i !== playerColor);
  return shuffle(all, rng((seed ^ 0x7f4a7c15) >>> 0));
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/**
 * The AI field of race `raceIdx` of `cup`: the normal field of the race's tier (same builder as Quick race), re-dressed with the
 * run's driver names and colours and pushed stronger/weaker by the cup's shift.
 */
export function cupOpponents(cup: Cup, raceIdx: number, playerStats: CarStats, seed: number, playerColor: number, rivals?: RivalChoice): CarSetup[] {
  const race = cup.races[Math.max(0, Math.min(cup.races.length - 1, raceIdx))];
  const base = makeOpponents(race.tier, playerStats, seed, playerColor, rivals);
  const names = cupNames(seed), colors = cupColors(seed, playerColor);
  const A = CONFIG.career.ai;
  return base.map((car, i) => {
    let ai: AiPersonality | undefined = car.ai;
    if (ai) {
      const skill = clamp01(ai.skill + cup.shift * A.skillShift);
      ai = { ...ai, skill, mistakeRate: Math.min(1, (1 - skill) * CONFIG.meta.opponents.mistakeBase) };
    }
    const m = 1 + cup.shift * A.statShift;
    return { ...car, name: names[i] ?? car.name, colorIndex: colors[i % colors.length] ?? car.colorIndex, stats: { ...car.stats, enginePower: car.stats.enginePower * m, grip: car.stats.grip * m }, ai };
  });
}
