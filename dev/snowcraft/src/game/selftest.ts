// CONTRACT FILE — built-in self-test the player runs on their own device (title screen "Самотест" or URL #selftest).
// Every module registers checks for its own systems:
//   registerTest('sim', 'вода растекается', async (t) => { ...; t.expect(ok, 'details'); });
// Tests drive the real game through window.__sc (main.ts) and may also import modules directly.
// The runner shows live progress over the game, then a report with a "copy" button the player pastes to the developer.
import { G } from './state';

export interface TestCtx {
  sc: any;                                            // window.__sc dev API
  frames(n: number): Promise<void>;                   // let the real game loop run n frames (rendered, visible)
  wait(ms: number): Promise<void>;
  expect(cond: boolean, msg: string): void;           // failed expect marks the test failed (test continues)
  metric(name: string, value: number, unit?: string): void; // recorded into the report (timings, fps, counts)
  fps(seconds: number): Promise<{ avg: number; min: number; p95ms: number }>; // measure while the game runs
  log(msg: string): void;
}
type TestFn = (t: TestCtx) => Promise<void> | void;
interface TestDef { group: string; name: string; fn: TestFn; timeoutMs: number }
interface Result { group: string; name: string; ok: boolean; ms: number; notes: string[]; metrics: string[] }

const tests: TestDef[] = [];
export function registerTest(group: string, name: string, fn: TestFn, timeoutMs = 20000) { tests.push({ group, name, fn, timeoutMs }); }
export const testCount = () => tests.length;

const errors: string[] = [];
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => errors.push(`${e.message} @${(e.filename || '').split('/').pop()}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => errors.push('promise: ' + String((e as PromiseRejectionEvent).reason)));
}

const raf = () => new Promise<number>((r) => requestAnimationFrame(r));

function deviceInfo(): string[] {
  const n = navigator as any;
  let gpu = '?';
  try { const c = document.createElement('canvas').getContext('webgl'); const ext = c?.getExtension('WEBGL_debug_renderer_info'); gpu = ext ? String(c!.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'n/a'; } catch { /* ignore */ }
  return [
    `UA: ${navigator.userAgent}`,
    `экран: ${screen.width}×${screen.height} окно: ${innerWidth}×${innerHeight} dpr: ${devicePixelRatio} касание: ${'ontouchstart' in window ? 'да' : 'нет'}`,
    `ядер: ${n.hardwareConcurrency ?? '?'} память: ${n.deviceMemory ?? '?'} ГБ GPU: ${gpu}`,
    `качество: ${G.quality} язык: ${document.documentElement.lang} время: ${new Date().toISOString()}`,
  ];
}

/** Run all (or a group of) tests with a live overlay. Resolves with the report text. */
export async function runSelfTest(filter?: string): Promise<string> {
  const sc = (window as any).__sc;
  const box = document.createElement('div');
  box.id = 'selftest';
  box.style.cssText = 'position:fixed;inset:auto 8px 8px 8px;max-height:46vh;overflow:auto;z-index:9999;background:rgba(8,14,24,.92);color:#dbe6f0;font:13px/1.4 ui-monospace,Menlo,Consolas,monospace;border:1px solid #24364c;border-radius:6px;padding:10px 12px;padding-bottom:calc(10px + env(safe-area-inset-bottom,0px))';
  document.body.appendChild(box);
  const line = (s: string, c = '#dbe6f0') => { const d = document.createElement('div'); d.textContent = s; d.style.color = c; box.appendChild(d); box.scrollTop = box.scrollHeight; };
  const list = tests.filter((t) => !filter || t.group === filter);
  line(`SNOWCRAFT самотест: ${list.length} проверок`, '#7cc6ee');
  const results: Result[] = [];
  const t0 = performance.now();
  for (const def of list) {
    const r: Result = { group: def.group, name: def.name, ok: true, ms: 0, notes: [], metrics: [] };
    const ctx: TestCtx = {
      sc,
      frames: async (n) => { for (let i = 0; i < n; i++) await raf(); },
      wait: (ms) => new Promise((res) => setTimeout(res, ms)),
      expect: (cond, msg) => { if (!cond) { r.ok = false; r.notes.push('✗ ' + msg); } },
      metric: (name, v, unit = '') => r.metrics.push(`${name}=${Math.round(v * 100) / 100}${unit}`),
      fps: async (sec) => {
        const dts: number[] = []; let last = await raf(); const end = last + sec * 1000;
        while (last < end) { const now = await raf(); dts.push(now - last); last = now; }
        dts.sort((a, b) => a - b);
        const avg = 1000 / (dts.reduce((a, b) => a + b, 0) / Math.max(1, dts.length));
        return { avg, min: 1000 / (dts[dts.length - 1] || 16.7), p95ms: dts[Math.floor(dts.length * 0.95)] || 0 };
      },
      log: (m) => r.notes.push(m),
    };
    const errBefore = errors.length;
    const s = performance.now();
    try {
      await Promise.race([Promise.resolve(def.fn(ctx)), new Promise((_, rej) => setTimeout(() => rej(new Error('таймаут')), def.timeoutMs))]);
    } catch (e) { r.ok = false; r.notes.push('✗ исключение: ' + ((e as Error)?.message || String(e))); }
    if (errors.length > errBefore) { r.ok = false; r.notes.push(...errors.slice(errBefore).map((x) => '✗ ошибка: ' + x)); }
    r.ms = performance.now() - s;
    results.push(r);
    line(`${r.ok ? '✓' : '✗'} [${r.group}] ${r.name} ${Math.round(r.ms)} мс ${r.metrics.join(' ')}`, r.ok ? '#6cc59a' : '#e5604f');
    for (const n of r.notes) line('   ' + n, '#e6b84f');
  }
  const failed = results.filter((r) => !r.ok);
  const report = [
    `SNOWCRAFT самотест — ${results.length - failed.length}/${results.length} ок, ${Math.round((performance.now() - t0) / 1000)} с`,
    ...deviceInfo(),
    ...results.map((r) => `${r.ok ? 'OK ' : 'FAIL'} [${r.group}] ${r.name} ${Math.round(r.ms)}ms ${r.metrics.join(' ')}${r.notes.length ? ' | ' + r.notes.join(' ; ') : ''}`),
    errors.length ? `ошибки консоли: ${errors.slice(0, 20).join(' || ')}` : 'ошибок консоли нет',
  ].join('\n');
  // report panel with copy button
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;gap:8px;margin-top:8px;flex-wrap:wrap';
  const ta = document.createElement('textarea');
  ta.value = report; ta.readOnly = true; ta.id = 'selftest-report';
  ta.style.cssText = 'width:100%;height:120px;background:#0b1220;color:#dbe6f0;border:1px solid #24364c;font:12px ui-monospace,monospace';
  const btn = (label: string, fn: () => void) => { const b = document.createElement('button'); b.textContent = label; b.style.cssText = 'min-height:44px;padding:0 16px;background:#7cc6ee;color:#0b1220;border:0;border-radius:6px;font:600 14px system-ui'; b.onclick = fn; bar.appendChild(b); return b; };
  const copy = btn('Скопировать отчёт', () => {
    navigator.clipboard?.writeText(report).then(() => { copy.textContent = 'Скопировано'; }, () => { ta.select(); copy.textContent = 'Выделено: нажми «Копировать»'; });
  });
  btn('Закрыть', () => box.remove());
  box.appendChild(ta); box.appendChild(bar);
  (window as any).__selftestReport = report;
  return report;
}
