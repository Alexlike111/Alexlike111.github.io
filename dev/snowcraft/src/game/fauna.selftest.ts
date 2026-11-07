// Self-tests: fauna (seals, husky, bear + scent), pack-ice drift and thin ice, objectives / endings, run-state fixes.
// They drive the running game; whatever they move is put back (animals / floes / quest flags / inventory).
import { registerTest } from './selftest';
import { G } from './state';
import { on, emit } from './bus';
import { W, mat, aux } from '../engine/grid';
import { boxFree } from '../engine/phys';
import { MAT } from '../content/materials';
import { SEA } from './locations';
import { worldInfo } from './worldgen';
import { fauna, stepFauna, groundY, scentAt, scent, setAiMode, aiOf, dogInteract, dogWarmth, dogHunger } from './fauna';
import { driftState, shiftFloes, stepDrift, iceUnder, freezeLeads } from './drift';
import { questState, resetQuest, objective, stepQuest, GOALS, suppliesNow, readNote, runStats } from './quest';
import { loreSave, loreLoad } from './lore';
import { inv, add, count, clearInventory, takeAll, spawnDrop, hitchSled, unhitchSled, backpacks } from './inventory';
import { stepDrops } from './tools';
import { wx } from './weather';
import { placeFixture, removeFixture, interact, pickupFixture } from './fixtures';
import { held } from './inventory';

registerTest('fauna', 'есть тюлени у лунок, пёс, песец и один медведь', t => {
  const k: Record<string, number> = {};
  for (const a of G.animals) k[a.kind] = (k[a.kind] ?? 0) + 1;
  t.expect((k.seal ?? 0) >= 6, 'тюленей: ' + (k.seal ?? 0));
  t.expect(k.dog === 1 && k.bear === 1 && k.fox === 1, JSON.stringify(k));
  t.expect(!!fauna.dog && !!fauna.bear, 'нет ссылок на пса / медведя');
});

registerTest('fauna', 'тюлень всплывает, пугается шума и гибнет от гарпуна', t => {
  const seals = G.animals.filter(a => a.kind === 'seal');
  const s = seals[0]; const ai = aiOf(s)!;
  const p = G.player, px = p.x, py = p.y, drops0 = G.drops.length;
  p.x = s.x + 200; // far away: the seal is calm
  ai.mode = 'hidden'; ai.cd = 0; s.state = 'hidden'; s.hp = 12;
  let surf = false;
  for (let i = 0; i < 60 * 3 && !surf; i++) { stepFauna(1 / 60); surf = s.state === 'surface'; }
  t.expect(surf, 'тюлень не всплыл');
  // noise: the player runs close by
  p.x = s.x + 20; p.vx = 40;
  for (let i = 0; i < 60 * 2; i++) { stepFauna(1 / 60); }
  t.expect(s.state === 'hidden' || s.state === 'dive', 'тюлень не испугался: ' + s.state);
  // harpoon: a surfaced seal dies, hidden one cannot be hit
  p.x = s.x + 200; p.vx = 0; ai.mode = 'up'; ai.hold = 20; s.state = 'surface'; s.hp = 12;
  s.hp -= 12;
  stepFauna(1 / 60);
  t.expect(G.drops.some(d => d.item === 'seal_meat') && G.drops.some(d => d.item === 'fat'), 'нет добычи после гарпуна');
  while (G.drops.length > drops0) G.drops.pop();
  s.hp = 12; ai.mode = 'hidden'; s.state = 'hidden'; ai.cd = 30;
  p.x = px; p.y = py; p.vx = 0;
});

