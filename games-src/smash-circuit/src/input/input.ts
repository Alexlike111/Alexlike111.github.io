// Keyboard + touch input. Touch has six schemes (src/input/schemes.ts; settings "Controls"), all with automatic gas:
//   point    (default) a floating stick under the thumb: the car turns toward the SCREEN direction the thumb points; BRAKE + item on the right
//   buttons  big left / right steer buttons, BRAKE + item on the right
//   slide    drag a thumb sideways on the left half, buttons on the right
//   joystick a FIXED stick centred at the bottom of the screen (sideways steers, pull down brakes / reverses)
//   tilt     steer by tilting the phone (DeviceOrientation: gamma in portrait, beta in landscape) + a live indicator
//   tap      hold the left / right half of the screen to steer, both = brake
//
// Drift (src/sim/drift.ts) is automatic on touch: a hard steer (>= CONFIG.controls.driftSteer) above ~60 km/h starts it; the
// digital schemes (buttons, tap) need the steer held for driftHoldS first. Keyboard: WASD / arrows, Space = handbrake / drift,
// P = pause, M = mute, R = repair. Esc is never bound (Playgama 1.5.2, checked by scripts/check-release.mjs).
import { CONFIG } from '../config';
import { DRIFT_AUTO, DRIFT_HOLD, DRIFT_NONE } from '../sim/drift';
import type { CarInput } from '../types';
import {
  ALL_SCHEMES, PointController, boxRect, driftRequest, followHome, joyGeom, pointLeash, pointRadius, pointZone, slideAxis, slideFullPx,
  steerZone, stickAxis, tiltAxis, tiltSteerDeg, touchLayout,
  type BtnName, type ControlScheme, type PointCar,
} from './schemes';

type KeyAction = 'pause' | 'repair' | 'item' | 'mute';
type PointerKind = 'brake' | 'sbtn' | 'slide' | 'tap' | 'point';

/** What the Point scheme needs from the game each frame: the player's car and the camera (null before a race). `screen` = the car in px. */
export type PointSource = () => (PointCar & { screen: { x: number; y: number } | null }) | null;

interface Ptr { kind: PointerKind; startX?: number; startY?: number; x: number; y: number; homeX: number; homeY: number; size: number; flicked?: boolean; pullT?: number }

const C = CONFIG.controls;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Y (px) below which a finger that started at `homeY` counts as "pulled down": brake / reverse. */
export function brakeThresholdY(homeY: number, size: number): number {
  return homeY + C.brakePull * size;
}

/** Layout of the GAS button for a viewport: centre Y (px from the top) and button size (px). */
export function gasButtonGeometry(w: number, h: number): { cx: number; cy: number; size: number } {
  const m = Math.min(w, h);
  const size = m * C.gasButtonSize;
  const gap = m * C.buttonMargin;
  return { cx: w - gap - size / 2, cy: h - gap - size / 2, size };
}

/**
 * Steering axis from a finger x. DECISION (the contract text says "relative to screen centre", which is ambiguous for
 * a thumb that rests on a bottom-right button): the reference is the finger's HOME position:
 *  - a finger that went down on the GAS button: the GAS button centre (so resting the thumb on the button = straight),
 *  - any other steering finger (auto-gas, or touching outside the buttons): the screen centre.
 * Dead zone and full-lock distance are fractions of the screen width (CONFIG.controls). A finger on the GAS button
 * has little room to the right, so its full lock is reached before the screen edge.
 */
export function steerAxis(x: number, homeX: number, screenW: number, onGasButton: boolean, size?: number): number {
  const W = Math.max(1, screenW);
  const dx = (x - homeX) / W;
  let full: number = C.steerFullAt;
  let dead: number = C.steerDeadZone;
  if (onGasButton && size) {
    // GAS finger: home is where the thumb landed; a dead band of ~0.25 button sizes around it (smaller when the
    // landing is close to the right edge so that side stays reachable)
    const px = clamp(0.6 * (W - homeX), C.gasDeadBandMin * size, C.gasDeadBand * size);
    dead = Math.max(dead, px / W);
  }
  if (onGasButton) {
    // the thumb has little room to the right of the button: full lock comes before the edge, and the same distance
    // to the left (symmetric feel: the same slide gives the same turn either way)
    const room = (W - homeX) / W * 0.8;
    full = Math.min(full, Math.max(dead + 0.02, room));
  }
  const mag = clamp((Math.abs(dx) - dead) / (full - dead), 0, 1);
  // response curve: more authority at small finger offsets (one-finger play), full lock stays at the same distance
  return mag === 0 ? 0 : Math.sign(dx) * Math.pow(mag, C.touchSteerCurve);
}

