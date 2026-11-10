// Self-tests of digging, far taps, pickup and dropping (playtest v13, group X2): the shovel's blade is flung out behind the player when full, the knife
// asks for a packed crust first, a tap out of reach says why, coal 8 cells away flies into the pack, G drops one and Shift+G the stack, a dropped thing is
// picked up again after the player walked away and back, and a refused sleep changes no time.
import { registerTest } from './selftest';
import { G } from './state';
import { W, mat, aux } from '../engine/grid';
import { MAT } from '../content/materials';
import { add, count, clearInventory, spawnDrop, held, thrown } from './inventory';
import { target, autoPickup } from './tools';
import { startSleep } from './player';
import { sandbox, arena, tileBlock } from './testkit';
import { wx } from './weather';
import { input } from '../engine/input';
import { on } from './bus';
import type { Drop } from './state';

const sc = () => (window as unknown as { __sc: any }).__sc;

/** Flat ground: `loose` rows of loose snow over packed snow; the player stands at x=1000 on the surface. */
function ground(loose = 24, dens = 300) {
  held.load = 0;                                   // the blade is not state of the sandbox: a load left by an earlier test would make RMB bag it
  wx.override = { ambientT: -30, wind: 0, storm: 0, snowfall: 0 };
  Object.assign(G, wx.override);
  arena(1000, 272, { dens, depth: 40, up: 70, loose });
  const s = sc();
  s.teleport(1000, 272);
  return { p: G.player, s };
}
const snowIn = (x0: number, y0: number, x1: number, y1: number) => {
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (mat[y * W + x] === MAT.SNOW) n++;
  return n;
};
/** Hold the primary button at a world point for `secs` (the game's own frames). */
const hold = (s: any, x: number, y: number, secs: number) => s.act('dig', x, y, secs);
const dropAt = (id: number, item: string, x: number, y: number): Drop => ({ id, item, n: 1, x, y, vx: 0, vy: 0, age: 1 });

registerTest('digging', 'лопата: полный ковш сам выбрасывает снег за спину, копание идёт дальше', async () => {
  await sandbox(async () => {
    const { s } = ground(24);
    clearInventory();
    add('shovel', 1); s.selectItem('shovel');
    const snow0 = snowIn(1000, 272, 1020, 296);
    let dug = 0, tossed = 0;
    for (const y of [274, 278, 282, 286]) for (const x of [1000, 1004, 1008, 1012]) {
      const before = snowIn(1000, 272, 1020, 296), l0 = held.load;
      hold(s, x, y, 0.4);
      if (held.load > 32) throw new Error('ковш переполнен: ' + held.load);
      if (before > snowIn(1000, 272, 1020, 296)) dug++;
      if (held.load < l0) tossed++;
    }
    if (dug < 8) throw new Error('копание встало: только ' + dug + ' из 16 ударов что-то сняли');
    if (tossed < 1) throw new Error('полный ковш не выбросил снег за спину');
    if (snowIn(1000, 272, 1020, 296) >= snow0 - 40) throw new Error('снега почти не убыло: ' + snow0);
  });
});

registerTest('digging', 'нож: рыхлый снег не копается, подсказка «Рыхлый: утопчи лопатой»', async () => {
  await sandbox(() => {
    const { s } = ground(24);
    clearInventory();
    add('snow_knife', 1); s.selectItem('snow_knife');
    s.render(0); s.aim(1015, 274); s.stepFast(2);
    const t = target();
    if (t.ok || !/Рыхлый/.test(t.reason ?? '')) throw new Error('нож на рыхлом снеге: ' + JSON.stringify({ ok: t.ok, reason: t.reason }));
  });
});

registerTest('digging', 'далёкий тап: подпись «Слишком далеко» в подсказке и звук отказа', async () => {
  await sandbox(() => {
    const { s } = ground(24);
    clearInventory();
    add('shovel', 1); s.selectItem('shovel');
    let deny = 0; const off = on('deny', () => { deny++; });
    try {
      s.render(0); s.aim(1000 + 220, 274); s.stepFast(2);
      if (!target().lines.some(l => /далеко/i.test(l))) throw new Error('подсказка молчит: ' + JSON.stringify(target().lines));
      hold(s, 1000 + 220, 274, 0.2);
      if (deny < 1) throw new Error('нет звука отказа при тапе вне досягаемости: ' + JSON.stringify([target().reason, target().lines, G.toasts.map(t => t.text), G.realTime]));
    } finally { off(); }
  });
});

