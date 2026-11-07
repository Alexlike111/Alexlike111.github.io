// Knowledge instead of workbenches (DESIGN §8/§9, v2.1): the character KNOWS techniques. Four are known from the start; the rest are learned by
// reading notes (the ship doctor's diary of the 1890s «Заря» expedition + the station keeper's log) or by experience (first seal, first frostnip,
// first CO headache, first fall through ice, three courses of snow blocks...). Recipes (recipes.ts) check `knows(tech)`.
// Also here: the notes themselves (RU texts), the "materials learned by probing" facts (journal tab «Вещества») and the exploration map
// (grid.seen is filled while the player walks about).
import { G, toast } from './state';
import { emit, on } from './bus';
import { strings, fmt, registerSource } from '../content/i18n';
import { remove } from './inventory';
import { seen, TW, TH, TS } from '../engine/grid';
import { sfx } from '../engine/audio';
import { MATS } from '../content/materials';

// ---------------------------------------------------------------------------------------------------------------------
// notes: id -> {who, teaches}. Texts live in the strings table below (RU source).
export interface NoteDef { id: string; who: 'doctor' | 'keeper'; teaches: string[] }
export const NOTES: NoteDef[] = [
  { id: 'n1', who: 'doctor', teaches: ['lamp'] },
  { id: 'n2', who: 'doctor', teaches: ['torch'] },
  { id: 'n3', who: 'doctor', teaches: ['drying'] },
  { id: 'n4', who: 'doctor', teaches: ['hides'] },
  { id: 'n5', who: 'doctor', teaches: ['methane'] },
  { id: 'n6', who: 'doctor', teaches: ['snares', 'cache'] },
  { id: 'n7', who: 'doctor', teaches: ['sewing'] },
  { id: 'n8', who: 'doctor', teaches: ['fishing', 'butchery'] },
  { id: 'n9', who: 'doctor', teaches: ['parka'] },
  { id: 'n10', who: 'doctor', teaches: ['snow_roll'] },
  { id: 'n11', who: 'doctor', teaches: ['sled'] },
  { id: 'n12', who: 'doctor', teaches: [] },
  { id: 'n13', who: 'doctor', teaches: [] },
  { id: 'n14', who: 'doctor', teaches: [] },
  { id: 's1', who: 'keeper', teaches: ['harpoon'] },
  { id: 's2', who: 'keeper', teaches: ['mast'] },
  { id: 's3', who: 'keeper', teaches: ['ice_chisel', 'brazier'] },
];
export const noteDef = (id: string) => NOTES.find(n => n.id === id);

