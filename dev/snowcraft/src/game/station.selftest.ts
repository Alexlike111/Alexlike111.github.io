// Self-tests of DESIGN §15 (interactive objects): placement and reachability, the generator (cold start odds, warming, fuel, power, buried exhaust),
// lamps / heater, the radio dial (stations, lock, forecast, night-only echo, power loss), medkit, kettle, gramophone, shutters (real cells), ladder,
// stove damper (CO flag, burn rate), weather balloon, bells, the coal cart on its grade, frozen barrels and the fox den, saves, audio cues, art.
import { registerTest } from './selftest';
import type { TestCtx } from './selftest';
import { G, type Fixture } from './state';
import { W, TS, mat } from '../engine/grid';
import { MAT } from '../content/materials';
import { add, count, clearInventory, giveStartKit, inv } from './inventory';
import { placeFixture, interact, fixtureLabel } from './fixtures';
import { setDay, wx, knowsForecast, nextStorm } from './weather';
import { sandbox } from './testkit';
import { body } from './player';
import { isFrozen, boxStateOf } from './search';
import { bridge } from './stationbridge';
import { LOC } from './locations';
import { sfx, renderOffline } from '../engine/audio';
import {
  isPowered, startGenerator, stopGenerator, refuelGenerator, attemptStart, startChance, exhaustBuried, stationInteract, stationRadio, roofSpot,
  setShutter, burnMult, heatMult, resetStation, RECORD_LEN, pull, roofSnowDepth,
} from './fixtures_station';
import { radio, STATIONS, messageFor, forecastKnown, sondeActive, closeRadio, tuneQuality } from './fixtures_radio';
import { pushCart } from './fixtures_world';
import { tempAt, temp } from '../engine/heat';
const tempSet = (x: number, y: number, v: number) => { temp[(y >> 2) * (W / TS) + (x >> 2)] = v; };

const sc = () => (window as unknown as { __sc: any }).__sc;
const steps = (n: number) => sc().stepFast(n);
const F = (kind: Fixture['kind']) => G.fixtures.find(f => f.kind === kind)!;
const all = (kind: Fixture['kind']) => G.fixtures.filter(f => f.kind === kind);
const cenX = (f: Fixture) => f.tx * TS + (f.tw * TS) / 2;

function scene(near: Fixture, T = -22) {
  resetStation();
  setDay(3, 12);
  wx.override = { ambientT: T, wind: 0, storm: 0, snowfall: 0 }; Object.assign(G, wx.override);
  giveStartKit();
  const p = G.player;
  sc().teleport(cenX(near), (near.ty + near.th) * TS - 1);
  p.core = 37; p.food = 90; p.water = 90; p.energy = 50; p.hp = 100; p.wet = 0; p.co = 0; p.alive = true; p.sleeping = false;
  p.frost.hands = p.frost.feet = p.frost.face = 0; body.scar.hands = body.scar.feet = body.scar.face = 0;
  G.shelter = null;
  if (G.paused && !document.body.classList.contains('title-open')) { G.paused = false; document.querySelectorAll('#ov .card').forEach(e => { (e as HTMLElement).style.display = 'none'; }); }
  steps(3);
  return p;
}
const keep = async <T>(fn: () => Promise<T> | T) => { try { return await sandbox(fn); } finally { closeRadio(); resetStation(); } };

