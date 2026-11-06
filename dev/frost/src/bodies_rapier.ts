// Rigid bodies (Rapier2D) living inside the cell grid: trees, snow slabs, beams, debris.
// Drop-in alternative to bodies.ts (planck) with the same exported API. Bodies are rasterised
// ("stamped") into the grid every step; terrain is exposed to Rapier either as lazily built
// static cuboid colliders per world chunk ('cuboid', the default) or as ONE world-sized voxel collider that is
// patched incrementally with setVoxel ('voxel'). Switch with globalThis.__FROST_TERRAIN = 'voxel' (before initBodies()).
// Call (and await) initPhysics() once before initBodies().
import RAPIER from '@dimforge/rapier2d-compat';
import {
  M, F_DIST, F_TREE, CH, CW, CHH, W, H, CELL, rigidAt, set as setCell, wake,
  mat, dens, bond, flags, body as bodyGrid, awake, gpuDirty, solidVer,
} from './world';
import { spawn, PK } from './particles';

export type BodyKind = 'tree' | 'slab' | 'beam' | 'debris';
/** Thin planck-like wrapper around a Rapier rigid body. Pose is cached after every physics step. */
export class PhysBody {
  rb: RAPIER.RigidBody; cols: RAPIER.Collider[] = [];
  private px = 0; private py = 0; private ang = 0;
  constructor(rb: RAPIER.RigidBody) { this.rb = rb; this.sync(); }
  sync(): void { const t = this.rb.translation(); this.px = t.x; this.py = t.y; this.ang = this.rb.rotation(); }
  getPosition(): { x: number; y: number } { return { x: this.px, y: this.py }; }
  getAngle(): number { return this.ang; }
  getLinearVelocity(): { x: number; y: number } { const v = this.rb.linvel(); return { x: v.x, y: v.y }; }
  getAngularVelocity(): number { return this.rb.angvel(); }
  setLinearVelocity(v: { x: number; y: number }): void { this.rb.setLinvel(v, false); }
  setAngularVelocity(w: number): void { this.rb.setAngvel(w, false); }
  getMass(): number { return this.rb.mass(); }
  isAwake(): boolean { return !this.rb.isSleeping(); }
  setAwake(a: boolean): void { if (a) this.rb.wakeUp(); else this.rb.sleep(); }
}

export interface BodyRec {
  id: number; kind: BodyKind; b: PhysBody; w: number; h: number;
  lm: Uint8Array; ld: Uint16Array; lf: Uint8Array; lb: Uint8Array; // local bitmap w*h: mat,dens,flags,bond (mat 0 = empty)
  cx: number; cy: number; // local centre of mass (cells, bitmap coords)
  hits: number; massKg: number; stamped: number[]; settle: number;
}

const PPM = 1 / CELL;          // cells per metre (20)
const FIXED = 1 / 60;
const MAX_BODIES = 60;
const MAX_BOXES = 48;
const POWDER = 200;            // snow below this density does not collide
const SHATTER_DV = 2.5;        // m/s
const DRAG_K = 250;            // powder drag strength

export const bodies = new Map<number, BodyRec>();

interface Aux { drag: number; px: number; py: number; ang: number; stamped: boolean; }
const aux = new Map<number, Aux>();
interface Collider { b: RAPIER.RigidBody | null; ver: number; sum: number; last: number; check: number; mask: Uint8Array | null; }
const colliders = new Map<number, Collider>();

type TerrainMode = 'cuboid' | 'voxel';
let terrainMode: TerrainMode = 'cuboid';
let vox: RAPIER.Collider | null = null;      // voxel mode: the single world-sized terrain collider
let voxBody: RAPIER.RigidBody | null = null;
const colToId = new Map<number, number>();   // collider handle -> body id (contact events)
let eq: RAPIER.EventQueue | null = null;
let ready = false;

/** Loads and instantiates the wasm (inlined as base64 in the compat build). Await once before initBodies(). */
export async function initPhysics(): Promise<void> {
  if (ready) return;
  await RAPIER.init();
  ready = true;
}

let pw: RAPIER.World | null = null;
let nextId = 1;
let clock = 0;
let acc = 0;
const hitMax = new Map<number, { dv: number; x: number; y: number }>();
const shatterQ = new Set<number>();
const scratch = new Uint16Array(CH * CH);

