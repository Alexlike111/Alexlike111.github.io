// Bag + «Что умею» panel (C / Сумка), DESIGN §12. Left: weight bar with the effect in words, the four clothing slots, belt + pack grid and, when a sled is dragged
// or parked next to you, the sled. Right: the open container (search progress, the items found so far, «… ещё что-то на дне», Взять всё) or, with nothing open, the
// techniques the character KNOWS (recipes grouped Огонь / Еда и вода / Одежда / Охота / Стройка) with «?» hints.
// Operations (all on stacks, logic in game/inventory.ts): mouse = drag & drop between any two cells (a drop outside the panel throws it on the ground), click selects,
// click on a second cell places / merges / swaps, Shift+click or right click = quick-move, double click = use / wear / take; phone = tap-select then tap-place,
// long-press = quick-move; the action bar under the grids has Съесть / Надеть / Переложить / Пополам / Один / Бросить, and «Разложить» sorts the pack.
// The «Рядом» list (E held, or the phone button) is a separate overlay: lying things, containers, a backpack and a parked sled that are within reach.
// devhud.ts owns the panel element and calls attachBag(panel) once; bagHtml() builds the whole panel (kept for tests).
import { G } from '../game/state';
import { strings, fmt } from '../content/i18n';
import { on } from '../game/bus';
import {
  inv, weight, BELT, NSLOT, WEAR_SLOTS, WEIGHT_MAX, WEIGHT_SOFT, loadLevel, loadWords, unitWeight, sledOpen,
  moveStack, splitStack, sortZone, quickMove, dropRef, refGet, refEq, refSize, placeInto, select, boxZone, type Ref, type ZoneId,
} from '../game/inventory';
import { getItem, itemName } from '../game/items';
import { RECIPES, canCraft, placeLabel, fineLabel, unknownRecipeTechs, type Recipe, type RecipeGroup } from '../game/recipes';
import { stationsAt } from '../game/fixtures';
import { handsFrozen, eatSlot } from '../game/player';
import { knows, TECHS, techHint } from '../game/lore';
import { open as boxOpen, phase, searchProgress, hiddenCount, revOf, takeAllFound, closeBox, panel as boxPanel, barehanded, isOpen } from '../game/search';
import { nearbyList, takeNear, nearUi, hi } from '../game/nearby';
import * as searchMod from '../game/search';
import * as nearbyMod from '../game/nearby';
import * as invMod from '../game/inventory';
import { icon } from '../engine/sprites';
import { uiIcon } from '../art/icons';

const S = strings('bag', {
  pack: 'Пояс и сумка', skills: 'Что умею', weight: 'Вес {w}/{m} кг', worn: 'Одето', close: 'закрыть',
  slotHead: 'шапка', slotBody: 'парка', slotHands: 'рукавицы', slotFeet: 'обувь',
  gFire: 'Огонь', gFood: 'Еда и вода', gWear: 'Одежда', gHunt: 'Охота', gBuild: 'Стройка',
  dens: 'плотность {d}', known: 'Приёмов: {n} из {m}', more: 'Ещё есть чему учиться. Читай записки, смотри и пробуй.',
  q: '?', qExp: 'Приходит только с опытом.', qNote: 'Подсказка',
  sortKind: 'По виду', sortWeight: 'По весу', sortTitle: 'Разложить сумку', sled: 'Нарты', sledHere: 'Нарты (на привязи ×0,35 веса)',
  eat: 'Съесть', drink: 'Выпить', wear: 'Надеть', takeOff: 'Снять', toBelt: 'На пояс', toPack: 'В сумку', toSled: 'В нарты', toBox: 'Положить', take: 'Взять',
  half: 'Пополам', one: 'Один', drop: 'Бросить', takeAll: 'Взять всё', closeBox: 'Закрыть ящик',
  hintMouse: 'Тащи предмет мышью или нажми на него: перенести, разделить, бросить. Shift+клик — переложить.', hintTap: 'Нажми предмет, потом место, куда его положить. Долгое нажатие — переложить.',
  kg: '{w} кг', dropOut: 'Отпусти: бросить на землю', frozenHint: 'Лёд на крышке', searching: 'Обыскиваю…', done: 'Обыскано', empty: 'Пусто', more2: '… ещё что-то на дне',
  bare: 'Голые руки: мёрзнут', stackN: '{name} ×{n}', near: 'Рядом', nearBtn: 'Рядом', nearHint: 'Нажми, чтобы взять', takeOne: 'Взять', open: 'Открыть', hitch: 'Запрячь', heavyTag: 'тяжёлое',
  chipping: 'Скалываю лёд…', cap: '{n}/{m}',
});
const GROUPS: [RecipeGroup, () => string][] = [['fire', () => S.gFire], ['food', () => S.gFood], ['wear', () => S.gWear], ['hunt', () => S.gHunt], ['build', () => S.gBuild]];
const SLOT_LABEL: Record<string, () => string> = { head: () => S.slotHead, body: () => S.slotBody, hands: () => S.slotHands, feet: () => S.slotFeet };

