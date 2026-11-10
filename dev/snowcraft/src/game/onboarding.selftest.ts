// Self-tests (group 'onboarding', playtest v13, scope v13b): the goal line never disappears; the stove takes fuel from the pack by itself and names
// what to find with an empty pack; a fire warns 30 game-minutes before it goes out; the cold replaces the goal line outdoors with no fire near;
// the igloo goal counts its blocks and points at the snow field.
import { registerTest } from './selftest';
import { G } from './state';
import { emit } from './bus';
import { inv, count, clearInventory, add } from './inventory';
import { interact } from './fixtures';
import { GOALS, objectiveText, objectiveTarget, readNote } from './quest';
import { LOC } from './locations';

const fresh = (t: { sc: any }) => { t.sc.start({ seed: G.seed, diff: G.diff.level, hardcore: G.diff.hardcore }); };

registerTest('onboarding', 'цель видна через 30 с и не сворачивается (текст в DOM)', async (t) => {
  fresh(t); await t.frames(10);
  const el = () => document.querySelector('#hud .stk .obj .ot') as HTMLElement | null;
  const first = objectiveText();
  t.expect(/уголь/i.test(first), 'первая цель: ' + first);
  t.sc.step(1800); await t.wait(60);                    // 30 s of HUD time
  t.expect(!!el() && el()!.textContent === objectiveText() && objectiveText().length > 0, 'через 30 с текст цели пропал: ' + (el()?.textContent ?? 'нет элемента'));
  t.expect(!!el() && el()!.offsetParent !== null, 'текст цели скрыт (display)');
  t.expect(!document.querySelector('#hud .stk .obj.col'), 'строка цели свернулась в «Цель»');
});

registerTest('onboarding', 'печка сама берёт уголь из сумки (E / ПКМ); без топлива в сумке говорит «Нужен уголь»', async (t) => {
  fresh(t); await t.frames(10);
  const f = G.fixtures.find(o => o.kind === 'stove');
  if (!f) { t.expect(false, 'нет печки в доме'); return; }
  clearInventory(); add('coal', 3); inv.sel = inv.slots.findIndex(s => !s);     // coal in the pack, nothing fuel in the hand
  f.fuel = 0; f.lit = false;
  interact(f);
  t.expect((f.fuel ?? 0) > 0 && count('coal') === 2, `уголь не ушёл в печку: топливо ${f.fuel}, угля ${count('coal')}`);
  clearInventory(); f.fuel = 0; f.lit = false; G.toasts.length = 0;
  interact(f);
  const last = G.toasts.length ? G.toasts[G.toasts.length - 1].text : '';
  t.expect(/Нужен уголь: подбери его снаружи/.test(last), 'пустая сумка: нет подсказки «Нужен уголь»: ' + last);
});

registerTest('onboarding', 'печка предупреждает за 30 игровых минут до погасания', async (t) => {
  fresh(t); await t.frames(10);
  const f = G.fixtures.find(o => o.kind === 'stove');
  if (!f) { t.expect(false, 'нет печки в доме'); return; }
  f.fuel = 31; f.lit = true; if (f.data) f.data.soonWarned = false; G.toasts.length = 0;
  t.sc.step(120);                                       // the burn takes it below 30 game-minutes
  t.expect(f.data?.soonWarned === true && G.toasts.some(x => /скоро погаснет/.test(x.text)), 'нет предупреждения «скоро погаснет»: ' + G.toasts.map(x => x.text).join(' | '));
});

registerTest('onboarding', 'на холоде на улице цель меняется на «Согрейся» со стрелкой на дверь станции; в тепле — нет', async (t) => {
  fresh(t); await t.frames(10);
  const p = G.player;
  t.sc.teleport(LOC.station.x0 - 60, 272); await t.frames(30);          // outdoors, west of the station
  for (const f of G.fixtures) if (f.lit) f.lit = false;
  p.core = 34; await t.frames(2);
  t.expect(/Согрейся/.test(objectiveText()), 'на холоде цель не «Согрейся»: ' + objectiveText());
  const tg = objectiveTarget();
  t.expect(!!tg && tg.x >= LOC.station.x0 && tg.x <= LOC.station.x1, 'стрелка на холоде не на дверь станции: ' + JSON.stringify(tg));
  p.core = 37; await t.frames(2);
  t.expect(!/Согрейся/.test(objectiveText()), 'в тепле цель осталась «Согрейся»');
  t.sc.teleport(LOC.house.L * 4 + 40, LOC.station.y - 4); await t.frames(20);
  p.core = 33; await t.frames(2);
  t.expect(!/Согрейся/.test(objectiveText()), 'в доме цель «Согрейся»: ' + objectiveText());
  p.core = 37;
});

registerTest('onboarding', 'иглу: счётчик «Блоков N/10» считает блоки снаружи; стрелка на снежное поле', async (t) => {
  fresh(t); await t.frames(10);
  const shelter = GOALS.find(g => g.id === 'shelter')!;
  t.expect(/Блоков 0\/10/.test(shelter.text()), 'счётчик не показан: ' + shelter.text());
  const x0 = G.player.x; G.player.x = 500;             // outside the station (LOC.station.x0 = 556)
  emit('placed', { item: 'snow_block' }); emit('placed', { item: 'snow_block' }); emit('placed', { item: 'snow_block' });
  G.player.x = x0;
  t.expect(/Блоков 3\/10/.test(shelter.text()), 'счётчик не считает блоки снаружи: ' + shelter.text());
  // the chain up to the igloo (as quest.selftest's first-day test does), then the igloo goal's arrow
  emit('picked', { item: 'coal', n: 4 }); emit('door_dug', {}); emit('fire_lit', { kind: 'stove' }); emit('barometer', {});
  readNote('s1'); await t.frames(2);
  t.expect(/иглу/.test(objectiveText()), 'цель не про иглу: ' + objectiveText());
  const tg = objectiveTarget();
  t.expect(!!tg && Math.abs(tg.x - 522) < 40 && Math.abs(tg.y - 238) < 40, 'стрелка иглу не на снежное поле: ' + JSON.stringify(tg));
});
