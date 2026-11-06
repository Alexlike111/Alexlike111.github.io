// Fauna, phase 1: snowshoe hares (заяц-беляк) and willow ptarmigan (белая куропатка) on the snow surface, plus snares (силки).
// Units: world cells (CELL = 0.05 m, so 20 cells per metre), y grows downward. An animal's (x, y) is its feet on the snow:
// y is the top edge of the surface cell it stands on, z is its height above that (hops, flight).
// Integration hooks: see items_spec.md, section «Интеграция fauna phase 2».
import { W, H, M, mat, dens, bond, flags, body, idx, set, wake, surfaceAt, trees, START_X, F_BLOCK, F_CAP, BOND_SOLID } from './world';
import { G } from './state';

export interface FaunaHero { x: number; y: number; }   // hero feet (player.ts pl.x / pl.y); the body centre is 17 cells above
export interface Snare { x: number; y: number; state: 0 | 1; pending: boolean; visitor: number; catches: number; }
export interface Animal {
  kind: number; alive: boolean; state: number;
  x: number; y: number; z: number;
  face: number; tx: number;
  t: number; dur: number; pause: number; frozenT: number; ignoreT: number;
  home: number; R: number; fleeR: number; freezeR: number;
  flock: number; phase: number; stepAcc: number; stride: number;
  sy: number; recheck: number; px: number; py: number;
  x0: number; y0: number; lx: number; ly: number; arcH: number;
}

export const K_HARE = 0, K_BIRD = 1;
const ST_WANDER = 0, ST_FREEZE = 1, ST_FLEE = 2, ST_FLY = 3, ST_GOHIDE = 4, ST_HIDE = 5, ST_DEAD = 6, ST_HOP = 7;

const POOL = 20;                       // hard cap on animals
const FLOCKS_MAX = 4;                  // 4 flocks x 3 birds + 6 hares = 18 at most
const SNARE_MAX = 12;
const SNARE_R = 10;                    // 0.5 m: a path this close to a snare is a crossing
const CATCH_P = 0.35;                  // per crossing, per game hour
const HARE_WALK = 14, HARE_FLEE = 95;  // cells/s (0.7 m/s walking, ~4.7 m/s hopping away)
const BIRD_WALK = 8, BIRD_RUN = 45;    // cells/s (0.4 m/s, ~2.2 m/s running)
const PACK_D = 30, PACK_B = 10, PACK_DMAX = 380; // footprint: 30 kg/m3 of the surface cell moves down, bond +10 below (leader decision 6)
const PACK_KEEP = 30;                  // a surface cell left with less than this is emptied: its whole mass goes down
const HOP_MIN = 2, HOP_MAX = 12, HOP_ARC = 10, HOP_T = 0.35;   // hop over a trunk: landing 0.1-0.6 m ahead, arc 0.5 m, 0.35 s
const HERO_MID = 17;

// ---------- random (own stream, does not disturb world.rnd()) ----------
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rng = mulberry32(1);
const rnd = () => rng();
const rr = (a: number, b: number) => a + (b - a) * rng();

// ---------- state ----------
export const animals: Animal[] = [];
export const snares: Snare[] = [];
interface Flock { cx: number; home: number; retarget: number; alarmT: number; }
const flocks: Flock[] = [];
const homes: number[] = [];            // forest tree bases (x) the animals live around
let hareTarget = 0, hareDeficit = 0, respawnLeft = 0, snareClock = 0;
let hideAll = false, ready = false;

function newAnimal(): Animal {
  return {
    kind: K_HARE, alive: false, state: ST_DEAD, x: 0, y: 0, z: 0, face: 1, tx: 0,
    t: 0, dur: 1, pause: 0, frozenT: 0, ignoreT: 0, home: 0, R: 200, fleeR: 70, freezeR: 160,
    flock: -1, phase: 0, stepAcc: 0, stride: 6, sy: 0, recheck: 0, px: 0, py: 0,
    x0: 0, y0: 0, lx: 0, ly: 0, arcH: 0,
  };
}
for (let i = 0; i < POOL; i++) animals.push(newAnimal());

