// QA: instrumented audio test (nobody can listen in CI, so we measure).
// usage: node scripts/audio-test.mjs [--url=http://localhost:5190/] [--only=sfx|storm|music|slow]
// Loads src/audio/audio.ts + src/core/bus.ts in headless Chromium on an empty page (no game running), taps the
// engine's output with a sample-accurate meter and checks: every event is audible, nothing clips even under a
// break-storm, no NaN, music sounds in every state / intensity, voices drain to zero, console is clean.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const url = opt.url || 'http://localhost:5190/';
const only = opt.only || '';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = '<!doctype html><html><head><meta charset="utf-8"></head><body>audio test</body></html>';

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); return ok; };
const f3 = (x) => (x == null ? '   -  ' : x.toFixed(3).padStart(6));
const db = (x) => (x > 0 ? (20 * Math.log10(x)).toFixed(1).padStart(6) : '  -inf');

async function open(initScript) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage(); const log = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => log.push('pageerror: ' + e.message));
  if (initScript) await page.addInitScript(initScript);
  await page.route('**/__audio_test.html', (r) => r.fulfill({ contentType: 'text/html', body: HTML }));
  await page.goto(url + '__audio_test.html');
  return { page, log };
}

// ---------------------------------------------------------------- 0. no WebAudio → everything is a no-op
{
  const { page, log } = await open(() => { delete window.AudioContext; delete window.webkitAudioContext; window.AudioContext = undefined; window.webkitAudioContext = undefined; });
  const r = await page.evaluate(async () => {
    const { audio } = await import('/src/audio/audio.ts'); const { bus } = await import('/src/core/bus.ts');
    audio.init(); audio.init(); audio.resume(); audio.suspend(); audio.setVolumes(1, 1, 1); audio.setTimeScale(0.16); audio.setState('run'); audio.setIntensity(1); audio.setBiome('tower');
    bus.emit('jump', { fromX: 0, fromY: 0, toX: 5, toY: 0, heavy: true, carried: 2, speed: 9 }); bus.emit('break', { x: 0, y: 0, mat: 'glass', area: 1, energy: 3 }); bus.emit('uiClick', {});
    return { ready: audio.ready, tap: audio._debugTap() };
  });
  const errs = log.filter((l) => !l.startsWith('warning: [audio]'));
  check(r.ready === false && r.tap === null, 'no-WebAudio: engine should stay not ready');
  check(errs.length === 0, 'no-WebAudio: console errors: ' + errs.join(' | '));
  check(log.length <= 1, 'no-WebAudio: should warn at most once, got ' + log.length);
  console.log(`[0] WebAudio unavailable → no-op: ready=${r.ready}, warnings=${log.length} (dev-only, once), errors=${errs.length}`);
  await page.context().close();
}