export function initBodies(): void {
  if (!ready) throw new Error('bodies_rapier: await initPhysics() before initBodies()');
  if (pw) pw.free();
  if (eq) eq.free();
  bodies.clear(); aux.clear(); colliders.clear(); hitMax.clear(); shatterQ.clear(); colToId.clear();
  vox = null; voxBody = null;
  const mode = (globalThis as { __FROST_TERRAIN?: string }).__FROST_TERRAIN;
  terrainMode = mode === 'voxel' ? 'voxel' : 'cuboid';
  nextId = 1; clock = 0; acc = 0;
  pw = new RAPIER.World({ x: 0, y: 9.8 });
  pw.timestep = FIXED;
  pw.numSolverIterations = 4;
  eq = new RAPIER.EventQueue(true);
}

/** Tear everything down (engine switch): bodies, terrain colliders / voxel collider, event queue and the wasm world. */
export function disposeBodies(): void {
  if (pw) {
    for (const e of colliders.values()) { if (e.b) pw.removeRigidBody(e.b); e.b = null; e.mask = null; }
    if (vox) { pw.removeCollider(vox, false); vox = null; }
    if (voxBody) { pw.removeRigidBody(voxBody); voxBody = null; }
    for (const r of bodies.values()) pw.removeRigidBody(r.b.rb);
    pw.free(); pw = null;
  }
  if (eq) { eq.free(); eq = null; }
  bodies.clear(); aux.clear(); colliders.clear(); hitMax.clear(); shatterQ.clear(); colToId.clear();
  vox = null; voxBody = null;
}

function drainImpacts(): void {
  eq!.drainContactForceEvents((ev) => {
    const h1 = ev.collider1(), h2 = ev.collider2();
    const sum = ev.totalForceMagnitude() * FIXED; // N * s = impulse
    if (sum <= 0) return;
    for (const h of [h1, h2]) {
      const id = colToId.get(h);
      const rec = id ? bodies.get(id) : undefined;
      if (!rec || rec.massKg <= 0) continue;
      const dv = sum / rec.massKg;
      const prev = hitMax.get(id!);
      if (!prev || dv > prev.dv) {
        let x = rec.b.getPosition().x, y = rec.b.getPosition().y;
        if (dv > 0.6) { // only locate the contact point for hits that matter
          const c1 = pw!.getCollider(h1), c2 = pw!.getCollider(h2);
          if (c1 && c2) pw!.contactPair(c1, c2, (m) => { const q = m.numSolverContacts() ? m.solverContactPoint(0) : null; if (q) { x = q.x; y = q.y; } });
        }
        hitMax.set(id!, { dv, x: x * PPM, y: y * PPM });
      }
    }
  });
}

// ---------------------------------------------------------------- helpers
function cellKey(m: number, d: number): number { // fixture density, kg/m^2 (bucketed); 0 = no collision
  let v: number;
  switch (m) {
    case M.AIR: case M.NEEDLE: case M.WATER: return 0;
    case M.WOOD: case M.PLANK: case M.POLE: v = 500 * 0.3; break;
    case M.SNOW: v = Math.max(40, d) * 0.6; break;
    case M.ICE: v = 917 * 0.6; break;
    case M.CRATE: v = 300 * 0.3; break;
    case M.DIRT: case M.ROCK: case M.BEDROCK: v = 1500 * 0.3; break;
    default: v = 100 * 0.3;
  }
  return Math.max(10, Math.round(v / 10) * 10);
}

/** Greedy rectangle decomposition of equal non-zero keys. Mutates `keys`. Pushes x,y,w,h,key. */
function greedy(keys: Uint16Array, w: number, h: number, out: number[]): void {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = keys[y * w + x]; if (!k) continue;
    let rw = 1; while (x + rw < w && keys[y * w + x + rw] === k) rw++;
    let rh = 1;
    grow: while (y + rh < h) { for (let i = 0; i < rw; i++) if (keys[(y + rh) * w + x + i] !== k) break grow; rh++; }
    for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) keys[(y + j) * w + x + i] = 0;
    out.push(x, y, rw, rh, k);
  }
}

