import { describe, it, expect, beforeEach } from 'vitest';

// ---- minimal Web Audio fake: records every buffer source that is started on the (impact) bus
interface Started { name: string; gain: number }
let started: Started[] = [];
class FakeParam { value = 0; setTargetAtTime(v: number) { this.value = v; } cancelScheduledValues() { /* */ } }
class FakeNode {
  gain = new FakeParam(); frequency = new FakeParam(); playbackRate = new FakeParam(); threshold = new FakeParam();
  knee = new FakeParam(); ratio = new FakeParam(); attack = new FakeParam(); release = new FakeParam();
  buffer: { name: string } | null = null; loop = false; type = ''; onended: (() => void) | null = null;
  connect(n: unknown) { return n; } disconnect() { /* */ }
  start() { started.push({ name: this.buffer?.name ?? '?', gain: this.lastGain }); }
  stop() { /* */ }
  lastGain = 0;
}
class FakeCtx {
  state = 'running'; currentTime = 0; destination = new FakeNode(); sampleRate = 44100;
  createGain() { return new FakeNode(); }
  createBiquadFilter() { return new FakeNode(); }
  createDynamicsCompressor() { return new FakeNode(); }
  createBufferSource() { return new FakeNode(); }
  resume() { return Promise.resolve(); } suspend() { return Promise.resolve(); }
}

// each created source remembers the gain node it was connected through, so the test can read the voice volume
const origGain = FakeCtx.prototype.createGain;
FakeCtx.prototype.createBufferSource = function () {
  const src = new FakeNode();
  src.connect = (n: unknown) => { const g = n as FakeNode; if (g && 'gain' in g) { Object.defineProperty(src, 'lastGain', { get: () => g.gain.value }); } return n; };
  return src;
};
void origGain;

const g = globalThis as unknown as Record<string, unknown>;
g.window = { addEventListener() { /* */ }, AudioContext: FakeCtx };
g.document = { addEventListener() { /* */ }, hidden: false, createElement: () => ({ canPlayType: () => 'maybe' }) };
g.fetch = () => Promise.resolve({ ok: false, status: 404 });
console.warn = () => { /* load failures are expected here */ };

import { AudioManager, impactLevel, seamlessLoop } from '../src/audio/audio';
import type { SimEvent } from '../src/types';

function makeAudio(): AudioManager {
  started = [];
  const am = new AudioManager();
  am.unlock();
  const a = am as unknown as { buffers: Map<string, unknown>; px: number; py: number; haveListener: boolean };
  for (const fam of ['impact_light', 'impact_heavy', 'impact_wood', 'impact_metal', 'impact_concrete', 'impact_plastic', 'crunch', 'debris']) {
    for (let i = 1; i <= 3; i++) a.buffers.set(`${fam}_${i}`, { name: `${fam}_${i}` });
  }
  a.px = 0; a.py = 0; a.haveListener = true;
  return am;
}
const imp = (carId: number, x: number, strength: number, other: 'car' | 'wall' = 'wall'): SimEvent =>
  ({ type: 'impact', x, y: 0, strength, carId, other } as SimEvent);
const metalOrConcrete = (): Started[] => started.filter((s) => /^impact_(metal|concrete)/.test(s.name));

describe('impact audio priority (audit AU2)', () => {
  let am: AudioManager;
  beforeEach(() => { am = makeAudio(); });

  it('alone, the own hit plays', () => {
    am.onEvents([imp(0, 0, 0.7)], 0);
    expect(started.length).toBeGreaterThan(0);
  });

  it('an earlier AI hit in the same frame does not silence the own hit', () => {
    am.onEvents([imp(3, 22, 0.8, 'car'), imp(0, 0, 0.7, 'wall')], 0);
    expect(metalOrConcrete().some((s) => s.name.startsWith('impact_concrete'))).toBe(true);   // own wall hit
  });

  it('own hit is played first, loudest first among the rest, at most 3 collisions per frame', () => {
    am.onEvents([imp(1, 3, 0.2), imp(2, 4, 0.95), imp(3, 5, 0.6), imp(4, 6, 0.9), imp(0, 0, 0.5)], 0);
    const first = started[0];
    expect(first.name).toMatch(/^impact_concrete/);                // own wall hit (concrete family) leads
    // only 3 hits were started: count the primary material layers
    const primaries = started.filter((s) => /^impact_(concrete|metal|light|plastic|wood)/.test(s.name));
    expect(primaries.length).toBeLessThanOrEqual(3);
  });

  it('a weak tap does not beat strong hits in a pile-up', () => {
    am.onEvents([imp(1, 3, 0.2), imp(2, 4, 1.0, 'car'), imp(3, 5, 0.95, 'wall'), imp(4, 6, 0.6, 'car')], 0);
    const heavy = started.filter((s) => s.name.startsWith('impact_heavy'));
    expect(heavy.length).toBeGreaterThanOrEqual(2);                // the two strongest got their heavy layer
  });

  it('own hits have their own gate: two own hits 0.2 s apart both play', () => {
    am.onEvents([imp(0, 0, 0.9)], 0);
    am.update(null, 0.2);
    const n = started.length;
    am.onEvents([imp(0, 0, 0.9)], 0);
    expect(started.length).toBeGreaterThan(n);
  });
});

describe('loudness curve (audit AU3)', () => {
  it('rises at least 5 dB from strength 0.3 to 1.0 and is monotonic', () => {
    const db = (s: number): number => 20 * Math.log10(impactLevel(s));
    expect(db(1) - db(0.3)).toBeGreaterThanOrEqual(5);
    let prev = 0;
    for (let s = 0; s <= 1.0001; s += 0.05) { expect(impactLevel(s)).toBeGreaterThanOrEqual(prev); prev = impactLevel(s); }
    expect(impactLevel(1)).toBeCloseTo(1, 6);
  });
});

describe('loop seams (audit AU4)', () => {
  const sr = 44100;
  it('crossfaded loop has no wrap click larger than the signal\'s own steps', () => {
    // 50 Hz tone whose last cycle is cut off-phase (like a limiter-shifted render)
    const n = Math.round(sr * 2.003);
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) raw[i] = 0.5 * Math.sin(2 * Math.PI * 50 * i / sr) * (i < 200 ? i / 200 : 1);
    const wrap = (d: Float32Array): number => Math.abs(d[0] - d[d.length - 1]);
    let maxStep = 0;
    const out = seamlessLoop(raw, sr, 0, 0.04);
    for (let i = 1; i < out.length; i++) maxStep = Math.max(maxStep, Math.abs(out[i] - out[i - 1]));
    expect(out.length).toBe(n - Math.round(0.04 * sr));
    expect(wrap(out)).toBeLessThanOrEqual(maxStep * 1.5);
  });
  it('edge-faded music loop keeps its length and starts/ends at silence', () => {
    const raw = new Float32Array(sr).fill(0.4);
    const out = seamlessLoop(raw, sr, 0, 0);
    expect(out.length).toBe(raw.length);
    expect(Math.abs(out[0])).toBeLessThan(0.01);
    expect(Math.abs(out[out.length - 1])).toBeLessThan(0.01);
  });
});
