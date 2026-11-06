// Player controller (cells, y down) + body heat balance.
import { W, H, M, mat, dens, bond, flags, body, idx, inb, set, wake, blocksPlayer, isGranular, F_DIST, F_CAP, F_TREE, CELL } from './world';
import { tool, inv } from './tools';
import { G } from './state';
import { tempAt, windAt, shelterAt } from './heat';
import { spawn, PK } from './particles';
import { bodyAtIndex, impulseAt } from './phys';

export const pl = {
  x: 600, y: 380, vx: 0, vy: 0, face: 1, onGround: false,
  sink: 0,          // 0..1 how deep in snow (fraction of height)
  core: 37, food: 0.85, stamina: 1, wet: 0, snowOn: 0,
  snowshoes: false, alive: true, cause: '', work: 0, walkPhase: 0, stepAcc: 0,
  feelT: -20, airT: -20, wind: 0, shelter: 0, shiver: 0, fireRad: 0,
  breathT: 0, lastStepDens: 100,
  h: 34,            // current body height in cells: PH standing, PH_CRAWL when crawling under a low roof
};
export const PW = 10, PH = 34, PH_CRAWL = 20, JUMP_V = 72; // jump apex ~ JUMP_V^2 / (2 * 196) = 13 cells
// heat balance tunables
const LOSS_K = 4.3;       // W/K of (33 - feel) heat loss through the clothes (x wet factor)
const SHIVER_ON = 36.6;   // core temperature where shivering starts
const SHIVER_RAMP = 1.1;  // ... and reaches its maximum this many degrees lower
const SHIVER_W = 240;     // W of extra heat at full shiver (costs food, slows stamina regeneration)
const FOOD_K = 0.21;      // gauge scale (see stepBody)
let hungerLvl = 2;

function solid(x: number, y: number) {
  if (!inb(x, y)) return true;
  return blocksPlayer(idx(x, y));
}

/** Snow lying on boughs (flagged as a cap, or a snow stack whose bottom is needles): never blocks the hero, it slides off when he pushes through. */
function boughSnow(i: number): boolean {
  if (mat[i] !== M.SNOW) return false;
  if (flags[i] & F_CAP) return true;
  let j = i;
  for (let k = 0; k < 14; k++) {
    j += W; if (j >= W * H) return false;
    const m = mat[j];
    if (m === M.NEEDLE) return true;
    if (m !== M.SNOW) return false;
    if (flags[j] & F_CAP) return true;
  }
  return false;
}
const rigidSnowAt = (x: number, y: number) => { if (!inb(x, y)) return false; const i = idx(x, y); return mat[i] === M.SNOW && !isGranular(i) && !body[i]; };
/** width of the rigid-snow run through (x,y) (capped at 7) */
function runW(x: number, y: number): number {
  let n = 1;
  for (let k = 1; k <= 3 && rigidSnowAt(x - k, y); k++) n++;
  for (let k = 1; k <= 3 && rigidSnowAt(x + k, y); k++) n++;
  return n;
}
/** Turn snow in a rect granular (bond 0). all: every snow cell; otherwise only loose (<250 kg/m3) or thin (<= 2 wide) ones. Returns cells crumbled. */
function crumble(x0: number, x1: number, y0: number, y1: number, all: boolean): number {
  let n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (!inb(x, y)) continue;
    const i = idx(x, y);
    if (mat[i] !== M.SNOW || body[i]) continue;
    if (!all && !(isGranular(i) || dens[i] < 250 || runW(x, y) <= 2)) continue;
    if (isGranular(i) && bond[i] === 0) continue;
    bond[i] = 0; if (dens[i] > 400) dens[i] = 400; flags[i] |= F_DIST; wake(x, y); n++;
  }
  return n;
}
let stuckT = 0, pushT = 0, stuckMsgT = -99, trunkT = 0, trunkMsgT = -99;
/** what blocks the lead column this step: 0 nothing, 1 snow, 2 tree trunk / stump, 3 placed timber / crate, 4 ground / rock / ice */
let blockKind = 0;

/** bearing density: snow under the foot compacts until it reaches this (boots vs snowshoes) */
const bearing = () => (pl.snowshoes ? 190 : 360);

