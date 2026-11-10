# SNOWCRAFT · cover and screenshot brief

For the artist or the publishing chat. Facts below come from the code (palette from `src/art`, `src/ui/title.ts`, `src/ui/touch.ts`, `src/engine/sky.ts`) and the coordinates from `src/game/locations.ts` as they stood on 2026-11-10. Coordinates move when PG1 and PG2 land, so re-check them before shooting.

## 1. Art direction

- Mood: quiet, cold, beautiful, a little lonely. Polar night, moonlit snow, aurora, one warm light in the dark. (DESIGN.md header, "Tone".)
- Core contrast: cold blue-grey snow and sky against one warm amber window or fire. Warm light is reserved for flame and lamplight, so it always reads as a human place.
- Style: pixel art, readable at thumbnail size. Big shapes, few colours per shape, clear silhouettes (the igloo dome, the station roof, the husky, the bear).
- No trees anywhere (DESIGN §0 "visual identity"). Do not draw forest or cave ore: the game must not read as a mining sandbox.

### Palette (taken from the game)

| Role | Colours in the code | Where |
|---|---|---|
| Night sky, deep background | `#0b1220`, `#05080f`, `#1b1726` (most frequent dark tone) | title background, theme-color, touch overlay |
| Ice-blue lines and glass | `#7cc6ee`, `#dff0ff`, `#e8f6ff` | UI borders, title text |
| Snow and ice | `#c9ced6`, `#9aa4b4`, `#7c8798`, `#ffffff` | snow, shadows on snow |
| Wood, timber, cabin | `#c9a77a`, `#a67a4c`, `#5a3a22`, `#8e5f38`, `#7d5f42` | driftwood, station walls, planks |
| Fire and lamp light | `#ffe9a0`, `#ffc46e`, `#ffb040`, `#ff9a2a`, `#f4cf5a` | flames, lamps, window glow |
| Red accent | `#d8362a`, `#e4492d` | small accents only (flag, warnings) |

Aurora: green and magenta bands in the sky (`src/engine/sky.ts`). Use them only in night scenes, as the one saturated colour in a cold image.

## 2. Required assets

Sizes and formats are not fixed here. The publishing chat must read them first with `get_game_checklist` (requirements) and the cover upload docs that `start_cover_upload` returns, and the store-covers skill, before it makes any file. Do not guess sizes.

| Asset | Count | Notes |
|---|---|---|
| Cover (main) | 1 | Title SNOWCRAFT, no other text except an optional tagline in English |
| Landscape screenshots | 8 | Scenes in section 3 |
| Icon or square thumbnail | 1 | Igloo with a lit window on night snow; works at 64 px |
| Phone-size screenshots (844×390 landscape) | 3 | Taken from the same scenes, show the phone HUD |

Text on the cover: the title only. Keep any tagline out of the image, because the store text carries it and the image needs to be shown in every language.

## 3. Eight screenshot scenes

For each: how to reproduce it with the dev API (`window.__sc`, see `src/main.ts`), the coordinate source, and what must be visible. Open the game as `index.html?title=0` (skips the title screen) for scenes 2–8, and with `?title=1` for scene 1. Set the language to English in the settings before shooting (`P` → language).

Dev API names that exist in `src/main.ts`: `teleport(x,y)`, `setTime(min)`, `setDay(d)`, `setWeather(o)`, `give(id,n)`, `place(id,tx,ty)`, `craft(recipe)`, `act(kind,x,y,seconds)`, `sleep`, `stats()`, `zoom`, `setQuality`, `freeCam`, `senses`. Check the exact argument shape in `main.ts` before scripting, because `setWeather` takes an object.

| # | Scene | How to reproduce | Coordinates (locations.ts) | What must be visible |
|---|---|---|---|---|
| 1 | Title screen: live polar night | open `?title=1`, wait 2 s | title backdrop is drawn by `src/ui/title.ts` | title SNOWCRAFT, aurora, moon, lamp in the igloo, "New game" button |
| 2 | Building an igloo at night under aurora | `teleport(692,272)` (spawn; the planned new spawn is x≈410, from-scratch.md), `setTime` to midnight, `give snow_block 12`, place blocks in a dome | spawn x 692, y 272 | a dome of cut snow blocks, moon, aurora, the player holding a knife or shovel |
| 3 | Storm exam on a shelter | `setWeather` to a storm (see `src/game/weather.ts`), `teleport` into a finished igloo, wait a few seconds | igloo near the station | blizzard streaks, snow on the dome, the shelter rating card |
| 4 | Seal hunt at a breathing hole | `teleport` to fast ice, stand still by a hole | fast ice x 1100–1450 | flat ice with a dark hole, snow, the harpoon in hand. No blood. |
| 5 | Station at dusk, lamps on | `teleport(700,272)`, `setTime` to evening, put fuel in the stove (`give coal 8`, `act` on the stove) | station x 556–880, y 272 | warm windows, roof pipe smoke, snow drifts up to the eaves |
| 6 | Wrecked ship «Заря» in the pack ice | `teleport(1752,~300)` (ship x 1752) | ship x 1752 | listing hull frozen in ice, aurora or moon, one light |
| 7 | Inventory and crafting (desktop) | open the inventory with `I`, select a belt slot | UI | belt, bag grid, wear slots, crafting list. Use English text only. |
| 8 | Phone landscape HUD (844×390) | viewport 844×390, touch | any calm place | belt, stick, action button, body figure. No overlapping elements. |

Scene 4 and scene 6 are the two that show the living world, so give them priority if only five screenshots are possible. Scenes 1, 2, 5 and 8 are the core set.

## 4. What must NOT appear

- Debug and developer UI: the `devhud` key-hint box, FPS or counter overlays, the self-test overlay, the `__sc` console output, `#selftest` banners.
- Any Russian text. Set English before shooting, and check every toast and menu label in the frame.
- Any brand, logo, game or company name other than SNOWCRAFT (no Terraria, Noita, Minecraft or platform names; the Playgama name is not allowed in the art either).
- Blood, wounds or the bear attacking in close-up (rule 4.1.1 and partner platform rules). A bear at a distance is fine.
- Trees, forest, ore or lava. These break the visual identity.
- Emoji or emoji-like icons in the interface (rule 4.3.2).
- Empty frames: a shot must show the player or a clear object.
- Anything that looks like a generated template (default UI, stock gradients). Hand-check each shot.

## 5. Process

1. Shoot the 8 scenes with the dev API at desktop 1600×900 and phone 844×390, English language, no debug overlays.
2. Let a human pixel artist refine at least the cover and the icon. This matters for rule 4.3.1 (see risks.md R7). Refinement means hand-drawn detail on top of the procedural art, not a re-render.
3. Check each image against section 4 before upload.
4. Upload only after the owner says yes (see owner-decisions.md). The publishing chat must not upload covers on its own.
