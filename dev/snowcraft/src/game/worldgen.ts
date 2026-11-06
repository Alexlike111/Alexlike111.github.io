// World generator (SPEC §4). Deterministic by seed. Layout left -> right:
// hunter's hut · frozen lake · forest · WEATHER STATION (start) · hills · hot spring · watchtower hill · avalanche ridge · plane wreck.
// Underground: snowpack -> frozen dirt -> stone -> granite, ice caves, ore bands, sealed methane/oil pockets, warm grotto, lava, crystal geodes.
import { W, H, TW, TH, mat, aux, flags, shade, bg, awake, clearWorld, setSeed, rand, randInt, noise1, fbm1, fbm2, F_TREE } from '../engine/grid';
import { MAT } from '../content/materials';
import { G } from './state';
import { LOC, stampLocations, resetLocations, WorldInfo } from './locations';

const M = MAT;
const AIR = M.AIR, SNOW = M.SNOW, PACKED = M.PACKED, ICE = M.ICE, WATER = M.WATER, DIRT = M.DIRT, STONE = M.STONE, HARD = M.HARDROCK, BED = M.BEDROCK;

// ---- shared terrain data (also handed to locations) ----
const surf = new Int16Array(W);        // top of the natural surface (snow / ice top)
const rockTop = new Int16Array(W);     // first DIRT row
const stoneTop = new Int16Array(W);    // first STONE row
const deepTop = new Int16Array(W);     // first HARDROCK row
const snowDepth = new Int16Array(W);

const ss = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
let SO = 0;   // seed offset for noise

function flat(h: number, x: number, c: number, hf: number, hb: number, target: number) {
  const w = 1 - ss(hf, hf + hb, Math.abs(x - c));
  return h + (target - h) * w;
}
const RIDGE_PTS: [number, number][] = [[1470, 264], [1510, 250], [1550, 222], [1590, 194], [1630, 172], [1660, 166], [1690, 182], [1725, 214], [1765, 244], [1800, 258], [1830, 262]];
function ridgeH(x: number) {
  let i = 0; while (i < RIDGE_PTS.length - 2 && x > RIDGE_PTS[i + 1][0]) i++;
  const a = RIDGE_PTS[i], b = RIDGE_PTS[i + 1], t = clamp((x - a[0]) / (b[0] - a[0]), 0, 1), s = 0.5 - 0.5 * Math.cos(Math.PI * t);
  return a[1] + (b[1] - a[1]) * s;
}

function baseHeight(x: number) {
  const X = x + SO;
  let h = 268 + (fbm1(X / 380 + 3.1, 3) - 0.5) * 38 + (fbm1(X / 62 + 11.3, 3) - 0.5) * 9;
  h = flat(h, x, LOC.hut.x, 34, 60, 268);
  h = flat(h, x, LOC.station.x, 118, 90, 272);
  h -= 54 * Math.exp(-(((x - LOC.tower.x) / 46) ** 2));
  h = flat(h, x, LOC.tower.x, 34, 50, LOC.tower.y);
  const wr = ss(1450, 1495, x) * (1 - ss(1800, 1840, x));
  if (wr > 0) h += (ridgeH(x) + (fbm1(X / 18 + 5, 2) - 0.5) * 5 - h) * wr;
  h = flat(h, x, LOC.wreck.x, 60, 55, 262);
  h = flat(h, x, (LOC.lake.l + LOC.lake.r) / 2, (LOC.lake.r - LOC.lake.l) / 2 - 2, 60, LOC.lake.y);
  const d = (x - LOC.spring.x) / 50; if (Math.abs(d) < 1) h += 26 * (0.5 + 0.5 * Math.cos(Math.PI * d));
  if (x > 1990) h -= 24 * ss(1990, 2040, x);     // hill at the east edge
  return h;
}

