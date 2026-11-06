// Builds public/sfx/* (ogg + mp3) from RECORDED, CC0 / permissively licensed sound files. Needs ffmpeg with libvorbis + libmp3lame.
//
//   node scripts/make-recorded.mjs --kenney <dir> --racing <dir> --music <file> [--only name,name] [--dry]
//
//   --kenney  folder that contains Kenney's audio packs (the "Audio" folder of "Kenney Game Assets All-in-1", or any folder holding the
//             Impact Sounds / Interface Sounds / Foley Sounds / RPG Audio / Digital Audio / Sci-Fi Sounds / Music Jingles / Music Loops packs).
//             Files are found by `Pack Name/file.ogg` anywhere below the folder.
//   --racing  folder with engine.ogg + skid.ogg (Kenney "Starter-Kit-Racing", audio/ folder, MIT)
//   --music   "Battle Theme A" by cynicmusic (CC0), the race music (mp3 or ogg)
//
// Every output is made only by cutting, layering, level-matching and loop-crossfading the recordings (no synthesis). The table of
// sources + licences lives in docs/AUDIO.md. The old generators (make-sfx.sh, make-impacts.mjs) are kept only as a dev fallback and
// OVERWRITE these files, so never run them after this script.
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : undefined; };
const KENNEY = opt('kenney'), RACING = opt('racing'), MUSIC = opt('music');
const ONLY = opt('only')?.split(',');
const DRY = args.includes('--dry');
if (!KENNEY || !RACING || !MUSIC) { console.error('usage: node scripts/make-recorded.mjs --kenney <dir> --racing <dir> --music <file> [--only a,b] [--dry]'); process.exit(1); }
const OUT = resolve(fileURLToPath(new URL('..', import.meta.url)), 'public/sfx');
const SR = 44100;

// ------------------------------------------------------------------ source lookup
const files = [];
(function walk(d) { for (const e of readdirSync(d)) { const p = join(d, e); const s = statSync(p); if (s.isDirectory()) walk(p); else if (/\.(ogg|wav|mp3)$/i.test(e)) files.push(p); } })(KENNEY);
function findSrc(ref) {
  if (ref.startsWith('@racing/')) return join(RACING, ref.slice(8));
  if (ref === '@music') return MUSIC;
  const i = ref.indexOf('/'); const pack = ref.slice(0, i), file = ref.slice(i + 1);
  const hit = files.find((p) => basename(p) === file && p.split(/[\\/]/).includes(pack));
  if (!hit) throw new Error('source not found: ' + ref);
  return hit;
}

// ------------------------------------------------------------------ dsp helpers (Float32Array channels at 44.1 kHz)
function decode(path, channels) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-ac', String(channels), '-ar', String(SR), '-f', 'f32le', 'pipe:1'], { maxBuffer: 1 << 29 });
  if (r.status !== 0) throw new Error('decode failed: ' + path + ' ' + r.stderr);
  const all = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 4));
  const n = Math.floor(all.length / channels);
  const out = Array.from({ length: channels }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < channels; c++) out[c][i] = all[i * channels + c];
  return out;
}
const peakOf = (chs) => { let p = 0; for (const d of chs) for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > p) p = a; } return p; };
const rmsOf = (chs) => { let e = 0, n = 0; for (const d of chs) { for (let i = 0; i < d.length; i++) e += d[i] * d[i]; n += d.length; } return Math.sqrt(e / Math.max(1, n)); };
const dB = (x) => 20 * Math.log10(Math.max(1e-9, x));
const lin = (db) => Math.pow(10, db / 20);
function trimLead(chs, thr = 0.006) { let s = 0; const n = chs[0].length; while (s < n && chs.every((d) => Math.abs(d[s]) < thr)) s++; return chs.map((d) => d.subarray(Math.max(0, s - 24))); }
function cut(chs, from, len) { const a = Math.round(from * SR), b = len == null ? chs[0].length : Math.min(chs[0].length, a + Math.round(len * SR)); return chs.map((d) => d.subarray(a, b)); }
function onePole(d, fc, hp) { const a = Math.exp(-2 * Math.PI * fc / SR); const o = new Float32Array(d.length); let y = 0; for (let i = 0; i < d.length; i++) { y = (1 - a) * d[i] + a * y; o[i] = hp ? d[i] - y : y; } return o; }
function fade(chs, fin, fout) { for (const d of chs) { const fi = Math.round(fin * SR), fo = Math.round(fout * SR); for (let i = 0; i < Math.min(fi, d.length); i++) d[i] *= i / fi; for (let i = 0; i < Math.min(fo, d.length); i++) d[d.length - 1 - i] *= i / fo; } }
/** equal-power crossfade of the last `x` seconds into the first ones: the result is x shorter and loops without a seam */
function xfadeLoop(chs, x) {
  return chs.map((src) => {
    const xs = Math.min(Math.round(x * SR), Math.floor(src.length / 3));
    const out = new Float32Array(src.length - xs); out.set(src.subarray(0, out.length));
    for (let i = 0; i < xs; i++) { const a = (i + 0.5) / xs * Math.PI / 2; out[i] = src[i] * Math.sin(a) + src[out.length + i] * Math.cos(a); }
    return out;
  });
}

