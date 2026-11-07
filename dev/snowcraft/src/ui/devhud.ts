// HUD (DESIGN §10): body figure with per-extremity frost tint + thermometer / hydration / food / energy / wet / CO, sun-clock semicircle with
// moon phase and barometer arrow, wind arrow, one top-centre stack (objective line, shelter chip, toasts: they can never overlap), belt with icons
// (count badge top-right, name only for the active slot), bag + crafting panel (icon grid, clothing slots, weight bar, recipes grouped by DESIGN
// categories), death card, ending card. One pixel font (Pixelify Sans) shared with the touch controls. `?devhud` adds the old numeric readout.
// File name kept for main.ts; the old developer list lives behind the flag.
import '@fontsource/pixelify-sans/latin-400.css';
import '@fontsource/pixelify-sans/cyrillic-400.css';
import '@fontsource/pixelify-sans/latin-600.css';
import '@fontsource/pixelify-sans/cyrillic-600.css';
import '@fontsource/jura/latin-400.css';
import '@fontsource/jura/cyrillic-400.css';
import '@fontsource/jura/latin-600.css';
import '@fontsource/jura/cyrillic-600.css';
import { G } from '../game/state';
import { input } from '../engine/input';
import { strings, fmt } from '../content/i18n';
import { inv, BELT, select, equip, unequip, beltCells } from '../game/inventory';
import { getItem, itemName, stackIcon } from '../game/items';
import { RECIPES, craft, craftedText } from '../game/recipes';
import { stationsAt } from '../game/fixtures';
import { target } from '../game/tools';
import { body, handsFrozen, eatSlot } from '../game/player';
import { icon } from '../engine/sprites';
import { uiIcon, moonIcon } from '../art/icons';
import { knowsForecast, sunElevAt } from '../game/weather';
import { toast } from '../game/state';
import { on } from '../game/bus';
import { objective, objectiveTarget, initQuest, prog, journal } from '../game/quest';
import { worldToScreen } from '../engine/render';
import { renderBag, attachBag, bagWantsOpen } from './bag';
import { seasonLabel } from '../game/seasons';
import { renderJournalInto, journalClick, setJournalTab } from './journal';

const S = strings('hud', {
  core: 'Ядро', hands: 'Руки', feet: 'Ноги', face: 'Лицо', water: 'Вода', food: 'Еда', energy: 'Силы', wet: 'Сырость', hp: 'Здоровье', co: 'CO',
  feels: 'ощущается {t}°', air: 'воздух {t}°',
  sunDeep: 'солнце {e}°', moon: 'луна',
  shelter: 'Укрытие', noShelter: 'нет укрытия', vent: 'отдушина ✓', noVentTxt: 'отдушины нет', temp: '{t}°',
  dead: 'Ты погиб: {c}', deadHard: 'Хардкор: забег окончен',
  pause: 'ПАУЗА', free: 'свободная камера (F2)',
  bag: 'Сумка', craft: 'Мастерская', weight: 'Вес {w}/{m} кг', worn: 'Одето', close: 'закрыть', pack: 'Пояс и сумка',
  slotHead: 'шапка', slotBody: 'парка', slotHands: 'рукавицы', slotFeet: 'обувь',
  forecast: 'прогноз: {t}', noForecast: 'барометр: E у столба', baroUp: 'давление растёт', baroDown: 'давление падает',
  storm: 'ПУРГА', wind: '{w} м/с', calm: 'штиль',
  dens: 'плотность {d}', fine: 'тонкая работа: голые руки', needs: 'нужно: {s}', variant: 'вариант',
  gFire: 'Огонь', gFood: 'Еда и вода', gWear: 'Одежда', gHunt: 'Охота', gBuild: 'Стройка',
  stNone: '', stTable: 'стол', stFire: 'огонь', stDrum: 'бочка', stAntenna: 'мачта',
  stove: 'печь', hintMove: 'ход', hintAct: 'действие', hintTake: 'взять', hintEat: 'еда', hintParka: 'парка', hintBag: 'сумка', hintDome: 'купол/курсор', hintDrop: 'бросить', hintJump: 'прыжок', hintRun: 'бег', hintBelt: 'пояс', hintJournal: 'журнал',
  jTitle: 'Журнал', jGoals: 'Цели', jLog: 'Записи', jSites: 'Места', jNone: 'пока пусто', jNote: 'Найдена записка', gFire2: 'Растопить печь', gBaro: 'Проверить барометр', gShelter: 'Укрытие от ★★', gSleep: 'Выспаться в тепле', gParts: 'Детали рации {n}/3', gMast: 'Антенная мачта', gRadio: 'Починить рацию', gEnd: 'Дожить до рассвета (день {n})',
  lmb: 'ЛКМ', objTitle: 'Цель', radialHint: 'Пояс',
  wThirst: 'хочется пить', wThirst2: 'жажда мучит', wHunger: 'сосёт под ложечкой', wHunger2: 'живот сводит', wTired: 'устал', wTired2: 'валишься с ног', wHurt: 'ранен', wHurt2: 'при смерти',
});

let root: HTMLElement, bw: HTMLElement, dial: HTMLElement, stack: HTMLElement, objEl: HTMLElement, chip: HTMLElement, toastBox: HTMLElement, beltEl: HTMLElement, bname: HTMLElement;
let arrowEl: HTMLElement, arrowKey = '', arrowT = 0, arrowDir = NaN, arrowM = -1;
let tip: HTMLElement, deadEl: HTMLElement, panel: HTMLElement, hintEl: HTMLElement, endEl: HTMLElement, devEl: HTMLElement | null = null, pauseEl: HTMLElement;
let panelOpen = false, jOpen = false;
let jEl: HTMLElement;
let beltKey = '', toastKey = '';
let acc = 0, panelAcc = 0, rectAcc = 9;
let avoid: DOMRect[] = [];
let freeCam = false;
export function setFreeCamLabel(on: boolean) { freeCam = on; }
const DEV = new URLSearchParams(location.search).has('devhud');

