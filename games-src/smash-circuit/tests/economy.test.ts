import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { applyRaceResult, buyUpgrade, canBuy, nextTrackId, raceReward, repairCost, statsFor, upgradeCost } from '../src/meta/economy';
import { DRIVER_NAMES, makeOpponents, makePlayerSetup } from '../src/meta/opponents';
import { defaultSave, sanitizeSave } from '../src/meta/save';
import { baseStats } from '../src/sim/carModel';

describe('upgrade costs and stats', () => {
  it('costs follow the config table and end at max level', () => {
    for (let l = 0; l < CONFIG.upgrades.maxLevel; l++) expect(upgradeCost(l)).toBe(CONFIG.upgrades.cost[l]);
    expect(upgradeCost(CONFIG.upgrades.maxLevel)).toBeNull();
    expect(upgradeCost(-1)).toBeNull();
    expect(upgradeCost(NaN)).toBeNull();
  });

  it('level 0 equals the base car stats of the car model', () => {
    const s = statsFor({ engine: 0, grip: 0, armor: 0 });
    const b = baseStats();
    expect(s.enginePower).toBeCloseTo(b.enginePower, 6);
    expect(s.topSpeed).toBeCloseTo(b.topSpeed, 6);
    expect(s.grip).toBeCloseTo(b.grip, 6);
    expect(s.armor).toBeCloseTo(b.armor, 6);
    expect(s.mass).toBe(b.mass);
  });

  it('each upgrade level strictly improves its stats and is clamped at max', () => {
    let prev = statsFor({ engine: 0, grip: 0, armor: 0 });
    for (let l = 1; l <= CONFIG.upgrades.maxLevel; l++) {
      const s = statsFor({ engine: l, grip: l, armor: l });
      expect(s.enginePower).toBeGreaterThan(prev.enginePower);
      expect(s.topSpeed).toBeGreaterThan(prev.topSpeed);
      expect(s.grip).toBeGreaterThan(prev.grip);
      expect(s.armor).toBeGreaterThan(prev.armor);
      prev = s;
    }
    expect(statsFor({ engine: 99, grip: 99, armor: 99 })).toEqual(statsFor({ engine: 5, grip: 5, armor: 5 }));
  });

  it('buyUpgrade spends exactly the cost, never goes negative, refuses at max', () => {
    let s = { ...defaultSave(), money: 250 };
    expect(canBuy(s, 'engine')).toBe(true);
    const bought = buyUpgrade(s, 'engine')!;
    expect(bought.money).toBe(0);
    expect(bought.carUpgrades[s.car].engine).toBe(1);            // upgrades belong to the selected car
    expect(buyUpgrade(bought, 'engine')).toBeNull();            // 600 needed
    expect(s.carUpgrades[s.car]).toBeUndefined();               // input not mutated
    s = { ...s, money: 1e6, carUpgrades: { [s.car]: { engine: 5, grip: 5, armor: 5 } } };
    expect(buyUpgrade(s, 'grip')).toBeNull();
    expect(canBuy(s, 'armor')).toBe(false);
    // another car still starts from level 0
    expect(canBuy(s, 'armor', 'mammoth')).toBe(true);
    expect(buyUpgrade(s, 'armor', 'mammoth')!.carUpgrades.mammoth).toEqual({ engine: 0, grip: 0, armor: 1 });
  });
});

describe('rewards and repair', () => {
  it('reward falls with the place and grows with the track and destruction', () => {
    for (let p = 1; p < 8; p++) expect(raceReward('t1', p, 0)).toBeGreaterThan(raceReward('t1', p + 1, 0));
    expect(raceReward('t2', 3, 0)).toBeGreaterThan(raceReward('t1', 3, 0));
    expect(raceReward('t3', 3, 0)).toBeGreaterThan(raceReward('t2', 3, 0));
    expect(raceReward('t1', 1, 10)).toBe(raceReward('t1', 1, 0) + 10 * CONFIG.economy.destructionBonus);
    expect(raceReward('t1', 99, 0)).toBe(raceReward('t1', 8, 0));  // place clamped
    expect(raceReward('t1', 1, -5)).toBe(raceReward('t1', 1, 0));
    expect(raceReward('unknown', 1, 0)).toBe(CONFIG.economy.prizeByPlace[0]);
  });

  it('repair cost: 0 when nothing missing, a minimum fee otherwise, linear after', () => {
    expect(repairCost(0)).toBe(0);
    expect(repairCost(-3)).toBe(0);
    expect(repairCost(1)).toBe(CONFIG.economy.repairMinCost);
    expect(repairCost(500)).toBe(Math.round(500 * CONFIG.economy.repairCostPerHp));
    expect(repairCost(600)).toBeGreaterThan(repairCost(500));
  });
});

