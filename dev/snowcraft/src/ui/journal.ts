// Journal (J / M / Журнал). Five tabs:
//   Цели     — the current objective, the goal checklist (the knowledge flow), storm reports and the log of what was learned;
//   Знания   — techniques known (how they were learned) and «?» slots hinting where to learn more;
//   Записки  — the doctor's diary and the keeper's log, readable again at any time;
//   Карта    — the explored map (grid.seen), found sites and the player;
//   Вещества — materials and snow/ice facts learned by looking at them.
// devhud.ts owns the panel element and the open/close keys; it calls renderJournalInto(el) and forwards clicks to journalClick(e).
import { G } from '../game/state';
import { strings, fmt } from '../content/i18n';
import { objective, GOALS, journal, goalDetail, waitDetail } from '../game/quest';
import { seasonLabel } from '../game/seasons';
import { TECHS, NOTES, lore, knows, techName, techDesc, techHint, howLearned, noteTitle, noteText, noteWho, FACTS, factHead, factText, factNone } from '../game/lore';
import { sites } from '../game/locations';
import { seen, TW, TH, TS, W, mat, bg } from '../engine/grid';
import { MATS } from '../content/materials';
import { icon } from '../engine/sprites';
import { uiIcon } from '../art/icons';
import { getItem } from '../game/items';

const S = strings('jr', {
  title: 'Журнал', tGoals: 'Цели', tKnow: 'Знания', tNotes: 'Записки', tMap: 'Карта', tStuff: 'Вещества', close: 'закрыть',
  now: 'Сейчас', list: 'Путь', storms: 'Пурга: отчёты', noStorms: 'Ни одной бури ещё не было.', learnedLog: 'Что узнано', none: 'пока пусто',
  known: 'Знаю', learnMore: 'Чему ещё учиться', how: 'как узнал: {h}', qExp: 'Приходит только с опытом.', recipes: 'Приёмы', tips: 'Опыт и советы',
  notesCount: 'Найдено записок: {n} из {m}', pickNote: 'Выбери записку слева.', noNotes: 'Записок пока нет. Загляни к туру на мысу, в дом и в шахту.',
  mapSeen: 'Исследовано {p}%', sitesFound: 'Найденные места', you: 'ты',
});
type Tab = 'goals' | 'know' | 'notes' | 'map' | 'stuff';
const TABS: [Tab, () => string][] = [['goals', () => S.tGoals], ['know', () => S.tKnow], ['notes', () => S.tNotes], ['map', () => S.tMap], ['stuff', () => S.tStuff]];
let tab: Tab = 'goals', noteSel = '';
let host: HTMLElement | null = null;

const urlCache = new Map<string, string>();
const uiUrl = (key: string) => { const k = 'ui.' + key; let u = urlCache.get(k); if (!u) { u = uiIcon(key).toDataURL(); urlCache.set(k, u); } return u; };
const itemUrl = (id: string) => { let u = urlCache.get(id); if (!u) { u = icon(getItem(id).icon).toDataURL(); urlCache.set(id, u); } return u; };
const img = (src: string) => `<img class="ic" src="${src}" alt="" draggable="false">`;

const CSS = `
#hud .jr .tabs{display:flex;gap:4px;flex-wrap:wrap;margin:2px 0 8px}
#hud .jr .tab{font:600 13px 'Pixelify Sans','Jura',sans-serif;color:#dff0ff;background:#13243a;border:1px solid #2c4a6a;border-radius:4px;padding:4px 12px;cursor:pointer;min-height:44px}
#hud .jr .tab.on{border-color:#ffc46e;color:#ffc46e;background:#2a2112}
#hud .jr .row{display:flex;align-items:flex-start;gap:6px;margin:3px 0}
#hud .jr .row .ic{margin-top:1px}
#hud .jr .now{border:1px solid rgba(255,196,110,.5);border-radius:4px;padding:5px 8px;margin-bottom:6px;color:#fff3dc}
#hud .jr .card{border:1px solid rgba(124,198,238,.28);border-radius:4px;padding:5px 8px;margin:4px 0;background:rgba(14,26,46,.55)}
#hud .jr .card b{color:#ffc46e;font-weight:600}
#hud .jr .card .how{font-size:11px;opacity:.7;margin-top:2px}
#hud .jr .q{display:flex;gap:8px;align-items:flex-start;border:1px dashed rgba(124,198,238,.35);border-radius:4px;padding:4px 7px;margin:3px 0;font-size:12px;opacity:.85}
#hud .jr .q b{font:600 18px 'Pixelify Sans','Jura',sans-serif;color:#7cc6ee;width:16px;text-align:center;flex:none}
#hud .jr .nl{display:flex;flex-direction:column;gap:3px}
#hud .jr .nb{text-align:left;font:inherit;color:#dff0ff;background:#13243a;border:1px solid #2c4a6a;border-radius:4px;padding:4px 8px;cursor:pointer;min-height:30px}
#hud .jr .nb.on{border-color:#ffc46e}
#hud .jr .nb small{display:block;opacity:.65;font-size:10px}
#hud .jr .paper{white-space:pre-wrap;line-height:1.45;background:rgba(230,214,176,.1);border:1px solid rgba(230,214,176,.3);border-radius:4px;padding:8px 10px;font-size:14px}
#hud .jr .paper h4{margin:0 0 4px;font:600 14px 'Pixelify Sans','Jura',sans-serif;color:#ffc46e}
#hud .jr canvas.map{width:100%;image-rendering:pixelated;border:1px solid rgba(124,198,238,.38);border-radius:4px;background:#05080f;display:block}
#hud .jr .sub{font-size:11px;opacity:.7}
#hud .jr .row .how{font-size:11px;opacity:.7;line-height:1.35;margin-top:1px}
`;
let styled = false;
function ensureStyle() { if (styled || typeof document === 'undefined') return; styled = true; const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); }

