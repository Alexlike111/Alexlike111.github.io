// Extra race tracks beyond the original three (t4+). Same contract as tracks.ts: hand-designed Catmull-Rom control
// points, start line = first control point (the grid sits on the straight before it), props from the shared seeded
// generator, so the data is identical on every load. tracks.ts passes its generator in (no circular import).
import type { TrackDef, Vec2 } from '../types';

type Pt = [number, number];
const pts = (a: Pt[]): Vec2[] => a.map(([x, y]) => ({ x, y }));

/** Mirrors GenOptions in tracks.ts (corner dressing weights, straight clutter, decor counts). */
export interface ExtraGenOptions {
  seed: number;
  hay: number; tyres: number; cones: number; barrels: number; crates: number;
  clutter: number;
  trees: number; rocks: number;
  decorReach: number;
}
export type MakeTrack = (def: Omit<TrackDef, 'props'>, opt: ExtraGenOptions) => TrackDef;

/**
 * t4 Neon Harbour (night city docks, 12 m, ~1000 m, counter-clockwise):
 *  - 90 m start straight, then a fast long-radius left sweeper up the quay;
 *  - a 90-degree left onto the back street and a quick S chicane dressed with crates, barrels and cones;
 *  - a left onto the down street, a left into the warehouse spur, a tight right hairpin (R 15 m),
 *  - the long return run and a final left hairpin (R 17 m) onto the start straight.
 * Parallel legs are 30-34 m apart, so the walls between them are destruction-locked (no lap-breaking cut).
 */
function t4(make: MakeTrack): TrackDef {
  return make({
    id: 't4', nameKey: 'track.t4', theme: 'night', laps: 3, width: 12, wallStyle: 'concrete',
    points: pts([
      [60, 0], [105, 0], [150, 0],
      [192, 10], [220, 40], [226, 80],
      [216, 115], [190, 135],
      [150, 140],
      [126, 133], [105, 146], [82, 138],
      [45, 140],
      [8, 136], [-14, 116],
      [-18, 96],
      [-10, 74], [14, 64],
      [60, 64], [100, 64],
      [110.6, 59.6], [115, 49], [110.6, 38.4], [100, 34],
      [60, 34], [10, 34], [-25, 34],
      [-37, 29], [-42, 17], [-37, 5], [-25, 0],
      [20, 0],
    ]),
  }, { seed: 4404, hay: 0.1, tyres: 0.9, cones: 1.0, barrels: 1.0, crates: 1.0, clutter: 0.7, trees: 40, rocks: 20, decorReach: 26 });
}

/** Extra tracks in unlock order (after t3). */
export function extraTracks(make: MakeTrack): TrackDef[] {
  return [t4(make)];
}
