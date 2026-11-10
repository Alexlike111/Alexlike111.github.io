// Self-tests of digging, far taps, pickup and dropping (playtest v13, group X2): the shovel's blade is flung out behind the player when full, the knife
// asks for a packed crust first, a tap out of reach says why, coal 8 cells away flies into the pack, G drops one and Shift+G the stack, a dropped thing is
// picked up again after the player walked away and back, and a refused sleep changes no time.
import { registerTest } from './selftest';
import { G } from './state';
import { W, mat } from '../engine/grid';
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
    if (t.ok || !/Рыхлый/.test(t.reason ?? '')) throw new Error('нож на рыхлом снеге: ' + JSON.stringify({ ok: t.ok, reason: t.reason, p: [G.player.x, G.player.y], tg: [t.tx, t.ty, t.x, t.y, t.inReach, t.mode] }));
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
    const dd = G.drops.find(q => q.id === dropped[0].id)!;
    s.teleport(p.x + 6, 272); s.stepFast(30);
    if (G.drops.some(q => q.id === dropped[0].id)) { const q = G.drops.find(q => q.id === dropped[0].id)!; if (!(q.x > 0)) throw new Error('x'); (globalThis as any).__dbg = [dd.x, q.x, q.age, p.x, thrown.has(q.id)]; }
    s.teleport(1000, 272); s.stepFast(60);
    if (G.drops.some(d => d.id === dropped[0].id)) { const d = G.drops.find(q => q.id === dropped[0].id)!; throw new Error('dbg ' + JSON.stringify((globalThis as any).__dbg) + ' вернувшись к брошенному, не подобрал: drop ' + JSON.stringify([d.x, d.y, d.age, thrown.has(d.id)]) + ' player ' + JSON.stringify([p.x, p.y])); }
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

void tileBlock; void held;
