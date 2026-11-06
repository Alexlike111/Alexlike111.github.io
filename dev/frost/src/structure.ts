// Structural integrity solver. Cells are 5 cm. For a rect of the world we run a Dijkstra
// "support flow" from anchors (ground, rooted trees, rect border) through rigid cells; cost = how
// hard it is for a cell to be held up. Cells whose cost exceeds BUDGET (or that are unreachable)
// fail: snow loses cohesion (pours as granular), wood/ice/crates fall as rigid bodies.
import {
  W, H, M, F_DIST, F_TREE, BOND_SOLID, mat, dens, bond, flags, body, set, wake,
} from './world';
import { G } from './state';
import { makeBody } from './phys';

// ---- tunables ----
const BUDGET = 1000;
const PAD = 64;            // rect expansion around marked edits
const MAXD = 512;          // max rect side
const LREF_SNOW = 60, LREF_OTHER = 250;
const GRAN_COST = 3;
const MIN_ISLAND = 12, MAX_ISLAND = 5000;
const QUEUE_PERIOD = 0.12, SWEEP_PERIOD = 2.5;
const SWEEP_W = 360, SWEEP_H = 220;
const MAX_SOLVES_PER_STEP = 2;

const MAXN = (MAXD + 2) * (MAXD + 2);
const INF = 0x7fffffff;

// local (padded) arrays, layout stride = pw
const lm = new Uint8Array(MAXN);    // material
const lb = new Uint8Array(MAXN);    // bond
const ld = new Uint16Array(MAXN);   // dens
const lf = new Uint8Array(MAXN);    // flags
const cls = new Uint8Array(MAXN);   // 0 none, 1 structural, 2 granular carrier, 3 anchor
const run = new Uint8Array(MAXN);   // contiguous structural run length in column (capped 12)
const load = new Uint16Array(MAXN); // kg/m2 resting on top
const cu = new Uint16Array(MAXN);   // cost to be supported from below
const cdg = new Uint16Array(MAXN);  // from diagonal-below
const chz = new Uint16Array(MAXN);  // from the side
const chg = new Uint16Array(MAXN);  // from above (hanging)
const dist = new Int32Array(MAXN);
const nxt = new Int32Array(MAXN);
const prv = new Int32Array(MAXN);
const vis = new Uint8Array(MAXN);   // 1 failing, 2 in current group, 3 consumed by body
const grp = new Int32Array(MAXN);
const sub = new Int32Array(MAXN);
const head = new Int32Array(BUDGET + 1);

let pw = 0, ph = 0, rx0 = 0, ry0 = 0, rw = 0, rh = 0;
const OFF = new Int32Array(8);

function loadRect(x0: number, y0: number, x1: number, y1: number): boolean {
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W - 1, x1); y1 = Math.min(H - 1, y1);
  if (x1 - x0 + 1 > MAXD) { const c = (x0 + x1) >> 1; x0 = c - (MAXD >> 1); x1 = x0 + MAXD - 1; x0 = Math.max(0, x0); x1 = Math.min(W - 1, x1); }
  if (y1 - y0 + 1 > MAXD) { const c = (y0 + y1) >> 1; y0 = c - (MAXD >> 1); y1 = y0 + MAXD - 1; y0 = Math.max(0, y0); y1 = Math.min(H - 1, y1); }
  rw = x1 - x0 + 1; rh = y1 - y0 + 1;
  if (rw < 3 || rh < 3) return false;
  rx0 = x0; ry0 = y0; pw = rw + 2; ph = rh + 2;
  OFF[0] = -pw - 1; OFF[1] = -pw; OFF[2] = -pw + 1; OFF[3] = -1; OFF[4] = 1; OFF[5] = pw - 1; OFF[6] = pw; OFF[7] = pw + 1;
  const n = pw * ph;
  lm.fill(0, 0, n); lb.fill(0, 0, n); ld.fill(0, 0, n); lf.fill(0, 0, n);
  for (let y = 0; y < rh; y++) {
    let wi = (y0 + y) * W + x0, l = (y + 1) * pw + 1;
    for (let x = 0; x < rw; x++, wi++, l++) {
      if (body[wi] !== 0) continue; // rigid bodies are not part of the static structure
      lm[l] = mat[wi]; lb[l] = bond[wi]; ld[l] = dens[wi]; lf[l] = flags[wi];
    }
  }
  return true;
}

