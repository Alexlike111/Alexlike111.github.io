// Sites stamped into the world at the end of generate() (placeLocations). Coordinates are world cells (5 cm), y grows downward.
// Built only from existing materials: PLANK/DOOR for timber, POLE (white when vertical, orange when horizontal) for posts,
// rungs and the radio mast, ROCK / ICE / ASH for stone, icicles and the fire pit, WOOD for the dark wreck parts, CRATE for caches.
// The lake reuses the ice-filled hollow that generate() carves (LAKE_A..LAKE_B): its lower part becomes WATER under a 20-40 cm ice lid.
// Sites are placed on the ground generate() made: each stamp levels its own pad (fill or carve up to one floor row) and updates
// groundY there, so heat / events keep reading the right ground line. The start area (START_X +- 150) is never touched.
import { W, H, M, mat, flags, treeId, beamId, groundY, crates, trees, putCell, nextBeamId, placeCrate, START_X, F_VERT, F_TREE, F_BOULDER, idx } from './world';
import type { Crate } from './world';
import type { DiaryPage, RadioPartId } from './lore';

export type LocationKind = 'station' | 'lake' | 'grotto' | 'wreck' | 'tower' | 'spring';
export interface Pt { x: number; y: number }
export interface Poi { radio?: Pt; stove?: Pt; cache?: Pt; spring?: Pt & { r: number } }
export interface Location { id: string; name: string; x0: number; x1: number; y: number; kind: LocationKind; poi: Poi }
/** Warm spring water rectangle: the heat module can read it (isWarm) to keep these cells from freezing. */
export interface WarmSpring { x0: number; x1: number; y0: number; y1: number }

/** Placed locations of the current world, left to right (filled by placeLocations). */
export const locations: Location[] = [];
/** Warm spring pools (water cells), for the heat module. */
export const warmSprings: WarmSpring[] = [];
/** A hidden stash: a buried crate with diary pages and radio parts that are not ordinary loot (lore.ts ids; main grants them when opened). */
export interface Stash { crate: Crate; where: LocKey; pages: DiaryPage['id'][]; radio: RadioPartId[] }
export type LocKey = 'station' | 'lake' | 'grotto' | 'wreck' | 'spring' | 'tower';
/** Stashes of the current world (filled by placeLocations; the crate objects are the ones in `crates`). */
export const stashes: Stash[] = [];
/** Carved marks: a point the hero must stand within 1.5 m of to read the carving `id` (lore.ts CARVINGS). */
export interface CarvingSpot { id: string; x: number; y: number }
export const carvingSpots: CarvingSpot[] = [];
let lakeTop = -1;                     // row where the lake water starts (under the ice lid), -1 before stampLake

// fixed sites (cells). Start 560: the start area stays clear; the nearest site is the warm spring, 380 cells west.
const SPRING_X = 178, SPRING_HW = 20;    // pool centre, half-width
const TOWER_X = 1092;                    // lookout tower on the ridge crest (ground ~375)
const LAKE_A = 1500, LAKE_B = 1780;      // the frozen lake = the hollow generate() carves
const GROTTO_X = 1930;                   // west face of the cliff; the cave opens here
const STATION_X = 2166;                  // hut left wall; a pit in front of the door
const WRECK_X = 2290;                    // fuselage nose
/** Column spans the sites build on (ground, snow, trees and supply crates there are cleared first). */
const PADS = { spring: [144, 212], tower: [1076, 1108], grotto: [1916, 2000], station: [2148, 2268], wreck: [2280, 2358] } as const;
/** Supply crates pushed into a pad by generate()'s clearSpot: their loot is moved into the station's parts crate. */
let displaced: string[] = [];

