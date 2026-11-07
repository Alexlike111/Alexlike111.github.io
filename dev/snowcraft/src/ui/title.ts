// Title screen + autosave flow (DESIGN §10). A composed scene over the live polar-night world (paused): a snow-block igloo glowing amber from its fat lamp,
// Север sitting at the entrance tunnel, a figure by the lamp inside, a sled and cut blocks, aurora and moon above; SNOWCRAFT in the pixel font at the top;
// Продолжить (when a save exists), Новая игра with difficulty + hardcore, Самотест at the bottom. Autosaves every 30 s of play, when the tab is hidden and
// after sleeping; hardcore death deletes the slot. Skipped with ?title=0, in automated browsers (navigator.webdriver) and with #selftest; ?title=1 forces it.
// The scene is written into the already generated world; starting a game regenerates the world, so nothing here leaks into a run.
import '@fontsource/pixelify-sans/latin-400.css';
import '@fontsource/pixelify-sans/cyrillic-400.css';
import '@fontsource/pixelify-sans/latin-600.css';
import '@fontsource/pixelify-sans/cyrillic-600.css';
import '@fontsource/jura/latin-600.css';
import '@fontsource/jura/cyrillic-600.css';
import '@fontsource/jura/latin-400.css';
import '@fontsource/jura/cyrillic-400.css';
import './ui.css';
import { G } from '../game/state';
import { strings, fmt } from '../content/i18n';
import { on } from '../game/bus';
import { peekSave, loadGame, saveGame, deleteSave, type SaveMeta, type SaveData } from '../game/save';
import { wx, setDay } from '../game/weather';
import { cycleOf, loadBest } from '../game/seasons';
import { placeFixture } from '../game/fixtures';
import { fauna, groundY } from '../game/fauna';
import { W, mat, aux, flags, shade, edited, wakeRect } from '../engine/grid';
import { MAT } from '../content/materials';
import { auxOfDensity } from '../game/items';
import { LOC } from '../game/locations';
import { updateCamera } from '../engine/camera';
import { addLayer } from '../engine/render';
import type { View } from '../game/state';

const S = strings('title', {
  name: 'SNOWCRAFT', sub: 'Полярная ночь', cont: 'Продолжить', newGame: 'Новая игра', start: 'Начать', back: 'Назад', selftest: 'Самотест',
  contInfo: 'День {d}', record: 'Рекорд: {d} дн. · круг {c}', diff: 'Сложность', hard: 'Хардкор: одна жизнь, без возврата',
  d0: 'Мягкая', d1: 'Обычная', d2: 'Суровая', d0t: 'теплее, меньше голода', d1t: 'как задумано', d2t: 'холод кусает, запасы редки',
  hint: 'Полярная ночь не кончается. Станция «Мыс Безмолвия». Живи, сколько сможешь.', loading: 'Загрузка…', saved: 'Сохранено',
});
export interface StartOpts { seed?: number; diff?: 0 | 1 | 2; hardcore?: boolean; save?: SaveData }

