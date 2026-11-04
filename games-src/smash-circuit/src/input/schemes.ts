// Touch control schemes: the list, the pure geometry of the on-screen buttons and the steering maths.
// Everything here is DOM free so it can be unit tested (tests/inputSchemes.test.ts).
import { CONFIG } from '../config';

export const CONTROL_SCHEMES = ['buttons', 'slide', 'finger', 'joystick', 'tilt', 'tap'] as const;
export type ControlScheme = (typeof CONTROL_SCHEMES)[number];
export const DEFAULT_SCHEME: ControlScheme = 'buttons';
export const controlsOr = (v: unknown): ControlScheme =>
  typeof v === 'string' && (CONTROL_SCHEMES as readonly string[]).includes(v) ? (v as ControlScheme) : DEFAULT_SCHEME;

/** Steering sensitivity multiplier limits (settings slider, all schemes). */
export const sensOr = (v: unknown): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 1;
  return Math.round(Math.min(CONFIG.controls.sensMax, Math.max(CONFIG.controls.sensMin, n)) * 100) / 100;
};

/** Schemes whose steering is analog and may ask for the auto drift on a hard steer. */
export const autoDriftScheme = (s: ControlScheme): boolean => s === 'finger' || s === 'slide' || s === 'joystick';
/** Schemes where the throttle is always on (finger scheme: only with the Auto gas setting). */
export const alwaysGas = (s: ControlScheme, autoGas: boolean): boolean => s !== 'finger' || autoGas;

const C = CONFIG.controls;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export type BtnName = 'steerL' | 'steerR' | 'drift' | 'brake' | 'item';
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
  const ds = portrait ? 0.225 * W : 0.28 * H;     // DRIFT
  const bs = ds * 0.84;                            // BRAKE
  const is = ds * 0.72;                            // item
  if (scheme === 'buttons') {
    L.steerL = { side: 'l', off: g, b: g, w: steerW, h: steerH };
    L.steerR = { side: 'l', off: g + steerW + gap, b: g, w: steerW, h: steerH };
  }
  if (scheme === 'tap') {
    const ts = ds * 0.66;
    const b = 0.3 * H;
    L.drift = { side: 'l', off: g, b, w: ts, h: ts };
    L.item = { side: 'r', off: g, b, w: ts, h: ts };
    return L;
  }
  if (scheme === 'finger') return L;   // legacy GAS / BRAKE / DRIFT geometry lives in the CSS (gasButtonGeometry)
  L.drift = { side: 'r', off: g, b: g, w: ds, h: ds };
  if (scheme !== 'joystick') L.brake = { side: 'r', off: g + ds + gap, b: g, w: bs, h: bs };
  L.item = { side: 'r', off: g + (ds - is) / 2, b: g + ds + gap * 1.5, w: is, h: is };
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

/** Floating joystick radius (px). */
export const joyRadius = (W: number, H: number): number => Math.min(W, H) * C.joyRadius;

/**
 * Wheel roll of the phone (rad, + = turned clockwise as the player sees it) from DeviceOrientation angles (deg) and the
 * screen orientation angle (0 / 90 / 180 / 270). Computed from the gravity direction projected on the screen plane, so
 * it is the same movement in portrait and landscape: turn the phone like a steering wheel.
 */
export function tiltRoll(beta: number, gamma: number, screenAngle = 0): number {
  const b = beta * Math.PI / 180, g = gamma * Math.PI / 180;
  // "up" in device coordinates (W3C Z-X'-Y'' rotation)
  const ux = -Math.cos(b) * Math.sin(g), uy = Math.sin(b);
  const a = ((Math.round(screenAngle / 90) % 4) + 4) % 4;
  const right: [number, number] = a === 0 ? [1, 0] : a === 1 ? [0, -1] : a === 2 ? [-1, 0] : [0, 1];
  const up: [number, number] = a === 0 ? [0, 1] : a === 1 ? [1, 0] : a === 2 ? [0, -1] : [-1, 0];
  const sx = ux * right[0] + uy * right[1], sy = ux * up[0] + uy * up[1];
  return -Math.atan2(sx, sy);
}

/** Steering from the tilt offset to the calibrated centre (rad). */
export function tiltAxis(delta: number): number {
  const d = Math.atan2(Math.sin(delta), Math.cos(delta)) * 180 / Math.PI;
  const mag = clamp((Math.abs(d) - C.tiltDeadDeg) / (C.tiltFullDeg - C.tiltDeadDeg), 0, 1);
  return mag === 0 ? 0 : Math.sign(d) * Math.pow(mag, C.tiltCurve);
}
