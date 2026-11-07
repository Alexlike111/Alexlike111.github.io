// SNOWCRAFT gameplay e2e (Playwright + Chromium): builds the single-file bundle, opens dist/index.html via file://, fails on console errors, plays a scripted
// scenario through window.__sc on desktop (1600x900) and phone (844x390, touch): walk, cut snow blocks, build, light a fat lamp, shelter stars and warming,
// CO without a vent, craft, eat/drink, sleep. Screenshots go to shots/core-*.png; the in-game self-test is run headless and saved to shots/selftest.txt.
//   node tests/e2e.mjs            full run          node tests/e2e.mjs --nobuild   skip `vite build`
//   node tests/e2e.mjs --only=desktop   one profile        --noselftest   skip the self-test
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch {
  for (const dir of ['/opt/node-tools/node_modules/', '/usr/lib/node_modules/', '/usr/local/lib/node_modules/']) { try { playwright = createRequire(dir)('playwright'); break; } catch { /* next */ } }
  if (!playwright) throw new Error('playwright not found (npm i -g playwright)');
}
const { chromium } = playwright;
const args = process.argv.slice(2);
const only = (args.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
if (!args.includes('--nobuild')) { console.log('building...'); execSync('npx vite build', { cwd: root, stdio: 'inherit' }); }
const shots = path.join(root, 'shots');
if (!existsSync(shots)) mkdirSync(shots, { recursive: true });
const url = (q = 2) => pathToFileURL(path.join(root, 'dist', 'index.html')).href + `?q=${q}`;

const PROFILES = [
  { name: 'desktop', viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, hasTouch: false, isMobile: false, q: 2 },
  { name: 'phone', viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, q: 1 },
];

let failures = 0;
const log = (...a) => console.log(...a);
const check = (name, cond, info = '') => { if (cond) log(`  ok   ${name}`); else { failures++; log(`  FAIL ${name} ${info}`); } };
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function openPage(prof, hash = '') {
  const ctx = await browser.newContext({ viewport: prof.viewport, deviceScaleFactor: prof.deviceScaleFactor, hasTouch: prof.hasTouch, isMobile: prof.isMobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + (e.stack || e.message)));
  await page.goto(url(prof.q) + hash);
  await page.waitForFunction(() => window.__sc && window.__sc.ready, null, { timeout: 30000 });
  await page.waitForTimeout(400);
  return { ctx, page, errors };
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const shot = async (page, prof, name) => { await ev(page, () => window.__sc.step(3)); await page.waitForTimeout(150); await page.screenshot({ path: path.join(shots, `core-${prof.name}-${name}.png`) }); };

for (const prof of PROFILES) {
  if (only.length && !only.includes(prof.name)) continue;
  log(`\n[${prof.name}] ${prof.viewport.width}x${prof.viewport.height}`);
  const { ctx, page, errors } = await openPage(prof);
  const info = await ev(page, () => ({ genMs: window.__sc.genMs, scale: window.__sc.G.cam.scale, touchUi: !!document.getElementById('touch') && document.getElementById('touch').style.display !== 'none', mobile: window.__sc.G.mobile }));
  log(`  worldgen ${info.genMs.toFixed(0)} ms, scale ${info.scale}, mobile ${info.mobile}, touch UI ${info.touchUi}`);
  await shot(page, prof, '01-start');

  // ---- 0. DESIGN §13: the east door of the house is buried under the lee drift; the first objective is to dig it out (a staircase, with the shovel) ----
  // the chain starts with the coal sack (playability); with the coal in the bag the next line is the buried door
  const door0 = await ev(page, () => { const S = window.__sc; S.setDay(1, 12); S.setWeather({ snowfall: 0, wind: 0, storm: 0 }); S.step(20); const first = S.mods.quest.objective(); S.give('coal', 4); S.step(4); return { first, goal: S.mods.quest.objective(), front: S.mods.quest.doorFrontSnow(), tool: S.stats().sel, p: [Math.round(S.G.player.x), Math.round(S.G.player.y)] }; });
  check('start: the first objective is the coal sack, then (coal in the bag) digging out the buried door, shovel selected', /уголь/.test(door0.first) && /Откопай/.test(door0.goal) && door0.front > 100 && door0.tool === 1, JSON.stringify(door0));
  await shot(page, prof, '00-buried-door');
  const dug = await ev(page, () => {
    const S = window.__sc, G = S.G, held = S.mods.inv.held, t0 = G.realTime;
    S.selectItem('shovel');
    let digs = 0, throws = 0;
    const airTile = (tx, ty) => { let air = 0; for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) if (S.cell(tx * 4 + i, ty * 4 + j) === 0) air++; return air >= 14; };
    for (let ty = 61; ty < 68; ty++) for (const tx of [173, 172, 171]) {
      let guard = 0;
      while (!airTile(tx, ty) && guard++ < 12) { if (held.load > 26) { S.act('dig', 714, 238, 1.4); throws++; } S.act('dig', tx * 4 + 2, ty * 4 + 2, 0.6); digs++; }
      if (tx === 171) { S.teleport(692, Math.min(ty * 4 + 6, 271)); S.step(10); }
    }
    S.step(40);
    return { digs, throws, secs: +(G.realTime - t0).toFixed(0), front: S.mods.quest.doorFrontSnow(), goal: S.mods.quest.objective() };
  });
  check('the shovel digs the door out in about a minute; the objective moves on to the stove', dug.front <= 14 && /печь/.test(dug.goal) && dug.secs < 150, JSON.stringify(dug));
  await shot(page, prof, '00-door-dug');

  // ---- doors: the 8x20 player must be able to walk through every station / shed door (regression: doors used to be 5 tiles high under a stone lintel) ----
  const doorWalk = await ev(page, () => {
    const S = window.__sc, G = S.G, out = [];
    for (const d of G.fixtures.filter(f => f.kind === 'door')) {
      const west = d.data && d.data.side === 'west';
      S.teleport(d.tx * 4 + (west ? -14 : 10), 272); S.step(8);
      S.act('interact', d.tx * 4 + 2, d.ty * 4 + 12);
      const key = west ? 'KeyD' : 'KeyA';
      S.key(key, true); S.stepFast(70); S.key(key, false);
      out.push({ tx: d.tx, side: west ? 'W' : 'E', x: Math.round(G.player.x), passed: west ? G.player.x > d.tx * 4 + 3 : G.player.x < d.tx * 4 + 1 });
    }
    return out;
  });
  check('walks through every station / shed door', doorWalk.length >= 3 && doorWalk.every(r => r.passed), JSON.stringify(doorWalk));


  // ---- 0b. zoom (DESIGN §14): Ctrl+wheel / +/- keys on the desktop (plain wheel stays the belt), pinch and +/- buttons on the phone; remembered; crisp integer scales ----
  {
    const zs = () => ev(page, () => { const S = window.__sc; return { s: S.G.cam.scale, i: S.zoom.index(), n: S.zoom.count(), cells: S.zoom.cells(), sel: S.G.player ? S.stats().sel : -1 }; });
    await ev(page, () => { window.__sc.zoom.reset(); window.__sc.teleport(692, 252); window.__sc.step(10); });
    const z0 = await zs();
    check('zoom: default scale is an integer and 200..700 cells fit the width', Number.isInteger(z0.s) && z0.cells >= 200 && z0.cells <= 700 && z0.n >= 3, JSON.stringify(z0));
    if (!prof.hasTouch) {
      await page.mouse.move(800, 300);
      await page.keyboard.press('Equal'); await page.waitForTimeout(80);
      const z1 = await zs();
      await page.keyboard.press('Minus'); await page.keyboard.press('Minus'); await page.waitForTimeout(80);
      const z2 = await zs();
      check('zoom: "+" zooms in one step, "-" zooms out', z1.i === z0.i + 1 && z2.i === z0.i - 1, JSON.stringify([z0, z1, z2]));
      await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control'); await page.waitForTimeout(150);
      const z3 = await zs();
      check('zoom: Ctrl+wheel up zooms in', z3.i === z2.i + 1, JSON.stringify([z2, z3]));
      await page.mouse.wheel(0, 120); await page.waitForTimeout(150);
      const z4 = await zs();
      check('zoom: the plain wheel stays the belt (zoom unchanged, belt slot moved)', z4.i === z3.i && z4.sel !== z3.sel, JSON.stringify([z3, z4]));
      const keep = await page.evaluate(() => localStorage.getItem('sc.zoom'));
      check('zoom: the choice is remembered in localStorage', !!keep && Number(keep) >= 200 && Number(keep) <= 700, String(keep));
    } else {
      const rects = await page.evaluate(() => {
        const r = (e) => { const b = e.getBoundingClientRect(); return { id: e.id || e.className, x: b.left, y: b.top, w: b.width, h: b.height }; };
        const zin = r(document.getElementById('tb-zin')), zout = r(document.getElementById('tb-zout'));
        const others = [...document.querySelectorAll('#touch .tb, #hud .bw, #hud .dial, #hud .stk, #hud .belt, #hud .bname')].filter(e => e.id !== 'tb-zin' && e.id !== 'tb-zout' && getComputedStyle(e).display !== 'none').map(r);
        const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
        return { zin, zout, clash: others.filter(o => o.w > 0 && (hit(zin, o) || hit(zout, o))).map(o => o.id) };
      });
      check('zoom: the phone +/- buttons are >= 44 px and overlap no other button or HUD block', rects.zin.w >= 44 && rects.zin.h >= 44 && rects.zout.w >= 44 && rects.clash.length === 0, JSON.stringify(rects));
      await page.touchscreen.tap(rects.zin.x + 22, rects.zin.y + 22); await page.waitForTimeout(150);
      const z1 = await zs();
      await page.touchscreen.tap(rects.zout.x + 22, rects.zout.y + 22); await page.touchscreen.tap(rects.zout.x + 22, rects.zout.y + 22); await page.waitForTimeout(150);
      const z2 = await zs();
      check('zoom: the "+" button zooms in, "-" zooms out', z1.i === z0.i + 1 && z2.i === z0.i - 1, JSON.stringify([z0, z1, z2]));
      // pinch: two fingers on the right half of the world, spreading apart = closer
      await ev(page, () => {
        const stage = document.getElementById('stage');
        const fire = (el, type, x, y, id) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: id === 31 }));
        fire(stage, 'pointerdown', 520, 200, 31); fire(stage, 'pointerdown', 580, 200, 32);
        fire(window, 'pointermove', 640, 200, 32); fire(window, 'pointermove', 740, 200, 32);
        fire(window, 'pointerup', 740, 200, 32); fire(window, 'pointerup', 520, 200, 31);
      });
      await page.waitForTimeout(150);
      const z3 = await zs();
      check('zoom: pinch (fingers apart) zooms in', z3.i >= z2.i + 2, JSON.stringify([z2, z3]));
    }
    // a look at the extremes and the middle
    for (const frac of [0, 0.5, 1]) {
      await ev(page, (f) => { const S = window.__sc; S.zoom.set(Math.round((S.zoom.count() - 1) * f)); S.teleport(692, 252); S.step(12); }, frac);
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(shots, `zoom-${prof.name}-${Math.round(frac * 100)}.png`) });
    }
    await ev(page, () => { window.__sc.zoom.reset(); window.__sc.step(3); });
  }

  // ---- 1. walk, run, jump on open ground ----
  const walk = await ev(page, () => {
    const S = window.__sc; const p = S.G.player;
    S.setDay(3, 12); S.setWeather({ ambientT: -30, wind: 0, storm: 0, snowfall: 0 });
    S.arena(1000, 272, { dens: 300, loose: 0, depth: 40, up: 70 });
    S.teleport(960, 272); S.step(20);
    const x0 = p.x; S.key('KeyD', true); S.stepFast(60); S.key('KeyD', false); S.stepFast(20);
    const walked = p.x - x0;
    const x1 = p.x; S.key('KeyD', true); S.key('ShiftLeft', true); S.stepFast(30); S.key('ShiftLeft', false); S.key('KeyD', false); S.stepFast(20);
    const ran = p.x - x1;
    const y0 = p.y; S.key('Space', true); let hi = 0; for (let i = 0; i < 40; i++) { S.stepFast(1); hi = Math.max(hi, y0 - p.y); } S.key('Space', false); S.stepFast(40);
    return { walked, ran, hi, onGround: p.onGround };
  });
  check('walks ~27 cells/s', walk.walked > 22 && walk.walked < 34, JSON.stringify(walk));
  check('runs faster than walks', walk.ran > 18, JSON.stringify(walk));
  check('jumps 2.5+ tiles and lands', walk.hi > 9 && walk.onGround, JSON.stringify(walk));

  // ---- 2. cut snow blocks with the knife ----
  const cut = await ev(page, () => {
    const S = window.__sc; const p = S.G.player;
    S.teleport(1000, 272); S.step(10);
    S.selectItem('snow_knife');
    const out = [];
    for (let k = 0; k < 4; k++) { S.act('dig', 1008 + k * 8, 274, 2.0); }
    const blocks = S.mods.inv.count('snow_block');
    const slot = S.mods.inv.inv.slots.find(s => s && s.id === 'snow_block');
    return { blocks, dens: slot && slot.dur, pack: S.stats().weight };
  });
  check('knife cuts 2x1 snow blocks (density 300)', cut.blocks >= 2 && Math.abs(cut.dens - 300) < 8, JSON.stringify(cut));
  await shot(page, prof, '02-cut-blocks');

  // ---- 3. place blocks by hand (wall courses), then the rest of the igloo ----
  const placed = await ev(page, () => {
    const S = window.__sc; const G = S.G;
    S.arena(1000, 272, { dens: 300, loose: 0, depth: 40, up: 70 });
    S.teleport(1000, 272); S.step(5);
    S.give('snow_block', 12, 300);
    const r = [];
    r.push(S.place('snow_block', 244, 67).placed); r.push(S.place('snow_block', 244, 66).placed); r.push(S.place('snow_block', 244, 65).placed);
    const floating = S.place('snow_block', 249, 62).placed;
    return { r, floating, cells: S.testkit.count(3) };
  });
  check('blocks placed on the ground and stacked', placed.r.every(Boolean) && placed.cells >= 96, JSON.stringify(placed));
  check('a floating block is refused (support preview)', !placed.floating, JSON.stringify(placed));
  await shot(page, prof, '03-blocks-placed');

  // ---- 4. igloo with a fat lamp ----
  const igl = await ev(page, () => {
    const S = window.__sc; const G = S.G; const p = G.player; const tk = S.testkit; const F = S.mods.fixtures;
    S.setWeather({ ambientT: -32, wind: 0, storm: 0, snowfall: 0 });
    S.arena(1000, 272, { dens: 300, loose: 0, depth: 40, up: 70 });
    const ig = tk.igloo(1000, 68, { iw: 6, wallRows: 6, door: false });
    S.teleport((ig.L + 5) * 4, 272); S.stepFast(20);
    // craft the lamp at a table: soapstone + fat + lichen
    tk.testkit; F.placeFixture('table', ig.L + 5, 66, { force: true });
    S.give('soapstone', 1); S.give('fat', 3); S.give('lichen', 3); S.give('matches', 5);
    const refused = S.craft('fat_lamp_stone') === false;                 // the lamp is a technique: unknown until the diary at the cairn is read
    S.mods.quest.learn('lamp', 'note', 'n1', true);
    const crafted = refused && S.craft('fat_lamp_stone');
    // place the lamp inside by hand, then light it with E
    const pl = S.place('fat_lamp', ig.L + 3, 67);
    const lamp = G.fixtures.find(f => f.kind === 'fat_lamp');
    S.mods.fixtures.interact(lamp);                       // add fat
    S.mods.fixtures.interact(lamp);                       // light it
    return { crafted, placed: pl.placed, lamp: !!lamp, lit: lamp && lamp.lit, fuel: lamp && lamp.fuel, ig };
  });
  check('fat lamp: refused before the technique is known, crafted at the table after, placed and lit', igl.crafted && igl.placed && igl.lit, JSON.stringify(igl));
  const warm = await ev(page, () => {
    const S = window.__sc; const G = S.G; const out = [];
    for (let k = 0; k < 6; k++) { S.stepFast(420); S.evalShelter(); out.push({ t: (k + 1) * 7, temp: G.shelter && +G.shelter.temp.toFixed(1), co: G.shelter && +G.shelter.co.toFixed(1), stars: G.shelter && G.shelter.stars, closed: G.shelter && G.shelter.closed, vent: G.shelter && G.shelter.vent, notes: G.shelter && G.shelter.notes }); }
    return out;
  });
  const first = warm[0], last = warm[warm.length - 1];
  check('shelter is detected as closed with stars', last.closed && last.stars >= 2, JSON.stringify(last));
  check('inside warms up vs ambient (-32)', last.temp > first.temp && last.temp > -14, JSON.stringify([first.temp, last.temp]));
  check('CO rises without a vent', last.co > first.co + 5 && last.co > 15 && !last.vent, JSON.stringify([first.co, last.co]));
  check('shelter notes explain the missing vent', (last.notes || []).some(n => /отдушин/.test(n)), JSON.stringify(last.notes));
  await shot(page, prof, '04-igloo-lamp-co');
  const body = await ev(page, () => { const S = window.__sc; const p = S.G.player; S.stepFast(300); return { co: p.co, hp: p.hp, core: p.core, feel: p.feelT }; });
  check('player body picks up CO in the sealed igloo', body.co > 5, JSON.stringify(body));
  // vent: remove one roof tile -> CO falls
  const vent = await ev(page, () => {
    const S = window.__sc; const G = S.G; const tk = S.testkit; const ig = { L: 245, topRow: 59 };
    for (let y = ig.topRow * 4; y < ig.topRow * 4 + 4; y++) for (let x = (ig.L + 4) * 4; x < (ig.L + 5) * 4; x++) tk.put(x, y, 0);
    S.stepFast(20); S.evalShelter(); const c0 = G.shelter.co, v0 = G.shelter.vent;
    S.stepFast(60 * 14); S.evalShelter();
    return { vent: v0, c0, c1: G.shelter.co, notes: G.shelter.notes };
  });
  check('a roof hole is a vent and CO falls', vent.vent && vent.c1 < vent.c0 * 0.85, JSON.stringify(vent));
  await shot(page, prof, '05-vent');

  // ---- 5. craft, eat, drink, sleep ----
  const misc = await ev(page, () => {
    const S = window.__sc; const G = S.G; const p = G.player; const F = S.mods.fixtures; const inv = S.mods.inv;
    inv.clearInventory(); S.give('can', 2); S.give('tea', 1); S.give('snow', 4); S.give('log', 3); S.give('lichen', 2); S.give('matches', 5); S.give('seal_meat', 2); S.give('rope', 2);
    S.give('canvas', 1); S.give('fat', 1);
    p.food = 30; p.water = 30;
    const torchRefused = S.craft('torch') === false;                      // not known yet
    S.mods.quest.learn('torch', 'note', 'n2', true);
    S.give('log', 1);
    const crafts = { camp: S.craft('campfire'), torch: torchRefused && S.craft('torch') };
    S.mods.player.eatSlot(inv.inv.slots.findIndex(s => s && s.id === 'can'));
    const ate = p.food > 55;
    S.mods.player.eatSlot(inv.inv.slots.findIndex(s => s && s.id === 'snow'));
    const drank = p.water > 33;
    return { crafts, ate, drank, food: p.food, water: p.water };
  });
  check('crafts campfire and torches', misc.crafts.camp && misc.crafts.torch, JSON.stringify(misc));
  check('eating a can and drinking snow works', misc.ate && misc.drank, JSON.stringify(misc));
  const sleep = await ev(page, () => {
    const S = window.__sc; const G = S.G; const p = G.player; const tk = S.testkit; const F = S.mods.fixtures;
    G.fixtures.length = 0; S.setWeather({ ambientT: -32, wind: 0, storm: 0, snowfall: 0 });
    S.arena(1000, 272, { dens: 300, loose: 0, depth: 40, up: 70 });
    const ig = tk.igloo(1000, 68, { iw: 8, wallRows: 6, door: false, vent: true });
    S.teleport((ig.L + 6) * 4, 272); S.stepFast(15);
    F.placeFixture('fat_lamp', ig.L + 3, 67, { force: true, fuel: 600, lit: true });
    const bed = F.placeFixture('skin_bed', ig.L + 4, 67, { force: true });
    S.stepFast(600); S.evalShelter();
    p.energy = 30; p.core = 36.5;
    S.mods.drift.driftState.nextAt = 1e9;                            // the first ice shift (20-40 game minutes after the start) would wake the sleeper: not what this check is about
    const t0 = G.time; F.interact(bed);
    const ok = p.sleeping && G.timeScale === 20;
    S.stepFast(120);
    const dt = G.time - t0; const e1 = p.energy;
    return { ok, dt, e1, sleeping: p.sleeping, shelter: G.shelter && { closed: G.shelter.closed, vent: G.shelter.vent, temp: +G.shelter.temp.toFixed(1) } };
  });
  check('sleep in a bed: time x20 and energy restored', sleep.ok && sleep.dt > 80 && sleep.e1 > 31, JSON.stringify(sleep));
  await shot(page, prof, '06-sleep');
  await ev(page, () => { const S = window.__sc; S.G.player.sleeping = false; S.G.timeScale = 1; S.setTime(10 * 60); });

  // ---- knowledge: picking up a note teaches a technique; journal tabs; bag panel shows only what is known ----
  const know = await ev(page, () => {
    const S = window.__sc, q = S.mods.quest, inv = S.mods.inv, p = S.G.player;
    q.forgetAll(); inv.clearInventory(); S.give('snow_knife', 1); S.give('shovel', 1);
    S.arena(1000, 272, { dens: 300, loose: 0, depth: 40, up: 70 }); S.teleport(1000, 272); S.step(5);
    const had = { harpoon: q.knows('harpoon'), campfire: q.knows('campfire') };
    inv.spawnDrop('note_s1', 1, p.x + 2, p.y - 4, 0, 0); S.stepFast(40);
    return { had, harpoon: q.knows('harpoon'), noteInBag: inv.count('note_s1'), read: q.lore.read.has('s1'), log: q.journal.filter(e => e.kind === 'know' || e.kind === 'note').length };
  });
  check('picking up the keeper\'s log teaches the harpoon and the page leaves the bag', !know.had.harpoon && know.had.campfire && know.harpoon && know.noteInBag === 0 && know.read && know.log >= 2, JSON.stringify(know));
  if (!prof.hasTouch) await page.keyboard.press('KeyJ'); else await page.evaluate(() => { document.getElementById('tb-jour').dispatchEvent(new PointerEvent('pointerdown', { pointerId: 3, pointerType: 'touch', bubbles: true, isPrimary: true })); window.__sc.step(3); });
  await page.waitForTimeout(300);
  const jr = await page.evaluate(() => { const j = [...document.querySelectorAll('#hud .pnl')].find(e => e.classList.contains('jr')); return j ? { shown: j.style.display, tabs: [...j.querySelectorAll('.tab')].map(b => b.textContent) } : null; });
  check('journal opens with five tabs: Цели Знания Записки Карта Вещества', !!jr && jr.shown === 'block' && jr.tabs.join('|') === 'Цели|Знания|Записки|Карта|Вещества', JSON.stringify(jr));
  for (const [name, cond] of [['Знания', '.card'], ['Записки', '.paper'], ['Карта', 'canvas.map'], ['Вещества', '.dim,.card']]) {
    await page.evaluate((n) => { const j = [...document.querySelectorAll('#hud .pnl.jr')][0]; [...j.querySelectorAll('.tab')].find(b => b.textContent === n).click(); }, name);
    await page.waitForTimeout(150);
    check(`journal tab ${name} renders`, await page.evaluate((c) => !!document.querySelector('#hud .pnl.jr ' + c.split(',')[0]) || !!document.querySelector('#hud .pnl.jr ' + (c.split(',')[1] || 'x')), cond));
    if (name === 'Записки' || name === 'Карта') await shot(page, prof, '06-journal-' + (name === 'Карта' ? 'map' : 'notes'));
  }
  await page.evaluate(() => { const j = document.querySelector('#hud .pnl.jr'); j.querySelector('[data-j=close]').click(); });
  await page.waitForTimeout(100);
  const bag = await ev(page, () => { const S = window.__sc; S.mods.quest.forgetAll(); S.mods.quest.learn('harpoon', 'note', 's1', true); return null; });
  if (!prof.hasTouch) {
    await page.keyboard.press('KeyC'); await page.waitForTimeout(300);
    const txt = await page.evaluate(() => document.querySelector('#hud .pnl').textContent);
    check('bag panel: known techniques with places, «?» hints, no workbench wording', /Гарпун/.test(txt) && /где угодно/.test(txt) && /у стола на станции/.test(txt) && !/Пешня/.test(txt) && !/верстак/i.test(txt) && (await page.evaluate(() => document.querySelectorAll('#hud .pnl .qrow').length)) >= 3, txt.slice(0, 200));
    await shot(page, prof, '06-bag-knowledge');
    await page.keyboard.press('KeyC');
  }
  void bag;

  // ---- 6. controls: keyboard path (desktop) / touch path (phone) ----
  if (!prof.hasTouch) {
    await page.mouse.move(800, 450);
    const k = await ev(page, () => { const S = window.__sc; S.teleport(1056, 272); S.step(10); const x0 = S.G.player.x; S.key('KeyD', true); S.step(30); S.key('KeyD', false); return S.G.player.x - x0; });
    await page.keyboard.down('KeyD'); await page.waitForTimeout(500); await page.keyboard.up('KeyD');
    const moved = await ev(page, () => window.__sc.G.player.x);
    check('real keyboard events move the player', k > 10 && moved > 1060, JSON.stringify({ k, moved }));
    await page.keyboard.press('KeyC'); await page.waitForTimeout(300);
    check('C opens the bag / craft panel', await page.evaluate(() => { const p = document.querySelector('#hud .pnl'); return !!p && p.style.display === 'block'; }));
    await shot(page, prof, '07-craft-panel');
    await page.keyboard.press('KeyC');
  } else {
    await ev(page, () => window.__sc.step(4));                       // the HUD drops `panel-open` on its next update: do not rely on the wall-clock wait after closing the journal
    const t = await ev(page, () => {
      const ids = ['tb-act', 'tb-jump', 'tb-take', 'tb-belt', 'tb-bag', 'tb-jour', 'tb-parka'];
      const rects = ids.map(i => { const r = document.getElementById(i).getBoundingClientRect(); return { i, w: Math.round(r.width), h: Math.round(r.height) }; });
      return { rects, portraitOverlay: getComputedStyle(document.getElementById('rotate')).display, body: document.body.className, pnl: [...document.querySelectorAll('#hud .pnl')].map(e => e.className + ':' + e.style.display) };
    });
    check('touch buttons present, >= 56 px', t.rects.every(r => r.w >= 56 && r.h >= 50), JSON.stringify(t));
    check('no rotate overlay in landscape', t.portraitOverlay === 'none');
    // stick: synthetic touch pointer events
    const st = await ev(page, () => {
      const S = window.__sc; S.setWeather({ ambientT: -20, wind: 0, storm: 0, snowfall: 0 });
      S.arena(1000, 272, { dens: 300, loose: 0, depth: 40, up: 70 }); S.teleport(960, 272); S.step(15);
      const stage = document.getElementById('stage');
      const fire = (el, type, x, y, id = 7) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: true }));
      const x0 = S.G.player.x;
      const rc = document.querySelector('#touch .stick').getBoundingClientRect(), cx = rc.left + rc.width / 2, cy = rc.top + rc.height / 2, rr = rc.width / 2;   // the stick is fixed in the bottom-left corner
      fire(stage, 'pointerdown', cx, cy); fire(window, 'pointermove', cx + rr, cy);
      S.stepFast(40); const moved = S.G.player.x - x0;
      fire(window, 'pointerup', cx + rr, cy); S.stepFast(10);
      // up on the stick = jump
      fire(stage, 'pointerdown', cx, cy, 8); fire(window, 'pointermove', cx, cy - rr, 8);
      let hi = 0; const y0 = S.G.player.y; for (let i = 0; i < 30; i++) { S.stepFast(1); hi = Math.max(hi, y0 - S.G.player.y); }
      fire(window, 'pointerup', cx, cy - rr, 8); S.stepFast(30);
      // Действие button with the smart cursor digs the snow in front
      S.selectItem('shovel'); S.mods.inv.held.load = 0;
      const act = document.getElementById('tb-act');
      const before = S.testkit.count(1, 940, 200, 1100, 290);
      fire(act, 'pointerdown', 700, 330, 9); S.stepFast(60); fire(act, 'pointerup', 700, 330, 9); S.stepFast(5);
      return { moved, hi, load: S.mods.inv.held.load, tgt: S.mods.tools.target().mode };
    });
    check('fixed stick walks the player', st.moved > 15, JSON.stringify(st));
    check('stick up = jump', st.hi > 6, JSON.stringify(st));
    await shot(page, prof, '07-touch');
    // belt radial
    await page.touchscreen.tap(Math.round(prof.viewport.width - 140), Math.round(prof.viewport.height - 110));
    await page.waitForTimeout(300);
    await shot(page, prof, '08-radial');
    await page.touchscreen.tap(60, 200); await page.waitForTimeout(250);          // «тап мимо — закрыть»: the radial must not swallow the next tap (the bag button)
  }
  // ---- 7. inventory + container search + nearby items (DESIGN §12): real mouse drag & drop on desktop, taps on the phone; screenshots shots/inv-*.png ----
  {
    const ishot = async (name) => { await ev(page, () => window.__sc.step(2)); await page.waitForTimeout(350); await page.screenshot({ path: path.join(shots, `inv-${prof.name}-${name}.png`) }); };
    const rect = (sel) => page.evaluate((q) => { const e = document.querySelector(q); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; }, sel);
    const cellSel = (z, i) => `#hud .pnl [data-z="${z}"][data-i="${i}"]`;
    const panelOpen = () => page.evaluate(() => document.querySelector('#hud .pnl').style.display === 'block');
    const togglePanel = async () => {
      if (prof.hasTouch) {
        // the touch buttons hide while the bag is open: the footer «закрыть» button closes it
        const r = await panelOpen() ? await rect('#hud .pnl [data-act="close"]') : await rect('#tb-bag');
        await page.touchscreen.tap(r.x, r.y);
      } else await page.keyboard.press('KeyC');
      await page.waitForTimeout(400);
    };
    const tapCell = async (z, i) => { const r = await rect(cellSel(z, i)); if (prof.hasTouch) await page.touchscreen.tap(r.x, r.y); else await page.mouse.click(r.x, r.y); await page.waitForTimeout(250); };
    const setup = await ev(page, () => {
      const S = window.__sc, G = S.G, inv = S.mods.inv;
      S.setWeather({ ambientT: -4, wind: 0, storm: 0, snowfall: 0 });          // mild: in a hard frost a search with bare hands stalls on purpose (DESIGN §12); the cold-hands case has its own self-test
      S.arena(1000, 272, { dens: 300, loose: 0, depth: 40, up: 70 }); S.teleport(1000, 272); S.step(10); G.drops.length = 0;
      for (const q of G.fixtures.filter(q => q.tx * 4 > 900 && q.tx * 4 < 1100 && q.ty * 4 > 200 && q.ty * 4 < 300)) S.mods.fixtures.removeFixture(q);     // leftovers of the earlier steps (bed, lamp, ...)
      inv.clearInventory(); inv.giveStartKit();
      S.give('log', 2); S.give('coal', 8); S.give('biscuit', 7); S.give('rope', 3); S.give('fat', 4); S.give('can', 2);
      const f = S.mods.fixtures.placeFixture('chest', 247, 66, { force: true, items: [{ id: 'coal', n: 5 }, { id: 'rope', n: 2 }, { id: 'fat', n: 3 }, { id: 'tin', n: 2 }, { id: 'matches', n: 6 }, { id: 'flare', n: 2 }], data: { look: 'old' } });
      G.player.x = f.tx * 4 + 14; S.step(5);
      return { id: f.id, x: G.player.x, w: inv.weight() };
    });
    // the bag with a heavy load: weight bar with the effect in words
    await togglePanel();
    check('bag panel opens', await panelOpen(), await page.evaluate(() => { const b = document.getElementById('tb-bag'), r = b.getBoundingClientRect(), e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return document.body.className + ' | tb-bag ' + JSON.stringify([r.x, r.y, r.width, r.height]) + ' disp ' + getComputedStyle(b).display + ' top element ' + (e ? e.tagName + '#' + e.id + '.' + e.className : 'none') + ' | ' + window.innerWidth + 'x' + window.innerHeight; }));
    const wt = await page.evaluate(() => document.querySelector('#hud .pnl .wtxt')?.textContent);
    check('weight bar says what the load does', !!wt && wt.length > 3, wt);
    await ishot('01-bag');
    // select + split + drop with the action bar (touch path) / drag & drop (mouse path)
    const cell = (i) => cellSel('inv', i);
    if (prof.hasTouch) {
      await tapCell('inv', 6 + 1);                                    // the cans (start kit)
      await page.waitForSelector('#hud .pnl [data-act="half"]', { timeout: 2000 });
      const b = await rect('#hud .pnl [data-act="half"]'); check('action buttons are big enough to tap', b.h >= 47 && b.w >= 47, JSON.stringify(b));
      await page.touchscreen.tap(b.x, b.y); await page.waitForTimeout(250);
    } else {
      const a = await rect(cell(6 + 2)), b = await rect(cell(6 + 9));
      await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x + 20, a.y + 10, { steps: 3 }); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(250);
    }
    const afterMove = await ev(page, () => window.__sc.G && window.__sc.mods.inv.inv.slots.slice(6).map(s => s && s.id + 'x' + s.n));
    check(prof.hasTouch ? 'split half works from the panel' : 'mouse drag moves a stack to another cell', prof.hasTouch ? afterMove.filter(x => x && x.startsWith('can')).length === 2 : afterMove[9] && afterMove[2] === null, JSON.stringify(afterMove));
    await ishot('02-selected');
    await togglePanel();
    // E on the chest: panel with «Обыскиваю…», items appear one by one
    if (prof.hasTouch) { const r = await rect('#tb-take'); await page.touchscreen.tap(r.x, r.y); } else { await page.keyboard.down('KeyE'); await page.waitForTimeout(120); await page.keyboard.up('KeyE'); }
    await page.waitForTimeout(500);
    check('E on a chest opens the search panel', await panelOpen() && /Обыскиваю/.test(await page.evaluate(() => document.querySelector('#hud .pnl').textContent)));
    await ev(page, () => window.__sc.stepFast(100)); await ishot('03-searching');
    const found1 = await ev(page, () => window.__bag.search.revOf(window.__bag.search.open.box));
    check('some items found, some still hidden', found1 >= 1 && found1 < 6, String(found1));
    await ev(page, () => window.__sc.stepFast(60 * 24)); await page.waitForTimeout(300);          // 6 finds at 0.6-1.5 s each, the «на дне» one last
    { const ptxt = await page.evaluate(() => document.querySelector('#hud .pnl').textContent); check('search finishes: «Обыскано»', /Обыскано/.test(ptxt), ptxt.slice(0, 400)); }
    // take one found item with the real input, then all
    if (prof.hasTouch) { await tapCell('box', 0); const mv = await rect('#hud .pnl [data-act="move"]'); await page.touchscreen.tap(mv.x, mv.y); }
    else { const a = await rect(cellSel('box', 0)), b = await rect(cellSel('inv', 6 + 12)); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x + 16, a.y + 6, { steps: 3 }); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up(); }
    await page.waitForTimeout(300);
    const took = await ev(page, () => window.__sc.mods.inv.count('coal'));
    check('a found item can be taken from the container', took >= 9, 'coal ' + took);
    await ishot('04-found');
    const ta = await rect('#hud .pnl [data-act="takeall"]');
    if (prof.hasTouch) await page.touchscreen.tap(ta.x, ta.y); else await page.mouse.click(ta.x, ta.y);
    await page.waitForTimeout(300);
    const left = await ev(page, () => window.__bag.search.open.box ? window.__bag.search.open.box.items().length : -1);
    check('«Взять всё» empties what fits', left >= 0 && left <= 2, String(left));
    await togglePanel();
    // frozen crate: chip it free first
    await ev(page, () => {
      const S = window.__sc, G = S.G; S.give('ice_chisel', 1);
      const f = S.mods.fixtures.placeFixture('chest', 252, 66, { force: true, items: [{ id: 'canvas', n: 2 }, { id: 'harpoon', n: 1 }, { id: 'flint', n: 1 }], data: { frozen: true } });
      G.player.x = f.tx * 4 + 14; S.step(3); window.__bag.search.openContainer(f);
    });
    await page.waitForTimeout(400); await ev(page, () => window.__sc.stepFast(70));
    check('frozen crate shows chipping first', /Скалываю лёд/.test(await page.evaluate(() => document.querySelector('#hud .pnl').textContent)));
    await ishot('05-frozen');
    await ev(page, () => { window.__sc.stepFast(60 * 6); }); await page.waitForTimeout(300);
    check('after chipping the search begins', /Обыскиваю|Обыскано/.test(await page.evaluate(() => document.querySelector('#hud .pnl').textContent)));
    await togglePanel();
    // nearby things: highlighted in the world, a list when several are close
    await ev(page, () => {
      const S = window.__sc, G = S.G, p = G.player; S.mods.inv.clearInventory(); S.mods.inv.giveStartKit();
      p.x = 1030; S.step(5);
      const sp = (id, n, dx) => { const d = S.mods.inv.spawnDrop(id, n, p.x + dx, p.y - 3, 0, 0, undefined, true); d.age = 2; return d; };
      sp('coal', 4, 8); sp('log', 1, -9); sp('biscuit', 3, 18); sp('note_n3', 1, 14);
      S.stepFast(30);
    });
    await ishot('06-nearby-world');
    check('lying things are listed as nearby (3+)', (await ev(page, () => window.__bag.nearby.nearbyList().length)) >= 3);
    if (prof.hasTouch) { const r = await rect('#nearbtn'); check('phone «Рядом» button is shown', !!r && r.w >= 48, JSON.stringify(r)); if (r) await page.touchscreen.tap(r.x, r.y); }
    else { await page.keyboard.down('KeyE'); await page.waitForTimeout(900); }
    await page.waitForTimeout(400);
    check('the nearby list opens (E held / button)', await page.evaluate(() => getComputedStyle(document.querySelector('#hud .nearl')).display !== 'none'));
    await ishot('07-nearby-list');
    const first = await rect('#hud .nearl .nr');
    if (!prof.hasTouch) await page.keyboard.up('KeyE');
    if (first) { if (prof.hasTouch) await page.touchscreen.tap(first.x, first.y); else await page.mouse.click(first.x, first.y); }
    await page.waitForTimeout(300);
    check('choosing from the list takes that thing', (await ev(page, () => window.__sc.mods.inv.count('coal') + window.__sc.mods.inv.count('log') + window.__sc.mods.inv.count('biscuit'))) >= 1);
    // the sled is a second container while it is dragged
    await ev(page, () => {
      const S = window.__sc, I = S.mods.inv; I.clearInventory(); I.giveStartKit(); S.give('log', 3); S.give('coal', 10); S.hitchSled();
      I.inv.sled.slots[0] = { id: 'seal_meat', n: 4 }; I.inv.sled.slots[1] = { id: 'stone', n: 6 }; I.inv.sled.slots[2] = { id: 'sealskin', n: 2 };
    });
    await togglePanel();
    check('the dragged sled shows as a second grid', await page.evaluate(() => !!document.querySelector('#hud .pnl [data-z="sled"]')));
    const logCell = await ev(page, () => window.__sc.mods.inv.inv.slots.findIndex(s => s && s.id === 'log'));
    await tapCell('inv', logCell);                                      // logs -> sled by the «В нарты» button
    const toSled = await page.$('#hud .pnl [data-act="move"]');
    if (toSled) { const r = await rect('#hud .pnl [data-act="move"]'); if (prof.hasTouch) await page.touchscreen.tap(r.x, r.y); else await page.mouse.click(r.x, r.y); await page.waitForTimeout(300); }
    check('«В нарты» moves the stack onto the sled', await ev(page, () => window.__sc.mods.inv.inv.sled.slots.some(s => s && s.id === 'log')));
    await ishot('08-sled');
    await togglePanel();
    void setup;
  }
  await shot(page, prof, '09-final');
  if (errors.length) { failures += errors.length; log(`  ERRORS:\n    ` + errors.join('\n    ')); } else log('  no console errors');
  await ctx.close();
}

// ---- in-game self-test (headless) ----
if (!args.includes('--noselftest')) {
  log('\n[selftest] running #selftest on desktop...');
  const prof = PROFILES[0];
  const { ctx, page, errors } = await openPage(prof, '#selftest');
  await page.waitForFunction(() => window.__selftestReport, null, { timeout: 480000 });
  const report = await page.evaluate(() => window.__selftestReport);
  const text = report.split('\n').filter(l => !/fps/i.test(l)).join('\n');
  writeFileSync(path.join(shots, 'selftest.txt'), text + '\n');
  const lines = text.split('\n');
  log('  ' + lines[0]);
  const fails = lines.filter(l => l.startsWith('FAIL'));
  const mine = fails;
  for (const l of fails) log('  ' + l.slice(0, 240));
  check('self-test: no failures', mine.length === 0, `${mine.length} failing`);
  if (errors.length) { failures += errors.length; log('  ERRORS:\n    ' + errors.join('\n    ')); }
  await ctx.close();
}
await browser.close();
if (failures) { console.error(`\nFAILED: ${failures} problem(s)`); process.exit(1); }
log('\ne2e ok');