// ---------- world queries ----------
/** Row of the snow surface the feet stand on in column col, or -1 when there is no snow (ice, rock, edge of the map). */
function groundRow(col: number): number {
  if (col < 3 || col >= W - 3) return -1;
  const y = surfaceAt(col);
  return y > 0 && y < H && mat[idx(col, y)] === M.SNOW ? y : -1;
}

/** Trunks, rock, crates, poles and planks standing in the body's column block walking (boughs and snow do not). */
function obstacle(col: number, sy: number): boolean {
  for (let r = 1; r <= 4; r++) {
    const y = sy - r;
    if (y < 0) return true;
    const m = mat[idx(col, y)];
    if (m === M.WOOD || m === M.ROCK || m === M.CRATE || m === M.POLE || m === M.PLANK || m === M.DOOR) return true;
  }
  return false;
}

/** Footprint on the surface cell (x, y): its mass moves down into the cell beneath (mass conserving, leader decision 6).
 *  The top cell loses PACK_D kg/m3; a cell left under PACK_KEEP is emptied and its last mass goes down too. The cell below gains the same
 *  mass and a little bond. Nothing is made from air, and rigid or placed snow is left alone. Refused if the cell below cannot take it. */
function pack(x: number, y: number) {
  if (x < 0 || x >= W || y < 0 || y + 1 >= H) return;
  const i = idx(x, y), j = i + W;
  if (mat[i] !== M.SNOW || body[i] || (flags[i] & (F_BLOCK | F_CAP))) return;
  if (mat[j] !== M.SNOW || body[j] || (flags[j] & (F_BLOCK | F_CAP))) return;
  const d = dens[i];
  let t = Math.min(PACK_D, d);
  if (d - t < PACK_KEEP) t = d;
  if (dens[j] + t > PACK_DMAX) return;
  dens[j] += t;
  bond[j] = Math.min(BOND_SOLID - 1, bond[j] + PACK_B);
  wake(x, y + 1);
  if (t >= d) set(x, y, M.AIR);            // the surface cell is emptied: the print sinks by one cell
  else { dens[i] = d - t; wake(x, y); }
}

function printTrack(a: Animal) {
  const c = Math.round(a.x);
  pack(c, a.sy);
  if (a.kind === K_HARE) pack(c - (a.face < 0 ? -1 : 1), a.sy);   // hare: two cells (hind and fore foot)
  a.stepAcc = 0;
}

// ---------- movement ----------
/** One cell-sized step (or less) on the surface. False when the way is blocked (a step too high, a trunk, a rock, ice). */
function advance(a: Animal, dx: number, maxUp: number): boolean {
  const nx = a.x + dx;
  const c0 = Math.round(a.x), c1 = Math.round(nx);
  if (c1 !== c0) {
    const sy = groundRow(c1);
    if (sy < 0 || obstacle(c1, sy) || sy < a.sy - maxUp) return false;
    a.sy = sy;
  }
  a.x = nx; a.y = a.sy; a.stepAcc += Math.abs(dx);
  return true;
}

/** Walks dist cells in sub-steps of at most one cell (so no wall is jumped), printing footprints every stride. */
function move(a: Animal, dist: number, maxUp: number): boolean {
  const n = Math.ceil(Math.abs(dist));
  if (n <= 0) return true;
  const s = dist / n;
  for (let k = 0; k < n; k++) {
    if (!advance(a, s, maxUp)) return false;
    if (a.stepAcc >= a.stride) printTrack(a);
  }
  return true;
}

function pickTarget(a: Animal) {
  for (let k = 0; k < 8; k++) {
    const t = a.home + (rnd() * 2 - 1) * a.R;
    const c = Math.round(t);
    if (c > 6 && c < W - 7 && groundRow(c) >= 0) { a.tx = t; return; }
  }
  a.tx = a.x;
}

