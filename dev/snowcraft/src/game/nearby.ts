// Nearby things (DESIGN §12): lying drops (dropped items, coal sacks, driftwood pieces, notes), containers, a parked sled and a dead player's backpack
// that are within reach are highlighted in the world. E takes the NEAREST one in front of the player; when several are near, a «Рядом» list (E held, or the
// phone button) lets you choose. Small light things are picked up by walking over them, but only if the pack has room and the weight allows; heavy things
// (logs, sacks, blocks, tools, clothes, a backpack) never auto-pick: they need E.
import { G, toast, type Drop, type Fixture } from './state';
import { emit } from './bus';
import { strings, fmt } from '../content/i18n';
import { TS } from '../engine/grid';
import { addLayer } from '../engine/render';
import { inv, add, dropDur, backpacks, weight, unitWeight, fitByWeight, roomFor, thrown, hitchSled, sledNear, WEIGHT_SOFT } from './inventory';
import { getItem, itemName } from './items';
import { FIXTURE_DEFS } from './fixtures';
import { openContainer, openPack } from './search';

const S = strings('near', {
  picked: 'Взял: {name}', heavy: 'Не поднять: слишком тяжело', full: 'В сумке нет места', sled: 'Нарты', pack: 'Твой рюкзак', sledUp: 'Запрягся в нарты',
  partial: 'Взял часть: {name}',
});
export type NearKind = 'drop' | 'pack' | 'box' | 'sled';
export interface Near { kind: NearKind; id: number; x: number; y: number; dist: number; label: string; item?: string; n?: number; w: number; heavy: boolean; f?: Fixture }
export const REACH_NEAR = 26;           // cells: how far E reaches
export const AUTO_UNIT_MAX = 0.9;       // kg per item and
export const AUTO_STACK_MAX = 2;        // kg per drop for walking-over pickup

const BOXES = new Set(['chest', 'shelf', 'cache', 'cairn', 'cart']);
export const isBoxFixture = (f: Fixture) => BOXES.has(f.kind) || !!FIXTURE_DEFS[f.kind]?.storage;

/** May this drop be picked up by merely walking over it? */
export function autoPickable(d: Drop): boolean {
  if (d.item === 'backpack' || thrown.has(d.id)) return false;
  const it = getItem(d.item), dur = dropDur.get(d.id), unit = unitWeight(d.item, dur);
  if (it.kind === 'note') return roomFor(d.item, d.n) >= d.n;
  if (it.kind === 'tool' || it.kind === 'fixture' || it.kind === 'wear' || it.kind === 'block') return false;
  if (unit > AUTO_UNIT_MAX || unit * d.n > AUTO_STACK_MAX) return false;
  if (weight() + unit * d.n > WEIGHT_SOFT) return false;
  return roomFor(d.item, d.n, dur) >= d.n;
}
const isHeavy = (d: Drop) => { const u = unitWeight(d.item, dropDur.get(d.id)); return u > AUTO_UNIT_MAX || u * d.n > AUTO_STACK_MAX || getItem(d.item).kind === 'tool'; };

/** Everything in reach, nearest first (things behind the player count as a bit further). */
export function nearbyList(): Near[] {
  const p = G.player; if (!p || !p.alive) return [];
  const px = p.x, py = p.y - 8, out: Near[] = [];
  const score = (x: number, y: number) => { const dx = x - px, dy = y - py; return Math.hypot(dx, dy) + (dx * p.face < -4 ? 7 : 0); };
  for (const d of G.drops) {
    if (d.age < 0) continue;
    const dx = d.x - px, dy = d.y - py; if (Math.abs(dx) > REACH_NEAR || Math.abs(dy) > REACH_NEAR * 0.85) continue;
    if (d.item === 'backpack') { if (backpacks.has(d.id)) out.push({ kind: 'pack', id: d.id, x: d.x, y: d.y, dist: score(d.x, d.y), label: S.pack, item: 'backpack', n: 1, w: 0, heavy: false }); continue; }
    out.push({ kind: 'drop', id: d.id, x: d.x, y: d.y, dist: score(d.x, d.y), label: itemName(d.item) + (d.n > 1 ? ' ×' + d.n : ''), item: d.item, n: d.n, w: unitWeight(d.item, dropDur.get(d.id)) * d.n, heavy: isHeavy(d) });
  }
  for (const f of G.fixtures) {
    if (!isBoxFixture(f)) continue;
    const x = f.tx * TS + f.tw * 2, y = f.ty * TS + f.th * 2;
    if (Math.abs(x - px) > REACH_NEAR + f.tw * 2 || Math.abs(y - py) > REACH_NEAR + f.th * 2) continue;
    out.push({ kind: 'box', id: f.id, x, y, dist: score(x, y) + 3, label: fixtureTitle(f), w: 0, heavy: false, f });
  }
  const s = inv.sled;
  if (s && !s.hitched && sledNear(p.x, p.y - 4, REACH_NEAR)) out.push({ kind: 'sled', id: -1, x: s.x, y: s.y, dist: score(s.x, s.y) + 4, label: S.sled, w: 0, heavy: false });
  out.sort((a, b) => a.dist - b.dist);
  return out;
}
const fixtureTitle = (f: Fixture) => ({ chest: 'Сундук', shelf: 'Полка', cache: 'Тайник', cairn: 'Тур', cart: 'Вагонетка' } as Record<string, string>)[f.kind] ?? f.kind;

