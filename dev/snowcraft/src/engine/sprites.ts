// Pixel-art sprites as string grids + palettes. Extensible registry: defSprite(key, palette, frames) then drawSprite()/icon().
// Only the fixture sprites needed by the world live here for now (campfire, stove, chest, door, bed, radio, helipad, workbench,
// torch, sign); the full art pass (player, animals, items, UI icons) is added by the art agent through the same defSprite() API.
import { G, Fixture, View } from '../game/state';

export type Palette = Record<string, string>;
export interface DrawOpts { frame?: number; flip?: boolean; tint?: string; alpha?: number; rot?: number; ox?: number; oy?: number; scale?: number }
interface SpriteDef { w: number; h: number; pal: Palette; frames: string[][]; canvases: (HTMLCanvasElement | null)[] }
const SPRITES = new Map<string, SpriteDef>();

/** Register a sprite. `frames` is one frame (string[]) or several (string[][]). '.' / ' ' = transparent; other chars index `pal` ('#rrggbb'). */
export function defSprite(key: string, pal: Palette, frames: string[] | string[][]) {
  const fr = (typeof frames[0] === 'string' ? [frames as string[]] : frames) as string[][];
  const h = fr[0].length, w = Math.max(...fr[0].map(r => r.length));
  SPRITES.set(key, { w, h, pal, frames: fr, canvases: fr.map(() => null) });
}
export function hasSprite(key: string) { return SPRITES.has(key); }
export function spriteSize(key: string): { w: number; h: number; frames: number } {
  const s = SPRITES.get(key); return s ? { w: s.w, h: s.h, frames: s.frames.length } : { w: 8, h: 8, frames: 1 };
}

function hexToRgb(c: string): [number, number, number, number] {
  const h = c.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255];
}
function frameCanvas(s: SpriteDef, f: number): HTMLCanvasElement {
  f = ((f % s.frames.length) + s.frames.length) % s.frames.length;
  let c = s.canvases[f];
  if (c) return c;
  c = document.createElement('canvas'); c.width = s.w; c.height = s.h;
  const cx = c.getContext('2d')!, img = cx.createImageData(s.w, s.h), d = img.data;
  const cache: Record<string, [number, number, number, number]> = {};
  const rows = s.frames[f];
  for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) {
    const ch = rows[y][x]; if (ch === '.' || ch === ' ') continue;
    const col = s.pal[ch]; if (!col) continue;
    const rgba = cache[ch] ?? (cache[ch] = hexToRgb(col));
    const o = (y * s.w + x) * 4; d[o] = rgba[0]; d[o + 1] = rgba[1]; d[o + 2] = rgba[2]; d[o + 3] = rgba[3];
  }
  cx.putImageData(img, 0, 0);
  s.canvases[f] = c; return c;
}

const tintCache = new Map<string, HTMLCanvasElement>();
function tinted(key: string, s: SpriteDef, f: number, tint: string) {
  const k = key + '|' + f + '|' + tint;
  let c = tintCache.get(k);
  if (c) return c;
  if (tintCache.size > 300) tintCache.clear();
  const src = frameCanvas(s, f);
  c = document.createElement('canvas'); c.width = s.w; c.height = s.h;
  const cx = c.getContext('2d')!; cx.drawImage(src, 0, 0);
  cx.globalCompositeOperation = 'source-atop'; cx.fillStyle = tint; cx.fillRect(0, 0, s.w, s.h);
  tintCache.set(k, c); return c;
}

/** Draw sprite with its top-left at (x,y) (view-relative cells). rot rotates about (ox,oy) inside the sprite (default centre). */
export function drawSprite(ctx: CanvasRenderingContext2D, key: string, x: number, y: number, o: DrawOpts = {}) {
  const s = SPRITES.get(key); if (!s) return;
  const f = o.frame ?? 0;
  const img = o.tint ? tinted(key, s, f, o.tint) : frameCanvas(s, f);
  const px = Math.round(x), py = Math.round(y);
  const a = o.alpha ?? 1;
  const needT = o.flip || o.rot || (o.scale !== undefined && o.scale !== 1);
  if (a !== 1) ctx.globalAlpha = a;
  if (!needT) ctx.drawImage(img, px, py);
  else {
    ctx.save();
    const ox = o.ox ?? s.w / 2, oy = o.oy ?? s.h / 2;
    ctx.translate(px + ox, py + oy);
    if (o.rot) ctx.rotate(o.rot);
    const sc = o.scale ?? 1;
    ctx.scale(o.flip ? -sc : sc, sc);
    ctx.drawImage(img, -ox, -oy);
    ctx.restore();
  }
  if (a !== 1) ctx.globalAlpha = 1;
}

