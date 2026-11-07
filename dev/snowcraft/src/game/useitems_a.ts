// Use actions of the group 1 items (DESIGN §17): thermos, flask (freezing), hand_warmer, bandage, spirit, frost_balm, snow_goggles (snow blindness), belt_pouch, big_pack, sack.
// Items are defined in items_a.ts. Every effect hooks into the body model through usemods.ts (read by player.ts) or changes p.core / p.water / frost directly.
import { G, toast, type Fixture } from './state';
import { emit } from './bus';
import { strings, fmt } from '../content/i18n';
import { registerUse, onUseStep, sget, sset } from './useitems';
import { mods } from './usemods';
import { inv, add, remove, count, spawnDrop, SACK_KINDS, SACK_MAX, sackKind, sackN, sackDur, settleExtras, hasPouch, hasBigPack, NSLOT, BELT, TOTAL } from './inventory';
import { body } from './player';
import { nearStation, heated } from './fixtures';
import { MIN_PER_SEC } from './weather';
import { itemName } from './items';

const S = strings('useA', {
  // thermos
  thLabel: 'Отпить', thTip: 'Термос: налей горячей воды или чая у огня, чайника или котелка (пустой термос + использовать). Три глотка: греют и поят, тепло держится около шести часов.',
  thNoSource: 'Нечем наполнить: нужен горячий чайник, котелок с тёплой водой или вода и огонь рядом',
  thFilled: 'Налил в термос: {n} глотк.', thSip: 'Глоток горячего: тепло разливается', thSipCold: 'Глоток остывшего: вода, но не греет',
  thFull: 'Пить не хочется', thCooled: 'Термос остыл: вода ещё есть, но уже не греет',
  // flask
  flFroze: 'Вода во фляге замёрзла! Спрячь её в сумку (под парку) или поставь к огню', flThawed: 'Во фляге оттаяло',
  // notes
  nEmpty: 'пусто', nSips: 'глотков {n}', nHot: 'горячо', nCold: 'остыл', nLeftH: 'тлеет ещё {h} ч', nOut: 'не горит', nCharges: 'раз: {n}', nContent: '{name} ×{n} из {m}',
  // warmer
  hwTip: 'Грелка: положи в неё уголь и разожги у огня. Пока она горит и лежит в сумке, руки и лицо мёрзнут медленнее, руки отогреваются.',
  hwNeed: 'Нужен уголь и горящий огонь рядом', hwLit: 'Грелка тлеет: на {h} ч тепла', hwStatus: 'Грелка горит ещё {h} ч', hwOut: 'Грелка прогорела: нужен новый уголь',
  // bandage / spirit
  bdTip: 'Бинт: стань с обмороженной частью тела и используй. Если в сумке есть спирт, обработает им: лечит вдвое лучше.',
  bdNone: 'Лечить нечего: ни обморожения, ни шрама', bdDone: 'Перевязал: {part}', bdDoneSp: 'Обработал спиртом и перевязал: {part}',
  partHands: 'руки', partFeet: 'ноги', partFace: 'лицо',
  spLabel: 'Выпить', spTip: 'Спирт: для ран и обморожений вместе с бинтом. Если выпить, кажется, что согрелся, но тело теряет тепло быстрее: так замерзают насмерть.',
  spDrink: 'Обожгло горло, стало жарко... но это обман: тело остывает',
  // balm
  bmLabel: 'Намазаться', bmTip: 'Жир-мазь: натри руки и лицо перед выходом на мороз, обморожение пойдёт на 40 % медленнее около двух часов.',
  bmUsed: 'Намазал руки и лицо: на два часа', bmLeft: 'осталось {n}', bmEmpty: 'Банка пуста',
  // goggles
  gTip: 'Очки: носи на лице. Без них в яркий день снег слепит, а в буран позёмка бьёт в лицо.',
  gBlind: 'Слепит снег: глаза режет. Надень очки или уйди в тень',
  gBlind2: 'Снежная слепота: почти ничего не видно!',
  // pouch, pack
  pcTip: 'Поясной подсумок: пока он в сумке, на поясе три быстрых ячейки (клавиши 7, 8, 9).',
  pcUse: 'Подсумок на поясе: три быстрых ячейки (клавиши 7, 8, 9)',
  bpTip: 'Усиленный рюкзак: пока он в сумке, шесть дополнительных мест и ещё 20 кг груза, но потеешь на 20 % сильнее.',
  bpUse: 'Рюкзак: ещё шесть мест и +20 кг, потеешь сильнее',
  // sack
  skTip: 'Мешок: насыпь сыпучее (снег, лёд, уголь, ягель) до 12 штук: вес вдвое меньше. Использовать снова: досыпать или высыпать. Мокрый снег мочит одежду.',
  skLoaded: 'В мешок: {name} ×{n}', skEmpty: 'Нечего насыпать: нужен снег, лёд, уголь или ягель', skDump: 'Высыпал: {name} ×{n}', skWet: 'Мокрый снег в мешке промочил одежду',
});
const gm = (dt: number) => dt * G.timeScale * MIN_PER_SEC;           // game minutes in dt real seconds
const FIRES = ['campfire', 'stove', 'brazier', 'fat_lamp', 'signal_fire'] as const;
const litFire = () => { const p = G.player; return nearStation([...FIRES], p.x, p.y - 6, 5, true); };
const slotsOf = (id: string): number[] => { const r: number[] = []; for (let i = 0; i < TOTAL; i++) if (inv.slots[i]?.id === id) r.push(i); return r; };