describe('applyRaceResult', () => {
  it('adds the reward, tracks bests and counts the race', () => {
    const s0 = defaultSave();
    const { save, unlocked } = applyRaceResult(s0, 't1', 5, 160, 75.5);
    expect(save.money).toBe(s0.money + 160);
    expect(save.bestPlace.t1).toBe(5);
    expect(save.bestLap.t1).toBe(75.5);
    expect(save.racesFinished).toBe(1);
    expect(unlocked).toBeNull();
    expect(s0.money).toBe(CONFIG.economy.startMoney);            // pure
    const r2 = applyRaceResult(save, 't1', 7, 90, 80).save;       // worse: bests kept
    expect(r2.bestPlace.t1).toBe(5);
    expect(r2.bestLap.t1).toBe(75.5);
    const r3 = applyRaceResult(r2, 't1', 4, 90, 70).save;         // better: bests replaced
    expect(r3.bestPlace.t1).toBe(4);
    expect(r3.bestLap.t1).toBe(70);
  });

  it('top-3 unlocks the next track exactly once; last track unlocks nothing', () => {
    const s0 = defaultSave();
    const a = applyRaceResult(s0, 't1', CONFIG.economy.unlockPlace, 100, 70);
    expect(a.unlocked).toBe('t2');
    expect(a.save.unlockedTracks).toEqual(['t1', 't2']);
    const b = applyRaceResult(a.save, 't1', 1, 100, 70);
    expect(b.unlocked).toBeNull();
    expect(b.save.unlockedTracks).toEqual(['t1', 't2']);
    const c = applyRaceResult(a.save, 't2', 2, 100, 90);
    expect(c.unlocked).toBe('t3');
    const d = applyRaceResult(c.save, 't3', 1, 100, 90);
    expect(d.unlocked).toBeNull();
    expect(nextTrackId('t3')).toBeNull();
  });

  it('ignores a zero lap time and negative rewards', () => {
    const { save } = applyRaceResult(defaultSave(), 't1', 8, -50, 0);
    expect(save.bestLap.t1).toBeUndefined();
    expect(save.money).toBe(CONFIG.economy.startMoney);
  });
});

