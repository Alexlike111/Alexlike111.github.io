// ONE destruction system for everything on the map: walls, guardrails, curbs, road chunks, props.
//
// Every piece is a DestructibleState with hp. Contact callbacks only RECORD hits (recordHit / hitRoad);
// flush() applies them after the world step: hp loss above a per-kind impulse threshold, deferred breaking
// (at most CONFIG.destruction.maxBreaksPerStep per flush, the rest on the next flushes), body deactivated at
// once and removed through PhysicsWorld.queueRemoval, 'break' events for render / audio / money.
//
// Ownership of contact recording:
//  - car <-> destructible contacts: the Sim calls recordHit(id, impulse, x, y, vx, vy) (and hitRoad for crashes).
//  - prop <-> wall / prop <-> prop contacts (a barrel thrown into a wall): recorded here, the system registers
//    its own post-solve callback in the constructor. Car contacts are ignored by that callback (no double damage).
import * as planck from 'planck';
import { CONFIG } from '../config';
import type { DestructibleKind, DestructibleState, PropType, SimEvent, TrackGeometry } from '../types';
import { SURFACE_CURB, SURFACE_GRASS, SURFACE_HOLE, SURFACE_ROAD, type Surface } from './carModel';
import { contactImpulse, fixtureData, type FixtureData, type PhysicsWorld } from './world';

export type SurfaceKind = 'road' | 'curb' | 'grass' | 'hole';

export interface SurfaceInfo {
  surface: Surface;
  kind: SurfaceKind;
  /** track coordinates of the query point (saves callers a second nearest() call) */
  s: number;
  lateral: number;
  /** id of the curb segment under the point (kind === 'curb'), else -1 */
  curbId: number;
}

interface Hit { id: number; impulse: number; x: number; y: number; vx: number; vy: number }

const D = CONFIG.destruction;
const BODY_FRICTION_ROAD_SIDE = D.wallFriction;

export class DestructionSystem {
  /** index === id. Stable for the whole race; render builds its instances from this once. */
  states: DestructibleState[] = [];
  readonly track: TrackGeometry;
  /** number of states per kind (including broken ones) */
  readonly counts: Record<DestructibleKind, number> = { wall: 0, guardrail: 0, curb: 0, road: 0, prop: 0 };
  /** total pieces broken so far */
  brokenCount = 0;

  private pw: PhysicsWorld;
  private bodies: (planck.Body | null)[] = [];
  private hits: Hit[] = [];
  private scrapes: { id: number; dmg: number; vx: number; vy: number }[] = [];
  private pool: Hit[] = [];
  private roadHits: { x: number; y: number; impulse: number }[] = [];
  private pending: number[] = [];
  private pendingFlag: Uint8Array = new Uint8Array(0);
  private awakeFlag: Uint8Array = new Uint8Array(0);
  private hitVx: Float32Array = new Float32Array(0);
  private hitVy: Float32Array = new Float32Array(0);
  private prev: Int32Array = new Int32Array(0);
  private next: Int32Array = new Int32Array(0);
  private dynamicIds: number[] = [];
  private minPropThreshold = Infinity;

  // road chunk grid
  private roadFirst = 0;
  private roadChunks = 0;
  private roadChunkLen = 1;
  private lanes = 1;
  private laneW = 1;
  private holes = 0;
  // curb grid: [leftSide, rightSide] -> id per segment or -1
  private curbIdx: Int32Array[] = [];
  private curbCount = 0;
  private curbLen = 1;

  constructor(pw: PhysicsWorld, track: TrackGeometry) {
    this.pw = pw;
    this.track = track;
    this.buildWalls();
    this.buildCurbs();
    this.buildRoad();
    this.buildProps();
    this.buildBoundary();
    const n = this.states.length;
    this.pendingFlag = new Uint8Array(n);
    this.awakeFlag = new Uint8Array(n);
    this.hitVx = new Float32Array(n);
    this.hitVy = new Float32Array(n);
    pw.onPostSolve((c, imp) => this.onPostSolve(c, imp));
  }

  // -------------------------------------------------------------------------------------------
  // building
  // -------------------------------------------------------------------------------------------

