# Smash Circuit v0.2: implementation plan (P0 scope of GDD v2.1)

Design: `docs/GDD.md` (section numbers below refer to it). Binding requirements: `docs/REQUIREMENTS.md`. Module rules: `docs/ARCHITECTURE.md` (still valid: sim/meta have no three.js or DOM, deterministic sim, no localStorage, no Esc, all strings via `t()`/`tp()`). This is revision 2 of the plan, after review round 1; the issue-by-issue log is section 12.

**Packages (19):** WP0a contract core and WP0b UI/i18n scaffold; WP1 to WP12 feature packages (WP12 = integration); WP13 QA and the release gate; **WP14 audio content** (sourcing and licences), **WP15 performance**, **WP16 balance**, **WP17 release**. WP0a runs first and alone; WP0b and WP1 to WP11, WP14, WP15 run in parallel with disjoint file ownership; WP12b integrates; WP16 tunes; WP13 gates; WP17 ships.

---

## 1. Gates, waves and the critical path

```
G0   in-flight agents (visible car damage; boost pads + power-ups) merged, all tests green, tagged v0.1.2
 │   ┌ WP14 AUDIO CONTENT starts here (sourcing, licence log) ────────────────────────────────────────┐
 │   └ WP15 PERF baselines start here (v0.1.2 Node + throttled browser numbers)                        │
W1   WP0a CONTRACT CORE (one agent) ──► G1: typecheck + all existing tests + player-checks green, no visual change
 │                                                                                                      │
W2   ┌ WP1 Driving (API day 1)   ┌ WP5 Car models/renderer  ┌ WP0b UI shell + i18n plurals ─► G1b         │
     │ WP2 Rules (API day 1)     │ WP6 Camera/input/FX      ├ WP9  UI race   (after G1b)                │
     │ WP3 AI/rivals             │ WP7 Meta core (pure)     ├ WP10 UI meta   (after G1b)                │
     │ WP4 Tracks/destruction    │ WP8 Meta live (pure)     ├ WP12a flow skeleton on stubs (after G1b)  │
     │ WP15 Perf modules         └ WP11 Platform/audio code └ WP13a QA harness + bot + sweeps on stubs  │
     │      G2 PLAY-TEST 1 after WP1 + WP6 merge (drift, cameras, gestures, real sound) ◄── first pack ─┘
     │      G2b PLAY-TEST 2 after WP12a (first 5 minutes, first 3 events) ──► career table frozen
W3   WP12b INTEGRATION ──► G3: full loop e2e green on phone + desktop; WP15 budgets measured on the real build
W3b  WP16 BALANCE (authority over tuning values across configs)
W4   WP13 QA gate + fix loop (owners fix their own files) ──► G4 release gate (section 9) ──► play-test deploy
W5   owner OK ──► WP17 RELEASE (Playgama console, leaderboards, covers, checklist, archive) ──► G5 moderation
```

**Critical path:** G0 → WP0a (about 1 day) → WP1 API freeze (first commit, day 1 of W2) → WP2 (about 4 days, built against WP1's real API while WP1 finishes in about 3 to 4 days) → WP3 (about 4 days, starts on WP2's day-1 API; its final sweep, `trackSpeed` and medal times need WP4 merged) → WP12b (about 2 days) → WP16 (about 2 days) → WP13 gate and fixes (2 to 3 days) → G4. **Expected length: 13 to 15 working days** of wall-clock with every parallel package staffed. UI and meta packages have at least 3 days of slack; WP14 has from G0 to G3.

---

## 2. Rules of engagement (all packages)

