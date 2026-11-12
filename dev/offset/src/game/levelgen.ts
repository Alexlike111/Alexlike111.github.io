// Procedural sheets (arenas). Everything is assembled from destructible modules; decor is print-only.
import { Rng } from '../core/rng';
import type { L } from '../core/i18n';
import type { Game } from './game';
import { Level, makeBounds } from './level';
import { rectPoly } from '../phys/fracture';
import type { MatId } from '../core/tune';
import type { EnemyKind } from './enemies';
import type { ObjectiveKind } from '../ui/api';
import { Ink, ink, hex, InkSet } from '../gfx/gl';
import type { Chunk } from '../phys/structure';

export type BiomeId = 'press' | 'archive' | 'tower';
export interface Biome { id: BiomeId; name: L; inks: InkSet; wall: MatId[]; slab: MatId[]; part: MatId[]; rooms: L[]; sky: number }
export const BIOMES: Record<BiomeId, Biome> = {
  press: { id: 'press', name: { ru: 'ТИПОГРАФИЯ', en: 'PRINT WORKS' }, inks: { a: hex('#252A7C'), b: hex('#FF4F3F'), c: hex('#F5B915'), paper: hex('#EDE3CF') }, wall: ['brick', 'concrete', 'brick'], slab: ['concrete', 'wood'], part: ['plaster', 'glass', 'wood'], sky: 0,
    rooms: [{ ru: 'Крыша наборного цеха', en: 'Composing Room Roof' }, { ru: 'Двор бумажного склада', en: 'Paper Yard' }, { ru: 'Сушильные леса', en: 'Drying Racks' }, { ru: 'Красочный цех', en: 'Ink Kitchen' }, { ru: 'Погрузочная рампа', en: 'Loading Dock' }] },
  archive: { id: 'archive', name: { ru: 'АРХИВ', en: 'ARCHIVE' }, inks: { a: hex('#173F3B'), b: hex('#FF4A5E'), c: hex('#E9A23B'), paper: hex('#E7E2CC') }, wall: ['plaster', 'brick', 'concrete'], slab: ['wood', 'wood', 'concrete'], part: ['glass', 'wood', 'plaster'], sky: 1,
    rooms: [{ ru: 'Хранилище гранок', en: 'Galley Vault' }, { ru: 'Читальный зал', en: 'Reading Hall' }, { ru: 'Стеллажи тиражей', en: 'Edition Stacks' }, { ru: 'Переплётная', en: 'Bindery' }, { ru: 'Каталог', en: 'Card Index' }] },
  tower: { id: 'tower', name: { ru: 'БАШНЯ ПРИВОДКИ', en: 'REGISTER TOWER' }, inks: { a: hex('#2B1B45'), b: hex('#FF3D2E'), c: hex('#38B6BD'), paper: hex('#E8E3DA') }, wall: ['concrete', 'concrete', 'glass'], slab: ['concrete', 'concrete'], part: ['glass', 'glass', 'plaster'], sky: 2,
    rooms: [{ ru: 'Контрольный этаж', en: 'Control Floor' }, { ru: 'Зал совмещения', en: 'Alignment Hall' }, { ru: 'Стеклянная галерея', en: 'Glass Gallery' }, { ru: 'Отдел правки', en: 'Corrections Dept.' }, { ru: 'Кабинет Корректора', en: "Proofreader's Office" }] },
};
export interface Decor { x: number; y: number; w: number; h: number; k: Ink; kind: 0 | 1 | 2 } // 0 rect, 1 window(paper), 2 line
export interface Pt { x: number; y: number }
export interface RoomSpec { index: number; total: number; biome: BiomeId; kind: ObjectiveKind; seed: number; tier: number; first: boolean }
export interface RoomPlan {
  level: Level; biome: Biome; name: L; kind: ObjectiveKind; spawns: Pt[]; perches: Pt[]; air: Pt[]; decor: Decor[];
  waves: { kind: EnemyKind; elite: boolean }[][]; marked: Chunk[]; markedArea: number; surviveT: number; demolishGoal: number; bossAt: Pt | null;
}

