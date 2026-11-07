// Art of the interactive objects of DESIGN §15 (generator, lamps, heater, medkit, kettle, gramophone, ladder, shutters, damper, bell, weather-balloon pad,
// frozen barrel, fox den). Fixed-size furniture = outlined sprites ('fx.*', bottom-anchored on the footprint); the moving parts (cord, record, bell swing,
// balloon, steam, glows) are drawn from code. `data.dy` pushes a sprite down into uneven ground. Called from art/fixtures.ts (drawFixtureArt's default branch).
import { G, type Fixture, type View } from '../game/state';
import { defSprite, outline, drawSprite, spriteSize, hasSprite, drawFlame, PAL, type Rows, type Palette } from '../engine/sprites';
import { Grid } from './grid';

const TS = 4;
type Ctx = CanvasRenderingContext2D;
interface Box { x: number; y: number; w: number; h: number }
let PASS: 0 | 1 | 2 = 0;
const hf = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const rect = (ctx: Ctx, c: string, x: number, y: number, w: number, h: number) => { if (PASS === 2) return; ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); };
const rectE = (ctx: Ctx, c: string, x: number, y: number, w: number, h: number) => { if (PASS === 1) return; ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); };
const num = (f: Fixture, k: string, d = 0): number => { const v = Number(f.data?.[k]); return f.data?.[k] !== undefined && Number.isFinite(v) ? v : d; };
/** Outlined sprite without its bottom outline row (rests exactly on the footprint floor). */
function fxs(key: string, rows: Rows, pal: Palette = PAL) { const o = outline(rows); defSprite(key, pal, o.slice(0, o.length - 1)); }
function bcx(ctx: Ctx, key: string, b: Box, dx = 0, dy = 0, o: { flip?: boolean; frame?: number } = {}) {
  if (PASS === 2 || !hasSprite(key)) return;
  const s = spriteSize(key);
  drawSprite(ctx, key, b.x + Math.floor((b.w - s.w) / 2) + dx, b.y + b.h - s.h + dy, o);
}

/** Set by stationwire.ts: has the player chipped this frozen container free already? */
export const artHooks = { thawed: (_f: Fixture): boolean => false };

