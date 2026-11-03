// Builds the 7 AI opponents (and the player's CarSetup). PURE; deterministic for a given seed.
import { CONFIG } from '../config';
import type { AiPersonality, CarSetup, CarStats, SaveData } from '../types';
import { statsFor } from './economy';

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
  return { id: 0, isPlayer: true, name, colorIndex: save.carColor, stats: statsFor(save.upgrades) };
}

/**
 * 7 AI opponents (ids 1..7). Difficulty rises with the track index; the AI also mirrors a share of the player's
 * upgrade advantage so a fully upgraded car is still challenged. Colours never clash with `playerColor`.
 */
export function makeOpponents(trackIndex: number, playerStats: CarStats, seed: number, playerColor = 0): CarSetup[] {
  const O = CONFIG.meta.opponents;
  const ti = Math.max(0, Math.min(O.skill.length - 1, Math.floor(trackIndex) || 0));
  const r = rng((seed ^ 0x9e3779b9) + ti * 7919);
  const count = CONFIG.race.cars - 1;

  const names = shuffled(DRIVER_NAMES, r).slice(0, count);
  const colours = shuffled(CONFIG.render.carColors.map((_, i) => i).filter((i) => i !== playerColor), r);
  const [skillLo, skillHi] = O.skill[ti];
  const [scaleLo, scaleHi] = O.statScale[ti];

  const base = statsFor({ engine: 0, grip: 0, armor: 0 });
  const powerAdv = playerStats.enginePower / base.enginePower - 1;
  const gripAdv = playerStats.grip / base.grip - 1;
  const armorAdv = playerStats.armor / base.armor - 1;
  const follow = O.followPlayer;

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
    out.push({
      id: i + 1,
      isPlayer: false,
      name: names[i],
      colorIndex: colours[i % colours.length],
      stats: {
        enginePower: base.enginePower * scale * (1 + powerAdv * follow),
        topSpeed: base.topSpeed * lerp(0.96, 1.0, t) * (1 + (playerStats.topSpeed / base.topSpeed - 1) * follow),
        grip: base.grip * scale * (1 + gripAdv * follow),
        armor: base.armor * (1 + armorAdv * follow),
        mass: base.mass,
      },
      ai,
    });
  }
  return out;
}
