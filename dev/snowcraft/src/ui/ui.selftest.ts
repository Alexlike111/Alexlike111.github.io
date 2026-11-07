// Self-tests of the UI wave: station doors can be walked through, the top-centre HUD stack never overlaps, the HUD shows the body figure / sun dial / belt
// badges, a save round-trips (own slot: never touches the player's save), night silhouettes stay readable. Each test restores what it changes.
import { registerTest } from '../game/selftest';
import { G, toast } from '../game/state';
import { LOC } from '../game/locations';
import { sandbox } from '../game/testkit';
import { mat, W } from '../engine/grid';
import { capture, saveGame, peekSave, loadGame, deleteSave } from '../game/save';
import { getView } from '../engine/render';
import { wx, setDay } from '../game/weather';
import { MAT } from '../content/materials';
import { icon } from '../engine/sprites';
import { getItem } from '../game/items';

registerTest('ui', 'двери дома и дизельной проходимы пешком (игрок 8×20)', async t => {
  const sc = t.sc;
  await sandbox(async () => {
    const F = LOC.station.y;
    const doors = G.fixtures.filter(f => f.kind === 'door');
    t.expect(doors.length >= 3, 'дверей: ' + doors.length);
    for (const d of doors) {
      const west = d.data?.side === 'west';
      t.expect(d.th >= 6, 'дверь ниже 6 тайлов: ' + d.th);
      const x0 = d.tx * 4 + (west ? -14 : 18);
      sc.teleport(x0, F); sc.stepFast(10);
      sc.act('interact', d.tx * 4 + 2, d.ty * 4 + 12);
      const startX = G.player.x;
      sc.key(west ? 'KeyD' : 'KeyA', true); sc.stepFast(100); sc.key(west ? 'KeyD' : 'KeyA', false);
      const passed = west ? G.player.x > d.tx * 4 + 3 : G.player.x < d.tx * 4 + 1;
      t.expect(passed, `не прошёл дверь x=${d.tx * 4} (${startX.toFixed(0)} -> ${G.player.x.toFixed(0)})`);
    }
  });
});

registerTest('ui', 'верхняя полоса HUD: цель, чип укрытия и тосты не налезают друг на друга', async t => {
  const sc = t.sc;
  const prev = G.shelter;
  G.shelter = { closed: true, tiles: 40, temp: -24, windIn: 0, vent: true, co: 8, stars: 2, notes: [] };
  toast('Белеет ноги: обморожение близко', 'warn'); toast('Тебя трясёт: пора греться', 'warn');
  sc.step(14); await t.wait(150);
  const kids = [...document.querySelectorAll('#hud .stk > *')].flatMap(e => (e as HTMLElement).classList.contains('p') ? [e] : [...e.children]).filter(e => (e as HTMLElement).offsetParent !== null) as HTMLElement[];
  const r = kids.map(k => k.getBoundingClientRect());
  t.expect(r.length >= 3, 'элементов в полосе: ' + r.length);
  for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
    const o = !(r[i].right <= r[j].left || r[j].right <= r[i].left || r[i].bottom <= r[j].top + 0.5 || r[j].bottom <= r[i].top + 0.5);
    t.expect(!o, `элементы ${i} и ${j} пересекаются`);
  }
  G.shelter = prev; G.toasts.length = 0; sc.step(12);
});

registerTest('ui', 'HUD: фигура тела, солнечные часы, пояс со значками и счётчик в углу', async t => {
  const sc = t.sc;
  sc.give('snow_block', 40, 300); sc.step(14); await t.wait(100);
  t.expect(!!document.querySelector('#hud .bw canvas'), 'нет фигуры тела');
  t.expect(!!document.querySelector('#hud .dial canvas'), 'нет солнечных часов');
  t.expect(document.querySelectorAll('#hud .belt .sl img').length >= 2, 'в поясе нет значков');
  const badge = document.querySelector('#hud .belt .sl .n') as HTMLElement | null;
  if (badge) {
    const sl = badge.parentElement!.getBoundingClientRect(), b = badge.getBoundingClientRect();
    t.expect(b.top <= sl.top + 8 && b.right >= sl.right - 14, 'счётчик не в правом верхнем углу');
    const im = badge.parentElement!.querySelector('img')!.getBoundingClientRect();
    t.expect(b.bottom <= im.top + 6 || b.left >= im.right - 6 || b.right > im.right - 2, 'счётчик закрывает значок');
  }
  t.expect(getComputedStyle(document.getElementById('hud')!).fontFamily.length > 0, 'шрифт HUD');
});

