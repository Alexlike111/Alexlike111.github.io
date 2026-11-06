// TEMPORARY minimal HUD (the UI wave replaces it): body numbers incl. extremities, belt with names, tooltip at the cursor,
// toast line, shelter chip, day / clock / sun elevation, forecast, CO warning, a small inventory + crafting panel (C), death card.
import { G } from '../game/state';
import { input } from '../engine/input';
import { worldToScreen } from '../engine/render';
import { strings, fmt } from '../content/i18n';
import { inv, weight, BELT, NSLOT, select, equip, unequip, WEAR_SLOTS, WEIGHT_MAX } from '../game/inventory';
import { getItem, itemName } from '../game/items';
import { RECIPES, canCraft, craft, craftedText } from '../game/recipes';
import { stationsAt } from '../game/fixtures';
import { target, toolState } from '../game/tools';
import { body, handsFrozen, eatSlot, respawn } from '../game/player';
import { icon } from '../engine/sprites';
import { knowsForecast, STORMS } from '../game/weather';
import { toast } from '../game/state';
import { on } from '../game/bus';

const S = strings('hud', {
  core: 'Ядро', hands: 'Руки', feet: 'Ноги', face: 'Лицо', water: 'Вода', food: 'Еда', energy: 'Силы', wet: 'Сырость', hp: 'Здоровье', co: 'CO',
  feels: 'ощущается {t}°', air: 'воздух {t}°',
  day: 'День {d} / {n}', sun: 'Солнце {e}°', moon: 'луна',
  shelter: 'Укрытие', noShelter: 'нет укрытия', vent: 'отдушина ✓', noVentTxt: 'отдушины нет', temp: '{t}°',
  dead: 'Ты погиб: {c}', deadHint: 'Нажми любую клавишу — вернуться на станцию', deadHard: 'Хардкор: забег окончен',
  pause: 'ПАУЗА', free: 'свободная камера (F2)',
  ending: 'Рассвет. Солнце вернулось.',
  bag: 'Сумка', craft: 'Мастерская', weight: 'Вес {w}/{m} кг', worn: 'Одето', close: 'закрыть',
  forecast: 'Прогноз: {t}', noForecast: 'Прогноз: нужен барометр',
  hint: 'WASD — ход · ЛКМ — действие · E — взять · F — еда · V — парка · C — сумка · R — купол/курсор · G — бросить',
  storm: 'ПУРГА', wind: 'ветер {w} м/с',
});

let root: HTMLElement, left: HTMLElement, top: HTMLElement, right: HTMLElement, beltEl: HTMLElement, tip: HTMLElement, toastEl: HTMLElement, chip: HTMLElement, deadEl: HTMLElement, panel: HTMLElement, hintEl: HTMLElement, endEl: HTMLElement;
let panelOpen = false;
let beltKey = '';
let acc = 0, panelAcc = 0;
let freeCam = false;
export function setFreeCamLabel(on: boolean) { freeCam = on; }

