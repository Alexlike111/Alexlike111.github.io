// Low-poly geometry factories for everything that sits on the track side: walls, curbs, props, trees, decor, landmarks.
// Units: metres, y up. Wall pieces are modelled 4 m long along +x, centred, and stretched in x by the instance matrix.
import * as THREE from 'three';
import { CONFIG } from '../config';
import type { PropType, TrackDef } from '../types';
import { GeoBuilder, groundQuad } from './geo';
import type { ThemePalette } from './palette';
import { makeRng } from './util';

type Theme = TrackDef['theme'];
type Style = TrackDef['wallStyle'];
/** what the walls look like: the track's wallStyle, except snow tracks, which get quiet dark blue-grey jersey blocks instead of busy red / white tyre stacks */
export type WallVisual = Style | 'jersey';
export function wallVisual(def: Pick<TrackDef, 'theme' | 'wallStyle'>): WallVisual {
  return def.theme === 'snow' && def.wallStyle === 'tires' ? 'jersey' : def.wallStyle;
}

export const WALL_BASE_LEN = 4;
const RED = 0xe8383a, WHITE = 0xf6f6f2, BLACK = 0x23262e;

/** One lying tyre: 6-sided drum, painted top ring fading to a dark centre (vertex colours, no extra geometry). */
function tire(b: GeoBuilder, x: number, y: number, z: number, r: number, h: number, band: number): void {
  b.cyl(r, r, h, 6, {
    pos: [x, y, z],
    colorFn: (nx, ny, nz, vx, _vy, vz) => (ny > 0.5 ? (Math.hypot(vx - x, vz - z) < r * 0.2 ? 0x15171c : band) : 0x2a2d35),
    vgrad: [y - h / 2, y + h / 2, 0.8, 1.05],
    noBottom: true,
  });
}

export function wallGeometry(style: WallVisual, kind: 'wall' | 'guardrail', pal: ThemePalette): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const thick = CONFIG.destruction[kind].thickness;
  const L = WALL_BASE_LEN;
  if (style === 'concrete') {
    if (kind === 'wall') {
      b.box(L, 0.3, thick, { pos: [0, 0.15, 0], color: 0xaab0bc });
      b.frustum(L, thick * 0.86, L, thick * 0.5, 0.6, { pos: [0, 0.6, 0], color: 0xd9dde5, vgrad: [0.3, 0.9, 0.8, 1.05] });
      for (let k = 0; k < 4; k++) b.box(L / 4 - 0.02, 0.2, thick * 0.52, { pos: [(k - 1.5) * (L / 4), 1.0, 0], color: k % 2 ? WHITE : RED, noBottom: true });
    } else {
      b.box(L, 0.26, thick, { pos: [0, 0.13, 0], color: 0xb2b9c6 });
      for (const x of [-1.6, 0, 1.6]) b.box(0.2, 0.8, 0.2, { pos: [x, 0.6, 0], color: 0x6f7787, noBottom: true });
      b.box(L, 0.42, 0.3, { pos: [0, 0.66, 0], color: 0xe4eaf4, vgrad: [0.45, 0.9, 0.85, 1.1] });
      b.box(L, 0.08, 0.34, { pos: [0, 0.44, 0], color: 0x9ba6b8, noBottom: true });
      b.box(L, 0.08, 0.34, { pos: [0, 0.89, 0], color: 0xffffff, noBottom: true });
      for (const x of [-1.6, 1.6]) b.box(0.14, 0.14, 0.36, { pos: [x, 0.66, 0], color: 0xff8a1a });
    }
  } else if (style === 'jersey') {
    // one calm barrier type for snow: dark blue-grey jersey block with a thin snow cap (no stripes, no tyre circles)
    const body = 0x465670, base = 0x34404f, cap = 0xf6faff;
    if (kind === 'wall') {
      b.box(L, 0.2, thick * 0.96, { pos: [0, 0.1, 0], color: base });
      b.frustum(L - 0.06, thick * 0.88, L - 0.06, thick * 0.5, 0.62, { pos: [0, 0.51, 0], color: body, vgrad: [0.2, 0.82, 0.82, 1.12] });
      b.box(L - 0.16, 0.1, thick * 0.4, { pos: [0, 0.86, 0], color: cap, noBottom: true });
    } else {
      b.box(L, 0.16, thick * 0.96, { pos: [0, 0.08, 0], color: base });
      b.frustum(L - 0.06, thick * 0.86, L - 0.06, thick * 0.46, 0.46, { pos: [0, 0.39, 0], color: body, vgrad: [0.16, 0.62, 0.82, 1.12] });
      b.box(L - 0.16, 0.08, thick * 0.38, { pos: [0, 0.65, 0], color: cap, noBottom: true });
    }
  } else if (style === 'tires') {
    if (kind === 'wall') {
      for (let k = 0; k < 3; k++) tire(b, (k - 1) * 1.33, 0.25, 0, 0.66, 0.5, k % 2 ? WHITE : RED);
      for (let k = 0; k < 2; k++) tire(b, (k - 0.5) * 1.33, 0.73, 0, 0.6, 0.46, k % 2 ? RED : WHITE);
    } else {
      for (let k = 0; k < 5; k++) tire(b, (k - 2) * 0.8, 0.2, 0, 0.41, 0.4, k % 2 ? WHITE : RED);
      for (let k = 0; k < 4; k++) tire(b, (k - 1.5) * 0.8, 0.58, 0, 0.37, 0.36, k % 2 ? RED : WHITE);
    }
  } else {   // fence
    const wood = 0xb97e45, woodDark = 0x8d5a2c;
    if (kind === 'wall') {
      b.box(L, 0.2, thick * 0.9, { pos: [0, 0.1, 0], color: woodDark });
      for (let k = 0; k < 4; k++) b.box(L / 4 - 0.04, 0.7, thick * 0.7, { pos: [(k - 1.5) * (L / 4), 0.55, 0], color: k % 2 ? WHITE : RED, vgrad: [0.2, 0.9, 0.85, 1.05], noBottom: true });
      for (const x of [-2, 0, 2]) b.box(0.2, 1.15, 0.2, { pos: [x, 0.58, 0], color: woodDark, noBottom: true });
      b.box(L, 0.1, thick * 0.78, { pos: [0, 0.97, 0], color: wood, noBottom: true });
    } else {
      b.box(L, 0.16, thick * 0.9, { pos: [0, 0.08, 0], color: woodDark });
      for (const x of [-1.9, 0, 1.9]) b.box(0.16, 0.95, 0.16, { pos: [x, 0.48, 0], color: woodDark, noBottom: true });
      b.box(L, 0.15, 0.1, { pos: [0, 0.4, 0], color: wood });
      b.box(L, 0.15, 0.1, { pos: [0, 0.75, 0], color: 0xd9a064 });
      b.box(L / 2 - 0.1, 0.16, 0.12, { pos: [-L / 4, 0.75, 0], color: WHITE });
    }
  }
  void pal;
  return b.build();
}

