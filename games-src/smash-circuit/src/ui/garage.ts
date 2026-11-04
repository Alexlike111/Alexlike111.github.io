// Garage car browser, rival picker and the car silhouettes used by both. HTML strings only; the UI class owns the state
// and the click handling. Every car is always selectable (badges are cosmetic, nothing is locked).
import './garage.css';
import { CONFIG } from '../config';
import { t } from '../i18n';
import { BAR_KEYS, CAR_IDS, badgeStars, bars, carIdOr, carStats, levelsOf, settledTopSpeed, zeroTo100, type BarKey } from '../meta/cars';
import { maxLevel, upgradeCost } from '../meta/economy';
import type { RivalMode, SaveData, UpgradeBranch } from '../types';
import { UPGRADE_BRANCHES } from '../config';
import { icon } from './icons';

const esc = (s: string | number): string =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const hex = (c: number): string => '#' + c.toString(16).padStart(6, '0');

// ------------------------------------------------------------------------------------------------ top-down silhouettes
// Car-local metres (x forward = right in the icon, z left = up). [cx, cz, length, width, kind, corner radius]
type Kind = 'p' | 'g' | 'd' | 'c' | 'w' | 'y' | 'r' | 's' | 'b' | 'o' | 'k';
type R = [number, number, number, number, Kind, number?];
const wheel = (x: number, z: number, r: number, w: number): R => [x, z, r * 2, w, 'd', 0.08];
const wheels = (fx: number, rx: number, fz: number, rz: number, fr: number, rr: number, fw: number, rw: number): R[] =>
  [wheel(fx, fz, fr, fw), wheel(fx, -fz, fr, fw), wheel(rx, rz, rr, rw), wheel(rx, -rz, rr, rw)];

