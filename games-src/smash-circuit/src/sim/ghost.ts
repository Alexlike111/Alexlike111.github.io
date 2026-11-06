// Lap ghost: records the player at CONFIG.race.ghostHz and keeps the best lap; playback by interpolation. PURE.
import { CONFIG } from '../config';
import type { GhostData, GhostFrame } from '../types';

function round(v: number, p: number): number {
  const k = 10 ** p;
  return Math.round(v * k) / k;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/**
 * Usage: start(raceTime) at the beginning of a recorded lap, update(raceTime, pose) every sim step,
 * finishLap(crossTime, lapTime, pose) when the lap line is crossed (it starts the next lap by itself).
 */
export class GhostRecorder {
  /** Best lap recorded so far (faster than `beat`, when one was given). */
  best: GhostData | null = null;
  private readonly trackId: string;
  private readonly interval: number;
  private frames: GhostFrame[] = [];
  private lapStart = 0;
  private next = 0;
  private active = false;
  private beat: number;

  /** @param beat lap time (s) a recording has to beat to count as best, e.g. the saved ghost's lap time */
  constructor(trackId: string, beat = Number.POSITIVE_INFINITY, hz: number = CONFIG.race.ghostHz) {
    this.trackId = trackId;
    this.interval = 1 / hz;
    this.beat = beat;
  }

  get recording(): boolean { return this.active; }

  start(raceTime: number): void {
    this.active = true;
    this.lapStart = raceTime;
    this.next = 0;
    this.frames = [];
  }

  stop(): void { this.active = false; this.frames = []; }

  update(raceTime: number, x: number, y: number, a: number): void {
    if (!this.active) return;
    const t = raceTime - this.lapStart;
    if (t + 1e-9 < this.next) return;
    this.frames.push({ t: round(this.next, 3), x: round(x, 2), y: round(y, 2), a: round(a, 3) });
    this.next += this.interval;
    // never fall behind by more than a frame (large dt)
    if (this.next < t - this.interval) this.next = t;
  }

  /** Returns true when this lap is a new best. Starts the next lap at crossTime. */
  finishLap(crossTime: number, lapTime: number, x: number, y: number, a: number): boolean {
    let isBest = false;
    if (this.active && this.frames.length > 1) {
      const bestTime = this.best ? this.best.lapTime : this.beat;
      if (lapTime < bestTime) {
        const frames = this.frames.slice();
        frames.push({ t: round(lapTime, 3), x: round(x, 2), y: round(y, 2), a: round(a, 3) });
        this.best = { trackId: this.trackId, lapTime, frames };
        isBest = true;
      }
    }
    this.start(crossTime);
    return isBest;
  }
}

/** Interpolated ghost pose at time t (s from the lap start); null outside the recorded lap. */
export function ghostPoseAt(g: GhostData, t: number): { x: number; y: number; a: number } | null {
  const f = g.frames;
  const n = f.length;
  if (n === 0 || t < 0 || t > f[n - 1].t) return null;
  if (n === 1) return { x: f[0].x, y: f[0].y, a: f[0].a };
  // frames are (nearly) uniform: guess the index, then fix with a short walk / binary search fallback
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (f[mid].t <= t) lo = mid; else hi = mid;
  }
  const a = f[lo], b = f[hi];
  const span = b.t - a.t;
  const k = span > 1e-9 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 0;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, a: lerpAngle(a.a, b.a, k) };
}
