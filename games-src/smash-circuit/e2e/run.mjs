// End-to-end smoke test (Playwright, preinstalled). Usage: node e2e/run.mjs [--no-build] [--only=phone|desktop]
// Serves dist/ with `vite preview` on :4173, plays a short race on a phone profile (touch) and a desktop profile
// (keyboard), takes screenshots into e2e/out/ and writes e2e/out/report.json. Exit code 1 on console errors / failed checks.
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = path.join(here, 'out');
fs.mkdirSync(out, { recursive: true });
const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only=')) ?? '').slice(7);
const PORT = Number(process.env.E2E_PORT) || 4173;
const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!args.includes('--no-build')) {
  const b = spawnSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: root, encoding: 'utf8' });
  if (b.status !== 0) { console.error(b.stdout, b.stderr); process.exit(2); }
}

const server = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'],
  { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let up = false;
server.stdout.on('data', (d) => { if (String(d).includes('localhost')) up = true; });
server.stderr.on('data', (d) => process.stderr.write(String(d)));
for (let i = 0; i < 100 && !up; i++) await sleep(100);

const browser = await chromium.launch();
const report = { startedAt: new Date().toISOString(), profiles: {}, ok: true };

const profiles = [
  { name: 'phone', viewport: { width: 390, height: 844 }, touch: true, dpr: 2 },
  { name: 'desktop', viewport: { width: 1280, height: 720 }, touch: false, dpr: 1 },
].filter((p) => !only || p.name === only);   // --only=audit runs just the layout audit

for (const prof of profiles) {
  try { report.profiles[prof.name] = await runProfile(prof); } catch (e) {
    report.profiles[prof.name] = { fatal: String(e && e.stack || e) };
    report.ok = false;
  }
}
if (!only || only === 'audit') {
  try { report.audit = await auditLayout(); } catch (e) { report.audit = { fatal: String(e && e.stack || e) }; report.ok = false; }
  if (report.audit.problems?.length) report.ok = false;
}
await browser.close();
server.kill();
for (const p of Object.values(report.profiles)) {
  if (p.fatal || (p.errors && p.errors.length) || (p.checks && Object.values(p.checks).some((v) => v === false))) report.ok = false;
}
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);

// ------------------------------------------------------------------------------------------------

