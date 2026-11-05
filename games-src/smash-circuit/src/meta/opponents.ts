// Builds the 7 AI opponents (and the player's CarSetup). PURE; deterministic for a given seed.
import { CONFIG } from '../config';
import type { AiPersonality, CarSetup, CarStats, RivalMode, SaveData } from '../types';
import { carIdOr, carStats, levelsOf, paceFactor, rivalModeOr, rivalModels } from './cars';

/** Display names are proper nouns: deliberately not translated. */
export const DRIVER_NAMES = [
  'Blaze', 'Nitro', 'Dusty', 'Rocket', 'Turbo', 'Maverick', 'Zed', 'Viper', 'Rusty', 'Drift',
  'Kuzya', 'Vasya', 'Gaz', 'Torque', 'Sparky', 'Bolt', 'Rex', 'Pixel', 'Mango', 'Comet',
];

// mulberry32; local copy so that meta stays independent from src/sim.
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

function shuffled<T>(arr: T[], r: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function makePlayerSetup(save: SaveData, name: string): CarSetup {
  const car = carIdOr(save.car);
  return { id: 0, isPlayer: true, name, colorIndex: save.carColor, stats: carStats(car, levelsOf(save, car)) };
}

/** Which cars the rivals drive (pre-race screen / settings). */
export interface RivalChoice { mode: RivalMode; car?: string }

/** Rival choice stored in the settings (defaults filled in). */
export function rivalChoiceOf(save: SaveData): RivalChoice {
  return { mode: rivalModeOr(save.settings.rivals), car: save.settings.rivalCar };
}

/**
 * 7 AI opponents (ids 1..7). Difficulty rises with the track index; the AI also mirrors a share of the player's
 * upgrade advantage so a fully upgraded car is still challenged. Colours never clash with `playerColor`.
 * Rival models follow `rivals` (no choice given: every rival drives the player's model; the game passes the saved choice). Fairness: a rival car's speeds are scaled by its model's measured
 * pace relative to the player's model (paceFactor), so the field is equally strong whatever cars are on the grid; the model
 * keeps its handling, size, mass, armor and trait.
 */
export function makeOpponents(trackIndex: number, playerStats: CarStats, seed: number, playerColor = 0, rivals?: RivalChoice): CarSetup[] {
  const O = CONFIG.meta.opponents;
  const ti = Math.max(0, Math.min(O.skill.length - 1, Math.floor(trackIndex) || 0));
  const r = rng((seed ^ 0x9e3779b9) + ti * 7919);
  const count = CONFIG.race.cars - 1;

  const names = shuffled(DRIVER_NAMES, r).slice(0, count);
  const colours = shuffled(CONFIG.render.carColors.map((_, i) => i).filter((i) => i !== playerColor), r);
  const [skillLo, skillHi] = O.skill[ti];
  const [scaleLo, scaleHi] = O.statScale[ti];

  // the player's upgrade advantage is measured against the stock version of the player's own model
  const playerModel = carIdOr(playerStats.modelId);
  const base = carStats(playerModel);
  const powerAdv = playerStats.enginePower / base.enginePower - 1;
  const gripAdv = playerStats.grip / base.grip - 1;
  const armorAdv = playerStats.armor / base.armor - 1;
  const topAdv = playerStats.topSpeed / base.topSpeed - 1;
  const follow = O.followPlayer;
  // separate stream, so the model choice never shifts names / skills of a given seed
  const models = rivalModels(rivals ? rivalModeOr(rivals.mode) : 'same', playerModel, count, rng((seed ^ 0x2c1b3c6d) + ti * 104729), rivals?.car);

  // Strength rank of each car is a seeded permutation: the car id says nothing about how fast the driver is,
  // and the order changes from race to race (same seed -> same field).
  const rank = shuffled(Array.from({ length: count }, (_, i) => i), r);

  const out: CarSetup[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : rank[i] / (count - 1);           // 0 = weakest, 1 = strongest of the field
    const skill = Math.min(1, Math.max(0, lerp(skillLo, skillHi, t) + (r() - 0.5) * O.skillJitter));
    const scale = lerp(scaleLo, scaleHi, t) * (1 - O.scaleJitter / 2 + r() * O.scaleJitter);
    const ai: AiPersonality = {
      skill,
      aggression: lerp(O.aggression[0], O.aggression[1], r()),
      laneOffset: (r() * 2 - 1) * O.laneSpread,
      mistakeRate: Math.min(1, (1 - skill) * O.mistakeBase),
    };
    const m = carStats(models[i]);
    const f = paceFactor(models[i], playerModel);
    out.push({
      id: i + 1,
      isPlayer: false,
      name: names[i],
      colorIndex: colours[i % colours.length],
      stats: {
        ...m,
        enginePower: m.enginePower * f * f * scale * (1 + powerAdv * follow),
        topSpeed: m.topSpeed * f * lerp(0.96, 1.0, t) * (1 + topAdv * follow),
        grip: m.grip * f * scale * (1 + gripAdv * follow),
        latAccel: (m.latAccel ?? CONFIG.car.maxLatAccel) * f * f * (1 + gripAdv * follow * 0.5),
        brakeDecel: (m.brakeDecel ?? CONFIG.car.brakeDecel) * f * f,
        armor: m.armor * (1 + armorAdv * follow),
      },
      ai,
    });
  }
  assignStyles(out, O.rammers[ti], O.blockers[ti]);
  return out;
}

/**
 * Rival characters: the most aggressive drivers become rammers (they hunt the human and smashable props), the strongest of the rest
 * blocks (defends the line against a follower), everyone else is a clean racer. Aggression follows the character.
 */
function assignStyles(field: CarSetup[], rammers: number, blockers: number): void {
  const byAggr = field.map((_, i) => i).sort((a, b) => field[b].ai!.aggression - field[a].ai!.aggression);
  const rest: number[] = [];
  byAggr.forEach((i, k) => {
    const ai = field[i].ai!;
    if (k < rammers) { ai.style = 'rammer'; ai.aggression = Math.max(ai.aggression, 0.8); } else rest.push(i);
  });
  rest.sort((a, b) => field[b].ai!.skill - field[a].ai!.skill);
  rest.forEach((i, k) => {
    const ai = field[i].ai!;
    if (k < blockers) { ai.style = 'blocker'; ai.aggression = Math.min(Math.max(ai.aggression, 0.4), 0.55); } else { ai.style = 'racer'; ai.aggression = Math.min(ai.aggression, 0.35); }
  });
}
