// Group 2 of DESIGN §17 («Ориентиры и безопасность», «Свет и сигналы»), agent U2. Use actions of the items defined in items_b.ts:
// compass (targets, marks, HUD in ui/compass.ts), binoculars (camera look-ahead ×2, animal markers when there is light), probe pole (six tiles of ice
// scan and a 3-second overlay), ice cleats (friction and walking speed through gearMods, read by player.ts), smoke flare (a 3-minute marker that
// counts as an icebreaker signal, emits 'flare' {smoke:true}), whistle (the husky comes; hold = stay).
// The flare gun and the lantern live in tools.ts (their flight, light and wind are tuned there). Imported by tools.ts after useitems_a.
import { G, toast } from './state';
import { emit, on } from './bus';
import { strings, fmt } from '../content/i18n';
import { registerUse, onUseStep, sget, sset } from './useitems';
import { inv, count, remove } from './inventory';
import { body } from './player';
import { fauna, aiOf } from './fauna';
import { LOC, worldInfo } from './locations';
import { W, H, TS, mat } from '../engine/grid';
import { WALK, MAT } from '../content/materials';
import { addLayer } from '../engine/render';
import { setCameraLook } from '../engine/camera';
import { spawnFx } from '../engine/particles';
import { toolState } from './tools';
import { gearMods } from './items_b';
import { showCompass } from '../ui/compass';
import '../art/icons_use2';

const S = strings('useB', {
  // compass
  cmpTip: 'Компас: нажми — следующая цель (станция, шхуна, сигнальный холм, дым, метки). Держи 0,6 с — отметить здесь метку.',
  cmpLabel: 'Цель', cmpNext: 'Цель: {name}', cmpMark: 'Метка {n} поставлена здесь', cmpNone: 'Нет целей',
  cmpStation: 'Станция', cmpShip: 'Шхуна «Заря»', cmpSummit: 'Сигнальный холм', cmpSmoke: 'Дым', cmpMarkN: 'Метка {n}',
  // binoculars
  binTip: 'Бинокль: держи ЛКМ — камера смотрит вдаль в два раза дальше. При свете луны, сияния или в сумерках видны звери на большом расстоянии.',
  binLabel: 'Смотреть', binHold: 'Держи ЛКМ: смотреть вдаль', binDark: 'Темно: видно только рядом',
  // probe pole
  prTip: 'Шест-щуп: тыкни в снег перед собой. На шесть шагов покажет толщину льда, полыньи и пустоты под снегом. Три секунды видно на снегу.',
  prLabel: 'Ткнуть', prSafe: 'Впереди лёд {cm} см: держит', prIce: 'Впереди лёд {cm} см: терпимо, но тонко',
  prThin: 'На {n}-м шаге впереди лёд {cm} см: тонкий, не ходи', prHole: 'На {n}-м шаге впереди полынья: чистая вода',
  prVoid: 'На {n}-м шаге впереди лёд над пустотой', prBridge: 'На {n}-м шаге впереди снежный мост над провалом',
  prGround: 'Впереди не лёд: земля или камень', prNone: 'Впереди ничего не нащупал',
  // cleats
  clTip: 'Ледоступы: пристёгиваются к ботинкам или валенкам. Нажми, чтобы пристегнуть или снять.',
  clLabel: 'Пристегнуть', clNeedBoots: 'Ледоступы крепятся к обуви: сначала надень ботинки или валенки',
  clOn: 'Ледоступы пристёгнуты', clOff: 'Ледоступы сняты', clNoteOn: 'пристёгнуты', clNoteOff: 'сняты',
  // smoke
  smTip: 'Дымовая шашка: зажги — густой дым стоит три минуты и виден издалека днём и в сумерках. Ледокол принимает его как сигнал.',
  smLabel: 'Поджечь', smLit: 'Дымовая шашка горит: дым виден издалека, три минуты', smNote: 'дымит {t} с',
  // whistle
  whTip: 'Свисток: свистни — Север прибежит и пойдёт за тобой. Держи — пусть ждёт на месте.',
  whLabel: 'Свистнуть', whCome: 'Свисток: Север бежит к тебе', whStay: 'Свисток: Север, ждать здесь', whNoDog: 'Севера рядом нет, некому свистеть',
  whStayNote: 'ждёт', whFollowNote: 'идёт за тобой',
});

