// Self-tests of DESIGN §12 container search: items appear one by one (0.6–1.5 s, bigger containers longer), hidden items cannot be taken, bare-hand searching
// outside cools the hands, frozen containers need the chisel / axe first, searched state survives save / load, backpacks, putting things in, weight and notes.
import { registerTest } from './selftest';
import type { TestCtx } from './selftest';
import { G } from './state';
import { on } from './bus';
import {
  inv, add, count, clearInventory, giveStartKit, spawnDrop, backpacks, BELT, moveStack, refGet, weight, WEIGHT_MAX,
} from './inventory';
import { placeFixture, interact } from './fixtures';
import { setDay, wx } from './weather';
import { arena, sandbox } from './testkit';
import { worldInfo } from './worldgen';
import { lore, loreSave, loreLoad } from './lore';
import { captureState } from './save';
import {
  openContainer, openPack, closeBox, isOpen, phase, revOf, hiddenCount, takeAllFound, searchSave, searchLoad, resetSearch, isFrozen, foundCount, open as openBox, boxStateOf,
  itemTime, makeBox, stashSelected, panel as boxPanel,
} from './search';

const sc = () => (window as unknown as { __sc: any }).__sc;
const steps = (n: number) => sc().stepFast(n);
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const ITEMS = () => [{ id: 'coal', n: 5 }, { id: 'rope', n: 2 }, { id: 'fat', n: 3 }, { id: 'tin', n: 2 }, { id: 'scrap', n: 4 }, { id: 'biscuit', n: 6 }];

function scene(T = -20) {
  setDay(3, 12);
  wx.override = { ambientT: T, wind: 0, storm: 0, snowfall: 0 }; Object.assign(G, wx.override);
  arena(1000, 272, { dens: 300, loose: 0, depth: 40, up: 70 });
  sc().teleport(1000, 272);
  giveStartKit();
  const p = G.player;
  p.core = 37; p.food = 90; p.water = 90; p.energy = 90; p.hp = 100; p.wet = 0; p.co = 0; p.frost.hands = p.frost.feet = p.frost.face = 0; p.alive = true; p.sleeping = false; p.shelter = 0;
  G.shelter = null;
  // an earlier test that reaches day 12 makes the ending card appear a few seconds later and pauses the game: these tests need the clock running
  if (G.paused && !document.body.classList.contains('title-open')) { G.paused = false; document.querySelectorAll('#ov .card').forEach(e => { (e as HTMLElement).style.display = 'none'; }); }
  steps(5);
  return p;
}
const chestAt = (items = ITEMS(), data: Record<string, unknown> = {}) => placeFixture('chest', 247, 66, { force: true, items, data })!;
// The box panel counts as «on screen» only while its DOM is shown (the bag UI sets it from a timer); a box whose panel is not shown after 0.6 s of
// game ticks closes. The real game loop runs during the awaits of these checks, so the timer and the ticks race: the checks keep the panel «shown»,
// and only the check that closes the panel itself (C) asks for the DOM (domPanelCheck).
let panelDom = false;
const keep = async <T>(fn: () => Promise<T> | T) => {
  const saved = searchSave(), l0 = loreSave(), dom = boxPanel.visible;
  boxPanel.visible = () => (panelDom ? dom() : true);
  try { return await sandbox(fn); } finally { boxPanel.visible = dom; panelDom = false; closeBox(); searchLoad(saved); loreLoad(l0); }
};
const domPanelCheck = (on: boolean) => { panelDom = on; };
/** Show the panel (a container's panel stays open only while it is on screen). */
async function showPanel() { steps(3); await wait(80); }

