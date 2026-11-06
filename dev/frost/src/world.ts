// World grid: 5 cm cells, y grows downward.
export const CELL = 0.05; // m
export const W = 2400;
export const H = 600;
export const CH = 32; // chunk size (cells)
export const CW = W / CH;
export const CHH = H / CH;
export const HS = 4; // heat cell = 4x4 cells (20 cm)
export const HW = W / HS;
export const HH = H / HS;

export const enum M {
  AIR = 0, SNOW = 1, ICE = 2, WATER = 3, DIRT = 4, ROCK = 5, WOOD = 6, NEEDLE = 7,
  ASH = 8, CRATE = 9, POLE = 10, PLANK = 11, BEDROCK = 12,
}
export const MAT_NAMES = ['воздух', 'снег', 'лёд', 'вода', 'мёрзлая земля', 'камень', 'дерево', 'хвоя', 'зола', 'ящик', 'вешка', 'брус', 'скала'];

// flags
export const F_DIST = 1;   // disturbed snow: sinters fast
export const F_WET = 2;    // wet snow / slush
export const F_TREE = 4;   // part of a standing tree
export const F_VERT = 8;   // vertical beam / grain orientation
export const F_DRIFT = 16; // wind-packed

export const BOND_SOLID = 48; // snow with bond >= this is rigid

export const mat = new Uint8Array(W * H);
export const dens = new Uint16Array(W * H);   // kg/m3 (snow, water...), fuel for wood
export const bond = new Uint8Array(W * H);
export const flags = new Uint8Array(W * H);
export const body = new Uint16Array(W * H);   // rigid body id stamped here (0 = none)
export const stamp = new Uint8Array(W * H);   // frame stamp to avoid double moves

// chunk bookkeeping
export const awake = new Uint8Array(CW * CHH);       // frames to stay awake
export const gpuDirty = new Uint8Array(CW * CHH);    // needs texture upload
export const solidVer = new Uint32Array(CW * CHH);   // bumps when rigid layout changes

export const idx = (x: number, y: number) => y * W + x;
export const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;

export function wake(x: number, y: number) {
  const cx = (x / CH) | 0, cy = (y / CH) | 0;
  for (let j = cy - 1; j <= cy + 1; j++) for (let i = cx - 1; i <= cx + 1; i++) {
    if (i < 0 || j < 0 || i >= CW || j >= CHH) continue;
    const c = j * CW + i; awake[c] = 90;
  }
  gpuDirty[cy * CW + cx] = 1;
}
export function touch(x: number, y: number) { gpuDirty[((y / CH) | 0) * CW + ((x / CH) | 0)] = 1; }
export function solidChanged(x: number, y: number) { solidVer[((y / CH) | 0) * CW + ((x / CH) | 0)]++; }

export function set(x: number, y: number, m: number, d = 0, b = 0, f = 0) {
  const i = y * W + x;
  const wasRigid = rigidAt(i);
  mat[i] = m; dens[i] = d; bond[i] = b; flags[i] = f;
  if (wasRigid !== rigidAt(i)) solidChanged(x, y);
  wake(x, y);
}
export function clear(x: number, y: number) { set(x, y, M.AIR); }

/** Rigid = holds shape, collides with rigid bodies, counts as structure. */
export function rigidAt(i: number): boolean {
  const m = mat[i];
  if (m === M.SNOW) return bond[i] >= BOND_SOLID || dens[i] >= 420;
  return m === M.ICE || m === M.DIRT || m === M.ROCK || m === M.WOOD || m === M.CRATE || m === M.POLE || m === M.PLANK || m === M.BEDROCK;
}
/** What the player cannot walk through. */
export function blocksPlayer(i: number): boolean {
  const m = mat[i];
  return m === M.SNOW || m === M.ICE || m === M.DIRT || m === M.ROCK || m === M.WOOD || m === M.CRATE || m === M.PLANK || m === M.BEDROCK || m === M.ASH;
}
export const isGranular = (i: number) => {
  const m = mat[i];
  return (m === M.SNOW && bond[i] < BOND_SOLID && dens[i] < 420) || m === M.ASH;
};

// ---------- deterministic noise ----------
let seed = 1337;
export function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
export function setSeed(s: number) { seed = s >>> 0; }
function hash1(n: number) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
export function noise1(x: number) { const i = Math.floor(x), f = x - i; const u = f * f * (3 - 2 * f); return hash1(i) * (1 - u) + hash1(i + 1) * u; }
export function fbm(x: number, oct = 4) { let a = 0.5, s = 0, n = 0; for (let o = 0; o < oct; o++) { s += a * noise1(x); n += a; x *= 2.03; a *= 0.5; } return s / n; }

export interface Crate { x: number; y: number; w: number; h: number; loot: string[]; opened: boolean; }
export interface TreeInfo { x: number; base: number; height: number; alive: boolean; }
export const crates: Crate[] = [];
export const trees: TreeInfo[] = [];
export const groundY = new Int16Array(W); // initial ground surface
export let START_X = 600;

