// Live hunting (DESIGN §14 «Live hunting»). Cod swim under the ice near every open hole or lead. A line cast into the water draws the nearest
// fish to the bait, it circles and bites: we set toolState.fish ourselves (the fake timer in tools.ts is off, setFishingFallback(false)).
// Ptarmigan flocks feed on the lichen of the tundra, flush when the player comes close, and fall to a harpoon or a snare; the husky brings them
// back (fauna.ts). Tracks in the snow (fox, ptarmigan, bear, seal drag) fade over game hours, faster in a storm.
// Stocks (fish per hole, birds per lichen patch) are kept while the player is far and regrow with the game clock; the animals themselves
// exist only near the player (sleep far away). Kept in G.animals as kind 'fish' (state 'hidden': drawn by our own layer) and 'ptarmigan'.
// Emits: 'fish_bite' {x,y}, 'bird_flush' {x,y}, 'bird_caught' {how:'harpoon'|'snare', x, y}. Listens: 'fishing' {x,y}, 'fish_caught' {n}, 'animal_hit'.
import { G, newId, toast, type Animal, type Drop, type View } from './state';
import { on, emit } from './bus';
import { strings } from '../content/i18n';
import { W, H, TS, mat } from '../engine/grid';
import { MAT, WALK } from '../content/materials';
import { spawnDrop } from './inventory';
import { toolState, setFishingFallback } from './tools';
import { setSnareFallback } from './fixtures';
import { MIN_PER_SEC } from './weather';
import { burstFx } from '../engine/particles';
import { addLayer } from '../engine/render';
import { animalFrame, frameCount } from '../art/animals';
import { silhouette } from '../engine/sprites';

const S = strings('hunt', {
  fishBite: 'Клюёт! Тяни!',
  fishEmpty: 'Здесь пусто — попробуй другую лунку/полынью',
  birdGot: 'Добыча: куропатка',
  snareBird: 'В силке куропатка',
  dogBird: 'Север принёс куропатку',
});

export type TrackKind = 'fox' | 'ptarmigan' | 'bear' | 'seal';
export interface Hole { id: number; x: number; y: number; max: number; stock: number; regen: number; ents: number[] }
export interface Site { id: number; x: number; y: number; max: number; stock: number; regen: number; ents: number[]; flushCd: number }
export interface Track { kind: TrackKind; x: number; y: number; dir: 1 | -1; age: number }
interface FishAI { hole: Hole; ph: 'school' | 'gather' | 'approach' | 'circle' | 'bite' | 'away'; t: number; tx: number; ty: number; ang: number; spd: number; face: 1 | -1; vis: boolean; visT: number; biter: boolean }
interface BirdAI { site: Site; mode: 'peck' | 'walk' | 'fly'; t: number; t0: number; tx: number; dir: 1 | -1; fly0: number; snT: number }
interface Cast { x: number; y: number; t: number; approach: boolean; hinted: boolean; biter: number; rescanT: number }
/** Persisted with the save (see huntSave / huntLoad): [x, y, max, stock, regen] per hole and site, [kind, x, y, dir, age] per track. */
export interface HuntSave { holes: number[][]; sites: number[][]; tracks: (string | number)[][]; caught: number; birds: number }

const ACT_R = 150, ACT_BIRD = 140;           // cells: creatures exist within this distance of the player
const FISH_CAP = 36, BIRD_CAP = 24, HOLE_CAP = 40, SITE_CAP = 14, TRACK_CAP = 360;
const CAST_R = 60;                           // a cast draws fish within this distance
const TRACK_LIFE = 360, TRACK_FADE = 120;    // game minutes (6 h), last 2 h fade
const FISH_REGROW = 20, BIRD_REGROW = 15;    // game minutes per +1 stock

const holes: Hole[] = [], sites: Site[] = [];
const fishAI = new Map<number, FishAI>(), birdAI = new Map<number, BirdAI>();
const tracks: Track[] = [];
const lastTrack = new Map<number, { x: number; y: number }>();
const huntDrops = new Set<number>();
let cast: Cast | null = null;
let scanT = 0, actT = 0, fishCaught = 0, birdsTaken = 0, pending: HuntSave | null = null, layersOn = false;
let scanOn = true;