// ---- icon helpers (data URLs so innerHTML templates can use them) -------------------------------------------------------------------
const urlCache = new Map<string, string>();
const itemUrl = (id: string, dur?: number) => { const ik = stackIcon(id, dur); let u = urlCache.get(ik); if (!u) { u = icon(ik).toDataURL(); urlCache.set(ik, u); } return u; };
const uiUrl = (key: string, tint?: string) => { const k = 'ui.' + key + '|' + (tint ?? ''); let u = urlCache.get(k); if (!u) { u = uiIcon(key, tint).toDataURL(); urlCache.set(k, u); } return u; };
const img = (src: string, cls = '') => `<img class="ic ${cls}" src="${src}" alt="" draggable="false">`;

const CSS = `
#hud{position:fixed;inset:0;z-index:20;pointer-events:none;font:600 14px/1.3 'Jura',system-ui,sans-serif;color:#dff0ff;
 padding:env(safe-area-inset-top,0) env(safe-area-inset-right,0) env(safe-area-inset-bottom,0) env(safe-area-inset-left,0);text-shadow:0 1px 0 #05080f}
#hud .p{position:absolute;background:linear-gradient(180deg,rgba(14,26,46,.78),rgba(8,16,30,.78));border:1px solid rgba(124,198,238,.38);border-radius:4px;padding:5px 7px;box-shadow:0 0 0 1px #05080f,inset 0 1px 0 rgba(190,226,250,.12)}
#hud .ic{image-rendering:pixelated;width:16px;height:16px;vertical-align:middle;flex:none}
#hud .warn{color:#ffc46e}#hud .bad{color:#ff7a68}#hud .good{color:#8fe3b0}#hud .dim{opacity:.7}
/* body widget */
#hud .bw{left:8px;top:8px;display:flex;gap:8px;align-items:stretch}
#hud .bw canvas{width:36px;height:72px;image-rendering:pixelated;align-self:center;flex:none}
#hud .bw .rows,#hud .dial .day,#hud .belt,#hud .pnl h3,#hud .dead,#hud .pause{font-family:'Pixelify Sans','Jura',sans-serif}
#hud .bw .rows{display:flex;flex-direction:column;gap:3px;min-width:104px}
#hud .bw .r{display:flex;align-items:center;gap:5px;height:16px;font-variant-numeric:tabular-nums;white-space:nowrap}
#hud .bw .bar{display:flex;gap:1px;flex:1}
#hud .bw .bar i{flex:1;height:7px;background:#16273d;border-radius:1px}
#hud .bw .bar i.on{background:#8fe3b0}#hud .bw .bar.warn i.on{background:#ffc46e}#hud .bw .bar.bad i.on{background:#ff7a68}
#hud .bw .v{min-width:44px;text-align:right}
#hud .bw .sub{font-size:12px;opacity:.78;margin-top:1px}
#hud .bw .alert{display:none;align-items:center;gap:4px;color:#ff9a88}
/* sun clock + wind */
#hud .dial{right:8px;top:8px;width:130px;padding:4px 5px;text-align:center}
#hud .dial canvas{width:112px;height:68px;image-rendering:pixelated;display:block}
#hud .dial .day{font-weight:400;letter-spacing:.2px;font-variant-numeric:tabular-nums}
#hud .dial .clk{font-size:12px;opacity:.85;font-variant-numeric:tabular-nums;margin-top:-1px}
#hud .dial .line{display:flex;align-items:center;justify-content:center;gap:5px;font-size:12px;margin-top:2px;white-space:normal;line-height:1.15;text-align:left}
#hud .dial .line.baro span{min-width:0;overflow-wrap:anywhere}
#hud .dial .line .ic{width:14px;height:14px}
#hud .dial .wa{transition:transform .4s}
/* top centre stack: objective, shelter chip, toasts in one flow, so they never overlap */
#hud .stk{position:absolute;left:50%;top:8px;transform:translateX(-50%);max-width:calc(100vw - 2*(150px + 16px));display:flex;flex-direction:column;align-items:center;gap:4px;pointer-events:none}
#hud .stk .p{position:static;text-align:center;max-width:100%}
#hud .obj{font-size:14px;color:#e8f4ff;border-color:rgba(255,196,110,.5)}
#hud .obj b{color:#ffc46e;font-weight:600;margin-right:6px}
#hud .chip{display:none;font-size:13px;padding:3px 8px}
#hud .toast{font-size:16px;padding:4px 10px}
/* belt */
#hud .belt{position:absolute;left:50%;bottom:calc(8px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);display:flex;gap:4px;padding:4px;pointer-events:auto}
#hud .belt .sl{position:relative;width:56px;height:56px;border:2px solid rgba(124,198,238,.3);border-radius:4px;background:rgba(10,18,32,.6);display:flex;align-items:center;justify-content:center;cursor:pointer}
#hud .belt .sl.frz{border-color:#9fd6ff}
#hud .belt .sl.sel{border-color:#ffc46e;background:rgba(60,34,12,.72)}
#hud .belt .sl .ic{width:32px;height:32px}
#hud .belt .sl .k{position:absolute;left:3px;top:1px;font-size:11px;color:#8ab0c8;font-weight:400}
#hud .belt .sl .n{position:absolute;right:2px;top:1px;font-size:12px;color:#fff;background:rgba(5,8,15,.7);padding:0 3px;border-radius:2px;font-style:normal;font-variant-numeric:tabular-nums}
#hud .belt .sl .bar{position:absolute;left:4px;right:4px;bottom:3px;height:3px;background:#123}#hud .belt .sl .bar i{display:block;height:100%;background:#8fe3b0}
#hud .bname{position:absolute;left:50%;bottom:calc(76px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);font-size:13px;padding:2px 8px;display:none;white-space:nowrap}
body.touch-ui #hud .belt{left:50%;padding:3px;gap:4px}
body.touch-ui #hud .belt .sl{display:flex;width:40px;height:40px;flex:none}
body.touch-ui #hud .belt .sl .ic{width:28px;height:28px}
body.touch-ui #hud .belt .sl .k{display:none}
body.radial-open #hud .tbox{visibility:hidden}
body.touch-ui #hud .bname{left:calc(50% - 40px);bottom:calc(66px + env(safe-area-inset-bottom,0px))}
#hud .tip{pointer-events:none;max-width:260px;font-size:13px;display:none}
#hud .arw{position:absolute;display:none;align-items:center;gap:4px;font-size:14px;color:#ffc46e;pointer-events:none;white-space:nowrap;transform:translate(-50%,-50%);animation:arwblink .8s steps(2,end) infinite}
#hud .arw svg{width:18px;height:18px;flex:none;filter:drop-shadow(0 0 3px #05080f)}
#hud .arw path{fill:#ffc46e;stroke:#05080f;stroke-width:1.2;stroke-linejoin:round}
#hud .arw.still{animation:none;opacity:.8}
@keyframes arwblink{0%,100%{opacity:1}50%{opacity:.25}}
#hud .dead{inset:0;background:rgba(40,0,0,.55);display:none;align-items:center;justify-content:center;flex-direction:column;font-size:24px;pointer-events:auto;border:0;border-radius:0;text-align:center}
#hud .end{inset:0;background:rgba(255,220,160,.18);display:none;align-items:center;justify-content:center;font-size:30px;border:0;border-radius:0}
#hud .pause{left:50%;top:44%;transform:translate(-50%,-50%);display:none;font-size:22px;letter-spacing:2px;padding:8px 18px}
/* bag + craft panel */
#hud .pnl{left:50%;top:50%;transform:translate(-50%,-50%);width:min(820px,96vw);max-height:86vh;overflow:auto;display:none;pointer-events:auto;background:rgba(8,14,26,.985);font-size:13px;padding:8px 10px}
#hud .pnl h3{margin:0 0 4px;font-size:14px;font-weight:600;color:#ffc46e;display:flex;justify-content:space-between;align-items:center}
#hud .pnl .cols{display:flex;gap:12px;flex-wrap:wrap}#hud .pnl .col{flex:1 1 300px;min-width:0}
#hud .pnl .wt{height:6px;background:#16273d;border-radius:2px;position:relative;margin:3px 0 7px}
#hud .pnl .wt i{display:block;height:100%;background:#8fe3b0;border-radius:2px}
#hud .pnl .wear{display:flex;gap:6px;margin-bottom:7px}
#hud .pnl .grid{display:grid;grid-template-columns:repeat(6,1fr);gap:4px}
#hud .pnl .cell{position:relative;aspect-ratio:1;min-height:40px;border:2px solid rgba(124,198,238,.22);border-radius:4px;background:rgba(10,18,32,.6);display:flex;align-items:center;justify-content:center;cursor:pointer;color:#dff0ff;font:inherit;padding:0}
#hud .pnl .cell.belt{border-color:rgba(255,196,110,.4)}#hud .pnl .cell.sel{border-color:#ffc46e}
#hud .pnl .cell.empty{cursor:default;opacity:.55}
#hud .pnl .cell .ic{width:28px;height:28px}
#hud .pnl .cell .n{position:absolute;right:2px;top:1px;font-size:11px;background:rgba(5,8,15,.7);padding:0 3px;border-radius:2px;font-style:normal}
#hud .pnl .cell .k{position:absolute;left:3px;top:0;font-size:10px;color:#8ab0c8}
#hud .pnl .wear .cell{width:52px;aspect-ratio:auto;height:52px;flex:none}
#hud .pnl .wear .cell small{position:absolute;bottom:1px;left:0;right:0;text-align:center;font-size:9px;opacity:.7}
#hud .pnl .grp{margin:7px 0 3px;font-size:12px;color:#7cc6ee;border-bottom:1px solid rgba(124,198,238,.25);letter-spacing:.5px}
#hud .pnl .rec{display:flex;align-items:center;gap:7px;width:100%;box-sizing:border-box;text-align:left;font:inherit;color:#dff0ff;background:#13243a;border:1px solid #2c4a6a;border-radius:4px;padding:3px 6px;margin:2px 0;cursor:pointer;min-height:34px}
#hud .pnl .rec.no{opacity:.55}#hud .pnl .rec.ok{border-color:#8fe3b0}
#hud .pnl .rec .t{flex:1;min-width:0}#hud .pnl .rec .ing{font-size:11px;opacity:.8;display:flex;flex-wrap:wrap;gap:2px 8px;align-items:center}
#hud .pnl .rec .ing .ic{width:12px;height:12px;margin-right:1px}#hud .pnl .rec .why{font-size:11px;color:#ffb08a}
#hud .pnl .rec .fw{width:14px;height:14px}
#hud .pnl button.cl{font:inherit;color:#dff0ff;background:#13243a;border:1px solid #2c4a6a;border-radius:4px;padding:3px 10px;cursor:pointer;min-height:30px}
/* hints */
#hud .hint{left:8px;bottom:calc(8px + env(safe-area-inset-bottom,0px));font-size:13px;display:none;max-width:calc(50vw - 230px);line-height:1.7}
#hud .hint kbd{font:inherit;font-size:12px;background:#1b2f48;border:1px solid #4b7aa0;border-bottom-width:2px;border-radius:3px;padding:0 4px;margin-right:3px;color:#fff}
#hud .hint span{margin-right:9px;white-space:nowrap;display:inline-block}
#hud .dev{left:8px;bottom:70px;font-size:11px;font-family:system-ui,sans-serif;display:block;white-space:pre}
@media (max-width:1100px){#hud .hint{max-width:calc(50vw - 20px);bottom:calc(76px + env(safe-area-inset-bottom,0px))}}
/* phone: compact HUD (belt collapses to the active slot, the Пояс radial replaces it) */
body.touch-ui #hud{font-size:14px}
body.touch-ui #hud .bw{padding:3px 5px;gap:5px}body.touch-ui #hud .bw canvas{width:24px;height:48px}
body.touch-ui #hud .bw .rows,#hud .dial .day,#hud .belt,#hud .pnl h3,#hud .dead,#hud .pause{font-family:'Pixelify Sans','Jura',sans-serif}
#hud .bw .rows{min-width:84px;gap:1px}body.touch-ui #hud .bw .r{height:13px;gap:3px}body.touch-ui #hud .bw .ic{width:12px;height:12px}
body.touch-ui #hud .bw .bar i{height:5px}body.touch-ui #hud .bw .v{min-width:34px}body.touch-ui #hud .bw .sub{display:none}
body.touch-ui #hud .dial{left:150px;right:auto;top:8px;width:84px;padding:2px 3px}
body.touch-ui #hud .dial canvas{width:78px;height:47px}
body.touch-ui #hud .dial .day{font-size:11px;line-height:1.15}
body.touch-ui #hud .dial .clk{font-size:12px;opacity:.85;font-variant-numeric:tabular-nums;margin-top:-1px}
#hud .dial .line{font-size:11px}body.touch-ui #hud .dial .line.mid{display:none}
body.touch-ui #hud .stk{left:244px;right:220px;transform:none;max-width:none}
body.touch-ui #hud .toast{font-size:13px;padding:2px 8px}body.touch-ui #hud .obj{font-size:12px;padding:2px 8px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
body.touch-ui #hud .pnl{font-size:12px}
`;


