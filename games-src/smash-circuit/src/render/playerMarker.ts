// Player marker: the player is one of eight similar voxel cars, so it gets its own readable overlay.
//  - a dashed white ground ring (dark outline) that pulses hard during the countdown and the first seconds, then settles to a faint ring
//  - a floating chevron above the car (same boost window; it comes back for a moment whenever the player is hit)
//  - a white roof arrow with a dark outline that stays on for the whole race and shows the heading
// Three small meshes, updated from the player pose only; nothing here touches the sim.
import * as THREE from 'three';
import { CONFIG } from '../config';
import { clamp, damp } from './util';

const M = CONFIG.render.marker;

/** Dashed ring in the XZ plane (y = 0): `arcs` segments of `fill` of the period, radius range [inner, outer]. */
function writeRing(pos: Float32Array, inner: number, outer: number, arcs: number, fill: number, steps: number): void {
  let o = 0;
  const period = (Math.PI * 2) / arcs;
  for (let a = 0; a < arcs; a++) {
    for (let k = 0; k <= steps; k++) {
      const t = a * period + (k / steps) * period * fill;
      const c = Math.cos(t), s = Math.sin(t);
      pos[o++] = c * inner; pos[o++] = 0; pos[o++] = s * inner;
      pos[o++] = c * outer; pos[o++] = 0; pos[o++] = s * outer;
    }
  }
}

function ringGeometry(arcs: number, steps: number): THREE.BufferGeometry {
  const perArc = (steps + 1) * 2;
  const pos = new Float32Array(arcs * perArc * 3);
  const idx: number[] = [];
  for (let a = 0; a < arcs; a++) {
    const base = a * perArc;
    for (let k = 0; k < steps; k++) {
      const v = base + k * 2;
      idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 12);
  return g;
}

/** Arrow head pointing +z with a notch at the back (a chevron). Unit size: tip at z = 1. */
function arrowGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 1, -0.95, 0, -0.55, 0, 0, -0.12,
    0, 0, 1, 0, 0, -0.12, 0.95, 0, -0.55,
  ], 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2);
  return g;
}

export class PlayerMarker {
  readonly group = new THREE.Group();
  private ring: THREE.Mesh;
  private ringOutline: THREE.Mesh;
  private chevron: THREE.Mesh;
  private chevronOutline: THREE.Mesh;
  private roof: THREE.Mesh;
  private roofOutline: THREE.Mesh;
  private ringGeo = ringGeometry(10, 5);
  private outlineGeo = ringGeometry(10, 5);
  private arrowGeo = arrowGeometry();
  private mats: THREE.MeshBasicMaterial[] = [];
  private time = 0;
  private boostLeft: number = M.strongSeconds;
  private width = -1;
  /** 0..1 current strength (1 = countdown / first seconds), smoothed; exposed for tests and the debug overlay */
  strength = 1;

  constructor() {
    const mk = (geo: THREE.BufferGeometry, color: number, order: number, depthTest: boolean, offset = false): THREE.Mesh => {
      const m = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, depthTest, side: THREE.DoubleSide, polygonOffset: offset, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
      this.mats.push(m);
      const mesh = new THREE.Mesh(geo, m);
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      this.group.add(mesh);
      return mesh;
    };
    this.ringOutline = mk(this.outlineGeo, 0x0c1018, 4, true, true);
    this.ring = mk(this.ringGeo, 0xffffff, 5, true, true);
    this.roofOutline = mk(this.arrowGeo, 0x0c1018, 6, true, true);
    this.roof = mk(this.arrowGeo, M.roofColor, 7, true, true);
    this.chevronOutline = mk(this.arrowGeo, 0x0c1018, 12, false);
    this.chevron = mk(this.arrowGeo, 0xffffff, 13, false);
    this.setWidth(M.ringWidth);
  }

  /** Raise the marker again for a moment (the player was hit and the eye needs to find the car). */
  ping(seconds = M.pingSeconds): void { this.boostLeft = Math.max(this.boostLeft, seconds); }

  /** New race: full strength for the intro and the first seconds. */
  reset(): void { this.boostLeft = M.strongSeconds; this.strength = 1; this.time = 0; }