const iconCache = new Map<string, HTMLCanvasElement>();
/** UI icon: the sprite's first frame on its own canvas (scale with CSS image-rendering: pixelated). Unknown keys give a placeholder. */
export function icon(key: string): HTMLCanvasElement {
  let c = iconCache.get(key); if (c) return c;
  const s = SPRITES.get(key);
  if (s) c = frameCanvas(s, 0);
  else {
    c = document.createElement('canvas'); c.width = c.height = 12;
    const cx = c.getContext('2d')!; cx.fillStyle = '#24364c'; cx.fillRect(0, 0, 12, 12); cx.fillStyle = '#7cc6ee'; cx.fillRect(1, 1, 10, 10); cx.fillStyle = '#0b1220'; cx.fillRect(2, 2, 8, 8);
  }
  iconCache.set(key, c); return c;
}

// ---------------------------------------------------------------------------------------------------------------------
// fixture art (side view, 1 char = 1 cell). Footprints (tiles): chest 2×2, door 1×5, bed 4×1, workbench 3×2, stove 2×2, campfire 2×1,
// radio 2×2, helipad 12×1, torch 1×2. Sprites may be taller than the footprint (pipe, antenna, poles): they are bottom-anchored.
const WOOD: Palette = { D: '#2c1a10', B: '#7d4f2c', C: '#a46d3c', c: '#bf874f', G: '#4d5361', g: '#6f7787', Y: '#e6c25a' };
defSprite('chest', WOOD, [
  '.DDDDDD.',
  'DCccccCD',
  'DCBBBBCD',
  'DGggggGD',
  'DBBYYBBD',
  'DBBYYBBD',
  'DBBBBBBD',
  '.DDDDDD.',
]);
{
  // door: 4×20; frame 0 closed, frame 1 open (thin slab at the hinge)
  const pal: Palette = { D: '#2c1a10', P: '#9a6638', Q: '#82522c', B: '#5c3a1e', Y: '#e6c25a', S: '#c08850' };
  const closed: string[] = [];
  for (let y = 0; y < 20; y++) {
    if (y === 0 || y === 19) closed.push('DDDD');
    else if (y === 3 || y === 4 || y === 15 || y === 16) closed.push('DBBD');
    else if (y === 10) closed.push('DPPD'.replace('P', 'P'));
    else if (y === 11) closed.push('DPYD');
    else closed.push(y % 2 ? 'DPQD' : 'DSQD');
  }
  const open: string[] = [];
  for (let y = 0; y < 20; y++) open.push(y < 1 || y > 18 ? 'D...' : y === 11 ? 'PY..' : 'PQ..');
  defSprite('door', pal, [closed, open]);
}
defSprite('bed', { D: '#3a2616', W: '#e8eef4', w: '#c3ccd8', R: '#b04a4a', r: '#8e3a3e', B: '#7d4f2c' }, [
  'DD..............',
  'DWWWRRRRRRRRRRD.',
  'DwWWrrrrrrrrrrrD',
  'DBDDDDDDDDDDDDBD',
]);
defSprite('stove', { K: '#2a2c34', I: '#41454f', i: '#5a606d', F: '#14141a', O: '#ffb040', Y: '#ffe48a', p: '#30333c', q: '#565c68', P: '#6a7080', L: '#1d1f26' }, [
  [
    '...pq...', '...pq...', '...pq...', '...pq...', '...pq...', '...pq...', '...pq...', '..PPPP..',
    '.iiiiii.', 'KIIIIIIK', 'KIFFFFIK', 'KIFFFFIK', 'KIIiiIIK', 'KIIIIIIK', '.KKKKKK.', '.L....L.',
  ],
  [
    '...pq...', '...pq...', '...pq...', '...pq...', '...pq...', '...pq...', '...pq...', '..PPPP..',
    '.iiiiii.', 'KIIIIIIK', 'KIOYYOIK', 'KIOOOOIK', 'KIIiiIIK', 'KIIIIIIK', '.KKKKKK.', '.L....L.',
  ],
]);
defSprite('campfire', { L: '#6b4528', l: '#8a5c36', e: '#c89a62', S: '#7c8794', s: '#5b6572', a: '#2a2a30' }, [
  '..eLLe..',
  '.LLllLL.',
  'sSLaaLSs',
  'SsSSSSsS',
]);
defSprite('radio', { K: '#5d6f50', D: '#2a3326', G: '#1a2a22', g: '#82f0a0', S: '#3c4a38', n: '#c7ccb8', A: '#9aa1ab', R: '#e5604f', k: '#47563f' }, [
  [
    '......A.', '......A.', '.....A..', '.....A..',
    'DDDDDDDD', 'DKKKKKKD', 'DKGGSSKD', 'DKGGSSKD', 'DKKKKKkD', 'DKnKnKRD', 'DkkkkkkD', '.DDDDDD.',
  ],
  [
    '......A.', '......A.', '.....A..', '.....A..',
    'DDDDDDDD', 'DKKKKKKD', 'DKggSSKD', 'DKggSSKD', 'DKKKKKkD', 'DKnKnKgD', 'DkkkkkkD', '.DDDDDD.',
  ],
]);
defSprite('workbench', { T: '#b98350', t: '#8c5e36', L: '#5c3a1e', x: '#4a2e18', v: '#6d7482', V: '#9aa1ab', h: '#c9ced6', H: '#6b4528', D: '#2c1a10' }, [
  '.....hh.vVV.',
  '.....H..vvv.',
  'TTTTTTTTTTTT',
  'tttttttttttt',
  '.LL......LL.',
  '.LL.xxxx.LL.',
  '.LL......LL.',
  '.LL......LL.',
]);
{
  // helipad: 48 wide, 20 tall (poles + windsock above a 4-row slab flush with the ground)
  const pal: Palette = { C: '#7e8795', c: '#646c79', d: '#3d424d', Y: '#f0c648', W: '#e8eef4', p: '#56606e', r: '#e5604f', w: '#f4f0ea', R: '#b8453a', L: '#7a2020' };
  const rows: string[] = [];
  for (let y = 0; y < 20; y++) {
    const a = new Array(48).fill('.');
    if (y >= 4 && y <= 15) { a[1] = 'p'; a[46] = 'p'; }
    if (y === 3) { a[1] = 'L'; a[46] = 'L'; }
    if (y >= 4 && y <= 6) { // windsock on the left pole, blowing to the right
      const len = y === 5 ? 9 : 7;
      for (let k = 0; k < len; k++) a[2 + k] = ((k >> 1) & 1) ? 'w' : 'R';
    }
    if (y === 16) for (let x = 0; x < 48; x++) a[x] = (x % 6 < 3) ? 'Y' : 'W';
    else if (y === 17 || y === 18) for (let x = 0; x < 48; x++) a[x] = (x + y) % 11 === 0 ? 'c' : 'C';
    else if (y === 19) for (let x = 0; x < 48; x++) a[x] = 'd';
    rows.push(a.join(''));
  }
  defSprite('helipad', pal, rows);
}
defSprite('torch', { b: '#6b4528', B: '#8a5c36', k: '#2a2a30' }, ['.k.', '.b.', '.B.', '.b.', '.B.', '.b.', '.B.', '.b.']);
defSprite('sign', { B: '#7d4f2c', C: '#a46d3c', D: '#2c1a10', t: '#2c1a10' }, [
  'DDDDDDDD', 'DCCCCCCD', 'DCtCtCCD', 'DCCCCCCD', 'DDDBBDDD', '...BB...', '...BB...', '...BB...',
]);
defSprite('anvil', { K: '#3a3d46', k: '#59606c', L: '#23252c' }, ['kkkkkkkk', 'KKKKKKKK', '.KKKKKK.', '..KKKK..', '..LLLL..', '.LLLLLL.']);
defSprite('furnace', { S: '#7c8794', s: '#5b6572', K: '#2a2c34', O: '#ffb040', F: '#14141a' }, [
  '..ssss..', '.SSSSSS.', 'SSSSSSSS', 'SsFFFFsS', 'SsFFFFsS', 'SSSSSSSS', 'SsSSSSsS', 'SSSSSSSS',
]);

