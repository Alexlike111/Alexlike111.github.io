import { describe, expect, it } from 'vitest';
import * as planck from 'planck';
import { CONFIG } from '../src/config';
import type { DestructibleKind, SimEvent, TrackDef } from '../src/types';
import { buildTrackGeometry } from '../src/track/spline';
import { TRACKS } from '../src/track/tracks';
import { DestructionSystem } from '../src/sim/destruction';
import { SURFACE_CURB, SURFACE_GRASS, SURFACE_HOLE, SURFACE_ROAD } from '../src/sim/carModel';
import { PhysicsWorld, contactImpulse, fixtureData } from '../src/sim/world';

const D = CONFIG.destruction;
/** impulse that just breaks a piece of `kind` in a single hit */
const breakImpulse = (kind: 'wall' | 'guardrail' | 'road'): number => D[kind].threshold + D[kind].hp / D.impulseToDamage + 100;

function circleDef(R: number, props: TrackDef['props'] = [], width = 12): TrackDef {
  const points = [];
  for (let i = 0; i < 20; i++) {
    const a = (i * 2 * Math.PI) / 20;
    points.push({ x: R * Math.cos(a), y: R * Math.sin(a) });
  }
  return { id: 'c', nameKey: 'c', theme: 'meadow', laps: 3, width, points, props, wallStyle: 'concrete' };
}

function setup(def: TrackDef) {
  const pw = new PhysicsWorld();
  const g = buildTrackGeometry(def);
  const ds = new DestructionSystem(pw, g);
  return { pw, g, ds };
}

/** Wires what the Sim does: car <-> destructible contacts are recorded through recordHit. */
function wireCarHits(pw: PhysicsWorld, ds: DestructionSystem): void {
  pw.onPostSolve((c, imp) => {
    const a = fixtureData(c.getFixtureA()), b = fixtureData(c.getFixtureB());
    if (!a || !b) return;
    const [car, other] = a.kind === 'car' ? [c.getFixtureA(), b] : b.kind === 'car' ? [c.getFixtureB(), a] : [null, null];
    if (!car || !other || other.kind === 'car' || !('id' in other)) return;
    const v = car.getBody().getLinearVelocity();
    const p = car.getBody().getPosition();
    ds.recordHit(other.id, contactImpulse(imp), p.x, p.y, v.x, v.y);
  });
}

function makeCar(pw: PhysicsWorld, x: number, y: number, vx: number, vy: number): planck.Body {
  const body = pw.world.createBody({ type: 'dynamic', position: { x, y }, bullet: true, allowSleep: false });
  body.createFixture({
    shape: new planck.Box(CONFIG.car.length / 2, CONFIG.car.width / 2),
    density: CONFIG.car.mass / (CONFIG.car.length * CONFIG.car.width), friction: 0.25, restitution: 0.2,
    userData: { kind: 'car', carId: 0 },
  });
  body.setLinearVelocity({ x: vx, y: vy });
  return body;
}

function ofKind(ds: DestructionSystem, kind: DestructibleKind) {
  return ds.states.filter((s) => s.kind === kind);
}

