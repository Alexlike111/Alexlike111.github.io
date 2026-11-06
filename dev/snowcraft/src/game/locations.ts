// Locations of the High-Arctic coast (DESIGN §1). Site registry, world info for other systems, drawing kit and the stampers of every
// built / sculpted place: the abandoned coal mine «Шахта №3», the old cairn, the station «Мыс Безмолвия» with its generator shed,
// the beach (driftwood, whale skeleton, shore ice, tide crack), the iceberg with its ice cave and the ghost ship «Заря».
// worldgen.ts shapes the terrain first (profile, snowpack, rock, sea, ice field) and then calls stampLocations().
// Fixtures are records in G.fixtures; solid ones also write MAT.FIXTURE + F_FIXTURE cells (SPEC §4).
import { G, Fixture, FixtureKind, Slot, Light, newId } from './state';
import { W, H, TW, mat, aux, flags, bg, F_FIXTURE, rand, randInt, noise1, fbm1 } from '../engine/grid';
import { MAT, ANCHOR } from '../content/materials';
import { strings, tr } from '../content/i18n';

// ---------------------------------------------------------------------------------------------------------------------
// layout constants (cells). worldgen shapes the terrain around these.
export const SEA = 300;                                  // water surface row ("sea level")
export const LOC = {
  sea: SEA,
  cape: { x0: 60, x1: 360 },
  mine: {
    portalX: 322, floorA: 264, hA: 28,                   // adit: floor row 264, 28 rows of air above it
    collapse: [224, 248] as [number, number],            // rubble section on the adit
    rampTop: 190, rampBot: 105, floorB: 332,             // stairway from the adit down to level B (floor row 332)
    hut: [196, 246] as [number, number],                 // miner's hut chamber on level B
    bulkhead: 101, pocket: [68, 101] as [number, number], // sealed methane pocket (west of the bulkhead)
    lakeRamp: 252, lake: { x0: 268, x1: 376, ice: 372, shore: 364 },
  },
  summit: { x: 150 },                                    // signal-fire hill on the cape
  cairn: { x: 445, y: 238 },
  station: { x0: 556, x1: 880, y: 272 },
  house: { L: 152, R: 170 },                             // tile columns of the main house walls
  shed: { L: 196, R: 210 },                              // tile columns of the generator shed walls
  beach: { x0: 900, x1: 1100 },
  fast: { x0: 1100, x1: 1450 },
  pack: { x0: 1450, x1: 1950 },
  iceberg: { x: 1372 },
  ship: { x: 1752 },
  spawn: { x: 692, y: 272 },
};

const S = strings('site', {
  cape: 'Мыс', mine: 'Шахта №3', minehut: 'Хижина шахтёра', icelake: 'Подземное ледяное озеро', cairn: 'Старый каирн',
  station: 'Станция «Мыс Безмолвия»', shed: 'Дизельная', beach: 'Галечный пляж', whale: 'Скелет кита', fastice: 'Припайный лёд',
  iceberg: 'Айсберг', icecave: 'Ледяная пещера', pack: 'Дрейфующие льды', ship: 'Шхуна «Заря»', openSea: 'Кромка моря',
});

export type SiteKey = 'cape' | 'mine' | 'minehut' | 'icelake' | 'cairn' | 'station' | 'shed' | 'beach' | 'whale' | 'fastice' | 'iceberg' | 'icecave' | 'pack' | 'ship' | 'openSea';
export interface Site { key: SiteKey; readonly name: string; x: number; y: number; w: number; h: number; found: boolean }
export const sites: Site[] = [];
export function addSite(key: SiteKey, x: number, y: number, w: number, h: number) {
  const s = { key, x, y, w, h, found: false } as Site;
  Object.defineProperty(s, 'name', { get: () => S[key], enumerable: true });
  sites.push(s); return s;
}
/** Smallest site containing the cell (x,y) (with a margin in cells), or null. Later registered (smaller) sites win. */
export function siteAt(x: number, y: number, margin = 0): Site | null {
  let best: Site | null = null, ba = 1e12;
  for (const s of sites) if (Math.abs(x - s.x) <= s.w / 2 + margin && Math.abs(y - s.y) <= s.h / 2 + margin && s.w * s.h < ba) { best = s; ba = s.w * s.h; }
  return best;
}
/** Zones that should stay warm / unfrozen (read by the heat system). The Arctic has none by default (kept for API compatibility). */
export interface WarmZone { key: string; x: number; y: number; rx: number; ry: number; temp: number }
export const warmZones: WarmZone[] = [];

// ---------------------------------------------------------------------------------------------------------------------
// world info for other systems (fauna, drift events, quest, journal map). Mutated in place on every generateWorld().
export interface SealHole { x: number; y: number; w: number; floe: 'fast' | 'pack' }          // x = left cell, y = snow surface row
export interface Floe { x0: number; x1: number; thick: number }                              // inclusive cell columns of an ice floe
export interface Lead { x0: number; x1: number; thin: boolean }                              // open water (thin = covered by new ice)
export interface NoteSpot { id: string; x: number; y: number; where: SiteKey; container: 'chest' | 'floor' }
export interface ChestInfo { id: number; site: SiteKey; x: number; y: number; items: Slot[] }
export interface WorldInfoOut {
  seaLevel: number;
  sealHoles: SealHole[];
  driftwood: { x: number; y: number; len: number }[];
  iceField: { floes: Floe[]; cracks: number[]; hiddenCracks: number[]; leads: Lead[]; ridges: { x: number; w: number; h: number }[]; fastX0: number; fastX1: number; packX0: number; packX1: number; seaEdgeX: number };
  notes: NoteSpot[];
  chests: ChestInfo[];
  radioParts: { triode: { x: number; y: number; site: SiteKey }; coil: { x: number; y: number; site: SiteKey }; battery: { x: number; y: number; site: SiteKey } };
  spots: {
    spawn: { x: number; y: number }; kennel: { x: number; y: number }; barometer: { x: number; y: number }; mast: { x: number; y: number };
    signalFire: { x: number; y: number }; cairn: { x: number; y: number }; portal: { x: number; y: number }; methane: { x: number; y: number };
    whale: { x: number; y: number }; iceberg: { x: number; y: number }; icecave: { x: number; y: number }; ship: { x: number; y: number };
    shipCabin: { x: number; y: number }; tideCrack: { x: number; y: number }; lakeThin: { x: number; y: number };
  };
  lichen: { x: number; w: number }[];
  coal: { x: number; y: number }[];     // loose coal heaps (station, mine apron)
}
const P0 = () => ({ x: 0, y: 0 });
export const worldInfo: WorldInfoOut = {
  seaLevel: SEA, sealHoles: [], driftwood: [],
  iceField: { floes: [], cracks: [], hiddenCracks: [], leads: [], ridges: [], fastX0: 1100, fastX1: 1450, packX0: 1450, packX1: 1950, seaEdgeX: 1950 },
  notes: [], chests: [],
  radioParts: { triode: { x: 0, y: 0, site: 'ship' }, coil: { x: 0, y: 0, site: 'minehut' }, battery: { x: 0, y: 0, site: 'shed' } },
  spots: { spawn: P0(), kennel: P0(), barometer: P0(), mast: P0(), signalFire: P0(), cairn: P0(), portal: P0(), methane: P0(), whale: P0(), iceberg: P0(), icecave: P0(), ship: P0(), shipCabin: P0(), tideCrack: P0(), lakeThin: P0() },
  lichen: [], coal: [],
};

export function resetLocations() {
  sites.length = 0; warmZones.length = 0; G.fixtures.length = 0;
  const w = worldInfo;
  w.sealHoles.length = 0; w.driftwood.length = 0; w.notes.length = 0; w.chests.length = 0; w.lichen.length = 0; w.coal.length = 0;
  const f = w.iceField; f.floes.length = 0; f.cracks.length = 0; f.hiddenCracks.length = 0; f.leads.length = 0; f.ridges.length = 0;
}

/** Terrain arrays shared by worldgen and the stampers. */
export interface Terrain {
  surf: Int16Array;      // top of the natural surface (snow / ice top), y of the first solid cell
  ground: Int16Array;    // top of the rock / permafrost / seabed under the snow
  stoneTop: Int16Array;  // first STONE row
  deepTop: Int16Array;   // first HARDROCK row
  seabed: Int16Array;    // sea floor row (x >= 1075), 0 on land
  iceTop: Int16Array;    // top of the ice sheet (fast ice / floes), 0 where there is none
  iceBot: Int16Array;    // first row below the ice sheet (== iceTop where none)
}

