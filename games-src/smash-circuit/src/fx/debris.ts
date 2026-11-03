// Visual-only debris: a fixed pool of InstancedMesh pieces (max CONFIG.destruction.maxDebris), ballistic motion, no physics.
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
  readonly mesh: THREE.InstancedMesh;
  readonly max = CONFIG.destruction.maxDebris;
  private n = 0;
  private px = new Float32Array(this.max); private py = new Float32Array(this.max); private pz = new Float32Array(this.max);
  private vx = new Float32Array(this.max); private vy = new Float32Array(this.max); private vz = new Float32Array(this.max);
  private rx = new Float32Array(this.max); private ry = new Float32Array(this.max); private rz = new Float32Array(this.max);
  private wx = new Float32Array(this.max); private wy = new Float32Array(this.max); private wz = new Float32Array(this.max);
  private sx = new Float32Array(this.max); private sy = new Float32Array(this.max); private sz = new Float32Array(this.max);
  private age = new Float32Array(this.max); private life = new Float32Array(this.max);
  private col = new Float32Array(this.max * 3);
  private rng = makeRng(99);

  constructor(mats: Materials) {
    this.mesh = new THREE.InstancedMesh(chunkGeometry(), mats.toon, this.max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, _c.set(0xffffff));
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.count = 0;
  }

  get active(): number { return this.n; }

  private remove(i: number): void {
    const l = --this.n;
    if (i === l) return;
    for (const a of [this.px, this.py, this.pz, this.vx, this.vy, this.vz, this.rx, this.ry, this.rz, this.wx, this.wy, this.wz,
      this.sx, this.sy, this.sz, this.age, this.life]) a[i] = a[l];
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
    this.rx[i] = r() * 6.28; this.ry[i] = r() * 6.28; this.rz[i] = r() * 6.28;
    const sp = (d.spin ?? 1) * 13;
    this.wx[i] = (r() - 0.5) * sp; this.wy[i] = (r() - 0.5) * sp; this.wz[i] = (r() - 0.5) * sp;
    this.sx[i] = d.sx; this.sy[i] = d.sy; this.sz[i] = d.sz;
    this.age[i] = 0; this.life[i] = d.life ?? CONFIG.destruction.debrisLife;
    _c.set(d.color);
    this.col[i * 3] = _c.r; this.col[i * 3 + 1] = _c.g; this.col[i * 3 + 2] = _c.b;
  }

  clear(): void { this.n = 0; this.mesh.count = 0; }

  update(dt: number): void {
    const g = CONFIG.render.fx.gravity, fade = CONFIG.destruction.debrisFade;
    for (let i = this.n - 1; i >= 0; i--) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this.remove(i); continue; }
      this.vy[i] -= g * dt;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      const half = Math.min(this.sx[i], this.sy[i], this.sz[i]) * 0.5;
      if (this.py[i] < half) {
        this.py[i] = half;
        if (this.vy[i] < -1.5) this.vy[i] = -this.vy[i] * 0.5; else this.vy[i] = 0;
        this.vx[i] *= 0.78; this.vz[i] *= 0.78;
        this.wx[i] *= 0.7; this.wy[i] *= 0.7; this.wz[i] *= 0.7;
      }
      this.rx[i] += this.wx[i] * dt; this.ry[i] += this.wy[i] * dt; this.rz[i] += this.wz[i] * dt;
    }
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const left = this.life[i] - this.age[i];
      const k = left < fade ? Math.max(0.001, left / fade) : 1;
      _e.set(this.rx[i], this.ry[i], this.rz[i]);
      _q.setFromEuler(_e);
      _m.compose(_p.set(this.px[i], this.py[i], this.pz[i]), _q, _s.set(this.sx[i] * k, this.sy[i] * k, this.sz[i] * k));
      this.mesh.setMatrixAt(i, _m);
      this.mesh.setColorAt(i, _c.setRGB(this.col[i * 3], this.col[i * 3 + 1], this.col[i * 3 + 2]));
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void { this.mesh.geometry.dispose(); this.mesh.dispose(); }
}