// ---------------------------------------------------------------------------------------------------------------------------------- generator 12×8 (+ stub)
const GP: Palette = { ...PAL, a: '#6f8f5e', A: '#46633c', b: '#a9ca96', r: '#d8402c', R: '#8e2a22', m: '#ff8b6a', s: '#cfd8e2', S: '#8996a8', z: '#4f5a6e', k: '#23222c', g: '#86e08c', e: '#ffb040' };
{
  const g = new Grid(12, 11);
  g.rect(9, 0, 2, 5, 'S'); g.rect(9, 0, 1, 5, 's'); g.rect(8, 0, 4, 1, 'z'); g.rect(8, 5, 4, 1, 'z');              // exhaust stack with a collar
  g.rect(2, 1, 6, 4, 'r'); g.rect(2, 1, 6, 1, 'm'); g.rect(2, 4, 6, 1, 'R'); g.rect(1, 2, 1, 2, 'R'); g.rect(8, 2, 1, 2, 'R');   // fuel tank
  g.rect(3, 0, 2, 1, 'y');                                                                                          // filler cap
  g.rect(0, 5, 12, 5, 'a'); g.rect(0, 5, 12, 1, 'b'); g.rect(0, 9, 12, 1, 'A');                                      // engine block
  g.rect(0, 5, 1, 5, 'A');
  for (let x = 2; x < 8; x += 2) { g.rect(x, 6, 1, 3, 'A'); }                                                       // cooling fins
  g.rect(8, 6, 3, 3, 'z'); g.rect(8, 6, 3, 1, 'S'); g.rect(9, 7, 1, 1, 'k');                                        // alternator housing
  g.rect(4, 8, 3, 1, 'k'); g.set(5, 8, 'g');                                                                        // panel lamp (recoloured by code)
  g.rect(0, 10, 12, 1, 'k'); g.rect(1, 10, 2, 1, 'z'); g.rect(9, 10, 2, 1, 'z');                                    // skids
  fxs('fx.gen', g.rows(), GP);
}
// ---------------------------------------------------------------------------------------------------------------------------------- ceiling lamp 4×8
{
  const g = new Grid(6, 8);
  g.rect(2, 0, 1, 4, 'U');                                                                                          // cord
  g.rect(0, 4, 5, 1, 'S'); g.rect(1, 3, 3, 1, 'S'); g.rect(0, 4, 5, 1, 'S');                                         // shade
  g.rect(1, 5, 3, 1, 'y'); g.rect(2, 6, 1, 1, 'E');                                                                 // bulb
  fxs('fx.lamp_e', g.rows(), { ...PAL, S: '#7c8798', E: '#fff2b0' });
  const o = new Grid(6, 8);
  o.rect(2, 0, 1, 4, 'U'); o.rect(0, 4, 5, 1, 'S'); o.rect(1, 3, 3, 1, 'S'); o.rect(1, 5, 3, 1, 'h'); o.rect(2, 6, 1, 1, 'l');
  fxs('fx.lamp_e.off', o.rows(), { ...PAL, S: '#7c8798' });
}
// ---------------------------------------------------------------------------------------------------------------------------------- electric heater 8×4
{
  const g = new Grid(8, 4);
  g.rect(0, 0, 8, 4, 'S'); g.rect(0, 0, 8, 1, 's'); g.rect(0, 3, 8, 1, 'z');
  for (let x = 1; x < 7; x += 2) g.rect(x, 1, 1, 2, 'k');
  g.set(7, 1, 'r');
  fxs('fx.heater', g.rows(), { ...PAL, r: '#503028' });
}
// ---------------------------------------------------------------------------------------------------------------------------------- first-aid cabinet 8×8
{
  const g = new Grid(8, 8);
  g.rect(0, 0, 8, 8, 'n'); g.rect(0, 0, 8, 1, 'N'); g.rect(0, 7, 8, 1, 'S'); g.rect(0, 0, 1, 8, 'N'); g.rect(7, 0, 1, 8, 'S');
  g.rect(3, 1, 2, 6, 'r'); g.rect(1, 3, 6, 2, 'r'); g.rect(3, 1, 2, 1, 'm'); g.set(6, 4, 'y');
  fxs('fx.medkit', g.rows(), { ...PAL, m: '#ff7a68', r: '#d8362a' });
  const e = new Grid(8, 8);
  e.rect(0, 0, 8, 8, 'N'); e.rect(0, 0, 8, 1, 'n'); e.rect(0, 7, 8, 1, 'S'); e.rect(3, 1, 2, 6, 'S'); e.rect(1, 3, 6, 2, 'S'); e.set(6, 4, 'y');
  fxs('fx.medkit.empty', e.rows(), PAL);
  const o = new Grid(10, 8);   // door swung open: shows the shelf
  o.rect(0, 0, 3, 8, 'N'); o.rect(0, 0, 1, 8, 'n'); o.rect(3, 0, 6, 8, 'S'); o.rect(4, 1, 4, 2, 'n'); o.rect(4, 4, 4, 2, 'n'); o.rect(5, 1, 1, 2, 'r'); o.rect(6, 5, 1, 1, 'q');
  fxs('fx.medkit.open', o.rows(), { ...PAL, r: '#d8362a' });
}
// ---------------------------------------------------------------------------------------------------------------------------------- kettle 5×5
{
  const g = new Grid(7, 6);
  g.rect(1, 2, 4, 3, 'b'); g.rect(1, 2, 4, 1, 'i'); g.rect(0, 4, 6, 1, 'B'); g.rect(2, 1, 2, 1, 'B'); g.set(3, 0, 'k');   // body, lid and knob
  g.rect(5, 2, 1, 1, 'S'); g.rect(6, 1, 1, 1, 'S');                                                                  // spout
  g.rect(0, 2, 1, 2, 'k'); g.rect(1, 0, 3, 1, 'k'); g.rect(0, 1, 1, 1, 'k');                                         // handle (wire)
  fxs('fx.kettle', g.rows(), { ...PAL, b: '#4a86b8', i: '#9cd0f0', B: '#2a5780' });
}
// ---------------------------------------------------------------------------------------------------------------------------------- gramophone 9×11
{
  const g = new Grid(11, 11);
  g.rect(0, 7, 8, 4, 'W'); g.rect(0, 7, 8, 1, 'w'); g.rect(0, 10, 8, 1, 'd');                                         // wooden box
  g.rect(1, 6, 6, 1, 'k'); g.rect(1, 5, 6, 1, 'l');                                                                  // record (animated spokes by code)
  g.line(7, 6, 10, 0, 'Y', 1); g.line(8, 6, 10, 1, 'y', 1);                                                           // horn neck
  g.rect(8, 0, 3, 3, 'Y'); g.rect(9, 0, 2, 1, 'y'); g.rect(9, 1, 1, 1, 'd');                                         // horn bell (brass)
  g.rect(6, 8, 1, 1, 'y');                                                                                           // crank
  fxs('fx.gram', g.rows(), { ...PAL, w: '#b87c48', W: '#7a4a28', Y: '#b88a28' });
}
// ---------------------------------------------------------------------------------------------------------------------------------- ladder 4×32
{
  const g = new Grid(5, 32);
  g.rect(0, 0, 1, 32, 'w'); g.rect(4, 0, 1, 32, 'w'); g.rect(0, 0, 1, 32, 'W'); g.rect(1, 0, 1, 32, 'w'); g.rect(3, 0, 1, 32, 'W'); g.rect(4, 0, 1, 32, 'w');
  for (let y = 1; y < 32; y += 4) g.rect(1, y, 3, 1, 'd');
  g.rect(0, 0, 5, 1, 'd');
  fxs('fx.ladder', g.rows(), PAL);
}
// ---------------------------------------------------------------------------------------------------------------------------------- shutters: panels 4×4 each side + cord
{
  const g = new Grid(4, 4);   // closed shutter: a boarded window
  g.rect(0, 0, 4, 4, 'w'); g.rect(0, 1, 4, 1, 'W'); g.rect(0, 3, 4, 1, 'W'); g.rect(0, 0, 4, 1, 't'); g.set(0, 2, 'k'); g.set(3, 2, 'k');
  fxs('fx.shutter', g.rows(), { ...PAL, k: '#2a2a30' });
}
// ---------------------------------------------------------------------------------------------------------------------------------- damper lever 4×4
{
  const g = new Grid(5, 4);
  g.rect(0, 1, 5, 2, 'z'); g.rect(0, 1, 5, 1, 'S'); g.set(2, 2, 'k');
  fxs('fx.damper', g.rows(), PAL);
}
// ---------------------------------------------------------------------------------------------------------------------------------- bell 4×8: post with a crossbar, brass bell
{
  const g = new Grid(10, 12);
  g.rect(0, 0, 10, 2, 'W'); g.rect(0, 0, 10, 1, 'w'); g.rect(0, 2, 2, 10, 'W'); g.rect(0, 2, 1, 10, 'w'); g.rect(8, 2, 2, 10, 'W'); g.rect(9, 2, 1, 10, 'd');
  g.rect(0, 5, 1, 1, 'S'); g.rect(9, 5, 1, 1, 'S');
  fxs('fx.bell.frame', g.rows(), PAL);
  const b = new Grid(6, 6);
  b.rect(2, 0, 2, 1, 'Y'); b.rect(1, 1, 4, 1, 'y'); b.rect(0, 2, 6, 3, 'y'); b.rect(0, 2, 2, 3, 'Y'); b.rect(0, 5, 6, 1, 'Y'); b.set(3, 5, 'k'); b.rect(2, 2, 1, 2, 'E');
  fxs('fx.bell.bell', b.rows(), { ...PAL, E: '#fff0a0' });
}
// ---------------------------------------------------------------------------------------------------------------------------------- weather-balloon pad 8×16
{
  const g = new Grid(10, 16);
  g.line(1, 15, 5, 3, 'W', 1); g.line(9, 15, 5, 3, 'W', 1); g.line(5, 15, 5, 3, 'd', 1);                              // tripod
  g.rect(3, 11, 5, 1, 'd'); g.rect(2, 13, 7, 1, 'd');
  g.rect(3, 0, 4, 3, 'S'); g.rect(3, 0, 4, 1, 's'); g.rect(4, 2, 2, 1, 'k');                                          // hydrogen cylinder head / winch
  g.rect(0, 14, 10, 2, 'z'); g.rect(0, 14, 10, 1, 'S');                                                              // base plate
  fxs('fx.sonde', g.rows(), PAL);
  const p = new Grid(5, 5);   // radiosonde payload: a small white box with an aerial
  p.rect(0, 1, 5, 4, 'n'); p.rect(0, 1, 5, 1, 'N'); p.rect(0, 4, 5, 1, 'S'); p.set(2, 0, 'r'); p.set(1, 2, 'k'); p.set(3, 2, 'g');
  fxs('fx.sonde.box', p.rows(), { ...PAL, r: '#d8362a' });
}
// ---------------------------------------------------------------------------------------------------------------------------------- frozen barrel 8×8
{
  const g = new Grid(8, 8);
  g.rect(1, 0, 6, 8, 'W'); g.rect(0, 1, 8, 6, 'W'); g.rect(1, 0, 2, 8, 'w'); g.rect(0, 1, 1, 6, 'w');
  for (const y of [1, 5]) g.rect(0, y, 8, 1, 'z');
  g.rect(1, 3, 6, 1, 'd'); g.rect(2, 7, 4, 1, 'd');
  const pal = { ...PAL, W: '#7d5a38', w: '#a77d52', z: '#6a7488' };
  fxs('fx.chest.barrel', g.rows(), pal);
  const o = new Grid(8, 8);   // chipped open: lid off, dark inside
  o.rect(1, 1, 6, 7, 'W'); o.rect(0, 2, 8, 5, 'W'); o.rect(1, 0, 6, 2, 'k'); o.rect(2, 1, 4, 1, 'l'); o.rect(0, 2, 1, 5, 'w');
  for (const y of [2, 5]) o.rect(0, y, 8, 1, 'z');
  fxs('fx.chest.barrel.open', o.rows(), pal);
  fxs('fx.chest.barrel.broken', o.rows(), pal);
}
// ---------------------------------------------------------------------------------------------------------------------------------- fox den 8×8: a snow mound with a dark hole
{
  const g = new Grid(14, 8);
  for (let x = 0; x < 14; x++) { const k = Math.sin((x + 0.5) / 14 * Math.PI), h = Math.max(1, Math.round(8 * Math.pow(k, 0.8))); g.rect(x, 8 - h, 1, h, 'n'); g.set(x, 8 - h, 'n'); if (h > 3) g.set(x, 7, 'N'); }
  g.rect(4, 4, 5, 4, 'k'); g.rect(5, 3, 3, 1, 'k'); g.rect(5, 4, 3, 3, 'K'); g.rect(4, 7, 5, 1, 'l');
  g.set(2, 5, 'i'); g.set(11, 6, 'i'); g.set(9, 3, 'I');
  g.set(1, 7, 'u'); g.set(12, 7, 'x');   // a bone and some grass peeking out
  const o = outline(g.rows());
  defSprite('fx.chest.den', PAL, o.slice(0, o.length - 1));
  defSprite('fx.chest.den.open', PAL, o.slice(0, o.length - 1));
  defSprite('fx.chest.den.broken', PAL, o.slice(0, o.length - 1));
}