// ---------------------------------------------------------------------------------------------------------------------
// drawing kit
const M = MAT;
const AIR = M.AIR;
export function put(x: number, y: number, m: number, a = 0, fl = 0) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = y * W + x; mat[i] = m; aux[i] = a; flags[i] = fl;
}
/** Fill the cell box [x0,x1) × [y0,y1). */
export function box(x0: number, y0: number, x1: number, y1: number, m: number, a = 0, fl = 0, onlyAir = false) {
  x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0)); x1 = Math.min(W, Math.round(x1)); y1 = Math.min(H, Math.round(y1));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * W + x; if (onlyAir && mat[i] !== AIR) continue; mat[i] = m; aux[i] = a; flags[i] = fl; }
}
/** Inclusive tile rectangle. */
export function boxT(tx0: number, ty0: number, tx1: number, ty1: number, m: number, a = 0, fl = 0, onlyAir = false) { box(tx0 * 4, ty0 * 4, tx1 * 4 + 4, ty1 * 4 + 4, m, a, fl, onlyAir); }
/** Background wall for the tiles touched by the cell box [x0,x1) × [y0,y1). */
export function bgBox(x0: number, y0: number, x1: number, y1: number, b: number) {
  for (let ty = Math.max(0, y0 >> 2); ty <= Math.min((H >> 2) - 1, (y1 - 1) >> 2); ty++) for (let tx = Math.max(0, x0 >> 2); tx <= Math.min(TW - 1, (x1 - 1) >> 2); tx++) bg[ty * TW + tx] = b;
}
/** Mark the background tile that contains cell (x,y). */
export function markBg(x: number, y: number, b: number) { if (x >= 0 && y >= 0 && x < W && y < H) bg[(y >> 2) * TW + (x >> 2)] = b; }
export function bgT(tx0: number, ty0: number, tx1: number, ty1: number, b: number) { for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) bg[ty * TW + tx] = b; }
/** Row of the first non-air cell scanning down from y0 (FIXTURE cells count as air). */
export function topSolid(x: number, y0 = 0) { let y = y0; while (y < H - 1 && (mat[y * W + x] === AIR || mat[y * W + x] === M.FIXTURE)) y++; return y; }
const isSoft = (m: number) => m === M.SNOW || m === M.PACKED;
/** Thick line (Bresenham with a square pen) of material m. */
export function line(x0: number, y0: number, x1: number, y1: number, m: number, th = 1, onlyAir = false) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  for (let n = 0; n < 4000; n++) {
    box(x, y, x + th, y + th, m, 0, 0, onlyAir);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}
/** Snow bank: a triangular drift on the first solid surface, from xa to xb with its crest at xp (height h, loose cap, packed core). */
export function snowBank(xa: number, xb: number, xp: number, h: number, y0 = 120, packed = 150) {
  for (let x = xa; x <= xb; x++) {
    const t = x <= xp ? (x - xa) / Math.max(1, xp - xa) : 1 - (x - xp) / Math.max(1, xb - xp);
    const hh = Math.round(h * Math.max(0, t) * (0.92 + 0.16 * noise1(x * 0.3)));
    if (hh <= 0) continue;
    const top = topSolid(x, y0);
    for (let k = 1; k <= hh; k++) { const y = top - k; if (mat[y * W + x] !== AIR) break; put(x, y, k > hh - 3 ? M.SNOW : M.PACKED, k > hh - 3 ? 8 + ((rand() * 30) | 0) : Math.min(255, packed + ((rand() * 30) | 0))); }
  }
}
/** Pile of random blocks (rubble, shore ice, ridges): blocks rest on whatever is highest under them. */
export function pileBlocks(x0: number, x1: number, maxH: number, count: number, m: number, minW = 4, maxW = 11, minH = 3, maxH2 = 7, pass?: { x0: number; x1: number; cap: number }) {
  const hgt = new Int16Array(x1 - x0 + 1);
  const base = new Int16Array(x1 - x0 + 1);
  for (let x = x0; x <= x1; x++) base[x - x0] = topSolid(x, 100);
  for (let k = 0; k < count; k++) {
    const w = randInt(minW, maxW), h = randInt(minH, maxH2);
    const c = randInt(x0, x1), a = Math.max(x0, c - (w >> 1)), b = Math.min(x1, a + w - 1);
    let lev = 0; for (let x = a; x <= b; x++) lev = Math.max(lev, hgt[x - x0]);
    // taper: blocks near the edges of the pile sit lower
    const mid = (x0 + x1) / 2, edge = 1 - Math.abs(c - mid) / ((x1 - x0) / 2 + 1);
    if (lev + h > maxH * (0.35 + 0.65 * edge) + 1) continue;
    for (let x = a; x <= b; x++) {
      const top = base[x - x0] - lev, cur = base[x - x0] - hgt[x - x0];
      for (let y = top - h; y < cur; y++) { const i = y * W + x; if (mat[i] === AIR || isSoft(mat[i])) { mat[i] = m; aux[i] = 0; flags[i] = 0; } }   // also closes the gap under a bridging block
      hgt[x - x0] = lev + h;
    }
  }
  // hard cap: nothing taller than maxH above the original surface; the pass (if any) is clipped lower so the pile can be crossed on foot
  for (let x = x0; x <= x1; x++) {
    const dp = pass ? Math.max(0, pass.x0 - x, x - pass.x1) : 99, cap = pass ? Math.round(pass.cap + (maxH - pass.cap) * Math.min(1, dp / 10)) : maxH, lim = base[x - x0] - cap;
    for (let y = Math.max(100, lim - 40); y < lim; y++) { const i = y * W + x; if (mat[i] === m) { mat[i] = AIR; aux[i] = 0; } }
    hgt[x - x0] = Math.min(hgt[x - x0], cap);
  }
  return hgt;
}

const slot = (id: string, n: number): Slot => ({ id, n });
const NONSOLID: FixtureKind[] = ['campfire', 'fat_lamp', 'torch', 'bed', 'snare', 'cache', 'drying_rack', 'skin_bed', 'hide_door', 'signal_fire', 'kennel', 'flag', 'mast', 'cart'];
export function addFixture(kind: FixtureKind, tx: number, ty: number, tw: number, th: number, extra: Partial<Fixture> = {}): Fixture {
  const f: Fixture = { id: newId(), kind, tx, ty, tw, th, ...extra };
  G.fixtures.push(f);
  if (!NONSOLID.includes(kind) && !(kind === 'door' && f.open)) box(tx * 4, ty * 4, (tx + tw) * 4, (ty + th) * 4, M.FIXTURE, 0, F_FIXTURE);
  return f;
}
function chest(site: SiteKey, tx: number, ty: number, items: Slot[], tw = 2, th = 2, data?: Record<string, unknown>) {
  const mul = G.diff.loot;
  const scaled = items.map(s => ({ ...s, n: /^(note|radio|battery|pick|saw|axe|lantern|flare_gun|barometer|flint|harpoon)/.test(s.id) ? s.n : Math.max(1, Math.round(s.n * mul)) }));
  const f = addFixture('chest', tx, ty, tw, th, { items: scaled, data });
  worldInfo.chests.push({ id: f.id, site, x: tx * 4 + tw * 2, y: ty * 4 + th * 2, items: scaled });
  for (const s of scaled) {
    const m = /^note_(.+)$/.exec(s.id);
    if (m) worldInfo.notes.push({ id: m[1], x: tx * 4 + tw * 2, y: ty * 4 + th * 2, where: site, container: 'chest' });
  }
  return f;
}
/** A note lying on the floor (a paper drop). */
function floorNote(id: string, site: SiteKey, x: number, y: number) {
  G.drops.push({ id: newId(), item: 'note_' + id, n: 1, x, y: y - 3, vx: 0, vy: 0, age: 0 });
  worldInfo.notes.push({ id, x, y, where: site, container: 'floor' });
}

// ---------------------------------------------------------------------------------------------------------------------
// houses
/** Place a solid log foundation column from yStart down to the first anchor material (so wooden walls are really carried by the ground). */
function foundation(x0: number, x1: number, yStart: number) {
  for (let x = x0; x < x1; x++) for (let y = yStart; y < Math.min(H - 8, yStart + 6); y++) {
    const i = y * W + x; if (ANCHOR[mat[i]]) break;
    mat[i] = M.LOG; aux[i] = 0; flags[i] = 0;
  }
}
/** Loose boards with chinks: 7 of 16 cells are solid, so the tile does not block wind (heat.ts: blocking needs ≥ 8 wind-blocking cells). */
function draftTile(tx: number, ty: number) {
  for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) { const x = tx * 4 + dx, y = ty * 4 + dy; if (dx === 0 || dy === 0) put(x, y, M.PLANK); else put(x, y, AIR); }
}
/** A cabin: plank floor, a doorway at each end (a masonry lintel above it carries the roof: door cells are not structural), stepped gable roof
 *  with snow on it. L,R = end tile columns; F = floor tile row; n = interior rows (n >= 7: furniture 2 tiles high still leaves headroom). */
