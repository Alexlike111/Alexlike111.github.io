// Objectives & endings (DESIGN §9). One line, always visible: the first unfinished goal of the chain. Day-1 chain: coal (diesel shed) ->
// stove -> barometer -> read the keeper's log in the house -> shelter (>= 2 stars, built outside the station) -> read the doctor's diary at the
// cairn -> supplies (soft: shown once the rest is done); then the open goals: seal fat (harpoon), driftwood, the ship, the radio (3 parts inserted),
// the mast (needs the knowledge), fur clothes; then storms, a parka, three seals. Endings: «Рассвет» (day 12 sunrise, emitted by weather.ts) and
// «Ледокол» (radio repaired -> 2 game days later its searchlight appears; light the signal fire on the cape hill, or shoot a flare near it, while
// it is in sight -> rescued). Small wins: a toast + bus event 'goal_done' per goal, 'win' for first-time milestones. Also: site discovery
// ('site_found'), run statistics for the ending card, and objectiveTarget() (world cell of the current goal) for the HUD arrow.
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
  coal: 'Подбери уголь у дизельной (E)',
  buried: ' · под снегом: копай лопатой (ЛКМ)',
  door: 'Откопай дверь дома: лопата (слот 2), копай вниз у стены — ступенями, чтобы выбраться',
  doorHint: 'Дверь занесло: выбери лопату (слот 2) и копай у стены дома вниз. Делай ступени, а не колодец: из колодца не выпрыгнуть.',
  stove: 'Растопи печь спичками: войди в дом, подойди вплотную, E',
  baro: 'Проверь барометр: E у столба, он стоит западнее дома',
  keeper: 'Прочти журнал смотрителя: сундук-полка в доме',
  shelter: 'Утепли жильё до ★★: иглу из снежных блоков вне станции (плотный наст — снежное поле к западу, у холма)',
  diary: 'Прочти дневник доктора в жестянке у старого тура на западе от станции',
  supplies: 'Запасы на 12 дней: топливо {fuel} ч · еда {food} дн.',
  seal: 'Найди жир: тюлени у лунок на льду (стой тихо, бей гарпуном)',
  sealLearn: 'Узнай, как вязать гарпун: журнал смотрителя в доме',
  wood: 'Собери плавник на пляже: брёвна {n}/{m}',
  ship: 'Найди шхуну «Заря» среди дрейфующих льдов',
  radio: 'Вставь детали в рацию: {n}/3 (E у рации)',
  mast: 'Подними мачту и запусти рацию',
  mastLearn: 'Узнай про мачту: записи смотрителя в доме, у стола',
  fur: 'Сшей меховую одежду (шкуры, жилы)',
  furLearn: 'Узнай, как шить мех: ищи записи на берегу, у костей кита',
  radioOk: 'Рация починена: ледокол придёт через двое суток',
  wait: 'Ледокол: {d} · сигнал: 2 полена, ягель, спички',
  light: 'Ледокол на горизонте! Зажги сигнальный костёр на холме мыса или выстрели ракетой',
  rescued: 'Огонь замечен. Ледокол идёт к берегу…',
  missed: 'Ледокол прошёл мимо: огня не было. Он вернётся.',
  low: 'Запасы на исходе: топливо {fuel} ч · еда {food} дн.',
  gauge: '  ·  топливо {fuel} ч · еда {food} дн.',
  free: 'Дотяни до рассвета: день {d} из {n}',
  dawnH: 'До рассвета: {h} ч',
  storm: 'Переживи пургу: укрытие ★★ во время шторма',
  parka: 'Сшей меховую парку (тюлень ×3, песец ×2, жилы ×2)',
  seals3: 'Добудь тюленя ×3: {n}/3 (у лунок стой тихо, бей гарпуном)',
  storm2: 'Переживи большую пургу ★★★ (укрытие с отдушиной)',
  next: 'Сделано. Дальше: {t}', done: 'Сделано!',
  milestoneBlock: 'Первый снежный блок вырезан: из таких строят укрытие',
  milestoneCraft: 'Первая вещь сделана своими руками',
  days: '{n} дн.', hours: '{n} ч', soon: 'меньше часа',
  sunrise: 'Дожить до первого солнца',
  found: 'Место найдено: {name}',
  jKnow: 'Новый приём: {name}', jRead: 'Записка: {title}',
  arrival: 'На горизонте шарит прожектор — ледокол!',
  dawnT: 'Рассвет', iceT: 'Ледокол',
});

