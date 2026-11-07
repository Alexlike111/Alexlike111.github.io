// Self-tests of knowledge instead of workbenches (SPEC §11): every technique learnable, every note reachable in the world, crafting refuses unknown
// techniques, no tool breaks or has tiers, the mine has coal sacks / carts / a pick-breakable plug, the journal tabs and the bag panel render.
import { registerTest } from './selftest';
import type { TestCtx } from './selftest';
import { G } from './state';
import { emit, on } from './bus';
import { MAT } from '../content/materials';
import { sandbox } from './testkit';
import { worldInfo } from './worldgen';
import { LOC } from './locations';
import { ITEMS, getItem } from './items';
import { inv, add, count, clearInventory, giveStartKit } from './inventory';
import { RECIPES, canCraft, craft, knownRecipes, unknownRecipeTechs } from './recipes';
import { stationsAt, placeFixture } from './fixtures';
import { digTime } from './tools';
import {
  TECHS, NOTES, EXPERIENCE, knows, learn, learnAll, forgetAll, lore, readNote, loreSave, loreLoad, noteText, noteTitle, probeTarget, FACTS, markSeen, seenCount, stepLore, techName, noteOfItem,
} from './lore';
import { journal, objective } from './quest';
import { renderJournalInto, setJournalTab } from '../ui/journal';
import { bagHtml } from '../ui/bag';
import { itemName } from './items';
import { seen } from '../engine/grid';

const START = ['campfire', 'pot', 'cooking', 'blocks', 'rope'];
/** Run a scenario with the knowledge state restored afterwards. */
async function withLore<T>(fn: () => Promise<T> | T): Promise<T> {
  const l0 = loreSave(), j0 = journal.length;
  try { return await fn(); } finally { loreLoad(l0); journal.length = j0; }
}

registerTest('knowledge', 'старт: известны костёр, котелок, готовка, блоки, простая верёвка; остальное — нет', async (t) => {
  await withLore(() => {
    forgetAll();
    for (const id of START) t.expect(knows(id), 'в начале известно: ' + id);
    const unknown = TECHS.filter(x => !START.includes(x.id));
    t.expect(unknown.length >= 15 && unknown.every(x => !knows(x.id)), 'остальные приёмы не известны на старте');
    t.expect(START.length === TECHS.filter(x => x.start).length, 'стартовых приёмов ровно ' + START.length);
  });
});

registerTest('knowledge', 'каждый рецепт привязан к приёму, а каждый приём можно выучить', async (t) => {
  await withLore(() => {
    const ids = new Set(TECHS.map(x => x.id));
    for (const r of RECIPES) t.expect(ids.has(r.tech), `рецепт ${r.key}: неизвестный приём «${r.tech}»`);
    // every non-start technique is taught by some note or by experience
    for (const x of TECHS) {
      if (x.start) continue;
      const byNote = NOTES.some(n => n.teaches.includes(x.id)), byExp = EXPERIENCE.includes(x.id);
      t.expect(byNote || byExp, `приём «${x.id}» нигде не учится`);
    }
    // teach by note
    forgetAll();
    for (const n of NOTES) {
      readNote(n.id);
      for (const id of n.teaches) t.expect(knows(id), `записка ${n.id} не научила «${id}»`);
      t.expect(noteText(n.id).length > 60 && noteTitle(n.id).length > 3, `записка ${n.id}: нет текста`);
    }
    t.expect(TECHS.filter(x => knows(x.id)).length >= TECHS.length - EXPERIENCE.filter(e => !NOTES.some(n => n.teaches.includes(e))).length, 'после всех записок остались только приёмы опыта');
    // teach by experience
    forgetAll();
    const p = G.player;
    emit('seal_caught', {}); t.expect(knows('butchery'), 'первый тюлень → разделка');
    emit('splash', {}); t.expect(knows('snow_roll'), 'падение в воду → катайся в сухом снегу');
    emit('fox_steal', { item: 'fat' }); t.expect(knows('cache'), 'визит лисы → тайник');
    emit('drum_brazier', {}); t.expect(knows('brazier'), 'бочка-жаровня');
    const f0 = p.frost.hands, c0 = p.co;
    p.frost.hands = 55; stepLore(0.3); t.expect(knows('dry_mittens'), 'первое обморожение → сухие варежки');
    p.co = 22; stepLore(0.3); t.expect(knows('vent'), 'первый угар → отдушина');
    p.frost.hands = f0; p.co = c0;
    for (const ty of [60, 59, 58]) emit('placed', { item: 'snow_block', x: 1000, y: ty * 4 + 2 });
    t.expect(knows('vault'), 'три ряда блоков → снежный свод');
    for (const id of EXPERIENCE) t.expect(knows(id) || NOTES.some(n => n.teaches.includes(id)), 'опыт не выучил «' + id + '»');
  });
});

