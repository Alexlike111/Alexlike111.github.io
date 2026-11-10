// Self-tests of the usable-item framework and group 1 (DESIGN §17).
import { registerTest } from './selftest';
import { G } from './state';
import { on } from './bus';
import { add, clearInventory, inv, count, weight, weightMax, loadLevel, select, selectStep, slotUsable, moveStack, NSLOT, TOTAL, BELT, giveStartKit } from './inventory';
import { registerUse, useSlot, useState, stepUseItems, usable, sget } from './useitems';
import { mods } from './usemods';
import { body } from './player';
import { RECIPES, craft } from './recipes';
import { learnAll } from './lore';
import { worldInfo } from './locations';
import { eatSlot } from './player';
import { overload } from './inventory';
import { hasIcon } from '../art/icons';
import './items';
import { sandbox } from './testkit';
import { def } from './itemreg';
import { journal } from './quest';
import { MIN_PER_SEC } from './weather';

registerTest('useitems', 'каркас: use() срабатывает, событие use_item, подсказка один раз, состояние в сохраняемом объекте', async () => {
  await sandbox(() => {
    def('zz_test', 'Тест-предмет', 'tool', 0.1, 1, { quick: true });
    const cnt = { n: 0, ticks: 0 }; const getN = () => cnt.n;
    registerUse('zz_test', { use() { cnt.n++; }, tick() { cnt.ticks++; }, tip: 'Тестовая подсказка', label: 'Тест' });
    if (!usable('zz_test')) throw new Error('не usable');
    clearInventory(); add('zz_test', 1);
    if (inv.slots[0]?.id !== 'zz_test') throw new Error('usable-предмет должен лечь на пояс');
    let ev = 0; const off = on('use_item', (d: { id: string }) => { if (d.id === 'zz_test') ev++; });
    const j0 = journal.length;
    if (!useSlot(0) || getN() !== 1 || ev !== 1) throw new Error('use / событие: ' + cnt.n + '/' + ev);
    stepUseItems(1);
    if (!useSlot(0) || getN() !== 2) throw new Error('второй use');
    if (cnt.ticks < 1) throw new Error('tick не вызван');
    off();
    if (useState().hints.filter(h => h === 'zz_test').length !== 1) throw new Error('подсказка должна быть записана один раз');
    if (journal.length - j0 > 1) throw new Error('в журнал не больше одной строки: ' + (journal.length - j0));
    const st = JSON.parse(JSON.stringify(useState())); if (!st.hints.includes('zz_test')) throw new Error('состояние не сериализуется');
    useState().d.zz = 5; if (JSON.parse(JSON.stringify(G.player ? useState() : {})).d.zz !== 5) throw new Error('d');
    void count;
  });
});

const P = () => G.player;
/** A lit campfire right next to the player (restored by sandbox()). */
function fireHere() {
  const p = P();
  G.fixtures.push({ id: 90001, kind: 'campfire', tx: Math.floor(p.x / 4) + 2, ty: Math.floor(p.y / 4) - 1, tw: 2, th: 1, lit: true, fuel: 100 } as never);
}
const resetP = () => { const p = P(); p.core = 37; p.water = 50; p.wet = 0; p.frost.hands = p.frost.feet = p.frost.face = 0; p.shelter = 0; p.airT = -20; G.timeScale = 1; useState().d = {}; };

registerTest('useitems', 'термос: налить у огня, три глотка греют и поят, через ~6 ч остывает', async () => {
  await sandbox(() => {
    clearInventory(); resetP(); fireHere(); add('thermos', 1); add('water', 3);
    const i = inv.slots.findIndex(s => s?.id === 'thermos');
    if (i < 0 || i >= BELT) throw new Error('термос должен лечь на пояс: ' + i);
    if (!useSlot(i) || Math.floor((inv.slots[i]!.dur ?? 0) / 1000) !== 3 || count('water') !== 0) throw new Error('налить: ' + JSON.stringify(inv.slots[i]));
    stepUseItems(1);
    const w0 = P().water, c0 = P().core = 36;
    stepUseItems(1); if (!useSlot(i)) throw new Error('глоток');
    if (P().water <= w0) throw new Error('глоток должен поить');
    for (let k = 0; k < 70; k++) stepUseItems(1);
    if (P().core < c0 + 0.25) throw new Error('горячий глоток должен греть: ' + P().core);
    stepUseItems(1); useSlot(i); stepUseItems(1); useSlot(i);
    if (Math.floor((inv.slots[i]!.dur ?? 0) / 1000) !== 0) throw new Error('три глотка: ' + inv.slots[i]!.dur);
    // heat runs out: refill, wait 6+ game hours
    add('water', 2); stepUseItems(1); useSlot(i); useSlot(i);
    inv.slots[i]!.dur = 2 * 1000 + 360;
    for (let k = 0; k < Math.ceil(360 / MIN_PER_SEC) + 5; k++) stepUseItems(1);      // 360 game minutes of heat (the clock runs MIN_PER_SEC per second)
    if ((inv.slots[i]!.dur ?? 0) % 1000 > 0) throw new Error('термос должен остыть за 6 ч: ' + inv.slots[i]!.dur);
    const c1 = P().core; sget('thPool'); stepUseItems(1); useSlot(i); for (let k = 0; k < 70; k++) stepUseItems(1);
    if (P().core > c1 + 0.05) throw new Error('остывший не греет');
  });
});

