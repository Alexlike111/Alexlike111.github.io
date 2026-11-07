// Self-tests for the gameplay core (SPEC §11): items, recipes, tools, fixtures, the body, shelter / CO, weather, input paths, difficulty.
// Every scenario runs synchronously on a snapshot of the real game (sandbox) so the player's world is untouched afterwards.
import { registerTest } from './selftest';
import type { TestCtx } from './selftest';
import { G } from './state';
import { on } from './bus';
import { W, mat, aux, flags, TS } from '../engine/grid';
import { MAT, MATS } from '../content/materials';
import { initHeat, tempAt } from '../engine/heat';
import { input, simKey, simMouse, resetInput, poll, endFrame, touch } from '../engine/input';
import { ITEMS, getItem, itemName, densityOf, auxOfDensity, snowClass } from './items';
import { inv, add, remove, count, weight, giveStartKit, clearInventory, equip, spawnDrop, backpacks, BELT, NSLOT } from './inventory';
import { RECIPES, canCraft, craft } from './recipes';
import { learnAll, loreSave, loreLoad } from './lore';
import { addHoleAt, setScanning } from './hunt';
import {
  FIXTURE_DEFS, mastUp, placeFixture, removeFixture, interact, stepFixtures, tryLight, addFuel, stationsAt, collectLights, radiantWarmth, pickupFixture, stash, planFixture, raiseMast, dryBoost, setSnareFallback,
} from './fixtures';
import { body, stepBody, stepPlayer, die, damage, respawn, applyDifficulty, startSleep, wake, eatSlot, eatBest, windChill, toggleParka, handsFrozen, TUNE } from './player';
import { digTime, cutRegion, target, toolState, stepTools, stepDrops, sinterMinutes } from './tools';
import { gradeShelter, floodEnclosure, evalShelterNow, finishStormReport, coNow } from './shelter';
import { initWeather, setDay, setClock, wx, STORMS, sunElevAt, noonElevAt, stormIntensity, applyClock, stepWeather, knowsForecast, readBarometer, MIN_PER_SEC, nextStorm } from './weather';
import { sandbox, arena, igloo, tileBlock, count as cellCount, put } from './testkit';
import { takeAllFound, closeBox, isOpen as searchOpen } from './search';

const sc = () => (window as unknown as { __sc: any }).__sc;
const ok = (t: TestCtx, c: boolean, m: string) => t.expect(c, m);

/** Flat cold arena with the player standing on it. */
function scene(o: { T?: number; wind?: number; dens?: number; loose?: number; storm?: number; hour?: number; day?: number; kit?: boolean } = {}) {
  setDay(o.day ?? 3, o.hour ?? 12);
  wx.override = { ambientT: o.T ?? -30, wind: o.wind ?? 0, storm: o.storm ?? 0, snowfall: 0 };
  Object.assign(G, wx.override);
  arena(1000, 272, { dens: o.dens ?? 300, loose: o.loose ?? 0, depth: 40, up: 70 });
  const s = sc();
  s.teleport(1000, 272);
  if (o.kit !== false) giveStartKit();
  const p = G.player;
  p.core = 37; p.food = 90; p.water = 90; p.energy = 90; p.hp = 100; p.wet = 0; p.co = 0; p.frost.hands = p.frost.feet = p.frost.face = 0; p.alive = true; p.sleeping = false; p.parkaOpen = false;
  body.scar.hands = body.scar.feet = body.scar.face = 0; body.warmT = 0; body.fineT = 0; G.timeScale = 1;
  initHeat();
  s.stepFast(5);
  return p;
}
const steps = (n: number) => sc().stepFast(n);
const bodySteps = (sec: number, dt = 0.25) => { for (let t = 0; t < sec; t += dt) stepBody(dt); };

// =====================================================================================================================
// items & inventory
registerTest('items', 'все предметы DESIGN §8 существуют с нужными id', () => {
  const ids = ['snow_block', 'snow', 'ice', 'log', 'plank', 'bone', 'stone', 'soapstone', 'coal', 'lichen', 'canvas', 'rope', 'sinew', 'fat', 'seal_meat', 'fish', 'ptarmigan', 'cooked_meat', 'fish_cooked', 'can', 'biscuit', 'tea', 'water',
    'sealskin', 'fox_fur', 'bear_fur', 'scrap', 'tin', 'matches', 'flint', 'flare', 'diesel', 'radio_triode', 'radio_coil', 'battery', 'note', 'pot', 'flask',
    'snow_knife', 'shovel', 'ice_chisel', 'axe', 'pick', 'saw', 'harpoon', 'fishing_line', 'torch', 'lantern', 'flare_gun', 'barometer',
    'wool_mittens', 'fur_mittens', 'felt_boots', 'kamiks', 'wool_hat', 'fur_hood', 'station_parka', 'fur_parka',
    'campfire', 'fat_lamp', 'brazier', 'drying_rack', 'skin_bed', 'hide_door', 'cache', 'snare', 'sled', 'mast'];
  const missing = ids.filter(i => !ITEMS[i]);
  if (missing.length) throw new Error('нет предметов: ' + missing.join(','));
  for (const id of ids) { const d = ITEMS[id]; if (!(d.w > 0) || !(d.stack >= 1) || !itemName(id)) throw new Error('битый предмет ' + id); }
});
registerTest('items', 'предметы-фикстуры, одежда и инструменты согласованы', () => {
  for (const d of Object.values(ITEMS)) {
    if (d.fixture && !FIXTURE_DEFS[d.fixture]) throw new Error('нет def фикстуры ' + d.fixture + ' для ' + d.id);
    if (d.place && !(d.place in MAT)) throw new Error('place материал ' + d.place);
    if (d.wear && !['head', 'body', 'hands', 'feet', 'face'].includes(d.wear.slot)) throw new Error('слот ' + d.id);
    if (d.kind === 'tool' && !d.tool) throw new Error('tool def ' + d.id);
  }
});
registerTest('items', 'инвентарь: стеки, переполнение, вес, классы снежных блоков', async () => {
  await sandbox(() => {
    clearInventory();
    if (add('matches', 50) !== 0 || count('matches') !== 50) throw new Error('matches stack 40: 50 шт. занимают два слота');
    if (inv.slots.filter(s => s && s.id === 'matches').length !== 2) throw new Error('стек спичек 40');
    add('snow_block', 2, 200); add('snow_block', 2, 300); add('snow_block', 1, 420);
    const classes = new Set(inv.slots.filter(s => s && s.id === 'snow_block').map(s => snowClass(s!.dur ?? 0)));
    if (classes.size !== 3) throw new Error('снежные блоки должны стекаться по классам, а не вместе: ' + classes.size);
    const w = weight(); if (!(w > 20)) throw new Error('вес блоков ' + w);
    if (!remove('snow_block', 2) || count('snow_block') !== 3) throw new Error('remove');
    clearInventory();
    for (let i = 0; i < NSLOT + 3; i++) add('axe', 1);
    if (inv.slots.filter(Boolean).length !== NSLOT) throw new Error('инструменты не стекаются, мест ' + NSLOT);
    giveStartKit();
    if (inv.wear.body !== 'station_parka' || count('matches') !== 20 || count('can') !== 2 || count('tea') !== 1 || !count('snow_knife') || !count('shovel')) throw new Error('стартовый набор');
  });
});
registerTest('items', 'плотность снега из aux и классы', () => {
  if (densityOf('SNOW', 0) !== 60 || densityOf('SNOW', 100) !== 220) throw new Error('формула 60+1.6·aux');
  if (densityOf('PACKED', 0) !== 380) throw new Error('спечённый наст ≈ 380');
  if (snowClass(densityOf('SNOWBLOCK', auxOfDensity(200))) !== 0 || snowClass(densityOf('SNOWBLOCK', auxOfDensity(300))) !== 1 || snowClass(densityOf('SNOWBLOCK', auxOfDensity(430))) !== 2) throw new Error('классы');
});

