// Self-tests: live hunting (hunt.ts). Cod under the ice (cast, bite, catch, stock, regrowth), ptarmigan flocks (flush, harpoon, snare), the husky
// fetching a bird (fauna.ts), tracks in the snow, the save round trip, visibility under the ice, the cost of a step.
// Each test builds its own small world inside sandbox() (a sea under 7 cells of ice with one open hole; a lichen tundra) and drives the hunt
// directly with stepHunt / stepFauna, so nothing depends on the order of the other tests or on the real game loop.
import { registerTest, type TestCtx } from './selftest';
import { G, type Fixture } from './state';
import { TS, setCell } from '../engine/grid';
import { MAT } from '../content/materials';
import { sandbox } from './testkit';
import { emit, on } from './bus';
import { toolState } from './tools';
import { fauna, stepFauna, aiOf } from './fauna';
import {
  initHunt, stepHunt, setScanning, addHoleAt, addSiteAt, getHoles, getSites, huntInfo, huntSave, huntLoad, trackStep, dragMarks,
  huntDropNear, huntVisible, iceAboveAt,
} from './hunt';

const DT = 1 / 60;
const fishOf = () => G.animals.filter(e => e.kind === 'fish');
const birdsOf = () => G.animals.filter(e => e.kind === 'ptarmigan');

/** A sea under 7 cells of ice (rows top-7..top-1), water from row top, stone below; one open hole at column cx (ice removed). */
function seaWorld(cx: number, top: number) {
  for (let y = top - 12; y <= top + 34; y++) for (let x = cx - 70; x <= cx + 70; x++) {
    let m = MAT.AIR;
    if (y >= top + 30) m = MAT.STONE;
    else if (y >= top) m = MAT.WATER;
    else if (y >= top - 7) m = MAT.ICE;
    if (y >= top - 7 && y < top && Math.abs(x - cx) <= 2) m = MAT.AIR;
    setCell(x, y, m, 0, 0);
  }
  G.player.x = cx + 8; G.player.y = top - 9; G.player.vx = 0;
  return { hx: cx, sy: top };
}
/** Tundra: dirt from row g down, lichen on row g-1 over ±40 cells of cx (air above it). */
function landWorld(cx: number, g: number) {
  for (let y = g - 12; y <= g + 30; y++) for (let x = cx - 90; x <= cx + 90; x++) {
    let m = MAT.AIR;
    if (y >= g + 4) m = MAT.STONE;
    else if (y >= g) m = MAT.DIRT;
    else if (y === g - 1 && Math.abs(x - cx) <= 40) m = MAT.LICHEN;
    setCell(x, y, m, 0, 0);
  }
}
function prep() {
  setScanning(false); initHunt();
  G.timeScale = 1; G.storm = 0; G.toasts.length = 0;
  toolState.fish.state = 'idle'; toolState.fish.bite = 0;
}
function done() { initHunt(); toolState.fish.state = 'idle'; setScanning(true); }
/** Run fn inside a sandbox; the hunt state and the creatures are cleared afterwards. */
const inSandbox = <T,>(fn: () => T) => sandbox(() => { prep(); try { return fn(); } finally { done(); } });
/** Cast the line at (x, y) and step until a bite or `maxS` seconds. */
function castAndWait(x: number, y: number, maxS: number) {
  const f = toolState.fish;
  f.state = 'wait'; f.t = 9; f.x = x; f.y = y;
  emit('fishing', { x, y });
  let steps = 0;
  while (steps < maxS * 60 && (f.state as string) !== 'bite') { stepHunt(DT); steps++; }
  return { bit: (f.state as string) === 'bite', secs: steps / 60, bite: f.bite };
}

registerTest('hunt', 'рыба подплывает к закинутой леске, клюёт; поймана — пропадает из лунки', async (t: TestCtx) => {
  const r = await inSandbox(() => {
    const { hx, sy } = seaWorld(1000, 300);
    addHoleAt(hx, sy, 5);
    stepHunt(DT);                                    // the first step puts the cod of the hole in the water
    const fish = fishOf().length;
    const c = castAndWait(hx, sy + 3, 15);
    const toastBite = G.toasts.some(x => /Клюёт/.test(x.text));
    emit('fish_caught', { n: 1 }); toolState.fish.state = 'idle';   // tools.ts: the player tugged in time
    stepHunt(DT);
    return { fish, ...c, toastBite, fish2: fishOf().length, stock: getHoles()[0].stock };
  });
  t.expect(r.fish === 5, 'в лунке 5 трески, в мире ' + r.fish);
  t.expect(r.bit, 'клёва не было за 15 с');
  t.expect(!r.bit || Math.abs(r.bite - 1.3) < 1e-6, 'f.bite должен быть 1.3, а ' + r.bite);
  t.expect(r.secs < 10, 'треска подплывала дольше 10 с: ' + r.secs.toFixed(1));
  t.metric('клёв через', +r.secs.toFixed(1), 's');
  t.expect(r.toastBite, 'нет подсказки «Клюёт!»');
  t.expect(r.fish2 === 4 && r.stock === 4, 'после поимки должно остаться 4, а ' + r.fish2 + ' / запас ' + r.stock);
});

