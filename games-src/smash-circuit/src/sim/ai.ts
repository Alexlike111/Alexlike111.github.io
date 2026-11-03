// AI driver: follows the spline with a racing-line bias, brakes by upcoming curvature, avoids and passes cars,
// makes small human mistakes and recovers when stuck. PURE (no physics, no DOM). Deterministic given the rng.
import { CONFIG } from '../config';
import type { AiPersonality, CarInput, CarState, OilSlick, TrackGeometry } from '../types';
import { driftSteerForCurvature, steerForCurvature } from './carModel';
import { DRIFT_HOLD, DRIFT_NONE } from './drift';

const A = CONFIG.ai;
const C = CONFIG.car;

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

export const DEFAULT_PERSONALITY: AiPersonality = { skill: 0.7, aggression: 0.4, laneOffset: 0, mistakeRate: 0.05 };

type MistakeKind = 'lateBrake' | 'wide' | 'twitch';

interface Mistake { kind: MistakeKind; timer: number; dir: number }

/** Result of one look along the road ahead. */
interface Scan {
  /** highest speed (m/s) allowed right now so that every bend ahead can still be taken */
  vAllowed: number;
  /** smallest bend radius within the look-ahead distance (m) */
  minRadius: number;
}

export class AiDriver {
  /** Set by the driver when it has made no progress for CONFIG.ai.respawnAfter seconds. The Sim puts it back on the road. */
  wantsRespawn = false;
  /** Speed (m/s) the driver is currently aiming for (debug / telemetry). */
  targetSpeed = 0;
  /** Speed cap from the car in front (Infinity = none) and number of neighbours considered (debug / telemetry). */
  followSpeed = Infinity;
  neighbours = 0;
  /** 0..1 how hard this driver is chasing a human who is far ahead (Sim turns it into a power / top speed assist). */
  catchUp = 0;
  /** Hard speed ceiling set from outside (e.g. cruising after the finish). */
  speedCap = Infinity;
  readonly personality: AiPersonality;
  /** Oil slicks on the road (set by the Sim): treated as obstacles to steer around, never as cars to follow. */
  hazards: OilSlick[] | null = null;

  private readonly rng: () => number;
  private out: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  private acc: number;
  private time = 0;

  // line
  private offset = 0;                 // smoothed lateral offset currently aimed at (m, + = left)
  private lookCur = 0;                // smoothed look-ahead distance
  private readonly laneBase: number;  // preferred lane in [-1, 1]
  private readonly phase = [0, 0, 0, 0];

  // neighbours (scratch arrays, filled by collectNearby)
  private readonly nearLat: number[] = [];
  private readonly nearDs: number[] = [];
  private readonly nearW: number[] = [];
  private readonly nearSpeed: number[] = [];
  private readonly nearExtra: number[] = [];   // extra clearance (m) on top of the car-to-car clearance (oil slicks)

  // errors
  private mistake: Mistake | null = null;
  private pendingLateBrake = 0;       // seconds left in which a late-brake mistake waits for the next braking zone

  // recovery
  private dragTimer = 0;            // s of full throttle without gaining speed (pushing a prop / dragging something)
  private shedTimer = 0;            // s left of a sideways jink that shakes the obstacle off
  private shedDir = 1;
  private speedMark = 0;
  private speedMarkTime = 0;
  private stuckTimer = 0;
  private stuckLimit: number;       // s of being stuck before reversing (jittered per driver and attempt: two jammed cars must not reverse in lockstep)
  private reverseTimer = 0;
  private drifting = false;           // holding a drift through a tight corner
  private reverseExtra = 0;           // s the current reverse was extended because a car still sits right ahead
  private markS = 0;
  private markInit = false;
  private markTime = 0;

  constructor(p: AiPersonality, rng: () => number) {
    this.personality = p;
    this.rng = rng;
    this.acc = rng() / A.decisionHz;
    this.stuckLimit = A.stuckTime * lerp(0.6, 1.4, rng());
    this.laneBase = clamp(p.laneOffset + (rng() - 0.5) * 0.2, -1, 1);
    for (let i = 0; i < this.phase.length; i++) this.phase[i] = rng() * Math.PI * 2;
  }

