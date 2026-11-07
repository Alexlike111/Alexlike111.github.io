// Locations of the High-Arctic coast (DESIGN §1). Site registry, world info for other systems, drawing kit and the stampers of every
// built / sculpted place: the abandoned coal mine «Шахта №3», the old cairn, the station «Мыс Безмолвия» with its generator shed,
// the beach (driftwood, whale skeleton, shore ice, tide crack), the iceberg with its ice cave and the ghost ship «Заря».
// worldgen.ts shapes the terrain first (profile, snowpack, rock, sea, ice field) and then calls stampLocations().
// Fixtures are records in G.fixtures; solid ones also write MAT.FIXTURE + F_FIXTURE cells (SPEC §4).
import { G, Fixture, FixtureKind, Slot, Light, newId } from './state';
import { W, H, TW, mat, aux, flags, bg, F_FIXTURE, F_PLACED, rand, randInt, noise1, fbm1 } from '../engine/grid';
import { MAT, ANCHOR } from '../content/materials';
import { strings, tr } from '../content/i18n';

// ---------------------------------------------------------------------------------------------------------------------
// layout constants (cells). worldgen shapes the terrain around these.
export const SEA = 300;                                  // water surface row ("sea level")
export const LOC = {
  sea: SEA,
  cape: { x0: 60, x1: 360 },
  mine: {
    portalX: 302, floorA: 264, hA: 28,                   // adit: floor row 264, 28 rows of air above it
    collapse: [208, 238] as [number, number],            // rubble section on the decline
    rampTop: 262, rampBot: 177, floorB: 332,             // the decline: stairs (rise 4 / run 5) west-down from the flat adit to level B (floor row 332)
    hut: [100, 164] as [number, number],                 // miner's hut chamber on level B (frozen roof, one timber set in the middle)
    plug: [220, 228] as [number, number],                // the rock plug in the collapse: only the pick breaks it
    icePlug: [168, 174] as [number, number],             // frozen seep between the stair foot and the hut: ice (pick or chisel)
    bulkhead: 96, pocket: [62, 96] as [number, number],  // sealed methane pocket (west of the bulkhead)
    lake: { x0: 268, x1: 376, ice: 372, shore: 364 },    // sealed cavern deeper down: reached by digging
  },
  summit: { x: 474 },                                    // signal-fire hill: the crest east of the cairn (the cape hill itself is cut off by the quarry trench)
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
  coal: { x: number; y: number }[];     // sacks of coal lying about (mine, apron); the shed chest and the carts hold more
  carts: number;                        // mine carts (fixtures with data.loaded = 'coal')
  pick: { x: number; y: number };       // the pick lying by the mine portal
  roof: { x0: number; x1: number; y0: number; y1: number };           // the frozen roof slab of the hut
  timberSets: { x: number; y: number; cells: number[]; west: number[]; east: number[] }[];   // LOG props that hold it (cell indices; east = the one in the way)
}
const P0 = () => ({ x: 0, y: 0 });
export const worldInfo: WorldInfoOut = {
  seaLevel: SEA, sealHoles: [], driftwood: [],
  iceField: { floes: [], cracks: [], hiddenCracks: [], leads: [], ridges: [], fastX0: 1100, fastX1: 1450, packX0: 1450, packX1: 1950, seaEdgeX: 1950 },
  notes: [], chests: [],
  radioParts: { triode: { x: 0, y: 0, site: 'ship' }, coil: { x: 0, y: 0, site: 'minehut' }, battery: { x: 0, y: 0, site: 'shed' } },
  spots: { spawn: P0(), kennel: P0(), barometer: P0(), mast: P0(), signalFire: P0(), cairn: P0(), portal: P0(), methane: P0(), whale: P0(), iceberg: P0(), icecave: P0(), ship: P0(), shipCabin: P0(), tideCrack: P0(), lakeThin: P0() },
  lichen: [], coal: [], carts: 0, pick: { x: 0, y: 0 }, roof: { x0: 0, x1: 0, y0: 0, y1: 0 }, timberSets: [],
};