// ---------------------------------------------------------------------------------------------------------------------
function hf(n: number) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

/** Animated pixel flame: base centre (x,y) in view cells, half-width/height in cells. Use on an emissive ('lighter') layer. */
export function drawFlame(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, hw: number, hh: number, seed = 0, power = 1) {
  x = Math.round(x); y = Math.round(y);
  for (let dx = -hw; dx <= hw; dx++) {
    const k = 1 - Math.abs(dx) / (hw + 0.8);
    const wob = 0.62 + 0.38 * (Math.sin(t * 9.3 + dx * 1.9 + seed) * 0.5 + 0.5) * (0.7 + 0.3 * Math.sin(t * 17 + dx * 3.1 + seed * 2));
    const h = Math.max(1, Math.round(hh * k * wob * power));
    ctx.fillStyle = 'rgb(150,48,14)'; ctx.fillRect(x + dx, y - h, 1, h);
    if (h > 2) { ctx.fillStyle = 'rgb(214,98,24)'; ctx.fillRect(x + dx, y - Math.round(h * 0.72), 1, Math.round(h * 0.72)); }
    if (h > 3 && k > 0.45) { ctx.fillStyle = 'rgb(255,176,56)'; ctx.fillRect(x + dx, y - Math.round(h * 0.5), 1, Math.round(h * 0.5)); }
    if (h > 4 && k > 0.8) { ctx.fillStyle = 'rgb(255,236,150)'; ctx.fillRect(x + dx, y - Math.round(h * 0.28), 1, Math.round(h * 0.28)); }
  }
}

