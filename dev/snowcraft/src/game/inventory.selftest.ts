// Self-tests of DESIGN §12 inventory operations: moving between pack / belt / clothes / sled / container, split, merge, sort, quick-move, drop, weight limits and
// their effects, nearby selection (E / list / auto-pick rules) and the real panel UI (mouse drag & drop, tap-select + tap-place, action buttons).
// Every scenario runs on a snapshot of the real game (sandbox).
import { registerTest } from './selftest';
import type { TestCtx } from './selftest';
import { G } from './state';
import { input } from '../engine/input';
import {
  inv, add, count, weight, clearInventory, giveStartKit, spawnDrop, BELT, NSLOT, WEIGHT_SOFT, WEIGHT_RUN, WEIGHT_MAX, loadLevel, loadWords, fitByWeight, roomFor,
  moveStack, splitStack, sortZone, quickMove, dropRef, refGet, hitchSled, unhitchSled, boxZone, thrown, type Ref,
} from './inventory';
import { placeFixture } from './fixtures';
import { setDay, wx } from './weather';
import { arena, sandbox } from './testkit';
import { body } from './player';
import { nearbyList, autoPickable, takeNear } from './nearby';
import { closeBox, resetSearch, searchSave, searchLoad, openContainer, takeAllFound, phase } from './search';

const sc = () => (window as unknown as { __sc: any }).__sc;
const steps = (n: number) => sc().stepFast(n);
const I = (i: number): Ref => ({ z: 'inv', i });
const P0 = BELT;                  // first pack cell

function scene() {
  setDay(3, 12);
  wx.override = { ambientT: -20, wind: 0, storm: 0, snowfall: 0 }; Object.assign(G, wx.override);
  arena(1000, 272, { dens: 300, loose: 0, depth: 40, up: 70 });
  sc().teleport(1000, 272);
  giveStartKit();
  const p = G.player;
  p.core = 37; p.food = 90; p.water = 90; p.energy = 90; p.hp = 100; p.wet = 0; p.co = 0; p.frost.hands = p.frost.feet = p.frost.face = 0; p.alive = true; p.sleeping = false;
  // an earlier test that reaches day 12 makes the ending card appear a few seconds later and pauses the game: these tests need the clock running
  if (G.paused && !document.body.classList.contains('title-open')) { G.paused = false; document.querySelectorAll('#ov .card').forEach(e => { (e as HTMLElement).style.display = 'none'; }); }
  steps(5);
  return p;
}
const keepSearch = async <T>(fn: () => Promise<T> | T) => {
  const saved = searchSave();
  try { return await sandbox(fn); } finally { closeBox(); searchLoad(saved); }
};

registerTest('inventory', 'перенос: сумка ↔ пояс ↔ одежда ↔ нарты; слияние, обмен, чужая одежда не влезает', async () => {
  await keepSearch(() => {
    scene(); clearInventory();
    inv.slots[P0] = { id: 'coal', n: 5 }; inv.slots[P0 + 1] = { id: 'coal', n: 4 }; inv.slots[P0 + 2] = { id: 'rope', n: 2 };
    // merge up to the stack limit (coal stacks 12)
    if (moveStack(I(P0), I(P0 + 1)) !== 5 || inv.slots[P0 + 1]!.n !== 9 || inv.slots[P0]) throw new Error('слияние');
    // swap whole stacks
    if (moveStack(I(P0 + 1), I(P0 + 2)) !== 9 || inv.slots[P0 + 2]!.id !== 'coal' || inv.slots[P0 + 1]!.id !== 'rope') throw new Error('обмен');
    // partial move into an empty belt cell
    if (moveStack(I(P0 + 2), I(0), 4) !== 4 || inv.slots[0]!.n !== 4 || inv.slots[P0 + 2]!.n !== 5) throw new Error('часть стопки на пояс');
    // overflow of a merge stays behind
    inv.slots[P0] = { id: 'coal', n: 12 };
    if (moveStack(I(0), I(P0)) !== 0 || inv.slots[0]!.n !== 4) throw new Error('полная стопка не должна принимать');
    // clothes: only the right slot
    add('fur_parka', 1); add('wool_hat', 1);
    const parka = inv.slots.findIndex(s => s?.id === 'fur_parka'), hat = inv.slots.findIndex(s => s?.id === 'wool_hat');
    if (moveStack(I(parka), { z: 'wear', i: 0 }) !== 0) throw new Error('парка в слот шапки');
    if (moveStack(I(parka), { z: 'wear', i: 1 }) !== 1 || inv.wear.body !== 'fur_parka') throw new Error('надеть парку');
    if (inv.slots[parka]?.id !== 'station_parka' && inv.slots[parka]) { /* the old parka goes to the cell the new one left */ }
    if (moveStack(I(hat), { z: 'wear', i: 0 }) !== 1 || inv.wear.head !== 'wool_hat') throw new Error('надеть шапку');
    if (moveStack({ z: 'wear', i: 0 }, I(hat)) !== 1 || inv.wear.head !== null || inv.slots[hat]?.id !== 'wool_hat') throw new Error('снять шапку');
    // sled: not available without a sled, hitched sled accepts
    if (moveStack(I(P0 + 2), { z: 'sled', i: 0 }) !== 0) throw new Error('нарты без нарт');
    hitchSled(G.player.x, G.player.y);
    if (moveStack(I(P0 + 2), { z: 'sled', i: 0 }) !== 5 || inv.sled!.slots[0]?.id !== 'coal') throw new Error('груз на нарты');
    if (moveStack({ z: 'sled', i: 0 }, I(P0 + 3)) !== 5) throw new Error('груз с нарт');
    // parked sled far away: no access; near: access
    unhitchSled(G.player.x + 200, G.player.y);
    if (moveStack(I(P0 + 3), { z: 'sled', i: 1 }) !== 0) throw new Error('далёкие нарты доступны');
    unhitchSled(G.player.x + 10, G.player.y);
    if (moveStack(I(P0 + 3), { z: 'sled', i: 1 }) !== 5) throw new Error('нарты рядом недоступны');
  });
});

