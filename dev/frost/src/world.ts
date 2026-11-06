// World grid: 5 cm cells, y grows downward.
export const CELL = 0.05; // m
export const W = 2400;
export const H = 608;
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
export const treeId = new Uint16Array(W * H); // unique id (1..) of the standing tree a trunk/needle cell belongs to; 0 = none
export const beamId = new Uint16Array(W * H); // unique id (1..) of the placed beam (PLANK) a cell belongs to; 0 = none
let beamSeq = 0;
/** next beam id (1..65535, wraps, never 0) */
export function nextBeamId(): number { beamSeq = beamSeq >= 65535 ? 1 : beamSeq + 1; return beamSeq; }

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
  if (mat[i] !== m || !(f & F_TREE)) treeId[i] = 0; // a cell that changes material is no longer part of a standing tree
  mat[i] = m; dens[i] = d; bond[i] = b; flags[i] = f;
  beamId[i] = 0; // callers that place a beam stamp beamId after set()
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
const DRIFT_DX = 190; // big lee drift (dugout site) this far east of the start
let DRIFT_X = 750;

function freshDens(tC: number) { return Math.round(67.9 + 51.25 * Math.exp(tC / 2.59)); }
export { freshDens };

export function generate(s = 20261106) {
  setSeed(s);
  mat.fill(0); dens.fill(0); bond.fill(0); flags.fill(0); body.fill(0); treeId.fill(0); beamId.fill(0);
  crates.length = 0; trees.length = 0;
  START_X = 560; DRIFT_X = START_X + DRIFT_DX;
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
      const rocky = (fbm(x * 0.021 + 13.7, 3) * 0.6 + fbm(y * 0.09 + x * 0.004 + 71.3, 2) * 0.4) > 0.66 && deep > 6;
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
    const driftK = Math.exp(-(((x - DRIFT_X) / (x < DRIFT_X ? 75 : 48)) ** 2));
    const slope = (groundY[Math.min(W - 1, x + 6)] - groundY[Math.max(0, x - 6)]) / 12; // >0: ground going down to the east (lee)
    let depth = 2.3 + (fbm(x * 0.008 + 7, 4) - 0.5) * 1.4 + Math.max(0, slope) * 2.6;
    depth += 2.0 * Math.exp(-(((x - 1250) / 90) ** 2)) + 1.8 * Math.exp(-(((x - 820) / 60) ** 2)) + 1.6 * Math.exp(-(((x - 2260) / 70) ** 2));
    // big lee drift for a dugout near the start: gentle windward ramp (west), steeper lee face (east); total depth ~3.2-3.5 m at the crest
    depth = depth * (1 - driftK) + (3.25 + (fbm(x * 0.03 + 3, 2) - 0.5) * 0.5) * driftK; // blend toward a ~3.0-3.5 m deep drift (ground slope no longer adds on top)
    if (x > lakeA && x < lakeB) depth *= 0.55;
    const cells = Math.max(6, Math.round(depth / CELL));
    for (let k = 0; k < cells; k++) {
      const y = top - 1 - k; if (y < 2) break;
      const i = idx(x, y);
      const fromTop = cells - k; // cells below the surface
      mat[i] = M.SNOW;
      if (fromTop <= 4) { dens[i] = 75 + ((rnd() * 20) | 0); bond[i] = 0; }
      else if (fromTop <= 24) { dens[i] = 190 + ((rnd() * 40) | 0); bond[i] = 60 + ((rnd() * 30) | 0); } // cuttable middle layer (saw works once the top ~20 cm of powder is dug off)
      else {
        const t = Math.min(1, (fromTop - 24) / 30); dens[i] = 235 + Math.round(t * 115 + rnd() * 25); bond[i] = 115 + Math.round(t * 115);
        if (slope > 0.15 || depth > 2) flags[i] |= F_DRIFT, dens[i] = Math.min(400, dens[i] + 40);
        if (driftK > 0.25) bond[i] = Math.max(bond[i], 140 + Math.round(t * 60)); // well sintered lower part: a dug cave holds
      }
      if (k === 0) { dens[i] = 260; bond[i] = 90; } // depth hoar-ish base
    }
  }
  // trees (spruce) in forest patches, not in the lake
  let x = 60;
  while (x < W - 60) {
    const forest = fbm(x * 0.004 + 99, 3);
    const gap = forest > 0.52 ? 26 + rnd() * 40 : 160 + rnd() * 220;
    x += gap | 0;
    if (x > W - 60 || (x > lakeA - 20 && x < lakeB + 20) || Math.abs(x - START_X) < 70 || Math.abs(x - DRIFT_X) < 110) continue;
    plantTree(x, 110 + ((rnd() * 140) | 0));
  }
  // boulders: few, irregular, resting on the ground; a wind-scoured hollow in the snow lets the crown of each one stick out (rendered as lit rock)
  {
    const placed: number[] = [];
    for (let att = 0; att < 120 && placed.length < 5; att++) {
      const bx = 120 + ((rnd() * (W - 240)) | 0), pick = rnd(), hb = 15 + ((rnd() * 13) | 0), seedB = rnd() * 100;
      if (bx > lakeA - 50 && bx < lakeB + 50) continue;
      if (Math.abs(bx - START_X) < 90 || Math.abs(bx - DRIFT_X) < 130) continue;
      if (placed.some(p => Math.abs(p - bx) < 220) || trees.some(t => Math.abs(t.x - bx) < 100)) continue;
      void pick;
      placeBoulder(bx, hb, seedB);
      placed.push(bx);
    }
  }
  // start-area dressing: a few young spruces and half-buried rocks on both sides of the start (the dugout drift DRIFT_X-110..+110 and the spawn stay clear).
  // Deterministic positions, no world rnd() use: the rest of the generation is unchanged. Young = ~4-5 m (the snow here is ~2.3 m deep).
  for (const [dx, h] of [[-215, 96], [-134, 84], [58, 80], [320, 100], [480, 86]] as const) {
    const tx = START_X + dx;
    if (Math.abs(tx - DRIFT_X) < 118 || tx < 60 || (tx > lakeA - 20 && tx < lakeB + 20)) continue;
    plantTree(tx, h, false);
  }
  for (const [dx, hb, sd] of [[-265, 9, 7.7], [380, 10, 31.4]] as const) {
    const bx = START_X + dx;
    if (Math.abs(bx - DRIFT_X) < 125 || bx < 100 || trees.some(t => Math.abs(t.x - bx) < 42)) continue;
    placeBoulder(bx, hb, sd);
  }
  // supply crates with orange poles
  const loots: string[][] = [
    ['saw', 'food', 'matches'], ['food', 'food'], ['snowshoes', 'food'], ['food', 'matches'],
    ['food', 'crackers', 'crackers'], ['thermos', 'matches', 'food'], ['food', 'crackers', 'thermos'], ['matches', 'food', 'thermos'],
  ];
  // the 4th crate sits 50-80 cells west of the start, on the windward ramp (outside the lee drift): food + matches within reach of the first dig
  const cx = [680, 980, 1300, START_X - 66, 1900, 2120, 230, 1420]; // none under the lake (x 1480..1800)
  for (let k = 0; k < cx.length; k++) placeCrate(clearSpot(cx[k]), loots[k]);
  for (let i = 0; i < awake.length; i++) { awake[i] = 0; gpuDirty[i] = 1; }
}