function buildFixtures(rec: BodyRec): number {
  const { w, h, lm, ld, b } = rec;
  for (const c of b.cols) { colToId.delete(c.handle); pw!.removeCollider(c, false); }
  b.cols.length = 0;
  let rects: number[] = [], f = 1;
  for (; f <= 8; f *= 2) {
    const gw = Math.ceil(w / f), gh = Math.ceil(h / f), keys = new Uint16Array(gw * gh);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const g = (y / f | 0) * gw + (x / f | 0);
      if (keys[g]) continue;
      keys[g] = cellKey(lm[y * w + x], ld[y * w + x]);
    }
    rects = []; greedy(keys, gw, gh, rects);
    if (rects.length / 5 <= MAX_BOXES) break;
  }
  if (f > 8) f = 8;
  let est = 0;
  for (let n = 0; n < rects.length; n += 5) {
    const x0 = rects[n] * f, y0 = rects[n + 1] * f;
    const x1 = Math.min(w, x0 + rects[n + 2] * f), y1 = Math.min(h, y0 + rects[n + 3] * f);
    est += (x1 - x0) * (y1 - y0) * CELL * CELL * rects[n + 4];
  }
  const thr = 0.3 * est / FIXED;
  for (let n = 0; n < rects.length; n += 5) {
    const x0 = rects[n] * f, y0 = rects[n + 1] * f;
    const x1 = Math.min(w, x0 + rects[n + 2] * f), y1 = Math.min(h, y0 + rects[n + 3] * f);
    const desc = RAPIER.ColliderDesc.cuboid((x1 - x0) * CELL / 2, (y1 - y0) * CELL / 2)
      .setTranslation(((x0 + x1) / 2 - rec.cx) * CELL, ((y0 + y1) / 2 - rec.cy) * CELL)
      .setDensity(rects[n + 4]).setFriction(0.6).setRestitution(0.05)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(thr);
    const col = pw!.createCollider(desc, b.rb);
    b.cols.push(col); colToId.set(col.handle, rec.id);
  }
  rec.massKg = b.rb.mass();
  return rects.length / 5;
}

interface Box { x0: number; y0: number; x1: number; y1: number; }
const bb: Box = { x0: 0, y0: 0, x1: 0, y1: 0 };
/** Tight world-cell AABB of the rotated bitmap. */
function bounds(rec: BodyRec, out: Box = bb): Box {
  const p = rec.b.getPosition(), a = rec.b.getAngle(), c = Math.cos(a), s = Math.sin(a);
  const px = p.x * PPM, py = p.y * PPM;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let k = 0; k < 4; k++) {
    const lx = (k & 1 ? rec.w : 0) - rec.cx, ly = (k & 2 ? rec.h : 0) - rec.cy;
    const wx = px + c * lx - s * ly, wy = py + s * lx + c * ly;
    if (wx < x0) x0 = wx; if (wx > x1) x1 = wx; if (wy < y0) y0 = wy; if (wy > y1) y1 = wy;
  }
  out.x0 = x0; out.y0 = y0; out.x1 = x1; out.y1 = y1;
  return out;
}

// ---------------------------------------------------------------- creation / lookup
export function bodyAtIndex(i: number): BodyRec | null {
  const id = bodyGrid[i];
  return id ? bodies.get(id) ?? null : null;
}