/** Take a lying drop into the pack (as much as the slots and the load allow). Returns how many were taken. */
export function pickDrop(d: Drop, quiet = false): number {
  const dur = dropDur.get(d.id);
  let k = Math.min(d.n, roomFor(d.item, d.n, dur));
  if (k <= 0) { if (!quiet) toast(S.full, 'warn'); return 0; }
  const w = fitByWeight(d.item, k, dur);
  if (w <= 0 && !/^note/.test(d.item)) { if (!quiet) toast(S.heavy, 'warn'); return 0; }
  k = /^note/.test(d.item) ? k : Math.min(k, w);
  const left = add(d.item, k, dur);
  const got = k - left; if (got <= 0) return 0;
  d.n -= got;
  emit('picked', { item: d.item, n: got });
  if (!quiet) toast(fmt(d.n > 0 ? S.partial : S.picked, { name: itemName(d.item) + (got > 1 ? ' ×' + got : '') }), 'info');
  if (/^note/.test(d.item) && d.n <= 0) emit('note_found', { id: d.item });
  if (d.n <= 0) { dropDur.delete(d.id); thrown.delete(d.id); const i = G.drops.indexOf(d); if (i >= 0) G.drops.splice(i, 1); }
  return got;
}
/** Act on one entry of the nearby list (drops go into the pack, a container / backpack opens its search panel, the sled is hitched). */
export function takeNear(n: Near): boolean {
  const p = G.player;
  switch (n.kind) {
    case 'drop': { const d = G.drops.find(q => q.id === n.id); return !!d && pickDrop(d) > 0; }
    case 'pack': return openPack(n.id);
    case 'box': return !!n.f && openContainer(n.f);
    case 'sled': if (p && inv.sled) { hitchSled(p.x, p.y); toast(S.sledUp, 'info'); return true; } return false;
  }
}

// ---- highlight in the world ---------------------------------------------------------------------------------------------------------
/** The «Рядом» list is open (tools.ts sets it when E is held, the phone button toggles it; ui/bag.ts draws it). */
export const nearUi = { open: false };
export const hi = { list: [] as Near[], best: null as Near | null, acc: 0 };
export function stepNearby(dt: number) {
  hi.acc += dt; if (hi.acc < 0.1) return; hi.acc = 0;
  hi.list = nearbyList(); hi.best = hi.list[0] ?? null;
}
const E_GLYPH = ['1111', '1000', '1110', '1000', '1111'];
function drawHi(ctx: CanvasRenderingContext2D, v: { x0: number; y0: number; t: number }) {
  if (!hi.list.length || !G.player?.alive) return;
  const t = v.t;
  for (let i = 0; i < hi.list.length && i < 8; i++) {
    const n = hi.list[i]; const best = i === 0;
    const x = Math.round(n.x - v.x0), y = Math.round(n.y - v.y0);
    const w = n.kind === 'box' && n.f ? n.f.tw * 2 + 1 : 7, top = n.kind === 'box' && n.f ? y - n.f.th * 2 - 1 : y - 10, bot = n.kind === 'box' && n.f ? y + n.f.th * 2 : y + 1;
    const pulse = 0.55 + 0.45 * Math.sin(t * 5 + i);
    ctx.globalAlpha = best ? 0.95 : 0.55 * pulse + 0.2;
    ctx.fillStyle = best ? '#ffd98a' : '#9fdcff';
    const l = x - w, r = x + w - 1;
    const corner = (cx: number, cy: number, sx: number, sy: number) => { ctx.fillRect(sx > 0 ? cx : cx - 2, cy, 3, 1); ctx.fillRect(cx, sy > 0 ? cy : cy - 2, 1, 3); };
    corner(l, top, 1, 1); corner(r, top, -1, 1); corner(l, bot, 1, -1); corner(r, bot, -1, -1);
    if (best) {
      const bob = Math.round(Math.sin(t * 4) * 1.2), kx = x - 3, ky = top - 10 + bob;
      ctx.globalAlpha = 1; ctx.fillStyle = '#1b1726'; ctx.fillRect(kx - 1, ky - 1, 8, 9);
      ctx.fillStyle = '#ffd98a'; ctx.fillRect(kx, ky, 6, 7);
      ctx.fillStyle = '#1b1726'; for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 4; gx++) if (E_GLYPH[gy][gx] === '1') ctx.fillRect(kx + 1 + gx * 1, ky + 1 + gy, 1, 1);
      ctx.fillStyle = '#ffd98a'; ctx.fillRect(kx + 2, ky + 8, 2, 1);
    }
  }
  ctx.globalAlpha = 1;
}
let layered = false;
export function initNearbyLayer() { if (layered) return; layered = true; addLayer(130, (ctx, v) => drawHi(ctx, v)); }
initNearbyLayer();