/** Top of the snow/ground at column x. Ignores tree trunks/boughs, snow lying on boughs and marker poles (spawns land on the snow, not the crown). */
function surfaceAt(x: number) {
  for (let y = 0; y < H; y++) {
    const i = idx(x, y), m = mat[i];
    if (m === M.AIR || m === M.NEEDLE || m === M.POLE || (m === M.WOOD && (flags[i] & F_TREE))) continue;
    if (m === M.SNOW) { // snow resting on a bough is not the ground
      let yy = y; while (yy < H - 1 && mat[idx(x, yy)] === M.SNOW) yy++;
      const b = idx(x, yy);
      if (mat[b] === M.NEEDLE || (mat[b] === M.WOOD && (flags[b] & F_TREE))) { y = yy - 1; continue; }
    }
    return y;
  }
  return H;
}
export { surfaceAt };

/** Snow/ground surface row at x: top of the unbroken SNOW/DIRT/ROCK/ICE column resting on the ground (trees, boughs and crates ignored). */
function groundSurface(x: number): number {
  let y = Math.min(H - 1, groundY[x]);
  while (y > 0) { const m = mat[idx(x, y - 1)]; if (m === M.SNOW || m === M.DIRT || m === M.ROCK || m === M.ICE) y--; else break; }
  return y;
}

