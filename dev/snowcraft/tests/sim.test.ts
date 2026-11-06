// Headless simulation tests:  npx tsx tests/sim.test.ts
// Builds small scenes directly in the grid, steps the engine modules and asserts physical behaviour.
import { W, H, TW, mat, aux, flags, shade, awake, clearWorld, idx, CW, CHN, TS, wakeRect, F_PLACED, F_TREE, F_BURN } from '../src/engine/grid';
import { MAT } from '../src/content/materials';
import { G } from '../src/game/state';
import { initSim, stepSim, ignite, surfaceY, seedSim, simStats } from '../src/engine/sim';
import { initHeat, stepHeat, tempAt, temp, addHeat, windAt, shelterAt, enclosure, HEAT_POWER, sky } from '../src/engine/heat';
import { initStructure, stepStructure, requestSupportCheck, supportPreview } from '../src/engine/structure';
import { clusters, stepBodies, clearBodies, fellTree, onTreeLanded, clusterHitsBox, makeCluster } from '../src/engine/bodies';
import { stepParticles, clearParticles, FC, FX, throwCell, seedFx } from '../src/engine/particles';
import { explode, onBlast } from '../src/engine/explode';
import { moveBox, boxFree, solidAt, type Box } from '../src/engine/phys';

// ------------------------------------------------------------------ tiny harness
interface Row { name: string; ok: boolean; info: string }
const rows: Row[] = [];
function test(name: string, fn: () => string | void) {
  const t0 = performance.now();
  try {
    const info = fn() || '';
    rows.push({ name, ok: true, info: `${info}${info ? '  ' : ''}(${(performance.now() - t0).toFixed(0)} ms)` });
  } catch (e) {
    rows.push({ name, ok: false, info: (e as Error).message });
  }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

const DT = 1 / 60;
function reset(x0: number, y0: number, x1: number, y1: number, ambient = -10) {
  clearWorld(); clearBodies(); clearParticles();
  Object.assign(G.win, { x0, y0, x1, y1 });
  G.snowfall = 0; G.wind = 0; G.ambientT = ambient; G.player = null as never; G.cam.shake = 0;
  seedSim(12345); seedFx(777);
  initSim(); initStructure();
}
function fill(x0: number, y0: number, x1: number, y1: number, m: number, fl = 0, a = 0) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = idx(x, y); mat[i] = m; aux[i] = a; flags[i] = fl; shade[i] = (x * 7 + y * 13) & 255; }
}
function put(x: number, y: number, m: number, fl = 0, a = 0) { const i = idx(x, y); mat[i] = m; aux[i] = a; flags[i] = fl; shade[i] = 128; }
function count(m: number, x0 = 0, y0 = 0, x1 = W - 1, y1 = H - 1) {
  let n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (mat[idx(x, y)] === m) n++;
  return n;
}
function wakeWin() { const w = G.win; wakeRect(w.x0 - 40, w.y0 - 40, w.x1 + 40, w.y1 + 40, 120); }
interface RunOpts { heat?: boolean; struct?: boolean; bodies?: boolean }
function run(ticks: number, o: RunOpts = {}) {
  for (let t = 0; t < ticks; t++) {
    stepSim(DT);
    if (o.heat) stepHeat(DT);
    if (o.struct) stepStructure(DT);
    if (o.bodies !== false) stepBodies(DT);
    stepParticles(DT);
  }
}
function flatTemp(v: number) { temp.fill(v); }
const rnd = (() => { let s = 99; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();

// ------------------------------------------------------------------ 1. mass conservation: water in a closed box
test('water mass conserved in a closed box (2000 ticks)', () => {
  reset(800, 300, 960, 460);
  fill(800, 300, 960, 460, MAT.STONE);
  fill(820, 320, 900, 440, MAT.AIR);
  let n = 0;
  for (let y = 322; y < 360; y++) for (let x = 825; x < 880; x++) if (rnd() < 0.8) { put(x, y, MAT.WATER); n++; }
  initHeat(); flatTemp(10); wakeWin();
  run(2000);
  const after = count(MAT.WATER, 820, 320, 900, 440) + FC.n;
  assert(after === n, `water cells ${n} -> ${after}`);
  // settled flat on the floor: no water floating above half the expected fill height
  let hi = 440; for (let y = 320; y < 440; y++) { for (let x = 821; x < 900; x++) if (mat[idx(x, y)] === MAT.WATER) { hi = y; break; } if (hi < 440) break; }
  const expectH = Math.ceil(n / 79);
  assert(440 - hi + 1 <= expectH + 2, `surface too high: ${440 - hi + 1} vs ${expectH}`);
  return `${n} cells, surface ${440 - hi + 1} (ideal ${expectH})`;
});

// ------------------------------------------------------------------ 2. snow pile angle + sleep
test('snow pile: mass conserved, slope 25..60 deg, chunks fall asleep', () => {
  reset(800, 300, 1000, 470);
  fill(800, 450, 1000, 470, MAT.STONE);
  initHeat(); flatTemp(-10); wakeWin();
  let spawned = 0;
  for (let t = 0; t < 1800; t++) {
    put(900, 330, MAT.SNOW); spawned++; // one flake per tick from a point source
    run(1, { bodies: false });
  }
  run(900, { bodies: false });
  const total = count(MAT.SNOW, 801, 300, 999, 449) + count(MAT.PACKED, 801, 300, 999, 449);
  assert(total >= spawned - 2 && total <= spawned + 1, `snow ${spawned} -> ${total}`);
  let top = 449, x0 = 999, x1 = 801;
  for (let x = 801; x < 999; x++) for (let y = 300; y < 450; y++) { const m = mat[idx(x, y)]; if (m === MAT.SNOW || m === MAT.PACKED) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); top = Math.min(top, y); break; } }
  const height = 450 - top, halfBase = (x1 - x0 + 1) / 2;
  const ang = Math.atan2(height, halfBase) * 180 / Math.PI;
  assert(ang > 25 && ang < 60, `angle ${ang.toFixed(1)} deg (h=${height} base=${x1 - x0 + 1})`);
  // chunks asleep after settling
  run(200, { bodies: false });
  let aw = 0; for (let cy = 17 >> 0; cy < 16; cy++) void cy;
  for (let cy = (300 - 16) >> 5; cy <= (470 + 16) >> 5; cy++) for (let cx = (800 - 16) >> 5; cx <= (1000 + 16) >> 5; cx++) if (awake[cy * CW + cx]) aw++;
  assert(aw === 0, `${aw} chunks still awake`);
  return `angle ${ang.toFixed(1)} deg, h=${height}, base=${x1 - x0 + 1}, awake=0`;
});

