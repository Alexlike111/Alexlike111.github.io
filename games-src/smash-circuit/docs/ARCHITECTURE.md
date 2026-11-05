# Architecture & module contracts

Stack: TypeScript, Vite 8, Three.js 0.187, planck 1.4 (2D physics), @playgama/bridge 2.4 (injected by Vite plugin, local mode), Vitest, Playwright (preinstalled globally, `require('playwright')`).

Hard rules
- Shared types: `src/types.ts`. All numbers: `src/config.ts` (`CONFIG`). Add new constants to config, never inline balance numbers. If you need a new shared type, add it to YOUR module and export it; do not edit `types.ts`/`config.ts` except APPENDING new keys under your own section (note it in your report).
- Simulation (`src/sim`, `src/track`, `src/meta`) has NO dependency on three.js or DOM — it must run in Vitest under Node.
- Render (`src/render`) reads sim state only (ISim, TrackGeometry, DestructibleState, SimEvent). It never mutates the sim.
- No `localStorage`/`sessionStorage`/cookies anywhere: save only through `src/platform/bridge.ts` (Bridge storage).
- No external network resources at runtime. No emoji as icons (use inline SVG/CSS). Never bind Esc.
- All player-visible strings via `t('key')` from `src/i18n.ts` (en + ru, en default/fallback).
- Coordinates: physics (x, y) metres ↔ three.js (x, height, y). Angle 0 = +x, CCW positive.
- Deterministic sim: use `src/sim/rng.ts` (seeded), never Math.random inside sim.

## Module map (owner = build agent)

### A — Physics & car (`src/sim/world.ts`, `src/sim/carModel.ts`, `src/sim/damage.ts`, `src/sim/car.ts`, `src/sim/rng.ts`)
```ts
// rng.ts
export function makeRng(seed: number): () => number;            // mulberry32, [0,1)

// carModel.ts — PURE arcade model (no planck). Planck integrates position; we set velocities.
export interface CarKinematics { x: number; y: number; angle: number; vx: number; vy: number; angularVel: number; steer: number }
export interface Surface { gripMul: number; drag: number; shake: number } // road {1,0,0}, curb, grass, hole
export function integrateCar(k: CarKinematics, input: CarInput, stats: CarStats, fx: DamageEffects, surface: Surface, dt: number): CarKinematics; // returns new vx, vy, angularVel, steer (x,y,angle unchanged)
export function forwardSpeed(k: CarKinematics): number;
export function lateralSpeed(k: CarKinematics): number;
export function baseStats(): CarStats;                           // from CONFIG.car

// damage.ts — PURE
export function createZoneHp(max?: number): ZoneHp;
export function zoneForLocalPoint(lx: number, ly: number): ZoneId[]; // car frame: +x nose, +y left. returns 1-2 zones (body zone + nearest wheel)
export function applyImpulseDamage(hp: ZoneHp, lx: number, ly: number, impulse: number, armor: number, mul?: number): { zones: ZoneId[]; damage: number };
export function computeEffects(hp: ZoneHp, max: number): DamageEffects;
export function totalHealth(hp: ZoneHp, max: number): number;    // 0..1
export function partsToDetach(hp: ZoneHp, already: CarPart[]): CarPart[];
export function missingHp(hp: ZoneHp, max: number): number;

// world.ts
export class PhysicsWorld {
  world: planck.World;
  constructor();
  /** fixed step dt = CONFIG.physics.dt; runs queued removals AFTER world.step */
  step(): void;
  queueRemoval(body: planck.Body): void;
  /** callbacks fire inside solver — only RECORD data there */
  onPostSolve(cb: (contact: planck.Contact, impulse: planck.ContactImpulse) => void): void;
  onBeginContact(cb: (c: planck.Contact) => void): void;
  onEndContact(cb: (c: planck.Contact) => void): void;
}
// Fixture userData convention: { kind: 'car', carId } | { kind: DestructibleKind, id }

// car.ts
export class SimCar {
  body: planck.Body; state: CarState; setup: CarSetup;
  constructor(pw: PhysicsWorld, setup: CarSetup, x: number, y: number, angle: number);
  setInput(i: CarInput): void;
  preStep(surface: Surface, dt: number): void;    // integrateCar -> set body velocities
  postStep(): void;                               // copy body -> state, derive slip/rpm/effects
  recordImpact(worldX: number, worldY: number, impulse: number, other: 'car' | DestructibleKind): void; // queued
  flushDamage(events: SimEvent[]): void;          // apply queued damage, emit partOff/wrecked/impact
  repair(): void;
}
```
Tests (`tests/carModel.test.ts`, `tests/damage.test.ts`): 0–100 km/h in 4.1 s ±0.4; 80–0 braking ≈ 23 m ±3; handbrake at speed + steer → slip > threshold; full lock at 15 km/h for 5 s → |lateral speed| small, no spin (heading change rate bounded, car keeps moving forward); damage threshold: impulse below threshold → 0 damage; effects monotonic.