/** nearest x (searching outward) whose crate footprint has no tree above it and does not touch the lake */
function clearSpot(x0: number): number {
  for (let d = 0; d <= 200; d += 4) for (const x of d === 0 ? [x0] : [x0 + d, x0 - d]) {
    if (x < 60 || x > W - 80 || (x > 1460 && x < 1820)) continue;
    let bad = false;
    for (let xx = x - 10; xx < x + 26 && !bad; xx++) for (let y = 0; y < H; y++) { const m = mat[idx(xx, y)]; if (m === M.WOOD || m === M.NEEDLE || m === M.ROCK && y < groundY[xx] - 2) { bad = true; break; } if (m === M.DIRT) break; }
    if (!bad) return x;
  }
  return x0;
}

function placeCrate(x: number, loot: string[]) {
  const g = groundY[x];
  const w = 16, h = 11;
  // supply cache: buried about 1.2 m under the snow surface (or on the ground if the snow is thinner)
  let s0 = H;
  for (let xx = x; xx < x + w; xx++) s0 = Math.min(s0, groundSurface(xx));
  const poleS = Math.min(groundSurface(x + 2), groundSurface(x + 3));
  const bottom = Math.min(g, s0 + 24 + h);
  const top = bottom - h;
  for (let yy = top; yy < bottom; yy++) for (let xx = x; xx < x + w; xx++) { const i = idx(xx, yy); mat[i] = M.CRATE; dens[i] = 0; bond[i] = 0; flags[i] = 0; treeId[i] = 0; }
  crates.push({ x, y: top, w, h, loot: loot.slice(), opened: false });
  // marker pole sticks out of the snow ~1.2 m (24 cells) above the surface
  for (let yy = poleS - 24; yy < top; yy++) for (let xx = x + 2; xx < x + 4; xx++) { const i = idx(xx, yy); mat[i] = M.POLE; flags[i] = ((yy >> 2) & 1) ? F_VERT : 0; treeId[i] = 0; }
}

/** flags bit 64: boulder rock (bit 32 is reserved for the "belongs to a rigid body" bit of the GPU upload) */
export const F_BOULDER = 64;
/** flags bit 128: thin snow cap lying on a bough (casts only a faint sky shadow, so crowns do not turn into dither) */
export const F_CAP = 128;

