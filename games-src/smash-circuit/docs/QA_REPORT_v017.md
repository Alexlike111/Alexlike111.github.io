# Smash Circuit v0.1.7 - QA / critic report

Build under test: `/home/user/Alexlike111.github.io/play-test/smash` (label `v0.1.7 . 2026-11-05 00:05 UTC . 501c51f`), served by `python3 -m http.server` on :4173 with `?debug`.
Source: `/home/user/Alexlike111.github.io/games-src/smash-circuit` (HEAD 7d06bdf). No project file was edited.
All scripts and screenshots: `/tmp/claude-0/-home-user-Alexlike111-github-io/f766eee6-510c-5cad-ac1c-ed0b422a6ec1/scratchpad/qa/` (shots in `shots/`, abbreviated `S/` below).

## Method and honest limits

- Devices: iPhone 13 portrait (Playwright viewport 390x664, the Safari-with-toolbars worst case), iPhone 13 landscape (750x342), Android 360x640 portrait (+640x360), desktop 1280x720 / 1024x576 with keyboard.
- Input: real touch through CDP `Input.dispatchTouchEvent` and `page.touchscreen.tap` (buttons, slide, joystick, two-side tap); real keyboard on desktop; real UI taps for menu, picker, pause, garage, settings.
- Coverage: first launch, control picker (all 5 cards), tutorial (touch + keyboard), 3 full races (Green Valley, Dust Canyon, Frost Pass; desktop keyboard autopilot), results, garage (car / upgrade / paint tabs), upgrade tab, settings, pause, restart two-tap, EN/RU switch, persistence across reload, 8x start/quit stress loop, rotate/resize mid-race.
- Limits: Chromium runs on SwiftShader (software GL): **3.5 fps desktop, about 10 fps phone**. Frame-rate and "lag" numbers are meaningless here, and a CDP-touch driver cannot steer a car at 10 fps, so the full races were driven by an in-page keyboard autopilot (pure pursuit + corner brake) at time scale 2. That bot drives like a mediocre beginner, so "finished last" is a weak signal. Audio cannot be heard headless. Tilt cannot be exercised headless.
- Console: **zero errors and zero page errors** across all runs (only the harness-induced "GPU stall due to ReadPixels" warnings from screenshots). JS heap flat at 10 MB over 8 race start/quit cycles. The three full races completed to the results screen. Save persisted across reload (money, controls, language; `sc_core` in localStorage fallback).

## Verdict

Score: **6.5 / 10**. A polished, readable, charming portrait-phone game with solid controls and zero crashes, held back by a broken landscape-phone layer (tutorial and garage), several HUD collisions on small screens, stale control copy, and an early economy/difficulty curve that punishes the exact player it should hook.

## Issues, ranked by severity

### 1. HIGH - Landscape phone: garage panel is a 47 px peephole, upgrades and stats unreachable
- Repro: iPhone 13 landscape (750x342) -> Garage -> UPGRADE tab (or CAR tab). Only the ENGINE row (UPGRADE) or the perk text (CAR) is visible. TYRES, ARMOR and the whole stat grid sit inside a scroll pane that is 47 px tall (`.g-pane` scrollHeight 173 / 91 vs clientHeight 47) with no scroll cue. Swipe is the only way. On the CAR tab the stat bars are a clipped sliver.
- Screenshots: `S/iphone-l-f3-buttons-09-garage.png`, `S/iphone-l-f3-buttons-10-tuning.png` (compare the fine portrait layout `S/android-f3-slide-09-garage.png`).
- Suspect: `src/ui/garage.css` (`.g-pane` rule at line 58, the short-height media block around lines 85-116), panel layout in `src/ui/garage.ts`. The car-header block + 10-car chip row eat the 342 px and leave the pane nothing.

