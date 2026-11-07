// Objectives & endings (DESIGN §9, v2.1 knowledge flow). One line, always visible: the first unfinished goal of the chain. Day-1 chain: stove ->
// barometer -> read the keeper's log in the house -> shelter (>= 2 stars) -> read the doctor's diary at the cairn -> supplies; then the open goals:
// seal fat (harpoon), driftwood, the ship, the radio (0/3 parts), the mast (needs the knowledge), fur clothes. Endings: «Рассвет» (day 12
// sunrise, emitted by weather.ts) and «Ледокол» (radio repaired -> 2 game days later its searchlight appears; light the signal fire on the cape
// hill while it is in sight -> rescued). Also: site discovery ('site_found'), run statistics for the ending card.
import { G, toast } from './state';
import { emit, on } from './bus';
import { strings, fmt } from '../content/i18n';
import { count } from './inventory';
import { fuelMinutes } from './items';
import { siteAt, LOC, worldInfo, sites } from './locations';
import { driftSnapshot } from './drift';
import { body } from './player';
import { TS, W, mat } from '../engine/grid';
import { MAT } from '../content/materials';
import { DOOR } from './snowpack';
import { knows, lore, stepLore, probeTarget, loreSave, loreLoad, noteTitle, techName } from './lore';
import { target } from './tools';
import { stepMine, resetMine } from './mine';
export { knows, learn, learnAll, forgetAll, lore, readNote, TECHS, NOTES, techName, techDesc, techHint, howLearned, noteTitle, noteText, noteWho, FACTS, factHead, factText, probe, seenCount, markSeen } from './lore';

const S = strings('quest', {
  door: 'Откопай дверь дома: лопата (слот 2), копай вниз у стены — ступенями, чтобы выбраться',
  doorHint: 'Дверь занесло: выбери лопату (слот 2) и копай у стены дома вниз. Делай ступени, а не колодец: из колодца не выпрыгнуть.',
  stove: 'Растопи печь в доме (уголь из дизельной, спички)',
  baro: 'Проверь барометр на столбе у дома',
  keeper: 'Прочти журнал смотрителя: сундук-полка в доме',
  shelter: 'Утепли жильё до ★★: иглу из блоков (плотный наст — сугроб к востоку от дома)',
  diary: 'Прочти дневник доктора в жестянке у старого тура на западе от станции',
  supplies: 'Запасы на 12 дней: топливо {fuel} ч · еда {food} дн.',
  seal: 'Найди жир: тюлени у лунок на льду (стой тихо, бей гарпуном)',
  sealLearn: 'Узнай, как вязать гарпун: журнал смотрителя в доме',
  wood: 'Собери плавник на пляже: брёвна {n}/{m}',
  ship: 'Найди шхуну «Заря» среди дрейфующих льдов',
  radio: 'Почини рацию: детали {n}/3',
  mast: 'Подними мачту и запусти рацию',
  mastLearn: 'Узнай про мачту: записи смотрителя в доме, у стола',
  fur: 'Сшей меховую одежду (шкуры, жилы)',
  furLearn: 'Узнай, как шить мех: ищи записи на берегу, у костей кита',
  radioOk: 'Рация починена: ледокол придёт через двое суток',
  wait: 'Рация работает. Жди ледокол: {d}',
  light: 'Ледокол на горизонте! Зажги сигнальный костёр на холме мыса',
  rescued: 'Огонь замечен. Ледокол идёт к берегу…',
  missed: 'Ледокол прошёл мимо: огня не было. Он вернётся.',
  low: 'Запасы на исходе: топливо {fuel} ч · еда {food} дн.',
  gauge: '  ·  топливо {fuel} ч · еда {food} дн.',
  free: 'Дотяни до рассвета: день {d} из {n}',
  days: '{n} дн.', hours: '{n} ч', soon: 'меньше часа',
  sunrise: 'Дожить до первого солнца',
  found: 'Место найдено: {name}',
  jKnow: 'Новый приём: {name}', jRead: 'Записка: {title}',
  arrival: 'На горизонте шарит прожектор — ледокол!',
  dawnT: 'Рассвет', iceT: 'Ледокол',
});

