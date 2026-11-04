// The 10 procedural car models: every model builds with all damage slots, matches its hitbox, stays in the triangle budget,
// and a race with 8 different models draws one small fleet per model.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CONFIG } from '../src/config';
import { CAR_IDS, carStats } from '../src/meta/cars';
import { CarFleets, PART_LIST, buildCarGeometries, getCarGeometries, type CarPose } from '../src/render/car';
import { Materials } from '../src/render/materials';
import { createZoneHp } from '../src/sim/damage';
import { NO_DAMAGE } from '../src/sim/carModel';
import type { CarState } from '../src/types';

const tris = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.getAttribute('position').count) / 3;

describe('car models', () => {
  it('every roster car has its own model with all 8 detachable parts, lamps and 4 wheels', () => {
    const seen = new Set<number>();
    for (const id of CAR_IDS) {
      const g = buildCarGeometries(id);
      expect(g.modelId).toBe(id);
      for (const p of PART_LIST) expect(g.parts[p].getAttribute('position').count, `${id} ${p}`).toBeGreaterThan(0);
      expect(g.lights.getAttribute('position').count, id).toBeGreaterThan(0);
      expect(g.wheels.length).toBe(4);
      seen.add(g.body.getAttribute('position').count);
    }
    expect(seen.size).toBeGreaterThanOrEqual(9);   // really different bodies
  });

  it('the model footprint matches the car\'s hitbox (what you see is what you hit)', () => {
    for (const id of CAR_IDS) {
      const g = buildCarGeometries(id), s = carStats(id);
      // footprint of the body, panels and wheels (mirrors stick out and are left out, as on any car)
      const bb = new THREE.Box3();
      for (const geo of [g.body, ...PART_LIST.filter((p) => !p.startsWith('mirror')).map((p) => g.parts[p])]) { geo.computeBoundingBox(); bb.union(geo.boundingBox!); }
      for (const w of g.wheels) bb.union(new THREE.Box3(new THREE.Vector3(w.x - w.r, 0, w.z - w.w / 2), new THREE.Vector3(w.x + w.r, 2 * w.r, w.z + w.w / 2)));
      const L = bb.max.x - bb.min.x, W = bb.max.z - bb.min.z;
      expect(L / s.length!, id).toBeGreaterThan(0.9);
      expect(L / s.length!, id).toBeLessThan(1.12);
      expect(W / s.width!, id).toBeGreaterThan(0.9);
      expect(W / s.width!, id).toBeLessThan(1.12);
    }
  });

  it('each model stays inside the triangle budget (body + parts + lamps + 4 wheels <= 2,000)', () => {
    for (const id of CAR_IDS) {
      const g = buildCarGeometries(id);
      let n = tris(g.body) + tris(g.lights) + 4 * tris(g.wheel);
      for (const p of PART_LIST) n += tris(g.parts[p]);
      expect(n, id).toBeLessThanOrEqual(2000);
    }
  });

  it('a mixed grid builds one fleet per model, geometry is cached, and damaged / wheel-less cars still draw', () => {
    const models = ['scrapper', 'mammoth', 'needle', 'brick', 'mammoth', 'gravel', 'scorcher', 'needle'];
    const fleets = new CarFleets(new Materials(), models);
    expect(fleets.fleets.length).toBe(6);
    expect(getCarGeometries('mammoth')).toBe(getCarGeometries('mammoth'));
    const st = (i: number): CarState => ({
      id: i, isPlayer: i === 0, colorIndex: i, name: 'c', modelId: models[i], x: 0, y: 0, angle: 0, vx: 0, vy: 0, angularVel: 0, speed: 5, steer: 0,
      throttle: 1, brake: 0, handbrake: false, rpm: 0.5, drifting: false, slip: 0, hp: createZoneHp(100), zoneMaxHp: 100, health: 1, effects: { ...NO_DAMAGE },
      detachedParts: i === 1 ? ['bumperF', 'hood', 'wheelFL'] : [], wrecked: false, lap: 0, progress: 0, place: 1, finished: false, finishTime: 0,
      lastLapTime: 0, bestLapTime: 0, onCurb: false, offRoad: false,
    });
    const poses: CarPose[] = models.map((_, i) => ({ x: i * 8, y: 0, angle: 0, state: st(i) }));
    poses[1].state.hp.front = 10;
    fleets.update(poses, 1 / 60);
    const m = new THREE.Matrix4(), s = new THREE.Vector3();
    // the mammoth fleet (index 1) draws car 1 (first mammoth) with the front-left wheel gone and its big wheels scaled up
    const mam = fleets.fleets[1] as unknown as { wheels: THREE.InstancedMesh };
    mam.wheels.getMatrixAt(0, m); s.setFromMatrixScale(m);
    expect(s.x).toBe(0);
    mam.wheels.getMatrixAt(2, m); s.setFromMatrixScale(m);
    expect(s.x).toBeGreaterThan(1.4);                       // r 0.74 vs the reference 0.46
    expect(CONFIG.cars.order.length).toBe(10);
    fleets.dispose();
  });
});
