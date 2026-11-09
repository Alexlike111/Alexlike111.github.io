// Inventory (DESIGN §8): belt 6 (slots 0..5) + pack 18 (6..23) + clothes + weight. A sled adds 30 slots while dragged.
// Snow blocks keep their density in Slot.dur and stack by quality class. Tools have no durability: Slot.dur is only the density of a snow block,
// the burn minutes of a torch, the diesel minutes of a lantern and the water in a flask. Notes never sit in the bag: reading turns them into journal pages (lore.ts).
import { G, newId, type Slot } from './state';
import { getItem, snowClass, type WearSlot } from './items';
import { strings } from '../content/i18n';

export const BELT = 6, PACK = 18, NSLOT = BELT + PACK, SLED_SLOTS = 30;
/** DESIGN §17: a belt pouch adds 3 quick slots (cells 24..26, keys 7-9), a big pack adds 6 pack slots (cells 27..32) and +20 kg. They exist only while that item is carried. */
export const POUCH0 = NSLOT, POUCH_N = 3, BIG0 = POUCH0 + POUCH_N, BIG_N = 6, TOTAL = BIG0 + BIG_N;
export const BIG_PACK_KG = 20;
export const WEAR_SLOTS: WearSlot[] = ['head', 'body', 'hands', 'feet', 'face'];

export interface Sled { x: number; y: number; slots: (Slot | null)[]; hitched: boolean }
export const inv = {
  slots: new Array<Slot | null>(TOTAL).fill(null),
  sel: 0,
  wear: { head: null, body: null, hands: null, feet: null, face: null } as Record<WearSlot, string | null>,
  sled: null as Sled | null,
};
/** Backpacks left by dead players: drop id -> contents (not persisted by save.ts yet). */
export const backpacks = new Map<number, Slot[]>();

const listeners: (() => void)[] = [];
export function onChange(fn: () => void) { listeners.push(fn); }
let suppress = 0;
export function changed() { if (!suppress) for (const f of listeners) f(); }

function defaultDur(id: string): number | undefined {
  const d = getItem(id);
  if (d.tool && isFinite(d.tool.dur)) return d.tool.dur;
  if (id === 'flask') return 0;
  return d.dur0;
}
/** Extra cells that exist right now: the pouch / big pack must be carried (belt or pack cells, never inside the extra cells themselves). */
export function extras(): { pouch: boolean; big: boolean } {
  let pouch = false, big = false;
  for (let i = 0; i < NSLOT; i++) { const s = inv.slots[i]; if (!s) continue; if (s.id === 'belt_pouch') pouch = true; else if (s.id === 'big_pack') big = true; }
  return { pouch, big };
}
export const hasPouch = () => extras().pouch;
export const hasBigPack = () => extras().big;
/** Is cell i of inv.slots in use? */
export function slotUsable(i: number, e = extras()): boolean { return i < NSLOT || (i < BIG0 ? e.pouch : i < TOTAL && e.big); }
/** Physical cells of the belt in wheel order: the six belt cells, then the pouch cells. */
export function beltCells(): number[] { const a = [0, 1, 2, 3, 4, 5]; if (hasPouch()) for (let k = 0; k < POUCH_N; k++) a.push(POUCH0 + k); return a; }
export function isBeltCell(i: number): boolean { return i < BELT || (i >= POUCH0 && i < BIG0 && hasPouch()); }
/** Cells in use, in the order add() fills them after the six belt and eighteen pack cells. */
function* extraCells(): Generator<number> { const e = extras(); if (e.pouch) for (let i = POUCH0; i < BIG0; i++) yield i; if (e.big) for (let i = BIG0; i < TOTAL; i++) yield i; }
/** Pull things out of cells whose pouch / big pack is gone: into free base cells, else onto the ground. */
export function settleExtras() {
  const e = extras(); let moved = false;
  for (let i = POUCH0; i < TOTAL; i++) {
    if (slotUsable(i, e)) continue;
    const s = inv.slots[i]; if (!s) continue;
    inv.slots[i] = null; moved = true;
    const left = add(s.id, s.n, s.dur);
    if (left > 0 && G.player) spawnDrop(s.id, left, G.player.x, G.player.y - 10, (Math.random() - 0.5) * 20, -26, s.dur);
  }
  if (!isBeltCell(inv.sel)) { inv.sel = 0; moved = true; }
  if (moved) changed();
}
function sameStack(a: Slot, id: string, dur?: number): boolean {
  if (a.id !== id) return false;
  if (id === 'snow_block') return snowClass(a.dur ?? 300) === snowClass(dur ?? 300);
  return true;
}
/** Tools go to the belt first; so do snow blocks: a freshly cut block must be placeable at once, not after a trip into the bag panel (the builder's loop is
 *  cut - place - cut). Everything else stackable goes to the pack first and only then to the belt. */