const CSS = `
#hud{position:fixed;inset:0;z-index:20;pointer-events:none;font:13px/1.35 'Jura',system-ui,sans-serif;color:#dff0ff;
 padding:env(safe-area-inset-top,0) env(safe-area-inset-right,0) env(safe-area-inset-bottom,0) env(safe-area-inset-left,0);text-shadow:0 1px 2px #000}
#hud .p{position:absolute;background:rgba(10,18,32,.58);border:1px solid rgba(124,198,238,.28);border-radius:6px;padding:5px 8px}
#hud .l{left:8px;top:8px;min-width:150px}
#hud .l div{display:flex;justify-content:space-between;gap:10px;font-variant-numeric:tabular-nums}
#hud .warn{color:#ffc46e}#hud .bad{color:#ff7a68}#hud .good{color:#8fe3b0}
#hud .r{right:8px;top:8px;text-align:right;max-width:240px}
body.touch-ui #hud .r{top:64px}
#hud .t{left:50%;top:8px;transform:translateX(-50%);text-align:center;max-width:46vw}
body.touch-ui #hud .t{max-width:34vw}
#hud .belt{left:50%;bottom:calc(8px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);display:flex;gap:4px;padding:4px;pointer-events:auto}
#hud .sl{width:54px;height:58px;border:2px solid rgba(124,198,238,.3);border-radius:6px;background:rgba(10,18,32,.6);position:relative;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding-top:3px;font-size:9px;text-align:center;overflow:hidden}
#hud .sl.sel{border-color:#ffc46e;background:rgba(60,34,12,.7)}
#hud .sl canvas{width:28px;height:28px;image-rendering:pixelated}
#hud .sl .n{position:absolute;right:3px;top:2px;font-size:11px;color:#fff}
#hud .sl .k{position:absolute;left:3px;top:1px;font-size:9px;color:#8aa}
#hud .sl .nm{margin-top:1px;line-height:1;max-width:50px}
#hud .sl .bar{position:absolute;left:3px;right:3px;bottom:2px;height:3px;background:#123}#hud .sl .bar i{display:block;height:100%;background:#8fe3b0}
#hud .tip{pointer-events:none;max-width:240px;font-size:12px;display:none}
#hud .toast{left:50%;top:70px;transform:translateX(-50%);text-align:center;display:none;font-size:15px;max-width:60vw}
body.touch-ui #hud .toast{top:46px}
#hud .chip{left:50%;top:40px;transform:translateX(-50%);display:none;font-size:12px;white-space:nowrap}
body.touch-ui #hud .chip{top:34px}
#hud .dead{inset:0;background:rgba(40,0,0,.55);display:none;align-items:center;justify-content:center;flex-direction:column;font-size:22px;pointer-events:auto;border:0;border-radius:0}
#hud .end{inset:0;background:rgba(255,220,160,.18);display:none;align-items:center;justify-content:center;font-size:30px;border:0;border-radius:0}
#hud .pnl{left:50%;top:50%;transform:translate(-50%,-50%);width:min(760px,94vw);max-height:84vh;overflow:auto;display:none;pointer-events:auto;background:rgba(8,14,26,.92);font-size:12px}
#hud .pnl .cols{display:flex;gap:10px;flex-wrap:wrap}#hud .pnl .col{flex:1 1 300px}
#hud .pnl button{font:inherit;color:#dff0ff;background:#13243a;border:1px solid #2c4a6a;border-radius:4px;padding:3px 6px;margin:2px;cursor:pointer;min-height:30px;pointer-events:auto}
#hud .pnl button.no{opacity:.55}#hud .pnl button.ok{border-color:#8fe3b0}
#hud .hint{left:8px;bottom:8px;font-size:10px;opacity:.7;display:none}
body.touch-ui #hud{font-size:11px}body.touch-ui #hud .l{min-width:118px;padding:3px 6px}body.touch-ui #hud .r{max-width:190px;padding:3px 6px}body.touch-ui #hud .sl{width:48px;height:52px}
`;

export function initHud(host: HTMLElement) {
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  root = document.createElement('div'); root.id = 'hud'; host.appendChild(root);
  const mk = (cls: string) => { const d = document.createElement('div'); d.className = 'p ' + cls; root.appendChild(d); return d; };
  left = mk('l'); right = mk('r'); top = mk('t'); beltEl = mk('belt'); tip = mk('tip'); toastEl = mk('toast'); chip = mk('chip'); deadEl = mk('dead'); panel = mk('pnl'); hintEl = mk('hint'); endEl = mk('end');
  hintEl.textContent = S.hint; if (!G.mobile) hintEl.style.display = 'block';
  deadEl.addEventListener('pointerdown', () => { if (!G.player.alive) respawn(); });
  on('ending', () => { endEl.textContent = S.ending; endEl.style.display = 'flex'; setTimeout(() => { endEl.style.display = 'none'; }, 9000); });
}

const bar = (v: number, w = 6) => { const n = Math.max(0, Math.min(w, Math.round(v / 100 * w))); return '█'.repeat(n) + '░'.repeat(w - n); };
const cls = (bad: boolean, warn: boolean) => (bad ? 'bad' : warn ? 'warn' : 'good');