/** Walks toward tx. True when it has arrived or is blocked. */
function walkTo(a: Animal, dt: number, speed: number, maxUp: number): boolean {
  const dxT = a.tx - a.x;
  if (Math.abs(dxT) < 1.5) return true;
  const dir = dxT > 0 ? 1 : -1;
  a.face = dir;
  if (!move(a, Math.min(Math.abs(dxT), speed * dt) * dir, maxUp)) return true;
  a.z = 0;
  return false;
}

/** Forage: walk between targets near home (tree base or flock centre), with pauses. */
function wander(a: Animal, dt: number) {
  if (a.pause > 0) { a.pause -= dt; a.z = 0; return; }
  const dxT = a.tx - a.x;
  if (Math.abs(dxT) < 1.5) { pickTarget(a); a.pause = a.kind === K_HARE ? rr(1, 6) : rr(1.5, 5); return; }
  if (rnd() < dt * 0.25) { a.pause = rr(0.8, 3); return; }      // stops to nibble / peck
  const dir = dxT > 0 ? 1 : -1;
  a.face = dir;
  const sp = a.kind === K_HARE ? HARE_WALK : BIRD_WALK;
  if (!move(a, Math.min(Math.abs(dxT), sp * dt) * dir, a.kind === K_HARE ? 4 : 2)) {
    a.tx = a.x - dir * rr(6, 20); a.pause = 0.6;                // blocked: turn back
  }
  a.z = 0;
}

// ---------- flight and flight distance ----------
function startFlee(a: Animal, dir: number) {
  a.state = ST_FLEE; a.face = dir; a.t = 0; a.pause = 0; a.frozenT = 0;
  a.dur = a.kind === K_HARE ? rr(2.5, 4) : rr(1.2, 1.8);       // hare: how long it runs; bird: the run before the burst
  if (a.kind === K_BIRD && a.flock >= 0) {
    const fl = flocks[a.flock];
    if (fl.alarmT <= 0) {                                       // one bird's alarm sends the whole flock up
      fl.alarmT = 2.5;
      for (let i = 0; i < animals.length; i++) {
        const m = animals[i];
        if (m !== a && m.alive && m.flock === a.flock && (m.state === ST_WANDER || m.state === ST_FREEZE)) startFlee(m, dir);
      }
    }
  }
}

function startFly(a: Animal, dir: number) {
  let best = -1, bestX = Math.round(a.x);
  const c0 = Math.round(a.x + dir * rr(200, 400));              // 10-20 m away
  for (let d = 0; d <= 80 && best < 0; d++) {
    for (let s = -1; s <= 1; s += 2) {
      if (d === 0 && s === 1) continue;
      const c = c0 + s * d;
      if (c < 6 || c > W - 7) continue;
      const sy = groundRow(c);
      if (sy >= 0 && !obstacle(c, sy)) { best = sy; bestX = c; break; }
    }
  }
  if (best < 0) { bestX = Math.round(a.x); best = a.sy; }      // no clear snow ahead: land where it is
  a.x0 = a.x; a.y0 = a.y; a.lx = bestX; a.ly = best;
  a.face = bestX >= a.x ? 1 : -1;
  a.t = 0; a.dur = rr(1.6, 2.4); a.arcH = rr(30, 50); a.state = ST_FLY; a.z = 0;
}

/** A fleeing hare blocked by a trunk, log or crate hops over it when free ground lies 0.1-0.6 m beyond (leader decision 7). False when none. */
function hopOver(a: Animal): boolean {
  const c0 = Math.round(a.x);
  for (let k = HOP_MIN; k <= HOP_MAX; k++) {
    const c = c0 + a.face * k;
    const sy = groundRow(c);
    if (sy < 0 || obstacle(c, sy) || Math.abs(sy - a.sy) > 4) continue;
    a.x0 = a.x; a.y0 = a.y; a.lx = c; a.ly = sy; a.frozenT = 0; a.state = ST_HOP;
    return true;
  }
  return false;
}

