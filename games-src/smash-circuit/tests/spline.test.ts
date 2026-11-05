import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import type { TrackDef, TrackGeometry } from '../src/types';
import { analyseTrack, buildTrackGeometry, requiredClearance } from '../src/track/spline';
import { TRACKS, trackById } from '../src/track/tracks';

function circleDef(R: number, n = 16, ccw = true, width = 10): TrackDef {
  const points = [];
  for (let i = 0; i < n; i++) {
    const a = ((ccw ? 1 : -1) * i * 2 * Math.PI) / n;
    points.push({ x: R * Math.cos(a), y: R * Math.sin(a) });
  }
  return { id: 'c', nameKey: 'c', theme: 'meadow', laps: 3, width, points, props: [], wallStyle: 'concrete' };
}

const D = CONFIG.destruction;

describe('buildTrackGeometry on a circle', () => {
  const R = 60;
  const g = buildTrackGeometry(circleDef(R));
  it('length is 2*pi*R and sampled every ~1 m', () => {
    expect(Math.abs(g.length - 2 * Math.PI * R) / (2 * Math.PI * R)).toBeLessThan(0.01);
    expect(g.samples.length).toBe(Math.round(g.length));
  });
  it('curvature is +1/R for a CCW loop and negative for CW', () => {
    for (const s of g.samples) expect(Math.abs(s.curvature - 1 / R)).toBeLessThan(0.15 / R);
    const cw = buildTrackGeometry(circleDef(R, 16, false));
    for (const s of cw.samples) expect(s.curvature).toBeLessThan(0);
  });
  it('normal points left of travel: lateral > 0 is the left side', () => {
    // CCW circle: left of travel is toward the centre
    const p = g.sampleAt(100);
    const inside = g.nearest(p.x * 0.9, p.y * 0.9);
    expect(inside.lateral).toBeGreaterThan(0);
    const outside = g.nearest(p.x * 1.1, p.y * 1.1);
    expect(outside.lateral).toBeLessThan(0);
  });
  it('sampleAt wraps and is continuous', () => {
    const a = g.sampleAt(5), b = g.sampleAt(5 + g.length), c = g.sampleAt(5 - g.length);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-6);
    expect(Math.hypot(a.x - c.x, a.y - c.y)).toBeLessThan(1e-6);
    const e = g.sampleAt(g.length - 0.01), f = g.sampleAt(0.01);
    expect(Math.hypot(e.x - f.x, e.y - f.y)).toBeLessThan(0.05);
  });
});

