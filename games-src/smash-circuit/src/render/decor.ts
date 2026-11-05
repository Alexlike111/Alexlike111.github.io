// Scenery outside the walls: instanced trees / cacti / pines, bushes, flowers, rocks, dunes, mounds and a few landmarks.
// Placement is deterministic per track (seeded), rejection sampled around the centre line, quality only changes how many show.
import * as THREE from 'three';
import { CONFIG } from '../config';
import type { TrackGeometry } from '../types';
import { WALL_BASE_LEN, bushGeometry, duneGeometry, flowerGeometry, landmarkGeometry, moundGeometry, rockGeometry, snowmanGeometry, treeGeometry } from './structures';
import type { Exclusion } from './trackBuilder';
import type { Materials } from './materials';
import type { ThemePalette } from './palette';
import { GeoBuilder, concat } from './geo';
import { PointGrid, hashString, makeRng } from './util';

type Theme = TrackGeometry['def']['theme'];

interface Kind {
  name: string;
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  count: number;            // at density 1
  scale: [number, number];
  scaleY?: [number, number];
  radius: number;           // spacing radius (m) at scale 1
  reach: [number, number];  // metres beyond the wall's outer edge
  power: number;            // >1 packs items towards the track
  cast: boolean;
  tint: (r: () => number, c: THREE.Color) => void;
  lift?: number;
  shared?: boolean;         // geometry owned elsewhere
  /** placed in small clusters of 2-3 colours (flowers): members share a centre, instead of single random specks */
  cluster?: { size: [number, number]; spread: number; palette: number[]; colours: number };
  /** drawn only when the decor density share is at least this (flowers: high preset only) */
  minShare?: number;
}

export interface DecorVisual {
  group: THREE.Group;
  setDensity(share: number): void;
  /** Software culling: only instances in cells near the camera are uploaded / drawn. */
  update(camX: number, camZ: number, radius: number): void;
  dispose(): void;
}

const CELL = 36;

/** Max instances of one kind drawn at once (density 1): nearest cells first. Keeps the triangle count flat however thick the scenery is. */
const VISIBLE_CAP: Record<string, number> = {
  tree: 36, tree2: 16, bush: 46, rock: 26, flower: 90, cactus: 30, cactus2: 16, dune: 12, pine: 36, pine2: 16, mound: 28,
};
const DEFAULT_CAP = 40;

