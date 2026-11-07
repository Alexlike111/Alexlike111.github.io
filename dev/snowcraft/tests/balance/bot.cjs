// SNOWCRAFT balance bot (DESIGN §18, endless sandbox). Plays one run per process, time-compressed, with a fixed routine that models
// a reasonable novice who follows the goals. One line per game day goes to stdout, the run result as a `RES {json}` line.
//
//   node tests/balance/bot.cjs <abs index.html> --diff 1 --seed 1 [--days 40] [--chunk 10]       one run, day table on stdout
//   node tests/balance/bot.cjs <abs index.html> --matrix [--diffs 0,1,2] [--seeds 1,2] [--par 3] [--out <dir>]   the 3 x 2 matrix, summary on stdout
//
// Page side (installBot): everything runs inside the game page with window.__sc (src/main.ts) and the modules it exposes in __sc.mods.
// The page has NO requestAnimationFrame loop (the init script stubs it), so the game only advances when the bot steps it: sc.stepFast(n).
// One frame = 1/60 s of body time = 0.04 game minutes (G.timeScale 1); the bed sleep uses the game's own x20 warp.
// Model assumptions (the weakest part, see tests/balance/README.md): walking is charged as time at the destination, supplies that the
// world does not give in a fixed place (driftwood, fish) come from explicit rates, the chests are looted without the search delay.
const path = require('path');
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const { spawn } = require('child_process');
const fs = require('fs');

const DEFAULTS = {
  days: 40, chunk: 10,                       // game minutes per decision cycle
  walkMinPerCell: 0.0889,                    // TUNE.walk = 27 cells per body second = 27 cells per real second = 0.0889 game minutes per cell (2.4 game min per s)
  lootMin: 1.5,                              // game minutes per looted stack (search delay, rough)
  snowMin: 4, snowPerTrip: 4,                // MODEL: shovelling snow near the house for the pot
  cookMin: 5,                                // at the stove, per raw item
  eatAt: 40, drinkAt: 40, sleepAt: 30,       // thresholds from the task brief
  stoveFeedBelow: 240, stoveFillTo: 420,     // minutes of stove burn
  fuelReserveH: 24, tripCooldownMin: 360,    // fuel stock target (stove + pack) in hours
  foodReservePts: 60,                        // food points carried (about two days) below this -> food trip (the pack, not the chests: the bot must carry it)
  stormSkipMin: 90,                          // no trips when a storm is forecast within 90 min
  logStockPerRing: 24, logsPerTrip: 6, logMin: 12,   // MODEL driftwood: 24 logs per ring, 12 game min per log
  fishTripMin: 60, fishMin: 30,              // MODEL fishing at the hole: 1 fish per 30 game min while standing there
  hardcore: false,
};

