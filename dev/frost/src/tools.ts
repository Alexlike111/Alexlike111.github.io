// Tools: shovel, snow saw, axe, beams, snow blocks, campfire; crates, eating.
import { W, H, M, mat, dens, bond, flags, body, treeId, beamId, nextBeamId, idx, inb, set, rigidAt, isGranular, crates, F_DIST, F_BLOCK, F_TREE, F_VERT, BOND_SOLID, CELL, wake } from './world';
import { G, Fire } from './state';
import { plural } from './ru';
import { pl } from './player';
import { spawn, PK } from './particles';
import { markStruct, supportMargin, freshBeam } from './structure';
import { makeBody, bodyAtIndex, removeBody, bodies } from './phys';
import type { Sound } from './audio';

export const TOOLS = [
  { id: 'shovel', name: 'Лопата', key: '1' },
  { id: 'saw', name: 'Пила', key: '2' },
  { id: 'axe', name: 'Топор', key: '3' },
  { id: 'beam', name: 'Бревно', key: '4' },
  { id: 'block', name: 'Блок', key: '5' },
  { id: 'fire', name: 'Костёр', key: '6' },
] as const;

export const inv = { logs: 0, branches: 0, matches: 5, food: 3, crackers: 1, thermos: 0, blocks: [] as number[], saw: true, snowshoes: false };
// msgSec: how long the next tool message stays on the hint card (seconds)
export const tool = { bfs: 0, outs: 0, ins: 0, digs: 0, tun: false, digDir: 1, cur: 0, cool: 0, rot: 0, sawT: 0, sawNeed: 1, msg: '' as string, msgSec: 2.5, built: new Set<string>() };
export const REACH = 40; // cells (2 m)
/** E / «Взять» feeds a campfire this close (cells, 2 m); the HUD fuel chip shows at the same distance */
export const FEED_R = 40;
/** a campfire this close (4 m) gets «Подойди ближе к костру» instead of the generic E hint */
const FIRE_NEAR_R = 80;
export const BLOCK_CAP = 8;
const PW_HALF = 5; // half body width (cells)
let sfx: Sound | null = null;
export function bindSound(s: Sound) { sfx = s; }
let fireId = 1;

export function resetTools() {
  Object.assign(inv, { logs: 0, branches: 0, matches: 5, food: 3, crackers: 1, thermos: 0, blocks: [], saw: true, snowshoes: false });
  Object.assign(tool, { tun: false, digDir: 1, cur: 0, cool: 0, rot: 0, digs: 0, sawT: 0, sawNeed: 1, msg: '', msgSec: 2.5 });
  tool.built.clear();
  G.fires.length = 0; laid.length = 0; bag.length = 0; flushIn = 0; DIG.key = ''; DIG.p = 0; fireLatch = false; placeLatch = false; sawX0 = sawY0 = -99; notchTid = -1;
}

export const shoulder = () => [pl.x, pl.y - pl.h * 0.72] as const;
export function inReach(x: number, y: number) { const [sx, sy] = shoulder(); return Math.hypot(x - sx, y - sy) <= REACH; }
/** Clamp aim to reach along the ray from the shoulder; stop at the first rigid non-target cell. */
export function reachPoint(ax: number, ay: number): [number, number] {
  const [sx, sy] = shoulder();
  const d = Math.hypot(ax - sx, ay - sy);
  if (d <= REACH) return [ax, ay];
  return [sx + (ax - sx) * REACH / d, sy + (ay - sy) * REACH / d];
}

function say(m: string) { tool.msg = m; }

// ---------------- shovel: digs 5 x 5 cell tiles ----------------
/** A tile is 5 x 5 cells (25 cm), grid-aligned: tile (tx, ty) covers cells x 5tx..5tx+4, y 5ty..5ty+4. */
export const TILE = 5;
/** seconds to dig one tile, by the hardness class of its snow: 0 powder, 1 settled, 2 firm / sintered, 3 very hard */
const DIG_S = [0.07, 0.15, 0.3, 0.5];
/** smart cursor (Ctrl toggle on PC; always on for touch): a dig target that is not snow snaps to the nearest diggable tile in reach */
let smartOn = false;
export function setSmart(on: boolean) { smartOn = on; }
/** one tile: what is in it. hard = ice, frozen ground, rock, timber, water or a crate (not shovelled); body = a fallen log */
export interface DigTile { tx: number; ty: number; snow: number; hard: number; body: number; hardMat: number; time: number; }
export interface DigTarget {
  tx: number; ty: number;   // the tile the target lands on
  target: DigTile;          // its contents
  ok: boolean;              // can dig now: snow, nothing hard, within reach
  far: boolean;             // beyond the 2 m reach (red outline)
  reason: string;           // short why it is not ok ('' when ok)
  tiles: DigTile[];         // one dig takes these (the target; under the hero also the neighbours of a shaft start)
  time: number;             // seconds for all of them
  key: string;              // identity of the dig: a moved target starts it over
  snapped: boolean;         // the smart cursor or the touch stick moved the target off the aim
}
/** the dig in progress: its key, progress 0..1 and tiles (the overlay draws the cracks from these). Released or moved: starts over. */
export const DIG = { key: '', p: 0, tiles: [] as DigTile[] };
let lastNothingT = -99;
const HARD_WHY: Record<number, string> = {
  [M.ICE]: 'лёд: лопата не берёт', [M.DIRT]: 'мёрзлая земля: не берётся', [M.ROCK]: 'камень: не берётся', [M.BEDROCK]: 'скала: не берётся',
  [M.WATER]: 'вода: копать нечем', [M.WOOD]: 'дерево: рубить топором', [M.PLANK]: 'брус: не копается', [M.DOOR]: 'дверь: не копается', [M.CRATE]: 'ящик: не копается', [M.POLE]: 'вешка: не копается',
};
/** hardness class of one snow cell from its density and bond (the top powder 75-95 / bond 0; the middle layer ~200 / 90-120; deeper 235-400) */
function cellClass(i: number): number {
  const d = dens[i], b = bond[i];
  if (d >= 400 || b >= 220) return 3;
  if (d >= 300 || b >= 150) return 2;
  if (d >= 150 || b >= BOND_SOLID) return 1;
  return 0;
}
function scanTile(tx: number, ty: number): DigTile {
  const t: DigTile = { tx, ty, snow: 0, hard: 0, body: 0, hardMat: -1, time: 0 };
  let sec = 0;
  for (let y = ty * TILE; y < ty * TILE + TILE; y++) for (let x = tx * TILE; x < tx * TILE + TILE; x++) {
    if (!inb(x, y)) continue;
    const i = idx(x, y);
    if (body[i]) { t.body++; continue; }
    const m = mat[i];
    if (m === M.SNOW || m === M.ASH) { t.snow++; sec += DIG_S[cellClass(i)]; }
    else if (m !== M.AIR && m !== M.NEEDLE) { t.hard++; if (t.hardMat < 0) t.hardMat = m; }
  }
  t.time = t.snow ? sec / t.snow : 0;
  return t;
}
const diggable = (t: DigTile) => t.snow > 0 && t.hard === 0 && t.body === 0;
/** why a tile is grey (not dug): the material in it, or that there is no snow */
function whyNot(t: DigTile): string {
  if (t.body) return 'упавшее бревно: топором';
  if (t.hard) return HARD_WHY[t.hardMat] ?? 'твёрдое: не копается';
  return t.snow ? '' : 'здесь нет снега: целься в снег';
}
/** Terraria rule: the straight line from the shoulder to the aim meets the first non-air cell; that cell is the target (no digging through walls). -1: the line is clear. */
function firstSolid(ax: number, ay: number): number {
  const [sx, sy] = shoulder();
  const dx = ax - sx, dy = ay - sy;
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  let last = -1;
  for (let k = 0; k <= n; k++) {
    const x = Math.round(sx + (dx * k) / n), y = Math.round(sy + (dy * k) / n);
    if (!inb(x, y)) return -1;
    const i = idx(x, y);
    if (i === last) continue;
    last = i;
    if (body[i] || (mat[i] !== M.AIR && mat[i] !== M.NEEDLE)) return i;
  }
  return -1;
}
/** the nearest point of the tile is within the 2 m reach of the shoulder */
function inReachTile(tx: number, ty: number): boolean {
  const [sx, sy] = shoulder();
  const nx = Math.min(Math.max(sx, tx * TILE), tx * TILE + TILE), ny = Math.min(Math.max(sy, ty * TILE), ty * TILE + TILE);
  return Math.hypot(nx - sx, ny - sy) <= REACH;
}
/** smart cursor: the nearest diggable tile within 3 tiles of the aim, reached by the line from the shoulder first (never snapped through a wall) */
function snapTile(tx: number, ty: number, ax: number, ay: number): DigTile | null {
  let best: DigTile | null = null, bd = 1e9;
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const u = scanTile(tx + dx, ty + dy);
    if (!diggable(u) || !inReachTile(u.tx, u.ty)) continue;
    const cx = u.tx * TILE + TILE / 2, cy = u.ty * TILE + TILE / 2;
    const d = Math.hypot(cx - ax, cy - ay);
    if (d >= bd) continue;
    const f = firstSolid(cx, cy);
    if (f >= 0 && (Math.floor((f % W) / TILE) !== u.tx || Math.floor(((f / W) | 0) / TILE) !== u.ty)) continue; // a wall lies between
    best = u; bd = d;
  }
  return best;
}
/** under the hero, at or below the knees: a shaft starts here and is dug as wide as the body, so the hero can drop in */
function underHero(t: DigTile): boolean {
  return Math.abs(t.tx * TILE + TILE / 2 - pl.x) <= PW_HALF + TILE / 2 && (t.ty + 1) * TILE > pl.y - 6;
}
/** The tile a dig at the aim takes now. The line from the shoulder decides first (you dig the wall you meet, not what is behind it).
 *  Smart cursor (or touch): a target that is not snow snaps to the nearest snow in reach. Touch with the stick moving: when still not snow,
 *  the wall in front (chest, head, then feet height) is taken. */
