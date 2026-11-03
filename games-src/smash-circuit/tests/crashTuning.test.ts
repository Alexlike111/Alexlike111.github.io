// Destruction / impact / AI-field tuning: guards the playability numbers that the critics measured.
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { makeOpponents } from '../src/meta/opponents';
import { baseStats } from '../src/sim/carModel';
import { Sim } from '../src/sim/sim';
import { TRACKS } from '../src/track/tracks';
import type { CarInput, CarSetup, SimEvent } from '../src/types';

const DT = CONFIG.physics.dt;
const IDLE: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };

function solo(trackId = 't1'): Sim {
  const t = TRACKS.find((x) => x.id === trackId)!;
  const p: CarSetup = { id: 0, isPlayer: true, name: 'p', colorIndex: 0, stats: baseStats() };
  const sim = new Sim({ track: t, cars: [p], seed: 1 });
  for (let i = 0; i < 120 * 4; i++) sim.update(DT);
  sim.drainEvents();
  return sim;
}

function straightS(sim: Sim, len = 40): number {
  const S = sim.track.samples;
  for (let i = 0; i < S.length; i++) {
    let ok = true;
    for (let k = 0; k < len; k++) if (Math.abs(S[(i + k) % S.length].curvature) > 0.002) { ok = false; break; }
    if (ok) return S[(i + len / 2) % S.length].s;
  }
  throw new Error('no straight');
}

function cornerS(sim: Sim): { s: number; k: number } {
  let best = 0, bs = 0;
  for (const s of sim.track.samples) if (Math.abs(s.curvature) > best) { best = Math.abs(s.curvature); bs = s.s; }
  return { s: bs, k: best };
}

function place(sim: Sim, s: number, lat: number, headingOff: number, v: number): void {
  const t = sim.track.sampleAt(s);
  const x = t.x + t.nx * lat, y = t.y + t.ny * lat;
  const a = Math.atan2(t.ty, t.tx) + headingOff;
  sim.simCars[0].reset(x, y, a);
  sim.simCars[0].body.setLinearVelocity({ x: Math.cos(a) * v, y: Math.sin(a) * v });
  const st = sim.cars[0];
  st.x = x; st.y = y; st.angle = a; st.vx = Math.cos(a) * v; st.vy = Math.sin(a) * v;
}

function run(sim: Sim, secs: number): SimEvent[] {
  sim.setPlayerInput(IDLE);
  const evs: SimEvent[] = [];
  for (let i = 0; i < Math.round(secs / DT); i++) { sim.update(DT); evs.push(...sim.drainEvents()); }
  return evs;
}

/** Drive head-on into the outer edge on a straight (guardrail) or in the sharpest corner (wall). */
function headOn(kmh: number, where: 'straight' | 'corner'): { breaks: string[]; strength: number } {
  const sim = solo();
  let s: number, side = -1;
  if (where === 'straight') s = straightS(sim);
  else { const c = cornerS(sim); s = c.s; side = c.k >= 0 ? -1 : 1; }
  place(sim, s, side * (sim.track.def.width / 2 - 1), side * (Math.PI / 2), kmh / 3.6);
  const evs = run(sim, 1.5);
  const imp = evs.filter((e) => e.type === 'impact') as Extract<SimEvent, { type: 'impact' }>[];
  return {
    breaks: (evs.filter((e) => e.type === 'break') as Extract<SimEvent, { type: 'break' }>[]).map((b) => b.kind),
    strength: imp.length ? Math.max(...imp.map((i) => i.strength)) : 0,
  };
}

