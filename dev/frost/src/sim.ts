// Cellular snow simulation: granular flow, water, compaction (mass-conserving settlement),
// sintering, wind transport (saltation), snowfall deposition, particles.
import {
  W, H, CH, CW, CHH, M, F_DIST, F_WET, F_DRIFT, BOND_SOLID, mat, dens, bond, flags, body, stamp, awake, idx, inb,
  wake, touch, set, rigidAt, freshDens, CELL,
} from './world';
import { G } from './state';
import { P, PK, spawn, kill } from './particles';
import { tempAt, windAt, surf } from './heat';

let frameStamp = 1;
const pending = new Float32Array(W); // fresh snow (cells) waiting to be deposited per column (outside window)
const acc = new Float32Array(W);     // fractional deposit accumulator per column (inside window)

const isAirLike = (i: number) => mat[i] === M.AIR;
function canEnter(i: number, m: number) {
  const t = mat[i];
  if (body[i]) return false;
  if (t === M.AIR) return true;
  if (m !== M.WATER && t === M.WATER) return true; // heavier grains sink through water
  return false;
}
function swap(a: number, b: number) {
  const m = mat[a], d = dens[a], bo = bond[a], f = flags[a];
  mat[a] = mat[b]; dens[a] = dens[b]; bond[a] = bond[b]; flags[a] = flags[b];
  mat[b] = m; dens[b] = d; bond[b] = bo; flags[b] = f;
  stamp[a] = stamp[b] = frameStamp;
}
function wakeI(i: number) { const x = i % W, y = (i / W) | 0; wake(x, y); }

/** Fast pass: granular snow, ash and water motion in awake chunks within the window. */
function stepCA() {
  frameStamp = (frameStamp + 1) & 255 || 1;
  const { x0, y0, x1, y1 } = G.win;
  const cx0 = Math.max(0, (x0 / CH) | 0), cx1 = Math.min(CW - 1, (x1 / CH) | 0);
  const cy0 = Math.max(0, (y0 / CH) | 0), cy1 = Math.min(CHH - 1, (y1 / CH) | 0);
  const dirFlip = (G.frame & 1) === 0;
  for (let cy = cy1; cy >= cy0; cy--) {
    for (let k = 0; k <= cx1 - cx0; k++) {
      const cx = dirFlip ? cx0 + k : cx1 - k;
      const c = cy * CW + cx;
      if (awake[c] === 0) continue;
      awake[c]--;
      let moved = false;
      const yy0 = cy * CH, yy1 = Math.min(H - 2, yy0 + CH - 1);
      const xx0 = cx * CH, xx1 = Math.min(W - 2, xx0 + CH - 1);
      for (let y = yy1; y >= yy0; y--) {
        const ltr = ((y + G.frame) & 1) === 0;
        for (let q = 0; q <= xx1 - xx0; q++) {
          const x = ltr ? xx0 + q : xx1 - q;
          if (x < 1) continue;
          const i = y * W + x;
          const m = mat[i];
          if (m === M.AIR || stamp[i] === frameStamp || body[i]) continue;
          if (m === M.SNOW) {
            if (bond[i] >= BOND_SOLID || dens[i] >= 420) continue;
            if (moveGrain(i, x, y, m)) moved = true;
          } else if (m === M.ASH) { if (moveGrain(i, x, y, m)) moved = true; }
          else if (m === M.WATER) { if (moveWater(i, x, y)) moved = true; }
        }
      }
      if (moved) { awake[c] = Math.max(awake[c], 20); gpuMark(cx, cy); }
    }
  }
}
function gpuMark(cx: number, cy: number) { touch(cx * CH, cy * CH); }

function moveGrain(i: number, x: number, y: number, m: number): boolean {
  const below = i + W;
  // fall (up to 2 cells per frame)
  if (canEnter(below, m)) {
    let j = below;
    if (y + 2 < H && canEnter(j + W, m)) j += W;
    swap(i, j); wakeI(j); wakeI(i); return true;
  }
  // cohesion: dry cold fresh snow slides freely (angle of repose ~38°), bonded/wet snow holds steeper
  const b = bond[i];
  const wet = (flags[i] & F_WET) !== 0;
  let p = 1 - b / BOND_SOLID; // 1 .. 0
  if (wet) p *= 0.25;
  if (m === M.ASH) p = 0.9;
  if (p <= 0.02) return false;
  if (Math.random() > p) return false;
  const d = Math.random() < 0.5 ? -1 : 1;
  for (let s = 0; s < 2; s++) {
    const dx = s === 0 ? d : -d;
    const side = i + dx, diag = below + dx;
    if (canEnter(side, m) && canEnter(diag, m)) { swap(i, diag); wakeI(diag); wakeI(i); return true; }
  }
  // lateral creep only for very loose snow -> repose slightly below 45°
  if (p > 0.85 && Math.random() < 0.18) {
    for (let s = 0; s < 2; s++) {
      const dx = s === 0 ? d : -d;
      const side = i + dx;
      if (x + 2 * dx < 1 || x + 2 * dx >= W - 1) continue;
      if (canEnter(side, m) && canEnter(side + W, m) === false && canEnter(i + 2 * dx + W, m)) { swap(i, side); wakeI(side); return true; }
    }
  }
  return false;
}

