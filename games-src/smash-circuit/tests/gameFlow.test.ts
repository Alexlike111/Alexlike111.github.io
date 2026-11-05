// Game flow state machine with a fake bridge / renderer / UI / input / audio and the REAL sim.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CarInput } from '../src/types';

// ---- fakes (hoisted by vitest) ----
const h = vi.hoisted(() => ({
  ui: null as null | { handlers: Record<string, (...a: unknown[]) => unknown>; calls: Record<string, unknown[][]>; toasts: string[] },
  input: { throttle: 0, brake: 0, steer: 0, handbrake: false } as { throttle: number; brake: number; steer: number; handbrake: boolean },
  interstitial: null as null | { resolve: () => void; calls: number; pending: boolean },
  pauseCb: null as null | ((p: boolean) => void),
  adCb: null as null | ((open: boolean) => void),
  rewardedOk: true,
  levels: [] as string[],
}));

vi.mock('../src/platform/bridge', () => ({
  platform: {
    init: async () => {},
    language: () => 'en',
    isAudioEnabled: () => true,
    onPause: (cb: (p: boolean) => void) => { h.pauseCb = cb; },
    onAudio: () => {},
    watchAds: (cb: (o: boolean) => void) => { h.adCb = cb; },
    onLateReady: () => {},
    waitReady: async () => true,
    load: async (keys: string[]) => ({ status: 'empty', values: Object.fromEntries(keys.map((k) => [k, null])) }),
    save: async () => true,
    showInterstitial: () => {
      const st = { resolve: () => {}, calls: (h.interstitial?.calls ?? 0) + 1, pending: true };
      h.interstitial = st;
      return new Promise<void>((r) => { st.resolve = () => { st.pending = false; r(); }; });
    },
    isRewardedSupported: () => true,
    showRewarded: async () => h.rewardedOk,
    leaderboardAvailable: () => false,
    leaderboardMode: () => 'none',
    submitScore: async () => {},
    gameReady: () => {},
    level: (kind: string) => { h.levels.push(kind); },
  },
}));

vi.mock('../src/render', () => ({
  GameRenderer: class { fps = 60; loadRace() {} frame() {} showMenuScene() {} setQuality() {} setCameraRotating() {} },
}));

// the in-race HUD extras (minimap, combo, gaps) build real DOM / canvas elements: stubbed here (see tests/hudLogic.test.ts)
vi.mock('../src/ui/hud', () => ({
  HudExtras: class { bonusMoney = 0; bestChain = 0; takedownCount = 0; start() {} stop() {} frame() { return 0; } },
}));

vi.mock('../src/audio/audio', () => ({
  AudioManager: class { setPaused() {} setGameplayPaused() {} setMuted() {} update() {} onEvents() {} ui() {} },
}));

vi.mock('../src/input/input', () => ({
  InputController: class {
    touchActive = false;
    setAutoGas() {} setEnabled() {} setLabels() {} onKey() {} onTouchMode() {}
    setScheme() {} setSensitivity() {} setPointSource() {} recenter() {} onTiltStatus() {}
    getInput() { return { ...h.input }; }
  },
}));

vi.mock('../src/ui/ui', () => ({
  UI: class {
    constructor(_root: unknown, handlers: Record<string, (...a: unknown[]) => unknown>) {
      const rec = { handlers, calls: {} as Record<string, unknown[][]>, toasts: [] as string[] };
      h.ui = rec;
      return new Proxy(this, {
        get: (_t, name: string) => (...args: unknown[]) => {
          (rec.calls[name] ??= []).push(args);
          if (name === 'toast') rec.toasts.push(String(args[0]));
        },
      });
    }
  },
}));

import { bootGame, type Game } from '../src/game';
import { CONFIG } from '../src/config';

let rafCb: ((t: number) => void) | null = null;
let now = 1000;
let hidden = false;
const dom = { lang: '', els: new Map<string, { remove: () => void }>() };

