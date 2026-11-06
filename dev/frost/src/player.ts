// Player controller (cells, y down) + body heat balance.
import { W, H, M, mat, dens, bond, flags, body, idx, inb, set, wake, blocksPlayer, isGranular, F_DIST, CELL } from './world';
import { G } from './state';
import { tempAt, windAt, shelterAt } from './heat';
import { spawn, PK } from './particles';
import { bodyAtIndex, impulseAt } from './phys';

export const pl = {
  x: 600, y: 380, vx: 0, vy: 0, face: 1, onGround: false,
  sink: 0,          // 0..1 how deep in snow (fraction of height)
  core: 37, food: 0.72, stamina: 1, wet: 0, snowOn: 0,
  snowshoes: false, alive: true, cause: '', work: 0, walkPhase: 0, stepAcc: 0,
  feelT: -20, airT: -20, wind: 0, shelter: 0, shiver: 0, fireRad: 0,
  breathT: 0, lastStepDens: 100,
};
export const PW = 10, PH = 34;

function solid(x: number, y: number) {
  if (!inb(x, y)) return true;
  return blocksPlayer(idx(x, y));
}

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

export interface MoveIn { moveX: number; jump: boolean; run: boolean; working: boolean; dt: number; }
export const events = { steps: [] as { dens: number; run: boolean; sink: number }[], landed: 0 };

