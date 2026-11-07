// Container search (DESIGN §12): chests, shelves, cairns, carts, ship holds and the backpack of a death are SEARCHED, not emptied at once.
// Opening one shows «Обыскиваю…» with a progress bar; the items appear one by one (0.6–1.5 s each, bigger containers longer), the rest stays unknown
// («… ещё что-то на дне») until it has been found. Outside in the cold the search is fine work with bare hands (the hands cool); a frozen lid must first be
// chipped free with the ice chisel / axe / pick. What has been found is remembered per container (and saved); things the player puts in are known at once.
// The zone logic (move / split / merge) lives in inventory.ts; this file supplies the open container as a zone (`boxZone`) and runs the timer.
//
// Container state is kept OUTSIDE the Slot objects: key «f<fixture id>» / «b<drop id>» -> { rev: number of items found (a prefix of the item list), thawed }.
import { G, toast, type Fixture, type Slot } from './state';
import { emit } from './bus';
import { strings, fmt } from '../content/i18n';
import { TS } from '../engine/grid';
import { MAT } from '../content/materials';
import { inv, backpacks, boxZone, moveHooks, find, fitByWeight, placeInto, moveStack, refGet, carriedZone, changed, type BoxAdapter, type Ref } from './inventory';
import { getItem, itemName } from './items';
import { handsFactor, handsFrozen } from './player';
import { worldInfo } from './worldgen';
import { FIXTURE_DEFS } from './fixtures';

const S = strings('search', {
  searching: 'Обыскиваю…', more: '… ещё что-то на дне', done: 'Обыскано', empty: 'Пусто', frozen: 'Крышка вмёрзла: нужна пешня, кирка или топор',
  chipping: 'Скалываю лёд…', thawed: 'Лёд сколот', coldHands: 'Пальцы не слушаются: сначала погрей руки', tooFar: 'Ты отошёл', heavy: 'Не поднять: слишком тяжело',
  full: 'В сумке нет места', put: 'Положил: {name}', backpack: 'Ты вернул свои вещи', packName: 'Твой рюкзак', boxFull: 'Тут больше не поместится',
  chest: 'Сундук', shelf: 'Полка', cairn: 'Тур', cart: 'Вагонетка', cache: 'Тайник', hold: 'Ящик из трюма', bare: 'Голые руки: мёрзнут',
});
const TITLE: Record<string, () => string> = { chest: () => S.chest, shelf: () => S.shelf, cairn: () => S.cairn, cart: () => S.cart, cache: () => S.cache };

export const REACH_BOX = 44;       // cells: the container closes when the player walks further away
interface Rec { rev: number; thawed: boolean }
const state = new Map<string, Rec>();
const rec = (key: string): Rec => { let r = state.get(key); if (!r) state.set(key, (r = { rev: 0, thawed: false })); return r; };

export interface Box {
  key: string; kind: string; title: string; f?: Fixture; dropId?: number; x: number; y: number;
  cap: number;                 // slots (stacks) the container holds
  mul: number;                 // search time multiplier
  known: boolean;              // the player's own stash: everything is known, no search
  items(): Slot[];
}
export const open = { box: null as Box | null, t: 0, need: 0, chip: 0, chipNeed: 0, lastFound: '' as string, bareT: 0, coldMsg: 0 };
/** bag.ts installs a probe telling whether the panel is on screen: the container closes together with the panel. */
export const panel = { visible: (() => true) as () => boolean, graceT: 0 };

