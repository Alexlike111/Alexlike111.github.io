// Objectives (DESIGN §9 + §18 ENDLESS). One line, always visible. Day-1 onboarding chain: coal (diesel shed) -> door -> stove -> barometer -> read
// the keeper's log -> shelter (>= 2 stars, built outside the station) -> read the doctor's diary at the cairn. After it the line is a rotating
// «next sensible thing» computed from the game state (fuel for the next storm, food stock, shelter grade, undiscovered sites / notes, something
// not yet crafted, the old open goals: seal, driftwood, ship, radio ...). Nothing ever ends the game except death. Radio -> the icebreaker (optional):
// radio repaired -> 2 game days later it arrives; the signal fire / a flare calls it in, it passes, drops a supply crate near the cape and leaves
// (once per ring). Milestone toasts (5/10/20/30/50 days, first ring, first twilight), 'goal_done' per goal, 'win' for first-time wins, site
// discovery ('site_found'), run statistics for the death card, objectiveTarget() (world cell of the current goal) for the HUD arrow.
import { G, toast } from './state';
import { emit, on } from './bus';
import { strings, fmt } from '../content/i18n';
import { count, spawnDrop } from './inventory';
import { fuelMinutes, itemName as itemNameFn } from './items';
import { nextStorm as nextStormFn } from './weather';
import { siteAt, LOC, worldInfo, sites } from './locations';
import { RECIPES } from './recipes';
import { NOTES } from './lore';
import { phaseName, rampAt } from './seasons';
import { driftSnapshot } from './drift';
import { body } from './player';
import { TS, W, mat } from '../engine/grid';
import { MAT } from '../content/materials';
import { DOOR } from './snowpack';
import { knows, lore, stepLore, probeTarget, loreSave, loreLoad, noteTitle, techName } from './lore';
import { target } from './tools';
import { boxFree } from '../engine/phys';
import { stepMine, resetMine } from './mine';
export { knows, learn, learnAll, forgetAll, lore, readNote, TECHS, NOTES, techName, techDesc, techHint, howLearned, noteTitle, noteText, noteWho, FACTS, factHead, factText, probe, seenCount, markSeen } from './lore';

const S = strings('quest', {
  // HUD line (one short sentence); the long text (…D) is for the journal's «Цели» tab (goalDetail)
  coal: 'Подбери уголь у дизельной', coalD: 'Подбери уголь у дизельной: подойди, он сам подберётся',
  coalM: ' · {m} м',
  buried: ' · копай снег', buriedD: ' · уголь под снегом: копай лопатой (действие)',
  door: 'Откопай дверь лопатой (слот 2)', doorD: 'Откопай дверь дома: лопата (слот 2), копай вниз у стены — ступенями, чтобы выбраться',
  stove: 'Растопи печь спичками', stoveD: 'Растопи печь спичками: войди в дом, встань у печи и зажги её (действие)',
  baro: 'Проверь барометр у столба', baroD: 'Проверь барометр: подойди к столбу западнее дома (действие)',
  keeper: 'Прочти журнал смотрителя', keeperD: 'Прочти журнал смотрителя: сундук-полка в доме',
  shelter: 'Построй иглу из снежных блоков', shelterN: 'Построй иглу из снега · Блоков {n}/10', shelterD: 'Утепли жильё до ★★: иглу из снежных блоков вне станции (плотный наст — снежное поле к западу, у холма)',
  fish: 'Поймай рыбу или куропатку', fishD: 'Поймай рыбу в лунке или куропатку: подкрадись медленно и ударь (или поставь силок)',
  sleep: 'Переночуй в тепле', sleepD: 'Переночуй в тепле: в укрытии ★★ или в доме у печи (сон не меньше 3 ч)',
  warm: 'Согрейся: печка в доме', warmD: 'Тебе холодно на улице: иди в дом к печке (стрелка на дверь станции), растопи её',
  winFish: 'Улов на ужин! Голод отступил', winSleep: 'Выспался в тепле: силы вернулись',
  diary: 'Найди дневник доктора', diaryD: 'Прочти дневник доктора в жестянке у старого тура на западе от станции',
  supplies: 'Запаси топливо и еду', suppliesD: 'Запасы: топливо {fuel} ч · еда {food} дн. (цель: 72 ч и 8 дн.)',
  seal: 'Добудь жир: тюлень у лунки', sealD: 'Найди жир: тюлени у лунок на льду (стой тихо, бей гарпуном)',
  sealLearn: 'Узнай, как вязать гарпун', sealLearnD: 'Узнай, как вязать гарпун: журнал смотрителя в доме',
  wood: 'Собери плавник: {n}/{m}', woodD: 'Собери плавник на пляже: брёвна {n}/{m}',
  ship: 'Найди шхуну «Заря»', shipD: 'Найди шхуну «Заря» среди дрейфующих льдов',
  radio: 'Почини рацию: деталей {n}/3', radioD: 'Вставь детали в рацию: {n}/3 (действие у рации)',
  mast: 'Подними мачту, запусти рацию', mastD: 'Подними мачту и запусти рацию',
  mastLearn: 'Узнай, как ставить мачту', mastLearnD: 'Узнай про мачту: записи смотрителя в доме, у стола',
  fur: 'Сшей меховую одежду', furD: 'Сшей меховую одежду (шкуры, жилы)',
  furLearn: 'Узнай, как шить мех', furLearnD: 'Узнай, как шить мех: ищи записи на берегу, у костей кита',
  radioOk: 'Рация готова: жди ледокол',
  wait: 'Ледокол: {d}', waitD: 'Ледокол: {d} · сигнал: 2 полена, ягель, спички',
  light: 'Зажги сигнальный костёр!',
  rescued: 'Огонь замечен: ледокол идёт',
  missed: 'Ледокол прошёл мимо',
  low: 'Запасы на исходе',
  nxFuel: 'Запаси топлива к пурге',
  nxFuelLow: 'Топлива мало: добудь уголь',
  nxFood: 'Добудь еды: охота или рыба',
  nxShelter: 'Укрытие получше: ★★★',
  nxSites: 'Исследуй мир',
  nxNotes: 'Найди записки экспедиции',
  nxCraft: 'Сделай: {name}',
  nxIdle: 'Выживай: {phase}',
  nxCrate: 'Забери ящик у мыса',
  phNight: 'ночь', phTwi: 'сумерки',
  msDays: 'Выжил {n} дн.', msRing: 'Круг {c} пройден', msTwilight: 'Первые сумерки: светлеет',
  crateT: 'Ледокол сбросил ящик у мыса', crateNote: 'Записка на ящике: «Держитесь. Вернёмся с тем же курсом».',
  storm: 'Переживи пургу в укрытии', stormD: 'Переживи пургу: укрытие ★★ во время шторма',
  parka: 'Сшей меховую парку', parkaD: 'Сшей меховую парку (тюлень ×3, песец ×2, жилы ×2)',
  seals3: 'Добудь тюленя: {n}/3', seals3D: 'Добудь тюленя ×3: {n}/3 (у лунок стой тихо, бей гарпуном)',
  storm2: 'Переживи большую пургу', storm2D: 'Переживи большую пургу ★★★ (укрытие с отдушиной)',
  done: 'Сделано!',
  milestoneBlock: 'Первый блок вырезан', milestoneCraft: 'Первая вещь сделана',
  days: '{n} дн.', hours: '{n} ч', soon: 'меньше часа',
  found: 'Найдено: {name}',
  jKnow: 'Новый приём: {name}', jRead: 'Записка: {title}',
  arrival: 'Ледокол на горизонте!',
});

