// Tools: shovel, snow saw, axe, beams, snow blocks, campfire; crates, eating.
import { W, H, M, mat, dens, bond, flags, body, idx, inb, set, rigidAt, isGranular, crates, F_DIST, F_TREE, F_VERT, BOND_SOLID, CELL, wake } from './world';
import { G, Fire } from './state';
import { pl, PH } from './player';
import { spawn, PK } from './particles';
import { markStruct, supportMargin } from './structure';
import { makeBody, bodyAtIndex, removeBody, bodies } from './bodies';
import type { Sound } from './audio';

export const TOOLS = [
  { id: 'shovel', name: 'Лопата', key: '1' },
  { id: 'saw', name: 'Пила', key: '2' },
  { id: 'axe', name: 'Топор', key: '3' },
  { id: 'beam', name: 'Бревно', key: '4' },
  { id: 'block', name: 'Блок', key: '5' },
  { id: 'fire', name: 'Костёр', key: '6' },
] as const;

export const inv = { logs: 0, branches: 0, matches: 5, food: 1, crackers: 1, thermos: 0, blocks: [] as number[], saw: true, snowshoes: false };
export const tool = { cur: 0, cool: 0, rot: 0, load: 0, loadDens: 0, sawT: 0, msg: '' as string, built: new Set<string>() };
export const REACH = 40; // cells (2 m)
let sfx: Sound | null = null;
export function bindSound(s: Sound) { sfx = s; }
let fireId = 1;

export function resetTools() {
  Object.assign(inv, { logs: 0, branches: 0, matches: 5, food: 1, crackers: 1, thermos: 0, blocks: [], saw: true, snowshoes: false });
  Object.assign(tool, { cur: 0, cool: 0, rot: 0, load: 0, loadDens: 0, sawT: 0, msg: '' });
  tool.built.clear();
  G.fires.length = 0;
}

const shoulder = () => [pl.x, pl.y - PH * 0.72] as const;
export function inReach(x: number, y: number) { const [sx, sy] = shoulder(); return Math.hypot(x - sx, y - sy) <= REACH; }
/** Clamp aim to reach along the ray from the shoulder; stop at the first rigid non-target cell. */
export function reachPoint(ax: number, ay: number): [number, number] {
  const [sx, sy] = shoulder();
  const d = Math.hypot(ax - sx, ay - sy);
  if (d <= REACH) return [ax, ay];
  return [sx + (ax - sx) * REACH / d, sy + (ay - sy) * REACH / d];
}

function say(m: string) { tool.msg = m; }

// ---------------- shovel ----------------
function dig(ax: number, ay: number) {
  const r = 4.5;
  let n = 0, sum = 0, hard = 0;
  const cap = 46 - tool.load;
  if (cap <= 2) { throwLoad(ax, ay, true); return; }
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (dx * dx + dy * dy > r * r || n >= cap) continue;
    const x = Math.round(ax + dx), y = Math.round(ay + dy);
    if (!inb(x, y)) continue;
    const i = idx(x, y);
    if ((mat[i] !== M.SNOW && mat[i] !== M.ASH) || body[i]) continue;
    n++; sum += dens[i]; hard += bond[i] / 255 * Math.min(1, dens[i] / 400);
    set(x, y, M.AIR);
  }
  if (n === 0) { const i = inb(ax | 0, ay | 0) ? idx(ax | 0, ay | 0) : 0; if (mat[i] === M.ICE || mat[i] === M.DIRT || mat[i] === M.ROCK) { say('Лопата не берёт мёрзлую землю и лёд'); sfx?.uiDeny(); } return; }
  const h = hard / n;
  tool.loadDens = (tool.loadDens * tool.load + sum) / (tool.load + n);
  tool.load += n;
  pl.stamina -= 0.012 + h * 0.02;
  pl.snowOn = Math.min(1, pl.snowOn + 0.01);
  tool.cool = 0.22 + h * 0.45;
  sfx?.dig(h);
  for (let k = 0; k < 5; k++) spawn(PK.DUST, ax, ay, (Math.random() - 0.5) * 40, -Math.random() * 30, 0.8, 1, 0, 0);
  markStruct(ax - 8, ay - 8, ax + 8, ay + 8);
}
export function throwLoad(ax: number, ay: number, auto: boolean) {
  if (tool.load < 1) return;
  const [sx, sy] = shoulder();
  let dx = ax - sx, dy = ay - sy;
  if (auto) { dx = -pl.face * 30; dy = -20; } // toss behind
  const L = Math.max(1, Math.hypot(dx, dy));
  const sp = 95 + Math.min(60, L * 1.2);
  const n = Math.round(tool.load);
  for (let k = 0; k < n; k++) {
    const j = (Math.random() - 0.5) * 0.25;
    const vx = (dx / L + j) * sp * (0.85 + Math.random() * 0.3);
    const vy = (dy / L + j) * sp * (0.85 + Math.random() * 0.3) - 25;
    spawn(PK.CLUMP, sx + (Math.random() - 0.5) * 4, sy + (Math.random() - 0.5) * 4, vx, vy, 4, 1, Math.max(120, Math.min(400, Math.round(tool.loadDens * 0.8))), 0);
  }
  tool.load = 0; tool.loadDens = 0;
  sfx?.throwSnow();
  pl.stamina -= 0.01;
}