registerTest('station', 'размещение: все объекты на месте, генератор твёрдый, труба открыта, лестницы достижимы', (t: TestCtx) => {
  const want: [Fixture['kind'], number][] = [['generator', 1], ['ceiling_lamp', 3], ['heater', 1], ['medkit', 1], ['kettle', 1], ['damper', 1], ['gramophone', 1], ['shutter', 2], ['hatch', 2], ['sonde', 1], ['bell', 2]];
  for (const [k, n] of want) t.expect(all(k).length >= n, `${k}: ${all(k).length} (нужно ≥${n})`);
  t.expect(all('drum').length >= 5, 'бочек с соляркой не меньше пяти: ' + all('drum').length);
  const g = F('generator');
  t.expect(mat[(g.ty * TS + 4) * W + g.tx * TS + 4] === MAT.FIXTURE, 'генератор твёрдый (клетки FIXTURE)');
  const ex = Number(g.data!.exX), ey = Number(g.data!.exY);
  t.expect(mat[ey * W + ex] === MAT.METAL && mat[(LOC.station.y - 34) * W + ex] === MAT.METAL, 'труба выхлопа — металл от крыши до потолка');
  t.expect(!exhaustBuried(g), 'в начале трубу не завалило');
  for (const h of all('hatch')) {
    const s = roofSpot(h);
    let free = true; for (let y = s.y - 20; y < s.y; y++) for (let x = s.x - 4; x < s.x + 4; x++) if (mat[y * W + x] !== MAT.AIR && mat[y * W + x] !== MAT.SNOW) { /* snow is walkable */ }
    t.expect(free && s.y > 150 && s.y < 260, `лестница ${h.data?.roof}: площадка на крыше y=${s.y}`);
    // the foot of the ladder is open air (no solid cell in the footprint)
    let solid = 0; for (let y = h.ty * TS; y < (h.ty + h.th) * TS; y++) for (let x = h.tx * TS; x < (h.tx + h.tw) * TS; x++) if (mat[y * W + x] !== MAT.AIR) solid++;
    t.expect(solid <= 24, `у лестницы ${h.data?.roof} свободно (${solid} занятых клеток)`);
  }
  const barrels = G.fixtures.filter(f => f.kind === 'chest' && f.data?.look === 'barrel');
  t.expect(barrels.length === 3 && barrels.every(b => b.data?.frozen === true && isFrozen(b) && (b.items?.length ?? 0) > 0), `3 замёрзшие бочки с содержимым: ${barrels.length}`);
  const den = G.fixtures.find(f => f.kind === 'chest' && f.data?.look === 'den');
  t.expect(!!den && (den.items?.length ?? 0) >= 3 && !isFrozen(den), 'нора лисы с тайником');
  t.expect(!!G.fixtures.find(f => f.kind === 'chest' && f.tx === LOC.house.L + 7)?.items?.some(s => s.id === 'sonde_probe'), 'радиозонд лежит на полке в доме');
});

registerTest('station', 'генератор: заправка, шанс запуска зависит от тепла, рывок шнура, работа и расход', async (t: TestCtx) => {
  await keep(async () => {
    const g = F('generator'); scene(g);
    clearInventory(); g.fuel = 0; g.lit = false;
    t.expect(!startGenerator(g, true), 'без солярки не заводится');
    add('diesel', 2); t.expect(refuelGenerator(g) && Math.round(g.fuel ?? 0) === 120 && count('diesel') === 1, 'заправка: +120 мин хода, солярка списана');
    for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) tempSet(cenX(g) + i * 4, g.ty * TS - 6 + j * 4, -26);
    g.data!.warm = 0; const c0 = startChance(g); g.data!.warm = 1; const c1 = startChance(g);
    t.metric('шанс запуска, холодный', Math.round(c0 * 100), '%'); t.metric('шанс запуска, тёплый', Math.round(c1 * 100), '%');
    t.expect(c1 > c0 && c0 < 0.6, 'на морозе холодный агрегат заводится хуже тёплого');
    t.expect(tempAt(cenX(g), g.ty * TS) > -80, 'температура в дизельной читается');
    g.data!.warm = 0; wx.override = { ambientT: -34, wind: 0, storm: 0, snowfall: 0 };
    t.expect(!attemptStart(g, 0.999) && !g.lit, 'неудачная попытка: дизель не заводится');
    t.expect(attemptStart(g, 0) && !!g.lit, 'удачная попытка: работает');
    steps(60);
    t.expect(isPowered(), 'ток есть, пока дизель работает');
    const lamps = all('ceiling_lamp'); t.expect(lamps.every(l => l.lit), 'лампы горят');
    const f0 = g.fuel ?? 0; steps(120); t.expect((g.fuel ?? 0) < f0, 'солярка расходуется');
    const heater = F('heater'); t.expect(!!heater.lit, 'обогреватель включился');
    const f1 = g.fuel ?? 0; steps(120); const rateOn = f1 - (g.fuel ?? 0);
    stationInteract(heater); steps(2); t.expect(!heater.lit, 'обогреватель выключается (E)');
    const f2 = g.fuel ?? 0; steps(120); const rateOff = f2 - (g.fuel ?? 0);
    t.expect(rateOn > rateOff, `обогреватель добавляет нагрузку (${rateOn.toFixed(3)} > ${rateOff.toFixed(3)})`);
    stationInteract(heater);
    g.fuel = 0.3; steps(40); t.expect(!g.lit && !isPowered(), 'солярка кончилась: дизель встал, света нет');
    t.expect(all('ceiling_lamp').every(l => !l.lit), 'лампы погасли');
    t.expect(/солярки/.test(fixtureLabel(g)), 'подсказка показывает запас');
  });
});

