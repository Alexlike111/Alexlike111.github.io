// Touch control schemes: the list, the pure geometry of the on-screen buttons and the steering maths.
// Everything here is DOM free so it can be unit tested (tests/inputSchemes.test.ts).
import { CONFIG } from '../config';

export const ALL_SCHEMES = ['point', 'buttons', 'slide', 'tilt', 'joystick', 'tap'] as const;
export type ControlScheme = (typeof ALL_SCHEMES)[number];
/** Schemes offered to the player, in picker order (Point is left out while CONFIG.controls.point.enabled is false). */
export const CONTROL_SCHEMES: readonly ControlScheme[] = ALL_SCHEMES.filter((s) => s !== 'point' || CONFIG.controls.point.enabled);
/** The three cards of the first-run picker; every other scheme sits under "More". */
export const MAIN_SCHEMES: readonly ControlScheme[] = CONTROL_SCHEMES.filter((s) => s === 'point' || s === 'buttons' || s === 'slide');
export const DEFAULT_SCHEME: ControlScheme = CONFIG.controls.point.enabled ? 'point' : 'buttons';
/** A stored value to a valid scheme: unknown values get the default, a saved 'point' with the scheme switched off falls back to Buttons. */
export const controlsOr = (v: unknown): ControlScheme => {
  if (typeof v !== 'string' || !(ALL_SCHEMES as readonly string[]).includes(v)) return DEFAULT_SCHEME;
  return (CONTROL_SCHEMES as readonly string[]).includes(v) ? (v as ControlScheme) : 'buttons';
};

/** Steering sensitivity multiplier limits (settings slider, all schemes). */
export const sensOr = (v: unknown): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 1;
  return Math.round(Math.min(CONFIG.controls.sensMax, Math.max(CONFIG.controls.sensMin, n)) * 100) / 100;
};

/** Every touch scheme asks for the auto drift on a hard steer (there is no DRIFT button; digital schemes need a hold, see `driftRequest`). */
export const autoDriftScheme = (_s: ControlScheme): boolean => true;

/**
 * Auto drift request of a touch steer. `steer` is the raw steer (-1..1, before the sensitivity multiplier); `held` is how long
 * (s) a DIGITAL steer (button / tap zone) has been held in one direction, `digital` tells the source. Analog sources
 * (slide, joystick, tilt) ask at once when the steer is >= driftSteer, digital ones after driftHoldS.
 */
export function driftRequest(steer: number, held: number, digital: boolean): boolean {
  if (Math.abs(steer) < CONFIG.controls.driftSteer) return false;
  return !digital || held >= CONFIG.controls.driftHoldS;
}

const C = CONFIG.controls;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export type BtnName = 'steerL' | 'steerR' | 'brake' | 'item';
/** A button box anchored to a screen edge: `off` px from the left (side 'l') or right (side 'r') edge, `b` px above the bottom edge. */
export interface Box { side: 'l' | 'r'; off: number; b: number; w: number; h: number }
export type Layout = Partial<Record<BtnName, Box>>;

/** Layout of the on-screen buttons of a scheme for a viewport (px, safe areas are added by the CSS). */
export function touchLayout(W: number, H: number, scheme: ControlScheme): Layout {
  const m = Math.min(W, H);
  const portrait = H >= W;
  const g = Math.max(8, 0.03 * m);
  const gap = 0.016 * m;
  const L: Layout = {};
  const steerW = portrait ? 0.225 * W : 0.3 * H;
  const steerH = portrait ? steerW * 1.1 : steerW * 0.95;
  const ds = portrait ? 0.225 * W : 0.28 * H;     // BRAKE (the biggest right-hand button, no DRIFT button: drift is automatic)
  const bs = ds * 0.9;
  const is = ds * 0.72;                            // item
  if (scheme === 'buttons') {
    L.steerL = { side: 'l', off: g, b: g, w: steerW, h: steerH };
    L.steerR = { side: 'l', off: g + steerW + gap, b: g, w: steerW, h: steerH };
  }
  if (scheme === 'tap') {
    L.item = { side: 'r', off: g, b: 0.3 * H, w: is, h: is };
    return L;
  }
  const hasBrake = scheme !== 'joystick';
  if (hasBrake) L.brake = { side: 'r', off: g, b: g, w: bs, h: bs };
  L.item = { side: 'r', off: g + ((hasBrake ? bs : is) - is) / 2, b: hasBrake ? g + bs + gap * 1.5 : g, w: is, h: is };
  return L;
}

export interface Rect { x: number; y: number; w: number; h: number }
export function boxRect(b: Box, W: number, H: number): Rect {
  return { x: b.side === 'l' ? b.off : W - b.off - b.w, y: H - b.b - b.h, w: b.w, h: b.h };
}

