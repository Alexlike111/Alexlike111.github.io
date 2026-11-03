// Renders every DestructibleState with one InstancedMesh per kind (walls, guardrails, curbs, each prop type, road holes / cracks).
// Reads the sim state each frame: broken -> instance hidden, crack -> lean / dirt tint, dynamic props -> follow the body.
import * as THREE from 'three';
import { CONFIG } from '../config';
import type { DestructibleState, TrackDef } from '../types';
import { GeoBuilder } from './geo';
import type { Materials } from './materials';
import type { ThemePalette } from './palette';
import { WALL_BASE_LEN, curbGeometry, propGeometry, propScarGeometry, scarGeometry, wallGeometry, wallVisual } from './structures';
import { makeRng } from './util';

const D = CONFIG.destruction;
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _ay = new THREE.Vector3(0, 1, 0);
const _ax = new THREE.Vector3(1, 0, 0);
const _ax2 = new THREE.Vector3();
const _q3 = new THREE.Quaternion();
const _q4 = new THREE.Quaternion();
const DIRT = new THREE.Color(0.52, 0.45, 0.4);

interface Group {
  mesh: THREE.InstancedMesh;
  ids: number[];
}

interface Dyn { id: number; g: Group; inst: number; x0: number; y0: number; px: number; py: number; travel: number; dirX: number; dirY: number; kind: string; r: number }

/** spatial chunk size (m): every kind is split into chunks so three.js frustum culling can skip far instances (the view is ~56 x 32 m) */
const CHUNK = 44;

/**
 * Instances that only exist once needed: slots are handed out in order and mesh.count grows with them, so a track with 500 road
 * chunks does not pay for 500 hidden hole / crack / rubble meshes (hidden zero-scale instances still cost vertex work).
 */
