// Test helpers shared by *.selftest.ts and window.__sc: a flat snow arena with known density, and a sandbox that snapshots and restores
// the whole game state around a destructive scenario.
import { G } from './state';
import { W, H, TS, mat, aux, shade, flags, bg, seen, awake, wakeRect, edited, setCell, F_PLACED } from '../engine/grid';
import { MAT } from '../content/materials';
import { initSim } from '../engine/sim';
import { initHeat } from '../engine/heat';
import { initStructure } from '../engine/structure';
import { clusters, clearBodies } from '../engine/bodies';
import { clearParticles } from '../engine/particles';
import { inv, backpacks, dropDur, held } from './inventory';
import { body, applyDifficulty } from './player';
import { resetShelter } from './shelter';
import { setClock, wx } from './weather';
import { toolState, autoPickup, resetDigState } from './tools';
import { auxOfDensity } from './items';

export interface ArenaOpts { halfW?: number; up?: number; depth?: number; dens?: number; loose?: number; ice?: boolean }
/** Flat test ground: air above (x±halfW, topY-up .. topY), `loose` rows of SNOW, then PACKED of the given density down `depth` cells, stone below. */
export function arena(cx: number, topY: number, o: ArenaOpts = {}) {
  const halfW = o.halfW ?? 70, up = o.up ?? 60, depth = o.depth ?? 36, loose = o.loose ?? 0, dens = o.dens ?? 300;
  autoPickup.on = false;             // test ground: loose items stay where they lie (a test that needs auto-pickup switches it on again)
  const x0 = cx - halfW, x1 = cx + halfW;
  for (let y = topY - up; y < topY + depth + 10; y++) for (let x = x0; x <= x1; x++) {
    const i = y * W + x;
    mat[i] = 0; aux[i] = 0; flags[i] = 0; shade[i] = (x * 7 + y * 13) & 255;
    if (y >= topY + depth) { mat[i] = MAT.STONE; }
    else if (y >= topY + loose) { mat[i] = o.ice ? MAT.ICE : MAT.PACKED; aux[i] = auxOfDensity(dens); }
    else if (y >= topY) { mat[i] = MAT.SNOW; aux[i] = 30; }
  }
  for (let ty = (topY - up) >> 2; ty <= (topY + depth + 10) >> 2; ty++) for (let tx = x0 >> 2; tx <= x1 >> 2; tx++) bg[ty * (W / TS) + tx] = 0;
  // fixture records inside the arena would remain as ghosts (chests, flags): drop them with the cells
  for (let i = G.fixtures.length - 1; i >= 0; i--) { const f = G.fixtures[i]; if (f.tx * TS <= x1 && (f.tx + f.tw) * TS >= x0 && f.ty * TS <= topY + depth + 10 && (f.ty + f.th) * TS >= topY - up) G.fixtures.splice(i, 1); }
  edited(x0, topY - up, x1, topY + depth + 10);
  wakeRect(x0, topY - up, x1, topY + depth, 60);
  return { x: cx, y: topY };
}
export function put(x: number, y: number, m: number, a = 0, fl = 0) { setCell(x, y, m, a, fl); }
export function tileBlock(tx: number, ty: number, tw: number, th: number, m: number, a = 0, fl = F_PLACED) {
  for (let y = ty * TS; y < (ty + th) * TS; y++) for (let x = tx * TS; x < (tx + tw) * TS; x++) setCell(x, y, m, a, fl);
  edited(tx * TS, ty * TS, (tx + tw) * TS, (ty + th) * TS);
}
export function count(m: number, x0 = 0, y0 = 0, x1 = W - 1, y1 = H - 1) {
  let n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (mat[y * W + x] === m) n++;
  return n;
}

