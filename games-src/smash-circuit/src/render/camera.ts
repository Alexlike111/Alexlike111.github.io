// Orthographic top-down camera: follows the player with velocity look-ahead, zooms out with speed, trauma-based shake.
import * as THREE from 'three';
import { CONFIG } from '../config';
import { clamp, damp, lerp } from './util';

const C = CONFIG.render.camera;

export class CameraRig {
  readonly camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 1, 400);
  aspect = 1;
  /** current half view size in metres (x across, z down the screen) */
  halfW = 22; halfH = 22;
  mode: 'follow' | 'menu' = 'follow';
  tilt: number = CONFIG.render.cameraTilt;
  azimuth = 0;

  private tx = 0; private tz = 0;
  private lx = 0; private lz = 0;
  private zoom = 1;
  private trauma = 0;
  private time = 0;
  private menuWidth = 10;
  private menuMinHeight = 9.5;
  private menuTarget = new THREE.Vector3(0, 0.6, 0);
  private tmp = new THREE.Vector3();
  private snapped = false;
  /** shake offset applied this frame (m), for debugging */
  shakeX = 0; shakeZ = 0;

  setAspect(a: number): void { this.aspect = a > 0 ? a : 1; }

  /** visible width in metres at rest for the current aspect */
  baseWidth(): number {
    const v = CONFIG.render.viewMetres;
    const t = clamp((this.aspect - C.portraitAspect) / (C.landscapeAspect - C.portraitAspect), 0, 1);
    return lerp(v.portrait, v.landscape, t);
  }

  snap(x: number, z: number): void { this.tx = x; this.tz = z; this.lx = 0; this.lz = 0; this.snapped = true; this.zoom = 1; this.trauma = 0; }
  get snappedOnce(): boolean { return this.snapped; }
  get target(): { x: number; z: number } { return { x: this.tx, z: this.tz }; }
  get radius(): number { return Math.hypot(this.halfW, this.halfH); }

  addTrauma(t: number): void { this.trauma = clamp(this.trauma + t, 0, 1); }

  setMenu(on: boolean): void { this.mode = on ? 'menu' : 'follow'; }

  update(dt: number, px: number, pz: number, vx: number, vz: number, speedFrac: number, intro: number): void {
    this.time += dt;
    if (this.mode === 'menu') { this.updateMenu(dt); return; }
    const aspect = this.aspect;
    const zoomTarget = 1 + CONFIG.render.zoomOutAtSpeed * clamp(speedFrac, 0, 1) + C.introZoom * clamp(intro, 0, 1);
    this.zoom += (zoomTarget - this.zoom) * damp(C.zoomFollow, dt);
    const halfW = (this.baseWidth() / 2) * this.zoom;
    const halfH = halfW / aspect;
    this.halfW = halfW; this.halfH = halfH;
    // smoothed look-ahead
    const k = damp(C.lookAheadSmooth, dt);
    this.lx += (vx * CONFIG.render.lookAhead - this.lx) * k;
    this.lz += (vz * CONFIG.render.lookAhead - this.lz) * k;
    const lax = clamp(this.lx, -halfW * C.lookAheadMaxX, halfW * C.lookAheadMaxX);
    const laz = clamp(this.lz, -halfH * C.lookAheadMaxY, halfH * C.lookAheadMaxY);
    const f = damp(C.follow, dt);
    this.tx += (px + lax - this.tx) * f;
    this.tz += (pz + laz - this.tz) * f;

    // shake
    this.trauma = Math.max(0, this.trauma - C.shakeDecay * dt);
    const amp = this.trauma * this.trauma * C.shakeMax;
    const t = this.time;
    this.shakeX = amp * (Math.sin(t * 41.3) + Math.sin(t * 67.1 + 1.7)) * 0.5;
    this.shakeZ = amp * (Math.sin(t * 47.9 + 0.4) + Math.sin(t * 59.3 + 2.9)) * 0.5;

    this.apply(this.tx + this.shakeX, 0, this.tz + this.shakeZ, halfW, halfH, this.tilt, 0);
  }

  private apply(x: number, y: number, z: number, halfW: number, halfH: number, tilt: number, az: number): void {
    const cam = this.camera;
    cam.left = -halfW; cam.right = halfW;
    // foreshortening: a tilted ortho camera sees more ground per screen unit vertically
    const fore = 1 / Math.cos(tilt);
    cam.top = halfH; cam.bottom = -halfH;
    cam.updateProjectionMatrix();
    const H = CONFIG.render.cameraHeight;
    // x, z are scene-local; the scene is mirrored along z (renderer.ts), so the camera works in world z = -z
    const wz = -z;
    cam.position.set(x + Math.sin(az) * H * Math.sin(tilt), y + H * Math.cos(tilt), wz + Math.cos(az) * H * Math.sin(tilt));
    cam.lookAt(this.tmp.set(x, y, wz));
    cam.updateMatrixWorld();
    void fore;
  }

  /** menu: slow orbit around the hero car */
  private updateMenu(dt: number): void {
    this.azimuth += dt * 0.28;
    const w = Math.max(this.menuWidth, this.menuMinHeight * this.aspect);
    const halfW = w / 2, halfH = halfW / this.aspect;
    this.halfW = halfW; this.halfH = halfH;
    const az = Math.sin(this.azimuth * 0.55) * 0.9 + 0.5;
    this.apply(this.menuTarget.x, this.menuTarget.y, this.menuTarget.z, halfW, halfH, 0.92, az);
  }

  setMenuView(width: number, target: THREE.Vector3): void { this.menuWidth = width; this.menuTarget.copy(target); }
}