### B — Track, destruction, editor (`src/track/spline.ts`, `src/track/tracks.ts`, `src/sim/destruction.ts`, `src/sim/surface.ts`, `editor.html`, `src/editor/editor.ts`)
```ts
// spline.ts — PURE
export function buildTrackGeometry(def: TrackDef): TrackGeometry; // closed centripetal Catmull-Rom, resampled ~1 m
// tracks.ts
export const TRACKS: TrackDef[];   // exactly 3: t1 meadow (easy, wide, 3 laps), t2 desert (medium), t3 snow (hard, tight hairpins); 600-1100 m long, with props
export function trackById(id: string): TrackDef;
// destruction.ts — ONE system for walls, guardrails, curbs, road chunks, props
export class DestructionSystem {
  states: DestructibleState[];
  constructor(pw: PhysicsWorld, track: TrackGeometry);   // builds all segments: walls/guardrails both sides (static bodies, thickness >= car travel per step), curbs (sensors) at both road edges on corners, road chunks (logical, no body), props (static or light dynamic)
  recordHit(id: number, impulse: number, x: number, y: number, vx: number, vy: number): void; // called from contact callback -> queued
  flush(events: SimEvent[]): void;     // after world step: apply hp loss, break (queueRemoval), emit 'break' (max CONFIG.destruction.maxBreaksPerStep per step, rest next step)
  hitRoad(x: number, y: number, impulse: number): void; // heavy impacts near road tear road chunks
  surfaceAt(x: number, y: number, hintS?: number): { surface: Surface; kind: 'road' | 'curb' | 'grass' | 'hole' };
  syncDynamic(): void;                 // copy dynamic prop bodies -> states
}
```
Road tearing (11.6 default "chunks fly off"): a strong car impact (wall/car crash above road threshold) damages the road chunk under the impact point; at hp ≤ 0 the chunk is marked broken → hole surface (slow, low grip), 'break' event with kind 'road' so render throws its slab as debris and shows a dark hole. Walls that break leave a gap: cars can drive through gaps out of the track (off-road grass is slow); the outer world boundary is an unbreakable invisible fence far away.
Editor (dev only, `npm run dev` → `/editor.html`, not in prod build): 2D canvas, click to add/drag/delete control points and props, live spline preview with width, select track, export JSON to clipboard/download in TrackDef format.
Tests: geometry closed, length plausible, nearest() round-trips; destructible below threshold not damaged; break emits event and removes body only after step; max debris unaffected (render side).