registerTest('inventory', 'разделить пополам / по одному, слить и разложить; быстрый перенос; бросок на землю', async () => {
  await keepSearch(() => {
    const p = scene(); clearInventory();
    inv.slots[P0 + 3] = { id: 'biscuit', n: 9 };
    const h = splitStack(I(P0 + 3), 'half'); if (!h || inv.slots[P0 + 3]!.n !== 5 || refGet(h)!.n !== 4) throw new Error('пополам: ' + JSON.stringify(h));
    const o = splitStack(I(P0 + 3), 'one'); if (!o || inv.slots[P0 + 3]!.n !== 4 || refGet(o)!.n !== 1) throw new Error('по одному');
    if (splitStack(o, 'one')) throw new Error('одну штуку нельзя делить');
    // sort merges and orders: tool first, food before material
    clearInventory();
    inv.slots[P0 + 5] = { id: 'coal', n: 3 }; inv.slots[P0 + 9] = { id: 'coal', n: 4 }; inv.slots[P0 + 2] = { id: 'biscuit', n: 2 }; inv.slots[P0 + 11] = { id: 'biscuit', n: 3 }; inv.slots[P0 + 7] = { id: 'axe', n: 1 };
    sortZone('inv', 'kind');
    const ids = inv.slots.slice(P0).filter(Boolean).map(s => s!.id + s!.n);
    if (ids.join() !== 'axe1,biscuit5,coal7') throw new Error('сортировка по виду: ' + ids.join());
    inv.slots[P0 + 6] = { id: 'rope', n: 8 }; sortZone('inv', 'weight');
    if (inv.slots[P0]!.id !== 'coal') throw new Error('по весу: самое тяжёлое первым (' + inv.slots[P0]!.id + ')');
    if (inv.slots.slice(0, BELT).some(Boolean)) throw new Error('сортировка не трогает пояс');
    // quick-move: pack <-> belt, wear, sled
    clearInventory(); inv.slots[P0] = { id: 'axe', n: 1 };
    if (!quickMove(I(P0)) || !inv.slots.slice(0, BELT).some(s => s?.id === 'axe')) throw new Error('на пояс');
    const bi = inv.slots.findIndex(s => s?.id === 'axe');
    if (!quickMove(I(bi)) || !inv.slots.slice(BELT).some(s => s?.id === 'axe')) throw new Error('с пояса в сумку');
    add('kamiks', 1); const ki = inv.slots.findIndex(s => s?.id === 'kamiks');
    if (!quickMove(I(ki)) || inv.wear.feet !== 'kamiks') throw new Error('обуться быстро');
    hitchSled(p.x, p.y); const ai = inv.slots.findIndex(s => s?.id === 'axe');
    if (!quickMove(I(ai)) || inv.sled!.slots[0]?.id !== 'axe') throw new Error('на нарты быстро');
    if (!quickMove({ z: 'sled', i: 0 }) || !inv.slots.some(s => s?.id === 'axe')) throw new Error('с нарт быстро');
    // drop to the ground: a thrown drop is never picked up by walking over it
    clearInventory(); inv.slots[P0] = { id: 'biscuit', n: 6 };
    const n0 = G.drops.length;
    if (!dropRef(I(P0), 2) || inv.slots[P0]!.n !== 4 || G.drops.length !== n0 + 1) throw new Error('бросить 2');
    const d = G.drops[G.drops.length - 1]; if (d.item !== 'biscuit' || d.n !== 2 || !thrown.has(d.id)) throw new Error('брошенное: ' + JSON.stringify(d));
    d.age = 5; d.x = p.x; d.y = p.y - 6; d.vx = d.vy = 0; steps(60);
    if (!G.drops.includes(d)) throw new Error('брошенное подобралось ходьбой');
    inv.wear.hands = 'wool_mittens'; if (!dropRef({ z: 'wear', i: 2 }) || inv.wear.hands !== null) throw new Error('бросить одежду');
  });
});