const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyP', 'KeyR',
  'KeyE', 'ShiftLeft', 'ShiftRight',   // use item
  'KeyM',                              // mute
]);

/**
 * Auto-gas / steering-finger brake gesture (pure, tested): the finger must stay below the brake line for
 * `pullHold` seconds; a slow downward creep drags the home Y along and upward moves re-anchor it, so only a
 * deliberate pull brakes. Returns whether this finger brakes now; mutates `p.homeY` / `p.pullT`.
 */
export function stepPull(p: { y: number; homeY: number; size: number; pullT?: number }, dt: number): boolean {
  if (p.y < p.homeY) p.homeY = p.y;
  else if (p.y <= brakeThresholdY(p.homeY, p.size)) p.homeY += Math.min(p.y - p.homeY, C.homeYDrift * p.size * dt);
  if (p.y > brakeThresholdY(p.homeY, p.size)) p.pullT = (p.pullT ?? 0) + dt;
  else p.pullT = 0;
  return (p.pullT ?? 0) >= C.pullHold;
}

export type TiltStatus = 'ok' | 'denied' | 'unavailable';

export class InputController {
  private root: HTMLElement;
  private keys = new Set<string>();
  private pointers = new Map<number, Ptr>();
  private enabled = false;
  private scheme: ControlScheme = 'buttons';
  private sens = 1;
  private _touch = false;
  private keyCb: ((k: KeyAction) => void) | null = null;
  private touchCb: ((touch: boolean) => void) | null = null;
  private tiltCb: ((s: TiltStatus) => void) | null = null;
  private kbSteer = 0;
  private btnSteer = 0;
  private lastT = 0;
  // tilt
  private tiltRaw: { beta: number; gamma: number } | null = null;
  private tiltCenter: { beta: number; gamma: number; ang: number } | null = null;
  private tiltAng = 0;
  private tiltSteer = 0;
  private digHeld = 0;      // s a digital steer has been held in one direction (auto drift)
  private digDir = 0;
  private tiltSeen = false;
  private tiltTimer = 0;
  private tiltOn = false;
  // point scheme
  private pointCtl = new PointController();
  private pointSrc: PointSource | null = null;
  private pointVis: { bx: number; by: number; fx: number; fy: number } | null = null;
  // geometry caches
  private boundary = 0;

  private layer: HTMLDivElement;
  private brakeEl: HTMLDivElement;
  private steerLEl: HTMLDivElement;
  private steerREl: HTMLDivElement;
  private stickEl: HTMLDivElement;
  private knobEl: HTMLDivElement;
  private tiltEl: HTMLDivElement;
  private tiltDot: HTMLElement;
  private zoneL: HTMLDivElement;
  private zoneR: HTMLDivElement;
  private pointEl: HTMLDivElement;
  private pointKnob: HTMLElement;
  private pointArrow: HTMLDivElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this._touch = InputController.detectTouchDevice();

