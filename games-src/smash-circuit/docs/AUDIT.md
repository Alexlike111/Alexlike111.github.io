# Smash Circuit: technical audit

Date: 2026-11-03. Tree: HEAD `c36f477` (WIP: the power-ups and visible-damage agents were editing while the audit ran). Author: technical director, compiled from 16 area audits.

## How to read this

- Each area auditor worked read-only. Probes and results are in `e2e/out/audit/` (sub-folders `damage/`, `destruction/`, `meta-economy/`, `ui-flow/`, `v/`, `scripts/`). No project source was edited.
- Every critical or major finding then went to an independent verifier.
  - **Verified**: the verifier reproduced it or confirmed it in code. If the verifier changed the severity or corrected numbers, that is noted.
  - **Dropped**: findings the verifier rejected are not listed as findings. They are summarised in one line at the end of each area, so nobody re-reports them.
  - **Unverified**: minor issues and opportunities did not go through the verify pass. Treat them as the auditor's claim.
- Line numbers drift because files are changing under other agents. Search for the named function if a line does not match.
- Effort scale: XS is under 1 h, S is half a day, M is 1 to 3 days, L is a week or more, or needs owner-sourced assets.

## Score table

| # | Area | Score /10 | Verified critical | Verified major | Main weakness |
|---|---|---|---|---|---|
| 1 | Physics: car | 5 | 0 | 3 | Hits are re-aimed into the heading, spin is erased, the grip stat does nothing |
| 2 | Damage | 4 | 0 | 6 (most moderate) | Damage cliff at plow threshold, glancing hits under-charged, repair is a free undo, no readout |
| 3 | Destruction | 5 | 1 | 3 | t3 two-wall shortcut, light props pay with no damage, scrape wear never accumulates |
| 4 | Tracks | 4 | 0 | 1 (moderate) | T3 hairpin 55 m after the start line, thin content |
| 5 | AI | 4 | 0 | 3 | Planner pushes packs into walls, inverted lateBrake mistake, upgrades and skill barely matter |
| 6 | Race sim | 5 | 1 | 1 (minor) | Lap progress is a centre-line projection with no gates, so cuts are credited |
| 7 | Render: world | 5.5 | 0 | 4 (moderate) | Props never culled, decor presets under-deliver, per-race full rebuild |
| 8 | Render: cars and FX | 4 (see note) | 0 | 2 | One car silhouette, no hit reaction on the car |
| 9 | Camera and perf | 5 | 0 | 4 | Props unculled, shadow pass 43% of triangles, one-way auto-quality, full render while paused |
| 10 | UI flow | 5 | 0 | 4 | No Race again, results ignore destruction, silent laps, frozen first race |
| 11 | HUD and input | 4 | 0 | 5 | Touch-down steer jump, auto-gas accidental brake, no gap or lap feedback, timer runs past finish |
| 12 | Meta and economy | 4 | 1 | 4 | Failed load then write wipes the save, grip upgrade is worthless, upgrades buy little |
| 13 | Platform (Playgama) | 4 | 2 | 4 | Save wipe, synthesized audio, boot crash with an ad open, placeholder SaaS token |
| 14 | Audio | 3 | 1 | 4 | All audio synthesized (publish blocker), own crash silenced, compressor flattens hits, loop clicks |
| 15 | Tests and quality | 4 | 0 | 2 | Release gate not wired to CI, vacuous smash-counter test |
| 16 | Loading and bundle | 4 | 0 | 4 (moderate) | Race start freezes about 0.8 s at 4x throttle, serial boot, sync Bridge script |
| | **Mean** | **4.3** | | | |

Note on area 8: its score of 4 included a critical particle-mirror regression. The verifier found it already fixed in commit `05daa04`. Without it the area is about 5.

### Release blockers, whatever their rank

1. Code-synthesized audio fails Playgama 3.3.2 (areas 13 and 14). The owner has to source recorded CC0 or licensed audio.
2. Progress can be overwritten with defaults after a slow or failed storage read (areas 12 and 13; checklist 3.2.3 and Bridge step 4).
3. The SaaS `publicToken` placeholder must be replaced, or the `saas` block removed, before leaderboards ship (area 13).
4. The t3 shortcut plus lap credit lets a cut lap take the top leaderboard score (areas 3 and 6).

---

## 1. Physics: car (5/10)

The arcade core meets its targets: 0-100 km/h in about 4 s, deterministic, a 720k-step fuzz with no NaN and no tunnelling. The weak part is collision response, which a destruction racer depends on.

### Major

**P1. Sideways impacts are re-aimed into the heading, so struck cars drive forward or backward.** Verified.
- Where: `src/sim/carModel.ts` (snap of `f` to 0 near line 175; `s = f<0 ? -1 : 1` near 184; the grip rotation at 185-190), and `src/sim/car.ts:107-123`, which feeds the solver velocity straight back into the model.
- Evidence (verifier, `integrateCar` alone): a 5 m/s broadside shove on a standing car gives 3.95 m/s forward after 1 s, with 4.0 m travelled along the nose and 0.26 m sideways. A 10 m/s shove gives +8.19 m/s on a car rolling at +0.5 m/s and -8.19 m/s on one at -0.5 m/s, so the car drives in reverse.
- Fix: in `SimCar.preStep`, keep an impact velocity. `impV += (bodyV - preV)` takes the solver's contribution, then `impV *= exp(-3.5*dt)`. Integrate the arcade model on `v - impV` and add `impV` back, so grip never rotates `impV`. Below |f| of about 1 m/s, damp lateral speed only. Replace the `f<0` test with a travel-direction state that has hysteresis of about 0.5 m/s. Clamp |impV| to 0.5 x |v|. Test: a standing car shoved at 10 m/s keeps |forward| under 0.2 x the shove after 1 s.

**P2. Impact spin is erased in about 0.3 s, so crashes never spin cars out.** Verified (verifier rates it major for feel, not for correctness).
- Where: `src/sim/carModel.ts:201-202` (angular velocity blended toward the steering yaw with `yawDamping` 16, `src/config.ts:30`, by design); `src/sim/car.ts:110, 122-124`.
- Evidence (verifier): a 1.3 rad/s kick at 20 m/s decays to 0.26 rad/s at 0.10 s and 0 at 0.5 s. Total rotation is 4.4 deg. A free body keeps about 75 deg/s.
- Fix: route the solver's angular impulse into a separate `impW` that decays at about 1.5/s, capped at 3 to 4 rad/s. Keep `yawDamping` for the driven yaw only. Add a 0.25-0.4 s impact state after a heavy hit, in which steering and grip re-alignment are suspended. `Car.recordImpact` is the natural entry point. Check AI recovery afterwards.

**P3. The grip upgrade is sold as "Sharper turns" but does not change cornering.** Verified (also raised in areas 5 and 12).
- Where: `src/sim/carModel.ts:178` (`stats.grip` is used only as the slip-decay rate), `:57-60` (`turnRateCap` uses `C.maxLatAccel * gripMul` with no stat), `:104-105` (drift lateral acceleration); `src/i18n.ts:48, 167`; `src/meta/economy.ts:25` (+7% per level).
- Evidence (verifier): at 25 m/s and full steer, base grip 12 and max grip 16.2 both give lateral acceleration 25.01 m/s². The radius goes from 24.87 to 24.99 m, so it is identical.
- Fix: pass stats into `turnRateCap` and `steerForCurvature` and scale the limit by `(stats.grip/C.baseGrip)^k`, with k about 0.5 to 1. Do the same for `integrateDrift` and the AI's planned `aLat` (`src/sim/ai.ts:174`). Test: grip level 5 raises steady corner speed by at least 10%.

### Minor (unverified)
- **Rear and wheel damage can make the car almost unsteerable at 22% health** (`gripMul` 0.05). `src/sim/damage.ts:85` has no floor, while the drift and AI paths clamp at 0.3. Fix: floor `gripMul` at about 0.3-0.35 in `computeEffects` or in the main grip and yaw path (`carModel.ts:178, 197`).
- **Dead `curbSlowdown` key** (`config.ts:32`) and `state.drifting` is read only by preview code. There are no regression tests for impacts, impact yaw or grip-driven cornering. Fix: delete or wire them up, and add the three tests above.

### Opportunities (unverified)
- **No power oversteer or trail-brake rotation.** Throttle and brake never change rotation. Fix: reduce rear grip by throttle x (1 - v/vmax), and shift load forward under braking.

### Dropped after verification
- "Cornering and handbrake scrub drains speed": the numbers are stale (cornerScrub is now 0.12), and the in-game handbrake goes through the drift model.

---

## 2. Damage (4/10)

The code is clean, pure and deterministic. Measured behaviour is not yet fair or readable. The verifiers rated most of these "moderate" rather than "major". They stay here because each one shapes how crashes feel.

### Major (verified, most rated moderate)