/** Compact the snow column under the feet; returns true if the cell under is now supporting. */
function compactUnder(fx: number, fy: number): boolean {
  const i = idx(fx, fy);
  if (mat[i] !== M.SNOW || body[i]) return blocksPlayer(i);
  if (dens[i] >= bearing() || bond[i] > 160) return true;
  // push this cell's mass into the one below (mass conserving, cap 917, remainder stays)
  const j = i + W;
  if (fy + 1 < H && mat[j] === M.SNOW && !body[j]) {
    const add = Math.min(dens[i], 917 - dens[j]);
    if (add > 0) {
      dens[j] += add;
      bond[j] = Math.max(bond[j], 30); flags[j] |= F_DIST;
      wake(fx, fy + 1);
    }
    if (add >= dens[i]) { set(fx, fy, M.AIR); return false; }
    dens[i] -= add;
    return true; // the cell below is full: it carries the load
  }
  if (fy + 1 < H && blocksPlayer(j)) return true; // hard ground below
  return true;
}

/** Displace loose snow overlapping the body sideways (wading leaves a trench). Returns number of displaced cells. */
function wade(px: number, top: number, bottom: number): number {
  let n = 0;
  const x0 = Math.round(px - PW / 2), x1 = x0 + PW - 1;
  for (let y = top; y <= bottom; y++) for (let x = x0; x <= x1; x++) {
    if (!inb(x, y)) continue;
    const i = idx(x, y);
    if (!isGranular(i) || body[i]) continue;
    // push to the side away from the body centre; moves the cell's whole mass (cap 917), leftover stays
    const dir = x < px ? -1 : 1;
    const tx = dir < 0 ? x0 - 1 : x1 + 1;
    const mi = mat[i];
    let rem = dens[i];
    for (let up = 0; up < 8 && rem > 0; up++) {
      const ty = y - up; if (!inb(tx, ty)) break;
      const t = idx(tx, ty);
      if (body[t]) continue;
      if (mat[t] === M.AIR) { set(tx, ty, mi, rem, 10, F_DIST); rem = 0; }
      else if (mat[t] === mi && dens[t] < 400) {
        const add = Math.min(rem, 917 - dens[t]);
        if (add > 0) { dens[t] += add; rem -= add; wake(tx, ty); }
      }
    }
    if (rem <= 0) set(x, y, M.AIR);
    else if (rem !== dens[i]) dens[i] = rem;
    n++;
  }
  return n;
}

/** Rows of free headroom above the feet (capped at PH + 2). Body columns [xa, xb] count fully; `look` extra columns on each side count only when they are a passage
 *  (free for the first 8 rows above the feet) - a wall beside the hero is not a low ceiling. Granular snow and bough snow never count. */
function headroom(xa: number, xb: number, feetY: number, look = 3): number {
  const cap = PH + 2;
  const hard = (x: number, y: number) => { if (!inb(x, y)) return true; const i = idx(x, y); return !!body[i] || (blocksPlayer(i) && !isGranular(i) && !boughSnow(i)); };
  let best = cap;
  for (let x = xa - look; x <= xb + look; x++) {
    const core = x >= xa && x <= xb;
    if (!core) { let wall = false; for (let k = 1; k <= 8 && !wall; k++) wall = hard(x, feetY - k); if (wall) continue; }
    for (let k = 1; k <= best; k++) if (hard(x, feetY - k)) { best = k - 1; break; }
    if (best <= 0) return 0;
  }
  return best;
}
const FLOOR_Y = (y: number) => Math.round(y);

export interface MoveIn { moveX: number; jump: boolean; run: boolean; working: boolean; dt: number; }
export const events = { steps: [] as { dens: number; run: boolean; sink: number }[], landed: 0 };