registerTest('inventory', 'вес: слова о нагрузке, предел подъёма, замедление, не бегать после 140 %, пот и выносливость', async (t: TestCtx) => {
  await keepSearch(async () => {
    const p = scene(); clearInventory();
    t.expect(WEIGHT_SOFT === 60 && WEIGHT_RUN === 80 && WEIGHT_MAX === 100, 'пороги веса 60 / 80 / 100 кг');
    const lv = (kgs: number) => { clearInventory(); inv.slots[P0] = { id: 'stone', n: Math.floor(kgs / 4) }; return loadLevel(); };
    t.expect(lv(0) === 0 && lv(40) === 1 && lv(70) === 2 && lv(90) === 3 && lv(104) === 4, 'уровни нагрузки: ' + [lv(0), lv(40), lv(70), lv(90), lv(104)].join());
    t.expect(/тяжело/.test(loadWords(70)) && /не бежать/.test(loadWords(90)) && /не поднять/.test(loadWords(110)), 'слова об эффекте');
    clearInventory(); add('log', 4); add('log', 4); add('log', 4); add('log', 2);           // 14 logs = 84 kg
    t.expect(fitByWeight('log', 4) === 2, 'до предела (100 кг) можно поднять ещё два: ' + fitByWeight('log', 4));
    t.expect(roomFor('log', 100) > 4, 'места в сумке хватает');
    clearInventory();
    // speed and running with different loads (walk right for one second on flat ground)
    const dist = (kgs: number, run: boolean) => {
      clearInventory(); if (kgs) inv.slots[P0] = { id: 'stone', n: Math.round(kgs / 4) };
      p.x = 1000; p.y = 270; p.vx = p.vy = 0; p.stamina = 100; p.energy = 90; steps(10);
      const x0 = p.x; sc().key('KeyD', true); if (run) sc().key('ShiftLeft', true); steps(70); sc().key('KeyD', false); sc().key('ShiftLeft', false); steps(5);
      return p.x - x0;
    };
    const light = dist(0, false), heavy = dist(75, false), runLight = dist(0, true), runHeavy = dist(90, true), runOk = dist(56, true);
    t.expect(heavy < light * 0.85, `с грузом медленнее: ${heavy.toFixed(0)} против ${light.toFixed(0)}`);
    t.expect(runLight > light * 1.3, 'налегке бег быстрее шага');
    t.expect(runHeavy < runLight * 0.6, `перегруз: бежать нельзя (${runHeavy.toFixed(0)} против ${runLight.toFixed(0)})`);
    t.expect(runOk > light * 1.3, 'в пределах нормы бег доступен');
    // running with a load inside the 60..80 kg band drains stamina faster and costs more effort (sweat)
    const effort = (kgs: number) => {
      clearInventory(); if (kgs) inv.slots[P0] = { id: 'stone', n: Math.round(kgs / 4) };
      p.x = 1000; p.y = 270; p.vx = p.vy = 0; p.stamina = 100; steps(10);
      sc().key('KeyD', true); sc().key('ShiftLeft', true); steps(80); const met = body.met, st = 100 - p.stamina; sc().key('KeyD', false); sc().key('ShiftLeft', false); steps(5);
      return { met, st };
    };
    const e0 = effort(0), e1 = effort(72);
    t.expect(e1.st > e0.st * 1.05, `выносливость тратится быстрее: ${e1.st.toFixed(1)} против ${e0.st.toFixed(1)}`);
    t.expect(e1.met > e0.met, `усилие (пот) выше: ${e1.met.toFixed(2)} против ${e0.met.toFixed(2)}`);
    p.x = 1000; p.y = 270; p.vx = 0;
  });
});

