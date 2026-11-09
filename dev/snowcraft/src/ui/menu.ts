// Settings menu (owner: «не могу найти настройки и кнопку полноэкранного режима»). On a desktop window two small buttons sit at the top-right,
// left of the sun dial: ⚙ opens the settings panel, ⛶ toggles fullscreen (Shift+Enter does the same). On touch devices ui/touch.ts draws its own ⚙
// and dispatches window 'sc:menu', which opens the same panel. The panel follows the pause (P: devhud.ts toggles G.paused).
// The panel pauses the game; closing resumes it, unless the game was already paused before the panel opened (a rotation pause, a manual pause).
// P (devhud.ts toggles the pause) opens it too; Esc closes it (TERRARIA_CONTROLS: Esc is the inventory, P the pause).
// Rows: Продолжить · Полный экран · Масштаб (zoomui.ts) · Звук (on/off + volume) · Язык · Качество · Интерфейс (full / minimal, see hudmode.ts).
// Choices live in localStorage (try/catch everywhere): sc.vol {v,m}, sc.q 0|1|2, sc.lang, sc.ui. The URL ?q= still wins over sc.q.
import { G, toast } from '../game/state';
import { strings, fmt, LANGS, LANG_NAMES, setLang, getLang, type Lang } from '../content/i18n';
import { sfx } from '../engine/audio';
import { resize } from '../engine/render';
import { saveGame } from '../game/save';
import { mountZoomControl } from './zoomui';
import { getUiMode, setUiMode, type UiMode } from './hudmode';
import { onEscape } from '../engine/input';

const S = strings('menu', {
  btn: 'Настройки', fsBtn: 'Полный экран (Shift+Enter)', title: 'Настройки', cont: 'Продолжить', close: 'Закрыть',
  fs: 'Полный экран', on: 'Вкл', off: 'Выкл', na: 'недоступно',
  sound: 'Звук', volume: 'Громкость', lang: 'Язык', quality: 'Качество', q0: 'Низкое', q1: 'Среднее', q2: 'Высокое',
  ui: 'Интерфейс', uiFull: 'Полный', uiMin: 'Минимум',
  fsNo: 'Полный экран здесь недоступен. Открой игру отдельной вкладкой или нажми значок ⤢ вверху страницы',
  langNote: 'Язык: {name}. Страница перезагрузится, чтобы применить его',
  hint: 'P — настройки и пауза · Esc — закрыть · Shift+Enter — полный экран',
});

const KEY = { vol: 'sc.vol', q: 'sc.q', lang: 'sc.lang' } as const;
const DEF_VOL = { v: 80, m: false };
const MUSIC_RATIO = 0.45 / 0.8;             // audio.ts defaults: music 0.45 under master 0.8

