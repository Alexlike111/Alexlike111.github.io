// HTML/CSS user interface over the canvas (inside #ui). Bold cartoon-racing look, inline SVG icons only.
// Every visible string goes through t(); screens are re-rendered when the language changes.
import './ui.css';
import { CONFIG } from '../config';
import { lang, setLangSetting, t } from '../i18n';
import { buyUpgrade, canBuy, maxLevel, statsFor, upgradeCost, repairCost as repairPrice } from '../meta/economy';
import { buildTrackGeometry } from '../track/spline';
import { TRACKS } from '../track/tracks';
import type { CarStats, ISim, SaveData, UpgradeBranch, ZoneId } from '../types';
import { UPGRADE_BRANCHES } from '../config';
import { BADGE_SVG, CAR_ZONES_SVG, MEDAL_SVG, icon } from './icons';

export interface UiHandlers {
  start(trackId: string): void;
  pause(): void;
  resume(): void;
  quit(): void;
  restart(): void;
  repair(): void;
  buy(b: UpgradeBranch): void;
  /** Resolve `false` when the ad did not reward (UI then keeps the button); `true`/void = reward granted. */
  doubleReward(): Promise<boolean | void>;
  settings(s: SaveData['settings']): void;
  color(i: number): void;
  continueAfterResults(): void;
  /** Optional: UI click / buy / error sound. */
  sfx?(name: 'click' | 'buy' | 'error'): void;
}

export interface ResultsData {
  place: number; time: number; bestLap: number; reward: number;
  canDouble: boolean; unlocked: string | null; newBestLap: boolean;
}

const esc = (s: string | number): string =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export function fmtTime(sec: number): string {
  if (!(sec > 0)) return '--:--.--';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}
const fmtMoney = (n: number): string => Math.floor(n).toLocaleString(lang() === 'ru' ? 'ru-RU' : 'en-US');

const hex = (c: number): string => '#' + c.toString(16).padStart(6, '0');
const THEMES: Record<string, { a: string; b: string; road: string }> = {
  meadow: { a: '#58d66b', b: '#2a9d4b', road: '#fdf6e3' },
  desert: { a: '#ffb55a', b: '#d8782a', road: '#fff2d6' },
  snow: { a: '#bfe6ff', b: '#6fb6ee', road: '#ffffff' },
};

