// Self-tests of the «simpler for a new player» pass: the first-minute screen shows only what matters (no wind or barometer rows, no season
// label before ring 2), the key hints stay behind the «?» chip (H and «?» show the full list), the tooltip has no digits, the objective line is
// short, and at most two toasts (three on desktop) are on screen. Each test restores what it changes.
import { registerTest } from '../game/selftest';
import { G, toast } from '../game/state';
import { emit } from '../game/bus';
import { sandbox, arena } from '../game/testkit';
import { setDay, wx, knowsForecast } from '../game/weather';
import { phaseName } from '../game/seasons';
import { GOALS, objectiveText, goalDetail, questState } from '../game/quest';
import { target } from '../game/tools';
import { resetHintsForTest } from './devhud';
import { inv } from '../game/inventory';

const noTags = (s: string) => s.replace(/<[^>]*>/g, '');
const shownKeys = () => [...document.querySelectorAll('#hud .hint .hmain kbd')].map(k => k.textContent);

registerTest('simplify', 'первая минута: без строки ветра, без барометра, дневная метка без круга', async t => {
  await sandbox(async () => {
    setDay(5, 10);                                                    // night, ring 1
    wx.override = { wind: 3, storm: 0, snowfall: 0 }; Object.assign(G, wx.override);
    t.sc.step(14); await t.wait(80);
    const wind = document.querySelector('#hud .dial .wind') as HTMLElement, baro = document.querySelector('#hud .dial .baro') as HTMLElement;
    const day = document.querySelector('#hud .dial .day') as HTMLElement;
    t.expect(getComputedStyle(wind).display === 'none', 'при слабом ветре строка ветра видна: ' + wind.textContent);
    if (knowsForecast()) t.log('барометр уже прочитан в этой игре: строка показана по правилу');
    else t.expect(getComputedStyle(baro).display === 'none', 'до чтения барометра строка показана: ' + baro.textContent);
    t.expect(day.textContent.replace(/ /g, ' ') === 'День 5', 'в первом круге ночью метка не «День 5»: ' + day.textContent);
    // at twilight the season word shows (the rule), but still no ring before ring 2
    setDay(14, 10); t.sc.step(14); await t.wait(80);
    const twi = phaseName() !== 'night';
    t.expect(!twi || /Сумерки/.test(day.textContent) && !/круг/.test(day.textContent), 'в сумерках: ' + day.textContent);
    // a strong wind (12 m/s) brings its row back, with a word and no number
    wx.override = { wind: 14, storm: 0, snowfall: 0 }; Object.assign(G, wx.override);
    t.sc.step(14); await t.wait(80);
    t.expect(getComputedStyle(wind).display !== 'none' && /Ветер усилился/.test(wind.textContent ?? '') && !/\d/.test(wind.textContent ?? ''), 'сильный ветер: ' + wind.textContent);
    wx.override = null;
  });
});

registerTest('simplify', 'подсказки: внизу экрана только «?»; голод, первая вещь и первая цель не добавляют строку клавиш', async t => {
  if (G.mobile) { t.log('телефон: строки клавиш нет'); return; }
  const sc = t.sc; resetHintsForTest(); sc.step(12); await t.wait(80);
  t.expect(shownKeys().length === 0, 'в строке внизу есть клавиши: ' + shownKeys().join(' '));
  const food0 = G.player.food;
  G.player.food = 20; sc.step(12); await t.wait(80);                  // first hunger
  G.player.food = food0;
  emit('picked', { item: 'log', n: 1 }); sc.step(12); await t.wait(80);   // the first thing in the bag
  emit('goal_done', { id: 'coal' }); sc.step(12); await t.wait(80);      // the first goal
  t.expect(shownKeys().length === 0, 'после событий в строке появились клавиши: ' + shownKeys().join(' '));
  resetHintsForTest();
});

registerTest('simplify', '«?» и клавиша H открывают полный список, второе нажатие закрывает его', async t => {
  if (G.mobile) { t.log('телефон: подсказок с клавишами нет'); return; }
  const sc = t.sc; resetHintsForTest(); sc.step(12); await t.wait(60);
  const full = document.querySelector('#hud .hfull') as HTMLElement;
  const open = () => getComputedStyle(full).display !== 'none';
  const btn = () => document.querySelector('#hud .hint .q') as HTMLElement | null;      // the button is re-rendered on every change: query it again
  t.expect(!!btn() && btn()!.textContent === '?', 'нет кнопки «?»');
  t.expect(!open(), 'полный список открыт в начале');
  btn()?.click(); sc.step(12); await t.wait(60);
  t.expect(open(), '«?» не открыл полный список');
  const all = full.textContent ?? '';
  for (const k of ['V', 'R', 'G', 'Q', 'X', 'Shift', '1–6', 'H', 'P', 'J', 'Ctrl', 'ПКМ']) t.expect(all.includes(k), 'в полном списке нет «' + k + '»');
  btn()?.click(); sc.step(12); await t.wait(60);
  t.expect(!open(), '«?» не закрыл список');
  sc.key('KeyH', true); sc.step(3); sc.key('KeyH', false); sc.step(12); await t.wait(60);
  t.expect(open(), 'H не открыл список');
  sc.key('KeyH', true); sc.step(3); sc.key('KeyH', false); sc.step(12); await t.wait(60);
  t.expect(!open(), 'H не закрыл список');
  resetHintsForTest();
});

