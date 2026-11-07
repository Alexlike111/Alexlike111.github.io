// Input (SPEC §1 InputState). Desktop: keyboard + mouse. Phone: ui/touch.ts writes into `touch` (held) and sets one-shot flags on `input`.
// Frame protocol: main calls poll() at the start of a frame (merges sources) and endFrame() at the end (clears one-shots).
export interface InputState {
  moveX: number; moveY: number; run: boolean;
  jumpHeld: boolean; jumpPressed: boolean;
  primary: boolean; primaryPressed: boolean;
  secondaryPressed: boolean; secondaryHeld: boolean;
  interactPressed: boolean; eatPressed: boolean; craftPressed: boolean; journalPressed: boolean; mapPressed: boolean; pausePressed: boolean;
  wheelOpen: boolean; smartToggle: boolean;
  ventPressed: boolean; dropPressed: boolean; freeCamPressed: boolean;
  sensesPressed: boolean;    // X / touch «Чутьё»: toggled by main.ts (consumed there)
  hotbar: number;            // -1 or 0..8 pressed this frame
  scroll: -1 | 0 | 1;
  aimX: number; aimY: number; hasAim: boolean; aimMode: 'mouse' | 'touch' | 'smart';
  touchActive: boolean;
  anyKey: boolean;           // any key / press this frame (wakes sleepers, dismisses death card)
}
export const input: InputState = {
  moveX: 0, moveY: 0, run: false, jumpHeld: false, jumpPressed: false, primary: false, primaryPressed: false,
  secondaryPressed: false, secondaryHeld: false, interactPressed: false, eatPressed: false, craftPressed: false, journalPressed: false, mapPressed: false,
  pausePressed: false, wheelOpen: false, smartToggle: false, ventPressed: false, dropPressed: false, freeCamPressed: false, sensesPressed: false,
  hotbar: -1, scroll: 0, aimX: 0, aimY: 0, hasAim: false, aimMode: 'mouse', touchActive: false, anyKey: false,
};
/** Held state written by ui/touch.ts (merged with the keyboard/mouse each frame). */
export const touch = { x: 0, y: 0, run: false, jumpHeld: false, primary: false, down: false, smart: false, aimed: false };

const keys = new Set<string>();
const mouse = { primary: false, secondary: false };
let wheelAcc = 0;
let inited = false;
let canvasEl: HTMLElement | null = null;

const HOT: Record<string, number> = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5, Digit7: 6, Digit8: 7, Digit9: 8 };
const BLOCK = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

function press(code: string) {
  input.anyKey = true;
  const hot = HOT[code]; if (hot !== undefined) input.hotbar = hot;
  switch (code) {
    case 'Space': case 'KeyW': case 'ArrowUp': input.jumpPressed = true; break;
    case 'KeyE': input.interactPressed = true; break;
    case 'KeyF': input.eatPressed = true; break;
    case 'KeyC': case 'KeyI': input.craftPressed = true; break;
    case 'KeyJ': input.journalPressed = true; break;
    case 'KeyM': input.journalPressed = true; input.mapPressed = true; break;
    case 'Escape': input.pausePressed = true; break;
    case 'KeyR': input.smartToggle = true; break;
    case 'KeyV': input.ventPressed = true; break;
    case 'KeyG': input.dropPressed = true; break;
    case 'KeyX': input.sensesPressed = true; break;
    case 'F2': input.freeCamPressed = true; break;
  }
}

