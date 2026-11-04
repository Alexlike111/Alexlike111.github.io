// Keyboard + touch input. Touch has six schemes (src/input/schemes.ts; settings "Controls"):
//   buttons (default) auto gas, big left / right steer buttons, DRIFT + BRAKE + item on the right
//   slide    auto gas, drag a thumb sideways on the left half, buttons on the right
//   finger   the legacy scheme below (GAS button + slide of the same finger)
//   joystick auto gas, a floating stick under the left thumb (sideways steers, down brakes)
//   tilt     auto gas, steer by turning the phone like a wheel (DeviceOrientation)
//   tap      auto gas, hold the left / right half of the screen to steer, both = brake
// Legacy "finger" scheme:
//
// Touch scheme (one finger): hold the GAS button (bottom-right) and slide the same finger left / right to
// steer. Steering is the finger's horizontal offset from the GAS button centre (the "home" position of the
// thumb); a finger that is NOT on the button steers relative to the screen centre (see `steerAxis`, the one place
// that defines the reference point). Pulling the GAS finger
// below the button (brakePull, always reachable before the screen edge) = brake / reverse. In auto-gas mode a
// steering finger pulled down from where it landed brakes too. A small optional BRAKE button (bottom-left)
// works with a second finger. With auto-gas on, throttle is always 1 and any touch steers (relative to the
// screen centre).
//
// Drift (src/sim/drift.ts): a touch steer past the full-lock distance asks for an auto drift (the sim starts it above
// ~60 km/h); the DRIFT button (left of GAS, second finger) holds a drift like Space does on a keyboard.
//
// Keyboard: WASD / arrows, Space = handbrake / drift, P = pause, R = repair. Esc is never bound (Playgama 1.5.2).
import { CONFIG } from '../config';
import { DRIFT_AUTO, DRIFT_HOLD, DRIFT_NONE } from '../sim/drift';
import type { CarInput } from '../types';
import {
  alwaysGas, autoDriftScheme, boxRect, followHome, joyRadius, slideAxis, stickAxis, tiltAxis, tiltRoll, touchLayout,
  type BtnName, type ControlScheme,
} from './schemes';

