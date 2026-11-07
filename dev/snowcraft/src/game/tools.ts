// Tools & building (DESIGN §4): probe data, snow knife blocks (density classes), block placement with dome lean and support preview,
// shovel scoop / carry / throw / tamp, ice chisel, axe / pick / saw dig times by hardness, harpoon, fishing, torch / lantern / flare,
// eating, drops with a magnet to the player, interaction (E), and the target info drawn by draw.ts.
import { G, toast, type Light, type Fixture } from './state';
import { emit } from './bus';
import { strings, fmt } from '../content/i18n';
import { input } from '../engine/input';
import { screenToWorld } from '../engine/render';
import { W, H, TS, mat, aux, flags, shade, setCell, edited, wake, F_PLACED, F_FIXTURE } from '../engine/grid';
import { MAT, MATS, WALK, PHASE, P_SOLID, P_POWDER } from '../content/materials';
import { moveBox, boxFree } from '../engine/phys';
import { supportPreview, type PreviewCell } from '../engine/structure';
import { throwCell, spawnFx, burstFx } from '../engine/particles';
import { tempAt } from '../engine/heat';
import { setCameraLook } from '../engine/camera';
import {
  inv, add, count, remove, selected, select, spawnDrop, dropDur, held, hitchSled, unhitchSled, sledNear, equip, BELT, backpacks, removeFromSlot, MAX_DROPS,
} from './inventory';
import { getItem, itemName, densityOf, auxOfDensity, snowClass, snowClassName, blockWeight, type ItemDef } from './items';
import {
  fixtureAtTile, fixtureNear, interact as fxInteract, planFixture, placeFixture, pickupFixture, stash, fixtureLabel, fixtureName, FIXTURE_DEFS, tryLight, type Plan,
} from './fixtures';
import { body, eatSlot, eatBest, toggleParka, aimSway, handsFactor, openBackpack } from './player';
import { extra as shelterExtra } from './shelter';
import { MIN_PER_SEC } from './weather';
import { dogInteract } from './fauna';

const S = strings('tools', {
  far: 'далеко', blocked: 'не достать: мешает стена', noTool: 'нужна кирка', needPick: 'нужна кирка', needAxe: 'нужен топор', needChisel: 'нужна пешня или кирка',
  tooHard: 'не по силам', hardRock: 'слишком твёрдо', bedrock: 'не пробить',
  thin: 'слой слишком тонкий для блока', cutNeedSnow: 'Нужен плотный наст', crumble: 'рассыпется: слишком рыхло ({d})', cutOk: 'Вырезать блок ({d}, {c})',
  looseSnow: 'рыхлый снег: бери лопатой', packed: 'наст', block: 'снежный блок',
  density: '{d} кг/м³ · {c}', iceThick: 'лёд {cm} см',
  shovelFull: 'лопата полна: вывали снег',
  scoop: 'Копать', throwSnow: 'Бросить снег', tamp: 'Утрамбовать', cut: 'Вырезать блок', dig: 'Копать', chisel: 'Долбить лёд', place: 'Поставить', use: 'Использовать',
  noSupport: 'нет опоры', span: 'слишком длинный пролёт', ok: 'держится',
  occupied: 'занято', inYou: 'мешает тебе',
  gotBlock: 'Блок: {c}', crumbled: 'Рассыпался…', brokeTool: '{name} сломался',
  torchLit: 'Факел горит', torchOut: 'Факел погас', noFlame: 'Нечем зажечь факел',
  lanternOn: 'Фонарь горит', lanternOff: 'Фонарь погашен', lanternEmpty: 'В фонаре нет солярки',
  flareNone: 'Нет ракет', flareShot: 'Ракета в небо!',
  fishCast: 'Забросил леску…', fishBite: 'Клюёт! Тяни!', fishLost: 'Сорвалась', fishGot: 'Поймал: {name}', fishNeedHole: 'Нужна лунка или полынья', fishColdHands: 'Руки стынут: ловля — тонкая работа',
  harpoon: 'Гарпун!', noAmmo: 'Нечем',
  bagged: 'Снег в сумке: {n}', barometer: 'Барометр: {t}',
  equipped: 'Надето: {name}', sled: 'Запрягся в нарты (G с инструментом или пустой рукой — оставить)', cantEat: 'Не хочется',
  handsFrozen: 'Руки не слушаются',
  domeOn: 'Режим купола: блоки наклоняются внутрь', domeOff: 'Обычная укладка', smartOn: 'Умный курсор', smartOff: 'Свободный курсор',
  picked: 'Взял: {name}', backpack: 'Ты вернул свои вещи',
  sledDown: 'Нарты оставлены: E рядом — снова запрячься', sledUp: 'Запрягся в нарты',
  looseHint: 'Снег рыхлый — ищи плотный наст в затишье, под сугробом или у гряды',
  denseGood: 'годится для блоков', denseBad: 'слишком рыхлый',
});

// ---------------------------------------------------------------------------------------------------------------------
export interface Target {
  tx: number; ty: number; tw: number; th: number;                       // rect in tiles
  x: number; y: number;                                                 // aim point in world cells
  mode: 'dig' | 'cut' | 'place' | 'attack' | 'use' | 'chisel' | 'none';
  ok: boolean; progress: number; ghostItem?: string; margin?: number; lean?: -1 | 0 | 1;
  reason?: string; verb: string;
  mat: number; density: number | null; iceCm: number | null; fixture: Fixture | null;
  lines: string[];                                                      // tooltip lines
  inReach: boolean;
}
const TGT: Target = {
  tx: 0, ty: 0, tw: 1, th: 1, x: 0, y: 0, mode: 'none', ok: false, progress: 0, reason: undefined, verb: '', mat: 0, density: null, iceCm: null, fixture: null, lines: [], inReach: false,
};
export const target = () => TGT;
export const toolState = {
  dome: false, smart: false, lean: 0 as -1 | 0 | 1,
  dig: { tx: -1, ty: -1, p: 0, mat: 0 }, cut: { tx: -1, ty: -1, p: 0 },
  eatP: 0, throwing: false, cool: 0, swing: 0, using: false, blockRefund: 0, blockDens: 0, tampT: 0, digSnd: 0,
  fish: { state: 'idle' as 'idle' | 'wait' | 'bite', t: 0, x: 0, y: 0, bite: 0 },
  flares: [] as { x: number; y: number; vx: number; vy: number; t: number }[],
  aimX: 0, aimY: 0, aimAng: 0,
};
/** Placed snow blocks sinter into the shell after a while: they lose F_PLACED and are then as sturdy as natural snow (so a door can be cut afterwards). */
export const sinterQ: { x0: number; y0: number; w: number; t: number }[] = [];
export const sinterMinutes = (dens: number) => (dens < 250 ? 60 : dens <= 380 ? 36 : 26);
function stepSinter(gm: number) {
  for (let i = sinterQ.length - 1; i >= 0; i--) {
    const q = sinterQ[i]; q.t -= gm;
    if (q.t > 0) continue;
    for (let y = q.y0; y < q.y0 + TS; y++) for (let x = q.x0; x < q.x0 + q.w; x++) { const k = y * W + x; if (mat[k] === MAT.SNOWBLOCK) flags[k] &= ~F_PLACED; }
    sinterQ.splice(i, 1);
  }
}
export const REACH = 26;     // cells from the chest
let fishFallback = true;
export function setFishingFallback(on: boolean) { fishFallback = on; }

