// Headless world tests (tsx): `npx tsx tests/world.test.ts`
// Determinism, DESIGN §1 layout, sites / fixtures / loot / notes, sea level, ice field, snowpack density layering, no trees,
// structural stability (the support solver must not drop anything at first contact), on-foot reachability (BFS), light/sky/camera maths.
import { generateWorld, surfaceAt, worldInfo } from '../src/game/worldgen';
import { sites, LOC, SEA } from '../src/game/locations';
import { G } from '../src/game/state';
import { W, H, TW, mat, aux, shade, flags, bg, F_TREE, F_FIXTURE } from '../src/engine/grid';
import { MAT, MATS, WALK, PHASE, P_SOLID, P_POWDER } from '../src/content/materials';
import { initStructure, stepStructure, requestSupportCheck, pendingChecks } from '../src/engine/structure';
import { clusters } from '../src/engine/bodies';
import { computeLight, lt, lightAt } from '../src/engine/light';
import { skyState, updateSkyState } from '../src/engine/sky';
import { updateCamera, clampCamera } from '../src/engine/camera';

let pass = 0, fail = 0;
function ok(cond: unknown, name: string, detail = '') {
  if (cond) { pass++; console.log('  ok   ', name, detail); } else { fail++; console.log('  FAIL ', name, detail); }
}
function hash() { let h = 2166136261; for (let i = 0; i < mat.length; i += 7) { h = Math.imul(h ^ mat[i], 16777619); h = Math.imul(h ^ shade[i], 16777619); h = Math.imul(h ^ aux[i], 16777619); } for (let i = 0; i < bg.length; i += 3) h = Math.imul(h ^ bg[i], 16777619); return h >>> 0; }
const at = (x: number, y: number) => mat[y * W + x];

console.log('SNOWCRAFT world tests (High-Arctic coast)');
// ---- determinism & speed ----
let t = performance.now();
const sp = generateWorld(1);
const genMs = performance.now() - t;
const h1 = hash();
ok(genMs < 1500, 'generation < 1.5 s', `(${genMs.toFixed(0)} ms)`);
generateWorld(1); ok(hash() === h1, 'same seed -> identical world');
const fx1 = G.fixtures.map(f => f.kind + f.tx + ',' + f.ty).join(';');
generateWorld(1); ok(G.fixtures.map(f => f.kind + f.tx + ',' + f.ty).join(';') === fx1, 'same seed -> identical fixtures');
generateWorld(2); ok(hash() !== h1, 'different seed -> different world');
generateWorld(1);

// ---- materials: the Arctic palette, no forest / ore-sandbox leftovers ----
const cnt = new Float64Array(256);
for (let i = 0; i < mat.length; i++) cnt[mat[i]]++;
const C = (k: keyof typeof MAT) => cnt[MAT[k]];
for (const k of ['SNOW', 'PACKED', 'ICE', 'WATER', 'DIRT', 'GRAVEL', 'STONE', 'HARDROCK', 'BEDROCK', 'COAL', 'SOAPSTONE', 'LICHEN', 'WHALEBONE', 'WOOD', 'LOG', 'PLANK', 'METAL', 'GLASS', 'CANVAS', 'METHANE', 'FIXTURE'] as const) ok(C(k) > 0, `has ${k}`, `(${C(k)})`);
for (const k of ['NEEDLES', 'LAVA', 'CRYSTAL', 'COPPER', 'IRON', 'OIL'] as const) ok(C(k) === 0, `no ${k} (not part of the Arctic design)`);
let treeFlags = 0; for (let i = 0; i < flags.length; i++) if (flags[i] & F_TREE) treeFlags++;
ok(treeFlags === 0 && C('NEEDLES') === 0, 'no trees anywhere (no F_TREE cells, no needles)');
ok(C('WOOD') > 300, 'driftwood logs are WOOD cells', `(${C('WOOD')})`);

// ---- bedrock & edges ----
let bedOk = true;
for (let x = 0; x < W; x++) for (let y = H - 6; y < H; y++) if (at(x, y) !== MAT.BEDROCK) bedOk = false;
for (let y = 0; y < H; y++) for (let x = 0; x < 6; x++) if (at(x, y) !== MAT.BEDROCK) bedOk = false;
for (let y = SEA - 24; y < H; y++) for (let x = W - 6; x < W; x++) if (at(x, y) !== MAT.BEDROCK) bedOk = false;
ok(bedOk, 'bedrock: bottom rows, west edge, east wall');

// ---- surface profile (side view, sea level ≈ row 300) ----
const surfs = Array.from({ length: W - 60 }, (_, i) => surfaceAt(i + 30));
ok(Math.min(...surfs.slice(0, 1990)) >= 110 && Math.max(...surfs) <= 304, 'surface heights sane', `(${Math.min(...surfs)}..${Math.max(...surfs)})`);
ok(surfaceAt(LOC.station.x0 + 20) === LOC.station.y && surfaceAt(LOC.station.x1 - 20) === LOC.station.y && surfaceAt(700) === LOC.station.y, 'station plateau is flat and tile-aligned', `(y ${LOC.station.y})`);
ok(surfaceAt(150) < 200, 'the cape hill rises well above the tundra', `(y ${surfaceAt(150)})`);
ok(surfaceAt(445) < surfaceAt(520) && surfaceAt(445) < 250, 'cairn hill is a summit', `(y ${surfaceAt(445)})`);
let maxStep = 0, stepAt = 0; for (let x = 1; x < 1076; x++) { const d = Math.abs(surfaceAt(x) - surfaceAt(x - 1)); if (d > maxStep) { maxStep = d; stepAt = x; } }
ok(maxStep <= 2, 'land surface has no cliffs (the hill flank is a walkable slope)', `(max step ${maxStep} @${stepAt})`);