function moveWater(i: number, x: number, y: number): boolean {
  const below = i + W;
  const bm = mat[below];
  if (bm === M.AIR && !body[below]) { swap(i, below); wakeI(below); wakeI(i); return true; }
  // soak into loose snow -> slush
  if (bm === M.SNOW && bond[below] < 200 && dens[below] < 520) {
    dens[below] = Math.min(600, dens[below] + 220); flags[below] |= F_WET; bond[below] = Math.min(255, bond[below] + 30);
    mat[i] = M.AIR; dens[i] = 0; flags[i] = 0; wakeI(i); return true;
  }
  const d = Math.random() < 0.5 ? -1 : 1;
  for (let s = 0; s < 2; s++) {
    const dx = s === 0 ? d : -d;
    if (mat[below + dx] === M.AIR && mat[i + dx] === M.AIR && !body[below + dx]) { swap(i, below + dx); wakeI(below + dx); return true; }
  }
  for (let s = 0; s < 2; s++) {
    const dx = s === 0 ? d : -d;
    for (let r = 1; r <= 3; r++) {
      const j = i + dx * r;
      if (x + dx * r < 1 || x + dx * r >= W - 1) break;
      if (mat[j] !== M.AIR || body[j]) break;
      if (r === 3 || mat[j + W] === M.AIR) { swap(i, j); wakeI(j); return true; }
    }
  }
  return false;
}

// ---------- slow pass: compaction + sintering over the window, staggered ----------
let slowRow = 0;
const SLOW_SLICES = 10; // each cell visited every 10 frames
function stepSlow(dtReal: number) {
  const { x0, y0, x1, y1 } = G.win;
  const dtGameH = (dtReal * SLOW_SLICES * 60 * G.timeScale) / 3600; // game hours since this cell was visited
  slowRow = (slowRow + 1) % SLOW_SLICES;
  const xa = Math.max(1, x0), xb = Math.min(W - 2, x1);
  const ya = Math.max(1, y0), yb = Math.min(H - 2, y1);
  for (let x = xa + slowRow; x <= xb; x += SLOW_SLICES) {
    // scan column from top: running overburden load (kg/m²)
    let load = 0;
    for (let y = ya; y <= yb; y++) {
      const i = y * W + x;
      const m = mat[i];
      if (m === M.AIR || m === M.NEEDLE) { load = 0; continue; }
      if (m !== M.SNOW || body[i]) { if (m === M.WATER) load += 50; else load += 20; continue; }
      const d = dens[i];
      load += d * CELL;
      const T = tempAt(x, y);
      const Tc = Math.min(0, T);
      // --- sintering: Arrhenius-like, fastest near 0..-5 °C, slow when very cold ---
      if (bond[i] < 255) {
        const arr = Math.exp(0.085 * (Tc + 5)); // -5 → 1, -30 → 0.12
        let rate = 70 * arr * (0.4 + d / 350); // bond units per game hour
        if (flags[i] & F_DIST) rate *= 2.6;   // mixing different-temperature grains sinters fast (quinzhee)
        if (flags[i] & F_DRIFT) rate *= 1.6;
        if (flags[i] & F_WET && T < 0) rate *= 4;
        // only sinter when resting on something (no free-falling grains)
        const bm = mat[i + W];
        if (bm !== M.AIR) {
          const nb = Math.min(255, bond[i] + rate * dtGameH + Math.random());
          const was = bond[i] >= BOND_SOLID;
          bond[i] = nb | 0;
          if (!was && bond[i] >= BOND_SOLID) { wake(x, y); }
        }
      }
      // --- compaction: transfer mass from this cell into the one below if below is under-dense ---
      const j = i + W;
      if (mat[j] === M.SNOW && !body[j]) {
        const target = Math.min(560, 140 + 135 * Math.log10(1 + load / 4)); // kg/m³ for given overburden
        const dj = dens[j];
        if (dj < target) {
          const visc = Math.exp(0.07 * (Tc + 5)) * (1 + (flags[j] & F_WET ? 3 : 0));
          let dd = Math.min(target - dj, (target - dj) * 0.35 * visc * dtGameH + 0.5);
          dd = Math.min(dd, d);
          if (dd >= 1) {
            dens[j] = dj + dd;
            const left = d - dd;
            if (left < 22) { // top cell has collapsed into the one below
              dens[j] = Math.min(917, dens[j] + left);
              mat[i] = M.AIR; dens[i] = 0; bond[i] = 0; flags[i] = 0;
              wake(x, y);
            } else dens[i] = left;
            touch(x, y);
          }
        }
      }
      if ((flags[i] & F_DIST) && bond[i] > 200) flags[i] &= ~F_DIST;
    }
  }
}