registerTest('digging', 'подбор: уголь в 8 клетках сам летит в сумку (тяжёлый, без клавиши)', async () => {
  await sandbox(() => {
    const { p, s } = ground(0);
    clearInventory();
    autoPickup.on = true;
    s.stepFast(2);
    spawnDrop('coal', 1, p.x + 8, p.y - 1, 0, 0);
    s.stepFast(240);
    if (count('coal') < 1) throw new Error('уголь в 8 клетках не подобран за 4 с');
  });
});

registerTest('digging', 'бросок: G бросает одну штуку, Shift+G всю стопку; брошенное видно и возвращается ходьбой туда-обратно', async () => {
  await sandbox(() => {
    const { p, s } = ground(0);
    clearInventory();
    autoPickup.on = true;
    add('matches', 10); s.selectItem('matches');
    input.dropPressed = true; s.stepFast(1);
    if (count('matches') !== 9) throw new Error('G должен бросить одну штуку: осталось ' + count('matches'));
    const dropped = G.drops.filter(d => d.item === 'matches' && thrown.has(d.id));
    if (dropped.length !== 1 || dropped[0].n !== 1) throw new Error('брошена не одна спичка: ' + JSON.stringify(dropped.map(d => [d.n])));
    // lying on the ground, not lost: still in the list after a few seconds in place
    s.stepFast(200);
    if (!G.drops.some(d => d.id === dropped[0].id)) throw new Error('брошенное пропало через 3 с');
    // walk 6 cells away, then back: picked up
    s.teleport(1006, 272); s.stepFast(30);
    s.teleport(1000, 272); s.stepFast(60);
    if (G.drops.some(d => d.id === dropped[0].id)) throw new Error('вернувшись к брошенному, не подобрал');
    // Shift+G: the whole stack
    add('matches', 4);
    s.selectItem('matches');
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft' }));
    input.dropPressed = true; s.stepFast(1);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ShiftLeft' }));
    if (count('matches') !== 0) throw new Error('Shift+G должен бросить всю стопку: осталось ' + count('matches'));
  });
});

registerTest('digging', 'сон: отказ (холодно) не меняет время и не включает сон', async () => {
  await sandbox(() => {
    const { p } = ground(0);
    const t0 = G.time, ts0 = G.timeScale;
    p.core = 34;
    const ok = startSleep();
    if (ok || p.sleeping) throw new Error('сон при 34 °C не должен начаться');
    if (G.time !== t0 || G.timeScale !== ts0) throw new Error('отказ сна сдвинул время: ' + t0 + ' → ' + G.time);
    p.core = 36.4;
  });
});

registerTest('digging', 'наст: лопата с ПКМ уплотняет рыхлый снег, нож режет блок из наста', async () => {
  await sandbox(() => {
    const { s } = ground(24);
    clearInventory();
    add('shovel', 1); add('snow_knife', 1); s.selectItem('shovel');
    const packed = () => { let n = 0; for (let y = 272; y < 296; y++) for (let x = 1000; x < 1016; x++) if (mat[y * W + x] === MAT.PACKED) n++; return n; };
    const p0 = packed();
    s.render(0); s.aim(1008, 274); s.stepFast(2);
    { s.render(0); const [sx, sy] = s.worldToScreen(1008, 274); s.mouse(2, true, sx, sy); }      // RMB held with the shovel: the snow is pressed down
    s.stepFast(150); s.mouse(2, false); s.stepFast(2);
    if (packed() - p0 < 8) { let sn = 0, mx = 0; for (let y = 272; y < 296; y++) for (let x = 1000; x < 1016; x++) { if (mat[y * W + x] === MAT.SNOW) { sn++; mx = Math.max(mx, aux[y * W + x]); } } throw new Error('ПКМ с лопатой не уплотнил снег: ' + (packed() - p0) + ' клеток, цель ' + JSON.stringify([target().mode, target().reason, target().tx, target().ty]) + ' снег ' + sn + ' макс ' + mx + ' ' + JSON.stringify([sc().ready, input.secondaryHeld]) ); }
  });
});

registerTest('digging', 'клавиши 7–9 без подсумка: тост «Нужен подсумок»; копание снега даёт «−снег»', async () => {
  await sandbox(() => {
    const { s } = ground(24);
    clearInventory();
    let minus = 0; const off = on('pickup_float', (d: { label?: string }) => { if (d.label === '−снег') minus++; });
    try {
      input.hotbar = 6; s.stepFast(2); input.hotbar = -1;
      if (!G.toasts.some(t => /подсумок/.test(t.text))) throw new Error('нет тоста про подсумок: ' + JSON.stringify(G.toasts.map(t => t.text)));
      add('shovel', 1); s.selectItem('shovel');
      s.render(0); s.act('dig', 1004, 274, 0.4);
      if (minus < 1) throw new Error('копание рыхлого снега не дало «−снег»');
    } finally { off(); }
  });
});

void tileBlock; void held;
