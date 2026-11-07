// Fixture art: one function per FixtureKind. Fixed-size furniture is a sprite ('fx.*', outlined, bottom-anchored to the footprint);
// variable parts (flames, glow, steam, flags, anemometers, tripods, mast lattice) are drawn from code. Footprints are in TILES (4 cells).
import { G, type Fixture, type View } from '../game/state';
import { defSprite, outline, compose, drawSprite, spriteSize, drawFlame, hasSprite, PAL, type Rows, type Palette } from '../engine/sprites';
import { Grid } from './grid';
import { drawStationArt, drawChestExtras, STATION_SHEET } from './fixtures_station';

const TS = 4;
/** Outline without the bottom row so the sprite rests exactly on the footprint floor. */
function fxs(key: string, rows: Rows, pal: Palette = PAL) { const o = outline(rows); defSprite(key, pal, o.slice(0, o.length - 1)); }
const hf = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

// ---------------------------------------------------------------------------------------------------------------------------------- chests
const CHEST_LOOKS: Record<string, Palette> = {
  wood: {},
  tin: { t: '#f0f4f8', w: '#bcc6d2', W: '#7f8b9b', z: '#566176', y: '#e0c060' },
  old: { t: '#c4b498', w: '#9f8d74', W: '#6c5e4d', z: '#4d5160', y: '#9a8a60' },
  miner: { t: '#86b296', w: '#53846c', W: '#31594a', z: '#aab2ba', y: '#e8c050' },
  captain: { t: '#b87a50', w: '#8b5030', W: '#55301d', z: '#d9ad45', y: '#f6d56a' },
  tool: { t: '#ee6c52', w: '#c64b38', W: '#8c2d26', z: '#9aa2ad', y: '#e8c050' },
  crew: { t: '#9a9bad', w: '#72778a', W: '#4a4e61', z: '#c0a050', y: '#e0c060' },
  bench: { t: '#d9b27c', w: '#c89a62', W: '#8e5f38', z: '#6d7482', y: '#e0c060' },
};
const CHEST_CLOSED: Rows = ['tttttttt', 'wwwwwwww', 'WWWWWWWW', 'zwwyywwz', 'zwwyywwz', 'wwwwwwww', 'WWWWWWWW'];
const CHEST_OPEN: Rows = ['.tttttt.', '.wwwwww.', 'KKKKKKKK', 'KyKcKKwK', 'zwwwwwwz', 'zwwyywwz', 'WWWWWWWW'];
const CHEST_BROKEN: Rows = ['..t.....', '.wwwKtt.', 'WKKKKKKW', 'zKcKyKKz', 'zwwwwwwz', 'wwwyywwW', 'WWWWWWWW'];
for (const look in CHEST_LOOKS) {
  const pal = { ...PAL, ...CHEST_LOOKS[look] };
  fxs('fx.chest.' + look, CHEST_CLOSED, pal); fxs('fx.chest.' + look + '.open', CHEST_OPEN, pal); fxs('fx.chest.' + look + '.broken', CHEST_BROKEN, pal);
}
// ---------------------------------------------------------------------------------------------------------------------------------- misc furniture
const DRUM_PAL = (c: string, h: string, d: string): Palette => ({ ...PAL, b: c, s: h, B: d });
const DRUM: Rows = ['.zzzzzz.', 'zSsssssz', 'bbbbbbbb', 'BBBBBBBB', 'bbbyybbb', 'bbbyybbb', 'BBBBBBBB', 'zzzzzzzz'];
fxs('fx.drum.blue', DRUM, DRUM_PAL('#3d72ad', '#7fb0e0', '#264c7c'));
fxs('fx.drum.green', DRUM, DRUM_PAL('#4f7d52', '#8dbf8a', '#2e5233'));
fxs('fx.drum.rust', DRUM, DRUM_PAL('#9a5a3a', '#c98a62', '#6a3a26'));
fxs('fx.stove', ['..zSSz..', '.zzzzzz.', 'lhhhhhhl', 'lkkkkkkl', 'lkkkkykl', 'lkkkkkkl', 'lhhhhhhl', '.l....l.'], { ...PAL, l: '#3a3c48', h: '#6c7080', k: '#23242c' });
fxs('fx.table', [
  '.....hh.hhh.',
  '.....Hh.Hhh.',
  'tttttttttttt',
  'WWWWWWWWWWWW',
  '.ww......ww.',
  '.ww.dddd.ww.',
  '.ww......ww.',
  '.ww......ww.',
]);
fxs('fx.shelf', [
  'WWWWWWWW', 'W.a.yr.W', 'W.a.yr.W', 'WwwwwwwW', 'Wc.nn.cW', 'Wc.nn.cW', 'WwwwwwwW', 'WWWWWWWW',
]);
fxs('fx.bed', [
  'W...............',
  'Wnnn..oooooooooW',
  'WnnnrrrrrrrrrrrW',
  'WWWWWWWWWWWWWWWW',
  'W..............W',
], { ...PAL, o: '#e0a8a0', r: '#a8423e' });
fxs('fx.skin_bed', [
  '..xxxxx.xxxxx...',
  '.xXxxxxxxXxxxx..',
  'xxxXxxxxxxXxxxxx',
  'uuuuuuuuuuuuuuuu',
]);
fxs('fx.cache', [
  '....hhhh....', '..hhHHHHhh..', '.hHHHHHHHHh.', 'hhHHhhhHHHHh', 'hHHhKKKhHHHh', 'hHHHKKKHhHHh', 'hhhhhhhhhhhh',
].map(r => r.slice(0, 12)));
fxs('fx.cairn', [
  '...hh...', '..hHHh..', '.hHHHHh.', '.hhhhhh.', 'hHHhHHHh', 'hhHHHhHh', 'HhhhhhhH',
]);
fxs('fx.lantern', ['.zzz.', 'z...z', 'zyEyz', 'zEeEz', 'zyEyz', 'zzzzz'].map(r => r), PAL);
fxs('fx.lantern_off', ['.zzz.', 'z...z', 'zhhhz', 'zhHhz', 'zhhhz', 'zzzzz']);
fxs('fx.lamp', ['.HHHHHH.', 'HhhcchhH', '.HHHHHH.'], PAL);
fxs('fx.torch', ['.U.', 'UuU', '.W.', '.w.', '.W.', '.w.', '.W.', '.w.']);
fxs('fx.torch_burnt', ['.k.', 'klk', '.W.', '.w.', '.W.', '.w.', '.W.', '.w.']);
fxs('fx.brazier', ['zzzzzzzz', 'zhhhhhhz', 'zllllllz', 'zlklklkz', 'zllllllz', 'zlklklkz', 'zzzzzzzz', '.z....z.'], PAL);
fxs('fx.pot', ['.h...h.', '.hhhhh.', 'zzzzzzz', 'zlllllz', 'zllhllz', '.zlllz.'], PAL);
fxs('fx.drying_rack', [
  'WWWWWWWWWWWWWW',
  'W............W',
  'Wrr.cc..NN.rrW',
  'Wrr.cc..NN.rrW',
  'W.r.cc..NN..rW',
  'W...c...N....W',
  'W............W',
  'W............W',
]);
fxs('fx.sign', ['tttttttt', 'tKKtKKKt', 'tttttttt', 'tKKKtKtt', 'tttttttt', '.W..W...'.replace('.W..W...', '...WW...'), '...WW...', '...WW...']);
fxs('fx.snare_set', ['..W..', '.tt.t', 't...t', 't...t', '.ttt.', 'WWWWW'].map((r, i) => (i === 5 ? '..W..' : r)));
fxs('fx.snare_off', ['..W...', '..W...', '.ttttt', 'W.....'].map(r => r));
fxs('fx.bird', ['.nnnn.', 'nnNnnn', 'oo..oo'], { ...PAL });

