// File-based Web Audio. Samples live in public/sfx/*.ogg (+ .mp3 fallback for Safari). The shipped files are
// PLACEHOLDERS (collision sounds: scripts/make-impacts.mjs, the rest: scripts/make-sfx.sh); see docs/AUDIO.md.
//
// Graph:  engine / skid / scrape loops -> loopBus (ducked by impacts) -> sfxGain \
//         impact voices -> impactBus -> compressor ----------------------> sfxGain -> masterGain -> destination
//         music -> musicGain -> musicDuck (ducked by impacts) -----------------------> masterGain
// The AudioContext is created lazily and unlocked by the first pointerdown / keydown / touchend.
// Every public method is safe to call before unlock or when Web Audio is missing (silent no-op).
import { CONFIG } from '../config';
import type { CarState, SimEvent } from '../types';

/** Collision sound families: each has N variations `<family>_1..N` in public/sfx (picked at random, never the same twice in a row). */
const FAMILIES = {
  impact_light: 3, impact_heavy: 3, impact_wood: 3, impact_metal: 3, impact_concrete: 2, impact_plastic: 3, crunch: 2, debris: 2,
} as const;
type Family = keyof typeof FAMILIES;
/** Target RMS (linear, first 0.3 s) per family. Buffers are trimmed to it at load so replacing a file with a louder/quieter
 *  recording does not unbalance the mix. */
const FAMILY_RMS: Record<Family, number> = {
  impact_light: 0.11, impact_heavy: 0.2, impact_wood: 0.16, impact_metal: 0.16, impact_concrete: 0.19, impact_plastic: 0.126, crunch: 0.09, debris: 0.07,
};
type Plain = 'click' | 'buy' | 'error' | 'countdown' | 'go' | 'finish';
type OneShot = Plain | Family;
type Loop = 'engine' | 'skid' | 'music' | 'scrape';

const PLAIN: Plain[] = ['click', 'buy', 'error', 'countdown', 'go', 'finish'];
const LOOPS: Loop[] = ['engine', 'skid', 'music', 'scrape'];
const FAMILY_NAMES = Object.keys(FAMILIES) as Family[];
const SAMPLE_FILES: string[] = [
  ...LOOPS, ...PLAIN,
  ...FAMILY_NAMES.flatMap((f) => Array.from({ length: FAMILIES[f] }, (_, i) => `${f}_${i + 1}`)),
];

/** Collision mix tuning (kept here, not in CONFIG: pure audio taste). */
const MIX = {
  impactVoices: 6,        // simultaneous impact-bus voices; a louder hit steals the quietest one when full
  bucketMax: 1.7,         // leaky "energy" bucket: pile-ups of hits are thinned out instead of becoming noise
  bucketDecay: 3.2,       // per second
  sameKeyInterval: 0.11,  // s between hits of the same material
  aiVolume: 0.6,          // AI-car hits relative to the player's
  duckLoops: 0.45,        // max reduction of engine/skid under a big hit
  duckMusic: 0.35,
  scrapeGain: 0.5,
  scrapeWindow: 0.22,     // s a scrape event keeps the loop alive (events arrive every ~0.06 s)
};

const A = CONFIG.audio;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (a: number, b: number, v: number): number => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

type Ctx = AudioContext;

function pickExt(): 'ogg' | 'mp3' {
  try {
    const a = document.createElement('audio');
    if (a.canPlayType('audio/ogg; codecs="vorbis"')) return 'ogg';
  } catch { /* ignore */ }
  return 'mp3';
}

export class AudioManager {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private trim = new Map<string, number>();                       // per-sample loudness normalisation gain
  private loopBus: GainNode | null = null;
  private impactBus: GainNode | null = null;
  private musicDuck: GainNode | null = null;
  private impactVoices: { g: GainNode; src: AudioBufferSourceNode; vol: number }[] = [];
  private bucket = 0;
  private lastVariant: Partial<Record<Family, number>> = {};
  private scrape: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private scrapeLevel = 0; private scrapeUntil = -1; private scrapeRate = 1;
  private loading: Promise<void> | null = null;