/** Toasts on screen: at most `max`; warnings and bad news first, then the newest; identical texts collapse to the newest; shown in time order. */
const TOAST_RANK: Record<string, number> = { bad: 0, warn: 1, good: 2, info: 3 };
function pickToasts(max: number) {
  const seen = new Set<string>(), uniq: typeof G.toasts = [];
  for (let i = G.toasts.length - 1; i >= 0; i--) { const t = G.toasts[i]; if (!seen.has(t.text)) { seen.add(t.text); uniq.push(t); } }
  const top = uniq.sort((a, b) => TOAST_RANK[a.kind ?? 'info'] - TOAST_RANK[b.kind ?? 'info']).slice(0, max);
  return top.sort((a, b) => G.toasts.indexOf(a) - G.toasts.indexOf(b));
}

// ---- body widget ----------------------------------------------------------------------------------------------------------------
interface Row { icon: string; bar: HTMLElement; v: HTMLElement; row: HTMLElement }
const rows: Record<string, Row> = {};
let fig: HTMLCanvasElement, figCtx: CanvasRenderingContext2D, figKey = '', subEl: HTMLElement, alertEl: HTMLElement, wetEl: HTMLElement;
const SEGS = 8;
function mkRow(key: string, ic: string, withBar = true): Row {
  const row = document.createElement('div'); row.className = 'r';
  row.innerHTML = img(ic) + (withBar ? '<span class="bar">' + '<i></i>'.repeat(SEGS) + '</span>' : '') + '<span class="v"></span>';
  const bar = row.querySelector('.bar') as HTMLElement, v = row.querySelector('.v') as HTMLElement;
  return (rows[key] = { icon: ic, bar, v, row });
}
function buildBody() {
  bw.innerHTML = '';
  fig = document.createElement('canvas'); fig.width = 12; fig.height = 24; figCtx = fig.getContext('2d')!; figCtx.imageSmoothingEnabled = false;
  bw.appendChild(fig);
  const col = document.createElement('div'); col.className = 'rows'; bw.appendChild(col);
  for (const [k, ic, bar] of [['core', uiUrl('thermo'), false], ['water', uiUrl('drop'), true], ['food', uiUrl('food'), true], ['energy', uiUrl('bolt'), true], ['hp', uiUrl('heart'), true]] as [string, string, boolean][]) col.appendChild(mkRow(k, ic, bar).row);
  wetEl = mkRow('wet', uiUrl('wet'), false).row; col.appendChild(wetEl);
  alertEl = document.createElement('div'); alertEl.className = 'r alert'; alertEl.innerHTML = img(uiUrl('warn')) + '<span></span>'; col.appendChild(alertEl);
  subEl = document.createElement('div'); subEl.className = 'sub'; col.appendChild(subEl);
}
const frostTint = (v: number) => (v >= 80 ? '#5c7396' : v >= 40 ? '#9ccfff' : v >= 20 ? '#d6ecff' : '#ffffff');
const coreTint = (c: number) => (c < 33 ? '#6f8fb8' : c < 35.5 ? '#a9cdf0' : c >= 37.2 ? '#ffe6c8' : '#ffffff');
function drawFigure(p: typeof G.player) {
  const th = frostTint(p.frost.hands), tf = frostTint(p.frost.feet), tface = frostTint(p.frost.face), tc = coreTint(p.core);
  const key = th + tf + tface + tc; if (key === figKey) return; figKey = key;
  figCtx.clearRect(0, 0, 12, 24);
  figCtx.drawImage(uiIcon('body_torso', tc), 0, 0); figCtx.drawImage(uiIcon('body_head', tface), 0, 0);
  figCtx.drawImage(uiIcon('body_hands', th), 0, 0); figCtx.drawImage(uiIcon('body_feet', tf), 0, 0);
}
function setBar(r: Row, v: number, bad: number, warn: number) {
  const n = Math.max(0, Math.min(SEGS, Math.round(v / 100 * SEGS)));
  const kids = r.bar.children;
  for (let i = 0; i < SEGS; i++) (kids[i] as HTMLElement).className = i < n ? 'on' : '';
  r.bar.className = 'bar ' + (v < bad ? 'bad' : v < warn ? 'warn' : '');
  r.v.textContent = String(Math.round(v));
}