async function runProfile(prof) {
  const ctx = await browser.newContext({
    viewport: prof.viewport, deviceScaleFactor: prof.dpr, isMobile: prof.touch, hasTouch: prof.touch,
  });
  const page = await ctx.newPage();
  const errors = [], warnings = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    else if (m.type() === 'warning') warnings.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));
  const cdp = prof.touch ? await ctx.newCDPSession(page) : null;
  const R = { errors, warnings, shots: [], checks: {}, notes: {} };
  const shot = async (name) => {
    const f = `${prof.name}-${name}.png`;
    await page.screenshot({ path: path.join(out, f) });
    R.shots.push(f);
  };
  const state = () => page.evaluate(() => window.__game?.state);
  const waitState = async (s, ms = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if ((await state()) === s) return true; await sleep(100); }
    return false;
  };
  const snap = () => page.evaluate(() => {
    const g = window.__game; const s = g.sim; if (!s) return null;
    const c = s.cars[0];
    return {
      state: g.state, phase: s.race.phase, time: s.race.time, x: c.x, y: c.y, speed: c.speed, health: c.health, place: c.place, lap: c.lap,
      progress: c.progress, money: g.save.money,
      broken: s.destructibles.filter((d) => d.broken).length, stepMs: s.stepMs,
    };
  });

  await page.goto(URL, { waitUntil: 'load' });
  R.checks.menuReached = await waitState('menu', 30000);
  await sleep(1500);
  await shot('menu');
  R.checks.bootRemoved = await page.evaluate(() => !document.getElementById('boot'));
  R.notes.renderAtMenu = await page.evaluate(() => window.__render ? { ...window.__render } : null);

  // garage
  await page.click('[data-act=garage]');
  await sleep(700);
  await shot('garage');
  await page.click('[data-act=back]');
  await sleep(300);
  // track select
  await page.click('[data-act=play]');
  await sleep(700);
  await shot('tracks');
  // start t1 (touch: the one-time controls picker comes first; the legacy One finger scheme drives this profile)
  if (prof.touch) await page.evaluate(() => { const g = window.__game; g.setSettings({ ...g.save.settings, controls: 'finger', controlsPicked: false }); });
  await page.click('[data-act=track][data-id=t1]');
  if (prof.touch) {
    R.checks.controlsPicker = !!(await page.waitForSelector('.ctlpick', { timeout: 5000 }).catch(() => null));
    if (R.checks.controlsPicker) { await shot('picker'); await page.click('[data-act=ctlPickSkip]'); }
  }
  R.checks.raceStarted = await waitState('racing', 20000);
  await sleep(600);
  await shot('race-start');
  // dismiss tutorial when present
  const tut = await page.$('[data-act=tutorialOk]');
  if (tut) { await tut.click(); await sleep(200); }

  // wait for GO
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    const s = await snap();
    if (s && s.phase === 'racing') break;
    await sleep(100);
  }

  const drv = makeDriver(page, cdp, prof);
  await drv.start();
  const startSnap = await snap();
  // drive 8 s following the track with a simple pure-pursuit "player"
  const drive = async (ms, mode) => {
    const t1 = Date.now();
    while (Date.now() - t1 < ms) {
      const steer = mode === 'crash' ? 1 : await page.evaluate(() => {
        const s = window.__game.sim; const c = s.cars[0];
        const p = s.track.nearest(c.x, c.y);
        const look = 14 + Math.abs(c.speed) * 0.45;
        const tp = s.track.sampleAt(p.s + look);
        let err = Math.atan2(tp.y - c.y, tp.x - c.x) - c.angle;
        while (err > Math.PI) err -= 2 * Math.PI;
        while (err < -Math.PI) err += 2 * Math.PI;
        return Math.max(-1, Math.min(1, -err * 1.8));
      });
      await drv.steer(steer);
      await sleep(40);
    }
  };
  // lowest health / peak speed since the drive began (an instantaneous reading is flaky: the pursuit driver can graze a wall at the sample moment)
  await page.evaluate(() => { window.__minHealth = 1; window.__peakSpeed = 0; window.__minHealthT = setInterval(() => { const c = window.__game.sim?.cars[0]; if (c) { window.__minHealth = Math.min(window.__minHealth, c.health); window.__peakSpeed = Math.max(window.__peakSpeed, c.speed); } }, 40); });
  await drive(8000, 'follow');
  const peakSpeed = await page.evaluate(() => window.__peakSpeed);
  const mid = await snap();
  await shot('mid-race');
  R.notes.start = startSnap;
  R.notes.mid = mid;
  R.checks.carMoved = !!(startSnap && mid && Math.hypot(mid.x - startSnap.x, mid.y - startSnap.y) > 40 && Math.max(mid.speed, peakSpeed) > 8);
  R.checks.progressed = !!(mid && mid.progress > 40);

  // FPS: 10 s of driving, rAF count and renderer fps
  const fpsInfo = await page.evaluate(() => {
    window.__rafCount = 0; window.__rafOn = true;
    const tick = () => { window.__rafCount++; if (window.__rafOn) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    return performance.now();
  });
  await drive(10000, 'follow');
  const fps = await page.evaluate((t0f) => {
    window.__rafOn = false;
    const dur = (performance.now() - t0f) / 1000;
    return { raf: window.__rafCount / dur, render: window.__render?.fps ?? null, drawCalls: window.__render?.drawCalls, triangles: window.__render?.triangles, quality: window.__render?.quality, cpuMs: window.__render?.cpuMs, stepMs: window.__game.sim.stepMs };
  }, fpsInfo);
  R.notes.fps = fps;
  await shot('race-fast');

  // one-finger brake: pulling the GAS finger down must brake (touch only)
  if (prof.touch) {
    await drv.pull(0.5);
    await sleep(400);
    const braking = await page.evaluate(() => window.__game.sim.cars[0].brake);
    await drv.steer(0);   // finger back to the GAS button height
    await sleep(300);
    const gassing = await page.evaluate(() => window.__game.sim.cars[0].throttle);
    R.notes.brakeGesture = { braking, gassing };
    R.checks.oneFingerBrake = braking > 0.5 && gassing > 0.5;
  }

  // crash into the wall: full lock
  const before = await snap();
  // lowest health during the crash window: the starter car repairs itself after a quiet spell (car trait), so the end value alone can be higher
  await drive(5000, 'crash');
  const after = await snap();
  const minHealth = await page.evaluate(() => { clearInterval(window.__minHealthT); return window.__minHealth; });
  await sleep(200);
  await shot('crash');
  R.notes.crash = { before, after, minHealth };
  R.checks.crashDamaged = !!(before && after && (Math.min(after.health, minHealth) < Math.min(before.health, startSnap?.health ?? 1) - 0.001 || after.broken > before.broken || minHealth < 0.999));
  await drv.release();

  // repair by key (desktop) - with money
  if (!prof.touch) {
    await page.evaluate(() => { window.__game.save.money; });
    await page.keyboard.press('KeyR');
    await sleep(300);
  }

  // pause
  if (prof.touch) await page.click('[data-act=pauseBtn]'); else await page.keyboard.press('KeyP');
  await sleep(500);
  R.checks.paused = (await state()) === 'paused';
  const p1 = await snap();
  await sleep(700);
  const p2 = await snap();
  R.checks.pauseFreezes = !!(p1 && p2 && Math.abs(p2.time - p1.time) < 0.01);
  await shot('pause');
  // repair button inside pause menu when affordable
  const rb = await page.$('.layer-overlay [data-act=repair]:not([disabled])');
  if (rb) { await rb.click().catch(() => undefined); await sleep(300); }
  await page.click('.layer-overlay [data-act=resume]');
  await sleep(300);
  R.checks.resumed = (await state()) === 'racing';
  R.notes.afterRepair = await snap();

  // results (desktop: with a stubbed ad platform so the rewarded x2 + interstitial flow is exercised)
  if (!prof.touch) {
    await page.evaluate(() => {
      const b = window.bridge; const subs = {};
      const emit = (n, v) => (subs[n] || []).slice().forEach((f) => f(v));
      window.__adLog = [];
      const ad = {
        isRewardedSupported: true, isInterstitialSupported: true,
        on: (n, f) => { (subs[n] ||= []).push(f); }, off: (n, f) => { subs[n] = (subs[n] || []).filter((x) => x !== f); },
        showRewarded() { window.__adLog.push('rewarded:' + window.__game.state); setTimeout(() => { emit('rewarded_state_changed', 'opened'); setTimeout(() => { emit('rewarded_state_changed', 'rewarded'); emit('rewarded_state_changed', 'closed'); }, 300); }, 50); },
        showInterstitial() { window.__adLog.push('interstitial:' + window.__game.state); setTimeout(() => { emit('interstitial_state_changed', 'opened'); setTimeout(() => emit('interstitial_state_changed', 'closed'), 300); }, 50); },
      };
      Object.defineProperty(b, 'advertisement', { value: ad, configurable: true });
    });
  }
  await page.evaluate(() => window.__game.forceFinish());
  await sleep(900);
  R.checks.resultsShown = (await state()) === 'results';
  await shot('results');
  const moneyBefore = await page.evaluate(() => window.__game.save.money);
  if (!prof.touch) {
    const dbl = await page.$('[data-act=double]');
    R.checks.doubleButton = !!dbl;
    if (dbl) {
      await dbl.click();
      await sleep(900);
      const moneyAfter = await page.evaluate(() => window.__game.save.money);
      R.notes.doubled = { moneyBefore, moneyAfter };
      R.checks.rewardDoubled = moneyAfter > moneyBefore;
      await shot('results-doubled');
    }
  }
  const cont = await page.$('[data-act=continue]');
  if (cont) { await cont.click(); }
  if (!prof.touch) {
    await sleep(120);
    R.checks.interstitialPausedGame = (await state()) === 'ad';
  }
  R.checks.backToMenu = await waitState('menu', 10000);
  if (!prof.touch) R.notes.adLog = await page.evaluate(() => window.__adLog);
  await sleep(600);
  await shot('menu-after');
  R.notes.moneyBeforeContinue = moneyBefore;
  R.notes.saveAfter = await page.evaluate(() => {
    const s = window.__game.save;
    return { money: s.money, racesFinished: s.racesFinished, bestPlace: s.bestPlace, bestLap: s.bestLap, unlocked: s.unlockedTracks, ghosts: Object.keys(s.ghosts) };
  });
  R.checks.raceCounted = R.notes.saveAfter.racesFinished >= 1;

  // a second race starts cleanly (sim disposed / reloaded)
  await page.evaluate(() => window.__game.startRace('t1'));
  R.checks.secondRace = await waitState('racing', 20000);
  await sleep(1500);
  await shot('race2-start');

  // settings: switch to Russian, screenshot, reload and check that save + language persisted
  await page.evaluate(() => window.__game.menu());
  await sleep(300);
  await page.click('[data-act=settings]');
  await sleep(500);
  await page.click('[data-act=set][data-k=lang][data-v=ru]');
  await sleep(500);
  await shot('settings-ru');
  const racesBefore = await page.evaluate(() => window.__game.save.racesFinished);
  await sleep(300);
  await page.reload({ waitUntil: 'load' });
  R.checks.reloadMenu = await waitState('menu', 30000);
  await sleep(1200);
  const persisted = await page.evaluate(() => ({ lang: window.__game.save.settings.lang, races: window.__game.save.racesFinished, html: document.documentElement.lang, play: document.querySelector('[data-act=play]')?.textContent?.trim() }));
  R.notes.persisted = persisted;
  R.checks.savePersisted = persisted.races === racesBefore && persisted.races >= 1 && persisted.lang === 'ru' && persisted.html === 'ru';
  await shot('menu-ru');

  await ctx.close();
  return R;
}