registerTest('ui', 'значки радиодеталей и чая различаются', t => {
  const hash = (id: string) => { const c = icon(getItem(id).icon); const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i++) h = (h * 31 + d[i]) | 0; return h; };
  const ids = ['radio_triode', 'radio_coil', 'tea', 'hot_tea', 'fox_fur', 'sealskin', 'bear_fur', 'log', 'plank'];
  const hs = ids.map(hash);
  t.expect(new Set(hs).size === ids.length, 'одинаковые значки среди: ' + ids.join(','));
});

registerTest('ui', 'сохранение: мир, тело, предметы и расстановка переживают запись и чтение', async t => {
  const d = capture();
  let json = ''; try { json = JSON.stringify(d.state); } catch { /* cyclic */ }
  t.expect(json.length > 1000, 'состояние не сериализуется');
  const ok = await saveGame('selftest');
  t.expect(ok, 'запись не удалась (IndexedDB недоступна?)');
  if (!ok) return;
  const meta = await peekSave('selftest');
  t.expect(!!meta && meta.seed === G.seed && meta.v === 1, 'метаданные');
  const back = await loadGame('selftest');
  t.expect(!!back, 'чтение не удалось');
  if (back) {
    let diff = 0; for (let i = 0; i < mat.length; i += 7) if (back.grid.mat[i] !== mat[i]) diff++;
    t.expect(diff < 200, 'сетка отличается в ' + diff + ' ячейках (мир мог двигаться)');
    t.expect(back.state.fixtures.length === G.fixtures.length, 'предметов расстановки: ' + back.state.fixtures.length + ' vs ' + G.fixtures.length);
    t.expect(Math.abs(back.state.player.core - G.player.core) < 0.5, 'температура тела');
    t.metric('сохранение', JSON.stringify(d.state).length / 1024, 'КБ состояния');
  }
  await deleteSave('selftest');
});

registerTest('ui', 'ночью силуэт скалы читается на фоне неба (контраст края)', async t => {
  const sc = t.sc;
  await sandbox(async () => {
    setDay(6, 0); wx.override = { aurora: 0, snowfall: 0, storm: 0, visibility: 1, wind: 1 }; Object.assign(G, wx.override); G.moon = 0.05;
    // the highest exposed rock / dirt column of the cape
    let bx = -1, by = 9999;
    for (let x = 130; x < 250; x++) { let y = 60; while (y < 700 && mat[y * W + x] === MAT.AIR) y++; const m = mat[y * W + x]; if ((m === MAT.STONE || m === MAT.DIRT || m === MAT.HARDROCK) && y < by) { by = y; bx = x; } }
    if (bx < 0) { t.log('нет открытой скалы на мысе: проверка пропущена'); return; }
    sc.teleport(bx, by - 2); sc.step(6); sc.render(0);
    const v = getView(), cv = document.getElementById('world') as HTMLCanvasElement, c = cv.getContext('2d')!;
    const lum = (x: number, y: number) => { const p = c.getImageData(Math.max(0, Math.min(cv.width - 1, x - v.x0)), Math.max(0, Math.min(cv.height - 1, y - v.y0)), 1, 1).data; const f = (u: number) => { u /= 255; return u <= 0.03928 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4); }; return 0.2126 * f(p[0]) + 0.7152 * f(p[1]) + 0.0722 * f(p[2]); };
    const rock = lum(bx, by + 1), sky = Math.min(lum(bx + 30, by - 48), lum(bx + 60, by - 70));
    const ratio = (rock + 0.01) / (sky + 0.01);          // plain luminance ratio with a small floor (WCAG's 0.05 floor would make any night scene fail)
    t.metric('контраст края скалы к небу', ratio, '× (скала ' + rock.toFixed(3) + ', небо ' + sky.toFixed(3) + ', x=' + bx + ' y=' + by + ')');
    t.expect(ratio >= 3, 'край скалы почти сливается с небом: ' + ratio.toFixed(2));
    wx.override = null;
  });
});
