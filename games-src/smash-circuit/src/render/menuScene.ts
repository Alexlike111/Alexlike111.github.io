// Idle scene for menus: the player's car on a turntable podium surrounded by trees, cones and tyres.
import * as THREE from 'three';
import { CONFIG } from '../config';
import type { CarState, ZoneId } from '../types';
import { ZONES } from '../types';
import { CarFleet, getCarGeometries } from './car';
import type { Materials } from './materials';
import type { ThemePalette } from './palette';
import { propGeometry, treeGeometry, bushGeometry, rockGeometry } from './structures';
import { GeoBuilder } from './geo';
import { makeGroundTexture } from './textures';
import { makeRng } from './util';

export class MenuScene {
  readonly group = new THREE.Group();
  fleet: CarFleet;
  private mats: Materials;
  private modelId: string = CONFIG.cars.starter;
  private blobOn = false;
  private state: CarState;
  private t = 0;
  private disposables: { dispose(): void }[] = [];
  private car: THREE.Group;

  constructor(mats: Materials, pal: ThemePalette) {
    this.mats = mats;
    // ground
    const tex = makeGroundTexture('meadow', pal);
    tex.repeat.set(10, 10);
    const gm = new THREE.Mesh(new THREE.PlaneGeometry(560, 560).rotateX(-Math.PI / 2), new THREE.MeshToonMaterial({ map: tex, gradientMap: mats.gradient }));
    gm.receiveShadow = true;
    this.group.add(gm);
    this.disposables.push(gm.geometry, tex, gm.material as THREE.Material);

    // podium: dark disc with white/red rim ring and a checker stripe pattern
    const pb = new GeoBuilder();
    pb.cyl(4.6, 4.9, 0.5, 20, { pos: [0, 0.25, 0], color: 0x3e4558, vgrad: [0, 0.5, 0.8, 1.05] });
    pb.cyl(4.1, 4.1, 0.04, 20, { pos: [0, 0.52, 0], color: 0x59627a });
    for (let k = 0; k < 20; k++) {
      const a = (k / 20) * Math.PI * 2;
      pb.box(0.9, 0.12, 0.5, { pos: [Math.cos(a) * 4.7, 0.5, -Math.sin(a) * 4.7], rot: [0, a, 0], color: k % 2 ? 0xffffff : 0xe8383a });
    }
    const pg = pb.build();
    const podium = new THREE.Mesh(pg, mats.toon);
    podium.receiveShadow = true; podium.castShadow = true;
    this.group.add(podium);
    this.disposables.push(pg);

    // scenery ring
    const rng = makeRng(77);
    const addMany = (geo: THREE.BufferGeometry, count: number, r0: number, r1: number, s0: number, s1: number, cast: boolean, tint = false): void => {
      const mesh = new THREE.InstancedMesh(geo, mats.toon, count);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
      for (let i = 0; i < count; i++) {
        const a = rng() * Math.PI * 2, r = r0 + rng() * (r1 - r0), s = s0 + rng() * (s1 - s0);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6.28);
        m.compose(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), q, new THREE.Vector3(s, s, s));
        mesh.setMatrixAt(i, m);
        if (tint) { const k = 0.85 + rng() * 0.3; mesh.setColorAt(i, c.setRGB(k, k, k)); }
      }
      mesh.castShadow = cast; mesh.frustumCulled = false;
      this.group.add(mesh);
      this.disposables.push(geo, mesh);
    };
    addMany(treeGeometry('meadow', pal, 0), 26, 11, 34, 0.9, 1.6, true, true);
    addMany(bushGeometry(pal, 'meadow'), 22, 7.5, 24, 0.8, 1.5, false, true);
    addMany(rockGeometry(pal, 4), 8, 7, 20, 0.5, 1.2, false);
    addMany(propGeometry('cone', 'meadow', pal), 10, 6.2, 8.5, 1, 1, false);
    addMany(propGeometry('tireStack', 'meadow', pal), 5, 6.4, 9, 1, 1, true);
    addMany(propGeometry('barrel', 'meadow', pal), 4, 6.4, 9.5, 1, 1, true);

    this.state = {
      id: 0, isPlayer: true, colorIndex: 0, name: 'You', x: 0, y: 0, angle: 0, vx: 0, vy: 0, angularVel: 0, speed: 0, steer: 0,
      throttle: 0, brake: 0, handbrake: false, rpm: 0, drifting: false, slip: 0,
      hp: Object.fromEntries(ZONES.map((z) => [z, CONFIG.damage.zoneMaxHp])) as Record<ZoneId, number>,
      zoneMaxHp: CONFIG.damage.zoneMaxHp, health: 1,
      effects: { powerMul: 1, topSpeedMul: 1, gripMul: 1, steerPull: 0, smoke: 0, sparks: 0 },
      detachedParts: [], wrecked: false, lap: 0, progress: 0, place: 1, finished: false, finishTime: 0, lastLapTime: 0, bestLapTime: 0,
      onCurb: false, offRoad: false,
    };
    this.fleet = new CarFleet(getCarGeometries(this.modelId), mats, 1);
    this.car = new THREE.Group();
    this.car.add(this.fleet.group);
    this.car.position.y = 0.55;
    this.group.add(this.car);
  }

  setColor(i: number): void { this.state.colorIndex = i; }

  /** Show another car model on the turntable (geometry is cached; only the small fleet is rebuilt). */
  setModel(id: string): void {
    const g = getCarGeometries(id);
    if (g.modelId === this.modelId) return;
    this.modelId = g.modelId;
    this.car.remove(this.fleet.group);
    this.fleet.dispose();
    this.fleet = new CarFleet(g, this.mats, 1);
    this.fleet.setBlobShadows(this.blobOn);
    this.car.add(this.fleet.group);
    this.fleet.update([{ x: 0, y: 0, angle: this.state.angle, state: this.state }], 0);
  }

  setBlobShadows(on: boolean): void { this.blobOn = on; this.fleet.setBlobShadows(on); }

  update(dt: number): void {
    this.t += dt;
    const yaw = this.t * 0.35;
    this.state.angle = yaw;
    this.state.steer = Math.sin(this.t * 0.9) * 0.5;
    this.state.speed = 0.3;           // slow wheel roll
    this.fleet.update([{ x: 0, y: 0, angle: yaw, state: this.state }], dt);
  }

  dispose(): void { this.fleet.dispose(); for (const d of this.disposables) d.dispose(); }
}
