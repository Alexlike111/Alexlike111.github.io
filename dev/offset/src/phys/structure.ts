// Destructible world: convex chunks, adjacency graph, anchored connectivity, islands → rigid clusters → shards.
import { RAPIER, Phys, GR, CRef } from './world';
import { voronoi, gridSeeds, impactSeeds, bricks, rectPoly, polyBounds } from './fracture';
import { polyCentroid, clipHalfPlane, cleanPoly, polyArea } from '../core/math';
import { Rng } from '../core/rng';
import { T, MATS, Mat, MatId } from '../core/tune';
import { bus } from '../core/bus';
import { Renderer, ink, Ink } from '../gfx/gl';

export interface FxSink {
  scrap(x: number, y: number, vx: number, vy: number, size: number, k: Ink, life?: number): void;
  dust(x: number, y: number, r: number, k: Ink, vx?: number, vy?: number): void;
}

let CID = 1;
export class Chunk {
  id = CID++;
  v: Float32Array; cx = 0; cy = 0; area = 0; r = 0;
  bx0 = 0; by0 = 0; bx1 = 0; by1 = 0;
  hp: number; hp0: number;
  col: RAPIER.Collider | null = null;
  nb: Chunk[] = [];
  anchor = false; alive = true; stamp = 0;
  shade: number; free = 0xffff; freeDirty = true; gen = 0;
  crack = 0; // 0..1 visual damage
  mark = false; // objective target (demolish)
  constructor(v: ArrayLike<number>, public mat: Mat, public cl: Cluster, shade: number) {
    this.v = Float32Array.from(v as number[]); this.shade = shade; this.hp = this.hp0 = mat.hp;
    this.remeasure();
  }
  remeasure() {
    const [cx, cy, a] = polyCentroid(this.v); this.cx = cx; this.cy = cy; this.area = Math.abs(a);
    const b = polyBounds(this.v); this.bx0 = b[0]; this.by0 = b[1]; this.bx1 = b[2]; this.by1 = b[3];
    let r = 0; for (let i = 0; i < this.v.length; i += 2) r = Math.max(r, Math.hypot(this.v[i] - cx, this.v[i + 1] - cy)); this.r = r;
  }
}
export class Cluster {
  id = CID++;
  chunks: Chunk[] = [];
  life = Infinity; age = 0; dirty = false; shard = false; fade = 1;
  tag: string | null = null; data: any = null; // e.g. 'barrel', 'crate'
  held = false;
  // render transforms (prev / current physics step) for interpolation
  x = 0; y = 0; a = 0; px = 0; py = 0; pa = 0;
  constructor(public rb: RAPIER.RigidBody, public fixed: boolean) { const t = rb.translation(); this.x = this.px = t.x; this.y = this.py = t.y; this.a = this.pa = rb.rotation(); }
  snap() { const t = this.rb.translation(); this.x = this.px = t.x; this.y = this.py = t.y; this.a = this.pa = this.rb.rotation(); }
  get mass() { return this.fixed ? Infinity : this.rb.mass(); }
}

/** which edge of A is shared with B (-1 if none). Same local frame assumed. */
function sharedEdge(a: Float32Array, b: Float32Array): number {
  const na = a.length, nb = b.length;
  for (let i = 0; i < na; i += 2) {
    const j = (i + 2) % na; const px = a[i], py = a[i + 1]; let ux = a[j] - px, uy = a[j + 1] - py; const len = Math.hypot(ux, uy); if (len < 0.03) continue; ux /= len; uy /= len;
    for (let k = 0; k < nb; k += 2) {
      const l = (k + 2) % nb; const q0x = b[k] - px, q0y = b[k + 1] - py, q1x = b[l] - px, q1y = b[l + 1] - py;
      if (Math.abs(ux * q0y - uy * q0x) > 0.025 || Math.abs(ux * q1y - uy * q1x) > 0.025) continue;
      const t0 = q0x * ux + q0y * uy, t1 = q1x * ux + q1y * uy;
      const ov = Math.min(len, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1));
      if (ov > 0.05) return i >> 1;
    }
  }
  return -1;
}

export interface AddOpts { anchor?: boolean; cell?: number; noSplit?: boolean; hpK?: number }

