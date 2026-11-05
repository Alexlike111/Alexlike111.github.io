// Physics world wrapper: fixed step, deferred body removal, recorded contact callbacks.
import * as planck from 'planck';
import { CONFIG } from '../config';
import type { DestructibleKind } from '../types';

/** Fixture userData convention. */
export type FixtureData = { kind: 'car'; carId: number } | { kind: DestructibleKind; id: number };

export class PhysicsWorld {
  world: planck.World;
  /** duration of the last step() in ms (including deferred removals) */
  lastStepMs = 0;
  private removals: planck.Body[] = [];
  private postSolve: ((c: planck.Contact, i: planck.ContactImpulse) => void)[] = [];
  private begin: ((c: planck.Contact) => void)[] = [];
  private end: ((c: planck.Contact) => void)[] = [];

  constructor() {
    this.world = new planck.World({ gravity: { x: 0, y: 0 }, allowSleep: true });
    this.world.on('post-solve', (c, imp) => { for (let i = 0; i < this.postSolve.length; i++) this.postSolve[i](c, imp); });
    this.world.on('begin-contact', (c) => { for (let i = 0; i < this.begin.length; i++) this.begin[i](c); });
    this.world.on('end-contact', (c) => { for (let i = 0; i < this.end.length; i++) this.end[i](c); });
  }

  /** Fixed step dt = CONFIG.physics.dt; runs queued removals AFTER world.step. */
  step(): void {
    const t0 = performance.now();
    this.world.step(CONFIG.physics.dt, CONFIG.physics.velocityIterations, CONFIG.physics.positionIterations);
    if (this.removals.length) {
      const list = this.removals;
      this.removals = [];
      for (const b of list) {
        // body may have been destroyed already (queued twice)
        if (b.getWorld() === this.world) this.world.destroyBody(b);
      }
    }
    this.lastStepMs = performance.now() - t0;
  }

  queueRemoval(body: planck.Body): void {
    if (!this.removals.includes(body)) this.removals.push(body);
  }

  /** Number of removals waiting for the end of the current step. */
  get pendingRemovals(): number { return this.removals.length; }

  /** Callbacks fire inside the solver: only RECORD data there. */
  onPostSolve(cb: (contact: planck.Contact, impulse: planck.ContactImpulse) => void): void { this.postSolve.push(cb); }
  onBeginContact(cb: (c: planck.Contact) => void): void { this.begin.push(cb); }
  onEndContact(cb: (c: planck.Contact) => void): void { this.end.push(cb); }
}

/** Sum of normal impulses of a contact (N*s). */
export function contactImpulse(impulse: planck.ContactImpulse): number {
  const n = impulse.normalImpulses;
  let s = 0;
  for (let i = 0; i < n.length; i++) s += n[i];
  return s;
}

/** First world contact point of a contact (falls back to body A position). */
export function contactPoint(contact: planck.Contact): { x: number; y: number } {
  const wm = contact.getWorldManifold(null);
  if (wm && wm.pointCount > 0) {
    // average the manifold points
    let x = 0, y = 0;
    for (let i = 0; i < wm.pointCount; i++) { x += wm.points[i].x; y += wm.points[i].y; }
    return { x: x / wm.pointCount, y: y / wm.pointCount };
  }
  const p = contact.getFixtureA().getBody().getPosition();
  return { x: p.x, y: p.y };
}

export function fixtureData(f: planck.Fixture): FixtureData | null {
  return (f.getUserData() as FixtureData | null) ?? null;
}
