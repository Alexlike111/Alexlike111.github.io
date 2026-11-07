// Self-tests of building and cutting (playtest G1 «инструменты и стройка»): reach for placing, sight from the head, a free neighbour when the aimed
// spot is taken, the knife's cut speed, the hint about loose snow, the cut's bus events and shake, the deny event, and picking up loose items and notes.
import { registerTest } from './selftest';
import { G } from './state';
import { on } from './bus';
import { W, mat, aux, F_PLACED } from '../engine/grid';
import { MAT } from '../content/materials';
import { add, count, clearInventory, inv, placeInto } from './inventory';
import { auxOfDensity } from './items';
import { target } from './tools';
import { nearestDrop, PICK_R } from './nearby';
import { sandbox, arena, tileBlock } from './testkit';
import { wx } from './weather';
import { loreSave, loreLoad } from './lore';
import { journal } from './quest';
import type { Drop } from './state';

const sc = () => (window as unknown as { __sc: any }).__sc;

/** Flat snow-free arena: packed snow from y=272 down, the player stands on it at x=1000 (chest at y=261). */
function flat() {
  wx.override = { ambientT: -30, wind: 0, storm: 0, snowfall: 0 };
  Object.assign(G, wx.override);
  arena(1000, 272, { dens: 300, depth: 40, up: 70 });
  const s = sc();
  s.teleport(1000, 272);
  return { p: G.player, s };
}
/** Aim at a world point the way the player does: the view is refreshed first, then two frames run. */
function aimAt(s: any, x: number, y: number) { s.render(0); s.aim(x, y); s.stepFast(2); }
const dropAt = (id: number, item: string, x: number, y: number, age = 1): Drop => ({ id, item, n: 1, x, y, vx: 0, vy: 0, age });
const hasDrop = (id: number) => G.drops.some(d => d.id === id);

registerTest('tools', 'установка: досягаемость 34 клетки от груди (было 26)', async () => {
  await sandbox(() => {
    const { p, s } = flat();
    add('snow_block', 3, 300);
    const near = s.place('snow_block', 257, 67);               // ≈31 клеток от груди
    if (!near.placed) throw new Error('блок в 31 клетке не поставлен: ' + JSON.stringify(near));
    const far = s.place('snow_block', 260, 67);                // ≈43 клетки
    if (far.placed) throw new Error('блок в 43 клетках не должен ставиться');
    void p;
  });
});

registerTest('tools', 'установка: луч от головы — свой блок на пути не мешает, чужая стена мешает', async () => {
  await sandbox(() => {
    const { s } = flat();
    add('snow_block', 1, 300);
    s.selectItem('snow_block');
    // natural wall (not the player's): the sight line from the head is cut
    tileBlock(253, 62, 1, 6, MAT.PACKED, 0, 0);     // rows 62..67 stand on the packed ground (row 68): a floating wall would slump under the support solver
    aimAt(s, 256 * 4 + 2, 66 * 4 + 2);
    if (!/мешает стена/i.test(target().reason ?? '')) throw new Error('чужая стена должна мешать: ' + JSON.stringify(target().reason));
    // the player's own block in the same place: one of them may stand in the line
    tileBlock(253, 62, 1, 6, MAT.SNOWBLOCK, auxOfDensity(300), F_PLACED);
    aimAt(s, 256 * 4 + 2, 66 * 4 + 2);
    if (/мешает стена/i.test(target().reason ?? '')) throw new Error('свой блок на пути не должен мешать: ' + JSON.stringify(target().reason));
  });
});

registerTest('tools', 'установка: занятая плитка — призрак на соседнюю свободную, «занято» не пишется', async () => {
  await sandbox(() => {
    const { s } = flat();
    add('snow_block', 1, 300);
    s.selectItem('snow_block');
    tileBlock(256, 67, 1, 1, MAT.SNOWBLOCK, auxOfDensity(300), F_PLACED);
    aimAt(s, 256 * 4 + 2, 67 * 4 + 2);
    const T = target();
    if (T.tx !== 257) throw new Error('призрак должен уйти на свободную плитку 257, а не ' + T.tx);
    if (/занят/.test(T.reason ?? '')) throw new Error('«занято» при свободном соседе: ' + T.reason);
  });
});

