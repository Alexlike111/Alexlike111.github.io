// Sim orchestrator: PhysicsWorld + SimCars on the start grid + DestructionSystem + AI drivers + race rules + ghost.
// Fixed-step accumulator; contact callbacks only RECORD impulses, everything is applied after the world step.
import type * as planck from 'planck';
import { CONFIG } from '../config';
import { smashValue } from '../meta/economy';
import { buildTrackGeometry } from '../track/spline';
import type {
  BoostPad, CarInput, CarSetup, CarState, DestructibleKind, DestructibleState, GhostData, ISim, ItemBox, OilSlick, RaceState, SimEvent,
  SimOptions, TrackGeometry,
} from '../types';
import { AiDriver, DEFAULT_PERSONALITY } from './ai';
import { AiItemUser } from './aiItems';
import { PowerUpSystem } from './powerups';
import { assistedInput } from './assist';
import { SimCar } from './car';
import { zoneForLocalPoint } from './damage';
import { DestructionSystem } from './destruction';
import { GhostRecorder, ghostPoseAt } from './ghost';
import { RaceTracker } from './race';
import { makeRng } from './rng';
import { PhysicsWorld, contactImpulse, contactPoint, fixtureData } from './world';

const NEUTRAL: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };

interface CrashHit { x: number; y: number; impulse: number; carId: number }
/** car <-> static destructible contact of this step; nx, ny = contact normal pointing from the piece into the car */
interface StaticHit { car: SimCar; id: number; nx: number; ny: number }

export interface PrevPose { x: number; y: number; angle: number }

export class Sim implements ISim {
  readonly track: TrackGeometry;
  readonly cars: CarState[];
  readonly destructibles: DestructibleState[];
  readonly race: RaceState;
  alpha = 0;
  stepMs = 0;

  // ---- extras beyond ISim (the renderer / game flow may use them)
  /** Pose of every car one fixed step ago: interpolate prev -> cars[i] with alpha. Same order as `cars`. */
  readonly prevPoses: PrevPose[];
  /** Moving average of stepMs. */
  avgStepMs = 0;
  /** Destructibles (walls, guardrails, props, road chunks) the player has broken: money bonus input. */
  brokenByPlayer = 0;
  /** money value of the pieces the player smashed (by object type, see CONFIG.economy.smashPay); curbs pay nothing */
  smashMoney = 0;
  /** smashes since the last `takeSmashes()` (HUD "+N" float) */
  private smashPending = 0;
  private smashPendingCount = 0;
  /** How many times a stuck AI car was put back on the road (should stay 0 in normal races). */
  respawns = 0;
  readonly physics: PhysicsWorld;
  readonly destruction: DestructionSystem;
  readonly tracker: RaceTracker;
  readonly simCars: SimCar[];
  /** boost pads, item boxes, oil slicks and the item logic */
  readonly powerups: PowerUpSystem;
  readonly pads: BoostPad[];
  readonly boxes: ItemBox[];
  readonly oils: OilSlick[];

  private readonly itemUsers: (AiItemUser | null)[];
  private readonly drivers: (AiDriver | null)[];
  private readonly others: CarState[][];
  private readonly byId = new Map<number, SimCar>();
  private readonly playerIndex: number;
  private readonly recorder: GhostRecorder;
  private readonly ghost: GhostData | null;
  private readonly lastHitBy: Int32Array;
  private lastRoadHitBy = -1;
  private input: CarInput = { ...NEUTRAL };
  private events: SimEvent[] = [];
  private crashes: CrashHit[] = [];
  private staticHits: StaticHit[] = [];
  /** car -> dynamic prop contacts this step: props get kicked clear after the step so they never ride on a bonnet */
  private propKicks: { car: SimCar; id: number }[] = [];
  private acc = 0;
  /** gentle steer-away-from-the-edge assist for the human (src/sim/assist.ts); tests may switch it off */
  playerAssist = true;
  private disposed = false;
  private gridSeed = 0;