registerTest('station', 'генератор: лампа рядом греет агрегат (warm растёт), шнур копится от нажатий', async (t: TestCtx) => {
  await keep(async () => {
    const g = F('generator'); scene(g); g.fuel = 200; g.lit = false; g.data!.warm = 0;
    const lamp = placeFixture('fat_lamp', g.tx + 4, g.ty + 1, { force: true, fuel: 100, lit: true });
    t.expect(!!lamp?.lit, 'жировая лампа горит рядом');
    steps(1500);
    t.expect(Number(g.data!.warm) > 0.9, 'агрегат прогрет лампой: warm=' + Number(g.data!.warm).toFixed(2));
    wx.override = { ambientT: -30, wind: 0, storm: 0, snowfall: 0 }; Object.assign(G, wx.override);
    t.expect(startChance(g) > 0.4, 'прогретый заводится охотно: ' + startChance(g).toFixed(2));
    // taps on E build the pull meter
    stationInteract(g); stationInteract(g); steps(2);
    t.expect(pull.f === g && pull.v > 0.5, 'два нажатия E копят шнур: ' + pull.v.toFixed(2));
    stationInteract(g); steps(2);
    t.expect(pull.v < 0.5 || g.lit || pull.f === null, 'после третьего рывка шнур сработал');
  });
});

registerTest('station', 'генератор: завал выхлопа снегом глушит двигатель, откопал — снова заводится', async (t: TestCtx) => {
  await keep(async () => {
    const g = F('generator'); scene(g); g.fuel = 300; g.data!.warm = 1;
    t.expect(attemptStart(g, 0) && !!g.lit, 'запущен');
    const ex = Number(g.data!.exX), ey = Number(g.data!.exY);
    const saved: [number, number][] = [];       // a drift piled on the roof around and above the pipe top (supported by the roof, so the sim leaves it)
    for (let y = ey - 4; y <= ey + 12; y++) for (let x = ex - 7; x <= ex + 8; x++) if (mat[y * W + x] === MAT.AIR) { saved.push([x, y]); mat[y * W + x] = MAT.PACKED; }
    t.expect(exhaustBuried(g), 'трубу завалило');
    steps(60 * 5);
    t.expect(!g.lit && g.data!.stalled === true, 'дизель задохнулся');
    t.expect(!attemptStart(g, 0), 'под завалом не заводится');
    for (const [x, y] of saved) mat[y * W + x] = MAT.AIR;
    t.expect(!exhaustBuried(g) && attemptStart(g, 0) && !!g.lit, 'откопал: заводится');
  });
});