export function aimTarget(ax: number, ay: number, moveX = 0): DigTarget {
  const i = firstSolid(ax, ay);
  const tx0 = i >= 0 ? Math.floor((i % W) / TILE) : Math.floor(ax / TILE);
  const ty0 = i >= 0 ? Math.floor(((i / W) | 0) / TILE) : Math.floor(ay / TILE);
  let t = scanTile(tx0, ty0), snapped = false;
  if (!(diggable(t) && inReachTile(t.tx, t.ty)) && (smartOn || G.mobile)) {
    const s = snapTile(tx0, ty0, ax, ay);
    if (s) { t = s; snapped = true; }
  }
  if (!diggable(t) && G.mobile && moveX !== 0) {
    const fx = pl.x + (moveX > 0 ? 1 : -1) * (PW_HALF + 3);
    for (const fy of [pl.y - pl.h * 0.5, pl.y - pl.h + 5, pl.y - 4]) {
      const f = scanTile(Math.floor(fx / TILE), Math.floor(fy / TILE));
      if (diggable(f) && inReachTile(f.tx, f.ty)) { t = f; snapped = true; break; }
    }
  }
  const far = !inReachTile(t.tx, t.ty);
  const ok = !far && diggable(t);
  const tiles: DigTile[] = [t];
  if (ok && underHero(t)) {
    const c0 = Math.floor((pl.x - PW_HALF) / TILE), c1 = Math.floor((pl.x + PW_HALF - 0.001) / TILE);
    for (let cx = c0; cx <= c1; cx++) {
      if (cx === t.tx) continue;
      const u = scanTile(cx, t.ty);
      if (diggable(u) && inReachTile(cx, t.ty)) tiles.push(u);
    }
  }
  return {
    tx: t.tx, ty: t.ty, target: t, ok, far, reason: ok ? '' : far ? 'дальше 2 м' : whyNot(t), tiles,
    time: tiles.reduce((s, u) => s + u.time, 0), key: tiles.map((u) => u.tx + ',' + u.ty).join(';'), snapped,
  };
}
/** a finished dig: its snow cells leave the world into the spoil bag (thrown clear by tickSpoil), dust bursts, the stamina cost by hardness */
function finishDig(tiles: DigTile[]) {
  let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const u of tiles) {
    const bx = u.tx * TILE, by = u.ty * TILE;
    x0 = Math.min(x0, bx); y0 = Math.min(y0, by); x1 = Math.max(x1, bx + TILE); y1 = Math.max(y1, by + TILE);
    pl.stamina -= 0.006 + 0.02 * u.time;
    for (let y = by; y < by + TILE; y++) for (let x = bx; x < bx + TILE; x++) {
      if (!inb(x, y)) continue;
      const i = idx(x, y);
      if ((mat[i] !== M.SNOW && mat[i] !== M.ASH) || body[i]) continue;
      bag.push(dens[i]); n++;
      set(x, y, M.AIR);
    }
  }
  if (!n) return;
  tool.digs++;
  for (let k = 0, nb = 4 + Math.min(10, n >> 2); k < nb; k++) {
    const u = tiles[k % tiles.length];
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6, sp = 20 + Math.random() * 40;
    spawn(PK.DUST, u.tx * TILE + Math.random() * TILE, u.ty * TILE + Math.random() * TILE, Math.cos(a) * sp, Math.sin(a) * sp, 0.5 + Math.random() * 0.5, 1.2 + Math.random() * 0.6, 0, 0);
  }
  sfx?.dig(Math.min(1, tiles[0].time / DIG_S[3]));
  markStruct(x0 - 6, y0 - 6, x1 + 6, y1 + 6);
}
/** shovel held: progress on the target's tile(s) by their hardness; a finished tile is cleared at once, the progress of a moved target starts over */
function shovelDig(ax: number, ay: number, dt: number, moveX: number) {
  const t = aimTarget(ax, ay, moveX);
  if (!t.ok) {
    DIG.key = ''; DIG.p = 0;
    if (G.realTime - lastNothingT > 2.5) { lastNothingT = G.realTime; say(t.far ? 'Дальше 2 м не достать — подойди или спрыгни в яму' : t.reason); if (!t.far) sfx?.uiDeny(); }
    return;
  }
  tool.digDir = ax >= pl.x ? 1 : -1;
  if (pl.stamina < 0.03) { say('Нет сил. Передохни'); DIG.key = ''; DIG.p = 0; return; }
  if (t.key !== DIG.key) { DIG.key = t.key; DIG.p = 0; }
  DIG.tiles = t.tiles;
  DIG.p += dt / Math.max(0.02, t.time);
  if (Math.random() < dt * 14) { // dust off the blade while it bites (no mass)
    spawn(PK.DUST, t.target.tx * TILE + Math.random() * TILE, t.target.ty * TILE + Math.random() * TILE, (Math.random() - 0.5) * 30, -(10 + Math.random() * 30), 0.45 + Math.random() * 0.4, 1 + Math.random() * 0.6, 0, 0);
  }
  if (DIG.p >= 1) { finishDig(t.tiles); DIG.key = ''; DIG.p = 0; }
}
/** RMB with the shovel: tamp the target tile (its snow pressed firm, mass kept) */
function shovelTamp(ax: number, ay: number) {
  const t = aimTarget(ax, ay, 0);
  if (t.far) { say('Дальше 2 м не достать'); return; }
  const u = t.target;
  if (u.snow === 0 || u.hard || u.body) { say(u.snow === 0 ? 'Тут нечего утрамбовать — целься в снег' : t.reason); sfx?.uiDeny(); return; }
  if (pl.stamina < 0.03) { say('Нет сил. Передохни'); return; }
  tampTile(u);
  pl.stamina -= 0.02; tool.cool = 0.3;
  say('Утрамбовал');
  sfx?.dig(0.6);
  markStruct(u.tx * TILE - 6, u.ty * TILE - 6, u.tx * TILE + TILE + 6, u.ty * TILE + TILE + 6);
}
/** Tamp: every column of the tile is pressed into its lowest snow cells, density >= 350 and bond >= 140 where the mass allows.
 *  The column's density sum is kept exactly (loose cells above are pulled into the firm ones; no mass is made). */
function tampTile(u: DigTile) {
  for (let x = u.tx * TILE; x < u.tx * TILE + TILE; x++) compactColumn(x, u.ty * TILE, u.ty * TILE + TILE - 1);
}
function compactColumn(x: number, y0: number, y1: number) {
  let n = 0, S = 0, yb = -1;
  for (let y = y0; y <= y1; y++) {
    if (!inb(x, y)) return;
    const i = idx(x, y);
    if ((mat[i] === M.SNOW || mat[i] === M.ASH) && !body[i]) { n++; S += dens[i]; yb = y; }
  }
  if (!n) return;
  const k = Math.max(1, Math.min(n, Math.floor(S / 350)));   // firm cells the column's mass makes; never more cells than it had
  const base = Math.floor(S / k), rem = S - base * k;
  for (let y = y0; y <= y1; y++) { const i = idx(x, y); if ((mat[i] === M.SNOW || mat[i] === M.ASH) && !body[i]) set(x, y, M.AIR); }
  for (let j = 0; j < k; j++) set(x, yb - j, M.SNOW, base + (j < rem ? 1 : 0), 150, 0);
}

