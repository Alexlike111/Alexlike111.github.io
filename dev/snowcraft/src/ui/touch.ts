// Phone controls (SPEC §1, DESIGN §10): floating left stick (up = jump, far = run), right-hand buttons >= 56 px:
// Действие (hold, smart cursor) / Прыжок / Взять / Пояс (radial of the belt) / Сумка / Журнал / Парка. Touching the world aims there and holds the action.
// "Поверни телефон" overlay in portrait. Safe-area insets respected. Writes into engine/input.ts.
import { input, touch } from '../engine/input';
import { G } from '../game/state';
import { strings } from '../content/i18n';
import { inv, select, BELT } from '../game/inventory';
import { getItem, itemName } from '../game/items';
import { icon } from '../engine/sprites';

const S = strings('touch', {
  action: 'Действие', jump: 'Прыжок', take: 'Взять', belt: 'Пояс', bag: 'Сумка', journal: 'Журнал', parka: 'Парка',
  rotate: 'Поверни телефон', rotateHint: 'SNOWCRAFT играется в альбомной ориентации',
  moveHint: 'тяни: ходьба', radialCap: 'Выбери предмет · тап мимо — закрыть',
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
#touch{position:fixed;inset:0;z-index:30;pointer-events:none;touch-action:none;-webkit-user-select:none;user-select:none;font-family:'Pixelify Sans','Jura',system-ui,sans-serif;
  padding:env(safe-area-inset-top,0) env(safe-area-inset-right,0) env(safe-area-inset-bottom,0) env(safe-area-inset-left,0)}
#touch .tb{position:absolute;pointer-events:auto;touch-action:none;display:flex;align-items:center;justify-content:center;text-align:center;color:#dff0ff;
  background:rgba(14,26,44,.62);border:2px solid rgba(124,198,238,.55);border-radius:50%;font-size:13px;line-height:1.05;letter-spacing:.2px;
  backdrop-filter:blur(2px);-webkit-tap-highlight-color:transparent}
#touch .tb.sq{border-radius:12px}
#touch .tb:active,#touch .tb.on{background:rgba(124,198,238,.45);border-color:#cfeaff}
#touch #tb-act{width:92px;height:92px;right:calc(18px + env(safe-area-inset-right,0px));bottom:calc(18px + env(safe-area-inset-bottom,0px));font-size:15px;border-color:rgba(255,196,110,.8);background:rgba(60,34,12,.55)}
#touch #tb-jump{width:68px;height:68px;right:calc(124px + env(safe-area-inset-right,0px));bottom:calc(12px + env(safe-area-inset-bottom,0px))}
#touch #tb-take{width:60px;height:60px;right:calc(30px + env(safe-area-inset-right,0px));bottom:calc(120px + env(safe-area-inset-bottom,0px))}
#touch #tb-belt{width:58px;height:58px;right:calc(112px + env(safe-area-inset-right,0px));bottom:calc(88px + env(safe-area-inset-bottom,0px))}
#touch #tb-bag{width:58px;height:50px;right:calc(150px + env(safe-area-inset-right,0px));top:calc(8px + env(safe-area-inset-top,0px))}
#touch #tb-jour{width:58px;height:50px;right:calc(84px + env(safe-area-inset-right,0px));top:calc(8px + env(safe-area-inset-top,0px))}
#touch #tb-parka{width:58px;height:50px;right:calc(12px + env(safe-area-inset-right,0px));top:calc(8px + env(safe-area-inset-top,0px))}
#touch .stick{position:absolute;width:${R * 2}px;height:${R * 2}px;margin:-${R}px 0 0 -${R}px;border-radius:50%;border:2px solid rgba(190,226,250,.7);background:rgba(14,26,44,.4);display:none}
#touch .ghost{position:absolute;left:calc(104px + env(safe-area-inset-left,0px));bottom:calc(72px + env(safe-area-inset-bottom,0px));width:${R * 2}px;height:${R * 2}px;margin-left:-${R}px;border-radius:50%;border:2px dashed rgba(190,226,250,.38);display:none;align-items:center;justify-content:center;pointer-events:none;animation:scghost 2.4s ease-in-out infinite}
#touch .ghost i{width:34px;height:34px;border-radius:50%;background:rgba(190,226,250,.22);border:2px solid rgba(190,226,250,.45)}
#touch .ghost span{position:absolute;top:-22px;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:12px;color:#cfeaff;text-shadow:0 1px 0 #05080f}
@keyframes scghost{0%,100%{opacity:.55}50%{opacity:1}}
#touch .knob{position:absolute;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;background:rgba(190,226,250,.5);border:2px solid #cfeaff;display:none}
#touch .rad{position:absolute;inset:0;pointer-events:auto;display:none;background:linear-gradient(0deg,rgba(5,9,16,.5),rgba(5,9,16,0) 45%)}
#touch .rad .cap{position:absolute;left:0;right:0;text-align:center;font:600 13px 'Jura',system-ui,sans-serif;color:#cfeaff;text-shadow:0 1px 0 #05080f}
#touch .rad .slot{position:absolute;width:50px;height:50px;margin:-25px 0 0 -25px;border-radius:50%;background:rgba(14,26,44,.9);border:2px solid rgba(124,198,238,.6);
  display:flex;flex-direction:column;align-items:center;justify-content:center;color:#dff0ff;font-size:10px;text-align:center}
