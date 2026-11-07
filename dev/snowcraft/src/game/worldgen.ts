// World generator (DESIGN §1) — the High-Arctic coast. Deterministic by seed. Layout left -> right (2048 × 768 cells, sea level row 300):
//   cliff wall · CAPE with the abandoned coal mine · tundra with lichen and the old CAIRN · STATION «Мыс Безмолвия» ·
//   gravel BEACH (driftwood, whale skeleton, shore ice, tide crack) · FAST ICE (seal holes, iceberg with an ice cave) ·
//   PACK ICE (floes, cracks, ridges, leads, the ghost ship «Заря») · open sea edge.  No trees anywhere.
// This file shapes the terrain: surface profile, snowpack with density layering (aux encodes density: ρ ≈ 60 + aux × 1.6 kg/m³),
// rock, sea, ice field. locations.ts then stamps the built places and fills worldInfo.
import { W, H, TW, TH, mat, aux, flags, shade, bg, awake, clearWorld, setSeed, rand, randInt, noise1, fbm1, fbm2 } from '../engine/grid';
import { MAT } from '../content/materials';
import { G } from './state';
import { tundraSnow, stationSnow, finishSnow, makeSpawn, snowpackCfg } from './snowpack';
import { placeStationObjects } from './stationobjects';
import { LOC, SEA, stampLocations, resetLocations, worldInfo, Terrain, put, box, pileBlocks, snowBank, topSolid } from './locations';

export { worldInfo, LOC };
const M = MAT;
const AIR = M.AIR, SNOW = M.SNOW, PACKED = M.PACKED, ICE = M.ICE, WATER = M.WATER, DIRT = M.DIRT, STONE = M.STONE, HARD = M.HARDROCK, BED = M.BEDROCK, GRAVEL = M.GRAVEL;

// ---- terrain arrays (also handed to locations) ----
const surf = new Int16Array(W);        // natural surface: first solid row (snow / ice top; SEA over open water)
const ground = new Int16Array(W);      // top of rock / permafrost / gravel / seabed under the snow
const stoneTop = new Int16Array(W);    // first STONE row
const deepTop = new Int16Array(W);     // first HARDROCK row
const seabed = new Int16Array(W);      // sea floor (x >= SHORE), 0 on land
const iceTop = new Int16Array(W);      // ice sheet top (0 = none)
const iceBot = new Int16Array(W);      // first row under the ice sheet
const snowDepth = new Int16Array(W);
const T: Terrain = { surf, ground, stoneTop, deepTop, seabed, iceTop, iceBot };

const SHORE = 1076;                    // first sea column
const SEA_X1 = 2042;                   // first column of the east world edge wall
const ss = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
let SO = 0;                            // seed offset for noise
const lichenSpots: { cx: number; w: number }[] = [];   // lichen patches on the windswept tundra (thin snow there)

// ---- land profile: snow-surface control points (x, y) ----
const CP: [number, number][] = [
  [0, 112], [26, 118], [48, 134], [60, 148], [90, 166], [130, 178], [170, 186], [210, 196], [250, 206], [290, 226], [312, 246], [330, 262],
  [345, 264], [372, 264], [400, 255], [430, 243], [445, 238], [470, 245], [500, 256], [530, 266], [556, 272],
  [880, 272], [900, 273], [930, 279], [970, 286], [1010, 291], [1050, 296], [1076, 299],
];
function profile(x: number) {
  let i = 0; while (i < CP.length - 2 && x > CP[i + 1][0]) i++;
  const a = CP[i], b = CP[i + 1], t = clamp((x - a[0]) / Math.max(1, b[0] - a[0]), 0, 1);
  const s = 0.5 - 0.5 * Math.cos(Math.PI * t);
  return a[1] + (b[1] - a[1]) * s;
}
function noiseAmp(x: number) {
  if (x < 60) return 1.5;
  if (x < 317) return 4;
  if (x < 372) return 0.8;
  if (x < 556) return 3.4;
  if (x < 880) return 0;                     // station plateau is dead flat (tile aligned)
  return 1.4;
}
const SB: [number, number][] = [[1076, 300], [1100, 316], [1150, 332], [1250, 350], [1350, 364], [1450, 380], [1600, 402], [1750, 420], [1900, 442], [1950, 458], [2042, 500]];
function seabedAt(x: number) {
  let i = 0; while (i < SB.length - 2 && x > SB[i + 1][0]) i++;
  const a = SB[i], b = SB[i + 1], t = clamp((x - a[0]) / (b[0] - a[0]), 0, 1);
  return Math.round(a[1] + (b[1] - a[1]) * t + (fbm1((x + SO) / 40 + 5, 3) - 0.5) * 7);
}