function cabin(L: number, R: number, F: number, n: number, openEast = false) {
  const top = F - n;
  box((L - 1) * 4, (top - 12) * 4, (R + 2) * 4, F * 4, AIR);                       // clear space (stray snow)
  foundation(L * 4, L * 4 + 4, (F + 1) * 4); foundation(R * 4, R * 4 + 4, (F + 1) * 4);
  boxT(L, F, R, F, M.PLANK);
  boxT(L, top, L, F - 6, M.STONE); if (!openEast) boxT(R, top, R, F - 6, M.STONE); else boxT(R, top, R, top, M.STONE);   // lintel walls above the doors (natural STONE = structural anchor)
  bgT(L + 1, top, R - 1, F - 1, 5);
  boxT(L - 1, top - 1, R + 1, top - 1, M.LOG);                                       // eave row with overhang
  let kmax = 0;
  for (let k = 1; ; k++) {
    const lo = L + 1 + 2 * (k - 1), hi = R - 1 - 2 * (k - 1);
    if (lo > hi) break;
    boxT(lo, top - 1 - k, hi, top - 1 - k, M.PLANK); kmax = k;
  }
  // snow on the roof: loose snow on a 1:2 slope through the outer step corners (it may slide off, like real roof snow)
  const cx = ((L - 1) * 4 + (R + 2) * 4) / 2, topY = (top - 1 - kmax) * 4;
  for (let x = (L - 1) * 4; x < (R + 2) * 4; x++) {
    const sy = Math.round(topY - 3 + Math.abs(x + 0.5 - cx) * 0.5);
    let y = sy; while (y < H && mat[y * W + x] === AIR) y++;
    for (let yy = sy; yy < y; yy++) { const i = yy * W + x; mat[i] = M.SNOW; aux[i] = yy === sy ? 14 : 40 + ((yy - sy) * 6); flags[i] = 0; }
  }
  return { top, roofTop: topY - 3 };
}
/** Stove chimney: a dark strip behind the player inside the room (a solid pipe would wall the room in) and a solid metal pipe through the roof. */
function pipe(tx: number, topRow: number, stoveTopY: number) {
  const x = tx * 4 + 1;
  bgT(tx, topRow, tx, stoveTopY / 4 - 1, 7);
  let top = 60; while (top < topRow * 4 && mat[top * W + x] === AIR && mat[top * W + x + 1] === AIR) top++;      // first solid cell above (roof snow)
  top -= 7;
  box(x, top, x + 2, topRow * 4, M.METAL);                                                             // through the roof, from the ceiling up
  return top;
}

// ---------------------------------------------------------------------------------------------------------------------
export function stampLocations(T: Terrain) {
  stampMine(T); stampApron(T); stampCairn(T); stampStation(T); stampBeach(T); stampFastIce(T); stampIceberg(T); stampShip(T);
  stampSignalFire(T); stampOpenSea(T);
  addSite('cape', 210, 200, 300, 120);
  addSite('fastice', 1275, 296, 350, 60);
  addSite('pack', 1700, 300, 500, 80);
  addSite('beach', 1000, 290, 200, 50);
}

// ---------------------------------------------------------------------------------------------------------------------
// MINE «Шахта №3»
const MI = LOC.mine;
const FA = MI.floorA, FB = MI.floorB, HA = MI.hA;
/** Carve a horizontal-ish drift between x0 and x1: floorOf(x) = first solid row; `h` rows of air above it. */
function drift(x0: number, x1: number, floorOf: (x: number) => number, h: number, lining = 2) {
  for (let x = x0; x < x1; x++) { const f = floorOf(x); for (let y = f - h; y < f; y++) { const i = y * W + x; if (mat[i] !== M.BEDROCK) { mat[i] = AIR; aux[i] = 0; flags[i] = 0; } } }
  for (let x = x0; x < x1; x += 4) { const f = floorOf(x); bgBox(x, f - h, x + 4, f, lining); }
}
function timberFrame(x: number, floor: number, h: number) {                          // PLANK cap beam in the roof + wooden posts as wall decoration
  box(x - 1, floor - h, x + 7, floor - h + 4, M.PLANK);
  bgBox(x, floor - h + 4, x + 4, floor, 7);
}
function stampMine(T: Terrain) {
  const [c0, c1] = MI.collapse;
  // --- coal seams and soapstone: lenses in the rock (before the tunnels so they are cut through) ---
  const seams: { y: (x: number) => number; th: number; x0: number; x1: number }[] = [];
  for (let k = 0; k < 7; k++) {
    const y0 = 246 + k * 24 + randInt(-4, 4), sl = (rand() - 0.5) * 0.18, th = randInt(4, 8), x0 = 84 + randInt(0, 40), x1 = 300 + randInt(0, 70), ph = rand() * 6;
    seams.push({ y: (x) => y0 + (x - 200) * sl + Math.sin(x / 31 + ph) * 3, th, x0, x1 });
  }
  for (const s of seams) for (let x = s.x0; x < s.x1; x++) {
    const yc = s.y(x), t = s.th * (0.5 + 0.5 * Math.sin((x - s.x0) / (s.x1 - s.x0) * Math.PI)) * (0.7 + 0.5 * noise1(x * 0.13));
    for (let y = Math.round(yc - t / 2); y < yc + t / 2; y++) { const i = y * W + x; if (mat[i] === M.STONE || mat[i] === M.DIRT) { mat[i] = M.COAL; aux[i] = 0; } }
  }
  // soapstone vein crossing the stairway zone and the cut face
  const sv = (x: number) => 360 - (x - 96) * 0.95;
  for (let x = 92; x < 150; x++) for (let y = Math.round(sv(x) - 5); y < sv(x) + 5 + 2 * noise1(x * 0.2); y++) { const i = y * W + x; if (mat[i] === M.STONE) { mat[i] = M.SOAPSTONE; aux[i] = 0; } }
  for (let x = 300; x < 323; x++) for (let y = Math.round(205 + (x - 300) * 1.2); y < 215 + (x - 300) * 1.2; y++) { const i = y * W + x; if (mat[i] === M.STONE) { mat[i] = M.SOAPSTONE; aux[i] = 0; } }

  // --- tunnels ---
  drift(MI.rampTop, MI.portalX + 1, () => FA, HA, 2);                                              // A: the adit
  drift(MI.rampBot, MI.rampTop, (x) => FA + 4 * Math.floor((MI.rampTop - x) / 5), HA, 2);           // ramp (stairs: rise 4 / run 5)
  drift(MI.rampBot, MI.lakeRamp, () => FB, HA, 2);                                                 // B
  box(MI.hut[0], FB - 34, MI.hut[1], FB - HA, AIR);                                                // taller hut chamber
  drift(MI.lakeRamp, MI.lake.x0 + 26, (x) => Math.min(MI.lake.shore, FB + 4 * Math.floor((x - MI.lakeRamp) / 5)), HA, 3);
  // the stairs near level B are wooden wedges inside the open space of B
  for (let x = MI.rampBot; x < MI.rampBot + 40; x++) {
    const f = FA + 4 * Math.floor((MI.rampTop - x) / 5);
    if (f < FB) for (let y = f; y < FB; y++) { put(x, y, M.PLANK); }
  }
  // the coal seams show on the back wall of the tunnels
  for (const sm of seams) for (let x = Math.max(sm.x0, MI.rampBot - 4); x < Math.min(sm.x1, MI.portalX); x += 4) {
    const yc = sm.y(x);
    for (let y = Math.floor((yc - sm.th) / 4) * 4; y < yc + sm.th; y += 4) { const tx = x >> 2, ty = y >> 2; if (mat[(ty * 4 + 2) * W + tx * 4 + 2] === AIR && (bg[ty * TW + tx] === 2 || bg[ty * TW + tx] === 1)) bg[ty * TW + tx] = 8; }
  }
  // collapse: rubble, gravel mostly so a shovel gets through
  for (let x = c0; x < c1; x++) {
    const prof = Math.sin((x - c0) / (c1 - c0) * Math.PI);
    for (let y = FA - HA; y < FA; y++) {
      const fromFloor = FA - y, i = y * W + x;
      if (fromFloor > 10 + 15 * prof && fromFloor < HA - 6) continue;       // open gap high up under the ceiling
      const r = rand();
      if (fromFloor > 21 && r < 0.2) put(x, y, M.STONE);                          // boulders and coal only above head height: the way through is gravel and timber
      else if (fromFloor > 21 && r < 0.3) put(x, y, M.COAL);
      else if (r < 0.1 && fromFloor > 4) put(x, y, rand() < 0.5 ? M.LOG : M.PLANK);
      else { mat[i] = M.GRAVEL; aux[i] = 0; flags[i] = 0; }
    }
  }
  // the roof above the cave-in is torn open
  for (let y = FA - HA - 12; y < FA - HA + 2; y++) for (let x = c0 + 2; x < c1 - 2; x++) { const dx = (x - (c0 + c1) / 2) / 11, dy = (y - (FA - HA - 3)) / 9; if (dx * dx + dy * dy < 1) put(x, y, AIR); }
  bgBox(c0, FA - HA - 12, c1, FA - HA + 2, 2);
  // timber frames (cap beams + posts as wall decoration)
  for (const fx of [316, 294, 272, 252, 214, 196]) timberFrame(fx, FA, HA);
  for (const fx of [150, 172]) timberFrame(fx, FB, HA);
  // portal: heavy header and bg posts
  box(MI.portalX - 8, FA - HA - 2, MI.portalX + 14, FA - HA + 6, M.LOG); bgBox(MI.portalX + 10, FA - HA, MI.portalX + 14, FA, 7); bgBox(MI.portalX - 4, FA - HA, MI.portalX, FA, 7);
  // --- rails with sleepers, a cart ---
  const rails = (x0: number, x1: number, f: number, gap: [number, number] | null) => {
    for (let x = x0; x < x1; x++) {
      if (gap && x >= gap[0] && x < gap[1]) continue;
      if (mat[(f - 1) * W + x] !== AIR && mat[(f - 1) * W + x] !== M.METAL) continue;
      put(x, f - 1, M.METAL);
      if (((x >> 2) & 1) === 0 && (x & 3) < 4) { put(x, f, M.PLANK); put(x, f + 1, M.PLANK); }
    }
  };
  rails(c1, MI.portalX + 52, FA, null);
  rails(MI.rampTop + 10, c0, FA, null);
  rails(MI.rampBot + 40, MI.lakeRamp, FB, [MI.hut[0], MI.hut[1]]);
  addFixture('cart', 74, FA / 4 - 2, 4, 2, { data: { loaded: 'coal' } });
  worldInfo.spots.portal = { x: MI.portalX + 4, y: FA - 10 };
  // --- hut chamber: timber lined, floor planks, beams, furniture, chest ---
  const [h0, h1] = MI.hut;
  box(h0, FB - 34, h1, FB - 30, M.PLANK);                                                          // ceiling beams
  box(h0, FB, h1, FB + 4, M.PLANK);
  bgBox(h0, FB - 30, h1, FB, 5);
  // support posts at the ends (decorative, behind the player)
  for (let x = h0; x < h1; x += 12) bgBox(x, FB - 30, x + 4, FB, 7);
  addFixture('bed', 50, FB / 4 - 1, 4, 1);
  addFixture('table', 58, FB / 4 - 2, 3, 2);
  chest('minehut', 54, FB / 4 - 2, [slot('pick', 1), slot('radio_coil', 1), slot('torch', 3), slot('tin', 2), slot('matches', 6), slot('note_n3', 1)], 2, 2, { look: 'miner' });
  worldInfo.radioParts.coil = { x: 54 * 4 + 4, y: FB - 4, site: 'minehut' };
  floorNote('n4', 'minehut', 208, FB);
  addSite('minehut', (h0 + h1) / 2, FB - 14, h1 - h0, 40);
  // --- bulkhead and sealed methane pocket in the west dead end ---
  const [p0, p1] = MI.pocket;
  box(p0, FB - HA, p1, FB, AIR);
  box(p0, FB - HA, p1, FB, M.METHANE, 0);
  bgBox(p0, FB - HA, p1, FB, 2);
  box(MI.bulkhead, FB - HA, MI.bulkhead + 4, FB, M.PLANK);
  box(MI.bulkhead, FB - 20, MI.bulkhead + 4, FB - 18, M.METAL); box(MI.bulkhead, FB - 8, MI.bulkhead + 4, FB - 6, M.METAL);
  worldInfo.spots.methane = { x: Math.round((p0 + p1) / 2), y: FB - 10 };
  floorNote('n5', 'mine', MI.bulkhead + 12, FB);
  // --- adit notes ---
  floorNote('n2', 'mine', 306, FA);
  // --- the underground ice lake ---
  stampIceLake(T);
  addSite('mine', 215, 300, 280, 140);
}

