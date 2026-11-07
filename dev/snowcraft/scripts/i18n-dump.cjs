// node scripts/i18n-dump.cjs <built index.html> : writes src/content/lang/_source.json (all registered RU strings, key -> text)
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('file://' + require('path').resolve(process.argv[2]) + '?title=0'); await p.waitForTimeout(2500);
  const d = await p.evaluate(() => window.__sc.mods.i18n.dumpSource());
  const keys = Object.keys(d).sort(); const out = {}; for (const k of keys) out[k] = d[k];
  require('fs').writeFileSync(require('path').join(__dirname, '../src/content/lang/_source.json'), JSON.stringify(out, null, 1) + '\n');
  console.log(keys.length + ' strings'); await b.close();
})();
