// Playgama UX / controls compliance (PG2, requirements 1.4.5, 1.5.2, 1.6.1-1.6.8, 3.3.3): the game uses no Esc key; every panel closes with its ✕ (or its
// key); the speaker button, the M key and the «Звук» row share one sound state; a long press or a right click on the field opens no browser menu; the page
// does not scroll; the field fills the window; no two HUD controls overlap at the window the self-test runs at (VIEW=WxH in tests/play/selftest.cjs).
import { registerTest } from '../game/selftest';
import type { TestCtx } from '../game/selftest';
import { G } from '../game/state';
import { input } from '../engine/input';
import { menuOpen, isMuted, setMuteFromPlatform, closeMenu } from './menu';
import { panelIsOpen, resetHintsForTest } from './devhud';
import { nearUi } from '../game/nearby';
import { spawnDrop, clearInventory } from '../game/inventory';
import { placeFixture } from '../game/fixtures';
import { isOpen, openContainer, closeBox, searchSave, searchLoad } from '../game/search';
import { arena, sandbox } from '../game/testkit';
import { wx } from '../game/weather';

const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T | null;
const shown = (el: Element | null): boolean => {
  if (!el) return false;
  for (let e: Element | null = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return false; }
  const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1;
};
/** Close whatever a test left open (panels, settings, the pause). */
function closeAll(t: TestCtx) {
  for (let i = 0; i < 3 && panelIsOpen(); i++) { t.sc.key('KeyI', true); t.sc.key('KeyI', false); t.sc.step(3); }
  if (menuOpen()) closeMenu();
}

registerTest('playgama', 'Esc ничего не делает: ни инвентарь, ни журнал, ни настройки, ни пауза (браузер держит Esc для полного экрана)', async (t: TestCtx) => {
  closeAll(t); t.sc.step(4);
  const pb = panelIsOpen(), mb = menuOpen(), gb = G.paused;
  t.sc.key('Escape', true); t.sc.key('Escape', false); t.sc.step(4); await t.frames(2);
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape', key: 'Escape', bubbles: true }));
  t.sc.step(4); await t.frames(2);
  t.expect(panelIsOpen() === pb && menuOpen() === mb && G.paused === gb, `Esc изменил окна или паузу: панель ${pb}→${panelIsOpen()}, настройки ${mb}→${menuOpen()}, пауза ${gb}→${G.paused}`);
  t.expect(!input.craftPressed && !input.pausePressed && !input.journalPressed, 'Esc поставил одиночное действие (инвентарь / пауза / журнал)');
  t.expect(!/Esc/.test(document.querySelector('#hud .hfull')?.textContent ?? ''), 'в полном списке клавиш остался «Esc»');
});

registerTest('playgama', 'кнопка звука, клавиша M и строка «Звук» в настройках меняют одно состояние; платформа мьютит тем же путём', async (t: TestCtx) => {
  const before = isMuted();
  const row = () => $<HTMLElement>('#sc-menu [data-k=sound]')?.textContent ?? '';
  const want = () => (isMuted() ? 'Выкл' : 'Вкл');
  try {
    const btn = $<HTMLElement>('#sc-mutebtn');
    t.expect(!!btn && btn.getAttribute('aria-label') === 'Звук', 'нет кнопки звука #sc-mutebtn с подписью «Звук»');
    btn?.click(); t.sc.step(2); await t.frames(1);
    t.expect(isMuted() !== before, 'кнопка звука не переключила звук');
    t.expect(!!btn && btn.classList.contains('muted') === isMuted(), 'значок кнопки не показывает состояние звука');
    t.expect(row() === want(), `строка «Звук» не совпала с кнопкой: «${row()}»`);
    t.sc.key('KeyM', true); t.sc.key('KeyM', false); t.sc.step(2); await t.frames(1);
    t.expect(isMuted() === before, 'клавиша M не переключила звук обратно');
    $<HTMLElement>('#sc-menu [data-k=sound]')?.click(); t.sc.step(2); await t.frames(1);
    t.expect(isMuted() !== before && row() === want(), 'строка «Звук» в настройках не переключила звук');
    $<HTMLElement>('#sc-menu [data-k=sound]')?.click(); t.sc.step(2);
    // the phone's speaker (top row): a touch press toggles it; the same state again
    const tm = $<HTMLElement>('#tb-mute');
    t.expect(!!tm && tm.getAttribute('aria-label') === 'Звук', 'нет кнопки звука на телефоне #tb-mute');
    tm?.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 91, pointerType: 'touch', bubbles: true, isPrimary: true }));
    tm?.dispatchEvent(new PointerEvent('pointerup', { pointerId: 91, pointerType: 'touch', bubbles: true, isPrimary: true }));
    t.sc.step(2); await t.frames(1);
    t.expect(isMuted() !== before, 'кнопка звука на телефоне не переключила звук');
    t.expect(!!tm && tm.classList.contains('muted') === isMuted(), 'значок телефонной кнопки не показывает состояние');
    setMuteFromPlatform(!before); t.sc.step(2);
    t.expect(isMuted() === !before && row() === (before ? 'Вкл' : 'Выкл'), 'setMuteFromPlatform не выставил звук и строку настроек');
  } finally { setMuteFromPlatform(before); }
  t.expect(isMuted() === before, 'звук не вернулся к прежнему состоянию');
});