const N = strings('note', {
  who_doctor: 'Дневник судового врача «Зари»', who_keeper: 'Журнал смотрителя станции',
  n1_t: 'Лист 1 · Жестянка у тура', n1_x: '12 сентября. «Заря» встала во льдах в четырёх вёрстах от этого мыса. Складываю тур и оставляю в жестянке этот лист: кто бы ни нашёл — берите. Каюр показал мне лампу, какой греются в снежных домах: плоский камень, жир, фитиль из ягеля. Огонь с ноготь, а в доме тепло. Запомните: лампа — сердце дома.',
  n2_t: 'Лист 3 · Шахта', n2_x: 'Октябрь. Шахтёры ушли, оставив крепь, вагонетки и мешки с углём. В штольне темно, как в мешке; выручает смолёный факел: плавник, капля жира и обрывок парусины. У портала нашли кирку — не бросайте её. Впереди завал, и камень там руками не взять.',
  n3_t: 'Лист 4 · Хижина шахтёров', n3_x: 'В хижине тепло от старой печки. Сушу рукавицы на жердях над огнём: мокрое на морозе страшнее самого мороза. Две жерди да верёвка — вот и вся сушилка; у огня вещи сохнут вдвое быстрее. Мокрый мех на теле стынет, как жесть.',
  n4_t: 'Лист 5 · Хижина шахтёров', n4_x: 'Лежанка из шкур поверх ягеля греет снизу: лёд из-под спины — главный вор тепла. Пока нет двери, вход завешиваем пологом из тюленьей шкуры: на сильном морозе он держит половину ветра. Сверху — снег, и сквозняка как не бывало.',
  n5_t: 'Лист 6 · Забой за переборкой', n5_x: 'За досками забоя воздух сладковатый, голова идёт кругом. Шахтёр называл его «болотным газом»: над ним лампа горит голубым, а потом хлопок — и нет ни лампы, ни забоя. Огня за переборку не носить. И не выбивать стойки: над нами не камень, а щебень на досках.',
  n6_t: 'Лист 7 · Хижина шахтёров', n6_x: 'Песец за ночь вынес окорок из открытого мешка и ушёл с таким спокойным видом, будто это его дом. Теперь прячем запасы под камни: шесть валунов — и лисе не взять. Для куропаток ставим силки: верёвка да сучок, у ягеля на тундре.',
  n7_t: 'Лист 8 · Китовые кости', n7_x: 'У скелета кита каюр шьёт: рукавицы из шкуры, камики из двух шкур, нитка — жила. Надевать только сухое: хитрость в том, чтобы рука не потела. Работа тонкая, пальцы на морозе теряешь за минуты — шей у огня или в доме.',
  n8_t: 'Лист 9 · Пляж', n8_x: 'Ловим рыбу у трещины. Леска — костяной крючок да жила; рыба клюёт, когда не шумишь. Жилы берём из тюленя: его разделывают быстро, пока не остыл, — мясо, жир, шкура, жилы. Из жил выходит нитка и леска, пропадает только то, чего не заметили.',
  n9_t: 'Лист 10 · Ледяная пещера', n9_x: 'Айсберг пустой, как раковина: внутри ветра нет вовсе, свет сквозь стену голубой. Спали втроём, лёд держит тепло лампы; только за ночь стена потеет и каплет — стелите шкуры. Парку шьют так: три шкуры, два песца, нитка потолще. Шить только в тепле.',
  n10_t: 'Лист 11 · Ледяная пещера', n10_x: 'Если провалился в лунку — не отряхивайся. Выскочи на сухой снег и катайся: порошок вытянет воду из меха, как промокашка. Потом к огню. Фома побежал к кораблю мокрым и не добежал. Не бегите мокрыми.',
  n11_t: 'Лист 12 · Трюм шхуны', n11_x: 'Нарты собрали из палубных досок: четыре доски, две кости, ремни. С нартами один человек возит груз троих. Но лёд не любит спешащих: перед разводьем проверь пешней, что он толще человеческого роста.',
  n12_t: 'Лист 13 · Каюта капитана', n12_x: 'Декабрь. Капитан приказал топить печь шпангоутами: корабль нам больше не нужен. Куприянов спорил — сжечь корабль значит сжечь дом, — и ушёл на берег с девятью людьми, с лампами и жиром. Строить снежные дома. Я остался: на борту тепло и сытно.',
  n13_t: 'Лист 14 · Каюта капитана', n13_x: 'Январь. Корабельное дерево кончилось к середине ночи; печь остыла, жира нет. У Рындина отняли три пальца. С борта я вижу дым лампы Куприянова на берегу, тонкий, как нитка, и ровный. Они живы. Мы жгли доски и замёрзли. Они берегли огонь и живут.',
  n14_t: 'Лист 15 · Палуба', n14_x: 'Февраль. Выхожу к ним, пока могу идти. Дневник оставляю на палубе. Если читаешь это — запомни: огонь не бросать, снег — дом, жир — жизнь. Тепло не там, где много дров, а там, где мало дыр. Вельский.',
  s1_t: 'Запись 41 · Станция', s1_x: 'Запись 41. Рация встала ещё до ночи: сгорели лампа и катушка, села батарея. Об этом пока лучше не думать — сначала тепло и жир. Иду к лункам с гарпуном: кость с пляжа, от кита, плавник, верёвка и железка на жало. Вяжу прямо на столе в доме: у печки руки не мёрзнут.',
  s2_t: 'Запись 44 · Станция', s2_x: 'Запись 44. Лампу-триод я унёс на шхуну — греть в каюте, где печка. Дурак: лёд ушёл, назад не донёс. Катушка осталась в хижине шахтёров, аккумулятор под сугробом в дизельной. Антенную мачту сорвало; ставить заново: три доски (или кость) и две верёвки. Без мачты рация — ящик.',
  s3_t: 'Запись 46 · Дизельная', s3_x: 'Запись 46. Соляркой дом не топлю — угар. Но пустую бочку, если выбить дно топором, можно набить плавником и поставить жаровней: греет, как печь, только дыма больше. Лунки пробиваю пешнёй: две железки да плавник на древко. Лёд толще роста — рукой не возьмёшь.',
  readHere: 'Прочитано', unreadHint: 'Записка не прочитана',
});
const noteStr = (id: string, k: 't' | 'x') => (N as unknown as Record<string, string>)[`${id}_${k}`] ?? '';
export const noteTitle = (id: string) => noteStr(id, 't');
export const noteText = (id: string) => noteStr(id, 'x');
export const noteWho = (id: string) => (noteDef(id)?.who === 'keeper' ? N.who_keeper : N.who_doctor);
for (const n of NOTES) registerSource('item.note_' + n.id, 'Записка');
/** Item id of a note lying in the world / a chest → note id ('note_n3' → 'n3'), or ''. */
export const noteOfItem = (item: string) => (/^note_(.+)$/.exec(item)?.[1] ?? '');