interface Pack {
  mesh: THREE.InstancedMesh;
  mats: Float32Array;
  cols: Float32Array | null;
  ranges: { cx: number; cz: number; start: number; count: number }[];
  always: boolean;
  minShare: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _ay = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();

const brightness = (lo: number, hi: number) => (r: () => number, c: THREE.Color): void => { const k = lo + (hi - lo) * r(); c.setRGB(k, k, k); };
const hueJitter = (r: () => number, c: THREE.Color): void => { const k = 0.82 + r() * 0.36; c.setRGB(k * (0.9 + r() * 0.2), k, k * (0.9 + r() * 0.2)); };

/**
 * Baked contact shadow: a flat 8-sided disc in a darkened ground tone under the footprint of a decor piece. Real shadows only exist on
 * medium / high; this grounds trees, bushes and rocks on every preset (including low) for 8 triangles.
 */
function withContactShadow(g: THREE.BufferGeometry, color: number, grow = 1.1): THREE.BufferGeometry {
  g.computeBoundingBox();
  const size = g.boundingBox!.getSize(new THREE.Vector3());
  const r = 0.5 * Math.max(size.x, size.z) * grow;
  const disc = new GeoBuilder().add(new THREE.CircleGeometry(r, 8).rotateX(-Math.PI / 2), { pos: [0, 0.025, 0], color }).build();
  const out = concat([{ geo: g }, { geo: disc }]);
  g.dispose(); disc.dispose();
  return out;
}

export function buildDecor(track: TrackGeometry, pal: ThemePalette, mats: Materials, exclusions: Exclusion[], density: number): DecorVisual {
  const def = track.def;
  const theme: Theme = def.theme;
  const L = track.length;
  const half = def.width / 2 + CONFIG.destruction.wallOffset + 1.45;   // outer edge of the wall
  const group = new THREE.Group();
  const rng = makeRng(hashString(def.id) ^ 0x5eed);
  const disposables: { dispose(): void }[] = [];

  const kinds: Kind[] = [];
  const geo = <T extends THREE.BufferGeometry>(g: T): T => { disposables.push(g); return g; };
  const aoColor = new THREE.Color(pal.groundDark).multiplyScalar(theme === 'snow' ? 0.9 : 0.84).getHex();
  const grounded = (g: THREE.BufferGeometry, grow?: number): THREE.BufferGeometry => geo(withContactShadow(g, aoColor, grow));

  if (theme === 'meadow') {
    kinds.push({ name: 'tree', geo: grounded(treeGeometry('meadow', pal, 0)), mat: mats.toon, count: L * 0.3, scale: [0.85, 1.55], radius: 1.7, reach: [3, 80], power: 1.5, cast: true, tint: hueJitter });
    kinds.push({ name: 'tree2', geo: grounded(treeGeometry('meadow', pal, 2)), mat: mats.toon, count: L * 0.12, scale: [0.7, 1.2], radius: 1.4, reach: [4, 60], power: 1.4, cast: true, tint: hueJitter });
    kinds.push({ name: 'bush', geo: grounded(bushGeometry(pal, theme)), mat: mats.toon, count: L * 0.22, scale: [0.8, 1.5], radius: 1.0, reach: [2.2, 40], power: 1.8, cast: false, tint: hueJitter });
    kinds.push({ name: 'rock', geo: grounded(rockGeometry(pal, 5)), mat: mats.toon, count: L * 0.05, scale: [0.5, 1.2], radius: 0.9, reach: [2.5, 40], power: 1.5, cast: false, tint: brightness(0.9, 1.1) });
    kinds.push({ name: 'flower', geo: geo(flowerGeometry()), mat: mats.paint, count: L * 0.3, scale: [1.3, 2.0], radius: 0.2, reach: [1.8, 38], power: 1.6, cast: false, minShare: 0.95, tint: () => undefined,
      cluster: { size: [4, 8], spread: 1.25, palette: [0xffffff, 0xffe14a, 0xff6fa8, 0xff7a3c, 0xb98cff], colours: 2 } });
  } else if (theme === 'desert') {
    kinds.push({ name: 'cactus', geo: grounded(treeGeometry('desert', pal, 0)), mat: mats.toon, count: L * 0.17, scale: [0.8, 1.5], radius: 1.4, reach: [3, 70], power: 1.4, cast: true, tint: hueJitter });
    kinds.push({ name: 'cactus2', geo: grounded(treeGeometry('desert', pal, 1)), mat: mats.toon, count: L * 0.09, scale: [0.6, 1.1], radius: 1.1, reach: [3, 60], power: 1.4, cast: true, tint: hueJitter });
    kinds.push({ name: 'rock', geo: grounded(rockGeometry(pal, 9)), mat: mats.toon, count: L * 0.26, scale: [0.6, 2.4], radius: 1.4, reach: [2.5, 80], power: 1.5, cast: true, tint: brightness(0.88, 1.12) });
    kinds.push({ name: 'bush', geo: grounded(bushGeometry(pal, theme)), mat: mats.toon, count: L * 0.34, scale: [0.6, 1.3], radius: 0.9, reach: [2.2, 50], power: 1.8, cast: false, tint: brightness(0.85, 1.1) });
    kinds.push({ name: 'dune', geo: geo(duneGeometry(0xffffff)), mat: mats.toon, count: L * 0.045, scale: [3.5, 8], scaleY: [1.3, 2.6], radius: 1.0, reach: [10, 110], power: 1.0, cast: false, tint: (r, c) => { c.set([pal.ground, pal.groundDark, 0xf8d78c][Math.floor(r() * 3)]); }, lift: -0.02 });
  } else if (theme === 'night') {
    kinds.push({ name: 'lamp', geo: grounded(treeGeometry('night', pal, 0)), mat: mats.toon, count: L * 0.08, scale: [0.9, 1.1], radius: 1.4, reach: [3, 30], power: 1.6, cast: true, tint: brightness(1, 1) });
    kinds.push({ name: 'lamp2', geo: grounded(treeGeometry('night', pal, 1)), mat: mats.toon, count: L * 0.06, scale: [0.9, 1.1], radius: 1.4, reach: [3, 30], power: 1.6, cast: true, tint: brightness(1, 1) });
    kinds.push({ name: 'block', geo: grounded(rockGeometry(pal, 4)), mat: mats.toon, count: L * 0.08, scale: [0.6, 1.6], radius: 1.2, reach: [2.5, 60], power: 1.5, cast: false, tint: brightness(0.9, 1.1) });
    kinds.push({ name: 'shrub', geo: grounded(bushGeometry(pal, theme)), mat: mats.toon, count: L * 0.08, scale: [0.6, 1.1], radius: 0.9, reach: [2.2, 40], power: 1.8, cast: false, tint: brightness(0.9, 1.05) });
    kinds.push({ name: 'neonDot', geo: geo(flowerGeometry()), mat: mats.paint, count: L * 0.12, scale: [1.6, 2.4], radius: 0.2, reach: [1.8, 30], power: 1.6, cast: false, minShare: 0.95, tint: () => undefined,
      cluster: { size: [3, 6], spread: 1.4, palette: [0xff4fb8, 0x5ff6ff, 0xffe14a, 0x9b6bff], colours: 2 } });
  } else {
    kinds.push({ name: 'pine', geo: grounded(treeGeometry('snow', pal, 0)), mat: mats.toon, count: L * 0.36, scale: [0.8, 1.6], radius: 1.6, reach: [3, 70], power: 1.5, cast: true, tint: hueJitter });
    kinds.push({ name: 'pine2', geo: grounded(treeGeometry('snow', pal, 1)), mat: mats.toon, count: L * 0.12, scale: [0.6, 1.1], radius: 1.2, reach: [4, 60], power: 1.4, cast: true, tint: hueJitter });
    kinds.push({ name: 'rock', geo: grounded(rockGeometry(pal, 2)), mat: mats.toon, count: L * 0.08, scale: [0.6, 1.8], radius: 1.2, reach: [2.5, 60], power: 1.5, cast: false, tint: brightness(0.9, 1.1) });
    kinds.push({ name: 'mound', geo: geo(moundGeometry()), mat: mats.toon, count: L * 0.2, scale: [1.2, 4.2], scaleY: [0.7, 1.3], radius: 1.0, reach: [2, 70], power: 1.4, cast: false, tint: (r, c) => { c.set(r() > 0.5 ? 0xffffff : 0xe3f0fb); } });
    kinds.push({ name: 'snowman', geo: geo(snowmanGeometry()), mat: mats.toon, count: 3, scale: [0.95, 1.25], radius: 1.2, reach: [4, 30], power: 1.2, cast: true, tint: brightness(1, 1) });
    kinds.push({ name: 'bush', geo: grounded(bushGeometry(pal, theme)), mat: mats.toon, count: L * 0.1, scale: [0.7, 1.2], radius: 0.9, reach: [2.2, 36], power: 1.8, cast: false, tint: brightness(0.9, 1.05) });
  }
  // landmarks (two variants, 1-2 each)
  for (let v = 0; v < 2; v++) {
    kinds.push({ name: 'landmark' + v, geo: geo(landmarkGeometry(theme, pal, v)), mat: mats.toon, count: v === 0 ? 2 : 1, scale: [1, 1.2], radius: 7, reach: [8, 55], power: 1, cast: true, tint: brightness(1, 1) });
  }

  // ---- spatial hashes
  const xs = track.samples.map((s) => s.x), ys = track.samples.map((s) => s.y);
  const grid = new PointGrid(xs, ys, 20);
  const propGrid = new PointGrid(def.props.map((p) => p.x), def.props.map((p) => p.y), 6);
  const occ: { x: number; y: number; r: number }[] = [];
  const occCells = new Map<number, number[]>();
  const cellOf = (x: number, y: number): number => (Math.floor(x / 6) + 2048) * 4096 + (Math.floor(y / 6) + 2048);
  const free = (x: number, y: number, r: number): boolean => {
    const cx = Math.floor(x / 6), cy = Math.floor(y / 6);
    const reach = Math.ceil((r + 9) / 6);
    for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) {
      const c = occCells.get((cx + dx + 2048) * 4096 + (cy + dy + 2048));
      if (!c) continue;
      for (const i of c) { const o = occ[i]; if (Math.hypot(o.x - x, o.y - y) < o.r + r) return false; }
    }
    return true;
  };