### C — AI, race, ghost, Sim orchestrator (`src/sim/ai.ts`, `src/sim/race.ts`, `src/sim/ghost.ts`, `src/sim/sim.ts`)
```ts
export class AiDriver { constructor(p: AiPersonality, rng: () => number); think(car: CarState, others: CarState[], track: TrackGeometry, dt: number, hintS: number): CarInput }
export class RaceTracker { constructor(track: TrackGeometry, laps: number, carCount: number); update(cars: CarState[], dt: number, events: SimEvent[]): void; state: RaceState }
export class GhostRecorder { /* records player each 1/20 s, keeps best lap */ }
export function ghostPoseAt(g: GhostData, t: number): { x: number; y: number; a: number } | null;
export class Sim implements ISim { constructor(opts: SimOptions) }  // wires PhysicsWorld, SimCars on start grid, DestructionSystem, AI, race, ghost
export function createSim(opts: SimOptions): ISim;
```
AI: target point on spline at lookahead with personality lane offset; speed limited by max curvature in the braking distance ahead (v = sqrt(maxLatAccel/|k|) scaled by skill); avoid cars ahead (shift lateral offset, overtake on the freer side); per-driver noise and occasional mistakes (late braking, wide line); mild rubber band; recover when stuck (reverse a bit when speed ~0 for >1.2 s); never drives backwards around the track. Cars during countdown are frozen. Race: progress is credited only by driving (per-update steps of at most `race.gateMaxStep` m inside the walls); jumps across an infield or a wall breach are not credited. A lap needs `race.gates` ordered gates (gate 0 = the line), each crossed forward within half width + `race.gateLateral`; a lap with more than `race.cutTolerance` m jumped still counts for the race but is not clean: only clean laps set `bestLapTime`, become the ghost or reach the leaderboard (`RaceTracker.lastLapValid`). Walls facing another part of the track (`destruction.lock`) are indestructible on one side of each such gap. `nearest()` with a hint falls back to a global search when the hinted answer lies more than 1 m beyond the road edge. Places by progress; finish all cars; after player finishes, others get estimated finish times so results are immediate after ≤ 15 s.
Tests: headless race with 8 AI cars completes 3 laps on every track within reasonable time (no car stuck), places unique 1..8; AI lap time on t1 within 15% across seeds (stable but not identical); step time average < 4 ms.

### D — Render & FX (`src/render/*`, `src/fx/*`)
```ts
export class GameRenderer {
  constructor(canvas: HTMLCanvasElement, quality: Quality | 'auto');
  loadRace(sim: ISim): void;       // builds track meshes (road ribbon, curbs red/white, walls/guardrails/tire stacks per wallStyle, props, grass/sand/snow ground, decor outside walls), 8 car meshes
  frame(sim: ISim, events: SimEvent[], frameDt: number): void;  // sync meshes (interpolate with sim.alpha), process events -> debris/particles/shake, camera follow player, render
  showMenuScene(colorIndex: number): void;   // pretty idle scene for menus (player car slowly orbiting / track flyover)
  setQuality(q: Quality | 'auto'): void; resize(): void; readonly fps: number; dispose(): void;
}
```
Cartoon low-poly: bright saturated palette, flat/Lambert/Toon shading, one directional light with shadows (quality), hemisphere light. Cars procedurally built from boxes/cylinders (body, cabin, 4 wheels with front steering, bumpers, hood, doors, spoiler, mirrors as separate meshes so parts can fly off), 8 colours from CONFIG.render.carColors; damage visuals: dents/darkening by zone, smoke and sparks from effects, detached parts. Destructibles: InstancedMesh per kind; broken → hide instance + spawn 2–3 debris (pool, max 60, life 1.5 s, fade 0.5 s, simple ballistic visual motion, no physics); road chunk broken → dark hole decal + slab debris; crack visuals by `crack`. Particles pooled (InstancedMesh or Points): tyre smoke on drift, dust off-road, sparks on scrape/impact, smoke when damaged; skid marks as pooled quads on ground. Camera: orthographic, follows player with look-ahead, zoom out with speed, screen shake on big impacts; works portrait 390×844 and landscape. Ghost car: translucent. Auto quality: drop level when FPS < 50 for 3 s.
Debug: `window.__render = { fps, drawCalls, debrisActive }`.

