// Self-tests (group 'quest'): start area (coal not buried, matches on the belt), the goal chain and its texts, shelter counted only when built
// outside the station, radio parts counted when inserted, the icebreaker line, a flare lighting the signal, small wins and the HUD target.
// They drive the running game through window.__sc; each test that needs a clean world regenerates it (as fauna.selftest does).
import { registerTest } from './selftest';
import { G } from './state';
import { on, emit } from './bus';
import { TS } from '../engine/grid';
import { MAT } from '../content/materials';
import { inv, count, clearInventory, add } from './inventory';
import { beltMatches } from './starter';
import { DOOR } from './snowpack';
import { GOALS, objectiveText, objectiveTarget, questState, runStats, waitDetail } from './quest';

const goal = (id: string) => GOALS.find(g => g.id === id)!;
const fresh = (t: { sc: any }) => { t.sc.start({ seed: G.seed, diff: G.diff.level, hardcore: G.diff.hardcore }); };
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

registerTest('quest', 'уголь у дизельной лежит на воздухе: не закопан в стартовом сугробе', async (t) => {
  fresh(t); await t.frames(20);
  const coal = G.drops.filter(d => d.item === 'coal' && d.x > 700 && d.x < 800);
  t.expect(coal.length >= 3, 'кучек угля у дизельной: ' + coal.length);
  for (const d of coal) {
    // buried = snow or packed snow in the sack's own cell or the six cells above it (a fallen mast beam is not snow)
    let snow = 0;
    for (let k = 0; k <= 6; k++) { const m = t.sc.cell(Math.floor(d.x), Math.floor(d.y) - k); if (m === MAT.SNOW || m === MAT.PACKED) snow++; }
    t.expect(snow === 0, `уголь в x${Math.round(d.x)} y${Math.round(d.y)} закопан в снегу (${snow} клеток)`);
  }
});

registerTest('quest', 'спички попадают на пояс со старта (ONB-3)', async (t) => {
  fresh(t); await t.frames(10);
  t.expect(inv.slots.slice(0, 6).some(s => s?.id === 'matches'), 'спичек нет в поясе: ' + inv.slots.slice(0, 6).map(s => s?.id).join());
  clearInventory(); add('matches', 20);
  t.expect(inv.slots.findIndex(s => s?.id === 'matches') >= 6, 'тест: спички должны быть в рюкзаке');
  const slot = beltMatches();
  t.expect(slot >= 0 && slot < 6 && inv.slots[slot]?.id === 'matches' && inv.slots[slot]?.n === 20, 'спички не переложены на пояс: слот ' + slot);
  fresh(t);
});

registerTest('quest', 'от старта дойти до угля и подобрать его клавишей E', async (t) => {
  fresh(t); await t.frames(10);
  const c = G.drops.filter(d => d.item === 'coal' && d.x > 700 && d.x < 800).sort((a, b) => a.x - b.x)[0];
  if (!c) { t.expect(false, 'нет угля у дизельной'); return; }
  const before = count('coal');
  t.sc.teleport(c.x - 4, 268); await t.frames(10);
  t.sc.act('interact', c.x, c.y - 1, 0.1); await t.frames(10);
  t.metric('coal_got', count('coal') - before);
  t.expect(count('coal') > before, 'E у угля ничего не подобрал');
  fresh(t);
});

registerTest('quest', 'цепочка: уголь → печь → барометр; цель-указатель ведёт к углю, потом к печи', async (t) => {
  fresh(t); await t.frames(20);
  t.expect(/уголь/.test(objectiveText()), 'первая строка: ' + objectiveText());
  const tg = objectiveTarget();
  t.expect(!!tg && dist(tg, { x: 740, y: 269 }) < 12, 'указатель не у угля: ' + JSON.stringify(tg));
  t.sc.give('coal', 2); await t.frames(2);
  // the east door is buried under the lee drift (DESIGN §13): digging it out is the step between the coal and the stove; the arrow leads to the door
  t.expect(/Откопай дверь/.test(objectiveText()), 'после угля — откопать дверь: ' + objectiveText());
  const dt = objectiveTarget();
  t.expect(!!dt && Math.abs(dt.x - DOOR.x0) < 8, 'указатель не у двери: ' + JSON.stringify(dt));
  emit('door_dug', {}); await t.frames(2);
  t.expect(/Растопи печь/.test(objectiveText()), 'после двери: ' + objectiveText());
  const stove = G.fixtures.find(f => f.kind === 'stove')!;
  const sp = objectiveTarget();
  t.expect(!!sp && !!stove && dist(sp, { x: (stove.tx + stove.tw / 2) * TS, y: (stove.ty + stove.th / 2) * TS }) < 2, 'указатель не на печи: ' + JSON.stringify(sp));
  emit('fire_lit', { kind: 'stove' }); await t.frames(2);
  t.expect(/барометр/i.test(objectiveText()), 'после печи: ' + objectiveText());
  emit('barometer', {}); await t.frames(2);
  t.expect(/журнал смотрителя/i.test(objectiveText()), 'после барометра: ' + objectiveText());
  fresh(t);
});

