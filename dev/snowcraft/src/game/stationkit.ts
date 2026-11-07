// Small shared helpers of the interactive objects (DESIGN §15): geometry of a fixture, per-fixture first-use hints (toast + one journal line),
// and a few numeric helpers. Imported by fixtures_station.ts / fixtures_radio.ts / fixtures_world.ts / stationobjects.ts.
import { G, toast, type Fixture, type FixtureKind } from './state';
import { TS } from '../engine/grid';
import { bridge } from './stationbridge';

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
/** Centre of a fixture's footprint in cells. */
export const cen = (f: Fixture): [number, number] => [f.tx * TS + (f.tw * TS) / 2, f.ty * TS + (f.th * TS) / 2];
/** The data bag of a fixture (created on demand). */
export const dd = (f: Fixture): Record<string, unknown> => f.data ?? (f.data = {});
export const num = (f: Fixture, k: string, d = 0): number => { const v = Number(f.data?.[k]); return Number.isFinite(v) && f.data?.[k] !== undefined ? v : d; };
export const ofKind = (kind: FixtureKind): Fixture[] => G.fixtures.filter(f => f.kind === kind);
/** Distance in cells from the player's chest to the fixture's rectangle. */
export function playerDist(f: Fixture): number {
  const p = G.player; if (!p) return 1e9;
  const x = p.x, y = p.y - 8;
  const dx = Math.max(f.tx * TS - x, 0, x - (f.tx + f.tw) * TS), dy = Math.max(f.ty * TS - y, 0, y - (f.ty + f.th) * TS);
  return Math.hypot(dx, dy);
}
/** Add a journal line (kind 'event'), capped like the quest log. */
export function logJournal(text: string) { const j = bridge.journal; if (j && j.length < 200) j.push({ kind: 'event', text, t: G.time }); }
/** First use of an object: a hint toast and one journal line, remembered in the fixture itself (saved with it). */
export function hintOnce(f: Fixture, key: string, text: string, kind: 'info' | 'good' | 'warn' = 'info') {
  const h = (dd(f).h as Record<string, number> | undefined) ?? (dd(f).h = {});
  if (h[key]) return;
  h[key] = 1; toast(text, kind); logJournal(text);
}
/** Minutes of game time -> "день 5, 06:00". */
export function clockText(t: number, dayWord: string): string {
  const day = Math.floor(t / 1440) + 1, m = Math.floor(t % 1440), hh = Math.floor(m / 60), mm = m % 60;
  return `${dayWord} ${day}, ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
/** Tiny seeded RNG for world placement (never touches the grid's rand()). */
export function lcg(seed: number) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
