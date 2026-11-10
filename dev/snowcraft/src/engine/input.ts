// Input (SPEC §1 InputState). Desktop: keyboard + mouse. Phone: ui/touch.ts writes into `touch` (held) and sets one-shot flags on `input`.
// Frame protocol: main calls poll() at the start of a frame (merges sources) and endFrame() at the end (clears one-shots).
import { stepZoom } from './zoom';

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
    case 'KeyE': input.interactPressed = true; break;        // E: alias of the right mouse button (interact)
    case 'KeyF': input.eatPressed = true; break;
    case 'KeyC': case 'KeyI': case 'Tab': input.craftPressed = true; break;   // the inventory: I, C or Tab (Tab is blocked for the page below)
    case 'KeyJ': input.journalPressed = true; break;
    case 'KeyM': window.dispatchEvent(new Event('sc:mutekey')); break;        // mute (ui/menu.ts owns the sound state; the mute button shows it)
    // Escape is not bound: the browser reserves it for leaving full screen (TERRARIA_CONTROLS, requirement 1.5.2)
    case 'KeyP': input.pausePressed = true; break;                              // pause + the settings panel (ui/menu.ts)
    case 'KeyR': input.smartToggle = true; break;
    case 'KeyV': input.ventPressed = true; break;
    case 'KeyG': input.dropPressed = true; break;
    case 'KeyX': input.sensesPressed = true; break;
    case 'F2': input.freeCamPressed = true; break;
    case 'Equal': case 'NumpadAdd': zoomKey(1); break;           // zoom (DESIGN §14): + / − keys, Ctrl+wheel; plain wheel stays the belt
    case 'Minus': case 'NumpadSubtract': zoomKey(-1); break;
  }
}
const ZOOM_CODES = new Set(['Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract', 'Digit0', 'Numpad0']);
const titleUp = () => document.body.classList.contains('title-open');

// ---- Left Ctrl tap (keydown + keyup within 400 ms, nothing else pressed or clicked or wheeled in between) toggles the smart cursor
const CTRL_TAP_MS = 400;
let ctrlT0 = 0, ctrlClean = false;
function keyDown(code: string) {
  if (code === 'ControlLeft') { ctrlT0 = performance.now(); ctrlClean = true; } else ctrlClean = false;
  keys.add(code); press(code);
}
function keyUp(code: string) {
  if (code === 'ControlLeft') { if (ctrlClean && performance.now() - ctrlT0 <= CTRL_TAP_MS) input.smartToggle = true; ctrlClean = false; }
  keys.delete(code);
}
function zoomKey(dir: number) { if (!titleUp()) stepZoom(dir); }
let zoomAcc = 0, zoomT = 0;

export function initInput(canvas: HTMLElement) {
  if (inited) return;
  inited = true; canvasEl = canvas;
  addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;       // the settings slider, the language list and the text fields keep their keys (and Tab moves their focus)
    if (BLOCK.has(e.code) || e.code === 'F2' || ((e.ctrlKey || e.metaKey) && ZOOM_CODES.has(e.code))) e.preventDefault();     // Tab, arrows, Space: no focus jumps / scrolling; Ctrl +/- must zoom the game, not the page
    if (e.repeat) return;
    keyDown(e.code);
  });
  addEventListener('keyup', (e) => { keyUp(e.code); });
  addEventListener('blur', () => { keys.clear(); mouse.primary = mouse.secondary = false; ctrlClean = false; });
  const target: EventTarget = document.getElementById('stage') ?? canvas;
  // the browser menu never opens on the game (requirement 1.4.5): a right click is the interact button, a long press is not a menu
  addEventListener('contextmenu', (e) => { const t = e.target as HTMLElement | null; if (!t?.closest?.('input,textarea,[data-allow-menu]')) e.preventDefault(); });
  target.addEventListener('pointerdown', (ev) => {
    const e = ev as PointerEvent;
    if (e.pointerType === 'touch') return;                  // ui/touch.ts
    ctrlClean = false;
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
  target.addEventListener('wheel', (ev) => {
    const e = ev as WheelEvent; e.preventDefault();
    ctrlClean = false;                                     // a wheel (also Ctrl+wheel = zoom) is not a Ctrl tap
    if (e.ctrlKey || e.metaKey) {                          // Ctrl+wheel (also a trackpad pinch, which arrives as ctrl+wheel): one zoom step per notch
      if (titleUp()) return;
      zoomAcc += e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
      const now = performance.now();
      if (Math.abs(zoomAcc) >= 50 && now - zoomT > 90) { stepZoom(zoomAcc < 0 ? 1 : -1); zoomAcc = 0; zoomT = now; }
      return;
    }
    wheelAcc += e.deltaY;
  }, { passive: false });
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
  keys.clear(); mouse.primary = mouse.secondary = false; wheelAcc = 0; ctrlClean = false;
  touch.x = touch.y = 0; touch.run = touch.jumpHeld = touch.primary = touch.down = touch.smart = touch.aimed = false;
  endFrame(); poll();
}
/** Test helper: simulate a key being held or tapped without DOM events. */
export function simKey(code: string, down: boolean) { if (down) { if (!keys.has(code)) keyDown(code); } else keyUp(code); }
export function simMouse(btn: 0 | 2, down: boolean, sx?: number, sy?: number) {
  if (sx !== undefined && sy !== undefined) { input.aimX = sx; input.aimY = sy; input.hasAim = true; input.aimMode = 'mouse'; }
  if (btn === 0) { mouse.primary = down; if (down) input.primaryPressed = true; } else { mouse.secondary = down; if (down) { input.secondaryPressed = true; input.interactPressed = true; } }
}
export function isKeyDown(code: string) { return keys.has(code); }