// ---------------------------------------------------------------------------------------------------------------------
// techniques
export type TechKind = 'recipe' | 'tip' | 'skill';
export interface Tech { id: string; kind: TechKind; start?: boolean }
export const TECHS: Tech[] = [
  { id: 'campfire', kind: 'recipe', start: true }, { id: 'pot', kind: 'recipe', start: true }, { id: 'cooking', kind: 'recipe', start: true },
  { id: 'blocks', kind: 'skill', start: true }, { id: 'rope', kind: 'recipe', start: true },
  { id: 'lamp', kind: 'recipe' }, { id: 'torch', kind: 'recipe' }, { id: 'harpoon', kind: 'recipe' }, { id: 'ice_chisel', kind: 'recipe' },
  { id: 'fishing', kind: 'recipe' }, { id: 'snares', kind: 'recipe' }, { id: 'butchery', kind: 'recipe' }, { id: 'sewing', kind: 'recipe' },
  { id: 'parka', kind: 'recipe' }, { id: 'drying', kind: 'recipe' }, { id: 'hides', kind: 'recipe' }, { id: 'cache', kind: 'recipe' },
  { id: 'sled', kind: 'recipe' }, { id: 'mast', kind: 'recipe' },
  { id: 'vault', kind: 'tip' }, { id: 'dry_mittens', kind: 'tip' }, { id: 'vent', kind: 'tip' }, { id: 'snow_roll', kind: 'tip' },
  { id: 'methane', kind: 'tip' }, { id: 'brazier', kind: 'tip' },
];
export const techDef = (id: string) => TECHS.find(t => t.id === id);
/** Techniques that also (or only) come with experience: the self-test triggers each of them. */
export const EXPERIENCE = ['butchery', 'snow_roll', 'dry_mittens', 'vent', 'vault', 'cache', 'brazier', 'methane'];

