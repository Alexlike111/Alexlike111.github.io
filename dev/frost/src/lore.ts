// Lore for «Белая Мгла»: the meteorologist's diary (7 pages hidden in stashes), one-line carvings on
// trees and crates, the three radio parts the rescue call needs, and the player's journal model.
// Pure data and pure functions. Nothing runs at import; localStorage is touched only inside saveJournal/loadJournal.

export type LocId = 'station' | 'lake' | 'grotto' | 'wreck' | 'spring' | 'tower' | 'forest';

/** Places the journal can mark as discovered (the six stamped locations). 'forest' is only a carving location. */
export const DISCOVERABLE: readonly LocId[] = ['station', 'lake', 'grotto', 'wreck', 'spring', 'tower'];

export const LOCATION_NAMES: Record<LocId, string> = {
  station: 'Метеопост «Студёный»',
  lake: 'Замёрзшее озеро',
  grotto: 'Грот в южном обрыве',
  wreck: 'Обломки самолёта «Кукушка»',
  spring: 'Тёплый ключ',
  tower: 'Вышка на холме',
  forest: 'Ельник',
};

// ---------------------------------------------------------------- diary

export interface DiaryPage {
  id: number;        // 1..7, order of the diary
  date: string;      // date line of the entry
  title: string;
  text: string;      // 40-80 words
  place: LocId;      // where the page lies
  hiddenAt: string;  // the stash, as the finder sees it
}

export const DIARY: readonly DiaryPage[] = [
  {
    id: 1, date: '2 ноября', title: 'Пост «Студёный»', place: 'station', hiddenAt: 'под половицей у печки',
    text: '2 ноября. Пост «Студёный», −19 градусов, ветер юго-западный, шесть метров в секунду. Печку топлю только по вечерам, дров хватит на неделю. Рация «Гнездо» молчит с утра: села батарея. Запасная ушла в ящик у обломков самолёта ещё в августе, а по метровому снегу к нему я идти не решился. Дверь заметает к полудню, откапываю её лопатой. Если кто-то прилетит, то по дыму из трубы.',
  },
  {
    id: 2, date: '6 ноября', title: 'Озеро', place: 'lake', hiddenAt: 'в тайнике под вешкой у берега',
    text: '6 ноября. Озеро встало в начале месяца. Промерил лёд у берега: тридцать четыре сантиметра под снегом, держит. Но у западного камыша лёд гудит: там снизу подпирает тёплый ключ, и вода не замерзает. Рыбу в той полынье, наверное, никто не трогал. Удочку можно сделать из верёвки и ветки, а прорубь пробить киркой. Не ходи туда один и не стой долго на одном месте.',
  },
  {
    id: 3, date: '9 ноября', title: 'Грот', place: 'grotto', hiddenAt: 'в гроте, у задней стены',
    text: '9 ноября. Нашёл грот в южном обрыве, куда не добирается ветер. Внутри минус четыре, с потолка свисают сосульки, прозрачные, как стекло. Кто-то жёг здесь костёр давно: чёрный круг на камне и обгорелая палка. Резонатор для рации я спрятал в жестяной банке из-под чая, под вторым камнем справа от входа. Без него рация только шипит. Ночевать здесь безопаснее, чем на открытом месте.',
  },
  {
    id: 4, date: '12 ноября', title: 'Обломки', place: 'wreck', hiddenAt: 'в кабине, за креслом пилота',
    text: '12 ноября. Самолёт «Кукушка» сел на восточном гребне в последнюю пургу. Почти цел, только крыло вывернуло и засыпало снегом по самую кабину. Под крылом стоит ящик с оранжевой вешкой: в нём аккумулятор для рации, двенадцать вольт, семь ампер-часов. Тяжёлый, зараза. В кабине нашёл ракетницу и две красные ракеты. Береги их: одну поджигать стоит лишь тогда, когда совсем стемнеет.',
  },
  {
    id: 5, date: '14 ноября', title: 'Тёплый ключ', place: 'spring', hiddenAt: 'под плоским камнем у ключа',
    text: '14 ноября. У тёплого ключа вода плюс три, снег вокруг растаял до земли, пахнет мокрой хвоей и серой. Я посидел в воде минуту и вылез: сердце колотилось так, что было слышно. Больше не буду. Мокрая одежда в мороз хуже пустой. Флягу с кофе спрятал под камнем у ключа. Антенный кабель, двадцать метров, я поднял на вышку ещё в октябре. Лестница обледенела, будь осторожен.',
  },
  {
    id: 6, date: '16 ноября', title: 'Вышка', place: 'tower', hiddenAt: 'на перилах смотровой площадки, в жестяной коробке',
    text: '16 ноября. С вышки видно всё: станцию, озеро, дымок от ключа и западный хребет. Метель легла на него белой стеной. Записываю на всякий случай: третьей ночью, если будет ясно, над хребтом может встать сияние особой формы, три светлых полосы, сходящихся в одну точку. Такого я не видел никогда. Если увидишь, запомни время и направление: это укажет путь к станции.',
  },
  {
    id: 7, date: '17 ноября', title: 'Последняя запись', place: 'station', hiddenAt: 'на чердаке, в банке из-под тушёнки',
    text: '17 ноября. Рация почти собрана: осталось поставить резонатор и подключить антенный кабель, который лежит на вышке. Тогда я смогу передать координаты. Если ночью над горизонтом вспыхнет красная ракета, значит, нас услышали, и утром упадёт груз: ищи оранжевую вешку. Вертолёт сядет только на открытое место, где видно небо. В доме жечь бесполезно: дым никто не увидит.',
  },
];

