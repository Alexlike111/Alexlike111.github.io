import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GhostData } from '../src/types';

vi.mock('../src/platform/bridge', () => {
  const calls: { data: Record<string, unknown>; order: number }[] = [];
  let release: Array<() => void> = [];
  let n = 0;
  return {
    platform: {
      load: vi.fn(async (keys: string[]) => ({ status: 'empty', values: Object.fromEntries(keys.map((k) => [k, null])) })),
      save: vi.fn(async (data: Record<string, unknown>) => {
        const order = n++;
        await new Promise<void>((r) => { release.push(r); });
        calls.push({ data, order });
        return true;
      }),
    },
    __calls: calls,
    __release: () => { const r = release; release = []; r.forEach((f) => f()); },
    __reset: () => { calls.length = 0; release = []; n = 0; },
  };
});

import * as bridge from '../src/platform/bridge';
import { SAVE_KEY_CORE, SAVE_KEY_CORRUPT, SAVE_KEY_GHOSTS, SAVE_KEY_PREV, canWrite, defaultSave, flushSave, loadSave, sanitizeSave, serializeGhosts, writeSave } from '../src/meta/save';

const mock = bridge as unknown as { __calls: { data: Record<string, unknown>; order: number }[]; __release: () => void; __reset: () => void };

function ghost(trackId: string, frames = 1500): GhostData {
  const f = Array.from({ length: frames }, (_, i) => ({ t: i / 20, x: 100 + Math.cos(i / 40) * 50.123, y: 20 + Math.sin(i / 40) * 33.456, a: (i / 40) % 6.28 }));
  return { trackId, lapTime: frames / 20, frames: f };
}

describe('save ghosts', () => {
  it('round-trips through the packed format (cm / mrad precision)', () => {
    const g = ghost('t1', 400);
    const back = sanitizeSave({}, JSON.parse(serializeGhosts({ t1: g }))).ghosts.t1;
    expect(back.frames.length).toBe(400);
    expect(back.lapTime).toBeCloseTo(g.lapTime, 2);
    expect(Math.abs(back.frames[123].x - g.frames[123].x)).toBeLessThan(0.006);
    expect(Math.abs(back.frames[123].a - g.frames[123].a)).toBeLessThan(0.0006);
  });

  it('still reads the legacy object-frame format', () => {
    const g = ghost('t2', 50);
    const back = sanitizeSave({}, { t2: g }).ghosts.t2;
    expect(back.frames.length).toBe(50);
  });

  it('is much smaller than the legacy JSON and bounded by CONFIG.save.maxGhostChars', () => {
    const three = { t1: ghost('t1', 6000), t2: ghost('t2', 6000), t3: ghost('t3', 6000) };   // 5 minute laps
    const packed = serializeGhosts(three);
    expect(packed.length).toBeLessThan(JSON.stringify(three).length / 2);
    expect(packed.length).toBeLessThanOrEqual(240000);
    const back = sanitizeSave({}, JSON.parse(packed));
    expect(Object.keys(back.ghosts).length).toBe(3);
    expect(back.ghosts.t1.frames.length).toBeGreaterThan(100);
  });

  it('drops corrupt packed ghosts instead of throwing', () => {
    expect(sanitizeSave({}, { t1: { lapTime: 50, d: [1, 2, 3] } }).ghosts.t1).toBeUndefined();
    expect(sanitizeSave({}, { t1: { lapTime: 50, d: [1, 2, 3, 'x', 1, 2, 3, 4] } }).ghosts.t1).toBeUndefined();
  });
});

const loadMock = () => bridge.platform.load as unknown as ReturnType<typeof vi.fn>;
type LoadRes = { status: string; values: Record<string, unknown> };
const stored = (core: unknown, ghosts: unknown = null): LoadRes => ({ status: 'ok', values: { [SAVE_KEY_CORE]: core, [SAVE_KEY_GHOSTS]: ghosts } });

