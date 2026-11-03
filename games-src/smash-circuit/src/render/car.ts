// Procedural cartoon cars. All 8 cars share a handful of InstancedMeshes (one per separable part), so a full grid costs
// ~12 draw calls. Parts that can fly off (hood, bumpers, doors, spoiler, mirrors) are their own instanced meshes: a detached
// part is hidden here and thrown as debris by the FX layer.
import * as THREE from 'three';
import { CONFIG } from '../config';
import type { CarPart, CarState, ZoneId } from '../types';
import { GeoBuilder, concat } from './geo';
import type { Materials } from './materials';
import { clamp, lerp, makeRng } from './util';

const CR = CONFIG.render.car;
const CFX = CONFIG.render.fx;
const WR = CR.wheelRadius, WW = CR.wheelWidth, WX = CR.wheelX, WZ = CR.wheelZ;

/** Wheels are CarParts too (they come off at heavy damage), but they are drawn by the wheel mesh, not as body panels. */
export type WheelPart = 'wheelFL' | 'wheelFR' | 'wheelRL' | 'wheelRR';
export type BodyPart = Exclude<CarPart, WheelPart>;
export const PART_LIST: BodyPart[] = ['bumperF', 'bumperR', 'hood', 'doorL', 'doorR', 'spoiler', 'mirrorL', 'mirrorR'];
/** wheel order of the wheel instances (k = 0..3 per car): (+x,+z) FL, (+x,-z) FR, (-x,+z) RL, (-x,-z) RR */
export const WHEEL_LIST: WheelPart[] = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];

/** pivot (car-local) each part bends around when damaged */
const PIVOT: Record<BodyPart, [number, number, number]> = {
  bumperF: [1.75, 0.55, 0], bumperR: [-1.75, 0.55, 0],
  hood: [0.5, 0.9, 0], doorL: [0.7, 0.62, 0.9], doorR: [0.7, 0.62, -0.9],
  spoiler: [-1.85, 1.1, 0], mirrorL: [0.5, 0.98, 0.9], mirrorR: [0.5, 0.98, -0.9],
};

const DARK = 0x1c1f27, GLASS = 0x2f5273, CHROME = 0xdfe6f1, STRIPE = 0xffffff;

export interface CarGeometries {
  body: THREE.BufferGeometry;
  parts: Record<BodyPart, THREE.BufferGeometry>;
  wheel: THREE.BufferGeometry;
  lights: THREE.BufferGeometry;
  ghost: THREE.BufferGeometry;
}

