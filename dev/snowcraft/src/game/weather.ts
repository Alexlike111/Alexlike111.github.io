// Polar-night calendar, clock, weather (DESIGN §2). Everything is a pure function of the game clock plus the storm schedule,
// so time-warp (sleep ×20) and dev jumps (setDay) stay consistent. Writes G.time/day/daylight/sunElev/noonElev/moon/aurora/
// ambientT/wind/storm/snowfall/visibility/forecast. Emits 'day', 'storm_start', 'storm_end', 'ending'.
import { G, toast } from './state';
import { emit, on } from './bus';
import { strings, fmt } from '../content/i18n';
import { noise1 } from '../engine/grid';
import { count } from './inventory';
import { finishStormReport } from './shelter';

const S = strings('weather', {
  calm: 'Давление ровное. Погода держится.',
  falling: 'Давление падает: через ~{h} ч придёт пурга ({kind}).',
  raging: 'Пурга. Давление на дне.',
  rising: 'Давление растёт: пурга уходит.',
  hint: 'Ветер меняется, небо затягивает…',
  kindMild: 'умеренная', kindBig: 'сильная', kindHuge: 'самая большая',
  barometerRead: 'Барометр: {t}',
  sunrise: 'Край солнца!',
});

export const MIN_PER_SEC = 2.4;                 // game minutes per real second
export const DAY_MIN = 1440;
export const START_TIME = 11 * 60;              // new game: day 1, 11:00 (blue twilight, noon is at 12:00)

export interface Storm { n: number; start: number; dur: number; peak: number; lead: number; dir: 1 | -1 }
const at = (day: number, hour: number) => (day - 1) * DAY_MIN + hour * 60;
// night of day 2 (first exam, moderate), day 5 (24 h), day 8 (night), day 10-11 (the big one, 30 h)
export const STORMS: Storm[] = [
  { n: 1, start: at(2, 19), dur: 9 * 60, peak: 0.55, lead: 6 * 60, dir: -1 },
  { n: 2, start: at(5, 6), dur: 24 * 60, peak: 0.85, lead: 8 * 60, dir: 1 },
  { n: 3, start: at(8, 18), dur: 10 * 60, peak: 0.75, lead: 7 * 60, dir: -1 },
  { n: 4, start: at(10, 14), dur: 30 * 60, peak: 1.0, lead: 10 * 60, dir: -1 },
];
const RAMP = 90;                                 // minutes of build-up / decay at the edges of a storm

const ss = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Noon sun elevation (deg) as a continuous function of the clock: −9° on day 1 → +0.5° on day 12. */
export function noonElevAt(timeMin: number): number { return clamp(-9 + 9.5 * ((timeMin / DAY_MIN - 0.5) / 11), -9.5, 1.2); }
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
function stormLevel(t: number) { let m = 0; for (const s of STORMS) { const v = stormIntensity(s, t); if (v > m) m = v; } return m; }
function precursor(t: number) { let m = 0; for (const s of STORMS) m = Math.max(m, 0.14 * ss(s.start - 200, s.start, t) * (t < s.start + s.dur ? 1 : 0)); return m; }

let seed = 1, lastDay = 0, active = -1, endingFired = false, hinted = new Set<number>(), baromReadAt = -1e9, lastStormEnd = -1e9;
export const weatherState = { cloud: 0, windBase: 2, stormN: 0 };
/** Dev/test override of weather globals (storm, snowfall, visibility, wind, ambientT, aurora, daylight); null = natural weather. */
export const wx = { override: null as null | Partial<Pick<typeof G, 'storm' | 'snowfall' | 'visibility' | 'wind' | 'ambientT' | 'aurora' | 'daylight'>> };

/** Hooks for the radio / weather balloon (fixtures_station.ts): a precise forecast read over the radio overrides G.forecast and counts as known. */
export const wxHooks = { forecast: null as null | ((t: number) => void), knows: null as null | (() => boolean) };

function hash(n: number) { const s = Math.sin(n * 91.7 + 12.3) * 43758.5453; return s - Math.floor(s); }

