import type { RAPIER } from '../phys/world';
export interface Hittable {
  x: number; y: number; alive: boolean; rb: RAPIER.RigidBody; radius: number; kind: string;
  held: boolean; grabbable: boolean;
  /** dmg, velocity change to apply (m/s), cause tag */
  hit(dmg: number, vx: number, vy: number, cause: string): void;
  onGrab(): void; onRelease(vx: number, vy: number): void;
  teleported(dx: number, dy: number): void;
}
/** run-time stats of the hero (base tune + meta forms + run mutations) */
export interface Stats {
  maxHp: number; range: number; charges: number; recharge: number; focus: number;
  burstR: number; burstDmg: number; burstImpulse: number;
  strikeDmg: number; strikeForce: number; heavyR: number; heavyCost: number; throwV: number; carryMass: number;
  scarLife: number; inkMult: number; magnet: number; run: number;
  // mutation flags / levels
  vector: number; scarPortal: number; scarCut: number; echo: number; inset: number; killCharge: number; slamK: number;
  chainStrike: number; glassCannon: number; thorns: number; revive: number; bulletTime: number; quake: number; afterburn: number; leech: number; hpRegenRoom: number;
}
