// CONTRACT FILE (signatures) — entity drawing. The art agent owns the implementations; gameplay code calls these
// from render layers (z < 0 so sprites are lit by the light map; see View rules in state.ts). Coordinates: world cells.
// Art lives in src/art/*.ts (player, tools, animals, fixtures, icons) on top of the sprite registry in engine/sprites.ts.
import type { View, Player, Animal, Fixture, Drop } from './state';
import { inv } from './inventory';
import { getItem } from './items';
import { drawFixtureArt, drawFixtureGlowArt } from '../art/fixtures';
import { poseFor, renderPose, newPose, lookFromWear, DEFAULT_LOOK, type Look } from '../art/player';
import { animalFrame, pickFrame, KIND_FALLBACK } from '../art/animals';
import { spriteCanvas, silhouette, newCanvas } from '../engine/sprites';
import { uiIcon, moonIcon } from '../art/icons';
import '../art/tools';

export { uiIcon, moonIcon };
export interface HeldInfo { item: string | null; aim: number /*radians, 0 = right*/; swing: number /*0..1 current swing*/; using: boolean; load?: number /*shovel snow 0..1*/ }
export interface TargetInfo {
  tx: number; ty: number; tw: number; th: number;        // target rect in TILES
  mode: 'dig' | 'cut' | 'place' | 'attack' | 'use' | 'chisel' | 'none';
  ok: boolean; progress: number;                         // 0..1 work progress (cracks / cut line)
  ghostItem?: string; margin?: number; lean?: -1 | 0 | 1; // placement ghost (support margin 0..1, dome lean)
}

const TS = 4;
type Ctx = CanvasRenderingContext2D;

// ---------------------------------------------------------------------------------------------------------------------------------- config
export const artConfig = {
  /** true when the host also registers an emissive layer calling drawFixtureEmissive(): flames are then skipped in drawFixture. */
  splitFixturePass: false,
  /** Override the player's look (sprite sheet / tests); null = read the worn items from the inventory. */
  lookOverride: null as Look | null,
};
export function setPlayerLook(l: Look | null) { artConfig.lookOverride = l; }

// ---------------------------------------------------------------------------------------------------------------------------------- player
const poseScratch = newPose();
let lookCache: Look = DEFAULT_LOOK, lookSig = '';
function currentLook(): Look {
  if (artConfig.lookOverride) return artConfig.lookOverride;
  const w = inv.wear, sig = (w.head ?? '') + '|' + (w.body ?? '') + '|' + (w.hands ?? '') + '|' + (w.feet ?? '');
  if (sig !== lookSig) { lookSig = sig; lookCache = lookFromWear(w); }
  return lookCache;
}
export function drawPlayer(ctx: Ctx, v: View, p: Player, held: HeldInfo): void {
  const s = poseFor(p, held, v.t, poseScratch);
  renderPose(ctx, p.x - v.x0, p.y - v.y0, s, currentLook());
}

