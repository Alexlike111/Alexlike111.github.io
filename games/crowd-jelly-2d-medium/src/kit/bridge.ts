// Thin wrapper around Playgama Bridge (window.bridge), which the publisher requires.
// On YouTube Playables Bridge drives the YouTube SDK itself. Outside any platform
// Bridge runs a mock and ads fall back to a dev mock. Never call window.bridge elsewhere.
import { BUILD_VERSION, GAME } from './config';
import { deviceClass } from './device';

declare global {
  interface Window {
    bridge?: any;
    ytgame?: any;
    __qa?: any;
  }
}

const SAVE_KEY = GAME.saveKey;
const b = (): any => window.bridge;
/** ?qa=1 turns on the test hooks (event log, mock ads) that npm run check uses. */
export const QA = new URLSearchParams(location.search).has('qa');

let memorySave = '';
let loaded = false;
let queuedSave: string | null = null;
let saving: Promise<void> | null = null;

async function drainSaves(): Promise<void> {
  try {
    while (queuedSave !== null) {
      const data = queuedSave;
      queuedSave = null;
      try {
        if ((await ready) && !isMock()) await b().storage.set([SAVE_KEY], [data]);
        else { memorySave = data; if (QA) window.name = `__qasave:${data}`; } // ?qa=1 keeps the mock save across reloads of the tab
      } catch (e) {
        console.warn('saveData failed', e);
      }
    }
  } finally {
    saving = null;
  }
}

let adBlocked = false;

async function detectAdBlock(): Promise<boolean> {
  // The QA tool simulates ads itself: a blocker in the tester's browser must not hide them.
  const id = b().platform?.id;
  if (id === 'mock' || id === 'qa_tool' || !b().advertisement?.checkAdBlock) return false;
  return !!(await Promise.race([b().advertisement.checkAdBlock(), new Promise((r) => setTimeout(() => r(false), 3000))]));
}

const ready: Promise<boolean> = (async () => {
  try {
    if (!b()) return false;
    // off-platform (file://, plain local server) Bridge may never answer: give up after 2 s and run in mock mode
    await Promise.race([b().initialize(), new Promise((_, no) => setTimeout(() => no(new Error('bridge init timeout')), 2000))]);
    try {
      adBlocked = await detectAdBlock();
    } catch {
      /* unknown: keep ads on */
    }
    return true;
  } catch (e) {
    console.warn('bridge init failed', e);
    return false;
  }
})();

const platformId = (): string => {
  try {
    return b()?.platform?.id || 'mock';
  } catch {
    return 'mock';
  }
};
const isMock = (): boolean => platformId() === 'mock';

/** Shows an ad and waits for it. Never hangs: blocked SDK, errors or a missing "closed" all resolve. */
function watchAd(kind: 'interstitial' | 'rewarded', show: () => unknown): Promise<Set<string>> {
  const ad = b().advertisement;
  const event = kind === 'rewarded' ? b().EVENT_NAME.REWARDED_STATE_CHANGED : b().EVENT_NAME.INTERSTITIAL_STATE_CHANGED;
  return new Promise((resolve) => {
    const seen = new Set<string>();
    let done = false;
    let timer = 0;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ad.off?.(event, onState);
      } catch {
        /* ignore */
      }
      resolve(seen);
    };
    // nothing yet: 4 s; loading: 5 s; opened: up to 75 s for "closed"
    const arm = (ms: number) => {
      clearTimeout(timer);
      timer = window.setTimeout(finish, ms);
    };
    const onState = (state: string) => {
      seen.add(state);
      if (state === 'closed' || state === 'failed') finish();
      else if (state === 'opened') arm(75_000);
      else if (!seen.has('opened')) arm(5000);
    };
    arm(4000);
    try {
      ad.on(event, onState);
      const r = show() as Promise<unknown> | undefined;
      if (r && typeof r.then === 'function') r.then(undefined, finish);
    } catch {
      finish();
    }
  });
}

function mockAd(ms = 900): Promise<boolean> {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'mock-ad';
    el.textContent = 'AD (dev mock)';
    document.body.appendChild(el);
    setTimeout(() => {
      el.remove();
      resolve(true);
    }, ms);
  });
}