function carveDisc(cx: number, cy: number, r: number, minY = 0, fill = AIR) {
  const r2 = r * r, y0 = Math.max(minY, Math.floor(cy - r)), y1 = Math.min(H - 7, Math.ceil(cy + r)), x0 = Math.max(6, Math.floor(cx - r)), x1 = Math.min(W - 7, Math.ceil(cx + r));
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy; const row = y * W;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx; if (dx * dx + dy * dy > r2) continue;
      const i = row + x, m = mat[i];
      if (m === BED || m === M.FIXTURE) continue;
      mat[i] = fill; aux[i] = 0; flags[i] = 0;
    }
  }
}
function carveEllipse(cx: number, cy: number, rx: number, ry: number, noiseAmt: number, seed: number, fill = AIR, minY = 0) {
  const y0 = Math.max(minY, Math.floor(cy - ry * 1.3)), y1 = Math.min(H - 7, Math.ceil(cy + ry * 1.3)), x0 = Math.max(6, Math.floor(cx - rx * 1.3)), x1 = Math.min(W - 7, Math.ceil(cx + rx * 1.3));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      // flatter floor: squash the lower half a little
      const d = dx * dx + (dy > 0 ? dy * dy * 1.35 : dy * dy);
      const n = (fbm2(x / 9 + seed, y / 9 + seed * 0.7, 3) - 0.5) * noiseAmt;
      if (d + n > 1) continue;
      const i = y * W + x, m = mat[i]; if (m === BED || m === M.FIXTURE) continue;
      mat[i] = fill; aux[i] = 0; flags[i] = 0;
    }
  }
}

interface CavePt { x: number; y: number; r: number }
const cavePts: CavePt[] = [];
const chambers: { x: number; y: number; rx: number; ry: number; zone: number }[] = [];

function worm(x: number, y: number, ang: number, len: number, r0: number, ymin: number, ymax: number, minY = 0) {
  const off = rand() * 1000;
  for (let s = 0; s < len; s++) {
    x += Math.cos(ang) * 1.7; y += Math.sin(ang) * 1.7;
    ang += (noise1(s * 0.035 + off) - 0.5) * 0.46 + (noise1(s * 0.011 + off * 2) - 0.5) * 0.1;
    if (y < ymin) ang += (Math.PI / 2 - ang) * 0.06 + 0.06; else if (y > ymax) ang += (-Math.PI / 2 - ang) * 0.06 - 0.06;
    // keep mostly horizontal
    const hs = Math.sin(ang); if (Math.abs(hs) > 0.78) ang *= 0.97;
    if (x < 30 || x > W - 30) ang = Math.PI - ang;
    const r = r0 * (0.72 + 0.5 * noise1(s * 0.06 + off * 3)) * (noise1(s * 0.02 + off * 5) < 0.12 ? 0.62 : 1);
    carveDisc(x, y, r, minY);
    if ((s & 7) === 0) cavePts.push({ x, y, r });
  }
}

function blob(x: number, y: number, m: number, steps: number, replace: number[], rad = 1) {
  for (let s = 0; s < steps; s++) {
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
      if (dx * dx + dy * dy > rad * rad + 0.5 || rand() < 0.25) continue;
      const xx = x + dx, yy = y + dy; if (xx < 6 || xx >= W - 6 || yy < 0 || yy >= H - 7) continue;
      const i = yy * W + xx; if (replace.includes(mat[i])) { mat[i] = m; aux[i] = 0; }
    }
    x += randInt(-1, 1) * 2; y += randInt(-1, 1) * 2;
  }
}
function airNear(cx: number, cy: number, r: number) {
  for (let y = Math.max(0, cy - r); y <= Math.min(H - 1, cy + r); y++) for (let x = Math.max(0, cx - r); x <= Math.min(W - 1, cx + r); x++) { const m = mat[y * W + x]; if (m === AIR || m === WATER || m === M.LAVA || m === M.METHANE) return true; }
  return false;
}

