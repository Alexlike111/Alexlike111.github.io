// Seasons-ring calendar (night 12 d -> twilight 6 d -> ..., DESIGN §18), clock, weather. Everything is a pure function of the game clock
// plus the per-ring storm schedule, so time-warp (sleep ×20) and dev jumps (setDay) stay consistent. Writes G.time/day/cycle/daylight/
// sunElev/noonElev/moon/aurora/ambientT/wind/storm/snowfall/visibility/forecast. Emits 'day', 'season', 'storm_start', 'storm_end'.
import { G, toast } from './state';
import { emit, on } from './bus';
import { strings, fmt } from '../content/i18n';
import { noise1 } from '../engine/grid';
import { count } from './inventory';
import { finishStormReport } from './shelter';
import { noonElevAtTime, cycleOf, phaseOfDay, recomputeRamp, ramp, rampAt, RING_DAYS } from './seasons';

const S = strings('weather', {
  calm: 'Давление ровное. Погода держится.',
  falling: 'Давление падает: через ~{h} ч придёт пурга ({kind}).',
  raging: 'Пурга. Давление на дне.',
  rising: 'Давление растёт: пурга уходит.',
  hint: 'Ветер меняется, небо затягивает…',
  kindMild: 'умеренная', kindBig: 'сильная', kindHuge: 'самая большая',
  barometerRead: 'Барометр: {t}',
});

// game minutes per real second: a game day is 1440 / 1.2 = 1200 real seconds = 20 real minutes (v13 playtest: 2.4 ran a day in 10 minutes
// and the first night came before the player had found the stove). Game-minute durations (fuel, hunger, storms, drift) keep their meaning.
export const MIN_PER_SEC = 1.2;
export const DAY_MIN = 1440;
export const START_TIME = 11 * 60;              // new game: day 1, 11:00 (blue twilight, noon is at 12:00)

export interface Storm { n: number; start: number; dur: number; peak: number; lead: number; dir: 1 | -1 }
const at = (day: number, hour: number) => (day - 1) * DAY_MIN + hour * 60;
// Ring 0 (the tutorial ring): night of day 2 (first exam, moderate), day 5 (24 h), day 8 (night), day 10-11 (the big one, 30 h)
export const STORMS: Storm[] = [
  { n: 1, start: at(2, 19), dur: 9 * 60, peak: 0.55, lead: 6 * 60, dir: -1 },
  { n: 2, start: at(5, 6), dur: 24 * 60, peak: 0.85, lead: 8 * 60, dir: 1 },
  { n: 3, start: at(8, 18), dur: 10 * 60, peak: 0.75, lead: 7 * 60, dir: -1 },
  { n: 4, start: at(10, 14), dur: 30 * 60, peak: 1.0, lead: 10 * 60, dir: -1 },
];
const hash = (n: number) => { const s = Math.sin(n * 91.7 + 12.3) * 43758.5453; return s - Math.floor(s); };
const ringCache = new Map<string, Storm[]>();
/** Storm schedule of seasons ring c (deterministic): ring 0 is the fixed tutorial set; later rings get more (ramp.storm) and, in twilight, a few calm ones. */
export function ringStorms(c: number): Storm[] {
  if (c < 0) return [];
  if (c === 0) return STORMS;
  const key = c + ':' + (G.diff?.level ?? 1) + ':' + seed;
  const hit = ringCache.get(key); if (hit) return hit;
  const out: Storm[] = [], base = c * RING_DAYS * DAY_MIN, r = rampAt(c).storm, h = (k: number) => hash(c * 131 + seed * 17 + k);
  const nN = Math.min(8, Math.floor(4 * r + h(1)));
  const span = 10.4 / nN;                                                 // days between night storms (they start day 2 and end before day 12.4)
  for (let i = 0; i < nN; i++) {
    const day = 1.9 + (i + 0.15 + 0.5 * h(10 + i)) * span;
    const dur = (6 + Math.min(span * 24 - 8, 22) * h(20 + i)) * 60 | 0;
    out.push({ n: c * 10 + i + 1, start: base + (day - 1) * DAY_MIN | 0, dur: Math.max(6 * 60, dur), peak: Math.min(1, 0.5 + 0.5 * h(30 + i) + (i === nN - 1 ? 0.2 : 0)), lead: (6 + 4 * h(40 + i)) * 60 | 0, dir: h(50 + i) < 0.5 ? -1 : 1 });
  }
  const nT = (c >= 2 || h(2) < 0.5 ? 1 : 0) + (c >= 5 ? 1 : 0);
  for (let i = 0; i < nT; i++) {
    const day = 13.6 + i * 2.6 + h(60 + i) * 1.2;
    out.push({ n: c * 10 + 9 - i, start: base + (day - 1) * DAY_MIN | 0, dur: (6 + 8 * h(70 + i)) * 60 | 0, peak: 0.3 + 0.25 * h(80 + i), lead: 6 * 60, dir: h(90 + i) < 0.5 ? -1 : 1 });
  }
  out.sort((a, b) => a.start - b.start);
  ringCache.set(key, out);
  return out;
}
/** Storms of the previous, current and next ring around clock time t (sorted by start). */
export function stormsAround(t: number): Storm[] {
  const c = cycleOf(Math.floor(t / DAY_MIN) + 1);
  return [...ringStorms(c - 1), ...ringStorms(c), ...ringStorms(c + 1)];
}
const RAMP = 90;                                 // minutes of build-up / decay at the edges of a storm