// ------------------------------------------------------------------ recipes
// layer: { f: 'Pack/file.ogg', at: s (offset in the result), from: s (start in the source), len: s, g: dB, lp: Hz, hp: Hz }
// out:   len (cut the mix), fade [in,out] s, rms (target mean level dBFS) , peak (cap dBFS, default -3), loop (crossfade s), stereo
const L = (f, o = {}) => ({ f, ...o });
const RECIPES = {
  // ---- loops
  engine: { layers: [L('@racing/engine.ogg')], rms: -14, peak: -3, trim: false, limit: false },
  skid: { layers: [L('@racing/skid.ogg')], rms: -16, peak: -3, trim: false, limit: false },
  scrape: { layers: [L('Foley Sounds/stoneDrag2.ogg', { from: 0.06, len: 1.37 }), L('Foley Sounds/platesSlide3.ogg', { at: 0.2, g: -9 })], loop: 0.18, rms: -21, peak: -3, trim: false, limit: false },
  music: { layers: [L('@music')], stereo: true, trim: true, loop: 2.0, rms: -17, peak: -3, trimTail: true, limit: false },
  music_menu: { layers: [L('Music Loops/Flowing Rocks.ogg')], stereo: true, trim: false, rms: -18, peak: -3 },
  // ---- collisions: Kenney "Impact Sounds" (layered); the game trims every family to its own target level
  impact_light_1: { layers: [L('Impact Sounds/impactMetal_light_001.ogg')] },
  impact_light_2: { layers: [L('Impact Sounds/impactMetal_light_002.ogg')] },
  impact_light_3: { layers: [L('Impact Sounds/impactTin_medium_003.ogg')] },
  impact_heavy_1: { layers: [L('Impact Sounds/impactPlate_heavy_001.ogg'), L('Impact Sounds/impactPunch_heavy_002.ogg', { g: -2 }), L('Foley Sounds/stonesHit2.ogg', { at: 0.08, g: -8 })], len: 0.6, fade: [0, 0.08] },
  impact_heavy_2: { layers: [L('Impact Sounds/impactPlate_heavy_003.ogg'), L('Impact Sounds/impactPunch_heavy_003.ogg', { g: -2 }), L('Foley Sounds/stonesHit1.ogg', { at: 0.1, g: -9 })], len: 0.6, fade: [0, 0.08] },
  impact_heavy_3: { layers: [L('Impact Sounds/impactMetal_heavy_001.ogg'), L('Impact Sounds/impactPunch_heavy_001.ogg', { g: -2 }), L('Impact Sounds/impactPlate_heavy_004.ogg', { at: 0.02, g: -6 })], len: 0.65, fade: [0, 0.08] },
  impact_wood_1: { layers: [L('Impact Sounds/impactWood_heavy_000.ogg'), L('Impact Sounds/impactPlank_medium_000.ogg', { at: 0.04, g: -9 })], len: 0.5, fade: [0, 0.06] },
  impact_wood_2: { layers: [L('Impact Sounds/impactWood_heavy_002.ogg'), L('Impact Sounds/impactPlank_medium_002.ogg', { at: 0.04, g: -9 })], len: 0.5, fade: [0, 0.06] },
  impact_wood_3: { layers: [L('Impact Sounds/impactWood_heavy_004.ogg'), L('Impact Sounds/impactPlank_medium_003.ogg', { at: 0.04, g: -9 })], len: 0.5, fade: [0, 0.06] },
  impact_metal_1: { layers: [L('Impact Sounds/impactPlate_medium_001.ogg'), L('Impact Sounds/impactMetal_medium_000.ogg', { g: -3 })], len: 0.6, fade: [0, 0.1] },
  impact_metal_2: { layers: [L('Impact Sounds/impactMetal_medium_003.ogg'), L('Impact Sounds/impactPlate_medium_003.ogg', { g: -4 })], len: 0.6, fade: [0, 0.1] },
  impact_metal_3: { layers: [L('Impact Sounds/impactPlate_medium_004.ogg'), L('Impact Sounds/impactMetal_light_003.ogg', { g: -4 })], len: 0.6, fade: [0, 0.1] },
  impact_concrete_1: { layers: [L('Foley Sounds/stoneHit3.ogg'), L('Impact Sounds/impactMining_000.ogg', { g: -3, lp: 5000 })], len: 0.55, fade: [0, 0.1] },
  impact_concrete_2: { layers: [L('Foley Sounds/stoneHit1.ogg'), L('Impact Sounds/impactMining_002.ogg', { g: -3, lp: 5000 })], len: 0.55, fade: [0, 0.1] },
  impact_plastic_1: { layers: [L('Impact Sounds/impactSoft_medium_001.ogg'), L('Impact Sounds/impactTin_medium_002.ogg', { g: -7 })], len: 0.3, fade: [0, 0.05] },
  impact_plastic_2: { layers: [L('Impact Sounds/impactGeneric_light_001.ogg'), L('Impact Sounds/impactSoft_medium_003.ogg', { g: -2 })], len: 0.3, fade: [0, 0.05] },
  impact_plastic_3: { layers: [L('Impact Sounds/impactTin_medium_000.ogg', { g: -4 }), L('Impact Sounds/impactSoft_medium_000.ogg')], len: 0.3, fade: [0, 0.05] },
  crunch_1: { layers: [L('Impact Sounds/impactGlass_heavy_001.ogg', { g: -4 }), L('Impact Sounds/impactMetal_heavy_001.ogg'), L('Sci-Fi Sounds/explosionCrunch_000.ogg', { at: 0.03, g: -9 })], len: 0.7, fade: [0, 0.12] },
  crunch_2: { layers: [L('Impact Sounds/impactGlass_heavy_004.ogg', { g: -4 }), L('Impact Sounds/impactPlate_heavy_002.ogg'), L('Sci-Fi Sounds/explosionCrunch_003.ogg', { at: 0.03, g: -10 })], len: 0.7, fade: [0, 0.12] },
  debris_1: { layers: [L('Foley Sounds/stonesHit1.ogg'), L('Impact Sounds/impactGlass_light_002.ogg', { at: 0.12, g: -8 })], len: 0.5, fade: [0, 0.08] },
  debris_2: { layers: [L('Foley Sounds/stonesHit2.ogg'), L('Foley Sounds/platesHit5.ogg', { at: 0.1, g: -10, hp: 600 })], len: 0.5, fade: [0, 0.08] },
  // ---- UI, race flow
  click: { layers: [L('UI Audio/click3.ogg')], rms: -17, peak: -3, trim: true },
  buy: { layers: [L('RPG Audio/handleCoins.ogg', { len: 0.7 }), L('Interface Sounds/confirmation_001.ogg', { at: 0.18, g: -3 })], len: 0.7, fade: [0, 0.12], rms: -14, peak: -3 },
  error: { layers: [L('Interface Sounds/error_003.ogg')], len: 0.4, fade: [0, 0.08], rms: -15, peak: -3 },
  countdown: { layers: [L('Digital Audio/pepSound3.ogg')], len: 0.24, fade: [0, 0.05], rms: -11, peak: -3 },
  go: { layers: [L('Digital Audio/powerUp8.ogg')], len: 0.5, fade: [0, 0.1], rms: -11, peak: -3 },
  finish: { layers: [L('Music Jingles/jingles-steel_03.ogg'), L('Music Jingles/jingles-hit_09.ogg', { g: -4 })], len: 1.6, fade: [0, 0.2], rms: -12, peak: -3 },
  lap: { layers: [L('Interface Sounds/confirmation_002.ogg')], len: 0.5, fade: [0, 0.1], rms: -15, peak: -3 },
  pickup: { layers: [L('Digital Audio/powerUp3.ogg'), L('Foley Sounds/pickup2.ogg', { g: -6, len: 0.5 })], len: 0.8, fade: [0, 0.15], rms: -15, peak: -3 },
  nitro: { layers: [L('Sci-Fi Sounds/thrusterFire_000.ogg', { from: 0.3, len: 1.5 }), L('Foley Sounds/woosh3.ogg', { g: -5 })], len: 1.4, fade: [0.04, 0.5], rms: -15, peak: -3 },
  boost: { layers: [L('Foley Sounds/woosh3.ogg'), L('Foley Sounds/woosh5.ogg', { at: 0.05, g: -4 })], len: 0.7, fade: [0, 0.2], rms: -15, peak: -3 },
  shockwave: { layers: [L('Sci-Fi Sounds/lowFrequency_explosion_001.ogg'), L('Sci-Fi Sounds/explosionCrunch_000.ogg', { at: 0.02, g: -6 })], len: 1.2, fade: [0, 0.35], rms: -13, peak: -3 },
  oil: { layers: [L('Sci-Fi Sounds/slime_000.ogg'), L('Foley Sounds/drip1.ogg', { at: 0.3, g: -5 })], len: 0.7, fade: [0, 0.15], rms: -16, peak: -3 },
  shield: { layers: [L('Sci-Fi Sounds/forceField_001.ogg')], len: 0.9, fade: [0.01, 0.2], rms: -17, peak: -3 },
  shieldpop: { layers: [L('Impact Sounds/impactGlass_medium_001.ogg'), L('Sci-Fi Sounds/forceField_003.ogg', { at: 0.02, g: -9, len: 0.4 })], len: 0.5, fade: [0, 0.1], rms: -15, peak: -3 },
  repair: { layers: [L('RPG Audio/metalLatch.ogg'), L('RPG Audio/metalClick.ogg', { at: 0.14, g: 2 }), L('Interface Sounds/confirmation_003.ogg', { at: 0.3, g: -5 })], len: 0.8, fade: [0, 0.15], rms: -15, peak: -3 },
};

