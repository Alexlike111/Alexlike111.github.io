// Shelter evaluation (DESIGN §2 storm exam, §4): enclosure flood fill around the player every ~0.5 s -> G.shelter,
// carbon monoxide per enclosure, a ★ rating (insulation, wind-tightness, warmth, structure), a storm report and wind erosion of loose walls.
// Tile-level flood fill over "air" tiles. A 1-tile-wide shaft reaching the open sky counts as a vent (отдушина); anything wider is an opening.
import { G } from './state';
import { on, emit } from './bus';
import { strings, fmt } from '../content/i18n';
import { W, TW, TH, TS, mat, aux, flags, setCell, edited, F_PLACED } from '../engine/grid';
import { COND, MAT, MATS } from '../content/materials';
import { sky, temp, wind, tempAt } from '../engine/heat';
import { supportPreview, type PreviewCell } from '../engine/structure';
import { throwCell } from '../engine/particles';

const S = strings('shelter', {
  noVent: 'нет отдушины: угарный газ копится',
  vent: 'отдушина есть',
  open: 'вход открыт: тепло и ветер проходят',
  lowEntry: 'лежанка выше входа: тепло не уходит',
  thin: 'стены тонкие: обложи снегом',
  coWarn: 'пламя без отдушины: проветри!',
  windy: 'внутри сквозняк',
  cold: 'внутри холодно: нужен огонь',
  flatRoof: 'плоская крыша держится на честном слове',
  stormNone: 'Пурга {n}: ты пережил её без укрытия',
  stormLine: 'Пурга {n}: укрытие {stars}/4 · мин. {t}° · CO {co}',
});

export interface ShelterGrade {
  closed: boolean; vent: boolean; tiles: number; temp: number; windIn: number; co: number;
  insul: boolean; windtight: boolean; warm: boolean; struct: boolean; stars: number;
  thickness: number; thinnest: number; margin: number; flames: number; notes: string[];
  lowEntry: boolean;
}
export interface StormReport {
  n: number; sheltered: boolean; stars: number; insul: boolean; windtight: boolean; warm: boolean; struct: boolean;
  minT: number; maxCo: number; vent: boolean; wallsLost: number; text: string;
}

// ---------------------------------------------------------------------------------------------------------------------
const stamp = new Int32Array(TW * TH);
let stampN = 0;
const fill = new Int32Array(1100);         // tile indices of the last fill
let fillN = 0;
const queue = new Int32Array(1100);

const BLK = new Uint8Array(256);
MATS.forEach((m, i) => { BLK[i] = m.wind >= 0.9 ? 1 : 0; });
/** Heat-insulation weight of a wall material (low conductivity = good). */
const IW = new Float32Array(256);
MATS.forEach((m, i) => { IW[i] = COND[i] <= 0.12 ? 1 : COND[i] <= 0.45 ? 0.55 : 0.25; });

export function tileBlocked(tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= TW || ty >= TH) return true;
  let i = ty * TS * W + tx * TS, nb = 0;
  for (let j = 0; j < TS; j++, i += W - TS) for (let k = 0; k < TS; k++, i++) if (BLK[mat[i]]) nb++;
  return nb >= 8;
}

interface Fill { tiles: number; open: boolean; vents: number; skyTiles: number; minX: number; maxX: number; minY: number; maxY: number; lowOpen: boolean; id: number }
const F: Fill = { tiles: 0, open: false, vents: 0, skyTiles: 0, minX: 0, maxX: 0, minY: 0, maxY: 0, lowOpen: false, id: 0 };

