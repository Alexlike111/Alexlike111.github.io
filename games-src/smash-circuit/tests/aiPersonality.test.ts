// Rival characters: rammers hunt the human (one at a time, with a cooldown) and smashable props, blockers cover a follower,
// everybody keeps the grid column for the first metres, and the field is built with a sensible mix.
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { makeOpponents } from '../src/meta/opponents';
import { AiDriver, type AiShared } from '../src/sim/ai';
import { AiItemUser } from '../src/sim/aiItems';
import { baseStats, NO_DAMAGE } from '../src/sim/carModel';
import { createZoneHp } from '../src/sim/damage';
import { makeRng } from '../src/sim/rng';
import { buildTrackGeometry } from '../src/track/spline';
import { trackById } from '../src/track/tracks';
import type { AiPersonality, CarState, TrackDef, TrackGeometry } from '../src/types';

const A = CONFIG.ai;
const T2 = buildTrackGeometry(trackById('t2'));   // 145 m dead straight after the line

function mk(track: TrackGeometry, id: number, s: number, lat: number, speed: number, over: Partial<CarState> = {}): CarState {
  const t = track.sampleAt(s);
  const a = Math.atan2(t.ty, t.tx);
  return {
    id, isPlayer: false, colorIndex: 0, name: 'x',
    x: t.x + t.nx * lat, y: t.y + t.ny * lat, angle: a,
    vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, angularVel: 0, speed, steer: 0,
    throttle: 0, brake: 0, handbrake: false, rpm: 0.3, drifting: false, slip: 0,
    hp: createZoneHp(100), zoneMaxHp: 100, health: 1, effects: { ...NO_DAMAGE }, detachedParts: [], wrecked: false,
    lap: 0, progress: s, place: 1, finished: false, finishTime: 0, lastLapTime: 0, bestLapTime: 0, onCurb: false, offRoad: false,
    ...over,
  };
}
const persona = (style: AiPersonality['style'], over: Partial<AiPersonality> = {}): AiPersonality =>
  ({ skill: 0.8, aggression: 0.5, laneOffset: 0, mistakeRate: 0, style, ...over });
/** A driver that has already left its grid column (launch hold over). */
function freeDriver(p: AiPersonality, track: TrackGeometry, id: number, shared?: AiShared): { d: AiDriver; me: CarState } {
  const d = new AiDriver(p, makeRng(7));
  if (shared) d.shared = shared;
  d.think(mk(track, id, 10, 0, 20), [], track, 1, 10);                 // first look: remembers the grid spot
  return { d, me: mk(track, id, 70, 0, 28) };                          // 60 m later: free
}
function internals(d: AiDriver): { offset: number; blockLat: number } { return d as unknown as { offset: number; blockLat: number }; }

describe('rammer', () => {
  it('goes for the human just ahead, aims at its line, and attacks again only after the cooldown', () => {
    const { d, me } = freeDriver(persona('rammer'), T2, 3);
    const human = mk(T2, 0, 90, 2.5, 26, { isPlayer: true });          // 20 m ahead, 2.5 m aside
    const seen: boolean[] = [];
    let aimed = 0;
    for (let i = 0; i < 16; i++) { d.think(me, [human], T2, 1, 70); seen.push(d.attacking); if (i === 1) aimed = internals(d).offset; }
    expect(seen[0]).toBe(true);
    expect(aimed).toBeGreaterThan(1);                                  // heading for the human's side (lateral +2.5)
    // lasts about attackTime, then cools down, then comes back
    const firstEnd = seen.indexOf(false);
    expect(firstEnd).toBeGreaterThanOrEqual(Math.floor(A.attackTime));
    expect(firstEnd).toBeLessThanOrEqual(Math.ceil(A.attackTime) + 1);
    const again = seen.indexOf(true, firstEnd);
    expect(again).toBeGreaterThan(firstEnd + Math.floor(A.attackCooldown) - 1);
  });
  it('hunts only the human while one is on the grid, but any car when the race has none', () => {
    const ai = mk(T2, 5, 90, 1, 26);
    const a = freeDriver(persona('rammer'), T2, 3);
    a.d.think(a.me, [ai], T2, 1, 70);
    expect(a.d.attacking).toBe(true);                                  // all-AI race: the rammer takes the car ahead
    const b = freeDriver(persona('rammer'), T2, 4);
    const human = mk(T2, 0, 40, 0, 20, { isPlayer: true });            // a human exists but is far behind: no target, the AI car is left alone
    b.d.think(b.me, [ai, human], T2, 1, 70);
    expect(b.d.attacking).toBe(false);
  });
  it('only one rammer at a time attacks the human (shared token)', () => {
    const shared: AiShared = { owner: -1, until: 0 };
    const a = freeDriver(persona('rammer'), T2, 3, shared), b = freeDriver(persona('rammer'), T2, 4, shared);
    const human = mk(T2, 0, 90, 1, 26, { isPlayer: true });
    a.d.think(a.me, [human], T2, 1, 70);
    b.d.think(b.me, [human], T2, 1, 70);
    expect(a.d.attacking).toBe(true);
    expect(b.d.attacking).toBe(false);
    expect(shared.owner).toBe(3);
  });
  it('does not attack when badly damaged, in a tight bend, or a clean racer / blocker does', () => {
    const human = mk(T2, 0, 90, 1, 26, { isPlayer: true });
    const hurt = freeDriver(persona('rammer'), T2, 3);
    hurt.d.think({ ...hurt.me, health: A.attackMinHealth - 0.05 }, [human], T2, 1, 70);
    expect(hurt.d.attacking).toBe(false);
    for (const style of ['racer', 'blocker'] as const) {
      const f = freeDriver(persona(style), T2, 3);
      f.d.think(f.me, [human], T2, 1, 70);
      expect(f.d.attacking).toBe(false);
    }
    const bend = buildTrackGeometry(trackById('t3'));
    let sBend = 0, k = 0;
    for (let s = 0; s < bend.length; s += 2) if (Math.abs(bend.sampleAt(s).curvature) > k) { k = Math.abs(bend.sampleAt(s).curvature); sBend = s; }
    const f = freeDriver(persona('rammer'), bend, 3);
    const me = mk(bend, 3, sBend - 14, 0, 18);
    const prey = mk(bend, 0, sBend - 4, 0, 16, { isPlayer: true });
    f.d.think(me, [prey], bend, 1, sBend - 14);
    expect(f.d.attacking).toBe(false);
  });
  it('steers toward a smashable prop beside the road when nothing else is going on, a clean racer does not', () => {
    const half = T2.def.width / 2;
    const c = T2.sampleAt(100);
    const lat = half + 0.85;
    const def: TrackDef = { ...T2.def, props: [{ type: 'barrel', x: c.x + c.nx * lat, y: c.y + c.ny * lat, angle: 0 }] };
    const track = buildTrackGeometry(def);
    const r = freeDriver(persona('rammer'), track, 3);
    const c2 = freeDriver(persona('racer'), track, 4);
    const me = mk(track, 3, 70, 0, 28);
    for (let i = 0; i < 4; i++) { r.d.think(me, [], track, 1, 70); c2.d.think({ ...me, id: 4 }, [], track, 1, 70); }
    expect(internals(r.d).offset).toBeGreaterThan(half - 1.5);          // clipping the run-off prop
    expect(Math.abs(internals(c2.d).offset)).toBeLessThan(2.5);
  });
});

