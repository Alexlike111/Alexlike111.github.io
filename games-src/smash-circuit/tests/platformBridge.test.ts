// Playgama Bridge wrapper against a mocked Bridge: leaderboards (read + write), ad edge cases, pause / audio, and the
// "no Bridge at all" fallbacks (standalone hosting, the claude.ai artifact iframe, unit tests).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { platform } from '../src/platform/bridge';

type Cb = (...a: unknown[]) => void;
type Anything = Record<string, unknown>;

function makeBridge(over: { lb?: Anything; ad?: Anything; platform?: Anything; player?: Anything; bridge?: Anything } = {}) {
  const listeners = new Map<string, Set<Cb>>();
  const emitter = {
    on: (n: string, cb: Cb) => { (listeners.get(n) ?? listeners.set(n, new Set()).get(n)!).add(cb); },
    off: (n: string, cb?: Cb) => { if (cb) listeners.get(n)?.delete(cb); },
  };
  const emit = (n: string, ...a: unknown[]) => listeners.get(n)?.forEach((cb) => cb(...a));
  const ad = { ...emitter, isInterstitialSupported: true, isRewardedSupported: true, showInterstitial: vi.fn(), showRewarded: vi.fn(), ...over.ad };
  const lb = { type: 'in_game', setScore: vi.fn(async () => undefined), getEntries: vi.fn(async () => []), showNativePopup: vi.fn(async () => undefined), ...over.lb };
  const sendMessage = vi.fn(async () => undefined);
  const bridge = {
    ...emitter, isInitialized: true, initialize: async () => {}, advertisement: ad, leaderboards: lb,
    player: { id: 'me', ...over.player },
    platform: { ...emitter, language: 'ru', isAudioEnabled: true, sendMessage, ...over.platform },
    ...over.bridge,
  };
  return { bridge, ad, lb, emit, sendMessage, listeners };
}
const install = async (m: { bridge: unknown }) => { (globalThis as { bridge?: unknown }).bridge = m.bridge; await platform.init(); };
afterEach(() => { vi.useRealTimers(); delete (globalThis as { bridge?: unknown }).bridge; });

describe('no Bridge at all (standalone / artifact iframe)', () => {
  it('every call is a safe no-op and nothing waits', async () => {
    delete (globalThis as { bridge?: unknown }).bridge;
    await platform.init();
    expect(platform.hasBridge()).toBe(false);
    expect(platform.language()).toBe('en');
    expect(platform.isAudioEnabled()).toBe(true);
    await expect(platform.showInterstitial()).resolves.toBeUndefined();
    await expect(platform.showRewarded()).resolves.toBe(false);
    expect(platform.isRewardedSupported()).toBe(false);
    expect(platform.leaderboardMode()).toBe('none');
    expect(platform.leaderboardAvailable()).toBe(false);
    await expect(platform.submitScore('best_lap_t1', 61234)).resolves.toBe(false);
    await expect(platform.leaderboardTop('best_lap_t1')).resolves.toEqual({ status: 'unavailable' });
    await expect(platform.showLeaderboardPopup('best_lap_t1')).resolves.toBe(false);
    expect(() => { platform.gameReady(); platform.level('started', 't1'); platform.onPause(() => {}); platform.onAudio(() => {}); platform.watchAds(() => {}); }).not.toThrow();
    const r = await platform.load(['a', 'b']);
    expect(r.status).toBe('empty');           // local mode = a new player, writes are allowed
    await expect(platform.save({ a: 1 })).resolves.toBe(false);
  });

  it('a Bridge object without any module (partial / hostile global) does not throw either', async () => {
    const m = { bridge: { isInitialized: true, initialize: async () => {}, on() {}, off() {} } };
    await install(m);
    await expect(platform.showInterstitial()).resolves.toBeUndefined();
    await expect(platform.showRewarded()).resolves.toBe(false);
    expect(platform.leaderboardMode()).toBe('none');
    await expect(platform.leaderboardTop('x')).resolves.toEqual({ status: 'unavailable' });
    expect(() => platform.gameReady()).not.toThrow();
  });

  it('a Bridge whose initialize() fails keeps every feature off (not ready)', async () => {
    const m = makeBridge({ bridge: { isInitialized: false, initialize: async () => { throw new Error('boom'); } } });
    await install(m);
    expect(platform.isReady()).toBe(false);
    expect(platform.leaderboardMode()).toBe('none');
    expect(platform.isRewardedSupported()).toBe(false);
    await platform.showInterstitial();
    expect(m.ad.showInterstitial).not.toHaveBeenCalled();
    await expect(platform.submitScore('x', 1)).resolves.toBe(false);
  });
});