// ---- radio / barometer / kennel / cart / door built with Grid ------------------------------------------------------------------------
{
  const g = new Grid(8, 8);
  g.rect(0, 1, 8, 7, 'K'); g.rect(0, 1, 8, 1, 'k'); g.rect(1, 2, 3, 3, 'l'); for (const [x, y] of [[1, 2], [3, 2], [2, 3], [1, 4], [3, 4]]) g.set(x, y, 'k');
  g.rect(5, 2, 2, 2, 'k'); g.rect(5, 5, 1, 1, 'n'); g.rect(7, 5, 1, 1, 'n'); g.rect(1, 6, 6, 1, 'l'); g.rect(0, 0, 3, 1, 'S');
  g.line(6, 1, 6, 0, 'S');
  fxs('fx.radio', g.rows(), { ...PAL, K: '#5d6f50', k: '#2a3326', l: '#3c4a38', n: '#c7ccb8' });
}
{
  const g = new Grid(8, 13);
  g.rect(3, 0, 1, 3, 'S');                                  // anemometer mast
  g.rect(0, 3, 8, 5, 'n'); g.rect(0, 3, 8, 1, 'N');         // louvred screen
  for (const y of [5, 7]) g.rect(0, y, 8, 1, 'N');
  g.rect(1, 8, 1, 5, 'W'); g.rect(6, 8, 1, 5, 'W'); g.rect(0, 8, 8, 1, 'N');
  g.rect(2, 4, 4, 3, 'W');                                  // dial plate
  g.rect(3, 5, 2, 1, 'n'); g.set(4, 5, 'r');
  fxs('fx.barometer', g.rows(), { ...PAL, W: '#8e8f9c' });
}
{
  // kennel 22×13
  const g = new Grid(22, 13);
  for (let y = 0; y < 6; y++) { const w = 4 + y * 3.2; g.rect(Math.round(11 - w / 2), y, Math.round(w), 1, y < 1 ? 'n' : y < 2 ? 'N' : y % 2 ? 'W' : 'w'); }
  g.rect(2, 6, 18, 7, 'w'); for (let x = 2; x < 20; x += 3) g.rect(x, 6, 1, 7, 'W');
  g.rect(0, 5, 22, 1, 'T'); g.rect(1, 4, 20, 1, 'W');
  g.rect(8, 7, 7, 6, 'k'); g.rect(9, 6, 5, 1, 'k'); g.rect(10, 5, 3, 1, 'k');
  g.rect(9, 3, 4, 2, 'y'); g.set(10, 3, 'K'); g.set(12, 4, 'K');
  g.rect(16, 11, 3, 2, 'S'); g.rect(17, 11, 1, 1, 'c');
  g.rect(2, 12, 18, 1, 'd');
  fxs('fx.kennel', g.rows(), PAL);
}
{
  // mine cart 18×10 : box + coal + wheels
  const g = new Grid(18, 10);
  g.rect(0, 3, 18, 5, 'z'); g.rect(1, 3, 16, 1, 'S'); g.rect(1, 4, 16, 3, 'h'); g.rect(0, 7, 18, 1, 'l');
  for (const x of [2, 8, 14]) { g.set(x, 5, 'S'); g.set(x + 1, 5, 'S'); }
  g.disc(4, 8.4, 1.6, 'l'); g.disc(13, 8.4, 1.6, 'l'); g.set(4, 8, 'S'); g.set(13, 8, 'S');
  fxs('fx.cart', g.rows(), PAL);
  const c = new Grid(18, 10);
  c.ell(9, 3, 8.5, 3, 'k'); c.rect(0, 3, 18, 2, 'k'); for (const [x, y] of [[4, 1], [8, 0], [12, 1], [7, 2], [11, 3]]) c.set(x, y, 'l');
  fxs('fx.cart.coal', c.rows().slice(0, 5), PAL);
}
{
  const closed = new Grid(4, 24), open = new Grid(3, 24);
  closed.rect(0, 0, 4, 24, 'W'); closed.rect(1, 1, 2, 22, 'w'); for (const y of [4, 5, 18, 19]) closed.rect(0, y, 4, 1, 'z'); closed.rect(2, 12, 1, 2, 'y');
  for (let y = 2; y < 22; y += 3) closed.set(1, y, 'W');
  fxs('fx.door', closed.rows(), PAL);
  open.rect(0, 0, 2, 24, 'w'); open.rect(0, 0, 1, 24, 'W'); for (const y of [4, 18]) open.rect(0, y, 2, 1, 'z'); open.set(1, 13, 'y');
  fxs('fx.door.open', open.rows(), PAL);
  const br = new Grid(4, 24);
  br.rect(0, 0, 4, 24, 'W'); br.rect(1, 1, 2, 22, 'w'); br.rect(1, 5, 2, 4, 'k'); br.rect(2, 15, 1, 5, 'k'); br.set(0, 4, 'z'); br.set(3, 17, 'z');
  fxs('fx.door.broken', br.rows(), PAL);
}