### 2. HIGH - Landscape phone: tutorial sheet is unreadable and hides the whole grid
- Repro: fresh save, iPhone landscape, PLAY -> track -> pick controls -> PLAY. During the countdown the 4-step sheet renders each step in a ~110 px column, text wraps one or two words per line ("Gas is / automatic. / Hold the / left or / right / arrow to / steer"), step 3 overflows its card top and bottom, and the sheet sits mid-screen covering the player's car and all rivals on the grid.
- Screenshot: `S/iphone-l-f3-buttons-05-countdown-tutorial.png`.
- Suspect: `src/ui/ui.css` lines ~592-595 and 625-641 (landscape/short-height tutorial rules: `.tut-steps` row, `.tut-step` single-column grid), markup in `src/ui/ui.ts` `showTutorial` (line 378). The comment at ui.css:596 says it should sit at the top under the timer; it does not.

### 3. HIGH (economy / first-minute) - Repair costs more than a bad race pays; first upgrade is 3 to 4 races away
- Repro: any race where the car gets hit. HUD shows the repair pill ("STOP 83", "STOP 105", "R 289" on Frost Pass with 300 coins in the wallet). Place prize for 8th is +60 (reward +72 to +93 with smashes). First upgrade costs 250 and upgrades are per car, so the starter spends 3 to 4 races for one engine level, and a repair eats the same. This is the old audit item A10 still present.
- Evidence: `S/auto-t3-3.png` (R 289), `S/iphone-sch-joystick-steerR.png` (STOP 83 after 3 s), results text in `auto-t1.log`/`auto-t2.log` (8th = +60 / +84), `S/iphone-f2-13-tuning.png` (250 each).
- Suspect: `src/meta/economy.ts` (repair cost curve, upgradeCost, place prizes), `CONFIG.economy` in `src/config.ts`.

### 4. HIGH (needs a human to confirm) - Early difficulty: a mediocre driver finishes last everywhere and takes damage in the first seconds
- Repro: start Green Valley with any scheme, hold course. Player starts 6th of 8 in a packed grid; in 5 of 5 first-attempt bot starts the car took heavy contact damage (hp 0.40 to 0.77) and was 8th inside 10 s. With corner braking the autopilot still finished 8th on all three tracks (min hp 0.35 / 0.34 / 0.26). The "finish top 3 to unlock the next track" gate (see issue 12) therefore may feel out of reach to a casual first-timer; the design doc promised a winnable first race (D8).
- Caveat: bot, not a human; slow software GL.
- Evidence: `S/iphone-iphone-buttons-t1-stuck1.png`, `S/auto-t1-end.png`, `S/iphone-race-2500.png` (player boxed in at 61 km/h, 0:01.46).
- Suspect: AI tuning `src/meta/opponents.ts`, `src/sim/ai.ts`, grid placement in `src/sim/race.ts`/`world.ts`.

### 5. MEDIUM-HIGH - Stale/wrong control copy: "DRIFT and BRAKE on the right"
- Repro: control picker, Settings -> Controls, Pause -> controls strip (BUTTONS card). The text promises a DRIFT button that does not exist (drift is automatic; the tutorial step 2 and the code comment in `src/input/schemes.ts` say so). Same in Russian ("ДРИФТ и ТОРМОЗ справа").
- Screenshots: `S/iphone-picked-track-1000.png`, `S/iphone-f1-settings.png`, `S/iphone-f2-07-pause.png`.
- Suspect: `src/i18n.ts` line 131 (`ctl.buttons.d`, EN) and line 372 (RU).

### 6. MEDIUM - HUD collisions on small phones (speed pill vs player car, slide ring, "Drift lost!", version tag)
- Repro A: portrait phone, rotating camera, any race. The bottom-centre speed pill ("114 km/h") covers the rear of the player's own car and the cars right behind it (`S/iphone-race-4000.png`, `S/iphone-iphone-buttons-t1-stuck1.png`).
- Repro B: Android 360x640, SLIDE scheme: the speed pill sits on top of the slide ring/knob (`S/android-f3-slide-06-go.png`).
- Repro C: JOYSTICK, "Drift lost!" floating text collides with the pill and the car crashed under the stick (`S/iphone-sch-joystick-steerR.png`).
- Repro D: build/version label overlaps the left steer button on 664 px-high phones (`S/iphone-race-4000.png`). Also "Last -- Best --" under the timer sits on the checkered start banner and is hard to read (`S/iphone-sch-tilt-hud.png`).
- Suspect: `src/ui/ui.css` lines 346, 373, 485-488 (`.hud-bc` anchors via `--btn-top` / `--joy-top`), camera framing of the player in `src/render/camera.ts` (car sits too low in rotating mode), `#ver` in the built `index.html` (z-index 50, not hidden in race).

