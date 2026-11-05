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

import { stepPull } from '../src/input/input';

describe('GAS touch-down does not jump the steering (audit #4)', () => {
  for (const [w, h] of SIZES) {
    const g = gasGeo(w, h);
    for (const off of [-0.45, -0.25, 0, 0.25, 0.45]) {
      it(`${w}x${h}: landing ${off} button sizes off centre steers 0 and small slides stay in the dead band`, () => {
        const landX = g.cx + off * g.size;
        const home = Math.min(landX, w - 0.25 * g.size - 0.2 * g.size);
        expect(Math.abs(steerAxis(landX, home, w, true, g.size))).toBeLessThan(0.35);   // clamp near the edge, never a hard jump
        if (off <= 0) expect(steerAxis(landX, landX, w, true, g.size)).toBe(0);
        expect(steerAxis(home + 0.1 * g.size, home, w, true, g.size)).toBe(0);
        expect(steerAxis(home - 0.1 * g.size, home, w, true, g.size)).toBe(0);
        expect(steerAxis(home - w * 0.3, home, w, true, g.size)).toBe(-1);
      });
    }
  }
});

describe('auto-gas brake needs a deliberate pull (audit #15)', () => {
  const mk = () => ({ y: 500, homeY: 500, size: 100, pullT: 0 });
  it('a quick downward jitter does not brake', () => {
    const p = mk(); let b = false;
    p.y = 560; b ||= stepPull(p, 0.05); p.y = 500; b ||= stepPull(p, 0.05);
    expect(b).toBe(false);
  });
  it('a slow creep downward never brakes (home follows)', () => {
    const p = mk(); let b = false;
    for (let i = 0; i < 300; i++) { p.y += 0.2; b ||= stepPull(p, 1 / 60); }
    expect(b).toBe(false);
  });
  it('a pull past the line held 0.15 s brakes', () => {
    const p = mk(); p.y = 560; let b = false;
    for (let i = 0; i < 12; i++) b = stepPull(p, 1 / 60);
    expect(b).toBe(true);
  });
  it('moving up re-anchors home', () => {
    const p = mk(); p.y = 400; stepPull(p, 0.016); expect(p.homeY).toBe(400);
  });
});
