// Daily missions panel (+ 7-day login calendar), the menu button with its badge, and the garage paint shop
// (free colours, premium paints, liveries). HTML strings + one action router; ui.ts only forwards clicks here.
import './daily.css';
import { CONFIG } from '../config';
import { t } from '../i18n';
import { carIdOr } from '../meta/cars';
import { LIVERIES, PAINTS, PREMIUM_BASE, buyCosmetic, cosmeticsOf, equipCosmetic, liveryFor, owns, priceOf, type Item } from '../meta/cosmetics';
import {
  LOGIN_REWARDS, MISSIONS_PER_DAY, claimLogin, claimMission, dailyOf, dayNumber, isComplete, loginAvailable,
  missionsForDay, nextStreakDay, progressValue, unclaimedCount, withDaily,
} from '../meta/daily';
import { paintHex } from '../render/paintLayer';
import type { SaveData } from '../types';
import { carSvg } from './garage';
import { icon } from './icons';

const esc = (s: string | number): string =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const hex = (c: number): string => '#' + c.toString(16).padStart(6, '0');
const today = (): number => dayNumber(new Date());

// ------------------------------------------------------------------------------------------------ menu button + badge
export function badgeCount(s: SaveData, day = today()): number {
  const d = dailyOf(s);
  return unclaimedCount(d, day) + (loginAvailable(d, day) ? 1 : 0);
}

export function missionsButtonHtml(s: SaveData): string {
  const n = badgeCount(s);
  return `<button class="btn purple daily-btn" data-act="missions" aria-label="${esc(t('daily.title'))}">${icon('trophy')}<span>${esc(t('menu.missions'))}</span>${n > 0 ? `<i class="d-badge" aria-label="${n}">${n}</i>` : ''}</button>`;
}

// ------------------------------------------------------------------------------------------------ missions panel
export function missionName(kind: string, n: number): string { return t('mission.' + kind, { n }); }

export function missionsPanelHtml(s: SaveData, day = today()): string {
  const d = dailyOf(s);
  const next = nextStreakDay(d, day);
  const canLogin = loginAvailable(d, day);
  const cal = LOGIN_REWARDS.map((r, i) => {
    const n = i + 1;
    const done = canLogin ? n < next : n <= d.streak;
    const cur = canLogin && n === next;
    return `<div class="d-day${done ? ' done' : ''}${cur ? ' cur' : ''}${n === 7 ? ' big' : ''}"><small>${esc(t('daily.day', { n }))}</small>
      <span class="d-coin">${done ? icon('check') : icon('coin')}</span><b>${r}</b></div>`;
  }).join('');
  const defs = missionsForDay(day);
  const rows = Array.from({ length: MISSIONS_PER_DAY }, (_, i) => {
    const m = defs[i];
    const p = Math.min(m.target, progressValue(d, i, day));
    const complete = isComplete(d, i, day);
    const claimed = d.day === day && d.claimed[i];
    const btn = claimed
      ? `<button class="btn grey sm d-claim" disabled>${icon('check')}<span>${esc(t('daily.claimed'))}</span></button>`
      : complete
        ? `<button class="btn green sm d-claim" data-act="claimMission" data-i="${i}">${icon('coin')}<span>${m.reward}</span></button>`
        : `<span class="d-reward">${icon('coin')}<b>${m.reward}</b></span>`;
    return `<div class="d-mis${complete ? ' complete' : ''}${claimed ? ' claimed' : ''}">
      <div class="d-mtxt"><b>${esc(missionName(m.kind, m.target))}</b>
        <div class="d-prog"><i style="width:${((p / m.target) * 100).toFixed(1)}%"></i></div><small>${p} / ${m.target}</small></div>
      ${btn}</div>`;
  }).join('');
  const now = new Date();
  const hrs = Math.max(1, Math.ceil((new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime()) / 3600000));
  return `<div class="dim daily-dim" data-act="dailyClose"><div class="daily-panel panel" data-act="noop" role="dialog" aria-label="${esc(t('daily.title'))}">
    <div class="d-head"><h2 class="title sm">${esc(t('daily.title'))}</h2>
      <button class="btn round grey" data-act="dailyClose" aria-label="${esc(t('ui.close'))}">${icon('check')}</button></div>
    <section class="d-login"><h3>${esc(t('daily.login'))}</h3>
      <div class="d-cal">${cal}</div>
      ${canLogin ? `<button class="btn orange d-loginbtn" data-act="claimLogin">${icon('coin')}<span>${esc(t('daily.claimDay', { n: next, c: LOGIN_REWARDS[next - 1] }))}</span></button>`
        : `<p class="d-hint">${esc(t('daily.comeBack'))}</p>`}
    </section>
    <section class="d-list"><h3>${esc(t('daily.missions'))}<small>${esc(t('daily.reset', { h: hrs }))}</small></h3>${rows}</section>
  </div></div>`;
}