// ---------------------------------------------------------------------------------------------------------------------------------- drawing
const box = (f: Fixture, v: View): Box => ({ x: f.tx * TS - v.x0, y: f.ty * TS - v.y0, w: f.tw * TS, h: f.th * TS });
const dyOf = (f: Fixture) => num(f, 'dy', 0);
function glowE(ctx: Ctx, cx: number, cy: number, r: number, rgb: string, a: number) {
  if (PASS === 1) return;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, `rgba(${rgb},${a.toFixed(3)})`); g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
}

function drawGenerator(ctx: Ctx, f: Fixture, b: Box, t: number) {
  const run = !!f.lit, stalled = !!f.data?.stalled, pullv = num(f, 'pullv', 0);
  const sh = run ? Math.round(Math.sin(t * 38) * 0.6 + 0.2) : 0;
  const bx = b.x + sh, by = b.y;
  bcx(ctx, 'fx.gen', { ...b, x: bx, y: by }, 0, 0);
  const x0 = b.x + Math.floor((b.w - 12) / 2) + sh, yb = b.y + b.h;
  // pull cord with a yellow T-handle on the left
  const pull = Math.round(pullv * 5);
  rect(ctx, '#1b1726', x0 - 4 - pull, yb - 6, 4, 3); rect(ctx, '#f4cf5a', x0 - 3 - pull, yb - 5, 2, 1);
  rect(ctx, '#8d7c68', x0 - 1 - pull + (pull ? 0 : 0), yb - 5, 1 + pull, 1);
  // panel lamp: green running, red when stalled / dry, off otherwise
  const lampX = x0 + 5, lampY = yb - 3;
  const fuel = f.fuel ?? 0;
  if (run) { rectE(ctx, '#86e08c', lampX, lampY, 1, 1); rectE(ctx, 'rgba(160,255,170,0.7)', lampX, lampY - 1, 1, 1); }
  else if (stalled || fuel <= 0) rect(ctx, (((t * 2) | 0) % 2) ? '#ff5040' : '#7a2018', lampX, lampY, 1, 1);
  else rect(ctx, '#3a4a3a', lampX, lampY, 1, 1);
  // fuel gauge on the tank
  const k = Math.max(0, Math.min(1, fuel / 480));
  rect(ctx, '#1b1726', x0 + 2, yb - 8, 6, 1); rect(ctx, k > 0.2 ? '#ffd870' : '#ff6a50', x0 + 2, yb - 8, Math.max(0, Math.round(6 * k)), 1);
  if (run) {
    // exhaust shimmer at the stack and a faint glow from the cylinder
    rectE(ctx, 'rgba(255,140,60,0.5)', x0 + 9, yb - 11 + ((t * 20) % 2 | 0), 2, 1);
    glowE(ctx, x0 + 9, yb - 4, 7, '255,150,60', 0.12);
  }
}
function drawLampE(ctx: Ctx, f: Fixture, b: Box, t: number) {
  const on = !!f.lit;
  bcx(ctx, on ? 'fx.lamp_e' : 'fx.lamp_e.off', { ...b, h: 8 }, 0, 0);
  if (on) {
    glowE(ctx, b.x + b.w / 2, b.y + 6, 9, '255,226,150', 0.3);
    rectE(ctx, '#fff6c8', b.x + b.w / 2 - 1, b.y + 5, 2, 1);
  }
  void t;
}
function drawHeater(ctx: Ctx, f: Fixture, b: Box, t: number) {
  bcx(ctx, 'fx.heater', b, 0, 0);
  if (f.lit) {
    for (let x = 1; x < 7; x += 2) rectE(ctx, `rgba(255,${120 + ((t * 6 + x) % 3) * 20},50,0.95)`, b.x + x, b.y + b.h - 3, 1, 2);
    glowE(ctx, b.x + b.w / 2, b.y + b.h - 2, 8, '255,120,50', 0.2);
  }
}
function drawMedkit(ctx: Ctx, f: Fixture, b: Box, t: number) {
  const empty = num(f, 'bandage', 4) <= 0 && num(f, 'spirit', 2) <= 0;
  const openT = num(f, 'openT', 0);
  bcx(ctx, openT > 0 ? 'fx.medkit.open' : empty ? 'fx.medkit.empty' : 'fx.medkit', b, 0, 0);
  void t;
}
function drawKettle(ctx: Ctx, f: Fixture, b: Box, t: number) {
  bcx(ctx, 'fx.kettle', b, 0, 0);
  const hot = num(f, 'hot', 0), water = num(f, 'water', 0);
  if (hot > 0) {
    const cx = b.x + b.w / 2;
    for (let k = 0; k < 2; k++) { const ph = (t * 1.1 + k * 0.5 + f.id * 0.1) % 1; ctx.globalAlpha = 0.7 * (1 - ph); rect(ctx, '#f0f6ff', cx + 2 + Math.sin(ph * 5 + k) * 1, b.y + b.h - 8 - ph * 8, 1, 2); }
    ctx.globalAlpha = 1;
  }
  if (water > 0) rect(ctx, '#9cd0f0', b.x + b.w / 2 - 1, b.y + b.h - 4, 1, 1);
}
function drawGramophone(ctx: Ctx, f: Fixture, b: Box, t: number) {
  const play = !!f.data?.play, dy = dyOf(f);
  bcx(ctx, 'fx.gram', b, 0, dy);
  const s = spriteSize('fx.gram'), x = b.x + Math.floor((b.w - s.w) / 2), y = b.y + b.h - s.h + dy;
  // the record seen edge-on: a moving highlight while it spins
  const ph = play ? Math.floor(t * 9) % 4 : 0;
  rect(ctx, '#e8e6f0', x + 2 + ph, y + s.h - 6 - 4 + 1 + 0, 1, 1);
  if (play) {
    for (let k = 0; k < 2; k++) {
      const q = (t * 0.7 + k * 0.5 + f.id * 0.13) % 1; ctx.globalAlpha = 1 - q;
      const nx = x + s.w + 1 + Math.sin(q * 6 + k) * 2, ny = y - 2 - q * 12;
      rect(ctx, '#ffe9a0', nx, ny, 1, 3); rect(ctx, '#ffe9a0', nx + 1, ny, 2, 1); rect(ctx, '#ffe9a0', nx - 1, ny + 3, 2, 1);
    }
    ctx.globalAlpha = 1;
    // crank turns
    rect(ctx, '#f4cf5a', x + 6, y + s.h - 5 + (ph & 1), 1, 1);
  }
}
function drawHatch(ctx: Ctx, f: Fixture, b: Box) {
  const s = spriteSize('fx.ladder'), x = b.x + Math.floor((b.w - s.w) / 2);
  // a ladder as tall as its footprint (32 cells), tiled from the bottom
  if (PASS !== 2 && hasSprite('fx.ladder')) drawSprite(ctx, 'fx.ladder', x, b.y + b.h - s.h + 1, {});
  void f;
}
function drawShutter(ctx: Ctx, f: Fixture, b: Box) {
  const closed = !!f.data?.closed;
  const x = b.x, y = b.y;                       // top row of the footprint = the window row
  if (closed) { if (PASS !== 2) drawSprite(ctx, 'fx.shutter', x - 1, y - 1, {}); }
  else { rect(ctx, '#1b1726', x - 2, y - 1, 1, 6); rect(ctx, '#a67a4c', x - 2, y, 1, 4); rect(ctx, '#1b1726', x + 4, y - 1, 1, 6); rect(ctx, '#a67a4c', x + 4, y, 1, 4); }
  // the cord with a wooden knob hangs down the wall to where a hand can reach it
  rect(ctx, '#8d7c68', x + 1, y + 5, 1, b.h - 12);
  rect(ctx, '#1b1726', x, y + b.h - 8, 3, 4); rect(ctx, closed ? '#c89a62' : '#e8dcc0', x + 1, y + b.h - 7, 1, 2);
}
function drawDamper(ctx: Ctx, f: Fixture, b: Box) {
  const k = num(f, 'd', 1);
  bcx(ctx, 'fx.damper', b, 0, 0);
  const x = b.x + Math.floor(b.w / 2), y = b.y + b.h - 2;
  // the handle: closed = horizontal, half = 45°, open = vertical
  const hx = k === 0 ? [1, 2, 3] : k === 1 ? [1, 2, 3] : [0, 0, 0], hy = k === 0 ? [0, 0, 0] : k === 1 ? [1, 2, 3] : [1, 2, 3];
  for (let i = 0; i < 3; i++) rect(ctx, k === 0 ? '#d8362a' : '#f4cf5a', x + (k === 2 ? 0 : hx[i]), y - (k === 0 ? 0 : hy[i]) - (k === 2 ? 0 : 0), 1, 1);
}
function drawBell(ctx: Ctx, f: Fixture, b: Box, t: number) {
  const dy = dyOf(f), sw = num(f, 'sw', 0);
  const s = spriteSize('fx.bell.frame'), x = b.x + Math.floor((b.w - s.w) / 2), y = b.y + b.h - s.h + dy;
  if (PASS !== 2) {
    drawSprite(ctx, 'fx.bell.frame', x, y, {});
    const ang = Math.sin(t * 14) * sw * 0.55;
    drawSprite(ctx, 'fx.bell.bell', x + 2, y + 2, { rot: ang, ox: 3, oy: 0 });
  }
  if (sw > 0.5 && PASS !== 1) glowE(ctx, x + 5, y + 6, 8, '255,220,120', 0.12 * sw);
}
function drawSonde(ctx: Ctx, f: Fixture, b: Box, t: number) {
  const st = num(f, 'st', 0), fly = num(f, 'fly', 0), dy = dyOf(f);
  bcx(ctx, 'fx.sonde', b, 0, dy);
  const s = spriteSize('fx.sonde'), cx = b.x + b.w / 2, top = b.y + b.h - s.h + dy;
  if (st === 1) {
    // the balloon rides above the pad, tugging at its string
    const sway = Math.sin(t * 1.4 + f.id) * 1.5;
    balloon(ctx, cx + sway, top - 20, 7, t);
    rect(ctx, '#d6d0c4', cx + sway / 2, top - 13, 1, 12);
    if (PASS !== 2) drawSprite(ctx, 'fx.sonde.box', cx - 2, top + 1, {});
  } else if (st === 2) {
    const k = fly, rise = k * k * 1.6 + k * 8, drift = k * (G.wind * 1.2 + 2) + Math.sin(k * 1.3) * 2;
    const a = Math.max(0, Math.min(1, 1 - (k - 14) / 8));
    ctx.globalAlpha = a;
    balloon(ctx, cx + drift, top - 20 - rise, 7 + k * 0.12, t);
    rect(ctx, '#d6d0c4', cx + drift * 0.9, top - 13 - rise * 0.9, 1, 8);
    if (PASS !== 2) drawSprite(ctx, 'fx.sonde.box', cx + drift * 0.9 - 2, top - 6 - rise * 0.9, {});
    ctx.globalAlpha = 1;
  } else if (PASS !== 2) {
    // parts waiting on the pad
    rect(ctx, '#6a7488', cx - 5, top + s.h - 5, 4, 2);
  }
}
function balloon(ctx: Ctx, cx: number, cy: number, r: number, t: number) {
  if (PASS === 2) return;
  const R = Math.round(r);
  for (let y = -R; y <= R + 2; y++) {
    const yy = y < 0 ? y / R : y / (R + 2), hw = Math.round(R * Math.sqrt(Math.max(0, 1 - yy * yy)) * (y > 0 ? 1 - 0.25 * (y / (R + 2)) : 1));
    if (hw <= 0) continue;
    ctx.fillStyle = '#1b1726'; ctx.fillRect(Math.round(cx - hw - 1), Math.round(cy + y), 1, 1); ctx.fillRect(Math.round(cx + hw), Math.round(cy + y), 1, 1);
    ctx.fillStyle = '#f2e9d6'; ctx.fillRect(Math.round(cx - hw), Math.round(cy + y), hw * 2, 1);
    ctx.fillStyle = '#d96a3a'; ctx.fillRect(Math.round(cx + hw * 0.1), Math.round(cy + y), Math.max(1, Math.round(hw * 0.9)), 1);
    ctx.fillStyle = '#fff'; ctx.fillRect(Math.round(cx - hw * 0.55), Math.round(cy + y), 1, y > -R * 0.6 && y < R * 0.2 ? 1 : 0);
  }
  ctx.fillStyle = '#1b1726'; ctx.fillRect(Math.round(cx - R * 0.35), Math.round(cy - R - 1), Math.max(2, Math.round(R * 0.7)), 1);
  ctx.fillRect(Math.round(cx - 1), Math.round(cy + R + 2), 3, 1);
  void t;
}
/** Barrel / den extras: an ice crust over a frozen barrel, fox tracks leading away from a den. Called after the chest sprite. */
export function drawChestExtras(ctx: Ctx, f: Fixture, b: Box, t: number, pass: 0 | 1 | 2) {
  PASS = pass;
  const look = String(f.data?.look ?? '');
  const dy = dyOf(f), cx = b.x + b.w / 2;
  if (look === 'barrel' && f.data?.frozen === true && !artHooks.thawed(f)) {
    const y = b.y + b.h + dy;
    for (let i = 0; i < 9; i++) { const hh = 2 + Math.round(2.5 * hf(i * 3.1 + f.id)); rect(ctx, i % 3 === 1 ? '#bfe3ff' : '#e4f4ff', cx - 5 + i, y - hh - 1, 1, hh); }
    rect(ctx, '#ffffff', cx - 4, y - 4, 2, 1); rect(ctx, '#8fc4ee', cx - 5, y - 1, 10, 1);
    for (const k of [-5, 4]) rect(ctx, '#cfeaff', cx + k, y - 7 + (k > 0 ? 1 : 0), 1, 3);          // icicles on the hoops
  }
  if (look === 'den') {
    const y = b.y + b.h + dy;
    // paw prints: a trail toward the station (west) and the shore (east), alternating left/right
    for (let k = 1; k <= 7; k++) for (const side of [-1, 1]) {
      const x = cx + side * (9 + k * 7), yy = y - 1 - ((k + (side > 0 ? 1 : 0)) % 2);
      const a = 0.85 - k * 0.09; if (a <= 0.05) continue;
      ctx.globalAlpha = a; rect(ctx, '#7f93ad', x, yy, 1, 1); rect(ctx, '#7f93ad', x + 2, yy - 1, 1, 1); ctx.globalAlpha = 1;
    }
    if (num(f, 'seen', 0)) rect(ctx, '#e9c9a0', cx + 5, y - 2, 1, 1);
  }
  PASS = 0; void t;
}

