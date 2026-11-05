// Pure / headless checks for module D (no WebGL context needed).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CONFIG } from '../src/config';
import { DebrisPool } from '../src/fx/debris';
import { ParticleSystem } from '../src/fx/particles';
import { SkidMarks } from '../src/fx/skidmarks';
import { PART_LIST, buildCarGeometries } from '../src/render/car';
import { GeoBuilder } from '../src/render/geo';
import { Materials } from '../src/render/materials';
import { PALETTES } from '../src/render/palette';
import { WALL_BASE_LEN, curbGeometry, propGeometry, treeGeometry, wallGeometry } from '../src/render/structures';
import { PointGrid, clamp, makeRng } from '../src/render/util';

describe('geometry builders', () => {
  it('GeoBuilder writes matching position/normal/color/aPaint attributes', () => {
    const g = new GeoBuilder().box(1, 1, 1, { color: 0xff0000, paint: 1 }).cyl(1, 1, 1, 6).build();
    const n = g.getAttribute('position').count;
    expect(n).toBeGreaterThan(36);
    for (const k of ['normal', 'color', 'aPaint']) expect(g.getAttribute(k).count).toBe(n);
  });

  it('car geometries have every detachable part and sane size', () => {
    const geos = buildCarGeometries();
    for (const p of PART_LIST) expect(geos.parts[p].getAttribute('position').count).toBeGreaterThan(0);
    geos.body.computeBoundingBox();
    const size = geos.body.boundingBox!.getSize(new THREE.Vector3());
    expect(size.x).toBeLessThan(CONFIG.car.length + 0.5);
    expect(size.z).toBeLessThan(CONFIG.car.width + 0.2);
  });

  it('wall pieces are modelled WALL_BASE_LEN long and as thick as the collider (within a tyre bulge)', () => {
    for (const style of ['concrete', 'tires', 'fence'] as const) {
      for (const kind of ['wall', 'guardrail'] as const) {
        const g = wallGeometry(style, kind, PALETTES.meadow);
        g.computeBoundingBox();
        const s = g.boundingBox!.getSize(new THREE.Vector3());
        expect(s.x).toBeGreaterThan(WALL_BASE_LEN * 0.9);
        expect(s.x).toBeLessThan(WALL_BASE_LEN + 0.35);
        expect(s.z).toBeGreaterThan(CONFIG.destruction[kind].thickness * 0.6);
        expect(s.z).toBeLessThan(CONFIG.destruction[kind].thickness + 0.5);
      }
    }
  });

  it('props and curbs build for every theme', () => {
    for (const theme of ['meadow', 'desert', 'snow'] as const) {
      for (const type of Object.keys(CONFIG.destruction.props) as (keyof typeof CONFIG.destruction.props)[]) {
        expect(propGeometry(type, theme, PALETTES[theme]).getAttribute('position').count).toBeGreaterThan(0);
      }
      expect(treeGeometry(theme, PALETTES[theme]).getAttribute('position').count).toBeGreaterThan(0);
    }
    expect(curbGeometry().getAttribute('position').count).toBeGreaterThan(0);
  });
});

describe('fx pools', () => {
  it('debris never exceeds CONFIG.destruction.maxDebris and expires', () => {
    const mats = new Materials();
    const pool = new DebrisPool(mats);
    for (let i = 0; i < 500; i++) pool.spawn({ x: i, y: 1, z: 0, vx: 1, vy: 5, vz: 0, sx: 1, sy: 1, sz: 1, color: 0xffffff });
    expect(pool.active).toBe(CONFIG.destruction.maxDebris);
    pool.update(0.016);
    expect(pool.active).toBeLessThanOrEqual(CONFIG.destruction.maxDebris);
    for (let i = 0; i < 200; i++) pool.update(0.016);   // 3.2 s > life
    expect(pool.active).toBe(0);
    expect(pool.mesh.count).toBe(0);
  });

  it('debris lands on the ground and shrinks away in the fade window', () => {
    const pool = new DebrisPool(new Materials());
    pool.spawn({ x: 0, y: 2, z: 0, vx: 0, vy: 0, vz: 0, sx: 1, sy: 0.4, sz: 1, color: 0xff0000, life: 1 });
    let minY = 99;
    for (let i = 0; i < 40; i++) { pool.update(0.02); const m = new THREE.Matrix4(); pool.mesh.getMatrixAt(0, m); minY = Math.min(minY, new THREE.Vector3().setFromMatrixPosition(m).y); }
    expect(minY).toBeGreaterThanOrEqual(0.19);
    const m = new THREE.Matrix4(); pool.mesh.getMatrixAt(0, m);
    const sc = new THREE.Vector3().setFromMatrixScale(m);
    expect(sc.x).toBeLessThan(0.9);   // fading near the end of its 1 s life
  });

  it('particle systems respect their share limit and recycle dead particles', () => {
    const ps = new ParticleSystem(100, false, 0.7);
    ps.setShare(0.5);
    for (let i = 0; i < 400; i++) ps.spawn(0, 0, 0, 0, 1, 0, { life: 0.5, size0: 1, size1: 2, color: 0xffffff });
    expect(ps.active).toBe(50);
    ps.update(0.6);
    expect(ps.active).toBe(0);
  });

  it('skid marks ring buffer wraps without growing', () => {
    const sk = new SkidMarks(64, 4);
    sk.setLimit(32);
    for (let i = 0; i < 400; i++) sk.mark(0, i * 0.5, 0, 1);
    sk.flush();
    expect(sk.mesh.geometry.getAttribute('position').count).toBe(64 * 4);
  });
});