**D1. Hitting a breakable wall harder can cost less HP (a cliff at the break threshold).** Verified, moderate.
- Where: `src/sim/car.ts:215-230` (`plowThrough`: `e.impulse = Math.min(e.impulse * ratio, damageCap)`); `tests/plow.test.ts:75-78`.
- Evidence (`damage/part4.out.txt`): corner wall 55 km/h costs 45.8 HP (no break) but 60 km/h costs 13.4 HP (breaks). Guardrail 30 km/h costs 26.1 HP and 35 km/h costs 16.3 HP. Above the threshold, damage rises with speed again.
- Fix: ease the plow factor from 1 at the break impulse to the full ratio over about 1.5x break speed. Add a non-decreasing damage sweep test from 20 to 150 km/h. The 90 km/h guardrail expectation in `tests/plow.test.ts` will need re-tuning.

**D2. Glancing impacts are under-charged, because the 2500 N·s threshold is applied per 1/120 s step.** Verified, moderate.
- Where: `src/sim/sim.ts:239-240` (`onPostSolve`), `src/sim/car.ts:201-205` (`recordImpact`), `src/sim/damage.ts:46-47`.
- Evidence: at 140 km/h and 10 deg, the step impulses are [2916, 217, 3154, 110], which charges 3.7 HP. One summed event would charge 13.6 HP. At 5 deg and 140 km/h, and at 10 deg and 100 km/h, the hit is free. Scraping along walls becomes the best line.
- Fix: accumulate normal impulse per (car, piece) over 0.05-0.1 s and apply the threshold once. Keep per-step values for FX. A car pinned at full throttle (about 67 N·s per step) stays below `scrapeMin`. Re-tune `impulseToDamage` (`config.ts:70`). Adapt `plowThrough` and keep the synthetic car-vs-car and power-up impulses out of the window.

**D3. A symmetric head-on crash always pulls the car to the right.** Verified, moderate.
- Where: `src/sim/damage.ts:88-90` (`dir = lateral < 0 ? -1 : 1` with lateral 0, so it defaults to +1); the tie-break in `zoneForLocalPoint`.
- Evidence: a centred nose hit gives pull +0.047 to +0.105 to the right, and nothing visible shows which way it pulls.
- Fix: store a persistent `pullDir` from the sign of the first impact's local ly (or wFR minus wFL). For truly symmetric loss, use zero pull, or pick a side once with the seeded RNG and show a matching asymmetric visual.

**D4. Repair is an instant, time-free full undo.** Verified, moderate (the instant R key is a `[rec]` item in REQUIREMENTS.md:23).
- Where: `src/game.ts:98, 222-234` (`repairNow` works while racing, with no cooldown or cap); `src/sim/car.ts:280-288`; `src/meta/economy.ts:54-57`.
- Evidence: a 107 HP side hit is erased for 96 money with one key press. That devalues the Repair-kit item (`config.ts:433`, `powerups.ts:25-27`), and the AI has no equivalent.
- Fix: in-race repair only while nearly stopped, with a 2-3 s hold, plus a cooldown or a per-race cap. Instant full repair only from pause and results, or with a time penalty.

**D5. Detached parts have no mechanical effect.** Verified, rated a missed opportunity.
- Where: `src/sim/damage.ts:83-129`, `src/sim/car.ts:286-315`. `detachedParts` is read only by render, FX and UI.
- Fix (optional): add a per-part modifier layer in `computeEffects`, such as spoiler off giving -4% grip and +3% top speed, or hood off giving more smoke. Rebalance the zone coefficients at the same time to avoid double counting.

**D6. The HUD shows zone colours but not what the damage does.** Verified, medium.
- Where: `src/ui/ui.ts:188-208`. Nothing reads `p.effects`.
- Fix: show effect chips only while active (PWR -36%, TOP -15%, GRIP -35%, a PULL arrow) and a short toast on the hit that created each one. Use the numbers from `computeEffects`.

### Minor (unverified)
- **AI races never show damage.** In 10 headless races the worst final health was 0.72, and nobody reached the smoke threshold (0.5). Measure with a human-like driver first, then consider wear per metre of scrape or a lower `smokeBelow`.

### Opportunities (unverified)
- **Car-vs-car damage is symmetric** (`sim.ts:220-223`): the rammer takes as much as the rammed. Fix: the car closing from behind takes about 0.5x.
- **Damage as a driving decision.** Combine D4, D6 and partial or zone repair into a timed pit stop, so every crash becomes a choice.

### Dropped after verification
- "Steering pull is about 3x too strong": the yaw numbers were wrong (real pull is 6.8 deg/s at 30 m/s, 14% of authority), and the proposed values would remove the effect.
- "'Wrecked' does not match loss of control": wrecked is a rare designed event (GDD D4), and the proposed fix would not restore steering anyway.

---

## 3. Destruction (5/10)

The core is cheap and robust: flush takes about 1 µs, physics about 0.1 ms with 8 cars, and 55/55 tests pass. The gameplay payoff is weaker than the design promises, and there is one leaderboard exploit.

### Critical

**X1. t3 mouth shortcut: breaking two walls skips about 233 m of the lap.** Verified (verifier: high severity; it costs more to open than claimed, but it breaks the leaderboard).
- Where: `src/track/tracks.ts:259` (the T3 legs near y 60 and y 84 run 21-29 m apart); `src/sim/destruction.ts:117-155` (`buildWalls` does not protect walls that face another section); wall 59 (s about 238) and guardrail 121 (s about 486); `src/sim/race.ts:126-132` accepts the progress jump after 1 s; best lap is submitted at `src/game.ts:348-349`.
- Evidence: the geometry probe (`v/geom.txt`) finds t3 can save 232.8 m, against 0.99 m on t1 and 6.1 m on t2. Both walls break at a 30 m/s entry for 25% health. Lap credit lands normally (`cut2.json`). The likely net saving is 5-9 s of a 33 s lap. The walls can also be worn open over laps 1-2.
- Fix: at track build, find sample pairs under about 45 m apart with more than 100 m of lap between them, and make the walls facing them indestructible, or add an invisible static barrier. Add a test that no breakable wall faces such a gap on any track. Fix the progress side with gates (R1).

### Major

**X2. Light props pay 6 money each and do no damage to the car.** Verified, moderate (588 money is an upper bound).
- Where: `src/sim/sim.ts:411` (`countBreaks` counts every non-curb break); `src/meta/economy.ts:49-50`; `src/config.ts:224` (`destructionBonus` 6), cone threshold 40 and `dmgMul` 9.6.
- Evidence (`destruction/props.json`): a 20 m/s bump breaks 4 cones and pays 24 money, with 0% health lost.
- Fix: pay per kind (cones 0 or 1), or by HP removed, or with a per-race cap. GDD 9.1 already specifies a capped smash score. Raise the cone break threshold.

**X3. Glancing scrape wear never accumulates.** Verified.
- Where: `src/sim/destruction.ts:271-276` (`recordScrape`), only called from `src/sim/sim.ts:269`, which returns early below `scrapeMin` (90 N·s); `tests/crashTuning.test.ts:90-99` calls `recordScrape` directly and never exercises the physical path.
- Evidence (verifier, t1): a 2 s graze at 40 m/s and 1-4 deg wears 2.2-3.4 HP of a 170 HP guardrail, with 0 breaks. The car still bleeds from 40 to 24 m/s.
- Fix: measure wear by proximity. Each step, any car corner within about 0.15 m of a wall face with tangential speed at or above `scrape.minSpeed` calls `recordScrape`, and sparks use the same gate. Add a physical test: a 2 s graze at 40 m/s and 4 deg removes at least 40 HP.

**X4. Overkill is thrown away, so a top-speed hit opens the same gap as a tap.** Verified, minor to moderate (deliberate per the code comment).
- Where: `src/sim/destruction.ts:333-334` (HP clamped at 0), `:355` (splash capped at 0.3 x maxHp, no cascade).
- Evidence: 15, 25 and 35 m/s perpendicular hits each break 2 guardrail segments, and the neighbours end at 119/170 every time.
- Fix: carry 40-60% of the overkill to each neighbour, cascading up to about 4 segments. Re-check X1 geometry, `maxBreaksPerStep`, the debris budget and event volume afterwards.

### Minor (unverified)
- **Rocks are effectively indestructible**: they break at about 37 m/s (`config.ts:127`). Lower HP and threshold, or make them visually distinct boulders and update REQUIREMENTS.
- **Corner classification is too loose**: about 58% of t1 gets curbs and corner walls (`destruction.ts:130, 170`, `cornerCurvature` 0.011). Use a smaller curvature threshold (radius under about 40 m) or per-track flags.
- **Curb sensor bodies are never read** and cost about half the physics step (t1 mean 0.105 to 0.05 ms without them; `destruction.ts:172-176`). Remove the bodies and keep the grid lookup.
- **The deferred-break cap of 4 per step** keeps dead pieces solid for up to 17 ms and disables plow-through for them (`config.ts:92`). Raise it to 16, or drain every piece at 0 HP.
- **The destructible renderer creates 63-102 InstancedMeshes per track** (`render/destructibles.ts:35, 171-199`). Merge per kind per 90 m section; measure on a device first.
- **Money attribution is inconsistent** (`sim.ts:247, 375`): `lastHitBy` is never cleared, and splash breaks are not credited. Store the attacker id on the hit that breaks the piece.

