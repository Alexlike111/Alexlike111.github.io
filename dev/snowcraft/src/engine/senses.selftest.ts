// Self-tests of «Чутьё» + the UI wave: the overlay toggles without errors and draws every layer, snow classes colour the way the legend says, the HUD boxes
// do not overlap (measured from DOM rects) on this viewport, buttons are big enough, fonts are applied (Jura for HUD, Pixelify only for the big title),
// the desktop belt wheel selects a slot, station windows glow when the stove burns.
import { registerTest } from '../game/selftest';
import { G, toast } from '../game/state';
import { sandbox } from '../game/testkit';
import { input } from './input';
import { senses, toggleSenses, setSensesLayer, drawn, snowRamp, heatRamp, GOOD_LO, GOOD_HI, LAYERS, type SensesLayer } from './senses';
import { windowGlow } from './windows';
import { mat, aux, setCell } from './grid';
import { MAT } from '../content/materials';
import { wx } from '../game/weather';
import { select, inv } from '../game/inventory';
import { LOC } from '../game/locations';
import { getView } from './render';

/** Render n frames of 0.1 s each (sc.step renders once per call, the overlay eases / spawns per rendered frame). */
const settle = (sc: any, n = 12) => { for (let i = 0; i < n; i++) sc.render(0.1); };
const px = (c: CanvasRenderingContext2D, x: number, y: number) => c.getImageData(x, y, 1, 1).data;
function canvasDiff(sc: any, fn: () => void): number {
  const cv = document.getElementById('world') as HTMLCanvasElement, c = cv.getContext('2d')!;
  sc.render(0); const a = c.getImageData(0, 0, cv.width, cv.height).data.slice();
  fn(); sc.render(0); const b = c.getImageData(0, 0, cv.width, cv.height).data;
  let d = 0; for (let i = 0; i < a.length; i += 16) d += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return d;
}

registerTest('senses', 'Чутьё: включается и выключается (кнопкой, клавишей X) без ошибок', async t => {
  const sc = t.sc;
  toggleSenses(false); settle(sc);
  t.expect(senses.k < 0.02 && !senses.on, 'должно быть выключено в начале');
  input.sensesPressed = true; await t.wait(250);                         // the real loop consumes the one-shot (the key X path)
  t.expect(senses.on, 'X не включило чутьё');
  t.expect(!input.sensesPressed, 'флаг нажатия не сброшен');
  settle(sc);
  t.expect(senses.k > 0.95, 'затемнение не набралось: ' + senses.k.toFixed(2));
  t.expect(document.body.classList.contains('senses-on'), 'нет класса senses-on');
  const leg = document.querySelector('#hud .sn-leg') as HTMLElement | null;
  t.expect(!!leg && getComputedStyle(leg).display !== 'none', 'легенда не показана');
  input.sensesPressed = true; await t.wait(250);
  settle(sc);
  t.expect(!senses.on && senses.k < 0.02, 'X не выключило чутьё');
  t.expect(!leg || getComputedStyle(leg).display === 'none', 'легенда осталась после выключения');
  toggleSenses(false);
});

registerTest('senses', 'Чутьё: каждый слой рисует (снег, тепло, сквозняк, запах)', async t => {
  const sc = t.sc;
  await sandbox(async () => {
    sc.setWeather({ ambientT: -24, wind: 6, storm: 0, snowfall: 0 });
    sc.arena(1000, 272, { dens: 310, loose: 0, depth: 30, up: 60, halfW: 90 });
    for (let x = 930; x < 960; x++) for (let y = 272; y < 290; y++) setCell(x, y, MAT.PACKED, 50);       // loose patch
    sc.teleport(1000, 272); sc.stepFast(240);
    toggleSenses(true); settle(sc);
    for (const l of LAYERS) setSensesLayer(l as SensesLayer, true);
    for (const only of LAYERS) {
      for (const l of LAYERS) setSensesLayer(l as SensesLayer, l === only);
      settle(sc, 14);
      const d = canvasDiff(sc, () => { setSensesLayer(only, false); settle(sc, 1); });
      setSensesLayer(only, true); settle(sc, 2);
      t.expect(d > 800, `слой «${only}» ничего не нарисовал (разница ${d})`);
    }
    for (const l of LAYERS) setSensesLayer(l as SensesLayer, true);
    settle(sc, 30);
    t.expect(drawn.snow > 500, 'снега в кадре: ' + drawn.snow);
    t.expect(drawn.heat > 500, 'плиток тепла: ' + drawn.heat);
    t.expect(drawn.wind > 0, 'штрихов сквозняка: ' + drawn.wind);
    t.expect(drawn.scent > 0, 'точек запаха: ' + drawn.scent);
    t.metric('штрихов сквозняка', drawn.wind); t.metric('точек запаха', drawn.scent); t.metric('слой чутья', drawn.ms, ' мс/кадр (JS, без GPU)');
    toggleSenses(false); settle(sc);
  });
}, 90000);

