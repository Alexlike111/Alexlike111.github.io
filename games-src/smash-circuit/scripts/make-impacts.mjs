#!/usr/bin/env node
// Offline author of the collision sound effects (impact_*, crunch_*, debris_*, scrape) and a demo mix.
//
//   node scripts/make-impacts.mjs            (needs ffmpeg with libvorbis + libmp3lame on PATH)
//
// Deterministic (seeded PRNG): layered low thump + metallic/wood/concrete/plastic resonances + short debris
// rattle, one-pole/biquad low-passed, DC-blocked, soft-clipped, normalised to a per-class RMS and capped at
// -3 dBFS. The output is written as .ogg (primary) + .mp3 (Safari fallback) into public/sfx/ and a demo mix
// into e2e/out/audio/. Final assets are plain audio files; this script is only the (offline) authoring tool.
// NOTE: LEGACY dev fallback. public/sfx now holds RECORDED CC0 sounds built by scripts/make-recorded.mjs and this
// script would overwrite them with synthesised placeholders (platform rule 3.3.2, see docs/AUDIO.md), so it refuses to
// run unless ALLOW_PLACEHOLDER_SFX=1.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.ALLOW_PLACEHOLDER_SFX !== '1') {
  console.error('make-impacts.mjs: refusing to overwrite the recorded sounds in public/sfx with synthesised placeholders (set ALLOW_PLACEHOLDER_SFX=1 to force; see docs/AUDIO.md).');
  process.exit(1);
}
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SFX = join(ROOT, 'public', 'sfx');
const DEMO = join(ROOT, 'e2e', 'out', 'audio');
const SR = 44100;
mkdirSync(SFX, { recursive: true });
mkdirSync(DEMO, { recursive: true });
const TMP = mkdtempSync(join(tmpdir(), 'impacts-'));

// ------------------------------------------------------------------ helpers
function rngFor(seed) {
  let a = seed >>> 0;
  const r = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return r;
}
const buf = (sec) => new Float32Array(Math.round(sec * SR));
const TAU = Math.PI * 2;

/** RBJ biquad; kind: lp | hp | bp. Returns a new array. */
function biquad(x, kind, f, q = 0.707) {
  const w = TAU * f / SR, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q);
  let b0, b1, b2;
  const a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
  if (kind === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; }
  else if (kind === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; }
  else { b0 = al; b1 = 0; b2 = -al; }
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
function add(dst, src, at = 0, gain = 1) {
  const o = Math.round(at * SR);
  for (let i = 0; i < src.length && o + i < dst.length; i++) if (o + i >= 0) dst[o + i] += src[i] * gain;
}
const noise = (r, n) => { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = r() * 2 - 1; return x; };

/** Low "thump": pitch-dropping sine with fast attack and exponential decay. */
function thump(sec, f0, f1, tauF, decay, amp = 1) {
  const x = buf(sec); let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR, f = f1 + (f0 - f1) * Math.exp(-t / tauF);
    ph += TAU * f / SR;
    x[i] = Math.sin(ph) * Math.exp(-t / decay) * Math.min(1, t / 0.002) * amp;
  }
  return x;
}
/** Sum of damped sinusoids [freq, decaySeconds, amp] (metal / wood / plastic body resonances). */
function modes(r, sec, list, detune = 0.012) {
  const x = buf(sec);
  for (const [f, d, a] of list) {
    const ff = f * (1 + (r() - 0.5) * 2 * detune), ph0 = r() * TAU;
    for (let i = 0; i < x.length; i++) {
      const t = i / SR;
      x[i] += Math.sin(TAU * ff * t + ph0) * Math.exp(-t / d) * a * Math.min(1, t / 0.0015);
    }
  }
  return x;
}
/** Filtered noise burst with exponential decay. */
function burst(r, sec, decay, hp, lp, amp = 1) {
  let x = noise(r, Math.round(sec * SR));
  for (let i = 0; i < x.length; i++) x[i] *= Math.exp(-(i / SR) / decay) * amp;
  if (hp) x = biquad(x, 'hp', hp);
  if (lp) x = biquad(x, 'lp', lp);
  return x;
}
/** Short debris rattle: n resonant ticks over `span` s with decaying level. */
function rattle(r, sec, n, start, span, fLo, fHi, amp = 1) {
  const x = buf(sec);
  for (let k = 0; k < n; k++) {
    const u = k / Math.max(1, n - 1);
    const t0 = start + Math.pow(r(), 1.4) * span;
    const f = fLo + r() * (fHi - fLo), d = 0.004 + r() * 0.009;
    const lvl = amp * (0.35 + 0.65 * r()) * (1 - 0.7 * u);
    const tick = buf(0.05);
    for (let i = 0; i < tick.length; i++) { const t = i / SR; tick[i] = Math.sin(TAU * f * t) * Math.exp(-t / d) * lvl; }
    add(x, tick, t0);
  }
  return x;
}
/** Crumpling metal: grainy band-passed noise whose centre sweeps down, plus ringing partials. */
function crumple(r, sec, grains, fStart, fEnd, amp = 1) {
  const x = buf(sec);
  for (let g = 0; g < grains; g++) {
    const u = g / grains, t0 = Math.pow(u, 1.2) * sec * 0.7 + r() * 0.01;
    const f = fStart + (fEnd - fStart) * u * (0.7 + r() * 0.6);
    const len = 0.012 + r() * 0.02;
    let n = noise(r, Math.round(len * SR));
    n = biquad(n, 'bp', f, 3.5);
    for (let i = 0; i < n.length; i++) n[i] *= Math.exp(-(i / SR) / (len * 0.4)) * 7 * amp * (1 - 0.6 * u);
    add(x, n, t0);
  }
  return x;
}

