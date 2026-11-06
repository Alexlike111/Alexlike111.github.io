// Falling clusters (translation only) and toppling trees (rotating sprite).
import { W, H, mat, aux, shade, flags, setCell, wakeRect, edited, F_TREE, F_PLACED } from './grid';
import { MAT, MATS, WALK, PHASE, P_LIQUID, P_GAS, P_FIRE } from '../content/materials';
import { throwCell, spawnFx, burstFx, cellColor } from './particles';
import { G } from '../game/state';
import type { View } from '../game/state';

export interface Cluster {
  id: number; n: number;
  ox: Int16Array; oy: Int16Array;          // cell offsets from the bbox top-left
  m: Uint8Array; a: Uint8Array; s: Uint8Array; f: Uint8Array;
  w: number; h: number; occ: Uint8Array;   // bbox size + occupancy bitmap (w*h)
  x: number; y: number;                    // world position (cells, float) of the bbox top-left
  vx: number; vy: number;
  mass: number; fragile: number;           // fragile = fraction of cells that shatter on a hard landing
  skinB: Int32Array; skinL: Int32Array; skinR: Int32Array; // cell indices on the bottom / left / right silhouette
  sprite: CanvasImageSource | null;
  age: number; alive: boolean;
}
export const clusters: Cluster[] = [];
export interface Impact { x: number; y: number; mass: number; speed: number }
const impactList: Impact[] = [];

const GRAV = 135, VMAX = 420, SHATTER_SPEED = 115;
const FRAGILE = new Uint8Array(256);
for (const k of ['PACKED', 'SNOWBLOCK', 'ICE', 'GLASS'] as const) FRAGILE[MAT[k]] = 1;
const SNOWY = new Uint8Array(256);
for (const k of ['PACKED', 'SNOWBLOCK'] as const) SNOWY[MAT[k]] = 1;

let rs = 24681357;
const rnd = () => { rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5; return (rs >>> 0) / 4294967296; };

function makeCanvas(w: number, h: number): (HTMLCanvasElement | OffscreenCanvas) | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return null;
}
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

let nextId = 1;
const treeFns: ((x: number, y: number, logs: number, boughs: number) => void)[] = [];
export function onTreeLanded(fn: (x: number, y: number, logs: number, boughs: number) => void) { treeFns.push(fn); }

// ---------------------------------------------------------------- clusters
/** Remove the given grid cells (indices) from the world and turn them into one falling cluster. */
export function makeCluster(cellIdx: ArrayLike<number>, vx = 0, vy = 0): Cluster | null {
  const cnt = cellIdx.length;
  if (cnt === 0) return null;
  let x0 = W, y0 = H, x1 = -1, y1 = -1, n = 0;
  for (let k = 0; k < cnt; k++) {
    const i = cellIdx[k];
    if (mat[i] === 0) continue;
    const x = i % W, y = (i / W) | 0;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    n++;
  }
  if (n === 0) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const c: Cluster = {
    id: nextId++, n, ox: new Int16Array(n), oy: new Int16Array(n), m: new Uint8Array(n), a: new Uint8Array(n), s: new Uint8Array(n), f: new Uint8Array(n),
    w, h, occ: new Uint8Array(w * h), x: x0, y: y0, vx, vy, mass: n, fragile: 0,
    skinB: new Int32Array(0), skinL: new Int32Array(0), skinR: new Int32Array(0), sprite: null, age: 0, alive: true,
  };
  let j = 0, fr = 0;
  for (let k = 0; k < cnt; k++) {
    const i = cellIdx[k], m = mat[i];
    if (m === 0) continue;
    const x = i % W, y = (i / W) | 0;
    c.ox[j] = x - x0; c.oy[j] = y - y0; c.m[j] = m; c.a[j] = aux[i]; c.s[j] = shade[i]; c.f[j] = flags[i] & (F_PLACED | F_TREE);
    c.occ[(y - y0) * w + (x - x0)] = 1;
    if (FRAGILE[m]) fr++;
    mat[i] = 0; aux[i] = 0; flags[i] = 0;
    j++;
  }
  c.fragile = fr / n;
  // silhouettes
  const bot: number[] = [], lft: number[] = [], rgt: number[] = [];
  for (let k = 0; k < n; k++) {
    const x = c.ox[k], y = c.oy[k];
    if (y === h - 1 || !c.occ[(y + 1) * w + x]) bot.push(k);
    if (x === 0 || !c.occ[y * w + x - 1]) lft.push(k);
    if (x === w - 1 || !c.occ[y * w + x + 1]) rgt.push(k);
  }
  c.skinB = Int32Array.from(bot); c.skinL = Int32Array.from(lft); c.skinR = Int32Array.from(rgt);
  // sprite
  const cv = makeCanvas(w, h);
  if (cv) {
    const g = cv.getContext('2d') as Ctx2D | null;
    if (g) {
      for (let k = 0; k < n; k++) {
        const col = cellColor(c.m[k], c.s[k]);
        g.fillStyle = '#' + (col | 0x1000000).toString(16).slice(1);
        g.fillRect(c.ox[k], c.oy[k], 1, 1);
      }
      c.sprite = cv as CanvasImageSource;
    }
  }
  clusters.push(c);
  wakeRect(x0 - 2, y0 - 2, x1 + 2, y1 + 2, 90);
  edited(x0, y0, x1, y1);
  return c;
}

