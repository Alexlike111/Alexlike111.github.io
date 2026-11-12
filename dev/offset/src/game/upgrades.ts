// Run mutations ("мутации прыжка"): picked 1-of-3 after each sheet. Pure data + apply().
import type { L } from '../core/i18n';
import type { Stats } from './types';
import type { Rng } from '../core/rng';

export type Rarity = 1 | 2 | 3;
export type UpTag = 'jump' | 'combat' | 'body' | 'ink';
export interface Upgrade {
  id: string; name: L; desc: L; rarity: Rarity; max: number; tag: UpTag; icon: string;
  /** must be unlocked in the catalogue (meta) before it can appear */ locked?: boolean; unlockCost?: number;
  apply(s: Stats, stack: number): void;
}
const U = (id: string, tag: UpTag, rarity: Rarity, max: number, icon: string, name: L, desc: L, apply: (s: Stats, n: number) => void, unlockCost = 0): Upgrade =>
  ({ id, tag, rarity, max, icon, name, desc, apply, locked: unlockCost > 0, unlockCost });

export const UPGRADES: Upgrade[] = [
  // ---- jump
  U('range', 'jump', 1, 3, 'range', { ru: 'Длинный лист', en: 'Long Sheet' }, { ru: 'Дальность прыжка +15%', en: 'Jump range +15%' }, (s) => { s.range *= 1.15; }),
  U('charge', 'jump', 2, 2, 'charge', { ru: 'Запасная форма', en: 'Spare Plate' }, { ru: '+1 заряд прыжка', en: '+1 jump charge' }, (s) => { s.charges += 1; }),
  U('recharge', 'jump', 1, 3, 'recharge', { ru: 'Быстрая сушка', en: 'Quick Dry' }, { ru: 'Заряды восстанавливаются на 18% быстрее', en: 'Charges restore 18% faster' }, (s) => { s.recharge *= 0.82; }),
  U('burst', 'jump', 1, 3, 'burst', { ru: 'Плотный оттиск', en: 'Hard Impression' }, { ru: 'Ударная волна прибытия: радиус +25%, сила +40%', en: 'Arrival shockwave: radius +25%, force +40%' }, (s) => { s.burstR *= 1.25; s.burstDmg *= 1.4; s.burstImpulse *= 1.4; }),
  U('vector', 'jump', 2, 2, 'vector', { ru: 'Поворот вектора', en: 'Vector Turn' }, { ru: 'После прыжка импульс разворачивается по направлению прыжка', en: 'After a jump your momentum turns toward the jump direction' }, (s, n) => { s.vector = n; }, 60),
  U('heavyR', 'jump', 1, 2, 'heavyR', { ru: 'Большой формат', en: 'Large Format' }, { ru: 'Сфера тяжёлого прыжка +30%', en: 'Heavy jump sphere +30%' }, (s) => { s.heavyR *= 1.3; }),
  U('heavyCost', 'jump', 3, 1, 'heavyCost', { ru: 'Экономия краски', en: 'Ink Saver' }, { ru: 'Тяжёлый прыжок стоит 1 заряд', en: 'Heavy jump costs 1 charge' }, (s) => { s.heavyCost = 1; }),
  U('scarPortal', 'jump', 2, 1, 'portal', { ru: 'Сквозняк', en: 'Draught' }, { ru: 'Пули, влетевшие в шрам, вылетают из парного шрама — уже по врагам', en: 'Slugs entering a scar exit its twin — now aimed at the Register' }, (s) => { s.scarPortal = 1; }, 90),
  U('scarCut', 'jump', 1, 2, 'scar', { ru: 'Острый край', en: 'Sharp Edge' }, { ru: 'Шрамы режут врагов и живут на 50% дольше', en: 'Scars cut enemies and last 50% longer' }, (s, n) => { s.scarCut = n; s.scarLife *= 1.5; }),
  U('echo', 'jump', 2, 2, 'echo', { ru: 'Двойной оттиск', en: 'Double Print' }, { ru: 'Через мгновение в точке ухода повторяется ударная волна', en: 'A moment later the shockwave repeats where you left' }, (s, n) => { s.echo = n; }, 80),
  U('inset', 'jump', 2, 1, 'inset', { ru: 'Врезка', en: 'Inset' }, { ru: 'Можно прыгать прямо в стены — они разлетаются', en: 'Jump straight into walls — they burst apart' }, (s) => { s.inset = 1; }, 120),
  U('killCharge', 'jump', 2, 1, 'turn', { ru: 'Оборот', en: 'Turnover' }, { ru: 'Убийство возвращает заряд прыжка', en: 'A kill refunds a jump charge' }, (s) => { s.killCharge = 1; }, 100),
  // ---- combat
  U('strike', 'combat', 1, 3, 'strike', { ru: 'Тяжёлый пресс', en: 'Heavy Press' }, { ru: 'Удар: сила +30%, урон +25%', en: 'Strike: force +30%, damage +25%' }, (s) => { s.strikeForce *= 1.3; s.strikeDmg *= 1.25; }),
  U('slam', 'combat', 1, 2, 'slam', { ru: 'Кинетика', en: 'Kinetics' }, { ru: 'Скорость тела сильнее превращается в ударную волну', en: 'Body speed converts harder into shockwaves' }, (s) => { s.slamK *= 1.5; }),
  U('chain', 'combat', 2, 1, 'chain', { ru: 'Рикошет', en: 'Ricochet' }, { ru: 'После попадания ударом следующий прыжок бесплатный', en: 'After a strike lands, the next jump is free' }, (s) => { s.chainStrike = 1; }),
  U('throw', 'combat', 1, 2, 'throw', { ru: 'Рычаг', en: 'Lever' }, { ru: 'Бросок +30%, можно поднимать вдвое тяжелее', en: 'Throw +30%, carry twice the weight' }, (s) => { s.throwV *= 1.3; s.carryMass *= 2; }),
  U('quake', 'combat', 1, 2, 'quake', { ru: 'Толчок', en: 'Tremor' }, { ru: 'Жёсткое приземление бьёт шире и ломает полы', en: 'Hard landings hit wider and crack floors' }, (s, n) => { s.quake = n; }),
  U('afterburn', 'combat', 3, 1, 'solvent', { ru: 'Растворитель', en: 'Solvent' }, { ru: 'Враг, убитый ударом о мир, взрывается', en: 'Enemies killed by the world explode' }, (s) => { s.afterburn = 1; }, 140),
  U('thorns', 'combat', 1, 1, 'thorns', { ru: 'Острая кромка', en: 'Paper Cut' }, { ru: 'Получив урон, выпускаешь ударную волну', en: 'Taking a hit releases a shockwave' }, (s) => { s.thorns = 1; }),
  U('glassCannon', 'combat', 3, 1, 'thin', { ru: 'Тонкая бумага', en: 'Thin Stock' }, { ru: '−1 к запасу прочности, весь урон +50%', en: '−1 max durability, all damage +50%' }, (s) => { s.maxHp = Math.max(1, s.maxHp - 1); s.glassCannon = 1; s.strikeDmg *= 1.5; s.burstDmg *= 1.5; }, 110),
  // ---- body
  U('hp', 'body', 1, 3, 'hp', { ru: 'Плотная бумага', en: 'Heavy Stock' }, { ru: '+1 к запасу прочности, починка на 1', en: '+1 max durability, repair 1' }, (s) => { s.maxHp += 1; }),
  U('focus', 'body', 1, 2, 'focus', { ru: 'Выдержка', en: 'Exposure' }, { ru: 'Замедление при прицеливании длится на 50% дольше', en: 'Aiming slow-motion lasts 50% longer' }, (s) => { s.focus *= 1.5; }),
  U('leech', 'body', 2, 1, 'leech', { ru: 'Впитывание', en: 'Absorb' }, { ru: 'Убитые враги иногда роняют починку', en: 'Fallen enemies sometimes drop a repair' }, (s) => { s.leech = 1; }),
  U('regen', 'body', 2, 1, 'regen', { ru: 'Сушка между листами', en: 'Drying Rack' }, { ru: 'Починка на 1 в начале каждого листа', en: 'Repair 1 at the start of every sheet' }, (s) => { s.hpRegenRoom = 1; }),
  U('revive', 'body', 3, 1, 'dupe', { ru: 'Дубликат', en: 'Duplicate' }, { ru: 'Раз за тираж — перепечатка вместо гибели', en: 'Once per run — a reprint instead of death' }, (s) => { s.revive = 1; }, 160),
  // ---- ink
  U('ink', 'ink', 1, 3, 'ink', { ru: 'Насыщенность', en: 'Saturation' }, { ru: 'Краски +25%', en: 'Ink gain +25%' }, (s) => { s.inkMult *= 1.25; }),
  U('magnet', 'ink', 1, 1, 'magnet', { ru: 'Капилляр', en: 'Capillary' }, { ru: 'Краска притягивается издалека', en: 'Ink is drawn from afar' }, (s) => { s.magnet *= 2.4; }),
];
export const UP_BY_ID: Record<string, Upgrade> = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

/** roll `n` distinct offers given current stacks and unlocked set */
export function rollOffers(rng: Rng, stacks: Record<string, number>, unlocked: Set<string>, n = 3, luck = 0): Upgrade[] {
  const pool = UPGRADES.filter((u) => (stacks[u.id] ?? 0) < u.max && (!u.locked || unlocked.has(u.id)));
  const out: Upgrade[] = []; const w = (u: Upgrade) => (u.rarity === 1 ? 10 : u.rarity === 2 ? 4.2 + luck * 2 : 1.3 + luck * 1.5) * ((stacks[u.id] ?? 0) > 0 ? 1.25 : 1);
  while (out.length < n && pool.length) { const u = rng.weighted(pool, w); out.push(u); pool.splice(pool.indexOf(u), 1); }
  return out;
}