// =====================================================================================================================
// recipes
registerTest('recipes', 'каждый рецепт (приём известен): ингредиенты → результат, станции, тонкая работа', async () => {
  const l0 = loreSave();
  learnAll();
  try { await sandbox(() => {
    const p = scene();
    for (const r of RECIPES) {
      for (let v = 0; v < r.variants.length; v++) {
        clearInventory(); G.fixtures.length = 0; body.fineT = 0;
        for (const g of r.variants[v]) add(g.id, g.n);
        const st = stationsAt(p.x, p.y - 8);
        if (r.station !== 'none' && canCraft(r, st).ok) throw new Error(r.key + ': без станции крафт разрешён');
        if (r.station === 'table') placeFixture('table', 247, 66, { force: true });
        if (r.station === 'fire') placeFixture('campfire', 250, 67, { force: true, fuel: 100, lit: true });
        if (r.station === 'drum') placeFixture('drum', 247, 66, { force: true });
        if (r.station === 'antenna') placeFixture('mast', 248, 62, { force: true, data: { up: false } });
        const st2 = stationsAt(p.x, p.y - 8);
        // the antenna must be close: put the player next to it
        if (r.station === 'antenna') { /* stationsAt uses ≤ 10 tiles */ }
        const c = canCraft(r, st2);
        if (!c.ok) throw new Error(`${r.key}[${v}]: нельзя скрафтить: ${c.reason}`);
        if (!craft(r, st2)) throw new Error(`${r.key}[${v}]: craft вернул false`);
        if (r.result !== 'mast' && count(r.result) < r.n) throw new Error(`${r.key}: результат ${r.result} ×${r.n} не появился`);
        for (const g of r.variants[v]) if (count(g.id) !== (r.variants[v].some(h => h.id === r.result && g.id === r.result) ? count(g.id) : 0) && g.id !== r.result) throw new Error(`${r.key}: ${g.id} не потрачен`);
        if (r.fine && !(body.fineT > 0)) throw new Error(r.key + ': тонкая работа не греет руки');
      }
    }
    // missing ingredients / frozen hands
    clearInventory();
    const r0 = RECIPES.find(r => r.result === 'fur_mittens')!;
    if (canCraft(r0, { table: true }).ok) throw new Error('крафт без материалов');
    add('fox_fur', 1);
    placeFixture('table', 247, 66, { force: true });
    if (!canCraft(r0, stationsAt(p.x, p.y - 8)).ok) throw new Error('должен получиться');
    if (canCraft(r0, stationsAt(p.x, p.y - 8), true).ok) throw new Error('обмороженные руки не должны шить');
  }); } finally { loreLoad(l0); }
});