export class Structures {
  root: Cluster;
  clusters: Cluster[] = []; // dynamic only
  private rng: Rng; private stampN = 1;
  private dirtyList: Cluster[] = [];
  private chain: { ch: Chunk; t: number; dmg: number }[] = [];
  /** chunks shattered this step by a contact with a non-chunk (player/enemy/prop) → game may restore momentum */
  punched: CRef[] = [];
  onShatter: ((ch: Chunk, cl: Cluster, wx: number, wy: number) => void) | null = null;
  broken = 0; // counter for scoring
  groundY = 0;
  constructor(public phys: Phys, public fx: FxSink, seed: number) {
    this.rng = new Rng(seed); this.root = new Cluster(phys.fixed, true);
  }
  reset(seed: number) {
    this.rng = new Rng(seed); this.root = new Cluster(this.phys.fixed, true); this.clusters.length = 0; this.dirtyList.length = 0; this.chain.length = 0; this.punched.length = 0; this.broken = 0;
  }

  // ------------------------------------------------------------------ build
  private mkCollider(ch: Chunk, cl: Cluster, small = false) {
    const m = ch.mat; const d = RAPIER.ColliderDesc.convexHull(ch.v);
    if (!d) return false;
    d.setDensity(m.density).setFriction(m.friction).setRestitution(m.rest)
      .setCollisionGroups(cl.fixed ? GR.static : small ? GR.shard : GR.debris);
    if (!m.unbreakable || !cl.fixed) { d.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(Math.min(m.jMin, 400) * 30); }
    ch.col = this.phys.world.createCollider(d, cl.rb); this.phys.ref(ch.col, 'chunk', ch);
    return true;
  }
  private addChunk(poly: number[], mat: Mat, cl: Cluster, anchor: boolean, small = false, hpK = 1): Chunk | null {
    const ch = new Chunk(poly, mat, cl, this.rng.range(-1, 1));
    if (ch.area < 0.0015) return null;
    ch.hp = ch.hp0 = mat.hp * hpK * Math.max(0.35, Math.min(1.6, Math.sqrt(ch.area / (mat.cell * mat.cell))));
    ch.anchor = anchor;
    if (!this.mkCollider(ch, cl, small)) return null;
    cl.chunks.push(ch); return ch;
  }
  /** add a convex static piece; it is pre-split by the material's pattern */
  addPoly(poly: number[], matId: MatId, o: AddOpts = {}): Chunk[] {
    const mat = MATS[matId]; const out: Chunk[] = []; let cells: number[][];
    const b = polyBounds(poly); const w = b[2] - b[0], h = b[3] - b[1]; const cell = o.cell ?? mat.cell;
    if (o.noSplit || mat.pattern === 'single') cells = [poly];
    else if (mat.pattern === 'bricks') cells = bricks(b[0], b[1], w, h, cell * 1.9, cell * 0.8);
    else if (mat.pattern === 'planks') cells = w >= h ? bricks(b[0], b[1], w, h, cell * 3.2, Math.min(h, cell * 0.55), true) : bricks(b[0], b[1], w, h, Math.min(w, cell * 0.55), cell * 3.2, false);
    else cells = (w * h < cell * cell * 1.4) ? [poly] : voronoi(poly, gridSeeds(poly, cell, this.rng, 0.36));
    for (const c of cells) { const ch = this.addChunk(c, mat, this.root, !!o.anchor, false, o.hpK ?? 1); if (ch) out.push(ch); }
    return out;
  }
  addRect(x: number, y: number, w: number, h: number, mat: MatId, o: AddOpts = {}) { return this.addPoly(rectPoly(x, y, w, h), mat, o); }