export function beltFirst(id: string): boolean { const d = getItem(id); return d.kind === 'tool' || d.kind === 'block' || !!d.quick || (d.stack === 1 && d.kind !== 'misc'); }
/** How many belt cells an item may fill by itself: blocks and kits all six; tools five (the last cell stays free for a freshly cut block); usable odds
 *  and ends (compass, bandage, whistle…) four. The rest of the belt the player arranges by hand. */
function beltLimit(id: string): number { const d = getItem(id); if (d.kind === 'block' || d.kind === 'fixture') return BELT; return d.quick && d.kind !== 'tool' ? 4 : BELT - 1; }
function* order(id: string): Generator<number> {
  const lim = beltLimit(id);
  if (beltFirst(id)) { for (let i = 0; i < lim; i++) yield i; for (let i = BELT; i < NSLOT; i++) yield i; for (let i = lim; i < BELT; i++) yield i; }
  else { for (let i = BELT; i < NSLOT; i++) yield i; for (let i = 0; i < BELT; i++) yield i; }
  if (id !== 'belt_pouch' && id !== 'big_pack') yield* extraCells();
}

/** Add n items; returns how many did NOT fit. `dur` sets the snow-block density / torch minutes / lantern fuel / flask water. */
export function add(id: string, n: number, dur?: number, into: (Slot | null)[] = inv.slots): number {
  if (n <= 0) return 0;
  const d = getItem(id), max = d.stack;
  const nd = dur ?? defaultDur(id);
  const idxs = into === inv.slots ? [...order(id)] : into.map((_, i) => i);
  if (max > 1) {
    for (const i of idxs) {
      const s = into[i]; if (!s || !sameStack(s, id, nd)) continue;
      const room = max - s.n; if (room <= 0) continue;
      const k = Math.min(room, n); s.n += k; n -= k; if (n <= 0) break;
    }
  }
  if (n > 0) {
    for (const i of idxs) {
      if (into[i]) continue;
      const k = Math.min(max, n);
      const s: Slot = { id, n: k }; if (nd !== undefined) s.dur = nd;
      into[i] = s; n -= k; if (n <= 0) break;
    }
  }
  if (n > 0 && into === inv.slots && inv.sled?.hitched) return add(id, n, dur, inv.sled.slots);
  changed();
  return n;
}
/** Total count of an item (belt + pack, plus sled if hitched). */
export function count(id: string): number {
  let c = 0;
  for (const s of inv.slots) if (s && s.id === id) c += s.n;
  if (inv.sled?.hitched) for (const s of inv.sled.slots) if (s && s.id === id) c += s.n;
  return c;
}
export function has(id: string, n = 1) { return count(id) >= n; }
/** Remove n items (pack/belt first, then sled). Returns false (and removes nothing) if not enough. */
export function remove(id: string, n: number): boolean {
  if (count(id) < n) return false;
  const take = (arr: (Slot | null)[]) => {
    // take from the back of the pack first so belt tools/food stay put
    for (let i = arr.length - 1; i >= 0 && n > 0; i--) {
      const s = arr[i]; if (!s || s.id !== id) continue;
      const k = Math.min(s.n, n); s.n -= k; n -= k; if (s.n <= 0) arr[i] = null;
    }
  };
  take(inv.slots);
  if (n > 0 && inv.sled?.hitched) take(inv.sled.slots);
  changed();
  return true;
}
export function removeFromSlot(i: number, n = 1): Slot | null {
  const s = inv.slots[i]; if (!s) return null;
  const k = Math.min(n, s.n);
  const out: Slot = { id: s.id, n: k }; if (s.dur !== undefined) out.dur = s.dur;
  s.n -= k; if (s.n <= 0) inv.slots[i] = null;
  changed(); return out;
}
export function selected(): Slot | null { return inv.slots[inv.sel] ?? null; }
/** Select a belt cell: 0..5 are the belt keys, 6..8 the pouch keys (7-9), 24..26 the pouch cells themselves. */
export function select(i: number) {
  const k = i >= BELT && i < BELT + POUCH_N ? POUCH0 + i - BELT : i;
  if (!isBeltCell(k)) return;
  if (k !== inv.sel) { inv.sel = k; changed(); }
}
/** Mouse wheel: step along the belt (and the pouch cells), wrapping. */
export function selectStep(d: number) {
  const b = beltCells(); let j = b.indexOf(inv.sel); if (j < 0) j = 0;
  const k = b[(((j + d) % b.length) + b.length) % b.length];
  if (k !== inv.sel) { inv.sel = k; changed(); }
}
export function swap(a: number, b: number) { const t = inv.slots[a]; inv.slots[a] = inv.slots[b]; inv.slots[b] = t; changed(); }
/** First slot index holding an item satisfying pred. */
export function find(pred: (s: Slot) => boolean): number {
  for (let i = 0; i < TOTAL; i++) { const s = inv.slots[i]; if (s && pred(s)) return i; }
  return -1;
}
export function freeSlots(): number { let c = 0; for (let i = 0; i < NSLOT; i++) if (!inv.slots[i]) c++; for (const i of extraCells()) if (!inv.slots[i]) c++; return c; }