function freshDens(tC: number) { return Math.round(67.9 + 51.25 * Math.exp(tC / 2.59)); }
export { freshDens };

export function generate(s = 20261106) {
  setSeed(s);
  mat.fill(0); dens.fill(0); bond.fill(0); flags.fill(0); body.fill(0);
  crates.length = 0; trees.length = 0;
  START_X = 560;
  // ground profile: rolling hills, a ridge, a frozen lake hollow
  const lakeA = 1500, lakeB = 1780;
  for (let x = 0; x < W; x++) {
    let g = 455 - (fbm(x * 0.0026, 5) - 0.5) * 120 - (fbm(x * 0.011 + 40, 3) - 0.5) * 22;
    // ridge
    g -= 70 * Math.exp(-(((x - 1100) / 160) ** 2));
    g -= 40 * Math.exp(-(((x - 2150) / 120) ** 2));
    // flatten start clearing
    const sc = Math.exp(-(((x - START_X) / 140) ** 2));
    g = g * (1 - sc) + 452 * sc;
    if (x > lakeA && x < lakeB) { const t = (x - lakeA) / (lakeB - lakeA); g += Math.sin(t * Math.PI) * 36; }
    // world edges: cliffs
    if (x < 40) g -= (40 - x) * 4; if (x > W - 40) g -= (x - (W - 40)) * 4;
    groundY[x] = Math.max(120, Math.min(H - 40, Math.round(g)));
  }
  const lakeLevel = Math.min(groundY[lakeA], groundY[lakeB]) + 4;
  for (let x = 0; x < W; x++) {
    const g = groundY[x];
    for (let y = g; y < H; y++) {
      const i = idx(x, y);
      const deep = y - g;
      if (y >= H - 6) { mat[i] = M.BEDROCK; continue; }
      const rocky = fbm(x * 0.05 + y * 0.07, 2) > 0.68 && deep > 6;
      mat[i] = rocky || deep > 70 ? M.ROCK : M.DIRT;
    }
    // frozen lake
    if (x > lakeA && x < lakeB && g > lakeLevel) {
      for (let y = lakeLevel; y < g; y++) { const i = idx(x, y); mat[i] = M.ICE; dens[i] = 917; }
    }
  }
  // snowpack: depth with drifts in the lee (east) of ridges, layered
  for (let x = 0; x < W; x++) {
    let top = groundY[x];
    for (let y = top - 1; y > 0; y--) { if (mat[idx(x, y)] === M.AIR) { top = y + 1; break; } }
    const slope = (groundY[Math.min(W - 1, x + 6)] - groundY[Math.max(0, x - 6)]) / 12; // >0: ground going down to the east (lee)
    let depth = 1.7 + (fbm(x * 0.008 + 7, 4) - 0.5) * 1.0 + Math.max(0, slope) * 2.2;
    depth += 1.6 * Math.exp(-(((x - 1250) / 90) ** 2)) + 1.4 * Math.exp(-(((x - 820) / 60) ** 2)) + 1.2 * Math.exp(-(((x - 2260) / 70) ** 2));
    if (x > lakeA && x < lakeB) depth *= 0.55;
    const cells = Math.max(6, Math.round(depth / CELL));
    for (let k = 0; k < cells; k++) {
      const y = top - 1 - k; if (y < 2) break;
      const i = idx(x, y);
      const fromTop = cells - k; // cells below the surface
      mat[i] = M.SNOW;
      if (fromTop <= 4) { dens[i] = 75 + ((rnd() * 20) | 0); bond[i] = 0; }
      else if (fromTop <= 9) { dens[i] = 150 + ((rnd() * 30) | 0); bond[i] = 30 + ((rnd() * 15) | 0); }
      else { const t = Math.min(1, (fromTop - 9) / 30); dens[i] = 230 + Math.round(t * 120 + rnd() * 25); bond[i] = 110 + Math.round(t * 120); if (slope > 0.15 || depth > 2) flags[i] |= F_DRIFT, dens[i] = Math.min(400, dens[i] + 40); }
      if (k === 0) { dens[i] = 260; bond[i] = 90; } // depth hoar-ish base
    }
  }
  // trees (spruce) in forest patches, not in the lake
  let x = 60;
  while (x < W - 60) {
    const forest = fbm(x * 0.004 + 99, 3);
    const gap = forest > 0.52 ? 26 + rnd() * 40 : 160 + rnd() * 220;
    x += gap | 0;
    if (x > W - 60 || (x > lakeA - 20 && x < lakeB + 20) || Math.abs(x - START_X) < 70) continue;
    plantTree(x, 110 + ((rnd() * 140) | 0));
  }
  // boulders
  for (let k = 0; k < 14; k++) {
    const bx = 80 + ((rnd() * (W - 160)) | 0); if (bx > lakeA && bx < lakeB) continue;
    const r = 6 + rnd() * 10, gy = groundY[bx];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r * 1.3; dx <= r * 1.3; dx++) {
      if ((dx / 1.3) ** 2 + dy * dy > r * r) continue;
      const xx = Math.round(bx + dx), yy = Math.round(gy + dy - r * 0.4);
      if (inb(xx, yy)) { const i = idx(xx, yy); mat[i] = M.ROCK; dens[i] = 0; bond[i] = 0; flags[i] = 0; }
    }
  }
  // supply crates with orange poles
  const loots: string[][] = [
    ['saw', 'food', 'matches'], ['food', 'food'], ['snowshoes', 'food'], ['matches', 'thermos'],
    ['food', 'crackers', 'crackers'], ['thermos', 'matches', 'food'], ['food', 'crackers'], ['matches', 'food', 'thermos'],
  ];
  const cx = [680, 980, 1300, 420, 1900, 2120, 230, 1620];
  for (let k = 0; k < cx.length; k++) placeCrate(cx[k], loots[k]);
  for (let i = 0; i < awake.length; i++) { awake[i] = 0; gpuDirty[i] = 1; }
}

