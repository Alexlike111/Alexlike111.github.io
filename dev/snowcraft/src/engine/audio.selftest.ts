// In-game self-test for procedural audio (SPEC §11). Imported by main.ts (side effect: registers the tests).
// Checks: init, every named sound builds and renders (offline, no NaN, not silent, not clipping), material sounds,
// ambient smoothing, mute/volume, spatial play, voice limit and the music bed. Restores mute/volume/music at the end.
// Determinism: the game feeds sfx.ambient from its own state (sfxhooks.updateAmbient) unless the page URL has «selftest», so each test that sets
// the ambience takes it over (takeAmbient) and gives it back at its end. Gains and voices move in audio time, so the tests wait until a reading
// has settled (settle / waitUntil) instead of for a fixed time. The noise of the synthesis checks comes from a seeded Math.random (seeded).
import { registerTest } from '../game/selftest';
import type { TestCtx } from '../game/selftest';
import { G } from '../game/state';
import { MATS } from '../content/materials';
import { sfx, renderOffline, soundNames, type AmbientOpts } from './audio';

// Every sound name the game and the spec use (SPEC/brief list). All must exist in audio.ts.
const REQUIRED = [
  'cut_block', 'place_block', 'shovel_scoop', 'shovel_throw', 'chisel', 'chop', 'pick', 'saw', 'crack_ice', 'ice_break', 'splash',
  'fire_ignite', 'fire_out', 'lamp_light', 'match_strike', 'pot_boil', 'craft', 'pickup', 'drop', 'eat', 'drink', 'ui_click', 'ui_open',
  'ui_close', 'ui_deny', 'objective', 'hurt', 'death', 'heartbeat', 'shiver', 'breath_cold', 'door_open', 'door_close', 'chest_open',
  'sleep', 'wake', 'bark', 'dog_whine', 'growl_bear', 'roar_bear', 'seal_breath', 'seal_splash', 'fox_yip', 'ptarmigan', 'bird_flap',
  'explosion', 'collapse', 'rumble', 'avalanche', 'wind_gust', 'storm_front', 'radio_static', 'radio_voice', 'icebreaker_horn',
  'flare_shot', 'flare_burn', 'dawn', 'win', 'harpoon_throw', 'harpoon_hit', 'fish_bite', 'reel',
];

const hasCtx = () => typeof (globalThis as any).AudioContext !== 'undefined' || typeof (globalThis as any).webkitAudioContext !== 'undefined';

// ---- determinism helpers -------------------------------------------------------------------------------------------------------------------------
let ownCall = false;
/** Take the ambience over for one test: the game's own feed is dropped until the returned function puts sfx.ambient back. */
function takeAmbient(): () => void {
  const real = sfx.ambient;
  sfx.ambient = (o: AmbientOpts) => { if (ownCall) real(o); };
  return () => { sfx.ambient = real; };
}
/** The test's own ambience change (it goes through while takeAmbient is active). */
function ambient(o: AmbientOpts) { ownCall = true; try { sfx.ambient(o); } finally { ownCall = false; } }

/** Wait until a reading stops moving (3 readings in a row within 1 %), at most `max` ms. Returns the settled reading. */
async function settle(t: TestCtx, read: () => number, max = 8000): Promise<number> {
  const end = Date.now() + max;
  let last = read(), still = 0;
  while (Date.now() < end) {
    await t.wait(100);
    const v = read();
    if (Math.abs(v - last) <= Math.max(1e-4, 0.01 * Math.abs(v))) { if (++still >= 3) return v; } else still = 0;
    last = v;
  }
  return last;
}
/** Wait until a condition holds (checked every 100 ms), at most `max` ms. */
async function waitUntil(t: TestCtx, ok: () => boolean, max = 8000): Promise<boolean> {
  const end = Date.now() + max;
  while (Date.now() < end) { if (ok()) return true; await t.wait(100); }
  return ok();
}
/** Run a check with a fixed sequence of random numbers: the noise of a rendered sound must not decide a peak limit. */
async function seeded<T>(fn: () => Promise<T>): Promise<T> {
  const real = Math.random; let k = 12345;
  Math.random = () => { k = (k * 1664525 + 1013904223) >>> 0; return k / 4294967296; };
  try { return await fn(); } finally { Math.random = real; }
}