// ---------------------------------------------------------------------------------------------------------------------------------- thermos
const TH = 1000, HEAT_MAX = 360;                                              // dur = sips * 1000 + heat minutes
const thSips = (d?: number) => Math.floor((d ?? 0) / TH), thHeat = (d?: number) => (d ?? 0) % TH;
function fillSource(): { sips: number; heat: number } | null {
  const p = G.player;
  const near = (kind: string, r: number, pred: (f: Fixture) => boolean): Fixture | null => {
    let best: Fixture | null = null, bd = r * r;
    for (const f of G.fixtures) {
      if (f.kind !== kind || !pred(f)) continue;
      const dx = Math.max(f.tx * 4 - p.x, 0, p.x - (f.tx + f.tw) * 4), dy = Math.max(f.ty * 4 - (p.y - 6), 0, (p.y - 6) - (f.ty + f.th) * 4);
      const d = dx * dx + dy * dy; if (d <= bd) { bd = d; best = f; }
    }
    return best;
  };
  const k = near('kettle', 24, f => Number(f.data?.hot ?? 0) > 0);
  if (k) { const n = Math.min(3, Number(k.data!.hot)); k.data!.hot = Number(k.data!.hot) - n; return { sips: n, heat: HEAT_MAX }; }
  const pot = near('pot', 24, f => Number(f.data?.water ?? 0) > 0 && !!heated(f));
  if (pot) { const n = Math.min(3, Math.floor(Number(pot.data!.water))); if (n > 0) { pot.data!.water = Number(pot.data!.water) - n; return { sips: n, heat: HEAT_MAX }; } }
  const tea = Math.min(3, count('hot_tea'));
  if (tea > 0) { remove('hot_tea', tea); return { sips: tea, heat: HEAT_MAX - 40 }; }
  if (count('water') > 0 && litFire()) { const n = Math.min(3, count('water')); remove('water', n); return { sips: n, heat: HEAT_MAX }; }
  return null;
}
registerUse('thermos', {
  note: s => (thSips(s.dur) <= 0 ? S.nEmpty : fmt(S.nSips, { n: thSips(s.dur) }) + ', ' + (thHeat(s.dur) > 0 ? S.nHot : S.nCold)),
  label: S.thLabel, tip: S.thTip, cool: 0.6,
  use(_i, c) {
    const p = G.player, s = c.stack; const sips = thSips(s.dur), heat = thHeat(s.dur);
    if (sips <= 0) {
      const src = fillSource();
      if (!src) { toast(S.thNoSource, 'warn'); return false; }
      s.dur = src.sips * TH + src.heat; toast(fmt(S.thFilled, { n: src.sips }), 'good'); emit('thermos_fill', {}); return true;
    }
    if (p.water > 97 && p.core > 36.8) { toast(S.thFull, 'info'); return false; }
    p.water = Math.min(100, p.water + 8);
    if (heat > 0) { sset('thPool', sget('thPool') + 0.34 * Math.min(1, heat / 60)); toast(S.thSip, 'good'); } else toast(S.thSipCold, 'info');
    s.dur = (sips - 1) * TH + heat; emit('drank', { item: 'thermos' });
    return true;
  },
  tick(dt) {
    const p = G.player;
    for (const i of slotsOf('thermos')) {
      const s = inv.slots[i]!, h = thHeat(s.dur);
      if (h > 0 && thSips(s.dur) > 0) { const nh = Math.max(0, h - gm(dt)); s.dur = thSips(s.dur) * TH + nh; if (nh <= 0) toast(S.thCooled, 'info'); }
    }
    const pool = sget('thPool');
    if (pool > 0) { const a = Math.min(pool, dt / 60 * G.timeScale); p.core = Math.min(38, p.core + a); sset('thPool', pool - a); }
  },
});