const urlCache = new Map<string, string>();
const itemUrl = (id: string) => { let u = urlCache.get(id); if (!u) { u = icon(getItem(id).icon).toDataURL(); urlCache.set(id, u); } return u; };
const uiUrl = (key: string) => { const k = 'ui.' + key; let u = urlCache.get(k); if (!u) { u = uiIcon(key).toDataURL(); urlCache.set(k, u); } return u; };
const img = (src: string, cls = '') => `<img class="ic ${cls}" src="${src}" alt="" draggable="false">`;

const CSS = `
#hud .pnl .rec .pl{font-size:11px;opacity:.75;white-space:nowrap}
#hud .pnl .rec .fine{display:inline-flex;align-items:center;gap:3px;color:#ffc46e;font-size:11px;margin-left:6px}
#hud .pnl .rec .fine .ic{width:12px;height:12px}
#hud .pnl .qrow{display:flex;gap:8px;align-items:flex-start;border:1px dashed rgba(124,198,238,.35);border-radius:4px;padding:4px 7px;margin:3px 0;font-size:12px;opacity:.85}
#hud .pnl .qrow b{font:600 18px 'Pixelify Sans','Jura',sans-serif;color:#7cc6ee;width:16px;text-align:center;flex:none}
#hud .pnl .cnt{font-size:11px;opacity:.7;margin:6px 0 2px}
/* §12 inventory */
#hud .pnl .cell{user-select:none;-webkit-user-select:none;touch-action:pan-y;-webkit-touch-callout:none}
#hud .pnl .cell.bl{border-color:rgba(255,196,110,.4)}
#hud .pnl .cell.act{box-shadow:0 0 0 1px rgba(255,196,110,.55) inset}
#hud .pnl .cell.sel{border-color:#ffc46e;background:rgba(80,48,16,.78);box-shadow:0 0 0 2px rgba(255,196,110,.3)}
#hud .pnl .cell.tgt{border-color:#8fe3b0;background:rgba(30,80,60,.7)}
#hud .pnl .cell.srch{border-style:dashed;border-color:rgba(255,196,110,.55);animation:bagpulse 1s infinite;cursor:default}
#hud .pnl .cell.srch b{font:700 20px 'Jura',sans-serif;color:#ffc46e}
@keyframes bagpulse{50%{opacity:.45}}
#hud .pnl .cell .w{position:absolute;left:2px;bottom:0;font-size:9px;opacity:.7;font-style:normal}
#hud .pnl .wtxt{font-size:12px;margin:-4px 0 6px;display:flex;justify-content:space-between;gap:8px}
#hud .pnl .wtxt.l2,#hud .pnl .wtxt.l3{color:#ffc46e}#hud .pnl .wtxt.l4{color:#ff7a68}
#hud .pnl .top{display:flex;gap:8px;align-items:flex-start;margin-bottom:6px}
#hud .pnl .top .wear{margin:0;flex:none}
#hud .pnl .top .sorts{display:flex;flex-direction:column;gap:4px;margin-left:auto}
#hud .pnl button.mini,#hud .pnl button.ab{font:inherit;font-size:12px;font-weight:700;color:#dff0ff;background:#13243a;border:1px solid #2c4a6a;border-radius:4px;padding:2px 9px;cursor:pointer;min-height:30px}
#hud .pnl button.mini:active,#hud .pnl button.ab:active{background:#24507a}
#hud .pnl button.ab.pri{border-color:#8fe3b0;color:#d6ffe6}
#hud .pnl button.ab:disabled{opacity:.4;cursor:default;border-color:#2c4a6a;color:#9db6cc}
#hud .pnl button.ab.dng{border-color:#a8604c}
#hud .pnl .bfoot{position:sticky;bottom:-9px;margin:6px -10px -8px;padding:6px 10px;background:#080e1a;border-top:1px solid rgba(124,198,238,.28);display:flex;gap:6px;align-items:center;flex-wrap:wrap}
#hud .pnl .bfoot .info{display:flex;align-items:center;gap:6px;min-width:0;flex:1 1 150px;font-size:12px}
#hud .pnl .bfoot .info .ic{width:24px;height:24px}
#hud .pnl .bfoot .info span{opacity:.75}
#hud .pnl .bfoot .bh{font-size:12px;opacity:.7;flex:1}
#hud .pnl .bfoot .cl{margin-left:auto}
#hud .pnl .box{border:1px solid rgba(255,196,110,.35);border-radius:4px;padding:6px;background:rgba(40,28,12,.35)}
#hud .pnl .srchbar{height:8px;background:#16273d;border-radius:2px;margin:2px 0 4px;overflow:hidden}
#hud .pnl .srchbar i{display:block;height:100%;background:#ffc46e;transition:width .12s linear}
#hud .pnl .srchbar.chip i{background:#9fdcff}
#hud .pnl .srcht{font-size:13px;display:flex;justify-content:space-between;gap:8px;margin-bottom:4px}
#hud .pnl .srcht .fine{color:#ffc46e;display:inline-flex;align-items:center;gap:3px;font-size:11px}
#hud .pnl .srcht .fine .ic{width:12px;height:12px}
#hud .pnl .more{font-size:13px;opacity:.85;margin:6px 0 2px;font-style:italic;color:#ffd98a}
#hud .pnl .boxbtns{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap}
#hud .pnl .grid.sledg{grid-template-columns:repeat(6,1fr)}
#hud .pnl .grid.sledg .cell{min-height:34px}
#hud .pnl .grid.sledg{margin-bottom:6px}
#hud .pnl h3.sub{margin-top:8px}
#bagghost{position:fixed;z-index:60;pointer-events:none;width:44px;height:44px;margin:-22px 0 0 -22px;opacity:.92;image-rendering:pixelated}
#bagghost img{width:40px;height:40px;image-rendering:pixelated}
#bagghost b{position:absolute;right:0;bottom:0;font:700 12px 'Jura',sans-serif;background:rgba(5,8,15,.8);padding:0 3px;border-radius:2px;color:#fff}
#hud .pnl.dropout{outline:2px dashed rgba(255,122,104,.8)}
/* nearby list + phone button */
#hud .nearl{position:absolute;left:50%;bottom:calc(84px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);width:min(380px,92vw);max-height:62vh;overflow:auto;display:none;pointer-events:auto;background:rgba(8,14,26,.97);padding:6px 8px}
#hud .nearl h3{margin:0 0 4px;font-size:14px;color:#ffc46e;display:flex;justify-content:space-between}
#hud .nearl .nr{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;min-height:48px;text-align:left;font:inherit;font-weight:700;color:#dff0ff;background:#13243a;border:1px solid #2c4a6a;border-radius:4px;padding:2px 8px;margin:3px 0;cursor:pointer}
#hud .nearl .nr.first{border-color:#ffc46e}
#hud .nearl .nr .ic{width:30px;height:30px;flex:none}
#hud .nearl .nr .t{flex:1;min-width:0}#hud .nearl .nr small{display:block;opacity:.7;font-weight:600;font-size:11px}
#hud .nearl .nr b{color:#8fe3b0;font-size:13px}
#hud .nearl .nr.heavy b{color:#ffc46e}
#nearbtn{position:fixed;z-index:31;display:none;width:60px;height:60px;border-radius:50%;box-sizing:border-box;right:calc(30px + env(safe-area-inset-right,0px));bottom:calc(190px + env(safe-area-inset-bottom,0px));
  background:rgba(60,34,12,.7);border:2px solid rgba(255,196,110,.85);color:#ffe7bd;font:700 13px 'Jura',system-ui,sans-serif;align-items:center;justify-content:center;text-align:center;line-height:1.05;touch-action:none;-webkit-tap-highlight-color:transparent}
#nearbtn:active{background:rgba(124,198,238,.45)}
body.touch-ui #hud .pnl{max-height:calc(100vh - 12px - env(safe-area-inset-bottom,0px));padding:6px 8px}
body.touch-ui #hud .pnl .cell{min-height:48px;aspect-ratio:auto;height:48px}
body.touch-ui #hud .pnl .wear .cell{height:50px}
body.bag-open #touch .tb,body.bag-open #touch .ghost,body.bag-open #touch .stick,body.bag-open #touch .knob,body.bag-open #nearbtn{display:none!important}
body.touch-ui #hud .pnl .wt{margin:2px 0 4px}body.touch-ui #hud .pnl .wtxt{margin:-2px 0 4px}body.touch-ui #hud .pnl .top{margin-bottom:4px}
body.touch-ui #hud .pnl .srchbar{margin:0 0 3px}
body.touch-ui #hud .pnl .grid{gap:3px}
body.touch-ui #hud .pnl .wear .cell{width:50px;height:50px}
body.touch-ui #hud .pnl button.mini,body.touch-ui #hud .pnl button.ab{min-height:48px;font-size:13px;padding:2px 10px}
body.touch-ui #hud .pnl .top .sorts{flex-direction:row}
body.touch-ui #hud .pnl .bfoot{bottom:-7px;margin:4px -8px -6px;padding:4px 8px;gap:5px}
body.touch-ui #hud .pnl .bfoot .info{flex:1 1 100px}
body.touch-ui #hud .pnl .bfoot .bh{font-size:11px}
body.touch-ui #hud .pnl .grid.sledg .cell{min-height:44px}
`;
let styled = false;
function ensureStyle() { if (styled || typeof document === 'undefined') return; styled = true; const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); }