describe('leaderboards', () => {
  it('maps the Bridge type to the four cases and hides everything else', async () => {
    for (const [type, mode] of [['in_game', 'in_game'], ['native', 'native'], ['native_popup', 'native_popup'], ['not_available', 'none'], ['weird', 'none'], [undefined, 'none']] as const) {
      await install(makeBridge({ lb: { type } }));
      expect(platform.leaderboardMode(), String(type)).toBe(mode);
      expect(platform.leaderboardAvailable(), String(type)).toBe(mode !== 'none');
    }
  });

  it('submitScore sends the score to setScore and reports success / failure without throwing', async () => {
    const m = makeBridge();
    await install(m);
    await expect(platform.submitScore('best_lap_t1', 61234)).resolves.toBe(true);
    expect(m.lb.setScore).toHaveBeenCalledWith('best_lap_t1', 61234);
    m.lb.setScore.mockRejectedValueOnce(new Error('offline'));
    await expect(platform.submitScore('best_lap_t1', 60000)).resolves.toBe(false);
    m.lb.setScore.mockImplementationOnce(() => { throw new Error('sync boom'); });
    await expect(platform.submitScore('best_lap_t1', 60000)).resolves.toBe(false);
    m.lb.setScore.mockClear();
    await expect(platform.submitScore('best_lap_t1', Number.NaN)).resolves.toBe(false);
    expect(m.lb.setScore).not.toHaveBeenCalled();
  });

  it('submitScore never hangs: a setScore that never settles resolves false after 8 s', async () => {
    vi.useFakeTimers();
    const m = makeBridge({ lb: { setScore: vi.fn(() => new Promise(() => {})) } });
    await install(m);
    let res: boolean | null = null;
    void platform.submitScore('best_lap_t1', 5000).then((v) => { res = v; });
    await vi.advanceTimersByTimeAsync(7900);
    expect(res).toBe(null);
    await vi.advanceTimersByTimeAsync(300);
    expect(res).toBe(false);
  });

  it('leaderboardTop returns the top 10 sorted by rank with the player flagged', async () => {
    const entries = Array.from({ length: 14 }, (_, i) => ({ id: i === 6 ? 'me' : 'p' + i, name: ' Racer ' + i + ' ', score: 60000 + i * 100, rank: 14 - i, photo: null }));
    const m = makeBridge({ lb: { getEntries: vi.fn(async () => entries) } });
    await install(m);
    const r = await platform.leaderboardTop('best_lap_t2');
    expect(m.lb.getEntries).toHaveBeenCalledWith('best_lap_t2');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.rows).toHaveLength(10);
    expect(r.rows.map((x) => x.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(r.rows[0]).toEqual({ rank: 1, name: 'Racer 13', score: 61300, isPlayer: false });
    expect(r.rows.filter((x) => x.isPlayer).map((x) => x.rank)).toEqual([8]);   // 'me' has rank 8 of 14: inside the top 10, flagged once
  });

  it('flags the player row and honours a smaller limit', async () => {
    const m = makeBridge({ lb: { getEntries: vi.fn(async () => [{ id: 'a', name: 'A', score: 1, rank: 1 }, { id: 'me', name: 'Me', score: 2, rank: 2 }, { id: 'c', name: 'C', score: 3, rank: 3 }]) } });
    await install(m);
    const r = await platform.leaderboardTop('best_lap_t1', 2);
    expect(r).toEqual({ status: 'ok', rows: [{ rank: 1, name: 'A', score: 1, isPlayer: false }, { rank: 2, name: 'Me', score: 2, isPlayer: true }] });
  });

  it('survives garbage entries: drops rows without a numeric score, falls back to list order for a missing rank, never keeps non-string names', async () => {
    const junk = [null, 7, 'x', { name: 'No score' }, { name: 'NaN', score: 'abc' }, { id: 1, name: { evil: true }, score: 5000 }, { id: 2, name: '<b>x</b>', score: '6000', rank: 'n/a' }];
    const m = makeBridge({ lb: { getEntries: vi.fn(async () => junk) } });
    await install(m);
    const r = await platform.leaderboardTop('best_lap_t1');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.rows.map((x) => x.score)).toEqual([5000, 6000]);
    expect(r.rows[0].name).toBe('');                   // not a string -> empty (the UI shows a default name)
    expect(r.rows[1].name).toBe('<b>x</b>');           // plain text; the UI must escape it
  });

  it('is unavailable unless the type is in_game, and reports failure (not a crash) on a rejected or hanging read', async () => {
    for (const type of ['native', 'native_popup', 'not_available']) {
      const m = makeBridge({ lb: { type } });
      await install(m);
      await expect(platform.leaderboardTop('x'), type).resolves.toEqual({ status: 'unavailable' });
      expect(m.lb.getEntries).not.toHaveBeenCalled();
    }
    const bad = makeBridge({ lb: { getEntries: vi.fn(async () => { throw new Error('403'); }) } });
    await install(bad);
    await expect(platform.leaderboardTop('x')).resolves.toEqual({ status: 'failed' });
    const notList = makeBridge({ lb: { getEntries: vi.fn(async () => ({ nope: 1 })) } });
    await install(notList);
    await expect(platform.leaderboardTop('x')).resolves.toEqual({ status: 'failed' });

    vi.useFakeTimers();
    const hang = makeBridge({ lb: { getEntries: vi.fn(() => new Promise(() => {})) } });
    await install(hang);
    let res: unknown = null;
    void platform.leaderboardTop('x').then((v) => { res = v; });
    await vi.advanceTimersByTimeAsync(8500);
    expect(res).toEqual({ status: 'failed' });
  });

  it('a Bridge without getEntries (older SDK) is unavailable, not a TypeError', async () => {
    const m = makeBridge({ lb: { getEntries: undefined } });
    await install(m);
    await expect(platform.leaderboardTop('x')).resolves.toEqual({ status: 'unavailable' });
  });

  it('showLeaderboardPopup works only on native_popup platforms', async () => {
    const pop = makeBridge({ lb: { type: 'native_popup' } });
    await install(pop);
    await expect(platform.showLeaderboardPopup('best_lap_t1')).resolves.toBe(true);
    expect(pop.lb.showNativePopup).toHaveBeenCalledWith('best_lap_t1');
    pop.lb.showNativePopup.mockRejectedValueOnce(new Error('x'));
    await expect(platform.showLeaderboardPopup('best_lap_t1')).resolves.toBe(false);
    const inGame = makeBridge();
    await install(inGame);
    await expect(platform.showLeaderboardPopup('best_lap_t1')).resolves.toBe(false);
    expect(inGame.lb.showNativePopup).not.toHaveBeenCalled();
  });
});