  /** compute adjacency between all static chunks; anchor chunks touching ground */
  finalize(groundY: number) {
    this.groundY = groundY;
    const cs = this.root.chunks; const S = 1.6; const grid = new Map<number, Chunk[]>();
    const key = (ix: number, iy: number) => (ix + 512) * 2048 + (iy + 512);
    for (const c of cs) {
      c.nb.length = 0;
      if (c.by1 >= groundY - 0.03) c.anchor = true;
      for (let ix = Math.floor((c.bx0 - 0.03) / S); ix <= Math.floor((c.bx1 + 0.03) / S); ix++)
        for (let iy = Math.floor((c.by0 - 0.03) / S); iy <= Math.floor((c.by1 + 0.03) / S); iy++) { const k = key(ix, iy); let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(c); }
    }
    const seen = new Set<number>();
    for (const arr of grid.values()) for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i], b = arr[j];
      if (a.bx1 < b.bx0 - 0.03 || b.bx1 < a.bx0 - 0.03 || a.by1 < b.by0 - 0.03 || b.by1 < a.by0 - 0.03) continue;
      const pk = a.id < b.id ? a.id * 65536 + b.id : b.id * 65536 + a.id; if (seen.has(pk)) continue; seen.add(pk);
      if (sharedEdge(a.v, b.v) >= 0) { a.nb.push(b); b.nb.push(a); }
    }
    for (const c of cs) c.freeDirty = true;
  }

  /** free-standing dynamic body made of polys (world space). Returns cluster. */
  spawnBody(polys: number[][], matId: MatId, vx = 0, vy = 0, tag: string | null = null): Cluster {
    const rb = this.phys.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setLinvel(vx, vy).setAngularDamping(0.4).setLinearDamping(0.02).setCcdEnabled(true));
    const cl = new Cluster(rb, false); cl.tag = tag;
    for (const p of polys) this.addChunk(p, MATS[matId], cl, false);
    for (let i = 0; i < cl.chunks.length; i++) for (let j = i + 1; j < cl.chunks.length; j++) if (sharedEdge(cl.chunks[i].v, cl.chunks[j].v) >= 0) { cl.chunks[i].nb.push(cl.chunks[j]); cl.chunks[j].nb.push(cl.chunks[i]); }
    this.clusters.push(cl); return cl;
  }

  // ------------------------------------------------------------------ helpers
  worldOf(cl: Cluster, lx: number, ly: number, out: { x: number; y: number }) {
    if (cl.fixed) { out.x = lx; out.y = ly; return out; }
    const t = cl.rb.translation(), a = cl.rb.rotation(); const c = Math.cos(a), s = Math.sin(a);
    out.x = t.x + lx * c - ly * s; out.y = t.y + lx * s + ly * c; return out;
  }
  localOf(cl: Cluster, wx: number, wy: number, out: { x: number; y: number }) {
    if (cl.fixed) { out.x = wx; out.y = wy; return out; }
    const t = cl.rb.translation(), a = cl.rb.rotation(); const c = Math.cos(a), s = Math.sin(a); const dx = wx - t.x, dy = wy - t.y;
    out.x = dx * c + dy * s; out.y = -dx * s + dy * c; return out;
  }
  private tmp = { x: 0, y: 0 }; private tmp2 = { x: 0, y: 0 };
  chunkWorld(ch: Chunk, out = { x: 0, y: 0 }) { return this.worldOf(ch.cl, ch.cx, ch.cy, out); }
  private markDirty(cl: Cluster) { if (!cl.dirty) { cl.dirty = true; this.dirtyList.push(cl); } }
  private unlink(ch: Chunk) {
    for (const n of ch.nb) { const i = n.nb.indexOf(ch); if (i >= 0) n.nb.splice(i, 1); n.freeDirty = true; }
    ch.nb.length = 0;
  }
  private dropChunk(ch: Chunk) {
    ch.alive = false; if (ch.col) { this.phys.removeCollider(ch.col); ch.col = null; }
    this.unlink(ch); const cl = ch.cl; const i = cl.chunks.indexOf(ch); if (i >= 0) { cl.chunks[i] = cl.chunks[cl.chunks.length - 1]; cl.chunks.pop(); }
    this.markDirty(cl);
  }
  private removeCluster(cl: Cluster) {
    if (cl.fixed) return;
    for (const ch of cl.chunks) { ch.alive = false; ch.col = null; this.unlink(ch); }
    cl.chunks.length = 0; this.phys.removeBody(cl.rb);
    const i = this.clusters.indexOf(cl); if (i >= 0) { this.clusters[i] = this.clusters[this.clusters.length - 1]; this.clusters.pop(); }
    cl.life = -1;
  }
  killCluster(cl: Cluster) { this.removeCluster(cl); }
  get dynCount() { return this.clusters.length; }

  // ------------------------------------------------------------------ damage
  /** damage a chunk; (wx,wy) world hit point, (vx,vy) extra velocity for shards */
  damage(ch: Chunk, dmg: number, wx: number, wy: number, vx = 0, vy = 0): boolean {
    if (!ch.alive || ch.mat.unbreakable) return false;
    ch.hp -= dmg; ch.crack = Math.min(1, 1 - ch.hp / ch.hp0);
    if (ch.hp > 0) return false;
    this.shatter(ch, wx, wy, vx, vy); return true;
  }
  shatter(ch: Chunk, wx: number, wy: number, vx: number, vy: number) {
    if (!ch.alive) return;
    const cl = ch.cl, m = ch.mat, rng = this.rng; const L = this.localOf(cl, wx, wy, this.tmp);
    const wc = this.worldOf(cl, ch.cx, ch.cy, this.tmp2); const wcx = wc.x, wcy = wc.y;
    let lvx = 0, lvy = 0, av = 0; let px = 0, py = 0, rot = 0;
    if (!cl.fixed) { const lv = cl.rb.linvel(); lvx = lv.x; lvy = lv.y; av = cl.rb.angvel(); const t = cl.rb.translation(); px = t.x; py = t.y; rot = cl.rb.rotation(); }
    const comW = cl.fixed ? null : cl.rb.worldCom(); const comx = comW ? comW.x : 0, comy = comW ? comW.y : 0;
    const k = ch.gen >= 2 || ch.area < 0.05 ? 0 : Math.max(2, Math.round(rng.range(m.shards[0], m.shards[1]) * Math.min(1.5, 0.55 + ch.area * 1.4)));
    const edgeInk = ink(m.edge[0], m.edge[1], m.edge[2]); const fillInk = ink(m.ink[0], m.ink[1], m.ink[2]);
    let cells: number[][] = [];
    if (k > 0) cells = voronoi(Array.from(ch.v), impactSeeds(Array.from(ch.v), L.x, L.y, k, rng, m.aniso, rng.range(0, 3.14)));
    const c = Math.cos(rot), s = Math.sin(rot);
    const budgetLeft = T.budget.dyn - this.clusters.length;
    let made = 0;
    for (const cell of cells) {
      const [ccx, ccy, a] = polyCentroid(cell); const area = Math.abs(a);
      const cwx = px + ccx * c - ccy * s, cwy = py + ccx * s + ccy * c;
      // velocity: parent point velocity + burst away from hit
      let bx = cwx - wx, by = cwy - wy; const bl = Math.hypot(bx, by) + 0.05; const burst = rng.range(1.2, 4.2);
      const pvx = lvx - av * (cwy - comy) + (bx / bl) * burst + vx * rng.range(0.5, 1), pvy = lvy + av * (cwx - comx) + (by / bl) * burst + vy * rng.range(0.5, 1) - rng.range(0, 1.5);
      if (area >= T.budget.minBodyArea && made < budgetLeft && made < 7) {
        const rb = this.phys.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(px, py).setRotation(rot).setLinvel(pvx, pvy).setAngvel(av + rng.range(-6, 6)).setAngularDamping(0.5).setLinearDamping(0.05));
        const nc = new Cluster(rb, false); nc.shard = true; nc.life = T.budget.shardLife * rng.range(0.7, 1.3) * (area > 0.14 ? 1.8 : 1);
        const small = area < 0.13;
        const sc = this.addChunk(cell, m, nc, false, small, 0.35);
        if (sc) { sc.gen = ch.gen + 1; sc.shade = ch.shade; this.clusters.push(nc); made++; }
        else this.phys.removeBody(rb);
      } else {
        this.fx.scrap(cwx, cwy, pvx * 1.2, pvy * 1.2 - 1, Math.sqrt(area) * 1.1 + 0.04, m.id === 'glass' ? edgeInk : fillInk);
      }
    }
    // crumbs + dust
    const n = m.id === 'glass' ? 9 : 5;
    for (let i = 0; i < n; i++) this.fx.scrap(wcx + rng.range(-ch.r, ch.r) * 0.6, wcy + rng.range(-ch.r, ch.r) * 0.6, lvx + vx * 0.6 + rng.range(-4, 4), lvy + vy * 0.6 + rng.range(-5, 1), rng.range(0.04, 0.11), i & 1 ? edgeInk : fillInk);
    if (m.id !== 'glass') this.fx.dust(wcx, wcy, ch.r * 1.3, ink(m.id === 'wood' || m.id === 'crate' ? 0 : 0.34, 0, m.id === 'wood' || m.id === 'crate' ? 0.4 : 0), vx * 0.15, vy * 0.15);
    if (m.chain) for (const nb of ch.nb) if (nb.mat === m && rng.chance(m.chain)) this.chain.push({ ch: nb, t: rng.range(0.02, 0.07), dmg: nb.hp0 });
    this.broken++;
    bus.emit('break', { x: wcx, y: wcy, mat: m.id, area: ch.area, energy: Math.hypot(vx, vy) });
    this.dropChunk(ch);
    if (this.onShatter) this.onShatter(ch, cl, wcx, wcy);
  }
  /** radial damage + impulse. Returns number of chunks destroyed. */
  blast(x: number, y: number, r: number, dmg: number, impulse: number, inward = false): number {
    let n = 0; const hit: Chunk[] = [];
    this.phys.overlapBall(x, y, r, GR.qAll, (ref) => { if (ref.kind === 'chunk') hit.push(ref.obj as Chunk); });
    const seenCl = new Set<Cluster>(); const w = this.tmp;
    for (const ch of hit) {
      if (!ch.alive) continue; const cl = ch.cl; this.worldOf(cl, ch.cx, ch.cy, w);
      let dx = w.x - x, dy = w.y - y; const d = Math.hypot(dx, dy); const f = Math.max(0, 1 - Math.max(0, d - ch.r * 0.5) / r); if (f <= 0) continue;
      const nx = d > 0.01 ? dx / d : 0, ny = d > 0.01 ? dy / d : -1; const sg = inward ? -1 : 1;
      if (!cl.fixed && !seenCl.has(cl)) {
        seenCl.add(cl); const m = cl.rb.mass(); const j = Math.min(impulse * f, m * 22);
        cl.rb.applyImpulseAtPoint({ x: nx * j * sg, y: ny * j * sg - (inward ? 0 : j * 0.25) }, { x: w.x, y: w.y }, true);
      }
      if (dmg > 0 && this.damage(ch, dmg * f * f, x + nx * Math.min(d, ch.r), y + ny * Math.min(d, ch.r), nx * 7 * f * sg, ny * 7 * f * sg)) n++;
    }
    return n;
  }
  /** process contact force events from the physics step */
  handleForces(dt: number) {
    this.punched.length = 0; const evs = this.phys.forceEvts; const g = this.phys.gravity; const w = this.tmp;
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i]; const ca = e.a.kind === 'chunk' ? (e.a.obj as Chunk) : null, cb = e.b.kind === 'chunk' ? (e.b.obj as Chunk) : null;
      if (!ca && !cb) continue;
      // effective mass = lighter dynamic participant
      let m = Infinity;
      const ma = this.massOf(e.a), mb = this.massOf(e.b); m = Math.min(ma, mb); if (!isFinite(m)) continue;
      const jx = e.j - T.impact.restK * g * dt * m;
      if (jx <= 0) continue;
      for (let s = 0; s < 2; s++) {
        const ch = s ? cb : ca, other = s ? e.a : e.b; if (!ch || !ch.alive) continue; const mat = ch.mat; if (mat.unbreakable) continue;
        if (ch.cl.held) continue;
        let j = jx; if (other.kind === 'player') j *= 1.5; // the hero is a wrecking ball
        if (j < mat.jMin) { if (j > mat.jMin * 0.5) ch.crack = Math.max(ch.crack, 0.25); continue; }
        this.worldOf(ch.cl, ch.cx, ch.cy, w);
        const broke = this.damage(ch, j * mat.dmgK, w.x, w.y, 0, 0);
        if (broke && other.kind !== 'chunk') this.punched.push(other);
        else if (!broke && !ch.cl.fixed && j > mat.jMin * 1.6 && ch.cl.chunks.length > 1) this.crackCluster(ch.cl, ch);
        if (!broke) bus.emit('impact', { x: w.x, y: w.y, force: j, mat: mat.id });
      }
    }
  }
  private massOf(r: CRef): number {
    if (r.kind === 'chunk') { const cl = (r.obj as Chunk).cl; return cl.fixed ? Infinity : cl.rb.mass(); }
    if (r.kind === 'bedrock') return Infinity;
    const rb = r.obj.rb as RAPIER.RigidBody | undefined; return rb ? rb.mass() : Infinity;
  }
  /** snap a rigid cluster along a random line through the impacted chunk */
  private crackCluster(cl: Cluster, at: Chunk) {
    const a = this.rng.range(0, Math.PI); const nx = Math.cos(a), ny = Math.sin(a); const ox = at.cx, oy = at.cy; let cut = 0;
    for (const ch of cl.chunks) {
      const sa = (ch.cx - ox) * nx + (ch.cy - oy) * ny >= 0;
      for (let i = ch.nb.length - 1; i >= 0; i--) {
        const n = ch.nb[i]; const sb = (n.cx - ox) * nx + (n.cy - oy) * ny >= 0;
        if (sa !== sb) { ch.nb.splice(i, 1); const k = n.nb.indexOf(ch); if (k >= 0) n.nb.splice(k, 1); ch.freeDirty = n.freeDirty = true; cut++; }
      }
    }
    if (cut) this.markDirty(cl);
  }

  // ------------------------------------------------------------------ connectivity
  private detach(comp: Chunk[], from: Cluster): Cluster {
    let px = 0, py = 0, rot = 0, lvx = 0, lvy = 0, av = 0, comx = 0, comy = 0;
    if (!from.fixed) { const t = from.rb.translation(); px = t.x; py = t.y; rot = from.rb.rotation(); const lv = from.rb.linvel(); lvx = lv.x; lvy = lv.y; av = from.rb.angvel(); const cw = from.rb.worldCom(); comx = cw.x; comy = cw.y; }
    let ax = 0, ay = 0, am = 0; for (const ch of comp) { const m = ch.area * ch.mat.density; ax += ch.cx * m; ay += ch.cy * m; am += m; }
    ax /= am; ay /= am; const c = Math.cos(rot), s = Math.sin(rot); const wx = px + ax * c - ay * s, wy = py + ax * s + ay * c;
    const vx = from.fixed ? 0 : lvx - av * (wy - comy), vy = from.fixed ? 0 : lvy + av * (wx - comx);
    const rb = this.phys.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(px, py).setRotation(rot).setLinvel(vx, vy).setAngvel(from.fixed ? this.rng.range(-0.25, 0.25) : av).setAngularDamping(0.25).setLinearDamping(0.02).setCcdEnabled(comp.length < 3));
    const cl = new Cluster(rb, false);
    let area = 0;
    for (const ch of comp) {
      if (ch.col) { this.phys.removeCollider(ch.col); ch.col = null; }
      const i = from.chunks.indexOf(ch); if (i >= 0) { from.chunks[i] = from.chunks[from.chunks.length - 1]; from.chunks.pop(); }
      ch.cl = cl; ch.anchor = false; ch.freeDirty = true; area += ch.area;
      // links to chunks outside the component are cut
      for (let k = ch.nb.length - 1; k >= 0; k--) { const n = ch.nb[k]; if (n.cl !== cl && comp.indexOf(n) < 0) { ch.nb.splice(k, 1); const q = n.nb.indexOf(ch); if (q >= 0) n.nb.splice(q, 1); n.freeDirty = true; } }
      const small = comp.length === 1 && ch.area < 0.13;
      if (this.mkCollider(ch, cl, small)) cl.chunks.push(ch); else ch.alive = false;
    }
    if (comp.length === 1 && area < 0.5) { cl.shard = area < 0.2; cl.life = T.budget.shardLife * (cl.shard ? 1.3 : 2.4); }
    this.clusters.push(cl);
    if (from.fixed && am > 400) bus.emit('collapse', { x: wx, y: wy, mass: am });
    return cl;
  }
  private resolve(cl: Cluster) {
    cl.dirty = false;
    if (cl.life < 0) return;
    if (!cl.chunks.length) { if (!cl.fixed) this.removeCluster(cl); return; }
    const st = ++this.stampN; const stack: Chunk[] = [];
    if (cl.fixed) {
      for (const ch of cl.chunks) if (ch.anchor) { ch.stamp = st; stack.push(ch); }
      while (stack.length) { const ch = stack.pop()!; for (const n of ch.nb) if (n.stamp !== st && n.cl === cl) { n.stamp = st; stack.push(n); } }
      const loose = cl.chunks.filter((c) => c.stamp !== st); if (!loose.length) return;
      for (const seed of loose) {
        if (seed.stamp === st) continue; const comp: Chunk[] = []; seed.stamp = st; stack.push(seed);
        while (stack.length) { const ch = stack.pop()!; comp.push(ch); for (const n of ch.nb) if (n.stamp !== st && n.cl === cl) { n.stamp = st; stack.push(n); } }
        this.detach(comp, cl);
      }
    } else {
      const comps: Chunk[][] = [];
      for (const seed of cl.chunks) {
        if (seed.stamp === st) continue; const comp: Chunk[] = []; seed.stamp = st; stack.push(seed);
        while (stack.length) { const ch = stack.pop()!; comp.push(ch); for (const n of ch.nb) if (n.stamp !== st && n.cl === cl) { n.stamp = st; stack.push(n); } }
        comps.push(comp);
      }
      if (comps.length <= 1) return;
      comps.sort((a, b) => b.length - a.length);
      for (let i = 1; i < comps.length; i++) this.detach(comps[i], cl);
    }
  }

  /** Volume swap: cut everything inside the circle out of the static world. Returns new dynamic clusters. */
  takeSphere(x: number, y: number, r: number): Cluster[] {
    const cand: Chunk[] = [];
    this.phys.overlapBall(x, y, r, GR.qStatic, (ref) => { if (ref.kind === 'chunk') { const ch = ref.obj as Chunk; if (ch.cl === this.root && !ch.mat.unbreakable) cand.push(ch); } });
    const inside: Chunk[] = [];
    for (const ch of cand) {
      if (!ch.alive) continue;
      const d = Math.hypot(ch.cx - x, ch.cy - y);
      // fully inside?
      let maxd = 0, mind = Infinity; for (let i = 0; i < ch.v.length; i += 2) { const q = Math.hypot(ch.v[i] - x, ch.v[i + 1] - y); if (q > maxd) maxd = q; if (q < mind) mind = q; }
      if (maxd <= r + 0.02) { inside.push(ch); continue; }
      // boundary chunk → split by the tangent line facing the chunk
      let nx = (ch.cx - x) / (d || 1), ny = (ch.cy - y) / (d || 1); if (d < 0.01) { nx = 0; ny = -1; }
      const ox = x + nx * r, oy = y + ny * r; const src = Array.from(ch.v);
      const pin = cleanPoly(clipHalfPlane(src, ox, oy, nx, ny)), pout = cleanPoly(clipHalfPlane(src, ox, oy, -nx, -ny));
      if (!pin || Math.abs(polyArea(pin)) < 0.02) continue;
      if (!pout || Math.abs(polyArea(pout)) < 0.02) { inside.push(ch); continue; }
      const nbs = ch.nb.slice(); const anchor = ch.anchor; const mat = ch.mat; const shade = ch.shade, hpf = ch.hp / ch.hp0; const mk = ch.mark;
      this.dropChunk(ch);
      const a = this.addChunk(pin, mat, this.root, false), b = this.addChunk(pout, mat, this.root, anchor);
      const parts = [a, b].filter(Boolean) as Chunk[];
      for (const p of parts) { p.shade = shade; p.hp = p.hp0 * hpf; p.mark = mk; for (const n of nbs) if (n.alive && sharedEdge(p.v, n.v) >= 0) { p.nb.push(n); n.nb.push(p); n.freeDirty = true; } }
      if (a && b) { a.nb.push(b); b.nb.push(a); }
      if (a) inside.push(a);
    }
    if (!inside.length) return [];
    // group taken chunks into connected components
    const st = ++this.stampN; const set = new Set(inside); const out: Cluster[] = []; const stack: Chunk[] = [];
    for (const seed of inside) {
      if (seed.stamp === st) continue; const comp: Chunk[] = []; seed.stamp = st; stack.push(seed);
      while (stack.length) { const ch = stack.pop()!; comp.push(ch); for (const n of ch.nb) if (n.stamp !== st && set.has(n)) { n.stamp = st; stack.push(n); } }
      out.push(this.detach(comp, this.root));
    }
    this.markDirty(this.root);
    return out;
  }

  /** call after every physics step */
  sync() {
    for (const cl of this.clusters) { cl.px = cl.x; cl.py = cl.y; cl.pa = cl.a; const t = cl.rb.translation(); cl.x = t.x; cl.y = t.y; cl.a = cl.rb.rotation(); }
  }
  // ------------------------------------------------------------------ update
  update(dt: number) {
    for (let i = this.chain.length - 1; i >= 0; i--) {
      const c = this.chain[i]; c.t -= dt; if (c.t > 0) continue;
      this.chain[i] = this.chain[this.chain.length - 1]; this.chain.pop();
      if (c.ch.alive) { const w = this.chunkWorld(c.ch, this.tmp); this.damage(c.ch, c.dmg, w.x, w.y, 0, 0); }
    }
    let guard = 0;
    while (this.dirtyList.length && guard++ < 64) { const cl = this.dirtyList.pop()!; this.resolve(cl); }
    // lifetimes & budget
    const over = this.clusters.length - T.budget.dyn * 0.85;
    let trimmed = 0;
    for (let i = this.clusters.length - 1; i >= 0; i--) {
      const cl = this.clusters[i]; cl.age += dt;
      if (cl.life !== Infinity) {
        if (over > trimmed && cl.shard && cl.life > 0.5 && cl.age > 1.2) { cl.life = 0.5; trimmed++; }
        cl.life -= dt; cl.fade = Math.min(1, cl.life / 0.5);
        if (cl.life <= 0) { this.removeCluster(cl); continue; }
      }
      const t = cl.rb.translation();
      if (t.y > this.groundY + 60 || Math.abs(t.x) > 400) { /* body origin is arbitrary; use com */ const c = cl.rb.worldCom(); if (c.y > this.groundY + 30) this.removeCluster(cl); }
    }
  }

  // ------------------------------------------------------------------ draw
  private computeFree(ch: Chunk) {
    ch.freeDirty = false; let mask = 0; const n = ch.v.length >> 1;
    for (let i = 0; i < n; i++) mask |= 1 << i;
    for (const nb of ch.nb) { const e = sharedEdge(ch.v, nb.v); if (e >= 0) mask &= ~(1 << e); }
    ch.free = mask;
  }
  private buf = new Float32Array(64);
  drawChunk(R: Renderer, ch: Chunk, px: number, py: number, c: number, s: number, fade: number, lw: number) {
    const m = ch.mat; const sh = 1 + ch.shade * 0.07; const v = ch.v; const n = v.length >> 1; const b = this.buf;
    if (fade < 1) {
      // dissolve: shrink towards centroid
      for (let i = 0; i < n; i++) { const lx = ch.cx + (v[i * 2] - ch.cx) * fade, ly = ch.cy + (v[i * 2 + 1] - ch.cy) * fade; b[i * 2] = px + lx * c - ly * s; b[i * 2 + 1] = py + lx * s + ly * c; }
    } else for (let i = 0; i < n; i++) { const lx = v[i * 2], ly = v[i * 2 + 1]; b[i * 2] = px + lx * c - ly * s; b[i * 2 + 1] = py + lx * s + ly * c; }
    const sub = b.subarray(0, n * 2);
    R.poly(sub, ink(Math.min(1, m.ink[0] * sh), Math.min(1, m.ink[1] * sh), Math.min(1, m.ink[2] * sh + (ch.mark && ch.cl.fixed ? 0.55 : 0))));
    if (ch.freeDirty) this.computeFree(ch);
    const ek = ink(m.edge[0], m.edge[1], m.edge[2]);
    const f = ch.free;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (f & (1 << i)) R.line(b[i * 2], b[i * 2 + 1], b[j * 2], b[j * 2 + 1], lw, ek);
    }
    if (ch.crack > 0.2) {
      const wx = px + ch.cx * c - ch.cy * s, wy = py + ch.cx * s + ch.cy * c; const k = ink(m.edge[0], m.edge[1], m.edge[2]);
      const cnt = ch.crack > 0.6 ? 3 : 2;
      for (let i = 0; i < cnt; i++) { const q = ((ch.id * 7 + i * 3) % n); const mx = (b[q * 2] + b[((q + 1) % n) * 2]) * 0.5, my = (b[q * 2 + 1] + b[((q + 1) % n) * 2 + 1]) * 0.5; R.taper(wx, wy, mx, my, lw * 0.4, lw * 1.1, k); }
    }
  }
  draw(R: Renderer, x0: number, y0: number, x1: number, y1: number, lw: number) {
    for (const ch of this.root.chunks) {
      if (ch.bx1 < x0 || ch.bx0 > x1 || ch.by1 < y0 || ch.by0 > y1) continue;
      this.drawChunk(R, ch, 0, 0, 1, 0, 1, lw);
    }
  }
  drawDynamic(R: Renderer, x0: number, y0: number, x1: number, y1: number, lw: number, alpha: number) {
    for (const cl of this.clusters) {
      const tx = cl.px + (cl.x - cl.px) * alpha, ty = cl.py + (cl.y - cl.py) * alpha; const a = cl.pa + (cl.a - cl.pa) * alpha; const c = Math.cos(a), s = Math.sin(a);
      for (const ch of cl.chunks) {
        const wx = tx + ch.cx * c - ch.cy * s, wy = ty + ch.cx * s + ch.cy * c;
        if (wx + ch.r < x0 || wx - ch.r > x1 || wy + ch.r < y0 || wy - ch.r > y1) continue;
        this.drawChunk(R, ch, tx, ty, c, s, cl.fade, lw);
      }
    }
  }
}
