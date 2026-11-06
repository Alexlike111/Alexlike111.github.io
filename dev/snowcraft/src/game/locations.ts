// Locations (SPEC §4): site registry + stampers. Fixtures are records in G.fixtures; their footprint cells are marked MAT.FIXTURE + F_FIXTURE
// (doors only while closed). worldgen.ts calls stampLocations() after terrain, caves and trees exist.
import { G, Fixture, FixtureKind, Slot, Light, newId } from './state';
import { W, H, TW, mat, aux, flags, bg, F_FIXTURE, rand, randInt } from '../engine/grid';
import { MAT } from '../content/materials';
import { strings } from '../content/i18n';

// ---- shared layout constants (worldgen shapes the terrain around these) ----
export const LOC = {
  hut: { x: 260, y: 268 },
  lake: { l: 505, r: 815, y: 283 },
  station: { x: 1000, y: 272 },
  spring: { x: 1252, y: 294, r: 46 },        // y = water level (set by worldgen)
  tower: { x: 1405, y: 212 },
  ridge: { l: 1470, r: 1830 },
  wreck: { x: 1900, y: 262 },
  grotto: { x: 1292, y: 404, rx: 32, ry: 12 },
  spawn: { x: 1028, y: 272 },
};

const S = strings('site', {
  hut: 'Охотничья хижина', lake: 'Замёрзшее озеро', station: 'Метеостанция', spring: 'Горячий источник', tower: 'Смотровая вышка',
  ridge: 'Лавинный хребет', wreck: 'Обломки самолёта', icecave: 'Ледяные пещеры', grotto: 'Тёплый грот', crystals: 'Кристальная пещера', lava: 'Магматическая каверна',
  sign_station: 'МЕТЕОСТАНЦИЯ «СЕВЕРНАЯ»', sign_hut: 'Хижина охотника. Заходи, не стесняйся.', sign_spring: 'Тёплая вода. Не заплывай глубоко.',
  sign_ridge: 'ОПАСНО: лавины', sign_tower: 'Вышка. Вход со стороны ступеней.', sign_lake: 'Лёд тонкий в середине',
});

export type SiteKey = 'hut' | 'lake' | 'station' | 'spring' | 'tower' | 'ridge' | 'wreck' | 'icecave' | 'grotto' | 'crystals' | 'lava';
export interface Site { key: SiteKey; readonly name: string; x: number; y: number; w: number; h: number; found: boolean }
export const sites: Site[] = [];
export function addSite(key: SiteKey, x: number, y: number, w: number, h: number) {
  const s = { key, x, y, w, h, found: false } as Site;
  Object.defineProperty(s, 'name', { get: () => S[key], enumerable: true });
  sites.push(s); return s;
}
/** Site containing the cell (x,y) (with a margin in cells), or null. */
export function siteAt(x: number, y: number, margin = 0): Site | null {
  for (const s of sites) if (Math.abs(x - s.x) <= s.w / 2 + margin && Math.abs(y - s.y) <= s.h / 2 + margin) return s;
  return null;
}
/** Zones that should stay warm / unfrozen (read by the heat system): ellipse centre, radii in cells, minimum temperature °C. */
export interface WarmZone { key: string; x: number; y: number; rx: number; ry: number; temp: number }
export const warmZones: WarmZone[] = [];

export function resetLocations() { sites.length = 0; warmZones.length = 0; G.fixtures.length = 0; }

// ---- stamping helpers ----
function rectCells(x0: number, y0: number, x1: number, y1: number, m: number, fl = 0, onlyAir = false) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
    const i = y * W + x; if (onlyAir && mat[i] !== MAT.AIR) continue;
    mat[i] = m; aux[i] = 0; flags[i] = fl;
  }
}
/** inclusive tile rectangle -> cells */
function rectT(tx0: number, ty0: number, tx1: number, ty1: number, m: number, fl = 0, onlyAir = false) { rectCells(tx0 * 4, ty0 * 4, tx1 * 4 + 4, ty1 * 4 + 4, m, fl, onlyAir); }
function bgT(tx0: number, ty0: number, tx1: number, ty1: number, b: number) {
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) bg[ty * TW + tx] = b;
}
function isSoftSolid(m: number) { return m === MAT.SNOW || m === MAT.PACKED; }

