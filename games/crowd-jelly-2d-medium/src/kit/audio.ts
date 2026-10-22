// Sound effects and music made in code (WebAudio): no audio files, nothing to download or license.
// Gated by the platform mute setting, the player's Sound / Music switches, pause and ads.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let musicBus: GainNode | null = null;
let noise: AudioBuffer | null = null;
let soundOn = true;
let musicOn = true;
let paused = false;
let platformOn = true;

function ensure(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.connect(ctx.destination);
    musicBus = ctx.createGain();
    musicBus.connect(master);
    noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    applyGains();
  } catch {
    ctx = null;
  }
  return ctx;
}

function applyGains(): void {
  if (!ctx || !master || !musicBus) return;
  master.gain.setValueAtTime(platformOn ? 0.6 : 0, ctx.currentTime);
  musicBus.gain.setValueAtTime(musicOn ? 0.5 : 0, ctx.currentTime);
}

function live(): AudioContext | null {
  const c = ensure();
  return c && c.state === 'running' && soundOn && !paused ? c : null;
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.2, slideTo?: number, when = 0, bus?: GainNode): void {
  const c = ctx;
  if (!c || !master) return;
  const t0 = c.currentTime + when;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g).connect(bus ?? master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

// ---- music: a slow pentatonic loop, scheduled a little ahead; 3 moods ----
const SCALE = [0, 2, 4, 7, 9]; // major pentatonic
const MOODS = [
  { root: 261.6, bpm: 96, pattern: [0, 2, 4, 2, 3, 2, 1, 2] },
  { root: 293.7, bpm: 110, pattern: [0, 1, 2, 4, 3, 2, 4, 3] },
  { root: 220, bpm: 84, pattern: [4, 3, 2, 0, 2, 3, 1, 2] },
];
let mood = 0;
let step = 0;
let nextAt = 0;
let timer = 0;

function note(deg: number, oct = 0): number {
  const s = SCALE[((deg % 5) + 5) % 5] + 12 * (Math.floor(deg / 5) + oct);
  return MOODS[mood].root * Math.pow(2, s / 12);
}

function schedule(): void {
  const c = ctx;
  if (!c || !musicBus || paused || !musicOn || !soundOn || c.state !== 'running') return;
  const m = MOODS[mood];
  const beat = 60 / m.bpm / 2;
  if (nextAt < c.currentTime) nextAt = c.currentTime + 0.05;
  while (nextAt < c.currentTime + 0.4) {
    const when = nextAt - c.currentTime;
    const deg = m.pattern[step % m.pattern.length];
    tone(note(deg), beat * 1.6, 'triangle', 0.13, undefined, when, musicBus);
    if (step % 4 === 0) tone(note(deg, -1) / 2, beat * 3.4, 'sine', 0.16, undefined, when, musicBus);
    step++;
    nextAt += beat;
  }
}

export const audio = {
  /** Call from a user gesture: browsers need one before audio can start. */
  unlock(): void {
    const c = ensure();
    if (c && c.state === 'suspended' && !paused) c.resume().catch(() => {});
    if (!timer) timer = window.setInterval(schedule, 120);
  },
  setSound(on: boolean): void {
    soundOn = on;
  },
  setMusic(on: boolean): void {
    musicOn = on;
    applyGains();
  },
  /** Platform mute (YouTube / Playgama). */
  setPlatformAudio(on: boolean): void {
    platformOn = on;
    applyGains();
  },
  /** Pick the loop (0..2), e.g. one per level theme. */
  setMood(i: number): void {
    mood = ((i % MOODS.length) + MOODS.length) % MOODS.length;
    step = 0;
  },
  pause(): void {
    paused = true;
    if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
  },
  resume(): void {
    paused = false;
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  },

  click(): void {
    if (live()) tone(520, 0.08, 'triangle', 0.15, 700);
  },
  pop(pitch = 1): void {
    const c = live();
    if (!c || !noise || !master) return;
    tone(500 * pitch, 0.12, 'sine', 0.22, 1100 * pitch);
    const src = c.createBufferSource();
    src.buffer = noise;
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 3000;
    const g = c.createGain();
    g.gain.setValueAtTime(0.15, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.06);
    src.connect(f).connect(g).connect(master);
    src.start(c.currentTime, Math.random() * 0.3, 0.08);
  },
  coin(): void {
    if (!live()) return;
    tone(880, 0.1, 'triangle', 0.13);
    tone(1320, 0.18, 'triangle', 0.13, undefined, 0.06);
  },
  win(): void {
    if (!live()) return;
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.28, 'triangle', 0.16, undefined, i * 0.09));
  },
  /** Studio logo sting: a soft boing, then a sparkle. */
  sting(): void {
    if (!live()) return;
    tone(180, 0.22, 'sine', 0.2, 420);
    tone(988, 0.3, 'triangle', 0.1, undefined, 0.5);
    tone(1319, 0.4, 'triangle', 0.1, undefined, 0.58);
    tone(1760, 0.5, 'triangle', 0.08, undefined, 0.66);
  },
  lose(): void {
    if (!live()) return;
    tone(330, 0.35, 'sawtooth', 0.1, 150);
  },
  /** A gate or squad hit: rising chirp for good, low thud for bad. `mul` adds a sparkle on top. */
  gate(good: boolean, mul = false): void {
    if (!live()) return;
    if (good) {
      tone(520, 0.12, 'triangle', 0.16, 780);
      tone(780, 0.16, 'triangle', 0.14, 1040, 0.07);
      if (mul) tone(1320, 0.22, 'triangle', 0.12, undefined, 0.14);
    } else {
      tone(200, 0.2, 'square', 0.1, 90);
    }
  },
  /** The boss wall breaks. */
  boom(): void {
    const c = live();
    if (!c || !noise || !master) return;
    tone(120, 0.5, 'sawtooth', 0.18, 40);
    const src = c.createBufferSource();
    src.buffer = noise;
    const g = c.createGain();
    g.gain.setValueAtTime(0.3, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.4);
    src.connect(g).connect(master);
    src.start(c.currentTime, 0, 0.4);
  },
};