// ---- sea level, water, ice sheet ----
const firstWater = (x: number) => { let y = 200; while (y < H && at(x, y) !== MAT.WATER) y++; return y; };
{ let wcols = 0, n = 0; for (let x = 1960; x < 2038; x++) { n++; if (at(x, SEA) === MAT.WATER) wcols++; } ok(wcols / n > 0.5 && at(1990, SEA - 1) !== MAT.WATER, 'open sea edge: water surface at row 300', `(${wcols}/${n} columns open, first water ${firstWater(1990)})`); }
let ocean = true; for (let x = 1960; x < 2038; x += 6) if (at(x, SEA) !== MAT.WATER && at(x, SEA - 1) !== MAT.ICE && at(x, SEA) !== MAT.ICE) ocean = false;
ok(ocean, 'open sea: water (or brash ice) along the whole edge');
let fastOk = true, thick: number[] = [];
const holeX = new Set(worldInfo.sealHoles.flatMap(h => [h.x - 1, h.x, h.x + 1, h.x + 2, h.x + 3, h.x + 4]));
for (let x = 1120; x < 1440; x += 5) { if (holeX.has(x) || (x > 1320 && x < 1430)) continue; let n = 0; while (at(x, 298 + n) === MAT.ICE) n++; thick.push(n); if (n < 12 || at(x, 298 + n) !== MAT.WATER) fastOk = false; }
ok(fastOk, 'fast ice: ICE >= 12 cells (~1 m+) over sea WATER', `(thickness ${Math.min(...thick)}..${Math.max(...thick)})`);
ok(worldInfo.seaLevel === SEA && SEA === 300, 'worldInfo.seaLevel = 300');
let seabedOk = true; for (let x = 1100; x < 2040; x += 25) { if (x > 1325 && x < 1425 || x > 1655 && x < 1860) continue; let y = SEA + 1; while (y < H && (at(x, y) === MAT.WATER || at(x, y) === MAT.ICE)) y++; if (!(at(x, y) === MAT.GRAVEL || at(x, y) === MAT.DIRT || at(x, y) === MAT.STONE)) seabedOk = false; if (y < 301 || y > 520) seabedOk = false; }
ok(seabedOk, 'sea column ends in a seabed of gravel / rock', '');

// ---- ice field (drift system input) ----
const ifd = worldInfo.iceField;
ok(ifd.floes.length >= 6 && ifd.cracks.length >= 5, 'ice field: floes and crack lines exported', `(${ifd.floes.length} floes, ${ifd.cracks.length} cracks, ${ifd.leads.length} leads, ${ifd.ridges.length} ridges)`);
let floeOk = true; ifd.floes.forEach((f, i) => { if (f.x1 <= f.x0 || f.thick < 8 || (i > 0 && f.x0 <= ifd.floes[i - 1].x1)) floeOk = false; if (at(f.x0 + 6, SEA + 2) !== MAT.ICE && at(f.x1 - 6, SEA + 2) !== MAT.ICE) floeOk = false; });
ok(floeOk, 'floes are ordered, disjoint and made of ice');
ok(new Set(ifd.floes.map(f => f.thick)).size >= 5, 'floes vary in thickness', `(${[...new Set(ifd.floes.map(f => f.thick))].join(',')})`);
ok(ifd.leads.filter(l => l.thin).length >= 2, 'at least two thin-ice leads', `(${ifd.leads.filter(l => l.thin).map(l => l.x0 + '-' + l.x1).join(' ')})`);
ok(ifd.leads.some(l => !l.thin), 'an open-water lead exists');
let leadOk = true; for (const l of ifd.leads) { const x = (l.x0 + l.x1) >> 1; const top = at(x, SEA), under = at(x, SEA + 6); if (l.thin ? !(top === MAT.ICE || at(x, SEA + 1) === MAT.ICE) : !(top === MAT.WATER && under === MAT.WATER)) leadOk = false; }
ok(leadOk, 'leads: thin ones are covered by new ice, open ones are water');
let crackOk = true; for (const c of ifd.cracks) { if (c < ifd.fastX1 - 20 || c > ifd.seaEdgeX) crackOk = false; }
ok(crackOk, 'cracks lie in the pack-ice zone');
ok(ifd.ridges.length >= 3, 'pressure ridges / hummocks exported', `(${ifd.ridges.map(r => r.x).join(',')})`);
let ridgeTall = 0; for (const r of ifd.ridges.filter(r => r.w >= 40)) { let top = 300; for (let x = r.x - 24; x <= r.x + 24; x++) { let y = 100; while (y < H && at(x, y) === MAT.AIR) y++; top = Math.min(top, y); } if (top < 290) ridgeTall++; }
ok(ridgeTall >= 2, 'pressure ridges stand clearly above the floes');
ok(ifd.hiddenCracks.length >= 1 && at(ifd.hiddenCracks[0], 293) !== MAT.AIR, 'a hidden (snow-bridged) crack exists');

