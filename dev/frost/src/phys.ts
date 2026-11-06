// Rigid bodies: Rapier 2D (wasm) backend, re-exported under one module name.
// (planck.js was removed after the in-game benchmark: same scenario, 5x slower on phones.)
import * as RP from './bodies_rapier';
import { M, W, CELL, mat, body as bodyGrid, set as setCell, idx, inb } from './world';

export type BodyKind = RP.BodyKind;
export type BodyRec = RP.BodyRec;

export const engine = 'rapier' as const;
export const bodies = RP.bodies;
export const allBodies = (): Map<number, BodyRec> => RP.bodies;
/** Load the wasm module and create the world (call once at boot, before initBodies). */
export const initPhysics = RP.initPhysics;

export function initBodies(): void { RP.initBodies(); }
export function stepBodies(dt: number) { return RP.stepBodies(dt); }
export function makeBody(cells: number[], kind: BodyKind, vx = 0, vy = 0, av = 0): BodyRec | null { return RP.makeBody(cells, kind, vx, vy, av); }
export function bodyAtIndex(i: number): BodyRec | null { return RP.bodyAtIndex(i); }
export function removeBody(rec: BodyRec, rasterizeCells: boolean): void { RP.removeBody(rec, rasterizeCells); }
export function refreshBody(rec: BodyRec): void { RP.refreshBody(rec); }
export function impulseAt(rec: BodyRec, x: number, y: number, ix: number, iy: number): void { RP.impulseAt(rec, x, y, ix, iy); }

/**
 * Drop `n` mixed logs (2-6 m) and snow slabs (0.5-1.5 m) from above grid position (x, y) (cells).
 * Bodies are laid out in free air, highest first; returns how many were actually created
 * (bodies_rapier.ts caps live bodies at MAX_BODIES = 60, extra spawns evict older slabs).
 */
export function spawnStressTest(n: number, x: number, y: number): number {
  let made = 0, seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let k = 0; k < n; k++) {
    const log = rnd() < 0.5;
    const len = Math.round((log ? 40 + rnd() * 80 : 10 + rnd() * 20)), th = log ? 4 + ((rnd() * 4) | 0) : 5 + ((rnd() * 5) | 0);
    const x0 = Math.round(x - 150 + rnd() * 300 - len / 2);
    let y0 = Math.round(y - 20 - th);
    // search upward for a free box: every cell must be AIR and not belong to a body (never overwrite terrain / bodies)
    let ok = false;
    for (let t = 0; t < 40 && y0 > 2; t++, y0 -= th + 3) {
      if (!inb(x0, y0) || !inb(x0 + len - 1, y0 + th - 1)) break;
      ok = true;
      for (let yy = y0; yy < y0 + th && ok; yy++) for (let xx = x0; xx < x0 + len; xx++) { const i = idx(xx, yy); if (mat[i] !== M.AIR || bodyGrid[i] !== 0) { ok = false; break; } }
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
    else for (const i of cells) if (bodyGrid[i] === 0) setCell(i % W, (i / W) | 0, M.AIR); // makeBody refused: take the cells back
  }
  void W; void CELL;
  return made;
}
