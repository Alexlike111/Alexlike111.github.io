// Structural support solver (SPEC §2 "Structure").
//
// Every solid cell with SPAN>0 that is not an anchor needs support. Support flows from anchors (natural ANCHOR
// materials, bedrock, standing tree trunks that are still rooted in the ground) and from any powder/liquid cell directly beneath ("floor").
// It travels through structural cells with a Dijkstra-like cost (in half-cells):
//     up 0 · straight down 1 (hanging) · diagonal-up 1 · sideways 2 · diagonal-down 3
// and a cell is supported when its accumulated cost ≤ 2·SPAN[material] (natural, unplaced cells get ×2.5).
// So a flat slab fails beyond SPAN cells from vertical support, while an arch or a corbelled dome — which keep
// climbing — hold. Failing groups: detached ones fall as clusters; groups still attached to supported structure
// crumble (snow types → loose SNOW powder, everything else → cluster).
import { W, H, mat, aux, flags, wakeRect, edited, onEdit, F_PLACED, F_TREE, F_FIXTURE } from './grid';
import { MAT, SPAN, ANCHOR, PHASE, WALK, P_POWDER, P_LIQUID } from '../content/materials';
import { makeCluster } from './bodies';
import { spawnFx } from './particles';
import { G } from '../game/state';

const MAXR = 192, MAXN = MAXR * MAXR, INF = 0xffff, MAXC = 270;
const kind = new Uint8Array(MAXN);       // 0 nothing · 1 structural · 2 anchor · 3 floor (powder/liquid)
const lim = new Uint16Array(MAXN);       // cost limit of a structural cell
const s0 = new Uint8Array(MAXN);         // structural cell directly supported from below (floor/anchor, may lie outside the region)
const dist = new Uint16Array(MAXN);
const lab = new Int32Array(MAXN);
const stack = new Int32Array(MAXN);
const heads = new Int32Array(MAXC + 8);
const NODES = MAXN * 6;
const nodeCell = new Int32Array(NODES), nodeNext = new Int32Array(NODES);
let nodeN = 0;

const treeW = new Uint8Array(MAXN), rooted = new Uint8Array(MAXN);   // scratch for trunk rooting
const CRUMBLE = new Uint8Array(256);
CRUMBLE[MAT.PACKED] = 1; CRUMBLE[MAT.SNOWBLOCK] = 1;
const NATURAL_X = 2.5;

// move table: dx, dy, cost (half-cells)
const MV = [0, -1, 0, 0, 1, 1, -1, 0, 2, 1, 0, 2, -1, -1, 1, 1, -1, 1, -1, 1, 3, 1, 1, 3];

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ------------------------------------------------------------------ region gather + solve
let rx0 = 0, ry0 = 0, rw = 0, rh = 0;

function classify(m: number, f: number, placedOverride = false): number {
  if (m === 0) return 0;
  if (m === MAT.FIXTURE || (f & F_FIXTURE)) return 0;
  const sp = SPAN[m];
  if (sp > 0) {
    const placed = placedOverride || (f & F_PLACED) !== 0;
    if (m === MAT.BEDROCK || (ANCHOR[m] && !placed)) return 2;
    if ((f & F_TREE) && m === MAT.WOOD) return 2;   // gather() demotes trunk cells that are no longer rooted
    return 1;
  }
  const ph = PHASE[m];
  return ph === P_POWDER || ph === P_LIQUID ? 3 : 0;
}
const limitOf = (m: number, f: number, placedOverride = false) => {
  const placed = placedOverride || (f & F_PLACED) !== 0;
  return Math.min(MAXC, Math.round(SPAN[m] * 2 * (placed ? 1 : NATURAL_X)));
};

function kindAtGlobal(x: number, y: number): number {
  if (x < 0 || x >= W || y >= H) return 2;
  if (y < 0) return 0;
  const i = y * W + x;
  return classify(mat[i], flags[i]);
}

