// Leaderboard view with a mocked Bridge and a tiny fake DOM (the tests run in Node).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { LeaderboardPanel, formatLapMs } from '../src/ui/leaderboard';
import { platform } from '../src/platform/bridge';
import { EN, RU } from '../src/i18n';

class FakeEl {
  hidden = false; className = ''; innerHTML = '';
  listeners: Record<string, (e: unknown) => void> = {};
  children: FakeEl[] = [];
  addEventListener(n: string, cb: (e: unknown) => void) { this.listeners[n] = cb; }
  appendChild(c: FakeEl) { this.children.push(c); return c; }
  replaceChildren() { this.innerHTML = ''; }
  querySelector() { return null; }
}

function click(layer: FakeEl, data: Record<string, string> | null): void {
  const target = data
    ? { closest: () => ({ dataset: data }) }
    : layer;                               // a click on the dim backdrop itself
  layer.listeners.click({ target });
}

async function setup(entries: unknown[] | (() => Promise<unknown>), type = 'in_game') {
  const getEntries = typeof entries === 'function' ? vi.fn(entries) : vi.fn(async () => entries);
  const em = { on() {}, off() {} };
  (globalThis as { bridge?: unknown }).bridge = {
    ...em, isInitialized: true, initialize: async () => {},
    leaderboards: { type, setScore: async () => {}, getEntries },
    player: { id: 'me' }, platform: { ...em },
  };
  await platform.init();
  (globalThis as { document?: unknown }).document = { createElement: () => new FakeEl() };
  const root = new FakeEl();
  const sfx = vi.fn();
  const panel = new LeaderboardPanel(root as unknown as HTMLElement, sfx);
  const layer = root.children[0];
  return { panel, layer, getEntries, sfx };
}
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

afterEach(() => {
  delete (globalThis as { bridge?: unknown }).bridge;
  delete (globalThis as { document?: unknown }).document;
});

describe('formatLapMs', () => {
  it('formats milliseconds as m:ss.cc and guards bad input', () => {
    expect(formatLapMs(61234)).toBe('1:01.23');
    expect(formatLapMs(59999)).toBe('1:00.00');
    expect(formatLapMs(45670)).toBe('0:45.67');
    expect(formatLapMs(125050)).toBe('2:05.05');
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(formatLapMs(bad)).toBe('--:--.--');
  });
});

describe('LeaderboardPanel', () => {
  it('renders the top 10 with times, flags the player and escapes names', async () => {
    const entries = [
      { id: 'a', name: '<img src=x onerror=alert(1)>', score: 61234, rank: 1 },
      { id: 'me', name: 'Me', score: 62000, rank: 2 },
      { id: 'c', name: '', score: 63000, rank: 3 },
    ];
    const { panel, layer, getEntries } = await setup(entries);
    panel.show('t2');
    expect(panel.isOpen).toBe(true);
    expect(layer.innerHTML).toContain(EN['lb.loading']);          // loading state first
    await tick();
    expect(getEntries).toHaveBeenCalledWith('best_lap_t2');
    expect(layer.innerHTML).not.toContain('<img');                // never injected as markup
    expect(layer.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(layer.innerHTML).toContain('1:01.23');
    expect(layer.innerHTML).toMatch(/lb-row me/);                 // the player's row
    expect(layer.innerHTML).toContain(EN['lb.you']);
    expect(layer.innerHTML).toContain(EN['lb.player']);           // empty name -> default name
    expect(layer.innerHTML).toContain('data-id="t1"');            // a tab per track
    expect(layer.innerHTML).toContain('data-id="t3"');
  });

  it('shows the empty state, an error with a retry, and recovers on retry', async () => {
    let fail = true;
    const { panel, layer, getEntries } = await setup(async () => { if (fail) throw new Error('403'); return []; });
    panel.show('t1');
    await tick();
    expect(layer.innerHTML).toContain(EN['lb.error']);
    expect(layer.innerHTML).toContain('data-lb="retry"');
    fail = false;
    click(layer, { lb: 'retry' });
    await tick();
    expect(getEntries).toHaveBeenCalledTimes(2);
    expect(layer.innerHTML).toContain(EN['lb.empty']);
    expect(layer.innerHTML).not.toContain('data-lb="retry"');
  });

  it('switches tabs, drops a late answer for the tab that was left, and closes by button or backdrop', async () => {
    const resolvers: Array<(v: unknown) => void> = [];
    const { panel, layer, getEntries, sfx } = await setup(() => new Promise((r) => { resolvers.push(r); }));
    panel.show('t1');
    click(layer, { lb: 'track', id: 't2' });                      // switch before t1 answered
    expect(getEntries.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['best_lap_t1', 'best_lap_t2']);
    resolvers[1]([{ id: 'x', name: 'Second', score: 70000, rank: 1 }]);
    await tick();
    resolvers[0]([{ id: 'y', name: 'Stale', score: 50000, rank: 1 }]);   // the t1 answer arrives late
    await tick();
    expect(layer.innerHTML).toContain('Second');
    expect(layer.innerHTML).not.toContain('Stale');
    expect(sfx).toHaveBeenCalledWith('click');

    click(layer, { lb: 'close' });
    expect(panel.isOpen).toBe(false);
    panel.show('t3');
    expect(panel.isOpen).toBe(true);
    click(layer, null);                                           // backdrop
    expect(panel.isOpen).toBe(false);
    resolvers[2]?.([{ id: 'z', name: 'Late', score: 1, rank: 1 }]);
    await tick();
    expect(layer.innerHTML).toBe('');                              // a closed panel is not repainted by a late answer
  });

  it('does nothing when the platform has no readable board', async () => {
    for (const type of ['not_available', 'native', 'native_popup']) {
      const { panel, getEntries } = await setup([], type);
      panel.show('t1');
      expect(panel.isOpen, type).toBe(false);
      expect(getEntries).not.toHaveBeenCalled();
    }
  });

  it('has a translated string for every key it uses', () => {
    for (const k of ['lb.title', 'lb.sub', 'lb.loading', 'lb.empty', 'lb.error', 'lb.retry', 'lb.close', 'lb.you', 'lb.player']) {
      expect(EN[k], k).toBeTruthy();
      expect(RU[k], k).toBeTruthy();
    }
  });
});