registerTest('playgama', 'каждая панель закрывается своим ✕: инвентарь, журнал (и затемнение), список «Рядом», полный список клавиш, настройки (и затемнение)', async (t: TestCtx) => {
  closeAll(t); t.sc.step(4);
  // inventory: the ✕ in its corner
  t.sc.key('KeyI', true); t.sc.key('KeyI', false); t.sc.step(3); await t.frames(2);
  t.expect(panelIsOpen(), 'I не открыл инвентарь');
  const x1 = $<HTMLElement>('#hud .pnl:not(.jr) > .px');
  t.expect(shown(x1), 'у инвентаря нет видимого ✕');
  x1?.click(); t.sc.step(3); await t.frames(1);
  t.expect(!panelIsOpen(), '✕ инвентаря не закрыл его');
  // journal: the ✕ closes it; a click on the dark backdrop closes it too
  t.sc.key('KeyJ', true); t.sc.key('KeyJ', false); t.sc.step(3); await t.frames(2);
  t.expect(panelIsOpen() && shown($<HTMLElement>('#hud .scrim')), 'J не открыл журнал с затемнением');
  const x2 = $<HTMLElement>('#hud .pnl.jr > .px');
  t.expect(shown(x2), 'у журнала нет видимого ✕');
  x2?.click(); t.sc.step(3); await t.frames(1);
  t.expect(!panelIsOpen(), '✕ журнала не закрыл его');
  t.sc.key('KeyJ', true); t.sc.key('KeyJ', false); t.sc.step(3); await t.frames(2);
  $<HTMLElement>('#hud .scrim')?.click(); t.sc.step(3); await t.frames(1);
  t.expect(!panelIsOpen(), 'клик по затемнению не закрыл журнал');
  // full key list: its ✕ (the «?» chip opens it)
  resetHintsForTest(); t.sc.step(8); await t.wait(60);
  $<HTMLElement>('#hud .hint .q')?.click(); t.sc.step(8); await t.wait(60);
  const full = $<HTMLElement>('#hud .hfull');
  t.expect(!!full && full.classList.contains('on'), '«?» не открыл полный список');
  const x3 = $<HTMLElement>('#hud .hfull .hx');
  t.expect(shown(x3), 'у полного списка клавиш нет видимого ✕');
  x3?.click(); t.sc.step(8); await t.wait(60);
  t.expect(!!full && !full.classList.contains('on'), '✕ полного списка не закрыл его');
  // settings: ✕ and the dark backdrop
  t.sc.key('KeyP', true); t.sc.key('KeyP', false); t.sc.step(3); await t.frames(3);
  t.expect(menuOpen() && G.paused, 'P не открыл настройки с паузой');
  $<HTMLElement>('#sc-menu .mx')?.click(); t.sc.step(3); await t.frames(3);
  t.expect(!menuOpen() && !G.paused, '✕ настроек не закрыл их или не снял паузу');
  t.sc.key('KeyP', true); t.sc.key('KeyP', false); t.sc.step(3); await t.frames(3);
  $<HTMLElement>('#sc-veil')?.click(); t.sc.step(3); await t.frames(3);
  t.expect(!menuOpen() && !G.paused, 'клик по затемнению не закрыл настройки');
});