// ---------------------------------------------------------------------------------------------------------------------------- shared state
/** Module state (not saved): what is burning, what is lit, what the probe shows. Persistent bits go through sget / sset (saved with the body). */
export const smoke = { t: 0, x: 0, y: 0 };
export const bino = { on: false, t: -9, lx: 0, ly: 0 };
export const probe: { until: number; cells: { x: number; y: number; w: number; h: number; col: string }[] } = { until: -1, cells: [] };
on('new_game', () => { smoke.t = 0; bino.on = false; probe.until = -1; probe.cells = []; });

/** Hold timers of the items that react to a long press: the hold ends when the press is not seen for 0.15 s. */
const holdT = { compass: { t: 0, last: -9, done: false }, whistle: { t: 0, last: -9, stayed: false } };
const liveHold = (h: { last: number }) => G.realTime - h.last < 0.15;

// ---------------------------------------------------------------------------------------------------------------------------- compass
export interface Target { key: string; name: string; x: number; y: number }
/** The targets in order: station, ship, signal hill, the smoke (while it burns), then the player's marks (up to three). */
export function compassTargets(): Target[] {
  const out: Target[] = [];
  const st = LOC.station;
  out.push({ key: 'station', name: S.cmpStation, x: (st.x0 + st.x1) / 2, y: st.y });
  const sh = worldInfo.spots.ship; if (sh && (sh.x || sh.y)) out.push({ key: 'ship', name: S.cmpShip, x: sh.x, y: sh.y });
  const sf = worldInfo.spots.signalFire; if (sf && (sf.x || sf.y)) out.push({ key: 'summit', name: S.cmpSummit, x: sf.x, y: sf.y });
  if (smoke.t > 0) out.push({ key: 'smoke', name: S.cmpSmoke, x: smoke.x, y: smoke.y });
  for (let k = 0; k < 3; k++) if (sget('mkOn' + k)) out.push({ key: 'mark' + k, name: fmt(S.cmpMarkN, { n: k + 1 }), x: sget('mkx' + k), y: sget('mky' + k) });
  return out;
}
/** The selected target (clamped), or null when there is none. */
function selected(list = compassTargets()): { t: Target; i: number } | null {
  if (!list.length) return null;
  const i = sget('cmpSel') % list.length;
  return { t: list[i], i };
}
/** Mark the player's spot as a new target (three marks, the oldest is overwritten). */
export function markHere() {
  const p = G.player; if (!p) return;
  const k = sget('mkI') % 3;
  sset('mkx' + k, Math.round(p.x)); sset('mky' + k, Math.round(p.y)); sset('mkOn' + k, 1); sset('mkI', k + 1);
  const list = compassTargets(), idx = list.findIndex(t => t.key === 'mark' + k);
  if (idx >= 0) sset('cmpSel', idx);
  toast(fmt(S.cmpMark, { n: k + 1 }), 'good'); emit('compass_mark', { x: p.x, y: p.y });
}
const metres = (dx: number, dy: number) => Math.round(Math.hypot(dx, dy) * 0.09);            // 1 cell ~ 9 cm (devhud.ts uses the same)

onUseStep(() => {
  const p = G.player;
  const has = count('compass') > 0;
  if (!has || !p || !p.alive || G.paused) { showCompass(null); return; }
  const s = selected();
  if (!s) { showCompass(null); return; }
  showCompass({
    name: s.t.name, dx: s.t.x - p.x, dy: s.t.y - p.y, m: metres(s.t.x - p.x, s.t.y - p.y), i: s.i, n: compassTargets().length,
    storm: G.storm > 0.25 || G.visibility < 0.6,
  });
});