// ---- sun clock ------------------------------------------------------------------------------------------------------------------
let dialCv: HTMLCanvasElement, dialCtx: CanvasRenderingContext2D, dayEl: HTMLElement, clkEl: HTMLElement, windRow: HTMLElement, baroRow: HTMLElement, stormRow: HTMLElement;
const DW = 56, DH = 34, HZ = 21;
function buildDial() {
  dial.innerHTML = '<canvas width="' + DW + '" height="' + DH + '"></canvas><div class="day"></div><div class="clk"></div><div class="line mid wind"></div><div class="line baro"></div><div class="line storm"></div>';
  dialCv = dial.querySelector('canvas') as HTMLCanvasElement; dialCtx = dialCv.getContext('2d')!;
  dayEl = dial.querySelector('.day') as HTMLElement; clkEl = dial.querySelector('.clk') as HTMLElement; windRow = dial.querySelector('.wind') as HTMLElement; baroRow = dial.querySelector('.baro') as HTMLElement; stormRow = dial.querySelector('.storm') as HTMLElement;
}
function px(c: CanvasRenderingContext2D, x: number, y: number, col: string) { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), 1, 1); }
function drawDial() {
  const c = dialCtx; c.clearRect(0, 0, DW, DH);
  const cx = DW / 2, R = 25;
  // sky dome (upper half-disc) above the horizon, dim ground band below
  for (let y = 0; y <= HZ; y++) { const dy = HZ - y, half = Math.sqrt(Math.max(0, R * R - dy * dy)); c.fillStyle = y > HZ - 6 ? '#27406a' : '#122240'; c.fillRect(Math.round(cx - half), y, Math.round(half * 2), 1); }
  c.fillStyle = '#0a1424'; c.fillRect(2, HZ + 1, DW - 4, DH - HZ - 1);
  for (let a = 0; a <= 180; a += 3) { const r = a * Math.PI / 180; px(c, cx - Math.cos(r) * R, HZ - Math.sin(r) * R, '#5e9bd0'); }
  c.fillStyle = '#7cc6ee'; c.fillRect(1, HZ, DW - 2, 1);
  // tick marks every 6 hours + the path of the sun through the day (valley below the horizon in the polar night)
  for (const f of [0, 0.25, 0.5, 0.75, 1]) { const x = 3 + 50 * f; c.fillStyle = '#35618f'; c.fillRect(Math.round(x), HZ + 1, 1, f === 0.5 ? 4 : 2); }
  const ey = (el: number) => Math.min(DH - 3, HZ - el * 0.36);
  const tod = ((G.time % 1440) + 1440) % 1440 / 1440;
  for (let i = 0; i <= 50; i += 2) { const f = i / 50, tt = G.time - tod * 1440 + f * 1440; px(c, 3 + 50 * f, ey(sunPath(tt)), '#4d6f99'); }
  const sx = 3 + 50 * tod, sy = ey(G.sunElev);
  const above = G.sunElev > -0.5;
  c.fillStyle = above ? '#ffd870' : '#c9962e'; c.fillRect(Math.round(sx) - 2, Math.round(sy) - 1, 5, 3); c.fillRect(Math.round(sx) - 1, Math.round(sy) - 2, 3, 5);
  c.fillStyle = above ? '#fff4b0' : '#f4cf5a'; c.fillRect(Math.round(sx) - 1, Math.round(sy) - 1, 2, 2);
  // moon in the dome
  if (G.moon > 0.05) c.drawImage(moonIcon(G.moonPhase), cx + 9, 2, 10, 10);
}
const sunPath = sunElevAt;

