// Procedural audio for SNOWCRAFT. Every sound is synthesised at runtime with WebAudio (no files).
// Owner: audio agent (SPEC §1 engine/audio.ts). Public API: `sfx` (bottom of file).
// Node-safe: without an AudioContext every call is a no-op, so importing this module in tests is harmless.
// Engine reads game/state.ts (G) only; materials come from content/materials.ts.
import { G } from '../game/state';
import { MATS } from '../content/materials';

// ------------------------------------------------------------------ types & helpers
export interface PlayOpts { vol?: number; pitch?: number; x?: number; pan?: number }
export interface AmbientOpts { wind: number; storm: number; fire: number; underground: number; night: number; core: number; indoor: number }

interface Route { dest: AudioNode; rev?: AudioNode }
interface VoiceOpts { vol: number; pan?: number; far?: boolean; rev?: number }
interface FX { filt?: [BiquadFilterType, number, number]; vib?: [number, number]; am?: [number, number]; buf?: 'crackle' }
interface Cold { cold: number }
interface Def { f: (v: Voice, c: Cold) => void; pri?: number; gap?: number; far?: boolean; rev?: number }

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const fin = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const MAX_VOICES = 28; // one-shot voices alive at once; low-priority ones are dropped when full
const REJECT = -2, ROOM = -1;

// ------------------------------------------------------------------ shared buffers (cached per sample rate)
interface Loop { buf: AudioBuffer; len: number } // len = loop length in seconds (loopEnd)
interface Bufs { w: Loop; b: Loop; c: Loop }
const bufCache = new Map<number, Bufs>();

/** Fill a buffer, then crossfade its head into its tail so that looping it is click-free. */
function makeLoop(ac: BaseAudioContext, secs: number, fill: (d: Float32Array, sr: number) => void, fade: number): Loop {
  const sr = ac.sampleRate, N = Math.round(secs * sr), L = Math.round(fade * sr);
  const buf = ac.createBuffer(1, N, sr);
  const d = buf.getChannelData(0);
  fill(d, sr);
  for (let i = 0; i < L; i++) { const f = i / L; d[i] = d[i] * f + d[N - L + i] * (1 - f); }
  return { buf, len: (N - L) / sr };
}

function bufs(ac: BaseAudioContext): Bufs {
  let b = bufCache.get(ac.sampleRate);
  if (b) return b;
  b = {
    w: makeLoop(ac, 2, d => { for (let i = 0; i < d.length; i++) d[i] = rnd(-1, 1) * 0.7; }, 0.05),
    b: makeLoop(ac, 4, d => {
      // leaky integration of white noise = brown-ish rumble, normalised
      let last = 0, peak = 1e-6;
      for (let i = 0; i < d.length; i++) { last = (last + 0.03 * rnd(-1, 1)) / 1.03; d[i] = last; if (Math.abs(last) > peak) peak = Math.abs(last); }
      const g = 0.9 / peak;
      for (let i = 0; i < d.length; i++) d[i] *= g;
    }, 0.5),
    c: makeLoop(ac, 2, (d, sr) => {
      // sparse decaying clicks: fire crackle and dry snapping
      const N = d.length, tail = Math.round(sr * 0.012), tau = sr * 0.0016;
      for (let n = 0; n < N; n++) {
        if (Math.random() > 0.0018) continue;
        const a = rnd(0.35, 1);
        for (let j = 0; j < tail && n + j < N; j++) d[n + j] += a * rnd(-1, 1) * Math.exp(-j / tau);
      }
    }, 0.02),
  };
  bufCache.set(ac.sampleRate, b);
  return b;
}

/** Dark, decaying stereo impulse response for the shared cold-room reverb. */
function impulse(ac: BaseAudioContext): AudioBuffer {
  const sr = ac.sampleRate, n = Math.round(sr * 2.4);
  const ir = ac.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) { lp += (rnd(-1, 1) - lp) * 0.3; d[i] = lp * Math.pow(1 - i / n, 2.6); }
  }
  return ir;
}

// ------------------------------------------------------------------ voice builder
/** One sound being built: a set of oscillators/noise bursts, each with an envelope, that all share one output chain. */
class Voice {
  readonly srcs: AudioScheduledSourceNode[] = [];
  end: number;
  pri = 1;
  private readonly entry: AudioNode;
  private readonly rev: AudioNode | null;

  constructor(readonly ac: BaseAudioContext, readonly t: number, readonly k: number, route: Route, o: VoiceOpts) {
    this.end = t;
    const vg = ac.createGain();
    vg.gain.value = o.vol;
    if (o.pan !== undefined && typeof StereoPannerNode !== 'undefined') {
      const pn = new StereoPannerNode(ac, { pan: clamp(o.pan, -1, 1) });
      vg.connect(pn);
      pn.connect(route.dest);
    } else vg.connect(route.dest);
    let entry: AudioNode = vg;
    if (o.far) {
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 1400;
      lp.connect(vg);
      entry = lp;
    }
    this.entry = entry;
    if (route.rev && o.rev) {
      const rs = ac.createGain();
      rs.gain.value = o.rev;
      rs.connect(route.rev);
      this.rev = rs;
    } else this.rev = null;
  }

  /** Attack to `peak` at t0+atk, then exponential decay to silence at t0+dur. */
  private env(p: AudioParam, t0: number, atk: number, peak: number, dur: number) {
    const a = Math.min(atk, dur * 0.5), e = Math.max(dur, a + 0.01);
    p.setValueAtTime(0.0001, t0);
    p.linearRampToValueAtTime(Math.max(peak, 0.0001), t0 + a);
    p.exponentialRampToValueAtTime(0.0001, t0 + e);
  }

  private track(n: AudioScheduledSourceNode, t0: number, dur: number) {
    n.stop(t0 + dur + 0.03);
    this.srcs.push(n);
    if (t0 + dur > this.end) this.end = t0 + dur;
  }

  private lfo(target: AudioParam, hz: number, depth: number, t0: number, dur: number) {
    const l = this.ac.createOscillator();
    l.frequency.value = hz;
    const g = this.ac.createGain();
    g.gain.value = depth;
    l.connect(g);
    g.connect(target);
    l.start(t0);
    this.track(l, t0, dur);
  }

  private chain(n: AudioNode, o: FX) {
    let last: AudioNode = n;
    if (o.filt) {
      const f = this.ac.createBiquadFilter();
      f.type = o.filt[0];
      f.frequency.value = clamp(o.filt[1] * this.k, 20, 20000);
      f.Q.value = o.filt[2];
      n.connect(f);
      last = f;
    }
    last.connect(this.entry);
    if (this.rev) last.connect(this.rev);
  }

  /** Tone with a frequency glide from f0 to f1 (Hz, scaled by pitch). */
  osc(type: OscillatorType, f0: number, f1: number, t0: number, dur: number, peak: number, atk = 0.004, o: FX = {}): GainNode {
    const ac = this.ac, k = this.k;
    const os = ac.createOscillator();
    os.type = type;
    const a = clamp(f0 * k, 20, 20000), b = clamp(f1 * k, 20, 20000);
    os.frequency.setValueAtTime(a, t0);
    if (Math.abs(b - a) > 0.5) os.frequency.exponentialRampToValueAtTime(b, t0 + dur);
    if (o.vib) this.lfo(os.detune, o.vib[0], o.vib[1], t0, dur);
    const g = ac.createGain();
    this.env(g.gain, t0, atk, peak, dur);
    if (o.am) this.lfo(g.gain, o.am[0], o.am[1], t0, dur);
    os.connect(g);
    this.chain(g, o);
    os.start(t0);
    this.track(os, t0, dur);
    return g;
  }

  /** Filtered noise burst; the filter frequency glides from f0 to f1. */
  noise(ft: BiquadFilterType, f0: number, f1: number, q: number, t0: number, dur: number, peak: number, atk = 0.004, o: FX = {}): GainNode {
    const ac = this.ac, k = this.k, sel = o.buf === 'crackle' ? bufs(ac).c : bufs(ac).w;
    const src = ac.createBufferSource();
    src.buffer = sel.buf;
    src.loop = true;
    src.loopEnd = sel.len;
    const f = ac.createBiquadFilter();
    f.type = ft;
    f.Q.value = q;
    const a = clamp(f0 * k, 20, 20000), c = clamp(f1 * k, 20, 20000);
    f.frequency.setValueAtTime(a, t0);
    if (Math.abs(c - a) > 0.5) f.frequency.exponentialRampToValueAtTime(c, t0 + dur);
    const g = ac.createGain();
    this.env(g.gain, t0, atk, peak, dur);
    if (o.am) this.lfo(g.gain, o.am[0], o.am[1], t0, dur);
    src.connect(f);
    f.connect(g);
    this.chain(g, o);
    src.start(t0, Math.random() * sel.len * 0.9);
    this.track(src, t0, dur);
    return g;
  }