export function curbGeometry(): THREE.BufferGeometry {
  // 12 triangles per curb piece: four striped top quads + a front and a back lip (curbs are 16 cm high, so the lips are all the side a top-down camera can see)
  const b = new GeoBuilder();
  const n = 4;
  for (let k = 0; k < n; k++) groundQuad(b, (k - (n - 1) / 2) / n, 0, 1 / n, 1.0, 0.16, k % 2 ? WHITE : RED);
  for (const sz of [-1, 1]) {
    const lip = new THREE.PlaneGeometry(1, 0.16);
    b.add(lip, { pos: [0, 0.08, sz * 0.5], rot: [0, sz > 0 ? 0 : Math.PI, 0], color: 0xdcdcd4 });
  }
  return b.build();
}

// ---------------------------------------------------------------- trees and rocks

export function treeGeometry(theme: Theme, pal: ThemePalette, variant = 0): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const g = pal.foliage;
  if (theme === 'meadow') {
    // ~70 triangles: three faceted foliage blobs on a short trunk (the crown is what a top-down camera sees)
    b.cyl(0.22, 0.32, 1.7, 5, { pos: [0, 0.85, 0], color: pal.trunk, vgrad: [0, 1.7, 0.7, 1], noBottom: true });
    b.ico(1.5, 0, { pos: [0, 2.6, 0], scale: [1, 0.95, 1], color: g[variant % g.length], vgrad: [1.1, 4.1, 0.78, 1.12] });
    b.ico(1.05, 0, { pos: [0.55, 3.75, 0.2], rot: [0.4, 0.6, 0], color: g[(variant + 1) % g.length], vgrad: [2.7, 4.8, 0.9, 1.15] });
    b.ico(0.8, 0, { pos: [-0.7, 2.2, -0.55], rot: [0.2, 1.1, 0.3], color: g[(variant + 2) % g.length], vgrad: [1.4, 3.2, 0.8, 1.1] });
  } else if (theme === 'desert') {
    const c = g[variant % g.length], c2 = g[(variant + 1) % g.length];
    b.cyl(0.34, 0.4, 3.6, 6, { pos: [0, 1.8, 0], color: c, vgrad: [0, 3.6, 0.8, 1.1] });
    b.ico(0.36, 0, { pos: [0, 3.65, 0], color: c2 });
    b.cyl(0.2, 0.2, 0.8, 5, { pos: [0.6, 1.5, 0], rot: [0, 0, Math.PI / 2], color: c });
    b.cyl(0.19, 0.2, 1.2, 5, { pos: [0.95, 2.05, 0], color: c, vgrad: [1.4, 2.7, 0.9, 1.1] });
    b.ico(0.2, 0, { pos: [0.95, 2.68, 0], color: c2 });
    b.cyl(0.2, 0.2, 0.7, 5, { pos: [-0.55, 2.1, 0], rot: [0, 0, Math.PI / 2], color: c });
    b.cyl(0.18, 0.19, 0.9, 5, { pos: [-0.88, 2.5, 0], color: c, vgrad: [2, 3, 0.9, 1.1] });
    b.ico(0.18, 0, { pos: [-0.88, 2.97, 0], color: c2 });
  } else if (theme === 'night') {
    // neon street lamp: dark pole, arm and a glowing head (the top-down camera sees the bright head and its halo disc)
    const glow = g[variant % g.length];
    b.cyl(0.14, 0.2, 4.2, 5, { pos: [0, 2.1, 0], color: pal.trunk, noBottom: true });
    b.box(1.6, 0.18, 0.22, { pos: [0.7, 4.15, 0], color: pal.trunk });
    b.box(0.9, 0.3, 0.6, { pos: [1.35, 3.95, 0], color: 0xffffff });
    b.cyl(1.25, 1.25, 0.05, 8, { pos: [1.35, 0.04, 0], color: glow, noBottom: true });
  } else {
    // ~75 triangles: three stacked cones (snow caps lose their hidden bottoms)
    b.cyl(0.2, 0.28, 1.0, 4, { pos: [0, 0.5, 0], color: pal.trunk, noBottom: true });
    const col = g[variant % g.length];
    const tiers: [number, number, number][] = [[1.7, 1.9, 1.6], [1.35, 1.7, 2.6], [0.95, 1.5, 3.55]];
    for (const [r, h, y] of tiers) {
      b.cyl(0, r, h, 6, { pos: [0, y, 0], color: col, vgrad: [y - h / 2, y + h / 2, 0.75, 1.1] });
      b.cyl(0, r * 0.62, h * 0.55, 6, { pos: [0, y + h * 0.28, 0], color: 0xffffff, vgrad: [y, y + h, 0.9, 1.05], noBottom: true });
    }
  }
  return b.build();
}