export function buildCarGeometries(): CarGeometries {
  // ---------------- body shell (non-detachable)
  const b = new GeoBuilder();
  // underbody / sills
  b.box(3.7, 0.16, 1.5, { pos: [0, 0.36, 0], color: DARK });
  // main tub (subdivided: the damage shader crumples it per vertex)
  b.box(3.5, 0.5, 1.74, { pos: [0, 0.6, 0], color: 0xffffff, paint: 1, vgrad: [0.3, 0.9, 0.78, 1], seg: [10, 2, 5], noBottom: true });
  // rounded-looking shoulders (slightly narrower upper slab)
  b.box(3.3, 0.14, 1.56, { pos: [0, 0.91, 0], color: 0xffffff, paint: 1, seg: [10, 1, 5], noBottom: true });
  // what a lost panel uncovers: engine bay under the hood, crash bars behind the bumpers, brake hubs inside the wheels
  b.box(1.25, 0.1, 1.3, { pos: [1.1, 0.95, 0], color: 0x24262c });
  b.box(0.55, 0.1, 0.6, { pos: [1.0, 0.975, 0.1], color: 0x8d939e });       // engine block
  b.box(0.3, 0.07, 0.3, { pos: [1.45, 0.98, -0.42], color: 0xc9a227 });    // battery
  b.box(0.12, 0.07, 1.0, { pos: [1.62, 0.98, 0], color: 0x3a3d45 });       // radiator
  for (const sx of [-1, 1]) b.box(0.16, 0.2, 1.5, { pos: [sx * 1.8, 0.56, 0], color: 0x2b2d33 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.cyl(0.24, 0.24, 0.1, 8, { pos: [sx * WX, WR, sz * (WZ + 0.11)], rot: [Math.PI / 2, 0, 0], color: 0x7a5a48 });
  }
  // front/rear fenders over the inner half of each wheel
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.box(1.1, 0.16, 0.34, { pos: [sx * WX, 0.97, sz * (WZ - 0.1)], color: 0xffffff, paint: 1 });
  }
  // cabin: dark glass frustum + paint roof
  b.frustum(1.95, 1.56, 1.2, 1.18, 0.44, { pos: [-0.35, 1.2, 0], color: GLASS, vgrad: [1.0, 1.45, 0.8, 1.15] });
  b.box(1.1, 0.07, 1.14, { pos: [-0.35, 1.44, 0], color: 0xffffff, paint: 1 });
  // roof + trunk racing stripes (white)
  for (const sz of [-1, 1]) {
    b.box(1.1, 0.012, 0.16, { pos: [-0.35, 1.485, sz * 0.2], color: STRIPE });
    b.box(1.05, 0.012, 0.16, { pos: [-1.27, 1.0, sz * 0.2], color: STRIPE });
  }
  // trunk deck
  b.box(1.05, 0.1, 1.5, { pos: [-1.27, 0.95, 0], color: 0xffffff, paint: 1, seg: [3, 1, 4], noBottom: true });
  // little side-skirt accent
  for (const sz of [-1, 1]) b.box(2.4, 0.06, 0.06, { pos: [0, 0.5, sz * 0.9], color: 0xffffff });
  const body = b.build();

  // ---------------- detachable parts
  const hood = new GeoBuilder()
    .box(1.35, 0.13, 1.56, { pos: [1.12, 0.97, 0], color: 0xffffff, paint: 1 })
    .box(1.2, 0.012, 0.16, { pos: [1.1, 1.04, 0.2], color: STRIPE })
    .box(1.2, 0.012, 0.16, { pos: [1.1, 1.04, -0.2], color: STRIPE })
    .box(0.35, 0.05, 0.5, { pos: [0.9, 1.06, 0], color: DARK }) // vent scoop
    .build();
  const bumperF = new GeoBuilder()
    .box(0.4, 0.38, 1.74, { pos: [1.95, 0.6, 0], color: 0xffffff, paint: 1, vgrad: [0.4, 0.8, 0.8, 1] })
    .box(0.55, 0.07, 1.64, { pos: [1.96, 0.4, 0], color: DARK })
    .box(0.06, 0.16, 0.9, { pos: [2.16, 0.62, 0], color: DARK })       // grille
    .build();
  const bumperR = new GeoBuilder()
    .box(0.4, 0.38, 1.74, { pos: [-1.95, 0.6, 0], color: 0xffffff, paint: 1, vgrad: [0.4, 0.8, 0.8, 1] })
    .box(0.5, 0.07, 1.64, { pos: [-1.96, 0.4, 0], color: DARK })
    .cyl(0.09, 0.09, 0.4, 7, { pos: [-2.2, 0.5, 0.42], rot: [0, 0, Math.PI / 2], color: CHROME })
    .cyl(0.09, 0.09, 0.4, 7, { pos: [-2.2, 0.5, -0.42], rot: [0, 0, Math.PI / 2], color: CHROME })
    .build();
  const mkDoor = (sz: number): THREE.BufferGeometry => new GeoBuilder()
    .box(1.5, 0.36, 0.2, { pos: [-0.05, 0.64, sz * 0.94], color: 0xffffff, paint: 1, vgrad: [0.4, 0.85, 0.8, 1] })
    .box(0.5, 0.05, 0.02, { pos: [0.1, 0.72, sz * 1.05], color: DARK })
    .box(0.26, 0.26, 0.012, { pos: [-0.45, 0.66, sz * 1.045], color: 0xffffff })   // number roundel
    .build();
  const spoiler = new GeoBuilder()
    .box(0.62, 0.07, 1.9, { pos: [-1.92, 1.3, 0], rot: [0, 0, 0.1], color: 0xffffff, paint: 1 })
    .box(0.7, 0.34, 0.06, { pos: [-1.92, 1.2, 0.95], color: 0xffffff, paint: 1 })
    .box(0.7, 0.34, 0.06, { pos: [-1.92, 1.2, -0.95], color: 0xffffff, paint: 1 })
    .box(0.12, 0.34, 0.1, { pos: [-1.8, 1.1, 0.5], color: DARK })
    .box(0.12, 0.34, 0.1, { pos: [-1.8, 1.1, -0.5], color: DARK })
    .build();
  const mkMirror = (sz: number): THREE.BufferGeometry => new GeoBuilder()
    .box(0.2, 0.12, 0.3, { pos: [0.5, 1.02, sz * 1.0], color: 0xffffff, paint: 1 })
    .box(0.08, 0.1, 0.14, { pos: [0.5, 0.97, sz * 0.86], color: DARK })
    .build();

  // ---------------- wheel (axis = z): tyre, chrome disc, hub cap
  const w = new GeoBuilder();
  w.cyl(WR, WR, WW, 12, { rot: [Math.PI / 2, 0, 0], color: 0x24272f, vgrad: [-WR, WR, 0.75, 1.1] });
  for (const sz of [-1, 1]) {
    w.cyl(WR * 0.62, WR * 0.62, 0.03, 8, { pos: [0, 0, sz * (WW / 2 + 0.005)], rot: [Math.PI / 2, 0, 0], color: CHROME });
    // spokes dropped (they are ~2 px on a phone): chrome disc + gold hub cap, 160 triangles per wheel instead of 296
    w.cyl(WR * 0.14, WR * 0.14, 0.06, 6, { pos: [0, 0, sz * (WW / 2 + 0.04)], rot: [Math.PI / 2, 0, 0], color: 0xffcc33 });
  }
  const wheel = w.build();

  // ---------------- lights (basic material): head lamps constant, tail lamps tinted by the instance colour (brake light)
  const l = new GeoBuilder();
  for (const sz of [-1, 1]) {
    l.box(0.12, 0.14, 0.34, { pos: [1.78, 0.86, sz * 0.58], color: 0xfff7c4 });
    l.box(0.1, 0.15, 0.44, { pos: [-1.78, 0.86, sz * 0.58], color: 0xff2a1a, paint: 1 });
  }
  const lights = l.build();

  const parts: Record<BodyPart, THREE.BufferGeometry> = {
    bumperF, bumperR, hood, doorL: mkDoor(1), doorR: mkDoor(-1), spoiler, mirrorL: mkMirror(1), mirrorR: mkMirror(-1),
  };

  // merged silhouette for the ghost car
  const wheelM = new THREE.Matrix4();
  const list: { geo: THREE.BufferGeometry; matrix?: THREE.Matrix4 }[] = [{ geo: body }, { geo: lights }];
  for (const p of PART_LIST) list.push({ geo: parts[p] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) list.push({ geo: wheel, matrix: wheelM.clone().makeTranslation(sx * WX, WR, sz * WZ) });
  const ghost = concat(list);
  return { body, parts, wheel, lights, ghost };
}

// ------------------------------------------------------------------------------------------------

export interface CarPose { x: number; y: number; angle: number; state: CarState }

const PART_ZONE: Record<BodyPart, ZoneId> = {
  bumperF: 'front', bumperR: 'rear', hood: 'front', doorL: 'left', doorR: 'right', spoiler: 'rear', mirrorL: 'left', mirrorR: 'right',
};
/** scorched paint. The mix towards it is capped (CFX.dirtMax ~55%) so even a wreck keeps its body colour and stays readable as a car */
const BURNT = new THREE.Color(0x3a2f29);
/** fake-shadow tint: one neutral dark for every car (a saturated tint reads as neon underglow); the player is told apart by the ground ring only */
const BLOB_COLOR = new THREE.Color(0x10141c);

const _m = new THREE.Matrix4();
const _b = new THREE.Matrix4();
const _t = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _e = new THREE.Euler();
const _one = new THREE.Vector3(1, 1, 1);
const _p0 = new THREE.Vector3();
const _sc = new THREE.Vector3();
const _bm = new THREE.Matrix4();
const _col = new THREE.Color();
const _ax = new THREE.Vector3(1, 0, 0);
const _ay = new THREE.Vector3(0, 1, 0);
const _az = new THREE.Vector3(0, 0, 1);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const _c = new THREE.Color();

export class CarFleet {
  readonly group = new THREE.Group();
  private body: THREE.InstancedMesh;
  private lights: THREE.InstancedMesh;
  private blob: THREE.InstancedMesh;
  private blobGeo: THREE.PlaneGeometry;
  /** per-fleet copy of the body geometry carrying the per-instance crumple attribute */
  private bodyGeo: THREE.BufferGeometry;
  private dmgAttr: THREE.InstancedBufferAttribute;
  private wheels: THREE.InstancedMesh;
  private partMesh = new Map<BodyPart, THREE.InstancedMesh>();
  /** per-fleet clones of the panel / lamp geometries carrying the shared aDmg attribute */
  private dmgGeos: THREE.BufferGeometry[] = [];
  private spin: Float32Array;
  private dentSeed: Float32Array;
  private lightLevel: Float32Array;
  readonly count: number;
  /** currently drawn instance count */
  private shown: number;

  constructor(private geos: CarGeometries, mats: Materials, count: number) {
    this.count = count;
    this.shown = count;
    this.spin = new Float32Array(count);
    this.dentSeed = new Float32Array(count * 4);
    this.lightLevel = new Float32Array(count).fill(0.5);
    const rng = makeRng(777);
    for (let i = 0; i < this.dentSeed.length; i++) this.dentSeed[i] = rng() * 2 - 1;

    const mk = (geo: THREE.BufferGeometry, material: THREE.Material, n: number, cast: boolean): THREE.InstancedMesh => {
      const m = new THREE.InstancedMesh(geo, material, n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.castShadow = cast;
      m.receiveShadow = false;
      for (let i = 0; i < n; i++) { m.setMatrixAt(i, ZERO); m.setColorAt(i, _c.set(0xffffff)); }
      this.group.add(m);
      return m;
    };
    this.bodyGeo = geos.body.clone();
    this.dmgAttr = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.bodyGeo.setAttribute('aDmg', this.dmgAttr);
    this.body = mk(this.bodyGeo, mats.body, count, true);
    // panels and lamps read the same per-car damage (instance i = car i in every mesh): scuffs, soot, cracked lamps
    const withDmg = (g: THREE.BufferGeometry): THREE.BufferGeometry => {
      const c = g.clone();
      c.setAttribute('aDmg', this.dmgAttr);
      this.dmgGeos.push(c);
      return c;
    };
    for (const p of PART_LIST) this.partMesh.set(p, mk(withDmg(geos.parts[p]), mats.carPart, count, p !== 'mirrorL' && p !== 'mirrorR'));
    this.wheels = mk(geos.wheel, mats.paint, count * 4, true);
    this.lights = mk(withDmg(geos.lights), mats.carLamp, count, false);
    for (const m of [this.body, ...this.partMesh.values(), this.wheels, this.lights]) m.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    const bg = new THREE.PlaneGeometry(6.4, 3.8);
    bg.rotateX(-Math.PI / 2);
    this.blobGeo = bg;
    this.blob = new THREE.InstancedMesh(bg, mats.blob(), count);
    this.blob.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.blob.frustumCulled = false;
    this.blob.renderOrder = 3;
    this.blob.visible = false;
    for (let i = 0; i < count; i++) { this.blob.setMatrixAt(i, ZERO); this.blob.setColorAt(i, BLOB_COLOR); }
    this.blob.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.blob);
  }

  /** Show only the first n cars (menu uses 1). */
  setVisibleCount(n: number): void {
    this.shown = Math.min(n, this.count);
    for (const m of [this.body, this.lights, ...this.partMesh.values()]) m.count = this.shown;
    this.wheels.count = this.shown * 4;
    this.blob.count = this.shown;
  }

  /** fake ground shadow under each car: used when real shadows are off */
  setBlobShadows(on: boolean): void { this.blob.visible = on; }

  get meshes(): THREE.InstancedMesh[] { return [this.body, this.lights, this.wheels, this.blob, ...this.partMesh.values()]; }

  /** Local transform of a damaged part (bend around its pivot), written into _m. Bends start early (hp < ~85%) and grow fast. */
  private partMatrix(part: BodyPart, id: number, hpFrac: number): THREE.Matrix4 {
    const raw = Math.max(0, 1 - hpFrac - CFX.bendStart) / (1 - CFX.bendStart);   // 0 healthy .. 1 destroyed
    if (raw < 0.004) return _m.identity();
    const dm = Math.pow(raw, 0.6) * 1.35;
    const pv = PIVOT[part];
    const s = this.dentSeed;
    const j = id * 4;
    let rx = 0, ry = 0, rz = 0, sx = 1, tx = 0, tz = 0;
    const m1 = Math.min(1, dm);
    switch (part) {
      // plan-view changes (yaw, sideways shove, shortening) are what a top-down camera actually sees
      case 'bumperF': case 'bumperR': ry = s[j] * 0.36 * dm; rz = s[j + 1] * 0.16 * dm; sx = 1 - 0.3 * m1; tz = s[j + 1] * 0.24 * dm; tx = (part === 'bumperF' ? -0.14 : 0.14) * dm; break;
      case 'hood': rz = 0.45 * dm; ry = s[j + 2] * 0.17 * dm; sx = 1 - 0.16 * m1; tx = -0.06 * dm; tz = s[j + 2] * 0.07 * dm; break;
      case 'doorL': ry = -0.5 * dm; tz = 0.15 * dm; break;
      case 'doorR': ry = 0.5 * dm; tz = -0.15 * dm; break;
      case 'spoiler': rx = s[j] * 0.5 * dm; rz = -0.3 * dm; ry = s[j + 1] * 0.2 * dm; break;
      default: ry = (part === 'mirrorL' ? -1 : 1) * 0.8 * dm; break;
    }
    _e.set(rx, ry, rz, 'XYZ');
    _q.setFromEuler(_e);
    _t.makeTranslation(-pv[0], -pv[1], -pv[2]);
    _m.compose(_p0.set(pv[0] + tx, pv[1], pv[2] + tz), _q, _sc.set(sx, 1, 1));
    return _m.multiply(_t);
  }

  update(poses: CarPose[], dt: number): void {
    const n = Math.min(poses.length, this.shown);
    for (let i = 0; i < n; i++) {
      const P = poses[i], st = P.state;
      const zmax = st.zoneMaxHp || 100;
      // ---- base transforms
      _q.setFromAxisAngle(_ay, -P.angle);
      _b.compose(_v.set(P.x, 0, P.y), _q, _one);     // wheels sit on the ground
      const speed = st.speed;
      const latAcc = st.angularVel * speed;
      let roll = clamp(-latAcc * CR.rollPerLatAccel, -CR.maxRoll, CR.maxRoll);
      let pitch = (st.throttle - st.brake) * 0.018;
      let bounce = st.offRoad ? Math.sin(performance.now() * 0.03 + i * 2) * 0.03 * clamp(Math.abs(speed) / 20, 0, 1) : 0;
      // a lost wheel: that corner of the body drops onto the hub (+roll lowers the left side, -pitch the nose)
      const dp = st.detachedParts;
      if (dp.length) {
        for (let k = 0; k < 4; k++) {
          if (!dp.includes(WHEEL_LIST[k])) continue;
          roll += (k % 2 === 0 ? 1 : -1) * CFX.wheelOffSag;
          pitch += (k < 2 ? -1 : 1) * CFX.wheelOffSag * 0.55;
          bounce -= 0.06;
        }
      }
      _qa.setFromAxisAngle(_ax, roll);
      _q.setFromAxisAngle(_az, pitch);
      _qa.multiply(_q);
      const bodyM = _bm.compose(_v.set(0, bounce, 0), _qa, _one).premultiply(_b);

      // ---- paint colour and burn
      const col = _col.set(CONFIG.render.carColors[st.colorIndex % CONFIG.render.carColors.length]);
      const dirt = clamp(Math.pow(clamp(1 - st.health, 0, 1), CFX.dirtPower) * CFX.dirtMax, 0, CFX.dirtMax);
      _c.copy(col).lerp(BURNT, dirt);
      this.body.setColorAt(i, _c);
      this.body.setMatrixAt(i, bodyM);
      this.blob.setMatrixAt(i, _t.compose(_v.set(P.x + 0.5, 0.05, P.y + 0.4), _q.setFromAxisAngle(_ay, -P.angle), _one));
      this.blob.setColorAt(i, BLOB_COLOR);

      // ---- body crumple per end of the car (front, rear, left, right): shader pulls those vertices in and scuffs the paint
      const dz = (z: ZoneId): number => 1 - clamp(st.hp[z] / zmax, 0, 1);
      const shape = (v: number): number => Math.pow(Math.max(0, v - 0.04) / 0.96, 0.62);
      const da = this.dmgAttr.array as Float32Array;
      da[i * 4] = shape(Math.max(dz('front'), dz('engine') * 0.6, Math.max(dz('wheelFL'), dz('wheelFR')) * 0.5));
      da[i * 4 + 1] = shape(Math.max(dz('rear'), Math.max(dz('wheelRL'), dz('wheelRR')) * 0.5));
      da[i * 4 + 2] = shape(Math.max(dz('left'), Math.max(dz('wheelFL'), dz('wheelRL')) * 0.5));
      da[i * 4 + 3] = shape(Math.max(dz('right'), Math.max(dz('wheelFR'), dz('wheelRR')) * 0.5));

      // ---- detachable parts
      for (const p of PART_LIST) {
        const mesh = this.partMesh.get(p)!;
        if (st.detachedParts.includes(p)) { mesh.setMatrixAt(i, ZERO); continue; }
        const hpFrac = clamp(st.hp[PART_ZONE[p]] / zmax, 0, 1);
        mesh.setMatrixAt(i, _t.multiplyMatrices(bodyM, this.partMatrix(p, i, hpFrac)));
        _c.copy(col).lerp(BURNT, clamp(Math.max(Math.pow(1 - hpFrac, 0.7) * CFX.dirtMax, dirt), 0, CFX.dirtMax));
        mesh.setColorAt(i, _c);
      }

      // ---- wheels
      this.spin[i] += (speed * dt) / WR;
      const steerYaw = st.steer * CR.maxSteerVisual;
      const wz: ZoneId[] = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];
      let k = 0;
      for (const sx of [1, -1]) {
        for (const sz of [1, -1]) {
          if (dp.includes(WHEEL_LIST[k])) { this.wheels.setMatrixAt(i * 4 + k, ZERO); k++; continue; }
          const hp = clamp(st.hp[wz[k]] / zmax, 0, 1);
          const camber = (1 - hp) * 0.35 * sz;
          _e.set(camber, sx > 0 ? steerYaw : 0, -this.spin[i], 'YXZ');
          _q.setFromEuler(_e);
          _m.compose(_v.set(sx * WX, WR, sz * WZ), _q, _one);
          this.wheels.setMatrixAt(i * 4 + k, _t.multiplyMatrices(_b, _m));
          k++;
        }
      }

      // ---- brake / tail lights: dim idle, bright on brake or handbrake
      const target = st.brake > 0.05 || st.handbrake ? 1 : 0.38;
      this.lightLevel[i] += (target - this.lightLevel[i]) * Math.min(1, dt * 18);
      const ll = this.lightLevel[i];
      this.lights.setMatrixAt(i, bodyM);
      this.lights.setColorAt(i, _c.setRGB(ll, ll * ll, ll * ll));
    }
    for (const m of this.meshes) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.dmgAttr.needsUpdate = true;
  }

  dispose(): void {
    for (const m of this.meshes) m.dispose();
    this.bodyGeo.dispose(); this.blobGeo.dispose();
    for (const g of this.dmgGeos) g.dispose();
  }
}

export function carColor(index: number): number {
  const c = CONFIG.render.carColors;
  return c[((index % c.length) + c.length) % c.length];
}

/** Car-local to world helper for FX: returns world (x, z) of a local point (lx forward, lz left). */
export function carLocalToWorld(x: number, y: number, angle: number, lx: number, ly: number): { x: number; y: number } {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: x + c * lx - s * ly, y: y + s * lx + c * ly };
}
export const CAR_DIMS = { wheelX: WX, wheelZ: WZ, wheelR: WR, lerp };