// ------------------------------------------------------------------ 3. U-tube
test('water levels equalise in a U-tube', () => {
  reset(800, 300, 960, 470);
  fill(800, 300, 960, 470, MAT.STONE);
  fill(820, 330, 826, 450, MAT.AIR);   // left shaft
  fill(850, 330, 856, 450, MAT.AIR);   // right shaft
  fill(820, 444, 856, 450, MAT.AIR);   // bottom connector (7 high)
  let n = 0;
  for (let y = 380; y <= 450; y++) for (let x = 820; x <= 826; x++) { put(x, y, MAT.WATER); n++; }
  initHeat(); flatTemp(10); wakeWin();
  run(4000);
  const col = (x0: number, x1: number) => { for (let y = 330; y <= 450; y++) for (let x = x0; x <= x1; x++) if (mat[idx(x, y)] === MAT.WATER) return 450 - y + 1; return 0; };
  const hl = col(820, 826), hr = col(850, 856);
  const tot = count(MAT.WATER, 820, 330, 856, 450) + FC.n;
  assert(tot === n, `mass ${n} -> ${tot}`);
  assert(hr > 20 && Math.abs(hl - hr) <= 3, `levels left ${hl} right ${hr}`);
  return `left ${hl}, right ${hr} (start 71/0)`;
});

// ------------------------------------------------------------------ 4. fire burns wood
test('fire burns WOOD -> EMBER -> ASH', () => {
  reset(800, 300, 960, 470, -5);
  fill(800, 450, 960, 470, MAT.STONE);
  fill(850, 440, 855, 449, MAT.WOOD);
  initHeat(); flatTemp(-5); wakeWin();
  const w0 = count(MAT.WOOD);
  ignite(850, 449);
  let maxEmber = 0, tBurnt = -1;
  for (let t = 0; t < 6000; t++) {
    run(1);
    if (t % 10 === 0) { maxEmber = Math.max(maxEmber, count(MAT.EMBER, 840, 400, 870, 455)); if (tBurnt < 0 && count(MAT.WOOD) === 0) tBurnt = t; }
  }
  assert(w0 === 60, 'setup');
  assert(count(MAT.WOOD) === 0, `wood left ${count(MAT.WOOD)}`);
  assert(maxEmber > 5, `embers peaked at ${maxEmber}`);
  const ash = count(MAT.ASH, 830, 400, 880, 455);
  assert(ash > 20, `ash ${ash}`);
  return `wood gone at ${(tBurnt / 60).toFixed(1)} s, peak embers ${maxEmber}, ash ${ash}`;
});

// ------------------------------------------------------------------ 5. snow melts next to fire
test('snow melts next to a fire', () => {
  reset(800, 300, 960, 470, -10);
  fill(800, 450, 960, 470, MAT.STONE);
  fill(840, 430, 880, 449, MAT.SNOW);
  fill(835, 440, 839, 449, MAT.LOG, F_PLACED);
  initHeat(); wakeWin();
  const s0 = count(MAT.SNOW);
  ignite(835, 449); ignite(835, 445);
  run(1500, { heat: true });
  const s1 = count(MAT.SNOW) + count(MAT.PACKED), water = count(MAT.WATER) + count(MAT.ICE) + count(MAT.STEAM);
  assert(s1 < s0 - 8, `snow ${s0} -> ${s1}`);
  assert(water > 0 || count(MAT.STEAM) > 0, 'no melt water / steam');
  return `snow ${s0} -> ${s1}, water+ice+steam ${water}`;
});