// ---- spoil throw: ballistic planner ----
export const CLUMP_G = 196, CLUMP_LIFE = 4;
/** Where a clump thrown from (sx,sy) with velocity (vx,vy) comes to rest: mirrors stepParticles (1 cell steps, first non-air cell stops it). */
export function simulateClump(sx: number, sy: number, vx: number, vy: number): [number, number] {
  let x = sx, y = sy;
  const dt = 1 / 60;
  for (let t = 0; t < CLUMP_LIFE; t += dt) {
    vy += CLUMP_G * dt;
    const nx = x + vx * dt, ny = y + vy * dt;
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(nx - x), Math.abs(ny - y))));
    let px0 = x | 0, py0 = y | 0;
    for (let k = 1; k <= n; k++) {
      const cx = (x + ((nx - x) * k) / n) | 0, cy = (y + ((ny - y) * k) / n) | 0;
      if (!inb(cx, cy) || cy >= H - 2 || cx < 1 || cx >= W - 1) return [px0, 1e4];  // leaves the world
      const c = idx(cx, cy);
      if (mat[c] !== M.AIR || body[c]) return [px0, py0];
      px0 = cx; py0 = cy;
    }
    x = nx; y = ny;
  }
  return [x | 0, y | 0];
}
const openAir = (i: number) => mat[i] === M.AIR || mat[i] === M.NEEDLE;
/** width of the air span in row y around x (capped) */
function airSpan(x: number, y: number, cap: number): number {
  if (!inb(x, y) || !openAir(idx(x, y))) return 0;
  let a = 0, b = 0;
  while (a < cap && inb(x - a - 1, y) && openAir(idx(x - a - 1, y))) a++;
  while (b < cap && inb(x + b + 1, y) && openAir(idx(x + b + 1, y))) b++;
  return a + b + 1;
}
/** true if nothing roofs cell (x,y) for 60 rows */
export function skyOpen(x: number, y: number): boolean {
  for (let k = 1; k <= 60; k++) { if (y - k < 0) return true; if (!openAir(idx(x, y - k))) return false; }
  return true;
}
/** Row of the hole's rim when the hero stands in an open-topped pit/shaft (-1: no pit, or roofed over: a tunnel/cave). */
function holeRim(): number {
  const px = Math.round(pl.x), y0 = Math.round(pl.y) - 10;
  if (!inb(px, y0) || !openAir(idx(px, y0))) return -1;
  if (!skyOpen(px, y0 - pl.h + 10)) return -1;
  if (airSpan(px, y0, 30) >= 45) return -1;
  for (let r = y0; r > Math.max(2, y0 - 160); r--) if (airSpan(px, r, 30) >= 45) return r;
  return Math.max(2, y0 - 160);
}
export interface ThrowPlan { ux: number; uy: number; sp: number; where: string; dist: number; }
/** Choose a direction/speed whose spoil lands outside the hole, >= 20 cells away; deep shaft: out and up over the rim. Every candidate is
 *  simulated for the toss scatter (speed +-12 %, angle +-4 %, spawn +-2 cells) and must pass for all of it. */
export function planSpoil(sx: number, sy: number): ThrowPlan {
  const rim = holeRim();
  const px = pl.x;
  let best: ThrowPlan | null = null, bestScore = -1e9, fb: ThrowPlan | null = null, fbScore = -1e9;
  const speeds = [85, 105, 130, 160, 200, 250, 310];
  for (const sp of speeds) {
    if (best && bestScore > -sp * 0.06 + 6 && bestScore > -30) break; // a gentler speed already works
    for (let a = 10; a <= 85; a += 5) for (const side of [-1, 1]) {
      const rad = (a * Math.PI) / 180, ux = Math.cos(rad) * side, uy = -Math.sin(rad);
      let minD = 1e9, pass = 0, n = 0, ld = 0, roofed = 0;
      for (const f of [0.9, 1, 1.1]) for (const j of [-0.02, 0.02]) for (const ox of [-2, 2]) {
        const [lx, ly] = simulateClump(sx + ox, sy, (ux + j) * sp * f, (uy + j) * sp * f - 25);
        const d = Math.abs(lx - px);
        n++;
        if (ly >= 1e4 || (rim >= 0 && ly > rim + 3)) continue;           // left the world / down in the same pit
        if (!skyOpen(lx, ly)) { if (rim >= 0 || d < 25) continue; roofed++; } // inside a tunnel/cave: acceptable only far from the hero
        pass++;
        if (d < minD) minD = d;
        if (f === 1 && j > 0 && ox > 0) ld = d;
      }
      if (pass === 0 || minD < 8) continue;
      const score = -sp * 0.06 - Math.abs(a - 40) * 0.05 - Math.max(0, minD - 70) * 0.05 - (roofed ? 40 : 0) + (side === -tool.digDir ? 8 : 0); // over the shoulder, behind the back: never onto the snow still to be dug
      if (pass === n && minD >= 20) { if (score > bestScore) { bestScore = score; best = { ux, uy, sp, where: roofed ? 'cave' : 'out', dist: ld }; } }
      else { const sc = pass / n * 100 + score; if (sc > fbScore) { fbScore = sc; fb = { ux, uy, sp, where: 'part', dist: ld }; } } // best partial: a deep, narrow shaft
    }
  }
  if (best) return best;
  if (fb) return fb;
  // nothing clears the walls: straight up-and-out as hard as the arm goes
  const a = (80 * Math.PI) / 180, side = -pl.face;
  return { ux: Math.cos(a) * side, uy: -Math.sin(a), sp: 330, where: 'blind', dist: 0 };
}
/** Tunnel spoil: from inside a roofed gallery the snow is shovelled out along the air path to the nearest open-sky cell (the entrance / shaft) and lands on the
 *  surface 12-30 cells beside it, on the side away from the dig, so the tunnel never refills itself. ds: density of each cell. Returns false when there is no air route out. */
const bfsSeen = new Uint16Array(W * H); let bfsStamp = 0;
function tunnelSpoil(ds: number[]): boolean {
  if (++bfsStamp > 65000) { bfsSeen.fill(0); bfsStamp = 1; }
  const sx0 = Math.round(pl.x), sy0 = Math.round(pl.y) - 4;
  const q = new Int32Array(9000); let qh = 0, qt = 0;
  q[qt++] = idx(sx0, sy0); bfsSeen[idx(sx0, sy0)] = bfsStamp;
  let ex = -1, ey = -1;
  while (qh < qt) {
    const i = q[qh++], x = i % W, y = (i / W) | 0;
    if (skyOpen(x, y)) { ex = x; ey = y; break; }
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? -1 : k === 3 ? 1 : 0);
      if (!inb(nx, ny)) continue;
      const j = idx(nx, ny);
      if (bfsSeen[j] === bfsStamp || !(openAir(j) || isGranular(j)) || body[j]) continue; // loose spoil on the floor is waded through
      bfsSeen[j] = bfsStamp;
      if (qt < q.length) q[qt++] = j;
    }
  }
  tool.bfs = qt;
  if (ex < 0) return false;
  const side = -tool.digDir;
  let xr = ex, xl = ex; // the air span at the exit row (the shaft / entrance): the heap goes beside it, never into it
  while (xr - ex < 80 && inb(xr + 1, ey) && (openAir(idx(xr + 1, ey)) || isGranular(idx(xr + 1, ey)))) xr++;
  while (ex - xl < 80 && inb(xl - 1, ey) && (openAir(idx(xl - 1, ey)) || isGranular(idx(xl - 1, ey)))) xl--;
  const base = side > 0 ? xr : xl;
  for (let k = 0; k < ds.length; k++) {
    const x = Math.max(2, Math.min(W - 3, base + side * (6 + Math.floor(Math.random() * 80)))); // spread over ~4 m so the heap stays low and does not slide back into the entrance
    let y = Math.max(1, ey - 130); while (y < H - 3 && mat[idx(x, y)] === M.AIR) y++;
    spawn(PK.CLUMP, x, y - 5 - Math.random() * 3, side * (4 + Math.random() * 8), -6, CLUMP_LIFE, 1, ds[k], 0);
  }
  return true;
}
/** Snow dug out and not thrown yet: the density of each cell. It is mass in flight (the mass audit counts it). */
const bag: number[] = [];
let flushIn = 0;
/** sum of the densities of the snow dug out and waiting to be thrown */
export function spoilInFlight(): number { let s = 0; for (const d of bag) s += d; return s; }
/** per frame: the bag is thrown every 0.25 s, or at once when it holds 60 cells */
export function tickSpoil(dt: number) {
  flushIn -= dt;
  if (bag.length && (flushIn <= 0 || bag.length >= 60)) flushSpoil();
}
/** Throw the bag clear: under a roof the tunnelSpoil route; in the open planSpoil's landing, outside the hole. One clump per cell, with that cell's own density (mass-exact). */
function flushSpoil() {
  flushIn = 0.25;
  const ds = bag.splice(0, bag.length);
  const [sx, sy] = shoulder();
  if (!skyOpen(Math.round(pl.x), Math.round(pl.y - pl.h * 0.5)) && tunnelSpoil(ds)) { tool.outs++; sfx?.throwSnow(); return; }
  tool.ins++;
  const p = planSpoil(sx, sy);
  for (const d of ds) {
    const j = (Math.random() - 0.5) * 0.04;
    const vx = (p.ux + j) * p.sp * (0.9 + Math.random() * 0.2), vy = (p.uy + j) * p.sp * (0.9 + Math.random() * 0.2) - 25;
    if (spawn(PK.CLUMP, sx + (Math.random() - 0.5) * 4, sy + (Math.random() - 0.5) * 4, vx, vy, CLUMP_LIFE, 1, d, 0) < 0) bag.push(d); // particle pool full: kept for the next throw
  }
  sfx?.throwSnow();
}

