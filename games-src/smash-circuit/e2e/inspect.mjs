// Draw-call / triangle breakdown of a running race on a phone profile.
// Usage: node e2e/inspect.mjs [--no-build] [--quality=medium] [--track=t1]
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const PORT = Number(process.env.E2E_PORT) || 4198;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!args.includes('--no-build')) spawnSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: root });
const server = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
for (let i = 0; i < 240; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch { /* not up yet */ } await sleep(500); }
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.goto(`http://localhost:${PORT}/?debug`);
await page.waitForFunction(() => window.__game?.state === 'menu', null, { timeout: 90000 });
await page.evaluate((q) => { const g = window.__game; g.setSettings({ ...g.save.settings, quality: q, controls: 'buttons', controlsPicked: true, tutorialDone: true }); }, opt('quality', 'medium'));
await page.evaluate((id) => window.__game.startRace(id), opt('track', 't1'));
await page.waitForFunction(() => window.__game.sim?.race.phase === 'racing', null, { timeout: 60000 });
await sleep(2500);
const r = await page.evaluate(() => ({ dc: window.__render.drawCalls, tr: window.__render.triangles, q: window.__render.quality, rows: window.__render.inspect().slice(0, 40) }));
console.log(JSON.stringify({ drawCalls: r.dc, triangles: r.tr, quality: r.q }));
for (const x of r.rows) console.log(String(x.tris).padStart(8), String(x.instances).padStart(6), x.cast ? 'cast' : '    ', x.name);
await browser.close();
server.kill();