// ---------------- saw ----------------
function blockRect(ax: number, ay: number) {
  const vert = tool.rot % 2 === 1;
  const w = vert ? 5 : 10, h = vert ? 10 : 5;
  const x0 = Math.round(ax - w / 2), y0 = Math.round(ay - h / 2);
  return { x0, y0, w, h };
}
function saw(ax: number, ay: number, dt: number) {
  if (!inv.saw) { say('Пилы нет. Поищи ящики под оранжевыми вешками'); return; }
  if (inv.blocks.length >= 4) { say('Больше 4 блоков не унести. Сложи их'); return; }
  const { x0, y0, w, h } = blockRect(ax, ay);
  let ok = 0, sum = 0, tot = w * h, weak = 0;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    if (!inb(x, y)) continue; const i = idx(x, y);
    if (mat[i] === M.SNOW && !body[i]) { ok++; sum += dens[i]; if (bond[i] < BOND_SOLID) weak++; }
  }
  if (ok < tot * 0.85) { say('Пилой режут сплошной снег. Здесь пустота или не снег'); tool.sawT = 0; return; }
  const avg = sum / ok;
  if (weak > tot * 0.2 || avg < 170) { say(`Снег рыхлый (${Math.round(avg)} кг/м³), блок развалится. Ищи наст плотнее 170 и спёкшийся`); tool.sawT = 0; return; }
  tool.sawT += dt;
  if (Math.random() < dt * 4) { sfx?.sawStroke(); spawn(PK.DUST, ax, ay, (Math.random() - 0.5) * 20, -10, 0.6, 1, 0, 0); }
  if (tool.sawT < 1.0 + avg / 500) return;
  tool.sawT = 0;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { if (inb(x, y) && mat[idx(x, y)] === M.SNOW) set(x, y, M.AIR); }
  inv.blocks.push(Math.round(avg));
  pl.stamina -= 0.05;
  tool.cool = 0.3;
  say(`Блок ${Math.round(avg)} кг/м³ вырезан`);
  markStruct(x0 - 4, y0 - 4, x0 + w + 4, y0 + h + 4);
}

/** cells a snow block / beam would occupy at the aim */
export function ghostCells(kind: 'block' | 'beam', ax: number, ay: number) {
  const vert = tool.rot % 2 === 1;
  let w: number, h: number;
  if (kind === 'block') { w = vert ? 5 : 10; h = vert ? 10 : 5; } else { w = vert ? 4 : 20; h = vert ? 20 : 4; }
  const x0 = Math.round(ax - w / 2), y0 = Math.round(ay - h / 2);
  const cells: { x: number; y: number; m: number; d: number; b: number }[] = [];
  let blocked = false;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    if (!inb(x, y)) { blocked = true; continue; }
    const i = idx(x, y);
    if ((rigidAt(i) && !isGranular(i)) || body[i]) blocked = true;
    cells.push({ x, y, m: kind === 'block' ? M.SNOW : M.PLANK, d: kind === 'block' ? (inv.blocks[inv.blocks.length - 1] ?? 300) : 500, b: kind === 'block' ? 170 : 0 });
  }
  // the player's own body
  const px0 = pl.x - 5, px1 = pl.x + 5, py0 = pl.y - PH, py1 = pl.y;
  if (x0 < px1 && x0 + w > px0 && y0 < py1 && y0 + h > py0) blocked = true;
  return { cells, blocked, x0, y0, w, h };
}
let marginCache = { key: '', v: 1 };
export function ghostMargin(kind: 'block' | 'beam', ax: number, ay: number) {
  const g = ghostCells(kind, ax, ay);
  const key = kind + g.x0 + ',' + g.y0 + ',' + tool.rot + ',' + (G.frame >> 3);
  if (marginCache.key !== key) { marginCache = { key, v: g.blocked ? 0 : supportMargin(g.cells) }; }
  return { ...g, margin: marginCache.v };
}