// ------------------------------------------------------------------ render

// collision families: the game trims each family to this RMS over the first 0.3 s (audio.ts FAMILY_RMS); we deliver them already there
const FAM_RMS = { impact_light: 0.11, impact_heavy: 0.2, impact_wood: 0.16, impact_metal: 0.16, impact_concrete: 0.19, impact_plastic: 0.126, crunch: 0.09, debris: 0.07 };
/** soft-knee limiter: samples above the knee are bent towards the ceiling with tanh (no hard clipping) */
function softLimit(chs, ceil) {
  const T = ceil * 0.55, R = ceil - T;
  for (const d of chs) for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > T) d[i] = Math.sign(d[i]) * (T + R * Math.tanh((a - T) / R)); }
}
function level(name, chs, r) {
  const fam = name.replace(/_\d+$/, '');
  const targetDb = r.rms != null ? r.rms : FAM_RMS[fam] ? dB(FAM_RMS[fam]) : null;
  const win = r.rms == null && FAM_RMS[fam] ? 0.3 : null;
  const ceil = lin(r.peak ?? -3);
  const g0 = ceil / Math.max(1e-6, peakOf(chs));
  const scaled = (g) => chs.map((d) => { const o = new Float32Array(d.length); for (let i = 0; i < d.length; i++) o[i] = d[i] * g; return o; });
  const meas = (o) => rmsOf(win ? cut(o, 0, win) : o);
  if (targetDb == null) return scaled(g0);
  const want = lin(targetDb);
  if (r.limit === false) return scaled(Math.min(g0, want / Math.max(1e-6, meas(chs))));
  let lo = 0.05, hi = 14, best = g0;   // multiplier on top of the peak-normalised gain, searched on a log scale
  for (let k = 0; k < 24; k++) {
    const m = Math.sqrt(lo * hi), o = scaled(g0 * m); softLimit(o, ceil);
    if (meas(o) < want) lo = m; else hi = m;
    best = g0 * m;
  }
  const o = scaled(best); softLimit(o, ceil);
  return o;
}
function render(name, r) {
  const nch = r.stereo ? 2 : 1;
  const mix = Array.from({ length: nch }, () => new Float32Array(Math.round(130 * SR)));
  let end = 0;
  for (const ly of r.layers) {
    let a = decode(findSrc(ly.f), nch);
    const isRef = ly.f === '@music' || ly.f.startsWith('@racing/');
    if (r.trim !== false && !isRef || (isRef && r.trim)) a = trimLead(a);
    a = cut(a, ly.from ?? 0, ly.len ?? null);
    const g = lin(ly.g ?? 0), at = Math.round((ly.at ?? 0) * SR);
    a = a.map((d) => (ly.lp ? onePole(d, ly.lp, false) : ly.hp ? onePole(d, ly.hp, true) : d));
    const size = Math.max(...a.map((d) => d.length));
    if (at + size > mix[0].length) throw new Error(name + ': too long');
    for (let c = 0; c < nch; c++) { const d = a[c]; for (let i = 0; i < d.length; i++) mix[c][at + i] += d[i] * g; }
    end = Math.max(end, at + size);
  }
  let out = mix.map((d) => d.slice(0, r.len ? Math.min(end, Math.round(r.len * SR)) : end));
  if (r.trimTail) { let n = out[0].length; while (n > SR && out.every((d) => Math.abs(d[n - 1]) < 0.004)) n--; out = out.map((d) => d.subarray(0, n)); }
  if (r.fade) fade(out, r.fade[0], r.fade[1]);
  if (r.loop) out = xfadeLoop(out, r.loop);
  out = level(name, out, r);
  if (!r.loop && !r.fade) fade(out, 0.0005, 0.004);   // never end on a click
  return out;
}