const T = strings('tech', {
  campfire_n: 'Костёр', campfire_d: 'Два полена и ягель на растопку. На ветру пламя слабое — прикрывай его снегом или стеной.', campfire_h: '',
  pot_n: 'Котелок и талая вода', pot_d: 'Котелок собирается из жести. Над огнём в нём снег и лёд становятся водой; лёд даёт воды вдвое больше.', pot_h: '',
  cooking_n: 'Готовка на огне', cooking_d: 'Мясо и рыбу жарят на огне, чай заваривают в котелке. Горячая еда греет изнутри долго.', cooking_h: '',
  blocks_n: 'Снежные блоки', blocks_d: 'Снежным ножом вырезают блок 2×1 из плотного наста, 250–380 кг/м³. Рыхлый снег (< 220) рассыпается, слишком плотный (> 420) тяжёл и колок.', blocks_h: '',
  rope_n: 'Простая верёвка', rope_d: 'Парусину или жилы скручивают в верёвку.', rope_h: '',
  lamp_n: 'Жировая лампа', lamp_d: 'Мыльный камень (или жесть с парусиной), жир и фитиль из ягеля. Огонёк с ноготь согревает закрытый снежный дом, но нужна отдушина.', lamp_h: 'Кто-то зимовал здесь до тебя и знал, чем греться в снежном доме. Ищи записи у старого тура на мысу.',
  torch_n: 'Факел', torch_d: 'Плавник, капля жира или солярки и обрывок парусины: час света и немного тепла. Зверь его не любит.', torch_h: 'В шахте темно. Кто-то ходил там с огнём — записи лежат в штольне.',
  harpoon_n: 'Гарпун', harpoon_d: 'Кость, плавник, верёвка и железка на жало. Нужен для тюленя у лунки.', harpoon_h: 'Смотритель вёл журнал на станции. Там сказано, как охотиться на льду.',
  ice_chisel_n: 'Пешня', ice_chisel_d: 'Две железки и плавник на древко. Пробивает лунки, колет лёд и читает его толщину.', ice_chisel_h: 'Смотритель записывал про лёд и бочки в дизельной.',
  fishing_n: 'Леска с крючком', fishing_d: 'Костяной крючок и жила. Рыбу ловят у лунки или полыньи — голыми пальцами, а они мёрзнут.', fishing_h: 'На пляже, возле костей, кто-то записал, как ловить рыбу.',
  snares_n: 'Силки', snares_d: 'Верёвка и сучок на тундре у ягеля: куропатка попадётся сама, пока ты занят другим.', snares_h: 'Кто-то из шахтёров делился опытом с ловушками в хижине.',
  butchery_n: 'Разделка', butchery_d: 'Тюленя разделывают сразу, пока тёплый: мясо, жир, шкура и жилы. Из мяса и жил выходит нитка.', butchery_h: 'Придёт с первым тюленем.',
  sewing_n: 'Шитьё мехов', sewing_d: 'Рукавицы, камики и капюшон: шкура, мех и жила. Тонкая работа — на морозе пальцы теряют чувствительность.', sewing_h: 'Каюр шил возле больших костей на берегу.',
  parka_n: 'Меховая парка', parka_d: 'Три тюленьи шкуры, два песца и нитка потолще — или медвежья шкура. Самая тёплая одежда.', parka_h: 'Где-то во льдах записаны выкройки меховой парки.',
  drying_n: 'Сушилка', drying_d: 'Две жерди и верёвка: у огня мокрая одежда сохнет вдвое быстрее.', drying_h: 'В хижине шахтёров стоял огонь и сушились вещи.',
  hides_n: 'Шкуры и пологи', hides_d: 'Лежанка из шкур и ягеля не пускает холод снизу; полог из шкуры закрывает вход.', hides_h: 'В хижине под землёй кто-то заботился о тёплом сне.',
  cache_n: 'Каменный тайник', cache_d: 'Шесть камней над запасами — песец не доберётся.', cache_h: 'Кто-то уже терял еду из-за лисы. Или потеряешь ты.',
  sled_n: 'Нарты', sled_d: 'Четыре доски, две кости, ремни: один человек возит груз троих.', sled_h: 'Нарты собирали из корабельного дерева.',
  mast_n: 'Антенная мачта', mast_d: 'Три доски (или кость) и две верёвки: без мачты рация — просто ящик.', mast_h: 'Смотритель знал, чем кончилась рация. Загляни в дом.',
  vault_n: 'Снежный свод', vault_d: 'Три ряда блоков, и каждый следующий чуть внутрь (R — режим купола): свод держится без балок. Плоская крыша обрушится под своим снегом.', vault_h: '',
  dry_mittens_n: 'Сухие варежки', dry_mittens_d: 'Руки белеют первыми. Меняй мокрые рукавицы на сухие, сушись у огня, в пургу прячь руки за пазуху.', dry_mittens_h: '',
  vent_n: 'Отдушина', vent_d: 'Голова гудит, клонит в сон — это угар. В закрытом снежном доме с огнём пробей дырку в потолке; потолок тоньше — тяга лучше.', vent_h: '',
  snow_roll_n: 'Катайся в сухом снегу', snow_roll_d: 'Провалился — не отряхивайся. Выскочи на сухой снег и катайся: порошок вытягивает воду из меха. Потом к огню.', snow_roll_h: '',
  methane_n: 'Рудничный газ', methane_d: 'Сладковатый воздух и зелёное марево в забое. Огонь рядом — взрыв. Не выбивай стойки: над головой щебень на досках.', methane_h: '',
  brazier_n: 'Бочка-жаровня', brazier_d: 'Пустая бочка с выбитым дном и плавник внутри греют, как печь, но дымят.', brazier_h: '',
  howStart: 'знал с самого начала', howNote: 'из записки «{t}»', howExp: 'на опыте',
  expSeal: 'после первого тюленя', expFrost: 'после первого обморожения', expCO: 'после первой головной боли от угара', expSplash: 'после падения в воду',
  expVault: 'после трёх рядов блоков', expMethane: 'учуял газ в забое', expBrazier: 'сделал жаровню из бочки', expFox: 'после визита лисы', expOther: 'в деле',
  learned: 'Новый приём: {name}', noteRead: 'Прочитано: {title}',
  unknownTech: 'Ты пока не знаешь, как это делается',
});
const tstr = (id: string, k: 'n' | 'd' | 'h') => (T as unknown as Record<string, string>)[`${id}_${k}`] ?? '';
export const techName = (id: string) => tstr(id, 'n');
export const techDesc = (id: string) => tstr(id, 'd');
export const techHint = (id: string) => tstr(id, 'h');
export const unknownTechText = () => T.unknownTech;

