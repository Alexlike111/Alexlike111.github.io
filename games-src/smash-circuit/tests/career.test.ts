import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { EN, RU } from '../src/i18n';
import {
  CUPS, abandonRun, commitRace, cupBonus, cupById, cupColors, cupLock, cupNames, cupOpponents, cupStars, currentCupIndex, defaultCareer,
  evaluateGoal, evaluateStars, maxStars, normalizePlaces, pointsFor, raceKey, runActive, runFinished, runProgress, sanitizeCareer,
  standings, startRun, totalStars, type RaceOutcome,
} from '../src/meta/career';
import { defaultSave, sanitizeSave, SAVE_VERSION } from '../src/meta/save';
import { carStats } from '../src/meta/cars';
import { TRACKS } from '../src/track/tracks';
import type { CareerSave } from '../src/types';

const N = CONFIG.race.cars;
/** places for a race in which the player finishes `p` and the AIs fill the rest in id order */
const places = (p: number): number[] => {
  const out = new Array<number>(N);
  let next = 1;
  out[0] = p;
  for (let d = 1; d < N; d++) { if (next === p) next++; out[d] = next++; }
  return out;
};
const good: RaceOutcome = { place: 1, broken: 99, health: 1, repairs: 0 };
const bad: RaceOutcome = { place: 8, broken: 0, health: 0.1, repairs: 3 };

describe('cup tables', () => {
  it('has 4 cups of 3-4 races over existing tracks, with 3 goals each', () => {
    expect(CUPS.length).toBe(4);
    const ids = new Set(TRACKS.map((t) => t.id));
    for (const cup of CUPS) {
      expect(cup.races.length).toBeGreaterThanOrEqual(3);
      expect(cup.races.length).toBeLessThanOrEqual(4);
      for (const r of cup.races) {
        expect(ids.has(r.track)).toBe(true);
        expect(r.laps).toBeGreaterThanOrEqual(2);
        expect(r.tier).toBeGreaterThanOrEqual(0);
        expect(r.tier).toBeLessThan(CONFIG.meta.opponents.skill.length);
        expect(r.goals.length).toBe(3);
      }
    }
  });

  it('difficulty rises per cup', () => {
    for (let i = 1; i < CUPS.length; i++) expect(CUPS[i].shift).toBeGreaterThan(CUPS[i - 1].shift);
    for (let i = 1; i < CONFIG.career.unlockStars.length; i++) expect(CONFIG.career.unlockStars[i]).toBeGreaterThan(CONFIG.career.unlockStars[i - 1]);
  });

  it('stars are independent: star 3 is never a place goal, star 2 is never easier than star 1', () => {
    for (const cup of CUPS) for (const r of cup.races) {
      const [g1, g2, g3] = r.goals;
      expect(g3.k).not.toBe('place');
      expect(g1.k).toBe('place');
      expect(g2.k).toBe('place');
      if (g1.k === 'place' && g2.k === 'place') expect(g2.n).toBeLessThan(g1.n);
    }
  });

  it('every goal and cup has a translation', () => {
    for (const cup of CUPS) { expect(EN[cup.nameKey]).toBeDefined(); expect(RU[cup.nameKey]).toBeDefined(); }
    for (const k of ['goal.win', 'goal.top', 'goal.smash', 'goal.health', 'goal.noRepair']) { expect(EN[k]).toBeDefined(); expect(RU[k]).toBeDefined(); }
  });

  it('the stars of the first cups can unlock the later ones (thresholds are reachable)', () => {
    const avail = (n: number): number => CUPS.slice(0, n).reduce((s, c) => s + c.races.length * 3, 0);
    for (let k = 1; k < CUPS.length; k++) expect(CONFIG.career.unlockStars[k]).toBeLessThanOrEqual(avail(k));
    expect(maxStars()).toBe(CUPS.reduce((s, c) => s + c.races.length * 3, 0));
  });
});