#touch .rad .slot.sel{border-color:#ffc46e;background:rgba(60,34,12,.9)}
#touch .rad canvas{width:28px;height:28px;image-rendering:pixelated}
#touch .rad .slot b{position:absolute;left:3px;top:0;font-size:10px;font-weight:400;color:#8ab0c8}
#rotate{position:fixed;inset:0;z-index:99;background:#05080f;color:#dff0ff;display:none;align-items:center;justify-content:center;flex-direction:column;text-align:center;font-family:'Pixelify Sans',system-ui,sans-serif}
#rotate b{font-size:26px;margin-bottom:10px}
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
  stage.addEventListener('pointerdown', (ev) => {
    const e = ev as PointerEvent;
    if (e.pointerType !== 'touch') return;
    e.preventDefault();
    setEnabled(true);
    input.touchActive = true; input.anyKey = true;
    const left = e.clientX < window.innerWidth * 0.4;
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
  // an arc of the six belt slots opening upward from the belt chip at the bottom centre (the player in the middle of the screen stays visible)
  const W = window.innerWidth, Hh = window.innerHeight;
  const cx = W / 2 - 40, cy = Hh - 66, rad = Math.min(92, Hh * 0.3);
  for (let i = 0; i < BELT; i++) {
    const a = Math.PI * (1.08 + 0.84 * i / (BELT - 1));        // from lower-left over the top to lower-right
    const el = document.createElement('div'); el.className = 'slot' + (i === inv.sel ? ' sel' : '');
    el.style.left = cx + Math.cos(a) * rad * 1.25 + 'px'; el.style.top = cy + Math.sin(a) * rad + 'px';
    const s = inv.slots[i];
    const n = document.createElement('b'); n.textContent = String(i + 1); el.appendChild(n);
    if (s) { const c = icon(getItem(s.id).icon); const cc = document.createElement('canvas'); cc.width = c.width; cc.height = c.height; cc.getContext('2d')!.drawImage(c, 0, 0); el.appendChild(cc); el.title = itemName(s.id); }
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); select(i); closeRadial(); });
    radial.appendChild(el);
  }
  const cap = document.createElement('div'); cap.className = 'cap'; cap.style.top = Math.max(4, cy - rad - 52) + 'px';
  const sel = inv.slots[inv.sel]; cap.textContent = (sel ? itemName(sel.id) + ' · ' : '') + S.radialCap; radial.appendChild(cap);
  radial.style.display = 'block';
  clearTimeout(radialTimer); radialTimer = window.setTimeout(closeRadial, 7000);
}
