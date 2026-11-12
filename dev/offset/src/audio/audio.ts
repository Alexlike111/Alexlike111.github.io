// Audio engine + every SFX. 100% procedural WebAudio: no samples on disk, a few noise / grain buffers are
// synthesised once at init. The world is a printing press: paper, ink, press mechanics, air.
//
// graph:  world SFX ─┐
//         music ─────┼─► slow-mo lowpass ─┐
//         reverb ────┘                    ├─► mix ─► compressor ─► soft clip (< 1.0) ─► master ─► out
//         direct SFX (teleport, UI) ──────┘
import { bus, type Events } from '../core/bus';
import { Music, type MusicState } from './music';

const MAX_VOICES = 24;
const SFX_TRIM = 0.5, MUSIC_TRIM = 0.42;
const SLOW = 0.16;                 // time scale of full aim slow-mo
const PENT = [0, 2, 3, 4, 6];
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

interface Voice {
  out: GainNode; nodes: AudioNode[]; oscs: OscillatorNode[]; srcs: AudioScheduledSourceNode[];
  pend: number; prio: number; world: boolean; t0: number; dead: boolean;
}
/** break events are summed per material family and voiced at most once per 50 ms each */
interface Acc { n: number; area: number; en: number; x: number; y: number; next: number }

export interface AudioApi {
  init(): void;
  resume(): void;
  suspend(): void;
  setVolumes(master: number, sfx: number, music: number): void;
  setTimeScale(s: number): void;
  setState(s: MusicState): void;
  setIntensity(v: number): void;
  setBiome(id: string): void;
  /** optional: world position of the camera / hero for panning. Without it the engine tracks the hero from events. */
  setListener(x: number, y: number): void;
  readonly ready: boolean;
  /** QA: analyser on the final output ('out', default) or before the safety clipper ('pre') */
  _debugTap(which?: 'out' | 'pre'): AnalyserNode | null;
  _debugStats(): { voices: number; peakVoices: number; dropped: number; state: string; slow: number; music: ReturnType<Music['debug']> | null };
}

// ---------------------------------------------------------------------------------------------- buffers
function mkBuf(c: BaseAudioContext, dur: number, fill: (d: Float32Array, sr: number) => void, loop = false): AudioBuffer {
  const sr = c.sampleRate, n = Math.floor(dur * sr), b = c.createBuffer(1, n, sr), d = b.getChannelData(0);
  fill(d, sr);
  let m = 0; for (let i = 0; i < n; i++) { const a = d[i] < 0 ? -d[i] : d[i]; if (a > m) m = a; }
  if (m > 0) { const k = 0.9 / m; for (let i = 0; i < n; i++) d[i] *= k; }
  if (!loop) { const f = Math.min(n, Math.floor(sr * 0.004)); for (let i = 0; i < f; i++) d[n - 1 - i] *= i / f; }
  return b;
}
const fWhite = (d: Float32Array) => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; };
const fBrown = (d: Float32Array) => { let x = 0; for (let i = 0; i < d.length; i++) { x = (x + 0.03 * (Math.random() * 2 - 1)) / 1.03; d[i] = x; } };
function grain(d: Float32Array, pos: number, len: number, amp: number): void {
  const e = Math.min(d.length, pos + len);
  for (let j = pos; j < e; j++) { const k = 1 - (j - pos) / len; d[j] += (Math.random() * 2 - 1) * amp * k * k; }
}
function ring(d: Float32Array, sr: number, pos: number, f: number, tau: number, amp: number): void {
  const len = Math.min(d.length - pos, Math.floor(tau * 5 * sr)), w = (2 * Math.PI * f) / sr, dec = Math.exp(-1 / (tau * sr));
  let a = amp; for (let j = 0; j < len; j++) { d[pos + j] += Math.sin(w * j) * a; a *= dec; }
}
function highpass(d: Float32Array, k: number): void { let lp = 0; for (let i = 0; i < d.length; i++) { lp += (d[i] - lp) * k; d[i] -= lp; } }
/** sparse dry clicks: paper fibre, grit */
const fCrackle = (d: Float32Array, sr: number) => { for (let g = 0; g < 420; g++) { const a = Math.random(); grain(d, Math.floor(Math.random() * (d.length - 200)), Math.floor(sr * (0.0003 + Math.random() * 0.0018)), a * a); } };
/** paper tearing: quasi-periodic fibre snaps that slow down, over a thin hiss */
const fRip = (fast: number) => (d: Float32Array, sr: number) => {
  const dur = d.length / sr; let t = 0.001;
  while (t < dur - 0.01) {
    const k = t / dur, rate = fast + (70 - fast) * k;
    grain(d, Math.floor(t * sr), Math.floor(sr * (0.0006 + Math.random() * 0.0024)), Math.pow(1 - k, 1.3) * (0.45 + 0.55 * Math.random()));
    t += (0.45 + Math.random() * 1.1) / rate;
  }
  for (let i = 0; i < d.length; i++) { const k = 1 - i / d.length; d[i] += (Math.random() * 2 - 1) * 0.07 * k * k; }
  highpass(d, 0.12);
};
/** glass: a spill of short, high, inharmonic resonances */
const fGlass = (d: Float32Array, sr: number) => {
  for (let p = 0; p < 20; p++) {
    const at = Math.pow(Math.random(), 2) * 0.36, pos = Math.floor(at * sr), amp = (0.35 + 0.65 * Math.random()) * (1 - at * 1.8);
    ring(d, sr, pos, 2300 + Math.pow(Math.random(), 1.4) * 7200, 0.012 + Math.random() * 0.05, amp);
    grain(d, pos, Math.floor(sr * 0.0008), amp * 0.8);
  }
};
/** wood: a handful of sharp cracks with a short resonant body, then splinters */
const fWood = (d: Float32Array, sr: number) => {
  const n = 4 + Math.floor(Math.random() * 3);
  for (let p = 0; p < n; p++) {
    const at = p === 0 ? 0 : Math.pow(Math.random(), 1.5) * 0.2, pos = Math.floor(at * sr), amp = p === 0 ? 1 : 0.3 + 0.5 * Math.random();
    grain(d, pos, Math.floor(sr * (0.003 + Math.random() * 0.006)), amp);
    ring(d, sr, pos, 480 + Math.random() * 1100, 0.006 + Math.random() * 0.01, amp * 0.7);
  }
  for (let g = 0; g < 40; g++) { const at = Math.random() * 0.3; grain(d, Math.floor(at * sr), Math.floor(sr * 0.0012), 0.22 * (1 - at * 3)); }
};
/** rubble: stone crumbs settling */
const fRubble = (d: Float32Array, sr: number) => {
  const dur = d.length / sr;
  for (let g = 0; g < 70; g++) {
    const at = Math.pow(Math.random(), 1.7) * (dur - 0.06), pos = Math.floor(at * sr), amp = (0.3 + 0.7 * Math.random()) * (1 - at / dur);
    ring(d, sr, pos, 140 + Math.random() * 520, 0.004 + Math.random() * 0.008, amp);
    grain(d, pos, Math.floor(sr * (0.002 + Math.random() * 0.004)), amp * 0.6);
  }
};
function mkImpulse(c: BaseAudioContext): AudioBuffer {
  const sr = c.sampleRate, n = Math.floor(sr * 1.1), b = c.createBuffer(2, n, sr), pre = Math.floor(sr * 0.008);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch); let lp = 0;
    for (let i = pre; i < n; i++) { const t = (i - pre) / sr; lp += ((Math.random() * 2 - 1) - lp) * (0.55 - 0.3 * Math.min(1, t)); d[i] = lp * Math.exp(-t * 5.2) * 0.5; }
  }
  return b;
}
function clipCurve(): Float32Array<ArrayBuffer> {
  // transparent below 0.6, then bends; hard ceiling 0.6 + 0.3·tanh(4/3) ≈ 0.86 for any input
  const n = 2049, a = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1, m = Math.abs(x); a[i] = Math.sign(x) * (m < 0.6 ? m : 0.6 + 0.3 * Math.tanh((m - 0.6) / 0.3)); }
  return a;
}