interface Gathered { list: number[]; x0: number; y0: number; x1: number; y1: number; }
/** Free (unbodied, non-air) cells of the request; null if fewer than 4 or nothing solid (only needles). */
function gather(cells: number[]): Gathered | null {
  const list: number[] = [];
  let x0 = W, y0 = H, x1 = -1, y1 = -1, solid = false;
  for (const i of cells) {
    if (mat[i] === M.AIR || bodyGrid[i] !== 0) continue;
    list.push(i);
    if (!solid && cellKey(mat[i], dens[i]) !== 0) solid = true;
    const x = i % W, y = (i / W) | 0;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (list.length < 4 || !solid) return null;
  return { list, x0, y0, x1, y1 };
}

export function makeBody(cells: number[], kind: BodyKind, vx = 0, vy = 0, av = 0): BodyRec | null {
  if (!pw) initBodies();
  let g = gather(cells);
  if (!g) return null; // nothing to make: do not evict anybody for it
  if (bodies.size >= MAX_BODIES) {
    let victim: BodyRec | undefined;
    for (const r of bodies.values()) if ((r.kind === 'slab' || r.kind === 'debris') && r.settle > 0.2) { victim = r; break; }
    if (!victim) for (const r of bodies.values()) if (r.kind === 'slab' || r.kind === 'debris') { victim = r; break; }
    if (!victim) for (const r of bodies.values()) if (r.kind !== 'tree') { victim = r; break; }
    if (!victim) return null;
    removeBody(victim, true);
    g = gather(cells); // the evicted body's cells may have landed in / displaced ours
    if (!g) return null;
  }
  const { list, x0, y0, x1, y1 } = g;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const lm = new Uint8Array(w * h), ld = new Uint16Array(w * h), lf = new Uint8Array(w * h), lb = new Uint8Array(w * h);
  let sx = 0, sy = 0, sw = 0;
  for (const i of list) {
    const x = i % W, y = (i / W) | 0, k = (y - y0) * w + (x - x0);
    lm[k] = mat[i]; ld[k] = dens[i]; lf[k] = flags[i]; lb[k] = bond[i];
    const wt = cellKey(mat[i], dens[i]);
    sx += (x - x0 + 0.5) * wt; sy += (y - y0 + 0.5) * wt; sw += wt;
  }
  if (sw === 0) return null; // only needles
  const cx = sx / sw, cy = sy / sw;
  for (const i of list) setCell(i % W, (i / W) | 0, M.AIR);

  const id = allocId();
  const b = new PhysBody(pw!.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation((x0 + cx) * CELL, (y0 + cy) * CELL)
      .setLinvel(vx, vy).setAngvel(av).setCcdEnabled(true)
      .setAngularDamping(kind === 'tree' ? 0.4 : 0.05).setLinearDamping(0.02),
  ));
  const rec: BodyRec = { id, kind, b, w, h, lm, ld, lf, lb, cx, cy, hits: 0, massKg: 1, stamped: [], settle: 0 };
  buildFixtures(rec);
  bodies.set(id, rec);
  aux.set(id, { drag: 0, px: 0, py: 0, ang: 0, stamped: false });
  stampBody(rec);
  return rec;
}

function allocId(): number {
  for (let n = 0; n < 65535; n++) {
    const id = nextId; nextId = nextId >= 65535 ? 1 : nextId + 1;
    if (!bodies.has(id)) return id;
  }
  return 1;
}

/** Call after editing a body's bitmap (chopping): rebuilds fixtures and mass. Removes the body if empty. */
export function refreshBody(rec: BodyRec): void {
  let solid = 0;
  for (let k = 0; k < rec.lm.length; k++) if (cellKey(rec.lm[k], rec.ld[k])) solid++;
  if (solid < 2) { removeBody(rec, false); return; }
  buildFixtures(rec);
  const a = aux.get(rec.id); if (a) a.stamped = false;
  rec.b.setAwake(true);
}

// ---------------------------------------------------------------- stamping
type PaintMode = 0 | 1 | 2; // stamp | settle (rasterise) | shatter (rasterise as loose snow)

function eraseStamp(rec: BodyRec): void {
  const id = rec.id; let lastC = -1;
  for (const i of rec.stamped) {
    if (bodyGrid[i] !== id) continue;
    mat[i] = 0; dens[i] = 0; bond[i] = 0; flags[i] = 0; bodyGrid[i] = 0;
    const x = i % W, y = (i / W) | 0, c = ((y / CH) | 0) * CW + ((x / CH) | 0);
    if (c !== lastC) { lastC = c; wake(x, y); }
  }
  rec.stamped.length = 0;
}

/** Push a powder cell up to the nearest AIR within 6 cells (else delete it). Returns the cell's mass in kg. */
function displace(x: number, y: number): number {
  const i = y * W + x, kg = dens[i] * CELL * CELL * 0.6;
  for (let up = 1; up <= 6 && y - up >= 0; up++) {
    const j = i - up * W;
    if (mat[j] === M.AIR && bodyGrid[j] === 0) {
      mat[j] = mat[i]; dens[j] = dens[i]; bond[j] = bond[i]; flags[j] = flags[i];
      wake(x, y - up);
      break;
    }
  }
  return kg;
}

