// Inventory (DESIGN §8): belt 6 (slots 0..5) + pack 18 (6..23) + clothes + weight. A sled adds 30 slots while dragged.
// Snow blocks keep their density in Slot.dur and stack by quality class.
import { G, newId, type Slot } from './state';
import { getItem, snowClass, type WearSlot } from './items';

export const BELT = 6, PACK = 18, NSLOT = BELT + PACK, SLED_SLOTS = 30;
export const WEAR_SLOTS: WearSlot[] = ['head', 'body', 'hands', 'feet'];

export interface Sled { x: number; y: number; slots: (Slot | null)[]; hitched: boolean }
export const inv = {
  slots: new Array<Slot | null>(NSLOT).fill(null),
  sel: 0,
  wear: { head: null, body: null, hands: null, feet: null } as Record<WearSlot, string | null>,
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
  return undefined;
}
function sameStack(a: Slot, id: string, dur?: number): boolean {
  if (a.id !== id) return false;
  if (id === 'snow_block') return snowClass(a.dur ?? 300) === snowClass(dur ?? 300);
  return true;
}
function* order(id: string): Generator<number> {
  const tooly = getItem(id).stack === 1;
  if (tooly) { for (let i = 0; i < NSLOT; i++) yield i; }
  else { for (let i = BELT; i < NSLOT; i++) yield i; for (let i = 0; i < BELT; i++) yield i; }
}

/** Add n items; returns how many did NOT fit. `dur` sets durability / snow-block density. */
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
export function select(i: number) { const k = ((i % BELT) + BELT) % BELT; if (k !== inv.sel) { inv.sel = k; changed(); } }
export function swap(a: number, b: number) { const t = inv.slots[a]; inv.slots[a] = inv.slots[b]; inv.slots[b] = t; changed(); }
/** First slot index holding an item satisfying pred. */
export function find(pred: (s: Slot) => boolean): number {
  for (let i = 0; i < NSLOT; i++) { const s = inv.slots[i]; if (s && pred(s)) return i; }
  return -1;
}
export function freeSlots(): number { let c = 0; for (const s of inv.slots) if (!s) c++; return c; }

/** Carried weight in kg (sled contents count at 35 %, the dragged sled itself is free). */
export function weight(): number {
  let w = 0;
  const sum = (arr: (Slot | null)[], k: number) => { for (const s of arr) if (s) { const d = getItem(s.id); w += (s.id === 'snow_block' ? (s.dur ?? 300) / 60 : d.w) * s.n * k; } };
  sum(inv.slots, 1);
  for (const p of WEAR_SLOTS) { const id = inv.wear[p]; if (id) w += getItem(id).w * 0.6; }
  if (inv.sled?.hitched) sum(inv.sled.slots, 0.35);
  return w;
}
export const WEIGHT_SOFT = 28;      // kg before slowdown starts
export const WEIGHT_MAX = 70;       // kg: crawling

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
export function wearing(id: string) { return inv.wear.head === id || inv.wear.body === id || inv.wear.hands === id || inv.wear.feet === id; }

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
  inv.wear.head = inv.wear.body = inv.wear.hands = inv.wear.feet = null;
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
  for (let i = 0; i < NSLOT; i++) { const s = inv.slots[i]; if (s) { out.push(s); inv.slots[i] = null; } }
  for (const p of WEAR_SLOTS) { const id = inv.wear[p]; if (id) { out.push({ id, n: 1 }); inv.wear[p] = null; } }
  // a dragged sled goes down with its owner: its load and the sled itself end up in the backpack (a parked sled stays where it is)
  if (inv.sled?.hitched) {
    for (let i = 0; i < inv.sled.slots.length; i++) { const s = inv.sled.slots[i]; if (s) { out.push(s); inv.sled.slots[i] = null; } }
    out.push({ id: 'sled', n: 1 }); inv.sled = null;
  }
  changed(); return out;
}

// ---- world drops ----
/** Durability / density of dropped tools and snow blocks (Drop has no dur field). */
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
