import { describe, it, expect } from 'vitest';
import {
  CONTROL_SCHEMES, controlsOr, sensOr, touchLayout, boxRect, slideAxis, followHome, stickAxis, tiltRoll, tiltAxis, autoDriftScheme, alwaysGas,
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
      const d = boxRect(L.drift!, W, H), br = boxRect(L.brake!, W, H);
      expect(br.x).toBeGreaterThan(b.x + b.w);
      expect(d.x + d.w).toBeLessThanOrEqual(W);
    });
  }
  it('schemes expose the expected buttons', () => {
    expect(Object.keys(touchLayout(390, 844, 'buttons')).sort()).toEqual(['brake', 'drift', 'item', 'steerL', 'steerR']);
    expect(Object.keys(touchLayout(390, 844, 'joystick')).sort()).toEqual(['drift', 'item']);
    expect(Object.keys(touchLayout(390, 844, 'tilt')).sort()).toEqual(['brake', 'drift', 'item']);
    expect(Object.keys(touchLayout(390, 844, 'tap')).sort()).toEqual(['drift', 'item']);
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
    expect(alwaysGas('buttons', false)).toBe(true); expect(alwaysGas('finger', false)).toBe(false); expect(alwaysGas('finger', true)).toBe(true);
    expect(autoDriftScheme('buttons')).toBe(false); expect(autoDriftScheme('slide')).toBe(true);
  });
});

describe('slide / stick maths', () => {
  it('is symmetric, has a small dead band and reaches full lock', () => {
    const W = 390;
    expect(slideAxis(200, 200, W)).toBe(0);
    expect(slideAxis(203, 200, W)).toBe(0);
    expect(slideAxis(200 + W * 0.15, 200, W)).toBe(1);
    expect(slideAxis(200 - W * 0.15, 200, W)).toBe(-1);
    expect(slideAxis(230, 200, W)).toBeCloseTo(-slideAxis(170, 200, W), 6);
    expect(slideAxis(230, 200, W)).toBeGreaterThan(0.3);   // comfortable: 30 px already steers noticeably
  });
  it('the home point follows a finger beyond full lock', () => {
    expect(followHome(400, 200, 60)).toBe(340); expect(followHome(230, 200, 60)).toBe(200); expect(followHome(100, 200, 60)).toBe(160);
    expect(stickAxis(-10, 60, 6)).toBeLessThan(0);
  });
});

describe('tilt', () => {
  const deg = (r: number): number => r * 180 / Math.PI;
  it('level phone = 0, wheel turned right = positive in portrait and in both landscapes', () => {
    expect(tiltRoll(60, 0, 0)).toBeCloseTo(0, 6);
    // gamma > 0 = right edge down = turned to the right
    expect(deg(tiltRoll(45, 30, 0))).toBeGreaterThan(10); expect(deg(tiltRoll(45, -30, 0))).toBeLessThan(-10);
    expect(tiltRoll(45, 30, 0)).toBeCloseTo(-tiltRoll(45, -30, 0), 6);
  });
  it('axis: dead band, full lock, symmetric', () => {
    expect(tiltAxis(0.01)).toBe(0);
    expect(tiltAxis(30 * Math.PI / 180)).toBe(1); expect(tiltAxis(-30 * Math.PI / 180)).toBe(-1);
    expect(tiltAxis(0.2)).toBeCloseTo(-tiltAxis(-0.2), 6);
  });
});
export type { ControlScheme };