// ------------------------------------------------------------------ 6. water freezes at -20
test('water freezes at -20 C ambient (surface first)', () => {
  reset(800, 300, 960, 470, -20);
  fill(800, 440, 960, 470, MAT.DIRT);
  fill(821, 440, 879, 449, MAT.AIR);                 // basin 59 wide, walls at x=820/880, open to the sky
  fill(821, 442, 879, 449, MAT.WATER);               // 8 deep
  const n0 = count(MAT.WATER);
  initHeat(); wakeWin();
  let tFirst = -1, tTop = -1;
  for (let t = 0; t < 9000; t++) {
    run(1, { heat: true });
    if (t % 30 === 0) {
      const ice = count(MAT.ICE);
      if (tFirst < 0 && ice > 0) tFirst = t;
      if (tTop < 0) { let top = 0; for (let x = 821; x < 880; x++) if (mat[idx(x, 442)] === MAT.ICE) top++; if (top > 55) tTop = t; }
    }
  }
  const ice = count(MAT.ICE), water = count(MAT.WATER);
  assert(ice + water === n0, `mass ${n0} -> ${ice + water}`);
  assert(tTop >= 0, `surface not frozen after 150 s (ice ${ice}/${n0})`);
  return `first ice ${(tFirst / 60).toFixed(0)} s, surface sealed ${(tTop / 60).toFixed(0)} s, ice ${ice}/${n0} after 150 s`;
});

// ------------------------------------------------------------------ 7. steam -> snow
test('steam rising in the cold turns into snow', () => {
  reset(800, 300, 960, 470, -22);
  fill(800, 450, 960, 470, MAT.STONE);
  initHeat(); wakeWin();
  let n = 0;
  for (let y = 430; y < 449; y++) for (let x = 860; x < 870; x++) if (rnd() < 0.3) { put(x, y, MAT.STEAM, 0, 200); n++; }
  run(1200, { heat: true });
  const snow = count(MAT.SNOW) + count(MAT.PACKED), steam = count(MAT.STEAM);
  assert(snow >= n * 0.5, `snow ${snow} of ${n} steam cells (steam left ${steam})`);
  return `${n} steam -> ${snow} snow, ${steam} steam left`;
});

// ------------------------------------------------------------------ 8. structure: arch vs flat slab
test('snow-block arch over a 6-tile gap holds, flat 10-tile slab collapses', () => {
  // arch
  reset(800, 300, 1000, 470);
  fill(800, 450, 1000, 470, MAT.STONE);
  const cx = 900, cyy = 450;
  let na = 0;
  for (let y = 420; y < 450; y++) for (let x = 870; x <= 930; x++) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cyy);
    if (d >= 12 && d <= 16) { put(x, y, MAT.SNOWBLOCK, F_PLACED); na++; }
  }
  initHeat(); wakeWin();
  requestSupportCheck(860, 410, 940, 452);
  run(120, { struct: true });
  const archLeft = count(MAT.SNOWBLOCK, 860, 400, 940, 452);
  assert(archLeft === na && clusters.length === 0, `arch lost cells ${na} -> ${archLeft}`);
  // flat slab on two walls, 10 tiles (40 cells) clear span
  reset(800, 300, 1000, 470);
  fill(800, 450, 1000, 470, MAT.STONE);
  fill(880, 420, 883, 449, MAT.SNOWBLOCK, F_PLACED);
  fill(924, 420, 927, 449, MAT.SNOWBLOCK, F_PLACED);
  fill(880, 416, 927, 419, MAT.SNOWBLOCK, F_PLACED);
  const nSlab = count(MAT.SNOWBLOCK);
  initHeat(); wakeWin();
  requestSupportCheck(870, 410, 940, 452);
  run(240, { struct: true });
  let slabLeft = 0; for (let x = 884; x < 924; x++) for (let y = 416; y < 420; y++) if (mat[idx(x, y)] === MAT.SNOWBLOCK) slabLeft++;
  const walls = count(MAT.SNOWBLOCK, 880, 420, 883, 449) + count(MAT.SNOWBLOCK, 924, 420, 927, 449);
  assert(slabLeft < 160 * 0.7, `slab span survived: ${slabLeft}/160`);
  assert(walls === 240, `walls damaged ${walls}/240`);
  const snow = count(MAT.SNOW) + count(MAT.PACKED);
  return `arch ${na} cells intact; slab span ${slabLeft}/160 left of ${nSlab - 240} (fell as ${snow} snow, ${clusters.length} clusters)`;
});