// ---------------------------------------------------------------------------------------------- engine
class Engine implements AudioApi {
  private ctx: AudioContext | null = null;
  private mu: Music | null = null;
  private failed = false; private want = true; private timer = 0; private warned = false;
  // nodes
  private bWorld!: GainNode; private bDirect!: GainNode; private slowLP!: BiquadFilterNode;
  private vSfxW!: GainNode; private vSfxD!: GainNode; private vMus!: GainNode; private revS!: GainNode; private revM!: GainNode;
  private master!: GainNode; private humG!: GainNode; private tap!: AnalyserNode; private tapPre!: AnalyserNode;
  // buffers
  private white!: AudioBuffer; private brown!: AudioBuffer; private crackle!: AudioBuffer; private rubble!: AudioBuffer;
  private rip: AudioBuffer[] = []; private glass: AudioBuffer[] = []; private wood: AudioBuffer[] = [];
  // state (valid before init too)
  private volM = 0.9; private volS = 0.9; private volU = 0.7;
  private state: MusicState = 'menu'; private biome = 'press'; private inten = 0;
  private slowK = 0; private tsDriven = false; private sfxCents = 0; private sfxRate = 1;
  private lx = 0; private ly = 0; private lext = false;
  // voices
  private voices: Voice[] = []; private peakV = 0; private dropped = 0;
  private gates = new Float64Array(24);
  private brk: Acc[] = [0, 1, 2].map(() => ({ n: 0, area: 0, en: 0, x: 0, y: 0, next: 0 }));
  private brkQueued = false; private colMass = 0; private colX = 0; private colY = 0;
  private khm = new Map<string, number>();
  private stepAlt = false; private pickN = 0; private pickT = 0;

  get ready(): boolean { return !!this.ctx; }