export interface Goal { id: string; text: () => string; done: () => boolean; win?: () => string /* own toast when it turns done */ }
const done = new Set<string>();
export const runStats = { seals: 0, storms: 0, bestStars: 0, stormStars: 0, fires: 0, crafts: 0, blocks: 0, bears: 0, notes: 0, coldest: 99, placed: 0, hunted: 0, fish: 0, birds: 0, blocksOut: 0 };
export const questState = {
  icebreakerAt: -1, iceArrivedAt: -1, iceDeadline: -1, rescueAt: -1, ended: '' as '' | 'dawn' | 'icebreaker' /* legacy: never set, the game is endless */, radioFixed: false, lit: false,
  crateRing: -1,      // ring of the icebreaker's last supply drop (one per ring)
};

export function suppliesNow() {
  let fuelMin = 0, food = 0, water = 0;
  const addItem = (id: string, n: number) => {
    fuelMin += n * Math.max(fuelMinutes(id, 'stove'), id === 'fat' ? fuelMinutes(id, 'lamp') * 0.6 : 0);
  };
  for (const id of ['coal', 'log', 'plank', 'fat']) addItem(id, count(id));
  // home stocks: your own caches and the station's shelves/chests (not the ship or the mine)
  const home = (f: { kind: string; tx: number; tw: number }) => f.kind === 'cache' || (f.tx * TS >= LOC.station.x0 && f.tx * TS <= LOC.station.x1);
  for (const f of G.fixtures) {
    if (f.items && home(f)) for (const s of f.items) { if (['coal', 'log', 'plank', 'fat'].includes(s.id)) addItem(s.id, s.n); }
  }
  const FOOD: Record<string, number> = { can: 30, biscuit: 12, seal_meat: 16, cooked_meat: 28, fish: 10, fish_cooked: 20, ptarmigan: 12, fat: 14 };
  for (const id in FOOD) { food += count(id) * FOOD[id]; }
  for (const f of G.fixtures) if (f.items && home(f)) for (const s of f.items) if (FOOD[s.id]) food += s.n * FOOD[s.id];
  water += count('water') * 26 + count('snow') * 6 + count('ice') * 12;
  return { fuelH: Math.round(fuelMin / 6) / 10, foodDays: Math.round(food / 50 * 10) / 10, water };
}
const suppliesOk = () => { const s = suppliesNow(); return s.fuelH >= 72 && s.foodDays >= 8; };      // a comfortable stock (three days of fuel, eight of food)