class Builder {
  spawns: Pt[] = []; perches: Pt[] = []; decor: Decor[] = []; marked: Chunk[] = []; mark = false; crates: [number, number, number][] = []; barrels: [number, number][] = [];
  constructor(public g: Game, public rng: Rng, public B: Biome) { }
  rect(x: number, y: number, w: number, h: number, m: MatId, anchor = false) { const cs = this.g.st.addRect(x, y, w, h, m, { anchor }); if (this.mark) for (const c of cs) { c.mark = true; this.marked.push(c); } return cs; }
  back(x: number, y: number, w: number, h: number, d = 0.17) { this.decor.push({ x, y, w, h, k: ink(d, 0, 0.04), kind: 0 }); }
  win(x: number, y: number, w: number, h: number) { this.decor.push({ x, y, w, h, k: ink(0, 0, 0.42), kind: 1 }); }
  /** multi-storey block. returns width */
  building(x: number, w: number, floors: number, opts: { open?: boolean } = {}): number {
    const r = this.rng, B = this.B; const fh = 3.3, th = 0.45, wt = 0.5; const wallM = r.pick(B.wall), top = -floors * fh;
    this.back(x + 0.2, top, w - 0.4, floors * fh);
    for (let f = 0; f < floors; f++) {
      const y1 = -f * fh, y0 = y1 - fh; const slabM = f === floors - 1 ? 'concrete' : r.pick(B.slab);
      // side walls: doorway on the ground floor, windows above
      for (const side of [0, 1]) {
        const wx = side ? x + w - wt : x; const m = wallM === 'glass' && f === 0 ? 'concrete' : wallM;
        if (f === 0) { this.rect(wx, y0 + th, wt, fh - th - 2.35, m); }
        else if (r.chance(0.55)) { this.rect(wx, y0 + th, wt, 0.75, m); this.rect(wx + 0.12, y0 + th + 0.75, wt - 0.24, 1.3, 'glass'); this.rect(wx, y0 + th + 2.05, wt, fh - th - 2.05, m); }
        else this.rect(wx, y0 + th, wt, fh - th, m);
      }
      // slab (ceiling of this floor), sometimes with a stair gap
      if (f < floors - 1 && r.chance(0.5) && w > 7) { const gx = x + r.range(2, w - 4.2); this.rect(x, y0, gx - x, th, slabM); this.rect(gx + 1.9, y0, x + w - gx - 1.9, th, slabM); }
      else this.rect(x, y0, w, th, slabM);
      // partition
      if (w > 7 && r.chance(0.7)) { const px = x + r.range(2.6, w - 2.6); const pm = r.pick(B.part); if (pm === 'glass' || r.chance(0.4)) this.rect(px, y0 + th, 0.3, fh - th, pm); else this.rect(px, y0 + th, 0.34, fh - th - 2.3, pm); }
      // furniture
      const n = r.int(0, 2); for (let i = 0; i < n; i++) this.crates.push([x + r.range(1.2, w - 2), y1, r.range(0.7, 0.95)]);
      if (r.chance(0.28)) this.barrels.push([x + r.range(1.2, w - 1.6), y1]);
      // back-wall windows
      const cols = Math.max(1, Math.floor((w - 2) / 2.4)); for (let c = 0; c < cols; c++) if (r.chance(0.7)) this.win(x + 1.2 + c * ((w - 2.4) / cols), y0 + 1.1, 1.1, 1.4);
      this.spawns.push({ x: x + r.range(1.3, w - 1.3), y: y1 - 0.85 });
      if (f > 0 && r.chance(0.5)) this.spawns.push({ x: x + r.range(1.3, w - 1.3), y: y1 - 0.85 });
    }
    // roof furniture
    this.perches.push({ x: x + r.range(1.2, w - 1.2), y: top - 0.85 });
    if (r.chance(0.6)) { const tx = x + r.range(1, w - 3.6); this.rect(tx, top - 0.5, 0.3, 0.5, 'wood'); this.rect(tx + 2.1, top - 0.5, 0.3, 0.5, 'wood'); this.rect(tx - 0.2, top - 0.5 - 1.5, 2.8, 1.5, r.chance(0.5) ? 'brick' : 'concrete'); }
    else { this.rect(x, top - 0.7, 0.4, 0.7, wallM === 'glass' ? 'concrete' : wallM); this.rect(x + w - 0.4, top - 0.7, 0.4, 0.7, wallM === 'glass' ? 'concrete' : wallM); if (r.chance(0.5)) this.crates.push([x + w / 2, top, 0.85]); }
    return w;
  }
  scaffold(x: number, w: number, levels: number): number {
    const lh = 2.7; const posts = Math.max(2, Math.round(w / 2.6) + 1);
    for (let l = 0; l < levels; l++) {
      const y1 = -l * lh, y0 = y1 - lh;
      for (let p = 0; p < posts; p++) this.rect(x + (p / (posts - 1)) * (w - 0.22), y0 + 0.24, 0.22, lh - 0.24, 'wood');
      this.rect(x - 0.3, y0, w + 0.6, 0.24, 'wood');
      if (this.rng.chance(0.5)) this.crates.push([x + this.rng.range(0.6, w - 1.4), y0, 0.75]);
      if (l > 0 || this.rng.chance(0.3)) this.spawns.push({ x: x + this.rng.range(0.8, w - 0.8), y: y0 - 0.85 });
    }
    this.perches.push({ x: x + w / 2, y: -levels * lh - 0.85 });
    return w;
  }
  /** columns carrying a heavy slab — the classic thing to drop on someone */
  colonnade(x: number, n: number): number {
    const h = this.rng.range(4.4, 5.8); const gap = 3.1; const w = (n - 1) * gap + 0.7;
    for (let i = 0; i < n; i++) this.rect(x + i * gap, -h, 0.7, h, 'concrete');
    this.rect(x - 0.6, -h - 0.9, w + 1.2, 0.9, 'concrete');
    this.perches.push({ x: x + w / 2, y: -h - 0.9 - 0.85 }); this.spawns.push({ x: x + gap / 2 + 0.35, y: -0.85 });
    if (this.rng.chance(0.6)) this.barrels.push([x + gap * 0.5 + 0.2, 0]);
    return w;
  }
  tank(x: number): number {
    const h = this.rng.range(4.2, 5.4);
    this.rect(x + 0.3, -h, 0.28, h, 'wood'); this.rect(x + 2.5, -h, 0.28, h, 'wood'); this.rect(x, -h - 0.25, 3.1, 0.25, 'wood');
    this.rect(x + 0.25, -h - 0.25 - 2, 2.6, 2, 'brick');
    this.perches.push({ x: x + 1.5, y: -h - 2.25 - 0.85 });
    return 3.1;
  }
  /** unbreakable crane with a concrete load on a wooden hanger */
  crane(x: number): number {
    const h = this.rng.range(8.5, 10); const arm = 5.2;
    this.rect(x, -h, 0.5, h, 'metal', true); this.rect(x - 1, -h - 0.4, arm + 1.5, 0.4, 'metal', true);
    this.rect(x + arm - 0.3, -h, 0.16, 2.4, 'wood'); this.rect(x + arm - 1.2, -h + 2.4, 1.95, 1.5, 'concrete');
    return arm + 0.5;
  }
  wall(x: number, h: number, m: MatId): number { this.rect(x, -h, 0.6, h, m); return 0.6; }
  glasshouse(x: number, w: number): number {
    const h = 3.2; const n = Math.round(w / 1.6);
    for (let i = 0; i <= n; i++) { const px = x + (i / n) * (w - 0.14); this.rect(px, -h, 0.14, h, 'wood'); if (i < n) this.rect(px + 0.14, -h + 0.15, (w - 0.14) / n - 0.14, 0.14, 'glass'); }
    this.rect(x - 0.1, -h - 0.16, w + 0.2, 0.16, 'wood');
    this.rect(x + 0.14, -h + 0.3, 0.12, h - 0.3 - 2.3, 'glass'); this.rect(x + w - 0.26, -h + 0.3, 0.12, h - 0.3, 'glass');
    this.spawns.push({ x: x + w / 2, y: -0.85 });
    if (this.rng.chance(0.7)) this.crates.push([x + w * 0.4, 0, 0.8]);
    return w;
  }
  /** archive shelving: wooden frame loaded with paper bundles */
  shelves(x: number, w: number, levels: number): number {
    const lh = 1.5;
    this.rect(x, -levels * lh, 0.2, levels * lh, 'wood'); this.rect(x + w - 0.2, -levels * lh, 0.2, levels * lh, 'wood');
    for (let l = 1; l <= levels; l++) {
      const y = -l * lh; this.rect(x + 0.2, y, w - 0.4, 0.16, 'wood');
      if (l < levels) { let bx = x + 0.3; while (bx < x + w - 0.9) { const bw = this.rng.range(0.4, 0.75), bh = this.rng.range(0.5, 1.1); if (this.rng.chance(0.78)) this.rect(bx, y - bh, bw, bh, 'paper'); bx += bw + 0.03; } }
    }
    let bx = x + 0.3; while (bx < x + w - 0.9) { const bw = this.rng.range(0.4, 0.75), bh = this.rng.range(0.5, 1.2); if (this.rng.chance(0.7)) this.rect(bx, -bh, bw, bh, 'paper'); bx += bw + 0.03; }
    this.perches.push({ x: x + w / 2, y: -levels * lh - 0.85 });
    return w;
  }
  finish(L: Level) {
    const st = this.g.st; st.finalize(L.groundY);
    for (const [cx, fy, s] of this.crates) { if (this.g.phys.pointSolid(cx, fy - s / 2, 0xffff0001) ) continue; st.spawnBody([rectPoly(cx - s / 2, fy - s - 0.01, s, s)], 'crate', 0, 0, 'crate'); }
    for (const [cx, fy] of this.barrels) { const cl = st.spawnBody([rectPoly(cx - 0.36, fy - 1.06, 0.72, 1.05)], 'barrel', 0, 0, 'barrel'); cl.life = Infinity; }
  }
}