const SIL: Record<string, R[]> = {
  scrapper: [...wheels(1.28, -1.3, 0.82, 0.82, 0.46, 0.46, 0.42, 0.42),
    [0, 0, 4.0, 1.8, 'p', 0.3], [1.93, 0, 0.38, 1.86, 'd', 0.1], [-1.93, 0, 0.38, 1.86, 'd', 0.1],
    [-0.45, 0, 2.35, 1.6, 'g', 0.25], [-0.3, 0, 1.75, 1.18, 'p', 0.15], [-0.3, 0.24, 1.7, 0.14, 'w'], [-0.3, -0.24, 1.7, 0.14, 'w']],
  gravel: [...wheels(1.22, -1.24, 0.84, 0.84, 0.45, 0.45, 0.44, 0.44),
    [0, 0, 3.7, 1.72, 'p', 0.3], [-0.4, 0, 2.05, 1.5, 'g', 0.25], [-0.3, 0, 1.55, 1.12, 'w', 0.15], [0.2, 0, 0.5, 0.5, 'd'],
    [1.55, 0, 0.3, 1.2, 'y', 0.1], [-1.82, 0, 0.62, 2.1, 'p', 0.08]],
  sandhopper: [...wheels(1.18, -1.15, 0.78, 0.86, 0.42, 0.56, 0.32, 0.54),
    [0.95, 0, 1.1, 0.8, 'p', 0.2], [-0.35, 0, 1.8, 1.3, 'p', 0.2], [-0.4, 0, 0.6, 0.8, 'r'],
    [-0.46, 0, 1.6, 0.12, 's'], [0.03, 0, 0.1, 1.24, 's'], [-0.95, 0, 0.1, 1.24, 's'], [-0.38, 0.58, 1.3, 0.1, 's'], [-0.38, -0.58, 1.3, 0.1, 's'],
    [-1.72, 0, 0.3, 0.8, 'd', 0.1]],
  brawler: [...wheels(1.5, -1.42, 0.84, 0.86, 0.47, 0.52, 0.42, 0.56),
    [0, 0, 4.4, 1.82, 'p', 0.3], [2.12, 0, 0.3, 1.82, 'c', 0.1], [-2.12, 0, 0.3, 1.82, 'c', 0.1],
    [-0.75, 0, 1.55, 1.56, 'g', 0.25], [-0.8, 0, 0.85, 1.16, 'p', 0.1], [1.05, 0, 0.8, 0.6, 'p', 0.1],
    [0.3, 0.2, 4.1, 0.18, 'w'], [0.3, -0.2, 4.1, 0.18, 'w']],
  glint: [...wheels(1.42, -1.38, 0.8, 0.82, 0.42, 0.46, 0.38, 0.46),
    [-0.8, 0, 2.2, 1.84, 'p', 0.25], [1.25, 0, 1.9, 1.2, 'p', 0.5], [2.05, 0, 0.35, 0.8, 'd', 0.2],
    [-0.45, 0, 1.7, 1.2, 'g', 0.5], [-1.95, 0, 0.5, 2.0, 'p', 0.06]],
  scorcher: [...wheels(1.5, -1.3, 0.8, 0.86, 0.38, 0.6, 0.24, 0.52),
    [1.5, 0, 0.12, 1.5, 'c'], [-1.0, 0, 1.9, 1.4, 'p', 0.2], [0.9, 0, 1.9, 0.9, 'p', 0.15],
    [0.75, 0, 1.05, 0.66, 'c', 0.1], [0.85, 0, 0.5, 0.4, 's'], [2.0, 0, 0.3, 0.8, 'c', 0.1],
    [-1.25, 0, 1.05, 1.3, 'g', 0.2], [-1.3, 0, 0.68, 1.0, 'p', 0.1], [-0.8, 0.72, 0.9, 0.12, 'y'], [-0.8, -0.72, 0.9, 0.12, 'y']],
  needle: [...wheels(1.62, -1.5, 0.78, 0.78, 0.42, 0.46, 0.36, 0.44),
    [2.1, 0, 0.4, 1.86, 'p', 0.05], [-0.5, 0, 2.2, 0.7, 'p', 0.25], [1.4, 0, 1.75, 0.45, 'p', 0.2],
    [-0.45, 0.48, 1.2, 0.32, 'p', 0.1], [-0.45, -0.48, 1.2, 0.32, 'p', 0.1], [-0.2, 0, 0.9, 0.5, 'd', 0.2], [-0.15, 0, 0.4, 0.4, 'y', 0.2],
    [-2.0, 0, 0.5, 1.6, 'p', 0.05]],
  bruiser: [...wheels(1.5, -1.45, 0.88, 0.88, 0.52, 0.52, 0.46, 0.46),
    [0, 0, 4.3, 1.92, 'p', 0.25], [2.3, 0, 0.22, 2.2, 'c', 0.08], [0.3, 0, 1.45, 1.75, 'g', 0.2], [0.25, 0, 1.05, 1.42, 'p', 0.1],
    [-1.4, 0, 1.75, 1.55, 'r', 0.1], [-1.1, 0.38, 0.56, 0.56, 'b', 0.28], [-1.6, -0.32, 0.56, 0.56, 'o', 0.28], [-0.62, 0, 0.14, 1.8, 'd']],
  brick: [...wheels(1.62, -1.55, 0.92, 0.92, 0.48, 0.48, 0.42, 0.42),
    [-0.1, 0, 4.6, 2.18, 'p', 0.2], [1.05, 0, 0.45, 1.9, 'g', 0.1], [-0.7, 0, 2.8, 1.8, 's', 0.05],
    [-1.5, 0.4, 0.8, 0.7, 'k', 0.05], [-0.55, -0.42, 0.7, 0.62, 'k', 0.05], [2.3, 0, 0.3, 2.2, 'd', 0.08]],
  mammoth: [...wheels(1.62, -1.62, 1.02, 1.02, 0.74, 0.74, 0.6, 0.6),
    [0, 0, 4.0, 1.9, 'p', 0.15], [2.35, 0, 0.4, 2.7, 's', 0.05], [-0.35, 0, 1.95, 1.7, 'g', 0.1], [-0.35, 0, 1.7, 1.66, 'p', 0.1],
    [-0.35, 0.8, 1.5, 0.08, 'd'], [-0.35, -0.8, 1.5, 0.08, 'd'], [-1.45, 0.62, 0.22, 0.22, 'c', 0.11], [-1.45, -0.62, 0.22, 0.22, 'c', 0.11]],
};

