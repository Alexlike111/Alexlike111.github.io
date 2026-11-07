// Self-tests for the body and movement (G2 group): jump heights, step-up, day/night temperature, frostbite pace on the face,
// and getting out when the player pushes into something for 6 s.
import { registerTest } from './selftest';
import type { TestCtx } from './selftest';
import { G } from './state';
import { MAT } from '../content/materials';
import { arena, put, snapshot, restore } from './testkit';
import { auxOfDensity } from './items';
import { unstuckStats, resetUnstuck } from './unstuck';
import { windChill } from './player';
import { inv } from './inventory';
import { boxFree } from '../engine/phys';
import { edited } from '../engine/grid';

/** Flat snow arena (surface at y 272) with the player standing on it, calm weather, body fresh. */
function flat(t: TestCtx) {
  const sc = t.sc;
  arena(1000, 272, { dens: 300, loose: 0, depth: 40, up: 70 });
  sc.teleport(1000, 272);
  sc.setWeather({ ambientT: -10, wind: 0, storm: 0, snowfall: 0 });
  const p = G.player;
  p.core = 37; p.wet = 0; p.hp = 100; p.alive = true; p.food = 90; p.water = 90; p.energy = 90;
  p.frost.hands = p.frost.feet = p.frost.face = 0;
  sc.stepFast(10);
  return p;
}

/** Height (cells) of a jump: Space held for `holdFrames` frames, then released; the player is then watched until the apex. */
async function jumpHeight(t: TestCtx, holdFrames: number): Promise<number> {
  const p = flat(t);
  const y0 = p.y; let top = p.y;
  t.sc.key('Space', true);
  for (let i = 0; i < 60; i++) {
    if (i === holdFrames) t.sc.key('Space', false);
    t.sc.stepFast(1);
    top = Math.min(top, p.y);
  }
  t.sc.key('Space', false);
  return y0 - top;
}

registerTest('body', 'короткий тап прыжка поднимает не меньше 8 клеток', async (t) => {
  const snap = snapshot();
  try {
    const h = await jumpHeight(t, 3);
    t.metric('тап', h, ' кл');
    t.expect(h >= 8, `тап-прыжок ${h.toFixed(1)} кл, нужно ≥ 8`);
  } finally { restore(snap); }
}, 60000);

registerTest('body', 'удержание прыжка не выше прежнего максимума (~16 клеток)', async (t) => {
  const snap = snapshot();
  try {
    const h = await jumpHeight(t, 60);
    t.metric('удержание', h, ' кл');
    t.expect(h >= 8 && h <= 16.5, `прыжок с удержанием ${h.toFixed(1)} кл, ожидалось 8…16.5`);
  } finally { restore(snap); }
}, 60000);

registerTest('body', 'ступень в 6 клеток проходится на ходу без прыжка', async (t) => {
  const snap = snapshot();
  try {
    const p = flat(t);
    const base = Math.floor(p.x);
    for (let y = 266; y <= 271; y++) for (let x = base + 6; x <= base + 7; x++) put(x, y, MAT.STONE);
    t.sc.key('KeyD', true);
    t.sc.stepFast(180);
    t.sc.key('KeyD', false);
    t.expect(p.x > base + 8, `игрок у стены 6 клеток: x=${p.x.toFixed(1)}, база ${base}`);
  } finally { restore(snap); }
}, 60000);

registerTest('body', 'стена в 12 клеток по-прежнему не перелезается', async (t) => {
  const snap = snapshot();
  try {
    const p = flat(t);
    const base = Math.floor(p.x);
    for (let y = 260; y <= 271; y++) for (let x = base + 6; x <= base + 7; x++) put(x, y, MAT.STONE);
    t.sc.key('KeyD', true);
    t.sc.stepFast(180);
    t.sc.key('KeyD', false);
    t.expect(p.x < base + 6, `стена 12 клеток пройдена: x=${p.x.toFixed(1)}, база ${base}`);
  } finally { restore(snap); }
}, 60000);

