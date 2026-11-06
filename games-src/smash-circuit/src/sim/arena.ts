// Demolition Arena: an enclosed ring arena (concrete centre pillar + outer wall), hunt AI and the round / score rules.
// Pure sim-side code (no DOM). The Sim keeps doing physics, damage, destruction and items; this module only
// (1) drives the AI cars through Sim.aiOverride, (2) watches health / breaks to score, (3) removes wrecked cars.
import type { CarInput, CarState, PropDef, PropType, TrackDef } from '../types';

export const ARENA = {
  roundTime: 90,          // s of play after the countdown
  rivals: 5,              // AI cars
  dmgPoints: 1000,        // points for a whole car's health worth of damage dealt
  wreckPoints: 500,       // a car the player wrecked
  propPoints: 25,         // a prop / wall piece the player smashed
  comboWindow: 3,         // s: scoring again within this keeps the combo going
  comboGap: 0.35,         // s: one ram counts as one combo step (damage spread over several frames)
  comboMax: 5,
  hitRange: 7.5,          // m: damage of a car is credited to the nearest other car within this range
  creditTime: 3,          // s: a wreck is credited to the last car that hurt it within this time
  removeDelay: 0.7,       // s between the wreck explosion and the car leaving the arena
  coinsPerPoint: 1 / 25,  // coins earned = score * this
  survivalBonus: 150,     // points for surviving to the bell
  hunt: { stuckSpeed: 1.6, stuckTime: 0.9, backTime: 0.9, retargetEvery: 1.5, lead: 0.25 },
} as const;

// ---------------------------------------------------------------------------------------------
// arena geometry: a wide ring (inner edge = the centre pillar, outer edge = the arena wall)
// ---------------------------------------------------------------------------------------------

function ring(r: number, n: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r }); }
  return out;
}

function arenaProps(): PropDef[] {
  const props: PropDef[] = [];
  const types: PropType[] = ['crate', 'barrel', 'tireStack', 'cone', 'hayBale', 'barrel'];
  let k = 0;
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + 0.17;
    const r = 15 + ((i * 7) % 5) * 4.2;
    props.push({ type: types[k++ % types.length], x: Math.cos(a) * r, y: Math.sin(a) * r, angle: a });
  }
  // four stone pillars in the open ring
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    props.push({ type: 'rock', x: Math.cos(a) * 27, y: Math.sin(a) * 27, angle: 0 });
  }
  return props;
}

export const ARENA_TRACK: TrackDef = {
  id: 'arena',
  nameKey: 'arena.title',
  theme: 'desert',
  laps: 99,
  width: 30,
  points: ring(26, 16),
  props: arenaProps(),
  wallStyle: 'concrete',
};

// ---------------------------------------------------------------------------------------------
// hunt AI
// ---------------------------------------------------------------------------------------------

const wrapPi = (a: number): number => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