### 7. MEDIUM - Settings screen: large dead gaps hide Sound/Graphics/Camera/Rivals below the fold; panel is see-through
- Repro: Settings on 360x640 / 390x664. About 120 px of blank space between Language and Controls and another ~140 px between "Controls" and its card grid; the first screen shows only Language, Controls, sensitivity. The Sound toggle is the fourth section and needs scrolling. The panel is translucent, so the 3D menu car shows through the text.
- Screenshots: `S/android-f3-slide-11-settings.png`, `S/iphone-f1-settings.png` (scrolled view `S/iphone-f1-settings-ru-bottom.png` is fine).
- Suspect: `src/ui/ui.css` lines 253-255 (`.srow` flex-wrap gaps), the `.ctlgrid` row stretching, panel background alpha.

### 7b. MEDIUM - Audio controls are minimal and hard to find
- One global ON/OFF (no separate music / effects). On the main menu there is no mute button; it lives in Settings (below the fold) and as an unlabeled speaker icon in the Pause card. Desktop `M` does nothing (verified: `muted` stayed false).
- Screenshots: `S/iphone-f1-settings-ru-bottom.png`, `S/iphone-f2-07-pause.png`.
- Suspect: `src/ui/ui.ts` line 937 (mute button), `src/input/input.ts` lines 71 and 507-509 (key map has no `M`).

### 8. MEDIUM - First-run tutorial hides the player's own car for the whole countdown, then vanishes at GO
- Repro: fresh save on a portrait phone. The bottom-sheet (about 30% of the height) is drawn right over the start grid and the player's car for the entire 3-2-1 countdown, so the player cannot find their own car; on touch the sheet hides at GO because `inp.throttle > 0` is always true with auto gas (`src/game.ts` lines 603-606), so there is no real time to read 4 tips.
- Screenshots: `S/iphone-race-300.png`, `S/android-f3-slide-05-countdown-tutorial.png`.
- Suspect: `src/game.ts` lines 282-283 and 603-606; `src/ui/ui.css` lines 530-536 and 636-641.

### 9. MEDIUM (unverified on device) - TILT scheme: could not be exercised, and the fallback hides itself silently in headless
- Repro: choose TILT, provide a CDP `DeviceOrientation` override: the game fell back to arrow Buttons (L/R/BRAKE visible) and steer stayed 0 for gamma = +/-20. Probably headless-only (no real sensor), but the fallback path replaced the player's chosen scheme and persisted `controls: 'buttons'`. Needs a real iOS (permission prompt) and Android check.
- Evidence: `schemes2-iphone.log` (tilt rows), `S/iphone-sch-tilt-hud.png`.
- Suspect: `src/input/input.ts` lines 347-372 (listener attach, `tiltCheckMs` timeout), `src/game.ts` lines 444-450 (`onTiltStatus` rewrites the saved setting).

### 10. MEDIUM-LOW - Garage polish on 390x664
- The 3D car preview is cut off by the info panel (rear half behind it) in CAR and UPGRADE tabs; "Races: 1 Wins: 0" is white-on-bright-green with cones behind it (low contrast); the three stars next to the body type are never explained; the UPGRADE tab shows only price, no stat delta (what does ENGINE 1/5 give?); 10-car chip row is cut at "GLINT" with no obvious scroll cue; the TILT card in the picker/settings has a title-to-text gap that makes it look misaligned.
- Screenshots: `S/iphone-f2-12-garage.png`, `S/iphone-f2-13-tuning.png`, `S/iphone-f1-garage-ru.png`, `S/iphone-picked-track-1000.png` (Tilt card).
- Suspect: `src/ui/garage.css`, `src/ui/garage.ts`.