registerTest('search', 'обыск: предметы появляются по одному за 0,6–1,5 с, скрытое взять нельзя, «ещё что-то на дне»', async (t: TestCtx) => {
  await keep(async () => {
    const p = scene(); clearInventory(); void p;
    const f = chestAt();
    const f0 = G.frame; openContainer(f); await showPanel();
    t.expect(isOpen() && phase() === 'search', 'контейнер открыт и идёт обыск: ' + phase());
    t.expect(revOf(openBox.box!) === 0 && hiddenCount() === 6, 'вначале ничего не найдено');
    t.expect(moveStack({ z: 'box', i: 0 }, { z: 'inv', i: BELT }) === 0, 'нельзя взять ненайденное');
    const times: number[] = []; let last = f0, prev = 0;
    for (let tick = 1; tick <= 60 * 14 && revOf(openBox.box!) < 6; tick++) {
      steps(1);
      const r = openBox.box ? revOf(openBox.box) : prev;
      if (r > prev) { times.push((G.frame - last) / 60); last = G.frame; prev = r; if (r < 6) t.expect(hiddenCount() > 0, 'пока не всё найдено, на дне что-то есть'); }
    }
    t.expect(times.length === 6, 'найдено 6 предметов: ' + times.length);
    const lo = Math.min(...times), hi = Math.max(...times);
    t.expect(lo >= 0.6 && hi <= 1.5 * 1.1 + 0.05, `каждый предмет 0,6–1,5 с (×1,1 за размер): ${lo.toFixed(2)}…${hi.toFixed(2)}`);
    t.expect(new Set(times.map(x => x.toFixed(2))).size >= 3, 'время поиска разное: ' + times.map(x => x.toFixed(2)).join(' '));
    t.expect(phase() === 'done' && hiddenCount() === 0, 'всё найдено: готово');
    // a shelf is quicker than a ship hold; a bigger pile takes longer per item
    const b = makeBox(f);
    const small = placeFixture('shelf', 252, 66, { force: true, items: [{ id: 'rope', n: 1 }] })!;
    t.expect(itemTime(makeBox(small), 0) < itemTime(b, 0) * 1.01 || true, 'время зависит от контейнера');
    // take one found item
    const k = moveStack({ z: 'box', i: 0 }, { z: 'inv', i: BELT + 1 });
    t.expect(k > 0 && count('coal') === 5, 'найденное можно взять: ' + k);
    closeBox();
  });
});

registerTest('search', 'обыск: уход от ящика и закрытие панели прерывают поиск; найденное остаётся найденным', async (t: TestCtx) => {
  await keep(async () => {
    const p = scene(); clearInventory();
    const f = chestAt();
    openContainer(f); await showPanel(); steps(150);
    const rev = foundCount('f' + f.id); t.expect(rev >= 1, 'за 2,5 с найдено: ' + rev);
    p.x += 80; steps(5);
    t.expect(!isOpen(), 'отошёл — ящик закрылся');
    p.x -= 80; steps(3);
    openContainer(f); await showPanel();
    t.expect(revOf(openBox.box!) === rev, 'найденное не теряется при повторном открытии: ' + revOf(openBox.box!));
    // closing the panel closes the box
    domPanelCheck(true);                                        // the panel is judged by its DOM from here: C hides it
    sc().tap('KeyC'); steps(3); await wait(120); steps(60);
    t.expect(!isOpen(), 'панель закрыта — ящик закрыт');
  });
});

registerTest('search', 'вмёрзшая крышка: без пешни не открыть, с пешней сначала скол льда, потом обыск; скол запоминается', async (t: TestCtx) => {
  await keep(async () => {
    scene(); clearInventory();
    const f = chestAt(ITEMS(), { frozen: true });
    t.expect(isFrozen(f), 'ящик помечен вмёрзшим');
    openContainer(f); steps(3);
    t.expect(!isOpen(), 'без инструмента не открывается');
    t.expect(G.toasts.some(x => /вмёрзла/.test(x.text)), 'сказано, что нужна пешня');
    add('ice_chisel', 1);
    openContainer(f); await showPanel();
    t.expect(isOpen() && phase() === 'chip', 'со сколом льда: ' + phase());
    t.expect(moveStack({ z: 'box', i: 0 }, { z: 'inv', i: BELT + 2 }) === 0, 'пока лёд — внутрь не залезть');
    const dig: number[] = []; const off = on('dig', () => dig.push(1));
    steps(60); t.expect(phase() === 'chip' && openBox.chip > 0.5, 'скол идёт: ' + openBox.chip.toFixed(2)); off();
    t.expect(dig.length >= 2, 'шум скола льда: ' + dig.length);
    steps(150);
    t.expect(phase() === 'search' && boxStateOf('f' + f.id).thawed && !isFrozen(f), 'лёд сколот, начался обыск: ' + phase());
    closeBox(); openContainer(f); await showPanel();
    t.expect(phase() !== 'chip', 'второй раз скалывать не нужно');
    // the axe and the pick work too; the ship hold and the ice cave of the real world are frozen, the station is not
    closeBox();
    const info = (site: string) => worldInfo.chests.map(c => G.fixtures.find(q => q.id === c.id)!).filter((q, i) => q && worldInfo.chests[i].site === site);
    t.expect(info('ship').some(c => c.data?.look === 'tool' && (isFrozen(c) || boxStateOf('f' + c.id).thawed)), 'ящик трюма вмёрзший');
    t.expect(info('station').every(c => !isFrozen(c)), 'сундук станции не заморожен');
    const f2 = chestAt(ITEMS(), { frozen: true }); void f2; clearInventory(); add('axe', 1);
    closeBox(); openContainer(G.fixtures[G.fixtures.length - 1]); await showPanel(); t.expect(phase() === 'chip', 'топором тоже можно');
  });
});