  const n = track.samples.length;
  const packs: Pack[] = [];
  for (const k of kinds) {
    const cellOf2: number[] = [];
    const mesh = new THREE.InstancedMesh(k.geo, k.mat, Math.max(1, Math.ceil(k.count)));
    mesh.name = 'decor:' + k.name;
    mesh.castShadow = k.cast;
    mesh.receiveShadow = k.name === 'dune' || k.name === 'mound';
    mesh.frustumCulled = false;
    let placed = 0;
    let clBase: { x: number; y: number } | null = null, clLeft = 0, clFail = 0, clCols: number[] = [];
    const target = Math.ceil(k.count);
    for (let tries = 0; tries < target * 14 && placed < target; tries++) {
      const smp = track.samples[Math.floor(rng() * n)];
      const side = rng() < 0.5 ? 1 : -1;
      const sc = k.scale[0] + (k.scale[1] - k.scale[0]) * rng();
      const rad = k.radius * (k.name.startsWith('dune') ? 0.3 * sc : sc);
      const d = half + 1.0 + rad + k.reach[0] + Math.pow(rng(), k.power) * (k.reach[1] - k.reach[0]);
      if (clLeft > 0 && clFail > 8) { clLeft = 0; clFail = 0; }   // a cluster that cannot grow any more is closed
      const joining: boolean = !!(k.cluster && clBase && clLeft > 0);
      const x: number = joining ? clBase!.x + (rng() - 0.5) * 2 * k.cluster!.spread : smp.x + smp.nx * side * d + smp.tx * (rng() - 0.5) * 6;
      const y: number = joining ? clBase!.y + (rng() - 0.5) * 2 * k.cluster!.spread : smp.y + smp.ny * side * d + smp.ty * (rng() - 0.5) * 6;
      // must not touch the road / walls (grid cell 20 > any needed clearance)
      let blocked = grid.nearest(x, y) < half + 0.8 + rad || propGrid.nearest(x, y) < 2.2 + rad * 0.6;
      if (!blocked) for (const e of exclusions) if (Math.hypot(e.x - x, e.y - y) < e.r + rad) { blocked = true; break; }
      if (blocked || !free(x, y, rad)) { if (joining) clFail++; continue; }
      clFail = 0;
      const idx = occ.length;
      occ.push({ x, y, r: rad * (k.name === 'flower' ? 0.6 : 1) });
      const ck = cellOf(x, y);
      const cl = occCells.get(ck);
      if (cl) cl.push(idx); else occCells.set(ck, [idx]);
      const sy = k.scaleY ? k.scaleY[0] + (k.scaleY[1] - k.scaleY[0]) * rng() : sc;
      _q.setFromAxisAngle(_ay, rng() * Math.PI * 2);
      _m.compose(_p.set(x, k.lift ?? 0, y), _q, _s.set(sc, sy, sc));
      mesh.setMatrixAt(placed, _m);
      if (k.cluster) {
        if (!joining) {
          clBase = { x, y };
          clLeft = k.cluster.size[0] + Math.floor(rng() * (k.cluster.size[1] - k.cluster.size[0] + 1));
          const pool = k.cluster.palette.slice();
          clCols = [];
          for (let q = 0; q < k.cluster.colours; q++) clCols.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
        } else clLeft--;
        _c.set(clCols[Math.floor(rng() * clCols.length)]);
      } else k.tint(rng, _c);
      mesh.setColorAt(placed, _c);
      cellOf2.push(Math.floor(x / CELL), Math.floor(y / CELL));
      placed++;
    }
    mesh.userData.total = placed;
    const always = k.name.startsWith('landmark') || k.name === 'snowman';
    // sort instances by cell so each cell is one contiguous range
    const order = Array.from({ length: placed }, (_, i) => i).sort((a, b) => (cellOf2[a * 2 + 1] - cellOf2[b * 2 + 1]) || (cellOf2[a * 2] - cellOf2[b * 2]) || (a - b));
    const srcM = mesh.instanceMatrix.array as Float32Array;
    const srcC = mesh.instanceColor ? (mesh.instanceColor.array as Float32Array) : null;
    const mats = new Float32Array(placed * 16);
    const cols = srcC ? new Float32Array(placed * 3) : null;
    const ranges: Pack['ranges'] = [];
    order.forEach((src, dst) => {
      mats.set(srcM.subarray(src * 16, src * 16 + 16), dst * 16);
      if (cols && srcC) cols.set(srcC.subarray(src * 3, src * 3 + 3), dst * 3);
      const cx = cellOf2[src * 2], cz = cellOf2[src * 2 + 1];
      const last = ranges[ranges.length - 1];
      if (last && last.cx === cx && last.cz === cz) last.count++; else ranges.push({ cx, cz, start: dst, count: 1 });
    });
    packs.push({ mesh, mats, cols, ranges, always, minShare: k.minShare ?? 0 });
    mesh.count = 0;
    mesh.visible = placed > 0;
    group.add(mesh);
    disposables.push(mesh);
  }
  void WALL_BASE_LEN;