registerTest('senses', 'Чутьё: классы снега окрашены как в легенде (рыхлый / для блоков / плотный)', t => {
  const loose = snowRamp(GOOD_LO - 80), good = snowRamp((GOOD_LO + GOOD_HI) / 2), dense = snowRamp(GOOD_HI + 80);
  t.expect(good[1] > loose[1] + 60 && good[1] > dense[1] + 25, 'полоса «для блоков» не выделяется яркой зелёно-мятной');
  t.expect(dense[0] > good[0] + 40 && dense[2] > 230, 'плотный снег не лавандовый');
  t.expect(loose[2] > loose[1] && loose[2] > loose[0] && loose[1] < 160, 'рыхлый снег не тусклый синий');
  const cold = heatRamp(-30), warm = heatRamp(12);
  t.expect(cold[2] > cold[0] + 80 && warm[0] > warm[2] + 80, 'шкала тепла: холод синий, тепло янтарное');
  t.expect(snowRamp(GOOD_LO)[1] > 220 && snowRamp(GOOD_LO - 12)[1] < 160, 'граница полосы для блоков размыта');
});

registerTest('senses', 'Чутьё: запах уходит по ветру и упирается в стены', async t => {
  const sc = t.sc;
  const { _stepScentForTest } = await import('./senses');
  await sandbox(async () => {
    sc.setWeather({ ambientT: -20, wind: 6, storm: 0, snowfall: 0 });
    sc.arena(1000, 272, { dens: 300, loose: 0, depth: 30, up: 60, halfW: 90 });
    sc.teleport(1000, 272); sc.stepFast(60); sc.render(0);
    const v = getView();
    toggleSenses(true); settle(sc, 3);
    const n = _stepScentForTest(6, v);
    t.expect(n > 10, 'частиц запаха: ' + n);
    toggleSenses(false); settle(sc);
    void mat; void aux;
  });
});

registerTest('ui', 'Чутьё/HUD: блоки HUD не пересекаются на этом экране, кнопки не меньше 48 px', async t => {
  const sc = t.sc;
  const prev = G.shelter;
  G.shelter = { closed: true, tiles: 40, temp: -12, windIn: 0.5, vent: true, co: 8, stars: 2, notes: [] };
  toast('Белеет ноги: обморожение близко', 'warn');
  toggleSenses(true); settle(sc); await t.wait(200);
  const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); const cs = getComputedStyle(e as HTMLElement); return r.width > 1 && r.height > 1 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  const names: [string, string][] = [['#hud .bw', 'тело'], ['#hud .dial', 'часы'], ['#hud .stk > .obj', 'цель'], ['#hud .stk > .chip', 'укрытие'], ['#hud .stk > .sn-leg', 'легенда'], ['#hud .stk > div:last-child > .toast', 'тост'], ['#hud .belt', 'пояс'], ['#hud .bname', 'имя']];
  const touch = document.body.classList.contains('touch-ui');
  if (touch) for (const b of document.querySelectorAll('#touch .tb')) names.push(['#' + (b as HTMLElement).id, 'кнопка ' + (b as HTMLElement).textContent]);
  else names.push(['#hud .hint', 'подсказки']);
  const boxes: { n: string; r: DOMRect }[] = [];
  for (const [sel, n] of names) for (const e of document.querySelectorAll(sel)) if (vis(e)) boxes.push({ n, r: (e as HTMLElement).getBoundingClientRect() });
  t.expect(boxes.length >= 5, 'найдено блоков: ' + boxes.length);
  const W = innerWidth, H = innerHeight;
  for (const b of boxes) t.expect(b.r.left >= -1 && b.r.top >= -1 && b.r.right <= W + 1 && b.r.bottom <= H + 1, `«${b.n}» выходит за экран (${b.r.left | 0},${b.r.top | 0},${b.r.right | 0},${b.r.bottom | 0})`);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i].r, b = boxes[j].r;
    const o = !(a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5);
    t.expect(!o, `«${boxes[i].n}» и «${boxes[j].n}» пересекаются`);
  }
  if (touch) for (const b of document.querySelectorAll('#touch .tb')) { const r = (b as HTMLElement).getBoundingClientRect(); t.expect(r.width >= 48 && r.height >= 48, `кнопка «${(b as HTMLElement).textContent}» меньше 48 px (${r.width | 0}×${r.height | 0})`); }
  // the centre of the screen around the player stays free of HUD boxes
  const cx = W / 2, cy = H / 2, hw = 50;                       // the player's body and head (the camera keeps the player at the centre)
  for (const b of boxes) { if (b.n === 'пояс' || b.n === 'имя') continue; const a = b.r; const o = !(a.right <= cx - hw || a.left >= cx + hw || a.bottom <= cy - 45 || a.top >= cy + 45); t.expect(!o, `«${b.n}» закрывает центр экрана вокруг игрока`); }
  toggleSenses(false); G.shelter = prev; G.toasts.length = 0; settle(sc);
});