/** Inverse-map the rotated bitmap onto the grid. Returns displaced powder mass (kg). */
function paint(rec: BodyRec, mode: PaintMode): number {
  const bd = bounds(rec), p = rec.b.getPosition(), a = rec.b.getAngle(), c = Math.cos(a), s = Math.sin(a);
  const px = p.x * PPM, py = p.y * PPM, id = rec.id, { w, h, lm, ld, lf, lb } = rec;
  const xs = Math.max(0, Math.floor(bd.x0)), xe = Math.min(W - 1, Math.ceil(bd.x1));
  const ys = Math.max(0, Math.floor(bd.y0)), ye = Math.min(H - 1, Math.ceil(bd.y1));
  let dm = 0, lastC = -1, placed = 0, sumX = 0, sumY = 0;
  for (let y = ys; y <= ye; y++) {
    for (let x = xs; x <= xe; x++) {
      const dx = x + 0.5 - px, dy = y + 0.5 - py;
      const lx = Math.floor(c * dx + s * dy + rec.cx), ly = Math.floor(-s * dx + c * dy + rec.cy);
      if (lx < 0 || ly < 0 || lx >= w || ly >= h) continue;
      const k = ly * w + lx, m = lm[k];
      if (m === 0) continue;
      const i = y * W + x, t = mat[i];
      if (bodyGrid[i] !== 0 && bodyGrid[i] !== id) continue;
      if (t !== M.AIR) {
        if (rigidAt(i) || t === M.NEEDLE || t === M.WATER) continue;
        if (t === M.SNOW && dens[i] >= POWDER) continue; // dense snow collides, never overwritten
        if (mode === 0) dm += displace(x, y); else displace(x, y);
      }
      if (mode === 0) {
        mat[i] = m; dens[i] = ld[k]; flags[i] = lf[k]; bond[i] = lb[k]; bodyGrid[i] = id;
        rec.stamped.push(i);
        const ci = ((y / CH) | 0) * CW + ((x / CH) | 0);
        if (ci !== lastC) { lastC = ci; wake(x, y); }
      } else {
        let b = lb[k], f = lf[k] & ~F_TREE; // a felled tree is no longer rooted
        if (mode === 2) { b = 0; f |= F_DIST; } else if (m === M.SNOW) { b = Math.round(b * 0.7); f |= F_DIST; }
        setCell(x, y, m, ld[k], b, f);
        placed++; sumX += x; sumY += y;
      }
    }
  }
  if (mode === 2 && placed > 0) {
    const n = Math.min(24, 4 + (placed / 40 | 0));
    for (let q = 0; q < n; q++) {
      const ang = Math.random() * Math.PI * 2, sp = 10 + Math.random() * 40;
      spawn(PK.DUST, sumX / placed + (Math.random() - 0.5) * rec.w * 0.6, sumY / placed + (Math.random() - 0.5) * rec.h * 0.6,
        Math.cos(ang) * sp, Math.sin(ang) * sp - 15, 0.5 + Math.random() * 0.6, 1);
    }
  }
  return dm;
}

function stampBody(rec: BodyRec): void {
  const a = aux.get(rec.id)!, p = rec.b.getPosition(), ang = rec.b.getAngle();
  if (a.stamped && p.x === a.px && p.y === a.py && ang === a.ang && rec.stamped.length) return;
  eraseStamp(rec);
  a.drag = paint(rec, 0);
  a.px = p.x; a.py = p.y; a.ang = ang; a.stamped = true;
}

function rasterize(rec: BodyRec, mode: 1 | 2): void {
  eraseStamp(rec);
  paint(rec, mode);
}

export function removeBody(rec: BodyRec, rasterizeCells: boolean): void {
  if (!bodies.has(rec.id)) return;
  if (rasterizeCells) rasterize(rec, 1); else eraseStamp(rec);
  bodies.delete(rec.id); aux.delete(rec.id); hitMax.delete(rec.id); shatterQ.delete(rec.id);
  destroyPhys(rec);
}

function destroyPhys(rec: BodyRec): void {
  for (const c of rec.b.cols) colToId.delete(c.handle);
  pw!.removeRigidBody(rec.b.rb);
}

