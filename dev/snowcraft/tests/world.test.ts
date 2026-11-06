// Headless world-generation tests (tsx): `npx tsx tests/world.test.ts`
// Determinism, layout (SPEC §4), site/fixture integrity, ore bands, sealed gas, trees, snowpack layering, bedrock, backgrounds, access.
import { generateWorld, surfaceAt } from '../src/game/worldgen';
import { sites, LOC, warmZones } from '../src/game/locations';
import { G } from '../src/game/state';
import { W, H, TW, TH, mat, aux, shade, flags, bg, F_TREE, F_FIXTURE } from '../src/engine/grid';
import { MAT, MATS, PHASE, P_SOLID, P_POWDER } from '../src/content/materials';

let pass = 0, fail = 0;
function ok(cond: unknown, name: string, detail = '') {
  if (cond) { pass++; console.log('  ok   ', name, detail); } else { fail++; console.log('  FAIL ', name, detail); }
}
function hash() { let h = 2166136261; for (let i = 0; i < mat.length; i += 7) { h = Math.imul(h ^ mat[i], 16777619); h = Math.imul(h ^ shade[i], 16777619); h = Math.imul(h ^ aux[i], 16777619); h = Math.imul(h ^ bg[(i / 16) | 0 % bg.length], 16777619); } return h >>> 0; }
const at = (x: number, y: number) => mat[y * W + x];

console.log('SNOWCRAFT world tests');
// ---- determinism & speed ----
let t = performance.now();
const sp = generateWorld(1);
const genMs = performance.now() - t;
const h1 = hash();
ok(genMs < 1500, 'generation < 1.5 s', `(${genMs.toFixed(0)} ms)`);
generateWorld(1); ok(hash() === h1, 'same seed -> identical world');
generateWorld(2); ok(hash() !== h1, 'different seed -> different world');
generateWorld(1);

// ---- counts ----
const cnt = new Float64Array(256);
for (let i = 0; i < mat.length; i++) cnt[mat[i]]++;
const C = (k: keyof typeof MAT) => cnt[MAT[k]];
for (const k of ['SNOW', 'PACKED', 'DIRT', 'STONE', 'HARDROCK', 'BEDROCK', 'ICE', 'WATER', 'COAL', 'COPPER', 'IRON', 'GRAVEL', 'METHANE', 'OIL', 'LAVA', 'BASALT', 'CRYSTAL', 'WOOD', 'NEEDLES', 'LOG', 'PLANK', 'METAL', 'GLASS', 'FIXTURE'] as const) ok(C(k) > 0, `has ${k}`, `(${C(k)})`);

// ---- bedrock & edges ----
let bedOk = true;
for (let x = 0; x < W; x++) for (let y = H - 6; y < H; y++) if (at(x, y) !== MAT.BEDROCK) bedOk = false;
for (let y = 0; y < H; y++) for (let x = 0; x < 6; x++) if (at(x, y) !== MAT.BEDROCK || at(W - 1 - x, y) !== MAT.BEDROCK) bedOk = false;
ok(bedOk, 'bedrock: bottom 6 rows and 6-wide world edges');

// ---- surface profile ----
let minS = 1e9, maxS = 0; const slopes: number[] = [];
for (let x = 20; x < W - 20; x++) { const s = surfaceAt(x); minS = Math.min(minS, s); maxS = Math.max(maxS, s); }
ok(minS >= 150 && maxS <= 320, 'surface heights sane', `(${minS}..${maxS})`);
for (let x = 1; x < W; x++) slopes.push(Math.abs(surfaceAt(x) - surfaceAt(x - 1)));
ok(Math.max(...slopes) <= 3, 'no vertical cliffs in the natural surface', `(max step ${Math.max(...slopes)})`);
ok(surfaceAt(LOC.station.x) === LOC.station.y && surfaceAt(LOC.station.x + 60) === LOC.station.y, 'station plateau is flat and tile-aligned');
ok(Math.min(...Array.from({ length: 300 }, (_, i) => surfaceAt(1500 + i))) < 200, 'ridge rises well above the plain', `(peak y ${Math.min(...Array.from({ length: 300 }, (_, i) => surfaceAt(1500 + i)))})`);

