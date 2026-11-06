// Procedural cartoon cars. All 8 cars share a handful of InstancedMeshes (one per separable part), so a full grid costs
// ~12 draw calls. Parts that can fly off (hood, bumpers, doors, spoiler, mirrors) are their own instanced meshes: a detached
// part is hidden here and thrown as debris by the FX layer.
import * as THREE from 'three';
import { CONFIG } from '../config';
import type { CarPart, CarState, ZoneId } from '../types';
import { GeoBuilder, concat } from './geo';
import type { Materials } from './materials';
import { clamp, lerp, makeRng } from './util';
import { CHROME, MODEL_BUILDERS, type WheelSpec } from './carModels';
import { paintHex } from './paintLayer';

export type { WheelSpec } from './carModels';

const CR = CONFIG.render.car;
const CFX = CONFIG.render.fx;
const WR = CR.wheelRadius, WW = CR.wheelWidth, WX = CR.wheelX, WZ = CR.wheelZ;

/** Wheels are CarParts too (they come off at heavy damage), but they are drawn by the wheel mesh, not as body panels. */
export type WheelPart = 'wheelFL' | 'wheelFR' | 'wheelRL' | 'wheelRR';
export type BodyPart = Exclude<CarPart, WheelPart>;
export const PART_LIST: BodyPart[] = ['bumperF', 'bumperR', 'hood', 'doorL', 'doorR', 'spoiler', 'mirrorL', 'mirrorR'];
/** wheel order of the wheel instances (k = 0..3 per car): (+x,+z) FL, (+x,-z) FR, (-x,+z) RL, (-x,-z) RR */
export const WHEEL_LIST: WheelPart[] = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];

export interface CarGeometries {
  /** roster id of this model */
  modelId: string;
  body: THREE.BufferGeometry;
  parts: Record<BodyPart, THREE.BufferGeometry>;
  /** the shared reference wheel (radius CR.wheelRadius, width CR.wheelWidth); every model scales it per wheel */
  wheel: THREE.BufferGeometry;
  /** wheel layout of this model (FL, FR, RL, RR) */
  wheels: WheelSpec[];
  /** pivot (car-local) each part bends around when damaged (derived from the part's bounding box) */
  pivots: Record<BodyPart, [number, number, number]>;
  lights: THREE.BufferGeometry;
  ghost: THREE.BufferGeometry;
  /** footprint (m) of the whole model, for the blob shadow */
  length: number; width: number;
}

let sharedWheel: THREE.BufferGeometry | null = null;
/** Reference wheel (axis = z): tyre, chrome disc, hub cap. Built once, shared by every model and fleet. */
export function wheelGeometry(): THREE.BufferGeometry {
  if (sharedWheel) return sharedWheel;
  const w = new GeoBuilder();
  w.cyl(WR, WR, WW, 12, { rot: [Math.PI / 2, 0, 0], color: 0x24272f, vgrad: [-WR, WR, 0.75, 1.1] });
  for (const sz of [-1, 1]) {
    w.cyl(WR * 0.62, WR * 0.62, 0.03, 8, { pos: [0, 0, sz * (WW / 2 + 0.005)], rot: [Math.PI / 2, 0, 0], color: CHROME });
    // spokes dropped (they are ~2 px on a phone): chrome disc + gold hub cap, 160 triangles per wheel instead of 296
    w.cyl(WR * 0.14, WR * 0.14, 0.06, 6, { pos: [0, 0, sz * (WW / 2 + 0.04)], rot: [Math.PI / 2, 0, 0], color: 0xffcc33 });
  }
  sharedWheel = w.build();
  return sharedWheel;
}

function pivotOf(part: BodyPart, geo: THREE.BufferGeometry): [number, number, number] {
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const cx = (bb.min.x + bb.max.x) / 2, cy = (bb.min.y + bb.max.y) / 2, cz = (bb.min.z + bb.max.z) / 2;
  switch (part) {
    case 'bumperF': return [bb.min.x, cy, cz];
    case 'bumperR': return [bb.max.x, cy, cz];
    case 'hood': return [bb.min.x, bb.min.y, cz];
    case 'doorL': return [bb.max.x, cy, bb.min.z];
    case 'doorR': return [bb.max.x, cy, bb.max.z];
    case 'spoiler': return [cx, bb.min.y, cz];
    case 'mirrorL': return [cx, cy, bb.min.z];
    default: return [cx, cy, bb.max.z];
  }
}

