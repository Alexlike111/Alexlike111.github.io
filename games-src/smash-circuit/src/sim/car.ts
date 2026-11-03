// SimCar: planck body + arcade model + damage bookkeeping.
import * as planck from 'planck';
import { CONFIG } from '../config';
import type {
  CarInput, CarPart, CarSetup, CarState, CarStats, DestructibleKind, SimEvent, ZoneHp,
} from '../types';
import { ZONES } from '../types';
import { engineRpm, integrateCar, lateralSpeed, forwardSpeed, type CarKinematics, type Surface, SURFACE_ROAD } from './carModel';
import {
  PART_OFFSET, applyImpulseDamage, computeEffects, createZoneHp, partsToDetach, totalHealth,
} from './damage';
import { makeRng } from './rng';
import type { PhysicsWorld } from './world';

interface QueuedImpact { wx: number; wy: number; lx: number; ly: number; impulse: number; raw: number; other: 'car' | DestructibleKind; otherId: number }

const NEUTRAL: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };

export class SimCar {
  body: planck.Body;
  state: CarState;
  setup: CarSetup;
  private input: CarInput = { ...NEUTRAL };
  private kin: CarKinematics;
  private queue: QueuedImpact[] = [];
  private rng: () => number;
  private repaired = false;
  private scrapeCooldown = 0;
  private drifting = false;
  /** velocity handed to the solver this step (after the car model, before contacts) */
  /** Rubber-band assist 0..1 (AI only, set by the Sim): extra engine power / top speed when far behind the human. */
  assist = 0;
  private boosted: CarStats | null = null;
  private preVx = 0;
  private preVy = 0;
  private preW = 0;

  constructor(pw: PhysicsWorld, setup: CarSetup, x: number, y: number, angle: number) {
    this.setup = setup;
    const C = CONFIG.car;
    this.rng = makeRng(0x5eed + setup.id * 7919);
    this.body = pw.world.createBody({
      type: 'dynamic', position: { x, y }, angle, bullet: C.bullet,
      allowSleep: false, linearDamping: 0, angularDamping: 0,
    });
    this.body.createFixture({
      shape: new planck.Box(C.length / 2, C.width / 2),
      density: setup.stats.mass / (C.length * C.width),
      friction: 0.25, restitution: 0.2,
      userData: { kind: 'car', carId: setup.id },
    });
    this.kin = { x, y, angle, vx: 0, vy: 0, angularVel: 0, steer: 0 };

    const hp = createZoneHp(CONFIG.damage.zoneMaxHp);
    if (setup.startDamage) {
      for (const z of ZONES) {
        const v = setup.startDamage[z];
        if (v !== undefined) hp[z] = Math.max(0, Math.min(CONFIG.damage.zoneMaxHp, v));
      }
    }
    this.state = {
      id: setup.id, isPlayer: setup.isPlayer, colorIndex: setup.colorIndex, name: setup.name,
      x, y, angle, vx: 0, vy: 0, angularVel: 0, speed: 0, steer: 0,
      throttle: 0, brake: 0, handbrake: false, rpm: CONFIG.car.idleRpm,
      drifting: false, slip: 0,
      hp, zoneMaxHp: CONFIG.damage.zoneMaxHp, health: 1,
      effects: computeEffects(hp, CONFIG.damage.zoneMaxHp), detachedParts: [], wrecked: false,
      lap: 0, progress: 0, place: setup.id + 1, finished: false, finishTime: 0,
      lastLapTime: 0, bestLapTime: 0, onCurb: false, offRoad: false,
    };
    if (setup.startDamage) this.state.detachedParts = partsToDetach(hp, []); // pre-damaged: parts already gone
    this.refreshDamageState();
  }

  setInput(i: CarInput): void {
    this.input.throttle = i.throttle;
    this.input.brake = i.brake;
    this.input.steer = i.steer;
    this.input.handbrake = i.handbrake;
  }

  /** Teleport / place (e.g. start grid) and zero velocities. */
  reset(x: number, y: number, angle: number): void {
    this.body.setTransform({ x, y }, angle);
    this.body.setLinearVelocity({ x: 0, y: 0 });
    this.body.setAngularVelocity(0);
    this.kin = { x, y, angle, vx: 0, vy: 0, angularVel: 0, steer: 0 };
  }