const CSS = `
#sc-menubtn,#sc-fsbtn{position:fixed;top:calc(8px + env(safe-area-inset-top,0px));z-index:49;width:40px;height:40px;box-sizing:border-box;margin:0;padding:0;display:flex;align-items:center;justify-content:center;
  background:rgba(8,16,30,.55);border:1px solid rgba(124,198,238,.45);border-radius:6px;color:#dff0ff;opacity:.72;cursor:pointer;pointer-events:auto;touch-action:manipulation;-webkit-tap-highlight-color:transparent;box-shadow:0 0 0 1px #05080f}
#sc-menubtn{right:calc(202px + env(safe-area-inset-right,0px))}     /* left of the sun dial (#hud .dial: 142 px wide at the right edge) */
#sc-fsbtn{right:calc(158px + env(safe-area-inset-right,0px))}
#sc-menubtn svg,#sc-fsbtn svg{width:24px;height:24px;display:block;pointer-events:none}
#sc-menubtn:hover,#sc-fsbtn:hover,#sc-menubtn:focus-visible,#sc-fsbtn:focus-visible,#sc-fsbtn.on{opacity:1;border-color:#ffc46e;color:#fff;outline:none}
body.touch-ui #sc-menubtn,body.touch-ui #sc-fsbtn,body.title-open #sc-menubtn,body.title-open #sc-fsbtn{display:none !important}
body.sc-menu-open #hud .pause{display:none !important}
#sc-menu{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:50;display:none;box-sizing:border-box;width:min(640px,92vw);max-width:92vw;max-height:86vh;overflow:auto;overscroll-behavior:contain;
  padding:10px 12px 12px;background:rgba(8,16,30,.95);border:1px solid rgba(124,198,238,.5);border-radius:8px;box-shadow:0 0 0 1px #05080f,0 12px 40px rgba(0,0,0,.5);
  font-family:'Jura',system-ui,sans-serif;font-weight:600;color:#e8f4ff;text-shadow:0 1px 0 #05080f;pointer-events:auto;touch-action:pan-y;-webkit-user-select:none;user-select:none}
#sc-menu h4{margin:0 44px 8px 2px;font:700 17px 'Jura',system-ui,sans-serif;letter-spacing:.06em;color:#ffc46e}
#sc-menu .mx{position:absolute;top:4px;right:4px;width:44px;height:44px;padding:0;font:700 20px/1 'Jura',system-ui,sans-serif}
#sc-menu .mg{display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;align-items:center}
#sc-menu .w{grid-column:1/-1}
#sc-menu .mr{display:flex;align-items:center;gap:8px;min-width:0;min-height:44px}
#sc-menu .mr>b{font-weight:700;font-size:14px;white-space:nowrap;flex:none}
#sc-menu button,#sc-menu select{font:700 14px 'Jura',system-ui,sans-serif;color:#e8f6ff;background:linear-gradient(180deg,rgba(22,40,66,.92),rgba(10,20,36,.92));border:2px solid rgba(124,198,238,.55);
  border-radius:5px;min-height:44px;min-width:44px;padding:0 10px;cursor:pointer;box-sizing:border-box;text-shadow:0 1px 0 #05080f}
#sc-menu button:hover,#sc-menu button:focus-visible,#sc-menu select:focus-visible{border-color:#ffc46e;outline:none}
#sc-menu button:active{background:rgba(124,198,238,.35)}
#sc-menu button.pri{border-color:#ffc46e;background:linear-gradient(180deg,rgba(84,50,16,.94),rgba(46,27,10,.94))}
#sc-menu button.on{border-color:#8fe3b0;background:linear-gradient(180deg,rgba(24,64,44,.94),rgba(12,36,26,.94))}
#sc-menu select{flex:1;min-width:0;width:100%}
#sc-menu .seg{display:flex;gap:4px;flex:1;min-width:0}
#sc-menu .seg button{flex:1;min-width:0;padding:0 6px;font-size:13px}
#sc-menu input[type=range]{flex:1;min-width:80px;height:44px;margin:0;accent-color:#7cc6ee;touch-action:auto}
#sc-menu .zc{display:flex;align-items:center;gap:8px;min-width:0;width:100%}
#sc-menu .zc b{font-weight:700;font-size:14px;min-width:64px;flex:none}
#sc-menu .zc input[type=range]{flex:1;min-width:80px}
#sc-menu .zc .zb{width:44px;height:44px;min-width:44px;border-radius:50%;font-size:22px;padding:0;line-height:1}
#sc-menu .zc span{min-width:44px;text-align:right;font-size:13px;flex:none}
#sc-menu .note{display:none;font-size:13px;color:#ffc46e;line-height:1.3;padding:2px 2px 0;text-shadow:0 1px 0 #05080f}
#sc-menu .hint{font-size:12px;opacity:.75;padding:2px 2px 0}
body.touch-ui #sc-menu .hint{display:none}
@media (max-height:480px){
  #sc-menu{padding:6px 10px 8px}
  #sc-menu h4,#sc-menu .mx{display:none}
  #sc-menu .mg{gap:4px 10px}
}`;

const GEAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M18.56 10.21L21.09 10.56L21.09 13.44L18.56 13.79L17.91 15.37L19.44 17.41L17.41 19.44L15.37 17.91L13.79 18.56L13.44 21.09L10.56 21.09L10.21 18.56L8.63 17.91L6.59 19.44L4.56 17.41L6.09 15.37L5.44 13.79L2.91 13.44L2.91 10.56L5.44 10.21L6.09 8.63L4.56 6.59L6.59 4.56L8.63 6.09L10.21 5.44L10.56 2.91L13.44 2.91L13.79 5.44L15.37 6.09L17.41 4.56L19.44 6.59L17.91 8.63ZM15.2 12A3.2 3.2 0 1 0 8.8 12A3.2 3.2 0 1 0 15.2 12Z"/></svg>';
const FULL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';

