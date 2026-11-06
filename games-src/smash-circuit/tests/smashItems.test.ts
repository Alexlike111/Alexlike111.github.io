// Sim.takeSmashes(): every smash of the player comes with its position and pay (HUD floats at the object).
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { smashValue } from '../src/meta/economy';
import { baseStats } from '../src/sim/carModel';
import { Sim } from '../src/sim/sim';
import { TRACKS } from '../src/track/tracks';
import type { CarInput } from '../src/types';

const DT = CONFIG.physics.dt;
const IDLE: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };

describe('takeSmashes items', () => {
  it('lists each piece the player broke with its position and pay, then empties', () => {
    const sim = new Sim({ track: TRACKS[0], cars: [{ id: 0, isPlayer: true, name: 'p', colorIndex: 0, stats: baseStats() }], seed: 1 });
    for (let i = 0; i < 120 * 4; i++) sim.update(DT);
    sim.drainEvents();
    expect(sim.takeSmashes()).toEqual({ money: 0, count: 0, items: [] });

    const half = sim.track.def.width / 2;
    const w = sim.destructibles.filter((d) => d.kind === 'guardrail')[3];
    const nn = sim.track.nearest(w.x, w.y);
    const side = nn.lateral > 0 ? 1 : -1;
    const t = sim.track.sampleAt(nn.s - 20);
    const a = Math.atan2(t.ty, t.tx) + side * 90 * Math.PI / 180;
    const car = sim.simCars[0];
    car.reset(t.x + t.nx * side * (half - 3), t.y + t.ny * side * (half - 3), a);
    car.body.setLinearVelocity({ x: Math.cos(a) * 25, y: Math.sin(a) * 25 });
    sim.setPlayerInput(IDLE);
    const broken: { x: number; y: number }[] = [];
    for (let i = 0; i < 120; i++) {
      sim.update(DT);
      for (const e of sim.drainEvents()) if (e.type === 'break' && e.kind !== 'curb') broken.push({ x: e.x, y: e.y });
    }
    const sm = sim.takeSmashes();
    expect(sm.count).toBeGreaterThanOrEqual(1);
    expect(sm.items).toHaveLength(sm.count);
    expect(sm.items.reduce((n, i) => n + i.money, 0)).toBe(sm.money);
    for (const it of sm.items) {
      expect([smashValue('guardrail'), smashValue('road'), smashValue('wall')]).toContain(it.money);
      expect(broken.some((b) => Math.hypot(b.x - it.x, b.y - it.y) < 1e-6)).toBe(true);
    }
    expect(sim.takeSmashes()).toEqual({ money: 0, count: 0, items: [] });
  });
});