function encode(name, chs) {
  const nch = chs.length, n = chs[0].length;
  const pcm = Buffer.alloc(n * nch * 4);
  for (let i = 0; i < n; i++) for (let c = 0; c < nch; c++) pcm.writeFloatLE(chs[c][i], (i * nch + c) * 4);
  const base = ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', String(nch), '-i', 'pipe:0', '-map_metadata', '-1'];
  const music = nch === 2;
  const jobs = [
    [...base, '-c:a', 'libvorbis', ...(music ? ['-b:a', '64k'] : ['-q:a', '3']), join(OUT, name + '.ogg')],
    [...base, '-c:a', 'libmp3lame', ...(music ? ['-b:a', '64k'] : ['-b:a', '80k']), '-write_xing', '1', join(OUT, name + '.mp3')],
  ];
  for (const j of jobs) { const r = spawnSync('ffmpeg', j, { input: pcm, maxBuffer: 1 << 28 }); if (r.status !== 0) throw new Error('encode failed ' + name + ' ' + r.stderr); }
}

mkdirSync(OUT, { recursive: true });
for (const [name, r] of Object.entries(RECIPES)) {
  if (ONLY && !ONLY.includes(name)) continue;
  const chs = render(name, r);
  const dur = chs[0].length / SR;
  console.log(name.padEnd(18), dur.toFixed(2).padStart(6) + ' s', 'peak', dB(peakOf(chs)).toFixed(1), 'rms', dB(rmsOf(chs)).toFixed(1));
  if (!DRY) encode(name, chs);
}