// ---- state ---------------------------------------------------------------------------------------------------------------------------
const ui = {
  sel: null as Ref | null, want: false, sortMode: 'kind' as 'kind' | 'weight',
  drag: null as null | { from: Ref; x: number; y: number; moved: boolean; ghost: HTMLElement | null; over: HTMLElement | null; pid: number; mouse: boolean },
  press: null as null | { ref: Ref; x: number; y: number; t: number; timer: number; consumed: boolean; pid: number },
};
let panelEl: HTMLElement | null = null, lastHtml = '', setOpenFn: ((v: boolean) => void) | null = null;
const touchy = () => typeof document !== 'undefined' && document.body.classList.contains('touch-ui');
export const bagBusy = () => !!ui.drag?.moved;
/** devhud.ts asks once per frame whether a container wants the panel on screen. */
export function bagWantsOpen(): boolean { const w = ui.want; ui.want = false; return w; }

// ---- html --------------------------------------------------------------------------------------------------------------------------
const kg = (w: number) => fmt(S.kg, { w: (Math.round(w * 10) / 10).toString().replace('.', ',') });
function cellHtml(z: ZoneId, i: number): string {
  const s = refGet({ z, i });
  const belt = z === 'inv' && i < BELT, act = belt && i === inv.sel;
  const here = ui.sel && ui.sel.z === z && ui.sel.i === i;
  const cls = `cell${belt ? ' bl' : ''}${act ? ' act' : ''}${here ? ' sel' : ''}${s ? '' : ' empty'}`;
  const key = belt ? `<span class="k">${i + 1}</span>` : '';
  if (!s) return `<div class="${cls}" data-z="${z}" data-i="${i}">${key}</div>`;
  const dens = s.id === 'snow_block' && s.dur ? ' · ' + fmt(S.dens, { d: Math.round(s.dur) }) : '';
  return `<div class="${cls}" data-z="${z}" data-i="${i}" title="${itemName(s.id)}${dens}">${key}${img(itemUrl(s.id))}${s.n > 1 ? `<i class="n">${s.n}</i>` : ''}</div>`;
}
function ingHtml(rec: Recipe): string {
  return rec.variants.map(v => '<span>' + v.map(g => img(itemUrl(g.id)) + itemName(g.id) + (g.n > 1 ? ' ×' + g.n : '')).join(', ') + '</span>').join('<span class="dim">/</span>');
}
function boxHtml(): string {
  const b = boxOpen.box; if (!b) return '';
  const ph = phase(), rev = revOf(b), n = b.items().length;
  let h = `<h3><span>${b.title}</span><span class="dim">${fmt(S.cap, { n, m: b.cap })}</span></h3><div class="box" data-z="box" data-i="${rev}">`;
  const pct = Math.round(searchProgress() * 100);
  if (ph === 'chip') h += `<div class="srcht"><span>${S.chipping}</span><span>${pct}%</span></div><div class="srchbar chip"><i style="width:${pct}%"></i></div>`;
  else if (ph === 'search') h += `<div class="srcht"><span>${S.searching}</span>${barehanded() ? `<span class="fine">${img(uiUrl('fine_work'))}${S.bare}</span>` : `<span>${pct}%</span>`}</div><div class="srchbar"><i style="width:${pct}%"></i></div>`;
  else h += `<div class="srcht"><span>${rev ? S.done : S.empty}</span></div>`;
  h += `<div class="grid">`;
  for (let i = 0; i < rev; i++) h += cellHtml('box', i);
  if (ph === 'search') h += `<div class="cell srch"><b>?</b></div>`;
  const spare = Math.max(0, Math.min(rev < 12 ? 12 - rev - (ph === 'search' ? 1 : 0) : 0, 6));
  if (ph !== 'chip') for (let i = 0; i < spare; i++) h += `<div class="cell empty" data-z="box" data-i="${rev}"></div>`;
  h += `</div>`;
  if (hiddenCount(b) > 0 && ph !== 'chip') h += `<div class="more">${S.more2}</div>`;
  h += `<div class="boxbtns"><button class="ab pri" data-act="takeall"${rev && ph !== 'chip' ? '' : ' disabled'}>${S.takeAll}</button><button class="ab" data-act="closebox">${S.closeBox}</button></div></div>`;
  return h;
}
/** Where would «Переложить» send the selected stack? (label of the button) */
function quickLabel(r: Ref, s: { id: string }): string {
  if (r.z === 'wear') return S.takeOff;
  if (r.z === 'box') return S.take;
  if (boxZone.cur) return S.toBox;
  if (sledOpen()) return r.z === 'sled' ? S.toPack : S.toSled;
  return r.i < BELT ? S.toPack : S.toBelt;
}
function footHtml(): string {
  const r = ui.sel, s = r ? refGet(r) : null;
  let h = `<div class="bfoot">`;
  if (!r || !s) h += `<span class="bh">${touchy() ? S.hintTap : S.hintMouse}</span>`;
  else {
    const d = getItem(s.id), w = unitWeight(s.id, s.dur) * s.n;
    h += `<div class="info">${img(itemUrl(s.id))}<b>${itemName(s.id)}${s.n > 1 ? ' ×' + s.n : ''}</b><span>${kg(w)}</span></div>`;
    const btn = (a: string, label: string, c = '') => `<button class="ab ${c}" data-act="${a}">${label}</button>`;
    if (r.z === 'inv' && d.food) h += btn('use', (d.food.drink || s.id === 'flask') ? S.drink : S.eat, 'pri');
    else if (d.wear && r.z !== 'wear' && !boxZone.cur) h += btn('use', S.wear, 'pri');
    h += btn('move', quickLabel(r, s), (r.z === 'box' || (boxZone.cur && r.z !== 'wear')) ? 'pri' : '');
    if (s.n > 1 && r.z !== 'wear') h += btn('half', S.half) + btn('one', S.one);
    if (r.z !== 'box') h += btn('drop', S.drop, 'dng');
  }
  h += `<button class="ab cl" data-act="close">${S.close}</button></div>`;
  return h;
}
/** The whole panel as HTML. Only known techniques appear; unknown ones leave a «?» with a hint. */
export function bagHtml(): string {
  ensureStyle();
  const p = G.player;
  const wt = weight(), lv = loadLevel(wt);
  let h = `<div class="cols"><div class="col"><h3><span>${S.pack}</span><span>${fmt(S.weight, { w: wt.toFixed(1), m: WEIGHT_MAX })}</span></h3>`;
  h += `<div class="wt"><i style="width:${Math.min(100, wt / WEIGHT_MAX * 100)}%;background:${lv >= 3 ? '#ff7a68' : lv === 2 ? '#ffc46e' : '#8fe3b0'}"></i></div><div class="wtxt l${lv}"><span>${loadWords(wt)}</span></div>`;
  h += `<div class="top"><div class="wear">`;
  for (let k = 0; k < WEAR_SLOTS.length; k++) {
    const sl = WEAR_SLOTS[k], id = inv.wear[sl], here = ui.sel && ui.sel.z === 'wear' && ui.sel.i === k;
    h += `<div class="cell${id ? '' : ' empty'}${here ? ' sel' : ''}" data-z="wear" data-i="${k}"${id ? ` title="${itemName(id)}"` : ''}>${id ? img(itemUrl(id)) : ''}<small>${SLOT_LABEL[sl]()}</small></div>`;
  }
  h += `</div><div class="sorts"><button class="mini" data-act="sort" data-m="kind" title="${S.sortTitle}">${S.sortKind}</button><button class="mini" data-act="sort" data-m="weight" title="${S.sortTitle}">${S.sortWeight}</button></div></div>`;
  h += `<div class="grid" data-z="inv" data-i="-1">`;
  for (let i = 0; i < NSLOT; i++) h += cellHtml('inv', i);
  h += `</div>`;
  h += `</div><div class="col">`;
  if (boxOpen.box) h += boxHtml();
  if (sledOpen()) {            // the sled (dragged or parked beside you) is a second pack: it sits on top of the right column
    h += `<h3${boxOpen.box ? ' class="sub"' : ''}><span>${inv.sled!.hitched ? S.sledHere : S.sled}</span></h3><div class="grid sledg" data-z="sled" data-i="-1">`;
    let last = -1; for (let i = 0; i < refSize('sled'); i++) if (refGet({ z: 'sled', i })) last = i;
    const shown = Math.min(refSize('sled'), Math.max(12, Math.ceil((last + 2) / 6) * 6));        // grows with the load (2 rows at least)
    for (let i = 0; i < shown; i++) h += cellHtml('sled', i);
    h += `</div>`;
  }
  if (!boxOpen.box) {
    h += `<h3><span>${S.skills}</span><span class="dim">${fmt(S.known, { n: TECHS.filter(t => knows(t.id)).length, m: TECHS.length })}</span></h3>`;
    const st = p ? stationsAt(p.x, p.y - 8) : { none: true }, hf = p ? handsFrozen() : false;
    for (const [g, name] of GROUPS) {
      const list = RECIPES.map((r, idx) => [r, idx] as const).filter(([r]) => r.group === g && knows(r.tech));
      if (!list.length) continue;
      h += `<div class="grp">${name()}</div>`;
      for (const [r, idx] of list) {
        const c = canCraft(r, st, hf);
        h += `<button class="rec ${c.ok ? 'ok' : 'no'}" data-a="rec" data-r="${idx}">${img(itemUrl(r.result))}<span class="t"><div>${itemName(r.result)}${r.n > 1 ? ' ×' + r.n : ''} <span class="pl">· ${placeLabel(r)}</span>${r.fine ? `<span class="fine">${img(uiUrl('fine_work'))}${fineLabel()}</span>` : ''}</div><div class="ing">${ingHtml(r)}</div>${c.ok ? '' : `<div class="why">${c.reason ?? ''}</div>`}</span></button>`;
      }
    }
    const unk = unknownRecipeTechs();
    if (unk.length) {
      h += `<div class="cnt">${S.more}</div>`;
      for (const t of unk) h += `<div class="qrow"><b>${S.q}</b><span>${techHint(t) || S.qExp}</span></div>`;
    }
  }
  h += `</div></div>` + footHtml();
  return h;
}
/** Keyed update: only touches the DOM when the markup changed, never in the middle of a drag. */
export function renderBag(panel: HTMLElement) {
  if (bagBusy()) return;
  const h = bagHtml();
  if (h === lastHtml && panel.firstChild) return;
  lastHtml = h;
  const sy = panel.scrollTop; panel.innerHTML = h; panel.scrollTop = sy;
}

