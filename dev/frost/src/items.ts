// Item and equipment model for «Белая Мгла».
// Counted items (stock the hero carries), gear flags (owned / worn, they do not take a hand),
// Russian labels with plural agreement (ru.ts plural), and the add / has / take helpers.
// Pure module: imports only ru.ts, reads no game state, does nothing at import time.
// Phase 1: nothing in the game imports this yet. tools.ts inv keeps its fields until phase 2
// merges freshFields() into it (see the integration note in items_spec.md).
import { plural } from './ru';

/** Counted items. The first six already exist on tools.ts inv; the rest are the new fields of the spec and the recipe table. */
export const COUNT_IDS = [
  'logs', 'branches', 'matches', 'food', 'crackers', 'thermos',                 // existing inv fields
  'stones', 'meat', 'cooked', 'ice', 'water', 'tea', 'cord', 'pelt', 'resin',   // spec: new fields (ice: pieces picked with the pickaxe)
  'torchFuel',                                                                  // spec: minutes left in the torch in hand
  'planks', 'torches', 'traps', 'hearths',                                      // needed by the recipe table
] as const;
export type CountId = (typeof COUNT_IDS)[number];

/** Gear: owned or worn flags. None of them takes a hand. The pickaxe is a wheel tool that is owned as a flag. */
export const GEAR_IDS = ['snowshoes', 'sled', 'sleepingBag', 'kettle', 'lantern', 'pickaxe'] as const;
export type GearId = (typeof GEAR_IDS)[number];

export type ItemId = CountId | GearId;

/** Count fields that inv does not have yet. Phase 2 adds them with freshFields() (snowshoes already exists on inv). */
export const NEW_COUNT_IDS: readonly CountId[] = [
  'stones', 'meat', 'cooked', 'ice', 'water', 'tea', 'cord', 'pelt', 'resin', 'torchFuel', 'planks', 'torches', 'traps', 'hearths',
];
/** Gear fields that inv does not have yet (snowshoes already exists). */
export const NEW_GEAR_IDS: readonly GearId[] = ['sled', 'sleepingBag', 'kettle', 'lantern', 'pickaxe'];

/** Any object holding these fields (tools.ts inv satisfies it). Missing counts read as 0, missing gear as false. */
export type Pack = Partial<Record<CountId, number>> & Partial<Record<GearId, boolean>>;

/** Registry entry. Counted items carry Russian noun forms for plural(): [1 / 2-4 / 0 and 5+]. Measures (unit) print a decimal number and the unit. */
export type ItemDef =
  | { readonly kind: 'count'; readonly forms: readonly [string, string, string]; readonly unit?: string }
  | { readonly kind: 'gear'; readonly name: string };

export const ITEMS: Readonly<Record<ItemId, ItemDef>> = {
  logs: { kind: 'count', forms: ['бревно', 'бревна', 'брёвен'] },
  branches: { kind: 'count', forms: ['ветка', 'ветки', 'веток'] },
  matches: { kind: 'count', forms: ['спичка', 'спички', 'спичек'] },
  food: { kind: 'count', forms: ['банка консервов', 'банки консервов', 'банок консервов'] },
  crackers: { kind: 'count', forms: ['сухарь', 'сухаря', 'сухарей'] },
  thermos: { kind: 'count', forms: ['термос с чаем', 'термоса с чаем', 'термосов с чаем'] },
  stones: { kind: 'count', forms: ['камень', 'камня', 'камней'] },
  meat: { kind: 'count', forms: ['кусок сырого мяса', 'куска сырого мяса', 'кусков сырого мяса'] },
  cooked: { kind: 'count', forms: ['кусок жареного мяса', 'куска жареного мяса', 'кусков жареного мяса'] },
  ice: { kind: 'count', forms: ['кусок льда', 'куска льда', 'кусков льда'] },
  water: { kind: 'count', forms: ['литр воды', 'литра воды', 'литров воды'], unit: 'л' },
  tea: { kind: 'count', forms: ['порция чая', 'порции чая', 'порций чая'] },
  cord: { kind: 'count', forms: ['верёвка', 'верёвки', 'верёвок'] },
  pelt: { kind: 'count', forms: ['шкурка', 'шкурки', 'шкурок'] },
  resin: { kind: 'count', forms: ['ком смолы', 'кома смолы', 'комов смолы'] },
  torchFuel: { kind: 'count', forms: ['минута горения', 'минуты горения', 'минут горения'], unit: 'мин' },
  planks: { kind: 'count', forms: ['доска', 'доски', 'досок'] },
  torches: { kind: 'count', forms: ['факел', 'факела', 'факелов'] },
  traps: { kind: 'count', forms: ['силок', 'силка', 'силков'] },
  hearths: { kind: 'count', forms: ['очаг из камней', 'очага из камней', 'очагов из камней'] },
  snowshoes: { kind: 'gear', name: 'снегоступы' },
  sled: { kind: 'gear', name: 'санки' },
  sleepingBag: { kind: 'gear', name: 'спальник' },
  kettle: { kind: 'gear', name: 'котелок' },
  lantern: { kind: 'gear', name: 'фонарь' },
  pickaxe: { kind: 'gear', name: 'кирка' },
};