/** Normalised stick axis (-1..1): `dx` in px, full lock at `full` px, dead band `dead` px; curve < 1 = more authority near the centre. */
export function stickAxis(dx: number, full: number, dead: number, curve = C.slideCurve): number {
  const mag = clamp((Math.abs(dx) - dead) / Math.max(1, full - dead), 0, 1);
  return mag === 0 ? 0 : Math.sign(dx) * Math.pow(mag, curve);
}

/** Full-lock finger travel (px) of the Slide scheme: the sensitivity slider scales the THROW, never caps the output. */
export const slideFullPx = (sens = 1): number => C.slideFullPx / Math.max(0.1, sens);

/** Slide scheme: steering from the horizontal offset (CSS px) to the touch-down point; full lock at `slideFullPx(sens)`. */
export function slideAxis(x: number, homeX: number, sens = 1): number {
  return stickAxis(x - homeX, slideFullPx(sens), C.slideDeadPx);
}

/**
 * Buttons scheme hit zone: the whole lower-left block spanning both steer buttons (no dead gaps); -1 = left, 1 = right, 0 = none.
 * The block reaches from the left edge to the right edge of the right button (plus a gap) and from the bottom edge up to
 * half a button above the buttons.
 */
export function steerZone(x: number, y: number, W: number, H: number): -1 | 0 | 1 {
  const L = touchLayout(W, H, 'buttons');
  const a = L.steerL, b = L.steerR;
  if (!a || !b) return 0;
  const gap = b.off - a.off - a.w;
  const edge = b.off + b.w + gap;
  if (x < 0 || x > edge || y < H - (a.b + a.h * 1.5)) return 0;
  return x < a.off + a.w + gap / 2 ? -1 : 1;
}

/** Drag the home point along when the finger passes full lock, so coming back is instant. Returns the new home X. */
export function followHome(x: number, homeX: number, full: number): number {
  const dx = x - homeX;
  return Math.abs(dx) > full ? x - Math.sign(dx) * full : homeX;
}

/** Joystick radius (px). */
export const joyRadius = (W: number, H: number): number => Math.min(W, H) * C.joyRadius;

/** Fixed joystick: centred horizontally in the lower part of the screen. `grab` = radius of the area where a touch grabs it. */
export function joyGeom(W: number, H: number): { cx: number; cy: number; r: number; grab: number } {
  const r = joyRadius(W, H);
  return { cx: W / 2, cy: H - r - Math.max(0.03 * Math.min(W, H) * 1.5, 0.045 * H), r, grab: r * C.joyGrab };
}

/**
 * Steering angle (deg, + = right) of a DeviceOrientation reading relative to the calibrated centre, the standard racing-game
 * way: portrait steers from gamma (left / right tilt), landscape from beta (sign by screen.orientation.angle: 90 = +beta,
 * 270 = -beta, 180 flips portrait). The offset is wrapped so the +-90 (gamma) / +-180 (beta) jump never reaches the steering.
 */
export function tiltSteerDeg(beta: number, gamma: number, cBeta: number, cGamma: number, screenAngle = 0): number {
  const a = ((Math.round(screenAngle / 90) % 4) + 4) % 4;
  const landscape = a === 1 || a === 3;
  const wrap = (d: number, period: number): number => ((((d + period / 2) % period) + period) % period) - period / 2;
  const raw = landscape ? wrap(beta - cBeta, 360) : wrap(gamma - cGamma, 180);
  return a === 0 || a === 1 ? raw : -raw;
}

/** Steering (-1..1) from a tilt offset in degrees: dead band, full lock, response curve. */
export function tiltAxis(deg: number): number {
  const mag = clamp((Math.abs(deg) - C.tiltDeadDeg) / (C.tiltFullDeg - C.tiltDeadDeg), 0, 1);
  return mag === 0 ? 0 : Math.sign(deg) * Math.pow(mag, C.tiltCurve);
}

// ---------------------------------------------------------------------------------------------------------------------
// Point scheme: a floating stick under the thumb gives a SCREEN direction; the car turns toward it (absolute steering).
// ---------------------------------------------------------------------------------------------------------------------
const P = CONFIG.controls.point;
const wrapPi = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Base radius R (CSS px) of the Point stick. */
export const pointRadius = (W: number, H: number): number => clamp(P.radiusFrac * Math.min(W, H), P.radiusMin, P.radiusMax);

/** Where a Point touch may start: portrait = below the HUD strip (the buttons are DOM targets and win first), landscape = the left part. */
export function pointZone(x: number, y: number, W: number, H: number): boolean {
  if (x < 0 || y < 0 || x > W || y > H) return false;
  return H >= W ? y >= P.zoneTopFrac * H : x <= P.zoneLandscapeFrac * W;
}

