// Dev-only frame profiler: window.__frost.prof (rolling averages in ms). Off by default (one boolean check per call site);
// enable with ?prof in the URL or __frost.prof.on = true. `gpu` forces gl.finish() after the draw, so only trust it while profiling.
// prof.nosync = 1 keeps the CPU timers but skips the per-pass GPU read-back (bench.ts uses it so frame times stay honest).
export const prof: Record<string, number> & { on: number; nosync: number } = { on: /[?&]prof\b/.test(location.search) ? 1 : 0, nosync: 0 };
export const pnow = (): number => (prof.on ? performance.now() : 0);
/** Accumulator used by bench.ts: per-subsystem totals/peaks over a measuring window and the per-frame sums (cur) for attributing jank. */
export const pacc = { on: false, sum: {} as Record<string, number>, max: {} as Record<string, number>, cur: {} as Record<string, number> };
export function pend(name: string, t0: number) {
  if (!prof.on) return;
  const d = performance.now() - t0, v = prof[name];
  prof[name] = v === undefined ? d : v + (d - v) * 0.1;
  if (pacc.on) {
    pacc.sum[name] = (pacc.sum[name] || 0) + d;
    pacc.cur[name] = (pacc.cur[name] || 0) + d;
    if (d > (pacc.max[name] || 0)) pacc.max[name] = d;
  }
}