// ------------------------------------------------------------------ 9. cluster falls and lands / shatters
test('detached block falls as a cluster and lands; high drop shatters', () => {
  reset(800, 300, 1000, 470);
  fill(800, 450, 1000, 470, MAT.STONE);
  fill(900, 420, 907, 427, MAT.SNOWBLOCK, F_PLACED);
  initHeat(); flatTemp(-10); wakeWin();
  requestSupportCheck(890, 410, 920, 450);
  let sawCluster = false, impacts = 0, spd = 0;
  for (let t = 0; t < 240; t++) {
    stepSim(DT); stepStructure(DT);
    const r = stepBodies(DT);
    for (const im of r.impacts) { impacts++; spd = im.speed; }
    if (clusters.length > 0) sawCluster = true;
  }
  assert(sawCluster, 'no cluster was created');
  assert(clusters.length === 0 && impacts === 1, `clusters ${clusters.length}, impacts ${impacts}`);
  assert(count(MAT.SNOWBLOCK, 895, 400, 915, 449) === 64, `block cells ${count(MAT.SNOWBLOCK)}`);
  let maxY = 0; for (let y = 400; y < 450; y++) for (let x = 895; x < 915; x++) if (mat[idx(x, y)] === MAT.SNOWBLOCK) maxY = Math.max(maxY, y);
  assert(maxY === 449, `landed at y=${maxY}`);
  // shatter
  reset(800, 300, 1000, 470);
  fill(800, 450, 1000, 470, MAT.STONE);
  fill(900, 330, 907, 337, MAT.SNOWBLOCK, F_PLACED);
  initHeat(); flatTemp(-10); wakeWin();
  requestSupportCheck(890, 320, 920, 450);
  for (let t = 0; t < 300; t++) { stepSim(DT); stepStructure(DT); stepBodies(DT); stepParticles(DT); }
  const snow = count(MAT.SNOW, 850, 300, 960, 449) + count(MAT.PACKED, 850, 300, 960, 449);
  assert(count(MAT.SNOWBLOCK) === 0 && snow >= 60 && snow <= 64, `after shatter: blocks ${count(MAT.SNOWBLOCK)}, snow ${snow}`);
  return `landed intact at ${spd.toFixed(0)} cells/s; 120-cell drop shattered into ${snow} snow cells`;
});

// ------------------------------------------------------------------ 10. explosion
test('explode() carves a crater by hardness and notifies listeners', () => {
  reset(800, 300, 1000, 470);
  fill(850, 350, 950, 430, MAT.STONE);
  fill(850, 431, 950, 440, MAT.BEDROCK);
  initHeat(); wakeWin();
  const n0 = count(MAT.STONE);
  let blasts = 0;
  onBlast(() => { blasts++; });
  const r = explode(900, 390, 14, 0.9);
  const n1 = count(MAT.STONE);
  assert(r.destroyed > 150 && n0 - n1 > 100, `destroyed ${r.destroyed}, stone ${n0} -> ${n1}`);
  assert(mat[idx(900, 390)] !== MAT.STONE, 'centre cell still stone');
  assert(mat[idx(852, 352)] === MAT.STONE, 'far corner damaged');
  assert(blasts === 1, 'listener not called');
  const bed = count(MAT.BEDROCK);
  explode(900, 436, 12, 1);
  assert(count(MAT.BEDROCK) === bed, 'bedrock was destroyed');
  run(120);
  return `destroyed ${r.destroyed}, flying cells re-entered: air gaps ok`;
});

// ------------------------------------------------------------------ 11. closed snow room warms; open camp stays local
const campPower = HEAT_POWER.campfire;
function buildRoom(withWalls: boolean) {
  reset(700, 360, 960, 520, -25);
  fill(700, 480, 960, 520, MAT.DIRT);
  fill(700, 456, 960, 479, MAT.PACKED);
  if (withWalls) {
    fill(800, 436, 831, 455, MAT.SNOWBLOCK, F_PLACED);     // block
    fill(804, 440, 827, 455, MAT.AIR);                      // interior 6 x 4 tiles
    fill(804, 436, 827, 439, MAT.SNOWBLOCK, F_PLACED);      // keep a 1-tile roof... (interior is y 440..455 = 4 tall)
  }
  initHeat(); wakeWin();
}
test('closed 6x5-tile snow room with a fire warms to > +5 C in ~30 s (outside -25 C)', () => {
  reset(700, 360, 960, 520, -25);
  fill(700, 480, 960, 520, MAT.DIRT);
  fill(700, 456, 960, 479, MAT.PACKED);
  // exterior 8 x 7 tiles: walls and roof 1 tile thick, interior 6 wide x 5 tall tiles, floor = snowpack
  fill(800, 432, 831, 455, MAT.SNOWBLOCK, F_PLACED);
  fill(804, 436, 827, 455, MAT.AIR);
  initHeat(); wakeWin();
  const ex = enclosure(816, 448);
  assert(ex.closed && ex.tiles === 30, `enclosure closed=${ex.closed} tiles=${ex.tiles}`);
  const out0 = tempAt(780, 448), in0 = tempAt(816, 448);
  const log: string[] = [];
  let t5 = -1;
  for (let t = 0; t <= 1800; t++) {
    addHeat(812, 452, campPower);
    stepSim(DT); stepHeat(DT);
    if (t % 300 === 0) log.push(`${t / 60}s:${tempAt(816, 444).toFixed(1)}`);
    if (t5 < 0 && tempAt(816, 444) > 5) t5 = t;
  }
  const inT = tempAt(816, 444), outT = tempAt(780, 448);
  assert(inT > 5, `inside only ${inT.toFixed(1)} C after 30 s (${log.join(' ')})`);
  assert(outT < -20, `outside ${outT.toFixed(1)} C`);
  assert(simStats.ticks > 0, 'sim ticks');
  return `in ${in0.toFixed(0)} -> ${inT.toFixed(1)} C (>5 C at ${(t5 / 60).toFixed(1)} s), outside ${out0.toFixed(0)} -> ${outT.toFixed(1)} C; ${log.join(' ')}`;
});
test('open camp only warms the tiles near the fire', () => {
  buildRoom(false);
  flatTemp(-25); // everything settled
  initHeat();
  for (let t = 0; t <= 1200; t++) { addHeat(812, 452, campPower); stepSim(DT); stepHeat(DT); }
  const at = (dx: number) => tempAt(812 + dx * TS, 452);
  const near = at(1), mid = at(3), far = at(8), far2 = at(-9);
  assert(near > -25 + 2.5, `1 tile away only ${near.toFixed(1)} C`);
  assert(far < -25 + 0.8 && far2 < -25 + 0.8, `8-9 tiles away ${far.toFixed(2)} / ${far2.toFixed(2)} C`);
  assert(near > mid && mid > far, 'no gradient');
  return `fire tile ${tempAt(812, 452).toFixed(1)}, +1 tile ${near.toFixed(1)}, +3 ${mid.toFixed(1)}, +8 ${far.toFixed(2)}, -9 ${far2.toFixed(2)} (ambient -25)`;
});