  private engine: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private skid: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private music: AudioBufferSourceNode | null = null;

  private muted = false;
  private hardPaused = false;   // platform pause / ad / tab hidden: context suspended
  private softPaused = false;   // in-game pause menu: loops silent, UI sounds and music (ducked) continue
  private hidden = false;
  private unlocked = false;
  private musicWanted = true;

  private voices = 0;
  private lastPlay: Record<string, number> = {};
  private clock = 0;
  private px = 0; private py = 0; private haveListener = false;
  private ext: 'ogg' | 'mp3' = 'ogg';

  constructor() {
    if (typeof window === 'undefined') return;
    const unlock = (): void => this.unlock();
    // Capture phase so it works even when UI elements stop propagation.
    for (const ev of ['pointerdown', 'keydown', 'touchend', 'click'] as const) window.addEventListener(ev, unlock, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => {
      this.hidden = document.hidden;
      this.applySuspend();
    });
  }

  // ---------------------------------------------------------------- lifecycle

  /** Create/resume the AudioContext. Must run inside a user gesture the first time. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext });
        const Ctor = AC.AudioContext ?? AC.webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor({ latencyHint: 'interactive' });
        this.master = this.ctx.createGain();
        this.musicGain = this.ctx.createGain();
        this.sfxGain = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : A.master;
        this.musicGain.gain.value = A.music;
        this.sfxGain.gain.value = A.sfx;
        this.musicDuck = this.ctx.createGain();
        this.loopBus = this.ctx.createGain();
        this.impactBus = this.ctx.createGain();
        const comp = this.ctx.createDynamicsCompressor();   // glue + safety for stacked impacts
        comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 5; comp.attack.value = 0.002; comp.release.value = 0.14;
        this.musicGain.connect(this.musicDuck); this.musicDuck.connect(this.master);
        this.loopBus.connect(this.sfxGain);
        this.impactBus.connect(comp); comp.connect(this.sfxGain);
        this.sfxGain.connect(this.master);
        this.master.connect(this.ctx.destination);
        this.ext = pickExt();
        this.loading = this.loadAll();
      }
      if (this.ctx.state === 'suspended' && !this.hardPaused && !this.hidden) void this.ctx.resume();
      this.unlocked = true;
      void this.loading?.then(() => this.startLoops());
    } catch (e) {
      console.warn('[audio] unlock failed', e);
    }
  }

  private async loadAll(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './';
    await Promise.all(SAMPLE_FILES.map(async (n) => {
      try {
        const res = await fetch(`${base}sfx/${n}.${this.ext}`);
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.arrayBuffer();
        const buf = await new Promise<AudioBuffer>((resolve, reject) => ctx.decodeAudioData(data, resolve, reject));
        this.buffers.set(n, buf);
        this.trim.set(n, this.measureTrim(n, buf));
      } catch (e) {
        console.warn('[audio] failed to load', n, e);
      }
    }));
  }

  /** Gain that brings a collision sample to its family's target RMS without clipping (1 for non-collision samples). */
  private measureTrim(name: string, buf: AudioBuffer): number {
    const fam = name.replace(/_\d+$/, '') as Family;
    const target = FAMILY_RMS[fam];
    if (!target) return 1;
    const d = buf.getChannelData(0), n = Math.min(d.length, Math.round(buf.sampleRate * 0.3));
    let e = 0, pk = 0;
    for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
    for (let i = 0; i < n; i++) e += d[i] * d[i];
    const rms = Math.sqrt(e / Math.max(1, n));
    if (rms < 1e-5 || pk < 1e-5) return 1;
    return Math.max(0.4, Math.min(2.2, Math.min(target / rms, 0.9 / pk)));
  }

