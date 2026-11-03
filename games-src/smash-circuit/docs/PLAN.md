# Smash Circuit v0.2: implementation plan (P0 scope of GDD v2)

Design: `docs/GDD.md` (section numbers below refer to it). Binding requirements: `docs/REQUIREMENTS.md`. Module rules: `docs/ARCHITECTURE.md` (still valid: sim/meta have no three.js or DOM, deterministic sim, no localStorage, no Esc, all strings via `t()`).

The plan has 14 work packages (WP0 to WP13). WP0 (contract) runs first and alone; WP1 to WP11 run in parallel with disjoint file ownership; WP12 integrates; WP13 is QA and the release gate.

---

## 1. Gates and waves

```
G0  in-flight agents (visible car damage; boost pads + power-ups) merged, all tests green, tagged v0.1.2
 │
W1  WP0 CONTRACT (one agent) ──► G1: typecheck + all existing tests + player-checks green, no visual change
 │
W2  ┌ WP1 Driving        ┌ WP5 Car models + renderer   ┌ WP9  UI race
    │ WP2 Rules/combat   │ WP6 Camera/input/FX         │ WP10 UI meta
    │ WP3 AI/rivals      │ WP7 Meta core (pure)        │ WP11 Platform/audio
    │ WP4 Tracks/themes  │ WP8 Meta live (pure)        │ WP12a flow skeleton on stubs
    └ (all in parallel)  └                             └ WP13a QA harness + sweeps on stubs
 │      each merges when its own acceptance passes (merge order in section 5)
W3  WP12b INTEGRATION (wire everything) ──► G3: full loop e2e green on phone + desktop
 │
W4  WP13 QA gate + fix loop (owners fix their own files) ──► G4: release gate (section 7) ──► deploy play-test
```

---

## 2. Rules of engagement (all packages)

