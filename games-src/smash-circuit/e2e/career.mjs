// Career e2e (Playwright): menu -> Career -> cup list (locks) -> cup page (star goals) -> race -> results (stars, points) -> next race
// -> ... -> podium -> unlock of the next cup -> save persisted. Phone portrait + landscape, EN + RU. Also audits touch targets and
// truncated text on every career screen. Usage: node e2e/career.mjs [--no-build]   (needs a production build; builds unless --no-build)
// Screenshots: e2e/out/career/*.png. Exit code 1 on any failed check.
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const OUT = path.join(here, 'out', 'career');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 5200 + Math.floor(Math.random() * 3000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  - ' + detail : ''}`); };

if (!process.argv.includes('--no-build')) {
  const b = spawnSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: root, encoding: 'utf8' });
  if (b.status !== 0) { console.error(b.stdout, b.stderr); process.exit(2); }
}
const srv = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
await sleep(2500);
const browser = await chromium.launch();

const small = () => [...document.querySelectorAll('#ui button, #ui [role=button], #ui [data-act]')].map((e) => {
  const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
  if (!r.width || !r.height || cs.visibility === 'hidden' || cs.pointerEvents === 'none') return null;
  return { act: e.dataset.act || e.className.toString().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) };
}).filter((x) => x && (x.w < 44 || x.h < 44));
const trunc = () => [...document.querySelectorAll('#ui *')].filter((e) => getComputedStyle(e).textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim().slice(0, 24));
/** Anything of the screen that sticks out of the viewport horizontally (vertical scroll bodies are fine). */
const overflowX = () => document.documentElement.scrollWidth > innerWidth + 1;

