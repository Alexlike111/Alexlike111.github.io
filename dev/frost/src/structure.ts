// Structural integrity solver. Cells are 5 cm. For a rect of the world we run a Dijkstra
// "support flow" from anchors (ground, rooted trees, rect border) through rigid cells; cost = how
// hard it is for a cell to be held up. Cells whose cost exceeds BUDGET (or that are unreachable)
// fail: snow loses cohesion (pours as granular), wood/ice/crates fall as rigid bodies.
// Beam action: a cell's lateral cost shrinks with the depth (run) of its own material and the load penalty is
// divided by that depth; compression arch: thin snow/ice shells whose top surface curves down on both sides
// (concave-down, radius < ~2.4 m) carry thrust laterally at ARCH_F of the flat-beam cost.
// Frame budget: a dirty rect is solved as a resumable job (stepStructure). Its snapshot is taken in one go
// (loadRect); the prep passes, the Dijkstra and the failure commit then run for at most SLICE_MS per frame
// and resume at their cursor (row / column / bucket / group). A failing group is committed only if its cells
// still match the snapshot; otherwise its rect goes back on the queue. supportMargin and analyzeRect use their
// own scratch context and always run to completion, so they never disturb a job in flight.
import {
  W, H, M, F_DIST, F_TREE, BOND_SOLID, mat, dens, bond, flags, body, beamId, set, wake,
} from './world';
import { G } from './state';
import { makeBody } from './phys';

// ---- tunables ----
const BUDGET = 1000;
const PAD = 64;            // rect expansion around marked edits
const MAXD = 512;          // max rect side
const LREF_SNOW = 60, LREF_OTHER = 250;
const GRAN_COST = 3;
const THICK_R = 10;         // run length at which the load penalty is halved
const WOOD_H = 18;         // lateral cost of timber
const SNOW_H = 44;         // lateral cost of snow (before thickness/load scaling)
const RUNCAP = 40;         // vertical run length cap (2 m)
const ARCH_D = 12;         // sample distance (cells) for the shell curvature test
const ARCH_KMIN = 3;       // min (dl + dr) ~ D^2 / R : curved tighter than R ~ 48 cells (2.4 m)
const ARCH_RUN = 24;       // arch action only for thin shells (vertical run <= this)
const ARCH_F = 0.1;        // lateral cost factor inside a compression arch
const MIN_ISLAND = 12, MAX_ISLAND = 5000;
const QUEUE_PERIOD = 0.12, SWEEP_PERIOD = 2.5;
const SWEEP_W = 360, SWEEP_H = 220;
const SLICE_MS = 2.5;      // solver wall time per frame (desktop); a job resumes on the next frame
const TUN_H = 26;          // a gap this low (1.3 m = crawl height) under a snow roof is a tunnel / burrow: the walls out of the plane carry the roof (3-D action the 2-D slice cannot see)
const TUN_F = 0.18;        // lateral / hanging cost factor of such a roof when it is >= 1.2 m thick (scaled in from 0.6 m): a thin shell over a burrow gets no bonus
const BEAM_GRACE = 8;      // s: a freshly placed beam is held up (anchor) so a structure can be built in any order
const CELLM = 0.05;

const MAXN = (MAXD + 2) * (MAXD + 2);
const INF = 0x7fffffff;

// job stages
const ST_IDLE = 0, ST_PREP = 1, ST_SOLVE = 2, ST_COMMIT = 3;
// commit stages
const CS_MARK = 0, CS_SCAN = 1, CS_FLOOD = 2, CS_DECIDE = 3, CS_SNOW = 4, CS_SUB = 5;
const PREP_PASSES = 6;

/** Scratch arrays of one solve (padded rect, layout stride = pw). Two exist: the time-sliced job's and the synchronous one. */
interface Ctx {
  pw: number; ph: number; rx0: number; ry0: number; rw: number; rh: number;
  off: Int32Array;
  lm: Uint8Array;    // material
  lb: Uint8Array;    // bond
  ld: Uint16Array;   // dens
  lf: Uint8Array;    // flags
  lfr: Uint8Array;   // 1 = cell of a beam still inside its placement grace period
  cls: Uint8Array;   // 0 none, 1 structural, 2 granular carrier, 3 anchor (vis: 1 failing, 2 in group, 3 consumed, 4/5 sync target)
  run: Uint8Array;   // contiguous structural run length in column (capped RUNCAP)
  rtop: Uint16Array; // local row of the top of the cell's vertical structural (class 1) run
  tun: Uint8Array;   // 1 = snow roof column above a crawl-height gap (burrow)
  arch: Uint8Array;  // 1 = the shell around this cell is curved concave-down (compression arch)
  bear: Uint8Array;  // 1 = snow cell in an unbroken column under a placed timber/crate (a foundation: bears by compression)
  load: Uint16Array; // kg/m2 resting on top
  cu: Uint16Array;   // cost to be supported from below
  cdg: Uint16Array;  // from diagonal-below
  chz: Uint16Array;  // from the side
  chg: Uint16Array;  // from above (hanging)
  dist: Int32Array;
  nxt: Int32Array;
  prv: Int32Array;
  head: Int32Array;  // bucket queue heads
  vis: Uint8Array;
  grp: Int32Array;   // failing group being decided
  sub: Int32Array;   // rigid piece of a failing group
}

