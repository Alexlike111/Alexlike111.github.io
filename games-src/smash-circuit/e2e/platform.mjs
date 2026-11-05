// Platform e2e: the built game against a STUB Playgama Bridge (the real loader is replaced by a route).
// Checks the contract the platform reviews: Bridge first, game_ready after the first frame, level_* pairs, pause + audio events,
// the interstitial between races (the game pauses and resumes, nothing starts while the ad is open), rewarded doubling only
// in the 'rewarded' state, the leaderboard view (top 10, own row, error + retry) and the controls hidden when the platform has none.
// Usage: npm run build && node e2e/platform.mjs   (needs dist/; screenshots go to e2e/out/platform)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'e2e', 'out', 'platform');
mkdirSync(OUT, { recursive: true });
const PORT = 4800 + Math.floor(Math.random() * 300);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// E2E_SLOW=4 stretches every wait on a busy machine (software GL: game time runs slower than wall time)
const SLOW = Number(process.env.E2E_SLOW) || 1;
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  - ' + detail : ''}`); };

// The stub. `window.__stub` lets the test drive the platform (open/close ads, change audio / pause state, fail the leaderboard).
const STUB = (lbType) => `
(() => {
  const L = new Map();
  const emitter = { on(n, cb) { (L.get(n) || L.set(n, new Set()).get(n)).add(cb); }, off(n, cb) { L.get(n)?.delete(cb); } };
  const emit = (n, ...a) => (L.get(n) || []).forEach((cb) => cb(...a));
  const stub = { messages: [], interstitialCalls: 0, rewardedCalls: 0, scores: [], entriesCalls: 0, lbFail: false, emit };
  const rows = Array.from({ length: 12 }, (_, i) => ({ id: i === 4 ? 'me' : 'p' + i, name: i === 2 ? '<b>Zed</b>' : 'Racer ' + (i + 1), score: 58000 + i * 750, rank: i + 1, photo: null }));
  window.__stub = stub;
  window.bridge = {
    ...emitter, isInitialized: false,
    EVENT_NAME: {},
    initialize: async () => { window.bridge.isInitialized = true; },
    platform: { ...emitter, language: 'en', isAudioEnabled: true, sendMessage: async (m, o) => { stub.messages.push(o ? [m, o] : [m]); } },
    storage: { get: async (keys) => keys.map(() => null), set: async () => {} },
    player: { id: 'me' },
    advertisement: {
      ...emitter, isInterstitialSupported: true, isRewardedSupported: true, interstitialState: 'closed', rewardedState: 'closed',
      showInterstitial() { stub.interstitialCalls++; stub.lastAd = 'interstitial'; emit('interstitial_state_changed', 'loading'); emit('interstitial_state_changed', 'opened'); },
      showRewarded() { stub.rewardedCalls++; stub.lastAd = 'rewarded'; emit('rewarded_state_changed', 'loading'); emit('rewarded_state_changed', 'opened'); },
    },
    leaderboards: {
      type: ${JSON.stringify(lbType)},
      setScore: async (id, s) => { stub.scores.push([id, s]); },
      getEntries: async (id) => { stub.entriesCalls++; if (stub.lbFail) throw new Error('offline'); return rows; },
    },
  };
})();`;

const srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
// wait until the preview server answers (a fixed sleep is too short on a busy machine / CI runner)
for (let i = 0; i < 120; i++) {
  try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch { /* not up yet */ }
  await sleep(500);
}
const browser = await chromium.launch();

async function open(lbType, viewport = { width: 1280, height: 720 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.route('**/playgama-bridge.js', (r) => r.fulfill({ contentType: 'text/javascript', body: STUB(lbType) }));
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000 * SLOW);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://localhost:${PORT}/?debug`);
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 30000 * SLOW });
  await page.evaluate(() => { window.__game.save.settings.tutorialDone = true; window.__game.save.settings.controlsPicked = true; });
  return { ctx, page, errors };
}
const stub = (page, fn, arg) => page.evaluate(fn, arg);

