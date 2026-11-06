import { describe, expect, it } from 'vitest';
import {
  MISSIONS_PER_DAY, LOGIN_REWARDS, MissionTracker, applyRace, claimLogin, claimMission, dailyOf, dayNumber, defaultDaily,
  isComplete, missionsForDay, nextStreakDay, sanitizeDaily, unclaimedCount,
} from '../src/meta/daily';
import { buyCosmetic, cosmeticsOf, equipCosmetic, liveryFor, owns, paintIndexFor, PAINTS, PREMIUM_BASE, sanitizeCosmetics } from '../src/meta/cosmetics';
import { defaultSave, sanitizeSave } from '../src/meta/save';
import { paintHex } from '../src/render/paintLayer';
import { CONFIG } from '../src/config';

const race = (o: Partial<{ smashed: number; place: number; driftS: number; nitros: number; repairs: number }> = {}) =>
  ({ smashed: 0, place: 5, driftS: 0, nitros: 0, repairs: 1, ...o });

describe('daily mission rotation', () => {
  it('is deterministic by date and gives 3 distinct missions', () => {
    const d = dayNumber(new Date(2026, 10, 5));
    expect(missionsForDay(d)).toEqual(missionsForDay(d));
    const kinds = missionsForDay(d).map((m) => m.kind);
    expect(kinds).toHaveLength(MISSIONS_PER_DAY);
    expect(new Set(kinds).size).toBe(MISSIONS_PER_DAY);
  });
  it('rotates across days', () => {
    const base = dayNumber(new Date(2026, 0, 1));
    const sets = new Set<string>();
    for (let i = 0; i < 14; i++) sets.add(missionsForDay(base + i).map((m) => m.kind).join(','));
    expect(sets.size).toBeGreaterThan(5);
  });
  it('dayNumber uses the local calendar date', () => {
    expect(dayNumber(new Date(2026, 10, 5, 0, 1))).toBe(dayNumber(new Date(2026, 10, 5, 23, 59)));
    expect(dayNumber(new Date(2026, 10, 6, 0, 1)) - dayNumber(new Date(2026, 10, 5, 23, 59))).toBe(1);
  });
});

describe('mission progress and claim', () => {
  // find a day whose missions include smash, to test a counted mission
  const day = (() => { for (let d = 20000; d < 20100; d++) if (missionsForDay(d).some((m) => m.kind === 'smash')) return d; return 20000; })();
  const si = missionsForDay(day).findIndex((m) => m.kind === 'smash');

  it('accumulates across races, completes once, then claims once', () => {
    let st = defaultDaily();
    let r = applyRace(st, day, race({ smashed: 30 }));
    expect(r.completed).not.toContain(si);
    st = r.state;
    expect(claimMission(st, si, day)).toBeNull();
    r = applyRace(st, day, race({ smashed: 30 }));
    expect(r.completed).toContain(si);
    st = r.state;
    expect(isComplete(st, si, day)).toBe(true);
    expect(unclaimedCount(st, day)).toBeGreaterThanOrEqual(1);
    const c = claimMission(st, si, day)!;
    expect(c.coins).toBe(missionsForDay(day)[si].reward);
    expect(claimMission(c.state, si, day)).toBeNull();
    // later races do not re-complete it
    expect(applyRace(c.state, day, race({ smashed: 99 })).completed).not.toContain(si);
  });
  it('a new day resets progress and claims', () => {
    const st = applyRace(defaultDaily(), day, race({ smashed: 60 })).state;
    const next = applyRace(st, day + 1, race());
    expect(next.state.day).toBe(day + 1);
    expect(next.state.claimed).toEqual([false, false, false]);
  });
  it('drift seconds add up from short drifts', () => {
    const d = (() => { for (let x = 20000; x < 20200; x++) if (missionsForDay(x).some((m) => m.kind === 'drift')) return x; return 20000; })();
    const i = missionsForDay(d).findIndex((m) => m.kind === 'drift');
    let st = defaultDaily();
    for (let k = 0; k < 4; k++) st = applyRace(st, d, race({ driftS: 2.6 })).state;
    expect(isComplete(st, i, d)).toBe(true);
  });
  it('tracker counts player nitros, drift time and repairs', () => {
    const t = new MissionTracker();
    const p = { id: 0, driftActive: true, finished: false };
    t.tick(0.5, p, [{ type: 'boost', carId: 0, source: 'nitro' }, { type: 'boost', carId: 3, source: 'nitro' }, { type: 'boost', carId: 0, source: 'pad' }]);
    t.repaired();
    expect(t.stats(7, 1)).toEqual({ smashed: 7, place: 1, driftS: 0.5, nitros: 1, repairs: 1 });
    t.reset();
    expect(t.stats(0, 2).nitros).toBe(0);
  });
});

