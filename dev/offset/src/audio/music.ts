// Adaptive generative music. A 16-step sequencer on a lookahead scheduler (tick() is driven by the audio engine's
// timer, never by rAF). The rhythm section is a printing press, not a drum machine: plate thuds, latch clacks,
// ratchet ticks, pneumatic hiss. Layers come in by intensity: hum + rare hits → bass → full press → lead/arp.
import { Rng } from '../core/rng';

export type MusicState = 'menu' | 'hub' | 'run' | 'boss' | 'clear' | 'dead' | 'upgrade';

const DOR = [0, 2, 3, 5, 7, 9, 10], AEO = [0, 2, 3, 5, 7, 8, 10], PHR = [0, 1, 3, 5, 7, 8, 10];
const LYD = [0, 2, 4, 6, 7, 9, 11], HMI = [0, 2, 3, 5, 7, 8, 11], MAJ = [0, 2, 4, 5, 7, 9, 11];

interface Biome { root: number; mode: number[]; bpm: number; kit: number; bright: number; swing: number; fm: number; progs: number[][] }
const BIOMES: Record<string, Biome> = {
  // D dorian, the house sound
  press: { root: 38, mode: DOR, bpm: 112, kit: 1, bright: 9500, swing: 0.1, fm: 2, progs: [[0, 3, 0, 6], [0, 2, 3, 4], [0, 6, 3, 4], [0, 0, 3, 3, 6, 6, 4, 2]] },
  // E aeolian, felted and dusty
  archive: { root: 40, mode: AEO, bpm: 96, kit: 0, bright: 2400, swing: 0.16, fm: 1, progs: [[0, 5, 2, 6], [0, 3, 5, 4], [0, 6, 5, 6, 0, 3, 4, 4]] },
  // C# phrygian, hard and straight
  tower: { root: 37, mode: PHR, bpm: 124, kit: 2, bright: 13000, swing: 0, fm: 3, progs: [[0, 1, 0, 6], [0, 5, 1, 0], [0, 1, 3, 1, 0, 6, 5, 6]] },
};

interface Style {
  key: string; bpm: number; root: number; mode: number[]; progs: number[][]; kit: number; bright: number; swing: number; fm: number;
  /** 0 none (distant hit every other bar), 1 idling press, 2 full press kit */
  rhythm: number;
  iMin: number; iMax: number;
  /** ambient pluck probability per beat; ≥ 0.7 = rising arpeggio (rest states) */
  amb: number;
  padCut: number; padG: number; bassG: number; drumG: number; leadG: number; arpLvl: number; dense: boolean;
}

function styleFor(state: MusicState, biomeId: string): Style {
  const b = BIOMES[biomeId] ?? BIOMES.press;
  const base = { kit: b.kit, swing: b.swing, fm: b.fm, dense: false, arpLvl: 0.92 };
  switch (state) {
    case 'menu':
      return { ...base, key: 'menu', bpm: 60, root: 38, mode: AEO, progs: [[0, 5, 3, 4], [0, 2, 5, 4], [0, 3, 5, 6]], kit: 0, swing: 0, fm: 1, bright: 5200, rhythm: 0, iMin: 0, iMax: 0.15, amb: 0.3, padCut: 520, padG: 1, bassG: 0, drumG: 0.55, leadG: 0.8 };
    case 'hub':
      return { ...base, key: 'hub', bpm: 72, root: 41, mode: DOR, progs: [[0, 3, 0, 6], [0, 2, 3, 0], [0, 6, 3, 4]], kit: 0, swing: 0.12, fm: 1, bright: 6500, rhythm: 1, iMin: 0.34, iMax: 0.44, amb: 0.36, padCut: 600, padG: 0.95, bassG: 0.6, drumG: 0.6, leadG: 0.8 };
    case 'boss':
      return { ...base, key: 'boss:' + biomeId, bpm: Math.round(b.bpm * 1.12), root: b.root, mode: HMI, progs: [[0, 5, 3, 4], [0, 0, 5, 4], [0, 3, 5, 4, 0, 3, 4, 4]], kit: Math.min(2, b.kit + 1), bright: Math.max(b.bright, 7000), rhythm: 2, iMin: 0.66, iMax: 1, amb: 0, padCut: 620, padG: 0.8, bassG: 1.1, drumG: 1.1, leadG: 1, arpLvl: 0.8, dense: true };
    case 'upgrade':
      return { ...base, key: 'upgrade:' + biomeId, bpm: 76, root: b.root + 3, mode: LYD, progs: [[0, 1, 0, 4]], kit: 0, swing: 0, fm: 2, bright: 8000, rhythm: 0, iMin: 0, iMax: 0, amb: 0.75, padCut: 1500, padG: 1.05, bassG: 0, drumG: 0, leadG: 0.9 };
    case 'clear':
      return { ...base, key: 'clear:' + biomeId, bpm: 84, root: b.root + 3, mode: MAJ, progs: [[0, 3, 0, 4]], kit: 0, swing: 0, fm: 2, bright: 9000, rhythm: 0, iMin: 0, iMax: 0, amb: 0.8, padCut: 1700, padG: 1.05, bassG: 0, drumG: 0, leadG: 0.95 };
    default: // run (dead keeps whatever was playing)
      return { ...base, key: 'run:' + biomeId, bpm: b.bpm, root: b.root, mode: b.mode, progs: b.progs, bright: b.bright, rhythm: 2, iMin: 0, iMax: 1, amb: 0, padCut: b.kit === 0 ? 420 : 520, padG: 0.85, bassG: 1, drumG: 1, leadG: 1 };
  }
}

