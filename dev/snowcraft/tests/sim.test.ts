// Headless simulation tests:  npx tsx tests/sim.test.ts
// Builds small scenes directly in the grid, steps the engine modules and asserts physical behaviour.
import { W, H, TW, mat, aux, flags, shade, awake, clearWorld, idx, CW, CHN, TS, wakeRect, F_PLACED, F_TREE, F_BURN } from '../src/engine/grid';
import { MAT } from '../src/content/materials';
import { G } from '../src/game/state';
import { initSim, stepSim, ignite, surfaceY, seedSim, simStats } from '../src/engine/sim';
import { initHeat, stepHeat, tempAt, temp, addHeat, windAt, shelterAt, enclosure, HEAT_POWER, sky, addThermalZone, clearThermalZones } from '../src/engine/heat';
import { initStructure, stepStructure, requestSupportCheck, supportPreview } from '../src/engine/structure';
import { edited } from '../src/engine/grid';
import { clusters, stepBodies, clearBodies, fellTree, onTreeLanded, clusterHitsBox, makeCluster, drawBodies } from '../src/engine/bodies';
import { stepParticles, clearParticles, FC, FX, throwCell, seedFx, spawnFx, drawParticles } from '../src/engine/particles';
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
  clearThermalZones();
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
test('snow-block arch over a 6-tile gap holds, flat 10-tile slab drops its middle', () => {
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
  // 40 clear cells, SNOWBLOCK carries 12 sideways from each wall: ~24 columns (96 cells) hold at the ends, the middle drops
  assert(slabLeft >= 80 && slabLeft <= 112, `slab: ${slabLeft}/160 cells left (expected ~96: both 12-cell ends)`);
  assert(mat[idx(886, 418)] === MAT.SNOWBLOCK && mat[idx(921, 418)] === MAT.SNOWBLOCK, 'slab ends near the walls fell');
  assert(mat[idx(902, 418)] !== MAT.SNOWBLOCK && mat[idx(905, 418)] !== MAT.SNOWBLOCK, 'slab middle still hangs');
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
  run(240);
  assert(FC.n === 0, `${FC.n} flying cells never re-entered the grid`);
  assert(mat[idx(900, 390)] !== MAT.STONE && mat[idx(900, 391)] !== MAT.STONE, 'crater closed up again');
  return `destroyed ${r.destroyed}, all flying cells re-entered, crater stays open`;
});

