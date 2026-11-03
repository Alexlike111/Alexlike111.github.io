# Smash Circuit: Game Design Document v2

Status: design for the next big update (v0.2). Written 2026-11-03 against commit `b60ac57` (v0.1.1). Two features are being built while this is written and are treated as existing: **visible car damage with flying parts**, and **boost pads + power-ups (Nitro, Ram Shield, Repair Kit, Shockwave)**.

Sources merged: four independent proposals (retention and economy, core gameplay and feel, content and variety, mobile UX and FTUE), the owner's binding requirements (`docs/REQUIREMENTS.md`), the owner's feedback, and the code.

Priority tags: **P0** = this big update (v0.2), **P1** = next update (v0.3), **P2** = later. Anything not tagged inherits the tag of its section.

Implementation plan for the P0 scope: `docs/PLAN.md`.

---

## 0. Owner decisions taken by default (confirm or change)

| # | Question | Default chosen | Why |
|---|---|---|---|
| D1 | "The player can choose any car": all open, or unlockable? | **All 10 cars are drivable from minute one in Quick Race and in the Daily Challenge.** Career needs an owned car. Every locked car gets one free career test drive, then more test drives via an opt-in rewarded ad. Owning a car = upgrades, paint, career use. | Meets the request literally and keeps a collection goal for retention. Switch `CONFIG.garage.allCarsOwned` opens everything if the owner wants it. |
| D2 | Progression: "top-3 opens next track" (old default 11.12) | **Replaced by a 5-league career with stars and bosses.** | The owner now asks for long retention. The old rule gave about 3 races of content. |
| D3 | Upgrades global or per car? | **Per car.** Same 3 branches (engine, grip, armor) and 5 levels as decided. Costs scale with car tier. Bought cars arrive at level 1 in every branch, boss cars at level 2. | Each new car is a fresh progression track and a coin sink for weeks. Global upgrades max out in about 1.5 h of play (measured by the pacing script). |
| D4 | A wrecked car limps at 25% power for the rest of the race | **Wreck card (1.8 s), then respawn 20 m back at 50% health**, ghosted for 2 s. | Limping meant certain last place and quitting. Respawn keeps the race alive and makes takedowns matter. |
| D5 | Camera | **Follow (track-up, rotates with the road) by default; Fixed (north-up, today's camera) in Settings and Pause.** | A north-up camera makes steering feel inverted whenever the car drives down the screen. Follow also shows about twice as much road ahead in portrait. |
| D6 | Ads timing | Bridge config `initialInterstitialDelay 30 → 180`, `minimumDelayBetweenInterstitial 60 → 180`. Our code only marks natural pauses. | The first race stays ad-free (better D1). 180 s is inside Playgama's guidance and is platform config, not our own timer. |
| D7 | Daily login streak | Never resets on a missed day. | Casual web players who lose a streak do not come back. |
| D8 | First race | Tuned to be winnable: 2 laps, weaker field, first item box always Nitro. | First win = the strongest D1 lever. Nothing visibly cheats. |
| D9 | Car names | Translated (Scrapper / Жестянка). Driver and boss names stay proper nouns. | Car names are descriptive words; Russian kids should read them. |

---

## 1. Pillars

1. **Slide, Smash, Surge.** Every corner is a drift chance, every wall and rival is a smash chance, and both feed a boost you feel at once.
2. **Destruction pays.** Smashing earns score, coins, style, stars, tasks and achievements. The USP of the game is also the USP of its economy.
3. **Ten cars that play differently.** Each car has its own silhouette, handling, drift style and one perk. Choosing a car is a tactical decision, not a paint swap.
4. **Always one obvious next goal.** One big button, one "next goal" line, one tap from results to the next race.
5. **One finger, one hand, any device.** Everything (gas, steer, brake, drift, item) works with the thumb on the GAS button. PC is a first-class citizen with keys.
6. **Short loop, long arc.** About 2.3 minutes per race loop, 12 to 20 minute sessions, 5 hours of career, weeks of collection.

Keep (the owner likes these, do not regress): the destruction system (walls, guardrails, road chunks, props), zone damage, the cartoon low-poly look, props thrown clear, the AI racing line and overtakes, the best-lap ghost, the two-tap confirm on Quit and Restart, safe areas, and the build label.

---

## 2. Audit summary: what a demanding player hits in the first 10 minutes of v0.1.1

| # | Gap | Fix in v0.2 | P |
|---|---|---|---|
| A1 | One car for everyone; the grip stat barely changes cornering (`carModel.ts` uses the global `maxLatAccel`, and so does `ai.ts`) | 10 cars with per-car cornering limit, size, mass and perk; the grip upgrade raises the cornering limit | P0 |
| A2 | Car damage ignores mass (`sim.ts` gives both cars the same impulse), so heavy cars would take more damage than light ones | Damage scales with Δv (impulse × 1000 / own mass) | P0 |
| A3 | Phones cannot drift (touch never sets handbrake), and drifting is always slower | Drift mechanic with charge tiers and exit boosts; touch drift assist | P0 |
| A4 | North-up camera: steering feels inverted on down-screen sections; portrait shows about 0.5 s of road ahead at top speed | Follow camera with forward-visibility rule | P0 |
| A5 | Results → Continue → interstitial → menu → Play → track: 3 taps and an ad between races | Results [NEXT ▶] in one tap; first launch goes straight to race 1 | P0 |
| A6 | 3 tracks, one goal ("top 3"); nothing for tomorrow | Career 35 events, 10 layouts, 7 modes, daily rewards and tasks, achievements | P0 |
| A7 | Destruction pays a flat 6 coins per piece (a cone = a concrete wall); prop farming ≈ winning | Smash score by kind, combos, diminishing coins | P0 |
| A8 | Hitting rivals has no goal | Takedowns, wreck and respawn | P0 |
| A9 | Likely lap cut on Frost Pass: smash 2 walls, cross 55 m of grass, skip about 300 m (`race.ts` accepts any stable jump > 25 m) | Sector checkpoints | P0 |
| A10 | Repair can cost more than first place pays; the HUD shows a price the player cannot pay | Repair cap 40% of the event's first prize; "can't afford" state; free repair by rewarded ad (1 per race); Repair Kit item | P0 |
| A11 | First race usually lost (player starts 6th of 8; the base car finishes about 3rd on t1) | Tuned first race | P0 |
| A12 | No wrong-way warning, minimap, position-change feedback or lap delta | HUD v2 | P0 |
| A13 | Driver names `Viper`, `Maverick`, `Nitro`, `Comet`, `Bolt` are real car model names; `Gaz` is a car maker; `Pixel`, `Mango` are brands | Rename (original IP) | P0 |
| A14 | Settings lack separate music and effects volume (music is mandatory on Playgama), left-handed mode, sensitivity, camera, reduce motion | Settings v2 | P0 |
| A15 | All sound files are code-synthesized placeholders (Playgama 3.3.2 rejects them); no music | Release blocker: recorded or CC0 files for every cue (section 22) | P0 (release) |

---

## 3. Core loop

### 3.1 The 10-second loop (P0)
Approach a corner → steer hard → **drift** (sparks turn blue, then orange, then violet) → ease off → **boost** → catch a rival → **slipstream** → **ram** → the rival hits a wall → **TAKEDOWN** (0.4 s slow motion) → the style meter fills → **Smash Nitro** → plow through a fence.

### 3.2 The race loop (P0)
Event card (car, rivals) → RACE → 3-2-1 (perfect start chance) → 2 to 5 laps of racing, smashing, items and drifting → finish (slow motion, confetti on podium) → results sequence (place, coin breakdown, stars, XP, unlocks, next goal) → **NEXT ▶** (interstitial request at this natural pause) → next event.

Target durations: race 60 to 110 s; whole loop about 2.3 min.

### 3.3 The session loop (P0)
Boot → login popup (from session 2) → hub with the next event highlighted → 4 to 8 races → stopping point: "tomorrow" previews on the results screen and the hub (calendar reward, new tasks timer, nearest car, boss stars).

Feel targets (checked in play-tests and telemetry):

| Metric | Target |
|---|---|
| Drifts per lap (average player) | 3 to 6 |
| Takedowns per race (average / skilled) | 1 to 2 / 4 to 6 |
| Style meter fills per race | 2 to 3 |
| Gap between 1st and 3rd at the finish | under 2.5 s in at least 55% of races |
| Player finishes within 2 s of a rival | at least 60% of races |
| Average place on the first try of a new event | 2 to 4 |
| Share of race time with at least one rival on screen | at least 70% |

---

## 4. Meta loop (P0)

```
Race events ──► coins ──► per-car upgrades ──► higher PR ──► harder events
     │           │                                              │
     │           └──► buy cars (star-gated) ◄── stars ◄─────────┤
     │                                                          │
     └──► XP ──► driver level ──► features + level coins        │
     └──► smash/drift/takedown counters ──► daily tasks, achievements
Bosses (end of each league) ──► trophy cars + next league
Daily: login calendar + 3 tasks + Daily Challenge (any car, free test drive)
```

Progress tracks: **Coins** (the only currency, owner rule), **Stars** (career, 105 total), **Driver level** (XP), **Achievements**, **Car collection**. P1 adds car mastery and the weekly cup.

---

## 5. Controls and camera

### 5.1 Touch: one-finger gesture grammar (P0)
Everything happens on the thumb that holds GAS (bottom-right; bottom-left in left-handed mode).

| Action | Gesture | Thresholds (CONFIG.controls) |
|---|---|---|
| Gas | Hold GAS | exists; auto-gas option exists |
| Steer | Slide the GAS thumb left or right | exists: dead zone 4% of width, full lock at 22% (less to the right edge); new sensitivity slider 70 to 140% scales `steerFullAt` |
| Brake / reverse | Pull the thumb down by 0.4 button sizes | exists |
| **Drift (assist, default ON on touch)** | Hold full lock (|steer| ≥ 0.9) for 0.12 s while forward speed ≥ 14 m/s (50 km/h) and throttle is on | `driftAssistSteer 0.9`, `driftAssistHold 0.12`, `driftMinSpeed 14`; with `assistNeedsCorner` the track must curve ahead (|curvature| ≥ 0.015 within 30 m) so a correction on a straight does not start a drift |
| **Drift (brake tap, always on)** | A pull-down shorter than 0.25 s while |steer| > 0.5 | gives a 0.35 s handbrake impulse instead of braking; the classic "tap the handbrake" move |
| **Use item** | **Flick up**: the thumb moves up by 0.45 button sizes within 0.25 s, then returns | fires once; re-arms when the thumb is back within 0.25 sizes of home; gas stays on during the flick |
| Use item (2nd finger) | Tap the item slot above GAS | |
| Drift (2nd finger, optional) | DRIFT button, bottom-left, replaces BRAKE when Settings → "2nd-finger button" = Drift | P0 |
| Pause | ⏸ button (SVG) top-right | |
| Repair | Tap the damage silhouette | |

**Steering arc (P0):** while the thumb is down, a thin SVG arc above GAS shows the neutral tick, the full-lock tick and the red DRIFT zones at the ends; a dot shows the thumb. It fades to 30% after the drift tip has been seen.

**Left-handed mode (P0):** mirror GAS, the item slot and the 2nd-finger button; HUD clusters swap sides via a `.lefty` class.

**Haptics (P0, Android only, feature-detected, setting default ON):** 12 ms on drift entry, 20 ms on boost, 25 ms on item use, 40 ms heavy impact, 60 ms takedown, 90 ms player wrecked.

### 5.2 PC keys (P0)
W/↑ gas, S/↓ brake and reverse, A/D or ←/→ steer, **Space = drift** (hold; also the handbrake), **E or Shift = use item**, R = repair, P = pause. **Never Esc** (Playgama 1.5.2). Menus: Enter = primary button, ←/→ = carousel, Backspace = back (P0); full Tab focus with a visible ring (P1). Drift assist default OFF on PC (setting).

### 5.3 Camera (P0)

| Item | Follow (default) | Fixed (option) |
|---|---|---|
| Rotation | azimuth target = track tangent at s + 12 m + 0.5 s × speed, blended 25% toward the velocity heading (so a drift does not swing the view); damping 2.4/s; rate cap 1.6 rad/s (1.0 with Reduce motion); snap on respawn and reset; hold the azimuth while the car points more than 120° off the track direction | north-up (today) |
| Player anchor | 30% of the view height from the bottom, portrait and landscape | centre plus look-ahead (today) |
| Forward-visibility rule | zoom so that road visible ahead ≥ max(40 m, 1.1 s × speed); clamp so the car stays ≥ 32 CSS px long | today's view widths |
| Zoom pulses | speed +25% (exists), boost +8% (in 0.15 s, out 0.6 s), drift +5%, slow motion −12%, last 150 m of the race −6% | same |
| Shake | trauma as today plus a **directional kick** along the impact normal (0.35 m × strength, spring k 90, c 14); caps 1.0 m portrait / 1.3 m landscape; Settings → Screen shake Full / Reduced (×0.4) / Off | same |
| Finish | 0.5 s slow motion, then a slow 120° orbit around the player during `resultsDelay` | same |

Portrait 390×844 in Follow mode sees about 53 m ahead at rest (today about 23 m). Landscape phone 844×390 zooms out until 40 m are visible (car about 31 to 34 px). The minimap (section 20.6) stays north-up.

---

## 6. Drift (P0)

Files: `src/sim/drift.ts` (state machine), `src/sim/carModel.ts` (drift branch of `integrateCar`), `src/sim/boost.ts` (exit boost). The same rules apply to AI cars.

### 6.1 States
`grip → drifting → clean exit (boost) | spin-out | cancelled`

**Entry (any one):**
- Assist (touch default): see 5.1.
- Manual: `drift` input held (Space, DRIFT button, brake tap) with |steer| ≥ 0.3 and forward speed ≥ 14 m/s.
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

Balance targets (unit tests): a T2 drift through a 30 m radius corner exits 0.15 to 0.35 s ahead of the best clean grip line; a T1 drift through a 10 m hairpin comes out between −0.05 and +0.10 s. Drifting rewards skill and is never required.

### 6.3 Drift score
- Points per second = 60 × (θ / 25°) × (v / 20); tier bonus on clean exit (table above).
- **Chain:** a new drift within 1.8 s of a clean exit adds ×0.5 to the multiplier (max ×3); a hit or 1.8 s without drifting resets it.
- HUD: a world-space counter above the car, "DRIFT 420 ×2", white → yellow → orange → violet; on release "+420" flies to the score/coin counter.
- Drift points feed: drift coins, XP, the style meter, Drift Trial scores, tasks and achievements.

### 6.4 Events and state (contract)
`SimEvent`: `driftStart`, `driftTier`, `driftEnd{tier, points, clean}`, `spinOut`. `CarState`: `driftState`, `driftAngle`, `driftCharge`, `driftTier`, `driftPoints`, `driftChain`.

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
Gas pressed (0 → 1 edge) within [GO − 0.35 s, GO + 0.12 s] → "PERFECT START" and the boost. Holding gas from earlier gives a normal start and is never punished. The countdown shows a green zone on the last light. AI chance = skill × 0.6. Tip "Tap GAS on GO" from race 3. The first race has no perfect-start window (its countdown starts on the first touch).

### 7.4 Style meter → Smash Nitro
A 0 to 100 meter (ring around GAS on touch, bar beside the speedometer on PC). When full it becomes a **Smash Nitro** in the item slot (queued if the slot is busy). One slot, one gesture.

| Gain | Style |
|---|---|
| Drift clean exit T1 / T2 / T3 | 6 / 12 / 20 |
| Takedown | 35 (Revenge 50, P1) |
| Wall or guardrail smashed | 3 |
| Road chunk torn | 5 |
| Prop | 1 (max 10 per lap) |
| Perfect start | 10 |
| Slingshot | 4 |
| Near miss (P1) | 4 |

Expected: about one fill per lap for an average player.

---

## 8. Power-ups and boost pads

The in-flight agent builds the items and pads. These are the **target numbers**; WP0 reconciles them with what was built.

### 8.1 Item boxes (P0)
- Rows of 3 to 4 boxes across the road, 2 to 3 rows per layout (about every 300 m), never inside a braking zone, never within 40 m after the start line.
- A box respawns 4 s after pickup. One item slot per car; a full slot ignores boxes.
- Pickup plays a 0.6 s roulette on the slot icon. **The first box in the player's first race always gives Nitro.**
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
| Repair Kit | instant heal | each zone heals 50% of its missing HP, at least +25 HP; lost parts stay lost ("taped up") | — |
| Shockwave | radial blast | arms in 0.25 s (visible ring), radius 9 m, push 9 m/s × falloff, 12 HP to the facing zone, cancels Nitro, breaks props and guardrails within 6 m, never affects the user | Ram Shield |
| Smash Nitro | style reward | 7.1 | — |

### 8.3 AI item use (P0, `src/sim/ai.ts`, personality `itemIQ` 0 to 1)
- Reaction delay lerp(1.2, 0.3, itemIQ) s; use anyway after 8 s.
- Nitro: when the next 2 s of road have |curvature| < 0.004 and nobody is within 25 m ahead in the chosen lane (low IQ: random moment).
- Shield: a rival closes from behind within 10 m at > 4 m/s, or before ramming, or at health < 0.4.
- Repair: high IQ at health < 0.55; low IQ at once.
- Shockwave: 2+ rivals within 7 m, or one alongside within 4 m with a wall within 3 m on its side.
- Fairness: the AI never shockwaves the player in the first 8 s or the last 5 s of a race.

### 8.4 Boost pads (P0)
- Chevron decal 6 × 3 m, glowing arrows, pad zap sound. Numbers in 7.1.
- 2 to 4 per layout: the exits of the two slowest corners and the start of the longest straight; on Frost Pass on the exits of the three tightest hairpins (drift → pad → double boost, under the caps); one right after each shortcut gate (P1).
- P2: a torn road chunk under a pad destroys the pad for the rest of the race.

---

## 9. Destruction as gameplay

### 9.1 Smash score (P0; replaces the flat `destructionBonus`)

| Event | Points | Style |
|---|---|---|
| Cone, sign | 5 | 0.5 |
| Barrel, crate, hay bale, tyre stack | 10 | 1 |
| Guardrail segment | 25 | 3 |
| Wall segment | 40 | 3 |
| Road chunk torn | 60 | 5 |
| Tree, rock | 50 | 4 |
| Takedown | 300 (Revenge 600, P1) | 35 |
| Near miss (P1) | 20 | 4 |
| Shortcut gate (P1) | 100 | 8 |

- **Combo:** each smash within 1.5 s of the previous one adds ×0.25 to the multiplier (max ×3); the HUD shows "SMASH ×4". Breaks the player did not cause score nothing (attribution exists: `lastHitBy`).
- **Coins from smash** = (min(S, 1500)/10 + max(0, S − 1500)/20) × league multiplier. Diminishing returns end prop farming.
- **Track evolution (P0, free):** on the final lap, if 25% or more of the walls are down, the toast "The track is breaking up!" and extra dust. The damage the owner asked for becomes a visible feature.

### 9.2 Takedowns (P0)
A rival counts as taken down by car X if, within **2.0 s** of contact attributed to X:
- it becomes wrecked, or
- it hits a wall or prop with impact strength ≥ 0.45, or
- it spins out (heading > 100° off the track tangent, or speed below 35% of its pre-contact speed for ≥ 0.5 s).

Attributed contact = car-to-car impulse ≥ 6000 N·s (about 5 m/s closing speed), or X's Shockwave. Cooldown per victim 4 s. Event `takedown{by, victim, kind}`.

**Attacker and victim damage split:** split car-to-car damage by each car's closing speed along the contact normal: the car moving into the other takes ×0.55, the car being hit takes ×1.15 (on top of `carVsCarMul`). Each car's `ramDamageMul` multiplies the damage it deals. Ramming is worth it.

**Mass-normalised damage (P0, prerequisite for 10 cars):** recorded impulse × (1000 / own mass), so damage follows Δv. A Mammoth ramming a Needle at 20 m/s: the Needle loses at least 3× the HP the Mammoth loses.

### 9.3 Wreck and respawn (P0, decision D4)
- Wrecked (health ≤ 12%): parts burst off, smoke plume, 0.5 s slow motion (player involved only), "WRECKED" card for 1.8 s.
- Respawn 20 m behind the wreck point on the centre line, facing forward, at **50% health in every zone** (lost parts stay lost), ghosted for 2 s (collisions are sensors, the car blinks).
- Total cost about 4 to 5 s. Same rule for AI, so a takedown really removes a rival for a moment while the field keeps its size.
- Knockout mode: an eliminated car explodes into parts and leaves the race instead.

### 9.4 Anti-cut sector checkpoints (P0, must)
- Each lap is split into sectors of about 60 m (13 to 18 per layout).
- Progress beyond the next sector is not credited until that sector has been crossed in order. A jump > 40 m along the track counts only if it crosses an authored shortcut (P1).
- Skipping a sector: HUD "MISSED CHECKPOINT" with an arrow back; the lap does not count until the car returns.
- Sector gates have lateral tolerance = road half-width + wall offset + 3 m, so wide lines and wall plow-throughs that clip a corner stay legal.
- Fixes the Frost Pass serpentine cut and protects the best-lap leaderboard.
- **Wrong way:** heading more than 120° off the tangent for 1.0 s at > 5 m/s → "WRONG WAY"; after 5 s a free "Tap to go back" reset.

### 9.5 Later

| Feature | Notes | P |
|---|---|---|
| Revenge | the rival who last took you down gets a red marker; taking them down pays ×2 points and "REVENGE!" | P1 |
| Near miss | rival passes within 0.6 m edge to edge at ≥ 6 m/s relative, no contact for 0.3 s: +20 points, +4 style, whoosh | P1 |
| Breakable shortcut gates | wooden or chevron fences (HP 90, break at about 35 km/h) between close road stretches, gravel behind (grip 0.85, drag 0.6); once broken they stay open; saves 0.8 to 1.5 s for 8 to 15% health; ≤ 12% of a lap; one pad after each gate | P1 |
| Explosive fuel barrels | red with hazard stripe; explode above impulse 300: radius 6 m, push 8 m/s, 15 HP, chain to other barrels after 0.15 s; clusters of 2 to 3 at corner exits | P1 |
| Theme hazards | ice patches on Frost Pass (grip 0.6), oil slicks on Harbor Run, sand drifts on Dust Canyon | P1 |
| Falling structures | water tower or billboard falls across half the road for 20 s | P2 |
| Pads destroyed by torn road | | P2 |

---

## 10. Cars (P0)

### 10.1 Data model
One roster in `CONFIG.cars` (physics and traits) and `CONFIG.garage` (price, unlock, tier). `CarStats` gains `latAccelMul`, `steerMul`, `brakeMul`, `length`, `width`, `drift{chargeMul, angleMul, dragMul, entryMul, spinMul, hbGripMul}`, `traits`. `CarSetup` gains `modelId`. `statsFor(modelId, upgrades)` applies upgrades to the model's own base.

Traits are generic numeric multipliers (1 = neutral), each applied at one existing code point: `offroadDragMul`, `offroadGripMul`, `propSlowMul`, `plowKeep`, `ramDamageMul` (front-contact only when `ramFrontOnly`), `zoneDamageMul{zone: mul}`, `repairCostMul`, `repairKitMul`, `nitroDurationMul`, `slipFillMul`, `slipCeilMul`, `launchWindowMul`, `launchKickMul`, `downforce` (extra cornering at top speed), `knockbackMul` (Shockwave push).

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

### 10.3 Roster: perk, drift trait, silhouette, unlock

| Car | Line (UI) | Perk (numbers) | Drift trait (numbers) | Silhouette for modelers (top-down, must read at ~50 px; same 8 part slots) | Unlock |
|---|---|---|---|---|---|
| Scrapper | "Cheap, cheerful, fixes itself" | **Patch-up:** repair cost ×0.65, Repair Kit heals ×1.5 | Neutral (all 1.0) | Short boxy 3-door hatch; cabin centred and long (55% of length); stubby bonnet; two thin roof stripes; chunky rubber bumpers; small round mirrors; small flush wheels (r 0.42). Reads as "the friendly box". | Starter |
| Gravel | "Born sideways" | **Sideways:** grass drag ×0.7 | **Rally:** charge ×1.4, entry ×1.25, handbrake grip ×0.72 (0.18), assist triggers at |steer| 0.8 | Hatch like Scrapper but: 4-lamp light pod on the bonnet (lights mesh), roof scoop, wide rally wing overhanging the tail (spoiler), flared arches (+0.08 m), mud flaps, number roundels on the doors. Reads as "hatch with a wing and a light pod". | Choice after race 1 (free), else 2,000 coins at 3★ |
| Brick | "Slow. Unstoppable. Rude." | **Wide Load:** props and debris barely slow it (propSlowMul 0.3); ram damage dealt ×1.4 | **Lazy:** charge ×0.9, angle ×0.85, rotates slowly | Long tall box van; short sloped snout = front 30%; flat roof with a roof rack carrying two crates (spoiler); sliding side panels (doors); big step rear bumper; tall van mirrors; wheels at the corners. Reads as "a big rectangle". | Choice after race 1 (free), else 2,000 coins at 3★ |
| Sandhopper | "Grass? What grass?" | **Off-road King:** grass/hole drag ×0.3, off-road grip ×1.4 (cuts through broken walls) | **Skippy:** charge ×1.1, entry ×1.2, short snappy drifts | Dune buggy: minimal tub inside a thin dark roll-cage outline (an "X" skeleton seen from above); seat visible; narrow nose; huge rear wheels (r 0.55) sticking out wider than the body, small front wheels (r 0.42); side nets (doors); spare tyre on the back (bumperR); small tank on the nose (hood); whip pole with a pennant (spoiler). | 3,000 coins at 6★ |
| Brawler | "Burnouts, not brakes" | **Burnout:** perfect-start window ×2, launch kick ×1.5 | **Smoky:** charge ×1.25, drift drag ×0.75 (no power cut while sideways) | Muscle coupe: very long bonnet (55 to 60% of length) with a raised scoop (hood); small cabin set back; short tail with a ducktail lip (spoiler); fat rear tyres; twin stripes over bonnet, roof and tail. Reads as "long nose, tiny cabin". | Beat the L1 boss (arrives at level 2) |
| Bruiser | "Front-first problem solver" | **Bull Bar:** front zone takes ×0.5 damage; front contact deals ×1.6 to cars and ×1.3 to walls | **Heavy swing:** neutral charge, angle ×1.1 | Pickup: cab in the front half, open bed behind (dark inset with two barrels); big chrome bull bar wider than the body (bumperF); roll bar with 4 lamps behind the cab (spoiler); tall tyres. Reads as "cab, empty box, grille". | 9,000 coins at 24★ (L2 open) |
| Glint | "Fast and fragile" | **Slipstream Pro:** slipstream fills ×2 faster, ceiling ×1.08 instead of ×1.05, slingshot ×1.5 | **Precise:** drift drag ×0.85, angle ×0.9 | Low wedge: triangle nose, teardrop dark canopy far back, flat wide rear wing on two struts (spoiler), side intakes (doors), pop-up lamps. Reads as "an arrowhead". | Beat the L2 boss (arrives at level 2) |
| Scorcher | "All engine, some car" | **Afterburner:** Nitro and Smash Nitro last ×1.5; engine zone takes ×1.3 damage (exposed) | **Wild:** charge ×1.2, angle ×1.15, spin threshold ×0.92 (risky) | Hot rod: narrow nose with an exposed chrome engine block and two rows of exhaust stacks (hood); tiny cabin at the rear; giant rear wheels outside the body; thin front wheels on visible axles; flame decals on the sides. Reads as "an engine with wheels". | 20,000 coins at 45★ (L3 open) |
| Needle | "Glass rocket" | **Downforce:** cornering +10% at top speed (linear from 50% of top speed); wheel zones take ×1.5 damage; off-road drag ×1.3 | **Grip racer:** charge ×0.8, drift drag ×1.2 (prefers clean lines) | Open-wheel racer: cigar body narrower than the wheel track; 4 exposed wheels; front wing (bumperF) and tall rear wing (spoiler); sidepods (doors); open cockpit with a helmet dot; mirrors on stalks. Reads as "a pencil with 4 wheels". | Beat the L4 boss (arrives at level 2) |
| Mammoth | "Walls are suggestions" | **Juggernaut:** plow-through keeps 90% of speed (global 62%), immune to Shockwave push, ram damage dealt ×1.5 | **Barge:** charge ×0.9, wide slow slides | Armoured monster truck: huge wheels (r 0.75) at the corners outside the body; high flat roof; riveted armour plates (doors); wide angled plow blade (bumperF); roof cage (spoiler); twin exhaust stacks. Reads as "a big square on 4 big circles". | Beat the L3 boss (arrives at level 2) |

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

Rule: every car except the Scrapper has one bar ≥ 8 and one ≤ 3, so the bars read as "different" at a glance.

### 10.4 Upgrades: per car (P0, decision D3)
Same branches and level count as decided by the owner; values in config.

| Branch | Effect per level (L5 total) |
|---|---|
| Engine | power +7%, ceiling +4% (×1.35, ×1.20) |
| Grip (tyres) | grip rate +7% **and cornering limit +5%** (×1.35, ×1.25); today the grip upgrade does almost nothing |
| Armor | armor +18% (×1.9) |

Cost of the next level = base × tier multiplier:

| Next level | 1 | 2 | 3 | 4 | 5 | Per branch | Per car |
|---|---|---|---|---|---|---|---|
| Base (tier 1, ×1.0) | 300 | 650 | 1,300 | 2,400 | 4,200 | 8,850 | 26,550 |
| Tier 2 (×1.6) | 480 | 1,040 | 2,080 | 3,840 | 6,720 | 14,160 | 42,480 |
| Tier 3 (×2.4) | 720 | 1,560 | 3,120 | 5,760 | 10,080 | 21,240 | 63,720 |

Bought cars arrive at level 1 in every branch ("dealer kit"); boss trophy cars at level 2. Each buy button shows the concrete effect ("Top speed 182 → 188 km/h", "PR 112 → 116").

### 10.5 Test drives and loaners (P0)
- **Quick Race:** any of the 10 cars, owned or not. Not-owned cars run at "showroom tune" (PR = the player's best owned PR) so the choice is fair. Rivals are normalised to the player's PR anyway (section 11).
- **Career:** each locked car gets **one free test drive** (one event at showroom tune = the event's recommended PR); after that "AD · Test drive" (rewarded, max 3 per day). Stars earned in a test drive count. Results show "Liked it? 3,000 coins / 2★ to own it".
- **Daily Challenge:** forced car, often a locked one, at showroom tune.

### 10.6 Paint (P0) and cosmetics
- Paint saved **per car** (today `carColor` is global). The 8 base colours are free.
- P1: premium paints (500 to 2,000), decals (750 to 3,000), rim styles (600 to 2,500), car mastery (per car XP: livery, decal, rims, gold finish).
- Champion gold livery: reward for the L5 final (P0).

---

## 11. Rival cars (P0, owner request)

Pre-race "Rivals" bottom sheet on the event card (2 taps). The choice persists (`save.rivals`).

| Option EN / RU | Rule | Default |
|---|---|---|
| Mixed / Разные | 7 AI cars drawn from all 10 (locked ones too, which advertises them); at most 2 of a model; at least 1 heavy and 1 light | ✔ |
| Same as mine / Как у меня | all 7 drive the player's model in distinct paints: the pure skill race | |
| One model / Одна модель | the player picks one model for all 7 (grid of 10 thumbnails) | |
| Random / Случайные | fully random, duplicates allowed | |
| Custom per slot / Свои | 7 slots, tap a slot → car grid | P1 |
| Same class / Тот же класс | AI from the player's class | P1 |

**Fairness rule:** AI strength comes from the event's target PR (career) or the player's PR × difficulty (Quick Race), never from the chosen model. Each AI car's stats = model base × k, with k chosen so that the car's PR = its target (k clamped 0.8 to 1.35). The model changes handling, size, mass, perk and look, so the choice never changes difficulty or rewards and cannot be exploited. The sheet says so in one line.

**Where:** Quick Race always; career events except Boss Duels and events with the Heavy Metal or One-Make modifier (those fix the field); the Daily Challenge fixes the field.

On the grid splash, in the finish order and in Results each rival shows **name · car** ("Blaze · Mammoth").

Driver names (P0 rename for IP hygiene): keep Blaze, Dusty, Rocket, Turbo, Zed, Rusty, Drift, Kuzya, Vasya, Torque, Sparky, Rex; replace Viper, Maverick, Nitro, Comet, Bolt, Gaz, Pixel, Mango with Grit, Moxie, Sprocket, Pepper, Dynamo, Fenya, Tolik, Ziggy. Boss names: Big Mo, Sleet, Grinder, Ace, Duchess (originals).

---

## 12. AI (P0)

### 12.1 Per-car awareness
`ai.ts` plans with the global `maxLatAccel` and `baseTopSpeed` today. It must use the car's own cornering limit (`19 × latAccelMul × upgrades`), ceiling, brake multiplier and real width (`passClearance`, follow logic), or 10 cars drive identically and wide cars pile up on the 9 m Frost Pass.

### 12.2 Archetypes (persistent per driver name)

| Archetype | Skill range | Aggression | ramBias | driftSkill | itemIQ | Mistakes | Behaviour |
|---|---|---|---|---|---|---|---|
| Racer | high | 0.2 | 0 | 0.5 | 0.8 | ×0.7 | clean line, good at slipstream |
| Bruiser | mid | 0.9 | 0.8 | 0.2 | 0.5 | ×1.0 | rams, takes shields; prefers heavy cars in Mixed |
| Drifter | mid-high | 0.4 | 0.1 | 1.0 | 0.6 | ×1.0, +15% × (1 − skill) spin chance per drift | drifts every corner under 40 m radius |
| Trickster | mid | 0.5 | 0.3 | 0.5 | 1.0 | ×1.0 | optimal items; always takes shortcuts (P1) |
| Rookie | low | 0.3 | 0 | 0.1 | 0.2 | ×1.6 | crashes into props (shows off destruction) |
| Boss | 1.0 | 0.6 | 0.5 | 0.8 | 0.9 | ×0.5 | signature car and livery, intro card, PR target ×1.03, no ease-off |

Field mix: 2 Racers, 2 Bruisers, 1 Drifter, 1 Trickster, 1 Rookie; from L4 the Rookie becomes a second Racer.

### 12.3 AI drift, items, attacks
- Drift: enter when the planned corner radius is under 40 m (Drifter) or 25 m (others, chance = driftSkill) and speed > 15 m/s; exit as curvature falls after the apex. Same state machine, so AI boosts are honest.
- Items: section 8.3.
- Attack (Bruiser and Boss only, never in the first 5 s): target alongside (lateral 1.5 to 3.5 m, overlap ±2 m), speeds within ±4 m/s, the target's wall within 3 m → aim at the target for 0.35 s (sideswipe), then a 6 s cooldown. At most one AI attacks the player at a time; 60% of attacks go AI-on-AI (free spectacle).

### 12.4 Fair rubber band (replaces today's)
1. **No assist while an AI car is within 1.15 × the camera view radius of the player.** Players only resent rubber banding they can see.
2. Off-screen chase (behind the player by > 60 m, full at 200 m): power ×1.10 max (was 1.20), ceiling ×1.04 (was 1.07), corner speed ×1.06.
3. Off-screen ease (ahead by > 50 m, full at 200 m): corner speed −6%, mistake rate ×1.5.
4. Last lap: no ease for AI ahead (honest finish); chase stays.
5. Visible levers instead: slipstream, the position-weighted item table, AI fighting AI.

### 12.5 Difficulty
League tiers (section 15.2) set AI skill, PR target and Bruiser count.

**Fail assist (P0):** after each attempt on an event with no new star: AI skill −0.04 and PR target −1.5% (max 3 steps); reset on a new star. The event card then shows a hint ("Your PR 108, recommended 112: try Engine level 2, +4 PR").

Hidden difficulty adjustment by win margin (P1): +0.025 skill after a win by > 4 s, −0.03 after 6th to 8th; clamp −0.12 to +0.06; never more than ±0.03 per race.

---

## 13. Modes and modifiers

All modes run on the same `Sim` through `SimOptions.mode` (`src/sim/modes.ts`). Scoring numbers live in `CONFIG.modes`.

| Mode EN / RU | Rules | Stars (★1 / ★2 / ★3) | P |
|---|---|---|---|
| Race / Гонка | 8 cars, 3 to 5 laps, items on | top 3 / win / event challenge | P0 |
| Sprint / Спринт | Race with 2 laps, prize ×0.7 | top 3 / win / challenge | P0 |
| Time Attack / На время | solo, 3 laps, ghost of your best lap, pads on, no items; best lap counts | bronze / silver / gold lap time | P0 |
| Rampage / Разгром | 90 s timer, player + 3 Rookie "traffic" cars to ram; score = smash points with combo (section 9.1); items ×1.5 | score thresholds | P0 |
| Knockout / На вылет | 8 cars; from 25 s, every 15 s the last car is eliminated (explodes into parts, leaves); ends when 1 is left or the player is out; HUD "Elimination in 8 s" | survive to top 3 / win / challenge | P0 |
| Drift Trial / Дрифт | solo, 2 laps, drift score with chain; a wall hit breaks the chain; no items | score thresholds | P0 (fallback: Race if drift slips) |
| Boss Duel / Босс | 1 vs 1 against a named boss in a signature car; intro card; 3 laps | win / win by ≥ 2 s / boss challenge | P0 |
| Grand Final | L5 boss: full elite field, 5 laps, the Duchess leads it | win / win by ≥ 3 s / win without repairs | P0 |
| Takedown Brawl | 3 laps, most takedowns wins, Bruiser-heavy field | | P1 |
| Weekly Smash Cup | ISO-week seeded event (layout × mode × modifier) with a loaner car; unlimited attempts; medals | bronze / silver / gold / platinum | P1 |
| Wreck Arena | derby in a bowl, last car moving wins | | P2 |

**Modifiers (P0, near-zero cost):**

| Modifier EN / RU | Effect |
|---|---|
| Glass Cannon / Стеклянная пушка | all damage ×2 |
| Heavy Metal / Тяжёлый металл | rivals drive heavy cars only (Brick, Bruiser, Mammoth) |
| No Repairs / Без ремонта | repair disabled, no Repair Kits |
| Power-up Frenzy / Бонусный угар | item rows ×2, respawn 2 s, pads ×1.25 kick |
| One-Make / Монокласс | everyone drives the player's model |
| Underdog / Аутсайдер | start last; prize ×1.5 |
| Reverse / Реверс | (layout, not modifier) the layout driven backwards |
| Night / Ночь | render-only palette, lamp posts, headlight cones (P1) |

---

## 14. Tracks

Rule: no layout longer than 1,100 m; ≤ 380 props. Frame cost depends on the loaded track, not on how many exist.

| id | EN / RU | Theme | Width | Length | Layout notes | P |
|---|---|---|---|---|---|---|
| t1 / t1r | Green Valley / Зелёная долина | meadow | 14 | 879 m | easiest; flowing; 10 corners, tightest 31 m; FTUE track; fence walls | P0 (reverse new) |
| t2 / t2r | Dust Canyon / Пыльный каньон | desert | 12 | 975 m | 145 m straight (nitro and slipstream showcase), chicane, 12 m hairpin; concrete walls | P0 (reverse new) |
| t3 / t3r | Frost Pass / Морозный перевал | snow | 9 | 780 m | 13 corners, 3 hairpins (10 m); tyre walls; anti-cut sectors mandatory; P1 icy patches on two corner exits | P0 (reverse new) |
| t4 / t4r | **Harbor Run / Портовый рывок** | new `harbor` | 12 | 1,000 to 1,050 m | dockside straight 150 to 170 m beside the water (pad at its start); three 90° container-yard corners (radius 14 to 18 m: brake, turn, boost rhythm); a chicane between crane legs (unbreakable crane feet, breakable container stacks beside them); a 180° sweep around the basin (radius about 35 m); walls `containers` (concrete jersey barriers plus stacked containers); decor: cranes, containers, bollards, water plane, moored boats; P1 oil slicks | P0 |
| t5 / t5r | **Scrapyard / Свалка** | new `junkyard` | 11 | 880 to 950 m | technical: chicane through stacks of car hulks, a tight 180° around the crusher landmark, a fast kink between tyre mountains; **double prop density** (barrels, tyres, crates, cones): the Rampage playground; walls `hulks` (stacked car hulks); decor: crusher, crane magnet, tyre piles | P0 |
| t6 | Neon Avenue / Неоновый проспект | `city`, night only | 13 | about 1,100 m | wide avenue, 90° blocks, long boost straight | P1 |
| — | Night variants (Green Valley Night, Harbor Night) | render-only | | | hemi and sun ×0.35 with blue tint, emissive lamp posts, additive light pools and headlight cones | P1 |
| a1 | The Bowl / Чаша | arena | 30 m wide oval | 260 m | Wreck Arena | P2 |

**Reverse (P0):** `reverseTrack(def)` reverses the control points and rotates them so the start sits on a straight (|curvature| < 0.004 for 40 m before the line). Props are regenerated by the seeded generator with seed + 1, so braking cones and signs move to the new braking zones. Each reversed layout has its own AI speed factor, ghost, best lap, medal times and leaderboard id; the card gets a "REVERSE" ribbon.

**Per-layout data (P0):** boost pads (2 to 4), item rows (2 to 3), sectors (auto), AI `trackSpeed`, Time Attack medal times (= AI best lap at skill 1 × 1.10 / 1.05 / 1.01 in L1; tighter in later leagues, see 15.3), FTUE prop cluster on the t1 racing line at 150 to 200 m.

**Fallback:** if Harbor Run or Scrapyard is not ready, `CONFIG.career.layoutFallback` maps t4 → t2r, t4r → t1r, t5 → t3r, t5r → t2 so the career never blocks.

---

## 15. Career (P0)

### 15.1 Structure
- **5 leagues × (6 events + 1 boss) = 35 events, 105 stars.**
- **Stars are independent and best-ever:** ★1 base goal (top 3 or bronze), ★2 win or silver, ★3 the event challenge or gold. A weaker driver can still earn ★3 by smashing.
- **Boss** of a league opens at 12★ in L1 to L2, 13★ in L3 to L4 and 14★ in L5 (out of the 18 from that league's six events).
- **Next league** opens when the boss is beaten **and** the cumulative star count is reached: L2 14★, L3 32★, L4 52★, L5 72★.
- Quick Race layouts unlock with the league that introduces them (reverse together with forward).
- New-star bonus: 100 coins × league multiplier per star (one time).

### 15.2 League tiers

| League EN / RU | Layouts introduced | Recommended PR | AI skill | Bruisers | Max attackers on player | Prize multiplier | Boss → reward |
|---|---|---|---|---|---|---|---|
| L1 Rookie Cup / Кубок новичка | t1, t2 (+r) | 100 to 108 | 0.55 to 0.85 (E1: 0.45 to 0.65) | 1 | 0 (E1), 1 | ×1.0 | Big Mo (Brawler) → **Brawler** |
| L2 Street Brawl / Уличная драка | t3 (+r) | 110 to 120 | 0.65 to 0.90 | 2 | 1 | ×1.5 | Sleet (Glint) → **Glint** |
| L3 Harbor Heat / Жара в порту | t4 (+r) | 120 to 130 | 0.75 to 0.95 | 2 | 1 | ×2.1 | Grinder (Mammoth) → **Mammoth** |
| L4 Scrap Kings / Короли свалки | t5 (+r) | 130 to 140 | 0.82 to 1.00 | 2 | 2 | ×2.8 | Ace (Needle) → **Needle** |
| L5 Legends / Легенды | all | 140 to 150 | 0.90 to 1.00 | 3 | 2 | ×3.6 | Duchess, Grand Final → **Champion gold livery** (all cars), title "Legend", 15,000 coins |

The AI field PR spreads across rank t = 0 to 1 as target × lerp(0.94, 1.04, t); E1 uses 0.88 to 0.96. Within a league, event k (0 to 5) targets lo + (hi − lo) × k / 6; the boss targets hi + 2.

### 15.3 The 35 events
Score modes: Time Attack medal factors L1 1.10/1.05/1.01, L2 1.09/1.04/1.00, L3 1.08/1.03/0.995, L4 1.07/1.025/0.99, L5 1.06/1.02/0.985 × the AI best lap. Score thresholds are calibrated by the headless bots (PLAN WP13) and live in `CONFIG.career`.

| Id | Layout | Mode / modifier | Laps | ★1 | ★2 | ★3 | Teaches |
|---|---|---|---|---|---|---|---|
| L1-1 | t1 | Race (**First race**, FTUE) | 2 | top 3 | win | break 15 objects | controls, smashing pays |
| L1-2 | t1 | Rampage | 90 s | 1,500 | 2,500 | 3,500 | destruction = score |
| L1-3 | t1r | Sprint | 2 | top 3 | win | finish with ≥ 60% health | care, repair |
| L1-4 | t2 | Race | 3 | top 3 | win | use 3 power-ups | items, pads |
| L1-5 | t1 | Time Attack | 3 | bronze | silver | gold | ghost, racing line |
| L1-6 | t2r | Race / Glass Cannon | 3 | top 3 | win | 1 takedown | ramming |
| L1-B | t2 | Boss Duel vs Big Mo (Brawler) | 3 | win | win by 2 s | win without repairs | → Brawler |
| L2-1 | t3 | Race | 3 | top 3 | win | 3,000 drift points | drift pays |
| L2-2 | t2 | Knockout | — | top 3 | win | 2 takedowns | survival |
| L2-3 | t1 | Drift Trial | 2 | 3,000 | 5,000 | 7,000 | chains |
| L2-4 | t3r | Sprint / Power-up Frenzy | 2 | top 3 | win | use 4 power-ups | item tactics |
| L2-5 | t2 | Rampage | 90 s | 2,500 | 4,000 | 5,500 | combos |
| L2-6 | t1r | Race / No Repairs | 3 | top 3 | win | 3 takedowns | risk |
| L2-B | t3r | Boss Duel vs Sleet (Glint) | 3 | win | win by 2 s | 2,000 drift points in the duel | → Glint |
| L3-1 | t4 | Race | 3 | top 3 | win | break 25 objects | new theme |
| L3-2 | t4 | Time Attack | 3 | bronze | silver | gold | 90° corner rhythm |
| L3-3 | t3 | Knockout / Glass Cannon | — | top 3 | win | finish with ≥ 50% health | |
| L3-4 | t4r | Drift Trial | 2 | 4,000 | 6,500 | 9,000 | |
| L3-5 | t2r | Race / Heavy Metal | 3 | top 3 | win | 3 takedowns | heavy rivals |
| L3-6 | t4 | Rampage / Power-up Frenzy | 90 s | 3,500 | 5,500 | 7,500 | |
| L3-B | t4r | Boss Duel vs Grinder (Mammoth) | 3 | win | win by 2 s | take Grinder down once | → Mammoth |
| L4-1 | t5 | Race | 3 | top 3 | win | break 40 objects | junkyard |
| L4-2 | t5 | Rampage | 90 s | 4,500 | 7,000 | 9,500 | |
| L4-3 | t3r | Time Attack | 3 | bronze | silver | gold | |
| L4-4 | t5r | Knockout | — | top 3 | win | 4 takedowns | |
| L4-5 | t4r | Race / One-Make | 4 | top 3 | win | win without repairs | pure skill |
| L4-6 | t1 | Drift Trial | 2 | 5,000 | 8,000 | 11,000 | |
| L4-B | t5 | Boss Duel vs Ace (Needle) | 3 | win | win by 2 s | finish with ≥ 50% health | → Needle |
| L5-1 | t2r | Race | 5 | top 3 | win | lead at the end of lap 1 | |
| L5-2 | t4 | Knockout / Glass Cannon | — | top 3 | win | 5 takedowns | |
| L5-3 | t5r | Rampage / Heavy Metal traffic | 90 s | 5,500 | 8,500 | 11,500 | |
| L5-4 | t3 | Drift Trial | 2 | 6,000 | 9,000 | 12,000 | |
| L5-5 | t1r | Time Attack | 3 | bronze | silver | gold | |
| L5-6 | t4r | Race / Underdog | 3 | top 3 | win | gain 7 places | comeback |
| L5-B | t5r | Grand Final vs Duchess (gold Scorcher) + elite field | 5 | win | win by 3 s | win without repairs | → Champion livery |

P1: "Legend Remix" replays all 35 events at AI +8% for a 4th platinum star (cosmetic rewards).

### 15.4 Quick Race (P0, unlocks after race 1)
Any unlocked layout and direction, any mode except Boss, laps 1 to 5, rivals 3 / 5 / 7, difficulty Easy / Normal / Hard (AI PR = player PR × 0.92 / 1.0 / 1.06, skill −0.1 / 0 / +0.05), rival cars (section 11), power-ups on/off. Any of the 10 cars. No stars; coins section 16; XP ×0.7.

### 15.5 Daily Challenge (P0, driver level 4)
Seeded by the local date (`YYYY-MM-DD` → mulberry32): layout × mode (Race, Rampage, Knockout, Time Attack, Drift Trial) × one modifier × **forced car (often locked: a free test drive)** at showroom tune. Unlimited attempts, best result counts. Reward on completion 600 × league multiplier, +400 × multiplier for the gold-equivalent goal. A 7-day challenge streak multiplier ×1.0 to ×1.6 (no reset on a missed day, it just stops growing).

---

## 16. Economy (P0)

One currency: **coins**. Every number below goes into `CONFIG.economy` / `CONFIG.upgrades` / `CONFIG.garage` / `CONFIG.progression`.

### 16.1 Income

```
PRIZE        = [500, 380, 300, 230, 170, 130, 100, 80]          // place 1..8
LEAGUE_MUL   = [1.0, 1.5, 2.1, 2.8, 3.6]                         // L1..L5
prize        = PRIZE[place] × LEAGUE_MUL × modeMul × (laps / 3 for Race)
modeMul      = Race/Knockout 1.0 · Sprint 0.7 · Underdog ×1.5
               Time Attack / Rampage / Drift: gold = PRIZE[1st], silver = [2nd], bronze = [3rd], none = [6th]
               Boss: win = 2 × PRIZE[1st], loss = PRIZE[8th]
smashCoins   = (min(S, 1500)/10 + max(0, S − 1500)/20) × LEAGUE_MUL      // S = smash points incl. takedowns
driftCoins   = min(D / 40, 150) × LEAGUE_MUL                              // D = drift points
starBonus    = 100 × LEAGUE_MUL per NEW star
firstRace    = +700 once ("First race bonus")
Quick Race   = (prize + smash + drift) × {Easy 0.5, Normal 0.7, Hard 0.9} × LEAGUE_MUL[highest open]
Daily Chall. = 600 × LEAGUE_MUL[highest open] (+400 × mul for gold)
rewarded ×2  = doubles prize + smash + drift (not star bonus, not first-race bonus)
```

Repair cost = max(20, missingHp × 0.9 × LEAGUE_MUL^0.6) × car `repairCostMul`, **capped at 40% of the current event's first prize**.

Typical race (L1, average player, 3rd place, about 700 smash points, 2,000 drift points, 1.5 new stars on a first play): 300 + 70 + 50 + 150 ≈ **570 coins** (about 420 on a replay).

### 16.2 Sinks

| Sink | Amount |
|---|---|
| Upgrades per car (tier 1 / 2 / 3) | 26,550 / 42,480 / 63,720 (all 10 cars maxed: about 424k) |
| Cars | other starter 2,000 · Sandhopper 3,000 · Bruiser 9,000 · Scorcher 20,000 (34k) |
| Repairs | about 5 to 8% of income |
| Cosmetics (P1) | about 35k |

### 16.3 Driver XP and level (P0)
- XP per race = 100 + 20 × (8 − place) + S/20 + D/50 + 60 × new stars (about 250 to 400). Quick Race ×0.7.
- XP to next level = 250 + 150 × (L − 1). Cap 50.
- Level-up reward: 100 × L coins (cap 2,000); every 5th level a paint.

| Level | Unlocks (progressive disclosure) |
|---|---|
| 1 | Career L1 only; first launch drops straight into race 1 |
| 2 (after race 1) | Garage car browser, Quick Race, Rivals sheet |
| 3 | Daily tasks, daily login calendar |
| 4 | Daily Challenge |
| 6 | Weekly Smash Cup (P1) |
| 8 | Weekly tasks (P1) |

### 16.4 Curve: first 2 hours (reference player, average skill, no ads)
Measured with a pacing script (per-car upgrades, gates and tables above; the P0 pacing test in PLAN WP7 must keep these within the ranges).

| Time | Race # | Milestone | Coins earned (cumulative, incl. 300 start) | Typical spend | Lv | Cars |
|---|---|---|---|---|---|---|
| 0:02 | 1 | First race won; **choose 2nd car** (Gravel or Brick); guided Engine L1 | 1,600 | Engine L1 (300) | 2 | 2 |
| 0:07 | 3 | Rampage, Sprint; daily tasks appear | 3,300 | Grip L1, Armor L1 | 3 to 4 | 2 |
| 0:12 | 5 | other starter buyable (3★) | 5,000 | 2,000 car **or** Engine L2 to L3 | 5 | 3 |
| 0:20 | 8 to 9 | L1 events done, boss attempts | 7,500 | upgrades | 6 | 3 |
| 0:25 | 10 to 12 | **Beat Big Mo → Brawler**; L2 opens | 9,500 | | 6 to 7 | 4 |
| 0:30 | 13 | Sandhopper (6★ + 3,000) | 13,000 | 3,000 | 8 | 5 |
| 0:45 | 19 to 20 | **Beat Sleet → Glint** | 23,000 | Brawler / Glint upgrades | 10 | 6 |
| 1:00 | 24 to 26 | **L3 opens: Harbor Run** | 32,000 | | 11 | 6 |
| 1:20 | 33 to 35 | **Beat Grinder → Mammoth** | 43,000 | | 13 | 7 |
| 1:50 | 45 to 48 | **L4 opens: Scrapyard**; Bruiser (9,000) | 60,000 | 9,000 | 14 | 8 |
| 2:00 | 50 to 52 | mid L4 | 68,000 | tier 2/3 upgrades | 15 | 8 |

New car cadence: minute 2, about 12, 25, 30, 45, 80, 110; Needle (L4 boss) at about 3 h; Scorcher (20,000, 45★) at about 3.3 h.

Pacing test targets (60 seeds): L2 opens by race 9 to 14, L3 by 20 to 32, L4 by 38 to 55, L5 by 65 to 95; career complete in 110 to 190 races (median about 5 h); at most 4 races without an affordable goal (car, upgrade or claimable reward) in the first 60 races.

### 16.5 First week (typical web player)
Sessions: D0 25 min, D1 15, D2 12, D4 15, D5 12, D7 15 (about 1 h 50 total).

| Day | What happens |
|---|---|
| D0 | First win, 2nd car, L1 boss beaten → Brawler (4 cars), driver level 7 |
| D1 | Login day 2 (500); first full daily task set (+400); L2 half done; Sandhopper |
| D2 | Login day 3 (700 + paint "Lime Fizz"); L2 boss → Glint |
| D4 | Login day 4; L3 opens, Harbor Run (the "new world" moment) |
| D5 | Login day 5 (1,200); Daily Challenge streak ×1.4 |
| D7 | Login day 7 (2,500 + paint "Lightning"); L3 boss attempts → Mammoth |

Heavy player (about 5 h in week 1): L5 open, 9 cars, a tier 3 car near max.

### 16.6 Long arc
Career about 110 to 190 races (median about 5 h). 100% (all stars, all cars owned and maxed) about 25 to 30 h. Sources over 30 days ≈ 180k races + 45k daily + 40k achievements + 30k levels ≈ 295k against ≈ 460k of sinks (upgrades + cars) + 35k cosmetics (P1): the collector always has something to buy. Rewarded ×2 (30 to 40% of players) shortens this by about 25%.

---

## 17. Daily rewards, tasks, achievements

### 17.1 Login calendar (P0)
Own implementation in Bridge storage (works on every platform): keyed by local date `YYYY-MM-DD`, ignores a clock moved back by more than 1 h (`maxClock`), **missing a day never resets the streak** (D7). Popup at boot from session 2 (driver level 3 or more) with [Claim] and [AD · Claim ×2].

| Day | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| Reward | 300 | 500 | 700 + paint "Lime Fizz" | 900 | 1,200 | 1,500 | 2,500 + paint "Lightning" |

Cycle 2+: coins × (1 + 0.25 × (highest league − 1)); a new paint from the pool on days 3 and 7 of each cycle.

### 17.2 Daily tasks (P0, driver level 3)
3 per day, generated deterministically from the local date seed; only tasks the player can do with current unlocks (no "win a Rampage" before Rampage exists). Reward × (1 + 0.5 × (highest league − 1)). **All 3 done: +400 × scale coins + 300 XP.** P1: one free reroll per day via rewarded ad.

| id | Task EN | Base reward |
|---|---|---|
| win1 | Win a race | 250 |
| podium3 | Finish in the top 3 three times | 300 |
| smash60 | Break 60 objects | 200 |
| takedown3 | Make 3 takedowns | 300 |
| drift3k | Score 3,000 drift points | 250 |
| items6 | Use 6 power-ups | 200 |
| nitro5 | Use Nitro 5 times | 150 |
| stars2 | Earn 2 stars | 300 |
| rampage2k | Score 2,000 in a Rampage | 250 |
| bestlap | Beat your best lap on any track | 250 |
| lowhp | Finish a race with less than 25% health | 250 |
| walls10 | Smash 10 wall segments | 200 |
| road5 | Tear up 5 road chunks | 200 |
| km5 | Drive 5 km | 150 |
| reverseWin | Win on a Reverse track | 300 |
| parts5 | Knock 5 parts off rivals | 200 |
| carX | Race with {car} | 200 |
| newCar | Finish a race with a car you did not use last time | 200 |
| sameRivals | Race with "Same as mine" rivals | 150 (teaches the owner's feature) |
| repair1 | Repair your car once | 150 (teaches repair) |

### 17.3 Achievements (P0: 20; P1: +4)
Own implementation (counters in the save); mirrored to Bridge achievements if supported (P1). Each pays coins once.

| id | Name EN | Condition | Coins | P |
|---|---|---|---|---|
| firstFinish | First Finish | finish a race | 200 | P0 |
| podium | Podium | first top 3 | 300 | P0 |
| firstWin | Winner | first win | 500 | P0 |
| boss1 | Rookie Champion | beat Big Mo | 1,000 | P0 |
| boss2 | Street Boss | beat Sleet | 2,000 | P0 |
| boss3 | Harbor Master | beat Grinder | 4,000 | P0 |
| boss4 | Scrap King | beat Ace | 7,000 | P0 |
| legend | Legend | win the Grand Final | 15,000 | P0 |
| wrecking | Wrecking Ball | break 1,000 objects in total | 1,500 | P0 |
| demolition | Demolition Expert | break 10,000 objects in total | 5,000 | P0 |
| roadRipper | Road Ripper | tear 100 road chunks | 1,000 | P0 |
| takedown25 | Takedown Artist | 25 takedowns | 1,000 | P0 |
| takedown250 | Takedown Legend | 250 takedowns | 5,000 | P0 |
| collector | Collector | own 5 cars | 2,000 | P0 |
| fullGarage | Full Garage | own all 10 cars | 10,000 | P0 |
| maxed | Maxed Out | one car at level 5 in every branch | 3,000 | P0 |
| stars50 | Star Hunter | 50 stars | 3,000 | P0 |
| stars105 | Superstar | all 105 stars | 15,000 | P0 |
| driftKing | Drift King | 10,000 drift points in one race | 2,000 | P0 |
| untouchable | Untouchable | win with ≥ 95% health | 800 | P0 |
| comeback | Comeback | win after being last at the end of lap 1 | 1,500 | P1 |
| mirror | Mirror Match | win with "Same as mine" rivals | 500 | P1 |
| loyal | Loyal Racer | claim 7 login days | 1,000 | P1 |
| phoenix | Phoenix | win after being wrecked in the same race | 1,000 | P1 |

---

## 18. Ads and monetisation

### 18.1 Rewarded (opt-in; the button says it is an ad and shows the exact reward; reward only on the Bridge `rewarded` state)

| # | Placement | Reward | Cap | P |
|---|---|---|---|---|
| R1 | Results | ×2 race coins ("AD · +1,240") | once per race | P0 (exists, moves under the total) |
| R2 | Login popup | ×2 day coins | 1 per day | P0 |
| R3 | Pause (health < 70%) | free full repair | 1 per race | P0 |
| R4 | Career event card, locked car | test drive (after the free one) | 3 per day | P0 |
| R5 | Event card after a failed attempt | start with Nitro in the slot | 1 per attempt | P0 |
| R6 | Daily tasks | reroll one task | 1 per day | P1 |
| R7 | Garage, short of coins (shortfall ≤ 40% of price) | min(shortfall, 25% of price) | 3 per day | P1 |
| R8 | Weekly cup | extra loaner upgrade | 1 per day | P1 |

At most one ad offer per screen. Everything is reachable without ads. If an ad fails: a toast, the button stays, nothing is lost.

### 18.2 Interstitials
- Natural pauses we mark: Results → NEXT / RETRY / GARAGE / menu (each calls `showInterstitial()` before acting, behind a 0.3 s "Loading race…" curtain), and Quit / Restart from Pause (exists). Never mid-race, never on menu-to-menu navigation, never over a reward reveal (the request happens when the player leaves Results).
- Timing belongs to the Bridge: `public/playgama-bridge-config.json` `initialInterstitialDelay 180`, `minimumDelayBetweenInterstitial 180` (D6). Race 1 therefore stays ad-free without any game-side counter.
- Expected: about 4 to 5 interstitials and 3 to 5 rewarded views per 15-minute session.

### 18.3 IAP-ready, not built (P2)
`src/meta/shop.ts` + a payments wrapper, hidden unless `payments` is supported and a catalog exists. Prices always from `getCatalog()`; consume unprocessed purchases at boot; restore permanents every launch. Catalog idea: Remove interstitials (permanent), Starter pack (offered after the L1 boss: Sandhopper + 5,000 + exclusive paint), coin packs. No random boxes.

---

## 19. FTUE script (P0)

Principle: on first launch **no menu, no modal, no reading**. On the grid within 5 s. Each skill is taught at the moment it is needed, by a prompt of at most 4 words plus an icon, only while the player is not doing it yet. At most one prompt on screen, at least 20 s between prompts, each prompt at most twice (`src/ui/tips.ts`). A small "Skip" chip (top-left) ends the FTUE for returning players on a new device.

| t | Beat | Player sees and does | Teaches |
|---|---|---|---|
| 0 to 3 s | Boot | loading bar with a car silhouette; Bridge init; one save load | |
| 3 to 5 s | Grid | 1.2 s camera sweep onto the player car on the grid (event L1-1, t1, 2 laps). Pulsing GAS with a ghost thumb and "HOLD" (touch) or big key caps "W / ↑" (PC) | |
| about 5 s | First touch | GAS unlocks audio **and** starts a compressed countdown (0.5 s per light) with the car already throttled | gas |
| 5 to 12 s | Straight | "SLIDE TO STEER" (← thumb →) when the first bend is < 60 m away and the player has not steered; steering arc visible | steer |
| 8 s | Overtakes | player starts 5th of 8 against a weak field (skill 0.45 to 0.65, PR ×0.88 to 0.96, mistakes ×1.5); "+1 POS" pops with a whoosh | position = goal |
| 12 to 20 s | Smash | crate and barrel cluster on the racing line: "SMASH!" and "+points" pops flying into the race counter | smashing pays |
| 20 to 30 s | Boost pad | arrow decal on the first pad: "BOOST!" on contact | pads |
| 30 to 40 s | Item | first box = Nitro; the slot pops in; "FLICK ↑ TO USE" (ghost thumb flicks up) or key cap "E"; pulses once more after 4 s unused | items |
| 40 to 55 s | Drift | lap 2 hairpin: the arc's DRIFT zone glows, "STEER HARD TO DRIFT" (touch) or "HOLD SPACE TO DRIFT" (PC); then "EASE OFF TO BOOST"; drift meter and mini-boost | drift |
| 55 to 70 s | Final lap and win | "FINAL LAP" banner; AI ahead eases off off-screen (FTUE ease ×2); player crosses 1st; 0.4 s slow motion, confetti, camera pull-out | winning feels great |
| 70 to 85 s | Results | the full sequence with "First race bonus +700"; no ad button and no interstitial on this screen | reward |
| 85 to 95 s | **Choose your 2nd car** | reveal card with two cars side by side: Gravel ("Born sideways") and Brick ("Slow. Unstoppable. Rude."); tap one = owned | choice ownership |
| 95 to 110 s | Guided garage | one highlighted button "UPGRADE YOUR CAR"; hand pointer on Engine level 1 (300); the car revs and the bar fills; CTA **RACE AGAIN** → L1-2 Rampage | upgrades |

Failure safety: if the player is not in the top 3 at the start of lap 2, the off-screen ease strengthens further. If they still lose, Results celebrates "Finished!" with the full bonus and the next attempt keeps the easy settings. Never a grey "7th" on race 1.

Contextual tips after the FTUE (each once): first health < 40% → silhouette pulses "TAP TO FIX" / "R"; first wreck → "Repair Kits and repairs fix your car"; race 3 → "Tap GAS on GO for a perfect start"; first Knockout → "Last car is out every 15 s"; first takedown chance (alongside a rival near a wall) → "Ram rivals into walls!"; first time a style meter fills → "SMASH NITRO READY: flick up".

`SaveData.ftueStep` (0 to 6, 6 = done; migration: `tutorialDone === true` → 6) and `tipsSeen` (bitmask).

---

## 20. Screens and flow (P0)

### 20.1 Screen map

```
Boot ─► (first launch) FTUE race L1-1 ─► Results ─► Choose 2nd car ─► Guided garage ─► L1-2 …
     └► (returning) Login popup (if claimable) ─► HUB
HUB
 ├─ [RACE ▶] next recommended event (1 tap) ─► grid splash ─► Race ─► Results
 │        Results ─┬─ [NEXT ▶] ─► interstitial? ─► next event
 │                 ├─ [RETRY]  ─► interstitial? ─► same event (fail assist applies)
 │                 └─ [GARAGE] ─► interstitial? ─► Garage ─► [RACE ▶]
 ├─ Event card chips: [Car ▾] [Rivals ▾]   (bottom sheets, no new screen)
 ├─ CAREER  (league tabs ─► event cards ─► tap = set as next event, RACE)
 ├─ GARAGE  (Cars / Upgrade / Paint tabs, RACE ▶ always present)
 ├─ QUICK RACE (layout, mode, laps, rivals, difficulty, car)
 ├─ TODAY   (login calendar, daily tasks, Daily Challenge)
 ├─ TROPHIES (achievements, stats)
 └─ ⚙ SETTINGS
```

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
| Top bar | 0 to 64 | level badge + XP bar (left); coin chip, ⚙ 44 px (right) |
| Hero | 64 to 420 | the existing 3D menu scene with the **selected car**; name + class tag ("GLINT · Speedster") |
| Next goal strip | 420 to 470 | one line, always present (20.8) with a progress bar |
| Event card | 470 to 640 | layout thumbnail (existing SVG), league · event, mode icon, laps, "up to 1,140" coins, 3 stars with goals, PR recommended vs yours (colour-coded); chips [Car ▾] [Rivals: Mixed ▾]; R5 offer after a failed attempt |
| CTA | 650 to 740 | **RACE ▶** full width, 88 px tall, orange, glow pulse after 6 s idle |
| Bottom nav | 760 to 844 | Career · Garage · Quick Race · Today · Trophies; 56 px; red dots on claimables |

Landscape 844×390: hero car fills the left 55%; the right column holds goal strip, event card, chips and RACE; the bottom nav becomes a vertical rail at the far left. PC: Enter = RACE.

### 20.4 Garage (P0)

```
┌ ◄  GARAGE                       ● 1,830 ┐
│ [ CARS ] [ UPGRADE ] [ PAINT ]           │  segmented tabs, 44 px
│      ◄   (3D car on a turntable)   ►     │  swipe (40 px or 0.4 px/ms), ◄ ► 48 px, ←/→ keys
│   ● ● ◉ ● ● ▣ ▣ ▣ ▣ ▣  (10 dots, lock glyph SVG)
│   GLINT                 [SPEEDSTER]      │  name + class badge (icon + text, colour-blind safe)
│   "Fast and fragile"                     │  line
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
│ locked: [ UNLOCK ● 9,000 · 24★ ] [ TEST DRIVE ]  (reason + progress always visible)
│              [ RACE ▶ ]                  │
└──────────────────────────────────────────┘
```

- Locked cars are always visible as dark silhouettes with a rim light and the exact requirement ("Beat Sleet in Street Brawl", "● 9,000 · 24★ (you have 17★)").
- Upgrade tab: 3 rows per car with 5 pips, concrete effects, cost button with a disabled reason ("Need 340 more"); PR before → after.
- Paint tab: 8 swatches per car (P0); decals and rims (P1).
- Red dot on Garage when an upgrade for the selected car is affordable, a car is unlockable, or something new is unviewed.
- Landscape: car left, tabs and content right; no page scroll.

### 20.5 Rivals sheet (P0)
Bottom sheet with the 4 options (section 11) as large radio cards, the model grid for One model, and the line "Rival strength is set by the event, so every choice is fair." Choice persists.

### 20.6 HUD (P0)

Portrait 390×844:

| Element | Position | Content and behaviour |
|---|---|---|
| Position | top-left, 96×64 | "3/8", number 40 px tinted gold/silver/bronze; "+1 POS" pop and a 1.25 → 1 punch on gain; red flash on loss (no sound) |
| Lap | under Position | "LAP 2/3" + thin lap progress bar; lap banner "LAP 2/3 · 0:27.41 (−0.42)" for 1.4 s; gold "BEST LAP!" flash |
| Timer | top-centre, 20 px | race time; mode timers (Rampage time left, Knockout "Elimination in 8 s") replace it |
| Pause | top-right, 48 px | |
| Minimap | top-right under Pause, 88×88, 70% opacity | north-up outline; player 8 px dot with a white ring, rivals 5 px in their colours, leader crown; pointer-events none (P0) |
| Race coins | under the minimap | "● +48" (this race), replaces the wallet; pops fly into it |
| Damage | left edge, y ≈ 190, 44×80 | 9-zone silhouette + health bar + %; hue ramp **plus crack hatching** below 50% (colour-safe); white flash on hit |
| FIX chip | right of the silhouette, only below 70% health | affordable: yellow "FIX ● 120"; not affordable: grey with lock + toast "Need 267 more"; AD free repair lives in Pause |
| Item slot | above GAS, 64 px circle | item icon; "flick ↑" glyph for the first 3 uses; style ring around GAS; hidden when empty |
| GAS | bottom-right (bottom-left in left-handed) | exists, plus the steering arc |
| 2nd-finger button | bottom-left, 66 px | BRAKE / DRIFT / off (setting) |
| Speed + boost | bottom-centre, 132×56 | speed 28 px; 3/4 arc for the active boost; "SLIPSTREAM" chip |
| Drift meter | world-space above the car | "DRIFT 420 ×2", colour by tier |
| Smash pops | world-space at the break | "+40", "SMASH ×4", "TAKEDOWN! Blaze" banner |
| Wrong way | centre, 30% from top | red arrow + "WRONG WAY"; "Tap to go back" after 5 s |
| Missed checkpoint | centre | "MISSED CHECKPOINT" + arrow back |
| Wreck card | centre | "WRECKED · back in 1.8 s" |
| Toasts | top-centre | max 2 (exists) |

- Landscape 844×390: Position + Lap in one row top-left; minimap left of Pause; damage silhouette at left-middle; item slot **left of** GAS; speed bottom-centre.
- PC 1280×720: as landscape; key hints ("R" on FIX, "E" on the item slot, "Space" on the drift meter) for the first 3 races only.
- Nothing may sit in the centre 50% × 60% box (car and road ahead). All pops share one pooled DOM layer (max 8 alive, transform and opacity only); Reduce motion removes scaling.

### 20.7 Results sequence (P0)
Any tap skips to the end state.

| t (ms) | Beat |
|---|---|
| 0 | during `resultsDelay` (2.5 s, exists): finish slow motion, orbit, confetti for the podium |
| 0 to 600 | card slides up; medal drops in ("1st!" or "4th · 0.6 s to the podium") |
| 600 to 1,800 | coin breakdown, one row every 250 ms with ticks: Place prize · Smash (n objects, k takedowns) · Drift · New stars · First race bonus; **Total** counts up |
| 1,800 to 2,400 | the event's stars light up one by one (new star bursts) |
| 2,400 to 3,200 | XP bar fills; level-up flash and its reward card |
| 3,200 | unlock reveal cards (car, league, track, feature), one shared component |
| 3,200+ | next-goal line; buttons stagger in (80 ms) |

Buttons (portrait, thumb-friendly, bottom-up): **NEXT ▶** (72 px, orange; becomes RETRY when the player finished below 3rd and earned no star) · row [RETRY ↻] [GARAGE] (red dot if affordable) · [AD · +N coins] above NEXT, secondary styling, exact N. Collapsible finish order: place, driver · car, gap (top 3 always visible). "Tomorrow" previews at the bottom: calendar reward, tasks timer.

### 20.8 Next-goal resolver (P0, `meta/goals.ts`, pure)
One line, priority order: claimable reward > affordable upgrade for the selected car > car unlock within reach (≤ 3★ or ≤ 25% coins) > stars to the boss > boss to the next league > daily tasks progress > best-lap improvement. Examples: "2★ to unlock Sandhopper", "You can afford Engine level 3", "1★ to face Big Mo", "Beat Sleet to open Harbor Heat".

### 20.9 Pause (P0)
Resume (big), Repair (coins) or **AD · Free repair** (once per race), Restart and Quit (two-tap confirm, interstitial on leave), quick toggles row (Sound, Music, Camera Follow/Fixed, Left-handed), the event's star goals with live progress (P1), a small control pictogram (P1).

### 20.10 Settings (P0 unless marked)

| Section | Setting | Values (default) |
|---|---|---|
| Controls | Camera | **Follow** / Fixed |
| | Drift assist | **On** (touch), Off (PC) |
| | Steering sensitivity | 70 to 140% (100%) |
| | Left-handed | Off |
| | 2nd-finger button | **Brake** / Drift / Off |
| | Auto gas | Off (exists) |
| | Vibration | **On**; hidden when `navigator.vibrate` is missing |
| | Control hints | **On** |
| Sound | Music volume, Effects volume | sliders 0 to 100 (32 / 90) |
| Graphics | Quality | Auto / Low / Medium / High (exists) |
| | Screen shake | **Full** / Reduced / Off |
| Accessibility | Reduce motion | Off |
| | Reduce flashes | Off (P1) |
| | Colour-safe damage | **On** |
| | Text size | 100 / 115 / 130% (P1) |
| Language | English / Русский / Auto | exists |
| Other | Replay tutorial | (P1) |

No "Reset progress" button.

### 20.11 Unlock reveal (P0, one component)
Dim → card flips with a CSS light burst → name + one line of what it does → [Use now] [Later]. Used for cars, leagues, layouts, paints and features.

---

## 21. Juice list (P0 unless marked)

Presentation slow motion = the game loop's time scale (`src/fx/slowmo.ts` controller, applied in `game.ts`). Sim time stays authoritative, so lap times and ghosts are unaffected. Audio rate ×0.7 and a 900 Hz low-pass during slow motion. Never in the 3 s before the player finishes (except photo finish, P1). Cooldown 8 s.

| Event (player involved) | Hit-stop (fx) | Slow motion | Shake | Particles | Sound | Haptic | HUD |
|---|---|---|---|---|---|---|---|
| Light impact (< 0.3) | — | — | 0.9·s | sparks 6 | impact_light | 15 ms | — |
| Heavy impact (≥ 0.6) | 0.1 s at 0.2 (exists) | — | 0.9·s + kick | spark fan, dust | impact_heavy + crunch | 40 ms | — |
| Wall smashed through | 0.08 s | — | 0.25 | chunks 3, dust 8 | crunch + debris | 30 ms | +40 |
| Part flies off | — | — | 0.1 | part debris (2.4 s) | part_off | 20 ms | — |
| Takedown | 0.12 s | 0.3× for 0.4 s | 0.5 | 30 sparks + ring | takedown_stinger | 60 ms | banner |
| Player wrecked | — | 0.35× for 0.5 s | 0.6 | smoke burst + parts | wrecked_stinger | 90 ms | WRECKED card |
| Rival eliminated (Knockout) | — | — | 0.3 (if on screen) | explosion + parts | explosion | — | "Blaze is out!" |
| Drift tier up | — | — | — | colour burst at rear wheels | drift_tier1/2/3 (pitch 1 / 1.12 / 1.26) | 10 ms | tier ring |
| Drift boost exit | — | — | 0.08 | exhaust flame 0.3 s, speed lines | boost_whoosh | 20 ms | +points |
| Boost pad / Nitro | — | — | 0.1 | streaks, flame | pad_zap / nitro_loop | 20 ms | arc |
| Slipstream | — | — | — | wind streaks | slipstream_wind (loop) | — | chip |
| Perfect start | — | — | 0.15 | tyre smoke burst | perfect_start | 30 ms | PERFECT START |
| Item pickup / ready | — | — | — | box shatter | pickup / item_roulette / item_ready | 10 ms | slot pop |
| Shield up / hit | — | — | — / 0.3 | bubble | shield_up / shield_hit | 25 ms | — |
| Shockwave (own / hit by) | 0.06 s | — | 0.3 / 0.5 | 9 m ground ring | shockwave_blast | 50 ms | — |
| Repair (coins / kit / ad) | — | — | — | sparkle + wrench | repair_ratchet | 20 ms | health bar fill |
| Position gained | — | — | — | — | pos_up | — | +1 POS |
| Final lap | — | — | — | — | final_lap | — | banner |
| Wrong way | — | — | — | — | wrong_way | — | arrow |
| Finish | — | 0.5 s at 0.5 | — | confetti (podium) | finish | 40 ms | — |
| Near miss (P1) | — | — | — | wind streak | near_miss (panned) | — | +20 |
| Photo finish (P1) | — | 0.25× for 0.6 s | — | — | — | — | — |

UI juice: coin count-up ticks, medal bounce, star burst, XP bar fill, level-up flash, card flip, button press scale 0.96, red-dot pulse. Particle budget: drift sparks use the existing "essential" spark pool (visible on low quality), max 40 per car per second, only for cars inside `emitRange`.

---

## 22. Audio list (P0)

**Release blocker:** every file must be recorded or CC0 (Playgama 3.3.2 rejects code-synthesized sound) and background music is mandatory (3.3.1). Placeholders are generated by `scripts/make-sfx.sh` and listed as MUST-REPLACE in `docs/AUDIO.md`. Folder budget ≤ 2.5 MB (ogg + mp3).

Existing (13): engine (loop), skid (loop), music (loop), impact_light, impact_heavy, crunch, debris, click, buy, error, countdown, go, finish.

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
| takedown_stinger | one-shot | takedown by the player | crunch + short brass stab |
| wrecked_stinger | one-shot | player wrecked | heavy crash + down sweep |
| explosion | one-shot | Knockout elimination (P1: fuel barrels) | cartoon explosion |
| part_off | one-shot | part detached | metal clang |
| slipstream_wind | loop | in slipstream | wind rush |
| perfect_start | one-shot | perfect start | tyre chirp + rev |
| pos_up | one-shot | position gained | rising blip |
| final_lap | one-shot | final lap | bell |
| wrong_way | one-shot | wrong way | warning buzz |
| elim_warning | one-shot | Knockout last 3 s before an elimination | ticking |
| coin_tick | one-shot | results count-up | coin tick |
| star | one-shot | star lit | sparkle |
| level_up | one-shot | level up, unlock reveal | fanfare (short) |
| claim | one-shot | reward claimed | cash chime |
| near_miss | one-shot | near miss (P1) | whoosh, panned |

Behaviour: separate music and effects gains (settings); slow motion rate ×0.7 + low-pass; music switches to a high-intensity stem on the final lap (P1); new cues obey the existing rate limits (`impactMinInterval` style).

---

## 23. Save data v2 (P0)

Two Bridge storage keys as today (`sc_core`, `sc_ghosts`). Core ≤ 12 KB with everything filled. Writes only at race end, purchases, claims and settings changes (the existing serialised `writeSave` queue).

```ts
interface SaveDataV2 {
  version: 2;
  money: number; xp: number;
  cars: Partial<Record<CarModelId, { up: Record<UpgradeBranch, number>; paint: number; testDriven: boolean }>>; // present = owned
  selectedCar: CarModelId;
  career: Record<string /*eventId*/, { stars: number /*bitmask 1|2|4*/; best: number; fails: number }>;
  bosses: string[];
  rivals: { mode: 'mixed' | 'same' | 'pick' | 'random'; pick: CarModelId };
  quick: { layout: string; mode: RaceMode; laps: number; rivals: number; difficulty: 0 | 1 | 2; items: boolean };
  daily: { date: string; tasks: { id: string; p: number; claimed: boolean }[]; allClaimed: boolean;
           login: { day: number; last: string; claimedToday: boolean };
           challenge: { date: string; best: number; streak: number };
           ads: Record<string, number> /* per-day caps */ };
  achievements: Record<string, { p: number; done: boolean }>;
  stats: { races: number; wins: number; objects: number; walls: number; road: number; takedowns: number; driftBest: number; km: number; parts: number };
  ftueStep: number; tipsSeen: number; maxClock: number;
  bestLap: Record<string /*layout*/, number>; bestScore: Record<string /*eventId*/, number>;
  cosmetics: string[];
  settings: { lang; autoGas; quality; muted; musicVol; sfxVol; camera: 'follow' | 'fixed'; driftAssist: boolean; steerSens: number;
              leftHanded: boolean; secondButton: 'brake' | 'drift' | 'off'; haptics: boolean; hints: boolean; shake: 0 | 1 | 2;
              reduceMotion: boolean; colorSafe: boolean };
  ghosts: Record<string /*layout*/, GhostData & { modelId?: CarModelId }>;
}
```

Migration v1 → v2 (in `sanitizeSave`, lossless): `upgrades` → `cars.scrapper.up`; `carColor` → `cars.scrapper.paint`; money kept; `bestPlace[t1..t3] ≤ 3` → ★1 on L1-1 / L1-4 / L2-1, `unlockedTracks` containing t2 → L1-1 to L1-4 marked ★1; ghosts and best laps keep their ids (t1, t2, t3); `tutorialDone` → `ftueStep 6`; `racesFinished` → `stats.races`; `muted` kept.

---

## 24. Telemetry (P0-lite)
Via `src/platform/telemetry.ts` (Bridge analytics if available, no-op otherwise; follow the Playgama telemetry guide). Stable names: `boot_ready`, `first_input`, `ftue_step{n}`, `event_start{event, car, rivals, pr}`, `event_end{event, place, stars_new, coins, duration, fails}`, `results_action{next|retry|garage|double}`, `car_unlock{car, how}`, `upgrade_buy{car, branch, lvl}`, `ad_offer{placement}`, `ad_reward{placement}`, `login_claim{day}`, `task_claim{id}`, `league_unlock{n}`, `settings_change{key}`, `wrong_way`, `stuck_reset`, `session_end{races}`. KPI targets: D0 playtime ≥ 18 min; first input ≥ 95% of boots; race 2 started ≥ 85% of race-1 finishers; L1 boss reached by ≥ 50% of D0 players; D1 ≥ 28%; D7 ≥ 9%; rewarded CTR ≥ 30%.

---

## 25. Performance budgets (P0)
Target 60 FPS on a mid Android (Snapdragon 680 / Mali-G57 class), low quality preset.

| Budget | Value |
|---|---|
| Frame | 16.6 ms: sim ≤ 3 ms (2 substeps), render CPU ≤ 6 ms, GPU ≤ 8 ms, DOM/HUD ≤ 1 ms |
| Physics step | ≤ 4 ms (requirement); headless Node proxy: average ≤ 1.2 ms with 8 cars, all systems, Scrapyard |
| Draw calls in a race (low) | ≤ 110 with a fully mixed 8-model field (v0.1.1: 58); car meshes ≤ 40 |
| Triangles in view | ≤ 120k |
| Particles | inside the existing pools and quality presets |
| DOM pops alive | ≤ 8 |
| Bundle growth | ≤ +250 KB gzip vs v0.1.1; sfx ≤ 2.5 MB |
| First frame | ≤ 3 s after Bridge ready on a 4G mid phone |

Fallback if a mixed field misses budget on low: merge part slots into the body geometry with a per-vertex part id and a per-instance detached mask (2 meshes per model), or cap distinct models per race at 4.

---

## 26. i18n: every new player-visible string (EN + RU)

All strings go through `t()`. Car names are translated (D9); driver and boss names are not. Placeholders in `{}`. Arrows (←, →, ↑) are text characters, not emoji; icons are inline SVG. RU address is informal ("ты"), matching the existing dictionary. Existing keys stay unless listed as changed.

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
| hub.level | Level {n} | Уровень {n} |
| hub.upTo | up to {n} | до {n} |
| hub.car | Car | Машина |
| hub.rivals | Rivals: {mode} | Соперники: {mode} |
| ui.back | Back | Назад (exists) |
| ui.loadingRace | Loading race… | Загружаем гонку… |
| ui.new | NEW | НОВОЕ |
| ui.locked | Locked | Закрыто |
| ui.claim | Claim | Забрать |
| ui.adClaim2 | AD · Claim ×2 | РЕКЛАМА · Забрать ×2 |
| ui.adFailed | Ad is not available right now | Реклама сейчас недоступна (rename of results.adFailed) |
| ui.later | Later | Позже |
| ui.useNow | Use now | Сразу в деле |
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
| goal.carCoins | {n} coins to unlock {car} | Ещё {n} монет до машины «{car}» |
| goal.boss | {n}★ to face {boss} | Ещё {n}★ до босса {boss} |
| goal.league | Beat {boss} to open {league} | Победи {boss}, чтобы открыть «{league}» |
| goal.leagueStars | {n}★ more to open {league} | Ещё {n}★ до лиги «{league}» |
| goal.tasks | Daily tasks {a}/{b} | Задания дня {a}/{b} |
| goal.bestLap | Beat your best lap on {track} | Побей свой лучший круг: «{track}» |

### 26.3 Career, leagues, events, stars
| Key | EN | RU |
|---|---|---|
| career.title | Career | Карьера |
| career.event | Event {n} | Заезд {n} |
| career.boss | Boss | Босс |
| career.bossLocked | {n}★ in this league to face the boss | Собери {n}★ в этой лиге, чтобы вызвать босса |
| career.leagueLocked | Beat the boss of {league} and collect {n}★ | Победи босса лиги «{league}» и собери {n}★ |
| career.stars | {a}/{b} ★ | {a}/{b} ★ |
| career.testDrive | Test drive | Тест-драйв |
| league.1 | Rookie Cup | Кубок новичка |
| league.2 | Street Brawl | Уличная драка |
| league.3 | Harbor Heat | Жара в порту |
| league.4 | Scrap Kings | Короли свалки |
| league.5 | Legends | Легенды |
| star.top3 | Finish top 3 | Финишируй в топ-3 |
| star.win | Win | Победи |
| star.survive3 | Survive to the top 3 | Продержись до топ-3 |
| star.bronze | Bronze: {v} | Бронза: {v} |
| star.silver | Silver: {v} | Серебро: {v} |
| star.gold | Gold: {v} | Золото: {v} |
| star.smash | Break {n} objects | Разбей {n} объектов |
| star.health | Finish with at least {n}% health | Финишируй с прочностью от {n}% |
| star.items | Use {n} power-ups | Используй {n} бонусов |
| star.takedowns | Make {n} takedowns | Выведи из строя {n} соперников |
| star.takedown1 | Make a takedown | Выведи из строя соперника |
| star.drift | Score {n} drift points | Набери {n} очков дрифта |
| star.winBy | Win by {n} s or more | Победи с отрывом от {n} с |
| star.noRepair | Win without repairs | Победи без ремонта |
| star.lead1 | Lead at the end of lap 1 | Лидируй после первого круга |
| star.gain | Gain {n} places | Отыграй {n} мест |
| star.takedownBoss | Take {boss} down once | Выведи из строя {boss} |
| star.driftDuel | Score {n} drift points in the duel | Набери {n} очков дрифта в дуэли |
| star.new | New star! | Новая звезда! |

### 26.4 Modes and modifiers
| Key | EN | RU |
|---|---|---|
| mode.race | Race | Гонка |
| mode.race.d | 8 cars. First across the line wins. | 8 машин. Кто первым финиширует, тот и победил. |
| mode.sprint | Sprint | Спринт |
| mode.sprint.d | A short 2-lap race. | Короткая гонка на 2 круга. |
| mode.time | Time Attack | На время |
| mode.time.d | Alone against your ghost. Beat the lap times. | Один на один со своим призраком. Побей время круга. |
| mode.rampage | Rampage | Разгром |
| mode.rampage.d | 90 seconds. Smash everything. Chain hits for combos. | 90 секунд. Круши всё подряд. Серии ударов дают комбо. |
| mode.knockout | Knockout | На вылет |
| mode.knockout.d | Every 15 seconds the last car is out. | Каждые 15 секунд последний вылетает. |
| mode.drift | Drift Trial | Дрифт |
| mode.drift.d | Score drift points. Walls break your chain. | Набирай очки дрифта. Удар о стену обрывает серию. |
| mode.boss | Boss Duel | Босс |
| mode.boss.d | One on one. Win and the car is yours. | Один на один. Победишь — машина твоя. |
| mode.final | Grand Final | Гранд-финал |
| mode.final.d | The best of the best. 5 laps. | Лучшие из лучших. 5 кругов. |
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

### 26.5 Bosses
| Key | EN | RU |
|---|---|---|
| boss.intro.1 | Big Mo: "Nobody passes my Brawler." | Биг Мо: «Мой Задира никого не пропустит». |
| boss.intro.2 | Sleet: "Try to keep up on the ice." | Слит: «Попробуй угнаться за мной на льду». |
| boss.intro.3 | Grinder: "I eat walls for breakfast." | Гриндер: «Я ем стены на завтрак». |
| boss.intro.4 | Ace: "You'll only see my rear wing." | Эйс: «Ты увидишь только моё заднее крыло». |
| boss.intro.5 | Duchess: "Legends are not born. They are crowned." | Герцогиня: «Легендами не рождаются. Их коронуют». |
| boss.reward | Win to get: {car} | Победи и получи: «{car}» |
| boss.beaten | {boss} beaten! | {boss} повержен! |
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
| perk.patchup.d | Repairs cost 35% less, repair kits heal 50% more | Ремонт на 35% дешевле, ремкомплект лечит на 50% больше |
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
| garage.req.boss | Beat {boss} in {league} | Победи {boss} в лиге «{league}» |
| garage.req.choice | Free choice after your first race | Бесплатно на выбор после первой гонки |
| garage.testDriveFree | Test drive · free | Тест-драйв · бесплатно |
| garage.testDriveAd | AD · Test drive | РЕКЛАМА · Тест-драйв |
| garage.likedIt | Liked it? {req} to own it | Понравилась? {req} — и она твоя |
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

### 26.7 Rivals and Quick Race
| Key | EN | RU |
|---|---|---|
| rivals.title | Rival cars | Машины соперников |
| rivals.mixed | Mixed | Разные |
| rivals.mixed.d | Different cars, chosen for the event | Разные машины под этот заезд |
| rivals.same | Same as mine | Как у меня |
| rivals.same.d | Everyone drives your car. Pure skill. | Все на твоей модели. Решает только мастерство. |
| rivals.pick | One model | Одна модель |
| rivals.pick.d | All rivals drive the model you pick | Все соперники на выбранной модели |
| rivals.random | Random | Случайные |
| rivals.random.d | Anything goes | Что попадётся |
| rivals.fair | Rival strength is set by the event, so every choice is fair | Сила соперников зависит от заезда, поэтому любой выбор честный |
| rivals.fixed | This event has a fixed field | В этом заезде состав соперников фиксирован |
| quick.title | Quick Race | Быстрая гонка |
| quick.track | Track | Трасса |
| quick.mode | Mode | Режим |
| quick.laps | Laps | Круги |
| quick.rivalsCount | Rivals | Соперников |
| quick.difficulty | Difficulty | Сложность |
| quick.easy | Easy | Легко |
| quick.normal | Normal | Нормально |
| quick.hard | Hard | Сложно |
| quick.items | Power-ups | Бонусы |
| quick.anyCar | Any car, even locked ones | Любая машина, даже закрытая |

### 26.8 HUD and race feedback
| Key | EN | RU |
|---|---|---|
| hud.drift | DRIFT | ДРИФТ |
| hud.smash | SMASH ×{n} | РАЗГРОМ ×{n} |
| hud.takedown | TAKEDOWN! {name} | ВЫНЕС! {name} |
| hud.wrecked | WRECKED | РАЗБИТ |
| hud.respawn | Back in {s} s | Вернёшься через {s} с |
| hud.wrongWay | WRONG WAY | НЕ ТУДА |
| hud.goBack | Tap to go back | Нажми, чтобы вернуться |
| hud.goBackKey | Press R to go back | Нажми R, чтобы вернуться |
| hud.missed | MISSED CHECKPOINT | ПРОПУЩЕН ЧЕКПОИНТ |
| hud.lapBanner | LAP {a}/{b} | КРУГ {a}/{b} |
| hud.bestLapFlash | BEST LAP! | ЛУЧШИЙ КРУГ! |
| hud.posUp | +{n} POS | +{n} МЕСТО |
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
| item.nitro | Nitro | Нитро |
| item.shield | Ram Shield | Таран-щит |
| item.repair | Repair Kit | Ремкомплект |
| item.shockwave | Shockwave | Ударная волна |
| item.smashNitro | Smash Nitro | Смэш-нитро |
| hud.final | FINAL LAP | ПОСЛЕДНИЙ КРУГ (replaces hud.finalLap) |

### 26.9 FTUE and tips
| Key | EN | RU |
|---|---|---|
| ftue.hold | HOLD | ДЕРЖИ |
| ftue.holdKeys | Press W or ↑ | Нажми W или ↑ |
| ftue.steer | SLIDE TO STEER | ВЕДИ ПАЛЬЦЕМ |
| ftue.steerKeys | A / D or ← / → to steer | A / D или ← / → для поворота |
| ftue.smash | SMASH IT! | КРУШИ! |
| ftue.boost | BOOST! | УСКОРЕНИЕ! |
| ftue.item | FLICK ↑ TO USE | СМАХНИ ↑ |
| ftue.itemKeys | Press E to use | Нажми E |
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
| tip.wreck | Repairs and repair kits fix your car | Ремонт и ремкомплекты чинят машину |
| tip.knockout | The last car is out every 15 seconds | Каждые 15 секунд последний вылетает |
| tip.ram | Ram rivals into walls! | Тарань соперников в стены! |
| tip.styleFull | Smash Nitro ready: flick up! | Смэш-нитро готово: смахни вверх! |
| tip.styleFullKeys | Smash Nitro ready: press E! | Смэш-нитро готово: жми E! |

### 26.10 Results
| Key | EN | RU |
|---|---|---|
| results.next | NEXT | ДАЛЬШЕ |
| results.retry | RETRY | ЕЩЁ РАЗ |
| results.garage | GARAGE | ГАРАЖ |
| results.prize | Place prize | Приз за место |
| results.smash | Smash ({n} objects, {k} takedowns) | Разгром ({n} объектов, {k} вынесено) |
| results.drift | Drift | Дрифт |
| results.stars | New stars | Новые звёзды |
| results.firstBonus | First race bonus | Бонус за первую гонку |
| results.total | Total | Итого |
| results.ad | AD · +{n} coins | РЕКЛАМА · +{n} монет |
| results.xp | +{n} XP | +{n} опыта |
| results.levelUp | Level {n}! | Уровень {n}! |
| results.soClose | {s} s to the podium | {s} с до подиума |
| results.order | Finish order | Итоги заезда |
| results.score | Score | Очки |
| results.medal.none | No medal | Без медали |
| results.medal.bronze | Bronze | Бронза |
| results.medal.silver | Silver | Серебро |
| results.medal.gold | Gold | Золото |
| results.tomorrow | Tomorrow: {n} coins | Завтра: {n} монет |
| results.tasksIn | New tasks in {t} | Новые задания через {t} |

### 26.11 Pause and repair
| Key | EN | RU |
|---|---|---|
| pause.freeRepair | AD · Free repair | РЕКЛАМА · Бесплатный ремонт |
| pause.camera | Camera | Камера |
| pause.goals | Goals | Цели |
| pause.repairCap | Max {n} | Не больше {n} |

### 26.12 Settings
| Key | EN | RU |
|---|---|---|
| settings.controls | Controls | Управление |
| settings.camera | Camera | Камера |
| settings.camFollow | Follow | За машиной |
| settings.camFixed | Fixed | Неподвижная |
| settings.driftAssist | Drift assist | Помощь в дрифте |
| settings.driftAssist.hint | Hold full lock at speed to drift | Выверни руль до упора на скорости, чтобы уйти в дрифт |
| settings.sensitivity | Steering sensitivity | Чувствительность руля |
| settings.leftHanded | Left-handed | Для левой руки |
| settings.secondButton | 2nd-finger button | Кнопка для второго пальца |
| settings.secondBrake | Brake | Тормоз |
| settings.secondDrift | Drift | Дрифт |
| settings.secondOff | Off | Нет |
| settings.vibration | Vibration | Вибрация |
| settings.hints | Control hints | Подсказки |
| settings.music | Music | Музыка |
| settings.effects | Effects | Эффекты |
| settings.shake | Screen shake | Тряска экрана |
| settings.shakeFull | Full | Полная |
| settings.shakeReduced | Reduced | Слабая |
| settings.reduceMotion | Reduce motion | Меньше движения |
| settings.colorSafe | Colour-safe damage | Урон без опоры на цвет |
| settings.accessibility | Accessibility | Доступность |
| settings.other | Other | Прочее |
| settings.reduceFlashes | Reduce flashes (P1) | Меньше вспышек |
| settings.textSize | Text size (P1) | Размер текста |
| settings.replayTutorial | Replay tutorial (P1) | Пройти обучение заново |

### 26.13 Today: login, tasks, Daily Challenge
| Key | EN | RU |
|---|---|---|
| today.title | Today | Сегодня |
| login.title | Daily reward | Награда дня |
| login.day | Day {n} | День {n} |
| login.claimed | Claimed | Получено |
| login.comeBack | Come back tomorrow for {n} coins | Возвращайся завтра за {n} монетами |
| login.noReset | Missing a day never resets your streak | Пропуск дня не сбрасывает серию |
| tasks.title | Daily tasks | Задания дня |
| tasks.allBonus | All 3 done: +{n} coins | Все три: +{n} монет |
| tasks.newIn | New tasks in {t} | Новые задания через {t} |
| task.win1 | Win a race | Выиграй гонку |
| task.podium3 | Finish in the top 3 three times | Финишируй в топ-3 три раза |
| task.smash60 | Break {n} objects | Разбей {n} объектов |
| task.takedown3 | Make {n} takedowns | Выведи из строя {n} соперников |
| task.drift3k | Score {n} drift points | Набери {n} очков дрифта |
| task.items6 | Use {n} power-ups | Используй {n} бонусов |
| task.nitro5 | Use Nitro {n} times | Используй нитро {n} раз |
| task.stars2 | Earn {n} stars | Получи {n} звезды |
| task.rampage2k | Score {n} in a Rampage | Набери {n} очков в «Разгроме» |
| task.bestlap | Beat your best lap on any track | Побей свой лучший круг на любой трассе |
| task.lowhp | Finish with less than {n}% health | Финишируй с прочностью меньше {n}% |
| task.walls10 | Smash {n} wall segments | Снеси {n} секций стены |
| task.road5 | Tear up {n} road chunks | Вырви {n} кусков дороги |
| task.km5 | Drive {n} km | Проедь {n} км |
| task.reverseWin | Win on a Reverse track | Выиграй на реверсной трассе |
| task.parts5 | Knock {n} parts off rivals | Сбей с соперников {n} деталей |
| task.carX | Race with {car} | Проведи гонку на машине «{car}» |
| task.newCar | Finish a race with a different car than last time | Финишируй на другой машине, не той, что в прошлый раз |
| task.sameRivals | Race with "Same as mine" rivals | Проведи гонку с соперниками «Как у меня» |
| task.repair1 | Repair your car once | Почини машину один раз |
| challenge.title | Daily Challenge | Вызов дня |
| challenge.forcedCar | Today's car: {car} | Машина дня: «{car}» |
| challenge.streak | Challenge streak ×{n} | Серия вызовов ×{n} |
| challenge.done | Done for today | На сегодня всё |

### 26.14 Trophies
| Key | EN | RU |
|---|---|---|
| trophies.title | Trophies | Трофеи |
| trophies.stats | Stats | Статистика |
| stat.races | Races | Гонок |
| stat.wins | Wins | Побед |
| stat.objects | Objects smashed | Разбито объектов |
| stat.takedowns | Takedowns | Вынесено соперников |
| stat.driftBest | Best drift | Лучший дрифт |
| stat.km | Distance | Пройдено |
| ach.firstFinish / .d | First Finish / Finish a race | Первый финиш / Финишируй в гонке |
| ach.podium / .d | Podium / Finish in the top 3 | Подиум / Финишируй в топ-3 |
| ach.firstWin / .d | Winner / Win a race | Победитель / Выиграй гонку |
| ach.boss1 / .d | Rookie Champion / Beat Big Mo | Чемпион новичков / Победи Биг Мо |
| ach.boss2 / .d | Street Boss / Beat Sleet | Король улиц / Победи Слита |
| ach.boss3 / .d | Harbor Master / Beat Grinder | Хозяин порта / Победи Гриндера |
| ach.boss4 / .d | Scrap King / Beat Ace | Король свалки / Победи Эйса |
| ach.legend / .d | Legend / Win the Grand Final | Легенда / Выиграй гранд-финал |
| ach.wrecking / .d | Wrecking Ball / Break 1,000 objects | Шар-баба / Разбей 1 000 объектов |
| ach.demolition / .d | Demolition Expert / Break 10,000 objects | Мастер сноса / Разбей 10 000 объектов |
| ach.roadRipper / .d | Road Ripper / Tear up 100 road chunks | Асфальтодёр / Вырви 100 кусков дороги |
| ach.takedown25 / .d | Takedown Artist / Make 25 takedowns | Мастер тарана / Выведи из строя 25 соперников |
| ach.takedown250 / .d | Takedown Legend / Make 250 takedowns | Легенда тарана / Выведи из строя 250 соперников |
| ach.collector / .d | Collector / Own 5 cars | Коллекционер / Собери 5 машин |
| ach.fullGarage / .d | Full Garage / Own all 10 cars | Полный гараж / Собери все 10 машин |
| ach.maxed / .d | Maxed Out / Max every branch on one car | На максимум / Прокачай одну машину полностью |
| ach.stars50 / .d | Star Hunter / Earn 50 stars | Охотник за звёздами / Собери 50 звёзд |
| ach.stars105 / .d | Superstar / Earn all 105 stars | Суперзвезда / Собери все 105 звёзд |
| ach.driftKing / .d | Drift King / Score 10,000 drift points in one race | Король дрифта / Набери 10 000 очков дрифта за гонку |
| ach.untouchable / .d | Untouchable / Win with at least 95% health | Неуязвимый / Победи с прочностью от 95% |
| ach.comeback / .d (P1) | Comeback / Win after being last after lap 1 | Камбэк / Победи, будучи последним после первого круга |
| ach.mirror / .d (P1) | Mirror Match / Win with "Same as mine" rivals | Зеркальный матч / Победи соперников на твоей же модели |
| ach.loyal / .d (P1) | Loyal Racer / Claim 7 daily rewards | Верный гонщик / Забери 7 наград дня |
| ach.phoenix / .d (P1) | Phoenix / Win after being wrecked in that race | Феникс / Победи после того, как тебя разбили в этой гонке |
| ach.unlocked | Trophy unlocked: {name} | Новый трофей: «{name}» |

### 26.15 Reveal, toasts, paints
| Key | EN | RU |
|---|---|---|
| reveal.car | New car! | Новая машина! |
| reveal.league | New league open! | Открыта новая лига! |
| reveal.track | New track: {track} | Новая трасса: «{track}» |
| reveal.feature | New: {feature} | Новое: {feature} |
| feature.quick | Quick Race with any car | Быстрая гонка на любой машине |
| feature.rivals | Pick your rivals' cars | Выбор машин соперников |
| feature.tasks | Daily tasks | Задания дня |
| feature.challenge | Daily Challenge | Вызов дня |
| toast.claimed | +{n} coins | +{n} монет |
| toast.testDriveUsed | Free test drive used | Бесплатный тест-драйв использован |
| toast.adCap | Come back tomorrow for more | Возвращайся завтра |
| paint.limeFizz | Lime Fizz | Лаймовая шипучка |
| paint.lightning | Lightning | Молния |

Obsolete keys (`results.continue`, `tut.*`, `menu.play`, `tracks.title`, `track.lockedHint`) are removed by the UI packages once unused; the i18n test keeps EN and RU in sync.

Text rules: RU strings must fit 360 px portrait (the longest labels above are checked by the overflow e2e); line ≤ 40 characters for car lines; no word breaks inside buttons.

---

## 27. Priority summary

**P0 (v0.2):**
- 10 cars (physics, perks, drift traits, models, garage), per-car upgrades, PR, test drives, per-car paint.
- Rival cars sheet (Mixed, Same as mine, One model, Random) with fair normalisation.
- Drift mechanic (assist, brake tap, Space, DRIFT button), boost stack, slipstream, perfect start, style meter → Smash Nitro.
- Power-ups and boost pads (in flight) with the distribution table and AI use.
- Smash score, combos, takedowns, mass-normalised damage, attacker split, wreck → respawn, anti-cut sectors, wrong way, track evolution toast.
- AI per-car awareness, archetypes, AI drift, items, attacks, fair rubber band, league tiers, fail assist, bosses, driver renames.
- Follow camera + forward visibility, directional kick, one-finger gesture grammar, left-handed mode, haptics, slow motion.
- 10 layouts (t1 to t5 forward and reverse), Harbor and Scrapyard themes.
- Modes Race, Sprint, Time Attack, Rampage, Knockout, Drift Trial, Boss Duel, Grand Final; 6 modifiers.
- Career 35 events, stars, gates; Quick Race; Daily Challenge.
- Economy tables, XP and levels with feature gating, login calendar, daily tasks, 20 achievements.
- FTUE (no-menu first race, prompts, choose 2nd car, guided upgrade); HUB, Garage, Results, Pause, Settings, HUD v2, minimap, next-goal line, red dots, unlock reveal.
- Rewarded R1 to R5, interstitial placements, Bridge config delays.
- Save v2 + migration, telemetry, performance budgets, all strings EN + RU.
- Release blocker: recorded/CC0 audio and music.

**P1:** revenge, near miss, shortcut gates, explosive barrels, theme hazards, night variants, Neon Avenue, weekly cup and tasks, car mastery, cosmetics shop, hidden difficulty adjustment, photo finish, final-lap music stem, reduce flashes, text size, full keyboard focus, custom/same-class rivals, R6 to R8, 4 more achievements, SaaS leaderboards (best lap per layout, best Rampage score) once the token is set, Legend Remix.

**P2:** IAP catalog, Wreck Arena, falling structures, pads destroyed by torn road, rain.