export interface Goal { id: string; text: () => string; done: () => boolean }
const done = new Set<string>();
export const runStats = { seals: 0, storms: 0, bestStars: 0, fires: 0, crafts: 0, blocks: 0, bears: 0, notes: 0, coldest: 99 };
export const questState = {
  icebreakerAt: -1, iceArrivedAt: -1, iceDeadline: -1, rescueAt: -1, ended: '' as '' | 'dawn' | 'icebreaker', radioFixed: false, lit: false,
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
const suppliesOk = () => { const s = suppliesNow(); return s.fuelH >= 72 && s.foodDays >= 8; };      // 12 days of winter

const flags = new Set<string>();
/** Goal flags shown by the journal (ui/devhud). parts = radio parts inserted, ending = null | 'dawn' | 'icebreaker'. */
export const prog = { fire: false, baro: false, shelter: false, sleep: false, parts: [] as string[], mast: false, radio: false, ending: null as null | 'dawn' | 'icebreaker' };
export interface JournalEntry { kind: 'note' | 'storm' | 'site' | 'event' | 'know'; text: string; t: number }
export const journal: JournalEntry[] = [];
function log(kind: JournalEntry['kind'], text: string) { if (journal.length < 200) journal.push({ kind, text, t: G.time }); }
export const objective = () => objectiveText();
function radioParts(): number {
  const r = G.fixtures.find(f => f.kind === 'radio');
  const have = (r?.data?.have as string[] | undefined)?.length ?? 0;
  return Math.min(3, have + count('radio_triode') + count('radio_coil') + count('battery'));
}
export const GOALS: Goal[] = [
  { id: 'door', text: () => S.door, done: () => flags.has('door') },       // DESIGN §13: the east door of the house is buried under the lee drift at the start
  { id: 'stove', text: () => S.stove, done: () => flags.has('stove') },
  { id: 'baro', text: () => S.baro, done: () => flags.has('baro') || count('barometer') > 0 },
  { id: 'keeper', text: () => S.keeper, done: () => lore.read.has('s1') },
  { id: 'shelter', text: () => S.shelter, done: () => flags.has('shelter') },
  { id: 'diary', text: () => S.diary, done: () => lore.read.has('n1') },
  { id: 'supplies', text: () => { const s = suppliesNow(); return fmt(S.supplies, { fuel: s.fuelH, food: s.foodDays }); }, done: () => suppliesOk() },
  { id: 'seal', text: () => (knows('harpoon') ? S.seal : S.sealLearn), done: () => runStats.seals > 0 },
  { id: 'wood', text: () => fmt(S.wood, { n: Math.min(6, count('log')), m: 6 }), done: () => count('log') >= 6 || flags.has('wood') },
  { id: 'ship', text: () => S.ship, done: () => flags.has('ship') },
  { id: 'radio', text: () => fmt(S.radio, { n: radioParts() }), done: () => radioParts() >= 3 },
  { id: 'mast', text: () => (knows('mast') ? S.mast : S.mastLearn), done: () => questState.radioFixed },
  { id: 'fur', text: () => (knows('sewing') ? S.fur : S.furLearn), done: () => flags.has('fur') },
];

/** The line shown top-centre. */
export function objectiveText(): string {
  if (questState.ended) return '';
  const q = questState;
  if (q.iceDeadline > 0 && G.time < q.iceDeadline && q.iceArrivedAt > 0 && G.time >= q.iceArrivedAt) return q.lit ? S.rescued : S.light;
  if (q.icebreakerAt > 0) {
    const left = q.icebreakerAt - G.time;
    const d = left > 1440 ? fmt(S.days, { n: Math.ceil(left / 1440) }) : left > 60 ? fmt(S.hours, { n: Math.ceil(left / 60) }) : S.soon;
    return fmt(S.wait, { d });
  }
  // chain first (stove, barometer, keeper's log, shelter, diary); then supplies only as an emergency; then the open goals with the supply gauges alongside
  for (const g of GOALS) { if (g.id === 'supplies') break; if (!g.done()) return g.text(); }
  const sp = suppliesNow();
  if (sp.fuelH < 12 || sp.foodDays < 1) return fmt(S.low, { fuel: sp.fuelH, food: sp.foodDays });
  const gauge = fmt(S.gauge, { fuel: sp.fuelH, food: sp.foodDays });
  for (const g of GOALS) { if (g.id === 'supplies') continue; if (!g.done()) return g.text() + gauge; }
  return fmt(S.free, { d: G.day, n: G.endDay }) + gauge;
}
export function currentGoalId(): string { for (const g of GOALS) if (!g.done()) return g.id; return 'free'; }

// ---------------------------------------------------------------------------------------------------------------------
export function resetQuest() {
  done.clear(); flags.clear(); journal.length = 0;
  Object.assign(prog, { fire: false, baro: false, shelter: false, sleep: false, mast: false, radio: false, ending: null }); prog.parts.length = 0;
  Object.assign(runStats, { seals: 0, storms: 0, bestStars: 0, fires: 0, crafts: 0, blocks: 0, bears: 0, notes: 0, coldest: 99 });
  Object.assign(questState, { icebreakerAt: -1, iceArrivedAt: -1, iceDeadline: -1, rescueAt: -1, ended: '', radioFixed: false, lit: false });
  siteAcc = 0; doorAcc = 0; doorT = 0; doorHinted = false;
}
let loaded: any = null;
export function initQuest() { /* event wiring happens at import time; kept for the HUD's init call */ }
export const takeLoaded = () => { const l = loaded; loaded = null; return l; };
export const peekLoaded = () => loaded;
on('new_game', () => { resetQuest(); resetMine(); });
/** Saved with the game (save.ts): goal flags, run statistics, the icebreaker schedule, journal, and the drift of the pack ice. */
export function questSave() {
  return { flags: [...flags], prog: { ...prog, parts: [...prog.parts] }, stats: { ...runStats }, q: { ...questState }, journal: journal.slice(-120), drift: driftSnapshot(), lore: loreSave() };
}
export function questLoad(s: any) {
  if (!s) return;
  resetQuest();
  for (const f of s.flags ?? []) flags.add(f);
  Object.assign(prog, s.prog ?? {}); prog.parts = [...(s.prog?.parts ?? [])];
  Object.assign(runStats, s.stats ?? {}); Object.assign(questState, s.q ?? {});
  for (const e of s.journal ?? []) journal.push(e);
  loreLoad(s.lore);
  loaded = s;
}
on('fire_lit', (d: { kind: string }) => { runStats.fires++; if (d.kind === 'stove') { flags.add('stove'); prog.fire = true; } });
on('barometer', () => { flags.add('baro'); prog.baro = true; });
on('door_dug', () => { flags.add('door'); });
on('shelter', (d: { stars: number; closed: boolean }) => { if (d.closed && d.stars >= 2) { flags.add('shelter'); prog.shelter = true; } runStats.bestStars = Math.max(runStats.bestStars, d.closed ? d.stars : 0); });
on('seal_caught', () => { runStats.seals++; });
on('storm_end', (d: { report?: { stars: number; text?: string } }) => { runStats.storms++; if (d.report) { runStats.bestStars = Math.max(runStats.bestStars, d.report.stars); if (d.report.text) log('storm', d.report.text); } });
on('slept', (d: { hours: number }) => { if (d.hours >= 3) prog.sleep = true; });
on('radio_part', (d: { id: string }) => { if (!prog.parts.includes(d.id)) prog.parts.push(d.id); });
on('mast_up', () => { prog.mast = true; });
on('site_found', (d: { key: string }) => { if (d.key === 'ship') flags.add('ship'); log('site', fmt(S.found, { name: sites.find(x => x.key === d.key)?.name ?? d.key })); });
on('crafted', (d: { id: string }) => { runStats.crafts++; if (/^fur_|^kamiks$/.test(d.id)) flags.add('fur'); });
on('cut_block', () => { runStats.blocks++; });
on('bear_seen', () => { runStats.bears++; });
on('note_read', (d: { id: string }) => { runStats.notes++; log('note', fmt(S.jRead, { title: noteTitle(d.id) })); });
on('tech_learned', (d: { id: string; how: string }) => { if (d.how !== 'start') log('know', fmt(S.jKnow, { name: techName(d.id) })); });
on('picked', (d: { item: string }) => { if (d.item === 'log' && count('log') >= 6) flags.add('wood'); });

on('radio_fixed', () => {
  prog.radio = true; log('event', S.radioOk);
  questState.radioFixed = true;
  questState.icebreakerAt = G.time + 2 * 1440;
});

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
  if (!doorHinted && doorT > 45) { doorHinted = true; toast(S.doorHint, 'info'); }
}
let siteAcc = 0;
function siteWatch(dt: number) {
  siteAcc += dt; if (siteAcc < 0.5) return; siteAcc = 0;
  const p = G.player; if (!p || !p.alive) return;
  const s = siteAt(p.x, p.y - 8, 6);
  if (s && !s.found) { s.found = true; toast(fmt(S.found, { name: s.name }), 'info'); emit('site_found', { key: s.key }); }
}