  /** Called by the Sim after it moved the car (resets the recovery timers). */
  notifyRespawn(): void {
    this.wantsRespawn = false;
    this.stuckTimer = 0;
    this.reverseTimer = 0;
    this.markInit = false;
    this.markTime = 0;
    this.mistake = null;
    this.offset = 0;
  }

  think(car: CarState, others: CarState[], track: TrackGeometry, dt: number, hintS: number): CarInput {
    this.acc += dt;
    const interval = 1 / A.decisionHz;
    if (this.acc < interval) return this.out;
    const h = this.acc;
    this.acc = 0;
    this.time += h;
    this.decide(car, others, track, h, hintS);
    return this.out;
  }

  // -----------------------------------------------------------------------------------------------

  private decide(car: CarState, others: CarState[], track: TrackGeometry, h: number, hintS: number): void {
    const p = this.personality;
    const L = track.length;
    const half = track.def.width / 2;
    const near = track.nearest(car.x, car.y, hintS);
    const s = near.s, lat = near.lateral;
    const speed = car.speed;
    const av = Math.abs(speed);
    const tan = track.sampleAt(s);
    const heading = Math.atan2(tan.ty, tan.tx);
    const headErr = wrap(heading - car.angle);          // + = nose must turn counter-clockwise to follow the track
    const skill = clamp(p.skill, 0, 1);
    const maxOff = Math.max(0.5, half - A.laneMargin);

    // ---------- progress watchdog
    if (!this.markInit) { this.markInit = true; this.markS = s; this.markTime = 0; }
    const moved = wrap2(s - this.markS, L);
    if (moved > 6 || moved < -40) { this.markS = s; this.markTime = 0; } else this.markTime += h;
    if (this.markTime > A.respawnAfter) this.wantsRespawn = true;

    // ---------- stuck / reverse recovery
    if (this.reverseTimer > 0) {
      this.reverseTimer -= h;
      this.out = {
        throttle: 0, brake: 1,
        // reversing flips the sense of steering: steer toward the side we want the nose to go
        steer: clamp(headErr * 1.6, -1, 1),
        handbrake: false,
      };
      // still nose to bumper with a car right ahead in our lane: back up a little more, so there is room to steer around it
      if (this.reverseTimer <= 0 && this.reverseExtra < 1.5 && this.carRightAhead(car, others, track, s, lat)) {
        this.reverseTimer += 0.25; this.reverseExtra += 0.25;
      }
      if (this.reverseTimer <= 0) { this.stuckTimer = 0; this.reverseExtra = 0; }
      return;
    }
    if (this.shedTimer > 0) {
      this.shedTimer -= h;
      this.out = { throttle: 0.45, brake: 0, steer: this.shedDir * 0.75, handbrake: false };
      return;
    }
    // nose to bumper with a stopped car right ahead: waiting does not help, back off sooner
    if (av < A.stuckSpeed) this.stuckTimer += h * (this.carRightAhead(car, others, track, s, lat) ? 2.5 : 1); else if (av > 2.5) this.stuckTimer = 0;
    else this.stuckTimer = Math.max(0, this.stuckTimer - h);
    if (this.stuckTimer > this.stuckLimit) {
      this.reverseTimer = lerp(A.reverseTime[0], A.reverseTime[1], this.rng());
      this.stuckTimer = 0;
      this.stuckLimit = A.stuckTime * lerp(0.6, 1.4, this.rng());
    }

    // ---------- grip / speed scale
    const fx = car.effects;
    let gripFactor = clamp(fx.gripMul, 0.35, 1);
    if (car.offRoad) gripFactor *= 0.7; else if (car.onCurb) gripFactor *= 0.92;
    const skillScale = lerp(A.skillSpeedRange[0], A.skillSpeedRange[1], skill) * (A.trackSpeed[track.def.id] ?? 1);
    let aLat = A.maxLatAccel * gripFactor;
    let aBrake = C.brakeDecel * (0.6 + 0.4 * fx.gripMul) * A.brakeSafety;

    // ---------- mistakes
    this.updateMistakes(h, p);
    let speedMul = 1;
    let steerTwitch = 0;
    let wideOffset = 0;
    const m = this.mistake;
    if (m) {
      if (m.kind === 'lateBrake') { aBrake *= 0.5; speedMul *= 1.1; }
      else if (m.kind === 'wide') wideOffset = m.dir * 3.5;
      else steerTwitch = m.dir * 0.35 * (m.timer > 0.15 ? 1 : 0);
    }

    // ---------- rubber band (mild): compare with the human / pack
    let rubber = 1;
    {
      let ref = 0, cnt = 0, humanFound = false;
      for (let i = 0; i < others.length; i++) {
        const o = others[i];
        if (o.isPlayer) { ref = o.progress; cnt = 1; humanFound = true; break; }
        ref += o.progress; cnt++;
      }
      if (cnt > 0) {
        const gap = ref / cnt - car.progress;   // + = I am behind
        if (gap > 0) {
          // behind the human (or the pack): chase from rubberChaseStart on, full strength at rubberChaseFull
          const f = clamp((gap - A.rubberChaseStart) / (A.rubberChaseFull - A.rubberChaseStart), 0, 1);
          rubber = 1 + f * A.rubberChase * (humanFound ? 1 : 0.6);
          this.catchUp = humanFound ? f : f * 0.6;
        } else {
          // ahead: only a mild brake so the field does not run away from the human
          const f = clamp((-gap - A.rubberStart) / (A.rubberFull - A.rubberStart), 0, 1);
          rubber = 1 - f * A.rubberBand * 0.7 * (humanFound ? 1 : 0.6);
          this.catchUp = 0;
        }
      } else this.catchUp = 0;
    }

    // ---------- speed profile + look-ahead distance
    const horizon = clamp(av * av / (2 * Math.max(aBrake, 3)) + 30, A.horizon[0], A.horizon[1]);
    const lookNominal = A.lookAhead * clamp(0.35 + av / 20, 0.35, 1) + A.lookAheadPerSpeed * av;   // short when crawling: sharp corrections
    // slow "form" wobble (a driver has good and bad minutes) so the order shuffles even between equal cars
    const form = 1 + A.formAmp * (1.3 - skill) * (0.65 * Math.sin(this.time * 0.23 + this.phase[2]) + 0.35 * Math.sin(this.time * 0.61 + this.phase[3]));
    const scan = this.scan(track, s, clamp(lat, -half, half), aLat * speedMul * rubber * rubber, aBrake, skillScale * form, horizon, lookNominal);
    let look = Math.min(lookNominal, Math.max(6, scan.minRadius * 0.9 + 2));
    if (this.lookCur === 0) this.lookCur = look;
    this.lookCur += (look - this.lookCur) * Math.min(1, h * (look < this.lookCur ? 8 : 3));
    look = this.lookCur;

    // ---------- target lateral offset: lane preference, racing line, noise, mistakes
    const kLook = track.sampleAt(s + look * 1.1).curvature;
    const bias = clamp(kLook * 45, -1, 1);
    const laneM = this.laneBase * maxOff * 0.55;
    let target = laneM * (1 - 0.8 * Math.abs(bias)) + bias * maxOff * A.apexBias * (0.45 + 0.55 * skill);
    const noiseAmp = 0.35 + 0.9 * (1 - skill);
    target += noiseAmp * (0.6 * Math.sin(this.time * 0.7 + this.phase[0]) + 0.4 * Math.sin(this.time * 1.9 + this.phase[1]));
    target += wideOffset;

    // ---------- other cars: pick the free lateral line closest to the wanted one
    const desired = clamp(target, -maxOff, maxOff);
    const clear = A.passClearance - A.passClearanceAggr * p.aggression;
    const stubborn = p.aggression > 0.75 ? 0.55 : 1;           // aggressive drivers hold their line more
    const nCar = this.collectNearby(car, others, track, s, av);
    let followCap = Infinity;
    let blockGap = Infinity;          // gap to the closest car that blocks us (m)
    if (nCar > 0) {
      let bestC = desired, bestCost = Infinity;
      const K = A.candidates;
      for (let k = -1; k < K; k++) {
        const c = k < 0 ? desired : -maxOff + (2 * maxOff * k) / (K - 1);
        let cost = Math.abs(c - desired) + A.lineHysteresis * Math.abs(c - this.offset);
        for (let j = 0; j < nCar; j++) cost += A.carPenalty * stubborn * this.nearW[j] * overlap(c, this.nearLat[j], clear + this.nearExtra[j]);
        if (cost < bestCost - 1e-6) { bestCost = cost; bestC = c; }
      }
      target = bestC;
      // a car that still blocks the chosen line: keep behind it
      for (let j = 0; j < nCar; j++) {
        const ds = this.nearDs[j];
        if (ds <= 0) continue;
        // judge both where we want to go and where we physically are (we cannot teleport sideways)
        const ovLine = overlap(target, this.nearLat[j], clear + this.nearExtra[j]);
        const ovNow = ds < A.closeFollow ? overlap(lat, this.nearLat[j], (clear + this.nearExtra[j]) * 0.9) : 0;
        if (Math.max(ovLine, ovNow) < 0.25) continue;
        const gap = ds - C.length;
        const want = A.followGap + A.followGapPerSpeed * av * (1 - 0.5 * p.aggression);
        let cap = Math.max(0, this.nearSpeed[j] + (gap - want) * 0.8);
        // the line we chose is free but we are still behind it: creep so the car can steer out (never into the bumper)
        if (ovLine < 0.25 && gap > 0.5) cap = Math.max(cap, A.creepSpeed * clamp(gap / 2, 0, 1));
        followCap = Math.min(followCap, cap);
        blockGap = Math.min(blockGap, gap);
      }
    } else target = desired;

    // slew the aimed line
    // (and never faster than a gentle line-change slope, or the car overshoots the new line at speed)
    const rate = Math.min(lerp(A.offsetRate[0], A.offsetRate[1], skill), Math.max(A.lineRateMin, A.lineSlope * av));
    this.offset += clamp(target - this.offset, -rate * h, rate * h);

    // boxed in close behind a slow / stopped car and the free line is to the side: aim much closer so the car actually
    // moves over before it reaches the bumper (a long look-ahead only drifts it sideways)
    if (blockGap < 6 && av < 8 && Math.abs(this.offset - lat) > 0.6) look = Math.max(2.5, Math.min(look, 2.5 + blockGap));

    // ---------- steering: pure pursuit, exact inverse of the car model's steering (steerForCurvature)
    const tp = track.sampleAt(s + look);
    const off = this.offset;
    const tx = tp.x + tp.nx * off, ty = tp.y + tp.ny * off;
    const dx = tx - car.x, dy = ty - car.y;
    const dist = Math.max(Math.hypot(dx, dy), 2);
    // in a drift the nose points into the bend: pursue relative to where the car is actually going
    const sp2 = Math.hypot(car.vx, car.vy);
    const course = car.driftActive && sp2 > 3 ? Math.atan2(car.vy, car.vx) : car.angle;
    const alpha = wrap(Math.atan2(dy, dx) - course);
    let steer: number;
    if (Math.abs(alpha) > 1.3) {
      steer = -Math.sign(alpha);
    } else {
      const kappa = (2 * Math.sin(alpha)) / dist;
      steer = car.driftActive ? driftSteerForCurvature(kappa, sp2, car.driftDir ?? 1, gripFactor) : steerForCurvature(kappa, Math.max(av, 1), gripFactor);
    }
    // damage steering pull is added by the car model: counter it (feed-forward) so a bent car still tracks the line
    steer = clamp(steer - fx.steerPull + steerTwitch, -1, 1);

    // ---------- speed command
    let vT = scan.vAllowed;
    vT = Math.min(vT, followCap, this.speedCap);
    if (car.offRoad && Math.abs(lat) > half) vT = Math.min(vT, A.offroadSpeedCap);
    if (Math.abs(headErr) > 1.5 && av > 4) vT = 0;       // facing the wrong way: stop first

    // pushing something heavy (a prop on the nose, a car) with the throttle pinned: jink sideways to shed it
    this.speedMarkTime += h;
    if (this.speedMarkTime >= 1) {
      const gain = speed - this.speedMark;
      const pinned = this.out.throttle >= 0.9 && vT - speed > 6 && speed > 3 && speed < A.dragMaxSpeed && !car.wrecked && car.effects.powerMul > 0.5;
      this.dragTimer = pinned && gain < 1.0 ? this.dragTimer + this.speedMarkTime : 0;
      this.speedMark = speed;
      this.speedMarkTime = 0;
      if (this.dragTimer >= A.dragTime) {
        this.dragTimer = 0;
        this.shedTimer = A.shedTime;
        this.shedDir = lat > 0 ? 1 : -1;       // toward the centre line (steer + = right, lateral + = left of the line)
      }
    }

    this.targetSpeed = vT;
    this.followSpeed = followCap;
    this.neighbours = nCar;
    const err = vT - speed;
    let throttle = err > 0 ? clamp(0.25 + err * 0.5, 0, 1) : 0;
    let brake = err < -0.3 ? clamp((-err - 0.3) / 0.8, 0, 1) : 0;
    const latSpeed = -car.vx * Math.sin(car.angle) + car.vy * Math.cos(car.angle);
    if (Math.abs(latSpeed) > 2.2) throttle *= 0.4;        // sliding: let the tyres recover
    if (Math.abs(alpha) > 1.0 && av < 8) throttle = Math.min(throttle, 0.6);
    // ---------- drift through tight corners (skilled drivers): hold the drift while the bend lasts
    const Dr = CONFIG.drift;
    const kHere = track.sampleAt(s + 4).curvature;
    if (!this.drifting) {
      this.drifting = skill >= Dr.aiSkill && !m && av > Dr.aiMinSpeed && Math.abs(kHere) > 1 / Dr.aiRadius
        && steer * kHere < 0 && Math.abs(steer) > 0.3 && !car.offRoad;
    } else if (Math.abs(kHere) < 1 / (Dr.aiRadius * 1.6) || av < Dr.keepSpeed + 2 || car.offRoad || m) this.drifting = false;
    this.out = { throttle, brake, steer, handbrake: false, drift: this.drifting ? DRIFT_HOLD : DRIFT_NONE };
  }

