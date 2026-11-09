// Self-tests of the UI wave: station doors can be walked through, the top-centre HUD stack never overlaps, the HUD shows the body figure / sun dial / belt
// badges, a save round-trips (own slot: never touches the player's save), night silhouettes stay readable. Each test restores what it changes.
import { registerTest } from '../game/selftest';
import { G, toast } from '../game/state';
import { LOC } from '../game/locations';
import { sandbox, put } from '../game/testkit';
import { mat, W } from '../engine/grid';
import { capture, saveGame, peekSave, loadGame, deleteSave } from '../game/save';
import { getView } from '../engine/render';
import { wx, setDay } from '../game/weather';
import { MAT } from '../content/materials';
import { icon } from '../engine/sprites';
import { getItem } from '../game/items';
import { input } from '../engine/input';
import { setEnabled, touchEnabled } from './touch';
import { emit } from '../game/bus';
import { objectiveTarget } from '../game/quest';
import { resetHintsForTest } from './devhud';

registerTest('ui', 'двери дома и дизельной проходимы пешком (игрок 8×20)', async t => {
  const sc = t.sc;
  await sandbox(async () => {
    const F = LOC.station.y;
    const doors = G.fixtures.filter(f => f.kind === 'door');
    t.expect(doors.length >= 3, 'дверей: ' + doors.length);
    for (const d of doors) {
      const west = d.data?.side === 'west';
      t.expect(d.th >= 6, 'дверь ниже 6 тайлов: ' + d.th);
      const x0 = d.tx * 4 + (west ? -14 : 18);
      // the east door sits under the lee drift (DESIGN §13): the test is about the doorway, so the snow in front of it is dug out first (the sandbox restores it)
      if (!west) for (let y = F - 36; y < F; y++) for (let x = d.tx * 4 + 4; x < d.tx * 4 + 34; x++) { const m = mat[y * W + x]; if (m === MAT.SNOW || m === MAT.PACKED) put(x, y, MAT.AIR); }
      sc.teleport(x0, F); sc.stepFast(10);
      sc.act('interact', d.tx * 4 + 2, d.ty * 4 + 12);
      const startX = G.player.x;
      sc.key(west ? 'KeyD' : 'KeyA', true); sc.stepFast(100); sc.key(west ? 'KeyD' : 'KeyA', false);
      const passed = west ? G.player.x > d.tx * 4 + 3 : G.player.x < d.tx * 4 + 1;
      t.expect(passed, `не прошёл дверь x=${d.tx * 4} (${startX.toFixed(0)} -> ${G.player.x.toFixed(0)})`);
    }
  });
});

registerTest('ui', 'верхняя полоса HUD (цель, чип укрытия) и тосты не налезают друг на друга; на ПК тосты слева внизу, на телефоне над поясом', async t => {
  const sc = t.sc;
  const prev = G.shelter;
  G.shelter = { closed: true, tiles: 40, temp: -24, windIn: 0, vent: true, co: 8, stars: 2, notes: [] };
  toast('Белеет ноги: обморожение близко', 'warn'); toast('Тебя трясёт: пора греться', 'warn');
  sc.step(14); await t.wait(150);
  // the top stack holds the objective and the shelter chip; the toasts and the belt share the bottom stack (wave 5, devhud.ts .bot)
  const vis = (e: Element) => (e as HTMLElement).offsetParent !== null;
  const top = ([...document.querySelectorAll('#hud .stk > *')].flatMap(e => (e as HTMLElement).classList.contains('p') ? [e] : [...e.children]) as HTMLElement[]).filter(vis);
  const toasts = ([...document.querySelectorAll('#hud .tbox .toast')] as HTMLElement[]).filter(vis);
  const belt = document.querySelector('#hud .belt') as HTMLElement | null;
  t.expect(top.length >= 2, 'элементов в верхней полосе: ' + top.length);
  const touch = document.body.classList.contains('touch-ui');
  t.expect(toasts.length >= 1 && toasts.length <= (touch ? 2 : 3), 'тостов на экране: ' + toasts.length);
  const r = [...top, ...toasts, ...(belt ? [belt] : [])].map(k => k.getBoundingClientRect());
  for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
    const o = !(r[i].right <= r[j].left || r[j].right <= r[i].left || r[i].bottom <= r[j].top + 0.5 || r[j].bottom <= r[i].top + 0.5);
    t.expect(!o, `элементы ${i} и ${j} пересекаются`);
  }
  if (touch && belt && toasts.length) t.expect(toasts.every(x => x.getBoundingClientRect().bottom <= belt.getBoundingClientRect().top + 0.5), 'тост лежит на поясе');
  if (!touch) t.expect(toasts.every(x => x.getBoundingClientRect().left < innerWidth / 3 && x.getBoundingClientRect().bottom > innerHeight * 0.6), 'тост не в левом нижнем углу');
  G.shelter = prev; G.toasts.length = 0; sc.step(12);
});

