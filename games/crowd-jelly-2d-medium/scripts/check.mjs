// npm run check: build + static rules + live Playwright run at 1280x720 (mouse) and 390x844 (touch).
// Exit code 1 on any failure. Report: qa/report.md, screenshots: qa/shots/.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, serve, launch } from './lib.mjs';

const noBuild = process.argv.includes('--no-build');
const DIST = path.join(ROOT, 'dist');
const SHOTS = path.join(ROOT, 'qa', 'shots');
mkdirSync(SHOTS, { recursive: true });

const rows = []; // [status, name, detail]
const ok = (name) => rows.push(['PASS', name, '']);
const bad = (name, detail = '') => rows.push(['FAIL', name, detail]);
const warn = (name, detail = '') => rows.push(['WARN', name, detail]);
const check = (cond, name, detail = '') => (cond ? ok(name) : bad(name, detail));

const sh = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' });

// ------------------------------------------------------------------ 1. build
if (!noBuild) {
  const r = sh('npm', ['run', 'build', '--silent']);
  check(r.status === 0, 'build (tsc + vite)', (r.stdout + r.stderr).split('\n').slice(-12).join('\n'));
  if (r.status !== 0) finish();
}

// ------------------------------------------------------------------ 2. static rules
const st = sh('npx', ['tsx', 'scripts/static-check.ts']);
try {
  const o = JSON.parse(st.stdout.trim().split('\n').pop());
  check(o.fails.length === 0, '10 languages, changelog, version', o.fails.slice(0, 12).join('\n'));
  o.warns.forEach((w) => warn(w));
} catch {
  bad('static-check ran', st.stdout + st.stderr);
}

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const srcFiles = walk(path.join(ROOT, 'src')).filter((f) => /\.(ts|css)$/.test(f));
const code = (f) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const grep = (re, allow = []) =>
  srcFiles.filter((f) => !allow.some((a) => f.endsWith(a)) && re.test(code(f))).map((f) => path.relative(ROOT, f));
const rel = (list) => list.join(', ');