/** Is there a falling-cluster cell at this world cell? */
export function bodyCellAt(x: number, y: number): boolean {
  for (let k = 0; k < clusters.length; k++) {
    const c = clusters[k];
    const lx = x - Math.floor(c.x), ly = y - Math.floor(c.y);
    if (lx >= 0 && ly >= 0 && lx < c.w && ly < c.h && c.occ[ly * c.w + lx]) return true;
  }
  return false;
}

/** Does any falling cluster overlap the box (feet-centre x,y; w×h)? speed = its downward speed (cells/s). */
export function clusterHitsBox(x: number, y: number, w: number, h: number): { hit: boolean; speed: number } {
  const left = Math.floor(x - w / 2), right = Math.ceil(x + w / 2) - 1, top = Math.floor(y - h), bot = Math.ceil(y) - 1;
  for (let k = 0; k < clusters.length; k++) {
    const c = clusters[k];
    const cx = Math.floor(c.x), cy = Math.floor(c.y);
    if (right < cx || left >= cx + c.w || bot < cy || top >= cy + c.h) continue;
    const ax = Math.max(left, cx), bx = Math.min(right, cx + c.w - 1), ay = Math.max(top, cy), by = Math.min(bot, cy + c.h - 1);
    for (let yy = ay; yy <= by; yy++) for (let xx = ax; xx <= bx; xx++) {
      if (c.occ[(yy - cy) * c.w + (xx - cx)]) { hitSpeed.hit = true; hitSpeed.speed = Math.hypot(c.vx, c.vy); return hitSpeed; }
    }
  }
  hitSpeed.hit = false; hitSpeed.speed = 0;
  return hitSpeed;
}
const hitSpeed = { hit: false, speed: 0 };

function blocked(c: Cluster, skin: Int32Array, ix: number, iy: number, dx: number, dy: number): boolean {
  for (let k = 0; k < skin.length; k++) {
    const s = skin[k];
    const x = ix + c.ox[s] + dx, y = iy + c.oy[s] + dy;
    if (x < 0 || x >= W || y >= H) return true;
    if (y < 0) continue;
    if (WALK[mat[y * W + x]]) return true;
  }
  return false;
}

function inLiquid(c: Cluster, ix: number, iy: number): boolean {
  const s = c.skinB[(c.skinB.length >> 1)];
  const x = ix + c.ox[s], y = iy + c.oy[s] + 1;
  return y >= 0 && y < H && PHASE[mat[y * W + x]] === P_LIQUID;
}

function removeCluster(c: Cluster) {
  c.alive = false;
  const i = clusters.indexOf(c);
  if (i >= 0) clusters.splice(i, 1);
}