const flags = new Set<string>();
const wins = new Set<string>();
/** Goal flags shown by the journal (ui/devhud). parts = radio parts inserted, ending = null | 'dawn' | 'icebreaker'. */
export const prog = { fire: false, baro: false, shelter: false, sleep: false, parts: [] as string[], mast: false, radio: false, ending: null as null | 'dawn' | 'icebreaker' /* legacy, unused */ };
export interface JournalEntry { kind: 'note' | 'storm' | 'site' | 'event' | 'know'; text: string; t: number }
export const journal: JournalEntry[] = [];
function log(kind: JournalEntry['kind'], text: string) { if (journal.length < 200) journal.push({ kind, text, t: G.time }); }
export const objective = () => objectiveText();
/** Radio parts inserted into the radio (not merely carried): the radio's own record. */
function radioParts(): number {
  const r = G.fixtures.find(f => f.kind === 'radio');
  return Math.min(3, (r?.data?.have as string[] | undefined)?.length ?? 0);
}
const inStation = () => { const p = G.player; return !!p && p.x >= LOC.station.x0 && p.x <= LOC.station.x1; };
/** A shelter counts only when the player built it outside the station (>= 3 placed blocks/cells). */
const builtOutside = () => runStats.placed >= 3 && !inStation();
/** Coal sack nearest to the player (world cells), or null. */
function nearestCoal(): { x: number; y: number } | null {
  const p = G.player; if (!p) return null;
  let best: { x: number; y: number } | null = null, bd = Infinity;
  for (const d of G.drops) if (d.item === 'coal') { const dd = Math.hypot(d.x - p.x, d.y - p.y); if (dd < bd) { bd = dd; best = { x: d.x, y: d.y }; } }
  return best;
}
/** Snow (loose or packed) in the cell: a sack in it is buried (a fallen mast beam is not snow). */
const buriedAt = (x: number, y: number) => { const i = Math.floor(y) * W + Math.floor(x); return i >= 0 && i < mat.length && (mat[i] === MAT.SNOW || mat[i] === MAT.PACKED); };
/** The coal sack the walker can reach fastest (a wall in between skips it), with its distance in cells: refreshed by coalWatch (0.5 s). */
let coalSpot: { x: number; y: number; d: number } | null = null;
/** Walk the body box (8 wide, 20 high, feet-centre) along the ground from (x0, y0) to column x1: steps up to 6 cells up or down, no wall. Returns the stand row or null. */
function walkTo(x0: number, y0: number, x1: number): number | null {
  const dir = x1 >= x0 ? 1 : -1, n = Math.round(Math.abs(x1 - x0));
  let y = Math.round(y0);
  for (let k = 0; k <= n; k++) {
    const x = Math.round(x0 + dir * k);
    let stand = -1;
    for (let yy = y + 6; yy >= y - 6; yy--) if (boxFree(x, yy, 8, 20) && !boxFree(x, yy + 1, 8, 20)) { stand = yy; break; }
    if (stand < 0) return null;
    y = stand;
  }
  return y;
}
function coalWatch() {
  const p = G.player; coalSpot = null;
  if (!p || !p.alive) return;
  const cs = G.drops.filter(d => d.item === 'coal').map(d => ({ d, dd: Math.hypot(d.x - p.x, d.y - p.y) })).filter(c => c.dd < 400).sort((a, b) => a.dd - b.dd);
  for (const { d, dd } of cs) {
    const y = walkTo(p.x, p.y, d.x);
    if (y !== null && Math.abs(y - d.y) <= 8) { coalSpot = { x: d.x, y: d.y, d: dd }; return; }
  }
}
function coalText(): string {
  const p = G.player, c = coalSpot ?? (p ? (() => { const n = nearestCoal(); return n ? { ...n, d: Math.hypot(n.x - p.x, n.y - p.y) } : null; })() : null);
  return S.coal + (c ? fmt(S.coalM, { m: Math.max(1, Math.round(c.d * 0.09)) }) : '') + (c && buriedAt(c.x, c.y) ? S.buried : '');
}
/** Inside the house (the warm room, same box as the door watch) or in a closed shelter. */
function indoors(): boolean {
  const p = G.player; if (!p) return false;
  if (G.shelter?.closed) return true;
  return p.x > LOC.house.L * 4 + 4 && p.x < LOC.house.R * 4 && p.y > LOC.station.y - 30 && p.y <= LOC.station.y + 2;
}
/** Cold guidance (playtest v13): core below 35.5 °C outdoors with no fire lit within 30 cells replaces the goal line by «Согрейся». */
function coldGoal(): boolean {
  const p = G.player;
  if (!p || !p.alive || p.core >= 35.5 || indoors()) return false;
  for (const f of G.fixtures) if (f.lit && Math.hypot((f.tx + f.tw / 2) * TS - p.x, (f.ty + f.th / 2) * TS - p.y) < 30) return false;
  return true;
}
/** The station's nearest door (the warm room): the arrow of the cold, sleep and fire goals. */
function stationDoor(): { x: number; y: number } | null {
  const p = G.player; if (!p) return null;
  let best: { x: number; y: number } | null = null, bd = Infinity;
  for (const f of G.fixtures) {
    if (f.kind !== 'door' && f.kind !== 'hide_door') continue;
    const x = (f.tx + f.tw / 2) * TS, y = (f.ty + f.th / 2) * TS, dd = Math.hypot(x - p.x, y - p.y);
    if (f.tx * TS >= LOC.station.x0 && f.tx * TS <= LOC.station.x1 && dd < bd) { bd = dd; best = { x: Math.round(x), y: Math.round(y) }; }
  }
  return best;
}
/** The dense lee snow field west of the station (snowpack.ts: 1.5-2 m of wind-packed snow, outside LOC.station): the arrow of the shelter goal. */
const SNOW_FIELD = { x: 522, y: 238 };
export const GOALS: Goal[] = [
  { id: 'coal', text: coalText, done: () => flags.has('coal') || count('coal') > 0 || flags.has('stove') },
  // DESIGN §13: the east door of the house is buried under the lee drift at the start. A soft step: done by digging it out, by walking in through the other
  // (west) door, or by lighting the stove; it never blocks the chain.
  { id: 'door', text: () => S.door, done: () => flags.has('door') || flags.has('stove') },
  { id: 'stove', text: () => S.stove, done: () => flags.has('stove') },
  { id: 'baro', text: () => S.baro, done: () => flags.has('baro') || count('barometer') > 0 },
  { id: 'keeper', text: () => S.keeper, done: () => lore.read.has('s1') },
  { id: 'shelter', text: () => fmt(S.shelterN, { n: Math.min(10, runStats.blocksOut) }), done: () => flags.has('shelter') },
  // two short mini-goals after the igloo, before the diary: a catch and a warm night (each with its own win toast)
  { id: 'fish', text: () => S.fish, done: () => runStats.fish > 0 || runStats.birds > 0, win: () => S.winFish },
  { id: 'sleep', text: () => S.sleep, done: () => flags.has('warmsleep'), win: () => S.winSleep },
  { id: 'diary', text: () => S.diary, done: () => lore.read.has('n1') },
  { id: 'supplies', text: () => S.supplies, done: () => suppliesOk() },
  { id: 'seal', text: () => (knows('harpoon') ? S.seal : S.sealLearn), done: () => runStats.seals > 0 },
  { id: 'wood', text: () => fmt(S.wood, { n: Math.min(6, count('log')), m: 6 }), done: () => count('log') >= 6 || flags.has('wood') },
  { id: 'ship', text: () => S.ship, done: () => flags.has('ship') },
  { id: 'radio', text: () => fmt(S.radio, { n: radioParts() }), done: () => radioParts() >= 3 },
  { id: 'mast', text: () => (knows('mast') ? S.mast : S.mastLearn), done: () => questState.radioFixed },
  { id: 'fur', text: () => (knows('sewing') ? S.fur : S.furLearn), done: () => flags.has('fur') },
  { id: 'storm', text: () => S.storm, done: () => runStats.storms >= 1 && runStats.stormStars >= 2 },
  { id: 'parka', text: () => S.parka, done: () => flags.has('parka') },
  { id: 'seals3', text: () => fmt(S.seals3, { n: Math.min(3, runStats.seals) }), done: () => runStats.seals >= 3 },
  { id: 'storm2', text: () => S.storm2, done: () => runStats.storms >= 3 && runStats.stormStars >= 3 },
];

