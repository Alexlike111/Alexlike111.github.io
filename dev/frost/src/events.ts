// Scheduled and random world events for «Белая Мгла».
//
// Ownership: this module writes only the cells an event itself changes (a released avalanche slab,
// the crown snow of one spruce, one ice cell under a hero who broke through). Everything else comes in
// through `ctx` (hero, G, toast, sound cues, hooks) and goes out through `activeEffects()`, `eventLog()`
// and the hooks. It never reads or writes main/tools/ui/player/render state.
//
// Clocks: stepEvents(dt, gameDtMinutes, ctx). `dt` is real seconds and drives warnings, fades, the
// parachute descent and the helicopter circle, so they stay fair while the hero waits in a shelter at
// timeScale 12. `gameDtMinutes` drives the calendar: nights, storms, the morning drop.
//
// Randomness: one mulberry32 stream seeded by initEvents(seed). The night plan (wolves, flare) is drawn at
// init, so the same seed gives the same nights. Per-frame rolls (cracks, dumps) use the same stream.
//
// TIMING RULES (every physical event has a warning first; none can kill by itself)
//  AVALANCHE  Armed by heavy snow: recent snowfall (decays, half-life 6 game h) >= 0.25 m while G.storm >= 0.3.
//             The first such episode that ends (storm < 0.3) makes ONE roll at 35%; on success a release is
//             queued 1-5 game h later. One roll per game, at most one slab. At the release time all of these must hold, else it is dropped:
//             hero not sheltered, timeScale <= 2, a slope >= 0.6 (31 deg) over 1 m with >= 0.5 m snow,
//             8-45 m from the hero, and the hero not inside the 30 m runout below the slab.
//             Warning: "Снег трещит", three crack cues over 1.2 s; the slab is released 3.5 real s later.
//  WOLVES     Each night (20:00-05:00) plans 0-2 howls (60% each, >= 90 game min apart). A howl is skipped
//             while G.storm >= 0.4. Cue only, no combat. Tracks (10-14 prints, 30-70 m away) appear at 07:00
//             next morning, are full until 09:00 and gone by 15:00.
//  WHITEOUT   Continuous. level = smoothstep(storm 0.25..0.8) * (0.45 + 0.55 * burst). A burst (40-120 real s,
//             peak 0.6-1) starts every 150-300 real s while storm >= 0.5. visibility = max(0.12, 1 - 0.88 * level).
//             Toast once per storm when level > 0.75 (marker poles and the compass help).
//  SNOW DUMP  The hero stands under a spruce (within 0.22 x height of the trunk, between tip and base) with
//             >= 4 crown caps (F_CAP) in the column above the head. Roll every 1.5 real s at 2% (x (1 + wind/5)).
//             Cooldown 6 game min per tree, and at most one dump per 20 game min overall.
//             Warning: "Ель скрипит" creak cue; 1.2 real s later the caps in that column lose their bond and fall.
//  ICE CRACK  The hero stands on ICE (under snow) with WATER within 3 m beside or under it: 15% per 0.5 s
//             check a crack cue. Toast at most every 20 s. Three cracks within 12 s while still standing there:
//             "проваливается" toast, then 1.5 real s later the ICE cells directly under the feet turn to WATER.
//             The hero steps back onto the snow; at most one break per 30 game min.
//             NOTE: generate() currently lays lake ICE on the ground with no WATER; locations.ts must put water under the ice.
//  FLARE      Each night a 45% plan: at 21:00-23:30 a red flare rises at 45 m on one side of the horizon, only if
//             ctx.radioParts() >= 1 and G.storm < 0.2. Once per game.
//  SUPPLY DROP  The next morning (07:00-09:30) a parachute container descends for 10 real s onto a snow spot
//             4-60 m from the hero, reachable from the hero's column (height steps <= 1.5 m). ctx.onSupplyLanded places it.
//  RESCUE     Armed when ctx.radioParts() == 3. callRescue() at the radio: if a signal fire is lit with fuel >= 10
//             game min and no roof within 3 m above it (isOpenSpot), the helicopter comes in: ETA 25 game min.
//             If no such fire exists, the call waits (state 'calling') and the helicopter starts when one is lit.
//             At the ETA the fire must still burn, else the helicopter circles 8 game min and leaves (state 'calling').
//             On arrival ctx.onRescue() is called once.
//
// SOUND CUES (ctx.cue name -> suggested audio.ts call): snowCrack -> new; avalancheRoar -> collapse(0.9);
// treeCreak -> treeCreak(); snowThud -> thump(30); wolfHowl -> new (p = distance 0..1, 1 = far);
// iceCrack -> new; iceBreak -> thump(300); flareHiss -> new; parachuteLand -> thump(60); heliRotor -> new.

import { W, H, M, F_CAP, mat, dens, flags, body, groundY, trees, idx, inb, set, surfaceAt, rigidAt } from './world';
import type { Fire } from './state';
import { makeBody } from './phys';
import { markStruct } from './structure';

// ---------------------------------------------------------------- public types

export type EventKind = 'avalanche' | 'wolves' | 'whiteout' | 'snowDump' | 'iceCrack' | 'flare' | 'supplyDrop' | 'rescue';

