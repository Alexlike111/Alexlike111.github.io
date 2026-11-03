// Integration: boot order, game loop and flow (menu -> race -> results -> interstitial -> menu).
// Owns the only mutable SaveData copy; every other module receives data through handlers.
import { CONFIG } from './config';
import { initLang, lang, t } from './i18n';
import { AudioManager } from './audio/audio';
import { InputController } from './input/input';
import { applyRaceResult, buyUpgrade, raceReward, repairCost, statsFor } from './meta/economy';
import { makeOpponents, makePlayerSetup } from './meta/opponents';
import { defaultSave, loadSave, writeSave } from './meta/save';
import { StuckWatch, pickResetPose } from './playerReset';
import { platform } from './platform/bridge';
import { GameRenderer } from './render';
import { missingHp } from './sim/damage';
import { DriftTracker, driftCoins } from './sim/drift';
import * as carModel from './sim/carModel';
import { Sim } from './sim/sim';
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
      readonly timeScale: number;
      startRace(trackId: string): void;
      setTimeScale(n: number): void;
      forceFinish(): void;
      pause(): void;
      resume(): void;
      repair(): void;
      menu(): void;
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

  private platformPaused = false;
  private platformAudio = true;
  private adBusy = false;
  private externalAd = false;   // an ad the platform opened on its own (or that was already open at start)
  private levelOpen = false;     // level_started sent and not yet completed / failed
  private stuck = new StuckWatch();
  private lastInput: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  private userPaused = false;
  private itemHintShown = false;
  private tutorialHold = false;   // first run: the sim waits (countdown included) until the tutorial is dismissed

  private raf = 0;
  private lastT = 0;
  private framesRendered = 0;
  private readyDone = false;
  private continuing = false;

  /** Boot order: (Bridge script already loaded by the page) -> platform.init -> one save load -> language -> mute. */
  async boot(): Promise<void> {
    await platform.init();
    this.save = await loadSave();
    initLang(platform.language(), this.save.settings.lang);
    document.documentElement.lang = lang();
    this.platformAudio = platform.isAudioEnabled();
    platform.onPause((p) => { this.platformPaused = p; this.syncPause(); });
    platform.onAudio((on) => { this.platformAudio = on; this.applyMute(); });
    platform.watchAds((open) => { this.externalAd = open; this.syncPause(); });

    const canvas = document.getElementById('gl') as HTMLCanvasElement;
    const uiRoot = document.getElementById('ui') as HTMLElement;
    this.audio = new AudioManager();
    this.applyMute();
    this.renderer = new GameRenderer(canvas, this.save.settings.quality);
    this.ui = new UI(uiRoot, this.handlers());
    this.input = new InputController(uiRoot);
    this.input.setAutoGas(this.save.settings.autoGas);
    this.input.setLabels(t('input.gas'), t('input.brake'), t('input.drift'));
    this.input.onKey((k) => { if (k === 'pause') this.togglePause(); else if (k === 'item') this.useItem(); else this.repairNow(); });
    this.input.onTouchMode((touch) => this.ui.setTouchMode(touch));
    this.ui.setTouchMode(this.input.touchActive);
    this.ui.setSettings(this.save.settings);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'racing') this.pauseRace();
      this.syncPause();
    });

    this.installDebug();
    this.toMenu();
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------------ flow

  private handlers(): UiHandlers {
    return {
      start: (id) => this.startRace(id),
      pause: () => this.pauseRace(),
      resume: () => this.resumeRace(),
      quit: () => void this.leaveRace(() => this.toMenu()),
      restart: () => void this.leaveRace(() => this.startRace(this.trackId)),
      repair: () => this.repairNow(true),
      useItem: () => this.useItem(),
      buy: (b) => this.buy(b),
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
    this.userPaused = false;
    this.finish = null;
    this.results = null;
    this.tutorialHold = false;
    this.input?.setEnabled(false);
    this.closeLevel('failed');
    this.renderer.showMenuScene(this.save.carColor);
    const old = this.sim;
    this.sim = null;
    old?.dispose();
    this.state = 'menu';
    this.ui.setSettings(this.save.settings);
    this.ui.showMainMenu(this.save);
    this.audio.update(null, 0);
    this.syncPause();
  }

  startRace(trackId: string): void {
    if (this.state === 'ad' || this.continuing) return;
    const def = trackById(trackId);
    if (!def || !this.save.unlockedTracks.includes(def.id)) return;
    const idx = Math.max(0, CONFIG.meta.trackOrder.indexOf(def.id));
    const seed = (Math.floor(Math.random() * 0x7fffffff) ^ (Date.now() & CONFIG.game.seedMask)) >>> 0;
    const player = makePlayerSetup(this.save, 'Player');
    const cars = [player, ...makeOpponents(idx, player.stats, seed, this.save.carColor)];
    const old = this.sim;
    this.sim = null;
    old?.dispose();
    const sim = new Sim({ track: def, cars, seed, ghost: this.save.ghosts[def.id] });
    this.sim = sim;
    this.trackId = def.id;
    this.finish = null;
    this.results = null;
    this.userPaused = false;
    this.renderer.loadRace(sim);
    this.state = 'racing';
    this.input.setAutoGas(this.save.settings.autoGas);
    this.input.setEnabled(true);
    this.ui.setSettings(this.save.settings);
    this.ui.setTouchMode(this.input.touchActive);
    this.ui.showHud(this.save.money);
    this.tutorialHold = !this.save.settings.tutorialDone;
    if (this.tutorialHold) this.ui.showTutorial(this.input.touchActive);
    this.stuck.reset();
    this.closeLevel('failed');   // restarting from the pause menu abandons the previous attempt
    this.levelOpen = true;
    platform.level('started', def.id);
    this.syncPause();
  }

  private pauseRace(): void {
    if (this.state !== 'racing' && this.state !== 'finishing') return;
    this.prevState = this.state;
    this.tutorialHold = false;   // the pause menu replaces the tutorial panel
    this.state = 'paused';
    this.userPaused = true;
    this.input.setEnabled(false);
    platform.level('paused', this.trackId);
    this.ui.showPause(this.currentRepairCost(), this.save.money);
    this.syncPause();
  }
  private prevState: GameState = 'racing';

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

  /** R key / pause-menu button / HUD button. `fromUi`: the UI already played its own sound/toast. */
  private repairNow(fromUi = false): void {
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
    if (!sim || this.state !== 'racing' || this.hardPaused || this.userPaused || this.tutorialHold) return;
    sim.useItem();
  }

  private buy(b: UpgradeBranch): void {
    const next = buyUpgrade(this.save, b);
    if (next) {
      this.save = next;
      void writeSave(this.save);
    }
    this.ui.showGarage(this.save);   // overwrite the UI's optimistic copy with the truth
  }

  private setSettings(s: SaveData['settings']): void {
    this.save = { ...this.save, settings: { ...s } };
    if (s.tutorialDone) this.tutorialHold = false;
    this.applyMute();
    this.input.setAutoGas(s.autoGas);
    this.input.setLabels(t('input.gas'), t('input.brake'), t('input.drift'));
    this.renderer.setQuality(s.quality);
    document.documentElement.lang = lang();
    void writeSave(this.save);
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
    this.audio.setPaused(this.hardPaused);
    this.audio.setGameplayPaused(this.userPaused);
  }

  private applyMute(): void {
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
    const reward = raceReward(this.trackId, info.place, sim.brokenByPlayer) + drift;
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
    };
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
    const live = racing && !this.hardPaused && !this.userPaused && !this.tutorialHold;

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
        this.watchStuck(sim, dt);
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
      else if (e.type === 'pickup' && e.carId === sim.cars[0].id && !this.itemHintShown) {
        this.itemHintShown = true;   // once per session: how to use the item
        this.ui.toast(t(this.input.touchActive ? 'hud.itemHintTap' : 'hud.itemHintKey'));
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
      repair: () => g.repairNow(),
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
