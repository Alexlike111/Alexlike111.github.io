import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import {
  applyImpulseDamage, computeEffects, createZoneHp, missingHp, partsKnockedOff, partsToDetach, totalHealth, zoneForLocalPoint,
} from '../src/sim/damage';
import { ZONES } from '../src/types';
import type { ZoneId } from '../src/types';

const MAX = CONFIG.damage.zoneMaxHp;
const TH = CONFIG.damage.impulseThreshold;

describe('zones', () => {
  it('maps car-frame points to body zones', () => {
    expect(zoneForLocalPoint(2.1, 0)[0]).toBe('front');
    expect(zoneForLocalPoint(-2.1, 0)[0]).toBe('rear');
    expect(zoneForLocalPoint(0, 1)[0]).toBe('left');
    expect(zoneForLocalPoint(0, -1)[0]).toBe('right');
  });
  it('returns 1-2 distinct zones, wheels for corners, engine for central front', () => {
    for (let x = -2.1; x <= 2.1; x += 0.3) {
      for (let y = -1; y <= 1; y += 0.25) {
        const z = zoneForLocalPoint(x, y);
        expect(z.length).toBeGreaterThanOrEqual(1);
        expect(z.length).toBeLessThanOrEqual(2);
        expect(new Set(z).size).toBe(z.length);
      }
    }
    expect(zoneForLocalPoint(2.1, 0.9)).toEqual(['front', 'wheelFL']);
    expect(zoneForLocalPoint(2.1, -0.9)).toEqual(['front', 'wheelFR']);
    expect(zoneForLocalPoint(2.1, 0)).toEqual(['front', 'engine']);
    expect(zoneForLocalPoint(-1.5, 1)).toEqual(['left', 'wheelRL']);
    expect(zoneForLocalPoint(-2.1, -0.9)).toEqual(['rear', 'wheelRR']);
  });
});

describe('impulse damage', () => {
  it('impulse at or below threshold -> no damage (curb rubbing)', () => {
    const hp = createZoneHp();
    const r = applyImpulseDamage(hp, 2, 0, TH, 1);
    expect(r.damage).toBe(0);
    expect(applyImpulseDamage(hp, 0, 1, 100, 1).damage).toBe(0);
    for (const z of ZONES) expect(hp[z]).toBe(MAX);
  });
  it('above threshold damages the hit zones; monotonic in impulse', () => {
    let prev = 0;
    for (const imp of [TH + 1000, TH + 5000, TH + 15000, TH + 40000]) {
      const hp = createZoneHp();
      const r = applyImpulseDamage(hp, 2, 0, imp, 1);
      expect(r.damage).toBeGreaterThanOrEqual(prev);
      expect(hp.front).toBeLessThan(MAX);
      prev = r.damage;
    }
  });
  it('armor reduces damage, car-vs-car multiplier applies, hp never below 0', () => {
    const a = createZoneHp(), b = createZoneHp(), c = createZoneHp();
    const imp = TH + 12000;
    const dA = applyImpulseDamage(a, 2, 0, imp, 1).damage;
    const dB = applyImpulseDamage(b, 2, 0, imp, 2).damage;
    const dC = applyImpulseDamage(c, 2, 0, imp, 1, CONFIG.damage.carVsCarMul).damage;
    expect(dB).toBeCloseTo(dA / 2, 6);
    expect(dC).toBeCloseTo(dA * CONFIG.damage.carVsCarMul, 6);
    const d = createZoneHp();
    applyImpulseDamage(d, 2, 0, 1e9, 1);
    for (const z of ZONES) expect(d[z]).toBeGreaterThanOrEqual(0);
    expect(d.front).toBe(0);
  });
  it('a 20 m/s wall crash is serious but not an instant wreck', () => {
    const hp = createZoneHp();
    applyImpulseDamage(hp, 2.1, 0, 1000 * 20 * 1.2, 1);
    expect(hp.front).toBeLessThan(70);
    expect(hp.front).toBeGreaterThan(20);
    expect(totalHealth(hp, MAX)).toBeGreaterThan(0.3);
  });
});

