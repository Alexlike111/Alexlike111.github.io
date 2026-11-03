import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { createZoneHp } from '../src/sim/damage';
import { NO_DAMAGE } from '../src/sim/carModel';
import { GhostRecorder, ghostPoseAt } from '../src/sim/ghost';
import { RaceTracker } from '../src/sim/race';
import { buildTrackGeometry } from '../src/track/spline';
import { TRACKS } from '../src/track/tracks';
import type { CarState, GhostData, SimEvent } from '../src/types';

const track = buildTrackGeometry(TRACKS[0]);
const L = track.length;

function car(id: number, isPlayer = false): CarState {
  return {
    id, isPlayer, colorIndex: id, name: 'c' + id, x: 0, y: 0, angle: 0, vx: 0, vy: 0, angularVel: 0, speed: 30, steer: 0,
    throttle: 1, brake: 0, handbrake: false, rpm: 0.5, drifting: false, slip: 0,
    hp: createZoneHp(100), zoneMaxHp: 100, health: 1, effects: { ...NO_DAMAGE }, detachedParts: [], wrecked: false,
    lap: 0, progress: 0, place: id + 1, finished: false, finishTime: 0, lastLapTime: 0, bestLapTime: 0, onCurb: false, offRoad: false,
  };
}

function put(c: CarState, s: number, lat = 0): void {
  const t = track.sampleAt(s);
  c.x = t.x + t.nx * lat;
  c.y = t.y + t.ny * lat;
  c.angle = Math.atan2(t.ty, t.tx);
}

/** A tracker for n cars standing behind the line, countdown already over. */
function started(n: number, playerIdx = 0): { rt: RaceTracker; cars: CarState[]; ev: SimEvent[] } {
  const cars = Array.from({ length: n }, (_, i) => car(i, i === playerIdx));
  cars.forEach((c, i) => put(c, -7 * (i + 1)));
  const rt = new RaceTracker(track, 3, n);
  const ev: SimEvent[] = [];
  rt.update(cars, 0, ev);
  for (let t = 0; t < CONFIG.race.countdown + 0.1; t += 0.1) rt.update(cars, 0.1, ev);
  ev.length = 0;
  return { rt, cars, ev };
}

/** Drive a car along the centre line at speed v for `dist` metres in steps of dt. */
function drive(rt: RaceTracker, cars: CarState[], ev: SimEvent[], idx: number, from: number, dist: number, v: number, others?: (t: number) => void): number {
  const dt = 1 / 60;
  let s = from;
  const steps = Math.ceil(dist / (v * dt));
  for (let i = 0; i < steps; i++) {
    s += v * dt;
    put(cars[idx], s);
    cars[idx].speed = v;
    others?.(i * dt);
    rt.update(cars, dt, ev);
  }
  return s;
}

describe('RaceTracker countdown', () => {
  it('counts 3, 2, 1, GO once each and freezes the clock until GO', () => {
    const cars = [car(0, true), car(1)];
    cars.forEach((c, i) => put(c, -7 * (i + 1)));
    const rt = new RaceTracker(track, 3, 2);
    const ev: SimEvent[] = [];
    rt.update(cars, 0, ev);
    expect(rt.state.phase).toBe('countdown');
    for (let i = 0; i < 400 && rt.state.phase === 'countdown'; i++) rt.update(cars, 1 / 60, ev);
    const values = ev.filter((e) => e.type === 'countdown').map((e) => (e as { value: number }).value);
    expect(values).toEqual([3, 2, 1, 0]);
    expect(rt.state.phase).toBe('racing');
    expect(rt.state.time).toBeLessThan(0.05);
  });

  it('cars on the grid have negative progress and correct places', () => {
    const { cars } = started(4);
    expect(cars.map((c) => c.place)).toEqual([1, 2, 3, 4]);
    for (const c of cars) expect(c.progress).toBeLessThan(0);
  });
});

