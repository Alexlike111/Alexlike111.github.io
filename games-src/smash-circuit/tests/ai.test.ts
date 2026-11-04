import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { AiDriver } from '../src/sim/ai';
import { SimCar } from '../src/sim/car';
import { baseStats, SURFACE_GRASS, SURFACE_ROAD } from '../src/sim/carModel';
import { makeRng } from '../src/sim/rng';
import { PhysicsWorld } from '../src/sim/world';
import { buildTrackGeometry } from '../src/track/spline';
import { TRACKS } from '../src/track/tracks';
import type { AiPersonality, CarSetup, CarState, TrackGeometry } from '../src/types';
import { createZoneHp } from '../src/sim/damage';
import { NO_DAMAGE } from '../src/sim/carModel';

const DT = CONFIG.physics.dt;
const PERSONA: AiPersonality = { skill: 0.8, aggression: 0.4, laneOffset: 0.2, mistakeRate: 0.05 };
const GEOMS = TRACKS.map((t) => buildTrackGeometry(t));

function setup(id: number, ai?: AiPersonality): CarSetup {
  return { id, isPlayer: false, name: 'ai' + id, colorIndex: id, stats: baseStats(), ai };
}

/** Plain CarState for the pure decision tests. */
function state(track: TrackGeometry, s: number, lat: number, speed: number, over: Partial<CarState> = {}): CarState {
  const t = track.sampleAt(s);
  const a = Math.atan2(t.ty, t.tx);
  return {
    id: 1, isPlayer: false, colorIndex: 0, name: 'x',
    x: t.x + t.nx * lat, y: t.y + t.ny * lat, angle: a,
    vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, angularVel: 0, speed, steer: 0,
    throttle: 0, brake: 0, handbrake: false, rpm: 0.3, drifting: false, slip: 0,
    hp: createZoneHp(100), zoneMaxHp: 100, health: 1, effects: { ...NO_DAMAGE }, detachedParts: [], wrecked: false,
    lap: 0, progress: s, place: 1, finished: false, finishTime: 0, lastLapTime: 0, bestLapTime: 0, onCurb: false, offRoad: false,
    ...over,
  };
}

/** Decide once (forces a decision by feeding a full decision interval). */
function decide(d: AiDriver, car: CarState, others: CarState[], track: TrackGeometry, hint: number) {
  return d.think(car, others, track, 1, hint);
}

interface SoloResult { maxLat: number; laps: number; lapTime: number; latStd: number; minSpeed: number }

/** One AI car alone (no walls, grass off the road) for `seconds`; counts laps by unwrapped progress. */
function solo(track: TrackGeometry, persona: AiPersonality, seed: number, seconds: number): SoloResult {
  const pw = new PhysicsWorld();
  const t0 = track.sampleAt(-5);
  const car = new SimCar(pw, setup(1, persona), t0.x, t0.y, Math.atan2(t0.ty, t0.tx));
  const driver = new AiDriver(persona, makeRng(seed));
  const half = track.def.width / 2;
  let hint = track.nearest(car.state.x, car.state.y).s;
  let prev = hint > track.length / 2 ? hint - track.length : hint;
  let maxLat = 0, sum = 0, sum2 = 0, n = 0, lapStart = 0, lastLap = 0, laps = 0, minSpeed = 1e9;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const st = car.state;
    const near = track.nearest(st.x, st.y, hint);
    let d = near.s - hint;
    if (d > track.length / 2) d -= track.length; else if (d < -track.length / 2) d += track.length;
    prev += d; hint = near.s;
    if (prev >= (laps + 1) * track.length) { laps++; lastLap = i * DT - lapStart; lapStart = i * DT; }
    car.setInput(driver.think(st, [], track, DT, hint));
    car.preStep(Math.abs(near.lateral) > half ? SURFACE_GRASS : SURFACE_ROAD, DT);
    pw.step();
    car.postStep();
    if (i * DT > 5) {
      maxLat = Math.max(maxLat, Math.abs(near.lateral));
      sum += near.lateral; sum2 += near.lateral * near.lateral; n++;
      minSpeed = Math.min(minSpeed, st.speed);
    }
  }
  const mean = sum / n;
  return { maxLat, laps, lapTime: lastLap, latStd: Math.sqrt(Math.max(0, sum2 / n - mean * mean)), minSpeed };
}

