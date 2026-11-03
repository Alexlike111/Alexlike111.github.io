// Keyboard + one-finger touch input.
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

type KeyAction = 'pause' | 'repair' | 'item';
type PointerKind = 'gas' | 'brake' | 'steer' | 'drift';

interface Ptr { kind: PointerKind; x: number; y: number; homeX: number; homeY: number; size: number; flicked?: boolean; pullT?: number }

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
  return mag === 0 ? 0 : Math.sign(dx) * mag;
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

export class InputController {
  private root: HTMLElement;
  private keys = new Set<string>();
  private pointers = new Map<number, Ptr>();
  private enabled = false;
  private autoGas = false;
  private _touch = false;
  private keyCb: ((k: KeyAction) => void) | null = null;
  private touchCb: ((touch: boolean) => void) | null = null;
  private kbSteer = 0;
  private lastT = 0;

  private layer: HTMLDivElement;
  private gasEl: HTMLDivElement;
  private brakeEl: HTMLDivElement;
  private driftEl: HTMLDivElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this._touch = InputController.detectTouchDevice();

    this.layer = document.createElement('div');
    this.layer.className = 'touch-layer';
    this.layer.hidden = true;
    this.gasEl = document.createElement('div');
    this.gasEl.className = 'gas-btn';
    this.gasEl.setAttribute('role', 'button');
    this.gasEl.innerHTML = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 6c9 7 15 17 15 30 0 6-2 11-5 15H22c-3-4-5-9-5-15C17 23 23 13 32 6z" fill="currentColor"/><path d="M26 54h12v4H26z" fill="currentColor" opacity=".7"/></svg><span data-gas-label></span>';
    this.brakeEl = document.createElement('div');
    this.brakeEl.className = 'brake-btn';
    this.brakeEl.setAttribute('role', 'button');
    this.brakeEl.innerHTML = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="14" y="14" width="36" height="36" rx="8" fill="currentColor"/></svg><span data-brake-label></span>';
    this.driftEl = document.createElement('div');
    this.driftEl.className = 'drift-btn';
    this.driftEl.setAttribute('role', 'button');
    this.driftEl.innerHTML = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M14 44c6-14 18-22 34-24l-4-7 14 10-14 10 3-7c-12 2-21 8-27 20z" fill="currentColor"/><circle cx="16" cy="50" r="5" fill="currentColor" opacity=".7"/></svg><span data-drift-label></span>';
    this.layer.append(this.gasEl, this.brakeEl, this.driftEl);
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
    for (const p of this.pointers.values()) {
      if (p.kind === 'brake') { tBrake = 1; continue; }
      if (p.kind === 'drift') { tDrift = true; continue; }
      if (p.kind === 'gas') {
        if (p.y > brakeThresholdY(p.homeY, p.size)) { tBrake = 1; } else { tThrottle = 1; }
      } else if (stepPull(p, dt)) {
        tBrake = 1;   // a steering finger deliberately pulled down from where it landed = brake (auto-gas: the one-finger brake)
      }
      if (p.kind === 'gas' || !steerSet) { tSteer = this.steerFor(p); steerSet = true; }
    }

    let throttle = Math.max(kbThrottle, tThrottle);
    const brake = Math.max(kbBrake, tBrake);
    if (this.autoGas) throttle = 1;
    if (brake > 0) throttle = 0;   // braking always cancels gas

    const steer = steerSet ? tSteer : this.kbSteer;
    this.gasEl.classList.toggle('down', tThrottle > 0);
    this.brakeEl.classList.toggle('down', tBrake > 0);
    this.driftEl.classList.toggle('down', tDrift);
    // touch steering: a hard steer asks for an auto drift (the sim decides on speed); the DRIFT button holds one
    const drift = tDrift ? DRIFT_HOLD : steerSet ? DRIFT_AUTO : DRIFT_NONE;
    return { throttle, brake, steer: clamp(steer, -1, 1), handbrake, drift };
  }

  setAutoGas(on: boolean): void {
    this.autoGas = on;
    this.syncLayer();
  }

  setEnabled(on: boolean): void {
    if (this.enabled === on) return;
    this.enabled = on;
    this.reset();
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

  private syncLayer(): void {
    const showLayer = this.enabled && this._touch;
    this.layer.hidden = !showLayer;
    this.gasEl.hidden = this.autoGas;
  }

  private layout = (): void => {
    const m = Math.min(window.innerWidth, window.innerHeight);
    const s = this.layer.style;
    s.setProperty('--gas', Math.round(m * C.gasButtonSize) + 'px');
    s.setProperty('--brake', Math.round(m * C.brakeButtonSize) + 'px');
    s.setProperty('--drift', Math.round(m * C.driftButtonSize) + 'px');
    s.setProperty('--gap', Math.round(m * C.buttonMargin) + 'px');
  };

  private reset = (): void => {
    this.keys.clear();
    this.pointers.clear();
    this.kbSteer = 0;
    this.gasEl.classList.remove('down');
    this.brakeEl.classList.remove('down');
    this.driftEl.classList.remove('down');
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
    let kind: PointerKind = 'steer';
    let homeX = window.innerWidth / 2, homeY = e.clientY;
    let size = Math.min(window.innerWidth, window.innerHeight) * C.gasButtonSize;
    if (target?.closest('.gas-btn')) {
      kind = 'gas';
      const r = this.gasEl.getBoundingClientRect();
      // steering home = where the thumb landed (no jump on touch-down), kept far enough from the right edge to steer
      size = r.width; homeY = r.top + r.height / 2;
      const dead = C.gasDeadBand * size;
      homeX = Math.min(e.clientX, window.innerWidth - dead - 0.2 * size);
    } else if (target?.closest('.brake-btn')) {
      kind = 'brake';
    } else if (target?.closest('.drift-btn')) {
      kind = 'drift';
    } else if (target?.closest('button, a, input, select, [data-ui]')) {
      return; // HUD / menu controls keep their own behaviour
    } else if (this.autoGas === false && this.hasGasPointer()) {
      return; // manual gas: only the GAS finger steers while it is down
    }
    if (kind !== 'brake' && kind !== 'drift' && e.cancelable) e.preventDefault();
    this.pointers.set(e.pointerId, { kind, x: e.clientX, y: e.clientY, homeX, homeY, size });
  };

  private hasGasPointer(): boolean {
    for (const p of this.pointers.values()) if (p.kind === 'gas') return true;
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