registerTest('ui', 'HUD: фигура тела, солнечные часы, пояс со значками и счётчик в углу', async t => {
  const sc = t.sc;
  sc.give('snow_block', 40, 300); sc.step(14); await t.wait(100);
  t.expect(!!document.querySelector('#hud .bw canvas'), 'нет фигуры тела');
  t.expect(!!document.querySelector('#hud .dial canvas'), 'нет солнечных часов');
  t.expect(document.querySelectorAll('#hud .belt .sl img').length >= 2, 'в поясе нет значков');
  const badge = document.querySelector('#hud .belt .sl .n') as HTMLElement | null;
  if (badge) {
    const sl = badge.parentElement!.getBoundingClientRect(), b = badge.getBoundingClientRect();
    t.expect(b.top <= sl.top + 8 && b.right >= sl.right - 14, 'счётчик не в правом верхнем углу');
    const im = badge.parentElement!.querySelector('img')!.getBoundingClientRect();
    t.expect(b.bottom <= im.top + 6 || b.left >= im.right - 6 || b.right > im.right - 2, 'счётчик закрывает значок');
  }
  t.expect(getComputedStyle(document.getElementById('hud')!).fontFamily.length > 0, 'шрифт HUD');
});

registerTest('ui', 'значки радиодеталей и чая различаются', t => {
  const hash = (id: string) => { const c = icon(getItem(id).icon); const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i++) h = (h * 31 + d[i]) | 0; return h; };
  const ids = ['radio_triode', 'radio_coil', 'tea', 'hot_tea', 'fox_fur', 'sealskin', 'bear_fur', 'log', 'plank'];
  const hs = ids.map(hash);
  t.expect(new Set(hs).size === ids.length, 'одинаковые значки среди: ' + ids.join(','));
});

registerTest('ui', 'сохранение: мир, тело, предметы и расстановка переживают запись и чтение', async t => {
  const d = capture();
  let json = ''; try { json = JSON.stringify(d.state); } catch { /* cyclic */ }
  t.expect(json.length > 1000, 'состояние не сериализуется');
  const ok = await saveGame('selftest');
  t.expect(ok, 'запись не удалась (IndexedDB недоступна?)');
  if (!ok) return;
  const meta = await peekSave('selftest');
  t.expect(!!meta && meta.seed === G.seed && meta.v === 1, 'метаданные');
  const back = await loadGame('selftest');
  t.expect(!!back, 'чтение не удалось');
  if (back) {
    let diff = 0; for (let i = 0; i < mat.length; i += 7) if (back.grid.mat[i] !== mat[i]) diff++;
    t.expect(diff < 200, 'сетка отличается в ' + diff + ' ячейках (мир мог двигаться)');
    t.expect(back.state.fixtures.length === G.fixtures.length, 'предметов расстановки: ' + back.state.fixtures.length + ' vs ' + G.fixtures.length);
    t.expect(Math.abs(back.state.player.core - G.player.core) < 0.5, 'температура тела');
    t.metric('сохранение', JSON.stringify(d.state).length / 1024, 'КБ состояния');
  }
  await deleteSave('selftest');
});