function stampIceLake(T: Terrain) {
  void T;
  const L = MI.lake, mid = (L.x0 + L.x1) / 2, iceY = L.ice;
  for (let x = L.x0; x < L.x1; x++) {
    const u = (x - mid) / ((L.x1 - L.x0) / 2);
    const ceil = Math.round(338 + 30 * u * u * u * u + 24 * u * u);
    for (let y = ceil; y < iceY + 34; y++) { const i = y * W + x; if (mat[i] !== M.BEDROCK) { mat[i] = AIR; aux[i] = 0; flags[i] = 0; } }
    // west / east shores: stone ledges, then the frozen lake
    const shore = Math.abs(u) > 0.62;
    const floorY = shore ? L.shore + (Math.abs(u) > 0.62 ? 0 : 0) : iceY;
    if (shore) { for (let y = L.shore; y < iceY + 34; y++) put(x, y, M.STONE); }
    else {
      const thin = Math.abs(x - 340) < 7;
      const ti = thin ? iceY + 5 : iceY;
      for (let y = iceY; y < iceY + 8; y++) if (y >= ti) put(x, y, M.ICE, 0);
      for (let y = iceY + 8; y < iceY + 28; y++) put(x, y, M.WATER);
      for (let y = iceY + 28; y < iceY + 34; y++) put(x, y, M.STONE);
      if (thin) for (let y = iceY; y < ti; y++) put(x, y, AIR);
    }
    void floorY;
    bgBox(x, ceil, x + 4, iceY + 34, 3);
  }
  // shore stairs down to the ice on the west side (rise 4 / run 5 matching the ramp)
  for (let x = L.x0 + 26; x < L.x0 + 40; x++) { const f = Math.min(iceY, L.shore + 4 * Math.floor((x - (L.x0 + 26)) / 5)); for (let y = f; y < iceY + 4; y++) put(x, y, M.STONE); for (let y = f - HA; y < f; y++) put(x, y, AIR); }
  // frost lining and icicles under the cavern roof
  for (let x = L.x0 + 36; x < L.x1; x++) {
    let y = 330; while (y < iceY && mat[y * W + x] !== AIR) y++;               // first air row under the rock ceiling
    for (let k = 1; k <= 2 + ((rand() * 3) | 0); k++) { if (mat[(y - k) * W + x] === M.STONE) put(x, y - k, M.ICE); }
    if (rand() < 0.14 && y < iceY - 12) { const len = randInt(3, 13); for (let k = 0; k < len && mat[(y + k) * W + x] === AIR; k++) put(x, y + k, M.ICE); }
  }
  // far (east) shore niche with a cache
  const sx = L.x1 - 14;
  box(sx - 2, L.shore - 12, sx + 12, L.shore, AIR);
  chest('icelake', Math.floor(sx / 4), L.shore / 4 - 2, [slot('fat', 3), slot('matches', 4), slot('rope', 2), slot('note_n6', 1)], 2, 2, { look: 'old' });
  worldInfo.spots.lakeThin = { x: 340, y: iceY };
  addSite('icelake', mid, 372, L.x1 - L.x0, 70);
}

function stampApron(T: Terrain) {
  // spoil heaps in front of the portal: coal and gravel, rails end at a tipple
  const x0 = MI.portalX + 24, x1 = MI.portalX + 52;
  for (let x = x0; x < x1; x++) {
    const t = 1 - Math.abs((x - (x0 + x1) / 2) / ((x1 - x0) / 2)), hh = Math.round(14 * t * (0.7 + 0.5 * noise1(x * 0.2)));
    for (let k = 1; k <= hh; k++) { const y = FA - 1 - k; if (mat[y * W + x] === AIR) put(x, y, rand() < 0.6 ? M.COAL : M.GRAVEL); }
  }
  worldInfo.coal.push({ x: (x0 + x1) >> 1, y: FA - 8 });
  snowBank(x1 - 6, x1 + 18, x1 + 2, 6, 200, 130);
  void T;
}

