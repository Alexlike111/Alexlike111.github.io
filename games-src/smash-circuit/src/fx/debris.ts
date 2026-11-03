// Visual-only debris: a fixed pool of pieces (max CONFIG.destruction.maxDebris in total), ballistic motion, no physics.
// Three looks share the one budget, each drawn by its own InstancedMesh: broken chunks (structures, props), clean car panels
// (bumpers, hood, doors, spoiler, mirrors in the car's paint) and wheels. Pieces bounce, slide to a stop with ground friction,
// settle flat and lie on the road for their life; a car driving through a resting piece kicks it along (visual only).
import * as THREE from 'three';
import { CONFIG } from '../config';
import { GeoBuilder } from '../render/geo';
import type { Materials } from '../render/materials';
import { makeRng } from '../render/util';

export interface DebrisSpec {
  x: number; y: number; z: number;          // three.js coordinates (y = height)
  vx: number; vy: number; vz: number;
  sx: number; sy: number; sz: number;       // piece size in metres
  color: number;
  life?: number;                             // default CONFIG.destruction.debrisLife
  spin?: number;                             // angular speed scale, default 1
  shape?: DebrisShape;                       // default 'chunk'
  rot?: [number, number, number];            // initial Euler XYZ (default random): car panels start aligned with the car
}

export type DebrisShape = 'chunk' | 'panel' | 'wheel';
const SHAPES: DebrisShape[] = ['chunk', 'panel', 'wheel'];

/** Clean unit box with a little vertical shading: a car body panel in the car's paint (instance colour). */
function panelGeometry(): THREE.BufferGeometry {
  return new GeoBuilder().box(1, 1, 1, { color: 0xffffff, vgrad: [-0.5, 0.5, 0.72, 1.08] }).build();
}

/** Unit wheel (diameter 1 in x/z, width 1 along y, so it settles lying flat): dark tyre + chrome disc + hub. Instance colour stays white. */
function wheelGeometry(): THREE.BufferGeometry {
  const w = new GeoBuilder();
  w.cyl(0.5, 0.5, 1, 12, { color: 0x24272f });
  for (const sy of [-1, 1]) {
    w.cyl(0.31, 0.31, 0.06, 8, { pos: [0, sy * 0.51, 0], color: 0xdfe6f1 });
    w.cyl(0.08, 0.08, 0.1, 6, { pos: [0, sy * 0.55, 0], color: 0xffcc33 });
  }
  return w.build();
}

