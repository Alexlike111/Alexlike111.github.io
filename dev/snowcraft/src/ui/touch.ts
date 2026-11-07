// Phone controls (SPEC §1, DESIGN §10): floating left stick (up = jump, far = run), right-hand buttons >= 56 px:
// Действие (hold, smart cursor) / Прыжок / Взять / Пояс (radial of the belt) / Сумка / Журнал / Парка. Touching the world aims there and holds the action.
// "Поверни телефон" overlay in portrait. Safe-area insets respected. Writes into engine/input.ts.
import { input, touch } from '../engine/input';
import { G } from '../game/state';
import { strings } from '../content/i18n';
import { inv, select, BELT } from '../game/inventory';
import { getItem, itemName } from '../game/items';
import { icon } from '../engine/sprites';
import { worldToScreen } from '../engine/render';
import { stepZoom } from '../engine/zoom';

const S = strings('touch', {
  action: 'Действие', jump: 'Прыжок', take: 'Взять', belt: 'Пояс', bag: 'Сумка', journal: 'Журнал', parka: 'Парка',
  senses: 'Чутьё', rotate: 'Поверни телефон', rotateHint: 'SNOWCRAFT играется в альбомной ориентации',
  zoomIn: 'Ближе', zoomOut: 'Дальше', moveHint: 'тяни: ходьба', radialCap: 'Выбери предмет · тап мимо — закрыть', wheelCap: 'Мышь к предмету · отпусти Q', wheelEmpty: 'пусто',
});

let root: HTMLElement | null = null;
let layer: HTMLElement | null = null;
let radial: HTMLElement | null = null;
let rotateEl: HTMLElement | null = null;
let stickBase: HTMLElement | null = null, stickKnob: HTMLElement | null = null;
let enabled = false;
let jumpBtn = false, jumpStick = false, actHeld = false, rotatePaused = false;
let ghost: HTMLElement | null = null;
let radialTimer = 0;
const R = 56;                                   // stick radius px