describe('health and effects', () => {
  it('totalHealth is 1 when healthy, 0 when all zones are gone, missingHp sums', () => {
    const hp = createZoneHp();
    expect(totalHealth(hp, MAX)).toBe(1);
    expect(missingHp(hp, MAX)).toBe(0);
    hp.front = 50; hp.engine = 20;
    expect(missingHp(hp, MAX)).toBe(130);
    for (const z of ZONES) hp[z] = 0;
    expect(totalHealth(hp, MAX)).toBe(0);
    expect(missingHp(hp, MAX)).toBe(MAX * ZONES.length);
  });

  it('healthy car has neutral effects', () => {
    const fx = computeEffects(createZoneHp(), MAX);
    expect(fx).toEqual({ powerMul: 1, topSpeedMul: 1, gripMul: 1, steerPull: 0, smoke: 0, sparks: 0 });
  });

  it('effects are monotonic: more damage in any one zone never improves power/top speed/grip/smoke/sparks', () => {
    for (const z of ZONES) {
      let prev = computeEffects(createZoneHp(), MAX);
      for (let hpv = MAX; hpv >= 0; hpv -= 5) {
        const hp = createZoneHp();
        hp[z] = hpv;
        const fx = computeEffects(hp, MAX);
        expect(fx.powerMul).toBeLessThanOrEqual(prev.powerMul + 1e-12);
        expect(fx.topSpeedMul).toBeLessThanOrEqual(prev.topSpeedMul + 1e-12);
        expect(fx.gripMul).toBeLessThanOrEqual(prev.gripMul + 1e-12);
        expect(fx.smoke).toBeGreaterThanOrEqual(prev.smoke - 1e-12);
        expect(fx.sparks).toBeGreaterThanOrEqual(prev.sparks - 1e-12);
        expect(Math.abs(fx.steerPull)).toBeGreaterThanOrEqual(Math.abs(prev.steerPull) - 1e-12);
        prev = fx;
      }
    }
  });

  it('zone -> effect mapping per the design', () => {
    const only = (z: ZoneId) => { const hp = createZoneHp(); hp[z] = 0; return computeEffects(hp, MAX); };
    const front = only('front');
    expect(front.powerMul).toBeCloseTo(1 - CONFIG.damage.frontPowerLoss, 6);
    expect(Math.abs(front.steerPull)).toBeGreaterThan(0.05);
    expect(front.topSpeedMul).toBe(1);
    const left = only('left'), right = only('right');
    expect(left.steerPull).toBeLessThan(0);
    expect(right.steerPull).toBeGreaterThan(0);
    expect(only('rear').gripMul).toBeCloseTo(1 - CONFIG.damage.rearGripLoss, 6);
    const eng = only('engine');
    expect(eng.topSpeedMul).toBeCloseTo(1 - CONFIG.damage.engineTopSpeedLoss, 6);
    expect(eng.powerMul).toBeLessThan(1);
    expect(only('wheelRL').gripMul).toBeCloseTo(1 - CONFIG.damage.wheelGripLoss, 6);
    expect(only('wheelFL').steerPull).toBeLessThan(0);
    expect(only('wheelFR').steerPull).toBeGreaterThan(0);
  });

  it('smoke and sparks appear only at low health', () => {
    const hp = createZoneHp();
    expect(computeEffects(hp, MAX).smoke).toBe(0);
    for (const z of ZONES) hp[z] = MAX * 0.3;
    const fx = computeEffects(hp, MAX);
    expect(fx.smoke).toBeGreaterThan(0);
    expect(fx.sparks).toBeLessThan(1);
    for (const z of ZONES) hp[z] = 0;
    const dead = computeEffects(hp, MAX);
    expect(dead.smoke).toBe(1);
    expect(dead.sparks).toBe(1);
    for (const v of Object.values(dead)) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('parts', () => {
  it('nothing detaches above partOffHp', () => {
    const hp = createZoneHp();
    for (const z of ZONES) hp[z] = CONFIG.damage.partOffHp;
    expect(partsToDetach(hp, [])).toEqual([]);
  });
  it('parts detach below partOffHp, each only once, staggered', () => {
    const hp = createZoneHp();
    hp.front = CONFIG.damage.partOffHp - 1;
    expect(partsToDetach(hp, [])).toEqual(['bumperF']);
    hp.front = 5;
    const p = partsToDetach(hp, ['bumperF']);
    expect(p).toContain('hood');
    expect(p).not.toContain('bumperF');
    hp.left = 0; hp.right = 0; hp.rear = 0;
    const all = partsToDetach(hp, []);
    expect(new Set(all).size).toBe(all.length);
    for (const part of ['bumperF', 'hood', 'bumperR', 'spoiler', 'doorL', 'doorR', 'mirrorL', 'mirrorR'] as const) expect(all).toContain(part);
    expect(partsToDetach(hp, all)).toEqual([]);
  });
  it('wheels come off only at ~0 hp and never more than maxWheelsOff', () => {
    const hp = createZoneHp();
    hp.wheelFL = 1;
    expect(partsToDetach(hp, [])).toEqual([]);
    hp.wheelFL = 0; hp.wheelFR = 0; hp.wheelRL = 0; hp.wheelRR = 0;
    const w = partsToDetach(hp, []);
    expect(w.length).toBe(CONFIG.damage.maxWheelsOff);
    expect(partsToDetach(hp, w)).toEqual([]);
  });
  it('a single hard hit knocks parts off its side, outermost first', () => {
    expect(partsKnockedOff('front', CONFIG.damage.knockOffImpulse - 1, [])).toEqual([]);
    expect(partsKnockedOff('front', CONFIG.damage.knockOffImpulse, [])).toEqual(['bumperF']);
    expect(partsKnockedOff('front', CONFIG.damage.knockOffSecond, [])).toEqual(['bumperF', 'hood']);
    expect(partsKnockedOff('left', CONFIG.damage.knockOffImpulse, ['mirrorL'])).toEqual(['doorL']);
    expect(partsKnockedOff('right', 1e6, ['mirrorR', 'doorR'])).toEqual([]);
    expect(partsKnockedOff('engine', 1e6, [])).toEqual([]);
  });
});