### E — Platform, i18n, meta, UI, input, audio (`src/platform/bridge.ts`, `src/i18n.ts`, `src/meta/*`, `src/ui/*`, `src/input/input.ts`, `src/audio/audio.ts`, `public/sfx/*`)
```ts
// platform/bridge.ts — wraps window.bridge (global from playgama-bridge.js); safe no-op fallback if absent
export const platform: {
  init(): Promise<void>; language(): string; isAudioEnabled(): boolean;
  onPause(cb: (paused: boolean) => void): void; onAudio(cb: (enabled: boolean) => void): void;
  load(keys: string[]): Promise<Record<string, unknown>>; save(data: Record<string, unknown>): Promise<void>;
  showInterstitial(): Promise<void>;           // resolves when closed/failed; caller pauses game+sound while awaiting
  isRewardedSupported(): boolean; showRewarded(): Promise<boolean>;  // true only on 'rewarded' state
  leaderboardMode(): 'none'|'in_game'|'native'|'native_popup'; leaderboardAvailable(): boolean;   // Bridge leaderboards.type; 'none' hides every leaderboard control
  submitScore(id: string, score: number): Promise<boolean>;                                      // never throws, 8 s timeout, true = accepted
  leaderboardTop(id: string, limit?: number): Promise<{ status: 'ok'; rows: { rank: number; name: string; score: number; isPlayer: boolean }[] } | { status: 'unavailable' | 'failed' }>;  // in_game only
  showLeaderboardPopup(id: string): Promise<boolean>;                                            // native_popup only
  gameReady(): void; level(kind: 'started'|'paused'|'resumed'|'completed'|'failed', track?: string): void;
};
// ui/leaderboard.ts — LeaderboardPanel(root).show(trackId): modal top-10 view (tabs per track, own row, loading / error / empty states).
//   Opened from the track select and the results screen through UiHandlers.leaderboard; hidden unless UiHandlers.leaderboardAvailable().
// Release gates: scripts/check-release.mjs (npm run check-release), docs/RELEASE.md (Playgama requirement map and owner actions).
// i18n.ts
export function initLang(platformLang: string, setting: 'en'|'ru'|'auto'): void; export function t(key: string, p?: Record<string, string|number>): string; export function lang(): 'en'|'ru';
// meta/save.ts
export function defaultSave(): SaveData; export async function loadSave(): Promise<SaveData>; export async function writeSave(s: SaveData): Promise<void>;
// meta/economy.ts — PURE
export function upgradeCost(level: number): number | null; export function statsFor(upgrades: SaveData['upgrades']): CarStats;
export function raceReward(trackId: string, place: number, brokenByPlayer: number): number; export function repairCost(missingHp: number): number;
export function applyRaceResult(save: SaveData, trackId: string, place: number, reward: number, lapTime: number): { save: SaveData; unlocked: string | null };
// meta/opponents.ts — PURE
export function makeOpponents(trackIndex: number, playerStats: CarStats, seed: number): CarSetup[]; // 7 AI, difficulty rises per track; names
// input/input.ts
export class InputController { constructor(root: HTMLElement); getInput(): CarInput; setAutoGas(on: boolean); setEnabled(on: boolean); onKey(cb: (k: 'pause' | 'repair') => void): void; readonly touchActive: boolean }
// audio/audio.ts — Web Audio, unlocked on first pointerdown/keydown; file-based (public/sfx/*.ogg)
export class AudioManager { unlock(): void; setMuted(m: boolean): void; setPaused(p: boolean): void; update(player: CarState | null, dt: number): void; onEvents(ev: SimEvent[], playerId: number): void; ui(name: 'click' | 'buy' | 'error'): void }
// ui/ui.ts — HTML/CSS over the canvas inside #ui
export interface UiHandlers { start(trackId: string): void; pause(): void; resume(): void; quit(): void; restart(): void; repair(): void; buy(b: UpgradeBranch): void; doubleReward(): Promise<void>; settings(s: SaveData['settings']): void; color(i: number): void; continueAfterResults(): void }
export class UI {
  constructor(root: HTMLElement, h: UiHandlers);
  showMainMenu(s: SaveData): void; showGarage(s: SaveData): void; showTrackSelect(s: SaveData): void; showSettings(s: SaveData): void;
  showHud(): void; updateHud(sim: ISim, fps: number): void;
  showPause(repairCost: number, money: number): void;
  showResults(r: { place: number; time: number; bestLap: number; reward: number; canDouble: boolean; unlocked: string | null; newBestLap: boolean }): void;
  showTutorial(isTouch: boolean): void; toast(text: string): void; hideAll(): void;
}
```
HUD: place `2/8`, lap `1/3`, race timer, last/best lap, speed km/h, damage silhouette of the car with 9 zones coloured green→red, money, pause button (gear/pause SVG), repair hint. Touch: big GAS button bottom-right (only when touch input active); steering = finger left/right of screen centre (any finger position works while it is down; one finger at a time: the finger that presses GAS also steers by its x relative to centre — that is the "one finger" scheme; when auto-gas is on, any touch steers). Brake: a small BRAKE button bottom-left for a second finger is allowed but optional; pulling the GAS finger far down (below the button) = brake/reverse. Garage: car preview colour picker (8 colours), 3 upgrade bars with level pips, stat bars (speed, acceleration, grip, armor) before/after, cost, buy button. Results: place, time, best lap, reward, "Watch ad: x2 reward" only if rewarded supported, continue button (continue triggers interstitial in game flow). Pause: resume, repair (cost), restart, quit, mute toggle. Settings: language (English / Русский names), auto-gas, quality, sound. Layout must fit 390×844 portrait, landscape phones, 1:1, desktop; no overlaps; text readable; mobile safe areas.
Audio files: engine loop (pitch by rpm), skid loop, impacts light/heavy, metal crunch, debris, ui click, countdown, finish, music loop. No external downloads available in this environment → produce placeholder files under `public/sfx/` with a reproducible `scripts/make-sfx.sh` (ffmpeg) and list them in `docs/AUDIO.md` as MUST-REPLACE with recorded CC0 files before publishing (Playgama 3.3.2 forbids code-synthesized sound).

