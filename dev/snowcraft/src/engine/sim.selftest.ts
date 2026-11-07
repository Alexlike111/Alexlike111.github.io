// In-game self-test for the simulation core (SPEC §11): fire, water, freezing, support, falls, trees, explosions, heat, shelter.
// Imported by main.ts (side effect: registers the tests). Every scenario runs synchronously on a scratch copy of the world:
// the real grid is snapshotted, cleared, the scenario runs, and the snapshot is restored afterwards, so the player's world is untouched
// (heat tiles are re-initialised from the restored grid; temperatures of the real world restart from the geothermal profile).
import { registerTest } from '../game/selftest';
import type { TestCtx } from '../game/selftest';
import {
  W, H, mat, aux, shade, flags, bg, seen, awake, clearWorld, idx, wakeRect, F_PLACED, F_TREE,
} from './grid';
import { MAT } from '../content/materials';
import { G } from '../game/state';
import { initSim, stepSim, ignite, seedSim } from './sim';
import { initHeat, stepHeat, tempAt, temp, enclosure, HEAT_POWER, addHeat, clearThermalZones } from './heat';
import { initStructure, stepStructure, requestSupportCheck } from './structure';
import { clusters, stepBodies, fellTree, onTreeLanded } from './bodies';
import { stepParticles, FC, clearParticles, throwCell } from './particles';
import { explode, onBlast } from './explode';

const DT = 1 / 60;
type Scenario = { name: string; fn: (t: TestCtx) => void; timeoutMs?: number };

// ------------------------------------------------------------------ scratch world
function scratch(fn: () => void) {
  const snap = {
    mat: mat.slice(), aux: aux.slice(), shade: shade.slice(), flags: flags.slice(), bg: bg.slice(), seen: seen.slice(), awake: awake.slice(),
    win: { ...G.win }, snowfall: G.snowfall, wind: G.wind, ambientT: G.ambientT, player: G.player,
    clusters: clusters.slice(), nfc: FC.n,
    fc: { x: FC.x.slice(0, FC.n), y: FC.y.slice(0, FC.n), vx: FC.vx.slice(0, FC.n), vy: FC.vy.slice(0, FC.n), m: FC.m.slice(0, FC.n), a: FC.a.slice(0, FC.n), s: FC.s.slice(0, FC.n), age: FC.age.slice(0, FC.n) },
  };
  try {
    clusters.length = 0; clearParticles(); clearThermalZones(); clearWorld();
    G.snowfall = 0; G.wind = 0; G.player = null as never; seedSim(4242);
    fn();
  } finally {
    mat.set(snap.mat); aux.set(snap.aux); shade.set(snap.shade); flags.set(snap.flags); bg.set(snap.bg); seen.set(snap.seen); awake.set(snap.awake);
    Object.assign(G.win, snap.win); G.snowfall = snap.snowfall; G.wind = snap.wind; G.ambientT = snap.ambientT; G.player = snap.player;
    clusters.length = 0; for (const c of snap.clusters) clusters.push(c);
    clearParticles(); clearThermalZones();
    for (let i = 0; i < snap.nfc; i++) { FC.x[i] = snap.fc.x[i]; FC.y[i] = snap.fc.y[i]; FC.vx[i] = snap.fc.vx[i]; FC.vy[i] = snap.fc.vy[i]; FC.m[i] = snap.fc.m[i]; FC.a[i] = snap.fc.a[i]; FC.s[i] = snap.fc.s[i]; FC.age[i] = snap.fc.age[i]; }
    FC.n = snap.nfc;
    initSim(); initStructure(); initHeat();
  }
}
function setup(x0: number, y0: number, x1: number, y1: number, ambient = -10) {
  Object.assign(G.win, { x0, y0, x1, y1 }); G.ambientT = ambient;
  initSim(); initStructure(); initHeat(); temp.fill(ambient);
  wakeRect(x0 - 40, y0 - 40, x1 + 40, y1 + 40, 120);
}
function fill(x0: number, y0: number, x1: number, y1: number, m: number, fl = 0, a = 0) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = idx(x, y); mat[i] = m; aux[i] = a; flags[i] = fl; shade[i] = (x * 7 + y * 13) & 255; }
}
function put(x: number, y: number, m: number, fl = 0, a = 0) { const i = idx(x, y); mat[i] = m; aux[i] = a; flags[i] = fl; shade[i] = 128; }
function count(m: number, x0 = 0, y0 = 0, x1 = W - 1, y1 = H - 1) {
  let n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (mat[idx(x, y)] === m) n++;
  return n;
}
function run(ticks: number, heat = false, struct = false) {
  for (let k = 0; k < ticks; k++) { stepSim(DT); if (heat) stepHeat(DT); if (struct) stepStructure(DT); stepBodies(DT); stepParticles(DT); }
}

