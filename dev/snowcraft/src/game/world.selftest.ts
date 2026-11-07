// Self-tests of the arctic world (DESIGN §1): no trees, sea level, sites, radio parts, seal holes, floes, notes, polar-night sky, light region, sky render.
// Read-only: the running game's grid is never modified; the clock fields of G are restored after the sky checks.
import { registerTest } from './selftest';
import { G } from './state';
import { worldInfo } from './worldgen';
import { sites, SEA, LOC } from './locations';
import { DOOR } from './snowpack';
import { questState, GOALS, doorFrontSnow } from './quest';
import { W, H, mat, F_TREE, flags } from '../engine/grid';
import { MAT } from '../content/materials';
import { computeLight, lt } from '../engine/light';
import { skyState, updateSkyState, drawSky } from '../engine/sky';

const clock = (day: number, hour: number) => {
  const noon = Math.max(-9.5, Math.min(1.2, -9 + 9.5 * (((day - 1) * 1440 + 720) / 1440 - 0.5) / 11));
  G.noonElev = noon; G.sunElev = noon - 17 * (1 - Math.cos(2 * Math.PI * (hour - 12) / 24)) / 2;
};

registerTest('world', 'в мире нет деревьев, лавы и руды', t => {
  let trees = 0, bad = 0;
  const lava = (MAT as Record<string, number>).LAVA, ore = (MAT as Record<string, number>).ORE;
  for (let i = 0; i < mat.length; i += 3) { if (flags[i] & F_TREE) trees++; if ((lava !== undefined && mat[i] === lava) || (ore !== undefined && mat[i] === ore)) bad++; }
  t.expect(trees === 0, 'деревьев: ' + trees);
  t.expect(bad === 0, 'лава/руда: ' + bad);
  t.expect(mat.length === W * H, 'размер сетки');
});

registerTest('world', 'уровень моря, места и радиодетали', t => {
  t.expect(worldInfo.seaLevel === SEA, 'уровень моря = ' + SEA);
  for (const k of ['cape', 'mine', 'minehut', 'cairn', 'station', 'shed', 'beach', 'whale', 'fastice', 'iceberg', 'icecave', 'pack', 'ship', 'openSea'])
    t.expect(sites.some(s => s.key === k), 'нет места: ' + k);
  const rp = worldInfo.radioParts;
  t.expect(!!rp.triode && !!rp.coil && !!rp.battery, 'три радиодетали на месте');
  t.expect(rp.triode.y > 0 && rp.coil.y > 0 && rp.battery.y > 0, 'координаты радиодеталей');
});

registerTest('world', 'лунки тюленей, льдины и записки', t => {
  t.expect(worldInfo.sealHoles.length >= 6, 'лунок: ' + worldInfo.sealHoles.length);
  t.expect(worldInfo.iceField.floes.length >= 6, 'льдин: ' + worldInfo.iceField.floes.length);
  t.expect(worldInfo.iceField.cracks.length >= 4, 'трещин: ' + worldInfo.iceField.cracks.length);
  const ids = new Set(worldInfo.notes.map(n => n.id));
  for (let i = 1; i <= 14; i++) t.expect(ids.has('n' + i), 'нет записки n' + i);
  t.metric('записок', worldInfo.notes.length); t.metric('сундуков', worldInfo.chests.length);
});

registerTest('world', 'сумрак растёт от дня к дню, луна светит ночью', t => {
  const sv = { s: G.sunElev, n: G.noonElev };
  try {
    clock(1, 12); updateSkyState(); const a = skyState.light, wa = skyState.warm;
    clock(6, 12); updateSkyState(); const b = skyState.light;
    clock(11, 12); updateSkyState(); const c = skyState.light, wc = skyState.warm;
    t.expect(a < b && b < c, `свет в полдень растёт (${a.toFixed(2)} < ${b.toFixed(2)} < ${c.toFixed(2)})`);
    t.expect(wa < wc, 'цвет сумерек теплеет к концу');
    clock(6, 0); updateSkyState(); t.expect(skyState.night > 0.5, 'в полночь — ночь');
  } finally { G.sunElev = sv.s; G.noonElev = sv.n; updateSkyState(); }
});

registerTest('world', 'область света постоянного размера', t => {
  const sizes = new Set<string>();
  for (let x = 400; x < 520; x += 15) { computeLight({ x0: x, y0: 210, w: 402, h: 226 }, 0); sizes.add(lt.w + 'x' + lt.h); }
  t.expect(sizes.size === 1, 'размеры: ' + [...sizes].join(','));
});

