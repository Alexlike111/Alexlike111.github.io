// Phone controls (SPEC §1, DESIGN §10): floating left stick (up = jump, far = run), right-hand buttons >= 36 px (icons, no words; the words are the aria-labels):
// Действие (hold, smart cursor) / Прыжок / Взять / Пояс (radial of the belt) / Чутьё / Парка in the right-hand cluster; Сумка / Журнал / ⚙ меню in the top-right row.
// ⚙ only dispatches 'sc:menu' (the settings panel, ui/menu.ts, listens). Touching the world aims there and holds the action. Zoom is pinch + the settings slider.
// "Поверни телефон" overlay in portrait. Safe-area insets respected. Writes into engine/input.ts.
import { input, touch } from '../engine/input';
import { G } from '../game/state';
import { strings } from '../content/i18n';
import { inv, select, beltCells } from '../game/inventory';
import { getItem, itemName } from '../game/items';
import { icon } from '../engine/sprites';
import { worldToScreen } from '../engine/render';
import { stepZoom } from '../engine/zoom';

const S = strings('touch', {
  action: 'Действие', jump: 'Прыжок', take: 'Взять', belt: 'Пояс', bag: 'Сумка', journal: 'Журнал', parka: 'Парка', menu: 'Меню',
  senses: 'Чутьё', rotate: 'Поверни телефон', rotateHint: 'SNOWCRAFT играется в альбомной ориентации',
  moveHint: 'тяни: ходьба', radialCap: 'Выбери предмет · тап мимо — закрыть', wheelCap: 'Мышь к предмету · отпусти Q', wheelEmpty: 'пусто',
});

// icons: 24-unit grid, 2-unit strokes, drawn in currentColor (the button sets the palette)
const ICON: Record<string, string> = {
  act: '<path d="M11 4.5C16.5 4.5 19.8 7.2 20.5 11.2L18.4 11.8C16.8 8.6 13.6 6.6 9.2 6.6Z"/><path d="M14.2 10.2L4.6 19.6"/>',           // pick
  jump: '<path d="M12 19.5V5"/><path d="M5.5 11.5L12 5L18.5 11.5"/>',                                                               // up arrow
  take: '<path d="M12 3.5V14"/><path d="M7.5 9.5L12 14L16.5 9.5"/><path d="M4.5 19.5H19.5"/>',                                     // down into a tray
  belt: '<rect x="2.5" y="5" width="5" height="5" rx="1"/><rect x="9.5" y="5" width="5" height="5" rx="1"/><rect x="16.5" y="5" width="5" height="5" rx="1"/><rect x="2.5" y="14" width="5" height="5" rx="1"/><rect x="9.5" y="14" width="5" height="5" rx="1"/><rect x="16.5" y="14" width="5" height="5" rx="1"/>',   // the six belt cells
  senses: '<path d="M2 12C5 6.5 19 6.5 22 12C19 17.5 5 17.5 2 12Z"/><circle cx="12" cy="12" r="3"/>',                              // eye
  bag: '<path d="M6 11Q6 4 12 4Q18 4 18 11V18.5Q18 20.5 16 20.5H8Q6 20.5 6 18.5Z"/><path d="M6 14H18"/><path d="M10.5 4.2V2.5M13.5 4.2V2.5"/>',   // backpack
  journal: '<path d="M12 6.5C10 4.8 6.5 4.5 3.5 5.2V19.2C6.5 18.5 10 18.8 12 20.5C14 18.8 17.5 18.5 20.5 19.2V5.2C17.5 4.5 14 4.8 12 6.5Z"/><path d="M12 6.5V20.5"/>', // open book
  parka: '<path d="M9 4L12 6L15 4L19.5 7L17.5 11L16.5 10.5V20.5H7.5V10.5L6.5 11L4.5 7Z"/><path d="M12 6V20.5"/>',   // jacket with a hood collar and a zip
  menu: '<path d="M12 2.5L13.5 5L16.2 4.2L16.6 7L19.3 7.8L18.3 10.4L20.5 12L18.3 13.6L19.3 16.2L16.6 17L16.2 19.8L13.5 19L12 21.5L10.5 19L7.8 19.8L7.4 17L4.7 16.2L5.7 13.6L3.5 12L5.7 10.4L4.7 7.8L7.4 7L7.8 4.2L10.5 5Z"/><circle cx="12" cy="12" r="3"/>',   // gear
};

