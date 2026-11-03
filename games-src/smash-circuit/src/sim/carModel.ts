// PURE arcade car model (no planck). Planck integrates position; we set velocities each step.
import { CONFIG } from '../config';
import type { CarInput, CarStats, DamageEffects } from '../types';

export interface CarKinematics { x: number; y: number; angle: number; vx: number; vy: number; angularVel: number; steer: number }
export interface Surface { gripMul: number; drag: number; shake: number }

const C = CONFIG.car;

export const SURFACE_ROAD: Surface = { gripMul: 1, drag: 0, shake: 0 };
export const SURFACE_CURB: Surface = { gripMul: C.curbGripMul, drag: C.curbDrag, shake: C.curbShake };
export const SURFACE_GRASS: Surface = { gripMul: C.offRoadGripMul, drag: C.offRoadDrag, shake: 0 };
export const SURFACE_HOLE: Surface = { gripMul: C.holeGripMul, drag: C.holeDrag, shake: 0.25 };

export const NO_DAMAGE: DamageEffects = { powerMul: 1, topSpeedMul: 1, gripMul: 1, steerPull: 0, smoke: 0, sparks: 0 };

/** Stats of the reference car (the roster's 'scrapper', stock). */
export function baseStats(): CarStats {
  return {
    enginePower: C.baseEnginePower,
    topSpeed: C.baseTopSpeed,
    grip: C.baseGrip,
    armor: 1,
    mass: C.mass,
  };
}

/** Cornering limit (m/s^2) of a car at forward speed f: its own limit, plus downforce at speed (trait). */
export function latLimit(stats: CarStats, f: number): number {
  const base = stats.latAccel ?? C.maxLatAccel;
  const df = stats.traits?.downforce;
  if (!df) return base;
  const r = Math.abs(f) / Math.max(1, stats.topSpeed);
  return base * (1 + df * clamp((r - 0.5) / 0.5, 0, 1));
}

export function forwardSpeed(k: CarKinematics): number {
  return k.vx * Math.cos(k.angle) + k.vy * Math.sin(k.angle);
}

