// Touch control schemes: the list, the pure geometry of the on-screen buttons and the steering maths.
// Everything here is DOM free so it can be unit tested (tests/inputSchemes.test.ts).
import { CONFIG } from '../config';

export const CONTROL_SCHEMES = ['buttons', 'slide', 'joystick', 'tilt', 'tap'] as const;
export type ControlScheme = (typeof CONTROL_SCHEMES)[number];
export const DEFAULT_SCHEME: ControlScheme = 'buttons';
export const controlsOr = (v: unknown): ControlScheme =>
  typeof v === 'string' && (CONTROL_SCHEMES as readonly string[]).includes(v) ? (v as ControlScheme) : DEFAULT_SCHEME;

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

/** Slide scheme: steering from the horizontal offset to the touch-down point (fractions of the screen width). */
export function slideAxis(x: number, homeX: number, W: number): number {
  return stickAxis(x - homeX, C.slideFull * W, C.slideDead * W);
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