// ---- seal holes ----
const sh = worldInfo.sealHoles;
ok(sh.length >= 6, 'seal breathing holes >= 6', `(${sh.length}: ${sh.filter(h => h.floe === 'fast').length} fast, ${sh.filter(h => h.floe === 'pack').length} pack)`);
let holeOk = true;
for (const h of sh) { let y = h.y - 4; while (y < H && at(h.x + 1, y) === MAT.AIR) y++; if (at(h.x + 1, y) !== MAT.WATER) holeOk = false; if (y > SEA + 1 || y < SEA - 4) holeOk = false; if (at(h.x + 1, h.y + 12) === MAT.AIR) { /* shaft must end in water below the ice */ } let n = 0; while (at(h.x + 1, y + n) === MAT.WATER && n < 30) n++; if (n < 8) holeOk = false; if (at(h.x - 6, h.y + 14) === MAT.AIR && at(h.x - 6, h.y + 14) === MAT.WATER) holeOk = false; }
ok(holeOk, 'every seal hole is an open shaft from the snow down to the water');

// ---- sites ----
const keys = ['cape', 'mine', 'minehut', 'icelake', 'cairn', 'station', 'shed', 'beach', 'whale', 'fastice', 'iceberg', 'icecave', 'pack', 'ship', 'openSea'];
for (const k of keys) ok(sites.some(s => s.key === k), `site ${k}`);
const sx = (k: string) => sites.find(s => s.key === k)!.x;
ok(sx('mine') < sx('cairn') && sx('cairn') < sx('station') && sx('station') < sx('shed') && sx('shed') < sx('beach') && sx('beach') < sx('fastice') && sx('fastice') < sx('iceberg') && sx('iceberg') < sx('pack') && sx('pack') < sx('ship') && sx('ship') < sx('openSea'), 'zones ordered left -> right per DESIGN §1');
ok(sites.every(s => typeof s.name === 'string' && s.name.length > 0 && s.found === false), 'site names (RU) and found=false');
ok(sites.find(s => s.key === 'ship')!.name.includes('Заря') && sites.find(s => s.key === 'station')!.name.includes('Безмолвия'), 'ship «Заря» and station «Мыс Безмолвия» are named');

// ---- fixtures ----
const fx = G.fixtures;
const kinds = (k: string) => fx.filter(f => f.kind === k);
ok(kinds('stove').length >= 2 && kinds('door').length >= 3 && kinds('bed').length >= 3 && kinds('radio').length === 1 && kinds('table').length >= 2, 'fixtures: stoves, doors, beds, radio, tables', `(stove ${kinds('stove').length}, door ${kinds('door').length}, bed ${kinds('bed').length})`);
ok(kinds('drum').length >= 5 && kinds('barometer').length === 1 && kinds('kennel').length === 1 && kinds('flag').length === 1 && kinds('mast').length === 1 && kinds('cart').length >= 1 && kinds('signal_fire').length === 1, 'fixtures: drums, barometer, kennel, flag pole, mast, cart, signal fire');
ok(kinds('chest').length >= 9 && kinds('chest').length <= 14, 'caches: 9-14 chests', `(${kinds('chest').length})`);
const NONSOLID = ['campfire', 'fat_lamp', 'torch', 'bed', 'snare', 'cache', 'drying_rack', 'skin_bed', 'hide_door', 'signal_fire', 'kennel', 'flag', 'mast', 'cart'];
let fxOk = true, badFx = '';
for (const f of fx) {
  if (NONSOLID.includes(f.kind)) continue;
  for (let y = f.ty * 4; y < (f.ty + f.th) * 4; y++) for (let x = f.tx * 4; x < (f.tx + f.tw) * 4; x++) {
    if (at(x, y) !== MAT.FIXTURE || !(flags[y * W + x] & F_FIXTURE)) { fxOk = false; badFx = `${f.kind}@${f.tx},${f.ty}`; }
  }
}
ok(fxOk, 'solid fixture footprints are MAT.FIXTURE + F_FIXTURE', badFx);
let strayFixture = 0; for (let i = 0; i < mat.length; i++) if ((flags[i] & F_FIXTURE) && mat[i] !== MAT.FIXTURE) strayFixture++;
ok(strayFixture === 0, 'no stray F_FIXTURE flags');
let floating = 0; for (const f of fx) { if (f.kind === 'barometer' || f.kind === 'flag' || f.kind === 'mast' || NONSOLID.includes(f.kind) && f.kind !== 'bed' && f.kind !== 'cart' && f.kind !== 'kennel') continue; const y = (f.ty + f.th) * 4; let sup = 0; for (let x = f.tx * 4; x < (f.tx + f.tw) * 4; x++) { const m = at(x, y); if (PHASE[m] === P_SOLID || PHASE[m] === P_POWDER) sup++; } if (sup < f.tw * 4 * 0.5 && f.kind !== 'door') { floating++; console.log('       floating', f.kind, f.tx, f.ty); } }
ok(floating === 0, 'furniture and chests stand on the ground (no floating fixtures)');

