// Self-tests of the group 2 usable items (DESIGN §17: «Ориентиры и безопасность», «Свет и сигналы»), agent U2. Group: useitems2.
// They drive the real game through the item framework (useSlot / holdSlot / stepUseItems) and the real step code (stepTools, stepPlayer).
import { registerTest } from './selftest';
import { G, type Animal, type Light, newId } from './state';
import { on } from './bus';
import { add, clearInventory, inv, count, remove, select, held } from './inventory';
import { useSlot, holdSlot, stepUseItems, usable, useState, sget } from './useitems';
import { body, stepPlayer } from './player';
import { fauna, aiOf } from './fauna';
import { RECIPES, craft } from './recipes';
import { learnAll } from './lore';
import { worldInfo } from './locations';
import { getItem } from './items';
import { gearMods } from './items_b';
import { toolState, stepTools, collectHeldLights } from './tools';
import { hasIcon } from '../art/icons';
import { sandbox, arena, put } from './testkit';
import { input } from '../engine/input';
import { MAT } from '../content/materials';
import { FX, clearParticles } from '../engine/particles';
import { tr } from '../content/i18n';
import { compassVisible, compassText } from '../ui/compass';
import { compassTargets, scanAhead, probeSummary, probe, smoke, bino, animalMarkers, binoLight } from './useitems_b';

const GROUP2 = ['compass', 'binoculars', 'probe_pole', 'ice_cleats', 'smoke_flare', 'whistle'];
const P = () => G.player;
const slotOf = (id: string) => inv.slots.findIndex(s => s?.id === id);
/** Live values read through a call: TypeScript does not narrow them after an earlier comparison. */
const now = () => ({ fric: gearMods.fric, speed: gearMods.speed });
const nFlares = () => toolState.flares.length;
/** Player at rest, healthy and warm (world state is restored by sandbox()). */
function resetP(x?: number, y?: number) {
  const p = P();
  if (x !== undefined) { p.x = x; p.y = y ?? p.y; }
  p.vx = p.vy = 0; p.core = 37; p.water = 50; p.wet = 0; p.frost.hands = p.frost.feet = p.frost.face = 0; p.shelter = 0; p.airT = -20;
  p.energy = 80; p.food = 80; p.alive = true; p.face = 1; G.timeScale = 1;
}
/** Run fn with the use-state of the items (marks, selections, cleats) reset to new, and put it back afterwards. */
async function keepUse(fn: () => void | Promise<void>) {
  const keep = JSON.parse(JSON.stringify(useState()));
  useState().d = {};
  try { await fn(); } finally { const u = useState(); u.d = keep.d; u.hints = keep.hints; }
}
/** A hold timer only runs while the press is seen: move the clock on so the next hold starts from zero. */
function freshHold() { G.realTime += 1; stepUseItems(0.01); }

registerTest('useitems2', 'предметы группы 2: вес, стопка, иконка, название, описание и использование зарегистрированы', async () => {
  for (const id of GROUP2) {
    const d = getItem(id);
    if (!(d.w > 0) || !(d.stack >= 1)) throw new Error(id + ': вес или стопка');
    if (!hasIcon(id)) throw new Error('нет иконки: ' + id);
    if (!tr('item.' + id, '') || !d.desc) throw new Error('нет названия или описания: ' + id);
    if (!usable(id)) throw new Error('не зарегистрировано использование: ' + id);
  }
});

registerTest('useitems2', 'предметы группы 2 лежат в тайниках, зонд крафтится из плавника и верёвки', async () => {
  learnAll();
  for (const [id, site] of [['compass', 'station'], ['whistle', 'station'], ['ice_cleats', 'shed'], ['binoculars', 'ship'], ['smoke_flare', 'cairn']] as const) {
    if (!worldInfo.chests.some(c => c.site === site && c.items.some(s => s.id === id))) throw new Error(id + ' нет в тайнике «' + site + '»');
  }
  await sandbox(() => {
    clearInventory(); add('log', 1); add('rope', 1);
    const r = RECIPES.find(x => x.result === 'probe_pole');
    if (!r || !craft(r, { none: true })) throw new Error('зонд не сделан из плавника и верёвки');
    if (count('probe_pole') !== 1 || count('log') !== 0 || count('rope') !== 0) throw new Error('зонд: ' + count('probe_pole'));
  });
});

