import { describe, it, expect, vi, afterEach } from 'vitest';
import { platform } from '../src/platform/bridge';

type Cb = (...a: unknown[]) => void;
function makeBridge(over: Record<string, unknown> = {}) {
  const listeners = new Map<string, Set<Cb>>();
  const emitter = {
    on: (n: string, cb: Cb) => { (listeners.get(n) ?? listeners.set(n, new Set()).get(n)!).add(cb); },
    off: (n: string, cb?: Cb) => { if (cb) listeners.get(n)?.delete(cb); },
  };
  const sendMessage = vi.fn(async () => undefined);
  const ad = { ...emitter, isInterstitialSupported: true, isRewardedSupported: true, showInterstitial: vi.fn(), showRewarded: vi.fn(), ...over };
  const bridge = { ...emitter, isInitialized: true, initialize: async () => {}, advertisement: ad, platform: { ...emitter, language: 'ru', sendMessage } };
  const emit = (n: string, ...a: unknown[]) => listeners.get(n)?.forEach((cb) => cb(...a));
  return { bridge, ad, emit, sendMessage };
}
afterEach(() => { delete (globalThis as { bridge?: unknown }).bridge; });

describe('platform language (3.4.2)', () => {
  it('is "en" when the Bridge is not ready, never the browser language', async () => {
    vi.stubGlobal('navigator', { language: 'ru-RU' });
    // no bridge at all: init is a no-op, ready stays as it was (false in a fresh module state is not guaranteed -> use a failing init)
    const m = makeBridge();
    (m.bridge as { isInitialized: boolean }).isInitialized = false;
    (m.bridge as { initialize: () => Promise<void> }).initialize = async () => { throw new Error('boom'); };
    (globalThis as { bridge?: unknown }).bridge = m.bridge;
    await platform.init();
    expect(platform.language()).toBe('en');
    vi.unstubAllGlobals();
  });

  it('returns the platform language once ready', async () => {
    const m = makeBridge();
    (globalThis as { bridge?: unknown }).bridge = m.bridge;
    await platform.init();
    expect(platform.language()).toBe('ru');
  });
});

describe('platform messages', () => {
  it('uses only documented Bridge message ids', async () => {
    const m = makeBridge();
    (globalThis as { bridge?: unknown }).bridge = m.bridge;
    await platform.init();
    platform.gameReady();
    for (const k of ['started', 'paused', 'resumed', 'completed', 'failed'] as const) platform.level(k, 't1');
    const ids = m.sendMessage.mock.calls.map((c) => (c as unknown[])[0]);
    expect(ids).toEqual(['game_ready', 'level_started', 'level_paused', 'level_resumed', 'level_completed', 'level_failed']);
  });

  it('a rejecting sendMessage never leaks an unhandled rejection', async () => {
    const m = makeBridge();
    m.sendMessage.mockImplementation(async () => { throw new Error('nope'); });
    (globalThis as { bridge?: unknown }).bridge = m.bridge;
    await platform.init();
    const un = vi.fn();
    const proc = (globalThis as unknown as { process: { on(e: string, f: () => void): void; off(e: string, f: () => void): void } }).process;
    proc.on('unhandledRejection', un);
    platform.level('started', 't1');
    await new Promise((r) => setTimeout(r, 10));
    proc.off('unhandledRejection', un);
    expect(un).not.toHaveBeenCalled();
  });
});

describe('watchAds', () => {
  it('reports an ad that is already open at start, then its close', async () => {
    const m = makeBridge({ interstitialState: 'opened' });
    (globalThis as { bridge?: unknown }).bridge = m.bridge;
    await platform.init();
    const seen: boolean[] = [];
    platform.watchAds((o) => seen.push(o));
    expect(seen).toEqual([]);          // never synchronously: the caller may still be booting (audit PL3)
    await Promise.resolve();
    expect(seen).toEqual([true]);
    m.emit('interstitial_state_changed', 'closed');
    expect(seen).toEqual([true, false]);
  });

  it('tracks platform-driven ads (opened / failed) and ignores loading', async () => {
    const m = makeBridge();
    (globalThis as { bridge?: unknown }).bridge = m.bridge;
    await platform.init();
    const seen: boolean[] = [];
    platform.watchAds((o) => seen.push(o));
    m.emit('interstitial_state_changed', 'loading');
    m.emit('interstitial_state_changed', 'opened');
    m.emit('rewarded_state_changed', 'opened');
    m.emit('interstitial_state_changed', 'closed');
    m.emit('rewarded_state_changed', 'failed');
    expect(seen).toEqual([true, true, true, false]);
  });
});