export type CueName =
  | 'snowCrack' | 'avalancheRoar' | 'treeCreak' | 'snowThud' | 'wolfHowl'
  | 'iceCrack' | 'iceBreak' | 'flareHiss' | 'parachuteLand' | 'heliRotor';

export interface EventLogEntry { kind: EventKind; t: number; /* game minutes */ text: string; }

/** The part of G that events read. main's G satisfies it structurally. */
export interface EventClock {
  time: number;        // game minutes since day 1 00:00
  storm: number;       // 0..1
  snowfall: number;    // m/h
  wind: number;        // m/s
  timeScale: number;
  fires: readonly Fire[];
}

export interface EventHero {
  x: number;           // cells, centre
  y: number;           // cells, feet
  shelter?: number;    // 0..1, >= 0.5 means inside a shelter
}

export interface SupplySpot { x: number; y: number; loot: readonly string[]; }

export interface EventCtx {
  hero: EventHero;
  G: EventClock;
  toast(msg: string): void;
  cue?(name: CueName, p: number): void;
  /** radio parts installed, 0..3 (lore.ts journal.radio.length) */
  radioParts(): number;
  /** hook: `n` caps of snow fell onto the hero (the hero's snowOn/wet state is main's to change) */
  onSnowOnHead?(cells: number): void;
  /** hook: the container touched down; place the crate there (world.ts) with spot.loot */
  onSupplyLanded?(spot: SupplySpot): void;
  /** hook: the helicopter has landed at the signal fire: the game can end as a rescue */
  onRescue?(): void;
  /** hook: a hole opened under the hero (the grid write is already done here; this only notifies) */
  onIceBreak?(cells: number[]): void;
}

export interface TrackPrint { x: number; y: number; dir: 1 | -1; alpha: number; }

export interface Effects {
  visibility: number;                                       // 1 = clear, down to 0.12 in a whiteout
  whiteout: number;                                         // 0..1
  flare: { x: number; y: number; bright: number } | null;   // cells; bright 0..1 envelope
  drop: { x: number; y: number; t: number } | null;         // container position, t = descent progress 0..1
  heli: { x: number; y: number; circling: boolean } | null;
  tracks: TrackPrint[];
}

export type RescueState = 'locked' | 'ready' | 'calling' | 'inbound' | 'circling' | 'done';
export type CallResult = 'locked' | 'called' | 'pending' | 'done';

// ---------------------------------------------------------------- tunables

const MAX_LOG = 300;
const NIGHT_START = 20 * 60;
const MORNING = 7 * 60;
const HEAVY_SNOW_M = 0.25;
const STEEP = 0.6;
const SLAB_DEPTH = 20;          // 1 m of snow in the slab
const RUNOUT = 600;             // 30 m
const SLIDE_SPEED = 3;          // m/s
const AVALANCHE_WARN_S = 3.5;
const DUMP_DELAY_S = 1.2;
const DROP_S = 10;
const ICE_BREAK_S = 1.5;
const RESCUE_ETA_MIN = 25;
const RESCUE_RETURN_MIN = 6;
const CIRCLE_MIN = 8;
const SUPPLY_LOOT: readonly string[] = ['food', 'crackers', 'matches', 'thermos', 'lantern'];
const CLIMB = 30;               // cells (1.5 m): neighbouring columns this far apart in height are walkable

// ---------------------------------------------------------------- state

interface Timer { at: number; run: (c: EventCtx) => void; }
interface Slide { x: number; dir: 1 | -1; cells: number[]; x0: number; x1: number; y0: number; y1: number; }
interface Track { x: number; y: number; dir: 1 | -1; appear: number; }

interface Core {
  rng: () => number;
  rt: number;                       // real seconds since init
  gameQ: Timer[];                   // run when G.time >= at (game minutes)
  realQ: Timer[];                   // run when rt >= at (real seconds)
  log: EventLogEntry[];
  recentSnow: number;               // m, half-life 6 game h
  episode: boolean;
  avalancheRolled: boolean;         // the single roll of the game has been made
  avalancheArmed: boolean;
  avalancheDone: boolean;
  wolfToasted: boolean;
  tracks: Track[];
  white: { level: number; burstStart: number; burstEnd: number; peak: number; nextBurst: number; toasted: boolean };
  dumpBusy: boolean;
  lastDumpT: number;
  treeCool: Map<number, number>;    // tree index -> game minute when it may drop again
  dumpCheckAt: number;
  ice: { cracks: number[]; lastToastRt: number; breakAt: number; row: number; lastBreakT: number };
  iceCheckAt: number;
  flare: { x: number; y: number; t0: number } | null;
  flareDone: boolean;
  drop: { x: number; y: number; t0: number; spot: SupplySpot } | null;
  rescue: { state: RescueState; t0: number; eta: number; fx: number; fy: number; side: 1 | -1; circleUntil: number };
  forceWhite: number;               // real second until which a debug-forced whiteout holds (0 = off)
  fx: Effects;
}

