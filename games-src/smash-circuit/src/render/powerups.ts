// Power-up visuals: glowing animated chevron boost pads, spinning item boxes, oil slicks and ram-shield bubbles.
// Reads ISim state only. Everything is built once per race; update() allocates nothing (module-level scratch objects).
import * as THREE from 'three';
import { CONFIG } from '../config';
import type { BoostPad, ISim } from '../types';
import type { CarPose } from './car';

const FX = CONFIG.items.fx;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qy = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

const PAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// vUv.x runs along the travel direction (0..1), vUv.y across the pad. Chevrons point forward and slide along it.
const PAD_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uA;
uniform vec3 uB;
uniform float uLen;
varying vec2 vUv;
void main() {
  float across = abs(vUv.y - 0.5) * 2.0;
  float q = vUv.x * uLen * 0.5 + across * 0.8 - uTime * 2.4;
  float f = fract(q);
  float band = smoothstep(0.0, 0.07, f) * (1.0 - smoothstep(0.36, 0.5, f));
  vec3 glow = mix(uA, uB, clamp(f * 2.0, 0.0, 1.0));
  float edge = smoothstep(0.78, 1.0, across);
  float endFade = smoothstep(0.0, 0.05, vUv.x) * (1.0 - smoothstep(0.95, 1.0, vUv.x));
  float pulse = 0.85 + 0.15 * sin(uTime * 7.0);
  vec3 col = vec3(0.03, 0.09, 0.17) + glow * band * 1.5 * pulse + uA * edge * 0.9;
  float a = (0.62 + 0.38 * band + 0.3 * edge) * endFade;
  gl_FragColor = vec4(col, a);
}`;

function questionTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.font = '900 52px Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 8; g.strokeStyle = '#1b2a55'; g.strokeText('?', 32, 36);
  g.fillStyle = '#ffffff'; g.fillText('?', 32, 36);
  const t = new THREE.CanvasTexture(c);
  t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  return t;
}

export class PowerUpVisuals {
  readonly group = new THREE.Group();
  private readonly pads: BoostPad[];
  private readonly padMat: THREE.ShaderMaterial;
  private readonly padGeo: THREE.BufferGeometry | null = null;

  private readonly boxN: number;
  private readonly boxShell: THREE.InstancedMesh;
  private readonly boxCore: THREE.InstancedMesh;
  private readonly boxMark: THREE.InstancedMesh;
  private readonly boxPop: Float32Array;
  private readonly boxWas: Uint8Array;
  private readonly qTex: THREE.CanvasTexture;

  private readonly oilN: number;
  private readonly oilMesh: THREE.InstancedMesh;

  private readonly shields: THREE.Mesh[] = [];
  private readonly shieldMat: THREE.MeshBasicMaterial;
  private readonly shieldGeo: THREE.SphereGeometry;
  private time = 0;
  private readonly disposables: { dispose(): void }[] = [];

  constructor(sim: ISim, carCount: number) {
    this.pads = sim.pads ?? [];
    const boxes = sim.boxes ?? [];
    const oils = sim.oils ?? [];

    // ---- boost pads: one merged quad per pad, one draw call
    this.padMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uLen: { value: 6 },
        uA: { value: new THREE.Color(FX.padColorA) }, uB: { value: new THREE.Color(FX.padColorB) },
      },
      vertexShader: PAD_VERT, fragmentShader: PAD_FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.disposables.push(this.padMat);
    if (this.pads.length) {
      const n = this.pads.length;
      const pos = new Float32Array(n * 4 * 3), uv = new Float32Array(n * 4 * 2), idx: number[] = [];
      this.pads.forEach((p, i) => {
        const dx = Math.cos(p.angle), dy = Math.sin(p.angle), nx = -dy, ny = dx;
        const hl = p.length / 2, hw = p.width / 2, y = 0.075;
        const corner = [[-hl, -hw, 0, 0], [hl, -hw, 1, 0], [hl, hw, 1, 1], [-hl, hw, 0, 1]];
        corner.forEach((c, k) => {
          const o = (i * 4 + k) * 3;
          pos[o] = p.x + dx * c[0] + nx * c[1]; pos[o + 1] = y; pos[o + 2] = p.y + dy * c[0] + ny * c[1];
          uv[(i * 4 + k) * 2] = c[2]; uv[(i * 4 + k) * 2 + 1] = c[3];
        });
        const b = i * 4;
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeBoundingSphere();
      this.padGeo = geo;
      this.padMat.uniforms.uLen.value = this.pads[0].length;
      const mesh = new THREE.Mesh(geo, this.padMat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.disposables.push(geo);
    }

    // ---- item boxes: translucent coloured shell + white core + a flat "?" that always faces the camera
    this.boxN = boxes.length;
    const bs = FX.boxSize;
    const shellGeo = new THREE.BoxGeometry(bs, bs, bs);
    const coreGeo = new THREE.BoxGeometry(bs * 0.55, bs * 0.55, bs * 0.55);
    const markGeo = new THREE.PlaneGeometry(bs * 1.15, bs * 1.15);
    markGeo.rotateX(-Math.PI / 2);
    const shellMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.62, depthWrite: false });
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.qTex = questionTexture();
    const markMat = new THREE.MeshBasicMaterial({ map: this.qTex, transparent: true, depthWrite: false });
    this.boxShell = new THREE.InstancedMesh(shellGeo, shellMat, Math.max(1, this.boxN));
    this.boxCore = new THREE.InstancedMesh(coreGeo, coreMat, Math.max(1, this.boxN));
    this.boxMark = new THREE.InstancedMesh(markGeo, markMat, Math.max(1, this.boxN));
    for (const m of [this.boxShell, this.boxCore, this.boxMark]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = this.boxN;
      this.group.add(m);
    }
    this.boxShell.setColorAt(0, _c.set(0xffffff));
    this.boxShell.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.boxMark.renderOrder = 6;
    this.boxShell.renderOrder = 4;
    this.boxPop = new Float32Array(Math.max(1, this.boxN)).fill(1);
    this.boxWas = new Uint8Array(Math.max(1, this.boxN)).fill(1);
    this.disposables.push(shellGeo, coreGeo, markGeo, shellMat, coreMat, markMat, this.qTex);

    // ---- oil slicks
    this.oilN = oils.length;
    const oilGeo = new THREE.CircleGeometry(1, 24);
    oilGeo.rotateX(-Math.PI / 2);
    const oilMat = new THREE.MeshBasicMaterial({ color: 0x241c3d, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.oilMesh = new THREE.InstancedMesh(oilGeo, oilMat, Math.max(1, this.oilN));
    this.oilMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.oilMesh.frustumCulled = false;
    this.oilMesh.renderOrder = 3;
    this.oilMesh.count = 0;
    this.group.add(this.oilMesh);
    this.disposables.push(oilGeo, oilMat);

    // ---- ram shield bubbles (one per car, shown while shieldT > 0)
    this.shieldGeo = new THREE.SphereGeometry(1, 16, 10);
    this.shieldMat = new THREE.MeshBasicMaterial({ color: FX.shieldColor, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    for (let i = 0; i < carCount; i++) {
      const m = new THREE.Mesh(this.shieldGeo, this.shieldMat);
      m.visible = false; m.frustumCulled = false; m.renderOrder = 7;
      this.shields.push(m);
      this.group.add(m);
    }
    this.disposables.push(this.shieldGeo, this.shieldMat);
  }

  /** Per frame. `poses` are the interpolated car poses (same order as sim.cars). */
  update(dt: number, sim: ISim, poses: CarPose[]): void {
    this.time += dt;
    const T = this.time;
    this.padMat.uniforms.uTime.value = T;

    // ---- boxes
    const boxes = sim.boxes ?? [];
    for (let i = 0; i < this.boxN; i++) {
      const b = boxes[i];
      if (b.ready && !this.boxWas[i]) this.boxPop[i] = 0;          // respawn: pop in
      this.boxWas[i] = b.ready ? 1 : 0;
      let k = 0;
      if (b.ready) { this.boxPop[i] = Math.min(1, this.boxPop[i] + dt * 3.2); const u = this.boxPop[i] - 1; k = 1 + 2.70158 * u * u * u + 1.70158 * u * u; }   // ease-out-back pop-in
      const bob = Math.sin(T * 2.6 + i * 1.7) * FX.boxBob;
      const y = FX.boxHeight + bob;
      _e.set(T * 0.7 + i, T * FX.boxSpin + i, T * 0.5);
      _q.setFromEuler(_e);
      _m.compose(_p.set(b.x, y, b.y), _q, _s.set(k, k, k));
      this.boxShell.setMatrixAt(i, _m);
      _e.set(-T * 0.9, -T * 1.3 + i, T * 0.4);
      _q.setFromEuler(_e);
      _m.compose(_p.set(b.x, y, b.y), _q, _s.set(k, k, k));
      this.boxCore.setMatrixAt(i, _m);
      // "?" stays upright to the camera (flat, spinning slowly around the vertical)
      _q.setFromAxisAngle(UP, Math.sin(T * 1.2 + i) * 0.35);
      _m.compose(_p.set(b.x, y + 0.9, b.y), _q, _s.set(k, k, k));
      this.boxMark.setMatrixAt(i, _m);
      this.boxShell.setColorAt(i, _c.setHSL((T * 0.25 + i * 0.13) % 1, 0.85, 0.6));
    }
    if (this.boxN) {
      this.boxShell.instanceMatrix.needsUpdate = true; this.boxCore.instanceMatrix.needsUpdate = true; this.boxMark.instanceMatrix.needsUpdate = true;
      if (this.boxShell.instanceColor) this.boxShell.instanceColor.needsUpdate = true;
    }

    // ---- oil
    const oils = sim.oils ?? [];
    let n = 0;
    for (let i = 0; i < this.oilN; i++) {
      const o = oils[i];
      if (!o.active) continue;
      const grow = Math.min(1, o.age / 0.18);
      const fade = Math.min(1, (o.life - o.age) / 0.6);
      const r = o.radius * (0.35 + 0.65 * grow) * (0.2 + 0.8 * Math.max(0, fade));
      _e.set(0, i * 2.1, 0);
      _q.setFromEuler(_e);
      _m.compose(_p.set(o.x, 0.085, o.y), _q, _s.set(r * 1.12, 1, r * 0.9));
      this.oilMesh.setMatrixAt(n++, _m);
    }
    this.oilMesh.count = n;
    this.oilMesh.visible = n > 0;
    if (n) this.oilMesh.instanceMatrix.needsUpdate = true;

    // ---- shields
    for (let i = 0; i < this.shields.length; i++) {
      const m = this.shields[i], c = sim.cars[i], p = poses[i];
      const left = c && p ? (c.shieldT ?? 0) : 0;
      if (left <= 0 || !p) { m.visible = false; continue; }
      const blink = left < CONFIG.items.shield.popBlink ? (Math.sin(T * 28) > 0 ? 1 : 0.25) : 1;
      m.visible = true;
      const pulse = 1 + 0.05 * Math.sin(T * 9 + i);
      _qy.setFromAxisAngle(UP, -p.angle);
      m.quaternion.copy(_qy);
      m.position.set(p.x, 0.9, p.y);
      m.scale.set(3.05 * pulse * blink, 1.35 * pulse * blink, 1.75 * pulse * blink);
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.boxShell.dispose(); this.boxCore.dispose(); this.boxMark.dispose(); this.oilMesh.dispose();
    this.group.removeFromParent();
  }
}