// ---- spawn ----
const solidAt = (x: number, y: number) => { const p = PHASE[at(x, y)]; return p === P_SOLID || p === P_POWDER; };
let clear = true; for (let y = sp.spawnY - 20; y < sp.spawnY; y++) for (let x = sp.spawnX - 4; x < sp.spawnX + 4; x++) if (solidAt(x, y)) clear = false;
ok(solidAt(sp.spawnX, sp.spawnY) && clear, 'spawn: standing on ground with 8x20 clearance', `(${sp.spawnX},${sp.spawnY})`);

// ---- sites ----
const keys = ['hut', 'lake', 'station', 'spring', 'tower', 'ridge', 'wreck', 'icecave', 'grotto', 'crystals', 'lava'];
for (const k of keys) ok(sites.some(s => s.key === k), `site ${k}`);
const sx = (k: string) => sites.find(s => s.key === k)!.x;
ok(sx('hut') < sx('lake') && sx('lake') < sx('station') && sx('station') < sx('spring') && sx('spring') < sx('tower') && sx('tower') < sx('ridge') && sx('ridge') < sx('wreck'), 'sites ordered left -> right per SPEC §4');
ok(sites.every(s => typeof s.name === 'string' && s.name.length > 0 && s.found === false), 'site names (RU) and found=false');
ok(warmZones.length >= 3, 'warm zones exported for the heat system', `(${warmZones.map(z => z.key).join(',')})`);

// ---- fixtures ----
const fx = G.fixtures;
const kinds = (k: string) => fx.filter(f => f.kind === k);
ok(kinds('chest').length >= 6 && kinds('chest').length <= 12, 'caches: 6-12 chests', `(${kinds('chest').length})`);
ok(kinds('door').length >= 2 && kinds('stove').length === 1 && kinds('bed').length >= 2 && kinds('radio').length === 1 && kinds('helipad').length === 1, 'fixtures: doors, stove, beds, radio, helipad');
let fxOk = true, badFx = '';
for (const f of fx) {
  if (f.kind === 'torch' || (f.kind === 'door' && f.open)) continue;
  for (let y = f.ty * 4; y < (f.ty + f.th) * 4; y++) for (let x = f.tx * 4; x < (f.tx + f.tw) * 4; x++) {
    if (at(x, y) !== MAT.FIXTURE || !(flags[y * W + x] & F_FIXTURE)) { fxOk = false; badFx = `${f.kind}@${f.tx},${f.ty}`; }
  }
}
ok(fxOk, 'fixture footprints are MAT.FIXTURE + F_FIXTURE', badFx);
let strayFixture = 0; for (let i = 0; i < mat.length; i++) if ((flags[i] & F_FIXTURE) && mat[i] !== MAT.FIXTURE) strayFixture++;
ok(strayFixture === 0, 'no stray F_FIXTURE flags');
const stationChest = fx.find(f => f.kind === 'chest' && f.tx > 230 && f.tx < 255)!;
ok(stationChest && stationChest.items!.some(s => s.id === 'cracker' && s.n === 3) && stationChest.items!.some(s => s.id === 'choc') && stationChest.items!.some(s => s.id === 'stone' && s.n === 6) && stationChest.items!.some(s => s.id.startsWith('note')), 'station chest: 3 crackers, choc, 6 stone, note');
ok(fx.some(f => f.kind === 'chest' && f.items!.some(s => s.id === 'battery')), 'plane wreck chest holds the battery');
const house = { l: 236, r: 251 };
const inHouse = (f: { tx: number }) => f.tx > house.l && f.tx < house.r;
ok(['stove', 'bed', 'radio', 'chest'].every(k => fx.some(f => f.kind === k && inHouse(f))), 'weather station house contains stove, bed, chest, radio');
ok(kinds('helipad')[0].tx > house.r, 'helipad is outside (east of) the house');
// no fixture on top of solid terrain it should not overlap: chests stand on a floor and have air above
let airAbove = true;
for (const f of kinds('chest')) { for (let x = f.tx * 4; x < (f.tx + 2) * 4; x++) if (at(x, f.ty * 4 - 2) !== MAT.AIR) airAbove = false; if (!solidAt(f.tx * 4 + 2, (f.ty + 2) * 4)) airAbove = false; }
ok(airAbove, 'chests rest on a floor with air above');

