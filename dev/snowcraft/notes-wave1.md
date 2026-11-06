
===== aebf896d9b1694964 =====
The simulation core is written and all 35 tests pass (`npx tsx tests/sim.test.ts`, exit code 0). Re-run on the final code, the table was identical on two consecutive runs. `npx tsc --noEmit` is clean for my files; the only error is the parallel agent's `src/game/worldgen.ts: Cannot find module './locations'`.

## Files (all under `/home/user/Alexlike111.github.io/dev/snowcraft`)
`src/engine/sim.ts`, `heat.ts`, `structure.ts`, `bodies.ts`, `particles.ts`, `explode.ts`, `phys.ts`, `tests/sim.test.ts`. I did not touch any contract file (`grid.ts`, `materials.ts`, `state.ts`) and did not commit.

## Exported API
All positions are in cells unless noted.

**sim.ts**
- `initSim()`, `stepSim(dt)`, `surfaceY(x)`, `ignite(x, y)`
- Extras: `seedSim(n)`, `simStats`

**heat.ts**
- Arrays: `temp`, `wind`, `sky`
- `initHeat()`, `stepHeat(dt)`, `tempAt(x, y)`, `windAt(x, y)`, `shelterAt(x, y)`, `enclosure(x, y)`, `addHeat(x, y, power)`
- Extras: `tempAtTile(tx, ty)`, `isSkyOpen`, `burstHeat(x, y, r, dT)`, `drainHeat(x, y, energy)`, `addThermalZone(x, y, r, T)`, `clearThermalZones()`
- `HEAT_POWER = { torch: 6, campfire: 90, furnace: 150, stove: 210, lantern: 2, player: 1 }`
- `addHeat` takes a per-second rate and must be called once per frame; the fixtures agent should use `HEAT_POWER`.

**structure.ts**
- `initStructure()`, `stepStructure(dt)`, `supportPreview(cells)`
- Extras: `requestSupportCheck(x0, y0, x1, y1)`, `pendingChecks()`

**bodies.ts**
- `clusters`, `makeCluster(idx[], vx, vy)`, `stepBodies(dt)` returning `{ impacts }`, `fellTree(x, y, dir)`, `onTreeLanded(fn)`, `clusterHitsBox(x, y, w, h)` returning `{ hit, speed, mass }`, `drawBodies(ctx, v)`
- Extras: `bodyCellAt`, `clearBodies`, `toppling()`

**particles.ts**
- `FX`, `FC`, `spawnFx(kind, x, y, vx, vy, life, rgb?, size?)`, `burstFx`, `throwCell(x, y, mat, aux, vx, vy)`, `stepParticles(dt)`, `drawParticles(ctx, v, emissive)`
- Extras: `cellColor`, `clearParticles`, `seedFx`

**explode.ts**
- `explode(x, y, r, power)` returning `{ destroyed }`, `onBlast(fn)`

**phys.ts**
- `moveBox`, `boxFree`, `solidAt`
- Extras: `submersion`, `matBelow`

## Deviations from SPEC
- Powders and liquids no longer displace FIRE cells. Otherwise oil flames floated out of the burning body and the fire fizzled.
- Burning liquids carry `F_BURN` on the liquid cell itself, so burning oil keeps flowing and spreading.
- Lava is a thermostat at 110 °C in `temp`, not a real 1100 °C, so rock near lava reaches the intended ~30 °C. `FREEZE_AT[LAVA]` is therefore unused; stray lava cells cool to basalt by a stochastic rule instead.
- `moveBox` does not apply gravity; the caller does. It returns a fresh result object each call.
- `stepBodies().impacts` is a shared array, cleared at the start of each call.
- Tree trunks (`F_TREE` WOOD) are always treated as anchors; "rooted in ground" is not checked.
- Fixture cells are ignored by the structure solver.
- Natural (non-`F_PLACED`) structural cells get ×2.5 span, so worldgen terrain doesn't collapse.
- I added the wind lift (above 8 m/s) that SPEC marked optional.

## Test results
| Test | Result |
|---|---|
| Water mass in closed box, 2000 ticks | 1687 cells conserved exactly |
| Snow pile | 44.7° angle; mass exact; 0 chunks awake after settling |
| U-tube | 25 / 24 cells high (started at 71 / 0); mass exact |
| Closed 6×5-tile snow room, fire, −25 °C outside | +5 °C at 12.3 s, 9.2 °C at 30 s; outside −24.9 °C; same room with a roof hole −14 °C |
| Open camp | tiles at 8–9 tiles distance within 0.3 °C of ambient |
| Water freezes at −20 °C | first ice 1 s, surface sealed 19 s |
| Structure | arch over 6-tile gap holds (182 cells); 10-tile flat slab drops its middle (104 of 160 cells left) |
| Cluster landing | 8×8 block lands intact at 79 cells/s |
| High drop | 120-cell drop shatters into 64 snow cells |
| Cluster into pond | water 1020 → 1020 |
| Tree felling | topples in 1.18 s |
| Performance, realistic 420×240 window, 600 ticks | **1.6 ms/frame** (sim 0.91, heat 0.30, structure 0.37) |
| Performance, blizzard with 23,000 moving cells | 2.7–3.1 ms/frame |
| Fuzz | 2400 ticks of random edits, explosions, fires, thrown cells, tree fells: no exceptions, no NaN |

