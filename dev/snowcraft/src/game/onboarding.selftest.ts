// Self-tests (group 'onboarding', playtest v13): the first 15 minutes read by a newcomer. The goal line never disappears and a new goal flashes;
// three coal sacks lie in plain view within 40 cells of the spawn, reachable on foot, and the arrow shows the nearest reachable one with its distance;
// the stove takes fuel from the pack by itself and says «Нужен уголь» with an empty pack; a fire warns 30 game-minutes before it goes out; the cold
// replaces the goal line outdoors with no fire near; the igloo goal counts its blocks; the mini-goals and their win toasts.
import { registerTest } from './selftest';
import { G } from './state';
import { emit, on } from './bus';
import { MAT } from '../content/materials';
import { W, mat } from '../engine/grid';
import { inv, count, clearInventory, add } from './inventory';
import { interact } from './fixtures';
import { GOALS, objectiveText, objectiveTarget, runStats } from './quest';
import { LOC } from './locations';

const fresh = (t: { sc: any }) => { t.sc.start({ seed: G.seed, diff: G.diff.level, hardcore: G.diff.hardcore }); };
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const lastToast = () => (G.toasts.length ? G.toasts[G.toasts.length - 1].text : '');

registerTest('onboarding', 'цель видна через 30 с и не сворачивается (текст в DOM)', async (t) => {
  fresh(t); await t.frames(10);
  const el = () => document.querySelector('#hud .stk .obj .ot') as HTMLElement | null;
  const first = objectiveText();
  t.expect(/уголь/i.test(first), 'первая цель: ' + first);
  t.sc.step(1800); await t.wait(60);                    // 30 s of HUD time
  t.expect(!!el() && el()!.textContent === objectiveText() && objectiveText().length > 0, 'через 30 с текст цели пропал: ' + (el()?.textContent ?? 'нет элемента'));
  t.expect(!!el() && el()!.offsetParent !== null, 'текст цели скрыт (display)');
});

registerTest('onboarding', 'три угля в виду у старта: в 40 клетках, на воздухе, стрелка ведёт к ближайшему достижимому', async (t) => {
  fresh(t); await t.frames(20);
  const p = G.player, spawn = { x: p.x, y: p.y };
  const near = G.drops.filter(d => d.item === 'coal' && dist(d, spawn) <= 40);
  t.expect(near.length >= 3, 'угля в 40 клетках от старта: ' + near.length);
  for (const d of near) {
    const up = Math.floor(d.y) - 1;                     // the cell just above the sack must be air: lying in plain view, not in the snow
    t.expect(mat[up * W + Math.floor(d.x)] === MAT.AIR, 'уголь закопан в снегу: ' + Math.round(d.x) + ',' + Math.round(d.y));
  }
  const tg = objectiveTarget();
  const nearest = G.drops.filter(d => d.item === 'coal').sort((a, b) => dist(a, p) - dist(b, p))[0];
  t.expect(!!tg && !!nearest && dist(tg, nearest) < 2, 'стрелка не на ближайшем угле: ' + JSON.stringify(tg));
  t.expect(/· \d+ м/.test(objectiveText()), 'расстояние до угля не показано: ' + objectiveText());
});

registerTest('onboarding', 'печка сама берёт уголь из сумки (E / ПКМ), без топлива в сумке говорит «Нужен уголь»', async (t) => {
  fresh(t); await t.frames(10);
  const f = G.fixtures.find(o => o.kind === 'stove');
  if (!f) { t.expect(false, 'нет печки в доме'); return; }
  // coal in the pack, nothing fuel in the hand
  clearInventory(); add('coal', 3); inv.sel = inv.slots.findIndex(s => !s);
  f.fuel = 0; f.lit = false;
  interact(f);
  t.expect((f.fuel ?? 0) > 0 && count('coal') === 2, `уголь не ушёл в печку: топливо ${f.fuel}, угля ${count('coal')}`);
  // an empty pack: the stove names what to find
  clearInventory(); f.fuel = 0; f.lit = false; G.toasts.length = 0;
  interact(f);
  t.expect(/Нужен уголь: подбери его снаружи/.test(lastToast()), 'пустая сумка: нет подсказки «Нужен уголь»: ' + lastToast());
});

