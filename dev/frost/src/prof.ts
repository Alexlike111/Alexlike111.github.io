// Dev-only frame profiler: window.__frost.prof (rolling averages in ms). Off by default (one boolean check per call site);
// enable with ?prof in the URL or __frost.prof.on = true. `gpu` forces gl.finish() after the draw, so only trust it while profiling.
export const prof: Record<string, number> & { on: number } = { on: /[?&]prof\b/.test(location.search) ? 1 : 0 };
export const pnow = (): number => (prof.on ? performance.now() : 0);
export function pend(name: string, t0: number) {
  if (!prof.on) return;
  const d = performance.now() - t0, v = prof[name];
  prof[name] = v === undefined ? d : v + (d - v) * 0.1;
}