let root: HTMLElement | null = null;
let layer: HTMLElement | null = null;
let radial: HTMLElement | null = null;
let rotateEl: HTMLElement | null = null;
let stickBase: HTMLElement | null = null, stickKnob: HTMLElement | null = null;
let syncStick: () => void = () => {};
let enabled = false;
let jumpBtn = false, jumpStick = false, actHeld = false, rotatePaused = false;
let ghost: HTMLElement | null = null;
let radialTimer = 0;
let R = 56;                                     // stick radius px (follows the screen height: --R in the CSS, kept in sync by syncStick())
const AIM_LIFT = 48;                            // the aim cursor sits this many CSS px above the finger (the finger hides the spot it aims at)

const CSS = `
:root{--u:clamp(36px,13vh,60px);--R:clamp(34px,15vh,56px);--trow:calc(var(--u)*3 + 24px)}
#touch{position:fixed;inset:0;z-index:30;pointer-events:none;touch-action:none;-webkit-user-select:none;user-select:none;font-family:'Jura',system-ui,sans-serif;font-weight:700;
  padding:env(safe-area-inset-top,0) env(safe-area-inset-right,0) env(safe-area-inset-bottom,0) env(safe-area-inset-left,0)}
#touch .tb{box-sizing:border-box;position:absolute;pointer-events:auto;touch-action:none;display:flex;align-items:center;justify-content:center;color:#dff0ff;
  background:rgba(14,26,44,.62);border:2px solid rgba(124,198,238,.55);border-radius:50%;backdrop-filter:blur(2px);-webkit-tap-highlight-color:transparent}
#touch .tb svg{width:52%;height:52%;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;overflow:visible;pointer-events:none;filter:drop-shadow(0 1px 0 #05080f)}
#touch .tb.sq{border-radius:10px}
#touch .tb:active,#touch .tb.on{background:rgba(124,198,238,.45);border-color:#cfeaff}
/* right-hand cluster (SPEC §1): column A sits over Действие (right edge 12 + .3u), column B left of it (centred on Прыжок); rows counted from the bottom:
   0 Действие / Прыжок, 1 Взять / Пояс, 2 Чутьё / Парка, 3 «Рядом». The gap between two buttons is 6 px; all sizes follow --u (36 px on a landscape phone). */
#touch #tb-act{width:calc(var(--u)*1.6);height:calc(var(--u)*1.6);right:calc(12px + env(safe-area-inset-right,0px));bottom:calc(12px + env(safe-area-inset-bottom,0px));border-color:rgba(255,196,110,.8);background:rgba(60,34,12,.55);color:#ffe7bd}
#touch #tb-act svg{width:50%;height:50%}
#touch #tb-jump{width:calc(var(--u)*1.15);height:calc(var(--u)*1.15);right:calc(18px + var(--u)*1.6 + env(safe-area-inset-right,0px));bottom:calc(12px + env(safe-area-inset-bottom,0px))}
#touch #tb-take{width:var(--u);height:var(--u);right:calc(12px + var(--u)*.3 + env(safe-area-inset-right,0px));bottom:calc(18px + var(--u)*1.6 + env(safe-area-inset-bottom,0px))}
#touch #tb-belt{width:var(--u);height:var(--u);right:calc(18px + var(--u)*1.675 + env(safe-area-inset-right,0px));bottom:calc(18px + var(--u)*1.6 + env(safe-area-inset-bottom,0px))}
#touch #tb-senses{width:var(--u);height:var(--u);right:calc(12px + var(--u)*.3 + env(safe-area-inset-right,0px));bottom:calc(24px + var(--u)*2.6 + env(safe-area-inset-bottom,0px))}
#touch #tb-senses.act{background:rgba(40,120,96,.62);border-color:#8cf5cf;color:#eafff7}
#touch #tb-parka{width:var(--u);height:var(--u);right:calc(18px + var(--u)*1.675 + env(safe-area-inset-right,0px));bottom:calc(24px + var(--u)*2.6 + env(safe-area-inset-bottom,0px))}
/* top-right row: Сумка, Журнал, ⚙ меню (icon-only squares) */
#touch #tb-bag,#touch #tb-jour,#touch #tb-menu{width:var(--u);height:var(--u);top:calc(8px + env(safe-area-inset-top,0px));border-radius:10px}
#touch #tb-menu{right:calc(12px + env(safe-area-inset-right,0px))}
#touch #tb-jour{right:calc(18px + var(--u) + env(safe-area-inset-right,0px))}
#touch #tb-bag{right:calc(24px + var(--u)*2 + env(safe-area-inset-right,0px))}
/* the walking stick is FIXED in the bottom-left corner and always visible; the knob follows the thumb */
#touch .stick{position:absolute;left:calc(18px + env(safe-area-inset-left,0px));bottom:calc(14px + env(safe-area-inset-bottom,0px));width:calc(var(--R)*2);height:calc(var(--R)*2);box-sizing:border-box;border-radius:50%;border:2px solid rgba(190,226,250,.55);background:rgba(14,26,44,.35)}
#touch .knob{position:absolute;width:calc(var(--R)*.95);height:calc(var(--R)*.95);margin:calc(var(--R)*-.475) 0 0 calc(var(--R)*-.475);border-radius:50%;background:rgba(190,226,250,.45);border:2px solid #cfeaff;box-sizing:border-box}
#touch .ghost{position:absolute;left:calc(18px + env(safe-area-inset-left,0px));bottom:calc(14px + var(--R)*2 + 4px + env(safe-area-inset-bottom,0px));display:none;font-size:12px;color:#cfeaff;text-shadow:0 1px 0 #05080f;white-space:nowrap}
#touch .rad{position:absolute;inset:0;pointer-events:auto;display:none;background:linear-gradient(0deg,rgba(5,9,16,.5),rgba(5,9,16,0) 45%)}
#touch .rad .cap{position:absolute;right:8px;bottom:calc(64px + env(safe-area-inset-bottom,0px));width:max-content;max-width:90vw;box-sizing:border-box;text-align:center;font:700 13px 'Jura',system-ui,sans-serif;color:#e8f4ff;text-shadow:0 1px 0 #05080f;background:rgba(8,16,30,.88);border:1px solid rgba(124,198,238,.4);border-radius:4px;padding:4px 10px;white-space:nowrap}
#touch .rad .slot{position:absolute;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(14,26,44,.9);border:2px solid rgba(124,198,238,.6);
  display:flex;flex-direction:column;align-items:center;justify-content:center;color:#dff0ff;font-size:13px;text-align:center}
#touch .rad .slot.sel{border-color:#ffc46e;background:rgba(60,34,12,.9)}
#touch .rad .slot.sm{width:34px;height:34px;margin:-17px 0 0 -17px}
#touch .rad .slot.sm canvas{width:20px;height:20px}
#touch .rad canvas{width:24px;height:24px;image-rendering:pixelated}
#touch .rad .slot b{position:absolute;left:1px;top:0;font-size:11px;line-height:1;font-weight:700;color:#cfeaff;background:rgba(5,8,15,.82);padding:1px 3px;border-radius:3px}
/* the belt radial takes the screen: the other buttons step aside while it is open, so its slots never sit on them */
body.radial-open #touch .tb:not(#tb-belt),body.radial-open #nearbtn{visibility:hidden}
#rotate{position:fixed;inset:0;z-index:99;background:#05080f;color:#dff0ff;display:none;align-items:center;justify-content:center;flex-direction:column;text-align:center;font-family:'Jura',system-ui,sans-serif;font-weight:600}
#rotate b{font-family:'Pixelify Sans','Jura',sans-serif;font-size:26px;margin-bottom:10px}
`;