registerTest('tools', 'нож: блок режется за ≈0.5 с (было ≈1 с)', async () => {
  await sandbox(() => {
    const { s } = flat();
    s.selectItem('snow_knife');
    s.act('dig', 1010, 274, 0.3);
    if (count('snow_block') !== 0) throw new Error('за 0.3 с блок вырезан слишком быстро');
    s.act('dig', 1010, 274, 0.4);
    if (count('snow_block') !== 1) throw new Error('за 0.7 с блок должен быть вырезан, есть ' + count('snow_block'));
  });
});

registerTest('tools', 'нож под рыхлым слоем: подсказка «сначала откопай снег»', async () => {
  await sandbox(() => {
    const { s } = flat();
    s.selectItem('snow_knife');
    // loose snow on the top row of the crust (x 996..1007): the 2×1 regions under it cannot be cut
    for (let x = 996; x < 1008; x++) { const i = 272 * W + x; mat[i] = MAT.SNOW; aux[i] = 30; }
    aimAt(s, 1002, 274);
    const r = target().reason ?? '';
    if (!/откопай снег/.test(r)) throw new Error('нет подсказки про рыхлый снег: ' + JSON.stringify(r));
  });
});

registerTest('tools', 'вырезание блока: событие cut_block с координатами и тряска камеры', async () => {
  await sandbox(() => {
    const { s } = flat();
    s.selectItem('snow_knife');
    let got: any = null;
    const off = on('cut_block', (d) => { got = d; });
    try { s.act('dig', 1010, 274, 0.8); } finally { off(); }
    if (!got || typeof got.x !== 'number' || typeof got.y !== 'number') throw new Error('cut_block без координат: ' + JSON.stringify(got));
    if (!(G.cam.shake > 0.2)) throw new Error('после вырезания нет тряски: ' + G.cam.shake);
  });
});

registerTest('tools', 'отказ установки: событие deny', async () => {
  await sandbox(() => {
    const { s } = flat();
    add('snow_block', 1, 300);
    let n = 0;
    const off = on('deny', () => { n++; });
    try {
      const r = s.place('snow_block', 246, 64);                // в воздухе, без опоры
      if (r.placed) throw new Error('блок без опоры поставлен');
    } finally { off(); }
    if (n < 1) throw new Error('deny не выпущен');
  });
});

registerTest('tools', 'E: записка подбирается с 4 клеток без двери и без E (радиус ≈6)', async () => {
  const l0 = loreSave(), j0 = journal.length;
  try {
    await sandbox(() => {
      const { p, s } = flat();
      void s;
      let found = 0;
      const off = on('note_found', () => { found++; });
      try {
        G.drops.push(dropAt(900101, 'note_s2', p.x + 4, p.y - 8, 1));
        sc().stepFast(30);
      } finally { off(); }
      if (hasDrop(900101)) throw new Error('записка в 4 клетках не подобрана');
      if (found !== 1) throw new Error('note_found не выпущен: ' + found);
    });
  } finally { loreLoad(l0); journal.length = j0; }
});

registerTest('tools', 'E: предмет в радиусе 1.5 плитки подбирается раньше двери и магнита', async () => {
  await sandbox(() => {
    const { p, s } = flat();
    clearInventory();
    G.drops.push(dropAt(900102, 'stone', p.x + 4, p.y - 2, 0));   // on the ground at the feet; age 0: the magnet has not taken it yet
    s.act('interact', p.x + 4, p.y - 2);
    if (hasDrop(900102)) throw new Error('E не подобрал предмет в радиусе');
    if (count('stone') < 1) throw new Error('камень не в сумке');
    if (PICK_R < 6) throw new Error('радиус E меньше 1.5 плитки');
  });
});

registerTest('tools', 'E при нескольких предметах: под прицелом и записка первой', () => {
  const p = { x: 1000, y: 272 };
  const stone = dropAt(1, 'stone', 1004, 264, 0);
  const note = dropAt(2, 'note_s1', 996, 264, 0);
  const far = dropAt(3, 'ice', 1000 + PICK_R + 3, 264, 0);
  if (nearestDrop([stone, note, far], p.x, p.y - 8, PICK_R)?.id !== 2) throw new Error('записка должна быть первой');
  if (nearestDrop([stone, note], p.x, p.y - 8, PICK_R, 1004, 264)?.id !== 1) throw new Error('под прицелом — камень');
  if (nearestDrop([far], p.x, p.y - 8, PICK_R) !== null) throw new Error('дальше радиуса не берём');
  if (nearestDrop([dropAt(4, 'backpack', 1001, 264, 0)], p.x, p.y - 8, PICK_R) !== null) throw new Error('рюкзак не берём клавишей E');
});