  stop() { for (const s of this.srcs) { try { s.stop(); } catch { /* already ended */ } } }
}

const bell = (v: Voice, f: number, t: number, pk: number, dur = 2.2) => {
  v.osc('sine', f, f, t, dur, pk, 0.003);
  v.osc('sine', f * 2.76, f * 2.76, t, dur * 0.45, pk * 0.22, 0.002);
  v.osc('sine', f * 1.004, f * 1.004, t, dur, pk * 0.45, 0.003);
};
const thump = (v: Voice, t: number, pk: number) => {
  v.osc('sine', 78, 42, t, 0.16, pk, 0.004);
  v.noise('lowpass', 320, 160, 0.8, t, 0.09, pk * 0.45, 0.002);
};

// ------------------------------------------------------------------ gramophone records (DESIGN §15): three tunes of our own, played by a worn music-box voice
const NOTE_IDX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** "A4:1 C#5:.5 r:1" -> [midi | -1 (rest), beats][] */
function parseTune(src: string): [number, number][] {
  return src.trim().split(/\s+/).map(tok => {
    const [n, b] = tok.split(':'), beats = parseFloat(b);
    if (n === 'r') return [-1, beats] as [number, number];
    const m = /^([A-G])([#b]?)(\d)$/.exec(n)!;
    return [12 * (parseInt(m[3]) + 1) + NOTE_IDX[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0), beats] as [number, number];
  });
}
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
/** Schedule a tune (melody + bass line) at spb seconds per beat; adds the worn-record crackle and rumble over the whole length. */
function playRecord(v: Voice, melody: string, bass: string, spb: number) {
  const t0 = v.t; let t = t0;
  for (const [m, b] of parseTune(melody)) {
    if (m >= 0) {
      const f = mtof(m), d = Math.max(0.25, b * spb * 1.6);
      v.osc('triangle', f, f, t, d, 0.2, 0.004, { filt: ['lowpass', 2600, 0.7], vib: [5.2, 9] });
      v.osc('sine', f * 2, f * 2, t, d * 0.5, 0.05, 0.003);
    }
    t += b * spb;
  }
  const total = t - t0; t = t0;
  for (const [m, b] of parseTune(bass)) {
    if (m >= 0) { const f = mtof(m); v.osc('sine', f, f, t, Math.max(0.2, b * spb * 0.9), 0.17, 0.006, { filt: ['lowpass', 900, 0.7] }); v.osc('triangle', f * 2, f * 2, t, b * spb * 0.5, 0.04, 0.004); }
    t += b * spb;
  }
  v.noise('highpass', 3500, 3500, 0.7, t0, total, 0.06, 0.3, { buf: 'crackle' });
  v.noise('lowpass', 260, 260, 0.7, t0, total, 0.025, 0.4);
}
const REC1_MEL = 'E5:1 A5:1 G5:1 F5:1.5 E5:.5 D5:1 C5:1 E5:1 A4:1 B4:3 E5:1 A5:1 G5:1 F5:1.5 E5:.5 D5:1 C5:1 B4:1 C5:1 A4:3 A4:1 C5:1 E5:1 A5:1.5 G5:.5 F5:1 E5:1 D5:1 C5:1 B4:1 C5:1 D5:1 E5:1 G5:1 E5:1 D5:1 F5:1 D5:1 C5:1 B4:1 A4:1 A4:3';
const REC1_BASS = 'A2:1 C4:.5 E4:.5 C4:.5 E4:.5 D3:1 F4:.5 A4:.5 F4:.5 A4:.5 A2:1 C4:.5 E4:.5 C4:.5 E4:.5 E3:1 G#3:.5 B3:.5 G#3:.5 B3:.5 A2:1 C4:.5 E4:.5 C4:.5 E4:.5 D3:1 F4:.5 A4:.5 F4:.5 A4:.5 A2:1 C4:.5 E4:.5 C4:.5 E4:.5 A2:3 A2:1 C4:.5 E4:.5 C4:.5 E4:.5 D3:1 F4:.5 A4:.5 F4:.5 A4:.5 C3:1 E4:.5 G4:.5 E4:.5 G4:.5 E3:1 G#3:.5 B3:.5 G#3:.5 B3:.5 A2:1 C4:.5 E4:.5 C4:.5 E4:.5 D3:1 F4:.5 A4:.5 F4:.5 A4:.5 E3:1 G#3:.5 B3:.5 G#3:.5 B3:.5 A2:3';
const REC2_MEL = 'D5:2 F5:1 A5:1 G5:2 F5:1 E5:1 D5:2 C5:1 D5:1 A4:4 F5:2 E5:1 D5:1 C5:2 D5:1 E5:1 F5:2 E5:1 C5:1 D5:4';
const REC2_BASS = 'D3:4 G3:4 D3:4 A2:4 F3:4 C3:4 Bb2:4 D3:4';
const REC3_MEL = 'C5:.5 C5:.5 E5:.5 G5:.5 A5:1 G5:1 F5:.5 F5:.5 A5:.5 C6:.5 B5:1 G5:1 E5:.5 E5:.5 G5:.5 B5:.5 C6:1 A5:1 G5:.5 F5:.5 E5:.5 D5:.5 C5:2 ' +
  'E5:.5 E5:.5 G5:.5 C6:.5 D6:1 C6:1 D5:.5 D5:.5 F5:.5 A5:.5 G5:1 F5:1 E5:.5 G5:.5 C6:.5 E6:.5 D6:1 B5:1 C6:.5 B5:.5 A5:.5 G5:.5 C6:2 ' +
  'C5:.5 C5:.5 E5:.5 G5:.5 A5:1 G5:1 F5:.5 F5:.5 A5:.5 C6:.5 B5:1 G5:1 E5:.5 G5:.5 C6:.5 E6:.5 D6:1 B5:1 C6:.5 B5:.5 A5:.5 G5:.5 C6:2';
const REC3_BASS = 'C3:.5 E4:.5 G4:.5 E4:.5 F3:.5 A4:.5 C5:.5 A4:.5 C3:.5 E4:.5 G4:.5 E4:.5 G3:.5 B4:.5 D5:.5 B4:.5 ' +
  'C3:.5 E4:.5 G4:.5 E4:.5 F3:.5 A4:.5 C5:.5 A4:.5 G3:.5 B4:.5 D5:.5 B4:.5 C3:.5 E4:.5 C4:1 ' +
  'C3:.5 E4:.5 G4:.5 E4:.5 G3:.5 B4:.5 D5:.5 B4:.5 C3:.5 E4:.5 G4:.5 E4:.5 G3:.5 B4:.5 D5:.5 B4:.5 ' +
  'F3:.5 A4:.5 C5:.5 A4:.5 G3:.5 B4:.5 D5:.5 B4:.5 C3:.5 E4:.5 G4:.5 E4:.5 G3:.5 B4:.5 C4:1 ' +
  'C3:.5 E4:.5 G4:.5 E4:.5 F3:.5 A4:.5 C5:.5 A4:.5 C3:.5 E4:.5 G4:.5 E4:.5 G3:.5 B4:.5 D5:.5 B4:.5 ' +
  'F3:.5 A4:.5 C5:.5 A4:.5 G3:.5 B4:.5 D5:.5 B4:.5 C3:.5 E4:.5 C4:1 C3:2';

// ------------------------------------------------------------------ named sounds (synthesis recipes)
// Times are absolute AudioContext times: `t` is the voice start, offsets are added to it.
const DEFS: Record<string, Def> = {
  cut_block: { f: v => { const t = v.t; v.noise('bandpass', 2600, 1100, 1.4, t, 0.26, 0.3, 0.012); v.noise('highpass', 3200, 3200, 0.7, t + 0.17, 0.05, 0.35, 0.002); v.osc('triangle', 150, 110, t + 0.17, 0.09, 0.12, 0.003); } },
  place_block: { f: v => { const t = v.t; v.osc('sine', 130, 70, t, 0.2, 0.42, 0.003); v.noise('lowpass', 900, 500, 0.7, t, 0.14, 0.26, 0.004); v.noise('highpass', 2500, 2500, 0.7, t, 0.03, 0.12, 0.002); } },
  shovel_scoop: { f: v => { const t = v.t; v.noise('bandpass', 900, 480, 0.9, t, 0.36, 0.4, 0.06); v.osc('sine', 95, 70, t + 0.02, 0.14, 0.3, 0.004); v.noise('highpass', 3500, 2000, 0.7, t + 0.22, 0.12, 0.12, 0.01); } },
  shovel_throw: { f: v => { const t = v.t; v.noise('bandpass', 400, 1800, 1.0, t, 0.4, 0.6, 0.08); v.noise('lowpass', 900, 500, 0.7, t + 0.36, 0.2, 0.4, 0.005); } },
  chisel: { f: v => { const t = v.t; [1, 1.51, 2.27].forEach((r, i) => v.osc('sine', 1850 * r, 1850 * r * 0.995, t, 0.28 - 0.06 * i, [0.22, 0.1, 0.05][i], 0.002)); v.noise('highpass', 4000, 4000, 0.7, t, 0.012, 0.4, 0.001); } },
  chop: { f: v => { const t = v.t; v.osc('sine', 230, 85, t, 0.16, 0.6, 0.002); v.noise('bandpass', 1300, 900, 1.2, t, 0.08, 0.45, 0.002); v.osc('triangle', 520, 380, t + 0.005, 0.08, 0.18, 0.002); } },
  pick: { f: v => { const t = v.t; v.noise('highpass', 2200, 2200, 0.7, t, 0.03, 0.55, 0.001); v.osc('sine', 1400, 1100, t, 0.22, 0.25, 0.002); v.noise('bandpass', 3000, 2400, 4, t, 0.25, 0.14, 0.001); v.osc('sine', 260, 180, t, 0.1, 0.25, 0.002); } },
  saw: { f: v => { const t = v.t; v.noise('bandpass', 1300, 1300, 2.2, t, 0.5, 0.36, 0.05, { am: [38, 0.2] }); v.noise('highpass', 3000, 3000, 0.7, t, 0.5, 0.1, 0.05, { am: [38, 0.05] }); } },
  crack_ice: { rev: 0.4, f: v => { const t = v.t; v.noise('highpass', 1800, 1800, 0.7, t, 0.05, 0.7, 0.001); v.osc('sine', 2600, 2400, t, 0.35, 0.12, 0.001); v.osc('sine', 3900, 3600, t + 0.005, 0.25, 0.06, 0.001); v.noise('lowpass', 300, 200, 0.7, t + 0.03, 0.5, 0.2, 0.01); } },
  ice_break: { pri: 1, f: v => {
    const t = v.t;
    v.noise('highpass', 1800, 1800, 0.7, t, 0.06, 0.7, 0.001);
    for (let i = 0; i < 6; i++) { const f = rnd(1800, 4200), tt = t + 0.05 + i * rnd(0.025, 0.05); v.osc('sine', f, f * 0.85, tt, rnd(0.08, 0.2), rnd(0.05, 0.1), 0.001); }
    v.osc('sine', 80, 40, t, 0.4, 0.4);
  } },
  splash: { f: v => {
    const t = v.t;
    v.noise('bandpass', 3000, 800, 0.7, t, 0.5, 0.45, 0.01);
    for (let i = 0; i < 7; i++) { const f = rnd(900, 2200), tt = t + 0.08 + rnd(0, 0.4); v.osc('sine', f, f * 0.6, tt, rnd(0.04, 0.09), rnd(0.05, 0.12), 0.002); }
  } },
  fire_ignite: { f: v => {
    const t = v.t;
    v.noise('bandpass', 800, 2500, 0.7, t, 0.45, 0.22, 0.12);
    for (let i = 0; i < 8; i++) v.noise('highpass', 3000, 3000, 0.7, t + rnd(0, 0.4), 0.01, rnd(0.1, 0.3), 0.001);
  } },
  fire_out: { f: v => { const t = v.t; v.noise('highpass', 2500, 2500, 0.7, t, 0.9, 0.35, 0.02); v.noise('lowpass', 4000, 1500, 0.7, t, 0.7, 0.3, 0.02); v.osc('sine', 180, 60, t, 0.1, 0.3); } },
  lamp_light: { f: v => {
    const t = v.t;
    v.noise('lowpass', 300, 900, 0.8, t, 0.3, 0.25, 0.05);
    v.osc('sine', 660, 990, t + 0.04, 0.2, 0.12, 0.01);
    for (let i = 0; i < 4; i++) v.noise('highpass', 2500, 2500, 0.7, t + rnd(0.05, 0.3), 0.008, rnd(0.1, 0.2), 0.001);
  } },
  match_strike: { f: v => {
    const t = v.t;
    for (let i = 0; i < 6; i++) v.noise('bandpass', 3500, 3500, 1.5, t + i * 0.035, 0.02, 0.3, 0.001);
    v.noise('bandpass', 1200, 2200, 0.8, t + 0.22, 0.4, 0.14, 0.05);
  } },
  pot_boil: { f: v => {
    const t = v.t;
    v.noise('lowpass', 400, 400, 0.7, t, 1.4, 0.05, 0.1);
    let tt = t;
    for (let i = 0; i < 12; i++) { const f = rnd(280, 650); v.osc('sine', f, f * 1.5, tt, 0.04, rnd(0.08, 0.2), 0.002); tt += rnd(0.07, 0.12); }
  } },
  craft: { f: v => { const t = v.t; v.osc('triangle', 1400, 1370, t, 0.18, 0.2, 0.002); v.noise('highpass', 3000, 3000, 0.7, t, 0.02, 0.3); v.osc('sine', 1900, 1850, t + 0.11, 0.2, 0.18, 0.002); v.osc('sine', 150, 90, t + 0.11, 0.1, 0.25); } },
  pickup: { f: v => { const t = v.t; v.noise('bandpass', 1400, 2400, 1.0, t, 0.14, 0.2, 0.02); v.osc('sine', 880, 1320, t + 0.06, 0.1, 0.14, 0.005); } },
  drop: { f: v => { const t = v.t; v.osc('sine', 170, 85, t, 0.12, 0.35); v.noise('lowpass', 800, 400, 0.7, t, 0.09, 0.22, 0.003); } },
  eat: { f: v => {
    const t = v.t;
    for (let i = 0; i < 3; i++) { const tt = t + i * 0.25; v.noise('bandpass', 1400, 1100, 3, tt, 0.05, 0.4, 0.002); v.osc('sine', 220, 150, tt, 0.05, 0.2, 0.002); }
    v.noise('lowpass', 500, 300, 0.7, t + 0.8, 0.2, 0.15, 0.05);
  } },
  drink: { f: v => { const t = v.t; v.noise('bandpass', 500, 1500, 1.2, t, 0.4, 0.22, 0.06); v.osc('sine', 220, 130, t + 0.1, 0.1, 0.2); v.osc('sine', 260, 150, t + 0.3, 0.1, 0.2); } },
  ui_click: { pri: 1, gap: 0.03, f: v => { const t = v.t; v.osc('sine', 2200, 1800, t, 0.025, 0.2, 0.001); v.noise('highpass', 4000, 4000, 0.7, t, 0.01, 0.1, 0.001); } },
  ui_open: { f: v => { const t = v.t; v.osc('sine', 520, 1040, t, 0.12, 0.12, 0.01); v.noise('bandpass', 2600, 3400, 1.2, t, 0.1, 0.06, 0.02); } },
  ui_close: { f: v => { const t = v.t; v.osc('sine', 1040, 520, t, 0.11, 0.12, 0.005); } },
  ui_deny: { f: v => { const t = v.t; v.osc('square', 140, 120, t, 0.16, 0.08, 0.005, { filt: ['lowpass', 700, 1] }); v.osc('square', 140, 120, t + 0.2, 0.16, 0.08, 0.005, { filt: ['lowpass', 700, 1] }); } },
  objective: { pri: 2, rev: 0.5, f: v => { const t = v.t; bell(v, 659.25, t, 0.2, 1.6); bell(v, 987.77, t + 0.12, 0.18, 1.8); } },
  hurt: { pri: 2, gap: 0.15, f: v => { const t = v.t; v.osc('sine', 160, 70, t, 0.25, 0.55); v.noise('bandpass', 550, 350, 1.1, t, 0.16, 0.35, 0.005); v.noise('bandpass', 1300, 900, 2, t + 0.03, 0.18, 0.12, 0.03); } },
  death: { pri: 2, rev: 0.6, f: v => { const t = v.t; v.osc('sine', 110, 40, t, 3.0, 0.4, 0.05, { vib: [2, 8] }); v.osc('sine', 55, 30, t, 3.2, 0.3, 0.05); v.noise('lowpass', 900, 200, 0.7, t, 3.2, 0.2, 0.2); } },
  heartbeat: { pri: 0, f: v => { const t = v.t; thump(v, t, 0.6); thump(v, t + 0.22, 0.42); } },
  shiver: { pri: 0, f: v => { const t = v.t; v.noise('bandpass', 3200, 3000, 6, t, 0.9, 0.2, 0.05, { am: [14, 0.14] }); v.osc('sine', 180, 160, t, 0.9, 0.05); } },
  breath_cold: { f: v => { const t = v.t; v.noise('bandpass', 1200, 500, 1.1, t, 1.0, 0.36, 0.35); v.noise('highpass', 3000, 2000, 0.7, t, 0.6, 0.02, 0.4); } },
  door_open: { f: v => {
    const t = v.t;
    v.osc('sawtooth', 200, 320, t, 0.5, 0.3, 0.05, { vib: [6, 15], filt: ['bandpass', 500, 4] });
    v.noise('lowpass', 1500, 1500, 0.7, t + 0.1, 0.25, 0.2, 0.04);
    v.noise('lowpass', 300, 200, 0.7, t + 0.45, 0.2, 0.25, 0.005);
  } },
  door_close: { f: v => { const t = v.t; v.osc('sine', 110, 60, t, 0.18, 0.45); v.noise('bandpass', 700, 450, 1.0, t, 0.16, 0.3, 0.004); v.osc('sawtooth', 300, 220, t + 0.05, 0.25, 0.05, 0.02, { vib: [7, 20], filt: ['bandpass', 600, 3] }); } },
  chest_open: { f: v => { const t = v.t; v.osc('sawtooth', 180, 250, t, 0.3, 0.07, 0.06, { filt: ['bandpass', 700, 3] }); v.noise('highpass', 2500, 2500, 0.7, t + 0.3, 0.03, 0.25, 0.001); bell(v, 2400, t + 0.36, 0.08, 0.2); } },
  sleep: { f: v => { const t = v.t; v.osc('sine', 300, 140, t, 1.0, 0.1, 0.2); v.noise('lowpass', 700, 300, 0.7, t, 1.2, 0.12, 0.3); } },
  wake: { f: v => { const t = v.t; v.osc('sine', 220, 440, t, 0.6, 0.08, 0.1); v.noise('bandpass', 900, 1600, 1.2, t, 0.45, 0.16, 0.12); } },
  bark: { f: v => {
    const t = v.t;
    for (const tt of [t, t + 0.26]) {
      v.osc('sawtooth', 420, 250, tt, 0.13, 0.5, 0.004, { filt: ['bandpass', 750, 2.5] });
      v.noise('bandpass', 1200, 1200, 1.0, tt, 0.05, 0.16, 0.002);
    }
  } },
  dog_whine: { f: v => { const t = v.t; v.osc('sine', 620, 900, t, 0.85, 0.12, 0.2, { vib: [7, 40] }); v.osc('sine', 1240, 1800, t, 0.85, 0.02, 0.2); } },
  growl_bear: { pri: 2, f: v => { const t = v.t; v.osc('sawtooth', 62, 58, t, 2.0, 0.35, 0.2, { vib: [6, 40], filt: ['lowpass', 320, 2] }); v.noise('lowpass', 220, 150, 1.0, t, 2.0, 0.3, 0.3, { am: [5, 0.12] }); } },
  roar_bear: { pri: 2, rev: 0.5, f: v => {
    const t = v.t;
    v.osc('sawtooth', 90, 58, t, 2.6, 0.45, 0.2, { vib: [5, 60], filt: ['bandpass', 520, 3] });
    v.osc('sawtooth', 90, 58, t, 2.6, 0.3, 0.2, { vib: [5, 60], filt: ['bandpass', 1050, 4] });
    v.noise('lowpass', 1200, 300, 0.7, t, 2.6, 0.35, 0.25);
  } },
  seal_breath: { pri: 0, f: v => { const t = v.t; v.noise('bandpass', 380, 260, 2.0, t, 0.7, 0.2, 0.2); v.osc('sine', 150, 90, t, 0.5, 0.08, 0.15); for (let i = 0; i < 4; i++) { const f = rnd(300, 500); v.osc('sine', f, f * 1.3, t + rnd(0.1, 0.5), 0.03, 0.04, 0.002); } } },
  seal_splash: { pri: 0, f: v => { const t = v.t; v.osc('sine', 300, 120, t, 0.15, 0.2); v.noise('bandpass', 2000, 800, 0.8, t, 0.35, 0.22, 0.01); } },
  fox_yip: { pri: 0, f: v => { const t = v.t; for (let i = 0; i < 3; i++) v.osc('sine', 1150, 1950, t + i * 0.32, 0.22, 0.14, 0.01, { vib: [13, 90] }); } },
  ptarmigan: { pri: 0, f: v => { const t = v.t; for (let i = 0; i < 4; i++) v.osc('triangle', 980, 720, t + i * 0.09, 0.06, 0.2, 0.004, { filt: ['bandpass', 1100, 3] }); } },
  bird_flap: { pri: 0, f: v => { const t = v.t; v.noise('bandpass', 1500, 1700, 1.4, t, 0.7, 0.15, 0.15, { am: [9, 0.12] }); } },
  explosion: { pri: 2, rev: 0.6, f: v => {
    const t = v.t;
    v.noise('lowpass', 900, 120, 0.7, t, 1.4, 0.7, 0.004);
    v.osc('sine', 58, 26, t, 1.6, 0.7, 0.004);
    v.noise('highpass', 2000, 1200, 0.7, t, 0.12, 0.6, 0.001);
    v.noise('lowpass', 500, 180, 0.7, t + 0.45, 1.2, 0.35, 0.1);
  } },
  collapse: { pri: 2, f: v => {
    const t = v.t;
    v.noise('lowpass', 500, 260, 0.8, t, 1.8, 0.7, 0.05, { am: [3, 0.3] });
    for (let i = 0; i < 4; i++) v.noise('bandpass', 1800, 900, 1.5, t + rnd(0, 1.2), 0.2, 0.25, 0.003);
    v.noise('highpass', 1500, 1500, 0.7, t + 0.2, 1.6, 0.14, 0.4);
  } },
  rumble: { pri: 1, f: v => { const t = v.t; v.noise('lowpass', 180, 120, 0.8, t, 3.0, 0.42, 0.6, { am: [1.3, 0.2] }); v.osc('sine', 48, 40, t, 3.0, 0.2, 0.6); } },
  avalanche: { pri: 2, rev: 0.2, f: v => { const t = v.t; v.noise('lowpass', 1200, 300, 0.8, t, 3.6, 0.55, 1.2, { am: [0.7, 0.25] }); v.noise('bandpass', 2600, 1200, 0.9, t, 3.6, 0.18, 0.5); v.noise('highpass', 2500, 2500, 0.7, t, 3.6, 0.08, 1.0); } },
  wind_gust: { pri: 0, f: v => { const t = v.t; v.noise('bandpass', 350, 900, 0.8, t, 2.6, 0.38, 1.0); v.noise('lowpass', 900, 500, 0.7, t, 2.6, 0.22, 1.0); } },
  storm_front: { pri: 2, f: v => {
    const t = v.t;
    v.noise('lowpass', 700, 300, 0.7, t, 6, 0.5, 2.5, { am: [0.25, 0.25] });
    v.osc('sine', 55, 45, t, 6, 0.12, 2.0);
    v.noise('bandpass', 900, 900, 1.4, t + 1, 4, 0.2, 2);
  } },
  radio_static: { f: v => { const t = v.t; v.noise('bandpass', 2000, 2400, 0.8, t, 1.4, 0.12, 0.01); v.noise('highpass', 3000, 3000, 0.7, t, 1.4, 0.2, 0.01, { buf: 'crackle' }); } },
  radio_voice: { pri: 2, f: v => {
    const t = v.t;
    v.noise('lowpass', 1500, 1500, 0.7, t, 1.6, 0.03, 0.05);
    for (let i = 0; i < 5; i++) {
      const tt = t + i * 0.3 + rnd(0, 0.05), f = rnd(110, 150);
      v.osc('sawtooth', f, f * rnd(0.85, 0.95), tt, 0.22, 0.22, 0.03, { filt: ['bandpass', 1100, 2.5] });
      v.osc('sawtooth', f, f, tt, 0.22, 0.12, 0.03, { filt: ['bandpass', 2600, 3] });
    }
  } },
  icebreaker_horn: { pri: 2, rev: 0.4, f: v => {
    const t = v.t;
    v.osc('sawtooth', 110, 110, t, 3.2, 0.12, 0.35, { vib: [4, 12], filt: ['lowpass', 900, 1] });
    v.osc('sine', 165, 165, t, 3.2, 0.18, 0.3, { vib: [4, 12] });
    v.osc('sine', 220.5, 220.5, t, 3.2, 0.08, 0.3);
  } },
  flare_shot: { pri: 2, f: v => { const t = v.t; v.noise('highpass', 1000, 1000, 0.7, t, 0.05, 0.6, 0.001); v.osc('sine', 220, 60, t, 0.14, 0.45, 0.001); v.noise('bandpass', 1500, 400, 0.9, t + 0.05, 1.2, 0.22, 0.2); } },
  flare_burn: { f: v => { const t = v.t; v.noise('bandpass', 1400, 1400, 1.0, t, 3.0, 0.14, 0.3); v.noise('highpass', 2500, 2500, 0.6, t, 3.0, 0.16, 0.2, { buf: 'crackle' }); v.noise('lowpass', 600, 600, 0.7, t, 3.0, 0.12, 0.3); } },
  dawn: { pri: 2, rev: 0.6, f: v => {
    const t = v.t;
    for (const f of [146.83, 220.0, 293.66, 369.99]) v.osc('triangle', f, f * 1.002, t, 6.5, 0.07, 2.5, { filt: ['lowpass', 1300, 0.5] });
    v.noise('lowpass', 500, 500, 0.7, t, 6.0, 0.05, 3.0);
  } },
  win: { pri: 2, rev: 0.5, f: v => { const t = v.t; [[0, 587.33], [0.18, 740], [0.36, 880], [0.6, 1174.66], [0.85, 1480]].forEach(([o, f]) => bell(v, f, t + o, 0.18, 2.0)); } },
  harpoon_throw: { f: v => { const t = v.t; v.noise('bandpass', 800, 3000, 1.2, t, 0.32, 0.3, 0.02); v.osc('sine', 300, 120, t + 0.3, 0.08, 0.25); } },
  harpoon_hit: { pri: 2, f: v => { const t = v.t; v.noise('lowpass', 1200, 500, 0.8, t, 0.15, 0.6, 0.002); v.osc('sine', 120, 60, t, 0.2, 0.5); v.noise('bandpass', 2000, 900, 0.8, t + 0.02, 0.3, 0.2, 0.01); } },
  fish_bite: { f: v => { const t = v.t; v.osc('sine', 180, 140, t, 0.08, 0.2, 0.002); v.noise('highpass', 1500, 1500, 0.7, t, 0.03, 0.1, 0.001); } },
  reel: { f: v => { const t = v.t; for (let i = 0; i < 10; i++) v.noise('highpass', 2500, 2500, 0.7, t + i * 0.07, 0.01, 0.18, 0.001); v.noise('bandpass', 900, 700, 3, t, 0.7, 0.1, 0.05); } },
  frostbite: { f: v => { const t = v.t; v.noise('highpass', 5000, 3000, 0.7, t, 0.25, 0.1, 0.01); v.osc('sine', 2100, 1500, t, 0.2, 0.06, 0.005); } },
  // short generic gestures, used by the game through sfxhooks
  jump: { pri: 0, f: v => { const t = v.t; v.noise('bandpass', 700, 900, 1.0, t, 0.12, 0.3, 0.02); } },
  land: { pri: 1, f: v => { const t = v.t; v.osc('sine', 110, 60, t, 0.14, 0.45); v.noise('lowpass', 500, 260, 0.7, t, 0.12, 0.3, 0.003); } },
  // ---- DESIGN §15 interactive objects ----
  rec_1: { rev: 0.25, f: v => playRecord(v, REC1_MEL, REC1_BASS, 0.6) },
  rec_2: { rev: 0.35, f: v => playRecord(v, REC2_MEL, REC2_BASS, 1.0) },
  rec_3: { rev: 0.2, f: v => playRecord(v, REC3_MEL, REC3_BASS, 0.4545) },
  rec_scratch: { f: v => { const t = v.t; v.noise('highpass', 2500, 1200, 0.7, t, 0.5, 0.25, 0.01, { buf: 'crackle' }); v.osc('sawtooth', 220, 80, t, 0.5, 0.07, 0.01, { filt: ['lowpass', 700, 1] }); } },
  gen_pull: { f: v => { const t = v.t; v.noise('bandpass', 1400, 600, 1.2, t, 0.3, 0.3, 0.02); for (let i = 0; i < 6; i++) v.noise('highpass', 2800, 2800, 0.7, t + i * 0.045, 0.012, 0.18, 0.001); v.osc('sine', 120, 90, t + 0.28, 0.08, 0.2); } },
  gen_cough: { pri: 1, f: v => { const t = v.t; for (let i = 0; i < 3; i++) { v.osc('sawtooth', 58 - i * 6, 40, t + i * 0.2, 0.18, 0.42, 0.004, { filt: ['lowpass', 260, 1] }); v.noise('lowpass', 500, 200, 0.8, t + i * 0.2, 0.15, 0.3, 0.003); } v.noise('bandpass', 900, 300, 1, t + 0.7, 0.35, 0.12, 0.05); } },
  gen_start: { pri: 2, f: v => { const t = v.t; for (let i = 0; i < 5; i++) { v.osc('sawtooth', 50 + i * 6, 44 + i * 6, t + i * 0.16, 0.14, 0.4, 0.004, { filt: ['lowpass', 300, 1] }); v.noise('lowpass', 600, 250, 0.8, t + i * 0.16, 0.1, 0.3, 0.002); } v.osc('sawtooth', 70, 78, t + 0.8, 1.6, 0.35, 0.1, { am: [19, 0.4], filt: ['lowpass', 320, 1] }); v.noise('lowpass', 700, 400, 0.7, t + 0.8, 1.6, 0.18, 0.15, { am: [19, 0.3] }); } },
  gen_run: { pri: 1, f: v => { const t = v.t; v.osc('sawtooth', 76, 76, t, 2.6, 0.3, 0.2, { am: [20, 0.45], filt: ['lowpass', 330, 1.2] }); v.osc('sine', 38, 38, t, 2.6, 0.25, 0.2, { am: [10, 0.4] }); v.noise('lowpass', 800, 500, 0.7, t, 2.6, 0.12, 0.3, { am: [20, 0.3] }); v.noise('bandpass', 2200, 2200, 1.2, t, 2.6, 0.04, 0.3, { am: [20, 0.5] }); } },
  gen_stop: { f: v => { const t = v.t; v.osc('sawtooth', 76, 24, t, 1.1, 0.3, 0.01, { filt: ['lowpass', 300, 1] }); v.noise('lowpass', 500, 120, 0.7, t, 0.9, 0.15, 0.02); v.osc('sine', 40, 20, t + 0.9, 0.2, 0.25); } },
  gen_stall: { pri: 2, f: v => { const t = v.t; for (let i = 0; i < 4; i++) v.osc('sawtooth', 70 - i * 9, 40 - i * 4, t + i * 0.22, 0.2, 0.4, 0.004, { filt: ['lowpass', 280, 1] }); v.noise('bandpass', 700, 200, 1, t, 0.9, 0.2, 0.05); v.osc('sine', 38, 18, t + 0.9, 0.5, 0.3); } },
  radio_click: { f: v => { const t = v.t; v.osc('square', 900, 600, t, 0.03, 0.15, 0.001, { filt: ['lowpass', 2500, 1] }); v.noise('bandpass', 2000, 2000, 1, t + 0.04, 0.5, 0.06, 0.02); v.osc('sine', 120, 120, t, 0.4, 0.04, 0.05); } },
  radio_tune: { pri: 0, f: v => { const t = v.t, f = rnd(700, 1900); v.osc('sine', f, f * rnd(0.6, 1.5), t, 0.18, 0.06, 0.01); v.noise('bandpass', 1800, 2600, 1.5, t, 0.15, 0.06, 0.01); } },
  bell_ring: { pri: 2, rev: 0.7, f: v => { const t = v.t; for (const [r, pk] of [[1, 0.34], [2.01, 0.2], [2.76, 0.16], [4.07, 0.08], [5.4, 0.05]] as [number, number][]) v.osc('sine', 392 * r, 392 * r * 0.998, t, 5.2 / (1 + r * 0.25), pk, 0.002); v.noise('highpass', 3000, 3000, 0.7, t, 0.03, 0.4, 0.001); } },
  shutter: { f: v => { const t = v.t; v.noise('bandpass', 700, 500, 1.4, t, 0.1, 0.3, 0.003); v.osc('sine', 180, 110, t, 0.1, 0.35, 0.002); v.osc('sine', 150, 90, t + 0.12, 0.08, 0.25, 0.002); } },
  ladder: { f: v => { const t = v.t; for (let i = 0; i < 4; i++) { v.osc('sine', 260 + i * 8, 200, t + i * 0.09, 0.07, 0.2, 0.002); v.noise('bandpass', 1100, 800, 2, t + i * 0.09, 0.05, 0.15, 0.002); } } },
  damper: { f: v => { const t = v.t; v.osc('square', 340, 260, t, 0.04, 0.12, 0.001, { filt: ['bandpass', 800, 3] }); v.noise('bandpass', 1500, 900, 2, t, 0.06, 0.15, 0.002); v.osc('sine', 700, 600, t + 0.07, 0.08, 0.08, 0.002); } },
  medkit: { f: v => { const t = v.t; v.noise('bandpass', 2500, 4000, 1, t, 0.25, 0.15, 0.03); v.osc('sine', 1800, 1800, t + 0.22, 0.05, 0.08, 0.002); v.noise('highpass', 3500, 3500, 0.7, t + 0.3, 0.1, 0.08, 0.01); } },
  kettle_whistle: { pri: 1, f: v => { const t = v.t; v.osc('sine', 1900, 2300, t, 1.0, 0.12, 0.15, { vib: [6, 25] }); v.noise('bandpass', 2200, 2400, 6, t, 1.0, 0.05, 0.15); } },
  pour: { f: v => { const t = v.t; v.noise('bandpass', 700, 1700, 1.1, t, 0.6, 0.2, 0.06); v.osc('sine', 300, 600, t, 0.55, 0.05, 0.06); } },
  sonde_release: { pri: 1, f: v => { const t = v.t; v.noise('bandpass', 400, 2400, 0.9, t, 1.2, 0.3, 0.1); v.osc('sine', 330, 880, t, 1.0, 0.1, 0.1); v.noise('highpass', 3000, 3000, 0.7, t + 0.05, 0.04, 0.3, 0.001); } },
  cart_roll: { pri: 0, gap: 0.2, f: v => { const t = v.t; v.noise('lowpass', 500, 380, 1.2, t, 0.5, 0.2, 0.05, { am: [16, 0.5] }); v.osc('sine', 62, 58, t, 0.5, 0.12, 0.05); v.noise('highpass', 3000, 3000, 0.7, t, 0.5, 0.05, 0.05, { buf: 'crackle' }); } },
  cart_bump: { f: v => { const t = v.t; v.osc('sine', 150, 90, t, 0.2, 0.4); v.noise('bandpass', 1800, 900, 1.5, t, 0.1, 0.3, 0.002); bell(v, 1500, t, 0.08, 0.4); } },
  cart_crash: { pri: 2, rev: 0.5, f: v => { const t = v.t; v.noise('lowpass', 900, 200, 0.8, t, 1.6, 0.55, 0.004); v.osc('sine', 80, 36, t, 0.7, 0.5, 0.004); for (let i = 0; i < 7; i++) { v.noise('bandpass', 2200, 800, 1.5, t + 0.05 + i * rnd(0.08, 0.2), 0.12, 0.25, 0.002); bell(v, rnd(700, 2200), t + 0.1 + i * 0.1, 0.05, 0.3); } } },
  roof_creak: { pri: 1, rev: 0.4, f: v => { const t = v.t; v.noise('bandpass', 520, 220, 12, t, 1.6, 0.1, 0.4); v.osc('sine', 120, 90, t, 1.4, 0.12, 0.4, { vib: [3, 20] }); v.noise('lowpass', 200, 120, 0.8, t + 0.8, 0.6, 0.15, 0.1); } },
  // internal footstep / drip / creak voices (not public names)
  _step_snow: { pri: 0, gap: 0.09, f: (v, c) => {
    const t = v.t, r = rnd(0.92, 1.08);
    v.noise('bandpass', 2300 * r, 1300, 1.1, t, 0.12, 0.26, 0.006);
    v.noise('highpass', 4200, 4200, 0.7, t, 0.03, 0.05, 0.002);
    if (c.cold > 0.02) { const fc = 1 + 0.7 * c.cold; v.osc('triangle', 1500 * fc, 2100 * fc, t + 0.01, 0.09, 0.09 * c.cold, 0.012, { vib: [45, 70] }); }
  } },
  _step_ice: { pri: 0, gap: 0.1, f: v => { const t = v.t; v.osc('sine', 3300, 2600, t, 0.07, 0.07, 0.002); v.noise('highpass', 4500, 4500, 0.7, t, 0.04, 0.05, 0.002); } },
  _step_stone: { pri: 0, gap: 0.1, f: v => { const t = v.t; v.noise('bandpass', 2400, 2400, 2, t, 0.05, 0.25, 0.002); v.osc('sine', 800, 600, t, 0.04, 0.06, 0.002); } },
  _step_wood: { pri: 0, gap: 0.1, f: v => { const t = v.t; v.osc('sine', 260, 200, t, 0.07, 0.22, 0.002); v.noise('bandpass', 900, 900, 3, t, 0.05, 0.12, 0.002); } },
  _step_dirt: { pri: 0, gap: 0.1, f: v => { const t = v.t; v.noise('lowpass', 520, 300, 0.7, t, 0.1, 0.25, 0.005); v.osc('sine', 110, 80, t, 0.08, 0.12, 0.003); } },
  _step_metal: { pri: 0, gap: 0.1, f: v => { const t = v.t; v.osc('sine', 1180, 1170, t, 0.2, 0.05, 0.002); v.osc('sine', 1990, 1970, t, 0.12, 0.02, 0.002); v.noise('highpass', 3000, 3000, 0.7, t, 0.02, 0.08, 0.001); } },
  _step_water: { pri: 0, gap: 0.12, f: v => { const t = v.t; v.noise('bandpass', 1500, 900, 0.7, t, 0.2, 0.14, 0.02); } },
  _step_soft: { pri: 0, gap: 0.1, f: v => { const t = v.t; v.noise('bandpass', 1000, 1000, 1.5, t, 0.1, 0.1, 0.01); } },
  _drip: { pri: 0, rev: 0.6, f: v => { const t = v.t; v.osc('sine', 2300, 1150, t, 0.13, 0.22, 0.002); v.osc('sine', 4600, 2300, t, 0.05, 0.05, 0.002); v.osc('sine', 2300, 1150, t + 0.24, 0.13, 0.07, 0.002); } },
  _creak: { pri: 0, far: true, rev: 0.4, f: v => { const t = v.t; v.noise('bandpass', 620, 260, 14, t, 1.1, 0.05, 0.3); v.osc('sine', 280, 430, t, 1.0, 0.025, 0.3, { vib: [4, 25] }); } },
};

/** Alternative names used by the game event hooks (game/sfxhooks.ts) mapped onto the sounds above. */
const ALIAS: Record<string, string> = { place: 'place_block', throw: 'harpoon_throw', gust: 'wind_gust', fire_lit: 'fire_ignite', door: 'door_open', flare: 'flare_shot' };

const DIG_SND: Record<string, [string, number, number] | null> = {
  snow: ['shovel_scoop', 1, 0.7], ice: ['chisel', 1.5, 0.5], stone: ['pick', 1, 0.8], wood: ['chop', 1, 0.7], dirt: ['shovel_scoop', 0.75, 0.8],
  metal: ['chisel', 0.9, 0.6], water: ['splash', 1.6, 0.25], soft: ['shovel_scoop', 1.4, 0.35], none: null,
};
const PLACE_SND: Record<string, [string, number, number] | null> = {
  snow: ['place_block', 1, 0.8], ice: ['place_block', 1.9, 0.55], stone: ['place_block', 0.7, 1], wood: ['place_block', 1.25, 0.9], dirt: ['place_block', 0.6, 0.9],
  metal: ['chisel', 0.8, 0.45], water: ['splash', 1.2, 0.3], soft: ['place_block', 1.4, 0.45], none: null,
};

// Music bed: slow minor-leaning chords, all in the cold register.
const CHORDS = [
  [146.83, 220.0, 261.63, 349.23],  // Dm
  [116.54, 174.61, 220.0, 293.66],  // Bb
  [87.31, 130.81, 174.61, 220.0],   // F
  [98.0, 146.83, 196.0, 233.08],    // Gm
  [110.0, 164.81, 220.0, 329.63],   // A (sus, leads back to Dm)
];

// ------------------------------------------------------------------ live engine state
interface Nodes {
  master: GainNode; sfx: GainNode; music: GainNode; amb: GainNode; ambLP: BiquadFilterNode; verb: GainNode;
  wind: GainNode; windLP: BiquadFilterNode; gustA: GainNode; gustB: GainNode; whistle: GainNode; whistleBP: BiquadFilterNode;
  crackle: GainNode;
}
let ac: AudioContext | null = null;
let N: Nodes | null = null;
let muted = false;
let vMaster = 0.8, vMusic = 0.45;
const live: Voice[] = [];
const lastAt: Record<string, number> = {};
const A = { wind: 2, storm: 0, fire: 0, underground: 0, night: 0, core: 36.5, indoor: 0 };
const NX = { creak: 0, crack: 0, drip: 0, shiver: 0, heart: 0, gust: 0, chord: 0, bell: 0 };
const M = { on: false, chord: 0, boost: -1, level: 0 };
let prevNight = NaN;
let chordIdx = 0;

/** Admission: room, reject (low priority while full), or the index of a voice to steal. */
function reap(now: number) { for (let i = live.length - 1; i >= 0; i--) if (live[i].end < now) live.splice(i, 1); }

function admit(now: number, pri: number): number {
  reap(now);
  if (live.length < MAX_VOICES) return ROOM;
  if (pri <= 0) return REJECT;
  let best = -1;
  for (let i = 0; i < live.length; i++) {
    const c = live[i];
    if (c.pri > pri) continue;
    if (best < 0 || c.pri < live[best].pri || (c.pri === live[best].pri && c.t < live[best].t)) best = i;
  }
  return best < 0 ? REJECT : best;
}

interface EmitOpts { x?: number; pan?: number; cold?: number; far?: boolean; rev?: number }
/** Build and start a one-shot voice on the live graph. */
function emit(name: string, vol: number, pitch: number, o: EmitOpts = {}) {
  if (!ac || !N || muted) return;
  const def = DEFS[name];
  if (!def) return;
  const now = ac.currentTime;
  if (def.gap) {
    if (now - (lastAt[name] ?? -9) < def.gap) return;
    lastAt[name] = now;
  }
  let pan = o.pan, dist = 1;
  if (o.x !== undefined) {
    const W = G.cam.viewW || 400, dx = o.x - G.cam.x;
    pan = clamp(dx / (W * 0.5), -1, 1);
    dist = 1 / (1 + Math.max(0, Math.abs(dx) - W * 0.4) / (W * 0.25));
  }
  const pri = def.pri ?? 1;
  const slot = admit(now, pri);
  if (slot === REJECT) return;
  const v = new Voice(ac, now + 0.005, pitch, { dest: N.sfx, rev: N.verb }, {
    vol: clamp(vol, 0, 2) * dist, pan, far: o.far ?? def.far, rev: o.rev ?? def.rev ?? 0,
  });
  v.pri = pri;
  def.f(v, { cold: o.cold ?? 0 });
  if (slot >= 0) { live[slot].stop(); live.splice(slot, 1); }
  live.push(v);
}

/** Music voice: outside the one-shot budget, long-lived, sent to the music bus. */
function musicVoice(pan?: number): Voice | null {
  if (!ac || !N) return null;
  return new Voice(ac, ac.currentTime + 0.05, 1, { dest: N.music, rev: N.verb }, { vol: 1, pan, rev: 0.7 });
}

function playChord(i: number) {
  const v = musicVoice(); if (!v) return;
  const t = v.t;
  for (const f of CHORDS[i]) {
    v.osc('triangle', f, f * 1.003, t, 14, 0.035, 3.5, { filt: ['lowpass', 1100, 0.5] });
    v.osc('triangle', f * 0.997, f * 0.997, t, 14, 0.02, 4.0, { filt: ['lowpass', 1100, 0.5] });
  }
}
function playBell() {
  const c = CHORDS[chordIdx % CHORDS.length];
  const f = c[Math.floor(Math.random() * c.length)] * (Math.random() < 0.5 ? 2 : 1);
  const v = musicVoice(rnd(-0.6, 0.6)); if (!v) return;
  bell(v, f, v.t, 0.045, 4.0);
}

function applyMaster(now: number, tc: number) { if (N) setP(N.master.gain, muted ? 0 : vMaster * 0.9, tc, now); }

function setP(p: AudioParam, value: number, tc: number, now: number) {
  p.cancelScheduledValues(now);
  p.setTargetAtTime(value, now, Math.max(0.01, tc));
}

/** Smooth continuous parameters and run the event scheduler. Called every 120 ms from a timer. */
function tick() {
  if (!ac || !N) return;
  const now = ac.currentTime;
  reap(now);
  const w = clamp(A.wind / 22, 0, 1.4), st = A.storm, u = A.underground, ind = A.indoor;
  const base = 0.6 * (0.02 + 0.2 * Math.pow(w, 1.2) + 0.2 * st) * (1 - 0.8 * u) * (1 - 0.55 * ind);
  setP(N.wind.gain, base, 0.6, now);
  setP(N.gustA.gain, base * 0.42 * (0.5 + st), 1, now);
  setP(N.gustB.gain, base * 0.22 * (0.5 + st), 1, now);
  setP(N.windLP.frequency, 180 + 800 * w + 700 * st, 0.6, now);
  setP(N.whistle.gain, (Math.max(0, w - 0.45) * 0.06 + st * 0.04) * (1 - ind * 0.8) * (1 - u), 0.8, now);
  setP(N.whistleBP.frequency, 520 + 380 * w, 0.8, now);
  setP(N.crackle.gain, A.fire * 0.22 * (1 - ind * 0.3), 0.25, now);
  setP(N.ambLP.frequency, 16000 * Math.pow(700 / 16000, ind), 0.4, now);
  applyMaster(now, 0.05);

  if (!isNaN(prevNight) && prevNight > 0.6 && A.night < 0.35) M.boost = now + 25; // dawn swell
  prevNight = A.night;
  M.level = M.on ? (1 - 0.6 * st) * (now < M.boost ? 1.5 : 1) * 0.9 : 0;
  setP(N.music.gain, M.level * vMusic, 1.2, now);

  if (ac.state !== 'running') return; // no scheduling while suspended (currentTime is frozen)

  if (M.on) {
    if (now >= NX.chord) { playChord(chordIdx); chordIdx = (chordIdx + 1) % CHORDS.length; NX.chord = now + 9 + Math.random() * 3; }
    if (now >= NX.bell) { NX.bell = now + 2.4 + Math.random() * 3.2; if (Math.random() < 0.8) playBell(); }
  }
  if (A.night > 0.3 && !A.indoor && now >= NX.creak) {
    NX.creak = now + rnd(5, 13);
    emit('_creak', 0.5 * A.night, 1, { pan: rnd(-0.7, 0.7), far: true });
  }
  if (A.night > 0.35 && !A.indoor && now >= NX.crack) {
    NX.crack = now + rnd(8, 22);
    emit('crack_ice', 0.35 * A.night, rnd(0.9, 1.1), { pan: rnd(-0.8, 0.8), far: true });
  }
  if (A.underground > 0.05 && now >= NX.drip) {
    NX.drip = now + rnd(1.2, 4.5) / (0.3 + A.underground);
    emit('_drip', 0.5 * A.underground, rnd(0.9, 1.15), { pan: rnd(-0.6, 0.6) });
  }
  if (A.storm > 0.5 && now >= NX.gust) {
    NX.gust = now + rnd(5, 11);
    emit('wind_gust', 0.25 + 0.3 * A.storm, 1, { pan: rnd(-0.5, 0.5) });
  }
  if (A.core < 35.5 && now >= NX.shiver) {
    NX.shiver = now + rnd(4, 7);
    emit('shiver', clamp((35.5 - A.core) / 3, 0.2, 1) * 0.5, 1);
  }
  if (A.core < 32.5 && now >= NX.heart) {
    NX.heart = now + rnd(1.1, 1.8);
    emit('heartbeat', 0.5, 1);
  }
}

// ------------------------------------------------------------------ setup
function buildGraph(c: AudioContext): Nodes {
  const master = c.createGain(); master.gain.value = muted ? 0 : vMaster * 0.9;
  const limiter = c.createDynamicsCompressor();
  limiter.threshold.value = -6; limiter.knee.value = 6; limiter.ratio.value = 8; limiter.attack.value = 0.004; limiter.release.value = 0.2;
  master.connect(limiter); limiter.connect(c.destination);

  const sfx = c.createGain(); sfx.connect(master);
  const music = c.createGain(); music.gain.value = 0; music.connect(master);

  const ambLP = c.createBiquadFilter(); ambLP.type = 'lowpass'; ambLP.frequency.value = 16000; ambLP.connect(master);
  const amb = c.createGain(); amb.connect(ambLP);

  const verb = c.createGain(); verb.gain.value = 1;
  const conv = c.createConvolver(); conv.buffer = impulse(c);
  const verbOut = c.createGain(); verbOut.gain.value = 0.55;
  verb.connect(conv); conv.connect(verbOut); verbOut.connect(master);

  const b = bufs(c);
  // wind: brown rumble through a lowpass, with two slow LFOs making gusts
  const brown = c.createBufferSource(); brown.buffer = b.b.buf; brown.loop = true; brown.loopEnd = b.b.len;
  const windLP = c.createBiquadFilter(); windLP.type = 'lowpass'; windLP.frequency.value = 300; windLP.Q.value = 0.7;
  const wind = c.createGain(); wind.gain.value = 0.02;
  brown.connect(windLP); windLP.connect(wind); wind.connect(amb);
  const lfoA = c.createOscillator(); lfoA.frequency.value = 0.11;
  const gustA = c.createGain(); gustA.gain.value = 0;
  const lfoB = c.createOscillator(); lfoB.frequency.value = 0.37;
  const gustB = c.createGain(); gustB.gain.value = 0;
  lfoA.connect(gustA); gustA.connect(wind.gain); lfoB.connect(gustB); gustB.connect(wind.gain);
  // storm whistle: white noise through a narrow bandpass
  const wz = c.createBufferSource(); wz.buffer = b.w.buf; wz.loop = true; wz.loopEnd = b.w.len;
  const whistleBP = c.createBiquadFilter(); whistleBP.type = 'bandpass'; whistleBP.frequency.value = 600; whistleBP.Q.value = 9;
  const whistle = c.createGain(); whistle.gain.value = 0;
  wz.connect(whistleBP); whistleBP.connect(whistle); whistle.connect(amb);
  // fire crackle: sparse clicks, highpassed
  const cz = c.createBufferSource(); cz.buffer = b.c.buf; cz.loop = true; cz.loopEnd = b.c.len;
  const crHP = c.createBiquadFilter(); crHP.type = 'highpass'; crHP.frequency.value = 1200;
  const crackle = c.createGain(); crackle.gain.value = 0;
  cz.connect(crHP); crHP.connect(crackle); crackle.connect(amb);

  brown.start(0, Math.random() * b.b.len); lfoA.start(); lfoB.start(); wz.start(0, Math.random() * b.w.len); cz.start(0, Math.random() * b.c.len);
  return { master, sfx, music, amb, ambLP, verb, wind, windLP, gustA, gustB, whistle, whistleBP, crackle };
}

// ------------------------------------------------------------------ public API
/** Call on the first user gesture; safe to call many times. Creates the AudioContext and the ambient graph. */
function init(): void {
  if (ac) { if (ac.state !== 'running') ac.resume().catch(() => { /* needs a gesture */ }); return; }
  const AC = (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;
  if (!AC) return;
  try {
    ac = new AC({ latencyHint: 'interactive' }) as AudioContext;
    N = buildGraph(ac);
  } catch {
    ac = null; N = null; return;
  }
  const unlock = () => { if (ac && ac.state !== 'running') ac.resume().catch(() => { /* ignore */ }); };
  if (typeof addEventListener === 'function') addEventListener('pointerdown', unlock, { passive: true });
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (!ac) return;
      if (document.hidden) ac.suspend().catch(() => { /* ignore */ }); else ac.resume().catch(() => { /* ignore */ });
    });
  }
  if (typeof setInterval === 'function') setInterval(tick, 120);
  tick();
}

