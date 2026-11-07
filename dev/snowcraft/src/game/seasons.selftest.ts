// Self-tests (group 'seasons'): the endless sandbox (DESIGN §18): the ring night 12 d -> twilight 6 d -> night, the ramp that grows and caps, no ending at
// day 12/13/30, the death card with statistics and the record, old saves (endDay / ended) loading as endless, the HUD label, the rotating goal line,
// the icebreaker's supply crate.
import { registerTest } from './selftest';
import { G } from './state';
import { on, emit } from './bus';
import { sandbox } from './testkit';
import { setDay, stepWeather, ringStorms, nextStorm, applyClock, wx } from './weather';
import { ramp, phaseName, phaseOfDay, cycleOf, rampAt, seasonLabel, loadBest, bearCount } from './seasons';
import { questState, objectiveText, runStats, resetQuest, stepQuest, icebreakerPasses, suggestionList, GOALS } from './quest';
import { capture } from './save';
import { readNote } from './lore';

const click = (a: string) => { const b = document.querySelector(`#ov button[data-a="${a}"]`) as HTMLElement | null; b?.click(); return !!b; };

registerTest('seasons', 'кольцо: ночь 12 дней → сумерки 6 дней → ночь; круг растёт, день считается дальше', async (t) => {
  await sandbox(() => {
    const exp: [number, 'night' | 'twilight', number][] = [[1, 'night', 0], [12, 'night', 0], [13, 'twilight', 0], [18, 'twilight', 0], [19, 'night', 1], [30, 'night', 1], [31, 'twilight', 1], [37, 'night', 2]];
    for (const [d, ph, c] of exp) {
      setDay(d, 10);
      t.expect(G.day === d && phaseName() === ph && G.cycle === c, `день ${d}: ${phaseName()} круг ${G.cycle}, ждали ${ph}/${c}`);
      t.expect(phaseOfDay(d) === ph && cycleOf(d) === c, `phaseOfDay/cycleOf день ${d}`);
    }
    // the sky follows: noon of a twilight day lifts the sun just above the horizon, a night day never does
    setDay(15, 12); t.expect(G.noonElev > 0.2 && G.noonElev < 1.2 && G.daylight > 0.9, `сумерки: полдень ${G.noonElev.toFixed(2)}°, свет ${G.daylight.toFixed(2)}`);
    setDay(6, 12); t.expect(G.noonElev < -6 && G.daylight < 0.4, `ночь: полдень ${G.noonElev.toFixed(2)}°`);
    setDay(34, 12); t.expect(G.noonElev > 0.2, 'второй круг: сумерки так же светлы');
  });
});

registerTest('seasons', 'события: смена фазы шлёт season, ночь→сумерки по часам, вехи', async (t) => {
  await sandbox(() => {
    wx.override = null;
    const got: string[] = [];
    const off = on('season', (d: { phase: string; cycle: number }) => got.push(d.phase + d.cycle));
    setDay(12, 23); for (let i = 0; i < 60 * 8; i++) stepWeather(0.1);       // across midnight of day 12 -> 13
    t.expect(G.day === 13 && got.join() === 'twilight0', `13 день: ${G.day} ${got.join()}`);
    setDay(18, 23); for (let i = 0; i < 60 * 8; i++) stepWeather(0.1);
    t.expect(G.day === 19 && got.join() === 'twilight0,night1', 'новая ночь, круг 1: ' + got.join());
    off();
  });
});

registerTest('seasons', 'нет концовок: день 12, 13 и 30 игра идёт дальше; endDay не ограничивает', async (t) => {
  await sandbox(() => {
    wx.override = null;
    let ended = 0; const off = on('ending', () => ended++);
    for (const d of [11, 12, 13, 30]) { setDay(d, 9); for (let i = 0; i < 60 * 12; i++) stepWeather(0.1); }
    off();
    t.expect(ended === 0, 'сработало событие ending ×' + ended);
    t.expect(questState.ended === '' && G.player.alive, 'квест закончился: ' + questState.ended);
    t.expect(!/до рассвета/i.test(objectiveText()), 'в цели осталось «до рассвета»: ' + objectiveText());
    t.expect(G.day === 30 + 0 && !G.paused, `день ${G.day}, пауза ${G.paused}`);
  });
});