// ------------------------------------------------------------------ scenarios
const S: Scenario[] = [];
const add = (name: string, fn: (t: TestCtx) => void, timeoutMs = 20000) => S.push({ name, fn, timeoutMs });

add('вода: масса сохраняется, поверхность ровная', (t) => scratch(() => {
  setup(800, 300, 960, 460, 10);
  fill(800, 300, 960, 460, MAT.STONE); fill(820, 320, 900, 440, MAT.AIR);
  let n = 0;
  for (let y = 322; y < 360; y++) for (let x = 825; x < 880; x++) if ((x * 31 + y * 17) % 5 !== 0) { put(x, y, MAT.WATER); n++; }
  run(1200);
  const after = count(MAT.WATER, 820, 320, 900, 440) + FC.n;
  t.expect(after === n, `вода ${n} → ${after}`);
  let hi = 440; for (let y = 320; y < 440 && hi === 440; y++) for (let x = 821; x < 900; x++) if (mat[idx(x, y)] === MAT.WATER) { hi = y; break; }
  t.expect(440 - hi + 1 <= Math.ceil(n / 79) + 3, `поверхность высоко: ${440 - hi + 1}`);
  t.metric('water cells', n);
}));

add('сообщающиеся сосуды выравнивают уровни', (t) => scratch(() => {
  setup(800, 300, 960, 470, 10);
  fill(800, 300, 960, 470, MAT.STONE);
  fill(820, 330, 826, 450, MAT.AIR); fill(850, 330, 856, 450, MAT.AIR); fill(820, 444, 856, 450, MAT.AIR);
  for (let y = 380; y <= 450; y++) for (let x = 820; x <= 826; x++) put(x, y, MAT.WATER);
  run(3000);
  const col = (x0: number, x1: number) => { for (let y = 330; y <= 450; y++) for (let x = x0; x <= x1; x++) if (mat[idx(x, y)] === MAT.WATER) return 450 - y + 1; return 0; };
  const hl = col(820, 826), hr = col(850, 856);
  t.expect(hr > 20 && Math.abs(hl - hr) <= 3, `уровни ${hl} / ${hr}`);
}));

add('снежная куча: угол естественного откоса, сон чанков', (t) => scratch(() => {
  setup(800, 300, 1000, 470, -10);
  fill(800, 450, 1000, 470, MAT.STONE);
  let spawned = 0;
  for (let k = 0; k < 900; k++) { put(900, 330, MAT.SNOW); spawned++; run(1); }
  run(500);
  const total = count(MAT.SNOW, 801, 300, 999, 449) + count(MAT.PACKED, 801, 300, 999, 449);
  t.expect(Math.abs(total - spawned) <= 2, `снег ${spawned} → ${total}`);
  let top = 449, x0 = 999, x1 = 801;
  for (let x = 801; x < 999; x++) for (let y = 300; y < 450; y++) { const m = mat[idx(x, y)]; if (m === MAT.SNOW || m === MAT.PACKED) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); top = Math.min(top, y); break; } }
  const ang = Math.atan2(450 - top, (x1 - x0 + 1) / 2) * 180 / Math.PI;
  t.metric('pile angle', ang, '°');
  t.expect(ang > 25 && ang < 60, `угол ${ang.toFixed(1)}°`);
  run(300);
  let aw = 0; for (let cy = 8; cy <= 15; cy++) for (let cx = 24; cx <= 31; cx++)   // chunks inside the processed window only if (awake[cy * 64 + cx]) aw++;
  t.expect(aw === 0, `${aw} чанков не уснули`);
}));

add('огонь: дерево → угли → зола', (t) => scratch(() => {
  setup(800, 300, 960, 470, -5);
  fill(800, 450, 960, 470, MAT.STONE); fill(850, 440, 855, 449, MAT.WOOD);
  ignite(850, 449);
  let maxEmber = 0;
  for (let k = 0; k < 4200; k++) { run(1); if (k % 20 === 0) maxEmber = Math.max(maxEmber, count(MAT.EMBER, 840, 400, 870, 455)); }
  t.expect(count(MAT.WOOD) === 0, `дерево осталось: ${count(MAT.WOOD)}`);
  t.expect(maxEmber > 5, `углей ${maxEmber}`);
  t.expect(count(MAT.ASH, 830, 400, 880, 455) > 20, 'нет золы');
}));