// ---------- snowfall & wind ----------
let flakeAcc = 0;
function stepWeather(dt: number) {
  const { x0, x1, y0 } = G.win;
  const gs = 60 * G.timeScale;
  const cellsPerSecPerCol = (G.snowfall / CELL) * (gs / 3600); // fresh snow cells per column per real second
  // outside window: accumulate statistically
  for (let x = 0; x < W; x += 1) {
    if (x >= x0 && x <= x1) continue;
    pending[x] += cellsPerSecPerCol * dt * (0.8 + 0.4 * Math.random());
  }
  // visual + mass-carrying flakes in window
  const cols = x1 - x0;
  const flakeRate = cols * (0.35 + G.snowfall * 25) * (G.quality ? 1 : 0.5) * Math.min(4, G.timeScale);
  flakeAcc += flakeRate * dt;
  const massPerFlake = (cellsPerSecPerCol * cols) / Math.max(1, flakeRate);
  const top = Math.max(0, y0 - 10);
  const wind = G.wind;
  while (flakeAcc > 1) {
    flakeAcc -= 1;
    const r = Math.random();
    const layer = r < 0.62 ? 0 : r < 0.92 ? 1 : 2;
    const x = x0 - wind * 6 + Math.random() * (cols + Math.abs(wind) * 12);
    const fall = 14 + Math.random() * 14; // 0.7–1.4 m/s
    spawn(PK.FLAKE, x, top + Math.random() * 30, wind * 20 * 0.8, fall, 40, layer === 0 ? massPerFlake * 1.6 : 0, 0, layer);
  }
  // deposit pending for columns entering the window
  for (let x = Math.max(1, x0); x < Math.min(W - 1, x1); x++) {
    if (pending[x] >= 1) {
      let n = Math.floor(pending[x]); pending[x] -= n;
      while (n-- > 0) depositAt(x, freshDens(G.ambientT), 0);
    }
  }
  // saltation: lift surface powder in strong local wind
  const tries = (cols * 0.12) | 0;
  for (let k = 0; k < tries; k++) {
    const x = (x0 + Math.random() * cols) | 0; if (x < 2 || x > W - 3) continue;
    const y = surf[x]; if (y <= 1 || y >= H - 2) continue;
    const i = idx(x, y);
    if (mat[i] !== M.SNOW || body[i] || mat[i - W] !== M.AIR) continue;
    const u = Math.abs(windAt(x, y - 2));
    const thr = 5 + (bond[i] / 255) * 9 + Math.max(0, dens[i] - 100) / 60;
    if (u < thr) continue;
    if (Math.random() > (u - thr) * 0.25 * dt * 10) continue;
    const d = dens[i];
    set(x, y, M.AIR);
    spawn(PK.DRIFT, x, y - 1, Math.sign(G.wind) * u * 20 * 0.5, -(10 + Math.random() * 30), 6, 1, d, 0);
  }
}

/** Put one cell of snow on top of column x (at the first air cell above the surface found from y hint). */
export function depositAt(x: number, d: number, fl: number, yHint = -1) {
  if (x < 1 || x >= W - 1) return;
  let y = yHint >= 0 ? yHint : Math.max(1, surf[x] - 1);
  // find first air cell scanning up from hint if occupied, or down if floating
  let i = idx(x, y);
  if (mat[i] !== M.AIR) { while (y > 1 && mat[idx(x, y)] !== M.AIR) y--; }
  else { while (y < H - 2 && mat[idx(x, y + 1)] === M.AIR) y++; }
  i = idx(x, y);
  if (mat[i] !== M.AIR || body[i]) return;
  set(x, y, M.SNOW, d, 0, fl | F_DIST * 0);
  if (surf[x] > y) surf[x] = y;
}