interface Snap {
  mat: Uint8Array; aux: Uint8Array; shade: Uint8Array; flags: Uint8Array; bg: Uint8Array; seen: Uint8Array; awake: Uint8Array;
  fixtures: string; drops: string; player: string; inv: string; time: number; ts: number; diff: string; body: string; win: typeof G.win;
}
export function snapshot(): Snap {
  return {
    mat: mat.slice(), aux: aux.slice(), shade: shade.slice(), flags: flags.slice(), bg: bg.slice(), seen: seen.slice(), awake: awake.slice(),
    fixtures: JSON.stringify(G.fixtures), drops: JSON.stringify(G.drops), player: JSON.stringify(G.player),
    inv: JSON.stringify({ slots: inv.slots, sel: inv.sel, wear: inv.wear, sled: inv.sled }), time: G.time, ts: G.timeScale, diff: JSON.stringify(G.diff),
    body: JSON.stringify({ scar: body.scar, warmT: body.warmT, fineT: body.fineT }), win: { ...G.win },
  };
}
export function restore(s: Snap) {
  resetDigState(); held.load = 0;                  // the transient digging state is not part of the snapshot
  mat.set(s.mat); aux.set(s.aux); shade.set(s.shade); flags.set(s.flags); bg.set(s.bg); seen.set(s.seen); awake.set(s.awake);
  G.fixtures.length = 0; for (const f of JSON.parse(s.fixtures)) G.fixtures.push(f);
  G.drops.length = 0; for (const d of JSON.parse(s.drops)) G.drops.push(d);
  Object.assign(G.player, JSON.parse(s.player));
  const iv = JSON.parse(s.inv);
  for (let i = 0; i < inv.slots.length; i++) inv.slots[i] = iv.slots[i];
  inv.sel = iv.sel; Object.assign(inv.wear, iv.wear); inv.sled = iv.sled;
  setClock(s.time); G.timeScale = s.ts; wx.override = null;
  Object.assign(G.diff, JSON.parse(s.diff));
  const b = JSON.parse(s.body); Object.assign(body.scar, b.scar); body.warmT = b.warmT; body.fineT = b.fineT;
  Object.assign(G.win, s.win);
  clearBodies(); clearParticles(); clusters.length = 0; backpacks.clear(); dropDur.clear(); resetShelter();
  toolState.dome = false; toolState.smart = false;
  initSim(); initStructure(); initHeat();
}
/** Run a scenario on a snapshot of the real game; everything is restored afterwards. */
export async function sandbox<T>(fn: () => Promise<T> | T): Promise<T> {
  const s = snapshot(), ap = autoPickup.on;
  autoPickup.on = false;
  try { return await fn(); } finally { restore(s); autoPickup.on = ap; }
}
void applyDifficulty;

/** Build a snow-block igloo by direct writes. Ground row = first solid tile row. Interior `iw` tiles wide (even), straight walls `wallRows` high, then a corbelled
 *  dome (1 tile inward per course). Entrance: a `door` wide gap in the left wall (3 tiles) unless noDoor. Returns geometry in tiles. */
export function igloo(cx: number, groundRow: number, o: { iw?: number; wallRows?: number; dens?: number; door?: boolean; vent?: boolean; plugDoor?: boolean } = {}) {
  const iw = o.iw ?? 6, wr = o.wallRows ?? 6, dens = o.dens ?? 300;
  const ax = auxOfDensity(dens);
  const L = (cx >> 2) - (iw >> 1) - 2;              // left wall tile (2 wide)
  const R = L + 2 + iw;                             // right wall tile (2 wide)
  const blk = (tx0: number, row: number) => tileBlock(tx0, row, 2, 1, MAT.SNOWBLOCK, ax, F_PLACED);
  const base = groundRow - 1;
  const doorRows = o.door === false ? 0 : 6;
  for (let k = 0; k < wr; k++) {
    const row = base - k;
    const inDoor = k < doorRows;
    if (!inDoor) blk(L, row); else if (k === 0) { /* opening */ }
    blk(R, row);
  }
  // corbel courses: each overhangs one tile further inward
  let row = base - wr, topRow = row;
  for (let k = 0; k < 12; k++, row--) {
    const a = L + 1 + k, b = R - 1 - k, gap = b - (a + 2);
    topRow = row;
    if (gap > 0) { blk(a, row); blk(b, row); continue; }
    if (gap === 0) { blk(a, row); if (o.vent) { /* leave a 1-tile hole */ blk(b + 1, row); } else blk(b, row); break; }
    blk(a, row); break;
  }
  return { L, R, base, wr, topRow, iw, floorRow: groundRow, doorRows };
}

/** Sinter all placed snow blocks in a region (strip F_PLACED) — what time does for real blocks. */
export function sinterRegion(x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * W + x; if (mat[i] === MAT.SNOWBLOCK) flags[i] &= ~F_PLACED; }
}