registerTest('hunt', 'без рыбы клёва нет: леска ждёт, через 25 с подсказка «Здесь пусто»', async (t: TestCtx) => {
  const r = await inSandbox(() => {
    const { hx, sy } = seaWorld(1000, 300);
    const f = toolState.fish;
    const out: Record<string, number | boolean> = {};
    // a) no hole at all
    f.state = 'wait'; emit('fishing', { x: hx, y: sy + 3 });
    let hintAt = -1;
    for (let i = 0; i < 60 * 30 && (f.state as string) === 'wait'; i++) { stepHunt(DT); if (hintAt < 0 && G.toasts.some(x => /Здесь пусто/.test(x.text))) hintAt = i / 60; }
    out.stillWaiting = (f.state as string) === 'wait'; out.hintAt = hintAt;
    // b) a hole whose stock is empty
    f.state = 'idle'; stepHunt(DT); G.toasts.length = 0;
    addHoleAt(hx, sy, 0);
    f.state = 'wait'; emit('fishing', { x: hx, y: sy + 3 });
    for (let i = 0; i < 60 * 10 && (f.state as string) === 'wait'; i++) stepHunt(DT);
    out.emptyBit = (f.state as string) === 'bite';
    return out;
  });
  t.expect(r.stillWaiting === true && r.emptyBit === false, 'без рыбы не должно быть клёва');
  t.expect(typeof r.hintAt === 'number' && (r.hintAt as number) >= 24.5 && (r.hintAt as number) <= 26, 'подсказка должна быть через ≈25 с, а ' + r.hintAt);
});

registerTest('hunt', 'выловленную лунку отрастает по игровым минутам (1 треска за 20 мин)', async (t: TestCtx) => {
  const r = await inSandbox(() => {
    const { hx, sy } = seaWorld(1000, 300);
    addHoleAt(hx, sy, 4);
    stepHunt(DT);
    const f = toolState.fish;
    G.timeScale = 0.0001;                            // the casting itself takes almost no game time
    let caught = 0;
    for (let k = 0; k < 4; k++) {
      const c = castAndWait(hx, sy + 3, 20);
      if (c.bit) { emit('fish_caught', { n: 1 }); caught++; }
      f.state = 'idle'; stepHunt(DT);
    }
    const empty = getHoles()[0].stock, left = fishOf().length;
    G.timeScale = 1;
    const hole = getHoles()[0];
    for (let i = 0; i < 60 * 9; i++) stepHunt(DT);   // 21.6 game min
    const after9 = hole.stock;
    for (let i = 0; i < 60 * 45; i++) stepHunt(DT); // +108 game min: back to the maximum
    return { caught, empty, left, after9, full: hole.stock, max: hole.max };
  });
  t.expect(r.caught === 4, 'поймано ' + r.caught + ' из 4');
  t.expect(r.empty === 0 && r.left === 0, 'лунка должна опустеть: запас ' + r.empty + ', в мире ' + r.left);
  t.expect(r.after9 === 1, 'через 21 игровую минуту должна быть 1 треска, а ' + r.after9);
  t.expect(r.full === r.max, 'через 2 игровых часа — полная лунка, а ' + r.full + ' из ' + r.max);
});

