// Headless tests of the mine (tsx): `npx tsx tests/mine.test.ts`
// The mine has no ore to grind: coal lies in sacks and carts, the pick is for ONE rock plug (and an ice seep), the frozen roof of the miner's hut
// stands on a timber set and comes down when the props are chopped out (support solver), the methane pocket stays sealed.
import { generateWorld, worldInfo } from '../src/game/worldgen';
import { LOC } from '../src/game/locations';
import { G } from '../src/game/state';
import { W, mat, flags, F_PLACED } from '../src/engine/grid';
import { MAT, MATS } from '../src/content/materials';
import { initStructure, stepStructure, requestSupportCheck, pendingChecks } from '../src/engine/structure';
import { clusters } from '../src/engine/bodies';
import { digTime } from '../src/game/tools';

let pass = 0, fail = 0;
function ok(cond: unknown, name: string, detail = '') {
  if (cond) { pass++; console.log('  ok   ', name, detail); } else { fail++; console.log('  FAIL ', name, detail); }
}
const at = (x: number, y: number) => mat[y * W + x];
console.log('SNOWCRAFT mine tests');
generateWorld(1);
const M = LOC.mine, FA = M.floorA, FB = M.floorB;

// ---- no ore grind ----
{
  let coal = 0, ore = 0;
  for (let y = 200; y < 420; y++) for (let x = 60; x < 400; x++) { const m = at(x, y); if (m === MAT.COAL) coal++; else if (m === MAT.COPPER || m === MAT.IRON || m === MAT.CRYSTAL || m === MAT.LAVA) ore++; }
  ok(coal === 0, 'no coal seams in the rock of the cape (coal comes in sacks and carts)', `(${coal} coal cells)`);
  ok(ore === 0, 'no copper / iron / crystal / lava anywhere on the cape');
  let anyOre = 0; for (let i = 0; i < mat.length; i += 1) { const m = mat[i]; if (m === MAT.COPPER || m === MAT.IRON || m === MAT.CRYSTAL || m === MAT.LAVA) anyOre++; }
  ok(anyOre === 0, 'COPPER / IRON / CRYSTAL / LAVA are never generated (whole world)', `(${anyOre})`);
  const sacks = G.drops.filter(d => d.item === 'coal' && d.x > 60 && d.x < 420);
  const carts = G.fixtures.filter(f => f.kind === 'cart' && f.data && f.data.loaded === 'coal');
  ok(sacks.length >= 8 && sacks.every(d => d.n >= 3), 'sacks of coal lie in the tunnels and on the apron', `(${sacks.length} sacks, ${sacks.reduce((a, d) => a + d.n, 0)} coal)`);
  ok(carts.length >= 3, 'mine carts are containers of coal', `(${carts.length})`);
  ok(worldInfo.coal.length >= sacks.length, 'worldInfo lists the sacks');
  const shed = worldInfo.chests.find(c => c.site === 'shed' && c.items.some(s => s.id === 'coal'));
  ok(!!shed, 'the station shed holds coal');
}

// ---- the pick is for the plug ----
{
  const pick = G.drops.find(d => d.item === 'pick');
  ok(!!pick && pick.x > M.portalX - 30 && pick.x < M.portalX, 'the pick lies by the mine portal (before the plug)', pick ? `(${pick.x},${pick.y})` : '');
  ok(!worldInfo.chests.some(c => c.site === 'minehut' && c.items.some(s => s.id === 'pick')), 'the hut chest no longer holds the pick (it would be behind the plug)');
  const floorD = (x: number) => FA + 4 * Math.floor((M.rampTop - x) / 5);
  let stone = 0, rows = 0;
  for (let x = M.plug[0]; x < M.plug[1]; x++) { const f = floorD(x); let col = 0; for (let y = f - 28; y < f; y++) if (at(x, y) === MAT.STONE) col++; if (col >= 24) rows++; stone += col; }
  ok(rows === M.plug[1] - M.plug[0], 'a rock plug fills the whole cross-section of the collapse', `(${stone} STONE cells)`);
  ok(digTime(MAT.STONE, 'pick') < 3 && digTime(MAT.STONE, 'shovel') === Infinity && digTime(MAT.STONE, 'axe') === Infinity && digTime(MAT.STONE, 'hand') === Infinity, 'only the pick breaks the plug');
  let ice = 0; for (let x = M.icePlug[0]; x < M.icePlug[1]; x++) for (let y = FB - 28; y < FB; y++) if (at(x, y) === MAT.ICE) ice++;
  ok(ice >= 120, 'a frozen seep (ice) blocks the corridor to the hut: pick or chisel', `(${ice} ice cells)`);
  ok(isFinite(digTime(MAT.ICE, 'chisel')) && isFinite(digTime(MAT.ICE, 'pick')), 'ice yields to the chisel and the pick');
  // gravel and timber on both sides of the plug are shovel / axe work
  let gravel = 0, timber = 0; for (let x = M.collapse[0]; x < M.collapse[1]; x++) { const f = floorD(x); for (let y = f - 28; y < f; y++) { const m = at(x, y); if (m === MAT.GRAVEL) gravel++; else if (m === MAT.LOG || m === MAT.PLANK) timber++; } }
  ok(gravel > 200 && timber > 5, 'the rest of the collapse is gravel (shovel) and broken timber (axe)', `(${gravel} / ${timber})`);
}