registerTest('useitems', 'фляга: замерзает на поясе при -25, под паркой (в сумке) нет; оттаивает у огня; мёрзлую не выпить', async () => {
  await sandbox(() => {
    clearInventory(); resetP(); add('flask', 1, 3);
    const i = inv.slots.findIndex(s => s?.id === 'flask'); if (i >= BELT) throw new Error('фляга на пояс');
    P().airT = -25; P().water = 20;
    for (let k = 0; k < 120; k++) stepUseItems(10);                      // 20 min
    if ((inv.slots[i]!.dur ?? 0) >= 50) throw new Error('до ~25 минут не должна замерзать');
    for (let k = 0; k < 60; k++) stepUseItems(10);
    if ((inv.slots[i]!.dur ?? 0) < 50) throw new Error('на поясе при -25 за ~25 мин должна замёрзнуть: ' + inv.slots[i]!.dur);
    if (eatSlot(i)) throw new Error('мёрзлую воду пить нельзя');
    fireHere(); for (let k = 0; k < 6; k++) stepUseItems(5);
    if ((inv.slots[i]!.dur ?? 0) >= 50) throw new Error('у огня должна оттаять');
    // in the bag it never freezes
    resetP(); P().airT = -25; inv.slots[i] = null; inv.slots[BELT + 2] = { id: 'flask', n: 1, dur: 3 };
    for (let k = 0; k < 400; k++) stepUseItems(10);
    if ((inv.slots[BELT + 2]!.dur ?? 0) >= 50) throw new Error('под паркой (в сумке) не замерзает');
  });
});

registerTest('useitems', 'грелка: нужен уголь и огонь, потом режет рост обморожения рук и выгорает', async () => {
  await sandbox(() => {
    clearInventory(); resetP(); add('hand_warmer', 1); add('coal', 2);
    const i = inv.slots.findIndex(s => s?.id === 'hand_warmer');
    if (useSlot(i)) throw new Error('без огня не разжечь');
    fireHere(); if (!useSlot(i) || (inv.slots[i]!.dur ?? 0) < 200 || count('coal') !== 1) throw new Error('разжечь: ' + inv.slots[i]!.dur);
    stepUseItems(0.1);
    if (!(mods.frostHands < 0.6 && mods.warmHands > 0)) throw new Error('эффект: ' + mods.frostHands);
    stepUseItems(120); stepUseItems(120);                                 // 480 game min
    stepUseItems(0.1); if (mods.frostHands !== 1) throw new Error('выгорела, а эффект остался');
  });
});

registerTest('useitems', 'бинт и спирт: бинт лечит часть тела (со спиртом лучше), спирт внутрь остужает', async () => {
  await sandbox(() => {
    clearInventory(); resetP(); add('bandage', 3); add('spirit', 2);
    const bi = inv.slots.findIndex(s => s?.id === 'bandage');
    if (useSlot(bi)) throw new Error('лечить нечего');
    P().frost.hands = 85; body.scar.hands = 20;
    if (!useSlot(bi)) throw new Error('бинт на обмороженную руку');
    if (count('spirit') !== 1 || count('bandage') !== 2) throw new Error('спирт и бинт расходуются');
    if (P().frost.hands > 50 || body.scar.hands > 5) throw new Error('со спиртом лечит сильно: ' + P().frost.hands + '/' + body.scar.hands);
    P().frost.hands = 0; P().frost.face = 45; body.scar.face = 0; const f0 = P().frost.face; stepUseItems(1); useSlot(bi);
    if (!(P().frost.face < f0)) throw new Error('обморожение лица должно спадать');
    body.scar.hands = 0; body.scar.face = 0;
    const si = inv.slots.findIndex(s => s?.id === 'spirit'); P().core = 37;
    if (!useSlot(si)) throw new Error('выпить спирт');
    for (let k = 0; k < 70; k++) stepUseItems(1);
    if (P().core > 36.4) throw new Error('спирт внутрь должен остужать: ' + P().core);
  });
});