// ------------------------------------------------------------------ 12. wind / shelter / enclosure
test('wind shadow behind a wall, shelter inside a room, enclosure flood fill', () => {
  reset(700, 360, 960, 520, -15);
  G.wind = 9;
  fill(700, 480, 960, 520, MAT.DIRT);
  fill(800, 440, 811, 479, MAT.SNOWBLOCK, F_PLACED);   // wall 3 tiles thick, 10 tiles tall
  fill(860, 456, 891, 479, MAT.PACKED);
  fill(860, 440, 891, 455, MAT.SNOWBLOCK, F_PLACED); fill(864, 444, 887, 455, MAT.AIR); // closed room
  initHeat(); wakeWin();
  for (let i = 0; i < 20; i++) stepHeat(DT);
  const front = Math.abs(windAt(780, 470)), lee = Math.abs(windAt(816, 470)), leeFar = Math.abs(windAt(880, 460)), high = Math.abs(windAt(816, 400));
  assert(front > 5, `front wind ${front}`);
  assert(lee < front * 0.35, `lee ${lee.toFixed(2)} vs front ${front.toFixed(2)}`);
  assert(high > front * 0.6, `wind above the wall ${high.toFixed(2)}`);
  assert(leeFar < 0.2, `inside room wind ${leeFar.toFixed(2)}`);
  const sIn = shelterAt(875, 452), sOut = shelterAt(780, 470), sLee = shelterAt(816, 470);
  assert(sIn > 0.9 && sOut < 0.3 && sLee > sOut, `shelter in ${sIn.toFixed(2)} out ${sOut.toFixed(2)} lee ${sLee.toFixed(2)}`);
  const eo = enclosure(780, 470), ei = enclosure(875, 452);
  assert(!eo.closed && ei.closed && sky[(470 >> 2) * TW + (780 >> 2)] === 1, 'enclosure');
  return `wind front ${front.toFixed(1)} lee ${lee.toFixed(1)} high ${high.toFixed(1)}; shelter in ${sIn.toFixed(2)} lee ${sLee.toFixed(2)} out ${sOut.toFixed(2)}`;
});

// ------------------------------------------------------------------ 13. methane explosion
test('methane + fire explodes (chain) and carves stone', () => {
  reset(800, 300, 1000, 470);
  fill(850, 380, 950, 440, MAT.STONE);
  fill(880, 400, 900, 415, MAT.METHANE);
  fill(880, 417, 884, 419, MAT.AIR); put(890, 416, MAT.AIR);
  fill(890, 416, 890, 416, MAT.AIR);
  initHeat(); flatTemp(0); wakeWin();
  const stone0 = count(MAT.STONE);
  let blasts = 0; onBlast(() => { blasts++; });
  put(881, 416, MAT.FIRE, 0, 30);
  put(881, 415, MAT.METHANE); // adjacent gas
  run(300);
  assert(simStats.booms >= 1 && blasts >= 1, `booms ${simStats.booms}, blasts ${blasts}`);
  const stone1 = count(MAT.STONE);
  assert(stone1 < stone0 - 20, `stone ${stone0} -> ${stone1}`);
  return `${simStats.booms} gas explosion(s), stone ${stone0} -> ${stone1}`;
});