export function stepPlayer(inp: MoveIn) {
  const dt = Math.min(0.033, inp.dt);
  events.steps.length = 0; events.landed = 0;
  if (!pl.alive) { pl.vx *= 0.9; return; }
  const tired = pl.stamina < 0.05;
  // crawling: under a ceiling lower than the full height (but >= 20 cells) the hero drops to a crawl (lookahead 3 cells each side); he stands up again as soon as there is room
  if (pl.onGround || pl.h < PH) {
    if (pl.onGround) {
      const xc0 = Math.round(pl.x - PW / 2);
      const room = headroom(xc0 + 1, xc0 + PW - 2, FLOOR_Y(pl.y));
      if (pl.h >= PH && room < PH) pl.h = PH_CRAWL;
      else if (pl.h < PH && room >= PH) pl.h = PH;
    }
  }
  const crawl = pl.h < PH;
  const run = inp.run && !tired && Math.abs(inp.moveX) > 0.1 && !crawl;
  const deep = pl.sink;
  let speed = (run ? 85 : 40) * (1 - deep * 0.45) * (pl.core < 33 ? 0.7 : 1) * (crawl ? 0.5 : 1); // cells/s (4.25 m/s run, 2 m/s walk, 1 m/s crawling)
  const target = inp.moveX * speed;
  const acc = pl.onGround ? 14 : 4;
  pl.vx += (target - pl.vx) * Math.min(1, dt * acc);
  if (Math.abs(inp.moveX) > 0.1) pl.face = inp.moveX > 0 ? 1 : -1;
  // gravity
  pl.vy += 196 * dt;
  if (inp.jump && pl.onGround && !crawl && pl.stamina > 0.08) { pl.vy = -JUMP_V * (1 - deep * 0.5); pl.onGround = false; pl.stamina -= 0.06; }
  // ---- horizontal move with step-up ----
  let nx = pl.x + pl.vx * dt;
  const dirx = Math.sign(nx - pl.x);
  const x00 = pl.x;
  let blockedSnow = false;
  blockKind = 0;
  if (dirx === 0) { pushT = 0; trunkT = 0; }
  if (dirx !== 0) {
    const lead = Math.round(nx + dirx * PW / 2 - (dirx > 0 ? 1 : 0));
    let blockedAt = -1;
    for (let y = Math.round(pl.y - pl.h); y < Math.round(pl.y); y++) {
      const i = inb(lead, y) ? idx(lead, y) : -1;
      if (i < 0) { blockedAt = y; break; }
      if (blocksPlayer(i) && !isGranular(i) && !boughSnow(i)) { blockedAt = y; break; }
      if (body[i]) { blockedAt = y; break; }
    }
    if (blockedAt >= 0) {
      const stepH = Math.round(pl.y) - blockedAt;
      // can we step up?
      let free = stepH <= 7;
      if (free) for (let y = Math.round(pl.y - pl.h - stepH); y < blockedAt; y++) if (solid(lead, y) && !isGranular(idx(lead, y)) && !boughSnow(idx(lead, y))) { free = false; break; }
      if (free) { pl.y -= stepH; pushT = 0; }
      else {
        // a thin snow pillar (<= 2 cells wide) in the way gives way after 0.3 s of pushing
        let thin = true, any = false;
        for (let y = Math.round(pl.y - pl.h); y < Math.round(pl.y) - 1; y++) {
          if (!inb(lead, y)) continue;
          const i = idx(lead, y);
          if (!blocksPlayer(i) || isGranular(i) || boughSnow(i)) continue;
          any = true;
          if (mat[i] !== M.SNOW || runW(lead, y) > 2) { thin = false; break; }
        }
        blockedSnow = any && mat[idx(lead, blockedAt)] === M.SNOW;
        // classify the obstacle (trunk wins: it has its own hint)
        for (let y = Math.round(pl.y - pl.h); y < Math.round(pl.y); y++) {
          if (!inb(lead, y)) continue;
          const i = idx(lead, y), m = mat[i];
          if (!blocksPlayer(i) || isGranular(i) || boughSnow(i)) continue;
          const k = m === M.WOOD && (flags[i] & F_TREE) ? 2 : m === M.SNOW ? 1 : (m === M.PLANK || m === M.WOOD || m === M.CRATE) ? 3 : 4;
          if (blockKind === 0 || k === 2 || (k === 3 && blockKind !== 2)) blockKind = k;
        }
        if (blockKind === 2 && Math.abs(inp.moveX) > 0.1) {
          trunkT += dt;
          if (trunkT > 0.25 && G.realTime - trunkMsgT > 4) { trunkMsgT = G.realTime; tool.msg = stepH <= 14 ? 'Ствол на пути — руби топором (3) или прыгай' : 'Ствол на пути — руби топором (3)'; }
        }
        if (any && thin && Math.abs(inp.moveX) > 0.1) {
          pushT += dt;
          if (pushT > 0.3) { pushT = 0; crumble(lead - dirx * 2, lead + dirx * 2, Math.round(pl.y - pl.h), Math.round(pl.y) - 2, false); }
        } else pushT = 0;
        if (blockKind !== 2) trunkT = 0;
        // push rigid bodies
        const bi = inb(lead, blockedAt) ? idx(lead, blockedAt) : -1;
        if (bi >= 0 && body[bi]) { const rec = bodyAtIndex(bi); if (rec) impulseAt(rec, lead, blockedAt, dirx * 30 * dt * 60, 0); }
        nx = pl.x; pl.vx = 0;
      }
    }
  }
  if (blockKind === 0) trunkT = 0;
  pl.x = Math.max(PW, Math.min(W - PW, nx));
  // wading through powder that overlaps the body
  const waded = wade(pl.x, Math.round(pl.y - pl.h), Math.round(pl.y) - 2);
  if (waded) { pl.vx *= Math.max(0.4, 1 - waded * 0.02); pl.snowOn = Math.min(1, pl.snowOn + waded * 0.0015); }
  // ---- vertical ----
  let ny = pl.y + pl.vy * dt;
  pl.onGround = false;
  const x0 = Math.round(pl.x - PW / 2), x1 = x0 + PW - 1;
  if (pl.vy >= 0) {
    // check cells from current feet to new feet
    const yA = Math.round(pl.y), yB = Math.round(ny);
    for (let y = yA; y <= yB; y++) {
      let hit = false, supported = 0;
      for (let x = x0 + 1; x <= x1 - 1; x++) {
        if (!inb(x, y)) { hit = true; supported++; continue; }
        const i = idx(x, y);
        if (blocksPlayer(i) || body[i]) {
          hit = true;
          if (mat[i] === M.SNOW && !body[i]) { if (compactUnder(x, y)) supported++; }
          else supported++;
        }
      }
      if (hit) {
        const fallSpeed = pl.vy;
        if (supported >= 3) {
          ny = y; if (fallSpeed > 40) events.landed = fallSpeed;
          pl.vy = 0; pl.onGround = true;
        } else { ny = Math.min(ny, y + 0.5); pl.vy = Math.min(pl.vy, 10); pl.onGround = true; }
        break;
      }
    }
  } else {
    const yA = Math.round(pl.y - pl.h), yB = Math.round(ny - pl.h);
    for (let y = yA; y >= yB; y--) {
      let hit = false;
      for (let x = x0 + 1; x <= x1 - 1; x++) if (solid(x, y) && !isGranular(idx(x, y)) && !boughSnow(idx(x, y))) { hit = true; break; }
      if (hit) { ny = y + 1 + pl.h; pl.vy = 0; break; }
    }
  }
  pl.y = Math.max(PH + 2, Math.min(H - 8, ny));
  // snow on boughs that the body overlaps loses its grip and falls; rigid snow overlapping the body means he is buried
  let buried = 0;
  {
    const yt = Math.round(pl.y - pl.h), yb = Math.round(pl.y) - 1;
    for (let y = yt; y <= yb; y++) for (let x = x0; x <= x1; x++) {
      if (!inb(x, y)) continue;
      const i = idx(x, y);
      if (mat[i] !== M.SNOW || body[i]) continue;
      if (boughSnow(i)) { bond[i] = 0; if (dens[i] > 400) dens[i] = 400; flags[i] |= F_DIST; wake(x, y); }
      else if (!isGranular(i) && y < yb - 1) buried++;
    }
  }
  // stuck: pressing a direction without moving for > 1 s, or sitting inside rigid snow -> loose/thin snow round the body crumbles
  const pressing = Math.abs(inp.moveX) > 0.1;
  if ((pressing && Math.abs(pl.x - x00) < dt * 3) || buried > 3) stuckT += dt; else stuckT = Math.max(0, stuckT - dt * 2);
  if (stuckT > 1) {
    const yt = Math.round(pl.y - pl.h), yb = Math.round(pl.y) - 1;
    const n = crumble(x0 - 2, x1 + 2, yt - 2, yb, false) + (buried > 3 ? crumble(x0 - 3, x1 + 3, yt - 1, yb - 1, true) : 0); // buried: also the 3-cell ring touching the body, whatever its density
    if (buried > 3) pl.vy = Math.min(pl.vy, -30);
    stuckT = buried > 3 ? 0.4 : -1;
    if ((n > 0 || buried > 3 || blockedSnow || blockKind > 0) && G.realTime - stuckMsgT > 4) {
      stuckMsgT = G.realTime;
      tool.msg = buried > 3 ? 'Застрял в снегу — копай вверх лопатой (1) или вбок'
        : blockKind === 2 ? 'Застрял: ствол — руби топором (3)'
        : blockKind === 3 ? 'Застрял: впереди брус — руби топором (3) или обойди'
        : blockKind === 4 ? 'Застрял: впереди камень или мёрзлая земля — лопатой не взять, копай снег выше или обойди'
        : 'Застрял: впереди плотный снег — копай лопатой (1) вперёд на уровне груди, ЛКМ';
    }
  }
  // depth in snow: fraction of body height surrounded by snow on both sides
  let snowCells = 0;
  for (let y = Math.round(pl.y - pl.h); y < Math.round(pl.y); y += 2) {
    const a = idx(Math.max(0, x0 - 1), y), b = idx(Math.min(W - 1, x1 + 1), y);
    if (mat[a] === M.SNOW || mat[b] === M.SNOW) snowCells++;
  }
  pl.sink += ((snowCells / (pl.h / 2)) - pl.sink) * Math.min(1, dt * 4);
  // footsteps
  if (pl.onGround && Math.abs(pl.vx) > 4) {
    pl.walkPhase += Math.abs(pl.vx) * dt * 0.09;
    pl.stepAcc += Math.abs(pl.vx) * dt;
    if (pl.stepAcc > (run ? 15 : 12)) {
      pl.stepAcc = 0;
      const fi = idx(Math.round(pl.x), Math.min(H - 1, Math.round(pl.y)));
      const dd = mat[fi] === M.SNOW ? dens[fi] : 600;
      pl.lastStepDens = dd;
      events.steps.push({ dens: dd, run, sink: pl.sink });
      if (dd < 300 && mat[fi] === M.SNOW) for (let k = 0, nk = run ? 3 : 2; k < nk; k++) spawn(PK.DUST, pl.x - pl.face * 3 + (Math.random() - 0.5) * 3, pl.y - 1, -pl.face * (4 + Math.random() * 14), -(6 + Math.random() * 14), 0.35 + Math.random() * 0.3, 0.9 + Math.random() * 0.5, 0, 0);   // snow kicked up by the boot
    }
  } else pl.walkPhase *= 0.9;
  // stamina
  if (run) pl.stamina -= dt * 0.07;
  else pl.stamina += dt * (inp.working ? 0.0 : 0.09) * (pl.core < 35 ? 0.5 : 1) * (pl.food > 0.02 ? 1 : 0.3) * (1 - 0.5 * pl.shiver);
  pl.stamina = Math.max(0, Math.min(1, pl.stamina));
  G.player.x = pl.x; G.player.y = pl.y; G.player.h = pl.h;
  pl.work = Math.max(0, pl.work - dt);
  if (inp.working) pl.work = 0.6;
  // breath vapour
  pl.breathT -= dt;
  if (pl.breathT <= 0) {
    pl.breathT = run ? 0.7 : 1.3 + Math.random() * 0.7;
    const hx = pl.x + pl.face * 4, hy = pl.y - pl.h + 6;
    const nb = pl.airT < -15 ? 8 : 5;
    for (let k = 0; k < nb; k++) spawn(PK.BREATH, hx + Math.random() * 2, hy + Math.random() * 2, pl.face * (8 + Math.random() * 12), -3 + Math.random() * 4, 1.4 + Math.random() * 0.9, 1, 0, 0);
  }
}