function setMuted(b: boolean): void { muted = !!b; if (ac) applyMaster(ac.currentTime, 0.03); }
function setVolume(master: number, music: number): void {
  vMaster = clamp(fin(master, 0.8), 0, 1); vMusic = clamp(fin(music, 0.45), 0, 1);
  if (ac) applyMaster(ac.currentTime, 0.03);
}

/** Play a named sound. Unknown names are ignored silently. */
function play(name: string, o: PlayOpts = {}): void {
  if (typeof name !== 'string' || name.charAt(0) === '_') return;
  const key = ALIAS[name] ?? name;
  emit(key, fin(o.vol, 1), clamp(fin(o.pitch, 1), 0.2, 4), { x: o.x, pan: o.pan });
}

/** Digging a tile of material `matId`. */
function dig(matId: number): void {
  const m = MATS[matId]; if (!m) return;
  const s = DIG_SND[m.snd]; if (!s) return;
  emit(s[0], s[2] * rnd(0.85, 1.05), s[1] * rnd(0.94, 1.06));
}

/** Placing a block of material `matId`. */
function place(matId: number): void {
  const m = MATS[matId]; if (!m) return;
  const s = PLACE_SND[m.snd]; if (!s) return;
  emit(s[0], s[2] * rnd(0.85, 1.05), s[1] * rnd(0.94, 1.06));
}

