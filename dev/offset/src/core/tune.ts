// ALL balance / feel numbers live here.
export const T = {
  gravity: 26,
  maxFall: 46,
  // ---- player body
  player: {
    r: 0.3, halfH: 0.5, mass: 70,
    run: 8.2, accelGround: 85, accelAir: 38, friction: 70, airDrag: 0.4,
    jumpV: 12.2, coyote: 0.11, jumpBuffer: 0.12, jumpCut: 0.45,
    hp: 4, iframes: 1.0, jumpIframes: 0.12,
  },
  // ---- teleport
  tp: {
    range: 11.5, charges: 3, recharge: 1.05, rechargeDelay: 0.25,
    aimSlow: 0.16, aimSlowIn: 0.05, focus: 2.6, focusRegen: 0.75, focusRegenDelay: 0.6,
    tapMaxTime: 0.2, tapMaxMove: 14, dragGain: 0.058, // metres per css px (relative aim)
    heavyHold: 0.42, heavyR: 1.9, heavyCost: 2, heavyGrow: 0.5,
    burstR: 2.3, burstImpulse: 520, burstDmg: 260, implodeR: 2.6, implodeImpulse: 260,
    scarLife: 2.6, snapEnemyR: 1.5,
    misreg: 11, hitstop: 0.045,
    kineticMin: 9, // speed at which arrival becomes a "slam"
  },
  // ---- strike / grab
  strike: { r: 1.55, base: 15, up: 5.5, velK: 0.75, dmg: 34, velDmg: 3.2, cooldown: 0.16, hitstop: 0.07, chunkDmg: 600 },
  grab: { r: 1.5, maxMass: 220, throwV: 19, holdDist: 0.95 },
  combo: { window: 3.2, step: 0.25, max: 5 },
  // ---- impact damage
  impact: { enemyJMin: 260, enemyK: 0.085, restK: 1.6, playerJMin: 2600 },
  // ---- budgets
  budget: { dyn: 240, particles: 1400, shardLife: 9, minBodyArea: 0.03 },
};
export type MatId = 'concrete' | 'brick' | 'glass' | 'wood' | 'metal' | 'plaster' | 'crate' | 'paper' | 'barrel';
export interface Mat {
  id: MatId; density: number; hp: number; jMin: number; dmgK: number; friction: number; rest: number;
  shards: [number, number]; aniso: number; cell: number; pattern: 'voronoi' | 'bricks' | 'planks' | 'single';
  /** ink densities [a,b,c] */ ink: [number, number, number]; edge: [number, number, number]; unbreakable?: boolean; chain?: number;
}
export const MATS: Record<MatId, Mat> = {
  concrete: { id: 'concrete', density: 300, hp: 1500, jMin: 520, dmgK: 1, friction: 0.8, rest: 0.02, shards: [3, 5], aniso: 1, cell: 0.78, pattern: 'voronoi', ink: [0.8, 0, 0], edge: [1, 0, 0] },
  brick: { id: 'brick', density: 240, hp: 900, jMin: 360, dmgK: 1, friction: 0.85, rest: 0.02, shards: [2, 4], aniso: 1, cell: 0.5, pattern: 'bricks', ink: [0.2, 0.55, 0.3], edge: [0.9, 0.3, 0] },
  plaster: { id: 'plaster', density: 140, hp: 380, jMin: 150, dmgK: 1.2, friction: 0.8, rest: 0.02, shards: [3, 5], aniso: 1, cell: 0.62, pattern: 'voronoi', ink: [0.3, 0, 0.12], edge: [0.8, 0, 0] },
  glass: { id: 'glass', density: 90, hp: 40, jMin: 22, dmgK: 3, friction: 0.3, rest: 0.05, shards: [7, 11], aniso: 2.4, cell: 1.2, pattern: 'single', ink: [0.1, 0, 0.26], edge: [0.55, 0, 0.3], chain: 0.9 },
  wood: { id: 'wood', density: 110, hp: 420, jMin: 150, dmgK: 1, friction: 0.7, rest: 0.05, shards: [3, 5], aniso: 3.2, cell: 0.5, pattern: 'planks', ink: [0.16, 0.22, 0.62], edge: [0.85, 0.2, 0.2] },
  crate: { id: 'crate', density: 70, hp: 240, jMin: 120, dmgK: 1, friction: 0.7, rest: 0.05, shards: [4, 6], aniso: 2.6, cell: 0.5, pattern: 'single', ink: [0.1, 0.16, 0.72], edge: [0.9, 0.2, 0.2] },
  paper: { id: 'paper', density: 45, hp: 90, jMin: 55, dmgK: 1.5, friction: 0.8, rest: 0.02, shards: [2, 3], aniso: 1, cell: 0.6, pattern: 'single', ink: [0.06, 0, 0.1], edge: [0.75, 0, 0] },
  barrel: { id: 'barrel', density: 95, hp: 150, jMin: 130, dmgK: 1, friction: 0.6, rest: 0.1, shards: [4, 6], aniso: 2, cell: 0.7, pattern: 'single', ink: [0, 0.95, 0], edge: [1, 0.6, 0] },
  metal: { id: 'metal', density: 520, hp: 1e9, jMin: 1e9, dmgK: 0, friction: 0.5, rest: 0.05, shards: [0, 0], aniso: 1, cell: 2, pattern: 'single', ink: [0.92, 0, 0], edge: [1, 0, 0], unbreakable: true },
};
