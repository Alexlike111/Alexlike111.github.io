// Self-tests of the desktop layout (TERRARIA_CONTROLS.md, «Desktop layout»): the belt in the top-left quarter, the bag anchored under the belt,
// the vitals column in the top-right quarter, no two of the named boxes overlap, and the lower 60 % of the screen holds no HUD element except the
// toasts and the «?» chip. They measure the real window (getBoundingClientRect), so run them at each size the spec names:
//   VIEW=1280x720 node tests/play/selftest.cjs <index.html> - layout      (also 1024x600 and 1920x1080)
// The phone (touch-ui) keeps its own checks in hudmode.selftest.ts and ui.selftest.ts. Each test restores what it changes.
import { registerTest } from '../game/selftest';
import { G, toast } from '../game/state';
import { beltCells } from '../game/inventory';
import { input } from '../engine/input';
import { touchEnabled, setEnabled } from './touch';
import { getUiMode, setUiMode } from './hudmode';

type R = { l: number; t: number; r: number; b: number; name: string };
const shown = (e: Element) => {
  const cs = getComputedStyle(e), r = e.getBoundingClientRect();
  return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05 && r.width > 0 && r.height > 0;
};
const box = (sel: string, name = sel): R | null => {
  const e = [...document.querySelectorAll(sel)].find(shown); if (!e) return null;
  const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, name };
};
const hits = (a: R, b: R) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;

/** Shut whatever panel an earlier test left open (bag / journal) and wait until the HUD classes are gone. */
async function closePanels(t: { sc: any; wait(ms: number): Promise<void> }) {
  for (let i = 0; i < 4; i++) {
    const bagOpen = [...document.querySelectorAll('#hud .pnl')].some(e => !e.classList.contains('jr') && (e as HTMLElement).style.display === 'block');
    const jrOpen = [...document.querySelectorAll('#hud .pnl.jr')].some(e => (e as HTMLElement).style.display === 'block');
    if (!bagOpen && !jrOpen) return;
    if (bagOpen) input.craftPressed = true; else input.journalPressed = true;
    t.sc.step(6); await t.wait(180);
  }
}

/** The named boxes of the spec, as they are on screen now (a missing box is simply left out). */
function namedBoxes(bagOpen: boolean): R[] {
  const out = [box('#hud .belt', 'пояс'), box('#hud .vit', 'плашка тела и часов'), box('#sc-menubtn', '⚙'), box('#sc-fsbtn', '⛶'), box('#hud .stk .obj', 'цель')];
  if (bagOpen) out.push(box('#hud .pnl:not(.jr)', 'сумка'));
  return out.filter((x): x is R => !!x);
}

/** Pieces that may sit in the lower 60 %: the toasts (and their stack), the «?» chip with its list, the off-screen goal arrow, the cursor tip. */
const LOW_OK = '.tbox, .tbox *, .hint, .hint *, .arw, .arw *, .tip, .tip *, .sn-lbl, .sn-lbl *, #zoomlab, #zoomlab *';

/** The desktop sizes of the spec are 1024×600 and up; on a smaller window (the phone sizes run the same file) the desktop checks do not apply. */
const deskSize = () => innerWidth >= 1000 && innerHeight >= 600;