function land(c: Cluster, speed: number) {
  const ix = Math.floor(c.x), iy = Math.floor(c.y);
  impactList.push({ x: ix + c.w / 2, y: iy + c.h, mass: c.mass, speed });
  const hard = speed > SHATTER_SPEED && c.fragile > 0;
  if (speed > 40) {
    burstFx('dust', ix + c.w / 2, iy + c.h, Math.min(40, 4 + (c.mass >> 3)), 25 + speed * 0.2, 0.9, undefined);
    G.cam.shake = Math.max(G.cam.shake, Math.min(8, c.mass * 0.01 * speed * 0.02));
  }
  // find a placement where nothing solid/powder is overlapped (rise if needed)
  let up = 0;
  for (; up < 10; up++) {
    let ok = true;
    for (let k = 0; k < c.n && ok; k++) {
      const x = ix + c.ox[k], y = iy - up + c.oy[k];
      if (x < 0 || x >= W || y < 0 || y >= H) { ok = false; break; }
      const t = mat[y * W + x];
      if (WALK[t]) ok = false;
    }
    if (ok) break;
  }
  const oy0 = iy - up;
  for (let k = 0; k < c.n; k++) {
    const x = ix + c.ox[k], y = oy0 + c.oy[k];
    if (x < 1 || x >= W - 1 || y < 1 || y >= H - 1) continue;
    const i = y * W + x, m = c.m[k];
    if (hard && FRAGILE[m]) {
      const r = rnd();
      const svx = (rnd() - 0.5) * speed * 0.6, svy = -rnd() * speed * 0.25;
      if (SNOWY[m]) {
        if (r < 0.55) { throwCell(x, y, MAT.SNOW, 0, svx, svy); continue; }
        // else becomes loose snow in place
        displaceLiquid(i, x, y);
        mat[i] = MAT.SNOW; aux[i] = 0; flags[i] = 0; shade[i] = c.s[k];
        continue;
      }
      if (m === MAT.ICE && r < 0.55) { throwCell(x, y, MAT.ICE, c.a[k], svx, svy); continue; }
      if (m === MAT.GLASS) { spawnFx('chip', x, y, svx, svy, 0.7, 0xcfe6ee); continue; }
    }
    displaceLiquid(i, x, y);
    mat[i] = m; aux[i] = c.a[k]; flags[i] = c.f[k]; shade[i] = c.s[k];
  }
  removeCluster(c);
  wakeRect(ix - 3, oy0 - 3, ix + c.w + 3, oy0 + c.h + 3, 90);
  edited(ix, oy0, ix + c.w, oy0 + c.h);
}

/** A cell is about to be overwritten: a liquid there is thrown up instead of being destroyed. */
function displaceLiquid(i: number, x: number, y: number) {
  const t = mat[i];
  if (t !== 0 && (PHASE[t] === P_LIQUID)) throwCell(x, y - 1, t, aux[i], (rnd() - 0.5) * 40, -30 - rnd() * 40);
}

function stepCluster(c: Cluster, dt: number) {
  c.age += dt;
  let ix = Math.floor(c.x), iy = Math.floor(c.y);
  // gravity (water slows the fall)
  c.vy = Math.min(VMAX, c.vy + GRAV * dt);
  if (inLiquid(c, ix, iy)) { c.vy = Math.min(c.vy, 38); c.vx *= 0.92; }
  // vertical
  const ny = c.y + c.vy * dt;
  let steps = Math.floor(ny) - iy;
  let stopped = false;
  for (let s = 0; s < steps; s++) {
    if (blocked(c, c.skinB, ix, iy, 0, 1)) { stopped = true; break; }
    iy++;
  }
  if (stopped) { c.y = iy; const sp = c.vy; c.vy = 0; land(c, sp); return; }
  c.y = ny; // free fall
  // horizontal drift (kept tiny; initial vx from makeCluster)
  if (Math.abs(c.vx) > 0.01) {
    const nx = c.x + c.vx * dt;
    const sx = Math.floor(nx) - ix;
    const sk = sx > 0 ? c.skinR : c.skinL, dir = sx > 0 ? 1 : -1;
    for (let s = 0; s < Math.abs(sx); s++) {
      if (blocked(c, sk, ix, Math.floor(c.y), dir, 0)) { c.vx = 0; break; }
      ix += dir;
    }
    c.x = c.vx === 0 ? ix : nx;
    c.vx *= 0.995;
  }
  if (c.y > H + 40) { removeCluster(c); return; }
  // a cluster that has been alive very long without landing: stamp it where it is
  if (c.age > 30) land(c, 0);
}