/** Carried weight in kg (sled contents count at 35 %, the dragged sled itself is free). */
export function weight(): number {
  let w = 0;
  const sum = (arr: (Slot | null)[], k: number) => { for (const s of arr) if (s) w += unitWeight(s.id, s.dur) * s.n * k; };
  sum(inv.slots, 1);
  for (const p of WEAR_SLOTS) { const id = inv.wear[p]; if (id) w += getItem(id).w * 0.6; }
  if (inv.sled?.hitched) sum(inv.sled.slots, 0.35);
  return w;
}
// DESIGN §12 (owner: 100 kg pack). Comfortable load up to 60 kg; above it: slower walk, more sweat, faster stamina drain; above 80 kg no running; at WEIGHT_MAX (100 kg) nothing more can be lifted.
export const WEIGHT_SOFT = 60;      // kg: the comfortable load, slowdown starts above
export const WEIGHT_RUN = 80;       // kg: cannot run any more
export const WEIGHT_MAX = 100;       // kg: crawling, nothing more can be picked up
/** A sack (DESIGN §17) holds one bulk material: dur = kind * 100 + n (kind 1 snow, 2 ice, 3 coal, 4 lichen), at half weight. */
export const SACK_KINDS = ['', 'snow', 'ice', 'coal', 'lichen'] as const;
export const SACK_MAX = 12;
export const sackKind = (dur?: number) => Math.floor((dur ?? 0) / 100);
export const sackN = (dur?: number) => Math.round((dur ?? 0) % 100);
export const sackDur = (kind: number, n: number) => (n > 0 ? kind * 100 + n : 0);
const LS = strings('inv', {
  l0: 'налегке', l1: 'нормально', l2: 'тяжело: медленнее, потеешь', l3: 'перегруз: не бежать, быстро выдыхаешься', l4: 'не поднять: брось что-нибудь',
});
export type LoadLevel = 0 | 1 | 2 | 3 | 4;
/** 0 light · 1 normal · 2 heavy (slower, sweat) · 3 overloaded (no running) · 4 cannot lift more. */
export function loadLevel(w = weight()): LoadLevel { const b = bonusKg(); return w >= WEIGHT_MAX + b ? 4 : w > WEIGHT_RUN + b ? 3 : w > WEIGHT_SOFT + b ? 2 : w > (WEIGHT_SOFT + b) * 0.45 ? 1 : 0; }
/** +20 kg of every limit while a big pack is carried. */
export const bonusKg = () => (hasBigPack() ? BIG_PACK_KG : 0);
export const weightMax = () => WEIGHT_MAX + bonusKg();
export const runLimit = () => WEIGHT_RUN + bonusKg();
/** The effect of the current load in words (weight bar caption). */
export function loadWords(w = weight()): string { return [LS.l0, LS.l1, LS.l2, LS.l3, LS.l4][loadLevel(w)]; }
/** Walk-speed / sweat / stamina factor 0..1 above the comfortable load (0 at WEIGHT_SOFT, 1 at WEIGHT_MAX). */
export function overload(w = weight()): number { const b = bonusKg(); return Math.max(0, Math.min(1, (w - WEIGHT_SOFT - b) / (WEIGHT_MAX - WEIGHT_SOFT))); }
/** Weight of one unit of an item (snow blocks weigh by density). */
export function unitWeight(id: string, dur?: number): number {
  if (id === 'snow_block') return (dur ?? 300) / 60;
  if (id === 'sack') { const k = sackKind(dur); return getItem('sack').w + (k > 0 ? getItem(SACK_KINDS[k]).w * sackN(dur) * 0.5 : 0); }
  return getItem(id).w;
}
/** How many of n units can still be lifted before WEIGHT_MAX. */
export function fitByWeight(id: string, n: number, dur?: number): number {
  const u = unitWeight(id, dur); if (u <= 0) return n;
  return Math.max(0, Math.min(n, Math.floor((weightMax() - weight()) / u + 1e-6)));
}
/** How many of n units fit into the belt + pack (+ hitched sled) by SLOTS only (no mutation). */
export function roomFor(id: string, n: number, dur?: number): number {
  const max = getItem(id).stack, nd = dur ?? defaultDur(id);
  let room = 0;
  const scan = (arr: (Slot | null)[], all = false) => { const e = extras(); for (let i = 0; i < arr.length; i++) { if (!all && !slotUsable(i, e)) continue; const s = arr[i]; if (!s) room += max; else if (max > 1 && sameStack(s, id, nd)) room += Math.max(0, max - s.n); } };
  scan(inv.slots); if (inv.sled?.hitched) scan(inv.sled.slots, true);
  return Math.min(n, room);
}