function checkLayoutInMode(t: { expect(c: boolean, m: string): void; sc: any; wait(ms: number): Promise<void> }, mode: 'full' | 'min', W: number, H: number) {
  const tag = `[${mode} ${W}×${H}] `;
  const belt = box('#hud .belt', 'пояс');
  t.expect(!!belt, tag + 'нет пояса');
  if (belt) {
    t.expect(belt.r <= W / 2 && belt.b <= H / 2, `${tag}пояс не в левом верхнем квадранте: ${belt.l},${belt.t}–${belt.r},${belt.b}`);
    const n = document.querySelectorAll('#hud .belt .sl').length;
    t.expect(n === beltCells().length && (n === 6 || n === 9), `${tag}ячеек пояса ${n}, ждали ${beltCells().length}`);
    t.expect(document.querySelectorAll('#hud .belt .sl.sel').length === 1, tag + 'выбранная ячейка пояса не одна');
  }
  const vit = box('#hud .vit', 'плашка тела и часов');
  t.expect(!!vit, tag + 'нет плашки тела и часов');
  if (vit) t.expect(vit.l >= W / 2 && vit.t <= H / 2 && vit.r <= W, `${tag}плашка не в правом верхнем квадранте: ${vit.l},${vit.t}–${vit.r},${vit.b}`);
  const menu = box('#sc-menubtn', '⚙'), fs = box('#sc-fsbtn', '⛶');
  t.expect(!!menu && !!fs, tag + 'нет кнопок ⚙ / ⛶');
  if (menu && fs) t.expect(menu.l >= W / 2 && fs.l >= W / 2 && fs.r <= W && menu.r <= fs.l + 0.5, `${tag}кнопки ⚙ / ⛶ стоят не в правом верхнем углу`);
  const obj = box('#hud .stk .obj', 'цель');
  if (obj) t.expect(Math.abs((obj.l + obj.r) / 2 - W / 2) < W * 0.1 && obj.t < 60, `${tag}цель не по центру верха: ${obj.l}–${obj.r}, top ${obj.t}`);
  // no two of the named boxes overlap
  const named = namedBoxes(false);
  for (let i = 0; i < named.length; i++) for (let j = i + 1; j < named.length; j++)
    t.expect(!hits(named[i], named[j]), `${tag}налезают друг на друга: ${named[i].name} и ${named[j].name}`);
  // the bottom 60 %: nothing but the toasts and the «?» chip
  const low: string[] = [];
  for (const e of Array.from(document.querySelectorAll('#hud *'))) {
    if (e.matches('.bot, #hud') || e.matches(LOW_OK) || e.closest(LOW_OK)) continue;      // .bot is the full-screen layer, not a box
    if (!shown(e)) continue;
    const r = e.getBoundingClientRect();
    if (r.bottom > H * 0.4 && r.top < H) low.push((e.className && typeof e.className === 'string' ? e.className : e.tagName) + ' ' + Math.round(r.top) + '–' + Math.round(r.bottom));
  }
  t.expect(low.length === 0, `${tag}в нижних 60 % экрана есть HUD: ${low.slice(0, 5).join(' | ')}`);
  const q = box('#hud .hint .q', '?');
  if (q) t.expect(q.l < W / 4 && q.t > H * 0.6, `${tag}«?» не в левом нижнем углу`);
}

registerTest('layout', 'ПК: пояс, плашка тела и часов, цель, ⚙ / ⛶ стоят по углам и не налезают; низ экрана пуст', async t => {
  const prevOn = touchEnabled();
  setEnabled(false); await closePanels(t); t.sc.step(14); await t.wait(120);
  const W = window.innerWidth, H = window.innerHeight, prevMode = getUiMode();
  if (!deskSize()) { t.log(`окно ${W}×${H}: не ПК-размер, проверка пропущена`); setEnabled(prevOn); return; }
  t.expect(!document.body.classList.contains('touch-ui'), 'тест идёт в режиме касания');
  try {
    // the game's own choice for this window and the other mode: both must keep the layout
    for (const m of ['full', 'min'] as const) {
      setUiMode(m); t.sc.step(14); await t.wait(120);
      checkLayoutInMode(t, m, W, H);
    }
  } finally { setUiMode(prevMode); setEnabled(prevOn); }
});

