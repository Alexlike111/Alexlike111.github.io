// Title screen + autosave flow (DESIGN §10). Over the live polar-night world (paused, aurora, a lit fat lamp): SNOWCRAFT in the pixel font,
// Продолжить (when a save exists), Новая игра with difficulty + hardcore, Самотест. Autosaves every 30 s of play, when the tab is hidden and after
// sleeping; hardcore death deletes the slot. Skipped with ?title=0, in automated browsers (navigator.webdriver) and with #selftest; ?title=1 forces it.
import '@fontsource/pixelify-sans/latin-400.css';
import '@fontsource/pixelify-sans/cyrillic-400.css';
import '@fontsource/pixelify-sans/latin-600.css';
import '@fontsource/pixelify-sans/cyrillic-600.css';
import '@fontsource/jura/latin-600.css';
import '@fontsource/jura/cyrillic-600.css';
import { G } from '../game/state';
import { strings, fmt } from '../content/i18n';
import { on } from '../game/bus';
import { peekSave, loadGame, saveGame, deleteSave, type SaveMeta, type SaveData } from '../game/save';
import { wx, setDay } from '../game/weather';
import { placeFixture } from '../game/fixtures';

const S = strings('title', {
  name: 'SNOWCRAFT', sub: 'Полярная ночь', cont: 'Продолжить', newGame: 'Новая игра', start: 'Начать', back: 'Назад', selftest: 'Самотест',
  contInfo: 'День {d} из {n} · {t}', diff: 'Сложность', hard: 'Хардкор: одна жизнь, без возврата',
  d0: 'Мягкая', d1: 'Обычная', d2: 'Суровая', d0t: 'теплее, меньше голода', d1t: 'как задумано', d2t: 'холод кусает, запасы редки',
  hint: '12 дней полярной ночи. Станция «Мыс Безмолвия». Рация молчит.', loading: 'Загрузка…', saved: 'Сохранено',
});
export interface StartOpts { seed?: number; diff?: 0 | 1 | 2; hardcore?: boolean; save?: SaveData }

const CSS = `
#title{position:fixed;inset:0;z-index:60;display:none;flex-direction:column;align-items:center;justify-content:center;gap:10px;font-family:'Pixelify Sans','Jura',system-ui,sans-serif;color:#dff0ff;text-align:center;
 background:radial-gradient(ellipse at 50% 45%,rgba(5,9,18,.15),rgba(5,9,18,.72) 78%);padding:env(safe-area-inset-top,0) env(safe-area-inset-right,0) env(safe-area-inset-bottom,0) env(safe-area-inset-left,0);-webkit-user-select:none;user-select:none;touch-action:manipulation}
body.title-open #title{display:flex}
body.title-open #hud,body.title-open #touch{display:none !important}
#title h1{margin:0;font-weight:600;font-size:clamp(34px,9vw,86px);letter-spacing:.14em;line-height:1;color:#e8f6ff;text-shadow:0 2px 0 #2c4a6a,0 4px 0 #14243a,0 0 28px rgba(124,198,238,.55)}
#title .sub{font-size:clamp(14px,2.6vw,22px);letter-spacing:.5em;color:#ffc46e;margin:2px 0 14px;text-shadow:0 1px 0 #3a2410}
#title .col{display:flex;flex-direction:column;gap:8px;width:min(320px,80vw)}
#title button{font:inherit;font-size:18px;color:#e8f6ff;background:linear-gradient(180deg,rgba(22,40,66,.9),rgba(10,20,36,.9));border:2px solid rgba(124,198,238,.55);border-radius:4px;padding:9px 14px;cursor:pointer;min-height:44px;box-shadow:0 0 0 1px #05080f}
#title button:hover,#title button:focus-visible{border-color:#ffc46e;color:#fff;outline:none}
#title button.pri{border-color:#ffc46e;background:linear-gradient(180deg,rgba(80,48,16,.9),rgba(44,26,10,.9))}
#title button small{display:block;font-size:12px;opacity:.75;margin-top:2px}
#title button.on{border-color:#8fe3b0;background:linear-gradient(180deg,rgba(24,64,44,.9),rgba(12,36,26,.9))}
#title .hint,#title small,#title label,#title .lnk,#title .dim{font-family:'Jura',system-ui,sans-serif;font-weight:600}
#title .hint{font-size:14px;opacity:.8;max-width:min(520px,86vw);margin-top:8px}
#title label{display:flex;gap:8px;align-items:center;justify-content:center;font-size:14px;cursor:pointer}
#title .st{font-size:13px;color:#8fe3b0;min-height:16px}
@media (max-height:480px){#title{gap:4px}#title h1{font-size:34px}#title .sub{margin:0 0 4px;font-size:12px;letter-spacing:.4em}#title .hint{display:none}#title .col{flex-direction:row;flex-wrap:wrap;justify-content:center;width:min(600px,92vw);gap:6px}#title button{min-height:38px;font-size:15px;flex:1 1 150px;padding:4px 8px}#title button small{display:none}#title label{flex:1 1 100%;font-size:13px}#title .dim{flex:1 1 100%}#title .lnk{flex:1 1 100%}}
#title .lnk{background:none;border:0;box-shadow:none;font-size:13px;opacity:.65;min-height:32px;padding:2px 8px}
`;

