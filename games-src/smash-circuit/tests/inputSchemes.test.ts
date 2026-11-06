import { describe, it, expect } from 'vitest';
import {
  CONTROL_SCHEMES, controlsOr, sensOr, touchLayout, boxRect, slideAxis, slideFullPx, steerZone, followHome, stickAxis, tiltSteerDeg, tiltAxis, autoDriftScheme, driftRequest, joyGeom,
  DEFAULT_SCHEME, MAIN_SCHEMES, PointController, pointAim, pointLeash, pointRadius, pointSteer, pointDriftRequest, pointZone, screenToWorldHeading,
  type ControlScheme, type Rect,
} from '../src/input/schemes';
import { sanitizeSave } from '../src/meta/save';

const SIZES: [number, number][] = [[390, 844], [360, 640], [320, 568], [844, 390], [667, 375], [768, 1024]];
const hit = (a: Rect, b: Rect): boolean => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);

describe('control scheme layouts', () => {
  for (const [W, H] of SIZES) for (const sc of CONTROL_SCHEMES) {
    it(`${W}x${H} ${sc}: buttons are on screen, big enough and do not overlap`, () => {
      const L = touchLayout(W, H, sc);
      const rects = Object.entries(L).map(([k, b]) => [k, boxRect(b!, W, H)] as const);
      for (const [k, r] of rects) {
        expect(r.x).toBeGreaterThanOrEqual(0); expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(W); expect(r.y + r.h).toBeLessThanOrEqual(H);
        expect(Math.min(r.w, r.h), k).toBeGreaterThanOrEqual(44);
      }
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(hit(rects[i][1], rects[j][1]), `${rects[i][0]} vs ${rects[j][0]}`).toBe(false);
    });
  }
  for (const [W, H] of SIZES.filter(([w, h]) => h > w)) {
    it(`${W}x${H}: portrait steer buttons are >= 22% of the width, side by side, in the left thumb zone`, () => {
      const L = touchLayout(W, H, 'buttons');
      const a = boxRect(L.steerL!, W, H), b = boxRect(L.steerR!, W, H);
      expect(a.w / W).toBeGreaterThanOrEqual(0.22); expect(b.w / W).toBeGreaterThanOrEqual(0.22);
      expect(a.y).toBe(b.y);
      expect(a.x + a.w).toBeLessThan(b.x);
      expect(b.x + b.w).toBeLessThan(W * 0.55);   // both under the left thumb
      expect(a.y).toBeGreaterThan(H * 0.7);          // bottom thumb zone
      // right thumb cluster does not collide with the steer pair
      const br = boxRect(L.brake!, W, H);
      expect(br.x).toBeGreaterThan(b.x + b.w);
      expect(br.x + br.w).toBeLessThanOrEqual(W);
    });
  }
  it('schemes expose the expected buttons', () => {
    expect(Object.keys(touchLayout(390, 844, 'buttons')).sort()).toEqual(['brake', 'item', 'steerL', 'steerR']);
    expect(Object.keys(touchLayout(390, 844, 'joystick')).sort()).toEqual(['item']);
    expect(Object.keys(touchLayout(390, 844, 'tilt')).sort()).toEqual(['brake', 'item']);
    expect(Object.keys(touchLayout(390, 844, 'tap')).sort()).toEqual(['item']);
    for (const sc of CONTROL_SCHEMES) expect(Object.keys(touchLayout(390, 844, sc))).not.toContain('drift');   // drift is automatic
  });
});