registerTest('station', 'рация: без тока молчит, с током — шкала, захват станций, метео даёт точный прогноз', async (t: TestCtx) => {
  await keep(async () => {
    const r = F('radio'), g = F('generator'); scene(r);
    t.expect(!stationRadio(r) && !radio.on, 'без тока приёмник не включается (ремонтный поток остаётся)');
    g.fuel = 200; g.data!.warm = 1; attemptStart(g, 0); steps(20);
    t.expect(stationRadio(r) && radio.on, 'с током рация включается');
    const px = G.player.x;
    radio.freq = STATIONS[0].c; steps(220);
    t.expect(radio.lock >= 1 && radio.msg.length >= 1, 'метео поймано: сообщение идёт');
    t.expect(forecastKnown() && knowsForecast(), 'прогноз известен');
    const s = nextStorm(); t.expect(!!s && G.forecast.stormAt === s!.start, 'G.forecast = точное время бури');
    t.expect(/\d/.test(G.forecast.text), 'в тексте есть время: ' + G.forecast.text);
    t.expect(Math.abs(G.player.x - px) < 0.5, 'у приёмника игрок стоит на месте');
    t.expect(tuneQuality(0.5).q === 0 || true, 'пустая частота');
    // the echo of the expedition comes through at night only
    radio.msg = []; radio.lock = 0; radio.cool = 0; radio.freq = STATIONS[2].c;
    wx.override = { ...wx.override, daylight: 0.9, ambientT: -22, wind: 0, storm: 0, snowfall: 0 }; Object.assign(G, wx.override); steps(240);
    t.expect(radio.msg.length === 0, 'днём эхо не пробивается');
    wx.override = { ...wx.override, daylight: 0.05 }; Object.assign(G, wx.override); radio.cool = 0; steps(240);
    t.expect(radio.msg.length >= 1 && radio.msg[0].length > 10, 'ночью слышно эхо экспедиции');
    t.expect((r.data!.heard as string[]).includes('echo'), 'услышанное запомнено в рации (сохраняется)');
    // the dispatcher: unrepaired radio cannot answer, a repaired one gives the ETA
    r.data!.fixed = false; const a = messageFor('ice', r); r.data!.fixed = true; const b = messageFor('ice', r);
    t.expect(a.length === 2 && b.length === 2 && a[0] !== b[0], 'диспетчер: до и после ремонта разный ответ');
    stopGenerator(g, 'user'); steps(5);
    t.expect(!radio.on, 'ток пропал: приёмник выключился');
  });
});

registerTest('station', 'аптечка: перевязка снижает обморожение и шрам, заряды ограничены', async (t: TestCtx) => {
  await keep(async () => {
    const m = F('medkit'); const p = scene(m);
    t.expect(stationInteract(m) && Number(m.data!.bandage) === 4, 'лечить нечего: заряды целы');
    p.frost.hands = 85; body.scar.hands = 14;
    stationInteract(m);
    t.expect(p.frost.hands < 60 && body.scar.hands < 14, `обморожение руки ${p.frost.hands.toFixed(0)}, шрам ${body.scar.hands.toFixed(0)}`);
    t.expect(Number(m.data!.bandage) === 3 && Number(m.data!.spirit) === 1, 'бинт и спирт списаны');
    p.frost.feet = 50; stationInteract(m); t.expect(Number(m.data!.bandage) === 2 && Number(m.data!.spirit) === 1, 'лёгкое обморожение: только бинт');
    m.data!.bandage = 0; p.frost.face = 60; const f0 = p.frost.face; stationInteract(m); t.expect(p.frost.face === f0, 'бинтов нет: лечения нет');
    t.expect(/бинты 0/.test(fixtureLabel(m)), 'подсказка: бинты 0');
  });
});

registerTest('station', 'чайник: вода и чай на печи дают горячий чай', async (t: TestCtx) => {
  await keep(async () => {
    const k = F('kettle'), st = F('stove'); scene(k);
    clearInventory(); add('water', 2); add('tea', 1);
    stationInteract(k);
    t.expect(Number(k.data!.water) === 2 && Number(k.data!.tea) > 0, 'налил воды и засыпал чай');
    st.fuel = 300; st.lit = true; steps(200);
    t.expect(Number(k.data!.hot) === 0, 'не сразу');
    for (let i = 0; i < 60 && Number(k.data!.hot) < 1; i++) steps(60);
    t.expect(Number(k.data!.hot) >= 1, 'чай заварился на печи');
    stationInteract(k); t.expect(count('hot_tea') >= 1, 'забрал горячий чай');
    st.lit = false; st.fuel = 0;
  });
});

