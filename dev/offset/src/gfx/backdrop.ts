// Parallax backdrop printed in light halftones.
import { Renderer, ink } from './gl';
import type { Camera } from './camera';
import type { Level } from '../game/level';

function hash(n: number) { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); }
export function drawBackdrop(R: Renderer, cam: Camera, L: Level, t: number) {
  const gy = L.groundY;
  // sky: plate A ramp (paper at the top → light indigo at the horizon), sun disc on plate C
  R.setCamera(cam.cx, cam.cy, cam.ppm);
  const x0 = cam.x0 - 2, w = cam.viewW + 4, top = cam.y0 - 2;
  R.rectG(x0, top, w, gy - top, ink(0.0, 0, 0.0), ink(0.07, 0, 0.1));
  // far layers move slower: emulate by offsetting world x with parallax factor
  for (let layer = 0; layer < 3; layer++) {
    const par = [0.82, 0.62, 0.38][layer]; const dens = [0.07, 0.12, 0.19][layer]; const ox = cam.cx * par, oy = (cam.cy - gy) * par * 0.55;
    if (layer === 0) { // sun
      const sx = ox + 9 + (L.x0 + L.x1) * 0.5 * (1 - par), sy = gy - 15 + oy; R.circle(sx, sy, 5.2, ink(0, 0, 0.85), 48); R.circle(sx, sy, 6.4, ink(0, 0.0, 0.25), 48); R.circle(sx, sy, 5.2, ink(0, 0, 0.85), 48);
    }
    const cellW = [7, 5.2, 4.1][layer]; const first = Math.floor((cam.x0 - ox - 8) / cellW), last = Math.ceil((cam.x1 - ox + 8) / cellW);
    for (let i = first; i <= last; i++) {
      const h1 = hash(i * 3.1 + layer * 17), h2 = hash(i * 7.7 + layer * 5), h3 = hash(i * 1.3 + layer * 29);
      if (h3 < 0.18) continue;
      const bw = cellW * (0.55 + h2 * 0.4), bh = ([13, 9, 6][layer]) * (0.45 + h1 * 0.9);
      const bx = ox + i * cellW + h2 * 1.2, by = gy + oy - bh + [3.5, 2, 0.6][layer];
      const k = ink(dens, 0, layer === 2 ? 0.05 : 0);
      R.rect(bx, by, bw, bh + 30, k);
      // roof furniture: tanks, masts, saw-tooth roofs (print works)
      if (h1 > 0.6) { R.rect(bx + bw * 0.15, by - 0.9, bw * 0.3, 0.9, k); R.rect(bx + bw * 0.27, by - 2.6, 0.12, 1.7, k); }
      else if (h1 > 0.3) { for (let s = 0; s < 3; s++) R.tri(bx + (s / 3) * bw, by, bx + ((s + 1) / 3) * bw, by, bx + (s / 3) * bw, by - 1.1, k); }
      if (layer > 0 && h2 > 0.35) { // lit windows on plate C
        const cols = Math.max(2, Math.floor(bw / 0.9)), rows = Math.min(7, Math.floor(bh / 1.3));
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (hash(i * 31 + r * 7 + c * 13 + layer) > 0.62) R.rect(bx + 0.3 + c * (bw - 0.6) / cols, by + 0.5 + r * 1.3, 0.38, 0.55, ink(0, 0, 0.5));
      }
    }
  }
}