/** Aim dead radius with hysteresis: enters above deadEnter * R, leaves below deadExit * R. */
export function pointAim(dx: number, dy: number, R: number, wasActive: boolean): boolean {
  const m = Math.hypot(dx, dy);
  return m > (wasActive ? P.deadExit : P.deadEnter) * R;
}

/** The base follows the finger so it never gets further than leash * R away. Returns the new base. */
export function pointLeash(fx: number, fy: number, bx: number, by: number, R: number): { x: number; y: number } {
  const dx = fx - bx, dy = fy - by, d = Math.hypot(dx, dy), lim = P.leash * R;
  if (d <= lim || d === 0) return { x: bx, y: by };
  return { x: fx - (dx / d) * lim, y: fy - (dy / d) * lim };
}

/**
 * Screen vector (dx right, dy DOWN, px) to a world heading (rad, physics coords: 0 = +x, counter-clockwise positive) under a
 * camera with view azimuth `az` and ground-tilt `tilt`: the inverse of the camera's ground -> screen transform (render/camera.ts).
 */
export function screenToWorldHeading(dx: number, dy: number, az: number, tilt: number): number {
  const X = dx, Y = -dy / Math.cos(tilt);
  const ca = Math.cos(az), sa = Math.sin(az);
  return Math.atan2(X * sa + Y * ca, X * ca - Y * sa);
}

/**
 * Steer (-1 left .. 1 right) for a heading error `err` (rad, target - heading, + = the nose must turn left) and the car's angular
 * velocity (rad/s, + = counter-clockwise). Full lock at steerFullRad / sens of error, damped by dGain * angVel.
 * Returns the turn sign too: above keepSignRad the previous direction is kept so pointing straight back never flip-flops.
 */
export function pointSteer(err: number, angVel: number, prevSign: number, sens = 1): { steer: number; sign: number } {
  let e = wrapPi(err);
  if (Math.abs(e) > P.keepSignRad && prevSign !== 0) e = prevSign * Math.abs(e);
  const sign = Math.abs(e) > 1e-4 ? Math.sign(e) : prevSign;
  return { steer: -clamp((e - P.dGain * angVel) / (P.steerFullRad / Math.max(0.1, sens)), -1, 1) || 0, sign };
}

/** Auto drift request of the Point scheme: the heading error stayed above driftErrRad for driftHoldS. */
export const pointDriftRequest = (err: number, heldS: number): boolean => Math.abs(wrapPi(err)) > P.driftErrRad && heldS >= P.driftHoldS;

export interface PointCar { angle: number; angularVel: number; viewAz: number; tilt: number }
export interface PointOut { steer: number; drift: boolean; /** smoothed screen aim (px, y down) or null when idle */ aim: { x: number; y: number } | null; err: number }

/** State machine of the Point scheme (aim smoothing, dead radius, release grace, turn-sign memory, drift timer). DOM free. */
export class PointController {
  private ax = 0; private ay = 0;
  private has = false;        // a smoothed aim exists (the finger has been down)
  private active = false;     // outside the dead radius
  private sign = 0;
  private held = 0;           // s the heading error has been above the drift threshold
  private grace = 0;          // s left of the lift-off grace
  private lastErr = 0;

  reset(): void { this.ax = this.ay = 0; this.has = false; this.active = false; this.sign = 0; this.held = 0; this.grace = 0; this.lastErr = 0; }

  /** One frame. `down` = a finger holds the stick; (dx, dy) = finger minus base (px, y down); `car` null = no player car yet. */
  update(down: boolean, dx: number, dy: number, R: number, dt: number, car: PointCar | null, sens = 1): PointOut {
    if (down) {
      if (!this.has) { this.ax = dx; this.ay = dy; this.has = true; }
      else {
        const k = 1 - Math.exp(-Math.max(0, dt) / P.smoothS);
        this.ax += (dx - this.ax) * k; this.ay += (dy - this.ay) * k;
      }
      this.active = pointAim(this.ax, this.ay, R, this.active);
      this.grace = this.active ? P.graceS : 0;
    } else if (this.has && this.grace > 0) {
      this.grace -= dt;                       // keep the last aim for a moment: micro-lifts do not kill a turn
      if (this.grace <= 0) this.reset();
    } else if (this.has) this.reset();
    if (!this.has || !this.active || !car) {
      this.held = 0;
      return { steer: 0, drift: false, aim: this.has && this.active ? { x: this.ax, y: this.ay } : null, err: 0 };
    }
    const target = screenToWorldHeading(this.ax, this.ay, car.viewAz, car.tilt);
    const err = wrapPi(target - car.angle);
    const r = pointSteer(err, car.angularVel, this.sign, sens);
    this.sign = r.sign;
    this.lastErr = err;
    if (Math.abs(err) > P.driftErrRad) this.held += dt; else this.held = 0;
    return { steer: r.steer, drift: pointDriftRequest(err, this.held), aim: { x: this.ax, y: this.ay }, err };
  }
}
