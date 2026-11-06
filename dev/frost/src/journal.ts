// Journal overlay («Журнал»): diary pages, discovered places, events seen, carvings read and the radio checklist.
// Self-contained: its own DOM root and its own injected <style> (ui.css is not touched). Plain data in, nothing read back except the
// open/closed state. Keys: J toggles (PC), Esc closes it before the pause menu sees the key. main decides when it may open
// (canOpen) and pauses the game while it is open (journalOpen).
import { DIARY, DIARY_PAGE_COUNT, RADIO_PARTS, CARVINGS, LOCATION_NAMES, DISCOVERABLE, journalProgress, type Journal } from './lore';
import type { EventLogEntry } from './events';

export interface JournalData { journal: Journal; events: readonly EventLogEntry[]; rescue: string; }
export interface JournalHooks { canOpen(): boolean; onChange(open: boolean): void; }

type Tab = 'pages' | 'places' | 'radio' | 'events' | 'marks';
const TABS: readonly [Tab, string][] = [['pages', 'Дневник'], ['places', 'Места'], ['radio', 'Рация'], ['events', 'События'], ['marks', 'Надписи']];

let hooks: JournalHooks | null = null;
let root: HTMLElement | null = null;
let body: HTMLElement | null = null;
let tabsEl: HTMLElement | null = null;
let progEl: HTMLElement | null = null;
let isOpen = false;
let tab: Tab = 'pages';
let data: JournalData | null = null;

