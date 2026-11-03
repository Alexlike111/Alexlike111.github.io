// Pooled billboard particles in ONE draw call each: a normal-blend system (smoke, dust, confetti) and an additive one (sparks, fire).
import * as THREE from 'three';

const VERT = /* glsl */`
attribute vec3 iPos;
attribute float iSize;
attribute vec4 iColor;
uniform vec3 uRight;
uniform vec3 uUp;
varying vec2 vUv;
varying vec4 vC;
void main() {
  vUv = position.xy;
  vC = iColor;
  // iPos is scene-local; the scene root is mirrored along z (renderer.ts), so go through modelMatrix first, then billboard in world space
  vec4 w = modelMatrix * vec4(iPos, 1.0);
  w.xyz += (uRight * position.x + uUp * position.y) * iSize;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const FRAG = /* glsl */`
uniform float uSoft;
varying vec2 vUv;
varying vec4 vC;
void main() {
  float d = length(vUv);
  if (d > 1.0) discard;
  float a = vC.a * smoothstep(1.0, uSoft, d);
  gl_FragColor = vec4(vC.rgb, a);
  #include <colorspace_fragment>
}`;

export interface ParticleOpts {
  life: number; size0: number; size1: number;
  color: THREE.Color | number;
  alpha?: number;
  drag?: number;       // 1/s velocity damping
  gravity?: number;    // m/s^2 (positive pulls down)
  mode?: 0 | 1;        // 0 smoke: fade in + out, 1 spark: linear out
}

export class ParticleSystem {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private mat: THREE.ShaderMaterial;
  private cap: number;
  private limit: number;
  private n = 0;
  private pos: Float32Array; private size: Float32Array; private colA: Float32Array;
  private vel: Float32Array;
  private age: Float32Array; private life: Float32Array;
  private s0: Float32Array; private s1: Float32Array; private base: Float32Array;   // base: r,g,b,a
  private drag: Float32Array; private grav: Float32Array; private modeA: Uint8Array;
  private aPos: THREE.InstancedBufferAttribute; private aSize: THREE.InstancedBufferAttribute; private aCol: THREE.InstancedBufferAttribute;
  private tmp = new THREE.Color();

  constructor(capacity: number, additive: boolean, soft: number) {
    this.cap = capacity;
    this.limit = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.colA = new Float32Array(capacity * 4);
    this.age = new Float32Array(capacity); this.life = new Float32Array(capacity);
    this.s0 = new Float32Array(capacity); this.s1 = new Float32Array(capacity);
    this.base = new Float32Array(capacity * 4);
    this.drag = new Float32Array(capacity); this.grav = new Float32Array(capacity);
    this.modeA = new Uint8Array(capacity);

    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.InstancedBufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(this.colA, 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iPos', this.aPos);
    this.geo.setAttribute('iSize', this.aSize);
    this.geo.setAttribute('iColor', this.aCol);
    this.geo.instanceCount = 0;

    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uRight: { value: new THREE.Vector3(1, 0, 0) }, uUp: { value: new THREE.Vector3(0, 0, -1) }, uSoft: { value: soft } },
      transparent: true, depthWrite: false, depthTest: true,
      side: THREE.DoubleSide,   // the mirrored scene root flips the winding three.js expects
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 11 : 10;
  }

  get active(): number { return this.n; }

  /** quality scaling: only this share of the pool may be used */
  setShare(share: number): void { this.limit = Math.max(8, Math.floor(this.cap * share)); }

  setCamera(cam: THREE.Camera): void {
    const e = cam.matrixWorld.elements;
    (this.mat.uniforms.uRight.value as THREE.Vector3).set(e[0], e[1], e[2]);
    (this.mat.uniforms.uUp.value as THREE.Vector3).set(e[4], e[5], e[6]);
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, o: ParticleOpts): void {
    if (this.n >= this.limit) return;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.age[i] = 0; this.life[i] = o.life;
    this.s0[i] = o.size0; this.s1[i] = o.size1;
    this.tmp.set(o.color as THREE.ColorRepresentation);
    this.base[i * 4] = this.tmp.r; this.base[i * 4 + 1] = this.tmp.g; this.base[i * 4 + 2] = this.tmp.b; this.base[i * 4 + 3] = o.alpha ?? 1;
    this.drag[i] = o.drag ?? 0; this.grav[i] = o.gravity ?? 0; this.modeA[i] = o.mode ?? 0;
  }

  clear(): void { this.n = 0; this.geo.instanceCount = 0; }

  private remove(i: number): void {
    const l = --this.n;
    if (i === l) return;
    for (let k = 0; k < 3; k++) { this.pos[i * 3 + k] = this.pos[l * 3 + k]; this.vel[i * 3 + k] = this.vel[l * 3 + k]; }
    for (let k = 0; k < 4; k++) this.base[i * 4 + k] = this.base[l * 4 + k];
    this.age[i] = this.age[l]; this.life[i] = this.life[l]; this.s0[i] = this.s0[l]; this.s1[i] = this.s1[l];
    this.drag[i] = this.drag[l]; this.grav[i] = this.grav[l]; this.modeA[i] = this.modeA[l];
  }

  update(dt: number): void {
    for (let i = this.n - 1; i >= 0; i--) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) this.remove(i);
    }
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const k = Math.exp(-this.drag[i] * dt);
      const i3 = i * 3;
      this.vel[i3] *= k; this.vel[i3 + 1] = this.vel[i3 + 1] * k - this.grav[i] * dt; this.vel[i3 + 2] *= k;
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.05 && this.grav[i] > 0) { this.pos[i3 + 1] = 0.05; this.vel[i3 + 1] *= -0.3; this.vel[i3] *= 0.6; this.vel[i3 + 2] *= 0.6; }
      const t = this.age[i] / this.life[i];
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      let a: number;
      if (this.modeA[i] === 0) a = Math.min(1, t / 0.12) * Math.pow(1 - t, 1.3);
      else a = 1 - t * t;
      this.colA[i * 4] = this.base[i * 4]; this.colA[i * 4 + 1] = this.base[i * 4 + 1]; this.colA[i * 4 + 2] = this.base[i * 4 + 2];
      this.colA[i * 4 + 3] = this.base[i * 4 + 3] * a;
    }
    this.geo.instanceCount = n;
    this.aPos.needsUpdate = true; this.aSize.needsUpdate = true; this.aCol.needsUpdate = true;
  }

  dispose(): void { this.geo.dispose(); this.mat.dispose(); }
}