export function updateHud(dt: number, realDt: number) {
  if (!root) return;
  const p = G.player;
  if (input.craftPressed) { panelOpen = !panelOpen; panel.style.display = panelOpen ? 'block' : 'none'; panelAcc = 9; }
  if (input.pausePressed) { if (panelOpen) { panelOpen = false; panel.style.display = 'none'; } else G.paused = !G.paused; }
  acc += realDt; panelAcc += realDt;
  // toasts
  for (let i = G.toasts.length - 1; i >= 0; i--) { const t = G.toasts[i]; t.t -= realDt; if (t.t <= 0) G.toasts.splice(i, 1); }
  const t = G.toasts[G.toasts.length - 1];
  if (t) { toastEl.style.display = 'block'; toastEl.textContent = t.text; toastEl.style.color = t.kind === 'bad' ? '#ff9a88' : t.kind === 'warn' ? '#ffc46e' : t.kind === 'good' ? '#8fe3b0' : '#dff0ff'; }
  else toastEl.style.display = 'none';
  // death card
  if (p && !p.alive) {
    deadEl.style.display = 'flex';
    deadEl.innerHTML = `<div>${fmt(S.dead, { c: p.cause })}</div><div style="font-size:14px;margin-top:8px">${G.diff.hardcore ? S.deadHard : S.deadHint}</div>`;
    if (body.deadT > 1.8 && (input.anyKey || input.primaryPressed) && !G.diff.hardcore) respawn();
  } else deadEl.style.display = 'none';
  // tooltip
  const T = target();
  if (p?.alive && input.hasAim && T.lines.length && !panelOpen && (input.aimMode !== 'smart')) {
    const [sx, sy] = input.aimMode === 'touch' ? [input.aimX, input.aimY] : [input.aimX, input.aimY];
    void worldToScreen;
    tip.style.display = 'block'; tip.style.left = Math.min(window.innerWidth - 250, sx + 16) + 'px'; tip.style.top = Math.max(4, sy + 14) + 'px';
    tip.innerHTML = T.lines.map((l, i) => `<div class="${i === T.lines.length - 1 && T.reason ? 'warn' : ''}">${l}</div>`).join('');
  } else tip.style.display = 'none';

  if (acc < 0.1) return;
  acc = 0;
  if (!p) return;
  // body panel
  const f = p.frost;
  left.innerHTML =
    `<div><span>${S.core}</span><span class="${cls(p.core < 34, p.core < 36)}">${p.core.toFixed(1)}°</span></div>` +
    `<div><span>${S.hands}</span><span class="${cls(f.hands >= 80, f.hands >= 40)}">${Math.round(f.hands)}</span></div>` +
    `<div><span>${S.feet}</span><span class="${cls(f.feet >= 80, f.feet >= 40)}">${Math.round(f.feet)}</span></div>` +
    `<div><span>${S.face}</span><span class="${cls(f.face >= 80, f.face >= 40)}">${Math.round(f.face)}</span></div>` +
    `<div><span>${S.water}</span><span class="${cls(p.water < 15, p.water < 35)}">${bar(p.water)} ${Math.round(p.water)}</span></div>` +
    `<div><span>${S.food}</span><span class="${cls(p.food < 15, p.food < 35)}">${bar(p.food)} ${Math.round(p.food)}</span></div>` +
    `<div><span>${S.energy}</span><span class="${cls(p.energy < 12, p.energy < 30)}">${bar(p.energy)} ${Math.round(p.energy)}</span></div>` +
    `<div><span>${S.wet}</span><span class="${cls(p.wet > 0.6, p.wet > 0.25)}">${Math.round(p.wet * 100)}%</span></div>` +
    `<div><span>${S.hp}</span><span class="${cls(p.hp < 30, p.hp < 60)}">${Math.round(p.hp)}</span></div>` +
    (p.co > 5 ? `<div class="bad"><span>${S.co}</span><span>${Math.round(p.co)} ⚠</span></div>` : '') +
    `<div style="opacity:.75"><span>${fmt(S.air, { t: p.airT.toFixed(0) })}</span><span>${fmt(S.feels, { t: p.feelT.toFixed(0) })}</span></div>`;
  // clock / sun
  const h = Math.floor(((G.time % 1440) + 1440) % 1440 / 60), m = Math.floor(G.time % 60);
  const know = knowsForecast();
  right.innerHTML =
    `<div>${fmt(S.day, { d: G.day, n: G.endDay })} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}</div>` +
    `<div>${fmt(S.sun, { e: G.sunElev.toFixed(1) })}</div>` +
    `<div>${fmt(S.wind, { w: Math.abs(G.wind).toFixed(0) })}${G.storm > 0.2 ? ' · <span class="bad">' + S.storm + '</span>' : ''}</div>` +
    `<div style="opacity:.85">${know ? fmt(S.forecast, { t: G.forecast.text }) : S.noForecast}</div>` +
    (G.timeScale > 1 ? '<div class="warn">Zzz ×' + G.timeScale + '</div>' : '') + (G.paused ? '<div class="warn">' + S.pause + '</div>' : '') + (freeCam ? '<div class="warn">' + S.free + '</div>' : '');
  top.style.display = 'none';
  // shelter chip
  const sh = G.shelter;
  if (sh) {
    chip.style.display = 'block';
    const stars = '★'.repeat(sh.stars) + '☆'.repeat(4 - sh.stars);
    chip.innerHTML = sh.closed ? `${S.shelter} ${stars} · ${fmt(S.temp, { t: sh.temp.toFixed(0) })} · ${sh.vent ? S.vent : S.noVentTxt}${sh.co > 8 ? ' · <span class="bad">CO ' + Math.round(sh.co) + '</span>' : ''}` : `<span class="warn">${sh.notes[0] ?? S.noShelter}</span>`;
  } else chip.style.display = 'none';
  // belt
  let key = inv.sel + '|';
  for (let i = 0; i < BELT; i++) { const s = inv.slots[i]; key += s ? s.id + s.n + (s.dur !== undefined ? Math.round(s.dur / 5) : '') + ',' : ','; }
  if (key !== beltKey) {
    beltKey = key; beltEl.innerHTML = '';
    for (let i = 0; i < BELT; i++) {
      const s = inv.slots[i];
      const el = document.createElement('div'); el.className = 'sl' + (i === inv.sel ? ' sel' : '');
      el.innerHTML = `<span class="k">${i + 1}</span>`;
      if (s) {
        const d = getItem(s.id);
        const src = icon(d.icon); const c = document.createElement('canvas'); c.width = src.width; c.height = src.height; c.getContext('2d')!.drawImage(src, 0, 0); el.appendChild(c);
        const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = itemName(s.id); el.appendChild(nm);
        if (s.n > 1) { const n = document.createElement('span'); n.className = 'n'; n.textContent = String(s.n); el.appendChild(n); }
        if (d.tool && isFinite(d.tool.dur) && s.dur !== undefined) { const b = document.createElement('div'); b.className = 'bar'; b.innerHTML = `<i style="width:${Math.max(0, Math.min(100, s.dur / d.tool.dur * 100))}%"></i>`; el.appendChild(b); }
        if (s.id === 'snow_block' && s.dur) { const n = document.createElement('span'); n.className = 'n'; n.style.top = '34px'; n.style.fontSize = '9px'; n.textContent = Math.round(s.dur) + ''; el.appendChild(n); }
      }
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); select(i); });
      beltEl.appendChild(el);
    }
  }
  if (panelOpen && panelAcc > 0.35) { panelAcc = 0; renderPanel(); }
  void toolState; void STORMS;
}

