// Thin Rapier wrapper: collision groups, collider→entity refs, queries.
import RAPIER from '@dimforge/rapier2d-compat';
export { RAPIER };

export const G = { STATIC: 1, DEBRIS: 2, PROP: 4, PLAYER: 8, ENEMY: 16, SHARD: 32, SENSOR: 64, CORPSE: 128 } as const;
export const groups = (member: number, filter: number) => (((member & 0xffff) << 16) | (filter & 0xffff)) >>> 0;
export const GR = {
  static: groups(G.STATIC, 0xffff),
  debris: groups(G.DEBRIS, G.STATIC | G.DEBRIS | G.PROP | G.PLAYER | G.ENEMY | G.SHARD | G.CORPSE),
  shard: groups(G.SHARD, G.STATIC | G.DEBRIS | G.PROP),
  prop: groups(G.PROP, G.STATIC | G.DEBRIS | G.PROP | G.PLAYER | G.ENEMY | G.SHARD | G.CORPSE),
  player: groups(G.PLAYER, G.STATIC | G.DEBRIS | G.PROP),
  enemy: groups(G.ENEMY, G.STATIC | G.DEBRIS | G.PROP | G.ENEMY),
  corpse: groups(G.CORPSE, G.STATIC | G.DEBRIS | G.PROP),
  // query filters (membership irrelevant → 0xffff)
  qSolid: groups(0xffff, G.STATIC | G.DEBRIS | G.PROP),
  qStatic: groups(0xffff, G.STATIC),
  qStaticDebris: groups(0xffff, G.STATIC | G.DEBRIS),
  qAll: groups(0xffff, G.STATIC | G.DEBRIS | G.PROP | G.ENEMY | G.SHARD | G.CORPSE),
  qTargets: groups(0xffff, G.ENEMY | G.PROP | G.DEBRIS),
  qBullet: groups(0xffff, G.STATIC | G.DEBRIS | G.PROP | G.PLAYER),
};
export type RefKind = 'bedrock' | 'chunk' | 'player' | 'enemy' | 'prop';
export interface CRef { kind: RefKind; obj: any }
export interface ForceEvt { a: CRef; b: CRef; j: number; ha: number; hb: number }

export class Phys {
  world!: RAPIER.World; eq!: RAPIER.EventQueue;
  refs = new Map<number, CRef>();
  fixed!: RAPIER.RigidBody;
  gravity = 26;
  stepMs = 0; stepMsAvg = 0; stepMsMax = 0;
  forceEvts: ForceEvt[] = [];
  private ray = new RAPIER.Ray({ x: 0, y: 0 }, { x: 1, y: 0 });
  private ball = new RAPIER.Ball(1);

  static async create(gravity: number): Promise<Phys> {
    await RAPIER.init();
    const p = new Phys(); p.gravity = gravity; p.reset(); return p;
  }
  reset() {
    if (this.world) { this.world.free(); this.eq.free(); }
    this.refs.clear(); this.forceEvts.length = 0;
    this.world = new RAPIER.World({ x: 0, y: this.gravity });
    this.world.timestep = 1 / 60;
    this.world.numSolverIterations = 4;
    this.eq = new RAPIER.EventQueue(true);
    this.fixed = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.ray = new RAPIER.Ray({ x: 0, y: 0 }, { x: 1, y: 0 }); this.ball = new RAPIER.Ball(1);
  }
  step(dt: number) {
    const t0 = performance.now();
    this.world.timestep = dt;
    this.world.step(this.eq);
    this.forceEvts.length = 0;
    this.eq.drainContactForceEvents((e) => {
      const ha = e.collider1(), hb = e.collider2(); const a = this.refs.get(ha), b = this.refs.get(hb);
      if (a && b) this.forceEvts.push({ a, b, j: e.totalForceMagnitude() * dt, ha, hb });
    });
    this.eq.drainCollisionEvents(() => { });
    const ms = performance.now() - t0; this.stepMs = ms; this.stepMsAvg += (ms - this.stepMsAvg) * 0.05; if (ms > this.stepMsMax) this.stepMsMax = ms;
  }
  ref(c: RAPIER.Collider, kind: RefKind, obj: any) { this.refs.set(c.handle, { kind, obj }); }
  removeCollider(c: RAPIER.Collider) { this.refs.delete(c.handle); this.world.removeCollider(c, true); }
  removeBody(b: RAPIER.RigidBody) {
    for (let i = b.numColliders() - 1; i >= 0; i--) this.refs.delete(b.collider(i).handle);
    this.world.removeRigidBody(b);
  }
  /** returns distance or -1; fills hit normal/ref into `out` */
  rayHit = { x: 0, y: 0, nx: 0, ny: 0, t: 0, ref: null as CRef | null, col: null as RAPIER.Collider | null };
  castRay(x: number, y: number, dx: number, dy: number, max: number, grp: number, excludeBody?: RAPIER.RigidBody): boolean {
    const r = this.ray; r.origin.x = x; r.origin.y = y; r.dir.x = dx; r.dir.y = dy;
    const h = this.world.castRayAndGetNormal(r, max, true, undefined, grp, undefined, excludeBody);
    if (!h) return false;
    const o = this.rayHit; o.t = h.timeOfImpact; o.x = x + dx * o.t; o.y = y + dy * o.t; o.nx = h.normal.x; o.ny = h.normal.y; o.col = h.collider; o.ref = this.refs.get(h.collider.handle) ?? null;
    return true;
  }
  overlapBall(x: number, y: number, r: number, grp: number, cb: (ref: CRef, col: RAPIER.Collider) => void) {
    this.ball.radius = r;
    this.world.intersectionsWithShape({ x, y }, 0, this.ball, (c) => { const ref = this.refs.get(c.handle); if (ref) cb(ref, c); return true; }, undefined, grp);
  }
  shapeFree(x: number, y: number, shape: RAPIER.Shape, grp: number, excludeBody?: RAPIER.RigidBody): boolean {
    return this.world.intersectionWithShape({ x, y }, 0, shape, undefined, grp, undefined, excludeBody) === null;
  }
  pointSolid(x: number, y: number, grp: number): CRef | null {
    let out: CRef | null = null;
    this.world.intersectionsWithPoint({ x, y }, (c) => { out = this.refs.get(c.handle) ?? null; return out === null; }, undefined, grp);
    return out;
  }
}
