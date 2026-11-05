// Overkill cascade (audit X4): damage beyond what a piece had left is passed on to its neighbours, in a domino ripple.
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { baseStats } from '../src/sim/carModel';
import { DestructionSystem } from '../src/sim/destruction';
import { Sim } from '../src/sim/sim';
import { PhysicsWorld } from '../src/sim/world';
import { buildTrackGeometry } from '../src/track/spline';
import { TRACKS } from '../src/track/tracks';
import type { PropDef, SimEvent, TrackDef } from '../src/types';

const D = CONFIG.destruction;
const DT = CONFIG.physics.dt;

function circleDef(R: number, props: PropDef[] = [], width = 12): TrackDef {
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
  return { pw, g, ds: new DestructionSystem(pw, g) };
}

/** impulse (N*s) that does `dmg` hp to a wall / guardrail */
const impulseFor = (kind: 'wall' | 'guardrail', dmg: number): number => D[kind].threshold + dmg / D.impulseToDamage;

function settle(ds: DestructionSystem, seconds: number): SimEvent[] {
  const ev: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) ds.flush(ev);
  return ev;
}

function brokenIds(ds: DestructionSystem, kind: 'guardrail' | 'wall' | 'prop'): number[] {
  return ds.states.filter((s) => s.kind === kind && s.broken).map((s) => s.id);
}

/** A guardrail segment with free segments each way (circle R=140: gentle enough to be all guardrail) */
function pickRail(ds: DestructionSystem): number {
  const rails = ds.states.filter((s) => s.kind === 'guardrail');
  expect(rails.length).toBeGreaterThan(30);
  return rails[10].id;
}

describe('overkill cascade: walls and guardrails', () => {
  it('a hit that just breaks a segment opens one gap; a catastrophic one ripples down the barrier, bounded by depth', () => {
    const counts: number[] = [];
    for (const mult of [1.05, 2, 4, 8, 20, 60]) {
      const { ds } = setup(circleDef(140));
      const id = pickRail(ds);
      ds.recordHit(id, impulseFor('guardrail', D.guardrail.hp * mult), 0, 0, 20, 0);
      settle(ds, 1.5);
      counts.push(brokenIds(ds, 'guardrail').length);
    }
    expect(counts[0]).toBe(1);                                      // a tap-break: just the one piece
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);   // harder never opens less
    expect(counts[counts.length - 1]).toBeGreaterThan(counts[0]);   // and it really cascades
    expect(Math.max(...counts)).toBeLessThanOrEqual(1 + 2 * D.cascade.depth);
  });

  it('neighbours fall one after another (domino ripple) and the cascade is credited to the source piece', () => {
    const { ds } = setup(circleDef(140));
    const id = pickRail(ds);
    ds.recordHit(id, impulseFor('guardrail', D.guardrail.hp * 6), 0, 0, 20, 0);
    const first = settle(ds, DT * 2);
    expect(first.filter((e) => e.type === 'break').length).toBe(1);   // the first steps: only the piece that was hit
    expect(brokenIds(ds, 'guardrail')).toEqual([id]);
    settle(ds, D.cascade.delay * 1.6);
    const mid = brokenIds(ds, 'guardrail');
    expect(mid.length).toBeGreaterThan(1);                          // the first links went down ...
    settle(ds, 1.5);
    const all = brokenIds(ds, 'guardrail');
    expect(all.length).toBeGreaterThanOrEqual(mid.length);
    for (const b of all) if (b !== id) expect(ds.chainSource(b)).toBe(id);
    expect(ds.chainSource(id)).toBe(-1);
  });

  it('a locked (anti-shortcut) wall never takes part in a cascade', () => {
    const { ds } = setup(TRACKS[2]);                                // the hairpin track has locked segments
    const walls = ds.states.filter((s) => s.kind === 'wall' || s.kind === 'guardrail');
    let pair: [number, number] | null = null;
    for (let i = 0; i + 1 < walls.length && !pair; i++) {
      const a = walls[i].id, b = walls[i + 1].id;
      if (ds.isLocked(a) && !ds.isLocked(b) && b === a + 1) pair = [a, b];
    }
    expect(pair).not.toBeNull();
    const [locked, free] = pair as [number, number];
    const hp = ds.states[locked].hp;
    ds.recordHit(free, impulseFor(ds.states[free].kind as 'wall', ds.states[free].maxHp * 50), 0, 0, 20, 0);
    settle(ds, 2);
    expect(ds.states[free].broken).toBe(true);
    expect(ds.states[locked].broken).toBe(false);
    expect(ds.states[locked].hp).toBe(hp);
  });

  it('events stay bounded: an absurd impulse breaks at most 1 + 2 x depth segments, and at most maxBreaksPerStep per step', () => {
    const { ds } = setup(circleDef(140));
    const id = pickRail(ds);
    ds.recordHit(id, 1e9, 0, 0, 30, 0);
    let worst = 0, total = 0;
    for (let i = 0; i < Math.round(2 / DT); i++) {
      const ev: SimEvent[] = [];
      ds.flush(ev);
      const n = ev.filter((e) => e.type === 'break').length;
      worst = Math.max(worst, n); total += n;
    }
    expect(worst).toBeLessThanOrEqual(D.maxBreaksPerStep);
    expect(total).toBeLessThanOrEqual(1 + 2 * D.cascade.depth);
  });
});