### Opportunities (unverified)
- A smash-streak multiplier instead of a flat payout; scrape sparks tied to the wear gate; cracked walls that shed dust and change their impact sound.

---

## 4. Tracks (4/10)

The engineering is sound: closed loops, even 1 m sampling, clean self-clearance, and 58/58 tests pass. The design is thin for a top-1 game.

### Major

**T1. The T3 hairpin 55 m after the start line causes an opening-lap scramble.** Verified, moderate.
- Where: `src/track/tracks.ts:259-260`, `src/sim/sim.ts:225-232` (`gridPose`).
- Evidence (verifier re-run, `tracks-verify.test.ts`): 9/26/2/0/2 wall hits in the first 12 s across 5 seeds. t1 had 0 and t2 had 0 in 4 of 5. No wrecks; hit strengths are low.
- Fix (optional): move the hairpin about 50 m further from the line, or add a softer run-off at its entry. Target fewer wall hits, not zero, because a first-corner scramble suits the genre.

### Minor (unverified)
- **Track comments describe geometry that is not there.** The T2 "S-kink chicane" moves the road 0.7 m; the T3 radii are 9.9-11.9 m. Build a real T2 chicane with at least 6 m offset on the back straight, or correct the comments.
- **Isolated 3-5 m curb and corner-wall blips on straights** (no hysteresis in `buildWalls` and `buildCurbs`). Require runs of at least 8 m above the threshold.
- **Light side contacts at the launch on T1 and T2**, because the AI aims for lane 0 from its grid column. Keep the grid column until about 30 m past the line.
- **Editor auto-dress seed depends on undo history** (`editor.ts:644`). Add a seed field defaulting to the shipped seed.
- **The editor message gives the wrong grid length** (`editor.ts:493`, says 60 m; the real grid is about 35 m).
- **Start/finish tyre stacks can never be placed** (`tracks.ts:198` versus the guard at `:121`). Delete them or fix the rule and add a test.
- **The validator never checks self-overlap within 45 m of arc** (`spline.ts:236`). Exempt by heading continuity instead; low priority.

### Opportunities (unverified)
- Painted brake chevrons computed from curvature in `spline.ts`.
- Deliberately weak walls on the outside of 1-2 hairpins, opening onto a cut-through that is slower than the road, as a risk/reward feature. Do this only after X1 is fixed.
- Barrel and crate clusters at corner exits with a cluster-clear bonus.

### Dropped after verification
- "One braking zone per lap on T1": a counting artefact; re-runs give 3 zones.
- "Three races of content": already specified in GDD D2 and the reverse layouts (P0). Only mirroring is new.
- "Props too small to read": braking boards are about 10 px; cones are decoration, not guidance.

---

## 5. AI (4/10)

The AI is deterministic, solves a clean solo lap within 3% of the optimum, and rarely gets stuck. Race quality is the problem.

### Major

**A1. AI packs hit walls 50-200 times per race on t3.** Verified. The verifier corrected the cause: only about half comes from car pushes.
- Where: `src/sim/ai.ts:~207-253` (candidate lines, follow cap and `vT` ignore the wall margin; `laneMargin` 1.6; `passClearance` 2.35).
- Evidence: with car physics on, wall hits per t3 race were [192, 48, 9, 205, 103, 52]. With car-to-car collisions off but walls on, they were still about 52, and AI minimum health was down to 0.35. Solo: 0-4. The original "ghost floor 0" control was an artefact of sensor fixtures; use a filter group instead (`ai-race-verify.test.ts`).
- Fix: make the planned lateral line and the speed target respect the wall margin. In tight corners (|curvature| above 1/25 m), let the outer car lift (vT x 0.9) instead of holding alongside, and raise clearance to about 2.6 m. First milestone: 50 or fewer per race, then lower.

**A2. The lateBrake mistake is inverted: it brakes earlier and corners faster.** Verified.
- Where: `src/sim/ai.ts:184` (`aBrake *= 0.5; speedMul *= 1.1`), `scan()` at 358-359, trigger at 428.
- Evidence: braking onset moves 14 m earlier, and apex speed rises 4%. lateBrake is 45% of mistake onsets.
- Fix: `aBrake *= 1.5` and drop the `speedMul` buff. Check that the onset moves later than 147.6 m and that apex speed falls.

**A3. The difficulty ladder is weak: skill and grip barely change AI results.** Verified.
- Where: `src/sim/ai.ts:99` (`think()` gets no stats), `:174`; `carModel.ts:60`; `config.ts:168` (`skillSpeedRange` [0.86, 1.0]); `opponents.ts:49`.
- Evidence (verifier): grip level 5 changes a solo 3-lap time by only -0.04/-0.17/-0.08 s. Engine level 5 gives -2.57/-1.75 s on t1/t2 but +1.55 s on t3.
- Fix: same root fix as P3, plus pass stats into `think()` and widen `skillSpeedRange`. Re-verify with `e2e/out/audit/ai-upgrade.test.ts`.

### Minor (unverified)
- **Respawn teleports**: the AI leaves through broken walls and cannot recover. There are 0.28-0.44 respawns per t3 race, all off-road. Add off-road recovery (steer to the nearest road point, allow reverse), and respawn behind the nearest car, never ahead.
- **Aggression is nearly inert and the AI never uses the handbrake** or drift. Map aggression to dives, blocks and late-brake attacks. Let skill above 0.7 drift tight corners.
- **The speed plan reads the current lateral position, not the planned line** (`ai.ts:207, 330`). Pass the planned offset into `scan`.
- **`tests/aiPace.test.ts` crude-human test** was red at the time of the audit and locks in a mid-pack field. The suite was green at 23:23 (see area 15), so re-check it.

### Opportunities (unverified)
- AI pickup and power-up hooks: bias the line toward pads, use boost on straights, shield when a rival is close behind, with a skill-based reaction delay. Exclude boosts from the rubber-band stack. Coordinate with the power-ups agent.

### Dropped after verification
- "A perfect driver from slot 5 never wins" (critical): the proxy was the AI planner itself, not a human. What remains is a medium tuning point: about 6% lap loss in traffic. A short pass-commitment state is reasonable, but validate it with a human-like driver.

---

## 6. Race sim (5/10)

A fixed 1/120 s step with a frame clamp, seeded RNG, 0.16 ms per step with 8 cars. Lap bookkeeping is the weak point.

### Critical

**R1. Cutting across an infield gap or wall breach is credited as lap progress.** Verified (verifier: high-severity integrity bug that needs deliberate wall breaking).
- Where: `src/sim/race.ts:125-151` (progress is the delta of the nearest centre-line projection; no checkpoints). The header comment at `race.ts:2-4` and `docs/ARCHITECTURE.md:98` promise otherwise. `src/sim/ghost.ts:61-68` and `src/game.ts:323-349` accept cut laps for best lap, ghost and leaderboard.
- Evidence: on t1, a 214.6 m drive is credited 493 m; on t2, 271.2 m is credited 559.9 m; on t3, a 389.6 m drive is credited 552 m. The jump is accepted after 1 s, even at 40 m/s (`race-sim-open.json`, `race-sim-sim-cut.json`).
- Fix: 4 ordered gates per track. A gate counts only when crossed on the road (|lateral| at most halfWidth + 2 m) with per-update steps of 3 m or less. A lap needs all gates in order. Ghost recording and leaderboard submit require a gate-valid lap. Correct the header and ARCHITECTURE.md. Add tests: a t3 gap cut credits 5 m or less, and a t1 open cut credits nothing.

### Major

**R2. Hinted `nearest()` accepts an answer up to 30 m away, which is wider than t3's 21 m gap.** Verified, minor (t3 only).
- Where: `src/track/spline.ts:10-12, 101-104`; used by `race.ts`, `destruction.ts:442-447` (`surfaceAt`) and `ai.ts`.
- Evidence: on the t3 gap line, the hinted answer is 21.13 m wrong. A car on the far road reads as grass. Forward jumps of 10-50 m are credited within 1-2 steps.
- Fix: when the windowed |lateral| exceeds halfWidth + 1 m, run the global search (about 12 µs) and take the smaller result. Rejecting per-update steps over about 3 m in the tracker comes with R1.

### Minor (unverified)
- **Lap 1 timer starts at GO, so the player's first lap includes 24.5 m of grid** (about 0.6 s). Start the lap clock at the first forward crossing of s=0.

### Opportunities (unverified)
- **Live ghost delta** on the HUD (store track distance per ghost frame).
- **Gap to leader, wrong-way warning, sector splits** and a "shortcut, lap not counted" toast once gates exist.

### Dropped after verification
- "Progress freezes after a jump over 25 m": no game path produces such a jump.
- "Destruction bonus uncapped, 6x the prize": real races break 0-16 pieces (at most 96 money). GDD 9.1 already plans a cap. Folded into X2.

---

## 7. Render: world (5.5/10)