describe('scheme settings', () => {
  it('controlsOr defaults to Point', () => {
    expect(DEFAULT_SCHEME).toBe('point');
    expect(controlsOr(undefined)).toBe('point'); expect(controlsOr('nope')).toBe('point');
    for (const s of CONTROL_SCHEMES) expect(controlsOr(s)).toBe(s);
  });
  it('sensOr clamps', () => { expect(sensOr(undefined)).toBe(1); expect(sensOr(9)).toBe(1.5); expect(sensOr(0)).toBe(0.5); expect(sensOr(1.2)).toBe(1.2); });
  it('old saves keep their scheme; a save without one gets the default', () => {
    expect(sanitizeSave({ version: 2, settings: { controls: 'buttons', controlsPicked: true } }, {}).settings.controls).toBe('buttons');
    expect(sanitizeSave({ version: 2, settings: { controls: 'joystick', controlsPicked: true } }, {}).settings.controls).toBe('joystick');
    const s = sanitizeSave({ version: 2, settings: { lang: 'en', autoGas: true, quality: 'high', muted: false, tutorialDone: true } }, {});
    expect(s.settings.controls).toBe('point'); expect(s.settings.steerSens).toBe(1); expect(s.settings.controlsPicked).toBe(false);
    const k = sanitizeSave({ version: 2, settings: { controls: 'tilt', steerSens: 1.3, controlsPicked: true } }, {});
    expect(k.settings.controls).toBe('tilt'); expect(k.settings.steerSens).toBe(1.3); expect(k.settings.controlsPicked).toBe(true);
  });
  it('gas / drift rules', () => {
    for (const sc of CONTROL_SCHEMES) expect(autoDriftScheme(sc)).toBe(true);
  });
  it('the removed One finger scheme migrates to the default', () => {
    expect(CONTROL_SCHEMES as readonly string[]).not.toContain('finger');
    expect(controlsOr('finger')).toBe(DEFAULT_SCHEME);
    expect(sanitizeSave({ version: 2, settings: { controls: 'finger', controlsPicked: true } }, {}).settings.controls).toBe(DEFAULT_SCHEME);
  });
  it('auto drift request: analog steers ask at once, digital ones after the hold time', () => {
    expect(driftRequest(0.96, 0, false)).toBe(true); expect(driftRequest(-0.96, 0, false)).toBe(true);
    expect(driftRequest(0.9, 5, false)).toBe(false);
    expect(driftRequest(1, 0.3, true)).toBe(false); expect(driftRequest(1, 0.6, true)).toBe(true);
    expect(driftRequest(0, 5, true)).toBe(false);
  });
});

describe('slide / stick maths', () => {
  it('is symmetric, has a small dead band and reaches full lock', () => {
    expect(slideAxis(200, 200)).toBe(0);
    expect(slideAxis(203, 200)).toBe(0);
    expect(slideAxis(276, 200)).toBe(1);
    expect(slideAxis(124, 200)).toBe(-1);
    expect(slideAxis(230, 200)).toBeCloseTo(-slideAxis(170, 200), 6);
    expect(slideAxis(238, 200)).toBeCloseTo((38 - 4) / (76 - 4), 6);   // linear
  });
  it('sensitivity scales the throw: full lock stays reachable at every sensitivity', () => {
    for (const s of [0.5, 1, 1.5]) expect(slideAxis(200 + slideFullPx(s) + 0.01, 200, s)).toBe(1);
    expect(slideFullPx(0.5)).toBeGreaterThan(slideFullPx(1)); expect(slideFullPx(1.5)).toBeLessThan(slideFullPx(1));
  });
  it('buttons: the quadrant block has no dead gaps', () => {
    const W = 390, H = 844, L = touchLayout(W, H, 'buttons');
    const a = boxRect(L.steerL!, W, H), b = boxRect(L.steerR!, W, H);
    expect(steerZone(a.x + a.w / 2, a.y + a.h / 2, W, H)).toBe(-1);
    expect(steerZone(b.x + b.w / 2, b.y + b.h / 2, W, H)).toBe(1);
    expect(steerZone((a.x + a.w + b.x) / 2 - 1, a.y + a.h / 2, W, H)).toBe(-1);   // the gap between them
    expect(steerZone((a.x + a.w + b.x) / 2 + 1, a.y + a.h / 2, W, H)).toBe(1);
    expect(steerZone(a.x + a.w / 2, a.y - a.h * 0.2, W, H)).not.toBe(0);           // just above the arrows
    expect(steerZone(a.x + a.w / 2, H * 0.3, W, H)).toBe(0);
  });
  it('the home point follows a finger beyond full lock', () => {
    expect(followHome(400, 200, 60)).toBe(340); expect(followHome(230, 200, 60)).toBe(200); expect(followHome(100, 200, 60)).toBe(160);
    expect(stickAxis(-10, 60, 6)).toBeLessThan(0);
  });
});