describe('loadSave status (audit #1)', () => {
  beforeEach(() => { mock.__reset(); loadMock().mockReset(); });

  it('loaded: reads the stored record, enables writes and keeps the old record as sc_core_prev with the first write', async () => {
    const raw = JSON.stringify({ ...defaultSave(), money: 5000 });
    loadMock().mockResolvedValue(stored(raw));
    const r = await loadSave();
    expect(r.status).toBe('loaded');
    expect(r.save.money).toBe(5000);
    expect(canWrite()).toBe(true);
    const p = writeSave({ ...r.save, money: 5100 });
    await new Promise((x) => setTimeout(x, 0));
    mock.__release(); await p; await flushSave();
    expect(mock.__calls[0].data[SAVE_KEY_PREV]).toBe(raw);
    // only the FIRST write of the session carries the backup
    const p2 = writeSave({ ...r.save, money: 5200 });
    await new Promise((x) => setTimeout(x, 0));
    mock.__release(); await p2;
    expect(SAVE_KEY_PREV in mock.__calls[1].data).toBe(false);
  });

  it('empty: a genuinely absent record = new player with defaults, writes enabled', async () => {
    loadMock().mockResolvedValue({ status: 'empty', values: { [SAVE_KEY_CORE]: null, [SAVE_KEY_GHOSTS]: null } });
    const r = await loadSave();
    expect(r.status).toBe('empty');
    expect(r.save.money).toBe(defaultSave().money);
    expect(canWrite()).toBe(true);
  });

  it('failed: a throwing / failed read gives defaults but BLOCKS every write (the stored save must survive)', async () => {
    loadMock().mockResolvedValue({ status: 'failed', values: {} });
    const r = await loadSave();
    expect(r.status).toBe('failed');
    expect(canWrite()).toBe(false);
    await writeSave({ ...defaultSave(), money: 1 });
    await flushSave();
    expect(bridge.platform.save).not.toHaveBeenCalled();
    loadMock().mockRejectedValue(new Error('boom'));
    expect((await loadSave()).status).toBe('failed');
    expect(canWrite()).toBe(false);
  });

  it('a later successful retry re-enables writes', async () => {
    loadMock().mockResolvedValueOnce({ status: 'failed', values: {} });
    await loadSave();
    expect(canWrite()).toBe(false);
    loadMock().mockResolvedValueOnce(stored(JSON.stringify({ ...defaultSave(), money: 77 })));
    const r = await loadSave();
    expect(r.status).toBe('loaded');
    expect(canWrite()).toBe(true);
  });

  it('corrupt: an unparseable core record gives defaults and is backed up to sc_core_corrupt (not lost)', async () => {
    loadMock().mockResolvedValue(stored('{not json'));
    const r = await loadSave();
    expect(r.status).toBe('corrupt');
    expect(r.save.money).toBe(defaultSave().money);
    expect(canWrite()).toBe(true);
    const p = writeSave(r.save);
    await new Promise((x) => setTimeout(x, 0));
    mock.__release(); await p; await flushSave();
    expect(mock.__calls[0].data[SAVE_KEY_CORRUPT]).toBe('{not json');
  });
});

describe('writeSave queue', () => {
  beforeEach(async () => {
    mock.__reset();
    loadMock().mockReset();
    loadMock().mockResolvedValue({ status: 'empty', values: { [SAVE_KEY_CORE]: null, [SAVE_KEY_GHOSTS]: null } });
    await loadSave();   // writes enabled
  });

  it('serialises writes: the second storage.set starts only after the first finished, in call order', async () => {
    const a = { ...defaultSave(), money: 111 };
    const b = { ...defaultSave(), money: 222 };
    const pa = writeSave(a);
    const pb = writeSave(b);
    await Promise.resolve(); await Promise.resolve();
    const sp = (bridge.platform.save as unknown as ReturnType<typeof vi.fn>);
    expect(sp).toHaveBeenCalledTimes(1);          // b waits for a
    mock.__release();
    await pa;
    await Promise.resolve(); await Promise.resolve();
    expect(sp).toHaveBeenCalledTimes(2);
    mock.__release();
    await pb; await flushSave();
    expect(mock.__calls.map((c) => JSON.parse(c.data[SAVE_KEY_CORE] as string).money)).toEqual([111, 222]);
  });

  it('snapshots the save at call time and skips unchanged ghosts', async () => {
    const s = { ...defaultSave(), ghosts: { t1: ghost('t1', 100) } };
    const p1 = writeSave(s);
    await new Promise((r) => setTimeout(r, 0));
    mock.__release(); await p1;
    const p2 = writeSave({ ...s, money: 5 });
    await new Promise((r) => setTimeout(r, 0));
    mock.__release(); await p2;
    expect(SAVE_KEY_GHOSTS in mock.__calls[0].data).toBe(true);
    expect(SAVE_KEY_GHOSTS in mock.__calls[1].data).toBe(false);   // unchanged -> not rewritten
  });
});