export function resetLocations() {
  sites.length = 0; warmZones.length = 0; G.fixtures.length = 0;
  const w = worldInfo;
  w.sealHoles.length = 0; w.driftwood.length = 0; w.notes.length = 0; w.chests.length = 0; w.lichen.length = 0; w.coal.length = 0; w.carts = 0; w.timberSets.length = 0;
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
  boxT(L, top, L, F - 7, M.STONE); if (!openEast) boxT(R, top, R, F - 7, M.STONE); else boxT(R, top, R, top, M.STONE);   // lintel walls above the doors (natural STONE = structural anchor)
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
function timberFrame(x: number, floor: number, h: number, floorOf?: (x: number) => number) {   // PLANK cap beam under the roof (following a sloping roof) + wooden posts as wall decoration
  for (let xx = x - 1; xx < x + 7; xx++) { const f = floorOf ? floorOf(xx) : floor; box(xx, f - h, xx + 1, f - h + 4, M.PLANK); }
  bgBox(x, floor - h + 4, x + 4, floor, 7);
}
/** Permafrost character of the adit and the decline: ice crust and icicles on the roof, frosted back wall, ice in the cracks of the floor edge. */
function frostAdit() {
  const roofRow = (x: number, floor: number) => floor - HA - 1;
  for (let x = MI.rampTop; x < MI.portalX - 14; x++) {          // stops short of the portal header (an ice crust next to it would cut its support)
    const ry = roofRow(x, FA);
    if (mat[(ry + 1) * W + x] !== AIR) continue;
    const n = noise1(x * 0.17 + 5);
    const rm = mat[ry * W + x];
    let rock = true; for (let k = 0; k <= 8; k++) { const mm = mat[(ry - k) * W + x]; if (mm !== M.STONE && mm !== M.DIRT && mm !== M.HARDROCK) { rock = false; break; } }   // only under real rock (a crust under snow / the portal header would fall)
    if (!rock) continue;
    if (n > 0.38) { put(x, ry, M.ICE); if (n > 0.6 && mat[(ry - 1) * W + x] === rm) put(x, ry - 1, M.ICE); }
    if (rand() < 0.1) { const len = randInt(2, 6); for (let k = 1; k <= len && mat[(ry + k) * W + x] === AIR; k++) put(x, ry + k, M.ICE); }
  }
  for (let x = MI.rampTop; x < MI.portalX + 40; x += 4) if (noise1(x * 0.09 + 11) > 0.5) { const ty = (FA - HA) >> 2; for (let k = 0; k < 5; k++) if (bg[(ty + k) * TW + (x >> 2)] === 2) bg[(ty + k) * TW + (x >> 2)] = 3; }
  for (let x = MI.rampBot; x < MI.rampTop; x += 4) { const f = FA + 4 * Math.floor((MI.rampTop - x) / 5); if (noise1(x * 0.11 + 2) > 0.55) for (let k = 1; k < 6; k++) { const ty = ((f - HA) >> 2) + k; if (bg[ty * TW + (x >> 2)] === 2) bg[ty * TW + (x >> 2)] = 3; } }
}
function stampMine(T: Terrain) {
  const [c0, c1] = MI.collapse;
  // --- rock strata: the coal seams only survive as dark streaks on the back wall (bg 8, painted below). There is no ore to dig: the coal lies in
  // sacks and carts. A short soapstone outcrop sits by the decline; the lamp stones lie in the hut. ---
  const seams: { y: (x: number) => number; th: number; x0: number; x1: number }[] = [];
  for (let k = 0; k < 7; k++) {
    const y0 = 246 + k * 24 + randInt(-4, 4), sl = (rand() - 0.5) * 0.18, th = randInt(4, 8), x0 = 84 + randInt(0, 40), x1 = 300 + randInt(0, 70), ph = rand() * 6;
    seams.push({ y: (x) => y0 + (x - 200) * sl + Math.sin(x / 31 + ph) * 3, th, x0, x1 });
  }
  const sv = (x: number) => 340 - (x - 180) * 0.9;
  for (let x = 246; x < 262; x++) for (let y = Math.round(sv(x) - 2); y < sv(x) + 2 + noise1(x * 0.2); y++) { const i = y * W + x; if (mat[i] === M.STONE) { mat[i] = M.SOAPSTONE; aux[i] = 0; } }

  // --- tunnels: flat adit + open trench (A), the decline with wooden-topped steps (D), level B with the hut chamber ---
  const floorD = (x: number) => FA + 4 * Math.floor((MI.rampTop - x) / 5);
  drift(MI.rampTop, MI.portalX + 46, () => FA, HA, 2);                                             // A: the adit, ending in an open trench where the hill falls away
  drift(MI.rampBot, MI.rampTop, floorD, HA, 2);                                                    // D: the decline
  drift(MI.pocket[1], MI.rampBot + 1, () => FB, HA, 2);                                             // B
  box(MI.hut[0], FB - 34, MI.hut[1], FB - HA, AIR);                                                // taller hut chamber
  for (let x = MI.rampBot; x < MI.rampTop; x++) { put(x, floorD(x), M.PLANK); put(x, floorD(x) + 1, M.PLANK); }   // plank treads
  // the coal seams show on the back wall of the tunnels
  for (const sm of seams) for (let x = Math.max(sm.x0, MI.pocket[0]); x < Math.min(sm.x1, MI.portalX); x += 4) {
    const yc = sm.y(x);
    for (let y = Math.floor((yc - sm.th) / 4) * 4; y < yc + sm.th; y += 4) { const tx = x >> 2, ty = y >> 2; if (mat[(ty * 4 + 2) * W + tx * 4 + 2] === AIR && (bg[ty * TW + tx] === 2 || bg[ty * TW + tx] === 1)) bg[ty * TW + tx] = 8; }
  }
  // collapse on the decline: rubble above the steps, gravel mostly so a shovel gets through ...
  for (let x = c0; x < c1; x++) {
    const prof = Math.sin((x - c0) / (c1 - c0) * Math.PI), f = floorD(x);
    for (let y = f - HA; y < f; y++) {
      const fromFloor = f - y, i = y * W + x;
      if (fromFloor > 10 + 15 * prof && fromFloor < HA - 6) continue;       // open gap high up under the ceiling
      const r = rand();
      if (r < 0.1 && fromFloor > 4) put(x, y, rand() < 0.5 ? M.LOG : M.PLANK);       // broken timber (axe)
      else { mat[i] = M.GRAVEL; aux[i] = 0; flags[i] = 0; }
    }
  }
  // the roof above the cave-in is torn open
  { const xm = (c0 + c1) >> 1, ym = floorD(xm) - HA - 3; for (let y = ym - 14; y < ym + 6; y++) for (let x = c0 + 3; x < c1 - 3; x++) { const dx = (x - xm) / 11, dy = (y - ym) / 9; if (dx * dx + dy * dy < 1) put(x, y, AIR); } bgBox(c0, ym - 14, c1, ym + 6, 2); }
  // ... and in the middle of it a ROCK PLUG: a fallen slab two tiles wide that only the pick breaks (gravel and timber around it are shovel and axe work)
  for (let x = MI.plug[0]; x < MI.plug[1]; x++) { const f = floorD(x); for (let y = f - HA; y < f; y++) { const i = y * W + x; mat[i] = M.STONE; aux[i] = 0; flags[i] = 0; } }
  // timber frames (cap beams + posts as wall decoration)
  for (const fx of [284]) timberFrame(fx, FA, HA);   // permafrost adit: a single portal frame, the rest is bare frost-crusted rock
  for (const fx of [254, 246, 196, 186]) for (let tx = fx >> 2; tx <= (fx >> 2); tx++) { const f = floorD(tx * 4); bgBox(tx * 4, f - HA, tx * 4 + 4, f, 7); }      // props on the stairs are background strips only (no beams: the head room is needed)
  // portal: heavy header and bg posts
  box(MI.portalX - 6, FA - HA - 2, MI.portalX + 14, FA - HA + 6, M.LOG); bgBox(MI.portalX + 10, FA - HA, MI.portalX + 14, FA, 7); bgBox(MI.portalX - 4, FA - HA, MI.portalX, FA, 7);
  // --- rails with sleepers on the flat adit, mine carts (containers of coal), the miner's tools at the portal ---
  const rails = (x0: number, x1: number, f: number) => {
    // straight rails (the way on foot needs them level); the sleepers are heaved: some tilted / missing, and frost sits on the metal
    for (let x = x0; x < x1; x++) {
      if (mat[(f - 1) * W + x] !== AIR && mat[(f - 1) * W + x] !== M.METAL) continue;
      put(x, f - 1, M.METAL);
      if (((x >> 2) & 1) === 0 && noise1(x * 0.4) > 0.12) { put(x, f, M.PLANK); put(x, f + 1, M.PLANK); }
    }
  };
  rails(MI.rampTop + 12, MI.portalX + 64, FA);
  frostAdit();
  for (const tx of [70, 74, 84]) addFixture('cart', tx, FA / 4 - 2, 4, 2, { data: { loaded: 'coal' } });
  worldInfo.carts += 3;
  worldInfo.spots.portal = { x: MI.portalX + 4, y: FA - 10 };
  // the miner left the pick and two torches by the portal timber: the rock plug is the only thing in the mine that needs it
  floorItem('pick', 1, MI.portalX - 14, FA);
  floorItem('torch', 2, MI.portalX - 20, FA);
  worldInfo.pick = { x: MI.portalX - 14, y: FA - 3 };
  // coal sacks lie along the adit and on the stair landings (one pickup each: no seams to grind)
  for (const sx of [276, 290, 308]) coalSack(sx, FA);
  // --- hut chamber: timber lined, floor planks, furniture, chest, and a frozen roof carried by ONE timber set (see timberSet) ---
  const [h0, h1] = MI.hut;
  box(h0, FB, h1, FB + 4, M.PLANK);
  bgBox(h0, FB - 34, h1, FB, 5);
  for (let x = h0 + 6; x < h1; x += 12) bgBox(x, FB - 30, x + 4, FB, 7);                              // support posts (decorative, behind the player)
  frozenRoof(h0, h1, FB - 34);
  timberSet((h0 + h1) >> 1, FB, FB - 34);
  addFixture('bed', 25, FB / 4 - 1, 4, 1);          // west of both props
  chest('minehut', 36, FB / 4 - 2, [slot('radio_coil', 1), slot('soapstone', 3), slot('torch', 3), slot('tin', 2), slot('matches', 6), slot('note_n3', 1)], 2, 2, { look: 'miner' });
  addFixture('table', 38, FB / 4 - 2, 3, 2);
  worldInfo.radioParts.coil = { x: 36 * 4 + 4, y: FB - 4, site: 'minehut' };
  floorNote('n4', 'minehut', 156, FB);
  floorNote('n6', 'minehut', 160, FB);
  coalSack(h0 + 6, FB); coalSack(h0 + 12, FB); coalSack(h0 + 16, FB);      // behind both props
  addSite('minehut', (h0 + h1) / 2, FB - 14, h1 - h0 + 20, 44);
  // a frozen seep blocks the corridor between the stair foot and the hut: ice, pick or chisel (the only other obstacle in the mine)
  for (let x = MI.icePlug[0]; x < MI.icePlug[1]; x++) for (let y = FB - HA; y < FB; y++) put(x, y, M.ICE, 0);
  // --- bulkhead and sealed methane pocket in the west dead end ---
  const [p0, p1] = MI.pocket;
  box(p0, FB - HA, p1, FB, AIR);
  box(p0, FB - HA, p1, FB, M.METHANE, 0);
  bgBox(p0, FB - HA, p1, FB, 2);
  box(MI.bulkhead, FB - HA, MI.bulkhead + 4, FB, M.PLANK);
  box(MI.bulkhead, FB - 20, MI.bulkhead + 4, FB - 18, M.METAL); box(MI.bulkhead, FB - 8, MI.bulkhead + 4, FB - 6, M.METAL);
  worldInfo.spots.methane = { x: Math.round((p0 + p1) / 2), y: FB - 10 };
  floorNote('n5', 'minehut', MI.bulkhead + 12, FB);
  floorNote('n2', 'mine', 268, FA);
  // --- the underground ice lake (sealed cavern, reached by digging down) ---
  stampIceLake(T);
  addSite('mine', 190, 300, 300, 140);
}

/** A sack of coal lying on the floor (a drop of 4: one pickup, no digging). */
function coalSack(x: number, floor: number) {
  G.drops.push({ id: newId(), item: 'coal', n: 4, x, y: floor - 3, vx: 0, vy: 0, age: 0 });
  worldInfo.coal.push({ x, y: floor - 3 });
}
/** A loose item lying on the floor. */
function floorItem(item: string, n: number, x: number, floor: number) {
  G.drops.push({ id: newId(), item, n, x, y: floor - 3, vx: 0, vy: 0, age: 0 });
}
/** The frozen roof of the hut: a 4-cell slab of placed frozen earth (limit: 20 cells sideways) lies under a load of gravel. Walls carry the ends,
 *  the timber set carries the middle. Placed cells (F_PLACED) use the plain span, natural cells would carry 2.5 times more. */
function frozenRoof(x0: number, x1: number, topRow: number) {
  const s0 = topRow - 4, s1 = topRow;                           // slab rows [s0, s1) directly above the chamber air
  for (let y = s0 - 8; y < s0; y++) for (let x = x0; x < x1; x++) { const i = y * W + x; mat[i] = M.GRAVEL; aux[i] = 0; flags[i] = 0; }
  for (let y = s0; y < s1; y++) for (let x = x0; x < x1; x++) { const i = y * W + x; mat[i] = M.DIRT; aux[i] = 0; flags[i] = F_PLACED; }
  bgBox(x0, s0 - 8, x1, s1, 2);
  worldInfo.roof = { x0, x1, y0: s0, y1: s1 };
}
/** A timber set: two inclined LOG props (their feet far apart, their heads close under the slab). Each prop reaches from the floor to the slab, so the
 *  way into the hut leads THROUGH the east one: chop a doorway into it with the axe (the stump above it still hangs from the slab and the west prop
 *  still carries the middle: the roof holds). Chop the second prop as well (free firewood!) and the middle of the ceiling comes down. */
function timberSet(cx: number, floor: number, topRow: number) {
  const foot = 8, head = 1, th = 3, h = floor - topRow;
  const legs: number[][] = [[], []];
  for (const side of [-1, 1]) for (let k = 0; k < h; k++) {
    const xc = Math.round(cx + side * (foot - (foot - head) * k / (h - 1))), y = floor - 1 - k;
    for (let t = 0; t < th; t++) {
      const x = side < 0 ? xc - t : xc + t, i = y * W + x;
      mat[i] = M.LOG; aux[i] = 0; flags[i] = F_PLACED; legs[side < 0 ? 0 : 1].push(i);
    }
  }
  worldInfo.timberSets.push({ x: cx, y: floor, cells: [...legs[0], ...legs[1]], west: legs[0], east: legs[1] });
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
  // frost lining and icicles under the cavern roof
  for (let x = L.x0 + 36; x < L.x1; x++) {
    let y = 330; while (y < iceY && mat[y * W + x] !== AIR) y++;               // first air row under the rock ceiling
    for (let k = 1; k <= 2 + ((rand() * 3) | 0); k++) { if (mat[(y - k) * W + x] === M.STONE) put(x, y - k, M.ICE); }
    if (rand() < 0.14 && y < iceY - 12) { const len = randInt(3, 13); for (let k = 0; k < len && mat[(y + k) * W + x] === AIR; k++) put(x, y + k, M.ICE); }
  }
  // far (east) shore niche with a cache
  const sx = L.x1 - 14;
  box(sx - 2, L.shore - 12, sx + 12, L.shore, AIR);
  chest('icelake', Math.floor(sx / 4), L.shore / 4 - 2, [slot('fat', 3), slot('matches', 4), slot('rope', 2)], 2, 2, { look: 'old' });
  worldInfo.spots.lakeThin = { x: 340, y: iceY };
  addSite('icelake', mid, 372, L.x1 - L.x0, 70);
}

function stampApron(T: Terrain) {
  // spoil heaps in front of the portal: gravel (the coal went into sacks), rails end at a tipple
  const x0 = MI.portalX + 36, x1 = MI.portalX + 62;
  for (let x = x0; x < x1; x++) {
    const t = 1 - Math.abs((x - (x0 + x1) / 2) / ((x1 - x0) / 2)), hh = Math.round(10 * t * (0.7 + 0.5 * noise1(x * 0.2)));
    for (let k = 1; k <= hh; k++) { const y = FA - 1 - k; if (mat[y * W + x] === AIR) put(x, y, M.GRAVEL); }
    // keep the random stream of everything generated after the mine (cairn, station, beach...) exactly as it was when this heap was half coal
    const old = Math.round(14 * t * (0.7 + 0.5 * noise1(x * 0.2)));
    for (let k = 1; k <= old; k++) { if (mat[(FA - 1 - k) * W + x] === AIR || k <= hh) rand(); }
  }
  for (const sx of [x0 + 4, x0 + 9]) coalSack(sx, FA - 2);
  snowBank(x1 - 6, x1 + 18, x1 + 2, 6, 200, 130);
  void T;
}

// ---------------------------------------------------------------------------------------------------------------------
// CAIRN with the tin box
function stampCairn(T: Terrain) {
  const cx = LOC.cairn.x, gy = T.surf[cx];
  const gyA = Math.floor(gy / 4) * 4;                    // tile aligned ground line for the niche
  // base pad and a squat heap of rough boulders (wide tiers, ragged edges) with a leaning marker pole: reads as a cairn, not as a conifer
  box(cx - 22, gyA, cx + 26, gyA + 4, M.STONE);
  const tiers = [[34, 5], [28, 5], [22, 4], [15, 4]];
  let yy = gyA;
  for (let r = 0; r < tiers.length; r++) {
    const [w, hgt] = tiers[r], y0 = yy - hgt, off = Math.round(noise1(r * 3.1 + cx) * 4 - 2);
    for (let x = Math.round(cx + off - w / 2); x <= Math.round(cx + off + w / 2); x++) {
      for (let y = y0; y < yy; y++) {
        const e = Math.abs(x - cx - off) / (w / 2);
        if ((e > 0.78 && rand() < 0.55) || (y === y0 && rand() < 0.22) || rand() < 0.05) continue;
        put(x, y, M.STONE);
      }
    }
    yy = y0;
  }
  box(cx - 5, yy - 5, cx + 1, yy, M.STONE);                      // one upright slab on top
  { const ptx = (cx >> 2), pty = (yy - 20) >> 2; bgT(ptx, pty, ptx, (yy - 5) >> 2, 5); }   // marker pole: a wooden strip behind the walker (a solid pole would block the crest)
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
  addFixture('door', L, F - 6, 1, 6, { open: false, data: { side: 'west' } });
  addFixture('door', R, F - 6, 1, 6, { open: false, data: { side: 'east' } });
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
  // the antenna mast lies on the snow bank: a straight pole with three cross arms (anemometer, vane, dipole)
  const py = (x: number) => F * 4 - 4 - Math.round((x - (mx + 10)) * 0.1);
  line(mx + 10, py(mx + 10), mx + 50, py(mx + 50), M.METAL, 3);
  for (let k = 0; k < 3; k++) { const x = mx + 16 + k * 12; box(x, py(x) - 4, x + 2, py(x) + 1, M.METAL); }
  // generator shed with fuel drums and the battery under a drift (the east end is torn open: the drift came in)
  const { L, R } = LOC.shed;
  const { top } = cabin(L, R, F, 8, true);
  draftTile(L + 4, top - 1);
  boxT(R - 1, top - 1, R - 1, top - 1, M.GLASS);
  addFixture('door', L, F - 6, 1, 6, { open: false, data: { side: 'west' } });
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
  // sacks of coal and fuel drums outside (no heap to dig: the sacks lie in a row by the wall)
  for (const k of [0, 1, 2]) coalSack((L - 11 + k * 2) * 4, F * 4);
  addFixture('drum', R + 3, F - 2, 2, 2, { data: { fuel: 'diesel', n: 5 } });
  addFixture('drum', R + 5, F - 2, 2, 2, { data: { fuel: 'diesel', n: 7 } });
  addFixture('drum', R + 7, F - 2, 2, 2, { data: { fuel: 'diesel', n: 0, empty: true } });
  floorNote('s3', 'shed', (L + 6) * 4 + 4, F * 4);
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
  const cx = 952, gy = T.surf[cx];
  const wb = (x: number, y: number, w: number, h: number) => box(x, y, x + w, y + h, M.WHALEBONE, 0, 0, false);
  const spineH = (x: number) => { const t = (x - (cx - 48)) / 96; return t <= 0 || t >= 1 ? 0 : 5 + 40 * Math.pow(Math.sin(Math.PI * t), 0.75); };
  const gAt = (x: number) => T.surf[Math.max(8, Math.min(W - 9, x))];
  for (let x = cx - 72; x < cx + 50; x++) {
    const h = spineH(x), y = gAt(x) - Math.round(h) - 2;
    wb(x, y, 1, 4);
    if (((x - cx) % 6) === 0) wb(x - 2, y - 2, 5, 7);                        // vertebrae
  }
  for (let k = -3; k <= 3; k++) {                                              // ribs hanging from the spine
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
  const sx = cx + 50;
  for (let u = 0; u < 62; u++) {
    const x = sx + u, g = gAt(x), top = g - Math.round(4 + 12 * Math.sin(Math.PI * Math.min(1, u / 56)) ** 0.8);
    wb(x, top, 1, 3);
    if (u % 9 === 0) wb(x, top, 2, g - top);                                   // struts
  }
  line(sx + 4, gAt(sx + 4) - 2, sx + 58, gAt(sx + 58) - 3, M.WHALEBONE, 3);   // lower jaw
  box(sx + 14, gAt(sx + 14) - 14, sx + 20, gAt(sx + 14) - 8, AIR);            // eye socket
  worldInfo.spots.whale = { x: cx, y: gy - 30 };
  floorNote('n7', 'whale', cx - 66, T.surf[cx - 66] - 1);       // by the tail of the skeleton, on open gravel (the arch interior is enclosed by the rising spine)
  addSite('whale', cx - 6, gy - 20, 150, 70);
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
  // small ice rubble heaps (never taller than a step) scattered on the sheet; the real obstacles are the seal holes, the berg and the tide crack
  for (const hx of [1236, 1296, 1412]) {
    const hgt = pileBlocks(hx - 10, hx + 10, 5, 10, M.ICE, 3, 7, 2, 3);
    worldInfo.iceField.ridges.push({ x: hx, w: 21, h: Math.max(...Array.from(hgt)) });
  }
  void T;
}

// ---------------------------------------------------------------------------------------------------------------------
// ICEBERG with an ice cave
function stampIceberg(T: Terrain) {
  const cx = LOC.iceberg.x;
  const peaks: [number, number][] = [[-47, 0], [-40, 10], [-30, 26], [-20, 38], [-12, 46], [-4, 44], [4, 50], [12, 48], [20, 40], [28, 28], [36, 14], [42, 4], [46, 0]];
  const hAt = (u: number) => {
    for (let i = 0; i < peaks.length - 1; i++) if (u >= peaks[i][0] && u <= peaks[i + 1][0]) { const t = (u - peaks[i][0]) / (peaks[i + 1][0] - peaks[i][0]); return peaks[i][1] + (peaks[i + 1][1] - peaks[i][1]) * t; }
    return 0;
  };
  const base = T.iceTop[cx];
  const iceH = new Int16Array(110);
  for (let u = -47; u <= 46; u++) {
    const x = cx + u, h = Math.round(hAt(u) + (fbm1(x / 5, 2) - 0.5) * 5);
    iceH[u + 50] = h;
    for (let y = base - h; y < base; y++) put(x, y, M.ICE, 0);
    // underwater part: tapers down
    const dep = Math.round(58 * Math.pow(Math.max(0, 1 - ((u + 1) / 47) * ((u + 1) / 47)), 0.55));
    for (let y = base; y < Math.min(T.seabed[x] - 1, base + dep + 14); y++) put(x, y, M.ICE, 0);
    // snow on the gentle slopes
    for (let y = base - h; y < base - h + 3; y++) {
      const sl = Math.abs(hAt(u + 3) - hAt(u - 3)) / 6;
      if (sl < 1.6 && mat[(y + 0) * W + x] === M.ICE && mat[(y - 1) * W + x] === AIR) { put(x, y - 1, M.SNOW, 20 + ((rand() * 40) | 0)); if (sl < 0.8) put(x, y - 2, M.SNOW, 12); break; }
    }
  }
  // the ice cave: a domed chamber sealed inside the berg (a translucent ice wall 8 cells thick faces east: chisel your way in, it is a ready-made shelter).
  // A through-tunnel is impossible here: a roof wider than ~40 cells cannot be carried, and the berg stands on the only route across the fast ice.
  const floorY = 288, entU = 8;
  for (let u = -12; u <= 6; u++) {                     // chamber (dome)
    const x = cx + u, t = (u + 3) / 10, top = Math.max(Math.round(floorY - 24 - 26 * Math.max(0, 1 - t * t)), base - iceH[u + 50] + 8);
    for (let y = top; y < floorY; y++) { put(x, y, AIR); markBg(x, y, 3); }
    for (let y = floorY; y < floorY + 3; y++) put(x, y, M.ICE);
  }
  // icicles hang from the cave roof, a few ice columns stand on the floor of the chamber
  for (let u = -12; u <= entU; u++) {
    const x = cx + u; let y = floorY - 1; while (y > 200 && mat[y * W + x] === AIR) y--;       // first ice cell above the cave air = the roof
    if (y > floorY - 40 && y < floorY - 8 && rand() < 0.2) { const len = randInt(3, 10); for (let k = 1; k <= len && mat[(y + k) * W + x] === AIR; k++) put(x, y + k, M.ICE); }
    if (rand() < 0.05 && u < 4) { const hh = randInt(4, 10); for (let k = 1; k <= hh; k++) if (mat[(floorY - k) * W + x] === AIR) put(x, floorY - k, M.ICE); }
  }
  chest('icecave', Math.floor((cx - 8) / 4), floorY / 4 - 2, [slot('fat', 3), slot('sinew', 2), slot('tin', 2), slot('rope', 2), slot('matches', 3), slot('note_n9', 1)], 2, 2, { look: 'old' });
  floorNote('n10', 'icecave', cx - 2, floorY);
  worldInfo.spots.iceberg = { x: cx, y: base - 40 };
  worldInfo.spots.icecave = { x: cx - 3, y: floorY - 8 };
  addSite('iceberg', cx - 1, base - 25, 94, 110);
  addSite('icecave', cx - 3, floorY - 14, 30, 44);
  snowBank(cx + 46, cx + 84, cx + 54, 7, 200, 190);
  worldInfo.iceField.ridges.push({ x: cx, w: 94, h: 50 });
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
    if (d < 0 && u > -76 && u < 82) continue;                          // above the deck only the ends have a rail (the sides are cut away)
    L(u, d, d > 14 && !inHull(u, d, 2) ? M.METAL : M.PLANK);
  }
  // hold interior: clear it first (cut out of the ice), then structure
  for (let u = -80; u <= 86; u++) for (let d = 0; d <= 66; d++) if (inHull(u, d, 4)) { L(u, d, AIR); markBg(wx(u), wy(u, d), 7); }
  // ballast
  for (let u = -80; u <= 86; u++) { const lim = Math.min(56, dBot(u) - 4); for (let d = Math.floor(lim); d <= dBot(u) - 4; d++) L(u, d, d > lim + 2 ? M.STONE : M.PLANK); }
  // decks: planks with an iron beam row underneath (it carries the span for the structure solver).
  // The stern deck is the way on board; a hatch right behind the stern rail takes a companionway down (steps descend east) into the captain's cabin
  // below deck. A solid full-height bulkhead closes the cabin in the east and carries the deck above it. Everything east of it is sealed (dig in).
  const FLOOR = 36;                                                      // crew-deck floor (row d of its top): 32 cells of headroom under the deck
  const deckHole = (u: number) => u >= -72 && u < -36;
  for (let u = -78; u <= 82; u++) { if (deckHole(u)) continue; LB(u, u + 1, 0, 3, M.PLANK); L(u, 3, M.METAL); }
  for (let u = -78; u <= 80; u++) { LB(u, u + 1, FLOOR, FLOOR + 3, M.LOG); L(u, FLOOR + 3, M.METAL); }
  for (let k = 0; k < 9; k++) LB(-72 + 4 * k, -68 + 4 * k, 4 * (k + 1), FLOOR + 4, M.PLANK);          // steps: tread k tops out 4(k+1) below the deck
  LB(14, 18, 3, 58, M.PLANK); LB(14, 18, 12, 14, M.METAL); LB(14, 18, 30, 32, M.METAL);                   // the bulkhead
  // the hold below the cabin floor: a coal bunker (heap) and canvas bales, reachable only by digging
  for (let u = -70; u < -20; u++) { const t = 1 - Math.abs((u + 45) / 25), hh = Math.round(15 * Math.max(0, t) * (0.8 + 0.4 * noise1(u * 0.3))); for (let k = 1; k <= hh; k++) if (mat[wy(u, 56 - k) * W + wx(u)] === AIR) L(u, 56 - k, M.COAL); }
  LB(20, 28, 48, 56, M.CANVAS); LB(20, 28, 40, 48, M.CANVAS);
  for (let c = 0; c < 4; c++) { const u0 = 44 + (c % 2) * 9, lev = c < 2 ? 0 : 1; LB(u0, u0 + 8, 56 - 8 * (lev + 1), 56 - 8 * lev, M.PLANK); }
  // low bulwarks at both ends (a step, not a wall), a hatch coaming
  LB(80, 84, -4, 0, M.PLANK); LB(-80, -76, -4, 0, M.PLANK);
  // masts, yards, torn sails, rigging (the masts stand east of the hatch: the walkable deck ends at the mainmast)
  LB(12, 18, -96, 0, M.LOG); LB(58, 63, -74, 0, M.LOG);
  LB(-16, 46, -86, -82, M.LOG); LB(-10, 40, -62, -58, M.LOG); LB(42, 80, -72, -69, M.LOG);
  LB(-14, 44, -82, -77, M.CANVAS);                                      // furled upper sail
  for (let u = -8; u < 38; u++) { const hh = 7 + Math.round(11 * noise1(u * 0.35 + 3)); if (noise1(u * 0.9) > 0.6) continue; LB(u, u + 1, -58, -58 + hh, M.CANVAS); }   // frayed strips, not a solid curtain   // torn mainsail
  LB(44, 78, -69, -64, M.CANVAS);
  line(wx(15), wy(15, -95), wx(-30), wy(-30, -34), M.PLANK, 2);                // a backstay that stays well above head height over the stern deck
  LB(-32, -28, -34, -30, M.PLANK);
  line(wx(15), wy(15, -95), wx(83), wy(83, -4), M.PLANK, 2);
  line(wx(60), wy(60, -73), wx(83), wy(83, -4), M.PLANK, 2);
  line(wx(83), wy(83, -4), wx(104), wy(104, -22), M.LOG, 3);                // bowsprit
  // upturned boat on deck (low) and a windlass at the bow
  // deckhouse: a wooden cabin on the main deck (cut open to show its panelled inside), a window in the stern wall, a rusted stove pipe, drifted snow on the roof
  LB(21, 24, -20, 0, M.PLANK); LB(51, 54, -20, 0, M.PLANK); LB(20, 55, -23, -20, M.PLANK);
  for (let u = 24; u < 51; u++) for (let d = -20; d < 0; d++) markBg(wx(u), wy(u, d), 5);
  LB(21, 24, -15, -8, M.GLASS);
  LB(43, 46, -38, -23, M.METAL); LB(42, 47, -40, -38, M.METAL);
  for (let u = 20; u < 55; u++) { const hh = 2 + ((u * 5) % 3); for (let k = 1; k <= hh; k++) if (mat[wy(u, -23 - k) * W + wx(u)] === AIR) L(u, -23 - k, M.SNOW, k === hh ? 14 : 70); }
  LB(70, 78, -4, 0, M.METAL);
  // fixtures below deck: stove, bunk, the captain's chest and the cargo chest (all on the crew-deck floor)
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
  const st = fixOnFloor('stove', -16, FLOOR, 2, 2, { fuel: 0, lit: false });
  const chimU = -13;                                                      // chimney: a dark strip up to the deck, a short metal stub on the deck
  for (let d = 4; d < FLOOR - 8; d += 4) markBg(wx(chimU), wy(chimU, d), 7);
  LB(chimU, chimU + 2, -4, 4, M.METAL);
  st.f!.data = { smokeX: wx(chimU), smokeY: wy(chimU, -8) };
  fixOnFloor('bed', -34, FLOOR, 4, 1);
  chestOn('ship', -6, FLOOR, [slot('barometer', 1), slot('flare', 2), slot('can', 2), slot('flint', 1), slot('note_n12', 1), slot('note_n13', 1)], { look: 'captain' });
  worldInfo.spots.shipCabin = { x: wx(-26), y: wy(-26, FLOOR) - 4 };
  const hold = chestOn('ship', 4, FLOOR, [slot('radio_triode', 1), slot('saw', 1), slot('scrap', 5), slot('rope', 3), slot('tin', 3), slot('flint', 1), slot('harpoon', 1), slot('canvas', 3), slot('biscuit', 3), slot('fat', 2), slot('note_n11', 1)], { look: 'tool' });
  worldInfo.radioParts.triode = { x: hold.x, y: hold.y, site: 'ship' };
  floorNote('n14', 'ship', wx(-76), wy(-76, 0) - 2);
  // ice collar: the pack ice is heaved against both ends of the hull (pressure ridges with a snow crest), so the wreck is frozen in, not floating on it
  for (const [xa, xb, hmax] of [[cx - 106, cx - 74, 15], [cx + 84, cx + 116, 11]] as const) {
    for (let x = xa; x <= xb; x++) {
      const t = xa < cx ? (x - xa) / (xb - xa) : 1 - (x - xa) / (xb - xa), h = Math.round(hmax * Math.pow(Math.max(0, t), 0.8) * (0.85 + 0.3 * noise1(x * 0.3)));
      const top = T.iceTop[x] || SEA - 3;
      for (let k = 1; k <= h; k++) { const y = top - k; if (mat[y * W + x] === AIR) put(x, y, k > h - 2 ? M.SNOW : k > h - 5 ? M.PACKED : M.ICE, k > h - 2 ? 14 : 120); }
    }
  }
  // snow on the deck, icicles on the yards
  for (let u = -76; u <= 82; u++) { if (deckHole(u)) continue; const hh = 1 + ((u * 7) & 1); for (let k = 1; k <= hh; k++) if (mat[wy(u, -k) * W + wx(u)] === AIR) L(u, -k, M.SNOW, k > hh - 1 ? 16 : 60); }
  for (let k = 0; k < 18; k++) { const u = randInt(-14, 44), d = randInt(-61, -57) + 14; if (mat[wy(u, d) * W + wx(u)] === AIR && mat[wy(u, d - 1) * W + wx(u)] !== AIR) { const len = randInt(3, 8); for (let j = 0; j < len && mat[wy(u, d + j) * W + wx(u)] === AIR; j++) L(u, d + j, M.ICE); } }
  worldInfo.spots.ship = { x: cx, y: yD - 8 };
  addSite('ship', cx + 4, yD - 30, 190, 150);
  void T;
}

// ---------------------------------------------------------------------------------------------------------------------
// signal fire pyre on the cape summit
function stampSignalFire(T: Terrain) {
  const x = LOC.summit.x, gy = Math.floor(T.surf[x] / 4) * 4;
  for (let xx = x - 14; xx < x + 14; xx++) box(xx, T.surf[xx], xx + 1, T.surf[xx] + 3, M.STONE);   // flush cap on the real surface (a raised pad would be a wall)
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