// ---------------------------------------------------------------------------------------------------------------------------------
// page side: installed once per run with page.evaluate(installBot, cfg). Self-contained (no Node references).
function installBot(cfg) {
  const sc = window.__sc, G = sc.G, M = sc.mods;
  const FX = M.fixtures, INV = M.inv, PL = M.player, Q = M.quest, SE = M.seasons;
  const B = {
    cfg, outbox: [], dead: false, finished: false, inStorm: false, survived: 0, stormsStarted: 0, sleeps: 0, sleepRefused: 0, slept: 0,
    trips: { fuel: 0, food: 0 }, lastFuelTrip: -1e9, lastFoodTrip: -1e9, logStock: cfg.logStockPerRing, logRing: -1,
    fedN: 0, drankN: 0, ateN: 0, cookN: 0, chain: {}, ids: {}, cur: null, death: null, errors: [], lastMaint: -1e9, inMaint: false,
  };
  const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
  const fx = id => G.fixtures.find(f => f.id === id) || null;
  const bySpot = (kind, pred) => G.fixtures.find(f => f.kind === kind && pred(f)) || null;
  const center = f => [f.tx * 4 + f.tw * 2, f.ty * 4 + f.th * 2];
  const floorSpot = f => [f.tx * 4 + f.tw * 2, (f.ty + f.th) * 4 - 2];
  const alive = () => G.player.alive;

  // ---- setup: find the station objects by their place in the world (the house around the stove at tile x 166) ----
  function setup() {
    const stove = bySpot('stove', f => f.tx >= 140 && f.tx <= 200);
    const bed = bySpot('bed', f => f.tx >= 140 && f.tx <= 200);
    const damper = bySpot('damper', f => f.tx >= 140 && f.tx <= 200);
    const baro = bySpot('barometer', f => f.tx >= 140 && f.tx <= 200);
    const houseChest = bySpot('chest', f => f.tx === 159);
    const shedChest = bySpot('chest', f => f.tx === 204);
    B.ids = { stove: stove.id, bed: bed.id, damper: damper.id, baro: baro.id, houseChest: houseChest.id, shedChest: shedChest.id };
    B.house = [stove.tx * 4 + 8, 270];
    B.bedSpot = [bed.tx * 4 + 4, 270];
    B.baroSpot = [baro.tx * 4 - 6, 270];
    B.chestIds = G.fixtures.filter(f => f.kind === 'chest' || f.kind === 'cache').map(f => f.id);
    B.cartIds = G.fixtures.filter(f => f.kind === 'cart').map(f => f.id);
    B.hole = [G.player.x, G.player.y];        // MODEL: the fishing hole is the spawn point on the sea ice
    B.beach = [G.player.x, G.player.y];       // MODEL: driftwood is collected at the spawn beach (exposure only; the logs come from logStock)
  }
  const stoveObj = () => fx(B.ids.stove);
  const potObj = () => (B.ids.pot ? fx(B.ids.pot) : null);
  const invFuelMin = () => INV.count('coal') * 240 + INV.count('log') * 120 + INV.count('plank') * 60;
  const totalFuelH = () => ((stoveObj().fuel || 0) + invFuelMin()) / 60;
  const slotOf = pred => INV.find(pred);

  // ---- clock: the only place where game time moves (stepFast = no render, no rAF) ----
  function track() {
    const p = G.player, c = B.cur;
    if (!c) return;
    if (G.day !== c.day) endDay(false);
    const cc = B.cur;
    cc.core = Math.min(cc.core, p.core); cc.food = Math.min(cc.food, p.food); cc.water = Math.min(cc.water, p.water);
    cc.energy = Math.min(cc.energy, p.energy); cc.hp = Math.min(cc.hp, p.hp);
    cc.fH = Math.max(cc.fH, p.frost.hands); cc.fF = Math.max(cc.fF, p.frost.feet); cc.fFace = Math.max(cc.fFace, p.frost.face);
    if (G.storm > 0.3 && !B.inStorm) { B.inStorm = true; B.stormsStarted++; }
    if (G.storm < 0.3 && B.inStorm) { B.inStorm = false; if (p.alive) B.survived++; }
    if (!p.alive && !B.dead) { B.dead = true; B.death = { day: G.day, days: round((G.time - 660) / 1440, 2), cause: p.cause }; endDay(true); }
  }
  function newDay() {
    const p = G.player;
    B.cur = { day: G.day, ring: G.cycle, phase: SE.phaseOfDay(G.day), core: p.core, food: p.food, water: p.water, energy: p.energy, hp: p.hp,
      fH: p.frost.hands, fF: p.frost.feet, fFace: p.frost.face, slept: 0 };
  }
  function endDay(final) {
    const c = B.cur; if (!c) return;
    const p = G.player, s = stoveObj();
    B.outbox.push({ day: c.day, ring: c.ring, phase: c.phase, coreMin: round(c.core), fH: round(c.fH, 0), fF: round(c.fF, 0), fFace: round(c.fFace, 0),
      foodMin: round(c.food, 0), waterMin: round(c.water, 0), energyMin: round(c.energy, 0), hpMin: round(c.hp, 0),
      stoveH: round((s.fuel || 0) / 60), fuelH: round(totalFuelH()), foodDays: round(Q.suppliesNow().foodDays), slept: round(c.slept),
      storms: B.survived, stormsStarted: B.stormsStarted, trips: B.trips.fuel + B.trips.food, alive: p.alive, cause: p.alive ? '' : p.cause, final: !!final,
      t: round((G.time - 660) / 1440, 2) });
    if (!final) newDay();
  }

  // ---- stepping ----
  function stepMin(m) {
    const t1 = G.time + m; let guard = 0;
    while (G.time < t1 && alive() && guard++ < 200000) {
      sc.stepFast(G.timeScale > 1 ? 5 : 10); track();
      if (G.timeScale <= 1 && G.time - B.lastMaint >= 30) maintainStove(cfg.stoveFeedBelow);
    }
  }
  function go(x, y) {                       // teleport = walking. The walk time is charged BEFORE the jump, at the origin: a walking body makes
    const p = G.player; const d = Math.hypot(p.x - x, p.y - y);   // heat (the game's metabolism), so it is not charged as standing in the cold
    if (!alive()) return;
    if (d > 0) stepMin(d * cfg.walkMinPerCell);
    if (!alive()) return;
    sc.teleport(x, y); sc.stepFast(2); track();
  }
  const goHouse = () => { if (alive()) go(B.house[0], B.house[1]); };
  function visitNearest(list) {
    const rest = list.slice();
    while (rest.length && alive()) {
      const p = G.player;
      rest.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
      const t = rest.shift(); go(t.x, t.y); if (alive()) t.fn();
    }
  }
  // container: the contents move into the pack (search delay charged per stack; hidden items are not modelled)
  function lootChest(f, pred) {
    if (!f) return 0;
    if (f.kind === 'cart' && f.data && f.data.loaded) { f.items = f.items || []; f.items.push({ id: String(f.data.loaded), n: 4 }); f.data.loaded = ''; }
    if (!f.items || !f.items.length) return 0;
    let got = 0, looted = 0;
    for (let i = f.items.length - 1; i >= 0; i--) {
      const s = f.items[i]; if (!pred(s.id)) continue;
      const left = INV.add(s.id, s.n, s.dur);
      got += s.n - left; looted++;
      if (left <= 0) f.items.splice(i, 1); else s.n = left;
    }
    if (looted) stepMin(cfg.lootMin * looted);
    return got;
  }
  const FOOD = ['cooked_meat', 'fish_cooked', 'can', 'biscuit', 'fat', 'ptarmigan', 'fish', 'seal_meat'];
  const FOODPTS = { cooked_meat: 32, fish_cooked: 22, can: 30, biscuit: 12, fat: 14, ptarmigan: 12, fish: 10, seal_meat: 16 };
  const isFood = id => FOOD.includes(id);
  const isFuel = id => id === 'coal' || id === 'log' || id === 'plank';

  // ---- the day-1 onboarding chain (coal, stove, barometer, keeper's log); the door is not dug (we walk in) and no igloo is built ----
  function chain() {
    B.chain.start = true;
    const coal = G.drops.filter(d => d.item === 'coal').sort((a, b) => Math.hypot(a.x - G.player.x, a.y - G.player.y) - Math.hypot(b.x - G.player.x, b.y - G.player.y))[0];
    if (coal) { go(coal.x, coal.y - 2); B.chain.coal = INV.count('coal') > 0; }
    const shed = fx(B.ids.shedChest); if (shed) { go(...floorSpot(shed)); lootChest(shed, isFuel); }
    goHouse(); maintainStove(); B.chain.stove = !!stoveObj().lit;
    const baro = fx(B.ids.baro); if (baro) { go(B.baroSpot[0], B.baroSpot[1]); FX.interact(baro); B.chain.baro = true; }
    const hc = fx(B.ids.houseChest); if (hc) { go(...floorSpot(hc)); lootChest(hc, id => id.startsWith('note_') || id === 'matches'); }
    for (let guard = 0; guard < 10; guard++) {                 // the keeper's log and the other notes are read at once
      const i = INV.find(s => s.id.startsWith('note_')); if (i < 0) break;
      const id = M.inv.inv.slots[i].id; INV.remove(id, 1); Q.readNote(id.slice(5)); B.chain.notes = (B.chain.notes || 0) + 1;
    }
    goHouse();
  }

  // ---- routine pieces ----
  function maintainStove(below = cfg.stoveFeedBelow) {
    const s = stoveObj(); if (!s || B.inMaint) return;
    B.inMaint = true; B.lastMaint = G.time;
    if ((s.fuel || 0) < below) {
      for (const id of ['coal', 'log', 'plank']) {
        let guard = 0;
        while (INV.count(id) > 0 && (s.fuel || 0) < (below > cfg.stoveFeedBelow ? 540 : cfg.stoveFillTo) && guard++ < 20) { if (!FX.addFuel(s, id)) break; B.fedN++; }
      }
    }
    if (!s.lit && (s.fuel || 0) > 0) {
      if (INV.count('matches') === 0) { const hc = fx(B.ids.houseChest); if (hc) lootChest(hc, id => id === 'matches'); }
      FX.tryLight(s, true);
    }
    B.inMaint = false;
  }
  // the damper stays half open. A closed damper lets CO build up in the sealed house (measured: 0.6 -> 3.1 in 6 game min, no decay);
  // a novice who closes it to save fuel dies of CO. Open (2) when the shelter reports CO, back to half when it clears.
  function damperPolicy() {
    const dmp = fx(B.ids.damper); if (!dmp) return;
    const co = G.shelter ? G.shelter.co : 0;
    const want = co > 5 || G.player.co > 2 ? 2 : 1;
    let k = 0; while (((dmp.data && dmp.data.d) ?? 1) !== want && k++ < 3) FX.interact(dmp);
  }
  const foodInPack = () => { let n = 0; for (const id of FOOD) n += INV.count(id) * FOODPTS[id]; return n; };
  const COOK = { fish: 'fish_cooked', ptarmigan: 'cooked_meat', seal_meat: 'cooked_meat' };
  function cookRaw() {
    const s = stoveObj(); if (!s || !s.lit) return;
    for (const raw of Object.keys(COOK)) if (INV.count(raw) > 0) { INV.remove(raw, 1); INV.add(COOK[raw], 1); B.cookN++; stepMin(cfg.cookMin); return; }
  }
  function meltWater() {
    let pot = potObj();
    if (!pot) {
      const s = stoveObj(); if (!s) return;
      pot = FX.placeFixture('pot', s.tx, s.ty, { force: true });
      if (!pot) return;
      B.ids.pot = pot.id;
    }
    const d = pot.data || (pot.data = {});
    if ((d.water || 0) > 0) {                                  // take the melted water out (interactPot without snow in hand)
      const sel = INV.selected();
      if (sel && (sel.id === 'snow' || sel.id === 'ice')) { const k = INV.find(s => s.id !== 'snow' && s.id !== 'ice'); if (k >= 0) sc.select(k); }
      FX.interact(pot);
    }
    if (INV.count('snow') < 2) { INV.add('snow', cfg.snowPerTrip); stepMin(cfg.snowMin); }   // MODEL: shovelled snow
    let guard = 0;
    while ((d.snow || 0) + (d.ice || 0) < 6 && INV.count('snow') > 0 && guard++ < 10) { sc.selectItem('snow'); FX.interact(pot); }
  }
  function drink() {
    let i = slotOf(s => s.id === 'water' || s.id === 'hot_tea');
    if (i >= 0 && PL.eatSlot(i)) { B.drankN++; return true; }
    meltWater();
    i = slotOf(s => s.id === 'water');
    if (i >= 0 && PL.eatSlot(i)) { B.drankN++; return true; }
    return false;
  }
  function eat() {
    for (const id of FOOD) { const i = slotOf(s => s.id === id); if (i >= 0 && PL.eatSlot(i)) { B.ateN++; return true; } }
    const hc = fx(B.ids.houseChest);
    if (hc && hc.items && hc.items.some(s => isFood(s.id))) { go(...floorSpot(hc)); lootChest(hc, isFood); goHouse(); return eat(); }
    return false;
  }
  function sleepNow() {
    const bed = fx(B.ids.bed); if (!bed) return false;
    maintainStove(cfg.stoveFillTo);                       // the stove burns through the night: fill it first
    go(B.bedSpot[0], B.bedSpot[1]);
    FX.interact(bed);                         // sleep_request -> player.startSleep() (the game's own conditions)
    const p = G.player;
    if (!p.sleeping) { B.sleepRefused++; if (p.alive) goHouse(); return false; }
    B.sleeps++;
    const t0 = G.time; let guard = 0;
    while (p.sleeping && p.alive && guard++ < 6000) { sc.stepFast(10); track(); }
    const h = (G.time - t0) / 60; B.slept += h; if (B.cur) B.cur.slept += h;
    return true;
  }
  function fuelTrip() {
    B.lastFuelTrip = G.time; B.trips.fuel++;
    maintainStove(cfg.stoveFillTo);
    const targets = [];
    for (const id of B.chestIds) { const c = fx(id); if (c && c.items && c.items.some(s => isFuel(s.id))) targets.push({ x: floorSpot(c)[0], y: floorSpot(c)[1], fn: () => lootChest(c, isFuel) }); }
    for (const id of B.cartIds) { const c = fx(id); if (c && ((c.data && c.data.loaded) || (c.items && c.items.length))) { const [x, y] = floorSpot(c); targets.push({ x, y, fn: () => lootChest(c, isFuel) }); } }
    for (const dd of G.drops.filter(d => d.item === 'coal').slice(0, 40)) targets.push({ x: dd.x, y: dd.y - 2, fn: () => {   // a coal sack in the snow: picked up (E)
      const i = G.drops.indexOf(dd); if (i >= 0 && INV.add('coal', dd.n) <= 0) G.drops.splice(i, 1); } });
    if (B.logStock > 0) targets.push({ x: B.beach[0], y: B.beach[1], fn: () => {
      const n = Math.min(cfg.logsPerTrip, B.logStock); stepMin(n * cfg.logMin); INV.add('log', n); B.logStock -= n; } });
    visitNearest(targets);
    goHouse();
  }
  function foodTrip() {
    B.lastFoodTrip = G.time; B.trips.food++;
    const targets = [];
    for (const id of B.chestIds) { const c = fx(id); if (c && c.items && c.items.some(s => isFood(s.id))) { const [x, y] = floorSpot(c); targets.push({ x, y, fn: () => lootChest(c, isFood) }); } }
    targets.push({ x: B.hole[0], y: B.hole[1], fn: () => { stepMin(cfg.fishTripMin); INV.add('fish', Math.floor(cfg.fishTripMin / cfg.fishMin)); } });
    visitNearest(targets);
    goHouse();
  }
  function supplies() {
    const fa = G.forecast && G.forecast.stormAt;
    if (G.storm > 0.1 || (fa > G.time && fa - G.time < cfg.stormSkipMin)) return;
    if (totalFuelH() < cfg.fuelReserveH && G.time - B.lastFuelTrip >= cfg.tripCooldownMin) fuelTrip();
    const hungryNoFood = G.player.food < cfg.eatAt && foodInPack() < 10;
    if ((foodInPack() < cfg.foodReservePts && G.time - B.lastFoodTrip >= cfg.tripCooldownMin) || (hungryNoFood && G.time - B.lastFoodTrip >= 30)) foodTrip();
  }
  // one decision cycle (cfg.chunk game minutes)
  function cycle() {
    if (!alive()) return;
    if (!B.chain.start) chain();
    if (!alive()) return;
    maintainStove();
    damperPolicy();
    cookRaw();
    if (G.player.water < cfg.drinkAt) drink();
    if (G.player.food < cfg.eatAt) eat();
    if (G.player.energy < cfg.sleepAt && G.player.core >= 35.5) sleepNow();
    if (!alive()) return;
    supplies();
    if (!alive()) return;
    if (G.player.x < B.house[0] - 40 || G.player.x > B.house[0] + 40) goHouse();
    stepMin(cfg.chunk);
  }

  // ---- public API for the Node side ----
  B.install = () => { setup(); newDay(); B.started = true; return { seed: G.seed, diff: G.diff.level, hardcore: G.diff.hardcore, day: G.day, ids: B.ids }; };
  B.runTo = (targetDay) => {
    let guard = 0;
    while (!B.dead && G.day < targetDay && guard++ < 2000) { cycle(); }
    if (!B.dead && G.day >= targetDay) B.finished = true;     // the last day was recorded when its midnight came (track)
    const out = B.outbox; B.outbox = [];
    return { out, dead: B.dead, finished: B.finished, day: G.day, death: B.death, storms: B.survived, stormsStarted: B.stormsStarted,
      sleeps: B.sleeps, sleepRefused: B.sleepRefused, slept: round(B.slept), fed: B.fedN, drank: B.drankN, ate: B.ateN, cooked: B.cookN,
      trips: B.trips, chain: B.chain, ring: G.cycle, alive: alive() };
  };
  window.__bot = B;
  return B.install();
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Node side
function parseArgs(argv) {
  const a = { index: null, diff: 1, seed: 1, days: DEFAULTS.days, chunk: DEFAULTS.chunk, matrix: false, diffs: [0, 1, 2], seeds: [1, 2], par: 3, out: null, cfg: {} };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (!t.startsWith('--')) { a.index = t; continue; }
    const k = t.slice(2), v = rest[i + 1];
    if (k === 'matrix') { a.matrix = true; continue; }
    if (k === 'diffs') { a.diffs = v.split(',').map(Number); i++; continue; }
    if (k === 'seeds') { a.seeds = v.split(',').map(Number); i++; continue; }
    if (k === 'diff') { a.diff = +v; i++; continue; }
    if (k === 'seed') { a.seed = +v; i++; continue; }
    if (k === 'days') { a.days = +v; i++; continue; }
    if (k === 'chunk') { a.chunk = +v; i++; continue; }
    if (k === 'par') { a.par = +v; i++; continue; }
    if (k === 'out') { a.out = v; i++; continue; }
    if (k === 'set') { const [kk, vv] = v.split('='); a.cfg[kk] = +vv; i++; continue; }
  }
  return a;
}
const fmtRow = r => [`D${String(r.day).padStart(2)}`, `ring${r.ring}`, r.phase.padEnd(8), `core${String(r.coreMin).padStart(5)}`,
  `fr h${r.fH} f${r.fF} x${r.fFace}`, `food${String(r.foodMin).padStart(4)}`, `water${String(r.waterMin).padStart(4)}`, `en${String(r.energyMin).padStart(4)}`,
  `hpMin${String(r.hpMin).padStart(4)}`, `stove${String(r.stoveH).padStart(5)}h`, `fuel${String(r.fuelH).padStart(5)}h`, `foodD${String(r.foodDays).padStart(5)}`,
  `storms${r.storms}/${r.stormsStarted}`, `slept${String(r.slept).padStart(4)}h`, `trips${r.trips}`, r.alive ? 'alive' : 'DEAD ' + r.cause].join('  ');

