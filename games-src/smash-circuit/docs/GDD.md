# Smash Circuit: Game Design Document v2.1

Status: design for the next big update (v0.2). Written 2026-11-03 against commit `b60ac57` (v0.1.1); **v2.1 applies review round 1** (owner requirements, Playgama rules, performance and tech, player fun; the issue-by-issue log is at the end of `docs/PLAN.md`). Two features are being built while this is written and are treated as existing: **visible car damage with flying parts**, and **boost pads + power-ups (Nitro, Ram Shield, Repair Kit, Shockwave)**.

Sources merged: four independent proposals (retention and economy, core gameplay and feel, content and variety, mobile UX and FTUE), four reviews, the owner's binding requirements (`docs/REQUIREMENTS.md`), the owner's feedback, and the code.

Priority tags: **P0** = this big update (v0.2), **P1** = next update (v0.3), **P2** = later. Anything not tagged inherits the tag of its section.

Implementation plan for the P0 scope: `docs/PLAN.md`.

Terms: the UI word for a takedown is **SLAM** (RU «ВЫНЕС»), and the 90-second destruction mode is **Smash Spree** (RU «Разгром»); code ids stay `takedown` and `rampage` (D13).

---

## 0. Owner decisions taken by default (confirm or change)

| # | Question | Default chosen | Why |
|---|---|---|---|
| D1 | "The player can choose any car": all open, or unlockable? | **Every car is drivable for free in Quick Race, the Weekly Cup and the Daily Challenge from the first hub visit (right after race 1).** The first hub shows the reveal "Quick Race: any car, even locked ones" with [Try now]. Career needs an owned car, or one opt-in ad per event ("AD · Race this event with {car}", R4). Owning a car = career use, upgrades, paint, mastery. One rule, printed on every locked car card: "Drive it free in Quick Race. Own it to use it in Career." | Meets the request and keeps a collection goal for retention. **This may read as a restriction of "choose any car":** the switch `CONFIG.garage.allCarsOwned = true` opens every car everywhere, Career included, with no other change. |
| D2 | Progression: "top-3 opens next track" (old default 11.12) | **Replaced by a 5-league career with stars and bosses**, with soft gates (15.1) and a second route past every wall. | The owner now asks for long retention. The old rule gave about 3 races of content. |
| D3 | Upgrades global or per car? | **Hybrid.** Same 3 branches (engine, grip, armor) and 5 levels as decided. Levels 1 to 3 are **Workshop** levels, bought once and shared by every car you own or get later; levels 4 and 5 are **Signature** levels, bought per car, priced by car tier. | Trying a new car never means starting from zero (per-car only made the rational player stick to one car), and the per-car top levels stay a long coin sink. Switch `CONFIG.garage.upgradeModel = 'hybrid' \| 'perCar' \| 'shared'`. |
| D4 | A wrecked car limps at 25% power for the rest of the race | **Wreck card (1.8 s), then respawn 20 m back at 50% health with all parts back on**, ghosted for 2 s. | Limping meant certain last place and quitting. Respawn keeps the race alive and makes slams matter. |
| D5 | Camera | **Fixed (north-up, the camera the owner approved) stays the default.** Follow (track-up) is an opt-in in Settings and Pause. The inverted steering was a mirrored scene, already fixed in v0.1.1 (`89e88ff`, `scene.scale.z = -1`); it was not a camera problem. The first play-test (G2) compares both cameras; the default changes only on the owner's word. | Do not regress what the owner likes. Follow is still built because it shows about twice as much road ahead in portrait. |
| D6 | Ads timing | Bridge config keeps the documented **`minimumDelayBetweenInterstitial: 60`** (platform default); 180 only if Playgama confirms it (asked in WP17). `initialInterstitialDelay` is undocumented and is not relied on. The game marks fewer natural pauses: Results → NEXT or Back, and Quit or Restart from Pause; **not** RETRY, not GARAGE, not the Results visit where a rewarded ad was just watched, and never the first race's results. | Bridge decides timing (requirement, no game-side timers); fewer marked pauses keep retries and shopping ad-free. |
| D7 | Daily login streak | Never resets on a missed day. The Daily Challenge streak has a 1-day shield per 7 days. | Casual web players who lose a streak do not come back. |
| D8 | First race | Tuned to be winnable: 2 laps, weaker field, first item box always Nitro. Teaches only gas, steer, smash and one item. | First win = the strongest D1 lever. Nothing visibly cheats. |
| D9 | Car names | Translated (Scrapper / Жестянка). Driver and boss names stay proper nouns. | Car names are descriptive words; Russian kids should read them. |
| D10 | Field size | **Race, Sprint, Knockout, Grand Final and every Quick Race lap race always run 8 cars (player + 7 AI)**, as decided. The extra modes have their own fields: Time Attack and Drift Trial are solo with ghosts, Boss Duel is 1 v 1, Smash Spree is the player + 3 traffic cars. | The decided 8-car race stays untouched; the extra modes are additions to confirm. |
| D11 | Debris lifetimes | One cap of **60 pieces in total** (36 break pieces + 24 car parts), 2 to 3 per break, break debris 1.5 s, **car parts 2.0 s** (top of the 1 to 2 s rule; the in-flight value 2.4 s is cut to 2.0). | Stays inside the rule; 2.4 s or more only if the owner wants parts to lie longer. |
| D12 | Leaderboards | **P0**: one Playgama leaderboard per layout (10), score = best **Time Attack** lap, any car. Race laps stay local records (items and slipstream make them unfair). | The decided "leaderboard for best lap", made fair. Car-class boards can follow if the owner wants them. |
| D13 | IP hygiene of terms | "Takedown" is shown as **SLAM** and "Rampage" as **Smash Spree**; driver "Drift" is renamed **Skid**. | "Takedown" and "Rampage" are title features of known games; "Drift" as a name clashes with the HUD. |

---

## 1. Pillars

1. **Slide, Smash, Surge.** Every corner is a drift chance, every wall and rival is a smash chance, and both feed a boost you feel at once.
2. **Destruction pays.** Smashing earns score, coins, style, stars, tasks and achievements. The USP of the game is also the USP of its economy. Everything on the map breaks, through one system.
3. **Ten cars that play differently.** Each car has its own silhouette, handling, drift style, engine sound and one perk you notice within two laps. Choosing a car is a tactical decision, not a paint swap.
4. **Always one obvious next goal.** One big button, one "next goal" line, one tap from results to the next race.
5. **One finger, one hand, any device.** Gas, steer, drift and item work with the thumb on the GAS button; nothing fires by accident. PC is a first-class citizen with keys.
6. **Short loop, long arc.** About 2.3 minutes per race loop, 12 to 20 minute sessions, 5 to 6 hours of career, 8 to 10 hours with Legend Remix, then weekly cups, mastery, records and leaderboards for weeks.

Premise (one line in the UI, 26.1): a backyard racing circuit where cars are built from scrap and every wall is fair game; start in the Rookie Cup, beat five bosses and take the Duchess's crown in the Grand Final.

Keep (the owner likes these, do not regress): the destruction system (walls, guardrails, road chunks, props), zone damage, the cartoon low-poly look, the Fixed camera, props thrown clear, the AI racing line and overtakes, the best-lap ghost, the two-tap confirm on Quit and Restart, safe areas, and the build label.

---

## 2. Audit summary: what a demanding player hits in the first 10 minutes of v0.1.1

| # | Gap | Fix in v0.2 | P |
|---|---|---|---|
| A1 | One car for everyone; the grip stat barely changes cornering (`carModel.ts` uses the global `maxLatAccel`, and so does `ai.ts`) | 10 cars with per-car cornering limit, size, mass, engine sound and perk; the grip upgrade raises the cornering limit | P0 |
| A2 | Car damage ignores mass (`sim.ts` gives both cars the same impulse), so heavy cars would take more damage than light ones | Damage scales with Δv (impulse × 1000 / own mass); the no-damage threshold is applied to the same normalised value | P0 |
| A3 | Phones cannot drift (touch never sets handbrake), and drifting is always slower | Drift mechanic with charge tiers and exit boosts; touch drift assist inside the sim | P0 |
| A4 | Portrait shows about 0.5 s of road ahead at top speed in the north-up camera (the inverted steering itself was a mirrored scene, fixed in v0.1.1) | Follow camera with a forward-visibility rule as an option; Fixed stays the default (D5) | P0 |
| A5 | Results → Continue → interstitial → menu → Play → track: 3 taps and an ad between races | Results [NEXT] in one tap; first launch goes straight to race 1 | P0 |
| A6 | 3 tracks, one goal ("top 3"); nothing for tomorrow | Career 35 events, 10 layouts, 7 modes, daily rewards and tasks, achievements, Weekly Cup | P0 |
| A7 | Destruction pays a flat 6 coins per piece (a cone = a concrete wall); prop farming ≈ winning | Smash score by kind, combos, diminishing coins | P0 |
| A8 | Hitting rivals has no goal | Slams, wreck and respawn, revenge | P0 |
| A9 | Likely lap cut on Frost Pass: smash 2 walls, cross 55 m of grass, skip about 300 m (`race.ts` accepts any stable jump > 25 m) | Sector checkpoints | P0 |
| A10 | Repair can cost more than first place pays; the HUD shows a price the player cannot pay | Repair cap 40% of the event's first prize; "can't afford" state; free repair by rewarded ad (1 per race); Repair Kit item | P0 |
| A11 | First race usually lost (player starts 6th of 8; the base car finishes about 3rd on t1) | Tuned first race | P0 |
| A12 | No wrong-way warning, minimap, position-change feedback, gap times or lap delta | HUD v2 | P0 |
| A13 | Driver names `Viper`, `Maverick`, `Nitro`, `Comet`, `Bolt` are real car model names; `Gaz` is a car maker; `Pixel`, `Mango` are brands | Rename (original IP), plus an IP check of mode, item and HUD terms (section 28) | P0 |
| A14 | Settings lack separate music and effects volume (music is mandatory on Playgama), left-handed mode, sensitivity, camera, reduce motion | Settings v2; a mute button on the hub and in Pause | P0 |
| A15 | All sound files are code-synthesized placeholders (Playgama 3.3.2 rejects them); no music | A sourcing package with a licence log, started in the first wave (section 22) | P0 (release blocker) |
| A16 | Nothing to do after the last track: no records, no leaderboard, no endgame | Records screen, leaderboards, Weekly Smash Cup, Legend Remix, cosmetic shop, car mastery | P0 |
| A17 | Rivals are random names with no face | Fixed signature car, paint and trait per driver, head-to-head record, revenge marker | P0 |
| A18 | Russian numbers read wrong ("5 монеты") because `t()` has no plural forms | `tp()` with RU one/few/many forms (26.0) | P0 |

---

## 3. Core loop

### 3.1 The 10-second loop (P0)
Approach a corner → steer hard → **drift** (sparks turn blue, then orange, then violet) → ease off → **boost** → catch a rival → **slipstream** → **ram** → the rival hits a wall → **SLAM** (0.4 s slow motion) → the style meter fills → **Smash Nitro** → plow through a fence.

### 3.2 The race loop (P0)
Event card (car, rivals) → RACE → 3-2-1 (perfect start chance) → 2 to 5 laps of racing, smashing, items and drifting → finish (slow motion, confetti on podium) → results sequence (place, coin breakdown, records, stars, XP, unlocks, next goal) → **NEXT** (interstitial request at this natural pause, D6) → next event.

Target durations: race 60 to 110 s; whole loop about 2.3 min.

### 3.3 The session loop (P0)
Boot → login popup (from session 2, after `game_ready`) → hub with the next event highlighted → 4 to 8 races → stopping point: "tomorrow" previews on the results screen and the hub (calendar reward, new tasks timer, nearest car, boss stars, weekly cup timer).

Feel targets (checked at the play-test gates G2 and G2b and in telemetry):

| Metric | Target |
|---|---|
| Drifts per lap (average player) | 3 to 6 |
| Drifts the player did not intend (play-test, asked after the race) | ≤ 1 per race |
| Items fired by accident (play-test) | ≤ 1 per 5 races |
| Slams per race (average / skilled) | 1 to 2 / 4 to 6 |
| Style meter fills per race | 2 to 3 |
| Gap between 1st and 3rd at the finish | under 2.5 s in at least 55% of races |
| Player finishes within 2 s of a rival | at least 60% of races |
| Average place on the first try of a new event | 2 to 4 |
| Share of race time with at least one rival on screen | at least 70% |

---

## 4. Meta loop (P0)

```
Race events ──► coins ──► Workshop levels (all cars) + Signature levels (one car) ──► higher PR ──► harder events
     │           │                                                                      │
     │           ├──► buy cars (star-gated) ◄── stars ◄─────────────────────────────────┤
     │           └──► cosmetic shop (paints, rims)                                       │
     ├──► XP ──► driver level ──► features, titles, cosmetics, level coins               │
     ├──► car XP ──► car mastery 1 to 5 ──► exclusive rims and paints                    │
     ├──► smash/drift/slam counters ──► daily tasks, achievements, records               │
     └──► best Time Attack laps ──► leaderboards                                         │
Bosses (end of each league) ──► trophy cars + next league ──► Grand Final ──► Legend Remix (platinum stars)
Daily: login calendar + 3 tasks + Daily Challenge (any car)     Weekly: Smash Cup (medals, weekly paint)
```

Progress tracks: **Coins** (the only currency, owner rule), **Stars** (career, 105, plus 35 platinum in Legend Remix), **Driver level** (XP), **Car mastery** (per car), **Achievements**, **Car collection**, **Records** and **leaderboard ranks**.

---

## 5. Controls and camera

### 5.1 Touch: one-finger gesture grammar (P0)
Everything happens on the thumb that holds GAS (bottom-right; bottom-left in left-handed mode). Every gesture has config thresholds (`CONFIG.controls`) and a false-positive test (PLAN WP6).

| Action | Gesture | Thresholds and safety |
|---|---|---|
| Gas | Hold GAS | exists; auto-gas option exists |
| Steer | Slide the GAS thumb left or right | exists: dead zone 4% of width, full lock at 22% (less to the right edge); sensitivity slider 70 to 140% scales `steerFullAt` |
| Brake / reverse | Pull the thumb down by 0.4 button sizes | exists; always a brake by default |
| **Drift (assist, default ON on touch, OFF on PC)** | Hold full lock (\|steer\| ≥ 0.9) for 0.12 s while forward speed ≥ 14 m/s (50 km/h) and throttle is on | **Runs in the sim** (`sim/drift.ts`) from `CarSetup.driftAssist`, so it is deterministic and AI cars and ghosts use the same code. `assistNeedsCorner`: the track must curve ahead (\|curvature\| ≥ 0.015 within 30 m), so a correction on a straight never starts a drift. A drift holds a tighter line than grip (6.1), so an unplanned drift never throws the car off the road. Race 2 shows a small chip "Auto-drift: ON · Settings" (no modal). |
| Drift (brake tap, **opt-in, default OFF**) | A pull-down shorter than 0.25 s while \|steer\| > 0.5 | input sends a one-frame `driftPulse` instead of braking (0.35 s handbrake impulse in the sim). Setting "Brake tap = drift". Off by default because a quick brake in a corner must stay a brake. |
| **Use item** | **Tap the item slot** (72 px circle above GAS): a thumb hop from GAS keeps the gas on for 0.4 s (`gasHoldOver`), so the hop costs no speed | the default, taught in race 1 |
| Use item (flick, optional, default ON) | **Flick up**: the thumb moves up by ≥ 0.45 button sizes within 0.25 s, vertical-dominant (\|Δy\| ≥ 2 × \|Δx\| over the flick), while steer changes by < 0.3 in that window; re-arms when the thumb is back within 0.25 sizes of home | Setting "Flick up to use item" (off = slot tap only). Taught as a tip from race 5. A thumb wobbling vertically at full lock never fires it (test). |
| Drift (2nd finger, optional) | DRIFT button, bottom-left, replaces BRAKE when Settings → "2nd-finger button" = Drift | |
| Pause | Pause button (SVG) top-right | |
| Repair | Tap the damage silhouette | |

The sim consumes edge inputs (`useItem`, `driftPulse`) once per rendered frame, not once per substep.

**Steering arc (P0):** while the thumb is down, a thin SVG arc above GAS shows the neutral tick, the full-lock tick and the red DRIFT zones at the ends; a dot shows the thumb. It fades to 30% after the drift lesson (race 2).

**Left-handed mode (P0):** mirror GAS, the item slot and the 2nd-finger button; HUD clusters swap sides via a `.lefty` class.

**Haptics (P0, Android only, feature-detected, setting default ON):** 12 ms on drift entry, 20 ms on boost, 25 ms on item use, 40 ms heavy impact, 60 ms slam, 90 ms player wrecked.

### 5.2 PC keys (P0)
W/↑ gas, S/↓ brake and reverse, A/D or ←/→ steer, **Space = drift** (hold; also the handbrake), **E or Shift = use item**, R = repair, P = pause, M = mute. **Never Esc** (Playgama 1.5.2). Menus: Enter = primary button, ←/→ = carousel, Backspace = back or close (P0); full Tab focus with a visible ring (P1). Drift assist default OFF on PC (setting).

Inside the Playgama iframe every game key calls `preventDefault`: Backspace never navigates back, and arrows, Space and Enter never scroll the page (gate item 16).

### 5.3 Camera (P0)