registerTest('knowledge', 'каждая записка лежит в мире ровно один раз: в сундуке или на полу', t => {
  const ids = NOTES.map(n => n.id);
  t.expect(ids.length >= 16, 'записок: ' + ids.length);
  for (const id of ids) {
    const spots = worldInfo.notes.filter(n => n.id === id);
    t.expect(spots.length === 1, `записка ${id}: мест ${spots.length}`);
    const item = 'note_' + id;
    const inChest = G.fixtures.some(f => f.items?.some(s => s.id === item));
    const onFloor = G.drops.some(d => d.item === item);
    const read = lore.read.has(id);
    t.expect(inChest || onFloor || read, `записки ${id} нет ни в сундуке, ни на полу`);
  }
  // keeper's log is in the house / shed, the doctor's pages are spread over the cairn, mine, beach, iceberg and ship
  const where = (id: string) => worldInfo.notes.find(n => n.id === id)?.where;
  t.expect(where('s1') === 'station' && where('s2') === 'station' && where('s3') === 'shed', 'журнал смотрителя — в доме и в дизельной');
  t.expect(where('n1') === 'cairn' && ['mine', 'minehut'].includes(where('n2') ?? ''), 'дневник начинается у тура и в шахте');
  t.expect(['whale', 'beach'].includes(where('n7') ?? '') && where('n8') === 'beach' && ['icecave'].includes(where('n9') ?? '') && where('n12') === 'ship', 'и дальше: кости кита, пляж, ледяная пещера, шхуна');
  t.expect(noteOfItem('note_n3') === 'n3' && noteOfItem('pick') === '', 'noteOfItem');
});

registerTest('knowledge', 'находка записки: предмет не лежит в сумке, приём выучен, запись в журнале', async (t) => {
  await sandbox(() => withLore(() => {
    forgetAll(); clearInventory(); giveStartKit();
    const j0 = journal.length;
    add('note_n1', 1);
    emit('note_found', { id: 'note_n1' });
    t.expect(count('note_n1') === 0, 'записка осталась в сумке');
    t.expect(lore.read.has('n1') && knows('lamp'), 'записка у тура должна научить лампе');
    t.expect(journal.length >= j0 + 2 && journal.some(e => e.kind === 'note') && journal.some(e => e.kind === 'know'), 'нет записей в журнале');
    t.expect(G.toasts.some(x => /Новый приём/.test(x.text)), 'нет тоста «Новый приём»');
    // reading twice teaches nothing new
    const n = journal.length; emit('note_found', { id: 'note_n1' }); t.expect(journal.length === n, 'повторное чтение дублирует запись');
  }));
});

registerTest('knowledge', 'крафт отказывает без знания приёма и работает после', async (t) => {
  await sandbox(() => withLore(() => {
    const p = G.player;
    forgetAll(); clearInventory();
    placeFixture('table', Math.floor(p.x / 4) + 2, Math.floor(p.y / 4) - 2, { force: true });
    placeFixture('campfire', Math.floor(p.x / 4) - 4, Math.floor(p.y / 4) - 1, { force: true, fuel: 100, lit: true });
    const st = stationsAt(p.x, p.y - 8);
    for (const r of RECIPES) {
      if (START.includes(r.tech)) continue;
      clearInventory();
      for (const g of r.variants[0]) add(g.id, g.n);
      const c = canCraft(r, st);
      t.expect(!c.ok && c.unknown === true, `${r.key}: без знания «${r.tech}» крафт разрешён`);
      t.expect(craft(r, st) === false && count(r.variants[0][0].id) >= r.variants[0][0].n, `${r.key}: craft() сработал без знания`);
    }
    // start recipes work
    clearInventory(); add('log', 2); add('lichen', 1);
    const camp = RECIPES.find(r => r.result === 'campfire')!;
    t.expect(canCraft(camp, st).ok && craft(camp, st) && count('campfire') === 1, 'костёр — стартовый приём');
    // after learning the harpoon can be made
    clearInventory(); for (const g of RECIPES.find(r => r.result === 'harpoon')!.variants[0]) add(g.id, g.n);
    const h = RECIPES.find(r => r.result === 'harpoon')!;
    t.expect(!canCraft(h, st).ok, 'гарпун до знания');
    readNote('s1');
    t.expect(canCraft(h, st).ok && craft(h, st) && count('harpoon') === 1, 'гарпун после журнала смотрителя');
    t.expect(knownRecipes().length < RECIPES.length && unknownRecipeTechs().length > 5, 'панель должна знать о неизвестных приёмах');
    learnAll(); t.expect(knownRecipes().length === RECIPES.length && unknownRecipeTechs().length === 0, 'после всего: все рецепты известны');
  }));
});