/** Input driver: touch via CDP (GAS button + finger slide) on phone, keyboard on desktop. */
function makeDriver(page, cdp, prof) {
  if (prof.touch) {
    let cx = 0, cy = 0, size = 0, full = 0, down = false, lastX = 0;
    return {
      async start() {
        const box = await page.evaluate(() => {
          const b = document.querySelector('.gas-btn').getBoundingClientRect();
          return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: innerWidth, s: b.width };
        });
        cx = box.x; cy = box.y; size = box.s; full = box.w * 0.22; lastX = cx;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy, id: 1 }] });
        down = true;
      },
      async steer(v) {
        if (!down) return;
        lastX = cx + v * full;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: lastX, y: cy, id: 1 }] });
      },
      /** Slide the GAS finger straight down by `f` button sizes (clamped to the screen): brake / reverse. */
      async pull(f) {
        if (!down) return;
        const y = await page.evaluate((yy) => Math.min(innerHeight - 1, yy), cy + f * size);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: lastX, y, id: 1 }] });
      },
      async release() {
        if (!down) return;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        down = false;
      },
    };
  }
  let dirKey = null;
  return {
    async start() { await page.keyboard.down('KeyW'); },
    async steer(v) {
      const want = v > 0.2 ? 'KeyD' : v < -0.2 ? 'KeyA' : null;
      if (want === dirKey) return;
      if (dirKey) await page.keyboard.up(dirKey);
      if (want) await page.keyboard.down(want);
      dirKey = want;
    },
    async release() {
      if (dirKey) await page.keyboard.up(dirKey);
      dirKey = null;
      await page.keyboard.up('KeyW');
    },
  };
}