// ---------------------------------------------------------------- toppling trees
interface Tree {
  sprite: CanvasImageSource | null; ox: number; oy: number;   // sprite top-left in world cells
  px: number; py: number;                                     // pivot (base) in world cells
  dir: 1 | -1; ang: number; omega: number; len: number;
  logs: number; boughs: number; age: number;
  crown: Int32Array; nCrown: number;                          // sample points (relative to pivot, rotation-0 frame) for snow shakes
  alive: boolean;
}
const trees: Tree[] = [];
export function toppling(): readonly Tree[] { return trees; }

/** Capture the connected tree around (x,y) (F_TREE cells), remove it from the grid and topple it towards dir. */
export function fellTree(x: number, y: number, dir: 1 | -1): boolean {
  // find a start cell: the given cell or the nearest tree cell within 3
  let start = -1;
  for (let r = 0; r <= 3 && start < 0; r++) {
    for (let dy = -r; dy <= r && start < 0; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const i = yy * W + xx;
      if ((flags[i] & F_TREE) && mat[i] !== 0) { start = i; break; }
    }
  }
  if (start < 0) return false;
  // BFS over F_TREE cells (8-connected)
  const list: number[] = [start];
  const seen = new Set<number>([start]);
  for (let h = 0; h < list.length && list.length < 20000; h++) {
    const i = list[h], cx = i % W, cy = (i / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const xx = cx + dx, yy = cy + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const j = yy * W + xx;
      if (seen.has(j) || !(flags[j] & F_TREE) || mat[j] === 0) continue;
      seen.add(j); list.push(j);
    }
  }
  let x0 = W, y0 = H, x1 = -1, y1 = -1, trunk = 0, needles = 0, baseY = -1;
  for (const i of list) {
    const cx = i % W, cy = (i / W) | 0;
    if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
    if (mat[i] === MAT.NEEDLES) needles++; else { trunk++; if (cy > baseY) baseY = cy; }
  }
  if (trunk === 0) return false;
  // pivot = centre of the lowest trunk row
  let sx = 0, sn = 0;
  for (const i of list) if (mat[i] !== MAT.NEEDLES && ((i / W) | 0) >= baseY - 1) { sx += i % W; sn++; }
  const px = sx / sn + 0.5, py = baseY + 1;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const cv = makeCanvas(w, h);
  const g = cv ? (cv.getContext('2d') as Ctx2D | null) : null;
  for (const i of list) {
    const cx = i % W, cy = (i / W) | 0;
    if (g) { g.fillStyle = '#' + (cellColor(mat[i], shade[i]) | 0x1000000).toString(16).slice(1); g.fillRect(cx - x0, cy - y0, 1, 1); }
    mat[i] = 0; aux[i] = 0; flags[i] = 0;
  }
  wakeRect(x0 - 2, y0 - 2, x1 + 2, y1 + 2, 90);
  edited(x0 - 1, y0 - 1, x1 + 1, y1 + 1);
  const len = Math.max(8, py - y0);
  const t: Tree = {
    sprite: g ? (cv as CanvasImageSource) : null, ox: x0, oy: y0, px, py, dir, ang: 0, omega: 0.35 * dir, len,
    logs: Math.max(1, Math.round(trunk / 40)), boughs: Math.max(1, Math.round(needles / 28)), age: 0,
    crown: new Int32Array(0), nCrown: 0, alive: true,
  };
  trees.push(t);
  spawnFx('chip', px, py - 2, dir * 10, -14, 0.6, 0x8a6a46);
  return true;
}

