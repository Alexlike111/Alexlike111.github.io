// The in-game self-test the way a player runs it: opens <index.html>?title=0#selftest (the page starts the run itself 0.8 s after load - do NOT also call
// window.__sc.selftest(): two concurrent runs corrupt each other), waits for window.__selftestReport and prints the failures.
//   VIEW=810x253 node tests/play/selftest.cjs ... (the window size, default 1280x720)
//   node tests/play/selftest.cjs <abs path to a built index.html> [report.txt]              one group in isolation:  node tests/play/selftest.cjs <index.html> - fauna ice ...
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
(async () => {
  const [index, out, ...groups] = process.argv.slice(2);
  const [vw, vh] = (process.env.VIEW || '1280x720').split('x').map(Number);     // VIEW=810x253 runs the layout checks at a landscape phone size
  const VP = { width: vw, height: vh };
  const b = await chromium.launch();
  if (out === '-') {                                                  // groups: each in its own fresh page
    for (const g of groups) {
      const p = await b.newPage({ viewport: VP }); await p.goto('file://' + index + '?title=0'); await p.waitForTimeout(2500);
      const rep = await p.evaluate(g => window.__sc.selftest(g), g); const l = rep.split('\n');
      console.log('[' + g + ']', l[0].replace('SNOWCRAFT самотест — ', '')); for (const f of l.filter(x => /^FAIL/.test(x))) console.log('   ' + f.slice(0, 260)); await p.close();
    }
  } else {
    const p = await b.newPage({ viewport: VP }); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('file://' + index + '?title=0#selftest');
    await p.waitForFunction(() => window.__selftestReport, null, { timeout: 600000, polling: 2000 });
    const rep = await p.evaluate(() => window.__selftestReport); if (out) require('fs').writeFileSync(out, rep);
    const l = rep.split('\n'); console.log(l[0]); for (const f of l.filter(x => /^FAIL/.test(x))) console.log(f.slice(0, 330)); console.log('page errors', errs.slice(0, 3));
  }
  await b.close();
})();