registerTest('body', 'днём в среднем теплее, чем ночью (ясно и тихо)', (t) => {
  const sc = t.sc; const keep = G.time; let sum = 0; let n = 0;
  try {
    for (let d = 3; d <= 8; d++) {
      sc.setWeather(null); sc.setTime((d - 1) * 1440 + 720); const noon = G.ambientT;
      sc.setTime((d - 1) * 1440); const mid = G.ambientT;
      sum += noon - mid; n++;
    }
    const avg = sum / n;
    t.metric('день-ночь', avg, ' °C');
    t.expect(avg >= 3, `средняя разница день-ночь ${avg.toFixed(1)} °C, нужно ≥ 3`);
  } finally { sc.setWeather(null); sc.setTime(keep); }
});

registerTest('body', 'лицо мёрзнет по формуле: база 1.0, мокрый ×1.3 (при ощущаемой −45 это ~27 с на 40→80)', async (t) => {
  const snap = snapshot(); const head = inv.wear.head;
  try {
    const p = flat(t);
    inv.wear.head = null;                                  // bare face: no hat (a hat's protection scales the rate)
    t.sc.setWeather({ ambientT: -33, wind: 4, storm: 0, snowfall: 0 });
    // let the local air (heat grid) settle to the outside temperature first
    for (let k = 0; k < 40; k++) { p.wet = 1; p.core = 37; t.sc.stepFast(60); }
    p.frost.face = 40;
    let secs = 0, feelSum = 0;
    while (p.frost.face < 80 && secs < 90) {
      p.wet = 1; p.core = 37;      // wet and warm core, so only the face rate is measured
      t.sc.stepFast(60); secs++; feelSum += p.feelT;
    }
    const feel = feelSum / Math.max(1, secs);
    const eRaw = Math.max(0, Math.min(1.5, (-feel - 8) / 32));
    const predicted = 40 / (1.0 * eRaw * 0.95 * 1.3);  // player.ts: base 1.0 × eRaw × (1 − 0.05 bare face) × wetF 1.3
    t.log(`ощущаемая у игрока ${feel.toFixed(1)} °C; формула ${predicted.toFixed(0)} с; при −45 было бы ${(40 / (1.0 * 1.156 * 0.95 * 1.3)).toFixed(0)} с`);
    t.metric('лицо 40→80', secs, ' с');
    t.expect(eRaw > 0.2 && secs <= predicted * 1.3 + 3 && secs >= predicted * 0.7 - 3, `лицо 40→80 за ${secs} с, по формуле ${predicted.toFixed(0)} с`);
  } finally { restore(snap); inv.wear.head = head; }
}, 120000);

registerTest('body', 'упор в стену 6 с: игрок выходит на свободное место', async (t) => {
  const snap = snapshot();
  try {
    const p = flat(t);
    const base = Math.floor(p.x);
    // a tunnel under a snow roof (rows 248-249, x base-10…base+40); a stone wall inside it at base+5…base+6.
    // The nearest outdoor standing spot is then the top of the roof right above the player.
    for (let y = 248; y <= 249; y++) for (let x = base - 10; x <= base + 40; x++) put(x, y, MAT.PACKED, auxOfDensity(300));
    for (let y = 250; y <= 271; y++) for (let x = base + 5; x <= base + 6; x++) put(x, y, MAT.STONE);
    edited(base - 12, 246, base + 42, 273);      // refresh the surface cache under the new roof
    t.sc.stepFast(5);
    resetUnstuck();
    const e0 = unstuckStats.ejects;
    t.sc.key('KeyD', true);
    t.sc.stepFast(60 * 2);
    t.expect(unstuckStats.hints > 0, 'через 2 с упора должна быть подсказка U');
    t.sc.stepFast(60 * 5);
    t.sc.key('KeyD', false);
    t.expect(unstuckStats.ejects === e0 + 1, `выход сработал ${unstuckStats.ejects - e0} раз, нужно 1`);
    t.expect(p.y <= 248.5, `после выхода игрок над крышей туннеля: y=${p.y.toFixed(1)}, крыша на строке 248 (x=${p.x.toFixed(1)}, база ${base})`);
    t.expect(boxFree(p.x, p.y, p.w, p.h), 'после выхода игрок на свободном месте');
  } finally { restore(snap); resetUnstuck(); }
}, 90000);