// ---- helpers -------------------------------------------------------------------------------------------------------------------
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h ^ (h >>> 15)) >>> 0) / 4294967296; };
const itemsOf = (b: Box) => b.items();
export function revOf(b: Box): number { const it = itemsOf(b); if (b.known) return it.length; const r = rec(b.key); if (r.rev > it.length) r.rev = it.length; return r.rev; }
const setRev = (b: Box, v: number) => { if (!b.known) rec(b.key).rev = Math.max(0, Math.min(itemsOf(b).length, v)); };
/** Seconds to find the item at `idx` of a container: 0.6–1.5 s, scaled by the kind of container and how many things lie in it. */
export function itemTime(b: Box, idx: number): number {
  const it = itemsOf(b), s = it[idx];
  const u = hash(b.key + '|' + idx + '|' + (s ? s.id : ''));
  return (0.6 + 0.9 * u) * b.mul * (1 + 0.05 * Math.max(0, Math.min(8, it.length - 4)));
}
/** A world container is frozen shut when it says so (data.frozen) or sits in the ship's hold / the ice cave / the ice lake hut. */
export function isFrozen(f: Fixture): boolean {
  const r = rec('f' + f.id); if (r.thawed) return false;
  const d = f.data ?? {};
  if (d.frozen === false) return false;
  if (d.frozen === true) return true;
  if (f.kind !== 'chest') return false;
  const info = worldInfo.chests.find(c => c.id === f.id);
  return !!info && ((info.site === 'ship' && d.look === 'tool') || info.site === 'icecave' || info.site === 'icelake');
}
const chipTool = (): { id: string; secs: number } | null => {
  for (const [id, secs] of [['ice_chisel', 3], ['pick', 4], ['axe', 4.5]] as const) if (find(s => s.id === id) >= 0 || (inv.sled?.hitched && inv.sled.slots.some(s => s?.id === id))) return { id, secs };
  return null;
};
const centre = (f: Fixture): [number, number] => [f.tx * TS + f.tw * 2, f.ty * TS + f.th * 2];
function capOf(f: Fixture): number { return Number(f.data?.cap) || FIXTURE_DEFS[f.kind]?.storage || (f.kind === 'cart' ? 6 : 12); }

export function makeBox(f: Fixture): Box {
  const [x, y] = centre(f);
  if (f.kind === 'cart') {            // the cart's cargo (data.loaded, 4 units) becomes ordinary contents the first time it is opened
    const dd = f.data ?? (f.data = {});
    if (!f.items) f.items = [];
    if (dd.loaded) { f.items.push({ id: String(dd.loaded), n: 4 }); dd.loaded = ''; }
  }
  const known = f.kind === 'cache' || f.data?.known === true;
  const info = worldInfo.chests.find(c => c.id === f.id);
  const hold = info?.site === 'ship' && f.data?.look === 'tool';
  const mul = known ? 0 : f.kind === 'shelf' ? 0.85 : f.kind === 'cart' ? 0.9 : hold ? 1.35 : 1;
  return { key: 'f' + f.id, kind: f.kind, title: hold ? S.hold : (TITLE[f.kind]?.() ?? S.chest), f, x, y, cap: capOf(f), mul, known, items: () => f.items ?? (f.items = []) };
}
export function makePackBox(dropId: number): Box | null {
  const d = G.drops.find(q => q.id === dropId); if (!d || !backpacks.has(dropId)) return null;
  return { key: 'b' + dropId, kind: 'backpack', title: S.packName, dropId, x: d.x, y: d.y, cap: 99, mul: 0.35, known: false, items: () => backpacks.get(dropId) ?? [] };
}

// ---- the open container as a zone ----------------------------------------------------------------------------------------------
function adapter(b: Box): BoxAdapter {
  return {
    size: () => revOf(b),
    get: (i) => (i >= 0 && i < revOf(b) ? itemsOf(b)[i] ?? null : null),
    set: (i, s) => {
      const it = itemsOf(b); let rev = revOf(b);
      if (i < rev) { if (s) it[i] = s; else { it.splice(i, 1); rev--; } }
      else if (s) { it.splice(rev, 0, s); rev++; }
      setRev(b, rev);
      if (b.f && b.kind === 'cart') (b.f.data ??= {}).loaded = '';
    },
    canPut: (s) => {
      if (isLocked()) return false;
      const it = itemsOf(b), max = getItem(s.id).stack;
      if (s.id && max > 1 && it.some((q, k) => k < revOf(b) && q.id === s.id && q.n < max && q.dur === s.dur)) return true;
      return it.length < b.cap;
    },
  };
}
export function isLocked(): boolean { return !!open.box && !!open.box.f && open.chipNeed > 0 && open.chip < open.chipNeed; }
export function isOpen(): boolean { return !!open.box; }
export function hiddenCount(b: Box | null = open.box): number { return b ? Math.max(0, itemsOf(b).length - revOf(b)) : 0; }