describe('overkill cascade: props', () => {
  const crates = (n: number, gap: number): PropDef[] =>
    Array.from({ length: n }, (_, i) => ({ type: 'crate', x: -10 + i * gap, y: 0, angle: 0 }));
  const breakImp = D.props.crate.hp / (D.impulseToDamage * D.props.crate.dmgMul) + D.props.crate.threshold;

  const run = (impulse: number, n = 9, gap = 1.6): number[] => {
    const { ds } = setup(circleDef(80, crates(n, gap)));
    const ids = ds.states.filter((s) => s.kind === 'prop').map((s) => s.id);
    ds.recordHit(ids[0], impulse, -10, 0, 15, 0);
    settle(ds, 2);
    return brokenIds(ds, 'prop');
  };

  it('a crate smashed with overkill knocks over the crates beside it in a chain; a tap breaks only itself', () => {
    expect(run(breakImp * 1.02)).toHaveLength(1);
    const big = run(breakImp * 8);
    expect(big.length).toBeGreaterThan(2);
    expect(big.length).toBeLessThanOrEqual(1 + D.cascade.maxQueued);
    // the chain runs along the row: the broken ones are the first crates, no gaps
    const sorted = [...big].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBe(1);
    // monotonic in impulse
    expect(run(breakImp * 30).length).toBeGreaterThanOrEqual(big.length);
  });

  it('props further apart than propRadius are not reached', () => {
    expect(run(1e6, 3, D.cascade.propRadius + 2)).toHaveLength(1);
  });
});

describe('overkill cascade in the Sim: credit', () => {
  it('a segment knocked over by the cascade of a player-hit segment is credited to the player', () => {
    const sim = new Sim({ track: TRACKS[0], cars: [{ id: 0, isPlayer: true, name: 'p', colorIndex: 0, stats: baseStats() }], seed: 1 });
    const rails = sim.destructibles.filter((d) => d.kind === 'guardrail' && !sim.destruction.isLocked(d.id));
    const id = rails[20].id;
    // the contact callback sets lastHitBy; emulate it, then record a catastrophic hit on the piece
    (sim as unknown as { lastHitBy: Int32Array }).lastHitBy[id] = 0;
    sim.destruction.recordHit(id, impulseFor('guardrail', D.guardrail.hp * 10), 0, 0, 20, 0);
    for (let i = 0; i < 120; i++) sim.update(DT);
    const broke = sim.destructibles.filter((d) => d.broken && d.kind === 'guardrail').length;
    expect(broke).toBeGreaterThan(1);
    expect(sim.brokenByPlayer).toBe(broke);
  });
});