// ---------------------------------------------------------------------------------------------------------------------
// CAIRN with the tin box
function stampCairn(T: Terrain) {
  const cx = LOC.cairn.x, gy = T.surf[cx];
  const gyA = Math.floor(gy / 4) * 4;                    // tile aligned ground line for the niche
  // base pad and a pyramid of rough stones
  box(cx - 20, gyA, cx + 24, gyA + 4, M.STONE);
  for (let r = 0; r < 8; r++) {
    const w = 28 - 3.2 * r, y0 = gyA - 3 * (r + 1);
    for (let x = Math.round(cx - w / 2); x <= Math.round(cx + w / 2); x++) {
      for (let y = y0; y < y0 + 3; y++) { const e = Math.abs(x - cx) / (w / 2); if (e > 0.82 && rand() < 0.5) continue; if (rand() < 0.07) continue; put(x, y, M.STONE); }
    }
  }
  box(cx - 3, gyA - 30, cx + 3, gyA - 24, M.STONE);              // the top stone
  const hgt = new Int16Array(40);
  // niche on the east side with the tin box
  box(cx + 5, gyA - 8, cx + 13, gyA, AIR);
  bgBox(cx + 5, gyA - 8, cx + 13, gyA, 2);
  chest('cairn', Math.floor((cx + 6) / 4), gyA / 4 - 2, [slot('matches', 4), slot('note_n1', 1)], 2, 2, { look: 'tin' });
  worldInfo.spots.cairn = { x: cx, y: gyA };
  // snow in the lee
  snowBank(cx + 16, cx + 44, cx + 22, 7, 180, 140);
  addSite('cairn', cx, gyA - 12, 70, 60);
}

// ---------------------------------------------------------------------------------------------------------------------
// STATION «Мыс Безмолвия»
function stampStation(T: Terrain) {
  const F = LOC.station.y / 4;                            // floor tile row 68
  const { L, R } = LOC.house;
  const { top } = cabin(L, R, F, 8);
  // draughty places: loose boards in the ceiling (the eave row); banking snow on the roof and at the doors fixes it
  draftTile(L + 5, top - 1); draftTile(R - 6, top - 1);
  // high windows next to the lintels (glass is weak: it must sit close to the stone)
  boxT(L + 1, top - 1, L + 1, top - 1, M.GLASS); boxT(R - 1, top - 1, R - 1, top - 1, M.GLASS);
  addFixture('door', L, F - 5, 1, 5, { open: false, data: { side: 'west' } });
  addFixture('door', R, F - 5, 1, 5, { open: false, data: { side: 'east' } });
  // furniture
  addFixture('bed', L + 3, F - 1, 4, 1);
  chest('station', L + 7, F - 2, [slot('can', 2), slot('biscuit', 4), slot('tea', 1), slot('matches', 8), slot('lantern', 1), slot('flare_gun', 1), slot('flare', 3), slot('rope', 1), slot('note_s1', 1)], 2, 2, { look: 'shelf' });
  floorNote('s2', 'station', (L + 9) * 4 + 4, F * 4);
  addFixture('table', L + 9, F - 2, 3, 2);
  addFixture('radio', L + 12, F - 2, 2, 2, { data: { fixed: false, parts: 0 } });
  const stove = addFixture('stove', L + 14, F - 2, 2, 2, { fuel: 0, lit: false });
  const pTop = pipe(L + 14, top, (F - 2) * 4);
  stove.data = { smokeX: (L + 14) * 4 + 2, smokeY: pTop };
  // outside: barometer post east of the door, kennel and flag pole on the west side
  const bx = (R + 5) * 4;
  bgT(R + 5, F - 8, R + 5, F - 1, 5);                                        // the post is a wooden strip behind the player (a solid pole would block the way)
  addFixture('barometer', R + 5, F - 10, 2, 2, {});
  worldInfo.spots.barometer = { x: bx + 4, y: F * 4 - 32 };
  addFixture('kennel', L - 11, F - 3, 5, 3, { data: { dog: 'Север' } });
  worldInfo.spots.kennel = { x: (L - 11) * 4 + 10, y: F * 4 };
  bgT(L - 6, F - 16, L - 6, F - 1, 5);                                        // flag pole (background strip)
  addFixture('flag', L - 6, F - 18, 3, 2, {});
  snowBank(L * 4 - 52, L * 4 - 18, L * 4 - 30, 3, 190, 110);
  snowBank(R * 4 + 26, R * 4 + 70, R * 4 + 38, 4, 190, 130);
  addSite('station', (L + R) * 2 + 2, top * 4 + 20, 140, 90);
  worldInfo.spots.spawn = { x: LOC.spawn.x, y: LOC.station.y };
  stampMastAndShed(T);
}

function stampMastAndShed(T: Terrain) {
  const F = LOC.station.y / 4;
  // the meteo mast: a stump with the fixture and the antenna mast lying on the snow
  const mx = 708;
  bgT(mx >> 2, F - 5, mx >> 2, F - 1, 7);                                    // the broken stump (background strip)
  box(mx - 3, F * 4 - 3, mx + 7, F * 4, M.METAL);
  addFixture('mast', mx >> 2, F - 6, 2, 4, { data: { fallen: true } });
  worldInfo.spots.mast = { x: mx + 4, y: F * 4 - 10 };
  snowBank(mx + 8, mx + 52, mx + 28, 4, 190, 130);
  const mastY = (x: number) => topSolid(x, 200) - 2;
  for (let x = mx + 10; x < mx + 50; x++) { box(x, mastY(x) - 1, x + 1, mastY(x) + 2, M.METAL); }
  for (let k = 0; k < 3; k++) { const x = mx + 16 + k * 10; box(x, mastY(x) - 4, x + 2, mastY(x) + 1, M.METAL); }
  // generator shed with fuel drums and the battery under a drift (the east end is torn open: the drift came in)
  const { L, R } = LOC.shed;
  const { top } = cabin(L, R, F, 8, true);
  draftTile(L + 4, top - 1);
  boxT(R - 1, top - 1, R - 1, top - 1, M.GLASS);
  addFixture('door', L, F - 5, 1, 5, { open: false, data: { side: 'west' } });
  addFixture('drum', L + 3, F - 2, 2, 2, { data: { fuel: 'diesel', n: 6 } });
  addFixture('drum', L + 5, F - 2, 2, 2, { data: { fuel: 'diesel', n: 8 } });
  chest('shed', L + 8, F - 2, [slot('coal', 14), slot('axe', 1), slot('scrap', 6), slot('tin', 2), slot('rope', 1), slot('diesel', 1)], 2, 2, { look: 'bench' });
  chest('shed', R - 3, F - 2, [slot('battery', 1)], 2, 2, { buried: true });
  worldInfo.radioParts.battery = { x: (R - 3) * 4 + 4, y: (F - 1) * 4, site: 'shed' };
  // the drift: packed in the east half, loose crown, a tongue reaching outside
  const x0 = (L + 8) * 4, x1 = (R + 1) * 4 + 22;
  for (let x = x0; x < x1; x++) {
    const t = Math.min(1, (x - x0) / (4 * 4)), tail = 1 - Math.max(0, (x - R * 4) / 22);
    const hh = Math.round((6 + 22 * t) * Math.max(0, tail) * (0.9 + 0.2 * noise1(x * 0.25)));
    for (let k = 1; k <= hh; k++) { const y = F * 4 - k; if (mat[y * W + x] === AIR) put(x, y, k > hh - 3 ? M.SNOW : M.PACKED, k > hh - 3 ? 12 : 110 + ((rand() * 40) | 0)); }
  }
  // coal heap and fuel drums outside
  const hx0 = (L - 12) * 4, hx1 = (L - 6) * 4;
  for (let x = hx0; x < hx1; x++) {
    const t = 1 - Math.abs((x - (hx0 + hx1) / 2) / ((hx1 - hx0) / 2)), hh = Math.round(9 * t);
    for (let k = 1; k <= hh; k++) { const y = F * 4 - k; if (mat[y * W + x] === AIR) put(x, y, k > hh - 2 ? M.SNOW : M.COAL, k > hh - 2 ? 40 : 0); }
  }
  worldInfo.coal.push({ x: (hx0 + hx1) >> 1, y: F * 4 - 6 });
  addFixture('drum', R + 3, F - 2, 2, 2, { data: { fuel: 'diesel', n: 5 } });
  addFixture('drum', R + 5, F - 2, 2, 2, { data: { fuel: 'diesel', n: 7 } });
  addFixture('drum', R + 7, F - 2, 2, 2, { data: { fuel: 'diesel', n: 0, empty: true } });
  addSite('shed', (L + R) * 2 + 2, top * 4 + 12, 80, 60);
  void T;
}

