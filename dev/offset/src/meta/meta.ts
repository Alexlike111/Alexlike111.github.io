// Persistent progression: ink bank, forms (permanent upgrades), catalogue unlocks, tirage tiers, proofs (achievements), daily sheet, stats, settings.
import type { L } from '../core/i18n';
import type { Stats } from '../game/types';
import { UPGRADES } from '../game/upgrades';
import { bus } from '../core/bus';

export interface Form { id: string; branch: 'jump' | 'press' | 'paper'; name: L; desc: L; max: number; cost: (lvl: number) => number; icon: string; apply(s: Stats, lvl: number): void }
const F = (id: string, branch: Form['branch'], icon: string, max: number, base: number, grow: number, name: L, desc: L, apply: (s: Stats, lvl: number) => void): Form =>
  ({ id, branch, icon, max, name, desc, apply, cost: (lvl) => Math.round(base * Math.pow(grow, lvl) / 5) * 5 });
export const FORMS: Form[] = [
  F('f_range', 'jump', 'range', 5, 30, 1.55, { ru: 'Дальность', en: 'Range' }, { ru: '+4% дальности прыжка за уровень', en: '+4% jump range per level' }, (s, l) => { s.range *= 1 + 0.04 * l; }),
  F('f_recharge', 'jump', 'recharge', 4, 45, 1.6, { ru: 'Сушка', en: 'Drying' }, { ru: 'Заряды быстрее на 5% за уровень', en: 'Charges 5% faster per level' }, (s, l) => { s.recharge *= 1 - 0.05 * l; }),
  F('f_charge', 'jump', 'charge', 1, 420, 1, { ru: 'Четвёртая форма', en: 'Fourth Plate' }, { ru: '+1 заряд прыжка навсегда', en: '+1 jump charge, permanently' }, (s, l) => { s.charges += l; }),
  F('f_focus', 'jump', 'focus', 3, 40, 1.7, { ru: 'Выдержка', en: 'Exposure' }, { ru: '+15% времени замедления за уровень', en: '+15% slow-motion time per level' }, (s, l) => { s.focus *= 1 + 0.15 * l; }),
  F('f_strike', 'press', 'strike', 5, 30, 1.55, { ru: 'Давление', en: 'Pressure' }, { ru: '+7% силы и урона удара за уровень', en: '+7% strike force & damage per level' }, (s, l) => { s.strikeDmg *= 1 + 0.07 * l; s.strikeForce *= 1 + 0.05 * l; }),
  F('f_burst', 'press', 'burst', 4, 40, 1.6, { ru: 'Вытеснение', en: 'Displacement' }, { ru: '+8% ударной волны прибытия за уровень', en: '+8% arrival shockwave per level' }, (s, l) => { s.burstDmg *= 1 + 0.08 * l; s.burstImpulse *= 1 + 0.08 * l; s.burstR *= 1 + 0.03 * l; }),
  F('f_heavy', 'press', 'heavyR', 3, 60, 1.7, { ru: 'Объём', en: 'Volume' }, { ru: '+8% сферы тяжёлого прыжка за уровень', en: '+8% heavy jump sphere per level' }, (s, l) => { s.heavyR *= 1 + 0.08 * l; }),
  F('f_throw', 'press', 'throw', 3, 35, 1.6, { ru: 'Рычаг', en: 'Leverage' }, { ru: '+8% броска и +25% подъёмной массы за уровень', en: '+8% throw & +25% carry mass per level' }, (s, l) => { s.throwV *= 1 + 0.08 * l; s.carryMass *= 1 + 0.25 * l; }),
  F('f_hp', 'paper', 'hp', 2, 150, 2.6, { ru: 'Плотность', en: 'Stock Weight' }, { ru: '+1 к запасу прочности за уровень', en: '+1 max durability per level' }, (s, l) => { s.maxHp += l; }),
  F('f_ink', 'paper', 'ink', 5, 35, 1.6, { ru: 'Насыщенность', en: 'Saturation' }, { ru: '+8% краски за уровень', en: '+8% ink per level' }, (s, l) => { s.inkMult *= 1 + 0.08 * l; }),
  F('f_reroll', 'paper', 'reroll', 2, 90, 2.2, { ru: 'Пересмотр', en: 'Second Proof' }, { ru: '+1 пересдача мутаций за тираж', en: '+1 mutation reroll per run' }, () => { }),
  F('f_revive', 'paper', 'dupe', 1, 600, 1, { ru: 'Страховой экземпляр', en: 'File Copy' }, { ru: 'Одна перепечатка за тираж', en: 'One reprint per run' }, (s, l) => { if (l) s.revive = 1; }),
];
export const FORM_BY_ID: Record<string, Form> = Object.fromEntries(FORMS.map((f) => [f.id, f]));

