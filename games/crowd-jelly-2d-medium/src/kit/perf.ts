import { platform } from './bridge';

// Aggregated frame-time sample sent about every 30 s of active, visible gameplay
// (Playgama telemetry contract `performance_sample`). Never one event per frame.

const TARGET_FPS = 60;
const WINDOW_MS = 30_000;

let frames: number[] = [];
/** Current render quality step (main.ts sets it), sent with each sample. */
export const perfInfo = { gfx: 0, dpr: 1 };
let activeMs = 0;
let windowStart = 0;
let errors = 0;
let rejections = 0;

window.addEventListener('error', () => errors++);
window.addEventListener('unhandledrejection', () => rejections++);
// Leaving and coming back (tab switch, app switch, page cache) stalls rAF; that gap is not a game freeze.
let skipNext = false;
for (const ev of ['blur', 'focus', 'pagehide', 'pageshow']) window.addEventListener(ev, () => (skipNext = true));

/** Call once per rendered gameplay frame with its duration in ms. */
export function perfFrame(dtMs: number, now: number): void {
  // Background gaps and pauses are not frames; the loop resets `last` on resume.
  if (dtMs <= 0 || dtMs > 2000) return;
  if (skipNext) {
    skipNext = false;
    return;
  }
  if (!windowStart) windowStart = now;
  frames.push(dtMs);
  activeMs += dtMs;
  if (activeMs >= WINDOW_MS) flush(now);
}

/** Pause boundary: the next frame starts a fresh measurement. */
export function perfPause(): void {
  windowStart = 0;
}

function flush(now: number): void {
  const f = frames.slice().sort((a, b) => a - b);
  const n = f.length;
  if (n < 10) return reset();
  const q = (p: number) => f[Math.min(n - 1, Math.floor(p * (n - 1)))];
  const fps = f.map((d) => 1000 / d).sort((a, b) => a - b);
  const over = (ms: number) => f.filter((d) => d > ms).length;
  platform.track('performance_sample', {
    target_fps: TARGET_FPS,
    window_ms: Math.round(Math.max(activeMs, now - windowStart)),
    active_ms: Math.round(activeMs),
    frame_count: n,
    fps_avg: Math.round((n * 1000 * 10) / activeMs) / 10,
    fps_p10: Math.round(fps[Math.floor(0.1 * (n - 1))] * 10) / 10,
    frame_time_p50_ms: Math.round(q(0.5) * 10) / 10,
    frame_time_p95_ms: Math.round(q(0.95) * 10) / 10,
    frame_time_p99_ms: Math.round(q(0.99) * 10) / 10,
    frame_time_max_ms: Math.round(f[n - 1] * 10) / 10,
    frames_over_50ms: over(50),
    frames_over_100ms: over(100),
    frames_over_250ms: over(250),
    frames_over_500ms: over(500),
    frames_over_1000ms: over(1000),
    js_error_count: errors,
    unhandled_rejection_count: rejections,
    gfx_level: perfInfo.gfx,
    render_dpr: perfInfo.dpr,
  });
  reset();
}

function reset(): void {
  frames = [];
  activeMs = 0;
  windowStart = 0;
  errors = 0;
  rejections = 0;
}