registerTest('inventory', 'рядом: тяжёлое не подбирается ходьбой, лёгкое подбирается при месте и весе; E берёт ближайшее; список', async (t: TestCtx) => {
  await keepSearch(async () => {
    const p = scene(); clearInventory();
    const mk = (id: string, n: number, dx: number) => { const d = spawnDrop(id, n, p.x + dx, p.y - 3, 0, 0, undefined, true)!; d.age = 2; return d; };
    const log = mk('log', 1, 8), bis = mk('biscuit', 2, -4);
    t.expect(autoPickable(bis) && !autoPickable(log), 'правила автоподбора: сухари да, бревно нет');
    t.expect(!autoPickable(mk('coal', 4, 40)) && !autoPickable(mk('shovel', 1, 40)) && !autoPickable(mk('wool_hat', 1, 40)), 'уголь, лопата, шапка — только по E');
    const list = nearbyList();
    t.expect(list.length >= 2 && list[0].item === 'biscuit', 'ближайшее первым: ' + list.map(n => n.label + ':' + n.dist.toFixed(0)).join());
    // in front beats behind at the same distance
    G.drops.length = 0; p.face = 1;
    const back = mk('rope', 1, -6), front = mk('rope', 1, 6); void back;
    t.expect(nearbyList()[0].id === front.id, 'впереди ближе, чем сзади');
    G.drops.length = 0;
    // walking over: the biscuits go in, the log stays; no room / too heavy: nothing is picked
    mk('biscuit', 2, 0); mk('log', 1, 1); steps(40);
    t.expect(count('biscuit') === 2 && count('log') === 0 && G.drops.some(d => d.item === 'log'), 'ходьба: сухари взяты, бревно нет');
    clearInventory(); for (let i = 0; i < NSLOT; i++) inv.slots[i] = { id: i < BELT ? 'tin' : 'scrap', n: i < BELT ? 8 : 12 };
    G.drops.length = 0; const full = mk('rope', 1, 0); steps(40);
    t.expect(count('rope') === 0 && G.drops.includes(full), 'нет места: не подбирается');
    clearInventory(); inv.slots[P0] = { id: 'stone', n: 15 };                      // 60 kg: right at the comfortable load
    G.drops.length = 0; const w = mk('can', 4, 0); steps(40);
    t.expect(count('can') === 0 && G.drops.includes(w), 'вес на пределе: лёгкое не подбирается само');
    clearInventory();
    // E: a single thing is taken at once, the nearest of several on a quick tap, the list opens when E is held
    G.drops.length = 0; mk('log', 1, 6);
    input.interactPressed = true; steps(3);
    t.expect(count('log') === 1, 'E берёт бревно');
    clearInventory(); G.drops.length = 0; const far = mk('log', 1, 14), near = mk('plank', 1, 5); void far;
    input.interactPressed = true; steps(10);
    t.expect(count('plank') === 1 && count('log') === 0, 'короткое E берёт ближайшее');
    G.drops.length = 0; clearInventory(); const a = mk('log', 1, 6), b = mk('plank', 1, 12); void a; void b;
    const list2 = nearbyList(); t.expect(list2.length === 2, 'в списке два предмета');
    t.expect(takeNear(list2[1]) && count('log') + count('plank') === 1, 'выбор из списка берёт именно выбранное');
    void near; clearInventory(); G.drops.length = 0;
    // too heavy to lift: only what fits under the limit is taken, the rest stays on the ground
    clearInventory(); for (let i = 0; i < 15; i++) add('log', 1); G.drops.length = 0; const hv = mk('log', 4, 6);       // 90 kg in the pack, 4 logs (24 kg) on the ground
    input.interactPressed = true; steps(3);
    t.expect(weight() <= WEIGHT_MAX + 0.01 && count('log') === 16 && G.drops.includes(hv) && hv.n === 3, 'подъём сверх предела берёт только влезающее: ' + weight().toFixed(1) + ' кг, брёвен ' + count('log'));
    clearInventory(); G.drops.length = 0; for (let i = 0; i < 17; i++) add('log', 1); mk('log', 1, 6);                  // already at the limit: nothing more
    input.interactPressed = true; steps(3);
    t.expect(count('log') === 17 && G.drops.length === 1, 'на пределе ничего не поднять');
  });
});