async function run(label, vp, lang) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const L = (s) => `[${label}] ${s}`;
  const shot = (n) => page.screenshot({ path: path.join(OUT, `${label}-${n}.png`) });
  const problems = [];
  const audit = async (name) => {
    for (const x of await page.evaluate(small)) problems.push(`${label} ${name}: target ${x.w}x${x.h} (${x.act})`);
    for (const x of await page.evaluate(trunc)) problems.push(`${label} ${name}: truncated "${x}"`);
    if (await page.evaluate(overflowX)) problems.push(`${label} ${name}: horizontal overflow`);
  };
  await page.goto(`http://localhost:${PORT}/?debug`);
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 30000 });
  await page.evaluate(() => { const g = window.__game; g.setSettings({ ...g.save.settings, tutorialDone: true, controlsPicked: true }); g.menu(); });
  await sleep(500);
  if (lang !== 'en') {   // switch the language like a player does (the settings screen also re-inits the dictionary)
    await page.click('[data-act=settings]'); await sleep(300);
    await page.click(`[data-act=set][data-k=lang][data-v=${lang}]`); await sleep(300);
    await page.click('[data-act=back]'); await sleep(400);
    check(L(`language is ${lang}`), await page.evaluate((l) => document.documentElement.lang === l && /[А-Яа-я]/.test(document.querySelector('.menu [data-act=career]')?.textContent ?? ''), lang));
  }

  // ---- menu: Career is the primary button, Quick race stays
  const menu = await page.evaluate(() => ({ career: !!document.querySelector('.menu [data-act=career]'), quick: !!document.querySelector('.menu [data-act=play]'), garage: !!document.querySelector('.menu [data-act=garage]'), settings: !!document.querySelector('.menu [data-act=settings]'),
    careerFirst: document.querySelector('.menu-buttons > :first-child')?.getAttribute('data-act') }));
  check(L('menu has Career (first), Quick race, Garage, Settings'), menu.career && menu.quick && menu.garage && menu.settings && menu.careerFirst === 'career', JSON.stringify(menu));
  await audit('menu'); await shot('01-menu');

  // ---- career hub
  await page.click('[data-act=career]'); await sleep(400);
  const hub = await page.evaluate(() => ({ cards: document.querySelectorAll('.card.cup').length, locked: [...document.querySelectorAll('.card.cup')].map((c) => c.classList.contains('locked')) }));
  check(L('hub lists 4 cups, only the first is open'), hub.cards === 4 && JSON.stringify(hub.locked) === '[false,true,true,true]', JSON.stringify(hub));
  await audit('hub'); await shot('02-hub');
  await page.click('.card.cup.locked');
  const toast = await page.waitForSelector('.toast', { timeout: 5000 }).then(() => true).catch(() => false);   // the toast lives ~2 s: wait for it, do not sleep
  check(L('a locked cup shows a hint and stays on the list'), toast && await page.evaluate(() => !!document.querySelector('.c-cups')));
  await shot('03-locked-toast');

  // ---- cup page with the star goals of the next race
  await page.click('[data-act=cCup][data-id=rookie]'); await sleep(400);
  const cup = await page.evaluate(() => ({ goals: document.querySelectorAll('.c-goals li').length, races: document.querySelectorAll('.c-races li').length, go: !!document.querySelector('[data-act=cGo]'), standings: !!document.querySelector('.c-stand') }));
  check(L('cup page shows 3 star goals, the race list and a GO button'), cup.goals === 3 && cup.races === 3 && cup.go && cup.standings, JSON.stringify(cup));
  await audit('cup'); await shot('04-cup');

  // ---- race 1
  await page.click('[data-act=cGo]');
  await page.waitForFunction(() => window.__game.state === 'racing' && window.__game.sim, null, { timeout: 30000 });
  const r1 = await page.evaluate(() => ({ cars: window.__game.sim.cars.length, laps: window.__game.sim.race.totalLaps, track: window.__game.sim.track.def.id, names: window.__game.sim.cars.map((c) => c.name) }));
  check(L('cup race 1 starts: t1, 2 laps, 8 cars'), r1.cars === 8 && r1.laps === 2 && r1.track === 't1', JSON.stringify(r1));
  await sleep(1500);
  await page.evaluate(() => window.__game.forceFinish()); await sleep(500);
  const res1 = await page.evaluate(() => ({ career: !!document.querySelector('.rescard.career'), goals: document.querySelectorAll('.c-res-goals li').length, next: !!document.querySelector('[data-act=cNext]'), pts: document.querySelector('.c-res-h b')?.textContent, run: window.__game.save.career.run?.results.length }));
  check(L('results show points, 3 star goals and Next race'), res1.career && res1.goals === 3 && res1.next && /\d/.test(res1.pts ?? '') && res1.run === 1, JSON.stringify(res1));
  await audit('results'); await shot('05-results');

  // ---- race 2 (next race keeps the same rivals)
  await page.click('[data-act=cNext]');
  await page.waitForFunction(() => window.__game.state === 'racing' && window.__game.sim && window.__game.sim.track.def.id === 't2', null, { timeout: 30000 });
  const r2 = await page.evaluate(() => ({ laps: window.__game.sim.race.totalLaps, names: window.__game.sim.cars.map((c) => c.name) }));
  check(L('next race: t2 with the same 7 rivals'), r2.laps === 2 && JSON.stringify(r2.names) === JSON.stringify(r1.names), JSON.stringify(r2.names));
  await sleep(800);
  await page.evaluate(() => window.__game.forceFinish()); await sleep(400);

  // ---- race 3: give the player enough stars first so finishing the cup opens the Turbo Cup
  await page.click('[data-act=cNext]');
  await page.waitForFunction(() => window.__game.state === 'racing' && window.__game.sim && window.__game.sim.race.totalLaps === 3, null, { timeout: 30000 });
  await page.evaluate(() => { const c = window.__game.save.career; c.stars['rookie:0'] = 7; c.stars['rookie:1'] = 7; });
  await sleep(800);
  await page.evaluate(() => window.__game.forceFinish()); await sleep(500);
  const res3 = await page.evaluate(() => ({ btn: document.querySelector('[data-act=cNext] span')?.textContent, done: window.__game.save.career.cups.rookie?.done, unlock: !!document.querySelector('.rescard .unlock') }));
  check(L('last race closes the cup and offers the cup results'), res3.done === true && res3.unlock, JSON.stringify(res3));
  await audit('results-last'); await shot('06-results-last');

  // ---- podium
  await page.click('[data-act=cNext]'); await sleep(900);
  const pod = await page.evaluate(() => ({ steps: document.querySelectorAll('.pd').length, done: !!document.querySelector('[data-act=cDone]'), state: window.__game.state }));
  check(L('podium shows three steps and a continue button'), pod.steps === 3 && pod.done && pod.state === 'menu', JSON.stringify(pod));
  await audit('podium'); await shot('07-podium');
  await page.click('[data-act=cDone]'); await sleep(400);
  const hub2 = await page.evaluate(() => ({ locked: [...document.querySelectorAll('.card.cup')].map((c) => c.classList.contains('locked')), done: !!document.querySelector('.card.cup .cup-status.ok') }));
  check(L('Turbo Cup is open after the Rookie Cup, Rookie marked completed'), hub2.locked[1] === false && hub2.locked[2] === true && hub2.done, JSON.stringify(hub2));
  await audit('hub-after'); await shot('08-hub-after');

  // ---- cup page with a finished run + a fresh one
  await page.click('[data-act=cCup][data-id=rookie]'); await sleep(300);
  await shot('09-cup-finished');
  await page.click('[data-act=back]'); await sleep(200);
  await page.click('[data-act=cCup][data-id=turbo]'); await sleep(300);
  await audit('cup2'); await shot('10-cup2');

  // ---- progress is saved and survives a reload
  await sleep(500);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 30000 });
  await sleep(800);
  const saved = await page.evaluate(() => ({ v: window.__game.save.version, done: window.__game.save.career.cups.rookie?.done, stars: Object.keys(window.__game.save.career.stars).length, money: window.__game.save.money }));
  check(L('career progress persists across a reload (save v3)'), saved.v === 3 && saved.done === true && saved.stars >= 2, JSON.stringify(saved));

  // ---- quick race still works
  await page.click('[data-act=play]'); await sleep(300);
  check(L('Quick race opens the track list'), await page.evaluate(() => !!document.querySelector('.card.track')));
  await page.click('[data-act=track][data-id=t1]');
  await page.waitForFunction(() => window.__game.state === 'racing' && window.__game.sim, null, { timeout: 30000 });
  check(L('Quick race t1 keeps its own lap count and no career block'), await page.evaluate(() => window.__game.sim.race.totalLaps === window.__game.sim.track.def.laps));
  await page.evaluate(() => window.__game.forceFinish()); await sleep(400);
  check(L('Quick race results have no career block'), await page.evaluate(() => !document.querySelector('.rescard.career') && !!document.querySelector('[data-act=retry]')));

  check(L('no console errors'), errors.length === 0, errors.slice(0, 3).join(' | '));
  check(L('layout audit: no small targets, truncation or horizontal overflow'), problems.length === 0, problems.slice(0, 6).join(' ; '));
  await ctx.close();
}

const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7);   // --only=en | --only=ru
try {
  if (only !== 'ru') {
    await run('p390x844-en', { width: 390, height: 844 }, 'en');
    await run('l844x390-en', { width: 844, height: 390 }, 'en');
  }
  if (only !== 'en') {
    await run('p390x844-ru', { width: 390, height: 844 }, 'ru');
    await run('l844x390-ru', { width: 844, height: 390 }, 'ru');
  }
} catch (e) {
  check('e2e ran to the end', false, String(e && e.stack || e).slice(0, 600));
}
await browser.close();
srv.kill();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} career checks passed; screenshots in ${OUT}`);
process.exit(failed.length ? 1 : 0);