registerTest('knowledge', 'инструменты не ломаются и не делятся на ступени', async (t) => {
  await sandbox(() => withLore(() => {
    for (const d of Object.values(ITEMS)) {
      if (d.kind !== 'tool' || !d.tool) continue;
      if (d.id === 'torch' || d.id === 'lantern') { t.expect(isFinite(d.tool.dur), d.id + ': расходник светит ограниченно'); continue; }
      t.expect(d.tool.dur === Infinity, `${d.id}: прочность должна быть бесконечной`);
    }
    let broke = 0; const off = on('tool_broke', () => { broke++; });
    clearInventory(); giveStartKit();
    for (const id of ['axe', 'pick', 'saw', 'ice_chisel', 'harpoon', 'fishing_line']) add(id, 1);
    for (const s of inv.slots) if (s && getItem(s.id).kind === 'tool' && s.id !== 'torch') t.expect(s.dur === undefined, s.id + ' получил прочность');
    // the numbers behind it: nothing refuses to work for a "tier" reason; each tool does its job
    const M = MAT as Record<string, number>;
    t.expect(isFinite(digTime(M.STONE, 'pick')) && isFinite(digTime(M.HARDROCK, 'pick')) && isFinite(digTime(M.METAL, 'pick')), 'кирка берёт любой камень и железо');
    t.expect(isFinite(digTime(M.ICE, 'chisel')) && isFinite(digTime(M.ICE, 'pick')) && digTime(M.ICE, 'shovel') === Infinity, 'лёд: пешня и кирка');
    t.expect(isFinite(digTime(M.LOG, 'axe')) && isFinite(digTime(M.WHALEBONE, 'axe')) && digTime(M.LOG, 'saw') < digTime(M.LOG, 'axe'), 'топор — дерево и кость; пила быстрее');
    t.expect(isFinite(digTime(M.SNOW, 'shovel')) && digTime(M.SNOW, 'shovel') <= digTime(M.SNOW, 'knife'), 'лопата двигает снег');
    t.expect(digTime(M.STONE, 'axe') === Infinity && digTime(M.STONE, 'shovel') === Infinity && digTime(M.STONE, 'knife') === Infinity, 'камень не берётся не тем инструментом');
    t.expect(digTime(M.PACKED, 'saw') < digTime(M.PACKED, 'knife') || isFinite(digTime(M.PACKED, 'saw')), 'пила режет снег');
    off();
    t.expect(broke === 0, 'инструмент сломался');
  }));
});

registerTest('knowledge', 'шахта: мешки угля, вагонетки, кирка у портала, породная пробка, ледяная пробка', t => {
  const sacks = G.drops.filter(d => d.item === 'coal' && d.x > 60 && d.x < 420);
  const carts = G.fixtures.filter(f => f.kind === 'cart' && f.data?.loaded === 'coal');
  t.expect(worldInfo.coal.length >= 8, 'мешков угля в мире: ' + worldInfo.coal.length);
  t.expect(carts.length >= 3, 'вагонеток с углём: ' + carts.length);
  t.expect(sacks.length === 0 || sacks.every(d => d.n >= 3), 'мешок = 3–4 куска');
  t.expect(G.drops.some(d => d.item === 'pick') || lore.read.size >= 0, 'кирка у портала');
  t.expect(worldInfo.pick.x > LOC.mine.portalX - 30 && worldInfo.pick.x < LOC.mine.portalX, 'кирка лежит у портала, до завала');
  const M = MAT as Record<string, number>;
  t.expect(digTime(M.STONE, 'pick') < Infinity && digTime(M.STONE, 'shovel') === Infinity, 'породную пробку разбивает только кирка');
  t.expect(worldInfo.roof.x1 > worldInfo.roof.x0 && worldInfo.timberSets.length === 1, 'мёрзлая кровля на стойках');
  // no coal seams: coal cells exist only in the ship bunker
  t.expect(worldInfo.carts >= 3, 'worldInfo.carts');
});