function hopStep(a: Animal, dt: number) {
  a.frozenT += dt;
  const p = Math.min(1, a.frozenT / HOP_T);
  a.x = a.x0 + (a.lx - a.x0) * p;
  a.y = a.y0 + (a.ly - a.y0) * p;
  a.z = HOP_ARC * Math.sin(Math.PI * p);
  if (p >= 1) { a.x = a.lx; a.sy = a.ly; a.y = a.ly; a.z = 0; a.state = ST_FLEE; a.stepAcc = 0; }
}

function fleeStep(a: Animal, dt: number) {
  a.t += dt;
  if (a.kind === K_HARE) {
    const p = a.t / a.dur;
    if (p >= 1) { a.state = ST_WANDER; a.pause = rr(3, 7); a.z = 0; a.y = a.sy; return; }
    a.phase += dt * 2.8;                                         // hops per second
    a.z = 4 * Math.abs(Math.sin(Math.PI * a.phase));             // 20 cm hop arc
    if (!move(a, a.face * HARE_FLEE * (1 - 0.6 * p) * dt, 4)) {  // blocked by a trunk: hop over it, or turn back and wander off
      if (!hopOver(a)) { a.face = -a.face; a.state = ST_WANDER; a.pause = rr(0.5, 1.5); a.tx = a.x + a.face * rr(6, 20); a.z = 0; a.y = a.sy; }
    }
  } else if (a.t < a.dur) {
    a.z = 0;
    if (!move(a, a.face * BIRD_RUN * dt, 2)) a.t = a.dur;        // blocked: take off where it stands
  } else {
    startFly(a, a.face);
  }
}

function flyStep(a: Animal, dt: number) {
  a.t += dt;
  const p = Math.min(1, a.t / a.dur);
  a.x = a.x0 + (a.lx - a.x0) * p;
  a.y = a.y0 + (a.ly - a.y0) * p;
  a.z = a.arcH * Math.sin(Math.PI * p);
  if (p >= 1) {
    a.x = a.lx; a.y = a.ly; a.sy = a.ly; a.z = 0;
    a.state = ST_WANDER; a.pause = rr(4, 10); a.stepAcc = 0;
  }
}

// ---------- the AI ----------
function think(a: Animal, dt: number, hero: FaunaHero) {
  if (a.state === ST_FLY) { flyStep(a, dt); return; }
  if (a.state === ST_HOP) { hopStep(a, dt); return; }
  if (a.state === ST_FLEE) { fleeStep(a, dt); return; }
  // distance from the hero's body centre to the animal (cells)
  const ddx = a.x - hero.x, ddy = (a.y - (a.kind === K_HARE ? 3 : 2)) - (hero.y - HERO_MID);
  const dh = Math.sqrt(ddx * ddx + ddy * ddy);
  if (hideAll) {                                                 // night or storm: burrow into the snow under the trees
    if (a.state !== ST_HIDE && a.state !== ST_GOHIDE) { a.state = ST_GOHIDE; a.tx = a.home + (rnd() * 2 - 1) * 40; }
    if (a.state === ST_GOHIDE) { if (walkTo(a, dt, 25, 2)) a.state = ST_HIDE; }   // hurries to a burrow (~1.2 m/s)
    a.z = 0;
    return;
  }
  if (a.state === ST_HIDE || a.state === ST_GOHIDE) { a.state = ST_WANDER; a.pause = rr(0, 4); }
  if (dh < a.fleeR) { startFlee(a, ddx >= 0 ? 1 : -1); return; }   // 3-4 m: run / hop / burst-fly away
  if (a.ignoreT > 0) a.ignoreT -= dt;
  else if (dh < a.freezeR) {                                       // 6-10 m: freeze and watch
    if (a.state !== ST_FREEZE) { a.state = ST_FREEZE; a.frozenT = 0; }
    a.frozenT += dt; a.y = a.sy; a.z = 0;
    if (a.frozenT > 6) {                                           // habituated: walk off, away from the hero
      a.state = ST_WANDER; a.frozenT = 0; a.ignoreT = 8; a.pause = 0;
      a.tx = a.x + (ddx >= 0 ? 1 : -1) * rr(10, 40);
    }
    return;
  }
  if (a.state === ST_FREEZE) a.state = ST_WANDER;
  wander(a, dt);
}