/** Flood fill from a tile. Fills `fill[]`/stamp; returns the shared result object. */
export function floodEnclosure(tx0: number, ty0: number, limit = 650): Fill {
  F.tiles = 0; F.open = false; F.vents = 0; F.skyTiles = 0; F.minX = tx0; F.maxX = tx0; F.minY = ty0; F.maxY = ty0; F.lowOpen = false; F.id = tx0 + ty0 * TW;
  fillN = 0;
  if (tx0 < 0 || ty0 < 0 || tx0 >= TW || ty0 >= TH || tileBlocked(tx0, ty0)) { F.open = true; return F; }
  stampN++;
  let head = 0, tail = 0;
  const start = ty0 * TW + tx0;
  queue[tail++] = start; stamp[start] = stampN;
  let minId = start;
  while (head < tail) {
    const t = queue[head++];
    const tx = t % TW, ty = (t / TW) | 0;
    if (sky[t]) {
      // a 1-wide vertical channel to the sky is a vent: count it and do not leak through it
      const bl = tileBlocked(tx - 1, ty), br = tileBlocked(tx + 1, ty);
      if (ty < ty0 + 1 && ((bl && br) || (bl && tileBlocked(tx + 2, ty) && !tileBlocked(tx + 1, ty)) || (br && tileBlocked(tx - 2, ty) && !tileBlocked(tx - 1, ty)))) { F.vents++; continue; }
      F.skyTiles++;
      if (F.skyTiles > 14) { F.open = true; break; }
    }
    if (tx <= 0 || ty <= 0 || tx >= TW - 1 || ty >= TH - 1) { F.open = true; break; }
    fill[fillN++] = t;
    if (t < minId) minId = t;
    if (tx < F.minX) F.minX = tx; if (tx > F.maxX) F.maxX = tx; if (ty < F.minY) F.minY = ty; if (ty > F.maxY) F.maxY = ty;
    if (fillN >= limit) { F.open = true; break; }
    for (let d = 0; d < 4; d++) {
      const nx = d === 0 ? tx - 1 : d === 1 ? tx + 1 : tx, ny = d === 2 ? ty - 1 : d === 3 ? ty + 1 : ty;
      const n = ny * TW + nx;
      if (stamp[n] === stampN) continue;
      stamp[n] = stampN;
      if (tileBlocked(nx, ny)) continue;
      if (tail >= queue.length) { F.open = true; break; }
      queue[tail++] = n;
    }
    if (F.open) break;
  }
  F.tiles = fillN; F.id = minId;
  return F;
}
const inFill = (tx: number, ty: number) => stamp[ty * TW + tx] === stampN && !tileBlocked(tx, ty);

/** Flames (kind weight) in the last fill. */
const FLAME_W: Record<string, number> = { campfire: 3, brazier: 3, signal_fire: 4, fat_lamp: 1, torch: 1.2, lantern: 0.3 };
export const extra = { flames: 0 };        // held torch / lantern etc. (set by tools.ts each frame)
function flamesInFill(): number {
  let w = extra.flames;
  for (const f of G.fixtures) {
    if (!f.lit) continue;
    let k = FLAME_W[f.kind];
    if (f.kind === 'stove' && f.data && f.data.chimney === false) k = 2;
    if (!k) continue;
    const tx = f.tx + (f.tw >> 1), ty = f.ty + f.th - 1;
    if (tx >= 0 && ty >= 0 && tx < TW && ty < TH && stamp[ty * TW + tx] === stampN) w += k;
  }
  return w;
}

// ---------------------------------------------------------------------------------------------------------------------
const RAY_COS: number[] = [], RAY_SIN: number[] = [];
for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; RAY_COS.push(Math.cos(a)); RAY_SIN.push(Math.sin(a)); }
function wallThickness(px: number, py: number): { mean: number; min: number } {
  let sum = 0, n = 0, min = 9;
  for (let k = 0; k < 16; k++) {
    if (RAY_SIN[k] > 0.4) continue;                       // floor rays do not count
    let found = false, th = 0;
    for (let s = 0.5; s <= 14; s += 0.5) {
      const tx = Math.floor(px + RAY_COS[k] * s), ty = Math.floor(py + RAY_SIN[k] * s);
      if (tx < 0 || ty < 0 || tx >= TW || ty >= TH) break;
      if (!found) { if (tileBlocked(tx, ty)) found = true; else continue; }
      if (!tileBlocked(tx, ty)) break;
      const m = mat[(ty * TS + 2) * W + tx * TS + 2];
      th += 0.5 * IW[m];
      if (th > 6) break;
    }
    if (!found) th = 0;
    sum += th; n++; if (th < min) min = th;
  }
  return { mean: n ? sum / n : 0, min: n ? min : 0 };
}