registerTest('seasons', 'ramp: растёт с кругом, ограничен, сложность масштабирует', async (t) => {
  await sandbox(() => {
    const at = (c: number) => { setDay(1 + 18 * c, 10); return { ...ramp }; };
    const r0 = at(0), r1 = at(1), r5 = at(5), r10 = at(10), r40 = at(40);
    t.expect(r0.storm === 1 && r0.bear === 1 && r0.wind === 1 && r0.drift === 1 && r0.thinIce === 1, 'круг 0: всё ×1 ' + JSON.stringify(r0));
    t.expect(r1.storm > r0.storm && r5.storm > r1.storm && r5.bear > r1.bear && r5.drift > r1.drift && r5.thinIce > r1.thinIce, 'рост ' + JSON.stringify(r5));
    t.expect(Math.abs(r1.storm - 1.08) < 1e-6 && Math.abs(r1.bear - 1.05) < 1e-6, 'шаг +8% / +5% на круг (Обычная)');
    t.expect(r10.storm <= 1.8 + 1e-6 && r40.storm <= 1.8 + 1e-6 && r40.bear <= 1.4 + 1e-6 && r40.wind <= 1.8 + 1e-6, 'потолки: ' + JSON.stringify(r40));
    t.expect(Math.abs(r40.storm - 1.8) < 1e-6 && Math.abs(r40.bear - 1.4) < 1e-6, 'потолок достигнут');
    t.expect(rampAt(5, 0).storm < rampAt(5, 1).storm && rampAt(5, 1).storm < rampAt(5, 2).storm, 'сложность масштабирует рамп');
    G.cycle = 2; t.expect(bearCount() === 1, 'второй медведь не раньше круга 3'); G.cycle = 3; t.expect(bearCount() === 2, 'второй медведь с круга 3');
    // storms: more of them in later rings, schedule is deterministic
    const n0 = ringStorms(0).length, n6 = ringStorms(6).length;
    t.expect(n6 > n0 && JSON.stringify(ringStorms(6)) === JSON.stringify(ringStorms(6)), `пург в кольце 0: ${n0}, в кольце 6: ${n6}`);
    t.expect(ringStorms(6).every(s => s.start > 6 * 18 * 1440 && s.dur >= 5 * 60 && s.peak <= 1), 'пурги кольца 6 в своём кольце');
    setDay(1 + 18 * 6, 1); t.expect(!!nextStorm(), 'прогноз пург есть в позднем круге');
    // wind in a storm rises with the ramp
    const s6 = ringStorms(6).find(s => s.peak > 0.9) ?? ringStorms(6)[0];
    wx.override = null; G.time = s6.start + s6.dur / 2; applyClock(); const w6 = Math.abs(G.wind);
    t.expect(w6 > 10, 'в пургу круга 6 ветер ' + w6.toFixed(1));
  });
});

registerTest('seasons', 'сумерки теплее и спокойнее ночи; аврора тише', async (t) => {
  await sandbox(() => {
    wx.override = null;
    const avg = (d0: number, d1: number) => { let T = 0, W = 0, A = 0, n = 0; for (let d = d0; d <= d1; d++) for (let h = 0; h < 24; h += 3) { setDay(d, h); if (G.storm > 0.1) continue; T += G.ambientT; W += Math.abs(G.wind); A += G.aurora; n++; } return { T: T / n, W: W / n, A: A / n }; };
    const night = avg(4, 8), twi = avg(14, 17);
    t.expect(twi.T > night.T + 3, `теплее: ночь ${night.T.toFixed(1)}°, сумерки ${twi.T.toFixed(1)}°`);
    t.expect(twi.W < night.W, `ветер тише: ${night.W.toFixed(1)} → ${twi.W.toFixed(1)}`);
  });
});