function makeCtx(): Ctx {
  return {
    pw: 0, ph: 0, rx0: 0, ry0: 0, rw: 0, rh: 0, off: new Int32Array(8),
    lm: new Uint8Array(MAXN), lb: new Uint8Array(MAXN), ld: new Uint16Array(MAXN), lf: new Uint8Array(MAXN), lfr: new Uint8Array(MAXN),
    cls: new Uint8Array(MAXN), run: new Uint8Array(MAXN), rtop: new Uint16Array(MAXN), tun: new Uint8Array(MAXN), arch: new Uint8Array(MAXN),
    bear: new Uint8Array(MAXN), load: new Uint16Array(MAXN),
    cu: new Uint16Array(MAXN), cdg: new Uint16Array(MAXN), chz: new Uint16Array(MAXN), chg: new Uint16Array(MAXN),
    dist: new Int32Array(MAXN), nxt: new Int32Array(MAXN), prv: new Int32Array(MAXN), head: new Int32Array(BUDGET + 1),
    vis: new Uint8Array(MAXN), grp: new Int32Array(MAXN), sub: new Int32Array(MAXN),
  };
}

/** A solve in progress: its scratch context plus the cursors that let it resume. */
interface Job {
  c: Ctx;
  st: number;                                  // ST_*
  ps: number; pu: number; pb: boolean;         // prep: pass, unit cursor, pass started (fills done) / seeding started
  seeding: boolean; d: number; targets: number; // solve: anchor seeding, bucket cursor, sync early exit (settled targets left)
  cs: number; cy: number; cx: number; nfail: number; // commit: stage, row-major scan cursor, failing cell count
  gn: number; gk: number; gi: number; gcon: boolean; // group: size, flood cursor, decide / piece cursor, touches an anchor
  bx0: number; by0: number; bx1: number; by1: number; // local bbox of the group / rigid piece
  changed: boolean; mx0: number; my0: number; mx1: number; my1: number; // world bbox of the changes made by this job
}

function makeJob(): Job {
  return {
    c: makeCtx(), st: ST_IDLE, ps: 0, pu: 0, pb: false, seeding: true, d: 0, targets: 0,
    cs: CS_MARK, cy: 1, cx: 1, nfail: 0, gn: 0, gk: 0, gi: 0, gcon: false,
    bx0: 0, by0: 0, bx1: 0, by1: 0, changed: false, mx0: 0, my0: 0, mx1: 0, my1: 0,
  };
}
function resetJob(j: Job) {
  j.ps = 0; j.pb = false; j.seeding = true; j.d = 0; j.targets = 0;
  j.cs = CS_MARK; j.cy = 1; j.cx = 1; j.nfail = 0;
  j.gn = 0; j.gk = 0; j.gi = 0; j.gcon = false; j.changed = false;
}

const JOB = makeJob();             // the time-sliced solve (stepStructure)
let SYNC: Job | null = null;       // synchronous queries (supportMargin / analyzeRect), created on first use

// slice clock: Infinity = run to completion (synchronous queries)
let sliceEnd = Infinity;
const over = (): boolean => sliceEnd !== Infinity && performance.now() >= sliceEnd;

let frameCollapsed = 0, frameBodies = 0;

const wIdx = (c: Ctx, l: number) => (c.ry0 + ((l / c.pw) | 0) - 1) * W + c.rx0 + (l % c.pw) - 1;
/** what a cell is for the solver: rigid bodies are not part of the static structure */
const eff = (wi: number) => (body[wi] !== 0 ? 0 : mat[wi]);
function isWoodM(m: number) { return m === M.WOOD || m === M.PLANK || m === M.POLE || m === M.DOOR; }
/** material group for run (depth) accounting */
function grp8(m: number): number { return m === M.SNOW ? 1 : m === M.ICE ? 2 : m === M.CRATE ? 4 : 3; }

