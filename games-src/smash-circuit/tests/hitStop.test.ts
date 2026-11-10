// Hit-stop: a 40-60 ms sim freeze, only for a heavy car-vs-car hit on the player; scrape wear scales with sliding speed.
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { HitStop } from '../src/fx/hitStop';
import { Sim } from '../src/sim/sim';
import { baseStats } from '../src/sim/carModel';
import { TRACKS } from '../src/track/tracks';
import type { SimEvent } from '../src/types';

const H = CONFIG.damage.hitStop;
const impact = (carId: number, other: 'car' | 'wall', strength: number): SimEvent =>
  ({ type: 'impact', x: 0, y: 0, carId, other, strength }) as SimEvent;

describe('HitStop', () => {
  it('freezes the sim for 40-60 ms on a heavy car-vs-car hit on the player', () => {
    const hs = new HitStop();
    hs.onEvents([impact(0, 'car', 0.5)], 0);
    expect(hs.left).toBeGreaterThanOrEqual(H.time[0] - 1e-9);
    expect(hs.left).toBeLessThanOrEqual(H.time[1] + 1e-9);
    // frozen for the freeze time, then runs on: total sim time given back = real time - freeze
    let sim = 0, real = 0;
    for (let i = 0; i < 20; i++) { sim += hs.advance(1 / 60); real += 1 / 60; }
    expect(real - sim).toBeGreaterThanOrEqual(H.time[0] - 1e-9);
    expect(real - sim).toBeLessThanOrEqual(H.time[1] + 1e-9);
    expect(hs.advance(1 / 60)).toBeCloseTo(1 / 60, 9);
  });

  it('is stronger for a harder hit (monotonic) and never longer than 60 ms', () => {
    let prev = 0;
    for (const s of [0.45, 0.6, 0.8, 1, 1.5]) {
      const hs = new HitStop();
      hs.onEvents([impact(0, 'car', s)], 0);
      expect(hs.left).toBeGreaterThanOrEqual(prev);
      expect(hs.left).toBeLessThanOrEqual(0.06 + 1e-9);
      prev = hs.left;
    }
  });

  it('ignores walls, light taps, other cars\' hits, and reduced-motion players', () => {
    const cases: [SimEvent[], boolean][] = [
      [[impact(0, 'wall', 1)], true],
      [[impact(0, 'car', H.minStrength - 0.01)], true],
      [[impact(3, 'car', 1)], true],
      [[impact(0, 'car', 1)], false],
    ];
    for (const [ev, enabled] of cases) {
      const hs = new HitStop();
      hs.enabled = enabled;
      hs.onEvents(ev, 0);
      expect(hs.left).toBe(0);
      expect(hs.advance(1 / 60)).toBeCloseTo(1 / 60, 9);
    }
  });

  it('has a cooldown so a pile-up does not stutter', () => {
    const hs = new HitStop();
    hs.onEvents([impact(0, 'car', 0.9)], 0);
    while (hs.left > 0) hs.advance(1 / 120);
    hs.onEvents([impact(0, 'car', 0.9)], 0);
    expect(hs.left).toBe(0);                          // within the cooldown
    for (let i = 0; i < Math.ceil(H.cooldown * 120) + 2; i++) hs.advance(1 / 120);
    hs.onEvents([impact(0, 'car', 0.9)], 0);
    expect(hs.left).toBeGreaterThan(0);
  });
});

describe('scrape wear by proximity and tangential speed (audit X3)', () => {
  const D = CONFIG.destruction;
  function wearAt(speed: number, gapOffset: number): number {
    const sim = new Sim({ track: TRACKS[0], cars: [{ id: 0, isPlayer: true, name: 'p', colorIndex: 0, stats: baseStats() }], seed: 1 });
    const half = sim.track.def.width / 2;
    const s = 80;
    const t = sim.track.sampleAt(s);
    const side = 1;
    const wallId = sim.destruction.wallAt(s, side);
    const w = sim.destructibles[wallId];
    const dims = sim.simCars[0].dims;
    // a car whose left side is `gapOffset` m from the wall face, driving along the track
    const face = half + D.wallOffset - w.h / 2;
    const lat = face - gapOffset - dims.width / 2;
    const ang = Math.atan2(t.ty, t.tx);
    const x = t.x + t.nx * lat, y = t.y + t.ny * lat;
    const hp0 = w.hp + sim.destructibles[sim.destruction.wallAt(s - 4, side)].hp + sim.destructibles[sim.destruction.wallAt(s + 4, side)].hp;
    const g = sim.destruction.graze(x, y, ang, dims.length, dims.width, Math.cos(ang) * speed, Math.sin(ang) * speed, s, lat, 1 / 120);
    sim.destruction.flush([]);
    const hp1 = w.hp + sim.destructibles[sim.destruction.wallAt(s - 4, side)].hp + sim.destructibles[sim.destruction.wallAt(s + 4, side)].hp;
    return g ? hp0 - hp1 : 0;
  }

  it('wears the barrier in proportion to sliding speed, nothing below minSpeed, nothing when the car is not close', () => {
    const slow = wearAt(D.scrape.minSpeed * 0.5, 0.05);
    const a = wearAt(15, 0.05), b = wearAt(30, 0.05), c = wearAt(45, 0.05);
    expect(slow).toBe(0);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(wearAt(30, D.scrapeGap + 0.6)).toBe(0);
  });
});