const CSS = `
#touch{position:fixed;inset:0;z-index:30;pointer-events:none;touch-action:none;-webkit-user-select:none;user-select:none;font-family:'Jura',system-ui,sans-serif;font-weight:700;
  padding:env(safe-area-inset-top,0) env(safe-area-inset-right,0) env(safe-area-inset-bottom,0) env(safe-area-inset-left,0)}
#touch .tb{box-sizing:border-box;position:absolute;pointer-events:auto;touch-action:none;display:flex;align-items:center;justify-content:center;text-align:center;color:#dff0ff;
  background:rgba(14,26,44,.62);border:2px solid rgba(124,198,238,.55);border-radius:50%;font-size:13px;line-height:1.05;letter-spacing:.2px;
  backdrop-filter:blur(2px);-webkit-tap-highlight-color:transparent}
#touch .tb.sq{border-radius:12px;font-size:13px;padding:0 2px}
#touch .tb:active,#touch .tb.on{background:rgba(124,198,238,.45);border-color:#cfeaff}
#touch #tb-act{width:92px;height:92px;right:calc(18px + env(safe-area-inset-right,0px));bottom:calc(18px + env(safe-area-inset-bottom,0px));font-size:15px;border-color:rgba(255,196,110,.8);background:rgba(60,34,12,.55)}
#touch #tb-jump{width:68px;height:68px;right:calc(124px + env(safe-area-inset-right,0px));bottom:calc(12px + env(safe-area-inset-bottom,0px))}
#touch #tb-take{width:60px;height:60px;right:calc(30px + env(safe-area-inset-right,0px));bottom:calc(120px + env(safe-area-inset-bottom,0px))}
#touch #tb-belt{width:58px;height:58px;right:calc(126px + env(safe-area-inset-right,0px));bottom:calc(96px + env(safe-area-inset-bottom,0px))}
#touch #tb-senses{width:58px;height:58px;right:calc(112px + env(safe-area-inset-right,0px));bottom:calc(184px + env(safe-area-inset-bottom,0px));font-size:13px}
#touch #tb-senses.act{background:rgba(40,120,96,.62);border-color:#8cf5cf;color:#eafff7}
#touch #tb-bag{width:64px;height:50px;right:calc(152px + env(safe-area-inset-right,0px));top:calc(8px + env(safe-area-inset-top,0px))}
#touch #tb-jour{width:64px;height:50px;right:calc(82px + env(safe-area-inset-right,0px));top:calc(8px + env(safe-area-inset-top,0px))}
#touch #tb-parka{width:64px;height:50px;right:calc(12px + env(safe-area-inset-right,0px));top:calc(8px + env(safe-area-inset-top,0px))}
#touch #tb-zin,#touch #tb-zout{width:44px;height:44px;left:calc(10px + env(safe-area-inset-left,0px));font-size:24px;font-weight:700;line-height:1;background:rgba(14,26,44,.55)}
#touch #tb-zin{top:calc(74px + env(safe-area-inset-top,0px))}
#touch #tb-zout{top:calc(124px + env(safe-area-inset-top,0px))}
#touch .stick{position:absolute;width:${R * 2}px;height:${R * 2}px;margin:-${R}px 0 0 -${R}px;border-radius:50%;border:2px solid rgba(190,226,250,.7);background:rgba(14,26,44,.4);display:none}
#touch .ghost{position:absolute;left:calc(104px + env(safe-area-inset-left,0px));bottom:calc(72px + env(safe-area-inset-bottom,0px));width:${R * 2}px;height:${R * 2}px;margin-left:-${R}px;border-radius:50%;border:2px dashed rgba(190,226,250,.38);display:none;align-items:center;justify-content:center;pointer-events:none;animation:scghost 2.4s ease-in-out infinite}
#touch .ghost i{width:34px;height:34px;border-radius:50%;background:rgba(190,226,250,.22);border:2px solid rgba(190,226,250,.45)}
#touch .ghost span{position:absolute;top:-22px;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:12px;color:#cfeaff;text-shadow:0 1px 0 #05080f}
@keyframes scghost{0%,100%{opacity:.55}50%{opacity:1}}
#touch .knob{position:absolute;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;background:rgba(190,226,250,.5);border:2px solid #cfeaff;display:none}
#touch .rad{position:absolute;inset:0;pointer-events:auto;display:none;background:linear-gradient(0deg,rgba(5,9,16,.5),rgba(5,9,16,0) 45%)}
#touch .rad .cap{position:absolute;width:max-content;max-width:62vw;box-sizing:border-box;text-align:right;font:700 13px 'Jura',system-ui,sans-serif;color:#e8f4ff;text-shadow:0 1px 0 #05080f;background:rgba(8,16,30,.88);border:1px solid rgba(124,198,238,.4);border-radius:4px;padding:4px 10px}
#touch .rad .slot{position:absolute;width:50px;height:50px;margin:-25px 0 0 -25px;border-radius:50%;background:rgba(14,26,44,.9);border:2px solid rgba(124,198,238,.6);
  display:flex;flex-direction:column;align-items:center;justify-content:center;color:#dff0ff;font-size:13px;text-align:center}
#touch .rad .slot.sel{border-color:#ffc46e;background:rgba(60,34,12,.9)}
#touch .rad canvas{width:28px;height:28px;image-rendering:pixelated}
#touch .rad .slot b{position:absolute;left:2px;top:1px;font-size:13px;line-height:1;font-weight:700;color:#cfeaff;background:rgba(5,8,15,.82);padding:1px 4px;border-radius:3px}
#rotate{position:fixed;inset:0;z-index:99;background:#05080f;color:#dff0ff;display:none;align-items:center;justify-content:center;flex-direction:column;text-align:center;font-family:'Jura',system-ui,sans-serif;font-weight:600}
#rotate b{font-family:'Pixelify Sans','Jura',sans-serif;font-size:26px;margin-bottom:10px}
`;