registerTest('useitems', 'жир-мазь: -40 % обморожения на ~2 игровых часа, четыре раза', async () => {
  await sandbox(() => {
    clearInventory(); resetP(); add('frost_balm', 1);
    const i = inv.slots.findIndex(s => s?.id === 'frost_balm');
    if (inv.slots[i]!.dur !== 4) throw new Error('четыре заряда: ' + inv.slots[i]!.dur);
    stepUseItems(0.1); if (mods.frostHands !== 1) throw new Error('до мази эффекта нет');
    if (!useSlot(i)) throw new Error('намазаться');
    stepUseItems(0.1); if (Math.abs(mods.frostHands - 0.6) > 0.01 || Math.abs(mods.frostFace - 0.6) > 0.01) throw new Error('-40 %: ' + mods.frostHands);
    stepUseItems(50); stepUseItems(50); stepUseItems(0.1);                       // 2 game hours = 120 / MIN_PER_SEC seconds
    if (mods.frostHands !== 1) throw new Error('через два часа мазь должна сойти');
  });
});

registerTest('useitems', 'очки: слот «лицо», без очков яркий снег слепит, в очках нет', async () => {
  await sandbox(() => {
    clearInventory(); resetP(); G.daylight = 1;
    add('snow_goggles', 1); const gi = inv.slots.findIndex(s => s?.id === 'snow_goggles');
    if (moveStack({ z: 'inv', i: gi }, { z: 'wear', i: 0 }) !== 0) throw new Error('очки не на голову');
    if (moveStack({ z: 'inv', i: gi }, { z: 'wear', i: 4 }) !== 1 || inv.wear.face !== 'snow_goggles') throw new Error('очки на лицо');
    for (let k = 0; k < 20; k++) stepUseItems(10);
    if (sget('glare') > 0.2) throw new Error('в очках слепоты быть не должно: ' + sget('glare'));
    if (!document.getElementById('goggletint')) throw new Error('нет тонировки очков');
    moveStack({ z: 'wear', i: 4 }, { z: 'inv', i: gi });
    for (let k = 0; k < 20; k++) stepUseItems(10);
    if (sget('glare') < 0.8) throw new Error('без очков на ярком снегу слепит: ' + sget('glare'));
    P().shelter = 1; for (let k = 0; k < 20; k++) stepUseItems(10);
    if (sget('glare') > 0.1) throw new Error('в укрытии отпускает');
    useState().d = {};
  });
});

registerTest('useitems', 'подсумок: +3 ячейки на поясе (клавиши 7-9, колесо), пропадают вместе с ним', async () => {
  await sandbox(() => {
    clearInventory(); giveStartKit();
    if (slotUsable(NSLOT)) throw new Error('ячеек подсумка без подсумка нет');
    add('belt_pouch', 1); if (!slotUsable(NSLOT + 2)) throw new Error('+3 ячейки');
    select(6); if (inv.sel !== NSLOT) throw new Error('клавиша 7 -> ячейка подсумка: ' + inv.sel);
    inv.sel = 0; for (let k = 0; k < 6; k++) selectStep(1);
    if (inv.sel !== NSLOT) throw new Error('колесо проходит шесть ячеек и заходит в подсумок: ' + inv.sel);
    for (let k = 0; k < 3; k++) selectStep(1); if (inv.sel !== 0) throw new Error('колесо по кругу из 9: ' + inv.sel);
    // fill belt+pack, the next item lands in the pouch
    for (let i = 0; i < NSLOT; i++) if (!inv.slots[i]) inv.slots[i] = { id: 'tin', n: 8 };
    add('thermos', 1); if (!inv.slots.slice(NSLOT, NSLOT + 3).some(s => s?.id === 'thermos')) throw new Error('новая вещь ложится в подсумок');
    // lose the pouch: contents spill, selection returns to the belt
    const pi = inv.slots.findIndex(s => s?.id === 'belt_pouch'); inv.sel = NSLOT; inv.slots[pi] = null;
    stepUseItems(0.1);
    if (inv.slots.slice(NSLOT, TOTAL).some(Boolean) || inv.sel !== 0) throw new Error('без подсумка ячейки пусты');
  });
});