// ---------------------------------------------------------------- harness
const { page, log } = await open();
const boot = await page.evaluate(async () => {
  const { audio } = await import('/src/audio/audio.ts'); const { bus } = await import('/src/core/bus.ts');
  // before init: events are silently ignored, setters are remembered
  bus.emit('jump', { fromX: 0, fromY: 0, toX: 5, toY: 0, heavy: false, carried: 0, speed: 3 }); bus.emit('uiStamp', {});
  audio.setState('menu'); audio.setVolumes(1, 1, 0);
  const before = audio.ready;
  audio.init(); audio.init(); // second call must be harmless
  const tap = audio._debugTap(), pre = audio._debugTap('pre'), ctx = tap.context;
  // sample-accurate meter on the audio thread (peak, energy, a brightness proxy, NaN count)
  const code = `class Meter extends AudioWorkletProcessor {
    constructor() { super(); this.z(); this.last = 0; this.port.onmessage = (e) => { if (e.data === 'reset') this.z(); else this.port.postMessage({ id: e.data, peak: this.peak, sum: this.sum, hf: this.hf, n: this.n, nan: this.nan }); }; }
    z() { this.peak = 0; this.sum = 0; this.hf = 0; this.n = 0; this.nan = 0; }
    process(inputs) {
      const inp = inputs[0]; if (!inp || !inp.length) return true;
      for (let ch = 0; ch < inp.length; ch++) { const d = inp[ch];
        for (let i = 0; i < d.length; i++) { const x = d[i]; if (x !== x || x === Infinity || x === -Infinity) { this.nan++; continue; }
          const a = x < 0 ? -x : x; if (a > this.peak) this.peak = a; this.sum += x * x / inp.length;
          if (ch === 0) { const df = x - this.last; this.hf += df * df; this.last = x; } } }
      this.n += inp[0].length; return true;
    } }
    registerProcessor('meter', Meter);`;
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));
  let seq = 0; const waiters = new Map();
  const mk = (node) => {
    const w = new AudioWorkletNode(ctx, 'meter', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' }), z = ctx.createGain(); z.gain.value = 0;
    w.port.onmessage = (e) => { const f = waiters.get(e.data.id); if (f) { waiters.delete(e.data.id); f(e.data); } };
    node.connect(w); w.connect(z); z.connect(ctx.destination);
    return { reset: () => w.port.postMessage('reset'), read: () => new Promise((res) => { const id = ++seq; waiters.set(id, res); w.port.postMessage(id); }) };
  };
  const out = mk(tap), prm = mk(pre);
  const rd = (m) => ({ peak: m.peak, rms: m.n ? Math.sqrt(m.sum / m.n) : 0, hf: m.sum > 0 ? m.hf / m.sum : 0, nan: m.nan, n: m.n });
  window.__t = {
    audio, bus, ctx,
    reset() { out.reset(); prm.reset(); },
    async read() { const [a, b] = await Promise.all([out.read(), prm.read()]); return { out: rd(a), pre: rd(b), stats: audio._debugStats(), time: ctx.currentTime }; },
  };
  await new Promise((r) => setTimeout(r, 300));
  return { before, ready: audio.ready, state: ctx.state, sr: ctx.sampleRate, t: ctx.currentTime };
});
console.log(`[boot] ready before init=${boot.before}, after=${boot.ready}, ctx=${boot.state}, ${boot.sr} Hz, t=${boot.t.toFixed(2)}`);
check(boot.before === false && boot.ready === true, 'ready flag wrong');
check(boot.state === 'running' && boot.t > 0, 'AudioContext is not running in the test browser');

const sleep = (ms) => page.waitForTimeout(ms);
const read = () => page.evaluate(() => window.__t.read());
const reset = () => page.evaluate(() => window.__t.reset());
const emit = (name, p) => page.evaluate(([n, q]) => window.__t.bus.emit(n, q), [name, p || {}]);
const call = (fn, ...a) => page.evaluate(([f, args]) => window.__t.audio[f](...args), [fn, a]);
async function silence(max = 6000) { // wait for tails to die
  const t0 = Date.now();
  for (;;) { await reset(); await sleep(140); const r = await read(); if (r.out.peak < 3e-4 || Date.now() - t0 > max) return r.out.peak; }
}
let nanTotal = 0;
const note = (r) => { nanTotal += r.out.nan + r.pre.nan; return r; };