registerTest('fauna', 'медведь идёт на запах по ветру; пёс лает, пока зверя не видно', t => {
  const sc = (window as any).__sc;
  const b = fauna.bear!, d = fauna.dog!, p = G.player;
  const save = { bx: b.x, by: b.y, bs: b.state, px: p.x, py: p.y, day: fauna.bearActiveDay, hp: p.hp };
  sc.teleport(1180, groundY(1180, 200) - 1);
  b.x = 1180 + 520; b.y = groundY(b.x, 200) - 1; b.vx = 0; b.hp = 160; setAiMode(b, 'wander'); aiOf(b)!.cd = 0;
  d.x = p.x - 10; d.y = p.y; d.state = 'idle';
  fauna.bearActiveDay = 1;
  wx.override = { wind: 6, storm: 0, snowfall: 0, ambientT: -25 }; G.wind = 6; G.storm = 0;
  let barked = -1, barkBear = 0, seen = false;
  const off = on('dog_bark', (e: { bearDist: number }) => { if (barked < 0) { barked = e.bearDist; } });
  const off2 = on('bear_seen', () => { seen = true; });
  const d0 = Math.abs(b.x - p.x);
  let reached = '';
  for (let i = 0; i < 60 * 45; i++) {
    G.wind = 6; p.hp = 100; p.core = 37;
    stepFauna(1 / 60);
    if (!reached && (fauna.bearMode === 'curious' || fauna.bearMode === 'stalk' || fauna.bearMode === 'charge')) reached = fauna.bearMode;
    if (barked >= 0 && seen) break;
  }
  off(); off2(); void barkBear;
  const d1 = Math.abs(b.x - p.x);
  t.metric('дистанция до медведя', d1, 'кл');
  t.expect(!!reached, 'медведь не почуял запах по ветру (режим ' + fauna.bearMode + ', запах ' + fauna.bearSmell.toFixed(2) + ')');
  t.expect(d1 < d0 - 100, `медведь не приблизился: ${d0.toFixed(0)} -> ${d1.toFixed(0)}`);
  t.expect(barked > 0, 'пёс не залаял');
  t.expect(barked > G.cam.viewW * 0.55 + 20, 'пёс залаял слишком поздно: медведь уже был в кадре, ' + barked.toFixed(0));
  // upwind: nothing smells the player
  b.x = 1180 + 520; b.y = groundY(b.x, 200) - 1; setAiMode(b, 'wander'); aiOf(b)!.cd = 0; scent.fill(0);
  for (let i = 0; i < 60 * 12; i++) { G.wind = -6; stepFauna(1 / 60); }
  t.expect(fauna.bearMode === 'wander', 'медведь против ветра не должен чуять: ' + fauna.bearMode);
  // restore
  wx.override = null; fauna.bearActiveDay = save.day;
  b.x = save.bx; b.y = save.by; b.state = save.bs; setAiMode(b, 'wander'); scent.fill(0);
  p.hp = save.hp; sc.teleport(save.px, save.py);
});

registerTest('fauna', 'костёр и ракета отгоняют медведя; снежные стены он ломает', t => {
  const sc = (window as any).__sc;
  const b = fauna.bear!, p = G.player;
  const save = { bx: b.x, by: b.y, px: p.x, py: p.y, hp: p.hp };
  sc.teleport(1200, groundY(1200, 200) - 1);
  b.x = p.x + 40; b.y = p.y; b.vx = 0; b.hp = 160;
  const f = placeFixture('campfire', Math.floor((p.x + 6) / 4), Math.floor(p.y / 4) - 1, { force: true, fuel: 200, lit: true });
  setAiMode(b, 'charge');
  for (let i = 0; i < 60 * 3; i++) { p.hp = 100; stepFauna(1 / 60); }
  t.expect(fauna.bearMode === 'flee', 'медведь не отступил от огня: ' + fauna.bearMode);
  if (f) removeFixture(f);
  // siege: a snow wall in front of the bear is broken
  const x0 = Math.floor(b.x) + 6;
  for (let y = Math.floor(b.y) - 16; y < Math.floor(b.y); y++) for (let x = x0; x < x0 + 6; x++) { mat[y * W + x] = MAT.SNOWBLOCK; }
  b.face = 1; setAiMode(b, 'siege'); aiOf(b)!.cd = 0;
  G.shelter = { closed: true, tiles: 40, temp: 0, windIn: 0, vent: true, co: 0, stars: 2, notes: [] }; p.shelter = 0.9;
  p.x = x0 + 12; b.x = x0 - 8;
  for (let i = 0; i < 60 * 2; i++) { G.shelter = G.shelter ?? null; stepFauna(1 / 60); }
  let left = 0; for (let y = Math.floor(b.y) - 16; y < Math.floor(b.y); y++) for (let x = x0 - 2; x < x0 + 14; x++) if (mat[y * W + x] === MAT.SNOWBLOCK) left++;
  t.expect(left <= 56, 'стена из снега цела: ' + left);
  for (let y = Math.floor(b.y) - 16; y < Math.floor(b.y); y++) for (let x = x0 - 2; x < x0 + 14; x++) if (mat[y * W + x] === MAT.SNOWBLOCK) mat[y * W + x] = 0;
  G.shelter = null; p.shelter = 0; p.hp = save.hp;
  b.x = save.bx; b.y = save.by; setAiMode(b, 'wander'); sc.teleport(save.px, save.py);
});

