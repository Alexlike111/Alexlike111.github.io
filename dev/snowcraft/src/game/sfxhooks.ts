// Adapter between game events and engine/audio.ts (owned by the audio agent). If audio.ts does not exist yet, everything is a no-op.
// API expected: sfx.init(), sfx.setMuted(b), sfx.play(name,{vol,pitch,x}), sfx.dig(matId), sfx.place(matId), sfx.step(matId,run), sfx.hit(),
// sfx.ambient({wind,storm,fire,underground,night,core,indoor}).
import { G } from './state';
import { on } from './bus';
import { fixtureNear } from './fixtures';

const mods = import.meta.glob('../engine/audio.ts', { eager: true }) as Record<string, { sfx?: Record<string, (...a: any[]) => any> }>;
const sfx = Object.values(mods)[0]?.sfx;
export const hasAudio = !!sfx;
const call = (fn: string, ...a: unknown[]) => { try { sfx?.[fn]?.(...a); } catch { /* audio must never break the game */ } };

let inited = false;
function gesture() { if (inited) return; inited = true; call('init'); if (!testing) call('music', true); removeEventListener('pointerdown', gesture); removeEventListener('keydown', gesture); }
export function initSfxHooks() {
  if (!sfx) return;
  addEventListener('pointerdown', gesture); addEventListener('keydown', gesture);
  on('dig', (d: { mat: number }) => call('dig', d.mat));
  on('dug', (d: { mat: number }) => call('dig', d.mat));
  on('placed', (d: { mat?: number; kind?: string }) => { if (d.mat !== undefined) call('place', d.mat); else call('play', 'place', { vol: 0.7 }); });
  on('step', (d: { mat: number; run: boolean }) => call('step', d.mat, d.run));
  on('hurt', () => call('hit'));
  on('jump', () => call('play', 'jump', { vol: 0.5 }));
  on('land', (d: { speed: number }) => { if (d.speed > 90) call('play', 'land', { vol: Math.min(1, d.speed / 200) }); });
  on('splash', () => call('play', 'splash', { vol: 0.9 }));
  on('ate', () => call('play', 'eat', { vol: 0.7 }));
  on('drank', () => call('play', 'drink', { vol: 0.7 }));
  on('crafted', () => call('play', 'craft', { vol: 0.7 }));
  on('fire_lit', () => call('play', 'fire_lit', { vol: 0.8 }));
  on('door', () => call('play', 'door', { vol: 0.7 }));
  on('harpoon', () => call('play', 'throw', { vol: 0.8 }));
  on('flare', () => call('play', 'flare', { vol: 0.9 }));
  on('storm_start', () => call('play', 'gust', { vol: 1 }));
  on('died', () => call('play', 'death', { vol: 1 }));
  on('frostbite', () => call('play', 'frostbite', { vol: 0.8 }));
  // fauna & ice (game/fauna.ts, game/drift.ts); distance-scaled volume
  const near = (x: number, full: number, far: number) => { const p = G.player; if (!p) return 1; const d = Math.abs(p.x - x); return d <= full ? 1 : d >= far ? 0.12 : 1 - 0.88 * (d - full) / (far - full); };
  on('dog_bark', (d: { x: number }) => call('play', 'bark', { vol: 0.9 * near(d.x, 40, 500) }));
  on('bear_roar', (d: { x: number }) => call('play', 'roar_bear', { vol: near(d.x, 80, 700) }));
  on('bear_growl', (d: { x: number }) => call('play', 'growl_bear', { vol: 0.8 * near(d.x, 80, 600) }));
  on('seal_surface', (d: { x: number }) => call('play', 'seal_breath', { vol: 0.6 * near(d.x, 30, 260) }));
  on('seal_dive', (d: { x: number }) => call('play', 'seal_splash', { vol: 0.7 * near(d.x, 30, 260) }));
  on('ice_crack', (d: { vol?: number }) => call('play', 'crack_ice', { vol: d.vol ?? 0.6, pitch: 0.85 + Math.random() * 0.3 }));
  on('ice_break', () => call('play', 'splash', { vol: 1 }));
  on('icebreaker_arrived', () => call('play', 'radio_static', { vol: 0.7 }));
}
let amb = 0;
const testing = typeof location !== 'undefined' && /selftest/.test(location.hash + location.search);
export function updateAmbient(dt: number) {
  if (!sfx || testing) return;
  amb -= dt; if (amb > 0) return; amb = 0.25;
  const p = G.player; if (!p) return;
  const fire = fixtureNear(p.x, p.y - 8, 80, f => !!f.lit);
  const fd = fire ? Math.max(0, 1 - Math.hypot(fire.tx * 4 - p.x, fire.ty * 4 - p.y) / 80) : 0;
  call('ambient', {
    wind: Math.abs(G.wind), storm: G.storm, fire: fd, underground: p.y > 330 ? Math.min(1, (p.y - 330) / 80) : 0,
    night: 1 - G.daylight, core: Math.max(0, Math.min(1, (36 - p.core) / 5)), indoor: G.shelter?.closed ? 1 : 0,
  });
}
export function setMuted(b: boolean) { call('setMuted', b); }