export interface Proof { id: string; name: L; desc: L; reward: number; /** progress 0..goal from stats */ goal: number; stat: keyof MetaStats | ''; }
export interface MetaStats {
  runs: number; wins: number; bestRoom: number; kills: number; killsWorld: number; killsThrow: number; killsFall: number; killsBowling: number; killsBullet: number; killsBlast: number;
  jumps: number; heavyJumps: number; chunks: number; bestCombo: number; inkTotal: number; flawless: number; bossKills: number; dailyWins: number; bestTier: number; carried: number; playTime: number;
}
const P = (id: string, stat: Proof['stat'], goal: number, reward: number, name: L, desc: L): Proof => ({ id, stat, goal, reward, name, desc });
export const PROOFS: Proof[] = [
  P('p_first', 'jumps', 1, 10, { ru: 'Первый сдвиг', en: 'First Offset' }, { ru: 'Соверши прыжок', en: 'Make a jump' }),
  P('p_jumps', 'jumps', 500, 60, { ru: 'Не на месте', en: 'Out of Place' }, { ru: '500 прыжков', en: '500 jumps' }),
  P('p_heavy', 'heavyJumps', 25, 50, { ru: 'С вещами на выход', en: 'Take It With You' }, { ru: '25 тяжёлых прыжков', en: '25 heavy jumps' }),
  P('p_carry', 'carried', 100, 60, { ru: 'Грузчик', en: 'Mover' }, { ru: 'Унеси с собой 100 тел и обломков', en: 'Carry 100 bodies and chunks along' }),
  P('p_kills', 'kills', 100, 60, { ru: 'Вне приводки', en: 'Out of Register' }, { ru: 'Сними с тиража 100 охотников', en: 'Retire 100 hunters' }),
  P('p_kills2', 'kills', 1000, 250, { ru: 'Макулатура', en: 'Pulp' }, { ru: 'Сними с тиража 1000 охотников', en: 'Retire 1000 hunters' }),
  P('p_world', 'killsWorld', 50, 80, { ru: 'Мир — это оружие', en: 'The World Is a Weapon' }, { ru: '50 убийств стенами и обломками', en: '50 kills with walls and debris' }),
  P('p_fall', 'killsFall', 20, 80, { ru: 'Высота сброса', en: 'Drop Height' }, { ru: '20 убийств падением', en: '20 kills by falling' }),
  P('p_throw', 'killsThrow', 20, 70, { ru: 'Возврат отправителю', en: 'Return to Sender' }, { ru: '20 убийств броском', en: '20 kills by throwing' }),
  P('p_bowl', 'killsBowling', 10, 80, { ru: 'Кегли', en: 'Ninepins' }, { ru: '10 убийств охотником об охотника', en: '10 kills hunter-into-hunter' }),
  P('p_bullet', 'killsBullet', 10, 90, { ru: 'Дружественный набор', en: 'Friendly Typesetting' }, { ru: '10 убийств их же пулями', en: '10 kills with their own slugs' }),
  P('p_chunks', 'chunks', 5000, 120, { ru: 'Под снос', en: 'Demolition' }, { ru: 'Разрушь 5000 кусков мира', en: 'Break 5000 pieces of the world' }),
  P('p_combo', 'bestCombo', 10, 80, { ru: 'Серия', en: 'Run-on' }, { ru: 'Комбо ×10', en: 'Reach a 10 combo' }),
  P('p_flawless', 'flawless', 10, 90, { ru: 'Без помарок', en: 'No Errata' }, { ru: '10 листов без урона', en: '10 sheets without damage' }),
  P('p_room5', 'bestRoom', 5, 50, { ru: 'Пол-тиража', en: 'Half the Run' }, { ru: 'Дойди до 5-го листа', en: 'Reach sheet 5' }),
  P('p_boss', 'bossKills', 1, 150, { ru: 'Правка внесена', en: 'Correction Made' }, { ru: 'Победи Корректора', en: 'Defeat the Proofreader' }),
  P('p_win3', 'wins', 3, 150, { ru: 'Переиздание', en: 'Reissue' }, { ru: 'Заверши 3 тиража', en: 'Finish 3 runs' }),
  P('p_tier3', 'bestTier', 3, 200, { ru: 'Третий тираж', en: 'Third Printing' }, { ru: 'Заверши тираж III', en: 'Finish tirage III' }),
  P('p_daily', 'dailyWins', 3, 120, { ru: 'Ежедневник', en: 'Daily Paper' }, { ru: 'Заверши 3 ежедневных листа', en: 'Finish 3 daily sheets' }),
  P('p_ink', 'inkTotal', 5000, 200, { ru: 'Чернильница', en: 'Inkwell' }, { ru: 'Собери 5000 краски', en: 'Collect 5000 ink' }),
];
export const TIER_MAX = 8;
export const TIER_MODS: L[] = [
  { ru: 'Базовый тираж', en: 'Base printing' },
  { ru: 'Охотники крепче на 20%', en: 'Hunters 20% tougher' },
  { ru: 'Больше элитных охотников', en: 'More elite hunters' },
  { ru: 'Охотники быстрее на 12%', en: 'Hunters 12% faster' },
  { ru: 'Якоря появляются чаще', en: 'Anchors appear more often' },
  { ru: 'На лист больше охотников', en: 'More hunters per sheet' },
  { ru: 'Починка выпадает вдвое реже', en: 'Repairs drop half as often' },
  { ru: 'Охотники крепче ещё на 25%', en: 'Hunters another 25% tougher' },
];
export interface Settings { lang: 'ru' | 'en' | ''; master: number; sfx: number; music: number; shake: number; haptics: boolean; lefty: boolean; autoAim: boolean; quality: 0 | 1 | 2 }
export interface Save {
  v: 1; ink: number; forms: Record<string, number>; unlocked: string[]; proofs: string[]; tier: number; stats: MetaStats; settings: Settings;
  daily: { day: number; done: boolean; best: number; streak: number; lastWin: number }; tutorial: number; seenUpgrades: string[]; lastRun: number;
}
const KEY = 'offset.save.v1';
const zeroStats = (): MetaStats => ({ runs: 0, wins: 0, bestRoom: 0, kills: 0, killsWorld: 0, killsThrow: 0, killsFall: 0, killsBowling: 0, killsBullet: 0, killsBlast: 0, jumps: 0, heavyJumps: 0, chunks: 0, bestCombo: 0, inkTotal: 0, flawless: 0, bossKills: 0, dailyWins: 0, bestTier: 0, carried: 0, playTime: 0 });
const fresh = (): Save => ({ v: 1, ink: 0, forms: {}, unlocked: [], proofs: [], tier: 1, stats: zeroStats(), settings: { lang: '', master: 0.9, sfx: 1, music: 0.7, shake: 1, haptics: true, lefty: false, autoAim: true, quality: 2 }, daily: { day: 0, done: false, best: 0, streak: 0, lastWin: 0 }, tutorial: 0, seenUpgrades: [], lastRun: 0 });
export const dayNumber = (d = new Date()) => Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);