  private push(st: Omit<DestructibleState, 'id' | 'crack' | 'broken'>, body: planck.Body | null): number {
    const id = this.states.length;
    this.states.push({ ...st, id, crack: 0, broken: false });
    this.bodies.push(body);
    this.counts[st.kind]++;
    return id;
  }

  private maxAbsCurv(s0: number, s1: number): number {
    const g = this.track;
    let m = 0;
    const steps = Math.max(2, Math.ceil((s1 - s0) / 1));
    for (let i = 0; i <= steps; i++) m = Math.max(m, Math.abs(g.sampleAt(s0 + ((s1 - s0) * i) / steps).curvature));
    return m;
  }

  /** Centre/angle/length of the chord of the offset curve between s0 and s1 at lateral `lat`. */
  private chord(s0: number, s1: number, lat: number, overlap: number): { x: number; y: number; angle: number; len: number } {
    const g = this.track;
    const a = g.sampleAt(s0), b = g.sampleAt(s1);
    const ax = a.x + a.nx * lat, ay = a.y + a.ny * lat;
    const bx = b.x + b.nx * lat, by = b.y + b.ny * lat;
    return { x: (ax + bx) / 2, y: (ay + by) / 2, angle: Math.atan2(by - ay, bx - ax), len: Math.hypot(bx - ax, by - ay) + overlap };
  }

  private buildWalls(): void {
    const g = this.track;
    const L = g.length;
    const segLen = D.guardrail.segmentLength;
    const n = Math.max(4, Math.round(L / segLen));
    const seg = L / n;
    const half = g.def.width / 2;
    const idsPerSide: number[][] = [];
    for (const side of [1, -1]) {
      const lat = side * (half + D.wallOffset);
      const ids: number[] = [];
      for (let j = 0; j < n; j++) {
        const s0 = j * seg, s1 = (j + 1) * seg;
        const kind: 'wall' | 'guardrail' = this.maxAbsCurv(s0, s1) > D.cornerCurvature ? 'wall' : 'guardrail';
        const cfg = D[kind];
        const c = this.chord(s0, s1, lat, 0.3);
        const body = this.pw.world.createBody({ type: 'static', position: { x: c.x, y: c.y }, angle: c.angle });
        const id = this.states.length;
        const data: FixtureData = { kind, id };
        body.createFixture({
          shape: new planck.Box(c.len / 2, cfg.thickness / 2),
          friction: BODY_FRICTION_ROAD_SIDE, restitution: D.wallRestitution, userData: data,
        });
        this.push({ kind, x: c.x, y: c.y, angle: c.angle, w: c.len, h: cfg.thickness, hp: cfg.hp, maxHp: cfg.hp }, body);
        ids.push(id);
      }
      idsPerSide.push(ids);
    }
    // neighbour links (cyclic) for splash damage
    const total = this.states.length;
    this.prev = new Int32Array(total).fill(-1);
    this.next = new Int32Array(total).fill(-1);
    for (const ids of idsPerSide) {
      for (let k = 0; k < ids.length; k++) {
        this.prev[ids[k]] = ids[(k - 1 + ids.length) % ids.length];
        this.next[ids[k]] = ids[(k + 1) % ids.length];
      }
    }
  }

  private buildCurbs(): void {
    const g = this.track;
    const L = g.length;
    const n = Math.max(4, Math.round(L / D.curb.segmentLength));
    this.curbCount = n;
    this.curbLen = L / n;
    const half = g.def.width / 2;
    const cw = D.curb.width;
    for (const side of [1, -1]) {
      const idx = new Int32Array(n).fill(-1);
      const lat = side * (half + cw / 2);
      for (let j = 0; j < n; j++) {
        const s0 = j * this.curbLen, s1 = (j + 1) * this.curbLen;
        if (this.maxAbsCurv(s0, s1) <= D.cornerCurvature) continue;
        const c = this.chord(s0, s1, lat, 0.1);
        const body = this.pw.world.createBody({ type: 'static', position: { x: c.x, y: c.y }, angle: c.angle });
        const id = this.states.length;
        const data: FixtureData = { kind: 'curb', id };
        body.createFixture({ shape: new planck.Box(c.len / 2, cw / 2), isSensor: true, userData: data });
        this.push({ kind: 'curb', x: c.x, y: c.y, angle: c.angle, w: c.len, h: cw, hp: D.curb.hp, maxHp: D.curb.hp }, body);
        idx[j] = id;
      }
      this.curbIdx.push(idx);
    }
  }

