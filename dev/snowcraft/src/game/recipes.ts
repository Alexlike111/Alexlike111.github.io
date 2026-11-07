// Recipes (DESIGN §8) are TECHNIQUES: crafting needs `knows(rec.tech)` (lore.ts: five known at the start, the rest learned from notes or experience).
// Places (no "workbench" grammar): «где угодно», «у стола на станции» (within 5 tiles of a table), «у огня» (a burning fire), a drum, a fallen antenna mast.
// 'fine' = «тонкая работа (руки мёрзнут)»: hands are bare while working (player.ts cools them via the 'fine_work' event).
import { strings, fmt } from '../content/i18n';
import { G } from './state';
import { emit } from './bus';
import { add, count, remove, spawnDrop } from './inventory';
import { itemName } from './items';
import { raiseMast } from './fixtures';
import { knows, unknownTechText } from './lore';

export interface Ing { id: string; n: number }
export type Station = 'none' | 'table' | 'fire' | 'drum' | 'antenna';
export type RecipeGroup = 'fire' | 'food' | 'wear' | 'hunt' | 'build';
export interface Recipe {
  key: string; result: string; n: number; variants: Ing[][]; station: Station; fine: boolean; group: RecipeGroup; tech: string; note?: string;
}
export type Stations = Partial<Record<Station, boolean>>;

const S = strings('recipes', {
  noStation: 'нужно: {st}',
  stTable: 'стол на станции', stFire: 'огонь рядом', stDrum: 'бочка', stAntenna: 'упавшая мачта',
  placeAny: 'где угодно', placeTable: 'у стола на станции', placeFire: 'у огня', placeDrum: 'у бочки', placeAntenna: 'у упавшей мачты',
  fineWork: 'тонкая работа (руки мёрзнут)',
  missing: 'не хватает: {list}',
  handsFrozen: 'руки не слушаются: обморожены',
  crafted: 'Готово: {name}',
  noSpace: 'Сумка полна: {name} упал на землю',
});

const R: Recipe[] = [];
function r(result: string, n: number, variants: Ing[] | Ing[][], station: Station, group: RecipeGroup, tech: string, fine = false, key?: string) {
  const vs = (Array.isArray(variants[0]) ? variants : [variants]) as Ing[][];
  R.push({ key: key ?? result, result, n, variants: vs, station, fine, group, tech });
}
const i = (id: string, n = 1): Ing => ({ id, n });

// fire
r('campfire', 1, [i('log', 2), i('lichen')], 'none', 'fire', 'campfire');
r('fat_lamp', 1, [i('soapstone'), i('fat'), i('lichen')], 'table', 'fire', 'lamp', true, 'fat_lamp_stone');
r('fat_lamp', 1, [i('tin'), i('canvas'), i('fat')], 'table', 'fire', 'lamp', true, 'fat_lamp_tin');
r('torch', 2, [[i('log'), i('fat'), i('canvas')], [i('log'), i('diesel'), i('canvas')]], 'none', 'fire', 'torch');
r('pot', 1, [i('tin', 2)], 'table', 'fire', 'pot');
r('hand_warmer', 1, [i('tin', 2)], 'table', 'fire', 'pot', true);
// food & water
r('cooked_meat', 1, [[i('seal_meat')], [i('ptarmigan')]], 'fire', 'food', 'cooking', false, 'cooked_meat');
r('fish_cooked', 1, [i('fish')], 'fire', 'food', 'cooking');
r('hot_tea', 1, [i('tea'), i('water')], 'fire', 'food', 'cooking');
// hunting & tools
r('harpoon', 1, [i('bone'), i('log'), i('rope'), i('scrap')], 'table', 'hunt', 'harpoon');
r('ice_chisel', 1, [i('scrap', 2), i('log')], 'table', 'hunt', 'ice_chisel');
r('probe_pole', 1, [i('log'), i('rope')], 'none', 'hunt', 'ice_chisel');          // DESIGN §17: the ice probe, fast to make
r('fishing_line', 1, [i('bone'), i('sinew')], 'none', 'hunt', 'fishing', true);
r('snare', 2, [i('rope'), i('log')], 'none', 'hunt', 'snares', true);
r('rope', 2, [[i('canvas')], [i('sinew', 2)]], 'none', 'hunt', 'rope', true);
r('sinew', 2, [i('seal_meat')], 'none', 'hunt', 'butchery');
// clothes
r('fur_mittens', 1, [[i('fox_fur')], [i('sealskin'), i('sinew')]], 'table', 'wear', 'sewing', true);
r('kamiks', 1, [i('sealskin', 2), i('sinew')], 'table', 'wear', 'sewing', true);
r('fur_hood', 1, [i('fox_fur', 2), i('sinew')], 'table', 'wear', 'sewing', true);
r('fur_parka', 1, [[i('sealskin', 3), i('fox_fur', 2), i('sinew', 2)], [i('bear_fur'), i('sinew', 2)]], 'table', 'wear', 'parka', true);
r('snow_goggles', 1, [i('tin'), i('canvas'), i('sinew')], 'table', 'wear', 'sewing', true);
r('belt_pouch', 1, [[i('sealskin'), i('sinew')], [i('canvas', 2), i('sinew')]], 'table', 'wear', 'sewing', true);
r('big_pack', 1, [[i('sealskin', 3), i('canvas', 2), i('sinew', 2)], [i('bear_fur'), i('canvas', 2), i('sinew', 2)]], 'table', 'wear', 'parka', true);
r('sack', 1, [[i('canvas', 2), i('sinew')], [i('sealskin'), i('sinew')]], 'none', 'wear', 'rope', true);
r('frost_balm', 1, [i('fat', 2), i('lichen')], 'none', 'food', 'cooking', true);
// building
r('drying_rack', 1, [i('log', 2), i('rope')], 'none', 'build', 'drying');
r('skin_bed', 1, [[i('sealskin', 2), i('lichen', 2)], [i('fox_fur', 2), i('lichen', 2)]], 'none', 'build', 'hides');
r('hide_door', 1, [i('sealskin'), i('bone')], 'none', 'build', 'hides');
r('cache', 1, [i('stone', 6)], 'none', 'build', 'cache');
r('sled', 1, [i('plank', 4), i('rope', 2), i('bone', 2)], 'table', 'build', 'sled');
r('mast', 1, [[i('plank', 3), i('rope', 2)], [i('bone', 3), i('rope', 2)]], 'antenna', 'build', 'mast');