// ---------------------------------------------------------------------------------------------------------------------------------- flask: freezing
// Water in a flask that rides on the belt (outside the parka) freezes after ~25 real minutes at -25 C; in the bag (inside the parka) it does not. Frozen: dur += 100.
onUseStep((rdt) => {
  const p = G.player, dt = rdt;
  let cold = sget('flaskCold'), exposed = false, any = false;
  for (const i of slotsOf('flask')) {
    const s = inv.slots[i]!; const d = s.dur ?? 0;
    const onBelt = i < BELT || i >= NSLOT;
    if (d >= 50) {                                                               // frozen: thaws in the bag (body heat) or near a fire
      any = true;
      const warm = p.airT > 3 || !!litFire();
      const th = sget('flaskThaw') + (warm ? (litFire() ? 1 / 15 : 1 / 60) : !onBelt ? 1 / 150 : 0) * dt * G.timeScale;
      if (th >= 1) { s.dur = d - 100; sset('flaskThaw', 0); toast(S.flThawed, 'good'); } else sset('flaskThaw', th);
    } else if (d > 0 && onBelt) exposed = true;
  }
  if (exposed && p.airT < -8) cold += Math.max(0, (-p.airT - 5) / 20) * dt * G.timeScale;
  else cold = Math.max(0, cold - dt * 3 * G.timeScale);
  if (cold >= 1500) {
    for (const i of slotsOf('flask')) { const s = inv.slots[i]!; if ((s.dur ?? 0) > 0 && (s.dur ?? 0) < 50 && (i < BELT || i >= NSLOT)) s.dur = (s.dur ?? 0) + 100; }
    cold = 0; toast(S.flFroze, 'bad'); void any;
  }
  sset('flaskCold', cold);
});

// ---------------------------------------------------------------------------------------------------------------------------------- hand warmer
registerUse('hand_warmer', {
  note: s => ((s.dur ?? 0) > 0 ? fmt(S.nLeftH, { h: Math.round((s.dur ?? 0) / 6) / 10 }) : S.nOut),
  tip: S.hwTip, cool: 0.6,
  use(_i, c) {
    const s = c.stack;
    if ((s.dur ?? 0) > 0) { toast(fmt(S.hwStatus, { h: Math.round((s.dur ?? 0) / 6) / 10 }), 'info'); return true; }
    if (count('coal') < 1 || !litFire()) { toast(S.hwNeed, 'warn'); return false; }
    remove('coal', 1); s.dur = 240; toast(fmt(S.hwLit, { h: 4 }), 'good'); emit('hand_warmer_lit', {}); return true;
  },
  tick(dt) {
    let burning = false;
    for (const i of slotsOf('hand_warmer')) {
      const s = inv.slots[i]!; if ((s.dur ?? 0) <= 0) continue;
      s.dur = Math.max(0, (s.dur ?? 0) - gm(dt)); if (s.dur <= 0) toast(S.hwOut, 'info'); else burning = true;
    }
    if (burning) { mods.frostHands *= 0.4; mods.frostFace *= 0.75; mods.warmHands += 0.14; }
  },
});