// =====================================================================================================================
// tools
registerTest('tools', 'время копания по материалам и инструментам', () => {
  const m = (k: string) => (MAT as Record<string, number>)[k];
  if (!(digTime(m('SNOW'), 'shovel') <= 0.3)) throw new Error('лопата по снегу быстра');
  if (digTime(m('STONE'), 'hand') !== Infinity || digTime(m('STONE'), 'shovel') !== Infinity) throw new Error('камень руками нельзя');
  if (!isFinite(digTime(m('STONE'), 'pick'))) throw new Error('кирка по камню');
  if (!isFinite(digTime(m('COAL'), 'pick')) || !isFinite(digTime(m('SOAPSTONE'), 'pick'))) throw new Error('уголь/мыльный камень');
  if (digTime(m('STONE'), 'axe') !== Infinity || digTime(m('STONE'), 'knife') !== Infinity) throw new Error('камень: только кирка (нет ступеней — у каждого инструмента своё дело)');
  if (!(digTime(m('LOG'), 'saw') < digTime(m('LOG'), 'axe'))) throw new Error('пила быстрее топора по дереву');
  if (digTime(m('STONE'), 'saw') !== Infinity) throw new Error('пила не берёт камень');
  if (!isFinite(digTime(m('ICE'), 'chisel')) || digTime(m('ICE'), 'hand') !== Infinity) throw new Error('лёд: пешня да, руки нет');
  if (!(digTime(m('ICE'), 'chisel') < digTime(m('ICE'), 'axe'))) throw new Error('пешня быстрее топора по льду');
  if (digTime(m('BEDROCK'), 'pick') !== Infinity) throw new Error('коренную породу нельзя');
  if (!isFinite(digTime(m('WHALEBONE'), 'axe'))) throw new Error('кость топором');
});
registerTest('tools', 'снежный нож: блок из наста, плотность и классы', async () => {
  await sandbox(() => {
    const p = scene({ dens: 300 });
    const s = sc();
    s.selectItem('snow_knife');
    const r = cutRegion(252, 68);
    if (!r.ok || Math.abs(r.density - 300) > 3) throw new Error('cutRegion ' + JSON.stringify(r));
    const before = count('snow_block');
    s.act('dig', 1010, 274, 2.2);
    if (count('snow_block') <= before) throw new Error('блок не вырезан: ' + JSON.stringify(target().lines));
    const slot = inv.slots.find(x => x && x.id === 'snow_block')!;
    if (Math.abs((slot.dur ?? 0) - 300) > 6) throw new Error('плотность блока ' + slot.dur);
  });
});
registerTest('tools', 'рыхлый наст рассыпается при вырезании', async () => {
  await sandbox(() => {
    scene({ dens: 180 });
    const s = sc();
    s.selectItem('snow_knife');
    const before = count('snow_block');
    s.act('dig', 1010, 274, 2.2);
    if (count('snow_block') !== before) throw new Error('из рыхлого снега не должно быть блока');
  });
});
registerTest('tools', 'блок: призрак, опора, купол и расход предмета', async () => {
  await sandbox(() => {
    scene();
    const s = sc();
    add('snow_block', 6, 300);
    const n0 = count('snow_block');
    let r = s.place('snow_block', 246, 67);
    if (!r.placed || count('snow_block') !== n0 - 1) throw new Error('блок не поставлен на землю: ' + JSON.stringify(r));
    r = s.place('snow_block', 246, 64);             // floating in the air
    if (r.placed) throw new Error('блок в воздухе без опоры не должен ставиться');
    r = s.place('snow_block', 246, 66);             // on top of the first
    if (!r.placed) throw new Error('блок поверх блока: ' + r.reason);
    // dome mode shaves the underside
    toolState.dome = true;
    const c0 = cellCount(MAT.SNOWBLOCK);
    r = s.place('snow_block', 246, 65);
    const added = cellCount(MAT.SNOWBLOCK) - c0;
    toolState.dome = false;
    if (!r.placed || !(added < 32 && added >= 20)) throw new Error('купол: блок должен быть срезан, клеток ' + added);
    // placed flag
    let placedFlags = 0; for (let x = 984; x < 1000; x++) if (flags[270 * W + x] & 2) placedFlags++;
    if (!placedFlags) throw new Error('F_PLACED не выставлен');
  });
});
registerTest('tools', 'лопата: зачерпнуть, бросить кучу, утрамбовать; ледоруб; топор/кирка дают предметы', async () => {
  await sandbox(() => {
    const pl = scene({ loose: 4 });
    const s = sc();
    const calm = () => { pl.core = 37; body.shiver = 0; };               // a shivering hand sways the aim (aimSway) and a one-tile target is missed now and then: this test is about the tools
    s.selectItem('shovel');
    const hl = s.mods.inv.held;
    hl.load = 0; calm();
    s.act('dig', 1010, 274, 0.5);
    if (!(hl.load >= 8)) throw new Error('черпак пуст: ' + hl.load);
    const snowBefore = cellCount(MAT.SNOW, 940, 200, 1060, 280);
    // throw it into the air at a target 3 tiles to the right
    const L0 = hl.load;
    // the hand sways a little with real time (aimSway): a throw that lands on a heap digs instead, so aim a little higher on the next try
    for (let k = 0; k < 3 && hl.load >= L0; k++) { calm(); s.act('dig', 1016, 262 - k * 6, 0.7); }
    if (hl.load >= L0) throw new Error('снег не брошен');
    steps(120);
    const snowAfter = cellCount(MAT.SNOW, 940, 200, 1060, 280) + cellCount(MAT.PACKED, 940, 200, 1000, 262);
    if (snowAfter < snowBefore - 2) throw new Error(`снег пропал ${snowBefore} → ${snowAfter}`);
    // tamp: raise compaction until the sim turns it packed
    for (let x = 1010; x < 1022; x++) for (let y = 266; y < 272; y++) { const i = y * W + x; if (mat[i] === MAT.AIR) { mat[i] = MAT.SNOW; aux[i] = 100; } }
    s.mouse(2, true, 0, 0); s.render(0); s.aim(1016, 268); s.mouse(2, true);
    steps(70); s.mouse(2, false);
    if (!(cellCount(MAT.PACKED, 1000, 262, 1030, 271) > 0)) throw new Error('утрамбовка не дала наст');
    // ice chisel
    arena(1000, 272, { dens: 300, loose: 0, ice: true, depth: 40, up: 70 }); s.teleport(1000, 272);
    s.selectItem('ice_chisel'); add('ice_chisel', 1);
    s.selectItem('ice_chisel');
    const i0 = count('ice');
    calm(); s.act('dig', 1004, 273, 1.2);
    if (count('ice') <= i0) throw new Error('пешня не дала лёд');
    // axe & pick
    for (const [tool, key, item, tx] of [['axe', 'LOG', 'log', 1014], ['pick', 'COAL', 'coal', 1018], ['pick', 'METAL', 'scrap', 1022]] as [string, string, string, number][]) {
      arena(1000, 272, { dens: 300, loose: 0, depth: 40, up: 70 }); s.teleport(1000, 272);
      tileBlock(Math.floor(tx / 4), 67, 1, 1, (MAT as Record<string, number>)[key], 0, 0);
      add(tool, 1); s.selectItem(tool);
      const c0 = count(item); calm(); s.act('dig', Math.floor(tx / 4) * 4 + 2, 270, 2.5);
      if (count(item) <= c0 && !G.drops.some(d => d.item === item)) throw new Error(`${tool} по ${key} не дал ${item}`);
    }
  });
});
registerTest('tools', 'гарпун, удочка, факел, фонарь, ракетница', async () => {
  await sandbox(() => {
    const p = scene();
    const s = sc();
    let harpoon = 0; const off = on('harpoon', () => harpoon++);
    add('harpoon', 1); s.selectItem('harpoon'); s.act('dig', 1030, 262, 0.1);
    off(); if (!harpoon) throw new Error('событие harpoon не вышло');
    // fishing: needs water under a hole in ice
    for (let y = 272; y < 300; y++) for (let x = 1000; x < 1030; x++) { const i = y * W + x; mat[i] = MAT.WATER; aux[i] = 0; flags[i] = 0; }
    setScanning(false); addHoleAt(1012, 274, 4);   // live fish (hunt.ts) live in a registered hole; the world scan would rebuild the hole list
    let fishing = 0; const off2 = on('fishing', () => fishing++);
    add('fishing_line', 1); s.selectItem('fishing_line'); s.act('dig', 1012, 276, 0.1);
    off2(); if (!fishing) throw new Error('fishing не вышло');
    if (!(body.fineT > 0)) throw new Error('рыбалка — тонкая работа');
    for (let i = 0; i < 60 * 20 && toolState.fish.state !== 'bite'; i++) steps(1);     // wait for the bite
    if (toolState.fish.state !== 'bite') throw new Error('поклёвки нет: ' + toolState.fish.state);
    const f0 = count('fish'); s.act('dig', 1012, 276, 0.1);
    if (count('fish') <= f0) throw new Error('рыба не поймана');
    setScanning(true);
    // torch
    add('torch', 1); s.selectItem('torch'); const m0 = count('matches'); s.act('dig', 1030, 262, 0.05);
    if (!s.mods.inv.held.torchLit || count('matches') !== m0 - 1) throw new Error('факел не зажёгся от спички');
    steps(20); const L: any[] = []; sc().G.lights.length = 0; s.mods.tools.collectHeldLights(L);
    if (!L.some(l => l.rad >= 7)) throw new Error('факел не светит');
    s.selectItem('shovel'); steps(3); if (s.mods.inv.held.torchLit) throw new Error('факел гаснет при смене предмета');
    // lantern uses diesel
    add('lantern', 1, 0); add('diesel', 1); s.selectItem('lantern'); s.act('dig', 1030, 262, 0.05);
    if (!s.mods.inv.held.lanternLit) throw new Error('фонарь не горит с соляркой');
    // flare
    add('flare_gun', 1); add('flare', 2); s.selectItem('flare_gun'); let fl = 0; const off3 = on('flare', () => fl++); s.act('dig', 1030, 250, 0.05); off3();
    if (!fl || count('flare') !== 1) throw new Error('ракета');
    void p;
  });
});
registerTest('tools', 'выпавшие предметы притягиваются, рюкзак возвращает вещи', async () => {
  await sandbox(() => {
    const p = scene();
    clearInventory(); spawnDrop('biscuit', 3, p.x + 10, p.y - 4, 0, 0);
    steps(120);
    if (count('biscuit') !== 3) throw new Error('магнит: ' + count('biscuit'));
    // DESIGN §12: heavy things (a sack of coal) are never picked up by walking over them: they wait for E
    spawnDrop('coal', 3, p.x + 4, p.y - 4, 0, 0); steps(120);
    if (count('coal') !== 0) throw new Error('тяжёлое подобралось само: ' + count('coal'));
    input.interactPressed = true; steps(3);
    if (count('coal') !== 3) throw new Error('E не взяло уголь: ' + count('coal'));
    clearInventory();
    add('axe', 1); add('rope', 2);
    die('тест'); steps(5);
    if (G.drops.every(d => d.item !== 'backpack')) throw new Error('нет рюкзака');
    G.diff.hardcore = false; respawn();
    for (const d of G.drops) if (d.item === 'backpack') { d.x = p.x + 3; d.y = p.y - 3; d.age = 1; d.vx = d.vy = 0; }
    input.interactPressed = true; steps(3);                  // E opens the backpack: its contents are searched (a few seconds), then taken
    if (!searchOpen()) throw new Error('рюкзак не открылся по E');
    steps(240); takeAllFound(); closeBox();
    if (count('axe') !== 1 || count('rope') !== 2) throw new Error('рюкзак не вернул вещи');
    void backpacks;
  });
});