registerTest('audio', 'инициализация', async t => {
  if (!hasCtx()) { t.log('AudioContext недоступен: проверка пропущена'); return; }
  sfx.init();
  sfx.init();
  sfx.init();
  t.expect(sfx.stats().ready, 'AudioContext создан после init()');
  t.expect(sfx.stats().state !== 'closed', 'контекст не закрыт');
});

registerTest('audio', 'все именованные звуки проигрываются', async t => {
  const names = soundNames();
  const missing = REQUIRED.filter(n => !names.includes(n));
  t.expect(missing.length === 0, 'нет звуков из списка: ' + missing.join(', '));
  let errors = 0;
  for (const n of REQUIRED) {
    try { sfx.play(n, { vol: 0 }); } catch (e) { errors++; t.log(`${n}: ${String(e)}`); }
  }
  t.expect(errors === 0, `ошибок при play(): ${errors}`);
  let quiet = 0;
  try { sfx.play('no_such_sound_xyz'); sfx.play('', {}); sfx.play('_step_snow'); } catch (e) { quiet++; t.log(String(e)); }
  t.expect(quiet === 0, 'неизвестные имена игнорируются без ошибок');
  t.metric('именованных звуков', REQUIRED.length);
});

registerTest('audio', 'синтез: без NaN, не тихо, без клиппинга', async t => {
  if (!hasCtx()) { t.log('пропущено'); return; }
  await seeded(async () => {
    let bad = 0, silent = 0, hot = 0, rendered = 0, peakMax = 0, peakName = '';
    for (const n of REQUIRED) {
      const s = await renderOffline(n, { vol: 1 }, 3.5);
      if (!s) { bad++; t.log(`${n}: не отрисован`); continue; }
      rendered++;
      let peak = 0;
      let finite = true;
      for (let i = 0; i < s.length; i++) {
        const v = s[i];
        if (!Number.isFinite(v)) { finite = false; break; }
        const a = v < 0 ? -v : v;
        if (a > peak) peak = a;
      }
      if (!finite) { bad++; t.log(`${n}: NaN/Infinity`); continue; }
      if (peak < 1e-4) { silent++; t.log(`${n}: тишина (peak ${peak.toExponential(1)})`); }
      if (peak > 1.6) { hot++; t.log(`${n}: перегруз peak ${peak.toFixed(2)}`); }
      if (peak > peakMax) { peakMax = peak; peakName = n; }
    }
    t.expect(rendered === REQUIRED.length, `отрисовано ${rendered} из ${REQUIRED.length}`);
    t.expect(bad === 0, `нечисловых или неотрисованных: ${bad}`);
    t.expect(silent === 0, `беззвучных: ${silent}`);
    t.expect(hot === 0, `перегруженных (peak > 1.6): ${hot}`);
    t.metric('самый громкий звук peak', Number(peakMax.toFixed(3)), peakName);
  });
});

registerTest('audio', 'звуки материалов', async t => {
  if (!hasCtx()) { t.log('пропущено'); return; }
  sfx.init();
  let errors = 0;
  for (let m = 0; m < MATS.length; m++) {
    try { sfx.dig(m); sfx.place(m); sfx.step(m, false); sfx.step(m, true); } catch (e) { errors++; t.log(`mat ${m}: ${String(e)}`); }
  }
  // out-of-range ids must be ignored
  try { sfx.dig(9999); sfx.place(-1); sfx.step(9999, true); } catch (e) { errors++; t.log(String(e)); }
  t.expect(errors === 0, `ошибок на материалах: ${errors}`);
  const amb = G.ambientT;
  G.ambientT = -30;
  try { sfx.step(0, false); } catch (e) { t.expect(false, 'шаг на морозе: ' + String(e)); }
  G.ambientT = amb;
  t.metric('материалов', MATS.length);
});