// ---------------------------------------------------------------------------------------------------------------------
// state (saved with the quest state)
export type HowKind = 'start' | 'note' | 'exp';
export interface Learned { how: HowKind; ref: string; t: number }
export const lore = {
  known: new Map<string, Learned>(),
  read: new Map<string, number>(),         // note id -> game time first read
  probes: new Set<string>(),               // material facts learned by probing
  sealsCut: 0,
};
const frames = { courses: [] as { tx: number; ty: number }[] };
let expAcc = 0, seenAcc = 0;      // 4 Hz experience poll, 2.5 Hz map marking

export function resetLore() {
  lore.known.clear(); lore.read.clear(); lore.probes.clear(); lore.sealsCut = 0; frames.courses.length = 0;
  for (const t of TECHS) if (t.start) lore.known.set(t.id, { how: 'start', ref: '', t: 0 });
  expAcc = 0; seenAcc = 0;
}
resetLore();
export const knows = (id: string) => lore.known.has(id);
export function knownCount() { let n = 0; for (const t of TECHS) if (lore.known.has(t.id)) n++; return n; }

const playSfx = (name: string, vol = 0.8) => { try { sfx.play(name, { vol }); } catch { /* audio is optional */ } };

/** Learn a technique. Returns true if it was new (toast + journal entry (via 'tech_learned') + sound). */
export function learn(id: string, how: HowKind = 'exp', ref = '', quiet = false): boolean {
  if (lore.known.has(id) || !techDef(id)) return false;
  lore.known.set(id, { how, ref, t: G.time });
  if (!quiet) {
    toast(fmt(T.learned, { name: techName(id) }), 'good');
    playSfx('objective', 0.7);
  }
  emit('tech_learned', { id, how, ref });
  return true;
}
/** Test helper: know everything. */
export function learnAll() { for (const t of TECHS) learn(t.id, 'exp', '', true); }
/** Test helper: forget everything but the start kit. */
export function forgetAll() { const keep = TECHS.filter(t => t.start).map(t => t.id); for (const id of [...lore.known.keys()]) if (!keep.includes(id)) lore.known.delete(id); }