// ---- loot, radio parts, notes ----
const chests = worldInfo.chests;
const has = (site: string, id: string) => chests.some(c => c.site === site && c.items.some(s => s.id === id));
ok(has('ship', 'radio_triode'), 'radio part #1 (лампа-триод) in the ship hold chest');
ok(has('minehut', 'radio_coil'), 'radio part #2 (катушка) in the miner hut chest');
ok(has('shed', 'battery'), 'radio part #3 (аккумулятор) in the generator shed');
{
  const b = worldInfo.radioParts.battery; let snow = 0; for (let y = b.y - 30; y < b.y - 8; y++) { const m = at(b.x, y); if (m === MAT.PACKED || m === MAT.SNOW) snow++; }
  ok(snow >= 8, 'the battery chest lies buried under a deep drift', `(${snow} snow cells above)`);
}
ok(has('minehut', 'pick') && has('shed', 'axe') && has('ship', 'saw') && has('station', 'lantern') && has('station', 'flare_gun') && has('ship', 'flint') && has('ship', 'barometer'), 'tools: pick (mine), axe (shed), saw + flint + barometer (ship), lantern + flare gun (station)');
ok(has('station', 'matches') && has('station', 'can') && has('icecave', 'fat') && has('shed', 'coal'), 'supplies: station rations and matches, coal in the shed, fat in the iceberg cave');
const ids = worldInfo.notes.map(n => n.id);
for (let n = 1; n <= 14; n++) ok(ids.filter(i => i === 'n' + n).length === 1, `note n${n} placed exactly once`, '');
ok(ids.some(i => i.startsWith('s')), 'station keeper log entries (s*) exist');
ok(worldInfo.notes.every(n => n.x > 6 && n.x < W - 6 && n.y > 60 && n.y < H - 6), 'notes lie inside the world');
const dropNotes = G.drops.filter(d => d.item.startsWith('note_'));
ok(dropNotes.length >= 6 && dropNotes.every(d => d.item === 'note_' + worldInfo.notes.find(n => 'note_' + n.id === d.item)?.id), 'floor notes are drops with note_<id> items', `(${dropNotes.length})`);

// ---- snowpack density layering (aux encodes density: rho = 60 + aux*1.6) ----
{
  const loose: number[] = [], settled: number[] = [], slab: number[] = [];
  for (let x = 120; x < 1070; x += 3) {
    let y = surfaceAt(x); let k = 0;
    while (y < H && (at(x, y) === MAT.SNOW || at(x, y) === MAT.PACKED) && k < 40) { const a = aux[y * W + x]; if (at(x, y) === MAT.SNOW) loose.push(a); else if (k > 6) (a >= 150 ? slab : settled).push(a); y++; k++; }
  }
  for (let x = 1130; x < 1440; x += 3) { let y = surfaceAt(x), k = 0; while (y < H && (at(x, y) === MAT.SNOW || at(x, y) === MAT.PACKED) && k < 40) { const a = aux[y * W + x]; if (at(x, y) === MAT.SNOW) loose.push(a); else (a >= 150 ? slab : settled).push(a); y++; k++; } }
  const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  ok(loose.length > 300 && avg(loose) < 60, 'fresh snow on top is loose (rho ~ 60..160)', `(avg aux ${avg(loose).toFixed(0)} = ${(60 + avg(loose) * 1.6).toFixed(0)} kg/m3, n=${loose.length})`);
  ok(settled.length > 500 && avg(settled) > 80 && avg(settled) < 150, 'settled pack below is mid density', `(avg ${(60 + avg(settled) * 1.6).toFixed(0)} kg/m3)`);
  ok(slab.length > 500, 'wind slabs (aux >= 150 = ideal block snow, rho 300-470) exist', `(${slab.length} cells, max aux ${Math.max(...slab)})`);
  const ideal = slab.filter(a => a >= 150 && a <= 200).length; ok(ideal > 150, 'a good share of slab snow is in the 250-380 kg/m3 cutting window', `(${ideal})`);
  let maxA = 0; for (let i = 0; i < mat.length; i++) if (mat[i] === MAT.PACKED && aux[i] > maxA) maxA = aux[i];
  ok(maxA <= 255, 'PACKED aux within the byte', `(max ${maxA})`);
  // scoured crest vs lee drift
  const mean = (x0: number, x1: number) => { let a = 0, n = 0; for (let x = x0; x < x1; x += 2) { a += snowDepthAt(x); n++; } return a / n; };
  const crest = mean(100, 140), lee = mean(200, 290);
  ok(crest < lee, 'snow is scoured thin on windward crests and deep in the lee', `(crest ${crest}, lee ${lee})`);
}
function snowDepthAt(x: number) { let y = surfaceAt(x), n = 0; while ((at(x, y) === MAT.SNOW || at(x, y) === MAT.PACKED) && n < 60) { y++; n++; } return n; }

// ---- spawn ----
const solidAt = (x: number, y: number) => { const p = PHASE[at(x, y)]; return p === P_SOLID || p === P_POWDER; };
let clear = true; for (let y = sp.spawnY - 20; y < sp.spawnY; y++) for (let x = sp.spawnX - 4; x < sp.spawnX + 4; x++) if (solidAt(x, y) || at(x, y) === MAT.FIXTURE) clear = false;
ok(solidAt(sp.spawnX, sp.spawnY) && clear, 'spawn: standing on ground with 8x20 clearance', `(${sp.spawnX},${sp.spawnY})`);