function renderPanel() {
  const p = G.player;
  const wt = weight();
  let h = `<div style="display:flex;justify-content:space-between"><b>${S.bag}</b><span>${fmt(S.weight, { w: wt.toFixed(1), m: WEIGHT_MAX })}</span></div><div class="cols"><div class="col" id="pk">`;
  h += `<div>${S.worn}: `;
  for (const sl of WEAR_SLOTS) { const id = inv.wear[sl]; h += id ? `<button data-un="${sl}">${itemName(id)}</button>` : ''; }
  h += `</div>`;
  for (let i = 0; i < NSLOT; i++) { const s = inv.slots[i]; if (!s) continue; h += `<button data-i="${i}">${i < BELT ? i + 1 + '·' : ''}${itemName(s.id)}${s.n > 1 ? ' ×' + s.n : ''}${s.id === 'snow_block' && s.dur ? ' (' + Math.round(s.dur) + ')' : ''}</button>`; }
  h += `</div><div class="col" id="rc"><b>${S.craft}</b><br/>`;
  const st = stationsAt(p.x, p.y - 8);
  RECIPES.forEach((r, idx) => {
    const c = canCraft(r, st, handsFrozen());
    h += `<button class="${c.ok ? 'ok' : 'no'}" data-r="${idx}" title="${c.reason ?? ''}">${itemName(r.result)}${r.n > 1 ? ' ×' + r.n : ''}${r.fine ? ' ✋' : ''}${c.ok ? '' : ' — ' + (c.reason ?? '')}</button>`;
  });
  h += `</div></div><div style="text-align:right"><button id="cl">${S.close}</button></div>`;
  panel.innerHTML = h;
  panel.querySelectorAll('button[data-i]').forEach((b) => b.addEventListener('click', () => {
    const i = +(b as HTMLElement).dataset.i!; const s = inv.slots[i]; if (!s) return;
    const d = getItem(s.id);
    if (d.wear) equip(i); else if (d.food) eatSlot(i); else if (i >= BELT) { const j = inv.slots.findIndex((x, k) => !x && k < BELT); if (j >= 0) { inv.slots[j] = s; inv.slots[i] = null; inv.sel = j; } }
    else select(i);
    panelAcc = 9;
  }));
  panel.querySelectorAll('button[data-un]').forEach((b) => b.addEventListener('click', () => { unequip((b as HTMLElement).dataset.un as never); panelAcc = 9; }));
  panel.querySelectorAll('button[data-r]').forEach((b) => b.addEventListener('click', () => {
    const r = RECIPES[+(b as HTMLElement).dataset.r!];
    if (craft(r, stationsAt(p.x, p.y - 8), handsFrozen())) toast(craftedText(r), 'good');
    panelAcc = 9;
  }));
  panel.querySelector('#cl')?.addEventListener('click', () => { panelOpen = false; panel.style.display = 'none'; });
}
export const panelIsOpen = () => panelOpen;