The suite also covers fire/ember/ash, melt, steam→snow, lava, methane chain, oil, sintering, thermal catch-up, wind shelter, `supportPreview`, `moveBox`, draw functions against a mock canvas, and the player-proximity structure sweep.

## Critique
- The first frames after a large edit show 2–5 ms structure spikes on cold JIT; steady state is well under the 2.5 ms budget.
- The structure solver assumes the border of its region is supported once the region reaches 192 cells. A very long beam anchored only far away could be misjudged.
- A very large body of water takes up to ~40 s of play to level out. The level-out pass only checks 700 connected cells, so it can't connect distant surfaces.
- `fellTree` captures every tree connected by `F_TREE`, so two trees with touching crowns fall together.
- `drawBodies` / `drawParticles` are only tested against a mock canvas, not visually.
- Profiling scripts must live inside the project directory. Outside it, tsx loads modules as CJS and the numbers come out roughly 10× worse.

## Self-ratings (1–10)
| Area | Rating |
|---|---|
| CA correctness | 8 |
| Heat / survival tuning | 8 |
| Structure | 7.5 |
| Bodies / trees | 7.5 |
| Particles | 8 |
| Explosions | 7.5 |
| Phys | 8 |
| Tests | 8.5 |
| Performance | 9 |

===== af4bb5c9878163c7b =====
{
 "rating": 7,
 "ratingWhy": "The core physics is convincing and well tested (water levelling, a 44.7 degree pile, closed-room heating, arch versus slab, tree fall timing, all 35 tests green, tsc clean), but the sim is not yet window-bound as specified, several paths silently destroy mass, one test does not exercise what its name claims, and the required per-area self-test registration is missing.",
 "testsPassed": true,
 "testSummary": "cd /home/user/Alexlike111.github.io/dev/snowcraft && npx tsx tests/sim.test.ts: 35/35 passed, exit 0. Perf lines: sim+heat+struct 1.58 ms/frame avg on the 420x240 window, heavy 2.25 ms/frame avg (worst 9.2 ms, spikes in one frame). npx tsc --noEmit: exit 0, no errors. Coverage matches SPEC section 8 (mass conservation, pile angle, U-tube, fire to ember to ash, melt, freeze, steam to snow, arch vs slab, cluster landing and shatter, explosion, methane chain, lava, tree felling, phys, supportPreview, snowfall, wind lift, sintering, sleep, fuzz, perf). Weak spots: the fellTree test fills the crown over the trunk, so the trunk is 48 cells rather than the 320 intended and the logs check never exercises a tall trunk; the slab threshold accepts 65 percent survival; the fuzz test checks only invalid ids and temperatures, not mass; the explode test prints \"air gaps ok\" without asserting it. No selftest.ts file exists for any engine module.",
 "issues": [
  {
   "severity": "major",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/src/engine/sim.ts",
   "desc": "stepBurning (lines 180-217) and igniteCell/setFire run for every burning cell in the world, not only inside G.win. Fire outside the window never ages because stepFire runs only from scanCell inside the window, so off-screen FIRE cells freeze. Burning solids keep spreading via setFire across unseen forests, sharing the MAXB=8192 budget, which breaks the SPEC rule that the CA runs only over awake chunks inside G.win.",
   "fix": "Skip burnIdx entries whose chunk is outside the processed window (keep them parked, not burning) and re-activate them when the window reaches them. Or stop burning and spreading off-window cells and resume on entry. Add a test: a fire outside G.win neither spreads nor freezes, and resumes when the window moves over it."
  },
  {
   "severity": "major",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/tests/sim.test.ts",
   "desc": "fellTree test (lines 436-437): the crown fill (needles, x 901-w..902+w, y 372..439) overwrites most of the trunk fill at x 900..903. Measured trunk0=48 (rows 370-371 and 440-449), not the 4x80=320 intended. The logs assertion round(48/40)=1 therefore never tests a tall trunk (320 should give 8 logs), so the SPEC rule logs ~ trunk/40 is unverified.",
   "fix": "Build the crown only beside or above the trunk (for example, a needle mask that excludes the trunk columns), then assert count(WOOD) >= 300 before felling and logs === Math.round(trunk0/40) with trunk0 >= 300."
  },
  {
   "severity": "major",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/src/engine",
   "desc": "SPEC section 11 requires each area to register its tests in src/<area>/<module>.selftest.ts via registerTest. None exists for sim, heat, structure, bodies, particles, explode or phys (src/game/selftest.ts is the contract runner only). The in-phone self-test therefore cannot cover fire, water, freezing, support, falls, trees, explosions, heat or shelter.",
   "fix": "Add src/engine/sim.selftest.ts (and one per module or grouped) that wraps the scenarios from tests/sim.test.ts, restores state with a fresh world before each destructive case, and is imported from main.ts."
  },
  {
   "severity": "minor",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/src/engine/sim.ts",
   "desc": "windLift (lines 521-522): the source cell is set to AIR and throwCell's boolean result is ignored. When the flying-cell pool is full (MAXFC=4096) the snow is deleted, a silent mass leak.",
   "fix": "Check the return value and restore mat[i]=SNOW (or defer the lift) when throwCell returns false."
  },
  {
   "severity": "minor",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/src/engine/particles.ts",
   "desc": "A flying cell whose landCell search (LAND offsets within +-3) finds no free cell is destroyed (lines 163-164 and 169; the return value of landCell is ignored). Cells thrown into dense rock or packed piles vanish, so mass is not conserved there.",
   "fix": "Keep the cell in flight with a short bounce, or drop it as a powder burst at the last free cell, and enlarge the search when the first pass fails. Add a test that throws cells into a packed pile and checks the count."
  },
  {
   "severity": "minor",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/src/engine/bodies.ts",
   "desc": "land() (lines 161-177): if no clear placement is found within 10 rows up, cells that overlap WALK are skipped (line 177) and silently deleted. Lines 191-192 also overwrite gas and fire cells in the footprint without conserving them.",
   "fix": "Search further, or re-emit the lost or displaced cells as flying cells (as displaceLiquid already does for liquids), and handle gas the same way."
  },
  {
   "severity": "minor",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/src/engine/bodies.ts",
   "desc": "stepTree (line 353) throws new SNOW cells while the crown snow is not removed from the grid, so about 9 snow cells are created per fell. This contradicts the SPEC mass rule (it is an effect, not a conservation violation of captured cells).",
   "fix": "Either remove the thrown snow from the crown, or use spawnFx('flake') only."
  },
  {
   "severity": "minor",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/src/engine/sim.ts",
   "desc": "levelAttempt (lines 303-305) overwrites the gas cell above with liquid instead of swapping, so gas mass is lost in U-tube levelling.",
   "fix": "Swap the liquid and gas cells (or skip cells whose above-cell is gas) so the gas is conserved."
  },
  {
   "severity": "minor",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/src/engine/sim.ts",
   "desc": "Lava cooling (case 4, lines 474-480) ignores temperature. SPEC says lava cools to BASALT under FREEZE_AT. The code cools isolated lava at 30% per sample regardless of tile temperature, and neighbour-free lava in hot ground cools too fast.",
   "fix": "Gate the cooling on the tile temperature (for example, temp < FREEZE_AT-based threshold) and keep the neighbour rule for pools."
  },
  {
   "severity": "minor",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/src/engine/sim.ts",
   "desc": "Steam condensation at life end uses a hard-coded t < 0.5 (line 392), while STEAM.freezeAt is -2 (materials.ts) and SPEC says below 0 C. Steam between -2 and 0.5 C turns to snow without the rule being intended.",
   "fix": "Use the material threshold (0 C, or FREEZE_AT[STEAM]) consistently."
  },
  {
   "severity": "minor",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/src/engine/sim.ts",
   "desc": "initSim (lines 610-613) clears F_BURN on any burning liquid, because OIL has burnLife 0 (liquids have no burn timer). Burning oil therefore goes out after load or a new world.",
   "fix": "Keep F_BURN on flammable liquids (FLAM>0 and PHASE==P_LIQUID) and only clear it for solids with no burn timer."
  },
  {
   "severity": "minor",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/src/engine/sim.ts",
   "desc": "Powder falls two cells per tick only through AIR (line 275). SPEC says through AIR, gas and lighter liquid.",
   "fix": "Allow the two-cell fall when the cell below is gas or a lighter liquid, as the one-cell fall already does."
  },
  {
   "severity": "minor",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/src/engine/sim.ts",
   "desc": "Snow compaction rate jumps from 1.0 to 1.4 at t = -1 C (line 443), because the tf formula is only continuous on the low side.",
   "fix": "Use a linear ramp from 0.35 at -25 C through 1.0 at -1 C to 1.4 at 0 C, or simply 1.0 to 1.4 over [-1, 0]."
  },
  {
   "severity": "minor",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/src/engine/structure.ts",
   "desc": "The time slice is checked only after each processRegion (line 310, budget 2.0 ms). A single job can overrun: the perf test shows a structure spike of 3.1 ms against the SPEC 2.5 ms budget.",
   "fix": "Estimate job cost, or split large regions, and check the budget before each job with a smaller limit (about 1.5 ms)."
  },
  {
   "severity": "minor",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/src/engine/structure.ts",
   "desc": "classify (line 51) and the floor rule (line 81) treat P_LIQUID as floor. Blocks or ice over water count as supported, and support that drains away is never re-checked, since liquid flow does not call edited().",
   "fix": "Count only powder as floor (or liquids only when frozen), or queue a support check when the water level under a structure changes."
  },
  {
   "severity": "minor",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/src/engine/structure.ts",
   "desc": "classify (line 47) makes every F_TREE WOOD cell an anchor. SPEC says trunks rooted in ground. Cut or floating trunk sections therefore hold up structure.",
   "fix": "Anchor only trunk cells connected to the ground, for example by a flood from the bottom row of the tree."
  },
  {
   "severity": "minor",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/src/engine/bodies.ts",
   "desc": "fellTree (lines 283-296) captures every 8-connected F_TREE cell, so the touching crowns of neighbouring spruces topple together. This depends on worldgen spacing, which was not reviewed here.",
   "fix": "Capture only cells reachable through trunk cells (plus crown cells attached to this trunk), or check worldgen tree spacing so crowns never touch."
  },
  {
   "severity": "minor",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/src/engine/bodies.ts",
   "desc": "Falling-cluster sprites (lines 85-97) use flat cellColor with no procedural texture or edge shading, unlike grid cells (SPEC section 3). A falling block visibly changes look and then pops back when it lands.",
   "fix": "Render the cluster sprite with the same texture and shade path as the grid renderer, or sample the rendered tile colours."
  },
  {
   "severity": "minor",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/src/engine/explode.ts",
   "desc": "onBlast (line 11) and onTreeLanded (bodies.ts line 42) only push listeners and never remove them. A re-registration on new game or load duplicates callbacks, causing double damage or double drops. No caller exists under src yet, so the risk is for integration.",
   "fix": "Return an unsubscribe function, or clear the listener arrays in the init functions, and document it."
  },
  {
   "severity": "minor",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/src/engine/phys.ts",
   "desc": "moveBox allocates a result object on every call (line 60), and stepBodies returns a new { impacts } object every frame (bodies.ts line 380). Both are per-frame allocations that SPEC section 9 asks to avoid.",
   "fix": "Reuse a module-level MoveResult and impact object, and reset their fields each call."
  },
  {
   "severity": "minor",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/tests/sim.test.ts",
   "desc": "Test strength gaps: the slab test (line 224) accepts up to 70 percent of the span surviving; the fuzz test (lines 780-808) checks only invalid ids and temperatures, not mass; the explode test info string 'air gaps ok' (line 280) is printed but never asserted; there is no test for fire outside the window or for a cluster landing inside terrain.",
   "fix": "Tighten the slab bound to the physically expected residue, add a mass-accounting check to the fuzz test (including flying and fallen cells), assert the re-entry claim, and add the two missing scenarios."
  },
  {
   "severity": "minor",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/src/engine/sim.ts",
   "desc": "MARGIN = 16 cells (line 18) is far smaller than the SPEC wording '+1/2 screen margin'. If G.win is only the visible view, water and snow stop exactly at the screen edge.",
   "fix": "Confirm that main.ts already sets G.win to view plus half a screen. If not, widen the margin or document the decision."
  }
 ]
}

