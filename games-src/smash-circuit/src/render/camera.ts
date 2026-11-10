// Orthographic top-down camera: follows the player, frames the ROAD AHEAD (look-ahead sampled along the track spline, not the
// velocity), optionally rotates so the track tangent points up the screen (portrait phones), zooms out with speed and with the
// forward-visibility rule, trauma-based shake. The car never leaves the central ~56% of the screen.
import * as THREE from 'three';
import { CONFIG } from '../config';
import type { TrackGeometry } from '../types';
import { clamp, damp, lerp, wrapAngle } from './util';

const C = CONFIG.render.camera;

export class CameraRig {
  readonly camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 1, 400);
  aspect = 1;
  /** current half view size in metres (x across, z down the screen) */
  halfW = 22; halfH = 22;
  mode: 'follow' | 'menu' = 'follow';
  tilt: number = CONFIG.render.cameraTilt;
  azimuth = 0;
  /** the track the camera reads the road ahead from (null: velocity look-ahead only) */
  track: TrackGeometry | null = null;
  /** heading-up camera wanted (the aspect rule fades it out on landscape screens) */
  rotating = false;
  /** Demolition Arena: minimum zoom (1 = off) so the whole ring is in view; bypasses the readable-car cap */
  arenaZoom = 1;
  /** azimuth applied to the race view (rad); 0 = north-up */
  viewAz = 0;

  private tx = 0; private tz = 0;
  private lx = 0; private lz = 0;
  private fx = 0; private fy = 0;           // smoothed view-centre shift, as a fraction of half the view (screen axes)
  private sHint: number | undefined;
  private fresh = true;
  private glide = 0;
  private lastPx = NaN; private lastPz = NaN; private lastSpeed = 0;
  private vs = 0;                            // smoothed speed (m/s) that sets the look-ahead distance
  private pxW = 0; private pxH = 0;          // canvas CSS size
  private zoom = 1;
  private trauma = 0;
  /** boost zoom: renderer sets boostTarget (0/1) every frame; boostK follows quickly in, slowly out. punchK = one-shot kick. */
  boostTarget = 0;
  private boostK = 0;
  private punchK = 0;
  private time = 0;
  private menuWidth = 10;
  private menuMinHeight = 9.5;
  private menuTarget = new THREE.Vector3(0, 0.6, 0);
  private tmp = new THREE.Vector3();
  private snapped = false;
  /** shake offset applied this frame (m), for debugging */
  shakeX = 0; shakeZ = 0;

  setAspect(a: number): void { this.aspect = a > 0 ? a : 1; }
  /** canvas size in CSS px: the zoom limit keeps the car a readable size on a small screen */
  setViewport(w: number, h: number): void { this.pxW = w; this.pxH = h; }

  /** visible width in metres at rest for the current aspect */
  baseWidth(): number {
    const v = CONFIG.render.viewMetres;
    const t = clamp((this.aspect - C.portraitAspect) / (C.landscapeAspect - C.portraitAspect), 0, 1);
    return lerp(v.portrait, v.landscape, t);
  }

  snap(x: number, z: number): void {
    this.tx = x; this.tz = z; this.lx = 0; this.lz = 0; this.snapped = true; this.zoom = 1; this.trauma = 0; this.boostK = 0; this.punchK = 0;
    this.fresh = true; this.sHint = undefined; this.glide = 0; this.lastPx = NaN; this.vs = 0; this.lastSpeed = 0; this.fx = 0; this.fy = 0;
  }
  get snappedOnce(): boolean { return this.snapped; }
  get target(): { x: number; z: number } { return { x: this.tx, z: this.tz }; }
  get radius(): number { return Math.hypot(this.halfW, this.halfH); }

  /** shake strength multiplier (1 = full; the game lowers it for prefers-reduced-motion) */
  shakeScale = 1;

  addTrauma(t: number): void { this.trauma = clamp(this.trauma + t * this.shakeScale, 0, 1); }

  /** Zoom punch (boost pad / nitro): the view widens by `amount` (fraction) and eases back. */
  addPunch(amount: number): void { this.punchK = Math.min(0.2, this.punchK + amount); }

  setMenu(on: boolean): void { this.mode = on ? 'menu' : 'follow'; }

  update(dt: number, px: number, pz: number, vx: number, vz: number, speedFrac: number, intro: number): void {
    this.time += dt;
    if (this.mode === 'menu') { this.updateMenu(dt); return; }
    const aspect = this.aspect;
    const tilt = this.tilt, cosT = Math.cos(tilt);
    const tr = this.track;

    // ---- teleports (respawn / back-on-track reset): the view glides instead of jumping
    const spNow = Math.hypot(vx, vz);
    if (dt > 0 && !this.fresh && Number.isFinite(this.lastPx)) {
      const step = Math.hypot(px - this.lastPx, pz - this.lastPz);
      if (step > 2.5 + 2 * Math.max(spNow, this.lastSpeed) * dt) { this.glide = C.glideTime; this.sHint = undefined; this.vs = Math.min(this.vs, 12); }
    }
    this.lastPx = px; this.lastPz = pz; this.lastSpeed = spNow;
    this.glide = Math.max(0, this.glide - dt);
    this.vs += (spNow - this.vs) * (this.fresh ? 1 : damp(C.speedSmooth, dt));

    // ---- road ahead, sampled along the spline by a speed-dependent distance
    let sP = 0;
    if (tr) { const n = tr.nearest(px, pz, this.sHint); this.sHint = n.s; sP = n.s; }
    const dFrame = C.lookMin + this.vs * C.lookTime;
    const dNeed = C.needMin + this.vs * C.lookTime;
    let fdx: number, fdz: number, ndx: number, ndz: number;          // world vectors car -> framing point / must-see point
    if (tr) {
      const A = tr.sampleAt(sP + dFrame), N = tr.sampleAt(sP + dNeed);
      fdx = A.x - px; fdz = A.y - pz; ndx = N.x - px; ndz = N.y - pz;
    } else {
      fdx = vx * C.lookTime; fdz = vz * C.lookTime; ndx = fdx; ndz = fdz;
    }

    // ---- azimuth: follow the track tangent (never the car heading: drifts, spins and crashes do not turn the view)
    const fade = 1 - clamp((aspect - C.rotAspectFrom) / (C.rotAspectTo - C.rotAspectFrom), 0, 1);
    const rotW = this.rotating && tr ? fade * fade * (3 - 2 * fade) : 0;
    let azT = 0;
    if (rotW > 0 && tr) {
      const T = tr.sampleAt(sP + C.rotLook * dFrame + 3);
      azT = rotW * Math.atan2(-T.tx, T.ty);
    }
    if (this.fresh) this.viewAz = azT;
    else {
      const d = Math.atan2(Math.sin(azT - this.viewAz), Math.cos(azT - this.viewAz));
      this.viewAz = wrapAngle(this.viewAz + clamp(d * C.rotFollow, -C.rotMaxRate, C.rotMaxRate) * dt);
    }
    const az = this.viewAz, ca = Math.cos(az), sa = Math.sin(az);
    // ground vector -> screen metres (x right, y up, foreshortened by the tilt) and back
    const sx = (dx: number, dz: number): number => dx * ca + dz * sa;
    const sy = (dx: number, dz: number): number => (-dx * sa + dz * ca) * cosT;

    // ---- zoom: speed rule + forward-visibility rule, limited so the car stays readable and the decor / shadow cover the view
    const bw = this.baseWidth();
    const hw0 = bw / 2, hh0 = hw0 / aspect;
    const need = Math.max(Math.abs(sx(ndx, ndz)) / (C.aheadFit * hw0), Math.abs(sy(ndx, ndz)) / (C.aheadFit * hh0));
    const speedZoom = 1 + CONFIG.render.zoomOutAtSpeed * clamp(speedFrac, 0, 1);
    let cap: number = C.zoomMax;
    if (this.pxW > 0) cap = Math.min(cap, this.pxW / (C.minPxPerMetre * bw));
    cap = Math.min(cap, C.maxRadius / Math.hypot(hw0, hh0));
    let zoomTarget = clamp(Math.max(speedZoom, need), 1, Math.max(1, cap)) + C.introZoom * clamp(intro, 0, 1);
    if (this.arenaZoom > 1) zoomTarget = this.arenaZoom;
    this.zoom += (zoomTarget - this.zoom) * (this.fresh ? 1 : damp(zoomTarget > this.zoom ? C.zoomOutFollow : C.zoomFollow, dt));
    const PX = CONFIG.items.fx;
    this.boostK += (this.boostTarget - this.boostK) * damp(this.boostTarget > this.boostK ? PX.zoomIn : PX.zoomOut, dt);
    this.punchK = Math.max(0, this.punchK - PX.punchDecay * this.punchK * dt - 0.0001);
    const halfW = (bw / 2) * this.zoom * (1 + PX.zoomBoost * this.boostK + this.punchK);
    const halfH = halfW / aspect;
    this.halfW = halfW; this.halfH = halfH;

    // ---- view-centre shift towards the road ahead (screen space, so a turning camera does not smear it), clamped
    const tfx = clamp(C.lookGain * sx(fdx, fdz) / halfW, -C.maxShift, C.maxShift);
    const tfy = clamp(C.lookGain * sy(fdx, fdz) / halfH, -C.maxShift, C.maxShift);
    const ks = this.fresh ? 1 : damp(C.shiftSmooth, dt);
    this.fx += (tfx - this.fx) * ks;
    this.fy += (tfy - this.fy) * ks;
    const shX = this.fx * halfW, shY = (this.fy * halfH) / cosT;
    const cdx = px + shX * ca - shY * sa, cdz = pz + shX * sa + shY * ca;
    if (this.fresh) { this.tx = cdx; this.tz = cdz; }
    const f = damp(this.glide > 0 ? C.glideFollow : C.follow, dt);
    this.tx += (cdx - this.tx) * f;
    this.tz += (cdz - this.tz) * f;
    this.fresh = false;

    // hard safety: the car stays inside the central box whatever happened (relaxed while gliding after a teleport)
    {
      const lim = C.safeEdge + (this.glide / C.glideTime) * 100;
      const ex = px - this.tx, ez = pz - this.tz;
      const cx = clamp(sx(ex, ez), -lim * halfW, lim * halfW), cy = clamp(sy(ex, ez), -lim * halfH, lim * halfH);
      const u = cy / cosT;
      this.tx = px - (cx * ca - u * sa);
      this.tz = pz - (cx * sa + u * ca);
    }

    // shake
    this.trauma = Math.max(0, this.trauma - C.shakeDecay * dt);
    const amp = this.trauma * this.trauma * C.shakeMax;
    const t = this.time;
    this.shakeX = amp * (Math.sin(t * 41.3) + Math.sin(t * 67.1 + 1.7)) * 0.5;
    this.shakeZ = amp * (Math.sin(t * 47.9 + 0.4) + Math.sin(t * 59.3 + 2.9)) * 0.5;

    this.apply(this.tx + this.shakeX, 0, this.tz + this.shakeZ, halfW, halfH, this.tilt, az);
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

  /** NDC (-1..1, y up) of a ground point given in scene coordinates (physics x, y), from the last applied camera. Debug / tests. */
  project(x: number, z: number, h = 0.6): { x: number; y: number } {
    this.tmp.set(x, h, -z).project(this.camera);
    return { x: this.tmp.x, y: this.tmp.y };
  }

  setMenuView(width: number, target: THREE.Vector3): void { this.menuWidth = width; this.menuTarget.copy(target); }
}
