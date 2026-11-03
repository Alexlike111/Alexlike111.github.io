// Playgama Bridge wrapper. `window.bridge` is a global injected by the Vite plugin / the platform
// BEFORE the game script. Everything here degrades to a safe no-op when the global is missing
// (unit tests, ui-preview.html, plain static hosting), so the game never crashes on platform code.
//
// Required Bridge steps covered here: initialize first, platform.language, storage only through Bridge
// (one get for all keys, one set per meaningful change), pause + audio events, game_ready,
// interstitial at natural pauses without own timers, rewarded reward ONLY in the 'rewarded' state,
// unsupported features reported as unavailable so the UI can hide them.

type Listener = (...args: unknown[]) => void;

interface Emitter {
  on(name: string, cb: Listener): void;
  off(name: string, cb?: Listener): void;
}

interface BridgeLike extends Emitter {
  isInitialized?: boolean;
  initialize(opts?: unknown): Promise<void>;
  EVENT_NAME?: Record<string, string>;
  platform?: Emitter & {
    language?: string;
    isAudioEnabled?: boolean;
    isPaused?: boolean;
    sendMessage?(msg: string, opts?: unknown): Promise<unknown>;
  };
  storage?: {
    get(keys: string | string[], parseJson?: boolean): Promise<unknown>;
    set(keys: string | string[], values: unknown): Promise<void>;
  };
  advertisement?: Emitter & {
    isInterstitialSupported?: boolean;
    isRewardedSupported?: boolean;
    interstitialState?: string;
    rewardedState?: string;
    showInterstitial(placement?: string | null): void;
    showRewarded(placement?: string | null): void;
  };
  leaderboards?: {
    type?: string;
    setScore(id: string, score: number): Promise<unknown>;
  };
}

function B(): BridgeLike | null {
  const g = globalThis as unknown as { bridge?: BridgeLike };
  return g.bridge ?? null;
}

const EV = {
  pause: 'pause_state_changed',
  audio: 'audio_state_changed',
  interstitial: 'interstitial_state_changed',
  rewarded: 'rewarded_state_changed',
};
function evName(key: keyof typeof EV): string {
  return B()?.EVENT_NAME?.[EV[key].toUpperCase()] ?? EV[key];
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const id = setTimeout(() => resolve(fallback), ms);
    p.then((v) => { clearTimeout(id); resolve(v); }, () => { clearTimeout(id); resolve(fallback); });
  });
}

const INIT_TIMEOUT_MS = 8000;
// Ad watchdogs. The Bridge reports loading -> opened -> closed | failed. If it silently skips an ad
// (minimum delay, no fill) and emits nothing, the game must not hang, so:
//  - nothing at all within AD_OPEN_WAIT_MS            -> treat as "not shown", resolve;
//  - 'loading' seen but no 'opened' in AD_LOAD_WAIT_MS -> resolve;
//  - after 'opened' only the long AD_SHOWN_TIMEOUT_MS safety net applies (a real ad reports closed).
const AD_OPEN_WAIT_MS = 5000;
const AD_LOAD_WAIT_MS = 20000;
const AD_SHOWN_TIMEOUT_MS = 10 * 60 * 1000;

/** Watchdog that is re-armed per ad phase. */
function adWatchdog(onExpire: () => void) {
  let id: ReturnType<typeof setTimeout> | undefined;
  const arm = (ms: number) => { clearTimeout(id); id = setTimeout(onExpire, ms); };
  return {
    start: () => arm(AD_OPEN_WAIT_MS),
    loading: () => arm(AD_LOAD_WAIT_MS),
    opened: () => arm(AD_SHOWN_TIMEOUT_MS),
    stop: () => clearTimeout(id),
  };
}

let ready = false;

export type LevelMessage = 'started' | 'paused' | 'resumed' | 'completed' | 'failed';

function sendMessage(msg: string, opts?: unknown): void {
  try {
    const r = B()?.platform?.sendMessage?.(msg, opts);
    if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch(() => { /* ignore */ });
  } catch { /* ignore */ }
}

