import { describe, it, expect } from 'vitest';
import {
  CONTROL_SCHEMES, controlsOr, sensOr, touchLayout, boxRect, slideAxis, slideFullPx, steerZone, followHome, stickAxis, tiltSteerDeg, tiltAxis, autoDriftScheme, driftRequest, joyGeom,
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
  it('controlsOr defaults to buttons', () => {
    expect(controlsOr(undefined)).toBe('buttons'); expect(controlsOr('nope')).toBe('buttons');
    for (const s of CONTROL_SCHEMES) expect(controlsOr(s)).toBe(s);
  });
  it('sensOr clamps', () => { expect(sensOr(undefined)).toBe(1); expect(sensOr(9)).toBe(1.5); expect(sensOr(0)).toBe(0.5); expect(sensOr(1.2)).toBe(1.2); });
  it('old saves migrate to the Buttons default', () => {
    const s = sanitizeSave({ version: 2, settings: { lang: 'en', autoGas: true, quality: 'high', muted: false, tutorialDone: true } }, {});
    expect(s.settings.controls).toBe('buttons'); expect(s.settings.steerSens).toBe(1); expect(s.settings.controlsPicked).toBe(false);
    const k = sanitizeSave({ version: 2, settings: { controls: 'tilt', steerSens: 1.3, controlsPicked: true } }, {});
    expect(k.settings.controls).toBe('tilt'); expect(k.settings.steerSens).toBe(1.3); expect(k.settings.controlsPicked).toBe(true);
  });
  it('gas / drift rules', () => {
    for (const sc of CONTROL_SCHEMES) expect(autoDriftScheme(sc)).toBe(true);
  });
  it('the removed One finger scheme migrates to Buttons', () => {
    expect(CONTROL_SCHEMES as readonly string[]).not.toContain('finger');
    expect(controlsOr('finger')).toBe('buttons');
    expect(sanitizeSave({ version: 2, settings: { controls: 'finger', controlsPicked: true } }, {}).settings.controls).toBe('buttons');
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
export type { ControlScheme };