### F — Integration (`src/main.ts`, `src/game.ts`, `e2e/run.mjs`)
Boot order: Bridge script (first in head, injected by plugin) → `await platform.init()` → load save (one `load` call) → i18n from `platform.language()` → mute if `!isAudioEnabled()` → build renderer/UI → show menu → `platform.gameReady()` after first frame rendered. Game loop with requestAnimationFrame; pause on platform pause / tab hidden / ad. Flow: menu → race (countdown, race, finish) → results → continue → `showInterstitial()` (game+sound paused) → menu. Save only on meaningful changes (race end, purchase, settings).
Debug hooks for e2e (always present, harmless): `window.__game = { state, sim, startRace(trackId), setTimeScale(n), forceFinish() }`.
e2e/run.mjs (Playwright, preinstalled): build preview server, open at 390×844 (touch, isMobile) and 1280×720; check no console errors; menu screenshot; start race; hold gas via touch/keyboard for some seconds; screenshots of race, HUD, pause, garage, results; measure FPS for 10 s; force finish; write `e2e/out/report.json` + PNGs.

### G — Power-ups (boost pads, item boxes, items)
Sim (no three/DOM): `src/track/items.ts` (`planItems(track)`: pad + box-row layout, deterministic), `src/sim/powerups.ts` (`PowerUpSystem`: pad triggers, box pickup/respawn, oil slicks, `use(i)` for the 5 items, `rollItem(place, health, rnd)` weighted by race position), `src/sim/buffs.ts` (`CarBuffs`: timers + capped boost stack, one per `SimCar`), `src/sim/aiItems.ts` (`AiItemUser`: when an AI car uses its item). All numbers in `CONFIG.items`. The Sim creates it (`SimOptions.powerUps: false` = no pads/boxes, for pure-driving tests) and exposes `sim.pads / boxes / oils`, `sim.useItem()` (player); per-car state `CarState.item / boostT / nitroT / shieldT / spinT`.
Events: `boost` (pad or nitro kick), `pickup`, `itemUse`, `shieldPop`, `oilSpin` (plus the existing `repair` for the Repair kit). Render: `src/render/powerups.ts` (animated chevron pad shader, spinning boxes, oil discs, shield bubbles), flames / rings in `fx/fxManager.ts`, boost zoom + punch in `render/camera.ts`, speed lines + item slot in the HUD (`ui/ui.ts`). Input: key E / Shift, HUD item button, flick the GAS thumb up (`input/input.ts` -> `Game.useItem`). Audio reuses existing samples (placeholder mapping in `audio.ts`).