    this.layer = document.createElement('div');
    this.layer.className = 'touch-layer';
    this.layer.hidden = true;
    const mk = (cls: string, html: string): HTMLDivElement => {
      const e = document.createElement('div');
      e.className = cls;
      e.setAttribute('role', 'button');
      e.innerHTML = html;
      return e;
    };
    this.brakeEl = mk('brake-btn', '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="14" y="14" width="36" height="36" rx="8" fill="currentColor"/></svg><span data-brake-label></span>');
    const arrow = (d: string): string => `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    this.steerLEl = mk('steer-btn left', arrow('M40 12 20 32l20 20'));
    this.steerLEl.setAttribute('aria-label', 'left');
    this.steerREl = mk('steer-btn right', arrow('M24 12l20 20-20 20'));
    this.steerREl.setAttribute('aria-label', 'right');
    this.tiltEl = document.createElement('div');
    this.tiltEl.className = 'tilt-ind';
    this.tiltEl.innerHTML = '<i class="tz"></i><i class="tc"></i><b class="td"></b>';
    this.tiltDot = this.tiltEl.querySelector('.td') as HTMLElement;
    this.stickEl = document.createElement('div');
    this.stickEl.className = 'stick idle';
    this.knobEl = document.createElement('div');
    this.knobEl.className = 'stick-knob';
    this.stickEl.appendChild(this.knobEl);
    this.zoneL = document.createElement('div');
    this.zoneL.className = 'tap-zone l';
    this.zoneL.innerHTML = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M40 10 18 32l22 22" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    this.zoneR = document.createElement('div');
    this.zoneR.className = 'tap-zone r';
    this.zoneR.innerHTML = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M24 10l22 22-22 22" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    this.pointEl = document.createElement('div');
    this.pointEl.className = 'point-ring idle';
    this.pointEl.innerHTML = '<i class="pk"></i>';
    this.pointKnob = this.pointEl.querySelector('.pk') as HTMLElement;
    this.pointArrow = document.createElement('div');
    this.pointArrow.className = 'point-arrow';
    this.pointArrow.hidden = true;
    this.pointArrow.innerHTML = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 6 52 40 32 31 12 40z" fill="currentColor" stroke="#0b1430" stroke-width="3.5" stroke-linejoin="round"/></svg>';
    for (const e of [this.stickEl, this.zoneL, this.zoneR, this.tiltEl, this.pointEl, this.pointArrow]) e.setAttribute('aria-hidden', 'true');
    this.layer.append(this.zoneL, this.zoneR, this.stickEl, this.pointEl, this.pointArrow, this.tiltEl, this.brakeEl, this.steerLEl, this.steerREl);
    root.appendChild(this.layer);

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.reset);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset(); });
    window.addEventListener('pointerdown', this.onDown, { passive: false });
    window.addEventListener('pointermove', this.onMove, { passive: true });
    window.addEventListener('pointerup', this.onUp, { passive: true });
    window.addEventListener('pointercancel', this.onUp, { passive: true });
    window.addEventListener('resize', this.layout);
    this.layout();
    this.syncLayer();
  }

  // ----------------------------------------------------------------- public API

  getInput(): CarInput {
    const now = performance.now();
    const dt = this.lastT ? Math.min(0.1, (now - this.lastT) / 1000) : 0;
    this.lastT = now;
    if (!this.enabled) return { throttle: 0, brake: 0, steer: 0, handbrake: false };

    const W = Math.max(1, window.innerWidth), H = Math.max(1, window.innerHeight);
    const scheme = this.scheme;

    // --- keyboard
    const k = this.keys;
    const kbThrottle = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    const kbBrake = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
    const left = k.has('KeyA') || k.has('ArrowLeft'), right = k.has('KeyD') || k.has('ArrowRight');
    const kbTarget = (right ? 1 : 0) - (left ? 1 : 0);
    const rate = kbTarget === 0 || Math.sign(kbTarget) !== Math.sign(this.kbSteer) && this.kbSteer !== 0 ? C.keySteerReturn : C.keySteerRise;
    const maxStep = rate * dt;
    this.kbSteer += clamp(kbTarget - this.kbSteer, -maxStep, maxStep);
    const handbrake = k.has('Space');

    // --- touch
    let tBrake = 0, tSteer = 0, steerSet = false;
    let sL = false, sR = false, tapL = false, tapR = false, stickP: Ptr | null = null, pointP: Ptr | null = null;
    for (const p of this.pointers.values()) {
      if (p.kind === 'point') { pointP = p; continue; }
      if (p.kind === 'brake') { tBrake = 1; continue; }
      if (p.kind === 'sbtn') { if (p.x < this.boundary) sL = true; else sR = true; continue; }
      if (p.kind === 'tap') { if (p.x < W / 2) tapL = true; else tapR = true; continue; }
      if (p.kind === 'slide') {
        stickP = p;
        if (scheme === 'joystick') {
          const R = joyGeom(W, H).r;
          tSteer = stickAxis(p.x - p.homeX, R / this.sens, R * C.joyDead);
          if (p.y - p.homeY > R * C.joyBrakePull) tBrake = 1;   // pulled down past the brake line (fixed stick: no re-anchoring)
        } else {
          p.homeX = followHome(p.x, p.homeX, slideFullPx(this.sens));
          tSteer = slideAxis(p.x, p.homeX, this.sens);
        }
        steerSet = true;
        continue;
      }
    }

    // point: the car turns toward the screen direction of the thumb (the game supplies the car and the camera azimuth)
    let pointDrift = false;
    if (scheme === 'point') {
      const R = pointRadius(W, H);
      const car = this.pointSrc ? this.pointSrc() : null;
      if (pointP) {
        const b = pointLeash(pointP.x, pointP.y, pointP.homeX, pointP.homeY, R);
        pointP.homeX = b.x; pointP.homeY = b.y;
        this.pointVis = { bx: b.x, by: b.y, fx: pointP.x, fy: pointP.y };
      }
      const o = this.pointCtl.update(!!pointP, pointP ? pointP.x - pointP.homeX : 0, pointP ? pointP.y - pointP.homeY : 0, R, dt, car, this.sens);
      if (pointP || o.aim) { tSteer = o.steer; steerSet = true; pointDrift = o.drift; }
      if (!pointP && !o.aim) this.pointVis = null;
      this.drawPoint(pointP !== null, o.aim, car, W, H, R);
    }

    // digital steering (buttons / two-side tap): ramps to full lock in ~0.1 s
    let btnTarget = 0;
    if (scheme === 'buttons') btnTarget = (sR ? 1 : 0) - (sL ? 1 : 0);
    else if (scheme === 'tap') {
      if (tapL && tapR) tBrake = 1; else btnTarget = (tapR ? 1 : 0) - (tapL ? 1 : 0);
    }
    // auto drift: how long a digital steer has been held in one direction
    const dDir = Math.sign(btnTarget);
    if (dDir !== 0 && dDir === this.digDir) this.digHeld += dt; else { this.digHeld = 0; this.digDir = dDir; }
    if (btnTarget === 0) {
      const bRate = C.buttonSteerReturn;
      this.btnSteer += clamp(-this.btnSteer, -bRate * dt, bRate * dt);
    } else {
      // touch-down jumps to the tap steer (scaled by sensitivity), a hold then ramps to full lock (sensitivity never caps it)
      const tap = btnTarget * Math.min(1, C.buttonTapSteer * this.sens);
      if (Math.sign(this.btnSteer) !== btnTarget || Math.abs(this.btnSteer) < Math.abs(tap)) this.btnSteer = tap;
      const up = (1 - C.buttonTapSteer) / C.buttonRampS * dt;
      this.btnSteer += clamp(btnTarget - this.btnSteer, -up, up);
    }
    if (Math.abs(this.btnSteer) < 1e-3 && btnTarget === 0) this.btnSteer = 0;

    // tilt
    if (scheme === 'tilt' && this.tiltRaw !== null && this.tiltCenter !== null) {
      const deg = tiltSteerDeg(this.tiltRaw.beta, this.tiltRaw.gamma, this.tiltCenter.beta, this.tiltCenter.gamma, this.tiltAng);
      this.tiltSteer += (tiltAxis(deg * this.sens) - this.tiltSteer) * Math.min(1, C.tiltSmooth * dt);
    } else this.tiltSteer = 0;

    let throttle = kbThrottle;
    const brake = Math.max(kbBrake, tBrake);
    if (this._touch) throttle = 1;   // gas is automatic on touch devices: keyboard / mouse play keeps manual gas
    if (brake > 0) throttle = 0;     // braking always cancels gas

    const tiltUse = scheme === 'tilt' && this.kbSteer === 0 && kbTarget === 0 && !steerSet && this.btnSteer === 0;
    let steer: number, rawTouch = 0, digital = false;
    // sensitivity already scaled the throw of each source (slide / stick / tilt / button tap), so full lock is always reachable
    if (steerSet) { steer = tSteer; rawTouch = tSteer; }
    else if (this.btnSteer !== 0) { steer = this.btnSteer; rawTouch = this.btnSteer; digital = true; }
    else if (tiltUse) { steer = this.tiltSteer; rawTouch = this.tiltSteer; }
    else steer = this.kbSteer;

    this.brakeEl.classList.toggle('down', tBrake > 0 && this.brakeEl.offsetParent !== null);
    this.steerLEl.classList.toggle('down', sL);
    this.steerREl.classList.toggle('down', sR);
    this.zoneL.classList.toggle('down', tapL);
    this.zoneR.classList.toggle('down', tapR);
    this.drawTilt(scheme === 'tilt');
    this.drawStick(stickP, W, H);
    // touch steering: a hard steer asks for an auto drift (the sim decides on speed); there is no DRIFT button
    const drift = this._touch && rawTouch !== 0 && (scheme === 'point' ? pointDrift : driftRequest(rawTouch, this.digHeld, digital)) ? DRIFT_AUTO : DRIFT_NONE;
    return { throttle, brake, steer: clamp(steer, -1, 1), handbrake, drift };
  }

  get controlScheme(): ControlScheme { return this.scheme; }

  setScheme(s: ControlScheme): void {
    if (this.scheme === s) return;
    this.scheme = s;
    this.pointers.clear();
    this.btnSteer = 0;
    this.pointCtl.reset(); this.pointVis = null;
    this.syncLayer();
    this.layout();
    this.setupTilt();
  }

  /** Point scheme: where the player's car and the camera azimuth come from (set once by the game). */
  setPointSource(src: PointSource | null): void { this.pointSrc = src; }

  /** Steering sensitivity multiplier (settings slider). */
  setSensitivity(v: number): void { this.sens = clamp(v, C.sensMin, C.sensMax); }

  /** Tilt: take the current phone angle as the straight-ahead position. */
  recenter(): void {
    this.tiltCenter = this.tiltRaw ? { ...this.tiltRaw, ang: this.tiltAng } : null;
    this.tiltSteer = 0;
  }

  /** Tilt scheme feedback: 'ok' once events arrive, 'denied' / 'unavailable' when the game should fall back to Buttons. */
  onTiltStatus(cb: (s: TiltStatus) => void): void { this.tiltCb = cb; }

  setEnabled(on: boolean): void {
    if (this.enabled === on) return;
    this.enabled = on;
    this.reset();
    if (on) this.recenter();
    this.syncLayer();
  }

  onKey(cb: (k: KeyAction) => void): void { this.keyCb = cb; }

  /** Called when the active scheme flips between touch and keyboard/mouse (tutorial text, hints). */
  onTouchMode(cb: (touch: boolean) => void): void { this.touchCb = cb; }

  /** Label text of the BRAKE button (already translated). */
  setLabels(brake: string): void {
    const b = this.brakeEl.querySelector('[data-brake-label]');
    if (b) b.textContent = brake;
  }

  /** Accessible names of the two steer buttons. */
  setSteerLabels(l: string, r: string): void {
    this.steerLEl.setAttribute('aria-label', l);
    this.steerREl.setAttribute('aria-label', r);
  }

  get touchActive(): boolean { return this._touch; }

  /** Force the touch scheme on/off (debug, previews, platforms that report the device type). */
  setTouchActive(on: boolean): void { this.setTouch(on); }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.reset);
    window.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    window.removeEventListener('resize', this.layout);
    window.removeEventListener('deviceorientation', this.onOrient);
    window.clearTimeout(this.tiltTimer);
    this.layer.remove();
  }

  // ----------------------------------------------------------------- internals

  private static detectTouchDevice(): boolean {
    try {
      const m = window.matchMedia;
      if (!m) return false;
      return m('(any-pointer: coarse)').matches && !m('(any-pointer: fine)').matches;
    } catch { return false; }
  }

  private setupTilt(): void {
    window.clearTimeout(this.tiltTimer);
    const want = this.scheme === 'tilt';
    if (!want) {
      if (this.tiltOn) window.removeEventListener('deviceorientation', this.onOrient);
      this.tiltOn = false;
      this.tiltRaw = null; this.tiltCenter = null; this.tiltSteer = 0;
      this.drawTilt(false);
      return;
    }
    this.tiltSeen = false;
    const attach = (): void => {
      if (this.scheme !== 'tilt') return;
      if (!this.tiltOn) window.addEventListener('deviceorientation', this.onOrient);
      this.tiltOn = true;
      if (!this._touch) return;
      this.tiltTimer = window.setTimeout(() => { if (this.scheme === 'tilt' && !this.tiltSeen) this.tiltCb?.('unavailable'); }, C.tiltCheckMs);
    };
    // iOS 13+: the permission prompt needs a user gesture; the Controls picker click that selected Tilt is one
    const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      try {
        // an explicit 'denied' falls back at once; a rejected call (no user gesture / not iOS) just waits for events like any browser
        DOE.requestPermission().then((r) => { if (r === 'granted') attach(); else this.tiltCb?.('denied'); }, () => attach());
      } catch { attach(); }
    } else if (typeof window.DeviceOrientationEvent === 'undefined') {
      if (this._touch) this.tiltCb?.('unavailable');
    } else attach();
  }

  private onOrient = (e: DeviceOrientationEvent): void => {
    if (e.beta == null || e.gamma == null) return;
    const ang = typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.angle === 'number' ? screen.orientation.angle : (window.innerWidth > window.innerHeight ? 90 : 0);
    this.tiltAng = ang;
    this.tiltRaw = { beta: e.beta, gamma: e.gamma };
    // first reading, or the phone was rotated to another screen orientation: calibrate to the current pose
    if (this.tiltCenter === null || this.tiltCenter.ang !== ang) this.tiltCenter = { ...this.tiltRaw, ang };
    if (!this.tiltSeen) { this.tiltSeen = true; this.tiltCb?.('ok'); }
  };

  private syncLayer(): void {
    const showLayer = this.enabled && this._touch;
    const s = this.scheme;
    this.layer.hidden = !showLayer;
    this.root.classList.add('sch-new');
    for (const n of ALL_SCHEMES) this.root.classList.toggle('sch-' + n, n === s);
    this.steerLEl.hidden = this.steerREl.hidden = s !== 'buttons';
    this.brakeEl.hidden = s === 'joystick' || s === 'tap';
    this.tiltEl.hidden = s !== 'tilt';
    this.stickEl.hidden = s !== 'slide' && s !== 'joystick';
    this.stickEl.classList.toggle('slide', s === 'slide');
    this.zoneL.hidden = this.zoneR.hidden = s !== 'tap';
    this.pointEl.hidden = s !== 'point';
    if (s !== 'point') this.pointArrow.hidden = true;
  }

  private place(el: HTMLElement, b: ReturnType<typeof touchLayout>[BtnName]): void {
    const st = el.style;
    if (!b) { st.removeProperty('left'); st.removeProperty('right'); st.removeProperty('bottom'); st.removeProperty('width'); st.removeProperty('height'); return; }
    const sa = b.side === 'l' ? 'left' : 'right';
    st.left = st.right = 'auto';
    st.setProperty(sa, `calc(${b.off.toFixed(1)}px + env(safe-area-inset-${sa}, 0px))`);
    st.bottom = `calc(${b.b.toFixed(1)}px + env(safe-area-inset-bottom, 0px))`;
    st.width = st.height = '';
    st.width = b.w.toFixed(1) + 'px';
    st.height = b.h.toFixed(1) + 'px';
  }

  private layout = (): void => {
    const W = window.innerWidth, H = window.innerHeight;
    const m = Math.min(W, H);
    const s = this.layer.style;
    s.setProperty('--brake', Math.round(m * C.brakeButtonSize) + 'px');
    s.setProperty('--gap', Math.round(m * C.buttonMargin) + 'px');
    s.setProperty('--joy', Math.round(joyGeom(W, H).r * 2) + 'px');
    const L = touchLayout(W, H, this.scheme);
    this.place(this.steerLEl, L.steerL);
    this.place(this.steerREl, L.steerR);
    this.place(this.brakeEl, L.brake);
    if (L.brake) s.setProperty('--brake', Math.round(L.brake.w) + 'px');
    if (L.steerL) s.setProperty('--steer', Math.round(L.steerL.w) + 'px');
    // the item slot lives in the HUD layer: it follows the scheme through CSS variables on the UI root
    const r = this.root.style;
    if (L.item) {
      r.setProperty('--it-s', L.item.w.toFixed(1) + 'px');
      r.setProperty('--it-off', L.item.off.toFixed(1) + 'px');
      r.setProperty('--it-b', L.item.b.toFixed(1) + 'px');
    }
    let btnTop = 0;
    for (const k of ['steerL', 'steerR', 'brake'] as BtnName[]) { const b = L[k]; if (b && b.b < 0.2 * H) btnTop = Math.max(btnTop, b.b + b.h); }
    r.setProperty('--btn-top', btnTop.toFixed(0) + 'px');
    // joystick: the speed readout / drift meter sit above the stick (px from the bottom edge)
    const jg = joyGeom(W, H);
    r.setProperty('--joy-top', (H - jg.cy + jg.r).toFixed(0) + 'px');
    r.setProperty('--tut-pad', this.tutorialClearance(L, W, H).toFixed(0) + 'px');
    if (L.steerL && L.steerR) this.boundary = boxRect(L.steerL, W, H).x + L.steerL.w + (L.steerR.off - L.steerL.off - L.steerL.w) / 2;
  };

  /** Height (px from the bottom edge) the first-run hint sheet must stay above, so it never covers a button. */
  private tutorialClearance(L: ReturnType<typeof touchLayout>, W: number, H: number): number {
    let top = 0;
    for (const b of Object.values(L)) if (b) top = Math.max(top, b.b + b.h);
    if (this.scheme === 'joystick') { const jg = joyGeom(W, H); top = Math.max(top, H - jg.cy + jg.r); }
    return top + Math.max(8, 0.03 * Math.min(W, H));
  }

  /** Joystick: fixed ring, always visible, the knob follows the thumb. Slide: floats under the thumb, rests (dim) at the bottom left. */
  private drawStick(p: Ptr | null, W: number, H: number): void {
    if (this.scheme !== 'slide' && this.scheme !== 'joystick') return;
    const el = this.stickEl;
    if (this.scheme === 'joystick') {
      const g = joyGeom(W, H);
      let kx = 0, ky = 0;
      if (p) {
        kx = p.x - g.cx; ky = clamp(p.y - g.cy, -g.r * 0.6, g.r);
        const m = Math.hypot(kx, ky);
        if (m > g.r) { kx *= g.r / m; ky *= g.r / m; }
      }
      el.classList.remove('idle'); el.classList.toggle('held', !!p);
      el.style.width = el.style.height = g.r * 2 + 'px';
      el.style.transform = `translate(${(g.cx - g.r).toFixed(1)}px, ${(g.cy - g.r).toFixed(1)}px)`;
      this.knobEl.style.transform = `translate(${kx.toFixed(1)}px, ${ky.toFixed(1)}px)`;
      return;
    }
    const R = slideFullPx(this.sens);
    let cx: number, cy: number, kx = 0;
    if (p) { cx = p.homeX; cy = p.startY ?? p.homeY; kx = clamp(p.x - p.homeX, -R, R); }
    else { cx = W * 0.27; cy = H - Math.min(W, H) * 0.3; }
    el.classList.toggle('idle', !p); el.classList.remove('held');
    const sz = R * 2 + 28;
    el.style.width = sz + 'px'; el.style.height = '';
    el.style.transform = `translate(${(cx - sz / 2).toFixed(1)}px, ${(cy - 26).toFixed(1)}px)`;
    this.knobEl.style.transform = `translate(${kx.toFixed(1)}px, 0px)`;
  }

  /**
   * Point scheme: the ring floats under the thumb (dim and dashed at rest in the lower left), the knob follows the finger inside the
   * ring, and a chevron on the car shows the heading being asked for (the aim direction on screen).
   */
  private drawPoint(down: boolean, aim: { x: number; y: number } | null, car: ReturnType<PointSource>, W: number, H: number, R: number): void {
    const el = this.pointEl, v = this.pointVis;
    const size = R * 2;
    let cx: number, cy: number, kx = 0, ky = 0;
    if (v) {
      cx = v.bx; cy = v.by;
      kx = v.fx - v.bx; ky = v.fy - v.by;
      const m = Math.hypot(kx, ky);
      if (m > R) { kx *= R / m; ky *= R / m; }
    } else { cx = Math.max(R + 16, W * 0.22); cy = H - R - Math.max(16, 0.05 * H); }   // rests in the bottom-left corner, clear of the HUD
    el.classList.toggle('idle', !v); el.classList.toggle('held', down); el.classList.toggle('aim', !!aim);
    el.style.width = el.style.height = size.toFixed(0) + 'px';
    el.style.transform = `translate(${(cx - R).toFixed(1)}px, ${(cy - R).toFixed(1)}px)`;
    this.pointKnob.style.transform = `translate(${kx.toFixed(1)}px, ${ky.toFixed(1)}px)`;
    const ar = this.pointArrow;
    if (aim && car && car.screen) {
      ar.hidden = false;
      const ang = Math.atan2(aim.y, aim.x) + Math.PI / 2;
      ar.style.transform = `translate(${(car.screen.x - 22).toFixed(1)}px, ${(car.screen.y - 22).toFixed(1)}px) rotate(${ang.toFixed(3)}rad) translateY(-30px)`;
    } else ar.hidden = true;
  }

  /** Tilt indicator: a bar with a dot at the steering the phone is sending. */
  private drawTilt(on: boolean): void {
    if (!on) return;
    this.tiltDot.style.left = (50 + clamp(this.tiltSteer, -1, 1) * 50).toFixed(1) + '%';
    this.tiltEl.classList.toggle('wait', this.tiltRaw === null);
    this.tiltEl.dataset.steer = this.tiltSteer.toFixed(2);
  }

  private reset = (): void => {
    this.keys.clear();
    this.pointers.clear();
    this.kbSteer = 0;
    this.btnSteer = 0;
    this.pointCtl.reset(); this.pointVis = null;
    for (const e of [this.brakeEl, this.steerLEl, this.steerREl, this.zoneL, this.zoneR]) e.classList.remove('down');
  };

  private setTouch(on: boolean): void {
    if (this._touch === on) return;
    this._touch = on;
    this.syncLayer();
    this.touchCb?.(on);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!GAME_KEYS.has(e.code)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    if (e.code === 'KeyM') { if (!e.repeat) this.keyCb?.('mute'); return; }   // does not switch the touch / keyboard mode
    if (this.pointers.size === 0) this.setTouch(false);
    if (e.repeat) return;
    if (e.code === 'KeyP') { this.keyCb?.('pause'); return; }
    if (e.code === 'KeyR') { this.keyCb?.('repair'); return; }
    if (e.code === 'KeyE' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') { if (this.enabled) this.keyCb?.('item'); return; }
    if (this.enabled) this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (GAME_KEYS.has(e.code)) this.keys.delete(e.code);
  };

  private onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') return;
    this.setTouch(true);
    if (!this.enabled) return;
    const target = e.target instanceof Element ? e.target : null;
    const scheme = this.scheme;
    const W = window.innerWidth;
    let kind: PointerKind;
    let homeX = W / 2, homeY = e.clientY;
    const H = window.innerHeight;
    if (target?.closest('.brake-btn')) {
      kind = 'brake';
    } else if (target?.closest('.steer-btn')) {
      kind = 'sbtn';
    } else if (target?.closest('button, a, input, select, [data-ui]')) {
      return; // HUD / menu controls keep their own behaviour
    } else if (scheme === 'buttons' && steerZone(e.clientX, e.clientY, W, H) !== 0) {
      kind = 'sbtn';   // the whole lower-left block steers (no dead gaps around the arrows)
    } else if (scheme === 'joystick') {
      // fixed stick: a touch within grab radius of its centre takes it (one finger)
      const g = joyGeom(W, H);
      if (this.hasKind('slide') || Math.hypot(e.clientX - g.cx, e.clientY - g.cy) > g.grab) return;
      kind = 'slide'; homeX = g.cx; homeY = g.cy;
    } else if (scheme === 'slide') {
      if (e.clientX >= W / 2 || this.hasKind('slide')) return;   // the left half steers, one finger at a time
      kind = 'slide'; homeX = e.clientX;
    } else if (scheme === 'tap') {
      kind = 'tap';
    } else if (scheme === 'point') {
      if (this.hasKind('point') || !pointZone(e.clientX, e.clientY, W, H)) return;   // one finger steers; the HUD strip and the right-hand buttons do not
      kind = 'point'; homeX = e.clientX;
    } else return;   // buttons / tilt: touches outside the buttons do nothing
    if (kind !== 'brake' && kind !== 'sbtn' && e.cancelable) e.preventDefault();
    this.pointers.set(e.pointerId, { kind, x: e.clientX, y: e.clientY, homeX, homeY, size: 0, startY: homeY });
  };

  private hasKind(k: PointerKind): boolean {
    for (const p of this.pointers.values()) if (p.kind === k) return true;
    return false;
  }

  private onMove = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (p) {
      p.x = e.clientX; p.y = e.clientY;
    }
  };

  private onUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
  };
}