registerUse('compass', {
  label: S.cmpLabel, tip: S.cmpTip, cool: 0.3,
  note: () => {
    const p = G.player, s = p ? selected() : null;
    return s && p ? `${s.t.name} · ${metres(s.t.x - p.x, s.t.y - p.y)} м` : S.cmpNone;
  },
  use() {
    const list = compassTargets(); if (!list.length) { toast(S.cmpNone, 'info'); return false; }
    const i = (sget('cmpSel') + 1) % list.length; sset('cmpSel', i);
    toast(fmt(S.cmpNext, { name: list[i].name }), 'info'); emit('compass_target', { name: list[i].name });
    return true;
  },
  hold(dt) {
    const h = holdT.compass; h.t += dt; h.last = G.realTime;
    if (!h.done && h.t >= 0.6) { h.done = true; markHere(); }
  },
  tick() { const h = holdT.compass; if (!liveHold(h)) { h.t = 0; h.done = false; } },
});

// ---------------------------------------------------------------------------------------------------------------------------- binoculars
const KIND_COL: Record<string, string> = { seal: '#e8f4ff', fox: '#ff9a4a', bear: '#ff5a4a', dog: '#8cf5a8', ptarmigan: '#ffe27a' };
/** How much light the sky gives now: the moon, the aurora, the twilight (0..1). */
export const binoLight = (): number => Math.max(G.daylight, G.moon * 0.7, G.aurora * 0.6);
/** Animal markers the binoculars show: far (170 cells) when there is light, only near (60 cells) in the dark. */
export function animalMarkers(): { x: number; y: number; kind: string }[] {
  const p = G.player; if (!p) return [];
  const R = binoLight() > 0.12 ? 170 : 60;
  const out: { x: number; y: number; kind: string }[] = [];
  for (const a of G.animals) {
    if (a.state === 'hidden' || a.state === 'dead' || a.kind === 'fish') continue;
    if (Math.hypot(a.x - p.x, a.y - p.y) > R) continue;
    out.push({ x: a.x, y: a.y - a.h / 2, kind: a.kind });
  }
  return out;
}
registerUse('binoculars', {
  label: S.binLabel, tip: S.binTip, cool: 0.2,
  use() { toast(S.binHold, 'info'); return true; },
  hold() {
    const p = G.player; if (!p) return;
    // the camera look-ahead (tools.ts sets it every frame to the aim, this runs after it and doubles it)
    const ax = toolState.aimX - p.x, ay = toolState.aimY - (p.y - 11);
    bino.lx = Math.max(-60, Math.min(60, ax * 0.4)); bino.ly = Math.max(-32, Math.min(32, ay * 0.3));
    setCameraLook(bino.lx, bino.ly);
    bino.t = G.realTime;
    if (binoLight() <= 0.12 && !sget('binDarkT')) { sset('binDarkT', 1); toast(S.binDark, 'info'); }
  },
  tick() { bino.on = G.realTime - bino.t < 0.12; },
});
addLayer(126, (ctx, v) => {
  if (!bino.on) return;
  ctx.save(); ctx.lineWidth = 1.2;
  for (const m of animalMarkers()) {
    const x = m.x - v.x0, y = m.y - v.y0;
    ctx.strokeStyle = KIND_COL[m.kind] ?? '#ffffff';
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
});

// ---------------------------------------------------------------------------------------------------------------------------- probe pole
export interface Reading { k: number; kind: 'none' | 'ground' | 'hole' | 'bridge' | 'void' | 'thin' | 'ice' | 'safe'; cm: number; y0: number; y1: number }
const SNOWISH = (m: number) => m === MAT.SNOW || m === MAT.PACKED || m === MAT.SNOWBLOCK;
/** The six tiles ahead: for each tile column the surface, the snow crust, the ice (9 cm per cell, as tools.ts reads it) and what lies under it. */
export function scanAhead(): Reading[] {
  const p = G.player, out: Reading[] = [];
  if (!p) return out;
  const ptx = Math.floor(p.x / TS);
  for (let k = 1; k <= 6; k++) {
    const tx = ptx + p.face * k; if (tx < 1 || tx >= W / TS - 1) break;
    const x = tx * TS + 2;
    let y = Math.max(1, Math.floor(p.y) - 8);
    while (y < H - 2 && !(WALK[mat[y * W + x]] || mat[y * W + x] === MAT.WATER)) y++;
    if (y >= H - 2) { out.push({ k, kind: 'none', cm: 0, y0: 0, y1: 0 }); continue; }
    const top = y;
    if (mat[y * W + x] === MAT.WATER) { out.push({ k, kind: 'hole', cm: 0, y0: top, y1: top + 4 }); continue; }
    let snow = 0; while (y < H - 1 && SNOWISH(mat[y * W + x])) { y++; snow++; }
    const iceTop = y; let ice = 0; while (y < H - 1 && mat[y * W + x] === MAT.ICE) { y++; ice++; }
    const below = mat[Math.min(H - 1, y) * W + x];
    const cm = ice * 9;
    if (ice === 0) {
      if (snow > 0 && (below === 0 || below === MAT.WATER)) out.push({ k, kind: 'bridge', cm: 0, y0: top, y1: iceTop - 1 });
      else out.push({ k, kind: 'ground', cm: 0, y0: top, y1: top });
    } else if (below === 0) out.push({ k, kind: 'void', cm, y0: iceTop, y1: y - 1 });
    else if (cm < 18) out.push({ k, kind: 'thin', cm, y0: iceTop, y1: y - 1 });
    else out.push({ k, kind: cm >= 30 ? 'safe' : 'ice', cm, y0: iceTop, y1: y - 1 });
  }
  return out;
}
const COL_OK = 'rgba(120,230,150,0.5)', COL_MID = 'rgba(255,200,90,0.6)', COL_BAD = 'rgba(255,90,80,0.72)';
/** The one sentence the probe says (the nearest bad reading first, else the first ice). */
export function probeSummary(rs: Reading[]): { text: string; kind: 'good' | 'warn' | 'bad' | 'info' } {
  const bad = rs.find(r => r.kind === 'hole' || r.kind === 'void' || r.kind === 'bridge' || r.kind === 'thin');
  if (bad) {
    if (bad.kind === 'hole') return { text: fmt(S.prHole, { n: bad.k }), kind: 'bad' };
    if (bad.kind === 'void') return { text: fmt(S.prVoid, { n: bad.k }), kind: 'bad' };
    if (bad.kind === 'bridge') return { text: fmt(S.prBridge, { n: bad.k }), kind: 'bad' };
    return { text: fmt(S.prThin, { n: bad.k, cm: bad.cm }), kind: 'bad' };
  }
  const ice = rs.find(r => r.kind === 'safe' || r.kind === 'ice');
  if (ice) return ice.kind === 'safe' ? { text: fmt(S.prSafe, { cm: ice.cm }), kind: 'good' } : { text: fmt(S.prIce, { cm: ice.cm }), kind: 'warn' };
  if (rs.some(r => r.kind === 'ground')) return { text: S.prGround, kind: 'info' };
  return { text: S.prNone, kind: 'info' };
}
registerUse('probe_pole', {
  label: S.prLabel, tip: S.prTip, cool: 0.6,
  use() {
    const rs = scanAhead(), p = G.player;
    probe.cells = [];
    if (p) for (const r of rs) {
      if (r.kind === 'none' || r.kind === 'ground') continue;
      // the column of the tile: its ice (or water, or the gap under the crust) from the surface down, and a white line on the surface
      const tx = Math.floor(p.x / TS) + p.face * r.k, col = r.kind === 'safe' ? COL_OK : r.kind === 'ice' ? COL_MID : COL_BAD;
      const gap = r.kind === 'void' || r.kind === 'hole' || r.kind === 'bridge' ? 6 : 0;
      probe.cells.push({ x: tx * TS, y: r.y0, w: TS, h: Math.max(6, r.y1 - r.y0 + 1 + gap), col });
      probe.cells.push({ x: tx * TS, y: r.y0, w: TS, h: 1, col: '#ffffff' });
    }
    probe.until = G.realTime + 3;
    const s = probeSummary(rs); toast(s.text, s.kind);
    return true;
  },
});
addLayer(128, (ctx, v) => {
  const left = probe.until - G.realTime; if (left <= 0 || !probe.cells.length) return;
  ctx.save(); ctx.globalAlpha = Math.min(1, left / 0.6);
  for (const c of probe.cells) { ctx.fillStyle = c.col; ctx.fillRect(c.x - v.x0, c.y - v.y0, c.w, c.h); }
  ctx.restore();
});

// ---------------------------------------------------------------------------------------------------------------------------- ice cleats
registerUse('ice_cleats', {
  label: S.clLabel, tip: S.clTip, cool: 0.5,
  note: () => (sget('cleats') ? S.clNoteOn : S.clNoteOff),
  use() {
    if (!inv.wear.feet) { toast(S.clNeedBoots, 'warn'); return false; }
    const on = !sget('cleats'); sset('cleats', on ? 1 : 0);
    toast(on ? S.clOn : S.clOff, 'good'); emit('cleats', { on });
    return true;
  },
  tick() {
    // gearMods is read by player.ts next frame: bare ice grips (friction x10 of 0.1), glare ice (wind-scoured, wind > 3) is faster,
    // soft snow slows the walk (the spikes clog)
    let fric = 1, speed = 1;
    const p = G.player;
    if (p && sget('cleats') && count('ice_cleats') > 0 && inv.wear.feet) {
      if (body.feetMat === MAT.ICE) { fric = 10; speed = Math.abs(G.wind) > 3 ? 1.12 : 1; }
      else if (body.feetMat === MAT.SNOW) speed = 0.88;
    }
    gearMods.fric = fric; gearMods.speed = speed;
  },
});

// ---------------------------------------------------------------------------------------------------------------------------- smoke flare
registerUse('smoke_flare', {
  label: S.smLabel, tip: S.smTip, cool: 1,
  note: () => (smoke.t > 0 ? fmt(S.smNote, { t: Math.ceil(smoke.t) }) : ''),
  use() {
    const p = G.player; if (!p || !remove('smoke_flare', 1)) return false;
    smoke.t = 180; smoke.x = p.x; smoke.y = p.y - 12;
    toast(S.smLit, 'good'); emit('flare', { x: smoke.x, y: smoke.y, smoke: true });
    return true;
  },
  tick(dt) {
    if (smoke.t <= 0) return;
    smoke.t -= dt;
    // a dense column: puffs rise (about 90 cells in 7 s) and drift with the wind; pale enough to show against the twilight sky
    for (let k = 0; k < 2; k++) if (Math.random() < dt * 9) {
      const wind = G.wind * 1.2 + (Math.random() - 0.5) * 2;
      spawnFx('smoke', smoke.x + (Math.random() - 0.5) * 3, smoke.y, wind, -(12 + Math.random() * 6), 6 + Math.random() * 3, [176, 180, 190], 3);
    }
  },
});

// ---------------------------------------------------------------------------------------------------------------------------- whistle
/** A short tap calls the husky (he comes and follows); holding 0.4 s makes him stay where he is. Uses the AI record that fauna.ts exports (aiOf). */
registerUse('whistle', {
  label: S.whLabel, tip: S.whTip, cool: 0.5,
  note: () => { const d = fauna.dog, a = d ? aiOf(d) : undefined; return a?.stay ? S.whStayNote : S.whFollowNote; },
  use() {
    const d = fauna.dog, a = d ? aiOf(d) : undefined;
    if (!d || !a || d.state === 'dead') { toast(S.whNoDog, 'warn'); return false; }
    a.stay = false; a.fetch = undefined; a.hold = 0; a.t = 0;
    if (d.state === 'sleep') { d.state = 'sit'; d.t = 0; }                // he lifts his head (what fauna's setState does); the AI takes it from here
    holdT.whistle.stayed = false;
    toast(S.whCome, 'good'); emit('whistle', { stay: false });
    return true;
  },
  hold(dt) {
    const h = holdT.whistle; h.t += dt; h.last = G.realTime;
    const d = fauna.dog, a = d ? aiOf(d) : undefined;
    if (!h.stayed && h.t >= 0.4 && d && a && d.state !== 'dead') { a.stay = true; h.stayed = true; toast(S.whStay, 'info'); emit('whistle', { stay: true }); }
  },
  tick() { const h = holdT.whistle; if (!liveHold(h)) { h.t = 0; h.stayed = false; } },
});