  let share = density, lastHash = -1;
  const kindCaps = kinds.map((k) => VISIBLE_CAP[k.name] ?? DEFAULT_CAP);
  const update = (camX: number, camZ: number, radius: number): void => {
    const R = radius + CELL * 0.75;
    let hash = Math.round(share * 1000);
    const vis: { r: Pack['ranges'][number]; d: number }[][] = [];
    for (const p of packs) {
      const list: { r: Pack['ranges'][number]; d: number }[] = [];
      for (const r of p.ranges) {
        const d = Math.hypot((r.cx + 0.5) * CELL - camX, (r.cz + 0.5) * CELL - camZ);
        if (d > R) continue;
        list.push({ r, d });
        hash = (hash * 31 + r.cx * 7919 + r.cz * 104729 + r.start) | 0;
      }
      vis.push(list);
    }
    if (hash === lastHash) return;
    lastHash = hash;
    packs.forEach((p, i) => {
      const dstM = p.mesh.instanceMatrix.array as Float32Array;
      const dstC = p.mesh.instanceColor ? (p.mesh.instanceColor.array as Float32Array) : null;
      let o = 0;
      let left = p.always ? Infinity : share < p.minShare ? 0 : Math.max(1, Math.ceil(kindCaps[i] * share));
      const list = vis[i];
      if (!p.always) list.sort((a, b) => a.d - b.d);   // nearest cells claim the cap first
      for (const { r } of list) {
        if (left <= 0) break;
        const c = p.always ? r.count : Math.min(Math.floor(r.count * share), left);
        if (c <= 0) continue;
        dstM.set(p.mats.subarray(r.start * 16, (r.start + c) * 16), o * 16);
        if (dstC && p.cols) dstC.set(p.cols.subarray(r.start * 3, (r.start + c) * 3), o * 3);
        o += c;
        left -= c;
      }
      p.mesh.count = o;
      p.mesh.visible = o > 0;
      p.mesh.instanceMatrix.needsUpdate = true;
      if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
    });
  };
  const setDensity = (v: number): void => { share = v; lastHash = -1; };
  update(track.samples[0].x, track.samples[0].y, 60);

  return { group, setDensity, update, dispose() { for (const d of disposables) d.dispose(); } };
}