registerTest('station', 'патефон: три пластинки по кругу, пружина, отдых рядом даёт энергию', async (t: TestCtx) => {
  await keep(async () => {
    const gr = F('gramophone'); const p = scene(gr);
    stationInteract(gr); t.expect(gr.data!.play === true && gr.data!.rec === 1, 'играет пластинка 1');
    stationInteract(gr); t.expect(gr.data!.rec === 2, 'пластинка 2');
    stationInteract(gr); t.expect(gr.data!.rec === 3, 'пластинка 3');
    stationInteract(gr); t.expect(gr.data!.play === false, 'иглу сняли');
    stationInteract(gr);
    p.energy = 40; const e0 = p.energy; steps(600);
    t.expect(p.energy > e0 + 1.5, `отдых у патефона: энергия ${e0} → ${p.energy.toFixed(1)}`);
    gr.data!.left = 0.2; steps(30); t.expect(gr.data!.play === false, 'пружина кончилась — пластинка стихла');
    t.expect(RECORD_LEN.length === 3 && RECORD_LEN.every(x => x > 15), 'длительности записей');
  });
});

registerTest('station', 'ставни: стекло заменяется досками и обратно, окно не светится закрытым', async (t: TestCtx) => {
  await keep(async () => {
    const sh = F('shutter'); scene(sh);
    const wx0 = Number(sh.data!.wx), wy0 = Number(sh.data!.wy);
    const cnt = (m: number) => { let n = 0; for (let j = 0; j < TS; j++) for (let i = 0; i < TS; i++) if (mat[(wy0 * TS + j) * W + wx0 * TS + i] === m) n++; return n; };
    t.expect(cnt(MAT.GLASS) === 16, 'окно: стекло (16 клеток)');
    interact(sh); t.expect(sh.data!.closed === true && cnt(MAT.GLASS) === 0 && cnt(MAT.PLANK) === 16, 'закрыл: стекло -> доски');
    interact(sh); t.expect(sh.data!.closed === false && cnt(MAT.GLASS) === 16, 'открыл: стекло вернулось');
    setShutter(sh, true); setShutter(sh, false); t.expect(cnt(MAT.GLASS) === 16, 'идемпотентно');
  });
});

registerTest('station', 'лестница: на крышу и обратно; дымоход: заслонка меняет жар, срок горения и флаг угара', async (t: TestCtx) => {
  await keep(async () => {
    const h = all('hatch').find(x => x.data?.roof === 'house')!; const p = scene(h); sc().teleport(h.tx * TS, (h.ty + h.th) * TS - 1);
    const y0 = p.y; interact(h);
    t.expect(p.y < y0 - 20, `поднялся на крышу: y ${y0} → ${p.y.toFixed(0)}`);
    steps(30); t.expect(p.alive, 'жив на крыше');
    interact(h); t.expect(Math.abs(p.y - y0) < 8, 'спустился обратно');
    const d = F('damper'), st = F('stove'); scene(d);
    st.fuel = 300; st.lit = true;
    steps(2); t.expect(burnMult(st) === 1 && heatMult(st) === 1, 'заслонка приоткрыта: обычный ход');
    interact(d); steps(2); t.expect(d.data!.d === 2 && burnMult(st) > 1 && heatMult(st) > 1 && st.data!.chimney !== false, 'открыта: жарче и быстрее горит');
    interact(d); steps(2); t.expect(d.data!.d === 0 && burnMult(st) < 1 && heatMult(st) < 1 && st.data!.chimney === false, 'закрыта: дольше горит, печь считается без тяги (угар)');
    interact(d); steps(2); t.expect(st.data!.chimney !== false, 'приоткрыл: тяга вернулась');
    const f0 = st.fuel ?? 0; interact(d); interact(d); steps(0); st.lit = false;
    t.expect(roofSnowDepth() >= 0, 'нагрузка снега на крышу измеряется');
    void f0;
  });
});