export const platform = {
  async init(): Promise<void> {
    const b = B();
    if (!b) return;
    try {
      // A REJECTED initialize() means the Bridge is unusable: stay "not ready" (language 'en', no storage/ads).
      // A slow one (timeout) is still used: it may finish later and its calls are safe either way.
      if (!b.isInitialized) ready = await withTimeout(b.initialize().then(() => true, () => false), INIT_TIMEOUT_MS, true);
      else ready = true;
    } catch (e) {
      console.warn('[platform] bridge init failed', e);
    }
  },

  /**
   * Raw platform language tag (e.g. "ru", "en", "pt"). Playgama 3.4.2: never derived from the browser by the game
   * itself, so when the Bridge is not ready (init failed / timed out / plain static hosting) this is "en".
   * (When the Bridge IS ready, the Bridge applies its own documented browser fallback inside `platform.language`.)
   */
  language(): string {
    try { return (ready && B()?.platform?.language) || 'en'; } catch { return 'en'; }
  },

  isAudioEnabled(): boolean {
    try { return !ready || B()?.platform?.isAudioEnabled !== false; } catch { return true; }
  },

  onPause(cb: (paused: boolean) => void): void {
    const p = B()?.platform;
    if (p && ready) p.on(evName('pause'), (v) => cb(!!v));
  },

  onAudio(cb: (enabled: boolean) => void): void {
    const p = B()?.platform;
    if (p && ready) p.on(evName('audio'), (v) => cb(!!v));
  },

  /** One storage.get for all keys. Missing keys -> null. Never throws. */
  async load(keys: string[]): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = null;
    const b = B();
    if (!b?.storage || !ready) return out;
    try {
      const res = await withTimeout(b.storage.get(keys, true), INIT_TIMEOUT_MS, null as unknown);
      if (Array.isArray(res)) keys.forEach((k, i) => { out[k] = res[i] ?? null; });
      else if (res && typeof res === 'object') for (const k of keys) out[k] = (res as Record<string, unknown>)[k] ?? null;
      else if (keys.length === 1 && res != null) out[keys[0]] = res;
    } catch (e) {
      console.warn('[platform] storage.get failed', e);
    }
    return out;
  },

  /** One storage.set with every changed key. Never throws. */
  async save(data: Record<string, unknown>): Promise<boolean> {
    const b = B();
    const keys = Object.keys(data);
    if (!b?.storage || !ready || keys.length === 0) return false;
    try {
      await b.storage.set(keys, keys.map((k) => data[k]));
      return true;
    } catch (e) {
      console.warn('[platform] storage.set failed', e);
      return false;
    }
  },

  /**
   * Request an interstitial at a natural pause. Bridge decides if/when it is really shown (initial delay,
   * minimum interval) - no timers or counters here. Resolves when closed / failed / not shown.
   * The platform pause + audio events silence and freeze the game while the ad is open.
   */
  showInterstitial(): Promise<void> {
    const b = B();
    const ad = b?.advertisement;
    if (!b || !ad || !ready || ad.isInterstitialSupported === false) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let done = false;
      const name = evName('interstitial');
      const finish = () => { if (done) return; done = true; wd.stop(); try { ad.off(name, onState); } catch { /* ignore */ } resolve(); };
      const wd = adWatchdog(finish);
      const onState = (...a: unknown[]) => {
        const st = a[0];
        if (st === 'closed' || st === 'failed') finish();
        else if (st === 'opened') wd.opened();
        else if (st === 'loading') wd.loading();
      };
      try {
        ad.on(name, onState);
        wd.start();
        ad.showInterstitial();
      } catch { finish(); }
    });
  },

  /**
   * Bridge docs: check at start whether an ad is already open (mute + pause until it closes).
   * `onChange(open)` also fires for ads that were not requested by the game (platform-driven ads).
   */
  watchAds(onChange: (open: boolean) => void): void {
    const ad = B()?.advertisement;
    if (!ad || !ready) return;
    let interstitial = ad.interstitialState === 'opened';
    let rewarded = ad.rewardedState === 'opened';
    const push = () => onChange(interstitial || rewarded);
    if (interstitial || rewarded) push();
    const track = (which: 'i' | 'r') => (...a: unknown[]) => {
      const open = a[0] === 'opened';
      const closed = a[0] === 'closed' || a[0] === 'failed';
      if (!open && !closed) return;
      if (which === 'i') interstitial = open; else rewarded = open;
      push();
    };
    try {
      ad.on(evName('interstitial'), track('i'));
      ad.on(evName('rewarded'), track('r'));
    } catch { /* ignore */ }
  },

  isRewardedSupported(): boolean {
    try { return ready && B()?.advertisement?.isRewardedSupported === true; } catch { return false; }
  },

  /** true ONLY when the platform reported the 'rewarded' state. */
  showRewarded(): Promise<boolean> {
    const ad = B()?.advertisement;
    if (!ad || !ready || ad.isRewardedSupported !== true) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      let granted = false;
      let done = false;
      const name = evName('rewarded');
      const finish = (v: boolean) => { if (done) return; done = true; wd.stop(); try { ad.off(name, onState); } catch { /* ignore */ } resolve(v); };
      const wd = adWatchdog(() => finish(granted));
      const onState = (...a: unknown[]) => {
        const st = a[0];
        if (st === 'rewarded') { granted = true; finish(true); }
        else if (st === 'closed' || st === 'failed') finish(granted);
        else if (st === 'opened') wd.opened();
        else if (st === 'loading') wd.loading();
      };
      try {
        ad.on(name, onState);
        wd.start();
        ad.showRewarded();
      } catch { finish(false); }
    });
  },

  /** Hide leaderboard UI / skip submissions when the platform has none. */
  leaderboardAvailable(): boolean {
    try {
      const t = B()?.leaderboards?.type;
      return ready && !!t && t !== 'not_available';
    } catch { return false; }
  },

  async submitScore(id: string, score: number): Promise<void> {
    if (!platform.leaderboardAvailable()) return;
    try { await B()!.leaderboards!.setScore(id, score); } catch (e) { console.warn('[platform] setScore failed', e); }
  },

  gameReady(): void {
    sendMessage('game_ready');
  },

  /**
   * Lifecycle messages from the Bridge message list (level_started | level_paused | level_resumed |
   * level_completed | level_failed). Fire-and-forget, errors swallowed; unsupported platforms ignore them.
   */
  level(kind: LevelMessage, track?: string): void {
    sendMessage('level_' + kind, track ? { world: 'circuit', level: track } : undefined);
  },
};

export type Platform = typeof platform;