class Lazy {
  readonly mesh: THREE.InstancedMesh;
  private slot: Int32Array;
  used = 0;
  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, capacity: number, states: number, name: string, receive: boolean) {
    this.mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, capacity));
    this.mesh.name = name;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;      // few instances; the bounding sphere stays a huge dummy (never culled)
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = receive;
    this.slot = new Int32Array(states).fill(-1);
  }
  set(id: number, m: THREE.Matrix4): void {
    let k = this.slot[id];
    if (k < 0) {
      if (this.used >= this.mesh.instanceMatrix.count) return;
      k = this.slot[id] = this.used++;
      this.mesh.count = this.used;
      this.mesh.visible = true;
    }
    this.mesh.setMatrixAt(k, m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  hide(id: number): void {
    const k = this.slot[id];
    if (k < 0) return;
    this.mesh.setMatrixAt(k, ZERO);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const mixHex = (a: number, b: number, t: number): number => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();

/**
 * Torn-road decals, tinted per theme: the hole is a crater of exposed earth (light broken lip fading to a darker core, a soft
 * shadow crescent on the sun side, light asphalt slabs on the rim), never a black void. The crack for damaged-but-intact chunks
 * is one thin jagged fissure plus a short branch (dark = ~60% of the road tone, narrow light rim).
 */
export function roadHoleGeometry(pal: ThemePalette): { hole: THREE.BufferGeometry; crack: THREE.BufferGeometry } {
  const rng = makeRng(808);
  const poly = (r: number, y: number, jitter: number, seg: number, ox = 0, oz = 0): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    const pos: number[] = [];
    const rs: number[] = [];
    for (let i = 0; i < seg; i++) rs.push(r * (1 - jitter + rng() * jitter * 1.6));
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const r0 = rs[i], r1 = rs[(i + 1) % seg];
      pos.push(ox, y, oz, ox + Math.cos(a0) * r0, y, oz - Math.sin(a0) * r0, ox + Math.cos(a1) * r1, y, oz - Math.sin(a1) * r1);   // CCW seen from above: normal +y
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return g;
  };
  const lip = pal.dirt, core = pal.dirtDark;
  const deep = mixHex(core, 0x000000, 0.22), floor = mixHex(core, lip, 0.28);
  const hb = new GeoBuilder();
  hb.add(poly(1.24, 0, 0.2, 11), { color: lip });
  hb.add(poly(1.05, 0.012, 0.18, 11), { color: mixHex(lip, core, 0.5) });
  hb.add(poly(0.86, 0.02, 0.2, 10), { color: core });
  hb.add(poly(0.78, 0.026, 0.2, 9, -0.12, -0.09), { color: deep });          // shadow crescent on the sun side (sun comes from -x, -z)
  hb.add(poly(0.6, 0.03, 0.2, 8, 0.07, 0.05), { color: floor });             // lit crater floor
  const road = new THREE.Color(pal.road);
  const slabs = [road.clone().lerp(new THREE.Color(0xffffff), 0.32).getHex(), road.clone().lerp(new THREE.Color(0xffffff), 0.5).getHex(), lip, road.clone().lerp(new THREE.Color(0xffffff), 0.18).getHex()];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rng() * 0.5, r = 0.92 + rng() * 0.28;
    const sz = 0.12 + rng() * 0.11;
    hb.box(sz * (1.0 + rng()), sz * (0.5 + rng() * 0.5), sz * (0.8 + rng() * 0.8), {
      pos: [Math.cos(a) * r, 0.035 + sz * 0.2, -Math.sin(a) * r], rot: [rng() * 0.5, rng() * 3.1, rng() * 0.5],
      color: slabs[i % slabs.length], vgrad: [0, sz * 0.8, 0.82, 1.15], noBottom: true,
    });
  }
  // cracks: one jagged fissure and a short branch; dark ~60% of the road tone with a narrow light rim
  const cb = new GeoBuilder();
  const dark = road.clone().multiplyScalar(0.6).getHex();
  const rim = road.clone().lerp(new THREE.Color(0xe6e0d4), 0.4).getHex();
  const fissure = (x0: number, z0: number, ang: number, len: number, segs: number, w: number): { x: number; z: number }[] => {
    let x = x0, z = z0;
    const pts = [{ x, z }];
    for (let i = 0; i < segs; i++) {
      const a = ang + (rng() - 0.5) * 0.95;
      const l = (len / segs) * (0.85 + rng() * 0.3);
      const cx = x + Math.cos(a) * l * 0.5, cz = z + Math.sin(a) * l * 0.5;
      cb.box(l * 1.15, 0.01, w * 2.1, { pos: [cx, 0.012, cz], rot: [0, -a, 0], color: rim, noBottom: true });
      cb.box(l * 1.15, 0.012, w, { pos: [cx, 0.022, cz], rot: [0, -a, 0], color: dark, noBottom: true });
      x += Math.cos(a) * l; z += Math.sin(a) * l;
      pts.push({ x, z });
    }
    return pts;
  };
  const main = fissure(-0.9, (rng() - 0.5) * 0.2, (rng() - 0.5) * 0.3, 1.8, 6, 0.18);
  const at = main[3];
  fissure(at.x, at.z, 0.85 * (rng() > 0.5 ? 1 : -1), 0.8, 3, 0.12);
  for (let i = 0; i < 4; i++) {
    const sz = 0.09 + rng() * 0.07;
    cb.box(sz, sz * 0.5, sz * 0.8, { pos: [(rng() - 0.5) * 1.5, 0.02 + sz * 0.2, (rng() - 0.5) * 0.8], rot: [0, rng() * 3, 0], color: slabs[i % slabs.length], noBottom: true });
  }
  return { hole: hb.build(), crack: cb.build() };
}

export class DestructibleRenderer {
  readonly group = new THREE.Group();
  private groups: Group[] = [];
  private inst: Int32Array;
  private owner: (Group | null)[];
  private holes!: Lazy;
  private cracks!: Lazy;
  /** leftovers of broken pieces (ground scar, stumps, chips): separate group so the live pieces stay clean */
  readonly rubble = new THREE.Group();
  private scarWall!: Lazy;
  private scarGuard!: Lazy;
  private scarProp = new Map<string, Lazy>();
  private lastCrack: Int16Array;
  private dirty = new Set<Group>();
  private dyn: Dyn[] = [];
  private wallMeshes: THREE.InstancedMesh[] = [];
  private disposables: { dispose(): void }[] = [];
  /** statistics for tests / debug */
  brokenShown = 0;

  constructor(states: DestructibleState[], def: TrackDef, pal: ThemePalette, mats: Materials) {
    const n = states.length;
    this.inst = new Int32Array(n).fill(-1);
    this.owner = new Array(n).fill(null);
    this.lastCrack = new Int16Array(n).fill(-1);

    /** one InstancedMesh per spatial chunk, sharing a geometry; assign(id, group) records ownership */
    const makeChunked = (name: string, geo: THREE.BufferGeometry, mat: THREE.Material, ids: number[], cast: boolean, receive: boolean, chunk: boolean, assign: (id: number, g: Group) => void): Group[] => {
      this.disposables.push(geo);
      if (!ids.length) return [];
      const cells = new Map<string, number[]>();
      for (const id of ids) {
        const s = states[id];
        // dynamic props (they roll away from their start) share one never-culled group; everything else culls by chunk
        const key = s.dynamic ? 'dyn' : chunk ? `${Math.floor(s.x / CHUNK)},${Math.floor(s.y / CHUNK)}` : 'all';
        let l = cells.get(key);
        if (!l) cells.set(key, (l = []));
        l.push(id);
      }
      const out: Group[] = [];
      for (const list of cells.values()) {
        const mesh = new THREE.InstancedMesh(geo, mat, list.length);
        mesh.name = name;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.castShadow = cast;
        mesh.receiveShadow = receive;
        mesh.setColorAt(0, _c.set(0xffffff));
        mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
        const g: Group = { mesh, ids: list };
        list.forEach((id, k) => { mesh.setColorAt(k, _c.set(0xffffff)); assign(id, g); this.inst[id] = k; });
        this.group.add(mesh);
        this.groups.push(g);
        this.disposables.push(mesh);
        out.push(g);
      }
      return out;
    };

    const byKind = (k: DestructibleState['kind']): number[] => states.filter((s) => s.kind === k).map((s) => s.id);
    for (const kind of ['wall', 'guardrail'] as const) {
      const gs = makeChunked('destr:' + kind, wallGeometry(wallVisual(def), kind, pal), mats.toon, byKind(kind), true, true, true, (id, g) => { this.owner[id] = g; });
      for (const g of gs) this.wallMeshes.push(g.mesh);
    }
    makeChunked('destr:curb', curbGeometry(), mats.toon, byKind('curb'), false, true, true, (id, g) => { this.owner[id] = g; });
    const types = new Set<string>();
    for (const s of states) if (s.kind === 'prop' && s.propType) types.add(s.propType);
    for (const t of types) {
      const ids = states.filter((s) => s.kind === 'prop' && s.propType === t).map((s) => s.id);
      const big = t === 'tree' || t === 'rock' || t === 'hayBale' || t === 'crate' || t === 'tireStack' || t === 'barrel';
      makeChunked('destr:' + t, propGeometry(t as never, def.theme, pal), mats.toon, ids, big, true, true, (id, g) => { this.owner[id] = g; });
    }
    const roadIds = byKind('road');
    const rg = roadHoleGeometry(pal);
    this.disposables.push(rg.hole, rg.crack);
    this.holes = new Lazy(rg.hole, mats.toon, roadIds.length, n, 'destr:hole', false);
    this.cracks = new Lazy(rg.crack, mats.toon, roadIds.length, n, 'destr:crack', false);
    this.holes.mesh.renderOrder = 1;
    this.cracks.mesh.renderOrder = 1;
    this.group.add(this.holes.mesh, this.cracks.mesh);
    this.disposables.push(this.holes.mesh, this.cracks.mesh);

    // rubble: one lazy mesh per scar kind (wall, guardrail, every prop type present)
    const mkRubble = (geo: THREE.BufferGeometry, capacity: number, name: string): Lazy => {
      this.disposables.push(geo);
      const l = new Lazy(geo, mats.toon, capacity, n, name, true);
      this.rubble.add(l.mesh);
      this.disposables.push(l.mesh);
      return l;
    };
    this.scarWall = mkRubble(scarGeometry(wallVisual(def), 'wall', pal), byKind('wall').length, 'rubble:wall');
    this.scarGuard = mkRubble(scarGeometry(wallVisual(def), 'guardrail', pal), byKind('guardrail').length, 'rubble:guardrail');
    for (const t of types) this.scarProp.set(t, mkRubble(propScarGeometry(t as never, pal), states.filter((s) => s.kind === 'prop' && s.propType === t).length, 'rubble:' + t));

    // initial placement
    for (const s of states) {
      if (s.kind === 'road') continue;
      const g = this.owner[s.id];
      if (!g) continue;
      this.writeStatic(s, g);
      if (s.kind === 'prop' && s.dynamic && s.propType) {
        this.dyn.push({ id: s.id, g, inst: this.inst[s.id], x0: s.x, y0: s.y, px: s.x, py: s.y, travel: 0, dirX: 1, dirY: 0, kind: s.propType, r: Math.max(0.3, s.w / 2) });
      }
    }
    // chunks cull themselves: bounding spheres from the initial layout (breaking only ever removes pieces)
    for (const g of this.groups) {
      g.mesh.instanceMatrix.needsUpdate = true;
      if (g.mesh.instanceColor) g.mesh.instanceColor.needsUpdate = true;
      g.mesh.computeBoundingSphere();
      if (g.mesh.boundingSphere) g.mesh.boundingSphere.radius += 6;   // leaning / toppling props, dynamic movement
      g.mesh.frustumCulled = g.ids.every((id) => !states[id].dynamic);
    }
  }

  /** walls are the biggest shadow casters: only on the high preset */
  setWallShadows(on: boolean): void { for (const m of this.wallMeshes) m.castShadow = on; }

  private hash(id: number): number { const x = Math.sin(id * 12.9898) * 43758.5453; return x - Math.floor(x); }

  /** world matrix of a (possibly damaged) static piece */
  private writeStatic(s: DestructibleState, g: Group): void {
    const k = this.inst[s.id];
    if (s.broken) { g.mesh.setMatrixAt(k, ZERO); this.dirty.add(g); this.addScar(s); return; }
    const crack = s.crack;
    const h = this.hash(s.id);
    _q.setFromAxisAngle(_ay, -s.angle);
    let sink = 0, sy = 1;
    if (crack > 0.05) {
      const lean = (h > 0.5 ? 1 : -1) * crack * (s.kind === 'prop' ? 0.25 : 0.14);
      sink = crack * 0.07;
      sy = 1 - crack * 0.12;
      _q2.setFromAxisAngle(_ax, lean);
      _q.multiply(_q2);
    }
    if (s.kind === 'wall' || s.kind === 'guardrail') _s.set(s.w / WALL_BASE_LEN, sy, 1);
    else if (s.kind === 'curb') _s.set(s.w, 1, s.h);
    else _s.set(1, sy, 1);
    _m.compose(_p.set(s.x, -sink, s.y), _q, _s);
    g.mesh.setMatrixAt(k, _m);
    _c.set(0xffffff).lerp(DIRT, Math.min(1, crack * 1.1) * 0.8);
    g.mesh.setColorAt(k, _c);
    this.dirty.add(g);
  }

  /** what stays behind: dark ground scar, stumps and chips where a wall / guardrail / prop broke off */
  private addScar(s: DestructibleState): void {
    const L = s.kind === 'wall' ? this.scarWall : s.kind === 'guardrail' ? this.scarGuard : s.kind === 'prop' && s.propType ? this.scarProp.get(s.propType) : undefined;
    if (!L) return;
    const h = this.hash(s.id);
    const linear = s.kind === 'wall' || s.kind === 'guardrail';
    _q.setFromAxisAngle(_ay, -s.angle + (linear ? (h > 0.5 ? Math.PI : 0) : h * 6.283));
    _m.compose(_p.set(s.x, 0, s.y), _q, _s.set(linear ? s.w / WALL_BASE_LEN : 1, 1, 1));
    L.set(s.id, _m);
  }

  private writeRoad(s: DestructibleState): void {
    const h = this.hash(s.id);
    if (s.broken) {
      _q.setFromAxisAngle(_ay, -s.angle + (h - 0.5) * 0.4);
      _m.compose(_p.set(s.x, 0.075, s.y), _q, _s.set(s.w * 0.52, 1, s.h * 0.58));
      this.holes.set(s.id, _m);
      this.cracks.hide(s.id);
    } else if (s.crack > 0.22) {
      _q.setFromAxisAngle(_ay, -s.angle + (h - 0.5) * 1.2);
      const sc = 0.65 + s.crack * 0.55;   // uniform: a 1.1 - 2 m fissure, not a stretched star
      _m.compose(_p.set(s.x, 0.07, s.y), _q, _s.set(sc, 1, sc));
      this.cracks.set(s.id, _m);
      this.holes.hide(s.id);
    } else {
      this.holes.hide(s.id);
      this.cracks.hide(s.id);
    }
  }

  private writeDynamic(d: Dyn, s: DestructibleState): void {
    const dx = s.x - d.px, dy = s.y - d.py;
    const moved = Math.hypot(dx, dy);
    if (moved > 1e-4) { d.travel += moved; d.dirX = dx / moved; d.dirY = dy / moved; }
    d.px = s.x; d.py = s.y;
    // yaw of the prop
    _q.setFromAxisAngle(_ay, -s.angle);
    // horizontal axis perpendicular to the travel direction (three.js: x, z)
    _ax2.set(-d.dirY, 0, d.dirX);
    let lift = 0;
    const f = Math.min(1, d.travel / 0.7);
    switch (d.kind) {
      case 'barrel': case 'tireStack': {
        // topple onto its side (axis aligned with _ax2) and roll
        _q2.setFromUnitVectors(_ay, _ax2);
        _q3.copy(_q).slerp(_q2, f);
        const roll = (d.travel / d.r) * -1;
        _q4.setFromAxisAngle(_ax2, roll * f);
        _q.copy(_q4).multiply(_q3);
        lift = d.r * 0.9 * f;
        break;
      }
      case 'hayBale': {
        _q2.setFromAxisAngle(_ax, (d.travel / 0.5) * (d.dirX >= 0 ? 1 : -1));
        _q.multiply(_q2);
        break;
      }
      default: {   // cone, crate: tip over in the travel direction
        const tip = Math.min(d.kind === 'crate' ? 1.2 : 1.5, d.travel * 1.4);
        _q2.setFromAxisAngle(_ax2.normalize(), -tip);
        _q.premultiply(_q2);
        lift = Math.sin(tip) * 0.12;
      }
    }
    _m.compose(_p.set(s.x, lift, s.y), _q, _s.set(1, 1, 1));
    d.g.mesh.setMatrixAt(d.inst, _m);
    this.dirty.add(d.g);
  }

  /** Per-frame update from the sim state. */
  sync(states: DestructibleState[]): void {
    let broken = 0;
    const n = Math.min(states.length, this.inst.length);
    for (let i = 0; i < n; i++) {
      const s = states[i];
      if (this.inst[i] < 0 && s.kind !== 'road') continue;
      if (s.broken) broken++;
      const q = Math.round(s.crack * 12) + (s.broken ? 100 : 0);
      if (q === this.lastCrack[i]) continue;
      this.lastCrack[i] = q;
      if (s.kind === 'road') this.writeRoad(s);
      else if (this.owner[i]) this.writeStatic(s, this.owner[i]!);
    }
    this.brokenShown = broken;
    for (const d of this.dyn) {
      const s = states[d.id];
      if (!s || s.broken) continue;
      if (Math.abs(s.x - d.px) + Math.abs(s.y - d.py) < 1e-4) continue;
      this.writeDynamic(d, s);
    }
    if (this.dirty.size) {
      for (const g of this.dirty) {
        g.mesh.instanceMatrix.needsUpdate = true;
        if (g.mesh.instanceColor) g.mesh.instanceColor.needsUpdate = true;
      }
      this.dirty.clear();
    }
  }

  dispose(): void { for (const d of this.disposables) d.dispose(); }
}
