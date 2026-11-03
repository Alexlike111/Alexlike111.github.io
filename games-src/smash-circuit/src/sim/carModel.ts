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

export function baseStats(): CarStats {
  return {
    enginePower: C.baseEnginePower,
    topSpeed: C.baseTopSpeed,
    grip: C.baseGrip,
    armor: 1,
    mass: C.mass,
  };
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

/**
 * One fixed step of the arcade model. Returns new vx, vy, angularVel, steer (x, y, angle unchanged).
 * Works in the car frame: f = forward speed, l = lateral speed (left +).
 */
export function integrateCar(
  k: CarKinematics, input: CarInput, stats: CarStats, fx: DamageEffects, surface: Surface, dt: number,
): CarKinematics {
  const cos = Math.cos(k.angle), sin = Math.sin(k.angle);
  let f = k.vx * cos + k.vy * sin;
  let l = -k.vx * sin + k.vy * cos;

  // ---- steering input follows the target with a rate limit (faster on recentre)
  const target = clamp(input.steer, -1, 1);
  const returning = target === 0 || Math.sign(target) !== Math.sign(k.steer) || Math.abs(target) < Math.abs(k.steer);
  const rate = C.steerSpeed * (returning ? C.steerReturnMul : 1) * dt;
  const steer = k.steer + clamp(target - k.steer, -rate, rate);
  const steerEff = clamp(steer + fx.steerPull, -1, 1);

  // ---- longitudinal
  const vmax = stats.topSpeed * fx.topSpeedMul;
  const throttle = clamp(input.throttle, 0, 1);
  const brake = clamp(input.brake, 0, 1);
  const surfGrip = Math.min(1, surface.gripMul + 0.25);
  let a = 0;
  if (throttle > 0) {
    const taper = f >= 0 ? clamp((vmax - f) / (0.1 * vmax), 0, 1) : 1;
    a += stats.enginePower * fx.powerMul * throttle * taper * surfGrip;
  }
  if (brake > 0) {
    if (f > 0.6) {
      a -= C.brakeDecel * brake * (0.6 + 0.4 * fx.gripMul) * surfGrip;
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

  // ---- yaw: bicycle model with lateral-acceleration cap, blended in by angularVel damping
  const sf = clamp(Math.abs(f) / stats.topSpeed, 0, 1);
  const delta = -steerEff * (C.maxSteerAngle + (C.minSteerAngleAtTop - C.maxSteerAngle) * Math.sqrt(sf));
  let w = (f * Math.tan(delta)) / C.wheelBase;
  if (input.handbrake) w *= C.handbrakeYawMul;
  const latLim = C.maxLatAccel * fx.gripMul * surface.gripMul * (input.handbrake ? C.handbrakeYawMul : 1);
  const wLim = Math.min(C.maxYawRate, latLim / Math.max(Math.abs(f), 1));
  w = clamp(w, -wLim, wLim);
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