export function rockGeometry(pal: ThemePalette, seed = 1): THREE.BufferGeometry {
  const rng = makeRng(seed * 31 + 7);
  const b = new GeoBuilder();
  const blob = (r: number, sc: [number, number, number], pos: [number, number, number], rot: number): void => {
    const g = new THREE.IcosahedronGeometry(r, 0);
    const P = g.getAttribute('position') as THREE.BufferAttribute;
    const seen = new Map<string, number>();
    for (let i = 0; i < P.count; i++) {
      const key = `${P.getX(i).toFixed(3)},${P.getY(i).toFixed(3)},${P.getZ(i).toFixed(3)}`;
      let k = seen.get(key);
      if (k === undefined) { k = 0.8 + rng() * 0.4; seen.set(key, k); }
      P.setXYZ(i, P.getX(i) * k, P.getY(i) * k, P.getZ(i) * k);
    }
    b.add(g, { scale: sc, pos, rot: [0, rot, 0], color: pal.rock, colorFn: (nx, ny) => (ny > 0.55 ? pal.rock : pal.rockDark), vgrad: [-0.2, 1.2, 0.8, 1.12] });
  };
  blob(1, [1, 0.72, 0.9], [0, 0.5, 0], 0);                 // main boulder (20 faces)
  blob(0.5, [1, 0.7, 1], [0.64, 0.25, 0.3], 0.8);        // companion
  return b.build();
}

// ---------------------------------------------------------------- props