registerTest('playgama', 'список «Рядом» и ✕ в нём; ✕ ящика (через инвентарь) закрывает и ящик', async (t: TestCtx) => {
  closeAll(t);
  await sandbox(async () => {
    const was = searchSave();
    try {
      wx.override = { ambientT: -20, wind: 0, storm: 0, snowfall: 0 }; Object.assign(G, wx.override);      // a still, cold day (as controls.selftest.ts)
      arena(1000, 272, { dens: 300, loose: 0, depth: 40, up: 70 }); t.sc.teleport(1000, 272); clearInventory();
      spawnDrop('coal', 2, 1002, 270); spawnDrop('matches', 1, 1004, 270);
      t.sc.step(12); await t.wait(120);
      nearUi.open = true; t.sc.step(6); await t.wait(250); await t.frames(1);
      const nx = $<HTMLElement>('#hud .nearl .nx');
      t.expect(shown($<HTMLElement>('#hud .nearl')) && shown(nx), 'список «Рядом» не открылся с видимым ✕');
      nx?.click(); t.sc.step(4); await t.wait(150);
      t.expect(!nearUi.open && !shown($<HTMLElement>('#hud .nearl')), '✕ списка «Рядом» не закрыл его');
      // a container: its panel's ✕ closes the container with the panel
      const f = placeFixture('chest', 247, 66, { force: true, items: [{ id: 'coal', n: 3 }] });
      t.expect(!!f && openContainer(f!), 'сундук не открылся');
      t.sc.step(3); await t.frames(1);
      t.expect(isOpen() && panelIsOpen(), 'сундук не открыл панель');
      $<HTMLElement>('#hud .pnl:not(.jr) > .px')?.click(); t.sc.step(4); await t.frames(1);
      t.expect(!isOpen() && !panelIsOpen(), '✕ панели не закрыл сундук');
    } finally { closeBox(); searchLoad(was); }
  });
});

registerTest('playgama', 'длинное нажатие и правая кнопка на поле не открывают меню браузера; страница не прокручивается; поле заполняет окно', async (t: TestCtx) => {
  const stage = document.getElementById('stage') ?? document.body;
  for (const el of [stage, document.getElementById('world'), $('#hud .bw'), document.body]) {
    if (!el) continue;
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    t.expect(ev.defaultPrevented, 'контекстное меню не отменено на ' + ((el as HTMLElement).id || el.tagName));
  }
  const cs = getComputedStyle(stage);
  t.expect(cs.userSelect === 'none' || cs.webkitUserSelect === 'none', 'поле выделяется текстом (user-select)');
  t.expect(getComputedStyle(document.body).overflow === 'hidden', 'body не overflow:hidden');
  const d = document.scrollingElement as HTMLElement;
  t.expect(d.scrollHeight <= window.innerHeight + 1 && d.scrollWidth <= window.innerWidth + 1,
    `страница прокручивается: ${d.scrollWidth}×${d.scrollHeight} в окне ${window.innerWidth}×${window.innerHeight}`);
  const c = document.getElementById('world')!.getBoundingClientRect();
  t.expect(c.left <= 0.5 && c.top <= 0.5 && c.right >= window.innerWidth - 0.5 && c.bottom >= window.innerHeight - 0.5,
    `поле не заполняет окно: ${Math.round(c.left)},${Math.round(c.top)}–${Math.round(c.right)},${Math.round(c.bottom)} в ${window.innerWidth}×${window.innerHeight}`);
});

registerTest('playgama', 'видимые кнопки и панели HUD не перекрывают друг друга в текущем окне (VIEW=WxH)', async (t: TestCtx) => {
  closeAll(t); t.sc.step(8); await t.frames(2);
  const ids = ['#hud .bw', '#hud .dial', '#compass', '#sc-menubtn', '#sc-fsbtn', '#sc-mutebtn', '#hud .belt', '#hud .obj', '#hud .hint .q',
    '#tb-act', '#tb-jump', '#tb-take', '#tb-belt', '#tb-senses', '#tb-parka', '#tb-menu', '#tb-mute', '#tb-jour', '#tb-bag'];
  const items = ids.map(s => ({ s, el: $(s) })).filter(x => shown(x.el)).map(x => ({ s: x.s, r: x.el!.getBoundingClientRect() }));
  const bad: string[] = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i].r, b = items[j].r;
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (w > 1 && h > 1) bad.push(`${items[i].s} × ${items[j].s} (${Math.round(w)}×${Math.round(h)})`);
  }
  t.expect(bad.length === 0, `перекрытие: ${bad.join('; ')}`);
  // every control stays on the window
  const off = items.filter(x => x.r.left < -0.5 || x.r.top < -0.5 || x.r.right > window.innerWidth + 0.5 || x.r.bottom > window.innerHeight + 0.5).map(x => x.s);
  t.expect(off.length === 0, `за краем окна: ${off.join(', ')}`);
  t.metric('видимых элементов HUD', items.length);
});