registerTest('ui', 'шрифты: Jura в HUD и кнопках, Pixelify Sans только в больших заголовках', async t => {
  await Promise.all([document.fonts.load("600 14px 'Jura'", 'з5б6'), document.fonts.load("600 40px 'Pixelify Sans'", 'SNOWCRAFT')]);
  const fam = (sel: string) => { const e = document.querySelector(sel) as HTMLElement | null; return e ? getComputedStyle(e).fontFamily : ''; };
  for (const sel of ['#hud .bw .r', '#hud .dial .day', '#hud .belt .sl .k', '#hud .obj', '#hud .hint']) { const f = fam(sel); if (f) t.expect(/Jura/.test(f) && !/^"?Pixelify/.test(f), `${sel}: ${f}`); }
  const tb = document.querySelector('#touch .tb'); if (tb) t.expect(/Jura/.test(getComputedStyle(tb).fontFamily), 'кнопки касания не на Jura');
  t.expect(document.fonts.check("600 14px 'Jura'", 'з5б6'), 'Jura не загружена');
  t.expect(document.fonts.check("600 40px 'Pixelify Sans'", 'SNOWCRAFT'), 'Pixelify Sans не загружен');
  const tn = getComputedStyle(document.querySelector('#hud .bw .v') ?? document.body).fontVariantNumeric;
  t.expect(/tabular/.test(tn), 'цифры не табличные: ' + tn);
});

registerTest('ui', 'колесо пояса на Q: наведение выбирает слот, отпускание применяет', async t => {
  const w = (window as unknown as { __wheel?: { open(): void; close(a: boolean): void; aim(x: number, y: number): void } }).__wheel;
  t.expect(!!w, 'нет колеса');
  if (!w) return;
  const wasTouch = document.body.classList.contains('touch-ui');
  if (wasTouch) document.body.classList.remove('touch-ui');
  const keep = inv.sel; select(0);
  w.open();
  const el = document.getElementById('wheel')!;
  t.expect(el.classList.contains('open'), 'колесо не открылось');
  const slots = [...el.querySelectorAll('.slot')] as HTMLElement[];
  t.expect(slots.length === 6, 'слотов: ' + slots.length);
  const r = slots[2].getBoundingClientRect();
  w.aim(r.left + r.width / 2, r.top + r.height / 2);
  w.close(true);
  t.expect(inv.sel === 2, 'выбран слот ' + inv.sel + ', ждали 3-й');
  t.expect(!el.classList.contains('open'), 'колесо не закрылось');
  select(keep);
  if (wasTouch) document.body.classList.add('touch-ui');
});

registerTest('ui', 'окна станции светятся тёплым, когда горит печь', async t => {
  const sc = t.sc;
  await sandbox(async () => {
    const stove = G.fixtures.find(f => f.kind === 'stove'); t.expect(!!stove, 'нет печи');
    if (!stove) return;
    const x = (LOC.house.L + 10) * 4, y = LOC.station.y;
    wx.override = { aurora: 0, snowfall: 0, storm: 0, visibility: 1, wind: 0 }; Object.assign(G, wx.override); sc.setTime(60);
    sc.teleport(x, y); stove.lit = false; stove.fuel = 0; sc.step(80); settle(sc, 16);
    const off = canvasDiff(sc, () => { stove.lit = true; stove.fuel = 600; settle(sc, 16); });
    t.expect(windowGlow.count >= 1, 'окон у печи: ' + windowGlow.count);
    t.expect(off > 300, 'свечение окон не видно (разница ' + off + ')');
    stove.lit = false; stove.fuel = 0; wx.override = null;
  });
}, 60000);
void px;