registerTest('useitems2', 'компас: нажатие — следующая цель; удержание 0,6 с — метка здесь; в буран крупнее; без компаса пропадает', async () => {
  await keepUse(async () => {
    await sandbox(() => {
      const storm0 = G.storm;
      clearInventory(); resetP(); add('compass', 1);
      const i = slotOf('compass');
      const keys = compassTargets().map(t => t.key);
      if (!keys.includes('station') || !keys.includes('ship') || !keys.includes('summit')) throw new Error('цели: ' + keys.join());
      freshHold();
      if (!useSlot(i) || sget('cmpSel') !== 1) throw new Error('нажатие: следующая цель ' + sget('cmpSel'));
      freshHold();
      holdSlot(i, 0.3); holdSlot(i, 0.35);                                  // 0.65 s held: the spot is marked
      if (!compassTargets().some(t => t.key === 'mark0') || sget('mkOn0') !== 1) throw new Error('метка не поставлена при удержании');
      if (compassTargets()[sget('cmpSel')]?.key !== 'mark0') throw new Error('метка должна стать текущей целью');
      if (Math.abs(sget('mkx0') - Math.round(P().x)) > 1) throw new Error('метка не там, где игрок');
      stepUseItems(0.05);
      if (!compassVisible()) throw new Error('компас не виден с компасом в сумке');
      if (!/Метка 1/.test(compassText())) throw new Error('на компасе не метка: ' + compassText());
      G.storm = 0.7; stepUseItems(0.05);
      if (!document.querySelector('#compass.storm')) throw new Error('в буран компас должен стать крупнее и темнее');
      G.storm = storm0;
      clearInventory(); stepUseItems(0.05);
      if (compassVisible()) throw new Error('без компаса его быть не должно');
    });
  });
});

registerTest('useitems2', 'бинокль: держи — взгляд ×2; звери видны дальше при свете (170 клеток), в темноте только рядом (60)', async () => {
  const g0 = { moon: G.moon, day: G.daylight, aur: G.aurora, animals: G.animals.slice() };
  try {
    await sandbox(() => {
      clearInventory(); resetP(); add('binoculars', 1); const i = slotOf('binoculars');
      const p = P();
      const at = (dx: number, kind: Animal['kind']): Animal => ({ id: newId(), kind, x: p.x + dx, y: p.y, vx: 0, vy: 0, w: 16, h: 8, face: 1, hp: 10, state: 'idle', t: 0, onGround: true });
      G.animals.length = 0; G.animals.push(at(120, 'seal'), at(40, 'fox'));
      G.moon = 0.8; G.daylight = 0; G.aurora = 0;
      if (binoLight() < 0.12) throw new Error('при луне должен быть свет');
      if (animalMarkers().length !== 2) throw new Error('при луне видны оба зверя: ' + animalMarkers().length);
      G.moon = 0;
      if (animalMarkers().length !== 1) throw new Error('в темноте виден только ближний: ' + animalMarkers().length);
      G.moon = 0.8;
      holdSlot(i, 0.1); stepUseItems(0.02);
      if (!bino.on) throw new Error('бинокль в руках должен включиться');
      // the default look of tools.ts is 0.2 x the aim offset (clamped to 30); the binoculars double it
      const expect = 2 * Math.max(-30, Math.min(30, (toolState.aimX - p.x) * 0.2));
      if (Math.abs(bino.lx - expect) > 1e-6) throw new Error('взгляд не ×2: ' + bino.lx + ' vs ' + expect);
      G.realTime += 0.5; stepUseItems(0.02);                             // the main loop moves the clock; the hold has ended
      if (bino.on) throw new Error('без удержания бинокль выключается');
    });
  } finally {
    G.moon = g0.moon; G.daylight = g0.day; G.aurora = g0.aur; G.animals.length = 0; G.animals.push(...g0.animals);
  }
});