describe('opponents', () => {
  it('makes 7 distinct AI cars (ids 1..7) with unique names and colours', () => {
    const ai = makeOpponents(0, statsFor({ engine: 0, grip: 0, armor: 0 }), 123, 3);
    expect(ai).toHaveLength(CONFIG.race.cars - 1);
    expect(ai.map((c) => c.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(ai.map((c) => c.name)).size).toBe(7);
    expect(new Set(ai.map((c) => c.colorIndex)).size).toBe(7);
    expect(ai.every((c) => c.colorIndex !== 3 && !c.isPlayer && c.ai)).toBe(true);
    expect(ai.every((c) => DRIVER_NAMES.includes(c.name))).toBe(true);
  });

  it('is deterministic for a seed and differs between seeds', () => {
    const p = statsFor({ engine: 1, grip: 1, armor: 1 });
    expect(makeOpponents(1, p, 7)).toEqual(makeOpponents(1, p, 7));
    expect(makeOpponents(1, p, 7)).not.toEqual(makeOpponents(1, p, 8));
  });

  it('difficulty rises per track', () => {
    const p = statsFor({ engine: 0, grip: 0, armor: 0 });
    const avg = (ti: number, f: (c: ReturnType<typeof makeOpponents>[number]) => number): number => {
      const ai = makeOpponents(ti, p, 42);
      return ai.reduce((s, c) => s + f(c), 0) / ai.length;
    };
    expect(avg(1, (c) => c.ai!.skill)).toBeGreaterThan(avg(0, (c) => c.ai!.skill));
    expect(avg(2, (c) => c.ai!.skill)).toBeGreaterThan(avg(1, (c) => c.ai!.skill));
    expect(avg(2, (c) => c.stats.enginePower)).toBeGreaterThan(avg(0, (c) => c.stats.enginePower));
  });

  it('AI parameters stay in valid ranges, also for a maxed player', () => {
    const maxed = statsFor({ engine: 5, grip: 5, armor: 5 });
    for (let ti = 0; ti < 3; ti++) for (const c of makeOpponents(ti, maxed, 99)) {
      expect(c.ai!.skill).toBeGreaterThanOrEqual(0); expect(c.ai!.skill).toBeLessThanOrEqual(1);
      expect(c.ai!.aggression).toBeGreaterThanOrEqual(0); expect(c.ai!.aggression).toBeLessThanOrEqual(1);
      expect(Math.abs(c.ai!.laneOffset)).toBeLessThanOrEqual(1);
      expect(c.ai!.mistakeRate).toBeGreaterThanOrEqual(0); expect(c.ai!.mistakeRate).toBeLessThanOrEqual(1);
      expect(c.stats.grip).toBeGreaterThan(0);
    }
  });

  it('player setup uses the saved colour and upgrades', () => {
    const s = { ...defaultSave(), carColor: 4, car: 'brick', carUpgrades: { brick: { engine: 2, grip: 0, armor: 1 } } };
    const p = makePlayerSetup(s, 'You');
    expect(p).toMatchObject({ id: 0, isPlayer: true, colorIndex: 4, name: 'You' });
    expect(p.stats).toEqual(statsFor({ engine: 2, grip: 0, armor: 1 }, 'brick'));
    expect(p.stats.modelId).toBe('brick');
  });
});

describe('save sanitising', () => {
  it('falls back to defaults for garbage input', () => {
    expect(sanitizeSave(null, null)).toEqual(defaultSave());
    expect(sanitizeSave('x', 5)).toEqual(defaultSave());
  });

  it('clamps and filters stored values', () => {
    const s = sanitizeSave({
      money: -50, upgrades: { engine: 99, grip: -2, armor: 3.7 }, unlockedTracks: ['t2', 'zzz', 5], bestPlace: { t1: 0, t2: 3, t9: 1 },
      bestLap: { t1: 70.2, t2: 'x' }, settings: { lang: 'fr', autoGas: true, quality: 'ultra', muted: 1 }, carColor: 99, racesFinished: 4.8,
    }, null);
    expect(s.money).toBe(0);
    expect(s.carUpgrades).toEqual({ scrapper: { engine: 5, grip: 0, armor: 3 } });   // v1 global upgrades -> the starter car
    expect(s.unlockedTracks).toEqual(['t1', 't2']);
    expect(s.bestPlace).toEqual({ t2: 3 });
    expect(s.bestLap).toEqual({ t1: 70.2 });
    expect(s.settings).toEqual({ lang: 'auto', autoGas: true, quality: 'auto', muted: false, tutorialDone: false, camera: 'auto' });
    expect(s.carColor).toBe(CONFIG.render.carColors.length - 1);
    expect(s.racesFinished).toBe(4);
  });

  it('round-trips a valid ghost and drops a broken one', () => {
    const good = { trackId: 't1', lapTime: 70, frames: [{ t: 0, x: 1, y: 2, a: 0 }, { t: 0.05, x: 1.5, y: 2, a: 0.1 }] };
    const s = sanitizeSave({}, { t1: good, t2: { lapTime: 5, frames: [{ t: 'x' }, { t: 1 }] } });
    expect(s.ghosts.t1).toEqual(good);
    expect(s.ghosts.t2).toBeUndefined();
  });
});

describe('smash payoff by object type (audit #12)', () => {
  it('cones pay nothing, crates/trees/walls pay, curbs pay nothing; unknown props pay the generic rate', async () => {
    const { smashValue, raceRewardParts } = await import('../src/meta/economy');
    expect(smashValue('prop', 'cone')).toBe(0);
    expect(smashValue('prop', 'crate')).toBeGreaterThan(0);
    expect(smashValue('prop', 'tree')).toBeGreaterThan(smashValue('prop', 'sign'));
    expect(smashValue('wall')).toBeGreaterThan(0);
    expect(smashValue('curb')).toBe(0);
    expect(smashValue('prop', 'mystery')).toBe(CONFIG.economy.smashPay.kind.prop);
  });

  it('smash money is capped per race and split from the place prize', async () => {
    const { raceRewardParts } = await import('../src/meta/economy');
    const r = raceRewardParts('t1', 1, 99999);
    expect(r.smash).toBe(CONFIG.economy.smashPay.cap);
    expect(r.total).toBe(r.prize + r.smash);
    expect(raceRewardParts('t1', 1, -5).smash).toBe(0);
  });
});
