// Fauna (DESIGN §6): the husky «Север», ringed seals at breathing holes, an arctic fox that robs food, and ONE polar bear that follows the
// wind. The bear is driven by a coarse 1-D scent field along the coast/ice (deposited by the player, food, fat and a lit lamp; advected by
// G.wind; decays), plus sight and sound. Stages: wander -> curious -> stalk -> charge (or siege of a snow shelter -> flee).
// Animals live in G.animals (state = an art state of art/animals.ts, or 'hidden' for a diving seal); the AI sub-state is in `ai`.
// Emits: 'dog_bark' {x,y,dir}, 'bear_roar' / 'bear_growl' {x,y}, 'bear_seen', 'bear_killed', 'seal_surface' / 'seal_dive' {x,y}, 'seal_caught',
// 'animal_hit', 'fox_steal' {item}, 'dog_fed', 'dog_died', 'scent_hint' {dir}, 'dog_fetch' {x,y}, 'dog_point' {x,y}.
// Live hunting (fish under the ice, ptarmigan flocks, tracks in the snow) lives in hunt.ts; stepFauna and initFauna drive it.
import { G, newId, toast, type Animal, type Player } from './state';
import { emit, on } from './bus';
import { strings, fmt } from '../content/i18n';
import { W, H, TS, mat, flags, setCell, edited, wake, F_PLACED } from '../engine/grid';
import { MAT, WALK } from '../content/materials';
import { moveBox, boxFree } from '../engine/phys';
import { worldInfo } from './worldgen';
import { inv, count, remove, spawnDrop } from './inventory';
import { getItem } from './items';
import { damage, wake as wakePlayer } from './player';
import { toolState } from './tools';
import { held } from './inventory';
import { MIN_PER_SEC } from './weather';
import { burstFx } from '../engine/particles';
import { addShake } from '../engine/camera';
import { stepHunt, initHunt, trackStep, dragMarks, pointHole, huntDropNear, takeHuntDrop } from './hunt';

const S = strings('fauna', {
  dogBird: 'Север принёс куропатку',
  dogBark: 'Север лает: что-то на {dir}',
  dirEast: 'востоке', dirWest: 'западе',
  dogWake: 'Север лает и рвётся с места!',
  dogHungry: 'Север скулит: он голоден',
  dogFed: 'Север ест и виляет хвостом',
  dogStay: 'Север: ждать здесь', dogFollow: 'Север: за мной',
  dogDied: 'Север не пережил зиму…',
  dogNoFood: 'Север голоден: дай ему рыбу, мясо, консервы или сухари (E рядом с ним)',
  bearSeen: 'Белый медведь!',
  bearSniff: 'Ветер несёт твой запах. Что-то идёт по следу…',
  bearRoar: 'Рёв вдали',
  bearHit: 'Медведь ударил!',
  bearGone: 'Медведь отступил',
  bearDead: 'Медведь убит. Шкура и жир — твои',
  sealCaught: 'Добыча: тюлень',
  foxSteal: 'Песец утащил: {name}',
  sealScared: 'Тюлень ушёл под лёд',
});

type AI = { mode: string; t: number; tx: number; cd: number; hold: number; carry?: string; home?: number; hole?: number; stay?: boolean; hunger?: number; barkT?: number; seen?: boolean; hits?: number; futile?: number; sniffed?: boolean; stuck?: number; pause?: boolean; fetch?: { id: number; ph: 'go' | 'back'; t: number }; pointed?: boolean; hintT?: number };
const ai = new Map<number, AI>();
const SZ: Record<string, [number, number]> = { dog: [10, 9], bear: [26, 15], seal: [16, 8], fox: [10, 7] };
// the ring ramp (seasons.ts, DESIGN §18): the bear gets faster and bolder every ring. Read through a glob so the build does not need the file.
const seasonMods = import.meta.glob('./seasons.ts', { eager: true }) as Record<string, { ramp?: { bear?: number } }>;
const bearRamp = () => Math.max(0.5, Math.min(1.5, Object.values(seasonMods)[0]?.ramp?.bear ?? 1));

export const fauna = { dog: null as Animal | null, bear: null as Animal | null, sealCd: new Map<number, number>(), bearActiveDay: 2, bearSmell: 0, bearMode: '', sealsCaught: 0 };