// ---------------------------------------------------------------------------------------------------------------------
export function generateWorld(seed: number): { spawnX: number; spawnY: number } {
  G.seed = seed;
  clearWorld(); setSeed(seed * 7919 + 13); resetLocations();
  G.fixtures.length = 0;
  SO = (seed % 997) * 13.37;
  cavePts.length = 0; chambers.length = 0;

  // ---- 1. surface profile ----
  const hs = new Float32Array(W);
  for (let x = 0; x < W; x++) hs[x] = baseHeight(x);
  for (let x = 1; x < W; x++) hs[x] = clamp(hs[x], hs[x - 1] - 1, hs[x - 1] + 1);
  for (let x = W - 2; x >= 0; x--) hs[x] = clamp(hs[x], hs[x + 1] - 1, hs[x + 1] + 1);
  for (let x = 0; x < W; x++) surf[x] = Math.round(hs[x]);
  // station plateau and hut pad stay exactly tile aligned
  for (let x = LOC.station.x - 100; x <= LOC.station.x + 100; x++) surf[x] = LOC.station.y;
  for (let x = LOC.hut.x - 34; x <= LOC.hut.x + 34; x++) surf[x] = LOC.hut.y;

  // ---- 2. columns: snow / dirt / stone / granite ----
  for (let x = 0; x < W; x++) {
    const X = x + SO, s = surf[x];
    // lee drifts: more snow where higher ground lies upwind (west)
    let up = 1e9; for (let k = 12; k <= 60; k += 12) up = Math.min(up, surf[Math.max(0, x - k)]);
    const lee = clamp(s - up, 0, 40);      // >0 when the terrain upwind (west) is higher
    let depth = 11 + 12 * fbm1(X / 140 + 7, 3) + (lee / 40) * 14;
    const ridge = ss(1470, 1520, x) * (1 - ss(1790, 1830, x));
    depth += ridge * (16 + 12 * fbm1(X / 40 + 2, 2));
    const stN = ss(LOC.station.x - 100, LOC.station.x - 60, x) * (1 - ss(LOC.station.x + 60, LOC.station.x + 100, x));
    depth = depth * (1 - stN * 0.55);
    depth = clamp(Math.round(depth), 6, 46);
    snowDepth[x] = depth;
    rockTop[x] = s + depth;
    const dirtT = Math.round(10 + 20 * fbm1(X / 95 + 21, 3));
    stoneTop[x] = rockTop[x] + dirtT;
    deepTop[x] = Math.round(560 + (fbm1(X / 130 + 40, 3) - 0.5) * 44);
    const loose = Math.round(clamp(3 + 5 * fbm1(X / 33 + 9, 2) - ridge * 3.2, 2, 9));
    for (let y = s; y < H - 6; y++) {
      const i = y * W + x;
      if (y < s + loose) { mat[i] = SNOW; aux[i] = (rand() * 60) | 0; }
      else if (y < rockTop[x]) { mat[i] = PACKED; aux[i] = 255; }
      else if (y < stoneTop[x]) mat[i] = DIRT;
      else if (y < deepTop[x]) mat[i] = STONE;
      else mat[i] = HARD;
    }
  }
  // dirt/stone and stone/granite interleave a little
  for (let k = 0; k < 900; k++) {
    const x = randInt(8, W - 9), y0 = stoneTop[x] + randInt(-6, 24);
    blob(x, y0, STONE, randInt(6, 14), [DIRT], 2);
    blob(x, deepTop[x] + randInt(-14, 20), rand() < 0.5 ? STONE : HARD, randInt(8, 20), [STONE, HARD], 3);
  }

  // ---- 3. lake ----
  buildLake();
  // ---- 4. hot spring hollow ----
  buildSpring();

  // ---- 5. caves ----
  buildCaves();

  // ---- 6. ores, gravel, gas, oil ----
  buildOres();
  const pockets = buildPockets();

  // ---- 7. grotto, lava, geodes ----
  buildGrotto();
  const deep = buildDeep();

  // ---- 8. trees ----
  buildTrees();

  // ---- 9. bedrock, background tiles ----
  for (let y = H - 6; y < H; y++) mat.fill(BED, y * W, y * W + W);
  for (let y = 0; y < H; y++) { const r = y * W; for (let x = 0; x < 6; x++) { mat[r + x] = BED; mat[r + W - 1 - x] = BED; } }
  buildBackgrounds();

  // ---- 10. sites & fixtures (house, hut, tower, wreck, chests ...) ----
  const info: WorldInfo = { surf, rockTop, stoneTop, deepTop, chambers, cavePts, pockets, deep };
  stampLocations(info, { carveDisc, carveEllipse });

  // ---- 11. cell variation (deterministic) & final bookkeeping ----
  for (let i = 0; i < shade.length; i++) shade[i] = (rand() * 256) | 0;
  awake.fill(0);

  const sx = LOC.spawn.x;
  let sy = 0; while (sy < H - 1 && mat[sy * W + sx] === AIR) sy++;
  return { spawnX: sx, spawnY: sy };
}