registerTest('useitems2', 'зонд: шесть шагов впереди — снежный мост, пустота, полынья, тонкий лёд видны; ровный лёд чист; накладка 3 с', async () => {
  await keepUse(async () => {
    await sandbox(() => {
      clearInventory(); resetP(); add('probe_pole', 1);
      arena(1000, 270, { ice: true, loose: 2, depth: 30, halfW: 70, up: 40 });   // snow at 270-271, ice below, stone at 300
      resetP(1000, 269);
      // tiles ahead (k = 1..6 at x 1006, 1010, 1014, 1018, 1022, 1026): ice 28 cells at k=1; snow bridge over air at k=2; ice over a void at k=3;
      // open water at k=4; thin ice (one cell) on water at k=5; thick again at k=6
      for (let y = 272; y <= 275; y++) for (let x = 1008; x <= 1011; x++) put(x, y, MAT.AIR);
      for (let y = 280; y <= 283; y++) for (let x = 1012; x <= 1015; x++) put(x, y, MAT.AIR);
      for (let y = 268; y <= 271; y++) for (let x = 1016; x <= 1019; x++) put(x, y, MAT.WATER);
      for (let x = 1020; x <= 1023; x++) { for (let y = 273; y <= 300; y++) put(x, y, MAT.WATER); put(x, 272, MAT.ICE); }
      const rs = scanAhead();
      const kinds = rs.map(r => r.kind).join(',');
      if (rs.length !== 6) throw new Error('шесть шагов: ' + rs.length);
      if (rs[0].kind !== 'safe' || rs[0].cm < 200) throw new Error('толстый лёд держит: ' + rs[0].kind + ' ' + rs[0].cm);
      if (rs[1].kind !== 'bridge') throw new Error('снежный мост над пустотой: ' + kinds);
      if (rs[2].kind !== 'void' || rs[2].cm !== 72) throw new Error('пустота под льдом: ' + kinds + ' ' + rs[2].cm);
      if (rs[3].kind !== 'hole') throw new Error('полынья: ' + kinds);
      if (rs[4].kind !== 'thin') throw new Error('тонкий лёд: ' + kinds);
      if (rs[5].kind !== 'safe') throw new Error('дальше снова толстый лёд: ' + kinds);
      const s = probeSummary(rs);
      if (s.kind !== 'bad' || !/мост/.test(s.text)) throw new Error('первая опасность — мост на втором шаге: ' + s.text);
      const i = slotOf('probe_pole');
      if (!useSlot(i)) throw new Error('зонд не сработал');
      if (probe.cells.length < 4) throw new Error('накладка плиток: ' + probe.cells.length);
      if (!(probe.until - G.realTime > 2.9 && probe.until - G.realTime <= 3.01)) throw new Error('накладка на три секунды');
      // flat ice, nothing hidden
      arena(1000, 270, { ice: true, loose: 0, depth: 30, halfW: 70, up: 40 });
      resetP(1000, 269);
      const flat = scanAhead();
      if (flat.some(r => r.kind === 'hole' || r.kind === 'void' || r.kind === 'bridge' || r.kind === 'thin')) throw new Error('ровный лёд без ловушек: ' + flat.map(r => r.kind).join(','));
      if (probeSummary(flat).kind !== 'good') throw new Error('ровный лёд: ' + probeSummary(flat).text);
    });
  });
});

registerTest('useitems2', 'ледоступы: без ботинок не пристегнуть; с ботинками трение льда ×10, на гладком (ветер) быстрее, в снегу медленнее; снять — как было', async () => {
  const wind0 = G.wind;
  await keepUse(async () => {
    try {
      await sandbox(() => {
        clearInventory(); resetP(); add('ice_cleats', 1); const i = slotOf('ice_cleats');
        inv.wear.feet = null;
        if (useSlot(i)) throw new Error('без обуви ледоступы не пристегнуть');
        inv.wear.feet = 'felt_boots';
        if (!useSlot(i) || sget('cleats') !== 1) throw new Error('пристегнуть с валенками');
        body.feetMat = MAT.ICE; G.wind = 0; stepUseItems(0.05);
        if (now().fric !== 10 || now().speed !== 1) throw new Error('бесцветный лёд: ' + JSON.stringify(now()));
        G.wind = 6; stepUseItems(0.05);
        if (Math.abs(now().speed - 1.12) > 1e-6) throw new Error('гладкий лёд быстрее: ' + now().speed);
        body.feetMat = MAT.SNOW; G.wind = 0; stepUseItems(0.05);
        if (Math.abs(now().speed - 0.88) > 1e-6 || now().fric !== 1) throw new Error('рыхлый снег медленнее: ' + JSON.stringify(now()));
        body.feetMat = MAT.STONE; stepUseItems(0.05);
        if (now().fric !== 1 || now().speed !== 1) throw new Error('камень без поправок');
        body.feetMat = MAT.ICE; stepUseItems(0.6);                        // the item's cool-down (0.5 s) has passed
        if (!useSlot(i) || sget('cleats') !== 0) throw new Error('снять');
        stepUseItems(0.05);
        if (now().fric !== 1 || now().speed !== 1) throw new Error('сняты — без поправок');
      });
    } finally { G.wind = wind0; }
  });
});