describe('points and standings', () => {
  it('awards the points table by place', () => {
    expect(pointsFor(1)).toBe(10);
    expect(pointsFor(2)).toBe(8);
    expect(pointsFor(8)).toBe(1);
    expect(pointsFor(9)).toBe(0);
    expect(pointsFor(0)).toBe(0);
    for (let p = 1; p < N; p++) expect(pointsFor(p)).toBeGreaterThan(pointsFor(p + 1));
  });

  it('sums points over races and ranks everyone 1..8', () => {
    const t = standings([places(1), places(3), places(2)]);
    expect(t.length).toBe(N);
    expect(t.map((r) => r.pos)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(t.map((r) => r.driver)).size).toBe(N);
    const me = t.find((r) => r.driver === 0)!;
    expect(me.points).toBe(10 + 6 + 8);
    expect(me.wins).toBe(1);
    expect(me.best).toBe(1);
    expect(me.last).toBe(2);
    for (let i = 1; i < t.length; i++) expect(t[i - 1].points).toBeGreaterThanOrEqual(t[i].points);
  });

  it('breaks ties by wins, then best place, then the latest race, then driver number', () => {
    // drivers 0, 1 and 2 all have 16 points: 0 and 2 have a win (1 has none), and 2 won the latest race -> order 2, 0, 1
    const a = [1, 2, 3, 4, 5, 6, 7, 8], b = [3, 2, 1, 4, 5, 6, 7, 8];
    const t = standings([a, b]);
    expect(t.slice(0, 3).map((r) => r.driver)).toEqual([2, 0, 1]);
    // identical results for drivers 0 and 1 -> lower driver number first
    const same = standings([[1, 1, 3, 4, 5, 6, 7, 8].map((p, i) => (i === 1 ? 2 : p))]);
    expect(same[0].pos).toBe(1);
    // an empty table is all-level and ordered by driver
    expect(standings([]).map((r) => r.driver)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('normalizePlaces always returns a permutation and keeps the announced player place', () => {
    const raw = [0, 1, 1, 2, 5, 5, 8, 8];
    const out = normalizePlaces(raw, 2);
    expect([...out].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(out[0]).toBe(2);
    expect([...normalizePlaces([], 1)].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('star evaluation', () => {
  const o = (p: Partial<RaceOutcome>): RaceOutcome => ({ ...good, ...p });
  it('place goals', () => {
    expect(evaluateGoal({ k: 'place', n: 3 }, o({ place: 3 }))).toBe(true);
    expect(evaluateGoal({ k: 'place', n: 3 }, o({ place: 4 }))).toBe(false);
    expect(evaluateGoal({ k: 'place', n: 1 }, o({ place: 1 }))).toBe(true);
    expect(evaluateGoal({ k: 'place', n: 1 }, o({ place: 2 }))).toBe(false);
  });
  it('smash goals', () => {
    expect(evaluateGoal({ k: 'smash', n: 20 }, o({ broken: 20 }))).toBe(true);
    expect(evaluateGoal({ k: 'smash', n: 20 }, o({ broken: 19 }))).toBe(false);
  });
  it('health goals', () => {
    expect(evaluateGoal({ k: 'health', f: 0.6 }, o({ health: 0.6 }))).toBe(true);
    expect(evaluateGoal({ k: 'health', f: 0.6 }, o({ health: 0.59 }))).toBe(false);
  });
  it('no-repair goals', () => {
    expect(evaluateGoal({ k: 'noRepair' }, o({ repairs: 0 }))).toBe(true);
    expect(evaluateGoal({ k: 'noRepair' }, o({ repairs: 1 }))).toBe(false);
  });
  it('a weak finish can still earn the third star (stars do not imply each other)', () => {
    for (const cup of CUPS) for (const r of cup.races) {
      const st = evaluateStars(r.goals, { place: 8, broken: 99, health: 1, repairs: 0 });
      expect(st).toEqual([false, false, true]);
    }
  });
  it('a win with a wrecked car earns the place stars only', () => {
    for (const cup of CUPS) for (const r of cup.races) {
      const st = evaluateStars(r.goals, { place: 1, broken: 0, health: 0.05, repairs: 5 });
      expect(st).toEqual([true, true, false]);
    }
  });
  it('a perfect race earns all three', () => {
    for (const cup of CUPS) for (const r of cup.races) expect(evaluateStars(r.goals, good)).toEqual([true, true, true]);
  });
});

describe('committing races', () => {
  const cup = CUPS[0];
  it('records places, points, best-ever stars and the star bonus once', () => {
    let c = startRun(defaultCareer(), cup.id, 5);
    expect(c.run?.results).toEqual([]);
    const r1 = commitRace(c, cup.id, 0, places(2), { place: 2, broken: 3, health: 1, repairs: 0 });
    expect(r1.stars).toEqual([true, false, false]);
    expect(r1.newStars).toEqual([true, false, false]);
    expect(r1.starCoins).toBe(CONFIG.career.starBonus);
    expect(r1.points).toBe(8);
    expect(r1.career.run?.results.length).toBe(1);
    expect(r1.career.stars[raceKey(cup.id, 0)]).toBe(1);
    expect(r1.cupDone).toBe(false);
    expect(runActive(r1.career, cup.id)).toBe(true);
    expect(runProgress(r1.career, cup.id)).toBe(1);
    c = r1.career;

    // retry of race 0 replaces the result; a worse attempt never removes a star; a better one adds only the new star
    const r2 = commitRace(c, cup.id, 0, places(1), { place: 1, broken: 3, health: 1, repairs: 0 });
    expect(r2.career.run?.results.length).toBe(1);
    expect(r2.newStars).toEqual([false, true, false]);
    expect(r2.starCoins).toBe(CONFIG.career.starBonus);
    expect(r2.career.stars[raceKey(cup.id, 0)]).toBe(3);
    const r3 = commitRace(r2.career, cup.id, 0, places(8), bad);
    expect(r3.career.stars[raceKey(cup.id, 0)]).toBe(3);
    expect(r3.starCoins).toBe(0);
    expect(r3.stars).toEqual([false, false, false]);
  });

  it('finishing the last race closes the cup: record, prize paid once, next cup opens', () => {
    let c = startRun(defaultCareer(), cup.id, 9);
    let last = null as ReturnType<typeof commitRace> | null;
    for (let i = 0; i < cup.races.length; i++) {
      last = commitRace(c, cup.id, i, places(1), good);
      c = last.career;
    }
    expect(last!.cupDone).toBe(true);
    expect(last!.playerPos).toBe(1);
    expect(last!.cupCoins).toBe(cupBonus(0, 1));
    expect(c.cups[cup.id]).toEqual({ done: true, best: 1, claimed: cupBonus(0, 1) });
    expect(runFinished(c, cup.id)).toBe(true);
    expect(cupStars(c, cup.id)).toBe(cup.races.length * 3);
    // 9 stars >= the 5 needed and cup 0 is done -> cup 1 opened by this very commit
    expect(last!.unlockedCup).toBe(CUPS[1].id);
    expect(cupLock(c, 1).unlocked).toBe(true);

    // racing the cup again pays only the improvement of the final standing (nothing for a repeat of the same result)
    let c2 = startRun(c, cup.id, 10);
    let l2 = null as ReturnType<typeof commitRace> | null;
    for (let i = 0; i < cup.races.length; i++) { l2 = commitRace(c2, cup.id, i, places(1), good); c2 = l2.career; }
    expect(l2!.cupCoins).toBe(0);
    expect(l2!.unlockedCup).toBeNull();
  });

  it('a worse final standing first pays the smaller prize, a later better one pays the difference', () => {
    let c = startRun(defaultCareer(), cup.id, 3);
    let l = null as ReturnType<typeof commitRace> | null;
    for (let i = 0; i < cup.races.length; i++) { l = commitRace(c, cup.id, i, places(5), bad); c = l.career; }
    const pos = l!.playerPos;
    expect(pos).toBeGreaterThanOrEqual(2);
    expect(l!.cupCoins).toBe(cupBonus(0, pos));
    c = startRun(c, cup.id, 4);
    for (let i = 0; i < cup.races.length; i++) { l = commitRace(c, cup.id, i, places(1), good); c = l.career; }
    expect(l!.cupCoins).toBe(cupBonus(0, 1) - cupBonus(0, pos));
    expect(c.cups[cup.id].best).toBe(1);
  });

  it('ignores impossible commits', () => {
    const c = defaultCareer();
    expect(commitRace(c, 'nope', 0, places(1), good).career).toBe(c);
    expect(commitRace(c, cup.id, 99, places(1), good).career).toBe(c);
  });

  it('abandoning drops the run but keeps stars and records', () => {
    const c = commitRace(startRun(defaultCareer(), cup.id, 1), cup.id, 0, places(1), good).career;
    const a = abandonRun(c);
    expect(a.run).toBeNull();
    expect(a.stars).toEqual(c.stars);
  });
});

describe('unlock logic', () => {
  const withStars = (n: number, doneCups: string[] = []): CareerSave => {
    const c = defaultCareer();
    let left = n;
    for (const cup of CUPS) cup.races.forEach((_, i) => { if (left > 0) { const k = Math.min(3, left); c.stars[raceKey(cup.id, i)] = k === 3 ? 7 : k === 2 ? 3 : 1; left -= k; } });
    for (const id of doneCups) c.cups[id] = { done: true, best: 1, claimed: 0 };
    return c;
  };
  it('the first cup is always open', () => {
    expect(cupLock(defaultCareer(), 0).unlocked).toBe(true);
    expect(currentCupIndex(defaultCareer())).toBe(0);
  });
  it('a cup needs the previous cup done AND the star count', () => {
    const need = CONFIG.career.unlockStars[1];
    expect(cupLock(withStars(need, []), 1)).toMatchObject({ unlocked: false, needPrev: true, missingStars: 0 });
    expect(cupLock(withStars(need - 1, [CUPS[0].id]), 1)).toMatchObject({ unlocked: false, needPrev: false, missingStars: 1 });
    expect(cupLock(withStars(need, [CUPS[0].id]), 1).unlocked).toBe(true);
  });
  it('stars from any cup count, so a stubborn race can be made up elsewhere', () => {
    const need = CONFIG.career.unlockStars[2];
    const c = withStars(need, [CUPS[0].id, CUPS[1].id]);
    expect(totalStars(c)).toBe(need);
    expect(cupLock(c, 2).unlocked).toBe(true);
    expect(cupLock(c, 3).unlocked).toBe(false);
  });
  it('highlights the first open cup that is not done', () => {
    expect(currentCupIndex(withStars(CONFIG.career.unlockStars[1], [CUPS[0].id]))).toBe(1);
    const all = withStars(maxStars(), CUPS.map((c) => c.id));
    expect(currentCupIndex(all)).toBe(CUPS.length - 1);
  });
  it('cannot start a locked cup', () => {
    const c = defaultCareer();
    expect(startRun(c, CUPS[2].id, 1)).toBe(c);
    expect(startRun(c, 'nope', 1)).toBe(c);
  });
  it('sanitizeCareer keeps good data and drops junk', () => {
    const good2: CareerSave = { stars: { 'rookie:0': 5, 'rookie:2': 7 }, cups: { rookie: { done: true, best: 2, claimed: 700 } }, run: { cup: 'turbo', seed: 7, results: [places(3)] } };
    expect(sanitizeCareer(JSON.parse(JSON.stringify(good2)))).toEqual(good2);
    const junk = sanitizeCareer({ stars: { 'rookie:0': 99, 'ghost:1': 3, 'rookie:9': 7, 'rookie:1': 'x' }, cups: { nope: { done: true }, rookie: { done: 1, best: 99, claimed: -5 } },
      run: { cup: 'rookie', seed: 1, results: [[1, 1, 1, 1, 1, 1, 1, 1]] } });
    expect(junk.stars['rookie:0']).toBe(7);          // clamped to the 3 valid bits
    expect(Object.keys(junk.stars)).toEqual(['rookie:0']);
    expect(junk.cups.nope).toBeUndefined();
    expect(junk.cups.rookie).toBeUndefined();        // done is not `true`, nothing claimed: nothing to keep
    expect(junk.run).toBeNull();                     // not a permutation of places
    expect(sanitizeCareer(null)).toEqual(defaultCareer());
    expect(sanitizeCareer([])).toEqual(defaultCareer());
  });
});

describe('cup rivals', () => {
  const stats = carStats(CONFIG.cars.starter);
  it('keeps the same 7 names and colours through a whole cup, never the player colour', () => {
    const cup = CUPS[1];
    const a = cupOpponents(cup, 0, stats, 42, 3), b = cupOpponents(cup, 2, stats, 42, 3);
    expect(a.length).toBe(N - 1);
    expect(a.map((c) => c.name)).toEqual(b.map((c) => c.name));
    expect(a.map((c) => c.colorIndex)).toEqual(b.map((c) => c.colorIndex));
    expect(new Set(a.map((c) => c.name)).size).toBe(N - 1);
    expect(a.some((c) => c.colorIndex === 3)).toBe(false);
    expect(cupNames(42)).toEqual(a.map((c) => c.name));
    expect(cupColors(42, 3).length).toBeGreaterThanOrEqual(N - 1);
    expect(cupNames(43)).not.toEqual(cupNames(42));
  });
  it('harder cups field stronger rivals on the same tier', () => {
    const avg = (xs: number[]): number => xs.reduce((s, v) => s + v, 0) / xs.length;
    const skill = (cup: typeof CUPS[number]): number => avg(cupOpponents({ ...cup, shift: cup.shift }, 0, stats, 7, 0).map((c) => c.ai!.skill));
    const easy = skill({ ...CUPS[0], shift: -0.08 } as typeof CUPS[number]);
    const hard = skill({ ...CUPS[0], shift: 0.12 } as typeof CUPS[number]);
    expect(hard).toBeGreaterThan(easy);
    const pw = (shift: number): number => avg(cupOpponents({ ...CUPS[0], shift }, 0, stats, 7, 0).map((c) => c.stats.enginePower));
    expect(pw(0.12)).toBeGreaterThan(pw(-0.08));
  });
  it('is deterministic for a seed', () => {
    const a = cupOpponents(CUPS[2], 1, stats, 99, 0), b = cupOpponents(CUPS[2], 1, stats, 99, 0);
    expect(a).toEqual(b);
    expect(cupById('frost')).toBe(CUPS[2]);
  });
});

describe('save v3 migration', () => {
  it('a v2 save keeps coins, cars and upgrades and gains an empty career', () => {
    const v2 = {
      version: 2, money: 4321, car: 'brick', carUpgrades: { brick: { engine: 3, grip: 1, armor: 2 }, scrapper: { engine: 5, grip: 0, armor: 0 } },
      carRaces: { brick: 7 }, carWins: { brick: 2 }, unlockedTracks: ['t1', 't2'], bestPlace: { t1: 1, t2: 3 }, bestLap: { t1: 61.5 },
      settings: { lang: 'ru', autoGas: true, quality: 'high', muted: true, tutorialDone: true, controls: 'tilt', steerSens: 1.2, controlsPicked: true },
      carColor: 4, racesFinished: 9,
    };
    const s = sanitizeSave(v2, {});
    expect(s.version).toBe(SAVE_VERSION);
    expect(SAVE_VERSION).toBe(3);
    expect(s.money).toBe(4321);
    expect(s.car).toBe('brick');
    expect(s.carUpgrades.brick).toEqual({ engine: 3, grip: 1, armor: 2 });
    expect(s.carUpgrades.scrapper).toEqual({ engine: 5, grip: 0, armor: 0 });
    expect(s.unlockedTracks).toEqual(['t1', 't2']);
    expect(s.bestPlace).toEqual({ t1: 1, t2: 3 });
    expect(s.settings.lang).toBe('ru');
    expect(s.settings.controls).toBe('tilt');
    expect(s.carColor).toBe(4);
    expect(s.racesFinished).toBe(9);
    expect(s.career).toEqual(defaultCareer());
  });

  it('a v1 save (global upgrades) still migrates through v2 to v3', () => {
    const v1 = { version: 1, money: 900, upgrades: { engine: 2, grip: 1, armor: 0 }, unlockedTracks: ['t1'], racesFinished: 4, settings: {} };
    const s = sanitizeSave(v1, {});
    expect(s.version).toBe(3);
    expect(s.money).toBe(900);
    expect(s.carUpgrades[CONFIG.cars.starter]).toEqual({ engine: 2, grip: 1, armor: 0 });
    expect(s.carRaces[CONFIG.cars.starter]).toBe(4);
    expect(s.career).toEqual(defaultCareer());
  });

  it('a v3 save round-trips its career through JSON', () => {
    const base = defaultSave();
    let c = startRun(base.career, 'rookie', 77);
    c = commitRace(c, 'rookie', 0, places(2), { place: 2, broken: 5, health: 0.9, repairs: 0 }).career;
    const stored = JSON.parse(JSON.stringify({ ...base, career: c }));
    const back = sanitizeSave(stored, {});
    expect(back.version).toBe(3);
    expect(back.career).toEqual(c);
    expect(back.career.run?.seed).toBe(77);
  });

  it('garbage in the career field falls back to an empty career, the rest of the save survives', () => {
    for (const bad2 of [null, 5, 'x', [], { run: 'x', stars: 3, cups: [] }]) {
      const s = sanitizeSave({ version: 3, money: 12, career: bad2 }, {});
      expect(s.money).toBe(12);
      expect(s.career).toEqual(defaultCareer());
    }
  });

  it('a default save is v3 with an empty career', () => {
    const d = defaultSave();
    expect(d.version).toBe(3);
    expect(d.career).toEqual(defaultCareer());
  });
});