// ---------------------------------------------------------------------------------------------------------------------------------- drawing
type Ctx = CanvasRenderingContext2D;
interface Box { x: number; y: number; w: number; h: number }   // footprint in view cells
const box = (f: Fixture, v: View): Box => ({ x: f.tx * TS - v.x0, y: f.ty * TS - v.y0, w: f.tw * TS, h: f.th * TS });
/** Draw sprite horizontally centred on the footprint, resting on its bottom edge. */
function bc(ctx: Ctx, key: string, b: Box, dx = 0, dy = 0, o: { flip?: boolean; frame?: number } = {}) {
  if (PASS === 2 || !hasSprite(key)) return;
  const s = spriteSize(key);
  drawSprite(ctx, key, b.x + Math.floor((b.w - s.w) / 2) + dx, b.y + b.h - s.h + dy, o);
}
const fuelFrac = (f: Fixture, cap: number) => Math.max(0, Math.min(1, (f.fuel ?? 0) / cap));
/** Render pass: 0 everything, 1 solid parts only (lit layer), 2 emissive parts only (flames, embers, glow; 'lighter' layer). */
let PASS: 0 | 1 | 2 = 0;
const rect = (ctx: Ctx, c: string, x: number, y: number, w: number, h: number) => { if (PASS === 2) return; ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); };
const rectE = (ctx: Ctx, c: string, x: number, y: number, w: number, h: number) => { if (PASS === 1) return; ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); };
const dget = (f: Fixture, k: string): unknown => f.data ? f.data[k] : undefined;

function snowMound(ctx: Ctx, x: number, y: number, w: number, h: number) {
  for (let i = 0; i < w; i++) {
    const k = Math.sin((i + 0.5) / w * Math.PI), hh = Math.max(1, Math.round(h * k));
    rect(ctx, '#e9f2fb', x + i, y - hh, 1, hh); rect(ctx, '#ffffff', x + i, y - hh, 1, 1);
    if (hh > 2) rect(ctx, '#c1d3e8', x + i, y - 1, 1, 1);
  }
}

// ---- flames -----------------------------------------------------------------------------------------------------------------------------
export function flame(ctx: Ctx, x: number, y: number, t: number, hw: number, hh: number, seed = 0, power = 1) { if (PASS !== 1) drawFlame(ctx, x, y, t, hw, hh, seed, power); }
function embers(ctx: Ctx, x: number, y: number, w: number, t: number, seed: number, lit: boolean) {
  for (let i = 0; i < w; i++) {
    const k = hf(i * 3.7 + seed + (lit ? Math.floor(t * 3) : 0));
    (lit ? rectE : rect)(ctx, lit ? (k > 0.6 ? '#ffb040' : k > 0.25 ? '#e0601c' : '#7a2a14') : (k > 0.8 ? '#4a4048' : '#2a252c'), x + i, y, 1, 1);
  }
}

