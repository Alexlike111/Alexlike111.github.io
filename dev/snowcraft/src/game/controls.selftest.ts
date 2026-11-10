// Self-tests of the desktop controls (TERRARIA_CONTROLS): the right mouse button interacts (chest, stove) and only tamps snow with the shovel when nothing is
// in reach; Esc closes the open panels before it opens the inventory (I and C open it too); P pauses and opens the settings panel; a Left Ctrl tap toggles the
// smart cursor, Ctrl+wheel does not; loose items within the auto box are taken by walking over them (1.4 s for dropped ones, the weight limit, one
// «Слишком тяжело» per 5 s); a pickup shows one floater text per burst.
import { registerTest } from './selftest';
import type { TestCtx } from './selftest';
import { G } from './state';
import { W, aux, mat, TS } from '../engine/grid';
import { MAT } from '../content/materials';
import { add, count, weight, clearInventory, spawnDrop, thrown, armedThrown, WEIGHT_MAX } from './inventory';
import { placeFixture } from './fixtures';
import { arena, sandbox } from './testkit';
import { autoPickup, toolState } from './tools';
import { wx } from './weather';
import { isOpen, closeBox, searchSave, searchLoad } from './search';
import { loreSave, loreLoad } from './lore';
import { menuOpen, closeMenu } from '../ui/menu';
import { panelIsOpen } from '../ui/devhud';

const sc = () => (window as unknown as { __sc: any }).__sc;
const steps = (n: number) => sc().stepFast(n);
const S_HEAVY = 'Слишком тяжело';

/** Flat snow-free ground: the player stands at x=1000 on packed snow (chest at x≈992). */
function scene() {
  wx.override = { ambientT: -20, wind: 0, storm: 0, snowfall: 0 }; Object.assign(G, wx.override);
  arena(1000, 272, { dens: 300, loose: 0, depth: 40, up: 70 });
  const s = sc(); s.teleport(1000, 272);
  const p = G.player;
  p.core = 37; p.food = 90; p.water = 90; p.energy = 90; p.hp = 100; p.wet = 0; p.co = 0; p.frost.hands = p.frost.feet = p.frost.face = 0;
  p.alive = true; p.sleeping = false; p.shelter = 0; p.vx = 0; G.shelter = null;
  clearInventory();
  return p;
}
/** Close whatever a test left open: the panels, the settings menu, the pause. */
function clean() {
  const s = sc();
  if (menuOpen()) closeMenu();
  for (let i = 0; i < 3 && panelIsOpen(); i++) s.tap('Escape');
  if (panelIsOpen()) s.tap('KeyJ');                       // a journal that Esc did not shut
  if (panelIsOpen()) s.tap('KeyI');
  G.paused = false;
}
/** Scenario wrapper: a snapshot of the game, the container and lore state kept, the panels closed afterwards. */
async function run(fn: () => Promise<void> | void) {
  const saved = searchSave(), l0 = loreSave();
  try { await sandbox(fn); } finally { closeBox(); searchLoad(saved); loreLoad(l0); clean(); }
}
/** The right mouse button at a world point: aim, press (or release) like a real pointer. */
function rmb(x: number, y: number, down: boolean) {
  const s = sc();
  if (!down) { s.mouse(2, false); return; }                // a release keeps the aim where it was
  s.render(0);
  const [sx, sy] = s.worldToScreen(x, y);
  s.mouse(2, true, sx, sy);
}
/** Snow score of a box of cells: packed cells count 255, snow cells their compaction. Tamping raises it. */
function snowScore(x0: number, y0: number, x1: number, y1: number): number {
  let v = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const k = y * W + x; if (mat[k] === MAT.PACKED) v += 255; else if (mat[k] === MAT.SNOW) v += aux[k]; }
  return v;
}
const floaters = () => Array.from(document.querySelectorAll<HTMLElement>('#sc-floats .sc-float')).map(e => e.textContent ?? '');
const toastsWith = (text: string) => G.toasts.filter(t => t.text === text).length;

registerTest('controls', 'ПКМ открывает сундук (как E); Esc закрывает открытый контейнер', async (t: TestCtx) => {
  await run(async () => {
    scene();
    const chest = placeFixture('chest', 247, 66, { force: true, items: [{ id: 'coal', n: 3 }] })!;
    rmb(chest.tx * TS + 4, chest.ty * TS + 4, true); steps(3); rmb(0, 0, false); steps(2);
    await t.wait(80); steps(3);
    t.expect(isOpen(), 'ПКМ по сундуку не открыл контейнер');
    sc().tap('Escape'); steps(2);
    t.expect(!isOpen(), 'Esc не закрыл открытый сундук');
  });
});

