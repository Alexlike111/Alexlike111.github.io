# Smash Circuit: touch controls research and recommendation

Date: 2026-11-05. Scope: mobile-browser / Playgama top-down ortho arcade destruction racer with auto gas, auto drift, items, nitro.

How reliable the sources are: the web research came from WebSearch result summaries. toucharcade.com could not be fetched from this session (DNS blocked), so TouchArcade claims come from search snippets. Rows marked **[K]** come from general genre knowledge and were not re-verified in this session. Code facts come from reading `src/input/schemes.ts`, `src/input/input.ts`, `src/config.ts` (CONFIG.controls, CONFIG.car, CONFIG.render.camera), `src/render/camera.ts`, `src/game.ts` and `src/sim/assist.ts`, `src/sim/drift.ts`.

Unit conversion used below: 1 CSS px is about 1 dp = 1/160 in = 0.16 mm on phones, so **1 mm = 6.3 CSS px**. On a 390x844 phone, 1 vmin = 3.9 px = 0.62 mm.

---

## 1. Games, schemes, defaults, what reviewers say

| Game (view) | Touch schemes offered | Default | What reviewers / players say | Sources |
|---|---|---|---|---|
| **Rush Rally Origins** (top-down rally) | 2 steer buttons + gas + brake; on-screen wheel; tilt; buttons can be moved; gamepad | Buttons (L/R + pedals) | "Deceptively simple" and "plenty serviceable", but "steering seemed really floaty" and hard to master on touch. Some reviewers preferred tilt. A controller "made it a joy to drift". **The chase camera makes steering extremely unwieldy**, and its lag means you "steer blind". | [Gamezebo](https://www.gamezebo.com/reviews/rush-rally-origins-review-a-filthy-spectacular-racing-game/), [Android Police](https://www.androidpolice.com/2021/08/19/the-best-racing-series-youve-never-heard-of-is-about-to-get-a-new-mobile-entry/), [Pocket Gamer App Army](https://www.pocketgamer.com/rush-rally-origins/app-army-assemble-rush-rally-origins-is-this-new-racer-worth-taking-for-a-spin/), [Two Beard Gaming](https://twobeardgaming.wordpress.com/2021/08/27/review-rush-rally-origins-nintendo-switch/), [App Store](https://apps.apple.com/us/app/rush-rally-origins/id1557502285) |
| **Reckless Racing 3** (isometric/top-down) | Touch buttons you can move and resize (presets), tilt steering mode, gamepad | Touch buttons | People like being able to customise the layout. Complaints: "nothing to help guide your fingers" and "without tactile feedback they can be touchy". Tilt fans say tilt "makes gameplay much better". | [TouchArcade review](https://toucharcade.com/2014/10/17/reckless-racing-3-review/), [App Store reviews](https://apps.apple.com/us/app/reckless-racing-3/id882453590?see-all=reviews&platform=iphone), [Google Play](https://play.google.com/store/apps/details?id=com.pixelbite.rr3) |
| **Pixel Machines** (Micro Machines-like, top-down) | Classic L/R + gas + brake buttons; a **"steering wheel" where you point the direction you want to go**, with auto braking in turns | Buttons | The point-the-direction wheel "works well" but "falls apart when you fall off the course". Players asked for the wheel on the LEFT and said the default buttons covered the track and needed bigger tap areas. | [TouchArcade review](https://toucharcade.com/2016/04/22/pixel-machines-review-if-micro-machines-aint-broke-dont-fix-it/), [TouchArcade forum](https://toucharcade.com/community/threads/pixel-machines.285888/), [game-solver listing](https://game-solver.com/pixel-machines/) |
| **Micro Machines World Series** (top-down, rotating or fixed views) | Pad / keyboard (console/PC); older mobile Micro Machines used touch | n/a | "Poorly-controlled". **"The top-down view makes it hard to tell which way to steer"**, which is the classic relative-steering-in-a-fixed-camera problem. | [Wikipedia](https://en.wikipedia.org/wiki/Micro_Machines_World_Series), [Steam discussion](https://steamcommunity.com/app/535850/discussions/0/2217311444334024805/), [Electric Sistahood review](http://www.electricsistahood.com/2017/08/micro-machines-world-series-review/) |
| **Built for Speed** (retro top-down) | Tap the left or right half to steer, auto drive (two-tap) | Tap halves | "Simple" but "really weird at first, works well after a few races". Some versions press both sides to go and lift one side to turn. | [MobileSyrup](https://mobilesyrup.com/2017/03/26/built-for-speed-game-review/), [GameIndustry.com](http://www.gameindustry.com/reviews/time-waster/built-for-speed/), [Uptodown blog](https://blog.en.uptodown.com/built-for-speed-android-download/) |
| **Smashy Road: Wanted** (isometric arcade smash-chase, closest genre match) **[K]** | Hold the left or right half to turn, auto gas, fixed isometric camera | Tap halves | [K] Its one-thumb-per-side scheme is widely copied by Crossy-Road-style car games. The known pain point is that the turn is relative to the car while the camera is fixed, so on down-screen roads the controls feel reversed. | (not verified this session) |
| **Asphalt 9 / Legends** (behind view) | **TouchDrive** (auto steer and auto gas; swipe to pick a route, tap drift and nitro), Tap to steer, Tilt | **TouchDrive** | People call TouchDrive "basically an auto mode". Many comments say "all you do is press nitro and select paths", while others say it "makes the most sense for mobile". Tap steer is "most accurate" but "requires four fingers". Long-time fans prefer tap. | [GSMArena review + comments](https://www.gsmarena.com/newscomm-32552.php), [Northwestern blog](https://sites.northwestern.edu/mariamalkhulaifi/asphalt-9-legends), [Pocket Gamer tips](https://www.pocketgamer.com/asphalt-9-legends/asphalt-9-legends-cheats-and-tips-how-to-play-to-win-every-race/), [TouchArcade preview](https://toucharcade.com/2018/06/19/asphalt-9-legends-wants-to-make-insane-driving-as-easy-as-possible/), [Wikipedia (A8 heritage)](https://en.wikipedia.org/wiki/Asphalt_8:_Airborne) |
| **Mario Kart Tour** (behind view) | Swipe/slide to steer with auto drift; Manual Drift; **Smart Steering** (keeps you on track); Gyro; later an update added tap-steer + swipe-drift or the reverse | Swipe + Smart Steering + auto item | Reviewers say Smart Steering "ignores inputs" and nudges the kart, so turn it off right away. Manual drift is "floaty" and imprecise. Swipe is better than manual drift but still "awkward". Gyro is seen as the best option. Nintendo says Smart Steering and Auto-Item suit newcomers, and Manual and Gyro suit veterans. | [Nintendo Life](https://www.nintendolife.com/reviews/mobile/mario_kart_tour), [Autoblog](https://www.autoblog.com/features/mario-kart-tour-review), [Leaf&Core](https://leafandcore.com/2019/09/29/mario-kart-tour-review-nintendo-should-be-ashamed/), [Gamer With Kids](https://thegamerwithkids.com/2019/10/01/mario-kart-tour-mobile-review/), [Pocket Gamer settings](https://www.pocketgamer.com/mario-kart-tour/mario-kart-tour-cheats-tips-custom-control-settings-for-victory/), [GoNintendo update](https://gonintendo.com/stories/349534-mario-kart-tour-s-latest-update-adds-in-a-drift-or-steer-button), [Apple tips](https://apps.apple.com/eg/story/id1533872240) |
| **Real Racing 3** (sim, behind view) | Tilt (A/B variants), Wheel A (touch steer + auto gas), Wheel B (manual gas); brake assist and steering assist Low/High | Tilt + auto gas + assists | Assists make it accessible, and turning steering assist off "feels heavier". Button players are frustrated (forum). | [RR3 wiki thread](https://rr3.fandom.com/f/p/2960986793312429193), [NamuWiki](https://en.namu.wiki/w/%EB%A6%AC%EC%96%BC%20%EB%A0%88%EC%9D%B4%EC%8B%B1%203/%EA%B2%8C%EC%9E%84%20%ED%94%8C%EB%A0%88%EC%9D%B4), [Gamezebo walkthrough](https://www.gamezebo.com/walkthroughs/real-racing-3-walkthrough/) |
| **Beach Buggy Racing** (kart, behind view) | Tilt, touch buttons, gamepad, with seamless switching | Tilt **[K]** | "Responsive" from the start. Some touch users "slide off the track... sometimes I just don't turn at all". Several reviewers recommend tilt. | [Pocket Gamer review](https://www.pocketgamer.com/beach-buggy-racing/review/), [Google Play](https://play.google.com/store/apps/details?id=com.vectorunit.purple.googleplay&hl=en_US) |
| **Horizon Chase** (arcade, behind view) **[K]** | Tap the left/right halves (digital), on-screen arrows, tilt; auto gas; nitro button | Touch L/R | [K] Praised as one of the few digital-steer racers that feels good, because its car model is built for digital input (lane-like lateral motion, soft yaw). No review found this session. | (not verified) |
| **Hill Climb Racing / Lite on Poki** (side view) | Gas on the right, brake on the left, nothing else | Pedals | It works because it needs only 2 inputs, one per thumb. That shows the value of one input per thumb. | [Poki page](https://poki.com/en/g/hill-climb-racing-lite) |
| **Smash Karts** (.io, third-person arena) | Virtual joystick + fire button (some pages say swipe) | Joystick | Only aggregator pages were found, and they conflict. No real reviews. | [drifted.com](https://www.drifted.com/smashkarts/), [boy-games.io](https://boy-games.io/smash-karts) (low reliability) |
| **Drift.io / Drift Boss** (.io, top-down/iso) | One touch: hold to turn and drift, release to go straight | One-touch | One-button play is the HTML5 portal default for hyper-casual car games. | [drive-mad.co](https://drive-mad.co/drift-io/), [driftboss.io](https://driftboss.io/) (low reliability) |
| **CrazyGames / Poki car games** (Deadly Descent, PolyTrack, Extreme Car Parking...) | Mostly keyboard; mobile builds use on-screen buttons or a wheel | Buttons | No drag-to-direction car game was found among portal hits, so the gap is open. | [Deadly Descent](https://www.crazygames.com/game/deadly-descent-bzs), [PolyTrack](https://www.crazygames.com/game/polytrack), [Extreme Car Parking](https://poki.com/en/g/extreme-car-parking) |
| Hot Wheels Unlimited, Rumble Racing Star, Drift Hunters mobile, Road Rash-likes | Not found this session | n/a | No usable sources came back. I left them out rather than guess. | n/a |
| Brigador (PC top-down, for context) | Relative (tank) vs absolute debate | Relative | Players are split. The common ask is "let me choose between relative and absolute", not "replace one with the other". | [Steam discussion](https://steamcommunity.com/app/274500/discussions/0/483368526573177502/) |

### UX guidance sources
- Floating stick as the action-game default; dead zone of 10-18 % of travel with hysteresis; clamp by vector length; touch region bigger than the drawn control: [simplified.media touch guide](https://simplified.media/guides/mobile-touch-controls), [Cursa touch patterns](https://cursa.app/en/page/touch-controls-for-mobile-games-input-patterns-and-feedback). A playtest found a fixed stick caused thumb drift: [GitHub issue](https://github.com/jbogaardt/me_rpg/issues/16).
- Targets of at least 44x44 pt (Apple) / 48x48 dp (Material, about 9 mm); see the guides above.
- Grips: 49 % one-handed, 36 % cradled, 15 % two-handed. The bottom of the screen is the comfortable zone and the top needs a stretch: [A List Apart, Hoober](https://hn.jakechampion.name/reader/http://alistapart.com/article/how-we-hold-our-gadgets), [Gizmodo](https://gizmodo.com/were-designing-apps-wrong-for-huge-smartphones-1651751412). In two-thumb play on phones, skill buttons sit 6-24 mm from the screen edges: [arXiv 2110.08753](https://arxiv.org/pdf/2110.08753).
- Haptics: `navigator.vibrate` works on Android Chrome but not on iOS Safari. The iOS hidden-`<input switch>` trick needs a user gesture since iOS 18.4: [ios-vibrator-pro-max](https://github.com/samdenty/ios-vibrator-pro-max), [bugnet](https://bugnet.io/blog/fix-web-game-vibrate-api-not-available-ios-safari).

---

## 2. Patterns that win for top-down arcade racers on phones

1. **One steering thumb, everything else optional.** The best-liked casual racers (Hill Climb, Drift.io, Asphalt TouchDrive, MKT swipe, Built for Speed) need one thumb to steer, and gas is automatic. Asphalt's tap steer "requires four fingers", and that is the scheme people complain about.
2. **Analog beats digital** for a car with a high yaw rate. Digital L/R only works when the car model is built for it (Horizon Chase: soft yaw, lane-like motion). Rush Rally's default buttons get called "floaty" and hard to master.
3. **The camera and the control frame must match.** Relative (car-left/car-right) controls need a camera that rotates with travel. Under a fixed north-up camera they invert whenever the car heads down the screen. Micro Machines WS: "hard to tell which way to steer". Rush Rally shows the opposite failure: a chase camera with lag makes you "steer blind". Absolute ("point where you want to go") controls work with any camera, and they are the right pair for north-up. Pixel Machines' point-the-direction wheel "works well".
4. **Assists must be gentle and must never fight the player.** MKT Smart Steering is the most criticised assist because it "ignores inputs". Our `edgeAssist` already follows the right rule: it only adds steer, never removes it, and stays out of deliberate smashes.
5. **Floating origin, big invisible hit areas.** The control appears where the thumb lands, so a thumb that is a few millimetres off never misses. Pixel Machines players asked for "bigger tap areas", and Reckless Racing players say there is "nothing to help guide your fingers".
6. **Let the player choose, but default sensibly and ask only once.** Every well-rated title offers 3 or more schemes. The default is the most assisted one, and the picker is short.
7. **Customisable placement and size** (Reckless Racing, Rush Rally) is praised. It is a nice-to-have once the defaults are right.
8. **Tilt has fans but stays an option.** It is never the only scheme, and it fails on devices without a sensor and on permission prompts.

---

## 3. Why our current schemes feel uncomfortable (from our code)

Numbers are for a 390x844 CSS-px phone (portrait) and 844x390 (landscape).

### A. Camera and control frame mismatch in landscape (most likely the #1 cause)
- `game.ts applyCamera()`: with camera `auto` (the default in `meta/save.ts`), touch play uses the rotating track-tangent-up camera. But `camera.ts` fades rotation out between aspect `rotAspectFrom 0.95` and `rotAspectTo 1.3`. A landscape phone (aspect about 2.16) is therefore **fully north-up**.
- All five schemes are **relative** (car-left/right). On north-up, whenever the road runs down or sideways on screen, "left" turns the car toward screen-right. Players then hesitate or steer the wrong way before every down-screen section. This is the textbook top-down complaint.
- In portrait the camera rotates with the track tangent, not the car heading (`rotFollow 6/s`, `rotMaxRate 1.6 rad/s`). Relative controls are fine there, but the world swings under the thumb at hairpins. That swing invites over-steer.

### B. Accidental auto drifts on every firm or sustained turn
- `driftSteer 0.8`: analog schemes request a drift **at once** when |steer| is 0.8 or more. With `slideCurve 0.8`, a steer of 0.8 comes at about 76 % of the throw: about **45 px, roughly 7 mm** of thumb travel in portrait slide (full lock 0.15 W = 58 px, about 9 mm). Above `drift.autoSpeed` (about 60 km/h), any firm correction turns into a drift the player never asked for.
- Digital schemes (buttons, tap): `buttonSteerRise 10/s` gives full lock in 0.1 s. Then `driftHoldS 0.25` means **any turn held longer than about 0.35 s becomes a drift**. A gentle sweeping curve cannot be driven with the buttons. The car either zig-zags (tap-tap) or drifts (hold).

### C. Digital full-lock steering on a twitchy car (buttons, tap)
- `CONFIG.car.steerSpeed 20` (0.05 s to full lock) and `maxYawRate 3.2 rad/s`, plus the 0.1 s button ramp. A tap is nearly full lock, so there is no small-correction input and players get zig-zag oscillation. A top-down ortho view also makes every yaw change very visible.

### D. Sensitivity slider scales the OUTPUT, not the throw (bug-level discomfort)
- `input.ts`: `steer = tSteer * this.sens` (and `btnSteer * sens`), then a clamp. With sensitivity below 1 (the slider minimum is 0.5) the car **can never reach full lock**. Buttons give only half lock, and hairpins become impossible. A player who lowers sensitivity because steering is twitchy ends up with a car that cannot turn. With sensitivity above 1, full lock comes earlier and the twitch gets worse.

### E. Slide: throw too short in portrait and inconsistent between orientations
- Throw and dead zone are fractions of **screen width**. Portrait full lock is 58 px (about 9 mm) with a 0.7 mm dead zone. Landscape full lock is 127 px (about 20 mm). The same thumb move gives twice the steer in portrait.
- `slideCurve 0.8` (below 1) gives more authority near the centre, so small corrections are big. That is the opposite of what a twitchy car needs.
- `followHome` moves neutral every time the thumb passes full lock, so after a few corners the player no longer knows where straight is (no visual anchor beyond the dim stick).
- Only the left half of the screen accepts a steer touch. A thumb that lands just right of centre does nothing.

### F. Fixed joystick: wrong place, 2D-looking but 1D, accidental brakes
- `joyGeom`: centred at W/2. In landscape two-thumb play, the screen centre is the farthest point from both thumbs (the stretch zone).
- Radius `0.16 * min(W,H)` = 62 px (about 10 mm). The base is fixed, so a thumb that lands 1.5R off is ignored (`joyGrab 1.5`) and thumb drift is never corrected.
- It looks like a twin-stick stick, but only **x** steers (relative to the car). Pushing "up" does nothing, and pushing toward where you want to go gives the wrong result whenever the car is not pointing up. Players expect absolute direction from a 2D stick in a top-down game.
- `joyBrakePull 0.55`: a thumb that sags 34 px (about 5 mm) below centre **brakes**. A thumb sweeping sideways naturally arcs downward, so players get surprise brakes mid-corner. The joystick has no brake button and no re-anchoring.

### G. Buttons: hit box = drawn box, both steer buttons under one thumb
- In `buttons` mode, a touch outside the two boxes does nothing (`onDown` returns). There is no hit slop, so a thumb a few millimetres off misses.
- Both steer buttons sit side by side on the left (88 px about 14 mm each, portrait). One thumb must hop between two targets about 15 mm apart while watching the road, the same ergonomics that Rush Rally reviewers call hard to master. Sizes are adequate. Placement and slop are the issue.

### H. Tap halves: braking needs both thumbs, and auto drift as in B
- Holding one side for a long curve triggers B. Braking needs both thumbs, which cancels steering. Tapping anywhere on the screen to steer also covers the action area under the thumbs.

### I. Tilt: OK on its own, risky on the portal
- `tiltFullDeg 25`, dead zone 3 deg, smoothing 14/s are reasonable. It auto-recentres only at race start or orientation change. It can fail in a cross-origin portal iframe without `allow="accelerometer; gyroscope"`; this needs checking on the Playgama page. The fallback to Buttons already exists.

### J. No haptics, little feedback on steer state
- There is no `vibrate` anywhere in `src`. Players feel no feedback when a drift starts, an item fires or a hit lands. Apart from the slide/joystick knob, nothing shows how hard the car is being asked to turn.

---

## 4. Ranked recommendation

### Keep / add / drop
| Rank | Scheme | Action |
|---|---|---|
| **1 (NEW, default)** | **Point**: floating stick, absolute direction ("steer toward the thumb") | Add. It replaces `joystick`. One thumb anywhere in the steer zone; the car turns toward the direction the thumb points on screen; auto gas; BRAKE + ITEM on the right. It works with north-up landscape and rotating portrait. |
| **2 (keep, fixed)** | **Buttons** | Keep for players who want classic L/R, but fix B, C, D and G. Merge `tap` into it: giant invisible hit halves make tap mode redundant. Pair it with a rotating camera in every orientation. |
| **3 (keep, fixed)** | **Swipe** (current `slide`) | Keep (MKT-style relative analog). Use physical units, curve 1.0 or more, fix D, and pair it with a rotating camera. |
| 4 (keep, hidden under "More") | Tilt | Keep as is, apart from the sensitivity fix. |
| drop | Fixed `joystick`, `tap` | Remove from the picker. Map saved values to `point` / `buttons` in `controlsOr()` migration. |
| not recommended | Asphalt-style full auto-steer | Do not add as a scheme. In a destruction racer aiming at props is the fun, and auto-steer is the most-mocked scheme ("all you do is press nitro"). Instead, an **Assist: Off / Normal / High** toggle that scales `CONFIG.car.assistMax` 0 / 0.2 / 0.4 gives the "smart steering" benefit for kids and keeps intent. |

### 4.1 Point scheme: exact starting parameters (`CONFIG.controls.point`)
| Param | Value | Why |
|---|---|---|
| Activation zone | Portrait: anywhere below the top HUD (top 18 % excluded) except the right-hand button hit boxes. Landscape: left 55 % of the width | Floating origin; the thumb never misses |
| Base radius R | `clamp(0.15 * min(W,H), 56, 84)` px, about 9-13 mm (58 px on 390 wide) | Comfortable thumb throw; drawn ring |
| Aim dead radius | enter 0.22 R (about 13 px, 2 mm), exit 0.15 R (hysteresis) | Inside it there is no aim: steer 0, the car keeps its heading |
| Base leash | if the finger is more than 1.3 R from the base, drag the base along to stay at 1.3 R (2D version of `followHome`) | Reversing direction is always instant |
| Aim smoothing | low-pass the aim vector with tau 35 ms (`k = 1 - exp(-dt/0.035)`) | Kills touch jitter without lag |
| Screen to world | X = dxPx, Y = -dyPx, Y' = Y / cos(tilt); wx = X·cos(az) - Y'·sin(az); wz = X·sin(az) + Y'·cos(az); `target = atan2(wz, wx)` where az = `CameraRig.viewAz`, tilt = `CameraRig.tilt` | The same inverse transform that camera.ts already uses for `cdx/cdz`. Add a unit test: stick "up" with the car pointing screen-up gives 0 error |
| Heading error | `err = wrap(target - car.angle)` (+ = turn left, as in `assist.ts`) | |
| Steer law | `steer = -clamp((err - 0.10 * angularVel) / 0.50, -1, 1)` (full lock at about 29 deg of error; D-term 0.10 s damps overshoot) | Proportional and analog, no zig-zag |
| Near-180 deg hysteresis | if abs(err) > 2.6 rad, keep the previous turn sign | No flip-flop when pointing straight back |
| Release grace | keep the last aim for 120 ms after lift-off, then steer 0 | Micro-lifts do not kill a turn |
| Auto drift | request `DRIFT_AUTO` when abs(err) > 0.9 rad (about 52 deg) for at least 0.10 s; the sim keeps its `autoSpeed` gate | Drift only when the player points hard across the travel direction |
| Assist | keep `edgeAssist` (`assistMax 0.2`) | Never fights the player |
| Feedback | knob + ring under the thumb (ring 20 % opacity idle, 45 % active); a **ghost chevron at the car** showing the target heading, 55 % opacity; ring flashes on drift start | Makes absolute steering learnable in seconds |

Camera pairing for Point: keep `auto`. Portrait rotates with the track tangent; landscape is north-up. Both work, because the aim is re-projected each frame with the current `viewAz`. In portrait, a still thumb pointing "up" means "follow the road", because the camera keeps the road pointing up. In practice that gives a smart-steering feel without taking control away.

### 4.2 Buttons: fixes and parameters
- **Hit zones:** the whole bottom-left steer area is live. Landscape: x < 0.45 W and y > 0.35 H. Portrait: x < 0.55 W and the bottom 40 % of the screen. It is split at the midline between the two drawn buttons, so the thumb can roll between them. Drawn buttons stay at least 12 mm (76 px) wide, with a 3 mm gap and an edge margin of at least 3 mm + safe area.
- **Progressive digital steer:** on press, ramp to 0.55 at 10/s, then 0.55 to 1.0 at 1.6/s (full lock after about 0.35 s of hold). A tap is a nudge and a hold is a full turn.
- **Drift on buttons:** `driftHoldS` 0.25 s becomes **0.55 s at full lock**. Also add "BRAKE tapped while steering at speed = drift" (Asphalt's drift is a brake/handbrake tap), so drifting becomes a deliberate act.
- **Camera:** when the scheme is relative (buttons, swipe, tilt), rotate in landscape too. Add `CameraRig.rotateLandscape` that skips the aspect fade, with a calmer `rotFollow 4`, `rotMaxRate 1.2` in landscape to limit motion.

### 4.3 Swipe (slide): parameters
- Throw in physical units: full lock **12 mm, about 76 px** (`clamp(0.2*min(W,H), 64, 96)` px), dead zone 1 mm (6 px), `slideCurve` **1.0** (try 1.15 if it is still twitchy).
- Activation zone as in Point. Keep `followHome`. Draw the home tick so neutral is visible.
- Auto drift: `driftSteer` 0.8 becomes **0.95**, plus a 0.12 s hold on analog sources too.

### 4.4 Cross-cutting
- **Sensitivity** must scale the **throw** (full-lock distance ÷ sens, and the button ramp rate × sens), never the output. Full lock must always be reachable.
- **Right-hand cluster:** BRAKE 13 mm (82 px) round, ITEM 11 mm (70 px), 4 mm apart, bottom-right, 4 mm + safe area from the edges. Hit slop +4 mm beyond the drawn shape. Nitro, if separate, goes above ITEM in the thumb arc.
- **Haptics (Android only):** `navigator.vibrate(10)` on drift start, 15 ms on item pickup or use, 30 ms on heavy impact (above the trauma threshold), with a settings toggle and feature detection. iOS gets no haptics; do not use the switch hack mid-drag. Use an audio tick instead.
- **First launch default:** `point` with camera `auto`. The existing first-run picker (`controlsPicked`) offers only three big cards with a looping 2 s preview: **Point (recommended)**, **Buttons**, **Swipe**. Tilt goes under "More". Hint copy: "Put your thumb down and point where you want to drive."
- **Measure:** log the scheme, wall or off-road seconds per lap, the number of scheme switches and the first-race finish rate (Playgama telemetry or an internal counter). Then compare Point and Buttons after a week.

### 4.5 Implementation plan (files)
1. `src/config.ts` (CONFIG.controls): add a `point` block (values from 4.1), new slide units (`slideFullPx`, `slideDeadPx`, `slideCurve 1.0`), `driftSteer 0.95`, `driftHoldS 0.55`, `analogDriftHoldS 0.12`, button progressive-ramp constants and a `haptics` block. CONFIG.render.camera: `rotFollowLandscape 4`, `rotMaxRateLandscape 1.2`.
2. `src/input/schemes.ts`:
   - Set `CONTROL_SCHEMES = ['point','buttons','slide','tilt']` and `DEFAULT_SCHEME = 'point'`.
   - In `controlsOr()`, map legacy `joystick` to `point` and `tap` to `buttons`.
   - Add pure functions `pointAim(dx, dy, R, wasActive)`, `screenToWorldHeading(dx, dy, viewAz, tilt)`, `pointSteer(err, angVel, prevSign)` and `pointDriftRequest(err, heldS)`.
   - Add a `touchLayout('point')` case and the large hit-zone rects for buttons.
   - Change sensitivity to scale the throw.
3. `src/input/input.ts`:
   - Add a new pointer kind `point` with a floating base and leash, smoothing and release grace.
   - Output `aim?: {x, y} | null` (screen vector) instead of a steer.
   - Fix `steer = tSteer * sens`.
   - Add the progressive button ramp and hit zones.
   - Draw the ring, knob and ghost chevron state.
   - Add haptics calls behind a helper.
4. `src/types.ts`: add optional `aim?: { x: number; y: number }` to `CarInput`.
5. `src/game.ts` (player input path, before `assistedInput`):
   - If `aim` is set, compute the target heading with `renderer.viewAz/tilt` and the steer with `pointSteer` from the player `CarState` (`angle`, `angularVel`), and set `drift` from `pointDriftRequest`.
   - In `applyCamera()`, enable rotation in landscape for relative schemes.
6. `src/render/camera.ts` / `renderer.ts`:
   - Expose `viewAz` and `tilt` getters through the renderer.
   - Add a `rotateLandscape` flag that bypasses the aspect fade and uses the landscape rate limits.
   - Draw the target-heading chevron (`render/playerMarker.ts`).
7. `src/meta/save.ts` and `src/ui/ui.ts`: set the default `controls: 'point'`, migrate legacy values, show the 3-card picker for `controlsPicked === false`, and add the Assist and Haptics toggles. `src/i18n.ts`: new strings.
8. Tests:
   - `tests/inputSchemes.test.ts`: aim dead zone and hysteresis, screen-to-world for az 0, 90 and 180 deg, steer law sign, 180 deg hysteresis, sensitivity never capping full lock, legacy-scheme migration.
   - `tests/camera.test.ts`: landscape rotation flag.
   - `tests/drift.test.ts`: no auto drift for a held button under 0.55 s.
