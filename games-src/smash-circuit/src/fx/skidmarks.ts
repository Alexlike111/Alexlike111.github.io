// Skid marks: a ring buffer of ground quads in one dynamic BufferGeometry (one draw call).
import * as THREE from 'three';
import { CONFIG } from '../config';

export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private cap: number;
  private limit: number;
  private pos: Float32Array;
  private col: Float32Array;
  private geo: THREE.BufferGeometry;
  private head = 0;
  private lastX: Float32Array; private lastZ: Float32Array; private has: Uint8Array;
  private dirtyMin = Infinity; private dirtyMax = -1; private wrapped = false;
  private tint = new THREE.Color(0x15171c);
  private maxLen = 3.5;

  constructor(capacity: number, keys: number) {
    this.cap = capacity;
    this.limit = capacity;
    this.pos = new Float32Array(capacity * 12);
    this.col = new Float32Array(capacity * 16);
    this.lastX = new Float32Array(keys); this.lastZ = new Float32Array(keys); this.has = new Uint8Array(keys);
    const idx = new Uint32Array(capacity * 6);
    for (let i = 0; i < capacity; i++) {
      const v = i * 4;
      idx.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  setTint(hex: number): void { this.tint.set(hex); }

  /** quality: use only the first n quads of the ring */
  setLimit(n: number): void {
    this.limit = Math.max(16, Math.min(this.cap, n));
    if (this.head >= this.limit) this.head = 0;
    for (let i = this.limit; i < this.cap; i++) { this.pos.fill(0, i * 12, i * 12 + 12); this.col.fill(0, i * 16, i * 16 + 16); }
    this.wrapped = true;
  }

  clear(): void {
    this.pos.fill(0); this.col.fill(0); this.head = 0; this.has.fill(0);
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Feed the current contact point of wheel `key`; intensity 0 ends the trail. Ground coordinates (x, z). */
  mark(key: number, x: number, z: number, intensity: number): void {
    if (intensity <= 0.02) { this.has[key] = 0; return; }
    if (this.has[key]) {
      const dx = x - this.lastX[key], dz = z - this.lastZ[key];
      const d = Math.hypot(dx, dz);
      if (d > this.maxLen) { this.has[key] = 0; }
      else if (d > 0.18) {
        this.quad(this.lastX[key], this.lastZ[key], x, z, dx / d, dz / d, Math.min(1, intensity));
        this.lastX[key] = x; this.lastZ[key] = z;
        return;
      } else return;
    }
    this.has[key] = 1; this.lastX[key] = x; this.lastZ[key] = z;
  }

  private quad(x0: number, z0: number, x1: number, z1: number, dx: number, dz: number, a: number): void {
    const hw = CONFIG.render.fx.skidWidth / 2;
    const nx = -dz * hw, nz = dx * hw;
    const i = this.head;
    const p = i * 12, y = 0.07;
    this.pos[p] = x0 + nx; this.pos[p + 1] = y; this.pos[p + 2] = z0 + nz;
    this.pos[p + 3] = x0 - nx; this.pos[p + 4] = y; this.pos[p + 5] = z0 - nz;
    this.pos[p + 6] = x1 - nx; this.pos[p + 7] = y; this.pos[p + 8] = z1 - nz;
    this.pos[p + 9] = x1 + nx; this.pos[p + 10] = y; this.pos[p + 11] = z1 + nz;
    const c = i * 16, r = this.tint.r, g = this.tint.g, b = this.tint.b, al = 0.2 + 0.4 * a;
    for (let k = 0; k < 4; k++) { this.col[c + k * 4] = r; this.col[c + k * 4 + 1] = g; this.col[c + k * 4 + 2] = b; this.col[c + k * 4 + 3] = al; }
    if (i < this.dirtyMin) this.dirtyMin = i;
    if (i > this.dirtyMax) this.dirtyMax = i;
    this.head = (this.head + 1) % this.limit;
    if (this.head === 0) this.wrapped = true;
  }

  /** Upload what changed this frame. */
  flush(): void {
    if (this.dirtyMax < 0 && !this.wrapped) return;
    const pa = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const ca = this.geo.getAttribute('color') as THREE.BufferAttribute;
    if (this.wrapped || this.dirtyMax - this.dirtyMin > this.cap / 2) {
      pa.clearUpdateRanges(); ca.clearUpdateRanges();
    } else {
      pa.clearUpdateRanges(); ca.clearUpdateRanges();
      pa.addUpdateRange(this.dirtyMin * 12, (this.dirtyMax - this.dirtyMin + 1) * 12);
      ca.addUpdateRange(this.dirtyMin * 16, (this.dirtyMax - this.dirtyMin + 1) * 16);
    }
    pa.needsUpdate = true; ca.needsUpdate = true;
    this.dirtyMin = Infinity; this.dirtyMax = -1; this.wrapped = false;
  }

  dispose(): void { this.geo.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
