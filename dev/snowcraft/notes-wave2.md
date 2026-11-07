# Wave 2 integration notes

## State
- `npx tsc --noEmit` clean; `npx vite build` -> dist/index.html (405 kB).
- `tests/sim.test.ts` 40/40, `tests/world.test.ts` 163/0, `tests/e2e.mjs` ok (desktop+phone, no console errors).
- `tests/sheet-shots.mjs` needs `npx vite --port 5182` running; ok. `tests/world-shots.mjs` run for station/cape/beach/ship only (no errors); other zones not re-shot.
- In-game #selftest: 71/72. Only failure: `[sim] вода замерзает при −20 °C` (engine owner; passes headless, water freezes by hand in the live game, so it is probably the test's setup inside the running game).

## Glue changes
- main.ts: `setSplitFixturePass(true)` + emissive layer (z=5, 'lighter') calling `drawFixtureEmissive` for lit fixtures.
- sfxhooks.ts: wind passed in m/s (`Math.abs(G.wind)`); music starts on first gesture; ambient and music are suppressed when the URL has `selftest` (otherwise the game overwrites the audio self-test's ambient state).
- touch.ts: belt radial moved lower (no overlap with the top-left HUD).
- light.ts: base ambient 0.026 -> 0.04 so interiors at night are less black.
- Already wired by agents: fixture lights via `collectLights`, audio self-test via glob import, draw.ts art in the layers.

## Works
Playable loop on desktop and phone: polar night sky/aurora, arctic world with stations, ship, beach, snow-block igloos, fat lamp, CO and warmth grading, body model, sleep, crafting, art for player/fixtures/icons, synthesized audio (not listened to by anyone).

## Missing vs DESIGN.md
- Fauna (animals, harpoon/fishing/snare events) not implemented; bus events have no producers/consumers. Call `setFishingFallback(false)`/`setSnareFallback(false)` when it lands.
- Drifting sea ice behaviour (`worldInfo.iceField` not used by weather/drift).
- Quests/objectives, saving, title screen, real inventory/journal UI (C panel is the dev one), desktop Q radial, settings (volume/music) UI.
- Vent heat model is too costly (1-tile roof vent cools the whole column).
- Door sizes in world stations (1x5 tiles) too narrow for the 8-cell player; doors need >=3 tiles.
- Interiors still dark at night; kennel/cart/barometer/flag/mast/signal_fire sprites are placeholders in the viewer only.

## Open bugs / unverified
- Audio never audibly checked; iOS resume untested.
- Phone belt-radial layout not re-screenshotted after the move.
- Dog sit/seal dive frames and fallen mast art are rough.
- No FPS measurement (owner measures on a phone).

## UI / visual / world fixer (wave 2)

### Fixed
- **Doors (critical)**: station house and shed doors are 6 tiles high (lintel moved up to F-7, door sprite redrawn 4x24); the 8x20 player walks through all three. Cause was only the height (the doorway is a 4-cell-thick wall, so width never mattered): the 5-tile opening left 18 free cells under the stone lintel. Regression: e2e step "walks through every station / shed door" + selftest `[ui] двери...`.
- **Title, continue, save (critical)**: `src/ui/title.ts` (live polar-night backdrop with aurora, moon and a lit lamp; Продолжить / Новая игра + difficulty + hardcore / Самотест; skipped with `?title=0`, `#selftest` and in automated browsers via `navigator.webdriver`; `?title=1` forces it), `src/game/save.ts` (IndexedDB slot, gzip of mat/aux/flags/bg + JSON state, version field, own `slot` argument for tests; autosave every 30 s of play, on tab hide and after sleep; hardcore death deletes the slot). main.ts: `StartOpts.save`, `applySave()` before the sim caches, `applyQuestAgain()` after `new_game` (quest.ts resets itself on that event and wiped the loaded objectives, found by test).
- **HUD (major x3)**: `src/ui/devhud.ts` rewritten: body figure with frost tint per head/hands/feet/torso, thermometer, drop / ration / bolt / heart bars, wet and CO alerts; semicircle sun dial with the sun's daily path, moon phase, wind arrow, barometer arrow + forecast, storm flag; objective line (from the new quest.ts); one top-centre flow (objective, shelter chip, toasts) so nothing can overlap; belt with icons, count badge top-right, name only for the active slot (snow density in the label); desktop hint bar 13 px on a panel with key caps; phone: compact HUD, belt collapses to the active slot, tap opens the radial. Old numeric readout behind `?devhud`. Fonts: Pixelify Sans and Jura were never loaded (system fallback!), now imported from @fontsource. Pixelify's Cyrillic is hard to read at 12-14 px, so numbers / headings / buttons use Pixelify and sentences (objective, toasts, tooltips, recipes, journal) use Jura.
- **Bag + craft panel**: icon grid (belt + 18 pack slots), clothing slots with icons (the start kit IS worn: the empty "Одето" row in the shot was not reproducible; empty slots are now drawn), weight bar, recipes grouped Огонь / Еда и вода / Одежда / Охота / Стройка with ingredient icons per variant (the two fat-lamp recipes are now distinguishable), fine-work icon, station tag.
- **Journal (J / M / Журнал button)**: goals checklist, found sites, log (storm reports, notes). Map and the desktop Q wheel are not implemented.
- **Touch**: radial is an arc above the belt chip (50 px slots, no full-screen dim, outside tap / selection / 7 s idle close it, caption), floating-stick ghost ring + hint on first launch, `primary = actionHeld || aimed` (releasing Действие no longer stops an aim-hold), rotate-overlay only undoes its own pause.
- **Light**: night ambient raised (0.07+), solid floor 0.2, cool moon/aurora rim on solid edges facing open sky (rock edge vs night sky 8:1 in `[ui]` selftest), blue interior fill for enclosed air (rooms, igloos, tunnels: the station, hut and adit are readable, voids are dim textured wall not black). Storm: fog thins out around the player (short-range clear pocket) so the shelter stays findable.
- **World**: cairn is a squat boulder heap with a marker pole (no spruce-like cone); adit gets frost (ice crust and icicles under real rock only, frosted back wall, sleepers heaved/missing), one portal timber frame instead of two; rock strata (hardrock bands, patchy ice lenses) under every cliff; ice wedges shallow and away from the station pad (no hanging "icicles"); lichen crusts on cape ledges; coal sparkles; ship gets pack-ice pressure ridges at both ends, a wooden deckhouse (window, stove pipe, snow roof) and frayed sail strips instead of a blue curtain.
- **Icons**: radio_triode (glass bulb + pins), radio_coil (horizontal copper coil), tea (green tin) vs hot_tea (steaming cup), fox fur (orange + white tip), sealskin, bear fur (dark shaggy), log (end rings) vs plank (grain, nails); new ui icons drop / food / bolt / warn.
- Tests: `src/ui/ui.selftest.ts` (6 checks), e2e door step; tsc clean; world.test 163/0, sim.test 40/40.

### Not fixed / notes
- Igloo silhouette: the arch comes from `testkit.igloo` (6 straight rows + corbel) used by the e2e screenshot, not from a sprite; a 3-row dome broke the vent test, so unchanged. Player-built domes use the tool's dome mode.
- "Lighter slab beside the igloo" is `S.arena()` (flat density-300 test ground), not a sim-window rendering bug.
- Station: no warm window glow, shed not differentiated; tooltip "range ring" and first-use smart-cursor hint not done; desktop Q wheel and journal map not done.
- Language selector on the title: no translation packs exist, so not offered.
- Possible follow-up for the gameplay owner: `quest.ts` resets on `new_game`; main.ts now calls `applyQuestAgain` after it, a cleaner fix is to skip that reset when `peekLoaded()` is set.

## Wave 2 fix pass: gameplay / code / audio (fixer A)
Files: new `game/fauna.ts`, `game/drift.ts`, `game/quest.ts`, `game/overlay.ts`, `game/starter.ts`, `game/runreset.ts`, `game/fauna.selftest.ts`; edited `main.ts`, `game/{inventory,player,tools,fixtures,sfxhooks,core.selftest}.ts`, `engine/{heat.ts,sim.selftest.ts}`, `tests/{e2e,world-shots}.mjs`. Tests: tsc clean, `tests/sim.test.ts` 40/40, in-game selftest 89/89 under `#selftest` (see e2e), e2e desktop + phone no console errors.

### Fixed
- **Fauna (pillar 3)** `fauna.ts`: Север (follows, sits/sleeps beside you and warms you in sleep, barks 30-60 s before the bear is in frame and wakes you, needs fish/meat once a day, E = feed or stay/follow); 12 seals at the breathing holes (surface for 7-15 s, dive on noise/movement/digging, harpoon kills a surfaced one: 6 meat, 4 fat, 2 skins; hole empty for a game day); arctic fox robbing loose food at night; ONE polar bear driven by a 1-D scent field along x (deposited by you / food / fat / lit lamp, advected by `G.wind`, decays): wander -> curious -> stalk -> charge, or siege of a snow shelter (breaks snow blocks/packed/loose, not logs/planks/stone/bone/ice) -> flee. Deterrents: lit fire/torch, flare, wounds, dog. Passive until day 2; `G.diff.wolves` scales it. Drops fur/meat/fat when killed. Audio and on-screen cues wired (`sfxhooks.ts`, `overlay.ts`).
- **Drift (pillar 3)** `drift.ts`: floes move as groups by whole tiles (snow, ship, fixtures, drops, animals, player and seal holes ride along), 9 s of crack glow + groaning + shake first, lead opens behind, ridge of piled ice when the pack is jammed, leads refreeze (new ice grows 1 cell / ~2 game h in frost), new ice <= 2 cells (also under a snow bridge) cracks and breaks under the player. Save keeps the drifted layout (`questSave().drift`).
- **Objectives / endings** `quest.ts` (API the HUD already imports: `objective, initQuest, prog, journal, questSave, questLoad`): stove -> barometer -> shelter 2 stars -> supplies gauge, then seal fat, driftwood, ship, radio parts, mast, fur; site discovery (`site_found`); `radio_fixed` -> icebreaker +2 game days, light the signal fire on the cape hill while it is in sight (36 game h, else it comes back 2 days later) -> `ending {icebreaker}`. `overlay.ts`: ending card with run stats (dawn and icebreaker), "new run" button on the hardcore death card, sound-off cues (dog, bear, ice, wind roar, shiver, seals).
- **Snow knife start**: wind-packed drift (250-340 kg/m3) 34-70 cells east of the spawn (`starter.ts`), failed cut toasts "Снег рыхлый — ищи плотный наст…", probe line is green/amber/red.
- **Bugs**: backpack never merges and never expires (+ sled load goes into it, 2 deaths keep both); sled can be parked (G with tool/empty hand), E re-hitches, parked sled survives respawn; pot takes shovel snow per bag (8 cells = 1 snow) with a cap of 6, pickup returns pot snow/ice and unburnt fuel (logs / fat); drum with diesel is not converted to a brazier; `stash()` refreshes the UI; `resetRun()` clears per-run state (held, flares, fish, dropDur, backpacks, stats, sled, freecam) and respawn clears warnings/sleepFix; NaN guards in `stepBody`; v1 ore drops (copper/iron) removed from the dig table.
- **Water freezing selftest** (was the one red `[sim]`): not an engine bug. The in-game scenario never stepped heat, so latent heat of freezing stayed in the tile and stopped the freezing; now `run(1, true)` for 60 s (the headless test did the same). e2e no longer ignores `[sim]` failures.
- **Vent heat**: a sky-open tile boxed in by non-sky tiles left/right (roof vent shaft) now relaxes to ambient at 8 % (`SHAFT` in heat.ts). Measured igloo with lamp at -32: vent costs ~2 °C instead of ~12 °C, CO still falls (7.6 vs 18 and rising).
- **Cold pacing**: `L0` 0.07 -> 0.075 (standing in the open at -35: 37 -> ~35.6 in 90 s, hands/face frostnip inside ~60 s, dead in ~4 min) and up to 5 sim steps per frame (was 3) so slow frames no longer run the game in slow motion. Going further breaks the campfire self-test (cliff at ~0.076); its threshold moved 33.8 -> 33.3.
- Housekeeping: stale v1 screenshots moved to `shots/archive-v1/`; `world-shots.mjs` clears its own outputs and defaults to 6 representative zones (`--all` for 24).

### Not fixed / for other owners
- **Originality (critical)**: I cannot see the two reference games, so I did not cut anything on that basis. Still the standard grammar: 6-slot belt + 18 pack, durability tools, pick-and-mine, craft tables, a timbered coal mine. Needs the owner to name what was copied; the mine/ore layer lives in `locations.ts` / `recipes.ts` (world fixer). v1 materials (LAVA, CRYSTAL, COPPER, IRON, furnace/anvil/helipad kinds) stay in the contract files; they are never generated (`world.selftest` asserts no lava/ore) and no longer have drop mappings.
- Fish/snare still use the fallback bite/catch timers (`setFishingFallback` / `setSnareFallback` left ON): no ptarmigan or cod entities exist.
- Not saved: animal state (dog/bear/seals/fox restart on Continue), dog hunger.
- Audio never listened to by a person. Substitute: `[audio]` self-test renders every cue offline (no NaN / silence / clipping, passes); fauna cues are volume-scaled by distance; on-screen captions cover the sound-off case. Real-device listening and iOS resume still open.
- Software-GL fps (3-16) not addressed (render scale is in `render.ts`, owner of render).
- Recipe panel grouping / nearest-table marker (HUD owner). `tests/world.test.ts` shows 6 failures in the mine (rails, portal walk, bulkhead, structure of mine) caused by the concurrent `locations.ts` edits, not by this pass.