// ---------------- saw ----------------
function blockRect(ax: number, ay: number) {
  const vert = tool.rot % 2 === 1;
  const w = vert ? 5 : 10, h = vert ? 10 : 5;
  const x0 = Math.round(ax - w / 2), y0 = Math.round(ay - h / 2);
  return { x0, y0, w, h };
}
/** What a saw cut at the aim would see: share of snow cells in the block rectangle, mean density, share of weakly bonded cells. */
export function sawProbe(ax: number, ay: number) {
  const { x0, y0, w, h } = blockRect(ax, ay);
  let ok = 0, sum = 0, weak = 0;
  const tot = w * h;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    if (!inb(x, y)) continue; const i = idx(x, y);
    if (mat[i] === M.SNOW && !body[i]) { ok++; sum += dens[i]; if (bond[i] < BOND_SOLID) weak++; }
  }
  const avg = ok ? sum / ok : 0;
  return { solid: ok >= tot * 0.85, avg, good: ok >= tot * 0.85 && weak <= tot * 0.2 && avg >= 170 };
}
/** Cheap check for the reticle: would the saw cut a block here right now? avg = mean density (kg/m³) of the snow under the block outline. */
export function sawCheck(ax: number, ay: number): { ok: boolean; avg: number } {
  const p = sawProbe(ax, ay);
  return { ok: p.good, avg: p.avg };
}
let sawX0 = -99, sawY0 = -99; // block corner of the cut in progress
/** Share of the current cut done, 0..1 (0 when none). It drains slowly after release, so a cut can be resumed. */
export function sawProgress(): number { return tool.sawNeed > 0 ? Math.min(1, tool.sawT / tool.sawNeed) : 0; }
function saw(ax: number, ay: number, dt: number) {
  if (!inv.saw) { say('Пилы нет. Поищи ящики под оранжевыми вешками'); return; }
  if (inv.blocks.length >= BLOCK_CAP) { say(`Больше ${BLOCK_CAP} ${plural(BLOCK_CAP, 'блока', 'блоков', 'блоков')} не унести. Сложи их`); return; }
  const { x0, y0, w, h } = blockRect(ax, ay);
  const pr = sawProbe(ax, ay);
  if (!pr.solid) { say('Пилой режут сплошной снег. Здесь пустота или не снег'); tool.sawT = 0; return; }
  const avg = pr.avg;
  if (!pr.good) { say(`Снег рыхлый (${Math.round(avg)} кг/м³). Пиле нужен плотный наст от 170: сними лопатой верхний пух на 20–30 см или утрамбуй ногами. X — рентген плотности`); tool.sawT = 0; return; }
  // a cut resumes only at the same spot: moving the saw to another block starts it over
  if (Math.abs(x0 - sawX0) > 3 || Math.abs(y0 - sawY0) > 3) tool.sawT = 0;
  sawX0 = x0; sawY0 = y0;
  tool.sawNeed = 1.0 + avg / 500;
  tool.sawT += dt;
  if (Math.random() < dt * 4) { sfx?.sawStroke(); spawn(PK.DUST, ax, ay, (Math.random() - 0.5) * 20, -10, 0.6, 1, 0, 0); }
  if (tool.sawT < tool.sawNeed) return;
  tool.sawT = 0;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { if (inb(x, y) && mat[idx(x, y)] === M.SNOW && !body[idx(x, y)]) set(x, y, M.AIR); }
  inv.blocks.push(Math.round(avg));
  pl.stamina -= 0.05;
  tool.cool = 0.3;
  say(`Блок ${Math.round(avg)} кг/м³ вырезан`);
  markStruct(x0 - 4, y0 - 4, x0 + w + 4, y0 + h + 4);
}

/** cells a snow block / beam would occupy at the aim */
/** Beam shape from R: 0 = 1 m horizontal, 1 = 2 m horizontal (2 logs), 2 = 1 m vertical, 3 = 2 m vertical (2 logs). Blocks only alternate flat/upright. */
export const BEAM_MODES = 5;
export const BEAM_MODE_NAMES = ['брус 1 м', 'брус 2 м', 'стойка 1 м', 'стойка 2 м', 'дверь 1,8 м (проходимая)'];
/** the door is 36 cells (1.8 m): a standing hero (34) passes it with 2 cells to spare, and a 4-cell lintel (1 m beam) closes the 2 m opening above it.
 *  Two logs, like a 2 m upright (36 cells of plank is 1.8 logs). */
export const DOOR_H = 36;
export function beamShape() { const s = ((tool.rot % BEAM_MODES) + BEAM_MODES) % BEAM_MODES; return s === 4 ? { vert: true, len: DOOR_H, logs: 2, door: true } : { vert: s >= 2, len: s & 1 ? 40 : 20, logs: s & 1 ? 2 : 1, door: false }; }
/** the R line: every beam mode in cycle order, the current one in brackets, e.g. «брус 1 м · [брус 2 м] · стойка 1 м · стойка 2 м · дверь 1,8 м» */
export function beamModesLine(): string {
  const cur = beamModeIndex();
  const line = BEAM_MODE_NAMES.map((n, i) => (i === cur ? `[${n.replace(' (проходимая)', '')}]` : n.replace(' (проходимая)', ''))).join(' · ');
  return cur === 4 ? line + ' — проходима, держит ветер и тепло' : line;
}
const MAT_NAME: Record<number, string> = { [M.DIRT]: 'земля', [M.ROCK]: 'камень', [M.BEDROCK]: 'скала', [M.ICE]: 'лёд', [M.WOOD]: 'дерево', [M.PLANK]: 'брус', [M.DOOR]: 'дверь', [M.CRATE]: 'ящик', [M.POLE]: 'вешка', [M.SNOW]: 'снег или другой блок', [M.WATER]: 'вода' };
/** placement classes of a world cell: 0 free (air, boughs, loose snow / ash: displaced), 1 rigid snow, 2 hard (rock, timber, ice, water, fallen bodies, world edge) */
function pcls(x: number, y: number): number {
  if (!inb(x, y)) return 2;
  const i = idx(x, y);
  if (body[i]) return 2;
  const m = mat[i];
  if (m === M.AIR || m === M.NEEDLE) return 0;
  if (m === M.WATER) return 2;
  if (isGranular(i)) return 0;
  if (m === M.SNOW) return 1;
  return rigidAt(i) ? 2 : 0;
}
/** the object may sit here: nothing hard inside, and at most 5 % of its cells in firm snow (those are replaced) */
function fitsAt(x0: number, y0: number, w: number, h: number): boolean {
  let snow = 0;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const c = pcls(x, y); if (c === 2) return false; if (c === 1) snow++; }
  return snow <= Math.floor(w * h * 0.05);
}
/** loose snow from row y down, at most TAMP_DEPTH cells, that the tamp will consolidate under the object reaches firm snow */
function padFirm(x: number, y0: number): boolean {
  for (let y = y0; y < y0 + TAMP_DEPTH; y++) {
    if (!inb(x, y)) return false;
    const i = idx(x, y);
    if (body[i]) return false;
    if (pcls(x, y) >= 1) return true;
    if (mat[i] !== M.SNOW) return false;
  }
  return false;
}
/** something firm (not a fallen body) directly under the bottom row, or loose snow that the tamp will hold (see padFirm) */
function restsAt(x0: number, y0: number, w: number, h: number): boolean {
  const y = y0 + h;
  for (let x = x0; x < x0 + w; x++) {
    if (!inb(x, y)) return true;
    const i = idx(x, y);
    if (body[i]) continue;
    if (pcls(x, y) >= 1) return true;
    // loose snow over firm snow within the tamp depth: the object stands on the surface and the tamp (place) holds it, instead of sinking to the firm layer
    if (mat[i] === M.SNOW && padFirm(x, y)) return true;
  }
  return false;
}
/** the loose snow the tamp will consolidate under the object (for the support test: it is rigid once placed) */
function padCells(x0: number, yb: number, w: number): { x: number; y: number; m: number; d: number; b: number }[] {
  const out: { x: number; y: number; m: number; d: number; b: number }[] = [];
  for (let x = x0; x < x0 + w; x++) {
    if (!padFirm(x, yb)) continue;
    for (let y = yb; y < yb + TAMP_DEPTH; y++) {
      if (!inb(x, y)) break;
      const i = idx(x, y);
      if (mat[i] !== M.SNOW || body[i]) break;
      if (pcls(x, y) === 0) out.push({ x, y, m: M.SNOW, d: TAMP_DENS, b: TAMP_BOND });
    }
  }
  return out;
}
/** Auto-snap: out of firm terrain it overlaps (up to 8 cells up), then DOWN onto the first support within 9 cells (loose snow on the way is displaced).
 *  A horizontal beam therefore lands flush on the highest post / wall top below it, a post stands on the surface. Returns the snapped top row. */