// ---------------------------------------------------------------------------------------------------------------------
// BEACH: driftwood, whale skeleton, shore ice blocks, tide crack
function stampBeach(T: Terrain) {
  // shore ice blocks piled on the gravel and the first ice (before the skeleton, so nothing is stacked on bones)
  pileBlocks(1052, 1078, 10, 40, M.ICE, 5, 12, 3, 5, { x0: 1060, x1: 1072, cap: 4 });
  pileBlocks(1074, 1098, 10, 40, M.ICE, 5, 12, 3, 5, { x0: 1078, x1: 1090, cap: 4 });
  // a pass through the pile and a ramp of packed snow from the gravel up onto the ice foot, so the sea ice is reachable on foot
  for (let x = 1058; x <= 1086; x++) {
    const rampY = Math.round(T.surf[1052] - (x - 1052) * 0.22);                       // 1 cell of rise per ~4.5 cells
    for (let y = 150; y < rampY - 1; y++) { const i = y * W + x; if (mat[i] === M.ICE || isSoft(mat[i])) { mat[i] = AIR; aux[i] = 0; } }
    for (let y = rampY; y < rampY + 12; y++) { const i = y * W + x; if (mat[i] === AIR || mat[i] === M.ICE) { mat[i] = M.PACKED; aux[i] = 150; flags[i] = 0; } }
  }
  // driftwood logs, half buried (laid first so the skeleton lies on top of them)
  for (let k = 0; k < 16; k++) {
    const len = randInt(20, 48), x0 = randInt(904, 1050 - len), r = randInt(3, 4);
    const y0 = T.surf[x0 + (len >> 1)] - r + 1, tilt = (rand() - 0.5) * 0.12;
    for (let u = 0; u < len; u++) for (let v = -r; v <= r; v++) {
      const yy = Math.round(y0 + u * tilt) + v, xx = x0 + u, i = yy * W + xx;
      if (mat[i] === AIR || isSoft(mat[i])) { mat[i] = M.WOOD; aux[i] = 0; flags[i] = 0; }
    }
    if (rand() < 0.5) { for (let b = 0; b < 4; b++) line(x0 + 2, y0 - r, x0 - 4 - b * 2, y0 - r - 6 - b * 2, M.WOOD, 2, true); }       // rootball branches
    worldInfo.driftwood.push({ x: x0, y: y0, len });
    snowBank(x0 + len, x0 + len + 16, x0 + len + 3, 4, 200, 120);
  }
  // whale skeleton: a bone arch you can walk under. The spine rises from the gravel into an arch, ribs hang from it (tips 22 cells above the
  // ground so the way stays open), the tail sinks into the gravel on the left, a low wedge-shaped skull and jaws lie to the right.
  const cx = 930, gy = T.surf[cx];
  const wb = (x: number, y: number, w: number, h: number) => box(x, y, x + w, y + h, M.WHALEBONE, 0, 0, false);
  const spineH = (x: number) => { const t = (x - (cx - 60)) / 120; return t <= 0 || t >= 1 ? 0 : 5 + 40 * Math.pow(Math.sin(Math.PI * t), 0.75); };
  const gAt = (x: number) => T.surf[Math.max(8, Math.min(W - 9, x))];
  for (let x = cx - 96; x < cx + 66; x++) {
    const h = spineH(x), y = gAt(x) - Math.round(h) - 2;
    wb(x, y, 1, 4);
    if (((x - cx) % 6) === 0) wb(x - 2, y - 2, 5, 7);                        // vertebrae
  }
  for (let k = -4; k <= 4; k++) {                                              // ribs hanging from the spine
    const ax = cx + k * 12, sy0 = gAt(ax) - Math.round(spineH(ax)) - 2, tipY = gAt(ax) - 22, L = tipY - sy0;
    if (L < 8) continue;
    for (let rep = 0; rep < 2; rep++) {
      const side = rep ? 5 : 0; let px = ax + side, py = sy0;
      for (let q = 1; q <= 18; q++) {
        const t = q / 18, bx = (1 - t) * (1 - t) * (ax + side) + 2 * t * (1 - t) * (ax + side - 9) + t * t * (ax + side - 3), by = (1 - t) * (1 - t) * sy0 + 2 * t * (1 - t) * (sy0 + L * 0.3) + t * t * (sy0 + L);
        line(px, py, bx, by, M.WHALEBONE, rep ? 2 : 3); px = bx; py = by;
      }
    }
  }
  // low skull: a long wedge of bone (walkable), a lower jaw and a rostrum
  const sx = cx + 66;
  for (let u = 0; u < 78; u++) {
    const x = sx + u, g = gAt(x), top = g - Math.round(4 + 12 * Math.sin(Math.PI * Math.min(1, u / 70)) ** 0.8);
    wb(x, top, 1, 3);
    if (u % 9 === 0) wb(x, top, 2, g - top);                                   // struts
  }
  line(sx + 4, gAt(sx + 4) - 2, sx + 70, gAt(sx + 70) - 3, M.WHALEBONE, 3);   // lower jaw
  box(sx + 14, gAt(sx + 14) - 14, sx + 20, gAt(sx + 14) - 8, AIR);            // eye socket
  worldInfo.spots.whale = { x: cx, y: gy - 30 };
  floorNote('n7', 'whale', cx + 6, T.surf[cx + 6] - 1);
  addSite('whale', cx + 10, gy - 20, 190, 70);
  floorNote('n8', 'beach', 952, T.surf[952]);
  // tide crack: a narrow gap through the grounded ice down to the seabed, with hairline crack lines
  const tx = 1090;
  for (let x = tx; x < tx + 3; x++) for (let y = 284; y < T.seabed[x] + 1; y++) { const i = y * W + x; if (mat[i] === M.ICE || mat[i] === M.SNOW || mat[i] === M.PACKED) { mat[i] = y < SEA ? AIR : M.WATER; aux[i] = 0; } }
  for (let k = 0; k < 4; k++) { const hx = tx - 14 + k * 9; for (let y = T.iceTop[hx] - 6; y < T.iceTop[hx] + 5 + k; y++) { const i = y * W + hx; if (mat[i] === M.SNOW || mat[i] === M.PACKED || mat[i] === M.ICE) { mat[i] = AIR; aux[i] = 0; } } }
  worldInfo.spots.tideCrack = { x: tx + 1, y: SEA - 6 };
  void fbm1;
}

// ---------------------------------------------------------------------------------------------------------------------
// FAST ICE: pressure hummocks and stranded driftwood (seal holes are cut by worldgen)
function stampFastIce(T: Terrain) {
  for (const hx of [1236, 1296, 1412]) {
    const hgt = pileBlocks(hx - 16, hx + 16, 8, 24, M.ICE, 4, 9, 3, 4, { x0: hx - 6, x1: hx + 6, cap: 4 });
    snowBank(hx + 16, hx + 40, hx + 22, 6, 200, 170);
    worldInfo.iceField.ridges.push({ x: hx, w: 32, h: Math.max(...Array.from(hgt)) });
  }
  void T;
}