===== a33356e04e0a2f370 =====
All three major issues are fixed and verified. `npx tsx tests/sim.test.ts` passes 40/40 (35 before, 5 new). `npx tsc --noEmit` is clean. Nothing was committed, and I did not touch the contract files or `heat.ts`.

## Major issues
1. **Off-window fire (real, fixed).** Burning solids now only age and spread inside the processed window; outside it they are parked and resume when the window reaches them. If the burn budget (`MAXB` = 8192) passes 75%, parked fires are put out so they can't use it up. A new test confirms 1830/1830 planks stay unburnt for 25 s with the window elsewhere, then burn once it arrives.
2. **fellTree test (real, fixed).** The crown fill had overwritten most of the trunk (48 cells instead of 320). The crown now sits beside the trunk, setup asserts 320 trunk cells, and the test asserts `logs === 8`.
3. **No self-test registration (real, fixed).** Added `src/engine/sim.selftest.ts` with 16 scenarios in group `sim`. Each runs on a snapshot of the real world and restores it afterwards. `tests/selftest-sim.ts` runs them headlessly: 16/16 pass and the world is unchanged afterwards.
   - **Needs the integrator:** `main.ts` must `import './engine/sim.selftest'`. I don't own it, so this is not done.

## Minor issues fixed
- **Mass leaks:**
  - Wind-lifted snow is no longer deleted when the flying-cell pool is full.
  - Flying cells that find no free spot now settle above the column instead of vanishing.
  - A landing cluster that overlaps terrain re-emits those cells (search widened from 10 to 40 rows).
  - U-tube levelling swaps with the gas above instead of overwriting it.