function place(kind: 'block' | 'beam', ax: number, ay: number) {
  if (kind === 'block' && inv.blocks.length === 0) { say('Нет снежных блоков. Вырежи пилой из плотного наста'); sfx?.uiDeny(); return; }
  if (kind === 'beam' && inv.logs < 1) { say('Нет брёвен. Свали ель топором'); sfx?.uiDeny(); return; }
  const g = ghostCells(kind, ax, ay);
  if (g.blocked) { say('Мешает: тут твёрдое или стоишь ты сам'); sfx?.uiDeny(); return; }
  const vert = tool.rot % 2 === 1;
  const d = kind === 'block' ? inv.blocks.pop()! : 500;
  for (const c of g.cells) {
    const i = idx(c.x, c.y);
    if (mat[i] !== M.AIR) { // displace loose snow upward
      let y = c.y - 1; while (y > 0 && mat[idx(c.x, y)] !== M.AIR) y--;
      if (y > g.y0 - 12 && y > 0) set(c.x, y, M.SNOW, dens[i], 0, F_DIST);
    }
    if (kind === 'block') set(c.x, c.y, M.SNOW, d, 175, F_DIST);
    else set(c.x, c.y, M.PLANK, 500, 0, vert ? F_VERT : 0);
  }
  if (kind === 'beam') inv.logs--;
  sfx?.place(kind === 'beam');
  tool.cool = 0.25;
  pl.stamina -= 0.03;
  markStruct(g.x0 - 2, g.y0 - 2, g.x0 + g.w + 2, g.y0 + g.h + 2);
  tool.built.add(kind === 'beam' ? 'wood' : 'snow');
}