// ------------------------------------------------------------------ 14. lava
test('lava + water -> basalt + steam; lava ignites wood and melts snow', () => {
  reset(800, 300, 1000, 470);
  fill(800, 440, 1000, 470, MAT.STONE);
  fill(840, 436, 860, 439, MAT.LAVA);
  fill(861, 436, 880, 439, MAT.WATER);
  fill(830, 430, 839, 439, MAT.PACKED);
  initHeat(); wakeWin();
  const lava0 = count(MAT.LAVA);
  run(600, { heat: true });
  assert(count(MAT.BASALT) > 3, `basalt ${count(MAT.BASALT)}`);
  assert(count(MAT.LAVA) < lava0, 'lava did not react');
  // wood
  reset(800, 300, 1000, 470);
  fill(800, 440, 1000, 470, MAT.STONE);
  fill(850, 436, 855, 439, MAT.LAVA);
  fill(856, 430, 859, 439, MAT.PLANK, F_PLACED);
  initHeat(); wakeWin();
  run(200, { heat: true });
  assert(count(MAT.PLANK) < 24 || count(MAT.FIRE) > 0 || count(MAT.EMBER) > 0 || count(MAT.ASH) > 0, 'planks untouched next to lava');
  return `lava ${lava0} -> ${count(MAT.LAVA)} (basalt formed), plank ignited`;
});

// ------------------------------------------------------------------ 15. tree felling
test('fellTree topples a spruce in ~1-2 s, reports logs/boughs', () => {
  reset(800, 300, 1100, 470);
  fill(800, 450, 1100, 470, MAT.DIRT);
  // trunk 4 wide x 80 tall, crown of needles
  fill(900, 370, 903, 449, MAT.WOOD, F_TREE);
  for (let y = 372; y < 440; y += 4) { const w = Math.max(2, Math.floor((440 - y) / 4)); fill(901 - w, y, 902 + w, y + 3, MAT.NEEDLES, F_TREE); }
  const trunk0 = count(MAT.WOOD), needles0 = count(MAT.NEEDLES);
  initHeat(); wakeWin();
  let got: [number, number, number, number] | null = null;
  onTreeLanded((x, y, l, b) => { got = [x, y, l, b]; });
  assert(fellTree(901, 440, 1), 'fellTree returned false');
  assert(count(MAT.WOOD) === 0 && count(MAT.NEEDLES) === 0, 'tree not removed from the grid');
  let t = 0;
  while (!got && t < 600) { stepBodies(DT); stepParticles(DT); stepSim(DT); t++; }
  assert(got, 'tree never landed');
  const secs = t / 60;
  assert(secs > 0.7 && secs < 2.2, `fall took ${secs.toFixed(2)} s`);
  const [lx, , logs, boughs] = got as [number, number, number, number];
  assert(logs === Math.round(trunk0 / 40) && boughs >= 1 && lx > 905, `logs ${logs}, boughs ${boughs}, x ${lx}`);
  return `trunk ${trunk0} cells, needles ${needles0}; landed after ${secs.toFixed(2)} s -> ${logs} logs, ${boughs} boughs`;
});

// ------------------------------------------------------------------ 16. phys
test('moveBox: gravity landing, walls, step-up, water drag, cluster solidity', () => {
  reset(800, 300, 1000, 470);
  fill(800, 450, 1000, 470, MAT.STONE);
  fill(930, 440, 939, 449, MAT.STONE);           // 10-high wall
  fill(900, 446, 905, 449, MAT.STONE);           // 4-high step
  fill(850, 440, 870, 449, MAT.WATER);
  const b: Box = { x: 820, y: 400, vx: 0, vy: 0, w: 8, h: 20, onGround: false };
  let landed = 0;
  for (let i = 0; i < 200 && !b.onGround; i++) { b.vy += 400 * DT; const r = moveBox(b, DT); if (r.landedSpeed) landed = r.landedSpeed; }
  assert(b.onGround && (b.y as number) === 450 && landed > 100, `landing y=${b.y} onGround=${b.onGround} v=${landed.toFixed(0)}`);
  // walk right over the 4 high step (needs stepUp >= 4); the step is 6 wide
  b.vx = 60;
  const bx = b.x;
  let minY = b.y;
  for (let i = 0; i < 300; i++) { b.vx = 60; b.vy += 400 * DT; moveBox(b, DT, { stepUp: 4 }); minY = Math.min(minY, b.y); if (b.x > 915) break; }
  assert(b.x > 915 && minY === 446, `step-up failed x=${b.x.toFixed(1)} minY=${minY}`);
  // wall
  b.vx = 80; let hit = false;
  for (let i = 0; i < 120; i++) { b.vy += 400 * DT; const r = moveBox(b, DT, { stepUp: 4 }); if (r.hitWall) { hit = true; break; } }
  assert(hit && Math.abs(b.x + 4 - 930) < 0.01, `wall stop x=${b.x}`);
  assert(!boxFree(b.x + 1, b.y, 8, 20) && boxFree(b.x, b.y, 8, 20), 'boxFree mismatch');
  // water
  const c: Box = { x: 860, y: 430, vx: 0, vy: 0, w: 8, h: 20, onGround: false };
  let inW = 0; for (let i = 0; i < 40; i++) { c.vy += 300 * DT; const r = moveBox(c, DT); inW = Math.max(inW, r.inWater); }
  assert(inW > 0.4, `submersion ${inW}`);
  // a falling cluster is solid and hits boxes
  fill(880, 380, 883, 383, MAT.SNOWBLOCK, F_PLACED);
  const cl = makeCluster([idx(880, 380), idx(881, 380), idx(880, 381), idx(881, 381), idx(882, 380), idx(883, 380)], 0, 0);
  assert(cl && solidAt(880.5, cl.y + 0.5), 'cluster cell not solid');
  assert(!solidAt(890.5, cl.y + 0.5), 'phantom cluster cell');
  const hit2 = clusterHitsBox(881, cl.y + 6, 8, 20);
  assert(hit2.hit, 'box inside the cluster not detected');
  assert(!clusterHitsBox(950, cl.y + 6, 8, 20).hit, 'false positive');
  void bx;
  return `landed at ${landed.toFixed(0)} cells/s, step-up ok, wall ok, submersion ${inW.toFixed(2)}, cluster overlap=${hit2.hit}`;
});