describe('fixed joystick', () => {
  for (const [W, H] of [[390, 844], [360, 640], [844, 390], [667, 375]] as [number, number][]) {
    it(`${W}x${H}: centred horizontally, on screen, clear of the right-hand buttons`, () => {
      const g = joyGeom(W, H);
      expect(g.cx).toBe(W / 2);
      expect(g.cy - g.r).toBeGreaterThan(H * 0.45);                 // lower part
      expect(g.cy + g.r).toBeLessThanOrEqual(H); expect(g.r).toBeGreaterThanOrEqual(50);
      expect(g.grab).toBeCloseTo(g.r * 1.5, 6);
      const ring: Rect = { x: g.cx - g.grab, y: g.cy - g.grab, w: g.grab * 2, h: g.grab * 2 };
      for (const b of Object.values(touchLayout(W, H, 'joystick'))) expect(hit(ring, boxRect(b!, W, H))).toBe(false);
    });
  }
});

describe('tilt', () => {
  it('portrait steers from gamma, relative to the calibrated centre (phone held flat-ish)', () => {
    expect(tiltSteerDeg(30, 15, 30, 0, 0)).toBe(15);
    expect(tiltSteerDeg(30, -15, 30, 0, 0)).toBe(-15);
    expect(tiltSteerDeg(55, 10, 30, 10, 0)).toBe(0);               // pitching the phone does not steer
    expect(tiltAxis(tiltSteerDeg(30, 15, 30, 0, 0))).toBeGreaterThan(0.4);
    expect(tiltAxis(tiltSteerDeg(30, -15, 30, 0, 0))).toBeLessThan(-0.4);
    expect(tiltSteerDeg(30, 15, 30, 0, 180)).toBe(-15);
  });
  it('landscape steers from beta, sign by the screen angle', () => {
    expect(tiltSteerDeg(45, 5, 30, 5, 90)).toBe(15); expect(tiltSteerDeg(15, 5, 30, 5, 90)).toBe(-15);
    expect(tiltSteerDeg(45, 5, 30, 5, 270)).toBe(-15); expect(tiltSteerDeg(15, 5, 30, 5, 270)).toBe(15);
    expect(tiltSteerDeg(30, 40, 30, -40, 90)).toBe(0);              // gamma is ignored in landscape
  });
  it('wrap-around near +-90 (gamma) and +-180 (beta) does not jump', () => {
    expect(tiltSteerDeg(0, -89, 0, 89, 0)).toBe(2);
    expect(tiltSteerDeg(0, 89, 0, -89, 0)).toBe(-2);
    expect(tiltSteerDeg(-179, 0, 179, 0, 90)).toBe(2);
  });
  it('axis: ~3 deg dead band, full lock at 25 deg, symmetric', () => {
    expect(tiltAxis(2.9)).toBe(0); expect(tiltAxis(-2.9)).toBe(0);
    expect(tiltAxis(3.5)).toBeGreaterThan(0);
    expect(tiltAxis(25)).toBe(1); expect(tiltAxis(-40)).toBe(-1);
    expect(tiltAxis(12)).toBeCloseTo(-tiltAxis(-12), 6);
  });
});

