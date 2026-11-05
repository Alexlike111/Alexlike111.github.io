// HTML/CSS user interface over the canvas (inside #ui). Bold cartoon-racing look, inline SVG icons only.
// Every visible string goes through t(); screens are re-rendered when the language changes.
import './ui.css';
import { CONFIG } from '../config';
import { lang, setLangSetting, t } from '../i18n';
import { buyUpgrade, canBuy, upgradeCost, repairCost as repairPrice } from '../meta/economy';
import { buildTrackGeometry } from '../track/spline';
import { TRACKS } from '../track/tracks';
import type { CarState, ISim, ItemType, RivalMode, SaveData, UpgradeBranch, ZoneId } from '../types';
import { BADGE_SVG, CAR_ZONES_SVG, MEDAL_SVG, icon, type IconName } from './icons';
import { carGrid, carSvg, garageHtml, rivalLabel, rivalsSheetHtml, RIVAL_MODES, type GarageTab } from './garage';
import { CONTROL_SCHEMES, controlsOr, sensOr, type ControlScheme } from '../input/schemes';
import { CAR_IDS, carIdOr, levelsOf, rivalModeOr } from '../meta/cars';

export interface UiHandlers {
  start(trackId: string): void;
  /** Main menu: start a Demolition Arena round. */
  arena?(): void;
  pause(): void;
  resume(): void;
  quit(): void;
  restart(): void;
  repair(): void;
  /** Pause menu: recenter the Tilt scheme. */
  recenter?(): void;
  /** HUD repair chip pressed (true) / released (false): in a race the repair is a hold. */
  repairHold?(on: boolean): void;
  /** Results: race the same track again (no ad). */
  retry?(): void;
  /** Results: start the given (unlocked) next track (no ad). */
  nextTrack?(id: string): void;
  /** Menu banner: reload the progress now. */
  retrySave?(): void;
  /** Use the held power-up item (HUD item button). */
  useItem?(): void;
  /** Buy the next level of `b` for car `carId` (upgrades are per car). */
  buy(b: UpgradeBranch, carId?: string): void;
  /** Garage: drive this car from now on (every car is selectable). */
  selectCar?(id: string): void;
  /** Garage: show this car on the turntable while browsing (not selected yet). */
  previewCar?(id: string): void;
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
  /** coins from drift points (already included in `reward`) */
  drift?: number;
  /** place prize / smash money (pieces broken by type) / number of pieces; `reward` is their sum plus drift */
  prize?: number; smash?: number; smashCount?: number;
  /** next track id when it is unlocked */
  nextTrack?: string | null;
}

const ITEM_ICON: Record<ItemType, IconName> = { nitro: 'bolt', shield: 'shield', repair: 'wrench', oil: 'oil', shockwave: 'wave' };

const CTL_ICON: Record<ControlScheme, IconName> = { buttons: 'ctlButtons', slide: 'ctlSlide', joystick: 'ctlJoystick', tilt: 'ctlTilt', tap: 'ctlTap' };

const esc = (s: string | number): string =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export function fmtTime(sec: number): string {
  if (!(sec > 0)) return '--:--.--';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}