  /** integrateCar -> set body velocities. Reads current velocity from the body (collisions included). */
  preStep(surface: Surface = SURFACE_ROAD, dt: number = CONFIG.physics.dt): void {
    const b = this.body;
    const p = b.getPosition(), v = b.getLinearVelocity();
    const k = this.kin;
    k.x = p.x; k.y = p.y; k.angle = b.getAngle();
    k.vx = v.x; k.vy = v.y; k.angularVel = b.getAngularVelocity();
    const out = integrateCar(k, this.input, this.statsNow(), this.state.effects, surface, dt);
    k.steer = out.steer;
    b.setLinearVelocity({ x: out.vx, y: out.vy });
    b.setAngularVelocity(out.angularVel);
    this.preVx = out.vx; this.preVy = out.vy; this.preW = out.angularVel;
    this.state.onCurb = surface.shake > 0 && surface.drag > 0 && surface.gripMul > 0.7;
    this.state.offRoad = !this.state.onCurb && (surface.drag > 0 || surface.gripMul < 1);
    if (this.scrapeCooldown > 0) this.scrapeCooldown -= dt;
  }

  /** Base stats, or a boosted copy while the rubber-band assist is on. */
  private statsNow(): CarStats {
    const a = this.assist;
    if (!(a > 0.001)) return this.setup.stats;
    const b = this.boosted ?? (this.boosted = { ...this.setup.stats });
    const base = this.setup.stats;
    b.enginePower = base.enginePower * (1 + CONFIG.ai.rubberPower * a);
    b.topSpeed = base.topSpeed * (1 + CONFIG.ai.rubberTop * a);
    return b;
  }

  /** Copy body -> state; derive slip / rpm. */
  postStep(): void {
    const b = this.body, s = this.state, C = CONFIG.car;
    const p = b.getPosition(), v = b.getLinearVelocity();
    const k = this.kin;
    k.x = p.x; k.y = p.y; k.angle = b.getAngle(); k.vx = v.x; k.vy = v.y; k.angularVel = b.getAngularVelocity();
    s.x = k.x; s.y = k.y; s.angle = k.angle; s.vx = k.vx; s.vy = k.vy; s.angularVel = k.angularVel;
    s.speed = forwardSpeed(k);
    s.steer = Math.max(-1, Math.min(1, k.steer + s.effects.steerPull));
    s.throttle = this.input.throttle; s.brake = this.input.brake; s.handbrake = this.input.handbrake;
    const lat = Math.abs(lateralSpeed(k));
    const thr = C.driftSlipThreshold;
    this.drifting = lat > (this.drifting ? thr * C.driftExitMul : thr);
    s.drifting = this.drifting;
    s.slip = Math.min(1, lat / (thr * 2.4));
    s.rpm = engineRpm(s.speed, this.setup.stats.topSpeed * s.effects.topSpeedMul, this.input.throttle, s.rpm, CONFIG.physics.dt);
  }

  /** Queued: applied in flushDamage (called after the world step, outside contact callbacks). */
  recordImpact(worldX: number, worldY: number, impulse: number, other: 'car' | DestructibleKind, otherId = -1): void {
    if (impulse < CONFIG.car.scrapeMin) return;
    const dx = worldX - this.state.x, dy = worldY - this.state.y;
    const c = Math.cos(this.state.angle), s = Math.sin(this.state.angle);
    this.queue.push({ wx: worldX, wy: worldY, lx: dx * c + dy * s, ly: -dx * s + dy * c, impulse, raw: impulse, other, otherId });
  }

