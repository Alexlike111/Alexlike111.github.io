// Screenshots of the sprite sheet: node tests/sheet-shots.mjs [section ...]   (needs `npx vite --port 5182` running)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
import fs from 'fs';
const BASE = process.env.SHEET_URL || 'http://localhost:5182/tests/sheet.html';
const sections = process.argv.slice(2);
const targets = sections.length ? sections : ['player', 'tools', 'icons', 'ui', 'animals', 'fixtures', 'misc'];
fs.mkdirSync('shots', { recursive: true });
const browser = await chromium.launch();
const errs = [];
for (const s of targets) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.on('pageerror', e => errs.push(s + ': ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(s + ': ' + m.text()); });
  await page.goto(`${BASE}?s=${s}&bg=${process.env.BG || 'dusk'}`);
  await page.waitForFunction(() => window.__sheetReady === true, null, { timeout: 15000 }).catch(() => errs.push(s + ': sheet not ready'));
  await page.screenshot({ path: `shots/sheet-${s}.png`, fullPage: true });
  await page.close();
}
await browser.close();
if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
console.log('ok', targets.join(','));
