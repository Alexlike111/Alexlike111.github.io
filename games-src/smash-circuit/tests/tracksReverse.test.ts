// Reverse layouts (t1r, t2r, t3r): the same roads driven the other way round, with stable ids, a start on a straight,
// clean self-clearance and their own prop sets.
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { EN, RU } from '../src/i18n';
import { analyseTrack, buildTrackGeometry, requiredClearance } from '../src/track/spline';
import { ALL_TRACKS, REVERSE_TRACKS, TRACKS, baseTrackId, trackById } from '../src/track/tracks';

const D = CONFIG.destruction;

describe('reverse layouts', () => {
  it('stable ids: the forward tracks keep t1..t3, the reverse ones are appended as t1r..t3r', () => {
    expect(TRACKS.map((t) => t.id)).toEqual(['t1', 't2', 't3', 't4']);
    expect(REVERSE_TRACKS.map((t) => t.id)).toEqual(['t1r', 't2r', 't3r']);
    expect(ALL_TRACKS.map((t) => t.id)).toEqual(['t1', 't2', 't3', 't4', 't1r', 't2r', 't3r']);
    expect(trackById('t2r')).toBe(REVERSE_TRACKS[1]);
    expect(() => trackById('t9')).toThrow();
  });
  it('reverseOf / baseTrackId map a layout to its base track; theme, width, laps and walls are inherited', () => {
    for (const r of REVERSE_TRACKS) {
      const f = trackById(r.reverseOf!);
      expect(baseTrackId(r.id)).toBe(f.id);
      expect(baseTrackId(f.id)).toBe(f.id);
      expect(f.reverseOf).toBeUndefined();
      expect(r.id).toBe(f.id + 'r');
      expect(r.theme).toBe(f.theme);
      expect(r.width).toBe(f.width);
      expect(r.laps).toBe(f.laps);
      expect(r.wallStyle).toBe(f.wallStyle);
      expect(r.nameKey).toBe('track.' + r.id);
      expect(EN[r.nameKey]).toBeDefined();
      expect(RU[r.nameKey]).toBeDefined();
    }
  });
  it('props are regenerated (not copied): different set, within the prop budget', () => {
    for (const r of REVERSE_TRACKS) {
      const f = trackById(r.reverseOf!);
      expect(r.props.length).toBeGreaterThan(40);
      expect(r.props.length).toBeLessThanOrEqual(500);
      const same = r.props.filter((p) => f.props.some((q) => q.x === p.x && q.y === p.y && q.type === p.type)).length;
      expect(same).toBeLessThan(r.props.length * 0.3);
    }
  });

  for (const def of REVERSE_TRACKS) {
    describe(def.id, () => {
      const g = buildTrackGeometry(def);
      const f = buildTrackGeometry(trackById(def.reverseOf!));
      const req = requiredClearance(def.width, D.wallOffset, D.wall.thickness);
      const stats = analyseTrack(g, req);

      it('is the same road: same length, driven the opposite way', () => {
        expect(Math.abs(g.length - f.length)).toBeLessThan(2);
        for (let s = 0; s < g.length; s += 37) {
          const p = g.sampleAt(s);
          const near = f.nearest(p.x, p.y);
          expect(Math.abs(near.lateral)).toBeLessThan(0.5);          // on the forward centre line
          const q = f.sampleAt(near.s);
          expect(p.tx * q.tx + p.ty * q.ty).toBeLessThan(-0.95);     // heading the other way
        }
      });
      it('does not self-intersect and its bends are drivable', () => {
        expect(stats.conflicts).toEqual([]);
        expect(stats.minSeparation).toBeGreaterThanOrEqual(req);
        expect(stats.minRadius).toBeGreaterThan(def.width / 2 + D.wallOffset + D.wall.thickness / 2 + 1);
      });
      it('the start line sits on a straight: 40 m behind it (the grid) and 25 m after it are gentle', () => {
        for (let s = -40; s <= 25; s += 1) expect(Math.abs(g.sampleAt(s).curvature)).toBeLessThan(0.004);
      });
      it('props stay off the road and out of the start zone', () => {
        const half = def.width / 2;
        for (const p of def.props) {
          const n = g.nearest(p.x, p.y);
          expect(Math.abs(n.lateral)).toBeGreaterThan(Math.max(0, half - 1.2));
          if (n.s > g.length - 80 || n.s < 16) expect(Math.abs(n.lateral)).toBeGreaterThan(half + 1.8 - 0.4);
        }
      });
    });
  }
});
