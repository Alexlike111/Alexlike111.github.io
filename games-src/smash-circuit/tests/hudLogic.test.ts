import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import type { CarState, SimEvent } from '../src/types';
import {
  ComboTracker, PlaceWatcher, TakedownTracker, comboMultiplier, computeGaps, fitMap, fmtGap, fmtMult, gapSeconds, gapTrend, mapPoint,
} from '../src/ui/hudLogic';

const H = CONFIG.hud;

function car(id: number, place: number, progress: number, speed: number, extra: Partial<CarState> = {}): CarState {
  return { id, name: 'C' + id, place, progress, speed, x: 0, y: 0, finished: false, isPlayer: id === 0, ...extra } as unknown as CarState;
}

describe('gap computation', () => {
  it('gapSeconds divides distance by speed, floored so a stopped car stays finite', () => {
    expect(gapSeconds(40, 20)).toBeCloseTo(2, 6);
    expect(gapSeconds(40, 0)).toBeCloseTo(40 / H.gapMinSpeed, 6);
    expect(gapSeconds(-5, 20)).toBe(0);
  });

  it('gap ahead uses the player speed, gap behind uses the speed of the car behind', () => {
    const cars = [car(0, 2, 500, 25), car(1, 1, 540, 30), car(2, 3, 470, 15), car(3, 4, 300, 30)];
    const g = computeGaps(cars);
    expect(g.ahead?.id).toBe(1);
    expect(g.ahead?.gap).toBeCloseTo(40 / 25, 6);
    expect(g.behind?.id).toBe(2);
    expect(g.behind?.gap).toBeCloseTo(30 / 15, 6);
  });

  it('leader has no car ahead, last place has none behind', () => {
    const lead = computeGaps([car(0, 1, 100, 20), car(1, 2, 90, 20)]);
    expect(lead.ahead).toBeNull();
    expect(lead.behind?.id).toBe(1);
    const last = computeGaps([car(0, 2, 90, 20), car(1, 1, 100, 20)]);
    expect(last.behind).toBeNull();
    expect(last.ahead?.id).toBe(1);
  });

  it('hides lapped cars (gap over gapMaxS), finished cars and a finished player', () => {
    const far = computeGaps([car(0, 2, 0, 10), car(1, 1, 10 * H.gapMaxS + 500, 30)]);
    expect(far.ahead).toBeNull();
    const fin = computeGaps([car(0, 2, 100, 20), car(1, 1, 130, 20, { finished: true })]);
    expect(fin.ahead).toBeNull();
    const me = computeGaps([car(0, 1, 100, 20, { finished: true }), car(1, 2, 90, 20)]);
    expect(me.ahead).toBeNull();
    expect(me.behind).toBeNull();
  });

  it('never goes negative when progress is momentarily out of order', () => {
    const g = computeGaps([car(0, 2, 101, 20), car(1, 1, 100, 20)]);
    expect(g.ahead?.gap).toBe(0);
  });

  it('formats and trends', () => {
    expect(fmtGap(0.84)).toBe('0.8');
    expect(fmtGap(9.96)).toBe('10');
    expect(fmtGap(23.4)).toBe('23');
    expect(gapTrend(null, 2)).toBe(0);
    expect(gapTrend(2, 1.8)).toBe(-1);
    expect(gapTrend(2, 2.2)).toBe(1);
    expect(gapTrend(2, 2.01)).toBe(0);
  });
});

describe('position change watcher', () => {
  it('reports a new place only after it has held for the debounce time', () => {
    const w = new PlaceWatcher(0.35);
    expect(w.update(3, 0.016)).toBeNull();            // first reading = reference
    let out = null;
    for (let i = 0; i < 10; i++) out = out ?? w.update(2, 0.016);   // 0.16 s
    expect(out).toBeNull();
    for (let i = 0; i < 12; i++) out = out ?? w.update(2, 0.016);   // > 0.35 s
    expect(out).toEqual({ from: 3, to: 2 });
    expect(w.update(2, 1)).toBeNull();                // no repeat
  });

  it('ignores a flicker between two places (cars side by side)', () => {
    const w = new PlaceWatcher(0.35);
    w.update(3, 0.016);
    for (let i = 0; i < 40; i++) expect(w.update(i % 2 ? 3 : 2, 0.05)).toBeNull();
  });

  it('losing a place is reported too, and rebase swallows the change', () => {
    const w = new PlaceWatcher(0.2);
    w.update(2, 0.1);
    expect(w.update(3, 0.15)).toBeNull();
    expect(w.update(3, 0.15)).toEqual({ from: 2, to: 3 });
    w.rebase(5);
    expect(w.update(5, 1)).toBeNull();
    expect(w.update(4, 1)).toEqual({ from: 5, to: 4 });
  });
});