registerTest('onboarding', 'печка предупреждает за 30 игровых минут до погасания', async (t) => {
  fresh(t); await t.frames(10);
  const f = G.fixtures.find(o => o.kind === 'stove');
  if (!f) { t.expect(false, 'нет печки в доме'); return; }
  f.fuel = 31; f.lit = true; if (f.data) f.data.soonWarned = false; G.toasts.length = 0;
  t.sc.step(120);                                       // the burn takes it below 30 game-minutes
  t.expect(f.data?.soonWarned === true && G.toasts.some(x => /скоро погаснет/.test(x.text)), 'нет предупреждения «скоро погаснет»: ' + G.toasts.map(x => x.text).join(' | '));
});

registerTest('onboarding', 'на холоде на улице цель меняется на «Согрейся», у печки и у тепла — нет', async (t) => {
  fresh(t); await t.frames(10);
  const p = G.player;
  // outdoors, far from any fire (the spawn is near the house: walk west of the station first)
  t.sc.teleport(LOC.station.x0 - 60, 272); await t.frames(30);
  for (const f of G.fixtures) if (f.lit) f.lit = false;
  p.core = 34; await t.frames(2);
  t.expect(/Согрейся/.test(objectiveText()), 'на холоде цель не «Согрейся»: ' + objectiveText());
  const tg = objectiveTarget();
  t.expect(!!tg && tg.x >= LOC.station.x0 && tg.x <= LOC.station.x1 && tg.y > LOC.station.y - 40, 'стрелка на холоде не на дверь станции: ' + JSON.stringify(tg));
  p.core = 37; await t.frames(2);
  t.expect(!/Согрейся/.test(objectiveText()), 'в тепле цель осталась «Согрейся»');
  t.sc.teleport(LOC.house.L * 4 + 40, LOC.station.y - 4); await t.frames(20);
  p.core = 33; await t.frames(2);
  t.expect(!/Согрейся/.test(objectiveText()), 'в доме цель «Согрейся»: ' + objectiveText());
  p.core = 37;
});

registerTest('onboarding', 'иглу: счётчик «Блоков N/10» считает блоки снаружи, мини-цели с наградами', async (t) => {
  fresh(t); await t.frames(10);
  const shelter = GOALS.find(g => g.id === 'shelter')!;
  t.expect(/Блоков 0\/10/.test(shelter.text()), 'счётчик не показан: ' + shelter.text());
  const x0 = G.player.x; G.player.x = 500;             // outside the station (LOC.station.x0 = 556)
  emit('placed', { item: 'snow_block' }); emit('placed', { item: 'snow_block' }); emit('placed', { item: 'snow_block' });
  G.player.x = x0;
  t.expect(/Блоков 3\/10/.test(shelter.text()), 'счётчик не считает блоки снаружи: ' + shelter.text());
  // the mini-goals: a catch counts, then a warm night indoors; each turns done with its own toast
  const fish = GOALS.find(g => g.id === 'fish')!, sleep = GOALS.find(g => g.id === 'sleep')!;
  t.expect(!fish.done(), 'рыба уже засчитана в начале');
  G.toasts.length = 0;
  const done: string[] = [], off = on('goal_done', (d: { id: string }) => done.push(d.id));
  emit('fish_caught', { n: 1 }); t.sc.step(90); await t.wait(10);
  t.expect(fish.done() && done.includes('fish'), 'улов не засчитан как цель: ' + done.join(','));
  t.expect(G.toasts.some(x => /Улов на ужин/.test(x.text)), 'за улов нет награды');
  t.expect(!sleep.done(), 'сон уже засчитан в начале');
  const x1 = G.player.x, y1 = G.player.y; G.player.x = LOC.house.L * 4 + 40; G.player.y = LOC.station.y;
  emit('slept', { hours: 4 });
  G.player.x = x1; G.player.y = y1;
  t.sc.step(90); await t.wait(10); off();
  t.expect(sleep.done() && done.includes('sleep'), 'ночь в тепле не засчитана как цель');
  t.expect(G.toasts.some(x => /Выспался в тепле/.test(x.text)), 'за ночь в тепле нет награды');
  t.expect(runStats.fish >= 1, 'улов не в статистике');
});