| Item | Fixed (**default**, today's camera) | Follow (option) |
|---|---|---|
| Rotation | north-up | azimuth target = track tangent at s + 12 m + 0.5 s × speed, blended 25% toward the velocity heading (so a drift does not swing the view); damping 2.4/s; rate cap 1.6 rad/s (1.0 with Reduce motion); snap on respawn and reset; hold the azimuth while the car points more than 120° off the track direction |
| Player anchor | centre plus look-ahead (today) | 30% of the view height from the bottom, portrait and landscape |
| Visibility | today's view widths | zoom so that road visible ahead ≥ max(40 m, 1.1 s × speed) |
| Car size on screen | **≥ 32 CSS px long in every orientation** (landscape zoom is clamped to keep it) | same |
| Zoom pulses | speed +25% (exists), boost +8% (in 0.15 s, out 0.6 s), drift +5%, slow motion −12%, last 150 m of the race −6% | same |
| Shake | trauma as today plus a **directional kick** along the impact normal (0.35 m × strength, spring k 90, c 14); caps 1.0 m portrait / 1.3 m landscape; Settings → Screen shake Full / Reduced (×0.4) / Off | same |
| Shadows (medium/high) | as today | the shadow frustum is fitted to the rotated view rectangle plus the zoom pulses and snapped to the light-space texel grid (no shimmer, no cut-off at the view edges) |
| Finish | 0.5 s slow motion, then a slow 120° orbit around the player during `resultsDelay` | same |

Follow in portrait 390×844 sees about 53 m ahead at rest (Fixed about 23 m). The minimap (section 20.6) stays north-up in both modes.

---

## 6. Drift (P0)

Files: `src/sim/drift.ts` (state machine), `src/sim/carModel.ts` (drift branch of `integrateCar`), `src/sim/boost.ts` (exit boost). The same rules apply to AI cars.

### 6.1 States
`grip → drifting → clean exit (boost) | spin-out | cancelled`

**Entry (any one):**
- Assist (default ON on touch, OFF on PC): see 5.1. It runs here in the sim, from `CarSetup.driftAssist`, so AI cars and ghosts use the same code.
- Manual: `drift` input held (Space, DRIFT button) or a one-frame `driftPulse` (the opt-in brake tap) with |steer| ≥ 0.3 and forward speed ≥ 14 m/s.
- Flick: steer swings by ≥ 1.2 within 0.15 s at ≥ 16 m/s (pros start a drift early).

On entry the rear steps out with a yaw kick of 0.9 rad/s × sign(steer) × the car's `drift.entryMul`.

**While drifting, steering sets the drift angle, not the heading:**
- target slip angle θt = (12° + 28° × clamp((|steer| − 0.25)/0.75, 0, 1)) × car `drift.angleMul`, i.e. 12° to 40° for a neutral car
- yaw rate = rotation rate of the velocity vector + 6/s × (θt − θ), capped at `maxYawRate × 1.2`
- the velocity turns toward the heading with a lateral cap of 21.5 m/s² × (0.55 + 0.45|steer|) × damage grip × surface grip × car `latAccelMul`: 113% of the grip limit, so a drift can hold a tighter line
- extra drag (1.8 m/s² + 0.03·v) × car `drift.dragMul`: the price of drifting
- front wheels counter-steer visually (wheel yaw = −sign × θ × 0.6)
- a damaged rear zone or rear wheels add up to +8° (a damaged car slides more)

**Exit:**
- Assist: |steer| < 0.35 for 0.12 s. Manual: drift input released.
- Full lock the other way **chains** into a drift in the other direction and keeps 50% of the charge (S-bends).
- Speed below 10 m/s ends the drift without a boost.

**Clean exit:** θ < 10° within 0.35 s of the exit trigger and no impact ≥ 0.2 in that window → tier boost.

**Spin-out (the risk):** θ > 65° × car `drift.spinMul`, or full counter-lock while θ > 45° without chaining → grip ×0.5 for 0.6 s, charge lost, event `spinOut`.

**Walls and grass:** impact ≥ 0.2 resets the charge to 0; scraping drains 35% per second; off-road the charge does not grow and drift grip is ×0.7.

### 6.2 Charge and tiers
Charge per second = (θ / 25°)^0.8 × clamp(v / 22, 0.6, 1.25) × car `drift.chargeMul`. A standard drift builds about 1 unit per second.

| Tier | Charge | Rear-wheel sparks | Exit kick | Power × | Top-speed ceiling × | Duration | Style | Points bonus |
|---|---|---|---|---|---|---|---|---|
| T1 | 0.75 | blue | +2.5 m/s | 1.35 | 1.10 | 0.45 s | +6 | 50 |
| T2 | 1.6 | orange | +4.0 m/s | 1.5 | 1.14 | 0.75 s | +12 | 150 |
| T3 | 2.6 | violet | +5.5 m/s | 1.7 | 1.18 | 1.10 s | +20 | 350 |

Balance targets (unit tests, PLAN WP1). The reference controller is the AI driver at skill 1 on a fixed test corner with a fixed entry speed, run once on its best grip line and once with scripted drift inputs. A T2 drift through a 30 m radius corner (entry 24 m/s) exits 0.15 to 0.35 s ahead of the grip run; a T1 drift through a 10 m hairpin (entry 16 m/s) comes out between −0.05 and +0.10 s. Drifting rewards skill and is never required: every drift star has a no-drift alternative (15.3).

### 6.3 Drift score
- Points per second = 60 × (θ / 25°) × (v / 20); tier bonus on clean exit (table above).
- **Chain:** a new drift within 1.8 s of a clean exit adds ×0.5 to the multiplier (max ×3); a hit or 1.8 s without drifting resets it.
- HUD: a world-space counter above the car, "DRIFT 420 ×2", white → yellow → orange → violet; on release "+420" flies to the score/coin counter.
- Drift points feed: drift coins, XP, the style meter, Drift Trial scores, tasks and achievements.

### 6.4 Events and state (contract)
`SimEvent` (the `DriftEvent` union in `src/types/cars.ts`): `driftStart`, `driftTier`, `driftEnd{tier, points, clean}`, `spinOut`. `CarState.drift: DriftState { phase, angle, charge, tier, points, chain }`, a sub-object owned by the driving package, so drift fields never collide with other packages' fields.

---

## 7. Boost stack, slipstream, perfect start, style meter (P0)

### 7.1 One boost stack
Every speed source adds `{kick, powerMul, ceilingMul, duration}` to one per-car stack (`src/sim/boost.ts`). Multipliers multiply with **hard caps: power ×2.0, top-speed ceiling ×1.30**. Identical for player and AI.

| Source | Kick | Power × | Ceiling × | Duration | Notes |
|---|---|---|---|---|---|
| Drift T1 / T2 / T3 | 2.5 / 4 / 5.5 m/s | 1.35 / 1.5 / 1.7 | 1.10 / 1.14 / 1.18 | 0.45 / 0.75 / 1.1 s | section 6 |
| Boost pad | +6 m/s × max(0, cos(heading − pad direction)) | 1.6 | 1.18 | 0.9 s | 0.4 s cooldown per car per pad |
| Slipstream | — | — | 1.05, air drag ×0.8 | while inside | 7.2 |
| Slingshot | +1.5 m/s | — | — | — | leaving a full slipstream; 3 s cooldown |
| Perfect start | +5 m/s | 1.4 | 1.1 | 0.8 s | 7.3 |
| Nitro (item) | +3 m/s | 1.8 | 1.22 | 2.2 s | grip ×0.9; damage dealt ×1.4; ends early on impact ≥ 0.5 |
| Smash Nitro | as Nitro | 1.8 | 1.22 | 2.2 s | plus damage taken ×0.6 and walls break at ×0.6 of their threshold |

### 7.2 Slipstream
A car 3 to 14 m ahead, lateral offset ≤ 1.6 m, both faster than 20 m/s: the fill rises over 0.6 s; while full: air drag ×0.8 and ceiling ×1.05, giving about 48 m/s instead of 45.5 m/s on a straight. Visuals: wind streak lines and a "SLIPSTREAM" chip. The most honest catch-up mechanic: visible, and the player can use it too. 56 pair checks per step, negligible cost.

### 7.3 Perfect start
Gas pressed (0 → 1 edge) within [GO − 0.35 s, GO + 0.12 s] → "PERFECT START" and the boost. Holding gas from earlier gives a normal start and is never punished. The countdown shows a green zone on the last light. AI chance = skill × 0.6. Tip "Tap GAS on GO" in race 3. The first race has no perfect-start window (its countdown starts on the first touch).

### 7.4 Style meter → Smash Nitro
A 0 to 100 meter (ring around GAS on touch, bar beside the speedometer on PC). When full it becomes a **Smash Nitro** in the item slot (queued if the slot is busy). One slot, one gesture.

| Gain | Style |
|---|---|
| Drift clean exit T1 / T2 / T3 | 6 / 12 / 20 |
| Slam | 35 (Revenge 50) |
| Wall or guardrail smashed | 3 |
| Road chunk torn | 5 |
| Prop | 1 (max 10 per lap) |
| Perfect start | 10 |
| Slingshot | 4 |
| Near miss (P1) | 4 |

Expected: about one fill per lap for an average player.

---

## 8. Power-ups and boost pads

The in-flight agent builds the items and pads. These are the **target numbers**; WP0a reconciles them with what was built.

### 8.1 Item boxes (P0)
- Rows of 3 to 4 boxes across the road, 2 to 3 rows per layout (about every 300 m), never inside a braking zone, never within 40 m after the start line.
- **A box is a destructible sensor prop** in the one destruction system (9.0): HP 1, no contact impulse; a pickup is a break (2 debris pieces, attribution to the picker) and the box respawns 4 s later through the same respawn path as Smash Spree props. One item slot per car; a car with a full slot passes through without breaking it.
- Look: a glowing crate with a bolt glyph (original; never a question-mark cube, section 28). Pickup plays a 0.6 s roulette on the slot icon. **The first box in the player's first race always gives Nitro.**
- Time Attack and Drift Trial have no boxes (pads only). Frenzy modifier: rows ×2 and respawn 2 s.

Distribution by race position (player and AI alike; the fair catch-up lever):

| Position | Nitro | Ram Shield | Repair Kit | Shockwave |
|---|---|---|---|---|
| 1st | 45 | 35 | 15 | 5 |
| 2nd to 3rd | 40 | 25 | 15 | 20 |
| 4th to 6th | 35 | 15 | 20 | 30 |
| 7th to 8th | 35 | 10 | 20 | 35 |

Repair Kit weight ×2.5 when health < 0.5 and ×0 when health > 0.9. No Repairs modifier: Repair Kit weight 0.

### 8.2 Items (P0)

| Item | Effect | Numbers | Countered by |
|---|---|---|---|
| Nitro | speed | 2.2 s, power ×1.8, ceiling ×1.22, +3 m/s, grip ×0.9, damage dealt ×1.4 | Shockwave cancels it; a hard wall hit ends it |
| Ram Shield | armour bubble | 5 s; damage taken ×0.25; car-to-car damage dealt ×2; collision mass ×2; wall/guardrail break threshold ×0.5 | absorbs one Shockwave (bubble pops) |
| Repair Kit | instant heal | each zone heals 50% of its missing HP, at least +25 HP; like every heal it puts lost parts back on (9.3) | — |
| Shockwave | radial blast | arms in 0.25 s (visible ring), radius 9 m, push 9 m/s × falloff, 12 HP to the facing zone, cancels Nitro, never affects the user; props and guardrails within 6 m take an impulse-equivalent hit **through the normal hit pipeline** (they break only if that hit beats their threshold; nothing is deleted directly) | Ram Shield |
| Smash Nitro | style reward | 7.1 | — |

All multipliers above are applied in one place, `composeDamage` (9.2).

### 8.3 AI item use (P0, `src/sim/ai.ts`, personality `itemIQ` 0 to 1)
The AI reads items, boxes, pads, rival shields and Nitro through `AiPerception` (filled by the sim at 20 to 30 Hz), never by reaching into sim internals.
- Reaction delay lerp(1.2, 0.3, itemIQ) s; use anyway after 8 s.
- Nitro: when the next 2 s of road have \|curvature\| < 0.004 and nobody is within 25 m ahead in the chosen lane (low IQ: random moment).
- Shield: a rival closes from behind within 10 m at > 4 m/s, or before ramming, or at health < 0.4.
- Repair: high IQ at health < 0.55; low IQ at once.
- Shockwave: 2+ rivals within 7 m, or one alongside within 4 m with a wall within 3 m on its side (wall distance from a cheap spline gap query, no raycasts per step).
- Fairness: the AI never shockwaves the player in the first 8 s or the last 5 s of a race.

### 8.4 Boost pads (P0)
- Chevron decal 6 × 3 m, glowing arrows, pad zap sound. Numbers in 7.1.
- 2 to 4 per layout: the exits of the two slowest corners and the start of the longest straight; on Frost Pass on the exits of the three tightest hairpins (drift → pad → double boost, under the caps); one right after each shortcut gate (P1).
- **A pad is part of the road chunk it lies on** (the destruction system, 9.0): when that chunk tears, the pad is gone for the rest of the race (the pad reads the chunk's state; AI perception sees `padActive = false`).

---

## 9. Destruction as gameplay

### 9.0 One destruction system for everything on the map (P0, owner rule, decided)
- Every object with a physics body on a layout is a destructible in `src/sim/destruction.ts` with HP and a break threshold: walls, guardrails, curbs (sensor), road chunks, props, item boxes (sensor), container stacks, car hulks, crane feet, tyre stacks, and later shortcut gates and fuel barrels (P1).
- Every hit goes through **one hit pipeline** (contact impulse → threshold → HP; Shockwave and explosions enter as an impulse-equivalent hit) and every break goes through **one break path** (deferred removal after the world step, 2 to 3 visual debris pieces, smash score, attribution, sound).
- Things that should look unbreakable get a **high HP or a tall threshold, never an exemption**: harbor crane feet HP 2,500, threshold 14,000 (only a Mammoth under Smash Nitro gets through).
- Decor beyond the walls (crane jibs, boats, water, distant tyre mountains) has no physics body. The only body without HP is the invisible world fence 150 m outside the track bounding box (not part of the map).
- Test (PLAN WP4): on every layout, every non-car body has a destructible entry, except the world fence.

### 9.1 Smash score (P0; replaces the flat `destructionBonus`)

| Event | Points | Style |
|---|---|---|
| Cone, sign | 5 | 0.5 |
| Barrel, crate, hay bale, tyre stack, item box | 10 | 1 |
| Guardrail segment | 25 | 3 |
| Wall segment, container stack, hulk stack | 40 | 3 |
| Road chunk torn | 60 | 5 |
| Tree, rock | 50 | 4 |
| Crane foot | 200 | 10 |
| Slam | 300 (Revenge 600) | 35 (Revenge 50) |
| Near miss (P1) | 20 | 4 |
| Shortcut gate (P1) | 100 | 8 |

- **Combo:** each smash within 1.5 s of the previous one adds ×0.25 to the multiplier (max ×3); the HUD shows "SMASH ×4". Breaks the player did not cause score nothing (attribution exists: `lastHitBy`).
- **Coins from smash** = (min(S, 1500)/10 + max(0, S − 1500)/20) × league multiplier. Diminishing returns end prop farming.
- **Track evolution (P0, free):** on the final lap, if 25% or more of the walls are down, the toast "The track is breaking up!" and extra dust. The damage the owner asked for becomes a visible feature.

### 9.2 Slams (takedowns) and the damage chain (P0)
A rival counts as slammed by car X if, within **2.0 s** of contact attributed to X:
- it becomes wrecked, or
- it hits a wall or prop with impact strength ≥ 0.45, or
- it spins out (heading > 100° off the track tangent, or speed below 35% of its pre-contact speed for ≥ 0.5 s).

Attributed contact = car-to-car impulse ≥ 6000 N·s (about 5 m/s closing speed), or X's Shockwave. Event `takedown{by, victim, kind}` (UI: SLAM).

**No farming:** a car that was slammed (by anyone) in the last 10 s, or that is ghosted after a respawn, cannot be slammed again: no points, no style, no credit.

**Revenge (P0-lite):** the last rival who slammed the player gets a red marker (chevron over the car, red ring on the minimap dot) until the end of the race; slamming that rival pays ×2 points, style 50 and "REVENGE!".

**Damage chain (one function, one order).** Each multiplier exists once, in `composeDamage(ctx)` (`src/sim/combat.ts`), and a table-driven test covers every combination:
1. Mass normalisation (driving code, `car.recordImpact`): `n = impulse × 1000 / own mass`, so damage follows Δv. A Mammoth ramming a Needle at 20 m/s: the Needle loses at least 3× the HP the Mammoth loses.
2. Threshold (driving code): `n` below `impulseThreshold` (2,500) gives 0 damage, for every car (9.6).
3. Base damage (driving code): today's formula on `n`, divided by armor.
4. `composeDamage` multiplies the base, in this order: contact role (car-to-car: the car moving into the other ×0.55, the car being hit ×1.15, by closing speed along the normal, on top of `carVsCarMul`; walls and props ×1) → dealer's `ramDamageMul` (front contact only when `ramFrontOnly`) → dealer's Nitro ×1.4 or Shield ×2 → receiver's Shield ×0.25 or Smash Nitro ×0.6 → receiver's `zoneDamageMul[zone]` → Glass Cannon ×2.
5. Shockwave: a fixed 12 HP to the facing zone enters at step 4 with role ×1 (a Shield absorbs it completely and pops).
6. Wall and prop HP (the destructible side): today's formula × the dealer's `frontRamWallMul` (front contact); a Shield lowers the piece's break threshold to ×0.5 and Smash Nitro to ×0.6.

### 9.3 Wreck and respawn (P0, decision D4)
- **Every race starts with a full car: all HP, all parts** (damage is not kept between races, REQUIREMENTS default 11.11).
- Wrecked (health ≤ 12%): parts burst off, smoke plume, 0.5 s slow motion (player involved only), "WRECKED" card for 1.8 s.
- Respawn 20 m behind the wreck point on the centre line, facing forward, at **50% health in every zone with all parts back on** (dents and smoke as for 50%), ghosted for 2 s (fixtures become sensors through the post-step queue, the car blinks).
- **Every heal puts lost parts back on:** paid repair and the AD free repair restore all HP and all parts; a Repair Kit and a respawn restore parts too, with HP as stated. The damage silhouette and the 3D car show it at once (test: repair restores the renderer's `partOff` state).
- Total cost about 4 to 5 s. Same rule for AI, so a slam really removes a rival for a moment while the field keeps its size.
- **Knockout:** a wrecked car respawns with the normal penalty. Each elimination takes the last-placed car that did **not** respawn in the last 5 s (grace); if every candidate is in grace, the check waits until one leaves it. An eliminated car explodes into parts and leaves the race.

### 9.4 Anti-cut sector checkpoints (P0, must)
- Each lap is split into sectors of about 60 m (13 to 18 per layout).
- Progress beyond the next sector is not credited until that sector has been crossed in order. A jump > 40 m along the track counts only if it crosses an authored shortcut (P1).
- Skipping a sector: HUD "MISSED CHECKPOINT" with an arrow back; the lap does not count until the car returns.
- Sector gates have lateral tolerance = road half-width + wall offset + 3 m, so wide lines and wall plow-throughs that clip a corner stay legal.
- Fixes the Frost Pass serpentine cut and protects the best-lap leaderboard (17.5).
- **Wrong way:** heading more than 120° off the tangent for 1.0 s at > 5 m/s → "WRONG WAY"; after 5 s a free "Tap to go back" reset.

### 9.5 Later

| Feature | Notes | P |
|---|---|---|
| Near miss | rival passes within 0.6 m edge to edge at ≥ 6 m/s relative, no contact for 0.3 s: +20 points, +4 style, whoosh | P1 |
| Breakable shortcut gates | wooden or chevron fences, a destructible in the one system (HP 90, break at about 35 km/h) between close road stretches, gravel behind (grip 0.85, drag 0.6); once broken they stay open; saves 0.8 to 1.5 s for 8 to 15% health; ≤ 12% of a lap; one pad after each gate | P1 |
| Explosive fuel barrels | red with hazard stripe; a prop in the one system whose break event triggers an explosion (radius 6 m, push 8 m/s, 15 HP, as impulse-equivalent hits); chain to other barrels after 0.15 s; clusters of 2 to 3 at corner exits | P1 |
| Theme hazards | ice patches on Frost Pass (grip 0.6), oil slicks on Harbor Run, sand drifts on Dust Canyon (surface sensors like curbs) | P1 |
| Falling structures | water tower or billboard: a destructible whose break plays a scripted fall that blocks half the road for 20 s | P2 |

### 9.6 Preserved physics rules (owner requirements; every package keeps them)
1. **Curbs are sensors:** slow (`curbDrag`, `curbGripMul`) and shake, no contact impulse, and their HP loss is visual only (`curbScuff`). The new themes keep curbs on corners (harbor: painted kerb, junkyard: tyre-strip kerb) with the same sensor behaviour.
2. **No damage below the threshold:** `impulseThreshold` (2,500) is compared with the **mass-normalised** impulse, which is a Δv of about 2.5 m/s for every car. Curb rubbing and light taps give 0 HP loss on all 10 cars (test: 20 m/s along a curb for 5 s and a 3 m/s wall touch, every car).
3. **A light touch does not break a guardrail; a strong hit does** (per-kind thresholds unchanged; only `frontRamWallMul`, Shield and Smash Nitro change them, in `composeDamage`).
4. **No tunnelling:** fixed step 1/120 s; CCD (`bullet`) on cars; an absolute speed clamp `CONFIG.car.absMaxSpeed = 80 m/s` (0.67 m per step) on top of the boost caps; every wall kind is at least 1.15 × that travel thick (guardrail 0.8 m, wall 1.4 m, containers and hulks 1.6 m). A config test checks the thickness rule; a physics test drives every car at the clamp into every wall kind 100 times.
5. **Bodies change only after the world step:** every body, fixture, filter and sensor change (breaks, respawn ghosting on and off, Knockout elimination, item boxes, pads, Smash Spree respawns) is queued from contact callbacks and applied after `world.step` by one post-step queue (`src/sim/world.ts`).
6. **Debris is visual only:** no physics, pooled, at most 60 pieces in total, 2 to 3 per break, life 1 to 2 s with fade (21, 25, D11).
7. Arcade grip, GRIP = 8, fixed step 1/120 s, and the physics targets (0 to 100 km/h about 4.1 s, braking 80 to 0 about 23 m, full lock at 15 km/h does not spin) hold for the Scrapper; the other cars scale per 10.2.

---

## 10. Cars (P0)

### 10.1 Data model
One roster in `CONFIG.cars` (physics and traits) and `CONFIG.garage` (price, unlock, tier). `CarStats` gains `latAccelMul`, `steerMul`, `brakeMul`, `length`, `width`, `drift{chargeMul, angleMul, dragMul, entryMul, spinMul, hbGripMul}`, `traits`. `CarSetup` gains `modelId`, `levels` (upgrade levels, used for AI cars too) and `driftAssist`. `statsFor(modelId, levels)` applies the hybrid upgrade levels (10.4) to the model's own base; the player's cars and the AI cars use the same function.

Traits are generic numeric multipliers (1 = neutral), each applied at one existing code point: `offroadDragMul`, `offroadGripMul`, `propSlowMul`, `plowKeep`, `ramDamageMul` (front-contact only when `ramFrontOnly`), `zoneDamageMul{zone: mul}`, `repairCostMul`, `repairKitMul`, `regen{delay, perSec, cap}` (self-repair), `nitroDurationMul`, `slipFillMul`, `slipCeilMul`, `launchWindowMul`, `launchKickMul`, `downforce` (extra cornering at top speed), `knockbackMul` (Shockwave push).

### 10.2 Roster: physics and identity

Base reference: today's car (power 8.0 m/s², ceiling 50 m/s, cornering 19 m/s², grip rate 8, 1000 kg, 4.2 × 2.0 m).

| # | id | EN / RU | Class | Tier | Ceiling m/s | Power m/s² | Corner (latAccelMul) | Grip rate × | Mass kg | Armor | L × W m | Steer × | Brake × | PR stock → max |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | scrapper | Scrapper / Жестянка | All-rounder | 1 | 50 | 8.0 | 1.00 | 1.00 | 1000 | 1.00 | 4.0 × 1.95 | 1.00 | 1.00 | 100 → 129 |
| 2 | gravel | Gravel / Гравий | Drifter | 1 | 48.5 | 8.3 | 0.98 | 0.95 | 950 | 0.95 | 4.0 × 1.9 | 1.10 | 1.00 | 100 → 129 |
| 3 | brick | Brick / Кирпич | Tank | 1 | 46 | 7.4 | 0.92 | 1.00 | 1550 | 1.60 | 4.9 × 2.2 | 0.88 | 0.85 | 96 → 125 |
| 4 | sandhopper | Sandhopper / Попрыгун | Off-roader | 1 | 47 | 9.0 | 0.97 | 1.05 | 780 | 0.85 | 3.6 × 1.95 | 1.15 | 1.05 | 101 → 131 |
| 5 | brawler | Brawler / Задира | Muscle | 2 | 53 | 9.4 | 0.97 | 0.90 | 1250 | 1.15 | 4.6 × 2.0 | 0.95 | 0.90 | 108 → 139 |
| 6 | bruiser | Bruiser / Громила | Rammer | 2 | 50 | 8.8 | 0.99 | 1.00 | 1450 | 1.35 | 4.7 × 2.1 | 0.92 | 0.95 | 105 → 136 |
| 7 | glint | Glint / Блик | Speedster | 2 | 55 | 9.2 | 1.06 | 1.05 | 950 | 0.85 | 4.4 × 1.95 | 1.05 | 1.10 | 109 → 140 |
| 8 | scorcher | Scorcher / Пекло | Hot rod | 3 | 55 | 10.6 | 0.99 | 0.92 | 1100 | 1.00 | 4.4 × 1.9 | 0.95 | 0.85 | 114 → 147 |
| 9 | needle | Needle / Игла | Racer | 3 | 58 | 10.0 | 1.13 | 1.15 | 720 | 0.75 | 4.6 × 1.8 | 1.12 | 1.20 | 115 → 148 |
| 10 | mammoth | Mammoth / Мамонт | Juggernaut | 3 | 50 | 9.4 | 1.00 | 1.00 | 1900 | 2.00 | 4.9 × 2.5 | 0.86 | 0.90 | 111 → 144 |

**PR (Performance Rating)** = 100 × (0.36·P/8 + 0.26·T/50 + 0.26·G + 0.12·√A), where P = power, T = ceiling, G = cornering multiplier, A = armor, all after upgrades. "Max" = all three branches at level 5. PR is the single number on every event card ("Recommended 118 · yours 112") and on every upgrade button (before → after). The balance test (PLAN WP3) checks that measured pace follows PR; stats are retuned, never the formula.

**PR reachability rule (test, PLAN WP7 and WP16):** every league's top recommended PR is reachable by at least 5 of the 10 cars fully upgraded, and every boss target by at least 3. With 15.2 (L5 tops out at 138, the Grand Final at 140): maxed Needle 148, Scorcher 147, Mammoth 144, Glint 140 and Brawler 139 reach L5, and the first four reach the final. A car below the recommendation can still win with skill; the card shows the gap honestly.

### 10.3 Roster: perk, drift trait, silhouette, unlock

| Car | Line (UI) | Perk (numbers) | Drift trait (numbers) | Silhouette for modelers (top-down, must read at ~50 px; same 8 part slots) | Unlock |
|---|---|---|---|---|---|
| Scrapper | "Cheap, cheerful, fixes itself" | **Patch-up:** fixes itself: after 3 s without a hit every zone regains 1.5 HP/s up to 70% (visible on the health bar within a lap); repairs cost ×0.65 | Neutral (all 1.0) | Short boxy 3-door hatch; cabin centred and long (55% of length); stubby bonnet; two thin roof stripes; chunky rubber bumpers; small round mirrors; small flush wheels (r 0.42). Reads as "the friendly box". | Starter |
| Gravel | "Born sideways" | **Sideways:** grass drag ×0.7 | **Rally:** charge ×1.4, entry ×1.25, handbrake grip ×0.72 (0.18), assist triggers at \|steer\| 0.8 | Hatch like Scrapper but: 4-lamp light pod on the bonnet (lights mesh), roof scoop, wide rally wing overhanging the tail (spoiler), flared arches (+0.08 m), mud flaps, number roundels on the doors. Reads as "hatch with a wing and a light pod". | Choice after race 1 (free), else 2,000 coins at 3★ |
| Brick | "Slow. Unstoppable. Rude." | **Wide Load:** props and debris barely slow it (propSlowMul 0.3); ram damage dealt ×1.4 | **Lazy:** charge ×0.9, angle ×0.85, rotates slowly | Long tall box van; short sloped snout = front 30%; flat roof with a roof rack carrying two crates (spoiler); sliding side panels (doors); big step rear bumper; tall van mirrors; wheels at the corners. Reads as "a big rectangle". | Choice after race 1 (free), else 2,000 coins at 3★ |
| Sandhopper | "Grass? What grass?" | **Off-road King:** grass/hole drag ×0.3, off-road grip ×1.4 (cuts through broken walls) | **Skippy:** charge ×1.1, entry ×1.2, short snappy drifts | Dune buggy: minimal tub inside a thin dark roll-cage outline (an "X" skeleton seen from above); seat visible; narrow nose; huge rear wheels (r 0.55) sticking out wider than the body, small front wheels (r 0.42); side nets (doors); spare tyre on the back (bumperR); small tank on the nose (hood); whip pole with a pennant (spoiler). | 3,000 coins at 6★ |
| Brawler | "Burnouts, not brakes" | **Burnout:** perfect-start window ×2, launch kick ×1.5 | **Smoky:** charge ×1.25, drift drag ×0.75 (no power cut while sideways) | Muscle coupe: very long bonnet (55 to 60% of length) with a raised scoop (hood); small cabin set back; short tail with a ducktail lip (spoiler); fat rear tyres; twin stripes over bonnet, roof and tail. Reads as "long nose, tiny cabin". | Beat the L1 boss (Big Mo) |
| Bruiser | "Front-first problem solver" | **Bull Bar:** front zone takes ×0.5 damage; front contact deals ×1.6 to cars and ×1.3 to walls | **Heavy swing:** neutral charge, angle ×1.1 | Pickup: cab in the front half, open bed behind (dark inset with two barrels); big chrome bull bar wider than the body (bumperF); roll bar with 4 lamps behind the cab (spoiler); tall tyres. Reads as "cab, empty box, grille". | 9,000 coins at 18★ (L2 open) |
| Glint | "Fast and fragile" | **Slipstream Pro:** slipstream fills ×2 faster, ceiling ×1.08 instead of ×1.05, slingshot ×1.5 | **Precise:** drift drag ×0.85, angle ×0.9 | Low wedge: triangle nose, teardrop dark canopy far back, flat wide rear wing on two struts (spoiler), side intakes (doors), pop-up lamps. Reads as "an arrowhead". | Beat the L2 boss (Sleet) |
| Scorcher | "All engine, some car" | **Afterburner:** Nitro and Smash Nitro last ×1.5; engine zone takes ×1.3 damage (exposed) | **Wild:** charge ×1.2, angle ×1.15, spin threshold ×0.92 (risky) | Hot rod: narrow nose with an exposed chrome engine block and two rows of exhaust stacks (hood); tiny cabin at the rear; giant rear wheels outside the body; thin front wheels on visible axles; flame decals on the sides. Reads as "an engine with wheels". | 20,000 coins at 34★ (L3 open) |
| Needle | "Glass rocket" | **Downforce:** cornering +10% at top speed (linear from 50% of top speed); wheel zones take ×1.5 damage; off-road drag ×1.3 | **Grip racer:** charge ×0.8, drift drag ×1.2 (prefers clean lines) | Open-wheel racer: cigar body narrower than the wheel track; 4 exposed wheels; front wing (bumperF) and tall rear wing (spoiler); sidepods (doors); open cockpit with a helmet dot; mirrors on stalks. Reads as "a pencil with 4 wheels". | Beat the L4 boss (Ace) |
| Mammoth | "Walls are suggestions" | **Juggernaut:** plow-through keeps 90% of speed (global 62%), immune to Shockwave push, ram damage dealt ×1.5 | **Barge:** charge ×0.9, wide slow slides | Armoured monster truck: huge wheels (r 0.75) at the corners outside the body; high flat roof; riveted armour plates (doors); wide angled plow blade (bumperF); roof cage (spoiler); twin exhaust stacks. Reads as "a big square on 4 big circles". | Beat the L3 boss (Grinder) |

Garage bars (absolute 1 to 10 across the roster, computed in `meta/cars.ts` from the physics values; shown targets):

| Car | Speed | Accel | Handling | Drift | Armor | Weight |
|---|---|---|---|---|---|---|
| Scrapper | 4 | 5 | 5 | 5 | 4 | 4 |
| Gravel | 3 | 5 | 5 | 10 | 3 | 3 |
| Brick | 1 | 2 | 2 | 3 | 8 | 8 |
| Sandhopper | 2 | 7 | 6 | 7 | 2 | 1 |
| Brawler | 7 | 8 | 3 | 8 | 5 | 6 |
| Bruiser | 4 | 5 | 4 | 4 | 7 | 7 |
| Glint | 8 | 7 | 8 | 6 | 2 | 3 |
| Scorcher | 8 | 10 | 3 | 7 | 4 | 5 |
| Needle | 10 | 9 | 10 | 2 | 1 | 1 |
| Mammoth | 4 | 7 | 4 | 2 | 10 | 10 |

Rule: every car except the Scrapper has one bar ≥ 8 and one ≤ 3, so the bars read as "different" at a glance. Every perk must be noticeable within 2 laps of normal play (checked per car in the balance pass, PLAN WP16); a perk that is not is reworked.


### 10.4 Upgrades: hybrid Workshop + Signature (P0, decision D3)
Same branches and level count as decided by the owner; values in config.

| Branch | Effect per level (L5 total) |
|---|---|
| Engine | power +7%, ceiling +4% (×1.35, ×1.20) |
| Grip (tyres) | grip rate +7% **and cornering limit +5%** (×1.35, ×1.25); today the grip upgrade does almost nothing |
| Armor | armor +18% (×1.9) |

| Level | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Kind | Workshop | Workshop | Workshop | Signature | Signature |
| Applies to | every car you own and every car you get later | | | this car only | |
| Cost | 450 | 1,000 | 2,000 | 2,400 × tier mul | 4,200 × tier mul |

Tier multiplier for Signature levels: tier 1 ×1.0, tier 2 ×1.6, tier 3 ×2.4. Totals: Workshop 3,450 per branch, 10,350 for all three (once). Signature per car (all three branches): tier 1 19,800, tier 2 31,680, tier 3 47,520. Everything maxed: about 327k.

- A new car (bought, chosen or boss trophy) arrives at your current Workshop levels, so trying it is never a restart. Signature level 4 needs Workshop level 3 in that branch.
- Each buy button shows the concrete effect and which cars it touches ("All 4 cars: top speed +4%", "Glint: PR 131 → 135").
- The PR at the end of each league for a tier 1 car with Workshop 3/3/3 is about 117 (enough for L1 to L3); L4 and L5 reward Signature levels on the car you like (15.2).
- `CONFIG.garage.upgradeModel`: `hybrid` (default), `perCar` (old D3), `shared` (all five levels shared); `statsFor` keeps all three paths.

### 10.5 Trying and owning cars (P0, decision D1)
One rule, printed on every locked car card and in the garage: **"Drive it free in Quick Race. Own it to use it in Career."**
- **Quick Race, Weekly Cup, Daily Challenge:** any of the 10 cars, owned or not, from the first hub visit after race 1. A not-owned car runs at **showroom tune**: PR = your best owned PR, shown on the Quick Race car chip ("Showroom tune · PR 112").
- **Career:** an owned car, or for a locked car one opt-in rewarded ad per event: "AD · Race this event with {car}" (R4, 3 per day; showroom tune = the event's recommended PR; stars count). The button is not rendered when rewarded ads are unsupported; the car then simply stays locked in Career and stays free in Quick Race.
- Results after such a race: "Liked it? {price} to own it".
- `CONFIG.garage.allCarsOwned = true` opens every car everywhere (owner switch, D1).

### 10.6 Paint, cosmetics and car mastery (P0)
- Paint saved **per car** (today `carColor` is global). The 8 base colours are free.
- **Cosmetic shop (coins, P0):** 12 premium paints (metallic, pearl, two-tone, chrome; 600 to 2,500 coins) and 8 rim colours (400 to 1,200), bought once and usable on every car. About 23k coins in total: the sink for players who have maxed what they drive. Rendering is per-instance colour, metalness and a second colour on a `paintZone` vertex mask (two-tone and stripes), and a per-instance hub colour on the shared wheel mesh, so cosmetics add no draw calls.
- **Exclusive cosmetics** come from play, never from the shop: login days 3 and 7, Weekly Cup platinum, Legend Remix, mastery, driver levels (16.3).
- **Car mastery (P0-lite):** car XP = the race XP earned with that car. Mastery levels 1 to 5 at 1,000 / 3,000 / 6,000 / 10,000 / 15,000 car XP (about 3 / 8 / 17 / 28 / 42 races). Rewards: L1 badge on the car card, L2 an exclusive rim colour, L3 an exclusive two-tone paint, L4 500 × tier coins, L5 gold rims and a "Master" badge. A reason to drive every car.
- Champion gold livery: reward for the L5 final.
- P1: decals and rim shapes (new geometry), more exclusive liveries.

---

## 11. Rival cars (P0, owner request)

Pre-race "Rivals" bottom sheet on the event card (2 taps). The choice persists (`save.rivals`).

| Option EN / RU | Rule | Default |
|---|---|---|
| Mixed / Разные | each driver brings their signature car (12.2), locked cars too (which advertises them); at most 2 of a model; at least 1 heavy and 1 light | ✔ |
| Same as mine / Как у меня | all 7 drive the player's model in distinct paints: the pure skill race | |
| One model / Одна модель | the player picks one model for all 7 (grid of 10 thumbnails) | |
| Random / Случайные | fully random, duplicates allowed | |
| Custom per slot / Свои | 7 slots, tap a slot → car grid | P1 |
| Same class / Тот же класс | AI from the player's class | P1 |

**Fairness rule.** Rival strength comes from the event's target PR (career, Weekly Cup, Daily Challenge) or from the player's PR × difficulty (Quick Race), never from the chosen model, so the choice never changes difficulty or rewards and cannot be exploited.
- Each AI car is the chosen model at **upgrade levels**, computed by the same `statsFor` as the player's cars (an AI Mammoth at 3/3/2 has exactly the stats of the player's Mammoth at 3/3/2): the lowest levels whose PR reaches the target, plus a residual factor k in [0.97, 1.05] that lands the PR within ±1% of the target.
- If a model cannot reach the target even at max levels × 1.05, the car runs at that cap (flag `clamped`) and the missing PR is turned into driving skill (+0.02 per 1% of gap, at most +0.06). Mixed never picks a model that would be clamped by more than 3%.
- The model changes handling, size, mass, perk, engine sound and look; strength stays the event's.

**Same as mine** = your model. In Quick Race on Normal the rivals also carry **exactly your tune** (your levels, PR = yours): a true mirror race. In career events their tune follows the event target, and the sheet says so ("Mammoth · PR 124 · yours 131").

**Rival preview (P0):** the Rivals sheet and the grid splash show the 7 rivals as small car icons with driver name and PR, so the player sees the field before racing.

**Where:** Quick Race always; career events except Boss Duels and events with the Heavy Metal or One-Make modifier (those fix the field); the Daily Challenge and the Weekly Cup fix the field.

On the grid splash, in the finish order and in Results each rival shows **name · car · trait · head-to-head** ("Rusty · Brick · Rams you into walls · 3–5").

---

## 12. AI (P0)

### 12.1 Per-car awareness
`ai.ts` plans with the global `maxLatAccel` and `baseTopSpeed` today. It must use the car's own cornering limit (`19 × latAccelMul × upgrades`), ceiling, brake multiplier and real width (`passClearance`, follow logic), or 10 cars drive identically and wide cars pile up on the 9 m Frost Pass.

**Two rates:** steering and speed control run every step (120 Hz); the decision layer (items, attacks, lane choice, wall probes) runs at 20 to 30 Hz, staggered across cars, and reads `AiPerception` (nearest boxes and pads ahead, pad active flags, rival items, shields and Nitro, wall gap left and right from spline queries, ghosted rivals, the attack token), which the sim fills.

### 12.2 Archetypes and named drivers (persistent)

| Archetype (code id) | Skill range | Aggression | ramBias | driftSkill | itemIQ | Mistakes | Behaviour |
|---|---|---|---|---|---|---|---|
| Pro (`pro`) | high | 0.2 | 0 | 0.5 | 0.8 | ×0.7 | clean line, good at slipstream |
| Basher (`basher`) | mid | 0.9 | 0.8 | 0.2 | 0.5 | ×1.0 | rams, takes shields |
| Drifter (`drifter`) | mid-high | 0.4 | 0.1 | 1.0 | 0.6 | ×1.0, +15% × (1 − skill) spin chance per drift | drifts every corner under 40 m radius |
| Trickster (`trickster`) | mid | 0.5 | 0.3 | 0.5 | 1.0 | ×1.0 | optimal items; always takes shortcuts (P1) |
| Rookie (`rookie`) | low | 0.3 | 0 | 0.1 | 0.2 | ×1.6 | crashes into props (shows off destruction) |
| Boss (`boss`) | 1.0 | 0.6 | 0.5 | 0.8 | 0.9 | ×0.5 | signature car and livery, intro card, PR target ×1.03, no ease-off |

(The archetype names avoid the car names: "Bruiser" is a car, "Racer" is the Needle's class.)

Field mix: 2 Pros, 2 Bashers, 1 Drifter, 1 Trickster, 1 Rookie; from L4 the Rookie becomes a second Pro; the league table (15.2) can raise Bashers to 3.

Every named driver has a fixed archetype, **signature car** (used in Mixed), paint and a one-line **trait** shown on the grid splash and in the finish order. The game keeps a **head-to-head record** per driver (finishing ahead = a win), shown as "3–5". Trait strings in 26.7.

| Driver | Archetype | Signature car | Paint | Trait (EN) |
|---|---|---|---|---|
| Blaze | Pro | Glint | orange | Clean lines, loves a slipstream |
| Rocket | Pro | Needle | red | Fastest on the straights |
| Zed | Pro | Scrapper | teal | Almost never makes mistakes |
| Grit | Pro | Brawler | white | Brakes late, never gives up |
| Fenya | Pro | Gravel | mint | Steady and fast |
| Rusty | Basher | Brick | rust | Rams you into walls |
| Vasya | Basher | Bruiser | green | Leans on you in corners |
| Torque | Basher | Mammoth | grey | Pushes through walls |
| Dynamo | Basher | Scorcher | electric blue | Hits hard, burns out |
| Skid | Drifter | Gravel | lime | Drifts every corner |
| Sparky | Drifter | Brawler | purple | Smoke and sparks everywhere |
| Moxie | Drifter | Glint | pink | Chains drift after drift |
| Ziggy | Drifter | Scorcher | magenta | Wild slides |
| Turbo | Trickster | Scorcher | yellow | Saves Nitro for the end |
| Rex | Trickster | Bruiser | black | Shockwaves at the worst moment |
| Pepper | Trickster | Sandhopper | red-orange | Always has a power-up ready |
| Dusty | Rookie | Sandhopper | sand | Drives through everything |
| Kuzya | Rookie | Scrapper | sky blue | Loves crashing into props |
| Sprocket | Rookie | Gravel | blue | Wobbly but brave |
| Tolik | Rookie | Brick | beige | Slow and stubborn |

Driver names (P0 rename for IP hygiene): kept Blaze, Dusty, Rocket, Turbo, Zed, Rusty, Kuzya, Vasya, Torque, Sparky, Rex; replaced Viper, Maverick, Nitro, Comet, Bolt, Gaz, Pixel, Mango with Grit, Moxie, Sprocket, Pepper, Dynamo, Fenya, Tolik, Ziggy; "Drift" became Skid (D13). Bosses: Big Mo (Brawler, black and gold), Sleet (Glint, ice blue), Grinder (Mammoth, rust and yellow), Ace (Needle, white and red), Duchess (Scorcher, gold).

### 12.3 AI drift, items, attacks
- Drift: enter when the planned corner radius is under 40 m (Drifter) or 25 m (others, chance = driftSkill) and speed > 15 m/s; exit as curvature falls after the apex. Same state machine, so AI boosts are honest.
- Items: section 8.3.
- Attack (Basher and Boss only, never in the first 5 s): target alongside (lateral 1.5 to 3.5 m, overlap ±2 m), speeds within ±4 m/s, the target's wall within 3 m → aim at the target for 0.35 s (sideswipe), then a 6 s cooldown. **The sim hands out one attack token on the player** (`AiPerception.packToken`), so two AI cars never attack the player at once; 60% of attacks go AI-on-AI (free spectacle). Ghosted cars are never targeted.

### 12.4 Fair rubber band (replaces today's)
1. **No assist while an AI car is within `CONFIG.rivals.visibleRadius` = 45 m of the player** (about the portrait view). A fixed distance, independent of camera mode, zoom and device, so races stay deterministic and fair for leaderboards. Players only resent rubber banding they can see.
2. Off-screen chase (behind the player by > 60 m, full at 200 m): power ×1.10 max (was 1.20), ceiling ×1.04 (was 1.07), corner speed ×1.06.
3. Off-screen ease (ahead by > 50 m, full at 200 m): corner speed −6%, mistake rate ×1.5.
4. Last lap: no ease for AI ahead (honest finish); chase stays.
5. Visible levers instead: slipstream, the position-weighted item table, AI fighting AI.

### 12.5 Difficulty
League tiers (section 15.2) set AI skill, PR target and Basher count.

**Fail assist (P0):** after each attempt on an event with no new star: AI skill −0.04 and PR target −1.5%, up to 3 steps on events and **5 steps on bosses**; reset on a new star. The event card then shows a hint ("Your PR 108, recommended 112: try Engine level 2, +4 PR").

Hidden difficulty adjustment by win margin (P1): +0.025 skill after a win by > 4 s, −0.03 after 6th to 8th; clamp −0.12 to +0.06; never more than ±0.03 per race.

---

## 13. Modes and modifiers

All modes run on the same `Sim` through `SimOptions.mode` (`src/sim/modes.ts`). Scoring numbers live in the rules config. The first time a player meets Smash Spree, Knockout, Drift Trial, Time Attack, Boss Duel or the Weekly Cup, the grid splash shows a one-line **mode card** ("what to do, how you win") for 3 s; tap dismisses it; shown once per mode.

| Mode EN / RU | Rules | Stars (★1 / ★2 / ★3) | P |
|---|---|---|---|
| Race / Гонка | 8 cars, 3 to 5 laps, items on | top 3 / win / event challenge | P0 |
| Sprint / Спринт | Race with 2 laps, prize ×0.7 | top 3 / win / challenge | P0 |
| Time Attack / На время | solo, 3 laps, pads on, no items; **bronze, silver and gold medal ghosts** (one recorded AI skill-1 lap per layout, played back at the medal factor) plus the ghost of your best lap; best lap counts and goes to the leaderboard (17.5) | bronze / silver / gold lap time | P0 |
| Smash Spree / Разгром (code `rampage`) | 90 s timer, player + 3 Rookie "traffic" cars to ram; score = smash points with combo (9.1); items ×1.5; the playground refills (below) | score thresholds | P0 |
| Knockout / На вылет | 8 cars; from 25 s, every 15 s the last car not in respawn grace is eliminated (9.3; explodes into parts, leaves); ends when 1 is left or the player is out; HUD "Elimination in 8 s" | survive to the top 3 / win / challenge | P0 |
| Drift Trial / Дрифт | solo, 2 laps, drift score with chain; a wall hit breaks the chain; no items; a **drift ghost** (a recorded AI Drifter run) shows its live score ("Skid 4,200") so the run feels like a duel | score thresholds | P0 (fallback: Race if drift slips) |
| Boss Duel / Босс | 1 vs 1 against a named boss in a signature car; intro card; 3 laps | win / win by ≥ 2 s / boss challenge | P0 |
| Grand Final / Гранд-финал | L5 boss: full elite field, 5 laps, the Duchess leads it | win / win by ≥ 3 s / win without repairs | P0 |
| Weekly Smash Cup / Кубок недели | 15.6 | bronze / silver / gold / platinum | P0 |
| Slam Brawl | 3 laps, most slams wins, Basher-heavy field | | P1 |
| Wreck Arena | derby in a bowl, last car moving wins | | P2 |

**Smash Spree playground rules (P0):**
- **Refill:** a broken prop or wall segment more than 80 m (along the track) from the player respawns 12 to 15 s after it broke, through the post-step queue and the same destruction system (segments come back with full HP). Every 20 s a wave of 6 to 10 crates and barrels is dropped 60 to 100 m ahead on the racing line.
- **Thresholds come from what is available:** WP13's bot measures the maximum score per layout (smashing everything it can reach with a ×2 combo for 90 s, refills included). ★3 ≤ 70% of that maximum; a test checks that the maximum exceeds every threshold by at least 30%. The numbers in 15.3 are provisional until calibrated.
- Breaks by traffic cars score nothing for the player.

**Modifiers (P0, near-zero cost):**

| Modifier EN / RU | Effect |
|---|---|
| Glass Cannon / Стеклянная пушка | all damage ×2 (step 4 of the damage chain) |
| Heavy Metal / Тяжёлый металл | rivals drive heavy cars only (Brick, Bruiser, Mammoth) |
| No Repairs / Без ремонта | repair disabled, no Repair Kits |
| Power-up Frenzy / Бонусный угар | item rows ×2, respawn 2 s, pads ×1.25 kick |
| One-Make / Монокласс | everyone drives the player's model |
| Underdog / Аутсайдер | start last; prize ×1.5 |
| Reverse / Реверс | (layout, not modifier) the layout driven backwards |
| Night / Ночь | render-only palette, lamp posts, headlight cones (P1) |

---

## 14. Tracks

Rules: no layout longer than 1,100 m; ≤ 380 props; frame cost depends on the loaded track, not on how many exist. **Everything with a body is a destructible (9.0)**; every corner keeps sensor curbs (9.6); every wall kind meets the thickness rule (9.6).

| id | EN / RU | Theme | Width | Length | Layout notes | P |
|---|---|---|---|---|---|---|
| t1 / t1r | Green Valley / Зелёная долина | meadow | 14 | 879 m | easiest; flowing; 10 corners, tightest 31 m; FTUE track (gas, steer, smash, item); fence walls | P0 (reverse new) |
| t2 / t2r | Dust Canyon / Пыльный каньон | desert | 12 | 975 m | 145 m straight (nitro and slipstream showcase), chicane, **12 m hairpin (the drift lesson corner of race 2)**; concrete walls | P0 (reverse new) |
| t3 / t3r | Frost Pass / Морозный перевал | snow | 9 | 780 m | 13 corners, 3 hairpins (10 m); tyre walls; anti-cut sectors mandatory; met in race 3 as a 2-lap Sprint; P1 icy patches on two corner exits | P0 (reverse new) |
| t4 / t4r | **Harbor Run / Портовый рывок** | new `harbor` | 12 | 1,000 to 1,050 m | dockside straight 150 to 170 m beside the water (pad at its start); three 90° container-yard corners (radius 14 to 18 m: brake, turn, boost rhythm); a chicane between crane legs (**reinforced crane feet: HP 2,500, threshold 14,000**, breakable container stacks beside them); a 180° sweep around the basin (radius about 35 m); walls `containers` (concrete jersey barriers plus stacked containers, 1.6 m thick); painted kerbs; decor without bodies: crane jibs, water plane, moored boats; P1 oil slicks | P0 |
| t5 / t5r | **Scrapyard / Свалка** | new `junkyard` | 11 | 880 to 950 m | technical: chicane through stacks of car hulks, a tight 180° around the crusher landmark (the crusher base is a destructible with HP 2,500), a fast kink between tyre mountains; **double prop density** (barrels, tyres, crates, cones): the Smash Spree playground; walls `hulks` (stacked car hulks, 1.6 m thick); tyre-strip kerbs; decor without bodies: crane magnet, distant tyre piles | P0 |
| t6 | Neon Avenue / Неоновый проспект | `city`, night only | 13 | about 1,100 m | wide avenue, 90° blocks, long boost straight | P1 |
| — | Night variants (Green Valley Night, Harbor Night) | render-only | | | hemi and sun ×0.35 with blue tint, emissive lamp posts, additive light pools and headlight cones | P1 |
| a1 | The Bowl / Чаша | arena | 30 m wide oval | 260 m | Wreck Arena | P2 |

**Reverse (P0):** `reverseTrack(def)` reverses the control points and rotates them so the start sits on a straight (\|curvature\| < 0.004 for 40 m before the line). Props are regenerated by the seeded generator with seed + 1, so braking cones and signs move to the new braking zones. Each reversed layout has its own AI speed factor, ghost, best lap, medal times, records and leaderboard id; the card gets a "REVERSE" ribbon.

**Per-layout data (P0):** boost pads (2 to 4), item rows (2 to 3), sectors (auto), the drift-lesson corner position (t2), FTUE prop cluster on the t1 racing line at 150 to 200 m; AI `trackSpeed`, Time Attack medal times (= AI best lap at skill 1 × 1.10 / 1.05 / 1.01 in L1; tighter in later leagues, see 15.3), the medal ghost lap and the drift ghost run are measured and recorded by the AI package once the layouts exist.

**Fallback:** if Harbor Run or Scrapyard is not ready, `CONFIG.career.layoutFallback` maps t4 → t2r, t4r → t1r, t5 → t3r, t5r → t2 so the career never blocks.

---

## 15. Career (P0)

### 15.1 Structure
- **5 leagues × (6 events + 1 boss) = 35 events, 105 stars.**
- **Stars are independent and best-ever:** ★1 base goal (top 3 or bronze), ★2 win or silver, ★3 the event challenge or gold. A weaker driver can still earn ★3 by smashing. No ★3 goal is ever met automatically by meeting ★2 (unit test).
- **Boss** of a league opens when **★1 is earned on 5 of the league's 6 events** (completion, not wins).
- **Next league** opens when the boss is beaten **and** the cumulative star count is reached: L2 12★, L3 25★, L4 41★, L5 59★ (55% / 60% / 65% / 70% of the stars available before that league).
- **A second way past every wall:** cumulative stars count from every league, so a stubborn event can be made up anywhere; boss fail assist goes to 5 steps (12.5); a casual player (average place 4.5) never plays more than 6 races in a row without a new star or unlock (pacing test, 16.4).
- Quick Race layouts unlock with the league that introduces them (forward and reverse together): L1 t1, t2, t3; L2 t4; L3 t5.
- New-star bonus: 100 coins × league multiplier per star (one time).
- Layout order: the first six events show all three base maps, reverses start at event 6, and no layout id appears twice in any 3 consecutive events (unit test on the table).

### 15.2 League tiers

| League EN / RU | Layouts introduced | Recommended PR | AI skill | Bashers | Max attackers on player | Prize multiplier | Boss → reward |
|---|---|---|---|---|---|---|---|
| L1 Rookie Cup / Кубок новичка | t1, t2, t3 (+ t1r, t2r) | 100 to 106 | 0.55 to 0.85 (E1: 0.45 to 0.65) | 1 | 0 (E1), 1 | ×1.0 | Big Mo (Brawler) → **Brawler** |
| L2 Harbor Heat / Жара в порту | t4 (+ t3r, t4r) | 106 to 114 | 0.65 to 0.90 | 2 | 1 | ×1.5 | Sleet (Glint) → **Glint** |
| L3 Scrap Kings / Короли свалки | t5 | 114 to 122 | 0.75 to 0.95 | 2 | 1 | ×2.1 | Grinder (Mammoth) → **Mammoth** |
| L4 Street Brawl / Уличная драка | t5r | 122 to 130 | 0.82 to 1.00 | 3 | 1 | ×2.8 | Ace (Needle) → **Needle** |
| L5 Legends / Легенды | all | 130 to 138 | 0.90 to 1.00 | 3 | 1 | ×3.6 | Duchess, Grand Final → **Champion gold livery** (all cars), title "Legend", 15,000 coins |

The AI field PR spreads across rank t = 0 to 1 as target × lerp(0.94, 1.04, t); E1 uses 0.88 to 0.96. Within a league, event k (0 to 5) targets lo + (hi − lo) × k / 6; the boss targets hi + 2 (108, 116, 124, 132, 140). PR reachability (10.2): L5's 138 is reached by 5 maxed cars, the final's 140 by 4. "Max attackers on player" stays 1 because the sim's attack token allows one at a time (12.3); higher leagues raise attack frequency instead.

### 15.3 The 35 events
Score modes: Time Attack medal factors L1 1.10/1.05/1.01, L2 1.09/1.04/1.00, L3 1.08/1.03/0.995, L4 1.07/1.025/0.99, L5 1.06/1.02/0.985 × the AI best lap. Smash Spree and Drift Trial thresholds below are provisional: Smash Spree follows the calibration rule (13), Drift Trial starts from bot runs and is set from play-test data (G2, G2b). Thresholds live in `CONFIG.career`.

**Drift fallback:** every drift star has an alternative goal, used when `CONFIG.career.driftStars = false` (decided after the G2 play-test); each Drift Trial then becomes a Race on the same layout (top 3 / win / break 20 objects).

| Id | Layout | Mode / modifier | Laps | ★1 | ★2 | ★3 | Teaches |
|---|---|---|---|---|---|---|---|
| L1-1 | t1 | Race (**First race**, FTUE) | 2 | top 3 | win | break 15 objects | gas, steer, smashing pays, one item |
| L1-2 | t2 | Smash Spree | 90 s | 1,500 | 2,500 | 3,500 | drift lesson, pads, destruction = score |
| L1-3 | t3 | Sprint | 2 | top 3 | win | finish with ≥ 60% health | narrow roads, care, repair |
| L1-4 | t1 | Race | 3 | top 3 | win | use 3 power-ups | all four items |
| L1-5 | t2 | Time Attack | 3 | bronze | silver | gold | medal ghosts, racing line |
| L1-6 | t1r | Race / Glass Cannon | 3 | top 3 | win | 1 slam | ramming |
| L1-B | t2r | Boss Duel vs Big Mo (Brawler) | 3 | win | win by 2 s | finish with ≥ 70% health | → Brawler |
| L2-1 | t4 | Race | 3 | top 3 | win | break 25 objects | new world |
| L2-2 | t3 | Race | 3 | top 3 | win | 3,000 drift points (alt: 2 slams) | drift pays |
| L2-3 | t2 | Knockout | — | survive to the top 3 | win | 2 slams | survival |
| L2-4 | t4 | Drift Trial | 2 | 3,000 | 5,000 | 7,000 | chains |
| L2-5 | t1r | Sprint / Power-up Frenzy | 2 | top 3 | win | use 4 power-ups | item tactics |
| L2-6 | t4r | Race / No Repairs | 3 | top 3 | win | 3 slams | risk |
| L2-B | t3r | Boss Duel vs Sleet (Glint) | 3 | win | win by 2 s | 2,000 drift points in the duel (alt: finish with ≥ 60% health) | → Glint |
| L3-1 | t5 | Race | 3 | top 3 | win | break 40 objects | new world |
| L3-2 | t4 | Time Attack | 3 | bronze | silver | gold | 90° corner rhythm |
| L3-3 | t3 | Knockout / Glass Cannon | — | survive to the top 3 | win | finish with ≥ 50% health | |
| L3-4 | t5 | Smash Spree / Power-up Frenzy | 90 s | 3,500 | 5,500 | 7,500 | the playground |
| L3-5 | t2r | Race / Heavy Metal | 3 | top 3 | win | 3 slams | heavy rivals |
| L3-6 | t4r | Drift Trial | 2 | 4,000 | 6,500 | 9,000 | |
| L3-B | t5 | Boss Duel vs Grinder (Mammoth) | 3 | win | win by 2 s | slam Grinder once | → Mammoth |
| L4-1 | t5r | Race | 3 | top 3 | win | break 40 objects | |
| L4-2 | t1 | Drift Trial | 2 | 5,000 | 8,000 | 11,000 | |
| L4-3 | t3r | Time Attack | 3 | bronze | silver | gold | |
| L4-4 | t5r | Knockout | — | survive to the top 3 | win | 4 slams | |
| L4-5 | t4r | Race / One-Make | 4 | top 3 | win | win without repairs | pure skill |
| L4-6 | t2 | Smash Spree | 90 s | 4,500 | 7,000 | 9,500 | |
| L4-B | t4 | Boss Duel vs Ace (Needle) | 3 | win | win by 2 s | finish with ≥ 50% health | → Needle |
| L5-1 | t2r | Race | 5 | top 3 | win | lead at the end of lap 1 | |
| L5-2 | t1 | Knockout / Glass Cannon | — | survive to the top 3 | win | 5 slams | |
| L5-3 | t5r | Smash Spree / Heavy Metal traffic | 90 s | 5,500 | 8,500 | 11,500 | |
| L5-4 | t3 | Drift Trial | 2 | 6,000 | 9,000 | 12,000 | |
| L5-5 | t1r | Time Attack | 3 | bronze | silver | gold | |
| L5-6 | t4r | Race / Underdog | 3 | top 3 | win | 3 slams | comeback |
| L5-B | t5r | Grand Final vs Duchess (gold Scorcher) + elite field | 5 | win | win by 3 s | win without repairs | → Champion livery |

### 15.4 Quick Race (P0, open from the first hub visit after race 1)
Any unlocked layout and direction, any mode except Boss, laps 1 to 5. **Lap races always have 8 cars (player + 7 AI)**; Smash Spree, Time Attack and Drift Trial keep their mode fields (D10). Difficulty Easy / Normal / Hard (AI PR = player PR × 0.92 / 1.0 / 1.06, skill −0.1 / 0 / +0.05), rival cars (section 11), power-ups on/off. **Any of the 10 cars**, not-owned ones at showroom tune with the PR shown (10.5). No stars; coins section 16; XP ×0.7. Time Attack laps here go to the leaderboard too.

### 15.5 Daily Challenge (P0, driver level 4)
Seeded by the local date (`YYYY-MM-DD` → mulberry32): layout × mode (Race, Smash Spree, Knockout, Time Attack, Drift Trial) × one modifier × **forced car (often a locked one)** at showroom tune. Unlimited attempts, best result counts. Reward on completion 600 × league multiplier, +400 × multiplier for the gold-equivalent goal. A 7-day challenge streak multiplier ×1.0 to ×1.6; a missed day uses the **streak shield** (once per 7 days) and the streak goes on; a second missed day drops one step (×0.1), never below ×1.0.

### 15.6 Weekly Smash Cup (P0, driver level 6)
The repeatable weekly goal. Seeded by the local ISO week (Monday start) with the Daily Challenge generator: layout × mode × modifier × loaner car (any of the 10) at showroom tune, fixed field. Unlimited attempts; best result counts. Medals bronze / silver / gold / platinum (thresholds from the same bot calibration as stars); each medal pays once per week: 500 / 1,000 / 2,000 / 3,000 × the highest open league multiplier; **platinum also gives that week's exclusive paint** (never sold in the shop). Card in Today with a countdown ("ends in 2 d 5 h").

### 15.7 Legend Remix (P0, opens after the Grand Final)
All 35 events again with AI PR +5%, skill +0.05 and no fail assist. One **platinum star** per event for earning ★2 and ★3 in the same run. Prize ×1.2; 300 × league multiplier coins per platinum; exclusive cosmetics at 10 / 20 / 35 platinum (chrome rims, the "Remix" two-tone paint, title "Remix Legend"). Adds about 2.5 to 3.5 h, so the campaign runs 8 to 10 h in total.

---

## 16. Economy (P0)

One currency: **coins**. Every number below goes into the meta config (`garage`, `upgrades`, `economy`, `progression`, `cosmetics`, `mastery`).

### 16.1 Income

```
PRIZE        = [500, 380, 300, 230, 170, 130, 100, 80]          // place 1..8
LEAGUE_MUL   = [1.0, 1.5, 2.1, 2.8, 3.6]                         // L1..L5
prize        = PRIZE[place] × LEAGUE_MUL × modeMul × (laps / 3 for Race)
modeMul      = Race/Knockout 1.0 · Sprint 0.7 · Underdog ×1.5 · Legend Remix ×1.2
               Time Attack / Smash Spree / Drift: gold = PRIZE[1st], silver = [2nd], bronze = [3rd], none = [6th]
               Boss: win = 2 × PRIZE[1st], loss = PRIZE[8th]
smashCoins   = (min(S, 1500)/10 + max(0, S − 1500)/20) × LEAGUE_MUL      // S = smash points incl. slams
driftCoins   = min(D / 40, 150) × LEAGUE_MUL                              // D = drift points
starBonus    = 100 × LEAGUE_MUL per NEW star; Remix platinum 300 × LEAGUE_MUL
firstRace    = +700 once ("First race bonus")
Quick Race   = (prize + smash + drift) × {Easy 0.5, Normal 0.7, Hard 0.9} × LEAGUE_MUL[highest open]
Daily Chall. = 600 × LEAGUE_MUL[highest open] (+400 × mul for gold)
Weekly Cup   = 500 / 1,000 / 2,000 / 3,000 × LEAGUE_MUL[highest open], once per medal per week
rewarded ×2  = doubles prize + smash + drift (not star bonus, not first-race bonus)
```

Repair cost = max(20, missingHp × 0.9 × LEAGUE_MUL^0.6) × car `repairCostMul`, **capped at 40% of the current event's first prize**.

Typical race (L1, average player, 3rd place, about 700 smash points, 2,000 drift points, 1.5 new stars on a first play): 300 + 70 + 50 + 150 ≈ **570 coins** (about 420 on a replay).

### 16.2 Sinks

| Sink | Amount |
|---|---|
| Workshop levels (shared, once) | 10,350 |
| Signature levels per car (tier 1 / 2 / 3) | 19,800 / 31,680 / 47,520 (all 10 cars: about 317k) |
| Cars | other starter 2,000 · Sandhopper 3,000 · Bruiser 9,000 · Scorcher 20,000 (34k) |
| Cosmetic shop | about 23k (12 premium paints, 8 rim colours) |
| Repairs | about 5 to 8% of income |

### 16.3 Driver XP and level (P0)
- XP per race = 100 + 20 × (8 − place) + S/20 + D/50 + 60 × new stars (about 250 to 400). Quick Race ×0.7. The same XP also goes to the car's mastery (10.6).
- XP to next level = 250 + 150 × (L − 1). Cap 50.
- Level-up reward: 100 × L coins (cap 2,000). **Every level from 5 on gives something visible:** a title on the hub badge at 5 / 10 / 20 / 30 / 40 / 50 (Hotshot, Street Racer, Pro, Veteran, Road King, Living Legend) and an exclusive cosmetic at 10 / 20 / 30 / 40 / 50 (Copper rims, Midnight paint, Ice rims, Racing Stripe two-tone, Mirror chrome paint).

| Level | Unlocks (progressive disclosure) |
|---|---|
| 1 | Career L1 only; first launch drops straight into race 1 |
| 2 (after race 1) | Garage car browser, **Quick Race with any car**, Rivals sheet, Records |
| 3 | Daily tasks, daily login calendar |
| 4 | Daily Challenge |
| 5 | Cosmetic shop |
| 6 | Weekly Smash Cup |
| 8 | Weekly tasks (P1) |

### 16.4 Curve: first 2 hours (reference player, average skill, no ads)
Targets for the pacing script (hybrid upgrades, gates and tables above); WP7 re-measures this table and its pacing test must keep the ranges below.

| Time | Race # | Milestone | Coins earned (cumulative, incl. 300 start) | Typical spend | Lv | Cars |
|---|---|---|---|---|---|---|
| 0:02 | 1 | First race won; **choose 2nd car** (Gravel or Brick); guided Workshop Engine L1 | 1,600 | Engine W1 (450) | 2 | 2 |
| 0:07 | 3 | Smash Spree with the drift lesson; Frost Pass Sprint; daily tasks appear | 3,300 | Grip W1, Armor W1 | 3 to 4 | 2 |
| 0:12 | 5 | other starter buyable (3★) | 5,000 | 2,000 car **or** Engine W2 | 5 | 3 |
| 0:18 | 7 to 8 | Big Mo opens (★1 on 5 events) | 6,800 | Workshop L2 | 5 to 6 | 3 |
| 0:22 | 9 to 10 | **Beat Big Mo → Brawler; Harbor Heat opens** (12★): the first new world at about 22 min | 8,500 | | 6 | 4 |
| 0:30 | 13 | Sandhopper (6★ + 3,000) | 13,000 | 3,000 | 8 | 5 |
| 0:40 | 17 | Bruiser (18★ + 9,000) | 19,000 | 9,000 | 9 | 6 |
| 0:48 | 20 to 21 | **Beat Sleet → Glint; Scrap Kings opens** (25★, Scrapyard) | 25,000 | Workshop L3 | 10 | 7 |
| 1:15 | 31 to 33 | **Beat Grinder → Mammoth**; Street Brawl opens (41★) | 41,000 | first Signature levels | 12 | 8 |
| 1:40 | 42 to 44 | Scorcher (34★ + 20,000) | 55,000 | 20,000 | 14 | 9 |
| 2:00 | 50 to 52 | mid L4 | 68,000 | Signature levels | 15 | 9 |

New car cadence: minute 2, about 12, 22, 30, 40, 48, 75, 100; Needle (L4 boss) at about 2.6 h.

Pacing test targets (60 seeds):
- **Reference player:** L2 opens by race 8 to 12, L3 by 18 to 26, L4 by 30 to 44, L5 by 48 to 70; career complete in 95 to 160 races (median about 5 to 5.5 h); Legend Remix complete in a further 60 to 90 races; at most 4 races without an affordable goal (car, upgrade, cosmetic or claimable reward) in the first 60 races.
- **Casual player** (average place 4.5): L2 by race 14, L5 by race 110; never more than 6 races in a row without a new star or unlock.
- **After the career:** a 30-day simulation after the Grand Final always has at least one open goal (Remix stars, a weekly medal, a mastery level, a shop item, a record or leaderboard improvement).

### 16.5 First week (typical web player)
Sessions: D0 25 min, D1 15, D2 12, D4 15, D5 12, D7 15 (about 1 h 50 total).

| Day | What happens |
|---|---|
| D0 | First win, 2nd car, L1 boss beaten → Brawler, **Harbor Heat opens** (4 cars), driver level 7 |
| D1 | Login day 2 (500); first full daily task set (+400); L2 half done; Sandhopper |
| D2 | Login day 3 (700 + paint "Lime Fizz"); L2 boss → Glint; **Scrapyard opens** |
| D4 | Login day 4; first Weekly Cup medal (level 6); Bruiser |
| D5 | Login day 5 (1,200); Daily Challenge streak ×1.4 |
| D7 | Login day 7 (2,500 + paint "Lightning"); L3 boss attempts → Mammoth |

Heavy player (about 5 h in week 1): L5 open, 9 cars, the first Signature levels on a tier 3 car, a mastery level 3 car.

### 16.6 Long arc
Career about 95 to 160 races (median about 5 to 5.5 h); with Legend Remix 8 to 10 h. 100% (all stars and platinum stars, all cars owned and maxed, every cosmetic) about 30 to 35 h. Sources over 30 days ≈ 180k races + 45k daily + 30k weekly + 40k achievements + 30k levels + 10k mastery ≈ 335k against ≈ 384k of sinks (Workshop 10k + Signature 317k + cars 34k + cosmetics 23k): the collector always has something to buy, and the weekly cup, mastery, records and leaderboards keep going after that. Rewarded ×2 (30 to 40% of players) shortens this by about 25%.

---

## 17. Daily rewards, tasks, achievements, records, leaderboards

### 17.1 Login calendar (P0)
Own implementation in Bridge storage (works on every platform): keyed by local date `YYYY-MM-DD`, ignores a clock moved back by more than 1 h (`maxClock`), **missing a day never resets the streak** (D7). Popup from session 2 (driver level 3 or more) with [Claim] and [AD · Claim ×2]; it appears only after `game_ready` (never over the loading screen) and has a visible close button.

| Day | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| Reward | 300 | 500 | 700 + paint "Lime Fizz" | 900 | 1,200 | 1,500 | 2,500 + paint "Lightning" |

Cycle 2+: coins × (1 + 0.25 × (highest league − 1)); a new exclusive paint from the pool on days 3 and 7 of each cycle.

### 17.2 Daily tasks (P0, driver level 3)
3 per day, generated deterministically from the local date seed; only tasks the player can do with current unlocks (no "score in a Smash Spree" before Smash Spree exists). **No task rewards bad or passive play** (no "finish with low health", no "drive N km"). Reward × (1 + 0.5 × (highest league − 1)). **All 3 done: +400 × scale coins + 300 XP.** P1: one free reroll per day via rewarded ad.

| id | Task EN | Base reward |
|---|---|---|
| win1 | Win a race | 250 |
| podium3 | Finish in the top 3 three times | 300 |
| smash60 | Break 60 objects | 200 |
| takedown3 | Make 3 slams | 300 |
| drift3k | Score 3,000 drift points | 250 |
| cleanDrift5 | Make 5 clean drift exits (only with drift stars on) | 200 |
| items6 | Use 6 power-ups | 200 |
| nitro5 | Use Nitro 5 times | 150 |
| slip3 | Use slipstream 3 times | 150 |
| lead30 | Lead a race for 30 seconds in total | 250 |
| stars2 | Earn 2 stars | 300 |
| rampage2k | Score 2,000 in a Smash Spree | 250 |
| bestlap | Beat your best lap on any track | 250 |
| walls10 | Smash 10 wall segments | 200 |
| road5 | Tear up 5 road chunks | 200 |
| reverseWin | Win on a Reverse track | 300 |
| parts5 | Knock 5 parts off rivals | 200 |
| carX | Race with {car} | 200 |
| newCar | Finish a race with a car you did not use last time | 200 |
| sameRivals | Race with "Same as mine" rivals | 150 (teaches the owner's feature) |
| repair1 | Repair your car once | 150 (teaches repair) |
| weekly1 | Earn a Weekly Cup medal (level 6) | 300 |

### 17.3 Achievements (P0: 26)
Own implementation (counters in the save); mirrored to Bridge achievements if supported (P1). Each pays coins once.

| id | Name EN | Condition | Coins |
|---|---|---|---|
| firstFinish | First Finish | finish a race | 200 |
| podium | Podium | first top 3 | 300 |
| firstWin | Winner | first win | 500 |
| boss1 | Rookie Champion | beat Big Mo | 1,000 |
| boss2 | Harbor Master | beat Sleet | 2,000 |
| boss3 | Scrap King | beat Grinder | 4,000 |
| boss4 | Street Boss | beat Ace | 7,000 |
| legend | Legend | win the Grand Final | 15,000 |
| wrecking | Wrecking Ball | break 1,000 objects in total | 1,500 |
| demolition | Demolition Expert | break 10,000 objects in total | 5,000 |
| roadRipper | Road Ripper | tear 100 road chunks | 1,000 |
| takedown25 | Slam Artist | 25 slams | 1,000 |
| takedown250 | Slam Legend | 250 slams | 5,000 |
| collector | Collector | own 5 cars | 2,000 |
| fullGarage | Full Garage | own all 10 cars | 10,000 |
| maxed | Maxed Out | one car at level 5 in every branch | 3,000 |
| stars50 | Star Hunter | 50 stars | 3,000 |
| stars105 | Superstar | all 105 stars | 15,000 |
| driftKing | Drift King | 10,000 drift points in one race | 2,000 |
| untouchable | Untouchable | win with ≥ 95% health | 800 |
| comeback | Comeback | win after being last at the end of lap 1 | 1,500 |
| mirror | Mirror Match | win with "Same as mine" rivals | 500 |
| loyal | Loyal Racer | claim 7 login days | 1,000 |
| phoenix | Phoenix | win after being wrecked in the same race | 1,000 |
| master1 | Car Master | one car at mastery 5 | 2,000 |
| remix35 | Remix Legend | all 35 platinum stars | 10,000 |

### 17.4 Records (P0)
Per layout (10): best lap in any mode (and the car it was set with), best Time Attack lap, best Smash Spree score, best Drift Trial score, top speed, biggest combo, most slams in one race. Global: best drift, longest drift chain, and the stats counters. Shown on the Records tab (20.12); Results shows "NEW RECORD: …" lines and the lap delta to the personal best; the HUD lap banner shows the delta (exists). Saved in `records` (23).

### 17.5 Leaderboards (P0, decided; D12)
- **Boards:** one per layout, 10 in total, ids `lap_t1`, `lap_t1r`, … `lap_t5r`; score = lap time in ms, lower is better; any car (D12).
- **Source:** only **Time Attack** laps (career events and Quick Race). Race laps stay local records, because items, slipstream and rivals make them unfair.
- **Valid lap:** every sector in order (9.4), no wrong way, no respawn or reset during the lap, and not faster than 0.85 × the layout's gold medal time (sanity floor). Only valid laps are submitted.
- **Submit:** once at the end of a Time Attack session, the session's best valid lap, and only if it beats the player's best submitted lap (`lbSubmitted`).
- **Show:** the Records tab shows, per layout, the player's rank and the top 10 when the platform answers; nothing leaderboard-related is rendered when `bridge.leaderboards.type` is `not_available` and SaaS leaderboards are not configured.
- **Before release (WP17):** the 10 boards are created in the Playgama console with matching ids and the real SaaS public token replaces the placeholder (or the `saas` block is removed if the boards cannot be made); a test fails on any placeholder string in `public/playgama-bridge-config.json`.

---

## 18. Ads and monetisation

### 18.1 Rewarded (opt-in; the button says it is an ad and shows the exact reward; reward only on the Bridge `rewarded` state)

| # | Placement | Reward | Cap | P |
|---|---|---|---|---|
| R1 | Results | ×2 race coins ("AD · +1,240") | once per race | P0 (exists, moves under the total) |
| R2 | Login popup | ×2 day coins | 1 per day | P0 |
| R3 | Pause (health < 70%) | free full repair | 1 per race | P0 |
| R4 | Career event card, locked car | race this event with that car | 3 per day | P0 |
| R5 | Event card after a failed attempt | start with Nitro in the slot | 1 per attempt | P0 |
| R6 | Daily tasks | reroll one task | 1 per day | P1 |
| R7 | Garage, short of coins (shortfall ≤ 40% of price) | min(shortfall, 25% of price) | 3 per day | P1 |
| R8 | Weekly cup | extra loaner upgrade | 1 per day | P1 |

- **When `bridge.advertisement.isRewardedSupported` is false, no rewarded control is rendered at all** (R1 to R8), and every flow still works without it: the results total stays single, the login claims once, repair costs coins, a locked car stays locked in Career (free in Quick Race), events start without Nitro.
- At most one ad offer per screen. Everything is reachable without ads. If an ad fails: a toast, the button stays, nothing is lost.
- The game and its audio are paused while any ad is open, and input is ignored for 0.5 s after an ad closes (no accidental tap on the next screen).

### 18.2 Interstitials
- **Marked natural pauses:** Results → NEXT and Results → back to the hub, and Quit or Restart from Pause (exists). Each calls `showInterstitial()` before acting, behind a 0.3 s "Loading race…" curtain.
- **Not marked:** Results → RETRY, Results → GARAGE, the Results visit in which a rewarded ad was just watched, the first race's Results (FTUE rule in code), menu-to-menu navigation, any reward reveal. Never while racing or finishing.
- **Timing belongs to the Bridge** (requirement, no game-side timers or counters): `public/playgama-bridge-config.json` keeps the documented `minimumDelayBetweenInterstitial: 60`; 180 only if Playgama confirms it (WP17 asks); `initialInterstitialDelay` is not relied on. WP11 reports the exact keys used.
- `CONFIG.ads.markRetry` (default false) marks RETRY too, in case moderation asks for it.
- Expected: about 3 to 4 interstitials and 3 to 5 rewarded views per 15-minute session at the 60 s default.

### 18.3 IAP-ready, not built (P2; reserved in P0)
- **Reserved now** so payments never need a save or contract change: `SaveDataV2.purchases: string[]` (empty), a hidden `store` screen id (real money; never shown unless `payments` is supported and a catalog exists), and a `grantCoins(source)` hook in the economy. Test: the game works with `payments` unsupported and the store never renders.
- Later: `src/meta/store.ts` + a payments wrapper; prices always from `getCatalog()`; consume unprocessed purchases at boot; restore permanents every launch. Catalog idea: Remove interstitials (permanent), a cosmetic bundle + coins (no cars: cars stay behind stars and bosses), coin packs. No random boxes.

---

## 19. FTUE script (P0)

Principle: on first launch **no menu, no modal, no reading**. On the grid within 5 s. Each skill is taught at the moment it is needed, by a prompt of at most 4 words plus an icon, only while the player is not doing it yet. At most one prompt on screen, at least 20 s between prompts, each prompt at most twice (`src/ui/tips.ts`). A small "Skip" chip (top-left) ends the FTUE for returning players on a new device. **Race 1 teaches only gas, steer, smash and one item**; drift and pads come in race 2, the other items in race 4.

### 19.1 Race 1 (L1-1, t1, 2 laps, 879 m per lap)

| t | Beat | Player sees and does | Teaches |
|---|---|---|---|
| 0 to 3 s | Boot | loading bar with a car silhouette; Bridge init; one save load | |
| 3 to 5 s | Grid | 1.2 s camera sweep onto the player car on the grid; pulsing GAS with a ghost thumb and "HOLD" (touch) or big key caps "W / ↑" (PC). **`game_ready` is sent here**, once the grid is rendered and interactive | |
| about 5 s | First touch | GAS unlocks audio **and** starts a compressed countdown (0.5 s per light) with the car already throttled | gas |
| 5 to 12 s | Straight | "SLIDE TO STEER" (← thumb →) when the first bend is < 60 m away and the player has not steered; steering arc visible | steer |
| 8 s | Overtakes | player starts 5th of 8 against a weak field (skill 0.45 to 0.65, PR ×0.88 to 0.96, mistakes ×1.5); "+1 POS" pops with a whoosh | position = goal |
| 12 to 20 s | Smash | crate and barrel cluster on the racing line at s 150 to 200 m: "SMASH IT!" and "+points" pops flying into the race counter | smashing pays |
| 22 to 35 s | Item | first box row at about s 300 m; the first box = Nitro; the slot pops in; "TAP TO USE" with a ghost finger on the slot (gas holds over the thumb hop) or key cap "E"; pulses once more after 4 s unused | items |
| about 32 s | Lap 2 | "FINAL LAP" banner | |
| 32 to 62 s | Final lap and win | AI ahead eases off off-screen (FTUE ease ×2); pads on the track simply pop "BOOST!" (feedback, no lesson); player crosses 1st; 0.4 s slow motion, confetti, camera pull-out | winning feels great |
| 62 to 75 s | Results | the full sequence with "First race bonus +700"; no ad button and no interstitial on this screen | reward |
| 75 to 85 s | **Choose your 2nd car** | reveal card with two cars side by side: Gravel ("Born sideways") and Brick ("Slow. Unstoppable. Rude."); tap one = owned; close X = decide later in the garage | choice ownership |
| 85 to 100 s | Guided garage | one highlighted button "UPGRADE YOUR CAR"; hand pointer on Workshop Engine level 1 (450); the car revs and the bar fills; CTA **RACE AGAIN** → L1-2 | upgrades |

The timeline is checked by the scripted bot (PLAN WP13a): every prompt fires inside its window ± 5 s at the bot's average-player pace.

Failure safety: if the player is not in the top 3 at the start of lap 2, the off-screen ease strengthens further. If they still lose, Results celebrates "Finished!" with the full bonus and the next attempt keeps the easy settings. Never a grey "7th" on race 1.

### 19.2 Races 2 to 5
- **Race 2 (L1-2, Smash Spree on t2):** mode card "Smash everything in 90 seconds"; a chip "Auto-drift: ON · Settings" for 3 s on the grid (touch only); **drift lesson** at the 12 m hairpin (its s position is in the t2 track config): the arc's DRIFT zone glows, "STEER HARD TO DRIFT" (touch) or "HOLD SPACE TO DRIFT" (PC), then "EASE OFF TO BOOST"; **pads** on the 145 m straight: "BOOST!". No position pressure.
- **Race 3 (L1-3, Sprint on t3):** "Tap GAS on GO for a perfect start"; "TAP TO FIX" when health first drops below 40%.
- **Race 4 (L1-4, Race on t1):** first pickup of each other item shows its one-line tip (Shield: "Rams hurt you less"; Shockwave: "Blasts rivals away"; Repair Kit: "Fixes your car").
- **Race 5 on:** "Pro tip: flick up to use without lifting your thumb" (touch, once).

Contextual tips after the FTUE (each once): first wreck → "Repairs and repair kits fix your car"; first Knockout → mode card "The last car is out every 15 seconds"; first slam chance (alongside a rival near a wall) → "Ram rivals into walls!"; first time a style meter fills → "SMASH NITRO READY: tap the slot".

`SaveData.ftueStep` (0 to 6, 6 = done; migration: `tutorialDone === true` → 6), `tipsSeen` (bitmask) and `modeCardsSeen` (bitmask).

---

## 20. Screens and flow (P0)

### 20.1 Screen map

```
Boot ─► (first launch) FTUE race L1-1 ─► Results ─► Choose 2nd car ─► Guided garage ─► L1-2 …
     └► (returning) HUB (game_ready) ─► Login popup (if claimable)
HUB
 ├─ [RACE] next recommended event (1 tap) ─► grid splash ─► Race ─► Results
 │        Results ─┬─ [NEXT]   ─► interstitial? ─► next event
 │                 ├─ [RETRY]  ─► same event (fail assist applies; no interstitial)
 │                 └─ [GARAGE] ─► Garage ─► [RACE] (no interstitial)
 ├─ Event card chips: [Car ▾] [Rivals ▾]   (bottom sheets, no new screen)
 ├─ CAREER  (league tabs ─► event cards ─► tap = set as next event, RACE; Legend Remix tab after the final)
 ├─ GARAGE  (Cars / Upgrade / Paint tabs, RACE always present)
 ├─ QUICK RACE (layout, mode, laps, rivals, difficulty, car: any car)
 ├─ TODAY   (login calendar, daily tasks, Daily Challenge, Weekly Smash Cup)
 ├─ TROPHIES (Achievements · Records + leaderboards · Stats)
 ├─ SHOP    (paints, rims; from level 5; reachable from the garage Paint tab and the hub)
 ├─ (hidden) STORE — real-money screen id, reserved, never shown (18.3)
 └─ ⚙ SETTINGS
```

Every popup and sheet (login, reveal, rivals, car, mode card, confirm dialogs) has a **visible close button** (X, 44 px, top-right) and also closes on a backdrop tap and on Backspace; Esc is never used.

### 20.2 Tap counts (P0 acceptance)

| Journey | v0.1.1 | v0.2 |
|---|---|---|
| First launch → driving | 3 taps + a modal | 1 (hold GAS) |
| Returning launch → driving | 2 | 1 (RACE) |
| Results → next race | 3 + interstitial | 1 |
| Results → retry | 3 | 1 |
| Results → upgrade → race | 4 | 3 |
| Change car then race | n/a | 3 (Car chip → car → RACE) |
| Change rivals | n/a | 2 |

### 20.3 HUB (portrait 390×844; safe areas added)

| Zone | y px | Content |
|---|---|---|
| Top bar | 0 to 64 | level badge with title + XP bar (left); coin chip, **mute button** 44 px, ⚙ 44 px (right) |
| Hero | 64 to 420 | the existing 3D menu scene with the **selected car**; name + class tag ("GLINT · Speedster"); on the first hub visit the one-line premise (1) under the name |
| Next goal strip | 420 to 470 | one line, always present (20.8) with a progress bar |
| Event card | 470 to 640 | layout thumbnail (existing SVG), league · event, mode icon, laps, "up to 1,140" coins, 3 stars with goals, PR recommended vs yours (colour-coded); chips [Car ▾] [Rivals: Mixed ▾]; R5 offer after a failed attempt |
| CTA | 650 to 740 | **RACE** with an SVG play icon, full width, 88 px tall, orange, glow pulse after 6 s idle |
| Bottom nav | 760 to 844 | Career · Garage · Quick Race · Today · Trophies; 56 px; red dots on claimables |

Landscape 844×390: hero car fills the left 55%; the right column holds goal strip, event card, chips and RACE; the bottom nav becomes a vertical rail at the far left. Square 600×600: hero 45% of the height, event card and RACE below, nav at the bottom; nothing clipped or overlapping. PC: Enter = RACE.

The first hub after race 1 shows the unlock reveal "Quick Race with any car, even locked ones" with [Try now] [Later].

### 20.4 Garage (P0)

```
┌ ◄  GARAGE                       ● 1,830 ┐
│ [ CARS ] [ UPGRADE ] [ PAINT ]           │  segmented tabs, 44 px
│      ◄   (3D car on a turntable)   ►     │  swipe (40 px or 0.4 px/ms), ◄ ► 48 px, ←/→ keys
│   ● ● ◉ ● ● ▣ ▣ ▣ ▣ ▣  (10 dots, lock glyph SVG)
│   GLINT                 [SPEEDSTER]      │  name + class badge (icon + text, colour-blind safe)
│   "Fast and fragile"     Mastery ★★☆☆☆   │  line + mastery
│   ⚡ Perk: Slipstream Pro … (1 line)     │  perk card
│   PR 109 → max 140                       │
├──────────────────────────────────────────┤
│ SPEED     ████████░░  8   ▲+4            │  6 absolute bars; deltas vs selected car
│ ACCEL     ███████░░░  7   ▲+2            │  ghost segment = this car's max upgraded value
│ HANDLING  ████████░░  8   ▲+3
│ DRIFT     ██████░░░░  6   ▲+1
│ ARMOR     ██░░░░░░░░  2   ▼−2
│ WEIGHT    ███░░░░░░░  3   ▼−1
├──────────────────────────────────────────┤
│ [ SELECT ] / [ ✓ SELECTED ]              │
│ locked: [ UNLOCK ● 9,000 · 18★ ] [ TRY IN QUICK RACE ]  (reason + progress always visible)
│ "Drive it free in Quick Race. Own it to use it in Career."
│              [ RACE ]                    │
└──────────────────────────────────────────┘
```

- Locked cars are always visible as dark silhouettes with a rim light and the exact requirement ("Beat Sleet in Harbor Heat", "● 9,000 · 18★ (you have 14★)").
- Upgrade tab: 3 rows with 5 pips; pips 1 to 3 are marked "Workshop · all cars", 4 and 5 "Signature · this car"; concrete effects, cost button with a disabled reason ("Need 340 more"); PR before → after.
- Paint tab: 8 free swatches, owned premium paints and rim colours, exclusives with their source; a "Shop" button (level 5).
- Red dot on Garage when an upgrade for the selected car is affordable, a car is unlockable, or something new is unviewed.
- Landscape: car left, tabs and content right; no page scroll.

### 20.5 Car sheet and Rivals sheet (P0)
- **Car sheet** (event card chip): a horizontal strip of cards, each with the car thumbnail, name, **PR vs recommended** (green at or above, yellow within 5, red below), Speed / Handling / Armor bars, the perk line, and for a locked car in Career either "AD · Race this event with it" (R4) or its requirement. Close X.
- **Rivals sheet:** the 4 options (section 11) as large radio cards, the model grid for One model, the **rival preview row** (7 small car icons with driver name and PR), and the line "Rival strength is set by the event, so every choice is fair." Fixed-field events show "This event has a fixed field". Close X. The choice persists.

### 20.6 HUD (P0)

Portrait 390×844:

| Element | Position | Content and behaviour |
|---|---|---|
| Position | top-left, 96×64 | "3/8", number 40 px tinted gold/silver/bronze; "+1 POS" pop and a 1.25 → 1 punch on gain; red flash on loss (no sound) |
| Gaps | under Position | "▲ 0.8 s" to the car ahead and "▼ 1.2 s" to the car behind (16 px; SVG triangles); hidden in solo modes |
| Lap | under Gaps | "LAP 2/3" + thin lap progress bar; lap banner "LAP 2/3 · 0:27.41 (−0.42)" for 1.4 s; gold "BEST LAP!" flash |
| Timer | top-centre, 20 px | race time; mode timers (Smash Spree time left, Knockout "Elimination in 8 s") replace it |
| Pause | top-right, 48 px | SVG |
| Minimap | top-right under Pause, 88×88, 70% opacity | north-up outline pre-rendered once to an offscreen canvas; player 8 px dot with a white ring, rivals 5 px in their colours, leader crown, revenge rival with a red ring; dots redrawn at ≤ 30 Hz; pointer-events none |
| Race coins | under the minimap | "● +48" (this race), replaces the wallet; pops fly into it |
| Damage | left edge, y ≈ 190, 44×80 | 9-zone silhouette + health bar + %; hue ramp **plus crack hatching** below 50% (colour-safe); white flash on hit; lost parts shown as gaps, restored on any heal |
| FIX chip | right of the silhouette, only below 70% health | affordable: yellow "FIX ● 120"; not affordable: grey with lock + toast "Need 267 more"; AD free repair lives in Pause |
| Item slot | above GAS, **72 px** circle | item icon; tap = use (the default); "flick ↑" glyph appears only after the flick tip; style ring around GAS; hidden when empty |
| GAS | bottom-right (bottom-left in left-handed) | exists, plus the steering arc |
| 2nd-finger button | bottom-left, 66 px | BRAKE / DRIFT / off (setting) |
| Speed + boost | bottom-centre, 132×56 | speed 28 px; 3/4 arc for the active boost; "SLIPSTREAM" chip |
| Drift meter | world-space above the car | "DRIFT 420 ×2", colour by tier |
| Smash pops | world-space at the break | "+40", "SMASH ×4", "SLAM! Blaze", "REVENGE!" banners |
| Revenge marker | world-space over the rival | red chevron (9.2) |
| Wrong way | centre, 30% from top | red arrow + "WRONG WAY"; "Tap to go back" after 5 s |
| Missed checkpoint | centre | "MISSED CHECKPOINT" + arrow back |
| Wreck card | centre | "WRECKED · back in 1.8 s" |
| Toasts | top-centre | max 2 (exists) |

- Landscape 844×390: Position, Gaps and Lap in one row top-left; minimap left of Pause; damage silhouette at left-middle; item slot **left of** GAS; speed bottom-centre. Square 600×600 and small 320×568: the same clusters, scaled to fit; no overlap, nothing clipped (gate item 17).
- PC 1280×720: as landscape; key hints ("R" on FIX, "E" on the item slot, "Space" on the drift meter) for the first 3 races only.
- Nothing may sit in the centre 50% × 60% box (car and road ahead). All pops and the drift meter share one pooled DOM layer (max 8 alive) and move by `transform` and `opacity` only, never reading layout; Reduce motion removes scaling.

### 20.7 Results sequence (P0)
Any tap skips to the end state.

| t (ms) | Beat |
|---|---|
| 0 | during `resultsDelay` (2.5 s, exists): finish slow motion, orbit, confetti for the podium |
| 0 to 600 | card slides up; medal drops in ("1st!" or "4th · 0.6 s to the podium"); behind the card, the **crash replay** (below) |
| 600 to 1,800 | coin breakdown, one row every 250 ms with ticks: Place prize · Smash (objects, slams) · Drift · New stars · First race bonus; **Total** counts up |
| 1,800 to 2,400 | the event's stars light up one by one (new star bursts) |
| 2,400 to 2,800 | **NEW RECORD** lines (best lap with the delta, top speed, combo, slams, score), each with a short sparkle |
| 2,800 to 3,600 | XP bar fills; level-up flash and its reward card; mastery bar of the car |
| 3,600 | unlock reveal cards (car, league, track, feature), one shared component |
| 3,600+ | next-goal line; buttons stagger in (80 ms) |

**Crash replay (P0, fallback P1):** the sim keeps a ring buffer of every car's pose for the last 6 s at 30 Hz plus impact events; Results replays the player's last slam or wreck for 3 s in slow motion behind the card (cars from the buffer, sparks and debris re-emitted; walls shown as they are at the finish).

Buttons (portrait, thumb-friendly, bottom-up): **NEXT** (72 px, orange; becomes RETRY when the player finished below 3rd and earned no star) · row [RETRY] [GARAGE] (red dot if affordable) · [AD · +N coins] above NEXT, secondary styling, exact N (not rendered when rewarded is unsupported). Play, retry and star icons are inline SVG, never text glyphs that a phone font can turn into emoji. Collapsible finish order: place, driver · car · trait, gap, head-to-head (top 3 always visible). "Tomorrow" previews at the bottom: calendar reward, tasks timer, weekly cup timer.

### 20.8 Next-goal resolver (P0, `meta/goals.ts`, pure)
One line, priority order: claimable reward > affordable upgrade for the selected car > car unlock within reach (≤ 3★ or ≤ 25% coins) > stars to the boss > boss to the next league > daily tasks progress > weekly medal > mastery level within 1 race > best-lap improvement. Examples: "2★ to unlock Sandhopper", "You can afford Engine level 3", "1 event to face Big Mo", "Beat Sleet to open Scrap Kings", "Gold medal in the Weekly Cup".

### 20.9 Pause (P0)
Resume (big), Repair (coins) or **AD · Free repair** (once per race, not rendered when rewarded is unsupported), Restart and Quit (two-tap confirm, interstitial on leave), quick toggles row (**Mute**, Music, Camera Fixed/Follow, Left-handed), the event's star goals with live progress (P1), a small control pictogram (P1).

### 20.10 Settings (P0 unless marked)

| Section | Setting | Values (default) |
|---|---|---|
| Controls | Camera | **Fixed** / Follow (D5) |
| | Drift assist | **On** (touch), Off (PC) |
| | Brake tap = drift | **Off** |
| | Flick up to use item | **On** (off = tap the slot only) |
| | Steering sensitivity | 70 to 140% (100%) |
| | Left-handed | Off |
| | 2nd-finger button | **Brake** / Drift / Off |
| | Auto gas | Off (exists) |
| | Vibration | **On**; hidden when `navigator.vibrate` is missing |
| | Control hints | **On** |
| | Show my ghost | **On** |
| Sound | Mute | Off (also on the hub and in Pause) |
| | Music volume, Effects volume | sliders 0 to 100 (32 / 90); saved on release |
| Graphics | Quality | Auto / Low / Medium / High (exists; applies at the next race) |
| | Screen shake | **Full** / Reduced / Off |
| Accessibility | Reduce motion | Off |
| | Reduce flashes | Off (P1) |
| | Colour-safe damage | **On** |
| | Text size | 100 / 115 / 130% (P1) |
| Language | globe icon + "English" / "Русский" (native names), and a small "Auto / Авто" option | Auto (exists) |
| Other | Credits | only if any audio needs attribution (22) |
| | Replay tutorial | (P1) |

No "Reset progress" button.

### 20.11 Unlock reveal (P0, one component)
Dim → card flips with a CSS light burst → name + one line of what it does → [Use now] [Later] + close X. Used for cars, leagues, layouts, paints and features.

### 20.12 Records (P0, Trophies tab)
One card per layout (10, with forward and reverse side by side): best lap and its car, best Time Attack lap with **leaderboard rank and top 10** (when available, 17.5), best Smash Spree and Drift Trial scores, top speed, biggest combo, most slams. Global row: best drift, longest chain, totals. Tap a card → Quick Race on that layout.

### 20.13 Shop (P0, coins only, from level 5)
Tabs Paints and Rims; each item shows price, owned state and a live preview on the hero car; exclusives show where they come from ("Weekly Cup platinum", "Mastery 3"). No real-money items (18.3).

---

## 21. Juice list (P0 unless marked)

Presentation slow motion = the game loop's time scale (`src/fx/slowmo.ts` controller, applied in `game.ts`). Sim time stays authoritative, so lap times and ghosts are unaffected. Audio rate ×0.7 and a 900 Hz low-pass during slow motion (never raises any gain). Never in the 3 s before the player finishes (except photo finish, P1). Cooldown 8 s.

| Event (player involved) | Hit-stop (fx) | Slow motion | Shake | Particles and debris | Sound | Haptic | HUD |
|---|---|---|---|---|---|---|---|
| Light impact (< 0.3) | — | — | 0.9·s | sparks 6 | impact_light | 15 ms | — |
| Heavy impact (≥ 0.6) | 0.1 s at 0.2 (exists) | — | 0.9·s + kick | spark fan, dust | impact_heavy + crunch | 40 ms | — |
| Wall smashed through | 0.08 s | — | 0.25 | 2 to 3 debris (break pool), dust 8 | crunch + debris | 30 ms | +40 |
| Part flies off | — | — | 0.1 | the part itself (part pool, 2.0 s) | part_off | 20 ms | — |
| Slam | 0.12 s | 0.3× for 0.4 s | 0.5 | 30 sparks + ring | takedown_stinger | 60 ms | banner |
| Revenge | as slam | as slam | 0.5 | red ring | takedown_stinger + revenge | 60 ms | REVENGE! |
| Player wrecked | — | 0.35× for 0.5 s | 0.6 | smoke burst + parts (part pool) | wrecked_stinger | 90 ms | WRECKED card |
| Rival eliminated (Knockout) | — | — | 0.3 (if on screen) | explosion sparks + parts (part pool) | explosion | — | "Blaze is out!" |
| Drift tier up | — | — | — | colour burst at rear wheels | drift_tier1/2/3 (pitch 1 / 1.12 / 1.26) | 10 ms | tier ring |
| Drift boost exit | — | — | 0.08 | exhaust flame 0.3 s, speed lines | boost_whoosh | 20 ms | +points |
| Boost pad / Nitro | — | — | 0.1 | streaks, flame | pad_zap / nitro_loop | 20 ms | arc |
| Slipstream | — | — | — | wind streaks | slipstream_wind (loop) | — | chip |
| Perfect start | — | — | 0.15 | tyre smoke burst | perfect_start | 30 ms | PERFECT START |
| Item pickup / ready | — | — | — | box shatter (2 debris) | pickup / item_roulette / item_ready | 10 ms | slot pop |
| Shield up / hit | — | — | — / 0.3 | bubble | shield_up / shield_hit | 25 ms | — |
| Shockwave (own / hit by) | 0.06 s | — | 0.3 / 0.5 | 9 m ground ring | shockwave_blast | 50 ms | — |
| Repair (coins / kit / ad / respawn) | — | — | — | sparkle + wrench; parts pop back on | repair_ratchet | 20 ms | health bar fill |
| Position gained | — | — | — | — | pos_up | — | +1 POS |
| New record | — | — | — | — | record | — | NEW RECORD |
| Final lap | — | — | — | — | final_lap | — | banner |
| Wrong way | — | — | — | — | wrong_way | — | arrow |
| Finish | — | 0.5 s at 0.5 | — | confetti (podium) | finish | 40 ms | — |
| Near miss (P1) | — | — | — | wind streak | near_miss (panned) | — | +20 |
| Photo finish (P1) | — | 0.25× for 0.6 s | — | — | — | — | — |

**Debris budget (owner rule, D11):** at most **60 pieces alive in total**: a break pool of 36 (2 to 3 pieces per break, life 1.5 s with fade) and a car-part pool of 24 (life 2.0 s with fade), so wrecks, Knockout explosions and a Shockwave breaking many props can never evict flying parts. A full pool recycles its own oldest piece. Part pieces use `partDebris(modelId, part)` from the car-model module (shape, size, colour), so every model's own bonnet, door or wing flies off.

UI juice: coin count-up ticks, medal bounce, star burst, XP bar fill, level-up flash, card flip, button press scale 0.96, red-dot pulse. Particle budget: drift sparks use the existing "essential" spark pool (visible on low quality), max 40 per car per second, only for cars inside `emitRange`. Every FX type is one pooled InstancedMesh or Points object that always exists, warmed up before the race starts (no shader compile hitch on first use).

---

## 22. Audio (P0)

### 22.1 Release blocker and sourcing
Playgama rejects code-synthesized sound (3.3.2) and requires background music (3.3.1). **A dedicated sourcing package (PLAN WP14) starts in the first wave** so the first play-test already has real sound:
- Sources: CC0 recordings and packs first (no attribution needed); CC-BY only with an entry in Settings → Credits. No brand or product sounds.
- **Licence log in `docs/AUDIO.md`:** file, source URL, licence, author, edits made. Every file in `public/sfx` and `public/music` needs a row (test).
- **Hard gate for the Playgama upload (G4):** no MUST-REPLACE rows, no file generated by code (`scripts/make-sfx.sh` is not part of any build), the owner has approved the music. Placeholders may exist only in early play-test builds.
- Budget: sfx ≤ 2.5 MB (ogg + mp3), music ≤ 2.5 MB (2 tracks, mp3 only, about 96 kbps, ≥ 90 s each, seamless loops: menu and race).

### 22.2 Engines per car (the "engine changes with RPM" requirement, for 10 cars)

| Loop | Cars | Pitch idle → max | Character |
|---|---|---|---|
| engine_small | Scrapper, Gravel, Sandhopper | 0.80 → 1.90 | light four-cylinder buzz |
| engine_v8 | Brawler, Bruiser, Scorcher | 0.70 → 1.60 | deep burble; Scorcher +0.1 pitch and exhaust pops on lift-off |
| engine_high | Glint, Needle | 0.90 → 2.20 | sharp high-rev whine |
| engine_heavy | Brick, Mammoth | 0.60 → 1.30 | low diesel growl with a turbo whistle |

Pitch follows an RPM proxy (speed / top speed with 4 fake gear steps); throttle opens a low-pass and adds gain. The player car plays its loop at full gain; the 2 nearest AI cars within 40 m play theirs quietly (at most 3 engine voices).

### 22.3 Cues
Existing (13): engine (replaced by the 4 loops above), skid (loop), music (loop), impact_light, impact_heavy, crunch, debris, click, buy, error, countdown, go, finish.

New:

| File | Role | Trigger | Real sound |
|---|---|---|---|
| drift_loop | loop | while drifting (replaces skid gain for the player in a drift) | long tyre squeal, rising |
| drift_tier1 / 2 / 3 | one-shot | tier up | short bright chime (pitch by tier) |
| boost_whoosh | one-shot | drift exit boost, slingshot | air whoosh |
| pad_zap | one-shot | boost pad | electric zap + whoosh |
| nitro_loop | loop | Nitro / Smash Nitro active | turbo roar loop |
| pickup | one-shot | item box | plastic box crack |
| item_roulette | one-shot | 0.6 s roulette | fast ticking |
| item_ready | one-shot | item in slot, style meter full | positive blip |
| shield_up / shield_hit | one-shot | Ram Shield | force-field hum / bonk |
| shockwave_blast | one-shot | Shockwave | deep boom |
| repair_ratchet | one-shot | any repair | ratchet + ding |
| takedown_stinger | one-shot | slam by the player | crunch + short brass stab |
| revenge | one-shot | revenge slam | stinger variant |
| wrecked_stinger | one-shot | player wrecked | heavy crash + down sweep |
| explosion | one-shot | Knockout elimination (P1: fuel barrels) | cartoon explosion |
| part_off | one-shot | part detached | metal clang |
| slipstream_wind | loop | in slipstream | wind rush |
| perfect_start | one-shot | perfect start | tyre chirp + rev |
| pos_up | one-shot | position gained | rising blip |
| record | one-shot | new record | short sparkle |
| final_lap | one-shot | final lap | bell |
| wrong_way | one-shot | wrong way | warning buzz |
| elim_warning | one-shot | Knockout last 3 s before an elimination | ticking |
| coin_tick | one-shot | results count-up | coin tick |
| star | one-shot | star lit | sparkle |
| level_up | one-shot | level up, unlock reveal | fanfare (short) |
| claim | one-shot | reward claimed | cash chime |
| near_miss | one-shot | near miss (P1) | whoosh, panned |

### 22.4 Behaviour (platform rules 3.3.3 to 3.3.5 and 2.1.6)
- **One volume controller:** effective gain = platform audio enabled AND no ad open AND page visible AND not platform-paused, times the player's mute and sliders. Slow motion, low-pass and loops can never unmute a muted game.
- Boot: if `bridge.platform.isAudioEnabled` is false the game starts silent and stays silent after a reload while the platform mutes. `AUDIO_STATE_CHANGED`, `PAUSE_STATE_CHANGED` and `visibilitychange` update the controller; `PAUSE_STATE_CHANGED` and a hidden tab also pause the sim. Web Audio still unlocks on the first touch.
- A visible mute button on the hub and in Pause (not only in Settings); M on PC.
- **Memory and loading:** music streams through an `HTMLAudioElement` → `MediaElementSource` (never fully decoded); sfx are mono 22 to 32 kHz; essential cues (engines, impacts, countdown, click) load before the first race, the rest lazily after the first frame; the first frame never waits for audio; decoded audio ≤ 12 MB.
- New cues obey the existing rate limits (`impactMinInterval` style). Music switches to a high-intensity stem on the final lap (P1).

---

## 23. Save data v2 (P0)

Two Bridge storage keys as today (`sc_core`, `sc_ghosts`). Core ≤ 12 KB with everything filled; ghosts ≤ 64 KB in total. The Bridge storage limits are read from the Bridge docs (`get_bridge_sdk_docs`) by WP11 and both budgets stay under them (test with a fully populated save).

```ts
interface SaveDataV2 {
  version: 2;
  money: number; xp: number;
  workshop: Record<UpgradeBranch, 0 | 1 | 2 | 3>;                       // shared levels 1..3
  cars: Partial<Record<CarModelId, { sig: Record<UpgradeBranch, 0 | 1 | 2>; // Signature levels 4..5
                                     paint: string; rims: string; mxp: number }>>; // present = owned
  selectedCar: CarModelId;
  career: Record<string /*eventId*/, { stars: number /*bitmask 1|2|4, 8 = Remix platinum*/; best: number; fails: number }>;
  bosses: string[];
  rivals: { mode: 'mixed' | 'same' | 'pick' | 'random'; pick: CarModelId };
  h2h: Record<string /*driverId*/, [wins: number, losses: number]>;
  quick: { layout: string; mode: RaceMode; laps: number; difficulty: 0 | 1 | 2; items: boolean; car: CarModelId };
  daily: { date: string; tasks: { id: string; p: number; claimed: boolean }[]; allClaimed: boolean;
           login: { day: number; last: string; claimedToday: boolean };
           challenge: { date: string; best: number; streak: number; shieldUsed: string };
           ads: Record<string, number> /* per-day caps, batched into the next save */ };
  weekly: { week: string; best: number; medals: number /*bitmask*/ };
  achievements: Record<string, { p: number; done: boolean }>;
  stats: { races: number; wins: number; objects: number; walls: number; road: number; takedowns: number; driftBest: number; km: number; parts: number };
  records: Record<string /*layout*/, { lap: number; lapCar: CarModelId; ta: number; spree: number; drift: number; top: number; combo: number; slams: number }>;
  lbSubmitted: Record<string /*layout*/, number>;
  ftueStep: number; tipsSeen: number; modeCardsSeen: number; maxClock: number;
  bestLap: Record<string /*layout*/, number>; bestScore: Record<string /*eventId*/, number>;
  cosmetics: string[];                       // owned premium and exclusive items
  purchases: string[];                       // reserved for payments (18.3), empty in v0.2
  settings: { lang; autoGas; quality; muted; musicVol; sfxVol; camera: 'fixed' | 'follow'; driftAssist: boolean; brakeTapDrift: boolean;
              flickItem: boolean; steerSens: number; leftHanded: boolean; secondButton: 'brake' | 'drift' | 'off'; haptics: boolean;
              hints: boolean; ghost: boolean; shake: 0 | 1 | 2; reduceMotion: boolean; colorSafe: boolean };
}
// sc_ghosts: { version: 2; ghosts: Record<string /*layout*/, { modelId: CarModelId; lap: number; hz: 10; data: string /*base64 delta int16 x, y, angle*/ }>; lru: string[] }
```

**Ghosts:** one ghost per layout (the best lap, any car, tagged with its `modelId` and shown with that car's model, translucent), recorded at 10 Hz as delta-encoded int16 in base64 (about 3 KB per layout), ≤ 64 KB in total with LRU eviction. Shown in Race and Time Attack when "Show my ghost" is on. Medal and drift ghosts ship with the build (not in the save).

**Writes:** only at race end, purchases, claims and settings changes, through the existing serialised `writeSave` queue; sliders write on release (or 500 ms after the last change); ad-cap counters ride along with the next save. Order: ghosts first, core last, so a failed ghost write never touches the core. A corrupted or missing ghost key never blocks loading the core (test).

**Versions:** `version` in both keys. A save from a newer version loads its known fields and carries unknown keys through unchanged on write (forward-tolerant); the game never writes a lower version over a higher one.

**Migration v1 → v2** (in `sanitizeSave`, lossless): `upgrades` (e.g. 2/1/4) → `workshop` = min(level, 3) per branch (2/1/3) and `cars.scrapper.sig` = max(0, level − 3) (0/0/1); `carColor` → `cars.scrapper.paint`; money kept; `bestPlace[t1..t3] ≤ 3` → ★1 on the first L1 event on that layout (L1-1, L1-2, L1-3), `unlockedTracks` containing t2 → ★1 on L1-1 (the old "top 3 opens the next track" proof); ghosts and best laps keep their ids (t1, t2, t3) and are re-encoded; `tutorialDone` → `ftueStep 6`; `racesFinished` → `stats.races`; `muted` kept; `camera` = `fixed`.

---

## 24. Telemetry (P0-lite)
Via `src/platform/telemetry.ts` on **Bridge analytics only** (no-op otherwise; follow the Playgama telemetry guide); no external analytics or network calls anywhere (grep test on `src/`, `index.html` and `dist/`). Stable names: `boot_ready`, `first_input`, `ftue_step{n}`, `event_start{event, car, rivals, pr}`, `event_end{event, place, stars_new, coins, duration, fails, drifts, slams}`, `results_action{next|retry|garage|double}`, `car_unlock{car, how}`, `upgrade_buy{car, branch, lvl, kind}`, `shop_buy{item}`, `mastery_up{car, lvl}`, `record{layout, kind}`, `lb_submit{layout}`, `weekly_medal{medal}`, `remix_star{event}`, `ad_offer{placement}`, `ad_reward{placement}`, `login_claim{day}`, `task_claim{id}`, `league_unlock{n}`, `settings_change{key}`, `wrong_way`, `stuck_reset`, `session_end{races}`, plus the guide's performance sample. KPI targets: D0 playtime ≥ 18 min; first input ≥ 95% of boots; race 2 started ≥ 85% of race-1 finishers; L1 boss reached by ≥ 50% of D0 players; D1 ≥ 28%; D7 ≥ 9%; rewarded CTR ≥ 30%; interstitials ≤ 4 per 15 min.

---

## 25. Performance budgets (P0)
Target 60 FPS on a mid Android (Snapdragon 680 / Mali-G57 class), low quality preset. Headless FPS uses a software GPU and is informational only; the gates use the measurable proxies below.

| Budget | Value |
|---|---|
| Frame | 16.6 ms: sim ≤ 3 ms (2 substeps), render CPU ≤ 6 ms, GPU ≤ 8 ms, DOM/HUD ≤ 1 ms |
| Physics step, Node proxy | requirement ≤ 4 ms per step on the phone. Node (2.1 GHz Xeon): **average ≤ 0.45 ms per step and frame (2 steps) p99 ≤ 2.5 ms** on Scrapyard with 8 mixed models and every system on (v0.1.1 measured 0.18 to 0.38 ms on t1 to t3). Per-package cost deltas vs v0.1.2 on t3: driving +0.06, rules +0.06, AI +0.03 (decision layer at 20 to 30 Hz), track density +0.05 |
| Sub-steps | `maxSubSteps` 3 on low (8 today), so a slow frame cannot spiral |
| Browser, throttled | CDP CPU throttle 4×, low preset, dpr 1.25, Fixed and Follow, 390×844 and 844×390, median of 5 runs: main-thread frame work (rAF callback: sim + scene update + render submit + HUD) p95 ≤ 12 ms, p99 ≤ 16.6 ms; sim time accumulated over 600 frames ≤ 3 ms per frame; no long task > 50 ms after the first 5 s, including a scripted burst of 10 breaks in 1 s + a Shockwave + every item, drift tier and break type |
| Real device (pass threshold) | mid Android, low, 60 s race on Scrapyard with 8 mixed models: median FPS ≥ 55 and p95 frame ≤ 18 ms (coordinator check with the in-game `?debug` frame log) |
| Draw calls in a race | per group (each package asserts its own through `window.__render.drawsByGroup`): track + decor + destructibles ≤ 50, cars ≤ 20, FX + items + pads ≤ 20, marker / ghost / misc ≤ 5, reserve 15 → **total ≤ 110 on low**; medium with shadows ≤ 160 |
| Car meshes | **merged design (primary):** per model one InstancedMesh with the body and all 8 parts merged (per-vertex `partId`, per-instance detach mask and bend angles, per-model pivot table, lights through a vertex emissive flag, `paintZone` mask); one wheel InstancedMesh shared by all models (per-instance radius, width, hub colour); one blob shadow mesh. Car calls ≤ models present + 2 on low, ≤ 2 × models + 3 with shadows |
| Triangles in view | ≤ 120k |
| Debris | ≤ 60 pieces in total (break pool 36 + part pool 24), 2 to 3 per break, life 1.5 s / 2.0 s (21) |
| Particles | existing pools and presets; drift sparks ≤ 40 per car per second, only inside `emitRange`; every FX type pooled and pre-warmed |
| Physics bodies | awake dynamic props ≤ 24 (the oldest is put to sleep); a Smash Spree bot breaking ≥ 120 props in 90 s stays inside the step budget |
| DOM | pops alive ≤ 8; HUD moves by transform only; minimap path pre-rendered, dots ≤ 30 Hz; `updateHud` ≤ 0.5 ms per frame under the 4× throttle |
| Quality start | touch devices start on **low** and step up after a 2 s benchmark on the grid if there is headroom; shadow and quality changes apply at the next race load (no shader recompile mid-race); auto-quality may lower dpr and particles mid-race and steps back up between races |
| Race load | ≤ 2 s under the 4× throttle: model geometry built once and cached across races, only track meshes rebuilt, FX pools and materials warmed before `gl.compile` |
| Memory | 30 races in a row: `renderer.info.memory` and the JS heap flat within 5%; decoded audio ≤ 12 MB |
| Context loss | `webglcontextlost` / `restored` recovers inside a race (tested with `WEBGL_lose_context`) |
| Bundle | ≤ +250 KB gzip vs v0.1.1; sfx ≤ 2.5 MB; music ≤ 2.5 MB (streamed) |
| First frame | ≤ 3 s after Bridge ready on a 4G mid phone; never waits for audio |

Fallback if a mixed field still misses budget on low: cap distinct models per race at 4 (config).

---

## 26. i18n: every new player-visible string (EN + RU)

All strings go through `t()` or `tp()`. Car names are translated (D9); driver and boss names are not. Placeholders in `{}`. Arrows (←, →, ↑) are text characters, not emoji; icons (play, retry, star, triangles, globe, speaker, lock) are inline SVG, or carry U+FE0E where a glyph must stay text. RU address is informal ("ты"), matching the existing dictionary. Existing keys stay unless listed as changed. Declared languages: exactly `en` and `ru`, both complete.

### 26.0 Rules: plurals, numbers, fonts, language
- **Plurals:** `tp(key, n, vars?)` picks `key.<form>` with `Intl.PluralRules(lang)`: EN forms `one` / `other`, RU forms `one` / `few` / `many` (RU `other`, used for fractions, falls back to `few`). Every key marked **(n)** below exists in all forms of both languages (test). Tests: n ∈ {0, 1, 2, 5, 11, 21, 22, 25, 111, 1,000} give 1 монета, 2 монеты, 5 монет, 11 монет, 21 монета, 22 монеты, 25 монет, 111 монет, 1 000 монет.
- In the tables, (n) rows list the forms separated by " \| ": EN one \| other, RU one \| few \| many.
- Stat labels use the colon form ("Объектов: 16"), which is correct for every number and needs no plural.
- **Numbers** go through `fmtNum()` (`Intl.NumberFormat`): EN "1,234", RU "1 234" with a no-break space; durations through `fmtDuration()` ("2 d 5 h" / "2 д 5 ч").
- **Fonts:** the UI font covers Cyrillic, including ё (test renders every RU string and checks for fallback glyphs).
- **Language detection** (`src/i18n.ts`): only `ru`, `be` and `kk` map to Russian; every other platform language falls back to English (rule 3.4.2).
- RU strings must fit 360 px portrait (overflow e2e at 360×640 and 320×568); a car line ≤ 40 characters; no word breaks inside buttons. Boss and driver names are never declined through a placeholder: sentences put them after a noun ("босса «{boss}»") or after a colon.

### 26.1 Hub, navigation, common
| Key | EN | RU |
|---|---|---|
| hub.race | RACE | ГОНКА |
| hub.next | Next event | Следующий заезд |
| hub.career | Career | Карьера |
| hub.garage | Garage | Гараж |
| hub.quick | Quick Race | Быстрая гонка |
| hub.today | Today | Сегодня |
| hub.trophies | Trophies | Трофеи |
| hub.shop | Shop | Магазин |
| hub.level | Level {n} | Уровень {n} |
| hub.upTo | up to {n} | до {n} |
| hub.car | Car | Машина |
| hub.rivals | Rivals: {mode} | Соперники: {mode} |
| hub.premise | A backyard circuit of scrap-built cars where every wall is fair game. Beat five bosses and take the crown. | Дворовая трасса, где машины собраны из хлама, а любую стену можно снести. Победи пятерых боссов и забери корону. |
| hub.mute | Sound on or off | Включить или выключить звук |
| title.hotshot | Hotshot | Горячая голова |
| title.street | Street Racer | Уличный гонщик |
| title.pro | Pro | Профи |
| title.veteran | Veteran | Ветеран |
| title.roadKing | Road King | Король дорог |
| title.livingLegend | Living Legend | Живая легенда |
| title.legend | Legend | Легенда |
| title.remixLegend | Remix Legend | Легенда ремикса |
| ui.back | Back | Назад (exists) |
| ui.close | Close | Закрыть |
| ui.loadingRace | Loading race… | Загружаем гонку… |
| ui.new | NEW | НОВОЕ |
| ui.locked | Locked | Закрыто |
| ui.claim | Claim | Забрать |
| ui.adClaim2 | AD · Claim ×2 | РЕКЛАМА · Забрать ×2 |
| ui.adFailed | Ad is not available right now | Реклама сейчас недоступна (rename of results.adFailed) |
| ui.later | Later | Позже |
| ui.useNow | Use now | Сразу в деле |
| ui.tryNow | Try now | Попробовать |
| pr.short | PR | РЕЙТ |
| pr.full | Performance rating | Рейтинг машины |
| pr.recommended | Recommended {n} | Рекомендуется {n} |
| pr.yours | Yours {n} | У тебя {n} |
| pr.hint | Your PR {a}, recommended {b}: try {item} (+{n} PR) | Твой рейтинг {a}, нужно {b}: попробуй «{item}» (+{n}) |

### 26.2 Next goal
| Key | EN | RU |
|---|---|---|
| goal.claim | You have rewards to claim | Тебя ждут награды |
| goal.upgrade | You can afford {item} | Хватает на «{item}» |
| goal.carStars | {n}★ more to unlock {car} | Ещё {n}★ до машины «{car}» |
| goal.carCoins (n) | {n} coin to unlock {car} \| {n} coins to unlock {car} | Ещё {n} монета до машины «{car}» \| Ещё {n} монеты до машины «{car}» \| Ещё {n} монет до машины «{car}» |
| goal.boss (n) | {n} more event to face {boss} \| {n} more events to face {boss} | Ещё {n} заезд до босса «{boss}» \| Ещё {n} заезда до босса «{boss}» \| Ещё {n} заездов до босса «{boss}» |
| goal.league | Beat {boss} to open {league} | Победи босса «{boss}», чтобы открыть лигу «{league}» |
| goal.leagueStars | {n}★ more to open {league} | Ещё {n}★ до лиги «{league}» |
| goal.tasks | Daily tasks {a}/{b} | Задания дня {a}/{b} |
| goal.weekly | Earn {medal} in the Weekly Cup | Получи «{medal}» в кубке недели |
| goal.mastery | One race to mastery {n} with {car} | Одна гонка до мастерства {n} на машине «{car}» |
| goal.bestLap | Beat your best lap on {track} | Побей свой лучший круг: «{track}» |

### 26.3 Career, leagues, events, stars
| Key | EN | RU |
|---|---|---|
| career.title | Career | Карьера |
| career.event | Event {n} | Заезд {n} |
| career.boss | Boss | Босс |
| career.bossLocked (n) | Get ★1 on {n} more event to face the boss \| Get ★1 on {n} more events to face the boss | Возьми ★1 ещё в {n} заезде, чтобы вызвать босса \| Возьми ★1 ещё в {n} заездах, чтобы вызвать босса \| Возьми ★1 ещё в {n} заездах, чтобы вызвать босса |
| career.leagueLocked | Beat the boss of {league} and collect {n}★ | Победи босса лиги «{league}» и собери {n}★ |
| career.stars | {a}/{b} ★ | {a}/{b} ★ |
| career.remix | Legend Remix | Ремикс легенд |
| career.remix.d | Every event again, tougher rivals, platinum stars | Все заезды заново, соперники сильнее, платиновые звёзды |
| career.platinum | Platinum star | Платиновая звезда |
| career.raceWithAd | AD · Race this event with {car} | РЕКЛАМА · Проехать этот заезд на «{car}» |
| league.1 | Rookie Cup | Кубок новичка |
| league.2 | Harbor Heat | Жара в порту |
| league.3 | Scrap Kings | Короли свалки |
| league.4 | Street Brawl | Уличная драка |
| league.5 | Legends | Легенды |
| star.top3 | Finish top 3 | Финишируй в топ-3 |
| star.win | Win | Победи |
| star.survive3 | Survive to the top 3 | Продержись до топ-3 |
| star.bronze | Bronze: {v} | Бронза: {v} |
| star.silver | Silver: {v} | Серебро: {v} |
| star.gold | Gold: {v} | Золото: {v} |
| star.smash (n) | Break {n} object \| Break {n} objects | Разбей {n} объект \| Разбей {n} объекта \| Разбей {n} объектов |
| star.health | Finish with at least {n}% health | Финишируй с прочностью от {n}% |
| star.items (n) | Use {n} power-up \| Use {n} power-ups | Используй {n} бонус \| Используй {n} бонуса \| Используй {n} бонусов |
| star.takedowns (n) | Make {n} slam \| Make {n} slams | Сделай {n} вынос \| Сделай {n} выноса \| Сделай {n} выносов |
| star.takedown1 | Make a slam | Сделай вынос |
| star.drift (n) | Score {n} drift point \| Score {n} drift points | Набери {n} очко дрифта \| Набери {n} очка дрифта \| Набери {n} очков дрифта |
| star.winBy | Win by {n} s or more | Победи с отрывом от {n} с |
| star.noRepair | Win without repairs | Победи без ремонта |
| star.lead1 | Lead at the end of lap 1 | Лидируй после первого круга |
| star.takedownBoss | Slam {boss} once | Вынеси босса «{boss}» хотя бы раз |
| star.driftDuel (n) | Score {n} drift point in the duel \| Score {n} drift points in the duel | Набери {n} очко дрифта в дуэли \| Набери {n} очка дрифта в дуэли \| Набери {n} очков дрифта в дуэли |
| star.new | New star! | Новая звезда! |

(`star.gain` is removed: L5-6 ★3 is now "3 slams".)

### 26.4 Modes and modifiers
| Key | EN | RU |
|---|---|---|
| mode.race | Race | Гонка |
| mode.race.d | 8 cars. First across the line wins. | 8 машин. Кто первым финиширует, тот и победил. |
| mode.sprint | Sprint | Спринт |
| mode.sprint.d | A short 2-lap race. | Короткая гонка на 2 круга. |
| mode.time | Time Attack | На время |
| mode.time.d | Alone against medal ghosts. Beat the lap times. | Один против призраков-медалистов. Побей время круга. |
| mode.rampage | Smash Spree | Разгром |
| mode.rampage.d | 90 seconds. Smash everything. Chain hits for combos. | 90 секунд. Круши всё подряд. Серии ударов дают комбо. |
| mode.knockout | Knockout | На вылет |
| mode.knockout.d | Every 15 seconds the last car is out. | Каждые 15 секунд последний вылетает. |
| mode.drift | Drift Trial | Дрифт |
| mode.drift.d | Score drift points and beat the drift ghost. Walls break your chain. | Набирай очки дрифта и обгони призрака. Удар о стену обрывает серию. |
| mode.boss | Boss Duel | Босс |
| mode.boss.d | One on one. Win and the car is yours. | Один на один. Победишь — машина твоя. |
| mode.final | Grand Final | Гранд-финал |
| mode.final.d | The best of the best. 5 laps. | Лучшие из лучших. 5 кругов. |
| mode.weekly | Weekly Smash Cup | Кубок недели |
| mode.weekly.d | One event all week. Medals up to platinum. | Один заезд на всю неделю. Медали вплоть до платины. |
| mod.glass | Glass Cannon | Стеклянная пушка |
| mod.glass.d | All damage ×2 | Весь урон ×2 |
| mod.heavy | Heavy Metal | Тяжёлый металл |
| mod.heavy.d | Rivals drive heavy cars | Соперники на тяжёлых машинах |
| mod.norepair | No Repairs | Без ремонта |
| mod.norepair.d | No repairs, no repair kits | Ни ремонта, ни ремкомплектов |
| mod.frenzy | Power-up Frenzy | Бонусный угар |
| mod.frenzy.d | Double power-ups | Бонусов вдвое больше |
| mod.onemake | One-Make | Монокласс |
| mod.onemake.d | Everyone drives your car | Все на такой же машине, как у тебя |
| mod.underdog | Underdog | Аутсайдер |
| mod.underdog.d | Start last, prize ×1.5 | Старт последним, приз ×1,5 |
| track.reverse | Reverse | Реверс |
| track.t4 | Harbor Run | Портовый рывок |
| track.t5 | Scrapyard | Свалка |

The mode descriptions double as the one-time mode cards (13).

### 26.5 Bosses
| Key | EN | RU |
|---|---|---|
| boss.intro.1 | Big Mo: "Nobody passes my Brawler." | Биг Мо: «Мой Задира никого не пропустит». |
| boss.intro.2 | Sleet: "Try to keep up on the ice." | Слит: «Попробуй угнаться за мной на льду». |
| boss.intro.3 | Grinder: "I eat walls for breakfast." | Гриндер: «Я ем стены на завтрак». |
| boss.intro.4 | Ace: "You'll only see my rear wing." | Эйс: «Ты увидишь только моё заднее крыло». |
| boss.intro.5 | Duchess: "Legends are not born. They are crowned." | Герцогиня: «Легендами не рождаются. Их коронуют». |
| boss.reward | Win to get: {car} | Победи и получи: «{car}» |
| boss.beaten | {boss} beaten! | Победа над боссом: {boss}! |
| boss.title | Title: Legend | Титул: Легенда |
| boss.livery | Champion gold livery | Золотая чемпионская окраска |


### 26.6 Cars, classes, perks, garage
| Key | EN | RU |
|---|---|---|
| car.scrapper | Scrapper | Жестянка |
| car.gravel | Gravel | Гравий |
| car.brick | Brick | Кирпич |
| car.sandhopper | Sandhopper | Попрыгун |
| car.brawler | Brawler | Задира |
| car.bruiser | Bruiser | Громила |
| car.glint | Glint | Блик |
| car.scorcher | Scorcher | Пекло |
| car.needle | Needle | Игла |
| car.mammoth | Mammoth | Мамонт |
| car.scrapper.line | Cheap, cheerful, fixes itself | Дёшево, весело, чинится само |
| car.gravel.line | Born sideways | Рождён боком |
| car.brick.line | Slow. Unstoppable. Rude. | Медленный. Неудержимый. Наглый. |
| car.sandhopper.line | Grass? What grass? | Трава? Какая трава? |
| car.brawler.line | Burnouts, not brakes | Не тормоза, а дым из-под колёс |
| car.bruiser.line | Front-first problem solver | Решает вопросы бампером |
| car.glint.line | Fast and fragile | Быстрый и хрупкий |
| car.scorcher.line | All engine, some car | Один мотор, немного машины |
| car.needle.line | Glass rocket | Стеклянная ракета |
| car.mammoth.line | Walls are suggestions | Стены — это просто совет |
| class.allround | All-rounder | Универсал |
| class.drifter | Drifter | Дрифтер |
| class.tank | Tank | Танк |
| class.offroad | Off-roader | Внедорожник |
| class.muscle | Muscle | Маслкар |
| class.rammer | Rammer | Таран |
| class.speedster | Speedster | Скоростной |
| class.hotrod | Hot rod | Хот-род |
| class.racer | Racer | Болид |
| class.juggernaut | Juggernaut | Джаггернаут |
| perk.patchup | Patch-up | Самоделкин |
| perk.patchup.d | Fixes itself between hits; repairs cost 35% less | Сама чинится между ударами; ремонт на 35% дешевле |
| perk.sideways | Sideways | Боком |
| perk.sideways.d | Drift charges 40% faster, less slowed by grass | Дрифт заряжается на 40% быстрее, трава тормозит меньше |
| perk.wideload | Wide Load | Габарит |
| perk.wideload.d | Barely slowed by props, rams 40% harder | Почти не тормозит о препятствия, таранит на 40% сильнее |
| perk.offroad | Off-road King | Король бездорожья |
| perk.offroad.d | Grass and holes barely slow it down | Трава и ямы почти не замедляют |
| perk.burnout | Burnout | Пробуксовка |
| perk.burnout.d | Wider perfect-start window, bigger launch boost | Шире окно идеального старта, сильнее рывок |
| perk.bullbar | Bull Bar | Кенгурятник |
| perk.bullbar.d | Front takes half damage, front hits deal 60% more | Перед получает вдвое меньше урона, удар передом сильнее на 60% |
| perk.slipstream | Slipstream Pro | Мастер слипстрима |
| perk.slipstream.d | Slipstream fills twice as fast and gives more speed | Слипстрим заполняется вдвое быстрее и даёт больше скорости |
| perk.afterburner | Afterburner | Форсаж |
| perk.afterburner.d | Nitro lasts 50% longer; the open engine is fragile | Нитро действует на 50% дольше; открытый мотор уязвим |
| perk.downforce | Downforce | Прижимная сила |
| perk.downforce.d | Corners better at top speed; wheels are fragile | Лучше в поворотах на скорости; колёса хрупкие |
| perk.juggernaut | Juggernaut | Джаггернаут |
| perk.juggernaut.d | Plows through walls, ignores shockwaves, rams 50% harder | Пробивает стены, не боится ударной волны, таранит на 50% сильнее |
| stat.handling | Handling | Управляемость |
| stat.drift | Drift | Дрифт |
| stat.weight | Weight | Масса |
| garage.tab.cars | Cars | Машины |
| garage.tab.upgrade | Upgrade | Тюнинг |
| garage.tab.paint | Paint | Покраска |
| garage.select | Select | Выбрать |
| garage.selected | Selected | Выбрана |
| garage.unlock | Unlock | Открыть |
| garage.need | Need {n} more | Не хватает {n} |
| garage.req.stars | {n}★ (you have {m}★) | {n}★ (у тебя {m}★) |
| garage.req.boss | Beat {boss} in {league} | Победи босса «{boss}» в лиге «{league}» |
| garage.req.choice | Free choice after your first race | Бесплатно на выбор после первой гонки |
| garage.tryRule | Drive it free in Quick Race. Own it to use it in Career. | Катайся бесплатно в быстрой гонке. Купи, чтобы ездить в карьере. |
| garage.tryQuick | Try in Quick Race | Попробовать в быстрой гонке |
| garage.workshop | Workshop · all cars | Мастерская · все машины |
| garage.signature | Signature · this car | Фирменный тюнинг · эта машина |
| garage.effectAll (n) | {n} car: {effect} \| All {n} cars: {effect} | {n} машина: {effect} \| Все {n} машины: {effect} \| Все {n} машин: {effect} |
| garage.mastery | Mastery {n} | Мастерство {n} |
| garage.perk | Perk | Особенность |
| garage.max | Max {n} | Максимум {n} |
| garage.owned | {a}/{b} cars | Машин: {a}/{b} |
| garage.effect.top | Top speed {a} → {b} km/h | Скорость {a} → {b} км/ч |
| garage.effect.accel | Acceleration +{n}% | Разгон +{n}% |
| garage.effect.grip | Cornering +{n}% | Повороты +{n}% |
| garage.effect.armor | Damage taken −{n}% | Урон −{n}% |
| garage.newCar | New car: {car} | Новая машина: «{car}» |
| ftue.chooseCar | Choose your second car | Выбери вторую машину |
| ftue.chooseCar.d | It's yours for free. The other one can be bought later. | Она твоя бесплатно. Вторую можно купить позже. |


### 26.7 Rivals, drivers and Quick Race
| Key | EN | RU |
|---|---|---|
| rivals.title | Rival cars | Машины соперников |
| rivals.mixed | Mixed | Разные |
| rivals.mixed.d | Every driver brings their own car | Каждый гонщик на своей машине |
| rivals.same | Same as mine | Как у меня |
| rivals.same.d | Everyone drives your model. Pure skill. | Все на твоей модели. Решает только мастерство. |
| rivals.pick | One model | Одна модель |
| rivals.pick.d | All rivals drive the model you pick | Все соперники на выбранной модели |
| rivals.random | Random | Случайные |
| rivals.random.d | Anything goes | Что попадётся |
| rivals.fair | Rival strength is set by the event, so every choice is fair | Сила соперников зависит от заезда, поэтому любой выбор честный |
| rivals.fixed | This event has a fixed field | В этом заезде состав соперников фиксирован |
| rivals.preview | The field | Состав |
| rivals.h2h | {w}–{l} against you | {w}–{l} против тебя |
| quick.title | Quick Race | Быстрая гонка |
| quick.track | Track | Трасса |
| quick.mode | Mode | Режим |
| quick.laps | Laps | Круги |
| quick.difficulty | Difficulty | Сложность |
| quick.easy | Easy | Легко |
| quick.normal | Normal | Нормально |
| quick.hard | Hard | Сложно |
| quick.items | Power-ups | Бонусы |
| quick.anyCar | Any car, even locked ones | Любая машина, даже закрытая |
| quick.showroom | Showroom tune · PR {n} | Тюнинг из салона · РЕЙТ {n} |
| driver.blaze.trait | Clean lines, loves a slipstream | Чистые траектории, любит слипстрим |
| driver.rocket.trait | Fastest on the straights | Быстрее всех на прямых |
| driver.zed.trait | Almost never makes mistakes | Почти не ошибается |
| driver.grit.trait | Brakes late, never gives up | Тормозит поздно, не сдаётся |
| driver.fenya.trait | Steady and fast | Ровно и быстро |
| driver.rusty.trait | Rams you into walls | Таранит в стены |
| driver.vasya.trait | Leans on you in corners | Давит бортом в поворотах |
| driver.torque.trait | Pushes through walls | Проходит сквозь стены |
| driver.dynamo.trait | Hits hard, burns out | Бьёт сильно, но быстро выдыхается |
| driver.skid.trait | Drifts every corner | Дрифтует в каждом повороте |
| driver.sparky.trait | Smoke and sparks everywhere | Дым и искры повсюду |
| driver.moxie.trait | Chains drift after drift | Дрифт за дрифтом без остановки |
| driver.ziggy.trait | Wild slides | Дикие заносы |
| driver.turbo.trait | Saves Nitro for the end | Бережёт нитро на финиш |
| driver.rex.trait | Shockwaves at the worst moment | Бьёт волной в самый неудобный момент |
| driver.pepper.trait | Always has a power-up ready | Всегда с бонусом наготове |
| driver.dusty.trait | Drives through everything | Едет сквозь всё подряд |
| driver.kuzya.trait | Loves crashing into props | Обожает сносить препятствия |
| driver.sprocket.trait | Wobbly but brave | Виляет, но не трусит |
| driver.tolik.trait | Slow and stubborn | Медленный и упрямый |

(`quick.rivalsCount` is removed: lap races always have 8 cars.)

### 26.8 HUD and race feedback
| Key | EN | RU |
|---|---|---|
| hud.drift | DRIFT | ДРИФТ |
| hud.smash | SMASH ×{n} | РАЗГРОМ ×{n} |
| hud.takedown | SLAM! {name} | ВЫНЕС! {name} |
| hud.revenge | REVENGE! | РЕВАНШ! |
| hud.wrecked | WRECKED | РАЗБИТ |
| hud.respawn | Back in {s} s | Вернёшься через {s} с |
| hud.wrongWay | WRONG WAY | НЕ ТУДА |
| hud.goBack | Tap to go back | Нажми, чтобы вернуться |
| hud.goBackKey | Press R to go back | Нажми R, чтобы вернуться |
| hud.missed | MISSED CHECKPOINT | ПРОПУЩЕН ЧЕКПОИНТ |
| hud.lapBanner | LAP {a}/{b} | КРУГ {a}/{b} |
| hud.bestLapFlash | BEST LAP! | ЛУЧШИЙ КРУГ! |
| hud.posUp (n) | +{n} POS \| +{n} POS | +{n} МЕСТО \| +{n} МЕСТА \| +{n} МЕСТ |
| hud.gap | {s} s | {s} с |
| hud.perfectStart | PERFECT START | ИДЕАЛЬНЫЙ СТАРТ |
| hud.slipstream | SLIPSTREAM | СЛИПСТРИМ |
| hud.boost | BOOST! | УСКОРЕНИЕ! |
| hud.elimIn | Elimination in {s} s | Вылет через {s} с |
| hud.eliminated | {name} is out! | {name} выбывает! |
| hud.youOut | You're out! | Ты выбыл! |
| hud.timeLeft | Time left | Осталось |
| hud.score | Score | Очки |
| hud.trackBreaking | The track is breaking up! | Трасса разваливается! |
| hud.styleFull | SMASH NITRO READY | СМЭШ-НИТРО ГОТОВО |
| hud.fix | FIX | ЧИНИТЬ |
| hud.needMore | Need {n} more | Не хватает {n} |
| hud.raceCoins | This race | За гонку |
| hud.final | FINAL LAP | ПОСЛЕДНИЙ КРУГ (replaces hud.finalLap) |
| item.nitro | Nitro | Нитро |
| item.shield | Ram Shield | Таран-щит |
| item.repair | Repair Kit | Ремкомплект |
| item.shockwave | Shockwave | Ударная волна |
| item.smashNitro | Smash Nitro | Смэш-нитро |
| tip.shield | Shield: rams hurt you less | Щит: тараны бьют слабее |
| tip.shockwave | Shockwave: blasts rivals away | Ударная волна: расшвыривает соперников |
| tip.repairKit | Repair Kit: fixes your car | Ремкомплект: чинит машину |

### 26.9 FTUE and tips
| Key | EN | RU |
|---|---|---|
| ftue.hold | HOLD | ДЕРЖИ |
| ftue.holdKeys | Press W or ↑ | Нажми W или ↑ |
| ftue.steer | SLIDE TO STEER | ВЕДИ ПАЛЬЦЕМ |
| ftue.steerKeys | A / D or ← / → to steer | A / D или ← / → для поворота |
| ftue.smash | SMASH IT! | КРУШИ! |
| ftue.boost | BOOST! | УСКОРЕНИЕ! |
| ftue.item | TAP TO USE | ЖМИ НА БОНУС |
| ftue.itemKeys | Press E to use | Нажми E |
| ftue.autoDrift | Auto-drift: ON · Settings | Автодрифт: ВКЛ · Настройки |
| ftue.drift | STEER HARD TO DRIFT | ВЫВОРАЧИВАЙ ДЛЯ ДРИФТА |
| ftue.driftKeys | HOLD SPACE TO DRIFT | ДЕРЖИ ПРОБЕЛ ДЛЯ ДРИФТА |
| ftue.release | EASE OFF TO BOOST | ОТПУСТИ — УСКОРЕНИЕ |
| ftue.repair | TAP TO FIX | НАЖМИ, ЧТОБЫ ПОЧИНИТЬ |
| ftue.repairKeys | Press R to fix | Нажми R, чтобы починить |
| ftue.skip | Skip | Пропустить |
| ftue.upgrade | UPGRADE YOUR CAR | УЛУЧШИ МАШИНУ |
| ftue.raceAgain | RACE AGAIN | ЕЩЁ ГОНКА |
| ftue.finished | Finished! | Финиш! |
| tip.perfectStart | Tap GAS on GO for a perfect start | Жми ГАЗ на «СТАРТ!» для идеального старта |
| tip.perfectStartKeys | Press W on GO for a perfect start | Жми W на «СТАРТ!» для идеального старта |
| tip.flick | Pro tip: flick up to use without lifting your thumb | Совет: смахни вверх, чтобы не отрывать палец |
| tip.wreck | Repairs and repair kits fix your car | Ремонт и ремкомплекты чинят машину |
| tip.ram | Ram rivals into walls! | Тарань соперников в стены! |
| tip.styleFull | Smash Nitro ready: tap the slot! | Смэш-нитро готово: жми на бонус! |
| tip.styleFullKeys | Smash Nitro ready: press E! | Смэш-нитро готово: жми E! |

(`tip.knockout` is replaced by the Knockout mode card, `mode.knockout.d`.)

### 26.10 Results
| Key | EN | RU |
|---|---|---|
| results.next | NEXT | ДАЛЬШЕ |
| results.retry | RETRY | ЕЩЁ РАЗ |
| results.garage | GARAGE | ГАРАЖ |
| results.prize | Place prize | Приз за место |
| results.smash | Smash | Разгром |
| results.smashDetail | Objects: {n} · Slams: {k} | Объектов: {n} · Выносов: {k} |
| results.drift | Drift | Дрифт |
| results.stars | New stars | Новые звёзды |
| results.firstBonus | First race bonus | Бонус за первую гонку |
| results.total | Total | Итого |
| results.ad (n) | AD · +{n} coin \| AD · +{n} coins | РЕКЛАМА · +{n} монета \| РЕКЛАМА · +{n} монеты \| РЕКЛАМА · +{n} монет |
| results.xp | +{n} XP | +{n} опыта |
| results.levelUp | Level {n}! | Уровень {n}! |
| results.soClose | {s} s to the podium | {s} с до подиума |
| results.order | Finish order | Итоги заезда |
| results.score | Score | Очки |
| results.record | NEW RECORD: {what} | НОВЫЙ РЕКОРД: {what} |
| results.delta | {d} vs your best | {d} к твоему лучшему |
| results.replay | Replay | Повтор |
| record.lap | best lap | лучший круг |
| record.ta | Time Attack lap | круг на время |
| record.top | top speed | макс. скорость |
| record.combo | combo | комбо |
| record.slams | slams in a race | выносы за гонку |
| record.score | score | очки |
| results.medal.none | No medal | Без медали |
| results.medal.bronze | Bronze | Бронза |
| results.medal.silver | Silver | Серебро |
| results.medal.gold | Gold | Золото |
| results.medal.platinum | Platinum | Платина |
| results.tomorrow (n) | Tomorrow: {n} coin \| Tomorrow: {n} coins | Завтра: {n} монета \| Завтра: {n} монеты \| Завтра: {n} монет |
| results.tasksIn | New tasks in {t} | Новые задания через {t} |
| results.weeklyIn | Weekly Cup ends in {t} | Кубок недели закончится через {t} |
| results.likedIt | Liked it? {req} to own it | Понравилась? {req} — и она твоя |

### 26.11 Pause and repair
| Key | EN | RU |
|---|---|---|
| pause.freeRepair | AD · Free repair | РЕКЛАМА · Бесплатный ремонт |
| pause.camera | Camera | Камера |
| pause.mute | Sound | Звук |
| pause.goals | Goals | Цели |
| pause.repairCap | Max {n} | Не больше {n} |

### 26.12 Settings
| Key | EN | RU |
|---|---|---|
| settings.controls | Controls | Управление |
| settings.camera | Camera | Камера |
| settings.camFixed | Fixed | Неподвижная |
| settings.camFollow | Follow | За машиной |
| settings.driftAssist | Drift assist | Помощь в дрифте |
| settings.driftAssist.hint | Hold full lock at speed to drift | Выверни руль до упора на скорости, чтобы уйти в дрифт |
| settings.brakeTap | Brake tap = drift | Тап тормоза = дрифт |
| settings.brakeTap.hint | A quick pull down while steering starts a drift | Короткий рывок вниз в повороте запускает дрифт |
| settings.flick | Flick up to use item | Смахивание вверх — бонус |
| settings.flick.hint | Off: tap the item slot only | Выкл.: только нажатие на бонус |
| settings.sensitivity | Steering sensitivity | Чувствительность руля |
| settings.leftHanded | Left-handed | Для левой руки |
| settings.secondButton | 2nd-finger button | Кнопка для второго пальца |
| settings.secondBrake | Brake | Тормоз |
| settings.secondDrift | Drift | Дрифт |
| settings.secondOff | Off | Нет |
| settings.vibration | Vibration | Вибрация |
| settings.hints | Control hints | Подсказки |
| settings.ghost | Show my ghost | Показывать моего призрака |
| settings.mute | Mute | Без звука |
| settings.music | Music | Музыка |
| settings.effects | Effects | Эффекты |
| settings.shake | Screen shake | Тряска экрана |
| settings.shakeFull | Full | Полная |
| settings.shakeReduced | Reduced | Слабая |
| settings.reduceMotion | Reduce motion | Меньше движения |
| settings.colorSafe | Colour-safe damage | Урон без опоры на цвет |
| settings.accessibility | Accessibility | Доступность |
| settings.language | Language | Язык |
| settings.langAuto | Auto / Авто | Auto / Авто |
| settings.other | Other | Прочее |
| settings.credits | Credits | Авторы |
| settings.reduceFlashes | Reduce flashes (P1) | Меньше вспышек |
| settings.textSize | Text size (P1) | Размер текста |
| settings.replayTutorial | Replay tutorial (P1) | Пройти обучение заново |

The language options themselves are shown in their own language ("English", "Русский") next to a globe icon, so the selector is findable without knowing the current language (rule 3.4.4).

### 26.13 Today: login, tasks, Daily Challenge, Weekly Cup
| Key | EN | RU |
|---|---|---|
| today.title | Today | Сегодня |
| login.title | Daily reward | Награда дня |
| login.day | Day {n} | День {n} |
| login.claimed | Claimed | Получено |
| login.comeBack (n) | Come back tomorrow for {n} coin \| Come back tomorrow for {n} coins | Возвращайся завтра за {n} монетой \| Возвращайся завтра за {n} монетами \| Возвращайся завтра за {n} монетами |
| login.noReset | Missing a day never resets your streak | Пропуск дня не сбрасывает серию |
| tasks.title | Daily tasks | Задания дня |
| tasks.allBonus (n) | All 3 done: +{n} coin \| All 3 done: +{n} coins | Все три: +{n} монета \| Все три: +{n} монеты \| Все три: +{n} монет |
| tasks.newIn | New tasks in {t} | Новые задания через {t} |
| task.win1 | Win a race | Выиграй гонку |
| task.podium3 | Finish in the top 3 three times | Финишируй в топ-3 три раза |
| task.smash60 (n) | Break {n} object \| Break {n} objects | Разбей {n} объект \| Разбей {n} объекта \| Разбей {n} объектов |
| task.takedown3 (n) | Make {n} slam \| Make {n} slams | Сделай {n} вынос \| Сделай {n} выноса \| Сделай {n} выносов |
| task.drift3k (n) | Score {n} drift point \| Score {n} drift points | Набери {n} очко дрифта \| Набери {n} очка дрифта \| Набери {n} очков дрифта |
| task.cleanDrift5 (n) | Make {n} clean drift exit \| Make {n} clean drift exits | Чисто выйди из дрифта {n} раз \| Чисто выйди из дрифта {n} раза \| Чисто выйди из дрифта {n} раз |
| task.items6 (n) | Use {n} power-up \| Use {n} power-ups | Используй {n} бонус \| Используй {n} бонуса \| Используй {n} бонусов |
| task.nitro5 (n) | Use Nitro {n} time \| Use Nitro {n} times | Используй нитро {n} раз \| Используй нитро {n} раза \| Используй нитро {n} раз |
| task.slip3 (n) | Use slipstream {n} time \| Use slipstream {n} times | Поймай слипстрим {n} раз \| Поймай слипстрим {n} раза \| Поймай слипстрим {n} раз |
| task.lead30 (n) | Lead a race for {n} second \| Lead a race for {n} seconds | Лидируй в гонке {n} секунду \| Лидируй в гонке {n} секунды \| Лидируй в гонке {n} секунд |
| task.stars2 (n) | Earn {n} star \| Earn {n} stars | Получи {n} звезду \| Получи {n} звезды \| Получи {n} звёзд |
| task.rampage2k (n) | Score {n} point in a Smash Spree \| Score {n} points in a Smash Spree | Набери {n} очко в «Разгроме» \| Набери {n} очка в «Разгроме» \| Набери {n} очков в «Разгроме» |
| task.bestlap | Beat your best lap on any track | Побей свой лучший круг на любой трассе |
| task.walls10 (n) | Smash {n} wall segment \| Smash {n} wall segments | Снеси {n} секцию стены \| Снеси {n} секции стены \| Снеси {n} секций стены |
| task.road5 (n) | Tear up {n} road chunk \| Tear up {n} road chunks | Вырви {n} кусок дороги \| Вырви {n} куска дороги \| Вырви {n} кусков дороги |
| task.reverseWin | Win on a Reverse track | Выиграй на реверсной трассе |
| task.parts5 (n) | Knock {n} part off rivals \| Knock {n} parts off rivals | Сбей с соперников {n} деталь \| Сбей с соперников {n} детали \| Сбей с соперников {n} деталей |
| task.carX | Race with {car} | Проведи гонку на машине «{car}» |
| task.newCar | Finish a race with a different car than last time | Финишируй на другой машине, не той, что в прошлый раз |
| task.sameRivals | Race with "Same as mine" rivals | Проведи гонку с соперниками «Как у меня» |
| task.repair1 | Repair your car once | Почини машину один раз |
| task.weekly1 | Earn a Weekly Cup medal | Получи медаль в кубке недели |
| challenge.title | Daily Challenge | Вызов дня |
| challenge.forcedCar | Today's car: {car} | Машина дня: «{car}» |
| challenge.streak | Challenge streak ×{n} | Серия вызовов ×{n} |
| challenge.shield | Streak shield: one missed day is free | Щит серии: один пропуск не считается |
| challenge.done | Done for today | На сегодня всё |
| weekly.title | Weekly Smash Cup | Кубок недели |
| weekly.endsIn | Ends in {t} | Закончится через {t} |
| weekly.loaner | This week's car: {car} | Машина недели: «{car}» |
| weekly.exclusive | Platinum gives this week's paint | Платина даёт краску этой недели |

(`task.lowhp` and `task.km5` are removed: tasks never reward bad or passive play.)

### 26.14 Trophies, records, stats
| Key | EN | RU |
|---|---|---|
| trophies.title | Trophies | Трофеи |
| trophies.records | Records | Рекорды |
| trophies.stats | Stats | Статистика |
| records.bestLap | Best lap | Лучший круг |
| records.ta | Time Attack | На время |
| records.rank | Rank #{n} | Место #{n} |
| records.top10 | Top 10 | Топ-10 |
| records.spree | Smash Spree | Разгром |
| records.drift | Drift Trial | Дрифт |
| records.topSpeed | Top speed | Макс. скорость |
| records.combo | Biggest combo | Лучшее комбо |
| records.slams | Most slams | Больше всего выносов |
| records.none | No record yet | Рекорда пока нет |
| stat.races | Races | Гонок |
| stat.wins | Wins | Побед |
| stat.objects | Objects smashed | Разбито объектов |
| stat.takedowns | Slams | Выносов |
| stat.driftBest | Best drift | Лучший дрифт |
| stat.km | Distance | Пройдено |
| ach.firstFinish / .d | First Finish / Finish a race | Первый финиш / Финишируй в гонке |
| ach.podium / .d | Podium / Finish in the top 3 | Подиум / Финишируй в топ-3 |
| ach.firstWin / .d | Winner / Win a race | Победитель / Выиграй гонку |
| ach.boss1 / .d | Rookie Champion / Beat Big Mo | Чемпион новичков / Победи Биг Мо |
| ach.boss2 / .d | Harbor Master / Beat Sleet | Хозяин порта / Победи Слита |
| ach.boss3 / .d | Scrap King / Beat Grinder | Король свалки / Победи Гриндера |
| ach.boss4 / .d | Street Boss / Beat Ace | Король улиц / Победи Эйса |
| ach.legend / .d | Legend / Win the Grand Final | Легенда / Выиграй гранд-финал |
| ach.wrecking / .d | Wrecking Ball / Break 1,000 objects | Шар-баба / Разбей 1 000 объектов |
| ach.demolition / .d | Demolition Expert / Break 10,000 objects | Мастер сноса / Разбей 10 000 объектов |
| ach.roadRipper / .d | Road Ripper / Tear up 100 road chunks | Асфальтодёр / Вырви 100 кусков дороги |
| ach.takedown25 / .d | Slam Artist / Make 25 slams | Мастер тарана / Сделай 25 выносов |
| ach.takedown250 / .d | Slam Legend / Make 250 slams | Легенда тарана / Сделай 250 выносов |
| ach.collector / .d | Collector / Own 5 cars | Коллекционер / Собери 5 машин |
| ach.fullGarage / .d | Full Garage / Own all 10 cars | Полный гараж / Собери все 10 машин |
| ach.maxed / .d | Maxed Out / Max every branch on one car | На максимум / Прокачай одну машину полностью |
| ach.stars50 / .d | Star Hunter / Earn 50 stars | Охотник за звёздами / Собери 50 звёзд |
| ach.stars105 / .d | Superstar / Earn all 105 stars | Суперзвезда / Собери все 105 звёзд |
| ach.driftKing / .d | Drift King / Score 10,000 drift points in one race | Король дрифта / Набери 10 000 очков дрифта за гонку |
| ach.untouchable / .d | Untouchable / Win with at least 95% health | Неуязвимый / Победи с прочностью от 95% |
| ach.comeback / .d | Comeback / Win after being last after lap 1 | Камбэк / Победи, будучи последним после первого круга |
| ach.mirror / .d | Mirror Match / Win with "Same as mine" rivals | Зеркальный матч / Победи соперников на твоей же модели |
| ach.loyal / .d | Loyal Racer / Claim 7 daily rewards | Верный гонщик / Забери 7 наград дня |
| ach.phoenix / .d | Phoenix / Win after being wrecked in that race | Феникс / Победи после того, как тебя разбили в этой гонке |
| ach.master1 / .d | Car Master / Reach mastery 5 with one car | Мастер машины / Достигни мастерства 5 на одной машине |
| ach.remix35 / .d | Remix Legend / Earn all 35 platinum stars | Легенда ремикса / Собери все 35 платиновых звёзд |
| ach.unlocked | Trophy unlocked: {name} | Новый трофей: «{name}» |

### 26.15 Reveal, toasts, cosmetics
| Key | EN | RU |
|---|---|---|
| reveal.car | New car! | Новая машина! |
| reveal.league | New league open! | Открыта новая лига! |
| reveal.track | New track: {track} | Новая трасса: «{track}» |
| reveal.feature | New: {feature} | Новое: {feature} |
| feature.quick | Quick Race with any car, even locked ones | Быстрая гонка на любой машине, даже закрытой |
| feature.rivals | Pick your rivals' cars | Выбор машин соперников |
| feature.tasks | Daily tasks | Задания дня |
| feature.challenge | Daily Challenge | Вызов дня |
| feature.shop | Cosmetic shop | Магазин стиля |
| feature.weekly | Weekly Smash Cup | Кубок недели |
| feature.remix | Legend Remix | Ремикс легенд |
| toast.claimed (n) | +{n} coin \| +{n} coins | +{n} монета \| +{n} монеты \| +{n} монет |
| toast.adCap | Come back tomorrow for more | Возвращайся завтра |
| shop.title | Shop | Магазин |
| shop.paints | Paints | Краски |
| shop.rims | Rims | Диски |
| shop.owned | Owned | Есть |
| shop.allCars | Works on every car | Подходит для всех машин |
| shop.exclusive | Exclusive: {source} | Эксклюзив: {source} |
| mastery.level | Mastery {n} | Мастерство {n} |
| mastery.up | {car}: mastery {n}! | «{car}»: мастерство {n}! |
| mastery.badge | Master | Мастер |
| paint.limeFizz | Lime Fizz | Лаймовая шипучка |
| paint.lightning | Lightning | Молния |
| paint.midnight | Midnight | Полночь |
| paint.racingStripe | Racing Stripe | Гоночная полоса |
| paint.mirror | Mirror | Зеркало |
| paint.remix | Remix | Ремикс |
| paint.championGold | Champion Gold | Чемпионское золото |
| rims.copper | Copper | Медь |
| rims.ice | Ice | Лёд |
| rims.gold | Gold | Золото |
| rims.chrome | Chrome | Хром |

The names of the 12 premium paints, the other rim colours and the weekly paints are written by the UI-meta package in the same style and checked by the RU proofreading job.

Obsolete keys (`results.continue`, `tut.*`, `menu.play`, `tracks.title`, `track.lockedHint`, `garage.testDriveFree`, `garage.testDriveAd`, `toast.testDriveUsed`, `star.gain`, `task.lowhp`, `task.km5`, `quick.rivalsCount`, `tip.knockout`) are removed by the UI packages once unused; the i18n test keeps EN and RU in sync.

---

## 27. Priority summary

**P0 (v0.2):**
- 10 cars (physics, perks you notice, drift traits, merged-mesh models, engine sounds, garage), hybrid Workshop + Signature upgrades, PR, "drive it free in Quick Race", per-car paint, cosmetic shop, car mastery.
- Rival cars sheet (Mixed, Same as mine, One model, Random) with fair normalisation by upgrade levels; named drivers with signature cars, traits, head-to-head; revenge.
- Drift mechanic (assist in the sim, opt-in brake tap, Space, DRIFT button), boost stack, slipstream, perfect start, style meter → Smash Nitro.
- Power-ups and boost pads (in flight) with the distribution table and AI use; item boxes and pads inside the destruction system.
- One destruction system for every object; smash score, combos, slams with anti-farming, mass-normalised damage with one damage chain, wreck → respawn with parts back, anti-cut sectors, wrong way, track evolution toast; the preserved physics rules (9.6).
- AI per-car awareness, two-rate decisions, archetypes, AI drift, items, attacks with one token, fair rubber band on a fixed radius, league tiers, fail assist, bosses, driver renames.
- Fixed camera default, Follow option with forward visibility, directional kick, one-finger gestures with false-positive safety, left-handed mode, haptics, slow motion.
- 10 layouts (t1 to t5 forward and reverse), Harbor and Scrapyard themes.
- Modes Race, Sprint, Time Attack (medal ghosts), Smash Spree (refills), Knockout (grace), Drift Trial (drift ghost), Boss Duel, Grand Final; 6 modifiers; mode cards.
- Career 35 events with soft gates; Quick Race; Daily Challenge; **Weekly Smash Cup; Legend Remix**.
- Economy tables, XP and levels with titles and cosmetics, login calendar, daily tasks, 26 achievements, **Records, Playgama leaderboards (10 Time Attack boards)**.
- FTUE (no-menu first race with 4 lessons, races 2 to 5 lessons, choose 2nd car, guided upgrade); HUB, Garage, Results (records, crash replay), Pause, Settings, HUD v2 (gaps, minimap), next-goal line, red dots, unlock reveal, Records, Shop; close buttons on every popup.
- Rewarded R1 to R5 (hidden when unsupported), interstitial placements, Bridge config at platform defaults.
- Save v2 + migration (payments reserved), telemetry on Bridge analytics, performance budgets with throttled and real-device gates, all strings EN + RU with plural forms.
- Release blocker: sourced, licensed audio and music (WP14).

**P1:** near miss, shortcut gates, explosive barrels, theme hazards, night variants, Neon Avenue, weekly tasks, decals and rim shapes, hidden difficulty adjustment, photo finish, final-lap music stem, reduce flashes, text size, full keyboard focus, custom/same-class rivals, R6 to R8, Slam Brawl, car-class leaderboards, Bridge achievements mirror, TR / ES / PT-BR locales (strings already go through `t()`; proofread by the Haiku swarm).

**P2:** IAP catalog (fields reserved in P0), Wreck Arena, falling structures, rain.

---

## 28. IP review (original IP only)

| Area | Checked | Result |
|---|---|---|
| Car names, driver names, boss names, track names, league names | against real car models, makers, brands and known game characters | renames done (A13, Skid); the WP13 IP job re-checks the final lists |
| Mode names | Race, Sprint, Time Attack, Knockout, Drift Trial, Boss Duel, Grand Final, Weekly Smash Cup, Legend Remix: generic words | "Rampage" is the title of a known game series → **Smash Spree**; "Takedown Brawl" → **Slam Brawl** |
| HUD and item terms | Nitro, Slipstream, Shockwave, Ram Shield, Repair Kit, Boost pad, Smash Nitro: generic | "Takedown" is the title feature of a known racing series → **SLAM** in the UI (RU «ВЫНЕС» was already neutral) |
| Mechanics | item rows with a roulette, position-weighted items, drift boosts, slipstream: common genre mechanics, not protected; no specific item, name or effect copied | keep |
| Icons and look | item box = a crate with a bolt glyph (never a question-mark cube); original SVG icons; no logos | keep |

The WP13 IP job (Haiku swarm) extends to mode names, item names, HUD terms and icons, and its result is added to this table before release.