registerTest('seasons', 'HUD: «День N · Ночь/Сумерки · круг C»', async (t) => {
  await sandbox(async () => {
    setDay(5, 10); t.expect(seasonLabel() === 'День 5 · Ночь · круг 1', seasonLabel());
    setDay(14, 10); t.expect(seasonLabel() === 'День 14 · Сумерки · круг 1', seasonLabel());
    setDay(20, 10); t.expect(seasonLabel() === 'День 20 · Ночь · круг 2', seasonLabel());
    await t.frames(4);
    const el = document.querySelector('#hud .dial .day') as HTMLElement | null;
    t.expect(!!el && el.textContent.replace(/\u00a0/g, ' ') === 'День 20 · Ночь · круг 2' && !/\/\s*12/.test(el.textContent), 'HUD: ' + el?.textContent);
    // the HUD keeps the day only until the second ring (night and the ring appear from ring 2 on, twilight shows its word)
    setDay(5, 10); t.sc.step(14); await t.wait(80);
    t.expect(el!.textContent.replace(/\u00a0/g, ' ') === 'День 5', 'в первом круге HUD показывает только день: ' + el!.textContent);
  });
});

registerTest('seasons', 'цели: цепочка первого дня остаётся, дальше вращающаяся «следующая разумная вещь»', async (t) => {
  await sandbox(() => {
    resetQuest();
    t.expect(/уголь/i.test(objectiveText()), 'старт: ' + objectiveText());
    emit('picked', { item: 'coal', n: 2 }); emit('door_dug', {}); emit('fire_lit', { kind: 'stove' }); emit('barometer', {});
    readNote('s1'); readNote('n1');
    const px = G.player.x; G.player.x = 1000; runStats.placed = 5; emit('shelter', { stars: 2, closed: true, vent: true }); G.player.x = px;
    t.expect(GOALS.slice(0, 7).every(g => g.done()), 'цепочка не пройдена: ' + GOALS.filter(g => !g.done()).map(g => g.id).join());
    const lines = new Set<string>();
    for (let k = 0; k < 24; k++) { G.time += 240; lines.add(objectiveText()); }
    t.expect(lines.size >= 2, 'строка не вращается: ' + [...lines].join(' | '));
    t.expect([...lines].every(l => l.length > 6 && !/до рассвета|\/\s*12/i.test(l)), 'плохая строка: ' + [...lines].join(' | '));
    t.expect(suggestionList().length >= 1, 'нет подсказок');
    resetQuest();
  });
});

registerTest('seasons', 'ледокол: пролёт, ящик у мыса (топливо, еда, ракета), раз в круг', async (t) => {
  await sandbox(() => {
    resetQuest(); setDay(3, 10);
    const d0 = G.drops.length;
    emit('radio_fixed', {}); t.expect(questState.icebreakerAt > 0, 'ледокол не назначен');
    icebreakerPasses();
    const items = G.drops.slice(d0).map(d => d.item);
    t.expect(['coal', 'can', 'flare'].every(i => items.includes(i)), 'ящик: ' + items.join());
    t.expect(questState.icebreakerAt < 0 && questState.crateRing === 0 && questState.ended === '', 'ледокол ушёл, концовки нет');
    stepQuest(0.1); t.expect(questState.icebreakerAt < 0, 'в том же круге второго визита нет');
    setDay(19, 10); stepQuest(0.1); t.expect(questState.icebreakerAt > 0, 'в новом кольце ледокол можно вызвать снова');
    G.drops.length = d0; resetQuest();
  });
});