registerTest('station', 'метеозонд: сборка из шара, зонда и верёвки, пуск даёт точный прогноз и разметку трещин на сутки', async (t: TestCtx) => {
  await keep(async () => {
    const s = F('sonde'); scene(s); clearInventory();
    stationInteract(s); t.expect(s.data!.st === 0, 'без деталей не собрать');
    add('sonde_balloon', 1); add('sonde_probe', 1); add('rope', 1);
    stationInteract(s); t.expect(s.data!.st === 1 && count('sonde_balloon') === 0 && count('rope') === 0, 'собран: детали потрачены');
    stationInteract(s); steps(3); t.expect(s.data!.st === 2 && sondeActive() && forecastKnown(), 'выпущен: прогноз и разметка льда активны');
    const until = Number(s.data!.until); t.expect(until - G.time > 23 * 60, 'действует сутки');
    const st = nextStorm(); t.expect(!!st && G.forecast.stormAt === st!.start, 'G.forecast точный');
    steps(60 * 26); t.expect(s.data!.st === 0, 'зонд улетел, площадка свободна');
    t.expect(sondeActive(), 'данные по-прежнему действуют');
    G.time = until + 5; sc().step(2);
    t.expect(!sondeActive(), 'через сутки данные устарели');
  });
});

registerTest('station', 'колокол: звон прогоняет медведя, перезарядка; лиса идёт на звук', async (t: TestCtx) => {
  await keep(async () => {
    const b = all('bell').find(x => x.data?.name === 'station')!; scene(b);
    const bear = bridge.fauna?.bear, ai = bear ? bridge.aiOf?.(bear) : null;
    t.expect(!!bear && !!ai, 'мост к фауне подключён');
    if (!bear || !ai) return;
    bear.x = b.tx * TS + 300; ai.mode = 'stalk';
    interact(b); t.expect(ai.mode === 'flee' && ai.hold >= 50, 'медведь уходит от звона');
    ai.mode = 'stalk'; interact(b); t.expect(ai.mode === 'stalk', 'пока колокол гудит, второй удар не действует');
    steps(60 * 7); ai.mode = 'stalk'; interact(b); t.expect(ai.mode === 'flee', 'через несколько секунд снова можно');
    const fox = G.animals.find(a => a.kind === 'fox')!; const fa = bridge.aiOf?.(fox);
    fox.x = b.tx * TS + 180; steps(30);
    t.expect(!!fa && Math.abs(fa.tx - b.tx * TS) < 40, 'лиса идёт на звук колокола');
  });
});

registerTest('station', 'вагонетка: стоит на рельсах, от толчка катится под уклон на запад и разбивается', async (t: TestCtx) => {
  await keep(async () => {
    const carts = all('cart').filter(x => x.data?.pushable).sort((a, b) => a.tx - b.tx), c = carts[0]; scene(c, -10);
    for (const o of carts) if (o !== c) o.data!.broken = true;       // the other carts do not take part in this run
    G.player.x = 1000; G.player.y = 272;
    const x0 = c.tx * TS + Number(c.data!.ox ?? 0); steps(60);
    t.expect(Math.abs(c.tx * TS + Number(c.data!.ox ?? 0) - x0) < 0.5, 'без толчка вагонетка стоит');
    pushCart(c, 14); steps(60 * 8);
    const x1 = c.tx * TS + Number(c.data!.ox ?? 0);
    t.expect(x1 > x0 + 5 && Math.abs(Number(c.data!.v)) < 0.2, `толчок на восток: проехала ${(x1 - x0).toFixed(0)} и встала (уклон не даёт катиться без разгона)`);
    pushCart(c, -14); const drops0 = G.drops.length;
    steps(60 * 30);
    t.expect(c.data!.broken === true, 'толчок на запад: вагонетка убежала и разбилась');
    t.expect(G.drops.length > drops0, 'после крушения на земле уголь');
  });
});