/** Build the geometries of one roster model (default: the starter). Use getCarGeometries() for the cached copy. */
export function buildCarGeometries(modelId: string = CONFIG.cars.starter): CarGeometries {
  const build = MODEL_BUILDERS[modelId] ?? MODEL_BUILDERS[CONFIG.cars.starter];
  const m = build();
  const wheel = wheelGeometry();
  const pivots = {} as Record<BodyPart, [number, number, number]>;
  for (const p of PART_LIST) pivots[p] = pivotOf(p, m.parts[p]);
  // merged silhouette for the ghost car
  const list: { geo: THREE.BufferGeometry; matrix?: THREE.Matrix4 }[] = [{ geo: m.body }, { geo: m.lights }];
  for (const p of PART_LIST) list.push({ geo: m.parts[p] });
  for (const k of m.wheels) list.push({ geo: wheel, matrix: new THREE.Matrix4().compose(new THREE.Vector3(k.x, k.r, k.z), new THREE.Quaternion(), new THREE.Vector3(k.r / WR, k.r / WR, k.w / WW)) });
  const ghost = concat(list);
  ghost.computeBoundingBox();
  const size = ghost.boundingBox!.getSize(new THREE.Vector3());
  return { modelId: MODEL_BUILDERS[modelId] ? modelId : CONFIG.cars.starter, body: m.body, parts: m.parts, wheel, wheels: m.wheels, pivots, lights: m.lights, ghost, length: size.x, width: size.z };
}

const geoCache = new Map<string, CarGeometries>();
/** Cached geometries of a model: built once per session, shared by races, the garage and the ghost. */
export function getCarGeometries(modelId: string | undefined): CarGeometries {
  const id = modelId && MODEL_BUILDERS[modelId] ? modelId : CONFIG.cars.starter;
  let g = geoCache.get(id);
  if (!g) { g = buildCarGeometries(id); geoCache.set(id, g); }
  return g;
}

/** Wheel layout of a model (FX: skid marks, tyre smoke and hub sparks come from the real wheels). */
export function wheelLayout(modelId: string | undefined): WheelSpec[] { return getCarGeometries(modelId).wheels; }

/** Release every cached car geometry (renderer dispose). */
export function disposeCarGeometries(): void {
  for (const g of geoCache.values()) {
    for (const x of [g.body, g.lights, g.ghost, ...Object.values(g.parts)]) x.dispose();
  }
  geoCache.clear();
  sharedWheel?.dispose();
  sharedWheel = null;
}

// ------------------------------------------------------------------------------------------------

export interface CarPose { x: number; y: number; angle: number; state: CarState }