// ---- operations --------------------------------------------------------------------------------------------------------------------
function resolve(el: HTMLElement | null): Ref | null {
  const c = el?.closest('[data-z]') as HTMLElement | null; if (!c) return null;
  return { z: c.dataset.z as ZoneId, i: +c.dataset.i! };
}
/** Normalise a target: «-1» (the grid background) and cells past the revealed ones mean «the first suitable place». */
function target(r: Ref, s: { id: string; n: number; dur?: number }): Ref | null {
  if (r.z === 'wear') return r;
  if (r.i < 0) return placeInto(r.z, s as never);
  if (r.z === 'box') return { z: 'box', i: r.i };
  return r;
}
function refresh() { if (panelEl) { lastHtml = ''; renderBag(panelEl); } }
function move(from: Ref, to: Ref, n?: number) {
  const s = refGet(from); if (!s) return 0;
  const t = target(to, s); if (!t) return 0;
  const k = moveStack(from, t, n);
  return k;
}
function afterMove(from: Ref) {
  if (ui.sel && !refGet(ui.sel)) ui.sel = null;
  if (from.z === 'inv' && from.i < BELT && inv.slots[inv.sel] === undefined) inv.sel = 0;
}
function primary(r: Ref) {
  const s = refGet(r); if (!s) return;
  const d = getItem(s.id);
  if (r.z === 'inv' && d.food) { eatSlot(r.i); }
  else if (d.wear && r.z !== 'wear' && !boxZone.cur) quickMove(r);
  else quickMove(r);
}
function tapCell(r: Ref) {
  const s = refGet(r);
  if (!ui.sel) { if (s) { ui.sel = r; if (r.z === 'inv' && r.i < BELT) select(r.i); } return; }
  if (refEq(ui.sel, r)) { ui.sel = null; return; }
  const from = ui.sel;
  const k = move(from, r);
  if (k > 0) { afterMove(from); if (!refGet(from)) ui.sel = null; else if (refGet(r)) ui.sel = from; }
  else if (s) { ui.sel = r; if (r.z === 'inv' && r.i < BELT) select(r.i); }
}
function act(a: string, el?: HTMLElement) {
  const r = ui.sel;
  switch (a) {
    case 'close': setOpenFn?.(false); return;
    case 'sort': sortZone('inv', (el?.dataset.m as 'kind' | 'weight') ?? ui.sortMode); if (sledOpen()) sortZone('sled', (el?.dataset.m as 'kind' | 'weight') ?? ui.sortMode); ui.sel = null; break;
    case 'takeall': takeAllFound(); break;
    case 'closebox': closeBox(); break;
    case 'use': if (r) primary(r); break;
    case 'move': if (r) { quickMove(r); } break;
    case 'half': if (r) { const d = splitStack(r, 'half'); if (d) ui.sel = d; } break;
    case 'one': if (r) { const d = splitStack(r, 'one'); if (d) ui.sel = d; } break;
    case 'drop': if (r) { dropRef(r); } break;
  }
  if (ui.sel && !refGet(ui.sel)) ui.sel = null;
  refresh();
}