### 11. MEDIUM-LOW - Desktop conventions: Esc does not pause, M does not mute
- Repro: desktop, mid-race, press Escape: state stays `racing`. Only `P` pauses (works, also auto-pauses on tab hidden, which is good).
- Suspect: `src/input/input.ts` lines 71 (key whitelist) and 507-509.

### 12. LOW-MEDIUM - Flow: dead end after a bad first race
- Repro: first race, finish 8th -> RACE FINISHED (neutral wording, "8TH PLACE") -> CONTINUE returns to the plain main menu. No "next goal" ("finish top 3 to unlock Dust Canyon" is only on the lock cards two taps away), no nudge to spend coins in the Garage, "RACE FINISHED" heading is the same for 1st and 8th. Also PLAY on first launch opens a track list with two locked tracks before the first race, not straight into race 1 (GDD A5/D8 said one tap).
- Screenshots: `S/iphone-f2-09-results.png`, `S/iphone-f2-11-after-continue.png`, `S/iphone-after-play-1200.png`.
- Suspect: `src/ui/ui.ts` `showResults`, `src/game.ts` continue handler.

### 13. LOW - Control picker modal bleeds through the page behind it
- In landscape the "CHOOSE YOUR CONTROLS" card is translucent and slightly overlaps the "CHOOSE TRACK" title; track card text ("FROST PASS", "Finish top 3 on...") is readable through it next to the JOYSTICK card.
- Screenshots: `S/iphone-l-f3-buttons-04-picker-sel.png`, `S/android-f3-slide-04-picker-sel.png`.
- Suspect: `src/ui/ui.css` lines 514-522 (`.ctlpick` background alpha).

### 14. LOW (needs human repro) - Possible wedge on Frost Pass hairpin
- The keyboard autopilot sat at 0 to 5 km/h next to a rival at the first hairpin from sim t=17 s to t=54 s (progress 214 to 339 m) while the "R $289" repair pill showed. `stuckResetAfter` is 4 s, so a reset should fire; it may have re-wedged. Not reproduced with a human.
- Screenshots: `S/auto-t3-3.png`, `S/auto-t3-4.png`.
- Suspect: `src/playerReset.ts` (`StuckWatch`, `pickResetPose`), `src/config.ts` lines 520-523.

### 15. LOW - Browser Back during a race leaves the page
- Repro: mid-race `history.back()` -> `about:blank`; no beforeunload/history trap, race lost silently. Platform-dependent (Playgama wrapper may handle it).

### 16. LOW - Build label commit hash is one commit behind
- Label reads `501c51f` while HEAD is `7d06bdf`; harmless but confusing for QA triage.

## What works well (keep)

- Boot to menu in under 3 s, big clear PLAY/GARAGE/SETTINGS thumb targets, strong logo.
- All five touch schemes steer in the right direction and register brake/reverse (buttons, slide, joystick, two-side tap verified with CDP multi-touch); auto-drift engages ("Drift lost!" feedback visible).
- Pause is clear (RESUME, REPAIR, two-tap RESTART confirm "TAP AGAIN", QUIT, live control-scheme switch, sensitivity); auto-pauses on tab hidden.
- Rotation and resize mid-race re-layout the HUD without breaking (`S/android-rot-2-landscape-joystick.png`).
- EN/RU parity: all 231 keys present in both dictionaries, placeholders match, no clipped strings found in RU settings and garage.
- Save persistence (localStorage fallback) works across reload; no console errors; heap stable.
- Results card readable in both orientations and on desktop.

## Reproduction index (scripts)

- `bot.cjs`, `auto.cjs` (full-race drivers), `schemes2.cjs` (per-scheme touch check), `flow1.cjs`, `flow2.cjs`, `flow3.cjs` (UI flows per device), `desk.cjs` (desktop keys), `stress.cjs`, `rot.cjs`, `persist.cjs`, `gl.cjs` (landscape garage scroll metrics), `ru.cjs`; logs next to them (`*.log`).