function installDom(): void {
  rafCb = null;
  (globalThis as { window?: unknown }).window = globalThis;
  (globalThis as { location?: unknown }).location = { hostname: 'localhost', search: '' };
  (globalThis as { document?: unknown }).document = {
    get hidden() { return hidden; },
    documentElement: { set lang(v: string) { dom.lang = v; }, get lang() { return dom.lang; } },
    getElementById: (id: string) => (id === 'boot' ? { remove() {} } : {}),
    addEventListener: () => {},
  };
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (cb: (t: number) => void) => { rafCb = cb; return 1; };
  (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => {};
  vi.spyOn(performance, 'now').mockImplementation(() => now);
}

/** Advance `seconds` of wall time in 1/30 s frames. */
function run(seconds: number): void {
  const frames = Math.round(seconds * 30);
  for (let i = 0; i < frames; i++) { now += 1000 / 30; rafCb?.(now); }
}
const G = () => (globalThis as unknown as { __game: NonNullable<Window['__game']> }).__game;
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

let game: Game;
beforeEach(async () => {
  h.ui = null; h.interstitial = null; h.pauseCb = null; h.adCb = null; h.rewardedOk = true; h.levels = [];
  h.input = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  hidden = false; now = 1000;
  installDom();
  game = await bootGame();
});
afterEach(() => { vi.restoreAllMocks(); });

const settings = (over: object = {}) => ({ lang: 'en', autoGas: false, quality: 'auto', muted: false, tutorialDone: true, camera: 'auto', ...over });

describe('game flow', () => {
  it('boots into the menu', () => {
    expect(G().state).toBe('menu');
    expect(h.ui!.calls.showMainMenu?.length).toBe(1);
  });

  it('first run: the tutorial is non-blocking - the countdown runs, the sheet hides at the first input after GO', () => {
    G().startRace('t1');
    expect(G().state).toBe('racing');
    expect(h.ui!.calls.showTutorial?.length).toBe(1);
    run(1);
    expect(G().sim!.race.countdown).toBeLessThan(CONFIG.race.countdown - 0.5);   // not frozen behind the sheet
    expect(h.ui!.calls.hideTutorial).toBeUndefined();
    run(CONFIG.race.countdown + 0.3);
    h.input = { throttle: 1, brake: 0, steer: 0, handbrake: false };
    run(0.2);
    expect(h.ui!.calls.hideTutorial?.length).toBe(1);
  });

  it('first run on touch: the automatic gas is not an input - the sheet stays after GO until a real steer, brake or the GO + N s timer', () => {
    G().startRace('t1');
    (G() as unknown as { input: { touchActive: boolean } }).input.touchActive = true;   // after the start: a first touch race would show the controls picker
    h.input = { throttle: 1, brake: 0, steer: 0, handbrake: false };   // auto gas is always on
    run(CONFIG.race.countdown + 1);
    expect(h.ui!.calls.hideTutorial).toBeUndefined();
    h.input = { throttle: 1, brake: 0, steer: 0.6, handbrake: false };
    run(0.2);
    expect(h.ui!.calls.hideTutorial?.length).toBe(1);
  });

  it('first run: with no input the sheet hides at GO + tutorialHideAfterGoS', () => {
    G().startRace('t1');
    run(CONFIG.race.countdown + CONFIG.ui.tutorialHideAfterGoS - 0.5);
    expect(h.ui!.calls.hideTutorial).toBeUndefined();
    run(1);
    expect(h.ui!.calls.hideTutorial?.length).toBe(1);
  });

  it('pause freezes the sim, resume continues; level messages follow', () => {
    h.ui!.handlers.settings(settings());
    G().startRace('t1');
    run(1);
    const t0 = G().sim!.race.countdown;
    G().pause();
    expect(G().state).toBe('paused');
    run(1);
    expect(G().sim!.race.countdown).toBe(t0);
    G().resume();
    expect(G().state).toBe('racing');
    run(0.5);
    expect(G().sim!.race.countdown).toBeLessThan(t0);
    expect(h.levels).toEqual(['started', 'paused', 'resumed']);
  });

  it('platform pause and an externally opened ad freeze the sim without changing the state', () => {
    h.ui!.handlers.settings(settings());
    G().startRace('t1');
    run(0.5);
    h.pauseCb!(true);
    const t = G().sim!.race.countdown;
    run(1);
    expect(G().sim!.race.countdown).toBe(t);
    h.pauseCb!(false);
    h.adCb!(true);
    run(1);
    expect(G().sim!.race.countdown).toBe(t);
    h.adCb!(false);
    run(1);
    expect(G().sim!.race.countdown).toBeLessThan(t);
    expect(G().state).toBe('racing');
  });

  it('a hidden tab pauses the race', () => {
    h.ui!.handlers.settings(settings());
    G().startRace('t1');
    run(0.5);
    hidden = true;
    const t = G().sim!.race.countdown;
    run(1);
    expect(G().sim!.race.countdown).toBe(t);
  });

  it('finish -> results (completed) -> continue shows ONE interstitial with the sim held, then the menu', async () => {
    h.ui!.handlers.settings(settings());
    G().startRace('t1');
    run(0.5);
    G().forceFinish();
    expect(G().state).toBe('results');
    expect(h.ui!.calls.showResults?.length).toBe(1);
    expect(h.levels).toEqual(['started', 'completed']);
    h.ui!.handlers.continueAfterResults();
    h.ui!.handlers.continueAfterResults();   // double tap
    await flush();
    expect(G().state).toBe('ad');
    expect(h.interstitial!.calls).toBe(1);
    h.interstitial!.resolve();
    await flush();
    expect(G().state).toBe('menu');
    expect(G().sim).toBeNull();
  });

  it('rewarded double: pays once, a second request is refused', async () => {
    h.ui!.handlers.settings(settings());
    G().startRace('t1');
    G().forceFinish();
    const money0 = G().save.money;
    const reward = (h.ui!.calls.showResults![0][0] as { reward: number }).reward;
    expect(reward).toBeGreaterThan(0);
    expect(await h.ui!.handlers.doubleReward()).toBe(true);
    expect(G().save.money).toBe(money0 + reward);
    expect(await h.ui!.handlers.doubleReward()).toBe(false);
    expect(G().save.money).toBe(money0 + reward);
    expect(G().state).toBe('results');
  });

  it('a failed / closed rewarded ad pays nothing and keeps the results screen', async () => {
    h.ui!.handlers.settings(settings());
    G().startRace('t1');
    G().forceFinish();
    const money0 = G().save.money;
    h.rewardedOk = false;
    expect(await h.ui!.handlers.doubleReward()).toBe(false);
    expect(G().save.money).toBe(money0);
    h.rewardedOk = true;
    expect(await h.ui!.handlers.doubleReward()).toBe(true);   // may be retried
  });

  it('quit from the pause menu: interstitial first, then the menu; level_failed', async () => {
    h.ui!.handlers.settings(settings());
    G().startRace('t1');
    run(0.5);
    G().pause();
    h.ui!.handlers.quit();
    await flush();
    expect(G().state).toBe('ad');
    expect(h.interstitial!.calls).toBe(1);
    expect(G().sim).not.toBeNull();   // still the paused race while the ad is up
    h.interstitial!.resolve();
    await flush();
    expect(G().state).toBe('menu');
    expect(h.levels).toEqual(['started', 'paused', 'failed']);
  });

  it('restart from the pause menu: interstitial, then a fresh race', async () => {
    h.ui!.handlers.settings(settings());
    G().startRace('t1');
    run(2);
    const first = G().sim;
    G().pause();
    h.ui!.handlers.restart();
    await flush();
    expect(h.interstitial!.calls).toBe(1);
    h.interstitial!.resolve();
    await flush();
    expect(G().state).toBe('racing');
    expect(G().sim).not.toBe(first);
    expect(G().sim!.race.phase).toBe('countdown');
    expect(h.levels).toEqual(['started', 'paused', 'failed', 'started']);
  });

  it('results: Race again and Next track go through the interstitial path (the Bridge decides if one shows), then start the race', async () => {
    h.ui!.handlers.settings(settings());
    G().startRace('t1');
    run(0.5);
    G().forceFinish();
    expect(G().state).toBe('results');
    const res = h.ui!.calls.showResults![0][0] as { nextTrack?: string | null };
    h.ui!.handlers.retry();
    await flush();
    expect(h.interstitial!.calls).toBe(1);            // asked once; nothing starts while it is open
    expect(G().state).toBe('ad');
    h.ui!.handlers.retry();                           // a second tap during the ad is ignored
    expect(h.interstitial!.calls).toBe(1);
    h.interstitial!.resolve();
    await flush();
    expect(G().state).toBe('racing');
    const len1 = G().sim!.track.length;
    // top-3 unlocks t2 -> Next track
    G().save.unlockedTracks.push('t2');
    G().forceFinish();
    h.ui!.handlers.nextTrack('t2');
    await flush();
    expect(h.interstitial!.calls).toBe(2);
    h.interstitial!.resolve();
    await flush();
    expect(G().state).toBe('racing');
    expect(G().sim!.track.length).not.toBe(len1);
    expect(res).toBeDefined();
  });

  it('retry is ignored outside the results screen', () => {
    h.ui!.handlers.retry();
    expect(G().state).toBe('menu');
  });

  it('boot with an ad already open does not crash (watchAds fires synchronously)', async () => {
    h.adCb = null;
    const mod = await import('../src/platform/bridge');
    const p = mod.platform as unknown as { watchAds: (cb: (o: boolean) => void) => void };
    const orig = p.watchAds;
    p.watchAds = (cb) => { cb(true); h.adCb = cb; };
    try {
      const g = await bootGame();
      expect(g).toBeDefined();
      h.adCb!(false);
    } finally { p.watchAds = orig; }
  });

  it('locked tracks cannot be started', () => {
    G().startRace('t2');
    expect(G().state).toBe('menu');
    expect(G().sim).toBeNull();
  });
});

describe('player reset (wedged car)', () => {
  function startAndGo(): void {
    h.ui!.handlers.settings(settings());
    G().startRace('t1');
    run(CONFIG.race.countdown + 0.8);
    expect(G().sim!.race.phase).toBe('racing');
  }
  const pose = () => { const c = G().sim!.cars[0]; return { x: c.x, y: c.y }; };

  it('hint after ~2 s, free reset onto the road after ~4 s of holding the gas while wedged', () => {
    startAndGo();
    G().sim!.simCars[0].body.setType('static');   // wedged: cannot move whatever the input
    h.input = { throttle: 1, brake: 0, steer: 0, handbrake: false };
    const before = pose();
    run(CONFIG.game.stuckMinRaceTime + CONFIG.game.stuckHintAfter + 0.4);
    expect(h.ui!.toasts).toContain('Stuck? Hold brake to reverse');
    expect(h.ui!.toasts).not.toContain('Back on track');
    run(CONFIG.game.stuckResetAfter - CONFIG.game.stuckHintAfter + 0.4);
    expect(h.ui!.toasts).toContain('Back on track');
    const after = pose();
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(CONFIG.game.resetAhead - 0.5);
    // the reset places the car on the road centre
    const near = G().sim!.track.nearest(after.x, after.y);
    expect(Math.abs(near.lateral)).toBeLessThan(1);
  });

  it('no reset while the player is not touching the controls', () => {
    startAndGo();
    G().sim!.simCars[0].body.setType('static');
    h.input = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    run(8);
    expect(h.ui!.toasts).not.toContain('Back on track');
  });

  it('no reset while paused', () => {
    startAndGo();
    G().sim!.simCars[0].body.setType('static');
    h.input = { throttle: 1, brake: 0, steer: 0, handbrake: false };
    run(1);
    G().pause();
    run(8);
    expect(h.ui!.toasts).not.toContain('Back on track');
  });
});

describe('debug hook', () => {
  it('is installed on localhost', () => { expect(G()).toBeDefined(); });

  it('is NOT installed in a production build on a real host', async () => {
    vi.stubEnv('DEV', false);
    (globalThis as { location?: unknown }).location = { hostname: 'playgama.com', search: '' };
    delete (globalThis as { __game?: unknown }).__game;
    await bootGame();
    expect((globalThis as { __game?: unknown }).__game).toBeUndefined();
    (globalThis as { location?: unknown }).location = { hostname: 'playgama.com', search: '?debug' };
    await bootGame();
    expect((globalThis as { __game?: unknown }).__game).toBeDefined();
    vi.unstubAllEnvs();
  });
});
