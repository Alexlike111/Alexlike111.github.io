// Extra world content (G6 «содержимое мира»): finds and loot on the wide empty stretches (beach, fast ice, cape), lichen patches,
// coal veins in the mine rock, orientation flags, sled and a few cans in the ship hold. placeExtras() runs last in generateWorld
// (after finalize): it only writes cells and records, and wakes / edits every region it changes. It uses its own RNG, not grid rand(),
// so the random stream of the world (and tests/world.test.ts) is not shifted.
import { G, newId, type Slot } from './state';
import { W, H, mat, aux, flags, wakeRect, edited, F_FIXTURE } from '../engine/grid';
import { MAT } from '../content/materials';
import { addFixture, box, put, topSolid, worldInfo } from './locations';

const SOFT = (m: number) => m === MAT.AIR || m === MAT.SNOW || m === MAT.PACKED;   // cells a chest may take over without digging rock

/** xorshift32 seeded from the world seed: its own stream, deterministic per seed. */
function makeRng(seed: number) {
  let s = ((seed * 2654435761) >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

const LOOT_KEEP = /^(note|radio|battery|pick|saw|axe|lantern|flare_gun|barometer|flint|harpoon|ice_chisel)/;
/** Same loot scaling as locations.chest(): difficulty multiplies the counts, singletons stay. */
const loot = (items: Slot[]): Slot[] => items.map(s => ({ ...s, n: LOOT_KEEP.test(s.id) ? s.n : Math.max(1, Math.round(s.n * G.diff.loot)) }));

/** Cells of the 2x2-tile footprint starting at x0 (4-aligned) may be cut: only air and snow. Returns the tile-aligned floor row B, or -1. */
function floorRow(x0: number, w = 8): number {
  let hi = 1e9, lo = -1;
  for (let x = x0; x < x0 + w; x++) { const t = topSolid(x, 120); if (t > H - 40) return -1; if (t < hi) hi = t; if (t > lo) lo = t; }
  if (lo - hi > 12) return -1;                                      // gentle ground only; the floor row is the lowest point, so nothing floats
  const B = Math.ceil(lo / 4) * 4;
  if (B - 8 < 0 || B >= H - 8) return -1;
  for (let x = x0; x < x0 + w; x++) {
    for (let y = B - 8; y < B; y++) { const m = mat[y * W + x]; if (!SOFT(m) && m !== MAT.DIRT && m !== MAT.GRAVEL && m !== MAT.WOOD) return -1; }   // snow, air, earth or driftwood carved away under the chest (bones stay)
    const s = mat[B * W + x];
    if (s === MAT.AIR || s === MAT.FIXTURE || s === MAT.WATER) return -1;  // must stand on something
  }
  return B;
}
const overlapsFixture = (x0: number, w: number) => G.fixtures.some(f => f.tx * 4 < x0 + w + 2 && (f.tx + f.tw) * 4 > x0 - 2);
const nearHole = (x: number) => worldInfo.sealHoles.some(h => x + 8 > h.x - 8 && x < h.x + h.w + 10);

/** Pick a 2x2-tile spot (4-aligned) in [lo, hi] nearest to the anchors, a random one among the three best. */
function pickSpot(lo: number, hi: number, anchors: number[], used: number[], gap: number, rnd: () => number) {
  const cand: { x: number; B: number; d: number }[] = [];
  for (let x = Math.ceil(lo / 4) * 4; x + 8 <= hi; x += 4) {
    if (used.some(u => Math.abs(u - x) < gap) || overlapsFixture(x, 8) || nearHole(x)) continue;
    const B = floorRow(x); if (B < 0) continue;
    const d = anchors.length ? Math.min(...anchors.map(a => Math.abs(a - (x + 4)))) : 0;
    cand.push({ x, B, d });
  }
  if (!cand.length) return null;
  cand.sort((a, b) => a.d - b.d);
  return cand[Math.floor(rnd() * Math.min(3, cand.length))];
}

/** A 2x2-tile chest standing on the floor row B (solid, like the other chests). */
function placeChest(site: 'beach' | 'fastice' | 'cape' | 'ship', x0: number, B: number, items: Slot[]) {
  const tx = x0 >> 2, ty = (B >> 2) - 2;
  const scaled = loot(items);
  const f = addFixture('chest', tx, ty, 2, 2, { items: scaled });
  worldInfo.chests.push({ id: f.id, site, x: tx * 4 + 4, y: ty * 4 + 4, items: scaled });
  touch(x0, B - 8, x0 + 8, B);
  return f;
}
/** Wake the chunks of a changed region and report the edit to the solvers (structure, heat, sim surface). */
function touch(x0: number, y0: number, x1: number, y1: number) { wakeRect(x0, y0, x1, y1, 120); edited(x0, y0, x1, y1); }

/** Flag pole stuck in the ground at x (decorative landmark, no cells). */
function flagAt(x: number) {
  const top = topSolid(x, 120);
  addFixture('flag', (x >> 2) - 1, (top >> 2) - 2, 3, 2, {});
}

/** Lichen mat on the ground under the snow at a patch centred on cx (same rule as worldgen's windswept patches). */
function lichenPatch(cx: number, w: number): number {
  let n = 0;
  for (let x = cx - (w >> 1); x <= cx + (w >> 1); x++) {
    if (overlapsFixture(x, 1)) continue;                              // never cut the snow under a chest or a fixture
    const top = topSolid(x, 120); if (top > H - 40) continue;
    let g = top; while (g < H - 1 && (mat[g * W + x] === MAT.SNOW || mat[g * W + x] === MAT.PACKED)) g++;
    const gm = mat[g * W + x];
    if (gm === MAT.AIR || gm === MAT.FIXTURE || gm === MAT.WATER || SOFT(gm)) continue;
    if (g - 2 < 2) continue;
    for (let y = top; y < g; y++) { const i = y * W + x; if (mat[i] === MAT.SNOW || mat[i] === MAT.PACKED) { mat[i] = MAT.AIR; aux[i] = 0; } }
    const hh = Math.abs(x - cx) / (w / 2) > 0.8 ? 1 : 2;
    for (let k = 1; k <= hh; k++) put(x, g - k, MAT.LICHEN);
    n++;
  }
  if (n) { worldInfo.lichen.push({ x: cx - (w >> 1), w }); touch(cx - (w >> 1), 120, cx + (w >> 1) + 1, H - 40); }
  return n;
}

/** Thin coal veins inside the stone of the mine rock, each within reach of an open gallery cell. */
function coalVeins(count: number, rnd: () => number): number {
  const near = (x: number, y: number) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && mat[yy * W + xx] === MAT.AIR) return true; } return false; };
  let made = 0;
  for (let t = 0; t < 6000 && made < count; t++) {
    const x = 120 + Math.floor(rnd() * 131), y = 270 + Math.floor(rnd() * 31);
    if (mat[y * W + x] !== MAT.STONE || !near(x, y)) continue;
    const dir = rnd() < 0.5 ? 1 : -1, len = 6 + Math.floor(rnd() * 4);
    let cells = 0;
    for (let u = 0; u < len; u++) for (let v = 0; v < 2; v++) {
      const xx = x + dir * u, yy = y + v + Math.round(u * 0.25);
      if (xx < 0 || xx >= W || yy < 0 || yy >= H) continue;
      if (mat[yy * W + xx] === MAT.STONE) { mat[yy * W + xx] = MAT.COAL; aux[yy * W + xx] = 0; cells++; }
    }
    if (cells >= 8) { made++; touch(Math.min(x, x + dir * (len - 1)), y - 1, Math.max(x, x + dir * (len - 1)) + 1, y + 3); }
  }
  return made;
}