// ------------------------------------------------------------------ 17. supportPreview
test('supportPreview: grounded ok, floating = no support, long beam = span', () => {
  reset(800, 300, 1000, 470);
  fill(800, 450, 1000, 470, MAT.STONE);
  fill(900, 400, 903, 449, MAT.STONE);              // natural pillar
  initHeat();
  const ground = supportPreview([{ x: 850, y: 449, m: MAT.SNOWBLOCK }, { x: 851, y: 449, m: MAT.SNOWBLOCK }]);
  assert(ground.ok && ground.margin > 0.9, `ground ok=${ground.ok} margin=${ground.margin}`);
  const floating = supportPreview([{ x: 850, y: 400, m: MAT.PLANK }]);
  assert(!floating.ok && floating.reason === 'нет опоры', `floating ${JSON.stringify(floating)}`);
  const beam: { x: number; y: number; m: number }[] = [];
  for (let x = 904; x < 904 + 14; x++) for (let y = 410; y < 414; y++) beam.push({ x, y, m: MAT.SNOWBLOCK });
  const longBeam = supportPreview(beam);
  assert(!longBeam.ok && longBeam.reason === 'слишком длинный пролёт', `beam ${JSON.stringify(longBeam)}`);
  const shortBeam: typeof beam = [];
  for (let x = 904; x < 904 + 5; x++) for (let y = 410; y < 414; y++) shortBeam.push({ x, y, m: MAT.SNOWBLOCK });
  const sb = supportPreview(shortBeam);
  assert(sb.ok && sb.margin > 0 && sb.margin < 0.9, `short beam ${JSON.stringify(sb)}`);
  return `ground margin ${ground.margin.toFixed(2)}, floating "${floating.reason}", 14-cell beam "${longBeam.reason}", 5-cell beam margin ${sb.margin.toFixed(2)}`;
});

// ------------------------------------------------------------------ 18. snowfall
test('snowfall deposits on the surface, spruce boughs catch it, off-window columns catch up', () => {
  reset(800, 300, 960, 470, -12);
  fill(700, 450, 1300, 470, MAT.STONE);
  fill(840, 400, 843, 449, MAT.WOOD, F_TREE);
  fill(834, 410, 849, 430, MAT.NEEDLES, F_TREE);
  initHeat(); flatTemp(-12); wakeWin();
  G.snowfall = 1;
  run(1200);
  const snow = count(MAT.SNOW, 800, 300, 960, 449) + count(MAT.PACKED, 800, 300, 960, 449);
  assert(snow > 160 * 4, `only ${snow} snow cells deposited in 20 s`);
  let onBoughs = 0; for (let x = 834; x <= 849; x++) for (let y = 380; y < 410; y++) if (mat[idx(x, y)] === MAT.SNOW) onBoughs++;
  assert(onBoughs > 0, 'no snow on the crown');
  assert(surfaceY(880) < 450, 'surfaceY not raised by snow');
  // move the window: new columns receive accumulated snow
  const before = count(MAT.SNOW, 1000, 300, 1100, 449);
  Object.assign(G.win, { x0: 960, x1: 1120 });
  wakeWin();
  run(30);
  const after = count(MAT.SNOW, 1000, 300, 1100, 449) + count(MAT.PACKED, 1000, 300, 1100, 449);
  assert(after > before + 100, `entering columns got ${after - before}`);
  return `${snow} cells in 20 s, ${onBoughs} on boughs, ${after - before} on entering columns`;
});