registerTest('world', 'небо рисуется непустым', t => {
  const c = document.createElement('canvas'); c.width = 320; c.height = 180;
  const ctx = c.getContext('2d')!;
  drawSky(ctx, 320, 180, 0, 0, 1000, 240, 3, 1);
  const d = ctx.getImageData(0, 0, 320, 180).data; let lit = 0;
  for (let i = 0; i < d.length; i += 4 * 17) if (d[i] + d[i + 1] + d[i + 2] > 6) lit++;
  t.expect(lit > 50, 'ярких пикселей неба: ' + lit);
});

// ---- deep snow (DESIGN §13) ----
registerTest('world', 'глубокий снег: дверь дома под сугробом, крыши, припай', t => {
  const pad = LOC.station.y, wall = LOC.house.R * 4 + 4;
  const topAt = (x: number, y0 = 100) => { let y = y0; while (y < H && mat[y * W + x] === MAT.AIR) y++; return y; };
  const snowDepth = (x: number, y0 = 100) => { let y = topAt(x, y0), n = 0; while ((mat[y * W + x] === MAT.SNOW || mat[y * W + x] === MAT.PACKED) && n < 90) { y++; n++; } return n; };
  t.expect(DOOR.crest >= 28 && DOOR.x0 === wall, 'сугроб у двери: crest ' + DOOR.crest);
  const dug = questState.ended !== '' || G.time > 12 * 60 + 8 * 60 || doorFrontSnow() <= 14;    // the player may have dug it already
  t.expect(dug || doorFrontSnow() >= 100, 'дверь на старте заметена: снега перед ней ' + doorFrontSnow());
  t.expect(GOALS.some(g => g.id === 'door'), 'первая цель «Откопай дверь» есть в цепочке');
  let roof = 0; for (let y = 190; y < pad - 36; y++) for (let x = (LOC.house.L - 1) * 4; x < (LOC.house.R + 2) * 4; x++) if (mat[y * W + x] === MAT.SNOW) roof++;
  t.expect(roof > 500, 'снег на крыше дома: ' + roof + ' клеток');
  let a = 0, n = 0; for (let x = 1120; x < 1330; x += 3) { a += snowDepth(x); n++; }
  t.expect(a / n <= 9 && a / n >= 1, 'на припае 0.1–0.8 м снега (среднее ' + (a / n * 0.09).toFixed(2) + ' м)');
  t.metric('снег у стены дома', snowDepth(wall + 1, 241) * 0.09, 'м');
});

// ---- zoom (DESIGN §14) ----
registerTest('zoom', 'масштаб: целые шаги, координаты, окно симуляции и свет на каждом уровне', async t => {
  const z = t.sc.zoom; const i0 = z.index(), n = z.count();
  t.expect(n >= 3, 'шагов масштаба: ' + n);
  const dpr = window.devicePixelRatio || 1, devW = Math.round(window.innerWidth * dpr);
  for (let i = 0; i < n; i++) {
    z.set(i); await t.frames(3);
    const s = G.cam.scale, cells = devW / s;
    t.expect(Number.isInteger(s), `шаг ${i}: целый масштаб ${s}`);
    t.expect(cells >= 199.9 && cells <= 700.1, `шаг ${i}: ${cells.toFixed(0)} клеток в ширину (200..700)`);
    t.expect(Math.abs(G.cam.viewW - cells) < 0.01, `шаг ${i}: viewW совпадает`);
    const [wx, wy] = t.sc.screenToWorld(321, 234), [sx, sy] = t.sc.worldToScreen(wx, wy);
    t.expect(Math.abs(sx - 321) < 0.02 && Math.abs(sy - 234) < 0.02, `шаг ${i}: screenToWorld ↔ worldToScreen`);
    const [px, py] = t.sc.worldToScreen(G.player.x, G.player.y - 10);
    t.expect(px > -1 && px < window.innerWidth + 1 && py > -1 && py < window.innerHeight + 1, `шаг ${i}: игрок на экране`);
    const hw = G.cam.viewW / 2, hh = G.cam.viewH / 2;
    t.expect(G.win.x0 <= Math.max(0, G.cam.x - hw) + 1 && G.win.x1 >= Math.min(W - 1, G.cam.x + hw) - 1 && G.win.y0 <= Math.max(0, G.cam.y - hh) + 1 && G.win.y1 >= Math.min(H - 1, G.cam.y + hh) - 1, `шаг ${i}: окно симуляции накрывает экран`);
    computeLight({ x0: Math.floor(G.cam.x - hw), y0: Math.floor(G.cam.y - hh), w: Math.ceil(G.cam.viewW) + 2, h: Math.ceil(G.cam.viewH) + 2 }, 0);
    t.expect(lt.w * 4 >= G.cam.viewW && lt.h * 4 >= G.cam.viewH, `шаг ${i}: карта света накрывает экран`);
  }
  z.set(i0); await t.frames(2);
  t.expect(z.index() === i0, 'масштаб возвращён');
});