export type OpenResult = 'opened' | 'closed' | 'frozen' | 'far' | 'none';
function begin(b: Box): OpenResult {
  open.box = b; open.t = 0; open.chip = open.chipNeed = 0; open.bareT = 0; open.lastFound = ''; open.coldMsg = 0;
  boxZone.cur = adapter(b);
  panel.graceT = 0.6;
  if (b.f && isFrozen(b.f)) {
    const tool = chipTool();
    if (!tool) { toast(S.frozen, 'warn'); open.box = null; boxZone.cur = null; return 'frozen'; }
    open.chipNeed = tool.secs; open.chip = 0;
  }
  emit('box_open', { key: b.key, kind: b.kind });
  nextNeed();
  return 'opened';
}
/** E on a container fixture: open its panel and start searching. Pressing E at the same one again closes it. */
export function openContainer(f: Fixture): boolean {
  if (open.box && open.box.key === 'f' + f.id) { closeBox(); return true; }
  if (open.box) closeBox();
  begin(makeBox(f)); return true;
}
export function openPack(dropId: number): boolean {
  if (open.box && open.box.key === 'b' + dropId) { closeBox(); return true; }
  const b = makePackBox(dropId); if (!b) return false;
  if (open.box) closeBox();
  begin(b); return true;
}
export function closeBox() {
  if (!open.box) return;
  const b = open.box; open.box = null; boxZone.cur = null; open.t = open.chip = open.chipNeed = 0;
  emit('box_close', { key: b.key });
  changed();
}
function nextNeed() { const b = open.box; open.need = b && revOf(b) < itemsOf(b).length ? itemTime(b, revOf(b)) : 0; }

/** Searching state for the UI: 'chip' (freeing a frozen lid), 'search', 'done'. */
export function phase(): 'none' | 'chip' | 'search' | 'done' {
  const b = open.box; if (!b) return 'none';
  if (isLocked()) return 'chip';
  return hiddenCount(b) > 0 ? 'search' : 'done';
}
export function searchProgress(): number { const p = phase(); return p === 'chip' ? open.chip / Math.max(0.01, open.chipNeed) : p === 'search' ? Math.min(1, open.t / Math.max(0.01, open.need)) : 1; }

const outdoors = () => { const p = G.player; return G.ambientT < -6 && (!p || p.shelter < 0.5) && !(G.shelter?.closed); };
/** True when searching right now would make the player take the mittens off (cold, open air). */
export function barehanded(): boolean { return outdoors() && !!open.box && !open.box.known; }

/** One fixed step. Runs the timers, closes the box when the player leaves, the panel is closed or the player dies. */
export function stepSearch(dt: number) {
  const b = open.box; if (!b) return;
  const p = G.player;
  if (!p || !p.alive) { closeBox(); return; }
  // a pack that was picked up elsewhere / a fixture that was removed
  if ((b.f && !G.fixtures.includes(b.f)) || (b.dropId !== undefined && !backpacks.has(b.dropId))) { closeBox(); return; }
  if (b.dropId !== undefined) { const d = G.drops.find(q => q.id === b.dropId); if (d) { b.x = d.x; b.y = d.y; } }
  if (panel.graceT > 0) panel.graceT -= dt;
  else if (!panel.visible()) { closeBox(); return; }
  if (Math.abs(p.x - b.x) > REACH_BOX || Math.abs(p.y - 8 - b.y) > REACH_BOX * 0.8) { toast(S.tooFar, 'info'); closeBox(); return; }
  // freeing a frozen lid
  if (isLocked()) {
    if (handsFrozen()) { if (G.frame - open.coldMsg > 180) { open.coldMsg = G.frame; toast(S.coldHands, 'warn'); } return; }
    open.chip += dt * handsFactor();
    if (Math.floor(open.chip * 2.5) !== Math.floor((open.chip - dt) * 2.5)) emit('dig', { mat: MAT.ICE, x: b.x, y: b.y });
    if (open.chip >= open.chipNeed && b.f) { rec(b.key).thawed = true; open.chip = open.chipNeed = 0; toast(S.thawed, 'good'); nextNeed(); }
    return;
  }
  const hid = hiddenCount(b);
  if (hid <= 0) return;
  if (handsFrozen() && !b.known) { if (G.frame - open.coldMsg > 180) { open.coldMsg = G.frame; toast(S.coldHands, 'warn'); } return; }
  if (barehanded()) { open.bareT -= dt; if (open.bareT <= 0) { open.bareT = 0.5; emit('fine_work', { t: 1.2 }); } }
  open.t += dt * handsFactor();
  if (open.t >= open.need) {
    open.t -= open.need;
    const rev = revOf(b); setRev(b, rev + 1);
    const s = itemsOf(b)[rev]; open.lastFound = s ? s.id : '';
    emit('search_found', { id: open.lastFound, key: b.key });
    nextNeed();
    if (hiddenCount(b) === 0) emit('search_done', { key: b.key });
  }
}