export const platform = {
  firstFrameReady(): void {},

  gameReady(): void {
    ready.then((ok) => {
      try {
        if (ok) b().platform.sendMessage('game_ready');
      } catch (e) {
        console.warn(e);
      }
    });
  },

  async loadData(): Promise<string> {
    try {
      if ((await ready) && !isMock()) {
        const [data] = await b().storage.get([SAVE_KEY]);
        if (data == null) return '';
        return typeof data === 'string' ? data : JSON.stringify(data);
      }
      return memorySave || (QA && window.name.startsWith('__qasave:') ? window.name.slice(9) : '');
    } catch (e) {
      console.warn('loadData failed', e);
      return '';
    } finally {
      loaded = true;
    }
  },

  /** One write in flight; writes that arrive meanwhile collapse into one with the newest data. */
  saveData(data: string): Promise<void> {
    if (!loaded) return Promise.resolve(); // YouTube rejects saves before the first load
    queuedSave = data;
    if (!saving) saving = drainSaves();
    return saving;
  },

  async getLanguage(): Promise<string> {
    try {
      if ((await ready) && !isMock()) return b().platform.language || 'en';
    } catch (e) {
      console.warn(e);
    }
    return new URLSearchParams(location.search).get('lang') || 'en'; // dev only: ?lang=ru
  },

  isAudioEnabled(): boolean {
    try {
      const v = b()?.platform?.isAudioEnabled;
      return v === undefined ? true : !!v;
    } catch {
      return true;
    }
  },

  onAudioEnabledChange(cb: (enabled: boolean) => void): void {
    ready.then((ok) => {
      try {
        if (ok) b().platform.on(b().EVENT_NAME.AUDIO_STATE_CHANGED, (on: boolean) => cb(!!on));
      } catch (e) {
        console.warn(e);
      }
    });
  },

  onPause(cb: () => void): void {
    ready.then((ok) => {
      try {
        if (ok) b().platform.on(b().EVENT_NAME.PAUSE_STATE_CHANGED, (paused: boolean) => paused && cb());
      } catch (e) {
        console.warn(e);
      }
    });
  },

  onResume(cb: () => void): void {
    ready.then((ok) => {
      try {
        if (ok) b().platform.on(b().EVENT_NAME.PAUSE_STATE_CHANGED, (paused: boolean) => !paused && cb());
      } catch (e) {
        console.warn(e);
      }
    });
  },

  /** Best score to the platform leaderboard (id top_score in public/playgama-bridge-config.json). */
  async sendScore(value: number): Promise<void> {
    const score = Math.floor(value);
    try {
      if (!(await ready)) return;
      const lb = b().leaderboards;
      if (lb && lb.type && lb.type !== 'not_available') {
        await lb.setScore('top_score', score);
        return;
      }
    } catch (e) {
      console.warn('setScore failed', e);
    }
    try {
      if (platformId() === 'youtube') await window.ytgame?.engagement?.sendScore({ value: score });
    } catch (e) {
      console.warn('sendScore failed', e);
    }
  },

  /** True while Bridge still counts an earlier ad as running: it then silently ignores new ad requests. */
  adBusy(): boolean {
    try {
      const a = b()?.advertisement;
      return !!a && (['loading', 'opened'].includes(a.interstitialState) || ['loading', 'opened', 'rewarded'].includes(a.rewardedState));
    } catch {
      return false;
    }
  },

  /** Ad blocker seen at start; asks again (the player may have turned it off). */
  async adBlockedNow(): Promise<boolean> {
    if (!adBlocked) return false;
    try {
      adBlocked = await detectAdBlock();
    } catch {
      /* keep the old answer */
    }
    return adBlocked;
  },

  /**
   * Interstitial. Only src/kit/ads.ts may call this (project rule: tap on Next/Again after a result,
   * >= 90 s apart, not in the first 3 min). Resolves true when an ad was shown (or mocked in ?qa=1).
   */
  async showInterstitial(placement = 'level_completed'): Promise<boolean> {
    try {
      if (QA) return await mockAd(300);
      if (!(await ready) || isMock() || adBlocked || !b().advertisement.isInterstitialSupported) return false;
      const seen = await watchAd('interstitial', () => b().advertisement.showInterstitial(placement));
      return seen.has('opened') || seen.has('closed');
    } catch (e) {
      console.warn('interstitial failed', e);
      return false;
    }
  },

  /** Resolves true only when the player earned the reward. */
  async showRewarded(rewardId: string): Promise<boolean> {
    try {
      if (QA) return await mockAd(300);
      if (!(await ready) || isMock()) return await mockAd();
      if (adBlocked || !b().advertisement.isRewardedSupported) return false;
      for (let i = 0; i < 15 && platform.adBusy(); i++) await new Promise((r) => setTimeout(r, 200)); // earlier ad still closing
      if (platform.adBusy()) return false;
      const seen = await watchAd('rewarded', () => b().advertisement.showRewarded(rewardId));
      return seen.has('rewarded');
    } catch (e) {
      console.warn('rewarded failed', e);
      return false;
    }
  },

  /** Analytics (Bridge 2.3+). Flat data, bounded values, no player text. device_class and build_version go into EVERY event. */
  track(name: string, data?: Record<string, string | number | boolean>): void {
    const full = { ...data, device_class: deviceClass(), build_version: BUILD_VERSION };
    if (QA) (window.__qa ??= { events: [] }).events.push({ name, data: full });
    ready.then((ok) => {
      try {
        if (ok && b().analytics?.send) b().analytics.send(name, full);
      } catch (e) {
        console.warn('track failed', e);
      }
    });
  },

  logError(): void {
    try {
      if (platformId() === 'youtube') window.ytgame?.health?.logError();
    } catch {
      /* ignore */
    }
  },
};
