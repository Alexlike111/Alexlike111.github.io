// Procedural canvas textures (ground per theme, road ribbon per track). No external assets.
import * as THREE from 'three';
import type { TrackDef } from '../types';
import type { ThemePalette } from './palette';
import { makeRng } from './util';

const hex = (n: number): string => '#' + n.toString(16).padStart(6, '0');

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}

/** draw at 9 offsets so the pattern tiles seamlessly */
function wrap(size: number, fn: (ox: number, oy: number) => void): void {
  for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) fn(ox * size, oy * size);
}

function finish(c: HTMLCanvasElement, repeat: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Tile of ground; one tile covers `GROUND_TILE` metres. */
export const GROUND_TILE = 56;

export function makeGroundTexture(theme: TrackDef['theme'], pal: ThemePalette): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = makeCanvas(S, S);
  const rng = makeRng(theme.length * 977 + 5);
  g.fillStyle = hex(pal.ground);
  g.fillRect(0, 0, S, S);

  if (theme === 'meadow') {
    // mowing stripes
    g.fillStyle = hex(pal.groundAlt);
    for (let i = 0; i < 8; i += 2) g.fillRect(i * (S / 8), 0, S / 8, S);
  }
  // big soft blotches
  for (let i = 0; i < 46; i++) {
    const x = rng() * S, y = rng() * S, r = 18 + rng() * 54;
    g.globalAlpha = 0.16 + rng() * 0.2;
    g.fillStyle = hex(rng() > 0.5 ? pal.groundDark : pal.groundAlt);
    wrap(S, (ox, oy) => { g.beginPath(); g.ellipse(x + ox, y + oy, r, r * (0.6 + rng() * 0.4), rng() * 3, 0, 6.3); g.fill(); });
  }
  g.globalAlpha = 1;
  if (theme === 'meadow') {
    // grass tufts
    g.strokeStyle = hex(pal.groundDark); g.lineWidth = 2.2; g.lineCap = 'round';
    for (let i = 0; i < 300; i++) {
      const x = rng() * S, y = rng() * S, h = 4 + rng() * 5;
      g.globalAlpha = 0.32;
      wrap(S, (ox, oy) => { g.beginPath(); g.moveTo(x + ox - 3, y + oy); g.lineTo(x + ox - 1, y + oy - h); g.moveTo(x + ox + 3, y + oy); g.lineTo(x + ox + 1, y + oy - h); g.stroke(); });
    }
  } else if (theme === 'desert') {
    // wind ripples
    g.lineWidth = 3; g.lineCap = 'round';
    for (let i = 0; i < 34; i++) {
      const y = rng() * S, x = rng() * S, len = 50 + rng() * 120;
      g.strokeStyle = hex(rng() > 0.5 ? pal.groundDark : 0xfbe3a8);
      g.globalAlpha = 0.45;
      wrap(S, (ox, oy) => { g.beginPath(); g.moveTo(x + ox, y + oy); g.quadraticCurveTo(x + ox + len / 2, y + oy - 9, x + ox + len, y + oy); g.stroke(); });
    }
    g.globalAlpha = 0.5; g.fillStyle = hex(pal.groundDark);
    for (let i = 0; i < 220; i++) { const x = rng() * S, y = rng() * S; g.fillRect(x, y, 2, 2); }
  } else {
    // sparkles and blue drifts
    g.globalAlpha = 0.9; g.fillStyle = '#ffffff';
    for (let i = 0; i < 160; i++) { const x = rng() * S, y = rng() * S; g.fillRect(x, y, 2.2, 2.2); }
    g.globalAlpha = 0.5; g.strokeStyle = hex(pal.groundDark); g.lineWidth = 3; g.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      const x = rng() * S, y = rng() * S, len = 40 + rng() * 90;
      wrap(S, (ox, oy) => { g.beginPath(); g.moveTo(x + ox, y + oy); g.quadraticCurveTo(x + ox + len / 2, y + oy + 10, x + ox + len, y + oy - 4); g.stroke(); });
    }
  }
  g.globalAlpha = 1;
  return finish(c, true);
}

/** Metres of road covered by one texture repeat along the track. */
export const ROAD_TILE = 12;

export function makeRoadTexture(width: number, shoulder: number, laneCount: number, pal: ThemePalette): THREE.CanvasTexture {
  const W = 512, H = 512;
  const [c, g] = makeCanvas(W, H);
  const total = width + shoulder * 2;
  const px = W / total;           // px per metre across
  const py = H / ROAD_TILE;       // px per metre along
  const rng = makeRng(31337);
  g.fillStyle = hex(pal.shoulder); g.fillRect(0, 0, W, H);
  // shoulder blotches
  for (let i = 0; i < 70; i++) {
    g.globalAlpha = 0.5; g.fillStyle = hex(pal.shoulderAlt);
    const x = rng() < 0.5 ? rng() * shoulder * px : W - rng() * shoulder * px;
    g.beginPath(); g.ellipse(x, rng() * H, 10 + rng() * 22, 8 + rng() * 22, rng() * 3, 0, 6.3); g.fill();
  }
  g.globalAlpha = 1;
  const x0 = shoulder * px, x1 = (shoulder + width) * px;
  // asphalt
  g.fillStyle = hex(pal.road); g.fillRect(x0, 0, x1 - x0, H);
  // darker rubbered-in lane centres
  for (let l = 0; l < laneCount; l++) {
    const cx = x0 + ((l + 0.5) / laneCount) * (x1 - x0), hw = 0.75 * px;
    const gr = g.createLinearGradient(cx - hw, 0, cx + hw, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, hex(pal.roadWear)); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = 0.55; g.fillStyle = gr; g.fillRect(cx - hw, 0, hw * 2, H);
  }
  g.globalAlpha = 1;
  // speckles
  for (let i = 0; i < 1700; i++) {
    g.globalAlpha = 0.14 + rng() * 0.1;
    g.fillStyle = rng() > 0.5 ? '#ffffff' : '#000000';
    g.fillRect(x0 + rng() * (x1 - x0), rng() * H, 1.6, 1.6);
  }
  g.globalAlpha = 1;
  // asphalt edge shadow
  g.fillStyle = 'rgba(0,0,0,0.22)';
  g.fillRect(x0, 0, 0.18 * px, H); g.fillRect(x1 - 0.18 * px, 0, 0.18 * px, H);
  // solid edge lines
  g.fillStyle = hex(pal.roadLine);
  const lw = 0.26 * px, inset = 0.5 * px;
  g.fillRect(x0 + inset, 0, lw, H);
  g.fillRect(x1 - inset - lw, 0, lw, H);
  // dashed lane lines
  const dash = 3 * py;
  for (let l = 1; l < laneCount; l++) {
    const cx = x0 + (l / laneCount) * (x1 - x0) - lw / 2;
    g.globalAlpha = 0.85;
    g.fillRect(cx, 0.5 * py, lw, dash);
    g.fillRect(cx, 6.5 * py, lw, dash);
  }
  g.globalAlpha = 1;
  const t = finish(c, false);
  t.wrapT = THREE.RepeatWrapping;
  t.wrapS = THREE.ClampToEdgeWrapping;
  return t;
}