registerTest('simplify', 'подсказка под курсором без цифр: снег с плотностью словом, нож, блок в воздухе', async t => {
  const bag = inv.slots.map(x => (x ? { ...x } : x)), sel = inv.sel;      // the probe items go into the bag: put it back afterwards
  await sandbox(() => {
    const s = t.sc;
    setDay(3, 12);
    wx.override = { ambientT: -30, wind: 0, storm: 0, snowfall: 0 }; Object.assign(G, wx.override);
    arena(1000, 272, { dens: 300, loose: 0, depth: 40, up: 70 });
    s.teleport(1000, 272); s.give('snow_knife', 1); s.give('shovel', 1); s.give('snow_block', 3); s.step(4);
    const probe = (item: string, x: number, y: number) => {
      s.selectItem(item); s.render(0); s.aim(x, y); s.step(3);
      const T = target(), text = noTags(T.lines.join(' | '));
      return { text, ok: T.lines.length > 0 && !/\d/.test(text) };
    };
    const snow = probe('shovel', 1006, 274);
    t.expect(snow.ok && /хороший|рыхлый|плотный/.test(snow.text), 'снег: ' + snow.text);
    const knife = probe('snow_knife', 1006, 274);
    t.expect(knife.ok && /Режь блок|Рассыпется|Нужен плотный наст/.test(knife.text), 'нож на насте: ' + knife.text);
    const block = probe('snow_block', 1010, 262);
    t.expect(block.ok, 'блок в воздухе: ' + block.text);
    const reason = target().reason ?? '';
    t.expect(!reason || reason.split(' ').length <= 4, 'причина отказа длинная: ' + reason);
  });
  inv.slots.splice(0, inv.slots.length, ...bag); inv.sel = sel;
});

registerTest('simplify', 'цель: строка на экране до 60 знаков, у каждой цели есть подробность для журнала', async t => {
  await sandbox(() => {
    const worst = GOALS.reduce((m, g) => (g.text().length > m.len ? { len: g.text().length, text: g.text() } : m), { len: 0, text: '' });
    t.expect(worst.len <= 60, 'самая длинная цель: ' + worst.text);
    const keep = { ...questState }, time = G.time;
    questState.icebreakerAt = G.time + 2 * 1440;                       // the icebreaker's wait adds its time in front
    const wait = objectiveText();
    Object.assign(questState, keep); G.time = time;
    t.expect(wait.length <= 60, 'строка с ожиданием ледокола: ' + wait);
    for (const g of GOALS) if (!g.done()) t.expect(goalDetail(g.id).length > 0, 'у цели «' + g.id + '» нет подробности');
    // the rotating «next sensible thing» line over a day, in several states
    const seen = new Set<string>();
    for (let k = 0; k < 24; k++) { G.time += 240; seen.add(objectiveText()); }
    G.time = time;
    for (const l of seen) t.expect(l.length <= 60, 'вращающаяся строка длинная: ' + l);
  });
});

registerTest('simplify', 'тосты: на экране не больше двух, предупреждение и награда важнее обычного текста', async t => {
  G.toasts.length = 0;
  toast('Сказка номер один', 'info'); toast('Опасно: лёд!', 'bad'); toast('Сказка два', 'info'); toast('Сказка три', 'info'); toast('Сделано!', 'good');
  t.sc.step(14); await t.wait(80);
  const shown = [...document.querySelectorAll('#hud .toast')].map(e => e.textContent ?? '');
  const touch = document.body.classList.contains('touch-ui');
  t.expect(shown.length === (touch ? 2 : 3), 'тостов на экране: ' + shown.length + ' (' + shown.join(' | ') + ')');
  t.expect(shown.includes('Опасно: лёд!'), 'предупреждение вытеснено: ' + shown.join(' | '));
  G.toasts.length = 0; t.sc.step(6);
});