export function propGeometry(type: PropType, theme: Theme, pal: ThemePalette): THREE.BufferGeometry {
  const P = CONFIG.destruction.props[type];
  const b = new GeoBuilder();
  switch (type) {
    case 'cone':
      b.box(0.52, 0.05, 0.52, { pos: [0, 0.025, 0], color: 0xe5651a, noBottom: true });
      b.cyl(0.07, 0.21, 0.55, 6, { pos: [0, 0.33, 0], color: 0xff7a1a, vgrad: [0.05, 0.6, 0.85, 1.1] });
      b.cyl(0.11, 0.14, 0.11, 6, { pos: [0, 0.34, 0], color: WHITE, noBottom: true });
      break;
    case 'barrel':
      // 8-sided drum: the lid is painted with vertex colours (dark centre) instead of an extra disc mesh
      b.cyl(0.45, 0.45, 0.9, 8, {
        pos: [0, 0.45, 0], noBottom: true, vgrad: [0, 0.9, 0.8, 1.1],
        colorFn: (nx, ny, nz, vx, _vy, vz) => (ny > 0.5 ? (Math.hypot(vx, vz) < 0.2 ? 0xb52a2c : RED) : RED),
      });
      b.cyl(0.47, 0.47, 0.1, 8, { pos: [0, 0.25, 0], color: 0xf3f3f3, noBottom: true });
      b.cyl(0.47, 0.47, 0.1, 8, { pos: [0, 0.65, 0], color: 0xf3f3f3, noBottom: true });
      break;
    case 'crate': {
      const w = P.w;
      b.box(w, w, w, { pos: [0, w / 2, 0], color: 0xd6a15a, vgrad: [0, w, 0.82, 1.08] });
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) b.box(0.12, w + 0.02, 0.12, { pos: [sx * (w / 2 - 0.05), w / 2, sz * (w / 2 - 0.05)], color: 0x9b6a34 });
      b.box(w * 1.28, 0.06, 0.14, { pos: [0, w + 0.01, 0], rot: [0, 0.785, 0], color: 0x9b6a34 });
      b.box(w * 1.28, 0.06, 0.14, { pos: [0, w + 0.01, 0], rot: [0, -0.785, 0], color: 0x9b6a34 });
      break;
    }
    case 'tireStack':
      for (let k = 0; k < 3; k++) {
        const y = 0.18 + k * 0.36, band = k % 2 ? WHITE : RED;
        b.cyl(0.55, 0.55, 0.36, 8, {
          pos: [0, y, 0], noBottom: true,
          colorFn: (nx, ny, nz, vx, _vy, vz) => (ny > 0.5 ? (Math.hypot(vx, vz) < 0.2 ? 0x15171c : band) : 0x2a2d35),
          vgrad: [y - 0.18, y + 0.18, 0.8, 1.05],
        });
      }
      break;
    case 'sign':
      b.cyl(0.05, 0.06, 1.9, 6, { pos: [0, 0.95, 0], color: 0x8f98a6 });
      b.box(0.9, 0.9, 0.07, { pos: [0, 1.75, 0], color: 0xffd23c });
      b.box(0.62, 0.13, 0.09, { pos: [0.02, 1.75, 0], color: BLACK });
      b.box(0.13, 0.4, 0.09, { pos: [0.3, 1.9, 0], rot: [0, 0, -0.7], color: BLACK });
      b.box(0.13, 0.4, 0.09, { pos: [0.3, 1.6, 0], rot: [0, 0, 0.7], color: BLACK });
      break;
    case 'hayBale':
      // axis along x; the end faces (|nx| > 0.5) are the lighter cut straw
      b.cyl(0.5, 0.5, P.w, 8, { pos: [0, 0.5, 0], rot: [0, 0, Math.PI / 2], colorFn: (nx) => (Math.abs(nx) > 0.5 ? 0xd9b23a : 0xeccb55), vgrad: [0, 1, 0.8, 1.1] });
      for (const x of [-0.5, 0.5]) b.cyl(0.515, 0.515, 0.07, 8, { pos: [x, 0.5, 0], rot: [0, 0, Math.PI / 2], color: 0xb98a2b });
      break;
    case 'tree': return treeGeometry(theme, pal, 0);
    case 'rock': return rockGeometry(pal, 3);
  }
  return b.build();
}

// ---------------------------------------------------------------- small decor

export function flowerGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.cyl(0.0, 0.2, 0.24, 4, { pos: [0, 0.14, 0], color: 0xffffff, paint: 1 });
  return b.build();
}

