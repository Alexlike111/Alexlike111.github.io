// AI pace and difficulty ramp (round 2): the top AI is close to the best lap a car can do, a crude keyboard driver
// does not simply win every race, and the AI chases a human who runs away.
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { makeOpponents } from '../src/meta/opponents';
import { AiDriver } from '../src/sim/ai';
import { baseStats } from '../src/sim/carModel';
import { makeRng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import { buildTrackGeometry } from '../src/track/spline';
import { TRACKS } from '../src/track/tracks';
import type { CarInput, CarState, TrackGeometry } from '../src/types';
import { NO_DAMAGE } from '../src/sim/carModel';
import { createZoneHp } from '../src/sim/damage';

const DT = 1 / 60;

/** Best lap (s) a clean car can drive per track with these physics, measured from the fastest clear AI (trackSpeed 1.15). */
const OPTIMAL_LAP: Record<string, number> = { t1: 26.1, t2: 30.2, t3: 33.0 };

function soloLap(ti: number, skill: number): { lap: number; respawns: number; health: number } {
  const sim = new Sim({
    track: TRACKS[ti],
    cars: [{ id: 0, isPlayer: false, name: 'x', colorIndex: 0, stats: baseStats(), ai: { skill, aggression: 0.5, laneOffset: 0, mistakeRate: 0 } }],
    seed: 1,
  });
  let t = 0;
  while (t < 200 && sim.race.phase !== 'finished') { sim.update(DT); t += DT; sim.drainEvents(); }
  return { lap: sim.cars[0].bestLapTime, respawns: sim.respawns, health: sim.cars[0].health };
}

describe('AI pace', () => {
  it('the top AI laps within 3% of the optimal lap on t3 and within 6% on the easier tracks, without crashing', () => {
    for (let ti = 0; ti < 3; ti++) {
      const id = TRACKS[ti].id;
      const r = soloLap(ti, 1);
      expect(r.lap).toBeGreaterThan(OPTIMAL_LAP[id] * 0.97);             // sanity: not faster than physics allows
      expect(r.lap).toBeLessThan(OPTIMAL_LAP[id] * (ti === 2 ? 1.03 : 1.06));
      expect(r.respawns).toBe(0);
      expect(r.health).toBeGreaterThan(0.9);
    }
  }, 60000);

  it('the cornering plan is as hard as the car can take (maxLatAccel 17..19) and the ramp rises with the track', () => {
    expect(CONFIG.ai.maxLatAccel).toBeGreaterThanOrEqual(17);
    expect(CONFIG.ai.maxLatAccel).toBeLessThanOrEqual(CONFIG.car.maxLatAccel);
    const r = CONFIG.ai.trackSpeed;
    expect(r.t1).toBeLessThanOrEqual(r.t2);
    expect(r.t2).toBeLessThanOrEqual(r.t3);
    const O = CONFIG.meta.opponents;
    for (let i = 1; i < O.skill.length; i++) {
      expect(O.skill[i][0]).toBeGreaterThan(O.skill[i - 1][0]);
      expect(O.skill[i][1]).toBeGreaterThanOrEqual(O.skill[i - 1][1]);
      expect(O.statScale[i][1]).toBeGreaterThan(O.statScale[i - 1][1]);
    }
    expect(O.skill[2][1]).toBeGreaterThanOrEqual(0.97);
  });
});

describe('AI vs a crude human', () => {
  /** keyboard-style bot: bang-bang steering at the spline, full throttle, lifts / brakes for upcoming bends, reverses when stuck. */
  function makeBot() {
    let rev = 0, stuck = 0;
    return (sim: Sim): CarInput => {
      const p = sim.cars[0], tr = sim.track;
      const near = tr.nearest(p.x, p.y, sim.tracker.hints[0]);
      const tp = tr.sampleAt(near.s + 10 + Math.abs(p.speed) * 0.6);
      let a = Math.atan2(tp.y - p.y, tp.x - p.x) - p.angle;
      while (a > Math.PI) a -= 2 * Math.PI;
      while (a < -Math.PI) a += 2 * Math.PI;
      if (rev > 0) { rev -= DT; return { throttle: 0, brake: 1, steer: a > 0 ? 1 : -1, handbrake: false }; }
      if (Math.abs(p.speed) < 1) stuck += DT; else stuck = 0;
      if (stuck > 1.2) { stuck = 0; rev = 1; }
      let kmax = 0;
      for (let d = 0; d < 40; d += 5) kmax = Math.max(kmax, Math.abs(tr.sampleAt(near.s + d).curvature));
      const vsafe = Math.sqrt(16 / Math.max(kmax, 1e-3));
      return {
        throttle: (Math.abs(a) < 0.5 || p.speed < 12) && p.speed < vsafe + 3 ? 1 : 0,
        brake: p.speed > vsafe + 8 ? 1 : 0,
        steer: a > 0.06 ? -1 : a < -0.06 ? 1 : 0,
        handbrake: false,
      };
    };
  }

  function botPlace(ti: number, seed: number): number {
    const sim = new Sim({
      track: TRACKS[ti],
      cars: [{ id: 0, isPlayer: true, name: 'p', colorIndex: 0, stats: baseStats() }, ...makeOpponents(ti, baseStats(), seed, 0)],
      seed,
    });
    const bot = makeBot();
    let t = 0;
    while (t < 330 && !sim.race.playerFinished) {
      if (sim.race.phase === 'racing') sim.setPlayerInput(bot(sim));
      sim.update(DT); t += DT; sim.drainEvents();
    }
    return sim.cars[0].place;
  }

  it('the base car with a crude driver is mid-pack on t1 and near the back on t3, not the winner of every race', () => {
    const seeds = [1, 2, 3, 4, 5];
    const mean = (ti: number): number => seeds.map((s) => botPlace(ti, s)).reduce((a, b) => a + b, 0) / seeds.length;
    const t1 = mean(0), t3 = mean(2);
    expect(t1).toBeGreaterThanOrEqual(2.5);
    expect(t1).toBeLessThanOrEqual(5.5);
    expect(t3).toBeGreaterThanOrEqual(4.8);
    expect(t3).toBeGreaterThan(t1 + 1);
  }, 120000);
});

describe('rubber band: chase a runaway human', () => {
  const g: TrackGeometry = buildTrackGeometry(TRACKS[1]);
  function carAt(s: number, over: Partial<CarState> = {}): CarState {
    const t = g.sampleAt(s);
    const a = Math.atan2(t.ty, t.tx);
    return {
      id: 1, isPlayer: false, colorIndex: 0, name: 'x', x: t.x, y: t.y, angle: a, vx: Math.cos(a) * 20, vy: Math.sin(a) * 20,
      angularVel: 0, speed: 20, steer: 0, throttle: 0, brake: 0, handbrake: false, rpm: 0.3, drifting: false, slip: 0,
      hp: createZoneHp(100), zoneMaxHp: 100, health: 1, effects: { ...NO_DAMAGE }, detachedParts: [], wrecked: false,
      lap: 0, progress: s, place: 1, finished: false, finishTime: 0, lastLapTime: 0, bestLapTime: 0, onCurb: false, offRoad: false,
      ...over,
    };
  }
  function catchUp(gap: number): number {
    const d = new AiDriver({ skill: 0.8, aggression: 0.4, laneOffset: 0, mistakeRate: 0 }, makeRng(1));
    const me = carAt(300, { progress: 300 });
    const human = carAt(300, { id: 0, isPlayer: true, progress: 300 + gap });
    human.x += 500; human.y += 500;
    d.think(me, [human], g, 1, 300);
    return d.catchUp;
  }

  it('does nothing while the human leads by less than 80 m, ramps up beyond it', () => {
    expect(catchUp(0)).toBe(0);
    expect(catchUp(70)).toBe(0);
    expect(catchUp(80 + 1)).toBeGreaterThan(0);
    expect(catchUp(150)).toBeGreaterThan(catchUp(100));
    expect(catchUp(400)).toBeCloseTo(1, 5);
    expect(catchUp(-300)).toBe(0);                  // an AI car ahead of the human never gets the assist
  });

  it('the Sim turns it into engine power / top speed for the AI car only', () => {
    const sim = new Sim({
      track: TRACKS[0],
      cars: [{ id: 0, isPlayer: true, name: 'p', colorIndex: 0, stats: baseStats() }, ...makeOpponents(0, baseStats(), 3, 0)],
      seed: 3,
    });
    while (sim.race.phase === 'countdown') sim.update(DT);
    // the human is placed 400 m down the road (the tracker confirms such a jump after CONFIG.race.jumpConfirmTime)
    const t = sim.track.sampleAt(400);
    sim.simCars[0].reset(t.x, t.y, Math.atan2(t.ty, t.tx));
    for (let i = 0; i < 60 * 3; i++) sim.update(DT);
    expect(sim.cars[0].progress).toBeGreaterThan(300);
    const assists = sim.simCars.slice(1).map((c) => c.assist);
    expect(Math.max(...assists)).toBeGreaterThan(0);
    expect(sim.simCars[0].assist).toBe(0);
  });
});