function snapY(x0: number, y0: number, w: number, h: number): number {
  let y = y0;
  if (!fitsAt(x0, y, w, h)) {
    let ok = false;
    for (let k = 1; k <= 8; k++) if (fitsAt(x0, y - k, w, h)) { y -= k; ok = true; break; }
    if (!ok) return y0;
  }
  for (let d = 0; d <= 9; d++) {
    if (!fitsAt(x0, y + d, w, h)) break;
    if (restsAt(x0, y + d, w, h)) return y + d;
  }
  return y;
}
/** Gap fill: the beam lands on its highest support, but a post under another part of it can sit 1-4 rows lower (loose snow under that post sank).
 *  The air or loose snow between the beam's bottom and such a post is packed with snow, so every post carries the beam. Only posts / doors count (not a snow ledge). */
const GAP_MAX = 4;
function gapFill(x0: number, yb: number, w: number): { x: number; y: number; m: number; d: number; b: number }[] {
  const out: { x: number; y: number; m: number; d: number; b: number }[] = [];
  for (let x = x0; x < x0 + w; x++) {
    for (let k = 0; k <= GAP_MAX; k++) {
      const y = yb + k;
      if (!inb(x, y)) break;
      const i = idx(x, y);
      if (!body[i] && (mat[i] === M.PLANK || mat[i] === M.DOOR)) { for (let j = 0; j < k; j++) out.push({ x, y: yb + j, m: M.SNOW, d: 380, b: 175 }); break; }
      if (pcls(x, y) !== 0) break; // the gap must be air or loose snow
    }
  }
  return out;
}
export function ghostCells(kind: 'block' | 'beam', ax: number, ay: number) {
  let w: number, h: number, door = false;
  if (kind === 'block') { const vert = tool.rot % 2 === 1; w = vert ? 5 : 10; h = vert ? 10 : 5; }
  else { const bs = beamShape(); w = bs.vert ? 4 : bs.len; h = bs.vert ? bs.len : 4; door = bs.door; }
  const x0 = Math.round(ax - w / 2);
  const y0 = snapY(x0, Math.round(ay - h / 2), w, h);
  const cells: { x: number; y: number; m: number; d: number; b: number }[] = [];
  let hard = 0, firm = 0;
  const why = new Map<string, number>();
  const bump = (k: string) => why.set(k, (why.get(k) ?? 0) + 1);
  const cm = kind === 'block' ? M.SNOW : door ? M.DOOR : M.PLANK;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const c = pcls(x, y);
    if (c === 2) {
      hard++;
      if (!inb(x, y)) bump('край мира');
      else if (body[idx(x, y)]) bump('упавшее бревно');
      else bump(MAT_NAME[mat[idx(x, y)]] ?? 'твёрдое');
    } else if (c === 1) firm++;
    if (inb(x, y)) cells.push({ x, y, m: cm, d: kind === 'block' ? (inv.blocks[inv.blocks.length - 1] ?? 300) : 500, b: kind === 'block' ? 170 : 0 });
  }
  if (kind === 'beam') cells.push(...gapFill(x0, y0 + h, w)); // packed snow under a beam, between it and a lower post
  let blocked = hard > 0;
  if (!blocked && firm > Math.floor(w * h * 0.05)) { blocked = true; bump('плотный снег'); }
  // the player's own body (a door is passable)
  const px0 = pl.x - 5, px1 = pl.x + 5, py0 = pl.y - pl.h, py1 = pl.y;
  let reason = '';
  if (!door && x0 < px1 && x0 + w > px0 && y0 < py1 && y0 + h > py0) { blocked = true; reason = 'ты стоишь на этом месте — отойди'; }
  else if (blocked) { let bk = '', bn = 0; for (const [k, n] of why) if (n > bn) { bn = n; bk = k; } reason = `${bk} (${Math.max(1, Math.round(((hard || firm) * 100) / (w * h)))}% места)`; }
  return { cells, pad: padCells(x0, y0 + h, w), blocked, x0, y0, w, h, reason, door };
}
let marginCache = { key: '', v: 1 };
export function ghostMargin(kind: 'block' | 'beam', ax: number, ay: number) {
  const g = ghostCells(kind, ax, ay);
  const key = kind + g.x0 + ',' + g.y0 + ',' + tool.rot + ',' + (G.frame >> 3);
  if (marginCache.key !== key) { marginCache = { key, v: g.blocked ? 0 : supportMargin([...g.cells, ...g.pad]) }; }
  // a block with no support would crumble: the ghost goes red with the reason (place() refuses it the same way)
  if (kind === 'block' && !g.blocked && marginCache.v <= 0.02) return { ...g, blocked: true, reason: 'Нет опоры', margin: 0 };
  return { ...g, margin: marginCache.v };
}

/** Foundation: whatever is placed on loose snow tamps the 6 cells beneath it so posts neither crumble nor sink. */
const TAMP_DEPTH = 6, TAMP_DENS = 300, TAMP_BOND = 120;
function tamp(x0: number, yb: number, w: number) {
  for (let x = x0; x < x0 + w; x++) {
    for (let y = yb; y < yb + TAMP_DEPTH; y++) {
      if (!inb(x, y)) break;
      const i = idx(x, y);
      if (mat[i] !== M.SNOW || body[i]) break; // only the unbroken snow directly under the object
      if (dens[i] < TAMP_DENS) dens[i] = TAMP_DENS;
      if (bond[i] < TAMP_BOND) bond[i] = TAMP_BOND;
      wake(x, y);
    }
  }
}

/** Blocks laid in the last LAID_WATCH seconds: if the solver lets one go inside that window, it goes back into the pack. */
const LAID_WATCH = 2;
const laid: { x0: number; y0: number; w: number; h: number; d: number; age: number }[] = [];
/** per frame (from stepFires): a fresh block whose cells are no longer rigid snow is refunded; after LAID_WATCH s it is kept for good */
export function watchLaid(dt: number) {
  for (let k = laid.length - 1; k >= 0; k--) {
    const l = laid[k];
    l.age += dt;
    if (l.age > LAID_WATCH) { laid.splice(k, 1); continue; }
    let rigid = 0;
    for (let y = l.y0; y < l.y0 + l.h; y++) for (let x = l.x0; x < l.x0 + l.w; x++) {
      if (!inb(x, y)) continue; const i = idx(x, y);
      if (mat[i] === M.SNOW && !body[i] && rigidAt(i)) rigid++;
    }
    if (rigid < l.w * l.h * 0.6) { laid.splice(k, 1); inv.blocks.push(l.d); say('Блок осыпался — вернул в запас'); sfx?.uiDeny(); }
  }
}

function place(kind: 'block' | 'beam', ax: number, ay: number) {
  if (kind === 'block' && inv.blocks.length === 0) { say('Нет снежных блоков. Вырежи пилой из плотного наста'); sfx?.uiDeny(); return; }
  if (kind === 'beam' && inv.logs < 1) { say('Нет брёвен. Свали ель топором'); sfx?.uiDeny(); return; }
  const g = ghostCells(kind, ax, ay);
  if (g.blocked) { say(`Мешает: ${g.reason}${kind === 'block' && !g.reason.startsWith('ты') ? '. Блок кладут на ровное место или на другой блок' : ''}`); sfx?.uiDeny(); return; }
  const bs = beamShape();
  const vert = bs.vert;
  if (kind === 'beam' && inv.logs < bs.logs) { say(`Для бруса 2 м нужно ${bs.logs} ${plural(bs.logs, 'бревно', 'бревна', 'брёвен')}. R: сменить длину`); sfx?.uiDeny(); return; }
  const door = kind === 'beam' && bs.door;
  // a beam or a block needs a path to the ground or a post, or it hangs and crumbles (the ghost shows the same verdict)
  if (supportMargin([...g.cells, ...g.pad]) <= 0.02) { say(kind === 'beam' ? 'Повиснет и упадёт — нужна опора' : 'Нет опоры: блок повиснет. Клади на снег или на другой блок'); sfx?.uiDeny(); return; }
  const d = kind === 'block' ? inv.blocks.pop()! : 500;
  const bid = kind === 'beam' ? nextBeamId() : 0;
  for (const c of g.cells) {
    const i = idx(c.x, c.y);
    if (mat[i] === M.SNOW || mat[i] === M.ASH) { // displace loose snow upward; it comes to rest loose (bond 0, under the firm density), never as a firm cell on a post top
      let y = c.y - 1; while (y > 0 && mat[idx(c.x, y)] !== M.AIR) y--;
      if (y > g.y0 - 12 && y > 0) set(c.x, y, mat[i], Math.min(dens[i], 400), 0, F_DIST);
    }
    if (c.m === M.SNOW) set(c.x, c.y, M.SNOW, kind === 'block' ? d : c.d, kind === 'block' ? 175 : c.b, F_DIST | (kind === 'block' ? F_BLOCK : 0)); // block cells, or packed gap fill under a beam
    else { set(c.x, c.y, door ? M.DOOR : M.PLANK, 500, 0, vert ? F_VERT : 0); beamId[i] = bid; }
  }
  if (kind === 'block') laid.push({ x0: g.x0, y0: g.y0, w: g.w, h: g.h, d, age: 0 });
  if (kind === 'beam') inv.logs -= bs.logs;
  tamp(g.x0, g.y0 + g.h, g.w);
  if (kind === 'beam') freshBeam(bid, g.x0, g.y0, g.x0 + g.w, g.y0 + g.h);
  sfx?.place(kind === 'beam');
  tool.cool = 0.25;
  pl.stamina -= 0.03;
  markStruct(g.x0 - 2, g.y0 - 2, g.x0 + g.w + 2, g.y0 + g.h + 6); // +6: the gap fill reaches 4 rows below the beam
  tool.built.add(kind === 'beam' ? 'wood' : 'snow');
}