function surfaceAt(x: number) { for (let y = 0; y < H; y++) if (mat[idx(x, y)] !== M.AIR && mat[idx(x, y)] !== M.NEEDLE) return y; return H; }
export { surfaceAt };

function placeCrate(x: number, loot: string[]) {
  const g = groundY[x];
  const w = 16, h = 11;
  // lay on the ground under the snow
  let base = g;
  for (let yy = g - 1; yy > 0; yy--) if (mat[idx(x, yy)] !== M.SNOW) { break; } else base = yy;
  const y0 = Math.max(base, g - 30) ; // crate sits on ground but may poke if snow is thin
  const top = g - h;
  for (let yy = top; yy < g; yy++) for (let xx = x; xx < x + w; xx++) { const i = idx(xx, yy); mat[i] = M.CRATE; dens[i] = 0; bond[i] = 0; flags[i] = 0; }
  void y0;
  crates.push({ x, y: top, w, h, loot: loot.slice(), opened: false });
  // pole sticks out of the snow ~1 m above surface
  const s = surfaceAt(x + 2);
  for (let yy = s - 24; yy < top; yy++) for (let xx = x + 2; xx < x + 4; xx++) { const i = idx(xx, yy); mat[i] = M.POLE; flags[i] = ((yy >> 2) & 1) ? F_VERT : 0; }
}

export function plantTree(x: number, h: number) {
  let base = groundY[x];
  const trunkW = Math.max(3, Math.round(h / 40));
  const top = base - h;
  for (let y = top; y < base; y++) {
    const t = (base - y) / h;
    const tw = Math.max(1, Math.round(trunkW * (1 - t * 0.7)));
    for (let dx = 0; dx < tw; dx++) { const xx = x - (tw >> 1) + dx; const i = idx(xx, y); mat[i] = M.WOOD; dens[i] = 500; flags[i] = F_TREE | F_VERT; bond[i] = 0; }
  }
  // tiers of branches (spruce): wider at bottom, start ~1/5 up
  const crownStart = base - Math.round(h * 0.18);
  for (let y = top + 2; y < crownStart; y++) {
    const t = (y - top) / (crownStart - top); // 0 top .. 1 bottom
    const tier = ((y - top) % 14) / 14;
    const half = Math.round((3 + t * h * 0.24) * (0.55 + 0.45 * (1 - tier)));
    for (let dx = -half; dx <= half; dx++) {
      const xx = x + dx; if (!inb(xx, y)) continue;
      const i = idx(xx, y);
      if (mat[i] !== M.AIR && mat[i] !== M.SNOW) continue;
      const droop = Math.abs(dx) / (half + 1);
      if (rnd() < 0.18 + droop * 0.35) continue;
      mat[i] = M.NEEDLE; dens[i] = 0; bond[i] = 0; flags[i] = F_TREE;
    }
  }
  // remove snow inside the crown (tree well) and load snow on boughs
  for (let y = top; y < base; y++) for (let dx = -30; dx <= 30; dx++) {
    const xx = x + dx; if (!inb(xx, y)) continue; const i = idx(xx, y);
    if (mat[i] === M.SNOW && y < base - 6 && Math.abs(dx) < h * 0.2) { mat[i] = M.AIR; dens[i] = 0; bond[i] = 0; }
  }
  for (let dx = -40; dx <= 40; dx++) {
    const xx = x + dx; if (!inb(xx, 0)) continue;
    for (let y = top - 1; y < base; y++) {
      const i = idx(xx, y), b = idx(xx, y + 1);
      if (mat[i] === M.AIR && mat[b] === M.NEEDLE) { for (let k = 0; k < 2; k++) { const j = idx(xx, y - k); if (mat[j] === M.AIR) { mat[j] = M.SNOW; dens[j] = 110; bond[j] = 20; } } break; }
      if (mat[i] !== M.AIR && mat[i] !== M.NEEDLE) break;
    }
  }
  trees.push({ x, base, height: h, alive: true });
}

export function cellMass(i: number) { return dens[i] * CELL; } // kg per m^2 of horizontal area (per cell column)
