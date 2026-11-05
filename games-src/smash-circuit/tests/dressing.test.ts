// Track dressing + livery helpers: race-number roundels, the skid-worn racing line and the start-straight boards.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GeoBuilder } from '../src/render/geo';
import { numberPlate, plateRadius } from '../src/render/livery';
import { buildBoards, buildRacingLine, hayGeometry, iceGeometry, tentGeometry } from '../src/render/dressing';
import { Materials } from '../src/render/materials';
import { PALETTES } from '../src/render/palette';
import { buildTrackGeometry } from '../src/track/spline';
import { TRACKS } from '../src/track/tracks';

describe('livery', () => {
  it('a two-digit roundel has more geometry than a one-digit one and stays within its radius', () => {
    const a = new GeoBuilder(), b = new GeoBuilder();
    numberPlate(a, 1, 0, 1, 0);
    numberPlate(b, 88, 0, 1, 0);
    expect(b.vertexCount).toBeGreaterThan(a.vertexCount);
    const g = b.build();
    const P = g.getAttribute('position');
    const R = plateRadius(88);
    for (let i = 0; i < P.count; i++) expect(Math.hypot(P.getX(i), P.getZ(i))).toBeLessThanOrEqual(R + 1e-3);
  });
});

describe('dressing', () => {
  for (const def of TRACKS) {
    it(`${def.id}: racing line stays on the asphalt and is soft at the edges`, () => {
      const track = buildTrackGeometry(def);
      const m = buildRacingLine(track, PALETTES[def.theme]);
      const g = m.geometry;
      expect(g.index!.count).toBeGreaterThan(0);
      const P = g.getAttribute('position'), C = g.getAttribute('color');
      expect(C.itemSize).toBe(4);
      let maxLat = 0, aMax = 0;
      for (let i = 0; i < P.count; i++) {
        const n = track.nearest(P.getX(i), P.getZ(i));
        maxLat = Math.max(maxLat, Math.abs(n.lateral));
        aMax = Math.max(aMax, C.getW(i));
        expect(C.getW(i)).toBeLessThanOrEqual(0.6);
      }
      expect(maxLat).toBeLessThanOrEqual(def.width / 2 + 0.5);
      expect(aMax).toBeGreaterThan(0.1);
      g.dispose(); (m.material as THREE.Material).dispose();
    });
  }

  it('sponsor boards build with colours kept, and the themed scenery pieces are not empty', () => {
    const def = TRACKS[0];
    const track = buildTrackGeometry(def);
    const mats = new Materials();
    const boards = buildBoards(track, PALETTES[def.theme], mats);
    expect(boards).not.toBeNull();
    const col = boards!.geometry.getAttribute('color');
    const seen = new Set<string>();
    for (let i = 0; i < col.count; i += 7) seen.add([col.getX(i), col.getY(i), col.getZ(i)].map((v) => v.toFixed(2)).join());
    expect(seen.size).toBeGreaterThan(3);
    for (const g of [hayGeometry(), iceGeometry(), tentGeometry(PALETTES.desert)]) expect(g.getAttribute('position').count).toBeGreaterThan(30);
    mats.dispose();
  });
});