// ---------- snares ----------
/** Records a hare's path (a.px,a.py -> a.x,a.y) passing within SNARE_R of an armed snare. The catch is rolled once per game hour. */
function crossSnares(a: Animal, ai: number) {
  const ax = a.px, ay = a.py, bx = a.x, by = a.y;
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  for (let s = 0; s < snares.length; s++) {
    const sn = snares[s];
    if (sn.state !== 0 || sn.pending) continue;
    if (Math.abs(sn.y - ay) > 6 && Math.abs(sn.y - by) > 6) continue;
    let t = L2 > 0 ? ((sn.x - ax) * dx + (sn.y - ay) * dy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t - sn.x, py = ay + dy * t - sn.y;
    if (px * px + py * py <= SNARE_R * SNARE_R) { sn.pending = true; sn.visitor = ai; }
  }
}

function snareTick(gameDt: number) {
  snareClock += gameDt;
  while (snareClock >= 60) {
    snareClock -= 60;
    for (let s = 0; s < snares.length; s++) {
      const sn = snares[s];
      if (!sn.pending) continue;
      sn.pending = false;
      if (sn.state !== 0 || rnd() >= CATCH_P) continue;
      const a = animals[sn.visitor];
      if (!a || !a.alive || a.kind !== K_HARE) continue;
      a.alive = false; a.state = ST_DEAD;                          // the hare hangs in the loop
      sn.state = 1;
      hareDeficit++;
      if (respawnLeft <= 0) respawnLeft = rr(20, 40);
    }
  }
}

// ---------- population ----------
function spawnAnimal(kind: number, home: number, flock: number): Animal | null {
  let slot: Animal | null = null;
  for (let i = 0; i < animals.length; i++) if (!animals[i].alive) { slot = animals[i]; break; }
  if (!slot) return null;
  const spread = kind === K_HARE ? 150 : 60;
  for (let k = 0; k < 12; k++) {
    const x = home + rr(-spread, spread);
    const c = Math.round(x), sy = groundRow(c);
    if (sy < 0 || obstacle(c, sy)) continue;
    const a = slot;
    a.kind = kind; a.alive = true; a.state = ST_WANDER;
    a.x = x; a.y = sy; a.z = 0; a.sy = sy; a.px = x; a.py = sy;
    a.face = rnd() < 0.5 ? 1 : -1; a.tx = x; a.t = 0; a.dur = 1; a.pause = rr(0, 5);
    a.frozenT = 0; a.ignoreT = 0;
    a.home = home; a.flock = flock;
    a.R = kind === K_HARE ? rr(160, 280) : rr(90, 150);          // 8-14 m for hares, 4-7 m for birds
    a.fleeR = rr(60, 80);                                        // 3-4 m
    a.freezeR = rr(120, 200);                                    // 6-10 m
    a.phase = rnd() * 6; a.stride = kind === K_HARE ? 6 : 4; a.stepAcc = rnd() * a.stride;
    a.recheck = rr(0.2, 0.6);
    a.x0 = x; a.y0 = sy; a.lx = x; a.ly = sy; a.arcH = 0;
    return a;
  }
  return null;
}

function pickFarHome(hero: FaunaHero): number {
  for (let k = 0; k < 12 && homes.length; k++) {
    const h = homes[Math.floor(rnd() * homes.length)];
    if (Math.abs(h - hero.x) >= 500) return h;                   // at least 25 m from the hero
  }
  return NaN;
}

function retargetFlock(f: number) {
  const fl = flocks[f];
  fl.retarget = rr(25, 60);
  const cx = Math.round(fl.home + rr(-240, 240));
  if (groundRow(cx) < 0) return;
  fl.cx = cx;
  for (let i = 0; i < animals.length; i++) {
    const m = animals[i];
    if (m.alive && m.kind === K_BIRD && m.flock === f) m.home = cx;
  }
}

function respawnTick(gameDt: number, hero: FaunaHero) {
  if (hareDeficit <= 0) return;
  respawnLeft -= gameDt;
  if (respawnLeft > 0) return;
  respawnLeft = rr(20, 40);
  const home = pickFarHome(hero);
  if (Number.isNaN(home)) return;
  if (spawnAnimal(K_HARE, home, -1)) hareDeficit--;
}

/** Seeds the forest animals. Call after world.generate(seed); the same seed gives the same animals. Clears all snares. */
export function initFauna(seed: number) {
  rng = mulberry32((seed ^ 0x2f6e2b1) | 0);
  for (let i = 0; i < animals.length; i++) { animals[i].alive = false; animals[i].state = ST_DEAD; }
  snares.length = 0; flocks.length = 0; homes.length = 0;
  hareDeficit = 0; respawnLeft = 0; snareClock = 0; hideAll = false; ready = false;
  for (let i = 0; i < trees.length; i++) {
    const t = trees[i];
    if (t.alive && t.x > 60 && t.x < W - 60 && Math.abs(t.x - START_X) > 260) homes.push(t.x);
  }
  if (homes.length === 0) return;
  hareTarget = 3 + Math.floor(rnd() * 4);                        // 3-6 hares
  for (let k = 0; k < hareTarget; k++) spawnAnimal(K_HARE, homes[Math.floor(rnd() * homes.length)], -1);
  const nFlocks = 2 + Math.floor(rnd() * 3);                      // 2-4 ptarmigan flocks
  for (let f = 0; f < nFlocks && f < FLOCKS_MAX; f++) {
    const home = homes[Math.floor(rnd() * homes.length)];
    const cx = Math.round(home + rr(-120, 120));
    flocks.push({ cx: groundRow(cx) >= 0 ? cx : home, home, retarget: rr(25, 60), alarmT: 0 });
    const size = 2 + Math.floor(rnd() * 2);                       // 2-3 birds
    for (let b = 0; b < size; b++) spawnAnimal(K_BIRD, flocks[f].cx, f);
  }
  ready = true;
}

/** One sim frame. dt: real seconds of motion (<= 0.1 used); gameDt: game minutes that passed (G.time delta). hero: pl (x, y feet). */
export function stepFauna(dt: number, gameDt: number, hero: FaunaHero) {
  if (!ready) return;
  const h = dt > 0 ? Math.min(dt, 0.1) : 0;
  if (!hideAll && (G.daylight < 0.12 || G.storm > 0.55)) hideAll = true;
  else if (hideAll && G.daylight > 0.25 && G.storm < 0.3) hideAll = false;
  for (let f = 0; f < flocks.length; f++) {
    const fl = flocks[f];
    if (fl.alarmT > 0) fl.alarmT -= h;
    fl.retarget -= h;
    if (fl.retarget <= 0) retargetFlock(f);
  }
  for (let i = 0; i < animals.length; i++) {
    const a = animals[i];
    if (!a.alive) continue;
    a.px = a.x; a.py = a.y;
    a.recheck -= h;
    if (a.recheck <= 0) {                                        // snowfall or drift may have raised / buried the ground under it
      a.recheck = 0.5;
      const r = groundRow(Math.round(a.x));
      if (r >= 0 && a.state !== ST_FLY && a.state !== ST_HOP) { a.sy = r; a.y = r; }
    }
    think(a, h, hero);
    if (a.kind === K_HARE && a.alive && (a.x !== a.px || a.y !== a.py)) crossSnares(a, i);
  }
  snareTick(gameDt);
  respawnTick(gameDt, hero);
}

// ---------- snares API ----------
/** Sets a snare on the snow under column x (y is taken from the surface). Returns its index in snares, or -1 (no snow, too many). */
export function placeSnare(x: number, _y?: number): number {
  if (!ready || snares.length >= SNARE_MAX) return -1;
  const col = Math.round(x), sy = groundRow(col);
  if (sy < 0 || obstacle(col, sy)) return -1;
  snares.push({ x: col, y: sy, state: 0, pending: false, visitor: -1, catches: 0 });
  return snares.length - 1;
}

/** Picks up snare i (armed or emptied; a caught one is collected with checkSnare first). Returns false if nothing was removed. */
export function removeSnare(i: number): boolean {
  const sn = snares[i];
  if (!sn || sn.state !== 0) return false;
  snares.splice(i, 1);
  return true;
}

/** Index of the nearest snare within radius cells of (x, y), or -1. */
export function checkSnareAt(x: number, y: number, radius: number): number {
  let best = -1, bd = radius * radius;
  for (let s = 0; s < snares.length; s++) {
    const sn = snares[s];
    const d = (sn.x - x) * (sn.x - x) + (sn.y - y) * (sn.y - y);
    if (d <= bd) { bd = d; best = s; }
  }
  return best;
}

/** Collects a caught hare: {meat, pelt} (one portion of raw meat, one pelt), and re-arms the snare. null when nothing hangs in it. */
export function checkSnare(i: number): { meat: number; pelt: number } | null {
  const sn = snares[i];
  if (!sn || sn.state !== 1) return null;
  sn.state = 0; sn.catches++;
  return { meat: 1, pelt: 1 };
}

/** Living animals within r cells of (x, y) (hidden ones excluded). Allocates the result; call it on demand, not per frame. */
export function faunaNear(x: number, y: number, r: number): Animal[] {
  const out: Animal[] = [];
  const r2 = r * r;
  for (let i = 0; i < animals.length; i++) {
    const a = animals[i];
    if (!a.alive || a.state === ST_HIDE) continue;
    if ((a.x - x) * (a.x - x) + (a.y - y) * (a.y - y) <= r2) out.push(a);
  }
  return out;
}

// ---------- drawing ----------
// Sprites are authored as texel grids (1 texel = 0.5 cell = 2.5 cm), outlined automatically, and cached as small canvases.
// Legend: w white coat, s shade, k dark eye / ear tip / beak / tail, n nose, '.' empty.
const HARE_ART = [
  '...............kk.kk',
  '...............ww.ww',
  '...............wwwww',
  '........wwwww.wwwwww',
  '..ww.wwwwwwwwwwwwwkw',
  '.wwwwwwwwwwwwwwwwwwn',
  '.wwwwwwwwwwwwwwwwww.',
  '..wwwwwwwwwwwwwwwww.',
  '....wwwsssssssswww..',
  '.....sssssssssss....',
  '..wwwwww.....ww.....',
  '..wwwwww.....ww.....',
];
const BIRD_ART = [
  '...........ww.',
  '......wwwwwwkw',
  '...wwssssswwww',
  '.kkwssssssswww',
  '.kkwwssssswwww',
  '.kkwwwwwwwwww.',
  '.....wwwwww...',
  '.....ww...ww..',
  '.....ww...ww..',
];
const PAL_DAY = { w: [244, 247, 250], s: [205, 216, 230], k: [30, 35, 44], n: [196, 138, 143], o: [58, 70, 90, 170] };
const PAL_NIGHT = { w: [150, 162, 182], s: [108, 122, 146], k: [16, 20, 28], n: [120, 80, 86], o: [8, 12, 20, 230] };

export interface SpritePixels { w: number; h: number; data: Uint8ClampedArray<ArrayBuffer>; }
/** Pixel data of a sprite (outline included). Pure: usable without a DOM. */
export function buildSpritePixels(kind: number, night: boolean): SpritePixels {
  const art = kind === K_HARE ? HARE_ART : BIRD_ART;
  const h = art.length;
  let w = 0;
  for (const r of art) w = Math.max(w, r.length);
  const pal = night ? PAL_NIGHT : PAL_DAY;
  const data = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h || x >= art[y].length) ? '.' : art[y][x];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ch = at(x, y);
    let c: number[] | null = null;
    if (ch === 'w') c = pal.w;
    else if (ch === 's') c = pal.s;
    else if (ch === 'k') c = pal.k;
    else if (ch === 'n') c = pal.n;
    else if (at(x - 1, y) !== '.' || at(x + 1, y) !== '.' || at(x, y - 1) !== '.' || at(x, y + 1) !== '.') c = pal.o;
    if (!c) continue;
    const o = (y * w + x) * 4;
    data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = c[3] ?? 255;
  }
  return { w, h, data };
}