/** Copies the rect (clamped, at most MAXD wide) into the context in one go; false if too small. */
function loadRect(c: Ctx, x0: number, y0: number, x1: number, y1: number): boolean {
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W - 1, x1); y1 = Math.min(H - 1, y1);
  if (x1 - x0 + 1 > MAXD) { const cc = (x0 + x1) >> 1; x0 = cc - (MAXD >> 1); x1 = x0 + MAXD - 1; x0 = Math.max(0, x0); x1 = Math.min(W - 1, x1); }
  if (y1 - y0 + 1 > MAXD) { const cc = (y0 + y1) >> 1; y0 = cc - (MAXD >> 1); y1 = y0 + MAXD - 1; y0 = Math.max(0, y0); y1 = Math.min(H - 1, y1); }
  const rw = x1 - x0 + 1, rh = y1 - y0 + 1;
  if (rw < 3 || rh < 3) return false;
  c.rx0 = x0; c.ry0 = y0; c.rw = rw; c.rh = rh; c.pw = rw + 2; c.ph = rh + 2;
  const pw = c.pw, off = c.off;
  off[0] = -pw - 1; off[1] = -pw; off[2] = -pw + 1; off[3] = -1; off[4] = 1; off[5] = pw - 1; off[6] = pw; off[7] = pw + 1;
  const n = pw * c.ph;
  c.lm.fill(0, 0, n); c.lb.fill(0, 0, n); c.ld.fill(0, 0, n); c.lf.fill(0, 0, n); c.lfr.fill(0, 0, n);
  const lm = c.lm, lb = c.lb, ld = c.ld, lf = c.lf, lfr = c.lfr;
  const anyFresh = fresh.size > 0;
  for (let y = 0; y < rh; y++) {
    let wi = (y0 + y) * W + x0, l = (y + 1) * pw + 1;
    for (let x = 0; x < rw; x++, wi++, l++) {
      if (body[wi] !== 0) continue; // rigid bodies are not part of the static structure
      lm[l] = mat[wi]; lb[l] = bond[wi]; ld[l] = dens[wi]; lf[l] = flags[wi];
      if (anyFresh && (mat[wi] === M.PLANK || mat[wi] === M.DOOR) && fresh.has(beamId[wi])) lfr[l] = 1;
    }
  }
  return true;
}

