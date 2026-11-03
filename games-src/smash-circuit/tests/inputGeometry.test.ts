import { describe, it, expect } from 'vitest';
import { brakeThresholdY, gasButtonGeometry } from '../src/input/input';

const SIZES: [number, number][] = [[390, 844], [844, 390], [600, 600], [320, 568], [360, 640], [1280, 720], [768, 1024]];

describe('one-finger brake gesture is reachable', () => {
  for (const [w, h] of SIZES) {
    it(`${w}x${h}: the brake threshold lies on screen with room for a thumb`, () => {
      const g = gasButtonGeometry(w, h);
      const y = brakeThresholdY(g.cy, g.size);
      const min = Math.min(w, h);
      expect(y).toBeGreaterThan(g.cy);
      // at least a thumb pad (3% of the short side) of free screen below the threshold
      expect(h - y).toBeGreaterThan(min * 0.03);
    });
  }
});

import { steerAxis } from '../src/input/input';
import { gasButtonGeometry as gasGeo } from '../src/input/input';

describe('steering reference point (documented decision: finger home, GAS button centre for the GAS finger)', () => {
  for (const [w, h] of SIZES) {
    it(`${w}x${h}: thumb resting on the GAS button steers straight, both full locks are reachable`, () => {
      const g = gasGeo(w, h);
      expect(steerAxis(g.cx, g.cx, w, true)).toBe(0);
      expect(steerAxis(g.cx - w * 0.3, g.cx, w, true)).toBe(-1);
      // right: the thumb cannot leave the screen, full lock must be reached before the edge
      expect(steerAxis(w - 6, g.cx, w, true)).toBe(1);
    });
    it(`${w}x${h}: a finger outside the buttons steers relative to the screen centre`, () => {
      expect(steerAxis(w / 2, w / 2, w, false)).toBe(0);
      expect(steerAxis(w / 2 + w * 0.3, w / 2, w, false)).toBe(1);
      expect(steerAxis(w / 2 - w * 0.3, w / 2, w, false)).toBe(-1);
    });
  }
  it('is monotonic and symmetric around home', () => {
    let prev = -2;
    for (let x = 100; x <= 300; x += 10) { const v = steerAxis(x, 200, 400, false); expect(v).toBeGreaterThanOrEqual(prev); prev = v; }
    expect(steerAxis(150, 200, 400, false)).toBeCloseTo(-steerAxis(250, 200, 400, false), 6);
  });
});
