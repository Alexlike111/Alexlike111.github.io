// Power-ups: boost pads, item boxes, the five items (Nitro, Ram shield, Repair kit, Oil slick, Shockwave) and oil slicks.
// PURE sim code (no three / DOM): geometry checks against car states, effects applied through SimCar hooks.
// Everything is allocated once in the constructor; update() / use() allocate nothing (events are pushed to the caller's array).
import { CONFIG } from '../config';
import { planItems } from '../track/items';
import type { BoostPad, ItemBox, ItemType, OilSlick, SimEvent, TrackGeometry } from '../types';
import { ITEMS } from '../types';
import type { SimCar } from './car';
import type { DestructionSystem } from './destruction';
import { makeRng } from './rng';

const I = CONFIG.items;
const W_SCRATCH = new Float64Array(ITEMS.length);

/**
 * Which item a car gets from a box. Weights depend on the race position (trailing cars get the stronger tools),
 * the Repair kit is skipped when the car is healthy and favoured when it is hurt. `rnd` is a [0,1) source.
 */
export function rollItem(place: number, health: number, rnd: () => number): ItemType {
  let row = I.weights[I.weights.length - 1];
  for (const r of I.weights) if (place <= r.upTo) { row = r; break; }
  let sum = 0;
  for (let k = 0; k < ITEMS.length; k++) {
    let w = row.w[k];
    if (ITEMS[k] === 'repair') {
      if (health > I.repairSkipHealth) w = 0;
      else if (health < I.repairLowHealth) w *= I.repairLowMul;
    }
    W_SCRATCH[k] = w;
    sum += w;
  }
  let x = rnd() * sum;
  for (let k = 0; k < ITEMS.length; k++) {
    x -= W_SCRATCH[k];
    if (x < 0) return ITEMS[k];
  }
  return 'nitro';
}

export class PowerUpSystem {
  readonly pads: BoostPad[] = [];
  readonly boxes: ItemBox[] = [];
  readonly oils: OilSlick[] = [];

  private readonly cars: SimCar[];
  private readonly destruction: DestructionSystem;
  private readonly rng: () => number;
  /** per car x per pad cooldown (s) */
  private readonly padCd: Float32Array;
  private readonly wasShield: boolean[];
  private activeOils = 0;

  constructor(track: TrackGeometry, cars: SimCar[], destruction: DestructionSystem, seed: number, enabled = true) {
    this.cars = cars;
    this.destruction = destruction;
    this.rng = makeRng((seed ^ 0x7f4a7c15) >>> 0);
    const layout = enabled ? planItems(track) : { pads: [], boxes: [] };
    layout.pads.forEach((p, i) => this.pads.push({ id: i, x: p.x, y: p.y, angle: p.angle, length: p.length, width: p.width }));
    layout.boxes.forEach((b, i) => this.boxes.push({ id: i, x: b.x, y: b.y, ready: true, timer: 0 }));
    for (let i = 0; i < I.oil.max; i++) this.oils.push({ x: 0, y: 0, radius: I.oil.radius, age: 0, life: I.oil.time, active: false, owner: -1, hits: 0 });
    this.padCd = new Float32Array(cars.length * Math.max(1, this.pads.length));
    this.wasShield = cars.map(() => false);
    for (const c of cars) this.sync(c);
  }

  // -------------------------------------------------------------------------------------------