/** classify, compute runs, loads and per-cell support costs (after loadRect + optional overlay) */
function prep() {
  const n = pw * ph;
  cls.fill(0, 0, n);
  for (let y = 1; y <= rh; y++) {
    const border = y === 1 || y === rh;
    for (let x = 1; x <= rw; x++) {
      const l = y * pw + x, m = lm[l];
      let c = 0;
      switch (m) {
        case M.SNOW: c = (lb[l] >= BOND_SOLID || ld[l] >= 420) ? 1 : 2; break;
        case M.ASH: c = 2; break;
        case M.ICE: case M.WOOD: case M.CRATE: case M.POLE: case M.PLANK: c = 1; break;
        case M.DIRT: case M.ROCK: case M.BEDROCK: c = 3; break;
      }
      if (c === 1 && (border || x === 1 || x === rw || (m === M.WOOD && (lf[l] & F_TREE)))) c = 3;
      cls[l] = c;
    }
  }
  // column passes: run length (capped 12) and load above
  for (let y = 1; y <= rh; y++) for (let x = 1; x <= rw; x++) {
    const l = y * pw + x, a = l - pw;
    const st = cls[l] === 1 || cls[l] === 3;
    run[l] = st ? Math.min(12, (cls[a] === 1 || cls[a] === 3 ? run[a] : 0) + 1) : 0;
    if (lm[a] !== 0) {
      const ma = lm[a];
      const mass = (ma === M.SNOW || ma === M.ASH) ? ld[a] * CELLM : 0;
      load[l] = Math.min(65535, load[a] + mass);
    } else load[l] = 0;
  }
  for (let y = rh - 1; y >= 1; y--) for (let x = 1; x <= rw; x++) {
    const l = y * pw + x, b = l + pw;
    if (run[l] !== 0 && run[b] !== 0 && (cls[b] === 1 || cls[b] === 3)) run[l] = run[b];
  }
  // cost tables for structural cells
  for (let y = 1; y <= rh; y++) for (let x = 1; x <= rw; x++) {
    const l = y * pw + x;
    if (cls[l] !== 1) continue;
    let u: number, dg: number, h: number, g: number, lref = LREF_OTHER;
    switch (lm[l]) {
      case M.SNOW: {
        let s = (lb[l] / 255) * (ld[l] / 350); s = s < 0.15 ? 0.15 : s > 1.3 ? 1.3 : s;
        u = 4 / s; dg = 10 / s; h = 30 / s; g = 150 / s; lref = LREF_SNOW; break;
      }
      case M.ICE: u = 2; dg = 5; h = 12; g = 40; break;
      case M.CRATE: u = 3; dg = 6; h = 10; g = 30; break;
      default: u = 2; dg = 4; h = 6; g = 20; break; // wood / plank / pole
    }
    const k = (3 / (1 + run[l] / 3)) * (1 + load[l] / lref);
    h *= k; g *= k;
    cu[l] = u < 1 ? 1 : Math.ceil(u); cdg[l] = dg < 1 ? 1 : Math.ceil(dg);
    chz[l] = h > 65535 ? 65535 : Math.max(1, Math.ceil(h)); chg[l] = g > 65535 ? 65535 : Math.max(1, Math.ceil(g));
  }
}
const CELLM = 0.05;

function link(l: number, d: number) {
  const od = dist[l];
  if (od !== INF) { // unlink from old bucket
    const p = prv[l], q = nxt[l];
    if (p !== -1) nxt[p] = q; else head[od] = q;
    if (q !== -1) prv[q] = p;
  }
  dist[l] = d;
  const h = head[d];
  nxt[l] = h; prv[l] = -1;
  if (h !== -1) prv[h] = l;
  head[d] = l;
}

function solve() {
  const n = pw * ph;
  dist.fill(INF, 0, n); head.fill(-1);
  let pending = 0;
  for (let y = 1; y <= rh; y++) for (let x = 1; x <= rw; x++) {
    const l = y * pw + x;
    if (cls[l] === 3) { dist[l] = 0; nxt[l] = head[0]; prv[l] = -1; if (head[0] !== -1) prv[head[0]] = l; head[0] = l; pending++; }
  }
  for (let d = 0; d <= BUDGET; d++) {
    let s: number;
    while ((s = head[d]) !== -1) {
      const q = nxt[s]; head[d] = q; if (q !== -1) prv[q] = -1;
      const sg = cls[s] === 2;
      for (let k = 0; k < 8; k++) {
        const t = s + OFF[k], ct = cls[t];
        if (ct === 0 || ct === 3) continue;
        let c: number;
        if (sg || ct === 2) { if (k !== 1) continue; c = GRAN_COST; } // granular: straight up only
        else c = k === 1 ? cu[t] : (k === 0 || k === 2) ? cdg[t] : (k === 3 || k === 4) ? chz[t] : chg[t];
        const nd = d + c;
        if (nd <= BUDGET && nd < dist[t]) link(t, nd);
      }
    }
  }
}