try {
  // ---------------------------------------------------------------- in_game leaderboards
  {
    const { ctx, page, errors } = await open('in_game');
    check('game_ready is sent once the menu is up', (await stub(page, () => window.__stub.messages.map((m) => m[0]))).filter((m) => m === 'game_ready').length === 1);

    await page.click('[data-act=play]');
    await page.waitForSelector('[data-act=leaderboard]');
    check('track select offers the Leaderboard button when the platform reads entries', true);
    await page.click('[data-act=leaderboard]');
    await page.waitForSelector('.lb-row');
    const rows = await page.$$eval('.lb-row', (els) => els.map((e) => e.textContent));
    check('leaderboard shows the top 10 only', rows.length === 10, String(rows.length));
    check('own row is highlighted', (await page.$$('.lb-row.me')).length === 1);
    check('names are escaped, never injected', (await page.$$('.lb-name b')).length === 0 && rows.some((r) => r.includes('<b>Zed</b>')));
    await page.screenshot({ path: path.join(OUT, 'leaderboard-desktop.png') });
    await page.click('[data-lb=track][data-id=t2]');
    await page.waitForFunction(() => window.__stub.entriesCalls === 2);
    check('switching tab reads the other board', true);
    await stub(page, () => { window.__stub.lbFail = true; });
    await page.click('[data-lb=track][data-id=t3]');
    await page.waitForSelector('[data-lb=retry]');
    check('a failed read shows an error with a retry (no crash)', true);
    await stub(page, () => { window.__stub.lbFail = false; });
    await page.click('[data-lb=retry]');
    await page.waitForSelector('.lb-row');
    await page.click('.lb-x');
    check('close button closes it', (await page.$('.lb-layer:not([hidden])')) === null);

    // ---------------------------------------------------------------- race, pause, ads
    await page.evaluate(() => window.__game.startRace('t1'));
    await page.waitForFunction(() => window.__game.sim && window.__game.sim.race.phase === 'racing', null, { timeout: 30000 * SLOW });
    check('level_started is sent for the race', (await stub(page, () => window.__stub.messages)).some((m) => m[0] === 'level_started' && m[1]?.level === 't1'));
    const t0 = await page.evaluate(() => window.__game.sim.race.time);
    await stub(page, () => window.__stub.emit('pause_state_changed', true));
    await sleep(600);
    const t1 = await page.evaluate(() => window.__game.sim.race.time);
    check('platform pause event is handled without errors', errors.length === 0, errors.join(' | '));
    await stub(page, () => window.__stub.emit('pause_state_changed', false));
    await stub(page, () => window.__stub.emit('audio_state_changed', false));
    await stub(page, () => window.__stub.emit('audio_state_changed', true));
    check('race keeps running after pause / audio events', (await page.evaluate(() => window.__game.sim.race.time)) >= t1 && t1 >= t0);

    await page.evaluate(() => window.__game.forceFinish());
    await page.waitForFunction(() => window.__game.state === 'results', null, { timeout: 30000 * SLOW });
    check('level_completed closes the level', (await stub(page, () => window.__stub.messages)).some((m) => m[0] === 'level_completed'));
    check('results offer the Leaderboard button', (await page.$('.rescard [data-act=leaderboard]')) !== null);
    await page.screenshot({ path: path.join(OUT, 'results-desktop.png') });

    // rewarded: closing without the rewarded state grants nothing
    const money0 = await page.evaluate(() => window.__game.save.money);
    await page.click('[data-act=double]');
    await page.waitForFunction(() => window.__stub.rewardedCalls === 1);
    await stub(page, () => window.__stub.emit('rewarded_state_changed', 'closed'));
    await sleep(300);
    check('rewarded closed early: no reward', (await page.evaluate(() => window.__game.save.money)) === money0);
    await page.click('[data-act=double]');
    await page.waitForFunction(() => window.__stub.rewardedCalls === 2);
    await stub(page, () => { window.__stub.emit('rewarded_state_changed', 'rewarded'); window.__stub.emit('rewarded_state_changed', 'closed'); });
    await page.waitForFunction((m) => window.__game.save.money > m, money0, { timeout: 5000 });
    check('rewarded state doubles the reward', true);

    // interstitial between races: Race again waits for the ad, nothing starts while it is open
    const before = await page.evaluate(() => window.__stub.interstitialCalls);
    await page.click('[data-act=retry]');
    await page.waitForFunction((n) => window.__stub.interstitialCalls === n + 1, before);
    check('Race again asks for an interstitial', true);
    check('the game waits while the ad is open', (await page.evaluate(() => window.__game.state)) === 'ad');
    await stub(page, () => window.__stub.emit('interstitial_state_changed', 'closed'));
    await page.waitForFunction(() => window.__game.state === 'racing', null, { timeout: 30000 * SLOW });
    check('the next race starts after the ad closes', true);
    check('no console / page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------------------------------------------------------------- platforms without a readable leaderboard
  for (const type of ['not_available', 'native']) {
    const { ctx, page, errors } = await open(type);
    await page.click('[data-act=play]');
    await page.waitForSelector('[data-act=track]');
    check(`leaderboards.type=${type}: no leaderboard button on track select`, (await page.$('[data-act=leaderboard]')) === null);
    check(`leaderboards.type=${type}: no errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---------------------------------------------------------------- phone portrait layout of the panel
  {
    const { ctx, page } = await open('in_game', { width: 390, height: 844 });
    await page.click('[data-act=play]');
    await page.waitForSelector('[data-act=leaderboard]');
    await page.click('[data-act=leaderboard]');
    await page.waitForSelector('.lb-row');
    const fits = await page.evaluate(() => {
      const c = document.querySelector('.lb-card').getBoundingClientRect();
      return c.left >= 0 && c.right <= innerWidth && c.top >= 0 && c.bottom <= innerHeight;
    });
    check('leaderboard card fits a 390x844 phone', fits);
    await page.screenshot({ path: path.join(OUT, 'leaderboard-phone.png') });
    await ctx.close();
  }
} finally {
  await browser.close();
  srv.kill();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
