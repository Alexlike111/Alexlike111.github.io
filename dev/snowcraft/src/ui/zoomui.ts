// Zoom UI (DESIGN §14): the on-screen zoom label (it appears for a moment on every change) and the settings control shown while the game is paused:
// a slider over the valid integer scales (zoom.ts). The phone's small +/− buttons and the pinch live in ui/touch.ts (they own the pointers);
// desktop uses Ctrl+wheel and the +/− keys (engine/input.ts). mountZoomControl() can be placed into any settings panel.
import { G } from '../game/state';
import { strings, fmt } from '../content/i18n';
import { zoomCount, zoomIndex, setZoomIndex, zoomCells, onZoomChange } from '../engine/zoom';

const S = strings('zoom', {
  zoom: 'Масштаб', label: 'Масштаб {i}/{n}', cells: '{c} клеток в ширину', settings: 'Настройки', keys: 'Ctrl + колесо · клавиши + / −', pinch: 'Щипок двумя пальцами · кнопки + / −',
  closer: 'Ближе', farther: 'Дальше', title: 'Масштаб карты',
});

const CSS = `
#zoomlab{position:fixed;left:50%;bottom:calc(128px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:46;pointer-events:none;opacity:0;transition:opacity .25s;
  font:700 14px 'Jura',system-ui,sans-serif;color:#e8f4ff;background:rgba(8,16,30,.82);border:1px solid rgba(124,198,238,.5);border-radius:4px;padding:3px 12px;white-space:nowrap;text-shadow:0 1px 0 #05080f}
#zoomlab.on{opacity:1}
body.touch-ui #zoomlab{left:calc(60px + env(safe-area-inset-left,0px));bottom:auto;top:calc(88px + env(safe-area-inset-top,0px));transform:none}
#zoompanel{position:fixed;left:50%;top:54%;transform:translateX(-50%);z-index:47;display:none;min-width:min(340px,86vw);box-sizing:border-box;padding:10px 16px 12px;
  background:rgba(8,16,30,.9);border:1px solid rgba(124,198,238,.5);border-radius:6px;font-family:'Jura',system-ui,sans-serif;color:#e8f4ff;text-shadow:0 1px 0 #05080f}
#zoompanel h4{margin:0 0 6px;font:700 15px 'Jura',system-ui,sans-serif;letter-spacing:.04em;color:#ffc46e}
#zoompanel .zc{display:flex;align-items:center;gap:10px}
#zoompanel .zc b{font-weight:700;font-size:14px;min-width:64px}
#zoompanel .zc input[type=range]{flex:1;min-width:120px;height:32px;accent-color:#7cc6ee;touch-action:auto}
#zoompanel .zc .zb{width:36px;height:36px;border-radius:50%;border:2px solid rgba(124,198,238,.6);background:rgba(14,26,44,.8);color:#e8f4ff;font:700 20px/1 'Jura',system-ui,sans-serif;cursor:pointer;padding:0}
#zoompanel .zc .zb:active{background:rgba(124,198,238,.45)}
#zoompanel small{display:block;margin-top:6px;font-size:12px;opacity:.8}
`;

let lab: HTMLElement | null = null, panel: HTMLElement | null = null, labTimer = 0;
let hostControl: { sync: () => void }[] = [];

const labelText = () => fmt(S.label, { i: zoomIndex() + 1, n: zoomCount() }) + ' · ' + fmt(S.cells, { c: zoomCells() });

/** A zoom control (− slider +) inside any container (the settings panel). Returns the element; it keeps itself in sync with zoom changes. */
export function mountZoomControl(host: HTMLElement): HTMLElement {
  const row = document.createElement('div'); row.className = 'zc';
  const name = document.createElement('b'); name.textContent = S.zoom;
  const minus = document.createElement('button'); minus.type = 'button'; minus.className = 'zb'; minus.textContent = '−'; minus.title = S.farther; minus.setAttribute('aria-label', S.farther);
  const sl = document.createElement('input'); sl.type = 'range'; sl.step = '1'; sl.setAttribute('aria-label', S.title);
  const plus = document.createElement('button'); plus.type = 'button'; plus.className = 'zb'; plus.textContent = '+'; plus.title = S.closer; plus.setAttribute('aria-label', S.closer);
  const val = document.createElement('span'); val.style.cssText = 'min-width:44px;text-align:right;font-size:13px';
  row.append(name, minus, sl, plus, val); host.appendChild(row);
  const sync = () => { sl.min = '0'; sl.max = String(Math.max(0, zoomCount() - 1)); sl.value = String(zoomIndex()); val.textContent = zoomIndex() + 1 + '/' + zoomCount(); };
  sl.addEventListener('input', () => setZoomIndex(Number(sl.value)));
  minus.addEventListener('click', () => setZoomIndex(zoomIndex() - 1));
  plus.addEventListener('click', () => setZoomIndex(zoomIndex() + 1));
  hostControl.push({ sync }); sync();
  return row;
}

export function initZoomUi(host: HTMLElement) {
  if (lab) return;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  lab = document.createElement('div'); lab.id = 'zoomlab'; host.appendChild(lab);
  panel = document.createElement('div'); panel.id = 'zoompanel';
  const h = document.createElement('h4'); h.textContent = S.settings; panel.appendChild(h);
  mountZoomControl(panel);
  const hint = document.createElement('small'); hint.textContent = G.mobile ? S.pinch : S.keys; panel.appendChild(hint);
  host.appendChild(panel);
  onZoomChange(() => {
    for (const c of hostControl) c.sync();
    if (!lab || document.body.classList.contains('title-open')) return;
    lab.textContent = labelText(); lab.classList.add('on');
    clearTimeout(labTimer); labTimer = window.setTimeout(() => lab?.classList.remove('on'), 1400);
  });
}

/** Per frame (cheap): show the settings panel under the «ПАУЗА» caption while the game is paused by the player. */
export function updateZoomUi() {
  if (!panel) return;
  const pauseEl = document.querySelector('#hud .pause') as HTMLElement | null;
  const on = !!pauseEl && pauseEl.style.display === 'block' && !document.body.classList.contains('title-open');
  const d = on ? 'block' : 'none';
  if (panel.style.display !== d) { panel.style.display = d; if (on) for (const c of hostControl) c.sync(); }
}