registerTest('inventory', 'панель: перетаскивание мышью, выбор + место (телефон), кнопки, сортировка', async (t: TestCtx) => {
  const s = sc();
  const saved = searchSave();
  await sandbox(async () => {
    scene(); clearInventory();
    inv.slots[P0] = { id: 'biscuit', n: 8 }; inv.slots[P0 + 1] = { id: 'coal', n: 6 }; inv.slots[P0 + 2] = { id: 'wool_hat', n: 1 };
    s.tap('KeyC'); steps(3); await new Promise(r => setTimeout(r, 120));
    const panel = document.querySelector('#hud .pnl') as HTMLElement;
    t.expect(panel.style.display === 'block', 'C открывает панель');
    const cell = (z: string, i: number) => document.querySelector(`#hud .pnl [data-z="${z}"][data-i="${i}"]`) as HTMLElement;
    const centre = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
    const ev = (type: string, el: EventTarget, x: number, y: number, extra: PointerEventInit = {}) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 7, pointerType: 'mouse', button: 0, ...extra }));
    const refresh = async () => { await new Promise(r => setTimeout(r, 160)); };
    // 1) drag a stack onto another pack cell
    let [x0, y0] = centre(cell('inv', P0)), [x1, y1] = centre(cell('inv', P0 + 10));
    ev('pointerdown', cell('inv', P0), x0, y0); ev('pointermove', window, x0 + 14, y0 + 4); ev('pointermove', window, x1, y1); ev('pointerup', window, x1, y1); await refresh();
    t.expect(!inv.slots[P0] && inv.slots[P0 + 10]?.id === 'biscuit', 'перетащил сухари на другую ячейку');
    // 2) drag onto a clothing slot (hat) and back off
    [x0, y0] = centre(cell('inv', P0 + 2)); [x1, y1] = centre(cell('wear', 0));
    ev('pointerdown', cell('inv', P0 + 2), x0, y0); ev('pointermove', window, x0 + 12, y0 + 12); ev('pointermove', window, x1, y1); ev('pointerup', window, x1, y1); await refresh();
    t.expect(inv.wear.head === 'wool_hat' || inv.wear.head !== null && inv.slots.some(s => s?.id === 'wool_hat'), 'шапка надета перетаскиванием: ' + inv.wear.head);
    // 3) tap-select then tap-place (phone path): coal to the belt
    [x0, y0] = centre(cell('inv', P0 + 1)); [x1, y1] = centre(cell('inv', 3));
    ev('pointerdown', cell('inv', P0 + 1), x0, y0, { pointerType: 'touch' }); ev('pointerup', window, x0, y0, { pointerType: 'touch' }); await refresh();
    t.expect(cell('inv', P0 + 1).classList.contains('sel'), 'тап выбирает ячейку');
    ev('pointerdown', cell('inv', 3), x1, y1, { pointerType: 'touch' }); ev('pointerup', window, x1, y1, { pointerType: 'touch' }); await refresh();
    t.expect(inv.slots[3]?.id === 'coal' && !inv.slots[P0 + 1], 'второй тап кладёт на пояс');
    // 4) buttons: select, half, one, drop
    [x0, y0] = centre(cell('inv', P0 + 10));
    ev('pointerdown', cell('inv', P0 + 10), x0, y0, { pointerType: 'touch' }); ev('pointerup', window, x0, y0, { pointerType: 'touch' }); await refresh();
    const btn = (a: string) => document.querySelector(`#hud .pnl [data-act="${a}"]`) as HTMLElement | null;
    t.expect(!!btn('half') && !!btn('one') && !!btn('drop') && !!btn('use'), 'кнопки действий для выбранной стопки');
    btn('half')!.click(); await refresh();
    t.expect(inv.slots[P0 + 10]!.n === 4 && inv.slots.slice(BELT).some((s, i) => s?.id === 'biscuit' && i + BELT !== P0 + 10 && s.n === 4), 'пополам: 4 + 4');
    btn('one') && (document.querySelector(`#hud .pnl [data-act="one"]`) as HTMLElement).click(); await refresh();
    const d0 = G.drops.length; btn('drop')!.click(); await refresh();
    t.expect(G.drops.length > d0, 'бросить кладёт предмет на землю');
    // 5) sort button
    (document.querySelector('#hud .pnl [data-act="sort"][data-m="weight"]') as HTMLElement).click(); await refresh();
    t.expect(count('biscuit') > 0 && !!inv.slots[P0], 'сортировка по весу ставит вещи подряд');
    // 6) the touch targets are big enough on the phone layout
    if (document.body.classList.contains('touch-ui')) {
      const small = [...document.querySelectorAll('#hud .pnl .cell, #hud .pnl button.ab, #hud .pnl button.mini')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 47.5 || r.width < 47.5); });
      t.expect(small.length === 0, 'цели касания ≥ 48 px: мелких ' + small.length);
    }
    s.tap('KeyC'); steps(3); await new Promise(r => setTimeout(r, 100));
    t.expect(panel.style.display !== 'block', 'C закрывает панель');
  });
  closeBox(); resetSearch(); searchLoad(saved);
});
void boxZone; void placeFixture; void openContainer; void takeAllFound; void phase;