const AHEAD = 0.14;                  // scheduler lookahead, s
const PAD_DET = [-9, 8, -6, 10, -11, 7]; // static cents per pad saw
const CHORD_TONES = [-3, 0, 2, 4, 7, 9];
const CELLS: number[][] = [[0], [0, 2], [2], [0, 3], [1, 3], [0, 2, 3], [0, 1, 2], [], [3], [0, 1, 3]];
const ARP = [0, 2, 4, 7, 4, 2, 9, 4];
const REST_ARP = [0, 4, 7, 9, 11, 9, 7, 4];
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const hashStr = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

export class Music {
  /** music bus output (pre volume) */
  readonly out: GainNode;
  /** reverb send output — the engine routes it into its shared reverb */
  readonly revOut: GainNode;
  /** live transient voices (debug / leak check) */
  voices = 0;

  private c: AudioContext; private noise: AudioBuffer;
  private sum: GainNode; private lp: BiquadFilterNode; private duckG: GainNode;
  private gPad: GainNode; private gBass: GainNode; private gDrum: GainNode; private gLead: GainNode;
  private dIn: GainNode; private dly: DelayNode;
  private padF: BiquadFilterNode; private padOsc: OscillatorNode[] = []; private sub: OscillatorNode;
  private live = new Set<OscillatorNode>();

  private state: MusicState = 'menu'; private biome = 'press';
  private style: Style = styleFor('menu', 'press');
  private dirty = true; private first = true; private dead = false; private muffled = false;
  private seed = 20240607; private sec = 0; private bar = 0; private si = 0; private nextT = 0;
  private iTarget = 0; private I = 0; private eff = 0; private cutNow = 0;
  private cents = 0; private rate = 1;
  private prog: number[] = [0]; private cdeg = 0;
  private thud = new Float32Array(16); private clack = new Float32Array(16); private tick16 = new Float32Array(16);
  private bNote = new Int8Array(16); private bLvl = new Float32Array(16);
  private mOff = new Int8Array(32); private mLen = new Int8Array(32);
  private hissStep = 14;
  private r = new Rng((Date.now() ^ 0x51ed270b) >>> 0);