export const DIARY_PAGE_COUNT = DIARY.length;

export function diaryPage(id: number): DiaryPage | undefined {
  return DIARY.find((p) => p.id === id);
}

// ---------------------------------------------------------------- radio

export type RadioPartId = 'radio_battery' | 'radio_resonator' | 'radio_cable';

export interface RadioPart {
  id: RadioPartId;       // loot id: put it into the crate/cache loot list of the matching location
  name: string;
  where: LocId;
  container: 'crate' | 'cache';   // crate = supply-style box with an orange pole; cache = small tin under a stone
  place: string;         // how the finder sees it
}

export const RADIO_PARTS: readonly RadioPart[] = [
  { id: 'radio_battery', name: 'Аккумулятор 12 В, 7 А·ч', where: 'wreck', container: 'crate', place: 'ящик с оранжевой вешкой у крыла «Кукушки»' },
  { id: 'radio_resonator', name: 'Кварцевый резонатор', where: 'grotto', container: 'cache', place: 'жестяная банка под вторым камнем справа от входа в грот' },
  { id: 'radio_cable', name: 'Антенный кабель, 20 м', where: 'tower', container: 'crate', place: 'ящик на вышке под брезентом' },
];

export const RADIO_PART_COUNT = RADIO_PARTS.length;

// ---------------------------------------------------------------- carvings and scratches

export interface Carving {
  id: string;
  kind: 'tree' | 'crate';   // carved on a trunk / scratched on a crate
  where: LocId;
  text: string;             // one line, at most ~50 characters
}

export const CARVINGS: readonly Carving[] = [
  { id: 'tree_lake', kind: 'tree', where: 'lake', text: 'Не ходи к озеру один.' },
  { id: 'tree_fall', kind: 'tree', where: 'forest', text: 'Сверху сыплет: уходи вбок.' },
  { id: 'tree_stones', kind: 'tree', where: 'forest', text: 'Костёр на камнях не тонет в снегу.' },
  { id: 'tree_snow', kind: 'tree', where: 'forest', text: 'Снег без огня — это холод, не вода.' },
  { id: 'tree_flag', kind: 'tree', where: 'tower', text: 'Вешка — твой друг в мгле.' },
  { id: 'tree_spring', kind: 'tree', where: 'spring', text: 'Ключ тёплый, но не ложись в него.' },
  { id: 'crate_antenna', kind: 'crate', where: 'tower', text: 'Антенна на вышке, не в снегу.' },
  { id: 'crate_match', kind: 'crate', where: 'station', text: 'Спички сырые: держи в банке.' },
  { id: 'crate_pick', kind: 'crate', where: 'wreck', text: 'Не вскрывать без лома: примёрзло.' },
];

// ---------------------------------------------------------------- journal

export const JOURNAL_KEY = 'frost.journal.v1';

/** What the player has found. Ids only: texts come from DIARY / CARVINGS / RADIO_PARTS. */
export interface Journal {
  v: 1;
  pages: number[];          // diary page ids found
  places: LocId[];          // discovered locations
  events: string[];         // event kinds seen (EventKind values from events.ts)
  carvings: string[];       // carving ids read
  radio: RadioPartId[];     // radio parts installed
}

