// Integration: boot order, game loop and flow (menu -> race -> results -> interstitial -> menu).
// Owns the only mutable SaveData copy; every other module receives data through handlers.
import { CONFIG } from './config';
import { initLang, lang, t } from './i18n';
import { AudioManager } from './audio/audio';
import { InputController } from './input/input';
import { applyRaceResult, buyUpgrade, nextTrackId, raceRewardParts, repairCost } from './meta/economy';
import { makeOpponents, makePlayerSetup, rivalChoiceOf } from './meta/opponents';
import { carIdOr } from './meta/cars';
import { defaultSave, loadSave, writeSave, type SaveStatus } from './meta/save';
import { StuckWatch, pickResetPose } from './playerReset';
import { platform } from './platform/bridge';
import { GameRenderer } from './render';
import { missingHp } from './sim/damage';
import { DriftTracker, driftCoins } from './sim/drift';
import * as carModel from './sim/carModel';
import { Sim } from './sim/sim';
import { ARENA, ARENA_TRACK, ArenaMatch, attachArena, stepArena } from './sim/arena';
import { ArenaUi } from './ui/arena';
import { trackById } from './track/tracks';
import type { CarInput, CarState, SaveData, SimEvent, UpgradeBranch } from './types';
import { UI, type UiHandlers } from './ui/ui';

export type GameState = 'boot' | 'menu' | 'racing' | 'paused' | 'finishing' | 'results' | 'ad';

interface FinishInfo { place: number; time: number }

declare global {
  interface Window {
    __game?: {
      readonly state: GameState;
      readonly sim: Sim | null;
      readonly save: SaveData;
      /** HUD/UI instance (e2e screenshots of lap pill / finish banner) */
      readonly ui: UI;
      readonly timeScale: number;
      startRace(trackId: string): void;
      /** Demolition Arena round (src/sim/arena.ts) */
      startArena(): void;
      readonly arena: ArenaMatch | null;
      setTimeScale(n: number): void;
      forceFinish(): void;
      pause(): void;
      resume(): void;
      repair(): void;
      menu(): void;
      /** e2e: change settings like the settings screen does / the input controller (tilt recenter) */
      setSettings(s: SaveData['settings']): void;
      readonly input: InputController;
      /** pure car model for e2e/feel.mjs (debug builds only) */
      readonly model: typeof carModel & { DriftTracker: typeof DriftTracker };
    };
  }
}

export class Game {
  private save: SaveData = defaultSave();
  private renderer!: GameRenderer;
  private ui!: UI;
  private input!: InputController;
  private audio!: AudioManager;

  private state: GameState = 'boot';
  private sim: Sim | null = null;
  private trackId = 't1';
  private timeScale = 1;
  private finish: FinishInfo | null = null;
  private finishTimer = 0;
  private results: Parameters<UI['showResults']>[0] | null = null;
  private resultsReward = 0;
  /** Demolition Arena round in progress (null = race mode) */
  private arena: ArenaMatch | null = null;
  private readonly arenaUi = new ArenaUi();

  private platformPaused = false;
  private platformAudio = true;
  private adBusy = false;
  private externalAd = false;   // an ad the platform opened on its own (or that was already open at start)
  private levelOpen = false;     // level_started sent and not yet completed / failed
  private stuck = new StuckWatch();
  private dmgShown = new Set<string>();
  private dmgGap = 0;
  private lastInput: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  private userPaused = false;
  private itemHintShown = false;
  private tutorialOn = false;     // first run: the hint sheet is up (non-blocking: hides at the first input or GO + N s)
  // ---- save loading (audit #1)
  private saveStatus: SaveStatus = 'empty';
  private reloadTimer = 0;
  private reloadN = 0;
  private reloading = false;
  private pendingLoaded: SaveData | null = null;
  // ---- lap feedback (audit #5)
  private bestLapRef = 0;          // best lap time known before the current lap (saved best or this race's best)
  // ---- in-race repair (audit #21)
  private repairIntent: 'none' | 'ui' | 'key' = 'none';
  private repairProgress = 0;
  private repairsUsed = 0;
  private lastRepairAt = -999;

  private raf = 0;
  private lastT = 0;
  private framesRendered = 0;
  private readyDone = false;
  private continuing = false;