// ---- pointer handling ----------------------------------------------------------------------------------------------------------------------
function ghostFor(r: Ref, x: number, y: number): HTMLElement | null {
  const s = refGet(r); if (!s) return null;
  const g = document.createElement('div'); g.id = 'bagghost'; g.innerHTML = img(itemUrl(s.id)) + (s.n > 1 ? `<b>${s.n}</b>` : '');
  g.style.left = x + 'px'; g.style.top = y + 'px'; document.body.appendChild(g); return g;
}
function endDrag(drop: boolean, x: number, y: number) {
  const d = ui.drag; ui.drag = null; if (!d) return;
  d.ghost?.remove(); d.over?.classList.remove('tgt'); panelEl?.classList.remove('dropout');
  if (drop && d.moved && panelEl) {
    const rect = panelEl.getBoundingClientRect();
    const outside = x < rect.left || x > rect.right || y < rect.top || y > rect.bottom;
    if (outside) { if (d.from.z !== 'box') dropRef(d.from); }
    else {
      const under = document.elementFromPoint(x, y) as HTMLElement | null;
      const to = resolve(under);
      if (to && !refEq(to, d.from)) { const k = move(d.from, to); if (k > 0) afterMove(d.from); }
    }
    ui.sel = null;
  }
  refresh();
}
function onDown(e: PointerEvent) {
  const t = e.target as HTMLElement;
  const cell = t.closest('.cell[data-z]') as HTMLElement | null;
  if (!cell || t.closest('button')) return;
  const ref = resolve(cell); if (!ref) return;
  const mouse = e.pointerType === 'mouse';
  if (mouse && e.button === 2) return;
  const p = { ref, x: e.clientX, y: e.clientY, t: performance.now(), timer: 0, consumed: false, pid: e.pointerId };
  if (!mouse) p.timer = window.setTimeout(() => { if (ui.press === p && !p.consumed) { p.consumed = true; navigator.vibrate?.(12); if (refGet(ref)) { quickMove(ref); ui.sel = null; refresh(); } } }, 520);
  ui.press = p;
  if (mouse && refGet(ref) && e.button === 0 && !e.shiftKey) ui.drag = { from: ref, x: e.clientX, y: e.clientY, moved: false, ghost: null, over: null, pid: e.pointerId, mouse: true };
}
function onMove(e: PointerEvent) {
  const pr = ui.press;
  if (pr && e.pointerId === pr.pid && !pr.consumed && Math.hypot(e.clientX - pr.x, e.clientY - pr.y) > 12) { clearTimeout(pr.timer); if (e.pointerType !== 'mouse') pr.consumed = true; }
  const d = ui.drag; if (!d || e.pointerId !== d.pid) return;
  if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) { d.moved = true; d.ghost = ghostFor(d.from, e.clientX, e.clientY); if (ui.press) ui.press.consumed = true; }
  if (!d.moved) return;
  e.preventDefault();
  if (d.ghost) { d.ghost.style.left = e.clientX + 'px'; d.ghost.style.top = e.clientY + 'px'; }
  const under = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
  const cell = under?.closest('.cell[data-z]') as HTMLElement | null;
  if (cell !== d.over) { d.over?.classList.remove('tgt'); d.over = cell; cell?.classList.add('tgt'); }
  if (panelEl && d.from.z !== 'box') {
    const rect = panelEl.getBoundingClientRect();
    panelEl.classList.toggle('dropout', e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom);
  }
}
function onUp(e: PointerEvent) {
  const pr = ui.press;
  if (ui.drag && e.pointerId === ui.drag.pid) {
    const moved = ui.drag.moved;
    endDrag(true, e.clientX, e.clientY);
    if (moved) { if (pr) clearTimeout(pr.timer); ui.press = null; return; }
  }
  if (!pr || e.pointerId !== pr.pid) return;
  clearTimeout(pr.timer); ui.press = null;
  if (pr.consumed) return;
  if (e.type === 'pointercancel') return;
  if (e.shiftKey && e.pointerType === 'mouse') { if (refGet(pr.ref)) { quickMove(pr.ref); ui.sel = null; refresh(); } return; }
  tapCell(pr.ref); refresh();
}
function onClick(e: Event) {
  const t = (e.target as HTMLElement).closest('[data-act],[data-a]') as HTMLElement | null; if (!t) return;
  if (t.dataset.act) { act(t.dataset.act, t); return; }
  if (t.dataset.a === 'close') { setOpenFn?.(false); return; }
}