// ---------------------------------------------------------------------------------------------------------------------------------
export function initHud(host: HTMLElement) {
  initQuest();
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  root = document.createElement('div'); root.id = 'hud'; host.appendChild(root);
  const mk = (cls: string, parent: HTMLElement = root) => { const d = document.createElement('div'); d.className = 'p ' + cls; parent.appendChild(d); return d; };
  bw = mk('bw'); dial = mk('dial');
  stack = document.createElement('div'); stack.className = 'stk'; root.appendChild(stack);
  objEl = mk('obj', stack); chip = mk('chip', stack); toastBox = document.createElement('div'); toastBox.className = 'tbox'; toastBox.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:3px'; stack.appendChild(toastBox);
  beltEl = mk('belt'); bname = mk('bname'); tip = mk('tip'); deadEl = mk('dead'); pauseEl = mk('pause'); panel = mk('pnl'); jEl = mk('pnl'); jEl.addEventListener('click', (e) => { if (journalClick(e)) { jOpen = false; jEl.style.display = 'none'; } }); hintEl = mk('hint'); endEl = mk('end');
  arrowEl = document.createElement('div'); arrowEl.className = 'arw'; arrowEl.innerHTML = '<svg viewBox="0 0 18 18"><path d="M2 3.5 L15.5 9 L2 14.5 Z"/></svg><span></span>'; root.appendChild(arrowEl);
  buildBody(); buildDial();
  const k = (key: string, label: string) => `<span><kbd>${key}</kbd>${label}</span>`;
  hintEl.innerHTML = k('Space', S.hintJump) + k('WASD', S.hintMove) + k('Shift', S.hintRun) + k(S.lmb, S.hintAct) + k('E', S.hintTake) + k('F', S.hintEat) + k('V', S.hintParka) + k('C', S.hintBag) + k('J', S.hintJournal) + k('1–6', S.hintBelt) + k('R', S.hintDome) + k('G', S.hintDrop);
  if (!G.mobile) hintEl.style.display = 'block';
  if (DEV) { devEl = mk('dev'); }
  on('new_game', () => { panelOpen = jOpen = false; panel.style.display = 'none'; jEl.style.display = 'none'; document.body.classList.remove('panel-open'); });
  beltEl.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const el = (e.target as HTMLElement).closest('.sl') as HTMLElement | null; if (!el) return;
    select(+el.dataset.i!);
  });
  attachBag(panel, setPanelOpen, craftIdx);         // §12: drag & drop, tap-select, container panel, «Рядом» list (ui/bag.ts)
}
const shortcut = (key: string) => key;