/** A footstep on material `matId`; `run` = running (louder, harder). */
function step(matId: number, run: boolean): void {
  const m = MATS[matId]; if (!m) return;
  const key = '_step_' + m.snd;
  if (!DEFS[key]) return;
  const cold = clamp((-20 - G.ambientT) / 15, 0, 1);
  emit(key, (run ? 1.2 : 0.8) * rnd(0.9, 1.1), rnd(0.92, 1.08), { cold });
}

/** Being hurt. */
function hit(): void { emit('hurt', 1, rnd(0.95, 1.05)); }

/** Continuous ambience. Call every frame or at any rate; values are smoothed internally.
 *  wind in m/s (G.wind); storm 0..1; fire 0..1 nearby fire; underground 0..1; night 0..1; core body °C
 *  (a value below 10 is read as the normalised cold level 0..1, as game/sfxhooks passes it); indoor 0..1. */
function ambient(o: AmbientOpts): void {
  A.wind = fin(o.wind, 2);
  A.storm = clamp(fin(o.storm, 0), 0, 1);
  A.fire = clamp(fin(o.fire, 0), 0, 1);
  A.underground = clamp(fin(o.underground, 0), 0, 1);
  A.night = clamp(fin(o.night, 0), 0, 1);
  let core = fin(o.core, 36.5);
  if (core >= 0 && core < 10) core = 36 - 5 * core;
  A.core = core;
  A.indoor = clamp(fin(o.indoor, 0), 0, 1);
}

