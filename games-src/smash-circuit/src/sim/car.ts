// SimCar: planck body + arcade model + damage bookkeeping.
import * as planck from 'planck';
import { CONFIG } from '../config';
import type {
  CarInput, CarPart, CarSetup, CarState, CarStats, DestructibleKind, SimEvent, ZoneHp, ZoneId,
} from '../types';
import { ZONES } from '../types';
import { engineRpm, integrateCar, lateralSpeed, forwardSpeed, wrapAngle, type CarKinematics, type Surface, SURFACE_ROAD } from './carModel';
import { DriftTracker } from './drift';
import {
  PART_OFFSET, applyImpulseDamage, computeEffects, createZoneHp, partsKnockedOff, partsToDetach, totalHealth, zoneForLocalPoint, type CarDims,
} from './damage';
import { CarBuffs } from './buffs';
import { makeRng } from './rng';
import type { PhysicsWorld } from './world';

interface QueuedImpact { wx: number; wy: number; lx: number; ly: number; impulse: number; raw: number; other: 'car' | DestructibleKind; otherId: number }

const NEUTRAL: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
/** body sides a single hard hit can knock parts off (index into SimCar.knock) */
const KNOCK_SIDES: ZoneId[] = ['front', 'rear', 'left', 'right'];

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
  /** timed power-up effects (boost pad, nitro, ram shield, oil spin); driven by the PowerUpSystem */
  readonly buffs = new CarBuffs();
  /** drift mechanic: entry / exit, boost tiers, points (src/sim/drift.ts) */
  readonly drift = new DriftTracker();
  private baseDensity = 0;
  private preVx = 0;
  private preVy = 0;
  private preW = 0;
  /** impact layer (world frame): sideways velocity and spin a collision gave the car, decaying on their own (CONFIG.car.impact) */
  private impVx = 0;
  private impVy = 0;
  private impW = 0;
  /** s left of the crash state after a heavy hit: steering and grip re-alignment suspended */
  private crashT = 0;
  private crashStats: CarStats | null = null;
  private readonly crashInput: CarInput = { ...NEUTRAL };
  /** side the first real hit came from (+1 right, -1 left, 0 none yet): which way a symmetric nose loss pulls */
  private pullDir = 0;
  /** per-piece hit windows (wall / guardrail / prop): impulses summed so the damage threshold applies once per hit */
  private windows: { key: number; t: number; sum: number }[] = [];
  /** biggest single hit (N*s) per body side in the step being flushed: front, rear, left, right */
  private knock = new Float64Array(4);
  /** hitbox (m) of this model */
  readonly dims: CarDims;
  /** impulse -> damage normalisation: massRef / mass (a light car takes more damage from the same impulse) */
  private readonly massNorm: number;
  /** slipstream level 0..1 (trait 'draft'; set by the Sim each step) */
  draft = 0;
  /** s since this car last took damage (trait 'regen') */
  private sinceHit = 0;
  private regenAcc = 0;
  /** off-road surface with the car's off-road trait applied (reused) */
  private readonly offSurf: Surface = { gripMul: 1, drag: 0, shake: 0 };

  constructor(pw: PhysicsWorld, setup: CarSetup, x: number, y: number, angle: number) {
    this.setup = setup;
    const C = CONFIG.car;
    this.rng = makeRng(0x5eed + setup.id * 7919);
    this.body = pw.world.createBody({
      type: 'dynamic', position: { x, y }, angle, bullet: C.bullet,
      allowSleep: false, linearDamping: 0, angularDamping: 0,
    });
    const st = setup.stats;
    const L = st.length ?? C.length, W = st.width ?? C.width;
    this.dims = { length: L, width: W };
    this.massNorm = CONFIG.cars.massRef / Math.max(100, st.mass);
    this.body.createFixture({
      shape: new planck.Box(L / 2, W / 2),
      density: st.mass / (L * W),
      friction: 0.25, restitution: 0.2,
      userData: { kind: 'car', carId: setup.id },
    });
    this.baseDensity = st.mass / (L * W);
    const ease = st.drift ?? 1;
    this.drift.entryMul = 1 / Math.pow(ease, CONFIG.cars.driftEntryPow);
    this.drift.chargeMul = Math.pow(ease, CONFIG.cars.driftChargePow) * (st.traits?.driftCharge ?? 1);
    this.drift.boostTimeMul = st.traits?.boostTimeMul ?? 1;
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
      modelId: st.modelId ?? CONFIG.cars.starter, length: L, width: W,
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
    this.input.drift = i.drift ?? 0;
  }

  /** Teleport / place (e.g. start grid) and zero velocities. */
  reset(x: number, y: number, angle: number): void {
    this.body.setTransform({ x, y }, angle);
    this.body.setLinearVelocity({ x: 0, y: 0 });
    this.body.setAngularVelocity(0);
    this.kin = { x, y, angle, vx: 0, vy: 0, angularVel: 0, steer: 0 };
    this.drift.reset();
    this.preVx = 0; this.preVy = 0; this.preW = 0;
    this.impVx = 0; this.impVy = 0; this.impW = 0; this.crashT = 0;
  }

  /** Seconds left of the crash state (0 = driving normally). */
  get crashTime(): number { return this.crashT; }

  /** integrateCar -> set body velocities. Reads current velocity from the body (collisions included). */
  preStep(surface: Surface = SURFACE_ROAD, dt: number = CONFIG.physics.dt): void {
    const b = this.body;
    const p = b.getPosition(), v = b.getLinearVelocity();
    const k = this.kin;
    k.x = p.x; k.y = p.y; k.angle = b.getAngle();
    const bw = b.getAngularVelocity();
    // ---- impact layer: what the contacts did to the car since our last preStep. The sideways part (car frame) and the spin
    // are kept apart from the arcade model, which would turn a shove into forward speed and damp a spin out within 0.2 s
    const IM = CONFIG.car.impact;
    {
      const ca = Math.cos(k.angle), sa = Math.sin(k.angle);
      const dvx = v.x - this.preVx, dvy = v.y - this.preVy;
      const dl = -dvx * sa + dvy * ca;
      if (Math.abs(dl) >= IM.minDv) { this.impVx -= sa * dl; this.impVy += ca * dl; }
      const dw = bw - this.preW;
      if (Math.abs(dw) >= IM.minDw) this.impW += dw;
      const kv = Math.exp(-IM.decay * dt), kw = Math.exp(-IM.spinDecay * dt);
      this.impVx *= kv; this.impVy *= kv; this.impW *= kw;
      const lim = IM.maxFrac * Math.hypot(v.x, v.y), im = Math.hypot(this.impVx, this.impVy);
      if (im > lim) { const f = lim / Math.max(im, 1e-9); this.impVx *= f; this.impVy *= f; }
      if (this.impW > IM.spinMax) this.impW = IM.spinMax; else if (this.impW < -IM.spinMax) this.impW = -IM.spinMax;
      if (this.buffs.spinT > 0) this.impW = 0;      // the oil spin owns the rotation
    }
    k.vx = v.x - this.impVx; k.vy = v.y - this.impVy; k.angularVel = bw - this.impW;
    // ---- drift: entry / exit decisions; a clean exit with a charged tier kicks the car forward along the nose
    const sp = Math.hypot(k.vx, k.vy);
    const fwd = k.vx * Math.cos(k.angle) + k.vy * Math.sin(k.angle);
    const beta = sp > 1 ? wrapAngle(k.angle - Math.atan2(k.vy, k.vx)) : 0;
    const dr = this.drift;
    if (this.buffs.spinT > 0 && dr.active) dr.cancel();             // oil spin: no drift
    const pre = dr.pre(this.input, fwd, sp, beta, this.setup.isPlayer, dt);
    if (pre.kick > 0) { k.vx += Math.cos(k.angle) * pre.kick; k.vy += Math.sin(k.angle) * pre.kick; }
    const tr = this.setup.stats.traits;
    if (tr && (tr.offroadDragMul !== undefined || tr.offroadGripMul !== undefined) && surface.drag > 0 && !(surface.shake > 0 && surface.gripMul > 0.7)) {
      // trait 'off-road king': grass and torn road barely slow it (curbs are left as they are)
      const o = this.offSurf;
      o.drag = surface.drag * (tr.offroadDragMul ?? 1);
      o.gripMul = Math.min(1, surface.gripMul * (tr.offroadGripMul ?? 1));
      o.shake = surface.shake;
      surface = o;
    }
    // crash state after a heavy hit: no steering, (almost) no re-alignment of the slide onto the nose
    let input = this.input, stats = this.statsNow();
    if (this.crashT > 0) {
      this.crashT -= dt;
      const ci = this.crashInput;
      ci.throttle = input.throttle; ci.brake = input.brake; ci.handbrake = input.handbrake; ci.drift = 0; ci.steer = 0;
      input = ci;
      const cs = this.crashStats ?? (this.crashStats = { ...stats });
      Object.assign(cs, stats);
      cs.grip = stats.grip * IM.crashGripMul;
      stats = cs;
    }
    const out = integrateCar(k, input, stats, this.state.effects, surface, dt, dr.ctl);
    k.steer = out.steer;
    // oil slick: the car spins whatever the driver does (the model would damp a kick within a few steps)
    const w = this.buffs.spinT > 0 ? this.buffs.spinRate() : out.angularVel + this.impW;
    const vx = out.vx + this.impVx, vy = out.vy + this.impVy;
    b.setLinearVelocity({ x: vx, y: vy });
    b.setAngularVelocity(w);
    this.preVx = vx; this.preVy = vy; this.preW = w;
    this.state.onCurb = surface.shake > 0 && surface.drag > 0 && surface.gripMul > 0.7;
    this.state.offRoad = !this.state.onCurb && (surface.drag > 0 || surface.gripMul < 1);
    if (this.scrapeCooldown > 0) this.scrapeCooldown -= dt;
  }

  /** Base stats, or a boosted copy while the rubber-band assist is on. */
  private statsNow(): CarStats {
    const a = this.assist > 0.001 ? this.assist : 0;
    const bf = this.buffs;
    const db = this.drift.boostT > 0;
    const dr = this.draft > 0.001 ? this.draft : 0;
    if (a === 0 && !bf.active && !db && dr === 0) return this.setup.stats;
    const b = this.boosted ?? (this.boosted = { ...this.setup.stats });
    const base = this.setup.stats;
    const caps = CONFIG.items.caps;
    // drift exit boost and slipstream (trait) stack with pads / nitro under the same caps
    const dt = base.traits?.draft;
    const dp = dt && dr > 0 ? 1 + dt.power * dr : 1, dc = dt && dr > 0 ? 1 + dt.ceil * dr : 1;
    const pm = Math.min(caps.power, (db ? bf.powerMul * CONFIG.drift.boostPowerMul : bf.powerMul) * dp);
    const cm = Math.min(caps.ceil, (db ? bf.ceilMul * CONFIG.drift.boostCeilMul : bf.ceilMul) * dc);
    b.enginePower = base.enginePower * (1 + CONFIG.ai.rubberPower * a) * pm;
    b.topSpeed = base.topSpeed * (1 + CONFIG.ai.rubberTop * a) * cm;
    b.grip = base.grip * bf.gripMul;
    return b;
  }

  /**
   * Power-up shove: add a velocity change (m/s) to the body right now. A boost (default) is the car's own speed; `asImpact`
   * (a shockwave hit) goes to the impact layer like a collision, so the tyres do not turn it into forward speed.
   */
  kick(dvx: number, dvy: number, asImpact = false): void {
    const v = this.body.getLinearVelocity();
    this.body.setLinearVelocity({ x: v.x + dvx, y: v.y + dvy });
    if (!asImpact) { this.preVx += dvx; this.preVy += dvy; }
  }

  /** Ram shield on/off: a shielded car is heavier in collisions (mass x CONFIG.items.shield.massMul). */
  setHeavy(on: boolean): void {
    const f = this.body.getFixtureList();
    if (!f) return;
    f.setDensity(this.baseDensity * (on ? CONFIG.items.shield.massMul : 1));
    this.body.resetMassData();
  }

  /** Repair kit: every zone regains `frac` of its missing hp (at least `minHp`, never above max). Lost parts stay lost. */
  heal(frac: number, minHp: number): void {
    const s = this.state;
    for (const z of ZONES) {
      const missing = s.zoneMaxHp - s.hp[z];
      if (missing <= 0) continue;
      s.hp[z] = Math.min(s.zoneMaxHp, s.hp[z] + Math.max(minHp, missing * frac));
    }
    this.repaired = true;                 // emits the 'repair' event (sparks + sound) at the next flush
    this.refreshDamageState();
    if (s.wrecked && s.health > CONFIG.damage.wreckedBelow * 2) { s.wrecked = false; this.refreshDamageState(); }
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
    const dr = this.drift;
    this.drifting = dr.active || lat > (this.drifting ? thr * C.driftExitMul : thr);
    s.drifting = this.drifting;
    s.slip = Math.min(1, Math.max(lat / (thr * 2.4), dr.active ? 0.45 + 0.55 * Math.min(1, dr.angle / CONFIG.drift.angleMax) : 0));
    s.driftActive = dr.active; s.driftDir = dr.dir; s.driftAngle = dr.active ? dr.angle : 0;
    s.driftTier = dr.active ? dr.tier : 0; s.driftCharge = dr.charge;
    s.driftPoints = dr.active ? dr.livePoints : 0; s.driftCombo = dr.combo; s.driftScore = dr.score;
    s.driftBank = dr.lastBank; s.driftBankT = dr.bankT; s.driftCancelT = dr.cancelT;
    s.driftBoostT = dr.boostT; s.driftBoostTier = dr.boostTier;
    s.rpm = engineRpm(s.speed, this.setup.stats.topSpeed * s.effects.topSpeedMul, this.input.throttle, s.rpm, CONFIG.physics.dt);
  }

  /** A graze along a wall (proximity scrape, see Sim.grazeWalls): sparks, on the same cooldown as contact scrapes. */
  scrapeSpark(x: number, y: number, slideSpeed: number, events: SimEvent[]): void {
    if (this.scrapeCooldown > 0) return;
    this.scrapeCooldown = CONFIG.car.scrapeInterval;
    events.push({ type: 'scrape', x, y, carId: this.state.id, strength: Math.min(1, 0.25 + slideSpeed / 50) });
  }

  /** Queued: applied in flushDamage (called after the world step, outside contact callbacks). */
  recordImpact(worldX: number, worldY: number, impulse: number, other: 'car' | DestructibleKind, otherId = -1, dealMul = 1): void {
    if (impulse < CONFIG.car.scrapeMin) return;
    const dx = worldX - this.state.x, dy = worldY - this.state.y;
    const c = Math.cos(this.state.angle), s = Math.sin(this.state.angle);
    this.queue.push({ wx: worldX, wy: worldY, lx: dx * c + dy * s, ly: -dx * s + dy * c, impulse: impulse * dealMul, raw: impulse, other, otherId });
  }

  /**
   * The piece `otherId` (a static wall / guardrail / prop with outward contact normal n = (nx, ny), pointing from the
   * piece into the car) broke under this car in the step that just ran: the solver already bounced the car off it.
   * Restore the approach speed along the normal to `keep` of what it was before the solver ran (the car plows through),
   * give back the spin the contact caused, and soften the queued damage of that piece: the impulse that breaks the piece
   * (`breakImpulse`) is charged in full, only the part above it shrinks to the impulse of the smaller speed change, never
   * more than `damageCap` N*s in all. So a harder hit never costs less than a softer one. Tangential speed is left as the
   * solver produced it.
   */
  plowThrough(otherId: number, nx: number, ny: number, keep: number, damageCap: number,
    breakImpulse: number = damageCap / CONFIG.destruction.plowDamageCap): void {
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
      e.impulse = Math.min(damageCap, Math.min(e.impulse, breakImpulse) + Math.max(0, e.impulse - breakImpulse) * ratio);
    }
  }

  /** Apply queued damage, emit impact / scrape / partOff / wrecked / repair events. */
  flushDamage(events: SimEvent[]): void {
    const s = this.state, C = CONFIG.car, D = CONFIG.damage;
    if (this.repaired) {
      this.repaired = false;
      events.push({ type: 'repair', carId: s.id });
    }
    // age the per-piece hit windows
    const win = this.windows;
    for (let i = win.length - 1; i >= 0; i--) {
      win[i].t += CONFIG.physics.dt;
      if (win[i].t > D.hitWindow) win.splice(i, 1);
    }
    if (this.queue.length === 0) { this.regen(CONFIG.physics.dt); return; }
    const q = this.queue;
    this.queue = [];
    const IM = C.impact;

    let biggest: QueuedImpact | null = null;
    const knock = this.knock;
    knock.fill(0);
    const tr = this.setup.stats.traits;
    const mn = this.massNorm;
    for (const e of q) {
      let mul = (e.other === 'car' ? D.carVsCarMul : 1) * (this.buffs.shieldT > 0 ? CONFIG.items.shield.damageTaken : 1);
      // trait 'bull bar': the nose shrugs hits off
      if (tr?.frontTakenMul !== undefined && zoneForLocalPoint(e.lx, e.ly, this.dims)[0] === 'front') mul *= tr.frontTakenMul;
      // mass normalisation: the same impulse is a bigger velocity change (more damage) for a lighter car; the no-damage
      // threshold applies to the normalised impulse, so a heavy car is not punished for its mass on walls
      let imp = e.impulse * mn;
      if (e.other !== 'car') {
        // one hit is a few solver steps (a glancing hit: 3-4 small ones, often on neighbouring segments of the same barrier):
        // sum them, the threshold applies once. Walls and guardrails are one barrier, props count one by one.
        const key = e.other === 'wall' || e.other === 'guardrail' || e.otherId < 0 ? -2 : e.otherId;
        let w = win.find((x) => x.key === key);
        if (!w) { w = { key, t: 0, sum: 0 }; win.push(w); }
        const thr = D.impulseThreshold;
        const before = Math.max(0, w.sum - thr);
        w.sum += imp;
        const inc = Math.max(0, w.sum - thr) - before;
        imp = inc > 0 ? thr + inc : 0;
      }
      const hit = applyImpulseDamage(s.hp, e.lx, e.ly, imp, this.setup.stats.armor, mul, this.dims);
      if (hit.damage > 0) {
        this.sinceHit = 0;
        // remember the side of the first real hit: a symmetric nose loss pulls that way (seeded pick for a dead-centre hit)
        if (this.pullDir === 0) this.pullDir = Math.abs(e.ly) > 0.05 ? (e.ly < 0 ? 1 : -1) : (this.rng() < 0.5 ? -1 : 1);
      }
      // a heavy hit: short crash state (no steering, the slide is not pulled back onto the nose)
      const crashAt = IM.crashImpulse * (e.other === 'car' ? IM.crashCarMul : 1);
      if (e.raw >= crashAt) {
        const f = Math.min(1, e.raw / crashAt - 1);
        this.crashT = Math.max(this.crashT, IM.crashTime[0] + (IM.crashTime[1] - IM.crashTime[0]) * f);
      }
      // the bang (solver impulse, before plow-through softening) decides what is knocked off; armor makes parts stick better
      const k = KNOCK_SIDES.indexOf(hit.zones[0]);
      if (k >= 0) knock[k] = Math.max(knock[k], (e.raw * mn * mul) / Math.max(1, this.setup.stats.armor));
      if (!biggest || e.raw > biggest.raw) biggest = e;   // the bang is as loud as the solver's hit (plow-through only softens the damage)
      // a hard hit ends the drift with nothing banked (car taps need twice the impulse)
      if (e.raw >= CONFIG.drift.cancelImpulse * (e.other === 'car' ? 2 : 1)) this.drift.cancel();
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
    this.regen(CONFIG.physics.dt);
  }

  /** Trait 'regen' (self-repair): after a quiet spell every zone below the cap slowly heals. Parts stay off. */
  private regen(dt: number): void {
    const rg = this.setup.stats.traits?.regen;
    if (!rg) return;
    this.sinceHit += dt;
    if (this.sinceHit < rg.delay) return;
    this.regenAcc += dt;
    if (this.regenAcc < 0.1) return;            // 10 Hz is plenty (and keeps computeEffects off the hot path)
    const step = this.regenAcc;
    this.regenAcc = 0;
    const s = this.state;
    const cap = s.zoneMaxHp * rg.cap;
    let changed = false;
    for (const z of ZONES) {
      if (s.hp[z] >= cap) continue;
      s.hp[z] = Math.min(cap, s.hp[z] + rg.perSec * step);
      changed = true;
    }
    if (!changed) return;
    this.refreshDamageState();
    if (s.wrecked && s.health > CONFIG.damage.wreckedBelow * 2) { s.wrecked = false; this.refreshDamageState(); }
  }

  repair(): void {
    const s = this.state;
    s.hp = createZoneHp(s.zoneMaxHp);
    s.detachedParts = [];
    s.wrecked = false;
    this.repaired = true;
    this.queue = [];
    this.windows.length = 0;
    this.pullDir = 0;
    this.refreshDamageState();
  }

  private refreshDamageState(): void {
    const s = this.state, D = CONFIG.damage;
    s.health = totalHealth(s.hp, s.zoneMaxHp);
    if (s.health <= D.wreckedBelow) s.wrecked = true; // sticky until repair()
    const fx = computeEffects(s.hp, s.zoneMaxHp, this.pullDir);
    if (s.wrecked) {
      fx.powerMul *= D.wreckPowerMul;
      fx.topSpeedMul = Math.min(fx.topSpeedMul, 0.45);
      fx.smoke = 1;
    }
    s.effects = fx;
  }

  private detachParts(events: SimEvent[]): void {
    const s = this.state;
    for (let k = 0; k < KNOCK_SIDES.length; k++) {
      if (this.knock[k] <= 0) continue;
      for (const part of partsKnockedOff(KNOCK_SIDES[k], this.knock[k], s.detachedParts)) this.emitPartOff(part, events);
    }
    for (const part of partsToDetach(s.hp, s.detachedParts)) this.emitPartOff(part, events);
  }

  private emitPartOff(part: CarPart, events: SimEvent[]): void {
    const s = this.state;
    const c = Math.cos(s.angle), sn = Math.sin(s.angle);
    s.detachedParts.push(part);
    const o0 = PART_OFFSET[part];
    const o = { x: o0.x * (this.dims.length / CONFIG.car.length), y: o0.y * (this.dims.width / CONFIG.car.width) };
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
