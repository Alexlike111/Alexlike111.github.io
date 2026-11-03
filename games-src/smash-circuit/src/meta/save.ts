// Save data. Persistence ONLY through the Playgama Bridge storage (src/platform/bridge.ts); no localStorage.
// Two keys: a small core record and the (bigger) ghost record, so changing settings does not rewrite ghosts.
import { CONFIG } from '../config';
import { platform } from '../platform/bridge';
import type { GhostData, GhostFrame, SaveData, UpgradeLevels } from '../types';
import { CAR_IDS, carIdOr, isCarId, rivalModeOr } from './cars';

export const SAVE_KEY_CORE = 'sc_core';
export const SAVE_KEY_GHOSTS = 'sc_ghosts';

export function defaultSave(): SaveData {
  return {
    version: 2,
    money: CONFIG.economy.startMoney,
    car: CONFIG.cars.starter,
    carUpgrades: {},
    carRaces: {},
    carWins: {},
    unlockedTracks: [CONFIG.meta.trackOrder[0]],
    bestPlace: {},
    bestLap: {},
    settings: { lang: 'auto', autoGas: false, quality: 'auto', muted: false, tutorialDone: false, camera: 'auto' },
    ghosts: {},
    carColor: 0,
    racesFinished: 0,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, d: number, lo = -Infinity, hi = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d;

function parseMaybeJson(v: unknown): unknown {
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  return v;
}

function numberMap(v: unknown, lo: number, hi: number, validKeys: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(v)) return out;
  for (const k of validKeys) {
    const n = v[k];
    if (typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi) out[k] = n;
  }
  return out;
}

/** Packed ghost: `d` = flat ints [t ms, x cm, y cm, a mrad, ...] (4 per frame). */
function unpackGhost(d: unknown): GhostFrame[] | null {
  if (!Array.isArray(d) || d.length < 8 || d.length % 4 !== 0) return null;
  const frames: GhostFrame[] = [];
  for (let i = 0; i < d.length; i += 4) {
    const t = d[i], x = d[i + 1], y = d[i + 2], a = d[i + 3];
    if (typeof t !== 'number' || typeof x !== 'number' || typeof y !== 'number' || typeof a !== 'number') return null;
    if (!Number.isFinite(t + x + y + a)) return null;
    frames.push({ t: t / 1000, x: x / 100, y: y / 100, a: a / 1000 });
  }
  return frames;
}

function sanitizeGhost(trackId: string, g: unknown): GhostData | null {
  if (!isObj(g)) return null;
  if (Array.isArray(g.d)) {
    const packed = unpackGhost(g.d);
    const lt = num(g.lapTime, 0, 0);
    return packed && lt > 0 ? { trackId, lapTime: lt, frames: packed } : null;
  }
  if (!Array.isArray(g.frames) || g.frames.length < 2) return null;
  const frames: GhostFrame[] = [];
  for (const f of g.frames) {
    if (!isObj(f)) return null;
    const t = f.t, x = f.x, y = f.y, a = f.a;
    if (typeof t !== 'number' || typeof x !== 'number' || typeof y !== 'number' || typeof a !== 'number') return null;
    if (!Number.isFinite(t + x + y + a)) return null;
    frames.push({ t, x, y, a });
  }
  const lapTime = num(g.lapTime, 0, 0);
  if (lapTime <= 0) return null;
  return { trackId, lapTime, frames };
}

/** Merges arbitrary stored data over the defaults, dropping anything invalid. Exported for tests. */
export function sanitizeSave(core: unknown, ghosts: unknown): SaveData {
  const d = defaultSave();
  const c = isObj(core) ? core : {};
  const trackIds = CONFIG.meta.trackOrder;
  const maxL = CONFIG.upgrades.maxLevel;
  const lvl = (v: unknown): number => Math.floor(num(v, 0, 0, maxL));
  const levels = (v: unknown): UpgradeLevels | null => {
    if (!isObj(v)) return null;
    const l = { engine: lvl(v.engine), grip: lvl(v.grip), armor: lvl(v.armor) };
    return l.engine + l.grip + l.armor > 0 ? l : null;
  };
  // per-car upgrades (v2); a v1 save had one global record for its only car -> it becomes the starter car's levels
  const carUpgrades: Record<string, UpgradeLevels> = {};
  if (isObj(c.carUpgrades)) for (const id of CAR_IDS) { const l = levels(c.carUpgrades[id]); if (l) carUpgrades[id] = l; }
  else { const l = levels(c.upgrades); if (l) carUpgrades[CONFIG.cars.starter] = l; }
  const st = isObj(c.settings) ? c.settings : {};
  const q = st.quality;
  const lang = st.lang;

  const unlocked = Array.isArray(c.unlockedTracks) ? c.unlockedTracks.filter((x): x is string => typeof x === 'string' && trackIds.includes(x)) : [];
  if (!unlocked.includes(trackIds[0])) unlocked.unshift(trackIds[0]);

  const g: Record<string, GhostData> = {};
  if (isObj(ghosts)) for (const id of trackIds) { const gd = sanitizeGhost(id, ghosts[id]); if (gd) g[id] = gd; }

  const out: SaveData = {
    version: 2,
    money: Math.floor(num(c.money, d.money, 0, 1e9)),
    car: carIdOr(c.car),
    carUpgrades,
    carRaces: numberMap(c.carRaces, 1, 1e9, CAR_IDS as string[]),
    carWins: numberMap(c.carWins, 1, 1e9, CAR_IDS as string[]),
    unlockedTracks: unlocked,
    bestPlace: numberMap(c.bestPlace, 1, CONFIG.race.cars, trackIds),
    bestLap: numberMap(c.bestLap, 1, 3600, trackIds),
    settings: {
      lang: lang === 'en' || lang === 'ru' || lang === 'auto' ? lang : d.settings.lang,
      autoGas: st.autoGas === true,
      quality: q === 'auto' || q === 'low' || q === 'medium' || q === 'high' ? q : d.settings.quality,
      muted: st.muted === true,
      tutorialDone: st.tutorialDone === true,
      camera: st.camera === 'rotating' || st.camera === 'fixed' || st.camera === 'auto' ? st.camera : d.settings.camera,
    },
    ghosts: g,
    carColor: Math.floor(num(c.carColor, 0, 0, CONFIG.render.carColors.length - 1)),
    racesFinished: Math.floor(num(c.racesFinished, 0, 0, 1e9)),
  };
  // rival field: only stored values are kept (absent = the default, see rivalModeOr)
  if (st.rivals !== undefined && rivalModeOr(st.rivals) === st.rivals) out.settings.rivals = st.rivals as SaveData['settings']['rivals'];
  if (isCarId(st.rivalCar)) out.settings.rivalCar = st.rivalCar;
  // v1 counted races only globally: they were all driven in the starter car
  if (!isObj(c.carRaces) && out.racesFinished > 0) out.carRaces[CONFIG.cars.starter] = out.racesFinished;
  for (const k of Object.keys(out.carRaces)) out.carRaces[k] = Math.floor(out.carRaces[k]);
  for (const k of Object.keys(out.carWins)) out.carWins[k] = Math.floor(out.carWins[k]);
  return out;
}

export type SaveStatus = 'loaded' | 'empty' | 'failed' | 'corrupt';
export interface LoadedSave { status: SaveStatus; save: SaveData }

export const SAVE_KEY_PREV = 'sc_core_prev';
export const SAVE_KEY_CORRUPT = 'sc_core_corrupt';

/**
 * Writes are blocked until the stored progress is KNOWN (loaded / genuinely empty / corrupt-and-backed-up).
 * A failed read must never let the next write replace a real save with defaults (audit M1).
 */
let writable = false;
/** Raw core record to keep as `sc_core_prev` (set once per session, written with the first save) and a corrupt record to keep. */
let pendingPrev: string | null = null;
let pendingCorrupt: string | null = null;

export function canWrite(): boolean { return writable; }

/**
 * Load everything with ONE storage.get and report what happened. Never throws.
 *  - loaded:  stored data parsed (merged over defaults, invalid fields dropped); writes are enabled
 *  - empty:   nothing stored yet (new player, or no Bridge): defaults, writes enabled
 *  - corrupt: the core record is unreadable: defaults, the raw text is backed up to `sc_core_corrupt` with the first write
 *  - failed:  the storage could not be read (timeout / rejection / Bridge not ready): defaults, writes stay BLOCKED
 */
export async function loadSave(): Promise<LoadedSave> {
  let res;
  try {
    res = await platform.load([SAVE_KEY_CORE, SAVE_KEY_GHOSTS]);
  } catch {
    res = { status: 'failed' as const, values: {} as Record<string, unknown> };
  }
  if (res.status === 'failed') { writable = false; return { status: 'failed', save: defaultSave() }; }
  try {
    const rawCore = res.values[SAVE_KEY_CORE];
    lastGhosts = typeof res.values[SAVE_KEY_GHOSTS] === 'string' ? (res.values[SAVE_KEY_GHOSTS] as string) : null;
    if (rawCore == null) {
      writable = true;
      return { status: 'empty', save: sanitizeSave(null, parseMaybeJson(res.values[SAVE_KEY_GHOSTS])) };
    }
    const core = parseMaybeJson(rawCore);
    if (!isObj(core)) {
      writable = true;
      pendingCorrupt = typeof rawCore === 'string' ? rawCore : safeStringify(rawCore);
      return { status: 'corrupt', save: defaultSave() };
    }
    writable = true;
    pendingPrev = typeof rawCore === 'string' ? rawCore : safeStringify(rawCore);
    return { status: 'loaded', save: sanitizeSave(core, parseMaybeJson(res.values[SAVE_KEY_GHOSTS])) };
  } catch {
    writable = false;
    return { status: 'failed', save: defaultSave() };
  }
}

function safeStringify(v: unknown): string | null { try { return JSON.stringify(v); } catch { return null; } }

const r3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Keeps every `step`-th frame (always the last one). Ghost playback interpolates, so thinning only loses smoothness. */
function thin(frames: GhostFrame[], step: number): GhostFrame[] {
  if (step <= 1) return frames;
  const out = frames.filter((_, i) => i % step === 0);
  const last = frames[frames.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function packGhost(g: GhostData, step: number): { trackId: string; lapTime: number; d: number[] } {
  const d: number[] = [];
  for (const f of thin(g.frames, step)) d.push(Math.round(f.t * 1000), Math.round(f.x * 100), Math.round(f.y * 100), Math.round(f.a * 1000));
  return { trackId: g.trackId, lapTime: r3(g.lapTime), d };
}

/**
 * Ghost record: packed integers (about 20 bytes per frame instead of 60) and bounded by CONFIG.save.maxGhostChars:
 * if the three laps do not fit, every ghost is thinned (every 2nd, 3rd ... frame) until they do.
 */
export function serializeGhosts(ghosts: Record<string, GhostData>): string {
  let step = 1;
  let out = '';
  for (; step <= 8; step++) {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(ghosts)) o[k] = packGhost(ghosts[k], step);
    out = JSON.stringify(o);
    if (out.length <= CONFIG.save.maxGhostChars) break;
  }
  return out;
}

let lastGhosts: string | null = null;
let queue: Promise<void> = Promise.resolve();

/**
 * Persist with ONE storage.set containing only the keys that changed (ghosts are skipped when unchanged).
 * Writes are SERIALISED through a promise queue so they reach the storage in call order (never overlap), and each
 * write is a snapshot taken at call time, so later mutations of `s` cannot leak into an earlier write.
 */
export function writeSave(s: SaveData): Promise<void> {
  if (!writable) return queue;   // progress not loaded: never overwrite it with defaults
  const { ghosts, ...rest } = s;
  const core = JSON.stringify(rest);
  const g = serializeGhosts(ghosts);
  const job = queue.then(async () => {
    const data: Record<string, unknown> = { [SAVE_KEY_CORE]: core };
    if (g !== lastGhosts) data[SAVE_KEY_GHOSTS] = g;
    // one-time backups ride along with the first write of the session
    const prev = pendingPrev, corrupt = pendingCorrupt;
    if (prev !== null) data[SAVE_KEY_PREV] = prev;
    if (corrupt !== null) data[SAVE_KEY_CORRUPT] = corrupt;
    if (await platform.save(data)) {
      if (SAVE_KEY_GHOSTS in data) lastGhosts = g;
      if (pendingPrev === prev) pendingPrev = null;
      if (pendingCorrupt === corrupt) pendingCorrupt = null;
    }
  }).catch(() => { /* platform.save never throws; keep the queue alive regardless */ });
  queue = job;
  return job;
}

/** Resolves when every queued write has finished (tests, page hide). */
export function flushSave(): Promise<void> { return queue; }