registerTest('controls', 'ПКМ зажигает печку (как E); без топлива печка не горит', async (t: TestCtx) => {
  await run(async () => {
    scene(); add('matches', 2);
    const stove = placeFixture('stove', 253, 67, { force: true, fuel: 100, lit: false })!;
    rmb(stove.tx * TS + stove.tw * 2, stove.ty * TS + stove.th * 2, true); steps(3); rmb(0, 0, false); steps(2);
    t.expect(stove.lit === true, 'ПКМ по печке с топливом не зажёг её');
    const cold = placeFixture('stove', 245, 67, { force: true, fuel: 0, lit: false })!;
    rmb(cold.tx * TS + cold.tw * 2, cold.ty * TS + cold.th * 2, true); steps(3); rmb(0, 0, false); steps(2);
    t.expect(cold.lit !== true, 'печка без топлива загорелась сама');
  });
});

registerTest('controls', 'ПКМ по пустому снегу с лопатой утрамбовывает; ПКМ с целью в досягаемости не утрамбовывает', async (t: TestCtx) => {
  await run(async () => {
    scene(); arena(1000, 262, { dens: 300, loose: 14, depth: 40, up: 70 }); sc().teleport(1000, 262); clearInventory();
    add('shovel', 1); sc().selectItem('shovel');
    const x0 = 1002, x1 = 1012, y0 = 264, y1 = 271;
    const before = snowScore(x0, y0, x1, y1);
    rmb(1006, 268, true); steps(40); rmb(1006, 268, false); steps(2);
    const after = snowScore(x0, y0, x1, y1), tamped = after - before;
    t.expect(tamped > 1000, `ПКМ с лопатой на снегу не утрамбовал: ${before} → ${after}`);
    // a chest within reach: the same press interacts and the snow stays as it was
    clearInventory(); add('shovel', 1); sc().selectItem('shovel');
    const chest = placeFixture('chest', 247, 66, { force: true, items: [{ id: 'coal', n: 3 }] })!;
    const b2 = snowScore(x0, y0, x1, y1);
    rmb(1006, 268, true); steps(40); rmb(1006, 268, false); steps(2);
    // the sim itself drifts the snow a little; a tamp adds `tamped` (above), so the drift must be a small part of it
    const drift = snowScore(x0, y0, x1, y1) - b2;
    t.expect(drift < tamped / 4, `ПКМ при сундуке в досягаемости утрамбовал снег: дрейф ${drift} при утрамбовке ${tamped}`);
    t.expect(!!chest && isOpen(), 'ПКМ при сундуке в досягаемости не открыл его');
  });
});

registerTest('controls', 'Esc открывает инвентарь, второй Esc закрывает; I и C тоже открывают и закрывают', async (t: TestCtx) => {
  await run(async () => {
    scene(); clean();
    const s = sc();
    s.tap('Escape'); steps(2);
    t.expect(panelIsOpen(), 'Esc не открыл инвентарь');
    s.tap('Escape'); steps(2);
    t.expect(!panelIsOpen(), 'второй Esc не закрыл инвентарь');
    s.tap('KeyI'); steps(2); const i1 = panelIsOpen(); s.tap('KeyI'); steps(2);
    t.expect(i1 && !panelIsOpen(), 'I открывает и закрывает инвентарь');
    s.tap('KeyC'); steps(2); const c1 = panelIsOpen(); s.tap('KeyC'); steps(2);
    t.expect(c1 && !panelIsOpen(), 'C открывает и закрывает инвентарь');
  });
});

registerTest('controls', 'Esc сначала закрывает журнал, и инвентарь не открывается', async (t: TestCtx) => {
  await run(async () => {
    scene(); clean();
    const s = sc();
    s.tap('KeyJ'); steps(2);
    t.expect(panelIsOpen(), 'J не открыл журнал');
    s.tap('Escape'); steps(2);
    t.expect(!panelIsOpen(), 'Esc при открытом журнале не закрыл его (или открыл инвентарь поверх)');
  });
});

registerTest('controls', 'P ставит игру на паузу и открывает панель настроек; Esc закрывает панель и снимает паузу', async (t: TestCtx) => {
  await run(async () => {
    scene(); clean();
    const s = sc();
    s.tap('KeyP'); steps(2); await t.frames(3);
    t.expect(G.paused && menuOpen(), 'P не поставил паузу с панелью настроек');
    s.tap('Escape'); steps(2); await t.frames(3);
    t.expect(!menuOpen() && !G.paused, 'Esc не закрыл панель настроек и не снял паузу');
    s.tap('KeyP'); steps(2); await t.frames(3); s.tap('KeyP'); steps(2); await t.frames(3);
    t.expect(!G.paused && !menuOpen(), 'второй P не вернул игру');
  });
});

registerTest('controls', 'Левый Ctrl (тап) переключает умный курсор; Ctrl+колесо — нет (остаётся масштабом)', async (t: TestCtx) => {
  await run(async () => {
    scene(); clearInventory(); add('shovel', 1); sc().selectItem('shovel');
    const s = sc();
    const z0 = s.zoom.index();
    const m0 = toolState.smart;
    s.key('ControlLeft', true); steps(1); s.key('ControlLeft', false); steps(2);
    t.expect(toolState.smart !== m0, 'тап Ctrl не переключил умный курсор');
    const m1 = toolState.smart;
    s.key('ControlLeft', true);
    const el = document.getElementById('stage') ?? document.querySelector('canvas')!;
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true }));
    steps(1);
    s.key('ControlLeft', false); steps(2);
    t.expect(toolState.smart === m1, 'Ctrl+колесо переключило умный курсор');
    s.zoom.set(z0);
    // the R key still toggles it
    s.key('KeyR', true); steps(1); s.key('KeyR', false); steps(2);
    t.expect(toolState.smart !== m1, 'клавиша R перестала переключать умный курсор');
  });
});