/** Is the cell under (gx,gy) a floor/anchor? A trunk cell below only counts when it is rooted; inside the region the solver decides that. */
function floorBelow(gx: number, gy: number): boolean {
  const by = gy + 1;
  if (gx < 0 || gx >= W || by >= H) return true;
  const i = by * W + gx;
  if (isTreeWood(i)) return by >= ry0 + rh ? groundedTrunk(gx, by) : false;
  const k = kindAtGlobal(gx, by);
  return k === 3 || k === 2;
}
const isTreeWood = (i: number) => mat[i] === MAT.WOOD && (flags[i] & F_TREE) !== 0;
/** Walk down a trunk (also stepping diagonally) from a cell of the region's bottom row: does it end in ground? */
function groundedTrunk(gx: number, gy: number): boolean {
  for (let n = 0; n < 400; n++) {
    gy++;
    if (gy >= H) return true;
    let nx = -1;
    for (let k = 0; k < 3; k++) {
      const xx = gx + (k === 0 ? 0 : k === 1 ? -1 : 1);
      if (xx < 0 || xx >= W) continue;
      const i = gy * W + xx;
      if (isTreeWood(i)) { if (nx < 0) nx = xx; } else if (WALK[mat[i]]) return true;
    }
    if (nx < 0) return false;
    gx = nx;
  }
  return true;
}

/** Copy the world region into the local arrays. Returns the number of structural (non-anchor) cells. */
function gather(x0: number, y0: number, w: number, h: number): number {
  rx0 = x0; ry0 = y0; rw = w; rh = h;
  let ns = 0, trees = 0;
  for (let ly = 0; ly < h; ly++) {
    const gy = y0 + ly;
    for (let lx = 0; lx < w; lx++) {
      const gx = x0 + lx, li = ly * w + lx;
      const i = gy * W + gx, m = mat[i], f = flags[i];
      const k = classify(m, f);
      kind[li] = k;
      s0[li] = 0;
      treeW[li] = 0;
      if (k === 2 && (f & F_TREE) && m === MAT.WOOD) { treeW[li] = 1; trees++; }
      if (k === 1) {
        ns++;
        lim[li] = limitOf(m, f);
        if (floorBelow(gx, gy)) s0[li] = 1;
      }
    }
  }
  if (trees > 0) {
    // trunk cells are anchors only while a chain of trunk cells leads down to the ground; cut-off pieces must be supported like any block
    for (let ly = h - 1; ly >= 0; ly--) {
      for (let lx = 0; lx < w; lx++) {
        const li = ly * w + lx;
        if (!treeW[li]) continue;
        const gx = x0 + lx, gy = y0 + ly;
        let r = false;
        if (ly === h - 1) r = groundedTrunk(gx, gy);
        else {
          for (let k = -1; k <= 1 && !r; k++) {
            const nx = lx + k;
            if (nx < 0 || nx >= w) continue;
            const bl = li + w + k;
            if (treeW[bl]) r = rooted[bl] === 1;
            else r = WALK[mat[(gy + 1) * W + x0 + nx]] === 1;
          }
        }
        rooted[li] = r ? 1 : 0;
        if (!r) {
          kind[li] = 1; ns++;
          lim[li] = limitOf(MAT.WOOD, flags[gy * W + gx]);
          if (floorBelow(gx, gy)) s0[li] = 1;
        }
      }
    }
  }
  return ns;
}

function push(c: number, cell: number) {
  if (nodeN >= NODES) return;
  nodeCell[nodeN] = cell; nodeNext[nodeN] = heads[c]; heads[c] = nodeN++;
}

function solve(optimistic: boolean) {
  const n = rw * rh;
  dist.fill(INF, 0, n);
  heads.fill(-1);
  nodeN = 0;
  for (let ly = 0; ly < rh; ly++) {
    for (let lx = 0; lx < rw; lx++) {
      const li = ly * rw + lx, k = kind[li];
      if (k === 2) { dist[li] = 0; push(0, li); }
      else if (k === 1) {
        if (s0[li] || (optimistic && (lx === 0 || ly === 0 || lx === rw - 1 || ly === rh - 1))) { dist[li] = 0; push(0, li); }
      }
    }
  }
  for (let c = 0; c <= MAXC; c++) {
    while (heads[c] !== -1) {
      const node = heads[c]; heads[c] = nodeNext[node];
      const u = nodeCell[node];
      if (dist[u] !== c) continue;
      const ux = u % rw, uy = (u / rw) | 0;
      for (let q = 0; q < 24; q += 3) {
        const dx = MV[q], dy = MV[q + 1];
        const vx = ux + dx, vy = uy + dy;
        if (vx < 0 || vy < 0 || vx >= rw || vy >= rh) continue;
        const v = vy * rw + vx;
        if (kind[v] !== 1) continue;
        const nd = c + MV[q + 2];
        if (nd > lim[v] || nd >= dist[v]) continue;
        if (dx !== 0 && dy !== 0) {
          // no squeezing through a pinhole corner: one of the two orthogonal cells must be solid structure
          const a = kind[uy * rw + vx], b = kind[vy * rw + ux];
          if (!((a === 1 || a === 2) || (b === 1 || b === 2))) continue;
        }
        dist[v] = nd;
        push(nd, v);
      }
    }
  }
}