export function bushGeometry(pal: ThemePalette, theme: Theme): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const c = theme === 'desert' ? 0xcaa862 : theme === 'snow' ? 0xeaf3fb : theme === 'night' ? 0x2f6b5a : pal.foliage[0];
  b.ico(0.75, 0, { pos: [0, 0.45, 0], scale: [1.15, 0.8, 1], color: c, vgrad: [0, 1, 0.78, 1.1] });
  b.ico(0.5, 0, { pos: [0.5, 0.35, 0.2], color: theme === 'meadow' ? pal.foliage[1] : c, vgrad: [0, 0.8, 0.8, 1.1] });
  return b.build();
}

export function duneGeometry(color: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.ico(1, 1, { scale: [1.7, 0.4, 0.75], color, vgrad: [0, 0.4, 0.8, 1.1] });
  return b.build();
}

export function moundGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.ico(1, 1, { scale: [1, 0.45, 1], pos: [0, 0, 0], color: 0xffffff, vgrad: [0, 0.5, 0.88, 1.05] });
  return b.build();
}

export function snowmanGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.ico(0.7, 1, { pos: [0, 0.65, 0], color: 0xffffff });
  b.ico(0.5, 1, { pos: [0, 1.5, 0], color: 0xffffff });
  b.ico(0.34, 1, { pos: [0, 2.15, 0], color: 0xffffff });
  b.cyl(0, 0.07, 0.4, 5, { pos: [0.4, 2.15, 0], rot: [0, 0, -Math.PI / 2], color: 0xff7a1a });
  b.cyl(0.26, 0.26, 0.28, 7, { pos: [0, 2.55, 0], color: BLACK });
  b.cyl(0.36, 0.36, 0.04, 7, { pos: [0, 2.4, 0], color: BLACK });
  b.box(0.18, 0.1, 0.6, { pos: [0.05, 1.8, 0], color: RED });
  return b.build();
}

// ---------------------------------------------------------------- landmarks (merged, few instances)