/** Lateral speed, + = to the left of the nose. */
export function lateralSpeed(k: CarKinematics): number {
  return -k.vx * Math.sin(k.angle) + k.vy * Math.cos(k.angle);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** What the drift tracker (drift.ts) tells the model: slide with the slip angle following the steering. */
export interface DriftControl {
  active: boolean;
  /** +1 = drifting counter-clockwise (left turn), -1 = clockwise (right turn) */
  dir: number;
}

const D = CONFIG.drift;

/** Engine push (m/s^2) at full throttle: strong at launch, falling off toward the ceiling, tapering over its last 10%. */
export function enginePush(f: number, vmax: number, stats: CarStats, fx: DamageEffects): number {
  const r = f > 0 ? clamp(f / Math.max(1, vmax), 0, 1) : 0;
  const taper = f >= 0 ? clamp((vmax - f) / (0.1 * vmax), 0, 1) : 1;
  const ln = stats.traits?.launch;
  const launch = ln ? 1 + (ln.mul - 1) * clamp(1 - Math.abs(f) / ln.until, 0, 1) : 1;   // trait: extra pull off the line / out of hairpins
  return stats.enginePower * fx.powerMul * (1 - C.powerFalloff * r) * taper * launch;
}

/** Best yaw rate (rad/s) at forward speed f: low-speed steering geometry, the lateral grip limit at speed, the absolute cap. */
export function turnRateCap(f: number, gripMul = 1, latAccel: number = C.maxLatAccel): number {
  const af = Math.abs(f);
  const geo = (af * Math.tan(C.maxSteerAngle)) / C.wheelBase;
  return Math.min(C.maxYawRate, geo, (latAccel * gripMul) / Math.max(af, 1));
}

/** Soft centre: small inputs are a bit gentler, full input stays full (precision with a thumb). */
export function shapeSteer(s: number): number {
  const a = Math.abs(s);
  return Math.sign(s) * (a * (1 - C.steerExpo) + a * a * C.steerExpo);
}

/** Inverse of the steering: the input that makes a car at forward speed f follow a path of curvature kappa (1/m, + = left). */
export function steerForCurvature(kappa: number, f: number, gripMul = 1, latAccel: number = C.maxLatAccel): number {
  const cap = turnRateCap(Math.max(Math.abs(f), 0.5), gripMul, latAccel);
  const want = clamp((kappa * Math.max(Math.abs(f), 0.5)) / Math.max(cap, 1e-6), -1, 1);   // shaped steer magnitude
  const a = Math.abs(want), e = C.steerExpo;
  // invert a*(1-e) + a^2*e = want
  const x = e > 1e-6 ? (-(1 - e) + Math.sqrt((1 - e) * (1 - e) + 4 * e * a)) / (2 * e) : a;
  return -Math.sign(want) * clamp(x, 0, 1) * (f < 0 ? -1 : 1);
}

/** Inverse of the drift steering: the input that makes a drifting car (dir +1 = left drift) follow curvature kappa. */
export function driftSteerForCurvature(kappa: number, v: number, dir: number, gripMul = 1, latAccel: number = C.maxLatAccel): number {
  const d = dir >= 0 ? 1 : -1;
  const grip = clamp(gripMul, 0.3, 1);
  const frac = (kappa * d * Math.max(v, 4) * Math.max(v, 4)) / (D.latAccel * (latAccel / C.maxLatAccel) * grip);   // wanted share of the drift path accel
  const into = frac >= D.pathMid ? (frac - D.pathMid) / (1 - D.pathMid) : (frac - D.pathMid) / (D.pathMid - D.pathMin);
  return -clamp(into, -1, 1) * d;
}

/**
 * Drift step: the velocity direction turns at a rate set by the steering (into the turn = tight, counter = wide) while the
 * nose follows a slip-angle target relative to the velocity. The angle can only converge on the target, so a drift never
 * spins out. Speed loss: a little engine power and an angle-dependent drag.
 */
function integrateDrift(
  k: CarKinematics, input: CarInput, stats: CarStats, fx: DamageEffects, surface: Surface, dt: number,
  drift: DriftControl, steer: number, steerEff: number, vmax: number, surfGrip: number,
): CarKinematics {
  const dir = drift.dir >= 0 ? 1 : -1;
  let v = Math.hypot(k.vx, k.vy);
  const th = v > 1e-4 ? Math.atan2(k.vy, k.vx) : k.angle;
  const beta = wrapAngle(k.angle - th);                 // + = nose left of the travel direction
  const into = clamp(-steerEff * dir, -1, 1);          // steer component into the drift (steer + = right = clockwise)
  const pick = (lo: number, mid: number, hi: number): number => (into >= 0 ? mid + (hi - mid) * into : mid + (mid - lo) * into);
  const betaT = dir * pick(D.angleMin, D.angleMid, D.angleMax);
  const grip = clamp(fx.gripMul * surface.gripMul, 0.3, 1);
  const dLat = D.latAccel * ((stats.latAccel ?? C.maxLatAccel) / C.maxLatAccel);   // a car that corners harder also drifts tighter
  const pathRate = dir * Math.min(C.maxYawRate, (dLat * grip * pick(D.pathMin, D.pathMid, 1)) / Math.max(v, 4));

  // speed along the travel direction
  let a = 0;
  const throttle = clamp(input.throttle, 0, 1), brake = clamp(input.brake, 0, 1);
  if (throttle > 0) a += enginePush(v, vmax, stats, fx) * D.powerMul * throttle * surfGrip;
  if (brake > 0) a -= (stats.brakeDecel ?? C.brakeDecel) * D.brakeMul * brake * surfGrip;
  if (v > vmax) a -= (v - vmax) * 2;
  let drag = C.rollingDrag + C.airDrag * v * v + (D.angleDrag / (stats.drift ?? 1)) * clamp(Math.abs(beta) / D.angleMax, 0, 1.5);
  if (surface.drag > 0) drag += surface.drag * (0.4 + 0.08 * v);
  v = Math.max(0, v + (a - drag) * dt);

  const th2 = th + pathRate * dt;
  const av = pathRate + (betaT - beta) * D.angleRate;
  return {
    x: k.x, y: k.y, angle: k.angle,
    vx: v * Math.cos(th2), vy: v * Math.sin(th2),
    angularVel: av,
    steer,
  };
}

export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * One fixed step of the arcade model. Returns new vx, vy, angularVel, steer (x, y, angle unchanged).
 * Works in the car frame: f = forward speed, l = lateral speed (left +).
 */
export function integrateCar(
  k: CarKinematics, input: CarInput, stats: CarStats, fx: DamageEffects, surface: Surface, dt: number,
  drift?: DriftControl | null,
): CarKinematics {
  const cos = Math.cos(k.angle), sin = Math.sin(k.angle);
  let f = k.vx * cos + k.vy * sin;
  let l = -k.vx * sin + k.vy * cos;

  // ---- steering input follows the target with a rate limit (faster on recentre)
  const target = clamp(input.steer, -1, 1);
  // recentring (or reversing) uses the faster return rate; turning in from centre uses the normal rate
  const returning = target === 0 || (k.steer !== 0 && Math.sign(target) !== Math.sign(k.steer)) || Math.abs(target) < Math.abs(k.steer);
  const rate = C.steerSpeed * (returning ? C.steerReturnMul : 1) * dt;
  const steer = k.steer + clamp(target - k.steer, -rate, rate);
  const steerEff = clamp(steer + fx.steerPull, -1, 1);

  // ---- longitudinal
  const vmax = stats.topSpeed * fx.topSpeedMul;
  const throttle = clamp(input.throttle, 0, 1);
  const brake = clamp(input.brake, 0, 1);
  const surfGrip = Math.min(1, surface.gripMul + 0.25);
  if (drift && drift.active) return integrateDrift(k, input, stats, fx, surface, dt, drift, steer, steerEff, vmax, surfGrip);
  let a = 0;
  if (throttle > 0) a += enginePush(f, vmax, stats, fx) * throttle * surfGrip;
  if (brake > 0) {
    if (f > 0.6) {
      a -= (stats.brakeDecel ?? C.brakeDecel) * brake * (0.6 + 0.4 * fx.gripMul) * surfGrip;
    } else {
      const rtaper = clamp((C.reverseMax + f) / (0.2 * C.reverseMax), 0, 1);
      a -= C.reversePower * fx.powerMul * brake * rtaper;
    }
  }
  if (f > vmax) a -= (f - vmax) * 2; // over the (damaged) ceiling: bleed off
  f += a * dt;

  // resistive decel (never reverses direction of motion)
  const af = Math.abs(f);
  let drag = C.rollingDrag + C.airDrag * af * af;
  if (surface.drag > 0) drag += surface.drag * (0.4 + 0.08 * af);
  if (input.handbrake) drag += C.handbrakeDecel;
  f = af <= drag * dt ? 0 : f - Math.sign(f) * drag * dt;

  // ---- lateral grip: rotate the velocity vector toward the heading axis (speed conserving) with tyre scrub
  let grip = stats.grip * fx.gripMul * surface.gripMul;
  // tighter at low speed: hairpins and manoeuvring stay precise (tail-out slides belong to the drift mechanic)
  grip *= 1 + C.lowSpeedGripBoost * clamp(1 - Math.abs(f) / C.lowSpeedGripUntil, 0, 1);
  if (input.handbrake) grip *= C.handbrakeGripMul;
  const v = Math.hypot(f, l);
  if (v > 1e-4) {
    const s = f < 0 ? -1 : 1;
    const alpha = Math.atan2(l * s, Math.abs(f)); // slip angle relative to travel axis
    const keep = Math.exp(-grip * dt);
    const alpha2 = alpha * keep;
    const v2 = v * (1 - C.cornerScrub * Math.abs(Math.sin(alpha)) * (1 - keep));
    f = s * v2 * Math.cos(alpha2);
    l = s * v2 * Math.sin(alpha2);
  }

  // ---- yaw: steering is a LINEAR fraction of the best turn rate the car has at this speed (bicycle geometry at low
  // speed, the lateral-acceleration limit at speed), so half stick is half the turn at every speed (no saturation),
  // blended in by angularVel damping (which is also the stability control: any yaw kick dies within ~0.15 s)
  const hb = input.handbrake ? C.handbrakeYawMul : 1;
  const wCap = turnRateCap(f, fx.gripMul * surface.gripMul, latLimit(stats, f)) * hb;
  let w = -shapeSteer(steerEff) * wCap * (f < 0 ? -1 : 1);
  // standstill stability: yaw authority fades below a few m/s
  w *= clamp(Math.abs(f) / C.lowSpeedSteerFade, 0, 1);
  const blend = 1 - Math.exp(-C.yawDamping * dt);
  let av = k.angularVel + (w - k.angularVel) * blend;

  // ---- surface shake (deterministic pseudo-noise from position)
  if (surface.shake > 0) {
    const sp = clamp(Math.abs(f) / 10, 0, 1);
    const n1 = Math.sin(k.x * 5.3 + k.y * 3.1) * Math.cos(k.y * 4.7 - k.x * 2.3);
    const n2 = Math.sin(k.x * 3.7 - k.y * 6.1 + 1.3);
    l += n1 * surface.shake * sp * 0.9;
    av += n2 * surface.shake * sp * 0.6 * blend;
  }

  return {
    x: k.x, y: k.y, angle: k.angle,
    vx: f * cos - l * sin,
    vy: f * sin + l * cos,
    angularVel: av,
    steer,
  };
}

/** Engine revs 0..1 from a simulated gearbox (audio only; smoothed toward target). */
export function engineRpm(speed: number, topSpeed: number, throttle: number, prev: number, dt: number): number {
  const gears = C.gears;
  const sp = Math.abs(speed);
  const per = (topSpeed * 0.95) / gears;
  const gear = Math.min(gears - 1, Math.floor(sp / per));
  const frac = clamp((sp - gear * per) / per, 0, 1);
  const lo = gear === 0 ? C.idleRpm : 0.42;
  let target = lo + (1 - lo) * frac * (0.82 + 0.18 * throttle);
  if (sp < 1) target = C.idleRpm + 0.55 * throttle;
  const r = (target > prev ? 14 : 7) * dt;
  return clamp(prev + clamp(target - prev, -r, r), 0, 1);
}