registerTest('fauna', 'Север: кормится, греет во сне, не бросает', t => {
  const d = fauna.dog!, p = G.player;
  const keep = { alive: p.alive, sleeping: p.sleeping, ds: d.state, stay: aiOf(d)!.stay };
  p.alive = true; p.sleeping = false; aiOf(d)!.stay = false; d.hp = Math.max(d.hp, 40); if (d.state === 'dead') d.state = 'idle';
  d.x = p.x + 6; d.y = p.y; d.state = 'sleep';
  t.expect(dogWarmth(p.x, p.y - 8, true) > 0, 'спящий пёс рядом не греет');
  d.x = p.x + 200;
  t.expect(dogWarmth(p.x, p.y - 8, true) === 0, 'далёкий пёс греет');
  const ai = aiOf(d)!; const h0 = ai.hunger ?? 0; ai.hunger = 30;
  clearInventory(); add('fish_cooked', 1);
  d.x = p.x + 6; d.y = p.y;
  t.expect(dogInteract() && (ai.hunger ?? 0) > 60 && count('fish_cooked') === 0, 'пёс не поел: ' + ai.hunger);
  ai.hunger = h0; t.expect(dogHunger() === h0, 'голод');
  // far behind: he catches up
  ai.hold = 0; ai.cd = 0; d.x = p.x + 400; d.state = 'idle';
  for (let i = 0; i < 3; i++) stepFauna(1 / 60);
  t.expect(Math.abs(d.x - p.x) < 60, 'пёс не догнал');
  p.alive = keep.alive; p.sleeping = keep.sleeping; aiOf(d)!.stay = keep.stay;
});

registerTest('ice', 'льдина едет вместе со снегом, вещами и игроком; открывается полынья', t => {
  const sc = (window as any).__sc;
  const fl0 = driftState.floes;
  const k = fl0.findIndex((f, i) => !f.grounded && f.x1 - f.x0 > 20 && f.x1 - f.x0 < 70 && i + 1 < fl0.length && fl0[i + 1].x0 - f.x1 - 1 >= 8 && i > 0 && f.x0 - fl0[i - 1].x1 - 1 >= 1);
  t.expect(k >= 0, 'нет подходящей льдины');
  if (k < 0) return;
  const f = driftState.floes[k];
  const p = G.player, save = { px: p.x, py: p.y };
  const xm = Math.floor((f.x0 + f.x1) / 2) + 10;
  sc.teleport(xm, SEA - 8);
  const d = spawnDrop('stone', 1, xm + 6, p.y - 2, 0, 0);
  const px0 = p.x, dx0 = d ? d.x : 0, x0 = f.x0;
  const col = (x: number) => mat[(SEA + 6) * W + x];
  const before: number[] = []; for (let x = f.x0; x <= f.x1; x++) before.push(col(x));
  const ok = shiftFloes(k, k, 1);
  t.expect(ok, 'сдвиг отказан');
  t.expect(f.x0 === x0 + 4, 'границы льдины не сдвинулись');
  let moved = 0; for (let i = 0; i < before.length; i++) if (col(f.x0 + i) === before[i]) moved++;
  t.expect(moved === before.length, `льдина сдвинулась неполностью: ${moved}/${before.length}`);
  let open = 0; for (let x = x0; x < x0 + 4; x++) if (col(x) === MAT.WATER) open++;
  t.expect(open === 4, 'за кормой льдины не открылась вода: ' + open + '/4');
  t.expect(Math.abs(p.x - px0 - 4) < 0.01, 'игрок остался на месте: ' + (p.x - px0));
  if (d) t.expect(Math.abs(d.x - dx0 - 4) < 0.01, 'вещь не поехала');
  shiftFloes(k, k, -1);
  t.expect(f.x0 === x0, 'не вернулась на место');
  if (d) { const i = G.drops.indexOf(d); if (i >= 0) G.drops.splice(i, 1); }
  sc.teleport(save.px, save.py);
});