Instanced decor with culling, chunked walls, and clean disposal. Draw calls are fine (23-34 main pass, 14-21 shadow casters). Measurements are desktop Node and SwiftShader, not device numbers.

### Major (verified, most rated moderate)

**W1. Props are drawn in full every frame (42-57% of visible triangles).** Verified (also C1).
- Where: `src/render/destructibles.ts:212` (`makeChunked(..., chunk=false)` gives one InstancedMesh per prop type spanning the whole track), `:246-252`, `:211` (props cast shadows).
- Fix: `chunk=true` with the existing 44 m key. Chunks holding dynamic props keep `frustumCulled=false`, or get their bounding sphere enlarged by the travel distance.

**W2. Decor density presets deliver about half their configured share.** Verified, moderate.
- Where: `src/render/decor.ts:243` (`Math.floor(r.count * share)` over ranges of 1-2 instances).
- Evidence: low keeps 20-25% instead of 40%; medium keeps 53-61% instead of 75%.
- Fix: store `dither = rng()` per range at build time, and use `Math.floor(r.count*share + r.dither)`.

**W3. Ground texture is magnified 2.4-2.5x on the high preset while the road is 1:1.** Verified, minor to moderate.
- Where: `src/render/textures.ts:30-33` (512 px over 56 m), `trackBuilder.ts:42`.
- Fix: a 1024 px canvas (2048 on high), or tile every 28 m. Scale the stroke widths with S. Add a second variant, or a world-space detail layer, to break the 56 m repeat.

**W4. Every race rebuilds all world geometry and textures.** Verified, minor to moderate (a load stall, not a mid-race hitch; also L1).
- Where: `src/render/renderer.ts:216-269`, `game.ts:172`, `textures.ts:32, 88`, `geo.ts:35, 43`.
- Fix: cache the track visual, decor and textures per track id. Build the stand crowd as one InstancedMesh. Skip clone and normal recompute for plain boxes in `GeoBuilder.add`.

### Minor (unverified)
- **Decor culling draws about 5 off-screen instances per on-screen one** (`decor.ts:218-226`). Cull against the view rectangle and fill the caps by distance to the screen centre.
- **Destroyed static pieces stay in the instance buffer at zero scale** (`destructibles.ts:262-264`). Compact chunks on break.
- **String-length seeds repeat the same art across tracks and types** (`textures.ts:35`, `structures.ts:341, 386`, `trackBuilder.ts:129`). Use `hashString(name)`.

### Opportunities (unverified)
- Decals (tyre scuffs, painted arrows, dirt). A baked AO strip under walls. Ground-level clutter. A vertex-shader bob on the crowd. Crack and chip variants for damaged walls.

---

## 8. Render: cars and FX (4/10; about 5 once the dropped critical is removed)

Cheap and well pooled: 12 draw calls for 8 cars, a recycled debris pool, shader dents, detachable parts.

### Major

**F1. Eight identical car silhouettes; only the paint changes.** Verified.
- Where: `src/render/car.ts` (one `buildCarGeometries()`, used at `renderer.ts:48`); a blank door roundel; GDD 10.3 (lines 427-439) specifies distinct silhouettes.
- Evidence: 1,228 triangles per car, 9.8k for the fleet, against a budget of 120k in view.
- Fix: a `CarModelDef` per body family (hatch, van, open-wheeler), with one CarFleet per model present (at most 4 per race, per the GDD fallback). As a cheap first step, put a numbered atlas on the door roundel.

**F2. Cars give no transient response to a hit (no kick, squash or flash).** Verified, moderate polish.
- Where: `CarFleet.update` (`car.ts:277-363`); the impact case in `fxManager.ts:168-183`.
- Fix: a per-car damped pitch and roll spring fed from impact events (kick about 0.05 x strength rad, decay about 0.25 s), plus an 80 ms paint flash through the existing `setColorAt`. No new draw calls.

### Minor (unverified)
- **Skid trail ring shared by all 32 wheels**: under 1 s of trail with 4 cars sliding; no off-road marks. Size the ring per car, and add a grass rut mark.
- **Particle pool silently drops the newest effect when full** (`particles.ts:101`). Recycle the oldest, and reserve a share for impacts.
- **`smoothstep(1.0, uSoft, d)` with edge0 > edge1** is undefined in GLSL ES 3.00 (`particles.ts:25`). Use `1.0 - smoothstep(uSoft, 1.0, d)`.
- **Player chevron is pinned to a fixed screen side**, not the heading (`playerMarker.ts:136-143`).
- **The e2e mirror guard is a no-op**: `window.__render.sceneMirrorZ` is never set (`e2e/player-checks.mjs:91`). Steering checks cover the mirror anyway. Delete the branch or publish the value.

### Opportunities (unverified)
- Paint-scrape streaks into the skid pool on scrape events; camera-space speed streaks (PLAN WP6); grass ruts; a wreck burst with a ring and thrown parts; drift-tier smoke colour.

### Dropped after verification
- "Particle FX drawn in the unmirrored frame" (critical): already fixed in `05daa04`; `particles.ts` applies `modelMatrix`.

---

## 9. Camera and performance (5/10)

Speed zoom, velocity look-ahead, trauma shake, a texel-snapped sun and auto-quality are all present. The numbers below are SwiftShader triangle and call counts, not phone frame times.

### Major

**C1. Destructible props are never culled.** Verified, medium. This is the same item as W1: 25.2k of 94.1k triangles on t1 medium, plus the shadow pass.

**C2. The shadow pass costs about 43% of medium-preset triangles and 19 draw calls.** Verified, moderate until device-measured.
- Where: `src/render/renderer.ts:141-157`; `config.ts:241-252` (shadows on medium, `shadowExtent` 52, so a 104 m square); stands, decor trees and props all cast shadows; decor and props are not culled by the shadow camera.
- Evidence: 65 calls and 94.1k triangles with shadows, 46 calls and 53.7k without.
- Fix: no shadows from stands and decor trees on medium (use the blob contact shadow); car-only shadows on medium; derive `shadowExtent` from the rig radius plus a margin; chunk props (C1).

**C3. Auto-quality is a one-way ratchet, and each step down recompiles shaders.** Verified, moderate.
- Where: `renderer.ts:176-188` (`trackFps` only steps down), `:157` (`mats.refresh()` sets `needsUpdate` on all materials), `:121-129` (`guessLevel`: 4 cores or fewer means low).
- Evidence: after 5 s at 30 fps, medium drops to low with 18 to 28 programs (a compile burst while already slow), then stays low at 60 fps.
- Fix: step up after about 20 s with p95 frame time under 18 ms, with a cooldown. Keep `shadowMap.enabled` constant and toggle `castShadow` instead, or precompile both variants. Drop `mats.refresh()`. Consider continuous dynamic resolution.

**C4. The renderer draws full frames while paused, on results, in ads and during the tutorial.** Verified, moderate.
- Where: `src/game.ts:367-401` calls `renderer.frame(..., 0)` every rAF; `renderer.ts:313-384` has no early-out.
- Fix: when `frameDt === 0` and nothing is dirty, skip `gl.render` and the CPU updates. Redraw on the first frozen frame, on resize and on quality change (mark dirty from the ResizeObserver). Or cap non-live rendering at about 10 fps.

### Minor (unverified)
- **Per-frame allocations, about 85 KB render-owned** (`decor.ts:221-233`, `car.ts:282-306`, `fxManager.ts:317-318`, `particles.ts:100-110`). Hoist closures and arrays; check the hash before allocating.
- **MSAA on top of a supersampled pixel ratio** (`renderer.ts:73`; about 42 MB of samples on high at DPR 2). Disable antialias when the effective pixel ratio is 1.5 or more; verify on a device.
- **Shadow frustum just misses the corner of a tall-phone portrait view at top speed** (52.3 m against 52 m). Derive it from the rig radius.
- **Wheels (160 triangles each) and stands are over-detailed** for about 15 px on screen. Use 8-segment wheels and no shadows on stands.
- **Dead code and waste**: `fore` computed then voided (`camera.ts:81, 90`); full particle buffer upload every frame (`particles.ts:144`, use `addUpdateRange`); skid draw range not limited; `resize` resets the canvas twice.

### Dropped after verification
- "Portrait framing makes the car too small": 47 px is deliberate and normal, and the fix would cut forward view below 1 s.
- "Look-ahead clamp depends on travel direction": stale values; a heading-up camera conflicts with the decided fixed orientation (REQUIREMENTS.md:39).

---

## 10. UI flow (5/10)

Visual polish is strong. Nothing is clipped at 390x844, 844x390, 600x600 or 1280x720 in EN or RU, and all touch targets are at least 44 px. Retention and feedback are weak.

### Major

**U1. The results screen has no Race again or Retry; a retry costs 3 taps plus an interstitial.** Verified.
- Where: `src/ui/ui.ts:677-715` (`renderResults` has only double-reward and continue), `:470`; `src/game.ts:297-303` (`continueAfterResults` shows an interstitial, then `toMenu()`).
- Fix: a primary `data-act="retry"` button calling `leaveRace(() => startRace(trackId))` (the pause-restart path at `game.ts:121`), a Next track button when `r.unlocked` is set, and Continue as the secondary action. Skip or frequency-cap the interstitial on retry.