registerTest('hunt', 'стая куропаток вспархивает, когда мимо бежит игрок; стоящий игрок их не пугает', async (t: TestCtx) => {
  const r = await inSandbox(() => {
    landWorld(1000, 300);
    addSiteAt(1000, 299, 4);
    G.player.x = 1000 - 30; G.player.y = 299; G.player.vx = 0;
    for (let i = 0; i < 2 * 60; i++) stepHunt(DT);          // birds appear and peck
    const birds = birdsOf();
    const onGround = birds.length > 0 && birds.every(b => b.y >= 297.5 && b.y <= 299.5);
    for (let i = 0; i < 60; i++) stepHunt(DT);              // standing still 30 cells away
    const flewWhileStill = birds.filter(b => b.state === 'fly').length;
    G.player.vx = 36;                                       // running
    stepHunt(DT);
    const flying = birds.filter(b => b.state === 'fly').length;
    const flushCd = getSites()[0].flushCd;
    for (let i = 0; i < 60 * 5; i++) stepHunt(DT);          // they land and walk home
    const stillFlying = birdsOf().filter(b => b.state === 'fly').length;
    return { n: birds.length, onGround, flewWhileStill, flying, flushCd, stillFlying };
  });
  t.expect(r.n === 4, 'куропаток: ' + r.n + ', нужно 4');
  t.expect(r.onGround, 'куропатки должны стоять на земле, не на льду');
  t.expect(r.flewWhileStill === 0, 'стоящий игрок спугнул стаю');
  t.expect(r.flying > 0 && r.flushCd > 0, 'бегущий игрок не спугнул стаю');
  t.expect(r.stillFlying === 0, 'стая не села обратно');
});

registerTest('hunt', 'гарпун валит куропатку (лежит на снегу), силок ловит следующую', async (t: TestCtx) => {
  const r = await inSandbox(() => {
    landWorld(1000, 300);
    addSiteAt(1000, 299, 4);
    G.player.x = 1000 - 80; G.player.y = 299; G.player.vx = 0;
    for (let i = 0; i < 60; i++) stepHunt(DT);
    const b = birdsOf()[0];
    const stock0 = getSites()[0].stock;
    b.hp -= 12; emit('animal_hit', { id: b.id, dmg: 12, x: b.x, y: b.y, by: 'harpoon' });
    const shot = !G.animals.some(e => e.id === b.id);
    const dropHere = !!huntDropNear(b.x, b.y, 4);
    const stock1 = getSites()[0].stock;
    // a snare set under the next bird; the snare is moved with the bird so it stays in reach
    const b2 = birdsOf()[0], birds0 = birdsOf().length;
    const snare: Fixture = { id: 99991, kind: 'snare', tx: 0, ty: 0, tw: 1, th: 1, data: { set: true } };
    G.fixtures.push(snare);
    let s = 0;
    while (s < 60 * 20 && !(snare.data as Record<string, unknown>).catch) {
      snare.tx = Math.floor(b2.x / TS); snare.ty = Math.floor(b2.y / TS);
      stepHunt(DT); s++;
    }
    const caught = (snare.data as Record<string, unknown>).catch === 'ptarmigan';
    const birdGone = birdsOf().length === birds0 - 1;     // whichever bird came into the snare, one is gone
    return { stock0, shot, dropHere, stock1, caught, birdGone, stock2: getSites()[0].stock, secs: s / 60, dbg: JSON.stringify({ data: snare.data, b2x: b2.x, b2y: b2.y, fx: G.fixtures.filter(f => f.kind === 'snare').length, animals: G.animals.filter(e => e.kind === 'ptarmigan').length }) };
  });
  t.expect(r.shot && r.dropHere, 'гарпун не свалил куропатку или бросок не лёг на снег');
  t.expect(r.stock1 === r.stock0 - 1, 'запас участка должен уменьшиться на 1: ' + r.stock0 + ' → ' + r.stock1);
  t.expect(r.caught && r.birdGone, 'силок не поймал куропатку за 20 с: caught=' + r.caught + ' gone=' + r.birdGone);
  t.expect(r.stock2 === r.stock1 - 1, 'после силка запас должен упасть ещё на 1');
  t.metric('силок поймал через', +r.secs.toFixed(1), 's');
});

registerTest('hunt', 'Север приносит подстреленную куропатку хозяину', async (t: TestCtx) => {
  const r = await inSandbox(() => {
    landWorld(1000, 300);
    addSiteAt(1000, 299, 4);
    const dog = fauna.dog!;
    const d0 = { x: dog.x, y: dog.y };
    const p = G.player; p.x = 1000 - 60; p.y = 299; p.vx = 0;
    stepHunt(DT);
    const b = birdsOf()[0];
    b.x = 1000 - 40; b.hp = 0; emit('animal_hit', { id: b.id, dmg: 12, x: b.x, y: b.y, by: 'harpoon' });
    const hunted = huntDropNear(b.x, b.y, 4);
    const hid = hunted ? hunted.id : -1;
    dog.x = 1000 - 42; dog.y = 299; dog.vx = 0;
    dog.face = 1; const a = aiOf(dog)!; a.stay = false; a.hold = 0;
    let steps = 0, fetched = false;
    for (; steps < 60 * 40; steps++) {
      stepFauna(DT);
      if (!G.drops.some(x => x.id === hid)) fetched = true;
      if (fetched && G.drops.some(x => x.item === 'ptarmigan' && Math.abs(x.x - p.x) < 14)) break;
    }
    const back = G.drops.filter(x => x.item === 'ptarmigan' && Math.abs(x.x - p.x) < 14).length;
    const restore = { x: d0.x, y: d0.y };
    a.fetch = undefined;
    dog.x = restore.x; dog.y = restore.y;
    return { hunted: !!hunted, fetched, back, secs: steps / 60 };
  });
  t.expect(r.hunted, 'бросок куропатки не появился на снегу');
  t.expect(r.fetched, 'Север не забрал куропатку');
  t.expect(r.back > 0, 'Север не принёс куропатку к хозяину');
  t.metric('Север принёс за', +r.secs.toFixed(1), 's');
});