/** devhud.ts: install the interaction on the panel element. `setOpen` shows / hides the panel (devhud owns that state). `craftClick` handles a recipe click. */
export function attachBag(panel: HTMLElement, setOpen: (v: boolean) => void, craftClick: (idx: number) => void) {
  ensureStyle();
  panelEl = panel; setOpenFn = setOpen;
  boxPanel.visible = () => panel.style.display === 'block';
  panel.addEventListener('pointerdown', onDown);
  addEventListener('pointermove', onMove, { passive: false });
  addEventListener('pointerup', onUp); addEventListener('pointercancel', onUp);
  panel.addEventListener('contextmenu', (e) => { e.preventDefault(); const r = resolve(e.target as HTMLElement); if (r && refGet(r)) { quickMove(r); ui.sel = null; refresh(); } });
  panel.addEventListener('dblclick', (e) => { const r = resolve(e.target as HTMLElement); if (r && refGet(r) && !(e.target as HTMLElement).closest('button')) { ui.drag = null; primary(r); ui.sel = null; refresh(); } });
  panel.addEventListener('click', (e) => {
    const rec = (e.target as HTMLElement).closest('[data-a="rec"]') as HTMLElement | null;
    if (rec) { craftClick(+rec.dataset.r!); refresh(); return; }
    onClick(e);
  });
  // a panel that only the container opened closes with the container («Закрыть ящик» must not leave the bag standing); one the player opened with C stays
  let openedByBox = false;
  on('box_open', () => { openedByBox = panel.style.display !== 'block'; ui.want = true; ui.sel = null; lastHtml = ''; });
  on('box_close', () => { if (openedByBox) { openedByBox = false; setOpen(false); } });
  on('new_game', () => { ui.sel = null; nearUi.open = false; });
  // «Рядом»: the list overlay and the phone button
  const root = panel.parentElement!;
  const list = document.createElement('div'); list.className = 'p nearl'; root.appendChild(list);
  const btn = document.createElement('div'); btn.id = 'nearbtn'; document.body.appendChild(btn);
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); nearUi.open = !nearUi.open; });
  list.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest('.nr') as HTMLElement | null; if (!row) return;
    const cur = nearbyList(); const n = cur[+row.dataset.i!]; if (n) takeNear(n);
    nearUi.open = cur.length > 2 ? nearUi.open : false;
  });
  let listKey = '';
  setInterval(() => {
    if (!G.player) return;
    const vis = panel.style.display === 'block';
    document.body.classList.toggle('bag-open', vis);
    if (vis && (boxOpen.box || ui.sel)) renderBag(panel);
    const cur = hi.list.length ? nearbyList() : [];
    const show = !vis && G.player.alive && cur.length >= 2 && !document.body.classList.contains('title-open') && !document.body.classList.contains('panel-open');      // not over the journal either
    btn.style.display = show && touchy() ? 'flex' : 'none';
    if (show && touchy()) btn.textContent = `${S.nearBtn} ${cur.length}`;
    if (nearUi.open && (vis || cur.length === 0 || !G.player.alive)) nearUi.open = false;
    if (!nearUi.open) { if (list.style.display !== 'none') list.style.display = 'none'; listKey = ''; return; }
    const k = cur.map(n => n.kind + n.id + n.label).join('|');
    if (k !== listKey) {
      listKey = k;
      let h = `<h3><span>${S.near}</span><span class="dim">${cur.length}</span></h3>`;
      cur.slice(0, 8).forEach((n, i) => {
        const ic = img(itemUrl(n.item ?? (n.kind === 'sled' ? 'sled' : 'cache')));
        const act = n.kind === 'drop' ? S.takeOne : n.kind === 'sled' ? S.hitch : S.open;
        h += `<button class="nr${i === 0 ? ' first' : ''}${n.heavy ? ' heavy' : ''}" data-i="${i}">${ic}<span class="t">${n.label}<small>${n.kind === 'drop' ? kg(n.w) + (n.heavy ? ' · ' + S.heavyTag : '') : ''}</small></span><b>${act}</b></button>`;
      });
      list.innerHTML = h;
    }
    list.style.display = 'block';
  }, 100);
}
export function bagIsOpen() { return !!panelEl && panelEl.style.display === 'block'; }
void isOpen;

/** Dev / test handle: window.__bag.{search, nearby, inv, ui}. */
if (typeof window !== 'undefined') (window as unknown as { __bag: unknown }).__bag = { search: searchMod, nearby: nearbyMod, inv: invMod, ui };
