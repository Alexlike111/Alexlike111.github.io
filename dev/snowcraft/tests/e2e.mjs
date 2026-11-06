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
    const crafted = S.craft('fat_lamp_stone');
    // place the lamp inside by hand, then light it with E
    const pl = S.place('fat_lamp', ig.L + 3, 67);
    const lamp = G.fixtures.find(f => f.kind === 'fat_lamp');
    S.mods.fixtures.interact(lamp);                       // add fat
    S.mods.fixtures.interact(lamp);                       // light it
    return { crafted, placed: pl.placed, lamp: !!lamp, lit: lamp && lamp.lit, fuel: lamp && lamp.fuel, ig };
  });
  check('fat lamp crafted at the table, placed and lit', igl.crafted && igl.placed && igl.lit, JSON.stringify(igl));
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
    const crafts = { camp: S.craft('campfire'), torch: S.craft('torch') };
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
    const t0 = G.time; F.interact(bed);
    const ok = p.sleeping && G.timeScale === 20;
    S.stepFast(120);
    const dt = G.time - t0; const e1 = p.energy;
    return { ok, dt, e1, sleeping: p.sleeping, shelter: G.shelter && { closed: G.shelter.closed, vent: G.shelter.vent, temp: +G.shelter.temp.toFixed(1) } };
  });
  check('sleep in a bed: time x20 and energy restored', sleep.ok && sleep.dt > 80 && sleep.e1 > 31, JSON.stringify(sleep));
  await shot(page, prof, '06-sleep');
  await ev(page, () => { const S = window.__sc; S.G.player.sleeping = false; S.G.timeScale = 1; S.setTime(10 * 60); });

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
    const t = await ev(page, () => {
      const ids = ['tb-act', 'tb-jump', 'tb-take', 'tb-belt', 'tb-bag', 'tb-jour', 'tb-parka'];
      const rects = ids.map(i => { const r = document.getElementById(i).getBoundingClientRect(); return { i, w: Math.round(r.width), h: Math.round(r.height) }; });
      return { rects, portraitOverlay: getComputedStyle(document.getElementById('rotate')).display };
    });
    check('touch buttons present, >= 56 px', t.rects.every(r => r.w >= 56 && r.h >= 50), JSON.stringify(t.rects));
    check('no rotate overlay in landscape', t.portraitOverlay === 'none');
    // stick: synthetic touch pointer events
    const st = await ev(page, () => {
      const S = window.__sc; S.setWeather({ ambientT: -20, wind: 0, storm: 0, snowfall: 0 });
      S.arena(1000, 272, { dens: 300, loose: 0, depth: 40, up: 70 }); S.teleport(960, 272); S.step(15);
      const stage = document.getElementById('stage');
      const fire = (el, type, x, y, id = 7) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: true }));
      const x0 = S.G.player.x;
      fire(stage, 'pointerdown', 120, 300); fire(window, 'pointermove', 190, 300);
      S.stepFast(40); const moved = S.G.player.x - x0;
      fire(window, 'pointerup', 190, 300); S.stepFast(10);
      // up on the stick = jump
      fire(stage, 'pointerdown', 120, 300, 8); fire(window, 'pointermove', 120, 240, 8);
      let hi = 0; const y0 = S.G.player.y; for (let i = 0; i < 30; i++) { S.stepFast(1); hi = Math.max(hi, y0 - S.G.player.y); }
      fire(window, 'pointerup', 120, 240, 8); S.stepFast(30);
      // Действие button with the smart cursor digs the snow in front
      S.selectItem('shovel'); S.mods.inv.held.load = 0;
      const act = document.getElementById('tb-act');
      const before = S.testkit.count(1, 940, 200, 1100, 290);
      fire(act, 'pointerdown', 700, 330, 9); S.stepFast(60); fire(act, 'pointerup', 700, 330, 9); S.stepFast(5);
      return { moved, hi, load: S.mods.inv.held.load, tgt: S.mods.tools.target().mode };
    });
    check('floating stick walks the player', st.moved > 15, JSON.stringify(st));
    check('stick up = jump', st.hi > 6, JSON.stringify(st));
    await shot(page, prof, '07-touch');
    // belt radial
    await page.touchscreen.tap(Math.round(prof.viewport.width - 140), Math.round(prof.viewport.height - 110));
    await page.waitForTimeout(300);
    await shot(page, prof, '08-radial');
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
  const mine = fails.filter(l => !/^FAIL \[sim\]/.test(l));
  for (const l of fails) log('  ' + l.slice(0, 240));
  check('self-test: no failures in the gameplay core', mine.length === 0, `${mine.length} failing`);
  if (fails.length > mine.length) log(`  note: ${fails.length - mine.length} failing [sim] test(s) belong to the engine owner`);
  if (errors.length) { failures += errors.length; log('  ERRORS:\n    ' + errors.join('\n    ')); }
  await ctx.close();
}
await browser.close();
if (failures) { console.error(`\nFAILED: ${failures} problem(s)`); process.exit(1); }
log('\ne2e ok');