describe('Point scheme', () => {
  const TILT = 0.92;   // CONFIG.render.cameraTilt-like ground tilt
  const close = (a: number, b: number): void => { expect(Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))).toBeLessThan(1e-6); };

  it('is the first and default scheme, and the picker has Point, Buttons, Slide', () => {
    expect(CONTROL_SCHEMES[0]).toBe('point');
    expect([...MAIN_SCHEMES]).toEqual(['point', 'buttons', 'slide']);
    expect(Object.keys(touchLayout(390, 844, 'point')).sort()).toEqual(['brake', 'item']);
  });
  it('radius is clamp(0.15 * min(W,H), 56, 84)', () => {
    expect(pointRadius(390, 844)).toBeCloseTo(58.5, 5);
    expect(pointRadius(200, 300)).toBe(56); expect(pointRadius(1200, 900)).toBe(84);
  });
  it('screen "up" with a north-up camera is world +y (heading pi/2), right is 0, down is -pi/2, left is pi', () => {
    close(screenToWorldHeading(0, -50, 0, TILT), Math.PI / 2);
    close(screenToWorldHeading(50, 0, 0, TILT), 0);
    close(screenToWorldHeading(0, 50, 0, TILT), -Math.PI / 2);
    close(screenToWorldHeading(-50, 0, 0, TILT), Math.PI);
  });
  it('the camera azimuth rotates the target: with az = 90 deg screen "up" is world +x or -x as the camera does it', () => {
    // camera.ts: screen y (up) = -dx*sin(az) + dz*cos(az); az = pi/2: screen up = world -x, so screen up maps to heading pi
    close(screenToWorldHeading(0, -50, Math.PI / 2, TILT), Math.PI);
    close(screenToWorldHeading(0, -50, Math.PI, TILT), -Math.PI / 2);
    // round trip against the camera's ground -> screen transform for any azimuth
    for (const az of [0, 0.7, 2.1, -1.3, 3.0]) for (const h of [0, 1, 2.5, -2]) {
      const dx = Math.cos(h), dz = Math.sin(h);
      const sx = dx * Math.cos(az) + dz * Math.sin(az), sy = (-dx * Math.sin(az) + dz * Math.cos(az)) * Math.cos(TILT);
      close(screenToWorldHeading(sx, -sy, az, TILT), h);
    }
  });
  it('stick "up" with the car pointing screen-up gives zero error and zero steer', () => {
    const c = new PointController();
    const car = { angle: Math.PI / 2, angularVel: 0, viewAz: 0, tilt: TILT };
    let o = c.update(true, 0, 0, 58, 0.016, car);
    for (let i = 0; i < 20; i++) o = c.update(true, 0, -50, 58, 0.016, car);
    expect(o.aim).not.toBeNull(); expect(Math.abs(o.err)).toBeLessThan(0.01); expect(Math.abs(o.steer)).toBeLessThan(0.05); expect(o.drift).toBe(false);
  });
  it('steer sign: target left of the nose steers left (-), target right steers right (+)', () => {
    expect(pointSteer(0.3, 0, 0).steer).toBeLessThan(0);    // err + = turn left
    expect(pointSteer(-0.3, 0, 0).steer).toBeGreaterThan(0);
    expect(pointSteer(0, 0, 0).steer).toBe(0);
  });
  it('steer law: full lock at about 29 deg, linear below, angular velocity damps', () => {
    expect(pointSteer(-0.5, 0, 0).steer).toBeCloseTo(1, 6); expect(pointSteer(-1.2, 0, 0).steer).toBe(1);
    expect(pointSteer(-0.25, 0, 0).steer).toBeCloseTo(0.5, 6);
    expect(pointSteer(0.25, 0, 0).steer).toBeCloseTo(-0.5, 6);
    // turning left fast (angVel +) while the error is still left: less left steer
    expect(Math.abs(pointSteer(0.25, 2, 0).steer)).toBeLessThan(Math.abs(pointSteer(0.25, 0, 0).steer));
    // sensitivity moves the full-lock error but never caps the output
    expect(pointSteer(-0.25, 0, 0, 2).steer).toBeCloseTo(1, 6);
    expect(pointSteer(-0.25, 0, 0, 0.5).steer).toBeCloseTo(0.25, 6);
  });
  it('near 180 deg the previous turn direction is kept (no flip-flop)', () => {
    const a = pointSteer(Math.PI - 0.01, 0, 1), b = pointSteer(-(Math.PI - 0.01), 0, 1);
    expect(a.steer).toBe(-1); expect(b.steer).toBe(-1);    // both keep turning left
    expect(pointSteer(-(Math.PI - 0.01), 0, -1).steer).toBe(1);
    expect(pointSteer(-2.0, 0, 1).steer).toBe(1);          // under 150 deg the true sign wins
  });
  it('dead radius has hysteresis (enter 0.22 R, exit 0.15 R)', () => {
    const R = 60;
    expect(pointAim(0.2 * R, 0, R, false)).toBe(false);
    expect(pointAim(0.25 * R, 0, R, false)).toBe(true);
    expect(pointAim(0.2 * R, 0, R, true)).toBe(true);
    expect(pointAim(0.12 * R, 0, R, true)).toBe(false);
  });
  it('the base follows the thumb beyond 1.3 R', () => {
    const R = 60;
    expect(pointLeash(50, 0, 0, 0, R)).toEqual({ x: 0, y: 0 });
    const b = pointLeash(200, 0, 0, 0, R);
    expect(b.x).toBeCloseTo(200 - 1.3 * R, 6); expect(b.y).toBeCloseTo(0, 6);
    const c = pointLeash(0, -300, 10, 10, R);
    expect(Math.hypot(0 - c.x, -300 - c.y)).toBeCloseTo(1.3 * R, 6);
  });
  it('touch zone: portrait skips the top 18 %, landscape is the left 55 %', () => {
    expect(pointZone(100, 50, 390, 844)).toBe(false); expect(pointZone(100, 400, 390, 844)).toBe(true); expect(pointZone(380, 700, 390, 844)).toBe(true);
    expect(pointZone(300, 200, 844, 390)).toBe(true); expect(pointZone(600, 200, 844, 390)).toBe(false);
  });
  it('auto drift needs |error| > 0.9 rad for 0.1 s', () => {
    expect(pointDriftRequest(1.0, 0.05)).toBe(false); expect(pointDriftRequest(1.0, 0.1)).toBe(true);
    expect(pointDriftRequest(0.8, 5)).toBe(false); expect(pointDriftRequest(-1.0, 0.2)).toBe(true);
    const c = new PointController();
    const car = { angle: Math.PI / 2, angularVel: 0, viewAz: 0, tilt: TILT };   // facing screen-up, thumb points right: 90 deg error
    let o = c.update(true, 0, 0, 58, 0.016, car); let first = -1;
    for (let i = 0; i < 40; i++) { o = c.update(true, 60, 0, 58, 0.016, car); if (o.drift && first < 0) first = i; }
    expect(first).toBeGreaterThan(3); expect(o.drift).toBe(true); expect(o.steer).toBeGreaterThan(0.9);   // steering right, drifting
  });
  it('in the dead radius the car keeps its heading (steer 0); release keeps the aim 120 ms then steers 0', () => {
    const c = new PointController();
    const car = { angle: 0, angularVel: 0, viewAz: 0, tilt: TILT };
    expect(c.update(true, 3, 3, 58, 0.016, car).steer).toBe(0);
    for (let i = 0; i < 10; i++) c.update(true, 0, -60, 58, 0.016, car);
    let o = c.update(false, 0, 0, 58, 0.05, car);
    expect(o.aim).not.toBeNull(); expect(o.steer).toBeLessThan(0);           // grace: still turning left toward screen-up (car faces +x)
  });
  it('lifting the thumb stops steering after the grace time', () => {
    const c = new PointController();
    const car = { angle: 0, angularVel: 0, viewAz: 0, tilt: TILT };
    for (let i = 0; i < 10; i++) c.update(true, 0, -60, 58, 0.016, car);
    let o = c.update(false, 0, 0, 58, 0.05, car);
    expect(o.aim).not.toBeNull(); expect(o.steer).toBeLessThan(0);
    o = c.update(false, 0, 0, 58, 0.05, car); o = c.update(false, 0, 0, 58, 0.05, car);
    expect(o.aim).toBeNull(); expect(o.steer).toBe(0);
  });
  it('smoothing lags a sudden aim change by about 35 ms', () => {
    const c = new PointController();
    const car = { angle: 0, angularVel: 0, viewAz: 0, tilt: TILT };
    for (let i = 0; i < 5; i++) c.update(true, 60, 0, 58, 0.016, car);
    const o = c.update(true, -60, 0, 58, 0.035, car);
    expect(o.aim!.x).toBeLessThan(60); expect(o.aim!.x).toBeGreaterThan(-60);
    expect(o.aim!.x).toBeCloseTo(60 + (-120) * (1 - Math.exp(-1)), 5);
  });
});
export type { ControlScheme };