type Step = { id: string; text: string; goal?: string };
const CHAIN = GOALS.findIndex(g => g.id === 'supplies');          // goals before this index form the day-1 onboarding chain
const ROTATE_MIN = 240;                                             // game minutes between rotations of the «next sensible thing» line

/** Results the player has made (from 'crafted'). */
const craftedIds = new Set<string>();
/** The rotating «next sensible thing» candidates, most urgent first (urgent ones pin the line). */
function suggestions(): { step: Step; urgent: boolean }[] {
  const out: { step: Step; urgent: boolean }[] = [];
  const sp = suppliesNow();
  if (sp.fuelH < 12 || sp.foodDays < 1) out.push({ step: { id: 'low', text: fmt(S.low, { fuel: sp.fuelH, food: sp.foodDays }) }, urgent: true });
  // fuel for the next storm: it burns about its length in hours
  const ns = nextStormFn();
  if (ns && ns.start - G.time < 30 * 60) {
    const need = Math.ceil(ns.dur / 60 * 0.8), hrs = Math.max(0, Math.round((ns.start - G.time) / 60));
    if (sp.fuelH < need) out.push({ step: { id: 'nxfuel', text: fmt(S.nxFuel, { h: hrs, need, fuel: sp.fuelH }) }, urgent: sp.fuelH < need * 0.6 });
  }
  if (sp.fuelH < 30) out.push({ step: { id: 'nxfuel2', text: fmt(S.nxFuelLow, { fuel: sp.fuelH }) }, urgent: false });
  if (sp.foodDays < 3) out.push({ step: { id: 'nxfood', text: fmt(S.nxFood, { d: sp.foodDays }), goal: 'seal' }, urgent: sp.foodDays < 1.5 });
  const crate = crateDrops();
  if (crate) out.push({ step: { id: 'crate', text: S.nxCrate }, urgent: false });
  // the old open goals (seal, driftwood, ship, radio, mast, fur, storms, parka ...)
  for (let k = CHAIN + 1; k < GOALS.length; k++) { const g = GOALS[k]; if (!g.done()) { out.push({ step: { id: g.id, text: g.text() }, urgent: false }); break; } }
  if (runStats.bestStars < 3) out.push({ step: { id: 'nxshelter', text: S.nxShelter }, urgent: false });
  const found = sites.filter(x => x.found).length;
  if (found < sites.length) out.push({ step: { id: 'nxsites', text: fmt(S.nxSites, { n: found, m: sites.length }) }, urgent: false });
  if (lore.read.size < NOTES.length) out.push({ step: { id: 'nxnotes', text: fmt(S.nxNotes, { n: lore.read.size, m: NOTES.length }) }, urgent: false });
  const rec = RECIPES.find(r => knows(r.tech) && !craftedIds.has(r.result));
  if (rec) out.push({ step: { id: 'nxcraft', text: fmt(S.nxCraft, { name: itemNameFn(rec.result) }) }, urgent: false });
  if (!out.length) out.push({ step: { id: 'free', text: fmt(S.nxIdle, { phase: phaseName() === 'night' ? S.phNight : S.phTwi, d: G.day }) }, urgent: false });
  return out;
}
/** Supply drops of the icebreaker still lying near the cape. */
function crateDrops(): boolean { return questState.crateRing === G.cycle && G.drops.some(d => (d.item === 'flare' || d.item === 'can') && Math.abs(d.x - LOC.summit.x) < 120); }

