// QA: load the game headless, run a scenario, save screenshots to ./shots
// usage: node scripts/shot.mjs <scenario> [--size=1280x720] [--url=http://localhost:5190/]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
import fs from 'node:fs';
const args = process.argv.slice(2); const scen = args.find((a) => !a.startsWith('--')) || 'idle';
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const [W, Hh] = (opt.size || '1280x720').split('x').map(Number);
const url = opt.url || 'http://localhost:5190/';
fs.mkdirSync('shots', { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: W, height: Hh }, deviceScaleFactor: Number(opt.dpr || 1), hasTouch: !!opt.touch, isMobile: !!opt.touch });
const page = await ctx.newPage(); const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(url + (opt.q ? '?' + opt.q : ''));
await page.waitForFunction(() => window.__offset && window.__offset.game && window.__offset.game.level, null, { timeout: 20000 });
await page.evaluate(() => window.__offset.manual(true));
const shot = async (name) => { await page.evaluate(() => window.__offset.advance(0, true)); await page.screenshot({ path: `shots/${scen}-${name}.png` }); };
const adv = (n) => page.evaluate((n) => window.__offset.advance(n, true), n);
const state = () => page.evaluate(() => window.__offset.state());
const ev = (f, a) => page.evaluate(f, a);
const scenarios = {
  async idle() { await adv(40); await shot('a'); },
  async jump() {
    await adv(40); await shot('0');
    // light jump to the right, into the building
    await ev(() => { const g = window.__offset.game, p = g.player; p.aim.x = p.x + 7; p.aim.y = p.y - 1; p.aim.valid = p.resolveFree(p.aim.x, p.aim.y); p.aim.x = p.rx; p.aim.y = p.ry; p.tryJump(); });
    await adv(1); await shot('1'); await adv(3); await shot('2'); await adv(10); await shot('3'); await adv(40); await shot('4');
  },
  async heavy() {
    await adv(30);
    await ev(() => { const g = window.__offset.game, p = g.player; p.rb.setTranslation({ x: 3.9, y: -0.85 }, true); });
    await adv(10); await shot('0');
    await ev(() => { const g = window.__offset.game, p = g.player; p.heavyArmed = 3; p.aim.x = -5; p.aim.y = -7; p.aim.valid = true; p.aim.enemy = null; p.tryJump(); });
    await adv(1); await shot('1'); await adv(6); await shot('2'); await adv(30); await shot('3'); await adv(90); await shot('4');
  },
  async smash() {
    await adv(30);
    for (let i = 0; i < 6; i++) { await ev((i) => { const g = window.__offset.game; g.st.blast(4 + i * 1.6, -1.2, 2.2, 4000, 900); }, i); await adv(4); }
    await shot('0'); await adv(30); await shot('1'); await adv(120); await shot('2');
    console.log(JSON.stringify(await state()));
  },
};
await scenarios[scen]();
console.log('state', JSON.stringify(await state()));
if (errors.length) console.log('ERRORS:\n' + errors.slice(0, 20).join('\n')); else console.log('no console errors');
await browser.close();