/** Entry point: called once at the end of generateWorld(). */
export function placeExtras() {
  const rnd = makeRng((G.seed | 0) * 7919 + 4243);
  const used: number[] = [];

  // W7: landmark flags along the beach, the fast ice and the pack edge
  for (const x of [1020, 1200, 1350]) flagAt(x);      // x 1020 (not 1000): the beach has room for chests only on the gaps the flag leaves

  // W1: beach (driftwood piles, whale skeleton) and fast ice (flags): two chests each, a sled with cargo on the fast ice
  const driftAnchors = worldInfo.driftwood.map(d => d.x + (d.len >> 1));
  const beachA = pickSpot(908, 1100, driftAnchors, used, 40, rnd);
  if (beachA) { placeChest('beach', beachA.x, beachA.B, [{ id: 'can', n: 2 }, { id: 'rope', n: 2 }, { id: 'matches', n: 1 }]); used.push(beachA.x); }
  const beachB = pickSpot(908, 1100, [worldInfo.spots.whale.x], used, 40, rnd);
  // v13: the ice chisel (пешня) lies in this beach chest, before the ship: the ship's frozen lids need it (the deck note says so)
  if (beachB) { placeChest('beach', beachB.x, beachB.B, [{ id: 'biscuit', n: 3 }, { id: 'fat', n: 1 }, { id: 'flask', n: 1 }, { id: 'ice_chisel', n: 1 }]); used.push(beachB.x); }
  const iceA = pickSpot(1100, 1440, [1200], used, 40, rnd);
  if (iceA) { placeChest('fastice', iceA.x, iceA.B, [{ id: 'can', n: 1 }, { id: 'rope', n: 1 }, { id: 'matches', n: 2 }]); used.push(iceA.x); }
  const iceB = pickSpot(1100, 1440, [1350], used, 40, rnd);
  if (iceB) {
    placeChest('fastice', iceB.x, iceB.B, [{ id: 'biscuit', n: 2 }, { id: 'fat', n: 1 }]); used.push(iceB.x);
    // the abandoned sled lies next to its cargo
    const top = topSolid(iceB.x + 12, 120);
    G.drops.push({ id: newId(), item: 'sled', n: 1, x: iceB.x + 12, y: top - 3, vx: 0, vy: 0, age: 0 });
  }

  // W4: the cape ledge at x≈220: a chest and a small cache of lichen and fox fur
  const capeA = pickSpot(196, 244, [220], used, 30, rnd);
  if (capeA) {
    placeChest('cape', capeA.x, capeA.B, [{ id: 'biscuit', n: 2 }, { id: 'matches', n: 1 }, { id: 'fox_fur', n: 1 }]); used.push(capeA.x);
    const capeB = pickSpot(capeA.x - 44, capeA.x + 44, [], used, 12, rnd);
    if (capeB) {
      const f = addFixture('cache', capeB.x >> 2, (capeB.B >> 2) - 2, 2, 2, { items: [{ id: 'lichen', n: 4 }, { id: 'fox_fur', n: 1 }] });
      box(f.tx * 4, f.ty * 4, (f.tx + 2) * 4, (f.ty + 2) * 4, MAT.FIXTURE, 0, F_FIXTURE);     // a stone cache is solid
      touch(capeB.x, capeB.B - 8, capeB.x + 8, capeB.B);
      used.push(capeB.x);
    }
  }

  // (W3 coal veins removed on purpose: owner decision "шахта без добычи" — coal lies in sacks and carts, no ore grind)

  // W5: lichen patches on the station pad (700–900) and on the fast ice (1100–1400)
  lichenPatch(718, 12);
  lichenPatch(884, 10);
  lichenPatch(1168, 12);
  lichenPatch(1292, 12);

  // v13 long walks (playtest: 60–90 game minutes of empty legs). Cheap finds with a use and no enemies: a driftwood stack and a lost tin with a mitten
  // between the station and the mine (x 330–600), an old campfire ring with two logs on the pack ice between the fast ice and the ship (x 1470–1640).
  const dropOn = (item: string, n: number, x: number, floorRow: number) => { G.drops.push({ id: newId(), item, n, x, y: floorRow - 3, vx: 0, vy: 0, age: 0 }); };
  const wood = pickSpot(336, 400, [368], used, 40, rnd);
  if (wood) { dropOn('log', 3, wood.x + 3, wood.B); used.push(wood.x); }
  const tin = pickSpot(500, 600, [550], used, 40, rnd);
  if (tin) { dropOn('wool_mittens', 1, tin.x + 2, tin.B); dropOn('can', 1, tin.x + 6, tin.B); used.push(tin.x); }
  const ring = pickSpot(1470, 1640, [1560], used, 40, rnd);       // the pack ice (the holes and chests of the fast ice leave no room)
  if (ring && !nearHole(ring.x)) {
    addFixture('campfire', ring.x >> 2, (ring.B >> 2) - 1, 2, 1, {});
    dropOn('log', 2, ring.x + 6, ring.B); used.push(ring.x);
    touch(ring.x, ring.B - 8, ring.x + 8, ring.B);
  }

  // survival balance: two more cans in the ship hold chest (the chest with the radio triode)
  const hold = worldInfo.chests.find(c => c.site === 'ship' && c.items.some(s => s.id === 'radio_triode'));
  if (hold) {
    const can = hold.items.find(s => s.id === 'can');
    if (can) can.n += 2; else hold.items.push({ id: 'can', n: 2 });
    const f = G.fixtures.find(q => q.id === hold.id);
    if (f && f.items !== hold.items) f.items = hold.items;
  }
}