const TREE_ACC = 5.2, TREE_KICK = 0.6;
function stepTree(t: Tree, dt: number) {
  t.age += dt;
  const a = Math.abs(t.ang);
  // accelerate like a real topple: α ∝ sin(θ) + a small imbalance
  const alpha = TREE_ACC * (Math.sin(a) + TREE_KICK * 0.2) * (60 / Math.max(30, t.len)) ** 0.5;
  let w = Math.abs(t.omega) + alpha * dt;
  let na = a + w * dt;
  // ground contact test along the trunk axis (sample the upper half)
  let hit = false, hitS = 0;
  const sa = Math.sin(na) * t.dir, ca = Math.cos(na);
  for (let s = t.len; s > t.len * 0.35; s -= 3) {
    const wx = Math.floor(t.px + sa * s), wy = Math.floor(t.py - ca * s);
    if (wx < 0 || wx >= W || wy < 0 || wy >= H) continue;
    if (WALK[mat[wy * W + wx]] && na > 0.12) { hit = true; hitS = s; break; }
  }
  if (na >= Math.PI / 2) { na = Math.PI / 2; hit = true; if (!hitS) hitS = t.len; }
  t.omega = w * t.dir;
  t.ang = na * t.dir;
  // shake snow off the crown while it swings
  if (rnd() < 0.7) {
    const s = t.len * (0.55 + rnd() * 0.45);
    const wx = t.px + Math.sin(a) * t.dir * s, wy = t.py - Math.cos(a) * s;
    spawnFx('flake', wx + (rnd() - 0.5) * 6, wy, (rnd() - 0.5) * 20 + t.dir * w * 6, -5 + rnd() * 10, 0.9 + rnd() * 0.8);
    if (rnd() < 0.12) throwCell(Math.floor(wx), Math.floor(wy), MAT.SNOW, 0, (rnd() - 0.5) * 30, 5 + rnd() * 20);
  }
  if (hit) {
    const wx = t.px + Math.sin(na) * t.dir * hitS, wy = t.py - Math.cos(na) * hitS;
    burstFx('dust', wx, wy, 26, 40, 1.1, undefined, 8);
    burstFx('chip', wx, wy, 8, 50, 0.8, 0x1f4a3a);
    for (let k = 0; k < 14; k++) spawnFx('flake', wx + (rnd() - 0.5) * t.len * 0.5 * Math.cos(na), wy - rnd() * 4, (rnd() - 0.5) * 60, -rnd() * 50, 1 + rnd());
    G.cam.shake = Math.max(G.cam.shake, Math.min(9, 2 + t.len * 0.04));
    impactList.push({ x: wx, y: wy, mass: t.logs * 40, speed: 120 });
    t.alive = false;
    const lx = Math.round(t.px + Math.sin(na) * t.dir * t.len * 0.5), ly = Math.round(t.py - Math.cos(na) * t.len * 0.5);
    for (const fn of treeFns) fn(lx, ly, t.logs, t.boughs);
  }
}

// ---------------------------------------------------------------- step / draw
export function stepBodies(dt: number): { impacts: Impact[] } {
  if (dt > 0.05) dt = 0.05;
  impactList.length = 0;
  for (let i = clusters.length - 1; i >= 0; i--) {
    const c = clusters[i];
    if (c.alive) stepCluster(c, dt);
  }
  for (let i = trees.length - 1; i >= 0; i--) {
    stepTree(trees[i], dt);
    if (!trees[i].alive) trees.splice(i, 1);
  }
  return { impacts: impactList };
}

export function drawBodies(ctx: CanvasRenderingContext2D, v: View): void {
  const x0 = v.x0, y0 = v.y0;
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  for (let k = 0; k < clusters.length; k++) {
    const c = clusters[k];
    if (!c.sprite) continue;
    const dx = Math.floor(c.x) - x0, dy = Math.floor(c.y) - y0;
    if (dx > v.w || dy > v.h || dx + c.w < 0 || dy + c.h < 0) continue;
    ctx.drawImage(c.sprite, dx, dy);
  }
  for (let k = 0; k < trees.length; k++) {
    const t = trees[k];
    if (!t.sprite) continue;
    ctx.save();
    ctx.translate(t.px - x0, t.py - y0);
    ctx.rotate(t.ang);
    ctx.drawImage(t.sprite, t.ox - t.px, t.oy - t.py);
    ctx.restore();
  }
  ctx.imageSmoothingEnabled = smooth;
}

/** Remove everything (new game / load). Cells held by clusters are discarded. */
export function clearBodies() { clusters.length = 0; trees.length = 0; impactList.length = 0; }

void P_GAS; void P_FIRE; void MATS; void setCell;
