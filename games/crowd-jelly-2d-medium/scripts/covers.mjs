// npm run covers: store images from the game itself, no paid AI.
// Plays the game in Chromium, takes a wide (1280x720) and a tall (390x844) screenshot, and sets them on a
// branded background (colours, title, tagline from game.config.json). Output: store/covers/*.jpg and
// store/screenshots/*.png. Needs a build: npm run build.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT, serve, launch } from './lib.mjs';

const DIST = path.join(ROOT, 'dist');
const cfg = JSON.parse(readFileSync(path.join(ROOT, 'game.config.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
if (!existsSync(path.join(DIST, 'index.html'))) {
  console.error('dist missing: run npm run build first');
  process.exit(1);
}
const OUT = path.join(ROOT, 'store');
const COVERS = path.join(OUT, 'covers');
const SHOTS = path.join(OUT, 'screenshots');
const TMP = path.join(ROOT, 'qa', '.covers-tmp');
for (const d of [COVERS, SHOTS, TMP]) mkdirSync(d, { recursive: true });

const FONT = path.join(ROOT, 'src/ui-kit/fonts/nunito-latin-900-normal.woff2');
const { server, url } = await serve(DIST, { '/f900.woff2': FONT, '/cover.html': path.join(TMP, 'cover.html'), '/wide.png': path.join(SHOTS, 'wide-1280x720.png'), '/tall.png': path.join(SHOTS, 'tall-390x844.png') });
const browser = await launch();

async function capture(file, opts, touch) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await page.goto(`${url}/?qa=1&lang=en`);
  await page.waitForFunction(() => window.__qa?.state && document.getElementById('playBtn') && !document.getElementById('loading'), null, { timeout: 15000 });
  await (touch ? page.tap('#playBtn', { force: true }) : page.click('#playBtn', { force: true }));
  await page.waitForFunction(() => window.__qa.bubbles().length >= 6, null, { timeout: 15000 });
  await page.waitForTimeout(2500);
  for (let i = 0; i < 2; i++) {
    const b = (await page.evaluate(() => window.__qa.bubbles())).find((x) => x.y > 120);
    if (b) await (touch ? page.touchscreen.tap(b.x, b.y) : page.mouse.click(b.x, b.y));
    await page.waitForTimeout(120);
  }
  await page.evaluate(() => document.getElementById('hint')?.remove());
  await page.screenshot({ path: file });
  await ctx.close();
}
await capture(path.join(SHOTS, 'wide-1280x720.png'), { viewport: { width: 1280, height: 720 } }, false);
await capture(path.join(SHOTS, 'tall-390x844.png'), { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }, true);

const SIZES = { '800x800': [800, 800], '1080x1920': [1080, 1920], '1920x1080': [1920, 1080] };
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// Layouts: title box, gameplay shot (x, y, width, aspect, tilt), tagline pill. All in px of the final image.
const LAYOUT = {
  '1920x1080': { title: { x: 90, y: 150, w: 760, h: 520, align: 'left' }, shot: { x: 900, y: 150, w: 940, src: '/wide.png', ar: 1280 / 720, rot: 3 }, tag: { x: 90, y: 760, w: 760, align: 'left' } },
  '1080x1920': { title: { x: 70, y: 70, w: 940, h: 430, align: 'center' }, shot: { x: 286, y: 560, w: 508, src: '/tall.png', ar: 390 / 844, rot: -2 }, tag: { x: 70, y: 1740, w: 940, align: 'center' } },
  '800x800': { title: { x: 50, y: 30, w: 700, h: 190, align: 'center' }, shot: { x: 80, y: 250, w: 640, src: '/wide.png', ar: 1280 / 720, rot: -2 }, tag: { x: 50, y: 680, w: 700, align: 'center' } },
};
const page = await (await browser.newContext({ deviceScaleFactor: 1 })).newPage();

for (const [name, [w, h]] of Object.entries(SIZES)) {
  const L = LAYOUT[name];
  const unit = Math.min(w, h) / 800;
  const html = `<!doctype html><meta charset="utf-8"><style>
    @font-face{font-family:N;font-weight:900;src:url(/f900.woff2)}
    *{box-sizing:border-box;margin:0}
    body{width:${w}px;height:${h}px;overflow:hidden;font-family:N,system-ui;background:linear-gradient(160deg,${cfg.bgFrom},${cfg.bgTo});position:relative}
    .dots i{position:absolute;border-radius:50%;background:radial-gradient(circle at 30% 30%,#fff,${cfg.bgFrom}aa);opacity:.35}
    .fit{position:absolute;display:flex;align-items:center}
    .t{width:100%;color:#fff;font-weight:900;-webkit-text-stroke:${10 * unit}px #2a1f3d;paint-order:stroke fill;text-shadow:0 ${8 * unit}px 0 #2a1f3d;line-height:1.02;overflow-wrap:normal}
    .shot{position:absolute;border-radius:${28 * unit}px;border:${8 * unit}px solid #2a1f3d;box-shadow:0 ${18 * unit}px 0 rgba(0,0,0,.28);object-fit:cover;background:#fff}
    .tag{display:inline-block;padding:${8 * unit}px ${22 * unit}px ${12 * unit}px;border-radius:${40 * unit}px;background:${cfg.accent};border:${5 * unit}px solid #2a1f3d;color:#fff;font-weight:900;box-shadow:0 ${6 * unit}px 0 ${cfg.accentDark};line-height:1.15}
  </style><body>
  <div class="dots">${Array.from({ length: 14 }, (_, i) => `<i style="left:${(i * 137) % 100}%;top:${(i * 59 + 7) % 100}%;width:${(50 + (i % 5) * 28) * unit}px;height:${(50 + (i % 5) * 28) * unit}px"></i>`).join('')}</div>
  <div class="fit" id="tbox" style="left:${L.title.x}px;top:${L.title.y}px;width:${L.title.w}px;height:${L.title.h}px"><div class="t" id="title" style="text-align:${L.title.align}">${esc(cfg.title)}</div></div>
  <img class="shot" src="${L.shot.src}" style="left:${L.shot.x}px;top:${L.shot.y}px;width:${L.shot.w}px;aspect-ratio:${L.shot.ar};transform:rotate(${L.shot.rot}deg)">
  <div class="fit" id="gbox" style="left:${L.tag.x}px;top:${L.tag.y}px;width:${L.tag.w}px;justify-content:${L.tag.align === 'center' ? 'center' : 'flex-start'}"><div class="tag" id="tag" style="max-width:100%;text-align:center;transform:rotate(-2deg)">${esc(cfg.tagline)}</div></div>
  </body>`;
  writeFileSync(path.join(TMP, 'cover.html'), html);
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`${url}/cover.html`);
  await page.evaluate(() => document.fonts.ready);
  // shrink the title until it fits its box without breaking words; size the tagline pill to its width
  await page.evaluate(([th, uw]) => {
    const box = document.getElementById('tbox'), t = document.getElementById('title');
    let lo = 20, hi = 260;
    while (hi - lo > 1) {
      const mid = (lo + hi) / 2;
      t.style.fontSize = mid + 'px';
      const words = t.textContent.split(/\s+/);
      const probe = document.createElement('span');
      probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:900 ${mid}px N`;
      document.body.appendChild(probe);
      const wide = Math.max(...words.map((x) => ((probe.textContent = x), probe.offsetWidth)));
      probe.remove();
      if (t.scrollHeight <= box.clientHeight && wide <= box.clientWidth) lo = mid; else hi = mid;
    }
    t.style.fontSize = lo + 'px';
    const tag = document.getElementById('tag');
    let a = 14, z = 70 * uw;
    while (z - a > 1) { const m = (a + z) / 2; tag.style.fontSize = m + 'px'; (tag.scrollWidth <= tag.clientWidth + 1 && tag.offsetHeight < 3.2 * m) ? (a = m) : (z = m); }
    tag.style.fontSize = Math.min(a, 38 * uw) + 'px';
  }, [L.title.h, unit]);
  await page.waitForTimeout(150);
  const file = path.join(COVERS, `${cfg.slug}-${name}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 90 });
  console.log(`store/covers/${path.basename(file)}`);
}
await browser.close();
server.close();
console.log(`screenshots: store/screenshots/ (v${pkg.version})`);