  private startLoops(): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxGain || !this.musicGain) return;
    if (!this.engine && this.buffers.has('engine')) {
      const src = ctx.createBufferSource();
      src.buffer = this.buffers.get('engine')!;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 800;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter); filter.connect(gain); gain.connect(this.loopBus!);
      src.start();
      this.engine = { src, gain, filter };
    }
    if (!this.skid && this.buffers.has('skid')) {
      const src = ctx.createBufferSource();
      src.buffer = this.buffers.get('skid')!;
      src.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain); gain.connect(this.loopBus!);
      src.start();
      this.skid = { src, gain };
    }
    if (!this.scrape && this.buffers.has('scrape')) {
      const src = ctx.createBufferSource();
      src.buffer = this.buffers.get('scrape')!;
      src.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain); gain.connect(this.loopBus!);   // not ducked-sensitive: loopBus ducks it together with engine/skid
      src.start();
      this.scrape = { src, gain };
    }
    if (!this.music && this.buffers.has('music')) {
      const src = ctx.createBufferSource();
      src.buffer = this.buffers.get('music')!;
      src.loop = true;
      src.connect(this.musicGain);
      src.start();
      this.music = src;
    }
  }

  // ---------------------------------------------------------------- state

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : A.master, this.ctx.currentTime, 0.03);
  }

  /** Hard pause (platform pause event, ad open, tab hidden): suspends the whole context = total silence. */
  setPaused(p: boolean): void {
    this.hardPaused = p;
    this.applySuspend();
  }

  /** Soft pause (in-game pause menu): engine / skid silent, music ducked, UI sounds still play. */
  setGameplayPaused(p: boolean): void {
    this.softPaused = p;
    if (this.musicGain && this.ctx) this.musicGain.gain.setTargetAtTime(p ? A.music * 0.45 : A.music, this.ctx.currentTime, 0.1);
    if (p) this.silenceLoops();
  }

  /** Music on/off independently (e.g. during an ad break if the platform requires). */
  setMusic(on: boolean): void {
    this.musicWanted = on;
    if (this.musicGain && this.ctx) this.musicGain.gain.setTargetAtTime(on ? (this.softPaused ? A.music * 0.45 : A.music) : 0, this.ctx.currentTime, 0.05);
  }

  private applySuspend(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      if (this.hardPaused || this.hidden) void ctx.suspend();
      else if (this.unlocked) void ctx.resume();
    } catch { /* ignore */ }
  }

  private silenceLoops(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.engine?.gain.gain.setTargetAtTime(0, t, 0.05);
    this.skid?.gain.gain.setTargetAtTime(0, t, 0.05);
    this.scrape?.gain.gain.setTargetAtTime(0, t, 0.05);
  }

  // ---------------------------------------------------------------- per frame

  /** Drive the engine and skid loops from the player's car. Call every rendered frame (also with null in menus). */
  update(player: CarState | null, dt: number): void {
    this.clock += dt;
    this.bucket = Math.max(0, this.bucket - MIX.bucketDecay * dt);
    const ctx = this.ctx;
    if (!ctx || !this.unlocked) return;
    if (!player || this.softPaused || this.hardPaused) {
      this.silenceLoops();
      this.haveListener = !!player;
      if (player) { this.px = player.x; this.py = player.y; }
      return;
    }
    this.px = player.x; this.py = player.y; this.haveListener = true;
    const t = ctx.currentTime;
    const k = A.smoothing;

    if (this.engine) {
      const rpm = clamp01(player.rpm);
      const rate = lerp(A.engineRateMin, A.engineRateMax, rpm);
      // load: engine is louder under throttle; wrecked car sounds weaker/rougher (lower)
      const load = 0.4 + 0.6 * clamp01(player.throttle);
      const damage = player.wrecked ? 0.7 : 1;
      this.engine.src.playbackRate.setTargetAtTime(rate * (player.wrecked ? 0.9 : 1), t, k);
      this.engine.gain.gain.setTargetAtTime(A.engineGain * load * damage, t, k);
      this.engine.filter.frequency.setTargetAtTime(600 + 5200 * (0.25 + 0.75 * rpm) * (0.5 + 0.5 * clamp01(player.throttle) + 0.1), t, k);
    }
    if (this.scrape) {
      // quiet wall-scrape loop instead of a stream of impacts; fades out shortly after the last scrape event
      const on = this.clock < this.scrapeUntil;
      this.scrape.gain.gain.setTargetAtTime(on ? this.scrapeLevel * MIX.scrapeGain : 0, t, on ? 0.04 : 0.08);
      this.scrape.src.playbackRate.setTargetAtTime(this.scrapeRate, t, 0.1);
    }
    if (this.skid) {
      const s = smooth(0.25, 0.85, player.slip) * (Math.abs(player.speed) > 3 ? 1 : 0);
      this.skid.gain.gain.setTargetAtTime(s * A.skidGain, t, k);
      this.skid.src.playbackRate.setTargetAtTime(lerp(A.skidRateMin, A.skidRateMax, clamp01(Math.abs(player.speed) / CONFIG.car.baseTopSpeed)), t, k);
    }
  }

  // ---------------------------------------------------------------- events

  onEvents(events: SimEvent[], playerId: number): void {
    if (!this.ctx || !this.unlocked || this.hardPaused) return;
    for (const e of events) {
      switch (e.type) {
        case 'impact':
          this.onImpact(e.x, e.y, e.strength, e.carId === playerId, e.other);
          break;
        case 'scrape': {
          const own = e.carId === playerId;
          const vol = this.near(e.x, e.y) * (own ? 1 : 0.4) * clamp01(e.strength * 1.4);
          if (vol > 0.03) {
            this.scrapeLevel = this.clock < this.scrapeUntil ? Math.max(vol, this.scrapeLevel * 0.8) : vol;
            this.scrapeUntil = this.clock + MIX.scrapeWindow;
            this.scrapeRate = 0.9 + 0.3 * clamp01(e.strength);
          }
          break;
        }
        case 'break': {
          const vol = this.near(e.x, e.y);
          if (vol <= 0.03 || !this.gate('break', A.breakMinInterval)) break;
          if (e.kind === 'prop') {
            this.hit(propFamily(e.propType, this.pick2()), vol * 0.75, 0.95 + Math.random() * 0.2, vol);
            this.hit('debris', vol * 0.7, 0.9 + Math.random() * 0.3, vol);
          } else if (e.kind === 'road') {
            this.hit('impact_concrete', vol * 0.8, 0.75, vol); this.hit('debris', vol * 0.7, 0.8, vol);
          } else {
            this.hit(e.kind === 'guardrail' ? 'impact_metal' : 'impact_concrete', vol * 0.7, 0.9, vol);
            this.hit('crunch', vol * 0.85, 0.9 + Math.random() * 0.2, vol); this.hit('debris', vol * 0.6, 1, vol);
          }
          this.duck(vol * 0.5);
          break;
        }
        case 'partOff': {
          const vol = this.near(e.x, e.y);
          if (vol > 0.03 && this.gate('part', 0.1)) { this.hit('crunch', vol * 0.8, 1.05 + Math.random() * 0.2, vol); this.hit('impact_plastic', vol * 0.4, 0.9, vol); }
          break;
        }
        case 'wrecked':
          if (e.carId === playerId) { this.hit('impact_heavy', 0.9, 0.7, 1); this.hit('crunch', 0.7, 0.8, 1); this.duck(0.8); }
          break;
        case 'countdown':
          if (e.value > 0) this.play('countdown', 0.9, 1);
          else this.play('go', 1, 1);
          break;
        case 'finish':
          if (e.carId === playerId) this.play('finish', 1, 1);
          break;
        case 'repair':
          if (e.carId === playerId) this.play('buy', 0.8, 1);
          break;
        // ---- power-ups (placeholder mapping onto the existing samples; give them their own recordings later)
        case 'boost': {
          const vol = this.near(e.x, e.y) * (e.carId === playerId ? 0.9 : 0.5);
          if (vol > 0.04 && this.gate('boost' + e.carId, 0.3)) this.play('go', vol, e.source === 'pad' ? 1.9 : 1.4);
          break;
        }
        case 'pickup':
          if (e.carId === playerId) this.play('buy', 0.7, 1.6);
          else { const vol = this.near(e.x, e.y) * 0.3; if (vol > 0.04 && this.gate('pickup', 0.15)) this.play('buy', vol, 1.9); }
          break;
        case 'itemUse': {
          const vol = this.near(e.x, e.y) * (e.carId === playerId ? 1 : 0.6);
          if (vol <= 0.04) break;
          if (e.item === 'shockwave') { this.play('impact_heavy_1', vol, 0.55); this.play('crunch_1', vol * 0.6, 0.7); }
          else if (e.item === 'oil') this.play('debris_1', vol * 0.8, 0.6);
          else if (e.item === 'shield') this.play('click', vol * 0.9, 0.5);
          else if (e.item === 'nitro') this.play('go', vol, 1.25);
          break;
        }
        case 'shieldPop': {
          const vol = this.near(e.x, e.y);
          if (vol > 0.04) this.play('crunch_1', vol * 0.8, 1.7);
          break;
        }
        case 'oilSpin': {
          const vol = this.near(e.x, e.y) * (e.carId === playerId ? 1 : 0.5);
          if (vol > 0.04 && this.gate('oilspin', 0.2)) this.play('debris_1', vol * 0.8, 0.8);
          break;
        }
        default:
          break;
      }
    }
  }

  ui(name: 'click' | 'buy' | 'error'): void {
    if (!this.ctx || !this.unlocked) return;
    this.play(name, name === 'click' ? 0.7 : 0.85, 1);
  }

  // ---------------------------------------------------------------- helpers

  /** 0..1 loudness factor from the distance to the player (no listener info -> full volume). */
  private near(x: number, y: number): number {
    if (!this.haveListener) return 1;
    const r = CONFIG.render.fx.shakeNearRadius * 1.4;
    const d = Math.hypot(x - this.px, y - this.py);
    return clamp01(1 - d / r);
  }

  private gate(key: string, minInterval: number): boolean {
    const last = this.lastPlay[key];
    if (last !== undefined && this.clock - last < minInterval) return false;
    this.lastPlay[key] = this.clock;
    return true;
  }

  private pick2(): boolean { return Math.random() < 0.5; }

  /** Collision with something: choose material sample(s), scale by strength and distance, thin out pile-ups, duck the mix. */
  private onImpact(x: number, y: number, strength: number, own: boolean, other: 'car' | 'wall' | 'guardrail' | 'curb' | 'road' | 'prop'): void {
    const s = clamp01(strength);
    const prox = this.near(x, y);
    const dist = own ? 1 : Math.pow(prox, 1.5) * MIX.aiVolume;     // AI cars: quieter and muffled with distance
    if (dist <= 0.03) return;
    const wallish = other === 'wall' || other === 'guardrail' || other === 'curb';
    if (wallish && s < 0.35 && this.clock < this.scrapeUntil) return;   // sliding along a wall: the scrape loop covers it
    if (!this.gate('impact', A.impactMinInterval)) return;
    const fam: Family = other === 'guardrail' ? 'impact_metal'
      : other === 'wall' || other === 'curb' || other === 'road' ? 'impact_concrete'
      : other === 'prop' ? (this.pick2() ? 'impact_plastic' : 'impact_wood')
      : 'impact_metal';
    const key = `impact:${fam}`;
    const lastS = this.lastStrength[key] ?? -1;
    if (!this.gate(key, MIX.sameKeyInterval) && s < lastS + 0.25) return;   // same material again: only if clearly stronger
    this.lastStrength[key] = s;
    const level = dist * (0.3 + 0.7 * Math.pow(s, 0.8));                   // volume by impact strength
    // leaky energy bucket: a pile-up of hits thins out instead of summing to noise
    const cost = level * (0.5 + s);
    if (this.bucket + cost > MIX.bucketMax && level < this.bucket * 0.6) return;
    this.bucket = Math.min(MIX.bucketMax * 1.5, this.bucket + cost);

    const rate = lerp(1.1, 0.86, s) * (0.96 + Math.random() * 0.08);
    const heavy = s >= 0.3 && (other !== 'prop' || s > 0.6);
    if (!heavy && other === 'car') this.hit('impact_light', level, rate, prox);
    else this.hit(fam, heavy ? level * 0.85 : level, rate, prox);
    if (heavy) this.hit('impact_heavy', level * 0.8, lerp(1.1, 0.85, s) * (0.97 + Math.random() * 0.06), prox);
    if (s > 0.55 && other !== 'prop') this.hit('crunch', level * 0.55 * s, lerp(1.1, 0.9, s), prox);
    if (s > 0.7) this.hit('debris', level * 0.45, 0.95 + Math.random() * 0.15, prox);
    this.duck(level * s);
  }

  private lastStrength: Record<string, number> = {};

  /** Play one random variation of a collision family on the impact bus. `prox` (0..1): distance factor, low = muffled. */
  private hit(fam: Family, volume: number, rate: number, prox: number): void {
    if (volume < 0.02) return;
    const n = FAMILIES[fam];
    let v = 1 + Math.floor(Math.random() * n);
    if (n > 1 && v === this.lastVariant[fam]) v = (v % n) + 1;
    this.lastVariant[fam] = v;
    this.play(`${fam}_${v}`, volume, rate, { impact: true, prox });
  }

  /** Brief dip of engine / skid / music so a big crash is not buried. amount 0..1. */
  private duck(amount: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.loopBus || !this.musicDuck) return;
    const a = clamp01(amount), t = ctx.currentTime;
    const l = 1 - MIX.duckLoops * a, m = 1 - MIX.duckMusic * a;
    for (const [node, v] of [[this.loopBus, l], [this.musicDuck, m]] as const) {
      const p = node.gain;
      p.cancelScheduledValues(t);
      p.setTargetAtTime(Math.min(p.value, v), t, 0.008);
      p.setTargetAtTime(1, t + 0.09, 0.22);
    }
  }

  private play(name: string, volume: number, rate: number, opt?: { impact?: boolean; prox?: number }): void {
    const ctx = this.ctx, buf = this.buffers.get(name);
    if (!ctx || !buf || !this.sfxGain || this.voices >= A.maxVoices) return;
    const vol = clamp01(volume) * (this.trim.get(name) ?? 1);
    try {
      let bus: AudioNode = this.sfxGain;
      if (opt?.impact && this.impactBus) {
        bus = this.impactBus;
        if (this.impactVoices.length >= MIX.impactVoices) {
          // steal the quietest voice if the new one is clearly louder, else drop the new one
          let qi = 0;
          for (let i = 1; i < this.impactVoices.length; i++) if (this.impactVoices[i].vol < this.impactVoices[qi].vol) qi = i;
          const q = this.impactVoices[qi];
          if (vol < q.vol * 1.2) return;
          q.g.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
          try { q.src.stop(ctx.currentTime + 0.06); } catch { /* ignore */ }
          this.impactVoices.splice(qi, 1);
        }
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      const g = ctx.createGain();
      g.gain.value = Math.min(1.2, vol);
      let tail: AudioNode = src;
      let lp: BiquadFilterNode | null = null;
      if (opt?.prox !== undefined && opt.prox < 0.97) {   // far hits lose their highs
        lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = lerp(1400, 16000, clamp01(opt.prox));
        src.connect(lp); tail = lp;
      }
      tail.connect(g); g.connect(bus);
      this.voices++;
      const voice = { g, src, vol };
      if (opt?.impact) this.impactVoices.push(voice);
      src.onended = () => {
        this.voices--;
        if (opt?.impact) { const i = this.impactVoices.indexOf(voice); if (i >= 0) this.impactVoices.splice(i, 1); }
        try { g.disconnect(); lp?.disconnect(); } catch { /* ignore */ }
      };
      src.start();
    } catch { /* ignore */ }
  }
}

/** Material family of a prop. */
function propFamily(t: string | undefined, coin: boolean): Family {
  switch (t) {
    case 'cone': case 'sign': case 'tireStack': return 'impact_plastic';
    case 'barrel': case 'crate': case 'tree': case 'hayBale': return 'impact_wood';
    case 'rock': return 'impact_concrete';
    default: return coin ? 'impact_plastic' : 'impact_wood';
  }
}