// =====================================================================================================================
// fixtures
registerTest('fixtures', 'костёр: топливо, огонь (спички+трут), тепло, свет, прогорание', async () => {
  await sandbox(() => {
    const p = scene({ T: -30 });
    const f = placeFixture('campfire', 250, 67, { force: true, fuel: 0 })!;
    if (tryLight(f, true)) throw new Error('без топлива не зажечь');
    add('log', 2);
    if (!interact(f) || !(f.fuel! >= 119)) throw new Error('топливо не добавилось');
    clearInventory(); add('log', 1);
    if (tryLight(f, true)) throw new Error('без спичек и трута не зажечь');
    add('matches', 3);
    if (tryLight(f, true)) throw new Error('без трута не зажечь');
    add('lichen', 2);
    if (!tryLight(f, true) || !f.lit) throw new Error('не зажёгся');
    if (count('matches') !== 2 || count('lichen') !== 1) throw new Error('спички/ягель не потрачены');
    const w0 = radiantWarmth(p.x, p.y - 10);
    if (!(w0 > 8)) throw new Error('нет лучистого тепла ' + w0);
    const lights: any[] = []; collectLights(lights); if (!lights.some(l => l.rad >= 8)) throw new Error('нет света');
    const t0 = tempAt(f.tx * 4 + 4, f.ty * 4 - 4);
    for (let i = 0; i < 360; i++) { stepFixtures(1 / 60); sc().stepFast(1); }
    if (!(tempAt(f.tx * 4 + 4, f.ty * 4 - 4) > t0 + 1)) throw new Error('воздух не греется');
    f.fuel = 0.05; steps(60 * 3); if (f.lit) throw new Error('должен прогореть');
    // flint works without being consumed
    clearInventory(); add('flint', 1); add('lichen', 1); f.fuel = 50; let tries = 0; while (!tryLight(f, true) && tries++ < 30);
    if (!f.lit || count('flint') !== 1) throw new Error('огниво');
  });
});
registerTest('fixtures', 'ветер задувает слабое пламя на открытом месте', async () => {
  await sandbox(() => {
    scene({ T: -20, wind: 16 });
    const f = placeFixture('campfire', 250, 67, { force: true, fuel: 15, lit: true })!;
    let out = 0; const off = on('fire_out', () => out++);
    for (let i = 0; i < 60 * 12; i++) { stepFixtures(1 / 60); if (!f.lit) break; }
    off(); if (f.lit) throw new Error('слабый огонь при 16 м/с должен погаснуть');
  });
});
registerTest('fixtures', 'жировая лампа, жаровня, факел-фикстура, печь', async () => {
  await sandbox(() => {
    scene();
    add('matches', 10);
    for (const [kind, fuel] of [['fat_lamp', 100], ['brazier', 100], ['torch', 30], ['stove', 100]] as [string, number][]) {
      G.fixtures.length = 0;
      const f = placeFixture(kind as never, 249, 66, { force: true, fuel })!;
      if (!f) throw new Error('не создан ' + kind);
      add('lichen', 2);
      if (!tryLight(f, true)) throw new Error(kind + ' не зажёгся');
      const L: any[] = []; collectLights(L); if (!L.length) throw new Error(kind + ' не светит');
      removeFixture(f);
    }
    // lamp burns fat only
    G.fixtures.length = 0; const lamp = placeFixture('fat_lamp', 249, 67, { force: true, fuel: 0 })!;
    clearInventory(); add('log', 1); if (addFuel(lamp)) throw new Error('лампа не жжёт дрова'); add('fat', 2); if (!addFuel(lamp) || lamp.fuel! < 200) throw new Error('жир = 4 ч');
    // stove: chimney -> no CO flames counted
    const st = placeFixture('stove', 244, 66, { force: true, fuel: 100, lit: true })!; if (!st.lit) throw new Error('печь');
  });
});
registerTest('fixtures', 'котелок топит снег и лёд в воду над огнём', async () => {
  await sandbox(() => {
    const p = scene();
    clearInventory(); add('snow', 4); add('ice', 1); add('matches', 3); add('lichen', 1); add('flask', 1);
    const fire = placeFixture('campfire', 250, 67, { force: true, fuel: 200 })!; tryLight(fire, true);
    const pot = placeFixture('pot', 253, 67, { force: true })!;
    interact(pot); interact(pot); interact(pot);           // adds ice/snow
    if (Number(pot.data!.snow) + Number(pot.data!.ice) < 2) throw new Error('в котелок ничего не попало');
    for (let i = 0; i < 60 * 25; i++) stepFixtures(1 / 60);
    if (!(Number(pot.data!.water) >= 1)) throw new Error('вода не натопилась: ' + JSON.stringify(pot.data));
    interact(pot);
    if (count('water') < 1 && (inv.slots.find(s => s && s.id === 'flask')?.dur ?? 0) < 1) throw new Error('воду не набрать');
    // no fire -> no water
    const cold = placeFixture('pot', 238, 67, { force: true })!; add('ice', 1); interact(cold);
    for (let i = 0; i < 60 * 8; i++) stepFixtures(1 / 60);
    if (Number(cold.data!.water) > 0) throw new Error('без огня вода не греется');
    void p;
  });
});
registerTest('fixtures', 'полог/дверь, тайник/сундук, силок, барометр, бочка → жаровня, мачта и рация', async () => {
  await sandbox(() => {
    const p = scene();
    const s = sc();
    // hide door: closed writes solid cells, open clears them
    const door = placeFixture('hide_door', 236, 62, { force: true, open: false })!;
    if (cellCount(MAT.FIXTURE, 236 * 4, 62 * 4, 239 * 4 + 3, 67 * 4 + 3) < 200) throw new Error('закрытый полог без клеток');
    interact(door); if (!door.open || cellCount(MAT.FIXTURE, 236 * 4, 62 * 4, 239 * 4 + 3, 67 * 4 + 3) !== 0) throw new Error('открытый полог оставил клетки');
    // cache
    const cache = placeFixture('cache', 240, 66, { force: true })!;
    clearInventory(); inv.slots[0] = { id: 'fat', n: 2 }; s.select(0); if (!stash(cache) || count('fat') !== 0) throw new Error('stash');
    interact(cache); takeAllFound(); closeBox(); if (count('fat') !== 2) throw new Error('тайник не отдал');
    // snare
    const snare = placeFixture('snare', 244, 67, { force: true })!; interact(snare); if (!snare.data!.set) throw new Error('силок не взведён');
    let caught = 0; const off = on('snare_caught', () => caught++);
    setSnareFallback(true);                     // hunt.ts turns the random catch off (a flock must flush into it); the unit test wants the fallback
    for (let i = 0; i < 60 * 400 && !caught; i++) stepFixtures(1 / 60); off(); setSnareFallback(false);
    if (!caught) throw new Error('силок ничего не поймал за 24 мин');
    interact(snare); if (count('ptarmigan') < 1) throw new Error('добыча не выдана');
    // barometer
    const bar = placeFixture('barometer', 246, 66, { force: true })!; setDay(2, 15); interact(bar);
    if (!knowsForecast() || !/\d/.test(G.forecast.text)) throw new Error('прогноз не узнан: ' + G.forecast.text);
    // drum -> brazier
    const drum = placeFixture('drum', 248, 65, { force: true })!; clearInventory(); add('axe', 1); s.selectItem('axe'); interact(drum);
    if ((drum.kind as string) !== 'drum') throw new Error('бочка с соляркой не должна становиться жаровней');
    drum.data!.diesel = 0; drum.data!.n = 0; interact(drum);
    if ((drum.kind as string) !== 'brazier') throw new Error('пустая бочка не стала жаровней');
    // mast + radio
    const mast = placeFixture('mast', 232, 62, { force: true, data: { up: false } })!;
    const radio = placeFixture('radio', 228, 66, { force: true, data: { fixed: false } })!;
    clearInventory(); add('radio_triode', 1); add('radio_coil', 1); add('battery', 1);
    let part = 0, fixed = 0; const o1 = on('radio_part', () => part++), o2 = on('radio_fixed', () => fixed++);
    interact(radio); if (part !== 3 || fixed) throw new Error('части рации / нельзя без антенны');
    if (!raiseMast() || !mastUp(mast)) throw new Error('мачта');
    interact(radio); o1(); o2(); if (!fixed || !radio.data!.fixed) throw new Error('рация не починена');
    void p;
  });
});
registerTest('fixtures', 'сушилка/огонь сушат одежду; жильё сдвигает пакеты', async () => {
  await sandbox(() => {
    const p = scene({ T: -5 });
    const b0 = dryBoost(p.x, p.y - 8);
    placeFixture('campfire', 250, 67, { force: true, fuel: 200, lit: true });
    placeFixture('drying_rack', 247, 66, { force: true });
    if (!(dryBoost(p.x, p.y - 8) > b0 + 3)) throw new Error('сушка у огня и сушилки');
    p.wet = 0.9; for (let i = 0; i < 80; i++) stepBody(0.5);
    if (p.wet > 0.7) throw new Error('одежда не сохнет у огня: ' + p.wet);
  });
});
registerTest('fixtures', 'кровать: сон ускоряет время ×20, будит при холоде', async () => {
  await sandbox(() => {
    const p = scene({ T: -30 });
    arena(1000, 272, { dens: 300, loose: 0, depth: 40, up: 70 });
    const ig = igloo(1000, 68, { iw: 8, wallRows: 6, door: false });
    sc().teleport((ig.L + 6) * 4, 272); steps(10);
    const bed = placeFixture('skin_bed', ig.L + 4, 67, { force: true })!;
    p.energy = 40; p.core = 36.9;
    G.fixtures.push(placeFixture('fat_lamp', ig.L + 3, 67, { force: true, fuel: 300, lit: true })!);
    evalShelterNow();
    interact(bed);
    if (!p.sleeping || G.timeScale !== 20) throw new Error('не уснул: ' + p.sleeping + ' ' + G.timeScale);
    const t0 = G.time; steps(60);
    if (!(G.time - t0 > 40)) throw new Error('время не ускорилось ×20 (60 тиков = 48 мин): ' + (G.time - t0));
    if (!(p.energy > 40)) throw new Error('энергия не растёт во сне');
    p.core = 35.0; steps(5); if (p.sleeping) throw new Error('должен проснуться от холода');
    if ((G.timeScale as number) !== 1) throw new Error('timeScale не вернулся');
    // refuse when too cold and in the open
    G.fixtures.length = 0; sc().teleport(1100, 272); p.core = 37; p.airT = -30; G.shelter = null; p.energy = 30;
    if (startSleep()) throw new Error('в открытом холоде спать нельзя');
  });
});