/** Environment Canada wind chill (T °C, V km/h). */
export function windChill(t: number, vKmh: number) {
  if (vKmh < 4.8) return t;
  const v = Math.pow(vKmh, 0.16);
  return 13.12 + 0.6215 * t - 11.37 * v + 0.3965 * t * v;
}

/** Single-node heat balance. dtGameS = game seconds. */
export function stepBody(dtReal: number, moving: number, running: boolean) {
  if (!pl.alive) return;
  const dtG = dtReal * 60 * G.timeScale;
  const tx = Math.round(pl.x), ty = Math.round(pl.y - pl.h * 0.6);
  pl.airT = tempAt(tx, ty);
  pl.wind = windAt(tx, ty - 6);
  pl.shelter = shelterAt(tx, ty);
  pl.feelT = windChill(pl.airT, Math.abs(pl.wind) * 3.6);
  // radiant heat from fires within view
  let rad = 0;
  for (const f of G.fires) {
    if (!f.lit) continue;
    const dx = (f.x - pl.x) * CELL, dy = (f.y - 6 - ty) * CELL;
    const d2 = dx * dx + dy * dy;
    if (d2 > 25) continue;
    let vis = 1;
    const steps = 12;
    for (let s = 1; s < steps; s++) {
      const sx = Math.round(pl.x + (f.x - pl.x) * s / steps), sy = Math.round(ty + (f.y - 6 - ty) * s / steps);
      if (inb(sx, sy) && blocksPlayer(idx(sx, sy))) vis *= 0.6;
    }
    rad += (f.power / 5000) * 260 * vis / (1 + d2 / 0.6);
  }
  pl.fireRad = rad;
  // metabolism (W)
  let met = 90;
  if (moving > 0.1) met = running ? 400 : 260;
  if (pl.work > 0) met += 330;
  pl.shiver = pl.core < SHIVER_ON && pl.food > 0.01 ? Math.min(1, (SHIVER_ON - pl.core) / SHIVER_RAMP) : 0;
  met += pl.shiver * SHIVER_W * (moving > 0.1 || pl.work > 0 ? 0.5 : 1); // exercise heat overlaps with shivering
  if (pl.food <= 0.001) met *= 0.6;
  // losses
  const insul = 1 + pl.wet * 1.4;
  const loss = (33 - pl.feelT) * LOSS_K * insul - rad;
  const net = met - loss;
  pl.core += (net * dtG) / 243000;
  pl.core = Math.min(37.4, pl.core);
  if (pl.core > 37.05 && net > 0) pl.core -= (pl.core - 37) * 0.15 * dtG / 60; // thermoregulation (sweating cap)
  // calories: 1 kcal = 4184 J
  // the bar is a rough fed/starving gauge, not literal kcal: FOOD_K stretches it so a normal day costs ~60 %; waiting (time compression) burns at the resting rate
  pl.food -= (Math.min(met, G.timeScale > 2 ? 90 + pl.shiver * SHIVER_W * 0.5 : 9999) * dtG * FOOD_K) / 4184 / 2000;
  pl.food = Math.max(0, pl.food);
  const hl = pl.food < 0.05 ? 0 : pl.food < 0.2 ? 1 : 2;
  if (hl < hungerLvl) { hungerLvl = hl; tool.msg = (hl === 0 ? 'Голод почти убил тебя' : 'Голод: осталось 20% сытости') + (inv.food + inv.crackers > 0 ? '. Q: съесть' : '. Еды нет — ищи ящики под оранжевыми вешками'); }
  else if (hl > hungerLvl && pl.food > 0.3) hungerLvl = hl;
  // snow on clothes melts when warm → wetness; dries near fire
  // by a fire in freezing air the melt is slow and most of it steams off in the heat (only a third soaks in); drying below always beats it, so standing at a fire never leaves you colder
  const nearFire = rad > 60 && pl.airT <= -1;
  const warm = pl.airT > -1 || rad > 60;
  if (warm && pl.snowOn > 0) { const m = Math.min(pl.snowOn, dtReal * G.timeScale * (nearFire ? 0.03 : 0.05)); pl.snowOn -= m; pl.wet = Math.min(1, pl.wet + m * (nearFire ? 0.3 : 0.9)); }
  else pl.snowOn = Math.max(0, pl.snowOn - dtReal * G.timeScale * 0.004); // brush off / sublimate
  if (G.snowfall > 0.02 && pl.shelter < 0.4) pl.snowOn = Math.min(1, pl.snowOn + dtReal * G.timeScale * G.snowfall * 0.03);
  if (rad > 40) pl.wet = Math.max(0, pl.wet - dtReal * G.timeScale * (0.004 + 0.012 * rad / 100));
  if (pl.core < 28) die(pl.feelT < pl.airT - 8 ? 'Переохлаждение. Ветер выдул тепло быстрее, чем тело успевало его вырабатывать.' : pl.wet > 0.4 ? 'Переохлаждение. Мокрая одежда перестала держать тепло.' : pl.food <= 0.01 ? 'Переохлаждение от истощения. Телу не из чего было греться.' : 'Переохлаждение. Мороз оказался сильнее.');
}

export function die(cause: string) { if (!pl.alive) return; pl.alive = false; pl.cause = cause; }

export function resetPlayer(x: number, y: number) {
  Object.assign(pl, { x, y, vx: 0, vy: 0, core: 37, food: 0.85, stamina: 1, wet: 0, snowOn: 0, snowshoes: false, alive: true, cause: '', sink: 0, h: PH }); G.player.h = PH; stuckT = 0; pushT = 0; trunkT = 0; hungerLvl = 2;
}