const KIND: Record<string, string> = {
  g: '#2f5273', d: '#1c1f27', c: '#dfe6f1', w: '#ffffff', y: '#ffd23a', r: '#3a2e28', s: '#5b616d', b: '#2f6fd0', o: '#d04a2f', k: '#c58a46',
};

/** Top-down silhouette of a roster car (nose to the right) in paint `color`. */
export function carSvg(id: string, color: number, cls = 'car-svg'): string {
  const list = SIL[carIdOr(id)] ?? SIL.scrapper;
  const S = 10, cx = 30, cy = 15;   // 10 px per metre, car centred in a 60 x 30 box
  const paint = hex(color);
  const rects = list.map(([x, z, l, w, k, r]) => {
    const fill = k === 'p' ? paint : KIND[k];
    const rx = (r ?? 0) * S;
    return `<rect x="${(cx + x * S - (l * S) / 2).toFixed(1)}" y="${(cy - z * S - (w * S) / 2).toFixed(1)}" width="${(l * S).toFixed(1)}" height="${(w * S).toFixed(1)}" rx="${rx.toFixed(1)}" fill="${fill}"/>`;
  }).join('');
  return `<svg class="${cls}" viewBox="0 0 60 30" aria-hidden="true"><g stroke="#14213d" stroke-width="0.6" stroke-linejoin="round">${rects}</g></svg>`;
}