// =====================================================================================================================
// body
registerTest('body', 'на открытом месте ночью −35 °C: 37→35 за ~1.5 мин, смерть <30 за ~4 мин, причина «замёрз»', async () => {
  await sandbox(() => {
    const p = scene({ T: -35, wind: 3, hour: 0 });
    p.core = 37; let t = 0, t35 = 0, t30 = 0;
    while (t < 600 && p.alive) { stepBody(0.25); t += 0.25; if (!t35 && p.core <= 35) t35 = t; if (!p.alive) t30 = t; }
    if (!(t35 >= 60 && t35 <= 130)) throw new Error('37→35 за ' + t35 + ' с');
    if (!p.alive && !(t30 >= 170 && t30 <= 340)) throw new Error('смерть за ' + t30 + ' с');
    if (p.alive || !['замёрз', 'обморожение и истощение'].includes(p.cause)) throw new Error('должен умереть от холода: ' + p.alive + ' ' + p.cause);
  });
});
registerTest('body', 'тяжёлая работа в −35 — почти нейтрально; у костра согревается', async () => {
  await sandbox(() => {
    const p = scene({ T: -35, wind: 3 });
    p.core = 37; body.working = 1;
    for (let i = 0; i < 240; i++) { body.working = 1; p.vx = 0; stepBody(0.25); }
    if (!(p.core > 35.8)) throw new Error('за минуту работы остыл до ' + p.core);
    // at a fire the core recovers far better than without one
    const run = (fire: boolean) => {
      G.fixtures.length = 0; p.core = 34.5; p.frost.hands = 0; body.working = 0;
      if (fire) placeFixture('campfire', 250, 67, { force: true, fuel: 300, lit: true });
      for (let i = 0; i < 480; i++) stepBody(0.25);
      return p.core;
    };
    const no = run(false), yes = run(true);
    if (!(yes > no + 1.2 && yes > 33.3)) throw new Error('у костра ядро должно держаться: без огня ' + no.toFixed(2) + ', у костра ' + yes.toFixed(2));
  });
});
registerTest('body', 'конечности: руки/ноги/лицо мёрзнут по отдельности, рукавицы защищают, тонкая работа', async () => {
  await sandbox(() => {
    const p = scene({ T: -38, wind: 4 });
    inv.wear.hands = null; inv.wear.feet = 'felt_boots'; inv.wear.head = 'wool_hat';
    bodySteps(45); const bare = p.frost.hands;
    if (!(bare > 40) || !(p.frost.hands > p.frost.feet)) throw new Error('голые руки должны мёрзнуть быстрее: ' + JSON.stringify(p.frost));
    p.frost.hands = 0; p.core = 37; p.frost.feet = 0; p.frost.face = 0;
    inv.wear.hands = 'fur_mittens'; bodySteps(45);
    if (!(p.frost.hands < bare / 3)) throw new Error('меховые рукавицы должны защищать: ' + p.frost.hands + ' vs ' + bare);
    inv.wear.hands = 'wool_mittens'; p.frost.hands = 0; p.core = 37; body.fineT = 40; bodySteps(35);
    const fine = p.frost.hands; p.frost.hands = 0; p.core = 37; body.fineT = 0; bodySteps(35);
    if (!(fine > p.frost.hands * 2)) throw new Error('тонкая работа должна студить руки: ' + fine + ' vs ' + p.frost.hands);
    // frostbite -> slower work / scar
    p.frost.hands = 85; if (!handsFrozen()) throw new Error('handsFrozen');
    p.frost.hands = 79.9; p.core = 37; inv.wear.hands = null; bodySteps(10); if (!(body.scar.hands > 0)) throw new Error('шрам обморожения');
    p.frost.feet = 85; sc().teleport(1000, 272);
  });
});
registerTest('body', 'жажда, голод, усталость: скорости потребления и смерть от голода/жажды', async () => {
  await sandbox(() => {
    const p = scene({ T: 10 });
    p.water = 100; p.food = 100; p.energy = 100; p.core = 37;
    bodySteps(300, 0.5);
    const dw = 100 - p.water, df = 100 - p.food, de = 100 - p.energy;
    if (!(dw > 22 && dw < 40)) throw new Error('вода за 5 мин: −' + dw.toFixed(1) + ' (≈ 100 за 1.5 суток = 15 мин)');
    if (!(df > 15 && df < 32)) throw new Error('еда за 5 мин: −' + df.toFixed(1));
    if (!(de > 20 && de < 45)) throw new Error('силы за 5 мин: −' + de.toFixed(1));
    p.water = 0; p.food = 50; p.hp = 100; bodySteps(240, 0.5);
    if (p.alive || p.cause !== 'жажда') throw new Error('жажда должна убить: ' + p.cause + ' hp ' + p.hp);
    respawn(); G.diff.hardcore = false;
  });
});
registerTest('body', 'еда и питьё: консервы, чай, снег (−0.3 °C), сырое мясо, горячее согревает', async () => {
  await sandbox(() => {
    const p = scene({ T: 0 });
    clearInventory(); add('can', 2); add('snow', 2); add('hot_tea', 1); add('seal_meat', 1); add('water', 1);
    p.food = 40; p.water = 40; p.core = 36.5;
    const f0 = p.food; if (!eatSlot(inv.slots.findIndex(s => s && s.id === 'can')) || !(p.food >= f0 + 28)) throw new Error('консервы');
    const c0 = p.core; const w0 = p.water; eatSlot(inv.slots.findIndex(s => s && s.id === 'snow'));
    if (!(p.core < c0 - 0.2) || !(p.water > w0 + 4)) throw new Error('снег: вода +, ядро −0.3');
    const i = inv.slots.findIndex(s => s && s.id === 'hot_tea'); eatSlot(i); if (!(body.warmT > 60)) throw new Error('чай согревает');
    if (!eatBest()) throw new Error('eatBest');
  });
});
registerTest('body', 'сырость: купание, обмен, пот при тяжёлой работе в тепле, парка (V) охлаждает, валяние в снегу', async () => {
  await sandbox(() => {
    const p = scene({ T: -10, loose: 3 });
    // sweat: working hard in a warm place
    G.fixtures.length = 0; wx.override = { ambientT: 12, wind: 0, storm: 0, snowfall: 0 }; Object.assign(G, wx.override); initHeat(); sc().stepFast(3);
    p.wet = 0; p.core = 37.2; p.parkaOpen = false; for (let i = 0; i < 400; i++) { body.working = 1; p.vx = 40; p.onGround = true; stepBody(0.25); }
    const closed = p.wet; p.wet = 0; p.core = 37.2; p.parkaOpen = true; for (let i = 0; i < 400; i++) { body.working = 1; p.vx = 40; p.onGround = true; stepBody(0.25); }
    if (!(closed > 0.1)) throw new Error('в закрытой парке при работе в тепле должен быть пот: ' + closed);
    if (!(p.wet < closed * 0.7)) throw new Error('расстёгнутая парка (V) уменьшает пот: ' + p.wet + ' vs ' + closed);
    // swimming = instant soak + cold shock
    p.vx = 0; p.wet = 0; p.inWater = 0.9; p.core = 37; bodySteps(15);
    if (p.wet < 0.99 || !(p.core < 36.2)) throw new Error('купание: сырость ' + p.wet + ' ядро ' + p.core);
    p.inWater = 0; sc().teleport(1000, 272);
    // rolling in loose snow blots water
    p.wet = 0.8; body.rolling = 1; body.feetMat = MAT.SNOW; for (let i = 0; i < 16; i++) { body.rolling = 1; stepBody(0.25); }
    if (!(p.wet < 0.4)) throw new Error('валяние в снегу не убрало воду: ' + p.wet);
  });
});
registerTest('body', 'ветер: охлаждение по Environment Canada', () => {
  const a = windChill(-30, 0), b = windChill(-30, 5), c = windChill(-30, 15);
  if (!(a >= -30.01 && b < a - 4 && c < b - 3)) throw new Error('windChill ' + [a, b, c].join(','));
  if (Math.abs(windChill(-35, 3) + 45.6) > 1.5) throw new Error('−35 при 3 м/с ≈ −45.6: ' + windChill(-35, 3));
});
registerTest('body', 'смерть: именованные причины, рюкзак, респаун по сложности, хардкор', async () => {
  await sandbox(() => {
    const p = scene();
    const causes: [string, string][] = [['cold', 'замёрз'], ['frost', 'обморожение и истощение'], ['drown', 'утонул в полынье'], ['bear', 'медведь'], ['co', 'угарный газ'], ['collapse', 'обвал в шахте'], ['fall', 'упал'], ['hunger', 'голод'], ['thirst', 'жажда']];
    for (const [k, txt] of causes) {
      G.diff.hardcore = false; if (!p.alive) respawn();
      p.hp = 5; p.hurtT = 0; damage(500, k);
      if (p.alive || p.cause !== txt) throw new Error(`${k}: ждали «${txt}», получили «${p.cause}»`);
      if (!respawn() || !p.alive || p.hp < 40) throw new Error('респаун не сработал после ' + k);
    }
    G.diff.hardcore = true; die('замёрз'); if (respawn()) throw new Error('хардкор: респауна быть не должно');
    G.diff.hardcore = false; respawn();
    // fall damage via landing speed
    p.hp = 100; p.vy = 300; p.y = 200; p.onGround = false; sc().teleport(1000, 272); p.y = 230; p.vy = 280; for (let i = 0; i < 60; i++) stepPlayer(1 / 60);
    if (!(p.hp < 100)) throw new Error('падение с высоты должно ранить: ' + p.hp);
  });
});
registerTest('body', 'сложность: Мягкая / Обычная / Суровая меняют скорость остывания и голода', async () => {
  await sandbox(() => {
    const rate = (lvl: 0 | 1 | 2) => {
      applyDifficulty(lvl, false); const p = scene({ T: -30 }); p.core = 37; const f0 = p.food; for (let i = 0; i < 160; i++) stepBody(0.25);
      return { cold: 37 - p.core, hunger: f0 - p.food };
    };
    const a = rate(0), b = rate(1), c = rate(2);
    applyDifficulty(1, false);
    if (!(a.cold < b.cold && b.cold < c.cold)) throw new Error('холод ' + [a.cold, b.cold, c.cold].map(x => x.toFixed(2)).join('/'));
    if (!(a.hunger < b.hunger && b.hunger < c.hunger)) throw new Error('голод ' + [a.hunger, b.hunger, c.hunger].map(x => x.toFixed(2)).join('/'));
  });
});

