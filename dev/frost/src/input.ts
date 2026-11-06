// Keyboard / mouse / touch input. Pure state; the UI module draws the touch widgets and feeds them in.
export interface InputState {
  moveX: number;          // -1..1
  jump: boolean;          // held
  run: boolean;
  aimX: number; aimY: number; hasAim: boolean; // CSS px over the canvas
  primary: boolean;       // held: use tool (LMB / touch-hold on world)
  secondaryPressed: boolean; // edge: place/throw (RMB / "Положить" button)
  interactPressed: boolean;  // E / "Взять"
  eatPressed: boolean;       // Q / "Съесть"
  waitHeld: boolean;         // T held / "Ждать" toggle
  firePressed: boolean;      // F
  rotatePressed: boolean;    // R / rotate button
  xrayPressed: boolean;      // X
  pausePressed: boolean;     // Esc / pause button
  toolSelect: number;        // -1 or 0..5 edge (keys 1–6, wheel cycles, tapping a tool tag)
}

export type InputButton = 'secondary' | 'interact' | 'eat' | 'fire' | 'rotate' | 'xray' | 'pause';

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export class Input {
  state: InputState = {
    moveX: 0, jump: false, run: false,
    aimX: 0, aimY: 0, hasAim: false,
    primary: false, secondaryPressed: false, interactPressed: false, eatPressed: false,
    waitHeld: false, firePressed: false, rotatePressed: false, xrayPressed: false,
    pausePressed: false, toolSelect: -1,
  };
  /** true when a touch UI should be shown (coarse pointer or a touch was seen) */
  mobile = false;
  /** UI keeps these in sync so the wheel can cycle */
  currentTool = 0;
  toolCount = 6;
  onModeChange: ((mobile: boolean) => void) | null = null;
  /** hold Q (PC) opens the radial tool wheel: 'open' after a short hold, 'close' on release (pick), 'cancel' on blur. A quick tap of Q still eats. */
  onWheelKey: ((phase: 'open' | 'close' | 'cancel') => void) | null = null;
  /** a radial wheel is open: the world ignores pointer / wheel input */
  blocked = false;
  /** performance.now() of the last touch down / move / up on the world; the UI fades the reticle 1.5 s after it */
  touchAt = 0;

  private canvas: HTMLElement;
  private keys = new Set<string>();
  private stickX = 0;
  private stickJump = false;
  private jumpBtn = false;
  private stickRun = false;
  private waitToggle = false;
  private touchId: number | null = null;
  private qTimer = 0;
  private qWheel = false;
  private jumpLatch = false;

  constructor(canvas: HTMLElement) {
    this.canvas = canvas;
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.applyMode(coarse, true);

    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.reset);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset(); });
    document.documentElement.addEventListener('mouseleave', () => { if (!this.mobile) this.state.hasAim = false; });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    // no page zoom / scroll / selection
    window.addEventListener('gesturestart', (e) => e.preventDefault());
    window.addEventListener('gesturechange', (e) => e.preventDefault());
    document.addEventListener('selectstart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
    document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 || (e.target as HTMLElement | null)?.closest?.('.overlay') == null) e.preventDefault(); }, { passive: false });
  }

  /** Clear one-frame edge flags. Call at the end of every frame after reading. */
  endFrame(): void {
    const s = this.state;
    s.secondaryPressed = false; s.interactPressed = false; s.eatPressed = false;
    s.firePressed = false; s.rotatePressed = false; s.xrayPressed = false;
    s.pausePressed = false; s.toolSelect = -1;
    if (this.jumpLatch && !this.jumpBtn) { this.jumpLatch = false; this.recompute(); }
  }

  // ---- API used by the touch widgets in ui.ts ----
  setStick(x: number, jump: boolean, run: boolean): void {
    this.stickX = clamp(x, -1, 1); this.stickJump = jump; this.stickRun = run; this.recompute();
  }
  press(b: InputButton): void {
    const s = this.state;
    switch (b) {
      case 'secondary': s.secondaryPressed = true; break;
      case 'interact': s.interactPressed = true; break;
      case 'eat': s.eatPressed = true; break;
      case 'fire': s.firePressed = true; break;
      case 'rotate': s.rotatePressed = true; break;
      case 'xray': s.xrayPressed = true; break;
      case 'pause': s.pausePressed = true; break;
    }
  }
  /** Jump button: held = jump. A tap shorter than one frame is latched until the next frame has seen it. */
  setJumpHeld(on: boolean): void { this.jumpBtn = on; if (on) this.jumpLatch = true; this.recompute(); }
  setBlocked(b: boolean): void { this.blocked = b; if (b) this.state.primary = false; }
  pressTool(i: number): void { this.state.toolSelect = i; this.currentTool = i; }
  toggleWait(): void { this.waitToggle = !this.waitToggle; this.recompute(); }
  setWait(on: boolean): void { this.waitToggle = on; this.recompute(); }
  get waitToggled(): boolean { return this.waitToggle; }

  // ---- internals ----
  private applyMode(mobile: boolean, silent = false): void {
    if (!silent && mobile === this.mobile) return;
    this.mobile = mobile;
    document.documentElement.dataset.input = mobile ? 'touch' : 'mouse';
    if (!silent) this.onModeChange?.(mobile);
  }

  private reset = (): void => {
    this.keys.clear();
    window.clearTimeout(this.qTimer); this.qTimer = 0;
    if (this.qWheel) { this.qWheel = false; this.onWheelKey?.('cancel'); }
    this.state.primary = false;
    this.touchId = null;
    this.stickX = 0; this.stickJump = false; this.stickRun = false; this.jumpBtn = false;
    this.recompute();
  };

  private recompute(): void {
    const k = this.keys, s = this.state;
    let kx = 0;
    if (k.has('KeyA') || k.has('ArrowLeft')) kx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) kx += 1;
    s.moveX = kx !== 0 ? kx : this.stickX;
    s.jump = k.has('KeyW') || k.has('Space') || k.has('ArrowUp') || this.stickJump || this.jumpBtn || this.jumpLatch;
    s.run = k.has('ShiftLeft') || k.has('ShiftRight') || this.stickRun;
    s.waitHeld = k.has('KeyT') || this.waitToggle;
  }

  private setAim(e: PointerEvent): void {
    const r = this.canvas.getBoundingClientRect();
    this.state.aimX = e.clientX - r.left;
    this.state.aimY = e.clientY - r.top;
    this.state.hasAim = true;
  }

  private onDown = (e: PointerEvent): void => {
    const s = this.state;
    if (e.pointerType === 'touch') {
      this.applyMode(true);
      if (this.blocked || this.touchId !== null) return;
      this.touchId = e.pointerId;
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      this.setAim(e);
      this.touchAt = performance.now();
      s.primary = true;
      e.preventDefault();
      return;
    }
    if (!matchMedia('(pointer: coarse)').matches) this.applyMode(false);
    if (this.blocked) return;
    this.setAim(e);
    if (e.button === 0) s.primary = true;
    else if (e.button === 2) s.secondaryPressed = true;
    e.preventDefault();
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      if (e.pointerId === this.touchId) { this.setAim(e); this.touchAt = performance.now(); }
      return;
    }
    this.setAim(e);
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      if (e.pointerId === this.touchId) { this.touchId = null; this.state.primary = false; this.touchAt = performance.now(); }
      return;
    }
    if (e.button === 0 || e.type === 'pointercancel') this.state.primary = false;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (this.blocked || Math.abs(e.deltaY) < 1) return;
    const n = this.toolCount;
    const dir = e.deltaY > 0 ? 1 : -1;
    const next = (((this.currentTool + dir) % n) + n) % n;
    this.state.toolSelect = next;
    this.currentTool = next;
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const c = e.code;
    const overlay = document.documentElement.dataset.overlay === '1';
    const gameKey = /^(Key[ADWEQFTRX]|Arrow(Left|Right|Up|Down)|Space|Shift(Left|Right)|Digit[1-6]|Escape|Tab)$/.test(c);
    if (!gameKey) return;
    // with an overlay open Space/Enter must still activate the focused button
    if (!(overlay && (c === 'Space' || c === 'Tab'))) e.preventDefault();
    const s = this.state;
    if (!e.repeat) {
      switch (c) {
        case 'KeyE': s.interactPressed = true; break;
        case 'KeyQ': // tap = eat (on release), hold = tool wheel
          window.clearTimeout(this.qTimer);
          this.qTimer = window.setTimeout(() => { this.qTimer = 0; if (this.keys.has('KeyQ') && this.onWheelKey && !overlay) { this.qWheel = true; this.onWheelKey('open'); } }, 200);
          break;
        case 'KeyF': s.firePressed = true; break;
        case 'KeyR': s.rotatePressed = true; break;
        case 'KeyX': s.xrayPressed = true; break;
        case 'Escape': s.pausePressed = true; break;
        default:
          if (c.startsWith('Digit')) { const n = parseInt(c.slice(5), 10) - 1; s.toolSelect = n; this.currentTool = n; }
      }
    }
    this.keys.add(c);
    this.recompute();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
    if (e.code === 'KeyQ') {
      if (this.qWheel) { this.qWheel = false; this.onWheelKey?.('close'); }
      else if (this.qTimer) { window.clearTimeout(this.qTimer); this.qTimer = 0; this.state.eatPressed = true; }
    }
    // Shift released with the key state out of sync (e.g. alt-tab) is handled by blur reset
    this.recompute();
  };
}