let marginCache = { t: -99, id: -1, v: 1 };
function structureMargin(): number {
  if (marginCache.id === F.id && G.realTime - marginCache.t < 4) return marginCache.v;
  // roof cells: the blocked tile directly above the highest fill tile of every column
  const cells: PreviewCell[] = [];
  const top = new Map<number, number>();
  for (let i = 0; i < fillN; i++) { const t = fill[i], tx = t % TW, ty = (t / TW) | 0; const c = top.get(tx); if (c === undefined || ty < c) top.set(tx, ty); }
  for (const [tx, ty] of top) {
    if (cells.length >= 28) break;
    const cx = tx * TS + 2, cy = (ty - 1) * TS + 2;
    if (ty < 1) continue;
    const m = mat[cy * W + cx];
    if (m === 0) continue;
    cells.push({ x: cx, y: cy, m });
  }
  let v = 1;
  if (cells.length) { const r = supportPreview(cells); v = r.ok ? r.margin : 0; }
  marginCache = { t: G.realTime, id: F.id, v };
  return v;
}

/** Full rating of the enclosure containing world cell (x,y) (feet / chest of the observer). */
export function gradeShelter(x: number, y: number, coLevel = 0, withMargin = true): ShelterGrade {
  const g: ShelterGrade = {
    closed: false, vent: false, tiles: 0, temp: tempAt(x, y), windIn: 0, co: coLevel, insul: false, windtight: false, warm: false, struct: false, stars: 0,
    thickness: 0, thinnest: 0, margin: 0, flames: 0, notes: [], lowEntry: false,
  };
  const tx = x >> 2, ty = y >> 2;
  const f = floodEnclosure(tx, ty);
  g.tiles = f.tiles;
  g.vent = f.vents > 0 && !f.open;
  g.closed = !f.open;
  // temperature and wind inside
  let ts = 0, wmax = 0, n = 0;
  for (let i = 0; i < fillN; i++) { const t = fill[i]; if (sky[t] && f.vents) continue; ts += temp[t]; const w = Math.abs(wind[t]); if (w > wmax) wmax = w; n++; }
  if (n) { g.temp = ts / n; g.windIn = wmax; }
  g.flames = flamesInFill();
  if (!g.closed) {
    g.notes.push(S.open);
    // an opening lower than the player's floor: warm air stays (plain-words rule from DESIGN §4)
    g.lowEntry = false;
    return g;
  }
  const wt = wallThickness(tx + 0.5, ty + 0.5);
  g.thickness = wt.mean; g.thinnest = wt.min;
  g.insul = wt.mean >= 1.4 && wt.min >= 0.8;
  const out = G.ambientT;
  g.windtight = g.windIn <= 0.35 || g.windIn <= 0.1 * Math.abs(G.wind);
  g.warm = g.temp >= -6 && g.temp - out >= 8;
  g.margin = withMargin ? structureMargin() : 1;
  g.struct = g.margin >= 0.2;
  g.stars = (g.insul ? 1 : 0) + (g.windtight ? 1 : 0) + (g.warm ? 1 : 0) + (g.struct ? 1 : 0);
  if (!g.insul) g.notes.push(S.thin);
  if (!g.windtight) g.notes.push(S.windy);
  if (!g.warm) g.notes.push(S.cold);
  if (!g.struct) g.notes.push(S.flatRoof);
  // a sleeping platform above the lowest floor of the enclosure keeps the warm air up (DESIGN §4)
  for (const f of G.fixtures) {
    if ((f.kind === 'skin_bed' || f.kind === 'bed') && stamp[(f.ty + f.th - 1) * TW + f.tx] === stampN && f.ty + f.th - 1 < F.maxY) { g.lowEntry = true; g.notes.push(S.lowEntry); break; }
  }
  if (g.flames > 0) g.notes.push(g.vent ? S.vent : S.noVent);
  else if (g.vent) g.notes.push(S.vent);
  return g;
}