registerTest('hunt', 'следы в снегу: появляются у ходящих, выцветают за шесть часов, а в шторм стираются быстрее', async (t: TestCtx) => {
  const r = await inSandbox(() => {
    const a = trackStep(1, 'fox', 100, 300, 1, 4), b = trackStep(1, 'fox', 101, 300, 1, 4), c = trackStep(1, 'fox', 104, 300, 1, 4);
    dragMarks(200, 300, 1);
    const n1 = huntInfo().tracks;
    G.storm = 0; for (let i = 0; i < 60 * 100; i++) stepHunt(DT);     // 240 game min: still there
    const n2 = huntInfo().tracks;
    for (let i = 0; i < 60 * 70; i++) stepHunt(DT);                  // ~408 game min: gone
    const n3 = huntInfo().tracks;
    // the same prints in a storm: 40 s at storm 1 = 96 game min x4 = gone
    dragMarks(300, 300, 1); G.storm = 1; for (let i = 0; i < 60 * 40; i++) stepHunt(DT);
    const stormGone = huntInfo().tracks === 0;
    G.storm = 0;
    return { a, b, c, n1, n2, n3, stormGone };
  });
  t.expect(r.a && !r.b && r.c, 'след должен ложиться через 4 клетки: ' + r.a + r.b + r.c);
  t.expect(r.n1 === 8, 'после двух шагов лисы и волочения тюленя 8 следов, а ' + r.n1);
  t.expect(r.n2 > 0, 'следы пропали раньше, чем через 4 часа');
  t.expect(r.n3 === 0, 'следы должны выцвести за 6 часов, осталось ' + r.n3);
  t.expect(r.stormGone, 'в шторм следы должны стираться быстрее');
});

registerTest('hunt', 'сохранение: запасы лунок и участков, следы и счётчики переживают загрузку', async (t: TestCtx) => {
  const r = await inSandbox(() => {
    addHoleAt(1000, 300, 5); getHoles()[0].stock = 2; getHoles()[0].regen = 7;
    addSiteAt(1050, 299, 4); getSites()[0].stock = 3;
    trackStep(5, 'bear', 1020, 299, 1, 7); dragMarks(1100, 299, -1);
    const saved = JSON.parse(JSON.stringify(huntSave())) as ReturnType<typeof huntSave>;
    initHunt();
    const empty = huntInfo().holes + huntInfo().tracks;
    huntLoad(saved); initHunt();
    const info = huntInfo();
    const h = getHoles()[0], s = getSites()[0];
    return { empty, holes: info.holes, stock: h?.stock, max: h?.max, regen: h?.regen, sites: info.sites, sStock: s?.stock, tracks: info.tracks, pending: !!saved };
  });
  t.expect(r.empty === 0, 'новый мир должен начинаться без следов и лунок');
  t.expect(r.holes === 1 && r.stock === 2 && r.max === 5 && r.regen === 7, 'лунка: ' + JSON.stringify(r));
  t.expect(r.sites === 1 && r.sStock === 3, 'участок куропаток: ' + r.sStock);
  t.expect(r.tracks === 7, 'следы: 1 + 6 тюленя, а ' + r.tracks);
});