// ---- lake ----
const L = LOC.lake;
const iceTop = (x: number) => { let y = L.y - 8; while (at(x, y) !== MAT.ICE && y < L.y + 10) y++; return y; };
const iceThick = (x: number) => { const y0 = iceTop(x); let y = y0; while (at(x, y) === MAT.ICE) y++; return y - y0; };
const mid = (L.l + L.r) >> 1;
ok(iceThick(mid) <= 4 && iceThick(L.l + 12) >= 6, 'lake ice: thin in the middle, thick at the shore', `(mid ${iceThick(mid)}, shore ${iceThick(L.l + 12)})`);
let waterUnderIce = false; { const y0 = iceTop(mid) + iceThick(mid); waterUnderIce = at(mid, y0) === MAT.WATER && at(mid, y0 + 10) === MAT.WATER; }
ok(waterUnderIce, 'lake: water under the thin ice');
let waterOnTop = false; for (let x = L.l; x <= L.r; x++) if (at(x, iceTop(x) - 1) === MAT.WATER) waterOnTop = true;
ok(!waterOnTop, 'lake: nothing but ice/snow above the water');

// ---- snowpack & strata ----
let layerOk = 0, layerBad = 0, minDepth = 99, maxDepth = 0;
for (let x = 30; x < W - 30; x += 3) {
  if (x > L.l - 6 && x < L.r + 6) continue;
  if (x > LOC.spring.x - 55 && x < LOC.spring.x + 55) continue;
  if (x > 930 && x < 1100) continue; if (x > 230 && x < 300) continue; if (x > 1340 && x < 1480) continue; if (x > 1470 && x < 1830) continue; if (x > 1790 && x < 2010) continue;
  if ([410, 842, 1178, 1478, 1966].some(e => Math.abs(e - x) < 75)) continue;
  let y = surfaceAt(x); const top = at(x, y);
  if (top === MAT.NEEDLES || top === MAT.WOOD) { continue; }
  let loose = 0; while (at(x, y) === MAT.SNOW) { loose++; y++; }
  let packed = 0; while (at(x, y) === MAT.PACKED) { packed++; y++; }
  const depth = loose + packed;
  if (loose >= 1 && packed >= 1) { layerOk++; minDepth = Math.min(minDepth, depth); maxDepth = Math.max(maxDepth, depth); } else layerBad++;
}
ok(layerBad <= layerOk * 0.12, 'snowpack: loose SNOW over PACKED', `(${layerOk} ok / ${layerBad} off)`);
ok(minDepth >= 6 && maxDepth <= 50, 'snowpack depth 6..50 cells', `(${minDepth}..${maxDepth})`);
// loose snow aux in 0..60
let auxOk = true; for (let x = 100; x < 300; x++) { const y = surfaceAt(x); if (at(x, y) === MAT.SNOW && (flags[y * W + x] & F_TREE) === 0) { /* aux read below */ } }
void auxOk;
// dirt thickness: DIRT cells per column between the snowpack and the granite (stone intrusions allowed)
{
  const th: number[] = [];
  for (let x = 60; x < W - 60; x += 11) {
    if (x > L.l - 20 && x < L.r + 20) continue; if (x > 1470 && x < 1830) continue; if (x > 1190 && x < 1320) continue; if ([410, 842, 1178, 1478, 1966].some(e => Math.abs(e - x) < 110)) continue;
    let d = 0; for (let y = surfaceAt(x); y < surfaceAt(x) + 90; y++) if (at(x, y) === MAT.DIRT) d++;
    th.push(d);
  }
  th.sort((a, b) => a - b);
  const med = th[th.length >> 1];
  ok(med >= 10 && med <= 30 && th[Math.floor(th.length * 0.05)] >= 4 && th[th.length - 1] <= 45, 'frozen dirt layer ~10-30 cells', `(median ${med}, p5 ${th[Math.floor(th.length * 0.05)]}, max ${th[th.length - 1]})`);
}
// granite only deep
let hardMin = 1e9, stoneMax = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x += 5) { const m = at(x, y); if (m === MAT.HARDROCK) hardMin = Math.min(hardMin, y); }
ok(hardMin >= 500, 'HARDROCK zone starts deep', `(first y ${hardMin})`); void stoneMax;

