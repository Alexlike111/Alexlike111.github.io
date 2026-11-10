// Seasons ring (DESIGN §18): polar night 12 days -> twilight «day» 6 days -> night ... forever. Pure functions of the day number.
// `ramp` = per-ring difficulty multipliers (capped), recomputed from G.cycle and G.diff each day and on load; other systems just read it.
import { storeGet, storeSet, storeRemove } from '../platform/store';
import { G } from './state';
import { strings, fmt } from '../content/i18n';

const S = strings('seasons', { day: 'День {d} · {p} · круг {c}', night: 'Ночь', twilight: 'Сумерки', dayShort: 'День {d}' });

export const NIGHT_DAYS = 12, TWI_DAYS = 6, RING_DAYS = NIGHT_DAYS + TWI_DAYS;
export const ramp = { storm: 1, wind: 1, drift: 1, bear: 1, thinIce: 1 };

/** Ring index (0,1,2...) of a 1-based day number. */
export function cycleOf(day: number): number { return Math.floor((Math.max(1, day) - 1) / RING_DAYS); }
/** Day within the ring, 0..17. */
export function ringDay(day: number): number { return (Math.max(1, day) - 1) % RING_DAYS; }
export function phaseOfDay(day: number): 'night' | 'twilight' { return ringDay(day) < NIGHT_DAYS ? 'night' : 'twilight'; }
/** Current phase of the seasons ring (from G.day). */
export function phaseName(): 'night' | 'twilight' { return phaseOfDay(G.day); }

const DK = [0.7, 1, 1.25];                       // difficulty scale of the ramp (Мягкая / Обычная / Суровая)
/** Recompute G.cycle and the ramp multipliers (call after the day changes and after load). */
export function rampAt(c: number, level = G.diff?.level ?? 1): typeof ramp {
  const k = DK[level] ?? 1;
  return { storm: 1 + Math.min(0.8, 0.08 * c) * k, wind: 1 + Math.min(0.8, 0.08 * c) * k, drift: 1 + Math.min(1, 0.12 * c) * k,
    thinIce: 1 + Math.min(1, 0.1 * c) * k, bear: 1 + Math.min(0.4, 0.05 * c) * k };
}
export function recomputeRamp(): void {
  const c = cycleOf(G.day); G.cycle = c;
  Object.assign(ramp, rampAt(c));
}
/** A second bear from ring 3. */
export function bearCount(): number { return G.cycle >= 3 ? 2 : 1; }
/** Noon sun elevation (deg) as a continuous function of the clock (game minutes): flat deep night (-9) for ~9 days, a bell over the end of the night and
 *  the twilight days 13-18 (noon of the middle days 15-16 just above the horizon, +0.6; days 14/17 about -1.4; day 13/18 -4.7), then dark again. */
export function noonElevAtTime(timeMin: number): number {
  const p = ((timeMin / 1440 - 0.5) % RING_DAYS + RING_DAYS) % RING_DAYS + 0.5;      // days since ring start at this day's noon (noon of day r -> r + 0.5)
  let d = Math.abs(p - 15); if (d > RING_DAYS / 2) d = RING_DAYS - d;
  const u = Math.min(1, d / 4.2), c = Math.cos(u * Math.PI / 2);
  return -9 + 9.9 * Math.pow(c * c, 0.8);
}
export function noonElevOfDay(day: number): number { return noonElevAtTime((day - 1) * 1440 + 720); }

/** Personal record (localStorage `sc.best`, never throws): the longest run in days and the ring it reached. */
export interface Best { day: number; cycle: number }
export function loadBest(): Best | null {
  try { const r = JSON.parse(storeGet('sc.best') || 'null'); return r && typeof r.day === 'number' ? { day: r.day, cycle: r.cycle | 0 } : null; } catch { return null; }
}
/** Record the current run if it beat the best; returns { best, isNew }. */
export function saveBest(day = G.day, cycle = G.cycle): { best: Best; isNew: boolean } {
  const old = loadBest(), isNew = !old || day > old.day;
  const best = isNew ? { day, cycle } : old!;
  if (isNew) { try { storeSet('sc.best', JSON.stringify(best)); } catch { /* storage blocked */ } }
  return { best, isNew };
}

/** HUD label: «День N · Ночь/Сумерки · круг C» (C counts from 1). */
export function seasonLabel(): string { return fmt(S.day, { d: G.day, p: phaseName() === 'night' ? S.night : S.twilight, c: G.cycle + 1 }); }