type KeyAction = 'pause' | 'repair' | 'item';
type PointerKind = 'gas' | 'brake' | 'steer' | 'drift' | 'sbtn' | 'slide' | 'tap';

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
  private autoGas = false;
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
  private tiltRaw: number | null = null;
  private tiltCenter: number | null = null;
  private tiltSteer = 0;
  private tiltSeen = false;
  private tiltTimer = 0;
  private tiltOn = false;
  // geometry caches
  private boundary = 0;

  private layer: HTMLDivElement;
  private gasEl: HTMLDivElement;
  private brakeEl: HTMLDivElement;
  private driftEl: HTMLDivElement;
  private steerLEl: HTMLDivElement;
  private steerREl: HTMLDivElement;
  private stickEl: HTMLDivElement;
  private knobEl: HTMLDivElement;
  private zoneL: HTMLDivElement;
  private zoneR: HTMLDivElement;

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
    this.gasEl = mk('gas-btn', '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 6c9 7 15 17 15 30 0 6-2 11-5 15H22c-3-4-5-9-5-15C17 23 23 13 32 6z" fill="currentColor"/><path d="M26 54h12v4H26z" fill="currentColor" opacity=".7"/></svg><span data-gas-label></span>');
    this.brakeEl = mk('brake-btn', '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="14" y="14" width="36" height="36" rx="8" fill="currentColor"/></svg><span data-brake-label></span>');
    this.driftEl = mk('drift-btn', '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M14 44c6-14 18-22 34-24l-4-7 14 10-14 10 3-7c-12 2-21 8-27 20z" fill="currentColor"/><circle cx="16" cy="50" r="5" fill="currentColor" opacity=".7"/></svg><span data-drift-label></span>');
    const arrow = (d: string): string => `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    this.steerLEl = mk('steer-btn left', arrow('M40 12 20 32l20 20'));
    this.steerLEl.setAttribute('aria-label', 'left');
    this.steerREl = mk('steer-btn right', arrow('M24 12l20 20-20 20'));
    this.steerREl.setAttribute('aria-label', 'right');
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
    for (const e of [this.stickEl, this.zoneL, this.zoneR]) e.setAttribute('aria-hidden', 'true');
    this.layer.append(this.zoneL, this.zoneR, this.stickEl, this.gasEl, this.brakeEl, this.driftEl, this.steerLEl, this.steerREl);
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
    let tThrottle = 0, tBrake = 0, tSteer = 0, steerSet = false, tDrift = false;
    let sL = false, sR = false, tapL = false, tapR = false, stickP: Ptr | null = null;
    for (const p of this.pointers.values()) {
      if (p.kind === 'brake') { tBrake = 1; continue; }
      if (p.kind === 'drift') { tDrift = true; continue; }
      if (p.kind === 'sbtn') { if (p.x < this.boundary) sL = true; else sR = true; continue; }
      if (p.kind === 'tap') { if (p.x < W / 2) tapL = true; else tapR = true; continue; }
      if (p.kind === 'slide') {
        stickP = p;
        if (scheme === 'joystick') {
          const R = joyRadius(W, H);
          p.homeX = followHome(p.x, p.homeX, R);
          tSteer = stickAxis(p.x - p.homeX, R, R * C.joyDead);
          p.size = R * C.joyBrakePull;
          if (stepPull(p, dt)) tBrake = 1;
        } else {
          p.homeX = followHome(p.x, p.homeX, C.slideFull * W);
          tSteer = slideAxis(p.x, p.homeX, W);
        }
        steerSet = true;
        continue;
      }
      if (p.kind === 'gas') {
        if (p.y > brakeThresholdY(p.homeY, p.size)) { tBrake = 1; } else { tThrottle = 1; }
      } else if (stepPull(p, dt)) {
        tBrake = 1;   // a steering finger deliberately pulled down from where it landed = brake (auto-gas: the one-finger brake)
      }
      if (p.kind === 'gas' || !steerSet) { tSteer = this.steerFor(p); steerSet = true; }
    }

    // digital steering (buttons / two-side tap): ramps to full lock in ~0.1 s
    let btnTarget = 0;
    if (scheme === 'buttons') btnTarget = (sR ? 1 : 0) - (sL ? 1 : 0);
    else if (scheme === 'tap') {
      if (tapL && tapR) tBrake = 1; else btnTarget = (tapR ? 1 : 0) - (tapL ? 1 : 0);
    }
    const bRate = btnTarget === 0 || (this.btnSteer !== 0 && Math.sign(btnTarget) !== Math.sign(this.btnSteer)) ? C.buttonSteerReturn : C.buttonSteerRise;
    this.btnSteer += clamp(btnTarget - this.btnSteer, -bRate * dt, bRate * dt);
    if (Math.abs(this.btnSteer) < 1e-3 && btnTarget === 0) this.btnSteer = 0;

    // tilt
    if (scheme === 'tilt' && this.tiltRaw !== null && this.tiltCenter !== null) {
      const target = tiltAxis(this.tiltRaw - this.tiltCenter);
      this.tiltSteer += (target - this.tiltSteer) * Math.min(1, C.tiltSmooth * dt);
    } else this.tiltSteer = 0;

    let throttle = Math.max(kbThrottle, tThrottle);
    const brake = Math.max(kbBrake, tBrake);
    if (alwaysGas(scheme, this.autoGas)) throttle = 1;
    if (brake > 0) throttle = 0;   // braking always cancels gas

    let steer: number;
    if (steerSet) steer = tSteer * this.sens;
    else if (this.btnSteer !== 0) steer = this.btnSteer * this.sens;
    else if (scheme === 'tilt' && this.kbSteer === 0 && kbTarget === 0) steer = this.tiltSteer * this.sens;
    else steer = this.kbSteer;

    this.gasEl.classList.toggle('down', tThrottle > 0);
    this.brakeEl.classList.toggle('down', tBrake > 0 && this.brakeEl.offsetParent !== null);
    this.driftEl.classList.toggle('down', tDrift);
    this.steerLEl.classList.toggle('down', sL);
    this.steerREl.classList.toggle('down', sR);
    this.zoneL.classList.toggle('down', tapL);
    this.zoneR.classList.toggle('down', tapR);
    this.drawStick(stickP, W, H);
    // touch steering: a hard analog steer asks for an auto drift (the sim decides on speed); the DRIFT button holds one
    const drift = tDrift ? DRIFT_HOLD : steerSet && autoDriftScheme(scheme) ? DRIFT_AUTO : DRIFT_NONE;
    return { throttle, brake, steer: clamp(steer, -1, 1), handbrake, drift };
  }

  setAutoGas(on: boolean): void {
    this.autoGas = on;
    this.syncLayer();
  }

  get controlScheme(): ControlScheme { return this.scheme; }

  setScheme(s: ControlScheme): void {
    if (this.scheme === s) return;
    this.scheme = s;
    this.pointers.clear();
    this.btnSteer = 0;
    this.syncLayer();
    this.layout();
    this.setupTilt();
  }

  /** Steering sensitivity multiplier (settings slider). */
  setSensitivity(v: number): void { this.sens = clamp(v, C.sensMin, C.sensMax); }

  /** Tilt: take the current phone angle as the straight-ahead position. */
  recenter(): void { this.tiltCenter = this.tiltRaw; this.tiltSteer = 0; }

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

  /** Label texts of the on-screen buttons (already translated). */
  setLabels(gas: string, brake: string, drift?: string): void {
    const g = this.gasEl.querySelector('[data-gas-label]'), b = this.brakeEl.querySelector('[data-brake-label]');
    if (g) g.textContent = gas;
    if (b) b.textContent = brake;
    const d = this.driftEl.querySelector('[data-drift-label]');
    if (d && drift !== undefined) d.textContent = drift;
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

  /** Steering from a pointer: horizontal offset from its home position (see `steerAxis`). */
  private steerFor(p: Ptr): number {
    return steerAxis(p.x, p.homeX, Math.max(1, window.innerWidth), p.kind === 'gas', p.size);
  }

  private setupTilt(): void {
    window.clearTimeout(this.tiltTimer);
    const want = this.scheme === 'tilt';
    if (!want) {
      if (this.tiltOn) window.removeEventListener('deviceorientation', this.onOrient);
      this.tiltOn = false;
      this.tiltRaw = null; this.tiltCenter = null; this.tiltSteer = 0;
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
        DOE.requestPermission().then((r) => { if (r === 'granted') attach(); else this.tiltCb?.('denied'); }, () => this.tiltCb?.('denied'));
      } catch { this.tiltCb?.('denied'); }
    } else if (typeof window.DeviceOrientationEvent === 'undefined') {
      if (this._touch) this.tiltCb?.('unavailable');
    } else attach();
  }

  private onOrient = (e: DeviceOrientationEvent): void => {
    if (e.beta == null || e.gamma == null) return;
    const ang = typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.angle === 'number' ? screen.orientation.angle : (window.innerWidth > window.innerHeight ? 90 : 0);
    this.tiltRaw = tiltRoll(e.beta, e.gamma, ang);
    if (this.tiltCenter === null) this.tiltCenter = this.tiltRaw;
    if (!this.tiltSeen) { this.tiltSeen = true; this.tiltCb?.('ok'); }
  };

  private syncLayer(): void {
    const showLayer = this.enabled && this._touch;
    const s = this.scheme;
    this.layer.hidden = !showLayer;
    this.root.classList.toggle('sch-new', s !== 'finger');
    for (const n of ['buttons', 'slide', 'finger', 'joystick', 'tilt', 'tap']) this.root.classList.toggle('sch-' + n, n === s);
    this.gasEl.hidden = s !== 'finger' || this.autoGas;
    this.steerLEl.hidden = this.steerREl.hidden = s !== 'buttons';
    this.brakeEl.hidden = s === 'joystick' || s === 'tap';
    this.driftEl.hidden = false;
    this.stickEl.hidden = s !== 'slide' && s !== 'joystick';
    this.stickEl.classList.toggle('slide', s === 'slide');
    this.zoneL.hidden = this.zoneR.hidden = s !== 'tap';
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
    s.setProperty('--gas', Math.round(m * C.gasButtonSize) + 'px');
    s.setProperty('--brake', Math.round(m * C.brakeButtonSize) + 'px');
    s.setProperty('--drift', Math.round(m * C.driftButtonSize) + 'px');
    s.setProperty('--gap', Math.round(m * C.buttonMargin) + 'px');
    s.setProperty('--joy', Math.round(joyRadius(W, H) * 2) + 'px');
    const L = touchLayout(W, H, this.scheme);
    this.place(this.steerLEl, L.steerL);
    this.place(this.steerREl, L.steerR);
    this.place(this.driftEl, L.drift);
    this.place(this.brakeEl, L.brake);
    if (L.drift) s.setProperty('--drift', Math.round(L.drift.w) + 'px');
    if (L.brake) s.setProperty('--brake', Math.round(L.brake.w) + 'px');
    if (L.steerL) s.setProperty('--steer', Math.round(L.steerL.w) + 'px');
    // the item slot lives in the HUD layer: it follows the scheme through CSS variables on the UI root
    const r = this.root.style;
    if (L.item) {
      r.setProperty('--it-s', L.item.w.toFixed(1) + 'px');
      r.setProperty('--it-off', L.item.off.toFixed(1) + 'px');
      r.setProperty('--it-b', L.item.b.toFixed(1) + 'px');
    }
    r.setProperty('--tut-pad', this.tutorialClearance(L, W, H).toFixed(0) + 'px');
    if (L.steerL && L.steerR) this.boundary = boxRect(L.steerL, W, H).x + L.steerL.w + (L.steerR.off - L.steerL.off - L.steerL.w) / 2;
  };

  /** Height (px from the bottom edge) the first-run hint sheet must stay above, so it never covers a button. */
  private tutorialClearance(L: ReturnType<typeof touchLayout>, W: number, H: number): number {
    let top = 0;
    for (const b of Object.values(L)) if (b) top = Math.max(top, b.b + b.h);
    return L && this.scheme === 'finger' ? 0 : top + Math.max(8, 0.03 * Math.min(W, H));
  }

  /** Joystick / slide ring: floats under the thumb while touched, rests (dim) at the bottom left otherwise. */
  private drawStick(p: Ptr | null, W: number, H: number): void {
    if (this.scheme !== 'slide' && this.scheme !== 'joystick') return;
    const R = this.scheme === 'joystick' ? joyRadius(W, H) : C.slideFull * W;
    const el = this.stickEl;
    let cx: number, cy: number, kx = 0, ky = 0;
    if (p) {
      cx = p.homeX; cy = p.startY ?? p.homeY;
      kx = clamp(p.x - p.homeX, -R, R);
      ky = this.scheme === 'joystick' ? clamp(p.y - (p.startY ?? p.homeY), -R * 0.6, R) : 0;
    } else { cx = W * 0.27; cy = H - Math.min(W, H) * 0.3; }
    el.classList.toggle('idle', !p);
    const sz = this.scheme === 'joystick' ? R * 2 : R * 2 + 28;
    el.style.width = sz + 'px'; el.style.height = this.scheme === 'joystick' ? sz + 'px' : '';
    el.style.transform = `translate(${(cx - sz / 2).toFixed(1)}px, ${(cy - (this.scheme === 'joystick' ? sz / 2 : 26)).toFixed(1)}px)`;
    this.knobEl.style.transform = `translate(${kx.toFixed(1)}px, ${ky.toFixed(1)}px)`;
  }

  private reset = (): void => {
    this.keys.clear();
    this.pointers.clear();
    this.kbSteer = 0;
    this.btnSteer = 0;
    for (const e of [this.gasEl, this.brakeEl, this.driftEl, this.steerLEl, this.steerREl, this.zoneL, this.zoneR]) e.classList.remove('down');
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
    let kind: PointerKind = 'steer';
    let homeX = W / 2, homeY = e.clientY;
    let size = Math.min(W, window.innerHeight) * C.gasButtonSize;
    if (target?.closest('.brake-btn')) {
      kind = 'brake';
    } else if (target?.closest('.drift-btn')) {
      kind = 'drift';
    } else if (target?.closest('.steer-btn')) {
      kind = 'sbtn';
    } else if (target?.closest('button, a, input, select, [data-ui]')) {
      return; // HUD / menu controls keep their own behaviour
    } else if (scheme === 'finger') {
      if (target?.closest('.gas-btn')) {
        kind = 'gas';
        const r = this.gasEl.getBoundingClientRect();
        // steering home = where the thumb landed (no jump on touch-down), kept far enough from the right edge to steer
        size = r.width; homeY = r.top + r.height / 2;
        const dead = C.gasDeadBand * size;
        homeX = Math.min(e.clientX, W - dead - 0.2 * size);
      } else if (this.autoGas === false && this.hasGasPointer()) {
        return; // manual gas: only the GAS finger steers while it is down
      }
    } else if (scheme === 'slide' || scheme === 'joystick') {
      if (e.clientX >= W / 2 || this.hasKind('slide')) return;   // the left half steers, one finger at a time
      kind = 'slide'; homeX = e.clientX;
    } else if (scheme === 'tap') {
      kind = 'tap';
    } else return;   // buttons / tilt: touches outside the buttons do nothing
    if (kind !== 'brake' && kind !== 'drift' && kind !== 'sbtn' && e.cancelable) e.preventDefault();
    this.pointers.set(e.pointerId, { kind, x: e.clientX, y: e.clientY, homeX, homeY, size, startY: e.clientY });
  };

  private hasGasPointer(): boolean { return this.hasKind('gas'); }
  private hasKind(k: PointerKind): boolean {
    for (const p of this.pointers.values()) if (p.kind === k) return true;
    return false;
  }

  private onMove = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (p) {
      p.x = e.clientX; p.y = e.clientY;
      // flick the GAS thumb up = use the held item (one-handed play); re-arms when the thumb is back near home
      if (p.kind === 'gas') {
        const up = (p.homeY - p.y) / p.size;
        if (!p.flicked && up > C.itemFlickUp) { p.flicked = true; this.keyCb?.('item'); }
        else if (p.flicked && up < C.itemFlickUp * 0.5) p.flicked = false;
      }
    }
  };

  private onUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
  };
}
