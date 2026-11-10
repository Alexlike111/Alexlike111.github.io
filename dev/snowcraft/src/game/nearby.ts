// Nearby things (DESIGN §12): lying drops (dropped items, coal sacks, driftwood pieces, notes), containers, a parked sled and a dead player's backpack
// that are within reach are highlighted in the world. RMB (E too) takes the NEAREST one in front of the player; when several are near, a «Рядом» list (E held, or the
// phone button) lets you choose. Small light things are picked up by walking over them, but only if the pack has room and the weight allows; heavy things
// (logs, sacks, blocks, tools, clothes, a backpack) never auto-pick: they need RMB.
// Playtest ONB-2 / F1: a loose item right at the feet (PICK_R) wins over a door; the item under the cursor (AIM_R) wins over a nearer one; a note wins a tie.
import { G, toast, type Drop, type Fixture } from './state';
import { emit } from './bus';
import { strings, fmt } from '../content/i18n';
import { TS } from '../engine/grid';
import { addLayer } from '../engine/render';
import { inv, add, dropDur, backpacks, weight, unitWeight, fitByWeight, roomFor, thrown, armedThrown, hitchSled, sledNear, runLimit } from './inventory';
import { getItem, itemName } from './items';
import { FIXTURE_DEFS } from './fixtures';
import { openContainer, openPack, boxTitle } from './search';

const S = strings('near', {
  heavy: 'Не поднять: слишком тяжело', full: 'В сумке нет места', sled: 'Нарты', pack: 'Твой рюкзак', sledUp: 'Запрягся в нарты',
});
export type NearKind = 'drop' | 'pack' | 'box' | 'sled';
export interface Near { kind: NearKind; id: number; x: number; y: number; dist: number; rank?: number; label: string; item?: string; n?: number; w: number; heavy: boolean; f?: Fixture }
export const REACH_NEAR = 26;           // cells: how far E reaches
/** Pick-up radius of the E key for loose items, in cells (≈1.5 tiles): such an item wins over a door or a fixture. */
export const PICK_R = 10;
/** Notes (записки) are picked up from this far, with or without E. */
export const NOTE_R = 6;
/** The cursor counts as 'on' an item within this many cells of it (independent of the reach). */
export const AIM_R = 5;
/** Where the player aims in the world (tools.ts sets it each frame); an item under it is chosen first by E. */
export const aim = { x: 0, y: 0, on: false };
export const isNote = (item: string) => /^note/.test(item);
/** Items that may be picked up from the ground (a dead player's backpack goes through its own path). */
export const pickable = (d: Drop) => d.item !== 'backpack';
/** Auto-pickup box around the player (cells, TERRARIA_CONTROLS): horizontal and vertical half-size. Nothing outside it is pulled in. */
export const AUTO_DX = 10, AUTO_DY = 14;
/** Seconds a dropped item lies before it can be picked up (it is still falling before that); a thrown one waits 1.4 s (dropRef / dropAction set age -1.4). */
export const AUTO_DELAY = 0.6;

const BOXES = new Set(['chest', 'shelf', 'cache', 'cairn', 'cart']);
export const isBoxFixture = (f: Fixture) => BOXES.has(f.kind) || !!FIXTURE_DEFS[f.kind]?.storage;

/** Heavy things (a log, a sack, a block, a tool, a full stack): they auto-pick too, but not while the pack is over WEIGHT_RUN. */
export const isHeavy = (d: Drop) => { const u = unitWeight(d.item, dropDur.get(d.id)); return u > 0.9 || u * d.n > 2 || getItem(d.item).kind === 'tool'; };
/**
 * May this loose drop be taken without E (TERRARIA_CONTROLS, tools.ts stepDrops calls it for drops inside the auto box)? Kind, delay, the
 * thrown rule and the slots. Not checked here: the weight (see autoWeightOk), the hunt drops the husky fetches (tools.ts), the box itself.
 * Fixtures (a kit to place), backpacks and sleds are never auto-picked: they need E or the panel.
 */