// ------------------------------------------------------------------------------------------------ garage paint shop
/** Item the player is previewing (not owned yet) and the car it is previewed on. */
let preview: { car: string; item: Item } | null = null;
export function clearPreview(): void { preview = null; }

function liveryOverlay(id: string, accent: number): string {
  const a = hex(accent);
  switch (id) {
    case 'stripes': return `<g fill="${a}" opacity="0.95"><rect x="11" y="12.4" width="38" height="1.5" rx="0.6"/><rect x="11" y="16.1" width="38" height="1.5" rx="0.6"/></g>`;
    case 'racing': return `<g fill="${a}" opacity="0.9"><rect x="10" y="13" width="40" height="4" rx="0.8"/></g>`;
    case 'flames': return `<g fill="${a}" stroke="#d6331e" stroke-width="0.5"><path d="M50 9.5 L41 11 L44 12.6 L37 13.4 L42 15 L37 16.6 L44 17.4 L41 19 L50 20.5 Z"/></g>`;
    default: return '';
  }
}

/** Garage silhouette with paint + livery (the 3D model takes the paint; the livery shows on the silhouettes). */
export function carSvgCos(id: string, colorIndex: number, livery: string, cls = 'car-svg'): string {
  const L = LIVERIES.find((l) => l.id === livery);
  const svg = carSvg(id, paintHex(colorIndex), cls);
  return L && L.id !== 'none' ? svg.replace(/<\/svg>$/, `${liveryOverlay(L.id, L.accent)}</svg>`) : svg;
}

export function paintShopHtml(s: SaveData, carId: string, fmtMoney: (n: number) => string): string {
  const id = carIdOr(carId);
  const c = cosmeticsOf(s);
  const eqPaint = c.paint[id];
  const eqLivery = liveryFor(s, id);
  const pv = preview && preview.car === id ? preview.item : null;
  const shownPaint = pv?.type === 'paint' ? PREMIUM_BASE + PAINTS.findIndex((p) => p.id === pv.id) : (eqPaint ? PREMIUM_BASE + PAINTS.findIndex((p) => p.id === eqPaint) : s.carColor);
  const shownLivery = pv?.type === 'livery' ? pv.id : eqLivery;

  const free = CONFIG.render.carColors.map((col, i) => {
    const on = !eqPaint && s.carColor === i && !(pv?.type === 'paint');
    return `<button class="swatch${on ? ' on' : ''}" data-act="cosFree" data-i="${i}" style="--c:${hex(col)}" aria-label="${esc(t('garage.color'))} ${i + 1}" aria-pressed="${on}"><i class="disc">${on ? icon('check') : ''}</i></button>`;
  }).join('');
  const prem = PAINTS.map((p) => {
    const it: Item = { type: 'paint', id: p.id };
    const own = owns(s, id, it);
    const on = pv ? pv.type === 'paint' && pv.id === p.id : eqPaint === p.id;
    return `<button class="swatch prem${on ? ' on' : ''}${own ? ' own' : ''}" data-act="cosPick" data-type="paint" data-id="${p.id}" style="--c:${hex(p.color)}" aria-label="${esc(t('paint.' + p.id))}" aria-pressed="${on}">
      <i class="disc">${on && own ? icon('check') : own ? '' : icon('lock')}</i><small>${own ? esc(t('paint.' + p.id)) : `${icon('coin')}${fmtMoney(p.price)}`}</small></button>`;
  }).join('');
  const liv = LIVERIES.map((l) => {
    const it: Item = { type: 'livery', id: l.id };
    const own = owns(s, id, it);
    const on = pv ? pv.type === 'livery' && pv.id === l.id : eqLivery === l.id;
    return `<button class="g-chip liv${on ? ' on' : ''}" data-act="cosPick" data-type="livery" data-id="${l.id}" aria-pressed="${on}" aria-label="${esc(t('livery.' + l.id))}">
      ${carSvgCos(id, shownPaint, l.id)}<span>${own ? esc(t('livery.' + l.id)) : `${icon('coin')}${fmtMoney(l.price)}`}</span>${on && own ? `<i class="g-tick">${icon('check')}</i>` : ''}</button>`;
  }).join('');
  let buy = '';
  if (pv && !owns(s, id, pv)) {
    const price = priceOf(pv) ?? 0;
    const name = t((pv.type === 'paint' ? 'paint.' : 'livery.') + pv.id);
    buy = `<div class="cos-buy"><div class="cos-prev">${carSvgCos(id, shownPaint, shownLivery, 'car-svg mini')}<span>${esc(t('cos.preview'))}: <b>${esc(name)}</b></span></div>
      <button class="btn ${s.money >= price ? 'green' : 'cant'} buy" data-act="cosBuy"><span class="cost">${icon('coin')}<b>${fmtMoney(price)}</b></span></button></div>`;
  }
  return `<div class="cos-pane">${buy}
    <h4>${esc(t('cos.free'))}</h4><div class="swatches">${free}</div>
    <h4>${esc(t('cos.premium'))}</h4><div class="swatches prem-row">${prem}</div>
    <h4>${esc(t('cos.livery'))}</h4><div class="liv-row">${liv}</div>
    <p class="g-note">${esc(t('cos.perCar', { car: t('car.' + id) }))}</p></div>`;
}