// ------------------------------------------------------------------ failure handling
let crumbled = 0;
function handleFailures(): void {
  const n = rw * rh;
  lab.fill(0, 0, n);
  let comp = 0;
  let minX = W, minY = H, maxX = -1, maxY = -1;
  const rigidScratch: number[] = [];
  for (let s = 0; s < n; s++) {
    if (kind[s] !== 1 || dist[s] !== INF || lab[s] !== 0) continue;
    comp++;
    // BFS the failing component (8-connected)
    let sp = 0, attached = false;
    stack[sp++] = s; lab[s] = comp;
    const cells: number[] = [];
    while (sp > 0) {
      const u = stack[--sp];
      cells.push(u);
      const ux = u % rw, uy = (u / rw) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const vx = ux + dx, vy = uy + dy;
        if (vx < 0 || vy < 0 || vx >= rw || vy >= rh) continue;
        const v = vy * rw + vx;
        const kv = kind[v];
        if (kv === 1) {
          if (dist[v] === INF) { if (lab[v] === 0) { lab[v] = comp; stack[sp++] = v; } }
          else attached = true;
        } else if (kv === 2) attached = true;
      }
    }
    // gather global indices
    const glob = (u: number) => (ry0 + ((u / rw) | 0)) * W + rx0 + (u % rw);
    if (!attached) {
      for (const u of cells) { const x = rx0 + (u % rw), y = ry0 + ((u / rw) | 0); if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      makeCluster(cells.map(glob), 0, 0);
    } else {
      rigidScratch.length = 0;
      for (const u of cells) {
        const i = glob(u), m = mat[i];
        const x = rx0 + (u % rw), y = ry0 + ((u / rw) | 0);
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (CRUMBLE[m]) {
          mat[i] = MAT.SNOW; aux[i] = 0; flags[i] = 0;
          crumbled++;
          if ((crumbled & 3) === 0) spawnFx('flake', x, y, (Math.random() - 0.5) * 20, -4 - Math.random() * 10, 0.8);
        } else rigidScratch.push(u);
      }
      if (rigidScratch.length) splitAndMake(rigidScratch, glob);
    }
  }
  if (maxX >= 0) {
    wakeRect(minX - 2, minY - 2, maxX + 2, maxY + 2, 90);
    edited(minX, minY, maxX, maxY);
  }
}

/** Make clusters out of rigid cells, one per 8-connected group. */
function splitAndMake(list: number[], glob: (u: number) => number) {
  const set = new Set(list);
  for (const s of list) {
    if (!set.has(s)) continue;
    const group: number[] = [];
    const st = [s]; set.delete(s);
    while (st.length) {
      const u = st.pop() as number;
      group.push(glob(u));
      const ux = u % rw, uy = (u / rw) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const vx = ux + dx, vy = uy + dy;
        if (vx < 0 || vy < 0 || vx >= rw || vy >= rh) continue;
        const v = vy * rw + vx;
        if (set.has(v)) { set.delete(v); st.push(v); }
      }
    }
    makeCluster(group, 0, 0);
  }
}

function countFail(): { fail: number; uncertain: number } {
  const n = rw * rh;
  let fail = 0;
  for (let s = 0; s < n; s++) if (kind[s] === 1 && dist[s] === INF) fail++;
  return { fail, uncertain: 0 };
}