/** The signal fire on the cape hill (the one placed at LOC.summit). */
function signalLit(): boolean {
  const sx = LOC.summit.x;
  return G.fixtures.some(f => f.kind === 'signal_fire' && f.lit && Math.abs(f.tx * TS - sx) < 160);
}
export function stepQuest(dt: number) {
  if (G.paused || !G.player) return;
  siteWatch(dt); doorWatch(dt);
  stepLore(dt); probeTarget(target()); stepMine(dt);
  const q = questState;
  if (q.ended) return;
  const t = G.time;
  // the icebreaker comes on the second day after the radio call and stays in sight for 36 game hours
  if (q.icebreakerAt > 0 && q.iceArrivedAt < 0 && t >= q.icebreakerAt) {
    q.iceArrivedAt = t; q.iceDeadline = t + 36 * 60; q.lit = false;
    toast(S.arrival, 'good'); emit('icebreaker_arrived', {});
  }
  if (q.iceArrivedAt > 0 && t < q.iceDeadline) {
    if (!q.lit && signalLit() && G.daylight < 0.85) { q.lit = true; q.rescueAt = t + 90; toast(S.rescued, 'good'); }
    if (q.lit && t >= q.rescueAt) { q.ended = 'icebreaker'; emit('ending', { kind: 'icebreaker' }); }
  } else if (q.iceArrivedAt > 0 && t >= q.iceDeadline && !q.ended) {
    toast(S.missed, 'warn');
    q.icebreakerAt = t + 2 * 1440; q.iceArrivedAt = -1; q.iceDeadline = -1; q.lit = false;      // it comes back two days later
  }
  const c = body.stats; void c;
  if (G.player.core < runStats.coldest) runStats.coldest = Math.round(G.player.core * 10) / 10;
}
on('ending', (d: { kind: 'dawn' | 'icebreaker' }) => { if (questState.ended) return; questState.ended = d.kind; prog.ending = d.kind; });
export const endingTitle = (k: 'dawn' | 'icebreaker') => (k === 'dawn' ? S.dawnT : S.iceT);
void worldInfo;
