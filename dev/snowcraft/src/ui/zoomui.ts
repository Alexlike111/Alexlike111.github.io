// Zoom UI (DESIGN §14): the on-screen zoom label (it appears for a moment on every change) and the zoom control (a slider over the valid integer
// scales, zoom.ts) that the settings panel (ui/menu.ts) mounts. The phone's small +/− buttons and the pinch live in ui/touch.ts (they own the pointers);
// desktop uses Ctrl+wheel and the +/− keys (engine/input.ts). mountZoomControl() can be placed into any settings panel.
import { G } from '../game/state';
import { strings, fmt } from '../content/i18n';
import { zoomCount, zoomIndex, setZoomIndex, zoomCells, onZoomChange } from '../engine/zoom';

const S = strings('zoom', {
  zoom: 'Масштаб', label: 'Масштаб {i}/{n}', cells: '{c} клеток в ширину',
  closer: 'Ближе', farther: 'Дальше', title: 'Масштаб карты',
});

const CSS = `
#zoomlab{position:fixed;left:50%;bottom:calc(128px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:46;pointer-events:none;opacity:0;transition:opacity .25s;
  font:700 14px 'Jura',system-ui,sans-serif;color:#e8f4ff;background:rgba(8,16,30,.82);border:1px solid rgba(124,198,238,.5);border-radius:4px;padding:3px 12px;white-space:nowrap;text-shadow:0 1px 0 #05080f}
#zoomlab.on{opacity:1}
body.touch-ui #zoomlab{left:calc(62px + env(safe-area-inset-left,0px));bottom:auto;top:calc(134px + env(safe-area-inset-top,0px));transform:none}
`;

let lab: HTMLElement | null = null, labTimer = 0;
let hostControl: { sync: () => void }[] = [];

const labelText = () => fmt(S.label, { i: zoomIndex() + 1, n: zoomCount() }) + (G.mobile ? '' : ' · ' + fmt(S.cells, { c: zoomCells() }));

/** A zoom control (− slider +) inside any container (the settings panel). Returns the element; it keeps itself in sync with zoom changes. */
export function mountZoomControl(host: HTMLElement): HTMLElement {
  const row = document.createElement('div'); row.className = 'zc';
  const name = document.createElement('b'); name.textContent = S.zoom;
  const minus = document.createElement('button'); minus.type = 'button'; minus.className = 'zb'; minus.textContent = '−'; minus.title = S.farther; minus.setAttribute('aria-label', S.farther);
  const sl = document.createElement('input'); sl.type = 'range'; sl.step = '1'; sl.setAttribute('aria-label', S.title);
  const plus = document.createElement('button'); plus.type = 'button'; plus.className = 'zb'; plus.textContent = '+'; plus.title = S.closer; plus.setAttribute('aria-label', S.closer);
  const val = document.createElement('span');
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
  onZoomChange(() => {
    for (const c of hostControl) c.sync();
    if (!lab || document.body.classList.contains('title-open')) return;
    lab.textContent = labelText(); lab.classList.add('on');
    clearTimeout(labTimer); labTimer = window.setTimeout(() => lab?.classList.remove('on'), 1400);
  });
}

/** Called every frame by main.ts. The old «ПАУЗА» zoom panel is folded into the settings panel (ui/menu.ts), which follows the pause itself. */
export function updateZoomUi() { /* nothing to do: see ui/menu.ts */ }