// ---------------------------------------------------------------------------------------------------------------------
// ICEBERG with an ice cave
function stampIceberg(T: Terrain) {
  const cx = LOC.iceberg.x;
  const peaks: [number, number][] = [[-47, 0], [-42, 10], [-33, 30], [-26, 46], [-18, 74], [-11, 60], [-3, 46], [4, 56], [12, 70], [16, 72], [20, 62], [24, 44], [28, 20], [31, 0]];
  const hAt = (u: number) => {
    for (let i = 0; i < peaks.length - 1; i++) if (u >= peaks[i][0] && u <= peaks[i + 1][0]) { const t = (u - peaks[i][0]) / (peaks[i + 1][0] - peaks[i][0]); return peaks[i][1] + (peaks[i + 1][1] - peaks[i][1]) * t; }
    return 0;
  };
  const base = T.iceTop[cx];
  const iceH = new Int16Array(110);
  for (let u = -47; u <= 31; u++) {
    const x = cx + u, h = Math.round(hAt(u) + (fbm1(x / 5, 2) - 0.5) * 5);
    iceH[u + 50] = h;
    for (let y = base - h; y < base; y++) put(x, y, M.ICE, 0);
    // underwater part: tapers down
    const dep = Math.round(58 * Math.pow(Math.max(0, 1 - ((u + 8) / 40) * ((u + 8) / 40)), 0.55));
    for (let y = base; y < Math.min(T.seabed[x] - 1, base + dep + 14); y++) put(x, y, M.ICE, 0);
    // snow on the gentle slopes
    for (let y = base - h; y < base - h + 3; y++) {
      const sl = Math.abs(hAt(u + 3) - hAt(u - 3)) / 6;
      if (sl < 1.6 && mat[(y + 0) * W + x] === M.ICE && mat[(y - 1) * W + x] === AIR) { put(x, y - 1, M.SNOW, 20 + ((rand() * 40) | 0)); if (sl < 0.8) put(x, y - 2, M.SNOW, 12); break; }
    }
  }
  // the cave: a low entrance on the east (lee) foot, a domed chamber inside
  const floorY = 288;                                   // tile aligned walking level inside (the sheet surface is ~290)
  const entU = 31;
  for (let u = 4; u <= entU + 2; u++) {                // tunnel
    const x = cx + u, top = floorY - 24;
    let sfc = 150; while (sfc < top && mat[sfc * W + x] === AIR) sfc++;
    if (sfc > top - 7) for (let y = sfc; y < top; y++) { const i = y * W + x; if (mat[i] === M.ICE || isSoft(mat[i])) { mat[i] = AIR; aux[i] = 0; } }      // no thin roof slivers over the mouth
    for (let y = top; y < floorY; y++) { put(x, y, AIR); markBg(x, y, 3); }
    for (let y = floorY; y < floorY + 3; y++) put(x, y, M.ICE);
  }
  for (let u = -10; u <= 6; u++) {                     // chamber (dome)
    const x = cx + u, t = (u + 2) / 9, top = Math.max(Math.round(floorY - 24 - 26 * Math.max(0, 1 - t * t)), base - iceH[u + 50] + 8);
    for (let y = top; y < floorY; y++) { put(x, y, AIR); markBg(x, y, 3); }
    for (let y = floorY; y < floorY + 3; y++) put(x, y, M.ICE);
  }
  // icicles hang from the cave roof, a few ice columns stand on the floor of the chamber
  for (let u = -10; u <= entU; u++) {
    const x = cx + u; let y = floorY - 1; while (y > 200 && mat[y * W + x] === AIR) y--;       // first ice cell above the cave air = the roof
    if (y > floorY - 40 && y < floorY - 8 && rand() < 0.2) { const len = randInt(3, 10); for (let k = 1; k <= len && mat[(y + k) * W + x] === AIR; k++) put(x, y + k, M.ICE); }
    if (rand() < 0.05 && u < 4) { const hh = randInt(4, 10); for (let k = 1; k <= hh; k++) if (mat[(floorY - k) * W + x] === AIR) put(x, floorY - k, M.ICE); }
  }
  chest('icecave', Math.floor((cx - 8) / 4), floorY / 4 - 2, [slot('fat', 3), slot('sinew', 2), slot('tin', 2), slot('rope', 2), slot('matches', 3), slot('note_n9', 1)], 2, 2, { look: 'old' });
  floorNote('n10', 'icecave', cx - 2, floorY);
  worldInfo.spots.iceberg = { x: cx, y: base - 40 };
  worldInfo.spots.icecave = { x: cx - 4, y: floorY - 8 };
  addSite('iceberg', cx - 8, base - 30, 90, 120);
  addSite('icecave', cx + 4, floorY - 14, 50, 44);
  snowBank(cx + 34, cx + 76, cx + 42, 8, 200, 190);
  worldInfo.iceField.ridges.push({ x: cx, w: 80, h: 74 });
}