async function runOne(a) {
  const cfg = { ...DEFAULTS, days: a.days, chunk: a.chunk, ...a.cfg };
  const url = 'file://' + path.resolve(a.index) + `?title=0&seed=${a.seed}&diff=${a.diff}`;
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(() => { window.requestAnimationFrame = () => 0; });   // no game loop: the bot steps the clock itself
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(url); await page.waitForFunction(() => window.__sc && window.__sc.ready, null, { timeout: 60000 });
  const info = await page.evaluate(installBot, cfg);
  console.log('INFO ' + JSON.stringify(info));
  const rows = []; let res; let calls = 0;
  do {
    res = await page.evaluate(d => window.__bot.runTo(d), cfg.days + 1); calls++;
    for (const r of res.out) { rows.push(r); console.log(fmtRow(r)); }
  } while (!res.dead && !res.finished && calls < 200);
  const death = res.death;
  const result = { diff: a.diff, seed: a.seed, days: cfg.days, cfg, survivedDays: death ? death.days : round(cfg.days), dead: !!death,
    cause: death ? death.cause : '', deathDay: death ? death.day : null, ring: res.ring, storms: res.storms, stormsStarted: res.stormsStarted,
    sleeps: res.sleeps, sleepRefused: res.sleepRefused, slept: res.slept, fed: res.fed, drank: res.drank, ate: res.ate, cooked: res.cooked,
    trips: res.trips, chain: res.chain, errors: errs.slice(0, 3) };
  console.log('RES ' + JSON.stringify(result));
  await b.close();
  return { result, rows };
}
function round(v) { return Math.round(v * 10) / 10; }

