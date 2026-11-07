// DOM side of «Чутьё» (engine/senses.ts): the legend with one toggle chip per layer (it sits in the top-centre HUD flow, so it can never overlap the
// objective / toasts / buttons), a temperature label above the player (inside a shelter: the room's temperature and a draught warning) and, on desktop,
// next to the cursor. Everything is hidden and costs nothing while the mode is off.
import './ui.css';
import { G } from '../game/state';
import { strings, fmt } from '../content/i18n';
import { input } from '../engine/input';
import { addLayer, screenToWorld, worldToScreen } from '../engine/render';
import { temp, wind } from '../engine/heat';
import { TW, TH } from '../engine/grid';
import { senses, LAYERS, toggleSenses, setSensesLayer, onSensesChange, heatRamp, snowRamp, type SensesLayer } from '../engine/senses';

const S = strings('senses', {
  name: 'Чутьё', key: 'чутьё', wheelKey: 'пояс (держи)',
  snow: 'Снег', heat: 'Тепло', wind: 'Сквозняк', scent: 'Запах',
  loose: 'рыхлый', good: 'для блоков', dense: 'плотный',
  cold: 'холод', warm: 'тепло',
  windSub: 'куда дует', scentSub: 'куда уходит',
  inside: 'в укрытии {t}°', outside: '{t}° · ощущается {f}°', draught: 'сквозняк', calm: 'штиль',
  curT: '{t}°', curW: '{t}° · ветер {w} м/с',
  tipSnow: 'Плотность снега: цвет подсказывает, где резать блоки', tipHeat: 'Тепло воздуха по клеткам', tipWind: 'Куда дует ветер и где он пробивается в дом', tipScent: 'Куда ветер уносит твой запах: так тебя найдёт медведь',
});
const deg = (t: number) => (Math.round(t) < 0 ? '−' : Math.round(t) > 0 ? '+' : '') + Math.abs(Math.round(t));
const css = (c: [number, number, number]) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

let legend: HTMLElement, me: HTMLElement, cur: HTMLElement, keyEl: HTMLElement;
const chips = {} as Record<SensesLayer, HTMLElement>;

function chip(l: SensesLayer, tip: string, sw: string, sub: string): HTMLElement {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'sn-it'; b.dataset.l = l; b.title = tip;
  b.innerHTML = `<span class="sn-sw ${l}" style="${sw}"></span><span class="sn-tx"><b>${S[l]}</b><i>${sub}</i></span>`;
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); setSensesLayer(l); });
  return b;
}
function build(stack: HTMLElement | null, host: HTMLElement) {
  legend = document.createElement('div'); legend.className = 'p sn-leg';
  const snowSub = `<s style="color:${css(snowRamp(150))}">${S.loose}</s> · <s class="g" style="color:${css(snowRamp(310))}">${S.good}</s> · <s style="color:${css(snowRamp(450))}">${S.dense}</s>`;
  const snowSw = `background:linear-gradient(90deg,${css(snowRamp(80))} 0 28%,${css(snowRamp(310))} 28% 66%,${css(snowRamp(450))} 66%)`;
  const heatSw = `background:linear-gradient(90deg,${[-34, -20, -8, 0, 8, 20].map(t => css(heatRamp(t))).join(',')})`;
  chips.snow = chip('snow', S.tipSnow, snowSw, snowSub);
  chips.heat = chip('heat', S.tipHeat, heatSw, `${S.cold} → ${S.warm}`);
  chips.wind = chip('wind', S.tipWind, '', S.windSub);
  chips.scent = chip('scent', S.tipScent, '', S.scentSub);
  const row = document.createElement('div'); row.className = 'sn-row';
  for (const l of LAYERS) row.appendChild(chips[l]);
  legend.appendChild(row);
  keyEl = document.createElement('div'); keyEl.className = 'sn-key'; keyEl.innerHTML = `<div><span data-l="snow">${snowSub}</span><span class="sep"></span><span data-l="heat">${S.cold} → ${S.warm}</span></div>` +
    `<div><span data-l="wind">${S.wind}: ${S.windSub}</span><span class="sep"></span><span data-l="scent">${S.scent}: ${S.scentSub}</span></div>`; legend.appendChild(keyEl);   // phone: the ramp words live here, per-chip sub-lines are hidden
  if (stack) stack.appendChild(legend); else host.appendChild(legend);  // the legend goes under the objective + shelter chip (the toasts live in the bottom stack)
  const hud = (host.querySelector('#hud') as HTMLElement | null) ?? host;
  me = document.createElement('div'); me.className = 'p sn-lbl me'; hud.appendChild(me);
  cur = document.createElement('div'); cur.className = 'p sn-lbl cur'; hud.appendChild(cur);
}