// ---------------- axe ----------------
export const isTrunkOf = (i: number, tid: number) => mat[i] === M.WOOD && (flags[i] & F_TREE) !== 0 && treeId[i] === tid && body[i] === 0;
const isTreeOf = (i: number, tid: number) => (mat[i] === M.WOOD || mat[i] === M.NEEDLE) && (flags[i] & F_TREE) !== 0 && treeId[i] === tid && body[i] === 0;
/** Trunk cells of tree `tid` in row y near column cx, left to right. */
export function trunkRow(y: number, cx: number, tid: number): number[] {
  const xs: number[] = [];
  if (y < 0 || y >= H) return xs;
  for (let x = Math.max(0, cx - 10); x <= Math.min(W - 1, cx + 10); x++) if (isTrunkOf(idx(x, y), tid)) xs.push(x);
  return xs;
}
/** Flood the tree `tid` (trunk + needles, that tree only) from a seed, never below row `maxRow`. Trunk-only when `trunkOnly`. */
function treeCells(seed: number, tid: number, maxRow: number, trunkOnly = false): number[] {
  const out: number[] = []; const seen = new Set<number>();
  const st = [seed];
  while (st.length && out.length < 9000) {
    const i = st.pop()!; if (seen.has(i)) continue; seen.add(i);
    if (!(trunkOnly ? isTrunkOf(i, tid) : isTreeOf(i, tid))) continue;
    if (((i / W) | 0) > maxRow) continue;
    out.push(i);
    const x = i % W;
    if (x > 0) st.push(i - 1); if (x < W - 1) st.push(i + 1); if (i >= W) st.push(i - W); if (i + W < W * H) st.push(i + W);
  }
  return out;
}
function dismantleBeam(i0: number, cx: number, cy: number) {
  const bid = beamId[i0];
  const cap = bid ? 600 : 80; // untracked planks (re-formed from debris): bounded search
  const st = [i0]; const seen = new Set<number>(); const cells: number[] = [];
  while (st.length && cells.length < cap) {
    const i = st.pop()!; if (seen.has(i)) continue; seen.add(i);
    if ((mat[i] !== M.PLANK && mat[i] !== M.DOOR) || body[i] || beamId[i] !== bid) continue;
    cells.push(i);
    const x = i % W;
    if (x > 0) st.push(i - 1); if (x < W - 1) st.push(i + 1); if (i >= W) st.push(i - W); if (i + W < W * H) st.push(i + W);
  }
  for (const i of cells) set(i % W, (i / W) | 0, M.AIR);
  const logs = Math.max(1, Math.round(cells.length / 80));
  inv.logs += logs; sfx?.chop(true); tool.cool = 0.4;
  say(`+${logs} ${plural(logs, 'бревно', 'бревна', 'брёвен')}`);
  markStruct(cx - 30, cy - 30, cx + 30, cy + 30);
}
let notchTid = -1, notchY = -1, notchTotal = 0; // standing tree being notched: its band size before the first hit
function chop(ax: number, ay: number) {
  let cx = Math.round(ax), cy = Math.round(ay);
  // fallen tree / beam body?
  for (let r = 0; r <= 3; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (!inb(cx + dx, cy + dy)) continue;
    const i = idx(cx + dx, cy + dy);
    if (body[i]) {
      const rec = bodyAtIndex(i);
      if (rec && (rec.kind === 'tree' || rec.kind === 'beam' || rec.kind === 'debris')) {
        rec.hits++;
        sfx?.chop(true);
        for (let k = 0; k < 4; k++) spawn(PK.CHIP, ax, ay, (Math.random() - 0.5) * 60, -30 - Math.random() * 40, 2, 1, 0, 0);
        pl.stamina -= 0.04; tool.cool = 0.42;
        let wood = 0, ndl = 0;
        for (let k = 0; k < rec.lm.length; k++) { if (rec.lm[k] === M.WOOD || rec.lm[k] === M.PLANK) wood++; else if (rec.lm[k] === M.NEEDLE) ndl++; }
        const need = Math.max(2, Math.round(wood / 160));
        if (rec.hits >= need) {
          const logs = Math.max(1, Math.round(wood / 80));
          const br = Math.round(ndl / 140) + (rec.kind === 'tree' ? 2 : 0);
          inv.logs += logs; inv.branches += br;
          removeBody(rec, false);
          say(`+${logs} ${plural(logs, 'бревно', 'бревна', 'брёвен')}${br ? `, +${br} ${plural(br, 'хворост', 'хвороста', 'хвороста')}` : ''}`);
          sfx?.pickup();
        } else say(`Разделка: ${rec.hits}/${need}`);
        return;
      }
    }
  }
  let i0 = inb(cx, cy) ? idx(cx, cy) : -1;
  if (i0 < 0) return;
  const m0 = mat[i0];
  if ((m0 === M.PLANK || m0 === M.DOOR) && !body[i0]) { dismantleBeam(i0, cx, cy); return; }
  if (m0 === M.NEEDLE && (flags[i0] & F_TREE)) {
    // cut a few branches for kindling
    let n = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { if (!inb(cx + dx, cy + dy)) continue; const i = idx(cx + dx, cy + dy); if (mat[i] === M.NEEDLE) { set(cx + dx, cy + dy, M.AIR); n++; } }
    if (n > 8) { inv.branches += 1; say('+1 хворост'); }
    sfx?.chop(false); tool.cool = 0.35; pl.stamina -= 0.015; return;
  }
  if (m0 !== M.WOOD || !(flags[i0] & F_TREE)) {
    // the aimed cell may just have been cut away: keep working on the nearest trunk cell of the same notch
    let best = -1, bd = 1e9;
    if (m0 === M.AIR || m0 === M.SNOW) {
      for (let r = 0; r <= 3 && best < 0; r++) for (const dy of r === 0 ? [0] : [-r, r]) { // same row first, then neighbouring rows
        const y = cy + dy; if (y < 0 || y >= H) continue;
        for (let dx = -8; dx <= 8; dx++) {
          if (!inb(cx + dx, y)) continue;
          const j = idx(cx + dx, y), dd = Math.abs(dx);
          if (dd < bd && mat[j] === M.WOOD && (flags[j] & F_TREE) && !body[j]) { bd = dd; best = j; }
        }
        bd = 1e9;
      }
    }
    if (best < 0) { sfx?.chop(false); tool.cool = 0.4; return; }
    i0 = best; cx = best % W; cy = (best / W) | 0;
  }

  // ---- notch the trunk: each hit removes a 3-row slice across a few columns, from the player's side ----
  const tid = treeId[i0];
  const hitRow = trunkRow(cy, cx, tid);
  if (!hitRow.length) { sfx?.chop(false); tool.cool = 0.4; say('Руби по стволу'); return; }
  const xc = (hitRow[0] + hitRow[hitRow.length - 1]) / 2;
  if (Math.abs(xc - pl.x) < 1.5) { tool.cool = 0.4; say('Руби с другой стороны'); sfx?.chop(false); return; } // standing in line with the trunk
  const away = xc > pl.x ? 1 : -1;               // the tree falls away from the player; the notch is on the player's side
  // notch progress: trunk cells in the 3-row band now vs at the first hit on this tree (a new tree or a new height starts from its own count)
  let bandBefore = 0;
  for (let dy = -1; dy <= 1; dy++) bandBefore += trunkRow(cy + dy, cx, tid).length;
  if (notchTid !== tid || Math.abs(notchY - cy) > 3) { notchTid = tid; notchY = cy; notchTotal = bandBefore; }
  for (let dy = -1; dy <= 1; dy++) {
    const y = cy + dy, xs = trunkRow(y, cx, tid);
    if (!xs.length) continue;
    const d = Math.min(xs.length, xs.length <= 4 ? 1 : 2);
    for (let k = 0; k < d; k++) set(away > 0 ? xs[k] : xs[xs.length - 1 - k], y, M.AIR);
  }
  const sideX = away > 0 ? hitRow[0] : hitRow[hitRow.length - 1];
  for (let k = 0; k < 5; k++) spawn(PK.CHIP, sideX, cy, (Math.random() - 0.5) * 70 - away * 20, -20 - Math.random() * 40, 2.5, 1, 0, 0);
  sfx?.chop(true);
  pl.stamina -= 0.035; tool.cool = 0.4;
  // severed? every row of the 3-row band must be cut through
  let left = 0;
  for (let dy = -1; dy <= 1; dy++) left += trunkRow(cy + dy, cx, tid).length;
  if (left > 0) {
    const pct = Math.max(1, Math.min(99, Math.round(((notchTotal - left) / Math.max(1, notchTotal)) * 100)));
    say(`Подруби ещё (${pct}%)`); return;
  }
  // trunk above the band (this tree only)
  let seed = -1;
  for (let y = cy - 2; y >= Math.max(0, cy - 12) && seed < 0; y--) { const xs = trunkRow(y, cx, tid); if (xs.length) seed = idx(xs[0], y); }
  if (seed < 0) { say('Пень. Ствол выше уже спилен'); markStruct(cx - 20, cy - 20, cx + 20, cy + 20); return; }
  const bandBottom = cy + 1;
  // grounded = this tree's trunk still reaches a trunk cell below the band (never true after a full cut)
  const trunk = treeCells(seed, tid, H, true);
  let grounded = false;
  for (const i of trunk) if (((i / W) | 0) > bandBottom) { grounded = true; break; }
  if (grounded) { say('Подрубай ниже, у самого ствола'); return; }
  const top = treeCells(seed, tid, bandBottom);   // trunk + boughs above the cut, this tree only
  sfx?.treeCreak();
  // snow resting on the boughs loses support → it will fall as granular snow
  for (const i of top) { const a = i - W; if (a >= 0 && mat[a] === M.SNOW) { bond[a] = 0; flags[a] |= F_DIST; wake(a % W, (a / W) | 0); } }
  const rec = makeBody(top, 'tree', away * 0.3, 0, away * 0.3);
  if (rec) say('Дерево падает!');
  else { for (const i of top) set(i % W, (i / W) | 0, M.AIR); say('Верхушка рассыпалась'); }
  markStruct(cx - 20, cy - 20, cx + 20, cy + 20);
}