// ---- prep: classify, runs, loads, arch, burrows, costs (one row / column per unit) ----
function prepRowClass(c: Ctx, y: number) {
  const { pw, rw, rh, lm, lb, ld, lfr, lf, cls } = c;
  const border = y === 1 || y === rh;
  for (let x = 1; x <= rw; x++) {
    const l = y * pw + x, m = lm[l];
    let k = 0;
    switch (m) {
      case M.SNOW: k = (lb[l] >= BOND_SOLID || ld[l] >= 420) ? 1 : 2; break;
      case M.ASH: k = 2; break;
      case M.ICE: case M.WOOD: case M.POLE: case M.PLANK: case M.DOOR: k = 1; break;
      case M.CRATE: case M.DIRT: case M.ROCK: case M.BEDROCK: k = 3; break; // a supply crate is part of the ground: undermining it leaves it hanging like a buried box, it never drops
    }
    if (k === 1 && (border || x === 1 || x === rw || lfr[l] === 1 || (m === M.WOOD && (lf[l] & F_TREE)))) k = 3;
    cls[l] = k;
  }
}
function prepRowColumn(c: Ctx, y: number) {
  const { pw, rw, cls, lm, ld, run, rtop, bear, load } = c;
  for (let x = 1; x <= rw; x++) {
    const l = y * pw + x, a = l - pw;
    // run = depth of the cell's own material (snow on a beam is load, not depth)
    run[l] = cls[l] === 1 ? Math.min(RUNCAP, (cls[a] === 1 && grp8(lm[a]) === grp8(lm[l]) ? run[a] : 0) + 1) : 0;
    rtop[l] = cls[l] === 1 ? (cls[a] === 1 ? rtop[a] : y) : 0;
    bear[l] = (cls[l] === 1 || cls[l] === 2) && lm[l] === M.SNOW && (bear[a] === 1 || lm[a] === M.PLANK || lm[a] === M.DOOR || lm[a] === M.CRATE || lm[a] === M.POLE) ? 1 : 0;
    if (lm[a] !== 0) {
      const ma = lm[a];
      const mass = (ma === M.SNOW || ma === M.ASH) ? ld[a] * CELLM : 0;
      load[l] = Math.min(65535, load[a] + mass);
    } else load[l] = 0;
  }
}
function prepRowRun(c: Ctx, y: number) {
  const { pw, rw, cls, lm, run } = c;
  for (let x = 1; x <= rw; x++) {
    const l = y * pw + x, b = l + pw;
    if (run[l] !== 0 && run[b] !== 0 && cls[b] === 1 && grp8(lm[b]) === grp8(lm[l])) run[l] = run[b];
  }
}
/** run-top row of the structural cell nearest (in y) to row `y` in column `x`, or -1 */
function topNear(c: Ctx, x: number, y: number): number {
  const { pw, rh, cls, rtop } = c;
  for (let k = 0; k <= 8; k++) {
    if (y - k >= 1) { const a = (y - k) * pw + x; if (cls[a] === 1) return rtop[a]; }
    if (k > 0 && y + k <= rh) { const b = (y + k) * pw + x; if (cls[b] === 1) return rtop[b]; }
  }
  return -1;
}
function prepRowArch(c: Ctx, y: number) {
  const { pw, rw, cls, lm, run, rtop, arch } = c;
  for (let x = 1; x <= rw; x++) {
    const l = y * pw + x;
    arch[l] = 0;
    if (cls[l] !== 1 || run[l] > ARCH_RUN || (lm[l] !== M.SNOW && lm[l] !== M.ICE)) continue;
    if (x - ARCH_D < 1 || x + ARCH_D > rw) continue;
    const tl = topNear(c, x - ARCH_D, y), tr = topNear(c, x + ARCH_D, y);
    if (tl < 0 || tr < 0) continue;
    const t = rtop[l];
    if ((tl - t) + (tr - t) >= ARCH_KMIN) arch[l] = 1;
  }
}
function prepColTunnel(c: Ctx, x: number) {
  // walking up the column: a gap (air / loose snow) of <= TUN_H rows with solid floor under it and a structural run above it
  const { pw, rh, cls, lm, tun } = c;
  let gap = 0, floor = false;
  for (let y = rh; y >= 1; y--) {
    const l = y * pw + x, k = cls[l];
    if (k === 1 || k === 3) {
      if (gap > 0 && gap <= TUN_H && floor && k === 1 && (lm[l] === M.SNOW || lm[l] === M.ICE)) { for (let yy = y; yy >= 1 && cls[yy * pw + x] === 1; yy--) tun[yy * pw + x] = 1; }
      gap = 0; floor = true;
    } else if (floor) gap++;
  }
}
function prepRowCosts(c: Ctx, y: number) {
  const { pw, rw, cls, lm, lb, ld, run, load, arch, tun, bear, cu, cdg, chz, chg } = c;
  for (let x = 1; x <= rw; x++) {
    const l = y * pw + x;
    if (cls[l] !== 1) continue;
    let u: number, dg: number, h: number, g: number, lref = LREF_OTHER;
    switch (lm[l]) {
      case M.SNOW: {
        let s = (lb[l] / 255) * (ld[l] / 350); s = s < 0.15 ? 0.15 : s > 1.3 ? 1.3 : s;
        u = bear[l] ? 3 : 4 / s; dg = 10 / s; h = SNOW_H / s; g = 150 / s; lref = LREF_SNOW; break; // foundation snow under a post carries it in compression
      }
      case M.ICE: u = 2; dg = 5; h = 12; g = 40; break;
      case M.CRATE: u = 3; dg = 6; h = 10; g = 30; break;
      default: u = 2; dg = 4; h = WOOD_H; g = WOOD_H * 2.2; break; // wood / plank / pole
    }
    // thick runs carry load by beam action: the load penalty shrinks with thickness
    const k = (3 / (1 + run[l] / 3)) * (1 + load[l] / (lref * (1 + run[l] / THICK_R)));
    h *= k; g *= k;
    if (arch[l]) h *= ARCH_F;
    if (tun[l] && lm[l] === M.SNOW) { const tk = Math.max(0, Math.min(1, (run[l] - 12) / 12)), f = 1 - tk * (1 - TUN_F); h *= f; g *= f; dg *= f; }
    cu[l] = u < 1 ? 1 : Math.ceil(u); cdg[l] = dg < 1 ? 1 : Math.ceil(dg);
    chz[l] = h > 65535 ? 65535 : Math.max(1, Math.ceil(h)); chg[l] = g > 65535 ? 65535 : Math.max(1, Math.ceil(g));
  }
}
/** Runs the prep passes from the saved cursor. false = slice over (resume next frame). */
function prepStep(j: Job): boolean {
  const c = j.c;
  while (j.ps < PREP_PASSES) {
    const p = j.ps, up = p === 2;   // pass 2 walks bottom-up (run merge), pass 4 walks columns
    const last = p === 4 ? c.rw : c.rh, first = up ? c.rh - 1 : 1, end = up ? 1 : last;
    if (!j.pb) {
      j.pb = true; j.pu = first;
      const n = c.pw * c.ph;
      if (p === 0) { c.cls.fill(0, 0, n); c.vis.fill(0, 0, n); }
      else if (p === 1) c.bear.fill(0, 0, n); // bear[] of the padding row is read unguarded
      else if (p === 4) c.tun.fill(0, 0, n);
    }
    const step = up ? -1 : 1;
    while (up ? j.pu >= end : j.pu <= end) {
      const u = j.pu;
      j.pu += step;
      switch (p) {
        case 0: prepRowClass(c, u); break;
        case 1: prepRowColumn(c, u); break;
        case 2: prepRowRun(c, u); break;
        case 3: prepRowArch(c, u); break;
        case 4: prepColTunnel(c, u); break;
        default: prepRowCosts(c, u); break;
      }
      if (over()) return false;
    }
    j.ps++; j.pb = false;
  }
  return true;
}

