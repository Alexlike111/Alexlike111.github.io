// Usable items framework (DESIGN §17). An item becomes usable with registerUse(id, {...}):
//   use(slot, ctx)  - one action (LMB press on the belt item, «Использовать» in the bag, double click). Return false to refuse (no sound event, no hint).
//   hold(dt, ctx)   - called every frame while the LMB is held on the selected item (e.g. look through binoculars).
//   tick(dt)        - called every frame (real seconds) from stepUseItems while the player is alive, whatever is selected (items that keep working in the bag).
//   label / tip     - button caption (default «Использовать») and the first-use hint (toast + one journal line, once per item, saved).
// Food, wear and the built-in tools keep their old behaviour in tools.ts; a registered use wins only for ids that tools.ts does not handle itself.
// Every successful use emits `use_item {id, slot}` on the bus (sfxhooks / audio listen). Persistent state: useState() lives in body.stats.use (saved with the body).
import { G, toast, type Slot } from './state';
import { emit } from './bus';
import { registerSource, tr } from '../content/i18n';
import { inv } from './inventory';
import { body } from './player';
import { logJournal } from './stationkit';
import { resetMods } from './usemods';

export interface UseCtx { slot: number; stack: Slot; held: boolean }
export interface UseDef {
  use?(slot: number, ctx: UseCtx): boolean | void;
  hold?(dt: number, ctx: UseCtx): void;
  tick?(dt: number): void;
  label?: string; tip?: string;
  /** one-line state of a stack for the bag ("2 глотка, горячо") */
  note?(s: Slot): string;
  /** seconds before the next use() of the same item is accepted (default 0.35) */
  cool?: number;
}
const U: Record<string, UseDef> = {};
const sync: ((dt: number) => void)[] = [];

export function registerUse(id: string, d: UseDef) {
  U[id] = d;
  if (d.label) registerSource('useitem.label.' + id, d.label);
  if (d.tip) registerSource('useitem.tip.' + id, d.tip);
}
/** Run `fn` every frame after the per-item ticks (inventory capacity sync, glare, pools...). */
export function onUseStep(fn: (dt: number) => void) { sync.push(fn); }
export const usable = (id: string): boolean => !!(U[id]?.use || U[id]?.hold);
export const holdable = (id: string): boolean => !!U[id]?.hold;
export const useIds = (): string[] => Object.keys(U);
export function useLabel(id: string): string { return U[id]?.label ? tr('useitem.label.' + id, U[id].label!) : tr('useitem.label', 'Использовать'); }
registerSource('useitem.label', 'Использовать');
export function useNote(s: Slot): string { try { return U[s.id]?.note?.(s) ?? ''; } catch { return ''; } }
export function useTip(id: string): string { const d = U[id]; return d?.tip ? tr('useitem.tip.' + id, d.tip) : ''; }

// ---- persistent state (rides on body.stats, which save.ts already stores and restores) ----------------------------------------------
export interface UseState { hints: string[]; d: Record<string, number> }
export function useState(): UseState {
  const st = body.stats as unknown as { use?: UseState };
  if (!st.use || !Array.isArray(st.use.hints) || !st.use.d) st.use = { hints: [], d: {} };
  return st.use;
}
export function resetUseState() { (body.stats as unknown as { use?: UseState }).use = { hints: [], d: {} }; resetMods(); cool.clear(); }
/** Numeric per-feature state (hours of heat left, frost-soak seconds...). */
export const sget = (k: string, d = 0): number => useState().d[k] ?? d;
export const sset = (k: string, v: number) => { useState().d[k] = v; };

/** First-use hint: toast + one journal line, once per item id (saved). */
export function hintFor(id: string): boolean {
  const st = useState(); const tip = useTip(id);
  if (!tip || st.hints.includes(id)) return false;
  st.hints.push(id); toast(tip, 'info'); logJournal(tip); return true;
}

const cool = new Map<string, number>();
/** Fire the use action of the stack in inv slot i. Returns true if it did something. */
export function useSlot(i: number): boolean {
  const p = G.player; const s = inv.slots[i]; if (!p || !p.alive || !s) return false;
  const d = U[s.id]; if (!d?.use) return false;
  if ((cool.get(s.id) ?? 0) > 0) return false;
  const r = d.use(i, { slot: i, stack: s, held: false });
  if (r === false) return false;
  cool.set(s.id, d.cool ?? 0.35);
  hintFor(s.id);
  emit('use_item', { id: s.id, slot: i });
  return true;
}
/** LMB held on the selected belt item. */
export function holdSlot(i: number, dt: number) {
  const s = inv.slots[i]; if (!s) return;
  const d = U[s.id]; if (d?.hold) { d.hold(dt, { slot: i, stack: s, held: true }); hintFor(s.id); }
}

/** Per-frame step; called from stepTools (also while a panel is open: pools keep draining). */
export function stepUseItems(dt: number) {
  for (const [k, v] of cool) { if (v <= dt) cool.delete(k); else cool.set(k, v - dt); }
  const p = G.player; if (!p || !p.alive) return;
  resetMods();
  for (const id in U) { const t = U[id].tick; if (t) t(dt); }
  for (const f of sync) f(dt);
  void body;
}