- **Tree crown snow:** `stepTree` no longer creates snow cells from nothing.
- **Sim rules:**
  - Steam condenses to snow below 0 °C.
  - Burning oil keeps its flag after `initSim`.
  - Powder falls two cells through gas as well as air.
  - Snow compaction ramps continuously instead of jumping at −1 °C.
  - Lone lava cells in hot ground cool more slowly.
- **Structure:**
  - Trunk cells are anchors only while a chain of trunk cells leads down to ground, so a cut-off piece falls (new test).
  - The solver budget is now estimate-aware (1.8 ms soft).
  - A related bug I found and fixed: cells above a floating trunk were being treated as supported.
- **Tree felling:** neighbouring spruces with touching crowns no longer fall together (each crown cell goes to its nearest trunk; new test).
- **API:**
  - `onBlast` and `onTreeLanded` now return an unsubscribe function.
  - `moveBox` and `stepBodies` reuse their result objects, so callers must read them before the next call. There are no callers in `src` yet.
- **Tests:**
  - The slab test is tightened to 80–112 of 160 cells.
  - The explode test now asserts that all flying cells re-enter the grid and the crater stays open.
  - A new fuzz test tracks snow, ice, water and gravel through collapses, throws and cluster hits: 5541 cells in, 5541 found.
  - A new test covers a cluster that lands inside terrain.