describe('login streak', () => {
  it('advances on consecutive days, wraps after 7 and resets after a missed day', () => {
    let st = defaultDaily();
    const d0 = 20400;
    for (let i = 0; i < 7; i++) {
      const r = claimLogin(st, d0 + i)!;
      expect(r.streak).toBe(i + 1);
      expect(r.coins).toBe(LOGIN_REWARDS[i]);
      st = r.state;
    }
    expect(claimLogin(st, d0 + 6)).toBeNull();          // once per day
    expect(nextStreakDay(st, d0 + 7)).toBe(1);           // after day 7 the cycle restarts
    st = claimLogin(st, d0 + 7)!.state;
    st = claimLogin(st, d0 + 8)!.state;
    expect(st.streak).toBe(2);
    expect(nextStreakDay(st, d0 + 10)).toBe(1);          // missed a day
    expect(claimLogin(st, d0 + 10)!.streak).toBe(1);
  });
});

describe('cosmetics purchase and equip', () => {
  it('buys per car, equips, refuses double buy and poor players', () => {
    const s = { ...defaultSave(), money: 1000 };
    const it = { type: 'paint' as const, id: 'gold' };
    const b = buyCosmetic(s, 'scrapper', it)!;
    expect(b.money).toBe(1000 - PAINTS.find((p) => p.id === 'gold')!.price);
    expect(owns(b, 'scrapper', it)).toBe(true);
    expect(owns(b, 'brick', it)).toBe(false);
    expect(paintIndexFor(b, 'scrapper')).toBe(PREMIUM_BASE + PAINTS.findIndex((p) => p.id === 'gold'));
    expect(paintHex(paintIndexFor(b, 'scrapper'))).toBe(0xd9a92b);
    expect(paintIndexFor(b, 'brick')).toBe(b.carColor);
    expect(buyCosmetic(b, 'scrapper', it)).toBeNull();
    expect(buyCosmetic({ ...s, money: 10 }, 'scrapper', it)).toBeNull();
    const back = equipCosmetic(b, 'scrapper', { type: 'paint', id: '' })!;
    expect(paintIndexFor(back, 'scrapper')).toBe(back.carColor);
    expect(equipCosmetic(s, 'scrapper', { type: 'livery', id: 'flames' })).toBeNull();
    const lv = buyCosmetic({ ...b, money: 5000 }, 'scrapper', { type: 'livery', id: 'flames' })!;
    expect(liveryFor(lv, 'scrapper')).toBe('flames');
    expect(liveryFor(equipCosmetic(lv, 'scrapper', { type: 'livery', id: 'none' })!, 'scrapper')).toBe('none');
  });
  it('drops unknown or unowned items from stored data', () => {
    const c = sanitizeCosmetics({ owned: { scrapper: ['p:gold', 'p:nope', 7], ufo: ['p:gold'] }, paint: { scrapper: 'gold', brick: 'gold' }, livery: { scrapper: 'flames' } });
    expect(c.owned).toEqual({ scrapper: ['p:gold'] });
    expect(c.paint).toEqual({ scrapper: 'gold' });
    expect(c.livery).toEqual({});
  });
  it('free palette indices still resolve as before', () => {
    expect(paintHex(0)).toBe(CONFIG.render.carColors[0]);
    expect(paintHex(9)).toBe(CONFIG.render.carColors[1]);
  });
});

describe('save defaulting', () => {
  it('an old save without daily / cosmetics gets defaults and keeps its progress', () => {
    const old = { version: 2, money: 777, car: 'brick', carColor: 3, racesFinished: 4 };
    const s = sanitizeSave(old, null);
    expect(s.money).toBe(777);
    expect(dailyOf(s)).toEqual(defaultDaily());
    expect(cosmeticsOf(s)).toEqual({ owned: {}, paint: {}, livery: {} });
    expect(paintIndexFor(s)).toBe(3);
  });
  it('a stored daily record survives a round trip; garbage is defaulted', () => {
    const st = claimLogin(defaultDaily(), 20500)!.state;
    const s = sanitizeSave(JSON.parse(JSON.stringify({ ...defaultSave(), daily: st })), null);
    expect(dailyOf(s)).toEqual(st);
    expect(sanitizeDaily('x')).toEqual(defaultDaily());
    expect(sanitizeDaily({ day: 'a', progress: [1e9, -3], claimed: [1, true], streak: 99 })).toEqual({
      day: -1, progress: [1e6, 0, 0], claimed: [false, true, false], loginDay: -1, streak: 7,
    });
  });
});