// ---- solve: anchors seeded, then Dijkstra over cost buckets ----
function link(c: Ctx, l: number, d: number) {
  const { dist, head, nxt, prv } = c;
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
/** false = slice over. A sync job with targets stops as soon as every target is settled (its dist is final). */
function solveStep(j: Job): boolean {
  const c = j.c, n = c.pw * c.ph;
  const { cls, dist, head, vis, nxt, prv, cu, cdg, chz, chg, off } = c;
  if (j.seeding) {
    if (!j.pb) { j.pb = true; j.pu = 1; dist.fill(INF, 0, n); head.fill(-1); }
    while (j.pu <= c.rh) {
      const y = j.pu++;
      for (let x = 1; x <= c.rw; x++) { const l = y * c.pw + x; if (cls[l] === 3) link(c, l, 0); }
      if (over()) return false;
    }
    j.seeding = false; j.pb = false; j.d = 0;
  }
  let d = j.d, ops = 0;
  while (d <= BUDGET) {
    const s = head[d];
    if (s === -1) { d++; continue; }
    const q = nxt[s]; head[d] = q; if (q !== -1) prv[q] = -1;
    if (j.targets > 0 && vis[s] === 4) { vis[s] = 5; if (--j.targets === 0) { j.d = d; return true; } }
    const sg = cls[s] === 2;
    for (let k = 0; k < 8; k++) {
      const t = s + off[k], ct = cls[t];
      if (ct === 0 || ct === 3) continue;
      let cost: number;
      if (sg || ct === 2) { if (k !== 1) continue; cost = GRAN_COST; } // granular: straight up only
      else cost = k === 1 ? cu[t] : (k === 0 || k === 2) ? cdg[t] : (k === 3 || k === 4) ? chz[t] : chg[t];
      const nd = d + cost;
      if (nd <= BUDGET && nd < dist[t]) link(c, t, nd);
    }
    if (++ops === 64) { ops = 0; if (over()) { j.d = d; return false; } }
  }
  j.d = d;
  return true;
}

// ---- commit: failing groups detach (snow) or fall (rigid pieces) ----
function noteChange(j: Job, l: number) {
  const c = j.c, x = c.rx0 + (l % c.pw) - 1, y = c.ry0 + ((l / c.pw) | 0) - 1;
  if (!j.changed) { j.changed = true; j.mx0 = j.mx1 = x; j.my0 = j.my1 = y; return; }
  if (x < j.mx0) j.mx0 = x; if (x > j.mx1) j.mx1 = x; if (y < j.my0) j.my0 = y; if (y > j.my1) j.my1 = y;
}
function spawnBody(j: Job, list: Int32Array, n: number): boolean {
  const c = j.c;
  const cells: number[] = new Array(n);
  let wood = 0;
  for (let k = 0; k < n; k++) { const l = list[k]; cells[k] = wIdx(c, l); if (isWoodM(c.lm[l])) wood++; }
  const b = makeBody(cells, wood * 2 > n ? 'beam' : (wood > 0 ? 'beam' : 'debris'));
  if (!b) return false;
  for (let k = 0; k < n; k++) noteChange(j, list[k]);
  return true;
}
/** every listed cell still holds what the snapshot says (nothing dug, moved or occupied by a body meanwhile) */
function membersMatch(c: Ctx, list: Int32Array, n: number): boolean {
  for (let k = 0; k < n; k++) { const l = list[k]; if (eff(wIdx(c, l)) !== c.lm[l]) return false; }
  return true;
}
/** a stale group is not committed: its rect goes back on the queue and is solved again from a fresh snapshot */
function requeueLocal(j: Job, x0: number, y0: number, x1: number, y1: number) {
  const c = j.c;
  markStruct(c.rx0 + x0 - 1, c.ry0 + y0 - 1, c.rx0 + x1 - 1, c.ry0 + y1 - 1);
}
function startGroup(j: Job, l: number) {
  const c = j.c, pw = c.pw;
  c.grp[0] = l; c.vis[l] = 2; j.gn = 1; j.gk = 0; j.gcon = false;
  const ly = (l / pw) | 0, lx = l - ly * pw;
  j.bx0 = j.bx1 = lx; j.by0 = j.by1 = ly;
}
/** a rigid non-snow piece of a failing group falls as its own body */
function rigidPiece(j: Job, l0: number) {
  const c = j.c, pw = c.pw, vis = c.vis, lm = c.lm, sub = c.sub;
  let m = 1; sub[0] = l0; vis[l0] = 3;
  const ly0 = (l0 / pw) | 0, lx0 = l0 - ly0 * pw;
  let x0 = lx0, x1 = lx0, y0 = ly0, y1 = ly0;
  for (let q = 0; q < m; q++) {
    const l = sub[q];
    for (let d = 0; d < 4; d++) {
      const t = l + (d === 0 ? -pw : d === 1 ? pw : d === 2 ? -1 : 1);
      if (vis[t] === 2 && lm[t] !== M.SNOW) {
        vis[t] = 3; sub[m++] = t;
        const ty = (t / pw) | 0, tx = t - ty * pw;
        if (tx < x0) x0 = tx; if (tx > x1) x1 = tx; if (ty < y0) y0 = ty; if (ty > y1) y1 = ty;
      }
    }
  }
  if (!membersMatch(c, sub, m)) { requeueLocal(j, x0, y0, x1, y1); return; }
  if (spawnBody(j, sub, m)) frameBodies++;
}
function commitStep(j: Job): boolean {
  const c = j.c, pw = c.pw, rw = c.rw, rh = c.rh;
  const cls = c.cls, vis = c.vis, dist = c.dist, grp = c.grp, lm = c.lm;
  for (;;) {
    switch (j.cs) {
      case CS_MARK: { // which structural cells the flow did not reach
        while (j.cy <= rh) {
          const y = j.cy++;
          for (let x = 1; x <= rw; x++) {
            const l = y * pw + x, f = cls[l] === 1 && dist[l] === INF;
            vis[l] = f ? 1 : 0; if (f) j.nfail++;
          }
          if (over()) return false;
        }
        if (j.nfail === 0) return true;
        j.cs = CS_SCAN; j.cy = 1; j.cx = 1;
        continue;
      }
      case CS_SCAN: { // next failing cell in row-major order starts a group
        let l = -1;
        while (j.cy <= rh) {
          const base = j.cy * pw;
          while (j.cx <= rw) { const t = base + j.cx++; if (vis[t] === 1) { l = t; break; } }
          if (l >= 0) break;
          j.cy++; j.cx = 1;
          if (over()) return false;
        }
        if (l < 0) return finishJob(j);
        startGroup(j, l);
        j.cs = CS_FLOOD;
        continue;
      }
      case CS_FLOOD: { // 4-connected failing group; contact = touches a non-failing structural cell or an anchor
        while (j.gk < j.gn) {
          const l = grp[j.gk++];
          for (let d = 0; d < 4; d++) {
            const t = l + (d === 0 ? -pw : d === 1 ? pw : d === 2 ? -1 : 1);
            if (vis[t] === 1) {
              vis[t] = 2; grp[j.gn++] = t;
              const ty = (t / pw) | 0, tx = t - ty * pw;
              if (tx < j.bx0) j.bx0 = tx; if (tx > j.bx1) j.bx1 = tx; if (ty < j.by0) j.by0 = ty; if (ty > j.by1) j.by1 = ty;
            } else if (vis[t] === 0 && (cls[t] === 1 || cls[t] === 3)) j.gcon = true;
          }
          if ((j.gk & 63) === 0 && over()) return false;
        }
        j.cs = CS_DECIDE;
        continue;
      }
      case CS_DECIDE: {
        if (!membersMatch(c, grp, j.gn)) { // changed since the snapshot: leave it to a fresh solve
          requeueLocal(j, j.bx0, j.by0, j.bx1, j.by1);
          for (let k = 0; k < j.gn; k++) vis[grp[k]] = 0;
          j.cs = CS_SCAN;
          continue;
        }
        const n = j.gn;
        if (!j.gcon && n >= MIN_ISLAND && n <= MAX_ISLAND && spawnBody(j, grp, n)) {
          frameBodies++;
          for (let k = 0; k < n; k++) vis[grp[k]] = 3;
          j.cs = CS_SCAN;
          continue;
        }
        j.cs = CS_SNOW; j.gi = 0;
        continue;
      }
      case CS_SNOW: { // attached failure: snow loses cohesion
        while (j.gi < j.gn) {
          const l = grp[j.gi++];
          if (lm[l] === M.SNOW) {
            const wi = wIdx(c, l);
            if (eff(wi) === M.SNOW) {
              set(wi % W, (wi / W) | 0, M.SNOW, Math.min(dens[wi], 400), 0, flags[wi] | F_DIST);
              frameCollapsed++; noteChange(j, l);
            }
          }
          if ((j.gi & 63) === 0 && over()) return false;
        }
        j.cs = CS_SUB; j.gi = 0;
        continue;
      }
      case CS_SUB: { // rigid non-snow sub-groups fall
        while (j.gi < j.gn) {
          const l0 = grp[j.gi++];
          if (vis[l0] === 2 && lm[l0] !== M.SNOW) rigidPiece(j, l0);
          if ((j.gi & 63) === 0 && over()) return false;
        }
        j.cs = CS_SCAN;
        continue;
      }
    }
  }
}
function finishJob(j: Job): boolean {
  if (j.changed) markStruct(j.mx0, j.my0, j.mx1, j.my1); // cascades resolve on a later pass
  return true;
}

/** Advances the job until it finishes (true) or the slice is over (false). */
function runJob(j: Job): boolean {
  if (j.st === ST_PREP) { if (!prepStep(j)) return false; j.st = ST_SOLVE; }
  if (j.st === ST_SOLVE) { if (!solveStep(j)) return false; j.st = ST_COMMIT; }
  if (j.st === ST_COMMIT) { if (!commitStep(j)) return false; j.st = ST_IDLE; }
  return true;
}
/** Takes the rect snapshot and starts a job on it; false if the rect is too small. */
function startJob(x0: number, y0: number, x1: number, y1: number): boolean {
  if (!loadRect(JOB.c, x0, y0, x1, y1)) return false;
  resetJob(JOB);
  JOB.st = ST_PREP;
  return true;
}

// ---------------- queue ----------------
const pend: number[] = []; // flat x0,y0,x1,y1 (already expanded + clamped)
let qT = 0, sT = 0, clock = 0;
let batch = 0;                                      // rects of the current queue batch still to start
const fresh = new Map<number, number>();            // beamId -> clock at which its grace ends
const freshRects: number[] = [];                    // flat t,x0,y0,x1,y1 (re-check when the grace ends)

/** A beam was just placed: judge it as part of the final structure — it is held up for BEAM_GRACE seconds, then checked for real. */
export function freshBeam(bid: number, x0: number, y0: number, x1: number, y1: number): void {
  if (!bid) return;
  fresh.set(bid, clock + BEAM_GRACE);
  freshRects.push(clock + BEAM_GRACE + 0.02, x0, y0, x1, y1);
}

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

/** merges overlapping pending rects (a merge that would exceed MAXD is skipped unless forced) */
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

/** Starts the next job, with the old priorities: a queue tick (up to two merged rects), else the sweep when due. */
function pickJob(): void {
  if (batch === 0 && pend.length && qT >= QUEUE_PERIOD) {
    qT = 0; mergePending(); batch = Math.min(2, pend.length >> 2);
  } else if (batch === 0 && sT >= SWEEP_PERIOD) {
    sT = 0;
    const px = Math.round(G.player.x), py = Math.round(G.player.y);
    startJob(px - (SWEEP_W >> 1), py - (SWEEP_H >> 1), px + (SWEEP_W >> 1) - 1, py + (SWEEP_H >> 1) - 1);
    return;
  }
  while (batch > 0 && pend.length) {
    batch--;
    const a = pend[0], b = pend[1], c = pend[2], d = pend[3];
    pend.copyWithin(0, 4); pend.length -= 4;
    if (startJob(a, b, c, d)) return;
  }
  if (!pend.length) batch = 0;
}

const RES = { collapsed: 0, bodies: 0 };
export function stepStructure(dt: number): { collapsed: number; bodies: number } {
  qT += dt; sT += dt; clock += dt;
  if (freshRects.length && freshRects[0] <= clock) {
    let w = 0;
    for (let i = 0; i < freshRects.length; i += 5) {
      if (freshRects[i] > clock) {
        for (let q = 0; q < 5; q++) freshRects[w + q] = freshRects[i + q];
        w += 5;
      } else markStruct(freshRects[i + 1] - 4, freshRects[i + 2] - 4, freshRects[i + 3] + 4, freshRects[i + 4] + 4);
    }
    freshRects.length = w;
    for (const [id, t] of fresh) if (t <= clock) fresh.delete(id);
  }
  frameCollapsed = 0; frameBodies = 0;
  sliceEnd = performance.now() + SLICE_MS;
  for (;;) {
    if (JOB.st === ST_IDLE) {
      if (over()) break;
      pickJob();
      if (JOB.st === ST_IDLE) break;
    }
    if (!runJob(JOB)) break;     // slice over: resume next frame
    if (over()) break;
  }
  if (frameCollapsed > 0) wake(Math.round(G.player.x), Math.round(G.player.y));
  RES.collapsed = frameCollapsed; RES.bodies = frameBodies;
  return RES;
}

// ---------------- synchronous queries ----------------
function syncJob(): Job { return SYNC ?? (SYNC = makeJob()); }
/** runs prep and solve to completion on the synchronous context; targets > 0 stops once they are settled */
function syncSolve(j: Job, targets: number): void {
  sliceEnd = Infinity;
  resetJob(j);
  prepStep(j);
  j.targets = targets;
  solveStep(j);
}

/** Placement preview: remaining support budget (0..1) of the weakest new cell; 0 = would fail. */
export function supportMargin(cells: { x: number; y: number; m: number; d: number; b: number }[]): number {
  if (cells.length === 0) return 1;
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (const c of cells) { if (c.x < x0) x0 = c.x; if (c.x > x1) x1 = c.x; if (c.y < y0) y0 = c.y; if (c.y > y1) y1 = c.y; }
  const j = syncJob(), cx = j.c;
  sliceEnd = Infinity;
  if (!loadRect(cx, x0 - PAD, y0 - PAD, x1 + PAD, y1 + PAD)) return 1;
  for (const c of cells) {
    const lx = c.x - cx.rx0, ly = c.y - cx.ry0;
    if (lx < 0 || ly < 0 || lx >= cx.rw || ly >= cx.rh) continue;
    const l = (ly + 1) * cx.pw + lx + 1;
    cx.lm[l] = c.m; cx.lb[l] = c.b; cx.ld[l] = c.d; cx.lf[l] = 0;
  }
  resetJob(j);
  prepStep(j);
  let targets = 0;
  for (const c of cells) {
    const lx = c.x - cx.rx0, ly = c.y - cx.ry0;
    if (lx < 0 || ly < 0 || lx >= cx.rw || ly >= cx.rh) continue;
    const l = (ly + 1) * cx.pw + lx + 1;
    if (cx.cls[l] !== 1 || cx.vis[l] === 4) continue;
    cx.vis[l] = 4; targets++;
  }
  let margin = 1;
  if (targets === 0) return margin;
  j.targets = targets;
  solveStep(j);
  for (const c of cells) {
    const lx = c.x - cx.rx0, ly = c.y - cx.ry0;
    if (lx < 0 || ly < 0 || lx >= cx.rw || ly >= cx.rh) continue;
    const l = (ly + 1) * cx.pw + lx + 1;
    if (cx.cls[l] !== 1) continue;
    const m = cx.dist[l] === INF ? 0 : 1 - cx.dist[l] / BUDGET;
    if (m < margin) margin = m;
  }
  return margin < 0 ? 0 : margin;
}

/** Diagnostics (no side effects on the world): world indices of structural cells that would fail in the rect. */
export function analyzeRect(x0: number, y0: number, x1: number, y1: number): number[] | null {
  const j = syncJob(), c = j.c;
  sliceEnd = Infinity;
  if (!loadRect(c, x0, y0, x1, y1)) return null;
  syncSolve(j, 0);
  const out: number[] = [];
  for (let y = 1; y <= c.rh; y++) for (let x = 1; x <= c.rw; x++) {
    const l = y * c.pw + x;
    if (c.cls[l] === 1 && c.dist[l] === INF) out.push(wIdx(c, l));
  }
  return out;
}