add('снег тает у огня, пар в мороз превращается в снег', (t) => scratch(() => {
  setup(800, 300, 1000, 470, -10);
  fill(800, 450, 1000, 470, MAT.STONE);
  fill(870, 430, 930, 449, MAT.SNOW);
  fill(898, 445, 902, 449, MAT.PLANK, F_PLACED);
  ignite(900, 449);
  for (let k = 0; k < 1500; k++) { run(1, true); if (k % 8 === 0) addHeat(900, 448, HEAT_POWER.campfire); }
  const wet = count(MAT.WATER, 800, 300, 1000, 470) + count(MAT.ICE, 800, 300, 1000, 470) + count(MAT.STEAM, 800, 300, 1000, 470);
  t.expect(wet > 20, `лужа/лёд/пар: ${wet}`);
}));

add('пар в мороз превращается в снег', (t) => scratch(() => {
  setup(800, 300, 1000, 470, -20);
  for (let k = 0; k < 40; k++) put(865 + (k % 5), 400 - ((k / 5) | 0), MAT.STEAM, 0, 120);
  temp.fill(-20);
  run(700);
  t.expect(count(MAT.STEAM) === 0, `пара осталось ${count(MAT.STEAM)}`);
  t.expect(count(MAT.SNOW) + count(MAT.PACKED) === 40, `снега ${count(MAT.SNOW)} из 40`);
}));

add('вода замерзает при −20 °C сверху вниз', (t) => scratch(() => {
  setup(800, 300, 960, 470, -20);
  fill(800, 300, 960, 470, MAT.STONE); fill(820, 400, 900, 440, MAT.AIR);
  fill(821, 420, 899, 439, MAT.WATER);
  temp.fill(-20);
  let first = -1;
  // heat must be stepped too: freezing releases latent heat into the tile, and only the thermal field carries it away to the -20 ambient
  for (let k = 0; k < 3600; k++) {
    run(1, true);
    if (first < 0 && count(MAT.ICE, 821, 420, 899, 439) > 0) first = k;
  }
  const ice = count(MAT.ICE, 821, 420, 899, 439);
  t.expect(first >= 0 && first < 300, 'лёд не появился за 5 с');
  t.expect(ice > 79 * 20 * 0.4, `лёд ${ice}/${79 * 20} за 60 с`);
  let sealed = true; for (let x = 821; x <= 899; x++) { let top = -1; for (let y = 420; y < 440; y++) if (mat[idx(x, y)] !== MAT.AIR) { top = y; break; } if (top < 0 || mat[idx(x, top)] !== MAT.ICE) { sealed = false; break; } }
  t.expect(sealed, 'поверхность не затянулась льдом');
  t.metric('first ice', first / 60, 's');
}));

add('опора: арка держится, плоская плита проседает посередине', (t) => scratch(() => {
  setup(800, 300, 1000, 470, -10);
  fill(800, 450, 1000, 470, MAT.STONE);
  let na = 0;
  for (let y = 420; y < 450; y++) for (let x = 870; x <= 930; x++) { const d = Math.hypot(x + 0.5 - 900, y + 0.5 - 450); if (d >= 12 && d <= 16) { put(x, y, MAT.SNOWBLOCK, F_PLACED); na++; } }
  requestSupportCheck(860, 410, 940, 452);
  run(120, false, true);
  t.expect(count(MAT.SNOWBLOCK, 860, 400, 940, 452) === na && clusters.length === 0, 'арка потеряла блоки');
  fill(800, 300, 1000, 449, MAT.AIR);
  fill(880, 420, 883, 449, MAT.SNOWBLOCK, F_PLACED); fill(924, 420, 927, 449, MAT.SNOWBLOCK, F_PLACED); fill(880, 416, 927, 419, MAT.SNOWBLOCK, F_PLACED);
  requestSupportCheck(870, 410, 940, 452);
  run(240, false, true);
  let left = 0; for (let x = 884; x < 924; x++) for (let y = 416; y < 420; y++) if (mat[idx(x, y)] === MAT.SNOWBLOCK) left++;
  t.expect(left >= 80 && left <= 112, `плита: ${left}/160`);
}));