/**
 * Layout audit (Playgama 1.4.4 / 1.6.6 / 1.6.7): on phone portrait + landscape, a square window and desktop, walk every screen
 * and report (a) interactive elements with a hit area under 44 css px, (b) ellipsis-truncated text (also in Russian),
 * (c) the first-run tutorial: bottom sheet <= 30% of the height on phones and the countdown hidden behind it,
 * (d) the tap-to-repair widget hit area. Problems are listed in report.audit.problems; screenshots go to e2e/out/audit-*.png.
 */
async function auditLayout() {
  const vps = [[390, 844, true], [844, 390, true], [600, 600, true], [1280, 720, false]];
  const problems = [];
  const summary = {};
  const small = () => [...document.querySelectorAll('#ui button, #ui [role=button], #ui [data-act], #ui .touch-layer > div')].map((e) => {
    const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
    if (!r.width || !r.height || cs.visibility === 'hidden' || cs.pointerEvents === 'none') return null;
    return { cls: e.className.toString().slice(0, 40), act: e.dataset.act || '', w: Math.round(r.width), h: Math.round(r.height), txt: (e.textContent || '').trim().slice(0, 14) };
  }).filter((x) => x && (x.w < 44 || x.h < 44));
  const trunc = () => [...document.querySelectorAll('#ui *')].filter((e) => getComputedStyle(e).textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim().slice(0, 20));
  for (const [w, h, touch] of vps) {
    const key = `${w}x${h}`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch });
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__game?.state === 'menu', null, { timeout: 30000 });
    await sleep(1000);
    const S = summary[key] = { screens: [], errors: errs };
    const look = async (name) => {
      await page.screenshot({ path: path.join(out, `audit-${key}-${name}.png`) });
      const sm = await page.evaluate(small);
      const tr = await page.evaluate(trunc);
      S.screens.push(name);
      for (const x of sm) problems.push(`${key} ${name}: touch target ${x.w}x${x.h} (${x.act || x.cls} "${x.txt}")`);
      for (const x of tr) problems.push(`${key} ${name}: truncated text "${x}"`);
    };
    await look('menu');
    await page.click('[data-act=garage]'); await sleep(500); await look('garage'); await page.click('[data-act=back]'); await sleep(300);
    await page.click('[data-act=settings]'); await sleep(400); await look('settings');
    await page.click('[data-act=set][data-k=lang][data-v=ru]'); await sleep(300); await look('settings-ru');
    await page.click('[data-act=set][data-k=lang][data-v=en]'); await sleep(200);
    await page.click('[data-act=back]'); await sleep(300);
    await page.click('[data-act=play]'); await sleep(500); await look('tracks');
    // first-run tutorial
    await page.evaluate(() => { window.__game.save.settings.tutorialDone = false; });
    await page.click('[data-act=track][data-id=t1]'); await sleep(900);
    if (touch) {
      await look('picker');
      const pk = await page.evaluate(() => { const p = document.querySelector('.ctlpick'); if (!p) return null; const r = p.getBoundingClientRect(); return { b: r.bottom, t: r.top, h: innerHeight, sh: p.scrollHeight, ch: p.clientHeight }; });
      if (!pk) problems.push(`${key} picker: first-run controls picker not shown`);
      else if (pk.t < -1 || pk.b > pk.h + 1) problems.push(`${key} picker: card is clipped (${Math.round(pk.t)}..${Math.round(pk.b)} of ${pk.h})`);
      await page.click('[data-act=ctlPickSkip]'); await sleep(900);
    }
    await look('tutorial');
    const tut = await page.evaluate(() => {
      const t = document.querySelector('.tutorial'); const cd = document.querySelector('.countdown');
      const r = t.getBoundingClientRect();
      return { h: r.height, vh: innerHeight, countdownOverlap: !!cd && !cd.hidden && (() => { const c = cd.getBoundingClientRect(); return c.width > 0 && !(c.right < r.left || c.left > r.right || c.bottom < r.top || c.top > r.bottom); })(), okBtn: !!t.querySelector('[data-act=tutorialOk]') && t.querySelector('[data-act=tutorialOk]').getBoundingClientRect().bottom <= r.bottom + 1 };
    });
    if (touch && Math.min(w, h) < 520 && tut.h > tut.vh * 0.3 + 1) problems.push(`${key} tutorial: ${Math.round(tut.h)}px is more than 30% of ${tut.vh}px`);
    if (touch) {
      const ov = await page.evaluate(() => {
        const t = document.querySelector('.tutorial'); if (!t) return [];
        const r = t.getBoundingClientRect(); const out = [];
        for (const e of document.querySelectorAll('#ui .touch-layer > div, #ui .hud-item')) {
          if (e.hidden || e.classList.contains('stick') || e.classList.contains('tap-zone')) continue;
          const b = e.getBoundingClientRect(); if (!b.width || getComputedStyle(e).display === 'none') continue;
          if (!(b.right <= r.left || b.left >= r.right || b.bottom <= r.top || b.top >= r.bottom)) out.push(e.className.toString().slice(0, 24));
        }
        return out;
      });
      for (const c of ov) problems.push(`${key} tutorial: the hint sheet overlaps the ${c} button`);
    }
    if (tut.countdownOverlap) problems.push(`${key} tutorial: the hint sheet overlaps the countdown`);
    if (!tut.okBtn) problems.push(`${key} tutorial: "Got it" button is clipped`);
    await page.click('[data-act=tutorialOk]'); await sleep(2200);
    // damage -> tap-to-repair widget shown
    await page.evaluate(() => { const c = window.__game.sim.cars[0]; for (const k of Object.keys(c.hp)) c.hp[k] = 30; });
    await sleep(3500);
    await look('race');
    const rep = await page.evaluate(() => {
      const e = document.querySelector('.cardmg.show'); if (!e) return null;
      const r = e.getBoundingClientRect();
      const em = parseFloat(getComputedStyle(document.querySelector('#ui')).fontSize);
      // probe the invisible hit area just outside the silhouette on each side
      const pts = [[r.left - 0.4 * em, r.top + r.height / 2], [r.left + r.width / 2, r.top - 0.3 * em], [r.left + r.width / 2, r.bottom + 0.3 * em]];
      return { hits: pts.map(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.cardmg')), w: r.width + 1.2 * em, h: r.height + 1.0 * em };
    });
    if (!rep) problems.push(`${key} race: repair widget not shown after damage`);
    else if (rep.w < 44 || rep.h < 44 || !rep.hits[0]) problems.push(`${key} race: repair widget hit area too small (${Math.round(rep.w)}x${Math.round(rep.h)})`);
    await page.evaluate(() => window.__game.pause()); await sleep(400); await look('pause');
    await page.evaluate(() => window.__game.resume()); await sleep(200);
    await page.evaluate(() => window.__game.forceFinish()); await sleep(600); await look('results');
    for (const e of errs) problems.push(`${key}: console error ${e}`);
    await ctx.close();
  }
  return { problems, summary };
}