export const RECIPES: readonly Recipe[] = R;
export const recipeByResult = (id: string) => R.find(x => x.result === id);

/** Which variant (index) can be paid for, or -1. */
function variantOk(rec: Recipe): number {
  for (let v = 0; v < rec.variants.length; v++) if (rec.variants[v].every(g => count(g.id) >= g.n)) return v;
  return -1;
}
const stName = (s: Station) => (s === 'table' ? S.stTable : s === 'fire' ? S.stFire : s === 'drum' ? S.stDrum : S.stAntenna);
/** Where the technique is practised, in plain words. */
export const placeLabel = (rec: Recipe) => (rec.station === 'none' ? S.placeAny : rec.station === 'table' ? S.placeTable : rec.station === 'fire' ? S.placeFire : rec.station === 'drum' ? S.placeDrum : S.placeAntenna);
export const fineLabel = () => S.fineWork;
/** Recipes the character knows how to make. */
export const knownRecipes = () => R.filter(x => knows(x.tech));
/** Technique ids that have recipes but are not known yet (the «?» slots of the craft panel). */
export function unknownRecipeTechs(): string[] { const out: string[] = []; for (const x of R) if (!knows(x.tech) && !out.includes(x.tech)) out.push(x.tech); return out; }
export interface CanCraft { ok: boolean; missing: string[]; variant: number; reason?: string; unknown?: boolean }
/** Can the recipe be crafted now? Unknown techniques never can; `handsFrozen` blocks fine work. */
export function canCraft(rec: Recipe, stations: Stations, handsFrozen = false): CanCraft {
  if (!knows(rec.tech)) return { ok: false, missing: [], variant: -1, reason: unknownTechText(), unknown: true };
  const v = variantOk(rec);
  const missing: string[] = [];
  if (v < 0) {
    // list the missing items of the closest variant
    let best = rec.variants[0], bestScore = -1;
    for (const vv of rec.variants) { const sc = vv.reduce((a, g) => a + Math.min(g.n, count(g.id)), 0); if (sc > bestScore) { bestScore = sc; best = vv; } }
    for (const g of best) if (count(g.id) < g.n) missing.push(`${itemName(g.id)} ×${g.n - count(g.id)}`);
  }
  let reason: string | undefined;
  if (rec.station !== 'none' && !stations[rec.station]) reason = fmt(S.noStation, { st: stName(rec.station) });
  else if (rec.fine && handsFrozen) reason = S.handsFrozen;
  else if (missing.length) reason = fmt(S.missing, { list: missing.join(', ') });
  return { ok: v >= 0 && !reason, missing, variant: v, reason };
}
/** Craft: consumes the first affordable variant, adds the result (or drops it if the pack is full). */
export function craft(rec: Recipe, stations: Stations, handsFrozen = false, at?: { x: number; y: number }): boolean {
  const c = canCraft(rec, stations, handsFrozen);
  if (!c.ok) return false;
  for (const g of rec.variants[c.variant]) remove(g.id, g.n);
  const p = G.player;
  if (rec.result === 'mast') { if (!raiseMast()) { for (const g of rec.variants[c.variant]) add(g.id, g.n); return false; } }
  else {
    const left = add(rec.result, rec.n);
    if (left > 0) { spawnDrop(rec.result, left, at?.x ?? p?.x ?? 0, (at?.y ?? p?.y ?? 0) - 6); }
  }
  if (rec.fine) emit('fine_work', { t: 3 });
  emit('crafted', { id: rec.result, n: rec.n, recipe: rec.key });
  return true;
}
export const craftedText = (rec: Recipe) => fmt(S.crafted, { name: itemName(rec.result) });
export const noSpaceText = (rec: Recipe) => fmt(S.noSpace, { name: itemName(rec.result) });