describe('AiDriver driving', () => {
  for (let k = 0; k < GEOMS.length; k++) {
    it(`drives clean laps alone on ${TRACKS[k].id}`, () => {
      const g = GEOMS[k];
      const r = solo(g, PERSONA, 5, 100);
      expect(r.laps).toBeGreaterThanOrEqual(2);
      expect(r.lapTime).toBeGreaterThan(g.length / 60);   // not faster than 60 m/s average
      expect(r.lapTime).toBeLessThan(g.length / 12);      // not crawling
      expect(r.maxLat).toBeLessThan(g.def.width / 2 + 0.5); // stays on the road
      expect(r.minSpeed).toBeGreaterThan(5);              // never stops
    });
  }

  it('is deterministic for a seed and different for another one', () => {
    const g = GEOMS[0];
    const a = solo(g, { ...PERSONA, mistakeRate: 0.3 }, 11, 40);
    const b = solo(g, { ...PERSONA, mistakeRate: 0.3 }, 11, 40);
    const c = solo(g, { ...PERSONA, mistakeRate: 0.3 }, 12, 40);
    expect(b).toEqual(a);
    expect(c.latStd === a.latStd && c.maxLat === a.maxLat).toBe(false);
  });

  it('mistake rate makes the line less tidy', () => {
    const g = GEOMS[0];
    const tidy = solo(g, { skill: 0.9, aggression: 0.3, laneOffset: 0, mistakeRate: 0 }, 3, 90);
    const sloppy = solo(g, { skill: 0.9, aggression: 0.3, laneOffset: 0, mistakeRate: 1 }, 3, 90);
    expect(sloppy.latStd).toBeGreaterThan(tidy.latStd * 1.05);
  });

  it('lap times of the same driver are stable across seeds but not identical', () => {
    const g = GEOMS[0];
    const times = [1, 2, 3, 4].map((sd) => solo(g, PERSONA, sd, 80).lapTime);
    const lo = Math.min(...times), hi = Math.max(...times);
    expect(hi / lo).toBeLessThan(1.15);
    expect(hi).toBeGreaterThan(lo);
  });

  it('higher skill laps faster', () => {
    const g = GEOMS[1];
    const fast = solo(g, { skill: 1, aggression: 0.3, laneOffset: 0, mistakeRate: 0 }, 2, 90);
    const slow = solo(g, { skill: 0.1, aggression: 0.3, laneOffset: 0, mistakeRate: 0 }, 2, 90);
    expect(fast.lapTime).toBeLessThan(slow.lapTime);
  });
});