export function initInput(canvas: HTMLElement) {
  if (inited) return;
  inited = true; canvasEl = canvas;
  addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.tagName === 'TEXTAREA' || (e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (BLOCK.has(e.code) || e.code === 'F2') e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code); press(e.code);
  });
  addEventListener('keyup', (e) => { keys.delete(e.code); });
  addEventListener('blur', () => { keys.clear(); mouse.primary = mouse.secondary = false; });
  const target: EventTarget = document.getElementById('stage') ?? canvas;
  target.addEventListener('contextmenu', (e) => e.preventDefault());
  target.addEventListener('pointerdown', (ev) => {
    const e = ev as PointerEvent;
    if (e.pointerType === 'touch') return;                  // ui/touch.ts
    input.aimX = e.clientX; input.aimY = e.clientY; input.hasAim = true; input.aimMode = 'mouse'; input.anyKey = true; input.touchActive = false;
    if (e.button === 0) { mouse.primary = true; input.primaryPressed = true; }
    else if (e.button === 2) { mouse.secondary = true; input.secondaryPressed = true; input.interactPressed = true; }
  });
  addEventListener('pointerup', (ev) => {
    const e = ev as PointerEvent;
    if (e.pointerType === 'touch') return;
    if (e.button === 0) mouse.primary = false; else if (e.button === 2) mouse.secondary = false;
  });
  addEventListener('pointermove', (ev) => {
    const e = ev as PointerEvent;
    if (e.pointerType === 'touch') return;
    input.aimX = e.clientX; input.aimY = e.clientY; input.hasAim = true; input.aimMode = 'mouse'; input.touchActive = false;
  });
  target.addEventListener('wheel', (ev) => { const e = ev as WheelEvent; e.preventDefault(); wheelAcc += e.deltaY; }, { passive: false });
}

/** Merge keyboard / mouse / touch into `input`. Call once at the start of a frame. */
export function poll() {
  const kx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const ky = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  input.moveX = kx !== 0 ? kx : touch.x;
  input.moveY = ky !== 0 ? ky : (touch.down ? 1 : 0);
  input.run = keys.has('ShiftLeft') || keys.has('ShiftRight') || touch.run;
  input.jumpHeld = keys.has('Space') || keys.has('KeyW') || keys.has('ArrowUp') || touch.jumpHeld;
  input.primary = mouse.primary || touch.primary;
  input.secondaryHeld = mouse.secondary;
  input.wheelOpen = keys.has('KeyQ');
  if (touch.primary && !input.primary) input.primary = true;
  if (Math.abs(wheelAcc) > 1) { input.scroll = wheelAcc > 0 ? 1 : -1; wheelAcc = 0; }
  if (touch.smart) input.aimMode = 'smart';
}
/** Clear one-shot flags. Call at the end of each frame (after all fixed steps consumed them). */
export function endFrame() {
  input.jumpPressed = input.primaryPressed = input.secondaryPressed = input.interactPressed = input.eatPressed = false;
  input.craftPressed = input.journalPressed = input.mapPressed = input.pausePressed = input.smartToggle = false;
  input.ventPressed = input.dropPressed = input.freeCamPressed = false;   // sensesPressed is consumed (and cleared) by main.ts at once
  input.hotbar = -1; input.scroll = 0; input.anyKey = false;
}
/** Test/dev helper: reset all held state. */
export function resetInput() {
  keys.clear(); mouse.primary = mouse.secondary = false; wheelAcc = 0;
  touch.x = touch.y = 0; touch.run = touch.jumpHeld = touch.primary = touch.down = touch.smart = touch.aimed = false;
  endFrame(); poll();
}
/** Test helper: simulate a key being held or tapped without DOM events. */
export function simKey(code: string, down: boolean) { if (down) { if (!keys.has(code)) { keys.add(code); press(code); } } else keys.delete(code); }
export function simMouse(btn: 0 | 2, down: boolean, sx?: number, sy?: number) {
  if (sx !== undefined && sy !== undefined) { input.aimX = sx; input.aimY = sy; input.hasAim = true; input.aimMode = 'mouse'; }
  if (btn === 0) { mouse.primary = down; if (down) input.primaryPressed = true; } else { mouse.secondary = down; if (down) { input.secondaryPressed = true; input.interactPressed = true; } }
}
export function isKeyDown(code: string) { return keys.has(code); }