// ---- clothes ----
/** Wear the item in slot i (swaps with what is worn). Returns false if not wearable. */
export function equip(i: number): boolean {
  const s = inv.slots[i]; if (!s) return false;
  const w = getItem(s.id).wear; if (!w) return false;
  const old = inv.wear[w.slot];
  inv.wear[w.slot] = s.id;
  inv.slots[i] = old ? { id: old, n: 1 } : null;
  changed(); return true;
}
export function unequip(part: WearSlot): boolean {
  const id = inv.wear[part]; if (!id) return false;
  if (add(id, 1) > 0) return false;
  inv.wear[part] = null; changed(); return true;
}
export function wearing(id: string) { return WEAR_SLOTS.some(s => inv.wear[s] === id); }

// ---- sled ----
export function hitchSled(x: number, y: number) {
  if (!inv.sled) inv.sled = { x, y, slots: new Array<Slot | null>(SLED_SLOTS).fill(null), hitched: true };
  else { inv.sled.hitched = true; inv.sled.x = x; inv.sled.y = y; }
  changed();
}
/** Put the sled down where it stands: the contents stay on it (E next to it hitches it again). */
export function unhitchSled(x?: number, y?: number) { if (inv.sled) { inv.sled.hitched = false; if (x !== undefined) inv.sled.x = x; if (y !== undefined) inv.sled.y = y; } changed(); }
export function sledNear(x: number, y: number, r = 26): boolean { const s = inv.sled; return !!s && !s.hitched && Math.abs(s.x - x) < r && Math.abs(s.y - y) < r; }