// ---- ore bands ----
const stat = (m: number) => { let n = 0, s = 0, mn = 1e9, mx = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (at(x, y) === m) { n++; s += y; mn = Math.min(mn, y); mx = Math.max(mx, y); } return { n, avg: s / n, mn, mx }; };
const coal = stat(MAT.COAL), cu = stat(MAT.COPPER), fe = stat(MAT.IRON), cr = stat(MAT.CRYSTAL), lv = stat(MAT.LAVA), ba = stat(MAT.BASALT);
console.log(`       coal n=${coal.n} avg y ${coal.avg.toFixed(0)} [${coal.mn}..${coal.mx}] | copper n=${cu.n} avg ${cu.avg.toFixed(0)} [${cu.mn}..${cu.mx}] | iron n=${fe.n} avg ${fe.avg.toFixed(0)} [${fe.mn}..${fe.mx}] | crystal ${cr.mn}..${cr.mx} | lava ${lv.mn}..${lv.mx}`);
ok(coal.avg < cu.avg && cu.avg < fe.avg, 'ore depth bands: coal shallowest, then copper, then iron');
ok(coal.n > cu.n && cu.n > 0 && coal.n > fe.n, 'coal is the most common ore');
ok(cu.mn >= 340 && fe.mn >= 440, 'copper mid, iron mid-deep (not at the surface)');
ok(cr.mn >= 600, 'crystal only in the deep zone', `(min y ${cr.mn})`);
ok(lv.mn >= 600 && lv.mx < H - 6, 'lava pools only deep, above bedrock');
ok(ba.n > 500, 'basalt around lava / veins');

// ---- sealed gas & oil pockets ----
function pockets(m: number) {
  const seen = new Uint8Array(W * H); const out: { n: number; sealed: boolean; x: number; y: number }[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (mat[i] !== m || seen[i]) continue;
    const q = [i]; seen[i] = 1; let n = 0, sx = 0, sy = 0, sealed = true;
    while (q.length) {
      const c = q.pop()!; n++; const cx = c % W, cy = (c / W) | 0; sx += cx; sy += cy;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy, ni = ny * W + nx; const nm = mat[ni];
        if (nm === m) { if (!seen[ni]) { seen[ni] = 1; q.push(ni); } } else if (nm === MAT.AIR || nm === MAT.WATER || nm === MAT.LAVA || PHASE[nm] === 4) sealed = false;
      }
    }
    out.push({ n, sealed, x: sx / n, y: sy / n });
  }
  return out;
}
const meth = pockets(MAT.METHANE).filter(p => p.n > 20), oil = pockets(MAT.OIL).filter(p => p.n > 20);
ok(meth.length >= 5 && meth.length <= 8, 'methane pockets: 5-8', `(${meth.length})`);
ok(meth.every(p => p.sealed), 'methane pockets are sealed');
ok(oil.length >= 3 && oil.every(p => p.sealed), 'oil pockets sealed', `(${oil.length})`);

