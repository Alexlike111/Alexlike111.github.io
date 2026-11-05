import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { platform } from '../src/platform/bridge';

type Cb = (...a: unknown[]) => void;

function makeBridge() {
  const listeners = new Map<string, Set<Cb>>();
  const emitter = {
    on: (n: string, cb: Cb) => { (listeners.get(n) ?? listeners.set(n, new Set()).get(n)!).add(cb); },
    off: (n: string, cb?: Cb) => { if (cb) listeners.get(n)?.delete(cb); else listeners.delete(n); },
  };
  const ad = {
    ...emitter,
    isInterstitialSupported: true,
    isRewardedSupported: true,
    showInterstitial: vi.fn(),
    showRewarded: vi.fn(),
  };
  const bridge = { ...emitter, isInitialized: true, initialize: async () => {}, advertisement: ad, platform: { ...emitter } };
  const emit = (n: string, ...a: unknown[]) => listeners.get(n)?.forEach((cb) => cb(...a));
  return { bridge, ad, emit, listeners };
}

describe('platform ads watchdog', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { bridge?: unknown }).bridge;
  });

  async function setup() {
    const m = makeBridge();
    (globalThis as { bridge?: unknown }).bridge = m.bridge;
    await platform.init();
    return m;
  }

  it('interstitial that never reports any state resolves after ~5 s', async () => {
    const m = await setup();
    let done = false;
    void platform.showInterstitial().then(() => { done = true; });
    expect(m.ad.showInterstitial).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4900);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    expect(done).toBe(true);
    expect(m.listeners.get('interstitial_state_changed')?.size ?? 0).toBe(0);
  });

  it('interstitial that opened is NOT cut off by the short watchdog and resolves on closed', async () => {
    const m = await setup();
    let done = false;
    void platform.showInterstitial().then(() => { done = true; });
    m.emit('interstitial_state_changed', 'loading');
    await vi.advanceTimersByTimeAsync(10000);
    expect(done).toBe(false);          // loading extends the wait
    m.emit('interstitial_state_changed', 'opened');
    await vi.advanceTimersByTimeAsync(60000);
    expect(done).toBe(false);          // a long ad is still running
    m.emit('interstitial_state_changed', 'closed');
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });

  it('interstitial stuck in loading resolves after the load wait', async () => {
    const m = await setup();
    let done = false;
    void platform.showInterstitial().then(() => { done = true; });
    m.emit('interstitial_state_changed', 'loading');
    await vi.advanceTimersByTimeAsync(20500);
    expect(done).toBe(true);
  });

  it('rewarded that never reports resolves false after ~5 s; rewarded state grants', async () => {
    const m = await setup();
    let res: boolean | null = null;
    void platform.showRewarded().then((v) => { res = v; });
    await vi.advanceTimersByTimeAsync(5200);
    expect(res).toBe(false);

    let res2: boolean | null = null;
    void platform.showRewarded().then((v) => { res2 = v; });
    m.emit('rewarded_state_changed', 'opened');
    await vi.advanceTimersByTimeAsync(30000);
    expect(res2).toBe(null);
    m.emit('rewarded_state_changed', 'rewarded');
    await vi.advanceTimersByTimeAsync(0);
    expect(res2).toBe(true);
  });
});