// ---- lifecycle ----
export function clearInventory(keepParkedSled = false) {
  inv.slots.fill(null); inv.sel = 0;
  inv.wear.head = inv.wear.body = inv.wear.hands = inv.wear.feet = inv.wear.face = null;
  if (!(keepParkedSled && inv.sled && !inv.sled.hitched)) inv.sled = null;
  changed();
}
/** DESIGN §8 start kit. */
export function giveStartKit() {
  clearInventory();
  suppress++;
  add('snow_knife', 1); add('shovel', 1);
  inv.wear.hands = 'wool_mittens'; inv.wear.feet = 'felt_boots'; inv.wear.body = 'station_parka'; inv.wear.head = 'wool_hat';
  add('matches', 20); add('can', 2); add('tea', 1);
  suppress--; changed();
}
/** Pull everything out of the inventory (death): returns the slots. */
export function takeAll(): Slot[] {
  const out: Slot[] = [];
  for (let i = 0; i < TOTAL; i++) { const s = inv.slots[i]; if (s) { out.push(s); inv.slots[i] = null; } }
  for (const p of WEAR_SLOTS) { const id = inv.wear[p]; if (id) { out.push({ id, n: 1 }); inv.wear[p] = null; } }
  // a dragged sled goes down with its owner: its load and the sled itself end up in the backpack (a parked sled stays where it is)
  if (inv.sled?.hitched) {
    for (let i = 0; i < inv.sled.slots.length; i++) { const s = inv.sled.slots[i]; if (s) { out.push(s); inv.sled.slots[i] = null; } }
    out.push({ id: 'sled', n: 1 }); inv.sled = null;
  }
  changed(); return out;
}

// ---- world drops ----
/** Density / fuel of dropped snow blocks, torches and lanterns (Drop has no dur field). */
export const dropDur = new Map<number, number>();
export const MAX_DROPS = 240;
/** Drop an item stack into the world. Plain stacks merge with a close drop of the same item. */
export function spawnDrop(item: string, n: number, x: number, y: number, vx = 0, vy = -24, dur?: number, noMerge = false) {
  if (n <= 0) return null;
  if (dur === undefined && !noMerge && item !== 'backpack') {
    for (const d of G.drops) if (d.item === item && !dropDur.has(d.id) && Math.abs(d.x - x) < 6 && Math.abs(d.y - y) < 6 && d.n + n <= getItem(item).stack * 2) { d.n += n; return d; }
  }
  if (G.drops.length >= MAX_DROPS) {
    // never push a dead player's backpack out of the world: evict the oldest ordinary drop instead
    const k = G.drops.findIndex(d => d.item !== 'backpack');
    const old = k >= 0 ? G.drops.splice(k, 1)[0] : G.drops.shift();
    if (old) { dropDur.delete(old.id); if (old.item === 'backpack') backpacks.delete(old.id); }
  }
  const d = { id: newId(), item, n, x, y, vx, vy, age: 0 };
  G.drops.push(d);
  if (dur !== undefined) dropDur.set(d.id, dur);
  return d;
}
/** Put what does not fit on the ground at (x,y). */
export function addOrDrop(id: string, n: number, x: number, y: number, dur?: number) {
  const left = add(id, n, dur);
  if (left > 0) spawnDrop(id, left, x, y, (Math.random() - 0.5) * 20, -26, dur);
  return left;
}

/** Transient state of the held tool, shared between tools.ts (writes) and fixtures/shelter/player (read). */
export const held = { torchLit: false, lanternLit: false, load: 0 /* shovel snow, cells */, swing: 0, using: false };

// =====================================================================================================================================
// DESIGN §12 panel operations. A «Ref» points at one cell of one zone: the belt + pack (`inv`, 0..23), the four clothing slots (`wear`, index into
// WEAR_SLOTS), the sled (`sled`) or the open container (`box`, supplied by search.ts through `boxZone`). Everything below is plain logic (no DOM):
// ui/bag.ts calls it for drag & drop, tap-select + tap-place, split, merge, sort, quick-move and drop. All of it works on stacks (Slot), never on ids.
export type ZoneId = 'inv' | 'wear' | 'sled' | 'box';
export interface Ref { z: ZoneId; i: number }
/** The open container as a zone: search.ts installs an adapter while a box is open (cells = the revealed items; putting an item makes it known). */
export interface BoxAdapter { size(): number; get(i: number): Slot | null; set(i: number, s: Slot | null): void; canPut(s: Slot): boolean }
export const boxZone: { cur: BoxAdapter | null } = { cur: null };
/** Ids of drops the player threw away on purpose: they are never picked up again by walking over them (only with E). */
export const thrown = new Set<number>();
/** Thrown drops the player has walked out of the auto-pickup radius (nearby.ts autoPickable): only then may walking back pick them up. */
export const armedThrown = new Set<number>();