// ---------------------------------------------------------------------------------------------------------------------------------- helpers
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const dist = (x: number, y: number, x2: number, y2: number) => Math.hypot(x - x2, y - y2);
const inBounds = (x: number, y: number) => x >= 1 && x < W - 1 && y >= 1 && y < H - 1;
const inWater = (x: number, y: number) => inBounds(x, y) && mat[y * W + x] === MAT.WATER;
/** The first walkable row at or below `from` in column x: the snow or ground an animal stands on (as fauna.groundY). */
export function floorAt(x: number, from: number): number {
  const xi = clamp(Math.round(x), 1, W - 2);
  for (let y = Math.max(1, Math.floor(from)); y < H - 2; y++) if (WALK[mat[y * W + xi]]) return y;
  return 300;
}
/** Ice thickness (cells) over the water column at (x, y): climb through the water to the surface, then count the ice. 0 = open water. */
function iceAbove(x: number, y: number): number {
  const xi = clamp(Math.round(x), 1, W - 2);
  let yy = Math.floor(y) - 1;
  while (yy >= 1 && mat[yy * W + xi] === MAT.WATER) yy--;
  let n = 0;
  while (yy >= 1 && n < 40 && mat[yy * W + xi] === MAT.ICE) { n++; yy--; }
  return n;
}
const surfaceHole = (x: number, y: number) => inBounds(x, y) && mat[y * W + x] === MAT.WATER && mat[(y - 1) * W + x] === MAT.AIR;

