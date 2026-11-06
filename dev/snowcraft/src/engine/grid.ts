// CONTRACT FILE — shared world grid. Do not change exported names/shapes without updating SPEC.md.
// Coordinates: cells, x right, y DOWN. 1 cell ≈ 9 cm. Tile = TS×TS cells (dig/place/heat/light unit).
import { MAT, PHASE, Phase } from '../content/materials';

export const W = 2048, H = 768;           // world size in cells
export const TS = 4;                      // tile size (cells)
export const TW = W / TS, TH = H / TS;    // 512 × 192 tiles
export const CS = 32;                     // sim chunk size (cells)
export const CW = W / CS, CHN = H / CS;   // 64 × 24 chunks

// ---- per-cell layers ----
export const mat = new Uint8Array(W * H);    // material id (content/materials.ts)
export const aux = new Uint8Array(W * H);    // per-material scalar: SNOW compaction, FIRE/SMOKE/STEAM life, EMBER heat, ICE crack, tile dig damage is NOT here (see tools)
export const shade = new Uint8Array(W * H);  // random 0..255 assigned when a cell is created; renderer colour variation
export const flags = new Uint8Array(W * H);  // bit flags below
export const F_TICK = 1;    // parity bit: cell already moved this sim tick (sim owns)
export const F_PLACED = 2;  // built by the player (structure, shelter detection, refunds)
export const F_TREE = 4;    // part of a standing tree (trunk/needles); trunk cells anchor to ground
export const F_WET = 8;     // wet snow (slides less, packs faster, freezes to ice)
export const F_FIXTURE = 16;// footprint of a fixture entity (furniture). Tools never dig these directly
export const F_BURN = 32;   // currently burning (solid flammable on fire; sim owns)
export const F_LIT = 64;    // light-emitting cell hint for renderer (sim may set on lava/ember)
export const F_FREE = 128;  // reserved

// ---- per-tile layers ----
export const bg = new Uint8Array(TW * TH);   // background wall: 0 sky, 1 dirt, 2 stone, 3 ice, 4 deep rock, 5 wood (built interiors); set by worldgen
export const seen = new Uint8Array(TW * TH); // map exploration 0/1 (minimap/journal)

// ---- chunks (sim sleep) ----
export const awake = new Uint8Array(CW * CHN);   // >0: chunk simulated; counts down each tick it had no motion

export const idx = (x: number, y: number) => y * W + x;
export const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
export const tidx = (tx: number, ty: number) => ty * TW + tx;

/** Wake the chunk containing (x,y) and its 8 neighbours. Call after ANY grid write outside sim's own moves. */
export function wake(x: number, y: number, frames = 60) {
  const cx = (x / CS) | 0, cy = (y / CS) | 0;
  for (let j = cy - 1; j <= cy + 1; j++) {
    if (j < 0 || j >= CHN) continue;
    for (let i = cx - 1; i <= cx + 1; i++) {
      if (i < 0 || i >= CW) continue;
      const c = j * CW + i; if (awake[c] < frames) awake[c] = frames;
    }
  }
}
export function wakeRect(x0: number, y0: number, x1: number, y1: number, frames = 60) {
  for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1 + CS); y += CS) for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1 + CS); x += CS) wake(x, y, frames);
}

// listeners notified on writes that change solidity (structure solver, heat recompose, body colliders)
type EditFn = (x0: number, y0: number, x1: number, y1: number) => void;
const editFns: EditFn[] = [];
export function onEdit(fn: EditFn) { editFns.push(fn); }
/** Report a player/event edit of a region (dig, place, explosion). Sim moves of powders/liquids don't call this. */
export function edited(x0: number, y0: number, x1: number, y1: number) { for (const f of editFns) f(x0, y0, x1, y1); }

/** Write one cell. New shade unless keepShade. Wakes the chunk. Does NOT call edited(). */
export function setCell(x: number, y: number, m: number, a = 0, fl = 0, keepShade = false) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = y * W + x;
  mat[i] = m; aux[i] = a; flags[i] = fl;
  if (!keepShade) shade[i] = (Math.random() * 256) | 0;
  wake(x, y);
}
/** Material at (x,y); out of bounds counts as BEDROCK. */
export function getM(x: number, y: number) { return x < 0 || y < 0 || x >= W || y >= H ? MAT.BEDROCK : mat[y * W + x]; }
export function isEmpty(i: number) { return mat[i] === MAT.AIR; }
export function phaseAt(i: number): Phase { return PHASE[mat[i]] as Phase; }

// ---- deterministic RNG for world generation (sim may use Math.random) ----
let seed = 1;
export function setSeed(s: number) { seed = (s >>> 0) || 1; }
export function rand() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
export function randInt(a: number, b: number) { return a + Math.floor(rand() * (b - a + 1)); }
function hash1(n: number) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
export function noise1(x: number) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash1(i) * (1 - u) + hash1(i + 1) * u; }
export function fbm1(x: number, oct = 4) { let a = 0.5, s = 0, n = 0; for (let o = 0; o < oct; o++) { s += a * noise1(x); n += a; x *= 2.03; a *= 0.5; } return s / n; }
function hash2(x: number, y: number) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
export function noise2(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
}
export function fbm2(x: number, y: number, oct = 4) { let a = 0.5, s = 0, n = 0; for (let o = 0; o < oct; o++) { s += a * noise2(x, y); n += a; x *= 2.03; y *= 2.03; a *= 0.5; } return s / n; }

export function clearWorld() { mat.fill(0); aux.fill(0); shade.fill(0); flags.fill(0); bg.fill(0); seen.fill(0); awake.fill(0); }