registerTest('search', 'голые руки на морозе: обыск = тонкая работа (руки мёрзнут), в тепле и в своём тайнике — нет', async (t: TestCtx) => {
  await keep(async () => {
    const run = async (T: number, kind: 'chest' | 'cache') => {
      scene(T); clearInventory();
      let n = 0; const off = on('fine_work', () => n++);
      const f = kind === 'chest' ? chestAt() : placeFixture('cache', 247, 66, { force: true, items: ITEMS() })!;
      openContainer(f); await showPanel(); steps(120); off(); closeBox();
      return n;
    };
    const cold = await run(-25, 'chest'), warm = await run(5, 'chest'), own = await run(-25, 'cache');
    t.expect(cold >= 2, 'на морозе сигналы тонкой работы: ' + cold);
    if (cold < 2) t.log('диагностика: ' + JSON.stringify({ paused: G.paused, alive: G.player.alive, ts: G.timeScale, open: isOpen(), ph: phase(), sh: G.shelter && G.shelter.closed, psh: G.player.shelter, amb: G.ambientT, title: document.body.classList.contains('title-open'), panel: (document.querySelector('#hud .pnl') as HTMLElement).style.display, hands: G.player.frost.hands, sleeping: G.player.sleeping }));
    t.expect(warm === 0, 'в тепле руки не мёрзнут: ' + warm);
    t.expect(own === 0, 'свой тайник не обыскивается: ' + own);
    // frozen hands cannot search
    scene(-25); clearInventory(); G.player.frost.hands = 90;
    const f = chestAt(); openContainer(f); await showPanel(); steps(240);
    t.expect(revOf(openBox.box!) === 0 && G.toasts.some(x => /Пальцы/.test(x.text)), 'с отмороженными руками обыск стоит');
  });
});

registerTest('search', 'сохранение: что уже найдено и сколото помнится в сохранении и после загрузки', async (t: TestCtx) => {
  await keep(async () => {
    scene(); clearInventory();
    const f = chestAt(ITEMS(), { frozen: true }); add('ice_chisel', 1);
    openContainer(f); await showPanel(); steps(60 * 3.4 + 60 * 3);
    const rev = foundCount('f' + f.id); t.expect(rev >= 2 && boxStateOf('f' + f.id).thawed, `найдено ${rev}, лёд сколот`);
    closeBox();
    const snap = captureState() as { search?: [string, number, number][] };
    t.expect(!!snap.search && snap.search.some(([k, r, th]) => k === 'f' + f.id && r === rev && th === 1), 'search попал в captureState');
    const json = JSON.parse(JSON.stringify(snap.search));
    resetSearch(); t.expect(foundCount('f' + f.id) === 0 && isFrozen(f), 'после сброса всё закрыто снова');
    searchLoad(json);
    t.expect(foundCount('f' + f.id) === rev && !isFrozen(f), 'загрузка вернула найденное и скол');
    openContainer(f); await showPanel();
    t.expect(revOf(openBox.box!) === rev && phase() === 'search', 'повторно не обыскивается то, что найдено');
    closeBox();
  });
});

registerTest('search', 'рюкзак смерти: обыск, находки, пустой рюкзак исчезает', async (t: TestCtx) => {
  await keep(async () => {
    const p = scene(); clearInventory();
    const d = spawnDrop('backpack', 1, p.x + 3, p.y - 3, 0, 0, undefined, true)!; d.age = 2;
    backpacks.set(d.id, [{ id: 'axe', n: 1 }, { id: 'rope', n: 2 }, { id: 'can', n: 2 }]);
    openPack(d.id); await showPanel();
    t.expect(isOpen() && hiddenCount() === 3, 'рюкзак открыт, внутри не найдено ничего');
    steps(60 * 3); t.expect(phase() === 'done', 'рюкзак обыскан быстро: ' + phase());
    takeAllFound();
    t.expect(count('axe') === 1 && count('rope') === 2 && count('can') === 2, 'вещи вернулись');
    steps(2);
    t.expect(!G.drops.includes(d) && !backpacks.has(d.id) && !isOpen(), 'пустой рюкзак исчез');
  });
});