// ---------------- fire ----------------
export function placeFire(ax: number, ay: number) {
  if (inv.matches < 1) { say('Нет спичек'); sfx?.uiDeny(); return; }
  if (inv.logs < 1 || inv.branches < 2) { say('Для костра нужно 1 бревно и 2 хвороста'); sfx?.uiDeny(); return; }
  // settle onto the surface below the aim
  // exactly where aimed; only if the aim is inside the body (< 6 cells from the centre) step 8 cells along the facing direction
  let shifted = false;
  if (Math.abs(ax - pl.x) < 6) { ax = pl.x + (Math.abs(ax - pl.x) > 1 ? Math.sign(ax - pl.x) : pl.face) * 8; ay = Math.min(ay, pl.y - 2); shifted = true; }
  let x = Math.round(ax), y = Math.round(ay);
  if (!inb(x, y)) return;
  if (shifted) for (let k = 0; k < 14 && y > 2 && mat[idx(x, y)] !== M.AIR && mat[idx(x, y)] !== M.NEEDLE; k++) y--; // the spot beside the body may be a step higher
  while (y < H - 2 && (mat[idx(x, y)] === M.AIR || mat[idx(x, y)] === M.NEEDLE)) y++;   // boughs are no ground
  if (Math.abs(y - ay) > 30 || !inReach(x, y)) { say('Слишком далеко'); return; }
  // one fire per clearing: a new one next to a burning fire is refused, feed the old one instead (feedFire via interact: E / «Взять»)
  if (G.fires.some((f) => Math.hypot(f.x - x, f.y - y) < 12)) { say('Рядом уже горит костёр — подбрось дров: E / «Взять»'); sfx?.uiDeny(); return; }
  inv.matches--; inv.logs--; inv.branches -= 2;
  G.fires.push({ x, y, fuel: 150, power: 0, lit: true, id: fireId++ });
  sfx?.ignite();
  say('Костёр горит. Подкидывай брёвна: «Взять» рядом с огнём');
  tool.built.add('fire');
}
export function feedFire(f: Fire): boolean {
  if (!f.lit) {
    // an unlit fire first needs relighting; never throw fuel on cold embers
    if (f.fuel <= 0) { say('Костёр прогорел'); return false; }
    if (inv.matches < 1) { say('Костёр потух. Нужна спичка, чтобы разжечь'); return false; }
    inv.matches--; f.lit = true; sfx?.ignite(); say('Костёр разожжён снова'); return true;
  }
  if (inv.logs > 0) { inv.logs--; f.fuel += 120; sfx?.place(true); say('+2 часа огня'); return true; }
  if (inv.branches > 0) { inv.branches--; f.fuel += 35; sfx?.place(true); say('+35 минут огня'); return true; }
  say('Нечем подкинуть: нужно бревно (+2 ч) или 2 хвороста (+35 мин)'); return false;
}
/** The campfire nearest to the hero's feet (cells), or null when none is burning or lit. */
export function nearestFire(): { f: Fire; d: number } | null {
  let best: { f: Fire; d: number } | null = null;
  for (const f of G.fires) { const d = Math.hypot(f.x - pl.x, f.y - pl.y); if (!best || d < best.d) best = { f, d }; }
  return best;
}
/** Beam shape index 0..4 as BEAM_MODE_NAMES lists it (R cycles it; blocks only toggle 0 / 1). */
function beamModeIndex(): number { return ((tool.rot % BEAM_MODES) + BEAM_MODES) % BEAM_MODES; }
/** Live readouts for the HUD: nearest fire, cut progress, beam shape name, shovel load in cells. */
export function toolHud() {
  const nf = nearestFire();
  return {
    fire: nf ? { fuel: nf.f.fuel, lit: nf.f.lit, d: nf.d, near: nf.d <= FEED_R } : null,
    sawP: sawProgress(),
    beamMode: BEAM_MODE_NAMES[beamModeIndex()].replace(' (проходимая)', ''),
    digP: DIG.key ? DIG.p : 0,   // shovel: progress of the tile being dug, 0..1
  };
}
export function stepFires(dt: number) {
  watchLaid(dt); // per-frame tool watch: blocks that crumble just after being laid
  tickSpoil(dt); // dug snow is thrown clear (the spoil bag)
  const gm = dt * G.timeScale; // game minutes
  for (let k = G.fires.length - 1; k >= 0; k--) {
    const f = G.fires[k];
    if (f.lit) {
      f.fuel -= gm;
      f.power = 4200 * Math.min(1, f.fuel / 30) * (0.85 + Math.random() * 0.3);
      if (f.fuel <= 0) { f.lit = false; f.power = 0; }
    }
    // sink: fire rests on whatever is below; melting snow under it lets it drop
    let support = false;
    for (let dx = -3; dx <= 3; dx++) { const i = idx(f.x + dx, f.y); if (inb(f.x + dx, f.y) && (mat[i] !== M.AIR && mat[i] !== M.WATER)) support = true; }
    if (!support && f.y < H - 4) f.y++;
    // water at the fire base sizzles and can drown it
    let water = 0;
    for (let dy = -2; dy <= 0; dy++) for (let dx = -4; dx <= 4; dx++) { if (inb(f.x + dx, f.y + dy) && mat[idx(f.x + dx, f.y + dy)] === M.WATER) water++; }
    if (f.lit && water > 0) {
      if (Math.random() < dt * 2) { sfx?.sizzle(); spawn(PK.STEAM, f.x, f.y - 3, 0, -10, 2, 1, 0, 0); }
      if (water > 14) { f.lit = false; f.power = 0; say('Костёр залило талой водой. Ставь его на брёвна'); }
      // evaporate some water
      for (let dx = -4; dx <= 4; dx++) { const i = idx(f.x + dx, f.y - 1); if (inb(f.x + dx, f.y - 1) && mat[i] === M.WATER && Math.random() < dt * 0.6) set(f.x + dx, f.y - 1, M.AIR); }
    }
    if (f.lit) {
      const q = G.quality ? 1 : 0.5;
      const pw = Math.min(1, f.fuel / 30);          // flames shrink as the fuel runs out
      const burst = (rate: number) => { const n = rate * dt * q; return Math.floor(n) + (Math.random() < n - Math.floor(n) ? 1 : 0); };
      // 3 licking tongues of flame with independent phase, each swaying on its own sinus (x1.5 bigger than before)
      const tt = G.realTime;
      for (let j = 0; j < 3; j++) {
        const ph = f.id * 1.7 + j * 2.3;
        const sway = Math.sin(tt * (2.6 + j * 0.9) + ph);
        const lick = 0.78 + 0.32 * Math.sin(tt * (4.1 + j * 1.3) + ph * 1.3);
        const cx = f.x + (j - 1) * 4.6 + sway * 2.4;
        const big = j === 1 ? 1.15 : 0.9;
        for (let n = burst((j === 1 ? 42 : 29) * (0.5 + 0.5 * pw)); n > 0; n--) {
          spawn(PK.FLAME, cx + (Math.random() - 0.5) * 4.5, f.y - 1.5 - Math.random() * 3, sway * 9 + (Math.random() - 0.5) * 7, -(30 + Math.random() * 34) * lick * (0.6 + 0.4 * pw), 0.5 + Math.random() * 0.5, (1.95 + Math.random() * 1.2) * big * (0.6 + 0.4 * pw), 0, 0);
        }
      }
      // glowing embers bed at the base (SPARK particles: bright orange, barely moving) and the odd flying spark
      for (let n = burst(14); n > 0; n--) spawn(PK.SPARK, f.x + (Math.random() - 0.5) * 12, f.y - 0.5 - Math.random() * 2, (Math.random() - 0.5) * 6, -4 - Math.random() * 8, 0.35 + Math.random() * 0.45, 2.2 + Math.random() * 1.2, 0, 0);
      for (let n = burst(6); n > 0; n--) spawn(PK.SPARK, f.x + (Math.random() - 0.5) * 8, f.y - 8, (Math.random() - 0.5) * 36, -45 - Math.random() * 50, 1.0 + Math.random() * 0.9, 1, 0, 0);
      // smoke column
      for (let n = burst(9); n > 0; n--) spawn(PK.SMOKE, f.x + (Math.random() - 0.5) * 6, f.y - 14 - Math.random() * 6, (Math.random() - 0.5) * 8, -14 - Math.random() * 6, 4 + Math.random() * 3, 1 + Math.random() * 0.8, 0, 0);
    }
    if (!f.lit && f.fuel <= 0 && f.power === 0) { // burned out: leave ash
      for (let dx = -3; dx <= 3; dx++) if (inb(f.x + dx, f.y - 1) && mat[idx(f.x + dx, f.y - 1)] === M.AIR) set(f.x + dx, f.y - 1, M.ASH, 300, 0, 0);
      G.fires.splice(k, 1);
    }
  }
}