describe('AiDriver decisions', () => {
  const g = GEOMS[2]; // t3: hairpin from s ~ 75
  const hairpinS = (() => {
    let best = 0, bk = 0;
    for (let s = 0; s < 200; s += 1) { const k = Math.abs(g.sampleAt(s).curvature); if (k > bk) { bk = k; best = s; } }
    return best;
  })();

  it('brakes before a hairpin when too fast and accelerates on the straight when slow', () => {
    const d = new AiDriver(PERSONA, makeRng(1));
    const fast = state(g, hairpinS - 45, 0, 38);
    const out = decide(d, fast, [], g, fast.progress);
    expect(out.brake).toBeGreaterThan(0.6);
    expect(out.throttle).toBe(0);

    const d2 = new AiDriver(PERSONA, makeRng(1));
    const slow = state(g, hairpinS - 120, 0, 10);
    const out2 = decide(d2, slow, [], g, slow.progress);
    expect(out2.brake).toBe(0);
    expect(out2.throttle).toBeGreaterThan(0.5);
  });

  it('plans a lower corner speed for a tighter bend', () => {
    const d = new AiDriver(PERSONA, makeRng(1));
    const s1 = state(g, hairpinS - 30, 0, 20);
    decide(d, s1, [], g, s1.progress);
    const tight = d.targetSpeed;
    const gw = GEOMS[0]; // wide gentle t1 start
    const d2 = new AiDriver(PERSONA, makeRng(1));
    const s2 = state(gw, 10, 0, 20);
    decide(d2, s2, [], gw, s2.progress);
    expect(tight).toBeLessThan(d2.targetSpeed);
  });

  it('steers toward the track when it is off to one side', () => {
    const d = new AiDriver(PERSONA, makeRng(1));
    const left = state(g, 20, 3, 15);    // 3 m left of the centre line, nose along the track
    const o1 = decide(d, left, [], g, 20);
    const d2 = new AiDriver(PERSONA, makeRng(1));
    const right = state(g, 20, -3, 15);
    const o2 = decide(d2, right, [], g, 20);
    expect(o1.steer).toBeGreaterThan(o2.steer); // + steer = right
  });

  it('moves its line away from a slow car ahead in its lane', () => {
    const gw = GEOMS[0];
    const d = new AiDriver({ ...PERSONA, laneOffset: 0, mistakeRate: 0 }, makeRng(1));
    const me = state(gw, 100, 0, 25);
    const blocker = state(gw, 112, 0, 8, { id: 2 });
    for (let i = 0; i < 120; i++) d.think(me, [blocker], gw, 1 / 60, 100);
    expect(d.neighbours).toBe(1);
    const line = (d as unknown as { offset: number }).offset;
    expect(Math.abs(line)).toBeGreaterThan(1.8);          // aimed at a free line beside the blocker
    expect(d.followSpeed).toBe(Infinity);                 // room to pass: no need to follow
  });

  it('follows at a distance when there is no room to pass', () => {
    const d = new AiDriver({ ...PERSONA, mistakeRate: 0 }, makeRng(1));
    const me = state(g, 20, 0, 25);                       // t3 is only 9 m wide
    const a = state(g, 32, 1.4, 8, { id: 2 });
    const b = state(g, 32, -1.4, 8, { id: 3 });
    for (let i = 0; i < 120; i++) d.think(me, [a, b], g, 1 / 60, 20);
    expect(d.followSpeed).toBeLessThan(14);
    expect(d.targetSpeed).toBeLessThan(14);
  });

  it('reverses when stuck, then asks for a respawn if it stays stuck', () => {
    const d = new AiDriver(PERSONA, makeRng(4));
    const stuck = state(g, 40, 3, 0);
    let reversed = false, steps = 0;
    for (let t = 0; t < CONFIG.ai.stuckTime + 1; t += 1 / 60) {
      const o = d.think(stuck, [], g, 1 / 60, 40);
      steps++;
      if (o.brake === 1 && o.throttle === 0) { reversed = true; break; }
    }
    expect(reversed).toBe(true);
    expect(steps / 60).toBeLessThan(CONFIG.ai.stuckTime + 0.5);
    expect(d.wantsRespawn).toBe(false);
    for (let t = 0; t < CONFIG.ai.respawnAfter + 1; t += 1 / 60) d.think(stuck, [], g, 1 / 60, 40);
    expect(d.wantsRespawn).toBe(true);
    d.notifyRespawn();
    expect(d.wantsRespawn).toBe(false);
  });

  it('never plans to drive the wrong way: stops before turning around', () => {
    const d = new AiDriver(PERSONA, makeRng(1));
    const t = g.sampleAt(30);
    const wrong = state(g, 30, 0, 12, { angle: Math.atan2(t.ty, t.tx) + Math.PI });
    wrong.vx = Math.cos(wrong.angle) * 12; wrong.vy = Math.sin(wrong.angle) * 12;
    const o = decide(d, wrong, [], g, 30);
    expect(o.brake).toBeGreaterThan(0.5);
  });

  it('rubber band: faster when far behind the player, slower when far ahead, mild', () => {
    const base = (gap: number) => {
      const d = new AiDriver({ ...PERSONA, mistakeRate: 0 }, makeRng(1));
      const me = state(GEOMS[1], 300, 0, 20, { progress: 300 });
      const human = state(GEOMS[1], 300, 0, 20, { id: 0, isPlayer: true, progress: 300 + gap });
      human.x += 500; human.y += 500; // far away: only the progress gap matters
      decide(d, me, [human], GEOMS[1], 300);
      return d.targetSpeed;
    };
    const level = base(0), behind = base(250), ahead = base(-250);
    expect(behind).toBeGreaterThan(level);
    expect(ahead).toBeLessThan(level);
    expect(behind / level).toBeLessThan(1 + CONFIG.ai.rubberBand * 1.5);
    expect(level / ahead).toBeLessThan(1 + CONFIG.ai.rubberBand * 1.5);
  });

  it('respects an external speed cap', () => {
    const d = new AiDriver(PERSONA, makeRng(1));
    d.speedCap = 12;
    const me = state(GEOMS[0], 100, 0, 30);
    const o = decide(d, me, [], GEOMS[0], 100);
    expect(d.targetSpeed).toBeLessThanOrEqual(12);
    expect(o.brake).toBeGreaterThan(0.5);
  });

  it('counters damage steering pull', () => {
    const me = state(GEOMS[0], 100, 0, 20);
    const dA = new AiDriver({ ...PERSONA, mistakeRate: 0 }, makeRng(1));
    const dB = new AiDriver({ ...PERSONA, mistakeRate: 0 }, makeRng(1));
    const healthy = decide(dA, me, [], GEOMS[0], 100);
    const pulled = decide(dB, { ...me, effects: { ...NO_DAMAGE, steerPull: 0.2 } }, [], GEOMS[0], 100);
    expect(pulled.steer).toBeCloseTo(healthy.steer - 0.2, 1);
  });
});