// ---------------------------------------------------------------------------------------------------------------------
// tool speeds: SPEED[toolKind][materialToolKind] (higher = faster). 0 = cannot.
const SPEED: Record<string, Record<string, number>> = {
  hand: { shovel: 0.3, any: 0.7 },
  knife: { shovel: 0.55, any: 1 },
  shovel: { shovel: 1, any: 1 },
  chisel: { shovel: 0.4, pick: 1.4, any: 1 },
  axe: { shovel: 0.35, axe: 1, pick: 0.45, any: 1 },
  pick: { shovel: 0.6, axe: 0.7, pick: 1, any: 1 },
  saw: { axe: 1.8, any: 1 },
};
const DROPS: Record<string, [string, number]> = {
  ICE: ['ice', 1], LOG: ['log', 1], WOOD: ['log', 1], PLANK: ['plank', 1], WHALEBONE: ['bone', 1], STONE: ['stone', 1], BASALT: ['stone', 1], BRICK: ['stone', 1],
  HARDROCK: ['stone', 1], COAL: ['coal', 1], SOAPSTONE: ['soapstone', 1], LICHEN: ['lichen', 0.6], METAL: ['scrap', 1],
  GRAVEL: ['stone', 0.35],
};
const SNOWY = new Uint8Array(256);
SNOWY[MAT.SNOW] = 1; SNOWY[MAT.PACKED] = 1; SNOWY[MAT.SNOWBLOCK] = 1;
const WOODY = new Uint8Array(256);
WOODY[MAT.LOG] = WOODY[MAT.WOOD] = WOODY[MAT.PLANK] = WOODY[MAT.WHALEBONE] = 1;

function toolKindOf(id: string | undefined): string {
  if (!id) return 'hand';
  const t = getItem(id).tool;
  if (!t) return 'hand';
  return ['knife', 'shovel', 'chisel', 'axe', 'pick', 'saw'].includes(t.kind) ? t.kind : 'hand';
}
/** Seconds to dig one tile of material m with the tool kind (Infinity = impossible). */
export function digTime(m: number, tk: string): number {
  const d = MATS[m];
  if (!d || !isFinite(d.hard) || d.tool === 'none' || m === MAT.FIXTURE || m === MAT.BEDROCK) return Infinity;
  if (d.phase !== P_SOLID && d.phase !== P_POWDER) return Infinity;
  let sp = SPEED[tk]?.[d.tool] ?? 0;
  if (tk === 'saw' && d.tool === 'axe' && !WOODY[m]) sp = 0;
  if (d.tool === 'any') sp = Math.max(sp, SPEED[tk]?.any ?? 0.7);
  if (d.tier >= 1 && d.tool === 'pick' && !(tk === 'pick' || (tk === 'chisel' && m === MAT.ICE))) return Infinity;
  if (d.tier >= 2) sp *= 0.5;
  if (sp <= 0) return Infinity;
  return Math.max(0.18, d.hard / sp);
}
export function digReason(m: number, tk: string): string {
  const d = MATS[m];
  if (!d || !isFinite(d.hard) || m === MAT.BEDROCK) return S.bedrock;
  if (d.tool === 'pick') return m === MAT.ICE ? S.needChisel : S.needPick;
  if (d.tool === 'axe') return S.needAxe;
  return S.tooHard;
}

// ---------------------------------------------------------------------------------------------------------------------
// geometry helpers
const cnt = new Uint16Array(256);
/** Dominant diggable material in a tile (≥ 4 cells), or 0. */
export function tileMaterial(tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= W / TS || ty >= H / TS) return MAT.BEDROCK;
  cnt.fill(0);
  let best = 0, bc = 0;
  for (let j = 0; j < TS; j++) for (let i = 0; i < TS; i++) {
    const m = mat[(ty * TS + j) * W + tx * TS + i];
    if (m === 0 || PHASE[m] > P_POWDER) continue;
    const c = ++cnt[m]; if (c > bc) { bc = c; best = m; }
  }
  return bc >= 4 ? best : 0;
}
export function tileSolid(tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= W / TS || ty >= H / TS) return true;
  let n = 0;
  for (let j = 0; j < TS; j++) for (let i = 0; i < TS; i++) if (WALK[mat[(ty * TS + j) * W + tx * TS + i]]) n++;
  return n >= 8;
}
function los(px: number, py: number, tx: number, ty: number): boolean {
  let x = px, y = py;
  const dx = Math.abs(tx - px), dy = Math.abs(ty - py), sx = px < tx ? 1 : -1, sy = py < ty ? 1 : -1;
  let err = dx - dy, guard = 0;
  while ((x !== tx || y !== ty) && guard++ < 40) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
    if ((x !== tx || y !== ty) && tileSolid(x, y)) return false;
  }
  return true;
}
const chest = () => { const p = G.player; return [p.x, p.y - 11] as const; };

// ---------------------------------------------------------------------------------------------------------------------
// aim
function smartAim(sel: ItemDef | null): [number, number] {
  const p = G.player;
  const ptx = Math.floor(p.x / TS), fty = Math.floor((p.y - 1) / TS), cty = Math.floor((p.y - 11) / TS);
  const tk = toolKindOf(sel?.id);
  const placeMode = !!sel && (sel.kind === 'block' || !!sel.place || (sel.kind === 'fixture' && !!sel.fixture));
  if (placeMode) {
    const d = sel!.kind === 'block' ? 2 : 1;
    return [(ptx + p.face * (1 + d)) * TS + 2, fty * TS + 2];
  }
  const workable = (tx: number, ty: number) => { const m = tileMaterial(tx, ty); return m !== 0 && isFinite(digTime(m, tk)) && (!(mat[(ty * TS + 1) * W + tx * TS + 1] === MAT.FIXTURE)); };
  for (let d = 1; d <= 4; d++) for (const row of [cty, fty, cty - 1, fty + 1]) {
    const tx = ptx + p.face * d;
    if (workable(tx, row)) return [tx * TS + 2, row * TS + 2];
  }
  if (input.moveY > 0.5 || sel?.id === 'shovel') { if (workable(ptx, fty + 1)) return [ptx * TS + 2, (fty + 1) * TS + 2]; }
  const f = fixtureNear(p.x, p.y - 8, 14);
  if (f) return [f.tx * TS + (f.tw * TS) / 2, f.ty * TS + (f.th * TS) / 2];
  return [(ptx + p.face * 2) * TS + 2, cty * TS + 2];
}
function computeAim(sel: ItemDef | null) {
  const p = G.player;
  let ax: number, ay: number;
  if (input.aimMode === 'smart' || !input.hasAim || toolState.smart) {
    [ax, ay] = smartAim(sel);
  } else {
    [ax, ay] = screenToWorld(input.aimX, input.aimY);
    const [sx, sy] = aimSway(G.realTime); ax += sx; ay += sy;
  }
  toolState.aimX = ax; toolState.aimY = ay;
  const cx = p.x, cy = p.y - 11;
  toolState.aimAng = Math.atan2(ay - cy, ax - cx);
  if (Math.abs(ax - p.x) > 3 && !(Math.abs(input.moveX) > 0.2 && Math.sign(input.moveX) !== Math.sign(ax - p.x) && input.aimMode === 'smart')) p.face = ax >= p.x ? 1 : -1;
}