function waves(spec: RoomSpec, rng: Rng): { kind: EnemyKind; elite: boolean }[][] {
  const i = spec.index, t = spec.tier; const out: { kind: EnemyKind; elite: boolean }[][] = [];
  const pool: [EnemyKind, number, number][] = [['grunt', 10, 0], ['shooter', 7, 0], ['shield', 5, 1], ['heavy', 3.2, 2], ['tracer', 5, 4], ['anchor', t >= 5 ? 4.5 : 2.6, 3]];
  const avail = pool.filter((p) => i >= p[2]);
  const nW = spec.first && i === 0 ? 2 : i < 2 ? 2 : 3;
  let budget = (3.2 + i * 1.25 + (t - 1) * 0.6 + (t >= 6 ? 1.5 : 0)) * (spec.kind === 'demolish' ? 0.8 : 1);
  if (spec.first && i === 0) budget = 2.2;
  const eliteP = i < 2 ? 0 : 0.06 + (t >= 3 ? 0.12 : 0) + i * 0.012;
  const threat: Record<EnemyKind, number> = { grunt: 1, shooter: 1.5, shield: 2, tracer: 2.2, heavy: 3.5, anchor: 2.5, boss: 99 };
  for (let w = 0; w < nW; w++) {
    let b = budget * (0.8 + w * 0.22); const wave: { kind: EnemyKind; elite: boolean }[] = []; let anchors = 0, heavies = 0; let guard = 0;
    while (b > 0.6 && wave.length < 9 && guard++ < 40) {
      const pick = rng.weighted(avail, (p) => (threat[p[0]] <= b + 0.5 ? p[1] : 0.01)); const k = pick[0];
      if (k === 'anchor' && anchors >= 1) continue; if (k === 'heavy' && heavies >= (i > 6 ? 2 : 1)) continue;
      if (spec.first && i === 0 && w === 0 && k !== 'grunt') continue;
      if (k === 'anchor') anchors++; if (k === 'heavy') heavies++;
      const elite = k !== 'anchor' && rng.chance(eliteP); wave.push({ kind: k, elite }); b -= threat[k] * (elite ? 1.6 : 1);
    }
    if (!wave.length) wave.push({ kind: 'grunt', elite: false });
    out.push(wave);
  }
  return out;
}