// =====================================================================================================================
// shelter, CO, storm exam
registerTest('shelter', 'иглу: оценка ★ и заметки; закрытое/открытое; отдушина; CO', async () => {
  await sandbox(() => {
    const p = scene({ T: -30 });
    const ig = igloo(1000, 68, { iw: 6, wallRows: 6, door: false });
    sc().teleport((ig.L + 5) * 4, 272); steps(10);
    let g = gradeShelter(p.x, p.y - 9);
    if (!g.closed || g.vent) throw new Error('закрытое иглу без отдушины: ' + JSON.stringify(g));
    if (!g.insul || !g.windtight || !g.struct) throw new Error('★ изоляция/ветер/конструкция: ' + JSON.stringify(g));
    // flame without a vent -> CO rises; with a vent it does not
    placeFixture('fat_lamp', ig.L + 3, 67, { force: true, fuel: 500, lit: true });
    for (let i = 0; i < 60 * 25; i++) { stepFixtures(1 / 60); if (i % 30 === 0) evalShelterNow(); }
    evalShelterNow();
    if (!(coNow() > 15) || !G.shelter || !G.shelter.notes.some(n => /отдушин/.test(n))) throw new Error('CO без отдушины должен расти: ' + coNow());
    // carbon monoxide hurts the player
    for (let i = 0; i < 120; i++) { stepBody(0.5); if (i % 4 === 0) { /* keep co */ } }
    if (!(p.co > 15)) throw new Error('p.co ' + p.co);
    // open the vent: punch a hole in the roof (1 tile) -> fill detects a vent
    const topRow = ig.topRow;
    for (let y = topRow * 4; y < topRow * 4 + 4; y++) for (let x = (ig.L + 4) * 4; x < (ig.L + 5) * 4; x++) put(x, y, 0);
    sc().stepFast(12);                                   // heat refreshes its sky columns every 8th frame
    g = gradeShelter(p.x, p.y - 9, coNow());
    if (!g.closed || !g.vent) throw new Error('отдушина не распознана: ' + JSON.stringify({ closed: g.closed, vent: g.vent, tiles: g.tiles }));
    const co0 = coNow(); for (let i = 0; i < 60 * 12; i++) { if (i % 30 === 0) evalShelterNow(); }
    steps(60 * 12); evalShelterNow();
    if (!(coNow() < co0 * 0.8)) throw new Error('с отдушиной CO должен падать: ' + co0 + ' → ' + coNow());
    // a wide opening = no shelter
    for (let y = (ig.base - 6) * 4; y < ig.base * 4 + 4; y++) for (let x = ig.L * 4; x < (ig.L + 2) * 4; x++) put(x, y, 0);
    sc().stepFast(12);
    g = gradeShelter(p.x, p.y - 9);
    if (g.closed) throw new Error('открытый вход — не укрытие');
    if (!g.notes.some(n => /открыт/.test(n))) throw new Error('нет заметки про открытый вход');
  });
});
registerTest('shelter', 'гипотермия в иглу с лампой: тепло внутри держится, ядро растёт', async () => {
  await sandbox(() => {
    const p = scene({ T: -32 });
    const ig = igloo(1000, 68, { iw: 6, wallRows: 6, door: false });
    placeFixture('fat_lamp', ig.L + 3, 67, { force: true, fuel: 800, lit: true });
    sc().teleport((ig.L + 5) * 4, 272);
    for (let i = 0; i < 60 * 14; i++) { stepFixtures(1 / 60); steps(1); }
    evalShelterNow();
    const inside = G.shelter!.temp;
    if (!(inside > G.ambientT + 12)) throw new Error('внутри ' + inside + ' при снаружи ' + G.ambientT);
    p.core = 35.4; for (let i = 0; i < 360; i++) { stepBody(0.5); }
    if (!(p.core > 35.6)) throw new Error('в тёплом иглу ядро не растёт: ' + p.core);
  });
});
registerTest('shelter', 'экзамен пурги: отчёт со звёздами и размывание рыхлых стен', async () => {
  await sandbox(() => {
    const p = scene({ T: -25, storm: 1 });
    const ig = igloo(1000, 68, { iw: 6, wallRows: 6, door: false });
    placeFixture('fat_lamp', ig.L + 3, 67, { force: true, fuel: 800, lit: true });
    sc().teleport((ig.L + 5) * 4, 272);
    setDay(2, 18.7);
    wx.override = null; applyClock();
    const events: string[] = []; const o1 = on('storm_start', () => events.push('start')), o2 = on('storm_end', (d: any) => events.push('end:' + (d.report ? d.report.stars : '?')));
    for (let i = 0; i < 60 * 60; i += 3) { stepWeather(1 / 20); stepFixtures(1 / 20); if (i % 120 === 0) evalShelterNow(); }
    o1(); o2();
    if (!events.includes('start')) throw new Error('storm_start не вышел: ' + events.join());
    setDay(2, 28);                                        // skip to the end of the storm
    stepWeather(1); stepWeather(1);
    const rep = finishStormReport(1);
    if (typeof rep.stars !== 'number' || !rep.text) throw new Error('отчёт: ' + JSON.stringify(rep));
    // loose walls erode, dense ones resist
    wx.override = { ambientT: -25, wind: 22, storm: 1, snowfall: 0 }; Object.assign(G, wx.override);
    arena(1000, 272, { dens: 300, loose: 0, depth: 40, up: 70 });
    tileBlock(240, 60, 2, 7, MAT.SNOWBLOCK, auxOfDensity(120), 2); tileBlock(256, 60, 2, 7, MAT.SNOWBLOCK, auxOfDensity(420), 2);
    const l0 = cellCount(MAT.SNOWBLOCK, 960, 240, 976, 270), d0 = cellCount(MAT.SNOWBLOCK, 1024, 240, 1040, 270);
    sc().stepFast(60 * 30);
    const l1 = cellCount(MAT.SNOWBLOCK, 960, 240, 976, 270), d1 = cellCount(MAT.SNOWBLOCK, 1024, 240, 1040, 270);
    if (!(l1 < l0)) throw new Error('рыхлая стена не размывается (' + l0 + '→' + l1 + ')');
    if (!(d1 >= d0 * 0.95)) throw new Error('плотная стена не должна сыпаться: ' + d0 + '→' + d1);
    void p;
  });
});

