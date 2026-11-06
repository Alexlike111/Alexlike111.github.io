// Self-tests of the arctic world (DESIGN §1): no trees, sea level, sites, radio parts, seal holes, floes, notes, polar-night sky, light region, sky render.
// Read-only: the running game's grid is never modified; the clock fields of G are restored after the sky checks.
import { registerTest } from './selftest';
import { G } from './state';
import { worldInfo } from './worldgen';
import { sites, SEA } from './locations';
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