const GEAR_SET: ReadonlySet<string> = new Set<string>(GEAR_IDS);
/** True for gear flags (boolean fields), false for counted items. */
export function isGear(id: string): id is GearId { return GEAR_SET.has(id); }

type Loose = Record<string, number | boolean | undefined>;
const r6 = (x: number) => Math.round(x * 1e6) / 1e6; // keeps litres and minutes free of float drift

/** Adds n to a count, or sets a gear flag (n is ignored for gear). */
export function add(pack: Pack, id: ItemId, n = 1): void {
  const p = pack as unknown as Loose;
  if (isGear(id)) { p[id] = true; return; }
  const cur = p[id];
  p[id] = r6((typeof cur === 'number' ? cur : 0) + n);
}

/** True when the pack holds at least n of a count, or owns the gear flag. */
export function has(pack: Pack, id: ItemId, n = 1): boolean {
  const v = (pack as unknown as Loose)[id];
  if (isGear(id)) return v === true;
  return (typeof v === 'number' ? v : 0) >= n - 1e-9;
}

/** Current amount of a count (0 when missing). */
export function count(pack: Pack, id: CountId): number {
  const v = (pack as unknown as Loose)[id];
  return typeof v === 'number' ? v : 0;
}

/**
 * Removes n of a count, or clears a gear flag (a worn or broken item is dropped).
 * Returns false and changes nothing when the pack does not hold enough.
 */
export function take(pack: Pack, id: ItemId, n = 1): boolean {
  if (!has(pack, id, n)) return false;
  const p = pack as unknown as Loose;
  if (isGear(id)) p[id] = false;
  else p[id] = Math.max(0, r6(count(pack, id) - n));
  return true;
}

/** New fields with zero / false, for phase 2 to merge into inv (existing fields are not touched). */
export function freshFields(): Pack {
  const p: Record<string, number | boolean> = {};
  for (const k of NEW_COUNT_IDS) p[k] = 0;
  for (const k of NEW_GEAR_IDS) p[k] = false;
  return p as unknown as Pack;
}

/** Singular Russian name (nominative) of an item, for messages and menus. */
export function nameOf(id: ItemId): string {
  const d = ITEMS[id];
  return d.kind === 'gear' ? d.name : d.forms[0];
}

/** Decimal with a comma and no trailing zeros: 0.5 -> «0,5», 2 -> «2». */
export function fmtNum(n: number): string {
  return n.toFixed(2).replace(/\.?0+$/, '').replace('.', ',');
}

/**
 * Counted label with plural agreement: label('branches', 2) -> «2 ветки», label('branches', 11) -> «11 веток»,
 * label('water', 0.25) -> «0,25 л», label('snowshoes') -> «снегоступы».
 */
export function label(id: ItemId, n = 1): string {
  const d = ITEMS[id];
  if (d.kind === 'gear') return d.name;
  if (d.unit) return `${fmtNum(n)} ${d.unit}`;
  const k = Math.round(n);
  return `${k} ${plural(k, d.forms[0], d.forms[1], d.forms[2])}`;
}

/** Joins labels of a cost or yield map, e.g. {branches: 2, cord: 1} -> «2 ветки + 1 верёвка». Zero and false entries are skipped. */
export function joinLabels(items: Partial<Record<ItemId, number | boolean>>, sep = ' + '): string {
  const parts: string[] = [];
  for (const k of Object.keys(items) as ItemId[]) {
    const v = items[k];
    if (v === undefined || v === false || v === 0) continue;
    parts.push(label(k, v === true ? 1 : v));
  }
  return parts.join(sep);
}
