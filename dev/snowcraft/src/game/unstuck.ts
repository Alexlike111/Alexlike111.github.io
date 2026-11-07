// Anti-stuck safety net. Snow can pile up INSIDE the player's body box (flakes, slides, avalanches, placed blocks),
// because the player is not a grid cell. Order of remedies: stand on top of the risen snow → shake loose snow off as
// flying cells → eject to the nearest free standing spot. The U key is a manual "get me out" (nearest outdoor spot).
import { G, toast } from './state';
import { W, mat, aux, setCell } from '../engine/grid';
import { boxFree } from '../engine/phys';
import { throwCell } from '../engine/particles';
import { surfaceY } from '../engine/sim';
import { PHASE, P_POWDER, WALK } from '../content/materials';
import { input } from '../engine/input';
import { strings } from '../content/i18n';

const S = strings('unstuck', {
  out: 'Выбрался из снега.',
  shake: 'Снег засыпал тебя. Отряхнулся.',
  hint: 'Застрял? Копай лопатой вбок или вверх, или нажми U.',
});

let stillT = 0, lastX = 0, lastY = 0, hintCd = 0, ejectCd = 0, uPressed = false, shaken = 0, hooked = false;

function hook() {
  if (hooked || typeof window === 'undefined') return;
  hooked = true;
  window.addEventListener('keydown', (e) => { if (e.code === 'KeyU' && !e.repeat) uPressed = true; });
}

function standable(x: number, y: number, w: number, h: number) { return boxFree(x, y, w, h) && !boxFree(x, y + 1, w, h); }

/** Nearest free spot where the box can stand (rings of growing size, nearest in each ring). */
function nearestStand(px: number, py: number, w: number, h: number, maxR: number): { x: number; y: number } | null {
  for (let r = 1; r <= maxR; r++) {
    let best: { x: number; y: number } | null = null, bd = 1e9;
    for (let dy = -r; dy <= r; dy++) {
      const edge = Math.abs(dy) === r;
      for (let dx = -r; dx <= r; dx += edge ? 1 : 2 * r) {
        const x = px + dx, y = py + dy;
        if (!standable(x, y, w, h)) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = { x, y }; }
      }
    }
    if (best) return best;
  }
  return null;
}

/** Nearest outdoor standing spot on the snow surface (alternating left/right columns). */
function outdoorSpot(px: number, w: number, h: number): { x: number; y: number } | null {
  for (let d = 0; d <= 140; d++) {
    for (const x of d === 0 ? [px] : [px + d, px - d]) {
      const sx = Math.round(x);
      if (sx < 6 || sx > W - 6) continue;
      const y = surfaceY(sx);
      if (standable(sx, y, w, h)) return { x: sx, y };
    }
  }
  return null;
}

/** Throw loose powder out of the body box; returns how many cells were removed. */
function shakeOff(px: number, py: number, w: number, h: number): number {
  const x0 = Math.floor(px - w / 2), x1 = Math.ceil(px + w / 2) - 1, y0 = Math.floor(py - h), y1 = Math.ceil(py) - 1;
  let n = 0;
  for (let y = y0; y <= y1 && n < 90; y++) for (let x = x0; x <= x1 && n < 90; x++) {
    if (y < 0) continue;
    const i = y * W + x, m = mat[i];
    if (!WALK[m] || PHASE[m] !== P_POWDER) continue;
    const a = aux[i];
    setCell(x, y, 0);
    const dir = x < px ? -1 : 1;
    throwCell(x + 0.5, y + 0.5, m, a, dir * (3 + Math.random() * 6), -(6 + Math.random() * 9));
    n++;
  }
  return n;
}

export function stepUnstuck(dt: number) {
  hook();
  const p = G.player;
  if (!p || !p.alive) return;
  hintCd -= dt; ejectCd -= dt;

  if (!boxFree(p.x, p.y, p.w, p.h)) {
    // 1) the snow level rose under the feet: stand on top of it
    for (let k = 1; k <= 8; k++) {
      if (boxFree(p.x, p.y - k, p.w, p.h)) { p.y -= k; if (p.vy > 0) p.vy = 0; p.onGround = true; return; }
    }
    // 2) loose snow packed into the body: shake it off as flying cells
    if (shakeOff(p.x, p.y, p.w, p.h) > 0) { if (shaken++ % 8 === 0) toast(S.shake, 'info'); return; }
    // 3) something solid: nearest free standing spot
    const s = nearestStand(Math.round(p.x), Math.round(p.y), p.w, p.h, 70) ?? outdoorSpot(p.x, p.w, p.h);
    if (s) { p.x = s.x; p.y = s.y; p.vx = 0; p.vy = 0; toast(S.out, 'info'); }
    return;
  }

  // manual "get me out": U
  if (uPressed) {
    uPressed = false;
    if (ejectCd <= 0) {
      const s = outdoorSpot(p.x, p.w, p.h);
      if (s) { p.x = s.x; p.y = s.y; p.vx = 0; p.vy = 0; ejectCd = 10; stillT = 0; toast(S.out, 'info'); }
    }
  }

  // trapped hint: pushing for 3 s without moving
  const want = Math.abs(input.moveX) > 0.3 || input.jumpHeld;
  const moved = Math.abs(p.x - lastX) + Math.abs(p.y - lastY);
  lastX = p.x; lastY = p.y;
  if (want && p.onGround && moved < 0.05) stillT += dt; else stillT = 0;
  if (stillT > 3 && hintCd <= 0) { toast(S.hint, 'info'); hintCd = 40; stillT = 0; }
}

/** Test hook: reset timers. */
export function resetUnstuck() { stillT = 0; hintCd = 0; ejectCd = 0; uPressed = false; shaken = 0; }