## Skipped
- **Liquid counted as floor in `structure.ts` (kept).** Blocks on a frozen lake or pond are intended to count as supported. Re-checking after water drains needs a hook from the liquid pass, and I judged it too invasive for a minor issue.
- **Flat cluster sprite colours (not done).** Matching the grid renderer's texture needs a shading API in `render.ts`, which I don't own.
- **`MARGIN` = 16 (not changed).** It is added on top of `G.win`, so `main.ts` must set `G.win` to the view plus half a screen. I can't confirm that, because the current `main.ts` is the temporary viewer.

## Numbers
- 420×240 window, 600 ticks: 1.49 ms/frame (sim 0.88, heat 0.29, structure 0.31). Blizzard with about 23,000 moving cells: 3.2 ms/frame.
- Structure spikes of 2–3 ms still show up in the first frames after a large edit. That is cold-JIT cost on the first job of a frame, which always runs.
- Known gap: a flying cell that reaches the world bottom is still deleted. The real world has bedrock there, so it only matters in open test arenas (the mass test uses a wide floor).

Files are in `/home/user/Alexlike111.github.io/dev/snowcraft`:
- `src/engine/sim.ts`
- `src/engine/structure.ts`
- `src/engine/bodies.ts`
- `src/engine/particles.ts`
- `src/engine/explode.ts`
- `src/engine/phys.ts`
- `src/engine/sim.selftest.ts` (new)
- `tests/sim.test.ts`
- `tests/selftest-sim.ts` (new)

===== a3d42fa4730f227f1 =====
The world, lighting and renderer are built and running. `world.test.ts` passes 80 of 80, `e2e.mjs` runs clean with no console errors, and the 30 screenshots are in `shots/`. Nothing is committed. `npx tsc --noEmit` is clean for my files; the only errors are in the other agent's `tests/sim.test.ts` (a `450`/`446` comparison and a missing `process` type), which I left alone.

## Files
All under `/home/user/Alexlike111.github.io/dev/snowcraft`.

**Assigned files**
- `src/game/worldgen.ts`
- `src/game/locations.ts`
- `src/engine/light.ts`
- `src/engine/render.ts`
- `src/engine/camera.ts`
- `src/engine/sprites.ts`
- `src/main.ts` (temporary viewer)
- `tests/e2e.mjs`

**Extra files I added, all in my area**
- `src/engine/tex.ts` (procedural 64×64 material and background textures)
- `src/engine/sky.ts` (sky, stars, sun/moon, aurora, clouds, parallax mountains and forest silhouettes)
- `tests/world.test.ts` (headless worldgen tests, run with `npx tsx tests/world.test.ts`)

I did not edit any contract file or any of the other agent's files.

## API
**Render and camera**
- `initRender(canvas)`, `resize()`, `render(dt)`
- `screenToWorld(sx, sy)` and `worldToScreen(x, y)` take and return CSS pixels and cells
- `addLayer(z, fn): () => void` returns a remover
- `getView()`, `perf`
- `updateCamera(dt, tx, ty, snap?)`, `setCameraLook(dx, dy)`, `addShake(a)`, `clampCamera()`

**Light**
- `computeLight(view, time)`, `lightAt(x, y)` and `brightnessAt(x, y)`
- `lightAt` returns a shared array, so copy it if you keep it
- Exported arrays: `lightR/G/B`, `glowR/G/B`, `lt`, `skyTint`

**Sprites**
- `defSprite(key, palette, frames)`, `drawSprite(ctx, key, x, y, {frame, flip, tint, alpha, rot, ox, oy, scale})`
- `icon(key)`, `spriteSize(key)`, `drawFlame(...)`
- Fixture helpers the gameplay agent can reuse: `drawFixtureSprites`, `drawFixtureGlow`, `fixtureSpriteOrigin`
- Sprites exist for chest, door (open and closed), bed, stove (lit and unlit), campfire, radio, workbench, helipad, torch, sign, anvil, furnace

**World**
- `generateWorld(seed)` returns `{spawnX, spawnY}` (spawn is 1028,272); also `surfaceAt(x)`
- `sites[]`, `siteAt(x, y)`, `LOC`, `collectFixtureLights(out)`
- `warmZones[]` (`{key, x, y, rx, ry, temp}`)

**Viewer**
- `window.__sc` has `{G, teleport, setTime, setWeather, lightStation, viewerLight, setQuality, run, step, sites, fixtures, perf, shotReady, genMs, ...}`
- The viewer reads WASD/arrows/drag to pan and T (time of day), N (aurora), L (torch), F (light fixtures), 1/2/3 (weather), X (light-map debug)
- A clearly marked SIM HOOK comment in `main.ts` is where `stepSim`, `stepHeat` etc. go