// snow density layering: aux -> ρ ≈ 60 + aux × 1.6.  loose crown 5..45, settled 80..130 (crumbles when cut), wind slab 150..205 (ideal), hard crust 215..250
const snowAux = (slab: number, depthFrac: number, n: number) => {
  const base = 78 + 40 * depthFrac + n * 14;                  // settled snow (ρ ≈ 190..260)
  return clamp(Math.round(base + slab * (62 + 30 * n)), 70, 250);
};
function fillSnow(x: number, yTop: number, yBot: number, loose: number, slab: number) {
  const n = yBot - yTop; if (n <= 0) return;
  for (let k = 0; k < n; k++) {
    const y = yTop + k, i = y * W + x;
    if (k < loose) { mat[i] = SNOW; aux[i] = 4 + ((rand() * 36) | 0) + k * 3; flags[i] = 0; }
    else {
      const f = (k - loose) / Math.max(1, n - loose);
      const crust = k < loose + 2 ? 1 : 0;                      // wind crust right under the loose crown
      mat[i] = PACKED; flags[i] = 0;
      aux[i] = clamp(snowAux(slab, f, noise1((x + y * 7) * 0.2 + SO)) + crust * (slab > 0.5 ? 38 : 14) + ((rand() * 8) | 0), 70, 252);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
export function generateWorld(seed: number): { spawnX: number; spawnY: number } {
  G.seed = seed;
  clearWorld(); setSeed(seed * 7919 + 13); resetLocations();
  G.fixtures.length = 0; G.drops.length = 0;
  SO = (seed % 997) * 13.37;
  surf.fill(0); ground.fill(0); stoneTop.fill(0); deepTop.fill(0); seabed.fill(0); iceTop.fill(0); iceBot.fill(0); snowDepth.fill(0);
  lichenSpots.length = 0;
  for (let x = 384; x < 548; x += 9) { if (fbm1((x + SO) / 31 + 40, 3) < 0.4 || lichenSpots.some(l => Math.abs(l.cx - x) < 15)) continue; lichenSpots.push({ cx: x, w: 9 + ((x * 7) % 8) }); }

  buildLand();
  buildSea();
  edgesAndBedrock();
  buildBackgrounds();
  rockFeatures();
  if (snowpackCfg.on) tundraSnow(T, seed);            // DESIGN §13 deep snow: own hash noise, no rand() draws (the random stream below is unchanged)
  stampLocations(T);
  placeStationObjects();                              // DESIGN §15: generator, lamps, medkit, bell, barrels, den ... (own RNG, no rand() draws)
  if (snowpackCfg.on) stationSnow(T);
  cutSealHoles();
  sastrugi();
  if (snowpackCfg.on) finishSnow(T);
  finalize();

  const sp = makeSpawn();              // a flat terrace on the lee drift, a few cells east of the buried station door
  const sx = sp.x, sy = sp.y;
  LOC.spawn.x = sx;
  worldInfo.spots.spawn = { x: sx, y: sy };
  return { spawnX: sx, spawnY: sy };
}

// ---------------------------------------------------------------------------------------------------------------------
function buildLand() {
  const hs = new Float32Array(SHORE + 24);
  for (let x = 0; x < hs.length; x++) hs[x] = profile(x) + (fbm1((x + SO) / 17 + 3.3, 3) - 0.5) * 2 * noiseAmp(x) + (fbm1((x + SO) / 63 + 8.1, 2) - 0.5) * noiseAmp(x) * 2.2;
  for (let x = 556; x <= 880; x++) hs[x] = LOC.station.y;
  for (let x = 1; x < hs.length; x++) hs[x] = clamp(hs[x], hs[x - 1] - 1.4, hs[x - 1] + 1.4);
  for (let x = hs.length - 2; x >= 0; x--) hs[x] = clamp(hs[x], hs[x + 1] - 1.4, hs[x + 1] + 1.4);
  // snow depth: wind-driven (deep in the lee of slopes), smoothed so the snow/ground boundary is not jagged
  const depF = new Float32Array(SHORE);
  for (let x = 0; x < SHORE; x++) {
    const X = x + SO, s = Math.round(hs[x]);
    const slopeE = (hs[Math.min(hs.length - 1, x + 10)] - hs[Math.max(0, x - 10)]) / 20;      // > 0 when the ground falls away to the east = lee of westerly wind
    let dep: number;
    if (x < 90) dep = 1 + 2 * fbm1(X / 20, 2);                                              // scoured windward cliff
    else if (x < 300) dep = 2 + clamp(slopeE, 0, 0.7) * 34 + 5 * fbm1(X / 50 + 1, 3);
    else if (x < 345) dep = 1;
    else if (x < 556) dep = 5 + 11 * ss(0.35, 0.8, fbm1(X / 45 + 4, 3)) + clamp(slopeE, 0, 0.7) * 14;
    else if (x < 890) dep = 15 + 5 * fbm1(X / 70 + 9, 2);
    else dep = Math.max(0, 5 * (fbm1(X / 26 + 2, 3) - 0.38)) * (1 - ss(1010, 1076, x));       // beach: gravel with snow patches
    if (x > 410 && x < 480) dep *= 0.35 + 0.65 * ss(0, 30, Math.abs(x - 445));              // crest scour on the cairn hill
    for (const l of lichenSpots) { const d = Math.abs(x - l.cx) / (l.w * 0.9 + 6); if (d < 1) dep *= 1 - 0.9 * (1 - d * d); }     // the wind keeps lichen patches nearly bare
    depF[x] = clamp(dep, 0, 26);
    surf[x] = s;
  }
  for (let pass = 0; pass < 3; pass++) {
    const c = depF.slice();
    for (let x = 0; x < SHORE; x++) { let a = 0, n = 0; for (let k = -6; k <= 6; k++) { const xx = x + k; if (xx < 0 || xx >= SHORE) continue; a += c[xx]; n++; } depF[x] = a / n; }
  }
  for (let x = 0; x < SHORE; x++) {
    const X = x + SO, s = surf[x];
    const slopeE = (hs[Math.min(hs.length - 1, x + 10)] - hs[Math.max(0, x - 10)]) / 20;
    const dep = Math.round(depF[x] + (x > 90 && x < 556 ? 1.2 * (fbm1(X / 6 + 2, 2) - 0.5) : 0));
    snowDepth[x] = dep;
    surf[x] = s; ground[x] = s + dep;
    const cape = x < 372;
    const dirtT = cape ? 1 + ((noise1(X * 0.3) * 3) | 0) : x >= 900 ? 0 : Math.round(10 + 10 * fbm1(X / 80 + 21, 3));
    const gravelT = x >= 900 ? Math.round(6 + 6 * fbm1(X / 40 + 5, 2)) : 0;
    stoneTop[x] = ground[x] + dirtT + gravelT;
    deepTop[x] = Math.round(560 + (fbm1(X / 130 + 40, 3) - 0.5) * 44);
    // slab = wind-packed in the lee (east-facing slopes), fresh on the windward side
    const slab = clamp(0.25 + slopeE * 2.2 + (fbm1(X / 33 + 17, 2) - 0.5) * 0.9, 0, 1);
    const loose = Math.round(clamp(2 + 4 * fbm1(X / 29 + 9, 2) - slab * 2.4, 1, 6));
    fillSnow(x, s, s + dep, Math.min(loose, dep), slab);
    for (let y = s + dep; y < H - 6; y++) {
      const i = y * W + x;
      if (y < s + dep + gravelT) { mat[i] = GRAVEL; aux[i] = 0; }
      else if (y < stoneTop[x]) { mat[i] = DIRT; aux[i] = 0; }
      else if (y < deepTop[x]) mat[i] = STONE;
      else mat[i] = HARD;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
interface FloeDef { x0: number; x1: number; thick: number }
function buildSea() {
  const info = worldInfo.iceField;
  // sea floor and rock below it
  for (let x = SHORE; x < SEA_X1; x++) {
    const sb = Math.max(SEA + 1, seabedAt(x)); seabed[x] = sb; ground[x] = sb;
    stoneTop[x] = sb + 10; deepTop[x] = Math.round(560 + (fbm1((x + SO) / 130 + 40, 3) - 0.5) * 44);
    for (let y = sb; y < H - 6; y++) {
      const i = y * W + x;
      if (y < sb + 4) { mat[i] = GRAVEL; aux[i] = 0; } else if (y < sb + 10) { mat[i] = DIRT; aux[i] = 0; } else if (y < deepTop[x]) mat[i] = STONE; else mat[i] = HARD;
    }
    for (let y = SEA; y < sb; y++) { mat[y * W + x] = WATER; aux[y * W + x] = 0; }
  }
  // boulders on the sea floor
  for (let k = 0; k < 60; k++) { const x = randInt(SHORE + 10, SEA_X1 - 10), r = randInt(2, 5); for (let dy = -r; dy <= 0; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy * 1.6 <= r * r) put(x + dx, seabed[x] + dy, STONE); }

  // ---- fast ice: grounded near the shore, floating beyond the tide crack ----
  const FAST1 = 1450;
  for (let x = SHORE; x < FAST1; x++) {
    const thick = 16 + Math.round(2.5 * fbm1((x + SO) / 30 + 2, 2) * 2);
    iceTop[x] = 298; iceBot[x] = Math.min(298 + thick, seabed[x]);
    box(x, iceTop[x], x + 1, iceBot[x], ICE, 0, 0);
  }
  // flaw lead between the fast ice and the pack: new ice
  for (let x = FAST1; x < 1470; x++) { iceTop[x] = SEA; iceBot[x] = SEA + 3; box(x, SEA, x + 1, SEA + 3, ICE, 0, 0); }
  worldInfo.iceField.leads.push({ x0: FAST1, x1: 1469, thin: true });
  info.cracks.push(1459);

  // ---- pack ice: floes separated by cracks, ridges and leads ----
  const j = () => randInt(-2, 2);
  const floes: FloeDef[] = [
    { x0: 1470, x1: 1511, thick: 14 }, { x0: 1515, x1: 1532, thick: 20 }, { x0: 1536, x1: 1553 + j(), thick: 18 }, { x0: 1557, x1: 1596, thick: 11 }, { x0: 1615, x1: 1650, thick: 17 },
    { x0: 1661, x1: 1853, thick: 34 }, { x0: 1855, x1: 1895, thick: 22 }, { x0: 1904, x1: 1948, thick: 13 },
  ];
  for (const f of floes) {
    info.floes.push({ x0: f.x0, x1: f.x1, thick: f.thick });
    const fb = clamp(Math.round(f.thick * 0.09) + 1, 2, 4);
    for (let x = f.x0; x <= f.x1; x++) {
      let thick = f.thick;
      if (f.thick >= 30) thick += Math.round(18 * Math.exp(-(((x - LOC.ship.x) / 70) ** 2)));      // the floe around the ship is a deep keel
      const top = SEA - fb;
      // chamfered, broken edges
      const ed = Math.min(x - f.x0, f.x1 - x);
      const bevel = ed < 3 ? 3 - ed : 0;
      iceTop[x] = top + bevel; iceBot[x] = Math.min(seabed[x] - 1, top + thick);
      box(x, iceTop[x], x + 1, iceBot[x], ICE, 0, 0);
    }
  }
  const thinLead = (x0: number, x1: number) => { worldInfo.iceField.leads.push({ x0, x1, thin: true }); for (let x = x0; x <= x1; x++) { const e = Math.min(x - x0, x1 - x), th = 3 + (e > 1 ? 1 : 0); iceTop[x] = SEA; iceBot[x] = SEA + th; box(x, SEA, x + 1, SEA + th, ICE, 0, 0); } };
  thinLead(1651, 1660); thinLead(1597, 1614);
  info.leads.push({ x0: 1896, x1: 1903, thin: false });
  info.cracks.push(1513, 1534, 1556, 1605, 1655, 1854, 1900);
  info.hiddenCracks.push(1534);
  // the wide lead is covered by a skin of new ice that is only 2 cells thick in the middle (it will break under a heavy load)
  for (let x = 1603; x <= 1608; x++) { box(x, SEA + 2, x + 1, SEA + 4, AIR); box(x, SEA + 2, x + 1, SEA + 4, WATER); }
  // open sea edge: brash ice chunks
  for (let k = 0; k < 6; k++) { const x = randInt(1960, 2030), w = randInt(4, 9); box(x, SEA - 2, x + w, SEA + randInt(4, 8), ICE); }
  info.fastX0 = SHORE; info.fastX1 = FAST1; info.packX0 = FAST1; info.packX1 = 1950; info.seaEdgeX = 1950;

  // pressure ridges: where floes are pressed together, and a line along the flaw lead
  for (const rx of [1556, 1854, 1480]) {
    const hgt = pileBlocks(rx - 26, rx + 26, rx === 1556 ? 16 : 12, 70, ICE, 4, 12, 3, 6, { x0: rx - 10, x1: rx + 10, cap: 6 });
    info.ridges.push({ x: rx, w: 52, h: Math.max(...Array.from(hgt)) });
  }
  // snow cover, drifts in the lee of obstacles, bare glare ice where the wind scours
  const lee = (x: number) => { let b = 0; for (const r of [[1236, 16], [1296, 16], [1412, 16], [1372, 50], [1556, 28], [1854, 28], [1752, 100]]) { const d = x - r[0]; if (d > r[1] * 0.3 && d < r[1] * 3) b = Math.max(b, 1 - (d - r[1] * 0.3) / (r[1] * 2.7)); } return b; };
  for (let x = SHORE; x < 1950; x++) {
    const top = topSolid(x, 200);
    if (top >= SEA + 1 || mat[top * W + x] !== ICE) { surf[x] = top; continue; }                  // open water / thin ice: no snow
    const X = x + SO, l = lee(x);
    const sast = Math.sin(x * 0.55 + fbm1(X / 7, 2) * 5) * 0.8 + Math.sin(x * 0.19) * 0.7;      // sastrugi
    let dep = 8 + 9 * fbm1(X / 38 + 6, 3) + 6 * l + sast;
    const scour = ss(0.62, 0.74, fbm1(X / 55 + 31, 3));                                        // glare ice patches
    dep *= 1 - scour * 0.96;
    if (x < SHORE + 14) dep *= 0.5;
    dep = Math.round(clamp(dep, 0, 26));
    const slab = clamp(0.2 + 0.9 * l + (fbm1(X / 41 + 13, 2) - 0.4) * 1.3, 0, 1);
    const loose = Math.round(clamp(2 + 3 * fbm1(X / 23 + 4, 2) - slab * 2, 0, 5));
    fillSnow(x, top - dep, top, Math.min(loose, dep), slab);
    // DESIGN §13: the fast ice keeps only 0.3-0.8 m of snow, so the seal holes stay findable (the pack ice keeps its cover: ridges, floes and the ship sit in it).
    // The thick cover above is generated first (the rand() draws stay exactly as they were) and the top of it is shovelled off again.
    const want = x < FAST1 ? Math.round(clamp(dep * 0.36, 0, 9)) : dep;
    if (dep > want) {
      for (let y = top - dep; y < top - want; y++) { const i = y * W + x; mat[i] = AIR; aux[i] = 0; flags[i] = 0; }
      for (let k = 0; k < Math.min(2, want); k++) { const i = (top - want + k) * W + x; mat[i] = SNOW; aux[i] = 8 + ((((x * 31 + k * 17) % 29)) | 0); }     // a thin loose crown again
      dep = want;
    }
    snowDepth[x] = dep; surf[x] = top - dep;
  }
  // hidden crack: snow bridge over the gap
  for (let x = 1533; x <= 1535; x++) { const yy = iceTop[1530]; for (let y = yy - 6; y <= yy; y++) put(x, y, y < yy - 1 ? SNOW : PACKED, 40); iceTop[x] = SEA; iceBot[x] = SEA; surf[x] = yy - 6; }
  // open leads and cracks: surf = water level
  for (let x = 1597; x <= 1614; x++) surf[x] = SEA;
  for (let x = 1949; x < SEA_X1; x++) { surf[x] = mat[(SEA - 2) * W + x] === ICE ? SEA - 2 : SEA; }
}

// ---------------------------------------------------------------------------------------------------------------------
function edgesAndBedrock() {
  for (let y = H - 6; y < H; y++) mat.fill(BED, y * W, y * W + W);
  for (let y = 0; y < H; y++) { const r = y * W; for (let x = 0; x < 6; x++) { mat[r + x] = BED; aux[r + x] = 0; } }
  // east edge: a bedrock wall rising 24 cells above the sea
  for (let y = SEA - 24; y < H; y++) { const r = y * W; for (let x = SEA_X1; x < W; x++) { mat[r + x] = BED; aux[r + x] = 0; } }
  for (let y = 0; y < SEA - 24; y++) { const r = y * W; for (let x = SEA_X1; x < W; x++) { mat[r + x] = AIR; aux[r + x] = 0; } }
  for (let x = SEA_X1 - 8; x < SEA_X1; x++) { surf[x] = SEA; }
}

// ---------------------------------------------------------------------------------------------------------------------
// permafrost ice wedges, outcrops of rock on the cape, lichen patches on the tundra, the whole cliff wall texture
const kind0 = (k: number) => (k % 3 === 1 ? 1 : 2 + (k % 2));
function rockFeatures() {
  // ice wedges in the permafrost of the tundra and the plateau: thin V-shaped veins going down from the top of the ground
  // (shallow wedges that stay near the soil / snow boundary: long hanging veins looked like icicles under the snow shelf; not on the station pad)
  for (let k = 0; k < 34; k++) {
    const x = randInt(380, 1060), y = ground[x] + randInt(0, 3), w0 = randInt(2, 4), dep0 = randInt(8, 18);     // same four draws as before (keeps the random stream of everything generated after)
    if (x > 540 && x < 900) continue;
    const w = w0 + 1, dep = 4 + (dep0 % 5);
    for (let dy = 0; dy < dep; dy++) {
      const hw = Math.max(0.5, (1 - dy / dep) * w / 2 + 0.4 * noise1(x + dy * 0.9)), c = x + Math.round(Math.sin(dy * 0.4 + x) * 1.2);
      for (let dx = -Math.ceil(hw); dx <= Math.ceil(hw); dx++) { if (Math.abs(dx) > hw) continue; const i = (y + dy) * W + c + dx; if (mat[i] === DIRT) { mat[i] = ICE; aux[i] = 0; } }
    }
  }
  // rock strata: wavy bands of dark hardrock and ice lenses in the stone below the soil, so the lower part of every cliff / shelf reads as layered permafrost rock
  for (let k = 0; k < 9; k++) {
    const off = 26 + k * 24, ph = k * 1.7 + SO, th = kind0(k), kind = k % 3;      // 0 hardrock band, 1 ice lens (patchy), 2 dark band
    for (let x = 6; x < SHORE; x++) {
      const y0 = stoneTop[x] + off + Math.round(Math.sin(x / 41 + ph) * 5 + Math.sin(x / 13 + ph * 2) * 1.5);
      if (y0 + th >= deepTop[x]) continue;
      if (kind === 1 && fbm1((x + SO) / 22 + k, 2) < 0.68) continue;
      for (let y = y0; y < y0 + th; y++) { const i = y * W + x; if (mat[i] === STONE) { mat[i] = kind === 1 ? ICE : HARD; aux[i] = 0; } }
    }
  }
  // wind-scoured cape: crusts of lichen on the rocky ledges of the cape hill (the tundra patches are placed below)
  for (let x = 96; x < 340; x += 5) {
    if (x > 255 && x < 345) continue;
    if (fbm1((x + SO) / 17 + 70, 2) < 0.52 || snowDepth[x] > 3) continue;
    const g = ground[x]; for (let k = 1; k <= 1 + (x % 2); k++) if (mat[(g - k) * W + x] === AIR) put(x, g - k, M.LICHEN);
    if (mat[(g - 1) * W + x + 1] === AIR) put(x + 1, g - 1, M.LICHEN);
  }
  // boulders and tundra rocks
  for (let k = 0; k < 120; k++) {
    const x = randInt(100, 1000); if (x > 556 && x < 880) continue; if (x > 300 && x < 345) continue; const r = randInt(2, 5);
    for (let dy = -r; dy <= 0; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy * 1.5 <= r * r + 1) { const i = (surf[x] + dy + 1) * W + x + dx; if (mat[i] === AIR || mat[i] === SNOW) { mat[i] = STONE; aux[i] = 0; } }
  }
  // lichen patches: windswept ground where the snow is thin, a mat of ягель on top of the ground
  for (const { cx, w } of lichenSpots) {
    for (let x = cx - (w >> 1); x <= cx + (w >> 1); x++) {
      const e = Math.abs(x - cx) / (w / 2), g = ground[x];
      for (let y = surf[x]; y < g; y++) { const i = y * W + x; if (mat[i] === SNOW || mat[i] === PACKED) { mat[i] = AIR; aux[i] = 0; } }
      const hh = e > 0.8 ? 1 : 2;
      for (let k = 1; k <= hh; k++) put(x, g - k, M.LICHEN);
      if (rand() < 0.35 && e < 0.8) put(x, g - 3, M.LICHEN);
    }
    worldInfo.lichen.push({ x: cx - (w >> 1), w });
  }
  void fbm2; void snowBank;
}

// ---------------------------------------------------------------------------------------------------------------------
/** Wind-sculpted ripples on top of the flat snow (the plateau is flat only where buildings stand). */
function sastrugi() {
  const h0 = LOC.house.L * 4 - 56, h1 = LOC.house.R * 4 + 120, s0 = LOC.shed.L * 4 - 70, s1 = LOC.shed.R * 4 + 80;
  for (let x = 380; x < SHORE; x++) {
    if ((x > h0 && x < h1) || (x > s0 && x < s1) || (x > 880 && x < 1070)) continue;
    const top = topSolid(x, 150);
    const m = mat[top * W + x];
    if (m !== SNOW && m !== PACKED) continue;
    const n = fbm1((x + SO) / 9 + 2, 2) * 1.6 + Math.sin(x * 0.37 + fbm1((x + SO) / 14, 2) * 4) * 0.5;
    const hh = Math.max(0, Math.round(n - 0.55));
    for (let k = 1; k <= hh; k++) if (mat[(top - k) * W + x] === AIR) put(x, top - k, SNOW, 10 + ((rand() * 30) | 0));
  }
}

function cutSealHoles() {
  const xs: [number, 'fast' | 'pack'][] = [[1112, 'fast'], [1148, 'fast'], [1188, 'fast'], [1264, 'fast'], [1316, 'fast'], [1436, 'fast'], [1488, 'pack'], [1520, 'pack'], [1572, 'pack'], [1628, 'pack'], [1872, 'pack'], [1920, 'pack']];
  for (const [x, floe] of xs) {
    const top = topSolid(x + 1, 220);
    // shaft 4 wide through snow and ice down to the water
    for (let dx = 0; dx < 4; dx++) for (let y = top - 10; y < iceBot[x] + 1; y++) { const i = y * W + x + dx; if (y < SEA) { mat[i] = AIR; aux[i] = 0; flags[i] = 0; } else if (mat[i] === ICE || mat[i] === SNOW || mat[i] === PACKED) { mat[i] = WATER; aux[i] = 0; flags[i] = 0; } }
    // rim of snow around the hole
    for (let dx = -5; dx < 9; dx++) {
      if (dx >= 0 && dx < 4) continue;
      const xx = x + dx, hh = Math.max(0, 3 - Math.floor(Math.min(Math.abs(dx + 1), Math.abs(dx - 4)) / 2)), t = topSolid(xx, 220);
      for (let k = 1; k <= hh; k++) if (mat[(t - k) * W + xx] === AIR) put(xx, t - k, k === hh ? SNOW : PACKED, k === hh ? 20 : 180);
    }
    worldInfo.sealHoles.push({ x, y: top, w: 4, floe });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
function buildBackgrounds() {
  // bg per tile: sky above the surface; snow = 3; permafrost 1; stone 2; deep rock 4; sea water 6; ice sheet 3
  for (let ty = 0; ty < TH; ty++) {
    const cy = ty * 4 + 2;
    for (let tx = 0; tx < TW; tx++) {
      const x = Math.min(W - 1, tx * 4 + 2);
      let b = 0;
      if (x < SHORE) {
        if (cy >= surf[x]) b = cy < ground[x] ? 3 : cy < stoneTop[x] ? 1 : cy < deepTop[x] ? 2 : 4;
      } else if (x < SEA_X1) {
        if (cy >= SEA - 4) {
          if (cy < seabed[x]) b = (iceTop[x] && cy >= iceTop[x] - 2 && cy < iceBot[x] + 1) ? 3 : cy >= SEA ? 6 : 0;
          else b = cy < stoneTop[x] ? 1 : cy < deepTop[x] ? 2 : 4;
        }
        if (cy < SEA - 4 && iceTop[x] && cy >= surf[x]) b = 3;
      } else if (cy >= SEA - 24) b = 2;
      bg[ty * TW + tx] = b;
    }
  }
}

function finalize() {
  for (let i = 0; i < shade.length; i++) shade[i] = (rand() * 256) | 0;
  awake.fill(0);
}

export { surf as surfaceTop, ground as rockTop, stoneTop, deepTop };
export function surfaceAt(x: number) { return surf[Math.max(0, Math.min(W - 1, x | 0))]; }
export const terrain = T;
