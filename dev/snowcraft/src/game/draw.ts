// CONTRACT FILE (signatures) — entity drawing. The art agent owns the implementations; gameplay code calls these
// from render layers (z < 0 so sprites are lit by the light map; see View rules in state.ts). Coordinates: world cells.
import type { View, Player, Animal, Fixture, Drop } from './state';

export interface HeldInfo { item: string | null; aim: number /*radians, 0 = right*/; swing: number /*0..1 current swing*/; using: boolean; load?: number /*shovel snow 0..1*/ }
export interface TargetInfo {
  tx: number; ty: number; tw: number; th: number;        // target rect in TILES
  mode: 'dig' | 'cut' | 'place' | 'attack' | 'use' | 'chisel' | 'none';
  ok: boolean; progress: number;                         // 0..1 work progress (cracks / cut line)
  ghostItem?: string; margin?: number; lean?: -1 | 0 | 1; // placement ghost (support margin 0..1, dome lean)
}

/** Placeholder implementations (replaced by the art pass). */
export function drawPlayer(ctx: CanvasRenderingContext2D, v: View, p: Player, held: HeldInfo): void {
  ctx.fillStyle = '#9a3a2a'; ctx.fillRect(Math.round(p.x - p.w / 2 - v.x0), Math.round(p.y - p.h - v.y0), p.w, p.h);
  void held;
}
export function drawAnimal(ctx: CanvasRenderingContext2D, v: View, a: Animal, t: number): void {
  ctx.fillStyle = a.kind === 'bear' ? '#e8e2d0' : a.kind === 'dog' ? '#6b6b70' : '#aaa'; ctx.fillRect(Math.round(a.x - a.w / 2 - v.x0), Math.round(a.y - a.h - v.y0), a.w, a.h); void t;
}
export function drawFixture(ctx: CanvasRenderingContext2D, v: View, f: Fixture, t: number): void {
  ctx.fillStyle = '#7a5a3a'; ctx.fillRect(f.tx * 4 - v.x0, f.ty * 4 - v.y0, f.tw * 4, f.th * 4); void t;
}
export function drawDrop(ctx: CanvasRenderingContext2D, v: View, d: Drop, t: number): void {
  ctx.fillStyle = '#e6b84f'; ctx.fillRect(Math.round(d.x - 2 - v.x0), Math.round(d.y - 4 - v.y0 + Math.sin(t * 3 + d.id) * 1), 4, 4);
}
export function drawTarget(ctx: CanvasRenderingContext2D, v: View, t: TargetInfo): void {
  if (t.mode === 'none') return;
  ctx.strokeStyle = t.ok ? 'rgba(220,240,255,.8)' : 'rgba(229,96,79,.8)'; ctx.lineWidth = 1;
  ctx.strokeRect(t.tx * 4 - v.x0 + 0.5, t.ty * 4 - v.y0 + 0.5, t.tw * 4 - 1, t.th * 4 - 1);
}
export function drawSled(ctx: CanvasRenderingContext2D, v: View, x: number, y: number, load: number): void {
  ctx.fillStyle = '#8a6a4a'; ctx.fillRect(Math.round(x - 10 - v.x0), Math.round(y - 4 - v.y0), 20, 3); void load;
}