function drawCampfire(ctx: Ctx, f: Fixture, b: Box, t: number) {
  const cx = b.x + b.w / 2, by = b.y + b.h;
  // stone ring
  const stones = [-5, -3, 3, 5, 0];
  for (let i = 0; i < 4; i++) { const sx = Math.round(cx + stones[i] - 1); rect(ctx, '#1b1726', sx - 1, by - 3, 4, 3); rect(ctx, i % 2 ? '#8d93a2' : '#a9afbd', sx, by - 3, 2, 2); rect(ctx, '#6a7080', sx, by - 1, 3, 1); }
  // logs
  const lit = !!f.lit, burnt = (f.fuel ?? 0) <= 0 && !lit;
  rect(ctx, '#1b1726', cx - 5, by - 3, 11, 3);
  rect(ctx, burnt ? '#3a2e2e' : '#7a5230', cx - 4, by - 3, 9, 2); rect(ctx, burnt ? '#2a2222' : '#a77846', cx - 4, by - 3, 9, 1);
  rect(ctx, burnt ? '#2a2326' : '#5a3a22', cx - 3, by - 2, 7, 1);
  if (burnt) { rect(ctx, '#6a6470', cx - 2, by - 4, 2, 1); rect(ctx, '#4a4450', cx + 1, by - 4, 3, 1); }
  else { rect(ctx, '#8a5c36', cx - 6, by - 4, 5, 1); rect(ctx, '#6b4528', cx + 1, by - 4, 5, 1); }
  if (lit) {
    const k = Math.max(0.35, Math.min(1, 0.4 + fuelFrac(f, 240)));
    embers(ctx, cx - 3, by - 3, 7, t, f.id, true);
    flame(ctx, cx, by - 2, t, 3, Math.round(10 * k), f.id, 1);
  }
}
function drawSignalFire(ctx: Ctx, f: Fixture, b: Box, t: number) {
  const w = Math.max(10, b.w - 2), cx = b.x + b.w / 2, by = b.y + b.h;
  const rows = Math.max(4, Math.min(9, Math.floor(b.h / 2)));
  for (let r = 0; r < rows; r++) {
    const rw = Math.max(4, w - r * 2), y = by - (r + 1) * 2;
    for (let i = 0; i < rw; i += 4) {
      const lx = Math.round(cx - rw / 2 + i);
      rect(ctx, '#1b1726', lx, y - 1, 5, 3);
      rect(ctx, (r + i) % 2 ? '#8a5c36' : '#a77846', lx + 1, y, 3, 2); rect(ctx, '#c89a62', lx + 1, y, 3, 1);
    }
  }
  if (f.lit) {
    const k = Math.max(0.4, Math.min(1, 0.4 + fuelFrac(f, 400)));
    const topY = by - rows * 2 + 2;
    embers(ctx, cx - 5, topY + 2, 10, t, f.id, true);
    flame(ctx, cx, topY + 3, t, 5, Math.round(18 * k), f.id, 1); flame(ctx, cx - 3, topY + 4, t + 0.3, 2, Math.round(11 * k), f.id + 5, 1); flame(ctx, cx + 3, topY + 4, t + 0.6, 2, Math.round(12 * k), f.id + 9, 1);
  }
}
function drawLamp(ctx: Ctx, f: Fixture, b: Box, t: number) {
  bc(ctx, 'fx.lamp', b, 0, 0);
  if (f.lit) { const cx = b.x + b.w / 2, y = b.y + b.h - 3; flame(ctx, cx, y, t, 1, 4, f.id, 0.9 + Math.min(0.3, fuelFrac(f, 480) * 0.4)); }
}
function drawBrazier(ctx: Ctx, f: Fixture, b: Box, t: number) {
  bc(ctx, 'fx.brazier', b, 0, 0);
  if (f.lit) {
    const cx = b.x + b.w / 2, top = b.y + b.h - 8;
    flame(ctx, cx, top + 1, t, 3, Math.round(9 * Math.max(0.5, Math.min(1, 0.5 + fuelFrac(f, 300)))), f.id, 1);
    for (const hx of [1, 3, 5]) { rectE(ctx, '#ff9a2a', b.x + hx + 1, top + 4, 1, 1); rectE(ctx, '#ff9a2a', b.x + hx + 1, top + 6, 1, 1); }
  }
}
function drawTorch(ctx: Ctx, f: Fixture, b: Box, t: number) {
  const lit = !!f.lit;
  bc(ctx, lit || (f.fuel ?? 0) > 0 ? 'fx.torch' : 'fx.torch_burnt', b, 0, 0);
  if (lit) flame(ctx, b.x + b.w / 2, b.y + b.h - 8, t, 1, Math.round(6 * Math.min(1, 0.5 + (f.fuel ?? 0) / 60)), f.id, 1);
}
function drawStove(ctx: Ctx, f: Fixture, b: Box, t: number) {
  bc(ctx, 'fx.stove', b, 0, 0);
  if (f.lit) {
    const x = b.x + Math.floor((b.w - 8) / 2), y = b.y + b.h - 8;
    const fl = 0.7 + 0.3 * Math.sin(t * 11 + f.id) * Math.sin(t * 5.3);
    rectE(ctx, `rgb(${Math.round(255 * fl)},${Math.round(130 + 60 * fl)},40)`, x + 2, y + 3, 4, 2);
    rectE(ctx, '#ffe48a', x + 3, y + 4, 2, 1);
    rectE(ctx, '#ff9a2a', x + 2, y + 6, 4, 1);
  } else { rect(ctx, '#15141a', b.x + Math.floor((b.w - 8) / 2) + 2, b.y + b.h - 5, 4, 2); }
}
function drawChest(ctx: Ctx, f: Fixture, b: Box) {
  let look = String(dget(f, 'look') ?? 'wood'); if (!CHEST_LOOKS[look] && !hasSprite('fx.chest.' + look)) look = 'wood';
  const broken = !!dget(f, 'broken'), open = f.open === true || (!!f.items && f.items.length === 0 && dget(f, 'looted') !== false && !dget(f, 'buried'));
  const key = 'fx.chest.' + look + (broken ? '.broken' : open ? '.open' : '');
  bc(ctx, key, b, 0, Number(dget(f, 'dy') ?? 0));
  drawChestExtras(ctx, f, b, 0, PASS);
  if (dget(f, 'buried')) { const cx = b.x + b.w / 2; snowMound(ctx, cx - 7, b.y + b.h, 15, 8); snowMound(ctx, cx - 3, b.y + b.h - 2, 8, 4); }
}
function drawDrum(ctx: Ctx, f: Fixture, b: Box) {
  const n = Number(dget(f, 'n') ?? dget(f, 'diesel') ?? 1);
  const empty = !!dget(f, 'empty') || n <= 0;
  const hash = (f.id * 7) % 3;
  bc(ctx, empty ? 'fx.drum.rust' : hash === 0 ? 'fx.drum.blue' : hash === 1 ? 'fx.drum.green' : 'fx.drum.blue', b, 0, 0);
}
function drawBed(ctx: Ctx, f: Fixture, b: Box) { bc(ctx, f.kind === 'skin_bed' ? 'fx.skin_bed' : 'fx.bed', b, 0, 0); }
function drawPot(ctx: Ctx, f: Fixture, b: Box, t: number) {
  // sits on the ground, or hangs from a tripod when it stands over a fire
  let fire: Fixture | null = null;
  for (const o of G.fixtures) if (o !== f && o.lit && o.tx <= f.tx && f.tx < o.tx + o.tw && o.ty <= f.ty + 1 && f.ty < o.ty + o.th + 1 && (o.kind === 'campfire' || o.kind === 'brazier' || o.kind === 'fat_lamp' || o.kind === 'signal_fire')) { fire = o; break; }
  let over = false;
  for (const o of G.fixtures) if (o !== f && (o.kind === 'campfire' || o.kind === 'fat_lamp' || o.kind === 'brazier') && o.tx <= f.tx && f.tx < o.tx + o.tw && f.ty >= o.ty && f.ty < o.ty + o.th + 1) { over = true; break; }
  const hang = over ? 3 : 0, cx = b.x + b.w / 2, by = b.y + b.h;
  if (over) { // tripod
    ctx.fillStyle = '#5a3a22';
    for (let i = 0; i <= 8; i++) { ctx.fillRect(Math.round(cx - 4 + i * 0.1 * 4 * 0.5 - i * 0.5), by - i, 1, 1); ctx.fillRect(Math.round(cx + 4 - i * 0.5), by - i, 1, 1); }
  }
  bc(ctx, 'fx.pot', b, 0, -hang);
  const water = Number(dget(f, 'water') ?? 0), snow = Number(dget(f, 'snow') ?? 0), ice = Number(dget(f, 'ice') ?? 0);
  const y = by - hang - 4;
  if (water > 0) { rect(ctx, '#4f9be0', Math.round(cx) - 2, y, 5, 1); rect(ctx, '#bfe2ff', Math.round(cx) - 1, y, 2, 1); }
  else if (snow > 0 || ice > 0) { rect(ctx, '#f4f8fd', Math.round(cx) - 2, y - 1, 5, 1); rect(ctx, '#ffffff', Math.round(cx) - 1, y - 2, 3, 1); if (ice > 0) rect(ctx, '#a9d4f4', Math.round(cx) + 1, y - 1, 1, 1); }
  if (fire && (water > 0 || snow > 0 || ice > 0)) {
    for (let k = 0; k < 3; k++) { const ph = (t * 0.9 + k * 0.33 + f.id * 0.1) % 1; ctx.globalAlpha = 0.55 * (1 - ph); rect(ctx, '#e8f2ff', cx - 1 + Math.sin(ph * 6 + k) * 2, y - 5 - ph * 9, 2, 2); }
    ctx.globalAlpha = 1;
  }
}
function drawRack(ctx: Ctx, f: Fixture, b: Box) { bc(ctx, 'fx.drying_rack', b, 0, 0); void f; }
function drawDoor(ctx: Ctx, f: Fixture, b: Box) {
  const broken = !!dget(f, 'broken');
  if (f.open) { const side = dget(f, 'side') === 'east' ? 0 : 1; bc(ctx, 'fx.door.open', b, side ? 1 : -1, 0); }
  else bc(ctx, broken ? 'fx.door.broken' : 'fx.door', b, 0, 0);
}
function drawHideDoor(ctx: Ctx, f: Fixture, b: Box, t: number) {
  const { x, y, w, h } = b;
  // posts
  rect(ctx, '#1b1726', x - 1, y - 1, 4, h + 1); rect(ctx, '#1b1726', x + w - 3, y - 1, 4, h + 1);
  rect(ctx, '#7d5333', x, y, 2, h); rect(ctx, '#7d5333', x + w - 2, y, 2, h); rect(ctx, '#a67a4c', x, y, 1, h); rect(ctx, '#a67a4c', x + w - 2, y, 1, h);
  rect(ctx, '#1b1726', x - 1, y - 2, w + 2, 4); rect(ctx, '#8e5f38', x, y - 1, w, 2);
  if (!f.open) {
    const sway = Math.round(Math.sin(t * 1.3 + f.id) * 0.4);
    for (let j = 2; j < h; j++) {
      const hh = j + 3 * 0, k = hf(j * 1.3 + f.id);
      rect(ctx, k > 0.7 ? '#9a7a58' : k > 0.35 ? '#b08c64' : '#a5825c', x + 2, y + j, w - 4, 1);
      if (j % 6 === 0) rect(ctx, '#7d5f42', x + 2, y + j, w - 4, 1);
      void hh;
    }
    rect(ctx, '#7d5f42', x + 2, y + h - 1, w - 4, 1);
    rect(ctx, '#e8dcc0', x + Math.floor(w / 2) - 1 + sway, y + Math.floor(h * 0.45), 2, 3); rect(ctx, '#c9bb98', x + Math.floor(w / 2) - 1 + sway, y + Math.floor(h * 0.45) + 2, 2, 1);
    for (let i = 3; i < w - 3; i += 2) rect(ctx, '#5a3a22', x + i, y + 2, 1, 1);
  } else {
    rect(ctx, '#1b1726', x + 2, y + 1, w - 4, 6); rect(ctx, '#a5825c', x + 2, y + 1, w - 4, 4); rect(ctx, '#c4a07a', x + 2, y + 1, w - 4, 1); rect(ctx, '#7d5f42', x + 2, y + 4, w - 4, 1);
    for (const px of [x + 3, x + w - 4]) { rect(ctx, '#5a3a22', px, y + 7, 1, 4); }
  }
}
function drawSnare(ctx: Ctx, f: Fixture, b: Box, t: number) {
  const x = b.x + b.w / 2, by = b.y + b.h;
  const set = !!dget(f, 'set'), got = String(dget(f, 'catch') ?? '');
  rect(ctx, '#5a3a22', x - 2, by - 4, 1, 4); rect(ctx, '#8e5f38', x - 2, by - 4, 1, 1);
  if (got) { bc(ctx, 'fx.bird', b, 1, -0); rect(ctx, '#c9a77a', x - 1, by - 5, 3, 1); }
  else if (set) {
    rect(ctx, '#c9a77a', x - 1, by - 4, 5, 1); rect(ctx, '#c9a77a', x + 3, by - 3, 1, 3); rect(ctx, '#c9a77a', x - 1, by - 3, 1, 3); rect(ctx, '#c9a77a', x, by - 1, 3, 1);
    rect(ctx, '#e8d9b8', x + 1, by - 6 + Math.round(Math.sin(t * 3 + f.id)), 1, 1);
  } else { rect(ctx, '#c9a77a', x - 1, by - 1, 5, 1); rect(ctx, '#c9a77a', x + 2, by - 2, 2, 1); }
}
function drawRadio(ctx: Ctx, f: Fixture, b: Box, t: number) {
  const fixed = !!dget(f, 'fixed'), parts = Number(dget(f, 'parts') ?? 0), broken = !fixed;
  bc(ctx, 'fx.radio', b, 0, 0);
  const x = b.x + Math.floor((b.w - 10) / 2) + 1, y = b.y + b.h - 8;
  const mastOk = G.fixtures.some(m => m.kind === 'mast' && (m.data?.up === true || (m.data?.up === undefined && m.data?.fallen !== true)));
  if (fixed) {
    rect(ctx, '#82f0a0', x + 5, y + 2, 2, 2); rect(ctx, '#c8ffd8', x + 5, y + 2, 2, 1);
    rect(ctx, (((t * 2) | 0) % 2) ? '#ff5040' : '#601410', x + 7, y + 5, 1, 1);
    if (mastOk) { const a = (t * 3) % 1; rect(ctx, 'rgba(130,240,160,' + (0.5 - a * 0.5) + ')', x + 6, y - 2 - Math.round(a * 3), 1, 1); }
  } else {
    // parts inserted show as amber lamps along the bottom
    for (let i = 0; i < 3; i++) rect(ctx, i < parts ? '#ffb040' : '#2a2018', x + 1 + i * 2, y + 6, 1, 1);
    if (broken) rect(ctx, '#1a1a1c', x + 5, y + 2, 2, 2);
    if (parts >= 3) rect(ctx, '#e6c25a', x + 5, y + 2, 2, 2);
  }
  void t;
}
function drawBarometer(ctx: Ctx, f: Fixture, b: Box, t: number) {
  bc(ctx, 'fx.barometer', b, 0, 0);
  const s = spriteSize('fx.barometer'), x = b.x + Math.floor((b.w - s.w) / 2), y = b.y + b.h - s.h;
  const ph = Math.floor(t * (1 + Math.min(10, Math.abs(G.wind)) * 0.9)) % 3;
  rect(ctx, '#1b1726', x + 1, y, 5, 1);
  rect(ctx, '#c9ced6', x + 1 + (ph === 0 ? 0 : ph === 1 ? 3 : 1), y + 1, 2, 1);
  rect(ctx, '#c9ced6', x + 5 - (ph === 0 ? 0 : ph === 1 ? 3 : 1), y + 1, 1, 1);
  void f;
}
function drawKennel(ctx: Ctx, f: Fixture, b: Box) { bc(ctx, 'fx.kennel', b, 0, 0); void f; }
function drawCart(ctx: Ctx, f: Fixture, b: Box) {
  bc(ctx, 'fx.cart', b, 0, 0);
  if (dget(f, 'loaded') === 'coal') bc(ctx, 'fx.cart.coal', b, 0, -6);
  // rails under it
  rect(ctx, '#6a6a78', b.x - 2, b.y + b.h, b.w + 4, 1);
}
function drawFlag(ctx: Ctx, f: Fixture, b: Box, t: number) {
  const px = b.x + 3, by = b.y + b.h, top = by - 22;
  rect(ctx, '#1b1726', px - 1, top - 2, 3, 24); rect(ctx, '#b9c0cc', px, top - 1, 1, 22); rect(ctx, '#f0f4fa', px, top - 1, 1, 1);
  const wind = Math.max(-1, Math.min(1, G.wind / 10)), amp = 0.5 + Math.min(2.5, Math.abs(G.wind) * 0.3);
  const dir = G.wind < 0 ? -1 : 1, len = 11;
  for (let i = 0; i < len; i++) {
    const wave = Math.sin(t * (3 + Math.abs(G.wind) * 0.5) - i * 0.7 + f.id) * amp * (i / len);
    const droop = (1 - Math.abs(wind)) * 2 * (i / len);
    const x = px + dir * (1 + i) - (dir < 0 ? 0 : 0), y = top + Math.round(wave + droop);
    const stripe = i % 6 < 3;
    rect(ctx, '#1b1726', x, y - 1, 1, 1); rect(ctx, '#1b1726', x, y + 6, 1, 1);
    for (let j = 0; j < 6; j++) rect(ctx, j >= 2 && j <= 3 ? '#f6f2ea' : stripe ? '#e4492d' : '#c93a26', x, y + j, 1, 1);
  }
}
function drawMast(ctx: Ctx, f: Fixture, b: Box, t: number) {
  const up = f.data && (f.data.up === true || (f.data.up === undefined && f.data.fallen !== true));
  const x = b.x + Math.floor(b.w / 2), by = b.y + b.h;
  if (up) {
    const H = Math.max(16, b.h), top = by - H;
    for (let y = 0; y < H; y++) {
      const wd = Math.round(1 + (1 - y / H) * 2.5);   // wider at the base
      const px = x - wd, py = top + y;
      rect(ctx, '#1b1726', px - 1, py, 1, 1); rect(ctx, '#1b1726', px + wd * 2 + 1, py, 1, 1);
      rect(ctx, '#9aa4b4', px, py, 1, 1); rect(ctx, '#9aa4b4', px + wd * 2, py, 1, 1);
      if (y % 4 === 0) { rect(ctx, '#7c8798', px, py, wd * 2 + 1, 1); }
      else if (y % 4 === 2) { rect(ctx, '#6c7788', px + (y % 8 === 2 ? 1 : wd * 2 - 1), py, 1, 1); }
    }
    rect(ctx, '#1b1726', x - 1, top - 6, 3, 7); rect(ctx, '#e5604f', x, top - 5, 1, 6); rect(ctx, '#c9ced6', x - 4, top + 3, 9, 1);
    rect(ctx, '#c9ced6', x - 3, top + 7, 7, 1);
    // guy wires
    ctx.fillStyle = 'rgba(150,160,175,0.7)';
    for (let i = 0; i < 12; i++) { ctx.fillRect(x - 3 - i, top + 12 + Math.round(i * 1.5), 1, 1); ctx.fillRect(x + 3 + i, top + 12 + Math.round(i * 1.5), 1, 1); }
    // anemometer cups
    const sp = t * (2 + Math.abs(G.wind) * 1.2), c1 = Math.cos(sp) * 3, c2 = Math.cos(sp + 2.1) * 3, c3 = Math.cos(sp + 4.2) * 3;
    for (const c of [c1, c2, c3]) rect(ctx, '#f4f0e4', x + Math.round(c) - 0, top - 8 + (c > 0 ? 0 : 0), 1, 1);
    rect(ctx, '#c9ced6', x - 3, top - 8, 7, 1);
  } else {
    // fallen: a stub and the top section lying across the ground with tangled wire
    for (let y = 0; y < 8; y++) { rect(ctx, '#1b1726', x - 3, by - 8 + y, 1, 1); rect(ctx, '#9aa4b4', x - 2, by - 8 + y, 1, 1); rect(ctx, '#9aa4b4', x + 1, by - 8 + y, 1, 1); rect(ctx, '#1b1726', x + 2, by - 8 + y, 1, 1); if (y % 3 === 0) rect(ctx, '#7c8798', x - 2, by - 8 + y, 4, 1); }
    for (let i = 0; i < 22; i++) {
      const px = x + 3 + i, py = by - 3 - Math.round(Math.max(0, 6 - i * 0.55));
      rect(ctx, '#1b1726', px, py - 1, 1, 3); rect(ctx, '#9aa4b4', px, py, 1, 1); rect(ctx, '#7c8798', px, py + 1, 1, 1);
      if (i % 4 === 0) rect(ctx, '#c9ced6', px, py - 2, 1, 1);
    }
    for (let i = 0; i < 10; i++) rect(ctx, 'rgba(160,170,185,0.8)', x + 24 + i, by - 1 - ((i * 7) % 3), 1, 1);
  }
}
function drawSign(ctx: Ctx, f: Fixture, b: Box) { bc(ctx, 'fx.sign', b, 0, 0); void f; }
function drawLanternFx(ctx: Ctx, f: Fixture, b: Box, t: number) {
  bc(ctx, f.lit ? 'fx.lantern' : 'fx.lantern_off', b, 0, 0);
  if (f.lit) { rectE(ctx, 'rgba(255,200,100,' + (0.5 + 0.2 * Math.sin(t * 9 + f.id)) + ')', b.x + b.w / 2 - 1, b.y + b.h - 4, 2, 2); }
}
function drawLegacy(ctx: Ctx, f: Fixture, b: Box, t: number) {
  const key = f.kind;
  if (hasSprite(key)) bc(ctx, key, b, 0, 0, { frame: f.kind === 'furnace' && f.lit ? 0 : 0 });
  else { rect(ctx, '#1b1726', b.x, b.y, b.w, b.h); rect(ctx, '#7a5a3a', b.x + 1, b.y + 1, b.w - 2, b.h - 2); }
  void t;
}