  constructor(opts: SimOptions) {
    this.track = buildTrackGeometry(opts.track);
    this.physics = new PhysicsWorld();
    this.destruction = new DestructionSystem(this.physics, this.track);
    this.destructibles = this.destruction.states;
    this.lastHitBy = new Int32Array(this.destructibles.length).fill(-1);

    const setups = opts.cars;
    const n = setups.length;
    const laps = opts.laps ?? opts.track.laps ?? CONFIG.race.laps;
    const rng = makeRng(opts.seed);

    // ---- start grid: AI in a seeded random order, player in its configured slot
    this.gridSeed = opts.seed;
    this.playerIndex = setups.findIndex((c) => c.isPlayer);   // -1: all-AI sim (tests, menu demo)
    const slotOf = this.assignSlots(setups);
    this.simCars = new Array(n);
    this.cars = new Array(n);
    this.prevPoses = new Array(n);
    this.drivers = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      const pose = this.gridPose(slotOf[i]);
      const car = new SimCar(this.physics, setups[i], pose.x, pose.y, pose.angle);
      this.simCars[i] = car;
      this.cars[i] = car.state;
      this.prevPoses[i] = { x: pose.x, y: pose.y, angle: pose.angle };
      this.byId.set(setups[i].id, car);
      if (!setups[i].isPlayer) {
        const personality = setups[i].ai ?? DEFAULT_PERSONALITY;
        this.drivers[i] = new AiDriver(personality, makeRng(Math.floor(rng() * 4294967296) ^ (setups[i].id * 2654435761)));
        this.drivers[i]!.car = setups[i].stats;   // plans with its own car: cornering limit, brakes, ceiling, size
      }
    }
    this.others = this.cars.map((c) => this.cars.filter((o) => o !== c));
    this.powerups = new PowerUpSystem(this.track, this.simCars, this.destruction, opts.seed, opts.powerUps !== false);
    this.pads = this.powerups.pads; this.boxes = this.powerups.boxes; this.oils = this.powerups.oils;
    for (const d of this.drivers) if (d) d.hazards = this.oils;
    this.itemUsers = setups.map((c, i) => this.drivers[i]
      ? new AiItemUser(c.ai?.skill ?? DEFAULT_PERSONALITY.skill, makeRng(Math.floor(rng() * 4294967296) ^ (c.id * 40503)))
      : null);
    for (const u of this.itemUsers) if (u) u.oils = this.oils;

    this.tracker = new RaceTracker(this.track, laps, n);
    this.race = this.tracker.state;
    this.ghost = opts.ghost && opts.ghost.frames.length > 1 ? opts.ghost : null;
    this.recorder = new GhostRecorder(opts.track.id, this.ghost ? this.ghost.lapTime : Number.POSITIVE_INFINITY);