  // ------------------------------------------------------------------ lifecycle
  init(): void {
    if (this.ctx) { this.resume(); return; }
    if (this.failed || typeof window === 'undefined') return;
    try {
      const AC: typeof AudioContext | undefined = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) { this.failed = true; this.warn('WebAudio is not available'); return; }
      const c = new AC({ latencyHint: 'interactive' });
      this.build(c);
      this.ctx = c; this.want = true;
      this.subscribe();
      this.applyVolumes(0);
      this.mu!.setBiome(this.biome); this.mu!.setState(this.state); this.mu!.setIntensity(this.inten);
      if (c.state !== 'running') c.resume().catch(() => { /* needs a gesture; the unlock listener retries */ });
      // iOS suspends / interrupts the context at will: every later gesture gets a chance to wake it
      const unlock = () => { const x = this.ctx; if (x && this.want && x.state !== 'running') x.resume().catch(() => {}); };
      for (const ev of ['pointerdown', 'touchend', 'keydown']) window.addEventListener(ev, unlock, { capture: true, passive: true });
      this.timer = window.setInterval(this.tick, 25);
    } catch (e) { this.failed = true; this.ctx = null; this.warn(e); }
  }
  resume(): void {
    const c = this.ctx; this.want = true; if (!c) return;
    if (c.state !== 'running') c.resume().catch(() => {});
    if (!this.timer) this.timer = window.setInterval(this.tick, 25);
  }
  suspend(): void {
    const c = this.ctx; this.want = false; if (!c) return;
    if (this.timer) { clearInterval(this.timer); this.timer = 0; }
    if (c.state === 'running') c.suspend().catch(() => {});
  }
  setVolumes(master: number, sfx: number, music: number): void {
    this.volM = clamp(master, 0, 1); this.volS = clamp(sfx, 0, 1); this.volU = clamp(music, 0, 1);
    if (this.ctx) this.applyVolumes(0.03);
  }
  setTimeScale(s: number): void { this.tsDriven = true; this.applySlow(clamp((1 - s) / (1 - SLOW), 0, 1)); }
  setState(s: MusicState): void { this.state = s; if (this.mu) this.mu.setState(s); }
  setIntensity(v: number): void { this.inten = v; if (this.mu) this.mu.setIntensity(v); }
  setBiome(id: string): void { this.biome = id; if (this.mu) this.mu.setBiome(id); }
  setListener(x: number, y: number): void { this.lx = x; this.ly = y; this.lext = true; }
  _debugTap(which: 'out' | 'pre' = 'out'): AnalyserNode | null { return this.ctx ? (which === 'pre' ? this.tapPre : this.tap) : null; }
  _debugStats() {
    return { voices: this.voices.length, peakVoices: this.peakV, dropped: this.dropped, state: this.ctx ? this.ctx.state : 'none', slow: this.slowK, music: this.mu ? this.mu.debug() : null };
  }

  private warn(e: unknown): void { if (import.meta.env.DEV && !this.warned) { this.warned = true; console.warn('[audio]', e); } }

  private build(c: AudioContext): void {
    const gain = (v: number) => { const g = c.createGain(); g.gain.value = v; return g; };
    this.white = mkBuf(c, 1.5, fWhite, true); this.brown = mkBuf(c, 2, fBrown, true);
    this.crackle = mkBuf(c, 1, fCrackle); this.rubble = mkBuf(c, 0.8, fRubble);
    this.rip = [mkBuf(c, 0.34, fRip(260)), mkBuf(c, 0.3, fRip(190))];
    this.glass = [mkBuf(c, 0.7, fGlass), mkBuf(c, 0.7, fGlass)];
    this.wood = [mkBuf(c, 0.4, fWood), mkBuf(c, 0.4, fWood)];
    this.bWorld = gain(1); this.bDirect = gain(1);
    this.vSfxW = gain(0); this.vSfxD = gain(0); this.vMus = gain(0); this.revS = gain(0); this.revM = gain(0);
    this.slowLP = c.createBiquadFilter(); this.slowLP.type = 'lowpass'; this.slowLP.frequency.value = 18000; this.slowLP.Q.value = 0.6;
    const mix = gain(1), comp = c.createDynamicsCompressor(), clip = c.createWaveShaper();
    comp.threshold.value = -9; comp.knee.value = 6; comp.ratio.value = 4; comp.attack.value = 0.002; comp.release.value = 0.12;
    clip.curve = clipCurve();
    this.master = gain(0);
    const conv = c.createConvolver(); conv.buffer = mkImpulse(c); const revRet = gain(0.85);
    this.bWorld.connect(this.vSfxW); this.vSfxW.connect(this.slowLP);
    this.bDirect.connect(this.vSfxD); this.vSfxD.connect(mix);
    this.revS.connect(conv); this.revM.connect(conv); conv.connect(revRet); revRet.connect(this.slowLP);
    this.slowLP.connect(mix); mix.connect(comp); comp.connect(clip); clip.connect(this.master); this.master.connect(c.destination);
    this.tap = c.createAnalyser(); this.tap.fftSize = 2048; this.master.connect(this.tap);
    this.tapPre = c.createAnalyser(); this.tapPre.fftSize = 2048; comp.connect(this.tapPre);
    // aim tension hum: always there, silent until slow-mo
    this.humG = gain(0); this.humG.connect(this.bDirect);
    const t = c.currentTime;
    for (const [f, g] of [[61.7, 1], [92.9, 0.55], [123.9, 0.25]]) { const o = c.createOscillator(); o.frequency.value = f; const og = gain(g); o.connect(og); og.connect(this.humG); o.start(t); }
    this.mu = new Music(c, this.brown);
    this.mu.out.connect(this.vMus); this.vMus.connect(this.slowLP); this.mu.revOut.connect(this.revM);
  }
  private applyVolumes(tc: number): void {
    const t = this.ctx!.currentTime, s = Math.pow(this.volS, 1.5) * SFX_TRIM, m = Math.pow(this.volU, 1.5) * MUSIC_TRIM; // sliders are perceptual
    const set = (g: GainNode, v: number) => { if (tc > 0) g.gain.setTargetAtTime(v, t, tc); else g.gain.value = v; };
    set(this.vSfxW, s); set(this.vSfxD, s); set(this.revS, s); set(this.vMus, m); set(this.revM, m); set(this.master, Math.pow(this.volM, 1.5));
  }
  private applySlow(k: number): void {
    if (k === this.slowK || (Math.abs(k - this.slowK) < 0.02 && k > 0 && k < 1)) return;
    const down = k > this.slowK; this.slowK = k;
    const c = this.ctx; if (!c) return;
    const t = c.currentTime, tc = down ? 0.07 : 0.035;
    this.slowLP.frequency.setTargetAtTime(18000 * Math.pow(0.042, k), t, tc); // 18 kHz → ≈ 760 Hz
    this.sfxCents = -300 * k; this.sfxRate = Math.pow(2, this.sfxCents / 1200);
    for (const v of this.voices) if (v.world) for (const o of v.oscs) o.detune.setTargetAtTime(this.sfxCents, t, tc);
    this.humG.gain.setTargetAtTime(k * 0.1, t, down ? 0.12 : 0.04);
    this.mu!.setSlow(k, tc);
  }
  private tick = (): void => {
    const c = this.ctx; if (!c || c.state !== 'running') return;
    try {
      this.mu!.tick();
      if (this.brk[0].n || this.brk[1].n || this.brk[2].n || this.colMass > 0) this.flush();
    } catch (e) { this.warn(e); }
  };

  // ------------------------------------------------------------------ voices
  private vo(world: boolean, prio: number, pan = 0, send = 0, gain = 1): Voice | null {
    const c = this.ctx!, vs = this.voices;
    if (vs.length >= MAX_VOICES) {
      let k = -1, best = 99, age = Infinity;
      for (let i = 0; i < vs.length; i++) { const o = vs[i]; if (o.prio < best || (o.prio === best && o.t0 < age)) { best = o.prio; age = o.t0; k = i; } }
      if (k < 0 || best > prio || (best === prio && prio < 2)) { this.dropped++; return null; }
      this.kill(vs[k]);
    }
    const out = c.createGain(); out.gain.value = gain;
    const v: Voice = { out, nodes: [out], oscs: [], srcs: [], pend: 0, prio, world, t0: c.currentTime, dead: false };
    let last: AudioNode = out;
    if (pan !== 0 && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; out.connect(p); v.nodes.push(p); last = p; }
    last.connect(world ? this.bWorld : this.bDirect);
    if (send > 0) { const s = c.createGain(); s.gain.value = send; last.connect(s); s.connect(this.revS); v.nodes.push(s); }
    vs.push(v); if (vs.length > this.peakV) this.peakV = vs.length;
    return v;
  }
  private kill(v: Voice): void {
    const t = this.ctx!.currentTime; this.unlist(v); v.dead = true;
    v.out.gain.cancelScheduledValues(t); v.out.gain.setTargetAtTime(0, t, 0.006);
    for (const s of v.srcs) { try { s.stop(t + 0.04); } catch { /* already stopped */ } }
  }
  private unlist(v: Voice): void { const vs = this.voices, i = vs.indexOf(v); if (i >= 0) { vs[i] = vs[vs.length - 1]; vs.pop(); } }
  private reg(v: Voice, s: AudioScheduledSourceNode): void {
    v.pend++; v.srcs.push(s); v.nodes.push(s);
    s.onended = () => { if (--v.pend > 0) return; if (!v.dead) this.unlist(v); for (const n of v.nodes) n.disconnect(); };
  }
  /** oscillator → envelope. Linear attack `a`, exponential decay `d`, pitch glides f0→f1 over `ft`. */
  private tn(v: Voice, type: OscillatorType, f0: number, f1: number, t: number, a: number, d: number, pk: number, ft = d, dst: AudioNode = v.out): void {
    const c = this.ctx!, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1 < 1 ? 1 : f1, t + ft);
    if (v.world) { o.detune.value = this.sfxCents; v.oscs.push(o); }
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(pk, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    o.connect(g); g.connect(dst); v.nodes.push(g); this.reg(v, o); o.start(t); o.stop(t + a + d + 0.02);
  }
  /** looped noise → filter → gain, caller automates */
  private nzRaw(v: Voice, buf: AudioBuffer, t: number, stop: number, type: BiquadFilterType, freq: number, q: number): [BiquadFilterNode, GainNode] {
    const c = this.ctx!, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = buf; s.loop = true; f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.setValueAtTime(q, t); g.gain.setValueAtTime(0.0001, t);
    s.connect(f); f.connect(g); g.connect(v.out); v.nodes.push(f, g); this.reg(v, s);
    s.start(t, Math.random() * (buf.duration - 0.1)); s.stop(stop);
    return [f, g];
  }
  /** filtered noise burst */
  private nz(v: Voice, buf: AudioBuffer, t: number, a: number, d: number, pk: number, type: BiquadFilterType, f0: number, f1 = f0, q = 0.7): void {
    const [f, g] = this.nzRaw(v, buf, t, t + a + d + 0.02, type, f0, q);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + a + d);
    g.gain.linearRampToValueAtTime(pk, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  /** one-shot grain buffer (rip / glass / wood / rubble / crackle) */
  private sm(v: Voice, buf: AudioBuffer, t: number, pk: number, rate: number, type: BiquadFilterType | null = null, freq = 1000, q = 0.7): void {
    const c = this.ctx!, s = c.createBufferSource(), g = c.createGain();
    s.buffer = buf; s.playbackRate.value = rate * (v.world ? this.sfxRate : 1); g.gain.value = pk;
    if (type) { const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; s.connect(f); f.connect(g); v.nodes.push(f); } else s.connect(g);
    g.connect(v.out); v.nodes.push(g); this.reg(v, s); s.start(t);
  }
  /** FM pluck: the same "jab" the music uses, for anything that should sound like a mark being set */
  private pl(v: Voice, f: number, t: number, pk: number, d: number, ratio = 2, idx = 1.4): void {
    const c = this.ctx!, car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain(), g = c.createGain();
    car.frequency.value = f; mod.frequency.value = f * ratio;
    mg.gain.setValueAtTime(f * idx, t); mg.gain.exponentialRampToValueAtTime(f * 0.03, t + d * 0.5);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(pk, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    mod.connect(mg); mg.connect(car.frequency); car.connect(g); g.connect(v.out); v.nodes.push(mg, g);
    this.reg(v, car); this.reg(v, mod); car.start(t); mod.start(t); car.stop(t + d + 0.02); mod.stop(t + d + 0.02);
  }
  /** the press: low tuck + click + paper slap */
  private stamp(v: Voice, t: number, pw: number, low: number): void {
    this.tn(v, 'sine', low * 2, low, t, 0.002, 0.1 + 0.08 * pw, 0.8 * pw, 0.03);
    this.nz(v, this.white, t, 0.0004, 0.006, 0.3 * pw, 'highpass', 4500);
    this.nz(v, this.white, t, 0.001, 0.035, 0.32 * pw, 'bandpass', 950, 600, 0.8);
  }
  private gate(id: number, dt: number): boolean { const t = this.ctx!.currentTime; if (t - this.gates[id] < dt) return false; this.gates[id] = t; return true; }
  private kh(kind: string): number {
    let v = this.khm.get(kind);
    if (v === undefined) { let h = 7; for (let i = 0; i < kind.length; i++) h = (Math.imul(h, 31) + kind.charCodeAt(i)) | 0; v = ((h >>> 0) % 1000) / 1000; this.khm.set(kind, v); }
    return v;
  }
  private pan(x: number): number { return clamp((x - this.lx) / 18, -0.6, 0.6); }
  private att(x: number, y: number): number { const dx = x - this.lx, dy = y - this.ly; return 1 / (1 + (dx * dx + dy * dy) / 500); }
  private hz(step: number, up: number): number { return this.mu!.hz(step, up); }

  // ------------------------------------------------------------------ bus wiring
  private subscribe(): void {
    const on = <K extends keyof Events>(k: K, f: (p: Events[K], t: number) => void) =>
      bus.on(k, (p) => { const c = this.ctx; if (c && c.state === 'running') f(p, c.currentTime); });
    on('jump', (p, t) => this.sJump(p, t));
    on('jumpDenied', (p, t) => this.sDenied(p, t));
    on('aimStart', (_, t) => { const v = this.vo(false, 1); if (v) { const [f, g] = this.nzRaw(v, this.white, t, t + 0.26, 'bandpass', 480, 1.2); f.frequency.exponentialRampToValueAtTime(1500, t + 0.18); g.gain.linearRampToValueAtTime(0.18, t + 0.12); g.gain.setTargetAtTime(0.0001, t + 0.14, 0.03); } if (!this.tsDriven) this.applySlow(1); });
    on('aimEnd', (_, t) => { const v = this.vo(false, 1); if (v) this.nz(v, this.white, t, 0.003, 0.05, 0.18, 'bandpass', 1800, 700, 1.2); if (!this.tsDriven) this.applySlow(0); });
    on('break', (p) => this.onBreak(p));
    on('collapse', (p) => { this.colMass += p.mass; this.colX = p.x; this.colY = p.y; this.queue(); });
    on('impact', (p, t) => this.sImpact(p, t));
    on('explode', (p, t) => this.sExplode(p, t));
    on('strike', (p, t) => this.sStrike(p, t));
    on('enemyHit', (p, t) => this.sEnemyHit(p, t));
    on('enemyDie', (p, t) => this.sEnemyDie(p, t));
    on('enemyShoot', (p, t) => this.sEnemyShoot(p, t));
    on('enemyAlert', (p, t) => this.sEnemyAlert(p, t));
    on('enemyTelegraph', (p, t) => this.sTelegraph(p, t));
    on('playerHurt', (p, t) => this.sHurt(p, t));
    on('playerDie', (_, t) => this.sDie(t));
    on('playerLand', (p, t) => this.sLand(p, t));
    on('playerStep', (p, t) => this.sStep(p, t));
    on('playerJump', (_, t) => { const v = this.vo(true, 1); if (v) { this.nz(v, this.white, t, 0.02, 0.07, 0.13, 'bandpass', 500, 1500, 1.2); this.tn(v, 'sine', 190, 260, t, 0.004, 0.05, 0.09); } });
    on('grab', (_, t) => { const v = this.vo(false, 2); if (v) { this.nz(v, this.white, t, 0.0004, 0.004, 0.3, 'highpass', 4500); this.nz(v, this.white, t, 0.001, 0.03, 0.3, 'bandpass', 1300, 1300, 2); this.tn(v, 'triangle', 250, 170, t, 0.002, 0.06, 0.4); this.nz(v, this.white, t + 0.045, 0.0005, 0.015, 0.22, 'bandpass', 2100, 2100, 3); } });
    on('throwIt', (p, t) => this.sThrow(p, t));
    on('combo', (p, t) => this.sCombo(p, t));
    on('comboEnd', (p, t) => { if (p.n < 3) return; const v = this.vo(false, 1, 0, 0.2); if (v) { this.pl(v, this.hz(4, 2), t, 0.15, 0.2); this.pl(v, this.hz(0, 2), t + 0.09, 0.15, 0.3); this.nz(v, this.white, t + 0.09, 0.001, 0.03, 0.12, 'bandpass', 900, 600, 0.8); } });
    on('pickup', (p, t) => this.sPickup(p, t));
    on('roomStart', (p, t) => this.sRoomStart(p, t));
    on('roomClear', (p, t) => this.sRoomClear(p, t));
    on('waveStart', (_, t) => { const v = this.vo(false, 2, 0, 0.15, 0.6); if (v) { this.tn(v, 'sine', 104, 52, t, 0.003, 0.12, 0.5, 0.04); this.tn(v, 'sine', 112, 48, t + 0.15, 0.003, 0.2, 0.62, 0.04); for (let i = 0; i < 3; i++) this.nz(v, this.white, t + 0.045 + i * 0.03, 0.0005, 0.012, 0.16, 'bandpass', 2400 + 300 * i, 2400, 3); this.nz(v, this.white, t + 0.15, 0.001, 0.04, 0.3, 'bandpass', 1500, 1000, 1.4); } });
    on('upgradeOffer', (_, t) => { const v = this.vo(false, 2, 0, 0.3); if (v) { for (let i = 0; i < 3; i++) this.nz(v, this.white, t + i * 0.09, 0.03, 0.08, 0.12, 'bandpass', 1500 + 500 * i, 3200, 1); this.pl(v, this.hz(this.mu!.bright(0), 2), t + 0.2, 0.14, 0.5); this.pl(v, this.hz(this.mu!.bright(2), 2), t + 0.3, 0.12, 0.6); } });
    on('upgradePicked', (_, t) => { const v = this.vo(false, 2, 0, 0.25, 0.6); if (v) { this.stamp(v, t, 0.9, 72); this.pl(v, this.hz(this.mu!.bright(0), 2), t + 0.05, 0.2, 0.3); this.pl(v, this.hz(this.mu!.bright(1), 2), t + 0.13, 0.2, 0.45); } });
    on('runStart', (p, t) => this.sRunStart(p, t));
    on('runEnd', (p, t) => this.sRunEnd(p, t));
    on('bossPhase', (p, t) => this.sBossPhase(p, t));
    on('uiClick', (_, t) => { if (!this.gate(0, 0.025)) return; const v = this.vo(false, 2); if (v) { this.nz(v, this.white, t, 0.0004, 0.012, 0.25, 'bandpass', 2300, 2300, 4); this.tn(v, 'sine', 420, 300, t, 0.001, 0.02, 0.12); } });
    on('uiHover', (_, t) => { if (!this.gate(1, 0.05)) return; const v = this.vo(false, 0); if (v) this.nz(v, this.white, t, 0.0004, 0.012, 0.6, 'bandpass', 3400, 3400, 4); });
    on('uiBuy', (_, t) => { const v = this.vo(false, 2, 0, 0.2, 0.55); if (v) { this.stamp(v, t, 0.7, 80); this.tn(v, 'sine', 380, 760, t + 0.06, 0.003, 0.06, 0.15, 0.05); this.pl(v, this.hz(this.mu!.bright(0), 2), t + 0.1, 0.2, 0.3); this.pl(v, this.hz(this.mu!.bright(2), 2), t + 0.17, 0.2, 0.4); } });
    on('uiDeny', (_, t) => { if (!this.gate(2, 0.08)) return; const v = this.vo(false, 2); if (v) { this.tn(v, 'triangle', 150, 110, t, 0.002, 0.05, 0.3); this.tn(v, 'triangle', 130, 95, t + 0.085, 0.002, 0.06, 0.3); this.nz(v, this.white, t, 0.001, 0.03, 0.2, 'lowpass', 500); this.nz(v, this.white, t + 0.085, 0.001, 0.03, 0.2, 'lowpass', 450); } });
    on('uiOpen', (_, t) => { if (!this.gate(3, 0.06)) return; const v = this.vo(false, 1); if (v) { const [f, g] = this.nzRaw(v, this.white, t, t + 0.24, 'bandpass', 1400, 0.9); f.frequency.exponentialRampToValueAtTime(3400, t + 0.14); g.gain.linearRampToValueAtTime(0.13, t + 0.07); g.gain.setTargetAtTime(0.0001, t + 0.1, 0.03); this.nz(v, this.white, t + 0.15, 0.0005, 0.008, 0.1, 'bandpass', 2600, 2600, 4); } });
    on('uiStamp', (_, t) => { if (!this.gate(4, 0.05)) return; const v = this.vo(false, 2, 0, 0.25, 0.6); if (v) { this.stamp(v, t, 1.15, 62); this.sm(v, this.rip[1], t + 0.004, 0.2, 1.4, 'highpass', 1800); this.tn(v, 'sine', 1180, 1180, t, 0.001, 0.12, 0.05); this.tn(v, 'sine', 1790, 1790, t, 0.001, 0.08, 0.035); } });
    on('achievement', (_, t) => { const v = this.vo(false, 2, 0, 0.35, 0.65); if (v) { this.stamp(v, t, 0.9, 68); for (let i = 0; i < 3; i++) this.pl(v, this.hz(this.mu!.bright(i), 2), t + 0.08 + i * 0.07, 0.2, 0.35); this.pl(v, this.hz(this.mu!.bright(3), 2), t + 0.3, 0.2, 0.7, 3, 0.8); this.nz(v, this.white, t + 0.2, 0.15, 0.3, 0.04, 'highpass', 7000); } });
    on('pause', (p, t) => { this.mu!.setMuffled(p.on); const v = this.vo(false, 2); if (v) { this.tn(v, 'sine', p.on ? 300 : 180, p.on ? 180 : 300, t, 0.002, 0.05, 0.2); this.nz(v, this.white, t, 0.0004, 0.008, 0.15, 'bandpass', 2600, 2600, 4); } });
    on('hint', (_, t) => { if (!this.gate(5, 0.15)) return; const v = this.vo(false, 1, 0, 0.2); if (v) { this.pl(v, this.hz(4, 2), t, 0.16, 0.3, 1, 0.8); this.nz(v, this.white, t, 0.0004, 0.008, 0.08, 'bandpass', 3000, 3000, 4); } });
  }

  // ------------------------------------------------------------------ teleport — the sound of the game
  private sJump(p: Events['jump'], t: number): void {
    const dx = p.toX - p.fromX, dist = Math.hypot(dx, p.toY - p.fromY), hv = p.heavy;
    const dk = clamp(dist / 14, 0, 1), sk = clamp(p.speed / 22, 0, 1);
    const pv = rnd(0.93, 1.08) * (1 - dk * 0.07), hp = hv ? 0.76 : 1; // every jump is a little different
    if (!this.lext) { this.lx = p.toX; this.ly = p.toY; }
    // departure: air falls into the hole — a reverse suck that snaps shut, and the dull "thup" of the vacuum
    const d = this.vo(false, 3, clamp(-dx / 24, -0.4, 0.4), 0.1);
    if (d) {
      const sw = hv ? 0.09 : 0.052;
      const [f, g] = this.nzRaw(d, this.white, t, t + sw + 0.05, 'bandpass', 3600 * pv * hp, 1.4);
      f.frequency.exponentialRampToValueAtTime(360 * pv * hp, t + sw); f.Q.linearRampToValueAtTime(7, t + sw);
      g.gain.setValueAtTime(0.03, t); g.gain.exponentialRampToValueAtTime(0.55, t + sw); g.gain.setTargetAtTime(0.0001, t + sw, 0.005);
      this.tn(d, 'sine', 176 * pv * hp, 54 * pv * hp, t, 0.004, hv ? 0.2 : 0.1, 0.55, 0.07);
      this.nz(d, this.white, t, 0.002, 0.04, 0.3, 'lowpass', 520, 180);
    }
    // arrival: dry pressure clap (click + 60–90 Hz punch) and paper tearing
    const ta = t + dk * 0.026 + (hv ? 0.012 : 0) + rnd(0, 0.004);
    const a = this.vo(false, 3, 0, hv ? 0.3 : 0.2, hv ? 1.15 : 1.1);
    if (a) {
      this.nz(a, this.white, ta, 0.0004, 0.007, 0.5 + 0.4 * sk, 'highpass', 5200);
      this.nz(a, this.white, ta, 0.001, hv ? 0.07 : 0.038, 0.42 + 0.38 * sk, 'bandpass', (1100 + 2300 * sk) * pv * hp, 700 * pv * hp, 0.9);
      const f0 = (hv ? 62 : 84) * pv;
      this.tn(a, 'sine', f0 * 2.5, f0, ta, 0.002, hv ? 0.38 : 0.17, 0.9, 0.03);
      this.sm(a, this.rip[(Math.random() * 2) | 0], ta + 0.012, hv ? 0.5 : 0.34, rnd(0.85, 1.25) * hp, 'bandpass', 3000 * pv, 0.5);
      if (hv) { // volume swap: sub-bass, a slab of air, and whatever came along rattling
        this.tn(a, 'sine', 44 * pv, 33 * pv, ta, 0.01, 0.62, 0.75, 0.3);
        this.nz(a, this.brown, ta, 0.02, 0.5, 0.5, 'lowpass', 170, 70);
        if (p.carried > 0) this.sm(a, this.rubble, ta + 0.03, 0.2 + 0.25 * Math.min(1, p.carried / 6), rnd(0.9, 1.2));
      }
    }
    this.mu!.duck(hv ? 0.4 : 0.62, hv ? 0.35 : 0.14);
  }
  private sDenied(p: Events['jumpDenied'], t: number): void {
    if (!this.gate(6, 0.06)) return; const v = this.vo(false, 2); if (!v) return;
    if (p.reason === 'charges') { // empty valve
      this.nz(v, this.white, t, 0.0005, 0.02, 0.3, 'bandpass', 1800, 1800, 3); this.tn(v, 'triangle', 160, 120, t, 0.002, 0.05, 0.35);
      this.nz(v, this.white, t + 0.01, 0.005, 0.05, 0.1, 'bandpass', 3000, 1200, 1);
    } else if (p.reason === 'anchor') { // something metal holds
      this.tn(v, 'sine', 523, 515, t, 0.001, 0.08, 0.14); this.tn(v, 'sine', 1370, 1350, t, 0.001, 0.05, 0.08); this.tn(v, 'triangle', 180, 120, t, 0.002, 0.05, 0.3);
    } else { this.tn(v, 'sine', 130, 70, t, 0.002, 0.08, 0.5); this.nz(v, this.white, t, 0.001, 0.04, 0.3, 'lowpass', 400); }
  }

  // ------------------------------------------------------------------ destruction
  private onBreak(p: Events['break']): void {
    const m = p.mat, a = this.brk[m === 'glass' ? 0 : m === 'wood' || m === 'crate' ? 1 : 2];
    a.n++; a.area += p.area; if (p.energy > a.en) a.en = p.energy; a.x += p.x; a.y += p.y;
    this.queue();
  }
  private queue(): void { if (!this.brkQueued) { this.brkQueued = true; (typeof queueMicrotask === 'function' ? queueMicrotask : (f: () => void) => void Promise.resolve().then(f))(this.flush); } }
  /** runs once per frame (microtask) and from the timer: ≤ 1 fat voice per material family per 50 ms */
  private flush = (): void => {
    this.brkQueued = false;
    const c = this.ctx; if (!c || c.state !== 'running') { for (const a of this.brk) { a.n = 0; a.area = 0; a.en = 0; a.x = 0; a.y = 0; } this.colMass = 0; return; }
    const t = c.currentTime;
    for (let k = 0; k < 3; k++) {
      const a = this.brk[k]; if (!a.n || t < a.next) continue;
      this.sBreak(k, a, t); a.next = t + 0.05; a.n = 0; a.area = 0; a.en = 0; a.x = 0; a.y = 0;
    }
    if (this.colMass > 0 && this.gate(7, 0.25)) { this.sCollapse(this.colMass, this.colX, this.colY, t); this.colMass = 0; }
  };
  private sBreak(k: number, a: Acc, t: number): void {
    const x = a.x / a.n, y = a.y / a.n, amp = clamp(0.3 + 0.32 * Math.sqrt(a.area) + 0.03 * a.n, 0.3, 1.25);
    const big = a.n >= 4 || a.area > 2, e = clamp(a.en / 18, 0, 1), i = (Math.random() * 2) | 0;
    const v = this.vo(true, big ? 2 : 1, this.pan(x), big ? 0.25 : 0.14, this.att(x, y) * amp); if (!v) return;
    if (k === 0) { // glass: bright spill of tiny resonances
      this.nz(v, this.white, t, 0.0004, 0.006, 0.6, 'highpass', 6000);
      this.sm(v, this.glass[i], t, 0.7, rnd(0.85, 1.25));
      if (big) this.sm(v, this.glass[1 - i], t + rnd(0.03, 0.07), 0.5, rnd(0.7, 0.9));
    } else if (k === 1) { // wood / crate: dry crack, splinters
      this.sm(v, this.wood[i], t, 0.75, rnd(0.85, 1.2) / (big ? 1.15 : 1));
      this.tn(v, 'triangle', rnd(300, 400), 180, t, 0.001, 0.06, 0.35);
      if (big) this.sm(v, this.wood[1 - i], t + 0.04, 0.5, 0.75);
    } else { // concrete / brick / plaster: dull hit, grit
      this.tn(v, 'sine', rnd(88, 108), 48, t, 0.002, 0.1 + 0.08 * Math.min(1, amp), 0.8, 0.06);
      this.nz(v, this.white, t, 0.002, 0.12, 0.55, 'lowpass', 1400 + 1500 * e, 260);
      this.sm(v, this.rubble, t + 0.02, 0.5, rnd(0.9, 1.3) / (big ? 1.3 : 1));
      if (big) this.nz(v, this.brown, t, 0.02, 0.4, 0.5, 'lowpass', 240, 90);
    }
  }
  private sCollapse(mass: number, x: number, y: number, t: number): void {
    const a = clamp(mass / 3000, 0.3, 1), v = this.vo(true, 2, this.pan(x), 0.3, this.att(x, y)); if (!v) return;
    this.nz(v, this.brown, t, 0.12, 1.1 + 1.2 * a, 0.75, 'lowpass', 150 + 100 * a, 60);
    this.tn(v, 'sine', 46, 30, t, 0.08, 1 + a, 0.5);
    this.sm(v, this.rubble, t + 0.05, 0.45, 0.6, 'lowpass', 1800); this.sm(v, this.rubble, t + 0.4, 0.3, 0.5, 'lowpass', 1200);
    this.mu!.duck(0.7, 0.3);
  }
  private sImpact(p: Events['impact'], t: number): void {
    const m = p.mat, k = m === 'glass' ? 0 : m === 'wood' || m === 'crate' ? 1 : 2;
    if (!this.gate(8 + k, 0.055)) return;
    const a = clamp(p.force / (k === 0 ? 60 : k === 1 ? 500 : 1500), 0.2, 1), v = this.vo(true, 1, this.pan(p.x), 0, this.att(p.x, p.y) * a); if (!v) return;
    if (k === 0) { this.tn(v, 'sine', rnd(2600, 4200), 2400, t, 0.0005, 0.05, 0.16); this.nz(v, this.white, t, 0.0004, 0.004, 0.15, 'highpass', 5000); }
    else if (k === 1) { const f = rnd(280, 420); this.tn(v, 'triangle', f, f * 0.7, t, 0.001, 0.05, 0.4); this.nz(v, this.white, t, 0.0005, 0.025, 0.25, 'bandpass', 900, 900, 2); }
    else { this.tn(v, 'sine', rnd(95, 130), 60, t, 0.002, 0.07, 0.5); this.nz(v, this.white, t, 0.001, 0.04, 0.3, 'lowpass', 900, 300); }
  }
  private sExplode(p: Events['explode'], t: number): void {
    const a = clamp(p.r / 3.5, 0.5, 1.3), v = this.vo(true, 3, this.pan(p.x), 0.35, 0.5 + 0.5 * this.att(p.x, p.y)); if (!v) return;
    this.nz(v, this.white, t, 0.0005, 0.012, 0.8, 'highpass', 3000);
    this.tn(v, 'sine', 130, 30, t, 0.003, 0.55 * a, 1, 0.35);
    this.nz(v, this.white, t, 0.004, 0.5 * a, 0.75, 'lowpass', 5000, 180);
    this.nz(v, this.brown, t, 0.03, 0.9 * a, 0.6, 'lowpass', 220, 70);
    this.sm(v, this.rubble, t + 0.08, 0.4, 0.8);
    this.mu!.duck(0.4, 0.3);
  }

  // ------------------------------------------------------------------ combat
  private sStrike(p: Events['strike'], t: number): void {
    const pw = clamp(p.power / 26, 0.55, 1.2), v = this.vo(false, p.kill ? 3 : 2, 0, 0.12); if (!v) return;
    this.stamp(v, t, pw, 74 * rnd(0.95, 1.05));
    this.tn(v, 'triangle', 330, 210, t, 0.001, 0.035, 0.3 * pw);
    if (p.kill) { // the accent: the plate goes all the way down
      this.tn(v, 'sine', 96, 40, t + 0.012, 0.003, 0.26, 0.7, 0.1);
      this.sm(v, this.rip[0], t + 0.02, 0.35, 1.1, 'bandpass', 2600, 0.5);
      this.tn(v, 'sine', 1245, 1245, t, 0.001, 0.16, 0.06); this.tn(v, 'sine', 1980, 1980, t, 0.001, 0.1, 0.04);
      this.mu!.duck(0.7, 0.1);
    }
  }
  private sEnemyHit(p: Events['enemyHit'], t: number): void {
    if (!this.gate(11, 0.035)) return;
    const a = clamp(0.5 + p.dmg / 80, 0.5, 1), v = this.vo(true, 2, this.pan(p.x), 0, this.att(p.x, p.y) * a); if (!v) return;
    this.nz(v, this.white, t, 0.001, 0.045, 0.4, 'bandpass', 1700, 900, 1);
    this.tn(v, 'triangle', 210, 120, t, 0.002, 0.06, 0.4);
    this.sm(v, this.rip[1], t, 0.22, 1.5, 'highpass', 2200);
  }
  /** not a scream: the sheet is torn off and un-printed */
  private sEnemyDie(p: Events['enemyDie'], t: number): void {
    const i = (Math.random() * 2) | 0, v = this.vo(true, 2, this.pan(p.x), 0.2, this.att(p.x, p.y)); if (!v) return;
    this.sm(v, this.rip[i], t, 0.55, p.elite ? 0.6 : rnd(0.8, 1.05), 'bandpass', 2400, 0.4);
    if (p.elite) { this.sm(v, this.rip[1 - i], t + 0.09, 0.4, 0.8, 'bandpass', 1500, 0.5); this.tn(v, 'sine', 80, 36, t + 0.05, 0.004, 0.4, 0.5); }
    this.tn(v, 'sine', 150, 55, t, 0.003, 0.16, 0.5);
    this.nz(v, this.white, t + 0.03, 0.06, 0.05, 0.18, 'bandpass', 900, 3800, 1.5);
  }
  private sEnemyShoot(p: Events['enemyShoot'], t: number): void {
    if (!this.gate(12, 0.03)) return;
    const fk = 0.8 + 0.5 * this.kh(p.kind), v = this.vo(true, 1, this.pan(p.x), 0, this.att(p.x, p.y) * 1.3); if (!v) return;
    this.nz(v, this.white, t, 0.001, 0.07, 0.6, 'bandpass', 2400 * fk, 700 * fk, 2.2); // pneumatic spit
    this.nz(v, this.white, t, 0.0004, 0.005, 0.3, 'highpass', 6000);
    this.tn(v, 'triangle', 340 * fk, 150 * fk, t, 0.001, 0.05, 0.25);
  }
  private sEnemyAlert(p: Events['enemyAlert'], t: number): void {
    if (!this.gate(13, 0.08)) return;
    const f = 1568 * (0.9 + 0.25 * this.kh(p.kind)), v = this.vo(true, 1, this.pan(p.x), 0.25, this.att(p.x, p.y) * 1.1); if (!v) return;
    this.tn(v, 'sine', f, f, t, 0.001, 0.3, 0.2); this.tn(v, 'sine', f * 2.76, f * 2.76, t, 0.001, 0.12, 0.07); // carriage bell
    this.nz(v, this.white, t, 0.0004, 0.006, 0.15, 'highpass', 4000);
  }
  private sTelegraph(p: Events['enemyTelegraph'], t: number): void {
    if (!this.gate(14, 0.06)) return;
    const fk = 0.85 + 0.4 * this.kh(p.kind), v = this.vo(true, 2, this.pan(p.x), 0, this.att(p.x, p.y) * 1.7); if (!v) return;
    let tt = t; for (let i = 0; i < 5; i++) { this.nz(v, this.white, tt, 0.0005, 0.014, 0.42 + 0.08 * i, 'bandpass', 2600 + 300 * i, 2600, 2.5); tt += 0.07 * Math.pow(0.76, i); } // ratchet winding up
    this.tn(v, 'triangle', 280 * fk, 560 * fk, t, 0.2, 0.04, 0.3, 0.22);
  }
  private sHurt(p: Events['playerHurt'], t: number): void {
    const low = clamp(1 - p.hp / Math.max(1, p.maxHp), 0, 1), v = this.vo(false, 3, 0, 0.15); if (!v) return;
    // two plates out of register, a slap, and the body of it
    this.tn(v, 'sawtooth', 196, 82, t, 0.002, 0.2 + 0.15 * low, 0.3, 0.18); this.tn(v, 'square', 207, 87, t, 0.002, 0.16, 0.16, 0.18);
    this.nz(v, this.white, t, 0.001, 0.06, 0.5, 'bandpass', 1400, 900, 0.8);
    this.tn(v, 'sine', 110, 48, t, 0.002, 0.22 + 0.1 * low, 0.7, 0.1);
    this.sm(v, this.rip[0], t + 0.01, 0.3, 0.9, 'bandpass', 2000, 0.5);
    this.mu!.duck(0.45, 0.25);
  }
  private sDie(t: number): void {
    const c = this.ctx!, v = this.vo(false, 3, 0, 0.35); if (!v) return;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(1800, t); f.frequency.exponentialRampToValueAtTime(120, t + 1.3); f.connect(v.out); v.nodes.push(f);
    this.tn(v, 'sawtooth', 220, 28, t, 0.01, 1.4, 0.34, 1.3, f); this.tn(v, 'sawtooth', 147, 19, t, 0.01, 1.4, 0.24, 1.3, f); // the press winds down
    this.sm(v, this.rip[0], t, 0.5, 0.5, 'bandpass', 1800, 0.4);
    this.tn(v, 'sine', 90, 30, t, 0.004, 0.7, 0.8, 0.5);
    this.nz(v, this.brown, t, 0.05, 1.2, 0.5, 'lowpass', 200, 60);
    this.mu!.duck(0.3, 0.8);
  }
  private sLand(p: Events['playerLand'], t: number): void {
    if (!this.lext) { this.lx = p.x; this.ly = p.y; }
    if (p.speed < 2.5 || !this.gate(15, 0.06)) return;
    const a = clamp(p.speed / 22, 0.12, 1), v = this.vo(true, 1); if (!v) return;
    this.tn(v, 'sine', 120, 58, t, 0.002, 0.07 + 0.1 * a, 0.55 * a, 0.05);
    this.nz(v, this.white, t, 0.001, 0.05, 0.35 * a, 'lowpass', 700 + 900 * a, 200);
    if (a > 0.6) this.sm(v, this.rubble, t + 0.01, 0.2 * a, 1.3);
  }
  private sStep(p: Events['playerStep'], t: number): void {
    if (!this.lext) { this.lx = p.x; this.ly = p.y; }
    if (!this.gate(16, 0.09)) return; const v = this.vo(true, 0); if (!v) return;
    this.stepAlt = !this.stepAlt;
    this.nz(v, this.white, t, 0.001, 0.022, 0.1, 'bandpass', (this.stepAlt ? 820 : 1040) * rnd(0.9, 1.1), 600, 1.6);
    this.tn(v, 'sine', 150, 90, t, 0.002, 0.03, 0.1);
  }
  private sThrow(p: Events['throwIt'], t: number): void {
    const a = clamp(p.power / 30, 0.3, 1), v = this.vo(false, 2); if (!v) return;
    const [f, g] = this.nzRaw(v, this.white, t, t + 0.3, 'bandpass', 380, 1.3);
    f.frequency.exponentialRampToValueAtTime(1900 * a + 300, t + 0.06); f.frequency.exponentialRampToValueAtTime(520, t + 0.22);
    g.gain.linearRampToValueAtTime(0.38 * a, t + 0.05); g.gain.setTargetAtTime(0.0001, t + 0.08, 0.045);
    this.tn(v, 'sine', 140, 70, t, 0.002, 0.06, 0.3 * a);
  }
  private sCombo(p: Events['combo'], t: number): void {
    if (p.n < 2 || !this.gate(17, 0.04)) return; const v = this.vo(false, 1, 0, 0.2); if (!v) return;
    const i = Math.min(p.n - 2, 14), st = PENT[i % 5] + 7 * Math.floor(i / 5); // type hammers climbing the case
    this.pl(v, this.hz(st, 2), t, 0.2, 0.18, 2, 1.2);
    this.nz(v, this.white, t, 0.0004, 0.005, 0.12, 'highpass', 5000);
    if (p.n % 5 === 0) this.pl(v, this.hz(st + 4, 2), t + 0.05, 0.16, 0.3, 2, 1.2);
  }
  private sPickup(p: Events['pickup'], t: number): void {
    if (!this.gate(18, 0.03)) return; const v = this.vo(false, 1, 0, p.kind === 'hp' ? 0.2 : 0.08); if (!v) return;
    this.pickN = t - this.pickT < 0.5 ? this.pickN + 1 : 0; this.pickT = t;
    if (p.kind === 'ink') { // a drop of ink; a streak of drops climbs
      const f = 320 * (1 + 0.06 * Math.min(this.pickN, 10));
      this.tn(v, 'sine', f, f * 1.9, t, 0.003, 0.07, 0.22, 0.05); this.nz(v, this.white, t, 0.001, 0.02, 0.1, 'lowpass', 900);
    } else if (p.kind === 'hp') {
      this.pl(v, this.hz(0, 2), t, 0.25, 0.35, 1, 0.8); this.pl(v, this.hz(4, 2), t + 0.07, 0.22, 0.45, 1, 0.8);
    } else { // charge back in the cylinder
      this.nz(v, this.white, t, 0.02, 0.03, 0.08, 'bandpass', 2500, 5000, 1.5); this.pl(v, this.hz(4, 3), t + 0.03, 0.12, 0.15, 2, 1);
    }
  }

  // ------------------------------------------------------------------ run flow
  private sRoomStart(p: Events['roomStart'], t: number): void {
    if (Music.knows(p.biome)) this.setBiome(p.biome);
    const v = this.vo(false, 2, 0, 0.2, 0.6); if (!v) return;
    const [f, g] = this.nzRaw(v, this.white, t, t + 0.34, 'bandpass', 900, 0.9); // the sheet is fed in
    f.frequency.exponentialRampToValueAtTime(2600, t + 0.22); g.gain.linearRampToValueAtTime(0.16, t + 0.1); g.gain.setTargetAtTime(0.0001, t + 0.2, 0.03);
    this.sm(v, this.crackle, t, 0.15, 3, 'highpass', 1500);
    this.stamp(v, t + 0.26, 0.7, 66);
  }
  private sRoomClear(p: Events['roomClear'], t: number): void {
    const m = this.mu!, v = this.vo(false, 2, 0, 0.3, 0.7); if (!v) return;
    this.stamp(v, t, 0.8, 70);
    for (let i = 0; i < 4; i++) this.pl(v, this.hz(m.bright(i), 2), t + 0.05 + i * 0.045, 0.2, 0.5 + i * 0.08);
    if (p.flawless) { this.pl(v, this.hz(m.bright(4), 2), t + 0.26, 0.16, 0.8, 3, 0.7); this.tn(v, 'sine', 1245, 1245, t, 0.001, 0.2, 0.05); }
  }
  private sRunStart(p: Events['runStart'], t: number): void {
    const c = this.ctx!; this.mu!.setSeed(p.seed);
    const v = this.vo(false, 3, 0, 0.3, 0.8); if (!v) return;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 620; f.connect(v.out); v.nodes.push(f);
    this.tn(v, 'sawtooth', 38, 118, t, 0.42, 0.12, 0.3, 0.5, f); // the motor spins up
    let tt = t + 0.05; for (let i = 0; i < 7; i++) { this.nz(v, this.white, tt, 0.0005, 0.012, 0.12 + 0.02 * i, 'bandpass', 2400, 2400, 3); tt += 0.1 * Math.pow(0.82, i); }
    this.stamp(v, t + 0.52, 1.05, 60);
    this.sm(v, this.rip[1], t + 0.53, 0.25, 1, 'bandpass', 2800, 0.5);
  }
  private sRunEnd(p: Events['runEnd'], t: number): void {
    const m = this.mu!, v = this.vo(false, 3, 0, 0.35, 0.8); if (!v) return;
    if (p.won) {
      this.stamp(v, t, 1.1, 62);
      for (let i = 0; i < 5; i++) this.pl(v, this.hz(m.bright(i), 2), t + 0.08 + i * 0.07, 0.2, 0.7 + i * 0.1);
      this.nz(v, this.white, t + 0.3, 0.2, 0.5, 0.04, 'highpass', 7000);
    } else {
      this.pl(v, this.hz(4, 1), t, 0.26, 0.7, 1, 0.8); this.pl(v, this.hz(0, 1), t + 0.28, 0.28, 1.1, 1, 0.8);
      this.sm(v, this.crackle, t + 0.1, 0.25, 0.5, 'lowpass', 2400); // the sheet is crumpled
    }
  }
  private sBossPhase(p: Events['bossPhase'], t: number): void {
    const c = this.ctx!, v = this.vo(false, 3, 0, 0.35, 0.9); if (!v) return;
    this.stamp(v, t, 1.15, 52);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(500, t); f.frequency.linearRampToValueAtTime(1300, t + 0.3); f.connect(v.out); v.nodes.push(f);
    const base = this.hz(0, 1) * (1 + 0.03 * Math.min(4, p.phase));
    this.tn(v, 'sawtooth', base, base, t + 0.03, 0.25, 0.5, 0.2, 0.5, f); this.tn(v, 'sawtooth', base * 1.059, base * 1.059, t + 0.03, 0.25, 0.5, 0.17, 0.5, f); // a minor second: wrong register
    for (let i = 0; i < 4; i++) this.nz(v, this.white, t + 0.1 + i * 0.05, 0.0005, 0.012, 0.16, 'bandpass', 2400, 2400, 3);
    this.nz(v, this.brown, t, 0.05, 0.8, 0.4, 'lowpass', 150, 60);
    this.mu!.duck(0.5, 0.5);
  }
}

export const audio: AudioApi = new Engine();