/** Draw one fixture (view cells). Lit pass: flames are drawn bright so they read even before lighting. */
export function drawFixtureArt(ctx: Ctx, v: View, f: Fixture, t: number, pass: 0 | 1 | 2 = 0) {
  PASS = pass;
  const b = box(f, v);
  switch (f.kind) {
    case 'campfire': drawCampfire(ctx, f, b, t); break;
    case 'signal_fire': drawSignalFire(ctx, f, b, t); break;
    case 'fat_lamp': drawLamp(ctx, f, b, t); break;
    case 'brazier': drawBrazier(ctx, f, b, t); break;
    case 'torch': drawTorch(ctx, f, b, t); break;
    case 'stove': drawStove(ctx, f, b, t); break;
    case 'chest': case 'shelf': if (f.kind === 'shelf') bc(ctx, 'fx.shelf', b, 0, 0); else drawChest(ctx, f, b); break;
    case 'drum': drawDrum(ctx, f, b); break;
    case 'bed': case 'skin_bed': drawBed(ctx, f, b); break;
    case 'table': case 'workbench': bc(ctx, 'fx.table', b, 0, 0); break;
    case 'pot': drawPot(ctx, f, b, t); break;
    case 'drying_rack': drawRack(ctx, f, b); break;
    case 'door': drawDoor(ctx, f, b); break;
    case 'hide_door': drawHideDoor(ctx, f, b, t); break;
    case 'cache': bc(ctx, 'fx.cache', b, 0, 0); break;
    case 'cairn': bc(ctx, 'fx.cairn', b, 0, 0); break;
    case 'snare': drawSnare(ctx, f, b, t); break;
    case 'radio': drawRadio(ctx, f, b, t); break;
    case 'barometer': drawBarometer(ctx, f, b, t); break;
    case 'kennel': drawKennel(ctx, f, b); break;
    case 'cart': drawCart(ctx, f, b); break;
    case 'flag': drawFlag(ctx, f, b, t); break;
    case 'mast': drawMast(ctx, f, b, t); break;
    case 'sign': drawSign(ctx, f, b); break;
    case 'lantern': drawLanternFx(ctx, f, b, t); break;
    default: if (!drawStationArt(ctx, v, f, t, pass)) drawLegacy(ctx, f, b, t);
  }
  PASS = 0;
}