  constructor(c: AudioContext, noise: AudioBuffer) {
    this.c = c; this.noise = noise; const t = c.currentTime;
    this.out = c.createGain(); this.out.gain.setValueAtTime(0.0001, t); this.out.gain.setTargetAtTime(1, t + 0.05, 0.6);
    this.revOut = c.createGain();
    this.sum = c.createGain();
    this.lp = c.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 5200; this.lp.Q.value = 0.5;
    this.duckG = c.createGain();
    this.sum.connect(this.lp); this.lp.connect(this.duckG); this.duckG.connect(this.out);
    const layer = (g: number) => { const n = c.createGain(); n.gain.value = g; n.connect(this.sum); return n; };
    this.gPad = layer(0); this.gBass = layer(0); this.gDrum = layer(0); this.gLead = layer(0);
    // tempo delay (music only)
    this.dIn = c.createGain(); this.dly = c.createDelay(1.2); this.dly.delayTime.value = 0.4;
    const fb = c.createGain(); fb.gain.value = 0.36; const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 2600;
    const dOut = c.createGain(); dOut.gain.value = 0.42;
    this.dIn.connect(this.dly); this.dly.connect(fl); fl.connect(fb); fb.connect(this.dly); this.dly.connect(dOut); dOut.connect(this.sum);
    // pad: three notes × two detuned saws through a lowpass; frequencies glide between chords (no node churn)
    this.padF = c.createBiquadFilter(); this.padF.type = 'lowpass'; this.padF.frequency.value = 500; this.padF.Q.value = 0.9;
    const padMix = c.createGain(); padMix.gain.value = 0.05; padMix.connect(this.padF); this.padF.connect(this.gPad);
    for (let i = 0; i < 6; i++) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 110; o.detune.value = PAD_DET[i]; o.connect(padMix); o.start(t); this.padOsc.push(o); }
    this.sub = c.createOscillator(); this.sub.type = 'sine'; this.sub.frequency.value = 73.4;
    const subG = c.createGain(); subG.gain.value = 0.11; this.sub.connect(subG); subG.connect(this.gPad); this.sub.start(t);
    const lfo = c.createOscillator(); lfo.frequency.value = 0.07; const lfoG = c.createGain(); lfoG.gain.value = 140; lfo.connect(lfoG); lfoG.connect(this.padF.frequency); lfo.start(t);
    // room tone: the shop's air
    const room = c.createBufferSource(); room.buffer = noise; room.loop = true;
    const rf = c.createBiquadFilter(); rf.type = 'bandpass'; rf.frequency.value = 230; rf.Q.value = 0.5;
    const rg = c.createGain(); rg.gain.value = 0.035; room.connect(rf); rf.connect(rg); rg.connect(this.sum); room.start(t);
    // reverb sends
    const send = (from: AudioNode, g: number) => { const n = c.createGain(); n.gain.value = g; from.connect(n); n.connect(this.revOut); };
    send(this.gPad, 0.3); send(this.gLead, 0.4); send(this.gDrum, 0.1);
    this.nextT = t + 0.1;
  }

  // ------------------------------------------------------------------ control
  setState(s: MusicState): void {
    if (s === this.state) return;
    const now = this.c.currentTime, wasDead = this.dead;
    this.state = s; this.dead = s === 'dead';
    if (this.dead) {
      // tape stop: everything sags an octave and goes dull; the sequencer falls silent
      for (let i = 0; i < 6; i++) { const d = this.padOsc[i].detune; d.cancelScheduledValues(now); d.setValueAtTime(PAD_DET[i] + this.cents, now); d.linearRampToValueAtTime(PAD_DET[i] - 1200, now + 2.4); }
      this.sub.detune.cancelScheduledValues(now); this.sub.detune.setValueAtTime(this.cents, now); this.sub.detune.linearRampToValueAtTime(-1200, now + 2.4);
      for (const o of this.live) o.detune.setTargetAtTime(-1200, now, 0.5);
      this.gBass.gain.setTargetAtTime(0, now, 0.25); this.gDrum.gain.setTargetAtTime(0, now, 0.2); this.gLead.gain.setTargetAtTime(0, now, 0.3);
      this.gPad.gain.setTargetAtTime(this.style.padG * 0.6, now, 0.8);
      this.applyLp(now, 1.0);
      return;
    }
    if (wasDead) this.applyDetune(now, 0.12);
    this.dirty = true;
  }
  setBiome(id: string): void { if (id === this.biome) return; this.biome = id; if (!this.dead) this.dirty = true; }
  setIntensity(v: number): void { this.iTarget = v < 0 ? 0 : v > 1 ? 1 : v; }
  setSeed(n: number): void { this.seed = (n >>> 0) || 1; this.sec = 0; this.bar = 0; }
  /** slow-mo amount 0..1: tape drag — pitch and tempo sink together (the engine's bus lowpass does the dulling) */
  setSlow(k: number, tc: number): void {
    this.cents = -420 * k; this.rate = Math.pow(2, this.cents / 1200);
    if (!this.dead) this.applyDetune(this.c.currentTime, tc);
  }
  /** brief level dip under a big transient (teleport, blast) */
  duck(depth: number, hold: number): void {
    const g = this.duckG.gain, t = this.c.currentTime;
    g.cancelScheduledValues(t); g.setTargetAtTime(depth, t, 0.008); g.setTargetAtTime(1, t + hold, 0.16);
  }
  /** pause: music goes behind a door */
  setMuffled(on: boolean): void { if (on === this.muffled) return; this.muffled = on; this.applyLp(this.c.currentTime, 0.12); }
  /** Hz of a scale step (relative to the tonic of the current key), `up` octaves above the bass root — keeps musical SFX in tune */
  hz(step: number, up: number): number { return hz(this.sc(step) + 12 * up); }
  /** scale step of the current chord root */
  chordStep(): number { return this.cdeg; }
  debug() {
    const e = this.eff, st = this.style;
    return { state: this.state, style: st.key, bpm: st.bpm, bar: this.bar, step: this.si, intensity: this.I, eff: e, cents: this.dead ? -1200 : this.cents, voices: this.voices,
      layers: { hum: true, bass: st.bassG > 0 && e >= 0.3, press: st.rhythm === 2 && e >= 0.6, lead: st.rhythm === 2 && e >= 0.85 } };
  }

  // ------------------------------------------------------------------ scheduler
  /** call every ~25 ms while the context runs */
  tick(): void {
    const now = this.c.currentTime, st = this.style;
    const d = this.iTarget - this.I; this.I += d * (d > 0 ? 0.07 : 0.018);
    this.eff = this.dead ? 0 : st.iMin + (st.iMax - st.iMin) * this.I;
    const cut = st.padCut * (1 + 1.5 * this.eff) * (this.dead ? 0.5 : 1);
    if (Math.abs(cut - this.cutNow) > cut * 0.04) { this.cutNow = cut; this.padF.frequency.setTargetAtTime(cut, now, 0.35); }
    if (this.nextT < now - 0.3) this.nextT = now + 0.05; // timer starved (tab hidden / suspended): resync, do not burst
    let guard = 0;
    while (this.nextT < now + AHEAD && guard++ < 24) { this.step(this.nextT); this.nextT += 15 / (this.style.bpm * this.rate); }
  }

  private applyDetune(now: number, tc: number): void {
    for (let i = 0; i < 6; i++) { const d = this.padOsc[i].detune; d.cancelScheduledValues(now); d.setTargetAtTime(PAD_DET[i] + this.cents, now, tc); }
    this.sub.detune.cancelScheduledValues(now); this.sub.detune.setTargetAtTime(this.cents, now, tc);
    for (const o of this.live) o.detune.setTargetAtTime(this.cents, now, tc);
  }
  private applyLp(now: number, tc: number): void {
    const f = this.dead ? 240 : this.muffled ? 480 : this.style.bright;
    this.lp.frequency.cancelScheduledValues(now); this.lp.frequency.setTargetAtTime(f, now, tc);
  }
  private applyStyle(t: number): void {
    const st = styleFor(this.state, this.biome); this.dirty = false;
    if (st.key === this.style.key && !this.first) return;
    this.style = st; this.first = false; this.si = 0; this.bar = 0; this.sec = 0;
    const tc = 0.35; // ≈ 1 s crossfade
    this.gPad.gain.setTargetAtTime(st.padG, t, tc); this.gBass.gain.setTargetAtTime(st.bassG * 0.5, t, tc);
    this.gDrum.gain.setTargetAtTime(st.drumG * 0.6, t, st.drumG > 0 ? tc : 0.12); this.gLead.gain.setTargetAtTime(st.leadG * 0.42, t, tc);
    this.dly.delayTime.setTargetAtTime(Math.min(1.1, 45 / st.bpm), t, 0.25);
    this.applyLp(t, 0.4);
  }

  private sc(step: number): number {
    const st = this.style, o = Math.floor(step / 7);
    return st.root + 12 * o + st.mode[step - o * 7];
  }

  private newSection(): void {
    const st = this.style, form = this.sec & 3, era = this.sec >> 3;
    const salt = form === 2 ? 7919 + this.sec : era * 104729;
    const r = new Rng((this.seed ^ hashStr(st.key) ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0);
    this.prog = st.progs[((this.seed & 15) + era + (form === 2 ? 1 + (this.sec >> 2) : 0)) % st.progs.length];
    const k = st.kit, th = this.thud, cl = this.clack, tk = this.tick16;
    th.fill(-1); cl.fill(-1); tk.fill(-1); this.bNote.fill(0); this.mLen.fill(0);
    // --- the press: plate on 1 (always), second stroke, syncopated strokes join as it heats up
    th[0] = 0;
    if (k === 2) { th[8] = 0.2; th[r.pick([6, 10, 11])] = 0.52; th[r.pick([3, 14])] = 0.76; }
    else if (k === 1) { th[8] = 0.22; th[r.pick([6, 10, 11, 14])] = 0.57; if (r.chance(0.5)) th[r.pick([3, 7, 13])] = 0.84; }
    else { th[r.pick([8, 10])] = 0.3; if (r.chance(0.5)) th[r.pick([6, 14])] = 0.76; }
    cl[4] = 0.5; cl[12] = 0.47; cl[r.pick([7, 9, 15])] = 0.6; if (k === 2) cl[r.pick([2, 10, 14])] = 0.72;
    for (let i = 0; i < 16; i++) {
      if ((i & 1) === 0) tk[i] = (i & 3) === 2 ? 0.36 : 0.42;
      else if (r.chance(k === 0 ? 0.35 : 0.75)) tk[i] = 0.54 + r.next() * 0.06;
    }
    this.hissStep = r.pick([14, 15, 6]);
    // --- bass
    for (let i = 0; i < 16; i++) {
      const strong = (i & 3) === 0, mid = (i & 3) === 2; let n = 0, l = 0;
      if (i === 0) { n = 1; l = 0.3; }
      else if (strong) { if (r.chance(0.8)) { n = r.chance(0.75) ? 1 : 3; l = i === 8 ? 0.36 : 0.5; } }
      else if (mid) { if (r.chance(k === 0 ? 0.35 : 0.55)) { n = r.pick([2, 3, 1, 4]); l = 0.55; } }
      else if (r.chance(k === 2 ? 0.45 : k === 1 ? 0.28 : 0.1)) { n = r.pick([1, 2, 4, 1]); l = 0.74; }
      if (st.dense && n === 0) { n = (i & 1) && r.chance(0.3) ? 2 : 1; l = 0.6; }
      this.bNote[i] = n; this.bLvl[i] = l;
    }
    // --- lead motif: two bars of scale-step offsets from the chord root; it follows the harmony by itself
    let pos = r.pick([0, 2, 4]); let lastIdx = -1;
    const sparse = k === 0;
    for (let beat = 0; beat < 8; beat++) {
      let cell = CELLS[r.int(0, CELLS.length - 1)];
      if (beat === 0 && cell.length === 0) cell = CELLS[0];
      if (sparse && cell.length > 2) cell = CELLS[r.int(0, 3)];
      for (const s of cell) {
        const idx = beat * 4 + s;
        if (s === 0) { pos += r.int(-1, 1); let best = 0, bd = 99; for (const ct of CHORD_TONES) { const dd = Math.abs(ct - pos); if (dd < bd) { bd = dd; best = ct; } } pos = best; }
        else pos += r.pick([-2, -1, -1, 1, 1, 2]);
        if (pos < -3) pos = -3 + r.int(0, 2); if (pos > 9) pos = 9 - r.int(0, 2);
        this.mOff[idx] = pos; this.mLen[idx] = r.chance(0.3) ? 2 : 1; lastIdx = idx;
      }
    }
    if (lastIdx >= 0) { const p = this.mOff[lastIdx]; this.mOff[lastIdx] = p >= 6 ? 7 : p >= 2 ? 4 : 0; this.mLen[lastIdx] = 3; }
    if (form === 1 || form === 3) { // A′: same idea, two details moved
      const m = new Rng((this.seed + this.sec * 31) >>> 0);
      for (let n = 0; n < 2; n++) { const i = m.int(0, 31); if (this.mLen[i]) this.mOff[i] += m.pick([-1, 1, 2]); else if (m.chance(0.5)) { this.mOff[i] = m.pick([0, 2, 4, 7]); this.mLen[i] = 1; } }
      const j = 1 + 2 * m.int(0, 7); tk[j] = tk[j] < 0 ? 0.58 : -1;
    }
  }

  private barStart(t: number): void {
    const st = this.style;
    if ((this.bar & 7) === 0) { this.newSection(); this.sec++; }
    let deg = this.prog[this.bar % this.prog.length];
    if (deg !== 0 && this.r.chance(0.18)) { // colour substitution: a third below, if it is a stable triad
      const alt = (deg + 5) % 7; if ((st.mode[(alt + 4) % 7] - st.mode[alt] + 12) % 12 === 7) deg = alt;
    }
    this.cdeg = deg;
    const glide = this.bar === 0 ? 0.3 : 0.11, lo = st.root + 16, seventh = this.r.chance(0.3);
    for (let v = 0; v < 3; v++) {
      const m0 = this.sc(deg + (v === 2 && seventh ? 6 : 2 * v)), m = lo + (((m0 - lo) % 12) + 12) % 12, f = hz(m);
      this.padOsc[2 * v].frequency.setTargetAtTime(f, t, glide); this.padOsc[2 * v + 1].frequency.setTargetAtTime(f * (v === 0 ? 0.5 : 1), t, glide);
    }
    const sl = st.root - 5, sm = sl + (((this.sc(deg) - sl) % 12) + 12) % 12;
    this.sub.frequency.setTargetAtTime(hz(sm), t, glide);
  }

  private step(t: number): void {
    let i = this.si;
    if (this.dirty && !this.dead) {
      const rhythmic = this.style.rhythm === 2 && (this.state === 'run' || this.state === 'boss');
      if (this.first || (rhythmic ? i === 0 : (i & 3) === 0)) { this.applyStyle(t); i = this.si; }
    }
    const st = this.style;
    if (i === 0) this.barStart(t);
    if (!this.dead) {
      const e = this.eff, sd = 15 / (st.bpm * this.rate), ts = (i & 1) ? t + st.swing * sd : t, k = st.kit;
      const vel = (lvl: number) => { const v = (e - lvl) / 0.08 + 1; return v <= 0 ? 0 : v > 1 ? 1 : v; };
      // ---------------- press kit
      if (st.rhythm === 2) {
        let lv = this.thud[i], v = 0;
        if (lv >= 0 && (v = vel(lv)) > 0.03 && !(i === 0 && e < 0.12 && (this.bar & 1))) this.kThud(ts, v * (i === 0 ? 1 : 0.8), k);
        lv = this.clack[i]; if (lv >= 0 && (v = vel(lv)) > 0.03) this.kClack(ts, v * (lv > 0.55 ? 0.55 : 1), k);
        lv = this.tick16[i]; if (lv >= 0 && (v = vel(lv)) > 0.03) this.kTick(ts, v * ((i & 3) === 2 ? 1 : 0.6), k);
        if (i === this.hissStep && (this.bar & 1) && (v = vel(0.5)) > 0.03) this.kHiss(ts, v);
        if ((this.bar & 3) === 3 && i >= 12 && (v = vel(0.62)) > 0.03) { // ratchet fill into the next phrase
          const a = (i - 11) / 4; this.kTick(ts + sd * 0.5, v * a, k); if (i === 14) this.kThud(ts, v * 0.7, k);
        }
      } else if (st.rhythm === 1) { // idling press in the hub
        if (i === 0) this.kThud(ts, 0.5, 0);
        if ((i & 3) === 0) this.kTick(ts, i === 0 ? 0.45 : 0.8, 0);
        if (i === 8 && (this.bar & 1)) this.kHiss(ts, 0.55);
      } else if (st.drumG > 0 && i === 0 && (this.bar & 1) === 0) this.kThud(ts, 0.45, 0); // somewhere, far away, a press
      // ---------------- bass
      const bn = this.bNote[i];
      if (bn && st.bassG > 0) {
        const v = vel(this.bLvl[i]);
        if (v > 0.03) {
          const bl = st.root - 3, root = bl + (((this.sc(this.cdeg) - bl) % 12) + 12) % 12;
          const m = bn === 1 ? root : bn === 2 ? root + 12 : bn === 3 ? root + 7 : root + (this.sc(this.cdeg + 6) - this.sc(this.cdeg + 7));
          let len = 1; while (len < 3 && !this.bNote[(i + len) & 15]) len++;
          this.nBass(ts, hz(m), v * (i === 0 ? 1 : 0.82), sd * (len + 0.4), k);
        }
      }
      // ---------------- lead / arp
      if (st.rhythm === 2) {
        const ps = ((this.bar & 1) << 4) + i, ln = this.mLen[ps], v = vel(0.85);
        if (ln && v > 0.03) this.nPluck(ts, hz(this.fold(this.sc(this.cdeg + this.mOff[ps]) + 24)), v * ((i & 3) === 0 ? 0.9 : 0.7), 0.16 + ln * sd * 1.1, 0.4);
        else if (!ln && (k !== 0 || (i & 1) === 0)) { const va = vel(st.arpLvl + 0.03); if (va > 0.03) this.nPluck(ts, hz(this.fold(this.sc(this.cdeg + ARP[(i + this.bar * 3) & 7]) + 36)), va * 0.36, 0.14, 0.25); }
      }
      // ---------------- ambient plucks (menu / hub) and the bright rest arpeggio (clear / upgrade)
      if (st.amb >= 0.7) {
        if ((i & 1) === 0 && this.r.chance(st.amb)) this.nPluck(ts, hz(this.sc(this.cdeg + REST_ARP[(i >> 1) & 7]) + 24), (i & 3) === 0 ? 0.55 : 0.4, 0.9, 0.5);
      } else if (st.amb > 0 && (i & 3) === 0 && this.r.chance(st.amb)) {
        this.nPluck(ts, hz(this.fold(this.sc(this.cdeg + this.r.pick(CHORD_TONES) + (this.r.chance(0.3) ? 1 : 0)) + 24)), 0.3 + this.r.next() * 0.3, 1.3, 0.6);
      }
    }
    this.si = (i + 1) & 15; if (this.si === 0) this.bar++;
  }
  /** keep the lead in a singable two octaves */
  private fold(m: number): number { const lo = this.style.root + 19; while (m > lo + 24) m -= 12; while (m < lo) m += 12; return m; }

  // ------------------------------------------------------------------ voices
  private fin(src: AudioScheduledSourceNode, a: AudioNode, b?: AudioNode, o2?: OscillatorNode, c?: AudioNode): void {
    this.voices++;
    src.onended = () => { this.voices--; src.disconnect(); a.disconnect(); if (b) b.disconnect(); if (c) c.disconnect(); if (o2) { o2.disconnect(); this.live.delete(o2); } this.live.delete(src as OscillatorNode); };
  }
  private nz(t: number, a: number, d: number, pk: number, type: BiquadFilterType, f0: number, f1: number, q: number, dest: AudioNode): void {
    const c = this.c, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; s.loop = true; f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + a + d);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(pk, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t, Math.random() * 1.2); s.stop(t + a + d + 0.02); this.fin(s, f, g);
  }
  private osc(t: number, type: OscillatorType, f0: number, f1: number, ft: number, a: number, d: number, pk: number, dest: AudioNode): void {
    const c = this.c, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + ft);
    o.detune.value = this.cents;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(pk, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + a + d + 0.02); this.live.add(o); this.fin(o, g);
  }
  /** press plate coming down */
  private kThud(t: number, v: number, k: number): void {
    this.osc(t, 'sine', k === 2 ? 156 : 124, 45, 0.07, 0.002, k === 0 ? 0.26 : 0.2, v * 0.95, this.gDrum);
    this.nz(t, 0.001, 0.045, v * 0.5, 'lowpass', k === 0 ? 280 : 520 + 420 * k, 200, 0.7, this.gDrum);
  }
  /** latch / type bar */
  private kClack(t: number, v: number, k: number): void {
    this.nz(t, 0.0008, k === 0 ? 0.03 : 0.05, v * 0.55, 'bandpass', 1500 + 520 * k, 1100 + 300 * k, 1.4, this.gDrum);
    if (k > 0) this.osc(t, 'triangle', k === 2 ? 1873 : 1240, k === 2 ? 1700 : 1180, 0.03, 0.0008, 0.035, v * 0.13, this.gDrum);
  }
  /** feed ratchet */
  private kTick(t: number, v: number, k: number): void {
    if (k === 0) this.nz(t, 0.0006, 0.016, v * 0.2, 'bandpass', 3900, 3900, 2, this.gDrum);
    else this.nz(t, 0.0005, 0.013 + 0.004 * k, v * 0.2, 'highpass', 6200, 6200, 0.7, this.gDrum);
  }
  /** pneumatic release */
  private kHiss(t: number, v: number): void { this.nz(t, 0.012, 0.17, v * 0.13, 'bandpass', 5200, 1400, 1.2, this.gDrum); }
  /** warm, slightly out-of-tune analogue bass */
  private nBass(t: number, f: number, v: number, dur: number, k: number): void {
    const c = this.c, o1 = c.createOscillator(), o2 = c.createOscillator(), fl = c.createBiquadFilter(), g = c.createGain();
    o1.type = 'sawtooth'; o2.type = k === 2 ? 'square' : 'sawtooth'; o1.frequency.value = f; o2.frequency.value = f * 1.006; o1.detune.value = this.cents - 5; o2.detune.value = this.cents + 4;
    fl.type = 'lowpass'; fl.Q.value = k === 2 ? 5 : 3; const top = (k === 0 ? 420 : k === 1 ? 760 : 1150) * (0.7 + 0.5 * v);
    fl.frequency.setValueAtTime(top, t); fl.frequency.exponentialRampToValueAtTime(130, t + dur);
    const pk = v * (k === 2 ? 0.34 : 0.42);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(pk, t + 0.006); g.gain.setTargetAtTime(pk * 0.6, t + 0.006, 0.06); g.gain.setTargetAtTime(0.0001, t + dur * 0.75, dur * 0.09 + 0.008);
    o1.connect(fl); o2.connect(fl); fl.connect(g); g.connect(this.gBass);
    const end = t + dur + 0.08; o1.start(t); o2.start(t); o1.stop(end); o2.stop(end);
    this.live.add(o1); this.live.add(o2); this.fin(o1, fl, g, o2);
  }
  /** FM pluck: the melodic "jab" */
  private nPluck(t: number, f: number, v: number, d: number, dsend: number): void {
    const c = this.c, st = this.style, car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain(), g = c.createGain();
    car.frequency.value = f; mod.frequency.value = f * (st.fm === 3 ? 3.01 : st.fm === 2 ? 2 : 1.003); car.detune.value = mod.detune.value = this.cents;
    const idx = st.fm === 3 ? 2.3 : st.fm === 2 ? 1.5 : 0.9;
    mg.gain.setValueAtTime(f * idx * (0.6 + 0.6 * v), t); mg.gain.exponentialRampToValueAtTime(f * 0.03, t + Math.min(0.2, d * 0.6));
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * 0.5, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    mod.connect(mg); mg.connect(car.frequency); car.connect(g); g.connect(this.gLead);
    let s: GainNode | undefined; if (dsend > 0) { s = c.createGain(); s.gain.value = dsend; g.connect(s); s.connect(this.dIn); }
    const end = t + d + 0.02; car.start(t); mod.start(t); car.stop(end); mod.stop(end);
    this.live.add(car); this.live.add(mod); this.fin(car, mg, g, mod, s);
  }
}