export class Meta {
  s: Save;
  constructor() { this.s = this.load(); const d = dayNumber(); if (this.s.daily.day !== d) { if (this.s.daily.lastWin < d - 1) this.s.daily.streak = 0; this.s.daily = { ...this.s.daily, day: d, done: false, best: 0 }; this.save(); } }
  private load(): Save {
    try { const raw = localStorage.getItem(KEY); if (raw) { const o = JSON.parse(raw); if (o && o.v === 1) { const f = fresh(); return { ...f, ...o, stats: { ...f.stats, ...o.stats }, settings: { ...f.settings, ...o.settings }, daily: { ...f.daily, ...o.daily } }; } } } catch { /* corrupted or blocked storage → fresh */ }
    return fresh();
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.s)); } catch { /* storage unavailable */ } }
  reset() { this.s = fresh(); this.save(); }
  get ink() { return this.s.ink; }
  formLevel(id: string) { return this.s.forms[id] ?? 0; }
  formCost(id: string) { const f = FORM_BY_ID[id]; const l = this.formLevel(id); return l >= f.max ? -1 : f.cost(l); }
  buyForm(id: string): boolean { const c = this.formCost(id); if (c < 0 || this.s.ink < c) { bus.emit('uiDeny', {}); return false; } this.s.ink -= c; this.s.forms[id] = this.formLevel(id) + 1; this.save(); bus.emit('uiBuy', {}); return true; }
  isUnlocked(id: string) { return this.s.unlocked.includes(id); }
  buyUnlock(id: string): boolean { const u = UPGRADES.find((x) => x.id === id); if (!u || !u.locked || this.isUnlocked(id) || this.s.ink < (u.unlockCost ?? 0)) { bus.emit('uiDeny', {}); return false; } this.s.ink -= u.unlockCost ?? 0; this.s.unlocked.push(id); this.save(); bus.emit('uiBuy', {}); return true; }
  get unlockedSet() { return new Set(this.s.unlocked); }
  get rerolls() { return 1 + this.formLevel('f_reroll'); }
  applyForms(st: Stats) { for (const f of FORMS) { const l = this.formLevel(f.id); if (l > 0) f.apply(st, l); } }
  get maxTier() { return Math.min(TIER_MAX, this.s.stats.bestTier + 1); }
  proofProgress(p: Proof) { return p.stat ? Math.min(p.goal, this.s.stats[p.stat]) : 0; }
  /** check achievements; returns newly earned */
  checkProofs(): Proof[] {
    const out: Proof[] = [];
    for (const p of PROOFS) if (!this.s.proofs.includes(p.id) && p.stat && this.s.stats[p.stat] >= p.goal) { this.s.proofs.push(p.id); this.s.ink += p.reward; out.push(p); bus.emit('achievement', { id: p.id }); }
    if (out.length) this.save(); return out;
  }
  bump(k: keyof MetaStats, n = 1) { this.s.stats[k] += n; }
  best(k: keyof MetaStats, v: number) { if (v > this.s.stats[k]) this.s.stats[k] = v; }
  /** cheapest thing the player could buy next (for the "next goal" hint) */
  nextGoal(): { name: L; cost: number } | null {
    let best: { name: L; cost: number } | null = null;
    for (const f of FORMS) { const c = this.formCost(f.id); if (c > 0 && (!best || c < best.cost)) best = { name: f.name, cost: c }; }
    for (const u of UPGRADES) if (u.locked && !this.isUnlocked(u.id) && (!best || (u.unlockCost ?? 0) < best.cost)) best = { name: u.name, cost: u.unlockCost ?? 0 };
    return best;
  }
}