registerTest('controls', 'автоподбор: уголь у ног берётся ходьбой, всплывает «+1 Уголь»', async (t: TestCtx) => {
  await run(async () => {
    const p = scene(); autoPickup.on = true;
    const d = spawnDrop('coal', 1, p.x + 3, p.y - 3, 0, 0, undefined, true)!; d.age = 2;
    steps(30);
    t.expect(count('coal') === 1 && !G.drops.includes(d), `уголь не подобран: ${count('coal')}`);
    await t.frames(2);
    t.expect(floaters().some(x => x === '+1 Уголь'), 'после подбора не показан «+1 Уголь»: ' + floaters().join('|'));
    t.expect(toastsWith('Взял: Уголь') === 0, 'старый текст «Взял» всё ещё выводится');
  });
});

registerTest('controls', 'несколько подборов подряд — один всплывающий текст (сумма)', async (t: TestCtx) => {
  await run(async () => {
    const p = scene(); autoPickup.on = true;
    await t.wait(1400);                                  // earlier floaters fade out first
    const a = spawnDrop('coal', 1, p.x + 2, p.y - 3, 0, 0, undefined, true)!; a.age = 2;
    const b = spawnDrop('coal', 1, p.x + 3, p.y - 3, 0, 0, undefined, true)!; b.age = 2;
    steps(20); await t.frames(2);
    t.expect(count('coal') === 2, 'два куска угля не подобраны');
    const f = floaters().filter(x => x.includes('Уголь'));
    t.expect(f.length === 1 && f[0] === '+2 Уголь', 'текстов не один: ' + JSON.stringify(f));
  });
});

registerTest('controls', 'брошенное (G) лежит 1,4 с, ходьба рядом его не берёт; отошёл и вернулся — подбирается', async (t: TestCtx) => {
  await run(async () => {
    const p = scene(); autoPickup.on = true;
    const d = spawnDrop('coal', 1, p.x + 1, p.y - 3, 0, 0, undefined, true)!; d.age = -1.4; thrown.add(d.id);
    steps(30);
    t.expect(G.drops.includes(d) && count('coal') === 0, 'брошенное взято раньше 1,4 с');
    steps(120);
    t.expect(G.drops.includes(d) && count('coal') === 0, 'брошенное взято само, пока игрок стоит рядом: ' + JSON.stringify([G.drops.includes(d), count('coal'), d.x, d.y, d.age, d.n, p.x, p.y]));
    p.x = 1040; steps(5);
    p.x = 1000; steps(30);
    t.expect(count('coal') === 1 && !G.drops.includes(d), `брошенное не взято, когда игрок вернулся после отхода: x ${d.x.toFixed(1)} y ${d.y.toFixed(1)} vs ${p.x.toFixed(1)} ${p.y.toFixed(1)}, age ${d.age.toFixed(2)}, armed ${armedThrown.has(d.id)}, drop in list ${G.drops.includes(d)}`);
  });
});

registerTest('controls', 'вес на пределе: не подбирается, один «Слишком тяжело» за 5 с', async (t: TestCtx) => {
  await run(async () => {
    const p = scene(); autoPickup.on = true;
    for (let k = 0; k < 400 && weight() < WEIGHT_MAX; k++) add('stone', 1);
    t.expect(weight() >= WEIGHT_MAX, 'не удалось набить рюкзак до предела: ' + weight().toFixed(1));
    const before = toastsWith(S_HEAVY);
    const d = spawnDrop('biscuit', 2, p.x + 2, p.y - 3, 0, 0, undefined, true)!; d.age = 2;
    steps(60);
    t.expect(G.drops.includes(d) && count('biscuit') === 0, 'сверх предела веса подобрано');
    t.expect(toastsWith(S_HEAVY) - before === 1, 'тост «Слишком тяжело» не один: ' + (toastsWith(S_HEAVY) - before));
    steps(60);
    t.expect(toastsWith(S_HEAVY) - before === 1, 'тост повторился раньше 5 с');
  });
});

registerTest('controls', 'авто-подбор не срабатывает в тестовой арене, пока его не включили', async (t: TestCtx) => {
  await run(async () => {
    const p = scene();                                    // arena() switched auto-pickup off
    t.expect(!autoPickup.on, 'арена не выключила автоподбор');
    const d = spawnDrop('coal', 1, p.x + 3, p.y - 3, 0, 0, undefined, true)!; d.age = 2;
    steps(30);
    t.expect(G.drops.includes(d) && count('coal') === 0, 'уголь подобран при выключенном автоподборе');
  });
});