const fmtMoney = (n: number): string => Math.floor(n).toLocaleString(lang() === 'ru' ? 'ru-RU' : 'en-US');

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
  private settings: SaveData['settings'] = { lang: 'auto', autoGas: false, quality: 'auto', muted: false, tutorialDone: false, camera: 'auto', controls: 'buttons', steerSens: 1, controlsPicked: false };
  private money = 0;
  private current: { name: string; render: () => void } | null = null;
  private overlayRender: (() => void) | null = null;
  private pauseState = { cost: 0, money: 0 };
  private resultsState: { r: ResultsData; doubled: boolean; busy: boolean } | null = null;
  private armed: { act: string; timer: number } | null = null;
  private touchMode = false;
  /** garage: car being looked at and the open tab */
  private gCar = '';
  private gTab: GarageTab = 'car';

  // HUD cache
  private hud: {
    place: HTMLElement; placeTotal: HTMLElement; lap: HTMLElement; timer: HTMLElement; last: HTMLElement; best: HTMLElement;
    speed: HTMLElement; money: HTMLElement; countdown: HTMLElement; zones: Map<string, SVGElement>; repair: HTMLElement; repairCost: HTMLElement;
    car: HTMLElement; fps: HTMLElement | null;
    drift: HTMLElement; driftLabel: HTMLElement; driftPts: HTMLElement; driftBar: HTMLElement;
  } | null = null;
  /** drift meter: last written key (avoids DOM writes) */
  private driftKey = '';
  /** power-up item slot: elements + last written state (avoids DOM writes) */
  private itemUi: { root: HTMLElement; btn: HTMLElement; ic: HTMLElement; name: HTMLElement; bar: HTMLElement; lines: HTMLElement } | null = null;
  private itemKey = '';
  private linesLevel = -1;
  private hudLast = { place: -1, total: -1, lap: -1, laps: -1, timer: '', last: '', best: '', speed: -1, cd: '', zones: [] as number[], cost: -1, money: -1, health: -1 };
  private lastLapShown = -1;
  private saveWarn = false;
  private repairHeld = false;
  private repairInfo = { left: 99, cd: 0, money: 0 };
  private repairKey = '';
  private pickDone: (() => void) | null = null;
  private pickSelect: ((v: ControlScheme) => void) | null = null;
  private pickCommit: ((skip: boolean) => void) | null = null;
  private fx: { pill: HTMLElement; finish: HTMLElement; smash: HTMLElement } | null = null;
  private pillTimer = 0;
  private smashTimer = 0;
  private smashSum = 0;

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
    root.addEventListener('input', this.onRange);
    root.addEventListener('change', this.onRange);
    this.buildHud();
    // HUD repair chip: hold the finger (released / cancelled / moved away = abort)
    root.addEventListener('pointerdown', (e) => {
      const chip = (e.target as Element | null)?.closest?.('.cardmg.show');
      if (!chip || !this.layers.hud.contains(chip)) return;
      this.repairHeld = true;
      this.h.repairHold?.(true);
    });
    const release = (): void => { if (this.repairHeld) { this.repairHeld = false; this.h.repairHold?.(false); } };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
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

  /** Re-draw the screen / pause menu that shows the settings (the game changed a setting by itself, e.g. Tilt fallback). */
  refreshSettingsView(): void { this.rerender(); }

  /**
   * First-run controls picker (before the first race on a touch device): cards with a picture and a line each, Buttons
   * highlighted. `done` runs after Play / Skip (the choice is already stored via the settings handler).
   */
  showControlsPicker(done: () => void): void {
    let sel: ControlScheme = controlsOr(this.settings.controls);
    this.pickDone = done;
    const draw = (): void => {
      this.layers.overlay.innerHTML = `<div class="dim"><div class="ctlpick panel">
        <h2 class="title sm">${esc(t('ctl.pickTitle'))}</h2>
        <p class="sub">${esc(t('ctl.pickSub'))}</p>
        ${this.ctlCards(sel, 'ctlPickSel')}
        <div class="pair"><button class="btn grey" data-act="ctlPickSkip"><span>${esc(t('ctl.pickSkip'))}</span></button>
        <button class="btn big green" data-act="ctlPickOk">${icon('play')}<span>${esc(t('ctl.pickOk'))}</span></button></div>
      </div></div>`;
    };
    this.pickSelect = (v) => { sel = v; draw(); };
    this.pickCommit = (skip) => {
      this.layers.overlay.replaceChildren();
      this.overlayRender = null;
      this.pickSelect = null; this.pickCommit = null;
      const s = { ...this.settings, controls: skip ? controlsOr(this.settings.controls) : sel, controlsPicked: true };
      this.settings = s;
      if (this.save) this.save = { ...this.save, settings: s };
      this.h.settings({ ...s });
      const cb = this.pickDone; this.pickDone = null;
      cb?.();
    };
    this.overlayRender = draw;
    draw();
  }

  /** Money shown in the HUD chip. */
  setMoney(m: number): void { this.money = m; this.updateMoneyChip(); }

  showMainMenu(s: SaveData): void { this.enter('menu', s, () => this.renderMenu()); }
  showGarage(s: SaveData, carId?: string): void {
    if (carId || !this.gCar || this.current?.name !== 'garage') this.gCar = carIdOr(carId ?? s.car);
    this.enter('garage', s, () => this.renderGarage());
  }
  showTrackSelect(s: SaveData): void { this.enter('tracks', s, () => this.renderTracks()); }
  showSettings(s: SaveData): void { this.enter('settings', s, () => this.renderSettings()); }

  showHud(money?: number): void {
    this.clearScreens();
    this.root.dataset.screen = 'hud';
    if (money !== undefined) this.money = money;
    this.layers.hud.hidden = false;
    this.hudLast = { place: -1, total: -1, lap: -1, laps: -1, timer: '', last: '', best: '', speed: -1, cd: '', zones: [], cost: -1, money: -1, health: -1 };
    this.updateMoneyChip();
  }

  /** New race: forget the final-lap toast, hide leftovers of the previous race. */
  resetRaceFeedback(): void {
    this.lastLapShown = -1;
    this.smashSum = 0;
    window.clearTimeout(this.pillTimer); window.clearTimeout(this.smashTimer);
    if (this.fx) { this.fx.pill.hidden = true; this.fx.finish.hidden = true; this.fx.smash.hidden = true; }
    this.repairKey = '';
    this.setRepairProgress(0);
  }

  /** Menu banner: the stored progress could not be read (nothing is saved until it loads). */
  setSaveWarning(on: boolean): void {
    if (this.saveWarn === on) return;
    this.saveWarn = on;
    if (this.current?.name === 'menu') this.current.render();
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
    // the timer freezes at the finish line (the sim keeps counting during the 2.5 s finishing delay)
    const tm = fmtTime(p.finished && p.finishTime > 0 ? p.finishTime : sim.race.phase === 'countdown' ? 0 : sim.race.time);
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
    if (L.cost !== cost) { L.cost = cost; hud.repairCost.textContent = String(cost); }
    this.updateRepairChip(p, cost);

    this.updateItem(p);

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
    this.updateDrift(p);
    if (hud.fps) hud.fps.textContent = `${Math.round(fps)} fps`;
  }

  /** Drift meter: "DRIFT x2 +350" with the boost tier colour and charge bar while drifting; flashes the banked points, a lost drift, the boost. */
  private updateDrift(p: ISim['cars'][number]): void {
    const hud = this.hud;
    if (!hud) return;
    const D = CONFIG.drift;
    let mode = '', label = '', pts = '', tier = 0, bar = 0;
    if (p.driftActive) {
      mode = 'on'; tier = p.driftTier ?? 0;
      const combo = p.driftCombo ?? 1;
      label = t('hud.drift') + (combo > 1 ? ` x${combo}` : '');
      pts = '+' + (p.driftPoints ?? 0);
      const ch = p.driftCharge ?? 0;
      bar = tier >= 3 ? 1 : (ch - (tier > 0 ? D.tierTime[tier - 1] : 0)) / (D.tierTime[tier] - (tier > 0 ? D.tierTime[tier - 1] : 0));
    } else if ((p.driftCancelT ?? 99) < 1.2) {
      mode = 'lost'; label = t('hud.driftLost');
    } else if ((p.driftBankT ?? 99) < 1.4 && (p.driftBank ?? 0) > 0) {
      mode = 'bank'; tier = p.driftBoostTier ?? 0;
      label = tier > 0 ? t('hud.boost') : t('hud.drift');
      pts = '+' + p.driftBank;
    }
    const q = Math.round(Math.max(0, Math.min(1, bar)) * 20);
    const key = `${mode}|${label}|${pts}|${tier}|${q}`;
    if (key === this.driftKey) return;
    this.driftKey = key;
    const el = hud.drift;
    el.hidden = !mode;
    el.dataset.mode = mode;
    el.dataset.tier = String(tier);
    hud.driftLabel.textContent = label;
    hud.driftPts.textContent = pts;
    hud.driftBar.style.width = `${q * 5}%`;
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
    const sc = controlsOr(this.settings.controls);
    const steerIc: Record<ControlScheme, string> = {
      buttons: `<div class="tut-steer">${icon('arrowL')}${icon('arrowR')}</div>`,
      slide: `<div class="tut-steer">${icon('arrowL')}${icon('finger')}${icon('arrowR')}</div>`,
      joystick: `<div class="tut-ic1">${icon('ctlJoystick')}</div>`,
      tilt: `<div class="tut-ic1">${icon('ctlTilt')}</div>`,
      tap: `<div class="tut-ic1">${icon('ctlTap')}</div>`,
    };
    const brakeTx = sc === 'joystick' ? 'tut.brake.joystick' : sc === 'tap' ? 'tut.brake.tap' : 'tut.brake.btn';
    const steps = isTouch
      ? [
          { ic: steerIc[sc], tx: t(`tut.${sc}.steer`) },
          { ic: `<div class="tut-drift">${icon('bolt')}</div>`, tx: t('tut.touch.drift') },
          { ic: `<div class="tut-brake"><i></i></div>`, tx: t(brakeTx) },
          { ic: `<div class="tut-smash">${icon('crash')}</div>`, tx: t('tut.smash') },
        ]
      : [
        { ic: `<div class="keys"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></div><div class="keys sub"><kbd>&uarr;</kbd><kbd>&larr;</kbd><kbd>&darr;</kbd><kbd>&rarr;</kbd></div>`, tx: t('tut.key.drive') },
        { ic: `<div class="keys"><kbd class="wide">${esc(t('tut.key.space'))}</kbd></div>`, tx: t('tut.key.drift') },
        { ic: `<div class="keys"><kbd>R</kbd><kbd>P</kbd></div>`, tx: t('tut.key.repair') },
      ];
    this.root.classList.add('tut-on');
    el.innerHTML = `<div class="tutorial panel">
      <h3 class="title sm">${esc(t('tut.title'))}</h3>
      <div class="tut-steps">${steps.map((s, i) => `<div class="tut-step"><span class="n">${i + 1}</span><div class="tut-ic">${s.ic}</div><p>${esc(s.tx)}</p></div>`).join('')}</div>
      <button class="btn green" data-act="tutorialOk">${icon('check')}<span>${esc(t('tut.ok'))}</span></button>
    </div>`;
  }

  /** The game hides the first-run sheet at the first input or GO + CONFIG.ui.tutorialHideAfterGoS (counts as seen). */
  hideTutorial(): void { this.dismissTutorial(false); }

  /** Lap pill: "LAP 1  1:02.34  -0.45" (purple = new best lap). */
  lapPill(lap: number, laps: number, time: number, delta: number | null, best: boolean): void {
    const f = this.fx;
    if (!f) return;
    const d = delta === null ? '' : `<i>${delta <= 0 ? '-' : '+'}${Math.abs(delta).toFixed(2)}</i>`;
    f.pill.innerHTML = `<span>${esc(t('hud.lapDone', { n: lap }))}<small>/${laps}</small></span><b>${fmtTime(time)}</b>${d}`;
    f.pill.dataset.state = best ? 'best' : delta !== null && delta > 0 ? 'slow' : 'ok';
    f.pill.hidden = false;
    f.pill.classList.remove('pop'); void f.pill.offsetWidth; f.pill.classList.add('pop');
    window.clearTimeout(this.pillTimer);
    this.pillTimer = window.setTimeout(() => { f.pill.hidden = true; }, CONFIG.ui.lapPillMs);
  }

  /** FINISH banner with place and time during the finishing delay. */
  showFinishBanner(place: number, time: number): void {
    const f = this.fx;
    if (!f) return;
    const ord = t('ordinal.' + Math.min(8, Math.max(1, place)));
    f.finish.innerHTML = `<b>${esc(t('hud.finish'))}</b><span>${esc(ord)} &middot; ${fmtTime(time)}</span>`;
    f.finish.dataset.pos = place <= 3 ? String(place) : '';
    f.finish.hidden = false;
    f.finish.classList.remove('pop'); void f.finish.offsetWidth; f.finish.classList.add('pop');
    f.pill.hidden = true;
  }

  /** In-race "+N" float for money from smashed objects; consecutive smashes add up. */
  smashFloat(money: number): void {
    const f = this.fx;
    if (!f || money <= 0) return;
    this.smashSum = f.smash.hidden ? money : this.smashSum + money;
    f.smash.innerHTML = `<b>+${this.smashSum}</b><small>${esc(t('hud.smash'))}</small>`;
    f.smash.hidden = false;
    f.smash.classList.remove('pop'); void f.smash.offsetWidth; f.smash.classList.add('pop');
    window.clearTimeout(this.smashTimer);
    this.smashTimer = window.setTimeout(() => { f.smash.hidden = true; this.smashSum = 0; }, CONFIG.ui.smashFloatMs);
  }

  /** Repair limits for the HUD chip: repairs left in this race, cooldown seconds, money. */
  setRepairInfo(info: { left: number; cd: number; money: number }): void {
    this.repairInfo = info;
  }

  /** Hold progress 0..1 on the repair chip (0 = idle). */
  setRepairProgress(f: number): void {
    const el = this.hud?.repair;
    if (!el) return;
    const v = Math.round(Math.max(0, Math.min(1, f)) * 50) / 50;
    el.style.setProperty('--rp', String(v));
    el.classList.toggle('holding', v > 0);
  }

  /**
   * The repair chip: only when the car is hurt (health below CONFIG.repair.showBelowHealth) and repairs are left; its hint
   * says what to do now: "Hold" when stopped, "Stop" while moving, the cooldown seconds, greyed when too poor.
   */
  private updateRepairChip(p: CarState, cost: number): void {
    const hud = this.hud;
    if (!hud) return;
    const R = CONFIG.repair;
    const hurt = cost > 0 && p.health < R.showBelowHealth && this.repairInfo.left > 0;
    const moving = Math.abs(p.speed) > R.raceMaxSpeed;
    const cd = Math.ceil(this.repairInfo.cd);
    const poor = this.repairInfo.money < cost;
    const mode = !hurt ? 'off' : cd > 0 ? 'cd' : poor ? 'poor' : moving ? 'stop' : 'go';
    const key = `${mode}|${cd}|${this.touchMode ? 1 : 0}|${lang()}`;
    if (key === this.repairKey) return;
    this.repairKey = key;
    hud.repair.classList.toggle('show', hurt);
    hud.repair.dataset.mode = mode;
    hud.repair.setAttribute('aria-disabled', String(mode !== 'go'));
    const rk = hud.repair.querySelector('.rk');
    if (rk) rk.textContent = mode === 'cd' ? `${cd}s` : mode === 'stop' ? t('hud.repairStop') : this.touchMode ? t('hud.repairHold') : t('hud.repairKey');
  }

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
      case 'arena': this.sfx('click'); this.h.arena?.(); break;
      case 'garage': this.sfx('click'); if (save) this.showGarage(save); break;
      case 'settings': this.sfx('click'); if (save) this.showSettings(save); break;
      case 'back':
        this.sfx('click');
        // leaving the garage while looking at another car: the turntable goes back to the car you drive
        if (save && this.current?.name === 'garage' && this.gCar && this.gCar !== carIdOr(save.car)) this.h.previewCar?.(carIdOr(save.car));
        if (save) this.showMainMenu(save);
        break;
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
        const car = carIdOr(this.gCar || save.car);
        if (!canBuy(save, b, car)) { this.sfx('error'); this.toast(upgradeCost(levelsOf(save, car)[b]) === null ? t('garage.maxed') : t('ui.notEnough')); break; }
        const next = buyUpgrade(save, b, car);
        if (!next) break;
        this.sfx('buy');
        this.save = next;
        this.h.buy(b, car);
        this.renderGarage();
        break;
      }
      case 'gcar': case 'gstep': {
        if (!save) break;
        const cur = CAR_IDS.indexOf(carIdOr(this.gCar || save.car));
        const id = act === 'gcar' ? carIdOr(el.dataset.id) : CAR_IDS[(cur + Number(el.dataset.d) + CAR_IDS.length) % CAR_IDS.length];
        this.sfx('click');
        this.gCar = id;
        this.h.previewCar?.(id);
        this.renderGarage();
        this.layers.screen.querySelector<HTMLElement>(`.g-chip[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center' });
        break;
      }
      case 'gtab': this.sfx('click'); this.gTab = (el.dataset.tab as GarageTab) || 'car'; this.renderGarage(); break;
      case 'gselect': {
        if (!save) break;
        const id = carIdOr(el.dataset.id);
        if (id === carIdOr(save.car)) { this.sfx('click'); break; }
        this.sfx('buy');
        this.save = { ...save, car: id };
        this.h.selectCar?.(id);
        this.toast(t('garage.nowDriving', { car: t('car.' + id) }));
        this.renderGarage();
        break;
      }
      case 'rivals': this.sfx('click'); this.openRivals(); break;
      case 'rival': this.sfx('click'); this.setRivals(el.dataset.v as RivalMode); break;
      case 'rivalCar': this.sfx('click'); this.setRivals('pick', carIdOr(el.dataset.id)); break;
      case 'sheetClose': this.sfx('click'); this.closeSheet(); break;
      case 'noop': break;
      case 'set': this.changeSetting(el.dataset.k!, el.dataset.v!); break;
      case 'resume': this.sfx('click'); this.h.resume(); break;
      case 'pauseBtn': this.sfx('click'); this.h.pause(); break;
      case 'item': this.h.useItem?.(); break;
      case 'repair': {
        const hudRepair = this.layers.hud.contains(el);
        if (hudRepair) break;   // the HUD chip is a hold (pointerdown / pointerup below), not a click
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
      case 'retry': this.sfx('click'); this.h.retry?.(); break;
      case 'nextTrack': this.sfx('click'); if (el.dataset.id) this.h.nextTrack?.(el.dataset.id); break;
      case 'retrySave': this.sfx('click'); this.h.retrySave?.(); break;
      case 'ctlPickSel': this.sfx('click'); this.pickSelect?.(controlsOr(el.dataset.v)); break;
      case 'ctlPickOk': this.sfx('click'); this.pickCommit?.(false); break;
      case 'ctlPickSkip': this.sfx('click'); this.pickCommit?.(true); break;
      case 'recenter': this.sfx('click'); this.h.recenter?.(); this.toast(t('ctl.recentered')); break;
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
    const el = this.layers.tutorial;
    this.root.classList.remove('tut-on');
    if (!el.firstElementChild) return;
    el.replaceChildren();
    if (byUser || !this.settings.tutorialDone) {
      this.settings = { ...this.settings, tutorialDone: true };
      this.h.settings({ ...this.settings });
    }
  }

  /** Steering sensitivity slider (settings screen and pause menu): the label follows live, the value is stored on release. */
  private onRange = (e: Event): void => {
    const el = e.target instanceof HTMLInputElement ? e.target : null;
    if (!el || el.dataset.range !== 'steerSens') return;
    const v = sensOr(Number(el.value) / 100);
    this.settings = { ...this.settings, steerSens: v };
    el.closest('.sens')?.querySelector('b')?.replaceChildren(`${Math.round(v * 100)}%`);
    if (e.type === 'change') {
      if (this.save) this.save = { ...this.save, settings: this.settings };
      this.h.settings({ ...this.settings });
    }
  };

  /** Cards with a picture, the name and one line per control scheme (settings screen, first-run picker). */
  private ctlCards(cur: ControlScheme, act: string): string {
    return `<div class="ctlgrid" role="group">${CONTROL_SCHEMES.map((v) =>
      `<button class="ctl-card${v === cur ? ' on' : ''}" data-act="${act}" data-k="controls" data-v="${v}" aria-pressed="${v === cur}">
        <span class="ctl-pic">${icon(CTL_ICON[v])}</span><b>${esc(t('ctl.' + v))}</b><small>${esc(t('ctl.' + v + '.d'))}</small></button>`).join('')}</div>`;
  }

  private sensRow(): string {
    const pct = Math.round(sensOr(this.settings.steerSens) * 100);
    return `<label class="sens"><span>${esc(t('ctl.sens'))}</span><input type="range" min="${Math.round(CONFIG.controls.sensMin * 100)}" max="${Math.round(CONFIG.controls.sensMax * 100)}" step="10" value="${pct}" data-range="steerSens" aria-label="${esc(t('ctl.sens'))}"><b>${pct}%</b></label>`;
  }

  /** Compact controls block of the pause menu: one icon per scheme, the chosen one described, sensitivity, tilt recenter. */
  private pauseControls(): string {
    const cur = controlsOr(this.settings.controls);
    return `<div class="ctlpause">
      <div class="ctlrow" role="group" aria-label="${esc(t('settings.controls'))}">${CONTROL_SCHEMES.map((v) =>
        `<button class="ctl-ic${v === cur ? ' on' : ''}" data-act="set" data-k="controls" data-v="${v}" aria-pressed="${v === cur}" aria-label="${esc(t('ctl.' + v))}">${icon(CTL_ICON[v])}</button>`).join('')}</div>
      <p class="ctl-desc"><b>${esc(t('ctl.' + cur))}</b> ${esc(t('ctl.' + cur + '.d'))}</p>
      ${this.sensRow()}
      ${cur === 'tilt' ? `<button class="btn blue" data-act="recenter"><span>${esc(t('ctl.recenter'))}</span></button>` : ''}
    </div>`;
  }

  private changeSetting(k: string, v: string): void {
    const s = { ...this.settings };
    if (k === 'lang') { s.lang = v as SaveData['settings']['lang']; setLangSetting(s.lang); }
    else if (k === 'quality') s.quality = v as SaveData['settings']['quality'];
    else if (k === 'autoGas') s.autoGas = v === '1';
    else if (k === 'controls') { s.controls = controlsOr(v); s.controlsPicked = true; }
    else if (k === 'camera') s.camera = v as SaveData['settings']['camera'];
    else if (k === 'muted') s.muted = v === '1';
    else if (k === 'rivals') { s.rivals = rivalModeOr(v); if (s.rivals === 'pick' && !s.rivalCar) s.rivalCar = carIdOr(this.save?.car); }
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
      ${this.saveWarn ? `<div class="savewarn" role="alert"><span>${esc(t('save.warn'))}</span><button class="btn grey sm" data-act="retrySave">${esc(t('save.retry'))}</button></div>` : ''}
      <div class="menu-main">
        <div class="logo" role="img" aria-label="${esc(CONFIG.title)}">
          <div class="logo-a">SMASH</div>
          <div class="logo-b"><i class="checker"></i><span>CIRCUIT</span><i class="checker"></i></div>
          <div class="logo-tag">${esc(t('menu.tagline'))}</div>
        </div>
        <div class="menu-buttons">
          <button class="btn big orange" data-act="play">${icon('play')}<span>${esc(t('menu.play'))}</span></button>
          <button class="btn red" data-act="arena">${icon('crash')}<span>${esc(t('arena.title'))}</span></button>
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
    const car = carIdOr(s.car), r = this.rivalState();
    const paint = CONFIG.render.carColors[s.carColor % CONFIG.render.carColors.length];
    const pre = `<div class="prerace">
      <button class="pr-btn" data-act="garage"><small>${esc(t('prerace.yourCar'))}</small>${carSvg(car, paint)}<b>${esc(t('car.' + car))}</b></button>
      <button class="pr-btn" data-act="rivals"><small>${esc(t('rivals.title'))}</small>${r.mode === 'pick' || r.mode === 'same' ? carSvg(r.mode === 'pick' ? carIdOr(r.car ?? s.car) : car, r.mode === 'pick' ? CONFIG.render.carColors[2] : paint) : icon('trophy')}<b>${esc(rivalLabel(r.mode, r.car))}</b></button>
    </div>`;
    this.setScreen('tracks', `${this.header('tracks.title')}${pre}<div class="cards">${cards}</div>`);
  }

  private renderGarage(): void {
    const s = this.save!;
    if (!this.gCar) this.gCar = carIdOr(s.car);
    const keepScroll = this.layers.screen.querySelector<HTMLElement>('.g-strip')?.scrollLeft ?? 0;
    this.setScreen('garage', garageHtml({ save: s, shown: this.gCar, tab: this.gTab, fmtMoney, header: this.header('garage.title') }));
    const strip = this.layers.screen.querySelector<HTMLElement>('.g-strip');
    if (strip) strip.scrollLeft = keepScroll;
  }

  // ------------------------------------------------------------------ rivals (pre-race sheet + settings)

  private rivalState(): { mode: RivalMode; car?: string } {
    return { mode: rivalModeOr(this.settings.rivals), car: this.settings.rivalCar };
  }

  private setRivals(mode: RivalMode, car?: string): void {
    const s = { ...this.settings, rivals: rivalModeOr(mode) };
    if (car) s.rivalCar = car;
    else if (s.rivals === 'pick' && !s.rivalCar) s.rivalCar = carIdOr(this.save?.car);
    this.settings = s;
    if (this.save) this.save = { ...this.save, settings: s };
    this.h.settings({ ...s });
    this.rerender();
  }

  private openRivals(): void {
    this.overlayRender = () => this.renderRivalsSheet();
    this.renderRivalsSheet();
  }

  private renderRivalsSheet(): void {
    const r = this.rivalState();
    const s = this.save;
    this.layers.overlay.innerHTML = rivalsSheetHtml(r.mode, r.car, carIdOr(s?.car), CONFIG.render.carColors[(s?.carColor ?? 0) % CONFIG.render.carColors.length]);
  }

  private closeSheet(): void {
    this.overlayRender = null;
    this.layers.overlay.replaceChildren();
    if (this.current?.name === 'tracks') this.renderTracks();
  }

  private seg(k: string, cur: string, opts: { v: string; label: string }[]): string {
    return `<div class="seg n${opts.length}" role="group">${opts.map((o) =>
      `<button class="${o.v === cur ? 'on' : ''}" data-act="set" data-k="${k}" data-v="${o.v}" aria-pressed="${o.v === cur}"><span>${esc(o.label)}</span></button>`).join('')}</div>`;
  }

  /** 'auto' shows as what it resolves to: rotating on touch devices, fixed north-up elsewhere */
  private cameraShown(c: SaveData['settings']['camera']): 'rotating' | 'fixed' {
    return c === 'auto' ? (this.touchMode ? 'rotating' : 'fixed') : c;
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
        <div class="srow s-ctl"><div class="sl2"><span class="sic">${icon('finger')}</span><div><b>${esc(t('settings.controls'))}</b></div></div>
          ${this.ctlCards(controlsOr(st.controls), 'set')}${this.sensRow()}</div>
        ${row(icon('speed'), t('settings.quality'), this.seg('quality', st.quality, [
          { v: 'auto', label: t('settings.auto') }, { v: 'low', label: t('settings.low') }, { v: 'medium', label: t('settings.medium') }, { v: 'high', label: t('settings.high') },
        ]))}
        ${row(icon('flag'), t('settings.camera'), this.seg('camera', this.cameraShown(st.camera), [
          { v: 'rotating', label: t('settings.camera.rotating') }, { v: 'fixed', label: t('settings.camera.fixed') },
        ]), t('settings.camera.hint'))}
        ${row(st.muted ? icon('speakerOff') : icon('speakerOn'), t('settings.sound'), toggle('muted', !st.muted))}
        ${row(icon('trophy'), t('rivals.title'), this.seg('rivals', rivalModeOr(st.rivals), RIVAL_MODES.map((m) => ({ v: m, label: t('rivals.short.' + m) }))), t('rivals.' + rivalModeOr(st.rivals) + '.hint'))}
        ${rivalModeOr(st.rivals) === 'pick' ? `<div class="srow s-cars">${carGrid('rivalCar', carIdOr(st.rivalCar ?? this.save?.car), CONFIG.render.carColors[2], 'g-strip')}</div>` : ''}
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
      ${this.touchMode ? this.pauseControls() : ''}
      <div class="drift-hint">${icon('bolt')}<span>${esc(t(this.touchMode ? 'pause.driftTouch' : 'pause.driftKeys'))}</span></div>
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
          ${r.prize !== undefined ? `<div class="rr sub"><span>${icon('flag')}${esc(t('results.prize'))}</span><b>+${fmtMoney(r.prize)}</b></div>` : ''}
          ${r.smash ? `<div class="rr sub"><span>${icon('crash')}${esc(t('results.smash', { n: r.smashCount ?? 0 }))}</span><b>+${fmtMoney(r.smash)}</b></div>` : ''}
          ${r.drift ? `<div class="rr sub"><span>${icon('bolt')}${esc(t('results.drift'))}</span><b>+${fmtMoney(r.drift)}</b></div>` : ''}
          <div class="rr reward${st.doubled ? ' dbl' : ''}"><span>${icon('coin')}${esc(t('results.reward'))}</span><b>+${fmtMoney(reward)}${st.doubled ? `<em>x${mult}</em>` : ''}</b></div>
        </div>
        ${r.unlocked ? `<div class="unlock">${icon('flag')}<span>${esc(t('results.unlocked', { track: unlockName }))}</span></div>` : ''}
        ${dbl}
        <button class="btn big orange" data-act="retry">${icon('restart')}<span>${esc(t('results.again'))}</span></button>
        <div class="pair res-pair">
          ${r.nextTrack ? `<button class="btn green" data-act="nextTrack" data-id="${esc(r.nextTrack)}"><span>${esc(t('results.next'))}</span>${icon('arrowR')}</button>` : ''}
          <button class="btn grey" data-act="continue"><span>${esc(t('results.continue'))}</span>${r.nextTrack ? '' : icon('arrowR')}</button>
        </div>
      </div>
    </div></div>`;
  }

  // ------------------------------------------------------------------ HUD

  private buildHud(): void {
    const el = this.layers.hud;
    el.hidden = true;
    el.innerHTML = `
      <div class="hud">
        <div class="speedlines"></div>
        <div class="hud-tl">
          <div class="pos"><span class="plab" data-t="hud.place"></span><b class="pn">1</b><span class="pt">/8</span></div>
          <div class="lapbox"><span class="plab" data-t="hud.lap"></span><b class="lapn">1/3</b></div>
          <div class="cardmg" data-act="repair" data-ui role="button" tabindex="0">
            <div class="car-wrap">${CAR_ZONES_SVG}</div>
            <div class="rep"><span class="rk"></span><span class="rc">${icon('coin')}<b class="rcn">0</b></span><i class="rbar"></i></div>
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
        <div class="hud-bc"><div class="driftm" hidden><div class="dl"><b class="dlab"></b><span class="dpts"></span></div><div class="dbar"><i></i></div></div><div class="speed"><b class="sp">0</b><small data-t="unit.kmh"></small></div></div>
        <div class="hud-item" hidden>
          <button class="item-slot" type="button" data-act="item" data-ta="hud.itemTap" aria-label=""><span class="item-ic"></span><b class="item-key">E</b><i class="item-bar"></i></button>
          <div class="item-name"></div>
        </div>
        <div class="lappill" hidden></div>
        <div class="finishban" hidden></div>
        <div class="smashfloat" hidden></div>
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
      drift: q('.driftm'), driftLabel: q('.dlab'), driftPts: q('.dpts'), driftBar: q('.dbar i'),
    };
    this.fx = { pill: q('.lappill'), finish: q('.finishban'), smash: q('.smashfloat') };
    this.driftKey = '';
    this.itemKey = '';
    this.linesLevel = -1;
    this.itemUi = {
      root: q('.hud-item'), btn: q('.item-slot'), ic: q('.item-ic'), name: q('.item-name'), bar: q('.item-bar'), lines: q('.speedlines'),
    };
    this.refreshHudText();
  }

  /**
   * Power-up HUD: the held item (icon + name + key hint), a bar for a running shield / nitro, and the speed lines that
   * show a boost. Writes the DOM only when the quantised state changes.
   */
  private updateItem(p: CarState): void {
    const u = this.itemUi;
    if (!u) return;
    const item = p.item ?? null;
    const I = CONFIG.items;
    let active = 0;
    if ((p.shieldT ?? 0) > 0) active = Math.ceil(20 * (p.shieldT ?? 0) / I.shield.time);
    else if ((p.nitroT ?? 0) > 0) active = Math.ceil(20 * (p.nitroT ?? 0) / I.nitro.time);
    // while a shield / nitro runs with the slot empty, the slot shows that effect (dimmed) with its remaining-time bar
    const shown: ItemType | null = item ?? ((p.shieldT ?? 0) > 0 ? 'shield' : (p.nitroT ?? 0) > 0 ? 'nitro' : null);
    const key = `${item}|${shown}|${active}|${this.touchMode ? 1 : 0}`;
    if (key !== this.itemKey) {
      this.itemKey = key;
      const had = u.root.dataset.item ?? '';
      u.root.dataset.item = shown ?? '';
      u.root.hidden = !shown && this.touchMode;
      u.root.classList.toggle('empty', !item);
      u.root.classList.toggle('running', active > 0);
      if ((shown ?? '') !== had) {
        u.ic.innerHTML = shown ? icon(ITEM_ICON[shown]) : '';
        u.name.textContent = shown ? t('item.' + shown) : '';
        u.btn.setAttribute('aria-label', shown ? t('item.' + shown) : t('hud.itemTap'));
        if (item) { u.root.classList.remove('got'); void u.root.offsetWidth; u.root.classList.add('got'); }
      }
      u.bar.style.transform = `scaleX(${(active / 20).toFixed(2)})`;
    }
    const boosting = ((p.boostT ?? 0) > 0 || (p.nitroT ?? 0) > 0) ? 1 : 0;
    if (boosting !== this.linesLevel) {
      this.linesLevel = boosting;
      u.lines.classList.toggle('on', boosting > 0);
    }
  }

  private refreshHudText(): void {
    this.layers.hud.querySelectorAll<HTMLElement>('[data-t]').forEach((n) => { n.textContent = t(n.dataset.t!); });
    this.layers.hud.querySelectorAll<HTMLElement>('[data-ta]').forEach((n) => { n.setAttribute('aria-label', t(n.dataset.ta!)); });
    this.repairKey = '';
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

