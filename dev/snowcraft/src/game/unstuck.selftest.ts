// Self-tests: snow inside the player's body (storm pile-up, slides) must never trap the player.
import { registerTest } from './selftest';
import { G } from './state';
import { mat, setCell } from '../engine/grid';
import { boxFree } from '../engine/phys';
import { MAT } from '../content/materials';
import { stepUnstuck, resetUnstuck } from './unstuck';
import { sandbox } from './testkit';

function fillBox(m: number) {
  const p = G.player;
  const x0 = Math.floor(p.x - p.w / 2), x1 = Math.ceil(p.x + p.w / 2) - 1, y0 = Math.floor(p.y - p.h), y1 = Math.ceil(p.y) - 1;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setCell(x, y, m, m === MAT.SNOW ? 60 : 0);
}

registerTest('player', 'засыпало снегом по горло: игрок выбирается сам', async (t) => sandbox(async () => {
  const sc = t.sc; sc.teleport(692, 272); await t.frames(20);
  const p = G.player; resetUnstuck();
  const x0 = p.x;
  fillBox(MAT.SNOW);
  t.expect(!boxFree(p.x, p.y, p.w, p.h), 'тест: игрок должен быть засыпан');
  for (let i = 0; i < 60 && !boxFree(p.x, p.y, p.w, p.h); i++) { stepUnstuck(1 / 60); await t.frames(1); }
  t.expect(boxFree(p.x, p.y, p.w, p.h), 'после рыхлого снега игрок свободен');
  t.expect(Math.abs(p.x - x0) < 60, 'игрока не унесло далеко');
}));      // sandbox: the snow poured into the player must not stay behind (it blocked the west door for the later ui test)

registerTest('player', 'вмёрз в наст: игрока выносит на свободное место', async (t) => sandbox(async () => {
  const sc = t.sc; sc.teleport(692, 272); await t.frames(20);
  const p = G.player; resetUnstuck();
  fillBox(MAT.PACKED);
  t.expect(!boxFree(p.x, p.y, p.w, p.h), 'тест: игрок в твёрдом снегу');
  for (let i = 0; i < 6 && !boxFree(p.x, p.y, p.w, p.h); i++) { stepUnstuck(1 / 60); await t.frames(1); }
  t.expect(boxFree(p.x, p.y, p.w, p.h), 'игрок вынесен из наста');
  t.expect(mat[Math.floor(p.y - 1) * 2048 + Math.floor(p.x)] === 0, 'в точке игрока воздух');
}));

registerTest('player', 'клавиша U: выход на поверхность', async (t) => sandbox(async () => {
  const sc = t.sc; sc.teleport(692, 272); await t.frames(20); resetUnstuck();
  const p = G.player;
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyU' }));
  stepUnstuck(1 / 60); await t.frames(2);
  t.expect(boxFree(p.x, p.y, p.w, p.h) && p.alive, 'после U игрок на свободном месте');
}));