/** Finish a sound: gentle low-pass (harshness), DC block, fade tail, soft clip, RMS normalise, -3 dBFS peak cap. */
function finish(x, { lp = 6500, rmsDb = -17, peakDb = -3, fade = 0.02 } = {}) {
  let y = biquad(x, 'hp', 28, 0.6);
  y = biquad(y, 'lp', lp, 0.6);
  const n = Math.round(fade * SR);
  for (let i = 0; i < n && i < y.length; i++) y[y.length - 1 - i] *= i / n;
  // normalise to the RMS of the first 0.3 s (the audible body of a hit)
  const m = Math.min(y.length, Math.round(0.3 * SR));
  let e = 0; for (let i = 0; i < m; i++) e += y[i] * y[i];
  const rms = Math.sqrt(e / m) || 1e-6, g = Math.pow(10, rmsDb / 20) / rms;
  for (let i = 0; i < y.length; i++) y[i] = Math.tanh(y[i] * g * 0.9) / Math.tanh(0.9);   // smooth limiter, no hard clips
  let pk = 0; for (let i = 0; i < y.length; i++) pk = Math.max(pk, Math.abs(y[i]));
  const cap = Math.pow(10, peakDb / 20), s = pk > cap ? cap / pk : 1;
  for (let i = 0; i < y.length; i++) y[i] *= s;
  return y;
}

// ------------------------------------------------------------------ recipes
// each recipe(seed) -> Float32Array. Variations differ in pitch / mode layout / rattle pattern.
const V = (r, base, spread) => base * (1 + (r() - 0.5) * 2 * spread);

