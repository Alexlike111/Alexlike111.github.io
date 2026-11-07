// Bag + «Что умею» panel (C / Сумка). Left: belt + pack grid, clothing slots, weight. Right: the techniques the character KNOWS (recipes grouped
// Огонь / Еда и вода / Одежда / Охота / Стройка) with where they are practised («где угодно», «у стола на станции», «у огня», «тонкая работа
// (руки мёрзнут)») and «?» slots that hint where to learn more. Unknown techniques are never listed by name. Clicks are handled by devhud.ts
// (data-a = slot | un | rec | close), which owns the panel element; this module only builds the HTML.
import { G } from '../game/state';
import { strings, fmt } from '../content/i18n';
import { inv, weight, BELT, NSLOT, WEAR_SLOTS, WEIGHT_MAX, WEIGHT_SOFT } from '../game/inventory';
import { getItem, itemName } from '../game/items';
import { RECIPES, canCraft, placeLabel, fineLabel, unknownRecipeTechs, type Recipe, type RecipeGroup } from '../game/recipes';
import { stationsAt } from '../game/fixtures';
import { handsFrozen } from '../game/player';
import { knows, TECHS, techHint } from '../game/lore';
import { icon } from '../engine/sprites';
import { uiIcon } from '../art/icons';

const S = strings('bag', {
  pack: 'Пояс и сумка', skills: 'Что умею', weight: 'Вес {w}/{m} кг', worn: 'Одето', close: 'закрыть',
  slotHead: 'шапка', slotBody: 'парка', slotHands: 'рукавицы', slotFeet: 'обувь',
  gFire: 'Огонь', gFood: 'Еда и вода', gWear: 'Одежда', gHunt: 'Охота', gBuild: 'Стройка',
  dens: 'плотность {d}', known: 'Приёмов: {n} из {m}', more: 'Ещё есть чему учиться. Читай записки, смотри и пробуй.',
  q: '?', qExp: 'Приходит только с опытом.', qNote: 'Подсказка',
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
`;
let styled = false;
function ensureStyle() { if (styled || typeof document === 'undefined') return; styled = true; const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); }

function cellHtml(i: number): string {
  const s = inv.slots[i];
  if (!s) return `<div class="cell empty${i < BELT ? ' belt' : ''}">${i < BELT ? `<span class="k">${i + 1}</span>` : ''}</div>`;
  return `<button class="cell${i < BELT ? ' belt' : ''}${i === inv.sel ? ' sel' : ''}" data-a="slot" data-i="${i}" title="${itemName(s.id)}${s.id === 'snow_block' && s.dur ? ' · ' + fmt(S.dens, { d: Math.round(s.dur) }) : ''}">${i < BELT ? `<span class="k">${i + 1}</span>` : ''}${img(itemUrl(s.id))}${s.n > 1 ? `<i class="n">${s.n}</i>` : ''}</button>`;
}
function ingHtml(rec: Recipe): string {
  return rec.variants.map(v => '<span>' + v.map(g => img(itemUrl(g.id)) + itemName(g.id) + (g.n > 1 ? ' ×' + g.n : '')).join(', ') + '</span>').join('<span class="dim">/</span>');
}
/** The whole panel as HTML. Only known techniques appear; unknown ones leave a «?» with a hint. */
export function bagHtml(): string {
  ensureStyle();
  const p = G.player;
  const wt = weight();
  let h = `<div class="cols"><div class="col"><h3><span>${S.pack}</span><span>${fmt(S.weight, { w: wt.toFixed(1), m: WEIGHT_MAX })}</span></h3>`;
  h += `<div class="wt"><i style="width:${Math.min(100, wt / WEIGHT_MAX * 100)}%;background:${wt > WEIGHT_SOFT ? '#ffc46e' : '#8fe3b0'}"></i></div>`;
  h += `<div class="wear">`;
  for (const sl of WEAR_SLOTS) {
    const id = inv.wear[sl];
    h += id ? `<button class="cell" data-a="un" data-s="${sl}" title="${itemName(id)}">${img(itemUrl(id))}<small>${SLOT_LABEL[sl]()}</small></button>` : `<div class="cell empty"><small>${SLOT_LABEL[sl]()}</small></div>`;
  }
  h += `</div><div class="grid">`;
  for (let i = 0; i < NSLOT; i++) h += cellHtml(i);
  h += `</div></div><div class="col"><h3><span>${S.skills}</span><span class="dim">${fmt(S.known, { n: TECHS.filter(t => knows(t.id)).length, m: TECHS.length })}</span></h3>`;
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
  h += `</div></div><div style="text-align:right;margin-top:6px"><button class="cl" data-a="close">${S.close}</button></div>`;
  return h;
}
void GROUPS;