/** Read a note (once): learn what it teaches, log it. Returns true on the first reading. */
export function readNote(id: string): boolean {
  const nd = noteDef(id); if (!nd) return false;
  const first = !lore.read.has(id);
  if (first) {
    lore.read.set(id, G.time);
    toast(fmt(T.noteRead, { title: noteTitle(id) }), 'info');
    emit('note_read', { id });
  }
  for (const t of nd.teaches) learn(t, 'note', id);
  return first;
}
/** How a technique was learned, in plain words. */
export function howLearned(id: string): string {
  const l = lore.known.get(id); if (!l) return '';
  if (l.how === 'start') return T.howStart;
  if (l.how === 'note') return fmt(T.howNote, { t: noteTitle(l.ref) });
  const exp = ({ butchery: T.expSeal, dry_mittens: T.expFrost, vent: T.expCO, snow_roll: T.expSplash, vault: T.expVault, methane: T.expMethane, brazier: T.expBrazier, cache: T.expFox } as Record<string, string>)[id];
  return exp ?? T.howExp;
}

// notes found: the item becomes a journal page, not bag clutter
on('note_found', (d: { id: string }) => {
  const nid = noteOfItem(d.id);
  if (nid && noteDef(nid)) { readNote(nid); remove(d.id, 1); }
});

// ---- experience ----
on('seal_caught', () => { learn('butchery', 'exp'); });
on('picked', (d: { item: string }) => { if (d.item === 'seal_meat') learn('butchery', 'exp'); });
on('splash', () => { learn('snow_roll', 'exp'); });
on('fox_steal', () => { learn('cache', 'exp'); });
on('drum_brazier', () => { learn('brazier', 'exp'); });
on('placed', (d: { item?: string; x?: number; y?: number }) => {
  if (d.item !== 'snow_block' || d.x === undefined || d.y === undefined) return;
  const tx = Math.floor(d.x / TS), ty = Math.floor(d.y / TS);
  frames.courses.push({ tx, ty }); if (frames.courses.length > 40) frames.courses.shift();
  const rows = new Set<number>();
  for (const c of frames.courses) if (Math.abs(c.tx - tx) <= 8) rows.add(c.ty);
  const lo = ty; let run = 1; for (let k = 1; k < 3; k++) if (rows.has(lo + k) || rows.has(lo - k)) run++;
  if (rows.size >= 3 && run >= 2) learn('vault', 'exp');
});
on('new_game', () => resetLore());

/** Poll the body for first-time experiences (cheap, 4 Hz). */
function stepExperience(dt: number) {
  expAcc += dt; if (expAcc < 0.25) return; expAcc = 0;
  const p = G.player; if (!p || !p.alive) return;
  if (!lore.known.has('dry_mittens') && (p.frost.hands >= 40 || p.frost.feet >= 40 || p.frost.face >= 40)) learn('dry_mittens', 'exp');
  if (!lore.known.has('vent') && p.co >= 15) learn('vent', 'exp');
}

// ---------------------------------------------------------------------------------------------------------------------
// exploration map: tiles near the player become "seen"
export function markSeen(x: number, y: number, radiusTiles: number) {
  const cx = Math.floor(x / TS), cy = Math.floor(y / TS), r = radiusTiles, r2 = r * r;
  for (let ty = Math.max(0, cy - r); ty <= Math.min(TH - 1, cy + r); ty++) {
    for (let tx = Math.max(0, cx - r); tx <= Math.min(TW - 1, cx + r); tx++) {
      const dx = tx - cx, dy = ty - cy;
      if (dx * dx + dy * dy <= r2) seen[ty * TW + tx] = 1;
    }
  }
}
function stepSeen(dt: number) {
  seenAcc += dt; if (seenAcc < 0.4) return; seenAcc = 0;
  const p = G.player; if (!p) return;
  markSeen(p.x, p.y - 10, p.y > 290 && p.x < 420 ? 8 : 20);
}
export function seenCount() { let n = 0; for (let i = 0; i < seen.length; i++) n += seen[i]; return n; }