/** Draw a station object; false = not one of ours. */
export function drawStationArt(ctx: Ctx, v: View, f: Fixture, t: number, pass: 0 | 1 | 2): boolean {
  PASS = pass;
  const b = box(f, v);
  let handled = true;
  switch (f.kind) {
    case 'generator': drawGenerator(ctx, f, b, t); break;
    case 'ceiling_lamp': drawLampE(ctx, f, b, t); break;
    case 'heater': drawHeater(ctx, f, b, t); break;
    case 'medkit': drawMedkit(ctx, f, b, t); break;
    case 'kettle': drawKettle(ctx, f, b, t); break;
    case 'gramophone': drawGramophone(ctx, f, b, t); break;
    case 'hatch': drawHatch(ctx, f, b); break;
    case 'shutter': drawShutter(ctx, f, b); break;
    case 'damper': drawDamper(ctx, f, b); break;
    case 'bell': drawBell(ctx, f, b, t); break;
    case 'sonde': drawSonde(ctx, f, b, t); break;
    default: handled = false;
  }
  PASS = 0;
  return handled;
}
/** Emissive halos of lit station objects (drawFixtureGlowArt). */
export function glowStation(ctx: Ctx, f: Fixture, v: View, t: number): boolean {
  void ctx; void v; void t;
  return f.kind === 'ceiling_lamp' || f.kind === 'heater' || f.kind === 'generator';
}
void drawFlame;

