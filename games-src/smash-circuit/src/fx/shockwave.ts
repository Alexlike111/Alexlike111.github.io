// Short-lived expanding ground rings + nothing else: the "this was a heavy hit" flash that stays readable at race zoom.
// One additive InstancedMesh, fixed pool, no allocation per spawn.
import * as THREE from 'three';
import { CONFIG } from '../config';

const FX = CONFIG.render.fx;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

export class ShockwavePool {
  readonly mesh: THREE.InstancedMesh;
  readonly max: number;
  private n = 0;
  private x: Float32Array; private z: Float32Array;
  private age: Float32Array; private life: Float32Array; private r1: Float32Array;
  private col: Float32Array;

  constructor(capacity: number = FX.shockwaveCapacity) {
    this.max = capacity;
    this.x = new Float32Array(capacity); this.z = new Float32Array(capacity);
    this.age = new Float32Array(capacity); this.life = new Float32Array(capacity); this.r1 = new Float32Array(capacity);
    this.col = new Float32Array(capacity * 3);
    const g = new THREE.RingGeometry(0.88, 1, 32, 1);
    g.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.InstancedMesh(g, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, _c.set(0xffffff));
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  get active(): number { return this.n; }

  /** weight 0..1 scales the final radius; color is the ring tint at full brightness. */
  spawn(x: number, z: number, weight: number, color = 0xfff0c4): void {
    let i: number;
    if (this.n < this.max) i = this.n++;
    else { i = 0; let best = -1; for (let k = 0; k < this.n; k++) { const a = this.age[k] / this.life[k]; if (a > best) { best = a; i = k; } } }
    this.x[i] = x; this.z[i] = z;
    this.age[i] = 0; this.life[i] = FX.shockwaveLife * (0.8 + 0.4 * weight);
    this.r1[i] = FX.shockwaveRadius * (0.45 + 0.55 * weight);
    _c.set(color);
    this.col[i * 3] = _c.r; this.col[i * 3 + 1] = _c.g; this.col[i * 3 + 2] = _c.b;
  }

  clear(): void { this.n = 0; this.mesh.count = 0; this.mesh.visible = false; }

  update(dt: number): void {
    for (let i = this.n - 1; i >= 0; i--) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        const l = --this.n;
        if (i !== l) {
          this.x[i] = this.x[l]; this.z[i] = this.z[l]; this.age[i] = this.age[l]; this.life[i] = this.life[l]; this.r1[i] = this.r1[l];
          this.col[i * 3] = this.col[l * 3]; this.col[i * 3 + 1] = this.col[l * 3 + 1]; this.col[i * 3 + 2] = this.col[l * 3 + 2];
        }
      }
    }
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const t = this.age[i] / this.life[i];
      const e = 1 - (1 - t) * (1 - t);                // ease out
      const r = 0.6 + (this.r1[i] - 0.6) * e;
      const fade = (1 - t) * (1 - t) * 1.05;
      _m.compose(_p.set(this.x[i], 0.12, this.z[i]), _q.identity(), _s.set(r, 1, r));
      this.mesh.setMatrixAt(i, _m);
      this.mesh.setColorAt(i, _c.setRGB(this.col[i * 3] * fade, this.col[i * 3 + 1] * fade, this.col[i * 3 + 2] * fade));
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); this.mesh.dispose(); }
}
