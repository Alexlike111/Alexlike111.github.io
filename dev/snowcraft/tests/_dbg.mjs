import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const b = await chromium.launch(); const p = await b.newPage();
p.on('pageerror', e => console.log('ERR', e.stack));
p.on('console', m => console.log('LOG', m.text()));
await p.goto(process.argv[2]); await p.waitForTimeout(1500); await b.close();