    this.physics.onPostSolve((contact, imp) => this.onPostSolve(contact, imp));
    this.tracker.update(this.cars, 0, this.events);   // initial grid positions + first countdown event
  }

  // ---------------------------------------------------------------------------------------------
  // ISim
  // ---------------------------------------------------------------------------------------------

  setPlayerInput(input: CarInput): void {
    this.input.throttle = input.throttle;
    this.input.brake = input.brake;
    this.input.steer = input.steer;
    this.input.handbrake = input.handbrake;
    this.input.drift = input.drift ?? 0;
  }

  update(frameDt: number): number {
    if (this.disposed) return 0;
    const dt = CONFIG.physics.dt;
    if (!(frameDt > 0)) { this.alpha = this.acc / dt; return 0; }
    this.acc += Math.min(frameDt, dt * CONFIG.physics.maxSubSteps);
    let n = 0;
    while (this.acc >= dt - 1e-9 && n < CONFIG.physics.maxSubSteps) {
      this.stepOnce(dt);
      this.acc -= dt;
      n++;
    }
    if (this.acc < 0) this.acc = 0;
    this.alpha = Math.min(1, this.acc / dt);
    if (n > 0) this.destruction.syncDynamic();
    return n;
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  repairPlayer(): void {
    if (this.playerIndex >= 0) this.simCars[this.playerIndex].repair();
  }

  useItem(): boolean {
    if (this.playerIndex < 0 || this.race.phase !== 'racing') return false;
    return this.powerups.use(this.playerIndex, this.events);
  }

  ghostPose(): { x: number; y: number; a: number } | null {
    const g = this.ghost;
    if (!g || this.playerIndex < 0 || this.race.phase !== 'racing' || this.race.playerFinished) return null;
    const p = this.cars[this.playerIndex];
    if (p.lap < CONFIG.race.ghostMinLap) return null;
    const t = this.race.time - this.tracker.lapStart[this.playerIndex];
    const end = g.frames[g.frames.length - 1].t;
    if (t > end + CONFIG.race.ghostHold) return null;
    return ghostPoseAt(g, Math.min(t, end));
  }

  bestGhost(): GhostData | null {
    return this.recorder.best;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.destruction.dispose();
    const w = this.physics.world;
    for (let b = w.getBodyList(); b;) {
      const next = b.getNext();
      w.destroyBody(b);
      b = next;
    }
    this.events.length = 0;
    this.crashes.length = 0;
  }

  // ---------------------------------------------------------------------------------------------
  // grid
  // ---------------------------------------------------------------------------------------------

  private assignSlots(setups: CarSetup[]): number[] {
    const n = setups.length;
    const slots = new Array<number>(n).fill(-1);
    const pSlot = this.playerIndex >= 0 ? Math.min(CONFIG.race.playerGridSlot, n - 1) : -1;
    if (this.playerIndex >= 0) slots[this.playerIndex] = pSlot;
    const rest: number[] = [];
    for (let i = 0; i < n; i++) if (i !== this.playerIndex) rest.push(i);
    // Grid order of the AI is a seeded shuffle (not by skill): the fastest car often starts mid-pack or last.
    const r = makeRng((this.gridSeed ^ 0x51ed270b) >>> 0);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const tmp = rest[i]; rest[i] = rest[j]; rest[j] = tmp;
    }
    let k = 0;
    for (let s = 0; s < n; s++) {
      if (s === pSlot) continue;
      slots[rest[k++]] = s;
    }
    return slots;
  }

  private gridPose(slot: number): { x: number; y: number; angle: number } {
    const row = Math.floor(slot / 2), col = slot % 2;
    const sp = CONFIG.race.startGridSpacing;
    const s = -(sp * (row + 1)) - (col ? sp * 0.5 : 0);
    const t = this.track.sampleAt(s);
    const lat = (col ? -1 : 1) * this.track.def.width * CONFIG.race.gridSideFraction;
    return { x: t.x + t.nx * lat, y: t.y + t.ny * lat, angle: Math.atan2(t.ty, t.tx) };
  }

  // ---------------------------------------------------------------------------------------------
  // contacts (inside the solver: record only)
  // ---------------------------------------------------------------------------------------------

  private onPostSolve(contact: planck.Contact, imp: planck.ContactImpulse): void {
    const total = contactImpulse(imp);
    if (total < CONFIG.car.scrapeMin) return;
    const da = fixtureData(contact.getFixtureA()), db = fixtureData(contact.getFixtureB());
    if (!da || !db) return;
    const p = contactPoint(contact);
    if (da.kind === 'car' && db.kind === 'car') {
      const a = this.byId.get(da.carId), b = this.byId.get(db.carId);
      // a ram shield (and the rammer traits) multiply the damage the OTHER car takes
      const dealA = a ? (a.buffs.shieldT > 0 ? CONFIG.items.shield.dealMul : 1) * this.ramMul(a, p.x, p.y) : 1;
      const dealB = b ? (b.buffs.shieldT > 0 ? CONFIG.items.shield.dealMul : 1) * this.ramMul(b, p.x, p.y) : 1;
      if (a) a.recordImpact(p.x, p.y, total, 'car', -1, dealB);
      if (b) b.recordImpact(p.x, p.y, total, 'car', -1, dealA);
      if (a) this.crashes.push({ x: p.x, y: p.y, impulse: total, carId: da.carId });
      return;
    }
    let car: SimCar | undefined, other: { kind: DestructibleKind; id: number } | null = null;
    if (da.kind === 'car') { car = this.byId.get(da.carId); if (db.kind !== 'car') other = db; }
    else if (db.kind === 'car') { car = this.byId.get(db.carId); other = da; }
    if (!car || !other) return;
    car.recordImpact(p.x, p.y, total, other.kind, other.id);
    const st = car.state;
    this.destruction.recordHit(other.id, car.buffs.shieldT > 0 ? total * CONFIG.items.shield.wallImpulseMul : total, p.x, p.y, st.vx, st.vy);
    if (other.kind === 'wall' || other.kind === 'guardrail' || other.kind === 'prop') {
      const wm = contact.getWorldManifold(null);
      if (wm) {
        const nx = wm.normal.x, ny = wm.normal.y;
        // planck normals point from fixture A to fixture B: flip so that n points from the piece into the car
        if (other.id >= 0 && this.destructibles[other.id].dynamic) this.propKicks.push({ car, id: other.id });
        if (other.id >= 0 && !this.destructibles[other.id].dynamic) this.staticHits.push({ car, id: other.id, nx: da.kind === 'car' ? -nx : nx, ny: da.kind === 'car' ? -ny : ny });
        if (other.kind !== 'prop') {
          const vn = st.vx * nx + st.vy * ny;
          this.destruction.recordScrape(other.id, Math.hypot(st.vx - vn * nx, st.vy - vn * ny), CONFIG.physics.dt, st.vx, st.vy);
        }
      }
    }
    if (other.id >= 0 && other.id < this.lastHitBy.length) this.lastHitBy[other.id] = st.id;
    if (other.kind !== 'road') this.crashes.push({ x: p.x, y: p.y, impulse: total, carId: st.id });
  }

  /** Trait 'ram': damage this car deals to another car at contact point (x, y); 'front only' rammers need their nose on it. */
  private ramMul(car: SimCar, x: number, y: number): number {
    const tr = car.setup.stats.traits;
    if (!tr || tr.ramDealMul === undefined) return 1;
    if (!tr.ramFrontOnly) return tr.ramDealMul;
    const st = car.state;
    const dx = x - st.x, dy = y - st.y, c = Math.cos(st.angle), sn = Math.sin(st.angle);
    return zoneForLocalPoint(dx * c + dy * sn, -dx * sn + dy * c, car.dims)[0] === 'front' ? tr.ramDealMul : 1;
  }

  /** Trait 'draft' (slipstream): a car close behind another one, lined up, gets a tow (0..1, smoothed). */
  private updateDrafts(dt: number): void {
    const n = this.cars.length;
    for (let i = 0; i < n; i++) {
      const car = this.simCars[i];
      const d = car.setup.stats.traits?.draft;
      if (!d) continue;
      const st = car.state;
      let want = 0;
      if (st.speed > 12) {
        const c = Math.cos(st.angle), sn = Math.sin(st.angle);
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          const o = this.cars[j];
          const dx = o.x - st.x, dy = o.y - st.y;
          const along = dx * c + dy * sn, lat = -dx * sn + dy * c;
          if (along > 3 && along < d.range && Math.abs(lat) < 2.4 && o.speed > 8) { want = Math.max(want, 1 - (along - 3) / (d.range - 3) * 0.4); }
        }
      }
      car.draft += (want - car.draft) * Math.min(1, dt * (want > car.draft ? 3 : 1.5));
    }
  }

  /**
   * The arcade car sets its own velocity every step, so a light prop it touches would just be pushed along
   * on the bonnet. After the step, throw each touched prop clear: forward a bit faster than the car and
   * sideways away from the car's centre line, with spin. A prop already flying faster than the car is left alone.
   */
  private kickProps(): void {
    if (!this.propKicks.length) return;
    const K = CONFIG.destruction.propKick;
    const seen = new Set<number>();
    for (const { car, id } of this.propKicks) {
      if (seen.has(id)) continue;
      seen.add(id);
      const body = this.destruction.bodyOf(id);
      if (!body) continue;
      const st = car.state;
      const sp = Math.hypot(st.vx, st.vy);
      if (sp < K.minSpeed) continue;
      const fx = st.vx / sp, fy = st.vy / sp;
      const pos = body.getPosition();
      const rx = pos.x - st.x, ry = pos.y - st.y;
      // side of the car's travel line the prop sits on (+1 left, -1 right); dead centre -> deterministic pick
      let side = Math.sign(-fy * rx + fx * ry);
      if (side === 0) side = (id & 1) ? 1 : -1;
      const v = body.getLinearVelocity();
      const along = v.x * fx + v.y * fy;
      if (along > sp * K.forwardMul * 0.95) continue;
      const fwd = sp * K.forwardMul, lat = sp * K.sideMul * side;
      body.setLinearVelocity({ x: fx * fwd - fy * lat, y: fy * fwd + fx * lat });
      body.setAngularVelocity(side * K.spin * Math.min(1, sp / 20));
      body.setAwake(true);
    }
    this.propKicks = [];
  }

  // ---------------------------------------------------------------------------------------------
  // one fixed step
  // ---------------------------------------------------------------------------------------------

  private stepOnce(dt: number): void {
    const t0 = performance.now();
    const n = this.cars.length;
    const racing = this.race.phase !== 'countdown';
    const hints = this.tracker.hints;

    // ---- power-ups: pads, boxes, oil, timers; AI cars decide whether to use their item
    this.powerups.update(dt, racing && this.race.phase === 'racing', this.events);
    if (racing) {
      for (let i = 0; i < n; i++) {
        const iu = this.itemUsers[i];
        if (iu && iu.update(dt, this.cars[i], this.others[i], this.track, hints[i], this.race.time)) this.powerups.use(i, this.events);
      }
    }

    // ---- inputs
    for (let i = 0; i < n; i++) {
      const st = this.cars[i];
      let input: CarInput = NEUTRAL;
      if (racing) {
        const d = this.drivers[i];
        if (d) {
          if (st.finished) d.speedCap = CONFIG.ai.finishedCruise;
          if (d.wantsRespawn && !st.finished) this.respawn(i);
          input = d.think(st, this.others[i], this.track, dt, hints[i]);
          this.simCars[i].assist = st.finished ? 0 : d.catchUp;
        } else input = this.playerAssist ? assistedInput(this.input, st, this.track, hints[i]) : this.input;
      }
      this.simCars[i].setInput(input);
    }

    // ---- surface + car model
    if (racing) this.updateDrafts(dt);
    for (let i = 0; i < n; i++) {
      const car = this.simCars[i];
      const pp = this.prevPoses[i];
      pp.x = car.state.x; pp.y = car.state.y; pp.angle = car.state.angle;
      const info = this.destruction.surfaceAt(car.state.x, car.state.y, hints[i]);
      car.preStep(info.surface, dt);
      if (info.curbId >= 0) this.destruction.scuffCurb(info.curbId, Math.abs(car.state.speed), dt);
    }

    // ---- physics
    this.physics.step();

    // ---- apply what the solver recorded (outside the callbacks)
    const events = this.events;
    const evStart = events.length;
    if (this.crashes.length) {
      const list = this.crashes;
      this.crashes = [];
      for (const c of list) {
        this.lastRoadHitBy = c.carId;
        this.destruction.hitRoad(c.x, c.y, c.impulse);
      }
    }
    this.kickProps();
    this.destruction.flush(events);
    this.plowThrough();
    this.countBreaks(evStart);
    for (let i = 0; i < n; i++) this.simCars[i].postStep();
    for (let i = 0; i < n; i++) this.simCars[i].flushDamage(events);

    // ---- race rules, ghost
    const raceStart = events.length;
    this.tracker.update(this.cars, dt, events);
    this.afterRaceEvents(raceStart);
    this.recordGhost();

    const ms = performance.now() - t0;
    this.stepMs = ms;
    this.avgStepMs += (ms - this.avgStepMs) * 0.02;
  }

  /**
   * Static pieces (walls, guardrails, signs, trees, rocks) that broke under a car this step: the solver treated them as
   * immovable and bounced the car, so give the car its speed back (see SimCar.plowThrough). Dynamic props never get here.
   */
  private plowThrough(): void {
    const list = this.staticHits;
    if (list.length === 0) return;
    this.staticHits = [];
    const D = CONFIG.destruction;
    for (const h of list) {
      const st = this.destructibles[h.id];
      if (!st.broken) continue;
      // a sign hardly slows the car; a juggernaut (trait) barely notices a wall
      const keep = st.maxHp <= D.plowSoftHp ? Math.max(D.plowSoftKeep, h.car.setup.stats.traits?.plowKeep ?? 0) : (h.car.setup.stats.traits?.plowKeep ?? D.plowKeep);
      h.car.plowThrough(h.id, h.nx, h.ny, keep, this.destruction.breakImpulse(h.id) * D.plowDamageCap);
    }
  }

  private countBreaks(from: number): void {
    const ev = this.events;
    for (let i = from; i < ev.length; i++) {
      const e = ev[i];
      if (e.type !== 'break') continue;
      const by = e.kind === 'road' ? this.lastRoadHitBy : (e.id >= 0 && e.id < this.lastHitBy.length ? this.lastHitBy[e.id] : -1);
      if (by >= 0 && this.byId.get(by)?.state.isPlayer && e.kind !== 'curb') {
        this.brokenByPlayer++;
        const pay = smashValue(e.kind, e.propType);
        if (pay > 0) { this.smashMoney += pay; this.smashPending += pay; }
        this.smashPendingCount++;
      }
    }
  }

  /** HUD: money and piece count smashed by the player since the last call. */
  takeSmashes(): { money: number; count: number } {
    const r = { money: this.smashPending, count: this.smashPendingCount };
    this.smashPending = 0; this.smashPendingCount = 0;
    return r;
  }

  private afterRaceEvents(from: number): void {
    const ev = this.events;
    for (let i = from; i < ev.length; i++) {
      const e = ev[i];
      if (e.type === 'lap') {
        const idx = this.cars.findIndex((c) => c.id === e.carId);
        if (idx === this.playerIndex) this.onPlayerLap(e.lap, e.lapTime);
      } else if (e.type === 'finish') {
        const idx = this.cars.findIndex((c) => c.id === e.carId);
        if (idx >= 0 && idx !== this.playerIndex) this.ghostCar(idx);
        if (idx === this.playerIndex) this.recorder.stop();
      }
    }
  }

  private onPlayerLap(lap: number, lapTime: number): void {
    const p = this.cars[this.playerIndex];
    const cross = this.tracker.lapStart[this.playerIndex];
    if (lap === CONFIG.race.ghostMinLap) this.recorder.start(cross);
    else if (lap > CONFIG.race.ghostMinLap) {
      // only a clean (gate-valid, not cut) lap may become the ghost; a cut lap is dropped and the next one recorded
      if (this.tracker.lastLapValid[this.playerIndex]) this.recorder.finishLap(cross, lapTime, p.x, p.y, p.angle);
      else this.recorder.start(cross);
    }
  }

  private recordGhost(): void {
    if (!this.recorder.recording || this.playerIndex < 0) return;
    const p = this.cars[this.playerIndex];
    this.recorder.update(this.race.time, p.x, p.y, p.angle);
  }

  /** A finished AI car keeps cruising but no longer collides (it must not block the cars still racing). */
  private ghostCar(i: number): void {
    for (let f = this.simCars[i].body.getFixtureList(); f; f = f.getNext()) f.setSensor(true);
  }

  /**
   * Puts a stuck AI car back onto the centre of the road, facing forward, on a free spot: at its nearest road point or
   * behind it, never ahead (a respawn must not gain ground, and it never skips a lap gate).
   */
  private respawn(i: number): void {
    const car = this.simCars[i];
    const st = car.state;
    const near = this.track.nearest(st.x, st.y, this.tracker.hints[i]);
    let best: { x: number; y: number; angle: number } | null = null;
    for (let k = 0; k < 8 && !best; k++) {
      const smp = this.track.sampleAt(near.s - k * 5);
      let free = true;
      for (const o of this.cars) {
        if (o !== st && Math.hypot(o.x - smp.x, o.y - smp.y) < 6) { free = false; break; }
      }
      if (free) best = { x: smp.x, y: smp.y, angle: Math.atan2(smp.ty, smp.tx) };
    }
    if (!best) {
      const smp = this.track.sampleAt(near.s);
      best = { x: smp.x, y: smp.y, angle: Math.atan2(smp.ty, smp.tx) };
    }
    car.reset(best.x, best.y, best.angle);
    st.x = best.x; st.y = best.y; st.angle = best.angle; st.vx = 0; st.vy = 0; st.speed = 0; st.angularVel = 0;
    this.prevPoses[i].x = best.x; this.prevPoses[i].y = best.y; this.prevPoses[i].angle = best.angle;
    this.drivers[i]?.notifyRespawn();
    this.respawns++;
  }
}

export function createSim(opts: SimOptions): ISim {
  return new Sim(opts);
}