registerTest('useitems2', 'ледоступы в ходьбе: на голом льду с ними тормозишь почти сразу, без них скользишь (расстояние торможения)', async () => {
  const brake = (cleats: boolean) => sandbox(() => {
    clearInventory(); resetP(); add('ice_cleats', 1); inv.wear.feet = 'felt_boots';
    arena(1000, 270, { ice: true, loose: 0, depth: 30, halfW: 70, up: 40 });
    resetP(960, 268);
    if (cleats) useSlot(slotOf('ice_cleats'));
    const frame = (mx: number) => { input.moveX = mx; stepUseItems(1 / 60); stepPlayer(1 / 60); };
    for (let k = 0; k < 40; k++) frame(0);                                 // land on the ice
    for (let k = 0; k < 40; k++) frame(1);                                 // run up to walking speed
    const x0 = P().x;
    for (let k = 0; k < 200 && Math.abs(P().vx) > 0.5; k++) frame(0);
    return Math.abs(P().x - x0);
  });
  try {
    const off = await brake(false), on = await brake(true);
    if (!(off >= 1) || !(on < off * 0.5)) throw new Error('торможение без ледоступов ' + off.toFixed(2) + ', с ними ' + on.toFixed(2));
  } finally { input.moveX = 0; }
});

registerTest('useitems2', 'дымовая шашка: зажечь — дым три минуты, сигнал flare со смыслом дыма, цель на компасе; потом гаснет', async () => {
  const sigs: { smoke?: boolean }[] = [];
  const off = on('flare', (d: { smoke?: boolean }) => sigs.push(d));
  const q0 = G.quality;
  try {
    G.quality = 2;                                                       // ambient kinds (smoke) are thinned on low quality (particles.ts)
    await keepUse(async () => {
      await sandbox(() => {
        clearInventory(); resetP(); add('smoke_flare', 2);
        const i = slotOf('smoke_flare');
        if (!useSlot(i) || count('smoke_flare') !== 1) throw new Error('зажечь одну шашку');
        if (!sigs.length || sigs[sigs.length - 1].smoke !== true) throw new Error('сигнал flare со смыслом дыма');
        if (!(smoke.t > 170 && smoke.t <= 180)) throw new Error('дым три минуты: ' + smoke.t);
        if (!compassTargets().some(t => t.key === 'smoke')) throw new Error('дым должен быть целью компаса');
        clearParticles();                                                  // a full particle pool would drop the puffs: start from an empty one
        stepUseItems(0.2);
        if (FX.n <= 0) throw new Error('из шашки должен идти дым');
        stepUseItems(200);
        if (smoke.t > 0 || compassTargets().some(t => t.key === 'smoke')) throw new Error('дым кончился');
      });
    });
  } finally { off(); G.quality = q0; }
});