/** Deterministic small random stream of its own (the world's rnd() sequence is not touched). */
function rng(seed: number): () => number {
  let s = ((seed ^ 0x2545f491) >>> 0) || 0x9e3779b9;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

const inside = (x: number, y: number) => x >= 1 && y >= 1 && x < W - 1 && y < H - 1;

/** Write one cell. Cells of a standing tree (trunk, boughs) are never overwritten. */
function put(x: number, y: number, m: M, d = 0, b = 0, f = 0): void {
  if (!inside(x, y)) return;
  if (treeId[idx(x, y)] !== 0) return;
  putCell(x, y, m, d, b, f);
}
/** A placed timber cell: belongs to beam id (one per structure, as the player's beams have). */
function beamPut(x: number, y: number, m: M, id: number): void {
  put(x, y, m);
  if (inside(x, y)) beamId[idx(x, y)] = id;
}
/** Snow in the same style as generate(): 4 cells of loose powder on top, bonded snow below. */
function snowCell(x: number, y: number, fromTop: number, r: () => number): void {
  if (fromTop < 4) put(x, y, M.SNOW, 80 + ((r() * 15) | 0), 0, 0);
  else put(x, y, M.SNOW, 220 + ((r() * 40) | 0), 110 + ((r() * 20) | 0), 0);
}
/** Median of groundY over [x0, x1]: the floor row a pad is levelled to (fills and carves stay small). */
function median(x0: number, x1: number): number {
  const v: number[] = [];
  for (let x = x0; x <= x1; x++) v.push(groundY[x]);
  v.sort((a, b) => a - b);
  return v[v.length >> 1];
}
/** Level the ground of columns x0..x1 to row F: fill dirt where the ground is lower, carve it where higher. Updates groundY. */
function levelGround(x0: number, x1: number, F: number): void {
  for (let x = x0; x <= x1; x++) {
    const g = groundY[x];
    if (g > F) for (let y = F; y < g; y++) put(x, y, M.DIRT, 0, 0, 0);
    else if (g < F) for (let y = g; y < F; y++) put(x, y, M.AIR, 0, 0, 0);
    groundY[x] = F;
  }
}
/** Remove the loose stuff above row yEnd in columns x0..x1: snow, the boulders generate() dropped there and the marker poles of displaced crates. */
function clearLoose(x0: number, x1: number, yEnd: number): void {
  for (let x = x0; x <= x1; x++) for (let y = 0; y < yEnd; y++) {
    const i = idx(x, y);
    if (mat[i] === M.SNOW || mat[i] === M.POLE || (mat[i] === M.ROCK && (flags[i] & F_BOULDER) !== 0)) putCell(x, y, M.AIR, 0, 0, 0);
  }
}
/** Fell the standing trees that have a cell in columns x0..x1 (crown included): a whole tree goes, so no stump or bough is left in a pad.
 *  Trees are seeded, so a pad can meet one on some boots; the default world has none in these pads. */
function fellTrees(x0: number, x1: number): void {
  const ids = new Set<number>();
  for (let x = x0; x <= x1; x++) for (let y = 0; y < H; y++) { const t = treeId[idx(x, y)]; if (t !== 0) ids.add(t); }
  if (ids.size === 0) return;
  const low = new Map<number, { x: number; y: number }>();          // lowest trunk cell of each tree
  for (let i = 0; i < W * H; i++) {
    const t = treeId[i];
    if (t === 0 || !ids.has(t) || mat[i] !== M.WOOD || (flags[i] & F_TREE) === 0) continue;
    const y = (i / W) | 0, b = low.get(t);
    if (!b || y > b.y) low.set(t, { x: i - y * W, y });
  }
  for (let i = 0; i < W * H; i++) if (treeId[i] !== 0 && ids.has(treeId[i])) putCell(i % W, (i / W) | 0, M.AIR, 0, 0, 0);
  for (const b of low.values()) {
    const t = trees.find((tr) => tr.alive && Math.abs(tr.x - b.x) <= 2 && tr.base === b.y + 1);
    if (t) t.alive = false;
  }
}
/** Supply crates that lie in columns x0..x1 are emptied so the pad can be built; their loot goes to `displaced`. The list keeps its order (craft.ts keys extras by index). */
function emptyCrates(x0: number, x1: number): void {
  for (const c of crates) {
    if (c.x + c.w - 1 < x0 || c.x > x1) continue;
    for (let y = c.y; y < c.y + c.h; y++) for (let x = c.x; x < c.x + c.w; x++) if (mat[idx(x, y)] === M.CRATE) putCell(x, y, M.AIR, 0, 0, 0);
    displaced.push(...c.loot);
    c.opened = true;
    c.loot = [];
  }
}

/** A buried supply-style crate (16 x 11 cells, top-left at x, y). Returns the centre of its lid. */
function crate(x: number, y: number, loot: string[]): Pt {
  for (let yy = y; yy < y + 11; yy++) for (let xx = x; xx < x + 16; xx++) put(xx, yy, M.CRATE, 0, 0, 0);
  crates.push({ x, y, w: 16, h: 11, loot: loot.slice(), opened: false });
  return { x: x + 8, y: y + 5 };
}
/** The crate object that crate() pushed last. */
const lastCrate = (): Crate => crates[crates.length - 1];
/** Tree nearest to column x (alive, at least minH tall), or null. */
function nearestTree(x: number, minH = 0): { x: number; base: number } | null {
  let best: { x: number; base: number } | null = null, bd = 1e9;
  for (const t of trees) {
    if (!t.alive || t.height < minH) continue;
    const d = Math.abs(t.x - x);
    if (d < bd) { bd = d; best = t; }
  }
  return best && bd <= 400 ? best : null;
}
/** Carving on a trunk 1.25 m above its base; falls back to a point on open ground when no tree is near. */
function treeSpot(id: string, x: number, minH = 0): void {
  const t = nearestTree(x, minH);
  if (t) carvingSpots.push({ id, x: t.x, y: t.base - 25 });
  else carvingSpots.push({ id, x, y: groundY[Math.max(0, Math.min(W - 1, x))] - 25 });
}
/** True for a cell of the frozen lake's water (below the ice lid): heat must not freeze it all the way down. */
export function isLakeWater(x: number, y: number): boolean {
  return lakeTop >= 0 && x > LAKE_A && x < LAKE_B && y >= lakeTop;
}
/** A thick straight stroke of cells (walls, wings, fin). */
function lineStamp(x0: number, y0: number, x1: number, y1: number, th: number, m: M): void {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  const h = th >> 1;
  for (let k = 0; k <= n; k++) {
    const x = Math.round(x0 + ((x1 - x0) * k) / n), y = Math.round(y0 + ((y1 - y0) * k) / n);
    for (let dy = -h; dy <= h; dy++) for (let dx = -h; dx <= h; dx++) put(x + dx, y + dy, m);
  }
}

/** Frozen lake: keep the ice lid (20-40 cm, 4-8 cells) that generate() laid, turn the ice below it into water. */
function stampLake(): void {
  const lakeLevel = Math.min(groundY[LAKE_A], groundY[LAKE_B]) + 4; // same level as generate()
  lakeTop = lakeLevel;
  for (let x = LAKE_A + 1; x < LAKE_B; x++) {
    const g = groundY[x];
    if (g <= lakeLevel) continue;                                   // rim: no ice, no water
    const lid = 6 + Math.round(2 * Math.sin(x * 0.045));            // 4..8 cells
    for (let y = lakeLevel + lid; y < g; y++) {
      if (mat[idx(x, y)] === M.ICE) putCell(x, y, M.WATER, 1000, 0, 0);
    }
  }
  locations.push({ id: 'lake', name: 'Замёрзшее озеро', x0: LAKE_A, x1: LAKE_B, y: lakeLevel, kind: 'lake', poi: {} });
}

/** Warm spring: a bowl in a levelled pad, water 15 cm under the rim, bare of snow around; a few rocks on the rim. */
function stampSpring(r: () => number): void {
  const C = SPRING_X, HW = SPRING_HW;
  const PAD0 = C - HW - 14, PAD1 = C + HW + 14;
  const F = median(C - HW, C + HW);
  levelGround(PAD0, PAD1, F);
  clearLoose(PAD0, PAD1, F);
  const WL = F + 3;                                                 // water surface
  for (let x = C - HW; x <= C + HW; x++) {
    const u = (x - C) / HW;
    const depth = 2 + Math.round(7 * Math.sqrt(Math.max(0, 1 - u * u)));
    for (let y = F; y < WL; y++) putCell(x, y, M.AIR, 0, 0, 0);
    for (let y = WL; y < WL + depth; y++) putCell(x, y, M.WATER, 1000, 0, 0);
  }
  for (const side of [-1, 1]) for (let k = 0; k < 3; k++) {          // rim boulders
    const xc = C + side * (HW + 4 + k * 5), h = 2 + ((r() * 4) | 0);
    for (let x = xc - 2; x <= xc + 2; x++) for (let y = F - h; y < F; y++) put(x, y, M.ROCK, 0, 0, F_BOULDER);
  }
  warmSprings.push({ x0: C - HW, x1: C + HW, y0: WL, y1: WL + 9 });
  carvingSpots.push({ id: 'tree_spring', x: C + HW + 4, y: F - 3 });   // the east rim boulder
  locations.push({
    id: 'spring', name: 'Тёплый источник', x0: C - HW - 6, x1: C + HW + 6, y: WL, kind: 'spring',
    poi: { spring: { x: C, y: WL, r: HW } },
  });
}

/** Lookout tower on the ridge crest: two POLE legs 3 cells wide, a PLANK platform with a rail, orange rungs between the legs. */
function stampTower(): void {
  const X = TOWER_X;
  const F = median(X - 14, X + 14);
  levelGround(X - 16, X + 16, F);
  clearLoose(X - 16, X + 16, F);
  const TOP = F - 150;                                              // platform rows [TOP, TOP + 3)
  for (let y = TOP + 3; y < F; y++) for (const x of [X - 9, X - 8, X - 7, X + 7, X + 8, X + 9]) put(x, y, M.POLE, 0, 0, F_VERT);
  const id = nextBeamId();
  for (let y = TOP; y < TOP + 3; y++) for (let x = X - 12; x <= X + 12; x++) beamPut(x, y, M.PLANK, id);
  for (let y = TOP - 14; y < TOP; y++) for (const x of [X - 12, X - 11, X + 11, X + 12]) put(x, y, M.POLE, 0, 0, F_VERT);
  for (const y of [TOP - 14, TOP - 7]) for (let x = X - 12; x <= X + 12; x++) put(x, y, M.POLE, 0, 0, 0);
  for (let y = F - 6; y >= TOP + 4; y -= 8) for (let x = X - 7; x <= X + 7; x++) put(x, y, M.POLE, 0, 0, 0);
  locations.push({ id: 'tower', name: 'Наблюдательная вышка', x0: X - 12, x1: X + 12, y: TOP, kind: 'tower', poi: {} });
}

/** Rock grotto in a cliff: a 4 m rock mass with a 2.2 m high cave (open to the west), an overhang lip, icicles, an old fire ring and a buried cache. */
function stampGrotto(r: () => number): void {
  const GX = GROTTO_X, GX1 = GX + 64, CX1 = GX + 44;
  const F = median(GX - 2, GX + 48);
  levelGround(GX - 14, GX1 + 6, F);
  // rock mass: top 4 m above the floor, a little wavy; the east end sinks into the snow
  for (let x = GX; x <= GX1; x++) {
    let top = F - 80 + Math.round(3 * Math.sin(x * 0.21) + 2 * Math.sin(x * 0.53 + 1));
    if (x > GX1 - 14) top = Math.round(top + ((x - (GX1 - 14)) / 14) * 26);
    for (let y = top; y < F; y++) put(x, y, M.ROCK, 0, 0, 0);
  }
  // cave: 2.2 m high, 4.4 m deep; the rock above it is the roof
  for (let x = GX; x < CX1; x++) for (let y = F - 45; y < F; y++) putCell(x, y, M.AIR, 0, 0, 0);
  // overhang lip sticking out 10 cells over the mouth, and the drift in front scooped out (a wind-cleared apron)
  for (let x = GX - 10; x < GX; x++) for (let y = F - 54; y < F - 45; y++) put(x, y, M.ROCK, 0, 0, 0);
  for (let x = GX - 14; x < GX; x++) for (let y = F - 45; y < F; y++) putCell(x, y, M.AIR, 0, 0, 0);
  for (let x = GX - 14; x < GX - 10; x++) for (let y = F - 60; y < F - 45; y++) putCell(x, y, M.AIR, 0, 0, 0);
  // icicles hanging from the roof: ICE, 6-11 cells long, tapering
  const ceil = F - 46;
  for (const off of [6, 14, 22, 30, 38]) {
    const x = GX + off + ((r() * 3) | 0) - 1, len = 6 + ((r() * 6) | 0);
    for (let k = 0; k < len; k++) {
      const w = Math.max(1, Math.round(3 * (1 - k / len)));
      for (let dx = -((w - 1) >> 1); dx <= (w >> 1); dx++) put(x + dx, ceil + 1 + k, M.ICE, 917, 255, 0);
    }
  }
  // old fire ring: two rock rims with the ash of a fire between them
  const FX = GX + 12;
  for (const x0 of [FX - 2, FX + 13]) for (let x = x0; x < x0 + 2; x++) for (let y = F - 4; y < F; y++) put(x, y, M.ROCK, 0, 0, F_BOULDER);
  for (let x = FX; x <= FX + 12; x++) put(x, F - 1, M.ASH, 0, 0, 0);
  for (let x = FX + 3; x <= FX + 9; x++) put(x, F - 2, M.ASH, 0, 0, 0);
  // hidden cache: a crate buried 15 cm under the cave floor (frozen ground, needs a pick)
  const cache = crate(GX + 30, F + 3, ['matches', 'food', 'saw']);
  stashes.push({ crate: lastCrate(), where: 'grotto', pages: [3], radio: ['radio_resonator'] });
  locations.push({ id: 'grotto', name: 'Скальный грот', x0: GX - 14, x1: GX1, y: F - 45, kind: 'grotto', poi: { cache } });
}

/** Abandoned weather station: a PLANK hut with its roof 30 cm under the snow, a door reached by a dug shaft with a ladder,
 *  a stove (rock box with ash), a radio table with a mast through the roof, a louvred Stevenson screen and a wind vane on posts. */
function stampStation(r: () => number): void {
  const HX = STATION_X, HW = 72;
  const PIT0 = HX - 14, PIT1 = HX - 1;                              // dug shaft in front of the door
  const PAD0 = HX - 18, PAD1 = HX + HW + 30;
  const F = median(HX, HX + HW - 1);                                // floor row
  levelGround(PAD0, PAD1, F);
  clearLoose(PAD0, PAD1, F);
  const roofTop = F - 42, S = F - 48;                               // roof rows; snow surface 6 cells above the roof
  const id = nextBeamId();
  // shell: planked walls and a two-row roof; the interior is open air
  for (let x = HX; x < HX + HW; x++) for (let y = roofTop; y < F; y++) {
    const wall = x <= HX + 1 || x >= HX + HW - 2;
    if (y < roofTop + 2 || wall) beamPut(x, y, M.PLANK, id);
    else putCell(x, y, M.AIR, 0, 0, 0);
  }
  for (let y = F - 31; y < F; y++) for (let x = HX; x <= HX + 1; x++) put(x, y, M.DOOR, 0, 0, 0);
  // stove: rock box with a bed of ash on top (no smoke hole, the fire burns inside)
  const SX = HX + HW - 26;
  for (let x = SX; x < SX + 15; x++) for (let y = F - 9; y < F; y++) put(x, y, M.ROCK, 0, 0, 0);
  for (let x = SX + 1; x < SX + 14; x++) put(x, F - 10, M.ASH, 0, 0, 0);
  // radio table: planked top on two legs, a dark radio set on it
  for (let x = HX + 10; x <= HX + 28; x++) for (let y = F - 16; y < F - 14; y++) beamPut(x, y, M.PLANK, id);
  for (const x0 of [HX + 10, HX + 27]) for (let x = x0; x < x0 + 2; x++) for (let y = F - 14; y < F; y++) beamPut(x, y, M.PLANK, id);
  for (let x = HX + 15; x <= HX + 20; x++) for (let y = F - 21; y < F - 16; y++) put(x, y, M.WOOD, 0, 0, 0);
  // parts crate on the floor (the radio spares; loot ids are wired later)
  const parts = crate(HX + 30, F - 11, ['matches', 'thermos', ...displaced]);
  stashes.push({ crate: lastCrate(), where: 'station', pages: [1, 7], radio: [] });
  carvingSpots.push({ id: 'crate_match', x: parts.x, y: parts.y });
  // snow over the roof and the sides (the pit and the posts are cut out afterwards)
  for (let x = PAD0; x <= PAD1; x++) {
    if (x >= PIT0 && x <= PIT1) continue;
    // over the hut: level snow up to the roof; east of it a 45-degree ramp of snow down to the ground (no wall)
    const inHut = x >= HX && x < HX + HW;
    const t0 = inHut ? S : Math.min(F, S + Math.max(0, x - (HX + HW)));
    const yEnd = inHut ? roofTop : F;
    for (let y = t0; y < yEnd; y++) if (mat[idx(x, y)] === M.AIR) snowCell(x, y, y - t0, r);
  }
  // radio mast: through the roof and the snow, 2 m above the surface, orange crossbar at its top
  for (let x = HX + 17; x <= HX + 18; x++) for (let y = S - 40; y < F - 21; y++) put(x, y, M.POLE, 0, 0, F_VERT);
  for (let x = HX + 10; x <= HX + 25; x++) put(x, S - 40, M.POLE, 0, 0, 0);
  // pit: open shaft from the surface to the door sill, two white rails and orange rungs
  for (let y = S + 1; y < F; y++) for (const x of [PIT0 + 2, PIT0 + 3, PIT1 - 3, PIT1 - 2]) put(x, y, M.POLE, 0, 0, F_VERT);
  for (let y = S + 6; y < F; y += 7) for (let x = PIT0 + 4; x <= PIT1 - 4; x++) put(x, y, M.POLE, 0, 0, 0);
  // Stevenson screen: louvred PLANK box on a post, 1.5 m above the snow
  const SBX = HX + HW + 2, SBW = 14, BT = S - 44, BB = S - 31;
  // frame: solid top, bottom and side posts; louvres are short slats from each post (gaps between them), so every piece is held
  for (let y = BT; y <= BB; y++) for (let x = SBX; x < SBX + SBW; x++) {
    const post = x === SBX || x === SBX + SBW - 1;
    const slat = (x < SBX + 4 || x >= SBX + SBW - 4) && (y - BT) % 3 !== 2;
    if (y === BT || y === BB || post || slat) put(x, y, M.PLANK, 0, 0, 0);
  }
  for (let y = BB; y < F; y++) for (const x of [SBX + 6, SBX + 7]) put(x, y, M.POLE, 0, 0, F_VERT);
  // wind vane: a tall post, an orange arm with a white fin
  const VX = HX + HW + 20, VT = S - 66;
  for (let y = VT; y < F; y++) for (const x of [VX, VX + 1]) put(x, y, M.POLE, 0, 0, F_VERT);
  for (let x = VX - 10; x < VX + 14; x++) put(x, VT, M.POLE, 0, 0, 0);
  for (let y = VT - 6; y < VT; y++) for (const x of [VX + 12, VX + 13]) put(x, y, M.POLE, 0, 0, F_VERT);
  locations.push({
    id: 'station', name: 'Заброшенная метеостанция', x0: PIT0, x1: VX + 14, y: S, kind: 'station',
    poi: { radio: { x: HX + 17, y: F - 22 }, stove: { x: SX + 7, y: F - 10 }, cache: parts },
  });
}

/** Light plane lying nose-first in the snow: wooden fuselage with a hollow cabin, the belly buried on the left, an engine block,
 *  a broken wing up in the air and a second wing into the drift, a tail fin, a cargo crate beside the tail. */
function stampWreck(r: () => number): void {
  const X0 = WRECK_X, L = 44;
  const PAD0 = X0 - 10, PAD1 = X0 + L + 24;
  const F = median(X0, X0 + L);
  levelGround(PAD0, PAD1, F);
  clearLoose(PAD0, PAD1, F);
  const TOP = F - 12;
  for (let x = X0; x < X0 + L; x++) for (let y = TOP; y < F; y++) {
    const hollow = x >= X0 + 3 && x < X0 + L - 4 && y >= TOP + 2 && y < F - 1;
    if (!hollow) put(x, y, M.WOOD, 0, 0, 0);
  }
  for (let x = X0; x < X0 + L / 2 - 4; x++) for (let y = TOP + 6; y < F; y++) snowCell(x, y, y - TOP - 6, r);
  lineStamp(X0 + 18, TOP + 1, X0 + 40, TOP - 12, 3, M.PLANK);            // broken wing, up in the air
  lineStamp(X0 + 14, F - 3, X0 - 4, F - 7, 3, M.PLANK);                  // the other wing, into the drift
  lineStamp(X0 + L - 2, TOP, X0 + L + 4, TOP - 14, 3, M.WOOD);           // tail fin
  for (let x = X0 - 6; x < X0; x++) for (let y = F - 11; y < F; y++) put(x, y, M.ROCK, 0, 0, 0); // engine block
  for (let x = X0 - 14; x <= X0 - 2; x++) put(x, TOP + 3, M.POLE, 0, 0, 0);           // propeller, orange
  const cargo = crate(X0 + L + 6, F - 11, ['food', 'thermos']);
  stashes.push({ crate: lastCrate(), where: 'wreck', pages: [4], radio: ['radio_battery'] });
  carvingSpots.push({ id: 'crate_pick', x: cargo.x, y: cargo.y });
  locations.push({ id: 'wreck', name: 'Обломки самолёта', x0: X0 - 14, x1: X0 + L + 22, y: TOP, kind: 'wreck', poi: { cache: cargo } });
}

/** Warm-spring water is read by the heat module: true inside a warm pool (a little above its surface too). */
export function isWarm(x: number, y: number): boolean {
  for (const w of warmSprings) if (x >= w.x0 && x <= w.x1 && y >= w.y0 - 2 && y <= w.y1) return true;
  return false;
}

/** The location whose x-span holds x (null on open ground). */
export function findLocation(x: number): Location | null {
  for (const l of locations) if (x >= l.x0 && x <= l.x1) return l;
  return null;
}

/** Stamp all six locations into the world generate() just made. Call once, at the end of generate(). */
export function placeLocations(seed: number): Location[] {
  locations.length = 0;
  warmSprings.length = 0;
  stashes.length = 0;
  carvingSpots.length = 0;
  lakeTop = -1;
  displaced = [];
  const r = rng(seed);
  // trees and supply crates standing in a pad go first (seeded forest and clearSpot shifts differ per boot); a grotto's cave keeps the big spruce east of the cliff
  fellTrees(PADS.spring[0], PADS.spring[1]); fellTrees(PADS.tower[0], PADS.tower[1]); fellTrees(PADS.grotto[0], GROTTO_X + 43);
  fellTrees(PADS.station[0], PADS.station[1]); fellTrees(PADS.wreck[0], PADS.wreck[1]);
  for (const p of Object.values(PADS)) emptyCrates(p[0], p[1]);
  stampSpring(r);
  stampLake();
  stampTower();
  stampGrotto(r);
  stampStation(r);
  stampWreck(r);
  placeStashes();
  locations.sort((a, b) => a.x0 - b.x0);
  return locations;
}

/** Stashes that have no stamp of their own (lake, spring, tower) and the carvings on trees. Crates are appended after the six sites,
 *  so the loot indices of the generate() crates and the three site caches keep their order. */
function placeStashes(): void {
  // lake: a buried cache with an orange pole, on the snow of the west shore (no ice under it)
  placeCrate(LAKE_A - 34, ['matches']);
  stashes.push({ crate: lastCrate(), where: 'lake', pages: [2], radio: [] });
  // spring: a buried cache 60 cells (3 m) west of the pool, on the snow (the pad itself is bare)
  placeCrate(SPRING_X - SPRING_HW - 40, ['food']);
  stashes.push({ crate: lastCrate(), where: 'spring', pages: [5], radio: [] });
  // tower: the radio cable in a crate on the platform, at its west end (the east end stays free to stand on)
  const X = TOWER_X, TOP = locations.find((l) => l.id === 'tower')?.y ?? 0;
  const cable = crate(X - 12, TOP - 11, ['thermos']);
  stashes.push({ crate: lastCrate(), where: 'tower', pages: [6], radio: ['radio_cable'] });
  carvingSpots.push({ id: 'crate_antenna', x: cable.x, y: cable.y });
  carvingSpots.push({ id: 'tree_flag', x: X + 8, y: TOP - 4 });                 // on the platform rail
  // carvings on real trees: the young spruces beside the start (easy to find), and a tall one in the forest
  treeSpot('tree_stones', START_X - 134);
  treeSpot('tree_snow', START_X + 58);
  treeSpot('tree_fall', 1000, 150);
  treeSpot('tree_lake', LAKE_A - 40);
}
