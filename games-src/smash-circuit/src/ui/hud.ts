// In-race HUD extras on top of ui.ts: minimap, gap chips, position-change flash, floating "+N" at smashed objects, smash
// combo, takedown banner. Reads sim state only. DOM is built once and mutated in place (no per-frame allocation).
import './hud.css';
import { CONFIG } from '../config';
import { t } from '../i18n';
import type { CarState, ISim, SimEvent } from '../types';
import {
  ComboTracker, PlaceWatcher, TakedownTracker, computeGaps, fitMap, fmtGap, fmtMult, gapTrend, mapPoint, type MapFit,
} from './hudLogic';

/** One smashed piece of the player: where, and its base pay in coins (see Sim.takeSmashes). */
export interface SmashItem { x: number; y: number; money: number }

interface GapChip { root: HTMLElement; val: HTMLElement; name: HTMLElement; prev: number | null; key: string }

const hex = (n: number): string => '#' + n.toString(16).padStart(6, '0');

export class HudExtras {
  private readonly H = CONFIG.hud;
  private readonly host: HTMLElement;
  private readonly fxRoot: HTMLElement;
  // minimap
  private readonly mapWrap: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private base: HTMLCanvasElement | null = null;
  private fit: MapFit | null = null;
  private mapPx = 0;
  private mapAcc = 0;
  // gaps
  private readonly gapWrap: HTMLElement;
  private readonly gapA: GapChip;
  private readonly gapB: GapChip;
  private gapAcc = 0;
  // banners
  private readonly ovt: HTMLElement;
  private readonly slam: HTMLElement;
  private readonly combo: HTMLElement;
  private readonly flash: HTMLElement;
  private ovtTimer = 0;
  private slamTimer = 0;
  private comboTimer = 0;
  private readonly comboBar: HTMLElement;
  private readonly comboMain: HTMLElement;
  private readonly comboSub: HTMLElement;
  // floats
  private readonly floats: HTMLElement[] = [];
  private readonly floatTimers: number[] = [];
  private floatI = 0;
  // logic
  private readonly comboTrack = new ComboTracker();
  private readonly places = new PlaceWatcher();
  private readonly takedowns = new TakedownTracker();
  private sim: ISim | null = null;
  private slams = 0;
  private slamBonus = 0;
  private resizeObs: ResizeObserver | null = null;

  /** `hud` = the `.hud` element of ui.ts (use `UI.hudRoot()`). */
  constructor(hud: HTMLElement) {
    this.host = hud;
    // ---- minimap: right column, under the pause button and the coins chip
    this.mapWrap = document.createElement('div');
    this.mapWrap.className = 'hx-map';
    this.mapWrap.hidden = true;
    this.mapWrap.setAttribute('role', 'img');
    this.mapWrap.dataset.ta = 'hud.map';
    this.mapWrap.setAttribute('aria-label', t('hud.map'));
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.mapWrap.appendChild(this.canvas);
    hud.querySelector('.hud-tr')?.appendChild(this.mapWrap);

    // ---- gap chips: left column, under the damage card
    this.gapWrap = document.createElement('div');
    this.gapWrap.className = 'hx-gaps';
    this.gapWrap.hidden = true;
    this.gapA = this.makeGap('up', 'hud.gapAhead');
    this.gapB = this.makeGap('dn', 'hud.gapBehind');
    this.gapWrap.append(this.gapA.root, this.gapB.root);
    hud.querySelector('.hud-tl')?.appendChild(this.gapWrap);

    // ---- overlay for floats and banners (never takes touches)
    this.fxRoot = document.createElement('div');
    this.fxRoot.className = 'hx';
    this.flash = document.createElement('div');
    this.flash.className = 'hx-flash';
    this.ovt = document.createElement('div');
    this.ovt.className = 'hx-ovt';
    this.ovt.hidden = true;
    this.slam = document.createElement('div');
    this.slam.className = 'hx-slam';
    this.slam.hidden = true;
    this.combo = document.createElement('div');
    this.combo.className = 'hx-combo';
    this.combo.hidden = true;
    this.comboMain = document.createElement('b');
    this.comboSub = document.createElement('span');
    this.comboBar = document.createElement('i');
    this.combo.append(this.comboMain, this.comboSub, this.comboBar);
    this.fxRoot.append(this.flash, this.ovt, this.slam, this.combo);
    for (let i = 0; i < this.H.floatMax; i++) {
      const f = document.createElement('div');
      f.className = 'hx-float';
      f.hidden = true;
      this.floats.push(f);
      this.floatTimers.push(0);
      this.fxRoot.appendChild(f);
    }
    hud.appendChild(this.fxRoot);
  }