## Deviations from the SPEC
- `computeLight` takes `(view, time)`, where the spec says `computeLight(view)`.
- `G.diff.loot` scales chest loot amounts at generation time.
- `warmZones` is a new export: the hot spring (38 °C) and the warm grotto (14 °C) with its hot pool (36 °C). The heat agent must clamp temperatures there, or the pools will freeze and the grotto will stay cold.
- Note items in chests are ids `note_1` to `note_6`; the plane-wreck chest holds `battery`. The items agent needs those ids to exist.
- Fixture footprints in tiles: radio 2×2, helipad 12×1, sign 2×2, torch 1×2.
- The `stove` fixture carries `data.smokeX/smokeY` (996, 232) for the pipe through the roof.
- Cracked ice is drawn from `aux` on ICE cells, so the events agent can set crack level there.
- Loot slots have no `dur`; the inventory should default tool durability.
- Quality: at 1 or lower the light map refreshes at 30 Hz, and level 0 turns off bloom, aurora, edge shading and sparkle.
- I did not add the player's personal light; the gameplay agent must push it into `G.lights`.
- Everything is unlit snow dust (`awake` is all zero), so the sim agent must wake chunks near the player.

## Tests
**`tests/world.test.ts`, 80/80.**
- Same seed gives an identical world (cells, shade, aux, background); a different seed does not.
- Generation takes about 250–330 ms, against the 1.5 s budget.
- All 11 sites exist and run left to right as the SPEC says.
- The station chest holds 3 crackers, a chocolate, 6 stone and a note; the wreck chest holds the battery. There are 10 chests in total.
- Every fixture footprint is `MAT.FIXTURE` + `F_FIXTURE`, with no stray flags.
- The lake ice is 3 cells thick in the middle and 6 at the shore, with water under it and nothing but ice and snow above.
- Snowpack is loose snow over packed snow, 7–22 cells deep; frozen dirt has a median of 16 cells.
- Ore depth bands hold: coal is shallowest and most common, then copper, then iron.
- Crystal only appears at y ≥ 600 and lava only at y ≥ 600, above bedrock.
- There are 7 sealed methane pockets and 5 sealed oil pockets.
- There are 25–28 spruces, 59–135 cells tall, all rooted in solid ground, with clearings around the station, hut, hot spring and lake.
- A body-sized passage runs from the surface down to y=584 and reaches the ice caves.

**`tests/e2e.mjs`.**
- It builds the bundle, opens `dist/index.html` via file://, fails on any console error, and saves PNGs for 15 scenes at desktop 1600×900 and phone 844×390.
- The scenes cover surface noon, dusk and night with aurora, station, forest, lake, ridge, wreck, tower, hot spring, blizzard, ice cave, grotto and crystal cave with lava.
- It also measures render time with CPU throttling ×1 and ×4.

**Render time per frame.** Rasteriser: software (headless Chromium), with other agents' jobs loading the machine.

| Throttle | Profile | Average |
|---|---|---|
| ×1 | desktop | 4.4 ms |
| ×1 | phone | 3.2 ms |
| ×4 | desktop | 22 ms |
| ×4 | phone | 12 ms |

The desktop ×1 figure is inside the 6 ms budget. The desktop ×4 figure is well over it, but that is a software-rasteriser stress case, not a real phone, so the mid-phone 60 fps target is unproven.

## Critique and ratings
My own 1–10 ratings from reading the screenshots:

| Scene | Rating | Note |
|---|---|---|
| Surface noon / dusk / night with aurora | 8 / 8.5 / 9 | Dusk and night are the strongest; aurora, stars and the lit cabin read well. |
| Station, forest, tower, blizzard | 8 | |
| Lake | 8 | |
| Crystal cave with lava | 8 | |
| Hot spring | 7 | The pool reads small. |
| Ridge | 6.5 | One smooth snow hill with a black core and odd boulder-like outcrops. |
| Plane wreck | 6.5 | Reads as a dark hull silhouette, not clearly a plane. |
| Ice cave, grotto | 6.5 | Cave air looks darker than the surrounding rock, and the ice lining only shows near a torch. |

Bugs I found and fixed along the way:
- A fractional rectangle coordinate wrote the wreck's tail fin about 1000 cells to the west.
- Negative light energy produced white bars in deep rock.
- Entrance tunnels skimmed under the surface and carved a trench; cave worms could also climb to the surface.
- Trees were mostly rejected by the site-exclusion rules.

## Known gaps
- Dark rock and caves: in the daytime views the rock below the snow is a black mass that fades from the surface, with a faint ambient floor of about 10 %, so cave air is darker than rock. A real-torch playtest should confirm this is the look you want.
- Sprite art is minimal and fixture-only; the full pass for player, animals and icons is left to the art agent.
- The ridge, plane wreck and ice caves need more visual detail.
- Trees are all one template with varied height, and nothing is footprinted or cast-shadowed.
- Mid-phone 60 fps is not verified on real hardware.