describe('RaceTracker laps', () => {
  it('counts a lap when the line is crossed forward, with sane lap times', () => {
    const { rt, cars, ev } = started(1);
    const v = 40;
    drive(rt, cars, ev, 0, -7, L + 60, v);
    const laps = ev.filter((e) => e.type === 'lap');
    expect(laps.length).toBe(1);
    expect(cars[0].lap).toBe(1);
    const lt = (laps[0] as { lapTime: number }).lapTime;
    // first lap starts 7 m behind the line
    expect(lt).toBeGreaterThan((L + 7) / v - 0.2);
    expect(lt).toBeLessThan((L + 7) / v + 0.2);
    expect(cars[0].lastLapTime).toBeCloseTo(lt, 6);
    expect(cars[0].bestLapTime).toBeCloseTo(lt, 6);
  });

  it('finishes after the configured laps, emits lap x3 and finish, then stops counting', () => {
    const { rt, cars, ev } = started(2);
    put(cars[1], -30); // second car parked
    drive(rt, cars, ev, 0, -7, 3 * L + 40, 45);
    expect(ev.filter((e) => e.type === 'lap').map((e) => (e as { lap: number }).lap)).toEqual([1, 2, 3]);
    const fin = ev.filter((e) => e.type === 'finish');
    expect(fin.length).toBe(1);
    expect(cars[0].finished).toBe(true);
    expect(cars[0].place).toBe(1);
    expect(cars[0].finishTime).toBeCloseTo((3 * L + 7) / 45, 0);
    expect(rt.state.playerFinished).toBe(true);
    const lapsBefore = cars[0].lap;
    drive(rt, cars, ev, 0, 3 * L + 33, L, 45);
    expect(cars[0].lap).toBe(lapsBefore);
  });

  it('does not count driving backwards over the line and forward again', () => {
    const { rt, cars, ev } = started(1);
    let s = drive(rt, cars, ev, 0, -7, 30, 30);          // across the line to s = ~23
    s = drive(rt, cars, ev, 0, s, 60, -30);              // back over the line to s = ~-37
    drive(rt, cars, ev, 0, s, 80, 30);                   // forward again over the line
    expect(cars[0].lap).toBe(0);
    expect(ev.filter((e) => e.type === 'lap').length).toBe(0);
  });

  it('does not credit a half-lap teleport at once, and a lap needs the whole distance', () => {
    const { rt, cars, ev } = started(1);
    drive(rt, cars, ev, 0, -7, 50, 30);
    const before = cars[0].progress;
    put(cars[0], L * 0.55);                              // jump half a lap ahead
    rt.update(cars, 1 / 60, ev);
    expect(cars[0].progress).toBeCloseTo(before, 0);     // not accepted yet
    expect(cars[0].lap).toBe(0);
    // jumping back to the line and driving over it still is not a lap (progress never reached L)
    put(cars[0], 5);
    for (let i = 0; i < 30; i++) rt.update(cars, 1 / 60, ev);
    expect(cars[0].lap).toBe(0);
  });

  it('tolerates cars driving through the finish line in both directions on the grid', () => {
    const { rt, cars, ev } = started(1);
    for (let i = 0; i < 6; i++) {
      drive(rt, cars, ev, 0, -3, 6, 20);
      drive(rt, cars, ev, 0, 3, 6, -20);
    }
    expect(cars[0].lap).toBe(0);
  });
});

describe('RaceTracker places and results', () => {
  it('ranks by progress, finished cars first by finishing order', () => {
    const { rt, cars, ev } = started(4);
    const target = [100, 300, 200, 50];
    for (let i = 0; i < 4; i++) drive(rt, cars, ev, i, -7 * (i + 1), target[i] + 7 * (i + 1), 60);
    expect(cars.map((c) => c.place)).toEqual([3, 1, 2, 4]);
    expect(new Set(cars.map((c) => c.place)).size).toBe(4);
  });

  it('after the player finishes, the rest get estimated times within the grace period', () => {
    const { rt, cars, ev } = started(5);
    // AI cars on different laps/positions: keep them moving slowly behind the player
    const pos = [0, 0.8 * L, 0.6 * L, 0.4 * L, 0.2 * L];
    for (let i = 1; i < cars.length; i++) drive(rt, cars, ev, i, -7 * (i + 1), pos[i] + 7 * (i + 1), 60);
    for (let i = 1; i < cars.length; i++) put(cars[i], pos[i]);
    // player runs 3 laps quickly
    let s = 0;
    const v = 60, dt = 1 / 60;
    for (let n = 0; n < 4000 && !rt.state.playerFinished; n++) {
      s += v * dt; put(cars[0], s); cars[0].speed = v;
      for (let i = 1; i < cars.length; i++) { pos[i] += 25 * dt; put(cars[i], pos[i]); cars[i].speed = 25; }
      rt.update(cars, dt, ev);
    }
    expect(rt.state.playerFinished).toBe(true);
    expect(rt.state.phase).toBe('racing');
    const tFinish = rt.state.time;
    let guard = 0;
    while (rt.state.phase !== 'finished' && guard++ < 60 * 20) {
      for (let i = 1; i < cars.length; i++) { pos[i] += 25 * dt; put(cars[i], pos[i]); }
      rt.update(cars, dt, ev);
    }
    expect(rt.state.phase).toBe('finished');
    expect(rt.state.time - tFinish).toBeLessThanOrEqual(15);
    const res = rt.state.results;
    expect(res.length).toBe(5);
    expect(res.map((r) => r.place)).toEqual([1, 2, 3, 4, 5]);
    expect(res[0].carId).toBe(0);
    for (let i = 1; i < res.length; i++) expect(res[i].time).toBeGreaterThanOrEqual(res[i - 1].time);
    // estimated order follows the distance still to go: the car furthest along arrives first
    expect(res.slice(1).map((r) => r.carId)).toEqual([1, 2, 3, 4]);
    expect(cars.every((c) => c.finished)).toBe(true);
    expect(new Set(cars.map((c) => c.place)).size).toBe(5);
    expect(ev.filter((e) => e.type === 'finish').length).toBe(5);
  });

  it('an AI-only race ends when everybody has finished', () => {
    const { rt, cars, ev } = started(2, -1);
    expect(cars.some((c) => c.isPlayer)).toBe(false);
    drive(rt, cars, ev, 0, -7, 3 * L + 30, 50, () => { /* car 1 parked */ });
    expect(rt.state.phase).toBe('racing');
    drive(rt, cars, ev, 1, -14, 3 * L + 30, 40);
    expect(rt.state.phase).toBe('finished');
    expect(rt.state.results.map((r) => r.carId)).toEqual([0, 1]);
  });

  it('exposes track hints and lateral offsets for the AI', () => {
    const { rt, cars, ev } = started(1);
    put(cars[0], 200, 2.5);
    for (let i = 0; i < 90; i++) rt.update(cars, 1 / 60, ev);
    expect(rt.hints[0]).toBeCloseTo(200, 0);
    expect(rt.laterals[0]).toBeCloseTo(2.5, 1);
  });
});