registerTest('audio', 'ambient сглаженно обновляется', async t => {
  if (!hasCtx()) { t.log('пропущено'); return; }
  sfx.init();
  const release = takeAmbient();
  try {
    const calm = { wind: 0, storm: 0, fire: 0, underground: 0, night: 0, core: 36.5, indoor: 0 };
    const gale = { wind: 20, storm: 0.8, fire: 0.5, underground: 0, night: 1, core: 34, indoor: 0 };
    const wind = () => sfx.stats().windGain;
    ambient(calm);
    const calmGain = await settle(t, wind);
    ambient(gale);
    const galeGain = await settle(t, wind);
    t.metric('ветер: штиль / шторм, усиление', Number(galeGain.toFixed(3)), 'calm ' + calmGain.toFixed(3));
    t.expect(galeGain > calmGain * 2 && galeGain > 0.05, `шторм громче штиля (${calmGain.toFixed(3)} → ${galeGain.toFixed(3)})`);
    // indoor and underground muffle the wind
    ambient({ ...gale, indoor: 1, underground: 1 });
    const muffled = await settle(t, wind);
    t.expect(muffled < galeGain, 'в помещении и под землёй ветер тише');
    // non-finite and out-of-range values must not break anything
    ambient({ wind: NaN, storm: 9, fire: -1, underground: Infinity, night: 2, core: NaN, indoor: -3 } as any);
    await t.wait(200);
    t.expect(Number.isFinite(sfx.stats().windGain), 'плохие значения ambient не ломают граф');
    ambient(calm);
    await settle(t, wind);
  } finally { release(); }
});

registerTest('audio', 'mute и громкость', async t => {
  if (!hasCtx()) { t.log('пропущено'); return; }
  sfx.init();
  sfx.setVolume(0.8, 0.45);
  sfx.setMuted(true);
  await settle(t, () => sfx.stats().masterGain, 3000);
  t.expect(sfx.stats().muted && sfx.stats().masterGain < 0.001, 'при mute мастер-громкость 0');
  sfx.setMuted(false);
  await settle(t, () => sfx.stats().masterGain, 3000);
  t.expect(!sfx.stats().muted && sfx.stats().masterGain > 0.5, 'после unmute громкость вернулась');
  sfx.setVolume(0.2, 0.2);
  await settle(t, () => sfx.stats().masterGain, 3000);
  t.expect(Math.abs(sfx.stats().masterGain - 0.18) < 0.02, 'setVolume(0.2) задаёт мастер ~0.18');
  sfx.setVolume(0.8, 0.45);
});

registerTest('audio', 'пространственный звук и голоса', async t => {
  if (!hasCtx()) { t.log('пропущено'); return; }
  sfx.init();
  const cx = G.cam.x;
  let errors = 0;
  for (const dx of [-600, -200, 0, 150, 500]) {
    try { sfx.play('chop', { x: cx + dx, vol: 0 }); sfx.play('explosion', { x: cx + dx, vol: 0 }); } catch (e) { errors++; t.log(String(e)); }
  }
  t.expect(errors === 0, 'play с координатой x не падает');
  const before = sfx.stats().voices;
  for (let i = 0; i < 90; i++) sfx.play('shovel_scoop', { vol: 0.001, x: cx + (i % 7) * 30 - 90 });
  const after = sfx.stats().voices;
  t.metric('голосов после 90 play', after, 'до ' + before);
  t.expect(after <= 28, `лимит голосов соблюдён (${after} ≤ 28)`);
  // the voices end with their sounds (audio time): wait for them, do not count on a fixed delay
  const freed = await waitUntil(t, () => sfx.stats().voices < 28, 6000);
  t.expect(freed, 'голоса освобождаются по окончании звука');
});

registerTest('audio', 'музыкальная подложка', async t => {
  if (!hasCtx()) { t.log('пропущено'); return; }
  sfx.init();
  const release = takeAmbient();
  try {
    sfx.music(true);
    await settle(t, () => sfx.stats().musicGain, 4000);
    const on = sfx.stats();
    t.expect(on.music && on.musicGain > 0.01, `музыка играет (gain ${on.musicGain.toFixed(3)})`);
    // compare calm and storm under identical conditions; a dawn swell (boost) may still be active from the ambient test, so both readings
    // are taken after the swell has passed or with the same boost, which the settle waits for
    const music = () => sfx.stats().musicGain;
    ambient({ wind: 2, storm: 0, fire: 0, underground: 0, night: 0, core: 36.5, indoor: 0 });
    const calm = await settle(t, music);
    ambient({ wind: 20, storm: 1, fire: 0, underground: 0, night: 0, core: 36.5, indoor: 0 });
    const storm = await settle(t, music);
    t.expect(storm < calm, `в шторм музыка тише (${calm.toFixed(3)} → ${storm.toFixed(3)})`);
    ambient({ wind: 0, storm: 0, fire: 0, underground: 0, night: 0, core: 36.5, indoor: 0 });
    sfx.music(false);
    const off = await waitUntil(t, () => sfx.stats().musicGain < 0.01, 8000);
    t.expect(off, 'музыка выключается: ' + sfx.stats().musicGain.toFixed(3));
  } finally { release(); }
}, 40000);