registerTest('ui', 'ночью силуэт скалы читается на фоне неба (контраст края)', async t => {
  const sc = t.sc;
  await sandbox(async () => {
    setDay(6, 0); wx.override = { aurora: 0, snowfall: 0, storm: 0, visibility: 1, wind: 1 }; Object.assign(G, wx.override); G.moon = 0.05;
    // the highest exposed rock / dirt column of the cape
    let bx = -1, by = 9999;
    for (let x = 130; x < 250; x++) { let y = 60; while (y < 700 && mat[y * W + x] === MAT.AIR) y++; const m = mat[y * W + x]; if ((m === MAT.STONE || m === MAT.DIRT || m === MAT.HARDROCK) && y < by) { by = y; bx = x; } }
    if (bx < 0) { t.log('нет открытой скалы на мысе: проверка пропущена'); return; }
    sc.teleport(bx, by - 2); sc.step(6); sc.render(0);
    const v = getView(), cv = document.getElementById('world') as HTMLCanvasElement, c = cv.getContext('2d')!;
    const lum = (x: number, y: number) => { const p = c.getImageData(Math.max(0, Math.min(cv.width - 1, x - v.x0)), Math.max(0, Math.min(cv.height - 1, y - v.y0)), 1, 1).data; const f = (u: number) => { u /= 255; return u <= 0.03928 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4); }; return 0.2126 * f(p[0]) + 0.7152 * f(p[1]) + 0.0722 * f(p[2]); };
    const rock = lum(bx, by + 1), sky = Math.min(lum(bx + 30, by - 48), lum(bx + 60, by - 70));
    const ratio = (rock + 0.01) / (sky + 0.01);          // plain luminance ratio with a small floor (WCAG's 0.05 floor would make any night scene fail)
    t.metric('контраст края скалы к небу', ratio, '× (скала ' + rock.toFixed(3) + ', небо ' + sky.toFixed(3) + ', x=' + bx + ' y=' + by + ')');
    t.expect(ratio >= 3, 'край скалы почти сливается с небом: ' + ratio.toFixed(2));
    wx.override = null;
  });
});

// ---- playability wave (G5): hints, phone touch, toasts, sound hooks. Each test restores the touch / panel state it changes.
registerTest('ui', 'подсказки: внизу только «?»; полный список (за «?» и H) называет новые клавиши: ПКМ, P, Ctrl, Shift+ЛКМ, J, 1–6', async t => {
  resetHintsForTest(); t.sc.step(12); await t.wait(60);                 // the box is redrawn by the HUD tick
  const q = document.querySelector('#hud .hint .q') as HTMLElement | null;
  t.expect(!!q && q.textContent === '?', 'нет кнопки «?»');
  const full = document.querySelector('#hud .hfull') as HTMLElement | null;
  const all = full?.textContent ?? '';
  t.expect(!!full && /ПКМ/.test(all) && /P/.test(all) && /Ctrl/.test(all) && /Shift\+ЛКМ/.test(all) && /J/.test(all) && /1–6/.test(all), 'в полном списке нет новых клавиш: ' + all.slice(0, 120));
});

registerTest('ui', 'телефон: прицел касанием смещён вверх от пальца на 48 px', async t => {
  const sc = t.sc; const prevOn = touchEnabled(); const prevAim = [input.aimX, input.aimY];
  setEnabled(true);
  const stage = document.getElementById('stage') ?? document.body;
  const x = Math.round(window.innerWidth * 0.7), y = 200, id = 977;
  stage.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', pointerId: id, clientX: x, clientY: y, bubbles: true, isPrimary: true }));
  await t.frames(1);
  t.expect(input.aimX === x && input.aimY === y - 48, `прицел ${input.aimX},${input.aimY}, ждали ${x},${y - 48}`);
  stage.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', pointerId: id, clientX: x, clientY: y, bubbles: true, isPrimary: true }));
  setEnabled(prevOn); [input.aimX, input.aimY] = prevAim;
  void sc;
});

/** Shut whatever panel an earlier test left open (bag / container / journal) and wait until the HUD classes (`panel-open`, `bag-open`) are gone. */
async function closePanels(t: { sc: any; wait(ms: number): Promise<void> }) {
  for (let i = 0; i < 4; i++) {
    const pn = [...document.querySelectorAll('#hud .pnl')] as HTMLElement[];
    const bagOpen = pn.some(e => !e.classList.contains('jr') && e.style.display === 'block'), jrOpen = pn.some(e => e.classList.contains('jr') && e.style.display === 'block');
    if (!bagOpen && !jrOpen && !document.body.classList.contains('panel-open') && !document.body.classList.contains('bag-open')) return;
    if (bagOpen) input.craftPressed = true; else if (jrOpen) input.journalPressed = true;
    t.sc.step(6); await t.wait(180);
  }
}

