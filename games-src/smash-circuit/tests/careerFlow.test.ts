// Career flow through the real Game (fake bridge / renderer / UI / input / audio, REAL sim): cup race -> results -> next -> podium.
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


type Handlers = { career: (a: string, id?: string) => void; retry: () => void; quit: () => void; continueAfterResults: () => void };
const H = (): Handlers => h.ui!.handlers as unknown as Handlers;
const lastResults = () => { const c = h.ui!.calls.showResults!; return c[c.length - 1][0] as { career?: { raceNo: number; raceTotal: number; points: number; cupDone: boolean; goals: { earned: boolean }[]; starCoins: number; cupCoins: number }; nextTrack?: string | null; reward: number }; };

describe('career flow', () => {
  it('Career go starts race 1 of the Rookie Cup: its track and laps, 8 cars, a toast', () => {
    H().career('go', 'rookie');
    expect(G().state).toBe('racing');
    expect(G().sim!.track.def.id).toBe('t1');
    expect(G().sim!.race.totalLaps).toBe(2);
    expect(G().sim!.cars.length).toBe(8);
    expect(G().save.career.run?.cup).toBe('rookie');
    expect(h.ui!.toasts.some((x) => x.includes('Rookie') || x.includes('rookie') || x.includes('career'))).toBe(true);
  });

  it('a locked cup cannot be started', () => {
    H().career('go', 'turbo');
    expect(G().state).toBe('menu');
    expect(G().sim).toBeNull();
  });

  it('finishing records points, stars and standings, and Next starts the following race with the same rivals', () => {
    H().career('go', 'rookie');
    const names1 = G().sim!.cars.map((c) => c.name);
    const money0 = G().save.money;
    G().forceFinish();
    expect(G().state).toBe('results');
    const r = lastResults();
    expect(r.career?.raceNo).toBe(1);
    expect(r.career?.raceTotal).toBe(3);
    expect(r.career?.goals.length).toBe(3);
    expect(r.nextTrack).toBeNull();
    expect(G().save.career.run?.results.length).toBe(1);
    expect(G().save.money).toBeGreaterThanOrEqual(money0 + r.reward);
    H().career('next');
    expect(G().state).toBe('racing');
    expect(G().sim!.track.def.id).toBe('t2');
    expect(G().sim!.cars.map((c) => c.name)).toEqual(names1);
  });

  it('retry replaces the result of the same race instead of adding one', async () => {
    H().career('go', 'rookie');
    G().forceFinish();
    expect(G().save.career.run?.results.length).toBe(1);
    H().retry();                                   // goes through the interstitial path first (Playgama step 7)
    await new Promise((r) => setTimeout(r, 0));
    h.interstitial?.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(G().state).toBe('racing');
    expect(G().sim!.track.def.id).toBe('t1');
    G().forceFinish();
    expect(G().save.career.run?.results.length).toBe(1);
  });

  it('a whole cup ends in the podium, pays the cup prize once and opens the next cup when the stars are there', () => {
    H().career('go', 'rookie');
    G().forceFinish();
    for (let i = 1; i < 3; i++) {
      if (i === 2) { const st = G().save.career.stars; st['rookie:0'] = 7; st['rookie:1'] = 7; }   // enough stars for the Turbo Cup
      H().career('next');
      expect(G().state).toBe('racing');
      G().forceFinish();
    }
    const last = lastResults();
    expect(last.career?.cupDone).toBe(true);
    expect(last.career?.cupCoins).toBeGreaterThan(0);
    expect(G().save.career.cups.rookie?.done).toBe(true);
    H().career('next');
    expect(G().state).toBe('menu');
    expect(h.ui!.calls.showPodium?.length).toBe(1);
    expect(G().sim).toBeNull();
    H().career('done');
    expect(h.ui!.calls.showCareer?.length).toBeGreaterThanOrEqual(1);
    // the Turbo Cup can be started now
    H().career('go', 'turbo');
    expect(G().state).toBe('racing');
    expect(G().sim!.track.def.id).toBe('t2');
  });

  it('quitting a cup race returns to the cup page (not the main menu) and keeps the run', async () => {
    H().career('go', 'rookie');
    G().forceFinish();
    H().career('next');
    const menus = h.ui!.calls.showMainMenu?.length ?? 0;
    G().pause();
    H().quit();
    await flush();
    h.interstitial!.resolve();
    await flush();
    expect(G().state).toBe('menu');
    expect(h.ui!.calls.showCup?.length).toBeGreaterThanOrEqual(1);
    expect(h.ui!.calls.showMainMenu?.length ?? 0).toBe(menus);
    expect(G().save.career.run?.results.length).toBe(1);
  });

  it('a cup race opens its track for Quick race; a Quick race afterwards has no career context', () => {
    H().career('go', 'rookie');
    H().career('go', 'rookie');   // ignored while racing
    G().forceFinish();
    H().career('next');           // t2
    G().forceFinish();
    expect(G().save.unlockedTracks).toContain('t2');
    G().menu();
    G().startRace('t1');
    expect(G().sim!.race.totalLaps).toBe(3);
    G().forceFinish();
    expect(lastResults().career).toBeUndefined();
  });
});
