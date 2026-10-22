// Game rules check: persistence, map gating, crowd cap 1,000,000, level scaling, retreat, a real bot run.
// Usage: npm run build && node qa/game.mjs
import path from 'node:path';
import { ROOT, serve, launch } from '../scripts/lib.mjs';

const { server, url } = await serve(path.join(ROOT, 'dist'));
const browser = await launch();
const rows = [];
const check = (c, n, d = '') => rows.push([c ? 'PASS' : 'FAIL', n, d]);

const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const st = () => page.evaluate(() => window.__qa.state());
const boot = async () => {
  await page.goto(`${url}/?qa=1`);
  await page.waitForFunction(() => window.__qa?.state && document.getElementById('playBtn'), null, { timeout: 15000 });
  await page.waitForTimeout(300);
};
const toMenu = async () => {
  for (let i = 0; i < 4 && (await st()).modal; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(100); }
};

await boot();
let s = await st();
check(s.crowd === 10 && s.high === 0, 'new game: 10 jellies, only map 1 open', JSON.stringify({ crowd: s.crowd, high: s.high }));

// 1. a real run with the lane bot on map 1 (real time)
await page.click('#playBtn', { force: true });
await page.waitForFunction(() => window.__qa.state().running);
await page.evaluate(() => window.__qa.autoplay(true));
const t0 = Date.now();
await page.waitForSelector('[data-a="next"]', { timeout: 90000 });
const runSec = Math.round((Date.now() - t0) / 1000);
await page.evaluate(() => window.__qa.autoplay(false));
s = await st();
check(s.crowd > 10, 'bot run on map 1 ends with more jellies than it started', `10 -> ${s.crowd}, ${runSec}s`);
check(runSec >= 20 && runSec <= 60, 'a round lasts 20-60 s', `${runSec}s`);
const afterRun = s.crowd;
await page.screenshot({ path: path.join(ROOT, 'qa/shots/game-result.png') });
await page.click('[data-a="menu"]', { force: true });
await page.waitForSelector('#playBtn');

// 2. persistence: reload and the crowd is still there
await page.waitForTimeout(800);
await boot();
s = await st();
check(s.crowd === afterRun, 'crowd survives a page reload', `${afterRun} vs ${s.crowd}`);

// 3. gating: map 2 needs 30
await page.evaluate(() => window.__qa.setCrowd(29));
await page.click('#mapBtn');
await page.waitForSelector('[data-map="1"]');
check(await page.$eval('[data-map="1"]', (b) => b.disabled), 'map 2 is locked at 29 jellies');
await page.click('[data-map="1"]', { force: true }).catch(() => {});
check((await st()).screen === 'menu', 'tapping a locked map does nothing');
await toMenu();
await page.evaluate(() => window.__qa.setCrowd(30));
await page.click('#mapBtn');
await page.waitForSelector('[data-map="1"]');
check(!(await page.$eval('[data-map="1"]', (b) => b.disabled)), 'map 2 opens at 30 jellies');
await page.screenshot({ path: path.join(ROOT, 'qa/shots/game-map.png') });
await page.click('[data-map="1"]');
await page.waitForFunction(() => window.__qa.state().running);
s = await st();
check(s.level === 1, 'picking map 2 starts map 2', `level ${s.level}`);

// 4. maps scale with the crowd: same map, 4x crowd -> about 4x the numbers
const lv30 = await page.evaluate(() => window.__qa.level());
await page.keyboard.press('p');
await page.click('[data-a="menu"]');
await page.evaluate(() => window.__qa.setCrowd(120));
await page.click('#playBtn', { force: true });
await page.waitForFunction(() => window.__qa.state().running);
const lv120 = await page.evaluate(() => window.__qa.level());
const ratio = lv120.boss / lv30.boss;
check(lv30.index === lv120.index && lv120.scale === 120 && lv30.scale === 30, 'map scale follows the crowd (30 -> 30, 120 -> 120)', `${lv30.scale}, ${lv120.scale} on map ${lv30.index + 1}`);
check(ratio > 3 && ratio < 5, 'boss wall grows with the crowd', `x${ratio.toFixed(2)}`);

// 5. retreat on defeat keeps 90%
await page.evaluate(() => window.__qa.setCrowd(1000));
await page.evaluate(() => window.__qa.finish(false));
await page.waitForSelector('[data-a="next"]', { timeout: 8000 });
s = await st();
check(s.crowd === 900, 'defeat keeps 90% of the crowd', String(s.crowd));
await page.screenshot({ path: path.join(ROOT, 'qa/shots/game-defeat.png') });

// 6. cap 1,000,000 and the last map
await page.click('[data-a="menu"]', { force: true });
await page.waitForSelector('#playBtn');
await page.evaluate(() => window.__qa.setCrowd(950000));
await page.click('#mapBtn');
await page.waitForSelector('[data-map="11"]');
await page.click('[data-map="11"]');
await page.waitForFunction(() => window.__qa.state().running);
check((await st()).level === 11, 'map 12 opens at 950,000');
await page.evaluate(() => window.__qa.finish(true));
await page.waitForSelector('[data-a="next"]', { timeout: 8000 });
s = await st();
check(s.crowd === 1000000 && s.maxed, 'last map won: crowd is exactly 1,000,000 (max)', String(s.crowd));
check(!(await page.$('[data-a="bonus"]')), 'no bonus button at the cap');
await page.screenshot({ path: path.join(ROOT, 'qa/shots/game-max.png') });
await page.click('[data-a="menu"]', { force: true });
await page.waitForSelector('#playBtn');
await page.evaluate(() => window.__qa.setCrowd(5_000_000));
await page.evaluate(() => window.__qa.setCrowd(5_000_000));
await page.reload();
await page.waitForFunction(() => window.__qa?.state && document.getElementById('playBtn'));
s = await st();
check(s.crowd <= 1000000, 'a broken/oversized save is clamped to 1,000,000 on load', String(s.crowd));

check(errors.length === 0, 'no console errors', errors.slice(0, 3).join(' | '));
await browser.close();
server.close();
const bad = rows.filter((r) => r[0] === 'FAIL').length;
console.log(rows.map((r) => `${r[0] === 'PASS' ? '✅' : '❌'} ${r[1]}${r[2] ? ` (${r[2]})` : ''}`).join('\n') + `\n\n${bad ? `❌ ${bad} failed` : `✅ all ${rows.length} game checks passed`}`);
process.exit(bad ? 1 : 0);
