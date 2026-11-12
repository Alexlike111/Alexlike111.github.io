/** Seedable RNG (mulberry32) */
export class Rng {
  private s: number;
  constructor(seed = 1) { this.s = seed >>> 0 || 1; }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) { return a + (b - a) * this.next(); }
  int(a: number, b: number) { return Math.floor(this.range(a, b + 1)); }
  chance(p: number) { return this.next() < p; }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
  sign() { return this.next() < 0.5 ? -1 : 1; }
  shuffle<T>(arr: T[]): T[] { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
  weighted<T>(items: readonly T[], w: (t: T) => number): T {
    let sum = 0; for (const it of items) sum += w(it);
    let r = this.next() * sum;
    for (const it of items) { r -= w(it); if (r <= 0) return it; }
    return items[items.length - 1];
  }
  fork(): Rng { return new Rng((this.next() * 4294967296) >>> 0); }
}
/** non-deterministic visual-only rng */
export const vrng = new Rng((Date.now() ^ 0x9e3779b9) >>> 0);
export function hashStr(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