describe('util', () => {
  it('PointGrid finds the nearest point within a cell neighbourhood', () => {
    const g = new PointGrid([0, 10, 20], [0, 0, 0], 20);
    expect(g.nearest(9, 1)).toBeCloseTo(Math.hypot(1, 1), 5);
    expect(g.nearest(500, 500)).toBe(Infinity);
  });
  it('rng is deterministic and clamp clamps', () => {
    const a = makeRng(5), b = makeRng(5);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(clamp(5, 0, 1)).toBe(1);
  });
});

import { DestructibleRenderer } from '../src/render/destructibles';
import { DestructionSystem } from '../src/sim/destruction';
import { PhysicsWorld } from '../src/sim/world';
import { buildTrackGeometry } from '../src/track/spline';
import { trackById } from '../src/track/tracks';

describe('DestructibleRenderer', () => {
  const track = buildTrackGeometry(trackById('t3'));
  const ds = new DestructionSystem(new PhysicsWorld(), track);
  const mats = new Materials();
  const def = trackById('t3');
  const dr = new DestructibleRenderer(ds.states, def, PALETTES.snow, mats);
  dr.sync(ds.states);

  const scaleOf = (id: number): number => {
    let found = -1;
    for (const m of dr.group.children as THREE.InstancedMesh[]) {
      // chunks hold ids in creation order; locate by position proximity instead of private state
      const mat = new THREE.Matrix4();
      for (let i = 0; i < m.count; i++) {
        m.getMatrixAt(i, mat);
        const p = new THREE.Vector3().setFromMatrixPosition(mat);
        const st = ds.states[id];
        if (Math.abs(p.x - st.x) < 1e-3 && Math.abs(p.z - st.y) < 1e-3 && Math.abs(p.y) < 0.2) { found = new THREE.Vector3().setFromMatrixScale(mat).x; }
      }
    }
    return found;
  };

  it('splits every kind into frustum-cullable chunks', () => {
    const meshes = dr.group.children as THREE.InstancedMesh[];
    expect(meshes.length).toBeGreaterThan(4);
    const total = meshes.reduce((n, m) => n + m.count, 0);
    expect(total).toBeGreaterThanOrEqual(ds.states.filter((s) => s.kind !== 'road').length);
    for (const m of meshes) expect(m.boundingSphere).not.toBeNull();
  });

  it('hides a broken wall instance and shows a hole for a torn road chunk', () => {
    const wall = ds.states.find((s) => s.kind === 'wall' || s.kind === 'guardrail')!;
    expect(scaleOf(wall.id)).toBeGreaterThan(0.5);
    wall.broken = true; wall.hp = 0; wall.crack = 1;
    const road = ds.states.find((s) => s.kind === 'road')!;
    road.broken = true; road.crack = 1;
    dr.sync(ds.states);
    expect(scaleOf(wall.id)).toBe(-1);   // hidden: collapsed to a zero matrix at the origin
    expect(dr.brokenShown).toBeGreaterThanOrEqual(2);
    // the hole instance for the road chunk exists at height ~0.075 with non-zero scale
    let hole = false;
    const mat = new THREE.Matrix4();
    for (const m of dr.group.children as THREE.InstancedMesh[]) {
      for (let i = 0; i < m.count; i++) {
        m.getMatrixAt(i, mat);
        const p = new THREE.Vector3().setFromMatrixPosition(mat);
        if (Math.abs(p.x - road.x) < 1e-3 && Math.abs(p.z - road.y) < 1e-3 && Math.abs(p.y - 0.075) < 1e-3 && new THREE.Vector3().setFromMatrixScale(mat).x > 0.1) hole = true;
      }
    }
    expect(hole).toBe(true);
  });
});