// ---------------------------------------------------------------------------------------------------------------------
function buildLake() {
  const { l, r, y: ly } = LOC.lake, mid = (l + r) / 2, half = (r - l) / 2;
  for (let x = l - 8; x <= r + 8; x++) {
    const u = (x - mid) / half;
    const edge = ss(0.78, 1.04, Math.abs(u));
    const depth = Math.round(3 + 25 * Math.pow(Math.max(0, 1 - u * u), 0.9) * (0.9 + 0.2 * fbm1(x / 30 + SO, 2)));
    const thin = 1 - ss(0.1, 0.5, Math.abs(u));                   // 1 in the middle (thin ice), 0 near the shore
    const iceT = Math.round(7 - 4 * thin * (1 - edge * 0));
    const bed = ly + depth, dirtT = 6 + ((x * 7) & 3);
    if (x < l || x > r) continue;
    const snowT = Math.round(clamp(4 * edge + (fbm1(x / 25 + SO, 2) - 0.45) * 5, 0, 4) * (1 - thin * 0.9));
    const inLake = x >= l && x <= r;
    for (let y = ly - 6; y < H - 6; y++) {
      const i = y * W + x;
      if (!inLake) continue;
      if (y < ly - snowT) { mat[i] = AIR; aux[i] = 0; }
      else if (y < ly) { mat[i] = SNOW; aux[i] = (rand() * 40) | 0; }
      else if (y < ly + iceT) { mat[i] = ICE; aux[i] = 0; }
      else if (y < bed) { mat[i] = WATER; aux[i] = 0; }
      else if (y < bed + dirtT) { mat[i] = (y > bed + 2 && rand() < 0.3) ? M.GRAVEL : DIRT; aux[i] = 0; }
      else if (mat[i] === AIR || mat[i] === SNOW || mat[i] === PACKED) mat[i] = STONE;
    }
    if (inLake) { surf[x] = ly - snowT; rockTop[x] = ly; stoneTop[x] = ly; }
  }
}

function buildSpring() {
  const cx = LOC.spring.x, R = LOC.spring.r, pr = Math.round(R * 0.46);
  const yw = Math.min(surf[cx - pr], surf[cx + pr]);           // pool water level = the lower rim of the pool
  LOC.spring.y = yw;
  for (let x = cx - R; x <= cx + R; x++) {
    const d = (x - cx) / R, top = surf[x];
    // bare ground in the hollow: remove snow, expose dirt
    for (let y = top; y < rockTop[x]; y++) { const i = y * W + x; if (mat[i] === SNOW || mat[i] === PACKED) { mat[i] = DIRT; aux[i] = 0; } }
    if (Math.abs(d) < 0.92) { rockTop[x] = Math.min(rockTop[x], top); if (rand() < 0.08) mat[top * W + x] = M.GRAVEL; }
    if (Math.abs(x - cx) <= pr) {
      const pd = (x - cx) / pr, bedY = yw + 1 + Math.round(9 * (1 - pd * pd));
      for (let y = yw; y < bedY; y++) { const i = y * W + x; mat[i] = WATER; aux[i] = 0; flags[i] = 0; }
      for (let y = bedY; y < bedY + 2; y++) { const i = y * W + x; if (mat[i] === AIR || mat[i] === SNOW || mat[i] === PACKED) { mat[i] = DIRT; aux[i] = 0; } }
    }
  }
}