/** The sled can be used from the panel when it is dragged or stands next to the player. */
export function sledOpen(): boolean {
  const s = inv.sled; if (!s) return false;
  if (s.hitched) return true;
  const p = G.player; return !!p && sledNear(p.x, p.y - 4, 34);
}
export const refEq = (a: Ref | null, b: Ref | null) => !!a && !!b && a.z === b.z && a.i === b.i;
export function refSize(z: ZoneId): number { return z === 'inv' ? TOTAL : z === 'wear' ? WEAR_SLOTS.length : z === 'sled' ? (sledOpen() ? SLED_SLOTS : 0) : (boxZone.cur?.size() ?? 0); }
export function refGet(r: Ref): Slot | null {
  switch (r.z) {
    case 'inv': return inv.slots[r.i] ?? null;
    case 'sled': return sledOpen() ? inv.sled!.slots[r.i] ?? null : null;
    case 'wear': { const id = inv.wear[WEAR_SLOTS[r.i]]; return id ? { id, n: 1 } : null; }
    case 'box': return boxZone.cur?.get(r.i) ?? null;
  }
}
export function refSet(r: Ref, s: Slot | null) {
  switch (r.z) {
    case 'inv': inv.slots[r.i] = s; break;
    case 'sled': if (sledOpen()) inv.sled!.slots[r.i] = s; break;
    case 'wear': inv.wear[WEAR_SLOTS[r.i]] = s ? s.id : null; break;
    case 'box': boxZone.cur?.set(r.i, s); break;
  }
}
/** May this stack sit in that cell? (clothes only in their own slot, nothing into a sled that is not here, the box checks its capacity.) */
export function refAccepts(r: Ref, s: Slot): boolean {
  switch (r.z) {
    case 'inv': return slotUsable(r.i) && !(r.i >= NSLOT && (s.id === 'belt_pouch' || s.id === 'big_pack'));
    case 'sled': return sledOpen();
    case 'wear': return s.n === 1 && getItem(s.id).wear?.slot === WEAR_SLOTS[r.i];
    case 'box': return !!boxZone.cur && boxZone.cur.canPut(s);
  }
}
const cp = (s: Slot, n = s.n): Slot => { const o: Slot = { id: s.id, n }; if (s.dur !== undefined) o.dur = s.dur; return o; };
export const carriedZone = (z: ZoneId) => z === 'inv' || z === 'wear' || z === 'sled';

/** Move up to `want` items (default the whole stack) from one cell to another: into an empty cell, merged into a matching stack, or (whole stacks only) swapped
 *  with what is there. Pulling out of a container is capped by the load limit. Returns how many items moved (0 = refused). */