describe('DestructionSystem construction', () => {
  const t = TRACKS[0];
  const { pw, ds } = setup(t);
  it('ids are indices and every kind exists', () => {
    ds.states.forEach((s, i) => expect(s.id).toBe(i));
    for (const k of ['wall', 'guardrail', 'curb', 'road', 'prop'] as DestructibleKind[]) {
      expect(ofKind(ds, k).length, k).toBeGreaterThan(0);
    }
    expect(ofKind(ds, 'prop').length).toBe(t.props.length);
    expect(ds.counts.prop).toBe(t.props.length);
  });
  it('walls run on both sides of the whole track, no gaps larger than a few cm', () => {
    const segs = ds.states.filter((s) => s.kind === 'wall' || s.kind === 'guardrail');
    const L = ds.track.length;
    expect(segs.length).toBe(2 * Math.round(L / D.guardrail.segmentLength));
    for (const s of segs) {
      expect(s.hp).toBe(s.maxHp);
      expect(s.broken).toBe(false);
      expect(ds.bodyOf(s.id)).not.toBeNull();
    }
  });
  it('walls and guardrails are thicker than a car travels in one step at max-upgraded top speed', () => {
    const vMax = CONFIG.car.baseTopSpeed * (1 + CONFIG.upgrades.maxLevel * CONFIG.upgrades.engine.topSpeedPerLevel);
    const travel = vMax * CONFIG.physics.dt;
    for (const s of ds.states) if (s.kind === 'wall' || s.kind === 'guardrail') expect(s.h).toBeGreaterThan(travel * 1.3);
    expect(D.wall.thickness).toBeGreaterThan(travel);
    expect(D.guardrail.thickness).toBeGreaterThan(travel);
  });
  it('wall segments sit at wallOffset beyond the road edge', () => {
    const w = ofKind(ds, 'wall')[0];
    const n = ds.track.nearest(w.x, w.y);
    expect(Math.abs(Math.abs(n.lateral) - (t.width / 2 + D.wallOffset))).toBeLessThan(0.25);
  });
  it('curbs are static sensors on corners only; road chunks have no body', () => {
    for (const s of ofKind(ds, 'curb')) {
      const b = ds.bodyOf(s.id)!;
      expect(b.getType()).toBe('static');
      expect(b.getFixtureList()!.isSensor()).toBe(true);
      const a = Math.abs(ds.track.nearest(s.x, s.y).lateral);
      expect(a).toBeGreaterThan(t.width / 2);
      expect(a).toBeLessThan(t.width / 2 + D.curb.width + 0.1);
    }
    for (const s of ofKind(ds, 'road')) expect(ds.bodyOf(s.id)).toBeNull();
    expect(ofKind(ds, 'road').length).toBe(Math.round(ds.track.length / D.road.chunkLength) * D.roadLanes);
  });
  it('cones/barrels/crates/hay/tyres are light dynamic bodies that start asleep; trees and rocks are static', () => {
    for (const s of ofKind(ds, 'prop')) {
      const b = ds.bodyOf(s.id)!;
      const light = ['cone', 'barrel', 'crate', 'tireStack', 'hayBale'].includes(s.propType!);
      expect(b.getType()).toBe(light ? 'dynamic' : 'static');
      expect(!!s.dynamic).toBe(light);
      if (light) {
        expect(b.isAwake()).toBe(false);
        expect(b.getMass()).toBeLessThan(CONFIG.car.mass / 10);
      }
    }
  });
  it('fixture userData maps back to the state of the same kind', () => {
    for (let b = pw.world.getBodyList(); b; b = b.getNext()) {
      for (let f = b.getFixtureList(); f; f = f.getNext()) {
        const d = fixtureData(f)!;
        expect(d).toBeTruthy();
        if (d.kind === 'car') continue;
        if (d.id === -1) continue; // boundary fence
        expect(ds.states[d.id].kind).toBe(d.kind);
      }
    }
  });
  it('is deterministic', () => {
    const a = setup(TRACKS[1]).ds.states, b = setup(TRACKS[1]).ds.states;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('damage and breaking', () => {
  it('a hit below the threshold does nothing (guardrail and wall)', () => {
    const { ds } = setup(TRACKS[0]);
    const g = ofKind(ds, 'guardrail')[0], w = ofKind(ds, 'wall')[0];
    ds.recordHit(g.id, D.guardrail.threshold - 1, 0, 0, 5, 0);
    ds.recordHit(w.id, D.wall.threshold, 0, 0, 5, 0);
    const ev: SimEvent[] = [];
    ds.flush(ev);
    expect(g.hp).toBe(g.maxHp);
    expect(w.hp).toBe(w.maxHp);
    expect(g.crack).toBe(0);
    expect(ev).toEqual([]);
  });
  it('light touch does not break a guardrail but a strong hit does; hp loss follows the formula', () => {
    const { ds } = setup(TRACKS[0]);
    const g = ofKind(ds, 'guardrail')[3];
    ds.recordHit(g.id, D.guardrail.threshold + 1000, 0, 0, 5, 0);
    const ev: SimEvent[] = [];
    ds.flush(ev);
    expect(g.hp).toBeCloseTo(g.maxHp - 1000 * D.impulseToDamage, 6);
    expect(g.crack).toBeCloseTo(1 - g.hp / g.maxHp, 6);
    expect(g.broken).toBe(false);
    ds.recordHit(g.id, breakImpulse('guardrail'), 0, 0, 20, 3); // breaks, neighbours only cracked
    ds.flush(ev);
    expect(g.broken).toBe(true);
    expect(ev.filter((e) => e.type === 'break')).toHaveLength(1);
  });
  it('break event carries geometry and the hit velocity; body is removed only AFTER the world step', () => {
    const { pw, ds } = setup(TRACKS[0]);
    const w = ofKind(ds, 'wall')[5];
    const before = pw.world.getBodyCount();
    ds.recordHit(w.id, breakImpulse('wall'), 1, 2, 12, -4);
    // recording alone changes nothing
    expect(w.hp).toBe(w.maxHp);
    const ev: SimEvent[] = [];
    ds.flush(ev);
    expect(ev).toHaveLength(1);
    const e = ev[0];
    expect(e).toMatchObject({ type: 'break', id: w.id, kind: 'wall', x: w.x, y: w.y, w: w.w, h: w.h, vx: 12, vy: -4 });
    expect(w.broken).toBe(true);
    expect(w.crack).toBe(1);
    // still in the world (deferred removal), but already out of the broadphase
    expect(pw.world.getBodyCount()).toBe(before);
    expect(pw.pendingRemovals).toBe(1);
    pw.step();
    expect(pw.world.getBodyCount()).toBe(before - 1);
    expect(pw.pendingRemovals).toBe(0);
    expect(ds.bodyOf(w.id)).toBeNull();
    // already broken: more hits are ignored, no second event
    ds.recordHit(w.id, 1e6, 0, 0, 0, 0);
    const ev2: SimEvent[] = [];
    ds.flush(ev2);
    expect(ev2).toEqual([]);
  });
  it('at most maxBreaksPerStep per flush, the rest follow on the next flushes', () => {
    const { ds } = setup(TRACKS[0]);
    const walls = ofKind(ds, 'wall').filter((_, i) => i % 6 === 0).slice(0, 10); // far apart: no splash chains
    for (const w of walls) ds.recordHit(w.id, breakImpulse('wall') + breakImpulse('guardrail'), 0, 0, 1, 0);
    const counts: number[] = [];
    for (let i = 0; i < 4; i++) {
      const ev: SimEvent[] = [];
      ds.flush(ev);
      counts.push(ev.filter((e) => e.type === 'break').length);
    }
    expect(counts[0]).toBe(D.maxBreaksPerStep);
    expect(counts[1]).toBe(D.maxBreaksPerStep);
    expect(counts.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(10);
    expect(walls.every((w) => w.broken)).toBe(true);
  });
  it('a broken wall leaves a gap in physics: a car body passes through it and is stopped by intact walls', () => {
    const def = circleDef(80);
    const { pw, g, ds } = setup(def);
    const half = def.width / 2 + D.wallOffset;
    // pick the wall segment on the outside at angle 0: the point (80 + half, 0)
    const target = ds.states.filter((s) => s.kind === 'wall' || s.kind === 'guardrail')
      .reduce((best, s) => (Math.hypot(s.x - (80 + half), s.y) < Math.hypot(best.x - (80 + half), best.y) ? s : best));
    const th = Math.atan2(target.y, target.x);
    const fire = (): number => {
      const car = makeCar(pw, 80 * Math.cos(th), 80 * Math.sin(th), 25 * Math.cos(th), 25 * Math.sin(th));
      for (let i = 0; i < 120; i++) pw.step();
      const p = car.getPosition();
      const r = Math.hypot(p.x, p.y);
      pw.world.destroyBody(car);
      return r;
    };
    const blocked = fire();
    expect(blocked).toBeLessThan(80 + half); // stopped by the intact wall
    ds.recordHit(target.id, 1e6, 0, 0, 0, 0);
    const ev: SimEvent[] = [];
    ds.flush(ev);
    pw.step();
    expect(target.broken).toBe(true);
    const free = fire();
    expect(free).toBeGreaterThan(80 + half + 5);
    expect(g.length).toBeGreaterThan(0);
  });
  it('splash damage hurts the neighbouring wall segments but never breaks them from a threshold-sized hit', () => {
    const { ds } = setup(TRACKS[1]);
    const w = ofKind(ds, 'wall')[10];
    const idx = ds.states.indexOf(w);
    ds.recordHit(w.id, D.wall.threshold + 6000, 0, 0, 3, 0);
    ds.flush([]);
    const dmg = 6000 * D.impulseToDamage;
    expect(ds.states[idx - 1].hp).toBeCloseTo(ds.states[idx - 1].maxHp - dmg * D.splash, 6);
    expect(ds.states[idx + 1].hp).toBeCloseTo(ds.states[idx + 1].maxHp - dmg * D.splash, 6);
  });
  it('ids out of range (e.g. the boundary fence, -1) are ignored', () => {
    const { ds } = setup(TRACKS[0]);
    ds.recordHit(-1, 1e7, 0, 0, 0, 0);
    ds.recordHit(9999999, 1e7, 0, 0, 0, 0);
    const ev: SimEvent[] = [];
    ds.flush(ev);
    expect(ev).toEqual([]);
  });
});

describe('road tearing and surfaces', () => {
  it('hitRoad below the road threshold does nothing; heavy repeated hits tear a chunk into a hole', () => {
    const { ds, g } = setup(TRACKS[0]);
    const c = g.sampleAt(300);
    ds.hitRoad(c.x, c.y, D.road.threshold - 1);
    let ev: SimEvent[] = [];
    ds.flush(ev);
    expect(ev).toEqual([]);
    expect(ds.surfaceAt(c.x, c.y).kind).toBe('road');
    expect(ds.surfaceAt(c.x, c.y).surface).toBe(SURFACE_ROAD);
    for (let i = 0; i < 3 && ds.holeCount === 0; i++) {
      ds.hitRoad(c.x, c.y, breakImpulse('road'));
      ev = [];
      ds.flush(ev);
    }
    expect(ds.holeCount).toBeGreaterThan(0);
    const rb = ev.filter((e) => e.type === 'break' && e.kind === 'road');
    expect(rb.length).toBeGreaterThan(0);
    const s = ds.surfaceAt(c.x, c.y);
    expect(s.kind).toBe('hole');
    expect(s.surface).toBe(SURFACE_HOLE);
    // the hole is local: 40 m further the road is fine
    const far = g.sampleAt(340);
    expect(ds.surfaceAt(far.x, far.y).kind).toBe('road');
  });
  it('impacts outside the road corridor do not tear road (e.g. far on the grass)', () => {
    const { ds, g } = setup(TRACKS[0]);
    const c = g.sampleAt(200);
    ds.hitRoad(c.x + c.nx * 40, c.y + c.ny * 40, 1e6);
    ds.flush([]);
    expect(ds.holeCount).toBe(0);
  });
  it('surfaceAt: road in the middle, curb on corners at the edge, grass elsewhere', () => {
    const { ds, g } = setup(TRACKS[2]);
    const curb = ofKind(ds, 'curb')[0];
    const si = ds.surfaceAt(curb.x, curb.y);
    expect(si.kind).toBe('curb');
    expect(si.surface).toBe(SURFACE_CURB);
    expect(si.curbId).toBe(curb.id);
    const c = g.sampleAt(20);
    expect(ds.surfaceAt(c.x, c.y, 20).kind).toBe('road');
    expect(ds.surfaceAt(c.x - c.nx * 30, c.y - c.ny * 30).surface).toBe(SURFACE_GRASS);
    expect(ds.surfaceAt(c.x - c.nx * 30, c.y - c.ny * 30).kind).toBe('grass');
    // straight stretches have no curbs: just beside the road edge is grass
    const e = g.sampleAt(20);
    expect(ds.surfaceAt(e.x + e.nx * (g.def.width / 2 + 0.5), e.y + e.ny * (g.def.width / 2 + 0.5)).kind).toBe('grass');
  });
  it('scuffing a curb wears it down until it breaks; a smashed curb is plain road', () => {
    const { ds } = setup(TRACKS[0]);
    const curb = ofKind(ds, 'curb')[2];
    ds.scuffCurb(curb.id, D.curbScuffMinSpeed - 1, 1); // too slow: nothing
    expect(curb.hp).toBe(curb.maxHp);
    const ev: SimEvent[] = [];
    for (let i = 0; i < 400 && !curb.broken; i++) { ds.scuffCurb(curb.id, 30, 1 / 120 * 12); ds.flush(ev); }
    expect(curb.broken).toBe(true);
    expect(ev.some((e) => e.type === 'break' && e.kind === 'curb')).toBe(true);
    expect(ds.surfaceAt(curb.x, curb.y).kind).toBe('road');
  });
});

describe('dynamic props', () => {
  const R = 80;
  const at = (deg: number, lat: number) => {
    const a = (deg * Math.PI) / 180;
    return { x: (R + lat) * Math.cos(a), y: (R + lat) * Math.sin(a), tx: -Math.sin(a), ty: Math.cos(a), a };
  };
  const coneP = at(-20, 0), barrelP = at(40, 0), treeP = at(100, 6 + D.wallOffset + 3);
  const props: TrackDef['props'] = [
    { type: 'cone', x: coneP.x, y: coneP.y, angle: 0 },
    { type: 'barrel', x: barrelP.x, y: barrelP.y, angle: 0 },
    { type: 'tree', x: treeP.x, y: treeP.y, angle: 0 },
  ];
  /** car approaching a point along the track tangent, starting `back` metres before it */
  const carTowards = (pw: PhysicsWorld, p: ReturnType<typeof at>, back: number, v: number): planck.Body => {
    const car = makeCar(pw, p.x - p.tx * back, p.y - p.ty * back, p.tx * v, p.ty * v);
    car.setTransform({ x: p.x - p.tx * back, y: p.y - p.ty * back }, p.a + Math.PI / 2);
    car.setLinearVelocity({ x: p.tx * v, y: p.ty * v });
    return car;
  };
  it('a car nudging a cone moves it (syncDynamic) without breaking it; a fast hit breaks it', () => {
    const { pw, ds } = setup(circleDef(R, props));
    wireCarHits(pw, ds);
    const cone = ds.states.find((s) => s.propType === 'cone')!;
    expect(ds.bodyOf(cone.id)!.isAwake()).toBe(false);
    carTowards(pw, coneP, 8, 4);
    const evs: SimEvent[] = [];
    for (let i = 0; i < 300; i++) { pw.step(); ds.flush(evs); ds.syncDynamic(); }
    expect(cone.broken).toBe(false);
    expect(Math.hypot(cone.x - coneP.x, cone.y - coneP.y)).toBeGreaterThan(0.5);
    expect(cone.dynamic).toBe(true);
    // fast hit on a fresh system: breaks
    const b = setup(circleDef(R, props));
    wireCarHits(b.pw, b.ds);
    const cone2 = b.ds.states.find((s) => s.propType === 'cone')!;
    carTowards(b.pw, coneP, 20, 22);
    const ev2: SimEvent[] = [];
    for (let i = 0; i < 120; i++) { b.pw.step(); b.ds.flush(ev2); }
    expect(cone2.broken).toBe(true);
    expect(ev2.some((e) => e.type === 'break' && e.kind === 'prop' && e.propType === 'cone')).toBe(true);
  });
  it('a knocked barrel slides, damps and goes back to sleep', () => {
    const { pw, ds } = setup(circleDef(R, props));
    const barrel = ds.states.find((s) => s.propType === 'barrel')!;
    const body = ds.bodyOf(barrel.id)!;
    body.setLinearVelocity({ x: barrelP.tx * 6, y: barrelP.ty * 6 });
    body.setAwake(true);
    ds.syncDynamic();
    expect(Math.hypot(barrel.vx!, barrel.vy!)).toBeGreaterThan(5);
    for (let i = 0; i < 1500; i++) pw.step();
    ds.syncDynamic();
    expect(Math.hypot(barrel.x - barrelP.x, barrel.y - barrelP.y)).toBeGreaterThan(1);
    expect(Math.hypot(barrel.vx ?? 0, barrel.vy ?? 0)).toBeLessThan(0.05);
  });
  it('a barrel thrown into a wall breaks on its own (prop <-> wall contacts are recorded by the system)', () => {
    const wallLat = 6 + D.wallOffset;
    const start = at(0, wallLat - 3);
    const p: TrackDef['props'] = [{ type: 'barrel', x: start.x, y: start.y, angle: 0 }];
    const { pw, ds } = setup(circleDef(R, p));
    const barrel = ds.states.find((s) => s.propType === 'barrel')!;
    ds.bodyOf(barrel.id)!.setLinearVelocity({ x: 28, y: 0 });
    const ev: SimEvent[] = [];
    for (let i = 0; i < 90; i++) { pw.step(); ds.flush(ev); }
    expect(barrel.broken).toBe(true);
    expect(ev.some((e) => e.type === 'break' && e.kind === 'prop')).toBe(true);
    expect(ds.bodyOf(barrel.id)).toBeNull();
  });
  it('a static tree survives a gentle bump and falls to a hard crash', () => {
    const { pw, ds } = setup(circleDef(R, props));
    wireCarHits(pw, ds);
    const tree = ds.states.find((s) => s.propType === 'tree')!;
    ds.recordHit(tree.id, D.props.tree.threshold - 1, 0, 0, 3, 0);
    ds.flush([]);
    expect(tree.hp).toBe(tree.maxHp);
    // the tree sits outside the wall: break the wall segment in front of it first, then drive through
    const walls = ds.states.filter((s) => s.kind === 'wall' || s.kind === 'guardrail');
    const gap = walls.filter((w) => Math.hypot(w.x - treeP.x, w.y - treeP.y) < 6);
    for (const w of gap) ds.recordHit(w.id, 1e6, 0, 0, 0, 0);
    for (let i = 0; i < 4; i++) { ds.flush([]); pw.step(); }
    const dir = { x: Math.cos(treeP.a), y: Math.sin(treeP.a) };
    const car = makeCar(pw, dir.x * (R + 6), dir.y * (R + 6), dir.x * 30, dir.y * 30);
    car.setTransform({ x: dir.x * (R + 6), y: dir.y * (R + 6) }, treeP.a);
    car.setLinearVelocity({ x: dir.x * 30, y: dir.y * 30 });
    const ev: SimEvent[] = [];
    for (let i = 0; i < 90; i++) { pw.step(); ds.flush(ev); }
    expect(tree.broken).toBe(true);
  });
});

describe('performance', () => {
  it('a full track of bodies steps well under the 4 ms budget when idle', () => {
    const { pw } = setup(TRACKS[1]);
    for (let i = 0; i < 20; i++) pw.step();
    const t0 = performance.now();
    for (let i = 0; i < 120; i++) pw.step();
    expect((performance.now() - t0) / 120).toBeLessThan(CONFIG.physics.stepBudgetMs);
  });
});

describe('no shortcut through walls facing another part of the track (audit X1)', () => {
  for (const def of TRACKS) {
    it(`${def.id}: between any two legs < ${D.lock.dist} m apart (> ${D.lock.arc} m of lap between them) one wall is indestructible`, () => {
      const { g, ds } = setup(def);
      const S = g.samples, n = S.length, L = g.length, half = g.def.width / 2;
      let pairs = 0;
      for (let i = 0; i < n; i += 4) {
        for (let j = 0; j < n; j += 4) {
          const ahead = (((S[j].s - S[i].s) % L) + L) % L;
          const edge = D.lock.arc + 2 * D.guardrail.segmentLength;   // the rule works per wall segment: skip the fuzzy boundary
          if (ahead < edge || ahead > L - edge) continue;
          const dx = S[j].x - S[i].x, dy = S[j].y - S[i].y;
          const d = Math.hypot(dx, dy);
          if (d > D.lock.dist) continue;
          // the walls the straight line from leg i to leg j passes through: at least one of them must be indestructible
          const crossed = new Set<number>();
          for (let k = 0; k <= 90; k++) {
            const nn = g.nearest(S[i].x + dx * k / 90, S[i].y + dy * k / 90);
            const a = Math.abs(nn.lateral) - (half + D.wallOffset);
            if (Math.abs(a) <= D.wall.thickness / 2 + 0.3) crossed.add(ds.wallAt(nn.s, nn.lateral > 0 ? 1 : -1));
          }
          pairs++;
          expect(crossed.size).toBeGreaterThan(0);
          expect([...crossed].some((w) => ds.isLocked(w)), `${def.id} s ${S[i].s.toFixed(0)} <-> ${S[j].s.toFixed(0)} (${d.toFixed(1)} m)`).toBe(true);
        }
      }
      if (def.id === 't3') expect(pairs).toBeGreaterThan(0);
    }, 60000);
  }

  it('a locked wall takes no damage from any hit; the other side of the same gap stays breakable', () => {
    const { ds } = setup(TRACKS[2]);
    const locked = ds.states.find((s) => (s.kind === 'wall' || s.kind === 'guardrail') && ds.isLocked(s.id))!;
    expect(locked).toBeDefined();
    ds.recordHit(locked.id, 1e7, locked.x, locked.y, 30, 0);
    ds.recordScrape(locked.id, 40, 1, 30, 0);
    const ev: SimEvent[] = [];
    ds.flush(ev);
    expect(locked.hp).toBe(locked.maxHp);
    expect(locked.broken).toBe(false);
    const walls = ds.states.filter((s) => s.kind === 'wall' || s.kind === 'guardrail');
    expect(walls.filter((s) => ds.isLocked(s.id)).length).toBeLessThan(walls.length * 0.3);
  });
});