/** The line shown top-centre, with the goal id it belongs to (for objectiveTarget). */
function activeStep(): Step | null {
  const q = questState;
  if (q.iceDeadline > 0 && G.time < q.iceDeadline && q.iceArrivedAt > 0 && G.time >= q.iceArrivedAt) return q.lit ? { id: 'rescued', text: S.rescued } : { id: 'light', text: S.light };
  if (coldGoal()) return { id: 'warm', text: S.warm };
  // the day-1 onboarding chain first (coal, door, stove, barometer, keeper's log, shelter, diary)
  const early = GOALS.slice(0, CHAIN);
  for (const g of early) if (!g.done()) {
    if (q.icebreakerAt > 0) break;
    return { id: g.id, text: g.text() };
  }
  const sg = suggestions();
  const urgent = sg.find(x => x.urgent);
  let pick: { step: Step; urgent: boolean };
  if (urgent) pick = urgent;
  else {
    const rot = Math.floor(G.time / ROTATE_MIN) % sg.length;
    pick = sg[rot];
  }
  let text = pick.step.text;
  if (q.icebreakerAt > 0) {
    const left = q.icebreakerAt - G.time;
    const d = left > 1440 ? fmt(S.days, { n: Math.ceil(left / 1440) }) : left > 60 ? fmt(S.hours, { n: Math.ceil(left / 60) }) : S.soon;
    text = fmt(S.wait, { d }) + '  ·  ' + text;
  }
  return { ...pick.step, text };
}
export function objectiveText(): string { return activeStep()?.text ?? ''; }
/** Id of the goal the line shows now (the HUD flashes the line when it changes). */
export function activeGoalId(): string { return activeStep()?.id ?? ''; }
/** The long text of a goal (journal «Цели» tab): where it is, what to do in detail. The HUD line stays one short sentence. */
const DETAIL: Record<string, () => string> = {
  coal: () => S.coalD + (nearestCoal() && buriedAt(nearestCoal()!.x, nearestCoal()!.y) ? S.buriedD : ''),
  door: () => S.doorD, stove: () => S.stoveD, baro: () => S.baroD, keeper: () => S.keeperD, shelter: () => S.shelterD, diary: () => S.diaryD,
  supplies: () => { const s = suppliesNow(); return fmt(S.suppliesD, { fuel: s.fuelH, food: s.foodDays }); },
  fish: () => S.fishD, sleep: () => S.sleepD, warm: () => S.warmD,
  seal: () => (knows('harpoon') ? S.sealD : S.sealLearnD), wood: () => fmt(S.woodD, { n: Math.min(6, count('log')), m: 6 }), ship: () => S.shipD,
  radio: () => fmt(S.radioD, { n: radioParts() }), mast: () => (knows('mast') ? S.mastD : S.mastLearnD), fur: () => (knows('sewing') ? S.furD : S.furLearnD),
  storm: () => S.stormD, parka: () => S.parkaD, seals3: () => fmt(S.seals3D, { n: Math.min(3, runStats.seals) }), storm2: () => S.storm2D,
};
export function goalDetail(id: string): string { return DETAIL[id]?.() ?? ''; }
/** The icebreaker's wait with the signal recipe (journal), or '' when no ship is called. */
export function waitDetail(): string {
  const q = questState; if (!(q.icebreakerAt > 0)) return '';
  const left = q.icebreakerAt - G.time;
  const d = left > 1440 ? fmt(S.days, { n: Math.ceil(left / 1440) }) : left > 60 ? fmt(S.hours, { n: Math.ceil(left / 60) }) : S.soon;
  return fmt(S.waitD, { d });
}
export function currentGoalId(): string { for (const g of GOALS) if (!g.done()) return g.id; return 'free'; }
/** Steps of the rotating line right now (tests). */
export function suggestionList(): string[] { return suggestions().map(x => x.step.id); }