let el: HTMLElement | null = null;
let api: { start: (o: StartOpts) => void } | null = null;
let meta: SaveMeta | null = null;
let diff: 0 | 1 | 2 = 1, hard = false;
let play = 0;

export function titleOpen() { return document.body.classList.contains('title-open'); }
function close() { document.body.classList.remove('title-open'); if (el) el.style.display = ''; }

function view(mode: 'main' | 'new') {
  if (!el) return;
  const col = (h: string) => `<h1>${S.name}</h1><div class="sub">${S.sub}</div><div class="col">${h}</div><div class="hint">${S.hint}</div>`;
  if (mode === 'main') {
    let h = '';
    if (meta) h += `<button class="pri" data-a="cont">${S.cont}<small>${fmt(S.contInfo, { d: meta.day, n: G.endDay, t: new Date(meta.savedAt).toLocaleString() })}</small></button>`;
    h += `<button data-a="new"${meta ? '' : ' class="pri"'}>${S.newGame}</button><button class="lnk" data-a="test">${S.selftest}</button>`;
    el.innerHTML = col(h);
  } else {
    const dn = [[S.d0, S.d0t], [S.d1, S.d1t], [S.d2, S.d2t]];
    let h = `<div class="dim">${S.diff}</div>` + dn.map(([n, t], i) => `<button data-a="diff" data-d="${i}" class="${i === diff ? 'on' : ''}">${n}<small>${t}</small></button>`).join('');
    h += `<label><input type="checkbox" data-a="hard" ${hard ? 'checked' : ''}> ${S.hard}</label><button class="pri" data-a="go">${S.start}</button><button class="lnk" data-a="back">${S.back}</button>`;
    el.innerHTML = col(h);
  }
}

async function onClick(e: Event) {
  const t = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null; if (!t || !api) return;
  const a = t.dataset.a;
  if (a === 'new') view('new');
  else if (a === 'back') view('main');
  else if (a === 'diff') { diff = +t.dataset.d! as 0 | 1 | 2; view('new'); }
  else if (a === 'hard') hard = (t as HTMLInputElement).checked;
  else if (a === 'go') { close(); api.start({ diff, hardcore: hard }); }
  else if (a === 'cont') {
    const st = el!.querySelector('.hint'); if (st) st.textContent = S.loading;
    const d = await loadGame();
    if (!d) { meta = null; view('main'); return; }
    close(); api.start({ seed: d.meta.seed, diff: d.meta.diff, hardcore: d.meta.hardcore, save: d });
  } else if (a === 'test') { location.hash = 'selftest'; location.reload(); }
}

/** Dress the freshly generated world as the title backdrop: deep polar night, aurora, moon, a glowing fat lamp by the station. */
function backdrop() {
  wx.override = { aurora: 1, snowfall: 0.12, wind: 2, storm: 0, visibility: 1 };
  Object.assign(G, wx.override); setDay(6, 1);
  try { const p = G.player; placeFixture('fat_lamp', Math.floor(p.x / 4) + 5, Math.floor(p.y / 4) - 1, { lit: true, fuel: 9999, force: true }); } catch { /* backdrop only */ }
  G.paused = true;
}

function startAutosave() {
  const run = () => { if (!titleOpen() && G.player?.alive && !G.paused) void saveGame(); };
  setInterval(run, 30000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') run(); });
  on('slept', () => setTimeout(run, 400));
  on('died', () => { if (G.diff.hardcore) void deleteSave(); });
  void play;
}

export async function initTitle(a: { start: (o: StartOpts) => void }) {
  api = a;
  const q = new URLSearchParams(location.search);
  const skip = q.get('title') === '0' || (navigator.webdriver && q.get('title') !== '1') || location.hash.includes('selftest');
  startAutosave();
  if (skip) return;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  el = document.createElement('div'); el.id = 'title'; document.body.appendChild(el);
  el.addEventListener('click', (e) => { void onClick(e); });
  el.addEventListener('change', (e) => { void onClick(e); });
  meta = await peekSave();
  backdrop();
  document.body.classList.add('title-open');
  view('main');
}