const STYLE = `
.jr-root{position:fixed;inset:0;z-index:60;display:none;align-items:center;justify-content:center;padding:max(12px,env(safe-area-inset-top)) 12px max(12px,env(safe-area-inset-bottom));
  font-family:var(--font-ui,'Jura',system-ui,sans-serif);color:var(--frost,#eaf3fb)}
.jr-root.jr-on{display:flex}
.jr-veil{position:absolute;inset:0;background:rgba(3,6,11,.72);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}
.jr-card{position:relative;width:min(560px,100%);max-height:min(86vh,720px);display:flex;flex-direction:column;
  background:linear-gradient(180deg,rgba(26,43,66,.96),rgba(7,13,23,.97));border:1px solid rgba(190,228,255,.42);border-radius:6px;
  box-shadow:0 18px 60px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.07);overflow:hidden}
.jr-head{display:flex;align-items:flex-end;gap:10px;padding:14px 16px 8px;border-bottom:1px solid rgba(143,211,255,.22)}
.jr-kicker{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--ice,#8fd3ff);opacity:.85}
.jr-title{font-family:var(--font-display,'Unbounded',sans-serif);font-size:17px;margin:0;flex:1;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.jr-prog{font-family:var(--font-mono,monospace);font-size:12px;color:var(--ice,#8fd3ff);white-space:nowrap}
.jr-close{all:unset;cursor:pointer;width:34px;height:34px;display:grid;place-items:center;border:1px solid rgba(143,211,255,.35);border-radius:50%;
  font-size:20px;line-height:1;color:var(--frost,#eaf3fb);flex:none}
.jr-close:focus-visible,.jr-tab:focus-visible{outline:2px solid var(--ember,#ffab45);outline-offset:2px}
.jr-tabs{display:flex;gap:4px;padding:8px 10px 0;overflow-x:auto;scrollbar-width:none}
.jr-tab{all:unset;cursor:pointer;padding:7px 10px 8px;font-size:13px;letter-spacing:.04em;color:rgba(234,243,251,.62);border-bottom:2px solid transparent;white-space:nowrap}
.jr-tab[aria-selected=true]{color:var(--frost,#eaf3fb);border-bottom-color:var(--ice,#8fd3ff)}
.jr-body{padding:12px 16px 16px;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;min-height:200px}
.jr-item{padding:10px 0;border-bottom:1px dashed rgba(143,211,255,.18)}
.jr-item:last-child{border-bottom:0}
.jr-name{font-size:15px;margin:0 0 3px;letter-spacing:.02em}
.jr-meta{font-family:var(--font-mono,monospace);font-size:11.5px;color:rgba(190,228,255,.7);margin:0 0 4px}
.jr-text{font-size:14.5px;line-height:1.5;margin:0;color:rgba(234,243,251,.92)}
.jr-miss{color:rgba(234,243,251,.42);font-style:italic}
.jr-ok{color:var(--ice,#8fd3ff)}
.jr-box{display:inline-block;width:12px;height:12px;border:1px solid rgba(143,211,255,.6);margin-right:8px;vertical-align:-1px;border-radius:2px}
.jr-box.on{background:var(--ice,#8fd3ff);box-shadow:0 0 8px rgba(143,211,255,.6)}
.jr-note{font-size:13px;color:rgba(234,243,251,.7);margin:0 0 10px;line-height:1.45}
.jr-empty{font-size:14px;color:rgba(234,243,251,.55);padding:14px 0}
.jr-foot{font-size:11.5px;color:rgba(234,243,251,.45);padding:8px 16px 10px;border-top:1px solid rgba(143,211,255,.14);letter-spacing:.03em}
@media (max-width:520px){.jr-title{font-size:15px}.jr-text{font-size:14px}.jr-body{min-height:0}}
`;

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);
/** Game minutes -> «день N, ЧЧ:ММ» (same clock as the HUD). */
function when(t: number): string {
  const day = Math.floor(t / 1440) + 1, m = Math.floor(t % 1440);
  return `день ${day}, ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function ensureDom(): void {
  if (root) return;
  const st = document.createElement('style');
  st.textContent = STYLE;
  document.head.appendChild(st);
  root = document.createElement('div');
  root.className = 'jr-root';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Журнал');
  root.innerHTML = `
    <div class="jr-veil" data-close></div>
    <section class="jr-card">
      <header class="jr-head">
        <div style="flex:1;min-width:0"><div class="jr-kicker">Полевой журнал</div><h2 class="jr-title">Записи экспедиции</h2></div>
        <span class="jr-prog"></span>
        <button type="button" class="jr-close" data-close aria-label="Закрыть">×</button>
      </header>
      <nav class="jr-tabs" role="tablist"></nav>
      <div class="jr-body" role="tabpanel"></div>
      <footer class="jr-foot">J или Esc: закрыть</footer>
    </section>`;
  document.body.appendChild(root);
  body = root.querySelector('.jr-body') as HTMLElement;
  tabsEl = root.querySelector('.jr-tabs') as HTMLElement;
  progEl = root.querySelector('.jr-prog') as HTMLElement;
  for (const [id, label] of TABS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'jr-tab';
    b.dataset.tab = id;
    b.setAttribute('role', 'tab');
    b.textContent = label;
    b.addEventListener('click', () => { tab = id; render(); });
    tabsEl.appendChild(b);
  }
  root.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('[data-close]')) close(); });
  // capture phase on window: Esc and J are consumed here, before input.ts (Esc would open the pause menu)
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyJ' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (isOpen) { close(); e.stopImmediatePropagation(); }
      else if (hooks?.canOpen()) { open(); e.stopImmediatePropagation(); }
      return;
    }
    if (isOpen && e.code === 'Escape') { close(); e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);
}

function pagesHtml(d: JournalData): string {
  const j = d.journal;
  const parts: string[] = [];
  for (const p of DIARY) {
    const found = j.pages.includes(p.id);
    if (found) {
      parts.push(`<div class="jr-item"><p class="jr-name">${esc(p.title)}</p><p class="jr-meta">${esc(p.date)} · страница ${p.id} из ${DIARY_PAGE_COUNT}</p><p class="jr-text">${esc(p.text)}</p></div>`);
    } else {
      const where = j.places.includes(p.place) ? `Где-то в месте: ${esc(LOCATION_NAMES[p.place])}.` : 'Место пока не найдено.';
      parts.push(`<div class="jr-item"><p class="jr-name jr-miss">Страница ${p.id} — не найдена</p><p class="jr-meta">${where}</p></div>`);
    }
  }
  return parts.join('');
}

function placesHtml(d: JournalData): string {
  return DISCOVERABLE.map((id) => {
    const on = d.journal.places.includes(id);
    return on
      ? `<div class="jr-item"><p class="jr-name">${esc(LOCATION_NAMES[id])}</p><p class="jr-meta jr-ok">открыто</p></div>`
      : `<div class="jr-item"><p class="jr-name jr-miss">???</p><p class="jr-meta">подойди ближе, чтобы найти</p></div>`;
  }).join('');
}

function radioHtml(d: JournalData): string {
  const have = d.journal.radio.length;
  const rows = RADIO_PARTS.map((p) => {
    const on = d.journal.radio.includes(p.id);
    return `<div class="jr-item"><p class="jr-name">${on ? '<span class="jr-box on"></span>' : '<span class="jr-box"></span>'}${esc(p.name)}</p>` +
      `<p class="jr-meta">${on ? esc(p.place) : 'не найдена'}</p></div>`;
  }).join('');
  return `<p class="jr-note">Рация «Гнездо»: найдено деталей ${have} из ${RADIO_PARTS.length}. Когда соберёшь все три, почини её на метеопосту. Вызов: ${esc(d.rescue)}.</p>${rows}`;
}

function eventsHtml(d: JournalData): string {
  if (!d.events.length) return '<p class="jr-empty">Пока ничего не случилось. Ты в снегу, а снег молчит.</p>';
  return d.events.slice().reverse().map((e) => `<div class="jr-item"><p class="jr-meta">${esc(when(e.t))}</p><p class="jr-text">${esc(e.text)}</p></div>`).join('');
}

function marksHtml(d: JournalData): string {
  const read = CARVINGS.filter((c) => d.journal.carvings.includes(c.id));
  const head = `<p class="jr-note">Надписи на деревьях и ящиках. Читаются вблизи, клавишей E.</p>`;
  if (!read.length) return head + '<p class="jr-empty">Ни одной надписи пока не прочитано.</p>';
  return head + read.map((c) => `<div class="jr-item"><p class="jr-text">«${esc(c.text)}»</p><p class="jr-meta">${esc(LOCATION_NAMES[c.where])}</p></div>`).join('');
}

function render(): void {
  if (!root || !body || !tabsEl || !progEl) return;
  const d = data;
  for (const b of Array.from(tabsEl.children) as HTMLElement[]) {
    const on = b.dataset.tab === tab;
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.tabIndex = on ? 0 : -1;
  }
  if (!d) { body.innerHTML = '<p class="jr-empty">Журнал пуст.</p>'; return; }
  const pr = journalProgress(d.journal);
  progEl.textContent = `${pr.pages}/${pr.pagesTotal} · ${pr.places}/${pr.placesTotal} · ${pr.radio}/${pr.radioTotal}`;
  switch (tab) {
    case 'pages': body.innerHTML = pagesHtml(d); break;
    case 'places': body.innerHTML = placesHtml(d); break;
    case 'radio': body.innerHTML = radioHtml(d); break;
    case 'events': body.innerHTML = eventsHtml(d); break;
    case 'marks': body.innerHTML = marksHtml(d); break;
  }
  body.scrollTop = 0;
}

function setOpen(v: boolean): void {
  if (isOpen === v) return;
  isOpen = v;
  if (root) root.classList.toggle('jr-on', v);
  if (v) render();
  hooks?.onChange(v);
}
function open(): void { ensureDom(); setOpen(true); (tabsEl?.querySelector('[aria-selected=true]') as HTMLElement | null)?.focus({ preventScroll: true }); }
function close(): void { setOpen(false); }

/** Install the overlay (idempotent). canOpen says when J may open it (game running, not paused, not ended). */
export function mountJournal(h: JournalHooks): void {
  hooks = h;
  ensureDom();
}
/** The latest journal, event log and rescue status; re-rendered at once when the overlay is open. */
export function setJournalData(d: JournalData): void {
  data = d;
  if (isOpen) render();
}
/** Open from a button (touch). Returns false when the game does not allow it right now. */
export function openJournal(): boolean {
  if (isOpen) { close(); return true; }
  if (!hooks?.canOpen()) return false;
  open();
  return true;
}
/** True while the overlay is shown: the game holds still and takes no input. */
export const journalOpen = (): boolean => isOpen;
/** Closes the overlay if it is open (the game ended, the pause menu came up, a new game started). */
export function closeJournal(): void { if (isOpen) close(); }
