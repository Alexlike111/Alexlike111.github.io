// In-race HUD logic with no DOM: time gaps, position-change watcher, smash combo, takedown attribution, minimap fitting.
// Unit tested in tests/hudLogic.test.ts; the DOM side lives in hud.ts. All numbers in CONFIG.hud.
import { CONFIG } from '../config';
import type { CarState, SimEvent } from '../types';

// ------------------------------------------------------------------------------------------------ gaps

/** Seconds needed to cover `dist` metres at `speed` m/s; the speed is floored so a stopped car does not give infinity. */
export function gapSeconds(dist: number, speed: number, minSpeed: number = CONFIG.hud.gapMinSpeed): number {
  return Math.max(0, dist) / Math.max(minSpeed, speed);
}

export interface GapInfo { id: number; name: string; dist: number; gap: number }
export interface Gaps { ahead: GapInfo | null; behind: GapInfo | null }

/**
 * Time gap from the player to the car one place ahead (how long the player needs to get to where it is, at the player's
 * speed) and to the car one place behind (how long that car needs to reach the player, at its speed). `null` when there is
 * no such car, when it has finished, or when the gap is bigger than CONFIG.hud.gapMaxS (lapped cars).
 */
export function computeGaps(cars: readonly CarState[], playerIdx = 0): Gaps {
  const p = cars[playerIdx];
  const out: Gaps = { ahead: null, behind: null };
  if (!p || p.finished) return out;
  const max = CONFIG.hud.gapMaxS;
  for (const c of cars) {
    if (c === p) continue;
    if (c.place === p.place - 1 && !c.finished) {
      const dist = Math.max(0, c.progress - p.progress);
      const gap = gapSeconds(dist, p.speed);
      if (gap <= max) out.ahead = { id: c.id, name: c.name, dist, gap };
    } else if (c.place === p.place + 1 && !c.finished) {
      const dist = Math.max(0, p.progress - c.progress);
      const gap = gapSeconds(dist, c.speed);
      if (gap <= max) out.behind = { id: c.id, name: c.name, dist, gap };
    }
  }
  return out;
}

/** "0.8" under 10 s, whole seconds above. */
export function fmtGap(gap: number): string {
  const g = Math.max(0, gap);
  return g < 9.95 ? g.toFixed(1) : String(Math.round(g));
}

/** Compares a gap with the previous reading: -1 closing (smaller), +1 opening, 0 steady. */
export function gapTrend(prev: number | null, now: number, eps: number = CONFIG.hud.gapCloseEps): -1 | 0 | 1 {
  if (prev === null) return 0;
  const d = now - prev;
  return d < -eps ? -1 : d > eps ? 1 : 0;
}

// ------------------------------------------------------------------------------------------------ position change

/**
 * Watches the player's place. A new place must hold for `debounce` seconds before it is reported (two cars side by side swap
 * places every frame). `rebase` sets the reference without reporting (countdown, start scramble, respawn).
 */
export class PlaceWatcher {
  private stable = 0;
  private cand = 0;
  private candT = 0;
  constructor(private readonly debounce: number = CONFIG.hud.placeDebounceS) {}

  reset(): void { this.stable = 0; this.cand = 0; this.candT = 0; }

  rebase(place: number): void { this.stable = place; this.cand = place; this.candT = 0; }

  /** Feed the current place every frame. Returns the change once it has held long enough, else null. */
  update(place: number, dt: number): { from: number; to: number } | null {
    if (this.stable === 0) { this.rebase(place); return null; }
    if (place === this.stable) { this.cand = place; this.candT = 0; return null; }
    if (place !== this.cand) { this.cand = place; this.candT = 0; }
    this.candT += dt;
    if (this.candT < this.debounce) return null;
    const from = this.stable;
    this.rebase(place);
    return { from, to: place };
  }
}

// ------------------------------------------------------------------------------------------------ smash combo

/** Multiplier of the n-th smash of a chain (n >= 1): 1 + step per extra smash, capped. */
export function comboMultiplier(chain: number, step: number = CONFIG.hud.comboStep, max: number = CONFIG.hud.comboMax): number {
  return Math.min(max, 1 + step * Math.max(0, chain - 1));
}

/** "1.5", "2", "3": no trailing zeros. */
export function fmtMult(m: number): string {
  return String(Math.round(m * 10) / 10);
}

export interface ComboHit {
  /** smashes in the current chain, this one included */
  chain: number;
  mult: number;
  /** coins this smash pays with the multiplier (never below `base`) */
  award: number;
  /** extra coins over the base pay */
  bonus: number;
}

/**
 * Chain of quick smashes. Each smash within `windowS` of the previous one extends the chain and raises the multiplier;
 * the bonus (award - base) is accumulated in `bonusTotal` for the race result. Times are the race clock (seconds).
 */
export class ComboTracker {
  chain = 0;
  sum = 0;
  best = 0;
  bonusTotal = 0;
  private last = -Infinity;
  constructor(private readonly windowS: number = CONFIG.hud.comboWindowS) {}

  reset(): void { this.chain = 0; this.sum = 0; this.best = 0; this.bonusTotal = 0; this.last = -Infinity; }