registerTest('ice', 'тонкий лёд трещит и проламывается; толстый держит', t => {
  const sc = (window as any).__sc;
  const p = G.player, save = { px: p.x, py: p.y }, nextAt0 = driftState.nextAt;
  driftState.nextAt = Infinity;                          // no pack shift while we stand on the ice
  sc.setWeather({ ambientT: -6, wind: 0, storm: 0, snowfall: 0 });     // fixed mild frost: in a hard frost (left by an earlier test, or the polar night) the lead under the bridge thickens to 3 cells within the test
  // thick pack: 3+ cells of ice -> no hole after a long stand
  const f = driftState.floes.find(q => q.x1 - q.x0 > 30)!;
  const xt = Math.floor((f.x0 + f.x1) / 2) + 12;
  sc.teleport(xt, SEA - 8); sc.stepFast(40);
  sc.stepFast(60 * 3);
  t.expect(mat[(SEA + 1) * W + xt] !== MAT.WATER, 'толстый лёд провалился');
  // a snow bridge over 2 cells of new ice (like the wide lead of the world), built here so the test does not depend on where the pack has drifted
  const xc = xt + 14;
  for (let x = xc - 9; x <= xc + 9; x++) for (let y = SEA - 16; y < SEA + 34; y++) {
    const i = y * W + x;
    if (y < SEA - 3) { mat[i] = MAT.AIR; aux[i] = 0; } else if (y < SEA) { mat[i] = MAT.PACKED; aux[i] = 140; } else if (y < SEA + 2) { mat[i] = MAT.ICE; aux[i] = 0; } else { mat[i] = MAT.WATER; aux[i] = 0; }
  }
  sc.teleport(xc, SEA - 12); sc.stepFast(50);
  const th = iceUnder(p.x, p.y);
  let broke = false;
  const off = on('ice_break', () => { broke = true; });
  for (let i = 0; i < 60 * 4 && !broke; i++) sc.stepFast(1);
  off();
  t.expect(th >= 1 && th <= 2, `под ногами не тонкий лёд: ${th} (${p.x.toFixed(0)},${p.y.toFixed(0)} ground ${p.onGround})`);
  t.expect(broke, 'тонкий лёд под снежным мостом не проломился');
  // the hole is a real hole now; the event test below regenerates the world
  sc.teleport(save.px, save.py);
  p.inWater = 0; p.wet = 0; driftState.nextAt = nextAt0;
  sc.setWeather(null);
});

