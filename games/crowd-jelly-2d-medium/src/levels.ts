// Level data: pure logic, no DOM. A level is a list of rows; every row has 3 lanes (cells).
// The crowd is a counter, never one object per jelly. The numbers in a level are scaled by the
// crowd the player brings (clamped to 1x..4x of the level's tier), so every map fits its crowd.

export const MAX_CROWD = 1_000_000;
export const MIN_CROWD = 10;
export const LANES = 3;

export type CellKind = 'empty' | 'add' | 'mul' | 'sub' | 'div' | 'saw' | 'enemy';
export interface Cell { kind: CellKind; v: number } // add/sub/enemy: jellies; mul/div: factor; saw: share lost (0..1)
export interface Row { cells: Cell[] }
export interface Level { index: number; req: number; theme: number; scale: number; rows: Row[]; boss: number }

/** Crowd needed to enter each map. Map 1 is always open. */
export const REQ = [0, 30, 90, 300, 1000, 3000, 10_000, 30_000, 100_000, 300_000, 600_000, 900_000];
export const LEVEL_COUNT = REQ.length;
export const THEMES = 4;

/** Tier size of a map: the crowd the map is made for. */
export const tier = (k: number): number => (k === 0 ? 16 : REQ[k]);

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Round to 2 significant digits so gate numbers look hand-made. */
export function nice(v: number): number {
  if (v < 10) return Math.max(1, Math.round(v));
  const p = Math.pow(10, Math.floor(Math.log10(v)) - 1);
  return Math.round(v / p) * p;
}

const E: Cell = { kind: 'empty', v: 0 };
const GROWTH = 2.4; // growth of the perfect path before the boss
const BOSS_SHARE = 0.45; // boss wall as a share of the perfect crowd at the boss

/**
 * Build map k for a player who brings `crowd` jellies. Every number is a share of the crowd the perfect
 * path has at that row, so the map fits its crowd; a controller keeps that path near a fixed growth
 * (rows that give when the path is behind, rows that cost when it is ahead).
 */
export function buildLevel(k: number, crowd: number): Level {
  const r = rng(1000 + k * 77);
  const scale = Math.min(Math.max(crowd, tier(k)), tier(k) * 4, MAX_CROWD);
  const n = 14 + Math.min(6, Math.floor(k / 2));
  const mulAt = Math.round(n * (0.4 + (k % 3) * 0.1));
  const rows: Row[] = [];
  let c = scale;
  for (let i = 0; i < n; i++) {
    const plan = scale * Math.pow(GROWTH, (i + 1) / n);
    const ahead = c > plan * 1.03;
    const u = (lo: number, hi: number) => nice(c * (lo + r() * (hi - lo)));
    let cells: Cell[];
    if (i === mulAt && k >= 1) {
      cells = [{ kind: 'mul', v: 2 }, { kind: 'add', v: u(0.08, 0.14) }, { kind: 'div', v: 2 }];
    } else if (ahead) {
      const q = r();
      if (q < 0.4) cells = [{ kind: 'saw', v: 0.12 + r() * 0.1 }, { kind: 'saw', v: 0.2 + r() * 0.1 }, { kind: 'saw', v: 0.28 + r() * 0.08 }];
      else if (q < 0.75) cells = [{ kind: 'enemy', v: u(0.1, 0.14) }, { kind: 'enemy', v: u(0.16, 0.22) }, { kind: 'enemy', v: u(0.24, 0.3) }];
      else cells = [{ kind: 'sub', v: u(0.1, 0.14) }, { kind: 'saw', v: 0.2 }, { kind: 'enemy', v: u(0.16, 0.2) }];
    } else {
      const q = r();
      if (q < 0.4) cells = [{ kind: 'add', v: u(0.1, 0.18) }, { kind: 'add', v: u(0.03, 0.06) }, { kind: 'sub', v: u(0.08, 0.14) }];
      else if (q < 0.7) cells = [{ kind: 'add', v: u(0.07, 0.12) }, E, { kind: 'add', v: u(0.03, 0.05) }];
      else cells = [{ kind: 'add', v: u(0.1, 0.16) }, { kind: 'saw', v: 0.3 }, { kind: 'enemy', v: u(0.2, 0.3) }];
    }
    for (let a = cells.length - 1; a > 0; a--) {
      const b = Math.floor(r() * (a + 1));
      [cells[a], cells[b]] = [cells[b], cells[a]];
    }
    const row: Row = { cells };
    rows.push(row);
    const o = applyCell(c, cells[bestLane(c, row)]);
    c = o.dead ? c : o.crowd;
  }
  return { index: k, req: REQ[k], theme: k % THEMES, scale, rows, boss: nice(c * BOSS_SHARE) };
}

export interface Outcome { crowd: number; dead: boolean }

/** What one cell does to the crowd. An enemy squad kills the crowd if it is not bigger than the squad. */
export function applyCell(crowd: number, c: Cell): Outcome {
  switch (c.kind) {
    case 'add': return { crowd: Math.min(MAX_CROWD, crowd + c.v), dead: false };
    case 'sub': return { crowd: Math.max(1, crowd - c.v), dead: false };
    case 'mul': return { crowd: Math.min(MAX_CROWD, Math.floor(crowd * c.v)), dead: false };
    case 'div': return { crowd: Math.max(1, Math.floor(crowd / c.v)), dead: false };
    case 'saw': return { crowd: Math.max(1, Math.floor(crowd * (1 - c.v))), dead: false };
    case 'enemy': return crowd > c.v ? { crowd: crowd - c.v, dead: false } : { crowd: 0, dead: true };
    default: return { crowd, dead: false };
  }
}

/** Boss wall: the crowd must be bigger than it; it costs half of the boss size. */
export function applyBoss(crowd: number, boss: number): Outcome {
  return crowd > boss ? { crowd: Math.min(MAX_CROWD, crowd - Math.floor(boss / 2)), dead: false } : { crowd: 0, dead: true };
}

/** Defeat keeps most of the crowd: the player retreats. */
export const afterDefeat = (start: number): number => Math.max(MIN_CROWD, Math.floor(start * 0.9));

/** The best lane for a bot (QA, balance): highest resulting crowd, never a deadly one. */
export function bestLane(crowd: number, row: Row): number {
  let best = 0, bv = -1;
  row.cells.forEach((c, i) => {
    const o = applyCell(crowd, c);
    const v = o.dead ? -1 : o.crowd;
    if (v > bv) { bv = v; best = i; }
  });
  return best;
}

export function playBot(k: number, start: number, mistakes = 0, seed = 1): { end: number; dead: boolean } {
  const lv = buildLevel(k, start);
  const r = rng(seed);
  let c = start;
  for (const row of lv.rows) {
    let lane = bestLane(c, row);
    if (r() < mistakes) lane = Math.floor(r() * LANES);
    const o = applyCell(c, row.cells[lane]);
    if (o.dead) return { end: 0, dead: true };
    c = o.crowd;
  }
  const b = applyBoss(c, lv.boss);
  return b.dead ? { end: 0, dead: true } : { end: b.crowd, dead: false };
}

/** Compact number for the HUD: 950, 9,999, 12.3K, 1M. */
export function compact(n: number): string {
  n = Math.floor(n);
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(2)}M`;
  if (n >= 100_000) return `${Math.round(n / 1000)}K`;
  if (n >= 10_000) return `${+(n / 1000).toFixed(1)}K`;
  return String(n);
}