/** Evaluate all weather globals for G.time (no events). */
export function applyClock() {
  const t = G.time;
  G.day = Math.floor(t / DAY_MIN) + 1;
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
  const w0 = 8 * Math.pow(noise1(t / 260 + seed * 1.7), 1.5);
  const dirf = clamp(Math.cos(t / 1700 + seed) * 3, -1, 1);
  let wind = w0 * dirf;
  let stormDir = 1, bestI = 0;
  for (const s of STORMS) { const v = stormIntensity(s, t); if (v > bestI) { bestI = v; stormDir = s.dir; } }
  if (bestI > 0) {
    const gust = 1 + 0.18 * Math.sin(t * 0.9) + 0.12 * Math.sin(t * 2.3 + 1);
    const sw = stormDir * (15 + 10 * bestI) * gust;
    wind = wind * (1 - Math.min(1, bestI * 1.6)) + sw * Math.min(1, bestI * 1.6);
  }
  G.wind = wind;
  weatherState.windBase = w0;
  // temperature: clear calm night is the coldest
  const night = 1 - G.daylight, calm = 1 - Math.min(1, Math.abs(wind) / 8), clear = 1 - Math.min(1, 0.9 * st + 0.35 * weatherState.cloud);
  G.ambientT = -24 - 16 * clear * calm * (0.4 + 0.6 * night) + 2.5 * G.daylight + 2.2 * Math.sin(t / 520 + seed) + (st > 0.3 ? 3 : 0);
  G.snowfall = clamp(0.06 + 0.2 * weatherState.cloud + 0.8 * st, 0, 1);
  G.visibility = clamp(1 - 0.68 * st - 0.08 * weatherState.cloud, 0.25, 1);
  // aurora: strength per night, only when the sky is clear
  const nightIdx = Math.floor((t - 720) / DAY_MIN);
  const strength = 0.25 + 0.75 * hash(nightIdx + seed * 7);
  G.aurora = strength * (0.7 + 0.3 * Math.sin(t / 37)) * (1 - Math.min(1, st * 1.4 + weatherState.cloud * 0.5));
  if (wx.override) Object.assign(G, wx.override);
  updateForecast(t);
  wxHooks.forecast?.(t);
}

function updateForecast(t: number) {
  let next: Storm | null = null;
  for (const s of STORMS) if (t < s.start + s.dur) { next = s; break; }
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
export function nextStorm(): Storm | null { for (const s of STORMS) if (G.time < s.start + s.dur) return s; return null; }
/** Storm number currently raging (intensity > 0.15), or 0. */
export function stormNow(): number { return active > 0 ? active : 0; }

function syncFlags() {
  active = -1;
  for (const s of STORMS) if (stormIntensity(s, G.time) > 0.15) active = s.n;
  lastDay = G.day;
  endingFired = G.day >= 12 && G.sunElev >= 0.2;
  hinted = new Set(STORMS.filter(s => G.time > s.start - 180).map(s => s.n));
}

export function initWeather(s = 1) {
  seed = (s % 97) + 1; G.seed = s;
  G.time = START_TIME; G.timeScale = 1; endingFired = false; hinted = new Set(); baromReadAt = -1e9; active = -1;
  applyClock(); syncFlags(); lastDay = G.day; endingFired = false;
}

/** Any ending (the icebreaker rescue included) closes the run: the dawn must not fire a second one. */
on('ending', () => { endingFired = true; });

/** Dev/test: jump to day n (1-based) at the given hour; storm/ending flags are re-synced silently. */
export function setDay(n: number, hour = 10) {
  G.time = at(Math.max(1, n), hour);
  applyClock(); syncFlags();
}
export function setClock(minutes: number) { G.time = minutes; applyClock(); syncFlags(); }

/** Advance the clock. dt = real seconds of the frame. Uses G.timeScale (sleep warp). */
export function stepWeather(dt: number) {
  if (dt <= 0 || G.paused) return;
  G.time += dt * MIN_PER_SEC * G.timeScale;
  applyClock();
  if (G.day !== lastDay) {
    for (let d = lastDay + 1; d <= G.day; d++) emit('day', { n: d });
    lastDay = G.day;
  }
  // storms
  const t = G.time;
  for (const s of STORMS) {
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
  // the first rim of the sun on day 12 = dawn ending
  if (!endingFired && G.day >= 12 && G.sunElev >= 0.2) { endingFired = true; toast(S.sunrise, 'good'); emit('ending', { kind: 'dawn' }); }
}
export { lastStormEnd };