// ---------------------------------------------------------------------------------------------------------------------
// helpers
const player = () => G.player;
export function groundY(x: number, from = 150): number {
  const xi = Math.max(1, Math.min(W - 2, x | 0));
  for (let y = from; y < H - 2; y++) if (WALK[mat[y * W + xi]]) return y;
  return 300;
}
function mk(kind: Animal['kind'], x: number, y: number, hp: number): Animal {
  const [w, h] = SZ[kind] ?? [10, 8];
  const a: Animal = { id: newId(), kind, x, y, vx: 0, vy: 0, w, h, face: 1, hp, state: 'idle', t: 0, onGround: false };
  G.animals.push(a); return a;
}
function setState(a: Animal, st: string) { if (a.state !== st) { a.state = st; a.t = 0; } }
function walkTo(a: Animal, tx: number, speed: number, dt: number, opts: { swim?: boolean; jump?: number } = {}) {
  const dx = tx - a.x, dir = dx > 0 ? 1 : -1;
  const sp = a.kind === 'bear' ? speed * bearRamp() : speed;
  const want = Math.abs(dx) < 2 ? 0 : dir * sp;
  a.vx += Math.max(-300 * dt, Math.min(300 * dt, want - a.vx));
  if (want !== 0) a.face = dir as 1 | -1;
  a.vy = Math.min(280, a.vy + 360 * dt);
  const r = moveBox(a as never, dt, { stepUp: 4, swim: opts.swim });
  if (r.hitWall && a.onGround && want !== 0) a.vy = -(opts.jump ?? 80);
}
const dist = (a: Animal, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const dirName = (dx: number) => (dx > 0 ? S.dirEast : S.dirWest);
function fireNear(x: number, y: number, r: number): boolean {
  for (const f of G.fixtures) if (f.lit && (f.kind === 'campfire' || f.kind === 'brazier' || f.kind === 'stove' || f.kind === 'signal_fire' || f.kind === 'torch') && Math.hypot(f.tx * TS + f.tw * 2 - x, f.ty * TS + f.th * 2 - y) < r) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------------------------------
// scent field (1-D along x): NB bins of BIN cells
const NB = 128, BIN = W / NB;
export const scent = new Float32Array(NB);
const scentTmp = new Float32Array(NB);
let scentAcc = 0;
function deposit(x: number, amt: number) { const b = Math.max(0, Math.min(NB - 1, (x / BIN) | 0)); scent[b] += amt; }
export function scentAt(x: number): number {
  const b = Math.max(0, Math.min(NB - 1, (x / BIN) | 0));
  return scent[b] + 0.4 * ((scent[b - 1] ?? 0) + (scent[b + 1] ?? 0));
}
function playerScentStrength(): number {
  const p = player();
  let s = 1;
  for (const id of ['seal_meat', 'fat', 'fish', 'cooked_meat', 'ptarmigan', 'fish_cooked']) if (count(id) > 0) s += 0.25 + Math.min(0.5, count(id) * 0.05);
  if (p.hp < 60) s += 0.4;                              // blood
  const sh = G.shelter;
  if (sh && sh.closed && p.shelter > 0.55) s *= sh.vent ? 0.55 : 0.4;   // a closed igloo holds your smell in
  return s;
}
function stepScent(dt: number) {
  scentAcc += dt; if (scentAcc < 0.25) return;
  const h = scentAcc; scentAcc = 0;
  const p = player();
  if (p && p.alive) deposit(p.x, 2.4 * playerScentStrength());
  for (const d of G.drops) {
    if (d.item === 'seal_meat' || d.item === 'fat' || d.item === 'fish' || d.item === 'sealskin') deposit(d.x, 0.8);
  }
  for (const f of G.fixtures) if (f.kind === 'fat_lamp' && f.lit) deposit(f.tx * TS, 0.6);
  // advect by the wind: 1 m/s ≈ 11 cells/s
  const shift = (G.wind * 11 * h) / BIN;
  const whole = Math.trunc(shift), frac = Math.abs(shift - whole), sgn = shift >= 0 ? 1 : -1;
  for (let i = 0; i < NB; i++) {
    const a = i - whole, b = a - sgn;
    const va = a >= 0 && a < NB ? scent[a] : 0, vb = b >= 0 && b < NB ? scent[b] : 0;
    scentTmp[i] = va * (1 - frac) + vb * frac;
  }
  for (let i = 0; i < NB; i++) {
    const l = scentTmp[i - 1] ?? 0, r = scentTmp[i + 1] ?? 0;
    scent[i] = (scentTmp[i] * 0.88 + (l + r) * 0.06) * Math.pow(0.985, h * 4);
    if (scent[i] < 0.002) scent[i] = 0;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// the husky
export function dogWarmth(x: number, y: number, sleeping: boolean): number {
  const d = fauna.dog; if (!d || d.state === 'dead') return 0;
  if (Math.hypot(d.x - x, d.y - y) > 14) return 0;
  return d.state === 'sleep' ? (sleeping ? 9 : 6) : d.state === 'sit' ? 2 : 0;
}
/** E near the husky: feed him if you carry food, else toggle stay / follow. */
export function dogInteract(): boolean {
  const d = fauna.dog, p = player(); if (!d || d.state === 'dead' || !p) return false;
  if (Math.abs(d.x - p.x) > 18 || Math.abs(d.y - p.y) > 16) return false;
  const a = ai.get(d.id)!;
  const food = ['fish_cooked', 'cooked_meat', 'fish', 'seal_meat', 'ptarmigan', 'biscuit', 'can'].find(id => count(id) > 0);
  if (food && (a.hunger ?? 100) < 85) {
    remove(food, 1); a.hunger = Math.min(100, (a.hunger ?? 0) + (getItem(food).food?.raw ? 38 : 48));
    toast(S.dogFed, 'good'); emit('dog_fed', {}); setState(d, 'sniff'); a.hold = 1.2; return true;
  }
  if (!food && (a.hunger ?? 100) < 60) toast(S.dogNoFood, 'warn');
  a.stay = !a.stay; toast(a.stay ? S.dogStay : S.dogFollow, 'info'); return true;
}
const ROOF = new Set<number>([MAT.LOG, MAT.PLANK, MAT.WOOD, MAT.FIXTURE, MAT.GLASS, MAT.BRICK, MAT.METAL]);
/** A free spot near the player with no roof or wall over it (he finds his way round walls this way). */
function dogSpotNear(d: Animal, p: { x: number; y: number }): { x: number; y: number } | null {
  for (const dyMax of [6, 16, 24]) {                      // at his level first, then a little higher or lower (a slope, a mound)
    for (let k = 0; k < 28; k++) {
      const off = (k & 1 ? 1 : -1) * (6 + 4 * (k >> 1));  // 6, -6, 10, -10, ... out to 62 cells each side
      const x = Math.max(2, Math.min(W - 3, Math.round(p.x + off)));
      const y = groundY(x, Math.max(150, (p.y - 16) | 0)) - 1;
      if (Math.abs(y - p.y) > dyMax || !boxFree(x, y, d.w, d.h)) continue;
      let roofed = false;                                 // a house or shed roof over the spot: he is inside, not beside you
      for (let yy = Math.floor(y - d.h) - 1; yy >= Math.max(0, Math.floor(y) - 40) && !roofed; yy--) if (ROOF.has(mat[yy * W + x])) roofed = true;
      if (!roofed) return { x, y };
    }
  }
  return null;
}
export const dogHunger = () => (fauna.dog ? ai.get(fauna.dog.id)?.hunger ?? 100 : 0);

/** He runs to the bird, carries it back and drops it by your feet (the magnet picks it up). Gives up after 40 s. */
function stepFetch(d: Animal, a: AI, dt: number, p: Player) {
  const f = a.fetch!; f.t += dt;
  if (f.t > 40) { a.fetch = undefined; a.carry = undefined; return; }
  if (f.ph === 'go') {
    const dr = G.drops.find(x => x.id === f.id);
    if (!dr) { a.fetch = undefined; return; }                   // you took it first
    walkTo(d, dr.x, 40, dt); setState(d, 'run');
    if (Math.abs(d.x - dr.x) < 3 && Math.abs(d.y - dr.y) < 8) { takeHuntDrop(dr.id); a.carry = 'ptarmigan'; f.ph = 'back'; f.t = 0; }
    return;
  }
  walkTo(d, p.x - (p.x >= d.x ? 6 : -6), 36, dt); setState(d, 'walk');
  if (Math.abs(d.x - p.x) < 8) {
    spawnDrop('ptarmigan', 1, d.x, d.y - 6, 0, -22, undefined, true);
    a.carry = undefined; a.fetch = undefined; a.hold = 1.5; setState(d, 'sit');
    toast(S.dogBird, 'good');
  }
}
function stepDog(d: Animal, a: AI, dt: number) {
  const p = player();
  if (d.state === 'dead') return;
  // hunger: ~1.3 game days from full to empty; starving hurts slowly
  const gm = dt * MIN_PER_SEC * G.timeScale;
  a.hunger = Math.max(0, (a.hunger ?? 100) - gm * (100 / (1.3 * 1440)));
  if ((a.hunger ?? 0) < 28 && !a.seen) { a.seen = true; toast(S.dogHungry, 'warn'); }
  if ((a.hunger ?? 0) > 50) a.seen = false;
  if ((a.hunger ?? 0) <= 0) { d.hp -= gm * (100 / (2 * 1440)); if (d.hp <= 0) { setState(d, 'dead'); d.vx = 0; toast(S.dogDied, 'bad'); emit('dog_died', {}); return; } }
  a.hold = Math.max(0, a.hold - dt); a.cd = Math.max(0, a.cd - dt);
  if (a.hold > 0) { d.vx *= 0.8; walkTo(d, d.x, 0, dt); return; }
  // sense the bear: he barks 30-60 s (a few hundred cells) before it is in sight
  const b = fauna.bear;
  let barking = false;
  if (b && b.state !== 'dead' && p && p.alive) {
    const dx = b.x - d.x, bd = Math.abs(dx);
    const danger = fauna.bearMode === 'curious' || fauna.bearMode === 'stalk' || fauna.bearMode === 'charge' || fauna.bearMode === 'siege';
    if (danger && bd < 380 && bd > 4) {
      barking = true; d.face = dx > 0 ? 1 : -1;
      if (a.cd <= 0) {
        a.cd = 7; setState(d, 'bark'); a.hold = 2.2;
        emit('dog_bark', { x: d.x, y: d.y, dir: dx > 0 ? 1 : -1, bearDist: bd });
        if (!a.sniffed || bd < 160) { a.sniffed = true; toast(fmt(S.dogBark, { dir: dirName(dx) }), 'warn'); }
        if (p.sleeping && bd < 260) wakePlayer(S.dogWake);
        return;
      }
    }
  }
  if (!p || !p.alive) { setState(d, 'sit'); walkTo(d, d.x, 0, dt); return; }
  // a bird that fell to a harpoon or a snare (hunt.ts): he fetches it, unless told to stay
  if (a.fetch) { stepFetch(d, a, dt, p); return; }
  if (!a.stay && !p.sleeping) { const dr = huntDropNear(d.x, d.y, 90); if (dr) { a.fetch = { id: dr.id, ph: 'go', t: 0 }; emit('dog_fetch', { x: dr.x, y: dr.y }); return; } }
  const dx = p.x - d.x, ad = Math.abs(dx);
  if (a.stay) { setState(d, ad < 20 ? 'sit' : 'sit'); walkTo(d, d.x, 0, dt); return; }
  // far behind: catch up (a husky finds you)
  if (ad > 260) { d.x = p.x - p.face * 18; d.y = p.y - 2; d.vx = d.vy = 0; return; }
  const resting = Math.abs(p.vx) < 1 && !p.sleeping;
  if (ad > 26) {
    const run = ad > 70;
    walkTo(d, p.x - Math.sign(dx) * 14, run ? 44 : 24, dt);
    setState(d, run ? 'run' : 'walk'); a.t = 0;
    // blocked by a wall or a closed door: he hops, and after 2.5 s he is beside you again
    a.stuck = Math.abs(d.vx) < 2 ? (a.stuck ?? 0) + dt : 0;
    if (a.stuck > 1.5 && d.onGround) d.vy = -125;
    if (a.stuck > 2.5) {
      const spot = dogSpotNear(d, p);
      a.stuck = 0;
      if (spot) { d.x = spot.x; d.y = spot.y; d.vx = d.vy = 0; }
    }
  } else {
    walkTo(d, d.x, 0, dt);
    a.t += dt;
    // idle for a while beside you, with a fish hole nearby: he stands and points at it (once per stop)
    if (!resting) a.pointed = false;
    else if (a.t > 4 && !a.pointed && !p.sleeping) {
      const h = pointHole(d.x, d.y, 100);
      if (h) { a.pointed = true; d.face = h.x >= d.x ? 1 : -1; setState(d, 'sniff'); a.hold = 2.5; emit('dog_point', { x: h.x, y: h.y }); return; }
    }
    if (p.sleeping) setState(d, 'sleep');
    else if (resting && a.t > 5 && p.airT < -8) setState(d, 'sleep');
    else if (resting && a.t > 1.6) setState(d, 'sit');
    else if (!resting) { if (ad > 12) { walkTo(d, p.x - p.face * 12, 20, dt); setState(d, 'walk'); } else setState(d, 'idle'); a.t = 0; }
    else if (d.state === 'walk' || d.state === 'run' || d.state === 'bark') setState(d, 'idle');
    if (Math.abs(d.vx) < 1 && d.state === 'walk') setState(d, 'idle');
  }
  void barking;
}

// ---------------------------------------------------------------------------------------------------------------------
// seals
function resetSeals() {
  for (const h of worldInfo.sealHoles) {
    const s = mk('seal', h.x + 2, h.y + 2, 12);
    s.state = 'hidden';
    ai.set(s.id, { mode: 'hidden', t: 0, tx: 0, cd: 6 + Math.random() * 40, hold: 0, hole: h.x });
  }
}
function scareSeal(s: Animal, a: AI) {
  if (a.mode === 'up') { a.mode = 'dive'; a.t = 0; setState(s, 'dive'); emit('seal_dive', { x: s.x, y: s.y }); }
  a.cd = Math.max(a.cd, 25 + Math.random() * 25);
}
function stepSeal(s: Animal, a: AI, dt: number) {
  const p = player();
  a.t += dt;
  const pd = p && p.alive ? Math.abs(p.x - s.x) : 999;
  if (a.mode === 'hidden') {
    a.cd -= dt * (pd < 140 ? 1 : 0.3);
    if (a.cd <= 0 && (G.storm < 0.5)) { a.mode = 'up'; a.t = 0; a.hold = 7 + Math.random() * 8; setState(s, 'surface'); if (pd < 400) { emit('seal_surface', { x: s.x, y: s.y }); burstFx('dust', s.x, s.y - 9, 4, 8, 1.0, 0xe6eef8, 4); } }
  } else if (a.mode === 'up') {
    a.hold -= dt;
    // movement and noise scare it; so does coming too close
    if (p && p.alive && pd < 46 && (Math.abs(p.vx) > 14 || pd < 12 || p.y < s.y - 25)) { if (pd < 90) { scareSeal(s, a); } }
    if (a.hold <= 0) scareSeal(s, a);
    if (s.hp <= 0) killSeal(s, a);
  } else if (a.mode === 'dive') {
    if (a.t > 1.0) { a.mode = 'hidden'; s.state = 'hidden'; a.cd = Math.max(a.cd, 18 + Math.random() * 40); }
  } else if (a.mode === 'dead') {
    if (a.cd > 0) a.cd -= dt * MIN_PER_SEC * G.timeScale;
    if (a.cd <= 0) { s.hp = 12; a.mode = 'hidden'; s.state = 'hidden'; a.cd = 20; }
  }
}
function killSeal(s: Animal, a: AI) {
  a.mode = 'dead'; s.state = 'hidden'; a.cd = 1440;      // the hole is empty for a game day
  spawnDrop('seal_meat', 6, s.x, s.y - 6, (Math.random() - 0.5) * 18, -34);
  spawnDrop('fat', 4, s.x, s.y - 6, (Math.random() - 0.5) * 18, -30);
  spawnDrop('sealskin', 2, s.x, s.y - 6, (Math.random() - 0.5) * 18, -28);
  burstFx('blood', s.x, s.y - 4, 8, 22, 0.6);
  dragMarks(s.x, s.y, G.player && G.player.x < s.x ? -1 : 1);       // hauled out of the hole: a drag trough in the snow
  fauna.sealsCaught++;
  toast(S.sealCaught, 'good'); emit('seal_caught', { x: s.x, y: s.y });
}
on('dig', (d: { x: number; y: number }) => {      // digging near a hole spooks it
  for (const s of G.animals) if (s.kind === 'seal') { const a = ai.get(s.id); if (a && a.mode === 'up' && Math.hypot(s.x - d.x, s.y - d.y) < 36) scareSeal(s, a); }
});

// ---------------------------------------------------------------------------------------------------------------------
// the fox: robs food lying around
function stepFox(f: Animal, a: AI, dt: number) {
  const p = player();
  if (f.state === 'dead') return;
  if (Math.abs(f.vx) > 3) trackStep(f.id, 'fox', f.x, f.y, f.vx > 0 ? 1 : -1, 4);     // prints in the snow (hunt.ts)
  if (f.hp <= 0) { f.state = 'dead'; f.vx = 0; if (a.carry) spawnDrop(a.carry, 1, f.x, f.y - 4, 0, -20); spawnDrop('fox_fur', 1, f.x, f.y - 4, 0, -20); return; }
  a.t += dt; a.hold = Math.max(0, a.hold - dt);
  const pd = p && p.alive ? dist(f, { x: p.x, y: p.y }) : 999;
  if (a.carry) {      // run home with the loot
    walkTo(f, (a.home ?? f.x) - Math.sign((a.home ?? f.x) - f.x) * 0, 46, dt); setState(f, 'run');
    if (Math.abs(f.x - (a.home ?? f.x)) < 6) { a.carry = undefined; a.hold = 15; }
    return;
  }
  if (pd < 34) { walkTo(f, f.x + Math.sign(f.x - (p?.x ?? 0)) * 60, 48, dt); setState(f, 'run'); return; }
  // food on the ground (not in your pack) within sniffing distance
  let best: typeof G.drops[number] | null = null, bd = 130;
  for (const d of G.drops) {
    const it = getItem(d.item);
    if (!(it.food || d.item === 'fat') || d.item === 'snow') continue;
    const dd = Math.hypot(d.x - f.x, d.y - f.y); if (dd < bd && Math.abs(d.y - f.y) < 30) { bd = dd; best = d; }
  }
  if (best && a.hold <= 0 && G.daylight < 0.8) {
    walkTo(f, best.x, 30, dt); setState(f, Math.abs(f.vx) > 6 ? 'walk' : 'sniff');
    if (Math.hypot(best.x - f.x, best.y - f.y) < 5) {
      const i = G.drops.indexOf(best); if (i >= 0) G.drops.splice(i, 1);
      a.carry = best.item; toast(fmt(S.foxSteal, { name: getItem(best.item).name }), 'warn'); emit('fox_steal', { item: best.item });
    }
    return;
  }
  // idle wander near home
  // wander near home: walk to a spot, sniff there for 8-20 s, then pick the next spot
  if (Math.abs(a.tx - f.x) > 4) { walkTo(f, a.tx, 14, dt); setState(f, 'walk'); a.pause = false; return; }
  if (!a.pause) { a.pause = true; a.hold = 8 + Math.random() * 12; }
  walkTo(f, f.x, 0, dt); setState(f, 'sniff');
  if (a.hold <= 0) { a.pause = false; a.tx = (a.home ?? f.x) + (Math.random() - 0.5) * 140; }
}

// ---------------------------------------------------------------------------------------------------------------------
// the bear
function breakWall(b: Animal, a: AI, dir: number): boolean {
  // a swipe at the shelter: loose snow, wind slab and snow blocks give way; logs, planks, stone, bone and ice hold
  const x0 = dir > 0 ? Math.floor(b.x + 4) : Math.floor(b.x - 12), y0 = Math.floor(b.y - 18);
  let n = 0, hard = 0;
  for (let y = y0; y < y0 + 16; y++) for (let x = x0; x < x0 + 8; x++) {
    if (x < 1 || x >= W - 1 || y < 1 || y >= H - 1) continue;
    const i = y * W + x, m = mat[i];
    if (m === MAT.SNOWBLOCK || m === MAT.PACKED || m === MAT.SNOW) { mat[i] = MAT.AIR; flags[i] = 0; n++; }
    else if (m === MAT.LOG || m === MAT.PLANK || m === MAT.STONE || m === MAT.WHALEBONE || m === MAT.ICE) hard++;
  }
  if (n) { wake(x0, y0); edited(x0, y0, x0 + 8, y0 + 16); burstFx('dust', dir > 0 ? b.x + 8 : b.x - 8, b.y - 10, 10, 30, 0.6, 0xe6eef8, 12); addShake(3); a.futile = 0; }
  else if (hard > 20) a.futile = (a.futile ?? 0) + 1;
  else a.futile = (a.futile ?? 0) + 0.5;
  return n > 0;
}
function deterrence(): number {
  const p = player(); let d = 0;
  if (fireNear(p.x, p.y - 8, 52)) d = 1;
  if (toolState.flares.length) d = 1;
  if (held.torchLit) d = Math.max(d, 0.65);
  const dog = fauna.dog;
  if (dog && dog.state === 'bark' && Math.abs(dog.x - p.x) < 40) d = Math.max(d, 0.35);
  return d;
}
function retreat(b: Animal, a: AI, secs: number) { a.mode = 'flee'; a.t = 0; a.hold = secs; fauna.bearMode = 'flee'; if (G.player && dist(b, G.player) < 400) toast(S.bearGone, 'info'); }

function stepBear(b: Animal, a: AI, dt: number) {
  const p = player();
  if (b.state === 'dead') return;
  if (b.hp <= 0) {
    setState(b, 'dead'); b.vx = 0; fauna.bearMode = 'dead';
    spawnDrop('bear_fur', 1, b.x, b.y - 8, 0, -30); spawnDrop('seal_meat', 5, b.x, b.y - 8, 12, -30); spawnDrop('fat', 4, b.x, b.y - 8, -12, -30);
    toast(S.bearDead, 'good'); emit('bear_killed', {}); return;
  }
  a.t += dt; a.cd = Math.max(0, a.cd - dt);
  // its prints: the scent made visible. A print close to the player gives the hint (throttled)
  if (Math.abs(b.vx) > 3 && trackStep(b.id, 'bear', b.x, b.y, b.vx > 0 ? 1 : -1, 7) && p && p.alive && Math.abs(p.x - b.x) < 260 && !(a.hintT && a.hintT > 0)) { a.hintT = 25; emit('scent_hint', { dir: Math.sign(b.x - p.x) || 1 }); }
  a.hintT = Math.max(0, (a.hintT ?? 0) - dt);
  const active = G.day >= fauna.bearActiveDay;
  const aggr = G.diff.wolves * bearRamp();                // difficulty x ring ramp: bear aggression
  const alive = !!p && p.alive;
  const pd = alive ? Math.abs(p.x - b.x) : 9999, pdy = alive ? p.y - b.y : 0;
  const smell = scentAt(b.x) * aggr;
  fauna.bearSmell = smell;
  // gradient: which way is the scent stronger?
  const g = scentAt(b.x + 5 * BIN) - scentAt(b.x - 5 * BIN);
  const wounded = b.hp < 70;
  // modes ----------------------------------------------------------------
  if (a.mode === 'flee') {
    a.hold -= dt;
    const away = alive ? Math.sign(b.x - p.x) || 1 : 1;
    walkTo(b, b.x + away * 80, 24, dt, { swim: true, jump: 110 }); setState(b, 'run');
    if (a.hold <= 0 || pd > 520) { a.mode = 'wander'; a.t = 0; a.cd = 40; fauna.bearMode = 'wander'; a.tx = b.x; }
    return;
  }
  const seesYou = alive && pd < 90 * aggr && Math.abs(pdy) < 40;
  if (a.mode === 'wander') {
    fauna.bearMode = 'wander';
    if (a.t > 14 + (a.hold || 0)) {
      a.t = 0; a.hold = Math.random() * 10;
      a.tx = G.day >= 2 && alive && Math.random() < 0.3 ? Math.max(600, Math.min(1940, p.x + (Math.random() * 2 - 1) * 400)) : 960 + Math.random() * 980;
    }
    const going = Math.abs(a.tx - b.x) > 6;
    if (going && a.t < 40) { walkTo(b, a.tx, 11, dt, { swim: true, jump: 110 }); setState(b, 'walk'); }
    else { walkTo(b, b.x, 0, dt); setState(b, a.t % 20 < 8 ? 'sniff' : a.t % 20 < 14 ? 'idle' : 'sleep'); }
    if (active && a.cd <= 0 && alive && (smell > 0.9 || seesYou)) { a.mode = 'curious'; a.t = 0; a.futile = 0; fauna.bearMode = 'curious'; emit('bear_growl', { x: b.x, y: b.y }); if (pd < 700) toast(S.bearSniff, 'warn'); }
    return;
  }
  if (!alive) { a.mode = 'wander'; return; }
  if (a.mode === 'curious') {
    fauna.bearMode = 'curious';
    // follow the gradient toward the strongest scent; if the player is the source, close in
    const dir = pd < 260 ? Math.sign(p.x - b.x) : (g !== 0 ? Math.sign(g) : Math.sign(p.x - b.x));
    walkTo(b, b.x + dir * 40, 17, dt, { swim: true, jump: 110 }); setState(b, 'walk');
    if (a.t % 11 < dt) emit('bear_growl', { x: b.x, y: b.y });
    if (smell < 0.25 && !seesYou) { a.hold += dt; if (a.hold > 16) { a.mode = 'wander'; a.hold = 0; a.cd = 30; } } else a.hold = 0;
    if (pd < 130) { a.mode = 'stalk'; a.t = 0; fauna.bearMode = 'stalk'; }
    return;
  }
  const inShelter = !!(G.shelter && G.shelter.closed) && p.shelter > 0.5;
  const det = deterrence();
  if (a.mode === 'stalk') {
    fauna.bearMode = 'stalk';
    if (det >= 0.9) { retreat(b, a, 45); return; }
    walkTo(b, p.x, pd > 70 ? 15 : 9, dt, { swim: true, jump: 110 }); setState(b, pd > 70 ? 'walk' : 'sniff');
    if (a.t > 3 && a.t % 9 < dt) emit('bear_growl', { x: b.x, y: b.y });
    if (pd < 12 && inShelter) { a.mode = 'siege'; a.t = 0; a.cd = 0.5; fauna.bearMode = 'siege'; return; }
    if (pd < 55 && a.t > 4 && (det < 0.5 || Math.random() < 0.002)) { a.mode = 'charge'; a.t = 0; fauna.bearMode = 'charge'; emit('bear_roar', { x: b.x, y: b.y }); setState(b, 'charge'); }
    if (wounded) retreat(b, a, 30);
    return;
  }
  if (a.mode === 'charge') {
    fauna.bearMode = 'charge';
    if (det >= 0.9) { retreat(b, a, 45); return; }
    if (inShelter && pd < 16) { a.mode = 'siege'; a.t = 0; a.cd = 0.5; fauna.bearMode = 'siege'; return; }
    walkTo(b, p.x, 42, dt, { swim: true, jump: 125 }); setState(b, 'charge');
    if (pd < 11 && Math.abs(pdy) < 20 && a.cd <= 0) {
      a.cd = 1.5; setState(b, 'swipe'); a.hits = (a.hits ?? 0) + 1;
      damage(26 + Math.random() * 16, 'bear'); toast(S.bearHit, 'bad'); addShake(6);
      p.vx += Math.sign(p.x - b.x) * 90; p.vy = -50;
      if (a.hits >= 2) { a.hits = 0; retreat(b, a, 18); }
    }
    if (wounded) retreat(b, a, 30);
    return;
  }
  if (a.mode === 'siege') {
    fauna.bearMode = 'siege';
    if (!(a.tx && Math.abs(a.tx - b.x) > 1.5)) walkTo(b, b.x, 0, dt);
    b.face = p.x > b.x ? 1 : -1;
    if (!inShelter && pd > 14) { a.mode = 'charge'; return; }
    if (det >= 0.9) { retreat(b, a, 45); return; }
    if (a.cd <= 0) { a.cd = 1.3; setState(b, 'swipe'); a.t = 0; if (breakWall(b, a, b.face)) a.tx = b.x + b.face * 7; }
    if (a.tx && Math.abs(a.tx - b.x) > 1.5 && Math.abs(a.tx - p.x) > 5) { walkTo(b, a.tx, 14, dt); }
    else if (a.t > 0.45 && b.state === 'swipe') setState(b, 'rear');
    if ((a.futile ?? 0) >= 4) { retreat(b, a, 60); a.futile = 0; }
    if (wounded) retreat(b, a, 40);
    return;
  }
}

on('animal_hit', (d: { id: number }) => {
  const a = G.animals.find(x => x.id === d.id); if (!a) return;
  if (a.kind === 'bear') { const s = ai.get(a.id); if (s && s.mode !== 'flee' && a.hp > 0 && a.hp < 70) retreat(a, s, 30); }
});

// ---------------------------------------------------------------------------------------------------------------------
// public API
export function resetFauna() {
  G.animals.length = 0; ai.clear(); scent.fill(0); fauna.dog = fauna.bear = null; fauna.bearMode = 'wander'; fauna.bearSmell = 0; fauna.sealsCaught = 0;
}
/** Create all animals of a fresh world (after worldgen and initPlayer). */
export function initFauna(spawnX: number, spawnY: number, loaded = false) {
  resetFauna();
  resetSeals();
  // the husky starts at the kennel
  const kennel = G.fixtures.find(f => f.kind === 'kennel');
  const dx = loaded ? spawnX - 14 : kennel ? kennel.tx * TS + kennel.tw * 2 : spawnX - 16, dy = loaded ? spawnY : kennel ? (kennel.ty + kennel.th) * TS : spawnY;
  const d = mk('dog', dx, dy - 1, 60); fauna.dog = d;
  ai.set(d.id, { mode: 'dog', t: 0, tx: 0, cd: 0, hold: 0, hunger: 90 });
  // the fox lives on the tundra near the station
  const fx = 888;                                       // tundra between the shed and the beach (not on a roof)
  const f = mk('fox', fx, groundY(fx, 255) - 1, 8); ai.set(f.id, { mode: 'fox', t: 0, tx: fx, cd: 0, hold: 0, home: fx });
  // the bear starts far out on the pack ice
  let bx = 1640, by = groundY(bx, 200) - 1;
  for (let k = 0; k < 40; k++) {                        // a body must not start inside packed snow: try nearby columns, lift the feet out
    const cx = 1640 + (k & 1 ? 1 : -1) * ((k + 1) >> 1) * 8;
    let cy = groundY(cx, 200) - 1;
    for (let j = 0; j < 40 && !boxFree(cx, cy, SZ.bear[0], SZ.bear[1]); j++) cy--;
    if (boxFree(cx, cy, SZ.bear[0], SZ.bear[1])) { bx = cx; by = cy; break; }
  }
  const b = mk('bear', bx, by, 160); fauna.bear = b;
  ai.set(b.id, { mode: 'wander', t: 0, tx: bx, cd: 20, hold: 0 }); fauna.bearMode = 'wander';
  initHunt();                                           // fish holes, ptarmigan sites, tracks: a fresh set for this world (or the loaded one)
}
export function stepFauna(dt: number) {
  if (G.paused || !G.player) return;
  stepScent(dt);
  stepHunt(dt);                         // fish under the ice, ptarmigan flocks, tracks (hunt.ts)
  const arr = G.animals;
  for (let i = 0; i < arr.length; i++) {
    const e = arr[i], a = ai.get(e.id); if (!a) continue;
    // far away animals only tick slowly (seals/fox/bear far from the camera)
    switch (e.kind) {
      case 'dog': stepDog(e, a, dt); break;
      case 'seal': stepSeal(e, a, dt); break;
      case 'fox': stepFox(e, a, dt); break;
      case 'bear': stepBear(e, a, dt); break;
    }
    if (e.y > H - 4 || !Number.isFinite(e.x) || !Number.isFinite(e.y)) { e.vx = e.vy = 0; if (!Number.isFinite(e.x)) e.x = 700; if (!Number.isFinite(e.y) || e.y > H - 4) e.y = groundY(e.x, 150) - 1; }
  }
  // the bear comes into view
  const b = fauna.bear, p = player();
  if (b && b.state !== 'dead' && p) {
    const d = Math.abs(b.x - p.x);
    const a = ai.get(b.id)!;
    if (d < G.cam.viewW * 0.55 + 20 && Math.abs(b.y - p.y) < G.cam.viewH) { if (!a.seen) { a.seen = true; toast(S.bearSeen, 'bad'); emit('bear_seen', { x: b.x, y: b.y }); } }
    else if (d > 360) a.seen = false;
  }
}
export const aiOf = (e: Animal) => ai.get(e.id);
/** Test hook: put an animal's AI into a mode. */
export function setAiMode(e: Animal, mode: string) { const a = ai.get(e.id); if (a) { a.mode = mode; a.t = 0; if (e.kind === 'bear') fauna.bearMode = mode; } }
export function sealHoleAnimals(): Animal[] { return G.animals.filter(a => a.kind === 'seal'); }
void setCell; void F_PLACED; void inv;