function lightHit(seed) {            // quick plastic/metal tap: soft tok + small tick
  const r = rngFor(seed), x = buf(0.2);
  add(x, thump(0.2, V(r, 190, 0.12), 110, 0.02, 0.05, 1));
  add(x, modes(r, 0.2, [[V(r, 1400, 0.15), 0.025, 0.28], [V(r, 2300, 0.15), 0.015, 0.18]]));
  add(x, burst(r, 0.05, 0.008, 700, 4200, 0.5));
  add(x, rattle(r, 0.2, 3, 0.02, 0.1, 1800, 3500, 0.25));
  return finish(x, { rmsDb: -19, lp: 5500, fade: 0.03 });
}
function heavyHit(seed) {            // cartoon-arcade smash: boom + metallic crunch + debris
  const r = rngFor(seed), x = buf(0.62);
  add(x, thump(0.55, V(r, 135, 0.1), 46, 0.045, 0.16, 1.5));
  add(x, thump(0.3, V(r, 260, 0.1), 90, 0.03, 0.06, 0.5));
  add(x, burst(r, 0.2, 0.03, 250, 3200, 0.9));
  add(x, modes(r, 0.5, [[V(r, 520, 0.1), 0.09, 0.3], [V(r, 1180, 0.1), 0.07, 0.24], [V(r, 2150, 0.1), 0.05, 0.14], [V(r, 3300, 0.1), 0.03, 0.08]]), 0.004);
  add(x, crumple(r, 0.4, 14, 3400, 900, 0.7), 0.015);
  add(x, rattle(r, 0.62, 9, 0.07, 0.35, 1500, 4200, 0.4));
  return finish(x, { rmsDb: -14, lp: 5800, fade: 0.06 });
}
function woodHit(seed) {             // crate / barrel: hollow knock + splinter clacks
  const r = rngFor(seed), x = buf(0.38);
  add(x, thump(0.3, V(r, 170, 0.12), 82, 0.03, 0.07, 1.3));
  add(x, modes(r, 0.38, [[V(r, 330, 0.12), 0.07, 0.5], [V(r, 610, 0.12), 0.05, 0.35], [V(r, 940, 0.12), 0.03, 0.22], [V(r, 1500, 0.12), 0.02, 0.1]]));
  add(x, burst(r, 0.06, 0.01, 500, 3500, 0.7));
  add(x, rattle(r, 0.38, 7, 0.03, 0.26, 700, 2400, 0.55));
  return finish(x, { rmsDb: -16, lp: 5000, fade: 0.05 });
}
function metalHit(seed) {            // guardrail: clang with short ring
  const r = rngFor(seed), x = buf(0.5);
  add(x, thump(0.3, V(r, 150, 0.1), 70, 0.03, 0.08, 1.1));
  const f = V(r, 460, 0.15);
  add(x, modes(r, 0.5, [[f, 0.16, 0.45], [f * 1.51, 0.12, 0.35], [f * 2.32, 0.09, 0.28], [f * 3.4, 0.06, 0.18], [f * 4.7, 0.04, 0.1]], 0.004));
  add(x, burst(r, 0.07, 0.01, 800, 5000, 0.8));
  add(x, crumple(r, 0.3, 8, 2800, 1200, 0.45), 0.01);
  add(x, rattle(r, 0.5, 4, 0.06, 0.2, 2000, 4200, 0.25));
  return finish(x, { rmsDb: -16, lp: 5200, fade: 0.07 });
}
function concreteHit(seed) {         // wall: dull heavy slap, little ring, grit
  const r = rngFor(seed), x = buf(0.4);
  add(x, thump(0.4, V(r, 100, 0.1), 40, 0.05, 0.13, 1.7));
  add(x, burst(r, 0.14, 0.03, 120, 1800, 1.0));
  add(x, modes(r, 0.25, [[V(r, 240, 0.1), 0.05, 0.3], [V(r, 700, 0.1), 0.03, 0.15]]));
  add(x, rattle(r, 0.4, 6, 0.04, 0.22, 900, 2800, 0.35));
  return finish(x, { rmsDb: -14.5, lp: 3800, fade: 0.06 });
}
function plasticHit(seed) {          // cone / sign: bouncy hollow "bonk" with a short pitch drop
  const r = rngFor(seed), x = buf(0.28);
  add(x, thump(0.25, V(r, 520, 0.12), 250, 0.05, 0.07, 1.0));
  add(x, thump(0.2, V(r, 160, 0.1), 90, 0.025, 0.05, 0.7));
  add(x, modes(r, 0.25, [[V(r, 880, 0.1), 0.04, 0.3], [V(r, 1700, 0.1), 0.025, 0.14]]));
  add(x, burst(r, 0.04, 0.007, 900, 4000, 0.35));
  add(x, rattle(r, 0.28, 3, 0.04, 0.15, 1200, 2600, 0.2));
  return finish(x, { rmsDb: -18, lp: 4800, fade: 0.04 });
}
function crunchHit(seed) {           // layered crumpling metal, used on big hits / part-off / break
  const r = rngFor(seed), x = buf(0.5);
  add(x, thump(0.2, V(r, 120, 0.1), 60, 0.03, 0.05, 0.6));
  add(x, crumple(r, 0.45, 22, 3600, 700, 1.0));
  add(x, modes(r, 0.4, [[V(r, 700, 0.1), 0.08, 0.2], [V(r, 1650, 0.1), 0.05, 0.14], [V(r, 2600, 0.1), 0.03, 0.08]]));
  add(x, rattle(r, 0.5, 6, 0.1, 0.3, 1800, 4500, 0.3));
  return finish(x, { rmsDb: -17, lp: 5600, fade: 0.07 });
}
function debrisHit(seed) {           // small pieces clattering
  const r = rngFor(seed), x = buf(0.42);
  add(x, rattle(r, 0.42, 14, 0.0, 0.34, 900, 4200, 0.9));
  add(x, burst(r, 0.1, 0.02, 600, 3000, 0.4));
  return finish(x, { rmsDb: -21, lp: 5200, fade: 0.08 });
}
/** Seamless quiet scrape loop (1.2 s): band-limited noise with slow wobble + faint ring; loop-faded by crossfade. */
function scrapeLoop(seed) {
  const r = rngFor(seed), len = 1.2, n = Math.round(len * SR), xf = Math.round(0.12 * SR);
  const raw = new Float32Array(n + xf);
  let t = noise(r, raw.length);
  t = biquad(biquad(t, 'hp', 500, 0.7), 'lp', 3600, 0.7);
  const ring = modes(r, len + 0.12, [[1050, 9, 0.12], [2290, 9, 0.07]], 0);
  for (let i = 0; i < raw.length; i++) {
    const tt = i / SR, wob = 0.7 + 0.3 * Math.sin(TAU * 7 * tt) * Math.sin(TAU * 3 * tt + 1) ;
    raw[i] = (t[i] * wob * 3.2) + ring[i] * 0.5 * (0.6 + 0.4 * Math.sin(TAU * 5 * tt));
  }
  // equal-power crossfade of the tail over the head => seamless loop
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = raw[i];
  for (let i = 0; i < xf; i++) {
    const a = i / xf, g1 = Math.sqrt(a), g2 = Math.sqrt(1 - a);
    out[i] = raw[i] * g1 + raw[n + i] * g2;
  }
  return finish(out, { rmsDb: -22, lp: 4000, fade: 0 });   // fade 0: loop stays continuous
}