// ---------------------------------------------------------------------------------------------------------------------
function goalsTab(): string {
  let h = `<div class="now">${S.now}: ${objective()}${waitDetail() ? `<div class="how">${waitDetail()}</div>` : ''}</div><div class="cols"><div class="col"><div class="grp">${S.list}</div>`;
  let seenCurrent = false;
  for (const g of GOALS) {
    const d = g.done();
    // the HUD line is one short sentence; the detail (where, how) is written here
    if (d) h += `<div class="row">${img(uiUrl('check'))}<span class="good">${g.text()}</span></div>`;
    else { h += `<div class="row">${img(uiUrl(seenCurrent ? 'cross' : 'warn'))}<div><span class="${seenCurrent ? 'dim' : ''}">${g.text()}</span><div class="how">${goalDetail(g.id)}</div></div></div>`; seenCurrent = true; }
  }
  const storms = journal.filter(e => e.kind === 'storm');
  h += `<div class="grp">${S.storms}</div>`;
  h += storms.length ? storms.slice(-6).reverse().map(e => `<div class="row"><span>${e.text}</span></div>`).join('') : `<div class="dim">${S.noStorms}</div>`;
  h += `</div><div class="col"><div class="grp">${S.learnedLog}</div>`;
  const log = journal.filter(e => e.kind !== 'storm');
  h += log.length ? log.slice(-14).reverse().map(e => `<div>${e.text}</div>`).join('') : `<div class="dim">${S.none}</div>`;
  return h + '</div></div>';
}

function knowTab(): string {
  const have = TECHS.filter(t => knows(t.id)), lack = TECHS.filter(t => !knows(t.id));
  const card = (id: string) => `<div class="card"><b>${techName(id)}</b><div>${techDesc(id)}</div><div class="how">${fmt(S.how, { h: howLearned(id) })}</div></div>`;
  let h = `<div class="cols"><div class="col"><div class="grp">${S.known} · ${have.length}/${TECHS.length}</div>`;
  h += have.filter(t => t.kind !== 'tip').map(t => card(t.id)).join('');
  h += `</div><div class="col"><div class="grp">${S.tips}</div>`;
  h += have.filter(t => t.kind === 'tip').map(t => card(t.id)).join('') || `<div class="dim">${S.none}</div>`;
  if (lack.length) {
    h += `<div class="grp">${S.learnMore}</div>`;
    for (const t of lack) h += `<div class="q"><b>?</b><span>${techHint(t.id) || S.qExp}</span></div>`;
  }
  return h + '</div></div>';
}

function notesTab(): string {
  const got = NOTES.filter(n => lore.read.has(n.id)).sort((a, b) => (lore.read.get(a.id) ?? 0) - (lore.read.get(b.id) ?? 0));
  if (!got.length) return `<div class="dim">${S.noNotes}</div>`;
  if (!noteSel || !lore.read.has(noteSel)) noteSel = got[got.length - 1].id;
  let h = `<div class="cols"><div class="col" style="flex:0 1 240px"><div class="grp">${fmt(S.notesCount, { n: got.length, m: NOTES.length })}</div><div class="nl">`;
  for (const n of got) h += `<button class="nb${n.id === noteSel ? ' on' : ''}" data-j="note" data-id="${n.id}">${img(itemUrl('note'))} ${noteTitle(n.id)}<small>${noteWho(n.id)}</small></button>`;
  h += `</div></div><div class="col"><div class="paper"><h4>${noteTitle(noteSel)}</h4><div class="sub">${noteWho(noteSel)}</div>\n${noteText(noteSel)}</div></div></div>`;
  return h;
}

function stuffTab(): string {
  const got = FACTS.filter(f => lore.probes.has(f.id));
  if (!got.length) return `<div class="dim">${factNone()}</div>`;
  return got.map(f => `<div class="card"><b>${factHead(f)}</b><div>${factText(f)}</div></div>`).join('');
}