// ------------------------------------------------------------------ 11. closed snow room warms; open camp stays local
// Scene at the real surface depth (y ~ 296): snowpack over frozen dirt, geothermal profile -4 C there.
const campPower = HEAT_POWER.campfire;
const GY = 296;
function groundScene(ambient: number) {
  reset(700, 200, 960, 370, ambient);
  fill(700, GY + 24, 960, GY + 70, MAT.DIRT);
  fill(700, GY, 960, GY + 23, MAT.PACKED);
}
test('closed 6x5-tile snow room with a fire warms to > +5 C in ~30 s (outside -25 C)', () => {
  groundScene(-25);
  // exterior 8 x 6 tiles: walls and roof 1 tile thick, interior 6 wide x 5 tall tiles (y 276..295), floor = snowpack
  fill(800, GY - 24, 831, GY - 1, MAT.SNOWBLOCK, F_PLACED);
  fill(804, GY - 20, 827, GY - 1, MAT.AIR);
  initHeat(); wakeWin();
  const ex = enclosure(816, GY - 8);
  assert(ex.closed && ex.tiles === 30, `enclosure closed=${ex.closed} tiles=${ex.tiles}`);
  const in0 = tempAt(816, GY - 12), out0 = tempAt(780, GY - 12);
  const log: string[] = [];
  let t5 = -1;
  for (let t = 0; t <= 1800; t++) {
    addHeat(812, GY - 4, campPower);
    stepSim(DT); stepHeat(DT);
    if (t % 300 === 0) log.push(`${t / 60}s:${tempAt(816, GY - 12).toFixed(1)}`);
    if (t5 < 0 && tempAt(816, GY - 12) > 5) t5 = t;
  }
  const inT = tempAt(816, GY - 12), outT = tempAt(780, GY - 12);
  assert(t5 > 0 && inT > 5, `inside only ${inT.toFixed(1)} C after 30 s (${log.join(' ')})`);
  assert(t5 / 60 > 4 && t5 / 60 < 30, `crossed +5 C after ${(t5 / 60).toFixed(1)} s`);
  assert(outT < -20, `outside ${outT.toFixed(1)} C`);
  // the same fire in a room with a 1-tile hole in the roof stays much colder
  groundScene(-25);
  fill(800, GY - 24, 831, GY - 1, MAT.SNOWBLOCK, F_PLACED);
  fill(804, GY - 20, 827, GY - 1, MAT.AIR);
  fill(812, GY - 24, 815, GY - 21, MAT.AIR);
  initHeat(); wakeWin();
  assert(!enclosure(816, GY - 8).closed, 'room with a roof hole reported closed');
  for (let t = 0; t <= 1800; t++) { addHeat(812, GY - 4, campPower); stepSim(DT); stepHeat(DT); }
  const leaky = tempAt(816, GY - 12);
  assert(leaky < inT - 6, `leaky room ${leaky.toFixed(1)} vs closed ${inT.toFixed(1)}`);
  return `in ${in0.toFixed(0)} -> ${inT.toFixed(1)} C (>5 C at ${(t5 / 60).toFixed(1)} s), outside ${out0.toFixed(0)} -> ${outT.toFixed(1)} C; ${log.join(' ')}; roof hole: ${leaky.toFixed(1)} C`;
});
test('open camp only warms the tiles near the fire', () => {
  groundScene(-25);
  initHeat(); wakeWin();
  for (let t = 0; t <= 1200; t++) { addHeat(812, GY - 4, campPower); stepSim(DT); stepHeat(DT); }
  const at = (dx: number) => tempAt(812 + dx * TS, GY - 4);
  const fire = at(0), near = at(1), mid = at(3), far = at(8), far2 = at(-9);
  assert(fire > -25 + 4 && near > -25 + 2, `fire tile ${fire.toFixed(1)}, 1 tile away ${near.toFixed(1)} C`);
  assert(far < -25 + 0.8 && far2 < -25 + 0.8, `8-9 tiles away ${far.toFixed(2)} / ${far2.toFixed(2)} C`);
  assert(near > mid && mid > far, 'no gradient');
  return `fire tile ${fire.toFixed(1)}, +1 tile ${near.toFixed(1)}, +3 ${mid.toFixed(1)}, +8 ${far.toFixed(2)}, -9 ${far2.toFixed(2)} (ambient -25)`;
});
test('open air relaxes to ambient within seconds, faster in wind; far chunks catch up analytically', () => {
  groundScene(-20);
  initHeat(); wakeWin();
  const warm = (x: number) => { for (let ty = 64; ty < 72; ty++) for (let tx = (x >> 2) - 3; tx < (x >> 2) + 3; tx++) temp[ty * TW + tx] = 10; };
  warm(760); warm(900);
  G.wind = 0; const k0 = tempAt(760, 270);
  for (let t = 0; t < 120; t++) stepHeat(DT);           // 2 s calm
  const calm = tempAt(760, 270);
  G.wind = 12; for (let t = 0; t < 5; t++) stepHeat(DT);
  warm(900);
  for (let t = 0; t < 120; t++) stepHeat(DT);           // 2 s windy
  const windy = tempAt(900, 270);
  assert(k0 > 5 && (calm + 20) < (k0 + 20) * 0.45, `calm 2 s: ${k0.toFixed(1)} -> ${calm.toFixed(1)}`);
  assert((windy + 20) < (calm + 20) * 0.8, `wind did not speed it up: calm ${calm.toFixed(1)} windy ${windy.toFixed(1)}`);
  // catch-up: visit a far region, heat it, leave for 60 s of heat clock, come back
  G.wind = 0;
  const far = 1500;
  Object.assign(G.win, { x0: 1400, x1: 1600 });
  stepHeat(DT);
  for (let ty = 64; ty < 72; ty++) for (let tx = (far >> 2) - 3; tx < (far >> 2) + 3; tx++) temp[ty * TW + tx] = 12;
  Object.assign(G.win, { x0: 1000, x1: 1200 });
  for (let t = 0; t < 3600; t++) stepHeat(DT);
  const stale = tempAt(far, 270);
  Object.assign(G.win, { x0: 1400, x1: 1600 });
  stepHeat(DT);
  const caught = tempAt(far, 270);
  assert(stale > 11, 'precondition: far tile is not simulated while away');
  assert(caught < -15, `far tile did not catch up: ${caught.toFixed(1)}`);
  return `calm 2 s: ${k0.toFixed(0)} -> ${calm.toFixed(1)} C, windy 2 s: 10 -> ${windy.toFixed(1)} C, far chunk after 60 s away: ${caught.toFixed(1)} C`;
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
  // crown only beside the trunk (a crown fill over the trunk columns would overwrite most of it)
  for (let y = 372; y < 440; y += 4) { const w = Math.max(2, Math.floor((440 - y) / 4)); fill(901 - w, y, 899, y + 3, MAT.NEEDLES, F_TREE); fill(904, y, 902 + w, y + 3, MAT.NEEDLES, F_TREE); }
  const trunk0 = count(MAT.WOOD), needles0 = count(MAT.NEEDLES);
  assert(trunk0 === 320, `test setup: trunk ${trunk0}`);
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
  assert(logs === Math.round(trunk0 / 40) && logs === 8 && boughs >= 1 && lx > 905, `logs ${logs}, boughs ${boughs}, x ${lx}`);
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

// ------------------------------------------------------------------ 20. critic round: adversarial / edge-case tests
test('powders: gravel sinks through water, mass conserved, snow floats and freezes into a crust', () => {
  reset(800, 300, 960, 470, -20);
  fill(800, 300, 960, 470, MAT.STONE);
  fill(810, 320, 900, 459, MAT.AIR);
  fill(811, 440, 899, 459, MAT.WATER);                       // 89 x 20 water body, open top above y=440
  let g = 0;
  for (let y = 380; y < 400; y++) for (let x = 850; x < 860; x++) { put(x, y, MAT.GRAVEL); g++; }
  const w0 = count(MAT.WATER);
  initHeat(); flatTemp(10); wakeWin();                       // warm: no freezing in this half
  run(900);
  assert(count(MAT.GRAVEL) === g && count(MAT.WATER) + FC.n === w0, `gravel ${count(MAT.GRAVEL)}/${g}, water ${count(MAT.WATER)}/${w0}`);
  let gravelBelowSurface = 0; for (let y = 441; y <= 459; y++) for (let x = 811; x <= 899; x++) if (mat[idx(x, y)] === MAT.GRAVEL) gravelBelowSurface++;
  assert(gravelBelowSurface > g * 0.9, `only ${gravelBelowSurface}/${g} gravel sank`);
  // snow on the water floats; at -20 C the wet snow turns to ice
  reset(800, 300, 960, 470, -20);
  fill(800, 300, 960, 470, MAT.STONE);
  fill(810, 420, 900, 459, MAT.AIR); fill(811, 440, 899, 459, MAT.WATER);
  initHeat(); flatTemp(-12); wakeWin();
  for (let i = 0; i < 40; i++) put(850 + (i % 10), 430 - (i / 10 | 0), MAT.SNOW);
  run(60);
  let floating = 0; for (let y = 420; y < 441; y++) for (let x = 840; x < 870; x++) if (mat[idx(x, y)] === MAT.SNOW || mat[idx(x, y)] === MAT.ICE) floating++;
  assert(floating >= 38, `snow sank: only ${floating}/40 on the surface`);
  run(1800);
  const ice = count(MAT.ICE, 840, 420, 870, 440);
  assert(ice >= 20, `crust did not freeze: ${ice} ice cells`);
  return `gravel ${gravelBelowSurface}/${g} sank, snow floats (${floating}/40) and froze to ${ice} ice cells`;
});

test('sintering: loaded snow packs from the bottom, the fresh top stays loose', () => {
  reset(800, 300, 900, 470, -10);
  fill(800, 450, 900, 470, MAT.STONE);
  fill(820, 415, 880, 449, MAT.SNOW);                         // 35 tall slab, 61 wide (the middle stays put)
  initHeat(); flatTemp(-10); wakeWin();
  let tBottom = -1;
  for (let t = 0; t < 9000 && tBottom < 0; t++) { run(1, { bodies: false }); if (t % 60 === 0 && mat[idx(850, 449)] === MAT.PACKED) tBottom = t; }
  assert(tBottom > 0, 'bottom never packed');
  assert(mat[idx(850, 415)] === MAT.SNOW, `fresh top is ${mat[idx(850, 415)]}, expected loose snow`);
  assert(tBottom / 60 > 20 && tBottom / 60 < 140, `bottom packed after ${(tBottom / 60).toFixed(0)} s`);
  return `bottom cell packed after ${(tBottom / 60).toFixed(0)} s at -10 C, top still loose`;
});

test('sealed methane pocket stays put and its chunk sleeps; a pile wakes when undercut', () => {
  reset(800, 300, 1000, 470, -5);
  fill(850, 380, 950, 440, MAT.STONE);
  fill(880, 400, 900, 415, MAT.METHANE);
  fill(960, 450, 990, 470, MAT.STONE);
  fill(965, 448, 970, 449, MAT.SNOW);                         // 12 snow cells on a ledge, plugged
  fill(965, 450, 970, 452, MAT.STONE);
  const m0 = count(MAT.METHANE);
  initHeat(); flatTemp(-5); wakeWin();
  run(600);
  assert(count(MAT.METHANE, 880, 400, 900, 415) === m0, 'methane leaked');
  let aw = 0; for (let cy = (300 - 16) >> 5; cy <= (470 + 16) >> 5; cy++) for (let cx = (800 - 16) >> 5; cx <= (1000 + 16) >> 5; cx++) if (awake[cy * CW + cx]) aw++;
  assert(aw === 0, `${aw} chunks awake`);
  // undercut the pile: removing the plug and waking the chunk must make the snow fall
  fill(965, 450, 970, 452, MAT.AIR, 0);                       // pull the plug: a 6 x 3 hole
  wakeRect(960, 440, 975, 455, 30);
  run(120);
  const inHole = count(MAT.SNOW, 965, 450, 970, 452);
  assert(inHole === 12 && count(MAT.SNOW, 960, 440, 975, 449) === 0, `snow in hole ${inHole}, left above ${count(MAT.SNOW, 960, 440, 975, 449)}`);
  return `${m0} methane cells static, chunks asleep, undercut pile fell`;
});

test('oil ignites from a flame and burns away; embers quench in water', () => {
  reset(800, 300, 1000, 470, -5);
  fill(800, 450, 1000, 470, MAT.STONE);
  fill(840, 440, 880, 449, MAT.OIL);
  fill(900, 440, 920, 449, MAT.WATER);
  put(930, 449, MAT.EMBER, 0, 250); put(915, 430, MAT.EMBER, 0, 250);
  initHeat(); flatTemp(-5); wakeWin();
  const o0 = count(MAT.OIL);
  put(860, 439, MAT.FIRE, 0, 40);
  run(1800);
  assert(count(MAT.OIL) < o0 * 0.4, `oil left ${count(MAT.OIL)}/${o0}`);
  assert(count(MAT.EMBER, 900, 420, 925, 449) === 0 && count(MAT.ASH, 900, 420, 925, 449) >= 1, 'ember in water not quenched into ash');
  return `oil ${o0} -> ${count(MAT.OIL)}`;
});

test('structure: removing a tower base drops the tower; cliff bridges: 6 tiles hold, 10 tiles fail; icicle hangs', () => {
  reset(800, 300, 1100, 470);
  fill(800, 450, 1100, 470, MAT.STONE);
  fill(900, 380, 903, 449, MAT.PLANK, F_PLACED);              // tower
  initHeat(); wakeWin();
  requestSupportCheck(890, 370, 915, 452); run(60, { struct: true });
  assert(count(MAT.PLANK) === 280, 'standing tower fell');
  fill(900, 442, 903, 449, MAT.AIR); wakeRect(890, 430, 915, 455, 30);
  requestSupportCheck(890, 370, 915, 452);
  for (let t = 0; t < 240; t++) { stepSim(DT); stepStructure(DT); stepBodies(DT); stepParticles(DT); }
  let maxY = 0; for (let y = 380; y < 450; y++) if (mat[idx(901, y)] === MAT.PLANK) maxY = Math.max(maxY, y);
  assert(maxY >= 448, `tower should have landed on the floor, lowest plank at ${maxY}`);
  // bridges from a stone cliff
  reset(800, 300, 1100, 470);
  fill(800, 380, 860, 470, MAT.STONE);
  fill(861, 396, 861 + 23, 399, MAT.PLANK, F_PLACED);         // 6 tiles, attached to the cliff face
  fill(861, 380, 861 + 39, 383, MAT.PLANK, F_PLACED);         // 10 tiles (higher, separate)
  initHeat(); wakeWin();
  requestSupportCheck(850, 350, 910, 410); run(300, { struct: true });
  const short = count(MAT.PLANK, 861, 396, 884, 399), long1 = count(MAT.PLANK, 861, 380, 900, 383);
  assert(short === 96, `6-tile plank bridge lost cells: ${short}/96`);
  assert(long1 < 160, `10-tile bridge did not fail: ${long1}/160`);
  // icicle
  reset(800, 300, 1000, 470);
  fill(800, 400, 1000, 470, MAT.STONE);
  fill(850, 380, 900, 399, MAT.STONE);                        // ceiling
  fill(870, 400, 872, 416, MAT.ICE);                          // icicle 17 cells
  initHeat(); wakeWin();
  requestSupportCheck(860, 390, 890, 430); run(120, { struct: true });
  assert(count(MAT.ICE) === 51, 'icicle fell');
  return `tower fell (plank at y=${maxY}), 6-tile bridge ok, 10-tile bridge ${long1}/160 left, icicle holds`;
});

test('clusters: falling into a pond conserves water; ice cluster shards are flying cells', () => {
  reset(800, 300, 1000, 470, -5);
  fill(800, 440, 1000, 470, MAT.STONE);
  fill(850, 420, 900, 439, MAT.WATER);
  fill(849, 420, 849, 439, MAT.STONE); fill(901, 420, 901, 439, MAT.STONE);
  fill(870, 360, 877, 367, MAT.SNOWBLOCK, F_PLACED);
  const w0 = count(MAT.WATER);
  initHeat(); flatTemp(0); wakeWin();
  requestSupportCheck(860, 350, 890, 440);
  for (let t = 0; t < 600; t++) { stepSim(DT); stepStructure(DT); stepBodies(DT); stepParticles(DT); }
  const w1 = count(MAT.WATER) + FC.n;
  assert(clusters.length === 0, 'cluster stuck in the pond');
  assert(w1 === w0, `water ${w0} -> ${w1}`);
  // ice cluster dropped from high up: shards
  reset(800, 300, 1000, 470, -5);
  fill(800, 440, 1000, 470, MAT.STONE);
  fill(870, 320, 877, 327, MAT.ICE, F_PLACED);
  initHeat(); flatTemp(-5); wakeWin();
  requestSupportCheck(860, 310, 890, 440);
  let sawFlying = false;
  for (let t = 0; t < 400; t++) { stepSim(DT); stepStructure(DT); stepBodies(DT); stepParticles(DT); if (FC.n > 0) sawFlying = true; }
  const iceLeft = count(MAT.ICE);
  assert(sawFlying && iceLeft >= 30 && iceLeft <= 64, `shards: flying=${sawFlying}, ice ${iceLeft}`);
  return `pond water ${w0} -> ${w1}; ice block shattered, ${iceLeft}/64 ice cells re-landed`;
});

test('lava warms the rock around it (~+30 C a few tiles away); thermal zones pull towards their temperature', () => {
  reset(800, 500, 1000, 700, -18);
  fill(800, 500, 1000, 700, MAT.STONE);
  fill(880, 640, 920, 650, MAT.LAVA);
  addThermalZone(820, 600, 10, 38);
  initHeat(); wakeWin();
  const base = tempAt(840, 560);
  for (let t = 0; t < 3000; t++) stepHeat(DT);
  const near = tempAt(900, 650 + 3 * TS), near6 = tempAt(900, 650 + 7 * TS), spring = tempAt(820, 600), far = tempAt(900, 540);
  assert(near > 38 && near6 > 15 && near6 < near - 5, `rock temps near lava ${near.toFixed(1)} / ${near6.toFixed(1)}`);
  assert(far < near6 && far < 20, `far rock ${far.toFixed(1)}`);
  assert(spring > 30, `thermal zone ${spring.toFixed(1)}`);
  return `rock 3 tiles below lava ${near.toFixed(0)} C, 6 tiles ${near6.toFixed(0)} C, deep rock elsewhere ${base.toFixed(1)} C, hot spring zone ${spring.toFixed(0)} C`;
});

test('draw functions run against a mock 2D context (clusters, trees, particles, flying cells)', () => {
  const calls: Record<string, number> = {};
  const props: Record<string, unknown> = {};
  const ctx = new Proxy({}, {
    get: (_t, k: string) => (k in props ? props[k] : (..._a: unknown[]) => { calls[k] = (calls[k] || 0) + 1; }),
    set: (_t, k: string, v) => { props[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  (globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class { constructor(public width: number, public height: number) {} getContext() { return ctx; } };
  reset(800, 300, 1000, 470);
  fill(800, 450, 1000, 470, MAT.STONE);
  fill(900, 420, 907, 427, MAT.SNOWBLOCK, F_PLACED);
  const cl = makeCluster(Array.from({ length: 8 }, (_, k) => idx(900 + k, 420)), 0, 0);
  assert(cl && cl.sprite, 'cluster sprite not created');
  fill(950, 380, 953, 449, MAT.WOOD, F_TREE); fill(944, 390, 960, 420, MAT.NEEDLES, F_TREE);
  assert(fellTree(951, 440, -1), 'fellTree');
  for (const k of ['flake', 'spark', 'smoke', 'dust', 'chip', 'blood', 'steam', 'breath', 'debris'] as const) for (let i = 0; i < 5; i++) { spawnFx(k, 910 + i, 400, 3, -3, 1); }
  spawnFx('debris', 912, 400, 1, 1, 1, 0xff7020);
  throwCell(905, 405, MAT.LAVA, 0, 5, -20); throwCell(906, 405, MAT.GRAVEL, 0, 5, -20);
  const view = { x0: 880, y0: 360, w: 140, h: 100, scale: 3, t: 0 };
  drawBodies(ctx, view);
  const rects0 = calls.fillRect || 0;
  drawParticles(ctx, view, false);
  const normal = (calls.fillRect || 0) - rects0;
  drawParticles(ctx, view, true);
  const emissive = (calls.fillRect || 0) - rects0 - normal;
  assert((calls.drawImage || 0) >= 2, `drawImage ${calls.drawImage}`);
  assert((calls.rotate || 0) === 1, 'tree not rotated');
  assert(normal > 30 && emissive >= 6 && emissive < normal, `fillRect normal=${normal} emissive=${emissive}`);
  delete (globalThis as unknown as { OffscreenCanvas?: unknown }).OffscreenCanvas;
  return `drawImage ${calls.drawImage}, rotate ${calls.rotate}, normal pass ${normal} rects, emissive pass ${emissive}`;
});

test('wind lifts loose snow (> 8 m/s) and carries it downwind; mass conserved', () => {
  reset(800, 300, 1000, 470, -15);
  G.wind = 14;
  fill(800, 450, 1000, 470, MAT.STONE);
  fill(840, 440, 880, 449, MAT.SNOW);
  initHeat(); flatTemp(-15); wakeWin();
  const meanX = () => { let s = 0, n = 0; for (let y = 400; y < 450; y++) for (let x = 801; x < 999; x++) if (mat[idx(x, y)] === MAT.SNOW || mat[idx(x, y)] === MAT.PACKED) { s += x; n++; } return [s / n, n]; };
  const [x0, n0] = meanX();
  for (let t = 0; t < 1800; t++) { run(1, { heat: true, bodies: false }); if (t % 30 === 0) wakeWin(); }
  const [x1, n1] = meanX();
  assert(Math.abs(n1 + FC.n - n0) <= 1, `snow ${n0} -> ${n1} (+${FC.n} flying)`);
  assert(x1 > x0 + 3, `centre of mass moved ${(x1 - x0).toFixed(1)} cells`);
  return `snow mass ${n0} -> ${n1}, centre of mass moved ${(x1 - x0).toFixed(1)} cells downwind`;
});

test('smoke rises and decays; steam under a ceiling condenses to water above 0 C', () => {
  reset(800, 300, 1000, 470, 5);
  fill(800, 300, 1000, 470, MAT.STONE);
  fill(810, 320, 900, 449, MAT.AIR);
  initHeat(); flatTemp(5); wakeWin();
  for (let i = 0; i < 60; i++) put(850 + (i % 10), 440 + ((i / 10) | 0), MAT.SMOKE, 0, 100);
  for (let i = 0; i < 40; i++) put(820 + (i % 10), 330 + ((i / 10) | 0), MAT.STEAM, 0, 130);
  run(60);
  let high = 0; for (let y = 320; y < 400; y++) for (let x = 840; x < 870; x++) if (mat[idx(x, y)] === MAT.SMOKE) high++;
  assert(high > 5, `smoke did not rise (${high} cells above y=400)`);
  run(1500);
  assert(count(MAT.SMOKE) === 0, `${count(MAT.SMOKE)} smoke cells never decayed`);
  assert(count(MAT.STEAM) === 0 && count(MAT.WATER) > 25, `steam ${count(MAT.STEAM)}, water ${count(MAT.WATER)}`);
  return `smoke gone, 40 steam -> ${count(MAT.WATER)} water cells`;
});

test('slow sweep near the player collapses a natural over-long snow overhang', () => {
  reset(800, 300, 1000, 470, -10);
  fill(800, 400, 860, 470, MAT.STONE);
  fill(861, 396, 861 + 39, 399, MAT.PACKED);            // natural PACKED cornice, 40 long (limit 15)
  fill(840, 396, 860, 399, MAT.PACKED);
  initHeat(); flatTemp(-10); wakeWin();
  G.player = { x: 850, y: 395, alive: true } as never;
  const before = count(MAT.PACKED);
  for (let t = 0; t < 60 * 30; t++) { stepSim(DT); stepStructure(DT); stepBodies(DT); stepParticles(DT); }
  G.player = null as never;
  const after = count(MAT.PACKED);
  assert(after < before - 60 && after > 40, `PACKED ${before} -> ${after}`);
  return `cornice ${before} -> ${after} cells (rest crumbled to ${count(MAT.SNOW)} loose snow)`;
});

test('fuzz: 2400 ticks of random edits, explosions, fires, thrown cells, falling trees, gas (no exceptions, sane state)', () => {
  reset(800, 250, 1100, 420, -15);
  G.snowfall = 0.5; G.wind = 10;
  fill(800, 380, 1100, 420, MAT.DIRT); fill(800, 360, 1100, 379, MAT.PACKED);
  for (let k = 0; k < 4; k++) { const x = 830 + k * 60; fill(x, 300, x + 3, 359, MAT.WOOD, F_TREE); fill(x - 6, 305, x + 9, 335, MAT.NEEDLES, F_TREE); }
  fill(900, 372, 940, 379, MAT.WATER); fill(960, 340, 975, 359, MAT.PLANK, F_PLACED); fill(985, 345, 1000, 359, MAT.OIL);
  initHeat(); wakeWin();
  const mats = [MAT.SNOW, MAT.WATER, MAT.GRAVEL, MAT.LAVA, MAT.OIL, MAT.METHANE, MAT.SNOWBLOCK, MAT.PLANK, MAT.ICE, MAT.EMBER, MAT.FIRE, MAT.STEAM, MAT.STONE, MAT.SMOKE];
  let booms = 0; onBlast(() => { booms++; });
  for (let t = 0; t < 2400; t++) {
    const x = 810 + ((rnd() * 280) | 0), y = 260 + ((rnd() * 110) | 0);
    const r = rnd();
    if (r < 0.10) { const m = mats[(rnd() * mats.length) | 0]; fill(x, y, x + ((rnd() * 8) | 0), y + ((rnd() * 8) | 0), m, rnd() < 0.5 ? F_PLACED : 0); wakeRect(x - 4, y - 4, x + 12, y + 12, 60); }
    else if (r < 0.12) ignite(x, y);
    else if (r < 0.125) explode(x, y, 4 + rnd() * 12, 0.3 + rnd() * 0.8);
    else if (r < 0.14) { for (let k = 0; k < 20; k++) throwCell(x, y, mats[(rnd() * 5) | 0], 0, (rnd() - 0.5) * 200, -rnd() * 150); }
    else if (r < 0.142) fellTree(830 + ((rnd() * 4) | 0) * 60 + 1, 345, rnd() < 0.5 ? 1 : -1);
    else if (r < 0.15) requestSupportCheck(x - 20, y - 20, x + 20, y + 20);
    else if (r < 0.16) addHeat(x, y, 100);
    if (t % 400 === 399) { G.wind = (rnd() - 0.5) * 30; G.snowfall = rnd(); }
    run(1, { heat: true, struct: true });
  }
  let bad = 0, hot = 0, nan = 0;
  for (let i = 0; i < mat.length; i++) if (mat[i] > 31) bad++;
  for (let i = 0; i < temp.length; i++) { const v = temp[i]; if (!(v === v) || Math.abs(v) > 5000) nan++; if (v > 300) hot++; }
  assert(bad === 0 && nan === 0, `invalid cells ${bad}, bad temps ${nan}`);
  assert(FX.n >= 0 && FX.n <= 3200 && FC.n >= 0 && FC.n <= 4096, 'particle counts out of range');
  return `survived; ${booms} blasts, ${clusters.length} clusters in flight, ${simStats.burning} burning, max chunks awake ${simStats.chunks}, ${hot} tiles > 300 C`;
});

test('performance (heavy): blizzard + avalanche-like pour, 600 ticks', () => {
  reset(800, 250, 1220, 490, -22);
  G.snowfall = 1; G.wind = 14;
  fill(800, 400, 1220, 424, MAT.PACKED); fill(800, 425, 1220, 450, MAT.DIRT); fill(800, 451, 1220, 520, MAT.STONE);
  for (let k = 0; k < 7; k++) { const x = 820 + k * 55; fill(x, 340, x + 3, 399, MAT.WOOD, F_TREE); fill(x - 8, 345, x + 11, 380, MAT.NEEDLES, F_TREE); }
  for (let i = 0; i < 18000; i++) put(800 + ((rnd() * 420) | 0), 250 + ((rnd() * 140) | 0), MAT.SNOW);
  for (let i = 0; i < 5000; i++) put(900 + ((rnd() * 200) | 0), 300 + ((rnd() * 80) | 0), MAT.WATER);
  initHeat(); wakeWin();
  for (let i = 0; i < 60; i++) { stepSim(DT); stepHeat(DT); }
  const N = 600; let worst = 0, sum = 0;
  for (let t = 0; t < N; t++) {
    const t0 = performance.now();
    stepSim(DT); stepHeat(DT); stepStructure(DT); stepBodies(DT); stepParticles(DT);
    const d = performance.now() - t0; sum += d; worst = Math.max(worst, d);
  }
  const avg = sum / N;
  assert(avg < 6, `${avg.toFixed(2)} ms/frame`);
  return `${avg.toFixed(2)} ms/frame avg, worst ${worst.toFixed(1)} (23000 moving cells, wind 14 m/s, snowfall 1), awake chunks ${simStats.chunks}`;
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


// ------------------------------------------------------------------ review round: new scenarios
test('fire outside G.win is parked (neither spreads nor ages) and resumes when the window reaches it', () => {
  reset(800, 300, 960, 470, -5);
  fill(800, 450, 1400, 470, MAT.STONE);
  fill(1200, 420, 1260, 449, MAT.PLANK, F_PLACED);   // a wooden hut far to the east, outside the window
  initHeat(); flatTemp(-5); wakeWin();
  const planks0 = count(MAT.PLANK);
  ignite(1200, 449);
  const fireBefore = count(MAT.FIRE, 1190, 400, 1270, 455);
  run(1500);                                          // 25 s with the window elsewhere
  const planks1 = count(MAT.PLANK);
  assert(planks1 === planks0, `planks burned outside the window: ${planks0} -> ${planks1}`);
  assert(count(MAT.EMBER) === 0 && count(MAT.ASH) === 0, 'fire aged outside the window');
  assert(count(MAT.FIRE, 1190, 400, 1270, 455) === fireBefore, 'fire cells moved outside the window');
  Object.assign(G.win, { x0: 1100, y0: 300, x1: 1300, y1: 470 }); wakeWin();
  run(1200);
  const planks2 = count(MAT.PLANK);
  assert(planks2 < planks0, `fire never resumed (planks ${planks2}/${planks0})`);
  return `parked 25 s with ${planks1}/${planks0} planks, after the window arrived ${planks2}/${planks0} left`;
});

test('neighbouring spruces with touching crowns: felling one leaves the other standing', () => {
  reset(800, 300, 1100, 470);
  fill(800, 450, 1100, 470, MAT.DIRT);
  const tree = (cx: number) => {
    fill(cx, 380, cx + 1, 449, MAT.WOOD, F_TREE);
    for (let y = 384; y < 440; y += 4) { const w = Math.max(2, Math.floor((440 - y) / 4)); fill(cx - w, y, cx - 1, y + 3, MAT.NEEDLES, F_TREE); fill(cx + 2, y, cx + 1 + w, y + 3, MAT.NEEDLES, F_TREE); }
  };
  tree(900); tree(922);   // trunks 22 apart, crowns (up to 14 wide at the bottom) overlap
  const wood0 = count(MAT.WOOD), needles0 = count(MAT.NEEDLES);
  initHeat(); wakeWin();
  let got = 0; onTreeLanded(() => { got++; });
  assert(fellTree(900, 440, -1), 'fellTree returned false');
  const woodLeft = count(MAT.WOOD), needlesLeft = count(MAT.NEEDLES);
  assert(woodLeft === wood0 / 2, `wood ${wood0} -> ${woodLeft}: neighbour trunk was taken too`);
  assert(needlesLeft > 0 && needlesLeft < needles0, `needles ${needles0} -> ${needlesLeft}`);
  for (let t = 0; t < 300; t++) { stepBodies(DT); stepParticles(DT); }
  assert(got === 1, `${got} trees landed`);
  assert(count(MAT.WOOD) === woodLeft, 'second tree vanished');
  return `felled one of two (wood ${wood0} -> ${woodLeft}, needles ${needles0} -> ${needlesLeft})`;
});

test('trunk cells are anchors only while rooted: a cut-off trunk piece falls', () => {
  reset(800, 300, 1000, 470);
  fill(800, 450, 1000, 470, MAT.DIRT);
  fill(900, 380, 903, 449, MAT.WOOD, F_TREE);
  initHeat(); wakeWin();
  requestSupportCheck(880, 370, 930, 452);
  run(60, { struct: true });
  assert(count(MAT.WOOD) === 280 && clusters.length === 0, 'rooted trunk must stand');
  for (let y = 420; y <= 423; y++) fill(900, y, 903, y, MAT.AIR);   // chop a 4-high gap
  requestSupportCheck(880, 370, 930, 452);
  let sawCluster = false;
  for (let t = 0; t < 200; t++) { stepSim(DT); stepStructure(DT); stepBodies(DT); if (clusters.length) sawCluster = true; }
  assert(sawCluster, 'the floating upper trunk never became a cluster');
  // the 40-high piece (y 380..419) drops the 4-cell gap and lands on the stump: its old top rows are empty again
  assert(count(MAT.WOOD, 895, 370, 910, 383) === 0 && mat[idx(901, 384)] === MAT.WOOD, 'upper trunk did not drop onto the stump');
  assert(count(MAT.WOOD) === 280 - 16, `wood ${count(MAT.WOOD)}: cells lost or created`);
  return 'cut-off 40-high piece fell 4 cells and landed on the stump (264 wood cells kept)';
});

test('cluster that lands inside terrain (no clear spot within 40 rows) keeps all its cells', () => {
  reset(800, 250, 1000, 470);
  fill(800, 450, 1000, 470, MAT.STONE);
  fill(880, 300, 940, 449, MAT.STONE);        // a 150-high stone mass
  initHeat(); flatTemp(-10); wakeWin();
  // the cluster is created inside the stone (e.g. a block was placed on top of a collapse): footprint fully overlaps
  const cells: number[] = [];
  for (let y = 340; y < 348; y++) for (let x = 900; x < 908; x++) { put(x, y, MAT.SNOWBLOCK, F_PLACED); cells.push(idx(x, y)); }
  const c = makeCluster(cells, 0, 0);
  assert(c && c.n === 64, 'cluster not created');
  fill(900, 340, 907, 347, MAT.STONE);        // terrain now occupies the whole footprint
  for (let t = 0; t < 600; t++) { stepSim(DT); stepBodies(DT); stepParticles(DT); }
  const total = count(MAT.SNOWBLOCK) + FC.n;
  assert(clusters.length === 0 && total === 64, `block cells 64 -> ${total} (${FC.n} still flying)`);
  return 'all 64 cells re-emitted and settled on top of the stone';
});

test('mass accounting fuzz: snow / ice / water / gravel never appear or vanish (edits, collapses, throws, cluster hits)', () => {
  reset(800, 250, 1100, 470, -15);
  fill(600, 440, 1300, 470, MAT.STONE);   // wide floor: flying cells may leave the arena over the walls
  fill(800, 300, 805, 440, MAT.STONE); fill(1095, 300, 1100, 440, MAT.STONE);
  fill(930, 400, 940, 439, MAT.STONE);
  initHeat(); flatTemp(-15); wakeWin();
  const mats = [MAT.SNOW, MAT.WATER, MAT.GRAVEL, MAT.SNOWBLOCK, MAT.PACKED, MAT.ICE, MAT.SNOW];
  const tracked = new Uint8Array(256); for (const m of mats) tracked[m] = 1;
  let added = 0;
  const addCell = (x: number, y: number, m: number, fl: number) => { const i = idx(x, y); if (mat[i] !== MAT.AIR) return; put(x, y, m, fl); added++; };
  const total = () => {
    let n = 0;
    for (let y = 150; y < 470; y++) for (let x = 600; x <= 1300; x++) if (tracked[mat[idx(x, y)]]) n++;
    for (let k = 0; k < FC.n; k++) if (tracked[FC.m[k]]) n++;
    for (const c of clusters) for (let k = 0; k < c.n; k++) if (tracked[c.m[k]]) n++;
    return n;
  };
  for (let t = 0; t < 1800; t++) {
    const x = 810 + ((rnd() * 280) | 0), y = 260 + ((rnd() * 150) | 0);
    const r = rnd();
    if (r < 0.10) { const m = mats[(rnd() * mats.length) | 0], fl = rnd() < 0.5 ? F_PLACED : 0, w = (rnd() * 9) | 0, h = (rnd() * 9) | 0; for (let yy = y; yy <= y + h; yy++) for (let xx = x; xx <= x + w; xx++) addCell(xx, yy, m, fl); wakeRect(x - 4, y - 4, x + 12, y + 12, 60); }
    else if (r < 0.14) { for (let k = 0; k < 12; k++) if (throwCell(x, y, mats[(rnd() * mats.length) | 0], 0, (rnd() - 0.5) * 220, -rnd() * 160)) added++; }
    else if (r < 0.16) { const x1 = Math.max(810, x - 20), y1 = Math.max(250, y - 20); requestSupportCheck(x1, y1, x + 20, y + 20); }
    else if (r < 0.165) { for (let yy = y; yy < y + 6; yy++) for (let xx = x; xx < x + 6; xx++) if (tracked[mat[idx(xx, yy)]] && PHASE_SOLID(mat[idx(xx, yy)])) { mat[idx(xx, yy)] = MAT.AIR; added--; } edited(x, y, x + 6, y + 6); }
    run(1, { struct: true });
  }
  run(900, { struct: true });
  const t1 = total();
  assert(t1 === added, `tracked mass ${added} expected, ${t1} found (${t1 - added})`);
  return `${added} tracked cells in, ${t1} accounted for after 1800+900 ticks (${clusters.length} clusters, ${FC.n} flying)`;
});
function PHASE_SOLID(m: number) { return m === MAT.PACKED || m === MAT.SNOWBLOCK || m === MAT.ICE; }

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