/** Hunt behaviour: pick the nearest / weakest live car, drive at it flat out, back off and retry when stuck. */
export class HuntDriver {
  targetId = -1;
  private retarget = 0;
  private stuckT = 0;
  private backT = 0;
  private backSteer = 1;
  readonly out: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };

  /** Lower is better: distance weighted by the target's health (a weak car is worth chasing further). */
  static pick(me: CarState, cars: readonly CarState[], alive: (c: CarState) => boolean): CarState | null {
    let best: CarState | null = null, bestScore = Infinity;
    for (const o of cars) {
      if (o === me || !alive(o)) continue;
      const d = Math.hypot(o.x - me.x, o.y - me.y);
      const sc = d * (0.45 + o.health) + (o.isPlayer ? -4 : 0);
      if (sc < bestScore) { bestScore = sc; best = o; }
    }
    return best;
  }

  think(me: CarState, cars: readonly CarState[], dt: number, alive: (c: CarState) => boolean): CarInput {
    const H = ARENA.hunt, o = this.out;
    this.retarget -= dt;
    let target = cars.find((c) => c.id === this.targetId) ?? null;
    if (!target || !alive(target) || this.retarget <= 0) {
      target = HuntDriver.pick(me, cars, alive);
      this.targetId = target ? target.id : -1;
      this.retarget = H.retargetEvery;
    }
    if (this.backT > 0) {
      this.backT -= dt;
      o.throttle = 0; o.brake = 1; o.steer = this.backSteer; o.handbrake = false;
      return o;
    }
    if (!target) { o.throttle = 0.3; o.brake = 0; o.steer = 0.6; o.handbrake = false; return o; }
    const tx = target.x + target.vx * H.lead, ty = target.y + target.vy * H.lead;
    const want = Math.atan2(ty - me.y, tx - me.x);
    const err = wrapPi(want - me.angle);
    o.steer = Math.max(-1, Math.min(1, err * 2.2));
    o.throttle = Math.abs(err) > 2.2 ? 0.6 : 1;
    o.brake = 0;
    o.handbrake = Math.abs(err) > 1.4 && me.speed > 10;
    // stuck (pinned against a wall, a pillar or the target): reverse with opposite lock, then go again
    if (Math.abs(me.speed) < H.stuckSpeed) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    if (this.stuckT > H.stuckTime) {
      this.stuckT = 0;
      this.backT = H.backTime;
      this.backSteer = err > 0 ? -1 : 1;
      this.retarget = 0;
    }
    return o;
  }
}

// ---------------------------------------------------------------------------------------------
// round rules + score
// ---------------------------------------------------------------------------------------------

export type ArenaEndReason = 'time' | 'lastStanding' | 'wrecked';

export interface ArenaScoreEvent { kind: 'damage' | 'wreck' | 'prop'; points: number; combo: number }

/** Minimal view of the sim this match needs (the real Sim satisfies it; tests may use it directly). */
export interface ArenaSimView {
  cars: CarState[];
  race: { phase: string };
  brokenByPlayer: number;
}

export class ArenaMatch {
  score = 0;
  combo = 1;
  comboT = 0;
  time = 0;                 // s of play (after the countdown)
  wrecks = 0;               // cars the player wrecked
  damageDealt = 0;          // health units (1 = a whole car) the player dealt
  props = 0;
  ended: ArenaEndReason | null = null;
  readonly dead = new Set<number>();          // car ids wrecked (removed or about to be)
  readonly removed = new Set<number>();
  readonly scoreEvents: ArenaScoreEvent[] = [];
  private readonly prevHealth = new Map<number, number>();
  private readonly lastHitBy = new Map<number, { id: number; t: number }>();
  private readonly deadAt = new Map<number, number>();
  private lastScoreT = -99;
  private prevBroken = 0;

  constructor(private readonly roundTime: number = ARENA.roundTime) {}

  alive = (c: CarState): boolean => !this.dead.has(c.id);

  timeLeft(): number { return Math.max(0, this.roundTime - this.time); }
  get multiplier(): number { return this.combo; }
  coins(): number { return Math.max(0, Math.round(this.score * ARENA.coinsPerPoint)); }

  /** Points a scoring event adds, with the combo step. */
  addScore(kind: ArenaScoreEvent['kind'], base: number): number {
    if (base <= 0) return 0;
    if (this.time - this.lastScoreT >= ARENA.comboGap) {
      this.combo = this.comboT > 0 ? Math.min(ARENA.comboMax, this.combo + 1) : 1;
      this.lastScoreT = this.time;
    }
    this.comboT = ARENA.comboWindow;
    const pts = Math.round(base * this.combo);
    this.score += pts;
    this.scoreEvents.push({ kind, points: pts, combo: this.combo });
    return pts;
  }

