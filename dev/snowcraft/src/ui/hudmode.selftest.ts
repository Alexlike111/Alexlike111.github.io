// Self-tests of the UI modes (ui/hudmode.ts) and of the layout they and the phone controls share: the mode persists and the body classes follow it,
// the touch layer keeps its buttons (no zoom buttons, ⚙ announces 'sc:menu'), the objective line never folds (playtest v13), and nothing on the thumb
// controls, the compass, the «Рядом» pill and the HUD panels overlaps another box (getBoundingClientRect). The overlap test measures the window it runs in:
// `VIEW=810x253 node tests/play/selftest.cjs <index.html> - hudmode` checks the landscape phone. Each test restores what it changes.
import { registerTest } from '../game/selftest';
import { getUiMode, setUiMode, applyUiMode, shortScreen, SHORT_H } from './hudmode';
import { setEnabled, touchEnabled } from './touch';
import { menuOpen, closeMenu } from './menu';

const KEY = 'sc.ui';

registerTest('hudmode', 'режим интерфейса: сохраняется, переключает классы body и шлёт sc:uimode', async t => {
  let prev: string | null = null; try { prev = localStorage.getItem(KEY); } catch { /* blocked */ }
  const seen: string[] = []; const h = (e: Event) => seen.push((e as CustomEvent).detail.mode);
  window.addEventListener('sc:uimode', h);
  setUiMode('full');
  setUiMode('min');
  t.expect(getUiMode() === 'min', 'режим не сохранился: ' + getUiMode());
  t.expect(document.body.classList.contains('ui-min') && !document.body.classList.contains('ui-full'), 'класс ui-min не стоит на body');
  setUiMode('full');
  t.expect(getUiMode() === 'full' && document.body.classList.contains('ui-full') && !document.body.classList.contains('ui-min'), 'класс ui-full не стоит на body');
  t.expect(seen.includes('min') && seen.includes('full'), 'sc:uimode не пришёл: ' + seen.join(','));
  window.removeEventListener('sc:uimode', h);
  // a stored value that is not a mode is ignored: the window's default decides (min below 340 px high, full otherwise)
  try { localStorage.setItem(KEY, 'bogus'); } catch { /* blocked */ }
  const dflt = window.innerHeight < SHORT_H ? 'min' : 'full';
  t.expect(getUiMode() === dflt, `по умолчанию для окна ${window.innerHeight} px ждали ${dflt}, получили ${getUiMode()}`);
  t.expect(shortScreen() === (window.innerHeight < SHORT_H), 'shortScreen() расходится с высотой окна');
  try { if (prev === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, prev); } catch { /* blocked */ }
  applyUiMode();
});

registerTest('hudmode', 'кнопки телефона: нет кнопок +/−, ⚙ шлёт sc:menu, Сумка / Журнал / ⚙ стоят в верхнем ряду', async t => {
  const prevOn = touchEnabled();
  setEnabled(true); t.sc.step(4); await t.wait(40);
  const el = (id: string) => document.getElementById(id) as HTMLElement | null;
  t.expect(!el('tb-zin') && !el('tb-zout'), 'остались экранные кнопки +/−');
  const menu = el('tb-menu');
  t.expect(!!menu && menu.getAttribute('aria-label') === 'Меню', 'нет кнопки ⚙ «Меню»');
  let got = 0; const h = () => got++;
  window.addEventListener('sc:menu', h);
  if (menu) {
    menu.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 61, pointerType: 'touch', bubbles: true, isPrimary: true }));
    menu.dispatchEvent(new PointerEvent('pointerup', { pointerId: 61, pointerType: 'touch', bubbles: true, isPrimary: true }));
  }
  window.removeEventListener('sc:menu', h);
  t.expect(got === 1, 'sc:menu не пришёл при нажатии ⚙');
  t.expect(menuOpen(), 'панель меню не открылась по sc:menu');
  if (menuOpen()) closeMenu();                       // the panel pauses the game while open: close it again, the next tests need the world running
  const top = ['tb-bag', 'tb-jour', 'tb-menu'].map(i => el(i)?.getBoundingClientRect());
  t.expect(top.every(r => r && r.top < 60), 'Сумка / Журнал / ⚙ не в верхнем ряду');
  for (const id of ['tb-act', 'tb-jump', 'tb-take', 'tb-belt', 'tb-senses', 'tb-parka']) {
    const r = el(id)?.getBoundingClientRect();
    t.expect(!!r && r.width >= 34 && r.height >= 34, `${id} меньше 34 px`);
  }
  setEnabled(prevOn);
});

