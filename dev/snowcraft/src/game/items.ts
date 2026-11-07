// Item data (DESIGN §8). Every item id is EXACTLY as in DESIGN. Names go through i18n (registerSource 'item.<id>').
// Snow blocks carry their density in Slot.dur (kg/m³); stacks merge by quality class (see snowClass()).
import { registerSource, tr } from '../content/i18n';
import type { FixtureKind } from './state';

export type ItemKind = 'material' | 'food' | 'tool' | 'wear' | 'fixture' | 'block' | 'misc' | 'note';
export type WearSlot = 'head' | 'body' | 'hands' | 'feet';

export interface FoodDef {
  food: number;            // satiety points (0..100 scale)
  water?: number;          // hydration points
  warm?: number;           // seconds of boosted metabolism (warming effect)
  warmPow?: number;        // metabolism boost (relative units) while warm
  core?: number;           // immediate core change °C (cold snow: negative)
  raw?: boolean;           // raw food: cooks into `cooked`
  cooked?: string;
  drink?: boolean;         // drunk, not eaten
  sick?: number;           // chance of nausea (raw meat), cosmetic for now
}
export interface WearDef {
  slot: WearSlot;
  insul: number;           // contribution to body insulation (core)
  prot: number;            // 0..1 protection of the matching extremity (hands/feet/face)
  dryT?: number;           // relative drying time
}
export interface ToolDef {
  kind: string;            // tool class id (used by tools.ts)
  /** Tools never break and have no tiers. `dur` is only the burn/fuel budget of the two consumable light sources
   *  (torch: minutes of flame, lantern: minutes of diesel); every other tool is Infinity. */
  dur: number;
  speed?: number;
}
export interface ItemDef {
  id: string; name: string; kind: ItemKind;
  w: number;               // weight, kg
  stack: number;           // max stack
  icon: string;            // sprite key for icon()
  food?: FoodDef; wear?: WearDef; tool?: ToolDef;
  fixture?: FixtureKind;   // placing creates this fixture
  place?: string;          // placing writes this material key (1×1 tile), e.g. 'LOG'
  fuel?: { campfire?: number; stove?: number; lamp?: number; brazier?: number }; // minutes of burn per unit
  tinder?: boolean;        // fire starting aid
  desc?: string;
}

const I: Record<string, ItemDef> = {};
function def(id: string, name: string, kind: ItemKind, w: number, stack: number, o: Partial<ItemDef> = {}) {
  I[id] = { id, name, kind, w, stack, icon: id, ...o };
  registerSource('item.' + id, name);
}
const food = (f: FoodDef) => ({ food: f });

// ---- materials ----
def('snow_block', 'Снежный блок', 'block', 5, 4, { place: 'SNOWBLOCK', desc: 'Вырезан снежным ножом. Чем плотнее — тем тяжелее и прочнее.' });
def('snow', 'Снег', 'material', 0.4, 20, { food: { food: 0, water: 6, core: -0.3, drink: true }, desc: 'Рыхлый снег из лопаты. В котелке — вода.' });
def('ice', 'Лёд', 'material', 1.5, 8, { place: 'ICE', desc: 'Морской лёд: топится в воду лучше снега.' });
def('log', 'Плавник', 'material', 6, 4, { place: 'LOG', fuel: { campfire: 120, stove: 120, brazier: 120 } });
def('plank', 'Доска', 'material', 2, 8, { place: 'PLANK', fuel: { campfire: 60, stove: 60, brazier: 60 } });
def('bone', 'Китовая кость', 'material', 3, 6, { place: 'WHALEBONE' });
def('stone', 'Камень', 'material', 4, 6, { place: 'STONE' });
def('soapstone', 'Мыльный камень', 'material', 2, 4);
def('coal', 'Уголь', 'material', 1.2, 12, { fuel: { campfire: 180, stove: 240, brazier: 200 } });
def('lichen', 'Ягель', 'material', 0.1, 20, { tinder: true });
def('canvas', 'Парусина', 'material', 0.8, 8, { tinder: true });
def('rope', 'Верёвка', 'material', 0.4, 8);
def('sinew', 'Жилы', 'material', 0.1, 20);
def('fat', 'Жир', 'food', 0.5, 10, { food: { food: 14, warm: 90, warmPow: 1.1 }, fuel: { lamp: 240, campfire: 40, brazier: 40 } });
def('sealskin', 'Тюленья шкура', 'material', 2, 4);
def('fox_fur', 'Песцовый мех', 'material', 0.6, 6);
def('bear_fur', 'Медвежья шкура', 'material', 5, 2);
def('scrap', 'Железяки', 'material', 1, 12);
def('tin', 'Жесть', 'material', 0.5, 8);
def('matches', 'Спички', 'misc', 0.02, 40);
def('flint', 'Огниво', 'tool', 0.2, 1, { tool: { kind: 'flint', dur: Infinity } });
def('flare', 'Ракета', 'misc', 0.2, 3);
def('diesel', 'Солярка', 'material', 3, 4, { fuel: { brazier: 90 } });
def('radio_triode', 'Радиолампа', 'misc', 0.3, 1);
def('radio_coil', 'Катушка', 'misc', 0.8, 1);
def('battery', 'Аккумулятор', 'misc', 4, 1);
def('note', 'Записка', 'note', 0.01, 1);
def('pot', 'Котелок', 'fixture', 1.5, 1, { fixture: 'pot' });
def('flask', 'Фляга', 'tool', 0.4, 1, { tool: { kind: 'flask', dur: Infinity }, desc: 'Держит воду тёплой за пазухой.' });
def('water', 'Талая вода', 'food', 0.5, 6, { food: { food: 0, water: 26, drink: true } });
def('hot_tea', 'Горячий чай', 'food', 0.5, 2, { food: { food: 2, water: 24, warm: 140, warmPow: 1.3, drink: true } });