/** A half-buried boulder: irregular lumpy outline resting on the ground, plus a wind-scoured hollow in the snow so its crown pokes out. */
function placeBoulder(bx: number, h: number, sd: number) {
  const rx = Math.round(h * (1.1 + 0.4 * hash1(sd)));
  const lump = hash1(sd + 5) > 0.4, lo = (hash1(sd + 9) > 0.5 ? 1 : -1) * Math.round(rx * 0.6), lr = Math.round(rx * 0.5), lh = h * 0.55;
  const ht = new Int16Array(2 * rx + 1);
  for (let dx = -rx; dx <= rx; dx++) {
    const u = Math.abs(dx) / rx;
    let f = Math.pow(Math.max(0, 1 - Math.pow(u, 2.3)), 0.6) * (0.82 + 0.36 * noise1(dx * 0.16 + sd)) + (noise1(dx * 0.27 + sd * 3) - 0.5) * 0.1;
    if (lump) { const ul = Math.abs(dx - lo) / lr; if (ul < 1) f = Math.max(f, (lh / h) * Math.pow(1 - ul * ul, 0.6) * (0.85 + 0.3 * noise1(dx * 0.3 + sd * 7))); }
    ht[dx + rx] = Math.max(0, Math.round(h * f));
  }
  // scour: snow thins out over the rock and rises back to the full depth over ~60 cells
  for (let dx = -rx - 64; dx <= rx + 64; dx++) {
    const xx = bx + dx; if (xx < 2 || xx >= W - 2) continue;
    const g = groundY[xx];
    let d = 0; while (d < 120 && g - 1 - d > 0 && mat[idx(xx, g - 1 - d)] === M.SNOW) d++;
    if (d === 0) continue;
    const e = Math.max(0, Math.abs(dx) - rx * 0.85), hc = Math.abs(dx) <= rx ? ht[dx + rx] : 0;
    const tgt = Math.ceil(hc * 0.75 + e * 0.8);
    if (d <= tgt) continue;
    for (let y = g - d; y < g - tgt; y++) { const i = idx(xx, y); mat[i] = M.AIR; dens[i] = 0; bond[i] = 0; flags[i] = 0; }
    for (let k = 0; k < 4; k++) { const i = idx(xx, g - tgt + k); if (mat[i] === M.SNOW) { dens[i] = 75 + ((rnd() * 20) | 0); bond[i] = 0; flags[i] = 0; } }
  }
  for (let dx = -rx; dx <= rx; dx++) {
    const xx = bx + dx; if (xx < 2 || xx >= W - 2 || ht[dx + rx] <= 0) continue;
    const g = groundY[xx];
    for (let y = g - ht[dx + rx]; y <= g + 1; y++) { const i = idx(xx, y); mat[i] = M.ROCK; dens[i] = 0; bond[i] = 0; flags[i] = F_BOULDER; treeId[i] = 0; }
  }
}

/** Spruce: tapering trunk + tiered drooping boughs (solid core, ragged tips), snow caps on the upper surfaces.
 *  NEEDLE cells carry their tone in `bond` (0 = light tip / top edge .. 255 = dark core / underside); trunk cells hidden by a bough carry bond 255. */