// ---- mine details ----
const M_ = LOC.mine;
const floorD = (x: number) => M_.floorA + 4 * Math.floor((M_.rampTop - x) / 5);
{
  let coalNearTunnel = 0, soap = 0; for (let y = 230; y < 420; y++) for (let x = 60; x < 380; x++) { const m = at(x, y); if (m === MAT.COAL) coalNearTunnel++; else if (m === MAT.SOAPSTONE) soap++; }
  ok(coalNearTunnel > 400 && soap > 150, 'mine: coal seams and a soapstone vein', `(coal ${coalNearTunnel}, soapstone ${soap})`);
  let rails = 0; for (let x = M_.portalX - 40; x < M_.portalX + 40; x++) if (at(x, M_.floorA - 1) === MAT.METAL) rails++;
  ok(rails > 40, 'rails run out of the adit', `(${rails} rail cells)`);
  let rubble = 0, rubbleAir = 0; for (let x = M_.collapse[0]; x < M_.collapse[1]; x++) for (let y = floorD(x) - 20; y < floorD(x); y++) { const m = at(x, y); if (m === MAT.GRAVEL || m === MAT.LOG || m === MAT.PLANK) rubble++; else if (m === MAT.AIR) rubbleAir++; }
  ok(rubble > 300 && rubbleAir < 100, 'collapsed section blocks the adit with diggable rubble (gravel / timber)', `(${rubble} rubble, ${rubbleAir} air in the walking band)`);
  let methane = 0; for (let y = M_.floorB - 28; y < M_.floorB; y++) for (let x = M_.pocket[0]; x < M_.pocket[1]; x++) if (at(x, y) === MAT.METHANE) methane++;
  ok(methane > 600, 'sealed methane pocket behind a plank bulkhead', `(${methane} cells)`);
  let sealed = true; for (let y = M_.floorB - 28 - 2; y <= M_.floorB; y++) for (let x = M_.pocket[0] - 1; x <= M_.pocket[1]; x++) { if (at(x, y) !== MAT.METHANE) continue; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const m = at(x + dx, y + dy); if (m === MAT.AIR) sealed = false; } }
  ok(sealed, 'the methane pocket is airtight (no air neighbour)');
  let bulk = 0; for (let y = M_.floorB - 28; y < M_.floorB; y++) if (at(M_.bulkhead + 1, y) === MAT.PLANK || at(M_.bulkhead + 1, y) === MAT.METAL) bulk++;
  ok(bulk >= 26, 'plank bulkhead seals the pocket', `(${bulk}/28 rows)`);
  let ice = 0, lakeWater = 0; for (let y = 360; y < 420; y++) for (let x = M_.lake.x0; x < M_.lake.x1; x++) { if (at(x, y) === MAT.ICE) ice++; if (at(x, y) === MAT.WATER) lakeWater++; }
  ok(ice > 300 && lakeWater > 1000, 'underground ice lake: thick ice over water', `(ice ${ice}, water ${lakeWater})`);
}

// ---- beach ----
{
  let bone = 0, wood = 0, shoreIce = 0, gravel = 0; for (let y = 200; y < 320; y++) for (let x = 890; x < 1110; x++) { const m = at(x, y); if (m === MAT.WHALEBONE) bone++; else if (m === MAT.WOOD) wood++; else if (m === MAT.ICE && x < 1100) shoreIce++; else if (m === MAT.GRAVEL) gravel++; }
  ok(bone > 500 && wood > 400 && shoreIce > 150 && gravel > 1000, 'beach: whale skeleton, driftwood, shore ice blocks, gravel', `(bone ${bone}, wood ${wood}, ice ${shoreIce}, gravel ${gravel})`);
  ok(worldInfo.driftwood.length >= 10, 'driftwood spots exported', `(${worldInfo.driftwood.length})`);
  const tc = worldInfo.spots.tideCrack; let crack = 0; for (let y = 284; y < 300; y++) if (at(tc.x, y) === MAT.AIR || at(tc.x, y) === MAT.WATER) crack++;
  ok(crack >= 10, 'tide crack opens the shore ice down to the water', `(${crack}/16)`);
  ok(worldInfo.lichen.length >= 5, 'lichen patches on the tundra', `(${worldInfo.lichen.length})`);
}

// ---- station: log house, drafty until snow is banked ----
{
  const { L, R } = LOC.house; const F = LOC.station.y / 4;
  let plank = 0, log = 0, glass = 0; for (let y = (F - 14) * 4; y < F * 4 + 4; y++) for (let x = (L - 1) * 4; x < (R + 2) * 4; x++) { const m = at(x, y); if (m === MAT.PLANK) plank++; else if (m === MAT.LOG) log++; else if (m === MAT.GLASS) glass++; }
  ok(plank > 800 && log > 100 && glass >= 16, 'main house: plank floor/roof, log eaves, glass windows', `(plank ${plank}, log ${log}, glass ${glass})`);
  // draught tiles: planks with chinks, fewer than 8 wind-blocking cells
  let draft = 0; for (let ty = F - 12; ty < F; ty++) for (let tx = L - 1; tx <= R + 1; tx++) { let n = 0; for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) if (at(tx * 4 + dx, ty * 4 + dy) === MAT.PLANK) n++; if (n > 0 && n < 8 && at(tx * 4 + 1, ty * 4 + 1) === MAT.AIR) draft++; }
  ok(draft >= 2, 'the house is drafty: chinked plank tiles that do not block wind', `(${draft} tiles)`);
  const stove = kinds('stove')[0], radio = kinds('radio')[0];
  ok(stove && radio && (stove.data as { smokeY: number }).smokeY < F * 4 - 40, 'stove has a chimney through the roof (data.smokeX/Y)', `(smokeY ${(stove?.data as { smokeY: number })?.smokeY})`);
  const d = kinds('door'); ok(d.length >= 3 && d.every(f => !f.open), 'doors start closed');
  ok(worldInfo.spots.barometer.x > 600 && worldInfo.spots.kennel.x > 500 && worldInfo.spots.mast.x > 600, 'barometer, kennel and meteo mast spots exported');
}

