// Timed effects a car carries (boost pad, nitro, ram shield, oil spin). PURE data + derived multipliers; the SimCar applies them.
import { CONFIG } from '../config';

const I = CONFIG.items;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export class CarBuffs {
  /** seconds left */
  padT = 0; nitroT = 0; shieldT = 0; spinT = 0; gripT = 0;
  /** +1 / -1: which way an oil spin turns */
  spinDir = 1;
  /** per car per pad cooldown lives in the PowerUpSystem; this is the per-car oil cooldown */
  oilCd = 0;

  /** Engine power multiplier of the boost stack (pad x nitro, capped). */
  get powerMul(): number {
    let m = 1;
    if (this.padT > 0) m *= I.pad.powerMul;
    if (this.nitroT > 0) m *= I.nitro.powerMul;
    return Math.min(m, I.caps.power);
  }
  /** Top-speed ceiling multiplier of the boost stack (capped). */
  get ceilMul(): number {
    let m = 1;
    if (this.padT > 0) m *= I.pad.ceilMul;
    if (this.nitroT > 0) m *= I.nitro.ceilMul;
    return Math.min(m, I.caps.ceil);
  }
  /** Lateral grip multiplier (oil, nitro). */
  get gripMul(): number {
    let m = 1;
    if (this.gripT > 0) m *= I.oil.gripMul;
    if (this.nitroT > 0) m *= I.nitro.gripMul;
    return m;
  }
  /** Anything that changes the car stats right now. */
  get active(): boolean { return this.padT > 0 || this.nitroT > 0 || this.gripT > 0; }
  /** Boost level 0..1 for visuals (camera punch, flames). */
  get boostLevel(): number { return this.padT > 0 || this.nitroT > 0 ? 1 : 0; }
  /** Forced yaw rate (rad/s) while spinning, fading out over the spin. */
  spinRate(): number { return this.spinT > 0 ? this.spinDir * I.oil.spinRate * clamp(this.spinT / I.oil.spinTime, 0, 1) : 0; }

  tick(dt: number): void {
    if (this.padT > 0) this.padT = Math.max(0, this.padT - dt);
    if (this.nitroT > 0) this.nitroT = Math.max(0, this.nitroT - dt);
    if (this.shieldT > 0) this.shieldT = Math.max(0, this.shieldT - dt);
    if (this.spinT > 0) this.spinT = Math.max(0, this.spinT - dt);
    if (this.gripT > 0) this.gripT = Math.max(0, this.gripT - dt);
    if (this.oilCd > 0) this.oilCd = Math.max(0, this.oilCd - dt);
  }

  clear(): void { this.padT = this.nitroT = this.shieldT = this.spinT = this.gripT = this.oilCd = 0; }
}