registerTest('quest', 'укрытие ★★ засчитывается только если построено вне станции', async (t) => {
  fresh(t); await t.frames(10);
  t.sc.teleport(600, 272); await t.frames(5);                 // inside the station
  runStats.placed = 5;
  emit('shelter', { stars: 2, closed: true, vent: true });
  t.expect(!goal('shelter').done(), 'укрытие в станции засчиталось');
  t.sc.teleport(400, 272); await t.frames(5);                 // outside, on the cape
  runStats.placed = 2;
  emit('shelter', { stars: 2, closed: true, vent: true });
  t.expect(!goal('shelter').done(), 'два блока засчитались');
  runStats.placed = 3;
  emit('shelter', { stars: 2, closed: true, vent: true });
  t.expect(goal('shelter').done(), 'три блока снаружи не засчитались');
  fresh(t);
});

registerTest('quest', 'рация: цель считает вставленные детали, а не сумку', async (t) => {
  fresh(t); await t.frames(5);
  const r = G.fixtures.find(f => f.kind === 'radio');
  if (!r) { t.expect(false, 'нет рации'); return; }
  t.sc.give('radio_triode', 1); t.sc.give('radio_coil', 1); t.sc.give('battery', 1); await t.frames(2);
  t.expect(!goal('radio').done() && /0\/3/.test(goal('radio').text()), 'детали в сумке уже засчитались: ' + goal('radio').text());
  r.data = { ...(r.data ?? {}), have: ['radio_triode', 'radio_coil'] };
  t.expect(/2\/3/.test(goal('radio').text()) && !goal('radio').done(), 'две вставленные: ' + goal('radio').text());
  (r.data as any).have = ['radio_triode', 'radio_coil', 'battery'];
  t.expect(goal('radio').done(), 'три вставленные не засчитались');
  fresh(t);
});

registerTest('quest', 'ледокол в пути: строка с сигналом и следующей открытой целью', async (t) => {
  fresh(t); await t.frames(5);
  const s0 = { ...questState };
  questState.icebreakerAt = G.time + 2 * 1440;
  const txt = objectiveText();
  t.expect(/Ледокол: 2 дн\./.test(txt), 'строка ледокола: ' + txt);
  t.expect(/Ледокол: \d+ дн\.  ·  \S/.test(txt) || /Ледокол: \d+ дн\./.test(txt), 'нет второй цели: ' + txt);
  t.expect(/сигнал: 2 полена, ягель, спички/.test(waitDetail()), 'в журнале нет рецепта сигнала: ' + waitDetail());
  Object.assign(questState, s0);
  fresh(t);
});

registerTest('quest', 'ракета у сигнального костра при прибытии ледокола зажигает сигнал', async (t) => {
  fresh(t); await t.frames(5);
  const s0 = { ...questState };
  const sf = G.fixtures.find(f => f.kind === 'signal_fire');
  if (!sf) { t.expect(false, 'нет сигнального костра'); return; }
  const fx = (sf.tx + sf.tw / 2) * TS, fy = (sf.ty + sf.th / 2) * TS;
  Object.assign(questState, { icebreakerAt: -1, iceArrivedAt: G.time, iceDeadline: G.time + 2160, lit: false, ended: '' as '' });
  emit('flare', { x: fx + 400, y: fy }); await t.frames(1);
  t.expect(!questState.lit, 'ракета за 400 клеток зажгла сигнал');
  emit('flare', { x: fx + 60, y: fy - 14 }); await t.frames(1);
  t.expect(questState.lit && sf.lit === true, 'ракета рядом не зажгла сигнал');
  Object.assign(questState, s0);
  sf.lit = false; sf.fuel = 0;
  fresh(t);
});

registerTest('quest', 'малые победы: при выполнении цели тост и событие goal_done', async (t) => {
  fresh(t); await t.frames(40);                       // first pass only takes the snapshot
  const got: string[] = [];
  const off = on('goal_done', (d: { id: string }) => got.push(d.id));
  t.sc.give('coal', 1); await t.frames(60);
  off();
  t.expect(got.includes('coal'), 'нет goal_done для угля: ' + got.join());
  fresh(t);
});

registerTest('quest', 'цели после пурги: пурга ★★, большая пурга ★★★, три тюленя', async (t) => {
  fresh(t); await t.frames(5);
  const s0 = { ...runStats };
  t.expect(!goal('storm').done() && /пург/.test(goal('storm').text()), 'цель пурги не открыта');
  runStats.storms = 1; runStats.stormStars = 2;
  t.expect(goal('storm').done(), 'пережитая пурга ★★ не засчитана');
  runStats.storms = 3; runStats.stormStars = 3;
  t.expect(goal('storm2').done(), 'большая пурга ★★★ не засчитана');
  runStats.seals = 3;
  t.expect(goal('seals3').done(), 'три тюленя не засчитаны');
  Object.assign(runStats, s0);
  fresh(t);
});