  /** Walks the road ahead and returns the speed that is safe now plus the tightest radius close by. */
  private scan(
    track: TrackGeometry, s: number, lat: number, aLat: number, aBrake: number,
    scale: number, horizon: number, closeDist: number,
  ): Scan {
    const S = track.samples, n = S.length, sp = track.length / n;
    const i0 = Math.floor((((s % track.length) + track.length) % track.length) / sp);
    const stride = Math.max(1, Math.round(3 / sp));
    let v = 120;
    let minR = 1e4;
    for (let k = 0; k * sp <= horizon; k += stride) {
      const smp = S[(i0 + k) % n];
      const kk = Math.abs(smp.curvature);
      const d = k * sp;
      if (kk < 0.0025) continue;
      const R = 1 / kk;
      // a line inside a bend is tighter; being wide does not buy speed (the car still has to turn)
      const rEff = Math.max(4, R - Math.max(0, Math.sign(smp.curvature) * lat));
      if (d <= closeDist && rEff < minR) minR = rEff;
      const vc = Math.sqrt(aLat * rEff) * scale * A.cornerSpeedK;
      const allowed = Math.sqrt(vc * vc + 2 * aBrake * Math.max(0, d - 1));
      if (allowed < v) v = allowed;
    }
    return { vAllowed: v, minRadius: minR };
  }