function buildCaves() {
  const SURF_LIM = 322;
  // entrances from the surface (wide enough to walk in: r ~ 11)
  const ent = [410, 842, 1178, 1478, 1966];
  for (const ex of ent) {
    const dirn = rand() < 0.5 ? 1 : -1;
    let x = ex, y = surf[ex] - 4, a = dirn > 0 ? 0.62 : Math.PI - 0.62;
    const off = rand() * 100;
    for (let s = 0; s < 150 && y < 360; s++) {
      x += Math.cos(a) * 1.8; y += Math.sin(a) * 1.8; a += (noise1(s * 0.07 + off) - 0.5) * 0.18;
      carveDisc(x, y, 10.5 - Math.min(3, s * 0.01), 0);
      if ((s & 7) === 0) cavePts.push({ x, y, r: 10 });
    }
    worm(x, y, dirn > 0 ? 0.2 : Math.PI - 0.2, 320, 9.5, 332, 430);
  }
  // upper (ice) network
  for (let k = 0; k < 11; k++) worm(randInt(120, W - 120), randInt(340, 420), rand() * Math.PI * 2, randInt(260, 520), 6.8 + rand() * 5, 332, 440);
  // mid network
  for (let k = 0; k < 15; k++) worm(randInt(120, W - 120), randInt(450, 560), rand() * Math.PI * 2, randInt(260, 560), 6.8 + rand() * 5.5, 446, 575);
  // deep network
  for (let k = 0; k < 11; k++) worm(randInt(120, W - 120), randInt(590, 730), rand() * Math.PI * 2, randInt(240, 520), 6.5 + rand() * 5.5, 584, 738);
  // connecting shafts
  for (let k = 0; k < 9; k++) { const x = randInt(150, W - 150); worm(x, randInt(345, 560), Math.PI / 2 + (rand() - 0.5) * 0.7, randInt(70, 110), 6.5 + rand() * 2.5, 334, 740); }
  // chambers
  const zones: [number, number, number, number][] = [[3, 335, 435, 9], [1, 450, 570, 11], [2, 590, 725, 8]];
  for (const [zone, y0, y1, n] of zones) {
    for (let k = 0; k < n; k++) {
      const cx = randInt(80, W - 80), cy = randInt(y0 + 14, y1 - 14), rx = randInt(22, 44), ry = randInt(11, 19);
      carveEllipse(cx, cy, rx, ry, 0.5, k * 3.3 + zone, AIR, 0);
      chambers.push({ x: cx, y: cy, rx, ry, zone });
    }
  }
  // ice lining + icicles in the upper zone
  const y0 = SURF_LIM - 4, y1 = 446, h = y1 - y0, dist = new Uint8Array(W * h).fill(255);
  for (let y = 0; y < h; y++) for (let x = 0; x < W; x++) { const m = mat[(y + y0) * W + x]; if (m === AIR || m === WATER) dist[y * W + x] = 0; }
  for (let y = 0; y < h; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x; let d = dist[i];
    if (x > 0 && dist[i - 1] + 1 < d) d = dist[i - 1] + 1;
    if (y > 0) { if (dist[i - W] + 1 < d) d = dist[i - W] + 1; if (dist[i - W - 1] + 1 < d) d = dist[i - W - 1] + 1; if (dist[i - W + 1] + 1 < d) d = dist[i - W + 1] + 1; }
    dist[i] = d;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = W - 2; x > 0; x--) {
    const i = y * W + x; let d = dist[i];
    if (dist[i + 1] + 1 < d) d = dist[i + 1] + 1;
    if (y < h - 1) { if (dist[i + W] + 1 < d) d = dist[i + W] + 1; if (dist[i + W - 1] + 1 < d) d = dist[i + W - 1] + 1; if (dist[i + W + 1] + 1 < d) d = dist[i + W + 1] + 1; }
    dist[i] = d;
  }
  for (let y = 0; y < h; y++) for (let x = 6; x < W - 6; x++) {
    const d = dist[y * W + x]; if (d === 0 || d > 4) continue;
    const i = (y + y0) * W + x, m = mat[i];
    if (m !== STONE && m !== DIRT && m !== PACKED) continue;
    const yy = y + y0, fade = 1 - ss(400, 446, yy);   // lining fades out with depth
    const t = (0.8 + 3.2 * fbm2(x / 14 + SO, yy / 14, 3)) * fade;
    if (d <= t) { mat[i] = ICE; aux[i] = 0; }
  }
  // icicles: from ice ceilings downward
  for (let x = 8; x < W - 8; x++) {
    for (let y = y0; y < y1 - 2; y++) {
      const i = y * W + x;
      if (mat[i] === ICE && mat[i + W] === AIR && rand() < 0.09) {
        const len = randInt(2, 11);
        for (let k = 1; k <= len; k++) {
          if (mat[(y + k) * W + x] !== AIR) break;
          mat[(y + k) * W + x] = ICE;
          if (k < len * 0.45 && mat[(y + k) * W + x + 1] === AIR && rand() < 0.7) mat[(y + k) * W + x + 1] = ICE;
        }
      }
    }
  }
}

function buildOres() {
  const rep = [STONE];
  const stoneY = (x: number) => stoneTop[x];
  // coal: common and shallow
  for (let k = 0; k < 190; k++) { const x = randInt(10, W - 10), y = Math.round(stoneY(x) + 4 + Math.pow(rand(), 1.7) * (540 - stoneY(x))); blob(x, y, M.COAL, randInt(6, 18), rep, 2); }
  // copper: mid
  for (let k = 0; k < 85; k++) { const x = randInt(10, W - 10), y = randInt(380, 560); blob(x, y, M.COPPER, randInt(6, 16), rep, 2); }
  // iron: mid-deep, also in granite
  for (let k = 0; k < 70; k++) { const x = randInt(10, W - 10), y = randInt(470, 690); blob(x, y, M.IRON, randInt(6, 15), [STONE, HARD], 2); }
  // gravel pockets
  for (let k = 0; k < 45; k++) { const x = randInt(10, W - 10), y = randInt(Math.max(320, stoneY(x) + 6), 600); const g = randInt(5, 12); if (!airNear(x, y, 6)) blob(x, y, M.GRAVEL, g, [STONE, DIRT], 2); }
  // the first coal sits close to the start: reachable by the first digging
  for (let k = 0; k < 6; k++) { const x = LOC.station.x + randInt(-170, 170), y = stoneY(x) + randInt(3, 16); blob(x, y, M.COAL, randInt(8, 14), [STONE, DIRT], 2); }
  // stone outcrops poking through the snow on the ridge
  for (let k = 0; k < 18; k++) {
    const x = randInt(1500, 1800), s = surf[x];
    const rx = randInt(4, 9), ry = randInt(3, 6);
    for (let y = s - ry; y <= s + 6; y++) for (let xx = x - rx; xx <= x + rx; xx++) {
      const dx = (xx - x) / rx, dy = (y - s) / ry; if (dx * dx + dy * dy > 1 || y < 0) continue;
      const i = y * W + xx; if (mat[i] === AIR || mat[i] === SNOW || mat[i] === PACKED) { mat[i] = rand() < 0.1 ? DIRT : STONE; aux[i] = 0; }
    }
  }
}