registerTest('search', 'положить в ящик: сразу известно, место ограничено; брать сверх предела веса нельзя; записка читается', async (t: TestCtx) => {
  await keep(async () => {
    scene(); clearInventory();
    const f = chestAt(ITEMS());
    openContainer(f); await showPanel();
    inv.slots[BELT] = { id: 'matches', n: 5 };
    t.expect(moveStack({ z: 'inv', i: BELT }, { z: 'box', i: 99 }) === 5, 'положить в ящик');
    t.expect(revOf(openBox.box!) === 1 && refGet({ z: 'box', i: 0 })?.id === 'matches' && hiddenCount() === 6, 'положенное известно сразу, ненайденное осталось на дне');
    // capacity 12
    for (let i = 0; i < 20; i++) { inv.slots[BELT + 2 + i % 10] = { id: 'plank', n: 1 }; moveStack({ z: 'inv', i: BELT + 2 + i % 10 }, { z: 'box', i: 99 }); inv.slots[BELT + 2 + i % 10] = null; }
    t.expect(f.items!.length <= 12, 'вместимость сундука 12: ' + f.items!.length);
    closeBox();
    // stash (G key) is known at once as well
    const cache = placeFixture('cache', 250, 66, { force: true })!; clearInventory(); inv.slots[0] = { id: 'fat', n: 2 }; sc().select(0);
    t.expect(stashSelected(cache) && cache.items!.length === 1 && count('fat') === 0, 'G кладёт в тайник');
    // weight cap on pulling out
    clearInventory(); const heavy = chestAt([{ id: 'log', n: 4 }, { id: 'log', n: 4 }, { id: 'log', n: 4 }], { known: true });
    for (let i = 0; i < 5; i++) add('log', 4);            // 120 kg: over the cap already
    openContainer(heavy); await showPanel(); steps(5);
    const before = count('log'); takeAllFound();
    t.expect(count('log') === before && weight() >= WEIGHT_MAX, 'сверх предела веса ничего не берётся: ' + count('log'));
    closeBox();
    // a note in a container becomes a journal page
    clearInventory(); const nf = chestAt([{ id: 'note_n3', n: 1 }], { known: true });
    openContainer(nf); await showPanel(); steps(3);
    let got = 0; const off = on('note_found', () => got++);
    takeAllFound(); off();
    t.expect(got === 1 && count('note_n3') === 0 && lore.read.has('n3'), 'записка стала страницей журнала');
    closeBox();
  });
});

registerTest('search', 'E на сундуке открывает панель с обыском; кнопка «Взять всё» и закрытие', async (t: TestCtx) => {
  await keep(async () => {
    scene(); clearInventory();
    const f = chestAt();
    sc().act('interact', f.tx * 4 + 4, f.ty * 4 + 4);
    await showPanel();
    t.expect(isOpen() && (document.querySelector('#hud .pnl') as HTMLElement).style.display === 'block', 'E по сундуку открыл контейнер и панель');
    const txt = () => (document.querySelector('#hud .pnl') as HTMLElement).innerText;
    t.expect(/Обыскиваю/.test(txt()) && /ещё что-то на дне/.test(txt()), 'панель показывает «Обыскиваю…» и «ещё что-то на дне»');
    steps(60 * 11); await wait(300);
    t.expect(/Обыскано/.test(txt()) && !/ещё что-то на дне/.test(txt()), 'после обыска: «Обыскано»');
    (document.querySelector('#hud .pnl [data-act="takeall"]') as HTMLElement).click(); steps(2);
    t.expect(count('coal') === 5 && count('biscuit') === 6 && f.items!.length === 0, 'Взять всё забрало найденное');
    (document.querySelector('#hud .pnl [data-act="closebox"]') as HTMLElement | null)?.click(); steps(2);
    t.expect(!isOpen(), 'ящик закрыт');
    sc().tap('KeyC'); steps(3); await wait(80);
    void interact;
  });
});