// ------------------------------------------------------------------------------------------------ small inline icons
const SV = (p: string): string => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
const BAR_ICON: Record<BarKey, string> = {
  speed: icon('speed'),
  accel: icon('bolt'),
  handling: SV('<circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="2.6"/><circle cx="12" cy="12" r="2.4" fill="currentColor"/><path d="M4 11h5.6M14.4 11H20M12 14.4V20" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>'),
  drift: SV('<path d="M4 19c2-7 6-11 14-12" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/><path d="m15 3.5 4.5 3.5-4 4" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6" cy="20" r="1.4" fill="currentColor"/><circle cx="9" cy="18.6" r="1" fill="currentColor"/>'),
  armor: icon('shield'),
  weight: SV('<path d="M8.5 8.5a3.5 3.5 0 1 1 7 0" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M6.2 9h11.6l2.4 11.5H3.8z" fill="currentColor"/>'),
};
const STAR = (on: boolean): string => `<svg class="ic star${on ? ' on' : ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.6 2.9 6 6.5.8-4.8 4.5 1.2 6.5L12 17.2l-5.8 3.2 1.2-6.5-4.8-4.5 6.5-.8z" fill="currentColor" stroke="#14213d" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

export function starsHtml(n: number): string {
  return `<span class="g-stars" title="${esc(t('garage.badgeHint'))}">${[0, 1, 2].map((i) => STAR(i < n)).join('')}</span>`;
}

// ------------------------------------------------------------------------------------------------ garage
export type GarageTab = 'car' | 'upgrade' | 'paint';

export interface GarageView {
  save: SaveData;
  /** car being looked at (not necessarily the selected one) */
  shown: string;
  tab: GarageTab;
  fmtMoney(n: number): string;
  header: string;
}

function barValue(k: BarKey, id: string, save: SaveData): string {
  const s = carStats(id, levelsOf(save, id));
  switch (k) {
    case 'speed': return `${Math.round(settledTopSpeed(s) * 3.6)}<small>${esc(t('unit.kmh'))}</small>`;
    case 'accel': return `${zeroTo100(s).toFixed(1)}<small>${esc(t('unit.s'))}</small>`;
    case 'weight': return `${(s.mass / 1000).toFixed(2)}<small>${esc(t('unit.t'))}</small>`;
    default: return '';
  }
}

export function garageHtml(v: GarageView): string {
  const s = v.save, id = carIdOr(v.shown);
  const selected = carIdOr(s.car) === id;
  const paint = CONFIG.render.carColors[s.carColor % CONFIG.render.carColors.length];
  const idx = CAR_IDS.indexOf(id);

  const strip = CAR_IDS.map((c) => {
    const on = c === id, sel = c === carIdOr(s.car);
    return `<button class="g-chip${on ? ' on' : ''}${sel ? ' sel' : ''}" data-act="gcar" data-id="${c}" aria-pressed="${on}" aria-label="${esc(t('car.' + c))}">
      ${carSvg(c, paint)}<span>${esc(t('car.' + c))}</span>${sel ? `<i class="g-tick">${icon('check')}</i>` : ''}</button>`;
  }).join('');

  const stats = carStats(id, levelsOf(s, id));
  const b = bars(stats);
  const statHtml = BAR_KEYS.map((k) => {
    const val = barValue(k, id, s);
    const f = Math.min(1, b[k] / CONFIG.cars.bars);
    return `<div class="g-bar b-${k}"><span class="gi">${BAR_ICON[k]}</span><span class="gl">${esc(t('bar.' + k))}</span>
      <div class="bar2"><i class="cur" style="width:${(f * 100).toFixed(1)}%"></i></div><span class="gv">${val || Math.round(b[k])}</span></div>`;
  }).join('');

  let pane = '';
  if (v.tab === 'car') {
    pane = `<div class="g-trait"><span class="gt-ic">${icon('bolt')}</span><div><b>${esc(t('trait.' + id))}</b><p>${esc(t('trait.' + id + '.desc'))}</p></div></div>
      <div class="g-bars">${statHtml}</div>`;
  } else if (v.tab === 'upgrade') {
    const lv = levelsOf(s, id);
    pane = `<div class="g-ups">${UPGRADE_BRANCHES.map((br: UpgradeBranch) => {
      const lvl = lv[br];
      const cost = upgradeCost(lvl);
      const afford = cost !== null && s.money >= cost;
      const pips = Array.from({ length: maxLevel() }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
      const ic = br === 'engine' ? icon('engine') : br === 'grip' ? icon('tyre') : icon('shield');
      const btn = cost === null
        ? `<button class="btn buy max" disabled><span>${esc(t('garage.max'))}</span></button>`
        : `<button class="btn buy ${afford ? 'green' : 'cant'}" data-act="buy" data-b="${br}" aria-label="${esc(t('garage.buy'))}"><span class="cost">${icon('coin')}<b>${v.fmtMoney(cost)}</b></span></button>`;
      return `<div class="up ${br}"><div class="up-ic">${ic}</div>
        <div class="up-main"><div class="up-name">${esc(t('up.' + br))}<small>${lvl}/${maxLevel()}</small></div><div class="pips">${pips}</div><div class="up-desc">${esc(t('up.' + br + '.desc'))}</div></div>
        ${btn}</div>`;
    }).join('')}<p class="g-note">${esc(t('garage.perCar', { car: t('car.' + id) }))}</p></div>`;
  } else {
    pane = `<div class="swatches">${CONFIG.render.carColors.map((c, i) =>
      `<button class="swatch${s.carColor === i ? ' on' : ''}" data-act="color" data-i="${i}" style="--c:${hex(c)}" aria-label="${esc(t('garage.color'))} ${i + 1}" aria-pressed="${s.carColor === i}"><i class="disc">${s.carColor === i ? icon('check') : ''}</i></button>`).join('')}</div>`;
  }

  const tabs = (['car', 'upgrade', 'paint'] as GarageTab[]).map((tb) =>
    `<button class="${tb === v.tab ? 'on' : ''}" data-act="gtab" data-tab="${tb}" aria-pressed="${tb === v.tab}"><span>${esc(t('garage.tab.' + tb))}</span></button>`).join('');

  const races = s.carRaces[id] ?? 0, wins = s.carWins[id] ?? 0;
  const action = selected
    ? `<button class="btn green g-select done" data-act="gselect" data-id="${id}">${icon('check')}<span>${esc(t('garage.selected'))}</span></button>`
    : `<button class="btn orange g-select" data-act="gselect" data-id="${id}">${icon('play')}<span>${esc(t('garage.select'))}</span></button>`;

  return `${v.header}
    <div class="g-strip" role="group" aria-label="${esc(t('garage.cars'))}">${strip}</div>
    <div class="g-title">
      <button class="btn round g-arrow" data-act="gstep" data-d="-1" aria-label="${esc(t('garage.prev'))}">${icon('arrowL')}</button>
      <div class="g-name">
        <h3>${esc(t('car.' + id))}</h3>
        <div class="g-sub"><span class="g-class">${esc(t('class.' + id))}</span>${starsHtml(badgeStars(s, id))}<span class="g-count">${idx + 1}/${CAR_IDS.length}</span></div>
        <div class="g-rec">${esc(t('garage.record', { races, wins }))}</div>
      </div>
      <button class="btn round g-arrow next" data-act="gstep" data-d="1" aria-label="${esc(t('garage.next'))}">${icon('arrowR')}</button>
    </div>
    <div class="g-view" aria-hidden="true"></div>
    <div class="g-sheet panel">
      <div class="seg n3 g-tabs" role="group">${tabs}</div>
      <div class="g-pane">${pane}</div>
      ${action}
    </div>`;
}

// ------------------------------------------------------------------------------------------------ rivals
export const RIVAL_MODES: RivalMode[] = ['same', 'mixed', 'random', 'pick'];

/** The rival choice as one short line ("Rivals: Mixed"). */
export function rivalLabel(mode: RivalMode, car?: string): string {
  return mode === 'pick' ? t('car.' + carIdOr(car)) : t('rivals.short.' + mode);
}

/** Car picker grid (rival model for 'pick'). */
export function carGrid(act: string, current: string | undefined, color: number, cls = 'car-grid'): string {
  return `<div class="${cls}">${CAR_IDS.map((c) =>
    `<button class="g-chip${c === current ? ' on' : ''}" data-act="${act}" data-id="${c}" aria-pressed="${c === current}" aria-label="${esc(t('car.' + c))}">${carSvg(c, color)}<span>${esc(t('car.' + c))}</span></button>`).join('')}</div>`;
}

/** Bottom sheet on the pre-race screen: the 4 rival options as large radio cards (+ the model grid for 'pick'). */
export function rivalsSheetHtml(mode: RivalMode, car: string | undefined, playerCar: string, color: number): string {
  const opts = RIVAL_MODES.map((m) => {
    const on = m === mode;
    const preview = m === 'same' ? carSvg(playerCar, color, 'car-svg mini')
      : m === 'pick' ? carSvg(car ?? playerCar, CONFIG.render.carColors[2], 'car-svg mini')
        : m === 'mixed' ? ['brick', 'needle', 'sandhopper'].map((c, i) => carSvg(c, CONFIG.render.carColors[(i + 1) % 8], 'car-svg mini')).join('')
          : `<span class="rv-q">?</span>`;
    return `<button class="rv-opt${on ? ' on' : ''}" data-act="rival" data-v="${m}" aria-pressed="${on}">
      <span class="rv-radio">${on ? icon('check') : ''}</span><span class="rv-txt"><b>${esc(t('rivals.' + m))}</b><small>${esc(t('rivals.' + m + '.hint'))}</small></span>
      <span class="rv-prev">${preview}</span></button>`;
  }).join('');
  return `<div class="dim sheet-dim" data-act="sheetClose"><div class="rv-sheet panel" data-act="noop">
    <div class="rv-head"><h3 class="title sm">${esc(t('rivals.title'))}</h3>
      <button class="btn round grey" data-act="sheetClose" aria-label="${esc(t('ui.close'))}">${icon('check')}</button></div>
    <div class="rv-opts">${opts}</div>
    ${mode === 'pick' ? carGrid('rivalCar', car ?? playerCar, CONFIG.render.carColors[2]) : ''}
    <p class="rv-fair">${esc(t('rivals.fair'))}</p>
  </div></div>`;
}