describe('smash combo', () => {
  it('multiplier grows by the step per chained smash and is capped', () => {
    expect(comboMultiplier(1)).toBe(1);
    expect(comboMultiplier(2)).toBeCloseTo(1 + H.comboStep, 6);
    expect(comboMultiplier(3)).toBeCloseTo(1 + 2 * H.comboStep, 6);
    expect(comboMultiplier(99)).toBe(H.comboMax);
    expect(fmtMult(1.5)).toBe('1.5');
    expect(fmtMult(3)).toBe('3');
  });

  it('smashes within the window chain, a gap longer than the window starts over', () => {
    const c = new ComboTracker(1.5);
    expect(c.hit(6, 10).chain).toBe(1);
    expect(c.hit(6, 11.4).chain).toBe(2);             // 1.4 s later: still chained
    expect(c.hit(6, 12.8).chain).toBe(3);             // measured from the previous smash, not the first
    expect(c.hit(6, 14.4).chain).toBe(1);             // 1.6 s later: new chain
    expect(c.best).toBe(3);
  });

  it('pays the multiplier on the base coins and accumulates the bonus', () => {
    const c = new ComboTracker(1.5);
    const a = c.hit(6, 0), b = c.hit(6, 0.5), d = c.hit(6, 1.0);
    expect(a.award).toBe(6);
    expect(a.bonus).toBe(0);
    expect(b.mult).toBeCloseTo(1.5, 6);
    expect(b.award).toBe(9);
    expect(d.mult).toBeCloseTo(2, 6);
    expect(d.award).toBe(12);
    expect(c.bonusTotal).toBe(0 + 3 + 6);
    expect(c.sum).toBe(6 + 9 + 12);
  });

  it('a free smash (cone) still extends the chain but pays nothing', () => {
    const c = new ComboTracker(1.5);
    c.hit(0, 0);
    const h = c.hit(0, 0.4);
    expect(h.chain).toBe(2);
    expect(h.award).toBe(0);
    expect(c.bonusTotal).toBe(0);
    expect(c.hit(6, 0.8).mult).toBeCloseTo(2, 6);
  });

  it('tick ends the chain once and only after the window; remaining() counts down', () => {
    const c = new ComboTracker(1.5);
    c.hit(6, 5); c.hit(6, 5.5);
    expect(c.active(6)).toBe(true);
    expect(c.remaining(5.5)).toBeCloseTo(1, 6);
    expect(c.remaining(6.25)).toBeCloseTo(0.5, 6);
    expect(c.tick(6.9)).toBeNull();
    expect(c.tick(7.1)).toEqual({ chain: 2, sum: 6 + 9 });
    expect(c.tick(7.2)).toBeNull();
    expect(c.active(7.2)).toBe(false);
    expect(c.remaining(7.2)).toBe(0);
    expect(c.best).toBe(2);
  });

  it('reset clears everything', () => {
    const c = new ComboTracker();
    c.hit(6, 1); c.hit(6, 1.2);
    c.reset();
    expect([c.chain, c.sum, c.best, c.bonusTotal]).toEqual([0, 0, 0, 0]);
    expect(c.hit(6, 1.3).chain).toBe(1);
  });
});