  /**
   * The piece `otherId` (a static wall / guardrail / prop with outward contact normal n = (nx, ny), pointing from the
   * piece into the car) broke under this car in the step that just ran: the solver already bounced the car off it.
   * Restore the approach speed along the normal to `keep` of what it was before the solver ran (the car plows through),
   * give back the spin the contact caused, and shrink the queued damage of that piece to the impulse of the smaller
   * speed change (never more than `damageCap` N*s). Tangential speed is left as the solver produced it.
   */
  plowThrough(otherId: number, nx: number, ny: number, keep: number, damageCap: number): void {
    const b = this.body;
    const v = b.getLinearVelocity();
    const vnPre = this.preVx * nx + this.preVy * ny;      // < 0: moving into the piece
    const vnPost = v.x * nx + v.y * ny;
    if (vnPre >= -0.05) return;                            // not approaching: nothing to restore
    const vnNew = vnPre * keep;
    if (vnPost > vnNew) {
      const d = vnNew - vnPost;
      b.setLinearVelocity({ x: v.x + nx * d, y: v.y + ny * d });
    }
    b.setAngularVelocity(this.preW + (b.getAngularVelocity() - this.preW) * 0.15);
    const solverDv = Math.max(1e-6, vnPost - vnPre);
    const ratio = Math.max(0, Math.min(1, (vnNew - vnPre) / solverDv));
    for (const e of this.queue) {
      if (e.otherId !== otherId) continue;
      e.impulse = Math.min(e.impulse * ratio, damageCap);
    }
  }

  /** Apply queued damage, emit impact / scrape / partOff / wrecked / repair events. */
  flushDamage(events: SimEvent[]): void {
    const s = this.state, C = CONFIG.car, D = CONFIG.damage;
    if (this.repaired) {
      this.repaired = false;
      events.push({ type: 'repair', carId: s.id });
    }
    if (this.queue.length === 0) return;
    const q = this.queue;
    this.queue = [];

    let biggest: QueuedImpact | null = null;
    for (const e of q) {
      const mul = e.other === 'car' ? D.carVsCarMul : 1;
      applyImpulseDamage(s.hp, e.lx, e.ly, e.impulse, this.setup.stats.armor, mul);
      if (!biggest || e.raw > biggest.raw) biggest = e;   // the bang is as loud as the solver's hit (plow-through only softens the damage)
    }
    if (biggest) {
      if (biggest.raw >= C.impactEventMin) {
        events.push({
          type: 'impact', x: biggest.wx, y: biggest.wy, carId: s.id, other: biggest.other,
          strength: Math.min(1, Math.pow(biggest.raw / C.impactStrengthFull, C.impactStrengthCurve)),
        });
      } else if (this.scrapeCooldown <= 0) {
        this.scrapeCooldown = C.scrapeInterval;
        events.push({
          type: 'scrape', x: biggest.wx, y: biggest.wy, carId: s.id,
          strength: Math.min(1, biggest.raw / C.impactEventMin),
        });
      }
    }

    const wasWrecked = s.wrecked;
    this.refreshDamageState();
    this.detachParts(events);
    if (s.wrecked && !wasWrecked) events.push({ type: 'wrecked', carId: s.id });
  }

  repair(): void {
    const s = this.state;
    s.hp = createZoneHp(s.zoneMaxHp);
    s.detachedParts = [];
    s.wrecked = false;
    this.repaired = true;
    this.queue = [];
    this.refreshDamageState();
  }

  private refreshDamageState(): void {
    const s = this.state, D = CONFIG.damage;
    s.health = totalHealth(s.hp, s.zoneMaxHp);
    if (s.health <= D.wreckedBelow) s.wrecked = true; // sticky until repair()
    const fx = computeEffects(s.hp, s.zoneMaxHp);
    if (s.wrecked) {
      fx.powerMul *= D.wreckPowerMul;
      fx.topSpeedMul = Math.min(fx.topSpeedMul, 0.45);
      fx.smoke = 1;
    }
    s.effects = fx;
  }

  private detachParts(events: SimEvent[]): void {
    const s = this.state;
    const parts: CarPart[] = partsToDetach(s.hp, s.detachedParts);
    if (parts.length === 0) return;
    const c = Math.cos(s.angle), sn = Math.sin(s.angle);
    for (const part of parts) {
      s.detachedParts.push(part);
      const o = PART_OFFSET[part];
      const kick = CONFIG.damage.partKick * (0.6 + 0.8 * this.rng());
      const side = Math.hypot(o.x, o.y) || 1;
      const dirx = (o.x / side) * c - (o.y / side) * sn;
      const diry = (o.x / side) * sn + (o.y / side) * c;
      events.push({
        type: 'partOff', carId: s.id, part,
        x: s.x + o.x * c - o.y * sn, y: s.y + o.x * sn + o.y * c,
        vx: s.vx * 0.8 + dirx * kick, vy: s.vy * 0.8 + diry * kick,
      });
    }
  }
}