### H — Car roster, garage, rival fields (`src/meta/cars.ts`, `src/render/carModels.ts`, `src/ui/garage.ts`, `CONFIG.cars`, `CONFIG.rivals`)
10 cars, every one selectable (no locks; per-car badges are cosmetic). One record per car in `CONFIG.cars.defs`: stock power, ceiling, grip rate, cornering limit (`lat`), brakes, mass, armor, hitbox L x W, drift ease, measured AI `pace` and ONE trait (`CarTraits` in types.ts, numeric hooks).
```ts
// meta/cars.ts — PURE
export const CAR_IDS: readonly string[];                                   // garage order
export function carStats(id: string, levels?: UpgradeLevels): CarStats;    // model + per-car upgrades (engine: power/ceiling, tyres: grip + cornering, armor)
export function levelsOf(save, id): UpgradeLevels;                         // save.carUpgrades[id]
export function bars(s: CarStats): Record<'speed'|'accel'|'handling'|'drift'|'armor'|'weight', number>; // 1..10 across the roster
export function zeroTo100(s): number; export function settledTopSpeed(s): number;   // garage numbers (pure engine curve)
export function rivalModels(mode: RivalMode, playerCar, count, rng, picked?): string[]; // same / mixed (all different) / random / pick
export function paceFactor(model, playerModel): number;                    // rival speeds x f, accelerations x f^2: every model has the player model's pace
```
Per-car physics consumed by the sim: `CarStats.latAccel` (car model turn-rate cap + AI planning and steering inverse), `brakeDecel`, `length` / `width` (planck fixture, damage zones, AI follow gap and pass clearance), `drift` (entry speed, slide drag, charge rate), `traits` (regen in `SimCar.flushDamage`, off-road surface in `SimCar.preStep`, launch / downforce in `carModel`, draft in `Sim.updateDrafts`, ram / bull bar in `Sim.ramMul` and `SimCar.flushDamage`, plow keep in `Sim.plowThrough`, boost time and shockwave in `powerups.ts`). Damage uses the impulse normalised by mass (`impulse x massRef / mass`), so in a car-vs-car hit the lighter car takes more damage; the reference car (`scrapper`, = `CONFIG.car`) is unchanged.
Handling base (steering retune): a def's `grip` and `lat` are in the reference car's units and `carStats` scales them by `CONFIG.car.baseGrip` / `maxLatAccel`, so a global handling change moves the whole roster. Steering is a linear fraction of the full-lock turn rate `turnRateCap` = min(`maxYawRate`, low-speed geometry, `latAccel x fullLockLatMul / v`): up to ~70% stick the car corners at up to `maxLatAccel` (40 m/s^2) with no speed loss, beyond that full lock turns harder and the excess lateral acceleration is paid as deceleration (`fullLockScrub`), so a car pointed into a bend too fast slows onto the line instead of running wide. The drift path is capped by `drift.maxPathRate` (a full-lock touch drift slides, never spins round). The player's edge assist (`sim/assist.ts`) only ever adds steering in its own direction and never reduces the player's turn-in; touch steering uses `controls.touchSteerCurve` (offset^0.6) for more authority at small finger offsets.
Render: `getCarGeometries(modelId)` (cached) builds the model from `MODEL_BUILDERS` with the same 8 part slots, a per-model wheel layout (one shared wheel mesh scaled per wheel) and part pivots from the part bounding boxes; `CarFleets` keeps one instanced `CarFleet` per model present in a race. Save v2: `car`, `carUpgrades` (v1 `upgrades` migrate to the starter car), `carRaces` / `carWins`, `settings.rivals` / `settings.rivalCar`.
Tests: `tests/carRoster.test.ts` (measured 0-100 / top / cornering per car, hitbox, mass damage, traits, rival fields and pace fairness, AI finishes every track with every car, save migration), `tests/carModels.test.ts`.
