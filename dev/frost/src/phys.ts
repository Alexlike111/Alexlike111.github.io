// Runtime switch between the planck (bodies.ts) and Rapier (bodies_rapier.ts) rigid-body backends.
// Same API as bodies.ts. Each backend keeps its own module state (own world, own `bodies` Map).
import * as PL from './bodies';
import * as RP from './bodies_rapier';
import { M, W, CELL, mat, set as setCell, idx, inb } from './world';

export type BodyKind = PL.BodyKind;
/** Common view of both backends' records (`b` is a planck Body or the Rapier wrapper). */
export type BodyRec = Omit<PL.BodyRec, 'b'> & {
  b: { getPosition(): { x: number; y: number }; getAngle(): number; getLinearVelocity(): { x: number; y: number } };
};
type Impl = typeof PL | typeof RP;

export let engine: 'planck' | 'rapier' = 'planck';
let impl: Impl = PL;
/** Live binding to the active backend's body Map (re-assigned by setEngine). Prefer allBodies(). */
export let bodies: Map<number, BodyRec> = PL.bodies as unknown as Map<number, BodyRec>;
export const allBodies = (): Map<number, BodyRec> => bodies;

export async function setEngine(e: 'planck' | 'rapier'): Promise<void> {
  if (e === engine) return;
  if (e === 'rapier') await RP.initPhysics();
  // hand the old backend's bodies back to the grid as plain cells (structure.ts re-bodies unsupported islands)
  for (const r of [...impl.bodies.values()]) (impl as typeof PL).removeBody(r as PL.BodyRec, true);
  engine = e; impl = e === 'rapier' ? RP : PL;
  bodies = impl.bodies as unknown as Map<number, BodyRec>;
  impl.initBodies();
}

export function initBodies(): void { impl.initBodies(); }
export function stepBodies(dt: number) { return impl.stepBodies(dt); }
export function makeBody(cells: number[], kind: BodyKind, vx = 0, vy = 0, av = 0): BodyRec | null {
  return impl.makeBody(cells, kind, vx, vy, av) as unknown as BodyRec | null;
}
export function bodyAtIndex(i: number): BodyRec | null { return impl.bodyAtIndex(i) as unknown as BodyRec | null; }
export function removeBody(rec: BodyRec, rasterizeCells: boolean): void { (impl as typeof PL).removeBody(rec as unknown as PL.BodyRec, rasterizeCells); }
export function refreshBody(rec: BodyRec): void { (impl as typeof PL).refreshBody(rec as unknown as PL.BodyRec); }
export function impulseAt(rec: BodyRec, x: number, y: number, ix: number, iy: number): void { (impl as typeof PL).impulseAt(rec as unknown as PL.BodyRec, x, y, ix, iy); }

/**
 * Drop `n` mixed logs (2-6 m) and snow slabs (0.5-1.5 m) from above grid position (x, y) (cells).
 * Bodies are laid out in free air, highest first; returns how many were actually created
 * (bodies.ts/bodies_rapier.ts cap live bodies at MAX_BODIES = 60, extra spawns evict older slabs).
 */
export function spawnStressTest(n: number, x: number, y: number): number {
  let made = 0, seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let k = 0; k < n; k++) {
    const log = rnd() < 0.5;
    const len = Math.round((log ? 40 + rnd() * 80 : 10 + rnd() * 20)), th = log ? 4 + ((rnd() * 4) | 0) : 5 + ((rnd() * 5) | 0);
    const x0 = Math.round(x - 150 + rnd() * 300 - len / 2);
    let y0 = Math.round(y - 20 - th);
    // search upward for a free air box
    let ok = false;
    for (let t = 0; t < 40 && y0 > 2; t++, y0 -= th + 3) {
      if (!inb(x0, y0) || !inb(x0 + len, y0 + th)) break;
      ok = true;
      for (let yy = y0; yy < y0 + th && ok; yy++) for (let xx = x0; xx < x0 + len; xx += 2) if (mat[idx(xx, yy)] !== M.AIR) { ok = false; break; }
      if (ok) break;
    }
    if (!ok) continue;
    const cells: number[] = [];
    for (let yy = y0; yy < y0 + th; yy++) for (let xx = x0; xx < x0 + len; xx++) {
      if (log) setCell(xx, yy, M.WOOD, 500, 0, 0);
      else setCell(xx, yy, M.SNOW, 380, 200, 0);
      cells.push(idx(xx, yy));
    }
    const rec = makeBody(cells, log ? 'beam' : 'slab', (rnd() - 0.5) * 2, 0, (rnd() - 0.5) * 2);
    if (rec) made++;
  }
  void W; void CELL;
  return made;
}
