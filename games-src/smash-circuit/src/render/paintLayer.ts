// Thin paint layer over the car models: resolves a car's colorIndex to a body colour. Indices below
// PREMIUM_BASE are the free palette (CONFIG.render.carColors); PREMIUM_BASE + i is cosmetics PAINTS[i].
import { CONFIG } from '../config';
import { PAINTS, PREMIUM_BASE } from '../meta/cosmetics';

export function paintHex(colorIndex: number): number {
  if (colorIndex >= PREMIUM_BASE) {
    const p = PAINTS[colorIndex - PREMIUM_BASE];
    if (p) return p.color;
  }
  const c = CONFIG.render.carColors;
  const i = Math.floor(Number.isFinite(colorIndex) ? colorIndex : 0);
  return c[((i % c.length) + c.length) % c.length];
}