export function stepPlayer(inp: MoveIn) {
  const dt = Math.min(0.033, inp.dt);
  events.steps.length = 0; events.landed = 0;
  if (!pl.alive) { pl.vx *= 0.9; return; }
  const tired = pl.stamina < 0.05;
  const run = inp.run && !tired && Math.abs(inp.moveX) > 0.1;
  const deep = pl.sink;
  let speed = (run ? 80 : 34) * (1 - deep * 0.55) * (pl.core < 33 ? 0.7 : 1); // cells/s (4 m/s run, 1.7 walk)
  const target = inp.moveX * speed;
  const acc = pl.onGround ? 14 : 4;
  pl.vx += (target - pl.vx) * Math.min(1, dt * acc);
  if (Math.abs(inp.moveX) > 0.1) pl.face = inp.moveX > 0 ? 1 : -1;
  // gravity
  pl.vy += 196 * dt;
  if (inp.jump && pl.onGround && pl.stamina > 0.08) { pl.vy = -64 * (1 - deep * 0.5); pl.onGround = false; pl.stamina -= 0.06; }
  // ---- horizontal move with step-up ----
  let nx = pl.x + pl.vx * dt;
  const dirx = Math.sign(nx - pl.x);
  if (dirx !== 0) {
    const lead = Math.round(nx + dirx * PW / 2 - (dirx > 0 ? 1 : 0));
    let blockedAt = -1;
    for (let y = Math.round(pl.y - PH); y < Math.round(pl.y); y++) {
      const i = inb(lead, y) ? idx(lead, y) : -1;
      if (i < 0) { blockedAt = y; break; }
      if (blocksPlayer(i) && !isGranular(i)) { blockedAt = y; break; }
      if (body[i]) { blockedAt = y; break; }
    }
    if (blockedAt >= 0) {
      const stepH = Math.round(pl.y) - blockedAt;
      // can we step up?
      let free = stepH <= 7;
      if (free) for (let y = Math.round(pl.y - PH - stepH); y < blockedAt; y++) if (solid(lead, y) && !isGranular(idx(lead, y))) { free = false; break; }
      if (free) { pl.y -= stepH; }
      else {
        // push rigid bodies
        const bi = inb(lead, blockedAt) ? idx(lead, blockedAt) : -1;
        if (bi >= 0 && body[bi]) { const rec = bodyAtIndex(bi); if (rec) impulseAt(rec, lead, blockedAt, dirx * 30 * dt * 60, 0); }
        nx = pl.x; pl.vx = 0;
      }
    }
  }
  pl.x = Math.max(PW, Math.min(W - PW, nx));
  // wading through powder that overlaps the body
  const waded = wade(pl.x, Math.round(pl.y - PH), Math.round(pl.y) - 2);
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
    const yA = Math.round(pl.y - PH), yB = Math.round(ny - PH);
    for (let y = yA; y >= yB; y--) {
      let hit = false;
      for (let x = x0 + 1; x <= x1 - 1; x++) if (solid(x, y) && !isGranular(idx(x, y))) { hit = true; break; }
      if (hit) { ny = y + 1 + PH; pl.vy = 0; break; }
    }
  }
  pl.y = Math.max(PH + 2, Math.min(H - 8, ny));
  // depth in snow: fraction of body height surrounded by snow on both sides
  let snowCells = 0;
  for (let y = Math.round(pl.y - PH); y < Math.round(pl.y); y += 2) {
    const a = idx(Math.max(0, x0 - 1), y), b = idx(Math.min(W - 1, x1 + 1), y);
    if (mat[a] === M.SNOW || mat[b] === M.SNOW) snowCells++;
  }
  pl.sink += ((snowCells / (PH / 2)) - pl.sink) * Math.min(1, dt * 4);
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
    }
  } else pl.walkPhase *= 0.9;
  // stamina
  if (run) pl.stamina -= dt * 0.07;
  else pl.stamina += dt * (inp.working ? 0.0 : 0.09) * (pl.core < 35 ? 0.5 : 1) * (pl.food > 0.02 ? 1 : 0.3);
  pl.stamina = Math.max(0, Math.min(1, pl.stamina));
  G.player.x = pl.x; G.player.y = pl.y;
  pl.work = Math.max(0, pl.work - dt);
  if (inp.working) pl.work = 0.6;
  // breath vapour
  pl.breathT -= dt;
  if (pl.breathT <= 0) {
    pl.breathT = run ? 0.9 : 2.2 + Math.random();
    const hx = pl.x + pl.face * 4, hy = pl.y - PH + 6;
    for (let k = 0; k < 4; k++) spawn(PK.BREATH, hx, hy, pl.face * (10 + Math.random() * 8), -2 + Math.random() * 3, 1.4, 1, 0, 0);
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
  const tx = Math.round(pl.x), ty = Math.round(pl.y - PH * 0.6);
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
  if (moving > 0.1) met = running ? 380 : 220;
  if (pl.work > 0) met += 330;
  pl.shiver = pl.core < 36.6 && pl.food > 0.01 ? Math.min(1, (36.6 - pl.core) / 1.5) : 0;
  met += pl.shiver * 200;
  if (pl.food <= 0.001) met *= 0.6;
  // losses
  const insul = 1 + pl.wet * 1.4;
  const loss = (33 - pl.feelT) * 4.3 * insul - rad;
  const net = met - loss;
  pl.core += (net * dtG) / 243000;
  pl.core = Math.min(37.4, pl.core);
  if (pl.core > 37.05 && net > 0) pl.core -= (pl.core - 37) * 0.02 * dtG / 60; // thermoregulation (sweating cap)
  // calories: 1 kcal = 4184 J
  pl.food -= (met * dtG) / 4184 / 2000;
  pl.food = Math.max(0, pl.food);
  // snow on clothes melts when warm → wetness; dries near fire
  const warm = pl.airT > -1 || rad > 60;
  if (warm && pl.snowOn > 0) { const m = Math.min(pl.snowOn, dtReal * G.timeScale * 0.05); pl.snowOn -= m; pl.wet = Math.min(1, pl.wet + m * 0.9); }
  else pl.snowOn = Math.max(0, pl.snowOn - dtReal * G.timeScale * 0.004); // brush off / sublimate
  if (G.snowfall > 0.02 && pl.shelter < 0.4) pl.snowOn = Math.min(1, pl.snowOn + dtReal * G.timeScale * G.snowfall * 0.03);
  if (rad > 40) pl.wet = Math.max(0, pl.wet - dtReal * 0.004 * (rad / 100) * G.timeScale);
  if (pl.core < 28) die(pl.feelT < pl.airT - 8 ? 'Переохлаждение. Ветер выдул тепло быстрее, чем тело успевало его вырабатывать.' : pl.wet > 0.4 ? 'Переохлаждение. Мокрая одежда перестала держать тепло.' : pl.food <= 0.01 ? 'Переохлаждение от истощения. Телу не из чего было греться.' : 'Переохлаждение. Мороз оказался сильнее.');
}

export function die(cause: string) { if (!pl.alive) return; pl.alive = false; pl.cause = cause; }

export function resetPlayer(x: number, y: number) {
  Object.assign(pl, { x, y, vx: 0, vy: 0, core: 37, food: 0.72, stamina: 1, wet: 0, snowOn: 0, snowshoes: false, alive: true, cause: '', sink: 0 });
}