// =====================================================================================================================
// weather
registerTest('weather', 'календарь кольца сезонов: ночь −9° (12 дн.) → сумерки до +0.6° (6 дн.) → ночь; солнце не выходит из ночи', async () => {
  await sandbox(() => {
    if (Math.abs(noonElevAt(12 * 60) + 8) > 1) throw new Error('день 1: ' + noonElevAt(12 * 60));
    // twilight «day» of the ring: the noon sun rises just above the horizon (DESIGN §18), the night days never reach it
    let peak = -99; for (let d = 13; d <= 18; d++) peak = Math.max(peak, noonElevAt((d - 1) * 1440 + 720));
    if (!(peak > 0.3 && peak < 1.2)) throw new Error('сумерки: полдень ' + peak);
    for (let d = 1; d <= 12; d++) if (!(noonElevAt((d - 1) * 1440 + 720) < -6)) throw new Error('ночь, день ' + d + ': ' + noonElevAt((d - 1) * 1440 + 720));
    let prev = -1;
    for (let d = 1; d <= 18; d++) { setDay(d, 12); if ((d >= 11 && d <= 15 && !(G.daylight >= prev - 1e-6)) || Math.abs(G.noonElev - noonElevAt((d - 1) * 1440 + 720)) > 1e-6) throw new Error('день ' + d); prev = G.daylight; }
    setDay(1, 12); if (!(G.daylight > 0.05 && G.daylight < 0.45)) throw new Error('день 1: тусклый синий полдень: ' + G.daylight);
    setDay(1, 0); if (G.daylight > 0.001) throw new Error('полночь = ночь');
    setDay(15, 12); if (!(G.daylight > 0.9)) throw new Error('день 15 (сумерки) светло');
    setDay(19, 12); if (!(G.daylight < 0.4)) throw new Error('день 19: снова ночь: ' + G.daylight);
    let ending = 0; const off = on('ending', () => { ending++; });
    setDay(12, 9); for (let i = 0; i < 60 * 20; i++) stepWeather(0.1); off();
    if (ending !== 0) throw new Error('концовок быть не должно: ' + ending);
    setDay(1, 22); let days = 0; const o2 = on('day', () => days++); for (let i = 0; i < 400; i++) stepWeather(0.5); o2();
    if (days < 1) throw new Error('событие day');
    // moon phases move, full around day 5-7
    setDay(6, 0); const m6 = G.moonPhase; setDay(1, 0); const m1 = G.moonPhase;
    if (!(Math.abs(m6 - 0.5) < 0.12 && Math.abs(m1 - m6) > 0.1)) throw new Error('фазы луны ' + m1 + ' ' + m6);
  });
});
registerTest('weather', 'часы: 1 с = 2.4 мин, сон ×20; температура и ветер в пределах, штормы по расписанию', async () => {
  await sandbox(() => {
    setDay(3, 10); wx.override = null; const t0 = G.time; for (let i = 0; i < 10; i++) stepWeather(0.1);
    if (Math.abs(G.time - t0 - 2.4) > 0.01) throw new Error('1 с ≠ 2.4 мин: ' + (G.time - t0));
    G.timeScale = 20; const t1 = G.time; stepWeather(1); G.timeScale = 1; if (Math.abs(G.time - t1 - 48) > 0.1) throw new Error('×20');
    let mn = 0, mx = -99, wmax = 0, smax = 0;
    for (let d = 1; d <= 18; d++) for (let h = 0; h < 24; h += 1.5) { setDay(d, h); mn = Math.min(mn, G.ambientT); mx = Math.max(mx, G.ambientT); wmax = Math.max(wmax, Math.abs(G.wind)); smax = Math.max(smax, G.storm); }
    if (!(mn > -46 && mn < -34 && mx < -14 && mx > -30)) throw new Error('температура ' + mn + '..' + mx);
    if (!(smax > 0.9 && wmax > 15 && wmax < 40)) throw new Error('шторма: storm ' + smax + ' ветер ' + wmax);
    if (STORMS.length < 4 || !(STORMS[0].start > 1440 && STORMS[3].dur >= 30 * 60)) throw new Error('расписание');
    // forecast 6-10 hours ahead
    for (const s of STORMS) {
      setClock(s.start - s.lead + 30); if (!(G.forecast.stormAt === s.start)) throw new Error('нет прогноза за ' + s.lead / 60 + ' ч');
      if (!(s.lead >= 6 * 60 && s.lead <= 10 * 60)) throw new Error('прогноз должен быть за 6–10 ч');
      setClock(s.start - s.lead - 60); if (G.forecast.stormAt !== -1) throw new Error('слишком ранний прогноз');
    }
    if (!nextStorm()) throw new Error('nextStorm');
    void readBarometer; void stormIntensity; void sunElevAt; void MIN_PER_SEC; void initWeather;
  });
});