function buildPockets() {
  const out: { kind: 'methane' | 'oil'; x: number; y: number; r: number }[] = [];
  const place = (kind: 'methane' | 'oil', n: number, y0: number, y1: number) => {
    let placed = 0;
    for (let attempt = 0; attempt < 400 && placed < n; attempt++) {
      const x = randInt(60, W - 60), y = randInt(y0, y1), r = randInt(4, 7);
      if (airNear(x, y, r + 3)) continue;
      // prefer to sit a short dig away from an existing cave
      let near = false; for (let k = 0; k < cavePts.length; k += 3) { const c = cavePts[k]; if (Math.abs(c.x - x) < 36 && Math.abs(c.y - y) < 30) { near = true; break; } }
      if (!near && attempt < 300) continue;
      carveEllipse(x, y, r * 1.4, r, 0.35, attempt, kind === 'methane' ? M.METHANE : M.OIL);
      out.push({ kind, x, y, r }); placed++;
    }
  };
  place('methane', 7, 380, 560);
  place('oil', 5, 440, 650);
  return out;
}

function buildGrotto() {
  const g = LOC.grotto;
  carveEllipse(g.x, g.y, g.rx, g.ry, 0.35, 77, AIR);
  // flat floor + warm pool
  const floor = g.y + g.ry - 3;
  for (let x = g.x - g.rx; x <= g.x + g.rx; x++) {
    for (let y = floor; y < floor + 2; y++) { const i = y * W + x; if (mat[i] === AIR) mat[i] = DIRT; }
  }
  for (let x = g.x - 14; x <= g.x + 14; x++) {
    const d = (x - g.x) / 14, depth = Math.round(5 * (1 - d * d));
    for (let y = floor; y < floor + depth + 1; y++) { const i = y * W + x; mat[i] = y < floor + depth ? WATER : DIRT; }
    for (let y = floor - 3; y < floor; y++) { const i = y * W + x; if (mat[i] !== AIR && y >= floor - 2) mat[i] = AIR; }
  }
  // tunnel from the grotto to the ice network and up toward the hot spring
  let x = g.x - g.rx + 4, y = g.y, a = Math.PI + 0.25;
  const off = rand() * 100;
  for (let s = 0; s < 170; s++) { x += Math.cos(a) * 1.7; y += Math.sin(a) * 1.7; a += (noise1(s * 0.06 + off) - 0.5) * 0.3 - 0.003; if (y < 352) a += 0.05; carveDisc(x, y, 9, 0); if ((s & 7) === 0) cavePts.push({ x, y, r: 9 }); }
  // glowing moss-free stones around the pool: a few pale rocks
  for (let k = 0; k < 14; k++) { const px = g.x + randInt(-g.rx + 6, g.rx - 6); let py = g.y - g.ry; while (py < floor && mat[py * W + px] === AIR) py++; if (mat[(py - 1) * W + px] === AIR && Math.abs(px - g.x) > 15) { mat[(py - 1) * W + px] = STONE; if (rand() < 0.5) mat[(py - 1) * W + px + 1] = STONE; } }
}

