// Early-tap check for the menu warm-up: start a race the moment the menu appears (warm-up still running), race a bit, go back to
// the menu, start again. Expects no console errors and a normal GO each time. Usage: node e2e/warm-early.mjs [--no-build]
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.E2E_PORT) || 4199;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!process.argv.includes('--no-build')) spawnSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: root });
const server = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
await sleep(2500);
const browser = await chromium.launch();
const out = { ok: true, steps: [] };
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(`http://localhost:${PORT}/?debug`);
  await page.waitForFunction(() => window.__game?.state === 'menu', null, { timeout: 90000 });
  await page.evaluate(() => { const g = window.__game; g.setSettings({ ...g.save.settings, controls: 'buttons', controlsPicked: true, tutorialDone: true }); });
  for (const [i, id] of ['t1', 't1', 't1'].entries()) {
    const warmDone = await page.evaluate(() => !!window.__render?.warm);
    await page.evaluate((t) => window.__game.startRace(t), id);
    await page.waitForFunction(() => window.__game.sim?.race.phase === 'racing', null, { timeout: 60000 });
    await sleep(1200);
    const s = await page.evaluate(() => ({ state: window.__game.state, load: window.__render.load, warm: window.__render.warm ?? null, dc: window.__render.drawCalls }));
    out.steps.push({ i, warmDoneAtTap: warmDone, ...s });
    if (s.state !== 'racing' || !(s.dc > 20)) out.ok = false;
    await page.evaluate(() => window.__game.menu());
    await sleep(i === 0 ? 4000 : 800);
  }
} catch (e) { out.ok = false; out.fatal = String((e && e.stack) || e); }
out.errors = errors;
if (errors.length) out.ok = false;
await browser.close();
server.kill();
console.log(JSON.stringify(out));
process.exit(out.ok ? 0 : 1);