**U2. Results do not show destruction, the place prize, or standings.** Verified, arguably moderate.
- Where: `ui.ts:32-36` (`ResultsData`), `game.ts:339, ~355` (only the total is passed on), `economy.ts:45-51`.
- Fix: add `brokenByPlayer` and the place prize to `ResultsData`. Show rows "Smashed N: +6N" and "Place prize", plus a top-3 and the player's row with gap.

**U3. No feedback on lap completion, and on portrait phones the Last lap is hidden.** Verified, moderate. This is the same item as H6.
- Where: `game.ts:442-450` (`handleEvents` handles only finish and pickup); `ui.ts:176` (final-lap toast only); `ui.css:597` (`.laps span:first-child{display:none}` under 520 px).
- Fix: on each player `lap` event, show a 1.5 s pill "LAP n m:ss.cc ±delta" (purple for a new best) with a short sound. Keep Last visible with shorter labels.

**U4. The first race is frozen behind the tutorial sheet for up to 10 s.** Verified, moderate.
- Where: `ui.ts:300` (`tutorialSeconds*1000 + 4000`, a magic number), `game.ts:179-180, 379` (`tutorialHold` freezes the countdown).
- Fix: run the countdown and show the sheet as a non-blocking hint that hides on the first input or at GO + 3 s. Move the timing into CONFIG.

**U5. Touch steering jumps on press when the GAS finger lands off-centre.** Verified. This is the same item as H1 (see area 11).

### Minor (unverified)
- **HUD labels at 8.7-10.7 px** (`ui.css:347, 366, 368`). Set a 12 px floor.
- **Garage and settings remount the whole screen on every tap**, replaying the 0.28 s entrance animation (`ui.ts:320-323`). Apply `scr-in` only in `enter()`.
- **The "Final lap!" toast re-fires after pause and resume** (`ui.ts:141` resets `lastLapShown` in `showHud`). Reset it only in `startRace`.
- **REPAIR 20 chip appears for trivial damage** (`economy.ts:54-56`). Show it only below about 75% health.
- **Portrait garage hides the stat labels** (`ui.css:241`). Keep short labels.
- **Track cards and the repair widget are focusable but not keyboard-operable**. Add Enter and Space handling.
- **The landscape and desktop tutorial sheet covers the speed readout and touches GAS**. Move it to the top.
- **The build label renders in production** (`index.html` `#ver`, `vite.config.ts`). Show it in DEV or with `?debug` only.

### Opportunities (unverified)
- A finish banner during the 2.5 s finishing delay; a POS pulse on change; "You passed X" callouts.
- A "+6" coin float on each player break and a running smash counter.
- A 3-2-1 resume countdown after pause, with GAS lifted first.
- Skip the interstitial on Restart (Bridge frequency caps apply anyway).
- A leaderboard button per track, Replay tutorial, a GAS left-hand mode, a steering sensitivity slider, and a quick-race card.

---

## 11. HUD and input (4/10)

The HUD is tidy at 320x568 and 390x844, and the GAS-thumb model is a good base. The one-finger control has real defects.

### Major

**H1. A GAS touch landing off-centre steers immediately (touch-down jump).** Verified (also U5).
- Where: `src/input/input.ts:45-61` (`steerAxis`), `:258-266` (GAS home = button centre); `config.ts:~371-374` (`steerDeadZone` 0.025, about 10 px at 390 px); `tests/inputGeometry.test.ts:24-30` tests only the exact centre.
- Evidence (re-run): at 390x844, landing 25 px right of centre gives +0.26 to +0.35 and 46 px right gives +0.80. Landscape 25 px gives +0.12 and 40 px gives +0.59.
- Fix: `homeX = e.clientX` at pointerdown for GAS fingers, clamped to the middle of the button, plus a dead band of about 0.25 button sizes. Keep `homeY` deliberate for the brake pull and item flick. Test that touch-down at ±0.25 and +0.45 button sizes gives |steer| under 0.05.

**H2. Auto-gas: a 41 px downward drift of any steering thumb brakes the car.** Verified, moderate to major (auto-gas is opt-in, but it is the casual one-finger mode).
- Where: `input.ts:133-135, ~316`; `config.ts:377` (`brakePull` 0.4 x size).
- Fix: in auto-gas, brake only on a deliberate pull: |dy| > 2|dx|, at least 1 button size, held 0.15 s. Slowly re-anchor `homeY` while the finger is not pulling. Or use a dedicated bottom brake strip.

**H3. The HUD has no gap to the car ahead or behind and no minimap.** Verified, already planned (GDD 20.6, lines 1082 and 1086; PLAN WP9), not built.
- Fix: implement WP9. Use a pure, unit-tested `gapSeconds(progAhead, progMe, speed)` and a minimap from the existing track samples. A live delta against the best lap is an optional extra. Coordinate with the agents editing `src/ui/*`.

**H4. Lap time is hidden on phones and no lap is announced.** Verified, moderate. Same item as U3.

**H5. The HUD timer runs about 2.5 s past the finish line, so it disagrees with the results.** Verified, moderate.
- Where: `race.ts:83` (`time` counts until finalize), `:154-158` (frozen `finishTime`); `game.ts:329-358` (2.5 s `resultsDelay`); `ui.ts:179` (timer shows `race.time`).
- Fix: in `updateHud`, show `p.finishTime` once `p.finished`. Show a FINISH banner with place and time at the crossing.

### Minor (unverified)
- **The repair chip shows for any scratch, looks actionable when unaffordable, and repairs on one tap.** Follow GDD 20.6: show it only below 70% health, greyed with "Need N more" when unaffordable, and require a hold or a second tap in race.
- **The lap and best line is the smallest HUD text** (11.9 px at 320 px). Make it at least 16 px on a panel.
- **Linear steering curve with short travel.** Use a gentle curve and about 0.14-0.16 W of travel, tuned on a real device with a recorded steer trace.
- **PC mouse and gamepad are ignored** (`input.ts:251` returns for mouse). Add the Gamepad API and mouse hold on GAS.
- **The pull-down brake is never taught**, and the stuck toast says "Hold brake" without explaining how. Add a touch tutorial line and a brake-zone mark under GAS.

### Opportunities (unverified)
- A self-trimming neutral, so the steering home drifts toward a resting thumb.
- A next-corner cue ("HAIRPIN LEFT 40 m") from precomputed curvature.

### Dropped after verification
- "Steering is asymmetric left versus right": the current code is symmetric.
- "Manual mode: stray fingers steer and brake": documented design; throttle never comes from a stray finger.
- "Phones cannot drift; the tutorial has 3 steps": the DRIFT button and drift tutorial step exist.

---

## 12. Meta and economy (4/10)

The pure economy layer is well tested (43 tests). Persistence can lose a save, and the economy is thin.

### Critical

**M1. A failed or timed-out storage load is treated as a new player, and the next write replaces the real save.** Verified (same as PL1).
- Where: `src/platform/bridge.ts:60-65, 138-152` (`withTimeout` swallows rejection; `load` returns nulls on timeout, error or not-ready); `src/meta/save.ts:29-32, 117-127` (corrupt JSON becomes null, then `defaultSave`); `src/game.ts:81` (boot ignores the status) and the unconditional writes at `game.ts:130, 234, 248, 261, 273, 347`.
- Evidence: `meta-economy/save-audit.test.ts`. Stored money 5000, engine 3, 30 races; after one failed get and one race, the store holds money 900, engine 0, 1 race. Re-run by the platform verifier: load resolved after 8005 ms with nulls, and the next save wrote `sc_core`.
- Fix: `platform.load` returns `{status: ok|empty|failed|corrupt}`, where "empty" means the key is genuinely absent. Block `writeSave` until the status is ok or empty. On failure, retry with backoff behind a "progress not loaded, retry" state. Back up the previous core record to `sc_core_prev` and corrupt JSON to `sc_core_corrupt`. Add tests with a throwing get and an unparseable record.

### Major

**M2. Writes have no timeout, one hung `storage.set` blocks every later save, and failed writes are not retried.** Verified, minor to moderate (each write is a full snapshot, so the next success heals it).
- Where: `save.ts:170-181` (promise chain), `bridge.ts:155-166` (no timeout on save), `game.ts:102-105` (no flush on hide).
- Fix: wrap `platform.save` in `withTimeout` (about 8 s, resolving false). Coalesce to one in-flight write plus the latest snapshot.

**M3. No schema version check or migration: a newer save is stripped by an older build.** Verified, minor to medium (no v2 exists yet).
- Where: `save.ts:12, 97` (version literal 1; `sanitizeSave` ignores the stored version).
- Fix: before the first schema bump, add `CONFIG.save.schema` and a migrate chain. Open read-only when the stored version is newer. Preserve unknown keys.

**M4. The grip upgrade does not change cornering.** Verified. Same as P3; 8,050 money buys about 0.2-0.6 s per race.