// ---- iceberg & ship ----
{
  const c = worldInfo.spots.icecave; let air = 0, ice = 0; for (let y = c.y - 20; y < c.y + 10; y++) for (let x = c.x - 12; x < c.x + 12; x++) { if (at(x, y) === MAT.AIR) air++; }
  for (let y = 240; y < 300; y++) for (let x = LOC.iceberg.x - 50; x < LOC.iceberg.x + 50; x++) if (at(x, y) === MAT.ICE) ice++;
  ok(air > 250 && ice > 1800, 'iceberg: tall ICE mass with an ice cave inside', `(cave air ${air}, ice ${ice})`);
  let metal = 0, plankS = 0, canvas = 0, coal = 0; for (let y = 180; y < 350; y++) for (let x = LOC.ship.x - 100; x < LOC.ship.x + 120; x++) { const m = at(x, y); if (m === MAT.METAL) metal++; else if (m === MAT.PLANK) plankS++; else if (m === MAT.CANVAS) canvas++; else if (m === MAT.COAL) coal++; }
  ok(metal > 400 && plankS > 2500 && canvas > 300 && coal > 80, 'ghost ship: METAL + PLANK hull, canvas sails, coal bunker', `(metal ${metal}, plank ${plankS}, canvas ${canvas}, coal ${coal})`);
  const cab = worldInfo.spots.shipCabin; ok(at(cab.x, cab.y - 8) === MAT.AIR && kinds('stove').some(f => Math.abs(f.tx * 4 - LOC.ship.x) < 100), 'the cabin below deck is open air with a stove');
}

// ---- backgrounds ----
{
  const bgs = new Set<number>(); for (let i = 0; i < bg.length; i++) bgs.add(bg[i]);
  ok([0, 1, 2, 3, 4, 5, 6, 7, 8].every(b => bgs.has(b)), 'background wall types used', `(${[...bgs].sort().join(',')})`);
  let skyUnder = 0; for (let tx = 0; tx < TW; tx += 2) { const ty0 = (surfaceAt(tx * 4 + 2) >> 2) + 8; if (bg[ty0 * TW + tx] === 0 && at(tx * 4 + 2, ty0 * 4 + 2) !== MAT.AIR) skyUnder++; }
  ok(skyUnder === 0, 'no sky background behind solid ground');
}

// ---- structural stability: the support solver must not drop anything at first contact ----
{
  const before = mat.slice();
  initStructure();
  for (const s of sites) requestSupportCheck(Math.max(0, (s.x - s.w / 2) | 0), Math.max(0, (s.y - s.h / 2) | 0), Math.min(W - 1, (s.x + s.w / 2) | 0), Math.min(H - 1, (s.y + s.h / 2) | 0));
  let n = 0; while (pendingChecks() > 0 && n++ < 100000) stepStructure(1 / 60);
  let changed = 0; for (let i = 0; i < mat.length; i++) if (mat[i] !== before[i]) changed++;
  ok(changed <= 60, 'structure solver: houses, ship, berg, whale, mine stand (<= 60 cells move on the first full check)', `(${changed} cells, ${clusters.length} clusters)`);
  mat.set(before); clusters.length = 0;
}