function btn(id: string, label: string, sq = false) {
  const b = document.createElement('div');
  b.id = id; b.className = 'tb' + (sq ? ' sq' : ''); b.textContent = label; layer!.appendChild(b); return b;
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
  ghost = document.createElement('div'); ghost.className = 'ghost'; ghost.innerHTML = '<i></i><span>' + S.moveHint + '</span>'; layer.appendChild(ghost);
  let seenStick = false; try { seenStick = localStorage.getItem('sc.stickHint') === '1'; } catch { /* no storage */ }
  if (!seenStick) ghost.style.display = 'flex';

  const act = btn('tb-act', S.action);
  let actTimer = 0;
  hold(act, () => {
    actHeld = true; touch.primary = true; touch.smart = true; input.primaryPressed = true; input.hasAim = false; input.aimMode = 'smart';
    // long-press on a block ghost = dome (lean) mode
    actTimer = window.setTimeout(() => { if (touch.primary && inv.slots[inv.sel]?.id === 'snow_block') input.smartToggle = true; }, 650);
  }, () => { clearTimeout(actTimer); actHeld = false; touch.primary = touch.aimed; touch.smart = false; if (!touch.aimed) input.aimMode = 'touch'; });
  const jump = btn('tb-jump', S.jump);
  hold(jump, () => { jumpBtn = true; touch.jumpHeld = true; input.jumpPressed = true; }, () => { jumpBtn = false; touch.jumpHeld = jumpStick; });
  const take = btn('tb-take', S.take);
  hold(take, () => { input.interactPressed = true; }, () => { /* one-shot */ });
  const belt = btn('tb-belt', S.belt);
  hold(belt, () => { toggleRadial(); }, () => { /* toggle */ });
  const bag = btn('tb-bag', S.bag, true);
  hold(bag, () => { input.craftPressed = true; }, () => {});
  const jour = btn('tb-jour', S.journal, true);
  hold(jour, () => { input.journalPressed = true; }, () => {});
  const parka = btn('tb-parka', S.parka, true);
  hold(parka, () => { input.ventPressed = true; }, () => {});
  const zin = btn('tb-zin', '+'), zout = btn('tb-zout', '−');                  // zoom (DESIGN §14): small buttons on the free left edge, under the body panel
  zin.setAttribute('aria-label', S.zoomIn); zout.setAttribute('aria-label', S.zoomOut);
  hold(zin, () => { stepZoom(1); }, () => {}); hold(zout, () => { stepZoom(-1); }, () => {});
  const sens = btn('tb-senses', S.senses);                      // «Чутьё»: the senses overlay (engine/senses.ts, ui/sensesui.ts keeps the .act state)
  hold(sens, () => { input.sensesPressed = true; }, () => {});

  radial = document.createElement('div'); radial.className = 'rad'; layer.appendChild(radial);
  radial.addEventListener('pointerdown', (e) => { if (e.target === radial || (e.target as HTMLElement).classList.contains('cap')) { closeRadial(); e.preventDefault(); e.stopPropagation(); } });
  window.addEventListener('sc:radial', () => toggleRadial());

  rotateEl = document.createElement('div'); rotateEl.id = 'rotate';
  rotateEl.innerHTML = `<b>${S.rotate}</b><span>${S.rotateHint}</span>`;
  document.body.appendChild(rotateEl);

  // stick + world aim on the stage
  const stage = document.getElementById('stage') ?? document.body;
  let stickId = -1, sx = 0, sy = 0, aimId = -1;
  const wasUp = { v: false };
  // pinch (DESIGN §14): a second finger landing in the zone of a finger that is already steering (the stick on the left, the aim on the right)
  // turns both into a zoom gesture; every PINCH_STEP px of change in their distance is one zoom step
  const PINCH_STEP = 64;
  const pos = new Map<number, { x: number; y: number }>();
  let pinchA = -1, pinchB = -1, pinchRef = 0;
  const pdist = () => { const a = pos.get(pinchA), b = pos.get(pinchB); return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; };
  const releaseStick = () => { stickId = -1; touch.x = 0; touch.run = false; jumpStick = false; touch.jumpHeld = jumpBtn; touch.down = false; wasUp.v = false; stickBase!.style.display = stickKnob!.style.display = 'none'; };
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
    const left = e.clientX < window.innerWidth * 0.4;
    pos.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchA < 0 && (left ? stickId >= 0 : aimId >= 0)) { startPinch(left ? stickId : aimId, e.pointerId); return; }
    if (pinchA >= 0) return;                                  // a third finger during a pinch: ignored
    if (left && stickId < 0) {
      stickId = e.pointerId; sx = e.clientX; sy = e.clientY;
      if (ghost && ghost.style.display !== 'none') { ghost.style.display = 'none'; try { localStorage.setItem('sc.stickHint', '1'); } catch { /* ignore */ } }
      for (const el of [stickBase!, stickKnob!]) { el.style.display = 'block'; el.style.left = sx + 'px'; el.style.top = sy + 'px'; }
    } else if (!left && aimId < 0) {
      aimId = e.pointerId; touch.aimed = true; touch.primary = true;
      input.aimX = e.clientX; input.aimY = e.clientY; input.hasAim = true; input.aimMode = 'touch'; input.primaryPressed = true;
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
      let dx = e.clientX - sx, dy = e.clientY - sy;
      const len = Math.hypot(dx, dy);
      if (len > R) { dx = dx / len * R; dy = dy / len * R; }
      stickKnob!.style.left = sx + dx + 'px'; stickKnob!.style.top = sy + dy + 'px';
      const nx = dx / R, ny = dy / R;
      touch.x = Math.abs(nx) < 0.18 ? 0 : Math.sign(nx) * Math.min(1, (Math.abs(nx) - 0.18) / 0.62);
      touch.run = Math.abs(nx) > 0.92;
      const up = ny < -0.55;
      if (up && !wasUp.v) input.jumpPressed = true;
      wasUp.v = up; jumpStick = up; touch.jumpHeld = up || jumpBtn;
      touch.down = ny > 0.6;
    } else if (e.pointerId === aimId) {
      input.aimX = e.clientX; input.aimY = e.clientY;
    }
  });
  const end = (ev: Event) => {
    const e = ev as PointerEvent;
    if (e.pointerType !== 'touch') return;
    pos.delete(e.pointerId);
    if (e.pointerId === pinchA || e.pointerId === pinchB) { pinchA = pinchB = -1; return; }       // a pinch ends with the first finger up; the other one stays idle until lifted
    if (e.pointerId === stickId) {
      stickId = -1; touch.x = 0; touch.run = false; jumpStick = false; touch.jumpHeld = jumpBtn; touch.down = false; wasUp.v = false;
      stickBase!.style.display = stickKnob!.style.display = 'none';
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
  addEventListener('resize', upd);
  initWheel(uiRoot);
  setEnabled(G.mobile);
  // a first touch anywhere enables the controls on hybrid devices
  addEventListener('touchstart', () => setEnabled(true), { once: true, passive: true });
  upd();
}

export function setEnabled(on: boolean) {
  enabled = on;
  if (layer) layer.style.display = on ? 'block' : 'none';
  if (rotateEl && !on) rotateEl.style.display = 'none';
  document.body.classList.toggle('touch-ui', on);
  if (on && matchMedia('(orientation: portrait)').matches && rotateEl) { rotateEl.style.display = 'flex'; if (!G.paused) { G.paused = true; rotatePaused = true; } }
}
export const touchEnabled = () => enabled;

function closeRadial() { if (radial) radial.style.display = 'none'; clearTimeout(radialTimer); }
function toggleRadial() {
  if (!radial) return;
  if (radial.style.display === 'block') { closeRadial(); return; }
  radial.innerHTML = '';
  // an arc of the six belt slots around the Пояс button (right-hand cluster): opens up and to the left, so the thumb that pressed it stays near the choice
  const W = window.innerWidth, Hh = window.innerHeight;
  const br = document.getElementById('tb-belt')?.getBoundingClientRect();
  const cx = br ? br.left + br.width / 2 : W - 150, cy = br ? br.top + br.height / 2 : Hh - 120, rad = Math.min(140, Hh * 0.36);
  for (let i = 0; i < BELT; i++) {
    const a = Math.PI * (0.92 + 0.62 * i / (BELT - 1));          // from the left of the button, over the top, to straight above it
    const el = document.createElement('div'); el.className = 'slot' + (i === inv.sel ? ' sel' : '');
    el.style.left = Math.max(30, Math.min(W - 30, cx + Math.cos(a) * rad)) + 'px'; el.style.top = Math.max(30, Math.min(Hh - 30, cy + Math.sin(a) * rad)) + 'px';
    const s = inv.slots[i];
    const n = document.createElement('b'); n.textContent = String(i + 1); el.appendChild(n);
    if (s) { const c = icon(getItem(s.id).icon); const cc = document.createElement('canvas'); cc.width = c.width; cc.height = c.height; cc.getContext('2d')!.drawImage(c, 0, 0); el.appendChild(cc); el.title = itemName(s.id); }
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); select(i); closeRadial(); });
    radial.appendChild(el);
  }
  const cap = document.createElement('div'); cap.className = 'cap'; cap.style.top = Math.max(4, cy - rad - 56) + 'px'; cap.style.right = Math.max(4, W - cx - 40) + 'px';
  const sel = inv.slots[inv.sel]; cap.textContent = (sel ? itemName(sel.id) + ' · ' : '') + S.radialCap; radial.appendChild(cap);
  radial.style.display = 'block';
  clearTimeout(radialTimer); radialTimer = window.setTimeout(closeRadial, 7000);
}