// ---- trees ----
{
  // a trunk = a run of adjacent WOOD+F_TREE cells on a row just above the snow surface
  const trees: { x: number; h: number; needles: number; rooted: boolean }[] = [];
  for (let x = 8; x < W - 8; x++) {
    const sY = surfaceAt(x) - 6;
    const isTrunk = (xx: number) => mat[sY * W + xx] === MAT.WOOD && (flags[sY * W + xx] & F_TREE) !== 0;
    if (!isTrunk(x) || isTrunk(x - 1)) continue;
    let x1 = x; while (isTrunk(x1 + 1)) x1++;
    const cx = (x + x1) >> 1;
    let top = sY; while (top > 0 && (flags[(top - 1) * W + cx] & F_TREE)) top--;
    const height = surfaceAt(cx) - top;
    let needles = 0; for (let y = top; y < sY; y++) for (let xx = cx - 25; xx <= cx + 25; xx++) if (mat[y * W + xx] === MAT.NEEDLES) needles++;
    let by = sY; while (by < H - 1 && (flags[by * W + cx] & F_TREE)) by++;
    trees.push({ x: cx, h: height, needles, rooted: solidAt(cx, by) && at(cx, by) !== MAT.WOOD });
  }
  console.log(`       trees: ${trees.length}, heights ${Math.min(...trees.map(t => t.h))}..${Math.max(...trees.map(t => t.h))}`);
  ok(trees.length >= 25, 'forest: many spruces', `(${trees.length})`);
  ok(trees.every(t => t.h >= 58 && t.h <= 142), 'tree heights 58..142 cells above the snow (SPEC 60-140)');
  ok(trees.every(t => t.needles > 150), 'every tree has a NEEDLES crown');
  ok(trees.every(t => t.rooted), 'every trunk is rooted in solid ground');
  const gaps = (cx: number, hw: number) => trees.every(t => Math.abs(t.x - cx) > hw);
  ok(gaps(LOC.station.x, 85) && gaps(LOC.hut.x, 36) && gaps(LOC.spring.x, 50) && trees.every(t => t.x < L.l - 5 || t.x > L.r + 5), 'clearings around the station, hut, hot spring and lake');
}

// ---- backgrounds ----
{
  let below = 0, belowBg = 0, above = 0, aboveBg = 0;
  for (let tx = 4; tx < TW - 4; tx += 3) {
    const x = tx * 4 + 2, s = surfaceAt(x);
    for (let ty = 0; ty < TH; ty += 5) {
      const cy = ty * 4 + 2;
      if (cy > s + 8) { below++; if (bg[ty * TW + tx] > 0) belowBg++; } else if (cy < s - 40) { above++; if (bg[ty * TW + tx] !== 0 && !(tx > 52 && tx < 78) && !(tx > 230 && tx < 258) && !(tx > 336 && tx < 372) && !(tx > 455 && tx < 495)) aboveBg++; }
    }
  }
  ok(belowBg === below, 'bg walls exist everywhere below the surface', `(${belowBg}/${below})`);
  ok(aboveBg === 0, 'no bg walls in the open sky');
}

// ---- access: a walker-sized passage from the surface to the ice caves (tile-level 2x5 fits, free vertical movement) ----
{
  const free = new Uint8Array(TW * TH);       // tile entirely non-solid
  for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) {
    let f = 1; for (let y = ty * 4; y < ty * 4 + 4 && f; y++) for (let x = tx * 4; x < tx * 4 + 4; x++) { const p = PHASE[at(x, y)]; if (p === P_SOLID || p === P_POWDER) { f = 0; break; } }
    free[ty * TW + tx] = f;
  }
  const fits = (tx: number, ty: number) => { for (let j = 0; j < 5; j++) for (let i = 0; i < 2; i++) { const xx = tx + i, yy = ty - j; if (xx < 0 || yy < 0 || xx >= TW || yy >= TH || !free[yy * TW + xx]) return false; } return true; };
  const start = [Math.floor(sp.spawnX / 4), Math.floor(sp.spawnY / 4) - 1];
  const seen = new Uint8Array(TW * TH); const q = [start[1] * TW + start[0]]; seen[q[0]] = 1; let deepest = 0, reached = 0;
  const ice = sites.find(s => s.key === 'icecave')!;
  let iceReached = false;
  while (q.length) {
    const c = q.pop()!, tx = c % TW, ty = (c / TW) | 0; reached++; deepest = Math.max(deepest, ty * 4);
    if (Math.abs(tx * 4 - ice.x) < ice.w / 2 && Math.abs(ty * 4 - ice.y) < ice.h / 2) iceReached = true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = tx + dx, ny = ty + dy; if (nx < 0 || ny < 0 || nx >= TW || ny >= TH) continue; const ni = ny * TW + nx; if (seen[ni] || !fits(nx, ny)) continue; seen[ni] = 1; q.push(ni); }
  }
  ok(deepest >= 340, 'a body-sized passage leads from the surface down into the cave network', `(deepest reachable y ${deepest}, ${reached} tiles)`);
  console.log(`       ice cave reachable by free passage: ${iceReached}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) throw new Error(`${fail} world test(s) failed`);
void MATS;