export function moveStack(from: Ref, to: Ref, want?: number): number {
  const a0 = refGet(from); const item = a0 ? cp(a0) : null;
  const k = moveRaw(from, to, want);
  if (k > 0 && item) for (const h of moveHooks) h(from, to, item, k);
  return k;
}
/** Called after every successful move (search.ts: items taken out of a container; bag UI sounds). */
export const moveHooks: ((from: Ref, to: Ref, item: Slot, n: number) => void)[] = [];
function moveRaw(from: Ref, to: Ref, want?: number): number {
  if (refEq(from, to)) return 0;
  const a = refGet(from); if (!a) return 0;
  let n = Math.min(want ?? a.n, a.n);
  if (from.z === 'box' && carriedZone(to.z)) n = Math.min(n, fitByWeight(a.id, n, a.dur));
  if (n <= 0) return 0;
  const moving = cp(a, n);
  if (!refAccepts(to, moving)) return 0;
  const b = refGet(to);
  const max = getItem(a.id).stack;
  if (!b) {
    refSet(to, moving);
    if (n === a.n) refSet(from, null); else { a.n -= n; }
    changed(); return n;
  }
  if (max > 1 && sameStack(b, a.id, a.dur)) {
    const k = Math.min(max - b.n, n); if (k <= 0) return 0;
    b.n += k;
    if (k === a.n) refSet(from, null); else a.n -= k;
    changed(); return k;
  }
  // swap whole stacks
  if (n !== a.n) return 0;
  if (!refAccepts(from, cp(b))) return 0;
  if (from.z === 'box' && carriedZone(to.z) && weight() - unitWeight(b.id, b.dur) * b.n + unitWeight(a.id, a.dur) * a.n > weightMax()) return 0;
  const bb = cp(b), aa = cp(a);
  refSet(to, aa); refSet(from, bb);
  changed(); return n;
}