// ---------------------------------------------------------------------------------------------------------------------
// The ghost ship «Заря», frozen into a thick floe, listing. Local coordinates: u east of the mast centre, d down from the deck line.
function stampShip(T: Terrain) {
  const cx = LOC.ship.x, yD = 280, LIST = -0.085;
  const wx = (u: number) => cx + Math.round(u), wy = (u: number, d: number) => yD + Math.round(d) + Math.round(u * LIST);
  const L = (u: number, d: number, m: number, a = 0) => put(wx(u), wy(u, d), m, a);
  const LB = (u0: number, u1: number, d0: number, d1: number, m: number, a = 0) => { for (let u = u0; u < u1; u++) for (let d = d0; d < d1; d++) L(u, d, m, a); };
  const dBot = (u: number) => { const t = (u - 10) / (u > 10 ? 76 : 90); return Math.abs(t) >= 1 ? 0 : 22 + 42 * Math.pow(1 - t * t, 0.55); };
  const uMin = (d: number) => -80 + 0.03 * d, uMax = (d: number) => 86 - 0.2 * d;
  const inHull = (u: number, d: number, off: number) => u >= uMin(d) + off && u <= uMax(d) - off && d <= dBot(u) - off && d >= off - 4;
  // hull shell: tarred planks, iron sheathing on the lower part
  for (let u = -82; u <= 88; u++) for (let d = -8; d <= 66; d++) {
    if (!inHull(u, d, 0)) continue;
    if (inHull(u, d, 4)) continue;
    L(u, d, d > 14 && !inHull(u, d, 2) ? M.METAL : M.PLANK);
  }
  // hold interior: clear it first (cut out of the ice), then structure
  for (let u = -80; u <= 86; u++) for (let d = 0; d <= 66; d++) if (inHull(u, d, 4)) { L(u, d, AIR); markBg(wx(u), wy(u, d), 7); }
  // ballast
  for (let u = -80; u <= 86; u++) { const lim = Math.min(56, dBot(u) - 4); for (let d = Math.floor(lim); d <= dBot(u) - 4; d++) L(u, d, d > lim + 2 ? M.STONE : M.PLANK); }
  // decks: planks with an iron beam row underneath (carries the span for the structure solver)
  const deckHole = (u: number) => u >= -28 && u < 4;
  for (let u = -78; u <= 82; u++) { if (deckHole(u)) continue; LB(u, u + 1, 0, 3, M.PLANK); L(u, 3, M.METAL); }
  const crewHole = (u: number) => u >= 16 && u < 48;
  for (let u = -78; u <= 80; u++) { if (crewHole(u)) continue; LB(u, u + 1, 28, 31, M.LOG); L(u, 31, M.METAL); }
  // stairs: deck -> crew deck, crew deck -> hold (solid wedges, 4 up per 4 along)
  for (let k = 0; k < 7; k++) LB(-28 + 4 * k, -24 + 4 * k, 4 * (k + 1), 32, M.PLANK);
  for (let k = 0; k < 7; k++) LB(16 + 4 * k, 20 + 4 * k, 28 + 4 * (k + 1), 60, M.PLANK);
  // bunks and shelves on the crew deck
  for (let b = 0; b < 3; b++) { const u0 = -70 + b * 14; LB(u0, u0 + 12, 18, 20, M.PLANK); LB(u0, u0 + 2, 18, 28, M.PLANK); LB(u0 + 10, u0 + 12, 18, 28, M.PLANK); }
  LB(-44, -30, 14, 16, M.PLANK); LB(-44, -42, 14, 28, M.PLANK); LB(-32, -30, 14, 28, M.PLANK);
  // coal bunker in the stern hold: a heap behind a low bulkhead, crates in the bow hold
  for (let u = -70; u < -26; u++) { const t = 1 - Math.abs((u + 48) / 24), hh = Math.round(14 * Math.max(0, t) * (0.8 + 0.4 * noise1(u * 0.3))); for (let k = 1; k <= hh; k++) if (mat[wy(u, 56 - k) * W + wx(u)] === AIR) L(u, 56 - k, M.COAL); }
  LB(-27, -24, 40, 56, M.PLANK);
  for (let c = 0; c < 5; c++) { const u0 = 52 + (c % 3) * 9, lev = c < 3 ? 0 : 1; LB(u0, u0 + 8, 56 - 8 * (lev + 1), 56 - 8 * lev, M.PLANK); LB(u0 + 3, u0 + 5, 56 - 8 * (lev + 1), 56 - 8 * (lev + 1) + 2, M.METAL); }
  // canvas bales
  LB(26, 34, 48, 56, M.CANVAS); LB(26, 34, 40, 48, M.CANVAS);
  // captain's cabin on the stern deck
  LB(-76, -72, -34, 0, M.LOG); LB(-38, -34, -34, -26, M.LOG); LB(-38, -34, -2, 0, M.LOG);
  LB(-80, -30, -38, -34, M.PLANK); LB(-76, -34, -34, -32, M.PLANK);
  LB(-76, -72, -20, -12, M.GLASS);
  for (let u = -72; u < -34; u++) for (let d = -32; d < 0; d++) { if (u >= -38 && d < -26) continue; if (u >= -38 && d >= -2) continue; L(u, d, AIR); markBg(wx(u), wy(u, d), 7); }
  for (let u = -80; u <= -30; u++) { const sy = -38 - 3 - Math.round(Math.abs(u + 55) * 0.06); for (let d = sy; d < -38; d++) L(u, d, M.SNOW, d === sy ? 14 : 50); }
  // bow rail and stern bulwark
  LB(80, 84, -8, 0, M.PLANK); LB(-80, -76, -10, 0, M.PLANK);
  // masts, yards, torn sails, rigging
  LB(12, 18, -96, 0, M.LOG); LB(58, 63, -74, 0, M.LOG);
  LB(-16, 46, -86, -82, M.LOG); LB(-10, 40, -62, -58, M.LOG); LB(42, 80, -72, -69, M.LOG);
  LB(-14, 44, -82, -77, M.CANVAS);                                      // furled upper sail
  for (let u = -8; u < 38; u++) { const hh = 14 + Math.round(12 * noise1(u * 0.35 + 3)); if (noise1(u * 0.9) > 0.78) continue; LB(u, u + 1, -58, -58 + hh, M.CANVAS); }   // torn mainsail
  LB(44, 78, -69, -64, M.CANVAS);
  line(wx(15), wy(15, -95), wx(-76), wy(-76, -8), M.PLANK, 2);
  line(wx(15), wy(15, -95), wx(83), wy(83, -8), M.PLANK, 2);
  line(wx(60), wy(60, -73), wx(83), wy(83, -8), M.PLANK, 2);
  line(wx(83), wy(83, -6), wx(104), wy(104, -22), M.LOG, 3);                // bowsprit
  // upturned boat on deck
  for (let u = 24; u < 54; u++) { const t = (u - 39) / 15, hh = Math.round(11 * Math.sqrt(Math.max(0, 1 - t * t))); for (let d = -hh; d < -hh + 3; d++) L(u, d, M.PLANK); }
  // windlass at the bow
  LB(70, 78, -8, 0, M.METAL);
  // hatch coamings
  LB(-30, -28, -4, 0, M.PLANK); LB(4, 6, -4, 0, M.PLANK);
  // fixtures: stove + bunk + captain's chest in the cabin, chests below deck
  const fixOnFloor = (kind: FixtureKind, u: number, dFloor: number, tw: number, th: number, extra?: Partial<Fixture>) => {
    let minF = 1e9; for (let k = 0; k < tw * 4; k++) minF = Math.min(minF, wy(u + k, dFloor));
    const bottom = Math.floor(minF / 4) * 4, tx = Math.floor(wx(u) / 4), ty = bottom / 4 - th;
    for (let k = 0; k < tw * 4; k++) { const x = tx * 4 + k; for (let y = bottom; y <= wy(x - cx, dFloor); y++) put(x, y, M.PLANK); box(x, ty * 4, x + 1, bottom, AIR); }
    return { f: kind === 'chest' ? null : addFixture(kind, tx, ty, tw, th, extra), tx, ty };
  };
  const chestOn = (site: SiteKey, u: number, dFloor: number, items: Slot[], data?: Record<string, unknown>) => {
    let minF = 1e9; for (let k = 0; k < 8; k++) minF = Math.min(minF, wy(u + k, dFloor));
    const bottom = Math.floor(minF / 4) * 4, tx = Math.floor(wx(u) / 4), ty = bottom / 4 - 2;
    for (let k = 0; k < 8; k++) { const x = tx * 4 + k; for (let y = bottom; y <= wy(x - cx, dFloor); y++) put(x, y, M.PLANK); box(x, ty * 4, x + 1, bottom, AIR); }
    chest(site, tx, ty, items, 2, 2, data);
    return { x: tx * 4 + 4, y: bottom - 4 };
  };
  const st = fixOnFloor('stove', -70, 0, 2, 2, { fuel: 0, lit: false });
  st.f!.data = { smokeX: wx(-66), smokeY: wy(-66, -44) };
  { const px = wx(-66); line(px, wy(-66, -34), px, wy(-66, -52), M.METAL, 2); }
  fixOnFloor('bed', -60, 0, 4, 1);
  const cabinChest = chestOn('ship', -45, 0, [slot('barometer', 1), slot('flare', 2), slot('can', 2), slot('flint', 1), slot('note_n12', 1), slot('note_n13', 1)], { look: 'captain' });
  worldInfo.spots.shipCabin = { x: wx(-56), y: wy(-56, 0) };
  const hold = chestOn('ship', 62, 56, [slot('radio_triode', 1), slot('saw', 1), slot('scrap', 5), slot('rope', 3), slot('tin', 3), slot('flint', 1), slot('harpoon', 1)], { look: 'tool' });
  worldInfo.radioParts.triode = { x: hold.x, y: hold.y, site: 'ship' };
  chestOn('ship', -36, 28, [slot('canvas', 3), slot('rope', 2), slot('biscuit', 3), slot('fat', 2), slot('note_n11', 1), slot('log', 2)], { look: 'crew' });
  floorNote('n14', 'ship', wx(-18), wy(-18, 0));
  void cabinChest;
  // snow on the deck, drifts against the hull ends so the stern deck is reachable from the ice, icicles on the yards
  for (let u = -76; u <= 82; u++) { if (deckHole(u)) continue; if (u > -72 && u < -34) continue; const hh = 2 + ((u * 7) & 1) + (noise1(u * 0.2) > 0.6 ? 2 : 0); for (let k = 1; k <= hh; k++) if (mat[wy(u, -k) * W + wx(u)] === AIR) L(u, -k, M.SNOW, k > hh - 1 ? 16 : 60); }
  snowBank(cx - 128, cx - 78, cx - 84, 20, 284, 130);
  snowBank(cx + 70, cx + 124, cx + 80, 24, 284, 130);
  for (let k = 0; k < 18; k++) { const u = randInt(-14, 44), d = randInt(-61, -57) + 14; if (mat[wy(u, d) * W + wx(u)] === AIR && mat[wy(u, d - 1) * W + wx(u)] !== AIR) { const len = randInt(3, 8); for (let j = 0; j < len && mat[wy(u, d + j) * W + wx(u)] === AIR; j++) L(u, d + j, M.ICE); } }
  worldInfo.spots.ship = { x: cx, y: yD - 8 };
  addSite('ship', cx + 4, yD - 30, 190, 150);
  void T;
}

// ---------------------------------------------------------------------------------------------------------------------
// signal fire pyre on the cape summit
function stampSignalFire(T: Terrain) {
  const x = LOC.summit.x, gy = Math.floor(T.surf[x] / 4) * 4;
  box(x - 14, gy, x + 14, gy + 4, M.STONE);
  addFixture('signal_fire', Math.floor((x - 8) / 4), gy / 4 - 4, 4, 4, { fuel: 0, lit: false });
  worldInfo.spots.signalFire = { x, y: gy };
}

function stampOpenSea(T: Terrain) {
  addSite('openSea', 2000, 330, 100, 90);
  void T;
}

// ---------------------------------------------------------------------------------------------------------------------
// ---- lights from fixtures (pooled; call once per frame) ----
const pool: Light[] = [];
export function collectFixtureLights(out: Light[]) {
  let n = 0;
  const take = (x: number, y: number, r: number, g: number, b: number, rad: number) => {
    const l = pool[n] ?? (pool[n] = { x: 0, y: 0, r: 0, g: 0, b: 0, rad: 0 });
    l.x = x; l.y = y; l.r = r; l.g = g; l.b = b; l.rad = rad; n++; out.push(l);
  };
  const t = G.realTime;
  for (const f of G.fixtures) {
    if (!f.lit) continue;
    const fl = 0.93 + 0.07 * Math.sin(t * 13 + f.id * 3.1) * Math.sin(t * 7.3 + f.id);
    const cx = f.tx * 4 + f.tw * 2, cy = f.ty * 4 + f.th * 2;
    if (f.kind === 'campfire' || f.kind === 'signal_fire') take(cx, cy - 4, 1.0 * fl, 0.6 * fl, 0.26 * fl, f.kind === 'signal_fire' ? 16 : 10);
    else if (f.kind === 'stove') take(cx, cy, 1.0 * fl, 0.55 * fl, 0.22 * fl, 12);
    else if (f.kind === 'brazier') take(cx, cy - 2, 1.0 * fl, 0.58 * fl, 0.24 * fl, 11);
    else if (f.kind === 'fat_lamp') take(cx, cy, 1.0 * fl, 0.66 * fl, 0.3 * fl, 7);
    else if (f.kind === 'torch') take(cx, cy - 4, 1.0 * fl, 0.66 * fl, 0.32 * fl, 7);
    else if (f.kind === 'lantern') take(cx, cy, 1.0, 0.82, 0.5, 10);
  }
  return n;
}
void tr; void isSoft; void W;