registerTest('layout', 'ПК: сумка открывается под поясом: левый край у края, верх в 12 px от низа пояса, по центру не стоит', async t => {
  const prevOn = touchEnabled();
  setEnabled(false); await closePanels(t);
  if (!deskSize()) { t.log('окно не ПК-размер: проверка пропущена'); setEnabled(prevOn); return; }
  input.craftPressed = true; t.sc.step(10); await t.wait(160);
  const W = window.innerWidth, H = window.innerHeight;
  const bag = box('#hud .pnl:not(.jr)', 'сумка'), belt = box('#hud .belt', 'пояс');
  t.expect(!!bag && !!belt, 'сумка или пояс не на экране');
  if (bag && belt) {
    t.expect(bag.l < 40, `сумка не у левого края: ${bag.l}`);
    t.expect(Math.abs(bag.t - belt.b) <= 12, `сумка не под поясом: верх ${bag.t}, низ пояса ${belt.b}`);
    t.expect(bag.b <= H && bag.r <= W, `сумка за краем окна: ${bag.r}×${bag.b}`);
    t.expect(bag.r < (box('#hud .vit', 'плашка') ?? { l: W }).l, 'сумка налезает на плашку тела и часов');
    const named = namedBoxes(true);
    for (let i = 0; i < named.length; i++) for (let j = i + 1; j < named.length; j++)
      t.expect(!hits(named[i], named[j]), `при открытой сумке налезают: ${named[i].name} и ${named[j].name}`);
    // the bag's grid, the wear column and the crafting list are side by side: the wear column is to the right of the grid
    const grid = document.querySelector('#hud .pnl .pk .grid')?.getBoundingClientRect(), wear = document.querySelector('#hud .pnl .pk .top')?.getBoundingClientRect();
    t.expect(!!grid && !!wear && wear.left >= grid.right - 1, 'столбец одежды не справа от сетки сумки');
    const craft = document.querySelector('#hud .pnl .col:last-child')?.getBoundingClientRect();
    if (bag.r - bag.l >= 680) t.expect(!!craft && craft.left >= (wear?.right ?? 0) - 1 && craft.top < bag.b, 'список «Что умею» не рядом с сумкой');   // a narrow window wraps it below
    else t.log('узкая сумка: список «Что умею» переносится под сетку');
  }
  input.craftPressed = true; t.sc.step(8); await t.wait(120);
  setEnabled(prevOn);
});

registerTest('layout', 'ПК: тосты в левом нижнем углу, не больше трёх, над «?»', async t => {
  const prevOn = touchEnabled();
  setEnabled(false); await closePanels(t);
  if (!deskSize()) { t.log('окно не ПК-размер: проверка пропущена'); setEnabled(prevOn); return; }
  G.toasts.length = 0;
  toast('Тост раз', 'info'); toast('Тост два', 'info'); toast('Тост три', 'warn'); toast('Тост четыре', 'good');
  t.sc.step(12); await t.wait(120);
  const W = window.innerWidth, H = window.innerHeight;
  const ts = [...document.querySelectorAll('#hud .tbox .toast')].filter(shown) as HTMLElement[];
  t.expect(ts.length >= 1 && ts.length <= 3, 'тостов на экране: ' + ts.length);
  for (const e of ts) {
    const r = e.getBoundingClientRect();
    t.expect(r.left < W / 3 && r.bottom > H * 0.6, `тост не в левом нижнем углу: ${Math.round(r.left)},${Math.round(r.bottom)}`);
  }
  const q = box('#hud .hint .q', '?');
  if (q && ts.length) t.expect(ts.every(e => e.getBoundingClientRect().bottom <= q.t + 1), 'тосты налезают на «?»');
  G.toasts.length = 0; t.sc.step(6);
  setEnabled(prevOn);
});

registerTest('layout', 'ПК: «?» открывает полный список с новыми клавишами; H закрывает его', async t => {
  const prevOn = touchEnabled();
  setEnabled(false); await closePanels(t); t.sc.step(8); await t.wait(60);
  const full = document.querySelector('#hud .hfull') as HTMLElement | null;
  const open = () => !!full && getComputedStyle(full).display !== 'none';
  t.expect(!open(), 'полный список открыт в начале');
  const txt = full?.textContent ?? '';
  for (const k of ['ЛКМ', 'ПКМ', 'I / Tab', 'P', 'M', 'Shift+ЛКМ', 'Ctrl', 'J', 'G', 'Ctrl+колесо', 'колесо', 'F', 'V', 'X', 'R', 'Q', 'H'])
    t.expect(txt.includes(k), 'в полном списке нет «' + k + '»');
  (document.querySelector('#hud .hint .q') as HTMLElement | null)?.click(); t.sc.step(8); await t.wait(60);
  t.expect(open(), '«?» не открыл полный список');
  (document.querySelector('#hud .hint .q') as HTMLElement | null)?.click(); t.sc.step(8); await t.wait(60);
  t.expect(!open(), '«?» не закрыл список');
  setEnabled(prevOn);
});