let host: HTMLElement | null = null, panel: HTMLElement | null = null, gear: HTMLElement | null = null, fsBtn: HTMLElement | null = null;
let open = false, ownPause = false, wasPaused = false;

// ---------------------------------------------------------------------------------------------------------------------
// storage (every access may throw in a private window or with blocked site data)
function getItem(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function setItem(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* the choice then lasts this visit only */ } }

export function readVol(): { v: number; m: boolean } {
  try {
    const j = JSON.parse(getItem(KEY.vol) ?? 'null');
    if (j && typeof j.v === 'number' && Number.isFinite(j.v)) return { v: Math.max(0, Math.min(100, Math.round(j.v))), m: !!j.m };
  } catch { /* bad JSON: defaults */ }
  return { ...DEF_VOL };
}
function writeVol(x: { v: number; m: boolean }) { setItem(KEY.vol, JSON.stringify(x)); applyVol(x); }
export function applyVol(x: { v: number; m: boolean }) {
  try { sfx.setVolume(x.v / 100, (x.v / 100) * MUSIC_RATIO); sfx.setMuted(x.m); } catch { /* audio is optional */ }
}
function readQ(): 0 | 1 | 2 | null { const v = getItem(KEY.q); return v === '0' || v === '1' || v === '2' ? (Number(v) as 0 | 1 | 2) : null; }
export function readLangPref(): Lang | null { const v = getItem(KEY.lang); return (LANGS as readonly string[]).includes(v ?? '') ? (v as Lang) : null; }

// ---------------------------------------------------------------------------------------------------------------------
// actions
function setQuality(q: 0 | 1 | 2) { G.quality = q; setItem(KEY.q, String(q)); resize(); sync(); }

/** Interface mode: hudmode.ts stores it (sc.ui), applies the body classes and announces 'sc:uimode'. */
function setUi(m: UiMode) { setUiMode(m); sync(); }

/** The language picker (menu and title screen). Stores the choice and applies it. The HUD texts are built once at start-up, so in game the page reloads
 *  after a short notice (the autosave is written first); the title re-renders at once (`reload` false). */
export function chooseLanguage(l: Lang, reload = true) {
  if (!(LANGS as readonly string[]).includes(l)) return;
  const changed = getLang() !== l;
  setLang(l); setItem(KEY.lang, l);
  if (!reload || !changed) return;
  toast(fmt(S.langNote, { name: LANG_NAMES[l] }), 'info');
  setTimeout(() => {
    void (async () => {
      try { if (G.player?.alive && !titleOn()) await saveGame(); } catch { /* reload anyway */ }
      location.reload();
    })();
  }, 1400);
}

function fsActive(): boolean { const D = document as any; return !!(document.fullscreenElement ?? D.webkitFullscreenElement); }
function fsAvailable(): boolean {
  const D = document as any, de = document.documentElement as any;
  if (D.fullscreenEnabled === false || D.webkitFullscreenEnabled === false) return false;
  return !!(de.requestFullscreen || de.webkitRequestFullscreen);
}
function fsNote(on: boolean) {
  const n = panel?.querySelector('[data-k=fsnote]') as HTMLElement | null;
  if (n) { n.textContent = S.fsNo; n.style.display = on ? 'block' : 'none'; }
  if (on) toast(S.fsNo, 'warn');
}
/** Fullscreen on <html>. Denied or unsupported (iframes without allowfullscreen, iPhone Safari) shows a note; it never throws. */
export async function toggleFullscreen(): Promise<void> {
  if (fsActive()) {
    try { const D = document as any; await (D.exitFullscreen ? D.exitFullscreen() : D.webkitExitFullscreen?.()); } catch { /* already left */ }
    fsNote(false);
  } else {
    try {
      const de = document.documentElement as any;
      if (!fsAvailable()) throw new Error('fullscreen unavailable');
      await (de.requestFullscreen ? de.requestFullscreen() : de.webkitRequestFullscreen?.());
      fsNote(false);
    } catch { fsNote(true); }
  }
  sync();
}