// ---- food ----
def('seal_meat', 'Тюленина', 'food', 1, 6, { food: { food: 16, raw: true, cooked: 'cooked_meat', sick: 0.08 } });
def('fish', 'Треска', 'food', 0.6, 6, { food: { food: 10, water: 2, raw: true, cooked: 'fish_cooked' } });
def('ptarmigan', 'Куропатка', 'food', 0.8, 4, { food: { food: 12, raw: true, cooked: 'cooked_meat' } });
def('cooked_meat', 'Жареное мясо', 'food', 1, 6, food({ food: 32, warm: 120, warmPow: 1.0 }));
def('fish_cooked', 'Печёная рыба', 'food', 0.5, 6, food({ food: 22, warm: 70, warmPow: 0.8 }));
def('can', 'Консервы', 'food', 0.5, 6, food({ food: 30, water: 4, warm: 40, warmPow: 0.6 }));
def('biscuit', 'Галеты', 'food', 0.2, 10, food({ food: 12 }));
def('tea', 'Чай', 'material', 0.1, 10, { desc: 'Сухой чай. Заваривается в котелке.' });

// ---- tools: no tiers, no durability. Each one does what it is for (tools.ts: SPEED table). ----
const tool = (id: string, name: string, w: number, kind: string, dur: number, o: Partial<ItemDef> = {}) =>
  def(id, name, 'tool', w, 1, { tool: { kind, dur }, ...o });
const NEVER = Infinity;
tool('snow_knife', 'Снежный нож', 0.8, 'knife', NEVER, { desc: 'Режет снежные блоки из плотного наста. Рыхлый снег рассыплется.' });
tool('shovel', 'Лопата', 2.5, 'shovel', NEVER, { desc: 'Двигает снег: черпать, перебрасывать, утрамбовывать, засыпать.' });
tool('ice_chisel', 'Пешня', 3.5, 'chisel', NEVER, { desc: 'Работает по льду: лунки, ледяные блоки, толщина льда под ногами.' });
tool('axe', 'Топор', 2.2, 'axe', NEVER, { desc: 'Рубит дерево и кость: плавник, брёвна, стойки, китовые рёбра.' });
tool('pick', 'Кирка', 3, 'pick', NEVER, { desc: 'Разбивает камень и ледяные пробки. Грунт и снег ей копать неудобно.' });
tool('saw', 'Пила', 1.2, 'saw', NEVER, { desc: 'Быстрее топора по брёвнам и доскам, быстрее ножа по снежным блокам.' });
tool('harpoon', 'Гарпун', 2.5, 'harpoon', NEVER, { desc: 'Для тюленя у лунки: бей, когда он всплывает.' });
tool('fishing_line', 'Леска с крючком', 0.2, 'fishing', NEVER, { desc: 'Для лунки или полыньи. Голые пальцы мёрзнут.' });
tool('torch', 'Факел', 0.8, 'torch', 60, { desc: 'Горит около часа. Освещает шахту, отпугивает зверя.' });            // dur = burn minutes left
tool('lantern', 'Фонарь', 1.5, 'lantern', 360, { desc: 'Горит на солярке: 6 часов на заправку.' });      // dur = diesel minutes left
tool('flare_gun', 'Ракетница', 1, 'flare_gun', NEVER);
tool('barometer', 'Карманный барометр', 0.3, 'barometer', NEVER);