// ---------------------------------------------------------------------------------------------------------------------
// materials learned by probing (journal «Вещества»): what the cursor lingers on teaches a plain-language fact
export interface Fact { id: string; key: string; mat?: string }
const F = strings('fact', {
  SNOW_h: 'Свежий снег', SNOW_x: 'Рыхлый снег, 60–150 кг/м³: в нём больше воздуха, чем льда. Тепло держит, но нагрузки не держит: крыша из него обвалится, а нож не вырежет блока.',
  PACKED_h: 'Наст', PACKED_x: 'Наст — снег, спрессованный ветром или временем. Он плотнее и прочнее; 250–380 кг/м³ — лучший материал для блоков.',
  SNOWBLOCK_h: 'Снежный блок', SNOWBLOCK_x: 'Положенный блок спекается за 25–60 минут и срастается со стеной; пока не сросся, он слабее. Стена в два блока удерживает тепло лампы.',
  ICE_h: 'Лёд', ICE_x: 'Лёд проводит тепло в десять раз лучше снега и не греет. Зато он прозрачен, плавится в воду вдвое выгоднее снега, а морской лёд толще роста человека не пробить рукой.',
  WATER_h: 'Морская вода', WATER_x: 'Вода не замерзает до −1,9 °C. Упал — у тебя около 20 секунд, чтобы выбраться, дальше холодовой шок. Мокрое на морозе опаснее холода.',
  STONE_h: 'Камень', STONE_x: 'Камень держит что угодно, но тепло уходит в него быстро; руками его не взять — нужна кирка. Из него складывают тайник от лисы.',
  HARDROCK_h: 'Гранит', HARDROCK_x: 'Гранит плотнее камня, берётся долго и только киркой. Из него растут холмы мыса.',
  DIRT_h: 'Мёрзлая земля', DIRT_x: 'Вечная мерзлота: летом оттаивает на ладонь, зимой твёрже камня. Копается лопатой, но туго.',
  GRAVEL_h: 'Щебень', GRAVEL_x: 'Щебень сыплется, как песок, и копается лопатой. В обвале он перемешан с балками; из-под него торчит камень.',
  LOG_h: 'Брёвна', LOG_x: 'Плавник, крепь и доски — сухое дерево горит долго. Крепь держит кровлю: выбьешь стойку — потолок сядет.',
  WOOD_h: 'Плавник', WOOD_x: 'Выброшенное морем дерево: сухое, соль не даёт гнить. Главное топливо зимы.',
  PLANK_h: 'Доски', PLANK_x: 'Доски: каркас дома, настил, перекрытия. Горят вдвое быстрее брёвен.',
  WHALEBONE_h: 'Китовая кость', WHALEBONE_x: 'Лёгкая и прочная, перекроет пролёт, на котором дерево прогнулось бы. Рубится топором.',
  COAL_h: 'Уголь', COAL_x: 'Уголь греет вдвое дольше плавника. Мешки лежат в штольнях и вагонетках — копать его из стены нет нужды.',
  SOAPSTONE_h: 'Мыльный камень', SOAPSTONE_x: 'Мягкий, жирный на ощупь, не трескается от огня: из него делают жировую лампу.',
  METAL_h: 'Обшивка', METAL_x: 'Железо тянет тепло из руки: голой кожей к нему не прикасайся. Идёт на пешню и наконечники.',
  CANVAS_h: 'Парусина', CANVAS_x: 'Парусина — трут для огня, основа факела и верёвки. Ветер она режет вполсилы.',
  LICHEN_h: 'Ягель', LICHEN_x: 'Олений мох: сухой, горит сразу. Лучший трут и подстилка под шкуры.',
  GLASS_h: 'Стекло', GLASS_x: 'Стекло почти не держит тепла, но пропускает свет.',
  METHANE_h: 'Рудничный газ', METHANE_x: 'Сладковатый, лёгкий, взрывоопасный: пламя рядом — и он вспыхивает. В закрытом забое им нельзя дышать.',
  snowLoose_h: 'Рыхлый снег: нож бессилен', snowLoose_x: 'Ниже 220 кг/м³ блок рассыпается в руках. Ищи наст в затишье, под сугробом или у гряды.',
  snowGood_h: 'Хороший наст', snowGood_x: '250–380 кг/м³: режется ножом, ложится ровно и держит свод. Самый тёплый материал на мысу.',
  snowDense_h: 'Плотный наст', snowDense_x: 'Выше 420 кг/м³: блок выходит тяжёлым, колким и хуже греет. Для стены годится, но таскать его трудно.',
  iceThin_h: 'Тонкий лёд', iceThin_x: 'Новый лёд над полыньёй тоньше двух ладоней. Он трещит под ногами; пешня покажет толщину.',
  none: 'Пока пусто. Ходи по миру и разглядывай снег, лёд и камень: всё, на что подолгу смотришь, записывается сюда.',
});
const fstr = (k: string) => (F as unknown as Record<string, string>)[k] ?? '';
const FACT_MATS = ['SNOW', 'PACKED', 'SNOWBLOCK', 'ICE', 'WATER', 'STONE', 'HARDROCK', 'DIRT', 'GRAVEL', 'LOG', 'WOOD', 'PLANK', 'WHALEBONE', 'COAL', 'SOAPSTONE', 'METAL', 'CANVAS', 'LICHEN', 'GLASS', 'METHANE'];
export const FACTS: Fact[] = [
  ...FACT_MATS.map(k => ({ id: 'mat:' + k, key: k, mat: k })),
  { id: 'snow:loose', key: 'snowLoose' }, { id: 'snow:good', key: 'snowGood' }, { id: 'snow:dense', key: 'snowDense' }, { id: 'ice:thin', key: 'iceThin' },
];
export const factHead = (f: Fact) => fstr(f.key + '_h');
export const factText = (f: Fact) => fstr(f.key + '_x');
export const factNone = () => F.none;
export function probe(id: string): boolean { if (lore.probes.has(id)) return false; lore.probes.add(id); emit('fact_learned', { id }); return true; }
/** Called by quest.ts with the cursor target: material, snow density, ice thickness. */
export function probeTarget(tgt: { inReach: boolean; mat: number; density: number | null; iceCm: number | null }) {
  if (!tgt.inReach || !tgt.mat) return;
  const key = MATS[tgt.mat]?.key; if (!key) return;
  if (FACT_MATS.includes(key)) probe('mat:' + key);
  if (tgt.density !== null) probe(tgt.density < 220 ? 'snow:loose' : tgt.density <= 380 ? (tgt.density >= 250 ? 'snow:good' : 'snow:loose') : 'snow:dense');
  if (tgt.iceCm !== null && tgt.iceCm < 40) probe('ice:thin');
}