/** First free cell of a zone (for inv: the pack first, then the belt). */
export function freeCell(z: ZoneId, preferBelt = false): Ref | null {
  const n = refSize(z);
  const idx = z === 'inv' ? (preferBelt ? [...Array(NSLOT).keys()] : [...Array(NSLOT - BELT).keys()].map(i => i + BELT).concat([...Array(BELT).keys()])).concat([...extraCells()]) : [...Array(n).keys()];
  for (const i of idx) if (!refGet({ z, i })) return { z, i };
  if (z === 'box') { const s = boxZone.cur; if (s && s.canPut({ id: '', n: 1 })) return { z, i: s.size() }; }
  return null;
}
/** Split a stack in two: half of it (rounded down) or a single item goes to the first free cell of the same area. Returns the new cell. */
export function splitStack(r: Ref, mode: 'half' | 'one'): Ref | null {
  const s = refGet(r); if (!s || s.n < 2 || r.z === 'wear') return null;
  const k = mode === 'half' ? Math.floor(s.n / 2) : 1;
  const dest = freeCell(r.z === 'inv' && r.i < BELT ? 'inv' : r.z); if (!dest) return null;
  return moveStack(r, dest, k) > 0 ? dest : null;
}
function mergeArr(arr: (Slot | null)[]) {
  for (let i = 0; i < arr.length; i++) {
    const a = arr[i]; if (!a) continue; const max = getItem(a.id).stack; if (max <= 1) continue;
    for (let j = i + 1; j < arr.length && a.n < max; j++) {
      const b = arr[j]; if (!b || !sameStack(a, b.id, b.dur)) continue;
      const k = Math.min(max - a.n, b.n); a.n += k; b.n -= k; if (b.n <= 0) arr[j] = null;
    }
  }
}
const KIND_ORDER: Record<string, number> = { tool: 0, wear: 1, food: 2, material: 3, block: 4, fixture: 5, misc: 6, note: 7 };
/** Merge partial stacks and order a zone's cells: `kind` = tools, clothes, food, materials … (heavier stacks first), `weight` = heaviest stack first. The belt stays as is. */
export function sortZone(z: 'inv' | 'sled', mode: 'kind' | 'weight' = 'kind') {
  const arr = z === 'inv' ? inv.slots : sledOpen() ? inv.sled!.slots : null; if (!arr) return;
  const cells = z === 'inv' ? [...Array(NSLOT - BELT).keys()].map(i => i + BELT).concat(hasBigPack() ? [...Array(BIG_N).keys()].map(i => i + BIG0) : []) : [...Array(arr.length).keys()];
  const part = cells.map(i => arr[i]); mergeArr(part);
  const items = part.filter((s): s is Slot => !!s);
  const tw = (s: Slot) => unitWeight(s.id, s.dur) * s.n;
  items.sort((p, q) => mode === 'weight' ? tw(q) - tw(p) || p.id.localeCompare(q.id) : (KIND_ORDER[getItem(p.id).kind] ?? 9) - (KIND_ORDER[getItem(q.id).kind] ?? 9) || tw(q) - tw(p) || p.id.localeCompare(q.id));
  cells.forEach((c, k) => { arr[c] = items[k] ?? null; });
  changed();
}
/** Shift+click / long-press: send a stack to the «other side». Box open: pack <-> box. Else sled near: pack <-> sled. Else belt <-> pack. Clothes: wear / take off. */
export function quickMove(r: Ref): boolean {
  const s = refGet(r); if (!s) return false;
  if (r.z === 'wear') { const d = freeCell('inv'); return !!d && moveStack(r, d) > 0; }
  if (r.z === 'box') {
    // into the pack; if the pack is full of slots but a sled stands by, onto the sled
    const dest = placeInto('inv', s); if (dest) return moveStack(r, dest, undefined) > 0;
    const d2 = sledOpen() ? placeInto('sled', s) : null; return !!d2 && moveStack(r, d2) > 0;
  }
  if (r.z === 'sled') { const dest = placeInto('inv', s); return !!dest && moveStack(r, dest) > 0; }
  // from the pack / belt
  if (boxZone.cur && boxZone.cur.canPut(s)) { const dest = placeInto('box', s); if (dest) return moveStack(r, dest) > 0; }
  const w = getItem(s.id).wear;
  if (w && !boxZone.cur) { const wi = WEAR_SLOTS.indexOf(w.slot); return moveStack(r, { z: 'wear', i: wi }) > 0; }
  if (sledOpen()) { const dest = placeInto('sled', s); if (dest) return moveStack(r, dest) > 0; }
  if (r.i < BELT) { const dest = placeInto('inv', s, false); return !!dest && moveStack(r, dest) > 0; }
  const dest = placeInto('inv', s, true); return !!dest && moveStack(r, dest) > 0;
}
/** Best target cell in a zone for a stack: a matching partial stack first, else the first free cell. `belt` = restrict inv to the belt (true) or to the pack (false). */
export function placeInto(z: ZoneId, s: Slot, belt?: boolean): Ref | null {
  const n = refSize(z), max = getItem(s.id).stack;
  const lo = z === 'inv' && belt === true ? 0 : z === 'inv' && belt === false ? BELT : 0, hi = z === 'inv' && belt === true ? BELT : z === 'inv' && belt === false ? NSLOT : n;
  const e = extras(), skip = (i: number) => z === 'inv' && !slotUsable(i, e);
  if (max > 1) for (let i = lo; i < hi; i++) { if (skip(i)) continue; const c = refGet({ z, i }); if (c && sameStack(c, s.id, s.dur) && c.n < max) return { z, i }; }
  // anywhere in the inventory (belt not asked for): the same order as add(): tools and snow blocks fill the belt first, other stacks the pack first,
  // so «Взять всё» from a chest does not fill the six belt slots with ropes and flares
  if (z === 'inv' && belt === undefined) {
    const lim = beltLimit(s.id);
    if (beltFirst(s.id)) { if (lim < BELT) { for (let i = 0; i < lim; i++) if (!skip(i) && !refGet({ z, i })) return { z, i }; const pk = placeInto('inv', s, false); if (pk) return pk; } }
    else { const pk = placeInto('inv', s, false); if (pk) return pk; }
  }
  for (let i = lo; i < hi; i++) if (!skip(i) && !refGet({ z, i })) return { z, i };
  if (z === 'box' && boxZone.cur && boxZone.cur.canPut(s)) return { z, i: n };
  return null;
}
/** Throw a stack (or `n` of it) on the ground in front of the player. Clothes come off first. Returns false if there was nothing to drop. */
export function dropRef(r: Ref, n?: number): boolean {
  const p = G.player; if (!p || r.z === 'box') return false;
  const s = refGet(r); if (!s) return false;
  const k = Math.min(n ?? s.n, s.n);
  const out = cp(s, k);
  if (r.z === 'wear') refSet(r, null); else { s.n -= k; if (s.n <= 0) refSet(r, null); }
  const d = spawnDrop(out.id, out.n, p.x + p.face * 9, p.y - 12, p.face * 42, -30, out.dur, true);
  if (d) { d.age = -1.4; thrown.add(d.id); }
  changed(); return true;
}