// ---------------- axe ----------------
function treeCells(sx: number, sy: number): number[] {
  // flood fill wood+needle tree cells connected to (sx,sy) above the cut, limited
  const out: number[] = []; const seen = new Set<number>();
  const st = [idx(sx, sy)];
  while (st.length && out.length < 9000) {
    const i = st.pop()!; if (seen.has(i)) continue; seen.add(i);
    const m = mat[i];
    if (!((m === M.WOOD || m === M.NEEDLE) && (flags[i] & F_TREE)) || body[i]) continue;
    out.push(i);
    const x = i % W;
    if (x > 0) st.push(i - 1); if (x < W - 1) st.push(i + 1); st.push(i - W); st.push(i + W);
  }
  return out;
}
function chop(ax: number, ay: number) {
  const cx = Math.round(ax), cy = Math.round(ay);
  // fallen tree / beam body?
  for (let r = 0; r <= 3; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (!inb(cx + dx, cy + dy)) continue;
    const i = idx(cx + dx, cy + dy);
    if (body[i]) {
      const rec = bodyAtIndex(i);
      if (rec && (rec.kind === 'tree' || rec.kind === 'beam' || rec.kind === 'debris')) {
        rec.hits++;
        sfx?.chop(true);
        for (let k = 0; k < 4; k++) spawn(PK.CHIP, ax, ay, (Math.random() - 0.5) * 60, -30 - Math.random() * 40, 2, 1, 0, 0);
        pl.stamina -= 0.04; tool.cool = 0.42;
        let wood = 0, ndl = 0;
        for (let k = 0; k < rec.lm.length; k++) { if (rec.lm[k] === M.WOOD || rec.lm[k] === M.PLANK) wood++; else if (rec.lm[k] === M.NEEDLE) ndl++; }
        const need = Math.max(2, Math.round(wood / 160));
        if (rec.hits >= need) {
          const logs = Math.max(1, Math.round(wood / 80));
          const br = Math.round(ndl / 140) + (rec.kind === 'tree' ? 2 : 0);
          inv.logs += logs; inv.branches += br;
          removeBody(rec, false);
          say(`+${logs} брёвен${br ? `, +${br} хвороста` : ''}`);
          sfx?.pickup();
        } else say(`Разделка: ${rec.hits}/${need}`);
        return;
      }
    }
  }
  const i0 = inb(cx, cy) ? idx(cx, cy) : -1;
  if (i0 < 0) return;
  const m0 = mat[i0];
  if (m0 === M.PLANK) {
    // dismantle placed beam: remove connected plank cells (up to one log's worth)
    const st = [i0]; const seen = new Set<number>(); let n = 0;
    while (st.length && n < 80) { const i = st.pop()!; if (seen.has(i) || mat[i] !== M.PLANK) continue; seen.add(i); n++; set(i % W, (i / W) | 0, M.AIR); st.push(i - 1, i + 1, i - W, i + W); }
    inv.logs += 1; sfx?.chop(true); tool.cool = 0.4; say('+1 бревно'); markStruct(cx - 30, cy - 30, cx + 30, cy + 30); return;
  }
  if (m0 === M.NEEDLE && (flags[i0] & F_TREE)) {
    // cut a few branches for kindling
    let n = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { if (!inb(cx + dx, cy + dy)) continue; const i = idx(cx + dx, cy + dy); if (mat[i] === M.NEEDLE) { set(cx + dx, cy + dy, M.AIR); n++; } }
    if (n > 8) { inv.branches += 1; say('+1 хворост'); }
    sfx?.chop(false); tool.cool = 0.35; pl.stamina -= 0.015; return;
  }
  if (m0 !== M.WOOD || !(flags[i0] & F_TREE)) { sfx?.chop(false); tool.cool = 0.4; return; }
  // notch the trunk
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = cx + dx, y = cy + dy; if (!inb(x, y)) continue; const i = idx(x, y);
    if (mat[i] === M.WOOD && (flags[i] & F_TREE)) set(x, y, M.AIR);
  }
  for (let k = 0; k < 5; k++) spawn(PK.CHIP, ax, ay, (Math.random() - 0.5) * 70, -20 - Math.random() * 40, 2.5, 1, 0, 0);
  sfx?.chop(true);
  pl.stamina -= 0.035; tool.cool = 0.4;
  // severed? check whether trunk cells above the notch still connect to the ground
  const above: number[] = [];
  for (let dx = -4; dx <= 4; dx++) { const x = cx + dx, y = cy - 2; if (inb(x, y) && mat[idx(x, y)] === M.WOOD && (flags[idx(x, y)] & F_TREE)) above.push(idx(x, y)); }
  if (!above.length) return;
  const cells = treeCells(above[0] % W, (above[0] / W) | 0);
  let grounded = false;
  for (const i of cells) { const b = i + W; if (b < W * H && (mat[b] === M.DIRT || mat[b] === M.ROCK || mat[b] === M.SNOW && (b / W | 0) > cy + 1)) { if (mat[i] === M.WOOD && (i / W | 0) >= cy) { grounded = true; break; } } }
  // trunk cells below the notch row are part of the stump: exclude them
  const top = cells.filter((i) => ((i / W) | 0) < cy);
  if (!grounded && top.length > 20) {
    sfx?.treeCreak();
    const away = Math.sign(cx - pl.x) || 1;
    // snow resting on the boughs loses support → it will fall as granular snow
    for (const i of top) { const a = i - W; if (a >= 0 && mat[a] === M.SNOW) { bond[a] = 0; flags[a] |= F_DIST; wake(a % W, (a / W) | 0); } }
    const rec = makeBody(top, 'tree', away * 0.2, 0, away * 0.25);
    if (rec) say('Дерево падает!');
  } else if (!grounded) say('Подруби ещё');
  else say('Подрубай ниже, у самого ствола');
}