describe('blocker', () => {
  it('covers a follower on a straight with one move, then holds the line for a moment', () => {
    const { d, me } = freeDriver(persona('blocker'), T2, 3);
    const f1 = mk(T2, 6, 60, 2.5, 30);                                 // 10 m behind, on the left
    d.think(me, [f1], T2, 1, 70);
    expect(internals(d).blockLat).toBeCloseTo(2.5, 0);
    d.think(me, [mk(T2, 6, 61, -2.5, 30)], T2, 1, 70);                 // follower dives to the other side 1 s later: still the same line
    expect(internals(d).blockLat).toBeCloseTo(2.5, 0);
    d.think(me, [mk(T2, 6, 62, -2.5, 30)], T2, 1, 70);                 // after the hold it moves, once
    expect(internals(d).blockLat).toBeCloseTo(-2.5, 0);
  });
  it('ignores nobody-behind and followers that are far away or far aside', () => {
    const { d, me } = freeDriver(persona('blocker'), T2, 3);
    d.think(me, [mk(T2, 6, 30, 2.5, 30), mk(T2, 7, 62, 9, 30)], T2, 1, 70);
    expect(internals(d).blockLat).toBe(0);
  });
});

describe('launch', () => {
  it('every driver keeps its grid column for the first launchHold metres, then is free', () => {
    const grid = -1.8;
    const d = new AiDriver(persona('racer', { laneOffset: 0.8 }), makeRng(3));
    d.think(mk(T2, 1, T2.length - 9, grid, 0), [], T2, 1, T2.length - 9);
    for (const s of [2, 12, 19]) { d.think(mk(T2, 1, s, grid, 30), [], T2, 1, s); expect(internals(d).offset).toBeCloseTo(grid, 0); }
    for (let i = 0; i < 6; i++) d.think(mk(T2, 1, 60 + i * 5, grid, 30), [], T2, 1, 60 + i * 5);
    expect(Math.abs(internals(d).offset - grid)).toBeGreaterThan(0.2);
  });
});

describe('rival field', () => {
  it('has rammers, a blocker and clean racers, in the track ramp', () => {
    const O = CONFIG.meta.opponents;
    for (let ti = 0; ti < 3; ti++) {
      const field = makeOpponents(ti, baseStats(), 11 + ti, 0);
      const count = (st: string): number => field.filter((c) => c.ai?.style === st).length;
      expect(count('rammer')).toBe(O.rammers[ti]);
      expect(count('blocker')).toBe(O.blockers[ti]);
      expect(count('racer')).toBe(field.length - O.rammers[ti] - O.blockers[ti]);
      for (const c of field) {
        const ai = c.ai!;
        if (ai.style === 'rammer') expect(ai.aggression).toBeGreaterThanOrEqual(0.8);
        if (ai.style === 'racer') expect(ai.aggression).toBeLessThanOrEqual(0.35);
      }
    }
  });
  it('is deterministic for a seed', () => {
    const a = makeOpponents(1, baseStats(), 5, 0), b = makeOpponents(1, baseStats(), 5, 0);
    expect(a.map((c) => c.ai?.style)).toEqual(b.map((c) => c.ai?.style));
  });
});

describe('AI items by character', () => {
  it('a rammer fires nitro to close in on a car ahead on a calm straight, a clean racer waits for open road', () => {
    const run = (style: 'rammer' | 'racer'): boolean => {
      const iu = new AiItemUser(0.9, makeRng(2), style);
      const me = mk(T2, 3, 60, 0, 30, { item: 'nitro' });
      const prey = mk(T2, 0, 78, 0.5, 26, { isPlayer: true });
      let used = false;
      for (let i = 0; i < 40 && !used; i++) used = iu.update(0.1, me, [prey], T2, 60, 20);
      return used;
    };
    expect(run('rammer')).toBe(true);
    expect(run('racer')).toBe(false);
  });
});