1. **File ownership is exclusive.** A package edits only the files listed under "Owns". Reading anything is allowed. A new file goes into the owner's directory and is listed in the package report.
2. **Contract first.** `src/types.ts` and the *shape* of `src/config.ts` are frozen after G1. A package that needs a contract change files a **contract amendment** (additive only: new optional field, new union member, new config key) with the coordinator, who applies it on the integration branch and notifies every package. No package edits `types.ts` itself after G1.
3. **Config sections have owners** (table 3.2). A package edits only the values and appends keys inside its own sections.
4. **i18n:** `src/i18n.ts` keeps `t()` / `initLang()` / `lang()` and merges dictionaries from `src/i18n/*.ts`. Each dictionary file has one owner (table 3.4). Every key exists in `en` and `ru` (test).
5. **CSS:** `src/ui/ui.css` is split into `src/ui/css/*.css` per screen module; one owner per file; shared design tokens live in `src/ui/css/base.css` (WP0, later WP12).
6. **Tests:** each package adds its own test files (listed). Existing test files have one owner each (listed); `tests/i18n.test.ts` belongs to WP0, then WP13. `npm run typecheck && npm test` must pass before a package asks to merge.
7. **Branches:** one git worktree per package, branch `sc/v02-wpN-<slug>`, based on the integration branch `sc/v02`. Rebase onto `sc/v02` before merging. Commit messages end with the attribution lines from the session.
8. **Determinism and budgets:** sim code uses `src/sim/rng.ts` only; per-step work must keep the headless step budget (section 6 of each card).
9. **Review:** before merge every package diff gets a second-agent review (Sonnet 5.5 high, `code-review` skill, effort high). Findings are fixed by the owner.
10. **Do not touch** `../../play-test/` (deploy is the coordinator's step after G4).

---

## 3. WP0: contract and scaffold (first, alone)

**Model:** Opus 5.5, effort xhigh. **Size:** L (one strong agent).

**Owns during W1:** `src/types.ts`, `src/config.ts`, `src/i18n.ts` + new `src/i18n/*.ts`, `src/ui/ui.ts` (split into shell + stubs), `src/ui/ui.css` (split into `src/ui/css/*.css`), `src/ui/preview.ts` (per-screen fixture registry), `docs/ARCHITECTURE.md` (v2 module map), every new stub file listed in 3.3, minimal plumbing edits at call sites listed in 3.5, `tests/i18n.test.ts`.

**Starts after G0.** First step: read what the two in-flight agents added (item/pad sim module, pickup/pad render, damage visuals, new events, new config keys) and fold their types into the contract below; their modules get owners in table 3.6.

### 3.1 `src/types.ts` additions (exact shape)

```ts
// ---- cars
export type CarModelId = 'scrapper' | 'gravel' | 'brick' | 'sandhopper' | 'brawler' | 'bruiser' | 'glint' | 'scorcher' | 'needle' | 'mammoth';
export type CarClass = 'allround' | 'drifter' | 'tank' | 'offroad' | 'muscle' | 'rammer' | 'speedster' | 'hotrod' | 'racer' | 'juggernaut';
export interface DriftTuning { chargeMul: number; angleMul: number; dragMul: number; entryMul: number; spinMul: number; hbGripMul: number; assistSteer: number }
export interface CarTraits {
  offroadDragMul: number; offroadGripMul: number; propSlowMul: number; plowKeep: number;
  ramDamageMul: number; ramFrontOnly: boolean; frontRamWallMul: number;
  zoneDamageMul: Partial<Record<ZoneId, number>>;
  repairCostMul: number; repairKitMul: number; nitroDurationMul: number;
  slipFillMul: number; slipCeilMul: number; launchWindowMul: number; launchKickMul: number;
  downforce: number; knockbackMul: number;
}
export interface CarStats {            // existing fields stay
  enginePower: number; topSpeed: number; grip: number; armor: number; mass: number;
  latAccelMul: number; steerMul: number; brakeMul: number; length: number; width: number;
  drift: DriftTuning; traits: CarTraits;
}
// ---- input
export interface CarInput { throttle: number; brake: number; steer: number; handbrake: boolean; drift: boolean; useItem: boolean /* edge; the sim consumes it */ }
// ---- setup / AI
export type AiArchetype = 'racer' | 'bruiser' | 'drifter' | 'trickster' | 'rookie' | 'boss';
export interface AiPersonality { skill: number; aggression: number; laneOffset: number; mistakeRate: number;
  archetype: AiArchetype; driftSkill: number; itemIQ: number; ramBias: number; shortcutBias: number }
export interface CarSetup { /* existing */ modelId: CarModelId; isBoss?: boolean }
// ---- state
export type DriftPhase = 'none' | 'drift' | 'spin';
export type ItemKind = 'nitro' | 'shield' | 'repair' | 'shockwave' | 'smashNitro';
export type BoostKind = 'drift1' | 'drift2' | 'drift3' | 'pad' | 'slip' | 'sling' | 'launch' | 'nitro' | 'smashNitro';
export interface CarState { /* existing */
  modelId: CarModelId;
  driftPhase: DriftPhase; driftAngle: number; driftCharge: number; driftTier: 0 | 1 | 2 | 3; driftPoints: number; driftChain: number;
  boostKind: BoostKind | null; boostLeft: number; slipstream: number;
  item: ItemKind | null; itemRoulette: number; shieldLeft: number; style: number;
  smash: number; combo: number; takedowns: number;
  respawnIn: number; ghosted: boolean; eliminated: boolean;
  wrongWay: boolean; missedCheckpoint: boolean; sector: number;
}
// ---- events (appended to SimEvent)
| { type: 'driftStart'; carId: number } | { type: 'driftTier'; carId: number; tier: 1 | 2 | 3 }
| { type: 'driftEnd'; carId: number; tier: 0 | 1 | 2 | 3; points: number; clean: boolean } | { type: 'spinOut'; carId: number }
| { type: 'boost'; carId: number; kind: BoostKind } | { type: 'perfectStart'; carId: number }
| { type: 'slipstream'; carId: number; on: boolean }
| { type: 'takedown'; by: number; victim: number; kind: 'wreck' | 'wall' | 'spin' | 'shockwave' }
| { type: 'respawn'; carId: number; x: number; y: number; angle: number }
| { type: 'eliminated'; carId: number; place: number }
| { type: 'smash'; carId: number; points: number; combo: number; x: number; y: number }
| { type: 'styleFull'; carId: number }
| { type: 'itemPickup'; carId: number; item: ItemKind } | { type: 'itemUse'; carId: number; item: ItemKind }
| { type: 'checkpoint'; carId: number; missed: boolean } | { type: 'wrongWay'; carId: number; on: boolean }
| { type: 'trackBreaking' }
// ---- tracks
export type TrackTheme = 'meadow' | 'desert' | 'snow' | 'harbor' | 'junkyard';
export interface TrackDef { /* existing */ theme: TrackTheme; wallStyle: 'concrete' | 'tires' | 'fence' | 'containers' | 'hulks';
  baseId?: string; reverse?: boolean; pads?: BoostPadDef[]; itemRows?: ItemRowDef[]; ftueProps?: PropDef[] }
export interface BoostPadDef { s: number; lateral: number }      // the in-flight format wins if it already exists
export interface ItemRowDef { s: number; count: number }
// ---- modes
export type RaceMode = 'race' | 'sprint' | 'time' | 'rampage' | 'knockout' | 'drift' | 'boss' | 'final';
export type Modifier = 'glass' | 'heavy' | 'norepair' | 'frenzy' | 'onemake' | 'underdog';
export interface SimOptions { /* existing */ mode?: RaceMode; modifiers?: Modifier[]; ftue?: boolean; timeLimit?: number; items?: boolean; firstBoxNitro?: boolean }
export interface RaceState { /* existing */ mode: RaceMode; timeLeft: number; elimIn: number }
export interface RaceSummary {
  mode: RaceMode; layoutId: string; laps: number; place: number; finished: boolean; eliminated: boolean;
  time: number; bestLap: number; score: number;                       // Rampage: smash points; Drift Trial: drift points
  smash: number; objects: number; props: number; walls: number; guardrails: number; roadChunks: number;
  takedowns: number; bossTakedown: boolean; partsKnockedOff: number;
  driftPoints: number; bestDriftChain: number; cleanDrifts: number;
  itemsPicked: number; itemsUsed: number; nitroUses: number; perfectStart: boolean;
  healthAtFinish: number; repairsUsed: number; wrecks: number; distance: number;
  ledAfterLap1: boolean; lastAfterLap1: boolean; placesGained: number; winMargin: number;
}
export interface ISim { /* existing */ summary(carId?: number): RaceSummary }
// ---- save v2: GDD section 23 verbatim (SaveData becomes SaveDataV2; version: 2)
```

### 3.2 `src/config.ts` sections and owners
WP0 creates every section with the GDD default values so the game builds; after G1 the owner tunes values and may append keys.

| Section | Owner | Content (GDD) |
|---|---|---|
| `cars` (10 entries: physics, size, drift tuning, traits) | WP1 | 10.2, 10.3 |
| `drift`, `boost` | WP1 | 6, 7.1 to 7.3 |
| `car`, `damage` (existing, append) | WP1 | grip upgrade → cornering, mass normalisation |
| `race` (append `sectors`, `wrongWay`), `modes`, `combat`, `score`, `style`, `items`, `pads` | WP2 | 7.2, 7.4, 8, 9, 13 |
| `ai` (append), `rivals`, `leagues.ai`, `bosses` | WP3 | 11, 12, 15.2 |
| `tracks` (layout list, laps, AI `trackSpeed` per layout, medal factors, pad and row data), `destruction` (append, theme props) | WP4 | 14 |
| `render.models`, `render.car` (append) | WP5 | 10.3 silhouettes |
| `render.camera` (append), `render.fx` (append), `controls` (append), `slowmo`, `haptics` | WP6 | 5, 21 |
| `garage` (tier, price, unlock rule, arrival levels), `upgrades` (tier cost), `economy`, `progression` | WP7 | 10.4, 16 |
| `career` (35 events, gates, layout fallback, score thresholds), `daily`, `achievements` | WP8 | 15, 17 |
| `ui.hud`, `ui.results`, `ui.tips` | WP9 | 19, 20.6, 20.7 |
| `ui.meta` (hub, garage, sheets) | WP10 | 20 |
| `audio` (append), `ads`, `telemetry` | WP11 | 18, 22, 24 |
| `game` (append) | WP12 | flow timings (`meta.trackOrder` moves to `tracks.order`, owned by WP4) |

### 3.3 New module stubs (typed, safe defaults, so everything compiles and runs unchanged)

| File | Exported API (stub returns a neutral value) | Real owner |
|---|---|---|
| `src/sim/drift.ts` | `class DriftController { update(input, kin, stats, surface, cornerAhead, dt): DriftOut }` | WP1 |
| `src/sim/boost.ts` | `class BoostStack { add(kind, p); apply(base: CarStats): CarStats; update(dt); cancel(kind) }` | WP1 |
| `src/sim/combat.ts` | `class CombatTracker { onContact(a, b, impulse, normal); update(cars, events, dt) }` | WP2 |
| `src/sim/modes.ts` | `interface ModeRules { init(sim); update(sim, dt, events); isOver(sim): boolean }`, `rulesFor(mode, mods)` | WP2 |
| `src/sim/score.ts` | `class SmashScore { onBreak(e, by); onTakedown(by); points(carId) }` | WP2 |
| `src/sim/summary.ts` | `buildSummary(sim, carId): RaceSummary` | WP2 |
| `src/meta/cars.ts` | `CAR_IDS`, `carDef`, `statsFor(id, up)`, `prOf(stats)`, `bars(id)`, `unlockState(save, id)`, `upgradeCost(id, branch, lvl)`, `buyCar`, `buyUpgrade`, `showroomStats(id, targetPr)` | WP7 |
| `src/meta/progression.ts` | `xpFor(summary, newStars, quick)`, `applyXp(save, xp)`, `featureOpen(save, f)` | WP7 |
| `src/meta/career.ts` | `EVENTS`, `eventById`, `starsFor(ev, summary)`, `isOpen(save, ev)`, `bossOpen`, `leagueOpen`, `nextEvent(save)`, `dailyChallenge(date)`, `simParams(ev)`, `applyEventResult(save, ev, summary)` | WP8 |
| `src/meta/daily.ts` | `loginState(save, now)`, `claimLogin(save, now, doubled)`, `tasksFor(save, date)`, `trackTasks(save, summary)`, `claimTask(save, id)` | WP8 |
| `src/meta/achievements.ts` | `ACHIEVEMENTS`, `trackAchievements(save, summary)`, `claimAchievement(save, id)` | WP8 |
| `src/meta/goals.ts` | `nextGoal(save): Goal`, `redDots(save): Record<'garage' \| 'career' \| 'today' \| 'trophies', boolean>` | WP8 |
| `src/meta/opponents.ts` (existing) | new `makeField(ctx: FieldContext): CarSetup[]` next to the old function | WP3 |
| `src/fx/slowmo.ts` | `class SlowMo { onEvents(ev, playerId, toFinish); scale(dt): number }` | WP6 |
| `src/platform/haptics.ts` | `haptic(kind)` | WP6 |
| `src/platform/telemetry.ts` | `track(name, data)` | WP11 |
| `src/render/carModels.ts` | `buildModel(id): CarGeometries` (stub: today's car for all ids) | WP5 |
| `src/ui/*.ts` screen modules | 3.4 | WP9 / WP10 |

### 3.4 UI and i18n split

| Module | Owner | Content |
|---|---|---|
| `src/ui/ui.ts` (shell: `UI` facade, router, layers, toasts, `UiHandlers` v2, shared helpers) | WP0 → WP12 | |
| `src/ui/screens.ts` (screen registry: every screen id → module) | WP0 → WP12 | |
| `src/ui/hud.ts`, `hudFx.ts`, `minimap.ts`, `pause.ts`, `results.ts`, `tips.ts` + `css/hud.css`, `results.css`, `pause.css`, `tips.css` | WP9 | |
| `src/ui/hub.ts`, `career.ts`, `garage.ts`, `sheets.ts`, `quick.ts`, `today.ts`, `trophies.ts`, `settings.ts`, `reveal.ts` + matching css | WP10 | |
| `src/ui/preview/*.ts` fixture files per module (registered by `src/ui/preview.ts`) | each UI owner its own file | |
| `src/i18n/core.ts` (existing keys moved verbatim) | WP0 → WP12 | |
| `src/i18n/hud.ts`, `ftue.ts`, `results.ts` | WP9 | GDD 26.8 to 26.11 |
| `src/i18n/meta.ts` (hub, goals, career, leagues, modes, mods, bosses, quick, rivals, reveal, toasts), `cars.ts`, `today.ts`, `trophies.ts`, `settings.ts` | WP10 | GDD 26.1 to 26.7, 26.12 to 26.15 |

`UiHandlers` v2 (WP0 defines all of them; the shell forwards): `startEvent(id)`, `startQuick(opts)`, `next()`, `retry()`, `toGarage()`, `toHub()`, `selectCar(id)`, `buyCar(id)`, `buyUpgrade(id, branch)`, `paint(id, i)`, `setRivals(r)`, `testDrive(id, viaAd)`, `claimLogin(doubled)`, `claimTask(id)`, `claimAchievement(id)`, `chooseStarter(id)`, `freeRepairAd()`, `nitroStartAd()`, plus the existing ones.

### 3.5 Plumbing edits WP0 makes at call sites (so later packages never touch each other's files)
- `renderer.ts`: `camera.update(dt, view: CameraView)` with `CameraView { px, pz, vx, vz, speedFrac, intro, trackTangent, boost, drift, slowmo }`; renderer exposes `worldToScreen(x, y)`.
- `sim.ts`: accepts the new `SimOptions` fields (ignored by the stubs), calls the stub controllers at their final hook points (drift before `integrateCar`, boost in `statsNow`, combat in `onPostSolve`, score in `countBreaks`, modes after `tracker.update`), implements `summary()` via `buildSummary`.
- `car.ts`: `recordImpact(…, mul = 1)` extra parameter; fixture size from `stats.length/width` (defaults equal today's).
- `game.ts`: passes `modelId: 'scrapper'` and the default mode; time-scale hook `this.slowmo.scale(dt)` (identity in the stub).
- `input.ts`: `getInput()` returns `drift: false, useItem: false`.
- `opponents.ts`, `economy.ts`, `save.ts`: compile against `SaveDataV2` with a v1 → v2 passthrough migration (WP7 completes it).
- `window.__game` debug hooks for QA (dev / localhost / `?debug` only): `startEvent(id, { car?, rivals?, laps?, seed?, mode?, modifiers? })`, `setSetting(k, v)`, `setCar(id)`, `grant({ money?, stars?, level? })`, `summary()`, `freshSave()`, `ui.screen` (current screen id).

### 3.6 Ownership of in-flight files (filled at G0)
Default: item and pad sim logic → WP2; item/pad visuals → WP6; damage visuals inside `render/car.ts` → WP5; new audio cues → WP11.

### 3.7 Acceptance (G1)
- `npm run typecheck`, `npm test` (all existing tests, unchanged expectations), `node e2e/player-checks.mjs` all pass.
- `ui-preview.html?screen=*` screenshots of menu, garage, results, pause, settings, HUD at 390×844 and 1280×720 match v0.1.2 (pixel diff ≤ 1% per screen).
- `tests/i18n.test.ts`: every key in `en` exists in `ru` and vice versa; every literal `t('…')` key in `src/` exists.
- Step time unchanged (headless 8 AI on t3: avg stepMs within ±5% of v0.1.2).

---

## 4. Work packages (W2, in parallel)

Common acceptance for every package: `npm run typecheck && npm test` green, no console errors in `e2e/player-checks.mjs`, its own tests below, second-agent review fixed.

### WP1: Driving (10-car physics, drift, boost stack)
- **Model:** Opus 5.5 xhigh. **Size:** L.
- **Owns:** `src/sim/carModel.ts`, `src/sim/car.ts`, `src/sim/damage.ts`, `src/sim/drift.ts`, `src/sim/boost.ts`, `src/sim/world.ts`; config `cars`, `drift`, `boost`, `car`, `damage`; tests `carModel.test.ts`, `damage.test.ts`, `crashTuning.test.ts`, `plow.test.ts`, `world.test.ts`, new `carRoster.test.ts`, `drift.test.ts`, `boost.test.ts`.
- **Depends on:** WP0. Feeds WP2 (events, boost API), WP3 (car limits), WP5 (sizes).
- **Deliverables:** per-car consumption of every `CarStats` field (cornering limit `maxLatAccel × latAccelMul`, steer, brake, size → fixture); grip upgrade raises cornering (+5% per level; `statsFor` stays in WP7 but the model reads `latAccelMul`); mass-normalised damage (impulse × 1000 / own mass); `zoneDamageMul`; trait hooks (off-road, prop slow, plow keep, downforce, knockback); drift state machine, charge, tiers, chain, spin-out, events (GDD 6); boost stack with caps and every source's API (GDD 7.1); perfect-start window helper (`launchWindowMul`); wreck no longer cuts power to 25% (respawn is WP2), `wrecked` stays the trigger.
- **Acceptance (Vitest):**
  1. For each car: 0 to 100 km/h in 4.1 × 8.0 / power ± 0.35 s; Scrapper 4.1 ± 0.4 s (existing target).
  2. For each car: steady lateral acceleration on a 30 m circle = 19 × latAccelMul ± 6%; 80 to 0 km/h braking = 23 m / brakeMul ± 15%.
  3. For each car: full lock at 15 km/h for 5 s, no spin (existing requirement).
  4. Ram: Mammoth into a stationary Needle at 20 m/s → Needle HP loss ≥ 3 × Mammoth HP loss. Bruiser head-on wall hit at 15 m/s → front zone loss ≤ 0.55 × Scrapper's.
  5. Drift assist: steer 0.95 held at 20 m/s with a corner ahead → `driftPhase === 'drift'` within 0.25 s; at 12 m/s → never; on a straight with `assistNeedsCorner` → never. Brake tap (0.2 s) with steer 0.6 at 20 m/s → drift.
  6. A T2 drift through a 30 m radius corner exits 0.15 to 0.35 s ahead of the best grip line; a T1 drift through a 10 m hairpin −0.05 to +0.10 s.
  7. θ > 65° → `spinOut`; impact ≥ 0.2 resets charge; chaining keeps 50% ± 2%.
  8. Boost caps: 1,000 random stacks of all sources → power ≤ 2.0, ceiling ≤ 1.30; pad kick = 6 × cos(Δheading) ± 0.1; Nitro ends on impact ≥ 0.5.
  9. Perf: 8 cars × 10,000 steps of `integrateCar` + drift + boost in Node: per-step cost ≤ baseline + 0.15 ms.

### WP2: Race rules, combat, scoring, modes
- **Model:** Opus 5.5 xhigh. **Size:** L.
- **Owns:** `src/sim/sim.ts`, `src/sim/race.ts`, `src/sim/ghost.ts`, `src/sim/combat.ts`, `src/sim/score.ts`, `src/sim/modes.ts`, `src/sim/summary.ts`, the in-flight item/pad sim module; config `race`, `modes`, `combat`, `score`, `style`, `items`, `pads`; tests `race.test.ts`, `sim.test.ts`, new `sectors.test.ts`, `combat.test.ts`, `modes.test.ts`, `items.test.ts`, `summary.test.ts`, `slipstream.test.ts`.
- **Depends on:** WP0; WP1 APIs (contract stubs until WP1 merges).
- **Deliverables:** sector checkpoints, missed checkpoint, wrong way (GDD 9.4); takedown attribution, attacker/victim split (passes `mul` to `recordImpact`), wreck → respawn with ghosting (9.2, 9.3); slipstream pairs → boost source; perfect start detection at GO; style meter → Smash Nitro; smash points and combo (9.1); item distribution by position, first-box Nitro, Frenzy, No Repairs (8); modes Race, Sprint, Time Attack, Rampage, Knockout, Drift Trial, Boss, Final and modifiers Glass, Heavy (field side is WP3), No Repairs, Frenzy, One-Make (field side WP3), Underdog (grid); FTUE overrides (compressed countdown on first input, 2 laps); track-breaking event; `summary()`.
- **Acceptance (Vitest):**
  1. A car teleported across the Frost Pass infield (s ≈ 160 → 460) gains no lap and gets `missedCheckpoint`; driving back clears it. A wall plow-through that clips a t1 corner by ≤ 15 m keeps full progress. Existing `race.test.ts` lap counts unchanged.
  2. Reversed at > 5 m/s for 1.0 s → `wrongWay` on; facing forward → off.
  3. Player car shunts an AI car at 15 m/s closing speed into a wall → `takedown{by: player}` within 2 s; a 3 m/s nudge → none; the same victim cannot be taken down again within 4 s.
  4. Equal masses, attacker at 10 m/s into a stationary car: attacker damage / victim damage = 0.55 / 1.15 ± 10%.
  5. Wreck → `respawn` after 1.8 ± 0.1 s, 20 ± 3 m behind along the track, health 0.50 ± 0.02, sensor fixtures for 2.0 s, solid afterwards.
  6. Two Scrapper cars at 30 m/s, 8 m apart, lateral 0.5 m: follower `slipstream ≥ 0.95` after 0.7 s; follower equilibrium speed 47.5 to 49 m/s.
  7. Smash points per kind exactly as GDD 9.1; 5 breaks 1 s apart → combo 2.0; cap 3.0.
  8. Modes: Time Attack runs 1 car; Rampage ends at 90.0 s sim time; Knockout eliminates the last car at 25, 40, 55 … s and ends with one car; Drift Trial score = Σ driftEnd points × chain; Boss = 2 cars; Underdog puts the player last on the grid; Glass doubles damage; No Repairs makes `repairPlayer()` a no-op and removes Repair Kits.
  9. Item table: 10,000 rolls per position band within ±2% of GDD 8.1; first box in an `ftue` race is Nitro.
  10. `summary()` of a scripted race matches the event counters (objects, takedowns, drift points, items, health).
  11. Perf: headless 8 AI on t3, 3 laps, all systems on: average `stepMs` ≤ 1.2 ms (Node), p99 ≤ 3 ms.

### WP3: AI and rival fields
- **Model:** Opus 5.5 xhigh. **Size:** L.
- **Owns:** `src/sim/ai.ts`, `src/meta/opponents.ts`; config `ai`, `rivals`, `leagues.ai`, `bosses`; tests `ai.test.ts`, `aiPace.test.ts` (re-baseline), new `carBalance.test.ts`, `rivals.test.ts`, `aiSweep.test.ts`.
- **Depends on:** WP0; WP1 for final balance numbers; WP4 layouts for the sweep (runs on t1 to t3 until WP4 merges).
- **Deliverables:** per-car planning (cornering limit, ceiling, brake, real width in pass clearance and follow logic); archetypes and field mix (12.2); AI drift via the shared state machine; AI item use (8.3); sideswipe attacks with the pack rule (12.3); fair rubber band (12.4) using a view-radius input from the Sim; league tiers, fail assist steps, bosses, FTUE field; `makeField` with Mixed / Same / One model / Random and PR normalisation (11); driver name renames (GDD 11).
- **Acceptance (Vitest):**
  1. `carBalance`: each model, stock, skill 1, t1, 3 laps: tier 1 lap times within 3% of each other; Spearman(PR, pace) ≥ 0.7; every car is best in at least one of: top speed, 0 to 100, 30 m corner speed, damage taken in a 60 km/h wall hit, grass speed, drift charge.
  2. Normalised AI: PR within ±1% of target for every model; normalised t1 laps at skill 1 within ±2.5% across models.
  3. `makeField`: Same → 7 × player model; One model → 7 × chosen; Mixed → ≥ 5 distinct models, ≤ 2 per model, ≥ 1 heavy, ≥ 1 light; Random reproducible per seed; Boss/Heavy/One-Make events ignore the choice; FTUE skills 0.45 to 0.65.
  4. Rubber band: assist = 0 for an AI car within 1.15 × view radius; off-screen chase power ≤ ×1.10; no ease on the last lap.
  5. Drifter archetype on t3, 3 laps: ≥ 6 `driftStart`; Racer on t1: ≤ 3.
  6. AI holding Nitro uses it within 8 s; no Shockwave on the player in the first 8 s or last 5 s; no attacks in the first 5 s; never two simultaneous attackers on the player.
  7. `aiPace` re-baselined: top AI (normalised PR 100) laps t1 26.0 to 27.5 s, t2 29.5 to 31.5 s, t3 32 to 34.5 s; values for new layouts recorded in config by WP4 and asserted here.
  8. Sweep: 10 layouts × 5 seeds × Mixed field: every car finishes 3 laps, average respawns ≤ 1 per race, no car without progress for > 6 s.

### WP4: Tracks and themes
- **Model:** Opus 5.5 high (layout geometry and tuning), with a Haiku 5.5 xhigh swarm for screenshot review. **Size:** L.
- **Owns:** `src/track/tracks.ts`, `src/track/spline.ts`, `src/editor/editor.ts`, `editor.html`, `src/render/palette.ts`, `decor.ts`, `textures.ts`, `structures.ts`, `trackBuilder.ts`, `destructibles.ts`; config `tracks`, `destruction` (append); tests `spline.test.ts`, `destruction.test.ts`, new `tracks.test.ts`, `reverse.test.ts`.
- **Depends on:** WP0. Pad/row format from the in-flight module.
- **Deliverables:** `reverseTrack()`; 10 layouts (t1 to t5, forward and reverse); Harbor Run and Scrapyard control points, props, decor, palettes, ground textures, wall visuals `containers` and `hulks`; pads (2 to 4) and item rows (2 to 3) per layout; FTUE prop cluster on t1; AI `trackSpeed` and Time Attack base laps per layout (measured with the current AI, updated after WP3); editor supports the new themes; layout thumbnails work in `getTrackViews`.
- **Acceptance:**
  1. Vitest: all 10 geometries closed; lengths t1 to t3 unchanged, t4 1,000 to 1,050 m, t5 880 to 950 m, all ≤ 1,100 m; widths per GDD 14; the 40 m before every start line have |curvature| < 0.004; reverse(reverse(t)) points == t; centre-line points with |Δs| > 60 m are ≥ width + 2 × wallOffset + 2 m apart (no overlapping roads); props ≤ 380 per layout; pads 2 to 4 and rows 2 to 3, none where curvature rises above 0.02 within 25 m after them (no braking zones).
  2. Vitest: 8 AI cars complete 3 laps on every new layout (current AI) with ≤ 1 respawn per race.
  3. Playwright (phone 390×844 low, desktop 1280×720 medium): start and mid-lap screenshots of all 10 layouts; draw calls during a race on t4 and t5 ≤ 110 (low); FPS ≥ 90% of the t1 baseline on the same machine.
  4. Haiku swarm screenshot review: theme readable, road clearly distinct from off-road, no floating decor, no decor on the road (checklist per screenshot).

### WP5: Car models and renderer
- **Model:** Opus 5.5 high (visual quality is a complaint area). **Size:** L.
- **Owns:** `src/render/car.ts`, `src/render/carModels.ts`, `src/render/renderer.ts`, `src/render/preview.ts`, `src/render/menuScene.ts`, `src/render/playerMarker.ts`, `src/render/materials.ts`, `src/render/geo.ts`, `src/render/util.ts`, `src/render/index.ts`; config `render.models`, `render.car`; tests `render.test.ts`, `renderFix.test.ts`, `renderFix2.test.ts`, new `carModels.test.ts`.
- **Depends on:** WP0; sizes from `CONFIG.cars` (WP1 may retune; the build reads config).
- **Deliverables:** 10 procedural low-poly models per GDD 10.3 with the same 8 part slots (damage visuals and flying parts work for each); per-model InstancedMesh sets created only for models present; per-model wheel radius and track; per-car paint; boss gold livery; ghost uses the model; garage turntable API `showCar(id, paint, locked)` with a dark rim-lit silhouette for locked cars and a drive-in animation; hero car per selected model; drift counter-steer on front wheels; `worldToScreen()`; `window.__render.partsActive` counter for QA.
- **Acceptance:**
  1. Vitest: each model builds; all 8 part slots non-empty; bounding box L × W within ±10% of `CONFIG.cars`; ≤ 1,800 triangles per model including parts.
  2. Playwright: a race with 8 distinct models → car draw calls ≤ 40 and total ≤ 110 on low; FPS ≥ 90% of the single-model baseline.
  3. Playwright silhouette test: each model rendered alone top-down on a flat background at 50 px length; pairwise IoU of the binary masks ≤ 0.85 for every pair.
  4. Playwright: for each model, a 70 km/h head-on wall hit → ≥ 1 `partOff` and `__render.partsActive` increases (parts visibly fly off).
  5. Garage turntable screenshots of all 10 cars at 390×844 and 844×390; Haiku swarm review: "reads as the GDD description" (one reviewer per car).

### WP6: Camera, input and feel FX
- **Model:** Opus 5.5 high. **Size:** M to L.
- **Owns:** `src/render/camera.ts`, `src/input/input.ts`, `src/fx/*` (including `slowmo.ts`), `src/platform/haptics.ts`, the in-flight item/pad visuals; config `render.camera`, `render.fx`, `controls`, `slowmo`, `haptics`; tests `inputGeometry.test.ts`, new `camera.test.ts`, `gestures.test.ts`, `slowmo.test.ts`.
- **Depends on:** WP0.
- **Deliverables:** Follow and Fixed cameras with forward-visibility zoom, anchor, rotation caps, directional kick, shake setting, reduce motion (GDD 5.3); gesture grammar: drift assist signal to the sim, brake-tap drift, flick-up item, DRIFT 2nd button, left-handed mirror, sensitivity, steering arc (GDD 5.1); PC keys Space drift, E/Shift item (5.2); `triggerItem()` for the HUD item slot; FX: tier-coloured drift sparks, boost flame and speed lines, slipstream streaks, takedown ring, wreck burst, shield bubble, Shockwave ring, Knockout explosion; slow-motion controller (21); haptics (5.1).
- **Acceptance:**
  1. Vitest: flick up 0.45 sizes in 0.2 s → `useItem` once; a slow upward drift of the thumb over 1 s → none; brake tap 0.2 s with steer 0.6 → drift impulse, not brake; left-handed geometry mirrors x; sensitivity 140% reaches full lock at 22% / 1.4 of width.
  2. Vitest camera: Follow azimuth converges to the track tangent within 1.5 s on a straight; rotation rate never > 1.6 rad/s (1.0 with reduce motion); Fixed azimuth = 0; road visible ahead ≥ 40 m at rest in 390×844 and 844×390; car ≥ 32 CSS px long.
  3. Playwright (phone touch and desktop keys, both camera modes): pressing right turns the car clockwise on screen; in Fixed mode on a section where the car drives down the screen, right still turns it clockwise on screen (the existing check, both directions); in Follow mode the car's on-screen heading stays within ±20° of straight up after 1.5 s on a straight.
  4. Playwright touch drift: slide the GAS thumb to full right and hold 0.3 s at 60 km/h before a t1 corner → `driftPhase === 'drift'` within 0.3 s and the spark counter rises; release → `driftEnd` and a blue/orange spark burst.
  5. Playwright: with an item in the slot, flick up → `itemUse` within 100 ms; on desktop E does the same.
  6. Vitest slow motion: 8 s cooldown; none within 3 s of the player's finish; audio rate hook called with 0.7.
  7. Haptics: no call when `navigator.vibrate` is missing or the setting is off.

### WP7: Meta core (pure): cars, economy, progression, save v2
- **Model:** Sonnet 5.5 xhigh. **Size:** M.
- **Owns:** `src/meta/cars.ts`, `src/meta/economy.ts`, `src/meta/progression.ts`, `src/meta/save.ts`; config `garage`, `upgrades`, `economy`, `progression`; tests `economy.test.ts`, `save.test.ts`, new `cars.test.ts`, `progression.test.ts`, `economyPacing.test.ts`.
- **Depends on:** WP0 only (pure code).
- **Deliverables:** roster meta, PR, bars, unlock rules, prices, arrival levels, test-drive state, the owner switches `garage.allCarsOwned` and `garage.sharedUpgrades` (GDD D1, D3); per-car upgrade costs by tier; reward breakdown and repair formulas (GDD 16.1); XP, levels, feature gates (16.3); save v2, sanitizer, lossless v1 → v2 migration (23); a reference-player pacing simulation.
- **Acceptance (Vitest):**
  1. Reward examples exact: L1 Race, 3rd, 700 smash, 2,000 drift, 1 new star → 300 + 70 + 50 + 100 = 520; S = 3,000 → smash coins 225 × multiplier; Sprint ×0.7; Rampage gold = 1st prize; Boss win = 2 × 1st; Quick Race Normal ×0.7 × highest league multiplier; rewarded doubling excludes star and first-race bonus.
  2. Repair: never above 40% of the event's first prize; Scrapper ×0.65; minimum 20.
  3. Upgrade cost table per tier exactly as GDD 10.4; boss cars arrive at level 2, bought cars at level 1; buying needs stars, coins and league as GDD 10.3.
  4. PR of all 10 cars stock and max within ±1 of GDD 10.2; bars within ±1 of GDD 10.3.
  5. Migration fixture (money 1234, upgrades 2/1/4, carColor 3, bestPlace t1 2 and t2 4, unlocked t1 and t2, ghost t1, tutorialDone true) → v2 with money 1234, `cars.scrapper.up` 2/1/4, paint 3, stars on L1-1 to L1-4, ghost t1 kept, `ftueStep` 6. Invalid model ids, levels and event ids are dropped or clamped. A fully populated core JSON ≤ 12 KB. Round trip identical.
  6. `economyPacing` (60 seeds, reference player of the GDD): L2 opens by race 9 to 14, L3 by 20 to 32, L4 by 38 to 55, L5 by 65 to 95; career done in 110 to 190 races; never more than 4 races without an affordable goal in the first 60 races.

### WP8: Meta live (pure): career, daily, achievements, goals
- **Model:** Sonnet 5.5 xhigh. **Size:** M.
- **Owns:** `src/meta/career.ts`, `src/meta/daily.ts`, `src/meta/achievements.ts`, `src/meta/goals.ts`; config `career`, `daily`, `achievements`; tests new `career.test.ts`, `daily.test.ts`, `achievements.test.ts`, `goals.test.ts`.
- **Depends on:** WP0 only (uses `RaceSummary` and the save type).
- **Deliverables:** the 35-event table with star evaluators, gates, layout fallback, `nextEvent`, Daily Challenge generator (GDD 15); login calendar with no-reset streak and clock-rewind guard, date-seeded tasks with availability filters, all-done bonus (17.1, 17.2); 20 achievements (17.3); next-goal resolver and red dots (20.8).
- **Acceptance (Vitest):**
  1. 35 unique event ids; 105 stars; every layout id resolves (directly or via fallback); every goal kind has an evaluator; `starsFor` fixture per goal kind (e.g. a summary with place 4 and 16 objects on L1-1 → ★3 only).
  2. Gates: boss opens at the GDD star counts; next league needs boss + cumulative stars; `nextEvent` returns the first open event without ★1, else the boss, else the event with the fewest stars.
  3. Daily: same date → same 3 distinct tasks; tasks needing a locked feature never appear; login day advances once per local date; missing 3 days keeps the day counter; a clock moved back 2 h is ignored; a second claim on the same date is refused.
  4. Achievements unlock from summaries and pay once.
  5. Goals: priority order fixtures (claimable > affordable upgrade > near car unlock > boss stars > league > tasks > best lap).

### WP9: UI race (HUD, pops, minimap, pause, results, FTUE prompts)
- **Model:** Sonnet 5.5 xhigh. **Size:** M to L.
- **Owns:** `src/ui/hud.ts`, `hudFx.ts`, `minimap.ts`, `pause.ts`, `results.ts`, `tips.ts`, `src/ui/css/hud.css`, `results.css`, `pause.css`, `tips.css`, `src/ui/preview/race.ts`, `src/i18n/hud.ts`, `ftue.ts`, `results.ts`; config `ui.hud`, `ui.results`, `ui.tips`; e2e `e2e/ui-race.mjs`.
- **Depends on:** WP0; real data from WP2/WP7/WP8 at integration (develops against preview fixtures).
- **Deliverables:** HUD v2 per GDD 20.6 (portrait, landscape, PC), pooled pops layer (max 8), world-space drift meter and smash pops via `worldToScreen`, item slot (calls `triggerItem()`), style ring, minimap, wrong way, missed checkpoint, wreck card, Knockout and Rampage timers, lap banners with delta; Pause v2 (20.9); Results sequence and buttons (20.7); tips engine and FTUE prompts (19).
- **Acceptance (Playwright on `ui-preview.html` + the real game):**
  1. At 390×844, 844×390, 1280×720 and 360×640 (RU): no element with text has `scrollWidth > clientWidth + 1`; no HUD element intersects the centre 50% × 60% box; text ≥ 12 px, position and speed numbers ≥ 28 px; touch targets ≥ 44 px.
  2. Results: a tap during the sequence shows the buttons within 300 ms; NEXT is the largest button; the AD button shows the exact coin number; NEXT becomes RETRY on a starless 4th or worse.
  3. 20 smash events within 1 s → ≤ 8 pop nodes alive.
  4. `updateHud` average ≤ 0.5 ms per frame over 600 frames in a race (performance marks).
  5. Tips: at most one on screen, ≥ 20 s apart, each ≤ 2 times (unit test of `tips.ts`).

### WP10: UI meta (hub, career, garage, sheets, quick race, today, trophies, settings, reveal)
- **Model:** Sonnet 5.5 xhigh. **Size:** L.
- **Owns:** `src/ui/hub.ts`, `career.ts`, `garage.ts`, `sheets.ts`, `quick.ts`, `today.ts`, `trophies.ts`, `settings.ts`, `reveal.ts`, matching `src/ui/css/*.css`, `src/ui/preview/meta.ts`, `src/i18n/meta.ts`, `cars.ts`, `today.ts`, `trophies.ts`, `settings.ts`; config `ui.meta`; e2e `e2e/ui-meta.mjs`.
- **Depends on:** WP0; WP7/WP8 APIs (stubs until merged); WP5 `showCar` (stub until merged).
- **Deliverables:** screens per GDD 20.1 to 20.5, 20.10, 20.11 for portrait, landscape and PC; Enter = primary, ←/→ carousels, Backspace = back; red dots; "choose your 2nd car" reveal; test-drive and unlock flows; all strings of GDD 26.1 to 26.7 and 26.12 to 26.15.
- **Acceptance (Playwright):**
  1. Hub at 390×844: RACE ≥ 80 px tall, in the bottom 45% of the screen; one tap on RACE starts a race (state `racing` within 3 s).
  2. Garage: swiping left changes the car name; 10 page dots; a locked car shows its exact requirement and a test-drive button; Select persists after a reload.
  3. Rivals sheet: 2 taps from the hub to change the mode; the choice persists; the fairness line is visible.
  4. Settings: each new setting persists after a reload; camera and drift assist take effect in the next race.
  5. No page scroll in landscape 844×390 on any screen; RU 360×640 overflow check as WP9.

### WP11: Platform, ads, audio, telemetry
- **Model:** Sonnet 5.5 high. **Size:** M.
- **Owns:** `src/platform/bridge.ts`, `src/platform/telemetry.ts`, `public/playgama-bridge-config.json`, `src/audio/audio.ts`, `public/sfx/*`, `scripts/make-sfx.sh`, `docs/AUDIO.md`; config `audio`, `ads`, `telemetry`; tests `platformAds.test.ts`, `platformMessages.test.ts`, new `audioMap.test.ts`, `noStorage.test.ts`.
- **Depends on:** WP0.
- **Deliverables:** Bridge delays 180/180; leaderboard ids for the 10 layouts (hidden unless available); rewarded placement helper with names and caps R1 to R5 (counters in `save.daily.ads`); telemetry wrapper (GDD 24) following the Playgama telemetry guide (`get_game_telemetry_guide`); audio: every new cue (GDD 22) mapped to events, separate music and effects gains, slow-motion rate and low-pass, drift and nitro loops; placeholder files + MUST-REPLACE rows in `docs/AUDIO.md`; read `get_game_checklist` and `get_bridge_sdk_docs` (Playgama MCP) and report each item's status.
- **Acceptance (Vitest):**
  1. `showInterstitial` is never called while the game state is `racing` or `finishing` (spy across a simulated loop); rewarded rewards only on the `rewarded` state; per-placement caps enforced.
  2. Bridge config: `initialInterstitialDelay` 180, `minimumDelayBetweenInterstitial` 180, 10 leaderboard ids.
  3. Every `SimEvent` type maps to a cue or an explicit "silent" entry (exhaustive switch test); every cue file exists as ogg and mp3; `docs/AUDIO.md` lists each.
  4. No `localStorage`, `sessionStorage` or `document.cookie` anywhere in `src/` (grep test).

### WP12: Integration and flow (W2 skeleton, W3 wiring)
- **Model:** Opus 5.5 xhigh. **Size:** L.
- **Owns:** `src/game.ts`, `src/main.ts`, `src/playerReset.ts`, `index.html`, `ui-preview.html`, `src/ui/ui.ts`, `src/ui/screens.ts`, `src/ui/css/base.css`, `src/i18n/core.ts`, `src/ui/preview.ts`; config `game`; tests `gameFlow.test.ts`, `playerReset.test.ts`; e2e `e2e/loop.mjs`.
- **W2 (12a):** against the stubs: FTUE first-launch flow (empty save → race 1 without the menu), event start from hub/career/quick/daily, results NEXT/RETRY/GARAGE with an interstitial request before each, slow-motion time scale, R1 to R5 plumbing, save points.
- **W3 (12b):** wire real modules: `makeField` → Sim, `simParams(ev)` → SimOptions, `summary()` → economy, career, progression, daily, achievements → `ResultsData` v2 → results screen; test drives; login popup on session 2; Choose 2nd car; guided garage; fail assist; respawn hooks; telemetry calls; fix seam bugs in owned files, file fix tickets for the rest.
- **Acceptance:**
  1. Vitest `gameFlow`: empty save → state `racing` with `ftue` options and no `start` call from the UI; results NEXT → exactly one interstitial request → next event racing; RETRY and GARAGE likewise; the double reward works once; the save is written only at race end, purchases, claims and settings changes; a level-up pays its coins; a free test drive is consumed once; session 2 with a claimable day shows the login popup.
  2. Playwright `e2e/loop.mjs` (phone touch and desktop keys): boot → FTUE race driven by a bot → results → choose a car → guided upgrade → next event → Quick Race with "Same as mine" rivals → pause → free repair (stub ad) → quit → hub; no console errors; tap counts of GDD 20.2.

---

## 5. Dependencies and merge order

```
WP0 ─┬─► WP7 ─┐
     ├─► WP8 ─┼──────────────► WP9, WP10 (real data) ─┐
     ├─► WP1 ─► WP2 ─► WP3 ─┐                          │
     ├─► WP4 ───────────────┼─► WP3 sweep on 10 layouts│
     ├─► WP5 (sizes from WP1 config)                   ├─► WP12b ─► WP13 gate
     ├─► WP6                                           │
     ├─► WP11                                          │
     └─► WP12a, WP13a ─────────────────────────────────┘
```

Merge order onto `sc/v02` (each merge followed by the full test suite): WP7 → WP8 → WP1 → WP4 → WP2 → WP6 → WP5 → WP3 → WP11 → WP9 → WP10 → WP12b. A package that is ready early merges early if everything before it in the order is merged or does not touch its contract; otherwise it waits and rebases.

Soft dependencies are handled with the WP0 stubs: UI packages render preview fixtures; WP2 uses the boost/drift stubs until WP1 lands; WP3 tunes on t1 to t3 until WP4 lands, then re-runs its sweep.

---

## 6. Model and effort allocation, swarm use

| Package | Model / effort | Why |
|---|---|---|
| WP0 Contract | Opus 5.5 xhigh | every later package depends on it |
| WP1 Driving | Opus 5.5 xhigh | feel, physics, determinism |
| WP2 Rules/combat/modes | Opus 5.5 xhigh | many interacting systems in the sim core |
| WP3 AI/rivals | Opus 5.5 xhigh | balance and behaviour, long headless runs |
| WP4 Tracks/themes | Opus 5.5 high + Haiku 5.5 xhigh swarm | spatial design; screenshot review |
| WP5 Car models/renderer | Opus 5.5 high + Haiku swarm | visual quality; per-car review |
| WP6 Camera/input/FX | Opus 5.5 high | feel and gesture tuning |
| WP7 Meta core | Sonnet 5.5 xhigh | pure, table-driven |
| WP8 Meta live | Sonnet 5.5 xhigh | pure, table-driven |
| WP9 UI race | Sonnet 5.5 xhigh | DOM/CSS volume |
| WP10 UI meta | Sonnet 5.5 xhigh | DOM/CSS volume |
| WP11 Platform/audio | Sonnet 5.5 high | wrappers and mapping |
| WP12 Integration | Opus 5.5 xhigh | seams across all modules |
| WP13 QA lead | Opus 5.5 high + Haiku 5.5 xhigh swarm (20 to 60 agents) | breadth |
| Per-package review | Sonnet 5.5 high, `code-review` skill | second pair of eyes |

Haiku swarm jobs (each agent gets one narrow, checkable job and returns JSON):
- RU and EN proofreading: one agent per i18n dictionary file (consistency of "ты", terminology, length ≤ the GDD limits).
- Screenshot audits: one agent per screen × viewport × language (about 14 screens × 4 viewports × 2 languages) against the checklist in section 7.
- Headless sweeps: one agent per (layout × car model): runs `aiSweep`/`carBalance` seeds, reports stuck cars, respawns, lap outliers.
- Star reachability: one agent per career event: runs a scripted bot at the event's target PR and reports whether each ★ goal is reachable and how hard (feeds `CONFIG.career` thresholds).
- IP/brand check: one agent per name list (cars, drivers, bosses, tracks, paints) against real car models and brands.
- Acceptance drafting: one agent per package turns that card's acceptance list into test skeletons for WP13a.

---

## 7. WP13: QA and release gate

- **Model:** Opus 5.5 high (lead) + Haiku 5.5 xhigh swarm. **Size:** L, runs from W2 to W4.
- **Owns:** `e2e/player-checks.mjs`, `e2e/run.mjs`, new `e2e/perf.mjs`, `e2e/i18n-overflow.mjs`, `e2e/screens.mjs`, `tests/qa/*.test.ts`; results go to `e2e/out/` (JSON + PNG, not committed docs).
- **W2 (13a):** build the harness against the contract hooks (`window.__game.startEvent`, `summary()`, `ui.screen`), capture the v0.1.2 baselines (FPS, draw calls, stepMs on t1 at low quality, phone and desktop profiles), write skeleton checks for every card.
- **W4:** run everything on the integrated build (`npm run build` + `vite preview`), file fix tickets to the owning package, re-run until green.

### Release gate G4 (every item must pass; any failure = no release)

Player view, phone profile (390×844, touch, dpr 2) and desktop profile (1280×720, keys); both camera modes where marked:
1. First launch with an empty save: no menu, the HOLD prompt is visible, holding GAS starts the countdown and the car drives (speed > 15 m/s within 4 s of GO).
2. Pressing right turns the car clockwise on screen and left counter-clockwise (keys and touch, Follow and Fixed, including a section where the car drives down the screen in Fixed).
3. Touch drift: full lock held at 60 km/h before a corner → drift within 0.3 s; blue sparks appear; a clean exit gives a speed gain ≥ 2 m/s within 0.5 s.
4. Boost pad at 25 m/s → speed +4 m/s or more within 0.3 s.
5. Item: pickup → slot icon within 0.8 s; flick up (touch) or E (desktop) → `itemUse` within 100 ms; Shockwave pushes a rival within 9 m.
6. Slipstream: 8 m behind an AI car on a straight for 1.5 s → SLIPSTREAM chip visible and speed above the solo equilibrium.
7. Parts fly off on a 70 km/h wall hit, for every one of the 10 models; damage silhouette and health bar change.
8. Takedown: ramming an AI car into a wall at 60 km/h → TAKEDOWN banner and +300 in the race counter.
9. Wreck: player health forced to 0.1, then a wall hit → WRECKED card, respawn within 2.5 s, 50% health.
10. Frost Pass infield cut → MISSED CHECKPOINT and no lap credit; driving the wrong way 2 s → WRONG WAY.
11. Results → NEXT: one tap starts the next event (`racing` within 3 s) with exactly one interstitial request; no interstitial request ever while racing.
12. Rivals "Same as mine": all 7 AI cars render with the player's model (render debug ids); "One model: Mammoth": all 7 are Mammoths.
13. Garage: 10 cars browsable, distinct silhouettes (WP5 IoU test), locked cars show requirements, test drive works once for free.
14. Each of the 7 modes plays to its end on its first career event without errors; Knockout eliminates; Rampage timer ends at 90 s.
15. Save: v1 save injected into the fake storage → v2 with money and upgrades kept; progress persists across reloads; the game runs with `localStorage` access throwing.
16. Pause on tab hidden and during ads (game and audio); P pauses on desktop; Esc does nothing.
17. RU and EN: no missing keys; no overflow at 360×640 and 320×568 on any screen; Haiku screenshot audit has no "major" finding.
18. Performance (headless baseline machine, low quality, phone profile, 60 s race on Scrapyard with 8 distinct models): average FPS ≥ 90% of the v0.1.2 t1 baseline; draw calls ≤ 110; browser `sim.stepMs` average ≤ 1.5 ms; no long task > 50 ms after the first 5 s.
19. Headless sweeps: 10 layouts × 10 models × 5 seeds: all races finish; ≤ 1 respawn per race on average; career star goals all reachable by the scripted bot at target PR (report per event).
20. Playgama checklist (`get_game_checklist`) re-read and checked item by item; items that cannot be checked automatically are listed for the owner. Audio placeholders are reported as the remaining release blocker until recorded/CC0 files replace them (GDD 22).
21. No console errors in any run.

Real-device check (coordinator, after G4): the play-test build on a mid Android phone and a desktop browser; the owner's feedback loop.

---

## 8. Risks and fallbacks

| Risk | Fallback |
|---|---|
| WP0 slips (everything waits) | Strict scope: plumbing and stubs only, no behaviour; split UI/i18n moves into a mechanical first commit |
| 10 distinct meshes cost too many draw calls on low | merged-parts mesh with a per-vertex part id and per-instance detached mask (2 meshes per model), or cap distinct models per race at 4 (config) |
| Drift tuning feels wrong on real phones (accidental drifts) | `assistNeedsCorner`, thresholds in config, Drift assist off switch; Drift Trial falls back to Race in the career table |
| Follow camera causes discomfort or worse landscape view | Fixed stays one tap away (Pause quick toggle); default per orientation is a config switch |
| t4/t5 not ready | `CONFIG.career.layoutFallback` maps them to reversed t1 to t3 |
| AI pace baselines break after drift and boosts | WP3 owns the re-baseline; career PR targets are config, tuned by the star-reachability swarm |
| Respawn rule rejected by the owner | `CONFIG.combat.respawn = false` restores limping (keep the code path) |
| Per-car upgrades rejected by the owner | `CONFIG.garage.sharedUpgrades = true` reads one shared level set (WP7 keeps both paths in `statsFor`) |
| Save migration bug wipes progress | migration fixtures, sanitizer tests, core/ghost two-key split kept, write only after a successful load |
| Interstitial config overridden by the platform | no game-side timers; only natural-pause requests |
| Audio files not sourced in time | release blocked by the gate (item 20); the play-test build can ship with placeholders, Playgama upload cannot |
| Contract amendments pile up | one coordinator owns `types.ts`/`config.ts` after G1, batches amendments twice a day, notifies all packages |
