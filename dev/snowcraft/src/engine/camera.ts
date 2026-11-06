// Camera: smooth follow with look-ahead, vertical dead zone, world clamp and shake decay.
// Owner: world/render agent. G.cam = { x, y (centre, cells), scale, shake, viewW, viewH } (viewW/viewH are written by render.resize()).
import { G } from '../game/state';
import { W, H } from './grid';

let lookX = 0, lookY = 0;          // extra aim-driven offset in cells (set by gameplay each frame, e.g. toward the cursor)
let leadX = 0, leadY = 0;          // smoothed velocity look-ahead
let lastTx = NaN, lastTy = NaN;
let vxs = 0, vys = 0;              // smoothed target velocity estimate (cells/s)
let initialised = false;

const DEAD_Y = 12;                 // vertical dead zone half-height in cells
const MAX_LEAD_X = 34, MAX_LEAD_Y = 16;

/** Aim look-ahead in cells (e.g. (aimWorld - player) * 0.25 clamped). Call each frame; 0,0 to disable. */
export function setCameraLook(dx: number, dy: number) { lookX = dx; lookY = dy; }
/** Add screen shake (cells of amplitude); the largest pending value wins. */
export function addShake(amount: number) { if (amount > G.cam.shake) G.cam.shake = amount; }

/** Clamp the camera centre so the view never leaves the world. */
export function clampCamera() {
  const c = G.cam, hw = c.viewW / 2, hh = c.viewH / 2;
  c.x = hw * 2 >= W ? W / 2 : Math.min(W - hw, Math.max(hw, c.x));
  c.y = hh * 2 >= H ? H / 2 : Math.min(H - hh, Math.max(hh, c.y));
}

/** Follow target (tx,ty) in cells. snap = jump instantly (teleport / respawn / boot). */
export function updateCamera(dt: number, tx: number, ty: number, snap = false) {
  const c = G.cam;
  if (dt > 0.1) dt = 0.1;
  if (!initialised || snap || !isFinite(lastTx)) {
    c.x = tx; c.y = ty; leadX = leadY = vxs = vys = 0; initialised = true;
  } else if (dt > 0) {
    // target velocity estimate (low-pass) -> look-ahead
    const ivx = (tx - lastTx) / dt, ivy = (ty - lastTy) / dt;
    const k = 1 - Math.exp(-dt * 6);
    vxs += (Math.abs(ivx) < 600 ? ivx - vxs : -vxs) * k;
    vys += (Math.abs(ivy) < 600 ? ivy - vys : -vys) * k;
    const wantX = Math.max(-MAX_LEAD_X, Math.min(MAX_LEAD_X, vxs * 0.3)) + lookX;
    const wantY = Math.max(-MAX_LEAD_Y, Math.min(MAX_LEAD_Y, vys * 0.12)) + lookY;
    const kl = 1 - Math.exp(-dt * 2.2);
    leadX += (wantX - leadX) * kl; leadY += (wantY - leadY) * kl;
    // horizontal: critically damped-ish follow
    const gx = tx + leadX, gy = ty + leadY;
    const kf = 1 - Math.exp(-dt * 7);
    c.x += (gx - c.x) * kf;
    // vertical: dead zone, then follow
    const dy = gy - c.y;
    const over = Math.abs(dy) - DEAD_Y;
    if (over > 0) c.y += Math.sign(dy) * over * (1 - Math.exp(-dt * 5));
  }
  lastTx = tx; lastTy = ty;
  clampCamera();
  c.shake *= Math.exp(-dt * 7);
  if (c.shake < 0.02) c.shake = 0;
}