// ---------------------------------------------------------------------------------------------------------------------------------- animals
export const ANIMAL_STATES = ['idle', 'walk', 'run', 'sit', 'sleep', 'bark', 'sniff', 'lie', 'surface', 'dive', 'fly', 'rear', 'charge', 'swipe', 'dead'];
function barkArcs(ctx: Ctx, x: number, y: number, f: number) {
  ctx.fillStyle = 'rgba(240,248,255,0.85)';
  for (let i = 0; i < 3; i++) { const o = i * 3 + 1; ctx.fillRect(x + o, y - 1 - i, 1, 3 + i * 2); }
  void f;
}
export function drawAnimal(ctx: Ctx, v: View, a: Animal, t: number): void {
  const kind = KIND_FALLBACK[a.kind] ?? a.kind;
  const speed = Math.abs(a.vx);
  const { state, f } = pickFrame(kind, a.state, a.x * a.face, t, a.id, speed);
  const fr = animalFrame(kind, state, f); if (!fr) return;
  const x = Math.round(a.x - v.x0), y = Math.round(a.y - v.y0 + (kind === 'fish' ? -a.h / 2 + 2 : 0));
  ctx.save();
  ctx.translate(x, y); ctx.scale(a.face, 1);
  ctx.drawImage(fr.c, -fr.ax, -fr.c.height);
  if (state === 'bark' && f === 1) barkArcs(ctx, fr.c.width - fr.ax, -fr.c.height + 4, f);
  if (state === 'sleep' && (kind === 'dog' || kind === 'bear' || kind === 'fox')) {
    const k = (t * 0.6 + a.id * 0.37) % 1; ctx.globalAlpha = 1 - k; ctx.fillStyle = '#dcecff';
    const zx = Math.round(fr.c.width / 2 - fr.ax + 2 + k * 3), zy = Math.round(-fr.c.height - 2 - k * 6);
    ctx.fillRect(zx, zy, 3, 1); ctx.fillRect(zx + 1, zy + 1, 1, 1); ctx.fillRect(zx, zy + 2, 3, 1); ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------------------------------------------- fixtures
export function drawFixture(ctx: Ctx, v: View, f: Fixture, t: number): void { drawFixtureArt(ctx, v, f, t, artConfig.splitFixturePass ? 1 : 0); }
/** Emissive pass (register at 0 ≤ z < 100 and call setSplitFixturePass(true)): flames, embers, glows. */
export function drawFixtureEmissive(ctx: Ctx, v: View, f: Fixture, t: number): void { if (!f.lit) return; drawFixtureArt(ctx, v, f, t, 2); drawFixtureGlowArt(ctx, v, f, t); }
export function setSplitFixturePass(on: boolean) { artConfig.splitFixturePass = on; }

// ---------------------------------------------------------------------------------------------------------------------------------- drops
const dropCache = new Map<string, HTMLCanvasElement>();
/** 10×10 world icon for an item (the 16×16 icon shrunk with a dark rim); snow blocks and notes have their own shapes. */
export function dropIcon(id: string): HTMLCanvasElement {
  let c = dropCache.get(id); if (c) return c;
  const icon = spriteCanvas(getItem(id).icon);
  if (id === 'snow_block') {
    c = newCanvas(10, 6); const x = c.getContext('2d')!;
    x.fillStyle = '#1b1726'; x.fillRect(0, 0, 10, 6); x.fillStyle = '#e6eff9'; x.fillRect(1, 1, 8, 4); x.fillStyle = '#fff'; x.fillRect(1, 1, 8, 1); x.fillRect(1, 1, 1, 4); x.fillStyle = '#b9cbe0'; x.fillRect(2, 4, 7, 1); x.fillRect(8, 2, 1, 3);
  } else if (!icon) {
    c = newCanvas(8, 8); const x = c.getContext('2d')!; x.fillStyle = '#e6b84f'; x.fillRect(1, 1, 6, 6); x.fillStyle = '#1b1726'; x.fillRect(2, 2, 4, 4);
  } else {
    const small = newCanvas(8, 8), sx = small.getContext('2d')!; sx.imageSmoothingEnabled = true; sx.imageSmoothingQuality = 'high'; sx.drawImage(icon, 0, 0, 8, 8);
    c = newCanvas(10, 10); const x = c.getContext('2d')!; x.imageSmoothingEnabled = false;
    const sil = silhouette(small, '#1b1726');
    for (const [dx, dy] of [[0, 1], [2, 1], [1, 0], [1, 2]]) x.drawImage(sil, dx, dy);
    x.drawImage(small, 1, 1);
  }
  dropCache.set(id, c); return c;
}
export function drawDrop(ctx: Ctx, v: View, d: Drop, t: number): void {
  const c = dropIcon(d.item);
  const bob = Math.round(Math.sin(t * 3 + d.id * 1.7) * 1.2), x = Math.round(d.x - v.x0), y = Math.round(d.y - v.y0);
  ctx.globalAlpha = 0.25; ctx.fillStyle = '#0a0e18'; ctx.fillRect(x - Math.floor(c.width / 2) + 1, y + 1, c.width - 2, 1); ctx.globalAlpha = 1;
  const a = d.age < 0.25 ? d.age / 0.25 : 1; if (a < 1) ctx.globalAlpha = a;
  ctx.drawImage(c, x - Math.floor(c.width / 2), y - c.height + bob);
  if (a < 1) ctx.globalAlpha = 1;
  if (/^(note|radio_|battery)/.test(d.item) || d.item === 'flare_gun') {           // lore / quest items glint
    const k = (t * 1.2 + d.id) % 1; if (k < 0.3) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x + 2, y - c.height + bob - 1, 1, 1); ctx.fillRect(x + 1, y - c.height + bob, 3, 1); ctx.fillRect(x + 2, y - c.height + bob + 1, 1, 1); }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------- target
const crackCache = new Map<string, number[][]>();
function cracks(tx: number, ty: number, w: number, h: number): number[][] {
  const key = tx + ',' + ty + ',' + w + ',' + h; let c = crackCache.get(key); if (c) return c;
  let s = (tx * 73856093) ^ (ty * 19349663) ^ 0x9e3779b9; const rnd = () => { s = Math.imul(s ^ (s >>> 15), 2246822519); s ^= s >>> 13; return ((s >>> 0) % 10000) / 10000; };
  const out: number[][] = [];
  const cx = w / 2 + (rnd() - 0.5) * 3, cy = h / 2 + (rnd() - 0.5) * 3;
  const arms = 5 + Math.round(w * h / 40);
  for (let a = 0; a < arms; a++) {
    let x = cx, y = cy, ang = (a / arms) * Math.PI * 2 + rnd() * 0.8;
    const segs = 2 + Math.floor(rnd() * 2);
    for (let k = 0; k < segs; k++) { const len = 2 + rnd() * 3.2, nx = x + Math.cos(ang) * len, ny = y + Math.sin(ang) * len; out.push([x, y, nx, ny, a * 3 + k]); x = nx; y = ny; ang += (rnd() - 0.5) * 1.1; }
  }
  out.sort((p, q) => p[4] - q[4]);
  if (crackCache.size > 200) crackCache.clear();
  crackCache.set(key, out); return out;
}
function lineCells(ctx: Ctx, x0: number, y0: number, x1: number, y1: number) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let err = dx + dy;
  for (;;) { ctx.fillRect(x0, y0, 1, 1); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
}
function corners(ctx: Ctx, x: number, y: number, w: number, h: number, col: string, len = 3) {
  ctx.fillStyle = 'rgba(8,14,28,0.6)';
  ctx.fillRect(x - 1, y - 1, len + 2, 3); ctx.fillRect(x - 1, y - 1, 3, len + 2);
  ctx.fillRect(x + w - len - 1, y - 1, len + 2, 3); ctx.fillRect(x + w - 2, y - 1, 3, len + 2);
  ctx.fillRect(x - 1, y + h - 2, len + 2, 3); ctx.fillRect(x - 1, y + h - len - 1, 3, len + 2);
  ctx.fillRect(x + w - len - 1, y + h - 2, len + 2, 3); ctx.fillRect(x + w - 2, y + h - len - 1, 3, len + 2);
  ctx.fillStyle = col;
  ctx.fillRect(x, y, len, 1); ctx.fillRect(x, y, 1, len);
  ctx.fillRect(x + w - len, y, len, 1); ctx.fillRect(x + w - 1, y, 1, len);
  ctx.fillRect(x, y + h - 1, len, 1); ctx.fillRect(x, y + h - len, 1, len);
  ctx.fillRect(x + w - len, y + h - 1, len, 1); ctx.fillRect(x + w - 1, y + h - len, 1, len);
}
const marginColour = (m: number) => (m >= 0.45 ? '#6fd98a' : m >= 0.18 ? '#f0c050' : '#e5604f');
const FRAME_OK = 'rgba(226,242,255,0.95)', FRAME_BAD = 'rgba(229,96,79,0.95)';

export function drawTarget(ctx: Ctx, v: View, t: TargetInfo): void {
  if (t.mode === 'none') return;
  const x = t.tx * TS - v.x0, y = t.ty * TS - v.y0, w = t.tw * TS, h = t.th * TS;
  const tm = v.t, pulse = 0.65 + 0.35 * Math.sin(tm * 6);
  const col = t.ok ? FRAME_OK : FRAME_BAD;
  if (t.mode === 'place') {
    const m = t.margin ?? 1, mc = t.ok ? marginColour(m) : '#e5604f';
    const item = t.ghostItem ? getItem(t.ghostItem) : null;
    const lean = t.lean ?? 0;
    ctx.globalAlpha = 0.55;
    if (item && item.fixture) {
      // placement ghost of a fixture: its own art, translucent
      const fx: Fixture = { id: 0, kind: item.fixture, tx: t.tx, ty: t.ty, tw: t.tw, th: t.th, lit: false };
      drawFixtureArt(ctx, v, fx, tm, 1);
    } else if (item && item.kind === 'block' || t.ghostItem === 'snow_block') {
      // snow block ghost; dome mode shaves the block so its upper edge leans inward
      ctx.fillStyle = mc; ctx.globalAlpha = 0.32;
      const sh = lean * 3;
      ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w + sh, y); ctx.lineTo(x + sh, y); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 0.9; ctx.strokeStyle = mc; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x + 0.5, y + h - 0.5); ctx.lineTo(x + w - 0.5, y + h - 0.5); ctx.lineTo(x + w + sh - 0.5, y + 0.5); ctx.lineTo(x + sh + 0.5, y + 0.5); ctx.closePath(); ctx.stroke();
      ctx.globalAlpha = 0.55; ctx.fillStyle = '#ffffff'; ctx.fillRect(x + 1 + Math.max(0, sh), y + 1, Math.max(1, w - 2), 1);
    } else if (item) {
      const ic = spriteCanvas(item.icon);
      ctx.fillStyle = mc; ctx.globalAlpha = 0.28; ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 0.7; if (ic) ctx.drawImage(ic, Math.round(x + w / 2 - 8), Math.round(y + h / 2 - 8));
    } else { ctx.fillStyle = mc; ctx.globalAlpha = 0.3; ctx.fillRect(x, y, w, h); }
    ctx.globalAlpha = 1;
    corners(ctx, x, y, w, h, mc, 3);
    // margin ticks under the ghost: three pips light up with the support margin
    const pips = m >= 0.7 ? 3 : m >= 0.4 ? 2 : m >= 0.15 ? 1 : 0;
    for (let i = 0; i < 3; i++) { ctx.fillStyle = i < pips ? mc : 'rgba(10,16,28,0.7)'; ctx.fillRect(Math.round(x + w / 2 - 5 + i * 4), y + h + 2, 3, 1); }
    return;
  }
  if (t.mode === 'attack') {
    const cx = x + w / 2, cy = y + h / 2, r = 5 + Math.round(pulse);
    ctx.fillStyle = FRAME_BAD;
    for (const [dx, dy] of [[-r, 0], [r - 1, 0], [0, -r], [0, r - 1]]) ctx.fillRect(Math.round(cx + dx), Math.round(cy + dy), 2, 2);
    ctx.fillRect(Math.round(cx), Math.round(cy), 1, 1);
    return;
  }
  // frame: corner brackets + a faint full rect
  ctx.globalAlpha = 0.35; ctx.fillStyle = col; ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1); ctx.fillRect(x, y, 1, h); ctx.fillRect(x + w - 1, y, 1, h); ctx.globalAlpha = 1;
  corners(ctx, x, y, w, h, col, t.mode === 'use' ? 2 + Math.round(pulse) : 3);
  if (!t.ok) { ctx.fillStyle = FRAME_BAD; ctx.globalAlpha = 0.25; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1; return; }
  const p = Math.max(0, Math.min(1, t.progress));
  if (t.mode === 'cut' && p > 0) {
    // the knife line travels around the block outline
    const per = 2 * (w + h), len = p * per;
    const pt = (d: number): [number, number] => d < w ? [x + d, y] : d < w + h ? [x + w - 1, y + (d - w)] : d < 2 * w + h ? [x + w - 1 - (d - w - h), y + h - 1] : [x, y + h - 1 - (d - 2 * w - h)];
    ctx.fillStyle = 'rgba(8,14,28,0.6)';
    for (let d = 0; d < len; d++) { const [px, py] = pt(d); ctx.fillRect(Math.round(px) - 1, Math.round(py) - 1, 3, 3); }
    ctx.fillStyle = '#d4f0ff';
    for (let d = 0; d < len; d++) { const [px, py] = pt(d); ctx.fillRect(Math.round(px), Math.round(py), 1, 1); }
    const [hx, hy] = pt(Math.min(per - 1, len)); ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(hx) - 1, Math.round(hy) - 1, 3, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(Math.round(hx) + ((tm * 20) % 3), Math.round(hy) - 2 - ((tm * 13) % 3), 1, 1);
  } else if ((t.mode === 'dig' || t.mode === 'chisel') && p > 0) {
    const cs = cracks(t.tx, t.ty, w, h), n = Math.max(1, Math.ceil(p * cs.length));
    ctx.fillStyle = 'rgba(10,16,30,0.85)';
    for (let i = 0; i < n; i++) { const c = cs[i]; lineCells(ctx, x + c[0], y + c[1], x + c[2], y + c[3]); }
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i < n; i += 2) { const c = cs[i]; ctx.fillRect(Math.round(x + c[0]) + 1, Math.round(y + c[1]), 1, 1); }
    if (t.mode === 'chisel') { ctx.fillStyle = 'rgba(190,230,255,0.8)'; ctx.fillRect(Math.round(x + w / 2) - 1, Math.round(y + h / 2) - 1, 2, 2); }
    // progress bar under the tile
    ctx.fillStyle = 'rgba(10,16,28,0.75)'; ctx.fillRect(x, y + h + 2, w, 2);
    ctx.fillStyle = '#9fd8ff'; ctx.fillRect(x, y + h + 2, Math.max(1, Math.round(w * p)), 2);
  } else if (p > 0) {
    ctx.fillStyle = 'rgba(10,16,28,0.75)'; ctx.fillRect(x, y + h + 2, w, 2); ctx.fillStyle = '#ffd88a'; ctx.fillRect(x, y + h + 2, Math.max(1, Math.round(w * p)), 2);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------- sled
/** Sled (нарты). (x,y) = middle of the runners on the ground; load 0..1 fills the deck with bundles. */
export function drawSled(ctx: Ctx, v: View, x: number, y: number, load: number): void {
  const X = Math.round(x - v.x0), Y = Math.round(y - v.y0);
  const r = (c: string, a: number, b: number, w: number, h: number) => { ctx.fillStyle = c; ctx.fillRect(X + a, Y + b, w, h); };
  // runners (curled up at the front)
  r('#1b1726', -12, -2, 25, 3); r('#8a6a4a', -11, -1, 23, 1); r('#5a4430', -11, 0, 22, 1); r('#d8e4f0', -11, 0, 4, 0);
  r('#1b1726', 11, -5, 3, 4); r('#8a6a4a', 12, -4, 1, 3); r('#1b1726', 12, -6, 2, 2);
  // stanchions & deck
  for (const dx of [-9, -2, 5]) { r('#1b1726', dx - 1, -6, 4, 5); r('#6e4a2a', dx, -5, 2, 4); }
  r('#1b1726', -12, -8, 25, 3); r('#b58450', -11, -7, 23, 1); r('#8e5f38', -11, -6, 23, 1);
  for (let i = -10; i < 12; i += 4) r('#5a3a22', i, -7, 1, 2);
  // tow rope
  ctx.fillStyle = '#c9a77a'; for (let i = 0; i < 8; i++) ctx.fillRect(X + 14 + i, Y - 4 + Math.round(Math.sin(i * 0.6) * 0.6), 1, 1);
  // cargo
  const n = Math.max(0, Math.min(5, Math.ceil(load * 5)));
  const items: [string, string, number, number, number, number][] = [
    ['#7d8aa0', '#aab6c8', -10, -14, 8, 6], ['#b8905a', '#dcc08e', -1, -13, 7, 5], ['#e4492d', '#f58b6a', 6, -12, 5, 4], ['#cfc3a8', '#f1e8d6', -7, -19, 6, 5], ['#7a5a3a', '#a98458', 1, -17, 6, 4],
  ];
  for (let i = 0; i < n; i++) {
    const [c, hl, a, b, w, h] = items[i];
    r('#1b1726', a - 1, b - 1, w + 2, h + 2); r(c, a, b, w, h); r(hl, a, b, w, 1); r('#1b1726', a + Math.floor(w / 2), b, 1, h);
  }
}