const CSS = `
#title{position:fixed;inset:0;z-index:60;display:none;flex-direction:column;justify-content:space-between;align-items:center;font-family:'Jura',system-ui,sans-serif;font-weight:600;color:#dff0ff;text-align:center;
 background:linear-gradient(180deg,rgba(4,8,18,.78) 0,rgba(4,8,18,.28) 20%,rgba(4,8,18,0) 38%,rgba(4,8,18,0) 56%,rgba(4,8,18,.55) 74%,rgba(4,8,18,.86) 100%);
 padding:calc(2.5vh + env(safe-area-inset-top,0px)) calc(12px + env(safe-area-inset-right,0px)) calc(2.5vh + env(safe-area-inset-bottom,0px)) calc(12px + env(safe-area-inset-left,0px));box-sizing:border-box;-webkit-user-select:none;user-select:none;touch-action:manipulation}
body.title-open #title{display:flex}
body.title-open #hud,body.title-open #touch{display:none !important}
#title h1{margin:0;font-family:'Pixelify Sans','Jura',sans-serif;font-weight:600;font-size:clamp(34px,8.5vw,92px);letter-spacing:.14em;line-height:1;color:#e8f6ff;text-shadow:0 2px 0 #2c4a6a,0 4px 0 #14243a,0 0 30px rgba(124,198,238,.55)}
#title .sub{font-family:'Pixelify Sans','Jura',sans-serif;font-size:clamp(14px,2.4vw,22px);letter-spacing:.5em;color:#ffc46e;margin:4px 0 0;text-shadow:0 1px 0 #3a2410,0 0 14px rgba(255,170,80,.45)}
#title .bot{display:flex;flex-direction:column;align-items:center;gap:8px;width:min(760px,100%)}
#title .row{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;width:100%}
#title button{font:700 clamp(15px,1.5vw,19px) 'Jura',system-ui,sans-serif;letter-spacing:.3px;color:#e8f6ff;background:linear-gradient(180deg,rgba(22,40,66,.92),rgba(10,20,36,.92));border:2px solid rgba(124,198,238,.55);border-radius:5px;padding:9px 18px;cursor:pointer;min-height:48px;min-width:150px;box-shadow:0 0 0 1px #05080f}
#title button:hover,#title button:focus-visible{border-color:#ffc46e;color:#fff;outline:none}
#title button.pri{border-color:#ffc46e;background:linear-gradient(180deg,rgba(84,50,16,.94),rgba(46,27,10,.94))}
#title button small{display:block;font-size:12px;font-weight:600;opacity:.8;margin-top:2px}
#title button.on{border-color:#8fe3b0;background:linear-gradient(180deg,rgba(24,64,44,.94),rgba(12,36,26,.94))}
#title .hint{font-size:14px;opacity:.85;max-width:min(560px,90vw);text-shadow:0 1px 0 #05080f}
#title label{display:flex;gap:8px;align-items:center;justify-content:center;font-size:14px;cursor:pointer;min-height:32px;text-shadow:0 1px 0 #05080f}
#title label input{width:18px;height:18px}
#title .dim{font-size:13px;opacity:.8;letter-spacing:.3px}
#title .lnk{background:none;border:0;box-shadow:none;font-size:13px;opacity:.7;min-height:44px;min-width:0;padding:2px 12px}
@media (max-height:480px){
  #title{padding-top:calc(6px + env(safe-area-inset-top,0px));padding-bottom:calc(6px + env(safe-area-inset-bottom,0px))}
  #title h1{font-size:34px}#title .sub{font-size:12px;letter-spacing:.4em;margin:2px 0 0}
  #title .hint{display:none}#title .bot{gap:4px}#title .row{gap:6px}
  #title button{min-height:48px;min-width:0;padding:4px 14px;font-size:15px}#title button small{display:none}
  #title label{min-height:26px;font-size:13px}#title .dim{display:none}
}`;

let el: HTMLElement | null = null;
let api: { start: (o: StartOpts) => void } | null = null;
let meta: SaveMeta | null = null;
let diff: 0 | 1 | 2 = 1, hard = false;
let sceneTimer = 0;
let scene: { cx: number; gy: number; R: number; r: number } | null = null, removeGlow: (() => void) | null = null;

export function titleOpen() { return document.body.classList.contains('title-open'); }
function close() { document.body.classList.remove('title-open'); if (el) el.style.display = ''; clearInterval(sceneTimer); removeGlow?.(); removeGlow = null; scene = null; }