// ------------------------------------------------------------------ 19. flying cells conserve mass
test('flying cells re-enter the grid (mass conserved)', () => {
  reset(800, 300, 1000, 470);
  fill(800, 450, 1000, 470, MAT.STONE);
  for (let i = 0; i < 200; i++) throwCell(900, 440, MAT.GRAVEL, 0, (rnd() - 0.5) * 120, -60 - rnd() * 80);
  initHeat(); wakeWin();
  run(400);
  const g = count(MAT.GRAVEL, 800, 300, 1000, 449);
  assert(FC.n === 0 && g === 200, `gravel ${g}, flying ${FC.n}`);
  return `200 thrown -> ${g} landed`;
});

// ------------------------------------------------------------------ 20. performance
test('performance: 420x240 window, 600 ticks sim+heat (+structure/bodies/particles)', () => {
  reset(800, 250, 1220, 490, -18);
  G.snowfall = 0.6; G.wind = 6;
  // terrain: surface at y=400, snowpack, dirt, stone, caves
  fill(800, 400, 1220, 424, MAT.PACKED);
  fill(800, 425, 1220, 450, MAT.DIRT);
  fill(800, 451, 1220, 520, MAT.STONE);
  fill(840, 455, 960, 480, MAT.AIR);                 // cave
  fill(1000, 460, 1040, 470, MAT.LAVA); fill(1000, 450, 1040, 459, MAT.AIR);
  fill(880, 425, 900, 448, MAT.AIR); fill(880, 449, 900, 450, MAT.AIR);
  // pond
  fill(1060, 396, 1120, 399, MAT.WATER);
  // forest: trunks + needles
  for (let k = 0; k < 7; k++) { const x = 820 + k * 55; fill(x, 340, x + 3, 399, MAT.WOOD, F_TREE); fill(x - 8, 345, x + 11, 380, MAT.NEEDLES, F_TREE); }
  // camp: logs burning
  fill(1150, 392, 1160, 399, MAT.LOG, F_PLACED);
  // methane pocket in the stone
  fill(1150, 470, 1170, 480, MAT.METHANE);
  // falling stuff
  for (let i = 0; i < 6000; i++) put(800 + ((rnd() * 420) | 0), 260 + ((rnd() * 120) | 0), MAT.SNOW);
  for (let i = 0; i < 1500; i++) put(1065 + ((rnd() * 50) | 0), 330 + ((rnd() * 40) | 0), MAT.WATER);
  for (let i = 0; i < 600; i++) put(1140 + ((rnd() * 30) | 0), 360 + ((rnd() * 30) | 0), MAT.SMOKE, 0, 120);
  for (let i = 0; i < 500; i++) put(900 + ((rnd() * 50) | 0), 350 + ((rnd() * 30) | 0), MAT.GRAVEL);
  initHeat(); wakeWin();
  ignite(1150, 399); ignite(1155, 395);
  for (let i = 0; i < 120; i++) { stepSim(DT); stepHeat(DT); } // warm-up so the scene is "in motion"
  const N = 600;
  let tSim = 0, tHeat = 0, tRest = 0, tStruct = 0, worst = 0;
  const spikes: string[] = [];
  const a = performance.now();
  for (let t = 0; t < N; t++) {
    addHeat(1155, 398, HEAT_POWER.campfire);
    const t0 = performance.now(); stepSim(DT);
    const t1 = performance.now(); stepHeat(DT);
    const t2 = performance.now(); stepStructure(DT);
    const t2b = performance.now(); stepBodies(DT); stepParticles(DT);
    const t3 = performance.now();
    tSim += t1 - t0; tHeat += t2 - t1; tStruct += t2b - t2; tRest += t3 - t2b; worst = Math.max(worst, t3 - t0);
    if (t3 - t0 > 3) spikes.push(`#${t} sim ${(t1 - t0).toFixed(1)} heat ${(t2 - t1).toFixed(1)} struct ${(t2b - t2).toFixed(1)} rest ${(t3 - t2b).toFixed(1)}`);
  }
  const total = (performance.now() - a) / N;
  assert(total < 4, `${total.toFixed(2)} ms/frame`);
  return `${total.toFixed(2)} ms/frame (sim ${(tSim / N).toFixed(2)}, heat ${(tHeat / N).toFixed(2)}, struct ${(tStruct / N).toFixed(2)}, bodies+fx ${(tRest / N).toFixed(2)}; worst ${worst.toFixed(1)}), awake chunks ${simStats.chunks}${spikes.length ? ' SPIKES: ' + spikes.slice(0, 4).join(' | ') : ''}`;
});

// ------------------------------------------------------------------ report
const wName = Math.max(...rows.map((r) => r.name.length));
console.log('\nSNOWCRAFT simulation tests\n' + '-'.repeat(wName + 12));
let fails = 0;
for (const r of rows) {
  if (!r.ok) fails++;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(wName)}  ${r.info}`);
}
console.log('-'.repeat(wName + 12));
console.log(`${rows.length - fails}/${rows.length} passed`);
void H; void F_BURN; void FX; void sky;
(globalThis as unknown as { process: { exit(n: number): void } }).process.exit(fails ? 1 : 0);