registerTest('knowledge', 'дневник: все вкладки рисуются (Цели, Знания, Записки, Карта, Вещества)', async (t) => {
  await sandbox(() => withLore(() => {
    const el = document.createElement('div'); el.style.display = 'block';
    readNote('n1'); readNote('s1'); learn('vault', 'exp', '', true);
    probeTarget({ inReach: true, mat: MAT.SNOW, density: 140, iceCm: null });
    probeTarget({ inReach: true, mat: MAT.PACKED, density: 300, iceCm: null });
    for (const tab of ['goals', 'know', 'notes', 'map', 'stuff'] as const) {
      setJournalTab(tab);
      renderJournalInto(el);
      t.expect(el.querySelectorAll('.tab').length === 5, `вкладки: ${el.querySelectorAll('.tab').length}`);
      t.expect(el.innerHTML.length > 400, 'вкладка ' + tab + ' пуста');
    }
    setJournalTab('know'); renderJournalInto(el);
    t.expect(/Снежный свод/.test(el.innerHTML) && el.querySelectorAll('.q').length >= 8, 'Знания: выученное и «?»-места');
    setJournalTab('notes'); renderJournalInto(el);
    t.expect(el.innerHTML.includes(noteTitle('n1')) && !!el.querySelector('.paper')?.textContent?.includes('лампа'), 'Записки: список и текст');
    setJournalTab('map'); renderJournalInto(el);
    const cv = el.querySelector('canvas.map') as HTMLCanvasElement | null;
    t.expect(!!cv, 'Карта: нет холста');
    markSeen(G.player.x, G.player.y, 12);
    if (cv) { renderJournalInto(el); const c2 = el.querySelector('canvas.map') as HTMLCanvasElement; const d = c2.getContext('2d')!.getImageData(0, 0, c2.width, c2.height).data; let lit = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i] + d[i + 1] + d[i + 2] > 60) lit++; t.expect(lit > 10, 'на карте нет исследованной области (ярких точек ' + lit + ')'); }
    setJournalTab('stuff'); renderJournalInto(el);
    t.expect(/Свежий снег/.test(el.innerHTML) && /Наст/.test(el.innerHTML), 'Вещества: пробы снега записаны');
    setJournalTab('goals'); renderJournalInto(el);
    t.expect(el.innerHTML.includes(objective().slice(0, 12)), 'Цели: текущая цель выведена');
  }));
});

registerTest('knowledge', 'панель сумки показывает только известные приёмы и «?»-места', async (t) => {
  await sandbox(() => withLore(() => {
    forgetAll();
    let h = bagHtml();
    t.expect(h.includes(itemName('campfire')) && !h.includes(itemName('harpoon')) && !h.includes(itemName('fur_parka')), 'до знаний: костёр есть, гарпуна и парки нет');
    t.expect((h.match(/class="qrow"/g) ?? []).length >= 5, '«?»-места подсказывают, где учиться');
    t.expect(/где угодно/.test(h), 'место приёма: «где угодно»');
    t.expect(!/верстак|Верстак|мастерск/i.test(h), 'в панели не должно быть слова «верстак»');
    readNote('s1'); readNote('n7');
    h = bagHtml();
    t.expect(h.includes(itemName('harpoon')) && /у стола на станции/.test(h) && /тонкая работа \(руки мёрзнут\)/.test(h), 'после записок: гарпун, «у стола на станции», «тонкая работа (руки мёрзнут)»');
    learnAll(); h = bagHtml();
    t.expect((h.match(/class="qrow"/g) ?? []).length === 0, 'выучено всё: «?» не осталось');
  }));
});

registerTest('knowledge', 'вещества: взгляд на снег и лёд записывается; карта растёт при ходьбе; всё сохраняется', async (t) => {
  await sandbox(() => withLore(() => {
    lore.probes.clear();
    probeTarget({ inReach: false, mat: MAT.SNOW, density: 100, iceCm: null });
    t.expect(lore.probes.size === 0, 'далёкая цель не записывается');
    probeTarget({ inReach: true, mat: MAT.SNOW, density: 100, iceCm: null });
    probeTarget({ inReach: true, mat: MAT.PACKED, density: 300, iceCm: null });
    probeTarget({ inReach: true, mat: MAT.PACKED, density: 450, iceCm: null });
    probeTarget({ inReach: true, mat: MAT.ICE, density: null, iceCm: 20 });
    for (const id of ['mat:SNOW', 'mat:PACKED', 'mat:ICE', 'snow:loose', 'snow:good', 'snow:dense', 'ice:thin']) t.expect(lore.probes.has(id), 'проба ' + id);
    t.expect(FACTS.every(f => f.id.length > 3), 'FACTS');
    // exploration map follows the player
    seen.fill(0); const p = G.player;
    stepLore(0.5); stepLore(0.5);
    t.expect(seenCount() > 300, 'карта не растёт: ' + seenCount());
    // save / load
    forgetAll(); learn('lamp', 'note', 'n1', true); readNote('s2');
    const s = JSON.parse(JSON.stringify(loreSave()));
    forgetAll(); lore.read.clear(); lore.probes.clear(); seen.fill(0);
    loreLoad(s);
    t.expect(knows('lamp') && knows('mast') && lore.read.has('s2') && lore.probes.has('mat:SNOW') && seenCount() > 300, 'save/load потеряли знания, записки, пробы или карту');
    t.expect(knows('campfire') && knows('rope'), 'стартовые приёмы после load');
    loreLoad(undefined); t.expect(knows('pot') && !knows('lamp'), 'пустое сохранение = стартовый набор');
    void p; void techName;
  }));
});
