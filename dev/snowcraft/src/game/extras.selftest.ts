// Self-tests for extra world content (extras.ts): flags, the new chests and cache, coal veins, lichen patches, cans in the ship hold,
// and an on-foot walk through the stern hatch into the ship cabin.
import { registerTest } from './selftest';
import { G } from './state';
import { W, mat } from '../engine/grid';
import { MAT } from '../content/materials';
import { worldInfo } from './locations';

const count = (m: number, x0: number, y0: number, x1: number, y1: number) => {
  let n = 0; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (mat[y * W + x] === m) n++; return n;
};

registerTest('extras', 'вехи-флаги стоят на x≈1020, 1200, 1350', (t) => {
  for (const x of [1020, 1200, 1350]) {
    const f = G.fixtures.find(q => q.kind === 'flag' && Math.abs(q.tx * 4 + 6 - x) < 12);
    t.expect(!!f, `флаг у x≈${x}`);
  }
});

registerTest('extras', 'пляж и припай: по два сундука с едой и верёвкой, нарты на припае', (t) => {
  const beach = worldInfo.chests.filter(c => c.site === 'beach');
  const ice = worldInfo.chests.filter(c => c.site === 'fastice');
  t.expect(beach.length >= 2, `сундуков на пляже ${beach.length} (нужно 2)`);
  t.expect(ice.length >= 2, `сундуков на припае ${ice.length} (нужно 2)`);
  t.expect(beach.some(c => c.items.some(s => s.id === 'can')) && beach.some(c => c.items.some(s => s.id === 'rope')), 'на пляже есть консервы и верёвка');
  t.expect(ice.some(c => c.items.some(s => s.id === 'biscuit')), 'на припае есть галеты');
  t.expect(G.drops.some(d => d.item === 'sled' && d.x > 1100 && d.x < 1450), 'брошенные нарты лежат на припае');
  // every new chest stands on something solid under its footprint
  for (const c of [...beach, ...ice]) {
    const x0 = c.x - 4, yB = c.y + 4;
    let supported = 0; for (let x = x0; x < x0 + 8; x++) if (mat[yB * W + x] !== MAT.AIR) supported++;
    t.expect(supported >= 6, `сундук ${c.site} (${c.x},${c.y}) стоит на земле (${supported}/8)`);
  }
});

registerTest('extras', 'мыс: сундук и тайник у уступа x≈220', (t) => {
  t.expect(worldInfo.chests.some(c => c.site === 'cape' && c.x > 190 && c.x < 250), 'сундук на мысу');
  t.expect(G.fixtures.some(f => f.kind === 'cache' && f.tx * 4 > 140 && f.tx * 4 < 290), 'тайник на мысу (x 140–290)');
});

registerTest('extras', 'шахта без добычи: жил угля в камне нет (уголь лежит мешками и в вагонетках)', (t) => {
  const n = count(MAT.COAL, 60, 230, 380, 420);
  t.metric('угля в камне', n);
  t.expect(n === 0, `жил угля быть не должно, найдено ${n}`);
});

registerTest('extras', 'ягель на станции (700–900) и на припае (1100–1400)', (t) => {
  const a = count(MAT.LICHEN, 700, 150, 900, 300), b = count(MAT.LICHEN, 1100, 150, 1400, 300);
  t.metric('ягель 700–900', a); t.metric('ягель 1100–1400', b);
  t.expect(a >= 6, `ягель на станции ${a}`);
  t.expect(b >= 6, `ягель на припае ${b}`);
});

registerTest('extras', 'в трюме «Зари» две консервы (лишние к своим)', (t) => {
  const hold = worldInfo.chests.find(c => c.site === 'ship' && c.items.some(s => s.id === 'radio_triode'));
  const can = hold?.items.find(s => s.id === 'can');
  t.expect(!!can && can.n >= 2, `консервы в трюме: ${can?.n ?? 0}`);
});


// v13 (playtest explorer): the chisel is on the beach before the ship, the long legs have finds, the rubble has its note, the diary tin is where the arrow points
registerTest('extras', 'пешня в сундуке на пляже, раньше корабля (x < 1200)', (t) => {
  const c = worldInfo.chests.find(q => q.site === 'beach' && q.items.some(s => s.id === 'ice_chisel'));
  t.expect(!!c, 'пешни в сундуках пляжа нет');
  t.expect(!!c && c.x < 1200, `пешня лежит на x=${c?.x}, нужно раньше корабля (x≈1750)`);
});

registerTest('extras', 'длинные ноги: бревна между станцией и шахтой, банка с рукавицей, кострище на льду', (t) => {
  const wood = G.drops.filter(d => d.item === 'log' && d.x >= 330 && d.x <= 410 && d.n === 3);
  const tin = G.drops.filter(d => (d.item === 'wool_mittens' || d.item === 'can') && d.x >= 490 && d.x <= 610);
  const ring = G.fixtures.filter(f => f.kind === 'campfire' && f.tx * 4 >= 1470 && f.tx * 4 <= 1640);
  t.expect(wood.length === 1, `стопка плавника 3 шт. между шахтой и станцией: ${wood.length}`);
  t.expect(tin.some(d => d.item === 'wool_mittens') && tin.some(d => d.item === 'can'), `рукавица и банка: ${tin.map(d => d.item).join(',')}`);
  t.expect(ring.length === 1, `кострище на льду между припаем и кораблём (x 1470–1640): ${ring.length}`);
});

registerTest('extras', 'записка «Впереди завал» лежит у завала на спуске (x 230–260), а не у портала', (t) => {
  const n2 = worldInfo.notes.find(n => n.id === 'n2');
  t.expect(!!n2 && n2.x >= 230 && n2.x <= 260, `записка n2 на x=${n2?.x}`);
});

registerTest('extras', 'дневник доктора лежит в жестянке у тура (x≈448), куда ведёт стрелка цели', (t) => {
  const n1 = worldInfo.notes.find(n => n.id === 'n1');
  t.expect(!!n1 && n1.x > 430 && n1.x < 470, `записка n1 на x=${n1?.x}`);
});