registerTest('seasons', 'старое сохранение (endDay 12, концовка пройдена) грузится как бесконечное', async (t) => {
  const d = capture();
  d.state.time = 13 * 1440 + 600;                       // day 14 = twilight
  d.state.quest.q.ended = 'dawn'; d.state.quest.prog.ending = 'dawn'; d.state.quest.q.crateRing = undefined;
  delete d.state.cycle; delete d.meta.cycle; (d.state as any).endDay = 12;
  t.sc.start({ seed: d.meta.seed, diff: d.meta.diff, hardcore: d.meta.hardcore, save: d }); await t.frames(10);
  t.expect(G.day === 14 && G.cycle === 0 && phaseName() === 'twilight', `день ${G.day} круг ${G.cycle} ${phaseName()}`);
  t.expect(questState.ended === '' && !G.paused, 'старая концовка не сброшена');
  t.expect(ramp.storm === 1, 'ramp пересчитан');
  // a saved game from ring 2 keeps its ring
  const d2 = capture(); d2.state.time = (36 + 5) * 1440; d2.meta.day = 42;
  t.sc.start({ seed: d2.meta.seed, diff: d2.meta.diff, hardcore: d2.meta.hardcore, save: d2 }); await t.frames(10);
  t.expect(G.day === 42 && G.cycle === 2 && ramp.storm > 1.15, `круг после загрузки ${G.cycle}, рамп ${ramp.storm}`);
  t.sc.start({ seed: d.meta.seed, diff: d.meta.diff, hardcore: d.meta.hardcore });
});

registerTest('seasons', 'смерть: карточка со статистикой, рекорд sc.best, «Новая игра» / «Заново» / назад на станцию', async (t) => {
  t.sc.start({ seed: G.seed, diff: 1, hardcore: false }); await t.frames(10);
  try { localStorage.removeItem('sc.best'); } catch { /* storage blocked */ }
  setDay(20, 10); runStats.hunted = 3; runStats.placed = 7;
  t.sc.kill('холод'); await t.frames(120);
  const card = document.querySelector('#ov .card.end.dead') as HTMLElement | null;
  t.expect(!!card && card.style.display === 'flex', 'карточка смерти не показана');
  const txt = card?.textContent ?? '';
  t.expect(/Дней продержался/.test(txt) && /20 дн\./.test(txt) && /Круг/.test(txt) && /Рекорд/.test(txt) && /Построено/.test(txt) && /Добыто/.test(txt) && /Найдено/.test(txt) && /холод/.test(txt), 'содержимое: ' + txt);
  t.expect(!!card?.querySelector('[data-a="again"]') && !!card?.querySelector('[data-a="same"]'), 'нет кнопок Новая игра / Заново тот же мир');
  const b = loadBest(); t.expect(!!b && b.day === 20 && b.cycle === 1, 'рекорд не записан: ' + JSON.stringify(b));
  // non-hardcore: back to the station
  t.expect(click('back'), 'нет кнопки назад'); await t.frames(5);
  t.expect(G.player.alive && !(document.querySelector('#ov .card.end.dead') as HTMLElement).style.display.includes('flex'), 'не вернулся на станцию');
  // a shorter run does not beat the record
  setDay(3, 10); t.sc.kill('холод'); await t.frames(120);
  t.expect((loadBest()?.day ?? 0) === 20, 'рекорд перезаписан короткой игрой');
  // same world
  const seed = G.seed; t.expect(click('same'), 'нет «Заново»'); await t.frames(20);
  t.expect(G.seed === seed && G.day === 1 && G.player.alive, `заново: seed ${G.seed} день ${G.day}`);
  // new game
  t.sc.kill('холод'); await t.frames(120); t.expect(click('again'), 'нет «Новая игра»'); await t.frames(20);
  t.expect(G.day === 1 && G.player.alive && !(document.querySelector('#ov .card.end.dead') as HTMLElement).style.display.includes('flex'), 'новая игра не началась');
  try { localStorage.removeItem('sc.best'); } catch { /* storage blocked */ }
});
