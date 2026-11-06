// Procedural WebAudio engine for "Белая Мгла". No assets, no dependencies.
// Graph: [ambient layers + one-shot voices] -> master -> ears(lowpass) -> compressor -> destination.

export interface AmbientState {
  wind: number;      // m/s at the player (0..25)
  exposure: number;  // 0..1, 1 = fully outdoors, 0 = closed shelter
  storm: number;     // 0..1
  fire: number;      // 0..1 loudness of nearest fire
  airTemp: number;   // deg C at player
  night: number;     // 0..1
  coreTemp: number;  // player's core temperature, deg C
}

const MAX_VOICES = 24;
const FLOOR = 0.0001;
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
/** Exponential interpolation between a and b. */
const expLerp = (a: number, b: number, k: number): number => a * Math.pow(b / a, clamp01(k));

interface BurstOpts {
  dur: number; peak: number; attack?: number;
  filter?: BiquadFilterType; f0: number; f1?: number; q?: number;
  pink?: boolean; low?: boolean; // low = low priority (dropped first under voice pressure)
}
interface ToneOpts {
  type?: OscillatorType; f0: number; f1?: number; dur: number; peak: number;
  attack?: number; lp?: number;
}
interface Ambient {
  rumbleG: GainNode; hissG: GainNode; hissF: BiquadFilterNode;
  howlG: GainNode; howlF1: BiquadFilterNode; howlF2: BiquadFilterNode;
  shelter: BiquadFilterNode; shelterG: GainNode;
  roarG: GainNode; bedG: GainNode;
}

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ears: BiquadFilterNode | null = null;
  private white!: AudioBuffer;
  private pink!: AudioBuffer;
  private amb: Ambient | null = null;
  private voices = 0;
  private volume = 0.8;
  private muted = false;
  // ambient simulation state
  private acc = 0;
  private gust = 0.5;
  private gustPulse = 0;
  private nextBeat = 0;

  get ready(): boolean {
    return this.ok();
  }

  private ok(): boolean {
    return this.ctx !== null && this.master !== null && this.ctx.state === 'running';
  }

  /** Create the AudioContext (call from a user gesture). Safe to call repeatedly. */
  init(): void {
    try {
      if (this.ctx) {
        if (this.ctx.state !== 'running' && this.ctx.state !== 'closed') void this.ctx.resume().catch(() => {});
        return;
      }
      const g = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
      const AC = g.AudioContext ?? g.webkitAudioContext;
      if (!AC) return;
      const c = new AC();
      this.ctx = c;
      document.addEventListener('visibilitychange', () => {
        const x = this.ctx; if (!x || x.state === 'closed') return;
        if (document.visibilityState === 'hidden') void x.suspend().catch(() => {});
        else void x.resume().catch(() => {});
      });
      this.master = c.createGain();
      this.ears = c.createBiquadFilter();
      this.ears.type = 'lowpass';
      this.ears.Q.value = 0.5;
      this.ears.frequency.value = Math.min(18000, c.sampleRate * 0.45);
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 12;
      comp.ratio.value = 5;
      comp.attack.value = 0.004;
      comp.release.value = 0.2;
      this.master.connect(this.ears);
      this.ears.connect(comp);
      comp.connect(c.destination);
      this.applyVolume();
      this.makeNoise(c);
      this.buildAmbient(c);
      if (c.state !== 'running') void c.resume().catch(() => {});
    } catch {
      this.ctx = null;
      this.master = null;
      this.amb = null;
    }
  }

  setVolume(v: number): void {
    this.volume = clamp01(v);
    this.applyVolume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyVolume();
  }

  private applyVolume(): void {
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume * 0.85, this.ctx.currentTime, 0.04);
  }

  // ---------------------------------------------------------------- noise & plumbing

  private makeNoise(c: AudioContext): void {
    const n = c.sampleRate * 2;
    this.white = c.createBuffer(1, n, c.sampleRate);
    this.pink = c.createBuffer(1, n, c.sampleRate);
    const w = this.white.getChannelData(0);
    const p = this.pink.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const x = Math.random() * 2 - 1;
      w[i] = x;
      // Paul Kellet pink approximation
      b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759;
      b2 = 0.969 * b2 + x * 0.153852; b3 = 0.8665 * b3 + x * 0.3104856;
      b4 = 0.55 * b4 + x * 0.5329522; b5 = -0.7616 * b5 - x * 0.016898;
      p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11;
      b6 = x * 0.115926;
    }
  }

  private take(low = false): boolean {
    if (this.voices >= (low ? MAX_VOICES - 6 : MAX_VOICES)) return false;
    this.voices++;
    return true;
  }

  /** Free a voice and its nodes when the primary source ends. */
  private done(src: AudioScheduledSourceNode, nodes: AudioNode[]): void {
    src.onended = () => {
      for (const n of nodes) { try { n.disconnect(); } catch { /* already gone */ } }
      this.voices--;
    };
  }

  /** Percussive envelope: near-zero -> peak (attack) -> exponential decay. */
  private env(p: AudioParam, t: number, a: number, peak: number, d: number): void {
    p.setValueAtTime(FLOOR, t);
    p.linearRampToValueAtTime(Math.max(FLOOR * 2, peak), t + a);
    p.exponentialRampToValueAtTime(FLOOR, t + a + d);
  }

  private nyq(): number {
    return (this.ctx ? this.ctx.sampleRate : 44100) * 0.45;
  }

  /** Filtered-noise one-shot. */
  private burst(o: BurstOpts, delay = 0): void {
    const c = this.ctx;
    if (!c || !this.master || !this.ok() || !this.take(o.low)) return;
    const a = o.attack ?? 0.005;
    const t = c.currentTime + delay + 0.005;
    const src = c.createBufferSource();
    src.buffer = o.pink ? this.pink : this.white;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = o.filter ?? 'bandpass';
    f.Q.value = o.q ?? 0.8;
    f.frequency.setValueAtTime(Math.min(o.f0, this.nyq()), t);
    if (o.f1 !== undefined) f.frequency.exponentialRampToValueAtTime(Math.min(Math.max(20, o.f1), this.nyq()), t + a + o.dur);
    const g = c.createGain();
    this.env(g.gain, t, a, Math.min(o.peak, 0.6), o.dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    this.done(src, [src, f, g]);
    src.start(t, Math.random() * 1.9);
    src.stop(t + a + o.dur + 0.03);
  }

  /** Oscillator one-shot with optional pitch glide and lowpass. */
  private tone(o: ToneOpts, delay = 0): void {
    const c = this.ctx;
    if (!c || !this.master || !this.ok() || !this.take()) return;
    const a = o.attack ?? 0.005;
    const t = c.currentTime + delay + 0.005;
    const osc = c.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(10, o.f1), t + a + o.dur);
    const g = c.createGain();
    this.env(g.gain, t, a, Math.min(o.peak, 0.6), o.dur);
    const nodes: AudioNode[] = [osc, g];
    osc.connect(g);
    if (o.lp) {
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = o.lp;
      g.connect(lp); lp.connect(this.master); nodes.push(lp);
    } else g.connect(this.master);
    this.done(osc, nodes);
    osc.start(t);
    osc.stop(t + a + o.dur + 0.03);
  }

  /** Random amplitude curve (grainy envelope) for setValueCurveAtTime. */
  private randCurve(n: number, peak: number, decay: number): Float32Array {
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1);
      a[i] = peak * Math.pow(1 - x, decay) * Math.min(1, x * 10) * rnd(0.25, 1);
    }
    return a;
  }

  /** Looping noise voice with its own gain, used by ambient layers. */
  private loopSrc(c: AudioContext, pink: boolean): AudioBufferSourceNode {
    const s = c.createBufferSource();
    s.buffer = pink ? this.pink : this.white;
    s.loop = true;
    s.start(0, Math.random() * 1.9);
    return s;
  }

  // ---------------------------------------------------------------- ambient bed

  private buildAmbient(c: AudioContext): void {
    const m = this.master!;
    const filt = (type: BiquadFilterType, f: number, q: number): BiquadFilterNode => {
      const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b;
    };
    const gain = (v: number): GainNode => { const g = c.createGain(); g.gain.value = v; return g; };

    // Wind: rumble + hiss + howl bands -> shelter lowpass -> shelter gain -> master
    const shelter = filt('lowpass', 6000, 0.6);
    const shelterG = gain(1);
    shelter.connect(shelterG); shelterG.connect(m);
    const rumbleG = gain(0), hissG = gain(0), howlG = gain(0);
    const rumbleF = filt('lowpass', 170, 0.7);
    this.loopSrc(c, true).connect(rumbleF); rumbleF.connect(rumbleG);
    const hissF = filt('bandpass', 1500, 0.5);
    this.loopSrc(c, false).connect(hissF); hissF.connect(hissG);
    const howlF1 = filt('bandpass', 500, 14), howlF2 = filt('bandpass', 760, 10);
    const howlSrc = this.loopSrc(c, false);
    howlSrc.connect(howlF1); howlSrc.connect(howlF2);
    howlF1.connect(howlG); howlF2.connect(howlG);
    rumbleG.connect(shelter); hissG.connect(shelter); howlG.connect(shelter);

    // Fire: low roar + flicker bed (clicks are scheduled in update)
    const roarG = gain(0), bedG = gain(0);
    const roarF = filt('lowpass', 230, 0.7), bedF = filt('bandpass', 1000, 0.4);
    this.loopSrc(c, true).connect(roarF); roarF.connect(roarG); roarG.connect(m);
    this.loopSrc(c, true).connect(bedF); bedF.connect(bedG); bedG.connect(m);

    this.amb = { rumbleG, hissG, hissF, howlG, howlF1, howlF2, shelter, shelterG, roarG, bedG };

  }

  /** Per-frame ambient update; internally throttled to ~20 Hz. */
  update(s: AmbientState, dt: number): void {
    const c = this.ctx, a = this.amb;
    if (!c || !a || !this.ok()) return;
    this.acc += dt;
    if (this.acc < 0.05) return;
    const step = Math.min(this.acc, 0.25);
    this.acc = 0;
    const t = c.currentTime;
    const w = clamp01(s.wind / 25), storm = clamp01(s.storm), fire = clamp01(s.fire);
    const exp = clamp01(s.exposure), night = clamp01(s.night);

    // Gusts: mean-reverting random walk plus occasional sharp pulses.
    this.gust += (0.5 - this.gust) * step * 0.3 + (Math.random() - 0.5) * step * (0.9 + storm * 1.8);
    this.gust = clamp01(this.gust);
    if (Math.random() < step * (0.12 + storm * 0.4)) this.gustPulse = 1;
    this.gustPulse *= Math.exp(-step * 1.2);
    const gf = 0.65 + 0.7 * clamp01(this.gust * 0.7 + this.gustPulse * 0.5);

    // Wind layers
    a.rumbleG.gain.setTargetAtTime((0.03 + 0.3 * Math.pow(w, 1.1)) * gf * (1 + night * 0.2), t, 0.25);
    a.hissG.gain.setTargetAtTime(0.2 * Math.pow(w, 1.6) * gf * (1 - night * 0.2), t, 0.25);
    a.hissF.frequency.setTargetAtTime(700 + 1900 * w * gf * 0.8, t, 0.3);
    const h = Math.sin(t * 0.21) * 0.5 + Math.sin(t * 0.067 + 1.3) * 0.35 + (this.gust - 0.5) * 0.6;
    const hf = 300 * Math.pow(3, clamp01(0.5 + h * 0.5)); // wanders 300..900 Hz
    a.howlF1.frequency.setTargetAtTime(hf, t, 0.35);
    a.howlF2.frequency.setTargetAtTime(hf * 1.51, t, 0.35);
    a.howlG.gain.setTargetAtTime(storm * (0.04 + 0.16 * w) * (0.4 + 0.9 * this.gust + this.gustPulse * 0.4), t, 0.3);

    // Shelter: outdoors 6 kHz open, indoors 350 Hz and quieter
    a.shelter.frequency.setTargetAtTime(expLerp(350, 6000, exp), t, 0.4);
    a.shelterG.gain.setTargetAtTime(0.35 + 0.65 * exp, t, 0.4);

    // Fire bed + Poisson crackle
    a.roarG.gain.setTargetAtTime(0.32 * Math.pow(fire, 1.3), t, 0.3);
    a.bedG.gain.setTargetAtTime(0.14 * fire * rnd(0.75, 1.25), t, 0.12);
    if (fire > 0.01) {
      const n = this.poisson(fire * 16 * step);
      for (let i = 0; i < n; i++) this.crackle(fire);
    }

    // Deep-frost cracking of ice/trees in extreme cold (rare)
    const deep = clamp01((-35 - s.airTemp) / 20);
    if (deep > 0 && Math.random() < step * deep * 0.06) {
      this.tone({ type: 'sine', f0: rnd(500, 800), f1: 120, dur: 0.14, peak: 0.07 });
      this.burst({ dur: 0.08, peak: 0.07, filter: 'bandpass', f0: 1800, f1: 500, q: 1.2, low: true });
    }

    // Hypothermia: muffled ears + slow heartbeat
    const sev = clamp01((35 - s.coreTemp) / 5);
    a.shelter.Q.setTargetAtTime(0.6, t, 1);
    this.ears!.frequency.setTargetAtTime(expLerp(Math.min(18000, this.nyq()), 700, sev), t, 0.8);
    this.nextBeat -= step;
    if (sev > 0.02 && this.nextBeat <= 0) {
      const strength = 0.25 + sev * 0.75;
      this.tone({ f0: 62, f1: 42, dur: 0.14, peak: 0.34 * strength, attack: 0.012 });
      this.tone({ f0: 52, f1: 36, dur: 0.12, peak: 0.24 * strength, attack: 0.012 }, 0.18);
      this.nextBeat = 60 / (68 - sev * 30) * rnd(0.95, 1.08); // ~68 -> ~38 bpm
    } else if (sev <= 0.02) this.nextBeat = 0;
  }

  private poisson(mean: number): number {
    const L = Math.exp(-Math.min(mean, 6));
    let k = 0, p = 1;
    do { k++; p *= Math.random(); } while (p > L && k < 6);
    return k - 1;
  }

  private crackle(fire: number): void {
    const v = rnd(0.04, 0.16) * Math.sqrt(fire);
    this.burst({ dur: rnd(0.006, 0.03), peak: v, filter: Math.random() < 0.5 ? 'highpass' : 'bandpass', f0: rnd(1500, 6000), q: 1.5, low: true });
    if (Math.random() < 0.15) this.tone({ f0: rnd(220, 380), f1: 120, dur: 0.04, peak: v * 0.8 });
  }

  // ---------------------------------------------------------------- footsteps & tools

  footstep(densityKgM3: number, tempC: number, run: boolean, sink: number): void {
    if (!this.ok()) return;
    const powder = clamp01((320 - densityKgM3) / 250);
    const hard = 1 - powder;
    const cold = clamp01((-10 - tempC) / 25);
    const sk = clamp01(sink);
    const dur = (0.07 + sk * 0.2) * (run ? 0.75 : 1) * rnd(0.9, 1.1);
    const vol = (run ? 0.3 : 0.2) * rnd(0.85, 1.1) * (0.7 + 0.3 * sk);
    // soft "fff" body: muffled lowpass for powder, bandpass for packed; deeper = lower
    if (powder > 0.5) this.burst({ dur, attack: 0.015 + sk * 0.03, peak: vol * 0.8, filter: 'lowpass', f0: 1000 - sk * 450, f1: 300, pink: true });
    else this.burst({ dur, attack: 0.01 + sk * 0.02, peak: vol * 0.55, filter: 'bandpass', f0: 1500 - sk * 600, f1: 600 - sk * 200, q: 0.7, pink: true });
    this.tone({ f0: 110 - sk * 40, f1: 45, dur: 0.08 + sk * 0.1, peak: 0.1 * (0.4 + sk) });
    // warm snow crunches: crackle grains
    if (hard > 0.15) {
      const n = Math.round(3 + hard * 6 * (1 - cold * 0.3));
      for (let i = 0; i < n; i++) {
        this.burst({ dur: rnd(0.006, 0.02), peak: vol * 0.5 * hard * rnd(0.4, 1), filter: 'highpass', f0: rnd(1800, 4500), low: true }, rnd(0, dur * 0.9));
      }
    }
    // dry cold snow squeaks: 1-3 kHz squeals, higher when colder
    if (cold > 0.05 && powder < 0.85) {
      const n = 1 + (Math.random() < cold ? 1 : 0) + (Math.random() < cold * 0.5 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const f = (1000 + cold * 1800) * rnd(0.85, 1.2), d = rnd(0.04, 0.11), at = rnd(0, dur * 0.7);
        const amp = 0.05 * cold * hard * (run ? 1.2 : 1);
        this.tone({ f0: f * 0.93, f1: f * rnd(1.0, 1.12), dur: d, peak: amp, attack: 0.01 }, at);
        this.burst({ dur: d, peak: amp * 1.6, f0: f, q: 30, attack: 0.01 }, at);
      }
    }
  }

  dig(hardness: number): void {
    if (!this.ok()) return;
    const h = clamp01(hardness), gv = rnd(0.85, 1.1);
    this.burst({ dur: 0.22 + (1 - h) * 0.2, attack: 0.06, peak: 0.2 * gv, filter: 'bandpass', f0: rnd(350, 450), f1: rnd(1000, 1400), q: 0.6, pink: true });
    this.tone({ f0: 95, f1: 50, dur: 0.1, peak: 0.08 * (0.5 + h) * gv });
    if (h > 0.25) {
      this.burst({ dur: 0.2 + h * 0.15, attack: 0.03, peak: 0.16 * h * gv, f0: rnd(2000, 2400), f1: rnd(3200, 4000), q: 1.5 });
      const n = Math.round(3 + h * 8);
      for (let i = 0; i < n; i++) {
        this.burst({ dur: rnd(0.008, 0.025), peak: 0.1 * h * rnd(0.4, 1), filter: 'highpass', f0: rnd(1500, 4000), low: true }, rnd(0.02, 0.28));
      }
    }
  }

  throwSnow(): void {
    if (!this.ok()) return;
    const gv = rnd(0.85, 1.1);
    this.burst({ dur: 0.22, attack: 0.07, peak: 0.16 * gv, f0: 600, f1: rnd(1800, 2600), q: 0.7, pink: true });
    this.burst({ dur: 0.12, attack: 0.01, peak: 0.12 * gv, filter: 'lowpass', f0: 800, f1: 300, pink: true }, 0.24); // soft "pff"
  }

  /** Saw teeth: band-passed noise with ~70 Hz amplitude modulation. */
  sawStroke(): void {
    const c = this.ctx;
    if (!c || !this.master || !this.ok() || !this.take()) return;
    const t = c.currentTime + 0.01, dur = rnd(0.32, 0.5);
    const src = c.createBufferSource();
    src.buffer = this.white; src.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 2.5;
    const up = Math.random() < 0.5;
    bp.frequency.setValueAtTime(up ? 2200 : 3200, t);
    bp.frequency.linearRampToValueAtTime(up ? 3200 : 2200, t + dur);
    const teeth = c.createGain(); teeth.gain.value = 0.5;
    const lfo = c.createOscillator(); lfo.type = 'triangle'; lfo.frequency.value = rnd(55, 85);
    const depth = c.createGain(); depth.gain.value = 0.5;
    lfo.connect(depth); depth.connect(teeth.gain);
    const g = c.createGain();
    this.env(g.gain, t, 0.05, rnd(0.14, 0.2), dur);
    src.connect(bp); bp.connect(teeth); teeth.connect(g); g.connect(this.master);
    this.done(src, [src, bp, teeth, lfo, depth, g]);
    src.start(t, Math.random() * 1.5); lfo.start(t);
    src.stop(t + dur + 0.08); lfo.stop(t + dur + 0.08);
  }

  chop(wood: boolean): void {
    if (!this.ok()) return;
    const gv = rnd(0.88, 1.1);
    this.burst({ dur: 0.02, peak: 0.15 * gv, filter: 'highpass', f0: 2500 }); // blade tick
    if (wood) {
      const f = rnd(170, 230);
      this.tone({ type: 'triangle', f0: f, f1: f * 0.6, dur: 0.16, peak: 0.32 * gv });
      this.tone({ f0: f * 1.7, f1: f * 1.3, dur: 0.07, peak: 0.12 * gv });
      this.burst({ dur: 0.05, peak: 0.16 * gv, f0: rnd(900, 1300), q: 1.5 });
    } else {
      this.tone({ f0: 100, f1: 50, dur: 0.14, peak: 0.28 * gv });
      this.burst({ dur: 0.1, peak: 0.2 * gv, filter: 'lowpass', f0: 450, f1: 150, pink: true });
    }
  }

  /** Groaning wood: gliding saw through a bandpass, AM-flutter, slow swell. */
  treeCreak(): void {
    const c = this.ctx;
    if (!c || !this.master || !this.ok() || !this.take()) return;
    const t = c.currentTime + 0.02, dur = rnd(1.6, 2.6), f0 = rnd(70, 120);
    const osc = c.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0, t);
    for (let i = 1; i <= 7; i++) osc.frequency.linearRampToValueAtTime(f0 * rnd(0.7, 1.9), t + (dur * i) / 7);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 5;
    bp.frequency.setValueAtTime(rnd(350, 600), t);
    bp.frequency.linearRampToValueAtTime(rnd(500, 900), t + dur);
    const am = c.createGain(); am.gain.value = 0.6;
    const lfo = c.createOscillator(); lfo.type = 'triangle'; lfo.frequency.value = rnd(14, 30);
    const depth = c.createGain(); depth.gain.value = 0.4;
    lfo.connect(depth); depth.connect(am.gain);
    const g = c.createGain();
    this.env(g.gain, t, 0.5, 0.2, dur - 0.5);
    osc.connect(bp); bp.connect(am); am.connect(g); g.connect(this.master);
    this.done(osc, [osc, bp, am, lfo, depth, g]);
    osc.start(t); lfo.start(t);
    osc.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
    this.burst({ dur: dur * 0.8, attack: 0.3, peak: 0.05, f0: 280, q: 1, pink: true });
  }

  thump(massKg: number): void {
    if (!this.ok()) return;
    const m = clamp01(Math.log10(Math.max(1, massKg) + 1) / 3);
    const gv = rnd(0.9, 1.08);
    this.tone({ f0: 115 - 60 * m, f1: 32, dur: 0.25 + m * 0.5, peak: (0.2 + 0.35 * m) * gv, attack: 0.006 });
    this.burst({ dur: 0.15 + m * 0.3, peak: (0.12 + 0.2 * m) * gv, filter: 'lowpass', f0: 450 - 200 * m, f1: 90, pink: true });
  }

  collapse(size: number): void {
    const c = this.ctx;
    const sz = clamp01(size);
    if (!c || !this.master || !this.ok() || !this.take()) return;
    const t = c.currentTime + 0.01, dur = 0.9 + sz * 2.4;
    const src = c.createBufferSource(); src.buffer = this.pink; src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7;
    lp.frequency.setValueAtTime(1100, t);
    lp.frequency.exponentialRampToValueAtTime(140, t + dur);
    const g = c.createGain();
    g.gain.setValueCurveAtTime(this.randCurve(48, 0.18 + 0.3 * sz, 1.2), t, dur);
    src.connect(lp); lp.connect(g); g.connect(this.master);
    this.done(src, [src, lp, g]);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
    this.tone({ f0: 58, f1: 28, dur, peak: 0.1 + 0.2 * sz, attack: 0.15 });
    const n = Math.round(2 + sz * 6);
    for (let i = 0; i < n; i++) {
      this.burst({ dur: rnd(0.15, 0.35), attack: 0.02, peak: 0.1 * rnd(0.6, 1), filter: 'lowpass', f0: rnd(500, 900), f1: 150, pink: true, low: true }, rnd(0, dur * 0.7));
    }
  }

  place(wood: boolean): void {
    if (!this.ok()) return;
    const gv = rnd(0.88, 1.1);
    if (wood) {
      const f = rnd(230, 300);
      this.tone({ type: 'triangle', f0: f, f1: f * 0.62, dur: 0.11, peak: 0.28 * gv });
      this.burst({ dur: 0.04, peak: 0.12 * gv, f0: rnd(800, 1200), q: 1.5 });
    } else {
      this.burst({ dur: 0.1, attack: 0.008, peak: 0.2 * gv, filter: 'lowpass', f0: 750, f1: 250, pink: true });
      this.tone({ f0: 120, f1: 65, dur: 0.08, peak: 0.1 * gv });
    }
  }

  // ---------------------------------------------------------------- fire, items, UI

  ignite(): void {
    if (!this.ok()) return;
    this.burst({ dur: 0.16, attack: 0.1, peak: 0.12, filter: 'highpass', f0: 3000 });              // match scratch
    this.burst({ dur: 0.3, attack: 0.02, peak: 0.1, f0: 2500, f1: 1500, q: 0.6 }, 0.17);          // flare hiss
    this.burst({ dur: 0.55, attack: 0.04, peak: 0.3, filter: 'lowpass', f0: 250, f1: 700, pink: true }, 0.2); // whoomp
    this.tone({ f0: 80, f1: 40, dur: 0.35, peak: 0.22, attack: 0.03 }, 0.2);
  }

  sizzle(): void {
    const c = this.ctx;
    if (!c || !this.master || !this.ok() || !this.take()) return;
    const t = c.currentTime + 0.01, dur = rnd(0.6, 0.9);
    const src = c.createBufferSource(); src.buffer = this.white; src.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = rnd(4500, 6500); bp.Q.value = 0.5;
    const g = c.createGain();
    g.gain.setValueCurveAtTime(this.randCurve(40, 0.14, 1.4), t, dur);
    src.connect(bp); bp.connect(g); g.connect(this.master);
    this.done(src, [src, bp, g]);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
    for (let i = 0; i < 5; i++) this.crackle(0.6);
  }

  crateOpen(): void {
    if (!this.ok()) return;
    this.burst({ dur: 0.3, attack: 0.08, peak: 0.1, f0: 300, f1: 750, q: 5, pink: true });          // hinge creak
    this.tone({ type: 'sawtooth', f0: 130, f1: 210, dur: 0.28, peak: 0.04, attack: 0.08, lp: 700 });
    this.tone({ type: 'triangle', f0: 170, f1: 90, dur: 0.12, peak: 0.26 }, 0.32);                  // lid thunk
    this.burst({ dur: 0.05, peak: 0.12, f0: 1100, q: 1.5 }, 0.32);
  }

  eat(): void {
    if (!this.ok()) return;
    for (let i = 0; i < 3; i++) {
      const at = i * 0.1 + rnd(0, 0.03);
      this.burst({ dur: rnd(0.012, 0.025), peak: rnd(0.1, 0.17), filter: 'highpass', f0: rnd(2000, 4500) }, at);
      this.burst({ dur: 0.06, attack: 0.01, peak: 0.07, filter: 'lowpass', f0: 500, f1: 250, pink: true }, at);
    }
  }

  pickup(): void {
    if (!this.ok()) return;
    this.burst({ dur: 0.09, attack: 0.02, peak: 0.08, f0: rnd(1500, 2200), f1: 2800, q: 0.7, pink: true });
    const f = rnd(500, 560);
    this.tone({ f0: f, f1: f * 1.5, dur: 0.08, peak: 0.07 });
  }

  uiClick(): void {
    if (!this.ok()) return;
    this.tone({ type: 'triangle', f0: 1200, f1: 800, dur: 0.045, peak: 0.1 });
    this.burst({ dur: 0.015, peak: 0.05, filter: 'highpass', f0: 3000 });
  }

  uiDeny(): void {
    if (!this.ok()) return;
    this.tone({ type: 'triangle', f0: 230, f1: 210, dur: 0.1, peak: 0.13, lp: 900 });
    this.tone({ type: 'triangle', f0: 170, f1: 150, dur: 0.14, peak: 0.13, lp: 900 }, 0.1);
  }

  breath(): void {
    if (!this.ok()) return;
    this.burst({ dur: 0.65, attack: 0.18, peak: 0.07 * rnd(0.85, 1.1), f0: rnd(1800, 2300), f1: rnd(800, 1100), q: 0.6, pink: true });
  }

  death(): void {
    if (!this.ok()) return;
    this.tone({ f0: 110, f1: 38, dur: 2.5, peak: 0.34, attack: 0.05, lp: 600 });
    this.burst({ dur: 2.2, attack: 0.1, peak: 0.16, filter: 'lowpass', f0: 500, f1: 70, pink: true });
    this.tone({ f0: 55, f1: 35, dur: 0.2, peak: 0.3 }, 0.5);
    this.tone({ f0: 48, f1: 32, dur: 0.22, peak: 0.24 }, 1.6);
  }

  /** Warm bell-like arpeggio (C major) for surviving the night. */
  dawn(): void {
    if (!this.ok()) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      const at = i * 0.2;
      this.tone({ f0: f, dur: 2.6, peak: 0.075, attack: 0.03 }, at);
      this.tone({ f0: f * 1.004, dur: 2.2, peak: 0.04, attack: 0.03 }, at);
      this.tone({ type: 'triangle', f0: f * 2, dur: 1.2, peak: 0.015, attack: 0.03 }, at);
    });
  }
}
