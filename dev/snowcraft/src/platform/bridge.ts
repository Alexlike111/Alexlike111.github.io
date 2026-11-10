// Playgama Bridge SDK glue (Playgama requirements 1.1, 3.2.1, 3.3.4, 3.3.5, 3.4.2; Bridge «Required steps»).
// Only the PG build (`npm run build:pg`) calls initPlatform(): it awaits bridge.initialize() before storage / UI, installs the Bridge storage as the
// store backend, reads platform.language and platform.isAudioEnabled, and wires the pause / audio / interstitial events and page visibility.
// Everything here is a no-op when there is no window.bridge (preview build, tests without a fake bridge). attachBridge() is the same wiring for any
// bridge-shaped object (tests use a fake one). detachBridge() undoes it.
import { getStoreBackend, setStoreBackend, type StoreBackend } from './store';
import { G } from '../game/state';
import { on } from '../game/bus';
import { sfx } from '../engine/audio';
import { LANGS, type Lang } from '../content/i18n';

type AnyBridge = any;
const AD_WAIT_MS = 15000;      // an ad that is still not closed after this long does not hold the game (rule: a failed ad never blocks)
const AD_NOTICE_MS = 3000;     // no state event at all within this time: Bridge did not show an ad, go on at once
const DEATH_CARD_MS = 1200;    // the death card has been on screen this long before an ad may come in front of its buttons

let b: AnyBridge | null = null;
let prevBackend: StoreBackend | null = null;
let restoreMute: (() => void) | null = null;
let offs: (() => void)[] = [];
let prevPaused = false;

/** The host's language as given by Bridge (ISO 639-1 like 'ru'), null until a Bridge is attached. */
export let platformLanguage: string | null = null;
/** platform.isAudioEnabled, kept current by the audio state event. */
export let audioEnabled = true;
export let platformPaused = false, adOpen = false, pageHidden = false;
/** true while the game is paused by the platform, an ad or a hidden page (G.paused was set by us, the player's own pause is kept). */
export let pausedByHost = false;
let gameReadySent = false;
let adResolve: (() => void) | null = null, adSeen = false;
let deathAt = -1e9;

/** Playgama build: the SDK is loaded by a plain <script> before the game. Resolves when the Bridge is ready (or missing). Never throws. */
export async function initPlatform(): Promise<void> {
  if (!__PG__) return;
  const w = window as unknown as { bridge?: AnyBridge };
  if (!w.bridge) return;                                // SDK file missing: the game runs with its memory backend, without Bridge events
  try { await attachBridge(w.bridge); } catch { /* the game continues without the Bridge */ }
}

/** Wire a Bridge-shaped object: initialize, storage backend, language, audio, pause, interstitial state, page visibility. */
export async function attachBridge(bridge: AnyBridge): Promise<void> {
  b = bridge;
  try { await bridge.initialize(); } catch { /* mock mode: Bridge answers with safe defaults */ }
  if (!prevBackend) prevBackend = getStoreBackend();
  setStoreBackend(bridgeBackend(bridge));
  try { platformLanguage = typeof bridge.platform.language === 'string' ? bridge.platform.language : null; } catch { platformLanguage = null; }
  try { audioEnabled = bridge.platform.isAudioEnabled !== false; } catch { audioEnabled = true; }
  try { platformPaused = !!bridge.platform.isPaused; } catch { platformPaused = false; }
  pageHidden = typeof document !== 'undefined' && document.hidden;
  installMuteGuard();
  const E = bridge.EVENT_NAME;
  offs.push(sub(bridge.platform, E.PAUSE_STATE_CHANGED, (p: unknown) => { platformPaused = !!p; apply(); }));
  offs.push(sub(bridge.platform, E.AUDIO_STATE_CHANGED, (e: unknown) => { audioEnabled = !!e; apply(); }));
  offs.push(sub(bridge.advertisement, E.INTERSTITIAL_STATE_CHANGED, onAdState));
  if (typeof document !== 'undefined') {
    const vis = () => { pageHidden = document.hidden; apply(); };
    document.addEventListener('visibilitychange', vis);
    offs.push(() => document.removeEventListener('visibilitychange', vis));
  }
  offs.push(on('died', () => { deathAt = performance.now(); }));
  apply();
}

/** Undo attachBridge (tests): storage back to the previous backend, mute guard removed, the game unpaused if the host had paused it. */
export function detachBridge(): void {
  for (const f of offs) f();
  offs = [];
  if (prevBackend) setStoreBackend(prevBackend);
  prevBackend = null;
  restoreMute?.(); restoreMute = null;
  if (pausedByHost) { G.paused = prevPaused; pausedByHost = false; }
  adOpen = false; platformPaused = false; pageHidden = false; audioEnabled = true; adResolve = null;
  b = null; platformLanguage = null; gameReadySent = false;
}