export function impulseAt(rec: BodyRec, x: number, y: number, ix: number, iy: number): void {
  if (!bodies.has(rec.id)) return;
  rec.b.rb.applyImpulseAtPoint({ x: ix, y: iy }, { x: x * CELL, y: y * CELL }, true);
  rec.b.setAwake(true);
  rec.hits++;
}

// ---------------------------------------------------------------- terrain colliders
function collide(i: number): boolean {
  if (bodyGrid[i] !== 0) return false;
  return rigidAt(i) || (mat[i] === M.SNOW && dens[i] >= POWDER);
}

/** Fills `scratch` with 1 where terrain collides; returns an order-independent checksum (count in low bits). */
function scanChunk(c: number): number {
  const x0 = (c % CW) * CH, y0 = ((c / CW) | 0) * CH;
  let sum = 0, n = 0;
  for (let y = 0; y < CH; y++) {
    const row = (y0 + y) * W + x0;
    for (let x = 0; x < CH; x++) {
      if (collide(row + x)) { scratch[y * CH + x] = 1; n++; sum = (sum + Math.imul(y * CH + x + 1, 2654435761)) | 0; }
      else scratch[y * CH + x] = 0;
    }
  }
  return n === 0 ? 0 : (sum ^ n) | 1;
}

function wakeNear(x0: number, y0: number): void { // terrain changed under sleeping bodies: let them fall
  for (const r of bodies.values()) {
    if (r.b.isAwake()) continue;
    const bd = bounds(r);
    if (bd.x1 + 4 >= x0 && bd.x0 - 4 <= x0 + CH && bd.y1 + 4 >= y0 && bd.y0 - 4 <= y0 + CH) r.b.setAwake(true);
  }
}

function buildChunk(c: number, e: Collider, wakeBodies: boolean): void {
  const x0 = (c % CW) * CH, y0 = ((c / CW) | 0) * CH;
  e.ver = solidVer[c];
  if (terrainMode === 'voxel') applyVoxels(x0, y0, e);
  else {
    if (e.b) { pw!.removeRigidBody(e.b); e.b = null; }
    const rects: number[] = []; greedy(scratch, CH, CH, rects);
    if (rects.length) {
      const b = pw!.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x0 * CELL, y0 * CELL));
      for (let n = 0; n < rects.length; n += 5) {
        pw!.createCollider(
          RAPIER.ColliderDesc.cuboid(rects[n + 2] * CELL / 2, rects[n + 3] * CELL / 2)
            .setTranslation((rects[n] + rects[n + 2] / 2) * CELL, (rects[n + 1] + rects[n + 3] / 2) * CELL)
            .setFriction(0.6).setRestitution(0.05),
          b,
        );
      }
      e.b = b;
    }
  }
  if (wakeBodies) wakeNear(x0, y0);
}

/** Voxel mode: diff `scratch` against the chunk's previous mask and patch the single world voxel collider. */
function applyVoxels(x0: number, y0: number, e: Collider): void {
  const old = e.mask;
  if (!vox) {
    const list: number[] = [];
    for (let k = 0; k < CH * CH; k++) if (scratch[k]) list.push(x0 + (k % CH), y0 + ((k / CH) | 0));
    if (!list.length) return;
    voxBody = pw!.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    vox = pw!.createCollider(
      RAPIER.ColliderDesc.voxels(new Int32Array(list), { x: CELL, y: CELL }).setFriction(0.6).setRestitution(0.05), voxBody);
    e.mask = new Uint8Array(scratch);
    return;
  }
  const mask = old ?? new Uint8Array(CH * CH);
  for (let k = 0; k < CH * CH; k++) {
    const nv = scratch[k], ov = mask[k];
    if (nv === ov) continue;
    vox.setVoxel(x0 + (k % CH), y0 + ((k / CH) | 0), nv !== 0);
    mask[k] = nv;
  }
  e.mask = mask;
}

function unloadChunk(c: number, e: Collider): void {
  if (e.b) { pw!.removeRigidBody(e.b); e.b = null; }
  if (e.mask && vox) {
    const x0 = (c % CW) * CH, y0 = ((c / CW) | 0) * CH;
    for (let k = 0; k < CH * CH; k++) if (e.mask[k]) vox.setVoxel(x0 + (k % CH), y0 + ((k / CH) | 0), false);
  }
  e.mask = null;
}