describe('wall / guardrail destruction is reachable in normal play', () => {
  it('a perpendicular guardrail hit breaks it at ~50 km/h but not at a 15 km/h tap', () => {
    expect(headOn(15, 'straight').breaks).not.toContain('guardrail');
    expect(headOn(50, 'straight').breaks).toContain('guardrail');
  });

  it('a corner wall breaks at ~90 km/h, not at 25 km/h', () => {
    expect(headOn(25, 'corner').breaks).not.toContain('wall');
    expect(headOn(90, 'corner').breaks).toContain('wall');
  });

  it('config break thresholds sit in the intended speed windows (1200 N*s per m/s)', () => {
    const D = CONFIG.destruction;
    const kmh = (k: 'wall' | 'guardrail'): number => ((D[k].threshold + D[k].hp / D.impulseToDamage) / 1200) * 3.6;
    expect(kmh('guardrail')).toBeGreaterThan(25);
    expect(kmh('guardrail')).toBeLessThan(45);
    expect(kmh('wall')).toBeGreaterThan(40);
    expect(kmh('wall')).toBeLessThan(65);
  });

  it('sliding along a guardrail wears it down even with a tiny normal impulse (scrape damage)', () => {
    const sim = solo();
    const rail = sim.destructibles.find((d) => d.kind === 'guardrail')!;
    const hp0 = rail.hp;
    sim.destruction.recordScrape(rail.id, CONFIG.destruction.scrape.minSpeed * 0.5, DT, 0, 0);
    sim.destruction.flush([]);
    expect(rail.hp).toBe(hp0);                                   // too slow: no wear
    sim.destruction.recordScrape(rail.id, 28, DT, 0, 0);
    sim.destruction.flush([]);
    expect(rail.hp).toBeCloseTo(hp0 - 28 * DT * CONFIG.destruction.scrape.guardrail, 5);
    const curb = sim.destructibles.find((d) => d.kind === 'curb');
    if (curb) {
      const c0 = curb.hp;
      sim.destruction.recordScrape(curb.id, 28, DT, 0, 0);
      sim.destruction.flush([]);
      expect(curb.hp).toBe(c0);                                  // curbs are not scraped by walls logic
    }
  });

  it('a car pinned along a wall at speed (glancing, 25 deg, 140 km/h) leaves damage on the rail', () => {
    const sim = solo();
    place(sim, straightS(sim), sim.track.def.width / 2 - 1, (25 * Math.PI) / 180, 140 / 3.6);
    run(sim, 2);
    const worn = sim.destructibles.filter((d) => (d.kind === 'guardrail' || d.kind === 'wall') && (d.broken || d.crack > 0.05));
    expect(worn.length).toBeGreaterThan(0);
  });
});

describe('impact strength spans the speed range', () => {
  it('30, 60, 100 and 160 km/h head-on hits give clearly different, increasing strengths', () => {
    const s = [30, 60, 100, 160].map((k) => headOn(k, 'straight').strength);
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThan(s[i - 1] + 0.08);
    expect(s[0]).toBeGreaterThan(0.1);        // a tap is still audible
    expect(s[0]).toBeLessThan(0.45);
    expect(s[3]).toBeGreaterThan(0.85);       // a wreck is near the top
  });
});

describe('AI field is not predictable', () => {
  it('strength rank is independent of the car id: the strongest AI is not always the same id', () => {
    const strongest = new Set<number>();
    const weakest = new Set<number>();
    for (let seed = 1; seed <= 24; seed++) {
      const ai = makeOpponents(1, baseStats(), seed);
      const sorted = ai.slice().sort((a, b) => b.ai!.skill - a.ai!.skill);
      strongest.add(sorted[0].id);
      weakest.add(sorted[sorted.length - 1].id);
    }
    expect(strongest.size).toBeGreaterThanOrEqual(5);
    expect(weakest.size).toBeGreaterThanOrEqual(5);
  });

  it('still spans the configured skill range per track', () => {
    for (let ti = 0; ti < 3; ti++) {
      const sk = makeOpponents(ti, baseStats(), 5).map((c) => c.ai!.skill);
      const [lo, hi] = CONFIG.meta.opponents.skill[ti];
      const pad = CONFIG.meta.opponents.skillJitter / 2 + 1e-9;
      expect(Math.min(...sk)).toBeGreaterThanOrEqual(lo - pad);
      expect(Math.max(...sk)).toBeLessThanOrEqual(hi + pad);
      expect(Math.max(...sk) - Math.min(...sk)).toBeGreaterThan((hi - lo) * 0.6);
    }
  });

  it('the grid order of the AI does not follow skill', () => {
    let skillOrdered = 0;
    const seeds = 12;
    for (let seed = 1; seed <= seeds; seed++) {
      const cars = makeOpponents(1, baseStats(), seed);
      const sim = new Sim({ track: TRACKS[1], cars: [{ id: 0, isPlayer: true, name: 'p', colorIndex: 0, stats: baseStats() }, ...cars], seed });
      const byGrid = sim.cars.filter((c) => !c.isPlayer).sort((a, b) => a.place - b.place).map((c) => cars.find((o) => o.id === c.id)!.ai!.skill);
      if (byGrid.every((v, i) => i === 0 || byGrid[i - 1] >= v)) skillOrdered++;
    }
    expect(skillOrdered).toBe(0);
  });
});