===== a7c9648977297616f =====
{
 "rating": 7,
 "ratingWhy": "Детерминированный и полный мир: все сайты, слои, руды, газовые карманы и геометрия §4 реализованы и проходят 80 проверок, визуал ночи с полярным сиянием, хребта и озера хороший. Снижают оценку пустая грунтовая «горка» на станции, аллокационный churn канвасов света в горячем пути и то, что main.ts всё ещё временный просмотрщик без фиксированного шага и хуков симуляции.",
 "testsPassed": true,
 "testSummary": "Критических ошибок нет. (1) npx tsc --noEmit по всему проекту: exit 0, ошибок нет. (2) node tests/e2e.mjs: сборка прошла, e2e ok, 0 console.error и pageerror на desktop 1600x900 и phone 844x390. Рендер при x1 в среднем 3.7–6 ms (порог 8 ms пройден), при CPU x4 6.6–22 ms; 30 PNG в shots/ перезаписаны и просмотрены (surface-noon, night-aurora, station-night-lit, icecave, crystal-lava, dusk, grotto, lake, ridge, blizzard). (3) npx tsx tests/world.test.ts: 80 passed, 0 failed, генерация 250 ms, детерминизм по seed подтверждён. (4) Зонды в scratchpad (только чтение): колонка x=1040 показывает грунт с 279 строки при снеге 276–278; модель формулы ширины региона света даёт 19 пересозданий канваса за 40 клеток панорамы при cw=402. Я не редактировал исходники; e2e перестроил dist/ и перезаписал shots/. tests/sim.test.ts вне области, не запускался.",
 "issues": [
  {
   "severity": "major",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/src/engine/render.ts",
   "desc": "Канвасы света и bloom пересоздаются (createElement + новый ImageData) при каждом изменении размера региона lt.w/lt.h. Ширина региона w = ((vx0+vw)>>2) - (vx0>>2) + 1 + 2M зависит от vx0 mod 4 (light.ts:141-143), поэтому при панорамировании и при тряске (sub-cell shake) она скачет. Замер: cw=402 (desktop, scale 4) дает 19 пересозданий на 40 клеток панорамы, примерно каждые 2 клетки. Это нарушает правило SPEC §9 «no per-frame allocations in hot paths» и создает GC-давление и сброс GPU-текстуры. Канвасы glow сбрасываются тем же путем (render.ts:406).",
   "fix": "Сделать размер региона постоянным: tx1 = tx0 + ceil(vw/4) + 2 + 2M (покрытие сохраняется, т.к. (vx0+vw)>>2 <= (vx0>>2) + ceil(vw/4)). Альтернатива: аллоцировать канвасы один раз под максимум и менять только источник drawImage. Сбрасывать glowC только при реальной смене размера."
  },
  {
   "severity": "major",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/src/game/worldgen.ts",
   "desc": "Плато метеостанции почти без снега, отсюда бурая «горка» грунта в shots/desktop-surface-noon.png под домом и вертолетной площадкой. Причина: depth *= (1 - stN*0.55) (worldgen.ts:141-142) и clamp(6..46) (:143) дают 6-7 клеток снега на плато. Зонд колонки x=1040: площадка FIXTURE на 272-275, SNOW 276-277, PACKED 278, DIRT с 279. Спек §4 задает снежный покров 8-40 клеток. Блок flatten в locations.ts:158-159 работает по y 262..271 и не затрагивает реальную поверхность 272, так что он ничего не делает.",
   "fix": "Ослабить подавление снега на плато (множитель не ниже ~0.8 либо минимальная глубина 8 на плато). Исправить flatten, чтобы он работал у фактической поверхности. Перерисовать surface-noon и проверить, что под домом нет голого грунта."
  },
  {
   "severity": "major",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/src/main.ts",
   "desc": "main.ts остается временным просмотрщиком (шапка файла). Нет фиксированного шага 60 Гц: dt переменный, clamp 0.1 (:74-75). Нет вызовов stepSim/stepHeat/stepStructure/stepBodies/stepParticles, только комментарий на :88. drawBodies (bodies.ts:419) и drawParticles (particles.ts:214) не зарегистрированы через addLayer. window.__sc не содержит start/give/act/place/craft/kill/stats/fps из SPEC §8. Блокер интеграции, но файл помечен как временный.",
   "fix": "При замене gameplay-агентом: аккумулятор фиксированного шага (до 3 тиков/кадр), регистрация слоя bodies на z=-20 и particles на z=-10 и z=10, полный __sc по §8. Viewer-API, которым пользуется e2e (ready, lightStation, viewerLight, perf, sites), сохранить."
  },
  {
   "severity": "minor",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/src/engine/render.ts",
   "desc": "Depth-from-air AO из SPEC §3 («cheap distance-to-air per tile») не реализован. Есть только соседские проверки OPEN (render.ts:175-181): верх, низ, лево, право. Затемнение глубокой породы держится только на свете.",
   "fix": "Посчитать расстояние до воздуха по тайлам (2 прохода, 0..3 тайла) и добавить затемнение в mul для solid/powder."
  },
  {
   "severity": "minor",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/src/engine/light.ts",
   "desc": "Сигнатура computeLight(v, time) (light.ts:136) отличается от SPEC §1 computeLight(view). render.ts:352 передает time.",
   "fix": "Сделать time необязательным (по умолчанию G.realTime) или обновить SPEC §1."
  },
  {
   "severity": "minor",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/src/game/locations.ts",
   "desc": "Сундуков 10: 4 на сайтах (station, hut, tower, wreck) и 6 в пещерах (locations.ts:360, 361, 367, 369, 372). Спек §4 говорит «6–9 caches (chests) in caves and sites». Тест world.test.ts:64 допускает 6..12, поэтому расхождение не ловится.",
   "fix": "Убрать один кеш или уточнить спек. Ужесточить тест до 6..9."
  },
  {
   "severity": "minor",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/src/game/worldgen.ts",
   "desc": "Clamp глубины снега clamp(…, 6, 46) (:143) против §4 «8–40». Минимум фактически 6-7 клеток (см. замечание о станции).",
   "fix": "clamp(…, 8, 40) и согласовать тест глубины снега."
  },
  {
   "severity": "minor",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/src/game/locations.ts",
   "desc": "Первая ступенька башни (строка 51, верх около клетки 204) выше холма (около 212) примерно на 8 клеток, то есть 2 тайла. Достижимость прыжком не проверяется тестами. Если высота прыжка игрока меньше, башня недостижима без ступенек.",
   "fix": "Проверить прыжком через moveBox или самотест. При необходимости снизить первую ступеньку до 1 тайла или добавить опорный блок."
  },
  {
   "severity": "minor",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/src/game/locations.ts",
   "desc": "Тексты табличек фиксируются при генерации (data: { text: S.sign_* }, :156, :170, :178, :196, :235, :242). Смена языка после генерации их не обновит, а в сохранении окажется переведенный текст.",
   "fix": "Хранить только key (site.sign_*) и резолвить через strings() при отрисовке."
  },
  {
   "severity": "minor",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/tests/e2e.mjs",
   "desc": "Телеметрия e2e вводит в заблуждение. Для первой сцены avg = 0.00 ms (perfAvg считается раз в 60 кадров, :88). На phone light = 0.0 ms из-за пропуска пересчета на нечетных кадрах (light.ts:145). e2e проверяет только консольные ошибки, без проверки визуала или пикселей.",
   "fix": "Брать среднее по последним N кадрам с учетом пропусков. Добавить проверку, что кадр не пустой и не черный."
  },
  {
   "severity": "minor",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/src/engine/sprites.ts",
   "desc": "Мертвый код: no-op .replace('P','P') (:114), функция hf (:193) нужна только для void hf (:254).",
   "fix": "Удалить."
  },
  {
   "severity": "minor",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/src/engine/sprites.ts",
   "desc": "Кэш тинтов (tinted, :44-55) ключуется строкой tint. Плавный тинт (вспышка урона, затухание) создаст канвас на каждый кадр, а кэш сбрасывается при >300 записях.",
   "fix": "Квантовать тинт или использовать fillStyle/globalCompositeOperation без новых канвасов."
  },
  {
   "severity": "minor",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/src/engine/render.ts",
   "desc": "Поверхность лавы (lava-ветка, :279-285) в shots/desktop-crystal-lava.png читается как диагональная полосатая штриховка, а не как жидкость (текстура fire и сдвиг по (wx + t*4)).",
   "fix": "Снизить контраст текстуры, замедлить анимацию, добавить яркую кромку поверхности как у воды."
  },
  {
   "severity": "minor",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/src/engine/render.ts",
   "desc": "Белые точки в подземных фоновых текстурах (BGTEX, :210-212; tex.ts вне области) читаются как звезды в shots/desktop-crystal-lava.png и phone-grotto.png.",
   "fix": "Снизить плотность и яркость speckle в bg-текстурах."
  },
  {
   "severity": "minor",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/src/game/worldgen.ts",
   "desc": "Скальные выходы на хребте (:336-349) в shots/desktop-ridge.png выглядят как плоские серые пятна с обводкой снега, без теней и текстуры.",
   "fix": "Добавить освещенный верх и тени (как в terrain-проходе) и варьировать материал (STONE, COAL, GRAVEL)."
  },
  {
   "severity": "minor",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/src/game/worldgen.ts",
   "desc": "Берега озера голые (:204-228): коричневый грунт и гравий по всему контуру в shots/desktop-lake.png, снег у берега почти нулевой (snowT * (1 - thin*0.9)). Озеро читается как коричневая чаша.",
   "fix": "Оставить снег на кромке (минимум 2 клетки) или сделать кромку льдом или галькой."
  },
  {
   "severity": "minor",
   "file": "/home/user/Alexlike111.github.io/dev/snowcraft/tests/world.test.ts",
   "desc": "Нет unit-тестов для light.ts, render.ts и camera.ts: клампы камеры, dead zone, постоянство ширины региона света, диапазон lightAt. Selftest мира не зарегистрирован. Для §11 мир относится к волне 1, поэтому это не блокер.",
   "fix": "Добавить проверки camera clamp, постоянной ширины региона света и диапазона lightAt в [0..1.5]."
  }
 ]
}