export interface Goal { id: string; text: () => string; done: () => boolean }
const done = new Set<string>();
export const runStats = { seals: 0, storms: 0, bestStars: 0, stormStars: 0, fires: 0, crafts: 0, blocks: 0, bears: 0, notes: 0, coldest: 99, placed: 0 };
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
const wins = new Set<string>();
/** Goal flags shown by the journal (ui/devhud). parts = radio parts inserted, ending = null | 'dawn' | 'icebreaker'. */
export const prog = { fire: false, baro: false, shelter: false, sleep: false, parts: [] as string[], mast: false, radio: false, ending: null as null | 'dawn' | 'icebreaker' };
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
function coalText(): string { const c = nearestCoal(); return S.coal + (c && buriedAt(c.x, c.y) ? S.buried : ''); }
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
  { id: 'shelter', text: () => S.shelter, done: () => flags.has('shelter') },
  { id: 'diary', text: () => S.diary, done: () => lore.read.has('n1') },
  { id: 'supplies', text: () => { const s = suppliesNow(); return fmt(S.supplies, { fuel: s.fuelH, food: s.foodDays }); }, done: () => suppliesOk() },
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
const nextOpen = (): Goal | undefined => GOALS.find(g => g.id !== 'supplies' && !g.done());
/** Hours left until the sunrise (design: day N's noon). */
const dawnHoursLeft = () => Math.max(0, Math.ceil((G.endDay - 1) * 24 + 12 - G.time / 60));

/** The line shown top-centre, with the goal id it belongs to (for objectiveTarget). */
function activeStep(): Step | null {
  const q = questState;
  if (q.ended) return null;
  if (q.iceDeadline > 0 && G.time < q.iceDeadline && q.iceArrivedAt > 0 && G.time >= q.iceArrivedAt) return q.lit ? { id: 'rescued', text: S.rescued } : { id: 'light', text: S.light };
  if (q.icebreakerAt > 0) {
    const left = q.icebreakerAt - G.time;
    const d = left > 1440 ? fmt(S.days, { n: Math.ceil(left / 1440) }) : left > 60 ? fmt(S.hours, { n: Math.ceil(left / 60) }) : S.soon;
    const nx = nextOpen();
    return { id: 'wait', text: fmt(S.wait, { d }) + (nx ? '  ·  ' + nx.text() : ''), goal: nx?.id };
  }
  // the chain first (coal, stove, barometer, keeper's log, shelter, diary); then supplies only as an emergency; then the open goals with the gauges
  const early = GOALS.slice(0, GOALS.findIndex(g => g.id === 'supplies'));
  for (const g of early) if (!g.done()) return { id: g.id, text: g.text() };
  const sp = suppliesNow();
  if (sp.fuelH < 12 || sp.foodDays < 1) return { id: 'low', text: fmt(S.low, { fuel: sp.fuelH, food: sp.foodDays }) };
  const gauge = fmt(S.gauge, { fuel: sp.fuelH, food: sp.foodDays });
  for (const g of GOALS) { if (g.id === 'supplies') continue; if (!g.done()) return { id: g.id, text: g.text() + gauge }; }
  const sup = GOALS.find(g => g.id === 'supplies')!;
  if (!sup.done()) return { id: 'supplies', text: sup.text() };
  const line = G.day >= G.endDay - 2 ? fmt(S.dawnH, { h: dawnHoursLeft() }) : fmt(S.free, { d: G.day, n: G.endDay });
  return { id: 'free', text: line + gauge };
}
export function objectiveText(): string { return activeStep()?.text ?? ''; }
export function currentGoalId(): string { for (const g of GOALS) if (!g.done()) return g.id; return 'free'; }

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
    case 'coal': return pick(G.drops.filter(d => d.item === 'coal'));
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
    case 'light': case 'rescued': return { x: worldInfo.spots.signalFire.x, y: worldInfo.spots.signalFire.y };
    default: return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