  /** A (slow) car within ~5 m ahead in our lane. */
  private carRightAhead(car: CarState, others: CarState[], track: TrackGeometry, s: number, lat: number): boolean {
    for (const o of others) {
      if (o.finished || Math.abs(o.speed) > 3) continue;
      const dx = o.x - car.x, dy = o.y - car.y;
      if (dx * dx + dy * dy > 100) continue;
      const on = track.nearest(o.x, o.y, s);
      const ds = wrap2(on.s - s, track.length);
      if (ds > 0 && ds < C.length + 5 && Math.abs(on.lateral - lat) < 2.2) return true;
    }
    return false;
  }

  /** Fills nearLat/nearDs/nearW/nearSpeed with the cars that matter for the line choice; returns their count. */
  private collectNearby(car: CarState, others: CarState[], track: TrackGeometry, s: number, av: number): number {
    const L = track.length;
    let n = 0;
    for (let i = 0; i < others.length; i++) {
      const o = others[i];
      if (o.finished) continue;
      const dx = o.x - car.x, dy = o.y - car.y;
      if (dx * dx + dy * dy > 2500) continue;
      const on = track.nearest(o.x, o.y, s);
      const ds = wrap2(on.s - s, L);
      const window = A.avoidRadius + 12 + Math.max(0, av - o.speed) * 0.9;
      if (ds < -A.alongsideBehind || ds > window) continue;
      // full weight beside / just ahead, fading with the distance ahead
      const w = ds < 5 ? 1 : 1 - clamp((ds - 5) / (window - 5), 0, 1) * 0.85;
      this.nearLat[n] = on.lateral;
      this.nearDs[n] = ds;
      this.nearW[n] = w;
      this.nearSpeed[n] = o.speed;
      this.nearExtra[n] = 0;
      n++;
    }
    const oils = this.hazards;
    if (oils) {
      for (let i = 0; i < oils.length; i++) {
        const o = oils[i];
        if (!o.active) continue;
        const dx = o.x - car.x, dy = o.y - car.y;
        if (dx * dx + dy * dy > 2500) continue;
        const on = track.nearest(o.x, o.y, s);
        const ds = wrap2(on.s - s, L);
        if (ds < -3 || ds > A.avoidRadius + 18 + av * 0.6) continue;
        this.nearLat[n] = on.lateral;
        this.nearDs[n] = ds;
        this.nearW[n] = 1;
        this.nearSpeed[n] = 99;               // never a speed cap: steer around it
        this.nearExtra[n] = o.radius - 0.9;
        n++;
      }
    }
    return n;
  }