const ss = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Noon sun elevation (deg): −9° in the polar night, a low bell up to ≈ +0.6° in the twilight «day» of each ring (seasons.ts). */
export function noonElevAt(timeMin: number): number { return noonElevAtTime(timeMin); }
export const DIURNAL = 17;                       // degrees between noon and the nadir
export function sunElevAt(timeMin: number): number {
  const h = ((timeMin % DAY_MIN) + DAY_MIN) % DAY_MIN / 60;
  return noonElevAt(timeMin) - DIURNAL * (1 - Math.cos(2 * Math.PI * (h - 12) / 24)) / 2;
}
export function daylightOf(elev: number): number { return Math.pow(ss(-12.5, 0.5, elev), 1.1); }
/** Storm intensity 0..1 of a storm at a clock time. */
export function stormIntensity(s: Storm, t: number): number {
  const up = ss(s.start, s.start + RAMP, t), down = 1 - ss(s.start + s.dur - RAMP, s.start + s.dur, t);
  return s.peak * Math.min(up, down);
}
function stormLevel(t: number) { let m = 0; for (const s of stormsAround(t)) { const v = stormIntensity(s, t); if (v > m) m = v; } return m; }
function precursor(t: number) { let m = 0; for (const s of stormsAround(t)) m = Math.max(m, 0.14 * ss(s.start - 200, s.start, t) * (t < s.start + s.dur ? 1 : 0)); return m; }

let seed = 1, lastDay = 0, rampDay = -1, active = -1, hinted = new Set<number>(), baromReadAt = -1e9, lastStormEnd = -1e9;
export const weatherState = { cloud: 0, windBase: 2, stormN: 0 };
/** Dev/test override of weather globals (storm, snowfall, visibility, wind, ambientT, aurora, daylight); null = natural weather. */
export const wx = { override: null as null | Partial<Pick<typeof G, 'storm' | 'snowfall' | 'visibility' | 'wind' | 'ambientT' | 'aurora' | 'daylight'>> };

/** Hooks for the radio / weather balloon (fixtures_station.ts): a precise forecast read over the radio overrides G.forecast and counts as known. */
export const wxHooks = { forecast: null as null | ((t: number) => void), knows: null as null | (() => boolean) };


