// Tiny character-grid painter for procedural pixel art (legs of walk cycles, moon phases, flames, icons…). Result = Rows for sprites.ts.
import type { Rows } from '../engine/sprites';

export class Grid {
  g: string[][];
  constructor(public w: number, public h: number, fill = '.') { this.g = Array.from({ length: h }, () => new Array(w).fill(fill)); }
  set(x: number, y: number, c: string) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.g[y][x] = c; return this; }
  get(x: number, y: number) { return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.g[y][x] : '.'; }
  rect(x: number, y: number, w: number, h: number, c: string) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); return this; }
  /** Bresenham line; `thick` extra cells across x (2 = two cells wide). */
  line(x0: number, y0: number, x1: number, y1: number, c: string, thick = 1) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      for (let k = 0; k < thick; k++) this.set(x0 + k, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return this;
  }
  disc(cx: number, cy: number, r: number, c: string) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r + 0.25) this.set(x, y, c);
    return this;
  }
  ell(cx: number, cy: number, rx: number, ry: number, c: string) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) { const a = (x - cx) / rx, b = (y - cy) / ry; if (a * a + b * b <= 1.02) this.set(x, y, c); }
    return this;
  }
  /** Paint `src` rows at (ox,oy); '.' is transparent. */
  blit(src: Rows, ox: number, oy: number) { for (let y = 0; y < src.length; y++) for (let x = 0; x < src[y].length; x++) { const ch = src[y][x]; if (ch !== '.' && ch !== ' ') this.set(ox + x, oy + y, ch); } return this; }
  rows(): Rows { return this.g.map(r => r.join('')); }
}