// ---------------- interact / eat ----------------
const CRATE_REACH = 6;
/** Snow cells on the best straight line from the hero (chest or feet) to the crate lid (left/middle/right); 0 = clear air path. */
function snowToLid(c: { x: number; y: number; w: number }): number {
  let best = 1e9;
  const ys = [pl.y - 20, pl.y - 4];
  for (const sy of ys) for (const tx of [c.x + 1, c.x + (c.w >> 1), c.x + c.w - 2]) {
    const sx = pl.x;
    const n = Math.max(1, Math.ceil(Math.hypot(tx - sx, c.y - 1 - sy)));
    let sn = 0, last = -1;
    for (let k = 0; k <= n; k++) {
      const x = Math.round(sx + ((tx - sx) * k) / n), y = Math.round(sy + ((c.y - 1 - sy) * k) / n);
      if (!inb(x, y)) continue;
      const i = idx(x, y), key = y * W + x;
      if (key === last) continue; last = key;
      if (mat[i] === M.SNOW || mat[i] === M.ASH) sn++;
      else if (mat[i] !== M.AIR && mat[i] !== M.NEEDLE && mat[i] !== M.CRATE && mat[i] !== M.POLE) sn += 2; // ground/ice in the way counts as digging too
    }
    if (sn < best) best = sn;
  }
  return best;
}
export function interact(): boolean {
  // fire nearby?
  // (if feeding is not possible, fall through to crates / loose logs; feedFire leaves its reason in tool.msg)
  tool.msg = '';
  const nf = nearestFire();
  if (nf && nf.d <= FEED_R && feedFire(nf.f)) return true;
  const nearMiss = !!nf && nf.d <= FIRE_NEAR_R;   // a fire within 4 m but beyond the 2 m feed radius: say how close to come
  // crate nearby (player body box within 6 cells of the crate box AND an air path to the lid)?
  let buried = -1; // cm of digging still needed to the nearest crate that is close but under snow
  for (const c of crates) {
    if (c.opened) continue;
    const dx = Math.max(c.x - (pl.x + 5), 0, (pl.x - 5) - (c.x + c.w)), dy = Math.max(c.y - pl.y, 0, (pl.y - pl.h) - (c.y + c.h));
    if (dx <= CRATE_REACH && dy <= CRATE_REACH) {
      const sn = snowToLid(c);
      if (sn > 0) { const cm = Math.max(5, Math.round((sn * CELL * 100) / 5) * 5); if (buried < 0 || cm < buried) buried = cm; continue; }
    }
    if (!(dx <= CRATE_REACH && dy <= CRATE_REACH)) {
      if (dx < 20 && dy < 70 && pl.y < c.y) { // above the crate with snow between
        const sn = snowToLid(c);
        if (sn > 0) { const cm = Math.max(5, Math.round((sn * CELL * 100) / 5) * 5); if (buried < 0 || cm < buried) buried = cm; }
      }
      continue;
    }
    {
      c.opened = true; sfx?.crateOpen();
      const got: string[] = [];
      for (const l of c.loot) {
        if (l === 'food') { inv.food++; got.push('консервы'); }
        else if (l === 'crackers') { inv.crackers++; got.push('сухари'); }
        else if (l === 'matches') { inv.matches += 4; got.push('спички ×4'); }
        else if (l === 'thermos') { inv.thermos++; got.push('термос с чаем'); }
        else if (l === 'saw') { inv.saw = true; inv.matches += 2; got.push('спички ×2'); }
        else if (l === 'snowshoes') { inv.snowshoes = true; pl.snowshoes = true; got.push('снегоступы (надеты)'); }
      }
      // crate becomes an open empty box: remove its lid cells
      for (let x = c.x; x < c.x + c.w; x++) { const i = idx(x, c.y); if (mat[i] === M.CRATE) set(x, c.y, M.AIR); }
      say('В ящике: ' + got.join(', '));
      return true;
    }
  }
  if (buried > 0) { say(`Ящик под снегом: докопай ещё ~${buried} см вниз`); return false; }
  // pick up loose logs (beam bodies) nearby
  for (const rec of bodies.values()) {
    if (rec.kind !== 'beam' && rec.kind !== 'debris') continue;
    const p = rec.b.getPosition();
    if (Math.hypot(p.x * 20 - pl.x, p.y * 20 - (pl.y - 10)) < 26) {
      let wood = 0; for (let k = 0; k < rec.lm.length; k++) if (rec.lm[k] === M.WOOD || rec.lm[k] === M.PLANK) wood++;
      if (wood > 10) { inv.logs += Math.max(1, Math.round(wood / 80)); removeBody(rec, false); sfx?.pickup(); say('Подобрал брёвна'); return true; }
    }
  }
  if (!tool.msg) say(nearMiss ? 'Подойди ближе к костру (до 2 м)' : 'E: открыть ящик, подбросить в костёр, подобрать брёвна — рядом ничего нет');
  return false;
}
export function eat(): boolean {
  if (inv.thermos > 0 && pl.core < 36.5) { inv.thermos--; pl.core = Math.min(37, pl.core + 1.2); pl.food = Math.min(1, pl.food + 0.05); sfx?.eat(); say('Горячий чай: +1.2 °C'); return true; }
  if (pl.food > 0.92) { say('Пока не голоден'); return false; }
  if (inv.food > 0) { inv.food--; pl.food = Math.min(1, pl.food + 450 / 2000); sfx?.eat(); say('Консервы: +450 ккал'); return true; }
  if (inv.crackers > 0) { inv.crackers--; pl.food = Math.min(1, pl.food + 250 / 2000); sfx?.eat(); say('Сухари: +250 ккал'); return true; }
  if (inv.thermos > 0) { inv.thermos--; pl.core = Math.min(37, pl.core + 1.2); sfx?.eat(); return true; }
  say('Еды нет. Ищи ящики под оранжевыми вешками'); sfx?.uiDeny(); return false;
}

// ---------------- dispatch ----------------
let fireLatch = false;   // set by a fire click, released by idleTool (button up)
let placeLatch = false;  // same for beam / block: one placement per press, however long LMB is held
export function usePrimary(ax: number, ay: number, dt: number, moveX = 0) {
  tool.cool -= dt;
  const [x, y] = reachPoint(ax, ay);
  const id = TOOLS[tool.cur].id;
  if (id === 'saw') { if (tool.cool <= 0) saw(x, y, dt); return; }
  if (id === 'shovel') { shovelDig(ax, ay, dt, moveX); return; }
  if (tool.cool > 0) return;
  if (pl.stamina < 0.03) { say('Нет сил. Передохни'); tool.cool = 0.5; return; }
  if (id === 'axe') chop(x, y);
  else if (id === 'beam') { if (placeLatch) return; placeLatch = true; place('beam', x, y); }
  else if (id === 'block') { if (placeLatch) return; placeLatch = true; place('block', x, y); }
  else if (id === 'fire') { if (fireLatch) return; fireLatch = true; placeFire(x, y); tool.cool = 0.6; } // one fire per press
}
export function useSecondary(ax: number, ay: number) {
  const [x, y] = reachPoint(ax, ay);
  const id = TOOLS[tool.cur].id;
  if (id === 'shovel') { shovelTamp(ax, ay); }
  else if (id === 'saw' || id === 'block') place('block', x, y);
  else if (id === 'beam' || id === 'axe') place('beam', x, y);
  else if (id === 'fire') placeFire(x, y);
}
export function idleTool(dt: number) { fireLatch = false; placeLatch = false; DIG.key = ''; DIG.p = 0; tool.cool -= dt; tool.sawT = Math.max(0, tool.sawT - dt * 0.25); }
export { CELL };