/** Put the probe tooltip next to the cursor but out of the HUD (body figure, dial, belt) and the touch buttons: try right/below, left/below, right/above, left/above, then clamp. */
function placeTip(sx: number, sy: number) {
  if (rectAcc > 0.4) {
    rectAcc = 0; avoid = [];
    for (const el of [bw, dial, beltEl, ...Array.from(document.querySelectorAll('#touch .tb')) as HTMLElement[]]) { if (!el || el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue; const r = el.getBoundingClientRect(); if (r.width > 0) avoid.push(r); }
  }
  const W = window.innerWidth, H = window.innerHeight, w = tip.offsetWidth || 200, h = tip.offsetHeight || 40, g = 6;
  const hit = (x: number, y: number) => avoid.some(r => x < r.right + g && x + w > r.left - g && y < r.bottom + g && y + h > r.top - g);
  const cands: [number, number][] = [[sx + 16, sy + 14], [sx - w - 12, sy + 14], [sx + 16, sy - h - 12], [sx - w - 12, sy - h - 12], [sx + 16, sy + 70], [sx - w - 12, sy - h - 60]];
  let best = cands[0];
  for (const c of cands) { const x = Math.max(4, Math.min(W - w - 4, c[0])), y = Math.max(4, Math.min(H - h - 4, c[1])); if (!hit(x, y)) { best = [x, y]; break; } best = [x, y]; }
  tip.style.left = best[0] + 'px'; tip.style.top = best[1] + 'px';
}

function setPanelOpen(v: boolean) { panelOpen = v; panel.style.display = v ? 'block' : 'none'; panelAcc = 9; }
function craftIdx(idx: number) {
  const p = G.player, r = RECIPES[idx];
  if (r && craft(r, stationsAt(p.x, p.y - 8), handsFrozen())) toast(craftedText(r), 'good');
  panelAcc = 9;
}

/** Arrow to the current goal, at the screen edge when the goal is off screen: blinks for the first 60 s of each goal, shows metres (1 cell ~ 9 cm). */
function updateArrow(realDt: number) {
  const p = G.player, key = objective();
  if (key !== arrowKey) { arrowKey = key; arrowT = 0; }
  arrowT += realDt;
  const tgt = p?.alive && !panelOpen && !jOpen && !G.paused ? objectiveTarget() : null;
  if (!tgt || !p) { arrowEl.style.display = 'none'; return; }
  const [sx, sy] = worldToScreen(tgt.x, tgt.y);
  const W = window.innerWidth, H = window.innerHeight, dx = sx - W / 2, dy = sy - H / 2;
  const hw = W / 2 - 70, hh = H / 2 - 60;
  if (Math.abs(dx) <= hw && Math.abs(dy) <= hh) { arrowEl.style.display = 'none'; return; }
  const k = Math.min(Math.abs(dx) > 0 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 0 ? hh / Math.abs(dy) : Infinity);
  arrowEl.style.left = Math.round(W / 2 + dx * k) + 'px'; arrowEl.style.top = Math.round(H / 2 + dy * k) + 'px';
  arrowEl.style.display = 'flex'; arrowEl.classList.toggle('still', arrowT >= 60);        // it blinks for the first minute of a goal, then stays on, steady: a lost player still has the way
  const deg = Math.round(Math.atan2(dy, dx) * 180 / Math.PI);
  if (deg !== arrowDir) { arrowDir = deg; (arrowEl.firstElementChild as SVGElement).style.transform = `rotate(${deg}deg)`; }
  const m = Math.round(Math.hypot(tgt.x - p.x, tgt.y - p.y) * 0.09);
  if (m !== arrowM) { arrowM = m; arrowEl.lastElementChild!.textContent = m + ' м'; }
}

const cls = (bad: boolean, warn: boolean) => (bad ? 'bad' : warn ? 'warn' : 'good');
const fmtClock = () => { const h = Math.floor(((G.time % 1440) + 1440) % 1440 / 60), m = Math.floor(G.time % 60); return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'); };

export function updateHud(dt: number, realDt: number) {
  if (!root) return;
  const p = G.player;
  const titleOn = document.body.classList.contains('title-open');
  if (titleOn) { input.craftPressed = input.journalPressed = input.mapPressed = input.pausePressed = false; if (panelOpen || jOpen) { panelOpen = jOpen = false; panel.style.display = jEl.style.display = 'none'; } }
  if (endEl.style.display === 'flex' || (document.querySelector('#ov .card.end') as HTMLElement | null)?.style.display === 'flex') input.pausePressed = false;       // the ending card is up: Escape must not toggle the pause under it
  if (input.craftPressed) { panelOpen = !panelOpen; panel.style.display = panelOpen ? 'block' : 'none'; panelAcc = 9; }
  if (bagWantsOpen() && !titleOn) { jOpen = false; jEl.style.display = 'none'; if (!panelOpen) setPanelOpen(true); }      // a container was opened: show its panel
  if (input.journalPressed) { jOpen = !jOpen; if (jOpen) { panelOpen = false; panel.style.display = 'none'; if (input.mapPressed) setJournalTab('map'); renderJournal(); } jEl.style.display = jOpen ? 'block' : 'none'; }
  if (input.pausePressed && jOpen) { jOpen = false; jEl.style.display = 'none'; input.pausePressed = false; }
  if (input.pausePressed) { if (panelOpen) { panelOpen = false; panel.style.display = 'none'; } else G.paused = !G.paused; }
  acc += realDt; panelAcc += realDt; rectAcc += realDt;
  // toasts: a short stack in the top-centre flow (below the objective and the shelter chip)
  for (let i = G.toasts.length - 1; i >= 0; i--) { const t = G.toasts[i]; t.t -= realDt; if (t.t <= 0) G.toasts.splice(i, 1); }
  const shown = pickToasts(document.body.classList.contains('touch-ui') ? 2 : 3);
  const tk = shown.map(t => t.text + t.kind).join('|');
  if (tk !== toastKey) {
    toastKey = tk; toastBox.innerHTML = '';
    for (const t of shown) {
      const d = document.createElement('div'); d.className = 'p toast'; d.textContent = t.text;
      d.style.color = t.kind === 'bad' ? '#ff9a88' : t.kind === 'warn' ? '#ffc46e' : t.kind === 'good' ? '#8fe3b0' : '#dff0ff';
      toastBox.appendChild(d);
    }
  }
  // death card
  if (p && !p.alive) {
    // first moments of the death: just the cause; then overlay.ts shows the death card (stats, «Новая игра» / «Заново тот же мир» / back to the station)
    deadEl.style.display = body.deadT < 1.3 ? 'flex' : 'none';
    deadEl.innerHTML = `<div>${fmt(S.dead, { c: p.cause })}</div>`;
  } else deadEl.style.display = 'none';
  pauseEl.style.display = G.paused && !document.getElementById('rotate')?.style.display?.includes('flex') && !document.body.classList.contains('title-open') ? 'block' : 'none';
  if (pauseEl.style.display === 'block') pauseEl.textContent = S.pause;
  // tooltip
  const T = target();
  if (p?.alive && input.hasAim && T.lines.length && !panelOpen && (input.aimMode !== 'smart')) {
    const sx = input.aimX, sy = input.aimY;
    tip.innerHTML = T.lines.map((l, i) => `<div class="${i === T.lines.length - 1 && T.reason ? 'warn' : ''}">${l}</div>`).join('');
    tip.style.display = 'block'; placeTip(sx, sy);
  } else tip.style.display = 'none';
  document.body.classList.toggle('panel-open', panelOpen || jOpen);

  updateArrow(realDt);
  if (acc < 0.1) return;
  acc = 0;
  if (!p) return;
  // ---- body ----
  drawFigure(p);
  setRow('core', p.core.toFixed(1) + '°', cls(p.core < 34, p.core < 36));
  setBar(rows.water, p.water, 15, 35); setBar(rows.food, p.food, 15, 35); setBar(rows.energy, p.energy, 12, 30); setBar(rows.hp, p.hp, 30, 60);
  // the body figure + core thermometer carry the state; a vital shows up (bar + words) only inside its warning band (?devhud keeps every number)
  const vital = (k: string, v: number, bad: number, warn: number, w1: string, w2: string) => { const r = rows[k]; r.row.style.display = DEV || v < warn ? 'flex' : 'none'; if (!DEV) r.v.textContent = v < bad ? w2 : w1; };
  vital('water', p.water, 15, 35, S.wThirst, S.wThirst2); vital('food', p.food, 15, 35, S.wHunger, S.wHunger2); vital('energy', p.energy, 12, 30, S.wTired, S.wTired2); vital('hp', p.hp, 30, 60, S.wHurt, S.wHurt2);
  wetEl.style.display = p.wet > 0.12 ? 'flex' : 'none'; rows.wet.v.textContent = Math.round(p.wet * 100) + '%'; rows.wet.v.className = 'v ' + cls(p.wet > 0.6, p.wet > 0.25);
  if (p.co > 5) { alertEl.style.display = 'flex'; (alertEl.lastElementChild as HTMLElement).textContent = S.co + ' ' + Math.round(p.co); } else alertEl.style.display = 'none';
  subEl.textContent = fmt(S.air, { t: p.airT.toFixed(0) }) + ' · ' + fmt(S.feels, { t: p.feelT.toFixed(0) });
  // ---- sun clock ----
  drawDial();
  dayEl.textContent = seasonLabel().split(' · ').map(x => x.replace(/ /g, '\u00a0')).join(' · ');       // wrap only between the parts
  clkEl.textContent = fmtClock();
  const know = knowsForecast();
  const wdir = G.wind >= 0 ? 90 : -90, ws = Math.abs(G.wind);
  windRow.innerHTML = ws < 1 ? S.calm : img(uiUrl('wind_arrow'), 'wa').replace('class="ic wa"', `class="ic wa" style="transform:rotate(${wdir}deg)"`) + fmt(S.wind, { w: ws.toFixed(0) });
  const falling = G.storm > 0.05 || (know && G.forecast.stormAt > 0 && G.forecast.stormAt - G.time < 12 * 60);
  baroRow.innerHTML = know ? img(uiUrl(falling ? 'baro_down' : 'baro_up')) + `<span class="${falling ? 'warn' : ''}">${G.forecast.text}</span>` : `<span class="dim">${S.noForecast}</span>`;
  stormRow.innerHTML = G.storm > 0.2 ? img(uiUrl('storm')) + `<span class="bad">${S.storm}</span>` : (G.timeScale > 1 ? `<span class="warn">Zzz ×${G.timeScale}</span>` : '') + (freeCam ? `<span class="warn">${S.free}</span>` : '');
  stormRow.style.display = stormRow.innerHTML ? 'flex' : 'none';
  // ---- objective + shelter chip ----
  objEl.innerHTML = `<b>${S.objTitle}</b>${objective()}`;
  const sh = G.shelter;
  if (sh) {
    chip.style.display = 'block';
    const stars = '★'.repeat(sh.stars) + '☆'.repeat(4 - sh.stars);
    chip.innerHTML = sh.closed ? `${S.shelter} ${stars} · ${fmt(S.temp, { t: sh.temp.toFixed(0) })} · ${sh.vent ? S.vent : S.noVentTxt}${sh.co > 8 ? ' · <span class="bad">CO ' + Math.round(sh.co) + '</span>' : ''}` : `<span class="warn">${sh.notes[0] ?? S.noShelter}</span>`;
  } else chip.style.display = 'none';
  // ---- belt ----
  const cells = beltCells();
  let key = inv.sel + '|' + cells.length + '|';
  for (const i of cells) { const s = inv.slots[i]; key += s ? s.id + s.n + (s.dur !== undefined ? Math.round(s.dur / (s.id === 'thermos' || s.id === 'sack' ? 1 : 5)) : '') + ',' : ','; }
  if (key !== beltKey) {
    beltKey = key;
    let h = '';
    cells.forEach((i, ci) => {
      const s = inv.slots[i]; const d = s ? getItem(s.id) : null;
      h += `<div class="sl${i === inv.sel ? ' sel' : ''}${s && s.id === 'flask' && (s.dur ?? 0) >= 50 ? ' frz' : ''}" data-i="${i}"><span class="k">${ci + 1}</span>`;
      if (s && d) {
        h += img(itemUrl(s.id, s.dur));
        if (s.n > 1) h += `<i class="n">${s.n}</i>`;
        if (d.tool && isFinite(d.tool.dur) && s.dur !== undefined) h += `<div class="bar"><i style="width:${Math.max(0, Math.min(100, s.dur / d.tool.dur * 100))}%"></i></div>`;
        else if (s.id === 'thermos' || s.id === 'hand_warmer' || s.id === 'frost_balm') { const f = s.id === 'thermos' ? Math.floor((s.dur ?? 0) / 1000) / 3 : s.id === 'hand_warmer' ? (s.dur ?? 0) / 240 : (s.dur ?? 0) / 4; h += `<div class="bar"><i style="width:${Math.max(0, Math.min(100, f * 100))}%"></i></div>`; }
      }
      h += '</div>';
    });
    beltEl.innerHTML = h;
    const sel = inv.slots[inv.sel];
    if (sel) { bname.style.display = 'block'; bname.textContent = itemName(sel.id) + (sel.id === 'snow_block' && sel.dur ? ' · ' + fmt(S.dens, { d: Math.round(sel.dur) }) : ''); } else bname.style.display = 'none';
  }
  if (panelOpen && panelAcc > 0.35) { panelAcc = 0; renderPanel(); }
  if (devEl) devEl.textContent = `core ${p.core.toFixed(2)} hands ${p.frost.hands | 0} feet ${p.frost.feet | 0} face ${p.frost.face | 0}\nwater ${p.water | 0} food ${p.food | 0} energy ${p.energy | 0} wet ${(p.wet * 100) | 0}% hp ${p.hp | 0} co ${p.co | 0}\nsun ${G.sunElev.toFixed(1)}° wind ${G.wind.toFixed(1)} storm ${G.storm.toFixed(2)}`;
  void shortcut;
}
function setRow(k: string, text: string, c: string) { const r = rows[k]; r.v.textContent = text; r.v.className = 'v ' + c; }

// ---- bag + crafting panel ----------------------------------------------------------------------------------------------------
function renderPanel() {
  renderBag(panel);      // the bag + container + «Что умею» panel lives in ui/bag.ts
}
function renderJournal() { renderJournalInto(jEl); }      // tabs Цели · Знания · Записки · Карта · Вещества live in ui/journal.ts
export const panelIsOpen = () => panelOpen || jOpen;
void itemName;