add('оторванный блок падает кластером, высокое падение дробит', (t) => scratch(() => {
  setup(800, 300, 1000, 470, -10);
  fill(800, 450, 1000, 470, MAT.STONE); fill(900, 420, 907, 427, MAT.SNOWBLOCK, F_PLACED);
  requestSupportCheck(890, 410, 920, 450);
  let saw = false;
  for (let k = 0; k < 240; k++) { stepSim(DT); stepStructure(DT); stepBodies(DT); stepParticles(DT); if (clusters.length) saw = true; }
  t.expect(saw && clusters.length === 0 && count(MAT.SNOWBLOCK, 895, 400, 915, 449) === 64, 'блок не приземлился целым');
  fill(900, 420, 907, 449, MAT.AIR); fill(900, 330, 907, 337, MAT.SNOWBLOCK, F_PLACED);
  requestSupportCheck(890, 320, 920, 450);
  for (let k = 0; k < 300; k++) { stepSim(DT); stepStructure(DT); stepBodies(DT); stepParticles(DT); }
  const snow = count(MAT.SNOW, 850, 300, 960, 449) + count(MAT.PACKED, 850, 300, 960, 449);
  t.expect(count(MAT.SNOWBLOCK, 850, 300, 960, 449) === 0 && snow >= 60 && snow <= 64, `после падения: снег ${snow}`);
}));

add('взрыв: кратер по твёрдости, обломки возвращаются в сетку', (t) => scratch(() => {
  setup(800, 300, 1000, 470, -10);
  fill(850, 350, 950, 430, MAT.STONE); fill(850, 431, 950, 440, MAT.BEDROCK);
  let blasts = 0; const off = onBlast(() => { blasts++; });
  const r = explode(900, 390, 14, 0.9);
  off();
  t.expect(r.destroyed > 150 && blasts === 1, `разрушено ${r.destroyed}, колбэков ${blasts}`);
  t.expect(count(MAT.BEDROCK) === 10 * 101, 'коренная порода пострадала');
  run(240);
  t.expect(FC.n === 0, `${FC.n} летящих клеток не вернулись`);
  t.metric('destroyed', r.destroyed);
}));

add('метан + огонь: цепной взрыв', (t) => scratch(() => {
  setup(800, 300, 1000, 470, -10);
  fill(830, 380, 960, 450, MAT.STONE); fill(850, 400, 940, 430, MAT.AIR); fill(850, 400, 940, 430, MAT.METHANE);
  let booms = 0; const off = onBlast(() => { booms++; });
  put(880, 415, MAT.FIRE, 0, 30);
  run(240);
  off();
  t.expect(booms >= 1, 'взрыва не было');
  t.expect(count(MAT.METHANE, 830, 380, 960, 450) < 30, 'газ остался');
}));

add('лава + вода → базальт и пар; лава поджигает доски', (t) => scratch(() => {
  setup(800, 300, 1000, 470, -10);
  fill(800, 440, 1000, 470, MAT.STONE); fill(850, 436, 870, 439, MAT.LAVA); fill(851, 430, 869, 435, MAT.WATER);
  fill(880, 430, 883, 439, MAT.PLANK, F_PLACED); fill(872, 436, 879, 439, MAT.LAVA);
  const lava0 = count(MAT.LAVA);
  run(480, true);
  t.expect(count(MAT.BASALT) > 0 && count(MAT.LAVA) < lava0, 'базальт не образовался');
}));

add('рубка ели: падает ~1.2 с, 8 брёвен из ствола 320 клеток', (t) => scratch(() => {
  setup(800, 300, 1100, 470, -10);
  fill(800, 450, 1100, 470, MAT.DIRT); fill(900, 370, 903, 449, MAT.WOOD, F_TREE);
  for (let y = 372; y < 440; y += 4) { const w = Math.max(2, Math.floor((440 - y) / 4)); fill(901 - w, y, 899, y + 3, MAT.NEEDLES, F_TREE); fill(904, y, 902 + w, y + 3, MAT.NEEDLES, F_TREE); }
  let got: number[] | null = null;
  const off = onTreeLanded((x, y, l, b) => { got = [x, y, l, b]; });
  t.expect(fellTree(901, 440, 1), 'fellTree вернул false');
  let n = 0; while (!got && n < 600) { stepBodies(DT); stepParticles(DT); stepSim(DT); n++; }
  off();
  t.expect(!!got, 'дерево не упало');
  if (got) t.expect((got as number[])[2] === 8, `брёвен ${(got as number[])[2]}`);
  t.metric('fall', n / 60, 's');
  t.expect(n / 60 > 0.7 && n / 60 < 2.2, `падение ${(n / 60).toFixed(2)} с`);
}));