const SOUNDS = [];
const reg = (name, fn, seeds) => seeds.forEach((s, i) => SOUNDS.push({ name: seeds.length > 1 ? `${name}_${i + 1}` : name, data: fn(s) }));
reg('impact_light', lightHit, [11, 12, 13]);
reg('impact_heavy', heavyHit, [21, 22, 23]);
reg('impact_wood', woodHit, [31, 32, 33]);
reg('impact_metal', metalHit, [41, 42, 43]);
reg('impact_concrete', concreteHit, [51, 52]);
reg('impact_plastic', plasticHit, [61, 62, 63]);
reg('crunch', crunchHit, [71, 72]);
reg('debris', debrisHit, [81, 82]);
reg('scrape', scrapeLoop, [91]);

// ------------------------------------------------------------------ io
function wav(name, data, dir = TMP) {
  const n = data.length, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, data[i])) * 32767), 44 + i * 2);
  const p = join(dir, `${name}.wav`); writeFileSync(p, b); return p;
}
function ff(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + args.join(' '));
}

for (const s of SOUNDS) {
  const w = wav(s.name, s.data);
  ff(['-i', w, '-ac', '1', '-ar', String(SR), '-c:a', 'libvorbis', '-q:a', '2', join(SFX, `${s.name}.ogg`)]);
  ff(['-i', w, '-ac', '1', '-ar', String(SR), '-c:a', 'libmp3lame', '-b:a', '56k', join(SFX, `${s.name}.mp3`)]);
}

// ------------------------------------------------------------------ demo mix (what a short crash sequence sounds like)
const by = Object.fromEntries(SOUNDS.map((s) => [s.name, s.data]));
const mix = buf(9);
const hit = (name, at, gain = 1, rate = 1) => {
  const src = by[name], n = Math.floor(src.length / rate), o = new Float32Array(n);
  for (let i = 0; i < n; i++) { const p = i * rate, k = Math.floor(p), f = p - k; o[i] = src[k] * (1 - f) + (src[k + 1] ?? 0) * f; }
  add(mix, o, at, gain);
};
// 1) the individual classes, light -> heavy
hit('impact_light_1', 0.2, 0.5); hit('impact_light_2', 0.7, 0.8); hit('impact_light_3', 1.2, 1.0, 1.1);
hit('impact_heavy_1', 1.9, 0.7); hit('impact_heavy_2', 2.8, 1.0, 0.92); hit('impact_heavy_3', 3.7, 1.0, 0.82);
// 2) materials
hit('impact_wood_1', 4.6, 0.9); hit('impact_metal_1', 5.2, 0.9); hit('impact_concrete_1', 5.9, 0.9); hit('impact_plastic_1', 6.5, 0.9);
// 3) pile-up: a big smash with crunch + debris, then quick succession of hits (mimics the in-game voice cap / gain scaling)
hit('impact_heavy_2', 7.0, 0.9, 0.85); hit('crunch_1', 7.02, 0.6, 0.95); hit('debris_1', 7.2, 0.5);
hit('impact_metal_2', 7.45, 0.5); hit('impact_wood_2', 7.6, 0.4, 1.1); hit('impact_plastic_2', 7.72, 0.35, 1.2);
// scrape loop tail
{ const sc = by.scrape, o = buf(1.2); for (let i = 0; i < o.length; i++) o[i] = sc[i % sc.length] * Math.min(1, i / 2000) * Math.min(1, (o.length - i) / 4000); add(mix, o, 7.85, 0.5); }
let mpk = 0; for (let i = 0; i < mix.length; i++) mpk = Math.max(mpk, Math.abs(mix[i]));
const lim = Math.pow(10, -2 / 20);
for (let i = 0; i < mix.length; i++) mix[i] = Math.tanh(mix[i] * 0.95) / Math.tanh(0.95) * (mpk > lim ? 0.9 : 1);
const dwav = wav('impact_demo', mix, DEMO);
ff(['-i', dwav, '-c:a', 'libmp3lame', '-b:a', '128k', join(DEMO, 'impact_demo.mp3')]);
rmSync(TMP, { recursive: true, force: true });
console.log(`wrote ${SOUNDS.length} sounds to public/sfx and demo mix to e2e/out/audio/`);