**M5. Upgrades buy little speed, the AI copies 35% of it back, and the top levels cost 15x.** Verified, but the verifier's re-run gives smaller gains than reported (engine L5 -2.57/-1.75/+1.55 s), and the place difference (5.53 to 4.97) is within noise.
- Where: `config.ts:213-219` (costs 250/600/1200/2200/3800), `:347` (`followPlayer` 0.35); `opponents.ts:51-81`; `economy.ts:20-29`.
- Fix: after P3 lands, flatten the costs, add a perk or placement gate at L3 and L5, lower `followPlayer` toward 0.1 or make it per track, and show the expected lap-time gain in the garage. Re-measure with a human-like bot before retuning.

### Minor (unverified)
- **Repair is linear and uncapped**, so damage barely costs winners. Escalate the price per repair within a race. Overlaps D4.
- **Armor pays back in money only after about 200 races.** Show "damage taken -47%" in the garage.

### Opportunities (unverified)
- Keep the pure economy layer and the ghost serialisation (43 KB of a 240 KB cap); build the persistence fixes on top.

### Dropped after verification
- "Destruction bonus is uncapped" (major): a demolition bot nets less than repair costs; minor at most. Folded into X2.
- "Track multiplier does not reward harder tracks": the destruction bonus and fast early upgrades offset it.
- "The meta ends after about 150 races": the 5-league career, cosmetics, dailies and Time Attack are fully specified in the GDD and PLAN WP7/WP8. It is a build gap, not a design gap.

---

## 13. Platform: Playgama (4/10)

The Bridge is first in head, init and config are present, all saves go through Bridge storage, rewarded pays only on "rewarded", and there are no external URLs. Not checked: device and stability items (1.4, 1.5, 1.7, 3.1), the title against the publication request (3.5.1), and launch state.

### Critical

**PL1. Progress can be overwritten with defaults after a slow or failed storage read.** Verified. Same as M1.

**PL2. All shipped audio is code-synthesized (Playgama 3.3.2).** Verified, release gate. See AU1.

### Major

**PL3. The game throws at boot when a Bridge ad is already open.** Verified.
- Where: `src/game.ts:82` registers `platform.watchAds` before `this.audio` is created at `:86`; `bridge.ts:203-206` pushes synchronously; `syncPause` at `game.ts:317` calls `this.audio.setPaused`.
- Evidence: `e2e/out/audit/watchads-boot.mts` prints `TypeError ... reading 'setPaused'`, and `main.ts` shows "Boot failed".
- Fix: create audio, renderer, UI and input before registering platform handlers. Guard `syncPause` and `applyMute` with `if (!this.audio) return`. Defer the initial push with `queueMicrotask`.

**PL4. The SaaS public token placeholder ships, so leaderboard scores are silently lost.** Verified, release task (WP17, GDD 17.5).
- Where: `public/playgama-bridge-config.json:12` (`REPLACE_WITH_GAME_PUBLIC_TOKEN`; the `saas.leaderboards.platforms` list includes playgama); `bridge.ts:257-260` swallows the failure.
- Fix: add the test the GDD promises, failing on `REPLACE_WITH` in the config. At WP17, create the boards and insert the real token. The config lists 3 boards and the GDD wants 10.

**PL5. A slow Bridge init fixes the language to English and calls the SDK before `initialize()` resolves.** Verified, moderate.
- Where: `bridge.ts:104-108` (8 s timeout sets `ready = true`), `:119-121`; `game.ts:80-87`.
- Evidence: the platform `language` getter throws before init, and the code falls back to 'en'. `storage.get` called early fails silently, which feeds M1.
- Fix: set `ready` only on real init (`b.isInitialized`). If a timeout is kept, re-run load, `initLang` and listener setup when init completes late. Never write defaults over an unloaded save.

**PL6. The leaderboard is write-only: no ranking is ever shown.** Verified.
- Where: `bridge.ts:39-42, 250-260` (no `getEntries`); nothing in `src/ui`. GDD 17.4, 17.5 and 20.12 require a Records tab (PLAN WP11 acceptance 8).
- Fix: add `getEntries` (cached per session, guarded by availability) and a per-layout top-10 with the player's row highlighted. Also check that only valid laps are submitted (GDD 17.5: Time Attack only, no respawn, at most once per session); `game.ts:348` currently submits any new best lap.

### Minor (unverified)
- **`?debug` enables debug hooks for every player**, and `forceFinish` grants rewards and unlocks (`game.ts:437-463`). Gate it on `import.meta.env.DEV`. `tests/gameFlow.test.ts:308-318` locks the current behaviour in, so update it.
- **The build label is visible in production** (`index.html:25`).
- **`initialInterstitialDelay` 30 has no recorded reason** (`playgama-bridge-config.json:4`).
- **Save and lifecycle gaps**: `flushSave` is never called on hide or pagehide, platform pauses do not reach `level_paused`, and `platform.isPaused` is never read after subscribing.

### Opportunities (unverified)
- `preloadOnStart` for the interstitial and rewarded ads, with declared placements.
- Bridge achievements, daily rewards, notifications, remote config, and ghost share links through `platform.payload`.

### Dropped after verification
- "Repeated skipped interstitials freeze for 5 s": the SDK goes through LOADING before each refusal, so "failed" is emitted every time.
- "An ad that never reports closed latches hard pause": no demonstrated trigger; low-priority hardening only.

---

## 14. Audio (3/10)

The lifecycle architecture is sound: suspend on pause, ads and hidden tab, mute at boot, ducking, voice caps. These pass on code reading: SDK step 5, 2.1.6, 3.3.3, 3.3.4. 3.3.5 is partial (the iOS resume is unverified). 3.3.2 fails. As shipped, the audio is weak.

### Critical

**AU1. All shipped sound is code-synthesized, and the music is a 6.9 s loop.** Verified. Publish blocker.
- Where: `public/sfx/*` (31 names, ogg and mp3), `scripts/make-sfx.sh`, `scripts/make-impacts.mjs`, `docs/AUDIO.md` (STATUS: placeholders; licence table "NOT ALLOWED FOR PUBLISHING").
- Evidence: music.ogg is 6.857 s, against the 60-120 s loop in AUDIO.md:27. Peaks over the -3 dBFS target: finish 0.0, go -0.1, buy -0.4, click -1.4 dBFS.
- Fix: the owner sources recorded CC0 or licensed audio under the same names, with a seamless 60-120 s music loop and peaks at or below -3 dBFS, and fills in the licence table. Add a prebuild check that fails while AUDIO.md says PLACEHOLDER or a sfx name has no licence row (GDD 1212-1213 asks for it). Never re-run `make-sfx.sh` after that.

### Major

**AU2. The impact gate is per frame and first-come, so the player's own crash is silenced by an earlier AI hit.** Verified.
- Where: `src/audio/audio.ts:408-413` (`gate` against a clock that advances once per frame), `:425` (one global 'impact' key); `config.ts:360` (0.07 s); `game.ts:385-390`.
- Evidence (`e2e/out/audit/audio-gate.cjs`): with [AI hit at 22 m, own hit] in one frame, only the AI hit plays (vol 0.19). Alone, the own hit plays at 0.70. In a pile-up, a 0.2 wall tap wins over hits of 1.0, 0.95 and 0.6.
- Fix: collect a frame's impact candidates, sort own car first and then by strength, and play the top 2-3. Give own-car events their own gate key. Gate on sim time. Turn the probe batches into `tests/audio.test.ts`.

**AU3. The glue compressor on the impact bus flattens strong hits.** Verified.
- Where: `audio.ts:126-127` (threshold -16, ratio 5), `:405`.
- Evidence (real Chromium OfflineAudioContext, `audio-comp.json`): the car-hit peak rises 2.11 dB from strength 0.3 to 1.0 with the compressor and 6.70 dB without. From 0.6 to 1.0 it rises 0.78 dB, so every hit from about 100 km/h upward sounds the same.
- Fix: keep the impact bus linear with per-family calibration, and add a master limiter near -1 dBFS (needed, since an s=1 car hit peaks at -0.91 dBFS). Widen the level curve to 14-20 dB. Target at least 5 dB of rise from 0.3 to 1.0.

**AU4. The engine and music loops click at the loop point.** Verified.
- Where: `scripts/make-sfx.sh:25` (`alimiter` lookahead shifts the signal), `:31, :63`; `audio.ts:179-219` (`loop = true`, no crossfade).
- Evidence (`e2e/out/audit/wrap.sh`): engine.ogg wraps with a 0.2015 jump, 53x the median step and 2.5x any internal step. music.ogg wraps with 0.0521.
- Fix: remove `alimiter` from loop renders, or crossfade the last 30-50 ms into the head. Add a wrap-step check. Recorded replacements need the same crossfade.

**AU5. The engine is one sample pitch-shifted across up to 2.6x.** Verified, moderate (the gears limit the in-play range to 0.8-2.1x; one gear spans 1.75x).
- Where: `config.ts:357` (`engineRateMin` 0.55, `engineRateMax` 2.1), `audio.ts:285-291`.
- Fix: with the recorded audio, 2-3 rpm layers (idle, mid, high) crossfaded by rpm, each pitch ratio at most 1.5x, plus on-throttle and off-throttle layers.