// ---- reachability on foot (BFS with an 8x20 box: step-up 8, jump gaps <= 6) ----
{
  const solid = new Uint8Array(W * H), door = new Uint8Array(W * H);
  for (const f of G.fixtures) if (f.kind === 'door') for (let y = f.ty * 4; y < (f.ty + f.th) * 4; y++) for (let x = f.tx * 4; x < (f.tx + f.tw) * 4; x++) door[y * W + x] = 1;
  const build = () => { for (let i = 0; i < solid.length; i++) solid[i] = WALK[mat[i]] === 1 && !door[i] ? 1 : mat[i] === MAT.WATER ? 2 : 0; };
  const cum = new Uint16Array(W * (H + 1));            // per column prefix count of blocking cells (solid or water)
  const rebuild = () => { build(); for (let x = 0; x < W; x++) { let c = 0; cum[x * (H + 1)] = 0; for (let y = 0; y < H; y++) { if (solid[y * W + x]) c++; cum[x * (H + 1) + y + 1] = c; } } };
  const free = (x: number, y: number) => { if (x < 8 || x > W - 9 || y < 22 || y >= H - 7) return false; for (let xx = x - 4; xx < x + 4; xx++) { const b = xx * (H + 1); if (cum[b + y + 1] - cum[b + y - 19] !== 0) return false; } return true; };
  const sup = (x: number, y: number) => { for (let xx = x - 4; xx < x + 4; xx++) if (solid[(y + 1) * W + xx] === 1) return true; return false; };
  const bfs = () => {
    rebuild();
    const seen = new Uint8Array(W * H), q = new Int32Array(W * H); let qh = 0, qt = 0;
    const push = (x: number, y: number) => { const i = y * W + x; if (!seen[i]) { seen[i] = 1; q[qt++] = i; } };
    push(sp.spawnX, sp.spawnY - 1);
    while (qh < qt) {
      const i = q[qh++], x = i % W, y = (i / W) | 0;
      if (!sup(x, y)) { if (free(x, y + 1)) push(x, y + 1); continue; }
      for (const d of [-1, 1]) {
        const nx = x + d; let moved = false;
        if (free(nx, y)) { push(nx, y); moved = true; } else for (let k = 1; k <= 8; k++) { if (free(nx, y - k) && free(x, y - k)) { push(nx, y - k); moved = true; break; } }
        if (!moved || !sup(nx, y)) for (let g = 2; g <= 6; g++) for (let dy = -6; dy <= 3; dy++) { const nx2 = x + d * g, ny2 = y + dy; if (free(nx2, ny2) && sup(nx2, ny2)) { let clearP = true; for (let k = 1; k < g; k++) if (!free(x + d * k, Math.min(y, ny2) - 2)) { clearP = false; break; } if (clearP) push(nx2, ny2); } }
      }
    }
    return seen;
  };
  const near = (seen: Uint8Array, x: number, y: number, rx = 10, ry = 14) => { for (let dy = -ry; dy <= ry; dy++) for (let dx = -rx; dx <= rx; dx++) { const xx = x + dx, yy = y + dy; if (xx > 0 && yy > 0 && xx < W && yy < H && seen[yy * W + xx]) return true; } return false; };
  const chestPos = (site: string, id?: string) => { const c = chests.find(c => c.site === site && (!id || c.items.some(s => s.id === id)))!; return c; };
  t = performance.now();
  const s1 = bfs();
  console.log(`       (walk BFS ${(performance.now() - t).toFixed(0)} ms)`);
  ok(near(s1, chestPos('station').x, chestPos('station').y), 'on foot: station chest (through the doors, over the furniture)');
  ok(near(s1, chestPos('cairn').x, chestPos('cairn').y), 'on foot: cairn tin box');
  ok(near(s1, worldInfo.spots.portal.x, worldInfo.spots.portal.y), 'on foot: mine portal');
  ok(near(s1, M_.collapse[1] + 12, floorD(M_.collapse[1] + 12) - 2), 'on foot: the adit and the decline up to the collapse');
  ok(near(s1, 790, LOC.station.y - 3), 'on foot: the generator shed through its west door');
  ok(!near(s1, chestPos('minehut').x, chestPos('minehut').y, 6, 8), 'the miner hut is beyond the collapse (must dig first)');
  ok(!near(s1, M_.lake.x0 + 40, M_.lake.ice - 6, 6, 8), 'the ice lake cavern is sealed in the rock (dig down to it)');
  // dig the collapse and the shed drift (shovel-diggable stuff), then everything else must be walkable
  for (let x = M_.collapse[0]; x < M_.collapse[1]; x++) for (let y = floorD(x) - 28; y < floorD(x); y++) { const m = at(x, y); if (m === MAT.GRAVEL || m === MAT.LOG || m === MAT.PLANK) mat[y * W + x] = MAT.AIR; }
  { const { L, R } = LOC.shed; for (let x = (L + 1) * 4; x < (R + 6) * 4; x++) for (let y = (LOC.station.y / 4 - 8) * 4; y < LOC.station.y; y++) { const m = at(x, y); if (m === MAT.PACKED || m === MAT.SNOW) mat[y * W + x] = MAT.AIR; } }
  t = performance.now();
  const s2 = bfs();
  console.log(`       (walk BFS after digging ${(performance.now() - t).toFixed(0)} ms)`);
  const hut = chestPos('minehut');
  ok(near(s2, hut.x, hut.y), 'after digging the collapse: miner hut chest (coil)');
  ok(near(s2, M_.pocket[1] + 6, M_.floorB - 4), 'after digging: the bulkhead of the methane pocket');
  ok(near(s2, worldInfo.radioParts.battery.x, worldInfo.radioParts.battery.y), 'after digging the drift: the battery chest');
  ok(near(s2, worldInfo.spots.whale.x - 66, surfaceAt(worldInfo.spots.whale.x - 66) - 6), 'on foot: the whale skeleton tail (note n7)');
  ok(near(s2, 1200, 284), 'on foot: the fast ice (over the shore-ice pass and the tide crack)');
  const berg = chestPos('icecave'); ok(!near(s2, berg.x, berg.y, 4, 6), 'the iceberg ice cave is sealed behind an ice wall (chisel in)');
  ok(near(s2, LOC.iceberg.x + 8, 250) || near(s2, LOC.iceberg.x - 8, 250), 'on foot: over the iceberg (walkable ice hill)');
  ok(near(s2, 1520, 284), 'on foot: the first floes of the pack ice');
  ok(near(s2, 1640, 284), 'on foot: across the thin-ice leads to the ship floe');
  const cab = chestPos('ship', 'barometer'); ok(near(s2, cab.x, cab.y), 'on foot: the captain cabin chest on the ship');
  const hold = chestPos('ship', 'radio_triode'); ok(near(s2, hold.x, hold.y), 'on foot: the hold chest (radio triode) via the companionways');
  ok(near(s1, worldInfo.spots.signalFire.x, worldInfo.spots.signalFire.y - 4), 'on foot: the signal-fire hill on the cape (up the hill flank)');
}