export function buildRoom(g: Game, spec: RoomSpec): RoomPlan {
  const rng = new Rng(spec.seed); const B = BIOMES[spec.biome]; const b = new Builder(g, rng, B);
  const boss = spec.kind === 'boss';
  const W = boss ? 46 : rng.range(44, 56);
  const L: Level = { x0: -W / 2, x1: W / 2, y0: -30, groundY: 0, spawnX: -W / 2 + 4, spawnY: -0.85, biome: B.id, name: '' };
  makeBounds(g, L);
  let bossAt: Pt | null = null;
  if (boss) {
    b.crane(L.x0 + 7); b.colonnade(L.x0 + 15, 3); b.building(-3.5, 9, 1); b.colonnade(8, 3); b.tank(L.x1 - 16); b.crane(L.x1 - 9.5);
    for (let i = 0; i < 4; i++) b.barrels.push([rng.range(L.x0 + 9, L.x1 - 9), 0]);
    bossAt = { x: 10, y: -1.7 }; b.spawns.push({ x: L.x1 - 5, y: -0.85 }, { x: 0, y: -0.85 }, { x: L.x0 + 12, y: -0.85 });
  } else {
    let x = L.x0 + 7.5; const end = L.x1 - 4; let last = ''; let big: Chunk[] = []; let bigN = 0; let first = true;
    const mods: [string, number][] = B.id === 'press' ? [['building', 5], ['scaffold', 3], ['colonnade', 2], ['tank', 2], ['wall', 1.5], ['glasshouse', 1.5], ['crane', 1.2]]
      : B.id === 'archive' ? [['building', 4], ['shelves', 5], ['glasshouse', 2.5], ['scaffold', 2], ['colonnade', 1.5], ['wall', 1]]
        : [['building', 6], ['colonnade', 3], ['glasshouse', 2.5], ['crane', 2], ['wall', 1.5], ['tank', 1]];
    while (x < end - 3) {
      let m = rng.weighted(mods, (q) => (q[0] === last ? q[1] * 0.25 : q[1]))[0]; if (first && spec.kind === 'demolish') m = 'building'; first = false;
      const room = end - x; let w = 0; const n0 = b.marked.length;
      const markThis = spec.kind === 'demolish' && m === 'building' && bigN === 0; b.mark = markThis;
      if (m === 'building') { const bw = Math.min(room, rng.range(7.5, 12.5)); if (bw < 6) m = 'wall'; else w = b.building(x, bw, B.id === 'tower' ? rng.int(2, 4) : rng.int(1, 3)); }
      if (m === 'scaffold') { const sw = Math.min(room, rng.range(5, 9)); w = b.scaffold(x, sw, rng.int(1, 3)); }
      else if (m === 'colonnade') { const n = room > 10 ? rng.int(2, 3) : 2; w = b.colonnade(x, n); }
      else if (m === 'tank') w = b.tank(x);
      else if (m === 'crane') w = b.crane(x + 1);
      else if (m === 'glasshouse') w = b.glasshouse(x, Math.min(room, rng.range(4.5, 7.5)));
      else if (m === 'shelves') w = b.shelves(x, Math.min(room, rng.range(4, 7)), rng.int(2, 4));
      else if (m === 'wall') w = b.wall(x, rng.range(3, 5.5), rng.pick(B.wall) === 'glass' ? 'glass' : rng.pick(['brick', 'concrete', 'plaster'] as MatId[]));
      b.mark = false; if (markThis && b.marked.length > n0) { bigN++; big = b.marked; }
      // ground spawn in the gap
      const gap = rng.range(2.6, 5.2); b.spawns.push({ x: x + w + gap / 2, y: -0.85 });
      if (rng.chance(0.35)) b.crates.push([x + w + gap * 0.5, 0, 0.85]); if (rng.chance(0.2)) b.barrels.push([x + w + gap * 0.3, 0]);
      x += w + gap; last = m;
    }
    b.spawns.push({ x: L.x1 - 2.5, y: -0.85 });
  }
  b.finish(L);
  const name = boss ? B.rooms[4] : B.rooms[(spec.index + (spec.seed & 3)) % 4];
  let area = 0; for (const c of b.marked) area += c.area;
  const air: Pt[] = []; for (let i = 0; i < 6; i++) air.push({ x: rng.range(L.x0 + 6, L.x1 - 6), y: rng.range(-11, -6) });
  return { level: L, biome: B, name, kind: spec.kind, spawns: b.spawns, perches: b.perches, air, decor: b.decor, waves: boss ? [[{ kind: 'boss', elite: false }]] : waves(spec, rng), marked: b.marked, markedArea: area, surviveT: 34 + spec.index * 1.5, demolishGoal: 0.6, bossAt };
}