describe('ads: edge cases the game relies on', () => {
  it('an unsupported interstitial resolves at once and never calls the Bridge', async () => {
    const m = makeBridge({ ad: { isInterstitialSupported: false } });
    await install(m);
    await platform.showInterstitial();
    expect(m.ad.showInterstitial).not.toHaveBeenCalled();
  });

  it('interstitial: closed and failed both release the game; a synchronous throw does too', async () => {
    for (const end of ['closed', 'failed']) {
      const m = makeBridge();
      await install(m);
      let done = false;
      void platform.showInterstitial().then(() => { done = true; });
      m.emit('interstitial_state_changed', 'loading');
      m.emit('interstitial_state_changed', 'opened');
      await Promise.resolve();
      expect(done, 'still open').toBe(false);
      m.emit('interstitial_state_changed', end);
      await Promise.resolve();
      expect(done, end).toBe(true);
      expect(m.listeners.get('interstitial_state_changed')?.size ?? 0).toBe(0);   // listener removed
    }
    const boom = makeBridge({ ad: { showInterstitial: vi.fn(() => { throw new Error('sdk'); }) } });
    await install(boom);
    await expect(platform.showInterstitial()).resolves.toBeUndefined();
  });

  it('rewarded: the reward is granted ONLY for the rewarded state, never for closed / failed', async () => {
    const outcomes: Array<[string[], boolean]> = [
      [['loading', 'opened', 'closed'], false],           // closed early: no reward
      [['loading', 'failed'], false],
      [['opened', 'rewarded', 'closed'], true],
      [['opened', 'rewarded'], true],
    ];
    for (const [seq, want] of outcomes) {
      const m = makeBridge();
      await install(m);
      let res: boolean | null = null;
      void platform.showRewarded().then((v) => { res = v; });
      for (const st of seq) m.emit('rewarded_state_changed', st);
      await Promise.resolve(); await Promise.resolve();
      expect(res, seq.join(',')).toBe(want);
      expect(m.listeners.get('rewarded_state_changed')?.size ?? 0).toBe(0);
    }
  });

  it('rewarded is offered only when the platform supports it, and a throwing SDK grants nothing', async () => {
    const no = makeBridge({ ad: { isRewardedSupported: false } });
    await install(no);
    expect(platform.isRewardedSupported()).toBe(false);
    await expect(platform.showRewarded()).resolves.toBe(false);
    expect(no.ad.showRewarded).not.toHaveBeenCalled();

    const boom = makeBridge({ ad: { showRewarded: vi.fn(() => { throw new Error('sdk'); }) } });
    await install(boom);
    expect(platform.isRewardedSupported()).toBe(true);
    await expect(platform.showRewarded()).resolves.toBe(false);
  });

  it('a rewarded ad that was never shown (no state events) gives up after the open watchdog without a reward', async () => {
    vi.useFakeTimers();
    const m = makeBridge();
    await install(m);
    let res: boolean | null = null;
    void platform.showRewarded().then((v) => { res = v; });
    await vi.advanceTimersByTimeAsync(5100);
    expect(res).toBe(false);
  });
});