// ---------------------------------------------------------------------------------------------------------------------
// block shapes
function blockCellOn(c: number, r: number, lean: number): boolean {
  if (lean === 0) return true;
  const cc = lean > 0 ? c : 7 - c;                       // lean +1: inner end is the right end
  return (3 - r) >= Math.floor(cc / 2.4);
}
function blockRect(tx: number, ty: number, nearX: number): { x0: number; tx0: number } {
  // extend away from the player; the aimed tile is the near half
  const tx0 = nearX >= tx * TS + 2 ? tx : tx - 1;
  return { x0: tx0 * TS, tx0 };
}
let prevCache = { key: '', t: -9, ok: true, margin: 1, reason: '' as string | undefined };
function previewCells(cells: PreviewCell[], key: string) {
  if (prevCache.key === key && G.realTime - prevCache.t < 0.2) return prevCache;
  const r = supportPreview(cells);
  prevCache = { key, t: G.realTime, ok: r.ok, margin: r.margin, reason: r.reason };
  return prevCache;
}
function rectFree(x0: number, y0: number, w: number, h: number, skip?: (m: number) => boolean): boolean {
  if (x0 < 1 || y0 < 1 || x0 + w >= W - 1 || y0 + h >= H - 1) return false;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const m = mat[y * W + x]; if (WALK[m] && !(skip && skip(m))) return false; }
  return true;
}
function overlapsPlayer(x0: number, y0: number, w: number, h: number): boolean {
  const p = G.player;
  return x0 + w > p.x - p.w / 2 && x0 < p.x + p.w / 2 && y0 + h > p.y - p.h && y0 < p.y;
}

// ---------------------------------------------------------------------------------------------------------------------
// target evaluation (every frame)
const L = (lines: string[], s: string) => { if (s) lines.push(s); };
function evaluate(sel: ItemDef | null, dt: number) {
  const p = G.player;
  const T = TGT;
  computeAim(sel);
  const ax = toolState.aimX, ay = toolState.aimY;
  const tx = Math.floor(ax / TS), ty = Math.floor(ay / TS);
  const [cx, cy] = chest();
  T.tx = tx; T.ty = ty; T.tw = 1; T.th = 1; T.x = ax; T.y = ay; T.mode = 'none'; T.ok = false; T.progress = 0; T.reason = undefined; T.verb = '';
  T.ghostItem = undefined; T.margin = undefined; T.lean = undefined; T.lines.length = 0;
  T.mat = tileMaterial(tx, ty); T.density = null; T.iceCm = null;
  T.fixture = fixtureAtTile(tx, ty);
  const dist = Math.hypot(tx * TS + 2 - cx, ty * TS + 2 - cy);
  T.inReach = dist <= REACH;
  const ptx = Math.floor(cx / TS), pty = Math.floor(cy / TS);
  const sight = T.inReach && los(ptx, pty, tx, ty);
  const tk = toolKindOf(sel?.id);
  const lines = T.lines;

  // ---- probe lines (always) ----
  const raw = mat[(Math.max(0, Math.min(H - 1, Math.floor(ay)))) * W + Math.max(0, Math.min(W - 1, Math.floor(ax)))];
  const m = T.mat || raw;
  const isSnowy = SNOWY[m] === 1;
  if (T.fixture) L(lines, fixtureLabel(T.fixture));
  else if (m !== 0) {
    const md = MATS[m];
    L(lines, md.name);
    if (isSnowy) {
      let sum = 0, n = 0;
      for (let j = 0; j < TS; j++) for (let i = 0; i < TS; i++) { const k = (ty * TS + j) * W + tx * TS + i; if (SNOWY[mat[k]]) { sum += densityOf(MATS[mat[k]].key, aux[k]); n++; } }
      if (n) {
        T.density = Math.round(sum / n);
        const good = T.density >= 250 && T.density <= 380, bad = T.density < 220;
        const col = good ? '#8fe3b0' : bad ? '#ff9a88' : '#ffc46e';
        L(lines, `<span style="color:${col}">` + fmt(S.density, { d: T.density, c: snowClassName(snowClass(T.density)) }) + (good ? ' ✓' : bad ? ' ✗' : '') + '</span>');
      }
    }
    if (m === MAT.ICE) {
      // thickness of the ice layer in this column (needs the chisel to read)
      let up = 0, dn = 0; const X = Math.floor(ax), Y0 = Math.floor(ay);
      while (up < 120 && mat[(Y0 - up - 1) * W + X] === MAT.ICE) up++;
      while (dn < 120 && mat[(Y0 + dn + 1) * W + X] === MAT.ICE) dn++;
      T.iceCm = (up + dn + 1) * 9;
      if (tk === 'chisel') L(lines, fmt(S.iceThick, { cm: T.iceCm }));
    }
  }
  if (!sel || !T.inReach) { if (!T.inReach) T.reason = S.far; }

  // ---- mode by selected item ----
  const id = sel?.id;
  const def = sel ?? null;
  const setPlaceCommon = () => { T.mode = 'place'; T.ghostItem = id; };
  if (!T.inReach) { if (def && (def.kind === 'block' || def.place || def.fixture)) { setPlaceCommon(); T.ok = false; T.reason = S.far; } return finishTarget(T); }
  if (!sight && !T.fixture) { T.reason = S.blocked; if (def && (def.kind === 'block' || def.place || def.fixture)) setPlaceCommon(); return finishTarget(T); }

  if (id === 'snow_block') { evalBlock(T, sel!, tx, ty); return finishTarget(T); }
  if (def?.place) { evalSingle(T, def, tx, ty); return finishTarget(T); }
  if (def?.kind === 'fixture' && def.fixture) {
    setPlaceCommon();
    const pl: Plan = planFixture(def.fixture, tx, ty);
    T.tx = pl.tx; T.ty = pl.ty; T.tw = pl.tw; T.th = pl.th; T.ok = pl.ok; T.reason = pl.reason; T.margin = 1; T.verb = S.place;
    return finishTarget(T);
  }
  if (T.fixture) { T.mode = 'use'; T.ok = true; T.verb = S.use; T.tx = T.fixture.tx; T.ty = T.fixture.ty; T.tw = T.fixture.tw; T.th = T.fixture.th; return finishTarget(T); }

  if (tk === 'knife' && m !== 0 && (m === MAT.PACKED || m === MAT.SNOWBLOCK)) { evalCut(T, tx, ty); return finishTarget(T); }
  if (id === 'shovel' && held.load > 0 && m === 0) {
    T.mode = 'dig'; T.ok = true; T.verb = S.throwSnow; return finishTarget(T);
  }
  if (id === 'fishing_line') { T.mode = 'use'; T.verb = S.use; evalFish(T, tx, ty); return finishTarget(T); }
  if (id === 'harpoon' || id === 'flare_gun') { T.mode = 'attack'; T.ok = true; T.verb = id === 'harpoon' ? S.harpoon : S.use; return finishTarget(T); }
  if (def && (def.food || def.kind === 'wear' || id === 'torch' || id === 'lantern' || id === 'barometer' || id === 'sled' || id === 'flask')) { T.mode = 'use'; T.ok = true; T.verb = S.use; return finishTarget(T); }
  // digging
  if (m !== 0) {
    const t = digTime(m, tk);
    T.mode = tk === 'chisel' && m === MAT.ICE ? 'chisel' : 'dig';
    T.verb = T.mode === 'chisel' ? S.chisel : id === 'shovel' && (m === MAT.SNOW) ? S.scoop : S.dig;
    if (!isFinite(t)) { T.ok = false; T.reason = digReason(m, tk); }
    else T.ok = true;
    if (toolState.dig.tx === tx && toolState.dig.ty === ty) T.progress = toolState.dig.p;
  } else if (mat[(Math.floor(ay)) * W + Math.floor(ax)] === MAT.FIXTURE) { T.mode = 'none'; }
  void dt;
  return finishTarget(T);
}
function finishTarget(T: Target) {
  if (T.reason && T.reason !== S.far) T.lines.push(T.reason);
  else if (T.verb && T.mode !== 'none') T.lines.push(T.verb);
  return T;
}