function sync() {
  document.body.classList.toggle('senses-on', senses.on);
  for (const l of LAYERS) chips[l]?.classList.toggle('off', !senses.layers[l]);
  if (keyEl) for (const line of Array.from(keyEl.children) as HTMLElement[]) {      // phone key: one span per layer, a separator only between two visible ones
    let vis = 0; for (const sp of Array.from(line.querySelectorAll('span[data-l]')) as HTMLElement[]) { const on = senses.layers[sp.dataset.l as SensesLayer]; sp.style.display = on ? '' : 'none'; if (on) vis++; }
    (line.querySelector('.sep') as HTMLElement).style.display = vis > 1 ? 'inline-block' : 'none'; line.style.display = vis ? '' : 'none';
  }
  document.querySelectorAll('#tb-senses').forEach(e => e.classList.toggle('act', senses.on));
}

function tileT(x: number, y: number) { return temp[Math.max(0, Math.min(TH - 1, y >> 2)) * TW + Math.max(0, Math.min(TW - 1, x >> 2))]; }
function tileW(x: number, y: number) { return wind[Math.max(0, Math.min(TH - 1, y >> 2)) * TW + Math.max(0, Math.min(TW - 1, x >> 2))]; }

let shown = false;
function labels() {
  const on = senses.k > 0.05;
  if (!on && !shown) return;                                             // off: nothing to touch (zero cost)
  shown = on;
  legend.style.display = on ? 'flex' : 'none';
  if (!on) { me.style.display = cur.style.display = 'none'; return; }
  const p = G.player; if (!p) return;
  // above the player's head
  if (senses.layers.heat || senses.layers.wind) {
    const sh = G.shelter, T = p.airT;
    const leak = sh?.closed && sh.windIn > 0.3;
    me.innerHTML = sh?.closed ? fmt(S.inside, { t: deg(sh.temp) }) + (leak ? ` · <span class="bad">${S.draught}</span>` : '') : fmt(S.outside, { t: deg(T), f: deg(p.feelT) });
    const [sx, sy] = worldToScreen(p.x, p.y + 22);                  // under the feet: the top of the screen belongs to the objective flow and the toasts
    me.style.display = 'block'; me.style.left = Math.round(sx) + 'px'; me.style.top = Math.round(sy) + 'px';
    me.style.borderColor = css(heatRamp(sh?.closed ? sh.temp : T));
    // never over the held-item name or the belt: slide the tag above them when they would collide
    const mr = me.getBoundingClientRect();
    for (const sel of ['#hud .bname', '#hud .belt']) {
      const o = document.querySelector(sel) as HTMLElement | null; if (!o || o.style.display === 'none') continue;
      const r = o.getBoundingClientRect(); if (r.width && mr.left < r.right + 4 && mr.right > r.left - 4 && mr.top < r.bottom + 4 && mr.bottom > r.top - 4) { me.style.top = Math.round(r.top - mr.height - 6 - (sel === '#hud .belt' ? 24 : 0)) + 'px'; break; }
    }
  } else me.style.display = 'none';
  // next to the cursor (desktop)
  if (input.hasAim && input.aimMode === 'mouse' && !G.mobile && (senses.layers.heat || senses.layers.wind)) {
    const [wx, wy] = screenToWorld(input.aimX, input.aimY);
    const T = tileT(wx, wy), w = Math.abs(tileW(wx, wy));
    cur.innerHTML = senses.layers.wind && w > 0.3 ? fmt(S.curW, { t: deg(T), w: w.toFixed(0) }) : fmt(S.curT, { t: deg(T) });
    cur.style.display = 'block'; cur.style.left = Math.round(input.aimX + 14) + 'px'; cur.style.top = Math.round(input.aimY - 34) + 'px'; cur.style.borderColor = css(heatRamp(T));
  } else cur.style.display = 'none';
}

export function initSensesUi(host: HTMLElement) {
  const stack = host.querySelector('#hud .stk') as HTMLElement | null;
  build(stack, host);
  onSensesChange(sync); sync();
  const hint = host.querySelector('#hud .hint') as HTMLElement | null;
  if (hint) hint.insertAdjacentHTML('beforeend', `<span><kbd>Q</kbd>${S.wheelKey}</span><span><kbd>X</kbd>${S.key}</span>`);
  addLayer(115, () => { labels(); });
  void toggleSenses;
}
export const sensesLabels = () => ({ me, cur, legend });
