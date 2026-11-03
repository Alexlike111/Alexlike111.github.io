// Drift mechanic, PURE (no planck): decides when a car drifts, charges the exit boost (3 tiers), scores points and combos.
// The slide itself is carModel's integrateDrift (driven by `ctl`). SimCar owns one tracker per car.
//
// Entry (any one):
//  - hold request: Space / handbrake or the DRIFT button (CarInput.drift = DRIFT_HOLD) while steering, above drift.minSpeed
//  - auto request: a hard touch steer (CarInput.drift = DRIFT_AUTO, set by the input layer) above drift.autoSpeed (~60 km/h)
//  - brake tap: a short brake tap released while steering hard at speed (player cars only; ordinary braking never drifts)
// Hold drifts end when the request is released; auto / brake-tap drifts end when the steering comes back toward centre.
// Counter-steer straightens the car out of any drift. A clean exit banks points x combo and fires the tier's boost;
// a hard hit (wall, prop, car) cancels the drift, its points and the combo.
import { CONFIG } from '../config';
import type { CarInput } from '../types';
import type { DriftControl } from './carModel';

const D = CONFIG.drift;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** CarInput.drift values */
export const DRIFT_NONE = 0;
export const DRIFT_AUTO = 1;
export const DRIFT_HOLD = 2;

export interface DriftPre {
  /** m/s to add along the nose this step (exit boost kick), 0 = none */
  kick: number;
}

export class DriftTracker {
  readonly ctl: DriftControl = { active: false, dir: 0 };
  /** s of the current drift */
  time = 0;
  /** s of boost charge (time spent at a real angle) */
  charge = 0;
  /** 0..3 boost tier reached by the current drift */
  tier = 0;
  /** |slip angle| (rad) of the current drift */
  angle = 0;
  /** raw points of the current drift (before the combo) */
  points = 0;
  /** combo multiplier of the current / next chained drift (1..comboMax) */
  combo = 1;
  /** banked points over the race */
  score = 0;
  /** last banked amount and the seconds since it was banked (HUD flash) */
  lastBank = 0;
  bankT = 99;
  /** seconds since the last cancel (HUD flash) */
  cancelT = 99;
  /** exit boost: seconds left and its tier */
  boostT = 0;
  boostTier = 0;
  /** drifts completed cleanly / cancelled (stats, tests) */
  clean = 0;
  cancelled = 0;
  /** per car (set by SimCar from CarStats): entry speeds x this (< 1 = drifts start slower), charge rate x, exit boost time x */
  entryMul = 1;
  chargeMul = 1;
  boostTimeMul = 1;

  private sinceExit = 99;
  private chain = false;           // the last drift ended cleanly (a new one inside comboWindow raises the combo)
  private hold = false;            // entered by a hold request (ends on release) vs auto / brake tap (ends on steer release)
  private noReq = 0;
  private counterT = 0;
  private brakeHeld = -1;          // s the brake has been held (-1: up)

  get active(): boolean { return this.ctl.active; }
  get dir(): number { return this.ctl.dir; }
  /** Live score of the current drift including the combo (HUD). */
  get livePoints(): number { return Math.round(this.points * this.combo); }