/** Slightly irregular unit cube: reads as a broken chunk, flat shaded. */
function chunkGeometry(): THREE.BufferGeometry {
  const rng = makeRng(4242);
  const g = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  const P = g.getAttribute('position') as THREE.BufferAttribute;
  const seen = new Map<string, [number, number, number]>();
  for (let i = 0; i < P.count; i++) {
    const key = `${P.getX(i)},${P.getY(i)},${P.getZ(i)}`;
    let j = seen.get(key);
    if (!j) { j = [(rng() - 0.5) * 0.28, (rng() - 0.5) * 0.28, (rng() - 0.5) * 0.28]; seen.set(key, j); }
    P.setXYZ(i, P.getX(i) + j[0], P.getY(i) + j[1], P.getZ(i) + j[2]);
  }
  const b = new GeoBuilder().add(g, { color: 0xffffff, vgrad: [-0.6, 0.6, 0.8, 1.08] });
  return b.build();
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

export class DebrisPool {
  /** broken chunks (structures, props, road) */
  readonly mesh: THREE.InstancedMesh;
  /** car body panels */
  readonly panels: THREE.InstancedMesh;
  /** wheels */
  readonly wheels: THREE.InstancedMesh;
  /** all debris meshes (add every one to the scene) */
  readonly meshes: THREE.InstancedMesh[];
  readonly max = CONFIG.destruction.maxDebris;
  private n = 0;
  private shape = new Uint8Array(this.max);
  private bounce = new Float32Array(this.max);
  private px = new Float32Array(this.max); private py = new Float32Array(this.max); private pz = new Float32Array(this.max);
  private vx = new Float32Array(this.max); private vy = new Float32Array(this.max); private vz = new Float32Array(this.max);
  private rx = new Float32Array(this.max); private ry = new Float32Array(this.max); private rz = new Float32Array(this.max);
  private wx = new Float32Array(this.max); private wy = new Float32Array(this.max); private wz = new Float32Array(this.max);
  private sx = new Float32Array(this.max); private sy = new Float32Array(this.max); private sz = new Float32Array(this.max);
  private age = new Float32Array(this.max); private life = new Float32Array(this.max);
  private col = new Float32Array(this.max * 3);
  private rng = makeRng(99);

  constructor(mats: Materials) {
    const mk = (geo: THREE.BufferGeometry): THREE.InstancedMesh => {
      const m = new THREE.InstancedMesh(geo, mats.toon, this.max);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, _c.set(0xffffff));
      m.instanceColor!.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.castShadow = true;
      m.count = 0;
      m.visible = false;
      return m;
    };
    this.mesh = mk(chunkGeometry());
    this.panels = mk(panelGeometry());
    this.wheels = mk(wheelGeometry());
    this.meshes = [this.mesh, this.panels, this.wheels];
  }

  get active(): number { return this.n; }

  private remove(i: number): void {
    const l = --this.n;
    if (i === l) return;
    const px = this.px, py = this.py, pz = this.pz, vx = this.vx, vy = this.vy, vz = this.vz;
    px[i] = px[l]; py[i] = py[l]; pz[i] = pz[l]; vx[i] = vx[l]; vy[i] = vy[l]; vz[i] = vz[l];
    this.rx[i] = this.rx[l]; this.ry[i] = this.ry[l]; this.rz[i] = this.rz[l];
    this.wx[i] = this.wx[l]; this.wy[i] = this.wy[l]; this.wz[i] = this.wz[l];
    this.sx[i] = this.sx[l]; this.sy[i] = this.sy[l]; this.sz[i] = this.sz[l];
    this.age[i] = this.age[l]; this.life[i] = this.life[l]; this.shape[i] = this.shape[l]; this.bounce[i] = this.bounce[l];
    this.col[i * 3] = this.col[l * 3]; this.col[i * 3 + 1] = this.col[l * 3 + 1]; this.col[i * 3 + 2] = this.col[l * 3 + 2];
  }

  spawn(d: DebrisSpec): void {
    let i: number;
    if (this.n < this.max) i = this.n++;
    else {   // pool full: recycle the piece closest to expiry
      i = 0;
      let best = Infinity;
      for (let k = 0; k < this.n; k++) { const left = this.life[k] - this.age[k]; if (left < best) { best = left; i = k; } }
    }
    const r = this.rng;
    this.px[i] = d.x; this.py[i] = d.y; this.pz[i] = d.z;
    this.vx[i] = d.vx; this.vy[i] = d.vy; this.vz[i] = d.vz;
    if (d.rot) { this.rx[i] = d.rot[0]; this.ry[i] = d.rot[1]; this.rz[i] = d.rot[2]; }
    else { this.rx[i] = r() * 6.28; this.ry[i] = r() * 6.28; this.rz[i] = r() * 6.28; }
    const sp = (d.spin ?? 1) * 13;
    this.wx[i] = (r() - 0.5) * sp; this.wy[i] = (r() - 0.5) * sp; this.wz[i] = (r() - 0.5) * sp;
    this.sx[i] = d.sx; this.sy[i] = d.sy; this.sz[i] = d.sz;
    this.age[i] = 0; this.life[i] = d.life ?? CONFIG.destruction.debrisLife;
    const sh = d.shape === 'wheel' ? 2 : d.shape === 'panel' ? 1 : 0;
    this.shape[i] = sh;
    this.bounce[i] = sh === 2 ? 0.62 : sh === 1 ? 0.42 : 0.5;   // tyres bounce, panels clatter
    _c.set(d.color);
    this.col[i * 3] = _c.r; this.col[i * 3 + 1] = _c.g; this.col[i * 3 + 2] = _c.b;
  }

  clear(): void { this.n = 0; for (const m of this.meshes) { m.count = 0; m.visible = false; } }

  /**
   * A car (ground position x, z; velocity vx, vz in m/s) drives through the debris: pieces lying within `radius` are kicked
   * ahead of it with a hop and some spin. Visual only.
   */
  kick(x: number, z: number, vx: number, vz: number, radius: number): void {
    const sp = Math.hypot(vx, vz);
    if (sp < CONFIG.render.fx.debrisKickMinSpeed) return;
    const r2 = radius * radius;
    for (let i = 0; i < this.n; i++) {
      const dx = this.px[i] - x, dz = this.pz[i] - z;
      if (dx * dx + dz * dz > r2 || this.py[i] > 0.9) continue;
      const rel = Math.hypot(this.vx[i] - vx, this.vz[i] - vz);
      if (rel < sp * 0.4) continue;   // already flying with the car
      const r = this.rng;
      this.vx[i] = vx * (0.75 + 0.35 * r()) + dx * 2; this.vz[i] = vz * (0.75 + 0.35 * r()) + dz * 2;
      this.vy[i] = 2.5 + Math.min(5, sp * 0.18);
      this.wx[i] = (r() - 0.5) * 14; this.wy[i] = (r() - 0.5) * 10; this.wz[i] = (r() - 0.5) * 14;
    }
  }

  update(dt: number): void {
    const g = CONFIG.render.fx.gravity, fade = CONFIG.destruction.debrisFade;
    const fr = Math.exp(-CONFIG.render.fx.debrisGroundFriction * dt), spinFr = Math.exp(-6 * dt);
    const settle = Math.min(1, dt * 8);
    for (let i = this.n - 1; i >= 0; i--) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this.remove(i); continue; }
      this.vy[i] -= g * dt;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      // flat pieces (panels, wheels) rest on their thinnest side
      const half = (this.shape[i] === 0 ? Math.min(this.sx[i], this.sy[i], this.sz[i]) : this.sy[i]) * 0.5;
      if (this.py[i] < half) {
        this.py[i] = half;
        if (this.vy[i] < -1.5) {   // bounce: lose some slide and spin on each landing
          this.vy[i] = -this.vy[i] * this.bounce[i];
          this.vx[i] *= 0.8; this.vz[i] *= 0.8;
          this.wx[i] *= 0.7; this.wy[i] *= 0.7; this.wz[i] *= 0.7;
        } else {                   // sliding: ground friction (frame-rate independent), tumbling stops, the piece lies flat
          this.vy[i] = 0;
          this.vx[i] *= fr; this.vz[i] *= fr;
          this.wx[i] *= spinFr; this.wz[i] *= spinFr; this.wy[i] *= fr;
          this.rx[i] += (Math.round(this.rx[i] / Math.PI) * Math.PI - this.rx[i]) * settle;
          this.rz[i] += (Math.round(this.rz[i] / Math.PI) * Math.PI - this.rz[i]) * settle;
        }
      }
      this.rx[i] += this.wx[i] * dt; this.ry[i] += this.wy[i] * dt; this.rz[i] += this.wz[i] * dt;
    }
    const n = this.n;
    const cnt = this.cnt;
    cnt[0] = 0; cnt[1] = 0; cnt[2] = 0;
    for (let i = 0; i < n; i++) {
      const left = this.life[i] - this.age[i];
      const k = left < fade ? Math.max(0.001, left / fade) : 1;
      _e.set(this.rx[i], this.ry[i], this.rz[i]);
      _q.setFromEuler(_e);
      _m.compose(_p.set(this.px[i], this.py[i], this.pz[i]), _q, _s.set(this.sx[i] * k, this.sy[i] * k, this.sz[i] * k));
      const sh = this.shape[i];
      const mesh = this.meshes[sh];
      const j = cnt[sh]++;
      mesh.setMatrixAt(j, _m);
      mesh.setColorAt(j, _c.setRGB(this.col[i * 3], this.col[i * 3 + 1], this.col[i * 3 + 2]));
    }
    for (let s = 0; s < SHAPES.length; s++) {
      const mesh = this.meshes[s];
      mesh.count = cnt[s];
      mesh.visible = cnt[s] > 0;   // no draw call for an empty look
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
  private cnt = new Int32Array(SHAPES.length);

  dispose(): void { for (const m of this.meshes) { m.geometry.dispose(); m.dispose(); } }
}