registerTest('ice', 'событие дрейфа: предупреждение, потом сдвиг; полыньи затягиваются', t => {
  const sc = (window as any).__sc;
  const heard: number[] = [];
  const off = on('drift_warn', () => heard.push(1));
  const t0 = G.time, e0 = driftState.events;
  driftState.nextAt = G.time - 1;
  let warnedAt = -1, movedAt = -1;
  const xs0 = driftState.floes.map(f => f.x0).join(',');
  for (let i = 0; i < 60 * 40; i++) {
    stepDrift(1 / 60);
    if (warnedAt < 0 && heard.length) warnedAt = i;
    if (movedAt < 0 && driftState.floes.map(f => f.x0).join(',') !== xs0) movedAt = i;
    if (!driftState.pending && driftState.events > e0) break;
  }
  off();
  t.expect(warnedAt >= 0, 'нет предупреждения');
  t.expect(driftState.events > e0, 'событие не завершилось');
  t.expect(movedAt < 0 || movedAt - warnedAt > 60 * 5, `сдвиг без предупреждения: ${(movedAt - warnedAt) / 60} с`);
  t.metric('сдвиг через', movedAt < 0 ? -1 : movedAt / 60, 'с');
  G.time = t0;
  // refreeze: an open crack column grows ice over game time
  const fl = driftState.floes; let x = -1;
  for (let i = 0; i + 1 < fl.length && x < 0; i++) if (fl[i + 1].x0 - fl[i].x1 - 1 >= 4) x = fl[i].x1 + 2;
  if (x > 0) {
    const had = iceUnder(x, SEA + 0.5);
    const amb = G.ambientT; G.ambientT = -30; wx.override = { ambientT: -30 };
    for (let i = 0; i < 5; i++) freezeLeads(120);         // ~10 game hours of hard frost
    wx.override = null; G.ambientT = amb;
    const now = iceUnder(x, SEA + 0.5);
    t.expect(had < 99 ? now >= had : now < 99 && now >= 1, `полынья не затянулась льдом: было ${had}, стало ${now}`);
  }
  // the drift moved real floes: regenerate the world so later tests start from the known layout
  sc.start({ seed: G.seed, diff: G.diff.level, hardcore: G.diff.hardcore });
});

registerTest('quest', 'цепочка первого дня и ледокол: ящик с припасами, без концовки', t => {
  const s0 = { ...questState }, l0 = loreSave();
  resetQuest();
  t.expect(GOALS[0].id === 'coal' && /уголь/i.test(objective()), 'первая цель: ' + objective());
  emit('picked', { item: 'coal', n: 4 }); t.expect(GOALS[1].id === 'door' && /Откопай/.test(objective()), 'вторая цель — откопать дверь (занесена): ' + objective());
  emit('door_dug', {}); t.expect(/печь/i.test(objective()), 'третья цель — печь: ' + objective());
  emit('fire_lit', { kind: 'stove' }); t.expect(/барометр/i.test(objective()), 'четвёртая цель: ' + objective());
  emit('barometer', {}); t.expect(/журнал смотрителя/i.test(objective()), 'третья цель — прочесть журнал: ' + objective());
  readNote('s1'); t.expect(/★★|иглу/.test(objective()), 'четвёртая цель: ' + objective());
  emit('shelter', { stars: 1, closed: true, vent: true }); t.expect(/иглу/.test(objective()), 'одна звезда не засчитана');
  emit('shelter', { stars: 2, closed: true, vent: true }); t.expect(/иглу/.test(objective()), 'укрытие без своих блоков не засчитано (станция не в счёт)');
  const px0 = G.player.x; G.player.x = 1000; runStats.placed = 3;
  emit('shelter', { stars: 2, closed: true, vent: true }); G.player.x = px0;
  t.expect(/дневник доктора/i.test(objective()), 'пятая цель — дневник у тура: ' + objective());
  readNote('n1'); t.expect(!/дневник доктора|иглу|барометр/i.test(objective()) && objective().length > 8, 'после цепочки — «следующее разумное дело»: ' + objective());
  const sp = suppliesNow(); t.expect(Number.isFinite(sp.fuelH) && Number.isFinite(sp.foodDays), 'запасы не посчитаны');
  // the radio call -> icebreaker two days later -> signal fire on the cape hill -> it passes, drops a crate and leaves (no ending)
  const t0 = G.time, day = G.day;
  let ended = '';
  const off = on('ending', (d: { kind: string }) => { ended = d.kind; });
  const drops0 = G.drops.length;
  emit('radio_fixed', {});
  t.expect(Math.abs(questState.icebreakerAt - (G.time + 2880)) < 2, 'ледокол не назначен на +2 суток');
  const sf = G.fixtures.find(f => f.kind === 'signal_fire');
  t.expect(!!sf, 'нет сигнального костра на холме');
  G.time = questState.icebreakerAt + 1; G.daylight = 0.1; stepQuest(0.1);
  t.expect(questState.iceArrivedAt > 0 && /Зажги/.test(objective()), 'ледокол не прибыл: ' + objective());
  if (sf) { sf.lit = true; sf.fuel = 200; }
  stepQuest(0.1); t.expect(questState.lit, 'огонь не замечен');
  G.time += 100; stepQuest(0.1);
  t.expect(ended === '' && questState.ended === '', 'концовок больше нет: ' + ended);
  t.expect(questState.iceArrivedAt < 0 && questState.crateRing === G.cycle && G.drops.length > drops0 && G.drops.some(d => d.item === 'flare'), 'ледокол не сбросил ящик');
  off();
  if (sf) { sf.lit = false; sf.fuel = 0; }
  G.drops.length = drops0; G.time = t0; G.day = day; resetQuest(); Object.assign(questState, s0); loreLoad(l0);
});