function view(mode: 'main' | 'new') {
  if (!el) return;
  const top = `<div class="top"><h1>${S.name}</h1><div class="sub">${S.sub}</div></div>`;
  const wrap = (h: string, hint = true) => `${top}<div class="bot">${h}${hint ? `<div class="hint">${S.hint}</div>` : ''}</div>`;
  if (mode === 'main') {
    let h = '<div class="row">';
    if (meta) h += `<button class="pri" data-a="cont">${S.cont}<small>${fmt(S.contInfo, { d: meta.day, c: (meta.cycle ?? cycleOf(meta.day)) + 1, t: new Date(meta.savedAt).toLocaleString() })}</small></button>`;
    h += `<button data-a="new"${meta ? '' : ' class="pri"'}>${S.newGame}</button></div><div class="row"><button class="lnk" data-a="test">${S.selftest}</button></div>`;
    const bst = loadBest(); if (bst) h += `<div class="dim">${fmt(S.record, { d: bst.day, c: bst.cycle + 1 })}</div>`;
    el.innerHTML = wrap(h);
  } else {
    const dn = [[S.d0, S.d0t], [S.d1, S.d1t], [S.d2, S.d2t]];
    let h = `<div class="dim">${S.diff}</div><div class="row">` + dn.map(([n, t], i) => `<button data-a="diff" data-d="${i}" class="${i === diff ? 'on' : ''}">${n}<small>${t}</small></button>`).join('') + '</div>';
    h += `<label><input type="checkbox" data-a="hard" ${hard ? 'checked' : ''}> ${S.hard}</label><div class="row"><button class="pri" data-a="go">${S.start}</button><button data-a="back">${S.back}</button></div>`;
    el.innerHTML = wrap(h, false);
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

// ---------------------------------------------------------------------------------------------------------------------
// the scene
const put = (x: number, y: number, m: number, a = 0) => { const i = y * W + x; mat[i] = m; aux[i] = a; flags[i] = 0; shade[i] = (x * 7 + y * 13 + ((x * y) & 31)) & 255; };
const fillRect = (x0: number, y0: number, x1: number, y1: number, m: number, a = 0) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, m, a); };
const DK = 0.95;                                                    // dome height / half-width
/** An elliptic dome of snow blocks: outer radius `ro`, inner `ri` (cells), flat-ish (0.82), sitting on ground row `gy`. Returns the outer top row. */
function dome(cx: number, gy: number, ro: number, ri: number, dens: number) {
  const ax = auxOfDensity(dens), k = DK;
  for (let y = gy - Math.ceil(ro * k) - 1; y < gy; y++) for (let x = cx - ro; x <= cx + ro; x++) {
    const dx = x - cx, dy = gy - y;
    const o = (dx * dx) / (ro * ro) + (dy * dy) / (ro * k * ro * k), i = (dx * dx) / (ri * ri) + (dy * dy) / (ri * k * ri * k);
    if (o <= 1 && i > 1) put(x, y, MAT.SNOWBLOCK, ax + (((x >> 3) + (y >> 2)) & 3) * 3 - 4);
  }
}
function carve(cx: number, gy: number, ri: number) {
  const k = DK;
  for (let y = gy - Math.ceil(ri * k) - 1; y < gy; y++) for (let x = cx - ri + 1; x < cx + ri; x++) {
    const dx = x - cx, dy = gy - y;
    if ((dx * dx) / (ri * ri) + (dy * dy) / (ri * k * ri * k) <= 1) put(x, y, MAT.AIR);
  }
}

/** Amber glow of the lit dome: warm interior, the translucent shell lit from inside, a halo and a spill out of the tunnel (additive: this layer runs in the emissive pass). */
function glow(ctx: CanvasRenderingContext2D, v: View) {
  if (!scene) return;
  const { cx, gy, R, r } = scene, fl = 0.94 + 0.06 * Math.sin(v.t * 9) * Math.sin(v.t * 4.1);
  const X = cx - v.x0, Y = gy - v.y0;
  ctx.save();
  // halo (a whisper: the lit snow is already bright, additive light would burn it out)
  const h = ctx.createRadialGradient(X, Y - 14, r * 0.4, X, Y - 14, R * 1.9);
  h.addColorStop(0, `rgba(255,150,60,${(0.1 * fl).toFixed(3)})`); h.addColorStop(0.55, `rgba(255,120,40,${(0.045 * fl).toFixed(3)})`); h.addColorStop(1, 'rgba(255,100,30,0)');
  ctx.fillStyle = h; ctx.fillRect(X - R * 2, Y - R * 2, R * 4, R * 2.2);
  // shell + interior, clipped to the dome silhouette: soft-light tints the snow amber without clipping to white
  ctx.beginPath(); ctx.ellipse(X, Y, R, R * DK, 0, Math.PI, Math.PI * 2); ctx.closePath(); ctx.clip();
  const g = ctx.createRadialGradient(X - 4, Y - 14, 2, X - 4, Y - 14, R * 1.05);
  g.addColorStop(0, `rgba(255,150,40,${(0.95 * fl).toFixed(3)})`); g.addColorStop(0.65, `rgba(255,130,30,${(0.85 * fl).toFixed(3)})`); g.addColorStop(1, `rgba(255,110,20,${(0.7 * fl).toFixed(3)})`);
  ctx.globalCompositeOperation = 'soft-light';
  ctx.fillStyle = g; ctx.fillRect(X - R, Y - R * DK - 2, R * 2, R * DK + 2);
  ctx.globalCompositeOperation = 'lighter';
  const g2 = ctx.createRadialGradient(X - 4, Y - 14, 2, X - 4, Y - 14, R);
  g2.addColorStop(0, `rgba(255,120,40,${(0.16 * fl).toFixed(3)})`); g2.addColorStop(1, 'rgba(255,100,30,0.03)');
  ctx.fillStyle = g2; ctx.fillRect(X - R, Y - R * DK - 2, R * 2, R * DK + 2);
  ctx.restore();
  // the entrance tunnel is lit by the same fire
  ctx.save(); ctx.globalCompositeOperation = 'soft-light'; ctx.fillStyle = `rgba(255,140,40,${(0.7 * fl).toFixed(3)})`; ctx.fillRect(X + R - 14, Y - 21, 31, 21); ctx.restore();
  // spill out of the tunnel mouth onto the snow
  ctx.save();
  const sx = X + R + 18, sy = Y - 6;
  const sp = ctx.createRadialGradient(sx, sy, 2, sx, sy, 46);
  sp.addColorStop(0, `rgba(255,170,80,${(0.16 * fl).toFixed(3)})`); sp.addColorStop(1, 'rgba(255,130,50,0)');
  ctx.fillStyle = sp; ctx.fillRect(sx - 46, sy - 30, 92, 60);
  ctx.restore();
}