export function landmarkGeometry(theme: Theme, pal: ThemePalette, variant: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  if (theme === 'meadow') {
    if (variant % 2 === 0) {         // windmill
      b.frustum(5.6, 5.6, 3.2, 3.2, 8, { pos: [0, 4, 0], color: 0xf2ece0, vgrad: [0, 8, 0.8, 1.05] });
      b.cyl(0, 2.6, 2.2, 8, { pos: [0, 9.1, 0], color: 0xd9423a });
      b.box(0.8, 0.8, 1.6, { pos: [1.9, 8.2, 0], color: 0x8a5a36 });
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2 + 0.4;
        b.box(0.35, 6.5, 0.08, { pos: [2.7, 8.2 + Math.cos(a) * 3.25, Math.sin(a) * 3.25], rot: [a, 0, 0], color: 0x8a5a36 });
        b.box(1.4, 3.0, 0.06, { pos: [2.78, 8.2 + Math.cos(a) * 3.8 - Math.sin(a) * 0.9, Math.sin(a) * 3.8 + Math.cos(a) * 0.9], rot: [a, 0, 0], color: 0xfff7e6 });
      }
      b.box(2, 2.2, 0.1, { pos: [2.6, 1.1, 0], color: 0x8a5a36 });
    } else {                         // barn
      b.box(9, 4.2, 6, { pos: [0, 2.1, 0], color: 0xd23f36, vgrad: [0, 4.2, 0.8, 1.05] });
      b.box(9.6, 0.4, 3.9, { pos: [0, 5.2, -1.7], rot: [0.62, 0, 0], color: 0x6b6f7a });
      b.box(9.6, 0.4, 3.9, { pos: [0, 5.2, 1.7], rot: [-0.62, 0, 0], color: 0x6b6f7a });
      b.box(2.6, 3, 0.15, { pos: [0, 1.5, 3.05], color: 0xf6f0e4 });
      b.box(0.2, 3.1, 0.2, { pos: [0, 1.5, 3.12], rot: [0, 0, 0.6], color: 0xd23f36 });
      b.box(0.2, 3.1, 0.2, { pos: [0, 1.5, 3.12], rot: [0, 0, -0.6], color: 0xd23f36 });
      b.cyl(1.0, 1.0, 1.4, 8, { pos: [6.2, 0.7, 1], rot: [0, 0, 0], color: 0xeccb55 });
    }
  } else if (theme === 'desert') {
    const cols = [pal.rock, 0xe0916a, 0xc9743f];
    if (variant % 2 === 0) {         // mesa
      b.frustum(14, 11, 11, 8.5, 4.5, { pos: [0, 2.25, 0], color: cols[0], vgrad: [0, 4.5, 0.75, 1] });
      b.frustum(10.5, 8, 8, 6, 3.6, { pos: [0.5, 6.3, 0], color: cols[1], vgrad: [4.5, 8, 0.8, 1.05] });
      b.frustum(7.5, 5.5, 5.5, 4.2, 3, { pos: [0.2, 9.6, 0], color: cols[2] });
    } else {                         // pyramid + palm-less oasis stones
      b.cyl(0, 8.5, 9, 4, { pos: [0, 4.5, 0], rot: [0, 0.78, 0], color: 0xf0cf8a, vgrad: [0, 9, 0.8, 1.1] });
      b.cyl(0, 3.2, 3.4, 4, { pos: [9, 1.7, 3], rot: [0, 0.78, 0], color: 0xe9c176 });
    }
  } else if (theme === 'night') {
    if (variant % 2 === 0) {         // tower block with lit window bands and a neon roof sign
      b.box(9, 14, 9, { pos: [0, 7, 0], color: 0x2b2f52, vgrad: [0, 14, 0.8, 1.1] });
      for (let k = 0; k < 4; k++) b.box(9.1, 0.6, 9.1, { pos: [0, 3 + k * 3, 0], color: k % 2 ? 0xffe14a : 0x5ff6ff });
      b.box(7, 1.6, 0.4, { pos: [0, 15, 0], color: 0xff4fb8 });
    } else {                         // stacked shipping containers
      const cols = [0xff4fb8, 0x5ff6ff, 0xffe14a, 0x9b6bff];
      for (let k = 0; k < 5; k++) b.box(6, 2.4, 2.4, { pos: [(k % 2) * 1.5 - 0.7, 1.2 + Math.floor(k / 2) * 2.45, (k % 3) * 2.5 - 2.5], color: cols[k % cols.length], vgrad: [0, 8, 0.8, 1.05] });
    }
  } else {
    if (variant % 2 === 0) {         // log cabin with snowy roof
      b.box(7, 3, 5, { pos: [0, 1.5, 0], color: 0x9a6a3e, vgrad: [0, 3, 0.8, 1.05] });
      for (let k = 0; k < 5; k++) b.box(7.1, 0.12, 5.1, { pos: [0, 0.4 + k * 0.6, 0], color: 0x7d5230 });
      b.box(7.8, 0.5, 3.4, { pos: [0, 4, -1.3], rot: [0.6, 0, 0], color: 0xffffff });
      b.box(7.8, 0.5, 3.4, { pos: [0, 4, 1.3], rot: [-0.6, 0, 0], color: 0xffffff });
      b.box(1, 2, 1, { pos: [2, 5, 0.8], color: 0xaa4a3a });
      b.box(1.2, 0.3, 1.2, { pos: [2, 6.1, 0.8], color: 0xffffff });
      b.box(1.2, 1.9, 0.12, { pos: [-1.6, 0.95, 2.55], color: 0x5a3820 });
      b.box(1.2, 1.0, 0.12, { pos: [1.4, 1.7, 2.55], color: 0xffe9a8 });
    } else {                         // ice crystals
      for (let k = 0; k < 6; k++) {
        const a = k * 1.05;
        b.cyl(0, 1.0 + (k % 3) * 0.3, 3 + (k % 3) * 1.5, 5, { pos: [Math.cos(a) * 2, 1.6 + (k % 3) * 0.7, Math.sin(a) * 2], rot: [Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25], color: k % 2 ? 0xbfe6ff : 0x9ed6f7 });
      }
    }
  }
  return b.build();
}

// ---------------------------------------------------------------- scars: what is left where a piece broke off