  /**
   * Before the model step. f = forward speed, v = speed, beta = slip angle (nose relative to the travel direction, rad).
   * `allowBrakeTap`: player cars only.
   */
  pre(input: CarInput, f: number, v: number, beta: number, allowBrakeTap: boolean, dt: number): DriftPre {
    if (this.boostT > 0) this.boostT = Math.max(0, this.boostT - dt);
    if (this.boostT === 0) this.boostTier = 0;
    this.sinceExit += dt; this.bankT += dt; this.cancelT += dt;
    if (this.sinceExit > D.comboWindow && !this.ctl.active) { this.chain = false; }

    const steer = clamp(input.steer, -1, 1);
    const req = input.drift ?? DRIFT_NONE;
    const holdReq = input.handbrake || req === DRIFT_HOLD;
    let kick = 0;
    // brake tap: a short press (<= brakeTapMax) released while steering hard at speed
    let tapped = false;
    if (input.brake > 0) this.brakeHeld = this.brakeHeld < 0 ? 0 : this.brakeHeld + dt;
    else if (this.brakeHeld >= 0) { tapped = this.brakeHeld <= D.brakeTapMax; this.brakeHeld = -1; }

    if (!this.ctl.active) {
      const as = Math.abs(steer);
      let enter = false, hold = false;
      const em = this.entryMul;
      if (f > 0 && holdReq && as >= 0.2 && v >= D.minSpeed * em) { enter = true; hold = true; }
      else if (f > 0 && req === DRIFT_AUTO && as >= D.autoSteer && v >= D.autoSpeed * em && this.sinceExit >= D.autoReentry) enter = true;
      else if (f > 0 && allowBrakeTap && tapped && as >= D.brakeTapSteer && f >= D.brakeTapSpeed * em) enter = true;
      if (enter) this.start(steer < 0 ? 1 : -1, hold);   // steer + = right = clockwise = dir -1
      return { kick };
    }

    // ---- drifting
    this.time += dt;
    this.angle = Math.abs(beta);
    const into = -steer * this.ctl.dir;              // + = steering into the drift
    const wanted = this.hold ? holdReq : (into >= D.holdSteer || holdReq);
    this.noReq = wanted ? 0 : this.noReq + dt;
    this.counterT = into < -0.35 ? this.counterT + dt : 0;
    if (v >= D.keepSpeed) {
      this.charge += dt * (this.angle >= D.minChargeAngle ? 1 : 0.3) * this.chargeMul;
      this.points += dt * D.pointsRate * (v / (100 / 3.6)) * clamp(this.angle / D.angleMax, 0, 1);
    }
    let t = 0;
    while (t < 3 && this.charge >= D.tierTime[t]) t++;
    this.tier = t;

    // a released Space / DRIFT button ends the drift at once (the boost fires on release); auto drifts are debounced
    const delay = this.hold ? D.holdExitDelay : D.exitDelay;
    if (this.noReq > delay || this.counterT > D.counterExit || v < D.keepSpeed || f <= 0) kick = this.finish();
    return { kick };
  }

  /** A hard hit: the drift ends with nothing banked, the combo is gone. */
  cancel(): void {
    if (this.ctl.active) {
      this.ctl.active = false;
      this.cancelled++;
      this.cancelT = 0;
    }
    this.points = 0; this.charge = 0; this.tier = 0; this.combo = 1; this.chain = false; this.sinceExit = 99;
  }

  reset(): void {
    this.cancel();
    this.cancelT = 99; this.boostT = 0; this.boostTier = 0;
  }

  private start(dir: number, hold: boolean): void {
    this.ctl.active = true;
    this.ctl.dir = dir;
    this.hold = hold;
    this.time = 0; this.charge = 0; this.tier = 0; this.points = 0; this.angle = 0;
    this.noReq = 0; this.counterT = 0;
    this.combo = this.chain && this.sinceExit <= D.comboWindow ? Math.min(D.comboMax, this.combo + 1) : 1;
  }

  /** Clean exit: bank the points, fire the boost of the tier reached. Returns the kick (m/s). */
  private finish(): number {
    this.ctl.active = false;
    this.clean++;
    this.sinceExit = 0;
    if (this.time >= D.minPointsTime && this.points > 0) {
      const bank = Math.round(this.points * this.combo);
      this.score += bank;
      this.lastBank = bank;
      this.bankT = 0;
      this.chain = true;
    } else this.chain = false;
    this.points = 0;
    const tier = this.tier;
    this.tier = 0; this.charge = 0;
    if (tier <= 0) return 0;
    this.boostTier = tier;
    this.boostT = D.boostTime[tier - 1] * this.boostTimeMul;
    return D.boostKick[tier - 1];
  }
}

/** Drift points -> coins at the race end. */
export function driftCoins(score: number): number {
  return Math.max(0, Math.min(D.maxCoins, Math.floor(score * D.coinsPerPoint)));
}
