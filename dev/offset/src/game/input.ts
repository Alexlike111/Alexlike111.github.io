// Unified input. Touch: left thumb = floating stick, right thumb = tap (absolute jump) / drag (relative aim, slow-mo).
// Desktop: WASD/arrows + space, mouse = absolute aim (hold) / click, RMB or E = action, Shift = arm heavy.
import { T } from '../core/tune';
import { clamp } from '../core/math';

export interface AimState {
  active: boolean;      // finger/mouse is down in aim zone
  dragging: boolean;    // passed the tap threshold → slow-mo aim
  relative: boolean;    // touch drag (offset from player) vs absolute (mouse / tap)
  sx: number; sy: number; // start css px
  x: number; y: number;   // current css px
  t0: number;           // start time (s, real)
  id: number;
}
export interface Release { kind: 'tap' | 'drag' | 'cancel'; x: number; y: number; dx: number; dy: number; relative: boolean; held: number }

export class Input {
  moveX = 0; moveY = 0;
  jumpEdge = false; jumpHeld = false; downHeld = false;
  aim: AimState = { active: false, dragging: false, relative: false, sx: 0, sy: 0, x: 0, y: 0, t0: 0, id: -1 };
  releases: Release[] = [];
  actionEdge = false; actionHeld = false; actionHeldTime = 0; actionReleased = false; heavyEdge = false;
  pauseEdge = false;
  touchMode = false;
  // stick visual
  stick = { on: false, ox: 0, oy: 0, x: 0, y: 0, id: -1 };
  mouseX = 0; mouseY = 0; shift = false;
  enabled = true;
  private keys = new Set<string>(); private stickJumpLatch = false;
  private now = () => performance.now() / 1000;
  w = 1; h = 1;
  /** rects (css px) that must not start aim/stick (DOM buttons handle themselves) */
  constructor(private el: HTMLElement) {
    const opt = { passive: false } as AddEventListenerOptions;
    el.addEventListener('pointerdown', (e) => this.down(e), opt);
    window.addEventListener('pointermove', (e) => this.move(e), opt);
    window.addEventListener('pointerup', (e) => this.up(e, false), opt);
    window.addEventListener('pointercancel', (e) => this.up(e, true), opt);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return; const k = e.code; this.keys.add(k);
      if (k === 'Space' || k === 'KeyW' || k === 'ArrowUp') { this.jumpEdge = true; e.preventDefault(); }
      if (k === 'KeyE' || k === 'KeyF') { this.actionEdge = true; this.actionHeld = true; this.actionHeldTime = 0; }
      if (k === 'Escape' || k === 'KeyP') this.pauseEdge = true;
      if (k === 'KeyQ' || k === 'KeyR') this.heavyEdge = true;
      if (k === 'ShiftLeft' || k === 'ShiftRight') this.shift = true;
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'KeyE' || e.code === 'KeyF') { this.actionHeld = false; this.actionReleased = true; }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.shift = false;
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.shift = false; this.actionHeld = false; this.cancelAll(); });
  }
  cancelAll() { this.aim.active = false; this.aim.dragging = false; this.stick.on = false; this.stick.id = -1; this.aim.id = -1; this.moveX = 0; }
  private down(e: PointerEvent) {
    if (!this.enabled) return;
    e.preventDefault();
    const touch = e.pointerType !== 'mouse';
    if (touch) this.touchMode = true; else if (e.pointerType === 'mouse') this.touchMode = false;
    const x = e.clientX, y = e.clientY;
    if (touch) {
      const leftZone = x < this.w * 0.4;
      if (leftZone && this.stick.id < 0) { this.stick = { on: true, ox: x, oy: y, x, y, id: e.pointerId }; this.stickJumpLatch = false; return; }
      if (this.aim.id < 0) { this.aim = { active: true, dragging: false, relative: true, sx: x, sy: y, x, y, t0: this.now(), id: e.pointerId }; }
    } else {
      this.mouseX = x; this.mouseY = y;
      if (e.button === 2) { this.actionEdge = true; this.actionHeld = true; this.actionHeldTime = 0; return; }
      if (e.button === 0) this.aim = { active: true, dragging: false, relative: false, sx: x, sy: y, x, y, t0: this.now(), id: e.pointerId };
    }
  }
  private move(e: PointerEvent) {
    const x = e.clientX, y = e.clientY;
    if (e.pointerType === 'mouse') { this.mouseX = x; this.mouseY = y; }
    if (e.pointerId === this.stick.id) { this.stick.x = x; this.stick.y = y; e.preventDefault(); }
    else if (e.pointerId === this.aim.id && this.aim.active) {
      this.aim.x = x; this.aim.y = y; e.preventDefault();
      if (!this.aim.dragging && Math.hypot(x - this.aim.sx, y - this.aim.sy) > T.tp.tapMaxMove) this.aim.dragging = true;
    }
  }
  private up(e: PointerEvent, cancel: boolean) {
    if (e.pointerType === 'mouse' && e.button === 2) { if (this.actionHeld) { this.actionHeld = false; this.actionReleased = true; } return; }
    if (e.pointerId === this.stick.id) { this.stick.on = false; this.stick.id = -1; this.moveX = 0; this.moveY = 0; return; }
    if (e.pointerId === this.aim.id && this.aim.active) {
      const a = this.aim; const held = this.now() - a.t0;
      a.active = false; a.id = -1;
      const drag = a.dragging; a.dragging = false;
      if (cancel) { this.releases.push({ kind: 'cancel', x: a.x, y: a.y, dx: 0, dy: 0, relative: a.relative, held }); return; }
      if (drag || (!a.relative && held > T.tp.tapMaxTime)) this.releases.push({ kind: 'drag', x: a.x, y: a.y, dx: a.x - a.sx, dy: a.y - a.sy, relative: a.relative, held });
      else if (held <= T.tp.tapMaxTime + 0.12) this.releases.push({ kind: 'tap', x: a.x, y: a.y, dx: 0, dy: 0, relative: a.relative, held });
      else this.releases.push({ kind: 'cancel', x: a.x, y: a.y, dx: 0, dy: 0, relative: a.relative, held });
    }
  }
  /** called once per rendered frame before game update */
  poll(dtReal: number) {
    let mx = 0; const k = this.keys;
    if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1; if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    this.jumpHeld = k.has('Space') || k.has('KeyW') || k.has('ArrowUp');
    this.downHeld = k.has('KeyS') || k.has('ArrowDown');
    if (this.stick.on) {
      const R = 52; let dx = (this.stick.x - this.stick.ox) / R, dy = (this.stick.y - this.stick.oy) / R;
      const l = Math.hypot(dx, dy);
      // the stick base follows the thumb so it never "runs out"
      if (l > 1.25) { const kx = (l - 1.25) / l; this.stick.ox += dx * R * kx; this.stick.oy += dy * R * kx; dx *= 1.25 / l; dy *= 1.25 / l; }
      mx = Math.abs(dx) < 0.22 ? 0 : clamp((dx - Math.sign(dx) * 0.22) / 0.5, -1, 1);
      if (dy < -0.62 && Math.abs(dy) > Math.abs(dx) * 0.7) { if (!this.stickJumpLatch) { this.jumpEdge = true; this.stickJumpLatch = true; } this.jumpHeld = true; }
      else if (dy > -0.35) this.stickJumpLatch = false;
      this.downHeld = dy > 0.7;
      this.moveY = dy;
    }
    this.moveX = mx;
    if (this.actionHeld) this.actionHeldTime += dtReal;
    // absolute mouse aim: becomes a "drag" (slow-mo) when held long enough
    if (this.aim.active && !this.aim.relative && !this.aim.dragging && this.now() - this.aim.t0 > T.tp.tapMaxTime) this.aim.dragging = true;
    // touch: holding without moving also enters precise aim (so the player sees the reticle)
    if (this.aim.active && this.aim.relative && !this.aim.dragging && this.now() - this.aim.t0 > T.tp.tapMaxTime + 0.1) this.aim.dragging = true;
  }
  /** clear one-frame edges (call after the fixed updates consumed them) */
  endFrame() { this.jumpEdge = false; this.heavyEdge = false; this.actionEdge = false; this.actionReleased = false; this.pauseEdge = false; this.releases.length = 0; }
  /** DOM action button hooks */
  actionDown() { this.actionEdge = true; this.actionHeld = true; this.actionHeldTime = 0; this.touchMode = true; }
  heavyTap() { this.heavyEdge = true; this.touchMode = true; }
  actionUp() { if (this.actionHeld) { this.actionHeld = false; this.actionReleased = true; } }
}