registerTest('useitems2', 'свисток: короткий — Север бежит за тобой; держи 0,4 с — ждёт на месте; без собаки свистеть некому', async () => {
  const d = fauna.dog, a = d ? aiOf(d) : undefined;
  if (!d || !a) throw new Error('нет Севера: новая игра не запущена');
  const stay0 = a.stay;
  try {
    await keepUse(async () => {
      await sandbox(() => {
        clearInventory(); resetP(); add('whistle', 1); const i = slotOf('whistle');
        a.stay = true;
        freshHold();
        if (!useSlot(i) || aiOf(d)!.stay !== false) throw new Error('короткий свисток: Север бежит за тобой');
        freshHold();
        holdSlot(i, 0.3); if (aiOf(d)!.stay !== false) throw new Error('до 0,4 с он ещё бежит');
        holdSlot(i, 0.2); if (aiOf(d)!.stay !== true) throw new Error('держи — ждать на месте');
        stepUseItems(0.5);
        if (aiOf(d)!.stay !== true) throw new Error('ждёт и после отпускания');
      });
    });
  } finally { a.stay = stay0; }
});

registerTest('useitems2', 'ракетница: ракета висит под парашютом — 30 с света, 60 с страха медведя; сигнал flare идёт', async () => {
  const sigs: unknown[] = [];
  const off = on('flare', (d: unknown) => sigs.push(d));
  try {
    await sandbox(() => {
      clearInventory(); resetP(); add('flare_gun', 1); add('flare', 1);
      select(slotOf('flare_gun'));
      toolState.flares.length = 0;
      input.primaryPressed = true; stepTools(1 / 60); input.primaryPressed = false;
      const f = toolState.flares[0];
      if (!f || toolState.flares.length !== 1) throw new Error('ракета в небе');
      if (!(f.lit! > 29.5 && f.t > 59.5)) throw new Error('свет 30 с, страх 60 с: ' + f.lit + ' / ' + f.t);
      if (!sigs.length) throw new Error('сигнал flare не ушёл');
      const lit1: Light[] = []; collectHeldLights(lit1);
      f.lit = 0.01; stepTools(0.1);
      const lit2: Light[] = []; collectHeldLights(lit2);
      if (lit2.length >= lit1.length) throw new Error('после 30 с света ракета не светит');
      if (nFlares() !== 1) throw new Error('страх медведя ещё идёт');
      f.t = 0.01; stepTools(0.1);
      if (nFlares() !== 0) throw new Error('через 60 с ракеты нет');
    });
  } finally { off(); input.primaryPressed = false; }
});

registerTest('useitems2', 'фонарь: сильный ветер в открытом месте задувает его; зажечь снова можно только спичкой', async () => {
  const wind0 = G.wind;
  try {
    await sandbox(() => {
      clearInventory(); resetP(); add('lantern', 1); add('matches', 1);
      select(slotOf('lantern'));
      input.primaryPressed = true; stepTools(1 / 60); input.primaryPressed = false;
      if (!held.lanternLit) throw new Error('фонарь должен гореть');
      G.wind = 12; let n = 0;
      while (held.lanternLit && n++ < 6000) stepTools(1 / 60);
      if (held.lanternLit) throw new Error('ветер не задул фонарь за 100 с');
      G.wind = 0;
      remove('matches', count('matches'));
      input.primaryPressed = true; stepTools(1 / 60); input.primaryPressed = false;
      if (held.lanternLit) throw new Error('без спичек задутый фонарь не зажечь');
      add('matches', 1);
      input.primaryPressed = true; stepTools(1 / 60); input.primaryPressed = false;
      if (!held.lanternLit || count('matches') !== 0) throw new Error('со спичкой зажечь: lit=' + held.lanternLit + ' спички=' + count('matches'));
    });
  } finally { G.wind = wind0; input.primaryPressed = false; }
});

registerTest('useitems2', 'телефонный пояс: с подсумком радиальное колесо показывает девять ячеек, без него — шесть', async () => {
  const radialSlots = () => document.querySelectorAll('#touch .rad .slot').length;
  await sandbox(() => {
    clearInventory(); add('belt_pouch', 1);
    window.dispatchEvent(new Event('sc:radial'));
    const nine = radialSlots();
    window.dispatchEvent(new Event('sc:radial'));
    clearInventory();
    window.dispatchEvent(new Event('sc:radial'));
    const six = radialSlots();
    window.dispatchEvent(new Event('sc:radial'));
    if (nine !== 9) throw new Error('с подсумком должно быть девять ячеек: ' + nine);
    if (six !== 6) throw new Error('без подсумка шесть ячеек: ' + six);
  });
});