/** Dress the freshly generated world as the title backdrop: deep polar night, aurora, an amber igloo with the dog beside it. */
function backdrop() {
  wx.override = { aurora: 1, snowfall: 0.1, wind: 1.5, storm: 0, visibility: 1, ambientT: -26 };
  Object.assign(G, wx.override); setDay(6, 1.4);
  try {
    const p = G.player;
    const cx = LOC.fast.x0 + 60;                                   // the flat fast ice east of the beach: open horizon, no station in the shot
    const gy0 = groundY(cx, 180);
    const gy = gy0 + 1;
    // a gently rounded snow pad around the igloo
    const pad0 = cx - 240, pad1 = cx + 240;
    for (let x = pad0; x <= pad1; x++) {
      const e = Math.abs(x - cx) / 240, top = gy - Math.round(Math.max(0, 1 - e * e) * 3 + (Math.sin(x * 0.11) + Math.sin(x * 0.037 + 2)) * 1.2), floor = gy + Math.round(44 * (1 - Math.pow(e, 3)));
      for (let y = top - 30; y < top; y++) put(x, y, MAT.AIR);
      for (let y = top; y < floor; y++) put(x, y, y < top + 3 ? MAT.SNOW : MAT.PACKED, y < top + 3 ? 40 : auxOfDensity(280));
    }
    const R = 46, r = 35;
    dome(cx, gy, R, r, 300);
    fillRect(cx + R - 14, gy - 21, cx + R + 16, gy - 1, MAT.SNOWBLOCK, auxOfDensity(310));          // entrance tunnel (outer shell)
    carve(cx, gy, r);
    fillRect(cx + r - 10, gy - 16, cx + R + 17, gy - 1, MAT.AIR);                                   // tunnel bore, open to the right
    fillRect(cx - 7, gy - 6, cx + 1, gy - 1, MAT.SNOWBLOCK, auxOfDensity(320));                     // a block stool for the lantern
    // a stack of cut blocks and a drift on the left
    for (let k = 0; k < 3; k++) fillRect(cx - R - 34 + k * 4, gy - 4 * (k + 1), cx - R - 34 + 23 - k * 4, gy - 4 * k - 1, MAT.SNOWBLOCK, auxOfDensity(300));
    for (let x = cx - R - 78; x < cx - R - 46; x++) { const h = Math.round(7 * Math.max(0, 1 - Math.abs(x - (cx - R - 62)) / 16)); for (let y = gy - h; y < gy; y++) put(x, y, MAT.SNOW, 70); }
    edited(pad0, gy - 90, pad1, gy + 44); wakeRect(pad0, gy - 90, pad1, gy + 44, 30);
    // the lamp inside and a figure beside it
    const ty = (gy >> 2) - 1;
    placeFixture('lantern', (cx - 4) >> 2, ((gy - 6) >> 2) - 1, { lit: true, fuel: 9999, force: true });
    placeFixture('fat_lamp', (cx + 14) >> 2, ty, { lit: true, fuel: 9999, force: true });
    scene = { cx, gy, R, r };
    removeGlow = addLayer(6, glow);
    p.x = cx - 16; p.y = gy - 1; p.vx = p.vy = 0; p.face = 1;
    updateCamera(0, p.x, p.y - 22, true);
    // Север sits in the tunnel mouth, looking at the stars
    const d = fauna.dog;
    if (d) { d.x = cx + R + 22; d.y = gy - 1; d.vx = d.vy = 0; d.face = -1; d.state = 'sit'; }
    sceneTimer = window.setInterval(() => { if (d && titleOpen()) { d.t += 0.1; updateCamera(0.1, p.x, p.y - 22); } }, 100);
  } catch { /* backdrop only */ }
  G.paused = true;
}

function startAutosave() {
  const run = () => { if (!titleOpen() && G.player?.alive && !G.paused) void saveGame(); };
  setInterval(run, 30000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') run(); });
  on('slept', () => setTimeout(run, 400));
  on('died', () => { if (G.diff.hardcore) void deleteSave(); });
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