// ---------------------------------------------------------------------------------------------------------------------
// carbon monoxide per enclosure
const coMap = new Map<number, number>();
let coId = -1, coLevel = 0;
/** CO level (0..100) of the player's current enclosure. */
export const coNow = () => coLevel;
let coAnchor = -1;
function stepCo(dt: number, f: Fill, flames: number, anchor: number) {
  if (f.id !== coId) {
    // the same room after an edit (a new vent, a melted tile): the gas stays; a different room: remember this one and load the other
    const sameRoom = coAnchor >= 0 && stamp[coAnchor] === stampN;
    if (!sameRoom) { if (coId >= 0) coMap.set(coId, coLevel); coLevel = coMap.get(f.id) ?? 0; if (coMap.size > 10) coMap.delete(coMap.keys().next().value as number); }
    coId = f.id;
  }
  coAnchor = anchor;
  const closed = !f.open;
  const k = f.open ? 0.5 : f.vents > 0 ? 0.08 : 0.004;
  const vol = Math.max(8, f.tiles);
  const rise = closed && flames > 0 ? (flames * 33) / vol : 0;
  coLevel += (rise - k * coLevel) * dt;
  if (coLevel < 0) coLevel = 0; if (coLevel > 100) coLevel = 100;
}

// ---------------------------------------------------------------------------------------------------------------------
let acc = 0;
export function stepShelter(dt: number) {
  const p = G.player;
  if (!p || G.paused) return;
  acc += dt;
  stormErosion(dt);
  if (acc < 0.5) return;
  const dtE = acc; acc = 0;
  const cx = p.x, cy = p.y - 9;
  const covered = coverAbove(cx, cy);
  const g = gradeShelter(cx, cy, coLevel);
  stepCo(dtE * Math.min(G.timeScale, 6), F, g.flames, (cy >> 2) * TW + (cx >> 2));
  g.co = coLevel;
  // show the chip only when there is something enclosed overhead (a roof)
  if (!g.closed && !covered) { G.shelter = null; }
  else {
    const sh = G.shelter ?? (G.shelter = { closed: false, tiles: 0, temp: 0, windIn: 0, vent: false, co: 0, stars: 0, notes: [] });
    sh.closed = g.closed; sh.tiles = g.tiles; sh.temp = g.temp; sh.windIn = g.windIn; sh.vent = g.vent; sh.co = g.co; sh.stars = g.stars; sh.notes = g.notes;
  }
  lastGrade = g;
  if (g.closed && g.stars !== lastStars) { lastStars = g.stars; emit('shelter', { stars: g.stars, closed: true, vent: g.vent }); }
  sampleStorm(g, g.closed);
  // storm exam: if the player is outside, grade the nearest built shelter instead (every 4 s)
  if (report && !g.closed) { scanT += dtE; if (scanT >= 4) { scanT = 0; const nb = scanNearby(p.x, p.y - 9); if (nb) sampleStorm(nb, true); } }
}
let scanT = 0;
/** Best closed enclosure within ~30 tiles of a point (tile-stride scan), or null. */
export function scanNearby(x: number, y: number): ShelterGrade | null {
  const tx0 = x >> 2, ty0 = y >> 2;
  let best: ShelterGrade | null = null;
  for (let dx = -30; dx <= 30; dx += 3) for (let dy = -6; dy <= 3; dy += 3) {
    const tx = tx0 + dx, ty = ty0 + dy;
    if (tileBlocked(tx, ty)) continue;
    let cov = false; for (let d = 1; d <= 8; d++) if (tileBlocked(tx, ty - d)) { cov = true; break; }
    if (!cov) continue;
    const g = gradeShelter(tx * TS + 2, ty * TS + 2, 0, false);
    if (g.closed && g.tiles >= 6 && (!best || g.stars > best.stars)) best = g;
  }
  return best;
}
let lastGrade: ShelterGrade | null = null, lastStars = -1;
export const lastShelterGrade = () => lastGrade;
function coverAbove(x: number, y: number): boolean {
  const tx = x >> 2, ty = y >> 2;
  for (let d = 1; d <= 8; d++) if (tileBlocked(tx, ty - d)) return true;
  return false;
}
/** Force an immediate evaluation (tests / after teleport). */
export function evalShelterNow() { acc = 1; stepShelter(0.001); }
export function resetShelter() { coMap.clear(); coId = -1; coAnchor = -1; coLevel = 0; G.shelter = null; acc = 0; lastGrade = null; report = null; marginCache.id = -1; }