let cMinX = 0, cMinY = 0, cMaxX = 0, cMaxY = 0, changed = false;
function noteChange(l: number) {
  const x = rx0 + (l % pw) - 1, y = ry0 + ((l / pw) | 0) - 1;
  if (!changed) { changed = true; cMinX = cMaxX = x; cMinY = cMaxY = y; return; }
  if (x < cMinX) cMinX = x; if (x > cMaxX) cMaxX = x; if (y < cMinY) cMinY = y; if (y > cMaxY) cMaxY = y;
}
const wIdx = (l: number) => (ry0 + ((l / pw) | 0) - 1) * W + rx0 + (l % pw) - 1;

function isWoodM(m: number) { return m === M.WOOD || m === M.PLANK || m === M.POLE; }

function spawnBody(list: Int32Array, n: number): boolean {
  const cells: number[] = new Array(n);
  let wood = 0;
  for (let k = 0; k < n; k++) { const l = list[k]; cells[k] = wIdx(l); if (isWoodM(lm[l])) wood++; }
  const b = makeBody(cells, wood * 2 > n ? 'beam' : (wood > 0 ? 'beam' : 'debris'));
  if (!b) return false;
  for (let k = 0; k < n; k++) noteChange(list[k]);
  return true;
}

/** handle failures after solve(); returns counts */
function resolveFailures(): { collapsed: number; bodies: number } {
  let collapsed = 0, bodies = 0, nfail = 0;
  for (let y = 1; y <= rh; y++) for (let x = 1; x <= rw; x++) {
    const l = y * pw + x;
    const f = cls[l] === 1 && dist[l] === INF;
    vis[l] = f ? 1 : 0; if (f) nfail++;
  }
  if (nfail === 0) return { collapsed, bodies };
  for (let y = 1; y <= rh; y++) for (let x = 1; x <= rw; x++) {
    const s = y * pw + x;
    if (vis[s] !== 1) continue;
    // flood the failing group (4-neighbour)
    let n = 1, contact = false; grp[0] = s; vis[s] = 2;
    for (let k = 0; k < n; k++) {
      const l = grp[k];
      for (let d = 0; d < 4; d++) {
        const t = l + (d === 0 ? -pw : d === 1 ? pw : d === 2 ? -1 : 1);
        if (vis[t] === 1) { vis[t] = 2; grp[n++] = t; }
        else if (vis[t] === 0 && (cls[t] === 1 || cls[t] === 3)) contact = true;
      }
    }
    if (!contact && n >= MIN_ISLAND && n <= MAX_ISLAND && spawnBody(grp, n)) { bodies++; for (let k = 0; k < n; k++) vis[grp[k]] = 3; continue; }
    // attached failure: snow loses cohesion
    for (let k = 0; k < n; k++) {
      const l = grp[k];
      if (lm[l] !== M.SNOW) continue;
      const wi = wIdx(l), x0 = wi % W, y0 = (wi / W) | 0;
      set(x0, y0, M.SNOW, Math.min(dens[wi], 400), 0, flags[wi] | F_DIST);
      collapsed++; noteChange(l);
    }
    // rigid non-snow sub-groups fall
    for (let k = 0; k < n; k++) {
      const l0 = grp[k];
      if (vis[l0] !== 2 || lm[l0] === M.SNOW) continue;
      let m = 1; sub[0] = l0; vis[l0] = 3;
      for (let j = 0; j < m; j++) {
        const l = sub[j];
        for (let d = 0; d < 4; d++) {
          const t = l + (d === 0 ? -pw : d === 1 ? pw : d === 2 ? -1 : 1);
          if (vis[t] === 2 && lm[t] !== M.SNOW) { vis[t] = 3; sub[m++] = t; }
        }
      }
      if (spawnBody(sub, m)) bodies++;
    }
  }
  return { collapsed, bodies };
}

function solveRect(x0: number, y0: number, x1: number, y1: number): { collapsed: number; bodies: number } {
  if (!loadRect(x0, y0, x1, y1)) return { collapsed: 0, bodies: 0 };
  prep(); solve();
  changed = false;
  const r = resolveFailures();
  if (changed) markStruct(cMinX, cMinY, cMaxX, cMaxY); // cascades resolve next step
  return r;
}

// ---------------- queue ----------------
const pend: number[] = []; // flat x0,y0,x1,y1 (already expanded + clamped)
let qT = 0, sT = 0;