describe('takedown attribution', () => {
  const cars = (): CarState[] => [car(0, 2, 0, 0, { x: 0, y: 0 }), car(1, 1, 0, 0, { x: 3, y: 0 }), car(2, 3, 0, 0, { x: 80, y: 0 })];
  const impact = (x: number, y: number, other: 'car' | 'wall' = 'car'): SimEvent => ({ type: 'impact', x, y, strength: 1, carId: 1, other });
  const wrecked = (carId: number): SimEvent => ({ type: 'wrecked', carId });

  it('a rival wrecked right after a car-to-car contact with the player is a takedown', () => {
    const t = new TakedownTracker(2.5, 5, 10);
    expect(t.update([impact(1.5, 0)], cars(), 10)).toEqual([]);
    expect(t.update([wrecked(1)], cars(), 11.2)).toEqual([{ carId: 1, name: 'C1', kind: 'wreck' }]);
  });

  it('too late, no contact, or a contact somewhere else is not a takedown', () => {
    const t = new TakedownTracker(2.5, 5, 10);
    t.update([impact(1.5, 0)], cars(), 10);
    expect(t.update([wrecked(1)], cars(), 13)).toEqual([]);           // 3 s after the contact
    const t2 = new TakedownTracker(2.5, 5, 10);
    expect(t2.update([wrecked(1)], cars(), 5)).toEqual([]);           // never touched the player
    const t3 = new TakedownTracker(2.5, 5, 10);
    t3.update([impact(40, 0)], cars(), 5);                            // impact far from both cars
    expect(t3.update([wrecked(1)], cars(), 5.5)).toEqual([]);
  });

  it('wall hits and the player getting wrecked do not count', () => {
    const t = new TakedownTracker(2.5, 5, 10);
    t.update([impact(1.5, 0, 'wall')], cars(), 10);
    expect(t.update([wrecked(1)], cars(), 10.5)).toEqual([]);
    t.update([impact(1.5, 0)], cars(), 11);
    expect(t.update([wrecked(0)], cars(), 11.2)).toEqual([]);
  });

  it('a rival thrown into a wall hard right after the player hit it is a takedown, a soft wall touch is not', () => {
    const wall = (strength: number, other: 'wall' | 'prop' = 'wall'): SimEvent => ({ type: 'impact', x: 3, y: 9, strength, carId: 1, other });
    const t = new TakedownTracker(2.5, 5, 10, 0.45);
    t.update([impact(1.5, 0)], cars(), 10);
    expect(t.update([wall(0.3)], cars(), 10.6)).toEqual([]);
    expect(t.update([wall(0.6, 'prop')], cars(), 11)).toEqual([{ carId: 1, name: 'C1', kind: 'wall' }]);
    // a wall hit with no recent contact with the player (the rival crashed on its own) does not count
    const t2 = new TakedownTracker(2.5, 5, 10, 0.45);
    expect(t2.update([wall(0.9)], cars(), 10)).toEqual([]);
    t2.update([impact(1.5, 0)], cars(), 20);
    expect(t2.update([wall(0.9)], cars(), 23)).toEqual([]);
  });

  it('the same rival cannot be taken down again inside the cooldown (no farming)', () => {
    const t = new TakedownTracker(2.5, 5, 10);
    t.update([impact(1.5, 0)], cars(), 10);
    expect(t.update([wrecked(1)], cars(), 10.5)).toHaveLength(1);
    t.update([impact(1.5, 0)], cars(), 12);
    expect(t.update([wrecked(1)], cars(), 12.5)).toEqual([]);
    t.update([impact(1.5, 0)], cars(), 21);
    expect(t.update([wrecked(1)], cars(), 21.5)).toHaveLength(1);
  });
});

describe('minimap fit', () => {
  it('fits a wide track inside the square with the margin and centres it', () => {
    const xs = [0, 200, 200, 0], ys = [0, 0, 50, 50];
    const f = fitMap(xs, ys, 100, 10);
    const a = mapPoint(f, 0, 0), b = mapPoint(f, 200, 50);
    expect(a.x).toBeCloseTo(10, 6);
    expect(b.x).toBeCloseTo(90, 6);
    // 200 x 50 m scaled by 0.4: 80 x 20 px, centred vertically (40..60), north up (y flipped)
    expect(a.y).toBeCloseTo(60, 6);
    expect(b.y).toBeCloseTo(40, 6);
    for (const [x, y] of [[0, 0], [200, 0], [200, 50], [0, 50]]) {
      const q = mapPoint(f, x, y);
      expect(q.x).toBeGreaterThanOrEqual(10 - 1e-6); expect(q.x).toBeLessThanOrEqual(90 + 1e-6);
      expect(q.y).toBeGreaterThanOrEqual(10 - 1e-6); expect(q.y).toBeLessThanOrEqual(90 + 1e-6);
    }
  });

  it('is robust against an empty or single-point track', () => {
    expect(Number.isFinite(fitMap([], [], 100, 10).scale)).toBe(true);
    const f = fitMap([5], [5], 100, 10);
    const q = mapPoint(f, 5, 5);
    expect(Number.isFinite(q.x) && Number.isFinite(q.y)).toBe(true);
  });
});

import { resultsHeading } from '../src/ui/hudLogic';
import { t as tr, setLangSetting as setLangForTest } from '../src/i18n';
describe('results heading by place', () => {
  it('winner, podium, finished nth', () => {
    expect(resultsHeading(1).key).toBe('results.title.win');
    expect(resultsHeading(2).key).toBe('results.title.podium'); expect(resultsHeading(3).key).toBe('results.title.podium');
    for (const p of [4, 5, 8]) { const h = resultsHeading(p); expect(h.key).toBe('results.title.fin'); expect(h.ord).toBe(p); }
    expect(resultsHeading(99).ord).toBe(8); expect(resultsHeading(0).key).toBe('results.title.win'); expect(resultsHeading(NaN).ord).toBe(8);
  });
  it('is worded in English and Russian', () => {
    setLangForTest('en');
    expect(tr('results.title.win')).toBe('Winner!'); expect(tr('results.title.fin', { ord: tr('ordinal.8') })).toBe('Finished 8th');
    setLangForTest('ru');
    expect(tr('results.title.podium')).toBe('Подиум!'); expect(tr('results.title.fin', { ord: tr('ordinal.5') })).toBe('Финиш: 5-е');
    setLangForTest('en');
  });
});