// ---------------- fire ----------------
export function placeFire(ax: number, ay: number) {
  if (inv.matches < 1) { say('Нет спичек'); sfx?.uiDeny(); return; }
  if (inv.logs < 1 || inv.branches < 2) { say('Для костра нужно 1 бревно и 2 хвороста'); sfx?.uiDeny(); return; }
  // settle onto the surface below the aim
  let x = Math.round(ax), y = Math.round(ay);
  if (!inb(x, y)) return;
  while (y < H - 2 && mat[idx(x, y)] === M.AIR) y++;
  if (Math.abs(y - ay) > 30 || !inReach(x, y)) { say('Слишком далеко'); return; }
  inv.matches--; inv.logs--; inv.branches -= 2;
  G.fires.push({ x, y, fuel: 150, power: 0, lit: true, id: fireId++ });
  sfx?.ignite();
  say('Костёр горит. Подкидывай брёвна: «Взять» рядом с огнём');
  tool.built.add('fire');
}
export function feedFire(f: Fire): boolean {
  if (inv.logs > 0) { inv.logs--; f.fuel += 120; sfx?.place(true); say('+2 часа огня'); return true; }
  if (inv.branches > 0) { inv.branches--; f.fuel += 35; sfx?.place(true); say('+35 минут огня'); return true; }
  if (!f.lit && inv.matches > 0 && f.fuel > 0) { inv.matches--; f.lit = true; sfx?.ignite(); return true; }
  say('Нечем подкинуть'); return false;
}
export function stepFires(dt: number) {
  const gm = dt * G.timeScale; // game minutes
  for (let k = G.fires.length - 1; k >= 0; k--) {
    const f = G.fires[k];
    if (f.lit) {
      f.fuel -= gm;
      f.power = 4200 * Math.min(1, f.fuel / 30) * (0.85 + Math.random() * 0.3);
      if (f.fuel <= 0) { f.lit = false; f.power = 0; }
    }
    // sink: fire rests on whatever is below; melting snow under it lets it drop
    let support = false;
    for (let dx = -3; dx <= 3; dx++) { const i = idx(f.x + dx, f.y); if (inb(f.x + dx, f.y) && (mat[i] !== M.AIR && mat[i] !== M.WATER)) support = true; }
    if (!support && f.y < H - 4) f.y++;
    // water at the fire base sizzles and can drown it
    let water = 0;
    for (let dy = -2; dy <= 0; dy++) for (let dx = -4; dx <= 4; dx++) { if (inb(f.x + dx, f.y + dy) && mat[idx(f.x + dx, f.y + dy)] === M.WATER) water++; }
    if (f.lit && water > 0) {
      if (Math.random() < dt * 2) { sfx?.sizzle(); spawn(PK.STEAM, f.x, f.y - 3, 0, -10, 2, 1, 0, 0); }
      if (water > 14) { f.lit = false; say('Костёр залило талой водой. Ставь его на брёвна'); }
      // evaporate some water
      for (let dx = -4; dx <= 4; dx++) { const i = idx(f.x + dx, f.y - 1); if (inb(f.x + dx, f.y - 1) && mat[i] === M.WATER && Math.random() < dt * 0.6) set(f.x + dx, f.y - 1, M.AIR); }
    }
    if (f.lit) {
      const q = G.quality ? 1 : 0.5;
      if (Math.random() < dt * 30 * q) spawn(PK.FLAME, f.x + (Math.random() - 0.5) * 8, f.y - 2, (Math.random() - 0.5) * 10, -20 - Math.random() * 25, 0.5 + Math.random() * 0.4, 1, 0, 0);
      if (Math.random() < dt * 4 * q) spawn(PK.SPARK, f.x + (Math.random() - 0.5) * 6, f.y - 6, (Math.random() - 0.5) * 30, -40 - Math.random() * 40, 1.2, 1, 0, 0);
      if (Math.random() < dt * 5 * q) spawn(PK.SMOKE, f.x, f.y - 12, (Math.random() - 0.5) * 6, -12, 5, 1, 0, 0);
    }
    if (!f.lit && f.fuel <= 0 && f.power === 0) { // burned out: leave ash
      for (let dx = -3; dx <= 3; dx++) if (inb(f.x + dx, f.y - 1) && mat[idx(f.x + dx, f.y - 1)] === M.AIR) set(f.x + dx, f.y - 1, M.ASH, 300, 0, 0);
      G.fires.splice(k, 1);
    }
  }
}