  private makeGap(cls: 'up' | 'dn', aria: string): GapChip {
    const root = document.createElement('div');
    root.className = `hx-gap ${cls}`;
    root.hidden = true;
    root.dataset.ta = aria;
    root.setAttribute('aria-label', t(aria));
    const ar = document.createElement('i');
    ar.className = 'ar';
    const val = document.createElement('b');
    const name = document.createElement('small');
    root.append(ar, val, name);
    return { root, val, name, prev: null, key: '' };
  }

  // ------------------------------------------------------------------ race lifecycle

  /** New race: build the minimap, clear every tracker and banner. */
  start(sim: ISim): void {
    this.sim = sim;
    this.comboTrack.reset();
    this.places.reset();
    this.takedowns.reset();
    this.slams = 0; this.slamBonus = 0;
    this.gapAcc = 0; this.mapAcc = 0;
    this.gapA.prev = null; this.gapB.prev = null; this.gapA.key = ''; this.gapB.key = '';
    this.clearBanners();
    this.mapWrap.hidden = false;   // visible first: the canvas size is read from the layout
    this.buildMap(sim);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObs?.disconnect();
      this.resizeObs = new ResizeObserver(() => { if (this.sim) this.buildMap(this.sim); });
      this.resizeObs.observe(this.mapWrap);
    }
  }

  /** Race over / back to the menu. */
  stop(): void {
    this.sim = null;
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    this.mapWrap.hidden = true;
    this.gapWrap.hidden = true;
    this.clearBanners();
  }

  /** Coins earned from combo multipliers and takedowns this race (added to the smash money; the per-race cap still applies). */
  get bonusMoney(): number { return this.comboTrack.bonusTotal + this.slamBonus; }
  get bestChain(): number { return this.comboTrack.best; }
  get takedownCount(): number { return this.slams; }

  private clearBanners(): void {
    window.clearTimeout(this.ovtTimer); window.clearTimeout(this.slamTimer); window.clearTimeout(this.comboTimer);
    this.ovt.hidden = true; this.slam.hidden = true; this.combo.hidden = true;
    this.floatTimers.forEach((id) => window.clearTimeout(id));
    this.floats.forEach((f) => { f.hidden = true; });
  }

  // ------------------------------------------------------------------ per frame

  /**
   * Call once per live frame. `smashes` = pieces the player broke since the last call, `project` maps a physics point to
   * screen fractions (0..1, y down) or null. Returns the takedowns found this frame (the game plays a sound).
   */
  frame(sim: ISim, events: readonly SimEvent[], dt: number, smashes: readonly SmashItem[], project: ((x: number, y: number) => { x: number; y: number } | null) | null): number {
    if (this.sim !== sim) this.start(sim);
    const p = sim.cars[0];
    if (!p) return 0;
    const now = sim.race.time;
    const racing = sim.race.phase === 'racing' && !p.finished;

    // position change flash
    if (!racing || now < this.H.placeStartGraceS) this.places.rebase(p.place);
    else {
      const ch = this.places.update(p.place, dt);
      if (ch) this.showPlaceChange(ch.from, ch.to, sim);
    }

    // smashes: float at the object + chain
    if (racing) for (const s of smashes) this.onSmash(s, now, project);
    const ended = this.comboTrack.tick(now);
    if (this.comboTrack.active(now)) this.updateCombo(now);
    else if (ended && !this.combo.hidden) this.endCombo();

    // takedowns
    let td = 0;
    if (racing && events.length) {
      for (const d of this.takedowns.update(events, sim.cars, now)) {
        td++;
        this.slams++;
        this.slamBonus += this.H.takedownCoins;
        const v = sim.cars.find((c) => c.id === d.carId) ?? p;
        this.showTakedown(d.name, project ? project(v.x, v.y) : null);
      }
    }

    // gaps (8 Hz) and minimap (30 Hz)
    this.gapAcc += dt;
    if (this.gapAcc >= this.H.gapRefreshS) { const d = this.gapAcc; this.gapAcc = 0; this.updateGaps(sim, racing, d); }
    this.mapAcc += dt;
    if (this.mapAcc >= this.H.mapRedrawS) { this.mapAcc = 0; this.drawMap(sim); }
    return td;
  }

  // ------------------------------------------------------------------ gaps

  private updateGaps(sim: ISim, racing: boolean, _dt: number): void {
    const g = racing ? computeGaps(sim.cars, 0) : { ahead: null, behind: null };
    this.setGap(this.gapA, g.ahead, true);
    this.setGap(this.gapB, g.behind, false);
    this.gapWrap.hidden = !(g.ahead || g.behind);
  }

  private setGap(chip: GapChip, info: { name: string; gap: number } | null, ahead: boolean): void {
    if (!info) {
      if (!chip.root.hidden) chip.root.hidden = true;
      chip.prev = null; chip.key = '';
      return;
    }
    const tr = gapTrend(chip.prev, info.gap);
    chip.prev = info.gap;
    // closing on the car ahead is good news (green), the car behind closing on the player is a warning (red)
    const mood = tr === 0 ? 'flat' : (tr < 0) === ahead ? 'good' : 'bad';
    const text = (ahead ? '-' : '+') + fmtGap(info.gap);
    const key = `${text}|${info.name}|${mood}`;
    if (key === chip.key) return;
    chip.key = key;
    chip.val.textContent = text;
    chip.name.textContent = info.name;
    chip.root.dataset.mood = mood;
    chip.root.hidden = false;
  }

  // ------------------------------------------------------------------ position change

  private showPlaceChange(from: number, to: number, sim: ISim): void {
    const up = to < from;
    const rival = up ? sim.cars.find((c) => c.id !== 0 && c.place === to + 1)?.name ?? '' : sim.cars.find((c) => c.id !== 0 && c.place === to - 1)?.name ?? '';
    this.ovt.dataset.dir = up ? 'up' : 'down';
    this.ovt.innerHTML = `<small>${esc(t(up ? 'hud.overtake' : 'hud.passed'))}</small><b><span>P${from}</span><i></i><span>P${to}</span></b>${rival ? `<em>${esc(rival)}</em>` : ''}`;
    this.restart(this.ovt);
    window.clearTimeout(this.ovtTimer);
    this.ovtTimer = window.setTimeout(() => { this.ovt.hidden = true; }, up ? this.H.placeFlashMs : this.H.placeFlashMs * 0.7);
    if (up) this.pulse('good');
  }

  // ------------------------------------------------------------------ smash float + combo

  private onSmash(s: SmashItem, now: number, project: ((x: number, y: number) => { x: number; y: number } | null) | null): void {
    const hit = this.comboTrack.hit(s.money, now);
    const pos = project ? project(s.x, s.y) : null;
    if (hit.award > 0) this.spawnFloat(`+${hit.award}`, pos, hit.mult >= 2 ? 'hot' : hit.mult > 1 ? 'warm' : '');
    else if (hit.chain >= this.H.comboShowFrom) this.spawnFloat('+0', pos, 'dim');
    this.updateCombo(now, true);
  }

  private updateCombo(now: number, pop = false): void {
    const c = this.comboTrack;
    if (c.chain < this.H.comboShowFrom) return;
    const mult = Math.min(this.H.comboMax, 1 + this.H.comboStep * (c.chain - 1));
    const hot = mult >= this.H.comboMax ? '3' : mult >= 2 ? '2' : '1';
    if (this.combo.hidden || pop) {
      this.comboMain.textContent = t('hud.combo', { n: fmtMult(mult) });
      this.comboSub.textContent = t('hud.comboSub', { n: c.chain, coins: c.sum });
      this.combo.dataset.tier = hot;
      this.combo.hidden = false;
      if (pop) this.restart(this.combo);
    }
    window.clearTimeout(this.comboTimer);
    this.comboBar.style.transform = `scaleX(${c.remaining(now).toFixed(2)})`;
  }

  private endCombo(): void {
    window.clearTimeout(this.comboTimer);
    this.comboTimer = window.setTimeout(() => { if (!this.comboTrack.active(this.sim?.race.time ?? 0)) this.combo.hidden = true; }, this.H.comboHoldMs);
    this.comboBar.style.transform = 'scaleX(0)';
  }

  private spawnFloat(text: string, pos: { x: number; y: number } | null, cls: string): void {
    const f = this.floats[this.floatI];
    window.clearTimeout(this.floatTimers[this.floatI]);
    const i = this.floatI;
    this.floatI = (this.floatI + 1) % this.floats.length;
    const W = this.host.clientWidth || window.innerWidth, Hh = this.host.clientHeight || window.innerHeight;
    // no projection (debug / tests): drop it above the screen centre
    const x = (pos ? pos.x : 0.5) * W, y = (pos ? pos.y : 0.45) * Hh;
    f.style.left = `${Math.max(24, Math.min(W - 24, x)).toFixed(0)}px`;
    f.style.top = `${Math.max(24, Math.min(Hh - 24, y)).toFixed(0)}px`;
    f.className = `hx-float ${cls}`;
    f.textContent = text;
    f.hidden = false;
    this.restart(f);
    this.floatTimers[i] = window.setTimeout(() => { f.hidden = true; }, this.H.floatMs);
  }

  // ------------------------------------------------------------------ takedown

  private showTakedown(name: string, pos: { x: number; y: number } | null): void {
    this.slam.innerHTML = `<b>${esc(t('hud.slam'))}</b><span>${esc(t('hud.slamSub', { name }))}</span><em>+${this.H.takedownCoins}</em>`;
    this.restart(this.slam);
    window.clearTimeout(this.slamTimer);
    this.slamTimer = window.setTimeout(() => { this.slam.hidden = true; }, this.H.takedownMs);
    this.pulse('slam');
    if (pos) this.spawnFloat(`+${this.H.takedownCoins}`, pos, 'hot');
  }

  /** Brief full-screen colour pulse at the edges. */
  private pulse(kind: 'good' | 'slam'): void {
    this.flash.dataset.kind = kind;
    this.restart(this.flash);
  }

  /** Show + replay the pop animation of an element. */
  private restart(el: HTMLElement): void {
    el.hidden = false;
    el.classList.remove('go');
    void el.offsetWidth;
    el.classList.add('go');
  }

  // ------------------------------------------------------------------ minimap

  /** Build the static layer (track outline, start line) at the current CSS size of the map. */
  private buildMap(sim: ISim): void {
    const css = this.mapWrap.clientWidth || this.mapWrap.getBoundingClientRect().width;
    if (!css || !this.ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.max(48, Math.round(css * dpr));
    if (px === this.mapPx && this.base) return;
    this.mapPx = px;
    this.canvas.width = px; this.canvas.height = px;
    const S = sim.track.samples;
    const step = Math.max(1, Math.round(S.length / 220));
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < S.length; i += step) { xs.push(S[i].x); ys.push(S[i].y); }
    this.fit = fitMap(xs, ys, px, px * 0.1);
    const base = document.createElement('canvas');
    base.width = px; base.height = px;
    const g = base.getContext('2d');
    if (!g) return;
    g.lineJoin = 'round'; g.lineCap = 'round';
    const path = (): void => {
      g.beginPath();
      for (let i = 0; i < xs.length; i++) {
        const q = mapPoint(this.fit!, xs[i], ys[i]);
        if (i) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y);
      }
      g.closePath();
    };
    path(); g.strokeStyle = '#0b1430'; g.lineWidth = px * 0.082; g.stroke();
    path(); g.strokeStyle = '#e9eefc'; g.lineWidth = px * 0.05; g.stroke();
    // start / finish line
    const s0 = sim.track.sampleAt(0);
    const a = mapPoint(this.fit, s0.x + s0.nx * 7, s0.y + s0.ny * 7), b = mapPoint(this.fit, s0.x - s0.nx * 7, s0.y - s0.ny * 7);
    g.strokeStyle = '#0b1430'; g.lineWidth = px * 0.045;
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    g.strokeStyle = '#ff5a36'; g.lineWidth = px * 0.026;
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    this.base = base;
    this.drawMap(sim);
  }

  private drawMap(sim: ISim): void {
    const g = this.ctx, fit = this.fit;
    if (!g || !fit || !this.base || this.mapWrap.hidden) return;
    const px = this.mapPx;
    g.clearRect(0, 0, px, px);
    g.drawImage(this.base, 0, 0);
    // ready item boxes
    const boxes = sim.boxes;
    if (boxes) {
      const r = px * 0.024;
      g.fillStyle = '#ffd34d'; g.strokeStyle = '#0b1430'; g.lineWidth = px * 0.012;
      for (const b of boxes) {
        if (!b.ready) continue;
        const q = mapPoint(fit, b.x, b.y);
        g.beginPath(); g.rect(q.x - r, q.y - r, r * 2, r * 2); g.fill(); g.stroke();
      }
    }
    // rivals first, the player on top
    const cars = sim.cars;
    const palette = CONFIG.render.carColors;
    for (let i = cars.length - 1; i >= 0; i--) {
      const c = cars[i];
      if (c.isPlayer) continue;
      this.drawDot(g, fit, c, px * 0.036, hex(palette[c.colorIndex % palette.length]), false);
    }
    const p = cars.find((c) => c.isPlayer);
    if (p) this.drawDot(g, fit, p, px * 0.056, '#ffc93c', true);
  }

  private drawDot(g: CanvasRenderingContext2D, fit: MapFit, c: CarState, r: number, color: string, player: boolean): void {
    const q = mapPoint(fit, c.x, c.y);
    g.globalAlpha = c.finished && !player ? 0.45 : 1;
    if (player) {
      // heading arrow (map y is flipped)
      const hx = Math.cos(c.angle), hy = -Math.sin(c.angle);
      g.fillStyle = '#ffffff'; g.strokeStyle = '#0b1430'; g.lineWidth = r * 0.32;
      g.beginPath();
      g.moveTo(q.x + hx * r * 2.1, q.y + hy * r * 2.1);
      g.lineTo(q.x - hx * r * 0.2 - hy * r * 1.15, q.y - hy * r * 0.2 + hx * r * 1.15);
      g.lineTo(q.x - hx * r * 0.2 + hy * r * 1.15, q.y - hy * r * 0.2 - hx * r * 1.15);
      g.closePath(); g.stroke(); g.fill();
    }
    g.fillStyle = color; g.strokeStyle = player ? '#ffffff' : '#0b1430'; g.lineWidth = r * (player ? 0.42 : 0.5);
    g.beginPath(); g.arc(q.x, q.y, r, 0, Math.PI * 2); g.stroke(); g.fill();
    g.globalAlpha = 1;
  }
}

const esc = (s: string | number): string =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