describe('pause, audio and lifecycle messages', () => {
  it('forwards pause and audio events to the game and reads the initial audio state', async () => {
    const m = makeBridge({ platform: { isAudioEnabled: false } });
    await install(m);
    expect(platform.isAudioEnabled()).toBe(false);          // start muted when the platform says so
    const pauses: boolean[] = [], audio: boolean[] = [];
    platform.onPause((p) => pauses.push(p));
    platform.onAudio((a) => audio.push(a));
    m.emit('pause_state_changed', true);
    m.emit('pause_state_changed', false);
    m.emit('audio_state_changed', true);
    expect(pauses).toEqual([true, false]);
    expect(audio).toEqual([true]);
  });

  it('level lifecycle: started / paused / resumed / completed carry the track; game_ready has no payload', async () => {
    const m = makeBridge();
    await install(m);
    platform.gameReady();
    platform.level('started', 't2');
    platform.level('completed', 't2');
    expect(m.sendMessage.mock.calls).toEqual([
      ['game_ready', undefined],
      ['level_started', { world: 'circuit', level: 't2' }],
      ['level_completed', { world: 'circuit', level: 't2' }],
    ]);
  });

  it('a platform ad that opens by itself pauses the game (watchAds) and its close resumes it', async () => {
    const m = makeBridge();
    await install(m);
    const seen: boolean[] = [];
    platform.watchAds((o) => seen.push(o));
    m.emit('interstitial_state_changed', 'opened');
    m.emit('interstitial_state_changed', 'closed');
    m.emit('rewarded_state_changed', 'opened');
    m.emit('rewarded_state_changed', 'closed');
    expect(seen).toEqual([true, false, true, false]);
  });
});