function median(xs) { const s = xs.slice().sort((p, q) => p - q); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

async function matrix(a) {
  const out = a.out || path.join(path.dirname(path.resolve(a.index)), 'balance-out');
  fs.mkdirSync(out, { recursive: true });
  const jobs = []; for (const d of a.diffs) for (const s of a.seeds) jobs.push({ diff: d, seed: s });
  const results = []; let next = 0;
  const runChild = job => new Promise(resolve => {
    const args = [__filename, a.index, '--diff', job.diff, '--seed', job.seed, '--days', a.days, '--chunk', a.chunk];
    for (const kv of Object.entries(a.cfg)) args.push('--set', kv[0] + '=' + kv[1]);
    const ch = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = ''; const lines = [];
    ch.stdout.on('data', d => { buf += d; let k; while ((k = buf.indexOf('\n')) >= 0) { lines.push(buf.slice(0, k)); buf = buf.slice(k + 1); } });
    ch.stderr.on('data', d => process.stderr.write('[' + job.diff + '/' + job.seed + '] ' + d));
    ch.on('close', () => {
      const f = path.join(out, `d${job.diff}-s${job.seed}.log`); fs.writeFileSync(f, lines.join('\n') + '\n');
      const res = lines.find(l => l.startsWith('RES ')); const r = res ? JSON.parse(res.slice(4)) : { diff: job.diff, seed: job.seed, error: 'no RES line' };
      console.log(`done diff${job.diff} seed${job.seed}: ${r.dead ? 'died day ' + r.survivedDays + ' (' + r.cause + ')' : 'alive at day ' + a.days}`);
      resolve(r);
    });
  });
  const workers = Array.from({ length: Math.max(1, a.par) }, async () => { while (next < jobs.length) { const j = jobs[next++]; results.push(await runChild(j)); } });
  await Promise.all(workers);
  results.sort((x, y) => x.diff - y.diff || x.seed - y.seed);
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(results, null, 1));
  const names = ['Мягкая', 'Обычная', 'Суровая'];
  for (const d of a.diffs) {
    const rs = results.filter(r => r.diff === d);
    const v = rs.map(r => r.survivedDays);
    console.log(`${names[d]} (diff ${d}): survived ${v.join(' / ')} days, median ${median(v)}, causes: ${rs.map(r => r.cause || 'alive').join(' / ')}`);
  }
  return results;
}

(async () => {
  const a = parseArgs(process.argv);
  if (!a.index) { console.error('usage: node tests/balance/bot.cjs <index.html> [--diff n --seed n | --matrix]'); process.exit(2); }
  if (a.matrix) { await matrix(a); return; }
  await runOne(a);
})().catch(e => { console.error('bot failed:', e); process.exit(1); });

module.exports = { installBot, DEFAULTS };