interface TrackView { id: string; nameKey: string; theme: string; laps: number; length: number; d: string; vb: string; start: [number, number]; diff: number }
let trackViews: TrackView[] | null = null;
function getTrackViews(): TrackView[] {
  if (trackViews) return trackViews;
  trackViews = TRACKS.map((def, idx) => {
    const g = buildTrackGeometry(def);
    const step = Math.max(1, Math.round(g.samples.length / 90));
    const pts: [number, number][] = [];
    for (let i = 0; i < g.samples.length; i += step) pts.push([g.samples[i].x, g.samples[i].y]);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const pad = def.width * 1.6;
    const w = x1 - x0 + pad * 2, h = y1 - y0 + pad * 2, side = Math.max(w, h);
    const ox = x0 - pad - (side - w) / 2, oy = y0 - pad - (side - h) / 2;
    const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${(x - ox).toFixed(1)} ${(y - oy).toFixed(1)}`).join('') + 'Z';
    return {
      id: def.id, nameKey: def.nameKey, theme: def.theme, laps: def.laps, length: g.length, d,
      vb: `0 0 ${side.toFixed(1)} ${side.toFixed(1)}`, start: [pts[0][0] - ox, pts[0][1] - oy], diff: idx + 1,
    };
  });
  return trackViews;
}

type Layer = 'screen' | 'hud' | 'overlay' | 'tutorial' | 'toasts';

export class UI {
  private root: HTMLElement;
  private h: UiHandlers;
  private layers = {} as Record<Layer, HTMLElement>;
  private save: SaveData | null = null;
  private settings: SaveData['settings'] = { lang: 'auto', autoGas: false, quality: 'auto', muted: false, tutorialDone: false };
  private money = 0;
  private current: { name: string; render: () => void } | null = null;
  private overlayRender: (() => void) | null = null;
  private pauseState = { cost: 0, money: 0 };
  private resultsState: { r: ResultsData; doubled: boolean; busy: boolean } | null = null;
  private armed: { act: string; timer: number } | null = null;
  private touchMode = false;

  // HUD cache
  private hud: {
    place: HTMLElement; placeTotal: HTMLElement; lap: HTMLElement; timer: HTMLElement; last: HTMLElement; best: HTMLElement;
    speed: HTMLElement; money: HTMLElement; countdown: HTMLElement; zones: Map<string, SVGElement>; repair: HTMLElement; repairCost: HTMLElement;
    car: HTMLElement; fps: HTMLElement | null;
  } | null = null;
  private hudLast = { place: -1, total: -1, lap: -1, laps: -1, timer: '', last: '', best: '', speed: -1, cd: '', zones: [] as number[], cost: -1, money: -1, health: -1 };
  private lastLapShown = -1;

  constructor(root: HTMLElement, h: UiHandlers) {
    this.root = root;
    this.h = h;
    root.classList.add('ui-root');
    for (const name of ['screen', 'hud', 'overlay', 'tutorial', 'toasts'] as Layer[]) {
      const el = document.createElement('div');
      el.className = `layer layer-${name}`;
      root.appendChild(el);
      this.layers[name] = el;
    }
    root.addEventListener('click', this.onClick);
    this.buildHud();
  }

  // ------------------------------------------------------------------ public API

  /** Tell the UI whether the touch scheme is active (HUD hints). */
  setTouchMode(touch: boolean): void {
    this.touchMode = touch;
    this.root.classList.toggle('is-touch', touch);
    this.refreshHudText();
  }

  /** Latest settings (the UI keeps a copy for mute toggles etc.). */
  setSettings(s: SaveData['settings']): void { this.settings = { ...s }; }

  /** Money shown in the HUD chip. */
  setMoney(m: number): void { this.money = m; this.updateMoneyChip(); }

  showMainMenu(s: SaveData): void { this.enter('menu', s, () => this.renderMenu()); }
  showGarage(s: SaveData): void { this.enter('garage', s, () => this.renderGarage()); }
  showTrackSelect(s: SaveData): void { this.enter('tracks', s, () => this.renderTracks()); }
  showSettings(s: SaveData): void { this.enter('settings', s, () => this.renderSettings()); }

  showHud(money?: number): void {
    this.clearScreens();
    this.root.dataset.screen = 'hud';
    if (money !== undefined) this.money = money;
    this.layers.hud.hidden = false;
    this.hudLast = { place: -1, total: -1, lap: -1, laps: -1, timer: '', last: '', best: '', speed: -1, cd: '', zones: [], cost: -1, money: -1, health: -1 };
    this.lastLapShown = -1;
    this.updateMoneyChip();
  }

  updateHud(sim: ISim, fps: number): void {
    const hud = this.hud;
    if (!hud || this.layers.hud.hidden) return;
    const p = sim.cars[0];
    if (!p) return;
    const L = this.hudLast;
    const total = sim.cars.length;
    if (L.place !== p.place || L.total !== total) {
      L.place = p.place; L.total = total;
      hud.place.textContent = String(p.place);
      hud.placeTotal.textContent = '/' + total;
      hud.place.parentElement!.dataset.pos = p.place <= 3 ? String(p.place) : '';
    }
    const laps = sim.race.totalLaps;
    const lapNo = Math.min(laps, p.lap + 1);
    if (L.lap !== lapNo || L.laps !== laps) {
      L.lap = lapNo; L.laps = laps;
      hud.lap.textContent = `${lapNo}/${laps}`;
      if (lapNo === laps && laps > 1 && this.lastLapShown !== lapNo && sim.race.phase === 'racing') this.toast(t('hud.finalLap'));
      this.lastLapShown = lapNo;
    }
    const tm = fmtTime(sim.race.phase === 'countdown' ? 0 : sim.race.time);
    if (L.timer !== tm) { L.timer = tm; hud.timer.textContent = tm; }
    const last = p.lastLapTime > 0 ? fmtTime(p.lastLapTime) : '';
    const best = p.bestLapTime > 0 ? fmtTime(p.bestLapTime) : '';
    if (L.last !== last) { L.last = last; hud.last.textContent = last || '--'; }
    if (L.best !== best) { L.best = best; hud.best.textContent = best || '--'; }
    const kmh = Math.round(Math.abs(p.speed) * 3.6);
    if (L.speed !== kmh) { L.speed = kmh; hud.speed.textContent = String(kmh); }

    // damage silhouette (quantised to 11 colour steps -> almost no DOM writes)
    const zoneMax = p.zoneMaxHp || CONFIG.damage.zoneMaxHp;
    let missing = 0;
    (Object.keys(p.hp) as ZoneId[]).forEach((z, i) => {
      const f = Math.max(0, Math.min(1, p.hp[z] / zoneMax));
      missing += zoneMax - p.hp[z];
      const q = Math.round(f * 10);
      if (L.zones[i] !== q) {
        L.zones[i] = q;
        const el = hud.zones.get(z);
        if (el) el.style.fill = `hsl(${Math.round(q * 12)} 88% ${q > 6 ? 46 : 50}%)`;
      }
    });
    const hq = Math.round(p.health * 20);
    if (L.health !== hq) { L.health = hq; hud.car.classList.toggle('crit', p.health < 0.3); }
    const cost = repairPrice(missing);
    if (L.cost !== cost) {
      L.cost = cost;
      hud.repair.classList.toggle('show', cost > 0);
      hud.repairCost.textContent = String(cost);
    }

    // countdown / GO
    let cd = '';
    if (sim.race.phase === 'countdown') cd = String(Math.max(1, Math.ceil(sim.race.countdown)));
    else if (sim.race.phase === 'racing' && sim.race.time < 0.9) cd = 'GO';
    if (L.cd !== cd) {
      L.cd = cd;
      hud.countdown.textContent = cd === 'GO' ? t('hud.go') : cd;
      hud.countdown.classList.remove('pop');
      if (cd) { void hud.countdown.offsetWidth; hud.countdown.classList.add('pop'); }
      hud.countdown.classList.toggle('go', cd === 'GO');
      hud.countdown.hidden = !cd;
    }
    if (hud.fps) hud.fps.textContent = `${Math.round(fps)} fps`;
  }

  showPause(repairCost: number, money: number): void {
    this.pauseState = { cost: repairCost, money };
    this.overlayRender = () => this.renderPause();
    this.layers.tutorial.replaceChildren();
    this.root.classList.remove('tut-on');
    this.renderPause();
  }

  showResults(r: ResultsData): void {
    this.layers.hud.hidden = true;
    this.layers.screen.replaceChildren();
    this.current = null;
    this.resultsState = { r, doubled: false, busy: false };
    this.overlayRender = () => this.renderResults();
    this.renderResults();
  }

  showTutorial(isTouch: boolean): void {
    this.touchMode = isTouch;
    const el = this.layers.tutorial;
    const steps = isTouch
      ? [
        { ic: `<div class="tut-gas">${icon('finger')}<i></i></div>`, tx: t('tut.touch.gas') },
        { ic: `<div class="tut-steer">${icon('arrowL')}${icon('finger')}${icon('arrowR')}</div>`, tx: t('tut.touch.steer') },
        { ic: `<div class="tut-smash">${icon('crash')}</div>`, tx: t('tut.smash') },
      ]
      : [
        { ic: `<div class="keys"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></div><div class="keys sub"><kbd>&uarr;</kbd><kbd>&larr;</kbd><kbd>&darr;</kbd><kbd>&rarr;</kbd></div>`, tx: t('tut.key.drive') },
        { ic: `<div class="keys"><kbd class="wide">${esc(t('tut.key.space'))}</kbd></div>`, tx: t('tut.key.handbrake') },
        { ic: `<div class="keys"><kbd>R</kbd><kbd>P</kbd></div>`, tx: t('tut.key.repair') },
      ];
    this.root.classList.add('tut-on');   // CSS hides the countdown while the sim is held behind the tutorial
    el.innerHTML = `<div class="tutorial panel">
      <h3 class="title sm">${esc(t('tut.title'))}</h3>
      <div class="tut-steps">${steps.map((s, i) => `<div class="tut-step"><span class="n">${i + 1}</span><div class="tut-ic">${s.ic}</div><p>${esc(s.tx)}</p></div>`).join('')}</div>
      <button class="btn green" data-act="tutorialOk">${icon('check')}<span>${esc(t('tut.ok'))}</span></button>
    </div>`;
    window.clearTimeout(this.tutTimer);
    this.tutTimer = window.setTimeout(() => this.dismissTutorial(false), CONFIG.ui.tutorialSeconds * 1000 + 4000);
  }
  private tutTimer = 0;

  toast(text: string): void {
    const box = this.layers.toasts;
    while (box.children.length >= 2) box.firstElementChild?.remove();
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    box.appendChild(el);
    window.setTimeout(() => el.remove(), CONFIG.ui.toastMs);
  }

  hideAll(): void {
    this.clearScreens();
    this.layers.hud.hidden = true;
    this.layers.toasts.replaceChildren();
  }

  // ------------------------------------------------------------------ plumbing

  private clearScreens(): void {
    this.current = null;
    this.overlayRender = null;
    this.resultsState = null;
    this.disarm();
    window.clearTimeout(this.tutTimer);
    this.root.classList.remove('tut-on');
    this.layers.screen.replaceChildren();
    this.layers.overlay.replaceChildren();
    this.layers.tutorial.replaceChildren();
  }

  private enter(name: string, s: SaveData, render: () => void): void {
    this.save = s;
    this.settings = { ...s.settings };
    this.money = s.money;
    this.layers.hud.hidden = true;
    this.layers.overlay.replaceChildren();
    this.layers.tutorial.replaceChildren();
    this.root.classList.remove('tut-on');
    this.root.dataset.screen = name;
    this.overlayRender = null;
    this.resultsState = null;
    this.disarm();
    this.current = { name, render };
    render();
  }

  private rerender(): void {
    if (this.current) this.current.render();
    if (this.overlayRender) this.overlayRender();
    this.refreshHudText();
  }

  private sfx(n: 'click' | 'buy' | 'error'): void { this.h.sfx?.(n); }

  private coin(n: number, cls = ''): string {
    return `<span class="coin ${cls}">${icon('coin')}<b>${fmtMoney(n)}</b></span>`;
  }

  private header(titleKey: string, withCoins = true): string {
    return `<header class="bar">
      <button class="btn round grey back" data-act="back" aria-label="${esc(t('ui.back'))}">${icon('back')}</button>
      <h2 class="title">${esc(t(titleKey))}</h2>
      ${withCoins ? `<div class="chip">${this.coin(this.save?.money ?? 0)}</div>` : '<span></span>'}
    </header>`;
  }

  private setScreen(cls: string, html: string): void {
    const el = this.layers.screen;
    el.innerHTML = `<section class="screen ${cls}">${html}</section>`;
  }

  // ------------------------------------------------------------------ click handling

  private onClick = (e: MouseEvent): void => {
    const el = (e.target as Element | null)?.closest<HTMLElement>('[data-act]');
    if (!el || el.hasAttribute('disabled')) return;
    const act = el.dataset.act!;
    this.act(act, el);
  };

  private disarm(): void {
    if (this.armed) { window.clearTimeout(this.armed.timer); this.armed = null; }
  }

  /** Two-step confirm for destructive buttons: first tap arms (label changes), second tap within 2.5 s acts. */
  private confirm(act: string, el: HTMLElement, run: () => void): void {
    if (this.armed?.act === act) { this.disarm(); run(); return; }
    this.disarm();
    el.classList.add('armed');
    const label = el.querySelector('span');
    const old = label?.textContent ?? '';
    if (label) label.textContent = t('ui.tapAgain');
    this.sfx('click');
    this.armed = {
      act,
      timer: window.setTimeout(() => {
        el.classList.remove('armed');
        if (label) label.textContent = old;
        this.armed = null;
      }, 2500),
    };
  }

  private act(act: string, el: HTMLElement): void {
    const save = this.save;
    switch (act) {
      case 'play': this.sfx('click'); if (save) this.showTrackSelect(save); break;
      case 'garage': this.sfx('click'); if (save) this.showGarage(save); break;
      case 'settings': this.sfx('click'); if (save) this.showSettings(save); break;
      case 'back': this.sfx('click'); if (save) this.showMainMenu(save); break;
      case 'track': {
        const id = el.dataset.id!;
        if (el.classList.contains('locked')) { this.sfx('error'); this.toast(t('track.lockedHint', { track: t(this.prevTrackKey(id)) })); break; }
        this.sfx('click');
        this.h.start(id);
        break;
      }
      case 'color': {
        const i = Number(el.dataset.i);
        if (!save) break;
        this.sfx('click');
        this.save = { ...save, carColor: i };
        this.h.color(i);
        this.renderGarage();
        break;
      }
      case 'buy': {
        const b = el.dataset.b as UpgradeBranch;
        if (!save) break;
        if (!canBuy(save, b)) { this.sfx('error'); this.toast(upgradeCost(save.upgrades[b]) === null ? t('garage.maxed') : t('ui.notEnough')); break; }
        const next = buyUpgrade(save, b);
        if (!next) break;
        this.sfx('buy');
        this.save = next;
        this.h.buy(b);
        this.renderGarage();
        break;
      }
      case 'set': this.changeSetting(el.dataset.k!, el.dataset.v!); break;
      case 'resume': this.sfx('click'); this.h.resume(); break;
      case 'pauseBtn': this.sfx('click'); this.h.pause(); break;
      case 'repair': {
        const hudRepair = this.layers.hud.contains(el);
        const cost = hudRepair ? this.hudLast.cost : this.pauseState.cost;
        if (cost <= 0) break;
        const money = hudRepair ? this.money : this.pauseState.money;
        if (money < cost) { this.sfx('error'); this.toast(t('ui.notEnough')); break; }
        this.sfx('buy');
        this.h.repair();
        if (!hudRepair) {
          this.pauseState = { cost: 0, money: money - cost };
          this.renderPause();
        }
        break;
      }
      case 'restart': this.confirm('restart', el, () => this.h.restart()); break;
      case 'quit': this.confirm('quit', el, () => this.h.quit()); break;
      case 'mute': {
        this.sfx('click');
        this.settings = { ...this.settings, muted: !this.settings.muted };
        this.h.settings({ ...this.settings });
        this.renderPause();
        break;
      }
      case 'double': void this.doDouble(); break;
      case 'continue': this.sfx('click'); this.h.continueAfterResults(); break;
      case 'tutorialOk': this.sfx('click'); this.dismissTutorial(true); break;
      default: break;
    }
  }

  private prevTrackKey(id: string): string {
    const order = CONFIG.meta.trackOrder;
    const i = order.indexOf(id);
    const prev = TRACKS.find((tr) => tr.id === order[Math.max(0, i - 1)]);
    return prev?.nameKey ?? 'track.t1';
  }

  private dismissTutorial(byUser: boolean): void {
    window.clearTimeout(this.tutTimer);
    const el = this.layers.tutorial;
    this.root.classList.remove('tut-on');
    if (!el.firstElementChild) return;
    el.replaceChildren();
    if (byUser || !this.settings.tutorialDone) {
      this.settings = { ...this.settings, tutorialDone: true };
      this.h.settings({ ...this.settings });
    }
  }

  private changeSetting(k: string, v: string): void {
    const s = { ...this.settings };
    if (k === 'lang') { s.lang = v as SaveData['settings']['lang']; setLangSetting(s.lang); }
    else if (k === 'quality') s.quality = v as SaveData['settings']['quality'];
    else if (k === 'autoGas') s.autoGas = v === '1';
    else if (k === 'muted') s.muted = v === '1';
    this.sfx('click');
    this.settings = s;
    if (this.save) this.save = { ...this.save, settings: s };
    this.h.settings({ ...s });
    this.rerender();
  }

  private async doDouble(): Promise<void> {
    const st = this.resultsState;
    if (!st || st.doubled || st.busy) return;
    st.busy = true;
    this.sfx('click');
    this.renderResults();
    let ok = true;
    try {
      const res = await this.h.doubleReward();
      ok = res !== false;
    } catch { ok = false; }
    if (this.resultsState !== st) return;
    st.busy = false;
    if (ok) { st.doubled = true; this.sfx('buy'); } else { this.sfx('error'); this.toast(t('results.adFailed')); }
    this.renderResults();
  }

  // ------------------------------------------------------------------ screens

  private renderMenu(): void {
    const money = this.save?.money ?? 0;
    this.setScreen('menu', `
      <div class="menu-top"><div class="chip">${this.coin(money)}</div></div>
      <div class="menu-main">
        <div class="logo" role="img" aria-label="${esc(CONFIG.title)}">
          <div class="logo-a">SMASH</div>
          <div class="logo-b"><i class="checker"></i><span>CIRCUIT</span><i class="checker"></i></div>
          <div class="logo-tag">${esc(t('menu.tagline'))}</div>
        </div>
        <div class="menu-buttons">
          <button class="btn big orange" data-act="play">${icon('play')}<span>${esc(t('menu.play'))}</span></button>
          <div class="pair">
            <button class="btn blue" data-act="garage">${icon('wrench')}<span>${esc(t('menu.garage'))}</span></button>
            <button class="btn grey" data-act="settings">${icon('gear')}<span>${esc(t('menu.settings'))}</span></button>
          </div>
        </div>
      </div>`);
  }

  private renderTracks(): void {
    const s = this.save!;
    const views = getTrackViews();
    const cards = views.map((v, idx) => {
      const unlocked = s.unlockedTracks.includes(v.id);
      const th = THEMES[v.theme] ?? THEMES.meadow;
      const bp = s.bestPlace[v.id];
      const bl = s.bestLap[v.id];
      const prev = idx > 0 ? t(views[idx - 1].nameKey) : '';
      const pips = Array.from({ length: 3 }, (_, i) => `<i class="${i < v.diff ? 'on' : ''}"></i>`).join('');
      const medal = bp
        ? `<div class="mini-medal p${Math.min(bp, 4)}"><b>${bp}</b></div>`
        : `<div class="mini-medal none"><b>-</b></div>`;
      return `<article class="card track${unlocked ? '' : ' locked'}" data-act="track" data-id="${v.id}" tabindex="0" style="--ta:${th.a};--tb:${th.b};--tr:${th.road}">
        <div class="map"><svg viewBox="${v.vb}" aria-hidden="true">
          <path d="${v.d}" fill="none" stroke="#14213d" stroke-width="${(Number(v.vb.split(' ')[2]) * 0.085).toFixed(1)}" stroke-linejoin="round" stroke-linecap="round"/>
          <path d="${v.d}" fill="none" stroke="var(--tr)" stroke-width="${(Number(v.vb.split(' ')[2]) * 0.05).toFixed(1)}" stroke-linejoin="round" stroke-linecap="round"/>
          <circle cx="${v.start[0].toFixed(1)}" cy="${v.start[1].toFixed(1)}" r="${(Number(v.vb.split(' ')[2]) * 0.055).toFixed(1)}" fill="#ff5a36" stroke="#14213d" stroke-width="${(Number(v.vb.split(' ')[2]) * 0.02).toFixed(1)}"/>
        </svg></div>
        <div class="info">
          <h3 class="tname">${esc(t(v.nameKey))}</h3>
          ${unlocked ? `<div class="meta"><span>${esc(t('track.laps', { n: v.laps }))}</span><span>${Math.round(v.length)} ${esc(t('unit.m'))}</span></div>
          <div class="diff"><span>${esc(t('track.difficulty'))}</span><span class="pips3">${pips}</span></div>`
            : `<p class="lockhint">${esc(t('track.lockedHint', { track: prev }))}</p>`}
        </div>
        ${unlocked ? `<div class="best">
          ${medal}
          <div class="bl"><small>${esc(t('track.bestLap'))}</small><b>${bl ? fmtTime(bl) : '--:--.--'}</b></div>
        </div>` : `<div class="best lockbadge">${icon('lock')}</div>`}
      </article>`;
    }).join('');
    this.setScreen('tracks', `${this.header('tracks.title')}<div class="cards">${cards}</div>`);
  }

  private statValues(stats: CarStats): Record<'speed' | 'accel' | 'grip' | 'armor', number> {
    return { speed: stats.topSpeed * 3.6, accel: stats.enginePower, grip: stats.grip, armor: stats.armor };
  }

  private renderGarage(): void {
    const s = this.save!;
    const cur = statsFor(s.upgrades);
    const base = statsFor({ engine: 0, grip: 0, armor: 0 });
    const top = statsFor({ engine: maxLevel(), grip: maxLevel(), armor: maxLevel() });
    const nextOf = (b: UpgradeBranch): CarStats => statsFor({ ...s.upgrades, [b]: Math.min(maxLevel(), s.upgrades[b] + 1) });
    const cv = this.statValues(cur), bv = this.statValues(base), tv = this.statValues(top);
    const nvEng = this.statValues(nextOf('engine')), nvGrip = this.statValues(nextOf('grip')), nvArm = this.statValues(nextOf('armor'));
    const rows: { key: 'speed' | 'accel' | 'grip' | 'armor'; ic: string; next: number; unit: string }[] = [
      { key: 'speed', ic: icon('speed'), next: nvEng.speed, unit: ' ' + t('unit.kmh') },
      { key: 'accel', ic: icon('bolt'), next: nvEng.accel, unit: '' },
      { key: 'grip', ic: icon('tyre'), next: nvGrip.grip, unit: '' },
      { key: 'armor', ic: icon('shield'), next: nvArm.armor, unit: '' },
    ];
    const frac = (v: number, k: 'speed' | 'accel' | 'grip' | 'armor'): number => 0.14 + 0.86 * Math.max(0, Math.min(1, (v - bv[k]) / (tv[k] - bv[k] || 1)));
    const fmtVal = (v: number, k: string): string => (k === 'speed' ? String(Math.round(v)) : String(Math.round((v / (k === 'accel' ? base.enginePower : k === 'grip' ? base.grip : base.armor)) * 100)));
    const statHtml = rows.map((r) => {
      const c = frac(cv[r.key], r.key), n = frac(r.next, r.key);
      const gain = Math.max(0, n - c);
      const dv = Math.round(r.key === 'speed' ? r.next - cv[r.key] : ((r.next - cv[r.key]) / (r.key === 'accel' ? base.enginePower : r.key === 'grip' ? base.grip : base.armor)) * 100);
      return `<div class="stat s-${r.key}" title="${esc(t('stat.' + r.key))}"><span class="si">${r.ic}</span><span class="sl">${esc(t('stat.' + r.key))}</span>
        <div class="bar2"><i class="cur" style="width:${(c * 100).toFixed(1)}%"></i><i class="gain" style="left:${(c * 100).toFixed(1)}%;width:${(gain * 100).toFixed(1)}%"></i></div>
        <span class="sv">${fmtVal(cv[r.key], r.key)}${r.key === 'speed' ? '' : '%'}${dv > 0 ? `<em>+${dv}</em>` : ''}</span></div>`;
    }).join('');

    const swatches = CONFIG.render.carColors.map((c, i) =>
      `<button class="swatch${s.carColor === i ? ' on' : ''}" data-act="color" data-i="${i}" style="--c:${hex(c)}" aria-label="${esc(t('garage.color'))} ${i + 1}" aria-pressed="${s.carColor === i}"><i class="disc">${s.carColor === i ? icon('check') : ''}</i></button>`).join('');

    const ups = UPGRADE_BRANCHES.map((b) => {
      const lvl = s.upgrades[b];
      const cost = upgradeCost(lvl);
      const afford = cost !== null && s.money >= cost;
      const pips = Array.from({ length: maxLevel() }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
      const ic = b === 'engine' ? icon('engine') : b === 'grip' ? icon('tyre') : icon('shield');
      const btn = cost === null
        ? `<button class="btn buy max" disabled><span>${esc(t('garage.max'))}</span></button>`
        : `<button class="btn buy ${afford ? 'green' : 'cant'}" data-act="buy" data-b="${b}" aria-label="${esc(t('garage.buy'))}"><span class="cost">${icon('coin')}<b>${fmtMoney(cost)}</b></span></button>`;
      return `<div class="up ${b}">
        <div class="up-ic">${ic}</div>
        <div class="up-main"><div class="up-name">${esc(t('up.' + b))}<small>${lvl}/${maxLevel()}</small></div><div class="pips">${pips}</div><div class="up-desc">${esc(t('up.' + b + '.desc'))}</div></div>
        ${btn}
      </div>`;
    }).join('');

    this.setScreen('garage', `
      ${this.header('garage.title')}
      <div class="g-colors panel"><span class="lab">${esc(t('garage.color'))}</span><div class="swatches">${swatches}</div></div>
      <div class="g-view" aria-hidden="true"></div>
      <div class="g-stats panel"><div class="ph">${esc(t('garage.stats'))}</div><div class="stat-list">${statHtml}</div></div>
      <div class="g-ups panel"><div class="ph">${esc(t('garage.upgrades'))}</div>${ups}</div>`);
  }

  private seg(k: string, cur: string, opts: { v: string; label: string }[]): string {
    return `<div class="seg n${opts.length}" role="group">${opts.map((o) =>
      `<button class="${o.v === cur ? 'on' : ''}" data-act="set" data-k="${k}" data-v="${o.v}" aria-pressed="${o.v === cur}"><span>${esc(o.label)}</span></button>`).join('')}</div>`;
  }

  private renderSettings(): void {
    const st = this.settings;
    const row = (ic: string, label: string, ctl: string, hint = ''): string =>
      `<div class="srow"><div class="sl2"><span class="sic">${ic}</span><div><b>${esc(label)}</b>${hint ? `<small>${esc(hint)}</small>` : ''}</div></div>${ctl}</div>`;
    const toggle = (k: string, on: boolean): string =>
      `<button class="switch${on ? ' on' : ''}" role="switch" aria-checked="${on}" data-act="set" data-k="${k}" data-v="${on ? '0' : '1'}"><i></i><span>${esc(on ? t('ui.on') : t('ui.off'))}</span></button>`;
    this.setScreen('settings', `
      ${this.header('settings.title', false)}
      <div class="s-panel panel">
        ${row(icon('flag'), t('settings.language'), this.seg('lang', st.lang, [
          { v: 'en', label: 'English' }, { v: 'ru', label: 'Русский' }, { v: 'auto', label: t('settings.auto') },
        ]))}
        ${row(icon('bolt'), t('settings.autoGas'), toggle('autoGas', st.autoGas), t('settings.autoGas.hint'))}
        ${row(icon('speed'), t('settings.quality'), this.seg('quality', st.quality, [
          { v: 'auto', label: t('settings.auto') }, { v: 'low', label: t('settings.low') }, { v: 'medium', label: t('settings.medium') }, { v: 'high', label: t('settings.high') },
        ]))}
        ${row(st.muted ? icon('speakerOff') : icon('speakerOn'), t('settings.sound'), toggle('muted', !st.muted))}
      </div>`);
  }

  private renderPause(): void {
    const { cost, money } = this.pauseState;
    const needs = cost > 0;
    const can = needs && money >= cost;
    const repairLabel = needs ? t('pause.repair') : t('pause.noDamage');
    const confirmArmed = (a: string): string => (this.armed?.act === a ? ' armed' : '');
    this.layers.overlay.innerHTML = `<div class="dim"><div class="pausecard panel">
      <div class="pc-head"><h2 class="title">${esc(t('pause.title'))}</h2>
        <button class="btn round grey" data-act="mute" aria-pressed="${this.settings.muted}" aria-label="${esc(t('settings.sound'))}">${this.settings.muted ? icon('speakerOff') : icon('speakerOn')}</button></div>
      <button class="btn big green" data-act="resume">${icon('play')}<span>${esc(t('pause.resume'))}</span></button>
      <button class="btn yellow repairbtn${can || !needs ? '' : ' cant'}" data-act="repair" ${needs ? '' : 'disabled'}>${icon('wrench')}<span>${esc(repairLabel)}</span>${needs ? `<span class="cost">${icon('coin')}<b>${fmtMoney(cost)}</b></span>` : ''}</button>
      <div class="pair">
        <button class="btn blue${confirmArmed('restart')}" data-act="restart">${icon('restart')}<span>${esc(t('pause.restart'))}</span></button>
        <button class="btn red${confirmArmed('quit')}" data-act="quit">${icon('exit')}<span>${esc(t('pause.quit'))}</span></button>
      </div>
      <div class="pc-foot"><span>${icon('coin')}<b>${fmtMoney(money)}</b></span><span class="keyhint">${esc(this.touchMode ? '' : t('pause.keys'))}</span></div>
    </div></div>`;
  }

  private renderResults(): void {
    const st = this.resultsState;
    if (!st) return;
    const r = st.r;
    const mult = CONFIG.economy.rewardedMultiplier;
    const reward = st.doubled ? r.reward * mult : r.reward;
    const medalCls = r.place <= 3 ? `m${r.place}` : 'm4';
    const ord = t('ordinal.' + Math.min(8, Math.max(1, r.place)));
    const unlockName = r.unlocked ? t(TRACKS.find((x) => x.id === r.unlocked)?.nameKey ?? 'track.t1') : '';
    const dbl = r.canDouble
      ? `<button class="btn adbtn yellow${st.doubled ? ' done' : ''}${st.busy ? ' busy' : ''}" data-act="double" ${st.doubled || st.busy ? 'disabled' : ''}>
          <span class="adtag">${icon('ad')}<b>${esc(t('results.adTag'))}</b></span>
          <span class="adtxt"><b>${esc(st.doubled ? t('results.doubled') : t('results.watchAd', { n: mult }))}</b>${st.doubled ? '' : `<small>${esc(t('results.adSub', { n: fmtMoney(r.reward * (mult - 1)) }))}</small>`}</span>
          ${st.doubled ? icon('check') : ''}
        </button>` : '';
    this.layers.overlay.innerHTML = `<div class="dim results-dim"><div class="rescard panel">
      <div class="res-left">
        <div class="res-title">${esc(t('results.title'))}</div>
        <div class="medal ${medalCls}">${r.place <= 3 ? MEDAL_SVG : BADGE_SVG}<div class="medal-num"><b>${r.place}</b></div></div>
        <div class="res-ord">${esc(ord)} <small>${esc(t('results.place'))}</small></div>
      </div>
      <div class="res-right">
        <div class="stats-list">
          <div class="rr"><span>${icon('flag')}${esc(t('results.time'))}</span><b>${fmtTime(r.time)}</b></div>
          <div class="rr"><span>${icon('bolt')}${esc(t('results.bestLap'))}</span><b>${fmtTime(r.bestLap)}${r.newBestLap ? `<em>${esc(t('results.newBest'))}</em>` : ''}</b></div>
          <div class="rr reward${st.doubled ? ' dbl' : ''}"><span>${icon('coin')}${esc(t('results.reward'))}</span><b>+${fmtMoney(reward)}${st.doubled ? `<em>x${mult}</em>` : ''}</b></div>
        </div>
        ${r.unlocked ? `<div class="unlock">${icon('flag')}<span>${esc(t('results.unlocked', { track: unlockName }))}</span></div>` : ''}
        ${dbl}
        <button class="btn big orange" data-act="continue"><span>${esc(t('results.continue'))}</span>${icon('arrowR')}</button>
      </div>
    </div></div>`;
  }

  // ------------------------------------------------------------------ HUD

  private buildHud(): void {
    const el = this.layers.hud;
    el.hidden = true;
    el.innerHTML = `
      <div class="hud">
        <div class="hud-tl">
          <div class="pos"><span class="plab" data-t="hud.place"></span><b class="pn">1</b><span class="pt">/8</span></div>
          <div class="lapbox"><span class="plab" data-t="hud.lap"></span><b class="lapn">1/3</b></div>
          <div class="cardmg" data-act="repair" role="button" tabindex="0">
            <div class="car-wrap">${CAR_ZONES_SVG}</div>
            <div class="rep"><span class="rk" data-t="hud.repairKey"></span><span class="rc">${icon('coin')}<b class="rcn">0</b></span></div>
          </div>
        </div>
        <div class="hud-tc">
          <div class="timer">00:00.00</div>
          <div class="laps"><span><small data-t="hud.last"></small><b class="lastl">--</b></span><span><small data-t="hud.best"></small><b class="bestl">--</b></span></div>
        </div>
        <div class="hud-tr">
          <button class="btn round grey pausebtn" data-act="pauseBtn" data-ta="hud.pause" aria-label="">${icon('pause')}</button>
          <div class="chip money">${icon('coin')}<b class="mn">0</b></div>
        </div>
        <div class="hud-bc"><div class="speed"><b class="sp">0</b><small data-t="unit.kmh"></small></div></div>
        <div class="countdown" hidden></div>
        <div class="hud-fps"></div>
      </div>`;
    const q = <T extends HTMLElement>(s: string): T => el.querySelector(s) as T;
    const zones = new Map<string, SVGElement>();
    el.querySelectorAll<SVGElement>('[data-z]').forEach((z) => zones.set(z.dataset.z!, z));
    const showFps = typeof location !== 'undefined' && /[?&]fps\b/.test(location.search);
    this.hud = {
      place: q('.pn'), placeTotal: q('.pt'), lap: q('.lapn'), timer: q('.timer'), last: q('.lastl'), best: q('.bestl'),
      speed: q('.sp'), money: q('.mn'), countdown: q('.countdown'), zones, repair: q('.cardmg'), repairCost: q('.rcn'),
      car: q('.car-wrap'), fps: showFps || CONFIG.ui.hudFpsDebug ? q('.hud-fps') : null,
    };
    this.refreshHudText();
  }

  private refreshHudText(): void {
    this.layers.hud.querySelectorAll<HTMLElement>('[data-t]').forEach((n) => { n.textContent = t(n.dataset.t!); });
    this.layers.hud.querySelectorAll<HTMLElement>('[data-ta]').forEach((n) => { n.setAttribute('aria-label', t(n.dataset.ta!)); });
    const repKey = this.layers.hud.querySelector('.rk');
    if (repKey) repKey.textContent = this.touchMode ? t('hud.repairTap') : t('hud.repairKey');
    this.updateMoneyChip();
    this.root.dispatchEvent(new CustomEvent('ui-lang'));
  }

  private updateMoneyChip(): void {
    if (this.hud && this.hudLast.money !== this.money) {
      this.hudLast.money = this.money;
      this.hud.money.textContent = fmtMoney(this.money);
    }
  }
}