  private updateMistakes(h: number, p: AiPersonality): void {
    if (this.mistake) {
      this.mistake.timer -= h;
      if (this.mistake.timer <= 0) this.mistake = null;
    }
    if (this.pendingLateBrake > 0) {
      this.pendingLateBrake -= h;
      // fire once we are actually approaching a corner fast (decided by the caller via speed profile): approximate by time
      if (!this.mistake && this.out.brake > 0.3) {
        this.mistake = { kind: 'lateBrake', timer: lerp(1.2, 1.8, this.rng()), dir: 1 };
        this.pendingLateBrake = 0;
      }
    }
    if (this.mistake || this.pendingLateBrake > 0) return;
    const rate = p.mistakeRate * A.mistakeScale;
    if (this.rng() < rate * h) {
      const r = this.rng();
      const dir = this.rng() < 0.5 ? -1 : 1;
      const dur = lerp(A.mistakeDuration[0], A.mistakeDuration[1], this.rng());
      if (r < 0.45) this.pendingLateBrake = 12;
      else if (r < 0.8) this.mistake = { kind: 'wide', timer: dur, dir };
      else this.mistake = { kind: 'twitch', timer: 0.35 + 0.2 * this.rng(), dir };
    }
  }
}

/** 0..1 how much a car at lateral `other` is in the way of a line at lateral `c` (centre distance below `clear`). */
function overlap(c: number, other: number, clear: number): number {
  const d = Math.abs(c - other);
  return d >= clear ? 0 : (clear - d) / clear;
}

/** Signed difference a-b of two positions on a loop of length L, in [-L/2, L/2). */
function wrap2(d: number, L: number): number {
  d = d % L;
  if (d >= L / 2) d -= L; else if (d < -L / 2) d += L;
  return d;
}