/** Flat ragged ellipse lying at height y (fan of triangles around the centre, per-vertex radius jitter). */
export function jaggedDisc(rx: number, rz: number, y: number, seg: number, jitter: number, rng: () => number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos: number[] = [];
  const rs: number[] = [];
  for (let i = 0; i < seg; i++) rs.push(1 - jitter + rng() * jitter * 1.5);
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const r0 = rs[i], r1 = rs[(i + 1) % seg];
    pos.push(0, y, 0, Math.cos(a0) * r0 * rx, y, -Math.sin(a0) * r0 * rz, Math.cos(a1) * r1 * rx, y, -Math.sin(a1) * r1 * rz);   // CCW seen from above: normal +y
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function rubble(b: GeoBuilder, rng: () => number, n: number, spanX: number, spanZ: number, size: [number, number], colors: number[]): void {
  for (let i = 0; i < n; i++) {
    const sz = size[0] + (size[1] - size[0]) * rng();
    b.box(sz * (0.8 + rng() * 0.8), sz * (0.45 + rng() * 0.4), sz * (0.7 + rng() * 0.6), {
      pos: [(rng() - 0.5) * 2 * spanX, sz * 0.25, (rng() - 0.5) * 2 * spanZ], rot: [rng() * 0.5, rng() * 3.14, rng() * 0.5],
      color: colors[i % colors.length], vgrad: [0, sz * 0.7, 0.8, 1.1], noBottom: true,
    });
  }
}

/** Dark ground scar + leftover stumps and rubble for a broken wall / guardrail piece (same footprint as the piece, 4 m long). */
/** soil tones of a ground scar: from the theme's dirt colours (dark brown on meadow, sand on desert, grey slush on snow), never black */
function soil(pal: ThemePalette | undefined): { edge: number; core: number; rim: number } {
  if (!pal) return { edge: 0x4a3c30, core: 0x362b22, rim: 0x7a6b55 };
  const k = (a: number, b: number, t: number): number => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
  return { edge: k(pal.dirtDark, 0x000000, 0.12), core: k(pal.dirtDark, 0x000000, 0.28), rim: pal.dirt };
}

export function scarGeometry(style: WallVisual, kind: 'wall' | 'guardrail', pal?: ThemePalette): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const rng = makeRng(style.length * 131 + (kind === 'wall' ? 7 : 19));
  const L = WALL_BASE_LEN;
  const thick = CONFIG.destruction[kind].thickness;
  const rz = thick * 0.5 + 0.8;
  const sc = soil(pal);
  b.add(jaggedDisc(L * 0.62, rz, 0.07, 11, 0.28, rng), { color: sc.edge });
  b.add(jaggedDisc(L * 0.4, rz * 0.62, 0.078, 9, 0.3, rng), { color: sc.core });
  b.add(jaggedDisc(L * 0.7, rz * 1.18, 0.066, 11, 0.25, rng), { color: sc.rim });   // scuffed lighter rim of torn-up soil
  if (style === 'concrete') {
    if (kind === 'wall') {
      b.box(1.15, 0.34, thick * 0.9, { pos: [-1.45, 0.17, 0.05], rot: [0, 0.06, 0.07], color: 0xaab0bc, vgrad: [0, 0.34, 0.8, 1.05], noBottom: true });
      b.box(0.8, 0.24, thick * 0.8, { pos: [1.5, 0.12, -0.08], rot: [0, -0.08, -0.09], color: 0xd9dde5, noBottom: true });
      b.box(0.5, 0.14, thick * 0.5, { pos: [-1.2, 0.41, 0.05], rot: [0, 0.06, 0.07], color: RED, noBottom: true });
      rubble(b, rng, 6, 2.1, thick * 0.5 + 0.7, [0.22, 0.46], [RED, 0xd9dde5, 0xaab0bc, WHITE]);
    } else {
      for (const x of [-1.6, 0, 1.6]) b.box(0.2, 0.3 + rng() * 0.15, 0.2, { pos: [x + (rng() - 0.5) * 0.2, 0.17, (rng() - 0.5) * 0.3], rot: [rng() * 0.7 - 0.35, rng(), rng() * 0.7 - 0.35], color: 0x6f7787, noBottom: true });
      b.box(1.7, 0.12, 0.28, { pos: [0.5, 0.1, 0.55], rot: [0.05, 0.35, 0.12], color: 0xe4eaf4, noBottom: true });
      b.box(1.0, 0.1, 0.26, { pos: [-1.0, 0.09, -0.6], rot: [0, -0.5, 0.1], color: 0x9ba6b8, noBottom: true });
      rubble(b, rng, 4, 2.0, 0.9, [0.14, 0.28], [0xe4eaf4, 0xff8a1a, 0x9ba6b8]);
    }
  } else if (style === 'jersey') {
    const t = kind === 'wall' ? 1 : 0.75;
    b.box(1.5, 0.4 * t, thick * 0.8, { pos: [-1.2, 0.2 * t, 0.05], rot: [0, 0.07, 0.08], color: 0x56657a, vgrad: [0, 0.4, 0.8, 1.05], noBottom: true });
    b.box(1.1, 0.3 * t, thick * 0.7, { pos: [1.3, 0.15 * t, -0.08], rot: [0, -0.1, -0.1], color: 0x3d495a, noBottom: true });
    b.box(1.2, 0.1, thick * 0.45, { pos: [-1.2, 0.44 * t, 0.05], rot: [0, 0.07, 0.08], color: 0xf6faff, noBottom: true });
    rubble(b, rng, 4, 2.0, 0.8, [0.14, 0.28], [0x56657a, 0xf6faff, 0x3d495a]);
  } else if (style === 'tires') {
    const n = kind === 'wall' ? 3 : 2;
    for (let k = 0; k < n; k++) {
      const r = kind === 'wall' ? 0.62 : 0.4;
      tire(b, (k - (n - 1) / 2) * 1.5 + (rng() - 0.5) * 0.8, r * 0.38, (rng() - 0.5) * 1.1, r, r * 0.76, k % 2 ? WHITE : RED);
    }
    rubble(b, rng, 3, 2.0, 0.8, [0.12, 0.2], [0x2a2d35, RED]);
  } else {
    const wood = 0xb97e45, woodDark = 0x8d5a2c;
    for (const x of [-1.9, 0.1, 1.9]) b.box(0.18, 0.32 + rng() * 0.3, 0.18, { pos: [x, 0.2, (rng() - 0.5) * 0.3], rot: [rng() * 0.5 - 0.25, rng(), rng() * 0.5 - 0.25], color: woodDark, noBottom: true });
    for (let k = 0; k < 3; k++) b.box(1.0 + rng() * 0.8, 0.08, 0.2, { pos: [(rng() - 0.5) * 3.2, 0.08 + k * 0.02, (rng() - 0.5) * 1.4], rot: [0, rng() * 3.14, 0.04], color: k % 2 ? wood : (kind === 'wall' ? RED : 0xd9a064), noBottom: true });
    rubble(b, rng, 3, 1.8, 0.8, [0.1, 0.2], [wood, WHITE]);
  }
  return b.build();
}