export function plantTree(x: number, h: number, well = true) {
  const base = groundY[x];
  const trunkW = Math.max(3, Math.round(h / 40));
  const top = base - h;
  const tid = (trees.length % 65535) + 1; // unique per tree (wraps only past 65535 trees)
  let rs = (Math.imul(x, 7919) + Math.imul(h, 104729) + 12345) >>> 0;       // private stream: the world's rnd() sequence does not depend on crown shape
  const rr = () => { rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0; return rs / 4294967296; };
  const sd = rr() * 100;
  for (let y = top; y < base; y++) {
    const t = (base - y) / h;
    const tw = Math.max(1, Math.round(trunkW * (1 - t * 0.7)));
    for (let dx = 0; dx < tw; dx++) { const xx = x - (tw >> 1) + dx; const i = idx(xx, y); mat[i] = M.WOOD; dens[i] = 500; flags[i] = F_TREE | F_VERT; bond[i] = 0; treeId[i] = tid; }
  }
  // tiers: each one a drooping triangular bough (apex on the trunk, tip lower and wider), thick near the trunk, thin and ragged at the tip
  const crownStart = base - Math.round(h * 0.18), crownH = crownStart - top, wMax = 3 + h * 0.2;
  let yA = top + 1, ti = 0;
  while (yA < crownStart - 5) {
    const t = Math.min(1, Math.max(0, (yA - top) / crownH));
    const S = Math.round(7 + 6 * t + rr() * 2);                      // vertical spacing to the next apex
    let Wt = 3, D = 4;
    for (let k = 0; k < 2; k++) { const tt = Math.min(1, Math.max(0, (yA + D - top) / crownH)); Wt = 2.5 + (wMax - 2.5) * Math.pow(tt, 0.85); D = 2 + Wt * 0.45; }
    const Wl = Wt * (0.82 + 0.3 * rr()), Wr = Wt * (0.82 + 0.3 * rr());
    const T = S + 5;                                                  // thickness at the trunk (overlaps the next tier's apex)
    for (let dx = -Math.ceil(Wl); dx <= Math.ceil(Wr); dx++) {
      const xx = x + dx; if (!inb(xx, 0)) continue;
      const side = dx < 0 ? Wl : Wr, u = Math.min(1, Math.abs(dx) / side);
      if (Math.abs(dx) > side) continue;
      const yTop = yA + Math.round(D * Math.pow(u, 0.85));
      const nz = noise1(dx * 0.55 + ti * 17.3 + (dx < 0 ? 0 : 91) + sd);
      const tuft = u > 0.35 ? Math.floor(nz * 3.3 * u) : 0;          // needle tufts hang below the tip
      const th = 1.6 + (T - 1.6) * Math.pow(1 - u, 1.3);
      const yBot = Math.min(base - 3, yTop + Math.round(th) + tuft);
      const along = 1 - u;
      for (let y = yTop; y < yBot; y++) {
        if (y < 0 || y >= H) continue;
        const i = idx(xx, y);
        const m0 = mat[i];
        if (m0 === M.WOOD) { if ((flags[i] & F_TREE) && treeId[i] === tid && u < 0.4) bond[i] = 255; continue; }
        if (m0 !== M.AIR && m0 !== M.SNOW) continue;
        const v = (y - yTop) / Math.max(1, yBot - yTop - 1);        // 0 top edge .. 1 underside
        let tone = 0.62 * Math.pow(along, 0.8) + 0.5 * v - 0.17;
        if ((y - yTop + Math.floor(Math.abs(dx) * 0.5)) % 3 === 0) tone += 0.14;   // drooping needle sprays follow the bough slope
        mat[i] = M.NEEDLE; dens[i] = 0; bond[i] = Math.max(0, Math.min(255, Math.round(tone * 255))); flags[i] = F_TREE; treeId[i] = tid;
      }
    }
    yA += S; ti++;
  }
  // remove snow inside the crown (tree well); young trees (well = false) stand in the snow instead
  if (well) for (let y = top; y < base; y++) for (let dx = -30; dx <= 30; dx++) {
    const xx = x + dx; if (!inb(xx, y)) continue; const i = idx(xx, y);
    if (mat[i] === M.SNOW && y < base - 6 && Math.abs(dx) < h * 0.2) { mat[i] = M.AIR; dens[i] = 0; bond[i] = 0; }
  }
  // snow caps: 1-2 cells lying on the upper surface of the boughs (patchy, coherent), only where the sky is open above
  const Wc = Math.ceil(wMax * 1.3) + 6;
  for (let dx = -Wc; dx <= Wc; dx++) {
    const xx = x + dx; if (!inb(xx, 0) || xx < 1 || xx >= W - 1) continue;
    for (let y = top - 2; y < crownStart + 12 && y < H - 3; y++) {
      const i = idx(xx, y), b = i + W;
      if (mat[i] !== M.AIR || mat[b] !== M.NEEDLE || treeId[b] !== tid || mat[i - W] !== M.AIR || mat[i - 2 * W] !== M.AIR) continue;
      if (noise1(dx * 0.11 + tid * 3.7 + y * 0.05 + sd) < 0.1) continue;
      const flat = (mat[b - 1] === M.NEEDLE ? 1 : 0) + (mat[b + 1] === M.NEEDLE ? 1 : 0);
      if (flat === 0) continue;
      const thick = flat === 2 || noise1(dx * 0.23 + sd * 2 + y * 0.1) > 0.55 ? 2 : 1;
      for (let k = 0; k < thick; k++) { const j = i - k * W; if (mat[j] === M.AIR) { mat[j] = M.SNOW; dens[j] = 110; bond[j] = 44; flags[j] = F_CAP; treeId[j] = 0; } }
    }
  }
  trees.push({ x, base, height: h, alive: true });
}

export function cellMass(i: number) { return dens[i] * CELL; } // kg per m^2 of horizontal area (per cell column)