export function emptyJournal(): Journal {
  return { v: 1, pages: [], places: [], events: [], carvings: [], radio: [] };
}

/** Adds a value to a list once; returns the same journal object when nothing changes (immutable update). */
function withOnce<T extends string | number>(j: Journal, key: 'pages' | 'places' | 'events' | 'carvings' | 'radio', value: T): Journal {
  const list = j[key] as T[];
  if (list.includes(value)) return j;
  return { ...j, [key]: [...list, value] };
}

export const journalWithPage = (j: Journal, id: number): Journal =>
  diaryPage(id) ? withOnce(j, 'pages', id) : j;
export const journalWithPlace = (j: Journal, where: LocId): Journal => withOnce(j, 'places', where);
export const journalWithEvent = (j: Journal, kind: string): Journal => withOnce(j, 'events', kind);
export const journalWithCarving = (j: Journal, id: string): Journal =>
  CARVINGS.some((c) => c.id === id) ? withOnce(j, 'carvings', id) : j;
export const journalWithRadioPart = (j: Journal, id: RadioPartId): Journal =>
  RADIO_PARTS.some((p) => p.id === id) ? withOnce(j, 'radio', id) : j;

/** Number of installed radio parts; events.ts reads it through ctx.radioParts(). */
export const radioPartCount = (j: Journal): number => j.radio.length;

export interface JournalProgress {
  pages: number; pagesTotal: number;
  places: number; placesTotal: number;
  events: number;
  carvings: number; carvingsTotal: number;
  radio: number; radioTotal: number;
}

export function journalProgress(j: Journal): JournalProgress {
  return {
    pages: j.pages.length, pagesTotal: DIARY_PAGE_COUNT,
    places: j.places.length, placesTotal: DISCOVERABLE.length,
    events: j.events.length,
    carvings: j.carvings.length, carvingsTotal: CARVINGS.length,
    radio: j.radio.length, radioTotal: RADIO_PART_COUNT,
  };
}

/** Pages the player has read so far, in diary order. */
export const journalPages = (j: Journal): DiaryPage[] => DIARY.filter((p) => j.pages.includes(p.id));

/** Validates an untrusted object (localStorage content) and returns a clean journal, or an empty one. */
export function sanitizeJournal(raw: unknown): Journal {
  if (!raw || typeof raw !== 'object') return emptyJournal();
  const o = raw as Partial<Record<keyof Journal, unknown>>;
  if (o.v !== 1) return emptyJournal();
  const strs = (a: unknown): string[] => (Array.isArray(a) ? a.filter((s): s is string => typeof s === 'string') : []);
  const nums = (a: unknown): number[] => (Array.isArray(a) ? a.filter((n): n is number => typeof n === 'number' && Number.isInteger(n)) : []);
  const uniq = <T,>(a: T[]): T[] => a.filter((v, i) => a.indexOf(v) === i);
  return {
    v: 1,
    pages: uniq(nums(o.pages)).filter((id) => diaryPage(id) !== undefined),
    places: uniq(strs(o.places)).filter((s): s is LocId => DISCOVERABLE.includes(s as LocId)),
    events: uniq(strs(o.events)).slice(0, 64),
    carvings: uniq(strs(o.carvings)).filter((id) => CARVINGS.some((c) => c.id === id)),
    radio: uniq(strs(o.radio)).filter((s): s is RadioPartId => RADIO_PARTS.some((p) => p.id === s)),
  };
}

/** Storage-like object; defaults to localStorage when available. Every access is guarded: private windows and blocked storage throw. */
type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void };

function defaultStorage(): KV | null {
  try {
    const ls = (globalThis as { localStorage?: KV }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

/** Reads the journal. Missing, blocked or corrupt storage gives an empty journal; it never throws. */
export function loadJournal(store: KV | null = defaultStorage()): Journal {
  try {
    if (!store) return emptyJournal();
    const s = store.getItem(JOURNAL_KEY);
    if (!s) return emptyJournal();
    return sanitizeJournal(JSON.parse(s));
  } catch {
    return emptyJournal();
  }
}

/** Writes the journal. Returns false when storage is unavailable or full; the game keeps the in-memory copy either way. */
export function saveJournal(j: Journal, store: KV | null = defaultStorage()): boolean {
  try {
    if (!store) return false;
    store.setItem(JOURNAL_KEY, JSON.stringify(j));
    return true;
  } catch {
    return false;
  }
}