registerTest('hudmode', 'раскладка: кнопки, стик, «Рядом», компас и панели не перекрывают друг друга', async t => {
  const prevOn = touchEnabled();
  setEnabled(true);
  const nb = document.getElementById('nearbtn'), cp = document.getElementById('compass');
  const cpCls = cp?.className ?? '';
  const forceNear = document.createElement('style'); forceNear.textContent = '#nearbtn{display:flex !important}'; document.head.appendChild(forceNear);   // the pill shows only with two or more things near (the bag module re-sets its display): force it here
  if (nb) nb.textContent = 'Рядом 3';
  cp?.classList.add('on');
  t.sc.step(6); await t.wait(120);
  const vis = (e: Element) => { const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const pick = (sels: string[]) => sels.flatMap(s => [...document.querySelectorAll(s)].filter(vis).map(e => ({ n: s + (e.id ? '#' + e.id : ''), r: e.getBoundingClientRect() })));
  const thumbs = pick(['#touch .tb', '#touch .stick', '#nearbtn']);
  const panels = pick(['#hud .bw', '#hud .dial', '#hud .stk .obj', '#hud .stk .chip', '#hud .belt', '#hud .tbox .toast', '#hud .bname', '#compass']);
  const meet = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const bad: string[] = [];
  for (let i = 0; i < thumbs.length; i++) {
    for (let j = i + 1; j < thumbs.length; j++) if (meet(thumbs[i].r, thumbs[j].r)) bad.push(thumbs[i].n + ' x ' + thumbs[j].n);
    for (const p of panels) if (meet(thumbs[i].r, p.r)) bad.push(thumbs[i].n + ' x ' + p.n);
  }
  for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) if (meet(panels[i].r, panels[j].r)) bad.push(panels[i].n + ' x ' + panels[j].n);
  const W = window.innerWidth, H = window.innerHeight;
  const off = [...thumbs, ...panels].filter(x => x.r.left < -1 || x.r.top < -1 || x.r.right > W + 1 || x.r.bottom > H + 1).map(x => x.n);
  t.expect(bad.length === 0, `наложения при ${W}×${H}: ${bad.slice(0, 6).join(' | ')}`);
  t.expect(off.length === 0, `за краем экрана при ${W}×${H}: ${off.join(', ')}`);
  forceNear.remove(); if (nb) nb.textContent = '';
  if (cp) cp.className = cpCls;
  setEnabled(prevOn);
});

registerTest('hudmode', 'цель: строка не сворачивается (playtest v13): текст виден через 30 с, новая цель мигает, в «min» тоже', async t => {
  const prevOn = touchEnabled();
  setEnabled(true);
  const obj = () => document.querySelector('#hud .stk .obj') as HTMLElement;
  t.sc.step(4); await t.wait(60);
  const before = obj().querySelector('.ot')?.textContent ?? '';
  t.expect(before.length > 0, 'строка цели пустая');
  t.sc.step(1800);                                   // 30 s of HUD time (the steps feed the HUD's clock)
  const same = (obj().querySelector('.ot')?.textContent ?? '') === before;
  if (!same) { t.log('цель сменилась во время ожидания: проверка пропущена'); setEnabled(prevOn); return; }
  t.expect(!obj().classList.contains('col'), 'через 30 с строка цели свернулась');
  t.expect((obj().querySelector('.ot') as HTMLElement).offsetParent !== null, 'текст цели скрыт через 30 с');
  document.body.classList.add('ui-min');
  t.sc.step(4); await t.wait(60);
  t.expect((obj().querySelector('.ot') as HTMLElement).offsetParent !== null, 'в режиме «min» текст цели скрыт');
  document.body.classList.remove('ui-min');
  setEnabled(prevOn);
});

registerTest('hudmode', 'короткое окно: одна плашка тела и часов, тост один; высокое окно: тело и часы раздельно', async t => {
  t.sc.step(4); await t.wait(60);
  const topl = document.querySelector('#hud .topl') as HTMLElement | null;
  const short = shortScreen();
  if (!topl) { t.expect(false, 'нет обёртки .topl'); return; }
  if (short) {
    const cs = getComputedStyle(topl);
    t.expect(cs.display === 'flex', 'короткое окно: тело и часы не в одной плашке: ' + cs.display);
    t.expect(getComputedStyle(document.querySelector('#hud .dial canvas') as HTMLElement).display === 'none', 'короткое окно: солнечная дуга видна');
  } else {
    t.expect(getComputedStyle(topl).display === 'contents', 'высокое окно: .topl должен быть прозрачным: ' + getComputedStyle(topl).display);
    t.log('окно высокое: плашка проверена как раздельные панели');
  }
  const touch = document.body.classList.contains('touch-ui');
  t.expect(document.querySelectorAll('#hud .tbox .toast').length <= (touch ? (short ? 1 : 2) : 3), 'тостов больше допустимого');
});