export const bridgeAttached = () => b !== null;

function sub(target: AnyBridge, evt: string, fn: (d: unknown) => void): () => void {
  try { target.on(evt, fn); return () => { try { target.off?.(evt, fn); } catch { /* ignore */ } }; } catch { return () => {}; }
}

// ---- pause and mute ------------------------------------------------------------------------------------------------------------
/** The game pauses while the host pauses it, an ad is open or the page is hidden; the player's own pause (G.paused before) is kept on resume. */
function apply(): void {
  const should = platformPaused || adOpen || pageHidden;
  if (should && !pausedByHost) { pausedByHost = true; prevPaused = G.paused; G.paused = true; }
  else if (!should && pausedByHost) { pausedByHost = false; G.paused = prevPaused; }
  pushMute();
}
let playerMuted = false;
let rawSetMuted: ((m: boolean) => void) | null = null;
/** Audio out: muted when the player muted it, when the platform has audio off (also after a reload), or while the game is paused by the host. */
function pushMute(): void { rawSetMuted?.(playerMuted || !audioEnabled || pausedByHost); }
/** sfx.setMuted is called by the menu (player's mute) and the sound hooks; the guard keeps the player's choice apart from the host's. */
function installMuteGuard(): void {
  if (rawSetMuted) return;
  const raw = sfx.setMuted;
  rawSetMuted = (m: boolean) => { try { raw(m); } catch { /* audio is optional */ } };
  sfx.setMuted = (m: boolean) => { playerMuted = !!m; pushMute(); };
  restoreMute = () => { sfx.setMuted = (m: boolean) => raw(m); rawSetMuted = null; playerMuted = false; };
}

// ---- interstitials -------------------------------------------------------------------------------------------------------------
function onAdState(st: unknown): void {
  adSeen = true;
  if (st === 'opened') { adOpen = true; apply(); }
  else if (st === 'closed' || st === 'failed') { adOpen = false; apply(); const r = adResolve; adResolve = null; r?.(); }
}
/** Show an interstitial at a natural pause and resolve when it is closed, failed or the wait is over. Never rejects, never blocks longer than AD_WAIT_MS. */
export function showInterstitial(placement: string): Promise<void> {
  if (!b) return Promise.resolve();
  try { if (!b.advertisement.isInterstitialSupported) return Promise.resolve(); } catch { return Promise.resolve(); }
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(t1); clearTimeout(t2); if (adResolve === finish) adResolve = null; resolve(); };
    adResolve = finish; adSeen = false;
    const t1 = setTimeout(() => { if (!adSeen) finish(); }, AD_NOTICE_MS);
    const t2 = setTimeout(finish, AD_WAIT_MS);
    try { b.advertisement.showInterstitial(placement); } catch { finish(); }
  });
}
/** The death card's buttons (overlay.ts) go through this: the new run (or the return to the station) waits for the interstitial. */
export function gateRun(kind: 'new_run' | 'game_over', go: () => void): void {
  if (!__PG__ || !b || performance.now() - deathAt < DEATH_CARD_MS) { go(); return; }
  void showInterstitial(kind).then(go, go);
}

// ---- lifecycle messages --------------------------------------------------------------------------------------------------------
/** game_ready once, when the first interactive frame (the title screen) is up. */
export function gameReady(): void {
  if (!__PG__ || !b || gameReadySent) return;
  gameReadySent = true;
  try { void Promise.resolve(b.platform.sendMessage('game_ready')).catch(() => { /* ignore */ }); } catch { /* ignore */ }
}

// ---- language ------------------------------------------------------------------------------------------------------------------
/** PG build language: the stored player choice, else platform.language (2-letter code), else English. Never reads navigator.language. */
export function pgLanguage(stored: string | null): Lang {
  const ok = (x: string | null | undefined): x is Lang => (LANGS as readonly string[]).includes(x ?? '');
  if (ok(stored)) return stored;
  const code = (platformLanguage ?? '').slice(0, 2).toLowerCase();
  return ok(code) ? code : 'en';
}

// ---- storage -------------------------------------------------------------------------------------------------------------------
/** Bridge storage as a store backend: every call carries all its keys in one array; values are strings (JSON parsing turned off). */
function bridgeBackend(bridge: AnyBridge): StoreBackend {
  const str = (v: unknown): string | null => (v === undefined || v === null ? null : typeof v === 'string' ? v : JSON.stringify(v));
  return {
    immediate: false,                                   // settings are batched by store.ts (one call per flush)
    async get(keys) {
      const r = await bridge.storage.get(keys, false);
      if (Array.isArray(r)) return keys.map((_, i) => str(r[i]));
      return keys.map(k => str(r?.[k]));
    },
    async set(keys, values) { await bridge.storage.set(keys, values); },
    async remove(keys) { await bridge.storage.delete(keys); },
  };
}