function evalCut(T: Target, tx: number, ty: number) {
  T.mode = 'cut'; T.verb = S.cut;
  const { tx0 } = blockRect(tx, ty, toolState.aimX);
  const r = cutRegion(tx0, ty);
  T.tx = tx0; T.ty = ty; T.tw = 2; T.th = 1;
  if (toolState.cut.tx === tx0 && toolState.cut.ty === ty) T.progress = toolState.cut.p;
  if (!r.ok) {
    // try the other half
    const alt = cutRegion(tx0 === tx ? tx - 1 : tx, ty);
    if (alt.ok) { T.tx = tx0 === tx ? tx - 1 : tx; return fillCut(T, alt); }
    T.ok = false; T.reason = S.thin; return;
  }
  fillCut(T, r);
}
function fillCut(T: Target, r: { ok: boolean; density: number }) {
  T.density = r.density; T.ok = true;
  T.verb = r.density < 220 ? fmt(S.crumble, { d: r.density }) : fmt(S.cutOk, { d: r.density, c: snowClassName(snowClass(r.density)) });
  if (r.density < 220) T.reason = undefined;
}
/** Is the 2×1 tile region at (tx0,ty) a cuttable block? Returns its mean density. */
export function cutRegion(tx0: number, ty: number): { ok: boolean; density: number } {
  let n = 0, sum = 0;
  for (let j = 0; j < TS; j++) for (let i = 0; i < TS * 2; i++) {
    const k = (ty * TS + j) * W + tx0 * TS + i;
    const m = mat[k];
    if (m === MAT.PACKED || m === MAT.SNOWBLOCK) { n++; sum += densityOf(MATS[m].key, aux[k]); }
  }
  return { ok: n >= 28, density: n ? Math.round(sum / n) : 0 };
}
function evalSingle(T: Target, def: ItemDef, tx: number, ty: number) {
  T.mode = 'place'; T.ghostItem = def.id; T.verb = S.place; T.tw = 1; T.th = 1;
  const x0 = tx * TS, y0 = ty * TS;
  if (!rectFree(x0, y0, TS, TS)) { T.ok = false; T.reason = S.occupied; return; }
  if (overlapsPlayer(x0, y0, TS, TS)) { T.ok = false; T.reason = S.inYou; return; }
  const key = MAT[def.place as keyof typeof MAT];
  const cells: PreviewCell[] = [];
  for (let j = 0; j < TS; j++) for (let i = 0; i < TS; i++) cells.push({ x: x0 + i, y: y0 + j, m: key });
  const r = previewCells(cells, `s${tx},${ty},${def.id}`);
  T.margin = r.margin; T.ok = r.ok; T.reason = r.ok ? undefined : r.reason === 'слишком длинный пролёт' ? S.span : S.noSupport;
}
function evalBlock(T: Target, sel: ItemDef, tx: number, ty: number) {
  T.mode = 'place'; T.ghostItem = sel.id; T.verb = S.place; T.th = 1; T.tw = 2;
  let { tx0 } = blockRect(tx, ty, toolState.aimX);
  const p = G.player;
  const free = (t0: number) => rectFree(t0 * TS, ty * TS, TS * 2, TS) && !overlapsPlayer(t0 * TS, ty * TS, TS * 2, TS);
  if (!free(tx0)) { const alt = tx0 === tx ? tx - 1 : tx; if (free(alt)) tx0 = alt; }
  T.tx = tx0;
  let lean: -1 | 0 | 1 = 0;
  if (toolState.dome) lean = tx0 * TS + 8 < p.x ? 1 : -1;
  toolState.lean = lean; T.lean = lean;
  if (!rectFree(tx0 * TS, ty * TS, TS * 2, TS)) { T.ok = false; T.reason = S.occupied; return; }
  if (overlapsPlayer(tx0 * TS, ty * TS, TS * 2, TS)) { T.ok = false; T.reason = S.inYou; return; }
  const cells: PreviewCell[] = [];
  for (let r = 0; r < TS; r += 1) for (let c = 0; c < TS * 2; c += 1) if (blockCellOn(c, r, lean)) cells.push({ x: tx0 * TS + c, y: ty * TS + r, m: MAT.SNOWBLOCK });
  const r = previewCells(cells, `b${tx0},${ty},${lean}`);
  T.margin = r.margin; T.ok = r.ok;
  T.reason = r.ok ? undefined : r.reason === 'слишком длинный пролёт' ? S.span : S.noSupport;
  if (r.ok) T.verb = `${S.place} · ${S.ok} ${Math.round(r.margin * 100)}%`;
}
function evalFish(T: Target, tx: number, ty: number) {
  const water = mat[(ty * TS + 1) * W + tx * TS + 1] === MAT.WATER && !tileSolid(tx, ty - 1);
  T.ok = water; if (!water) T.reason = S.fishNeedHole;
}