describe('ghost', () => {
  function recordLap(rec: GhostRecorder, t0: number, lapTime: number): boolean {
    for (let t = 0; t < lapTime; t += 1 / 120) rec.update(t0 + t, t * 10, 2, 0.1);
    return rec.finishLap(t0 + lapTime, lapTime, lapTime * 10, 2, 0.1);
  }

  it('records ~20 Hz, keeps the best lap only and starts the next lap itself', () => {
    const rec = new GhostRecorder('t1');
    expect(rec.best).toBeNull();
    rec.start(0);
    expect(recordLap(rec, 0, 20)).toBe(true);
    const first = rec.best!;
    expect(first.trackId).toBe('t1');
    expect(first.lapTime).toBe(20);
    expect(first.frames.length).toBeGreaterThan(20 * CONFIG.race.ghostHz - 2);
    expect(first.frames.length).toBeLessThan(20 * CONFIG.race.ghostHz + 3);
    expect(first.frames[1].t - first.frames[0].t).toBeCloseTo(1 / CONFIG.race.ghostHz, 3);
    expect(first.frames[0].t).toBe(0);
    expect(first.frames[first.frames.length - 1].t).toBe(20);
    expect(recordLap(rec, 20, 22)).toBe(false);          // slower: ignored
    expect(rec.best).toBe(first);
    expect(recordLap(rec, 42, 18.5)).toBe(true);          // faster: replaces
    expect(rec.best!.lapTime).toBe(18.5);
  });

  it('a recording has to beat a given saved ghost to count', () => {
    const rec = new GhostRecorder('t1', 19);
    rec.start(0);
    expect(recordLap(rec, 0, 20)).toBe(false);
    expect(rec.best).toBeNull();
    expect(recordLap(rec, 20, 18)).toBe(true);
  });

  it('plays back by interpolation and returns null outside the lap', () => {
    const g: GhostData = {
      trackId: 't1', lapTime: 1,
      frames: [{ t: 0, x: 0, y: 0, a: 0 }, { t: 0.5, x: 10, y: 4, a: 1 }, { t: 1, x: 20, y: 8, a: 2 }],
    };
    expect(ghostPoseAt(g, -0.1)).toBeNull();
    expect(ghostPoseAt(g, 1.01)).toBeNull();
    const p = ghostPoseAt(g, 0.25)!;
    expect(p.x).toBeCloseTo(5, 6);
    expect(p.y).toBeCloseTo(2, 6);
    expect(p.a).toBeCloseTo(0.5, 6);
    expect(ghostPoseAt(g, 1)!.x).toBeCloseTo(20, 6);
  });

  it('interpolates angles the short way around', () => {
    const g: GhostData = { trackId: 't', lapTime: 1, frames: [{ t: 0, x: 0, y: 0, a: 3.0 }, { t: 1, x: 0, y: 0, a: -3.0 }] };
    const a = ghostPoseAt(g, 0.5)!.a;
    expect(Math.abs(Math.abs(a) - Math.PI)).toBeLessThan(0.2);
  });
});