// ---- wear ----
const wear = (id: string, name: string, w: number, slot: WearSlot, insul: number, prot: number) =>
  def(id, name, 'wear', w, 1, { wear: { slot, insul, prot } });
wear('wool_mittens', 'Шерстяные рукавицы', 0.3, 'hands', 0.05, 0.82);
wear('fur_mittens', 'Меховые рукавицы', 0.6, 'hands', 0.08, 0.95);
wear('felt_boots', 'Валенки', 1.4, 'feet', 0.05, 0.8);
wear('kamiks', 'Камики', 1.2, 'feet', 0.08, 0.93);
wear('wool_hat', 'Шерстяная шапка', 0.2, 'head', 0.1, 0.45);
wear('fur_hood', 'Меховой капюшон и маска', 0.7, 'head', 0.2, 0.93);
wear('station_parka', 'Парка станции', 2.5, 'body', 0.55, 0);
wear('fur_parka', 'Меховая парка', 3.5, 'body', 0.95, 0);

// ---- fixture kits ----
const fx = (id: string, name: string, w: number, fixture: FixtureKind, o: Partial<ItemDef> = {}) => def(id, name, 'fixture', w, 1, { fixture, ...o });
fx('campfire', 'Костёр', 4, 'campfire');
fx('fat_lamp', 'Жировая лампа', 1.2, 'fat_lamp');
fx('brazier', 'Бочка-жаровня', 12, 'brazier');
fx('drying_rack', 'Сушилка', 5, 'drying_rack');
fx('skin_bed', 'Лежанка из шкур', 4, 'skin_bed');
fx('hide_door', 'Полог', 2, 'hide_door');
fx('cache', 'Каменный тайник', 10, 'cache');
fx('snare', 'Силок', 0.6, 'snare');
def('sled', 'Нарты', 'misc', 6, 1, { desc: 'Тащи за собой: +30 мест. Использовать — запрячься.' });   // handled by inventory.sled
fx('mast', 'Мачта антенны', 6, 'mast');
def('backpack', 'Рюкзак', 'misc', 1, 1, { desc: 'Всё, что было с тобой.' });

registerSource('item.unknown', 'Предмет');

export const ITEMS: Record<string, ItemDef> = I;
const unknownCache: Record<string, ItemDef> = {};
/** Item definition; unknown ids (v1 leftovers, lore note_N) get a generic definition so nothing crashes. */
export function getItem(id: string): ItemDef {
  const d = I[id]; if (d) return d;
  let u = unknownCache[id]; if (u) return u;
  const isNote = /^note/.test(id);
  u = unknownCache[id] = { id, name: isNote ? 'Записка' : 'Предмет', kind: isNote ? 'note' : 'misc', w: 0.2, stack: isNote ? 1 : 10, icon: isNote ? 'note' : id };
  return u;
}
export function itemName(id: string): string { const d = getItem(id); return tr('item.' + id, d.name); }
export const isTool = (id: string) => getItem(id).kind === 'tool';
export const isFood = (id: string) => !!getItem(id).food;
export const isDrink = (id: string) => !!getItem(id).food?.drink;

// ---- snow density helpers ----
/** Density kg/m³ from a SNOW/PACKED/SNOWBLOCK cell's aux. PACKED aux 0 (the sim's freshly sintered snow) counts as ~380. */
export function densityOf(matKey: string, aux: number): number {
  if (matKey === 'PACKED' && aux === 0) return 380;
  return Math.round(60 + aux * 1.6);
}
export function auxOfDensity(d: number): number { return Math.max(0, Math.min(255, Math.round((d - 60) / 1.6))); }
export type SnowClass = 0 | 1 | 2;   // 0 рыхлый, 1 хороший, 2 плотный
export function snowClass(d: number): SnowClass { return d < 250 ? 0 : d <= 380 ? 1 : 2; }
registerSource('snow.c0', 'рыхлый'); registerSource('snow.c1', 'хороший'); registerSource('snow.c2', 'плотный');
export function snowClassName(c: number) { return tr('snow.c' + c, ['рыхлый', 'хороший', 'плотный'][c] ?? ''); }
/** Weight of one snow block of density d (kg). */
export const blockWeight = (d: number) => Math.round((d / 60) * 10) / 10;

/** Fuel minutes of `id` for a fixture burn class, or 0. */
export function fuelMinutes(id: string, cls: 'campfire' | 'stove' | 'lamp' | 'brazier'): number {
  return getItem(id).fuel?.[cls] ?? 0;
}