describe('tracks', () => {
  it('there are exactly three, with the contract ids and themes', () => {
    expect(TRACKS.slice(0, 3).map((t) => t.id)).toEqual(['t1', 't2', 't3']);
    expect(TRACKS.slice(0, 3).map((t) => t.theme)).toEqual(['meadow', 'desert', 'snow']);
    expect(trackById('t2')).toBe(TRACKS[1]);
    expect(() => trackById('nope')).toThrow();
  });
  it('t1 is the widest and t3 the narrowest', () => {
    expect(TRACKS[0].width).toBeGreaterThan(TRACKS[1].width);
    expect(TRACKS[1].width).toBeGreaterThan(TRACKS[2].width);
  });
  it('control polygons are genuinely different', () => {
    const sig = TRACKS.map((t) => t.points.length + ':' + t.width);
    expect(new Set(sig).size).toBe(3);
  });

  for (const def of TRACKS) {
    describe(def.id, () => {
      const g: TrackGeometry = buildTrackGeometry(def);
      const req = requiredClearance(def.width, D.wallOffset, D.wall.thickness);
      const stats = analyseTrack(g, req);

      it('length 600-1100 m, 3 laps', () => {
        expect(g.length).toBeGreaterThanOrEqual(600);
        expect(g.length).toBeLessThanOrEqual(1100);
        expect(def.laps).toBe(3);
      });
      it('is closed: samples evenly spaced ~1 m including last -> first', () => {
        const S = g.samples;
        for (let i = 0; i < S.length; i++) {
          const a = S[i], b = S[(i + 1) % S.length];
          const d = Math.hypot(b.x - a.x, b.y - a.y);
          expect(d).toBeGreaterThan(0.9);
          expect(d).toBeLessThan(1.1);
        }
        expect(g.startS).toBe(0);
        expect(S[0].s).toBe(0);
      });
      it('tangents are unit and follow the centre line; normal is left', () => {
        const S = g.samples;
        for (let i = 0; i < S.length; i += 3) {
          const a = S[i], b = S[(i + 1) % S.length];
          expect(Math.abs(Math.hypot(a.tx, a.ty) - 1)).toBeLessThan(1e-6);
          const dx = b.x - a.x, dy = b.y - a.y;
          expect(dx * a.tx + dy * a.ty).toBeGreaterThan(0.9);
          expect(a.nx).toBeCloseTo(-a.ty, 9);
          expect(a.ny).toBeCloseTo(a.tx, 9);
        }
      });
      it('does not self-intersect: every two far-apart parts keep road + run-off + both walls apart', () => {
        expect(stats.conflicts).toEqual([]);
        expect(stats.minSeparation).toBeGreaterThanOrEqual(req);
      });
      it('curves are drivable: walls never fold over on the inside of a bend', () => {
        const rMin = def.width / 2 + D.wallOffset + D.wall.thickness / 2 + 1;
        expect(stats.minRadius).toBeGreaterThan(rMin);
      });
      it('start straight: gentle curvature on the grid (behind the line) and just after it', () => {
        for (let s = g.length - 60; s < g.length + 25; s += 1) {
          expect(Math.abs(g.sampleAt(s).curvature)).toBeLessThan(0.006);
        }
      });
      it('nearest() round-trips (with and without hint, on and beside the road)', () => {
        for (let s = 0; s < g.length; s += 7.3) {
          for (const lat of [-def.width / 2, -3, 0, 2.5, def.width / 2]) {
            const c = g.sampleAt(s);
            const x = c.x + c.nx * lat, y = c.y + c.ny * lat;
            const n1 = g.nearest(x, y);
            const n2 = g.nearest(x, y, s + 5);
            for (const n of [n1, n2]) {
              let ds = Math.abs(n.s - c.s);
              ds = Math.min(ds, g.length - ds);
              expect(ds).toBeLessThan(1.2);
              expect(Math.abs(n.lateral - lat)).toBeLessThan(0.4);
            }
          }
        }
      });
      it('nearest() with a stale hint falls back to a global search', () => {
        const c = g.sampleAt(400);
        const n = g.nearest(c.x, c.y, 10);
        expect(Math.abs(n.s - 400)).toBeLessThan(1.2);
        expect(Math.abs(n.lateral)).toBeLessThan(0.3);
      });

      describe('props', () => {
        const counts: Record<string, number> = {};
        for (const p of def.props) counts[p.type] = (counts[p.type] ?? 0) + 1;
        it('plenty of props with the full variety', () => {
          expect(def.props.length).toBeGreaterThanOrEqual(220);
          for (const t of ['cone', 'barrel', 'crate', 'tireStack', 'hayBale', 'sign', 'tree', 'rock']) {
            expect(counts[t] ?? 0, `${def.id} has ${t}`).toBeGreaterThan(3);
          }
        });
        it('no two props overlap and all values are finite', () => {
          for (let i = 0; i < def.props.length; i++) {
            const a = def.props[i];
            expect(Number.isFinite(a.x + a.y + a.angle)).toBe(true);
            const ra = Math.max(D.props[a.type].w, D.props[a.type].h) / 2;
            for (let j = i + 1; j < def.props.length; j++) {
              const b = def.props[j];
              const rb = Math.max(D.props[b.type].w, D.props[b.type].h) / 2;
              expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(ra + rb);
            }
          }
        });
        it('props never sit inside walls, on another stretch of road, or on the start grid', () => {
          const half = def.width / 2;
          const wallIn = half + D.wallOffset - D.wall.thickness / 2;
          const wallOut = half + D.wallOffset + D.wall.thickness / 2;
          for (const p of def.props) {
            const n = g.nearest(p.x, p.y);
            const a = Math.abs(n.lateral);
            const r = Math.max(D.props[p.type].w, D.props[p.type].h) / 2;
            // either inside the run-off (cones may overlap the road edge) or beyond the wall
            const clearOfWall = a + 0.05 <= wallIn + 0.6 || a - r >= wallOut - 0.05;
            expect(clearOfWall, `${p.type} at lat ${a.toFixed(2)}`).toBe(true);
            if (n.s > g.length - 80 || n.s < 16) expect(a).toBeGreaterThan(half + 1.7);
          }
        });
        it('corners get run-off dressing, outside decor stays beyond the walls', () => {
          const half = def.width / 2;
          const near = def.props.filter((p) => Math.abs(g.nearest(p.x, p.y).lateral) < half + 2);
          expect(near.length).toBeGreaterThan(60);
          for (const p of def.props) if (p.type === 'tree' || p.type === 'rock') {
            expect(Math.abs(g.nearest(p.x, p.y).lateral)).toBeGreaterThan(half + D.wallOffset + 1);
          }
        });
      });
    });
  }
});