// ---------------------------------------------------------------------------------------------------------------------
export function stepLore(dt: number) {
  if (G.paused || !G.player) return;
  stepExperience(dt); stepSeen(dt);
}

// ---- save / load (rides on questSave) ----
function rle(a: Uint8Array): string {
  const out: number[] = []; let v = a[0] ?? 0, n = 0;
  for (let i = 0; i < a.length; i++) { if (a[i] === v) n++; else { out.push(n); v = a[i]; n = 1; } }
  out.push(n);
  return (a[0] ?? 0) + ':' + out.join(',');
}
function unrle(s: string, a: Uint8Array) {
  const [first, rest] = s.split(':'); let v = +first, i = 0; a.fill(0);
  for (const part of rest.split(',')) { const n = +part; if (v) a.fill(1, i, Math.min(a.length, i + n)); i += n; v ^= 1; }
}
export function loreSave() {
  return {
    known: [...lore.known.entries()].map(([id, l]) => [id, l.how, l.ref, l.t]),
    read: [...lore.read.entries()], probes: [...lore.probes], seen: rle(seen),
  };
}
export function loreLoad(s: any) {
  resetLore();
  if (!s) return;
  lore.known.clear();
  for (const [id, how, ref, t] of s.known ?? []) if (techDef(id)) lore.known.set(id, { how, ref, t });
  for (const t of TECHS) if (t.start && !lore.known.has(t.id)) lore.known.set(t.id, { how: 'start', ref: '', t: 0 });
  for (const [id, t] of s.read ?? []) lore.read.set(id, t);
  for (const p of s.probes ?? []) lore.probes.add(p);
  if (typeof s.seen === 'string') try { unrle(s.seen, seen); } catch { /* corrupt map: start blank */ }
}