### Minor (unverified)
- **The AudioContext may not recover on iOS after an interruption** (`audio.ts:136` resumes only when the state is 'suspended'). Resume whenever the state is not running or closed, and listen to `onstatechange`.
- **Dead API and config**: `setMusic`, `musicWanted`, `scrapeMinInterval`, `pausedDuck`.
- **Voice accounting leaks if `start()` throws**, and the global cap drops UI and finish cues before any stealing. Increment after a successful start and reserve voices for UI.
- **No test covers the AudioManager event mapping** (`gameFlow.test.ts` mocks it).
- **Music and engine wait for all 31 decodes**; music is fully decoded in memory. Start each loop when its own buffer is ready, and stream music through a media element.
- **Lap and final-lap cues are missing.** The power-up events play placeholder pitched reuses of other samples (`audio.ts:357-386`).

### Opportunities (unverified)
- Surface sounds (grass, curb, broken road); stereo panning; pass-by engine sound for AI cars within about 30 m; a gear-shift blip; adaptive music layers and a results stinger.

### Dropped after verification
- "Six sim event types produce no sound": stale. Only `lap` is still silent (listed under Minor).

---

## 15. Tests and quality (4/10)

There are 380 tests in a broad suite. At 23:23 the verifier ran 24/24 files and 380/380 tests, all passing, on HEAD `c36f477`. Typecheck passes.

### Major

**Q1. The smash-counter test cannot fail, and its scenario produces no player breaks.** Verified.
- Where: `tests/sim.test.ts:245-258` (only `<= broken` and `>= 0`); the counter feeds `raceReward` (`game.ts:339`).
- Evidence (verifier, t1 seed 3, 40 s): 6 breaks, `brokenByPlayer` 0.
- Fix: make the player the last hitter on one wall segment through `recordHit` (the pattern from the "AI recovers from a smashed wall" test). Assert `brokenByPlayer === 1`, and assert that it is unchanged after an AI-caused break.

**Q2. The release gate is not wired to any script or CI, and its Playwright dependency is undeclared.** Verified, medium.
- Where: `package.json` (no `player-checks` script; `deploy` only builds and copies); no `.github/`; `node_modules/playwright` is a symlink to a global; `e2e/player-checks.mjs:12`, `e2e/run.mjs:6`.
- Fix: add playwright as a devDependency and an `e2e:player` script. Make deploy run `typecheck && test && build && e2e:player`. Add a GitHub Actions workflow with the same chain.

### Minor (unverified)
- **E2E checks read state right after fixed sleeps**, and the server start is a blind 2.5 s wait with stdio ignored. Use `waitForFunction`, and read preview readiness from stdout.
- **Wall-clock budgets and 10 ms timer waits in unit tests** (`destruction.test.ts:401`, `world.test.ts:291`, `platformMessages.test.ts:60`, `save.test.ts:89-92`). Use count budgets and `await flushSave()`.
- **Ghost tests cascade and use non-null assertions** (`sim.test.ts:324-353`). Memoise `botRace` and assert the precondition first.
- **Copy-pasted fixtures and casts into private fields** (two `carState` helpers, nine `as unknown as` casts). Create `tests/helpers/fixtures.ts`.
- **Dead config and exports** (`items.fx`, `audio.pausedDuck`, `ui.countdownPopMs`, `physics.curbSlowdown`, `FRONT_ZONES`, `carLocalToWorld`, `CAR_DIMS`, `src/fx/index.ts`). Check that `items.fx` is not pending power-up wiring before deleting it.
- **`?debug` on any host is locked in by a test** (see area 13). The comment at `game.ts:39` cites a missing `e2e/feel.mjs`.
- **docs/REQUIREMENTS.md:35 still says 0-100 km/h in about 4.1 s**, while config and tests use 2.5 s.

### Opportunities (unverified)
- Mutation testing (Stryker or a short hand-made mutant list) on `carModel`, `damage` and `destruction`. A seeded replay corpus per track.
- CI with screenshot baselines for menu and HUD at 390x844, driven by `setTimeScale` rather than sleeps.

### Dropped after verification
- "Zero-assertion probes dominate runtime": the zz files are now placeholders, staged for deletion.
- "Suite red at HEAD": green at 23:23 on `c36f477`.
- "Balance tests hard-code churning snapshots": the titles are fixed; only REQUIREMENTS.md is stale (listed above).
- "Silent-pass checks in the release gate": the mirror is covered by the steering sign checks. The missing repair assertion is folded into Q2 follow-ups.
- "Player-visible code paths with no checks" (major): the save failure is logged and self-heals on the next write; at most minor.

---

## 16. Loading and bundle (4/10)

The build shape is sound: one main chunk (1.01 MB raw, about 267 KB gzip), 8 KB gzip CSS, the editor excluded, GPU object counts stable across restarts. Measured in headless Chrome on SwiftShader, so only CPU and timeline numbers count.

### Major (verified, most rated moderate)

**L1. Race start rebuilds the whole track and freezes the main thread.** Verified, moderate to major.
- Where: `renderer.ts:226-272` (`loadRace`, synchronous, ending in `gl.compile`); `trackBuilder.ts:43, 82`; `decor.ts:84-110`; `renderer.ts:116-118` (`metresPerPixel` reads `clientWidth` at start and on every frame at `:374`).
- Evidence (`e2e/out/audit/scripts/verify-restart.mjs`, five consecutive starts): 283/135/130/192/155 ms at 1x CPU and 840/466/412/347/376 ms at 4x. The first start includes the program links.
- Fix: cache the per-theme decor geometry and the per-track visual and textures. Cache the canvas size in `resize()`. Prebuild while track select is open, or slice the work across frames behind the transition. Together with W4.

**L2. Shaders link synchronously on first use.** Verified, minor to moderate (`gl.compile` at race start does issue the links up front; the boot path does not).
- Where: `renderer.ts:272`, `:277-286` (the menu renders with no precompile).
- Fix: `gl.compile` or `await gl.compileAsync(scene, camera)` behind the boot overlay before the first menu frame. Use `compileAsync` in `loadRace`, started during track select or the countdown. Set `checkShaderErrors = import.meta.env.DEV` as a small extra.

**L3. Cold boot is serial: the Bridge and the save gate the renderer, and track props are generated at import.** Verified, moderate.
- Where: `game.ts:80-93`; `main.ts` (static import of `./game`); `tracks.ts:82-83, 124, 234-236, 263` (896 props through an unhinted brute-force `nearest()`, about 98 ms native).
- Fix: a tiny entry module that starts `platform.init()` and dynamic-imports `./game`, so the Bridge handshake overlaps the download. Build the renderer and UI shell with default quality before the save resolves. Bake props into data, or generate them lazily, and use a hinted search.

**L4. The synchronous Bridge script and the render-blocking CSS delay first paint.** Verified, minor.
- Where: `dist/index.html` (the Bridge script is first in head, before the boot style); `vite.config.ts:18`.
- Evidence: first contentful paint 700 ms, 524 ms with the Bridge deferred, 320 ms with non-blocking CSS as well. Game-ready moves only 166 ms.
- Fix: move the inline boot style and the `#boot` markup ahead of the Bridge script (safe). Consider `defer` only after checking Playgama's loader rules.

### Minor (unverified)
- **MSAA on every preset** (`renderer.ts:73`). Choose antialias from the tier guess at context creation. Same as the camera-perf minor.
- **The menu renders the 3D scene every display frame.** Cap it at 30 fps or render on demand.
- **`chunkSizeWarningLimit: 1500` hides bundle growth.** Remove it and add a gzip budget script (about 280 KB).
- **Bridge loader: local copy (105 KB gzip, all adapters) versus CDN** is an owner decision. Fill in `publicToken`.
- **All 31 samples decode in one burst at the first tap** (155 ms and 103 ms tasks at 4x), and mp3 is shipped but never fetched by Chromium. Split the menu and race sets, and precompute the trim gains offline.

### Opportunities (unverified)
- A branded CSS-only boot screen with progress steps.
- Measure the first 200 ms of menu frame time to pick the quality tier.
- three.js and planck are about 70% of the bundle. Budget it, but no cheap win exists.

---

## Cross-area duplicates (one fix each)

| Topic | Areas | Fix owner |
|---|---|---|
| Grip stat ignored by cornering | 1 (P3), 5 (A3), 12 (M4) | sim |
| Save overwritten after a failed load | 12 (M1), 13 (PL1, PL5) | meta/platform |
| Synthesized audio | 13 (PL2), 14 (AU1) | owner plus audio |
| t3 cut credited | 3 (X1), 6 (R1, R2) | sim/track |
| Props unculled | 7 (W1), 9 (C1) | render |
| Race-start rebuild | 7 (W4), 16 (L1, L2) | render |
| Lap feedback and hidden Last | 10 (U3), 11 (H4) | UI |
| Touch-down steer jump | 10 (U5), 11 (H1) | input |
| Destruction payout | 3 (X2), 6 and 12 (dropped as majors) | economy |
| `?debug` in production, build label | 10, 13, 15 | platform |
| MSAA on all presets | 9, 16 | render |

