// Daily missions (3 per day, rotated deterministically by the local date) and the 7-day login streak.
// PURE (no DOM): runs under Vitest. Stored in its own save sub-object `save.daily`, defaulted when missing.
import type { SaveData } from '../types';

export type MissionKind = 'smash' | 'win' | 'drift' | 'nitro' | 'norepair' | 'races' | 'podium';
export interface MissionDef { kind: MissionKind; target: number; reward: number }

/** Mission pool. `target` is in objects / wins / seconds / uses / races. */
export const MISSION_POOL: MissionDef[] = [
  { kind: 'smash', target: 50, reward: 150 },
  { kind: 'win', target: 1, reward: 200 },
  { kind: 'drift', target: 10, reward: 120 },
  { kind: 'nitro', target: 3, reward: 100 },
  { kind: 'norepair', target: 1, reward: 120 },
  { kind: 'races', target: 3, reward: 150 },
  { kind: 'podium', target: 2, reward: 160 },
];
export const MISSIONS_PER_DAY = 3;
/** Coins for day 1..7 of the login streak (day 7 is the big one, then the cycle restarts). */
export const LOGIN_REWARDS = [50, 75, 100, 150, 200, 250, 500];

export interface DailyState {
  /** day number the missions belong to (days since 1970-01-01 of the LOCAL date); -1 = never */
  day: number;
  progress: number[];
  claimed: boolean[];
  /** day number of the last claimed login reward; -1 = never */
  loginDay: number;
  /** streak position of that claim, 1..7 */
  streak: number;
}

export interface RaceStats { smashed: number; place: number; driftS: number; nitros: number; repairs: number }

export function defaultDaily(): DailyState {
  return { day: -1, progress: [0, 0, 0], claimed: [false, false, false], loginDay: -1, streak: 0 };
}