/** World cell (x, y) of the place the current line is about (HUD arrow), or null when there is none. */
export function objectiveTarget(): { x: number; y: number } | null {
  const s = activeStep(); const p = G.player;
  if (!s || !p) return null;
  const key = s.goal ?? s.id;
  const pick = (pts: { x: number; y: number }[]) => {
    let best: { x: number; y: number } | null = null, bd = Infinity;
    for (const q of pts) { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = q; } }
    return best ? { x: Math.round(best.x), y: Math.round(best.y) } : null;
  };
  const fixture = (kind: string) => { const f = G.fixtures.find(o => o.kind === kind); return f ? { x: (f.tx + f.tw / 2) * TS, y: (f.ty + f.th / 2) * TS } : null; };
  const note = (id: string) => { const n = worldInfo.notes.find(o => o.id === id); return n ? { x: n.x, y: n.y } : null; };
  switch (key) {
    case 'coal': return coalSpot ? { x: Math.round(coalSpot.x), y: Math.round(coalSpot.y) } : pick(G.drops.filter(d => d.item === 'coal'));
    case 'warm': case 'sleep': return stationDoor();
    case 'fish': return pick(worldInfo.sealHoles);
    case 'door': return DOOR.crest > 0 ? { x: DOOR.x0 + 2, y: DOOR.y1 - 6 } : null;
    case 'stove': return fixture('stove');
    case 'shelter': return SNOW_FIELD;
    case 'baro': return worldInfo.spots.barometer ? { x: worldInfo.spots.barometer.x, y: worldInfo.spots.barometer.y } : null;
    case 'keeper': return note('s1');
    case 'diary': return note('n1') ?? { x: worldInfo.spots.cairn.x, y: worldInfo.spots.cairn.y };
    case 'seal': return knows('harpoon') ? pick(worldInfo.sealHoles) : note('s1');
    case 'seals3': return pick(worldInfo.sealHoles);
    case 'wood': return pick(worldInfo.driftwood);
    case 'ship': { const sh = sites.find(x => x.key === 'ship'); return sh ? { x: sh.x, y: sh.y } : null; }
    case 'radio': return fixture('radio');
    case 'mast': return knows('mast') ? { x: worldInfo.spots.mast.x, y: worldInfo.spots.mast.y } : note('s2');
    case 'fur': return { x: worldInfo.spots.whale.x, y: worldInfo.spots.whale.y };
    case 'crate': return pick(G.drops.filter(d => d.item === 'flare' || d.item === 'can'));
    case 'light': case 'rescued': return { x: worldInfo.spots.signalFire.x, y: worldInfo.spots.signalFire.y };
    default: return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
export function resetQuest() {
  done.clear(); flags.clear(); wins.clear(); journal.length = 0;
  Object.assign(prog, { fire: false, baro: false, shelter: false, sleep: false, mast: false, radio: false, ending: null }); prog.parts.length = 0;
  Object.assign(runStats, { seals: 0, storms: 0, bestStars: 0, stormStars: 0, fires: 0, crafts: 0, blocks: 0, bears: 0, notes: 0, coldest: 99, placed: 0, hunted: 0, fish: 0, birds: 0, blocksOut: 0 });
  coalSpot = null;
  Object.assign(questState, { icebreakerAt: -1, iceArrivedAt: -1, iceDeadline: -1, rescueAt: -1, ended: '', radioFixed: false, lit: false, crateRing: -1 });
  craftedIds.clear();
  siteAcc = 0; winAcc = 0; lastDone = null; doorAcc = 0; doorT = 0; doorHinted = false;
}
let loaded: any = null;
export function initQuest() { /* event wiring happens at import time; kept for the HUD's init call */ }
export const takeLoaded = () => { const l = loaded; loaded = null; return l; };
export const peekLoaded = () => loaded;
on('new_game', () => { resetQuest(); resetMine(); });
/** Saved with the game (save.ts): goal flags, run statistics, the icebreaker schedule, journal, and the drift of the pack ice. */
export function questSave() {
  return { crafted: [...craftedIds], flags: [...flags], wins: [...wins], prog: { ...prog, parts: [...prog.parts] }, stats: { ...runStats }, q: { ...questState }, journal: journal.slice(-120), drift: driftSnapshot(), lore: loreSave() };
}
export function questLoad(s: any) {
  if (!s) return;
  resetQuest();
  for (const f of s.flags ?? []) flags.add(f);
  for (const w of s.wins ?? []) wins.add(w);
  Object.assign(prog, s.prog ?? {}); prog.parts = [...(s.prog?.parts ?? [])];
  Object.assign(runStats, s.stats ?? {}); Object.assign(questState, s.q ?? {});
  questState.ended = ''; prog.ending = null;                 // old saves that ended (dawn / icebreaker) continue as endless
  for (const c of s.crafted ?? []) craftedIds.add(c);
  for (const e of s.journal ?? []) journal.push(e);
  loreLoad(s.lore);
  loaded = s;
}
on('fire_lit', (d: { kind: string }) => { runStats.fires++; if (d.kind === 'stove') { flags.add('stove'); prog.fire = true; } });
on('barometer', () => { flags.add('baro'); prog.baro = true; });
on('door_dug', () => { flags.add('door'); });
on('shelter', (d: { stars: number; closed: boolean }) => {
  if (d.closed && d.stars >= 2 && builtOutside()) { flags.add('shelter'); prog.shelter = true; }
  runStats.bestStars = Math.max(runStats.bestStars, d.closed ? d.stars : 0);
});
on('seal_caught', () => { runStats.seals++; runStats.hunted++; });
on('bird_caught', () => { runStats.birds++; });
on('fish_caught', () => { runStats.fish++; runStats.hunted++; });
on('snare_caught', () => { runStats.hunted++; runStats.birds++; });
on('storm_end', (d: { report?: { stars: number; text?: string } }) => {
  runStats.storms++;
  if (d.report) { runStats.bestStars = Math.max(runStats.bestStars, d.report.stars); runStats.stormStars = Math.max(runStats.stormStars, d.report.stars); if (d.report.text) log('storm', d.report.text); }
});
on('slept', (d: { hours: number }) => { if (d.hours >= 3) { prog.sleep = true; if (indoors()) flags.add('warmsleep'); } });
on('radio_part', (d: { id: string }) => { if (!prog.parts.includes(d.id)) prog.parts.push(d.id); });
on('mast_up', () => { prog.mast = true; });
on('site_found', (d: { key: string }) => { if (d.key === 'ship') flags.add('ship'); log('site', fmt(S.found, { name: sites.find(x => x.key === d.key)?.name ?? d.key })); });
on('crafted', (d: { id: string }) => {
  runStats.crafts++; craftedIds.add(d.id);
  if (/^fur_|^kamiks$/.test(d.id)) flags.add('fur');
  if (d.id === 'fur_parka') flags.add('parka');
  win('craft', S.milestoneCraft);
});
on('cut_block', () => { runStats.blocks++; win('block', S.milestoneBlock); });
on('placed', (d: { item?: string }) => { if (!inStation()) { runStats.placed++; if (d.item === 'snow_block') runStats.blocksOut++; } });
on('bear_seen', () => { runStats.bears++; });
on('note_read', (d: { id: string }) => { runStats.notes++; log('note', fmt(S.jRead, { title: noteTitle(d.id) })); });
on('tech_learned', (d: { id: string; how: string }) => { if (d.how !== 'start') log('know', fmt(S.jKnow, { name: techName(d.id) })); });
on('picked', (d: { item: string }) => {
  if (d.item === 'log' && count('log') >= 6) flags.add('wood');
  if (d.item === 'coal') flags.add('coal');
});

on('radio_fixed', () => {
  prog.radio = true; log('event', S.radioOk);
  questState.radioFixed = true;
  questState.icebreakerAt = G.time + 2 * 1440;
});
// ONB flare: a shot near the signal fire while the icebreaker is in sight lights it (same as the fire itself)
on('flare', (d: { x: number; y: number }) => {
  const q = questState;
  if (q.ended || q.lit || !(q.iceArrivedAt > 0 && G.time < q.iceDeadline)) return;
  const sf = G.fixtures.find(f => f.kind === 'signal_fire');
  if (!sf) return;
  if (Math.hypot(d.x - (sf.tx + sf.tw / 2) * TS, d.y - (sf.ty + sf.th / 2) * TS) > 160) return;
  sf.lit = true; sf.fuel = Math.max(sf.fuel ?? 0, 200);
  q.lit = true; q.rescueAt = G.time + 90; toast(S.rescued, 'good');
});

// small wins: a first-time milestone (once per game)
function win(id: string, text: string) {
  if (wins.has(id)) return;
  wins.add(id); toast(text, 'good'); emit('win', { id });
}

/** The buried east door (snowpack.DOOR): done when its front is clear (a few loose cells are fine), or the player is already inside the house. */
let doorAcc = 0, doorT = 0, doorHinted = false;
export function doorFrontSnow(): number {
  let n = 0;
  for (let y = DOOR.y0; y < DOOR.y1; y++) for (let x = DOOR.x0; x < DOOR.x1; x++) { const m = mat[y * W + x]; if (m === MAT.SNOW || m === MAT.PACKED || m === MAT.ICE || m === MAT.SNOWBLOCK) n++; }
  return n;
}
function doorWatch(dt: number) {
  if (flags.has('door') || DOOR.crest <= 0) return;
  doorAcc += dt; doorT += dt; if (doorAcc < 0.5) return; doorAcc = 0;
  const p = G.player;
  const inside = !!p && p.x > LOC.house.L * 4 + 4 && p.x < LOC.house.R * 4 && p.y > LOC.station.y - 30 && p.y <= LOC.station.y + 2;
  if (inside || doorFrontSnow() <= 14) { emit('door_dug', { inside }); return; }
  if (!doorHinted && doorT > 45) doorHinted = true;      // the goal line already says it: no extra toast
}
let siteAcc = 0;
function siteWatch(dt: number) {
  siteAcc += dt; if (siteAcc < 0.5) return; siteAcc = 0;
  const p = G.player; if (!p || !p.alive) return;
  const s = siteAt(p.x, p.y - 8, 6);
  if (s && !s.found) { s.found = true; toast(fmt(S.found, { name: s.name }), 'info'); emit('site_found', { key: s.key }); }
}

// a goal that just turned done: toast what comes next and emit 'goal_done' (checked twice a second; the first pass only takes a snapshot)
let winAcc = 0;
let lastDone: Map<string, boolean> | null = null;
function goalWatch(dt: number) {
  winAcc += dt; if (winAcc < 0.5) return; winAcc = 0;
  coalWatch();
  const now = new Map<string, boolean>();
  for (const g of GOALS) now.set(g.id, g.done());
  if (lastDone) {
    let first = true;
    for (const g of GOALS) {
      if (!now.get(g.id) || lastDone.get(g.id)) continue;
      emit('goal_done', { id: g.id });
      if (g.win) toast(g.win(), 'good');                         // a mini-goal has its own win toast
      else if (first) { first = false; toast(S.done, 'good'); }  // the goal line shows what is next: no repeat in a toast
    }
  }
  lastDone = now;
}

/** The signal fire on the cape hill (the one placed at LOC.summit). */
function signalLit(): boolean {
  const sx = LOC.summit.x;
  return G.fixtures.some(f => f.kind === 'signal_fire' && f.lit && Math.abs(f.tx * TS - sx) < 160);
}
export function stepQuest(dt: number) {
  if (G.paused || !G.player) return;
  siteWatch(dt); doorWatch(dt);
  goalWatch(dt);
  stepLore(dt); probeTarget(target()); stepMine(dt);
  const q = questState;
  const t = G.time;
  // the icebreaker comes on the second day after the radio call and stays in sight for 36 game hours
  if (q.icebreakerAt > 0 && q.iceArrivedAt < 0 && t >= q.icebreakerAt) {
    q.iceArrivedAt = t; q.iceDeadline = t + 36 * 60; q.lit = false;
    toast(S.arrival, 'good'); emit('icebreaker_arrived', {});
  }
  if (q.iceArrivedAt > 0 && t < q.iceDeadline) {
    if (!q.lit && signalLit() && G.daylight < 0.85) { q.lit = true; q.rescueAt = t + 90; toast(S.rescued, 'good'); }
    if (q.lit && t >= q.rescueAt) icebreakerPasses();
  } else if (q.iceArrivedAt > 0 && t >= q.iceDeadline) {
    toast(S.missed, 'warn');
    q.icebreakerAt = t + 2 * 1440; q.iceArrivedAt = -1; q.iceDeadline = -1; q.lit = false;      // it comes back two days later
  }
  // a new ring: a repaired radio can call the icebreaker again
  if (q.radioFixed && q.icebreakerAt < 0 && q.iceArrivedAt < 0 && q.crateRing >= 0 && G.cycle > q.crateRing && phaseName() === 'night') q.icebreakerAt = t + 2 * 1440;
  if (G.player.core < runStats.coldest) runStats.coldest = Math.round(G.player.core * 10) / 10;
}
/** The icebreaker saw the fire: it passes along the ice edge, drops a supply crate near the cape (fuel, food, a note, 1 flare) and leaves. Once per ring. */
export function icebreakerPasses() {
  const q = questState;
  q.icebreakerAt = -1; q.iceArrivedAt = -1; q.iceDeadline = -1; q.lit = false; q.rescueAt = -1; q.crateRing = G.cycle;
  const sf = worldInfo.spots.signalFire, x = (sf?.x ?? LOC.summit.x) - 14, y = (sf?.y ?? 200) - 10;
  spawnDrop('coal', 8, x, y, 0, -30); spawnDrop('log', 4, x + 6, y, 0, -30); spawnDrop('can', 6, x - 6, y, 0, -30); spawnDrop('flare', 1, x + 12, y, 0, -30);
  const unread = NOTES.find(n => !lore.read.has(n.id));
  if (unread) spawnDrop('note_' + unread.id, 1, x - 12, y, 0, -30);
  toast(S.crateT, 'good'); log('event', S.crateT); log('event', S.crateNote);
  emit('icebreaker_pass', { ring: G.cycle });
}
/** Milestones («вехи»): a toast once per game. */
function milestone(id: string, text: string) { if (wins.has(id)) return; wins.add(id); toast(text, 'good'); log('event', text); emit('win', { id }); }
on('day', (d: { n: number }) => {
  if ([5, 10, 20, 30, 50, 75, 100].includes(d.n)) milestone('days' + d.n, fmt(S.msDays, { n: d.n }));
});
on('season', (d: { phase: 'night' | 'twilight'; cycle: number }) => {
  if (d.phase === 'twilight') milestone('twilight', S.msTwilight);
  else if (d.cycle >= 1) milestone('ring' + d.cycle, fmt(S.msRing, { c: d.cycle }));
});
void worldInfo;