1. **File ownership is exclusive.** A package edits only the files listed under "Owns". Reading anything is allowed. A new file goes into the owner's directory and is listed in the package report.
2. **Contract by module.** WP0a freezes the *top-level* shape of `src/types.ts` (a re-export hub) and of `CONFIG` (assembled in `src/config/index.ts`). New types live in per-owner files `src/types/<area>.ts`; new config values live in per-owner files `src/config/<area>.ts` (tables 3.1, 3.2). An owner extends its own files additively at any time (new optional field, new union member, new key); no coordinator batch is needed. A change in another package's file is a same-day ticket to that owner.
3. **API freeze day 1.** WP1 and WP2 land their public API (types, event unions, config keys, function signatures with stub bodies) as their first commit on day 1 of W2, so WP2, WP3, WP5 and WP6 build against real signatures.
4. **i18n:** `src/i18n.ts` keeps `t()` / `initLang()` / `lang()` and adds `tp()`, `fmtNum()`, `fmtDuration()` (GDD 26.0); dictionaries in `src/i18n/*.ts`, one owner each (table 4.1). Every key exists in `en` and `ru`, every (n) key in all plural forms (test).
5. **CSS:** `src/ui/ui.css` is split into `src/ui/css/*.css` per screen module; one owner per file; shared design tokens live in `src/ui/css/base.css` (WP0b, then WP12).
6. **Tests:** each package adds its own test files (listed). Existing test files have one owner each (listed); `tests/i18n.test.ts` belongs to WP0b, then WP13. `npm run typecheck && npm test` must pass before a package asks to merge.
7. **Branches:** one git worktree per package, branch `sc/v02-wpN-<slug>`, based on the integration branch `sc/v02`. Rebase onto `sc/v02` before merging. Commit messages end with the attribution lines from the session.
8. **Determinism and budgets:** sim code uses `src/sim/rng.ts` only; no render or camera state ever reaches the sim. Each sim package has a per-step cost delta (GDD 25), checked by WP15's bench on every merge.
9. **Owner rules every package keeps:** the one destruction system (GDD 9.0); the preserved physics rules (GDD 9.6: curbs as sensors, threshold after mass normalisation, no tunnelling, body changes only after the step, debris ≤ 60); 8 cars in lap races (D10).
10. **Platform rules every package keeps:** no `localStorage` / `sessionStorage` / cookies; no Esc; no external URLs or analytics; no game-side ad timers; every popup with a visible close; rewarded controls only when supported; strings only through `t()` / `tp()`; game keys call `preventDefault`.
11. **Review:** before merge every package diff gets a second-agent review (Sonnet 5.5 high, `code-review` skill, effort high). Findings are fixed by the owner.
12. **Do not touch** `../../play-test/` (deploy is the coordinator's step at G2, G2b and after G4).

---

## 3. WP0a: contract core (first, alone)

**Model:** Opus 5.5, effort xhigh. **Size:** M (types, config shape, stubs, plumbing; no UI work).

**Owns during W1:** `src/types.ts` + new `src/types/*.ts`, `src/config.ts` + new `src/config/*.ts` and `src/config/index.ts`, every new stub file listed in 3.3, minimal plumbing edits at the call sites listed in 3.4, the debug-hook stubs (3.5), `docs/ARCHITECTURE.md` (v2 module map), new `tests/contract.test.ts`. At G1 each file passes to the owner named in the tables.

**Starts after G0.** First step: read what the two in-flight agents added (item/pad sim module, pickup/pad render, damage visuals, new events, new config keys) and fold their types into the modules below; their files get owners in 3.6. Any other in-flight work merged before G0 (for example a handling, speed or drift pass) is folded in the same way, and its files go to the package that owns that area (driving → WP1).

**Gates:** WP1 to WP8, WP11, WP15 (G1). WP0b, WP14 do not wait for anything but G0/G1 as stated.

### 3.1 Types as modules

| File | Owner after G1 | Content |
|---|---|---|
| `src/types.ts` | coordinator (frozen hub) | existing core types; re-exports every module below; `CarState` top level frozen (below); `SimEvent = CoreEvent \| DriftEvent \| CombatEvent \| ItemEvent \| RaceEvent` |
| `src/types/cars.ts` | WP1 | `CarModelId`, `CarClass`, `DriftTuning`, `CarTraits` (incl. `regen`), `CarStats` additions, `UpgradeLevels`, `DriftState`, `DriftPhase`, `BoostKind`, `BoostState`, `DriftEvent`, `CarInput` and `CarSetup` additions |
| `src/types/rules.ts` | WP2 | `RaceMode`, `Modifier`, `SimOptions` and `RaceState` additions, `CombatState`, `ItemKind`, `ItemState`, `LapFlags`, `CombatEvent`, `ItemEvent`, `RaceEvent`, `RaceSummary`, `DamageCtx`, `AiPerception`, `ReplayFrame` |
| `src/types/ai.ts` | WP3 | `AiArchetype`, `AiPersonality` additions, `DriverDef`, `RivalsMode`, `FieldContext`, `MedalGhost`, `DriftGhost` |
| `src/types/track.ts` | WP4 | `TrackTheme`, `WallStyle`, `TrackDef` additions, `BoostPadDef`, `ItemRowDef`, destructible kinds for the new objects |
| `src/types/render.ts` | WP5 | `CarGeometries` (merged design), `PartDebrisInfo`, `PaintSpec`, `RenderDebug` |
| `src/types/view.ts` | WP6 | `CameraMode`, `CameraView`, `GestureConfig`, `FxDebug` |
| `src/types/save.ts` | WP7 | `SaveDataV2`, `GhostStoreV2`, `RecordsEntry`, `CosmeticId` |
| `src/types/career.ts` | WP8 | `EventDef`, `StarGoal`, `GoalKind`, `WeeklyDef`, `Goal`, `RedDots` |
| `src/types/ui.ts` | WP0b → WP12 | `ScreenId` (incl. hidden `store`), `SheetId`, `UiHandlers` v2, `ResultsData` v2 |
| `src/types/platform.ts` | WP11 | `AdPlacement`, `PauseKind`, `TelemetryName`, `LeaderboardEntry`, `AudioState` |

Key shapes (exact; owners may add optional fields later):

```ts
// src/types/cars.ts (WP1)
export type CarModelId = 'scrapper' | 'gravel' | 'brick' | 'sandhopper' | 'brawler' | 'bruiser' | 'glint' | 'scorcher' | 'needle' | 'mammoth';
export type CarClass = 'allround' | 'drifter' | 'tank' | 'offroad' | 'muscle' | 'rammer' | 'speedster' | 'hotrod' | 'racer' | 'juggernaut';
export interface DriftTuning { chargeMul: number; angleMul: number; dragMul: number; entryMul: number; spinMul: number; hbGripMul: number; assistSteer: number }
export interface CarTraits {
  offroadDragMul: number; offroadGripMul: number; propSlowMul: number; plowKeep: number;
  ramDamageMul: number; ramFrontOnly: boolean; frontRamWallMul: number; zoneDamageMul: Partial<Record<ZoneId, number>>;
  repairCostMul: number; repairKitMul: number; regen: { delay: number; perSec: number; cap: number } | null;
  nitroDurationMul: number; slipFillMul: number; slipCeilMul: number; launchWindowMul: number; launchKickMul: number;
  downforce: number; knockbackMul: number;
}
export interface CarStats { /* existing fields stay */ latAccelMul: number; steerMul: number; brakeMul: number; length: number; width: number; drift: DriftTuning; traits: CarTraits }
export type UpgradeLevels = Record<UpgradeBranch, 0 | 1 | 2 | 3 | 4 | 5>;
export interface CarInput { /* existing */ drift: boolean /* held */; driftPulse: boolean /* edge, once per frame */; useItem: boolean /* edge, once per frame */ }
export interface CarSetup { /* existing */ modelId: CarModelId; levels: UpgradeLevels; driftAssist: boolean; isBoss?: boolean }
export interface DriftState { phase: 'none' | 'drift' | 'spin'; angle: number; charge: number; tier: 0 | 1 | 2 | 3; points: number; chain: number }
export type BoostKind = 'drift1' | 'drift2' | 'drift3' | 'pad' | 'slip' | 'sling' | 'launch' | 'nitro' | 'smashNitro';
export interface BoostState { kind: BoostKind | null; left: number; slipstream: number }
export type DriftEvent = { type: 'driftStart'; carId: number } | { type: 'driftTier'; carId: number; tier: 1 | 2 | 3 }
  | { type: 'driftEnd'; carId: number; tier: 0 | 1 | 2 | 3; points: number; clean: boolean } | { type: 'spinOut'; carId: number }
  | { type: 'boost'; carId: number; kind: BoostKind } | { type: 'perfectStart'; carId: number } | { type: 'slipstream'; carId: number; on: boolean };

// src/types/rules.ts (WP2)
export type RaceMode = 'race' | 'sprint' | 'time' | 'rampage' | 'knockout' | 'drift' | 'boss' | 'final';   // 'rampage' = Smash Spree in the UI
export type Modifier = 'glass' | 'heavy' | 'norepair' | 'frenzy' | 'onemake' | 'underdog';
export type ItemKind = 'nitro' | 'shield' | 'repair' | 'shockwave' | 'smashNitro';
export interface CombatState { smash: number; combo: number; takedowns: number; immuneUntil: number; revengeOn: number | null; respawnIn: number; ghosted: boolean; eliminated: boolean }
export interface ItemState { item: ItemKind | null; roulette: number; shieldLeft: number; style: number }
export interface LapFlags { wrongWay: boolean; missedCheckpoint: boolean; sector: number; lapValid: boolean }
export type CombatEvent = { type: 'takedown'; by: number; victim: number; kind: 'wreck' | 'wall' | 'spin' | 'shockwave'; revenge: boolean }
  | { type: 'respawn'; carId: number; x: number; y: number; angle: number } | { type: 'healed'; carId: number; partsRestored: boolean }
  | { type: 'eliminated'; carId: number; place: number } | { type: 'smash'; carId: number; points: number; combo: number; x: number; y: number }
  | { type: 'styleFull'; carId: number };
export type ItemEvent = { type: 'itemPickup'; carId: number; item: ItemKind } | { type: 'itemUse'; carId: number; item: ItemKind };
export type RaceEvent = { type: 'checkpoint'; carId: number; missed: boolean } | { type: 'wrongWay'; carId: number; on: boolean } | { type: 'trackBreaking' };
export interface SimOptions { /* existing */ mode?: RaceMode; modifiers?: Modifier[]; ftue?: boolean; timeLimit?: number; items?: boolean; firstBoxNitro?: boolean }
export interface RaceState { /* existing */ mode: RaceMode; timeLeft: number; elimIn: number }
export interface DamageCtx { role: 'attacker' | 'victim' | 'static'; dealer?: number; receiver: number; zone: ZoneId; front: boolean; base: number; shockwave?: boolean }
export interface AiPerception { boxesAhead: { s: number; lateral: number }[]; padsAhead: { s: number; lateral: number; active: boolean }[];
  rivals: { id: number; ds: number; lateral: number; item: ItemKind | null; shield: boolean; nitro: boolean; ghosted: boolean }[];
  wallGapLeft: number; wallGapRight: number; packToken: boolean }
export interface RaceSummary {
  mode: RaceMode; layoutId: string; laps: number; place: number; finished: boolean; eliminated: boolean;
  time: number; bestLap: number; bestValidLap: number; validLaps: number; score: number;
  smash: number; objects: number; props: number; walls: number; guardrails: number; roadChunks: number;
  takedowns: number; revengeTakedowns: number; bossTakedown: boolean; partsKnockedOff: number;
  driftPoints: number; bestDriftChain: number; cleanDrifts: number; slipstreams: number; leadTime: number;
  itemsPicked: number; itemsUsed: number; nitroUses: number; perfectStart: boolean;
  healthAtFinish: number; repairsUsed: number; wrecks: number; distance: number; topSpeed: number; bestCombo: number;
  ledAfterLap1: boolean; lastAfterLap1: boolean; placesGained: number; winMargin: number;
}

// src/types.ts (frozen top level)
export interface CarState { /* existing fields */ modelId: CarModelId; drift: DriftState; boost: BoostState; combat: CombatState; items: ItemState; lap: LapFlags }
export interface ISim { /* existing */ summary(carId?: number): RaceSummary }
// src/types/save.ts: SaveDataV2 = GDD section 23 verbatim (version: 2)
```

### 3.2 Config files and owners
`CONFIG` keeps today's shape (existing keys unchanged); `src/config/index.ts` assembles it from the files below and `src/config.ts` re-exports it. WP0a creates every file with the GDD default values so the game builds; after G1 the owner tunes values and appends keys.

| File | Owner | CONFIG sections (GDD) |
|---|---|---|
| `src/config/index.ts` | WP0a → WP12 | assembly only |
| `driving.ts` | WP1 | `sim` (step, default `maxSubSteps`), `car` (+ `absMaxSpeed` 80), `damage`, `cars` (10 entries), `drift`, `boost` (6, 7, 9.6, 10.2, 10.3) |
| `rules.ts` | WP2 | `race` (+ sectors, wrongWay), `modes` (+ spree refill timing), `combat` (+ respawn, slam immunity 10 s, revenge, knockout grace 5 s), `score`, `style`, `items`, `pads`, `replay` (7.2, 7.4, 8, 9, 13) |
| `ai.ts` | WP3 | `ai` (+ decision rate), `rivals` (+ `visibleRadius` 45), `leagues.ai`, `bosses`, `drivers` (20), `trackAi` (per-layout `trackSpeed` and Time Attack base laps) (11, 12, 14, 15.2) |
| `tracks.ts` | WP4 | `tracks` (layouts, order, laps, pads, rows, FTUE cluster, t2 drift-lesson s), `destruction` (+ theme props, crane feet, crusher, awake cap 24) (9.0, 14) |
| `renderCars.ts` | WP5 | existing `render` core keys (lights, colours), `render.models`, `render.car` (+ part life is in `render.fx`) (10.3, 25) |
| `view.ts` | WP6 | `render.camera` (Fixed default), `render.fx` (+ pools, debris 36 + 24, part life 2.0), `controls` (+ flick, `gasHoldOver`, brake tap), `slowmo`, `haptics` (5, 21) |
| `quality.ts` | WP15 | `render.quality` (+ per-level `maxSubSteps`: low 3; `autoStart`, `benchmark`) (25) |
| `meta.ts` | WP7 | `garage` (+ `upgradeModel`, `allCarsOwned`), `upgrades`, `economy`, `progression`, `cosmetics`, `mastery`, `save` (budgets) (10.4 to 10.6, 16, 23) |
| `career.ts` | WP8 | `career` (35 events, gates, layout fallback, thresholds, `driftStars`), `daily`, `weekly`, `remix`, `achievements` (15, 17) |
| `uiRace.ts` | WP9 | `ui.hud`, `ui.results`, `ui.tips` (19, 20.6, 20.7) |
| `uiMeta.ts` | WP10 | `ui.meta` (20) |
| `platform.ts` | WP11 | `audio` (+ engine classes, voices), `ads` (+ `markRetry`, `inputLockAfterAd`), `telemetry`, `leaderboards` (17.5, 18, 22, 24) |
| `game.ts` | WP12 | `game` (flow timings; `meta.trackOrder` moves to `tracks.order`, owned by WP4) |

During WP16 (balance) the tuning *values* of `driving.ts` (cars), `rules.ts` (score, style), `ai.ts`, `meta.ts` and `career.ts` belong to WP16; structural changes still go to the owner.

### 3.3 New module stubs (typed, safe defaults, so everything compiles and runs unchanged)

| File | Exported API (stub returns a neutral value) | Real owner |
|---|---|---|
| `src/sim/world.ts` (existing) | `postStep.enqueue(fn)`, drained after `world.step` | WP1 |
| `src/sim/drift.ts` | `class DriftController { update(input, kin, stats, setup, surface, cornerAhead, dt): DriftOut }` (assist inside) | WP1 |
| `src/sim/boost.ts` | `class BoostStack { add(kind, p); apply(base: CarStats): CarStats; update(dt); cancel(kind) }` | WP1 |
| `src/sim/combat.ts` | `class CombatTracker { onContact(a, b, impulse, normal); update(cars, events, dt) }`, `composeDamage(ctx: DamageCtx): number` (identity) | WP2 |
| `src/sim/modes.ts` | `interface ModeRules { init(sim); update(sim, dt, events); isOver(sim): boolean }`, `rulesFor(mode, mods)` | WP2 |
| `src/sim/score.ts` | `class SmashScore { onBreak(e, by); onTakedown(by, revenge); points(carId) }` | WP2 |
| `src/sim/perception.ts` | `fillPerception(sim, carId, out: AiPerception)` (empty lists, gaps 99) | WP2 |
| `src/sim/replay.ts` | `class ReplayBuffer { record(sim); window(t0, t1): ReplayFrame[] }` | WP2 |
| `src/sim/summary.ts` | `buildSummary(sim, carId): RaceSummary` | WP2 |
| `src/sim/destruction.ts` (existing) | `respawnPiece(id)`, `padActive(padIndex)`, item boxes as sensor destructibles, `awakeCap` | WP4 |
| `src/meta/cars.ts` | `CAR_IDS`, `carDef`, `statsFor(id, levels)`, `prOf(stats)`, `bars(id)`, `unlockState(save, id)`, `upgradeCost(id, branch, lvl)`, `buyCar`, `buyUpgrade`, `showroomStats(id, targetPr)`, `levelsForTarget(id, pr)` | WP7 |
| `src/meta/progression.ts` | `xpFor(summary, newStars, quick)`, `applyXp(save, xp)`, `featureOpen(save, f)`, `titleFor(level)` | WP7 |
| `src/meta/cosmetics.ts`, `mastery.ts`, `records.ts`, `ghostCodec.ts` | `buyCosmetic`, `ownedCosmetics`; `addCarXp`, `masteryLevel`; `applyRecords(save, summary) → newRecords`; `encodeGhost`, `decodeGhost` | WP7 |
| `src/meta/career.ts` | `EVENTS`, `eventById`, `starsFor(ev, summary)`, `isOpen(save, ev)`, `bossOpen`, `leagueOpen`, `nextEvent(save)`, `dailyChallenge(date)`, `simParams(ev)`, `applyEventResult(save, ev, summary)` | WP8 |
| `src/meta/daily.ts`, `weekly.ts`, `remix.ts` | `loginState`, `claimLogin`, `tasksFor`, `trackTasks`, `claimTask`; `weeklyEvent(isoWeek)`, `applyWeekly`; `remixOpen`, `remixParams(ev)` | WP8 |
| `src/meta/achievements.ts`, `goals.ts` | `ACHIEVEMENTS`, `trackAchievements`, `claimAchievement`; `nextGoal(save): Goal`, `redDots(save)` | WP8 |
| `src/meta/opponents.ts` (existing) | new `makeField(ctx: FieldContext): CarSetup[]` next to the old function | WP3 |
| `src/data/medalGhosts.ts`, `src/data/driftGhosts.ts` | empty records per layout | WP3 |
| `src/render/carModels.ts` | `buildModel(id): CarGeometries` (stub: today's car for all ids), `partDebris(modelId, part): PartDebrisInfo` (stub: today's box sizes) | WP5 |
| `src/render/quality.ts`, `warmup.ts`, `contextLoss.ts` | `startLevel()`, `benchmark()`, `autoAdjust()`; `warmUp(scene, renderer)`; `installContextLoss(renderer)` (stubs keep today's behaviour) | WP15 |
| `src/fx/slowmo.ts`, `src/fx/replayView.ts` | `class SlowMo { onEvents(ev, playerId, toFinish); scale(dt): number }`; `playReplay(frames)` (no-op) | WP6 |
| `src/platform/haptics.ts` | `haptic(kind)` | WP6 |
| `src/platform/telemetry.ts`, `leaderboards.ts` | `track(name, data)`; `submitLap(layout, ms)`, `rankAndTop(layout)` (unavailable) | WP11 |
| `src/debug/frameLog.ts` | `?debug` frame-time ring buffer for the real-device check | WP15 |

### 3.4 Plumbing edits WP0a makes at call sites (so later packages never touch each other's files)
- `renderer.ts`: `camera.update(dt, view: CameraView)` with `CameraView { px, pz, vx, vz, speedFrac, intro, trackTangent, boost, drift, slowmo }`; `worldToScreen(x, y)`; calls `quality.startLevel()`, `warmUp()` before the first race frame, `installContextLoss()`; per-group draw counters (`drawsByGroup`).
- `sim.ts`: accepts the new `SimOptions` fields (ignored by the stubs); calls the stub controllers at their final hook points (drift before `integrateCar`, boost in `statsNow`, combat and `composeDamage` from the contact handler, score in `countBreaks`, modes after `tracker.update`, perception fill at 20 to 30 Hz staggered, replay record, `postStep` drain after `world.step`); implements `summary()` via `buildSummary`.
- `car.ts`: `recordImpact(…, ctx)`; fixture size from `stats.length` / `width` (defaults equal today's).
- `game.ts`: passes `modelId: 'scrapper'`, default `levels`, `driftAssist`, the default mode and camera `'fixed'`; time-scale hook `this.slowmo.scale(dt)` (identity); `maxSubSteps` from `render.quality[level]` (default today's 8 until WP15 sets low = 3); edge inputs latched once per frame.
- `input.ts`: `getInput()` returns `drift: false, driftPulse: false, useItem: false`.
- `fxManager.ts`: part debris reads `partDebris(modelId, part)` (stub = today's sizes).
- `opponents.ts`, `economy.ts`, `save.ts`: compile against `SaveDataV2` with a v1 → v2 passthrough migration (WP7 completes it).

### 3.5 Debug hooks (dev, localhost or `?debug` only; WP13 writes its checks against these in W2)

| Hook | Owner | Stub value |
|---|---|---|
| `__game.startEvent(id, { car?, rivals?, laps?, seed?, mode?, modifiers? })`, `setSetting(k, v)`, `setCar(id)`, `grant({ money?, stars?, level?, xp? })`, `freshSave()`, `state` | WP12 | today's race start; flags |
| `__game.input(override \| null)` (bot input injection, per frame) | WP12 | null |
| `__game.ui.screen`, `__game.ui.sheet` | WP0b → WP12 | current ids |
| `__game.summary()`, `__game.cars[i]` = `{ modelId, levels, pr, drift, boost, items, combat, lap, health, partsOff }`, `__game.force({ health?, item?, style? }, carId)`, `__game.teleport(carId, s, lateral)`, `__game.bodies()` (count by kind) | WP2 | today's fields + neutral sub-objects |
| `__game.ads` (requests, shows, rewards by placement, last close time), `__game.storage` (writes, keys, bytes), `__game.audio` (effective gain, platform state, voices) | WP11 | zeros |
| `__render.draws`, `tris`, `drawsByGroup { track, cars, fx, misc }`, `modelIds[]`, `partsActive`, `partOff[carId]`, `geometryBuilds` | WP5 | totals; groups 0; all `scrapper` |
| `__render.debris { breaks, parts }`, `sparksByTier [t1, t2, t3]`, `fxPools`, `camera { mode, azimuth, viewAhead, carPx }` | WP6 | zeros; `fixed` |
| `__render.quality { level, dpr, maxSubSteps }`, `__render.frames` (ring: frame work ms, sim ms), `programs` | WP15 | current values |

### 3.6 Ownership of in-flight files (filled at G0)
Default: item and pad sim logic → WP2; item/pad visuals → WP6; damage visuals inside `render/car.ts` → WP5; part debris in `fx/fxManager.ts` → WP6 (geometry from WP5's `partDebris`); new audio cues → WP11 (code) and WP14 (files).

### 3.7 Acceptance (G1)
- `npm run typecheck`, `npm test` (all existing tests, unchanged expectations), `node e2e/player-checks.mjs` all pass.
- `tests/contract.test.ts`: the deep key set of `CONFIG` equals v0.1.2's plus only the new keys; every stub module imports and returns its neutral value; `src/types.ts` re-exports every module.
- Screenshots of menu, garage, results, pause, settings and HUD at 390×844 and 1280×720 match v0.1.2 (pixel diff ≤ 1% per screen): WP0a changes no UI.
- Step time unchanged (headless 8-car field on t3: average `stepMs` within ±5% of v0.1.2, WP15's baseline).

---

## 4. WP0b: UI shell, CSS split, i18n with plurals, preview fixtures

**Model:** Sonnet 5.5, effort xhigh. **Size:** M. **Starts after G1; runs in parallel with the W2 sim packages; gates only WP9, WP10, WP12a (G1b).**

**Owns:** `src/ui/ui.ts` (shell: `UI` facade, router, layers, toasts, `UiHandlers` v2, shared helpers, the common sheet/popup component with a close button), `src/ui/screens.ts` (registry: every screen id → module, hidden `store`), `src/ui/css/*.css` (split of `ui.css`), `src/ui/preview.ts` + initial `src/ui/preview/*.ts`, `src/i18n.ts`, `src/i18n/*.ts` (split), `src/types/ui.ts`, `tests/i18n.test.ts`. At G1b `ui.ts`, `screens.ts`, `css/base.css`, `i18n/core.ts`, `preview.ts` pass to WP12; screen files and dictionaries pass to the owners in 4.1.

**Deliverables:** the split (mechanical first commit), `tp()` with `Intl.PluralRules`, `fmtNum()`, `fmtDuration()`, `initLang()` with `RU_TAGS = ['ru', 'be', 'kk']` (everything else → English), the shared sheet/popup component (visible close X, backdrop tap, Backspace with `preventDefault`), `UiHandlers` v2: `startEvent(id)`, `startQuick(opts)`, `next()`, `retry()`, `toGarage()`, `toHub()`, `selectCar(id)`, `buyCar(id)`, `buyUpgrade(id, branch)`, `paint(id, item)`, `buyCosmetic(id)`, `setRivals(r)`, `raceWithAd(eventId, car)`, `claimLogin(doubled)`, `claimTask(id)`, `claimAchievement(id)`, `claimWeekly(medal)`, `chooseStarter(id)`, `freeRepairAd()`, `nitroStartAd()`, `toggleMute()`, plus the existing ones.

### 4.1 UI and i18n split

| Module | Owner after G1b | Content |
|---|---|---|
| `src/ui/ui.ts`, `src/ui/screens.ts`, `src/ui/css/base.css` | WP12 | shell, registry, tokens |
| `src/ui/hud.ts`, `hudFx.ts`, `minimap.ts`, `pause.ts`, `results.ts`, `tips.ts` + `css/hud.css`, `results.css`, `pause.css`, `tips.css` | WP9 | |
| `src/ui/hub.ts`, `career.ts`, `garage.ts`, `sheets.ts`, `quick.ts`, `today.ts`, `trophies.ts`, `records.ts`, `shop.ts`, `settings.ts`, `reveal.ts` + matching css | WP10 | |
| `src/ui/preview/*.ts` fixture files per module (registered by `src/ui/preview.ts`) | each UI owner its own file | |
| `src/i18n/core.ts` (existing keys moved verbatim) | WP12 | |
| `src/i18n/hud.ts`, `ftue.ts`, `results.ts` | WP9 | GDD 26.8 to 26.11 |
| `src/i18n/meta.ts` (hub, goals, career, leagues, modes, mods, bosses, quick, rivals, drivers, reveal, toasts), `cars.ts`, `today.ts`, `trophies.ts`, `shop.ts`, `settings.ts` | WP10 | GDD 26.1 to 26.7, 26.12 to 26.15 |

**Acceptance (G1b):** screenshots of every existing screen at 390×844 and 1280×720 within 1% of v0.1.2; `tests/i18n.test.ts`: EN/RU key sync, every (n) key has `one`/`other` (EN) and `one`/`few`/`many` (RU), `tp` returns the GDD 26.0 forms for n ∈ {0, 1, 2, 5, 11, 21, 22, 25, 111, 1,000}, `fmtNum(1234)` is "1 234" (no-break space) in RU and "1,234" in EN, `uk`/`de` platform tags → `en` and `ru`/`be`/`kk` → `ru`, every literal `t('…')` / `tp('…')` key in `src/` exists; the sheet component closes by tap, mouse and Backspace (Backspace `defaultPrevented`).
---

## 5. Work packages (W2, in parallel)

Common acceptance for every package: `npm run typecheck && npm test` green, no console errors in `e2e/player-checks.mjs`, its own tests below, its perf delta inside budget (WP15 bench), second-agent review fixed. "8-car field" in headless tests means the full field of 8 cars with the player slot driven by the AI.

### WP1: Driving (10-car physics, drift, boost stack, physics safety)
- **Model:** Opus 5.5 xhigh. **Size:** L.
- **Owns:** `src/sim/carModel.ts`, `car.ts`, `damage.ts`, `drift.ts`, `boost.ts`, `world.ts`; `src/config/driving.ts`; `src/types/cars.ts`; tests `carModel.test.ts`, `damage.test.ts`, `crashTuning.test.ts`, `plow.test.ts`, `world.test.ts`, new `carRoster.test.ts`, `drift.test.ts`, `boost.test.ts`, `tunnel.test.ts`, `curbs.test.ts`, `postStep.test.ts`.
- **Depends on:** WP0a. **API freeze:** first commit on day 1 (types, events, config keys, `DriftController` / `BoostStack` / `postStep` signatures). Feeds WP2, WP3, WP5.
- **Deliverables:** per-car consumption of every `CarStats` field (cornering limit `maxLatAccel × latAccelMul`, steer, brake, size → fixture); grip upgrade raises cornering (+5% per level); `statsFor` stays in WP7, the model reads `latAccelMul`; **mass normalisation with the threshold applied to the normalised impulse** (GDD 9.2 steps 1 to 3; the rest of the chain is WP2's `composeDamage`); trait hooks (off-road, prop slow, plow keep, downforce, knockback, `regen`); drift state machine with the **assist inside the sim** (from `CarSetup.driftAssist`), `driftPulse`, charge, tiers, chain, spin-out, events (GDD 6); boost stack with caps, every source's API (GDD 7.1) and the absolute clamp `absMaxSpeed` 80 m/s; perfect-start window helper; wreck no longer cuts power (respawn is WP2); **the post-step queue** in `world.ts` that every body, fixture, filter and sensor change in the sim goes through (GDD 9.6).
- **Acceptance (Vitest):**
  1. For each car: 0 to 100 km/h in 4.1 × 8.0 / power ± 0.35 s; Scrapper 4.1 ± 0.4 s (existing target).
  2. For each car: steady lateral acceleration on a 30 m circle = 19 × latAccelMul ± 6%; 80 to 0 km/h braking = 23 m / brakeMul ± 15%.
  3. For each car: full lock at 15 km/h for 5 s, no spin (existing requirement).
  4. Ram: Mammoth into a stationary Needle at 20 m/s → Needle HP loss ≥ 3 × Mammoth HP loss. Bruiser head-on wall hit at 15 m/s → front zone loss ≤ 0.55 × Scrapper's.
  5. Drift assist (sim): steer 0.95 held at 20 m/s with a corner ahead and `driftAssist` on → `drift.phase === 'drift'` within 0.25 s; at 12 m/s → never; on a straight with `assistNeedsCorner` → never; `driftAssist` off → never. A `driftPulse` with steer 0.6 at 20 m/s → drift. An AI-driven car with the same inputs behaves identically.
  6. Drift balance with the **reference controller** (AI skill 1 on fixed test corners; one grip run and one run with scripted drift inputs): T2 through the 30 m corner at 24 m/s entry exits 0.15 to 0.35 s ahead; T1 through the 10 m hairpin at 16 m/s entry −0.05 to +0.10 s.
  7. θ > 65° → `spinOut`; impact ≥ 0.2 resets charge; chaining keeps 50% ± 2%.
  8. Boost caps: 1,000 random stacks of all sources with max upgrades → power ≤ 2.0, ceiling ≤ 1.30, speed never above `absMaxSpeed`; pad kick = 6 × cos(Δheading) ± 0.1; Nitro ends on impact ≥ 0.5.
  9. **Curbs and threshold (GDD 9.6):** every car driving along a curb at 20 m/s for 5 s → 0 HP loss and curb contact impulse 0 (sensor), speed reduced by the curb drag; a 3 m/s wall touch → 0 HP loss on every car; a 15 m/s wall hit → damage on every car.
  10. **No tunnelling:** every car at `absMaxSpeed` head-on into each wall kind (wall, guardrail, containers, hulks, world fence) at 5 angles, 100 runs each → never passes through; config test: every wall kind's thickness ≥ 1.15 × `absMaxSpeed` / 120.
  11. **Post-step queue:** a fixture, filter or sensor change requested inside a contact callback is applied after `world.step` (no planck assertion), and the queue is empty when the step returns.
  12. Perf: 8 cars × 10,000 steps of `integrateCar` + drift + boost in Node: per-step cost ≤ v0.1.2 + 0.06 ms.

### WP2: Race rules, combat, scoring, modes, perception, replay
- **Model:** Opus 5.5 xhigh. **Size:** L.
- **Owns:** `src/sim/sim.ts`, `race.ts`, `ghost.ts`, `combat.ts`, `score.ts`, `modes.ts`, `summary.ts`, `perception.ts`, `replay.ts`, the in-flight item/pad sim module; `src/config/rules.ts`; `src/types/rules.ts`; tests `race.test.ts`, `sim.test.ts`, new `sectors.test.ts`, `combat.test.ts`, `damageChain.test.ts`, `modes.test.ts`, `items.test.ts`, `summary.test.ts`, `slipstream.test.ts`, `perception.test.ts`, `replay.test.ts`, `sameStep.test.ts`.
- **Depends on:** WP0a; WP1 API (day 1). **API freeze:** day 1 (events, `AiPerception`, `RaceSummary`, `composeDamage`).
- **Deliverables:** sector checkpoints, missed checkpoint, wrong way, lap validity flag (GDD 9.4, 17.5); slam attribution with the **10 s immunity** and no slams on ghosted cars, revenge (9.2); `composeDamage` with the documented order (9.2 step 4 to 6); wreck → respawn with ghosting through the post-step queue and **all parts restored** (`healed` event on every heal); Knockout grace (9.3); slipstream pairs → boost source; perfect start detection at GO; style meter → Smash Nitro; smash points and combo (9.1); item distribution by position, first-box Nitro, Frenzy, No Repairs (8); boxes picked through WP4's sensor destructibles, pads read `padActive`; modes Race, Sprint, Time Attack, Smash Spree (refills and waves through WP4's `respawnPiece`), Knockout, Drift Trial, Boss, Final and the modifiers (field side of Heavy and One-Make is WP3); FTUE overrides; track-breaking event; `AiPerception` filled at 20 to 30 Hz, staggered; the replay ring buffer (6 s, 30 Hz); `summary()`.
- **Acceptance (Vitest):**
  1. A car teleported across the Frost Pass infield (s ≈ 160 → 460) gains no lap and gets `missedCheckpoint`; driving back clears it. A wall plow-through that clips a t1 corner by ≤ 15 m keeps full progress. Existing `race.test.ts` lap counts unchanged. A lap with a respawn or a wrong-way phase is not `lapValid`.
  2. Reversed at > 5 m/s for 1.0 s → `wrongWay` on; facing forward → off.
  3. Player car shunts an AI car at 15 m/s closing speed into a wall → `takedown{by: player}` within 2 s; a 3 m/s nudge → none; the same victim slammed again within 10 s (by anyone) → no event, no points; a ghosted car cannot be slammed; slamming the revenge target → `revenge: true`, points ×2.
  4. **Damage chain (table-driven):** every combination of role (attacker, victim, static) × ramDamageMul (with and without front contact) × dealer Nitro / Shield × receiver Shield / Smash Nitro × zoneDamageMul × Glass (≥ 96 cases) equals the documented product; toggling one factor alone changes the damage by exactly that factor (nothing applied twice); equal masses, attacker at 10 m/s → attacker / victim = 0.55 / 1.15 ± 10%; Shockwave = 12 HP, fully absorbed by a Shield.
  5. Wreck → `respawn` after 1.8 ± 0.1 s, 20 ± 3 m behind along the track, health 0.50 ± 0.02 in every zone, `healed{partsRestored: true}`, sensor fixtures for 2.0 s via the post-step queue, solid afterwards.
  6. Two Scrapper cars at 30 m/s, 8 m apart, lateral 0.5 m: follower `slipstream ≥ 0.95` after 0.7 s; follower equilibrium speed 47.5 to 49 m/s.
  7. Smash points per kind exactly as GDD 9.1; 5 breaks 1 s apart → combo 2.0; cap 3.0.
  8. Modes: Time Attack runs 1 car; Race, Sprint, Knockout run 8; Smash Spree ends at 90.0 s sim time, a prop broken > 80 m from the player is back after 12 to 15 s, a wave drops every 20 s; Knockout eliminates the last car at 25, 40, 55 … s, skipping cars that respawned < 5 s ago, and ends with one car; Drift Trial score = Σ driftEnd points × chain; Boss = 2 cars; Underdog puts the player last on the grid; Glass doubles damage; No Repairs makes `repairPlayer()` a no-op and removes Repair Kits.
  9. Item table: 10,000 rolls per position band within ±2% of GDD 8.1; first box in an `ftue` race is Nitro; a car with a full slot passes a box without breaking it.
  10. `summary()` of a scripted race matches the event counters (objects, slams, drift points, items, health, valid laps, top speed, best combo).
  11. **Same-step safety:** a respawn, a Knockout elimination and a Shockwave break in one step → no exception, no leftover body, `__game.bodies()` counts as expected.
  12. Perception equals a brute-force reference on 3 fixtures; each car is refreshed every 4 to 6 steps; the attack token is held by at most one AI car.
  13. Replay buffer returns the last 6 s at 30 Hz for every car, with impact events.
  14. Perf: per-step cost ≤ v0.1.2 + 0.06 ms (t3, 8-car field); at G3 WP15 asserts the full budget (GDD 25).

### WP3: AI, rival fields, named drivers, per-layout AI data
- **Model:** Opus 5.5 xhigh. **Size:** L.
- **Owns:** `src/sim/ai.ts`, `src/meta/opponents.ts`, `src/data/medalGhosts.ts`, `src/data/driftGhosts.ts`, `scripts/record-ghosts.ts`; `src/config/ai.ts`; `src/types/ai.ts`; tests `ai.test.ts`, `aiPace.test.ts` (re-baseline), new `carBalance.test.ts`, `rivals.test.ts`, `aiSweep.test.ts`, `aiPerf.test.ts`, `medalGhosts.test.ts`.
- **Depends on:** WP0a; WP1 and WP2 APIs (day 1); WP4 merged for the per-layout data and the final sweep (runs on t1 to t3 until then).
- **Deliverables:** per-car planning (cornering limit, ceiling, brake, real width in pass clearance and follow logic); **two rates** (control 120 Hz, decisions 20 to 30 Hz staggered, all inputs from `AiPerception`); archetypes `pro`, `basher`, `drifter`, `trickster`, `rookie`, `boss` and the field mix (12.2); the 20 named drivers with signature car, paint, trait (12.2); AI drift via the shared state machine; AI item use (8.3); sideswipe attacks with the attack token (12.3); fair rubber band on the fixed `visibleRadius` (12.4); league tiers, fail assist (3 steps, 5 on bosses), bosses, FTUE field; `makeField` with Mixed / Same / One model / Random and **upgrade-level normalisation** (GDD 11), including the Quick Race Normal mirror tune and the clamp rule; **per-layout `trackSpeed` and Time Attack medal times** for all 10 layouts (owned here after WP4 merges); recorded medal ghost laps and drift ghost runs.
- **Acceptance (Vitest):**
  1. `carBalance`: each model, stock, skill 1, t1, 3 laps: tier 1 lap times within 3% of each other; Spearman(PR, pace) ≥ 0.7; every car is best in at least one of: top speed, 0 to 100, 30 m corner speed, damage taken in a 60 km/h wall hit, grass speed, drift charge.
  2. Normalisation: an AI car is exactly `statsFor(model, levels)` × k with k ∈ [0.97, 1.05]; PR within ±1% of target for every model that can reach it, else `clamped` at max × 1.05 with skill compensation +0.02 per 1% of gap (≤ +0.06); Mixed never picks a model clamped by > 3%; normalised t1 laps at skill 1 within ±2.5% across unclamped models.
  3. `makeField`: Same → 7 × player model; Quick Race Normal + Same → identical levels and PR to the player's; One model → 7 × chosen; Mixed → drivers' signature cars, ≥ 5 distinct models, ≤ 2 per model, ≥ 1 heavy, ≥ 1 light; Random reproducible per seed; Boss / Heavy / One-Make / Daily / Weekly fields ignore the choice; FTUE skills 0.45 to 0.65.
  4. Rubber band: assist = 0 for an AI car within 45 m of the player, identical in runs that simulate portrait and landscape viewports (the camera never reaches the sim); off-screen chase power ≤ ×1.10; no ease on the last lap.
  5. Drifter archetype on t3, 3 laps: ≥ 6 `driftStart`; Pro on t1: ≤ 3.
  6. AI holding Nitro uses it within 8 s; no Shockwave on the player in the first 8 s or last 5 s; no attacks in the first 5 s; never two AI cars attacking the player at once; ghosted cars never targeted.
  7. `aiPace` re-baselined: top AI (normalised PR 100) laps t1 26.0 to 27.5 s, t2 29.5 to 31.5 s, t3 32 to 34.5 s; t4, t5 and all reverses recorded in `trackAi` and asserted here.
  8. Sweep: 10 layouts × 5 seeds × Mixed 8-car field: every car finishes 3 laps, average respawns ≤ 1 per race, no car without progress for > 6 s.
  9. Perf: per-step cost ≤ v0.1.2 + 0.03 ms; the decision layer runs for at most a quarter of the cars per step.
  10. Medal ghosts exist for all 10 layouts and their playback time at each medal factor is within ±1% of the medal time; drift ghosts exist for every Drift Trial layout.

### WP4: Tracks, themes and the destruction system
- **Model:** Opus 5.5 high (layout geometry and tuning), with a Haiku 5.5 xhigh swarm for screenshot review. **Size:** L.
- **Owns:** `src/track/tracks.ts`, `src/track/spline.ts`, `src/editor/editor.ts`, `editor.html`, `src/sim/destruction.ts`, `src/render/palette.ts`, `decor.ts`, `textures.ts`, `structures.ts`, `trackBuilder.ts`, `destructibles.ts`; `src/config/tracks.ts`; `src/types/track.ts`; tests `spline.test.ts`, `destruction.test.ts`, new `tracks.test.ts`, `reverse.test.ts`, `hpCoverage.test.ts`, `themeCurbs.test.ts`, `spreeRefill.test.ts`, `awakeCap.test.ts`.
- **Depends on:** WP0a. Pad/row format from the in-flight module.
- **Deliverables:** `reverseTrack()`; 10 layouts (t1 to t5, forward and reverse); Harbor Run and Scrapyard control points, props, decor, palettes, ground textures, wall visuals `containers` and `hulks` (1.6 m); theme kerbs (sensors); **every new object as a destructible** (container stacks, hulk stacks, crane feet HP 2,500 / threshold 14,000, crusher base, tyre stacks; item boxes as sensor destructibles with an API for WP2; pads bound to their road chunk, `padActive`); `respawnPiece(id)` for Smash Spree refills and box respawns (through the post-step queue); awake dynamic prop cap 24; pads (2 to 4) and item rows (2 to 3) per layout; FTUE prop cluster on t1; drift-lesson corner s on t2; editor supports the new themes; layout thumbnails work in `getTrackViews`. (Per-layout AI `trackSpeed` and medal times moved to WP3.)
- **Acceptance:**
  1. Vitest: all 10 geometries closed; lengths t1 to t3 unchanged, t4 1,000 to 1,050 m, t5 880 to 950 m, all ≤ 1,100 m; widths per GDD 14; the 40 m before every start line have \|curvature\| < 0.004; reverse(reverse(t)) points == t; centre-line points with \|Δs\| > 60 m are ≥ width + 2 × wallOffset + 2 m apart; props ≤ 380 per layout; pads 2 to 4 and rows 2 to 3, none where curvature rises above 0.02 within 25 m after them.
  2. **HP coverage:** on every layout, every non-car body has a destructible entry (HP and threshold), except the invisible world fence.
  3. Theme curbs on t4 and t5 are sensors (contact impulse 0) with slow and shake; their HP loss is visual only.
  4. `respawnPiece`: a broken prop and a broken wall segment come back with full HP after the configured delay, created through the post-step queue; a torn road chunk under a pad makes `padActive` false.
  5. Awake cap: a scripted Smash Spree bot breaking ≥ 120 props in 90 s on t5 keeps awake dynamic props ≤ 24 and the step within +0.05 ms of the t3 baseline.
  6. The 8-car field (player slot AI-driven) completes 3 laps on every new layout with ≤ 1 respawn per race.
  7. Playwright (phone 390×844 low, desktop 1280×720 medium): start and mid-lap screenshots of all 10 layouts; `drawsByGroup.track` ≤ 50 on t4 and t5 (low).
  8. Haiku swarm screenshot review: theme readable, road clearly distinct from off-road, no floating decor, no decor on the road (checklist per screenshot).

### WP5: Car models and renderer
- **Model:** Opus 5.5 high (visual quality is a complaint area). **Size:** L.
- **Owns:** `src/render/car.ts`, `carModels.ts`, `renderer.ts`, `preview.ts`, `menuScene.ts`, `playerMarker.ts`, `materials.ts`, `geo.ts`, `util.ts`, `index.ts`; `src/config/renderCars.ts`; `src/types/render.ts`; tests `render.test.ts`, `renderFix.test.ts`, `renderFix2.test.ts`, new `carModels.test.ts`, `carDraws.test.ts`.
- **Depends on:** WP0a; sizes from `CONFIG.cars` (WP1 may retune; the build reads config).
- **Deliverables:** 10 procedural low-poly models per GDD 10.3 with the same 8 part slots, built in the **merged instanced design as the primary path** (GDD 25: one InstancedMesh per model present with body + 8 parts merged, per-vertex `partId`, per-instance detach mask and bend angles, per-model pivot table, lights by vertex emissive flag, `paintZone` mask); one wheel InstancedMesh shared by all models (per-instance radius, width, hub colour); one blob mesh; `partDebris(modelId, part)` for the fx debris; per-car paint incl. metallic, two-tone and chrome, rim colours (cosmetics without extra draws); boss gold livery; ghost uses its model (translucent); garage turntable `showCar(id, paint, rims, locked)` with a dark rim-lit silhouette for locked cars and a drive-in animation; hero car per selected model; drift counter-steer on front wheels; `worldToScreen()`; heals and respawns clear `partOff`; car geometry built once and cached across races; draw-group counters.
- **Acceptance:**
  1. Vitest: each model builds; all 8 part slots non-empty; bounding box L × W within ±10% of `CONFIG.cars`; ≤ 1,800 triangles per model including parts.
  2. Playwright: a race with 8 distinct models → `drawsByGroup.cars` ≤ models present + 2 on low and ≤ 2 × models + 3 with shadows (medium).
  3. Silhouettes: each model rendered alone top-down at 50 px length; masks quantised into paint, glass and dark trim; every pair differs in at least 2 of the 3 masks by the configured pixel threshold (per-pair feature check, so Scrapper vs Gravel passes on the light pod and the wing), plus a Haiku "visually distinct" second opinion per pair.
  4. A paid repair, a Repair Kit and a respawn restore every part in the renderer (`partOff` cleared, mask reset).
  5. Garage turntable screenshots of all 10 cars at 390×844, 844×390 and 600×600; Haiku swarm review: "reads as the GDD description" (one reviewer per car).
  6. Second race load builds no car geometry (`geometryBuilds` unchanged).
  7. (Joint with WP6, checked by WP13) for each model, a 70 km/h head-on wall hit → ≥ 1 `partOff`, `partsActive` rises and the flying piece uses that model's `partDebris`.

### WP6: Camera, input and feel FX
- **Model:** Opus 5.5 high. **Size:** M to L.
- **Owns:** `src/render/camera.ts`, `src/input/input.ts`, `src/fx/*` (incl. `slowmo.ts`, `replayView.ts`, `fxManager.ts`, `debris.ts`), `src/platform/haptics.ts`, the in-flight item/pad visuals; `src/config/view.ts`; `src/types/view.ts`; tests `inputGeometry.test.ts`, new `camera.test.ts`, `gestures.test.ts`, `slowmo.test.ts`, `fxPools.test.ts`, `debrisPool.test.ts`.
- **Depends on:** WP0a.
- **Deliverables:** **Fixed camera as default, unchanged**; Follow as an option (GDD 5.3) with the shadow frustum fitted to the rotated view and snapped to the texel grid; car ≥ 32 CSS px in both modes and orientations; gesture grammar (GDD 5.1): slot tap with `gasHoldOver` 0.4 s (default), strict flick with a setting, opt-in brake tap → `driftPulse`, DRIFT 2nd button, left-handed mirror, sensitivity, steering arc; **raw steer only** (no assist logic in input); edge inputs latched once per frame; PC keys (5.2) with `preventDefault` on every game key; FX: tier-coloured drift sparks, boost flame and speed lines, slipstream streaks, slam ring, wreck burst, shield bubble, Shockwave ring, Knockout explosion, each **one pooled InstancedMesh or Points, always present, warmed** (WP15 hook); the **debris pools** (break 36, life 1.5 s; parts 24, life 2.0 s; each recycles its own oldest) with part pieces from `partDebris()`; slow-motion controller (21); crash replay view (plays WP2's buffer behind Results); haptics.
- **Acceptance:**
  1. Vitest gestures: a slot tap uses the item and gas stays on through a 0.3 s thumb hop; flick up 0.45 sizes in 0.2 s → `useItem` once; a slow upward drift over 1 s → none; **false positives:** a thumb wobbling ±0.3 sizes vertically at full lock for 10 s → no item, no drift pulse; a fast horizontal swipe with 0.2 sizes of vertical motion → nothing; flick setting off → never fires; brake tap with the setting off → brake only; on → `driftPulse`; left-handed geometry mirrors x; sensitivity 140% reaches full lock at 22% / 1.4 of width.
  2. Vitest camera: Fixed azimuth = 0 and the same look-ahead as v0.1.2; Follow converges to the track tangent within 1.5 s on a straight, rotation rate never > 1.6 rad/s (1.0 with reduce motion); Follow road ahead ≥ 40 m at rest in 390×844 and 844×390; car ≥ 32 CSS px in both modes and orientations.
  3. Playwright (phone touch and desktop keys, both camera modes): pressing right turns the car clockwise on screen; in Fixed on a section where the car drives down the screen, right still turns it clockwise (the existing check, both directions); in Follow the car's on-screen heading stays within ±20° of straight up after 1.5 s on a straight.
  4. Playwright touch drift: full lock held 0.3 s at 60 km/h before the t2 hairpin → `drift.phase === 'drift'` within 0.3 s and `sparksByTier[0]` rises; release → `driftEnd` and a spark burst.
  5. Playwright: with an item in the slot, a slot tap or a flick → `itemUse` within 100 ms; on desktop E does the same.
  6. Debris: 10 breaks in one frame plus a Shockwave on t5 → `debris.breaks` ≤ 36, `debris.parts` ≤ 24, total ≤ 60; flying parts are never evicted by breaks; lifetimes 1.5 s and 2.0 s.
  7. FX pools: every pool exists at race start; `renderer.info.programs` does not change after the first race frame during a scripted race that fires every item, drift tier and break type.
  8. Shadows in Follow (medium, landscape, top speed): the shadow camera bounds contain the view rectangle plus the zoom-pulse margin (no cut-off).
  9. Vitest slow motion: 8 s cooldown; none within 3 s of the player's finish; audio rate hook called with 0.7.
  10. Haptics: no call when `navigator.vibrate` is missing or the setting is off. Keys: Backspace, arrows, Space and Enter are `defaultPrevented` on game screens.

### WP7: Meta core (pure): cars, upgrades, economy, progression, cosmetics, mastery, records, save v2
- **Model:** Sonnet 5.5 xhigh. **Size:** M to L.
- **Owns:** `src/meta/cars.ts`, `economy.ts`, `progression.ts`, `save.ts`, `cosmetics.ts`, `mastery.ts`, `records.ts`, `ghostCodec.ts`; `src/config/meta.ts`; `src/types/save.ts`; tests `economy.test.ts`, `save.test.ts`, new `cars.test.ts`, `progression.test.ts`, `economyPacing.test.ts`, `cosmetics.test.ts`, `mastery.test.ts`, `records.test.ts`, `ghostCodec.test.ts`, `saveLimits.test.ts`.
- **Depends on:** WP0a only (pure code).
- **Deliverables:** roster meta, PR, bars, unlock rules, prices, the "drive it free in Quick Race" data (showroom PR), owner switches `garage.allCarsOwned` and `garage.upgradeModel` (`hybrid` default, `perCar`, `shared`; all three paths in `statsFor`) (GDD D1, D3, 10.4, 10.5); reward and repair formulas (16.1); XP, levels, titles, level cosmetics, feature gates (16.3); mastery (10.6); cosmetic shop data and ownership (10.6); records (17.4); save v2 with every field of GDD 23 (incl. `purchases` reserved, `h2h`, `records`, `weekly`, `lbSubmitted`), sanitizer, lossless v1 → v2 migration; ghost codec (10 Hz delta int16 base64, LRU, ≤ 64 KB); write order (ghosts first, core last), forward-version tolerance, settings write on release / 500 ms; `grantCoins(source)`; pacing simulations (reference player, casual player, 30 days after the career).
- **Acceptance (Vitest):**
  1. Reward examples exact: L1 Race, 3rd, 700 smash, 2,000 drift, 1 new star → 300 + 70 + 50 + 100 = 520; S = 3,000 → smash coins 225 × multiplier; Sprint ×0.7; Smash Spree gold = 1st prize; Boss win = 2 × 1st; Quick Race Normal ×0.7 × highest league multiplier; Weekly medals once per week; rewarded doubling excludes star and first-race bonus.
  2. Repair: never above 40% of the event's first prize; Scrapper ×0.65; minimum 20.
  3. Upgrades: Workshop 450 / 1,000 / 2,000 shared by every owned car; Signature 2,400 / 4,200 × tier multiplier per car; Signature L4 needs Workshop L3; a new car arrives at the current Workshop levels; the `perCar` and `shared` paths give the GDD totals; buying a car needs stars, coins and league as GDD 10.3.
  4. PR of all 10 cars stock and max within ±1 of GDD 10.2; bars within ±1 of GDD 10.3; **PR reachability:** every league's top recommended PR is reachable by ≥ 5 cars at max, every boss target by ≥ 3.
  5. Migration fixture (money 1234, upgrades 2/1/4, carColor 3, bestPlace t1 2 and t2 4, unlocked t1 and t2, ghost t1, tutorialDone true) → v2 with money 1234, `workshop` 2/1/3, `cars.scrapper.sig` 0/0/1, paint 3, ★1 on L1-1 only, ghost t1 re-encoded and kept, `ftueStep` 6, camera `fixed`. Invalid model ids, levels and event ids are dropped or clamped. A fully populated core JSON ≤ 12 KB. Round trip identical.
  6. Ghosts: codec round trip error ≤ 0.05 m and ≤ 0.01 rad; 10 layouts ≤ 64 KB; LRU eviction past the budget; a failed ghost write leaves the core intact; a corrupted ghost key never blocks loading the core; writes go ghosts → core; a save with `version: 3` and unknown keys loads and keeps the keys on write; a lower version is never written over a higher one; both keys stay under the Bridge storage limits (constant from WP11's reading of the Bridge docs).
  7. `economyPacing` (60 seeds): reference player — L2 by race 8 to 12, L3 by 18 to 26, L4 by 30 to 44, L5 by 48 to 70, career 95 to 160 races, Legend Remix a further 60 to 90, never more than 4 races without an affordable goal in the first 60; casual player (average place 4.5) — L2 by 14, L5 by 110, never more than 6 races in a row without a new star or unlock; 30 days after the Grand Final — always ≥ 1 open goal.
  8. Payments: with `payments` unsupported, `purchases` stays empty and no store data is produced.

### WP8: Meta live (pure): career, daily, weekly, remix, achievements, goals
- **Model:** Sonnet 5.5 xhigh. **Size:** M.
- **Owns:** `src/meta/career.ts`, `daily.ts`, `weekly.ts`, `remix.ts`, `achievements.ts`, `goals.ts`; `src/config/career.ts`; `src/types/career.ts`; tests new `career.test.ts`, `starTable.test.ts`, `daily.test.ts`, `weekly.test.ts`, `remix.test.ts`, `achievements.test.ts`, `goals.test.ts`.
- **Depends on:** WP0a only (uses `RaceSummary` and the save type).
- **Deliverables:** the 35-event table of GDD 15.3 with star evaluators, drift alternatives and the `driftStars` switch, soft gates, layout fallback, `nextEvent`; Daily Challenge generator with the streak shield (15.5); Weekly Smash Cup (15.6); Legend Remix (15.7); login calendar with no-reset streak and clock-rewind guard, date-seeded tasks with availability and "no bad or passive play" filters, all-done bonus (17.1, 17.2); 26 achievements (17.3); next-goal resolver and red dots (20.8).
- **Acceptance (Vitest):**
  1. 35 unique event ids; 105 stars; every layout id resolves (directly or via fallback); every goal kind has an evaluator; `starsFor` fixture per goal kind.
  2. Star table: for every event a search over 10,000 random summaries finds one that meets ★2 but not ★3 (★3 is never implied by ★2); events 1 to 6 contain t1, t2 and t3; no reverse before event 6; no layout id twice in any 3 consecutive events; with `driftStars = false` every drift goal uses its alternative and every Drift Trial becomes a Race.
  3. Gates: the boss opens with ★1 on 5 of the 6 league events; the next league needs the boss + 12 / 25 / 41 / 59 cumulative stars; `nextEvent` returns the first open event without ★1, else the boss, else the event with the fewest stars.
  4. Daily: same date → same 3 distinct tasks; tasks needing a locked feature never appear; `lowhp` and `km5` never appear; login day advances once per local date; missing 3 days keeps the day counter; a clock moved back 2 h is ignored; a second claim on the same date is refused; the challenge shield absorbs one missed day per 7.
  5. Weekly: the same ISO week → the same event; each medal pays once per week; platinum grants the week's paint once.
  6. Remix: opens only after the Grand Final; platinum = ★2 and ★3 in one run; AI PR +5%, skill +0.05, no fail assist.
  7. Achievements (26) unlock from summaries and pay once.
  8. Goals: priority order fixtures (claimable > affordable upgrade > near car unlock > boss events > league > tasks > weekly medal > mastery > best lap).

### WP9: UI race (HUD, pops, minimap, pause, results, FTUE prompts)
- **Model:** Sonnet 5.5 xhigh. **Size:** M to L.
- **Owns:** `src/ui/hud.ts`, `hudFx.ts`, `minimap.ts`, `pause.ts`, `results.ts`, `tips.ts`, `src/ui/css/hud.css`, `results.css`, `pause.css`, `tips.css`, `src/ui/preview/race.ts`, `src/i18n/hud.ts`, `ftue.ts`, `results.ts`; `src/config/uiRace.ts`; e2e `e2e/ui-race.mjs`; test `tips.test.ts`.
- **Depends on:** G1b; real data from WP2/WP7/WP8 at integration (develops against preview fixtures).
- **Deliverables:** HUD v2 per GDD 20.6 (portrait, landscape, square, PC) incl. gap times, revenge marker, 72 px item slot, pooled transform-only pops layer (max 8), world-space drift meter and smash pops via `worldToScreen`, style ring, minimap pre-rendered once with dots at ≤ 30 Hz, wrong way, missed checkpoint, wreck card, Knockout and Smash Spree timers, lap banners with delta; Pause v2 incl. mute and the camera toggle (20.9); Results sequence with records, delta, crash replay slot, SVG icons, finish order with trait and head-to-head, AD button only when rewarded is supported (20.7); tips engine, race 1 to race 5 lessons and mode cards (13, 19).
- **Acceptance (Playwright on `ui-preview.html` + the real game):**
  1. At 390×844, 844×390, 1280×720, 360×640 (RU), **600×600 and 320×568**: no element with text has `scrollWidth > clientWidth + 1`; nothing clipped by the viewport; no HUD element intersects the centre 50% × 60% box; text ≥ 12 px, position and speed numbers ≥ 28 px; touch targets ≥ 44 px (item slot 72).
  2. Results: a tap during the sequence shows the buttons within 300 ms; NEXT is the largest button; the AD button shows the exact coin number with the right RU plural form, and is absent when `isRewardedSupported` is false; NEXT becomes RETRY on a starless 4th or worse; NEW RECORD lines render from fixtures.
  3. 20 smash events within 1 s → ≤ 8 pop nodes alive.
  4. `updateHud` average ≤ 0.5 ms per frame over 600 frames under the 4× CPU throttle; no forced layout in the HUD update (performance profile).
  5. Tips: at most one on screen, ≥ 20 s apart, each ≤ 2 times; each mode card once (unit test of `tips.ts`).
  6. No ▶, ↻ or ★ text glyph in button labels (icons are SVG or carry U+FE0E).
  7. Pause and the wreck card follow the common sheet rules: visible close where it is a popup, closable by tap and mouse.

### WP10: UI meta (hub, career, garage, sheets, quick race, today, trophies, records, shop, settings, reveal)
- **Model:** Sonnet 5.5 xhigh. **Size:** L.
- **Owns:** `src/ui/hub.ts`, `career.ts`, `garage.ts`, `sheets.ts`, `quick.ts`, `today.ts`, `trophies.ts`, `records.ts`, `shop.ts`, `settings.ts`, `reveal.ts`, matching `src/ui/css/*.css`, `src/ui/preview/meta.ts`, `src/i18n/meta.ts`, `cars.ts`, `today.ts`, `trophies.ts`, `shop.ts`, `settings.ts`; `src/config/uiMeta.ts`; e2e `e2e/ui-meta.mjs`.
- **Depends on:** G1b; WP7/WP8 APIs (stubs until merged); WP5 `showCar` (stub until merged).
- **Deliverables:** screens per GDD 20.1 to 20.5 and 20.10 to 20.13 for portrait, landscape, square and PC; the premise line; a mute button on the hub; Enter = primary, ←/→ carousels, Backspace = back or close (`preventDefault`); red dots; "choose your 2nd car" reveal; the Quick Race reveal after race 1; the "drive it free in Quick Race" rule on every locked car; Car and Rivals sheets with PR colours and the rival preview row; Records with leaderboard rank and top 10 (hidden when unavailable); Shop; Weekly Cup and Remix cards; language selector with native names and a globe icon; a visible close on every sheet and popup; all strings of GDD 26.1 to 26.7 and 26.12 to 26.15 with plural forms.
- **Acceptance (Playwright):**
  1. Hub at 390×844: RACE ≥ 80 px tall, in the bottom 45% of the screen; one tap on RACE starts a race (state `racing` within 3 s); the mute button is visible.
  2. Garage: swiping left changes the car name; 10 page dots; a locked car shows its exact requirement and "Try in Quick Race" (which starts a Quick Race with that car at showroom tune); Select persists after a reload; the first hub after race 1 shows the Quick Race reveal.
  3. Rivals sheet: 2 taps from the hub to change the mode; the choice persists; the fairness line and the preview row (7 names and PRs) are visible.
  4. Settings: each new setting persists after a reload; a 2 s slider drag causes exactly 1 storage write; camera, drift assist, flick and brake tap take effect in the next race.
  5. At 390×844, 844×390, 600×600, 320×568 and 360×640 (RU): no page scroll, no overflow, nothing clipped.
  6. Every sheet and popup (login, reveal, car, rivals, mode card, confirm): visible close; closes by tap, mouse click and Backspace; Backspace never navigates the page.
  7. Leaderboard UI is absent when `leaderboards.type === 'not_available'` and SaaS is off; the `store` screen never renders with `payments` unsupported; R4 is absent when rewarded is unsupported.
  8. Language: a `uk` platform tag starts in English; the selector shows "English" and "Русский".

### WP11: Platform, ads, audio code, telemetry, leaderboards
- **Model:** Sonnet 5.5 xhigh. **Size:** M.
- **Owns:** `src/platform/bridge.ts`, `telemetry.ts`, `leaderboards.ts`, `public/playgama-bridge-config.json`, `src/audio/audio.ts`, `scripts/check-config.mjs`; `src/config/platform.ts`; `src/types/platform.ts`; tests `platformAds.test.ts`, `platformMessages.test.ts`, new `audioMap.test.ts`, `audioState.test.ts`, `noStorage.test.ts`, `noExternal.test.ts`, `bridgeConfig.test.ts`, `leaderboards.test.ts`, `rewardedHidden.test.ts`. (Audio files and `docs/AUDIO.md` belong to WP14.)
- **Depends on:** WP0a.
- **Deliverables:** read `get_game_checklist` and `get_bridge_sdk_docs` (Playgama MCP: storage limits, advertisement, leaderboards, platform audio and pause) and report each item and the exact config keys used; Bridge config with documented keys only (`minimumDelayBetweenInterstitial` 60), leaderboard ids for the 10 layouts, the `saas` block handled by `check-config --upload` (fails on placeholders; WP17 supplies the token or removes the block); `naturalPause(kind)` implementing D6 (marked kinds, `markRetry`, suppression after a rewarded view, never while racing or finishing) and the 0.5 s input lock after any ad; rewarded helper R1 to R5 with caps (counters batched into the next save) gated on `isRewardedSupported`; **one audio controller** (GDD 22.4) with `AUDIO_STATE_CHANGED`, `PAUSE_STATE_CHANGED` and `visibilitychange` (emits pause and resume for WP12), boot muted when the platform mutes; music streamed through `HTMLAudioElement`; essential cues first, the rest lazily after the first frame; engine voice manager (4 loops, pitch ranges, 3 voices) (22.2); every new cue mapped to events; leaderboard wrapper (submit valid Time Attack laps only when better than `lbSubmitted`, rank and top 10, nothing when unavailable); telemetry wrapper on Bridge analytics only (GDD 24).
- **Acceptance (Vitest):**
  1. `showInterstitial` is never called while racing or finishing; it is requested on NEXT, back to hub, Quit and Restart only; never on RETRY (unless `markRetry`), GARAGE, the FTUE results or a Results visit with a rewarded show; input is ignored for 0.5 s after an ad closes.
  2. Rewarded: reward only on the `rewarded` state; per-placement caps; **with `isRewardedSupported` false no rewarded control is created (R1 to R5 builders return nothing) and every flow completes**.
  3. Bridge config: only documented keys; `minimumDelayBetweenInterstitial` = 60; 10 leaderboard ids; `check-config --upload` fails on any `REPLACE_` placeholder.
  4. Audio state: boot with `isAudioEnabled` false → effective gain 0, still 0 after a reload; `AUDIO_STATE_CHANGED` toggles it; an ad opened mid-race → gain 0 and a pause event, restored afterwards; a hidden tab → pause; slow motion never raises gain; mute toggles persist.
  5. Every `SimEvent` type maps to a cue or an explicit "silent" entry (exhaustive switch); every cue referenced exists in WP14's manifest; every car has an engine class.
  6. Memory: decoded audio ≤ 12 MB with all cues loaded; music is never decoded into a buffer; the first frame does not wait for audio (boot timeline test).
  7. No `localStorage`, `sessionStorage` or `document.cookie` in `src/` (grep); **no `http(s)://` URL or analytics script tag in `src/`, `index.html` or `dist/`** except xmlns namespaces.
  8. Leaderboards: only valid Time Attack laps are submitted, once per session, only when better than `lbSubmitted`; nothing is shown or called when leaderboards are unavailable.
  9. Telemetry names match GDD 24 and are sent only through Bridge analytics.

### WP12: Integration and flow (W2 skeleton, W3 wiring)
- **Model:** Opus 5.5 xhigh. **Size:** L.
- **Owns:** `src/game.ts`, `src/main.ts`, `src/playerReset.ts`, `index.html`, `ui-preview.html`, and after G1b `src/ui/ui.ts`, `src/ui/screens.ts`, `src/ui/css/base.css`, `src/i18n/core.ts`, `src/ui/preview.ts`; `src/config/game.ts`, `src/config/index.ts`; tests `gameFlow.test.ts`, `playerReset.test.ts`, new `bootOrder.test.ts`; e2e `e2e/loop.mjs`.
- **W2 (12a, after G1b):** against the stubs: FTUE first-launch flow (empty save → race 1 without the menu), event start from hub, career, quick, daily, weekly and remix, results NEXT/RETRY/GARAGE with the D6 marked pauses, slow-motion time scale, per-quality `maxSubSteps`, edge-input latching per frame, R1 to R5 plumbing, save points, **`game_ready` timing**, the login popup after `game_ready`, pause and resume on platform pause, ads and hidden tab, the 0.5 s input lock.
- **W3 (12b):** wire real modules: `makeField` → Sim, `simParams(ev)` → SimOptions, `summary()` → economy, career, progression, mastery, records, leaderboard submit, daily, weekly, achievements → `ResultsData` v2 → results screen; R4 flows; the Quick Race reveal after race 1; mode cards; crash replay; respawn hooks; telemetry calls; fix seam bugs in owned files, file fix tickets for the rest.
- **Acceptance:**
  1. Vitest `gameFlow`: empty save → state `racing` with `ftue` options and no `start` call from the UI; results NEXT → exactly one interstitial request → next event racing; RETRY and GARAGE → no request; the FTUE results → no request; the double reward works once; the save is written only at race end, purchases, claims and settings changes (sliders on release); a level-up pays its coins; session 2 with a claimable day shows the login popup after `game_ready`.
  2. `bootOrder`: `game_ready` is sent exactly once, after the loading screen is removed, when the grid (first launch) or the hub (returning) is interactive.
  3. Platform pause, an open ad and a hidden tab pause the sim and audio; resume restores them.
  4. Playwright `e2e/loop.mjs` (phone touch and desktop keys) with the WP13a bot: boot → FTUE race → results → choose a car → guided upgrade → next event → Quick Race with a locked car and "Same as mine" rivals → pause → free repair (stub ad) → quit → hub; no console errors; tap counts of GDD 20.2.
  5. The game runs with `localStorage` access throwing, with `payments` unsupported and with rewarded unsupported.

### WP14: Audio content (sourcing, licences, encoding)
- **Model:** Sonnet 5.5 high. **Size:** M. **Runs from G0 to G3; first pack before G2.**
- **Owns:** `public/sfx/*`, `public/music/*`, `docs/AUDIO.md` (licence log), `scripts/audio-pack.sh` (ffmpeg: trim, normalise, loop points, mono 22 to 32 kHz sfx in ogg + mp3, music mp3 about 96 kbps), `scripts/make-sfx.sh` (dev placeholders only, not part of any build), `src/audio/manifest.ts` (file list for WP11), test `audioManifest.test.ts`.
- **Deliverables:** every cue of GDD 22.3, the 4 engine loops of 22.2 and 2 music loops (menu, race), sourced CC0-first (CC-BY only with a Credits entry; no brand sounds); 3 music candidates per slot for the owner to choose (coordinator step); licence log rows (file, source URL, licence, author, edits); loudness normalised; seamless loops.
- **Acceptance:** every file in `public/sfx` and `public/music` has a licence row; no row marked MUST-REPLACE or "generated" in the upload build; sfx ≤ 2.5 MB and music ≤ 2.5 MB; loop seams without clicks (ffmpeg check); sample rate and channels per spec; the owner has approved the music before G4.

### WP15: Performance (cross-module budgets and tooling)
- **Model:** Opus 5.5 high. **Size:** M. **Runs from G0 to G4.**
- **Owns:** `e2e/perf.mjs`, `e2e/soak.mjs`, `e2e/contextloss.mjs`, `tests/perf/*.test.ts` (Node step bench, `npm run bench`), `src/render/quality.ts`, `warmup.ts`, `contextLoss.ts`, `src/debug/frameLog.ts`, `src/config/quality.ts`.
- **Deliverables:** v0.1.2 baselines on day 1 (Node step per layout, throttled browser frame work, draws, triangles); throttled profiles (CDP CPU 4×, dpr 1.25, low, Fixed and Follow, 390×844 and 844×390, median of 5 runs); the quality-start policy (touch → low, 2 s grid benchmark, step up only with headroom, changes at the next race load, mid-race only dpr and particles, step back up between races); `maxSubSteps` 3 on low; warm-up of every FX pool and material before `gl.compile`; context loss and restore; a 30-race soak; the per-package delta check on every merge; investigation of the 12 to 34 ms step spikes seen in v0.1.1; the `?debug` frame log for the real-device check.
- **Acceptance:**
  1. `npm run bench` reports per-step average and frame p99 per layout; a merge that exceeds its package delta is flagged to the owner.
  2. At G3 and G4 the throttled browser profile meets GDD 25 (frame work p95 ≤ 12 ms, p99 ≤ 16.6 ms, sim ≤ 3 ms per frame, no long task > 50 ms after the first 5 s including the scripted burst of 10 breaks in 1 s + a Shockwave + every item, drift tier and break type), and the Node bench meets avg ≤ 0.45 ms, frame p99 ≤ 2.5 ms on t5 with 8 mixed models.
  3. A touch profile starts on low and steps up only with headroom; `renderer.info.programs` is constant during a race.
  4. Soak: 30 races in a row keep `renderer.info.memory` and the JS heap flat within 5%.
  5. Context loss and restore during a race: rendering resumes within 2 s, no exception, the race continues.
  6. Race load ≤ 2 s under the 4× throttle.
---

## 6. Dependencies and merge order

```
G0 ─┬─► WP14 audio content ─────────────────────────────────────────── first pack ─► G2 ... complete ─► G3
    ├─► WP15 baselines ─────────────── bench on every merge ─────────────────────────► G3/G4 budgets
    └─► WP0a ─┬─► WP7 ─┐
              ├─► WP8 ─┼──────────────────────────► WP9, WP10 (real data) ─┐
              ├─► WP1 (API day 1) ─► WP2 (API day 1) ─► WP3 ─┐               │
              ├─► WP4 ───────────────────────────────────────┼─► WP3 per-layout data + sweep
              ├─► WP5 (sizes from WP1 config)                │               ├─► WP12b ─► G3 ─► WP16 ─► WP13 gate G4 ─► WP17
              ├─► WP6 ─────► G2 play-test (with WP1, WP14 pack)               │
              ├─► WP11                                        │               │
              └─► WP0b ─► G1b ─► WP9, WP10, WP12a ─► G2b play-test ──────────┘
                                 WP13a harness + bot (from G1) ─────────────┘
```

Merge order onto `sc/v02` (each merge followed by the full test suite and WP15's bench): WP7 → WP8 → WP1 → WP4 → WP2 → WP6 → WP5 → WP15 modules → WP3 → WP11 → WP9 → WP10 → WP12b; WP14 merges audio packs whenever ready (they touch only its own files). A package that is ready early merges early if everything before it in the order is merged or does not touch its contract; otherwise it waits and rebases.

Soft dependencies are handled with the WP0a stubs and the day-1 API commits: UI packages render preview fixtures; WP2 builds against WP1's real signatures; WP3 tunes on t1 to t3 until WP4 lands, then records `trackSpeed`, medal times and ghosts for all 10 layouts and re-runs its sweep.

---

## 7. Model and effort allocation, swarm use

| Package | Model / effort | Why |
|---|---|---|
| WP0a Contract core | Opus 5.5 xhigh | every later package depends on it |
| WP0b UI shell + i18n | Sonnet 5.5 xhigh | mechanical split, plural engine, many files |
| WP1 Driving | Opus 5.5 xhigh | feel, physics, determinism, physics safety |
| WP2 Rules/combat/modes | Opus 5.5 xhigh | many interacting systems in the sim core |
| WP3 AI/rivals | Opus 5.5 xhigh | balance and behaviour, long headless runs |
| WP4 Tracks/destruction | Opus 5.5 high + Haiku 5.5 xhigh swarm | spatial design; screenshot review |
| WP5 Car models/renderer | Opus 5.5 high + Haiku swarm | visual quality, merged instancing; per-car review |
| WP6 Camera/input/FX | Opus 5.5 high | feel and gesture tuning |
| WP7 Meta core | Sonnet 5.5 xhigh | pure, table-driven |
| WP8 Meta live | Sonnet 5.5 xhigh | pure, table-driven |
| WP9 UI race | Sonnet 5.5 xhigh | DOM/CSS volume |
| WP10 UI meta | Sonnet 5.5 xhigh | DOM/CSS volume |
| WP11 Platform/audio code | Sonnet 5.5 xhigh | platform rules are a moderation risk |
| WP12 Integration | Opus 5.5 xhigh | seams across all modules |
| WP13 QA lead | Opus 5.5 high + Haiku 5.5 xhigh swarm (20 to 60 agents) | breadth |
| WP14 Audio content | Sonnet 5.5 high | search, licence checks, ffmpeg |
| WP15 Performance | Opus 5.5 high | cross-module profiling and policy |
| WP16 Balance | Opus 5.5 high + Haiku swarm | cross-config tuning with bots and play-test data |
| WP17 Release | Sonnet 5.5 high + coordinator | console steps, covers, checklist |
| Per-package review | Sonnet 5.5 high, `code-review` skill | second pair of eyes |

Haiku swarm jobs (each agent gets one narrow, checkable job and returns JSON):
- RU and EN proofreading: one agent per i18n dictionary file (consistency of "ты", terminology, plural forms for 1, 2, 5, 21, length ≤ the GDD limits, names never declined through a placeholder).
- Screenshot audits: one agent per screen × viewport (390×844, 844×390, 1280×720, 360×640, 600×600, 320×568) × language against the gate checklist; includes the glyph check on iOS and Android font renders (no emoji-rendered ▶ ↻ ★).
- Headless sweeps: one agent per (layout × car model): runs `aiSweep` / `carBalance` seeds, reports stuck cars, respawns, lap outliers.
- Star reachability: one agent per career event: runs the WP13 bot (reference and casual) at the event's target PR and reports whether each star (and drift alternative) is reachable and how hard.
- Smash Spree calibration: one agent per layout: the bot's maximum 90 s score with refills, for the 70% rule.
- Perk noticeability: one agent per car: measures the perk's effect over 2 laps against the Scrapper (feeds WP16).
- IP/brand check: one agent per list: car, driver, boss, track, league and paint names, mode names, item names, HUD terms and icon descriptions, against real car models, brands and known game titles and features; results go into GDD 28.
- Acceptance drafting: one agent per package turns that card's acceptance list into test skeletons for WP13a.

---

## 8. Play-test gates (people, not bots)

**G2: play-test 1 (after WP1 and WP6 merge, with WP14's first pack; before the career table is frozen).** Build: 3 cars (Scrapper, Gravel, Mammoth physics; WP5 models if merged, otherwise today's mesh scaled), t1 to t3, drift (assist, Space, DRIFT button), both cameras, slot tap and flick, real sounds. The coordinator deploys it to the play-test site; the owner and up to 5 testers she invites play 10 minutes on a mid Android phone and on a desktop with a checklist: drift feel, unintended drifts and items per race, Fixed vs Follow, steering direction, readability of damage and destruction, sound. The build's telemetry records drifts per lap, item uses within 0.5 s of a steering reversal (accidental-flick proxy), camera toggles. **Exit:** the owner's go on drift and controls; decisions on D5 (camera default), `driftStars`, flick default; tuning tickets to WP1 and WP6.

**G2b: play-test 2 (after WP12a with WP8, WP9, WP10 on fixtures or real data).** The first 5 minutes and the first 3 events: every FTUE lesson done without help, time from boot to driving < 10 s, start rate of race 2, readability of the hub and the event card. **Exit:** the career table and the FTUE are frozen for WP16; FTUE tickets to WP9 and WP12.

Both gates record the GDD 3.3 feel targets from telemetry; WP16 uses them.

---

## 9. WP13: QA and release gate

- **Model:** Opus 5.5 high (lead) + Haiku 5.5 xhigh swarm. **Size:** L, runs from W2 to W4.
- **Owns:** `e2e/player-checks.mjs`, `e2e/run.mjs`, `e2e/i18n-overflow.mjs`, `e2e/screens.mjs`, new `e2e/bot.mjs`, `e2e/iframe-keys.mjs`, `tests/qa/*.test.ts` (incl. `tests/qa/bot.ts`); results go to `e2e/out/` (JSON + PNG, not committed docs).
- **W2 (13a):** the **scripted driving bot** (an `AiDriver` steering the player car through `__game.input`; profiles "reference" and "casual" (average place 4.5); scripted actions: drift, items, slams, wall hits); the FTUE timeline check (every prompt inside its window ± 5 s); the harness against the debug hooks (3.5); skeleton checks for every card; the star-reachability and Smash Spree calibration swarms; baselines together with WP15.
- **W4:** run everything on the integrated build (`npm run build` + `vite preview`), file fix tickets to the owning package, re-run until green.

### Release gate G4 (every item must pass; any failure = no release)

Player view, phone profile (390×844, touch, dpr 2) and desktop profile (1280×720, keys); Fixed (default) and Follow where marked:
1. First launch with an empty save: no menu, the HOLD prompt is visible, holding GAS starts the countdown and the car drives (speed > 15 m/s within 4 s of GO); `game_ready` was sent once, after the grid became interactive.
2. Pressing right turns the car clockwise on screen and left counter-clockwise (keys and touch, Fixed and Follow, including a section where the car drives down the screen in Fixed).
3. Touch drift (assist) at the t2 hairpin: full lock at 60 km/h → drift within 0.3 s; blue sparks; a clean exit gives a speed gain ≥ 2 m/s within 0.5 s. The gesture false-positive script fires no item and no drift.
4. Boost pad at 25 m/s → speed +4 m/s or more within 0.3 s; a pad on a torn road chunk is gone.
5. Item: pickup → slot icon within 0.8 s; slot tap, flick (touch) or E (desktop) → `itemUse` within 100 ms; Shockwave pushes a rival within 9 m; props it breaks went through the hit pipeline.
6. Slipstream: 8 m behind an AI car on a straight for 1.5 s → SLIPSTREAM chip visible and speed above the solo equilibrium.
7. Parts fly off on a 70 km/h wall hit for every one of the 10 models, as that model's own pieces; the damage silhouette and health bar change; a paid repair and a respawn put every part back.
8. Slam: ramming an AI car into a wall at 60 km/h → SLAM banner and +300 in the race counter; slamming the same car again within 10 s gives nothing; after being slammed, the revenge marker shows.
9. Wreck: player health forced to 0.1, then a wall hit → WRECKED card, respawn within 2.5 s, 50% health, all parts on.
10. Frost Pass infield cut → MISSED CHECKPOINT and no lap credit; driving the wrong way 2 s → WRONG WAY.
11. Results → NEXT: one tap starts the next event (`racing` within 3 s on desktop; race load ≤ 2 s under the 4× throttle) with exactly one interstitial request; none on RETRY, GARAGE, the FTUE results or after a rewarded view; none ever while racing; input ignored for 0.5 s after an ad.
12. Rivals "Same as mine": all 7 AI cars render with the player's model (`__render.modelIds`), and in Quick Race Normal their levels equal the player's; "One model: Mammoth": all 7 are Mammoths; the preview row matches the grid.
13. Garage: 10 cars browsable, distinct silhouettes (WP5 test), locked cars show requirements, "Try in Quick Race" works with any locked car; R4 absent when rewarded is unsupported.
14. Each of the 7 modes plays to its end on its first career event without errors; Knockout eliminates with the respawn grace; Smash Spree refills and ends at 90 s; a Weekly Cup event and (with a granted save) a Remix event start and finish.
15. Save: a v1 save injected into the fake storage → v2 with money and upgrades kept; progress persists across reloads; storage writes happen only at the listed moments; a failing ghost write leaves the core intact; the game runs with `localStorage` access throwing and with `payments` unsupported.
16. Pause on tab hidden, on `PAUSE_STATE_CHANGED` and during ads (game and audio); boot with platform audio disabled stays silent; the mute button works on the hub and in Pause; P pauses on desktop; Esc does nothing; in the Playgama-style iframe test page Backspace never navigates and arrows, Space and Enter never scroll the page.
17. RU and EN: no missing keys; plural forms correct for 1, 2, 5 and 21 on screen; no overflow at 360×640, 320×568 and 600×600 on any screen, nothing clipped at 600×600; every popup and sheet has a visible close and closes by tap and mouse; no emoji-rendered glyphs in the iOS and Android renders; a `uk` platform starts in English; the Haiku screenshot audit has no "major" finding.
18. Performance (WP15 tooling, GDD 25): the throttled browser profile in Fixed and Follow, portrait and landscape: frame work p95 ≤ 12 ms and p99 ≤ 16.6 ms, sim ≤ 3 ms per frame, no long task > 50 ms after the first 5 s including the scripted burst; draws ≤ 110 on low with every group in budget and ≤ 160 on medium; debris ≤ 60 with parts ≤ 24 under 10 breaks + a Shockwave; Node bench avg ≤ 0.45 ms and frame p99 ≤ 2.5 ms on t5 with 8 mixed models; 30-race soak flat; context loss recovers; race load ≤ 2 s throttled.
19. Headless sweeps: 10 layouts × 10 models × 5 seeds: all races finish; ≤ 1 respawn per race on average; the tunnelling, HP-coverage, curb no-damage and same-step tests green; every career star reachable by the reference bot at target PR (report per event); casual-player pacing inside its limits.
20. Playgama: the checklist (`get_game_checklist`) re-read and checked item by item (numbered report; items that cannot be checked automatically are listed for the owner); `check-config --upload` passes (no placeholders); no-storage and no-external tests green; telemetry only through Bridge analytics; a run with rewarded unsupported shows no rewarded control.
21. Audio: every file in `public/sfx` and `public/music` has a licence row, none is generated by code, the owner approved the music, budgets met, every car class has its engine loop.
22. No console errors in any run.

**Real-device check (coordinator, after G4; pass threshold):** the play-test build with `?debug` on a mid Android phone (Snapdragon 680 / Mali-G57 class or the closest available, e.g. the owner's): a 60 s race on Scrapyard with 8 mixed models on low: median FPS ≥ 55 and p95 frame time ≤ 18 ms from the frame log; plus a desktop browser; then the owner's feedback loop.

---

## 10. WP16 balance and WP17 release

### WP16: Balance (after G3)
- **Model:** Opus 5.5 high + Haiku swarm. **Size:** M.
- **Owns (temporarily, values only):** the tuning values in `src/config/driving.ts` (cars), `rules.ts` (score, style), `ai.ts`, `meta.ts` and `career.ts` thresholds; structural changes still go to the owners, who freeze tuning edits during WP16.
- **Inputs:** the WP13 bot (reference and casual), the star-reachability, Smash Spree calibration and perk swarms, the pacing simulations, the G2 and G2b telemetry.
- **Outputs:** tuned config commits; Drift Trial thresholds from play-test data; Smash Spree thresholds by the 70% rule; reworked perks that were not noticeable within 2 laps; a short balance note in the PR.
- **Acceptance:** every WP3, WP7 and WP8 balance and pacing test green with the final numbers; PR reachability; every star reachable; feel targets of GDD 3.3 inside their ranges in the play-test telemetry, or each exception listed for the owner.

### WP17: Release (after G4 and the owner's OK)
- **Model:** Sonnet 5.5 high with the coordinator. **Size:** S to M.
- **Owns:** `release/` (covers, screenshots, store texts EN and RU); the coordinator applies the SaaS token to `public/playgama-bridge-config.json`.
- **Steps (Playgama MCP):** `get_launch_steps` first and after every step; the application form (title, descriptions EN and RU, languages exactly `en` and `ru`, category); `create_leaderboard` for the 10 ids of GDD 17.5 and the SaaS public token into the config (or the `saas` block removed if boards cannot be made, with the leaderboard UI then hidden); covers with the `store-covers` skill and `start_cover_upload` / `confirm_cover_upload`; `get_game_checklist` re-read and answered item by item; `npm run build`, archive, `start_archive_upload` / `confirm_archive_upload`, `get_archive_status`, the QA tool link run; telemetry verified against `get_game_telemetry_guide`; through the owner, ask Playgama whether a 180 s interstitial delay is acceptable (D6).
- **Human steps:** the owner approves the release; a person submits the form to moderation in the Playgama console (no tool exists for that).
- **Acceptance:** every checklist item passes or is listed for the owner; the 10 boards exist with matching ids; no placeholder in the config; archive status OK; the QA tool run is clean.

---

## 11. Risks and fallbacks

| Risk | Fallback |
|---|---|
| WP0a slips (everything waits) | strict scope: types, config shape, stubs, plumbing only; the UI and i18n split moved to WP0b, which does not block the sim packages |
| CC0 audio of good quality not found in time (release blocker) | WP14 starts at G0; the owner approves a paid stock licence if needed; G2 may run with a partial pack, G4 cannot |
| Playgama expects the 60 s default and every natural pause | D6 keeps the documented default; `CONFIG.ads.markRetry = true` marks RETRY too; WP17 asks about 180 |
| SaaS leaderboard token not available | `saas` block removed for the upload build; leaderboard UI hidden (17.5); records stay local |
| Merged car mesh is harder than planned | cap distinct models per race at 4 (config) until it lands; part pieces keep working through `partDebris` |
| Drift tuning feels wrong on real phones (accidental drifts) | G2 play-test before the career is built on it; `assistNeedsCorner`, thresholds in config, Drift assist off switch; `driftStars = false` swaps drift goals and Drift Trials |
| Accidental item flicks | strict flick thresholds, slot tap as the default, Settings flick off; G2 decides the default |
| Follow camera discomfort | it is opt-in; Fixed stays the default unless the owner chooses otherwise |
| t4/t5 not ready | `CONFIG.career.layoutFallback` maps them to reversed t1 to t3 |
| AI pace baselines break after drift and boosts | WP3 owns the re-baseline and the per-layout data; career PR targets are config, tuned by WP16 |
| Sim budget missed on phones | WP15 flags it per merge; cuts in order: AI decision rate to 20 Hz, awake prop cap 16, Smash Spree refill radius up, shadows off on medium for touch |
| Respawn rule rejected by the owner | `CONFIG.combat.respawn = false` restores limping (keep the code path) |
| Hybrid upgrades rejected by the owner | `CONFIG.garage.upgradeModel = 'perCar'` or `'shared'` (all three paths kept in `statsFor`) |
| "Any car" read as not enough | `CONFIG.garage.allCarsOwned = true` |
| Save migration bug wipes progress | migration fixtures, sanitizer tests, two-key split with ghosts written first, write only after a successful load, forward-tolerant versions |
| Bridge storage limits smaller than planned | budgets read from the Bridge docs by WP11; ghosts evicted LRU first; the core never depends on the ghost key |
| Contract amendments pile up | per-owner type and config files make most amendments local; only `src/types.ts` top level and `CONFIG` assembly need the coordinator |
| No mid Android available for the real-device check | the owner's phone through the play-test link and the `?debug` frame log; throttled profiles remain the hard gate |
---

## 12. Review log

Review round 1 (four reviews of GDD v2 and PLAN rev 1). Every issue is listed with its resolution and where it now lives. OR = owner requirements, PG = Playgama rules, PT = performance and tech, PF = player fun; C = critical, M = major, m = minor.

| # | Sev | Issue | Resolution (where) |
|---|---|---|---|
| OR-1 | M | New objects outside the one destruction system (indestructible crane feet, special barrels, gates, pads, boxes) | GDD 9.0 rule: every body is a destructible with HP and goes through one hit and one break pipeline; crane feet HP 2,500 / threshold 14,000; boxes are sensor destructibles; pads belong to their road chunk; barrels and gates P1 inside the system (8.1, 8.4, 9.5, 14). PLAN rule 9; WP4 HP-coverage test (acc. 2) |
| OR-2 | M | Curbs and the "no damage when rubbing" rule missing; threshold not normalised with mass | GDD 9.6 preserved physics rules (curbs as sensors, threshold applied to the mass-normalised impulse, theme kerbs); damage chain steps 1 to 3 (9.2). WP1 acc. 9 (all 10 cars: 20 m/s curb and 3 m/s wall touch → 0 HP), WP4 acc. 3 |
| OR-3 | M | Debris cap 60 not stated or tested; part life 2.4 s against 1 to 2 s; pool-full policy missing | D11 and GDD 21, 25: 60 in total = 36 break + 24 part pool, 2 to 3 per break, 1.5 s / 2.0 s, oldest recycled; WP6 acc. 6; gate 18 (10 breaks + Shockwave on t5) |
| OR-4 | M | Deferred body changes and tunnelling at boosted speeds not carried into new work | GDD 9.6 items 4 and 5: one post-step queue for every body, fixture and sensor change; `absMaxSpeed` 80 m/s; thickness ≥ 1.15 × per-step travel. WP1 acc. 10, 11; WP2 acc. 11 (respawn + elimination + Shockwave in one step); WP4 acc. 4 |
| OR-5 | M | No owner for real audio; placeholders only; one engine sound for 10 cars | New WP14 audio content (from G0, first pack before G2, licence log in `docs/AUDIO.md`); gate 21 (no generated file, owner approved music); GDD 22.1, 22.2 engine table (4 loops, pitch ranges per class) |
| OR-6 | M | Quick Race 3/5/7 rivals breaks the decided 8-car race; "8 AI" wording | D10: lap races always 8 cars (player + 7 AI); extra modes listed as additions to confirm; Quick Race rival count removed (15.4, 26.7). PLAN wording "8-car field (player slot AI-driven)" everywhere |
| OR-7 | M | PR clamp 0.8 to 1.35 cannot reach late targets; "Same as mine" is not the same car | GDD 11: AI cars use real upgrade levels via `statsFor` + residual k 0.97 to 1.05, clamp rule with skill compensation, Mixed avoids clamped models; Same as mine = exact tune in Quick Race Normal; sheet shows rival PRs. WP3 acc. 2, 3 |
| OR-8 | M | No absolute 60 FPS criterion, no throttled profile, no 10-break scenario, no shadow note for Follow | GDD 25 budgets (throttled profile, scripted burst, real-device pass threshold); WP15; gate 18 and the real-device check; WP6 acc. 8 shadow frustum |
| OR-9 | M | Leaderboards decided but P1 in GDD, unspecified | D12 and GDD 17.5 (P0, 10 Time Attack boards, valid-lap rules, submit rule, hidden when unavailable, created in the console); WP11 acc. 8; WP17 creates boards and the token |
| OR-10 | M | Default camera swapped although the owner likes the current one; steering cause misdiagnosed | D5: Fixed stays default, steering fix recorded (mirrored scene, `89e88ff`), Follow opt-in; G2 compares; GDD 2 A4, 5.3, 20.10; WP6 acc. 2 |
| OR-11 | M | No Russian plural forms | GDD 26.0 `tp()` with RU one/few/many; every (n) string rewritten in 26.x; WP0b acc. (tests for 0, 1, 2, 5, 11, 21, 22, 25, 111, 1,000); Haiku proofreading checks plurals |
| OR-12 | m | One-thumb gestures can misfire (brake tap → drift, wobble → item) | GDD 5.1: brake tap opt-in (default off), slot tap default with gas hold-over, strict flick with a setting; WP6 acc. 1 false-positive tests |
| OR-13 | m | FTUE drift lesson at a hairpin t1 does not have; 7 lessons in 70 s | GDD 19: race 1 = gas, steer, smash, one item; drift and pads in race 2 at the real t2 12 m hairpin (s in track config); bot-checked timeline (WP13a) |
| OR-14 | m | "Choose any car" may read as violated; Quick Race gating unclear | D1 states the risk and the `allCarsOwned` switch; Quick Race open from the first hub visit after race 1 with a reveal (15.4, 20.3); WP10 acc. 2 |
| OR-15 | m | Damage not kept between races not stated; repairs leave parts off | GDD 9.3: every race starts full; every heal (paid, ad, kit, respawn) puts parts back; WP5 acc. 4, WP2 acc. 5, gate 7 |
| OR-16 | m | IAP-ready only as a P2 paragraph | GDD 18.3: `purchases` in the save, hidden `store` screen id, `grantCoins` hook, tested with payments unsupported (WP7 acc. 8, WP10 acc. 7, WP12 acc. 5) |
| OR-17 | m | IP check covers names only; "Takedown" is a known title feature | D13 and GDD 28: SLAM in the UI ("Wipeout" is itself a known game title, "Knock-out" clashes with the Knockout mode), Rampage → Smash Spree, item box without a question-mark cube; IP swarm extended to modes, items, HUD terms, icons |
| OR-18 | m | Ghost key has no budget; ghost modes unclear | GDD 23: ≤ 64 KB, 10 Hz delta int16, LRU, ghosts written first; shown in Race and Time Attack with the recording car's model; WP7 acc. 6 |
| OR-19 | m | Backspace may navigate; arrows may scroll | GDD 5.2 `preventDefault` on game keys; WP6 acc. 10, WP10 acc. 6, gate 16 (iframe test page) |
| OR-20 | m | Endgame loops are P1 | Weekly Smash Cup, Legend Remix, Records, leaderboards, cosmetic shop, mastery moved to P0 (GDD 10.6, 15.6, 15.7, 17.4, 17.5, 27); WP7 acc. 7 post-career check |
| PG-1 | C | No package sources real audio; placeholders block upload | WP14 (see OR-5); G4 item 21 is hard for the Playgama build; placeholders only in early play-test builds |
| PG-2 | M | 180 s delays rely on an undocumented key | D6 and GDD 18.2: documented `minimumDelayBetweenInterstitial` 60 kept, `initialInterstitialDelay` not relied on, FTUE results never request; WP11 reports keys (acc. 3); WP17 asks about 180 |
| PG-3 | M | `saas` placeholder token in the config; P0/P1 mismatch | Leaderboards P0 in both documents; `check-config --upload` fails on placeholders (WP11 acc. 3); WP17 sets the token or removes the block; UI hidden when unavailable |
| PG-4 | M | Rewarded buttons not hidden when unsupported | GDD 18.1 rule (no control rendered, every flow works); WP11 acc. 2, WP9 acc. 2, WP10 acc. 7, WP12 acc. 5, gate 20 |
| PG-5 | M | Platform audio and pause handling only a late gate check | GDD 22.4 one volume controller and pause rules; WP11 deliverable + acc. 4; WP12 acc. 3; visible mute on hub and pause (20.3, 20.9); gate 16 |
| PG-6 | m | Interstitial right after a rewarded view; double-tap risk | GDD 18.1, 18.2: no request in a Results visit with a rewarded view; 0.5 s input lock after any ad; WP11 acc. 1 |
| PG-7 | m | Slider writes on every drag; ghost size unbounded | GDD 23: sliders save on release / 500 ms, ad caps batched; ghosts ≤ 64 KB (the stricter of the two reviews); WP10 acc. 4, WP7 acc. 6 |
| PG-8 | m | `game_ready` timing for the new boot flow | GDD 19.1 and 17.1: sent once when the grid or hub is interactive, login popup after it; WP12 acc. 2, gate 1 |
| PG-9 | m | Pop-ups without a visible close | GDD 20.1 rule; shared sheet component in WP0b; WP9 acc. 7, WP10 acc. 6, gate 17 |
| PG-10 | m | No 600×600 and 320×568 checks | Added to WP9 acc. 1, WP10 acc. 5, WP5 acc. 5 and gate 17; GDD 20.3, 20.6 square layouts |
| PG-11 | m | ▶ ↻ as text may render as emoji | GDD 20.7 and 26: icons are SVG or carry U+FE0E; WP9 acc. 6; Haiku glyph audit on iOS and Android |
| PG-12 | m | RU_TAGS maps too many languages to Russian; selector label "Auto" English-only | GDD 26.0: only ru, be, kk → RU; selector with native names + globe, "Auto / Авто" (20.10, 26.12); WP0b and WP10 acc. 8; WP17 declares en + ru |
| PG-13 | m | No premise for rule 3.1.2 | GDD 1 premise + `hub.premise` (26.1) on the first hub and league cards (20.3) |
| PG-14 | m | No check against external URLs or analytics | GDD 24; WP11 `noExternal` test (acc. 7); gate 20 |
| PT-1 | C | Per-part car meshes blow the draw-call budget | Merged instanced design is primary (GDD 25, WP5 deliverables), shared wheel mesh, car calls ≤ models + 2 (low) and ≤ 2 × models + 3 (shadows); WP5 acc. 2 |
| PT-2 | C | Sim budget 1.2 ms/step in Node is 3 to 6× too loose; `maxSubSteps` 8 | GDD 25: avg ≤ 0.45 ms, frame p99 ≤ 2.5 ms on t5; per-package deltas (driving +0.06, rules +0.06, AI +0.03, track +0.05, chosen so the sum fits the total; the review's +0.15/+0.1/+0.1 would exceed it); `maxSubSteps` 3 on low; AI decisions at 20 to 30 Hz. WP1 acc. 12, WP2 acc. 14, WP3 acc. 9, WP15 |
| PT-3 | C | No owner for cross-module performance (quality start, shader warm-up, soak, context loss) | New WP15 with `quality.ts`, `warmup.ts`, `contextLoss.ts`, soak and context-loss tests, start on low for touch, no mid-race shader recompiles |
| PT-4 | M | FPS on SwiftShader is noise; stepMs unmeasurable in the browser; camera mode not named | GDD 25 and gate 18 use proxies (frame work, accumulated sim ms, draws, long tasks) under 4× throttle, median of 5, Fixed and Follow, portrait and landscape; FPS informational; real-device pass threshold |
| PT-5 | M | Draw budget shared without allocation | Per-group budget table (GDD 25) with `__render.drawsByGroup`; WP4 acc. 7, WP5 acc. 2; gate 18 sums them |
| PT-6 | M | One `config.ts` with 13 owners; types amendments batched twice a day | Per-owner `src/config/*.ts` and `src/types/*.ts` (PLAN 3.1, 3.2); amendments local to the owner (rule 2) |
| PT-7 | M | WP0 too big and blocks everything | Split into WP0a (contract core, gates sim/meta/platform) and WP0b (UI shell, CSS, i18n plurals, fixtures; gates only UI and WP12a) |
| PT-8 | M | Part debris code owned by WP6 while WP5 must prove parts fly off | `partDebris(modelId, part)` in WP5's `carModels.ts`, consumed by WP6; joint check in WP13 (WP5 acc. 7, gate 7); a separate 24-piece part pool |
| PT-9 | M | Drift assist in input is non-deterministic; edge inputs per substep | Assist in the sim from `CarSetup.driftAssist` (GDD 5.1, 6.1; WP1 acc. 5); input sends raw steer and a `driftPulse`; edges consumed once per frame (contract 3.1, WP6) |
| PT-10 | M | Damage multipliers split across owners, risk of double application | `composeDamage(ctx)` in WP2 with one documented order (GDD 9.2); WP1 applies only mass, threshold, armor; WP2 acc. 4 table-driven test |
| PT-11 | M | AI `think` cannot see items, pads, walls, ghosting, the attack lock | `AiPerception` in the contract, filled by WP2 at 20 to 30 Hz (GDD 12.1; WP2 acc. 12) |
| PT-12 | M | Rubber band uses the camera view radius | Fixed `rivals.visibleRadius` 45 m (GDD 12.4); WP3 acc. 4 checks portrait and landscape give the same result |
| PT-13 | M | Hidden serial critical path; circular `trackSpeed` ownership | Day-1 API freeze for WP1 and WP2 (rule 3); `trackSpeed` and medal times moved to WP3 after WP4 merges; critical path and length in section 1 |
| PT-14 | M | Fully decoded audio and music cost 20 to 40 MB and delay the first frame | GDD 22.4: music streamed, mono 22 to 32 kHz sfx, lazy cues; WP11 acc. 6 (≤ 12 MB, first frame never waits) |
| PT-15 | M | Missing packages: audio sourcing, balance, release, the bot | WP14, WP16, WP17 added; the bot belongs to WP13a (`e2e/bot.mjs`, `tests/qa/bot.ts`) |
| PT-16 | M | Ghosts as flat JSON ints, one big key, no write order or version policy | GDD 23: 10 Hz delta int16 base64 ≤ 64 KB with LRU, ghosts written before core, forward-tolerant versions, debounced writes, limits from the Bridge docs; WP7 acc. 6 |
| PT-17 | M | `t()` has no plurals; numbers and Cyrillic glyphs unchecked | `tp()`, `fmtNum()`, Cyrillic font test (GDD 26.0; WP0b acc.) |
| PT-18 | M | Untestable criteria (drift "best line", binary IoU, 31 vs 32 px) | Reference controller defined (GDD 6.2; WP1 acc. 6); colour-quantised mask comparison (WP5 acc. 3); one minimum: car ≥ 32 px in every orientation (GDD 5.3; WP6 acc. 2) |
| PT-19 | m | Double prop density wakes too many bodies; ghosting toggle inside the step | Awake cap 24 (GDD 25; WP4 acc. 5); ghosting through the post-step queue (WP2 acc. 5) |
| PT-20 | m | Follow camera shadows shimmer or cut off | Shadow frustum fitted and texel-snapped (GDD 5.3); WP6 acc. 8 |
| PT-21 | m | HUD and minimap per-frame cost measured only on desktop | Transform-only pops, pre-rendered minimap with dots ≤ 30 Hz (GDD 20.6); `updateHud` under the 4× throttle (WP9 acc. 4) |
| PT-22 | m | Race load time on phones unbudgeted | ≤ 2 s under the 4× throttle, geometry cached (GDD 25; WP5 acc. 6, WP15 acc. 6, gate 11) |
| PT-23 | m | Debug counters the gate needs have no owner | Hook table with owners and stub values (PLAN 3.5) |
| PF-1 | C | Late-career PR targets exceed what almost every car can reach | League targets rescaled (GDD 15.2: L5 130 to 138, final 140); reachability rule ≥ 5 cars per league, ≥ 3 per boss (10.2; WP7 acc. 4) |
| PF-2 | C | Star walls of 67 to 86% are a grind; first boss wall at minute 25 | Boss opens with ★1 on 5 of 6 events; leagues at 55 / 60 / 65 / 70% (12 / 25 / 41 / 59★); stars count across leagues; boss fail assist 5 steps; casual-player pacing test (GDD 15.1, 12.5, 16.4; WP7 acc. 7, WP8 acc. 3) |
| PF-3 | C | Retention layer is all P1 | Records, leaderboards, Weekly Smash Cup, Legend Remix, cosmetic shop, mastery, level titles and cosmetics in P0; campaign 8 to 10 h with Remix (career itself 5 to 5.5 h with the softer gates: content, not grind) (GDD 1, 10.6, 15.6, 15.7, 16.3, 16.6, 17.4, 17.5) |
| PF-4 | M | Per-car upgrades make every new car a restart | D3 hybrid: Workshop levels 1 to 3 shared by all cars, Signature 4 and 5 per car; new cars arrive at the Workshop levels; `upgradeModel` switch (GDD 10.4; WP7 acc. 3) |
| PF-5 | M | "Choose any car" vs unlocks is confusing; test-drive economy opaque | One rule on every card: "Drive it free in Quick Race. Own it to use it in Career."; career test drives replaced by R4 per event; showroom PR shown (GDD 10.5, 20.4, 26.6) |
| PF-6 | M | First 25 minutes show only 2 maps | L1 shows t1, t2, t3 in events 1 to 3; reverses from event 6; Harbor at about 22 min, Scrapyard at about 48 min; no layout twice in any 3 consecutive events (GDD 15.1, 15.3, 16.4; WP8 acc. 2) |
| PF-7 | M | The GAS thumb does five things; predictable misfires | Brake tap opt-in; slot tap default; strict flick with a setting; no-drift alternatives for every drift star (`driftStars`); the assist stays on by default but is announced by a non-modal chip in race 2 instead of a first-run Yes/No prompt (the FTUE allows no modal), and G2 measures accidental drifts before the default is final (GDD 5.1, 15.3, 19.2; PLAN 8) |
| PF-8 | M | First human play-test only after integration | G2 after WP1 + WP6 (drift, cameras, gestures, real sound) and G2b after WP12a (first 5 minutes); the career table is frozen only after G2b (PLAN 1, 8) |
| PF-9 | M | Too many interstitials (every Results exit, retries, garage) | Not marked: RETRY, GARAGE, FTUE results, a Results visit with a rewarded view (D6, GDD 18.2). Not adopted: a game-side "first session / every 3 races" floor, because REQUIREMENTS and Playgama say timing belongs to the Bridge (no own timers or counters); instead WP17 asks Playgama about 180 s. Expected 3 to 4 per 15 min |
| PF-10 | M | Wreck in Knockout is a certain exit; slam farming | Knockout respawn grace 5 s (GDD 9.3); 10 s slam immunity per victim and no slams on ghosted cars (9.2); WP2 acc. 3, 8 |
| PF-11 | M | Rivals have no identity; archetype name clashes with a car | 20 drivers with fixed signature car, paint, trait and head-to-head; revenge marker P0; archetypes renamed `pro` / `basher` (not "Rammer", which is the Bruiser car's class) (GDD 11, 12.2, 9.2, 26.7; WP3 acc. 3) |
| PF-12 | M | FTUE overload; wrong t1 corner | Race 1 = 4 lessons; drift and pads in race 2 at the t2 hairpin; other items in race 4; one-time mode cards (GDD 13, 19) |
| PF-13 | M | Smash Spree runs out of things to smash; thresholds unreachable | Refill of props and segments > 80 m away after 12 to 15 s and crate waves every 20 s; ★3 ≤ 70% of the bot's maximum; test max ≥ 1.3 × each threshold (GDD 13; WP2 acc. 8, WP4 acc. 4, WP16) |
| PF-14 | M | No records, replay, medal ghosts, gaps; leaderboard mismatch | Records tab and NEW RECORD lines (17.4, 20.7, 20.12), 3 s crash replay (20.7, WP2 replay buffer, WP6 view), medal ghosts in Time Attack (13; WP3 acc. 10), gap times in the HUD (20.6), leaderboards P0 in both documents |
| PF-15 | M | Testers would judge fun with placeholder sound | WP14 starts at G0 and delivers the first real pack before G2 |
| PF-16 | m | L5-6 ★3 duplicates ★2; L1-B "without repairs" meaningless | L5-6 ★3 = 3 slams; L1-B ★3 = finish with ≥ 70% health; star-table test that ★3 is never implied by ★2 (GDD 15.3; WP8 acc. 2) |
| PF-17 | m | Driver levels 5 to 50 give nothing visible | Titles at 5 / 10 / 20 / 30 / 40 / 50 and exclusive cosmetics at 10 / 20 / 30 / 40 / 50 (GDD 16.3) |
| PF-18 | m | Starter perk weak and invisible; perks not noticeable | Scrapper Patch-up regenerates between hits (visible); rule that every perk is noticeable within 2 laps, checked by the perk swarm in WP16 (GDD 10.3) |
| PF-19 | m | Daily hooks have no pull; tasks reward bad or passive play | Challenge streak shield (15.5); Weekly Cup with an exclusive weekly paint (15.6); `lowhp` and `km5` removed, `slip3`, `lead30`, `cleanDrift5`, `weekly1` added, filter rule (17.2) |
| PF-20 | m | Car chip and Rivals sheet content undefined | GDD 20.5: car cards with PR vs recommended, 3 bars, perk; rival preview row with names and PRs |
| PF-21 | m | Only EN and RU | TR / ES / PT-BR as P1 (GDD 27); strings already in dictionaries |
| PF-22 | m | Solo modes feel empty; drift thresholds from bots | Medal ghosts in Time Attack and a drift ghost in Drift Trial (GDD 13); Drift Trial thresholds set from G2 / G2b play-test data by WP16 (15.3) |