  /** Is a chain running at race time `now`? */
  active(now: number): boolean { return this.chain > 0 && now - this.last <= this.windowS; }

  /** 1 (just hit) .. 0 (chain about to end). */
  remaining(now: number): number {
    return this.active(now) ? Math.max(0, 1 - (now - this.last) / this.windowS) : 0;
  }

  /** Call every frame: returns the finished chain (length, coins) once, when the window has just run out. */
  tick(now: number): { chain: number; sum: number } | null {
    if (this.chain > 0 && now - this.last > this.windowS) {
      const r = { chain: this.chain, sum: this.sum };
      this.chain = 0; this.sum = 0;
      return r;
    }
    return null;
  }

  /** A smash worth `base` coins at race time `now`. */
  hit(base: number, now: number): ComboHit {
    if (this.chain > 0 && now - this.last > this.windowS) { this.chain = 0; this.sum = 0; }
    this.chain++;
    this.last = now;
    const mult = comboMultiplier(this.chain);
    const b = Math.max(0, Math.round(base));
    const award = Math.max(b, Math.round(b * mult));
    const bonus = award - b;
    this.sum += award;
    this.bonusTotal += bonus;
    if (this.chain > this.best) this.best = this.chain;
    return { chain: this.chain, mult, award, bonus };
  }
}

// ------------------------------------------------------------------------------------------------ takedowns

export interface Takedown { carId: number; name: string; /** wrecked outright, or thrown into a wall / prop hard right after the player's hit */ kind: 'wreck' | 'wall' }

/**
 * Takedown attribution without touching the sim (GDD 9.2): a car-to-car `impact` event whose point is within `contactR` of
 * both the player and a rival marks a contact with that rival; if within `windowS` of it the rival is `wrecked`, or hits a wall /
 * prop with strength >= `wallStrength`, the player took it down. The same rival cannot be taken down again within
 * `cooldownS` (no farming).
 */
export class TakedownTracker {
  private contact = new Map<number, number>();
  private done = new Map<number, number>();
  constructor(
    private readonly windowS: number = CONFIG.hud.takedownWindowS,
    private readonly contactR: number = CONFIG.hud.takedownContactR,
    private readonly cooldownS: number = CONFIG.hud.takedownCooldownS,
    private readonly wallStrength: number = CONFIG.hud.takedownWallStrength,
  ) {}

  reset(): void { this.contact.clear(); this.done.clear(); }

  /** Feed the events of a frame; `now` = race clock, `cars[playerIdx]` = the player. Returns the takedowns found. */
  update(events: readonly SimEvent[], cars: readonly CarState[], now: number, playerIdx = 0): Takedown[] {
    const p = cars[playerIdx];
    if (!p) return [];
    let out: Takedown[] | null = null;
    const award = (carId: number, kind: Takedown['kind']): void => {
      if (carId === p.id) return;
      const t = this.contact.get(carId);
      if (t === undefined || now - t > this.windowS) return;
      const d = this.done.get(carId);
      if (d !== undefined && now - d < this.cooldownS) return;
      this.done.set(carId, now);
      (out ??= []).push({ carId, name: cars.find((c) => c.id === carId)?.name ?? '', kind });
    };
    for (const e of events) {
      if (e.type === 'impact') {
        if (e.other === 'car') {
          if (Math.hypot(p.x - e.x, p.y - e.y) > this.contactR) continue;
          for (const c of cars) {
            if (c === p) continue;
            if (Math.hypot(c.x - e.x, c.y - e.y) <= this.contactR) this.contact.set(c.id, now);
          }
        } else if (e.strength >= this.wallStrength && e.other !== 'road' && e.other !== 'curb') {
          award(e.carId, 'wall');
        }
      } else if (e.type === 'wrecked') award(e.carId, 'wreck');
    }
    return out ?? [];
  }
}

// ------------------------------------------------------------------------------------------------ minimap

export interface MapFit { minX: number; minY: number; scale: number; offX: number; offY: number; size: number }

/**
 * Uniform fit of a point cloud into a square of `size` px with `pad` px margin, north-up (physics +y points up the map).
 */
export function fitMap(xs: ArrayLike<number>, ys: ArrayLike<number>, size: number, pad: number): MapFit {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] < x0) x0 = xs[i];
    if (xs[i] > x1) x1 = xs[i];
    if (ys[i] < y0) y0 = ys[i];
    if (ys[i] > y1) y1 = ys[i];
  }
  if (!Number.isFinite(x0)) { x0 = 0; y0 = 0; x1 = 1; y1 = 1; }
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  const inner = Math.max(1, size - pad * 2);
  const scale = inner / Math.max(w, h);
  return { minX: x0, minY: y0, scale, offX: pad + (inner - w * scale) / 2, offY: pad + (inner - h * scale) / 2, size };
}

/** World (x, y) -> map pixel (north-up: y flipped). */
export function mapPoint(fit: MapFit, x: number, y: number): { x: number; y: number } {
  return { x: fit.offX + (x - fit.minX) * fit.scale, y: fit.size - (fit.offY + (y - fit.minY) * fit.scale) };
}