  /** One fixed step. `racing`: pads, boxes and slicks only act once the race has started. */
  update(dt: number, racing: boolean, events: SimEvent[]): void {
    const cars = this.cars, n = cars.length, np = this.pads.length;
    for (let i = 0; i < n; i++) {
      const c = cars[i];
      c.buffs.tick(dt);
      const sh = c.buffs.shieldT > 0;
      if (this.wasShield[i] && !sh) c.setHeavy(false);
      this.wasShield[i] = sh;
    }
    for (let k = 0; k < this.padCd.length; k++) if (this.padCd[k] > 0) this.padCd[k] -= dt;

    if (racing) {
      // ---- boost pads
      for (let i = 0; i < n; i++) {
        const st = cars[i].state;
        if (st.finished) continue;
        for (let p = 0; p < np; p++) {
          const pad = this.pads[p];
          const dx = st.x - pad.x, dy = st.y - pad.y;
          if (dx * dx + dy * dy > 64) continue;
          const ca = Math.cos(pad.angle), sa = Math.sin(pad.angle);
          const along = dx * ca + dy * sa, across = -dx * sa + dy * ca;
          if (Math.abs(along) > pad.length / 2 + 1 || Math.abs(across) > pad.width / 2 + 0.6) continue;
          const slot = i * np + p;
          if (this.padCd[slot] > 0) continue;
          const align = Math.cos(st.angle - pad.angle);
          if (align < 0.3) continue;             // driving against the arrows: nothing happens
          this.padCd[slot] = I.pad.cooldown;
          const bf = cars[i].buffs;
          bf.padT = Math.max(bf.padT, I.pad.time * (cars[i].setup.stats.traits?.boostTimeMul ?? 1));   // trait: longer boosts
          const kick = I.pad.kick * align;
          cars[i].kick(Math.cos(st.angle) * kick, Math.sin(st.angle) * kick);
          events.push({ type: 'boost', carId: st.id, x: st.x, y: st.y, angle: st.angle, source: 'pad' });
        }
      }

      // ---- item boxes
      for (const box of this.boxes) {
        if (!box.ready) {
          box.timer -= dt;
          if (box.timer <= 0) { box.ready = true; box.timer = 0; }
          continue;
        }
        const r2 = I.box.radius * I.box.radius;
        for (let i = 0; i < n; i++) {
          const st = cars[i].state;
          if (st.item || st.finished) continue;     // a full slot ignores boxes
          const dx = st.x - box.x, dy = st.y - box.y;
          if (dx * dx + dy * dy > r2) continue;
          const item = rollItem(st.place, st.health, this.rng);
          st.item = item;
          box.ready = false; box.timer = I.box.respawn;
          events.push({ type: 'pickup', carId: st.id, boxId: box.id, x: box.x, y: box.y, item });
          break;
        }
      }

      // ---- oil slicks
      if (this.activeOils > 0) {
        for (const o of this.oils) {
          if (!o.active) continue;
          o.age += dt;
          if (o.age >= o.life) { o.active = false; this.activeOils--; continue; }
          const r2 = o.radius * o.radius;
          for (let i = 0; i < n; i++) {
            const c = cars[i], st = c.state, bf = c.buffs;
            if (bf.spinT > 0 || bf.oilCd > 0 || st.finished) continue;
            if (o.owner === st.id && o.age < I.oil.ownerImmune) continue;
            const dx = st.x - o.x, dy = st.y - o.y;
            if (dx * dx + dy * dy > r2) continue;
            bf.spinT = I.oil.spinTime; bf.gripT = I.oil.gripTime; bf.oilCd = I.oil.cooldown;
            bf.spinDir = this.rng() < 0.5 ? -1 : 1;
            events.push({ type: 'oilSpin', carId: st.id, x: st.x, y: st.y });
            if (++o.hits >= I.oil.maxHits) o.life = Math.min(o.life, o.age + 0.4);   // a slick is spent after a couple of victims
          }
        }
      }
    }
    for (let i = 0; i < n; i++) this.sync(cars[i]);
  }

  /** Copy the buff timers to the public car state (render / HUD read these). */
  private sync(c: SimCar): void {
    const st = c.state, bf = c.buffs;
    if (st.item === undefined) st.item = null;
    st.boostT = bf.padT; st.nitroT = bf.nitroT; st.shieldT = bf.shieldT; st.spinT = bf.spinT;
  }

  // -------------------------------------------------------------------------------------------