// ---------------------------------------------------------------------------------------------------------------------------------- holes and lichen sites
function addHole(x: number, y: number) {
  if (holes.length >= HOLE_CAP) return;
  for (const h of holes) if (Math.abs(h.x - x) < 24 && Math.abs(h.y - y) < 10) return;     // one hole per 24 cells of open water
  const max = 3 + Math.floor(Math.random() * 4);
  holes.push({ id: newId(), x, y, max, stock: max, regen: 0, ents: [] });
}
function closeHole(h: Hole) {
  for (const id of h.ents.slice()) removeFish(id);
  holes.splice(holes.indexOf(h), 1);
}
function addSite(x: number, y: number) {
  if (sites.length >= SITE_CAP) return;
  for (const s of sites) if (Math.abs(s.x - x) < 30 && Math.abs(s.y - y) < 6) return;
  const max = 3 + Math.floor(Math.random() * 4);
  sites.push({ id: newId(), x, y, max, stock: max, regen: 0, ents: [], flushCd: 0 });
}
function closeSite(s: Site) {
  for (const id of s.ents.slice()) removeBird(id);
  sites.splice(sites.indexOf(s), 1);
}
/** Find open water (holes, leads) and lichen patches in the window round the player. Holes that froze over are closed. */
function scanWorld(cx: number) {
  const win = G.win;
  const x0 = Math.max(2, Math.floor(cx - ACT_R - 60)), x1 = Math.min(W - 3, Math.ceil(cx + ACT_R + 60));
  const y0 = Math.max(2, win.y0), y1 = Math.min(H - 3, win.y1);
  for (const h of holes.slice()) if (h.x >= x0 && h.x <= x1 && !surfaceHole(h.x, h.y)) closeHole(h);
  for (const s of sites.slice()) if (s.x >= x0 && s.x <= x1 && mat[s.y * W + s.x] !== MAT.LICHEN) closeSite(s);
  for (let x = x0; x <= x1; x++) {
    let gotW = false, gotL = false;
    for (let y = y0; y <= y1 && !(gotW && gotL); y++) {
      const i = y * W + x;
      if (!gotW && mat[i] === MAT.WATER && mat[i - W] === MAT.AIR) { gotW = true; addHole(x, y); }
      else if (!gotL && mat[i] === MAT.LICHEN && mat[i - W] === MAT.AIR) { gotL = true; addSite(x, y); }
    }
  }
}
function regrow(gm: number) {
  for (const h of holes) {
    if (h.stock >= h.max) { h.regen = 0; continue; }
    h.regen += gm; while (h.regen >= FISH_REGROW && h.stock < h.max) { h.regen -= FISH_REGROW; h.stock++; }
    if (h.stock >= h.max) h.regen = 0;
  }
  for (const s of sites) {
    if (s.stock >= s.max) { s.regen = 0; continue; }
    s.regen += gm; while (s.regen >= BIRD_REGROW && s.stock < s.max) { s.regen -= BIRD_REGROW; s.stock++; }
    if (s.stock >= s.max) s.regen = 0;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------- fish
function removeFish(id: number) {
  const a = fishAI.get(id);
  if (a) { const k = a.hole.ents.indexOf(id); if (k >= 0) a.hole.ents.splice(k, 1); }
  fishAI.delete(id);
  const i = G.animals.findIndex(e => e.id === id); if (i >= 0) G.animals.splice(i, 1);
}
function pickTarget(e: Animal, a: FishAI) {
  for (let k = 0; k < 8; k++) {
    const tx = Math.round(a.hole.x + (Math.random() * 2 - 1) * 14), ty = Math.round(a.hole.y + 3 + Math.random() * 9);
    if (inWater(tx, ty)) { a.tx = tx + 0.5; a.ty = ty + 0.5; break; }
  }
  a.t = 2.5 + Math.random() * 3;
  void e;
}
function spawnFish(h: Hole): boolean {
  for (let k = 0; k < 24; k++) {
    const x = Math.round(h.x + (Math.random() * 2 - 1) * 14), y = Math.round(h.y + 3 + Math.random() * 9);
    if (!inWater(x, y)) continue;
    const e: Animal = { id: newId(), kind: 'fish', x: x + 0.5, y: y + 0.5, vx: 0, vy: 0, w: 12, h: 4, face: 1, hp: 1, state: 'hidden', t: 0, onGround: false };
    G.animals.push(e);
    const a: FishAI = { hole: h, ph: 'school', t: 0, tx: e.x, ty: e.y, ang: 0, spd: 0, face: 1, vis: false, visT: 0, biter: false };
    fishAI.set(e.id, a); h.ents.push(e.id);
    pickTarget(e, a);
    return true;
  }
  return false;
}
/** Swim toward (tx, ty) at sp cells/s. wet: stay in water (stop at the first non-water cell). True when arrived or stopped. */
function swimTo(e: Animal, tx: number, ty: number, sp: number, dt: number, wet: boolean): boolean {
  const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy);
  if (d < 0.5) { e.vx = e.vy = 0; return true; }
  const step = Math.min(d, sp * dt), nx = e.x + (dx / d) * step, ny = e.y + (dy / d) * step;
  if (wet && !inWater(Math.round(nx), Math.round(ny))) { e.vx = e.vy = 0; return true; }
  e.vx = (dx / d) * sp; e.vy = (dy / d) * sp;
  if (Math.abs(dx) > 0.2) e.face = dx > 0 ? 1 : -1;
  e.x = nx; e.y = ny;
  return d - step < 0.5;
}
const ring = (c: Cast, r: number, ang: number): [number, number] => [c.x + Math.cos(ang) * r, c.y + Math.sin(ang) * r];

function stepFish(dt: number) {
  for (const e of G.animals) {
    if (e.kind !== 'fish') continue;
    const a = fishAI.get(e.id); if (!a) continue;
    a.visT -= dt; if (a.visT <= 0) { a.visT = 0.5; a.vis = iceAbove(e.x, e.y) <= 4; }
    const c = cast, f = toolState.fish;
    switch (a.ph) {
      case 'school':
        a.t -= dt;
        if (a.t <= 0 || swimTo(e, a.tx, a.ty, 2.2, dt, true)) pickTarget(e, a);
        break;
      case 'approach': {                       // the nearest fish comes to the bait in a few seconds
        if (!c) { a.ph = 'away'; break; }
        const [tx, ty] = ring(c, 3.5, a.ang);
        if (swimTo(e, tx, ty, a.spd, dt, false)) { a.ph = 'circle'; a.t = 1.6; a.biter = true; }
        break;
      }
      case 'circle': {
        if (!c) { a.ph = 'away'; break; }
        a.ang += dt * 2.4;
        const [tx, ty] = ring(c, 3.5, a.ang);
        swimTo(e, tx, ty, 14, dt, false);
        a.t -= dt;
        if (a.t <= 0 && a.biter && f.state === 'wait') bite(e, a, c);
        else if (a.t <= 0 && !a.biter) a.t = 0.5;
        break;
      }
      case 'gather': {                         // the others close in loosely; they do not bite
        if (!c) { a.ph = 'away'; break; }
        a.ang += dt * 0.5;
        const [tx, ty] = ring(c, 9, a.ang);
        swimTo(e, tx, ty, 6, dt, false);
        break;
      }
      case 'bite': {                           // hooked: holds at the bait until the tug is over
        if (!c || f.state !== 'bite') { a.ph = 'away'; a.biter = false; break; }
        e.vx = e.vy = 0; e.x = c.x + Math.sin(G.realTime * 18) * 0.4; e.y = c.y;
        break;
      }
      case 'away': {                           // back to the hole
        if (swimTo(e, a.hole.x, a.hole.y + 6, 8, dt, false)) { a.ph = 'school'; a.t = 0; pickTarget(e, a); }
        break;
      }
    }
  }
}
function bite(e: Animal, a: FishAI, c: Cast) {
  const f = toolState.fish;
  f.state = 'bite'; f.bite = 1.3; f.x = c.x; f.y = c.y;
  c.biter = e.id; a.ph = 'bite';
  toast(S.fishBite, 'good');
  emit('fish_bite', { x: c.x, y: c.y });
}
/** The nearest fish swims to the bait, the others gather round it. */
function gatherFish(x: number, y: number) {
  const near: { e: Animal; d: number }[] = [];
  for (const e of G.animals) if (e.kind === 'fish' && fishAI.has(e.id)) { const d = dist(e.x, e.y, x, y); if (d < CAST_R) near.push({ e, d }); }
  near.sort((p, q) => p.d - q.d);
  near.forEach(({ e, d }, k) => {
    const a = fishAI.get(e.id)!;
    if (a.ph === 'bite' || a.ph === 'circle' || a.ph === 'approach') return;
    const ang = Math.atan2(e.y - y, e.x - x);
    if (k === 0 && cast && !cast.approach) { cast.approach = true; a.ph = 'approach'; a.ang = ang; a.spd = clamp(d / 3.5, 10, 22); }
    else { a.ph = 'gather'; a.ang = ang; a.spd = 6; }
  });
}
function startCast(x: number, y: number) {
  endCast();
  cast = { x, y, t: 0, approach: false, hinted: false, biter: -1, rescanT: 0 };
  gatherFish(x, y);
}
function endCast() {
  if (!cast) return;
  for (const e of G.animals) {
    if (e.kind !== 'fish') continue;
    const a = fishAI.get(e.id); if (a && a.ph !== 'school') { a.ph = 'away'; a.biter = false; }
  }
  cast = null;
}
/** tools.ts reports the catch: the biting fish (and extra ones on the same tug) leave the hole for good. */
function caughtFish(n: number) {
  let hole: Hole | null = null;
  const ba = cast ? fishAI.get(cast.biter) : undefined;
  if (ba && cast) { hole = ba.hole; removeFish(cast.biter); hole.stock = Math.max(0, hole.stock - 1); n--; }
  while (hole && n > 0 && hole.ents.length) { const id = hole.ents[hole.ents.length - 1]; removeFish(id); hole.stock = Math.max(0, hole.stock - 1); n--; }
  fishCaught++;
  if (cast) cast.biter = -1;
}

// ---------------------------------------------------------------------------------------------------------------------------------- birds
function removeBird(id: number) {
  const a = birdAI.get(id);
  if (a) { const k = a.site.ents.indexOf(id); if (k >= 0) a.site.ents.splice(k, 1); }
  birdAI.delete(id);
  const i = G.animals.findIndex(e => e.id === id); if (i >= 0) G.animals.splice(i, 1);
}
function spawnBird(s: Site): boolean {
  const x = Math.round(s.x + (Math.random() * 2 - 1) * 6);
  const y = floorAt(x, s.y - 6) - 1;
  if (y < 3 || !WALK[mat[(y + 1) * W + x]]) return false;
  const e: Animal = { id: newId(), kind: 'ptarmigan', x: x + 0.5, y, vx: 0, vy: 0, w: 6, h: 5, face: 1, hp: 4, state: 'idle', t: 0, onGround: true };
  G.animals.push(e);
  birdAI.set(e.id, { site: s, mode: 'peck', t: 1 + Math.random() * 3, t0: 0, tx: x, dir: 1, fly0: y, snT: 0 });
  s.ents.push(e.id);
  return true;
}
/** Birds leave the lichen: the whole flock lifts and flies low away from the player, lands and walks home. */
function flush(s: Site, p: { x: number }) {
  s.flushCd = 25;
  for (const id of s.ents) {
    const a = birdAI.get(id), e = G.animals.find(x => x.id === id);
    if (!a || !e) continue;
    a.mode = 'fly'; a.t0 = a.t = 2.4 + Math.random() * 1.2; a.dir = e.x >= p.x ? 1 : -1; a.fly0 = e.y;
    e.face = a.dir; e.state = 'fly'; e.vx = a.dir * (20 + Math.random() * 8);
  }
  emit('bird_flush', { x: s.x, y: s.y });
}
function snareNear(x: number, y: number): Record<string, unknown> | null {
  for (const f of G.fixtures) {
    if (f.kind !== 'snare') continue;
    const dd = f.data as Record<string, unknown> | undefined;
    if (!dd || !dd.set || dd.catch) continue;
    if (Math.hypot(f.tx * TS + 2 - x, f.ty * TS + 2 - y) < 5) return dd;
  }
  return null;
}
/** A bird gone for good: shot (harpoon: it drops, the husky can fetch it) or caught in a snare (the snare keeps it). */
function birdGone(e: Animal, how: 'harpoon' | 'snare') {
  const a = birdAI.get(e.id);
  if (a) a.site.stock = Math.max(0, a.site.stock - 1);
  removeBird(e.id);
  birdsTaken++;
  if (how === 'harpoon') {
    const d = spawnDrop('ptarmigan', 1, e.x, e.y - 2, 0, -16, undefined, true);
    if (d) huntDrops.add(d.id);
    toast(S.birdGot, 'good');
  } else if (G.player && dist(e.x, e.y, G.player.x, G.player.y) < 60) toast(S.snareBird, 'good');
  burstFx('dust', e.x, e.y - 2, 6, 14, 0.5, 0xeef4fa);
  emit('bird_caught', { how, x: e.x, y: e.y });
}
function stepBirds(dt: number, p: { x: number; y: number; vx: number; alive: boolean }) {
  for (const s of sites.slice()) {
    s.flushCd = Math.max(0, s.flushCd - dt);
    if (!p.alive || s.flushCd > 0 || !s.ents.length) continue;
    const d = dist(s.x, s.y, p.x, p.y), spd = Math.abs(p.vx);
    if ((spd > 30 && d < 40) || (spd > 4 && d < 25) || d < 6) flush(s, p);
  }
  for (const e of G.animals.slice()) {
    if (e.kind !== 'ptarmigan') continue;
    const a = birdAI.get(e.id); if (!a) continue;
    if (a.mode === 'fly') {
      a.t -= dt;
      const ph = 1 - Math.max(0, a.t) / a.t0;
      e.x += e.vx * dt; e.y = a.fly0 - Math.sin(Math.PI * ph) * 9;
      e.state = 'fly';
      if (a.t <= 0) { a.mode = 'walk'; e.vx = 0; a.tx = clamp(a.site.x + (Math.random() * 2 - 1) * 16, 2, W - 3); e.y = floorAt(e.x, e.y - 10) - 1; e.state = 'walk'; }
      continue;
    }
    a.snT -= dt;
    if (a.snT <= 0) {
      a.snT = 0.25;
      const sn = snareNear(e.x, e.y);
      if (sn && Math.random() < 0.35) { sn.catch = 'ptarmigan'; emit('snare_caught', { item: 'ptarmigan', x: e.x, y: e.y }); birdGone(e, 'snare'); continue; }
    }
    if (a.mode === 'peck') {
      e.vx = 0; e.state = 'sniff';
      a.t -= dt;
      if (a.t <= 0) { a.mode = 'walk'; a.tx = clamp(a.site.x + (Math.random() * 2 - 1) * 9, 2, W - 3); a.dir = a.tx >= e.x ? 1 : -1; }
    } else {
      const dx = a.tx - e.x;
      if (Math.abs(dx) < 0.8) { a.mode = 'peck'; a.t = 2 + Math.random() * 3; e.vx = 0; e.state = 'sniff'; continue; }
      a.dir = dx > 0 ? 1 : -1; e.face = a.dir;
      e.vx = a.dir * 4; e.x += e.vx * dt;
      const y = floorAt(e.x, e.y - 6) - 1;
      if (mat[(y + 1) * W + Math.round(e.x)] === MAT.WATER || mat[(y + 1) * W + Math.round(e.x)] === MAT.ICE) { a.mode = 'peck'; a.t = 1; e.vx = 0; e.state = 'sniff'; continue; }
      e.y = y; e.state = 'walk';
      trackStep(e.id, 'ptarmigan', e.x, e.y, a.dir, 5);
    }
  }
}
on('animal_hit', (d: { id: number }) => {
  const e = G.animals.find(x => x.id === d.id);
  if (e && e.kind === 'ptarmigan' && e.hp <= 0) birdGone(e, 'harpoon');
});

// ---------------------------------------------------------------------------------------------------------------------------------- creatures near the player
function syncCreatures(p: { x: number; y: number }) {
  for (const h of holes) if (dist(h.x, h.y, p.x, p.y) >= ACT_R && h.ents.length) for (const id of h.ents.slice()) removeFish(id);
  let n = fishAI.size;
  for (const h of holes.filter(q => dist(q.x, q.y, p.x, p.y) < ACT_R).sort((q, r) => dist(q.x, q.y, p.x, p.y) - dist(r.x, r.y, p.x, p.y))) {
    while (h.ents.length > h.stock) removeFish(h.ents[h.ents.length - 1]);
    while (h.ents.length < h.stock && n < FISH_CAP) { if (!spawnFish(h)) break; n++; }
  }
  for (const s of sites) if (dist(s.x, s.y, p.x, p.y) >= ACT_BIRD && s.ents.length) for (const id of s.ents.slice()) removeBird(id);
  let b = birdAI.size;
  for (const s of sites.filter(q => dist(q.x, q.y, p.x, p.y) < ACT_BIRD)) {
    while (s.ents.length > s.stock) removeBird(s.ents[s.ents.length - 1]);
    while (s.ents.length < s.stock && b < BIRD_CAP) { if (!spawnBird(s)) break; b++; }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------- tracks
function addTrack(kind: TrackKind, x: number, y: number, dir: 1 | -1, age = 0) {
  if (tracks.length >= TRACK_CAP) tracks.shift();
  tracks.push({ kind, x, y, dir, age });
}
/** Leave a print of a walking creature (id = its entity id) once it has moved `every` cells since its last print. True when a print was made. */
export function trackStep(id: number, kind: TrackKind, x: number, y: number, dir: 1 | -1, every: number): boolean {
  const L = lastTrack.get(id);
  if (L && dist(L.x, L.y, x, y) < every) return false;
  lastTrack.set(id, { x, y });
  addTrack(kind, x, y, dir);
  return true;
}
/** A seal hauled out of its hole: a drag trough from the hole towards dir. */
export function dragMarks(x: number, y: number, dir: 1 | -1) {
  for (let k = 0; k < 6; k++) { const xx = Math.round(x + dir * (3 + k * 2.5)); addTrack('seal', xx, floorAt(xx, y - 4) - 1, dir); }
}
function ageTracks(gm: number) {
  for (const t of tracks) t.age += gm * (1 + 3 * G.storm);
  let k = 0;
  for (const t of tracks) if (t.age <= TRACK_LIFE) tracks[k++] = t;
  tracks.length = k;
}
const TRACK_RGB = '20,34,60';
function drawTracks(ctx: CanvasRenderingContext2D, v: View) {
  if (!tracks.length) return;
  ctx.save();
  for (const t of tracks) {
    const x = Math.round(t.x - v.x0), y = Math.round(t.y - v.y0) + 1;
    if (x < -8 || x > v.w + 8 || y < -8 || y > v.h + 8) continue;
    const fade = t.age > TRACK_LIFE - TRACK_FADE ? Math.max(0, (TRACK_LIFE - t.age) / TRACK_FADE) : 1;
    const base = (t.kind === 'bear' ? 0.6 : t.kind === 'seal' ? 0.32 : 0.42) * fade;
    ctx.fillStyle = `rgba(${TRACK_RGB},${base})`;
    if (t.kind === 'fox') { ctx.fillRect(x, y, 1, 1); }
    else if (t.kind === 'ptarmigan') { ctx.fillRect(x - 1, y, 1, 1); ctx.fillRect(x + 1, y, 1, 1); ctx.fillRect(x, y + 1, 1, 1); }
    else if (t.kind === 'bear') { ctx.fillRect(x - 2, y - 1, 4, 2); ctx.fillRect(x - 2, y - 3, 1, 1); ctx.fillRect(x, y - 3, 1, 1); ctx.fillRect(x + 2, y - 3, 1, 1); }
    else { ctx.fillStyle = `rgba(${TRACK_RGB},${base})`; ctx.fillRect(x - 2, y, 5, 1); ctx.fillStyle = `rgba(236,246,255,${base * 0.8})`; ctx.fillRect(x - 2, y + 1, 5, 1); }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------------------------------------------- fish drawing
const silCache = new Map<string, HTMLCanvasElement>();
/** Cod are drawn by us: as dark shapes under the ice, clear when the ice is thin or the hole is open, faint while baited. */
function drawFish(ctx: CanvasRenderingContext2D, v: View) {
  const n = frameCount('fish', 'idle');
  for (const e of G.animals) {
    if (e.kind !== 'fish') continue;
    const a = fishAI.get(e.id); if (!a) continue;
    if (e.x < v.x0 - 10 || e.x > v.x0 + v.w + 10 || e.y < v.y0 - 10 || e.y > v.y0 + v.h + 10) continue;
    const baited = a.ph === 'approach' || a.ph === 'circle' || a.ph === 'bite' || a.ph === 'gather';
    if (!a.vis && !baited) continue;
    const f = (Math.floor(v.t * 4) + e.id) % n;
    const fr = animalFrame('fish', 'idle', f); if (!fr) continue;
    const key = 'fish|' + f;
    let sil = silCache.get(key);
    if (!sil) { sil = silhouette(fr.c, '#0a1626'); silCache.set(key, sil); }
    ctx.save();
    ctx.globalAlpha = a.vis ? 0.72 : 0.2;
    ctx.translate(Math.round(e.x - v.x0), Math.round(e.y - v.y0) - 2); ctx.scale(a.face, 1);
    ctx.drawImage(sil, -fr.ax, -fr.c.height);
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------- public API
function registerLayers() {
  if (layersOn) return;
  layersOn = true;
  addLayer(-13, drawTracks);      // prints lie on the snow, under the fixtures and the animals
  addLayer(-9.6, drawFish);       // under the ice, under the animal sprites
}
/** Fresh creatures and stocks for a new world (or a loaded one, if huntLoad() was called). Called from fauna.initFauna. */
export function initHunt() {
  registerLayers();
  setFishingFallback(false);
  setSnareFallback(false);
  for (let i = G.animals.length - 1; i >= 0; i--) if (G.animals[i].kind === 'fish' || G.animals[i].kind === 'ptarmigan') G.animals.splice(i, 1);
  holes.length = 0; sites.length = 0; fishAI.clear(); birdAI.clear(); lastTrack.clear(); huntDrops.clear(); tracks.length = 0;
  cast = null; toolState.fish.state = 'idle'; toolState.fish.bite = 0;
  fishCaught = 0; birdsTaken = 0; scanT = 0; actT = 0;
  if (pending) {
    const d = pending;
    for (const [x, y, max, stock, regen] of d.holes) holes.push({ id: newId(), x, y, max, stock, regen, ents: [] });
    for (const [x, y, max, stock, regen] of d.sites) sites.push({ id: newId(), x, y, max, stock, regen, ents: [], flushCd: 0 });
    for (const [kind, x, y, dir, age] of d.tracks) addTrack(kind as TrackKind, x as number, y as number, dir as 1 | -1, age as number);
    fishCaught = d.caught ?? 0; birdsTaken = d.birds ?? 0;
  }
  pending = null;
}
/** Advance the hunt: scan the world every 2 s, create and remove creatures every 0.5 s, regrow stocks, move fish and birds. */
export function stepHunt(dt: number) {
  const p = G.player; if (!p) return;
  const gm = dt * MIN_PER_SEC * G.timeScale;
  scanT -= dt; if (scanT <= 0) { scanT = 2; if (scanOn) scanWorld(p.x); }
  actT -= dt; if (actT <= 0) { actT = 0.5; syncCreatures(p); }
  regrow(gm);
  stepFish(dt);
  stepCast(dt);
  stepBirds(dt, { x: p.x, y: p.y, vx: p.vx, alive: p.alive });
  ageTracks(gm);
}
function stepCast(dt: number) {
  const c = cast, f = toolState.fish;
  if (!c) return;
  if (f.state === 'idle') { endCast(); return; }
  c.t += dt;
  if (f.state === 'wait' && !c.approach) {
    c.rescanT -= dt;
    if (c.rescanT <= 0) { c.rescanT = 1; gatherFish(c.x, c.y); }
    if (!c.hinted && c.t >= 25) { c.hinted = true; toast(S.fishEmpty, 'info'); }
  }
}
/** Stock of the nearest hole with fish left within r cells (the husky points at it). */
export function pointHole(x: number, y: number, r: number): Hole | null {
  let best: Hole | null = null, bd = r;
  for (const h of holes) { if (h.stock <= 0) continue; const d = dist(h.x, h.y, x, y); if (d < bd) { bd = d; best = h; } }
  return best;
}
/** The nearest bird the husky may fetch (a shot one lying on the snow). */
export function huntDropNear(x: number, y: number, r: number): Drop | null {
  let best: Drop | null = null, bd = r;
  for (const d of G.drops) { if (!huntDrops.has(d.id)) continue; const k = dist(d.x, d.y, x, y); if (k < bd) { bd = k; best = d; } }
  return best;
}
/** Take a hunted drop out of the world (the husky picks it up). */
export function takeHuntDrop(id: number): boolean {
  const i = G.drops.findIndex(d => d.id === id);
  huntDrops.delete(id);
  if (i < 0) return false;
  G.drops.splice(i, 1); return true;
}
export function setScanning(on: boolean) { scanOn = on; }
/** Tests and the dev API: a hole / lichen site made by hand (the world scan does the same). */
export function addHoleAt(x: number, y: number, max: number) { holes.push({ id: newId(), x, y, max, stock: max, regen: 0, ents: [] }); }
export function addSiteAt(x: number, y: number, max: number) { sites.push({ id: newId(), x, y, max, stock: max, regen: 0, ents: [], flushCd: 0 }); }
export function getHoles(): readonly Hole[] { return holes; }
export function getSites(): readonly Site[] { return sites; }
export function huntVisible(): number { let n = 0; for (const a of fishAI.values()) if (a.vis) n++; return n; }
export const iceAboveAt = (x: number, y: number) => iceAbove(x, y);
export function huntSave(): HuntSave {
  return {
    holes: holes.map(h => [h.x, h.y, h.max, h.stock, Math.round(h.regen)]),
    sites: sites.map(s => [s.x, s.y, s.max, s.stock, Math.round(s.regen)]),
    tracks: tracks.map(t => [t.kind, Math.round(t.x), Math.round(t.y), t.dir, Math.round(t.age)]),
    caught: fishCaught, birds: birdsTaken,
  };
}
/** Stash a saved hunt; initHunt (called from initFauna after applySave) restores it. */
export function huntLoad(d: HuntSave | null | undefined) { pending = d ?? null; }
export function huntInfo() {
  return {
    holes: holes.length, stock: holes.reduce((s, h) => s + h.stock, 0), fish: fishAI.size, sites: sites.length,
    birds: birdAI.size, birdStock: sites.reduce((s, q) => s + q.stock, 0), tracks: tracks.length, caught: fishCaught, birdsTaken,
    cast: cast ? { x: cast.x, y: cast.y, approach: cast.approach, t: +cast.t.toFixed(1) } : null,
  };
}
on('fishing', (d: { x: number; y: number }) => startCast(d.x, d.y));
on('fish_caught', (d: { n?: number }) => caughtFish(Math.max(1, d?.n ?? 1)));