/** Start or stop the cold music bed. */
function music(on: boolean): void {
  M.on = !!on;
  if (M.on) NX.chord = 0; // first chord immediately
}

/** Diagnostics for the self-test. */
function stats() {
  return {
    ready: !!ac,
    state: ac ? ac.state : 'none',
    voices: live.length,
    muted,
    masterGain: N ? N.master.gain.value : 0,
    musicGain: N ? N.music.gain.value : 0,
    windGain: N ? N.wind.gain.value : 0,
    music: M.on,
    vMaster, vMusic,
  };
}

/** Names of all sounds accepted by play() (aliases included). */
export function soundNames(): string[] {
  return [...Object.keys(DEFS).filter(n => n.charAt(0) !== '_'), ...Object.keys(ALIAS)];
}

/** Render one named sound offline (no device needed). Returns mono samples at 44.1 kHz, or null when unavailable. */
export async function renderOffline(name: string, o: { vol?: number; pitch?: number; cold?: number } = {}, secs = 3): Promise<Float32Array | null> {
  const OAC = (globalThis as any).OfflineAudioContext ?? (globalThis as any).webkitOfflineAudioContext;
  const key = ALIAS[name] ?? name;
  const def = DEFS[key];
  if (!OAC || !def || key.charAt(0) === '_') return null;
  const oc = new OAC(1, Math.ceil(secs * 44100), 44100) as OfflineAudioContext;
  const v = new Voice(oc, 0.01, clamp(fin(o.pitch, 1), 0.2, 4), { dest: oc.destination }, { vol: fin(o.vol, 1), far: def.far, rev: 0 });
  def.f(v, { cold: fin(o.cold, 0) });
  const buf = await oc.startRendering();
  return buf.getChannelData(0);
}

export const sfx = {
  init, setMuted, setVolume, play, dig, place, step, hit, ambient, music, stats,
  names: soundNames,
};