  private setWidth(w: number): void {
    if (Math.abs(w - this.width) < 0.04) return;
    this.width = w;
    const R = M.ringRadius;
    writeRing(this.ringGeo.getAttribute('position').array as Float32Array, R - w / 2, R + w / 2, 10, 0.64, 5);
    writeRing(this.outlineGeo.getAttribute('position').array as Float32Array, R - w / 2 - 0.09, R + w / 2 + 0.09, 10, 0.69, 5);
    this.ringGeo.getAttribute('position').needsUpdate = true;
    this.outlineGeo.getAttribute('position').needsUpdate = true;
  }

  /**
   * x, z: player position (three.js ground coordinates), angle: heading (physics radians), hold: true while the countdown runs,
   * mpp: metres per screen pixel (keeps the ring and arrow readable on a phone screen and at speed zoom).
   */
  update(dt: number, x: number, z: number, angle: number, hold: boolean, mpp: number): void {
    this.time += dt;
    if (hold) this.boostLeft = Math.max(this.boostLeft, M.strongSeconds); else this.boostLeft = Math.max(0, this.boostLeft - dt);
    const target = hold ? 1 : clamp(this.boostLeft / 1.2, 0, 1);
    this.strength += (target - this.strength) * damp(10, dt);
    const s = this.strength;

    const w = clamp(5.5 * mpp, M.ringWidth, 0.95);
    this.setWidth(w);
    const pulse = 1 + (0.04 + 0.1 * s) * Math.sin(this.time * (4.5 + 4 * s));
    const R = clamp(pulse, 0.8, 1.3);
    const ringAlpha = M.idleAlpha + (0.95 - M.idleAlpha) * s;
    this.ring.position.set(x, 0.09, z);
    this.ring.scale.set(R, 1, R);
    this.ring.rotation.y = this.time * (0.7 + 1.4 * s);
    this.ringOutline.position.copy(this.ring.position);
    this.ringOutline.scale.copy(this.ring.scale);
    this.ringOutline.rotation.y = this.ring.rotation.y;
    (this.ring.material as THREE.MeshBasicMaterial).opacity = ringAlpha;
    (this.ringOutline.material as THREE.MeshBasicMaterial).opacity = ringAlpha * 0.55;

    // chevron: floats above the car and bobs towards it; only while the marker is boosted
    const cv = s > 0.02;
    this.chevron.visible = this.chevronOutline.visible = cv;
    if (cv) {
      const k = Math.max(1, (30 * mpp) / 1.9);
      const bob = Math.sin(this.time * 7) * 0.35 * k;
      this.chevron.position.set(x, M.arrowHeight, z - 2.7 * k - bob);
      this.chevron.scale.set(0.95 * k, 1, 0.8 * k);
      this.chevronOutline.position.set(x, M.arrowHeight - 0.02, z - 2.7 * k - bob);
      this.chevronOutline.scale.set(1.3 * k, 1, 1.15 * k);
      this.chevron.rotation.y = this.chevronOutline.rotation.y = 0;
      (this.chevron.material as THREE.MeshBasicMaterial).opacity = s;
      (this.chevronOutline.material as THREE.MeshBasicMaterial).opacity = s * 0.6;
    }

    // roof arrow: always on, shows the nose direction (the car body roof top is at y = 1.49)
    const yaw = Math.PI / 2 - angle;
    const rx = x - Math.cos(angle) * 0.42, rz = z - Math.sin(angle) * 0.42;   // the cabin roof is behind the car centre
    this.roof.position.set(rx, 1.56, rz);
    this.roofOutline.position.set(rx, 1.55, rz);
    this.roof.rotation.y = this.roofOutline.rotation.y = yaw;
    this.roof.scale.set(0.42, 1, 0.46);
    this.roofOutline.scale.set(0.56, 1, 0.6);
    (this.roof.material as THREE.MeshBasicMaterial).opacity = 0.92;
    (this.roofOutline.material as THREE.MeshBasicMaterial).opacity = 0.6;
  }

  dispose(): void {
    this.ringGeo.dispose(); this.outlineGeo.dispose(); this.arrowGeo.dispose();
    for (const m of this.mats) m.dispose();
  }
}