registerTest('core', 'рюкзак не затирается второй смертью и не исчезает; нарты можно оставить', t => {
  const p = G.player;
  clearInventory(); add('log', 3);
  hitchSled(p.x, p.y); inv.sled!.slots[0] = { id: 'coal', n: 2 };
  const items = takeAll();
  t.expect(items.some(i => i.id === 'coal') && items.some(i => i.id === 'sled') && items.some(i => i.id === 'log'), 'в рюкзак не попало: ' + items.map(i => i.id).join());
  t.expect(inv.sled === null, 'нарты не ушли с игроком');
  const a = spawnDrop('backpack', 1, p.x + 400, p.y, 0, 0, undefined, true)!;
  const b = spawnDrop('backpack', 1, p.x + 402, p.y, 0, 0, undefined, true)!;
  t.expect(a.id !== b.id, 'два рюкзака слились в один');
  backpacks.set(a.id, items);
  a.age = 5000; stepDrops(0.01);
  t.expect(G.drops.includes(a), 'рюкзак исчез через 900 с');
  G.drops.splice(G.drops.indexOf(a), 1); G.drops.splice(G.drops.indexOf(b), 1); backpacks.delete(a.id);
  // park the sled
  clearInventory(); hitchSled(p.x, p.y); inv.sled!.slots[0] = { id: 'coal', n: 2 };
  unhitchSled(p.x - 14, p.y);
  t.expect(!!inv.sled && !inv.sled.hitched && count('coal') === 0 && inv.sled.slots[0]?.n === 2, 'нарты потеряли груз');
  inv.sled = null;
  add('snow_knife', 1); add('shovel', 1);
});

registerTest('core', 'котелок берёт снег лопатой по мешку; сборка возвращает топливо и содержимое', t => {
  const p = G.player;
  const tx = Math.floor(p.x / 4) + 8, ty = Math.floor(p.y / 4) - 1;
  const pot = placeFixture('pot', tx, ty, { force: true });
  t.expect(!!pot, 'котелок не поставлен');
  if (pot) {
    clearInventory(); held.load = 32;
    interact(pot);
    t.expect(Number(pot.data!.snow) === 4 && held.load === 0, `лопата: снега ${pot.data!.snow}, на лопате ${held.load}`);
    held.load = 32; interact(pot);
    t.expect(Number(pot.data!.snow) === 6 && held.load === 16, `потолок котелка: ${pot.data!.snow}, на лопате ${held.load}`);
    held.load = 0;
    pickupFixture(pot);
    t.expect(count('snow') === 6, 'снег из котелка пропал: ' + count('snow'));
    const cf = placeFixture('campfire', tx, ty, { force: true, fuel: 250 });
    if (cf) { clearInventory(); pickupFixture(cf); t.expect(count('log') >= 2, 'дрова не вернулись: ' + count('log')); }
    // a drum with diesel is not turned into a brazier
    const dr = placeFixture('drum', tx + 4, ty - 1, { force: true });
    if (dr) { add('axe', 1); inv.sel = inv.slots.findIndex(s => s && s.id === 'axe'); interact(dr); t.expect(dr.kind === 'drum', 'полная бочка стала жаровней'); removeFixture(dr); }
  }
  clearInventory(); add('snow_knife', 1); add('shovel', 1); held.load = 0;
});

