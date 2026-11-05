// Integration: boot order, game loop and flow (menu -> race -> results -> interstitial -> menu).
// Owns the only mutable SaveData copy; every other module receives data through handlers.
import { CONFIG } from './config';
import { initLang, lang, t } from './i18n';
import { AudioManager } from './audio/audio';
import { HitStop } from './fx/hitStop';
import { InputController } from './input/input';
import { applyRaceResult, buyUpgrade, nextTrackId, raceRewardParts, repairCost } from './meta/economy';
import { makeOpponents, makePlayerSetup, rivalChoiceOf } from './meta/opponents';
import { carIdOr } from './meta/cars';
import { commitRace, cupById, cupOpponents, cupUnlocked, cupIndex, normalizePlaces, runActive, startRun, type Cup, type RaceCommit } from './meta/career';
import { defaultSave, loadSave, writeSave, type SaveStatus } from './meta/save';
import { StuckWatch, pickResetPose } from './playerReset';
import { platform } from './platform/bridge';
import { GameRenderer } from './render';
import { missingHp } from './sim/damage';
import { DriftTracker, driftCoins } from './sim/drift';
import * as carModel from './sim/carModel';
import { Sim } from './sim/sim';
import { baseTrackId, trackById } from './track/tracks';
import type { CarInput, CarState, SaveData, SimEvent, TrackDef, UpgradeBranch } from './types';
import { HudExtras } from './ui/hud';
import { LeaderboardPanel } from './ui/leaderboard';
import { UI, type UiHandlers } from './ui/ui';
import { driverName, goalText, type PodiumData } from './ui/career';
import { MissionTracker, applyRace, dailyOf, dayNumber, missionsForDay } from './meta/daily';
import { paintIndexFor } from './meta/cosmetics';

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
      /** in-race HUD extras: minimap, gaps, combo (e2e screenshots) */
      readonly hud: HudExtras;
      readonly timeScale: number;
      startRace(trackId: string): void;
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
  private hx!: HudExtras;
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
  // ---- career: the cup race being played / just played, repairs paid in this race, and the last cup result (podium)
  private careerCtx: { cupId: string; idx: number } | null = null;
  private raceRepairs = 0;
  private podium: PodiumData | null = null;
  /** daily missions: drift seconds / nitro uses / repairs of the current race */
  private missions = new MissionTracker();
  private lastRepairAt = -999;

  /** sim freeze on a heavy car-vs-car hit (src/fx/hitStop.ts) */
  private hitStop = new HitStop();

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
    try {
      const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.hitStop.enabled = !reduced;
      this.renderer.setReducedMotion(reduced);
    } catch { /* no matchMedia: full effects */ }
    this.ui = new UI(uiRoot, this.handlers());
    this.hx = new HudExtras(this.ui.hudRoot());
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
    // behind the menu, in idle time: build the unlocked tracks' visuals (newest first) and compile the race shaders (audit #23)
    const warmDefs = this.save.unlockedTracks.map((id) => trackById(id)).filter((d) => !!d).reverse();
    this.renderer.warmUp?.(warmDefs, (def) => this.warmSim(def));
  }

  /** A throwaway sim for the renderer warm-up: same field as a real start, never raced. */
  private warmSim(def: TrackDef): Sim {
    const idx = Math.max(0, CONFIG.meta.trackOrder.indexOf(def.id));
    const player = makePlayerSetup(this.save, 'Player');
    const cars = [player, ...makeOpponents(idx, player.stats, 1, this.save.carColor, rivalChoiceOf(this.save))];
    return new Sim({ track: def, cars, seed: 1 });
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
      pause: () => this.pauseRace(),
      resume: () => this.resumeRace(),
      quit: () => void this.leaveRace(() => this.toMenu(this.careerCtx ? 'career' : 'menu')),
      restart: () => void this.leaveRace(() => this.restartRace()),
      repair: () => this.repairNow(true),
      recenter: () => this.input.recenter(),
      repairHold: (on) => this.repairHold(on),
      // A new race from the results is a natural pause too (Playgama required step 7): the Bridge decides if an
      // interstitial really shows (initial delay + minimum interval in playgama-bridge-config.json), the game has no timers.
      retry: () => { if (this.state === 'results') void this.leaveRace(() => this.restartRace()); },
      career: (act, id) => this.careerAct(act, id),
      nextTrack: (id) => { if (this.state === 'results') void this.leaveRace(() => this.startRace(id)); },
      leaderboard: () => this.openLeaderboard(),
      leaderboardAvailable: () => { const m = platform.leaderboardMode(); return m === 'in_game' || m === 'native_popup'; },
      retrySave: () => { this.reloadN = 0; this.scheduleReload(true); },
      useItem: () => this.useItem(),
      buy: (b, carId) => this.buy(b, carId),
      selectCar: (id) => {
        this.save = { ...this.save, car: carIdOr(id) };
        this.renderer.showMenuScene(paintIndexFor(this.save), this.save.car);
        void writeSave(this.save);
      },
      previewCar: (id, ci) => this.renderer.showMenuScene(ci ?? paintIndexFor(this.save, carIdOr(id)), carIdOr(id)),
      adoptMeta: (s, shownCar) => {
        // daily claims / cosmetics: the UI ran the pure meta op; only those fields (and the coins) are taken over
        this.save = { ...this.save, money: s.money, daily: s.daily, cosmetics: s.cosmetics };
        if (this.state === 'menu') this.renderer.showMenuScene(paintIndexFor(this.save, carIdOr(shownCar ?? this.save.car)), carIdOr(shownCar ?? this.save.car));
        void writeSave(this.save);
      },
      doubleReward: () => this.doubleReward(),
      settings: (s) => this.setSettings(s),
      color: (i) => {
        this.save = { ...this.save, carColor: i };
        this.renderer.showMenuScene(paintIndexFor(this.save));
        void writeSave(this.save);
      },
      continueAfterResults: () => void this.continueAfterResults(),
      sfx: (n) => this.audio.ui(n),
    };
  }

  private toMenu(target: 'menu' | 'career' | 'podium' = 'menu'): void {
    this.userPaused = false;
    this.finish = null;
    this.results = null;
    this.tutorialOn = false;
    this.repairIntent = 'none';
    this.hx?.stop();
    this.input?.setEnabled(false);
    this.closeLevel('failed');
    this.renderer.showMenuScene(paintIndexFor(this.save), this.save.car);
    const old = this.sim;
    this.sim = null;
    old?.dispose();
    this.state = 'menu';
    this.ui.setSettings(this.save.settings);
    if (target !== 'menu' && this.careerCtx) this.showCareerScreen(target);
    else { this.careerCtx = null; this.ui.showMainMenu(this.save); }
    this.ui.setSaveWarning(this.saveStatus === 'failed');
    this.audio.update(null, 0);
    this.syncPause();
    if (this.pendingLoaded) this.adoptLoaded();
  }

  startRace(trackId: string, career?: { cup: Cup; idx: number }): void {
    if (this.state === 'ad' || this.continuing) return;
    const def = trackById(trackId);
    if (!def || (!career && !this.save.unlockedTracks.includes(baseTrackId(def.id)))) return;   // a reverse layout opens with its forward track
    // first race on a touch device: a one-time, skippable controls picker (Buttons highlighted)
    if (this.input.touchActive && !this.save.settings.controlsPicked && !this.pickerOpen) {
      this.pickerOpen = true;
      this.ui.setSettings(this.save.settings);
      this.ui.showControlsPicker(() => { this.pickerOpen = false; this.startRace(trackId, career); });
      return;
    }
    const idx = Math.max(0, CONFIG.meta.trackOrder.indexOf(baseTrackId(def.id)));   // rival difficulty follows the base track
    const seed = (Math.floor(Math.random() * 0x7fffffff) ^ (Date.now() & CONFIG.game.seedMask)) >>> 0;
    const player = makePlayerSetup(this.save, 'Player');
    player.colorIndex = paintIndexFor(this.save);   // equipped premium paint (render/paintLayer.ts)
    this.missions.reset();
    const run = this.save.career.run;
    const cars = [player, ...(career && run
      ? cupOpponents(career.cup, career.idx, player.stats, run.seed, this.save.carColor, rivalChoiceOf(this.save))
      : makeOpponents(idx, player.stats, seed, this.save.carColor, rivalChoiceOf(this.save)))];
    this.careerCtx = career ? { cupId: career.cup.id, idx: career.idx } : null;
    this.raceRepairs = 0;
    const old = this.sim;
    this.sim = null;
    old?.dispose();
    const sim = new Sim({ track: def, cars, seed, ghost: this.save.ghosts[def.id], laps: career ? career.cup.races[career.idx].laps : undefined });
    this.sim = sim;
    this.hitStop.reset();
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
    this.hx.start(sim);
    this.bestLapRef = this.save.bestLap[def.id] ?? 0;
    this.repairIntent = 'none'; this.repairProgress = 0; this.repairsUsed = 0; this.lastRepairAt = -999;
    // first run: a hint sheet that never blocks the start (countdown runs; hides at the first input or GO + N s)
    this.tutorialOn = !this.save.settings.tutorialDone;
    if (this.tutorialOn) this.ui.showTutorial(this.input.touchActive);
    this.stuck.reset(); this.dmgShown.clear(); this.dmgGap = 0;
    this.closeLevel('failed');   // restarting from the pause menu abandons the previous attempt
    this.levelOpen = true;
    platform.level('started', def.id);
    if (career) this.ui.toast(t('career.toast.race', { cup: t(career.cup.nameKey), n: career.idx + 1, total: career.cup.races.length }));
    this.syncPause();
  }

  // ------------------------------------------------------------------ career flow

  /** Same race again (pause menu restart / results retry): the same cup race in a career, else the same track. */
  private restartRace(): void {
    const ctx = this.careerCtx;
    const cup = ctx ? cupById(ctx.cupId) : undefined;
    if (ctx && cup) this.startRace(cup.races[ctx.idx].track, { cup, idx: ctx.idx });
    else this.startRace(this.trackId);
  }

  /** Cup page (or the podium after the last race) instead of the main menu. */
  private showCareerScreen(target: 'career' | 'podium'): void {
    const ctx = this.careerCtx;
    if (target === 'podium' && this.podium) this.ui.showPodium(this.save, this.podium);
    else if (ctx) this.ui.showCup(this.save, ctx.cupId);
    else this.ui.showCareer(this.save);
  }

  private careerAct(act: 'go' | 'restart' | 'next' | 'done', cupId?: string): void {
    if (this.state === 'ad' || this.continuing) return;
    if (act === 'done') { this.careerCtx = null; this.podium = null; this.ui.showCareer(this.save); return; }
    if (act === 'next') {
      const ctx = this.careerCtx;
      const cup = ctx ? cupById(ctx.cupId) : undefined;
      if (!ctx || !cup || this.state !== 'results') return;
      const done = this.save.career.run?.results.length ?? 0;
      if (done >= cup.races.length) { this.toMenu('podium'); return; }
      this.startRace(cup.races[done].track, { cup, idx: done });
      return;
    }
    const cup = cupById(cupId ?? '');
    if (!cup || !cupUnlocked(this.save.career, cupIndex(cup.id)) || this.state !== 'menu') return;
    if (act === 'restart' || !runActive(this.save.career, cup.id)) {
      const seed = (Math.floor(Math.random() * 0x7fffffff) ^ (Date.now() & CONFIG.game.seedMask)) >>> 0;
      this.save = { ...this.save, career: startRun(this.save.career, cup.id, seed) };
      void writeSave(this.save);
    }
    this.careerCtx = { cupId: cup.id, idx: 0 };
    if (act === 'restart') { this.ui.showCup(this.save, cup.id); return; }
    const idx = this.save.career.run?.results.length ?? 0;
    this.startRace(cup.races[idx].track, { cup, idx });
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
    this.raceRepairs++;
    this.sim.repairPlayer();
    this.missions.repaired();
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

  /** Leaderboard of the current (or last raced) track: our own top-10 view, or the platform overlay; nothing when the platform has none. */
  private lb: LeaderboardPanel | null = null;
  private openLeaderboard(): void {
    const mode = platform.leaderboardMode();
    const id = CONFIG.game.leaderboardPrefix + this.trackId;
    if (mode === 'native_popup') { void platform.showLeaderboardPopup(id); return; }
    if (mode !== 'in_game') return;
    const root = document.getElementById('ui');
    if (!root) return;
    this.lb ??= new LeaderboardPanel(root, (n) => this.audio.ui(n));
    this.lb.show(this.trackId);
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
    this.toMenu(this.careerCtx ? 'career' : 'menu');
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
    this.audio.setMusicVolume?.(this.save.settings.musicVol ?? 1);
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
    const parts = raceRewardParts(this.trackId, info.place, sim.smashMoney + this.hx.bonusMoney);   // combo multipliers + takedowns share the smash cap
    const reward = parts.total + drift;
    const res = applyRaceResult(this.save, this.trackId, info.place, reward, bestLap);
    this.save = res.save;
    // daily missions: progress from this race, a toast per mission that just completed (claimed from the menu)
    const today = dayNumber(new Date());
    const dm = applyRace(dailyOf(this.save), today, this.missions.stats(sim.brokenByPlayer, info.place));
    this.save = { ...this.save, daily: dm.state };
    for (const i of dm.completed) this.ui.toast(t('daily.done', { name: t('mission.' + missionsForDay(today)[i].kind, { n: missionsForDay(today)[i].target }) }));
    const ghost = sim.bestGhost();
    const saved = this.save.ghosts[this.trackId];
    if (ghost && (!saved || ghost.lapTime < saved.lapTime)) {
      this.save = { ...this.save, ghosts: { ...this.save.ghosts, [this.trackId]: ghost } };
    }
    const careerRes = this.commitCareer(sim, info);
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
      prize: parts.prize, smash: parts.smash, smashCount: sim.brokenByPlayer, combo: this.hx.bestChain, slams: this.hx.takedownCount,
      nextTrack: careerRes ? null : (() => { const n = nextTrackId(this.trackId); return n && this.save.unlockedTracks.includes(n) ? n : null; })(),
      career: careerRes ?? undefined,
    };
    this.ui.showFinishBanner(info.place, info.time);
    this.audio.ui('buy');
    if (this.state === 'racing') this.state = 'finishing';
  }

  /**
   * Career race finished: places of all 8 cars -> points and standings, star goals (best-ever), extra coins; the career part of
   * the save is updated here (the race money was already added by the caller). Returns the results-card block.
   */
  private commitCareer(sim: Sim, info: FinishInfo): NonNullable<Parameters<UI['showResults']>[0]['career']> | null {
    const ctx = this.careerCtx;
    const cup = ctx ? cupById(ctx.cupId) : undefined;
    if (!ctx || !cup) return null;
    const byId: number[] = [];
    for (const c of sim.cars) byId[c.id] = c.place;
    const places = normalizePlaces(byId, info.place);
    const p = sim.cars[0];
    const commit: RaceCommit = commitRace(this.save.career, ctx.cupId, ctx.idx, places, { place: info.place, broken: sim.brokenByPlayer, health: p.health, repairs: this.raceRepairs });
    const track = cup.races[ctx.idx].track;
    this.save = {
      ...this.save,
      career: commit.career,
      money: this.save.money + commit.starCoins + commit.cupCoins,
      unlockedTracks: this.save.unlockedTracks.includes(track) ? this.save.unlockedTracks : [...this.save.unlockedTracks, track],   // a cup race opens its track in Quick race
    };
    const seed = commit.career.run?.seed ?? 1;
    const me = commit.table.find((r) => r.driver === 0);
    const unlockedName = commit.unlockedCup ? t(cupById(commit.unlockedCup)?.nameKey ?? '') : null;
    if (commit.cupDone) {
      this.podium = {
        cupName: t(cup.nameKey), playerPos: commit.playerPos, cupCoins: commit.cupCoins, unlockedCup: unlockedName,
        table: commit.table.map((r) => ({ driver: r.driver, name: driverName(r.driver, seed), points: r.points, pos: r.pos })),
      };
    }
    return {
      cupName: t(cup.nameKey), raceNo: ctx.idx + 1, raceTotal: cup.races.length,
      points: commit.points, pos: commit.playerPos, totalPoints: me?.points ?? 0,
      goals: cup.races[ctx.idx].goals.map((g, i) => ({ text: goalText(g), earned: commit.stars[i], isNew: commit.newStars[i] })),
      starCoins: commit.starCoins, cupCoins: commit.cupCoins, cupDone: commit.cupDone, unlockedCup: unlockedName,
    };
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
        let left = this.hitStop.advance(dt) * this.timeScale;
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
        this.hitStop.onEvents(events, sim.cars[0].id);
        this.missions.tick(dt * this.timeScale, sim.cars[0], events);
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
        if (this.hx.frame(sim, events, dt, sm.items, (x, y) => this.renderer.worldToScreen(x, y)) > 0) this.audio.ui('buy');
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
      get hud() { return g.hx; },
      get input() { return g.input; },
      setSettings: (s) => { g.setSettings(s); g.ui.setSettings(g.save.settings); },
      get timeScale() { return g.timeScale; },
      startRace: (id) => g.startRace(id),
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
