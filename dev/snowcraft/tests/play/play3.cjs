// Plays the first day of SNOWCRAFT like a player: real keyboard and mouse events (Playwright), time advanced synchronously with window.__sc.step(n).
//   node tests/play/play3.cjs <abs path to a built index.html> [out dir for screenshots]       (NODE_PATH=/opt/node-tools/node_modules if playwright is global)
// Steps: coal (E) -> dig the buried door with the shovel -> light the stove (matches) -> barometer -> keeper's log in the shelf chest (search panel, take all)
//        -> shovel + knife: cut snow blocks out of the drift -> place blocks (the blocks must land on the BELT) -> C bag -> Ctrl+wheel zoom.
// Long walks are shortened with teleport() (walking itself is proven by shots/play/play2.cjs); everything that matters (E, LMB, keys, panels) is real input.
const path = require('path');
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const INDEX = process.argv[2], OUT = process.argv[3] || '.';
if (!INDEX) { console.error('usage: node play3.cjs <index.html> [outdir]'); process.exit(2); }
const fails = []; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails.push(m); };

(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + INDEX + '?title=0'); await p.waitForTimeout(2500);
  const ev = (f, a) => p.evaluate(f, a), step = n => ev(n => window.__sc.step(n), n);
  const st = () => ev(() => { const s = window.__sc.stats(); return { x: +s.x.toFixed(1), y: +s.y.toFixed(1), sel: s.sel, belt: s.belt.map(b => b && b.id + ':' + b.n).join(',') }; });
  const obj = () => ev(() => window.__sc.mods.quest.objectiveText()), tgt = () => ev(() => { const t = window.__sc.mods.quest.objectiveTarget(); return t ? [Math.round(t.x), Math.round(t.y)] : null; });
  const inv = id => ev(id => window.__sc.mods.inv.count(id), id), cell = (x, y) => ev(([x, y]) => window.__sc.cell(Math.round(x), Math.round(y)), [x, y]);
  const shot = n => p.screenshot({ path: path.join(OUT, 'play3-' + n + '.png') });
  const w2s = (x, y) => ev(([x, y]) => window.__sc.worldToScreen(x, y), [x, y]);
  const tap = async (k, f = 4) => { await p.keyboard.down(k); await step(2); await p.keyboard.up(k); await step(f); };
  const hover = async (x, y) => { const [sx, sy] = await w2s(x, y); await p.mouse.move(sx, sy); await step(2); };
  const T = () => ev(() => { const t = window.__sc.mods.tools.target(); return { ok: t.ok, mode: t.mode, verb: t.verb, reason: t.reason }; });
  const solid = async (tx, ty) => { let n = 0; for (const [i, j] of [[1, 1], [2, 2], [1, 3], [3, 1]]) { const m = await cell(tx * 4 + i, ty * 4 + j); if (m >= 1 && m <= 3) n++; } return n >= 2; };
  const tp = (x, y) => ev(([x, y]) => window.__sc.teleport(x, y), [x, y]);

  const walk = async (x, tol = 6) => { let last = (await st()).x, stuck = 0;
    for (let f = 0; f < 1200; f += 6) { const s = await st(), dx = x - s.x; if (Math.abs(dx) < tol) break; const k = dx > 0 ? 'd' : 'a';
      await p.keyboard.down(k); await step(6); await p.keyboard.up(k); const nx = (await st()).x; stuck = Math.abs(nx - last) < 0.4 ? stuck + 1 : 0; last = nx;
      if (stuck >= 2) { await p.keyboard.down(' '); await step(8); await p.keyboard.up(' '); stuck = 0; } } };
  // 1. coal: walk with real keys to the arrow target, E
  ok(/уголь/.test(await obj()), 'first objective: ' + await obj());
  { await walk((await tgt())[0]); await tap('e', 10); }
  ok((await inv('coal')) > 0 && /Откопай/.test(await obj()), 'E picked the coal; next: ' + await obj());
  // 2. the buried door: shovel (slot 2 is selected), LMB on the tiles under the feet and in the door front
  { await walk(694, 2);
    for (let it = 0; it < 150 && /Откопай/.test(await obj()); it++) {
      const s = await st(), ptx = Math.floor(s.x / 4), fty = Math.floor((s.y - 1) / 4);
      if (s.y > 272) { await p.keyboard.down(' '); await step(10); await p.keyboard.up(' '); }
      const cands = [[ptx - 1, fty + 1], [ptx, fty + 1]]; for (const tx of [171, 172]) for (let ty = fty + 1; ty >= fty - 3; ty--) cands.push([tx, ty]);
      let did = false;
      for (const [tx, ty] of cands) { if (!(await solid(tx, ty))) continue; await hover(tx * 4 + 2, ty * 4 + 2); const t = await T(); if (!t.ok || t.mode !== 'dig') continue;
        await p.mouse.down(); for (let k = 0; k < 8; k++) { await step(6); if (!(await solid(tx, ty))) break; } await p.mouse.up(); await step(2); did = true; break; }
      if (!did) { await p.keyboard.down('a'); await step(10); await p.keyboard.up('a'); }
      if (it === 0) await shot('door-pit');
    }
    // the door itself: stand in front of it and press E (the closed door in front wins over everything beside it)
    ok(/печь/.test(await obj()), 'the door is dug out, next: ' + await obj()); }
  // 3. the stove: stand at the stove, matches (key 3), E. The kettle, damper and shutter next to it must not steal E.
  { const t = await tgt(); await tp(t[0] + 5, 272); await step(20); await ev(() => { window.__sc.G.player.face = -1; }); await tap('3', 4); await tap('e', 20); await step(30);
    ok(/барометр/.test(await obj()), 'E at the stove lit it, next: ' + await obj()); await shot('stove'); }
  // 4. barometer: west of the house, the cursor on the instrument, E
  { const t = await tgt(); await tp(t[0] - 6, 272); await step(30); await hover(t[0], t[1]); await tap('e', 20); await step(20);
    ok(/журнал/.test(await obj()), 'barometer read, next: ' + await obj()); }
  // 5. the shelf chest: cursor on it, E opens the search panel, wait until it is searched, «Взять всё»
  { await tp(638, 272); await step(30); await hover(641, 268); await tap('e', 10); await step(30);
    ok(await ev(() => /Обыскиваю/.test(document.body.innerText)), 'search panel open with «Обыскиваю…»'); await shot('search');
    for (let i = 0; i < 40 && (await ev(() => /Обыскиваю/.test(document.body.innerText))); i++) await step(30);
    const all = p.getByText('Взять всё'); if (await all.count()) { await all.first().click(); await step(10); }
    const close = p.getByText('Закрыть ящик'); if (await close.count()) { await close.first().click(); await step(10); }
    ok(/★|Утепли/.test(await obj()), 'keeper log read (E on the box + take all), next: ' + await obj()); }
  if (await ev(() => document.body.classList.contains('panel-open'))) { await tap('c', 10); await step(10); }          // «Закрыть ящик» leaves the bag itself open: C closes it
  // 6. blocks: in a pit of the lee snow field west of the station shovel the crown, knife-cut blocks, place them on the ground
  { await tp(528, 236); await step(40);
    let s = await st(), ptx = Math.floor(s.x / 4), fty = Math.floor((s.y - 1) / 4);
    const dig = async (tx, ty) => { await hover(tx * 4 + 2, ty * 4 + 2); const t = await T(); if (process.env.DBG) console.log('   dig probe', tx, ty, JSON.stringify(t), await solid(tx, ty)); if (!t.ok) return; await p.mouse.down(); for (let k = 0; k < 10; k++) { await step(6); if (!(await solid(tx, ty))) break; } await p.mouse.up(); await step(3); };
    await tap('2', 3); await dig(ptx - 1, fty + 1); await dig(ptx, fty + 1); await step(20);
    s = await st(); ptx = Math.floor(s.x / 4); fty = Math.floor((s.y - 1) / 4);
    await tap('1', 3); let frames = [];
    if (process.env.DBG) console.log('   pit', JSON.stringify(s), 'sel', (await st()).sel, '\n' + await ev(([a, b, c, d]) => window.__sc.ascii(a, b, c, d, 1), [ptx * 4 - 16, fty * 4 - 4, ptx * 4 + 20, fty * 4 + 12]));
    for (const dx of [-2, -1, 0, 1]) { const tx = ptx + dx, ty = fty + 1; await hover(tx * 4 + 2, ty * 4 + 2); const t = await T(); if (process.env.DBG) console.log('   cut probe', dx, JSON.stringify(t), JSON.stringify(s));
      if (t.ok && t.mode === 'cut') { const before = await inv('snow_block'); let f = 0; await p.mouse.down(); for (let k = 0; k < 40 && (await inv('snow_block')) === before; k++) { await step(4); f += 4; } await p.mouse.up(); await step(3); frames.push(f); } }
    const blocks = await inv('snow_block'), beltHas = (await st()).belt.includes('snow_block');
    ok(blocks >= 2 && beltHas, `cut ${blocks} blocks (${frames.join('/')} frames each), they lie on the belt: ${(await st()).belt}`); ok(frames.every(f => f <= 70), 'each block cut in about half a second');
    // climb out and place on the ground
    await p.keyboard.down('d'); await p.keyboard.down(' '); await step(20); await p.keyboard.up(' '); await step(16); await p.keyboard.up('d');
    const slot = (await st()).belt.split(',').findIndex(x => x.startsWith('snow_block')); await tap(String(slot + 1), 3);
    let placed = 0; const b0 = await inv('snow_block'), probes = [];
    for (let k = 0; k < 16 && placed < 1; k++) { const s2 = await st(), x = s2.x + (k % 2 ? 1 : -1) * (8 + (k >> 1) * 6); let y = 150; while (y < 290 && (await cell(x, y)) === 0) y++; await hover(x, y - 2); const t = await T(); probes.push(Math.round(x) + ',' + y + ' ' + JSON.stringify(t));
      if (t.mode === 'place' && t.ok) { await p.mouse.down(); await step(4); await p.mouse.up(); await step(6); if ((await inv('snow_block')) < b0) placed++; } }
    ok(placed >= 1, 'a block was placed on the ground with LMB' + (placed >= 1 ? '' : ' | player ' + JSON.stringify(await st()) + ' | probes ' + probes.join(' ; '))); await shot('blocks'); }
  // 7. the bag (C) and the zoom (Ctrl + wheel)
  { await tap('c', 10); await step(20); ok(await ev(() => document.body.classList.contains('panel-open')), 'C opens the bag'); await shot('bag'); await tap('c', 10); await step(10);
    ok(!(await ev(() => document.body.classList.contains('panel-open'))), 'C closes the bag');
    const z0 = await ev(() => window.__sc.zoom.index()); await p.mouse.move(640, 300); await p.keyboard.down('Control'); await p.mouse.wheel(0, -120); await step(10); await p.keyboard.up('Control'); await step(10);
    ok((await ev(() => window.__sc.zoom.index())) !== z0, 'Ctrl+wheel changes the zoom ' + z0 + ' -> ' + await ev(() => window.__sc.zoom.index())); }
  ok(errs.length === 0, 'no console errors ' + JSON.stringify(errs.slice(0, 3)));
  await b.close();
  console.log(fails.length ? 'FAILED: ' + fails.length : 'play3 ok');
  process.exit(fails.length ? 1 : 0);
})();