// ---- map ----
const MW = TW, MH = TH;
let mapCv: HTMLCanvasElement | null = null, mapImg: ImageData | null = null;
function tileColor(tx: number, ty: number): [number, number, number] {
  const x = tx * TS + 2, y = ty * TS + 2;
  const m = mat[y * W + x];
  if (m === 0) {
    const b = bg[ty * TW + tx];
    return b === 0 ? [14, 26, 46] : [44, 56, 82];
  }
  const c = MATS[m]?.color ?? [120, 120, 120];
  const k = 0.78 + 0.22 * Math.min(1, Math.max(0, (260 - y) / 200 + 0.4));
  return [c[0] * k, c[1] * k, c[2] * k];
}
export function drawMap(canvas: HTMLCanvasElement | null = mapCv) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  const w = canvas.width, h = canvas.height, sx = w / MW, sy = h / MH;
  if (!mapImg) mapImg = new ImageData(MW, MH);
  const d = mapImg.data;
  for (let ty = 0; ty < MH; ty++) for (let tx = 0; tx < MW; tx++) {
    const o = (ty * MW + tx) * 4;
    if (seen[ty * TW + tx]) { const [r, g, b] = tileColor(tx, ty); d[o] = r; d[o + 1] = g; d[o + 2] = b; } else { d[o] = 5; d[o + 1] = 8; d[o + 2] = 15; }
    d[o + 3] = 255;
  }
  const off = document.createElement('canvas'); off.width = MW; off.height = MH;
  off.getContext('2d')!.putImageData(mapImg, 0, 0);
  ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, w, h); ctx.drawImage(off, 0, 0, w, h);
  ctx.font = `${Math.round(9 * sx / 2 + 8)}px Jura, system-ui, sans-serif`; ctx.textBaseline = 'middle';
  for (const s of sites) {
    if (!s.found) continue;
    const mx = (s.x / TS) * sx, my = (s.y / TS) * sy;
    ctx.fillStyle = '#ffc46e'; ctx.fillRect(Math.round(mx) - 2, Math.round(my) - 2, 5, 5);
    ctx.fillStyle = 'rgba(5,8,15,.8)'; const tw = ctx.measureText(s.name).width; ctx.fillRect(Math.round(mx) + 5, Math.round(my) - 7, tw + 4, 14);
    ctx.fillStyle = '#ffe6b0'; ctx.fillText(s.name, Math.round(mx) + 7, Math.round(my));
  }
  const p = G.player;
  if (p) {
    const px = (p.x / TS) * sx, py = ((p.y - 10) / TS) * sy, blink = Math.floor(performance.now() / 350) % 2;
    ctx.fillStyle = blink ? '#ffffff' : '#7cc6ee'; ctx.fillRect(Math.round(px) - 4, Math.round(py) - 1, 9, 3); ctx.fillRect(Math.round(px) - 1, Math.round(py) - 4, 3, 9);
  }
}
function mapTab(): string {
  let n = 0; for (let i = 0; i < seen.length; i++) n += seen[i];
  const found = sites.filter(s => s.found);
  return `<div class="sub">${fmt(S.mapSeen, { p: Math.round(n / seen.length * 100) })} · ${S.you}: ✚</div><canvas class="map" width="1024" height="384"></canvas><div class="grp">${S.sitesFound}</div>` +
    (found.length ? found.map(s => `<span class="card" style="display:inline-block;margin:2px 4px 2px 0;padding:2px 8px">${s.name}</span>`).join('') : `<div class="dim">${S.none}</div>`);
}

// ---------------------------------------------------------------------------------------------------------------------
/** Build the journal into the panel element (called when it opens and after every click). */
export function renderJournalInto(el: HTMLElement) {
  ensureStyle();
  host = el;
  if (!el.classList.contains('jr')) el.classList.add('jr');
  const sy = el.scrollTop;
  let h = `<h3><span>${S.title}</span><span class="dim">${seasonLabel()}</span></h3><div class="tabs">`;
  for (const [t, name] of TABS) h += `<button class="tab${t === tab ? ' on' : ''}" data-j="tab" data-t="${t}">${name()}</button>`;
  h += `</div>`;
  h += tab === 'goals' ? goalsTab() : tab === 'know' ? knowTab() : tab === 'notes' ? notesTab() : tab === 'map' ? mapTab() : stuffTab();
  h += `<div style="text-align:right;margin-top:8px"><button class="cl" data-j="close">${S.close}</button></div>`;
  el.innerHTML = h;
  el.scrollTop = sy;
  mapCv = el.querySelector('canvas.map');
  if (mapCv) drawMap(mapCv);
}
/** Click inside the journal. Returns true when the journal should close. */
export function journalClick(e: Event): boolean {
  const t = (e.target as HTMLElement).closest('[data-j]') as HTMLElement | null; if (!t) return false;
  const a = t.dataset.j;
  if (a === 'close') return true;
  if (a === 'tab') { tab = t.dataset.t as Tab; if (host) renderJournalInto(host); }
  else if (a === 'note') { noteSel = t.dataset.id ?? ''; if (host) renderJournalInto(host); }
  return false;
}
export function setJournalTab(t: Tab) { tab = t; }
export const journalTab = () => tab;
// the map follows the player while it is open
if (typeof window !== 'undefined') setInterval(() => { if (tab === 'map' && mapCv && host && host.style.display === 'block') drawMap(mapCv); }, 700);