// ---- sky / light / camera maths ----
{
  const setClock = (day: number, hour: number) => {
    const tm = (day - 1) * 1440 + hour * 60, noon = Math.max(-9.5, Math.min(1.2, -9 + 9.5 * (((day - 1) * 1440 + 720) / 1440 - 0.5) / 11));
    G.time = tm; G.noonElev = noon;
    G.sunElev = noon - 17 * (1 - Math.cos(2 * Math.PI * (hour - 12) / 24)) / 2;
    G.moonPhase = 0.5; G.moon = 0.8; G.aurora = 0; G.storm = 0;
  };
  const brightness = () => { updateSkyState(); computeLight({ x0: 900, y0: 200, w: 400, h: 220 }, 0); const l = lightAt(1000, 250); return (l[0] + l[1] + l[2]) / 3; };
  setClock(1, 12); updateSkyState(); const d1 = { ...skyState }; const b1 = brightness();
  setClock(6, 12); updateSkyState(); const d6 = { ...skyState };
  setClock(11, 12); updateSkyState(); const d11 = { ...skyState }; const b11 = brightness();
  setClock(12, 12); updateSkyState(); const d12 = { ...skyState };
  ok(d1.light < d6.light && d6.light < d11.light && d11.light < d12.light, 'noon twilight level grows with the day number', `(${d1.light.toFixed(2)} < ${d6.light.toFixed(2)} < ${d11.light.toFixed(2)} < ${d12.light.toFixed(2)})`);
  ok(d1.warm < 0.1 && d11.warm > 0.8, 'twilight is blue on day 1 and pink-orange on day 10-11', `(warm ${d1.warm.toFixed(2)} -> ${d11.warm.toFixed(2)})`);
  ok(d12.sunUp > 0.5 && d6.sunUp < 0.01, 'the sun rim shows only around day 12 noon');
  ok(b11 > b1, 'terrain light at noon grows from day 1 to day 11', `(${b1.toFixed(2)} -> ${b11.toFixed(2)})`);
  setClock(6, 0); G.moon = 0.9; updateSkyState(); const bm = brightness(); G.moon = 0; updateSkyState(); const bn = brightness();
  ok(bm > bn * 1.3, 'a bright moon lights the night snow', `(${bn.toFixed(2)} -> ${bm.toFixed(2)})`);
  // constant light region while panning (no canvas recreation)
  const sizes = new Set<string>(); for (let x = 400; x < 520; x += 3) { computeLight({ x0: x, y0: 210, w: 402, h: 226 }, 0); sizes.add(lt.w + 'x' + lt.h); }
  ok(sizes.size === 1, 'light region keeps a constant size while panning', `(${[...sizes].join(',')})`);
  computeLight({ x0: 0, y0: 100, w: 402, h: 226 }, 0); const wEdge = lt.w; computeLight({ x0: W - 402, y0: 100, w: 402, h: 226 }, 0);
  ok(lt.w === wEdge && lt.tx0 >= 0 && lt.tx0 + lt.w <= TW, 'light region is shifted, not clipped, at the world edges');
  // lamp inside a snow igloo: walls glow, outside stays dark
  { setClock(6, 0); G.moon = 0; for (let y = 240; y < 300; y++) for (let x = 1180; x < 1230; x++) { mat[y * W + x] = MAT.AIR; } for (let x = 1180; x < 1230; x++) for (let y = 292; y < 300; y++) mat[y * W + x] = MAT.PACKED;
    for (let y = 262; y < 292; y++) for (let x = 1190; x < 1220; x++) { const dx = (x - 1205) / 15, dy = (y - 292) / 30, d = Math.hypot(dx, dy); if (d <= 1 && d >= 0.84) mat[y * W + x] = MAT.SNOWBLOCK; }
    G.lights.length = 0; G.lights.push({ x: 1205, y: 280, r: 1, g: 0.66, b: 0.3, rad: 8 }); updateSkyState(); computeLight({ x0: 1100, y0: 200, w: 400, h: 220 }, 0);
    const wall = Array.from(lightAt(1205, 264)), inside = Array.from(lightAt(1205, 282)), outside = Array.from(lightAt(1260, 282)); G.lights.length = 0;
    ok(wall[0] > 0.2 && wall[0] > wall[2] * 1.4, 'a lamp makes the snow dome glow amber', `(wall ${wall.map(v => v.toFixed(2)).join(',')})`);
    ok(outside[0] < wall[0] * 0.5, 'light does not leak far outside the igloo', `(outside r ${outside[0].toFixed(2)} vs wall ${wall[0].toFixed(2)})`); void inside; }
  // camera
  G.cam.viewW = 400; G.cam.viewH = 225; updateCamera(0, 10, 10, true); ok(G.cam.x >= 200 && G.cam.y >= 112, 'camera clamps to the world (west/north)');
  updateCamera(0, W + 500, H + 500, true); ok(G.cam.x <= W - 200 && G.cam.y <= H - 112, 'camera clamps to the world (east/south)');
  updateCamera(0, 1000, 280, true); G.cam.y = 280; updateCamera(1 / 60, 1000, 285); ok(Math.abs(G.cam.y - 280) < 1e-6, 'vertical dead zone holds the camera');
  clampCamera();
}

console.log(`\n${pass} passed, ${fail} failed`);
(globalThis as { process?: { exit(c: number): void } }).process?.exit(fail ? 1 : 0);