// ---------------------------------------------------------------------------------------------------------------------------------- bandage, spirit
const partName = (k: string) => (k === 'hands' ? S.partHands : k === 'feet' ? S.partFeet : S.partFace);
registerUse('bandage', {
  tip: S.bdTip,
  use() {
    const p = G.player; let best: 'hands' | 'feet' | 'face' | null = null, score = 0;
    for (const k of ['hands', 'feet', 'face'] as const) {
      if (p.frost[k] < 40 && body.scar[k] <= 0) continue;
      const v = p.frost[k] + body.scar[k] * 1.6; if (v > score) { score = v; best = k; }
    }
    if (!best) { toast(S.bdNone, 'info'); return false; }
    const bitten = p.frost[best] >= 80 || body.scar[best] >= 14;
    const sp = bitten && count('spirit') > 0;
    remove('bandage', 1); if (sp) remove('spirit', 1);
    const eff = sp ? 1 : 0.6;
    body.scar[best] = Math.max(0, body.scar[best] - 16 * eff);
    p.frost[best] = Math.max(body.scar[best], p.frost[best] - 38 * eff);
    toast(fmt(sp ? S.bdDoneSp : S.bdDone, { part: partName(best) }), 'good'); emit('bandage', { part: best, spirit: sp });
    return true;
  },
});
registerUse('spirit', {
  label: S.spLabel, tip: S.spTip, cool: 1,
  use() {
    const p = G.player; remove('spirit', 1);
    sset('spPool', sget('spPool') + 0.9); p.water = Math.max(0, p.water - 2);
    toast(S.spDrink, 'warn'); emit('drank', { item: 'spirit' }); return true;
  },
  tick(dt) {
    const pool = sget('spPool'); if (pool <= 0) return;
    const a = Math.min(pool, dt / 60 * G.timeScale); G.player.core -= a; sset('spPool', pool - a);
  },
});

// ---------------------------------------------------------------------------------------------------------------------------------- frost balm
registerUse('frost_balm', {
  note: s => fmt(S.nCharges, { n: s.dur ?? 0 }),
  label: S.bmLabel, tip: S.bmTip, cool: 1,
  use(i, c) {
    const s = c.stack; if ((s.dur ?? 0) <= 0) { toast(S.bmEmpty, 'info'); return false; }
    s.dur = (s.dur ?? 0) - 1; sset('balmT', 120);
    toast(S.bmUsed + ' (' + fmt(S.bmLeft, { n: s.dur }) + ')', 'good');
    if (s.dur <= 0) inv.slots[i] = null;
    return true;
  },
  tick(dt) {
    const t = sget('balmT'); if (t <= 0) return;
    sset('balmT', Math.max(0, t - gm(dt))); mods.frostHands *= 0.6; mods.frostFace *= 0.6;
  },
});