export function autoPickable(d: Drop): boolean {
  const it = getItem(d.item);
  if (d.item === 'backpack' || d.item === 'sled' || it.kind === 'fixture') return false;
  const dur = dropDur.get(d.id);
  if (d.age < AUTO_DELAY && !thrown.has(d.id)) return false;
  if (thrown.has(d.id) && (d.age < 0 || !armedThrown.has(d.id))) return false;
  return roomFor(d.item, d.n, dur) >= d.n;
}
/** The weight rule of the auto-pickup: the whole drop must fit under WEIGHT_MAX (+ bonus); heavy things need the pack under WEIGHT_RUN. */
export function autoWeightOk(d: Drop): 'ok' | 'heavy' | 'weight' {
  if (isHeavy(d) && weight() > runLimit()) return 'heavy';
  return fitByWeight(d.item, d.n, dropDur.get(d.id)) >= d.n ? 'ok' : 'weight';
}

/** Everything in reach, nearest first (things behind the player count as a bit further). */
export function nearbyList(): Near[] {
  const p = G.player; if (!p || !p.alive) return [];
  const px = p.x, py = p.y - 8, out: Near[] = [];
  const score = (x: number, y: number) => { const dx = x - px, dy = y - py; return Math.hypot(dx, dy) + (dx * p.face < -4 ? 7 : 0); };
  for (const d of G.drops) {
    if (d.age < 0) continue;
    const dx = d.x - px, dy = d.y - py; if (Math.abs(dx) > REACH_NEAR || Math.abs(dy) > REACH_NEAR * 0.85) continue;
    if (d.item === 'backpack') { if (backpacks.has(d.id)) out.push({ kind: 'pack', id: d.id, x: d.x, y: d.y, dist: score(d.x, d.y), label: S.pack, item: 'backpack', n: 1, w: 0, heavy: false }); continue; }
    const dist = score(d.x, d.y);
    // the item the cursor is on beats a nearer one that is not aimed at; a note beats a plain item at a tie
    const rank = dist + (aim.on && Math.hypot(d.x - aim.x, d.y - aim.y) <= AIM_R ? -100 : 0) - (isNote(d.item) ? 1 : 0);
    out.push({ kind: 'drop', id: d.id, x: d.x, y: d.y, dist, rank, label: itemName(d.item) + (d.n > 1 ? ' ×' + d.n : ''), item: d.item, n: d.n, w: unitWeight(d.item, dropDur.get(d.id)) * d.n, heavy: isHeavy(d) });
  }
  for (const f of G.fixtures) {
    if (!isBoxFixture(f)) continue;
    const x = f.tx * TS + f.tw * 2, y = f.ty * TS + f.th * 2;
    if (Math.abs(x - px) > REACH_NEAR + f.tw * 2 || Math.abs(y - py) > REACH_NEAR + f.th * 2) continue;
    out.push({ kind: 'box', id: f.id, x, y, dist: score(x, y) + 3, label: fixtureTitle(f), w: 0, heavy: false, f });
  }
  const s = inv.sled;
  if (s && !s.hitched && sledNear(p.x, p.y - 4, REACH_NEAR)) out.push({ kind: 'sled', id: -1, x: s.x, y: s.y, dist: score(s.x, s.y) + 4, label: S.sled, w: 0, heavy: false });
  out.sort((a, b) => (a.rank ?? a.dist) - (b.rank ?? b.dist));
  return out;
}
const fixtureTitle = (f: Fixture) => boxTitle(f.kind);

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
  emit('pickup_float', { x: d.x, y: d.y - 4, id: d.item, n: got });       // the «+2 Уголь» text (ui/floater.ts) replaces the old «Взял» toast
  if (/^note/.test(d.item) && d.n <= 0) emit('note_found', { id: d.item });
  if (d.n <= 0) { dropDur.delete(d.id); thrown.delete(d.id); armedThrown.delete(d.id); const i = G.drops.indexOf(d); if (i >= 0) G.drops.splice(i, 1); }
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
// The interact marker over the best target (TERRARIA_CONTROLS): on desktop a mouse 7×9 px with the right button filled (RMB interacts);
// on touch a plain yellow dot (there is no right button, the «Взять» / «Действие» buttons do the work).
const MOUSE: string[] = [
  '.#####.',
  '#..#FF#',
  '#..#FF#',
  '#######',
  '#.....#',
  '#.....#',
  '#.....#',
  '#.....#',
  '.#####.',
];
const DOT: string[] = [
  '.###.',
  '#####',
  '#####',
  '#####',
  '.###.',
];
const MARK_INK = '#1b1726', MARK_LIGHT = '#eaf6ff', MARK_ACC = '#ffd98a';
/** Draws a pixel glyph from char rows (`#` light, `F` accent, `.` transparent); the cells are one canvas pixel each. */
function drawGlyph(ctx: CanvasRenderingContext2D, rows: string[], x: number, y: number) {
  for (let gy = 0; gy < rows.length; gy++) for (let gx = 0; gx < rows[gy].length; gx++) {
    const c = rows[gy][gx]; if (c === '.') continue;
    ctx.fillStyle = c === 'F' ? MARK_ACC : c === '#' ? MARK_LIGHT : MARK_INK;
    ctx.fillRect(x + gx, y + gy, 1, 1);
  }
}
function drawHi(ctx: CanvasRenderingContext2D, v: { x0: number; y0: number; t: number }) {
  if (!hi.list.length || !G.player?.alive) return;
  const t = v.t, touch = G.mobile || document.body.classList.contains('touch-ui');
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
      const bob = Math.round(Math.sin(t * 4) * 1.2);
      ctx.globalAlpha = 1;
      if (touch) {                                     // a plain hand dot: a 5×5 yellow dot on a dark edge, a pointer below
        const dx = x - 2, dy = top - 7 + bob;
        ctx.fillStyle = MARK_INK; ctx.fillRect(dx - 1, dy - 1, 7, 7);
        drawGlyph(ctx, DOT, dx, dy);
        ctx.fillStyle = MARK_INK; ctx.fillRect(x, dy + 6, 1, 1);
      } else {                                         // the mouse: a dark plate (9×11), the glyph, a pointer below
        const kx = x - 3, ky = top - 10 + bob;
        ctx.fillStyle = MARK_INK; ctx.fillRect(kx - 1, ky - 1, 9, 11);
        drawGlyph(ctx, MOUSE, kx, ky);
        ctx.fillStyle = MARK_ACC; ctx.fillRect(kx + 3, ky + 10, 1, 1);
      }
    }
  }
  ctx.globalAlpha = 1;
}
let layered = false;
export function initNearbyLayer() { if (layered) return; layered = true; addLayer(130, (ctx, v) => drawHi(ctx, v)); }
initNearbyLayer();

/**
 * The loose item the player means (pure helper, used by the self-tests): the one nearest to the aim point if the aim is within AIM_R of it,
 * otherwise the nearest one to the player (point `px,py`) within `r`. Notes win a tie.
 */
export function nearestDrop(drops: Drop[], px: number, py: number, r: number, aimX?: number, aimY?: number): Drop | null {
  let best: Drop | null = null, bestScore = Infinity;
  for (const d of drops) {
    if (!pickable(d)) continue;
    const dp = Math.hypot(d.x - px, d.y - py);
    const da = aimX === undefined || aimY === undefined ? Infinity : Math.hypot(d.x - aimX, d.y - aimY);
    // an item the cursor is on counts a little farther (4 cells) than the reach: the player is looking at it
    if (dp > r && !(da <= AIM_R && dp <= r + 4)) continue;
    const score = (da <= AIM_R ? 0 : 100) + dp - (isNote(d.item) ? 1 : 0);
    if (score < bestScore) { bestScore = score; best = d; }
  }
  return best;
}