function updateColliders(): void {
  const need = new Set<number>();
  for (const r of bodies.values()) {
    const bd = bounds(r);
    const cx0 = Math.max(0, ((bd.x0 / CH) | 0) - 1), cx1 = Math.min(CW - 1, ((bd.x1 / CH) | 0) + 1);
    const cy0 = Math.max(0, ((bd.y0 / CH) | 0) - 1), cy1 = Math.min(CHH - 1, ((bd.y1 / CH) | 0) + 1);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) need.add(cy * CW + cx);
  }
  let budget = 16;
  for (const c of need) {
    let e = colliders.get(c);
    if (!e) { e = { b: null, ver: -1, sum: -1, last: clock, check: clock, mask: null }; colliders.set(c, e); }
    e.last = clock;
    const fresh = e.ver === -1;
    if (budget > 0 && (fresh || solidVer[c] !== e.ver || clock - e.check > 0.25)) {
      e.check = clock;
      const sum = scanChunk(c);
      if (fresh || sum !== e.sum || solidVer[c] !== e.ver) { e.sum = sum; buildChunk(c, e, !fresh); budget--; }
    }
  }
  for (const [c, e] of colliders) {
    if (clock - e.last > 3) { unloadChunk(c, e); colliders.delete(c); }
  }
}

// ---------------------------------------------------------------- main step
const impactsBuf: { x: number; y: number; massKg: number; speed: number }[] = [];   // reused every call (the caller consumes it immediately)
const outOfWorldBuf: BodyRec[] = [], settledBuf: BodyRec[] = [];
const retObj = { impacts: impactsBuf };
export function stepBodies(dt: number): { impacts: { x: number; y: number; massKg: number; speed: number }[] } {
  const impacts = impactsBuf; impacts.length = 0;
  if (!pw) initBodies();
  clock += dt;
  if (bodies.size === 0) { updateColliders(); return retObj; }
  updateColliders();

  acc = Math.min(acc + dt, FIXED * 4);
  while (acc >= FIXED) {
    acc -= FIXED;
    for (const r of bodies.values()) { // powder drag from last stamp
      const a = aux.get(r.id)!;
      if (a.drag <= 0 || !r.b.isAwake()) continue;
      const k = Math.min(0.6, a.drag * DRAG_K / Math.max(1, r.massKg) * FIXED);
      const v = r.b.getLinearVelocity();
      r.b.setLinearVelocity({ x: v.x * (1 - k), y: v.y * (1 - k * 0.7) });
      r.b.setAngularVelocity(r.b.getAngularVelocity() * (1 - k * 0.5));
    }
    pw!.step(eq!);
    drainImpacts();
    for (const r of bodies.values()) r.b.sync();
    for (const [id, h] of hitMax) {
      const r = bodies.get(id); if (!r) continue;
      if (h.dv > 0.6) {
        impacts.push({ x: h.x, y: h.y, massKg: r.massKg, speed: h.dv });
        if (h.dv > 1.5) r.hits++;
        if (r.kind === 'slab' && h.dv > SHATTER_DV) shatterQ.add(id);
      }
    }
    hitMax.clear();
  }

  for (const id of shatterQ) {
    const r = bodies.get(id); if (!r) continue;
    rasterize(r, 2);
    bodies.delete(id); aux.delete(id); destroyPhys(r);
  }
  shatterQ.clear();

  const outOfWorld = outOfWorldBuf, settled = settledBuf; outOfWorld.length = 0; settled.length = 0;
  for (const r of bodies.values()) {
    const p = r.b.getPosition();
    if (p.y > H * CELL + 10 || p.x < -10 || p.x > W * CELL + 10) { outOfWorld.push(r); continue; }
    if (r.kind === 'slab' || r.kind === 'debris') {
      const v = r.b.getLinearVelocity();
      if (Math.hypot(v.x, v.y) < 0.15 && Math.abs(r.b.getAngularVelocity()) < 0.2) r.settle += dt; else r.settle = 0;
      if (r.settle > 0.6) { settled.push(r); continue; }
    }
    stampBody(r);
  }
  for (const r of outOfWorld) removeBody(r, false);
  for (const r of settled) removeBody(r, true);
  return retObj;
}
