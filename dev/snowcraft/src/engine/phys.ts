// Box-vs-grid collision for walkers (player, animals, drops). Boxes use FEET-CENTRE coordinates:
// x = horizontal centre, y = bottom edge, the box covers [x-w/2, x+w/2) × [y-h, y).
import { W, H, mat } from './grid';
import { WALK, PHASE, P_LIQUID } from '../content/materials';
import { clusters, bodyCellAt } from './bodies';

export interface Box { x: number; y: number; vx: number; vy: number; w: number; h: number; onGround: boolean }
export interface MoveOpts { stepUp?: number; swim?: boolean }
export interface MoveResult { hitWall: boolean; hitCeil: boolean; landedSpeed: number; inWater: number }

const EPS = 1e-5;
let ignoreBodies = false;

/** Solid for walkers: WALK materials (solids, powders), the world edge and falling clusters. */
export function solidAt(x: number, y: number): boolean {
  const cx = Math.floor(x), cy = Math.floor(y);
  if (cx < 0 || cx >= W || cy >= H) return true;
  if (cy < 0) return false;
  if (WALK[mat[cy * W + cx]]) return true;
  return clusters.length > 0 && !ignoreBodies && bodyCellAt(cx, cy);
}

function free(x: number, y: number, w: number, h: number): boolean {
  const x0 = Math.floor(x - w / 2 + EPS), x1 = Math.ceil(x + w / 2 - EPS) - 1;
  const y0 = Math.floor(y - h + EPS), y1 = Math.ceil(y - EPS) - 1;
  if (x0 < 0 || x1 >= W || y1 >= H) return false;
  for (let cy = y0 < 0 ? 0 : y0; cy <= y1; cy++) {
    const row = cy * W;
    for (let cx = x0; cx <= x1; cx++) {
      if (WALK[mat[row + cx]]) return false;
      if (clusters.length > 0 && !ignoreBodies && bodyCellAt(cx, cy)) return false;
    }
  }
  return true;
}
/** Is the box (feet-centre x,y) free of solids? */
export function boxFree(x: number, y: number, w: number, h: number): boolean { return free(x, y, w, h); }

/** Fraction (0..1) of the box height that is under liquid. */
export function submersion(x: number, y: number, w: number, h: number): number {
  const cx = Math.floor(x), top = Math.floor(y - h), bot = Math.ceil(y) - 1;
  if (cx < 0 || cx >= W || bot < 0) return 0;
  let n = 0;
  for (let cy = Math.max(0, top); cy <= Math.min(H - 1, bot); cy++) if (PHASE[mat[cy * W + cx]] === P_LIQUID) n++;
  void w;
  return n / Math.max(1, h);
}

/** Material id of the first solid cell under the box's feet (or 0). */
export function matBelow(x: number, y: number): number {
  const cx = Math.floor(x), cy = Math.floor(y + 0.5);
  if (cx < 0 || cx >= W || cy < 0 || cy >= H) return 0;
  return mat[cy * W + cx];
}

const res: MoveResult = { hitWall: false, hitCeil: false, landedSpeed: 0, inWater: 0 };

/** Integrate the box by its own velocity (gravity is applied by the caller). Axis-separated, swept cell by cell. */
export function moveBox(b: Box, dt: number, o?: MoveOpts): MoveResult {
  const stepUp = o?.stepUp ?? 0;
  res.hitWall = false; res.hitCeil = false; res.landedSpeed = 0;
  // a box that starts inside a falling cluster must not be pinned by it
  ignoreBodies = false;
  if (clusters.length > 0 && !free(b.x, b.y, b.w, b.h)) ignoreBodies = true;
  // water: drag on both axes, proportional to submersion
  const sub = submersion(b.x, b.y, b.w, b.h);
  res.inWater = sub;
  if (sub > 0.05) {
    const k = Math.max(0, 1 - (o?.swim ? 3 : 4.5) * sub * dt);
    b.vx *= k; b.vy *= k;
  }

  // ---- X ----
  let dx = b.vx * dt;
  if (dx !== 0) {
    const sgn = dx > 0 ? 1 : -1;
    let rem = Math.abs(dx);
    while (rem > 0) {
      const st = rem > 0.5 ? 0.5 : rem;
      rem -= st;
      const nx = b.x + sgn * st;
      if (free(nx, b.y, b.w, b.h)) { b.x = nx; continue; }
      // step up
      let up = 0;
      if (stepUp > 0 && (b.onGround || sub > 0.3)) {
        for (let s = 1; s <= stepUp; s++) if (free(nx, b.y - s, b.w, b.h)) { up = s; break; }
      }
      if (up > 0) { b.x = nx; b.y -= up; continue; }
      // blocked: snap to the cell boundary
      if (sgn > 0) { const edge = Math.floor(nx + b.w / 2 - EPS); b.x = Math.max(b.x, edge - b.w / 2); }
      else { const edge = Math.floor(nx - b.w / 2 + EPS) + 1; b.x = Math.min(b.x, edge + b.w / 2); }
      res.hitWall = true; b.vx = 0;
      break;
    }
  }

  // ---- Y ----
  const dy = b.vy * dt;
  if (dy !== 0) {
    const sgn = dy > 0 ? 1 : -1;
    let rem = Math.abs(dy);
    while (rem > 0) {
      const st = rem > 0.5 ? 0.5 : rem;
      rem -= st;
      const ny = b.y + sgn * st;
      if (free(b.x, ny, b.w, b.h)) { b.y = ny; continue; }
      if (sgn > 0) {
        res.landedSpeed = b.vy;
        const edge = Math.floor(ny - EPS);
        b.y = Math.max(b.y, edge);
      } else {
        res.hitCeil = true;
        const edge = Math.floor(ny - b.h + EPS) + 1;
        b.y = Math.min(b.y, edge + b.h);
      }
      b.vy = 0;
      break;
    }
  }

  // ground probe
  b.onGround = !free(b.x, b.y + 0.05, b.w, b.h) && b.vy >= 0;
  ignoreBodies = false;
  return res;
}
