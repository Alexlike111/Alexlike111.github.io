// Pack-ice drift & leads (DESIGN §7). The pack zone is divided into floes separated by crack lines. Once or twice per game day (and every few
// hours in a storm) the wind pushes a GROUP of floes sideways by whole tiles: all cells from the sky down to the floe's keel move together —
// snow, structures, fixtures, drops and the animals / player standing on it. Water opens on the trailing side (a lead), floes press together on
// the leading side, and when the group is blocked a pressure ridge of piled ice is built instead. The crack line glows and the ice groans
// ~9 s before anything moves. Open leads freeze over time (thin new ice -> thicker); new ice under ~20 cm cracks and breaks under your feet.
// Emits: 'ice_crack' {x,y,near,vol}, 'drift_warn' {x}, 'drift_move' {dir}, 'drift_ridge' {x}, 'ice_thin' {x}, 'ice_break' {x}.
import { G, toast } from './state';
import { emit } from './bus';
import { strings } from '../content/i18n';
import { W, H, TS, mat, aux, flags, shade, wake, edited, setCell } from '../engine/grid';
import { MAT } from '../content/materials';
import { worldInfo, terrain } from './worldgen';
import { SEA } from './locations';
import { MIN_PER_SEC } from './weather';
import { addShake } from '../engine/camera';
import { burstFx } from '../engine/particles';
import { inv, backpacks } from './inventory';

const S = strings('drift', {
  warn: 'Лёд трещит под ногами — льдина пойдёт!',
  far: 'Где-то далеко на льду глухо трещит и стонет',
  moved: 'Льдина сдвинулась. Между льдинами открылась полынья',
  ridge: 'Льды сошлись: выросла торосистая гряда',
  thinUnder: 'Лёд тонкий и трещит! Уходи!',
  broke: 'Лёд проломился!',
});

export interface DriftFloe { x0: number; x1: number; thick: number; grounded: boolean }
const Y0 = 110;                       // top of the moved column (sky above the highest mast)
const STEP = TS;                      // one tile per creep step so fixtures stay tile-aligned
const WARN_S = 9;                     // seconds of cracking before the creep
const MIN_GAP = 2;                    // columns of crack water that always stay between floes
const LEFT_WALL = 1466;               // the fast ice edge: floes press against it
const RIGHT_WALL = 1996;              // the open sea beyond is not a wall, but floes do not drift off the map
export const driftState = {
  floes: [] as DriftFloe[],
  pending: null as null | { k0: number; k1: number; dir: 1 | -1; steps: number; t: number; creep: number; warned: boolean; x: number },
  nextAt: 0, events: 0, ridges: 0, lastMoveX: 0,
};
let freezeAcc = 0, thinT = 0, thinWarn = 0, rndS = 1;
const rnd = () => { rndS = (rndS * 1664525 + 1013904223) >>> 0; return rndS / 4294967296; };