// ---------------------------------------------------------------- 1. every event makes a sound
const J = (o) => ({ fromX: 0, fromY: 0, toX: 6, toY: -1, heavy: false, carried: 0, speed: 6, ...o });
const SFX = [
  ['jump', J({}), 'light'], ['jump', J({ toX: 13, speed: 20 }), 'far+fast'], ['jump', J({ heavy: true, carried: 5, toX: -9 }), 'heavy', 1200],
  ['jumpDenied', { reason: 'charges' }], ['jumpDenied', { reason: 'anchor' }], ['jumpDenied', { reason: 'blocked' }],
  ['aimStart', {}], ['aimEnd', {}],
  ['break', { x: 2, y: 0, mat: 'glass', area: 1.4, energy: 6 }, 'glass', 900], ['break', { x: -2, y: 0, mat: 'wood', area: 0.3, energy: 6 }, 'wood'], ['break', { x: 1, y: 0, mat: 'crate', area: 0.25, energy: 4 }, 'crate'],
  ['break', { x: 3, y: 0, mat: 'concrete', area: 0.6, energy: 9 }, 'concrete', 900], ['break', { x: 3, y: 0, mat: 'brick', area: 0.25, energy: 5 }, 'brick', 900], ['break', { x: 0, y: 0, mat: 'plaster', area: 0.4, energy: 3 }, 'plaster', 900],
  ['collapse', { x: 4, y: 0, mass: 1800 }, '', 2600],
  ['impact', { x: 1, y: 0, force: 40, mat: 'glass' }, 'glass'], ['impact', { x: 1, y: 0, force: 300, mat: 'wood' }, 'wood'], ['impact', { x: 1, y: 0, force: 900, mat: 'concrete' }, 'concrete'],
  ['explode', { x: 3, y: 0, r: 3 }, '', 1500],
  ['strike', { x: 1, y: 0, power: 20, kill: false }, 'hit'], ['strike', { x: 1, y: 0, power: 30, kill: true }, 'kill'],
  ['enemyHit', { x: 2, y: 0, dmg: 30, kind: 'clerk', cause: 'strike' }], ['enemyDie', { x: 2, y: 0, kind: 'clerk', cause: 'wall', elite: false }, 'normal'], ['enemyDie', { x: 2, y: 0, kind: 'proof', cause: 'wall', elite: true }, 'elite', 900],
  ['enemyShoot', { x: 5, y: 0, kind: 'clerk' }], ['enemyAlert', { x: 5, y: 0, kind: 'clerk' }], ['enemyTelegraph', { x: 5, y: 0, kind: 'clerk' }],
  ['playerHurt', { hp: 2, maxHp: 5, cause: 'shot' }], ['playerDie', {}, '', 1800], ['playerLand', { speed: 14, x: 0, y: 0 }], ['playerStep', { x: 0, y: 0 }], ['playerJump', {}],
  ['grab', { kind: 'debris' }], ['throwIt', { power: 22 }], ['combo', { n: 3, mult: 1.5 }, 'n=3'], ['combo', { n: 10, mult: 3 }, 'n=10'], ['comboEnd', { n: 6 }],
  ['pickup', { kind: 'ink', amount: 3 }, 'ink'], ['pickup', { kind: 'hp', amount: 1 }, 'hp'], ['pickup', { kind: 'charge', amount: 1 }, 'charge'],
  ['roomStart', { index: 2, total: 9, biome: 'press', kind: 'fight', name: 'x' }, '', 900], ['roomClear', { index: 2, time: 30, flawless: true }, '', 1200], ['waveStart', { n: 2, total: 3 }],
  ['upgradeOffer', {}, '', 1200], ['upgradePicked', { id: 'x' }, '', 900], ['runStart', { seed: 1234, tier: 1, daily: false }, '', 1300],
  ['runEnd', { won: true, ink: 10, rooms: 9, time: 300 }, 'won', 1600], ['runEnd', { won: false, ink: 3, rooms: 2, time: 60 }, 'lost', 1800], ['bossPhase', { phase: 2 }, '', 1500],
  ['uiClick', {}], ['uiHover', {}], ['uiBuy', {}, '', 900], ['uiDeny', {}], ['uiOpen', { screen: 'shop' }], ['uiStamp', {}], ['achievement', { id: 'x' }, '', 1300],
  ['pause', { on: true }, 'on'], ['pause', { on: false }, 'off'], ['hint', { id: 'x' }],
];
{ // the list above must cover the whole Events interface
  const src = fs.readFileSync(path.join(root, 'src/core/bus.ts'), 'utf8');
  const body = src.slice(src.indexOf('export interface Events'), src.indexOf('type Fn<T>'));
  const names = [...body.matchAll(/(?:^|[\s;{])([a-zA-Z]+):\s*\{/g)].map((m) => m[1]);
  const tested = new Set(SFX.map((s) => s[0]));
  const missing = [...new Set(names)].filter((n) => !tested.has(n));
  check(names.length >= 38 && missing.length === 0, 'events not covered by the test: ' + missing.join(', '));
  console.log(`[1] SFX — ${new Set(names).size} event types in bus.ts, ${SFX.length} cases (music muted, master=sfx=1)`);
}
if (!only || only === 'sfx') {
  await call('setTimeScale', 1); // slow-mo is driven explicitly from here on (aimStart/aimEnd only play their one-shots)
  console.log('  event            variant     peak    dBFS    rms    pre-clip');
  let maxPeak = 0, maxPre = 0;
  for (const [name, p, variant = '', dur = 600] of SFX) {
    await silence(); await reset(); await emit(name, p); await sleep(dur);
    const r = note(await read()); maxPeak = Math.max(maxPeak, r.out.peak); maxPre = Math.max(maxPre, r.pre.peak);
    const ok = check(r.out.peak > 0.012, `SFX ${name} ${variant}: silent (peak ${r.out.peak})`) & check(r.out.peak < 1, `SFX ${name} ${variant}: clips (${r.out.peak})`);
    console.log(`  ${name.padEnd(16)} ${String(variant).padEnd(9)} ${f3(r.out.peak)}  ${db(r.out.peak)}  ${f3(r.out.rms)}   ${f3(r.pre.peak)}  ${ok ? '' : '  <-- FAIL'}`);
  }
  console.log(`  loudest SFX peak ${f3(maxPeak)} (${db(maxPeak)} dBFS), pre-clip ${f3(maxPre)}`);
  await silence(8000); await sleep(600);
  const r = await read();
  check(r.stats.voices === 0, 'SFX voices did not drain: ' + r.stats.voices);
  console.log(`  after silence: active SFX voices = ${r.stats.voices}, dropped so far = ${r.stats.dropped}`);
}

// ---------------------------------------------------------------- 2. storms: limiter + polyphony
if (!only || only === 'storm') {
  await call('setVolumes', 1, 1, 1); await call('setBiome', 'tower'); await call('setState', 'boss'); await call('setIntensity', 1);
  await sleep(2500);
  console.log('[2] storms (music: boss/tower at intensity 1, all volumes 1)');
  const storm = async (label, fn, dur) => {
    await reset(); const before = (await read()).stats.dropped;
    await page.evaluate(fn); await sleep(dur);
    const r = note(await read());
    check(r.out.peak < 1, `${label}: output clips (${r.out.peak})`); check(r.out.nan + r.pre.nan === 0, `${label}: NaN in output`);
    check(r.stats.peakVoices <= 24, `${label}: polyphony ${r.stats.peakVoices} > 24`);
    console.log(`  ${label.padEnd(44)} peak ${f3(r.out.peak)} (${db(r.out.peak)} dBFS)  rms ${f3(r.out.rms)}  pre-clip ${f3(r.pre.peak)}  voices now ${String(r.stats.voices).padStart(2)} / max ${r.stats.peakVoices}  dropped +${r.stats.dropped - before}`);
    return r;
  };
  await storm('200 × break in 100 ms (10 bursts of 20)', () => new Promise((res) => {
    const mats = ['glass', 'wood', 'crate', 'concrete', 'brick', 'plaster']; let k = 0;
    const go = () => { for (let i = 0; i < 20; i++) window.__t.bus.emit('break', { x: Math.random() * 20 - 10, y: Math.random() * 6, mat: mats[(k + i) % 6], area: 0.2 + Math.random() * 1.2, energy: Math.random() * 20 }); if (++k < 10) setTimeout(go, 10); else res(); };
    go();
  }), 2500);
  await storm('200 × break in one frame', () => { const mats = ['glass', 'wood', 'concrete']; for (let i = 0; i < 200; i++) window.__t.bus.emit('break', { x: i % 9, y: 0, mat: mats[i % 3], area: 1, energy: 15 }); }, 2500);
  await storm('everything at once ×3 (jumps, blasts, kills)', () => new Promise((res) => {
    const b = window.__t.bus; let k = 0;
    const go = () => {
      b.emit('jump', { fromX: 0, fromY: 0, toX: 12, toY: 0, heavy: true, carried: 6, speed: 24 }); b.emit('explode', { x: 1, y: 0, r: 4 }); b.emit('collapse', { x: 0, y: 0, mass: 5000 });
      b.emit('strike', { x: 0, y: 0, power: 40, kill: true }); b.emit('playerHurt', { hp: 1, maxHp: 5, cause: 'x' }); b.emit('uiStamp', {}); b.emit('bossPhase', { phase: 3 }); b.emit('enemyDie', { x: 0, y: 0, kind: 'a', cause: 'b', elite: true });
      for (let i = 0; i < 60; i++) { b.emit('break', { x: 0, y: 0, mat: i % 2 ? 'glass' : 'concrete', area: 1.5, energy: 20 }); b.emit('impact', { x: 0, y: 0, force: 3000, mat: 'concrete' }); b.emit('enemyHit', { x: 0, y: 0, dmg: 50, kind: 'a', cause: 'b' }); }
      if (++k < 3) setTimeout(go, 120); else res();
    };
    go();
  }), 3500);
  await storm('40 light jumps, one every 60 ms', () => new Promise((res) => {
    let k = 0; const go = () => { window.__t.bus.emit('jump', { fromX: 0, fromY: 0, toX: 4 + k % 9, toY: 0, heavy: false, carried: 0, speed: k % 20 }); if (++k < 40) setTimeout(go, 60); else res(); }; go();
  }), 1500);
  await call('setVolumes', 1, 1, 0); await call('setState', 'menu'); await call('setIntensity', 0);
  await silence(8000); await sleep(500);
  const r = await read(); check(r.stats.voices === 0, 'voices did not drain after storms: ' + r.stats.voices);
  console.log(`  after silence: active SFX voices = ${r.stats.voices}`);
}

// ---------------------------------------------------------------- 3. music: every state / biome / intensity
if (!only || only === 'music') {
  await call('setVolumes', 1, 1, 1);
  console.log('[3] music (master=music=1; default music slider is 0.7 → about −6 dB below these numbers)');
  console.log('  state    biome    int   bpm   eff   layers            rms     dBFS   peak   pre-clip  voices');
  const row = async (state, biome, inten, settle, dur, expect) => {
    await call('setBiome', biome); await call('setState', state); await call('setIntensity', inten);
    await sleep(settle); await reset(); await sleep(dur);
    const r = note(await read()), m = r.stats.music, L = m.layers;
    const ls = ['hum', L.bass ? 'bass' : '', L.press ? 'press' : '', L.lead ? 'lead' : ''].filter(Boolean).join('+');
    let ok = check(r.out.rms > 0.004, `music ${state}/${biome}/${inten}: too quiet (rms ${r.out.rms})`) & check(r.out.peak < 1, `music ${state}/${biome}/${inten}: clips`) & check(r.out.nan === 0, 'music NaN');
    if (expect) ok &= check(ls === expect, `music ${state}/${biome}/${inten}: layers ${ls}, expected ${expect}`);
    console.log(`  ${state.padEnd(8)} ${biome.padEnd(8)} ${String(inten).padEnd(4)} ${String(m.bpm).padStart(4)}  ${m.eff.toFixed(2)}  ${ls.padEnd(17)} ${f3(r.out.rms)}  ${db(r.out.rms)}  ${f3(r.out.peak)}  ${f3(r.pre.peak)}     ${String(m.voices).padStart(2)}  ${ok ? '' : '  <-- FAIL'}`);
    return r;
  };
  await row('menu', 'press', 0, 2500, 4000);
  await row('hub', 'press', 0, 2500, 4000);
  const rms = {};
  for (const biome of ['press', 'archive', 'tower']) {
    await call('setIntensity', 0); await call('setState', 'menu'); await sleep(2500); // let the intensity fall back before the climb
    rms[biome] = [];
    for (const [inten, expect] of [[0, 'hum'], [0.3, 'hum+bass'], [0.6, 'hum+bass+press'], [0.9, 'hum+bass+press+lead'], [1, 'hum+bass+press+lead']]) rms[biome].push((await row('run', biome, inten, inten === 0 ? 3200 : 2200, 3200, expect)).out.rms);
    check(rms[biome][3] > rms[biome][0] * 1.3, `music run/${biome}: intensity does not add energy (${rms[biome].map((x) => x.toFixed(3)).join(' → ')})`);
  }
  for (const biome of ['press', 'tower']) await row('boss', biome, 0.5, 3000, 3200, 'hum+bass+press');
  await row('boss', 'tower', 1, 2200, 3200, 'hum+bass+press+lead');
  await row('clear', 'press', 0.2, 2500, 3200, 'hum');
  await row('upgrade', 'press', 0.2, 2500, 3200, 'hum');
  await call('setState', 'run'); await call('setIntensity', 1); await sleep(3000);
  const dead = await row('dead', 'press', 1, 3500, 3000, 'hum');
  check(dead.stats.music.voices === 0, 'music voices did not drain in the dead state: ' + dead.stats.music.voices);
  check(dead.stats.music.cents <= -1199, 'dead state should sag an octave');
  console.log(`  dead: transient music voices = ${dead.stats.music.voices}, detune = ${dead.stats.music.cents} cents`);
}

// ---------------------------------------------------------------- 4. aim slow-mo, pause, suspend / resume
if (!only || only === 'slow') {
  await call('setVolumes', 1, 1, 1); await call('setBiome', 'press'); await call('setState', 'run'); await call('setIntensity', 1); await sleep(3500);
  const win = async (ms) => { await reset(); await sleep(ms); return note(await read()); };
  const a = await win(2200); await call('setTimeScale', 0.16); await sleep(500);
  const b = await win(2200); await call('setTimeScale', 1); await sleep(400);
  const c = await win(2200);
  console.log('[4] slow-mo (run/press, intensity 1): brightness = HF energy ratio of the output');
  console.log(`  timeScale 1.00 → brightness ${a.out.hf.toFixed(4)}  rms ${f3(a.out.rms)}  music detune ${a.stats.music.cents.toFixed(0)} c`);
  console.log(`  timeScale 0.16 → brightness ${b.out.hf.toFixed(4)}  rms ${f3(b.out.rms)}  music detune ${b.stats.music.cents.toFixed(0)} c  (slow=${b.stats.slow})`);
  console.log(`  timeScale 1.00 → brightness ${c.out.hf.toFixed(4)}  rms ${f3(c.out.rms)}  music detune ${c.stats.music.cents.toFixed(0)} c`);
  check(b.out.hf < a.out.hf * 0.35, 'slow-mo does not dull the mix'); check(c.out.hf > a.out.hf * 0.6, 'mix does not recover after slow-mo');
  check(b.stats.music.cents <= -300 && b.stats.music.cents >= -500, 'slow-mo detune should be 3–5 semitones'); check(c.stats.music.cents === 0, 'detune does not recover');
  check(b.out.rms > 0.004, 'slow-mo should not mute the world');
  await emit('pause', { on: true }); await sleep(500); const p = await win(1500); await emit('pause', { on: false }); await sleep(300);
  console.log(`  pause on       → brightness ${p.out.hf.toFixed(4)}  rms ${f3(p.out.rms)}`);
  check(p.out.hf < a.out.hf * 0.5, 'pause does not muffle the music');
  // suspend: context stops, events are dropped, nothing bursts on resume
  await call('suspend'); await sleep(300);
  const s1 = await page.evaluate(() => { const t = window.__t; for (let i = 0; i < 30; i++) t.bus.emit('jump', { fromX: 0, fromY: 0, toX: 5, toY: 0, heavy: true, carried: 0, speed: 5 }); return { state: t.ctx.state, voices: t.audio._debugStats().voices }; });
  await call('resume'); await sleep(400); const s2 = await win(800);
  console.log(`  suspend → ctx ${s1.state}, voices ${s1.voices}; resume → ctx ${s2.stats.state}, peak ${f3(s2.out.peak)}`);
  check(s1.state === 'suspended' && s1.voices === 0, 'suspend: events should be dropped'); check(s2.stats.state === 'running' && s2.out.peak < 1 && s2.out.rms > 0.004, 'resume failed');
  await call('setVolumes', 0, 1, 1); await sleep(400); const mute = await win(500);
  check(mute.out.peak < 1e-3, 'master volume 0 is not silent'); console.log(`  master volume 0 → peak ${mute.out.peak.toExponential(1)}`);
}

// ---------------------------------------------------------------- verdict
check(nanTotal === 0, 'NaN samples: ' + nanTotal);
check(log.length === 0, 'console: ' + log.slice(0, 8).join(' | '));
console.log(`[5] NaN samples: ${nanTotal}; console errors/warnings: ${log.length}${log.length ? '\n  ' + log.slice(0, 8).join('\n  ') : ''}`);
console.log(fails.length ? `\nFAIL (${fails.length})\n - ` + fails.join('\n - ') : '\nPASS — all audio checks green');
await browser.close();
process.exit(fails.length ? 1 : 0);