registerTest('useitems', 'рюкзак: +6 мест, +20 кг, +20 % пота; правила 60/80/100 кг без него прежние', async () => {
  await sandbox(() => {
    clearInventory(); resetP();
    if (weightMax() !== 100) throw new Error('без рюкзака лимит 100');
    add('stone', 6); add('stone', 6); add('stone', 5);                 // 68 kg
    const lv0 = loadLevel(), ov0 = overload();
    clearInventory(); add('big_pack', 1);
    if (weightMax() !== 120) throw new Error('+20 кг: ' + weightMax());
    if (!slotUsable(30)) throw new Error('+6 мест');
    stepUseItems(0.1); if (Math.abs(mods.sweat - 1.2) > 0.001) throw new Error('+20 % пота: ' + mods.sweat);
    add('stone', 6); add('stone', 6); add('stone', 5);
    if (!(overload() < ov0) || loadLevel() > lv0) throw new Error('с рюкзаком те же 68 кг легче: ' + overload() + ' vs ' + ov0);
    for (let i = 0; i < NSLOT; i++) if (!inv.slots[i]) inv.slots[i] = { id: 'tin', n: 8 };
    add('scrap', 3); if (!inv.slots.slice(27, 33).some(s => s?.id === 'scrap')) throw new Error('лишнее — в доп. места');
    void weight;
  });
});

registerTest('useitems', 'мешок: насыпать до 12 сыпучего, вес вдвое меньше, мокрый снег мочит, высыпать', async () => {
  await sandbox(() => {
    clearInventory(); resetP(); add('sack', 1); add('coal', 12);
    const i = inv.slots.findIndex(s => s?.id === 'sack');
    const w0 = weight();
    if (!useSlot(i) || count('coal') !== 0 || Math.round((inv.slots[i]!.dur ?? 0) % 100) !== 12) throw new Error('насыпать уголь: ' + inv.slots[i]!.dur);
    const w1 = weight(); if (Math.abs(w1 - (0.3 + 12 * 1.2 * 0.5)) > 0.05) throw new Error('вес мешка с углём: ' + w1 + ' (без мешка ' + w0 + ')');
    stepUseItems(0.6); if (!useSlot(i) || count('coal') !== 12) throw new Error('высыпать');
    clearInventory(); add('sack', 1); add('snow', 12); P().wet = 0;
    const j = inv.slots.findIndex(s => s?.id === 'sack'); stepUseItems(1); useSlot(j);
    for (let k = 0; k < 60; k++) stepUseItems(5);
    if (P().wet < 0.2) throw new Error('мокрый снег в мешке должен мочить одежду: ' + P().wet);
  });
});

registerTest('useitems', 'рецепты и источники: хоть где-то лежит, иконка есть, мешок/грелка/мазь крафтятся', async () => {
  await sandbox(() => {
    const ids = ['thermos', 'bandage', 'spirit', 'hand_warmer', 'frost_balm', 'snow_goggles', 'belt_pouch', 'big_pack', 'sack'];
    for (const id of ids) {
      if (!worldInfo.chests.some(c => c.items.some(s => s.id === id))) throw new Error('нигде не лежит: ' + id);
      if (!hasIcon(id)) throw new Error('нет иконки: ' + id);
    }
    if (!hasIcon('flask_frozen')) throw new Error('нет иконки мёрзлой фляги');
    learnAll();
    for (const id of ['sack', 'hand_warmer', 'frost_balm', 'snow_goggles', 'belt_pouch', 'big_pack']) if (!RECIPES.some(r => r.result === id)) throw new Error('нет рецепта ' + id);
    clearInventory(); add('canvas', 2); add('sinew', 1);
    if (!craft(RECIPES.find(r => r.result === 'sack')!, { none: true })) throw new Error('мешок не сшит');
    if (count('sack') !== 1) throw new Error('мешок');
    clearInventory(); add('fat', 2); add('lichen', 1); craft(RECIPES.find(r => r.result === 'frost_balm')!, { none: true });
    const bi = inv.slots.findIndex(s => s?.id === 'frost_balm'); if (bi < 0 || inv.slots[bi]!.dur !== 4) throw new Error('банка мази с четырьмя зарядами');
    clearInventory(); add('tin', 2); craft(RECIPES.find(r => r.result === 'hand_warmer')!, { none: true, table: true });
    if (count('hand_warmer') !== 1) throw new Error('грелка');
  });
});