  private buildRoad(): void {
    const g = this.track;
    this.lanes = Math.max(1, D.roadLanes);
    this.roadChunks = Math.max(4, Math.round(g.length / D.road.chunkLength));
    this.roadChunkLen = g.length / this.roadChunks;
    const half = g.def.width / 2;
    this.laneW = g.def.width / this.lanes;
    this.roadFirst = this.states.length;
    for (let c = 0; c < this.roadChunks; c++) {
      const sm = (c + 0.5) * this.roadChunkLen;
      const m = g.sampleAt(sm);
      const angle = Math.atan2(m.ty, m.tx);
      for (let l = 0; l < this.lanes; l++) {
        const lat = -half + (l + 0.5) * this.laneW;
        this.push({
          kind: 'road', x: m.x + m.nx * lat, y: m.y + m.ny * lat, angle,
          w: this.roadChunkLen, h: this.laneW, hp: D.road.hp, maxHp: D.road.hp,
        }, null);
      }
    }
  }

  private buildProps(): void {
    const defs = this.track.def.props;
    const P = D.props;
    for (const p of defs) {
      const cfg = P[p.type];
      const dynamic = cfg.mass > 0;
      const body = this.pw.world.createBody({
        type: dynamic ? 'dynamic' : 'static',
        position: { x: p.x, y: p.y }, angle: p.angle,
        linearDamping: dynamic ? D.propBody.linearDamping : 0,
        angularDamping: dynamic ? D.propBody.angularDamping : 0,
        awake: false, allowSleep: true,
      });
      const id = this.states.length;
      const area = cfg.shape === 'circle' ? Math.PI * (cfg.w / 2) ** 2 : cfg.w * cfg.h;
      const data: FixtureData = { kind: 'prop', id };
      body.createFixture({
        shape: cfg.shape === 'circle' ? new planck.Circle(cfg.w / 2) : new planck.Box(cfg.w / 2, cfg.h / 2),
        density: dynamic ? cfg.mass / area : 0,
        friction: D.propBody.friction, restitution: D.propBody.restitution, userData: data,
      });
      this.push({
        kind: 'prop', propType: p.type, x: p.x, y: p.y, angle: p.angle, w: cfg.w, h: cfg.h,
        hp: cfg.hp, maxHp: cfg.hp, ...(dynamic ? { dynamic: true, vx: 0, vy: 0, angularVel: 0 } : {}),
      }, body);
      if (dynamic) this.dynamicIds.push(id);
      this.minPropThreshold = Math.min(this.minPropThreshold, cfg.threshold);
    }
  }

