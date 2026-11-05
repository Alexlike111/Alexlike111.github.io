import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config';
import { StuckWatch, pickResetPose } from '../src/playerReset';
import { buildTrackGeometry } from '../src/track/spline';
import { trackById } from '../src/track/tracks';
import type { CarState } from '../src/types';

const G = CONFIG.game;

describe('StuckWatch', () => {
  it('hints once, then resets after the configured time', () => {
    const w = new StuckWatch();
    const seen: string[] = [];
    for (let t = 0; t < 6; t += 0.1) { const e = w.update(0.1, 0.2, true, 10); if (e !== 'none') seen.push(e); }
    expect(seen).toEqual(['hint', 'reset']);
  });

  it('resets after about stuckResetAfter seconds (not earlier)', () => {
    const w = new StuckWatch();
    let at = -1;
    for (let i = 1; i <= 100 && at < 0; i++) if (w.update(0.1, 0, true, 10) === 'reset') at = i * 0.1;
    expect(at).toBeGreaterThanOrEqual(G.stuckResetAfter - 0.11);
    expect(at).toBeLessThanOrEqual(G.stuckResetAfter + 0.11);
  });

  it('moving (forward or reversing) clears the timer', () => {
    const w = new StuckWatch();
    for (let i = 0; i < 30; i++) w.update(0.1, 0.5, true, 10);   // 3 s stuck
    expect(w.update(0.1, -3, true, 10)).toBe('none');            // reversing frees the car
    expect(w.seconds).toBe(0);
    for (let i = 0; i < 30; i++) expect(w.update(0.1, 0.5, true, 10)).not.toBe('reset');
  });

  it('never fires without input (idle on the grid) or before the race has run', () => {
    const w = new StuckWatch();
    for (let i = 0; i < 100; i++) expect(w.update(0.1, 0, false, 10)).toBe('none');
    for (let i = 0; i < 100; i++) expect(w.update(0.1, 0, true, 0.5)).toBe('none');
  });
});

describe('pickResetPose', () => {
  const track = buildTrackGeometry(trackById('t3'));
  const car = (x: number, y: number): CarState => ({ x, y } as CarState);

  it('lands on the road centre, ahead of the car, facing along the track', () => {
    const s0 = track.sampleAt(200);
    // wedged 3 m off the centre line
    const pose = pickResetPose(track, s0.x + s0.nx * 3, s0.y + s0.ny * 3, 200, []);
    const near = track.nearest(pose.x, pose.y, 200);
    expect(Math.abs(near.lateral)).toBeLessThan(0.5);
    expect(near.s - 200).toBeGreaterThan(0.5);
    const smp = track.sampleAt(near.s);
    expect(Math.cos(pose.angle - Math.atan2(smp.ty, smp.tx))).toBeGreaterThan(0.99);
  });

  it('skips spots occupied by other cars', () => {
    const s0 = track.sampleAt(300);
    const first = pickResetPose(track, s0.x, s0.y, 300, []);
    const pose = pickResetPose(track, s0.x, s0.y, 300, [car(first.x, first.y)]);
    expect(Math.hypot(pose.x - first.x, pose.y - first.y)).toBeGreaterThan(G.resetClearRadius - 1);
  });
});
