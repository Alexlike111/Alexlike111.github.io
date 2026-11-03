// AI item use. One AiItemUser per AI car; the Sim calls update() every step and uses the item when it returns true.
// Decisions are taken a few times per second and scale with `iq` (0..1, the driver's skill): a clever driver waits for the
// right moment (clear straight for Nitro, a rival closing in for the shield ...), a weak one fires at a random moment.
import { CONFIG } from '../config';
import type { CarState, ItemType, TrackGeometry } from '../types';

const A = CONFIG.items.ai;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** What the rivals around a car look like, in the car's own frame. */
export interface Surroundings {
  /** rivals within A.shockRadius */
  nearCount: number;
  /** a rival alongside (|forward| < 2.5 m, |side| < shockSingle) */
  alongside: boolean;
  /** nearest rival behind us within shieldBehind, closing faster than shieldClose m/s */
  chaser: boolean;
  /** a rival right ahead (within 6 m, in our lane) */
  blocker: boolean;
  /** a rival ahead within A.nitroFree m and within 3 m of our line */
  aheadInLane: boolean;
  /** a rival behind in our lane between oilBehindMin and oilBehindMax */
  behindInLane: boolean;
}

export function scanSurroundings(car: CarState, others: CarState[], out: Surroundings): Surroundings {
  const ca = Math.cos(car.angle), sa = Math.sin(car.angle);
  out.nearCount = 0; out.alongside = false; out.chaser = false; out.blocker = false; out.aheadInLane = false; out.behindInLane = false;
  for (let i = 0; i < others.length; i++) {
    const o = others[i];
    if (o === car || o.finished) continue;
    const dx = o.x - car.x, dy = o.y - car.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 40) continue;
    const fwd = dx * ca + dy * sa, side = -dx * sa + dy * ca;
    if (dist < A.shockRadius) out.nearCount++;
    if (Math.abs(fwd) < 2.5 && Math.abs(side) < A.shockSingle && dist > 0.1) out.alongside = true;
    const closing = dist > 0.1 ? ((car.vx - o.vx) * dx + (car.vy - o.vy) * dy) / dist : 0;   // > 0: we move toward it
    if (fwd < 0 && dist < A.shieldBehind && -closing > A.shieldClose) out.chaser = true;
    if (fwd > 0 && fwd < 6 && Math.abs(side) < 2.2) out.blocker = true;
    if (fwd > 0 && fwd < A.nitroFree && Math.abs(side) < 3) out.aheadInLane = true;
    if (fwd < -A.oilBehindMin && fwd > -A.oilBehindMax && Math.abs(side) < A.oilLane) out.behindInLane = true;
  }
  return out;
}

export class AiItemUser {
  private held = 0;
  private acc = 0;
  private readonly delay: number;
  private readonly sur: Surroundings = { nearCount: 0, alongside: false, chaser: false, blocker: false, aheadInLane: false, behindInLane: false };

  constructor(private readonly iq: number, private readonly rng: () => number) {
    this.delay = lerp(A.reaction[0], A.reaction[1], Math.min(1, Math.max(0, iq))) * (0.8 + 0.4 * rng());
    this.acc = rng() * A.thinkEvery;
  }

  /** Call once per sim step with the car's current state. Returns true when the item should be used now. */
  update(dt: number, car: CarState, others: CarState[], track: TrackGeometry, hintS: number, raceTime: number): boolean {
    const item = car.item;
    if (!item) { this.held = 0; return false; }
    this.held += dt;
    this.acc += dt;
    if (this.acc < A.thinkEvery) return false;
    this.acc = 0;
    if (this.held < this.delay) return false;
    return this.decide(item, car, others, track, hintS, raceTime);
  }

  private decide(item: ItemType, car: CarState, others: CarState[], track: TrackGeometry, hintS: number, raceTime: number): boolean {
    const sur = scanSurroundings(car, others, this.sur);
    const clever = this.iq > 0.5;
    const overdue = this.held > A.maxHold;
    switch (item) {
      case 'nitro': {
        if (overdue) return true;
        if (!clever) return this.rng() < 0.06;
        if (sur.aheadInLane || car.speed < 8) return false;
        const s = track.nearest(car.x, car.y, hintS).s;
        const reach = Math.max(30, Math.abs(car.speed) * A.nitroLook);
        for (let d = 0; d <= reach; d += 8) if (Math.abs(track.sampleAt(s + d).curvature) > A.nitroCurv) return false;
        return true;
      }
      case 'shield':
        return overdue || sur.chaser || (car.health < A.shieldHealth && sur.nearCount > 0) || (clever && sur.blocker && car.speed > 12);
      case 'repair':
        return car.health < (clever ? A.repairHealth : A.repairHealthLow) || overdue;
      case 'oil':
        return overdue || sur.behindInLane;
      case 'shockwave':
        if (raceTime < A.noShockBefore) return false;      // fairness: nothing in the opening seconds
        return sur.nearCount >= A.shockCount || sur.alongside || (overdue && sur.nearCount > 0);
    }
  }
}