/** Evaluate all weather globals for G.time (no events). */
export function applyClock() {
  const t = G.time;
  G.day = Math.floor(t / DAY_MIN) + 1;
  if (rampDay !== G.day) { rampDay = G.day; recomputeRamp(); }
  G.noonElev = noonElevAt((G.day - 1) * DAY_MIN + 720);
  G.sunElev = sunElevAt(t);
  G.daylight = daylightOf(G.sunElev);
  const h = ((t % DAY_MIN) + DAY_MIN) % DAY_MIN / 60;
  // moon
  const p = (((0.5 + (t / DAY_MIN - 5.5) / 29.53) % 1) + 1) % 1;
  G.moonPhase = p;
  const illum = (1 - Math.cos(2 * Math.PI * p)) / 2;
  const up = ss(-0.3, 0.7, -Math.cos(2 * Math.PI * (h / 24 - p)));
  G.moon = illum * (0.3 + 0.7 * up);
  // storm & clouds
  const st = Math.max(stormLevel(t), precursor(t));
  G.storm = st;
  const cloud = clamp(noise1(t / 380 + seed * 3.1) * 1.5 - 0.35, 0, 1);
  weatherState.cloud = Math.max(cloud * 0.6, st);
  // wind: slow noise, direction flips through zero; storms override with their own heading
  const warm = ss(-8, -0.5, G.noonElev);                // 0 deep polar night .. 1 mid twilight «day» (calmer, a little warmer)
  const w0 = 8 * (1 - 0.35 * warm) * Math.pow(noise1(t / 260 + seed * 1.7), 1.5);
  const dirf = clamp(Math.cos(t / 1700 + seed) * 3, -1, 1);
  let wind = w0 * dirf;
  let stormDir = 1, bestI = 0;
  for (const s of stormsAround(t)) { const v = stormIntensity(s, t); if (v > bestI) { bestI = v; stormDir = s.dir; } }
  if (bestI > 0) {
    const gust = 1 + 0.18 * Math.sin(t * 0.9) + 0.12 * Math.sin(t * 2.3 + 1);
    const sw = stormDir * (12 + 8 * bestI) * gust * ramp.wind;     // 20 m/s at the peak (gusts add up to ~30%), +8 %/ring
    wind = wind * (1 - Math.min(1, bestI * 1.6)) + sw * Math.min(1, bestI * 1.6);
  }
  G.wind = wind;
  weatherState.windBase = w0;
  // temperature: clear calm night is the coldest
  // The day/night swing uses the sun's phase, not daylight: in the polar night daylight barely changes between noon and midnight.
  const sunF = (1 + Math.cos(2 * Math.PI * (h - 12) / 24)) / 2;      // 1 at noon, 0 at midnight
  const night = 1 - sunF, calm = 1 - Math.min(1, Math.abs(wind) / 8), clear = 1 - Math.min(1, 0.9 * st + 0.35 * weatherState.cloud);
  const cc = clear * calm;
  G.ambientT = -24 - 16 * cc * (0.4 + 0.6 * night) + 4 * cc + 2.2 * Math.sin(t / 520 + seed) + (st > 0.3 ? 3 : 0) + 7 * warm * (0.5 + 0.5 * sunF);   // clear calm: noon ~ -26, midnight -36
  G.snowfall = clamp(0.06 + 0.2 * weatherState.cloud + 0.8 * st, 0, 1);
  G.visibility = clamp(1 - 0.68 * st - 0.08 * weatherState.cloud, 0.25, 1);
  // aurora: strength per night, only when the sky is clear
  const nightIdx = Math.floor((t - 720) / DAY_MIN);
  const strength = 0.25 + 0.75 * hash(nightIdx + seed * 7);
  G.aurora = strength * (0.7 + 0.3 * Math.sin(t / 37)) * (1 - Math.min(1, st * 1.4 + weatherState.cloud * 0.5)) * (1 - 0.55 * warm);
  if (wx.override) Object.assign(G, wx.override);
  updateForecast(t);
  wxHooks.forecast?.(t);
}