export function markStruct(x0: number, y0: number, x1: number, y1: number): void {
  if (x0 > x1) { const t = x0; x0 = x1; x1 = t; }
  if (y0 > y1) { const t = y0; y0 = y1; y1 = t; }
  x0 = Math.max(0, x0 - PAD); y0 = Math.max(0, y0 - PAD); x1 = Math.min(W - 1, x1 + PAD); y1 = Math.min(H - 1, y1 + PAD);
  for (let i = 0; i < pend.length; i += 4) { // already covered?
    if (x0 >= pend[i] && y0 >= pend[i + 1] && x1 <= pend[i + 2] && y1 <= pend[i + 3]) return;
  }
  pend.push(x0, y0, x1, y1);
  if (pend.length > 4 * 64) mergePending(true);
}

function mergePending(force = false) {
  let again = true;
  while (again) {
    again = false;
    for (let i = 0; i < pend.length; i += 4) for (let j = i + 4; j < pend.length; j += 4) {
      if (pend[j] > pend[i + 2] || pend[j + 2] < pend[i] || pend[j + 1] > pend[i + 3] || pend[j + 3] < pend[i + 1]) continue;
      const ux0 = Math.min(pend[i], pend[j]), uy0 = Math.min(pend[i + 1], pend[j + 1]);
      const ux1 = Math.max(pend[i + 2], pend[j + 2]), uy1 = Math.max(pend[i + 3], pend[j + 3]);
      if (!force && (ux1 - ux0 + 1 > MAXD || uy1 - uy0 + 1 > MAXD)) continue;
      pend[i] = ux0; pend[i + 1] = uy0; pend[i + 2] = ux1; pend[i + 3] = uy1;
      pend.splice(j, 4); again = true; j -= 4;
    }
    if (force) break;
  }
}

export function stepStructure(dt: number): { collapsed: number; bodies: number } {
  qT += dt; sT += dt;
  let collapsed = 0, bodies = 0;
  if (pend.length && qT >= QUEUE_PERIOD) {
    qT = 0;
    mergePending();
    const t0 = performance.now();
    for (let n = 0; n < MAX_SOLVES_PER_STEP && pend.length; n++) {
      const [a, b, c, d] = pend.splice(0, 4);
      const r = solveRect(a, b, c, d);
      collapsed += r.collapsed; bodies += r.bodies;
      if (performance.now() - t0 > 8) break;
    }
  } else if (sT >= SWEEP_PERIOD) {
    sT = 0;
    const px = Math.round(G.player.x), py = Math.round(G.player.y);
    const r = solveRect(px - (SWEEP_W >> 1), py - (SWEEP_H >> 1), px + (SWEEP_W >> 1) - 1, py + (SWEEP_H >> 1) - 1);
    collapsed += r.collapsed; bodies += r.bodies;
  }
  if (collapsed > 0) wake(Math.round(G.player.x), Math.round(G.player.y));
  return { collapsed, bodies };
}

/** Placement preview: remaining support budget (0..1) of the weakest new cell; 0 = would fail. */
export function supportMargin(cells: { x: number; y: number; m: number; d: number; b: number }[]): number {
  if (cells.length === 0) return 1;
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (const c of cells) { if (c.x < x0) x0 = c.x; if (c.x > x1) x1 = c.x; if (c.y < y0) y0 = c.y; if (c.y > y1) y1 = c.y; }
  if (!loadRect(x0 - PAD, y0 - PAD, x1 + PAD, y1 + PAD)) return 1;
  for (const c of cells) {
    const lx = c.x - rx0, ly = c.y - ry0;
    if (lx < 0 || ly < 0 || lx >= rw || ly >= rh) continue;
    const l = (ly + 1) * pw + lx + 1;
    lm[l] = c.m; lb[l] = c.b; ld[l] = c.d; lf[l] = 0;
  }
  prep(); solve();
  let margin = 1;
  for (const c of cells) {
    const lx = c.x - rx0, ly = c.y - ry0;
    if (lx < 0 || ly < 0 || lx >= rw || ly >= rh) continue;
    const l = (ly + 1) * pw + lx + 1;
    if (cls[l] !== 1) continue;
    const m = dist[l] === INF ? 0 : 1 - dist[l] / BUDGET;
    if (m < margin) margin = m;
  }
  return margin < 0 ? 0 : margin;
}

/** Diagnostics (no side effects on the world): world indices of structural cells that would fail in the rect. */
export function analyzeRect(x0: number, y0: number, x1: number, y1: number): number[] | null {
  if (!loadRect(x0, y0, x1, y1)) return null;
  prep(); solve();
  const out: number[] = [];
  for (let y = 1; y <= rh; y++) for (let x = 1; x <= rw; x++) {
    const l = y * pw + x;
    if (cls[l] === 1 && dist[l] === INF) out.push(wIdx(l));
  }
  return out;
}