registerTest('ui', 'телефон: все 6 слотов пояса видны, шрифт HUD 14 px, полоса цели не заходит на сумку', async t => {
  const sc = t.sc; const prevOn = touchEnabled();
  await closePanels(t);
  setEnabled(true); sc.step(14); await t.wait(80);
  const slots = [...document.querySelectorAll('#hud .belt .sl')] as HTMLElement[];
  t.expect(slots.length === 6 && slots.every(e => e.offsetParent !== null), 'видимых слотов пояса: ' + slots.filter(e => e.offsetParent !== null).length);
  const hud = document.getElementById('hud')!;
  t.expect(getComputedStyle(hud).fontSize === '14px', 'шрифт HUD: ' + getComputedStyle(hud).fontSize);
  const stk = document.querySelector('#hud .stk') as HTMLElement;
  t.expect(parseFloat(getComputedStyle(stk).right) >= 150, 'полоса цели не оставляет места верхнему ряду: right ' + getComputedStyle(stk).right);
  // nothing overlaps the objective strip: the body panel, the dial and the top-right touch buttons stay clear of it
  const box = (sel: string) => (document.querySelector(sel) as HTMLElement | null)?.getBoundingClientRect();
  const hit = (a?: DOMRect, b?: DOMRect) => !!a && !!b && a.width > 0 && b.width > 0 && !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
  const obj = box('#hud .stk .obj'), bw = box('#hud .bw'), dial = box('#hud .dial'), bag = box('#tb-bag'), jour = box('#tb-jour'), menu = box('#tb-menu');
  t.expect(!hit(obj, bw) && !hit(obj, dial), 'полоса цели налезает на тело или часы');
  t.expect(!hit(obj, bag) && !hit(obj, jour) && !hit(obj, menu), 'полоса цели налезает на кнопки Сумка/Журнал/⚙');
  t.expect(!hit(bw, dial), 'тело налезает на часы');
  setEnabled(prevOn);
});

registerTest('ui', 'телефон: при открытом журнале видны только Сумка, Журнал и ⚙; сумка занимает экран и закрывается своей кнопкой', async t => {
  const sc = t.sc; const prevOn = touchEnabled();
  await closePanels(t);
  setEnabled(true); sc.step(4);
  const disp = (id: string) => getComputedStyle(document.getElementById(id)!).display;
  const ghostHidden = () => { const ghost = document.querySelector('#touch .ghost') as HTMLElement | null; return !ghost || getComputedStyle(ghost).display === 'none'; };
  // the journal: the right-hand action buttons step aside, the three top buttons stay
  input.journalPressed = true; sc.step(6); await t.wait(60);
  t.expect(document.body.classList.contains('panel-open'), 'журнал не открылся');
  t.expect(disp('tb-act') === 'none' && disp('tb-jump') === 'none' && disp('tb-take') === 'none', 'кнопки действия не спрятаны под журналом');
  t.expect(disp('tb-bag') !== 'none' && disp('tb-jour') !== 'none' && disp('tb-menu') !== 'none', 'Сумка / Журнал / ⚙ пропали, body: ' + document.body.className);
  t.expect(disp('tb-parka') === 'none', 'Парка видна поверх журнала');
  t.expect(ghostHidden(), 'подсказка «тяни» видна поверх журнала');
  input.journalPressed = true; sc.step(6); await t.wait(60);
  // the bag (DESIGN §12) is a full-screen panel with its own «закрыть»: every touch button is hidden under it
  input.craftPressed = true; sc.step(6); await t.wait(60);
  t.expect(document.body.classList.contains('panel-open'), 'сумка не открылась');
  t.expect(disp('tb-act') === 'none' && disp('tb-jump') === 'none' && disp('tb-take') === 'none', 'кнопки действия не спрятаны под сумкой');
  t.expect(!!document.querySelector('#hud .pnl [data-act="close"]'), 'у сумки нет кнопки «закрыть»');
  t.expect(ghostHidden(), 'подсказка «тяни» видна поверх сумки');
  input.craftPressed = true; sc.step(6); await t.wait(60);
  setEnabled(prevOn);
});