  /** Unbreakable invisible fence far outside the track. */
  private buildBoundary(): void {
    const S = this.track.samples;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const s of S) { minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x); minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y); }
    const m = D.boundaryMargin, t = D.boundaryThickness;
    minX -= m; maxX += m; minY -= m; maxY += m;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, hw = (maxX - minX) / 2, hh = (maxY - minY) / 2;
    const body = this.pw.world.createBody({ type: 'static', position: { x: cx, y: cy } });
    const data: FixtureData = { kind: 'wall', id: -1 };
    const add = (x: number, y: number, hx: number, hy: number): void => {
      body.createFixture({ shape: new planck.Box(hx, hy, { x, y }, 0), friction: 0.2, restitution: 0.1, userData: data });
    };
    add(0, hh + t / 2, hw + t, t / 2);
    add(0, -hh - t / 2, hw + t, t / 2);
    add(hw + t / 2, 0, t / 2, hh + t);
    add(-hw - t / 2, 0, t / 2, hh + t);
  }

  // -------------------------------------------------------------------------------------------
  // recording (safe to call inside contact callbacks)
  // -------------------------------------------------------------------------------------------

  /** Queue a hit on destructible `id` (ids outside the system, e.g. the boundary fence -1, are ignored). */
  recordHit(id: number, impulse: number, x: number, y: number, vx: number, vy: number): void {
    if (id < 0 || id >= this.states.length || !(impulse > 0)) return;
    if (this.states[id].broken) return;
    const h = this.pool.pop() ?? { id: 0, impulse: 0, x: 0, y: 0, vx: 0, vy: 0 };
    h.id = id; h.impulse = impulse; h.x = x; h.y = y; h.vx = vx; h.vy = vy;
    this.hits.push(h);
  }

  /**
   * Queue scraping damage: a car sliding along wall/guardrail `id` with `tangentSpeed` (m/s) for `dt` seconds.
   * Glancing rubs have little normal impulse, so without this they would never wear a piece down.
   */
  recordScrape(id: number, tangentSpeed: number, dt: number, vx: number, vy: number): void {
    if (id < 0 || id >= this.states.length) return;
    const st = this.states[id];
    if (st.broken || (st.kind !== 'wall' && st.kind !== 'guardrail') || tangentSpeed < D.scrape.minSpeed) return;
    this.scrapes.push({ id, dmg: tangentSpeed * dt * D.scrape[st.kind], vx, vy });
  }

  /** Queue a heavy impact near the road: tears the road chunk under the point (needs impulse > road threshold). */
  hitRoad(x: number, y: number, impulse: number): void {
    if (!(impulse > D.road.threshold)) return;
    this.roadHits.push({ x, y, impulse });
  }

  private onPostSolve(c: planck.Contact, imp: planck.ContactImpulse): void {
    const da = fixtureData(c.getFixtureA()), db = fixtureData(c.getFixtureB());
    if (!da || !db || da.kind === 'car' || db.kind === 'car') return; // car contacts are recorded by the Sim
    if (da.kind !== 'prop' && db.kind !== 'prop') return;
    const impulse = contactImpulse(imp);
    if (impulse <= this.minPropThreshold) return;
    const wm = c.getWorldManifold(null);
    let px = 0, py = 0;
    if (wm && wm.pointCount > 0) { px = wm.points[0].x; py = wm.points[0].y; }
    for (const [d, f] of [[da, c.getFixtureA()], [db, c.getFixtureB()]] as [FixtureData, planck.Fixture][]) {
      if (d.kind !== 'prop') continue;
      const v = f.getBody().getLinearVelocity();
      this.recordHit(d.id, impulse, px, py, v.x, v.y);
    }
  }

  /** Visual wear of a curb segment while a car drives over it (called by the Sim with the surfaceAt curbId). */
  scuffCurb(id: number, speed: number, dt: number): void {
    const st = this.states[id];
    if (!st || st.kind !== 'curb' || st.broken || speed < D.curbScuffMinSpeed) return;
    this.damage(id, speed * dt * D.curbScuffPerMetre, 0, 0);
  }

  // -------------------------------------------------------------------------------------------
  // applying (after the world step)
  // -------------------------------------------------------------------------------------------

  private thresholdOf(st: DestructibleState): number {
    switch (st.kind) {
      case 'wall': return D.wall.threshold;
      case 'guardrail': return D.guardrail.threshold;
      case 'road': return D.road.threshold;
      case 'prop': return D.props[st.propType as PropType].threshold;
      default: return D.guardrail.threshold;
    }
  }

  /** Contact impulse (N*s) at which an undamaged piece just breaks. */
  breakImpulse(id: number): number {
    const st = this.states[id];
    if (!st) return 0;
    const mul = st.kind === 'prop' ? D.props[st.propType as PropType].dmgMul : 1;
    return this.thresholdOf(st) + st.maxHp / (D.impulseToDamage * mul);
  }

  private damage(id: number, dmg: number, vx: number, vy: number): void {
    const st = this.states[id];
    if (st.broken || dmg <= 0) return;
    st.hp -= dmg;
    if (st.hp < 0) st.hp = 0;
    st.crack = 1 - st.hp / st.maxHp;
    this.hitVx[id] = vx; this.hitVy[id] = vy;
    if (st.hp <= 0 && !this.pendingFlag[id]) { this.pendingFlag[id] = 1; this.pending.push(id); }
  }

  /**
   * Apply everything recorded since the last flush, then break up to maxBreaksPerStep pieces
   * (hp <= 0). Broken pieces: body deactivated + queued for removal, 'break' event pushed.
   */
  flush(events: SimEvent[]): void {
    if (this.hits.length) {
      const list = this.hits;
      this.hits = [];
      for (const h of list) {
        const st = this.states[h.id];
        if (st.broken) continue;
        let dmg = (h.impulse - this.thresholdOf(st)) * D.impulseToDamage;
        if (st.kind === 'prop') dmg *= D.props[st.propType as PropType].dmgMul;
        if (dmg <= 0) continue;
        this.damage(h.id, dmg, h.vx, h.vy);
        if (st.kind === 'wall' || st.kind === 'guardrail') {
          const sp = Math.min(dmg, st.maxHp) * D.splash; // a catastrophic hit still only cracks the neighbours
          const a = this.prev[h.id], b = this.next[h.id];
          if (a >= 0 && !this.states[a].broken) this.damage(a, sp, h.vx, h.vy);
          if (b >= 0 && !this.states[b].broken) this.damage(b, sp, h.vx, h.vy);
        }
      }
      for (const h of list) if (this.pool.length < 256) this.pool.push(h);
    }
    if (this.scrapes.length) {
      const list = this.scrapes;
      this.scrapes = [];
      for (const sc of list) if (!this.states[sc.id].broken) this.damage(sc.id, sc.dmg, sc.vx, sc.vy);
    }
    if (this.roadHits.length) {
      const rh = this.roadHits;
      this.roadHits = [];
      for (const r of rh) this.applyRoadHit(r.x, r.y, r.impulse);
    }
    let n = 0;
    while (this.pending.length && n < D.maxBreaksPerStep) {
      const id = this.pending.shift() as number;
      this.pendingFlag[id] = 0;
      if (this.states[id].broken) continue;
      this.breakPiece(id, events);
      n++;
    }
  }

  private applyRoadHit(x: number, y: number, impulse: number): void {
    const g = this.track;
    const nn = g.nearest(x, y);
    const half = g.def.width / 2;
    if (Math.abs(nn.lateral) > half + D.wallOffset + D.roadHitRadius) return;
    const dmg = (impulse - D.road.threshold) * D.impulseToDamage;
    if (dmg <= 0) return;
    const c = Math.floor(nn.s / this.roadChunkLen) % this.roadChunks;
    const lane = Math.min(this.lanes - 1, Math.max(0, Math.floor((nn.lateral + half) / this.laneW)));
    const centre = this.roadFirst + c * this.lanes + lane;
    const st = this.states[centre];
    // chunk flies away from the point of impact
    let dx = st.x - x, dy = st.y - y;
    const dl = Math.hypot(dx, dy) || 1;
    dx = (dx / dl) * 5; dy = (dy / dl) * 5;
    this.damage(centre, dmg, dx, dy);
    const sp = dmg * D.roadSplash;
    for (const dc of [-1, 1]) {
      const c2 = (c + dc + this.roadChunks) % this.roadChunks;
      this.damage(this.roadFirst + c2 * this.lanes + lane, sp, dx, dy);
    }
    for (const dl2 of [-1, 1]) {
      const l2 = lane + dl2;
      if (l2 >= 0 && l2 < this.lanes) this.damage(this.roadFirst + c * this.lanes + l2, sp, dx, dy);
    }
  }

  private breakPiece(id: number, events: SimEvent[]): void {
    const st = this.states[id];
    const body = this.bodies[id];
    if (body) {
      // dynamic props: report where the prop really is now
      if (st.dynamic) {
        const p = body.getPosition();
        st.x = p.x; st.y = p.y; st.angle = body.getAngle();
      }
      body.setActive(false);          // out of the broadphase immediately: no ghost collisions for one more step
      this.pw.queueRemoval(body);      // real destruction after the world step
      this.bodies[id] = null;
    }
    st.broken = true;
    st.hp = 0;
    st.crack = 1;
    if (st.kind === 'road') this.holes++;
    if (st.dynamic) { st.vx = 0; st.vy = 0; st.angularVel = 0; }
    this.brokenCount++;
    const ev: SimEvent = {
      type: 'break', id, kind: st.kind, x: st.x, y: st.y, angle: st.angle, w: st.w, h: st.h,
      vx: this.hitVx[id], vy: this.hitVy[id],
    };
    if (st.propType) ev.propType = st.propType;
    events.push(ev);
  }

  // -------------------------------------------------------------------------------------------
  // queries
  // -------------------------------------------------------------------------------------------

  /** Surface under a world point. Torn road chunks are holes; curbs exist only on corners and until broken. */
  surfaceAt(x: number, y: number, hintS?: number): SurfaceInfo {
    const g = this.track;
    const nn = g.nearest(x, y, hintS);
    const half = g.def.width / 2;
    const a = Math.abs(nn.lateral);
    if (a <= half) {
      if (this.holes > 0) {
        const c = Math.floor(nn.s / this.roadChunkLen) % this.roadChunks;
        const lane = Math.min(this.lanes - 1, Math.max(0, Math.floor((nn.lateral + half) / this.laneW)));
        if (this.states[this.roadFirst + c * this.lanes + lane].broken) {
          return { surface: SURFACE_HOLE, kind: 'hole', s: nn.s, lateral: nn.lateral, curbId: -1 };
        }
      }
      return { surface: SURFACE_ROAD, kind: 'road', s: nn.s, lateral: nn.lateral, curbId: -1 };
    }
    if (a <= half + D.curb.width) {
      const j = Math.floor(nn.s / this.curbLen) % this.curbCount;
      const id = this.curbIdx[nn.lateral > 0 ? 0 : 1][j];
      if (id >= 0) {
        if (!this.states[id].broken) return { surface: SURFACE_CURB, kind: 'curb', s: nn.s, lateral: nn.lateral, curbId: id };
        return { surface: SURFACE_ROAD, kind: 'road', s: nn.s, lateral: nn.lateral, curbId: -1 }; // smashed curb is flat rubble
      }
    }
    return { surface: SURFACE_GRASS, kind: 'grass', s: nn.s, lateral: nn.lateral, curbId: -1 };
  }

  /** Copy awake dynamic prop bodies into their states (call once per rendered frame or per step). */
  syncDynamic(): void {
    const ids = this.dynamicIds;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const st = this.states[id];
      const body = this.bodies[id];
      if (st.broken || !body) continue;
      if (body.isAwake()) {
        const p = body.getPosition(), v = body.getLinearVelocity();
        st.x = p.x; st.y = p.y; st.angle = body.getAngle();
        st.vx = v.x; st.vy = v.y; st.angularVel = body.getAngularVelocity();
        this.awakeFlag[id] = 1;
      } else if (this.awakeFlag[id]) {
        // fell asleep since the last sync: copy the final pose once
        const p = body.getPosition();
        st.x = p.x; st.y = p.y; st.angle = body.getAngle();
        st.vx = 0; st.vy = 0; st.angularVel = 0;
        this.awakeFlag[id] = 0;
      }
    }
  }

  /** planck body of a destructible (null for road chunks and after it broke). Mainly for tests/debug. */
  bodyOf(id: number): planck.Body | null { return this.bodies[id] ?? null; }

  /** Number of road chunks currently torn out. */
  get holeCount(): number { return this.holes; }

  /** Id of the road chunk at track coordinates (s, lateral), or -1 outside the road. */
  roadChunkId(s: number, lateral: number): number {
    const half = this.track.def.width / 2;
    if (Math.abs(lateral) > half) return -1;
    const c = Math.floor(((s % this.track.length) + this.track.length) % this.track.length / this.roadChunkLen) % this.roadChunks;
    const lane = Math.min(this.lanes - 1, Math.max(0, Math.floor((lateral + half) / this.laneW)));
    return this.roadFirst + c * this.lanes + lane;
  }

  dispose(): void {
    this.hits.length = 0; this.scrapes.length = 0; this.roadHits.length = 0; this.pending.length = 0;
    this.bodies.length = 0; this.dynamicIds.length = 0;
  }
}