// ---- living world (playtest G3: F1-F8) -------------------------------------------------------------------------------------
registerTest('fauna', 'F1: медведь родился на чистом месте и реально идёт (x меняется, режимы сменяются)', t => {
  const sc = (window as any).__sc;
  const b = fauna.bear!, p = G.player;
  const save = { bx: b.x, by: b.y, px: p.x, py: p.y, hp: p.hp };
  t.expect(boxFree(b.x, b.y, 26, 15), 'медведь заперт в снегу при спавне');
  sc.teleport(1400, groundY(1400, 200) - 1);            // far from the bear: he must not see or smell us
  b.hp = 160; b.vx = 0; setAiMode(b, 'wander'); aiOf(b)!.t = 15; aiOf(b)!.hold = 0; aiOf(b)!.cd = 0;
  const x0 = b.x;
  let seen = 0, mx = 0;
  for (let i = 0; i < 60 * 25; i++) { G.wind = -3; stepFauna(1 / 60); mx = Math.max(mx, Math.abs(b.x - x0)); if (b.state === 'walk') seen++; }
  t.metric('медведь прошёл за 25 с', Math.round(mx), 'кл');
  t.expect(mx >= 20 && seen > 0, `медведь не идёт: сдвиг ${mx.toFixed(1)}, кадров walk ${seen}`);
  t.expect(boxFree(b.x, b.y, 26, 15), 'медведь в снегу после прогулки');
  b.x = save.bx; b.y = save.by; setAiMode(b, 'wander'); aiOf(b)!.cd = 20; sc.teleport(save.px, save.py); p.hp = save.hp;
});

registerTest('fauna', 'F2 и F3: Север идёт за игроком через стену; «консервы» его кормят; подсказка при голоде', t => {
  const sc = (window as any).__sc;
  const d = fauna.dog!, p = G.player, ai = aiOf(d)!;
  const keep = { stay: ai.stay, hunger: ai.hunger, hold: ai.hold, cd: ai.cd, state: d.state, px: p.x, py: p.y };
  ai.stay = false; ai.hold = 0; ai.cd = 0; d.state = 'idle';
  sc.teleport(700, groundY(700, 200) - 1); p.hp = 100; p.core = 37;
  d.x = 570; d.y = groundY(570, 150) - 1; d.vx = d.vy = 0;   // at the kennel, behind the house wall
  for (let i = 0; i < 60 * 25 && Math.abs(d.x - p.x) > 40; i++) { p.hp = 100; p.core = 37; stepFauna(1 / 60); }
  t.expect(Math.abs(d.x - p.x) <= 40, `пёс не дошёл до игрока за стеной: ${d.x.toFixed(0)} / ${p.x.toFixed(0)}`);
  // far walk at a walking pace (15 cells/s): he keeps up for 100+ cells
  for (let i = 0; i < 60 * 12; i++) { p.hp = 100; p.core = 37; p.x = Math.min(900, p.x + 0.25); stepFauna(1 / 60); }
  for (let i = 0; i < 60 * 4; i++) { p.hp = 100; p.core = 37; stepFauna(1 / 60); }   // then we stop: a husky that lost you finds you within seconds
  t.expect(Math.abs(d.x - p.x) < 60 && d.state !== 'dead', `пёс отстал на ${(p.x - d.x).toFixed(0)} кл (${d.state}, px ${p.x.toFixed(0)}, vx ${d.vx.toFixed(1)}, ожидание ${ai.stuck?.toFixed(1)})`);
  // food: a can feeds him
  ai.hunger = 30; clearInventory(); add('can', 1);
  d.x = p.x + 6; d.y = p.y;
  t.expect(dogInteract() && (ai.hunger ?? 0) > 60 && count('can') === 0, 'консервы не покормили пса: ' + ai.hunger);
  // hungry with nothing to give: a hint is shown (toggle still works)
  ai.hunger = 20; const s0 = ai.stay;
  t.expect(dogInteract() && ai.stay !== s0, 'E без еды не переключил «ждать/за мной»');
  ai.stay = keep.stay; ai.hunger = keep.hunger; ai.hold = keep.hold; ai.cd = keep.cd; d.state = keep.state;
  sc.teleport(keep.px, keep.py);
});