// ---------------------------------------------------------------------------------------------------------------------
// actions
function wearTool(slotIdx: number, amount: number) {
  const s = inv.slots[slotIdx]; if (!s) return;
  const d = getItem(s.id).tool; if (!d || !isFinite(d.dur) || s.dur === undefined) return;
  s.dur -= amount;
  if (s.dur <= 0) { inv.slots[slotIdx] = null; toast(fmt(S.brokeTool, { name: itemName(s.id) }), 'bad'); emit('tool_broke', { id: s.id }); }
}
function clearTile(tx: number, ty: number, only?: (m: number) => boolean): number {
  let n = 0;
  const x0 = tx * TS, y0 = ty * TS;
  for (let j = 0; j < TS; j++) for (let i = 0; i < TS; i++) {
    const k = (y0 + j) * W + x0 + i, m = mat[k];
    if (m === 0 || PHASE[m] > P_POWDER || m === MAT.FIXTURE || m === MAT.BEDROCK) continue;
    if (only && !only(m)) continue;
    mat[k] = 0; aux[k] = 0; flags[k] = 0; n++;
  }
  if (n) { wake(x0, y0); edited(x0, y0, x0 + TS - 1, y0 + TS - 1); }
  return n;
}
function chips(tx: number, ty: number, m: number, n = 5) {
  const rgb = MATS[m]?.color ?? [200, 210, 225];
  burstFx('chip', tx * TS + 2, ty * TS + 2, n, 28, 0.5, (rgb[0] << 16) | (rgb[1] << 8) | rgb[2], 12);
}

function finishDig(T: Target, tk: string, slot: number) {
  const tx = T.tx, ty = T.ty, m = tileMaterial(tx, ty);
  if (m === 0) return;
  const key = MATS[m].key;
  const cells = TS * TS;
  const p = G.player;
  const placed = ((): boolean => { for (let j = 0; j < TS; j++) for (let i = 0; i < TS; i++) if (flags[(ty * TS + j) * W + tx * TS + i] & F_PLACED) return true; return false; })();
  // densities for block refunds
  let dsum = 0, dn = 0;
  if (m === MAT.SNOWBLOCK) for (let j = 0; j < TS; j++) for (let i = 0; i < TS; i++) { const k = (ty * TS + j) * W + tx * TS + i; if (mat[k] === MAT.SNOWBLOCK) { dsum += densityOf('SNOWBLOCK', aux[k]); dn++; } }
  const removed = clearTile(tx, ty, (mm) => digTime(mm, tk) !== Infinity);
  if (!removed) return;
  chips(tx, ty, m);
  const cx = tx * TS + 2, cy = ty * TS + 2;
  if (SNOWY[m]) {
    if (tk === 'shovel') held.load = Math.min(32, held.load + removed);
    else if (tk === 'hand' || tk === 'knife') { if (m === MAT.SNOW || m === MAT.PACKED) spawnDrop('snow', 1, cx, cy); }
    if (m === MAT.SNOWBLOCK && tk === 'knife' && dn) {
      toolState.blockRefund += 0.5; toolState.blockDens = dsum / dn;
      if (toolState.blockRefund >= 1) { toolState.blockRefund -= 1; const left = add('snow_block', 1, Math.round(toolState.blockDens)); if (left) spawnDrop('snow_block', 1, cx, cy, 0, -20, Math.round(toolState.blockDens)); toast(fmt(S.gotBlock, { c: snowClassName(snowClass(toolState.blockDens)) }), 'good'); }
    }
  } else {
    const dr = DROPS[key];
    if (dr) {
      let n = dr[1] >= 1 ? Math.floor(dr[1]) : (Math.random() < dr[1] ? 1 : 0);
      if (placed && dr[1] >= 1) n = 1;
      if (n > 0) { const left = add(dr[0], n); if (left > 0) spawnDrop(dr[0], left, cx, cy, (Math.random() - 0.5) * 24, -26); else emit('picked', { item: dr[0], n }); }
    }
  }
  emit('dug', { mat: m, key, x: cx, y: cy, tx, ty });
  wearTool(slot, SNOWY[m] ? 0.08 : 0.6);
  body.working = 1; void p; void cells;
}

let lastHint = -99;
function doCut(T: Target, dtEff: number, slot: number) {
  const c = toolState.cut;
  if (c.tx !== T.tx || c.ty !== T.ty) { c.tx = T.tx; c.ty = T.ty; c.p = 0; }
  const r = cutRegion(T.tx, T.ty);
  if (!r.ok) { c.p = 0; return; }
  const cls = r.density < 220 ? 0.7 : r.density <= 250 ? 1.2 : r.density <= 380 ? 1 : r.density <= 420 ? 1.4 : 2.2;
  c.p += dtEff / (0.9 * cls);
  body.working = 1;
  if ((toolState.digSnd -= dtEff) <= 0) { toolState.digSnd = 0.22; emit('dig', { mat: MAT.PACKED, x: T.x, y: T.y }); spawnFx('dust', T.tx * TS + 4, T.ty * TS + 2, (Math.random() - 0.5) * 12, -8, 0.4, 0xe6eef8); }
  if (c.p >= 1) {
    c.p = 0;
    const d = r.density;
    for (let k = 0; k < 2; k++) clearTile(T.tx + k, T.ty, (m) => m === MAT.PACKED || m === MAT.SNOWBLOCK);
    chips(T.tx, T.ty, MAT.PACKED, 8); chips(T.tx + 1, T.ty, MAT.PACKED, 8);
    if (d < 220) { toast(S.crumbled, 'warn'); if (G.realTime - lastHint > 25) { lastHint = G.realTime; toast(S.looseHint, 'info'); } spawnDrop('snow', 2, T.tx * TS + 4, T.ty * TS, 0, -18); }
    else {
      const p = G.player;
      const left = add('snow_block', 1, d);
      if (left) spawnDrop('snow_block', 1, p.x, p.y - 12, p.face * 12, -20, d);
      toast(fmt(S.gotBlock, { c: snowClassName(snowClass(d)) }), 'good');
      emit('cut_block', { density: d, cls: snowClass(d) });
    }
    wearTool(slot, 1);
    emit('dug', { mat: MAT.PACKED, key: 'PACKED', x: T.x, y: T.y, tx: T.tx, ty: T.ty });
  }
}

function placeBlock(T: Target) {
  const sel = selected(); if (!sel || sel.id !== 'snow_block') return;
  const dens = sel.dur ?? 300;
  const lean = T.lean ?? 0;
  const ax = auxOfDensity(dens);
  for (let r = 0; r < TS; r++) for (let c = 0; c < TS * 2; c++) {
    if (!blockCellOn(c, r, lean)) continue;
    setCell(T.tx * TS + c, T.ty * TS + r, MAT.SNOWBLOCK, ax, F_PLACED);
  }
  edited(T.tx * TS, T.ty * TS, T.tx * TS + TS * 2, T.ty * TS + TS);
  wake(T.tx * TS, T.ty * TS);
  if (sinterQ.length < 400) sinterQ.push({ x0: T.tx * TS, y0: T.ty * TS, w: TS * 2, t: sinterMinutes(dens) });
  removeFromSlot(inv.sel, 1);
  burstFx('dust', T.tx * TS + 8, T.ty * TS + 2, 5, 14, 0.4, 0xe6eef8);
  emit('placed', { item: 'snow_block', mat: MAT.SNOWBLOCK, x: T.x, y: T.y, lean });
  body.working = 1;
}
function placeSingle(T: Target) {
  const sel = selected(); if (!sel) return;
  const def = getItem(sel.id); if (!def.place) return;
  const m = MAT[def.place as keyof typeof MAT];
  for (let j = 0; j < TS; j++) for (let i = 0; i < TS; i++) setCell(T.tx * TS + i, T.ty * TS + j, m, 0, F_PLACED);
  edited(T.tx * TS, T.ty * TS, T.tx * TS + TS, T.ty * TS + TS);
  removeFromSlot(inv.sel, 1);
  burstFx('dust', T.tx * TS + 2, T.ty * TS + 2, 4, 12, 0.35, 0xdde6ef);
  emit('placed', { item: sel.id, mat: m, x: T.x, y: T.y });
}
function placeFixtureItem(T: Target) {
  const sel = selected(); if (!sel) return;
  const def = getItem(sel.id); if (!def.fixture) return;
  const extra: { fuel?: number; lit?: boolean } = {};
  const f = placeFixture(def.fixture, T.tx, T.ty, extra);
  if (!f) { toast(T.reason ?? S.occupied, 'warn'); return; }
  removeFromSlot(inv.sel, 1);
  emit('placed', { item: sel.id, kind: def.fixture, fixture: f });
}