describe('AI mistakes and recovery (audit #10 / #22)', () => {
  /** Speed target of a driver approaching the sharpest bend of t1 from `dist` m out at `speed`, optionally mid-lateBrake. */
  function targetAt(lateBrake: boolean, dist: number, speed: number): number {
    const g = GEOMS[0];
    let bs = 0, bk = 0;
    for (const smp of g.samples) if (Math.abs(smp.curvature) > bk) { bk = Math.abs(smp.curvature); bs = smp.s; }
    const d = new AiDriver({ skill: 1, aggression: 0, laneOffset: 0, mistakeRate: 0 }, makeRng(3));
    if (lateBrake) (d as unknown as { mistake: unknown }).mistake = { kind: 'lateBrake', timer: 5, dir: 1 };
    const car = state(g, bs - dist, 0, speed);
    decide(d, car, [], g, bs - dist);
    return d.targetSpeed;
  }

  it('a lateBrake mistake brakes LATER (higher speed allowed far out) and buys no corner speed at the apex', () => {
    expect(targetAt(true, 60, 50)).toBeGreaterThan(targetAt(false, 60, 50) + 1);
    expect(targetAt(true, 0, 15)).toBeLessThanOrEqual(targetAt(false, 0, 15) + 1e-6);
  });

  it('a car beyond the wall line drives back toward the gap it left by, not along the road behind the wall', () => {
    const g = GEOMS[0];
    const half = g.def.width / 2;
    const d = new AiDriver({ skill: 0.8, aggression: 0, laneOffset: 0, mistakeRate: 0 }, makeRng(4));
    // on the road at s 100, then out through a gap there, then 15 m further along outside the wall
    decide(d, state(g, 100, 0, 15), [], g, 100);
    decide(d, state(g, 102, half + CONFIG.destruction.wallOffset + 0.5, 15), [], g, 102);
    const out = state(g, 117, half + CONFIG.destruction.wallOffset + 2, 10);
    const inp = decide(d, out, [], g, 117);
    // the gap is behind on the left (the car faces along the track): it must steer hard round / slow, not drive on
    expect(d.targetSpeed).toBeLessThan(10);
    expect(Math.abs(inp.steer)).toBeGreaterThan(0.5);
  });
});