function colBottom(x: number): { bot: number; grounded: boolean } {
  let y = SEA - 14;
  while (y < H - 2 && mat[y * W + x] === MAT.AIR) y++;               // first non-air cell: the top of the snow / ice
  const sb = terrain.seabed[x] || H;
  // the keel is the deepest non-water cell above the sea floor (a column may hold a pocket of water, e.g. beside a seal hole)
  let bot = y, run = 0;
  for (let yy = y; yy < sb && yy < H - 2; yy++) {
    const m = mat[yy * W + x];
    if (m === MAT.WATER) { if (++run > 5) break; } else { run = 0; if (m !== MAT.AIR) bot = yy; }     // a pocket is <= 5 cells; open sea below ends the keel
  }
  return { bot, grounded: bot + 1 >= sb };
}
function refreshFloes() {
  for (const f of driftState.floes) {
    let g = false;
    for (let x = f.x0; x <= f.x1; x += 3) { if (colBottom(x).grounded) { g = true; break; } }
    f.grounded = g;
  }
}
function syncInfo() {
  const info = worldInfo.iceField, fl = driftState.floes;
  info.floes.length = 0; info.cracks.length = 0; info.leads.length = 0;
  for (let i = 0; i < fl.length; i++) {
    info.floes.push({ x0: fl[i].x0, x1: fl[i].x1, thick: fl[i].thick });
    if (i + 1 < fl.length) {
      const gap = fl[i + 1].x0 - fl[i].x1 - 1;
      info.cracks.push(Math.round((fl[i].x1 + fl[i + 1].x0) / 2));
      if (gap >= 3) info.leads.push({ x0: fl[i].x1 + 1, x1: fl[i + 1].x0 - 1, thin: false });
    }
  }
}
/** What a save needs to put the pack back where it drifted to (the grid itself is saved by save.ts). */
export function driftSnapshot() { return { holes: worldInfo.sealHoles.map(h => h.x), ev: driftState.events, floes: driftState.floes.map(f => ({ x0: f.x0, x1: f.x1, thick: f.thick })) }; }
export function initDrift(seed = 1, saved?: { holes?: number[]; ev?: number; floes?: { x0: number; x1: number; thick: number }[] } | null) {
  rndS = (seed * 2654435761) >>> 0 || 1;
  if (saved?.holes) worldInfo.sealHoles.forEach((h, i) => { if (saved.holes![i] !== undefined) h.x = saved.holes![i]; });
  const src = saved?.floes?.length ? saved.floes : worldInfo.iceField.floes;
  driftState.floes = src.map(f => ({ x0: f.x0, x1: f.x1, thick: f.thick, grounded: false }));
  refreshFloes(); syncInfo();
  driftState.pending = null; driftState.events = 0; driftState.ridges = 0;
  driftState.nextAt = G.time + 5 * 60 + rnd() * 5 * 60;           // the first shift comes on the first evening
  freezeAcc = 0; thinT = 0; thinWarn = 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// moving a group of floes
export function shiftFloes(k0: number, k1: number, dir: 1 | -1): boolean { return moveGroup(k0, k1, dir); }
function moveGroup(k0: number, k1: number, dir: 1 | -1): boolean {
  const fl = driftState.floes;
  const xa = fl[k0].x0, xb = fl[k1].x1;
  // keel depth of every column the move touches (sources AND destinations); a seal-hole shaft only reaches the water, so each column copies as deep
  // as the deeper of itself and its destination: whatever lies below the source is open water, which then replaces the old ice there
  const dx = dir * STEP;
  const bx0 = Math.min(xa, xa + dx), bx1 = Math.max(xb, xb + dx);
  const keel: number[] = [];
  for (let x = bx0; x <= bx1; x++) keel.push(colBottom(x).bot);
  const kb = (x: number) => keel[x - bx0];
  const bots: number[] = [];
  for (let x = xa; x <= xb; x++) bots.push(kb(x));
  const lo = dir > 0 ? xa : xa - STEP, hi = dir > 0 ? xb + STEP : xb;
  if (lo < 2 || hi > W - 3) return false;
  // 1. copy columns, leading edge first
  const copyCol = (x: number) => {
    const nx = x + dx, bot = Math.max(kb(x), kb(nx));
    for (let y = Y0; y <= bot; y++) {
      const s = y * W + x, d = y * W + nx;
      mat[d] = mat[s]; aux[d] = aux[s]; flags[d] = flags[s]; shade[d] = shade[s];
    }
  };
  if (dir > 0) for (let x = xb; x >= xa; x--) copyCol(x);
  else for (let x = xa; x <= xb; x++) copyCol(x);
  // 2. vacated columns: open water in the ice rows, air above the sea
  const vx0 = dir > 0 ? xa : xb - STEP + 1;
  for (let x = vx0; x < vx0 + STEP; x++) {
    const bot = kb(x);
    for (let y = Y0; y <= bot; y++) { const i = y * W + x; mat[i] = y < SEA ? MAT.AIR : MAT.WATER; aux[i] = 0; flags[i] = 0; }
  }
  // 3. things standing on the moved floes ride along
  const rides = (x: number, y: number) => { if (x < xa || x > xb) return false; const b = bots[Math.floor(x) - xa]; return y <= b + 1 && y >= Y0; };
  for (const f of G.fixtures) if (rides(f.tx * TS + 1, f.ty * TS + 1)) f.tx += dir;
  for (const d of G.drops) if (rides(d.x, d.y)) d.x += dx;
  for (const a of G.animals) if (rides(a.x, a.y - 1)) a.x += dx;
  const p = G.player; if (p && p.alive && rides(p.x, p.y - 1)) p.x += dx;
  if (inv.sled && rides(inv.sled.x, inv.sled.y)) inv.sled.x += dx;
  void backpacks;
  for (const h of worldInfo.sealHoles) if (h.floe === 'pack' && h.x >= xa && h.x <= xb) h.x += dx;
  for (let i = k0; i <= k1; i++) { fl[i].x0 += dx; fl[i].x1 += dx; }
  // 4. tell the engine
  edited(lo - 2, Y0, hi + 2, Math.max(...bots) + 2);
  wake(lo, SEA); wake(hi, SEA); wake((lo + hi) >> 1, SEA);
  syncInfo();
  return true;
}

function buildRidge(x: number, dir: 1 | -1) {
  // piled ice blocks where two floes press together
  const half = 8 + ((rnd() * 5) | 0);
  for (let dx = -half; dx <= half; dx++) {
    const xx = x + dx; if (xx < 2 || xx >= W - 2) continue;
    let top = Y0; while (top < H - 2 && mat[top * W + xx] === MAT.AIR) top++;
    const h = Math.max(0, Math.round((half - Math.abs(dx)) * (0.55 + rnd() * 0.45)));
    for (let k = 1; k <= h; k++) { const y = top - k; if (mat[y * W + xx] === MAT.AIR) setCell(xx, y, MAT.ICE, 0, 0); }
  }
  edited(x - half, SEA - 20, x + half, SEA + 4);
  driftState.ridges++;
  worldInfo.iceField.ridges.push({ x: x - half, w: half * 2 + 1, h: half });
  void dir;
  emit('drift_ridge', { x });
}

function plan(): { k0: number; k1: number; dir: 1 | -1; blocked: boolean; x: number } | null {
  const fl = driftState.floes;
  const movable = fl.map((f, i) => (f.grounded ? -1 : i)).filter(i => i >= 0);
  if (!movable.length) return null;
  // storm wind decides, otherwise the sign of the wind with a random flip
  const w = G.wind;
  let dir: 1 | -1 = Math.abs(w) > 3 ? (w > 0 ? 1 : -1) : rnd() < 0.5 ? 1 : -1;
  if (G.storm < 0.4 && rnd() < 0.25) dir = (dir > 0 ? -1 : 1);
  const k = movable[(rnd() * movable.length) | 0];
  let k0 = k, k1 = k;
  // the group: floes that would be touched by this one within a step of travel
  if (dir > 0) { while (k1 + 1 < fl.length && fl[k1 + 1].x0 - fl[k1].x1 - 1 < STEP + MIN_GAP && !fl[k1 + 1].grounded) k1++; }
  else { while (k0 - 1 >= 0 && fl[k0].x0 - fl[k0 - 1].x1 - 1 < STEP + MIN_GAP && !fl[k0 - 1].grounded) k0--; }
  let blocked = false;
  if (dir > 0) {
    const next = fl[k1 + 1];
    if (next ? next.x0 - fl[k1].x1 - 1 < STEP + MIN_GAP : fl[k1].x1 + STEP > RIGHT_WALL) blocked = true;      // a grounded floe or the map edge ahead
  } else {
    const prev = fl[k0 - 1];
    if (prev ? fl[k0].x0 - prev.x1 - 1 < STEP + MIN_GAP : fl[k0].x0 - STEP < LEFT_WALL) blocked = true;
  }
  const x = dir > 0 ? fl[k1].x1 : fl[k0].x0;
  return { k0, k1, dir, blocked, x };
}

function startEvent() {
  const pl = plan();
  driftState.nextAt = G.time + (G.storm > 0.4 ? 3 + rnd() * 2 : 8 + rnd() * 8) * 60;
  if (!pl) return;
  if (pl.blocked) {                                      // the pack is jammed: a ridge rises with the same warning
    driftState.pending = { k0: pl.k0, k1: pl.k1, dir: pl.dir, steps: 0, t: 0, creep: 0, warned: false, x: pl.x };
    return;
  }
  driftState.pending = { k0: pl.k0, k1: pl.k1, dir: pl.dir, steps: 2 + ((rnd() * 3) | 0), t: 0, creep: 0, warned: false, x: pl.x };
}

export function stepDrift(dt: number) {
  if (G.paused || !G.player) return;
  const p = G.player;
  // schedule
  if (!driftState.pending && G.time >= driftState.nextAt) startEvent();
  const ev = driftState.pending;
  if (ev) {
    ev.t += dt;
    const dist = Math.abs(p.x - ev.x);
    if (!ev.warned) {
      ev.warned = true;
      if (dist < 500) { toast(S.warn, 'warn'); } else toast(S.far, 'info');
      emit('drift_warn', { x: ev.x });
    }
    const near = dist < 260;
    // cracking sounds and shaking during the warning
    if (ev.t < WARN_S) {
      if (Math.random() < dt * 1.6) emit('ice_crack', { x: ev.x, y: SEA, near, vol: near ? 0.9 : 0.35 });
      if (near) addShake(0.4 + 0.5 * ev.t / WARN_S);
      if (near && Math.random() < dt * 14) burstFx('dust', ev.x + (Math.random() - 0.5) * 6, SEA - 4, 2, 16, 0.5, 0xcfe6f6, 6);
    } else if (ev.steps <= 0) {
      if (ev.t >= WARN_S) {                              // blocked: build the ridge now
        const fl = driftState.floes;
        buildRidge(ev.dir > 0 ? fl[ev.k1].x1 : fl[ev.k0].x0, ev.dir);
        if (dist < 500) toast(S.ridge, 'info');
        if (near) addShake(5);
        driftState.events++; driftState.pending = null;
      }
    } else {
      ev.creep -= dt;
      if (ev.creep <= 0) {
        ev.creep = 0.85;
        // re-check the room ahead each step
        const fl = driftState.floes; let ok = true;
        if (ev.dir > 0) { const nx = fl[ev.k1 + 1]; if (nx ? nx.x0 - fl[ev.k1].x1 - 1 < STEP + MIN_GAP : fl[ev.k1].x1 + STEP > RIGHT_WALL) ok = false; }
        else { const pv = fl[ev.k0 - 1]; if (pv ? fl[ev.k0].x0 - pv.x1 - 1 < STEP + MIN_GAP : fl[ev.k0].x0 - STEP < LEFT_WALL) ok = false; }
        if (ok && moveGroup(ev.k0, ev.k1, ev.dir)) {
          ev.steps--; driftState.lastMoveX = ev.x;
          emit('ice_crack', { x: ev.x, y: SEA, near, vol: near ? 1 : 0.4 });
          if (near) addShake(2.5);
          emit('drift_move', { dir: ev.dir });
          if (ev.steps <= 0) {
            driftState.events++; driftState.pending = null;
            if (dist < 500) toast(S.moved, 'info');
          }
        } else {
          ev.steps = 0; driftState.events++; driftState.pending = null;
        }
      }
    }
  }
  // leads freeze over (thin new ice -> thicker)
  freezeAcc += dt * MIN_PER_SEC * G.timeScale;
  if (freezeAcc >= 30) { const gm = freezeAcc; freezeAcc = 0; freezeLeads(gm); }
  stepThinIce(dt);
}

/** Open water between floes grows a skin of ice downward: one cell per ~2 game hours when it is cold. */
export function freezeLeads(gm: number) {
  if (G.ambientT > -8) return;
  const fl = driftState.floes;
  for (let i = 0; i + 1 < fl.length; i++) {
    for (let x = fl[i].x1 + 1; x < fl[i + 1].x0; x++) {
      // the first and last column stay open a little longer (the crack line)
      if (x === fl[i].x1 + 1 || x === fl[i + 1].x0 - 1) { if (Math.random() > 0.15) continue; }
      if (Math.random() > gm / 120 * (0.5 + 0.5 * Math.min(1, (-G.ambientT - 8) / 20))) continue;
      let y = SEA; while (y < H - 2 && mat[y * W + x] === MAT.ICE) y++;
      if (mat[y * W + x] !== MAT.WATER || y - SEA >= 14) continue;
      mat[y * W + x] = MAT.ICE; aux[y * W + x] = 0; flags[y * W + x] = 0; shade[y * W + x] = (Math.random() * 256) | 0;
      wake(x, y);
    }
  }
}

/** Thickness (cells) of the ICE sheet under the feet when open water lies right below it (a snow cover on top is looked through), else 99. */
export function iceUnder(x: number, y: number): number {
  const xi = Math.floor(x); let yy = Math.floor(y);
  if (yy < 1 || yy >= H - 20) return 99;
  for (let k = 0; k < 8 && mat[yy * W + xi] === MAT.AIR; k++) yy++;     // feet a little above the surface
  let guard = 0;
  while (guard++ < 18 && (mat[yy * W + xi] === MAT.SNOW || mat[yy * W + xi] === MAT.PACKED || mat[yy * W + xi] === MAT.SNOWBLOCK)) yy++;
  let c = 0;
  while (c < 14 && mat[yy * W + xi] === MAT.ICE) { c++; yy++; }
  return c > 0 && c < 14 && mat[yy * W + xi] === MAT.WATER ? c : 99;
}
function stepThinIce(dt: number) {
  const p = G.player;
  if (!p.alive || !p.onGround) { thinT = Math.max(0, thinT - dt * 2); return; }
  const th = iceUnder(p.x, p.y);
  // does water lie right under the sheet? (a thin lead, not the thick pack)
  if (th > 3) { thinT = Math.max(0, thinT - dt * 2); return; }
  thinT += dt * (th <= 2 ? 1 : 0.35);
  thinWarn -= dt;
  if (thinWarn <= 0) { thinWarn = 1.4; emit('ice_crack', { x: p.x, y: p.y, near: true, vol: 0.9 }); emit('ice_thin', { x: p.x }); if (thinT < 1) toast(S.thinUnder, 'warn'); }
  if (thinT > 1.7 && th <= 2) {
    // break a hole under the feet
    const x0 = Math.floor(p.x) - 7, x1 = Math.floor(p.x) + 7;
    // the sheet and any snow bridge over it give way in a ~14 cell wide hole
    for (let x = x0; x <= x1; x++) for (let y = Math.floor(p.y) - 14; y < SEA + 8; y++) {
      const i = y * W + x, m = mat[i];
      if (m === MAT.ICE) { mat[i] = y < SEA ? MAT.AIR : MAT.WATER; aux[i] = 0; flags[i] = 0; }
      else if (m === MAT.SNOW || m === MAT.PACKED || m === MAT.SNOWBLOCK) { mat[i] = MAT.AIR; aux[i] = 0; flags[i] = 0; }
    }
    edited(x0, Math.floor(p.y) - 16, x1, SEA + 10); wake(p.x, SEA);
    burstFx('dust', p.x, SEA - 2, 14, 30, 0.7, 0xd6ecfa, 10);
    toast(S.broke, 'bad'); emit('ice_break', { x: p.x }); thinT = 0; addShake(3);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// the glowing crack line (drawn above lighting, unlit)
export function drawDrift(ctx: CanvasRenderingContext2D, v: { x0: number; y0: number; w: number; h: number; t: number }) {
  const ev = driftState.pending; if (!ev) return;
  const k = ev.t < WARN_S ? Math.min(1, ev.t / WARN_S) : 1;
  const fl = driftState.floes;
  const xs = [ev.dir > 0 ? fl[ev.k1].x1 + 1 : fl[ev.k0].x0 - 1];
  for (const x of xs) {
    const sx = x - v.x0; if (sx < -10 || sx > v.w + 10) continue;
    const a = (0.25 + 0.55 * k) * (0.6 + 0.4 * Math.sin(v.t * (8 + 14 * k)));
    ctx.fillStyle = `rgba(150,230,255,${a.toFixed(3)})`;
    let y = SEA - 3 - v.y0;
    for (let s = 0; s < 6; s++) { const jx = Math.round(Math.sin(s * 1.9 + v.t * 3) * 2); ctx.fillRect(Math.round(sx) + jx, y, 1, 3); y += 3; }
    ctx.fillStyle = `rgba(210,245,255,${(a * 0.5).toFixed(3)})`; ctx.fillRect(Math.round(sx) - 1, SEA - v.y0 - 5, 3, 1);
  }
}
