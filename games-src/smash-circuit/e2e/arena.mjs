// Demolition Arena e2e: phone emulation (390x844), enter the mode from the main menu, play 10 game seconds
// (a page-side hunt autopilot rams the nearest rival through the real player input), see the score change,
// then end the round and check the results screen. Run on a production build: `npm run build && node e2e/arena.mjs`.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'e2e', 'out', 'arena');
mkdirSync(OUT, { recursive: true });
const PORT = 4800 + Math.floor(Math.random() * 300);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
for (let i = 0; i < 60; i++) {   // wait for the preview server
  try { const r = await fetch(`http://localhost:${PORT}/`); if (r.ok) break; } catch { /* not up yet */ }
  await sleep(500);
}
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://localhost:${PORT}/?debug`);
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 30000 });
  await page.evaluate(() => { window.__game.save.settings.tutorialDone = true; window.__game.save.settings.controlsPicked = true; });
  const btn = page.locator('[data-act="arena"]');
  check('[arena] main menu shows the Demolition Arena button', await btn.isVisible());
  await page.screenshot({ path: path.join(OUT, 'phone-menu.png') });
  await btn.tap();
  await page.waitForFunction(() => window.__game.arena && window.__game.sim && window.__game.sim.race.phase === 'racing', null, { timeout: 30000 });
  check('[arena] tapping it starts an arena round', await page.evaluate(() => window.__game.sim.track.def.id === 'arena'));
  const hudOk = await page.locator('.arena-hud [data-k="score"]').isVisible();
  check('[arena] score HUD visible', hudOk);
  await page.screenshot({ path: path.join(OUT, 'phone-start.png') });

  // page-side hunt autopilot on the real player input path
  await page.evaluate(() => {
    const g = window.__game, sim = g.sim, orig = sim.setPlayerInput.bind(sim);
    sim.setPlayerInput = () => {
      const me = sim.cars[0];
      let best = null, bd = 1e9;
      for (const o of sim.cars) { if (o === me || g.arena.dead.has(o.id)) continue; const d = Math.hypot(o.x - me.x, o.y - me.y); if (d < bd) { bd = d; best = o; } }
      if (!best) return orig({ throttle: 0, brake: 0, steer: 0, handbrake: false });
      let e = Math.atan2(best.y - me.y, best.x - me.x) - me.angle;
      e = Math.atan2(Math.sin(e), Math.cos(e));
      orig({ throttle: 1, brake: 0, steer: Math.max(-1, Math.min(1, e * 2.2)), handbrake: false });
    };
  });
  const score0 = await page.evaluate(() => window.__game.arena.score);
  const t0 = await page.evaluate(() => window.__game.arena.time);
  await page.waitForFunction((t) => !window.__game.arena || window.__game.arena.time >= t, t0 + 10, { timeout: 120000, polling: 100 });
  await page.screenshot({ path: path.join(OUT, 'phone-10s.png') });
  const st = await page.evaluate(() => {
    const a = window.__game.arena;
    return { score: a ? a.score : -1, hud: document.querySelector('.arena-hud [data-k="score"]')?.textContent ?? '', time: a ? a.time : -1, left: document.querySelector('.arena-hud [data-k="left"]')?.textContent };
  });
  check('[arena] score changed after 10 s of play', st.score > score0, `score ${score0} -> ${st.score}, hud "${st.hud}", cars left ${st.left}`);
  check('[arena] HUD shows the score', st.hud === String(st.score), st.hud);

  // end the round: run the clock out
  const money0 = await page.evaluate(() => window.__game.save.money);
  await page.evaluate(() => { const a = window.__game.arena; if (a) a.time = 999; });
  await page.waitForSelector('.arena-res', { timeout: 20000 });
  await sleep(300);
  await page.screenshot({ path: path.join(OUT, 'phone-results.png') });
  const res = await page.evaluate(() => ({ state: window.__game.state, money: window.__game.save.money, score: document.querySelector('.arena-res [data-k="score"]')?.textContent, coins: document.querySelector('.arena-res [data-k="coins"]')?.textContent }));
  check('[arena] results show score and coins earned', res.state === 'results' && !!res.score && /^\+\d+$/.test(res.coins ?? ''), JSON.stringify(res));
  check('[arena] coins credited', res.money >= money0, `${money0} -> ${res.money}`);
  await page.locator('.arena-res [data-act="arenaMenu"]').tap();
  await page.waitForFunction(() => window.__game.state === 'menu', null, { timeout: 10000 });
  check('[arena] Menu button returns to the main menu, overlay gone', (await page.locator('.arena-res, .arena-hud').count()) === 0);
  check('[arena] no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
} catch (e) {
  check('[arena] e2e ran without exceptions', false, String(e));
} finally {
  await browser.close();
  srv.kill();
}
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} arena checks passed. Screens: ${OUT}`);
process.exit(bad.length ? 1 : 0);