registerTest('hunt', 'треска под толстым льдом не видна; у открытой лунки видна', async (t: TestCtx) => {
  const r = await inSandbox(() => {
    const { hx, sy } = seaWorld(1000, 300);
    addHoleAt(hx, sy, 5);
    stepHunt(DT);                                    // the cod appear
    const under = iceAboveAt(hx + 9, sy + 5), open = iceAboveAt(hx, sy + 5);
    for (const e of fishOf()) { e.x = hx + 9.5; e.y = sy + 5; }   // all under 7 cells of ice (refresh every 0.5 s)
    stepHunt(0.5);
    const hiddenUnderIce = huntVisible();
    const e0 = fishOf()[0];
    if (e0) { e0.x = hx + 0.5; e0.y = sy + 5; }                  // one over the open hole
    stepHunt(0.5);
    const visOverHole = huntVisible();
    return { under, open, hiddenUnderIce, visOverHole, fish: fishOf().length };
  });
  t.expect(r.under === 7, 'под льдом 7 клеток, а ' + r.under);
  t.expect(r.open === 0, 'над лункой льда нет, а ' + r.open);
  t.expect(r.hiddenUnderIce === 0, 'под толстым льдом треска видна: ' + r.hiddenUnderIce);
  t.expect(r.visOverHole === 1, 'над открытой лункой треска должна быть видна: ' + r.visOverHole + ' из ' + r.fish);
});

registerTest('hunt', 'далёкие лунки не держат рыбу в мире, их запас ждёт; подошёл — рыба появилась', async (t: TestCtx) => {
  const r = await inSandbox(() => {
    const { hx, sy } = seaWorld(1000, 300);
    addHoleAt(hx, sy, 3);
    G.player.x = hx + 400;
    stepHunt(DT); for (let i = 0; i < 60; i++) stepHunt(DT);
    const far = fishOf().length, farStock = getHoles()[0].stock;
    G.player.x = hx + 8;
    for (let i = 0; i < 60; i++) stepHunt(DT);
    return { far, farStock, near: fishOf().length };
  });
  t.expect(r.far === 0 && r.farStock === 3, 'вдали рыбы быть не должно, а запас 3: ' + JSON.stringify(r));
  t.expect(r.near === 3, 'у лунки должны появиться 3 трески, а ' + r.near);
});

registerTest('hunt', 'Север стоит без дела рядом с хозяином и показывает на лунку с рыбой', async (t: TestCtx) => {
  const r = await inSandbox(() => {
    const { hx, sy } = seaWorld(1000, 300);
    addHoleAt(hx, sy, 4);
    const dog = fauna.dog!; const d0 = { x: dog.x, y: dog.y };
    const p = G.player; p.x = 1016; p.y = sy - 1; p.vx = 0;
    dog.x = 1012; dog.y = sy - 1; dog.vx = 0;
    const a = aiOf(dog)!; a.stay = false; a.hold = 0; a.fetch = undefined; a.pointed = false;
    let pointed = false, at = { x: 0, y: 0 };
    const off = on('dog_point', (d: { x: number; y: number }) => { pointed = true; at = d; });
    let steps = 0;
    for (; steps < 60 * 8 && !pointed; steps++) stepFauna(DT);
    off();
    const face = dog.face;
    dog.x = d0.x; dog.y = d0.y; a.hold = 0; a.pointed = false;
    return { pointed, secs: steps / 60, face, at };
  });
  t.expect(r.pointed, 'Север не показал на лунку за 8 с');
  t.expect(r.pointed && r.at.x === 1000, 'показал не на ту лунку: ' + JSON.stringify(r.at));
  t.expect(r.face === -1, 'лунка слева, а Север смотрит ' + r.face);
  t.metric('Север показал через', +r.secs.toFixed(1), 's');
});

registerTest('hunt', 'шаг охоты: 36 рыб и 24 куропатки — не больше доли миллисекунды', async (t: TestCtx) => {
  const ms = await inSandbox(() => {
    seaWorld(1000, 300);
    for (const x of [990, 1010, 1030, 1050]) addHoleAt(x, 300, 6);
    landWorld(1200, 300);
    for (const x of [1190, 1210, 1230, 1250]) addSiteAt(x, 299, 6);
    G.player.x = 1130; G.player.y = 299;
    for (let i = 0; i < 90; i++) stepHunt(DT);                  // fill the caps
    const t0 = performance.now();
    const n = 600;
    for (let i = 0; i < n; i++) stepHunt(DT);
    return { per: (performance.now() - t0) / n, fish: fishOf().length, birds: birdsOf().length };
  });
  t.metric('шаг охоты, мкс', +(ms.per * 1000).toFixed(1), 'µs');
  t.metric('рыб / куропаток', ms.fish * 100 + ms.birds, '');
  t.expect(ms.fish === 24 && ms.birds === 24, 'в мире должно быть 24 трески и 24 куропатки, а ' + ms.fish + ' и ' + ms.birds);
  t.expect(ms.per < 1.5, 'шаг охоты медленнее 1.5 мс: ' + ms.per.toFixed(2));
});