// ---------------------------------------------------------------------------------------------------------------------
// storm exam
let report: null | { n: number; best: ShelterGrade | null; minT: number; maxCo: number; samples: number; closedSamples: number; wallTilesStart: number; ventSeen: boolean } = null;
function sampleStorm(g: ShelterGrade, inside: boolean) {
  if (!report) return;
  report.samples++;
  if (inside) {
    report.closedSamples++;
    if (!report.best || g.stars >= report.best.stars) report.best = { ...g, notes: g.notes.slice() };
    if (g.temp < report.minT) report.minT = g.temp;
    if (g.co > report.maxCo) report.maxCo = g.co;
    if (g.vent) report.ventSeen = true;
  }
}
function countWallTiles(): number {
  const p = G.player; if (!p) return 0;
  const x0 = Math.max(0, (p.x | 0) - 60), x1 = Math.min(W - 1, (p.x | 0) + 60), y0 = Math.max(0, (p.y | 0) - 40), y1 = Math.min(767, (p.y | 0) + 20);
  let c = 0;
  for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) { const i = y * W + x; if (mat[i] === MAT.SNOWBLOCK && (flags[i] & F_PLACED)) c++; }
  return c;
}
on('storm_start', (d: { n: number }) => {
  report = { n: d.n, best: null, minT: 99, maxCo: 0, samples: 0, closedSamples: 0, wallTilesStart: countWallTiles(), ventSeen: false };
});
/** Called by weather.ts when a storm ends: closes the running report. */
export function finishStormReport(n: number): StormReport {
  const r = report && report.n === n ? report : null;
  report = null;
  if (!r || !r.best) {
    return { n, sheltered: false, stars: 0, insul: false, windtight: false, warm: false, struct: false, minT: G.ambientT, maxCo: 0, vent: false, wallsLost: 0, text: fmt(S.stormNone, { n }) };
  }
  const b = r.best;
  const lost = Math.max(0, r.wallTilesStart - countWallTiles());
  const stars = Math.max(0, b.stars - (lost > 3 ? 1 : 0));
  return {
    n, sheltered: true, stars, insul: b.insul, windtight: b.windtight, warm: b.warm, struct: b.struct && lost <= 3,
    minT: Math.round(r.minT), maxCo: Math.round(r.maxCo), vent: r.ventSeen, wallsLost: lost,
    text: fmt(S.stormLine, { n, stars, t: Math.round(r.minT), co: Math.round(r.maxCo) }),
  };
}
export const runningStormReport = () => report;

// ---------------------------------------------------------------------------------------------------------------------
// wind erosion: loose placed snow blocks on the windward face crumble in storms (dense blocks resist)
let eAcc = 0;
function stormErosion(dt: number) {
  const w = G.wind;
  if (Math.abs(w) < 11 || G.paused) return;
  eAcc += dt;
  if (eAcc < 0.25) return;
  eAcc = 0;
  const dir = w > 0 ? 1 : -1, win = G.win;
  const sx = win.x1 - win.x0 + 1, sy = win.y1 - win.y0 + 1;
  for (let k = 0; k < 40; k++) {
    const x = win.x0 + ((Math.random() * sx) | 0), y = win.y0 + ((Math.random() * sy) | 0);
    if (x < 2 || y < 2 || x >= W - 2) continue;
    const i = y * W + x;
    if (mat[i] !== MAT.SNOWBLOCK) continue;
    if (mat[i - dir] !== MAT.AIR) continue;                     // windward face must be exposed
    const dens = 60 + aux[i] * 1.6;
    const p = Math.max(0, (Math.abs(w) - 10) / 14) * Math.max(0, (400 - dens) / 400) * 0.35;
    if (Math.random() > p) continue;
    setCell(x, y, MAT.AIR, 0, 0);
    throwCell(x, y, MAT.SNOW, 60, dir * (14 + Math.random() * 10), -4 - Math.random() * 6);
    edited(x, y, x, y);
  }
}