function updateForecast(t: number) {
  const next = nextStormAt(t);
  const f = G.forecast;
  if (!next) { f.stormAt = -1; f.text = S.calm; return; }
  if (t >= next.start) { f.stormAt = next.start; f.text = t < next.start + next.dur - RAMP ? S.raging : S.rising; return; }
  if (t >= next.start - next.lead) {
    const hrs = Math.max(1, Math.round((next.start - t) / 60));
    f.stormAt = next.start;
    f.text = fmt(S.falling, { h: hrs, kind: next.peak >= 1 ? S.kindHuge : next.peak >= 0.75 ? S.kindBig : S.kindMild });
  } else { f.stormAt = -1; f.text = S.calm; }
}

/** The player owns the pocket barometer or read the station one in the last 12 game hours. */
export function knowsForecast(): boolean { return count('barometer') > 0 || G.time - baromReadAt < 12 * 60 || !!wxHooks.knows?.(); }
/** Interact with the station barometer: reveals the forecast for 12 hours. */
export function readBarometer() { baromReadAt = G.time; toast(fmt(S.barometerRead, { t: G.forecast.text }), 'info'); emit('barometer', { text: G.forecast.text }); }
/** Next storm that has not ended yet. */
export function nextStorm(): Storm | null { return nextStormAt(G.time); }
function nextStormAt(t: number): Storm | null { for (const s of stormsAround(t)) if (t < s.start + s.dur) return s; return null; }
/** Storm number currently raging (intensity > 0.15), or 0. */
export function stormNow(): number { return active > 0 ? active : 0; }

function syncFlags() {
  active = -1;
  for (const s of stormsAround(G.time)) if (stormIntensity(s, G.time) > 0.15) active = s.n;
  lastDay = G.day;
  hinted = new Set(stormsAround(G.time).filter(s => G.time > s.start - 180).map(s => s.n));
}

export function initWeather(s = 1) {
  seed = (s % 97) + 1; G.seed = s; ringCache.clear();
  G.time = START_TIME; G.timeScale = 1; hinted = new Set(); baromReadAt = -1e9; active = -1; rampDay = -1;
  applyClock(); syncFlags(); lastDay = G.day;
}

/** Dev/test: jump to day n (1-based) at the given hour; storm flags are re-synced silently. */
export function setDay(n: number, hour = 10) {
  G.time = at(Math.max(1, n), hour);
  applyClock(); syncFlags();
}
export function setClock(minutes: number) { G.time = minutes; applyClock(); syncFlags(); }
/** After load: re-derive everything from G.time (ramp, ring, flags) without events. */
export function resyncWeather() { rampDay = -1; ringCache.clear(); applyClock(); syncFlags(); }

/** Advance the clock. dt = real seconds of the frame. Uses G.timeScale (sleep warp). */
export function stepWeather(dt: number) {
  if (dt <= 0 || G.paused) return;
  G.time += dt * MIN_PER_SEC * G.timeScale;
  applyClock();
  if (G.day !== lastDay) {
    for (let d = lastDay + 1; d <= G.day; d++) {
      emit('day', { n: d });
      if (d > 1 && phaseOfDay(d) !== phaseOfDay(d - 1)) emit('season', { phase: phaseOfDay(d), cycle: cycleOf(d), day: d });
    }
    lastDay = G.day;
  }
  // storms
  const t = G.time;
  for (const s of stormsAround(t)) {
    const v = stormIntensity(s, t);
    if (active !== s.n && v > 0.15 && t < s.start + s.dur) { active = s.n; weatherState.stormN = s.n; emit('storm_start', { n: s.n, peak: s.peak }); }
    else if (active === s.n && v < 0.05 && t > s.start + s.dur / 2) {
      active = -1; lastStormEnd = t;
      emit('storm_end', { n: s.n, report: finishStormReport(s.n) });
    }
    if (!hinted.has(s.n) && t > s.start - 180 && t < s.start + 30) {
      hinted.add(s.n);
      if (count('barometer') === 0) toast(S.hint, 'warn');
    }
  }
}
export { lastStormEnd };