  /** Use the held item of car `i`. Returns false when there is nothing to use. */
  use(i: number, events: SimEvent[]): boolean {
    const car = this.cars[i];
    if (!car) return false;
    const st = car.state, bf = car.buffs;
    const item = st.item;
    if (!item || st.finished) return false;
    st.item = null;
    const ca = Math.cos(st.angle), sa = Math.sin(st.angle);
    events.push({ type: 'itemUse', carId: st.id, item, x: st.x, y: st.y, angle: st.angle });
    switch (item) {
      case 'nitro':
        bf.nitroT = I.nitro.time * (car.setup.stats.traits?.boostTimeMul ?? 1);
        car.kick(ca * I.nitro.kick, sa * I.nitro.kick);
        events.push({ type: 'boost', carId: st.id, x: st.x, y: st.y, angle: st.angle, source: 'nitro' });
        break;
      case 'shield':
        bf.shieldT = I.shield.time;
        this.wasShield[i] = true;
        car.setHeavy(true);
        break;
      case 'repair':
        car.heal(I.repair.frac, I.repair.minHp);
        break;
      case 'oil':
        this.dropOil(st.x - ca * I.oil.dropBack, st.y - sa * I.oil.dropBack, st.id);
        break;
      case 'shockwave':
        this.shockwave(i, events);
        break;
    }
    this.sync(car);
    return true;
  }

  private dropOil(x: number, y: number, owner: number): void {
    let slot: OilSlick | null = null;
    let oldest = -1;
    for (const o of this.oils) {
      if (!o.active) { slot = o; break; }
      if (o.age > oldest) { oldest = o.age; slot = o; }
    }
    if (!slot) return;
    if (!slot.active) this.activeOils++;
    slot.x = x; slot.y = y; slot.radius = I.oil.radius; slot.age = 0; slot.life = I.oil.time; slot.active = true; slot.owner = owner; slot.hits = 0;
  }

  private shockwave(user: number, events: SimEvent[]): void {
    const S = I.shock, D = CONFIG.damage;
    const me = this.cars[user].state;
    for (let j = 0; j < this.cars.length; j++) {
      if (j === user) continue;
      const o = this.cars[j], os = o.state;
      if (os.finished) continue;
      const dx = os.x - me.x, dy = os.y - me.y;
      const d = Math.hypot(dx, dy);
      if (d > S.radius) continue;
      if (o.buffs.shieldT > 0) {                // the bubble absorbs one blast and pops
        o.buffs.shieldT = 0;
        o.setHeavy(false);
        this.wasShield[j] = false;
        events.push({ type: 'shieldPop', carId: os.id, x: os.x, y: os.y });
        this.sync(o);
        continue;
      }
      const ux = d > 1e-3 ? dx / d : Math.cos(me.angle), uy = d > 1e-3 ? dy / d : Math.sin(me.angle);
      const fall = 1 - d / S.radius;
      if (!o.setup.stats.traits?.shockImmune) o.kick(ux * S.push * fall, uy * S.push * fall, true);   // a juggernaut is not pushed; the push is a hit (impact layer)
      o.buffs.nitroT = 0;                        // cancels Nitro
      const dmg = S.damage * (0.4 + 0.6 * fall);
      o.recordImpact(os.x - ux * 1.0, os.y - uy * 1.0, D.impulseThreshold + dmg / (D.impulseToDamage * D.carVsCarMul), 'car');
      this.sync(o);
    }
    // loose props and guardrails near the blast fly / break
    const states = this.destruction.states;
    const r2 = S.propRadius * S.propRadius;
    for (let k = 0; k < states.length; k++) {
      const d = states[k];
      if (d.broken || (d.kind !== 'prop' && d.kind !== 'guardrail')) continue;
      const dx = d.x - me.x, dy = d.y - me.y;
      const q = dx * dx + dy * dy;
      if (q > r2) continue;
      const l = Math.sqrt(q) || 1;
      this.destruction.recordHit(k, this.destruction.breakImpulse(k) * S.propMul, d.x, d.y, (dx / l) * 14, (dy / l) * 14);
    }
  }
}