// ---------------------------------------------------------------------------------------------------------------------
// desktop belt wheel: hold Q, flick the mouse towards a slot (top = 1, clockwise), release Q. Same glass slots / amber selection / caption as the phone wheel.
let wheel: HTMLElement | null = null, wheelHov = -1, wheelCx = 0, wheelCy = 0, wheelIsOpen = false;
const WHEEL_R = 112;
export const wheelOpen = () => wheelIsOpen;
function wheelHtml() {
  if (!wheel) return;
  wheel.innerHTML = '';
  for (let i = 0; i < BELT; i++) {
    const a = -Math.PI / 2 + i * (Math.PI * 2 / BELT);
    const el = document.createElement('div'); el.className = 'slot' + (i === inv.sel ? ' cur' : '') + (i === wheelHov ? ' hov' : ''); el.dataset.i = String(i);
    el.style.left = wheelCx + Math.cos(a) * WHEEL_R + 'px'; el.style.top = wheelCy + Math.sin(a) * WHEEL_R + 'px';
    const n = document.createElement('b'); n.textContent = String(i + 1); el.appendChild(n);
    const s = inv.slots[i];
    if (s) {
      const c = icon(getItem(s.id).icon); const cc = document.createElement('canvas'); cc.width = c.width; cc.height = c.height; cc.getContext('2d')!.drawImage(c, 0, 0); el.appendChild(cc);
      if (s.n > 1) { const q = document.createElement('i'); q.textContent = String(s.n); el.appendChild(q); }
    }
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); select(i); closeWheel(false); });
    wheel.appendChild(el);
  }
  const mid = document.createElement('div'); mid.className = 'mid'; mid.style.left = wheelCx + 'px'; mid.style.top = wheelCy + WHEEL_R + 58 + 'px';   // under the ring: the middle belongs to the player
  const sl = inv.slots[wheelHov >= 0 ? wheelHov : inv.sel];
  mid.innerHTML = (sl ? itemName(sl.id) : S.wheelEmpty) + `<small>${S.wheelCap}</small>`;
  wheel.appendChild(mid);
}
function openWheel() {
  if (!wheel || wheelIsOpen || document.body.classList.contains('title-open') || document.body.classList.contains('touch-ui') || !G.player?.alive) return;
  const [sx, sy] = worldToScreen(G.player.x, G.player.y - 10);
  wheelCx = Math.max(WHEEL_R + 40, Math.min(window.innerWidth - WHEEL_R - 40, sx)); wheelCy = Math.max(WHEEL_R + 40, Math.min(window.innerHeight - WHEEL_R - 40, sy));
  wheel.style.setProperty('--wx', wheelCx + 'px'); wheel.style.setProperty('--wy', wheelCy + 'px');
  wheelHov = -1; wheelIsOpen = true; wheel.classList.add('open'); wheelHtml();
}
function closeWheel(apply: boolean) {
  if (!wheel || !wheelIsOpen) return;
  if (apply && wheelHov >= 0) select(wheelHov);
  wheelIsOpen = false; wheel.classList.remove('open'); wheelHov = -1;
}
function wheelAim(x: number, y: number) {
  if (!wheelIsOpen) return;
  const dx = x - wheelCx, dy = y - wheelCy;
  let h = -1;
  if (Math.hypot(dx, dy) > 34) { const a = Math.atan2(dy, dx) + Math.PI / 2; h = Math.round(((a % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2 / BELT)) % BELT; }
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