registerTest('tools', 'ракетница: событие flare', async () => {
  await sandbox(() => {
    const { s } = flat();
    add('flare_gun', 1); add('flare', 1);
    s.selectItem('flare_gun');
    let n = 0;
    const off = on('flare', () => { n++; });
    try { s.act('dig', 1040, 250, 0.05); } finally { off(); }
    if (n < 1) throw new Error('выстрел ракетой не выпустил событие flare');
  });
});


// ---- merge of the playability line with the station objects (DESIGN §15): E must keep doing what the player means next to the new small things ----
registerTest('tools', 'E у печи зажигает печь: заслонка, чайник и ставня рядом не перехватывают E', async () => {
  await sandbox(async () => {
    const s = sc(), stove = G.fixtures.find(f => f.kind === 'stove')!, damper = G.fixtures.find(f => f.kind === 'damper')!;
    const lvl = () => Number(damper.data?.d ?? 1);
    for (const dx of [-2, 2, 4]) {                                       // from the front of the stove to the east door (x >= 677 is inside the closed door)
      clearInventory(); add('matches', 5); add('coal', 3); sc().select(0);
      stove.lit = false; stove.fuel = 0; const d0 = lvl();
      s.teleport(stove.tx * 4 + 8 + dx, 272); s.stepFast(10);
      const p = G.player; p.face = -1;
      s.act('interact', p.x, 120);                                       // the cursor points at the sky: the choice is made by the position alone
      s.stepFast(3);
      t_expect(!!stove.lit, `x=${Math.round(G.player.x)}: печь не зажглась, E ушёл в другой предмет`);
      t_expect(lvl() === d0, `x=${Math.round(G.player.x)}: заслонка сменила положение`);
    }
  });
});
function t_expect(c: boolean, m: string) { if (!c) throw new Error(m); }

registerTest('tools', 'E: закрытая дверь перед игроком открывается, а не лестница рядом с ней (на крышу не уносит)', async () => {
  await sandbox(async () => {
    const s = sc(), door = G.fixtures.find(f => f.kind === 'door' && f.data?.side === 'west')!;
    if (door.open) { s.act('interact', door.tx * 4 + 2, door.ty * 4 + 12); s.stepFast(3); }
    t_expect(!door.open, 'тест: дверь должна быть закрыта');
    s.teleport(door.tx * 4 - 6, 272); s.stepFast(10);
    const p = G.player; p.face = 1;
    s.act('interact', p.x, 120); s.stepFast(3);
    t_expect(!!door.open, 'E у закрытой двери её не открыл');
    t_expect(G.player.y > 250, 'игрока унесло на крышу: E ушёл в лестницу, y=' + Math.round(G.player.y));
  });
});

registerTest('tools', 'снежные блоки сразу попадают на пояс (резать — класть, без сумки), прочие стопки — в сумку', async () => {
  await sandbox(async () => {
    clearInventory();
    add('snow_block', 3, 300); add('coal', 3); add('can', 2);
    const bi = inv.slots.findIndex(s => s?.id === 'snow_block');
    t_expect(bi >= 0 && bi < 6, 'блок не на поясе: слот ' + bi);
    const ci = inv.slots.findIndex(s => s?.id === 'coal');
    t_expect(ci >= 6, 'уголь должен лечь в сумку: слот ' + ci);
    // «Взять всё» from a chest (placeInto): ropes and flares go to the pack, blocks and tools to the belt
    clearInventory();
    const rope = placeInto('inv', { id: 'rope', n: 1 }), flare = placeInto('inv', { id: 'flare', n: 3 }), blk = placeInto('inv', { id: 'snow_block', n: 1, dur: 300 }), tool = placeInto('inv', { id: 'axe', n: 1 });
    t_expect(!!rope && rope.i >= 6 && !!flare && flare.i >= 6, 'верёвка и ракеты из ящика должны лечь в сумку: ' + JSON.stringify([rope, flare]));
    t_expect(!!blk && blk.i < 6 && !!tool && tool.i < 6, 'блок и инструмент — на пояс: ' + JSON.stringify([blk, tool]));
  });
});