const PART_ZONE: Record<BodyPart, ZoneId> = {
  bumperF: 'front', bumperR: 'rear', hood: 'front', doorL: 'left', doorR: 'right', spoiler: 'rear', mirrorL: 'left', mirrorR: 'right',
};
/** scorched paint. The mix towards it is capped (CFX.dirtMax ~55%) so even a wreck keeps its body colour and stays readable as a car */
const BURNT = new THREE.Color(0x3a2f29);
const FLASH = new THREE.Color(0xffffff);
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
  /** hit reaction per car (render only): damped pitch / roll springs (angle, rate) and the paint flash timer */
  private kick: Float32Array;
  private flash: Float32Array;
  readonly count: number;
  /** currently drawn instance count */
  private shown: number;
  /** blob shadow sized to this model's footprint */
  private blobScale: THREE.Vector3;

  constructor(private geos: CarGeometries, mats: Materials, count: number) {
    this.count = count;
    this.shown = count;
    this.blobScale = new THREE.Vector3(Math.max(0.8, geos.length / 4.4), 1, Math.max(0.8, geos.width / 2.1));
    this.spin = new Float32Array(count);
    this.dentSeed = new Float32Array(count * 4);
    this.lightLevel = new Float32Array(count).fill(0.5);
    this.kick = new Float32Array(count * 4);
    this.flash = new Float32Array(count);
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
    const pv = this.geos.pivots[part];
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

  /** An impact on car k at car-local point (lx forward, ly left), strength 0..1: pitch / roll kick and a short paint flash. */
  hit(k: number, strength: number, lx: number, ly: number): void {
    if (k < 0 || k >= this.count) return;
    const s = clamp(strength, 0, 1), j = k * 4;
    const n = Math.hypot(lx, ly) || 1;
    this.kick[j + 1] += s * CR.hitPitch * CR.hitKickRate * (lx / n);
    this.kick[j + 3] += s * CR.hitRoll * CR.hitKickRate * (ly / n);
    this.flash[k] = CR.hitFlashTime;
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
      // hit reaction: semi-implicit damped springs, stable for any frame dt
      {
        const j = i * 4, h = Math.min(dt, 0.033);
        const kv = this.kick;
        kv[j + 1] += (-CR.hitStiffness * kv[j] - CR.hitDamping * kv[j + 1]) * h; kv[j] += kv[j + 1] * h;
        kv[j + 3] += (-CR.hitStiffness * kv[j + 2] - CR.hitDamping * kv[j + 3]) * h; kv[j + 2] += kv[j + 3] * h;
        pitch += clamp(kv[j], -CR.hitMax, CR.hitMax);
        roll += clamp(kv[j + 2], -CR.hitMax, CR.hitMax);
        this.flash[i] = Math.max(0, this.flash[i] - dt);
      }
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
      const col = _col.set(paintHex(st.colorIndex));
      const dirt = clamp(Math.pow(clamp(1 - st.health, 0, 1), CFX.dirtPower) * CFX.dirtMax, 0, CFX.dirtMax);
      _c.copy(col).lerp(BURNT, dirt);
      const fl = this.flash[i] > 0 ? CR.hitFlashMix * (this.flash[i] / CR.hitFlashTime) : 0;
      if (fl > 0) _c.lerp(FLASH, fl);
      this.body.setColorAt(i, _c);
      this.body.setMatrixAt(i, bodyM);
      this.blob.setMatrixAt(i, _t.compose(_v.set(P.x + 0.5, 0.05, P.y + 0.4), _q.setFromAxisAngle(_ay, -P.angle), this.blobScale));
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
        if (fl > 0) _c.lerp(FLASH, fl);
        mesh.setColorAt(i, _c);
      }

      // ---- wheels
      this.spin[i] += (speed * dt) / WR;    // angle of the reference wheel; each wheel turns by its own radius below
      const steerYaw = st.steer * CR.maxSteerVisual;
      const wz: ZoneId[] = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];
      const W = this.geos.wheels;
      for (let k = 0; k < 4; k++) {
        if (dp.includes(WHEEL_LIST[k])) { this.wheels.setMatrixAt(i * 4 + k, ZERO); continue; }
        const w = W[k];
        const sz = w.z >= 0 ? 1 : -1;
        const hp = clamp(st.hp[wz[k]] / zmax, 0, 1);
        const camber = (1 - hp) * 0.35 * sz;
        _e.set(camber, k < 2 ? steerYaw : 0, -this.spin[i] * (WR / w.r), 'YXZ');
        _q.setFromEuler(_e);
        _m.compose(_v.set(w.x, w.r, w.z), _q, _sc.set(w.r / WR, w.r / WR, w.w / WW));
        this.wheels.setMatrixAt(i * 4 + k, _t.multiplyMatrices(_b, _m));
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

/**
 * Cars of several models in one race: one CarFleet (a handful of instanced meshes) per model present, cars mapped onto
 * their model's fleet. `models[i]` = model id of car i (same order as the poses passed to update).
 */
export class CarFleets {
  readonly group = new THREE.Group();
  readonly fleets: CarFleet[] = [];
  private slot: { fleet: number; k: number }[] = [];
  private sub: CarPose[][] = [];

  constructor(mats: Materials, models: (string | undefined)[]) {
    const byModel = new Map<string, number>();
    const counts: number[] = [];
    const ids: string[] = [];
    for (const m of models) {
      const id = getCarGeometries(m).modelId;
      let f = byModel.get(id);
      if (f === undefined) { f = ids.length; byModel.set(id, f); ids.push(id); counts.push(0); }
      this.slot.push({ fleet: f, k: counts[f]++ });
    }
    ids.forEach((id, f) => {
      const fleet = new CarFleet(getCarGeometries(id), mats, counts[f]);
      this.fleets.push(fleet);
      this.group.add(fleet.group);
      this.sub.push([]);
    });
  }

  get meshes(): THREE.InstancedMesh[] { return this.fleets.flatMap((f) => f.meshes); }
  setBlobShadows(on: boolean): void { for (const f of this.fleets) f.setBlobShadows(on); }

  update(poses: CarPose[], dt: number): void {
    for (const s of this.sub) s.length = 0;
    const n = Math.min(poses.length, this.slot.length);
    for (let i = 0; i < n; i++) { const sl = this.slot[i]; this.sub[sl.fleet][sl.k] = poses[i]; }
    for (let f = 0; f < this.fleets.length; f++) if (this.sub[f].length) this.fleets[f].update(this.sub[f], dt);
  }

  /** hit reaction of car index i (pose order) at car-local point (lx forward, ly left) */
  hit(i: number, strength: number, lx: number, ly: number): void {
    const sl = this.slot[i];
    if (sl) this.fleets[sl.fleet].hit(sl.k, strength, lx, ly);
  }

  dispose(): void { for (const f of this.fleets) f.dispose(); }
}