// ---------------------------------------------------------------------------------------------------------------------
// the panel and the pause
const titleOn = () => document.body.classList.contains('title-open');
const rotateOn = () => (document.getElementById('rotate')?.style.display ?? '').includes('flex');

function showPanel(on: boolean) {
  if (!panel) return;
  panel.style.display = on ? 'block' : 'none';
  document.body.classList.toggle('sc-menu-open', on);       // hides the «ПАУЗА» caption under the panel (devhud.ts)
  open = on;
  if (on) sync();
}
export function openMenu() {
  if (!panel || open || titleOn()) return;
  ownPause = !G.paused;                  // the game was running: closing resumes it
  G.paused = true;
  showPanel(true);
}
export function closeMenu() {
  if (!panel || !open) return;
  showPanel(false);
  if (ownPause && !titleOn()) G.paused = false;
  ownPause = false;
}
export function menuOpen() { return open; }
function toggleMenu() { if (open) closeMenu(); else openMenu(); }

/** Per frame: a pause that starts while the menu is shut (Esc, devhud.ts) opens it; a resume (Esc again, rotation) shuts it. */
function watch() {
  const p = G.paused;
  if (open && !p) showPanel(false);
  else if (!open && p && !wasPaused && !titleOn() && !rotateOn()) { ownPause = true; showPanel(true); }
  wasPaused = p;
  requestAnimationFrame(watch);
}

// ---------------------------------------------------------------------------------------------------------------------
// building
function btn(label: string, cls = '', k = ''): HTMLButtonElement {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
  if (cls) b.className = cls;
  if (k) b.dataset.k = k;
  return b;
}
function cell(label: string, ...kids: HTMLElement[]): HTMLElement {
  const d = document.createElement('div'); d.className = 'mr';
  const b = document.createElement('b'); b.textContent = label; d.appendChild(b);
  for (const k of kids) d.appendChild(k);
  return d;
}
function seg(k: string, items: [string, string][]): HTMLElement {
  const w = document.createElement('div'); w.className = 'seg';
  for (const [v, label] of items) {
    const b = btn(label, '', k); b.dataset.v = v;
    b.addEventListener('click', () => { if (k === 'q') setQuality(Number(v) as 0 | 1 | 2); else setUi(v as UiMode); });
    w.appendChild(b);
  }
  return w;
}

function build() {
  if (!host) return;
  const css = document.createElement('style'); css.id = 'sc-menu-css'; css.textContent = CSS; document.head.appendChild(css);

  gear = btn('', '', ''); gear.id = 'sc-menubtn'; gear.innerHTML = GEAR;
  gear.setAttribute('aria-label', S.btn); gear.title = S.btn;
  gear.addEventListener('click', toggleMenu);
  fsBtn = btn('', '', ''); fsBtn.id = 'sc-fsbtn'; fsBtn.innerHTML = FULL;
  fsBtn.setAttribute('aria-label', S.fsBtn); fsBtn.title = S.fsBtn;
  fsBtn.addEventListener('click', () => { void toggleFullscreen(); });

  panel = document.createElement('div'); panel.id = 'sc-menu';
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', S.title); panel.style.display = 'none';
  const h = document.createElement('h4'); h.textContent = S.title;
  const x = btn('✕', 'mx', 'x'); x.setAttribute('aria-label', S.close); x.title = S.close; x.addEventListener('click', closeMenu);

  const g = document.createElement('div'); g.className = 'mg';
  const cont = btn(S.cont, 'pri', 'cont'); cont.addEventListener('click', closeMenu);
  const fs = btn('', '', 'fs'); fs.addEventListener('click', () => { void toggleFullscreen(); });
  g.append(cont, fs);

  const zw = document.createElement('div'); zw.className = 'w'; mountZoomControl(zw); g.appendChild(zw);

  const mute = btn('', '', 'sound');
  mute.addEventListener('click', () => { const c = readVol(); writeVol({ v: c.v, m: !c.m }); sync(); });
  const rng = document.createElement('input'); rng.type = 'range'; rng.min = '0'; rng.max = '100'; rng.step = '5'; rng.dataset.k = 'vol';
  rng.setAttribute('aria-label', S.volume);
  rng.addEventListener('input', () => { writeVol({ v: Number(rng.value), m: readVol().m }); });
  g.appendChild(cell(S.sound, mute, rng));

  const sel = document.createElement('select'); sel.dataset.k = 'lang'; sel.setAttribute('aria-label', S.lang);
  for (const l of LANGS) { const o = document.createElement('option'); o.value = l; o.textContent = LANG_NAMES[l]; sel.appendChild(o); }
  sel.addEventListener('change', () => chooseLanguage(sel.value as Lang, true));
  g.appendChild(cell(S.lang, sel));

  g.appendChild(cell(S.quality, seg('q', [['0', S.q0], ['1', S.q1], ['2', S.q2]])));
  g.appendChild(cell(S.ui, seg('ui', [['full', S.uiFull], ['min', S.uiMin]])));

  const note = document.createElement('div'); note.className = 'note w'; note.dataset.k = 'fsnote'; note.setAttribute('role', 'status'); g.appendChild(note);
  const hint = document.createElement('div'); hint.className = 'hint w'; hint.textContent = S.hint; g.appendChild(hint);

  panel.append(x, h, g);
  host.append(gear, fsBtn, panel);
}