// shovel
let throwAcc = 0;
function throwSnow(dt: number, T: Target) {
  const p = G.player;
  throwAcc += dt;
  body.working = 0.8;
  while (throwAcc >= 0.035 && held.load > 0) {
    throwAcc -= 0.035;
    const ox = p.x + p.face * 6, oy = p.y - 12;
    const dx = T.x - ox + (Math.random() - 0.5) * 5, dy = T.y - oy + (Math.random() - 0.5) * 4;
    const tf = Math.max(0.14, Math.min(0.55, Math.hypot(dx, dy) / 70));
    const vx = dx / tf, vy = (dy - 0.5 * 230 * tf * tf) / tf;
    throwCell(ox, oy, MAT.SNOW, 100, vx, vy);        // aux 100 = pre-compacted ("disturbed snow sinters faster")
    held.load--;
  }
}
function tamp(dt: number, T: Target) {
  // pat down the snow around the target: raises compaction; at 200 the sim turns it into packed snow
  body.working = 1;
  toolState.tampT += dt;
  if (toolState.tampT < 0.12) return;
  const k = toolState.tampT; toolState.tampT = 0;
  const x0 = (T.tx - 1) * TS, x1 = (T.tx + 2) * TS, y0 = (T.ty - 1) * TS, y1 = (T.ty + 2) * TS;
  let any = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = y * W + x;
    if (mat[i] !== MAT.SNOW) continue;
    const a = Math.min(255, aux[i] + 110 * k);
    if (a >= 200) { mat[i] = MAT.PACKED; aux[i] = 0; flags[i] = 0; } else aux[i] = a;
    any++;
  }
  if (any) { wake(x0, y0); edited(x0, y0, x1, y1); if (Math.random() < 0.5) spawnFx('dust', T.x + (Math.random() - 0.5) * 8, T.y, 0, -6, 0.3, 0xeef4fb); }
}