let hits = grep(/\.showInterstitial\(/, ['kit/bridge.ts', 'kit/ads.ts']);
check(hits.length === 0, 'ads: interstitial only via kit/ads.ts', rel(hits));
hits = grep(/\bafterResult\(/, ['kit/ads.ts', 'main.ts']);
check(hits.length === 0, 'ads: afterResult only called from the result screen (main.ts)', rel(hits));
hits = grep(/window\.bridge|bridge\.(advertisement|analytics|storage)/, ['kit/bridge.ts']);
check(hits.length === 0, 'Bridge used only in kit/bridge.ts', rel(hits));
hits = grep(/localStorage|sessionStorage|indexedDB/);
check(hits.length === 0, 'no localStorage (saves go through Bridge storage)', rel(hits));
hits = grep(/\bfetch\(|XMLHttpRequest|new WebSocket|navigator\.sendBeacon/);
check(hits.length === 0, 'no own network requests in src', rel(hits));
hits = grep(/new Audio\(|\.(mp3|ogg|wav|m4a)['"`]/);
check(hits.length === 0, 'sounds and music only in code (no audio files)', rel(hits));
hits = grep(/\bcrazygames\b|\bgdsdk\b|adsbygoogle/i);
check(hits.length === 0, 'no other ad / portal SDKs in src', rel(hits));

const files = walk(DIST);
const total = files.reduce((n, f) => n + statSync(f).size, 0);
const mb = (total / 1048576).toFixed(2);
if (total > 10 * 1048576) bad(`dist size ${mb} MB`, 'over 10 MB; Playgama asks for fast loading');
else if (total > 3 * 1048576) warn(`dist size ${mb} MB`, 'over 3 MB, check the heavy files');
else ok(`dist size ${mb} MB`);
check(files.some((f) => path.relative(DIST, f) === 'index.html'), 'dist/index.html at the root');
check(files.some((f) => /playgama-bridge-config\.json$/.test(f)), 'playgama-bridge-config.json in dist');
{
  const cfgPath = path.join(ROOT, 'public', 'playgama-bridge-config.json');
  const token = JSON.parse(readFileSync(cfgPath, 'utf8'))?.saas?.publicToken ?? '';
  const placeholder = !token || /REPLACE/i.test(token);
  if (placeholder && process.argv.includes('--allow-placeholder')) warn('Bridge publicToken is a placeholder (template self-test only)');
  else check(!placeholder, 'Bridge publicToken set for THIS game (public/playgama-bridge-config.json)', 'put the game public token from the Playgama console; never reuse another game token');
}
check(!files.some((f) => /\.(mp3|ogg|wav|m4a|mp4|webm)$/.test(f)), 'dist has no audio / video files');
const html = readFileSync(path.join(DIST, 'index.html'), 'utf8');
const ext = [...html.replace(/<script>[\s\S]*?<\/script>/g, '').matchAll(/(?:src|href)=["'](https?:)?\/\/[^"']+/g)].map((m) => m[0]);
check(ext.length === 0, 'index.html: no external files', ext.join(', '));

// ------------------------------------------------------------------ 3. live run
const { server, url } = await serve(DIST);
const browser = await launch();

async function session(label, ctxOpts, touch) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  const foreign = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(url) && !u.startsWith('data:') && !u.startsWith('blob:')) foreign.push(u);
  });
  const N = (s) => `${label}: ${s}`;
  const vw = ctxOpts.viewport.width;
  const vh = ctxOpts.viewport.height;
  const st = () => page.evaluate(() => window.__qa.state());
  const events = () => page.evaluate(() => window.__qa.events);
  const count = async (name) => (await events()).filter((e) => e.name === name).length;
  const press = (sel) => (touch ? page.tap(sel, { force: true }) : page.click(sel, { force: true }));
  // forced taps skip Playwright's stability wait: let a panel finish its entry animation first (slow CI runners)
  const settle = async (sel) => {
    let prev = '';
    for (let i = 0; i < 30; i++) {
      const box = JSON.stringify(await page.locator(sel).boundingBox());
      if (box === prev) return;
      prev = box;
      await page.waitForTimeout(120);
    }
  };
  const modal = () => page.evaluate(() => document.querySelectorAll('.gk-dim').length);
  const dismiss = async () => {
    for (let i = 0; i < 4 && (await modal()); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(120); }
  };
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `${label}-${n}.png`) });
  async function playAndFinish() {
    await page.waitForFunction(() => window.__qa.state().running, null, { timeout: 5000 });
    await page.evaluate(() => window.__qa.finish(true));
    await page.waitForSelector('[data-a="next"]', { timeout: 8000 });
  }

  await page.goto(`${url}/?qa=1`);
  await page.waitForFunction(() => window.__qa && window.__qa.state && document.getElementById('playBtn'), null, { timeout: 15000 });
  await page.waitForTimeout(400);
  await shot('menu');

  // canvas draws something
  const painted = await page.evaluate(() => {
    const c = document.getElementById('c');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 4 * 997) seen.add((d[i] >> 4) * 256 + (d[i + 1] >> 4) * 16 + (d[i + 2] >> 4));
    return seen.size;
  });
  check(painted > 8, N('canvas is painted'), `${painted} colours`);

  const open = (await events()).find((e) => e.name === 'game_open');
  check(open?.data.device_class === (touch ? 'touch' : 'mouse'), N(`game_open has device_class ${touch ? 'touch' : 'mouse'}`), JSON.stringify(open?.data));

  // first run: controls
  await press('#playBtn');
  await page.waitForFunction(() => window.__qa.state().running);
  const hint = await page.textContent('#hint').catch(() => '');
  check(!!hint, N('first-launch controls hint'), hint ?? '');
  await shot('play');
  const laneY = (l) => Math.round(vh * (0.34 + 0.19 * (l + 0.5)));
  if (!touch) {
    await page.mouse.move(vw * 0.6, laneY(0));
    check((await st()).lane === 0, N('mouse move to the top lane picks lane 0'), String((await st()).lane));
    await page.mouse.move(vw * 0.6, laneY(2));
    check((await st()).lane === 2, N('mouse move to the bottom lane picks lane 2'), String((await st()).lane));
    await page.keyboard.press('ArrowUp');
    check((await st()).lane === 1, N('ArrowUp moves one lane up'), String((await st()).lane));
    await page.keyboard.press('s');
    check((await st()).lane === 2, N('S moves one lane down'), String((await st()).lane));
    await page.keyboard.press('1');
    check((await st()).lane === 0, N('key 1 picks lane 0'));
    await page.keyboard.press('p');
    await page.waitForTimeout(150);
    const s1 = await st();
    check(s1.paused && s1.modal, N('P opens the pause panel and stops the game'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    check(!(await st()).paused, N('Esc resumes'));
  } else {
    await page.touchscreen.tap(vw * 0.6, laneY(0));
    check((await st()).lane === 0, N('tap on the top lane picks lane 0'), String((await st()).lane));
    await page.touchscreen.tap(vw * 0.6, laneY(2));
    check((await st()).lane === 2, N('tap on the bottom lane picks lane 2'), String((await st()).lane));
    await page.tap('#pauseBtn');
    await page.waitForTimeout(150);
    check((await st()).paused, N('pause button stops the game'));
    await shot('pause');
    await page.keyboard.press('Escape');
  }

  // toast limits
  await page.evaluate(() => window.__qa.toast('A quite long message that must stay small and out of the way of the game field'));
  await page.waitForSelector('.gk-toast');
  const tb = await page.evaluate(() => { const r = document.querySelector('.gk-toast').getBoundingClientRect(); return { w: r.width, h: r.height, left: r.left }; });
  check(tb.w <= vw * 0.35 + 1 && tb.h <= vh * 0.12 + 1, N('toast <= 35% width, <= 12% height'), `${Math.round((tb.w / vw) * 100)}% x ${Math.round((tb.h / vh) * 100)}%`);
  check(tb.left >= vw * 0.6, N('toast sits at the edge, not over the field centre'), `left ${Math.round(tb.left)} of ${vw}`);

  // ads: result -> interstitial rules
  await playAndFinish();
  await shot('result');
  const resultOk = await page.evaluate(() => !!document.querySelector('[data-a="next"]'));
  check(resultOk, N('result screen with Next / Try again'));
  await page.waitForTimeout(500);
  check((await count('ad_interstitial')) === 0 && !(await page.$('.mock-ad')), N('no interstitial on the result itself'));
  await press('[data-a="next"]');
  await page.waitForFunction(() => window.__qa.state().running, null, { timeout: 5000 });
  check((await count('ad_interstitial')) === 0, N('no interstitial in the first 3 minutes'));
  await dismiss();

  await page.evaluate(() => (window.__qa.clockOffset = 200_000));
  await playAndFinish();
  await press('[data-a="next"]');
  await page.waitForFunction(() => window.__qa.state().running, null, { timeout: 5000 });
  check((await count('ad_interstitial')) === 1, N('interstitial after 3 min, on the Next tap'));
  await dismiss();

  await playAndFinish();
  await press('[data-a="next"]');
  await page.waitForFunction(() => window.__qa.state().running, null, { timeout: 5000 });
  check((await count('ad_interstitial')) === 1, N('no second interstitial within 90 s'));
  await dismiss();

  await page.evaluate(() => (window.__qa.clockOffset = 330_000));
  await playAndFinish();
  await press('[data-a="next"]');
  await page.waitForFunction(() => window.__qa.state().running, null, { timeout: 5000 });
  check((await count('ad_interstitial')) === 2, N('interstitial again after 90 s'));
  await dismiss();

  // rewarded
  await page.waitForFunction(() => window.__qa.state().running);
  await playAndFinish();
  const c0 = (await st()).crowd;
  await press('[data-a="bonus"]');
  await page.waitForFunction((c) => window.__qa.state().crowd > c, c0, { timeout: 5000 }).catch(() => {});
  check((await st()).crowd > c0, N('rewarded button gives +25% jellies'), `${c0} -> ${(await st()).crowd}`);

  // every event has device_class + build_version
  const evs = await events();
  const missing = evs.filter((e) => !e.data.device_class || !e.data.build_version).map((e) => e.name);
  check(missing.length === 0 && evs.length > 4, N('all analytics events carry device_class and build_version'), `${evs.length} events; missing: ${[...new Set(missing)].join(',')}`);
  for (const n of ['game_open', 'run_start', 'run_end']) check(evs.some((e) => e.name === n), N(`event ${n} sent`));

  // menu, settings, news, feedback
  await press('[data-a="menu"]');
  await page.waitForSelector('#playBtn');
  await press('#setBtn');
  await page.waitForSelector('[data-a="fb"]');
  check(true, N('settings: feedback button present'));
  await settle('[data-a="fb"]');
  await press('[data-a="fb"]');
  await page.waitForSelector('.fb, [class*="fb-"]', { timeout: 4000 }).then(() => ok(N('feedback form opens')), () => bad(N('feedback form opens')));
  await dismiss();
  await press('#newsBtn');
  await page.waitForSelector('.gk-panel li');
  const news = await page.textContent('.gk-panel-body');
  check(/20\d\d/.test(news) && /v\d+\.\d+\.\d+/.test(news), N("What's new shows version and date"), news.slice(0, 80));
  await shot('news');
  await dismiss();

  // 10 languages: menu + settings + language list must not overflow
  const langs = ['en', 'ru', 'uk', 'es', 'pt', 'de', 'fr', 'tr', 'id', 'hi'];
  const bad10 = [];
  for (const l of langs) {
    await page.evaluate((x) => window.__qa.setLang(x), l);
    await page.waitForTimeout(80);
    for (const open of [null, '#setBtn', '#langBtn']) {
      if (open) await press(open);
      await page.waitForTimeout(60);
      const over = await page.evaluate(() => {
        const o = [];
        if (document.documentElement.scrollWidth > innerWidth + 1) o.push('page');
        document.querySelectorAll('.gk-btn, .gk-ribbon, h1, .gk-pill').forEach((e) => {
          if (e.scrollWidth > e.clientWidth + 2 && !e.classList.contains('round')) o.push((e.textContent || '').trim().slice(0, 18));
          const r = e.getBoundingClientRect();
          if (r.right > innerWidth + 1 || r.left < -1) o.push('off:' + (e.textContent || '').trim().slice(0, 12));
        });
        return o;
      });
      if (over.length) bad10.push(`${l}${open ?? ''}: ${over.join('|')}`);
      if (open) await dismiss();
    }
    if (l === 'de' || l === 'hi') await shot(`lang-${l}`);
  }
  check(bad10.length === 0, N('10 languages fit (menu, settings, language list)'), bad10.slice(0, 6).join('; '));
  await page.evaluate(() => window.__qa.setLang('en'));

  check(errors.length === 0, N('no console / page errors'), errors.slice(0, 4).join(' || '));
  check(foreign.length === 0, N('no requests outside the game'), foreign.slice(0, 4).join(', '));
  await ctx.close();
}

// layout matrix from the Playgama checklist: menu and result panel must fit every size, no page scroll
async function matrix() {
  const bad = [];
  for (const [w, h] of [[360, 640], [915, 412], [2560, 1440]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const pg = await ctx.newPage();
    await pg.goto(`${url}/?qa=1`);
    await pg.waitForFunction(() => window.__qa?.state && !document.getElementById('loading'), null, { timeout: 15000 });
    await pg.click('#playBtn', { force: true });
    await pg.waitForFunction(() => window.__qa.state().running);
    await pg.evaluate(() => window.__qa.finish(true));
    await pg.waitForSelector('.gk-panel', { timeout: 8000 });
    await pg.waitForTimeout(400);
    const r = await pg.evaluate(() => {
      const p = document.querySelector('.gk-panel').getBoundingClientRect();
      return { top: p.top, bottom: p.bottom, scroll: document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1, closeBtn: !!document.querySelector('.gk-close') };
    });
    if (r.scroll || r.top < 0 || r.bottom > h + 1 || !r.closeBtn) bad.push(`${w}x${h}: ${JSON.stringify(r)}`);
    await pg.screenshot({ path: path.join(SHOTS, `matrix-${w}x${h}.png`) });
    await ctx.close();
  }
  check(bad.length === 0, 'layout 360x640, 915x412, 2560x1440: result panel fits, close button, no scroll', bad.join('; '));
}

try {
  await matrix();
  await session('desktop', { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 }, false);
  await session('phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }, true);
} catch (e) {
  bad('live run crashed', String(e).split('\n').slice(0, 6).join('\n'));
}
await browser.close();
server.close();
finish();

// ------------------------------------------------------------------ report
function finish() {
  const failN = rows.filter((r) => r[0] === 'FAIL').length;
  const icon = { PASS: '✅', FAIL: '❌', WARN: '⚠️' };
  const out = rows.map((r) => `${icon[r[0]]} ${r[1]}${r[2] ? `\n   ${String(r[2]).replace(/\n/g, '\n   ')}` : ''}`);
  const summary = failN ? `❌ ${failN} failed of ${rows.length}` : `✅ all ${rows.length} checks passed`;
  console.log(out.join('\n') + '\n\n' + summary);
  mkdirSync(path.join(ROOT, 'qa'), { recursive: true });
  writeFileSync(path.join(ROOT, 'qa', 'report.md'), `# Check report\n\n${out.join('\n')}\n\n${summary}\n`);
  process.exit(failN ? 1 : 0);
}