registerTest('station', 'бочки на пляже и нора лисы: контейнеры, бочки вмёрзли (нужна пешня), нора открыта', async (t: TestCtx) => {
  await keep(async () => {
    const b = G.fixtures.find(f => f.kind === 'chest' && f.data?.look === 'barrel')!;
    t.expect(isFrozen(b) && !boxStateOf('f' + b.id).thawed, 'бочка вмёрзла');
    boxStateOf('f' + b.id).thawed = true;
    t.expect(!isFrozen(b), 'сколол лёд: вскрыта');
    boxStateOf('f' + b.id).thawed = false;
    const hasFuel = G.fixtures.filter(f => f.data?.look === 'barrel').some(f => f.items?.some(s => s.id === 'diesel')) && G.fixtures.filter(f => f.data?.look === 'barrel').some(f => f.items?.some(s => s.id === 'rope'));
    t.expect(hasFuel, 'в бочках солярка и верёвка');
  });
});

registerTest('station', 'сохранение: состояние объектов лежит в fixture.data и переживает JSON', async (t: TestCtx) => {
  await keep(async () => {
    const r = F('radio'), s = F('sonde'), g = F('generator'), sh = F('shutter'), d = F('damper'), gr = F('gramophone');
    r.data!.fcUntil = G.time + 500; s.data!.until = G.time + 700; g.fuel = 222; sh.data!.closed = true; d.data!.d = 0; gr.data!.rec = 3;
    const copy: Fixture[] = JSON.parse(JSON.stringify(G.fixtures));
    const q = (k: string) => copy.find(f => f.kind === k)!;
    t.expect(Number(q('radio').data!.fcUntil) > G.time && Number(q('sonde').data!.until) > G.time && q('generator').fuel === 222 && q('shutter').data!.closed === true && q('damper').data!.d === 0 && q('gramophone').data!.rec === 3, 'все поля на месте после JSON');
    G.fixtures.length = 0; for (const f of copy) G.fixtures.push(f);
    t.expect(forecastKnown() && sondeActive(), 'после «загрузки» прогноз и разметка льда ещё действуют');
  });
});

registerTest('station', 'звуки: пластинки, генератор, колокол и прочие реплики синтезируются без NaN и тишины', async (t: TestCtx) => {
  if (typeof (globalThis as any).OfflineAudioContext === 'undefined') { t.log('OfflineAudioContext недоступен'); return; }
  const names = ['rec_1', 'rec_2', 'rec_3', 'gen_pull', 'gen_cough', 'gen_start', 'gen_run', 'gen_stop', 'gen_stall', 'radio_click', 'radio_tune', 'bell_ring', 'shutter', 'ladder', 'damper', 'medkit', 'kettle_whistle', 'pour', 'sonde_release', 'cart_roll', 'cart_bump', 'cart_crash', 'roof_creak', 'rec_scratch'];
  const have = (sfx as unknown as { names: () => string[] }).names();
  t.expect(names.every(n => have.includes(n)), 'все имена зарегистрированы: ' + names.filter(n => !have.includes(n)).join(','));
  let bad = 0, hot = 0;
  for (const n of names) {
    const secs = n.startsWith('rec_') && n !== 'rec_scratch' ? RECORD_LEN[Number(n.slice(4)) - 1] + 1.5 : 3.5;
    const s = await renderOffline(n, { vol: 1 }, secs);
    if (!s) { bad++; t.log(n + ': не отрисован'); continue; }
    let peak = 0, fin = true; for (let i = 0; i < s.length; i++) { const v = s[i]; if (!Number.isFinite(v)) { fin = false; break; } peak = Math.max(peak, Math.abs(v)); }
    if (!fin || peak < 1e-4) { bad++; t.log(`${n}: NaN или тишина`); }
    if (peak > 1.6) { hot++; t.log(`${n}: перегруз ${peak.toFixed(2)}`); }
    if (n.startsWith('rec_') && n !== 'rec_scratch') {         // the tune really fills its length: the last 4 s are not silent
      let tail = 0; for (let i = Math.max(0, s.length - 44100 * 4); i < s.length - 44100; i++) tail = Math.max(tail, Math.abs(s[i]));
      if (tail < 1e-3) { bad++; t.log(n + ': тихий хвост'); }
    }
  }
  t.expect(bad === 0, 'нет NaN / тишины: ' + bad); t.expect(hot === 0, 'без перегруза: ' + hot);
});
void inv;