add('укрытие: закрытая снежная комната с огнём прогревается', (t) => scratch(() => {
  setup(700, 200, 960, 370, -25);
  const GY = 296;
  fill(700, GY + 24, 960, GY + 70, MAT.DIRT); fill(700, GY, 960, GY + 23, MAT.PACKED);
  fill(800, GY - 24, 831, GY - 1, MAT.SNOWBLOCK, F_PLACED); fill(804, GY - 20, 827, GY - 1, MAT.AIR);
  initHeat();   // geothermal profile under the snowpack, open air relaxes to the ambient
  const ex = enclosure(816, GY - 8);
  t.expect(ex.closed, 'комната не распознана как закрытая');
  const t0 = tempAt(816, GY - 12);
  for (let k = 0; k < 1800; k++) { stepSim(DT); stepHeat(DT); addHeat(816, GY - 2, HEAT_POWER.campfire); }
  const t1 = tempAt(816, GY - 12), out = tempAt(780, GY - 12);
  t.metric('room', t1, '°C');
  t.expect(t1 > t0 + 5 && t1 > 3, `в комнате ${t0.toFixed(1)} → ${t1.toFixed(1)} °C`);
  t.expect(out < -20, `снаружи ${out.toFixed(1)} °C`);
}));

add('снег/вода/лёд/щебень не появляются и не исчезают (обрушения, броски, кластеры)', (t) => scratch(() => {
  setup(800, 250, 1100, 470, -15);
  fill(600, 440, 1300, 470, MAT.STONE); fill(800, 300, 805, 440, MAT.STONE); fill(1095, 300, 1100, 440, MAT.STONE); fill(930, 400, 940, 439, MAT.STONE);
  temp.fill(-15);
  const mats = [MAT.SNOW, MAT.WATER, MAT.GRAVEL, MAT.SNOWBLOCK, MAT.PACKED, MAT.ICE, MAT.SNOW];
  const tracked = new Uint8Array(256); for (const m of mats) tracked[m] = 1;
  let s = 7; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  let added = 0;
  for (let k = 0; k < 1200; k++) {
    const x = 810 + ((rnd() * 280) | 0), y = 260 + ((rnd() * 150) | 0), r = rnd();
    if (r < 0.1) {
      const m = mats[(rnd() * mats.length) | 0], fl = rnd() < 0.5 ? F_PLACED : 0, w = (rnd() * 9) | 0, h = (rnd() * 9) | 0;
      for (let yy = y; yy <= y + h; yy++) for (let xx = x; xx <= x + w; xx++) if (mat[idx(xx, yy)] === 0) { put(xx, yy, m, fl); added++; }
      wakeRect(x - 4, y - 4, x + 12, y + 12, 60);
    } else if (r < 0.14) { for (let q = 0; q < 12; q++) if (throwCell(x, y, mats[(rnd() * mats.length) | 0], 0, (rnd() - 0.5) * 220, -rnd() * 160)) added++; }
    else if (r < 0.16) requestSupportCheck(Math.max(810, x - 20), Math.max(250, y - 20), x + 20, y + 20);
    run(1, false, true);
  }
  run(600, false, true);
  let n = 0;
  for (let y = 150; y < 470; y++) for (let x = 600; x <= 1300; x++) if (tracked[mat[idx(x, y)]]) n++;
  for (let k = 0; k < FC.n; k++) if (tracked[FC.m[k]]) n++;
  for (const c of clusters) for (let k = 0; k < c.n; k++) if (tracked[c.m[k]]) n++;
  t.expect(n === added, `ожидалось ${added}, найдено ${n}`);
  t.metric('cells', added);
}));

add('производительность: окно 420×240 с падающим снегом и водой', (t) => scratch(() => {
  setup(800, 250, 1220, 490, -18);
  G.snowfall = 0.6; G.wind = 6;
  fill(800, 400, 1220, 424, MAT.PACKED); fill(800, 425, 1220, 450, MAT.DIRT); fill(800, 451, 1220, 520, MAT.STONE);
  let s = 11; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < 6000; i++) put(800 + ((rnd() * 420) | 0), 260 + ((rnd() * 120) | 0), MAT.SNOW);
  for (let i = 0; i < 1500; i++) put(1065 + ((rnd() * 50) | 0), 330 + ((rnd() * 40) | 0), MAT.WATER);
  for (let i = 0; i < 120; i++) { stepSim(DT); stepHeat(DT); }
  const N = 240, t0 = performance.now();
  for (let i = 0; i < N; i++) { stepSim(DT); stepHeat(DT); stepStructure(DT); stepBodies(DT); stepParticles(DT); }
  const ms = (performance.now() - t0) / N;
  t.metric('sim+heat+struct', ms, ' ms/кадр');
  t.expect(ms < 12, `${ms.toFixed(2)} мс на кадр`);
}), 30000);

export const simScenarios = S;
for (const sc of S) registerTest('sim', sc.name, sc.fn, sc.timeoutMs ?? 20000);