const distPess = new Uint16Array(MAXN);
/** Solve and resolve one region (world rect). Handles the "support depends on the region border" case by growing. */
function processRegion(cx0: number, cy0: number, cx1: number, cy1: number, mx = 32, my = 32) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const x0 = Math.max(0, cx0 - mx), y0 = Math.max(0, cy0 - my);
    const x1 = Math.min(W - 1, cx1 + mx), y1 = Math.min(H - 1, cy1 + my);
    const w = Math.min(MAXR, x1 - x0 + 1), h = Math.min(MAXR, y1 - y0 + 1);
    const ns = gather(x0, y0, w, h);
    if (ns === 0) return;
    solve(false);
    const pess = countFail();
    if (pess.fail === 0) return;
    // snapshot the pessimistic result, then re-solve with the border treated as supported
    distPess.set(dist.subarray(0, w * h));
    solve(true);
    let uncertain = 0;
    for (let s = 0; s < w * h; s++) if (kind[s] === 1 && distPess[s] === INF && dist[s] !== INF) uncertain++;
    const canGrow = attempt < 2 && (w < MAXR || h < MAXR) && (x0 > 0 || y0 > 0 || x1 < W - 1 || y1 < H - 1);
    if (uncertain > 0 && canGrow) { mx *= 2; my *= 2; continue; }
    // final answer: cells failing even with an optimistic border
    handleFailures();
    return;
  }
}

// ------------------------------------------------------------------ queue + time slicing
interface Rect { x0: number; y0: number; x1: number; y1: number }
const queue: Rect[] = [];
let inited = false;

function queueRect(x0: number, y0: number, x1: number, y1: number) {
  for (const r of queue) {
    if (x0 <= r.x1 + 16 && x1 >= r.x0 - 16 && y0 <= r.y1 + 16 && y1 >= r.y0 - 16) {
      if (x0 < r.x0) r.x0 = x0; if (y0 < r.y0) r.y0 = y0; if (x1 > r.x1) r.x1 = x1; if (y1 > r.y1) r.y1 = y1;
      return;
    }
  }
  if (queue.length >= 48) { // overflow: merge everything into the first rect
    const r = queue[0];
    for (const q of queue) { r.x0 = Math.min(r.x0, q.x0); r.y0 = Math.min(r.y0, q.y0); r.x1 = Math.max(r.x1, q.x1); r.y1 = Math.max(r.y1, q.y1); }
    queue.length = 1;
  }
  queue.push({ x0, y0, x1, y1 });
}

export function initStructure() {
  queue.length = 0; jobs.length = 0; sweepT = 0; sweepK = 0;
  if (!inited) { inited = true; onEdit((x0, y0, x1, y1) => queueRect(x0, y0, x1, y1)); }
}
/** Ask for a re-check of a world rectangle (cells). */
export function requestSupportCheck(x0: number, y0: number, x1: number, y1: number) { queueRect(x0, y0, x1, y1); }
export function pendingChecks() { return queue.length + jobs.length; }

let sweepT = 0, sweepK = 0;
const SWEEP: [number, number][] = (() => {
  const a: [number, number][] = [[0, 0]];
  for (let r = 1; r <= 3; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) a.push([dx, dy]);
  return a;
})();

interface Job { x0: number; y0: number; x1: number; y1: number }
const BUDGET_MS = 1.8;   // soft per-frame budget (SPEC: <= 2.5 ms); a job is only started if the average job cost still fits
let jobCost = 0.5;
const jobs: Job[] = [];
const BLOCK = 64;