// ---- methane pocket ----
{
  let methane = 0, leak = 0;
  for (let y = FB - 28; y < FB; y++) for (let x = M.pocket[0]; x < M.pocket[1]; x++) {
    if (at(x, y) !== MAT.METHANE) continue; methane++;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (at(x + dx, y + dy) === MAT.AIR) leak++;
  }
  ok(methane > 600 && leak === 0, 'the methane pocket is still full and sealed', `(${methane} cells, ${leak} leaks)`);
}

// ---- the frozen roof of the hut stands on the timber set ----
const R = worldInfo.roof;
const snapshot = () => mat.slice(R.x0 - 4 + (R.y0 - 10) * W, 1); void snapshot;
function settle() { let n = 0; while (pendingChecks() > 0 && n++ < 200000) stepStructure(1 / 60); }
function slabCells() { let n = 0, placed = 0; for (let y = R.y0; y < R.y1; y++) for (let x = R.x0; x < R.x1; x++) { if (at(x, y) === MAT.DIRT) n++; if (flags[y * W + x] & F_PLACED) placed++; } return { n, placed }; }
{
  ok(R.x1 - R.x0 >= 60 && worldInfo.timberSets.length === 1, 'the hut has a frozen roof slab and exactly one timber set', `(${R.x1 - R.x0} wide)`);
  const before = mat.slice();
  initStructure();
  requestSupportCheck(R.x0 - 6, R.y0 - 14, R.x1 + 6, FB + 4);
  settle();
  let changed = 0; for (let i = 0; i < mat.length; i++) if (mat[i] !== before[i]) changed++;
  const sl = slabCells();
  ok(changed === 0 && sl.n === (R.x1 - R.x0) * (R.y1 - R.y0), 'with the timber set standing the roof holds (nothing moves on a full check)', `(${changed} cells moved, slab ${sl.n})`);
  // chop a doorway into the east prop (the way in leads through it): the stump above hangs from the slab and the west prop carries the middle
  const sets = worldInfo.timberSets[0];
  const lowRows = (cells: number[]) => cells.filter(i => Math.floor(i / W) >= FB - 24);
  for (const i of lowRows(sets.east)) { mat[i] = MAT.AIR; flags[i] = 0; }
  clusters.length = 0;
  requestSupportCheck(R.x0 - 6, R.y0 - 14, R.x1 + 6, FB + 4);
  settle();
  const afterDoor = slabCells();
  ok(afterDoor.n === sl.n && clusters.length === 0, 'chopping a doorway into ONE prop is safe: the roof holds', `(${sl.n - afterDoor.n} slab cells lost)`);
  // chop the west prop as well: the middle of the ceiling comes down
  for (const i of sets.west) { mat[i] = MAT.AIR; flags[i] = 0; }
  clusters.length = 0;
  requestSupportCheck(R.x0 - 6, R.y0 - 14, R.x1 + 6, FB + 4);
  settle();
  const after = slabCells();
  const fallen = (R.x1 - R.x0) * (R.y1 - R.y0) - after.n;
  ok(fallen >= 40 || clusters.length > 0, 'knocking out the second LOG prop brings the ceiling down (support solver)', `(${fallen} slab cells gone, ${clusters.length} falling clusters)`);
  mat.set(before); clusters.length = 0;
}

// ---- pick / axe on supports: the props are LOG (axe work, free firewood) ----
{
  ok(MATS[MAT.LOG].tool === 'axe' && isFinite(digTime(MAT.LOG, 'axe')) && digTime(MAT.LOG, 'saw') < digTime(MAT.LOG, 'axe'), 'props are logs: the axe takes them, the saw faster');
}
console.log(`\n${pass} ok, ${fail} failed`);
if (fail) (globalThis as unknown as { process: { exit(n: number): void } }).process.exit(1);