function addFixture(kind: FixtureKind, tx: number, ty: number, tw: number, th: number, extra: Partial<Fixture> = {}): Fixture {
  const f: Fixture = { id: newId(), kind, tx, ty, tw, th, ...extra };
  G.fixtures.push(f);
  if (!(kind === 'door' && f.open) && kind !== 'torch') rectCells(tx * 4, ty * 4, (tx + tw) * 4, (ty + th) * 4, MAT.FIXTURE, F_FIXTURE);
  return f;
}
const slot = (id: string, n: number): Slot => ({ id, n });

// ---- loot ----
const LOOT: { id: string; w: number; min: number; max: number; deep?: boolean }[] = [
  { id: 'coal', w: 10, min: 3, max: 8 }, { id: 'stick', w: 8, min: 3, max: 8 }, { id: 'torch', w: 8, min: 1, max: 3 },
  { id: 'cracker', w: 8, min: 1, max: 3 }, { id: 'can', w: 6, min: 1, max: 2 }, { id: 'choc', w: 4, min: 1, max: 1 },
  { id: 'rope', w: 5, min: 1, max: 2 }, { id: 'copper_ore', w: 6, min: 2, max: 5 }, { id: 'iron_ore', w: 5, min: 2, max: 4 },
  { id: 'scrap', w: 5, min: 2, max: 5 }, { id: 'fat', w: 3, min: 1, max: 2 }, { id: 'bough', w: 3, min: 2, max: 5 },
  { id: 'iron', w: 2, min: 1, max: 2, deep: true }, { id: 'lantern', w: 1.2, min: 1, max: 1, deep: true }, { id: 'pick_stone', w: 1.5, min: 1, max: 1 },
];
function randomLoot(deep: boolean, note?: string): Slot[] {
  const pool = LOOT.filter(l => deep || !l.deep), total = pool.reduce((a, l) => a + l.w, 0);
  const out: Slot[] = [], kinds = randInt(3, 5), mul = G.diff.loot;
  for (let k = 0; k < kinds; k++) {
    let r = rand() * total, pick = pool[0];
    for (const l of pool) { r -= l.w; if (r <= 0) { pick = l; break; } }
    if (out.some(s => s.id === pick.id)) continue;
    out.push(slot(pick.id, Math.max(1, Math.round(randInt(pick.min, pick.max) * mul))));
  }
  if (note) out.push(slot(note, 1));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
export interface WorldInfo {
  surf: Int16Array; rockTop: Int16Array; stoneTop: Int16Array; deepTop: Int16Array;
  chambers: { x: number; y: number; rx: number; ry: number; zone: number }[];
  cavePts: { x: number; y: number; r: number }[];
  pockets: { kind: 'methane' | 'oil'; x: number; y: number; r: number }[];
  deep: { lavas: { x: number; y: number; rx: number; ry: number }[]; geodes: { x: number; y: number; rx: number; ry: number }[] };
}
interface Carvers { carveDisc: (cx: number, cy: number, r: number, minY?: number, fill?: number) => void; carveEllipse: (cx: number, cy: number, rx: number, ry: number, n: number, seed: number, fill?: number, minY?: number) => void }

/** A cabin: log walls, plank floor/roof with a stepped gable, snow on the roof, wooden interior wall. Returns the interior tile rectangle. */
function cabin(L: number, R: number, F: number, n: number, opts: { windowRows?: [number, number]; smokeHoleCol?: number }) {
  const top = F - n;                    // first interior row
  // clear space (also removes stray snow) and lay foundations under the walls
  rectT(L - 1, top - 8, R + 1, F - 1, MAT.AIR);
  for (const wc of [L, R]) for (let y = (F + 1) * 4; y < (F + 4) * 4 + 8; y++) for (let x = wc * 4; x < wc * 4 + 4; x++) { const i = y * W + x; if (isSoftSolid(mat[i]) || mat[i] === MAT.AIR) { mat[i] = MAT.LOG; aux[i] = 0; flags[i] = 0; } }
  rectT(L, F, R, F, MAT.PLANK);                             // floor at ground level
  rectT(L, top, L, F - 1, MAT.LOG);                         // walls
  rectT(R, top, R, F - 1, MAT.LOG);
  bgT(L + 1, top, R - 1, F - 1, 5);
  rectT(L - 1, top - 1, R + 1, top - 1, MAT.LOG);           // eave row with overhang
  let kmax = 0;
  for (let k = 1; ; k++) {
    const lo = L + 1 + 2 * (k - 1), hi = R - 1 - 2 * (k - 1);
    if (lo > hi) break;
    rectT(lo, top - 1 - k, hi, top - 1 - k, MAT.PLANK); kmax = k;
  }
  if (opts.smokeHoleCol !== undefined) { rectT(opts.smokeHoleCol, top - 2, opts.smokeHoleCol, top - 1, MAT.AIR); }
  if (opts.windowRows) rectT(L, opts.windowRows[0], L, opts.windowRows[1], MAT.GLASS);
  // snow on the roof: a 1:2 slope through the outer step corners
  const cx = ((L - 1) * 4 + (R + 2) * 4) / 2, topY = (top - 1 - kmax) * 4;
  for (let x = (L - 1) * 4; x < (R + 2) * 4; x++) {
    if (opts.smokeHoleCol !== undefined && x >= opts.smokeHoleCol * 4 - 1 && x < opts.smokeHoleCol * 4 + 5) continue;
    const sy = Math.round(topY - 3 + Math.abs(x + 0.5 - cx) * 0.5);
    let y = sy;
    while (y < H && mat[y * W + x] === MAT.AIR) y++;
    for (let yy = sy; yy < y; yy++) { const i = yy * W + x; mat[i] = yy === sy ? MAT.SNOW : MAT.PACKED; aux[i] = yy === sy ? 30 : 255; flags[i] = 0; }
  }
  return { top, F };
}

export function stampLocations(info: WorldInfo, c: Carvers) {
  void c;
  stampStation(info); stampHut(info); stampLake(); stampSpring(info); stampTower(info); stampRidge(); stampWreck(info);
  stampCaves(info);
}

function stampStation(info: WorldInfo) {
  const L = 236, R = 251, F = 68, n = 6;
  const { top } = cabin(L, R, F, n, { windowRows: [64, 65] });
  // door in the east wall (5 tiles tall, standing on the floor)
  addFixture('door', R, F - 5, 1, 5, { open: false });
  // furniture: bed (west), chest, radio, stove (east, near the door)
  addFixture('bed', 238, F - 1, 4, 1);
  const chest = addFixture('chest', 243, F - 2, 2, 2, { items: [slot('cracker', 3), slot('choc', 1), slot('stone', 6), slot('note_1', 1)] });
  void chest;
  addFixture('radio', 246, F - 2, 2, 2, { data: { fixed: false, parts: 0 } });
  addFixture('stove', 248, F - 2, 2, 2, { fuel: 0, lit: false, data: { smokeX: 996, smokeY: 232 } });
  // stove pipe through the roof
  rectCells(995, 230, 997, 256, MAT.METAL, 0);
  // weather mast on the ridge: pole, cross arms, vane
  rectCells(975, 188, 977, 226, MAT.METAL); rectCells(967, 198, 985, 200, MAT.METAL); rectCells(971, 208, 981, 209, MAT.METAL); rectCells(973, 184, 979, 186, MAT.METAL);
  // helipad east of the house
  addFixture('helipad', 258, F, 12, 1);
  // sign near the door
  addFixture('sign', 254, F - 2, 2, 2, { data: { text: S.sign_station, key: 'site.sign_station' } });
  addSite('station', (L + R) * 2 + 2, (top + F) * 2, 96, 80);
  // the area just outside should not be roofed by snow: flatten loose snow on the pad
  for (let x = 1004; x < 1084; x++) for (let y = 262; y < 272; y++) { const i = y * W + x; if (mat[i] === MAT.SNOW) mat[i] = MAT.AIR; }
  void info;
}

function stampHut(info: WorldInfo) {
  const L = 60, R = 70, F = 67, n = 5;
  const { top } = cabin(L, R, F, n, { smokeHoleCol: 68 });
  addFixture('door', R, F - 5, 1, 5, { open: false });
  addFixture('bed', 61, F - 1, 4, 1);
  addFixture('chest', 66, F - 2, 2, 2, { items: [slot('spear', 1), slot('cracker', 2), slot('fat', 1), slot('rope', 2), slot('note_2', 1)] });
  addFixture('campfire', 68, F - 1, 2, 1, { fuel: 0, lit: false });
  addFixture('sign', 72, F - 2, 2, 2, { data: { text: S.sign_hut, key: 'site.sign_hut' } });
  addSite('hut', (L + R) * 2 + 2, (top + F) * 2, 56, 60);
  void info;
}

function stampLake() {
  const { l, r, y } = LOC.lake;
  addSite('lake', (l + r) / 2, y + 12, r - l, 40);
  addFixture('sign', Math.floor((l - 14) / 4), Math.floor((y - 8) / 4), 2, 2, { data: { text: S.sign_lake, key: 'site.sign_lake' } });
}

function stampSpring(info: WorldInfo) {
  const { x, y, r } = LOC.spring;
  warmZones.push({ key: 'spring', x, y: y + 4, rx: r * 0.5, ry: 12, temp: 38 });
  warmZones.push({ key: 'springAir', x, y: y - 8, rx: r * 0.8, ry: 14, temp: -2 });
  // rocks around the pool and steam above it
  for (let k = 0; k < 26; k++) {
    const side = rand() < 0.5 ? -1 : 1, px = x + side * randInt(18, 24);
    let py = y - 14; while (py < H && (mat[py * W + px] === MAT.AIR)) py++;
    if (mat[(py - 1) * W + px] === MAT.AIR) { mat[(py - 1) * W + px] = MAT.STONE; if (rand() < 0.55) mat[(py - 2) * W + px] = MAT.STONE; }
  }
  for (let k = 0; k < 140; k++) {
    const py = y - 1 - randInt(0, 38), spread = 4 + (y - py) * 0.35, px = Math.round(x + (rand() + rand() + rand() - 1.5) * spread * 1.4);
    if (mat[py * W + px] === MAT.AIR) { mat[py * W + px] = MAT.STEAM; aux[py * W + px] = randInt(120, 400); }
  }
  addSite('spring', x, y - 4, r * 2, 50);
  addFixture('sign', Math.floor((x - r - 4) / 4), Math.floor((info.surf[x - r - 4] - 8) / 4), 2, 2, { data: { text: S.sign_spring, key: 'site.sign_spring' } });
}

function stampTower(info: WorldInfo) {
  const gP = LOC.tower.y / 4;                 // tile row of the hilltop plateau
  const px0 = 351, px1 = 360;                 // platform tiles
  const pr = gP - 8;                          // platform tile row (top surface at pr*4)
  // stairs: 3 steps of 3 tiles to the west, each 2 rows higher
  const floorBelow = (x0: number, x1: number, fromY: number) => {      // log pillar from fromY down to solid ground
    for (let x = x0; x < x1; x++) for (let y = fromY; y < fromY + 80; y++) { const i = y * W + x; if (mat[i] !== MAT.AIR && !isSoftSolid(mat[i]) && mat[i] !== MAT.LOG && mat[i] !== MAT.PLANK) break; if (mat[i] === MAT.AIR || isSoftSolid(mat[i])) { mat[i] = MAT.LOG; aux[i] = 0; flags[i] = 0; } }
  };
  for (let k = 1; k <= 3; k++) {
    const c0 = px0 - 3 * (4 - k) - 0, c1 = c0 + 2, row = gP - 2 * k + 0;
    // keep step k two rows above step k-1 (k=1 is 2 rows above the plateau)
    rectT(c0, row, c1, row, MAT.PLANK);
    floorBelow(c1 * 4, c1 * 4 + 4, (row + 1) * 4);
    floorBelow(c0 * 4, c0 * 4 + 4, (row + 1) * 4);
  }
  // platform deck and legs
  rectT(px0 - 1, pr, px1 + 1, pr, MAT.PLANK);
  for (const c of [px0 - 1, px0 + 3, px0 + 6, px1 + 1]) floorBelow(c * 4, c * 4 + 4, (pr + 1) * 4);
  // cross braces
  for (let k = 0; k < 8; k++) { rectCells((px0 + 3) * 4 + k * 3, (pr + 1) * 4 + k * 4, (px0 + 3) * 4 + k * 3 + 4, (pr + 1) * 4 + k * 4 + 4, MAT.LOG); }
  // cabin on the deck: east wall + lintel, roof, open doorway to the west
  const top = pr - 6;
  rectT(px0, top - 1, px1, top - 1, MAT.LOG);
  rectT(px1, top, px1, pr - 1, MAT.LOG);
  rectT(px0, top, px0, top, MAT.LOG);
  rectT(px0 - 1, top - 2, px1 + 1, top - 2, MAT.PLANK);
  rectT(px0 + 1, top - 3, px1 - 1, top - 3, MAT.PLANK);
  rectT(px1, pr - 4, px1, pr - 3, MAT.GLASS);
  bgT(px0 + 1, top, px1 - 1, pr - 1, 5);
  // snow on the cabin roof
  for (let x = (px0 - 1) * 4; x < (px1 + 2) * 4; x++) {
    const cx = ((px0 - 1) * 4 + (px1 + 2) * 4) / 2, sy = Math.round((top - 3) * 4 - 3 + Math.abs(x + 0.5 - cx) * 0.4);
    let y = sy; while (y < H && mat[y * W + x] === MAT.AIR) y++;
    for (let yy = sy; yy < y; yy++) { const i = yy * W + x; mat[i] = yy === sy ? MAT.SNOW : MAT.PACKED; aux[i] = yy === sy ? 30 : 255; }
  }
  addFixture('chest', 355, pr - 2, 2, 2, { items: [slot('can', 2), slot('rope', 1), slot('torch', 2), slot('coal', 4), slot('note_3', 1)] });
  addFixture('sign', 345, Math.floor(info.surf[1380] / 4) - 2, 2, 2, { data: { text: S.sign_tower, key: 'site.sign_tower' } });
  addSite('tower', 1424, pr * 4 - 8, 150, 150);
}

function stampRidge() {
  const { l, r } = LOC.ridge;
  addSite('ridge', (l + r) / 2, 220, r - l, 120);
  addFixture('sign', Math.floor((l + 6) / 4), Math.floor(surfaceY(l + 6) / 4) - 2, 2, 2, { data: { text: S.sign_ridge, key: 'site.sign_ridge' } });
}
function surfaceY(x: number) { let y = 0; while (y < H - 1 && (mat[y * W + x] === MAT.AIR || mat[y * W + x] === MAT.FIXTURE)) y++; return y; }

function stampWreck(info: WorldInfo) {
  const cx0 = LOC.wreck.x;
  // axis from the raised tail (east) down into the snow at the nose (west)
  const ax = cx0 + 40, ay = info.surf[cx0 + 40] - 26, bx = cx0 - 38, by = info.surf[cx0 - 38] - 4;
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy, len = Math.sqrt(len2);
  const Ro = 15, Ri = 10.8;
  // trench scraped by the crash, west of the nose
  for (let x = cx0 - 110; x < cx0 - 36; x++) {
    const d = Math.round(7 * Math.min(1, (x - (cx0 - 110)) / 30) * (1 - Math.max(0, (x - (cx0 - 50)) / 14)));
    for (let k = 0; k < d; k++) { const i = (info.surf[x] + k) * W + x; if (isSoftSolid(mat[i])) { mat[i] = MAT.AIR; aux[i] = 0; } }
  }
  // snow bank under the raised tail so it rests on something
  for (let x = cx0 - 44; x <= cx0 + 52; x++) {
    const t = ((x - ax) * dx) / len2; // not exact; just build a mound toward the tail
    void t;
    const belly = ay + (by - ay) * ((x - ax) / (bx - ax)) + Ro;
    for (let y = Math.round(belly); y < info.surf[x]; y++) { const i = y * W + x; if (mat[i] === MAT.AIR) { mat[i] = MAT.PACKED; aux[i] = 255; flags[i] = 0; } }
  }
  // the hull
  for (let y = Math.min(ay, by) - 20; y < Math.max(ay, by) + 20; y++) for (let x = Math.min(ax, bx) - 20; x < Math.max(ax, bx) + 20; x++) {
    const px = x - ax, py = y - ay;
    let t = (px * dx + py * dy) / len2;
    const tc = Math.max(0, Math.min(1, t));
    const qx = ax + dx * tc, qy = ay + dy * tc, d = Math.hypot(x - qx, y - qy);
    // nose cone: radius shrinks near t -> 1 (west end, toward b)
    let ro = Ro, ri = Ri;
    if (t > 0.86) { const k = Math.max(0, 1 - (t - 0.86) / 0.2); const s = Math.sqrt(Math.max(0, k)); ro = Ro * s; ri = Ri * s * 0.97; }
    if (t < -0.02 || t > 1.06) continue;
    // ragged broken tail end
    if (t < 0.05 && ((x * 7 + y * 3) % 9) < 3 && d > Ri) continue;
    if (d <= ro) {
      const i = y * W + x;
      if (mat[i] === MAT.FIXTURE) continue;
      if (d > ri) { mat[i] = MAT.METAL; aux[i] = 0; flags[i] = 0; }
      else { mat[i] = MAT.AIR; aux[i] = 0; flags[i] = 0; }
    }
  }
  // the roof of the cabin section is ripped open (daylight pours in, the cargo is visible from above)
  for (let y = Math.min(ay, by) - 24; y < Math.max(ay, by) + 6; y++) for (let x = Math.min(ax, bx) - 4; x < Math.max(ax, bx) + 4; x++) {
    const t = ((x - ax) * dx + (y - ay) * dy) / len2;
    if (t < 0.22 || t > 0.62) continue;
    const qx = ax + dx * t, qy = ay + dy * t, jag = ((x * 5 + y * 3) % 7) * 0.4;
    if (y < qy - 3 - jag && y > qy - Ro - 3 && Math.hypot(x - qx, y - qy) <= Ro + 0.5) { const i = y * W + x; if (mat[i] === MAT.METAL) mat[i] = MAT.AIR; }
  }
  // torn openings in the shell let the light in
  for (let k = 0; k < 3; k++) {
    const t = 0.2 + k * 0.28 + rand() * 0.06, qx = ax + dx * t, qy = ay + dy * t - Ro + 1;
    for (let yy = -3; yy <= 3; yy++) for (let xx = -4; xx <= 4; xx++) { if (xx * xx + yy * yy * 2.2 > 18 + rand() * 6) continue; const i = (Math.round(qy) + yy) * W + Math.round(qx) + xx; if (mat[i] === MAT.METAL) { mat[i] = MAT.AIR; } }
  }
  // windows along the upper side
  for (let k = 1; k <= 5; k++) {
    const t = 0.1 + k * 0.14, qx = ax + dx * t, qy = ay + dy * t - (Ro - 1.5);
    for (let yy = -2; yy <= 2; yy++) for (let xx = -2; xx <= 2; xx++) { const i = (Math.round(qy) + yy) * W + Math.round(qx) + xx; if (mat[i] === MAT.METAL) { mat[i] = MAT.GLASS; } }
  }
  // tail fin and a wing stub
  for (let k = 0; k < 26; k++) { const w = Math.max(2, 7 - (k >> 2)), fx = Math.round(ax - 14 + k * 0.55); rectCells(fx, ay - Ro - k + 3, fx + w, ay - Ro - k + 4, MAT.METAL); }
  for (let k = 0; k < 46; k++) { const wx = Math.round(cx0 + 4 + k * 0.9), wy = Math.round(by - 2 + k * 0.28 - 4); rectCells(wx, wy, wx + 1, wy + 3, MAT.METAL); }
  // interior background and seats
  const bx0 = Math.min(ax, bx) >> 2, bx1 = Math.max(ax, bx) >> 2, by0 = (Math.min(ay, by) - 18) >> 2, by1 = (Math.max(ay, by) + 18) >> 2;
  for (let ty = by0; ty <= by1; ty++) for (let tx = bx0; tx <= bx1; tx++) {
    let inside = 0;
    for (let k = 0; k < 16; k++) { const x = tx * 4 + (k & 3), y = ty * 4 + (k >> 2); if (mat[y * W + x] === MAT.AIR) inside++; }
    if (inside > 10) {
      const wx = tx * 4 + 2, wy = ty * 4 + 2, t = ((wx - ax) * dx + (wy - ay) * dy) / len2, d = Math.hypot(wx - (ax + dx * t), wy - (ay + dy * t));
      if (t > 0 && t < 0.95 && d < Ri) bg[ty * TW + tx] = 4;
    }
  }
  // passenger seats: low METAL benches along the cabin floor
  for (let k = 0; k < 5; k++) {
    const t = 0.34 + k * 0.085, qx = Math.round(ax + dx * t), qy = Math.round(ay + dy * t);
    let fy = qy; while (mat[fy * W + qx] === MAT.AIR && fy < qy + 30) fy++;
    if (mat[fy * W + qx] === MAT.METAL) { rectCells(qx - 2, fy - 4, qx + 3, fy, MAT.METAL); rectCells(qx - 2, fy - 8, qx - 1, fy - 4, MAT.METAL); }
  }
  // the cache: chest on a small cargo box near the tail section
  {
    const t = 0.3, qx = Math.round(ax + dx * t), qy = Math.round(ay + dy * t);
    let fy = qy; while (mat[fy * W + qx] === MAT.AIR) fy++;
    const tx = (qx >> 2) - 1, ty = Math.floor((fy - 8) / 4);
    rectCells(tx * 4 - 1, ty * 4 + 8, tx * 4 + 9, fy + 6, MAT.METAL);
    rectT(tx, ty, tx + 1, ty + 1, MAT.AIR);
    addFixture('chest', tx, ty, 2, 2, { items: [slot('battery', 1), slot('scrap', 3), slot('can', 1), slot('note_4', 1)] });
  }
  // scattered debris
  for (let k = 0; k < 26; k++) {
    const x = cx0 + randInt(-110, 70), s = info.surf[x];
    const w = randInt(2, 5), h = randInt(1, 3);
    rectCells(x, s - h, x + w, s, MAT.METAL);
    if (rand() < 0.4) { const i = (s - h - 1) * W + x; if (mat[i] === MAT.AIR) { mat[i] = MAT.ASH; } }
  }
  addSite('wreck', cx0 - 2, by - 8, 150, 80);
}

function stampCaves(info: WorldInfo) {
  const ch = info.chambers;
  const chestOnFloor = (cx: number, cy: number, items: Slot[]) => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const x = cx + randInt(-10, 10);
      let y = cy; let guard = 0; while (y < H - 8 && mat[y * W + x] !== MAT.AIR && guard++ < 30) y--;      // start inside air
      while (y < H - 8 && mat[y * W + x] === MAT.AIR) y++;
      const fy = Math.min(y, (() => { let yy = cy; while (yy < H - 8 && mat[yy * W + x + 8] === MAT.AIR) yy++; return yy; })());
      const tx = x >> 2, ty = Math.floor((fy - 8) / 4);
      // need 2×2 tiles of air above the floor
      let ok = true;
      for (let yy = ty * 4 - 4; yy < ty * 4 + 8 && ok; yy++) for (let xx = tx * 4; xx < tx * 4 + 8; xx++) { const m = mat[yy * W + xx]; if (m !== MAT.AIR) { ok = false; break; } }
      if (!ok) continue;
      rectCells(tx * 4, ty * 4 + 8, tx * 4 + 8, fy + 2, MAT.STONE);
      addFixture('chest', tx, ty, 2, 2, { items });
      return true;
    }
    return false;
  };
  const byZone = (z: number) => ch.filter(c => c.zone === z);
  // ice caves: pick the biggest, register as a site, add a cache
  const ice = byZone(3).sort((a, b) => b.rx - a.rx);
  if (ice[0]) { addSite('icecave', ice[0].x, ice[0].y, ice[0].rx * 2.4, ice[0].ry * 3); chestOnFloor(ice[0].x, ice[0].y, randomLoot(false)); }
  if (ice[1]) chestOnFloor(ice[1].x, ice[1].y, randomLoot(false));
  // grotto
  const g = LOC.grotto;
  addSite('grotto', g.x, g.y, g.rx * 2 + 10, g.ry * 2 + 10);
  warmZones.push({ key: 'grotto', x: g.x, y: g.y, rx: g.rx + 8, ry: g.ry + 6, temp: 14 });
  warmZones.push({ key: 'grottoPool', x: g.x, y: g.y + g.ry - 2, rx: 14, ry: 6, temp: 36 });
  chestOnFloor(g.x - g.rx + 8, g.y, [slot('can', 1), slot('choc', 2), slot('tea', 1), slot('note_5', 1)]);
  // mid and deep caches
  const mid = byZone(1); if (mid[0]) chestOnFloor(mid[0].x, mid[0].y, randomLoot(false)); if (mid[1]) chestOnFloor(mid[1].x, mid[1].y, randomLoot(true));
  const lavas = info.deep.lavas;
  if (lavas[0]) { const lv = lavas[0]; addSite('lava', lv.x, lv.y, lv.rx * 2 + 20, lv.ry * 2 + 20); }
  const deep = byZone(2); if (deep[0]) chestOnFloor(deep[0].x, deep[0].y, randomLoot(true, 'note_6'));
  const geo = info.deep.geodes[0];
  if (geo) addSite('crystals', geo.x, geo.y, geo.rx * 2 + 16, geo.ry * 2 + 16);
}