export function stepStructure(dt: number) {
  const t0 = now();
  // slow sweep around the player
  const p = G.player;
  if (p && p.alive !== false && queue.length === 0 && jobs.length === 0) {
    sweepT += dt;
    if (sweepT > 0.5) {
      sweepT = 0;
      const [dx, dy] = SWEEP[sweepK++ % SWEEP.length];
      const cx = Math.floor(p.x + dx * 48), cy = Math.floor(p.y - 10 + dy * 36);
      queueRect(cx - 24, cy - 18, cx + 24, cy + 18);
    }
  }
  // split queued rects into solver-sized jobs
  while (queue.length) {
    const r = queue.shift() as Rect;
    for (let by = Math.max(0, r.y0); by <= Math.min(H - 1, r.y1); by += BLOCK) {
      for (let bx = Math.max(0, r.x0); bx <= Math.min(W - 1, r.x1); bx += BLOCK) {
        jobs.push({ x0: bx, y0: by, x1: Math.min(W - 1, r.x1, bx + BLOCK - 1), y1: Math.min(H - 1, r.y1, by + BLOCK - 1) });
      }
    }
  }
  // at least one job per frame (progress), then only while the estimated cost of the next one still fits the budget
  let guard = 0;
  while (jobs.length && guard++ < 256) {
    const j = jobs.shift() as Job;
    const a = now();
    processRegion(j.x0, j.y0, j.x1, j.y1);
    const b = now();
    jobCost = jobCost * 0.7 + (b - a) * 0.3;
    if (b - t0 + jobCost > BUDGET_MS) break;
  }
}

// ------------------------------------------------------------------ build preview
export interface PreviewCell { x: number; y: number; m: number }
/** Would these cells (about to be placed as F_PLACED structure) be supported? margin: 1 = rock solid … 0 = about to fail. */
export function supportPreview(cells: PreviewCell[]): { ok: boolean; margin: number; reason?: string } {
  if (cells.length === 0) return { ok: true, margin: 1 };
  let bx0 = W, by0 = H, bx1 = -1, by1 = -1;
  for (const c of cells) { if (c.x < bx0) bx0 = c.x; if (c.x > bx1) bx1 = c.x; if (c.y < by0) by0 = c.y; if (c.y > by1) by1 = c.y; }
  const M = 34;
  const x0 = Math.max(0, bx0 - M), y0 = Math.max(0, by0 - M);
  const w = Math.min(MAXR, Math.min(W - 1, bx1 + M) - x0 + 1), h = Math.min(MAXR, Math.min(H - 1, by1 + M) - y0 + 1);
  gather(x0, y0, w, h);
  // overlay the hypothetical cells
  for (const c of cells) {
    const lx = c.x - rx0, ly = c.y - ry0;
    if (lx < 0 || ly < 0 || lx >= rw || ly >= rh) continue;
    const li = ly * rw + lx, k = classify(c.m, F_PLACED, true);
    kind[li] = k; s0[li] = 0;
    if (k === 1) { lim[li] = limitOf(c.m, F_PLACED, true); const kb = kindAtOverlay(lx, ly + 1, c.x, c.y + 1); if (kb === 3 || kb === 2) s0[li] = 1; }
  }
  // cells under the overlay may now be supported by overlay anchors too: recompute s0 for neighbours above overlay
  for (let ly = 0; ly < rh; ly++) for (let lx = 0; lx < rw; lx++) {
    const li = ly * rw + lx;
    if (kind[li] === 1 && !s0[li] && ly + 1 < rh) { const kb = kind[li + rw]; if (kb === 3 || kb === 2) s0[li] = 1; }
  }
  solve(true);
  let ok = true, margin = 1, attachedAny = false, hasStruct = false;
  for (const c of cells) {
    const lx = c.x - rx0, ly = c.y - ry0;
    if (lx < 0 || ly < 0 || lx >= rw || ly >= rh) continue;
    const li = ly * rw + lx;
    if (kind[li] !== 1) continue;
    hasStruct = true;
    const d = dist[li];
    if (d === INF) {
      ok = false; margin = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const vx = lx + dx, vy = ly + dy;
        if ((dx || dy) && vx >= 0 && vy >= 0 && vx < rw && vy < rh) { const kv = kind[vy * rw + vx]; if (kv === 2 || (kv === 1 && dist[vy * rw + vx] !== INF)) attachedAny = true; }
      }
    } else {
      const m = 1 - d / Math.max(1, lim[li]);
      if (m < margin) margin = m;
    }
  }
  if (!hasStruct) return { ok: true, margin: 1 };
  if (ok) return { ok: true, margin: Math.max(0, Math.min(1, margin)) };
  return { ok: false, margin: 0, reason: attachedAny ? 'слишком длинный пролёт' : 'нет опоры' };
}
function kindAtOverlay(_lx: number, _ly: number, gx: number, gy: number) { return kindAtGlobal(gx, gy); }