// ---------------------------------------------------------------------------------------------------------------------------------- goggles & snow blindness
let glareEl: HTMLDivElement | null = null, tintEl: HTMLDivElement | null = null;
function overlay(glare: number, tint: number) {
  if (typeof document === 'undefined') return;
  if (!glareEl) {
    glareEl = document.createElement('div'); tintEl = document.createElement('div');
    const base = 'position:fixed;inset:0;pointer-events:none;z-index:4;transition:opacity .4s;opacity:0;';
    glareEl.style.cssText = base + 'background:radial-gradient(ellipse at 50% 45%,rgba(255,255,255,.55),rgba(255,255,255,.96) 75%)';
    tintEl.style.cssText = base + 'background:rgba(255,196,110,.16);mix-blend-mode:multiply';
    glareEl.id = 'snowblind'; tintEl.id = 'goggletint';
    document.body.appendChild(glareEl); document.body.appendChild(tintEl);
  }
  glareEl.style.opacity = String(Math.max(0, Math.min(0.92, (glare - 0.25) * 1.3)));
  tintEl!.style.opacity = String(tint);
}
onUseStep((rdt) => {
  const p = G.player; const worn = inv.wear.face === 'snow_goggles';
  const outside = p.shelter < 0.3 && p.inWater < 0.5;
  let target = outside ? Math.max(0, Math.min(1, (G.daylight - 0.4) / 0.5)) : 0;
  if (worn) target *= 0.08;
  let g = sget('glare');
  const dt = rdt * G.timeScale;
  g = target > g ? Math.min(target, g + dt / 150) : Math.max(target, g - dt / 45);
  sset('glare', g); mods.glare = g;
  if (g > 0.5 && !sget('glareW')) { sset('glareW', 1); toast(S.gBlind, 'warn'); }
  if (g > 0.85 && sget('glareW') < 2) { sset('glareW', 2); toast(S.gBlind2, 'bad'); }
  if (g < 0.2) sset('glareW', 0);
  if (g > 0.6) mods.frostFace *= 1;               // (the eyes, not the skin: the penalty is the white-out below)
  if (worn && G.storm > 0.3 && outside) mods.frostFace *= 0.85;
  overlay(g, worn && outside && G.daylight > 0.4 ? 1 : 0);
});

// ---------------------------------------------------------------------------------------------------------------------------------- belt pouch, big pack
registerUse('belt_pouch', { tip: S.pcTip, use() { toast(S.pcUse, 'info'); return true; } });
registerUse('big_pack', {
  tip: S.bpTip, use() { toast(S.bpUse, 'info'); return true; },
  tick() { if (hasBigPack()) mods.sweat *= 1.2; },
});
onUseStep(() => { settleExtras(); void hasPouch; });

// ---------------------------------------------------------------------------------------------------------------------------------- sack
registerUse('sack', {
  note: s => (sackKind(s.dur) ? fmt(S.nContent, { name: itemName(SACK_KINDS[sackKind(s.dur)]), n: sackN(s.dur), m: SACK_MAX }) : S.nEmpty),
  tip: S.skTip, cool: 0.5,
  use(_i, c) {
    const s = c.stack; let k = sackKind(s.dur), n = sackN(s.dur);
    if (k === 0) {                                                            // pick the bulk material we carry most of
      let best = 0, bn = 0;
      for (let q = 1; q < SACK_KINDS.length; q++) { const m = count(SACK_KINDS[q]); if (m > bn) { bn = m; best = q; } }
      if (!best) { toast(S.skEmpty, 'warn'); return false; }
      k = best;
    }
    const id = SACK_KINDS[k];
    const room = SACK_MAX - n, have = count(id);
    if (room > 0 && have > 0) {
      const t = Math.min(room, have); remove(id, t); n += t; s.dur = sackDur(k, n);
      toast(fmt(S.skLoaded, { name: itemName(id), n }), 'good'); emit('sack_fill', { id }); return true;
    }
    if (n > 0) {                                                              // full or nothing more to add: pour it out
      s.dur = 0; const left = add(id, n);
      if (left > 0) { const p = G.player; spawnDrop(id, left, p.x, p.y - 10, p.face * 30, -24); }
      toast(fmt(S.skDump, { name: itemName(id), n }), 'info'); emit('sack_dump', { id }); return true;
    }
    toast(S.skEmpty, 'warn'); return false;
  },
  tick(dt) {
    let snow = 0;
    for (let i = 0; i < NSLOT; i++) { const s = inv.slots[i]; if (s?.id === 'sack' && sackKind(s.dur) === 1) snow += sackN(s.dur); }
    if (snow > 0) {
      const p = G.player; if (p.wet < 0.38) { p.wet = Math.min(0.38, p.wet + dt * 0.004 * snow / 12 * G.timeScale); if (!sget('skWet') && p.wet > 0.15) { sset('skWet', 1); toast(S.skWet, 'info'); } }
    } else sset('skWet', 0);
  },
});