/** Optional emissive pass (z in 0..100, 'lighter'): soft halos around flames. */
export function drawFixtureGlowArt(ctx: Ctx, v: View, f: Fixture, t: number) {
  if (!f.lit) return;
  const b = box(f, v), cx = b.x + b.w / 2, cy = b.y + b.h - 4;
  let r = 0, a = 0;
  switch (f.kind) {
    case 'campfire': r = 11; a = 0.22; break; case 'signal_fire': r = 22; a = 0.28; break; case 'brazier': r = 10; a = 0.2; break;
    case 'fat_lamp': r = 6; a = 0.2; break; case 'torch': r = 6; a = 0.18; break; case 'lantern': r = 8; a = 0.2; break; case 'stove': r = 6; a = 0.12; break;
    default: return;
  }
  const fl = 0.85 + 0.15 * Math.sin(t * 13 + f.id * 3.1) * Math.sin(t * 7.3 + f.id);
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, `rgba(255,170,70,${a * fl})`); g.addColorStop(1, 'rgba(255,120,30,0)');
  ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
}
void compose;

/** Every FixtureKind with its footprint (tiles) and the states worth showing — used by the sprite sheet and art.selftest. */
export const FIXTURE_SHEET: { kind: Fixture['kind']; tw: number; th: number; variants: { name: string; patch: Partial<Fixture> }[] }[] = [
  { kind: 'campfire', tw: 2, th: 1, variants: [{ name: 'unlit', patch: { fuel: 0 } }, { name: 'logs', patch: { fuel: 120 } }, { name: 'lit', patch: { lit: true, fuel: 300 } }, { name: 'dying', patch: { lit: true, fuel: 10 } }] },
  { kind: 'signal_fire', tw: 4, th: 4, variants: [{ name: 'unlit', patch: {} }, { name: 'lit', patch: { lit: true, fuel: 500 } }] },
  { kind: 'fat_lamp', tw: 1, th: 1, variants: [{ name: 'unlit', patch: {} }, { name: 'lit', patch: { lit: true, fuel: 200 } }] },
  { kind: 'brazier', tw: 2, th: 2, variants: [{ name: 'unlit', patch: {} }, { name: 'lit', patch: { lit: true, fuel: 300 } }] },
  { kind: 'torch', tw: 1, th: 2, variants: [{ name: 'unlit', patch: { fuel: 40 } }, { name: 'lit', patch: { lit: true, fuel: 40 } }, { name: 'burnt', patch: { fuel: 0 } }] },
  { kind: 'stove', tw: 2, th: 2, variants: [{ name: 'cold', patch: {} }, { name: 'lit', patch: { lit: true, fuel: 300 } }] },
  { kind: 'pot', tw: 1, th: 1, variants: [{ name: 'empty', patch: { data: {} } }, { name: 'snow', patch: { data: { snow: 2 } } }, { name: 'water', patch: { data: { water: 2 } } }] },
  { kind: 'drying_rack', tw: 3, th: 2, variants: [{ name: 'rack', patch: {} }] },
  { kind: 'skin_bed', tw: 4, th: 1, variants: [{ name: 'skins', patch: {} }] },
  { kind: 'bed', tw: 4, th: 1, variants: [{ name: 'bed', patch: {} }] },
  { kind: 'hide_door', tw: 3, th: 6, variants: [{ name: 'closed', patch: { open: false } }, { name: 'open', patch: { open: true } }] },
  { kind: 'door', tw: 1, th: 6, variants: [{ name: 'closed', patch: { open: false } }, { name: 'open', patch: { open: true } }, { name: 'broken', patch: { data: { broken: true } } }] },
  { kind: 'cache', tw: 2, th: 2, variants: [{ name: 'cache', patch: {} }] },
  { kind: 'snare', tw: 1, th: 1, variants: [{ name: 'off', patch: {} }, { name: 'set', patch: { data: { set: true } } }, { name: 'catch', patch: { data: { set: true, catch: 'ptarmigan' } } }] },
  { kind: 'table', tw: 3, th: 2, variants: [{ name: 'table', patch: {} }] },
  { kind: 'shelf', tw: 2, th: 2, variants: [{ name: 'shelf', patch: {} }] },
  { kind: 'chest', tw: 2, th: 2, variants: [
    { name: 'wood', patch: { items: [{ id: 'can', n: 1 }] } }, { name: 'open', patch: { open: true, items: [] } }, { name: 'broken', patch: { data: { broken: true }, items: [{ id: 'can', n: 1 }] } },
    ...['tin', 'old', 'miner', 'captain', 'tool', 'crew'].map(look => ({ name: look, patch: { items: [{ id: 'can', n: 1 }], data: { look } } })),
    { name: 'buried', patch: { items: [{ id: 'battery', n: 1 }], data: { buried: true } } },
  ] },
  { kind: 'radio', tw: 2, th: 2, variants: [{ name: 'broken', patch: { data: { fixed: false, parts: 0 } } }, { name: '2/3', patch: { data: { fixed: false, parts: 2 } } }, { name: 'fixed', patch: { data: { fixed: true, parts: 3 } } }] },
  { kind: 'drum', tw: 2, th: 2, variants: [{ name: 'full', patch: { data: { n: 6 } } }, { name: 'green', patch: { id: 1, data: { n: 6 } } }, { name: 'empty', patch: { data: { empty: true, n: 0 } } }] },
  { kind: 'mast', tw: 2, th: 6, variants: [{ name: 'up', patch: { data: { up: true } } }, { name: 'fallen', patch: { tw: 2, th: 4, data: { fallen: true } } }] },
  { kind: 'barometer', tw: 2, th: 2, variants: [{ name: 'screen', patch: {} }] },
  { kind: 'flag', tw: 3, th: 2, variants: [{ name: 'flag', patch: {} }] },
  { kind: 'cairn', tw: 2, th: 2, variants: [{ name: 'cairn', patch: {} }] },
  { kind: 'cart', tw: 4, th: 2, variants: [{ name: 'empty', patch: {} }, { name: 'coal', patch: { data: { loaded: 'coal' } } }] },
  { kind: 'kennel', tw: 5, th: 3, variants: [{ name: 'kennel', patch: {} }] },
  { kind: 'sign', tw: 2, th: 2, variants: [{ name: 'sign', patch: {} }] },
  { kind: 'lantern', tw: 1, th: 1, variants: [{ name: 'off', patch: {} }, { name: 'lit', patch: { lit: true, fuel: 100 } }] },
  { kind: 'workbench', tw: 3, th: 2, variants: [{ name: 'workbench', patch: {} }] },
  { kind: 'furnace', tw: 2, th: 2, variants: [{ name: 'v1', patch: {} }] },
];
FIXTURE_SHEET.push(...STATION_SHEET);