export function resetQuest() {
  done.clear(); flags.clear(); wins.clear(); journal.length = 0;
  Object.assign(prog, { fire: false, baro: false, shelter: false, sleep: false, mast: false, radio: false, ending: null }); prog.parts.length = 0;
  Object.assign(runStats, { seals: 0, storms: 0, bestStars: 0, stormStars: 0, fires: 0, crafts: 0, blocks: 0, bears: 0, notes: 0, coldest: 99, placed: 0 });
  Object.assign(questState, { icebreakerAt: -1, iceArrivedAt: -1, iceDeadline: -1, rescueAt: -1, ended: '', radioFixed: false, lit: false });
  siteAcc = 0; winAcc = 0; lastDone = null; doorAcc = 0; doorT = 0; doorHinted = false;
}
let loaded: any = null;
export function initQuest() { /* event wiring happens at import time; kept for the HUD's init call */ }
export const takeLoaded = () => { const l = loaded; loaded = null; return l; };
export const peekLoaded = () => loaded;
on('new_game', () => { resetQuest(); resetMine(); });
/** Saved with the game (save.ts): goal flags, run statistics, the icebreaker schedule, journal, and the drift of the pack ice. */
export function questSave() {
  return { flags: [...flags], wins: [...wins], prog: { ...prog, parts: [...prog.parts] }, stats: { ...runStats }, q: { ...questState }, journal: journal.slice(-120), drift: driftSnapshot(), lore: loreSave() };
}
export function questLoad(s: any) {
  if (!s) return;
  resetQuest();
  for (const f of s.flags ?? []) flags.add(f);
  for (const w of s.wins ?? []) wins.add(w);
  Object.assign(prog, s.prog ?? {}); prog.parts = [...(s.prog?.parts ?? [])];
  Object.assign(runStats, s.stats ?? {}); Object.assign(questState, s.q ?? {});
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
on('seal_caught', () => { runStats.seals++; });
on('storm_end', (d: { report?: { stars: number; text?: string } }) => {
  runStats.storms++;
  if (d.report) { runStats.bestStars = Math.max(runStats.bestStars, d.report.stars); runStats.stormStars = Math.max(runStats.stormStars, d.report.stars); if (d.report.text) log('storm', d.report.text); }
});
on('slept', (d: { hours: number }) => { if (d.hours >= 3) prog.sleep = true; });
on('radio_part', (d: { id: string }) => { if (!prog.parts.includes(d.id)) prog.parts.push(d.id); });
on('mast_up', () => { prog.mast = true; });
on('site_found', (d: { key: string }) => { if (d.key === 'ship') flags.add('ship'); log('site', fmt(S.found, { name: sites.find(x => x.key === d.key)?.name ?? d.key })); });
on('crafted', (d: { id: string }) => {
  runStats.crafts++;
  if (/^fur_|^kamiks$/.test(d.id)) flags.add('fur');
  if (d.id === 'fur_parka') flags.add('parka');
  win('craft', S.milestoneCraft);
});
on('cut_block', () => { runStats.blocks++; win('block', S.milestoneBlock); });
on('placed', () => { if (!inStation()) runStats.placed++; });
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
  if (!doorHinted && doorT > 45) { doorHinted = true; toast(S.doorHint, 'info'); }
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
  const now = new Map<string, boolean>();
  for (const g of GOALS) now.set(g.id, g.done());
  if (lastDone) {
    let first = true;
    for (const g of GOALS) {
      if (!now.get(g.id) || lastDone.get(g.id)) continue;
      emit('goal_done', { id: g.id });
      if (first) { first = false; const nx = nextOpen(); toast(nx ? fmt(S.next, { t: nx.text() }) : S.done, 'good'); }
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