/** Sheet entries (appended to FIXTURE_SHEET by art/fixtures.ts). */
export const STATION_SHEET: { kind: Fixture['kind']; tw: number; th: number; variants: { name: string; patch: Partial<Fixture> }[] }[] = [
  { kind: 'generator', tw: 3, th: 2, variants: [{ name: 'cold', patch: { fuel: 200 } }, { name: 'running', patch: { lit: true, fuel: 300 } }, { name: 'pulling', patch: { fuel: 200, data: { pullv: 0.7 } } }, { name: 'stalled', patch: { fuel: 200, data: { stalled: true } } }, { name: 'dry', patch: { fuel: 0 } }] },
  { kind: 'ceiling_lamp', tw: 1, th: 2, variants: [{ name: 'off', patch: {} }, { name: 'on', patch: { lit: true } }] },
  { kind: 'heater', tw: 2, th: 1, variants: [{ name: 'off', patch: {} }, { name: 'on', patch: { lit: true } }] },
  { kind: 'medkit', tw: 2, th: 2, variants: [{ name: 'full', patch: { data: { bandage: 4, spirit: 2 } } }, { name: 'open', patch: { data: { bandage: 3, spirit: 2, openT: 1 } } }, { name: 'empty', patch: { data: { bandage: 0, spirit: 0 } } }] },
  { kind: 'kettle', tw: 1, th: 1, variants: [{ name: 'empty', patch: {} }, { name: 'water', patch: { data: { water: 2 } } }, { name: 'hot', patch: { data: { water: 1, hot: 2 } } }] },
  { kind: 'gramophone', tw: 2, th: 1, variants: [{ name: 'idle', patch: {} }, { name: 'playing', patch: { data: { play: true, rec: 2 } } }] },
  { kind: 'hatch', tw: 1, th: 8, variants: [{ name: 'ladder', patch: {} }] },
  { kind: 'shutter', tw: 1, th: 8, variants: [{ name: 'open', patch: {} }, { name: 'closed', patch: { data: { closed: true } } }] },
  { kind: 'damper', tw: 1, th: 1, variants: [{ name: 'half', patch: { data: { d: 1 } } }, { name: 'open', patch: { data: { d: 2 } } }, { name: 'closed', patch: { data: { d: 0 } } }] },
  { kind: 'bell', tw: 1, th: 2, variants: [{ name: 'still', patch: {} }, { name: 'ringing', patch: { data: { sw: 1 } } }] },
  { kind: 'sonde', tw: 2, th: 4, variants: [{ name: 'pad', patch: {} }, { name: 'ready', patch: { data: { st: 1 } } }, { name: 'flying', patch: { data: { st: 2, fly: 6 } } }] },
  { kind: 'chest', tw: 2, th: 2, variants: [{ name: 'barrel', patch: { items: [{ id: 'diesel', n: 1 }], data: { look: 'barrel', frozen: true } } }, { name: 'barrel open', patch: { open: true, items: [], data: { look: 'barrel' } } }, { name: 'den', patch: { items: [{ id: 'fat', n: 1 }], data: { look: 'den' } } }] },
];