let S: Core | null = null;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const smooth = (a: number, b: number, v: number): number => { const k = clamp((v - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
const nightOf = (t: number): number => Math.floor((t - NIGHT_START) / 1440);        // night index: 20:00 of day n+1 starts night n
const morningAfter = (t: number): number => (nightOf(t) + 1) * 1440 + MORNING;

function makeCore(seed: number): Core {
  const rng = mulberry32(seed);
  return {
    rng, rt: 0, gameQ: [], realQ: [], log: [],
    recentSnow: 0, episode: false, avalancheRolled: false, avalancheArmed: false, avalancheDone: false,
    wolfToasted: false, tracks: [],
    white: { level: 0, burstStart: 0, burstEnd: 0, peak: 0, nextBurst: 0, toasted: false },
    dumpBusy: false, lastDumpT: -1e9, treeCool: new Map(), dumpCheckAt: 0,
    ice: { cracks: [], lastToastRt: -1e9, breakAt: -1, row: -1, lastBreakT: -1e9 }, iceCheckAt: 0,
    flare: null, flareDone: false, drop: null,
    rescue: { state: 'locked', t0: 0, eta: 0, fx: 0, fy: 0, side: 1, circleUntil: 0 },
    forceWhite: 0,
    fx: { visibility: 1, whiteout: 0, flare: null, drop: null, heli: null, tracks: [] },
  };
}

function core(): Core {
  if (!S) S = makeCore(1);
  return S;
}

function note(s: Core, kind: EventKind, t: number, text: string): void {
  s.log.push({ kind, t, text });
  if (s.log.length > MAX_LOG) s.log.shift();
}

/** Draws the night plan for night n (20:00 of day n+1 to 05:00). */
function planNight(s: Core, n: number): void {
  const base = n * 1440 + NIGHT_START;
  const howls: number[] = [];
  for (let k = 0; k < 2; k++) {
    if (s.rng() >= 0.6) continue;
    const at = base + s.rng() * 540;
    if (howls.every((h) => Math.abs(h - at) >= 90)) howls.push(at);
  }
  for (const at of howls) s.gameQ.push({ at, run: (c) => wolfHowl(core(), c) });
  if (s.rng() < 0.45) {
    const at = base + 60 + s.rng() * 150;            // 21:00 .. 23:30
    s.gameQ.push({ at, run: (c) => flareRoll(core(), c) });
  }
}

/** Starts a new schedule. Same seed, same nights. Plans six nights, which covers the three-night game with margin. */
export function initEvents(seed: number): void {
  S = makeCore(seed >>> 0 || 1);
  for (let n = 0; n < 6; n++) planNight(S, n);
}

// ---------------------------------------------------------------- queue helpers

function runDue(q: Timer[], now: number, c: EventCtx): void {
  for (;;) {
    let best = -1;
    for (let k = 0; k < q.length; k++) if (q[k].at <= now && (best < 0 || q[k].at < q[best].at)) best = k;
    if (best < 0) return;
    const [t] = q.splice(best, 1);
    t.run(c);
  }
}

// ---------------------------------------------------------------- terrain helpers

/** Surface row of every column in [lo, hi] (one scan per column). */
function surfaceWindow(lo: number, hi: number): Int32Array {
  const out = new Int32Array(hi - lo + 1);
  for (let x = lo; x <= hi; x++) out[x - lo] = surfaceAt(x);
  return out;
}

/** Downhill-positive gradient over 1 m (20 cells) around column x, from a surface window. */
function slopeIn(top: Int32Array, lo: number, x: number): number {
  return (top[x + 10 - lo] - top[x - 10 - lo]) / 20;
}

/** Walks down the column through snow only; returns the first non-snow material (or -1 when outside the world). */
function groundKind(x: number, y: number): number {
  for (let yy = y; yy < H; yy++) {
    if (!inb(x, yy)) return -1;
    const m = mat[idx(x, yy)];
    if (m !== M.SNOW) return m;
  }
  return -1;
}

/** No roof within 3 m (60 cells) above (x, y) in a 9-cell wide column. Loose snow and granular grains do not count. */
export function isOpenSpot(x: number, y: number): boolean {
  for (let xx = x - 4; xx <= x + 4; xx++) for (let yy = y - 60; yy < y - 1; yy++) {
    if (!inb(xx, yy)) continue;
    const i = idx(xx, yy), m = mat[i];
    if (m === M.AIR || m === M.POLE) continue;
    if (m === M.NEEDLE || m === M.WOOD || rigidAt(i)) return false;
  }
  return true;
}

// ---------------------------------------------------------------- avalanche

function findSlide(s: Core, hx: number): Slide | null {
  const lo = Math.max(40, hx - 960), hi = Math.min(W - 41, hx + 960);
  if (hi - lo < 40) return null;
  const top = surfaceWindow(lo, hi);                       // top[x - lo] = surface row of column x
  const cands: number[] = [];
  for (let d = 160; d <= 900; d += 6) {
    if (hx + d + 12 <= hi) cands.push(hx + d);
    if (hx - d - 12 >= lo) cands.push(hx - d);
  }
  if (!cands.length) return null;
  const start = Math.floor(s.rng() * cands.length);
  for (let k = 0; k < cands.length; k++) {
    const x = cands[(start + k) % cands.length];
    if (x - 12 < lo || x + 12 > hi) continue;              // the slab footprint [x-12, x+11] and the slope probe [x-10, x+10] stay in the window
    const g = slopeIn(top, lo, x);
    if (Math.abs(g) < STEEP) continue;
    const dir: 1 | -1 = g > 0 ? 1 : -1;
    const y0s = top[x - lo];
    if (!inb(x, y0s) || mat[idx(x, y0s)] !== M.SNOW || groundY[x] - y0s < 10) continue;
    if (dir > 0 ? (hx > x && hx < x + RUNOUT) : (hx < x && hx > x - RUNOUT)) continue;
    const cells: number[] = [];
    let bx0 = x - 12, bx1 = x + 11, by0 = H, by1 = -1;
    for (let c = bx0; c <= bx1; c++) {
      const t0 = top[c - lo];
      const bottom = Math.min(groundY[c] - 1, t0 + SLAB_DEPTH);
      for (let y = t0; y <= bottom; y++) {
        const i = idx(c, y);
        if (mat[i] === M.SNOW && body[i] === 0) {
          cells.push(i);
          if (y < by0) by0 = y;
          if (y > by1) by1 = y;
        }
      }
    }
    if (cells.length < 40) continue;
    return { x, dir, cells, x0: bx0, x1: bx1, y0: by0, y1: by1 };
  }
  return null;
}

function tryAvalanche(s: Core, c: EventCtx): void {
  if ((c.hero.shelter ?? 0) >= 0.5 || c.G.timeScale > 2 || s.avalancheDone) return;
  const site = findSlide(s, Math.round(c.hero.x));
  if (!site) return;
  c.toast('Снег трещит по склону! Уходи вверх или в сторону.');
  c.cue?.('snowCrack', 1);
  s.realQ.push({ at: s.rt + 0.6, run: (cc) => cc.cue?.('snowCrack', 0.8) });
  s.realQ.push({ at: s.rt + 1.2, run: (cc) => cc.cue?.('snowCrack', 1) });
  s.realQ.push({ at: s.rt + AVALANCHE_WARN_S, run: (cc) => releaseSlab(core(), cc, site) });
}

function releaseSlab(s: Core, c: EventCtx, site: Slide): void {
  const live: number[] = [];
  for (const i of site.cells) if (mat[i] === M.SNOW && body[i] === 0) live.push(i);
  if (live.length < 20) return;                            // dug or already moved: nothing left to release
  s.avalancheDone = true;
  for (const i of live) set(i % W, (i / W) | 0, M.SNOW, 380, 200, 0);   // firm slab, as stressTest does
  const rec = makeBody(live, 'slab', site.dir * SLIDE_SPEED, 0.2, 0);
  if (!rec) for (const i of live) set(i % W, (i / W) | 0, M.SNOW, 300, 0, 0); // no body slot: it pours as loose snow
  markStruct(site.x0, site.y0, site.x1, site.y1);
  c.cue?.('avalancheRoar', 1);
  c.toast(rec ? 'Лавина! Плита ушла вниз по склону.' : 'Снег сошёл потоком по склону.');
  note(s, 'avalanche', c.G.time, 'Сошла лавина на соседнем склоне');
}

// ---------------------------------------------------------------- wolves

function wolfHowl(s: Core, c: EventCtx): void {
  if (c.G.storm >= 0.4) return;                               // the wind swallows the howl
  c.cue?.('wolfHowl', 0.7 + 0.3 * s.rng());
  if (!s.wolfToasted) { s.wolfToasted = true; c.toast('Вдалеке воют волки. Держись огня.'); }
  note(s, 'wolves', c.G.time, 'Ночью вдали выли волки');
  // tracks: the pack crosses 30-70 m from the hero; visible next morning
  const dir: 1 | -1 = s.rng() < 0.5 ? 1 : -1;
  let x = Math.round(c.hero.x + dir * (600 + s.rng() * 800));
  const n = 10 + Math.floor(s.rng() * 5), appear = morningAfter(c.G.time);
  for (let k = 0; k < n && x > 20 && x < W - 20; k++) {
    s.tracks.push({ x, y: surfaceAt(x), dir: (-dir) as 1 | -1, appear });
    x -= dir * (7 + Math.floor(s.rng() * 3));
  }
}

// ---------------------------------------------------------------- flare and supply drop

function flareRoll(s: Core, c: EventCtx): void {
  if (s.flareDone || s.flare || s.drop) return;
  if (c.radioParts() < 1 || c.G.storm >= 0.2) return;
  s.flareDone = true;
  const side = s.rng() < 0.5 ? -1 : 1;
  const fx = clamp(Math.round(c.hero.x + side * 900), 60, W - 60);
  const fy = Math.max(0, surfaceAt(fx) - 90);
  s.flare = { x: fx, y: fy, t0: s.rt };
  c.cue?.('flareHiss', 1);
  c.toast('На горизонте вспыхнула красная ракета.');
  note(s, 'flare', c.G.time, 'Ночью на горизонте вспыхнула ракета');
  const at = morningAfter(c.G.time) + s.rng() * 90;
  s.gameQ.push({ at, run: (cc) => dropSupply(core(), cc) });
}

/** Snow spot 4-60 m from the hero, reachable by walking: neighbouring columns differ by at most CLIMB cells (1.5 m, a ledge the hero can climb). */
function pickDropSpot(s: Core, hx: number): SupplySpot | null {
  // reachable from the hero's column; on a ridge or a tower the walk is narrow, so the step limit widens until a spot turns up
  for (const climb of [CLIMB, CLIMB * 2, 1e9]) {
    const spot = pickDropSpotWithin(s, hx, climb);
    if (spot) return spot;
  }
  return null;
}

function pickDropSpotWithin(s: Core, hx: number, climb: number): SupplySpot | null {
  const lo = Math.max(1, hx - 1200), hi = Math.min(W - 2, hx + 1200);
  const top = surfaceWindow(lo, hi);
  const reach = new Uint8Array(hi - lo + 1);
  const start = clamp(hx, lo, hi) - lo;
  const q: number[] = [start];
  reach[start] = 1;
  for (let h = 0; h < q.length; h++) {
    const k = q[h];
    for (const n of [k - 1, k + 1]) {
      if (n < 0 || n >= reach.length || reach[n]) continue;
      if (Math.abs(top[n] - top[k]) > climb) continue;
      reach[n] = 1;
      q.push(n);
    }
  }
  const cands: number[] = [];
  for (let k = 0; k < reach.length; k++) {
    if (!reach[k]) continue;
    const x = lo + k, d = Math.abs(x - hx), y = top[k];
    if (d < 80 || d > 1200 || !inb(x, y) || mat[idx(x, y)] !== M.SNOW) continue;
    const under = groundKind(x, y);
    if (under === M.ICE || under === M.WATER || under < 0) continue;      // not on the lake or a drop into nothing
    let open = true;
    for (let dx = -8; dx <= 8 && open; dx += 2) for (let dy = 0; dy <= 40 && open; dy += 4) {
      if (!inb(x + dx, y - dy)) continue;
      const m = mat[idx(x + dx, y - dy)];
      if (m === M.WOOD || m === M.NEEDLE || m === M.POLE || m === M.CRATE) open = false;
    }
    if (open) cands.push(x);
  }
  if (!cands.length) return null;
  const x = cands[Math.floor(s.rng() * cands.length)];
  return { x, y: top[x - lo], loot: SUPPLY_LOOT };
}

function dropSupply(s: Core, c: EventCtx): void {
  if (s.drop) return;
  const spot = pickDropSpot(s, Math.round(c.hero.x));
  if (!spot) return;
  s.drop = { x: spot.x, y: spot.y, t0: s.rt, spot };
  c.toast('Над снегом раскрылся парашют: груз снижается.');
  note(s, 'supplyDrop', c.G.time, 'Утром на парашюте спустился контейнер с грузом');
  s.realQ.push({
    at: s.rt + DROP_S,
    run: (cc) => {
      const d = core().drop;
      core().drop = null;
      if (!d) return;
      cc.onSupplyLanded?.(d.spot);
      cc.cue?.('parachuteLand', 1);
      cc.toast('Контейнер на снегу. Ищи оранжевую вешку.');
    },
  });
}

// ---------------------------------------------------------------- whiteout

function updateWhiteout(s: Core, c: EventCtx, dt: number): void {
  const w = s.white, storm = c.G.storm;
  if (storm >= 0.5 && s.rt >= w.nextBurst) {
    w.burstStart = s.rt;
    w.burstEnd = s.rt + 40 + s.rng() * 80;
    w.peak = 0.6 + 0.4 * s.rng();
    w.nextBurst = s.rt + 150 + s.rng() * 150;
  }
  let burst = 0;
  if (s.rt < w.burstEnd) burst = w.peak * clamp(Math.min((s.rt - w.burstStart) / 6, (w.burstEnd - s.rt) / 10), 0, 1);
  const target = s.rt < s.forceWhite ? 0.85 : clamp(smooth(0.25, 0.8, storm) * (0.45 + 0.55 * burst), 0, 0.9);
  w.level += (target - w.level) * Math.min(1, dt * 0.8);
  if (storm < 0.1) w.toasted = false;
  if (w.level > 0.75 && !w.toasted) {
    w.toasted = true;
    c.toast('Белая мгла: в трёх шагах ничего не видно. Держись вешек и компаса.');
  }
}

// ---------------------------------------------------------------- snow dump from a spruce

/** caps (F_CAP) in the 60 cm wide column above (x, y): 4 m tall, feet up to the head */
function capsAbove(x: number, y: number): number {
  let n = 0;
  for (let yy = y - 80; yy <= y - 1; yy++) for (let xx = x - 12; xx <= x + 12; xx++) {
    if (inb(xx, yy) && (flags[idx(xx, yy)] & F_CAP) && mat[idx(xx, yy)] === M.SNOW) n++;
  }
  return n;
}

function dumpCheck(s: Core, c: EventCtx): void {
  if (s.dumpBusy || (c.hero.shelter ?? 0) >= 0.5 || c.G.time - s.lastDumpT < 20) return;
  const hx = Math.round(c.hero.x), hy = Math.round(c.hero.y);
  for (let ti = 0; ti < trees.length; ti++) {
    const t = trees[ti];
    if (!t.alive) continue;
    const hw = Math.max(10, Math.round(t.height * 0.22));
    if (Math.abs(hx - t.x) > hw || hy > t.base + 2 || hy < t.base - t.height) continue;
    if ((s.treeCool.get(ti) ?? -1e9) > c.G.time) continue;
    if (capsAbove(hx, hy) < 4) continue;
    if (s.rng() >= 0.02 * (1 + Math.abs(c.G.wind) / 5)) continue;
    s.dumpBusy = true;
    s.lastDumpT = c.G.time;
    s.treeCool.set(ti, c.G.time + 360);
    c.cue?.('treeCreak', 1);
    c.toast('Ель скрипит под тяжестью снега. Сейчас сбросит! Отойди!');
    s.realQ.push({ at: s.rt + DUMP_DELAY_S, run: (cc) => dropCaps(core(), cc, hx, hy) });
    return;
  }
}

function dropCaps(s: Core, c: EventCtx, x: number, y: number): void {
  s.dumpBusy = false;
  let n = 0;
  for (let yy = y - 80; yy <= y - 2; yy++) for (let xx = x - 12; xx <= x + 12; xx++) {
    if (!inb(xx, yy)) continue;
    const i = idx(xx, yy);
    if ((flags[i] & F_CAP) && mat[i] === M.SNOW) {
      set(xx, yy, M.SNOW, dens[i], 0, 0);          // loose now: the grains fall under gravity
      n++;
    }
  }
  if (!n) return;
  c.cue?.('snowThud', clamp(n / 40, 0.2, 1));
  const under = Math.abs(c.hero.x - x) <= 12 && c.hero.y >= y - 80 && c.hero.y <= y + 2;   // the caps fell along the hero's column
  if (under) {
    c.onSnowOnHead?.(n);
    c.toast('Сугроб с ели прямо на голову!');
  } else {
    c.toast('С ели сполз снег.');
  }
  note(s, 'snowDump', c.G.time, 'Со ели сполз снег');
}

// ---------------------------------------------------------------- lake ice

/** Row of the ICE under the feet (snow skipped), or -1. Only a few cells of air above the feet are skipped. */
function iceRowUnder(x: number, y: number): number {
  for (let yy = y - 2; yy <= y + 80 && yy < H; yy++) {
    if (!inb(x, yy)) return -1;
    const m = mat[idx(x, yy)];
    if (m === M.AIR) { if (yy <= y + 3) continue; return -1; }
    if (m === M.SNOW) continue;
    return m === M.ICE ? yy : -1;
  }
  return -1;
}

function waterNear(x: number, r: number): boolean {
  for (let dx = -60; dx <= 60; dx += 4) for (let dy = 1; dy <= 16; dy += 2) {
    if (inb(x + dx, r + dy) && mat[idx(x + dx, r + dy)] === M.WATER) return true;
  }
  return false;
}

function iceCheck(s: Core, c: EventCtx): void {
  const I = s.ice;
  const hx = Math.round(c.hero.x), hy = Math.round(c.hero.y);
  const r = iceRowUnder(hx, hy);
  if (r < 0 || c.G.timeScale > 2 || !waterNear(hx, r)) { I.cracks.length = 0; I.breakAt = -1; return; }
  if (I.breakAt >= 0 || s.rng() >= 0.15) return;
  I.cracks.push(s.rt);
  I.cracks = I.cracks.filter((t) => s.rt - t <= 12);
  c.cue?.('iceCrack', 1);
  if (s.rt - I.lastToastRt > 20) { I.lastToastRt = s.rt; c.toast('Лёд трещит под ногами!'); }
  if (I.cracks.length >= 3 && c.G.time - I.lastBreakT >= 30) {
    I.breakAt = s.rt + ICE_BREAK_S;
    I.row = r;
    c.toast('Лёд проваливается: назад, на снег!');
    s.realQ.push({ at: I.breakAt, run: (cc) => breakIce(core(), cc) });
  }
}

function breakIce(s: Core, c: EventCtx): void {
  const I = s.ice;
  if (I.breakAt < 0) return;
  I.breakAt = -1;
  const hx = Math.round(c.hero.x), r = I.row;
  if (iceRowUnder(hx, Math.round(c.hero.y)) !== r) { I.cracks.length = 0; return; }   // the hero stepped off in time
  const cells: number[] = [];
  for (let x = hx - 1; x <= hx + 1; x++) {
    if (inb(x, r) && mat[idx(x, r)] === M.ICE) {
      set(x, r, M.WATER, 1000, 0, 0);
      cells.push(idx(x, r));
    }
  }
  I.cracks.length = 0;
  if (!cells.length) return;
  I.lastBreakT = c.G.time;
  markStruct(hx - 2, r - 3, hx + 2, r + 2);
  c.cue?.('iceBreak', 1);
  c.toast('Полынья! Лёд ушёл под тебя: не стой на льду.');
  c.onIceBreak?.(cells);
  note(s, 'iceCrack', c.G.time, 'Под героем на озере провалился лёд');
}

// ---------------------------------------------------------------- rescue

/** A lit signal fire with fuel left, in the open. */
function signalFire(c: EventCtx): Fire | null {
  for (const f of c.G.fires) {
    if (f.lit && f.fuel >= 10 && isOpenSpot(Math.round(f.x), Math.round(f.y))) return f;
  }
  return null;
}

function startInbound(s: Core, c: EventCtx, eta: number, f: Fire): void {
  const R = s.rescue, now = c.G.time;
  R.state = 'inbound';
  R.t0 = now;
  R.eta = now + eta;
  R.fx = Math.round(f.x);
  R.fy = Math.round(f.y);
  R.side = s.rng() < 0.5 ? -1 : 1;
  c.cue?.('heliRotor', 1);
  c.toast('Вертолёт на подлёте! Держи костёр, не дай ему погаснуть.');
  note(s, 'rescue', now, 'Вертолёт вышел на связь по сигнальному костру');
}

function rescueTick(s: Core, c: EventCtx): void {
  const R = s.rescue, now = c.G.time, parts = c.radioParts();
  if (R.state === 'done') return;
  if (R.state === 'locked' && parts >= 3) R.state = 'ready';
  if (R.state === 'ready' && parts < 3) R.state = 'locked';
  if (R.state === 'calling' || R.state === 'circling') {
    const f = signalFire(c);
    if (f) startInbound(s, c, R.state === 'circling' ? RESCUE_RETURN_MIN : RESCUE_ETA_MIN, f);
    else if (R.state === 'circling' && now >= R.circleUntil) {
      R.state = 'calling';
      c.toast('Вертолёт ушёл. Разведи костёр на открытом месте и вызови снова.');
    }
    return;
  }
  if (R.state === 'inbound' && now >= R.eta) {
    if (signalFire(c)) {
      R.state = 'done';
      c.toast('Вертолёт садится у костра. Ты спасён.');
      note(s, 'rescue', now, 'Вертолёт сел у сигнального костра');
      c.onRescue?.();
    } else {
      R.state = 'circling';
      R.circleUntil = now + CIRCLE_MIN;
      c.toast('Вертолёт кружит, но дыма нет. Разведи костёр заново!');
    }
  }
}

/** Radio call. Needs all three radio parts. Starts the helicopter at once if a signal fire already burns. */
export function callRescue(c: EventCtx): CallResult {
  const s = core(), R = s.rescue;
  if (R.state === 'done') return 'done';
  if (c.radioParts() < 3) { c.toast('Рация молчит: нужны все три детали.'); return 'locked'; }
  if (R.state !== 'ready' && R.state !== 'locked') return 'pending';
  R.state = 'calling';
  c.toast('Рация: «Вызов принят. Разведите сигнальный костёр на открытом месте».');
  note(s, 'rescue', c.G.time, 'Вызов по рации принят');
  const f = signalFire(c);
  if (f) startInbound(s, c, RESCUE_ETA_MIN, f);
  return 'called';
}

// ---------------------------------------------------------------- effects

function buildEffects(s: Core, c: EventCtx, visibility: number, whiteout: number): Effects {
  const now = c.G.time;
  let flare: Effects['flare'] = null;
  if (s.flare) {
    const e = s.rt - s.flare.t0;
    const bright = e < 1.5 ? e / 1.5 : e < 10 ? 1 : e < 16 ? (16 - e) / 6 : 0;
    if (bright > 0) flare = { x: s.flare.x, y: s.flare.y, bright };
    else s.flare = null;
  }
  let drop: Effects['drop'] = null;
  if (s.drop) {
    const t = clamp((s.rt - s.drop.t0) / DROP_S, 0, 1);
    const sky = s.drop.y - 140;
    drop = { x: s.drop.x, y: sky + (s.drop.y - sky) * t, t };
  }
  let heli: Effects['heli'] = null;
  const R = s.rescue;
  if (R.state === 'inbound') {
    const span = Math.max(1, R.eta - R.t0);
    const p = clamp((now - R.t0) / span, 0, 1);
    heli = { x: R.fx + R.side * (1 - p) * 900, y: R.fy - 60 - (1 - p) * 120, circling: false };
  } else if (R.state === 'circling') {
    const th = s.rt * 1.4;
    heli = { x: R.fx + Math.cos(th) * 70, y: R.fy - 90 + Math.sin(th) * 20, circling: true };
  }
  const tracks: TrackPrint[] = [];
  s.tracks = s.tracks.filter((t) => now < t.appear + 480);
  for (const t of s.tracks) {
    if (now < t.appear) continue;
    const alpha = now < t.appear + 120 ? 1 : clamp(1 - (now - t.appear - 120) / 360, 0, 1);
    tracks.push({ x: t.x, y: t.y, dir: t.dir, alpha });
  }
  return { visibility, whiteout, flare, drop, heli, tracks };
}

// ---------------------------------------------------------------- debug entry point

/** Test hook (main's __frost.event): starts one event now, skipping its time and weather rules but not its warning.
 *  Returns false when the event cannot happen here (for example an ice break away from the lake). */
export function forceEvent(kind: string, c: EventCtx): boolean {
  const s = core(), now = c.G.time, hx = Math.round(c.hero.x), hy = Math.round(c.hero.y);
  switch (kind) {
    case 'flare': {
      const fx = clamp(hx + 900, 60, W - 60);
      s.flare = { x: fx, y: Math.max(0, surfaceAt(fx) - 90), t0: s.rt };
      s.flareDone = true;
      c.cue?.('flareHiss', 1);
      c.toast('На горизонте вспыхнула красная ракета.');
      note(s, 'flare', now, 'Ночью на горизонте вспыхнула ракета');
      return true;
    }
    case 'supplyDrop': {
      if (s.drop) return false;
      dropSupply(s, c);
      return s.drop !== null;
    }
    case 'wolves': {
      c.cue?.('wolfHowl', 0.4);
      c.toast('Вдалеке воют волки. Держись огня.');
      note(s, 'wolves', now, 'Ночью вдали выли волки');
      const dir: 1 | -1 = s.rng() < 0.5 ? 1 : -1;
      let x = Math.round(hx + dir * 700);
      for (let k = 0; k < 12 && x > 20 && x < W - 20; k++) {
        s.tracks.push({ x, y: surfaceAt(x), dir: (-dir) as 1 | -1, appear: now });
        x -= dir * 8;
      }
      return true;
    }
    case 'whiteout': {
      s.forceWhite = s.rt + 25;
      return true;
    }
    case 'avalanche': {
      const site = findSlide(s, hx);
      if (!site) return false;
      c.toast('Снег трещит по склону! Уходи вверх или в сторону.');
      c.cue?.('snowCrack', 1);
      s.realQ.push({ at: s.rt + AVALANCHE_WARN_S, run: (cc) => releaseSlab(core(), cc, site) });
      return true;
    }
    case 'snowDump': {
      if (s.dumpBusy) return false;
      s.dumpBusy = true;
      c.cue?.('treeCreak', 1);
      c.toast('Ель скрипит под тяжестью снега. Сейчас сбросит! Отойди!');
      s.realQ.push({ at: s.rt + DUMP_DELAY_S, run: (cc) => dropCaps(core(), cc, hx, hy) });
      return true;
    }
    case 'iceCrack': {
      const I = s.ice, r = iceRowUnder(hx, hy);
      if (r < 0) return false;                       // not standing on the lake ice
      I.row = r; I.breakAt = s.rt + ICE_BREAK_S;
      c.toast('Лёд проваливается: назад, на снег!');
      s.realQ.push({ at: I.breakAt, run: (cc) => breakIce(core(), cc) });
      return true;
    }
    case 'rescue': {
      const R = s.rescue, f = signalFire(c);
      if (f) { startInbound(s, c, RESCUE_ETA_MIN, f); return true; }
      R.state = 'inbound'; R.t0 = now; R.eta = now + RESCUE_ETA_MIN; R.fx = hx; R.fy = hy; R.side = 1;
      c.cue?.('heliRotor', 1);
      c.toast('Вертолёт на подлёте! (тест: костра нет)');
      return true;
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------- per-frame entry points

/** Advances every event. Call once per frame, after the clock (G.time) has moved. */
export function stepEvents(dt: number, gameDtMinutes: number, ctx: EventCtx): void {
  const s = core();
  const rdt = clamp(dt, 0, 1);
  s.rt += rdt;
  const now = ctx.G.time;

  // heavy-snow memory and avalanche episodes
  const dtH = clamp(gameDtMinutes, 0, 600) / 60;
  s.recentSnow = s.recentSnow * Math.pow(0.5, dtH / 6) + Math.max(0, ctx.G.snowfall) * dtH;
  if (!s.episode && ctx.G.storm >= 0.3 && s.recentSnow >= HEAVY_SNOW_M) {
    s.episode = true;
  } else if (s.episode && ctx.G.storm < 0.3) {
    s.episode = false;
    if (!s.avalancheRolled) {
      s.avalancheRolled = true;                       // the one roll of the game, win or lose
      if (s.rng() < 0.35) {
        s.avalancheArmed = true;
        s.gameQ.push({ at: now + 60 + s.rng() * 240, run: (c) => { s.avalancheArmed = false; tryAvalanche(core(), c); } });
      }
    }
  }

  runDue(s.gameQ, now, ctx);
  runDue(s.realQ, s.rt, ctx);
  updateWhiteout(s, ctx, rdt);
  if (s.rt >= s.dumpCheckAt) { s.dumpCheckAt = s.rt + 1.5; dumpCheck(s, ctx); }
  if (s.rt >= s.iceCheckAt) { s.iceCheckAt = s.rt + 0.5; iceCheck(s, ctx); }
  rescueTick(s, ctx);

  const visibility = Math.max(0.12, 1 - 0.88 * s.white.level);
  s.fx = buildEffects(s, ctx, visibility, s.white.level);
}

/** Effects for the renderer, as of the last stepEvents. */
export function activeEffects(): Effects {
  return core().fx;
}

/** Visibility factor for the renderer and the HUD: 1 = clear, 0.12 = whiteout. */
export function visibilityFactor(): number {
  return core().fx.visibility;
}

/** Events in order, for the journal and the event feed. */
export function eventLog(): readonly EventLogEntry[] {
  return core().log;
}

/** Rescue state for the UI (for example, to show the radio status). */
export function rescueState(): RescueState {
  return core().rescue.state;
}

export const EVENT_KINDS: readonly EventKind[] = ['avalanche', 'wolves', 'whiteout', 'snowDump', 'iceCrack', 'flare', 'supplyDrop', 'rescue'];