// ---- lights from fixtures (pooled; call once per frame) ----
const pool: Light[] = [];
export function collectFixtureLights(out: Light[]) {
  let n = 0;
  const take = (x: number, y: number, r: number, g: number, b: number, rad: number) => {
    const l = pool[n] ?? (pool[n] = { x: 0, y: 0, r: 0, g: 0, b: 0, rad: 0 });
    l.x = x; l.y = y; l.r = r; l.g = g; l.b = b; l.rad = rad; n++; out.push(l);
  };
  const t = G.realTime;
  for (const f of G.fixtures) {
    if (!f.lit) continue;
    const fl = 0.93 + 0.07 * Math.sin(t * 13 + f.id * 3.1) * Math.sin(t * 7.3 + f.id);
    const cx = f.tx * 4 + f.tw * 2, cy = f.ty * 4 + f.th * 2;
    if (f.kind === 'campfire') take(cx, cy - 4, 1.0 * fl, 0.6 * fl, 0.26 * fl, 10);
    else if (f.kind === 'stove') take(cx, cy, 1.0 * fl, 0.55 * fl, 0.22 * fl, 12);
    else if (f.kind === 'torch') take(cx, cy - 4, 1.0 * fl, 0.66 * fl, 0.32 * fl, 7);
    else if (f.kind === 'lantern') take(cx, cy, 1.0, 0.82, 0.5, 10);
  }
  return n;
}