registerTest('fauna', 'F4: тюлень всплывает в 400 кл от игрока с событием и облачком дыхания', t => {
  const s = G.animals.find(a => a.kind === 'seal')!; const ai = aiOf(s)!;
  const p = G.player, px = p.x, py = p.y;
  let heard = 0; const off = on('seal_surface', () => { heard++; });
  G.storm = 0; p.x = s.x + 300; p.vx = 0;
  ai.mode = 'hidden'; ai.cd = 0; s.state = 'hidden';
  for (let i = 0; i < 60 * 3 && ai.mode !== 'up'; i++) { p.hp = 100; stepFauna(1 / 60); }
  off();
  t.expect(ai.mode === 'up' && heard === 1, `событие всплытия: режим ${ai.mode}, событий ${heard}`);
  p.x = px; p.y = py; ai.mode = 'hidden'; s.state = 'hidden'; ai.cd = 30;
});

registerTest('fauna', 'F5: первый сдвиг льда через 20-40 игровых минут после начала', async t => {
  const sc = (window as any).__sc;
  sc.start({ seed: G.seed, diff: G.diff.level, hardcore: G.diff.hardcore });
  const dt = driftState.nextAt - G.time;
  t.expect(dt >= 20 && dt <= 40, `первый сдвиг через ${dt.toFixed(1)} мин`);
  t.metric('первый сдвиг льда', dt, 'игр. мин');
});

registerTest('fauna', 'F8: лис стоит на месте 8-20 с, не мерцает walk/sniff', t => {
  const sc = (window as any).__sc;
  const f = G.animals.find(a => a.kind === 'fox')!, ai = aiOf(f)!, p = G.player;
  const px = p.x, py = p.y;
  sc.teleport(1300, groundY(1300, 200) - 1);            // far from the fox: it only wanders
  ai.tx = f.x; ai.hold = 0; ai.pause = false; ai.carry = undefined;
  let changes = 0, prev = '', run = 0, bestSniff = 0;
  for (let i = 0; i < 60 * 45; i++) {
    stepFauna(1 / 60);
    if (f.state !== prev) { changes++; prev = f.state; }
    if (f.state === 'sniff') { run++; bestSniff = Math.max(bestSniff, run); } else run = 0;
  }
  t.metric('смен состояния лиса за 45 с', changes, 'шт');
  t.expect(bestSniff >= 60 * 8, `лис не постоял 8 с: ${(bestSniff / 60).toFixed(1)} с`);
  t.expect(changes < 40, `лис мерцает: ${changes} смен за 45 с`);
  sc.teleport(px, py);
});

registerTest('fauna', 'F6: с 2-го дня медведь иногда бродит к игроку (в пределах ±400 кл)', t => {
  const sc = (window as any).__sc;
  const b = fauna.bear!, p = G.player, a = aiOf(b)!;
  const save = { day: G.day, bx: b.x, by: b.y, px: p.x, py: p.y, tx: a.tx, mode: a.mode, cd: a.cd };
  const [pfx] = sc.teleport(600, groundY(600, 200) - 1);   // the ordinary pack-ice targets (960-1940) are mostly out of this window
  b.x = 1900; b.y = groundY(1900, 200) - 1; b.vx = 0; setAiMode(b, 'wander'); a.cd = 999;   // far: no sight, no smell
  G.day = 2;
  let near = 0; const N = 300;
  for (let i = 0; i < N; i++) { a.t = 15; a.hold = 0; G.wind = 0; stepFauna(1 / 60); if (Math.abs(a.tx - pfx) <= 400) near++; }
  t.metric('цели бродяги у игрока (из 300)', near, 'шт');
  t.expect(near >= 45 && near <= 170, `цели у игрока: ${near} из ${N}, ожидалось около 30%`);
  G.day = save.day; b.x = save.bx; b.y = save.by; a.tx = save.tx; a.mode = save.mode; a.cd = save.cd; b.vx = 0;
  sc.teleport(save.px, save.py);
});