/** Local calendar day as an integer (so the day flips at the player's midnight, not UTC's). */
export function dayNumber(d: Date): number {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const int = (v: unknown, d: number, lo: number, hi: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : d;

/** Stored value (any shape, or missing in an old save) -> a valid DailyState. */
export function sanitizeDaily(v: unknown): DailyState {
  const d = defaultDaily();
  if (!isObj(v)) return d;
  const prog = Array.isArray(v.progress) ? v.progress : [];
  const cl = Array.isArray(v.claimed) ? v.claimed : [];
  return {
    day: int(v.day, -1, -1, 1e7),
    progress: [0, 1, 2].map((i) => int(prog[i], 0, 0, 1e6)),
    claimed: [0, 1, 2].map((i) => cl[i] === true),
    loginDay: int(v.loginDay, -1, -1, 1e7),
    streak: int(v.streak, 0, 0, 7),
  };
}

export function dailyOf(save: SaveData): DailyState {
  return sanitizeDaily((save as SaveData & { daily?: unknown }).daily);
}

function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/** The 3 distinct missions of day `day` (same for everyone on that date). */
export function missionsForDay(day: number): MissionDef[] {
  const r = rng(day + 7919);
  const idx = MISSION_POOL.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return idx.slice(0, MISSIONS_PER_DAY).map((i) => MISSION_POOL[i]);
}

/** Daily state for `today`: a new day resets progress and claims (login fields are kept). */
export function rollDay(st: DailyState, today: number): DailyState {
  if (st.day === today) return st;
  return { ...st, day: today, progress: [0, 0, 0], claimed: [false, false, false] };
}

/** How much a finished race adds to a mission of kind `k`. */
function gain(k: MissionKind, r: RaceStats): number {
  switch (k) {
    case 'smash': return Math.max(0, Math.floor(r.smashed));
    case 'win': return r.place === 1 ? 1 : 0;
    case 'drift': return Math.max(0, r.driftS);
    case 'nitro': return Math.max(0, Math.floor(r.nitros));
    case 'norepair': return r.repairs === 0 ? 1 : 0;
    case 'races': return 1;
    case 'podium': return r.place >= 1 && r.place <= 3 ? 1 : 0;
  }
}

/** Applies a finished race. Returns the new state and the indices of missions that became complete. */
export function applyRace(st0: DailyState, today: number, r: RaceStats): { state: DailyState; completed: number[] } {
  const st = rollDay(st0, today);
  const defs = missionsForDay(today);
  const completed: number[] = [];
  const progress = st.progress.map((p, i) => {
    const d = defs[i];
    const before = p;
    // drift is tracked in tenths of a second so short drifts add up without float drift in the save
    const add = d.kind === 'drift' ? Math.round(gain(d.kind, r) * 10) : gain(d.kind, r);
    const cap = d.kind === 'drift' ? d.target * 10 : d.target;
    const next = Math.min(cap, before + add);
    if (before < cap && next >= cap) completed.push(i);
    return next;
  });
  return { state: { ...st, progress }, completed };
}

/** Progress of mission `i` in the units of its target (drift: seconds). */
export function progressValue(st: DailyState, i: number, today: number): number {
  const d = missionsForDay(today)[i];
  const p = st.day === today ? st.progress[i] ?? 0 : 0;
  return d.kind === 'drift' ? Math.floor(p / 10) : p;
}

export function isComplete(st: DailyState, i: number, today: number): boolean {
  return progressValue(st, i, today) >= missionsForDay(today)[i].target;
}

export function unclaimedCount(st: DailyState, today: number): number {
  let n = 0;
  for (let i = 0; i < MISSIONS_PER_DAY; i++) if (isComplete(st, i, today) && !(st.day === today && st.claimed[i])) n++;
  return n;
}

/** Claims mission `i`: returns the coins and the new state, or null when not complete / already claimed. */
export function claimMission(st0: DailyState, i: number, today: number): { state: DailyState; coins: number } | null {
  const st = rollDay(st0, today);
  if (i < 0 || i >= MISSIONS_PER_DAY || st.claimed[i] || !isComplete(st, i, today)) return null;
  const claimed = st.claimed.slice(); claimed[i] = true;
  return { state: { ...st, claimed }, coins: missionsForDay(today)[i].reward };
}

// ------------------------------------------------------------------ login streak

/** Streak day (1..7) that a claim made `today` would be: consecutive days advance, a missed day resets to 1. */
export function nextStreakDay(st: DailyState, today: number): number {
  if (st.loginDay === today) return st.streak;
  if (st.loginDay === today - 1 && st.streak >= 1) return (st.streak % 7) + 1;
  return 1;
}

export function loginAvailable(st: DailyState, today: number): boolean { return st.loginDay !== today; }

export function claimLogin(st: DailyState, today: number): { state: DailyState; coins: number; streak: number } | null {
  if (!loginAvailable(st, today)) return null;
  const streak = nextStreakDay(st, today);
  return { state: { ...st, loginDay: today, streak }, coins: LOGIN_REWARDS[streak - 1], streak };
}

/** Per-race counters for the missions (drift seconds, nitro uses, repairs). Fed by the game loop. */
export class MissionTracker {
  driftS = 0;
  nitros = 0;
  repairs = 0;
  reset(): void { this.driftS = 0; this.nitros = 0; this.repairs = 0; }
  /** `dt` of simulated time; `player` is the player's car state; `events` the sim events of this frame. */
  tick(dt: number, player: { id: number; driftActive?: boolean; finished: boolean } | undefined, events: readonly { type: string; carId?: number; source?: string }[]): void {
    if (!player || player.finished) return;
    if (player.driftActive && dt > 0 && Number.isFinite(dt)) this.driftS += dt;
    for (const e of events) if (e.type === 'boost' && e.source === 'nitro' && e.carId === player.id) this.nitros++;
  }
  repaired(): void { this.repairs++; }
  stats(smashed: number, place: number): RaceStats {
    return { smashed, place, driftS: this.driftS, nitros: this.nitros, repairs: this.repairs };
  }
}

/** Writes the daily state and adds coins (pure). */
export function withDaily(save: SaveData, st: DailyState, coins = 0): SaveData {
  return { ...save, money: Math.min(1e9, save.money + Math.max(0, Math.floor(coins))), daily: st } as SaveData;
}