function btn(id: string, key: keyof typeof ICON, label: string, sq = false) {
  const b = document.createElement('div');
  b.id = id; b.className = 'tb' + (sq ? ' sq' : ''); b.setAttribute('role', 'button'); b.setAttribute('aria-label', label); b.title = label;
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[key]}</svg>`;
  layer!.appendChild(b); return b;
}
function hold(b: HTMLElement, down: () => void, up: () => void) {
  const ids = new Set<number>();
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); try { b.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ } ids.add(e.pointerId); b.classList.add('on'); input.touchActive = true; input.anyKey = true; down(); });
  const end = (e: PointerEvent) => { if (!ids.delete(e.pointerId)) return; if (!ids.size) { b.classList.remove('on'); up(); } };
  b.addEventListener('pointerup', end); b.addEventListener('pointercancel', end);
}

export function initTouch(uiRoot: HTMLElement) {
  if (root) return;
  root = uiRoot;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  layer = document.createElement('div'); layer.id = 'touch'; root.appendChild(layer);
  stickBase = document.createElement('div'); stickBase.className = 'stick'; layer.appendChild(stickBase);
  stickKnob = document.createElement('div'); stickKnob.className = 'knob'; layer.appendChild(stickKnob);
  ghost = document.createElement('div'); ghost.className = 'ghost'; ghost.textContent = S.moveHint; layer.appendChild(ghost);
  let seenStick = false; try { seenStick = localStorage.getItem('sc.stickHint') === '1'; } catch { /* no storage */ }
  if (!seenStick) ghost.style.display = 'block';

  const act = btn('tb-act', 'act', S.action);
  let actTimer = 0;
  hold(act, () => {
    actHeld = true; touch.primary = true; touch.smart = true; input.primaryPressed = true; input.hasAim = false; input.aimMode = 'smart';
    // long-press on a block ghost = dome (lean) mode
    actTimer = window.setTimeout(() => { if (touch.primary && inv.slots[inv.sel]?.id === 'snow_block') input.smartToggle = true; }, 650);
  }, () => { clearTimeout(actTimer); actHeld = false; touch.primary = touch.aimed; touch.smart = false; if (!touch.aimed) input.aimMode = 'touch'; });
  const jump = btn('tb-jump', 'jump', S.jump);
  hold(jump, () => { jumpBtn = true; touch.jumpHeld = true; input.jumpPressed = true; }, () => { jumpBtn = false; touch.jumpHeld = jumpStick; });
  const take = btn('tb-take', 'take', S.take);
  hold(take, () => { input.interactPressed = true; }, () => { /* one-shot */ });
  const belt = btn('tb-belt', 'belt', S.belt);
  hold(belt, () => { toggleRadial(); }, () => { /* toggle */ });
  const sens = btn('tb-senses', 'senses', S.senses);            // «Чутьё»: the senses overlay (engine/senses.ts, ui/sensesui.ts keeps the .act state)
  hold(sens, () => { input.sensesPressed = true; }, () => {});
  const parka = btn('tb-parka', 'parka', S.parka);              // «Парка»: the vent of the parka (V on desktop)
  hold(parka, () => { input.ventPressed = true; }, () => {});
  // top-right row: Сумка, Журнал, ⚙ меню (the settings panel is agent M's: it listens for 'sc:menu')
  const bag = btn('tb-bag', 'bag', S.bag, true);
  hold(bag, () => { input.craftPressed = true; }, () => {});
  const jour = btn('tb-jour', 'journal', S.journal, true);
  hold(jour, () => { input.journalPressed = true; }, () => {});
  const menu = btn('tb-menu', 'menu', S.menu, true);
  hold(menu, () => { window.dispatchEvent(new Event('sc:menu')); }, () => {});

  radial = document.createElement('div'); radial.className = 'rad'; layer.appendChild(radial);
  radial.addEventListener('pointerdown', (e) => { if (e.target === radial || (e.target as HTMLElement).classList.contains('cap')) { closeRadial(); e.preventDefault(); e.stopPropagation(); } });
  window.addEventListener('sc:radial', () => toggleRadial());

  rotateEl = document.createElement('div'); rotateEl.id = 'rotate';
  rotateEl.innerHTML = `<b>${S.rotate}</b><span>${S.rotateHint}</span>`;
  document.body.appendChild(rotateEl);

  // stick + world aim on the stage
  const stage = document.getElementById('stage') ?? document.body;
  let stickId = -1, aimId = -1;
  const wasUp = { v: false };
  // pinch (DESIGN §14): a second finger landing in the zone of a finger that is already steering (the stick on the left, the aim on the right)
  // turns both into a zoom gesture; every PINCH_STEP px of change in their distance is one zoom step
  const PINCH_STEP = 64;
  const pos = new Map<number, { x: number; y: number }>();
  let pinchA = -1, pinchB = -1, pinchRef = 0;
  const pdist = () => { const a = pos.get(pinchA), b = pos.get(pinchB); return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; };
  // the stick is fixed in the bottom-left corner (CSS .stick); its centre is read from the element so safe areas and resizes just work
  const stickCenter = () => {
    const r = stickBase!.getBoundingClientRect();
    if (r.width > 0) return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, r: r.width / 2 };
    return { cx: 18 + R, cy: window.innerHeight - 14 - R, r: R };
  };
  const parkKnob = () => { const c = stickCenter(); stickKnob!.style.left = c.cx + 'px'; stickKnob!.style.top = c.cy + 'px'; };
  syncStick = () => { R = Math.max(34, Math.min(56, window.innerHeight * 0.15)); parkKnob(); };
  const moveStick = (x: number, y: number) => {
    const c = stickCenter(); R = c.r;
    let dx = x - c.cx, dy = y - c.cy;
    const len = Math.hypot(dx, dy);
    if (len > R) { dx = dx / len * R; dy = dy / len * R; }
    stickKnob!.style.left = c.cx + dx + 'px'; stickKnob!.style.top = c.cy + dy + 'px';
    const nx = dx / R, ny = dy / R;
    touch.x = Math.abs(nx) < 0.18 ? 0 : Math.sign(nx) * Math.min(1, (Math.abs(nx) - 0.18) / 0.62);
    touch.run = Math.abs(nx) > 0.92;
    const up = ny < -0.55;
    if (up && !wasUp.v) input.jumpPressed = true;
    wasUp.v = up; jumpStick = up; touch.jumpHeld = up || jumpBtn;
    touch.down = ny > 0.6;
  };
  const releaseStick = () => { stickId = -1; touch.x = 0; touch.run = false; jumpStick = false; touch.jumpHeld = jumpBtn; touch.down = false; wasUp.v = false; parkKnob(); };
  const releaseAim = () => { aimId = -1; touch.aimed = false; touch.primary = actHeld; };
  const startPinch = (first: number, second: number) => {
    if (first === stickId) releaseStick(); else if (first === aimId) releaseAim();
    pinchA = first; pinchB = second; pinchRef = pdist();
  };
  stage.addEventListener('pointerdown', (ev) => {
    const e = ev as PointerEvent;
    if (e.pointerType !== 'touch') return;
    e.preventDefault();
    setEnabled(true);
    input.touchActive = true; input.anyKey = true;
    const sc = stickCenter(), left = e.clientX < sc.cx + sc.r * 1.9 && e.clientY > sc.cy - sc.r * 1.9;     // the stick zone: the bottom-left corner around the fixed stick; everything else aims
    pos.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchA < 0 && (left ? stickId >= 0 : aimId >= 0)) { startPinch(left ? stickId : aimId, e.pointerId); return; }
    if (pinchA >= 0) return;                                  // a third finger during a pinch: ignored
    if (left && stickId < 0) {
      stickId = e.pointerId;
      if (ghost && ghost.style.display !== 'none') { ghost.style.display = 'none'; try { localStorage.setItem('sc.stickHint', '1'); } catch { /* ignore */ } }
      moveStick(e.clientX, e.clientY);
    } else if (!left && aimId < 0) {
      aimId = e.pointerId; touch.aimed = true; touch.primary = true;
      input.aimX = e.clientX; input.aimY = e.clientY - AIM_LIFT; input.hasAim = true; input.aimMode = 'touch'; input.primaryPressed = true;
    }
  });
  addEventListener('pointermove', (ev) => {
    const e = ev as PointerEvent;
    if (e.pointerType !== 'touch') return;
    const pp = pos.get(e.pointerId); if (pp) { pp.x = e.clientX; pp.y = e.clientY; }
    if (pinchA >= 0) {
      if (e.pointerId === pinchA || e.pointerId === pinchB) {
        const d = pdist();
        while (d - pinchRef >= PINCH_STEP) { stepZoom(1); pinchRef += PINCH_STEP; }            // fingers apart = closer
        while (pinchRef - d >= PINCH_STEP) { stepZoom(-1); pinchRef -= PINCH_STEP; }
      }
      return;
    }
    if (e.pointerId === stickId) {
      moveStick(e.clientX, e.clientY);
    } else if (e.pointerId === aimId) {
      input.aimX = e.clientX; input.aimY = e.clientY - AIM_LIFT;
    }
  });
  const end = (ev: Event) => {
    const e = ev as PointerEvent;
    if (e.pointerType !== 'touch') return;
    pos.delete(e.pointerId);
    if (e.pointerId === pinchA || e.pointerId === pinchB) { pinchA = pinchB = -1; return; }       // a pinch ends with the first finger up; the other one stays idle until lifted
    if (e.pointerId === stickId) {
      stickId = -1; touch.x = 0; touch.run = false; jumpStick = false; touch.jumpHeld = jumpBtn; touch.down = false; wasUp.v = false;
      parkKnob();
    } else if (e.pointerId === aimId) { aimId = -1; touch.aimed = false; touch.primary = actHeld; }
  };
  addEventListener('pointerup', end); addEventListener('pointercancel', end);

  const mq = matchMedia('(orientation: portrait)');
  const upd = () => {
    const portrait = mq.matches && enabled;
    rotateEl!.style.display = portrait ? 'flex' : 'none';
    // only undo a pause that the rotate overlay itself caused (a manual pause survives a rotation)
    if (portrait && !G.paused) { G.paused = true; rotatePaused = true; }
    else if (!portrait && rotatePaused) { G.paused = false; rotatePaused = false; }
  };
  mq.addEventListener?.('change', upd);
  addEventListener('resize', () => { upd(); syncStick(); });
  initWheel(uiRoot);
  setEnabled(G.mobile);
  // a first touch anywhere enables the controls on hybrid devices
  addEventListener('touchstart', () => setEnabled(true), { once: true, passive: true });
  upd(); syncStick();
}

export function setEnabled(on: boolean) {
  enabled = on;
  if (layer) layer.style.display = on ? 'block' : 'none';
  if (rotateEl && !on) rotateEl.style.display = 'none';
  document.body.classList.toggle('touch-ui', on);
  if (on) requestAnimationFrame(() => syncStick());
  if (on && matchMedia('(orientation: portrait)').matches && rotateEl) { rotateEl.style.display = 'flex'; if (!G.paused) { G.paused = true; rotatePaused = true; } }
}
export const touchEnabled = () => enabled;

function closeRadial() { if (radial) radial.style.display = 'none'; document.body.classList.remove('radial-open'); clearTimeout(radialTimer); }
function toggleRadial() {
  if (!radial) return;
  if (radial.style.display === 'block') { closeRadial(); return; }
  radial.innerHTML = '';
  // an arc of the six belt slots around the Пояс button (right-hand cluster): opens up and to the left, so the thumb that pressed it stays near the choice
  const W = window.innerWidth, Hh = window.innerHeight;
  const br = document.getElementById('tb-belt')?.getBoundingClientRect();
  // the belt cells in key order: six, and the three of the belt pouch (keys 7-9) when it is carried (DESIGN §17): nine slots on a wider arc
  const cells = beltCells(), nc = cells.length, more = nc > 6;
  const live = !!br && br.width > 0;
  const cx = live ? br!.left + br!.width / 2 : W - 150, cy = live ? br!.top + br!.height / 2 : Hh - 120;
  // slots never touch each other: six 44 px slots on a 0.62 pi arc, nine 34 px slots on 0.70 pi; the arc's top slot stays on screen
  const sr = more ? 17 : 22, rad = Math.min(more ? 150 : 140, cy - sr - 8), span = more ? 0.70 : 0.62, xs: number[] = [];
  for (let k = 0; k < nc; k++) {
    const i = cells[k];
    const a = Math.PI * (0.92 + span * k / (nc - 1));          // from the left of the button, over the top, to straight above it
    const el = document.createElement('div'); el.className = 'slot' + (i === inv.sel ? ' sel' : '') + (more ? ' sm' : '');
    const sx = Math.max(sr + 4, Math.min(W - sr - 4, cx + Math.cos(a) * rad)); xs.push(sx);
    el.style.left = sx + 'px'; el.style.top = Math.max(sr + 4, Math.min(Hh - sr - 4, cy + Math.sin(a) * rad)) + 'px';
    const s = inv.slots[i];
    const n = document.createElement('b'); n.textContent = String(k + 1); el.appendChild(n);
    if (s) { const c = icon(getItem(s.id).icon); const cc = document.createElement('canvas'); cc.width = c.width; cc.height = c.height; cc.getContext('2d')!.drawImage(c, 0, 0); el.appendChild(cc); el.title = itemName(s.id); }
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); select(i); closeRadial(); });
    radial.appendChild(el);
  }
  const cap = document.createElement('div'); cap.className = 'cap';        // the caption sits above the belt, left of the arc: clear of the arc, the objective and the top row
  const edge = Math.max(60, Math.min(...xs) - sr - 10);                       // its right edge: just left of the arc's outermost slot
  cap.style.right = (W - edge) + 'px'; cap.style.maxWidth = (edge - 8) + 'px';
  const sel = inv.slots[inv.sel]; cap.textContent = (sel ? itemName(sel.id) + ' · ' : '') + S.radialCap; radial.appendChild(cap);
  radial.style.display = 'block'; document.body.classList.add('radial-open');
  clearTimeout(radialTimer); radialTimer = window.setTimeout(closeRadial, 7000);
}

// ---------------------------------------------------------------------------------------------------------------------
// desktop belt wheel: hold Q, flick the mouse towards a slot (top = 1, clockwise), release Q. Same glass slots / amber selection / caption as the phone wheel.
let wheel: HTMLElement | null = null, wheelHov = -1, wheelCx = 0, wheelCy = 0, wheelIsOpen = false;
let wheelCells: number[] = [0, 1, 2, 3, 4, 5];           // the belt cells of this wheel (six, nine with the pouch); wheelHov indexes them
const WHEEL_R = 112;
export const wheelOpen = () => wheelIsOpen;
function wheelHtml() {
  if (!wheel) return;
  wheel.innerHTML = '';
  const nc = wheelCells.length;
  for (let k = 0; k < nc; k++) {
    const i = wheelCells[k];
    const a = -Math.PI / 2 + k * (Math.PI * 2 / nc);
    const el = document.createElement('div'); el.className = 'slot' + (i === inv.sel ? ' cur' : '') + (k === wheelHov ? ' hov' : ''); el.dataset.i = String(i);
    el.style.left = wheelCx + Math.cos(a) * WHEEL_R + 'px'; el.style.top = wheelCy + Math.sin(a) * WHEEL_R + 'px';
    const n = document.createElement('b'); n.textContent = String(k + 1); el.appendChild(n);
    const s = inv.slots[i];
    if (s) {
      const c = icon(getItem(s.id).icon); const cc = document.createElement('canvas'); cc.width = c.width; cc.height = c.height; cc.getContext('2d')!.drawImage(c, 0, 0); el.appendChild(cc);
      if (s.n > 1) { const q = document.createElement('i'); q.textContent = String(s.n); el.appendChild(q); }
    }
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); select(i); closeWheel(false); });
    wheel.appendChild(el);
  }
  const mid = document.createElement('div'); mid.className = 'mid'; mid.style.left = wheelCx + 'px'; mid.style.top = wheelCy + WHEEL_R + 58 + 'px';   // under the ring: the middle belongs to the player
  const sl = inv.slots[wheelHov >= 0 ? wheelCells[wheelHov] : inv.sel];
  mid.innerHTML = (sl ? itemName(sl.id) : S.wheelEmpty) + `<small>${S.wheelCap}</small>`;
  wheel.appendChild(mid);
}
function openWheel() {
  if (!wheel || wheelIsOpen || document.body.classList.contains('title-open') || document.body.classList.contains('touch-ui') || !G.player?.alive) return;
  const [sx, sy] = worldToScreen(G.player.x, G.player.y - 10);
  wheelCx = Math.max(WHEEL_R + 40, Math.min(window.innerWidth - WHEEL_R - 40, sx)); wheelCy = Math.max(WHEEL_R + 40, Math.min(window.innerHeight - WHEEL_R - 40, sy));
  wheel.style.setProperty('--wx', wheelCx + 'px'); wheel.style.setProperty('--wy', wheelCy + 'px');
  wheelCells = beltCells();
  wheelHov = -1; wheelIsOpen = true; wheel.classList.add('open'); wheelHtml();
}
function closeWheel(apply: boolean) {
  if (!wheel || !wheelIsOpen) return;
  if (apply && wheelHov >= 0) select(wheelCells[wheelHov]);
  wheelIsOpen = false; wheel.classList.remove('open'); wheelHov = -1;
}
function wheelAim(x: number, y: number) {
  if (!wheelIsOpen) return;
  const dx = x - wheelCx, dy = y - wheelCy;
  let h = -1;
  const nc = wheelCells.length;
  if (Math.hypot(dx, dy) > 34) { const a = Math.atan2(dy, dx) + Math.PI / 2; h = Math.round(((a % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2 / nc)) % nc; }
  if (h !== wheelHov) { wheelHov = h; wheelHtml(); }
}
function initWheel(host: HTMLElement) {
  wheel = document.createElement('div'); wheel.id = 'wheel'; host.appendChild(wheel);
  addEventListener('keydown', (e) => { if (e.code === 'KeyQ' && !e.repeat && !(e.target as HTMLElement)?.closest?.('input,textarea')) openWheel(); });
  addEventListener('keyup', (e) => { if (e.code === 'KeyQ') closeWheel(true); });
  addEventListener('blur', () => closeWheel(false));
  addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') wheelAim(e.clientX, e.clientY); });
  /** test hook: aim the wheel at a screen point without a real mouse */
  (window as unknown as { __wheel?: unknown }).__wheel = { open: openWheel, close: closeWheel, aim: wheelAim };
}