---

## Top 25 actions

Ranked by player impact divided by effort. Effort: XS under 1 h, S half a day, M 1-3 days, L a week or more or owner-sourced. Items marked **[blocker]** must ship before publication whatever their rank.

| # | Action | Area | Files | Effort |
|---|---|---|---|---|
| 1 | **[blocker]** Real load status: `platform.load` reports ok, empty, failed or corrupt; `ready` only on a real Bridge init; block `writeSave` until loaded; retry with backoff; back up `sc_core`; re-run `initLang` on a late init. Add a timeout to `platform.save`. | meta-economy, platform | `src/platform/bridge.ts`, `src/meta/save.ts`, `src/game.ts`, `tests/save.test.ts` | S |
| 2 | Fix the boot crash with an ad already open: create audio, renderer and UI before `watchAds`, and guard `syncPause` and `applyMute`. | platform | `src/game.ts`, `src/platform/bridge.ts` | XS |
| 3 | Results: primary **Race again** button (pause-restart path) and **Next track** when unlocked; no interstitial on retry. | ui-flow | `src/ui/ui.ts`, `src/game.ts` | XS |
| 4 | GAS touch-down sets steering home to the landing x, with a dead band of about 0.25 button sizes; add tests for off-centre landings. | hud-input, ui-flow | `src/input/input.ts`, `src/config.ts`, `tests/inputGeometry.test.ts` | S |
| 5 | Lap and finish feedback: a lap pill with time and delta plus a chime on each player lap; keep Last visible on phones; freeze the timer at `finishTime`; FINISH banner with place; stop the final-lap toast re-firing. | hud-input, ui-flow, audio | `src/game.ts`, `src/ui/ui.ts`, `src/ui/ui.css`, `src/audio/audio.ts`, `src/i18n.ts` | S |
| 6 | Impact audio priority: own car first, then by strength; top 2-3 per frame; separate gate key for the own car; add `tests/audio.test.ts` from the probe batches. | audio | `src/audio/audio.ts`, `tests/audio.test.ts` | S |
| 7 | Chunk props for culling (`chunk=true`), with care for chunks holding dynamic props. Cuts about 25k triangles plus shadow redraws. | render-world, camera-perf | `src/render/destructibles.ts` | XS |
| 8 | **[blocker]** Gate-based lap progress (4 ordered on-road gates, steps of 3 m or less), gate-valid laps only for ghost and leaderboard, and indestructible walls facing near-parallel track legs (the t3 mouth); geometric fallback in `nearest()`. | race-sim, destruction, tracks | `src/sim/race.ts`, `src/sim/destruction.ts`, `src/track/spline.ts`, `src/track/tracks.ts`, `src/sim/ghost.ts`, `src/game.ts`, `tests/race.test.ts`, `docs/ARCHITECTURE.md` | M |
| 9 | Make grip matter: scale the lateral limit by `stats.grip/baseGrip` in the car model, the drift model and the AI planner; pass stats into `think()`; widen `skillSpeedRange`; add a test that grip L5 is at least 10% faster in corners. | physics-car, ai, meta-economy | `src/sim/carModel.ts`, `src/sim/ai.ts`, `src/config.ts`, `tests/carModel.test.ts` | S |
| 10 | Fix the inverted lateBrake mistake (`aBrake *= 1.5`, no speed buff). | ai | `src/sim/ai.ts` | XS |
| 11 | Car hit reaction: a damped pitch and roll kick plus an 80 ms paint flash on impact events. | render-cars-fx | `src/render/car.ts`, `src/fx/fxManager.ts`, `src/render/renderer.ts` | S |
| 12 | Smash payoff: results rows (Smashed N +6N, place prize, mini standings), an in-race "+6" float and smash counter, and pay per kind or by HP so cones pay nothing (per GDD 9.1 cap). | ui-flow, destruction | `src/ui/ui.ts`, `src/game.ts`, `src/meta/economy.ts`, `src/sim/sim.ts`, `src/config.ts` | S |
| 13 | Impact layer for collisions: separate impact velocity and spin that grip and yaw damping never erase, plus a 0.25-0.4 s impact state after heavy hits. This is the core crash feel. | physics-car | `src/sim/carModel.ts`, `src/sim/car.ts`, `src/sim/ai.ts`, `tests/carModel.test.ts` | M |
| 14 | Damage readability: effect chips and toasts from `computeEffects`, a stored `pullDir` (no default-right pull), and a grip floor of about 0.3 in the main path. | damage, hud-input | `src/sim/damage.ts`, `src/sim/carModel.ts`, `src/ui/ui.ts`, `src/i18n.ts` | S |
| 15 | Auto-gas brake only on a deliberate vertical pull held 0.15 s, with homeY re-anchoring; teach the pull-down brake in the touch tutorial. | hud-input | `src/input/input.ts`, `src/config.ts`, `src/ui/ui.ts`, `src/i18n.ts` | XS |
| 16 | Non-blocking first-race tutorial: the countdown runs, the sheet hides on first input; timing in CONFIG; move the landscape sheet off the speed readout and GAS. | ui-flow | `src/ui/ui.ts`, `src/ui/ui.css`, `src/game.ts`, `src/config.ts` | S |
| 17 | Renderer idle and quality: skip `gl.render` when frozen and not dirty; auto-quality step-up with a cooldown; toggle `castShadow` instead of `shadowMap.enabled`; no `mats.refresh()` on a drop. | camera-perf | `src/render/renderer.ts`, `src/render/materials.ts`, `src/game.ts` | S |
| 18 | Audio mix: remove the impact-bus compressor, add a master limiter near -1 dBFS, widen the level curve, and remove `alimiter` and crossfade loop ends to kill the loop clicks. | audio | `src/audio/audio.ts`, `scripts/make-sfx.sh` | S |
| 19 | Damage fairness: plow-through ramp (no cliff) with a non-decreasing sweep test, and per-(car, piece) impulse accumulation over 0.05-0.1 s for glancing hits; re-tune `impulseToDamage`. | damage | `src/sim/car.ts`, `src/sim/damage.ts`, `src/sim/sim.ts`, `src/config.ts`, `tests/plow.test.ts` | M |
| 20 | Scrape wear by proximity and tangential speed, with sparks on the same gate, plus a physical graze test. | destruction | `src/sim/destruction.ts`, `src/sim/sim.ts`, `src/fx/fxManager.ts`, `tests/crashTuning.test.ts` | M |
| 21 | Repair as a decision: in-race repair only while nearly stopped (2-3 s hold), with a cooldown or cap; instant repair from pause and results only; hide the chip below the threshold. | damage, ui-flow | `src/game.ts`, `src/ui/ui.ts`, `src/meta/economy.ts`, `src/config.ts` | S |
| 22 | AI packs: wall margin in the planned line and speed target, outer-car lift in tight corners, clearance 2.6 m; off-road recovery instead of a forward teleport. | ai | `src/sim/ai.ts`, `src/sim/sim.ts` | M |
| 23 | Race-start and boot speed: cache track visual, decor and textures per track; `compileAsync` behind the boot overlay and during track select; Bridge init in parallel with code download; lazy or baked props; boot style ahead of the Bridge script. | render-world, loading-bundle | `src/render/renderer.ts`, `src/render/trackBuilder.ts`, `src/render/decor.ts`, `src/render/textures.ts`, `src/main.ts`, `src/game.ts`, `src/track/tracks.ts`, `vite.config.ts` | M |
| 24 | Release gate: Playwright devDependency, `e2e:player` script, deploy runs `typecheck && test && build && e2e:player`, a GitHub Actions workflow; prebuild checks for `REPLACE_WITH` and audio placeholders; `?debug` and the build label DEV-only; fix the vacuous smash-counter test. | tests-quality, platform | `package.json`, `.github/workflows/ci.yml`, `e2e/player-checks.mjs`, `scripts/check-release.mjs`, `src/game.ts`, `index.html`, `vite.config.ts`, `tests/sim.test.ts`, `tests/gameFlow.test.ts` | S |
| 25 | **[blocker]** Replace all synthesized audio with recorded CC0 or licensed files (60-120 s music loop, layered engine, lap chime and power-up sounds), fill in the licence table, insert the real SaaS token, and build the leaderboard view (`getEntries` top-10). | audio, platform | `public/sfx/*`, `docs/AUDIO.md`, `public/playgama-bridge-config.json`, `src/platform/bridge.ts`, `src/ui/ui.ts` | L (owner) |

Next tier, outside the top 25: HUD gap and minimap (WP9, H3), distinct car silhouettes (F1), shadow-pass reduction on medium (C2), decor dither (W2), overkill cascade (X4), upgrade cost flattening once grip works (M5), save schema versioning before the first bump (M3), T3 start hairpin run-off (T1), and the GDD career and reverse layouts for long-term retention.