// ------------------------------------------------------------------------------------------------ actions
export interface DailyCtx {
  save: SaveData | null;
  /** car shown in the garage */
  shownCar: string;
  set(s: SaveData): void;
  adopt(s: SaveData): void;
  toast(text: string): void;
  sfx(n: 'click' | 'buy' | 'error'): void;
  overlay(html: string | null): void;
  rerender(): void;
  previewCar(id: string, colorIndex?: number): void;
  setFreeColor(i: number): void;
}

/** Handles the daily / paint-shop actions. Returns false for actions it does not own. */
export function dailyAct(act: string, el: HTMLElement, ctx: DailyCtx): boolean {
  const s = ctx.save;
  switch (act) {
    case 'missions': if (s) { ctx.sfx('click'); ctx.overlay(missionsPanelHtml(s)); } return true;
    case 'dailyClose': ctx.sfx('click'); ctx.overlay(null); ctx.rerender(); return true;
    case 'claimLogin': {
      if (!s) return true;
      const r = claimLogin(dailyOf(s), today());
      if (!r) { ctx.sfx('error'); return true; }
      const next = withDaily(s, r.state, r.coins);
      ctx.sfx('buy'); ctx.set(next); ctx.adopt(next);
      ctx.toast(t('daily.got', { n: r.coins }));
      ctx.overlay(missionsPanelHtml(next));
      return true;
    }
    case 'claimMission': {
      if (!s) return true;
      const r = claimMission(dailyOf(s), Number(el.dataset.i), today());
      if (!r) { ctx.sfx('error'); return true; }
      const next = withDaily(s, r.state, r.coins);
      ctx.sfx('buy'); ctx.set(next); ctx.adopt(next);
      ctx.toast(t('daily.got', { n: r.coins }));
      ctx.overlay(missionsPanelHtml(next));
      return true;
    }
    case 'cosFree': {
      if (!s) return true;
      const id = carIdOr(ctx.shownCar);
      preview = null;
      const i = Math.max(0, Math.min(CONFIG.render.carColors.length - 1, Math.floor(Number(el.dataset.i) || 0)));
      const unequipped = equipCosmetic(s, id, { type: 'paint', id: '' }) ?? s;
      const next = { ...unequipped, carColor: i };
      ctx.sfx('click'); ctx.set(next); ctx.setFreeColor(i); ctx.adopt(next);
      ctx.rerender();
      return true;
    }
    case 'cosPick': {
      if (!s) return true;
      const id = carIdOr(ctx.shownCar);
      const it: Item = { type: el.dataset.type === 'livery' ? 'livery' : 'paint', id: el.dataset.id ?? '' };
      ctx.sfx('click');
      if (owns(s, id, it)) {
        preview = null;
        const next = equipCosmetic(s, id, it);
        if (next) { ctx.set(next); ctx.adopt(next); }
      } else {
        preview = { car: id, item: it };
        if (it.type === 'paint') ctx.previewCar(id, PREMIUM_BASE + PAINTS.findIndex((p) => p.id === it.id));
      }
      ctx.rerender();
      return true;
    }
    case 'cosBuy': {
      if (!s || !preview) return true;
      const id = carIdOr(ctx.shownCar);
      const it = preview.item;
      const next = buyCosmetic(s, id, it);
      if (!next) { ctx.sfx('error'); ctx.toast(t('ui.notEnough')); return true; }
      preview = null;
      ctx.sfx('buy'); ctx.set(next); ctx.adopt(next);
      ctx.toast(t('cos.bought', { item: t((it.type === 'paint' ? 'paint.' : 'livery.') + it.id) }));
      ctx.rerender();
      return true;
    }
    default: return false;
  }
}