// ---- fixture drawing (used by the temporary viewer; the gameplay agent's fixtures.ts may reuse/replace) ----
const SPRITE_OF: Partial<Record<Fixture['kind'], string>> = {
  chest: 'chest', door: 'door', bed: 'bed', stove: 'stove', campfire: 'campfire', radio: 'radio', helipad: 'helipad', workbench: 'workbench',
  torch: 'torch', sign: 'sign', anvil: 'anvil', furnace: 'furnace',
};
/** World-cell top-left of a fixture sprite (bottom-left anchored to the footprint, centred horizontally if the sprite is wider). */
export function fixtureSpriteOrigin(f: Fixture): [number, number] {
  const key = SPRITE_OF[f.kind]; const sz = key ? spriteSize(key) : { w: f.tw * 4, h: f.th * 4 };
  return [f.tx * 4 + Math.floor((f.tw * 4 - sz.w) / 2), (f.ty + f.th) * 4 - sz.h];
}
/** Lit sprite layer for fixtures (register at z<0, e.g. -5). */
export function drawFixtureSprites(ctx: CanvasRenderingContext2D, v: View) {
  const fx = G.fixtures;
  for (let i = 0; i < fx.length; i++) {
    const f = fx[i];
    const key = SPRITE_OF[f.kind]; if (!key) continue;
    const [sx, sy] = fixtureSpriteOrigin(f);
    const sz = spriteSize(key);
    if (sx + sz.w < v.x0 || sy + sz.h < v.y0 || sx > v.x0 + v.w || sy > v.y0 + v.h) continue;
    let frame = 0;
    if (f.kind === 'door') frame = f.open ? 1 : 0;
    else if (f.kind === 'stove') frame = f.lit ? 1 : 0;
    else if (f.kind === 'radio') frame = f.data && f.data.fixed ? 1 : 0;
    drawSprite(ctx, key, sx - v.x0, sy - v.y0, { frame });
  }
}
/** Emissive layer for fixtures (register at 0 <= z < 100): flames, window glow, helipad beacons. */
export function drawFixtureGlow(ctx: CanvasRenderingContext2D, v: View) {
  const fx = G.fixtures, t = v.t;
  for (let i = 0; i < fx.length; i++) {
    const f = fx[i];
    const [sx, sy] = fixtureSpriteOrigin(f);
    if (sx + 64 < v.x0 || sy + 40 < v.y0 || sx > v.x0 + v.w || sy - 40 > v.y0 + v.h) continue;
    const X = sx - v.x0, Y = sy - v.y0;
    if (f.kind === 'campfire' && f.lit) drawFlame(ctx, X + 4, Y + 2, t, 3, 9, f.id);
    else if (f.kind === 'torch' && f.lit) drawFlame(ctx, X + 1, Y + 1, t, 1, 5, f.id);
    else if (f.kind === 'stove' && f.lit) {
      ctx.fillStyle = `rgba(255,${150 + (Math.sin(t * 12 + f.id) * 30) | 0},60,0.5)`; ctx.fillRect(X + 2, Y + 10, 4, 2);
    } else if (f.kind === 'helipad') {
      const on = ((t * 1.2) | 0) % 2 === 0;
      ctx.fillStyle = on ? 'rgb(255,60,40)' : 'rgb(90,20,16)'; ctx.fillRect(X + 1, Y + 2, 1, 1); ctx.fillRect(X + 46, Y + 2, 1, 1);
      if (on) { ctx.fillStyle = 'rgba(255,60,40,0.25)'; ctx.fillRect(X, Y + 1, 3, 3); ctx.fillRect(X + 45, Y + 1, 3, 3); }
    } else if (f.kind === 'radio') {
      ctx.fillStyle = (((t * 2) | 0) % 2) ? 'rgb(230,60,40)' : 'rgb(60,12,10)'; ctx.fillRect(X + 6, Y + 9, 1, 1);
    }
    void hf;
  }
}