registerTest('ui', 'тосты: до двух, предупреждения первыми, одинаковые тексты схлопнуты', async t => {
  const sc = t.sc; const prevOn = touchEnabled();
  setEnabled(false); G.toasts.length = 0;
  toast('инфо A', 'info'); toast('Предупреждение', 'warn'); toast('инфо B', 'info'); toast('инфо A', 'info'); toast('инфо C', 'info');
  sc.step(14); await t.wait(60);
  const shown = [...document.querySelectorAll('#hud .toast')].map(e => e.textContent);
  t.expect(shown.length === 3, 'тостов на экране: ' + shown.length + ' (' + shown.join(' | ') + ')');     // desktop: three at most
  t.expect(shown.includes('Предупреждение'), 'предупреждение вытеснено: ' + shown.join(' | '));
  t.expect(shown.filter(x => x === 'инфо A').length <= 1, 'дубль «инфо A» не схлопнут');
  G.toasts.length = 0; sc.step(6);
  setEnabled(prevOn);
});

registerTest('ui', 'звуковые подписки: вырезание, подбор и отказ не роняют игру', t => {
  emit('cut_block', { density: 300, cls: 'snow' }); emit('picked', { item: 'log', n: 1 }); emit('picked', { item: 'log', n: 1 }); emit('deny', {});
  t.expect(true, 'игра жива после событий');
});

registerTest('ui', 'стрелка к цели: видна у края, когда цель за кадром, с расстоянием в метрах', async t => {
  const sc = t.sc;
  const tgt = objectiveTarget();
  if (!tgt) { t.log('текущая цель без места на карте: проверка пропущена'); return; }
  const px = tgt.x < 1024 ? Math.min(tgt.x + 420, 2000) : Math.max(tgt.x - 420, 40);
  sc.teleport(px, 272); sc.step(14); await t.wait(60);
  const arrow = document.querySelector('#hud .arw') as HTMLElement;
  t.expect(getComputedStyle(arrow).display !== 'none', 'стрелка не показана, цель за кадром');
  t.expect(/\d+ м$/.test(arrow.textContent ?? ''), 'нет расстояния: ' + arrow.textContent);
});

registerTest('ui', '«Закрыть ящик» закрывает и панель, которую открыл сам ящик; сумка, открытая клавишей C, остаётся открытой', async t => {
  await sandbox(async () => {
    const sc = t.sc, bag = (window as unknown as { __bag: { search: { openContainer(f: unknown): void } } }).__bag;
    const chest = G.fixtures.find(f => f.kind === 'chest' && f.data?.look === 'shelf')!;
    const pnl = () => document.querySelector('#hud .pnl') as HTMLElement;
    const closeBox = () => { (document.querySelector('#hud .pnl [data-act="closebox"]') as HTMLElement).click(); sc.step(8); };
    sc.teleport(chest.tx * 4 - 6, 272); sc.step(10);
    bag.search.openContainer(chest); sc.step(10); await t.wait(150);
    t.expect(pnl().style.display === 'block', 'ящик не открыл панель');
    closeBox(); await t.wait(150);
    t.expect(pnl().style.display !== 'block', 'после «Закрыть ящик» панель осталась открытой');
    input.craftPressed = true; sc.step(8); await t.wait(100);                                  // the player opens the bag himself (C), then a box
    t.expect(pnl().style.display === 'block', 'C не открыла сумку');
    bag.search.openContainer(chest); sc.step(10); await t.wait(150);
    closeBox(); await t.wait(150);
    t.expect(pnl().style.display === 'block', 'сумка, открытая игроком, закрылась вместе с ящиком');
    input.craftPressed = true; sc.step(8); await t.wait(100);
    t.expect(pnl().style.display !== 'block', 'C не закрыла сумку');
  });
});
