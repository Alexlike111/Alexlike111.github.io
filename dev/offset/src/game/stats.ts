import { T } from '../core/tune';
import type { Stats } from './types';
export function baseStats(): Stats {
  return {
    maxHp: T.player.hp, range: T.tp.range, charges: T.tp.charges, recharge: T.tp.recharge, focus: T.tp.focus,
    burstR: T.tp.burstR, burstDmg: T.tp.burstDmg, burstImpulse: T.tp.burstImpulse,
    strikeDmg: T.strike.dmg, strikeForce: T.strike.base, heavyR: T.tp.heavyR, heavyCost: T.tp.heavyCost, throwV: T.grab.throwV, carryMass: T.grab.maxMass,
    scarLife: T.tp.scarLife, inkMult: 1, magnet: 2.6, run: T.player.run,
    vector: 0, scarPortal: 0, scarCut: 0, echo: 0, inset: 0, killCharge: 0, slamK: 1, chainStrike: 0, glassCannon: 0, thorns: 0, revive: 0, bulletTime: 0, quake: 0, afterburn: 0, leech: 0, hpRegenRoom: 0,
  };
}