function buildDeep() {
  const lavas: { x: number; y: number; rx: number; ry: number }[] = [];
  const geodes: { x: number; y: number; rx: number; ry: number }[] = [];
  // basalt veins
  for (let k = 0; k < 70; k++) blob(randInt(10, W - 10), randInt(600, 740), M.BASALT, randInt(8, 22), [HARD, STONE], 2);
  // lava chambers
  const lavaX = [330, 760, 1130, 1500, 1860, 1310];
  lavaX.forEach((lx, n) => {
    const cx = lx + randInt(-60, 60), cy = randInt(660, 722), rx = randInt(26, 42), ry = randInt(11, 17);
    carveEllipse(cx, cy, rx, ry, 0.4, n * 5 + 1, AIR);
    // access tunnel from the ceiling corner (carved before the lava goes in)
    const side = n & 1 ? -1 : 1;
    worm(cx + side * rx * 0.7, cy - ry * 0.95, side > 0 ? -0.35 : Math.PI + 0.35, 150, 8, 590, 700);
    const level = cy - 1;
    for (let y = level; y < cy + ry + 2; y++) for (let x = cx - rx - 1; x <= cx + rx + 1; x++) {
      if (y > H - 14) continue;
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      if (dx * dx + (dy > 0 ? dy * dy * 1.35 : dy * dy) > 1.02) continue;
      const i = y * W + x; if (mat[i] === AIR) { mat[i] = M.LAVA; aux[i] = 0; }
    }
    // cooled basalt crust around the lava
    for (let y = cy - ry - 3; y < cy + ry + 6; y++) for (let x = cx - rx - 4; x <= cx + rx + 4; x++) {
      if (y < 0 || y >= H - 6) continue;
      const i = y * W + x; const m = mat[i];
      if ((m === HARD || m === STONE) && rand() < 0.7) {
        let near = false;
        for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) if (mat[(y + dy) * W + x + dx] === M.LAVA) { near = true; break; }
        if (near) mat[i] = M.BASALT;
      }
    }
    lavas.push({ x: cx, y: cy, rx, ry });
  });
  // crystal geodes (deepest goal). Geode 0 sits next to a lava chamber and is connected to it.
  const gp: [number, number][] = [[lavas[3].x + 78, 668], [1710, 700], [520, 690]];
  gp.forEach(([gx, gy], n) => {
    const rx = randInt(26, 34), ry = randInt(13, 17);
    carveEllipse(gx, gy, rx, ry, 0.15, 200 + n, M.CRYSTAL);        // crystal shell (solid)
    carveEllipse(gx, gy + 1, rx - 4, ry - 3.4, 0.15, 210 + n, AIR); // hollow interior
    // spikes from floor and ceiling
    for (let x = gx - rx + 6; x <= gx + rx - 6; x++) {
      for (let dir = -1; dir <= 1; dir += 2) {
        if (rand() > 0.16) continue;
        let y = gy + dir * (ry - 3); while (Math.abs(y - gy) > 0 && mat[y * W + x] === AIR && Math.abs(y - gy) < ry) y += dir;
        y -= dir;
        const len = randInt(2, 8);
        for (let k = 0; k < len; k++) { const yy = y - dir * k; if (mat[yy * W + x] === AIR) mat[yy * W + x] = M.CRYSTAL; if (k < len / 2 && mat[yy * W + x + 1] === AIR) mat[yy * W + x + 1] = M.CRYSTAL; }
      }
    }
    // granite shell outside the crystal is already the surrounding rock; add an access tunnel for geode 0
    if (n === 0) {
      const lv = lavas[3];
      let x = gx - rx, y = gy + 2;
      const tx = lv.x + lv.rx, ty = lv.y - 6;
      const steps = 80;
      for (let s = 0; s <= steps; s++) { const t = s / steps; carveDisc(x + (tx - x) * t, y + (ty - y) * t + Math.sin(t * 3) * 3, 7.5, 0); }
    }
    geodes.push({ x: gx, y: gy, rx, ry });
  });
  return { lavas, geodes };
}

// ---------------------------------------------------------------------------------------------------------------------
function inSiteExclusion(x: number) {
  const L = LOC;
  if (x > L.lake.l - 22 && x < L.lake.r + 22) return true;
  if (Math.abs(x - L.station.x) < 135) return true;
  if (Math.abs(x - L.hut.x) < 46) return true;
  if (Math.abs(x - L.spring.x) < L.spring.r + 22) return true;
  if (Math.abs(x - L.tower.x) < 70) return true;
  if (x > 1470 && x < 1830) return true;
  if (Math.abs(x - L.wreck.x) < 90) return true;
  if (x < 24 || x > W - 24) return true;
  return false;
}