// harpoon
const hCool = { t: 0 };
function useHarpoon(T: Target, slot: number) {
  const p = G.player;
  if (hCool.t > 0) return;
  hCool.t = 0.9; toolState.swing = 1;
  const ang = toolState.aimAng;
  emit('harpoon', { x: p.x, y: p.y - 11, dir: ang, tx: T.x, ty: T.y });
  // direct hit test against animals along the thrust
  for (const a of G.animals) {
    if (a.state === 'hidden' || a.state === 'dead' || a.kind === 'dog' || a.kind === 'fish') continue;
    const ax = a.x - p.x, ay = a.y - a.h / 2 - (p.y - 11);
    const proj = ax * Math.cos(ang) + ay * Math.sin(ang);
    if (proj < 0 || proj > 24) continue;
    const perp = Math.abs(-ax * Math.sin(ang) + ay * Math.cos(ang));
    if (perp < Math.max(5, a.h / 2)) { a.hp -= 12; emit('animal_hit', { id: a.id, dmg: 12, x: a.x, y: a.y, by: 'harpoon' }); burstFx('blood', a.x, a.y - a.h / 2, 6, 24, 0.5); break; }
  }
  burstFx('dust', p.x + Math.cos(ang) * 14, p.y - 11 + Math.sin(ang) * 14, 3, 10, 0.3, 0xdde6ef);
  wearTool(slot, 0.4);
}
// fishing
function stepFishing(dt: number, T: Target, primaryPressed: boolean, sel: ItemDef | null) {
  const f = toolState.fish;
  if (sel?.id !== 'fishing_line') { f.state = 'idle'; return; }
  if (f.state !== 'idle') body.fineT = Math.max(body.fineT, 0.4);          // bare hands on the line
  if (f.state === 'idle') {
    if (primaryPressed && T.ok && T.inReach) {
      if (G.player.frost.hands >= 80) { toast(S.handsFrozen, 'warn'); return; }
      f.state = 'wait'; f.t = 4 + Math.random() * 11; f.x = T.x; f.y = T.y; toast(S.fishCast, 'info');
      emit('fishing', { x: T.x, y: T.y });
      body.fineT = Math.max(body.fineT, 1);
    } else if (primaryPressed && !T.ok && T.reason) toast(T.reason, 'warn');
  } else if (f.state === 'wait') {
    if (primaryPressed) { f.state = 'idle'; return; }
    f.t -= dt;
    if (f.t <= 0 && fishFallback) { f.state = 'bite'; f.bite = 1.3; toast(S.fishBite, 'good'); emit('fish_bite', { x: f.x, y: f.y }); }
  } else if (f.state === 'bite') {
    f.bite -= dt;
    if (primaryPressed) {
      const n = Math.random() < 0.3 ? 2 : 1;
      const left = add('fish', n); if (left) spawnDrop('fish', left, G.player.x, G.player.y - 12);
      toast(fmt(S.fishGot, { name: itemName('fish') }), 'good'); emit('fish_caught', { n }); f.state = 'idle';
      wearTool(inv.sel, 0.3);
    } else if (f.bite <= 0) { f.state = 'idle'; toast(S.fishLost, 'info'); }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// lights in hand
function stepHeldLight(dt: number, sel: ItemDef | null, primaryPressed: boolean) {
  const gm = dt * MIN_PER_SEC * G.timeScale;
  const s = selected();
  if (sel?.id !== 'torch') held.torchLit = false;
  if (sel?.id !== 'lantern') held.lanternLit = false;
  if (sel?.id === 'torch' && s) {
    if (primaryPressed) {
      if (held.torchLit) { held.torchLit = false; toast(S.torchOut, 'info'); }
      else {
        const p = G.player;
        const nearFire = G.fixtures.some(f => f.lit && Math.hypot(f.tx * TS + f.tw * 2 - p.x, f.ty * TS + f.th * 2 - (p.y - 8)) < 36);
        if (nearFire) { held.torchLit = true; toast(S.torchLit, 'good'); }
        else if (remove('matches', 1)) { held.torchLit = true; toast(S.torchLit, 'good'); }
        else toast(S.noFlame, 'warn');
      }
    }
    if (held.torchLit) { s.dur = (s.dur ?? 60) - gm; if ((s.dur ?? 0) <= 0) { inv.slots[inv.sel] = null; held.torchLit = false; toast(S.torchOut, 'warn'); } }
  }
  if (sel?.id === 'lantern' && s) {
    if (primaryPressed) {
      if (held.lanternLit) { held.lanternLit = false; toast(S.lanternOff, 'info'); }
      else {
        if ((s.dur ?? 0) <= 0 && remove('diesel', 1)) s.dur = 360;
        if ((s.dur ?? 0) > 0) { held.lanternLit = true; toast(S.lanternOn, 'good'); } else toast(S.lanternEmpty, 'warn');
      }
    }
    if (held.lanternLit) { s.dur = (s.dur ?? 0) - gm; if ((s.dur ?? 0) <= 0) { if (remove('diesel', 1)) s.dur = 360; else { held.lanternLit = false; toast(S.lanternEmpty, 'warn'); } } }
  }
  shelterExtra.flames = (held.torchLit ? 1.2 : 0) + (held.lanternLit ? 0.3 : 0);
  // flares
  for (let i = toolState.flares.length - 1; i >= 0; i--) {
    const f = toolState.flares[i]; f.t -= dt; f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 6 * dt;
    if (f.t > 20 && Math.random() < 0.5) spawnFx('spark', f.x, f.y, (Math.random() - 0.5) * 10, 10, 0.6, 0xff4030);
    if (f.t <= 0) toolState.flares.splice(i, 1);
  }
}
/** Lights carried by the player (torch, lantern, personal glow, flares) and the body's faint light. */
const hl: Light[] = [{ x: 0, y: 0, r: 0, g: 0, b: 0, rad: 0 }, { x: 0, y: 0, r: 0, g: 0, b: 0, rad: 0 }, { x: 0, y: 0, r: 0, g: 0, b: 0, rad: 0 }];
const flarePool: Light[] = [];
export function collectHeldLights(out: Light[]) {
  const p = G.player; if (!p) return;
  const fl = 0.92 + 0.08 * Math.sin(G.realTime * 17);
  const a = hl[0]; a.x = p.x; a.y = p.y - 12; a.r = 0.42; a.g = 0.46; a.b = 0.55; a.rad = 3.2; out.push(a);   // faint personal light
  if (held.torchLit) { const l = hl[1]; l.x = p.x + p.face * 5; l.y = p.y - 15; l.r = 1.0 * fl; l.g = 0.66 * fl; l.b = 0.32 * fl; l.rad = 8; out.push(l); }
  else if (held.lanternLit) { const l = hl[1]; l.x = p.x + p.face * 4; l.y = p.y - 11; l.r = 1.0; l.g = 0.82; l.b = 0.5; l.rad = 11; out.push(l); }
  for (let i = 0; i < toolState.flares.length; i++) {
    const f = toolState.flares[i];
    const l = flarePool[i] ?? (flarePool[i] = { x: 0, y: 0, r: 0, g: 0, b: 0, rad: 0 });
    l.x = f.x; l.y = f.y; l.r = 1.0; l.g = 0.2; l.b = 0.12; l.rad = 22 * Math.min(1, f.t / 3); out.push(l);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// main step
export function stepTools(dt: number) {
  const p = G.player; if (!p) return;
  hCool.t = Math.max(0, hCool.t - dt);
  toolState.swing = Math.max(0, toolState.swing - dt * 3.5);
  body.working = Math.max(0, body.working - dt * 4);
  if (G.paused) { held.using = false; return; }
  stepSinter(dt * MIN_PER_SEC * G.timeScale);
  if (!p.alive) { held.using = false; return; }
  if (p.sleeping) { return; }
  // hotbar / wheel / toggles
  if (input.hotbar >= 0 && input.hotbar < BELT) select(input.hotbar);
  if (input.scroll !== 0) select(inv.sel + input.scroll);
  const sel0 = selected();
  if (input.smartToggle) {
    if (sel0 && (sel0.id === 'snow_block')) { toolState.dome = !toolState.dome; toast(toolState.dome ? S.domeOn : S.domeOff, 'info'); }
    else { toolState.smart = !toolState.smart; toast(toolState.smart ? S.smartOn : S.smartOff, 'info'); }
  }
  if (input.ventPressed) toggleParka();
  const sel = sel0 ? getItem(sel0.id) : null;
  const T = evaluate(sel, dt);
  setCameraLook(Math.max(-30, Math.min(30, (toolState.aimX - p.x) * 0.2)), Math.max(-16, Math.min(16, (toolState.aimY - p.y + 11) * 0.15)));

  const pressed = input.primaryPressed, down = input.primary;
  const hf = handsFactor() * (p.energy < 15 ? 0.8 : 1);
  held.using = false;
  stepHeldLight(dt, sel, pressed);
  stepFishing(dt, T, pressed, sel);

  // eat / drink / equip / misc use (selected item)
  if (sel && sel0 && !T.fixture) {
    if (sel.food) {
      if (down) { toolState.eatP += dt / 0.7; held.using = true; if (toolState.eatP >= 1) { toolState.eatP = 0; if (!eatSlot(inv.sel)) toast(S.cantEat, 'info'); } } else toolState.eatP = 0;
    } else if (pressed && sel.kind === 'wear') { if (equip(inv.sel)) toast(fmt(S.equipped, { name: itemName(sel.id) }), 'info'); }
    else if (pressed && sel.id === 'barometer') toast(fmt(S.barometer, { t: G.forecast.text }), 'info');
    else if (pressed && sel.id === 'sled') { hitchSled(p.x, p.y); remove('sled', 1); toast(S.sled, 'info'); }
    else if (pressed && sel.id === 'flask') eatSlot(inv.sel);
  } else toolState.eatP = 0;
  if (sel?.id === 'flare_gun' && pressed) {
    if (remove('flare', 1)) {
      const a = toolState.aimAng; toolState.flares.push({ x: p.x, y: p.y - 14, vx: Math.cos(a) * 60, vy: Math.sin(a) * 60 - 40, t: 28 });
      toast(S.flareShot, 'good'); emit('flare', { x: p.x, y: p.y - 14 }); toolState.swing = 1;
    } else toast(S.flareNone, 'warn');
  }
  if (sel?.id === 'harpoon' && pressed) useHarpoon(T, inv.sel);

  // dig / cut / place / throw
  const act = down && T.inReach;
  if (act) {
    const tk = toolKindOf(sel?.id);
    if (T.mode === 'cut' && T.ok) { doCut(T, dt * hf, inv.sel); held.using = true; toolState.swing = Math.max(toolState.swing, 0.5); }
    else if (T.mode === 'place' && pressed && T.ok && sel) {
      if (sel.id === 'snow_block') placeBlock(T);
      else if (sel.place) placeSingle(T);
      else if (sel.fixture) placeFixtureItem(T);
    } else if (T.mode === 'place' && pressed && !T.ok && T.reason) toast(T.reason, 'warn');
    else if ((T.mode === 'dig' || T.mode === 'chisel') && sel?.id === 'shovel' && held.load > 0 && T.verb === S.throwSnow && (pressed || toolState.throwing)) { toolState.throwing = true; throwSnow(dt, T); held.using = true; toolState.swing = Math.max(toolState.swing, 0.6); }
    else if (T.mode === 'dig' && sel?.id === 'shovel' && T.verb === S.throwSnow) { /* load in the blade: release and press again to throw */ }
    else if ((T.mode === 'dig' || T.mode === 'chisel') && T.ok && T.mat) {
      const m = T.mat;
      const st = toolState.dig;
      if (st.tx !== T.tx || st.ty !== T.ty || st.mat !== m) { st.tx = T.tx; st.ty = T.ty; st.mat = m; st.p = 0; }
      const t = digTime(m, tk);
      st.p += (dt * hf) / t; T.progress = st.p; held.using = true; body.working = 1; toolState.swing = Math.max(toolState.swing, 0.55);
      if ((toolState.digSnd -= dt) <= 0) { toolState.digSnd = Math.min(0.3, t * 0.5); emit('dig', { mat: m, x: T.x, y: T.y }); if (!SNOWY[m]) chips(T.tx, T.ty, m, 2); }
      if (st.p >= 1) { st.p = 0; finishDig(T, tk, inv.sel); }
    } else if (T.mode === 'dig' && !T.ok && pressed && T.reason) toast(T.reason, 'warn');
  } else {
    toolState.throwing = false;
    // progress decays when not working
    toolState.dig.p = Math.max(0, toolState.dig.p - dt * 1.5); toolState.cut.p = Math.max(0, toolState.cut.p - dt * 1.5);
  }
  // tamp snow with the shovel (RMB hold / Q? / E fallback handled below)
  if (sel?.id === 'shovel' && input.secondaryHeld && T.inReach) { tamp(dt, T); held.using = true; }

  // interact (E)
  if (input.interactPressed) interactAction(T, sel0 ? sel0.id : null);
  if (input.eatPressed) eatBest();
  if (input.dropPressed) dropAction(T);
  T.progress = Math.max(T.progress, toolState.dig.tx === T.tx && toolState.dig.ty === T.ty ? toolState.dig.p : 0, toolState.cut.tx === T.tx && toolState.cut.ty === T.ty ? toolState.cut.p : 0);
}

function interactAction(T: Target, selId: string | null) {
  const p = G.player;
  // dead player's backpack / loot on the ground handled by the magnet; fixtures first
  let f: Fixture | null = null;
  if (T.fixture && Math.hypot(T.fixture.tx * TS + T.fixture.tw * 2 - p.x, T.fixture.ty * TS + T.fixture.th * 2 - (p.y - 8)) < 56) f = T.fixture;
  if (!f) f = fixtureNear(p.x, p.y - 8, 18, (o) => !!FIXTURE_DEFS[o.kind] && o.kind !== 'table' && o.kind !== 'workbench' && !(o.kind === 'hide_door' && false));
  if (f && fxInteract(f)) return;
  if (dogInteract()) return;
  if (sledNear(p.x, p.y - 4)) { hitchSled(p.x, p.y); toast(S.sledUp, 'info'); return; }
  // shovel load -> bag it
  if (selId === 'shovel' && held.load >= 8) {
    const n = Math.floor(held.load / 8); held.load -= n * 8;
    const left = add('snow', n); if (left) spawnDrop('snow', left, p.x, p.y - 8);
    toast(fmt(S.bagged, { n }), 'info'); return;
  }
  if (selId === 'shovel' && T.inReach) { tamp(0.2, T); return; }
  if (selId === 'torch') return;
  // eat when nothing else
  void tryLight;
}
function dropAction(T: Target) {
  const p = G.player;
  const f = T.fixture ?? fixtureNear(p.x, p.y - 8, 14);
  if (f) {
    if (stash(f)) return;
    if (pickupFixture(f)) return;
  }
  const s = selected();
  // G with a dragged sled and nothing else to drop: park the sled (its load stays on it)
  if (inv.sled?.hitched && (!s || getItem(s.id).kind === 'tool')) { unhitchSled(p.x - p.face * 14, inv.sled.y); toast(S.sledDown, 'info'); return; }
  if (!s) return;
  const out = removeFromSlot(inv.sel, getItem(s.id).stack > 1 ? s.n : 1); if (!out) return;
  const d = spawnDrop(out.id, out.n, p.x + p.face * 8, p.y - 12, p.face * 40, -30, out.dur);
  if (d) d.age = -1.4;
}

// ---------------------------------------------------------------------------------------------------------------------
// drops
const box = { x: 0, y: 0, vx: 0, vy: 0, w: 3, h: 3, onGround: false };
export function stepDrops(dt: number) {
  const p = G.player;
  const arr = G.drops;
  for (let i = arr.length - 1; i >= 0; i--) {
    const d = arr[i];
    d.age += dt;
    box.x = d.x; box.y = d.y; box.vx = d.vx; box.vy = d.vy + 300 * dt; box.onGround = false;
    if (box.vy > 200) box.vy = 200;
    // magnet
    let picked = false;
    if (p && p.alive && d.age > 0.35) {
      const dx = p.x - d.x, dy = p.y - 8 - d.y, dist = Math.hypot(dx, dy);
      if (dist < 5.5) picked = true;
      else if (dist < 20) { const k = (20 - dist) * 14; box.vx += (dx / dist) * k * dt * 3; box.vy += (dy / dist) * k * dt * 3 - 300 * dt * 0.7; }
    }
    if (picked) {
      if (d.item === 'backpack') { if (openBackpack(d.id)) { arr.splice(i, 1); toast(S.backpack, 'good'); emit('respawn_pack', {}); continue; } else continue; }
      const dur = dropDur.get(d.id);
      const left = add(d.item, d.n, dur);
      if (left < d.n) { emit('picked', { item: d.item, n: d.n - left }); if (left === 0) { toast(fmt(S.picked, { name: itemName(d.item) + (d.n > 1 ? ' ×' + d.n : '') }), 'info'); } }
      if (/^note/.test(d.item) && left === 0) emit('note_found', { id: d.item });
      if (left <= 0) { dropDur.delete(d.id); arr.splice(i, 1); continue; }
      d.n = left;
    }
    const r = moveBox(box as never, dt, { stepUp: 0 });
    void r;
    d.x = box.x; d.y = box.y; d.vx = box.onGround ? box.vx * 0.8 : box.vx; d.vy = box.onGround ? 0 : box.vy;
    if (d.item === 'backpack' ? d.y > H - 2 : (d.age > 900 || d.y > H - 2)) { dropDur.delete(d.id); if (d.item === 'backpack') backpacks.delete(d.id); arr.splice(i, 1); }
  }
  if (arr.length > MAX_DROPS) arr.length = MAX_DROPS;
}

// ---------------------------------------------------------------------------------------------------------------------
/** Info for draw.ts drawPlayer. */
export function heldInfo(out: { item: string | null; aim: number; swing: number; using: boolean; load?: number }) {
  const s = selected();
  out.item = s ? s.id : null; out.aim = toolState.aimAng; out.swing = toolState.swing; out.using = held.using; out.load = held.load / 32;
  return out;
}
export { backpacks };
void count; void boxFree; void fixtureName; void tempAt; void F_FIXTURE; void shade;