// ---- taking and putting ----------------------------------------------------------------------------------------------------------
/** Take everything found so far (what fits by slots and by weight). Returns the number of stacks moved. */
export function takeAllFound(): number {
  const b = open.box; if (!b || isLocked()) return 0;
  let moved = 0, blocked: 'full' | 'heavy' | '' = '';
  for (let i = revOf(b) - 1; i >= 0; i--) {
    const s = itemsOf(b)[i]; if (!s) continue;
    const dest = placeInto('inv', s) ?? (inv.sled?.hitched ? placeInto('sled', s) : null);
    if (!dest) { blocked = 'full'; continue; }
    const k = moveStack({ z: 'box', i }, dest);
    if (k > 0) moved++; else if (fitByWeight(s.id, 1, s.dur) <= 0) blocked = 'heavy'; else blocked = blocked || 'full';
  }
  if (blocked && moved === 0) toast(blocked === 'heavy' ? S.heavy : S.full, 'warn');
  else if (blocked) toast(blocked === 'heavy' ? S.heavy : S.full, 'info');
  return moved;
}
/** Reaction to anything leaving a container for the carried zones (notes become journal pages, 'picked' for the knowledge system, an emptied pack vanishes). */
moveHooks.push((from: Ref, to: Ref, item: Slot, n: number) => {
  if (from.z !== 'box' || !carriedZone(to.z)) return;
  emit('picked', { item: item.id, n });
  if (/^note/.test(item.id)) emit('note_found', { id: item.id });
  const b = open.box;
  if (b && b.dropId !== undefined && itemsOf(b).length === 0) {
    const i = G.drops.findIndex(d => d.id === b.dropId); if (i >= 0) G.drops.splice(i, 1);
    backpacks.delete(b.dropId); toast(S.backpack, 'good'); emit('respawn_pack', {}); closeBox();
  }
});
/** G on a storage fixture: put the selected stack in. Known at once. Returns false if it does not fit. */
export function stashSelected(f: Fixture): boolean {
  const sel = inv.slots[inv.sel]; if (!sel) return false;
  const b = open.box && open.box.f === f ? open.box : makeBox(f);
  const it = itemsOf(b), max = getItem(sel.id).stack;
  const rev = revOf(b);
  const ex = max > 1 ? it.findIndex((q, k) => k < rev && q.id === sel.id && q.dur === sel.dur && q.n + sel.n <= max) : -1;
  if (ex < 0 && it.length >= b.cap) { toast(S.boxFull, 'warn'); return true; }
  if (ex >= 0) it[ex].n += sel.n; else { it.splice(rev, 0, { ...sel }); setRev(b, rev + 1); }
  inv.slots[inv.sel] = null; changed();
  toast(fmt(S.put, { name: itemName(sel.id) }), 'info');
  return true;
}
export function foundList(): string { const b = open.box; return b ? itemsOf(b).slice(0, revOf(b)).map(s => itemName(s.id)).join(', ') : ''; }
export { refGet };

// ---- save / lifecycle ---------------------------------------------------------------------------------------------------------------
export function searchSave(): [string, number, number][] { return [...state].map(([k, r]) => [k, r.rev, r.thawed ? 1 : 0]); }
export function searchLoad(d: [string, number, number][] | undefined) {
  state.clear(); closeBox();
  for (const [k, rev, th] of d ?? []) state.set(k, { rev, thawed: !!th });
}
export function resetSearch() { state.clear(); open.box = null; boxZone.cur = null; open.t = open.chip = open.chipNeed = 0; }
/** Test helper: how many items of a container have been found. */
export function foundCount(key: string): number { return state.get(key)?.rev ?? 0; }
export function boxStateOf(key: string): Rec { return rec(key); }
