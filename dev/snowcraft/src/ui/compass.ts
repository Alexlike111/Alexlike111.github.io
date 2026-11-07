// Compass HUD (DESIGN §17, «Ориентиры»), agent U2. A small dial in the lower right corner (under the touch buttons on a phone): the needle points at
// the selected target (station, ship, signal hill, smoke, marks) and the line beside it gives the name and the distance in metres. Pure DOM: game/useitems_b.ts feeds it every frame
// with showCompass(view) or showCompass(null) (no compass carried). In a storm or whiteout the plate gets darker and the letters bigger, so it stays
// readable over the snow (it sits in the HUD layer, above the world canvas and its weather).
import { strings } from '../content/i18n';

const S = strings('compass', { west: 'З', east: 'В' });

export interface CompassView {
  name: string;          // selected target
  dx: number; dy: number; // vector from the player to the target, cells (screen y down)
  m: number;             // distance, metres
  i: number; n: number;  // selected index / number of targets (shown as «2/4» when n > 1)
  storm: boolean;        // storm or whiteout: bigger, darker plate
}

let el: HTMLElement | null = null, needle: SVGGElement | null = null, nameEl: HTMLElement | null = null, distEl: HTMLElement | null = null;
let lastKey = '';
const CSS = `
#compass{position:absolute;right:calc(12px + env(safe-area-inset-right,0px));bottom:calc(96px + env(safe-area-inset-bottom,0px));display:none;align-items:center;gap:6px;
  pointer-events:none;font-family:'Jura',system-ui,sans-serif;font-weight:700;color:#e8f4ff;text-shadow:0 1px 0 #05080f;white-space:nowrap;z-index:2}
#compass.on{display:flex}
#compass svg{width:46px;height:46px;flex:none;filter:drop-shadow(0 1px 2px #05080f)}
#compass .pl{fill:rgba(8,16,30,.82);stroke:rgba(124,198,238,.7);stroke-width:1.5}
#compass .rg{fill:none;stroke:rgba(190,226,250,.45);stroke-width:1}
#compass .lt{fill:#cfeaff;font-size:9px;font-weight:700;text-anchor:middle;dominant-baseline:central}
#compass .nd path{fill:#ffc46e;stroke:#05080f;stroke-width:1}
#compass .nd .tl{fill:#7cc6ee}
#compass .tx{display:flex;flex-direction:column;line-height:1.1;background:rgba(8,16,30,.7);border:1px solid rgba(124,198,238,.35);border-radius:4px;padding:3px 7px}
#compass .tx b,#compass .tx span{white-space:nowrap;font-weight:700}
#compass .tx b{font-size:13px}
#compass .tx span{font-size:12px;opacity:.9;font-variant-numeric:tabular-nums}
#compass.storm .pl{fill:rgba(3,6,12,.96);stroke:#cfeaff;stroke-width:2.2}
#compass.storm .lt{font-size:11px}
#compass.storm .nd path{fill:#ffd98a;stroke-width:1.4}
#compass.storm .tx{background:rgba(3,6,12,.93);border-color:#cfeaff}
#compass.storm .tx b{font-size:14px}
#compass.storm .tx span{font-size:13px}
body.touch-ui #compass{top:calc(96px + env(safe-area-inset-top,0px));bottom:auto}
body.touch-ui #compass svg{width:40px;height:40px}
`;

function build() {
  const host = document.getElementById('hud') ?? document.body;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  el = document.createElement('div'); el.id = 'compass'; el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<svg viewBox="0 0 48 48">
    <circle class="pl" cx="24" cy="24" r="22"/><circle class="rg" cx="24" cy="24" r="16"/>
    <text class="lt" x="6" y="25">${S.west}</text><text class="lt" x="42" y="25">${S.east}</text>
    <g class="nd"><g class="ndr"><path d="M24 4 L29.5 26 L24 22 L18.5 26 Z"/><circle class="tl" cx="24" cy="24" r="2.5"/></g></g>
  </svg><div class="tx"><b></b><span></span></div>`;
  host.appendChild(el);
  needle = el.querySelector('.ndr') as SVGGElement;
  nameEl = el.querySelector('.tx b') as HTMLElement;
  distEl = el.querySelector('.tx span') as HTMLElement;
}

/** Show the compass with the given view, or hide it (null). Cheap to call every frame: the DOM changes only when the text or the needle changes. */
export function showCompass(v: CompassView | null) {
  if (typeof document === 'undefined') return;
  if (!el) { if (!v) return; build(); }
  if (!el || !needle) return;
  if (!v) { el.classList.remove('on'); lastKey = ''; return; }
  el.classList.add('on');
  el.classList.toggle('storm', v.storm);
  // screen angle of the target (0 = right, 90 = down); the needle is drawn pointing up, hence +90
  const deg = Math.round(Math.atan2(v.dy, v.dx) * 180 / Math.PI + 90);
  const txt = v.n > 1 ? `${v.name} · ${v.i + 1}/${v.n}` : v.name;
  const dist = `${v.m} м`;
  const key = deg + '|' + txt + '|' + dist;
  if (key === lastKey) return;
  lastKey = key;
  needle.setAttribute('transform', `rotate(${deg} 24 24)`);
  if (nameEl) nameEl.textContent = txt;
  if (distEl) distEl.textContent = dist;
}

/** Test hook: is the compass on screen right now (self-test). */
export const compassVisible = () => !!el && el.classList.contains('on');
export const compassText = () => (el ? (nameEl?.textContent ?? '') + ' | ' + (distEl?.textContent ?? '') : '');