/** Scar for a destroyed prop (stump, pebbles, chips): small, sits where the prop was when it broke. */
export function propScarGeometry(type: PropType | 'generic', pal: ThemePalette): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const rng = makeRng(type.length * 977 + 5);
  const P = type === 'generic' ? { w: 0.8 } : CONFIG.destruction.props[type];
  const r = Math.max(0.55, P.w * 0.75);
  const sc = soil(pal);
  b.add(jaggedDisc(r, r * 0.9, 0.07, 9, 0.3, rng), { color: sc.edge });
  b.add(jaggedDisc(r * 0.55, r * 0.5, 0.078, 7, 0.3, rng), { color: sc.core });
  switch (type) {
    case 'tree':
      b.cyl(0.3, 0.4, 0.4, 6, { pos: [0, 0.2, 0], colorFn: (nx, ny) => (ny > 0.5 ? 0xd3a874 : pal.trunk), vgrad: [0, 0.4, 0.8, 1.05] });
      rubble(b, rng, 4, 1.1, 1.1, [0.2, 0.4], [pal.trunk, pal.foliage[0], pal.foliage[1]]);
      break;
    case 'rock':
      rubble(b, rng, 5, 1.3, 1.3, [0.3, 0.55], [pal.rock, pal.rockDark]);
      break;
    case 'sign':
      b.cyl(0.05, 0.06, 0.5, 5, { pos: [0.1, 0.12, 0], rot: [0, 0, 1.3], color: 0x8f98a6 });
      rubble(b, rng, 2, 0.6, 0.6, [0.15, 0.3], [0xffd23c, 0x8f98a6]);
      break;
    case 'crate': rubble(b, rng, 4, 0.8, 0.8, [0.15, 0.3], [0xd6a15a, 0x9b6a34]); break;
    case 'barrel': rubble(b, rng, 3, 0.7, 0.7, [0.14, 0.26], [RED, 0xf3f3f3]); break;
    case 'cone': rubble(b, rng, 2, 0.45, 0.45, [0.1, 0.2], [0xff7a1a, WHITE]); break;
    case 'tireStack': tire(b, 0.3, 0.14, 0.2, 0.52, 0.34, RED); rubble(b, rng, 2, 0.7, 0.7, [0.12, 0.2], [0x2a2d35]); break;
    case 'hayBale': rubble(b, rng, 5, 0.9, 0.7, [0.14, 0.26], [0xeccb55, 0xb98a2b]); break;
    default: rubble(b, rng, 3, 0.6, 0.6, [0.12, 0.25], [0xcccccc, 0x888888]);
  }
  return b.build();
}