function buildTrees() {
  let x = 30;
  while (x < W - 30) {
    const dens = clamp(fbm1((x + SO) / 210 + 3) * 2.1 - 0.45, 0, 1);
    x += Math.round(20 + (1 - dens) * 95 + rand() * 24);
    if (x >= W - 30 || inSiteExclusion(x)) continue;
    if (rand() > 0.35 + dens * 0.65) continue;
    const slope = Math.abs(surf[x + 5] - surf[x - 5]);
    if (slope > 6) continue;
    if (mat[surf[x] * W + x] === ICE || mat[surf[x] * W + x] === WATER) continue;
    const Ht = Math.round(60 + Math.pow(rand(), 0.8) * 80);
    spruce(x, surf[x], rockTop[x], Ht);
  }
}

function setT(x: number, y: number, m: number) {
  if (x < 6 || x >= W - 6 || y < 0 || y >= H) return;
  const i = y * W + x, c = mat[i];
  if (c !== AIR && !(m === M.WOOD && (c === SNOW || c === PACKED))) return;
  mat[i] = m; aux[i] = 0; flags[i] = F_TREE;
}
function spruce(xc: number, base: number, rock: number, Ht: number) {
  const top = base - Ht;
  const thick = Ht > 100 ? 1 : 0;
  for (let y = rock; y >= top + 5; y--) {
    const k = (rock - y) / (rock - top);
    const wdt = (k < 0.16 ? 5 : k < 0.45 ? 4 : k < 0.78 ? 3 : 2) - (thick ? 0 : 1) + (Ht > 120 ? 1 : 0);
    const x0 = xc - (wdt >> 1);
    for (let dx = 0; dx < wdt; dx++) {
      const xx = x0 + dx, y2 = y, i = y2 * W + xx;
      const c = mat[i]; if (c === AIR || c === SNOW || c === PACKED) { mat[i] = M.WOOD; aux[i] = 0; flags[i] = F_TREE; }
    }
  }
  const crownBottom = base - Math.floor(Ht * 0.2);
  const step = 8 + (Ht > 100 ? 2 : 0);
  const nT = Math.max(3, Math.floor((crownBottom - top - 6) / step));
  const maxHW = 5 + Ht * 0.115;
  for (let k = 0; k < nT; k++) {
    const yb = crownBottom - k * step, tierH = step + 4;
    const hwMax = 1.5 + (maxHW - 1.5) * Math.pow(1 - k / (nT + 0.5), 0.95);
    for (let r = 0; r < tierH; r++) {
      const y = yb - tierH + 1 + r, t = r / (tierH - 1);
      const hw = 0.8 + (hwMax - 0.8) * Math.pow(t, 0.8) + (rand() - 0.5) * 0.9;
      const w = Math.round(hw);
      for (let dx = -w; dx <= w; dx++) {
        if (Math.abs(dx) >= w - 1 && rand() < 0.16) continue;
        setT(xc + dx, y, M.NEEDLES);
      }
      if (r >= tierH - 3) {  // drooping boughs at the tier edge
        for (const sgn of [-1, 1]) { const dr = rand() < 0.65 ? randInt(1, 3) : 0; for (let q = 1; q <= dr; q++) setT(xc + sgn * (w - (q > 1 ? 1 : 0)), y + q, M.NEEDLES); }
      }
    }
  }
  // spire
  for (let y = top; y < top + 8; y++) { const w = y < top + 3 ? 0 : 1; for (let dx = -w; dx <= w; dx++) setT(xc + dx, y, M.NEEDLES); }
  // snow on the boughs
  const hw = Math.ceil(maxHW) + 4;
  for (let y = top - 1; y < crownBottom + 4; y++) for (let x = xc - hw; x <= xc + hw; x++) {
    if (x < 6 || x >= W - 6 || y < 1) continue;
    const i = y * W + x;
    if (mat[i] === M.NEEDLES && mat[i - W] === AIR && rand() < 0.62) { mat[i - W] = SNOW; aux[i - W] = 100 + ((rand() * 90) | 0); flags[i - W] = 0; }
  }
}

function buildBackgrounds() {
  // bg per tile: sky above the original surface; below, by material depth
  for (let ty = 0; ty < TH; ty++) {
    const cy = ty * 4 + 2;
    for (let tx = 0; tx < TW; tx++) {
      const x = Math.min(W - 1, tx * 4 + 2);
      let b = 0;
      if (cy >= surf[x]) {
        if (cy < rockTop[x]) b = 3;
        else if (cy < stoneTop[x]) b = 1;
        else if (cy < deepTop[x]) b = 2;
        else b = 4;
      }
      bg[ty * TW + tx] = b;
    }
  }
}
export { surf as surfaceTop, rockTop, stoneTop, deepTop };
export function surfaceAt(x: number) { return surf[Math.max(0, Math.min(W - 1, x | 0))]; }