// ---------------- interact / eat ----------------
export function interact(): boolean {
  // fire nearby?
  for (const f of G.fires) if (Math.hypot(f.x - pl.x, f.y - pl.y) < 30) return feedFire(f);
  // crate nearby (touching body)?
  for (const c of crates) {
    if (c.opened) continue;
    const dx = Math.max(c.x - pl.x, 0, pl.x - (c.x + c.w)), dy = Math.max(c.y - pl.y, 0, (pl.y - PH) - (c.y + c.h));
    if (dx < 8 && dy < 8) {
      c.opened = true; sfx?.crateOpen();
      const got: string[] = [];
      for (const l of c.loot) {
        if (l === 'food') { inv.food++; got.push('консервы'); }
        else if (l === 'crackers') { inv.crackers++; got.push('сухари'); }
        else if (l === 'matches') { inv.matches += 4; got.push('спички ×4'); }
        else if (l === 'thermos') { inv.thermos++; got.push('термос с чаем'); }
        else if (l === 'saw') { inv.saw = true; inv.matches += 2; got.push('спички ×2'); }
        else if (l === 'snowshoes') { inv.snowshoes = true; pl.snowshoes = true; got.push('снегоступы (надеты)'); }
      }
      // crate becomes an open empty box: remove its lid cells
      for (let x = c.x; x < c.x + c.w; x++) { const i = idx(x, c.y); if (mat[i] === M.CRATE) set(x, c.y, M.AIR); }
      say('В ящике: ' + got.join(', '));
      return true;
    }
  }
  // pick up loose logs (beam bodies) nearby
  for (const rec of bodies.values()) {
    if (rec.kind !== 'beam' && rec.kind !== 'debris') continue;
    const p = rec.b.getPosition();
    if (Math.hypot(p.x * 20 - pl.x, p.y * 20 - (pl.y - 10)) < 26) {
      let wood = 0; for (let k = 0; k < rec.lm.length; k++) if (rec.lm[k] === M.WOOD || rec.lm[k] === M.PLANK) wood++;
      if (wood > 10) { inv.logs += Math.max(1, Math.round(wood / 80)); removeBody(rec, false); sfx?.pickup(); say('Подобрал брёвна'); return true; }
    }
  }
  return false;
}
export function eat(): boolean {
  if (inv.thermos > 0 && pl.core < 36.5) { inv.thermos--; pl.core = Math.min(37, pl.core + 1.2); pl.food = Math.min(1, pl.food + 0.05); sfx?.eat(); say('Горячий чай: +1.2 °C'); return true; }
  if (pl.food > 0.92) { say('Пока не голоден'); return false; }
  if (inv.food > 0) { inv.food--; pl.food = Math.min(1, pl.food + 450 / 2000); sfx?.eat(); say('Консервы: +450 ккал'); return true; }
  if (inv.crackers > 0) { inv.crackers--; pl.food = Math.min(1, pl.food + 250 / 2000); sfx?.eat(); say('Сухари: +250 ккал'); return true; }
  if (inv.thermos > 0) { inv.thermos--; pl.core = Math.min(37, pl.core + 1.2); sfx?.eat(); return true; }
  say('Еды нет. Ищи ящики под оранжевыми вешками'); sfx?.uiDeny(); return false;
}

// ---------------- dispatch ----------------
export function usePrimary(ax: number, ay: number, dt: number) {
  tool.cool -= dt;
  const [x, y] = reachPoint(ax, ay);
  const id = TOOLS[tool.cur].id;
  if (id === 'saw') { if (tool.cool <= 0) saw(x, y, dt); return; }
  if (tool.cool > 0) return;
  if (pl.stamina < 0.03) { say('Нет сил. Передохни'); tool.cool = 0.5; return; }
  if (id === 'shovel') dig(x, y);
  else if (id === 'axe') chop(x, y);
  else if (id === 'beam') place('beam', x, y);
  else if (id === 'block') place('block', x, y);
  else if (id === 'fire') { placeFire(x, y); tool.cool = 0.6; }
}
export function useSecondary(ax: number, ay: number) {
  const [x, y] = reachPoint(ax, ay);
  const id = TOOLS[tool.cur].id;
  if (id === 'shovel') { if (tool.load > 0) throwLoad(ax, ay, false); else say('Лопата пустая. Сначала набери снег'); }
  else if (id === 'saw' || id === 'block') place('block', x, y);
  else if (id === 'beam' || id === 'axe') place('beam', x, y);
  else if (id === 'fire') placeFire(x, y);
}
export function idleTool(dt: number) { tool.cool -= dt; tool.sawT = Math.max(0, tool.sawT - dt * 2); }
export { CELL };