/** Show the current values on the controls (cheap; called on open and after every change). */
function sync() {
  if (!panel) return;
  const on = fsActive(), av = fsAvailable();
  const fs = panel.querySelector('[data-k=fs]') as HTMLElement;
  fs.textContent = `${S.fs}: ${on ? S.on : av ? S.off : S.na}`; fs.setAttribute('aria-pressed', String(on));
  fsBtn?.classList.toggle('on', on); fsBtn?.setAttribute('aria-pressed', String(on));
  const vol = readVol();
  const mute = panel.querySelector('[data-k=sound]') as HTMLElement;
  mute.textContent = vol.m ? S.off : S.on; mute.setAttribute('aria-pressed', String(!vol.m));
  (panel.querySelector('[data-k=vol]') as HTMLInputElement).value = String(vol.v);
  (panel.querySelector('[data-k=lang]') as HTMLSelectElement).value = getLang();
  const ui = getUiMode();
  for (const b of Array.from(panel.querySelectorAll<HTMLElement>('[data-k=q]'))) b.classList.toggle('on', Number(b.dataset.v) === G.quality);
  for (const b of Array.from(panel.querySelectorAll<HTMLElement>('[data-k=ui]'))) b.classList.toggle('on', b.dataset.v === ui);
}

/** Start-up: the stored language, sound and quality win over the defaults (?q= still wins over sc.q). */
function applyStored() {
  try {
    const L = readLangPref(); if (L) setLang(L);
    if (getItem(KEY.vol) !== null) applyVol(readVol());
    const q = readQ();
    if (q !== null && !new URLSearchParams(location.search).has('q')) { G.quality = q; resize(); }
  } catch { /* defaults stay */ }
}

export function initMenu(hostEl: HTMLElement) {
  if (host) return;
  host = hostEl;
  applyStored();
  build();
  window.addEventListener('sc:menu', () => { if (!titleOn()) toggleMenu(); });        // the touch layer's ⚙
  onEscape(() => { if (!open) return false; closeMenu(); return true; });              // Esc closes the panel (P / ⚙ open it; Esc no longer opens it)
  document.addEventListener('fullscreenchange', () => { fsNote(false); sync(); });
  document.addEventListener('webkitfullscreenchange', () => { fsNote(false); sync(); });
  addEventListener('keydown', (e) => {
    if (e.code !== 'Enter' || !e.shiftKey || e.repeat) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest?.('input,textarea,select,button,[contenteditable]')) return;
    e.preventDefault(); void toggleFullscreen();
  });
  wasPaused = G.paused;
  requestAnimationFrame(watch);
  sync();
}