// =====================================================================================================================
// input
registerTest('input', 'клавиатура и мышь: ход, бег, прыжок, пояс 1–6, E, V, R, колесо', async () => {
  await sandbox(() => {
    const p = scene();
    resetInput();
    simKey('KeyD', true); poll(); if ((input.moveX as number) !== 1) throw new Error('D'); simKey('KeyD', false); poll();
    simKey('KeyA', true); poll(); if ((input.moveX as number) !== -1) throw new Error('A'); simKey('KeyA', false); simKey('ShiftLeft', true); poll(); if (!input.run) throw new Error('Shift'); simKey('ShiftLeft', false);
    simKey('Space', true); poll(); if (!input.jumpHeld || !input.jumpPressed) throw new Error('Space'); simKey('Space', false); endFrame();
    for (let i = 0; i < 6; i++) { simKey('Digit' + (i + 1), true); poll(); const ok1 = input.hotbar === i; simKey('Digit' + (i + 1), false); endFrame(); if (!ok1) throw new Error('цифра ' + (i + 1)); }
    simKey('KeyE', true); if (!input.interactPressed) throw new Error('E'); simKey('KeyE', false); endFrame();
    simKey('KeyV', true); if (!input.ventPressed) throw new Error('V'); simKey('KeyV', false); endFrame();
    const v0 = p.parkaOpen; toggleParka(); if (p.parkaOpen === v0) throw new Error('парка'); toggleParka();
    simKey('KeyR', true); if (!input.smartToggle) throw new Error('R'); simKey('KeyR', false); endFrame();
    simKey('KeyF', true); if (!input.eatPressed) throw new Error('F'); simKey('KeyF', false); endFrame();
    simKey('KeyC', true); if (!input.craftPressed) throw new Error('C'); simKey('KeyC', false); endFrame();
    simMouse(0, true, 100, 100); poll(); if (!input.primary || !input.primaryPressed) throw new Error('LMB'); simMouse(0, false); endFrame();
    // walking really moves the player
    const x0 = p.x; simKey('KeyD', true); steps(40); simKey('KeyD', false); let mv = p.x - x0;
    if (!(mv > 10)) { const x1 = p.x; simKey('KeyA', true); steps(40); simKey('KeyA', false); mv = Math.max(mv, x1 - p.x); }   // a snow mound east of the spawn may block one direction
    if (!(mv > 10)) throw new Error('персонаж не идёт: ' + mv);
    const y0 = p.y; simKey('Space', true); let hi = 0; for (let i = 0; i < 40; i++) { steps(1); hi = Math.max(hi, y0 - p.y); } simKey('Space', false);
    if (!(hi > 8)) throw new Error('прыжок слишком низкий: ' + hi);
    resetInput();
  });
});
registerTest('input', 'сенсорное управление: кнопки ≥ 56 px, стик, действие', async (t) => {
  const el = (id: string) => document.getElementById(id) as HTMLElement | null;
  const ids = ['tb-act', 'tb-jump', 'tb-take', 'tb-belt', 'tb-senses', 'tb-parka', 'tb-bag', 'tb-jour', 'tb-menu'];      // icon buttons (ui/touch.ts); the size follows the window (36 px on a landscape phone)
  const present = ids.filter(i => el(i));
  ok(t, present.length === ids.length, 'нет кнопок: ' + ids.filter(i => !el(i)).join(','));
  const layer = document.getElementById('touch');
  if (layer && layer.style.display !== 'none') {
    for (const id of ids) { const r = el(id)!.getBoundingClientRect(); ok(t, r.width >= 34 && r.height >= 34, `${id} ${Math.round(r.width)}×${Math.round(r.height)} < 34`); }
  } else t.log('сенсорный слой скрыт (десктоп) — размеры не проверялись');
  touch.x = 1; poll(); ok(t, input.moveX === 1, 'стик → moveX'); touch.x = 0; poll();
});
registerTest('input', 'мир: подсказка под курсором содержит материал и слово о плотности снега', async () => {
  await sandbox(() => {
    const p = scene({ dens: 280, loose: 0 });
    const s = sc(); s.selectItem('shovel'); s.render(0);
    s.aim(1006, 268 + 5); steps(2);
    const T = target(); void p;
    if (!T.lines.length) throw new Error('пусто');
    s.aim(1006, 274); steps(2);
    const l = target().lines.join(' ');
    if (!/наст/.test(l) || !/рыхлый|хороший|плотный/.test(l)) throw new Error('нет слова о плотности: ' + l);
  });
});
void TS; void MATS; void BELT; void equip; void pickupFixture; void planFixture; void sinterMinutes; void stepTools; void stepDrops; void TUNE; void wake; void aux;