// ---------- particles ----------
export function stepParticles(dt: number) {
  const g = 196; // cells/s² (9.8 m/s²)
  for (let i = 0; i < P.n; i++) {
    P.life[i] -= dt;
    if (P.life[i] <= 0) { kill(i); i--; continue; }
    const k = P.kind[i];
    let x = P.x[i], y = P.y[i];
    if (k === PK.FLAKE) {
      const s = P.seed[i];
      const u = P.layer[i] === 0 ? windAt(x | 0, y | 0) : G.wind;
      const tvx = u * 20 + Math.sin(G.realTime * (1.5 + s * 2) + s * 40) * 8; // flutter
      P.vx[i] += (tvx - P.vx[i]) * Math.min(1, dt * 3);
      x += P.vx[i] * dt; y += P.vy[i] * dt * (P.layer[i] === 2 ? 1.6 : 1);
      P.x[i] = x; P.y[i] = y;
      if (P.layer[i] !== 0) { if (y > G.win.y1 + 40) { kill(i); i--; } continue; }
      const cx = x | 0, cy = y | 0;
      if (!inb(cx, cy) || cy >= H - 2) { kill(i); i--; continue; }
      const c = idx(cx, cy);
      if (mat[c] !== M.AIR) {
        // landed: add mass to the column accumulator (boughs catch snow too)
        acc[cx] += P.m[i];
        if (acc[cx] >= 1) { acc[cx] -= 1; depositAt(cx, freshDens(G.ambientT), 0, cy - 1); }
        kill(i); i--; continue;
      }
      continue;
    }
    if (k === PK.DRIFT || k === PK.CLUMP) {
      const u = windAt(x | 0, y | 0) * 20;
      if (k === PK.DRIFT) P.vx[i] += (u - P.vx[i]) * Math.min(1, dt * 4);
      P.vy[i] += g * dt * (k === PK.DRIFT ? 0.35 : 1);
      const nx = x + P.vx[i] * dt, ny = y + P.vy[i] * dt;
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(nx - x), Math.abs(ny - y))));
      let landed = false;
      for (let s = 1; s <= steps; s++) {
        const px = x + ((nx - x) * s) / steps, py = y + ((ny - y) * s) / steps;
        const cx = px | 0, cy = py | 0;
        if (!inb(cx, cy) || cy >= H - 2 || cx < 1 || cx >= W - 1) { landed = true; break; }
        const c = idx(cx, cy);
        if (mat[c] !== M.AIR || body[c]) {
          const px0 = (x + ((nx - x) * (s - 1)) / steps) | 0, py0 = (y + ((ny - y) * (s - 1)) / steps) | 0;
          // drift settles only where wind drops (lee) — else bounce on
          const lu = Math.abs(windAt(px0, py0));
          if (k === PK.DRIFT && lu > 6 && Math.random() < 0.7 && P.life[i] > 0.5) { P.vy[i] = -Math.abs(P.vy[i]) * 0.5 - 8; P.x[i] = px0; P.y[i] = py0 - 1; landed = false; s = steps + 1; break; }
          if (inb(px0, py0) && mat[idx(px0, py0)] === M.AIR) {
            const dd = k === PK.DRIFT ? Math.max(P.d[i], 260) : P.d[i];
            set(px0, py0, M.SNOW, Math.min(400, dd), 0, F_DIST | (k === PK.DRIFT ? F_DRIFT : 0));
          }
          landed = true; break;
        }
      }
      if (landed) { kill(i); i--; continue; }
      if (P.life[i] < 0.05 && k === PK.DRIFT) { // ran out of time aloft: deposit where it is
        const cx = nx | 0, cy = ny | 0;
        if (inb(cx, cy) && mat[idx(cx, cy)] === M.AIR) depositAt(cx, Math.max(P.d[i], 250), F_DRIFT | F_DIST, cy);
        kill(i); i--; continue;
      }
      P.x[i] = nx; P.y[i] = ny;
      continue;
    }
    // decorative particles
    if (k === PK.SMOKE || k === PK.STEAM || k === PK.BREATH) {
      const u = windAt(x | 0, y | 0) * 20;
      P.vx[i] += (u * 0.7 - P.vx[i]) * dt * 1.5;
      P.vy[i] += (-14 - P.vy[i]) * dt * (k === PK.BREATH ? 0.5 : 1);
    } else if (k === PK.FLAME) {
      P.vy[i] -= 60 * dt; P.vx[i] *= 1 - dt * 3;
    } else if (k === PK.SPARK) {
      P.vy[i] -= 30 * dt; P.vx[i] += (windAt(x | 0, y | 0) * 20 - P.vx[i]) * dt;
    } else { // CHIP, DUST
      P.vy[i] += g * dt * (k === PK.DUST ? 0.15 : 1);
      P.vx[i] += (windAt(x | 0, y | 0) * 20 - P.vx[i]) * dt * (k === PK.DUST ? 2 : 0.2);
      const c = idx(Math.max(0, Math.min(W - 1, x | 0)), Math.max(0, Math.min(H - 1, y | 0)));
      if (k === PK.CHIP && mat[c] !== M.AIR) { P.vx[i] = 0; P.vy[i] = 0; P.life[i] = Math.min(P.life[i], 0.6); }
    }
    P.x[i] = x + P.vx[i] * dt; P.y[i] = y + P.vy[i] * dt;
  }
}

export function stepSim(dt: number) {
  stepWeather(dt);
  stepCA();
  stepSlow(dt);
  stepParticles(dt);
}

export { rigidAt, isAirLike };
