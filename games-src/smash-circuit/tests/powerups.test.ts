import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { EN, RU } from '../src/i18n';
import { AiItemUser, scanSurroundings, type Surroundings } from '../src/sim/aiItems';
import { CarBuffs } from '../src/sim/buffs';
import { baseStats, NO_DAMAGE } from '../src/sim/carModel';
import { createZoneHp } from '../src/sim/damage';
import { rollItem } from '../src/sim/powerups';
import { makeRng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import { planItems } from '../src/track/items';
import { buildTrackGeometry } from '../src/track/spline';
import { TRACKS } from '../src/track/tracks';
import { ITEMS, type CarSetup, type CarState, type ItemType, type SimEvent, type TrackGeometry } from '../src/types';

const DT = 1 / 60;
const I = CONFIG.items;
const GEOMS = TRACKS.map((t) => buildTrackGeometry(t));

function player(): CarSetup { return { id: 0, isPlayer: true, name: 'p', colorIndex: 0, stats: baseStats() }; }
function ai(id: number, skill = 0.8): CarSetup {
  return { id, isPlayer: false, name: 'a' + id, colorIndex: id, stats: baseStats(), ai: { skill, aggression: 0.3, laneOffset: 0, mistakeRate: 0 } };
}

/** Sim that is already racing (countdown done). */
function racing(trackIdx: number, cars: CarSetup[], seed = 1): { sim: Sim; events: SimEvent[]; run(sec: number): void; until(f: () => boolean, maxSec: number): boolean } {
  const sim = new Sim({ track: TRACKS[trackIdx], cars, seed });
  const events: SimEvent[] = [];
  const run = (sec: number): void => {
    for (let i = 0, n = Math.round(sec / DT); i < n; i++) { sim.update(DT); events.push(...sim.drainEvents()); }
  };
  while (sim.race.phase === 'countdown') { sim.update(DT); events.push(...sim.drainEvents()); }
  const until = (f: () => boolean, maxSec: number): boolean => {
    for (let i = 0, n = Math.round(maxSec / DT); i < n; i++) { sim.update(DT); events.push(...sim.drainEvents()); if (f()) return true; }
    return false;
  };
  return { sim, events, run, until };
}

/** Start of the calmest stretch of the loop (smallest worst curvature over 45 m behind .. 110 m ahead); the long start straight on every track. */
function calmS(g: TrackGeometry): number {
  let best = 1, bs = 0;
  for (let s = 0; s < g.length; s += 5) {
    let w = 0;
    for (let d = -45; d <= 110; d += 5) w = Math.max(w, Math.abs(g.sampleAt(s + d).curvature));
    if (w < best) { best = w; bs = s; }
  }
  return bs;
}

/** Put car `i` at (x, y) facing `a`, rolling at v m/s along its nose, and sync the public state. */
function place(sim: Sim, i: number, x: number, y: number, a: number, v: number): void {
  const c = sim.simCars[i];
  c.reset(x, y, a);
  c.body.setLinearVelocity({ x: Math.cos(a) * v, y: Math.sin(a) * v });
  const st = sim.cars[i];
  st.x = x; st.y = y; st.angle = a; st.vx = Math.cos(a) * v; st.vy = Math.sin(a) * v; st.speed = v;
}

describe('item layout (planItems)', () => {
  for (const tr of TRACKS) {
    it(`${tr.id}: 2-4 pads on the road, away from the start line and each other; box rows on calm road`, () => {
      const g = GEOMS[TRACKS.indexOf(tr)];
      const lay = planItems(g);
      expect(lay.pads.length).toBeGreaterThanOrEqual(2);
      expect(lay.pads.length).toBeLessThanOrEqual(4);
      for (const p of lay.pads) {
        expect(Math.abs(g.nearest(p.x, p.y).lateral)).toBeLessThan(0.5);
        const d = Math.min(p.s, g.length - p.s);
        expect(d).toBeGreaterThanOrEqual(I.pad.minFromLine - 0.5);
      }
      for (let i = 0; i < lay.pads.length; i++) for (let j = i + 1; j < lay.pads.length; j++) {
        const d = Math.abs(lay.pads[i].s - lay.pads[j].s);
        expect(Math.min(d, g.length - d)).toBeGreaterThanOrEqual(I.pad.minSpacing - 0.5);
      }
      // boxes: whole rows of perRow, all inside the road, none just after the line
      expect(lay.boxes.length).toBeGreaterThanOrEqual(2 * I.box.perRow);
      expect(lay.boxes.length % I.box.perRow).toBe(0);
      for (const b of lay.boxes) {
        expect(Math.abs(g.nearest(b.x, b.y).lateral)).toBeLessThan(g.def.width / 2);
        expect(Math.min(b.s, g.length - b.s)).toBeGreaterThanOrEqual(I.box.minFromLine - 0.5);
      }
    });
  }
  it('is deterministic', () => {
    expect(planItems(GEOMS[2])).toEqual(planItems(GEOMS[2]));
  });
  it('every track gets pads in the sim and the ISim exposes them', () => {
    for (let i = 0; i < TRACKS.length; i++) {
      const sim = new Sim({ track: TRACKS[i], cars: [player()], seed: 1 });
      expect(sim.pads!.length).toBeGreaterThanOrEqual(2);
      expect(sim.boxes!.length).toBeGreaterThan(0);
      expect(sim.oils!.length).toBe(I.oil.max);
    }
  });
  it('powerUps: false removes pads and boxes', () => {
    const sim = new Sim({ track: TRACKS[0], cars: [player()], seed: 1, powerUps: false });
    expect(sim.pads!.length).toBe(0);
    expect(sim.boxes!.length).toBe(0);
  });
});

describe('boost pad', () => {
  it('speeds the car up, emits a boost event, shows boostT, and only fires once per pass (cooldown)', () => {
    const r = racing(0, [player()]);
    const pad = r.sim.pads![0];
    place(r.sim, 0, pad.x - Math.cos(pad.angle) * 6, pad.y - Math.sin(pad.angle) * 6, pad.angle, 20);
    r.events.length = 0;
    r.run(0.5);
    const boosts = r.events.filter((e) => e.type === 'boost' && e.carId === 0 && e.source === 'pad');
    expect(boosts.length).toBe(1);
    expect(r.sim.cars[0].speed).toBeGreaterThan(24);              // 20 m/s + the kick
    expect((r.sim.cars[0].boostT ?? 0)).toBeGreaterThan(0);
    // the strip adds speed beyond what the same car reaches without it
    const ref = racing(0, [player()]);
    const sp = ref.sim.pads![0];
    place(ref.sim, 0, sp.x - Math.cos(sp.angle) * 6 + 40 * Math.cos(sp.angle + 1.57), sp.y - Math.sin(sp.angle) * 6 + 40 * Math.sin(sp.angle + 1.57), sp.angle, 20);
    ref.run(0.5);
    expect(r.sim.cars[0].speed).toBeGreaterThan(ref.sim.cars[0].speed + 3);
  });

  it('the boost ends: boostT runs out after CONFIG.items.pad.time', () => {
    const r = racing(1, [player()]);
    const pad = r.sim.pads![0];
    place(r.sim, 0, pad.x, pad.y, pad.angle, 25);
    r.run(0.2);
    expect(r.sim.cars[0].boostT ?? 0).toBeGreaterThan(0);
    place(r.sim, 0, pad.x + 80, pad.y + 80, pad.angle + 3, 0);   // out of the way
    r.run(I.pad.time + 0.3);
    expect(r.sim.cars[0].boostT ?? 0).toBe(0);
  });

  it('does nothing when driving against the arrows or before the race starts', () => {
    const r = racing(0, [player()]);
    const pad = r.sim.pads![0];
    place(r.sim, 0, pad.x + Math.cos(pad.angle) * 6, pad.y + Math.sin(pad.angle) * 6, pad.angle + Math.PI, 20);
    r.events.length = 0;
    r.run(0.6);
    expect(r.events.some((e) => e.type === 'boost')).toBe(false);

    const cd = new Sim({ track: TRACKS[0], cars: [player()], seed: 1 });
    const p0 = cd.pads![0];
    place(cd, 0, p0.x, p0.y, p0.angle, 20);
    cd.update(DT); cd.update(DT);
    expect(cd.drainEvents().some((e) => e.type === 'boost')).toBe(false);
  });

  it('the boost stack multiplies but is capped', () => {
    const b = new CarBuffs();
    b.padT = 1;
    expect(b.powerMul).toBeCloseTo(I.pad.powerMul);
    expect(b.ceilMul).toBeCloseTo(I.pad.ceilMul);
    b.nitroT = 1;
    expect(b.powerMul).toBeLessThanOrEqual(I.caps.power + 1e-9);
    expect(b.ceilMul).toBeLessThanOrEqual(I.caps.ceil + 1e-9);
    expect(b.powerMul).toBeGreaterThan(I.nitro.powerMul);
  });
});

describe('item boxes', () => {
  it('a car drives through a box and gets an item; the box respawns after ~8 s; a full slot ignores boxes', () => {
    const r = racing(0, [player()]);
    const box = r.sim.boxes![0];
    const st = r.sim.cars[0];
    expect(st.item ?? null).toBeNull();
    place(r.sim, 0, box.x - 3, box.y, 0, 0);
    r.sim.simCars[0].reset(box.x, box.y, 0);
    r.events.length = 0;
    r.run(0.1);
    expect(st.item).toBeTruthy();
    expect(ITEMS).toContain(st.item);
    expect(box.ready).toBe(false);
    const pick = r.events.find((e) => e.type === 'pickup' && e.carId === 0);
    expect(pick).toBeTruthy();
    // wait out the respawn timer (car parked away from every box)
    place(r.sim, 0, box.x + 60, box.y + 60, 0, 0);
    r.run(I.box.respawn - 1);
    expect(box.ready).toBe(false);
    r.run(1.3);
    expect(box.ready).toBe(true);
    // the slot is still full: driving through the ready box changes nothing
    const held = st.item;
    r.sim.simCars[0].reset(box.x, box.y, 0);
    r.run(0.1);
    expect(box.ready).toBe(true);
    expect(st.item).toBe(held);
  });

  it('respawn time is about 8 s by config', () => {
    expect(I.box.respawn).toBeGreaterThanOrEqual(7);
    expect(I.box.respawn).toBeLessThanOrEqual(9);
  });
});

describe('item roll (rubber banding)', () => {
  function freq(place: number, health: number): Record<ItemType, number> {
    const rnd = makeRng(7 + place);
    const f: Record<ItemType, number> = { nitro: 0, shield: 0, repair: 0, oil: 0, shockwave: 0 };
    const N = 20000;
    for (let i = 0; i < N; i++) f[rollItem(place, health, rnd)] += 1 / N;
    return f;
  }
  it('trailing cars get the stronger tools: more Shockwave, fewer Ram shields than the leader', () => {
    const lead = freq(1, 0.7), back = freq(8, 0.7);
    expect(back.shockwave).toBeGreaterThan(lead.shockwave * 3);
    expect(back.shield).toBeLessThan(lead.shield);
    expect(freq(5, 0.7).shockwave).toBeGreaterThan(lead.shockwave);
  });
  it('every item can drop; repair is never rolled for a healthy car and is favoured for a hurt one', () => {
    const all = freq(4, 0.7);
    for (const it of ITEMS) expect(all[it], it).toBeGreaterThan(0.02);
    expect(freq(4, 1).repair).toBe(0);
    expect(freq(4, 0.3).repair).toBeGreaterThan(all.repair * 1.8);
  });
});

describe('items: effects', () => {
  it('Nitro: more acceleration for ~2 s, then it ends', () => {
    const run = (nitro: boolean): { v: number; t: number } => {
      const r = racing(1, [player()]);
      const t = r.sim.track.sampleAt(calmS(r.sim.track));
      place(r.sim, 0, t.x, t.y, Math.atan2(t.ty, t.tx), 22);
      r.sim.cars[0].item = nitro ? 'nitro' : null;
      if (nitro) expect(r.sim.useItem()).toBe(true);
      r.sim.setPlayerInput({ throttle: 1, brake: 0, steer: 0, handbrake: false });
      r.run(1.5);
      return { v: r.sim.cars[0].speed, t: r.sim.cars[0].nitroT ?? 0 };
    };
    const a = run(true), b = run(false);
    expect(a.v).toBeGreaterThan(b.v + 3);
    expect(a.t).toBeGreaterThan(0);
    const r = racing(1, [player()]);
    const t = r.sim.track.sampleAt(calmS(r.sim.track));
    place(r.sim, 0, t.x, t.y, Math.atan2(t.ty, t.tx), 22);
    r.sim.cars[0].item = 'nitro';
    r.sim.useItem();
    expect(r.sim.cars[0].item).toBeNull();
    r.run(I.nitro.time + 0.2);
    expect(r.sim.cars[0].nitroT ?? 0).toBe(0);
  });

  it('Ram shield: lasts ~5 s, makes the car heavier and takes a fraction of the crash damage', () => {
    const crash = (shield: boolean): { loss: number; mass: number; left: number } => {
      const r = racing(0, [player()]);
      const sim = r.sim, c = sim.cars[0];
      let wall = sim.destructibles.find((d) => d.kind === 'wall' || d.kind === 'guardrail')!;
      let bd = 1e9;
      for (const d of sim.destructibles) {
        if ((d.kind !== 'wall' && d.kind !== 'guardrail') || d.broken) continue;
        const n = sim.track.nearest(d.x, d.y);
        const dist = Math.abs(n.s - 300);
        if (dist < bd) { bd = dist; wall = d; }
      }
      const n = sim.track.nearest(wall.x, wall.y);
      const s = sim.track.sampleAt(n.s);
      let nx = s.x - wall.x, ny = s.y - wall.y; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
      place(sim, 0, wall.x + nx * 14, wall.y + ny * 14, Math.atan2(-ny, -nx), 26);
      if (shield) { c.item = 'shield'; sim.useItem(); }
      const mass = sim.simCars[0].body.getMass();
      r.run(1.6);
      return { loss: 1 - c.health, mass, left: c.shieldT ?? 0 };
    };
    const plain = crash(false), shielded = crash(true);
    expect(plain.loss).toBeGreaterThan(0.05);
    expect(shielded.loss).toBeLessThan(plain.loss * 0.6);
    expect(shielded.mass).toBeGreaterThan(plain.mass * (I.shield.massMul - 0.2));
    expect(shielded.left).toBeGreaterThan(I.shield.time - 1.8);
    // it runs out, and the mass goes back
    const r = racing(0, [player()]);
    const base = r.sim.simCars[0].body.getMass();
    r.sim.cars[0].item = 'shield';
    r.sim.useItem();
    expect(r.sim.simCars[0].body.getMass()).toBeGreaterThan(base * 1.8);
    place(r.sim, 0, r.sim.cars[0].x, r.sim.cars[0].y, 0, 0);
    r.run(I.shield.time + 0.3);
    expect(r.sim.cars[0].shieldT ?? 0).toBe(0);
    expect(r.sim.simCars[0].body.getMass()).toBeCloseTo(base, 1);
  });

  it('Ram shield smashes walls: breaks a wall at a speed that stops a plain car', () => {
    const hit = (shield: boolean): boolean => {
      const r = racing(0, [player()]);
      const sim = r.sim;
      const wall = sim.destructibles.find((d) => d.kind === 'guardrail')!;
      const n = sim.track.nearest(wall.x, wall.y);
      const s = sim.track.sampleAt(n.s);
      let nx = s.x - wall.x, ny = s.y - wall.y; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
      place(sim, 0, wall.x + nx * 10, wall.y + ny * 10, Math.atan2(-ny, -nx), 7.5);   // 27 km/h: below what breaks a plain car's way through
      if (shield) { sim.cars[0].item = 'shield'; sim.useItem(); }
      r.run(1.2);
      return wall.broken || wall.crack > 0.8;
    };
    expect(hit(true)).toBe(true);
    expect(hit(false)).toBe(false);
  });

  it('Repair kit: heals every damaged zone by half of what is missing (at least the minimum), keeps lost parts lost', () => {
    const r = racing(0, [player()]);
    const c = r.sim.cars[0];
    c.hp.front = 10; c.hp.engine = 40; c.hp.left = 90; c.hp.wheelFL = 0;
    c.item = 'repair';
    const before = { ...c.hp };
    const parts = c.detachedParts.length;
    r.events.length = 0;
    expect(r.sim.useItem()).toBe(true);
    r.run(0.05);
    expect(c.hp.front).toBeCloseTo(before.front + Math.max(I.repair.minHp, (100 - before.front) * I.repair.frac), 0);
    expect(c.hp.engine).toBeCloseTo(before.engine + Math.max(I.repair.minHp, (100 - before.engine) * I.repair.frac), 0);
    expect(c.hp.left).toBeCloseTo(100, 0);                 // +25 minimum overshoots: capped at max
    expect(c.hp.wheelFL).toBeGreaterThanOrEqual(I.repair.minHp - 1);
    expect(c.hp.rear).toBe(before.rear);
    expect(c.detachedParts.length).toBeGreaterThanOrEqual(parts);
    expect(r.events.some((e) => e.type === 'repair' && e.carId === 0)).toBe(true);
  });

  it('Oil slick: drops behind the car, spins other cars, spares its owner at first, and is spent after a couple of victims', () => {
    const r = racing(0, [player(), ai(1), ai(2), ai(3)]);
    const sim = r.sim;
    const t = sim.track.sampleAt(400);
    const a = Math.atan2(t.ty, t.tx);
    // park the AI cars far away so they do not interfere
    for (let i = 1; i <= 3; i++) place(sim, i, t.x + 300, t.y + 300 + i * 20, 0, 0);
    place(sim, 0, t.x, t.y, a, 0);
    sim.cars[0].item = 'oil';
    sim.useItem();
    const slick = sim.oils!.find((o) => o.active)!;
    expect(slick).toBeTruthy();
    const back = (slick.x - t.x) * Math.cos(a) + (slick.y - t.y) * Math.sin(a);
    expect(back).toBeLessThan(-2);
    // owner standing on it is spared for the first moments
    place(sim, 0, slick.x, slick.y, a, 5);
    r.events.length = 0;
    r.run(0.3);
    expect(r.events.some((e) => e.type === 'oilSpin' && e.carId === 0)).toBe(false);
    place(sim, 0, t.x + 200, t.y + 200, a, 0);
    // a rival rolling over it spins out (a full turn of the nose)
    place(sim, 1, slick.x - Math.cos(a) * 4, slick.y - Math.sin(a) * 4, a, 24);
    r.events.length = 0;
    let maxYaw = 0;
    for (let i = 0; i < 60; i++) { sim.update(DT); r.events.push(...sim.drainEvents()); maxYaw = Math.max(maxYaw, Math.abs(sim.simCars[1].body.getAngularVelocity())); }
    expect(r.events.some((e) => e.type === 'oilSpin' && e.carId === 1)).toBe(true);
    expect(maxYaw).toBeGreaterThan(8);
    // second and third victims: the slick is gone after maxHits
    for (const id of [2, 3]) {
      place(sim, id, slick.x - Math.cos(a) * 3, slick.y - Math.sin(a) * 3, a, 20);
      r.run(0.35);
    }
    expect(slick.active && slick.hits < I.oil.maxHits).toBe(false);
    r.run(1);
    expect(slick.active).toBe(false);
  });

  it('Oil slick expires by itself', () => {
    const r = racing(0, [player()]);
    r.sim.cars[0].item = 'oil';
    r.sim.useItem();
    expect(r.sim.oils!.some((o) => o.active)).toBe(true);
    place(r.sim, 0, r.sim.cars[0].x + 80, r.sim.cars[0].y + 80, 0, 0);
    r.run(I.oil.time + 0.5);
    expect(r.sim.oils!.some((o) => o.active)).toBe(false);
  });

  it('Shockwave: pushes nearby cars away (never the user), cancels their Nitro, hurts them, and a Ram shield absorbs it', () => {
    const r = racing(0, [player(), ai(1), ai(2), ai(3)]);
    const sim = r.sim;
    const t = sim.track.sampleAt(300);
    const a = Math.atan2(t.ty, t.tx);
    place(sim, 0, t.x, t.y, a, 0);
    place(sim, 1, t.x + t.nx * 4, t.y + t.ny * 4, a, 0);          // 4 m beside: pushed outwards
    place(sim, 2, t.x - t.nx * 5, t.y - t.ny * 5, a, 0);          // 5 m on the other side, shielded
    place(sim, 3, t.x + 150, t.y + 150, a, 0);                    // far away
    sim.cars[1].item = null;
    sim.simCars[1].buffs.nitroT = 1.5;
    sim.simCars[2].buffs.shieldT = 3;
    const v1 = { ...sim.simCars[1].body.getLinearVelocity() };
    const v3 = { ...sim.simCars[3].body.getLinearVelocity() };
    sim.cars[0].item = 'shockwave';
    r.events.length = 0;
    sim.useItem();
    r.events.push(...sim.drainEvents());
    const dv = sim.simCars[1].body.getLinearVelocity();
    const pushed = (dv.x - v1.x) * t.nx + (dv.y - v1.y) * t.ny;
    expect(pushed).toBeGreaterThan(I.shock.push * (1 - 4 / I.shock.radius) * 0.9);
    expect(sim.simCars[1].buffs.nitroT).toBe(0);
    // the shielded car is not shoved, its bubble pops
    expect(sim.simCars[2].buffs.shieldT).toBe(0);
    expect(r.events.some((e) => e.type === 'shieldPop' && e.carId === 2)).toBe(true);
    // the far car and the user are untouched
    expect(sim.simCars[3].body.getLinearVelocity().x).toBeCloseTo(v3.x, 6);
    expect(Math.hypot(sim.simCars[0].body.getLinearVelocity().x, sim.simCars[0].body.getLinearVelocity().y)).toBeLessThan(1e-6);
    // damage lands when the step is applied
    r.run(0.05);
    expect(sim.cars[1].health).toBeLessThan(1);
    expect(sim.cars[2].health).toBe(1);
    expect(sim.cars[3].health).toBe(1);
    expect(r.events.some((e) => e.type === 'itemUse' && e.item === 'shockwave' && e.carId === 0)).toBe(true);
  });

  it('Shockwave breaks loose props and guardrails within its range', () => {
    const r = racing(0, [player()]);
    const sim = r.sim;
    const prop = sim.destructibles.find((d) => d.kind === 'prop' && !d.broken)!;
    place(sim, 0, prop.x + 3, prop.y, 0, 0);
    sim.cars[0].item = 'shockwave';
    sim.useItem();
    r.run(0.3);
    const gone = sim.destructibles.filter((d) => d.kind === 'prop' && Math.hypot(d.x - prop.x, d.y - prop.y) < I.shock.propRadius - 3);
    expect(gone.some((d) => d.broken)).toBe(true);
  });

  it('using an item needs one in the slot, and the race must be live', () => {
    const r = racing(0, [player()]);
    expect(r.sim.useItem()).toBe(false);
    const cd = new Sim({ track: TRACKS[0], cars: [player()], seed: 1 });
    cd.cars[0].item = 'nitro';
    expect(cd.useItem()).toBe(false);
    expect(cd.cars[0].item).toBe('nitro');
  });
});

describe('AI: picks up and uses items', () => {
  it('an all-AI race hands out items and the AI uses them (pickups and uses of several kinds)', () => {
    const cars: CarSetup[] = [];
    for (let i = 0; i < 8; i++) cars.push(ai(i, 0.95 - i * 0.05));
    const r = racing(0, cars, 5);
    r.run(100);
    const picks = r.events.filter((e) => e.type === 'pickup');
    const uses = r.events.filter((e) => e.type === 'itemUse');
    expect(picks.length).toBeGreaterThanOrEqual(6);
    expect(uses.length).toBeGreaterThanOrEqual(4);
    expect(new Set(uses.map((u) => (u as Extract<SimEvent, { type: 'itemUse' }>).item)).size).toBeGreaterThanOrEqual(2);
    expect(new Set(uses.map((u) => u.type === 'itemUse' ? u.carId : -1)).size).toBeGreaterThanOrEqual(3);
    // nobody sits on an item forever
    for (const c of r.sim.cars) expect(c.item === null || c.item === undefined || ITEMS.includes(c.item)).toBe(true);
  }, 120000);

  it('a full AI race with items on all tracks finishes with unique places and (almost) no recoveries', () => {
    for (let ti = 0; ti < TRACKS.length; ti++) {
      const cars: CarSetup[] = [];
      for (let i = 0; i < 8; i++) cars.push(ai(i, 0.95 - i * 0.05));
      const r = racing(ti, cars, 11 + ti);
      r.until(() => r.sim.race.phase === 'finished', 400);
      expect(r.sim.race.phase, TRACKS[ti].id).toBe('finished');
      expect(new Set(r.sim.cars.map((c) => c.place)).size).toBe(8);
      expect(r.sim.respawns, TRACKS[ti].id).toBeLessThanOrEqual(2);
    }
  }, 300000);
});

describe('AI item decisions (AiItemUser)', () => {
  const g: TrackGeometry = GEOMS[1];   // Dust Canyon: has a long, dead-straight start/finish stretch
  function car(s: number, lat: number, speed: number, over: Partial<CarState> = {}): CarState {
    const t = g.sampleAt(s), a = Math.atan2(t.ty, t.tx);
    return {
      id: 1, isPlayer: false, colorIndex: 0, name: 'x', x: t.x + t.nx * lat, y: t.y + t.ny * lat, angle: a,
      vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, angularVel: 0, speed, steer: 0, throttle: 1, brake: 0, handbrake: false, rpm: 0.4,
      drifting: false, slip: 0, hp: createZoneHp(100), zoneMaxHp: 100, health: 1, effects: { ...NO_DAMAGE }, detachedParts: [], wrecked: false,
      lap: 0, progress: s, place: 3, finished: false, finishTime: 0, lastLapTime: 0, bestLapTime: 0, onCurb: false, offRoad: false, ...over,
    };
  }
  const straightS = (): number => calmS(g);
  function bendS(): number {
    let best = 0, bk = 0;
    for (let s = 0; s < g.length; s += 2) { const k = Math.abs(g.sampleAt(s).curvature); if (k > bk) { bk = k; best = s; } }
    return best;
  }
  const decide = (u: AiItemUser, c: CarState, others: CarState[], raceTime = 30): boolean => u.update(2, c, others, g, g.nearest(c.x, c.y).s, raceTime);

  it('waits for its reaction time, and does nothing without an item', () => {
    const u = new AiItemUser(1, makeRng(3));
    const c = car(straightS(), 0, 35, { item: 'nitro' });
    expect(u.update(0.05, c, [], g, 0, 30)).toBe(false);   // just picked it up
    expect(decide(new AiItemUser(1, makeRng(3)), car(straightS(), 0, 35), [])).toBe(false);
  });

  it('Nitro: on a clear straight yes; with a rival right ahead or before a bend no (for a clever driver)', () => {
    const s = straightS();
    expect(decide(new AiItemUser(1, makeRng(1)), car(s, 0, 35, { item: 'nitro' }), [])).toBe(true);
    const blocker = car(s + 15, 0.5, 30, { id: 2 });
    expect(decide(new AiItemUser(1, makeRng(1)), car(s, 0, 35, { item: 'nitro' }), [blocker])).toBe(false);
    expect(decide(new AiItemUser(1, makeRng(1)), car(bendS() - 20, 0, 40, { item: 'nitro' }), [])).toBe(false);
  });

  it('Repair: a clever driver uses it when hurt, not when healthy; a careless one uses it as soon as it is scratched', () => {
    const s = straightS();
    expect(decide(new AiItemUser(1, makeRng(1)), car(s, 0, 30, { item: 'repair', health: 0.4 }), [])).toBe(true);
    expect(decide(new AiItemUser(1, makeRng(1)), car(s, 0, 30, { item: 'repair', health: 0.8 }), [])).toBe(false);
    expect(decide(new AiItemUser(0, makeRng(1)), car(s, 0, 30, { item: 'repair', health: 0.8 }), [])).toBe(true);
  });

  it('Ram shield: when a rival closes in from behind', () => {
    const s = straightS();
    const chaser = car(s - 7, 0, 40, { id: 2 });
    expect(decide(new AiItemUser(1, makeRng(1)), car(s, 0, 30, { item: 'shield' }), [chaser])).toBe(true);
    expect(decide(new AiItemUser(1, makeRng(1)), car(s, 0, 30, { item: 'shield' }), [])).toBe(false);
  });

  it('Oil: only with a single rival behind in the lane and a long straight; never on a bend', () => {
    const s = straightS();
    const behind = car(s - 12, 0.3, 34, { id: 2 });
    expect(decide(new AiItemUser(1, makeRng(1)), car(s, 0, 33, { item: 'oil' }), [behind])).toBe(true);
    expect(decide(new AiItemUser(1, makeRng(1)), car(s, 0, 33, { item: 'oil' }), [])).toBe(false);
    const pack = [behind, car(s - 14, 0.2, 34, { id: 3 }), car(s - 18, -0.3, 34, { id: 4 })];
    expect(decide(new AiItemUser(1, makeRng(1)), car(s, 0, 33, { item: 'oil' }), pack)).toBe(false);
    const b = bendS();
    expect(decide(new AiItemUser(1, makeRng(1)), car(b, 0, 33, { item: 'oil' }), [car(b - 12, 0.3, 34, { id: 2 })])).toBe(false);
  });

  it('Shockwave: two rivals close by, but never in the opening seconds of the race', () => {
    const s = straightS();
    const near = [car(s + 3, 2, 30, { id: 2 }), car(s - 2, -2.5, 30, { id: 3 })];
    expect(decide(new AiItemUser(1, makeRng(1)), car(s, 0, 30, { item: 'shockwave' }), near, 30)).toBe(true);
    expect(decide(new AiItemUser(1, makeRng(1)), car(s, 0, 30, { item: 'shockwave' }), near, 3)).toBe(false);
    expect(decide(new AiItemUser(1, makeRng(1)), car(s, 0, 30, { item: 'shockwave' }), [], 30)).toBe(false);
  });

  it('any item is used after maxHold seconds', () => {
    const s = straightS();
    const u = new AiItemUser(1, makeRng(1));
    const c = car(s, 0, 30, { item: 'nitro' });
    const blocker = car(s + 12, 0, 20, { id: 2 });
    expect(u.update(1, c, [blocker], g, g.nearest(c.x, c.y).s, 30)).toBe(false);
    for (let i = 0; i < I.ai.maxHold; i++) u.update(1, c, [blocker], g, g.nearest(c.x, c.y).s, 30);
    expect(u.update(1, c, [blocker], g, g.nearest(c.x, c.y).s, 30)).toBe(true);
  });

  it('scanSurroundings reads the neighbours in the car frame', () => {
    const s = straightS();
    const out: Surroundings = { nearCount: 0, alongside: false, chaser: false, blocker: false, aheadInLane: false, behindInLane: false, behindCount: 0 };
    scanSurroundings(car(s, 0, 30), [car(s + 4, 0.5, 20, { id: 2 }), car(s - 10, 0, 40, { id: 3 })], out);
    expect(out.blocker).toBe(true);
    expect(out.chaser).toBe(true);
    expect(out.aheadInLane).toBe(true);
    expect(out.behindInLane).toBe(true);
    expect(out.nearCount).toBe(1);
  });
});

describe('i18n and config', () => {
  it('every item has a name in both languages', () => {
    for (const it of ITEMS) {
      expect(EN['item.' + it], it).toBeTruthy();
      expect(RU['item.' + it], it).toBeTruthy();
    }
    for (const k of ['hud.itemTap', 'hud.itemHintKey', 'hud.itemHintTap']) { expect(EN[k]).toBeTruthy(); expect(RU[k]).toBeTruthy(); }
  });
  it('item roll weights cover every item for every position', () => {
    for (const row of I.weights) expect(row.w.length).toBe(ITEMS.length);
  });
});