  /** Boot order: (Bridge script already loaded by the page) -> platform.init -> one save load -> language -> mute. */
  async boot(): Promise<void> {
    await platform.init();
    const loaded = await loadSave();
    this.save = loaded.save;
    this.saveStatus = loaded.status;
    initLang(platform.language(), this.save.settings.lang);
    document.documentElement.lang = lang();
    this.platformAudio = platform.isAudioEnabled();

    // Everything the platform callbacks touch is created BEFORE they are registered (an ad that is already open
    // fires watchAds immediately: audit PL3).
    const canvas = document.getElementById('gl') as HTMLCanvasElement;
    const uiRoot = document.getElementById('ui') as HTMLElement;
    this.audio = new AudioManager();
    this.applyMute();
    this.renderer = new GameRenderer(canvas, this.save.settings.quality);
    this.ui = new UI(uiRoot, this.handlers());
    this.input = new InputController(uiRoot);
    this.applyControls();
    this.input.setLabels(t('input.brake'));
    this.input.onTiltStatus((st) => this.onTiltStatus(st));
    this.input.onKey((k) => { if (k === 'pause') this.togglePause(); else if (k === 'item') this.useItem(); else this.repairNow(); });
    this.input.onTouchMode((touch) => this.ui.setTouchMode(touch));
    this.ui.setTouchMode(this.input.touchActive);
    this.ui.setSettings(this.save.settings);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'racing') this.pauseRace();
      this.syncPause();
    });
    platform.onPause((p) => { this.platformPaused = p; this.syncPause(); });
    platform.onAudio((on) => { this.platformAudio = on; this.applyMute(); });
    platform.watchAds((open) => { this.externalAd = open; this.syncPause(); });
    // A slow Bridge init finished after the boot: now the real language / audio state / saved progress are available.
    platform.onLateReady(() => this.onLateReady());

    this.installDebug();
    this.toMenu();
    if (this.saveStatus === 'failed') this.scheduleReload(true);
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------------ save loading (audit #1)

  private onLateReady(): void {
    initLang(platform.language(), this.save.settings.lang);
    document.documentElement.lang = lang();
    this.platformAudio = platform.isAudioEnabled();
    this.applyMute();
    if (this.state === 'menu') this.toMenu();
    if (this.saveStatus === 'failed') this.scheduleReload(true);
  }

  /** The stored progress could not be read: retry with backoff (or at once). Writes stay blocked meanwhile. */
  private scheduleReload(now = false): void {
    window.clearTimeout(this.reloadTimer);
    this.ui.setSaveWarning(true);
    const d = CONFIG.save.retryDelaysMs;
    const delay = now ? 0 : d[Math.min(this.reloadN, d.length - 1)];
    this.reloadTimer = window.setTimeout(() => void this.reloadProgress(), delay);
  }

  private async reloadProgress(): Promise<void> {
    if (this.reloading || this.saveStatus !== 'failed') return;
    this.reloading = true;
    try {
      await platform.waitReady(CONFIG.save.initWaitMs);
      const r = await loadSave();
      if (r.status === 'failed') { this.reloadN++; this.scheduleReload(); return; }
      this.saveStatus = r.status;
      this.reloadN = 0;
      this.pendingLoaded = r.save;
      this.adoptLoaded();
    } finally { this.reloading = false; }
  }

  /** A late successful load replaces the placeholder save, but never in the middle of a race. */
  private adoptLoaded(): void {
    if (!this.pendingLoaded) return;
    if (this.state !== 'menu' && this.state !== 'results') return;
    this.save = this.pendingLoaded;
    this.pendingLoaded = null;
    initLang(platform.language(), this.save.settings.lang);
    document.documentElement.lang = lang();
    this.ui.setSaveWarning(false);
    this.setSettings(this.save.settings);
    if (this.state === 'menu') { this.toMenu(); this.ui.toast(t('save.restored')); }
  }

  // ------------------------------------------------------------------ flow

  private handlers(): UiHandlers {
    return {
      start: (id) => this.startRace(id),
      arena: () => this.startArena(),
      pause: () => this.pauseRace(),
      resume: () => this.resumeRace(),
      quit: () => void this.leaveRace(() => this.toMenu()),
      restart: () => void this.leaveRace(() => (this.arena ? this.startArena() : this.startRace(this.trackId))),
      repair: () => this.repairNow(true),
      recenter: () => this.input.recenter(),
      repairHold: (on) => this.repairHold(on),
      retry: () => { if (this.state === 'results') this.startRace(this.trackId); },
      nextTrack: (id) => { if (this.state === 'results') this.startRace(id); },
      retrySave: () => { this.reloadN = 0; this.scheduleReload(true); },
      useItem: () => this.useItem(),
      buy: (b, carId) => this.buy(b, carId),
      selectCar: (id) => {
        this.save = { ...this.save, car: carIdOr(id) };
        this.renderer.showMenuScene(this.save.carColor, this.save.car);
        void writeSave(this.save);
      },
      previewCar: (id) => this.renderer.showMenuScene(this.save.carColor, carIdOr(id)),
      doubleReward: () => this.doubleReward(),
      settings: (s) => this.setSettings(s),
      color: (i) => {
        this.save = { ...this.save, carColor: i };
        this.renderer.showMenuScene(i);
        void writeSave(this.save);
      },
      continueAfterResults: () => void this.continueAfterResults(),
      sfx: (n) => this.audio.ui(n),
    };
  }

  private toMenu(): void {
    this.endArenaMode();
    this.userPaused = false;
    this.finish = null;
    this.results = null;
    this.tutorialOn = false;
    this.repairIntent = 'none';
    this.input?.setEnabled(false);
    this.closeLevel('failed');
    this.renderer.showMenuScene(this.save.carColor, this.save.car);
    const old = this.sim;
    this.sim = null;
    old?.dispose();
    this.state = 'menu';
    this.ui.setSettings(this.save.settings);
    this.ui.showMainMenu(this.save);
    this.ui.setSaveWarning(this.saveStatus === 'failed');
    this.audio.update(null, 0);
    this.syncPause();
    if (this.pendingLoaded) this.adoptLoaded();
  }

  startRace(trackId: string): void {
    if (this.state === 'ad' || this.continuing) return;
    this.endArenaMode();
    const def = trackById(trackId);
    if (!def || !this.save.unlockedTracks.includes(def.id)) return;
    // first race on a touch device: a one-time, skippable controls picker (Buttons highlighted)
    if (this.input.touchActive && !this.save.settings.controlsPicked && !this.pickerOpen) {
      this.pickerOpen = true;
      this.ui.setSettings(this.save.settings);
      this.ui.showControlsPicker(() => { this.pickerOpen = false; this.startRace(trackId); });
      return;
    }
    const idx = Math.max(0, CONFIG.meta.trackOrder.indexOf(def.id));
    const seed = (Math.floor(Math.random() * 0x7fffffff) ^ (Date.now() & CONFIG.game.seedMask)) >>> 0;
    const player = makePlayerSetup(this.save, 'Player');
    const cars = [player, ...makeOpponents(idx, player.stats, seed, this.save.carColor, rivalChoiceOf(this.save))];
    const old = this.sim;
    this.sim = null;
    old?.dispose();
    const sim = new Sim({ track: def, cars, seed, ghost: this.save.ghosts[def.id] });
    this.sim = sim;
    this.trackId = def.id;
    this.finish = null;
    this.results = null;
    this.userPaused = false;
    this.wasGo = false;
    this.applyCamera();
    this.renderer.loadRace(sim);
    this.state = 'racing';
    this.applyControls();
    this.input.setEnabled(true);
    this.ui.setSettings(this.save.settings);
    this.ui.setTouchMode(this.input.touchActive);
    this.ui.showHud(this.save.money);
    this.ui.resetRaceFeedback();
    this.bestLapRef = this.save.bestLap[def.id] ?? 0;
    this.repairIntent = 'none'; this.repairProgress = 0; this.repairsUsed = 0; this.lastRepairAt = -999;
    // first run: a hint sheet that never blocks the start (countdown runs; hides at the first input or GO + N s)
    this.tutorialOn = !this.save.settings.tutorialDone;
    if (this.tutorialOn) this.ui.showTutorial(this.input.touchActive);
    this.stuck.reset(); this.dmgShown.clear(); this.dmgGap = 0;
    this.closeLevel('failed');   // restarting from the pause menu abandons the previous attempt
    this.levelOpen = true;
    platform.level('started', def.id);
    this.syncPause();
  }

  // ------------------------------------------------------------------ Demolition Arena

  /** Start a Demolition Arena round: the ring arena, hunt AI, score instead of laps (race mode untouched). */
  startArena(): void {
    if (this.state === 'ad' || this.continuing) return;
    if (this.input.touchActive && !this.save.settings.controlsPicked && !this.pickerOpen) {
      this.pickerOpen = true;
      this.ui.setSettings(this.save.settings);
      this.ui.showControlsPicker(() => { this.pickerOpen = false; this.startArena(); });
      return;
    }
    this.endArenaMode();
    const seed = (Math.floor(Math.random() * 0x7fffffff) ^ (Date.now() & CONFIG.game.seedMask)) >>> 0;
    const player = makePlayerSetup(this.save, 'Player');
    const cars = [player, ...makeOpponents(1, player.stats, seed, this.save.carColor, rivalChoiceOf(this.save)).slice(0, ARENA.rivals)];
    const old = this.sim;
    this.sim = null;
    old?.dispose();
    const sim = new Sim({ track: ARENA_TRACK, cars, seed, laps: ARENA_TRACK.laps });
    const match = new ArenaMatch();
    attachArena(sim, match);
    this.sim = sim;
    this.arena = match;
    this.finish = null;
    this.results = null;
    this.userPaused = false;
    this.wasGo = false;
    this.applyCamera();
    this.renderer.loadRace(sim);
    this.state = 'racing';
    this.applyControls();
    this.input.setEnabled(true);
    this.ui.setSettings(this.save.settings);
    this.ui.setTouchMode(this.input.touchActive);
    this.ui.showHud(this.save.money);
    this.ui.resetRaceFeedback();
    document.body.classList.add('arena-mode');
    this.arenaUi.showHud();
    this.repairIntent = 'none'; this.repairProgress = 0; this.repairsUsed = 0; this.lastRepairAt = -999;
    this.tutorialOn = false;
    this.stuck.reset(); this.dmgShown.clear(); this.dmgGap = 0;
    this.syncPause();
  }

  private updateArena(sim: Sim, dt: number): void {
    const m = this.arena;
    if (!m || this.state !== 'racing') return;
    const wasDead = m.dead.size;
    stepArena(sim, m, dt);
    if (m.dead.size > wasDead) { this.ui.toast(t('arena.wreck')); this.audio.ui('buy'); }
    this.arenaUi.update(m, sim.cars.filter((c) => !m.dead.has(c.id)).length, dt);
    if (m.ended) this.endArenaRound(m);
  }

  private endArenaRound(m: ArenaMatch): void {
    const coins = m.coins();
    let best = 0;
    try { best = Number(localStorage.getItem('smash-arena-best')) || 0; } catch { /* storage blocked */ }
    if (m.score > best) { best = m.score; try { localStorage.setItem('smash-arena-best', String(best)); } catch { /* ignore */ } }
    this.save = { ...this.save, money: this.save.money + coins };
    void writeSave(this.save);
    this.state = 'results';
    this.input.setEnabled(false);
    this.ui.setMoney(this.save.money);
    this.audio.ui('buy');
    this.arenaUi.showResults(
      { reason: m.ended ?? 'time', score: m.score, coins, wrecks: m.wrecks, damage: m.damageDealt, props: m.props, best },
      () => { if (this.state === 'results') this.startArena(); },
      () => { if (this.state === 'results') this.toMenu(); },
    );
    this.syncPause();
  }

  private endArenaMode(): void {
    if (!this.arena) return;
    this.arena = null;
    this.arenaUi.hideAll();
    document.body.classList.remove('arena-mode');
  }

  private pauseRace(): void {
    if (this.state !== 'racing' && this.state !== 'finishing') return;
    this.prevState = this.state;
    this.tutorialOn = false;   // the pause menu replaces the tutorial panel
    this.repairIntent = 'none';
    this.state = 'paused';
    this.userPaused = true;
    this.input.setEnabled(false);
    platform.level('paused', this.trackId);
    this.ui.showPause(this.currentRepairCost(), this.save.money);
    this.syncPause();
  }
  private prevState: GameState = 'racing';
  private pickerOpen = false;
  private wasGo = false;

  private resumeRace(): void {
    if (this.state !== 'paused') return;
    this.state = this.prevState;
    this.userPaused = false;
    this.input.setEnabled(true);
    this.ui.showHud(this.save.money);
    platform.level('resumed', this.trackId);
    this.syncPause();
  }

  private togglePause(): void {
    if (this.state === 'paused') this.resumeRace();
    else this.pauseRace();
  }

  private currentRepairCost(): number {
    const p = this.sim?.cars[0];
    return p ? repairCost(missingHp(p.hp, p.zoneMaxHp)) : 0;
  }

  /**
   * Repair is a decision (audit #21). From the pause menu it is instant (`repairInstant`). In a race it needs the car
   * nearly stopped and a hold of CONFIG.repair.holdS (R key: press once, any movement cancels; HUD chip: hold the finger),
   * with a cooldown and a per-race cap.
   */
  private repairNow(fromUi = false): void {
    if (!this.sim) return;
    if (this.state === 'paused') { this.repairInstant(fromUi); return; }
    if (this.state !== 'racing' || this.hardPaused) return;
    this.beginRepair('key');
  }

  private repairHold(on: boolean): void {
    if (!on) { if (this.repairIntent === 'ui') this.cancelRepair(); return; }
    if (this.state === 'racing' && !this.hardPaused) this.beginRepair('ui');
  }

  private repairBlock(): string | null {
    const sim = this.sim;
    const p = sim?.cars[0];
    if (!sim || !p || sim.race.phase !== 'racing' || p.finished) return 'x';
    const R = CONFIG.repair;
    const cost = this.currentRepairCost();
    if (cost <= 0) return t('pause.noDamage');
    if (this.repairsUsed >= R.maxPerRace) return t('repair.cap');
    const wait = this.lastRepairAt + R.cooldownS - sim.race.time;
    if (wait > 0) return t('repair.cooldown', { n: Math.ceil(wait) });
    if (this.save.money < cost) return t('ui.notEnough');
    if (Math.abs(p.speed) > R.raceMaxSpeed) return t('repair.stop');
    return null;
  }

  private beginRepair(src: 'ui' | 'key'): void {
    if (this.repairIntent !== 'none') return;
    const why = this.repairBlock();
    if (why) { if (why !== 'x') { this.audio.ui('error'); this.ui.toast(why); } return; }
    this.repairIntent = src;
    this.repairProgress = 0;
  }

  private cancelRepair(): void {
    this.repairIntent = 'none';
    this.repairProgress = 0;
    this.ui.setRepairProgress(0);
  }

  private updateRepair(dt: number, sim: Sim): void {
    const R = CONFIG.repair;
    const left = Math.max(0, R.maxPerRace - this.repairsUsed);
    const cd = Math.max(0, this.lastRepairAt + R.cooldownS - sim.race.time);
    this.ui.setRepairInfo({ left, cd, money: this.save.money });
    if (this.repairIntent === 'none') return;
    const p = sim.cars[0];
    if (sim.race.phase !== 'racing' || p.finished) { this.cancelRepair(); return; }
    if (Math.abs(p.speed) > R.raceMaxSpeed) { this.cancelRepair(); this.ui.toast(t('repair.stop')); return; }
    this.repairProgress += dt;
    this.ui.setRepairProgress(Math.min(1, this.repairProgress / R.holdS));
    if (this.repairProgress < R.holdS) return;
    const cost = this.currentRepairCost();
    this.cancelRepair();
    if (cost <= 0 || this.save.money < cost) return;
    this.repairsUsed++;
    this.lastRepairAt = sim.race.time;
    this.repairInstant(false);
  }

  /** Immediate full repair for money (pause menu, debug hook, and the end of a race repair hold). */
  private repairInstant(fromUi = false): void {
    if (!this.sim || (this.state !== 'racing' && this.state !== 'paused' && this.state !== 'finishing')) return;
    const cost = this.currentRepairCost();
    if (cost <= 0) return;
    if (this.save.money < cost) {
      if (!fromUi) { this.audio.ui('error'); this.ui.toast(t('ui.notEnough')); }
      return;
    }
    this.save = { ...this.save, money: this.save.money - cost };
    this.sim.repairPlayer();
    this.ui.setMoney(this.save.money);
    if (!fromUi) { this.audio.ui('buy'); this.ui.toast(t('pause.repair')); }
    void writeSave(this.save);
  }

  /** E / Shift / flick / HUD button: use the held item (only while the race is live). */
  private useItem(): void {
    const sim = this.sim;
    if (!sim || this.state !== 'racing' || this.hardPaused || this.userPaused) return;
    sim.useItem();
  }

  private buy(b: UpgradeBranch, carId?: string): void {
    const next = buyUpgrade(this.save, b, carId);
    if (next) {
      this.save = next;
      void writeSave(this.save);
    }
    this.ui.showGarage(this.save, carId);   // overwrite the UI's optimistic copy with the truth
  }

  private setSettings(s: SaveData['settings']): void {
    this.save = { ...this.save, settings: { ...s } };
    if (s.tutorialDone) this.tutorialOn = false;
    this.applyMute();
    this.applyControls();
    this.input.setLabels(t('input.brake'));
    this.renderer.setQuality(s.quality);
    this.applyCamera();
    document.documentElement.lang = lang();
    void writeSave(this.save);
  }

  private applyControls(): void {
    const s = this.save.settings;
    this.input.setSensitivity(s.steerSens);
    this.input.setScheme(s.controls);
  }

  /** Tilt was chosen but the phone gives no orientation (or the player denied it): back to the Buttons scheme. */
  private onTiltStatus(st: 'ok' | 'denied' | 'unavailable'): void {
    if (st === 'ok' || this.save.settings.controls !== 'tilt') return;
    this.ui.toast(t(st === 'denied' ? 'ctl.tiltDenied' : 'ctl.tiltFail'));
    this.setSettings({ ...this.save.settings, controls: 'buttons' });
    this.ui.setSettings(this.save.settings);
    this.ui.refreshSettingsView();
  }

  /** Camera mode: rotating (heading-up) is the default on touch devices, fixed north-up elsewhere; the setting overrides. */
  private applyCamera(): void {
    const c = this.save.settings.camera;
    this.renderer.setCameraRotating(c === 'rotating' || (c === 'auto' && this.input.touchActive));
  }

  private async doubleReward(): Promise<boolean> {
    if (!this.results || this.resultsReward <= 0) return false;
    this.beginAd();
    let ok = false;
    try { ok = await platform.showRewarded(); } finally { this.endAd(); }
    if (!ok) return false;
    const extra = Math.round(this.resultsReward * (CONFIG.economy.rewardedMultiplier - 1));
    this.save = { ...this.save, money: this.save.money + extra };
    this.resultsReward = 0;   // cannot be doubled twice
    void writeSave(this.save);
    return true;
  }

  /** Level lifecycle message pair: every level_started is closed by exactly one level_completed / level_failed. */
  private closeLevel(kind: 'completed' | 'failed'): void {
    if (!this.levelOpen) return;
    this.levelOpen = false;
    platform.level(kind, this.trackId);
  }

  /**
   * Leaving a race from the pause menu (quit / restart) is a natural pause: offer an interstitial first
   * (the Bridge decides if one is really shown). Never called mid-race: the pause menu is up.
   */
  private async leaveRace(then: () => void): Promise<void> {
    if (this.continuing || this.state === 'ad') return;
    this.continuing = true;
    this.beginAd();
    try { await platform.showInterstitial(); } finally { this.endAd(); }
    this.continuing = false;
    then();
  }

  private async continueAfterResults(): Promise<void> {
    if (this.continuing) return;
    this.continuing = true;
    this.beginAd();
    try { await platform.showInterstitial(); } finally { this.endAd(); }
    this.continuing = false;
    this.toMenu();
  }

  private beginAd(): void { this.adBusy = true; this.prevForAd = this.state; this.state = 'ad'; this.syncPause(); }
  private prevForAd: GameState = 'results';
  private endAd(): void {
    this.adBusy = false;
    if (this.state === 'ad') this.state = this.prevForAd;
    this.syncPause();
  }

  // ------------------------------------------------------------------ pause / sound

  private get hardPaused(): boolean { return this.platformPaused || this.adBusy || this.externalAd || document.hidden; }

  private syncPause(): void {
    if (!this.audio) return;
    this.audio.setPaused(this.hardPaused);
    this.audio.setGameplayPaused(this.userPaused);
  }

  private applyMute(): void {
    if (!this.audio) return;
    this.audio.setMuted(this.save.settings.muted || !this.platformAudio);
  }

  // ------------------------------------------------------------------ race end

  private onPlayerFinish(info: FinishInfo): void {
    const sim = this.sim;
    if (!sim || this.finish) return;
    this.finish = info;
    this.finishTimer = 0;
    const p = sim.cars[0];
    const prevBest = this.save.bestLap[this.trackId];
    const bestLap = p.bestLapTime;
    const newBestLap = bestLap > 0 && (!prevBest || bestLap < prevBest);
    const drift = driftCoins(p.driftScore ?? 0);
    const parts = raceRewardParts(this.trackId, info.place, sim.smashMoney);
    const reward = parts.total + drift;
    const res = applyRaceResult(this.save, this.trackId, info.place, reward, bestLap);
    this.save = res.save;
    const ghost = sim.bestGhost();
    const saved = this.save.ghosts[this.trackId];
    if (ghost && (!saved || ghost.lapTime < saved.lapTime)) {
      this.save = { ...this.save, ghosts: { ...this.save.ghosts, [this.trackId]: ghost } };
    }
    void writeSave(this.save);
    if (newBestLap && platform.leaderboardAvailable()) {
      void platform.submitScore(CONFIG.game.leaderboardPrefix + this.trackId, Math.round(bestLap * 1000));
    }
    this.resultsReward = reward;
    this.closeLevel('completed');
    this.results = {
      place: info.place, time: info.time, bestLap, reward,
      canDouble: platform.isRewardedSupported() && reward > 0,
      unlocked: res.unlocked, newBestLap, drift,
      prize: parts.prize, smash: parts.smash, smashCount: sim.brokenByPlayer,
      nextTrack: (() => { const n = nextTrackId(this.trackId); return n && this.save.unlockedTracks.includes(n) ? n : null; })(),
    };
    this.ui.showFinishBanner(info.place, info.time);
    this.audio.ui('buy');
    if (this.state === 'racing') this.state = 'finishing';
  }

  private showResultsNow(): void {
    if (!this.results) return;
    this.state = 'results';
    this.userPaused = false;
    this.input.setEnabled(false);
    this.ui.setMoney(this.save.money);
    this.ui.showResults(this.results);
    this.syncPause();
  }

  // ------------------------------------------------------------------ loop

  private loop = (now: number): void => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(CONFIG.game.maxFrameDt, Math.max(0, (now - this.lastT) / 1000));
    this.lastT = now;
    const sim = this.sim;
    const racing = this.state === 'racing' || this.state === 'finishing';
    const live = racing && !this.hardPaused && !this.userPaused;

    if (sim && (racing || this.state === 'paused' || this.state === 'results' || this.state === 'ad')) {
      let events: SimEvent[] = [];
      if (live) {
        const inp = this.input.getInput();
        this.lastInput = inp;
        sim.setPlayerInput(inp);
        let left = dt * this.timeScale;
        const chunk = 1 / 30;
        let guard = 0;
        while (left > 1e-6 && guard++ < CONFIG.game.maxTimeScale + 2) {
          const step = Math.min(left, chunk);
          sim.update(step);
          left -= step;
          const ev = sim.drainEvents();
          if (ev.length) events = events.length ? events.concat(ev) : ev;
        }
        this.handleEvents(events, sim);
        if (this.arena) this.updateArena(sim, dt * this.timeScale);
        this.watchStuck(sim, dt);
        this.watchDamage(sim, dt);
        if (this.state === 'racing') this.updateRepair(dt, sim);
        if (!this.wasGo && sim.race.phase === 'racing') { this.wasGo = true; this.input.recenter(); }
        if (this.tutorialOn && sim.race.phase === 'racing' && (sim.race.time >= CONFIG.ui.tutorialHideAfterGoS
          || inp.throttle > 0 || inp.brake > 0 || Math.abs(inp.steer) > 0.2 || inp.handbrake)) {
          this.tutorialOn = false;
          this.ui.hideTutorial();
        }
        const sm = sim.takeSmashes();
        if (sm.money > 0) this.ui.smashFloat(sm.money);
        this.audio.onEvents(events, 0);
      }
      this.renderer.frame(sim, events, live ? dt : 0);
      this.ui.updateHud(sim, this.renderer.fps);
      const p: CarState | undefined = sim.cars[0];
      this.audio.update(live && p ? p : null, dt);
      if (this.state === 'finishing' && live) {
        this.finishTimer += dt;
        if (this.finishTimer >= CONFIG.game.resultsDelay) this.showResultsNow();
      }
    } else {
      this.audio.update(null, dt);
    }

    this.framesRendered++;
    if (!this.readyDone && this.framesRendered >= 2) {
      this.readyDone = true;
      document.getElementById('boot')?.remove();
      platform.gameReady();
    }
  };

  /** Wedged in a tyre wall or a pile-up: hint first (reverse frees most cars), then a free reset onto the road. */
  private watchStuck(sim: Sim, dt: number): void {
    const p = sim.cars[0];
    if (this.state !== 'racing' || sim.race.phase !== 'racing' || p.finished) { this.stuck.reset(); return; }
    const i = this.lastInput;
    const ev = this.stuck.update(dt, p.speed, i.throttle > 0 || i.brake > 0, sim.race.time);
    if (ev === 'hint') this.ui.toast(t('hud.stuckHint'));
    else if (ev === 'reset') this.resetPlayerToTrack(sim);
  }

  /** Short toasts when the player's damage effects first cross a threshold (power, top speed, grip, steering pull). */
  private watchDamage(sim: Sim, dt: number): void {
    const fx = sim.cars[0].effects, T = CONFIG.damage.toast;
    this.dmgGap = Math.max(0, this.dmgGap - dt);
    const now: Record<string, boolean> = {
      'dmg.power': fx.powerMul < T.power, 'dmg.speed': fx.topSpeedMul < T.speed, 'dmg.grip': fx.gripMul < T.grip,
      'dmg.pull.r': fx.steerPull > T.pull, 'dmg.pull.l': fx.steerPull < -T.pull,
    };
    for (const k in now) {
      if (!now[k]) { this.dmgShown.delete(k); continue; }
      if (this.dmgShown.has(k) || this.dmgGap > 0) continue;
      this.dmgShown.add(k);
      this.dmgGap = T.cooldown;
      this.ui.toast(t(k));
    }
  }

  private resetPlayerToTrack(sim: Sim): void {
    const st = sim.cars[0];
    const pose = pickResetPose(sim.track, st.x, st.y, sim.tracker.hints[0], sim.cars.filter((c) => c !== st));
    sim.simCars[0].reset(pose.x, pose.y, pose.angle);
    st.x = pose.x; st.y = pose.y; st.angle = pose.angle;
    st.vx = 0; st.vy = 0; st.speed = 0; st.angularVel = 0;
    const pp = sim.prevPoses[0];
    pp.x = pose.x; pp.y = pose.y; pp.angle = pose.angle;
    this.ui.toast(t('hud.backOnTrack'));
  }

  private handleEvents(events: SimEvent[], sim: Sim): void {
    for (const e of events) {
      if (e.type === 'finish' && e.carId === sim.cars[0].id) this.onPlayerFinish({ place: e.place, time: e.time });
      else if (e.type === 'lap' && e.carId === sim.cars[0].id && e.lap < sim.race.totalLaps) {
        // lap pill: time, delta against the best lap known so far (purple = new best), plus a chime
        const ref = this.bestLapRef;
        const isBest = ref <= 0 || e.lapTime < ref;
        this.ui.lapPill(e.lap, sim.race.totalLaps, e.lapTime, ref > 0 ? e.lapTime - ref : null, isBest && ref > 0);
        this.audio.ui('buy');
        if (ref <= 0 || e.lapTime < ref) this.bestLapRef = e.lapTime;
      }
      else if (e.type === 'pickup' && e.carId === sim.cars[0].id && !this.itemHintShown) {
        this.itemHintShown = true;   // once per session: how to use the item
        this.ui.toast(t(this.input.touchActive ? 'hud.itemHintBtn' : 'hud.itemHintKey'));
      }
    }
  }

  // ------------------------------------------------------------------ debug

  /** The debug/e2e hook (money, time scale, forceFinish) is not shipped to players: dev builds, localhost and `?debug` only. */
  private static debugAllowed(): boolean {
    try {
      if (import.meta.env?.DEV) return true;
      const h = location.hostname;
      return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '' || /[?&]debug\b/.test(location.search);
    } catch { return false; }
  }

  private installDebug(): void {
    if (!Game.debugAllowed()) return;
    const g = this;
    window.__game = {
      get state() { return g.state; },
      get sim() { return g.sim; },
      get save() { return g.save; },
      get ui() { return g.ui; },
      get input() { return g.input; },
      setSettings: (s) => { g.setSettings(s); g.ui.setSettings(g.save.settings); },
      get timeScale() { return g.timeScale; },
      startRace: (id) => g.startRace(id),
      startArena: () => g.startArena(),
      get arena() { return g.arena; },
      setTimeScale: (n) => { g.timeScale = Math.max(0.05, Math.min(CONFIG.game.maxTimeScale, n)); },
      forceFinish: () => {
        const sim = g.sim;
        if (!sim) return;
        if (!g.finish) {
          const p = sim.cars[0];
          g.onPlayerFinish({ place: Math.max(1, p.place), time: Math.max(0.1, sim.race.time) });
        }
        g.showResultsNow();
      },
      pause: () => g.pauseRace(),
      resume: () => g.resumeRace(),
      repair: () => g.repairInstant(),
      menu: () => g.toMenu(),
      model: { ...carModel, DriftTracker },
    };
  }
}

export async function bootGame(): Promise<Game> {
  const game = new Game();
  await game.boot();
  return game;
}