  /** Advance the rules by dt (call after sim.update). Returns the ids of cars that should be removed now. */
  update(sim: ArenaSimView, dt: number): number[] {
    const removeNow: number[] = [];
    if (this.ended) return removeNow;
    const cars = sim.cars;
    if (sim.race.phase === 'countdown') {
      for (const c of cars) this.prevHealth.set(c.id, c.health);
      this.prevBroken = sim.brokenByPlayer;
      return removeNow;
    }
    this.time += dt;
    this.comboT = Math.max(0, this.comboT - dt);
    if (this.comboT <= 0) this.combo = 1;
    const player = cars.find((c) => c.isPlayer);

    // damage dealt: a car's health loss goes to the nearest other live car close to it
    for (const c of cars) {
      if (this.dead.has(c.id)) continue;
      const prev = this.prevHealth.get(c.id) ?? c.health;
      const loss = prev - c.health;
      this.prevHealth.set(c.id, c.health);
      if (loss <= 1e-4) continue;
      let hitter: CarState | null = null, bd: number = ARENA.hitRange;
      for (const o of cars) {
        if (o === c || this.dead.has(o.id)) continue;
        const d = Math.hypot(o.x - c.x, o.y - c.y);
        if (d < bd) { bd = d; hitter = o; }
      }
      if (!hitter) continue;
      this.lastHitBy.set(c.id, { id: hitter.id, t: this.time });
      if (hitter.isPlayer) { this.damageDealt += loss; this.addScore('damage', loss * ARENA.dmgPoints); }
    }

    // smashed props / wall pieces
    const broke = sim.brokenByPlayer - this.prevBroken;
    this.prevBroken = sim.brokenByPlayer;
    if (broke > 0) { this.props += broke; this.addScore('prop', broke * ARENA.propPoints); }

    // wrecks
    for (const c of cars) {
      if (this.dead.has(c.id) || !c.wrecked) continue;
      this.dead.add(c.id);
      this.deadAt.set(c.id, this.time);
      const h = this.lastHitBy.get(c.id);
      if (!c.isPlayer && h && this.time - h.t <= ARENA.creditTime && player && h.id === player.id) {
        this.wrecks++;
        this.addScore('wreck', ARENA.wreckPoints);
      }
    }
    for (const [id, t] of this.deadAt) {
      if (!this.removed.has(id) && this.time - t >= ARENA.removeDelay) { this.removed.add(id); removeNow.push(id); }
    }

    // round end
    const liveRivals = cars.filter((c) => !c.isPlayer && !this.dead.has(c.id)).length;
    if (player && this.dead.has(player.id)) this.ended = 'wrecked';
    else if (player && liveRivals === 0) this.ended = 'lastStanding';
    else if (this.time >= this.roundTime) this.ended = 'time';
    if (this.ended && this.ended !== 'wrecked') this.score += ARENA.survivalBonus;
    return removeNow;
  }
}

/** The parts of the Sim the arena hooks into. */
export interface ArenaHost extends ArenaSimView {
  aiOverride: ((i: number, st: CarState, dt: number) => CarInput) | null;
  playerAssist: boolean;
  removeCar(i: number): void;
}

const PARKED: CarInput = { throttle: 0, brake: 1, steer: 0, handbrake: true };

/** Turn a Sim built on ARENA_TRACK into a Demolition Arena round: hunt AI for every AI car, no road-edge assist. */
export function attachArena(sim: ArenaHost, match: ArenaMatch): HuntDriver[] {
  const drivers = sim.cars.map(() => new HuntDriver());
  sim.playerAssist = false;
  sim.aiOverride = (i, st, dt) => (match.alive(st) ? drivers[i].think(st, sim.cars, dt, match.alive) : PARKED);
  return drivers;
}

/** Rules step + removal of wrecked cars (after their explosion). */
export function stepArena(sim: ArenaHost, match: ArenaMatch, dt: number): void {
  const ids = match.update(sim, dt);
  for (const id of ids) {
    const i = sim.cars.findIndex((c) => c.id === id);
    if (i >= 0) sim.removeCar(i);
  }
}