const spriteCache: (HTMLCanvasElement | null | undefined)[] = [];
function spriteFor(kind: number, night: boolean): HTMLCanvasElement | null {
  const k = kind * 2 + (night ? 1 : 0);
  let c = spriteCache[k];
  if (c === undefined) {
    c = null;
    if (typeof document !== 'undefined') {
      const sp = buildSpritePixels(kind, night);
      const cv = document.createElement('canvas');
      cv.width = sp.w; cv.height = sp.h;
      const g = cv.getContext('2d');
      if (g) { g.putImageData(new ImageData(sp.data, sp.w, sp.h), 0, 0); c = cv; }
    }
    spriteCache[k] = c;
  }
  return c;
}

/**
 * Draws animals and snares. Call inside drawOverlay with the world transform set (as for drawPlayer), before drawPlayer so the hero stands in front.
 * worldToScreen: renderer.worldToScreen (culling only). scale: device pixels per cell (G.cam.zoom * dpr).
 * night: 0 day .. 1 night (the dark palette is used above 0.5).
 */
export function drawFauna(ctx: CanvasRenderingContext2D, worldToScreen: (x: number, y: number) => [number, number], scale: number, night: number) {
  if (!ready) return;
  const nightPal = night > 0.5;
  const sc = scale > 0 ? scale : 1;
  const snap = (v: number) => Math.round(v * sc) / sc;      // whole device pixels
  const vw = G.cam.vw * G.cam.zoom, vh = G.cam.vh * G.cam.zoom;
  ctx.imageSmoothingEnabled = false;
  for (let i = 0; i < animals.length; i++) {
    const a = animals[i];
    if (!a.alive || a.state === ST_HIDE) continue;
    if (Math.abs(a.x - G.cam.x) > G.cam.vw * 0.5 + 12) continue;   // cheap world-space prefilter
    const [sx, sy] = worldToScreen(a.x, a.y);
    if (sx < -60 || sy < -60 || sx > vw + 60 || sy > vh + 60) continue;
    const img = spriteFor(a.kind, nightPal);
    if (!img) continue;
    const hare = a.kind === K_HARE;
    const w = hare ? 10 : 7, h = hare ? 6 : 4.5;               // 0.5 m hare, 0.35 m ptarmigan
    const squash = a.state === ST_FREEZE ? (hare ? 0.72 : 0.8) : 1;   // crouch
    ctx.save();
    ctx.translate(snap(a.x), snap(a.y - a.z));
    ctx.scale(a.face < 0 ? -1 : 1, 1);
    ctx.drawImage(img, -w / 2, -h * squash, w, h * squash);
    ctx.restore();
  }
  ctx.lineWidth = 1.5 / sc; ctx.lineCap = 'round';
  ctx.strokeStyle = nightPal ? 'rgba(6,10,18,0.95)' : 'rgba(34,40,52,0.9)';
  for (let s = 0; s < snares.length; s++) {
    const sn = snares[s];
    const x = snap(sn.x), y = snap(sn.y);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 5); ctx.stroke();      // stake, 25 cm
    ctx.beginPath(); ctx.ellipse(x, y, 3, 1, 0, 0, Math.PI * 2); ctx.stroke();  // loop on the snow
    if (sn.state === 1) {                                                        // the hare hanging in it
      const img = spriteFor(K_HARE, nightPal);
      if (img) {
        ctx.save(); ctx.translate(x + 1, y); ctx.scale(sn.x % 2 ? 1 : -1, 1);
        ctx.drawImage(img, -5, -2.7, 10, 2.7);
        ctx.restore();
      }
    }
  }
}
