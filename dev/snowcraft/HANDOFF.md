> **Status at 0.14.0 (read first):** see `playgama/status-0.14.0.md` and `verify/snowcraft-v0.14.0.json`. The build is NOT ready for the sandbox: all sound is code-synthesized (Playgama rule 3.3.2) and the project's verify-build was not run. A DRAFT game already exists on Playgama (id `cmwajeosz1jkfog0hdkosflqm`, form filled, nothing uploaded or published): reuse it. The older text below was written while the platform work was still in progress; where it conflicts, the status file wins.

# SNOWCRAFT · handoff for the Playgama publishing chat

Single entry point. Read this file first, then the files in `playgama/`. Repo root: `/home/user/Alexlike111.github.io/dev/snowcraft`. Branch: `claude/gracious-newton-yc3hi1`. Snapshot: 2026-11-10 (last commit `52396c7`). Paths below are relative to the repo root unless they are absolute.

## 1. Pitch and current state

**SNOWCRAFT** is an original, endless survival sandbox set in the High Arctic. You wake alone on a frozen snowfield with a knife, then cut snow blocks, build an igloo, make fire, keep your body warm and hunt seals and birds. The polar night lasts 12 days, the twilight 6, and the cycle repeats forever. There is no win and no ending, only death. Snow is the building material, the cold is a body model (core, frostbite, thirst, hunger, sweat), the sea ice drifts, a polar bear follows the wind, and the husky Sever barks before danger. Controls follow a Terraria-style mouse scheme; the phone layout is landscape touch. The in-game language is Russian (source), with 9 translations: en, zh, hi, es, ar, fr, bn, pt, id.

**Current state.**
- The code runs as a single-file preview (`dist/index.html`, 1.9 MB). Versions of it are published as a claude.ai artifact (`https://claude.ai/artifact/YJqdCAESZMBFpc7kmNmsLw`). That link is a **preview only**, not the Playgama build, and it must not be presented as the store version.
- It is **not yet a Playgama submission**. Blockers: no Bridge SDK, sound generated in code (not accepted), saves in IndexedDB and localStorage, language from the browser, Esc key in use, six untranslated strings. Full list: `playgama/compliance-matrix.md` (summary at the top) and `playgama/risks.md`.
- Two agents are changing code right now: **PG1** (Bridge integration, save format, `build:pg` script, pack script `scripts/pg-pack.mjs`) and **PG2** (Esc removal, long-press, HUD mute button, layout audit). `package.json` is already being edited for `build:pg`. Check `git status` before you assume a file is stable.
- Tests at snapshot: `tests/sim.test.ts` 40/40, `tests/world.test.ts` 191/191, `tests/mine.test.ts` 20/20, `npx tsc --noEmit` clean.

## 2. What is in `playgama/` and what to do with it

| File | Purpose |
|---|---|
| `playgama/store-listing.md` | Title, category (simulation, reason and 2nd choice), short and long descriptions, features, controls table (PC and phone), tags, texts in all 10 languages |
| `playgama/cover-brief.md` | Art direction, palette from the code, required assets, 8 screenshot scenes with dev-API steps, what must not appear |
| `playgama/qa-checklist.md` | Manual QA per requirement group 1.x–4.x, desktop and phone steps, Playgama QA tool links |
| `playgama/compliance-matrix.md` | Every numbered requirement (1.1.1–4.4.1), the 8 Bridge required steps, partner platform rules, self-check; status with owner tags PG1/PG2/lead; "verify" where unknown |
| `playgama/risks.md` | Top risks, detailed R1–R20, unknowns, and the full sound inventory a sound designer needs |
| `playgama/owner-decisions.md` | Dated list of the owner's decisions D1–D28, with open questions |

Read `compliance-matrix.md` and `risks.md` before any upload. Read `owner-decisions.md` before asking the owner anything.

## 3. Repository map

| Path | What is there |
|---|---|
| `index.html` | Entry page. Title, meta tags, the module script `src/main.ts`. Bridge script goes into `<head>` (PG1). |
| `src/main.ts` | Boot, fixed-step loop, render layers, `window.__sc` dev API |
| `src/engine/` | Cell engine: `grid.ts` (world arrays, 2048×768 cells, 4-cell tiles, chunks), `sim.ts` (powders, liquids, gases, fire, melt, freeze), `heat.ts`, `structure.ts` (support solver), `bodies.ts` (falling clusters), `particles.ts`, `explode.ts` (unused in game), `render.ts`, `light.ts`, `sky.ts`, `sprites.ts`, `camera.ts`, `zoom.ts`, `input.ts`, `audio.ts` (synthesised sound, 95 names) |
| `src/game/` | Game logic: `state.ts` (global `G`), `worldgen.ts` + `locations.ts` (world layout), `player.ts` (body model), `tools.ts` (use item at cursor), `inventory.ts`, `search.ts` (container search), `fixtures*.ts` and `stationobjects.ts` (stove, campfire, generator, radio, bells, cart…), `fauna.ts`, `hunt.ts`, `weather.ts` (clock, storms), `seasons.ts` (ring math, ramp, record), `quest.ts` (goals, milestones), `overlay.ts` (death card, storm card), `save.ts` (IndexedDB slot, to move to Bridge), `items*.ts`, `recipes.ts`, `lore.ts` (26 notes) |
| `src/ui/` | `title.ts` (title screen), `menu.ts` (pause and settings), `bag.ts` (inventory), `devhud.ts` (HUD and goal line), `touch.ts` (phone controls and rotate overlay), `hudmode.ts`, `compass.ts`, `journal.ts`, `floater.ts`, `ui.css` |
| `src/content/` | `materials.ts` (cell materials), `i18n.ts` (strings and language switch), `lang/` (`_source.json` 1308 keys; `ar|bn|en|es|fr|hi|id|pt|zh.json` packs; `_parts/`, `_todo/` are translator work folders) |
| `src/platform/store.ts` | Storage seam: sync reads from a cache, batched writes to a backend. Bridge backend goes in `src/platform/bridge.ts` (PG1). |
| `src/art/` | Procedural pixel art (sprites, icons, fixtures, player, animals) |
| `src/dev/` | Dev viewer and sprite sheet pages (`tests/viewer.html`, `tests/sheet.html`) |
| `scripts/` | i18n tools (`i18n-dump.cjs`, `i18n-split`, `i18n-merge`, `i18n-topup`, `i18n-check`, `i18n-invalidate`), `artifact.mjs` (preview packaging). `pg-pack.mjs` is coming from PG1. |
| `tests/` | `sim.test.ts`, `world.test.ts`, `mine.test.ts` (headless, tsx); `e2e.mjs`, `ui-shots.mjs`, `world-shots.mjs`, `sheet-shots.mjs` (Playwright); `play/play3.cjs` (real-input play-through), `play/selftest.cjs` (in-game self-test runner); `balance/bot.cjs` (balance bot) |
| `*.selftest.ts` (in `src/`) | In-game self-tests, registered with `registerTest(group, name, fn)`, imported from `main.ts` |
| `DESIGN.md` | Authoritative design (§1–§20). §18 (endless), §19 (top principle), §20 (from scratch + physics) are the current decisions. |
| `SPEC.md` | Engineering contract (module map, i18n §10, self-test §11). Older than DESIGN where they differ. |
| `TERRARIA_CONTROLS.md` | Desktop control scheme and layout (belt 6 cells, Terraria mapping) |
| `design/` | `from-scratch.md` (start, first hour, recipes, goals), `noita-audit.md` (physics audit) |
| `playtest/` | Playtest briefs and findings; `playtest/v13/` is the latest with persona ratings and `FIXES.md` (groups X1–X3) |
| `tests/balance/report.md` | Balance bot results (targets not met, see §7) |
| `notes-wave1.md`, `notes-wave2.md`, `search/`, `shots/`, `docs/` | Older notes and screenshots (reference only) |
| `dist/index.html` | Preview build output (single file). `release/` will hold the Playgama archive (PG1). |

## 4. Build, run, test

Run everything from the repo root. Node and npm are on the machine. Install is done (`node_modules` present).

**Dev server.** `npm run dev` (Vite, port 5180). Open `http://localhost:5180/`. Add `?title=0` to skip the title, `?title=1` to force it.

**Type check.** `npm run check` (= `tsc --noEmit`).

**Preview build.** `npm run build` runs `tsc --noEmit` then `vite build`, output `dist/index.html` (single file via `vite-plugin-singlefile`, `assetsInlineLimit` set so everything is inline).

**Playgama build (PG1, not yet in repo).** `npm run build:pg`, then `node scripts/pg-pack.mjs`, which writes `release/snowcraft-playgama.zip`. The archive must have `index.html` and `playgama-bridge-config.json` at its root, Latin file names, and no `localStorage`, `sessionStorage`, `indexedDB` or cookie code. Check the bundle with grep before upload.

**Unit tests (headless, fast).**
- `npm run test:sim` (= `npx tsx tests/sim.test.ts`, 40 checks)
- `npx tsx tests/world.test.ts` (191 checks)
- `npx tsx tests/mine.test.ts` (20 checks)

**In-game self-test (the way a player runs it).**
- Whole run: `node tests/play/selftest.cjs /abs/path/to/index.html report.txt`
- One group: `node tests/play/selftest.cjs /abs/path/to/index.html - fauna ice`
- Phone size: prefix `VIEW=810x253`.
- The runner opens `?title=0#selftest` itself. Do not also call `__sc.selftest()` (two runs corrupt each other).

**Play-through with real keys and mouse.** `node tests/play/play3.cjs /abs/path/to/index.html /out/dir` (set `SHOTS=1` for screenshots, `DBG=1` for probes). It plays day one: coal, buried door, stove, barometer, log, blocks.

**End-to-end (Playwright, Chromium).** `npm run test:e2e` (= `node tests/e2e.mjs`, builds `dist` first). Flags: `--nobuild`, `--only=desktop`, `--noselftest`. Screenshots go to `shots/`.

**Screenshots.** `node tests/ui-shots.mjs` (UI, desktop 1600×900 and phone 844×390), `node tests/world-shots.mjs [zone]` (world zones via the viewer; starts Vite on 5181 itself).

**Playwright.** Not checked in this review. The scripts use `require('playwright')`, and `play3.cjs` suggests `NODE_PATH=/opt/node-tools/node_modules` when it is a global install. Verify the path on the machine before relying on it.

**Balance bot.** `node tests/balance/bot.cjs /abs/path/to/index.html --diff 1 --seed 1 --days 40` (diff 0 Мягкая, 1 Обычная, 2 Суровая). Prints one line per game day and a `RES {json}` line. Model and assumptions: `tests/balance/README.md`.

**FPS.** Not measured here. Cloud browsers have no GPU. Only the owner measures FPS on a real phone, through the self-test report. Do not write FPS tests.

**Playgama checks (read-only).** `get_local_game_qa_tool_link` for a local build, `get_archive_qa_tool_link` after an archive upload. Take the link from the answer; never build one.

## 5. Architecture in brief

1. **World**: 2048×768 cells (`src/engine/grid.ts`), tiles of 4×4 cells, a grid of 64×24 chunks (`CW`, `CHN`). Each cell has a material, a per-material scalar (`aux`: snow density, fire life, ember heat, ice crack) and flags. Sea level is about y 300.
2. **Simulation** (`sim.ts`): powders (snow, gravel, ash) fall and slide; liquids flow and find their level; gases rise and drift; fire spreads over flammables; snow melts near heat and water freezes at the surface; steam turns to snow in cold.
3. **Thermal** (`heat.ts`): coarse heat tiles with energy exchange; open sky to ambient, closed space to geothermal. Fires and lamps add heat. Wind exposure and shelter are computed per row.
4. **Support and falls** (`structure.ts`, `bodies.ts`): a Dijkstra-style solver checks whether blocks are held by something below or beside them; unsupported parts fall as rigid clusters.
5. **Chunk sleep**: chunks with no change are not stepped (`awake` flags, `wakeRect`). Keep new code inside that model.
6. **Rendering** (`render.ts`, `light.ts`, `sky.ts`, `sprites.ts`, `camera.ts`): layered canvas draw, light from fire and lamps, aurora and moon in the sky. `zoom.ts` keeps the choice as cells-across-the-width.
7. **Game state** (`state.ts`, global `G`): time (`weather.ts`, 1.2 game minutes per real second, a game day is about 20 real minutes), body (`player.ts`: core, hands, feet, face frost, hydration, food, energy, wetness, CO), inventory (`inventory.ts`: stacks, 100 kg limit), seasons (`seasons.ts`: ring math, ramp, record in `sc.best`), quest and milestones (`quest.ts`).
8. **Input**: `input.ts` for keys, mouse and Esc closers (panels register a closer). `touch.ts` for the phone stick and buttons.
9. **i18n** (`src/content/i18n.ts`): every player-facing string goes through `strings(ns, { key: 'Русский текст' })`. Russian is the source. Other languages are JSON packs in `src/content/lang/`. `tr(key, fallback)` returns the pack string, else the Russian source (see R4 in `playgama/risks.md`). To add a string: write it in the module with `strings()`, run `node scripts/i18n-dump.cjs` if the source list is needed, add the translation to the packs (translator agents use `_todo/`), run `node scripts/i18n-check.mjs`. After changing an existing Russian text, run `node scripts/i18n-invalidate.mjs <key...>`.
10. **Storage** (`src/platform/store.ts`): all settings and records go through this module. Reads are synchronous from the cache filled at boot by `storeInit(keys)`. Writes update the cache and are sent to the backend. The Bridge backend is installed with `setStoreBackend()` before `storeInit()` (PG1).
11. **Save** (`src/game/save.ts`): one slot. Still IndexedDB. Moves to the store in PG1 (rule 3.2.1). Autosave every 30 s and on hide (`src/ui/title.ts`).
12. **Self-test** (`src/game/selftest.ts`): `registerTest(group, name, fn)`, runner with an overlay and a copyable report. Entry points: title button «Самотест» and `#selftest`. Each `*.selftest.ts` file is imported from `main.ts`. Tests drive the real game through `window.__sc` and must not depend on order.
13. **Dev API** (`window.__sc` in `src/main.ts`): `start`, `step`, `stepFast`, `teleport`, `give`, `select`, `selectItem`, `setTime`, `setDay`, `setWeather`, `act`, `place`, `craft`, `kill`, `eat`, `sleep`, `stats`, `fps`, `arena`, `cell`, `aux`, `ascii`, `selftest`, `mods`, `senses`, `freeCam`, `setQuality`, `zoom`. Test helpers: `src/game/testkit.ts` (`arena()` and sandbox setup).
14. **Events**: `src/game/bus.ts` (emit and listen between modules). Sound hooks in `sfxhooks.ts` and `sfxhooks_use.ts` map events to `sfx.play(name)`.
15. **Audio** (`src/engine/audio.ts`): every sound is synthesised with WebAudio at run time (95 names via `soundNames()`, plus ambient layers). Playgama rejects this (R1). The plan is file-based audio in the archive, with the synth kept for the preview only.
16. **Dev pages**: `src/dev/viewer.ts` and `src/dev/sheet.ts` (sprite and weather viewer) through Vite on 5181 and 5182.

## 6. Game design summary

- **Endless survival sandbox.** No ending. The seasons ring is 12 polar-night days, then 6 twilight days, then repeat. Storms are generated per ring. Each ring is a little harder (storms, wind, drift, bear), capped. Death shows a card: days survived, ring, record, what you built, hunted and found, cause of death. Milestones at 5, 10, 20, 30, 50, 75, 100 days.
- **Start (current code).** The player begins at the station area. The from-scratch plan (§7a) changes this to a bare snowfield with a knife, a shovel and nothing else.
- **Body.** Core temperature, hand, foot and face frost (frostnip, frostbite), hydration (drink melted snow, costs fuel), food (fat is warming), fatigue, wetness (sweat when working hard; drying at a fire), CO poisoning in closed shelters with flame and no vent. Death causes: freezing, frostbite with starvation, drowning, bear, carbon monoxide, collapse, fall, hunger, thirst.
- **Snowcraft.** Probe density (kg/m³) with the cursor. Snow knife cuts blocks from packed snow; quality by density (loose below about 220, ideal 250–380, heavy above 420). Dome mode (R) leans courses inward. Shovel digs and carries loads (a full blade stops digging today; auto-toss is playtest item X2.1, verify it landed). Quinzhee: pile, sinter, hollow. Shelter rating ★ (insulation, wind tightness, warmth, structure) and a vent check.
- **Items.** Belt of 6 cells (9 with the pouch), pack 18 slots with a 100 kg limit, wear slots (head, body, hands, feet, face). About 18 usable items: thermos, flask, hand warmer, bandage, spirit, frost balm, goggles, compass, binoculars, probe pole, ice cleats, safety line, lantern, flare gun and flares, smoke flare, whistle, belt pouch, big pack, sack.
- **Hunting and food.** Seals at breathing holes (meat, fat, skin), fishing through a chiselled hole, ptarmigan on tundra (live flocks, flush on approach), the arctic fox (steals from caches), Sever the husky (barks before danger, retrieves birds, needs food daily).
- **Bear.** Scent tracking through the wind field, stages wander → curious → stalk → charge. Deterrents: fire, flare, noise, the dog, strong walls. Two bears from ring 3.
- **Drift and ice.** Pack ice floes move by whole cells between crack lines; leads open and refreeze; pressure ridges form. Thin ice cracks underfoot.
- **Station and objects.** The derelict station (generator, radio, kettle, medkit, gramophone, shutters, roof ladder, damper, weather balloon), mine (coal sacks and carts, timber props, cave-ins), ship «Заря» (cabin, hold, ship bell), beach (whale ribs, barrels), fox den. Radio repair is optional content; the icebreaker passes once per ring and drops a crate.
- **Controls (PC).** LMB uses the item in hand, RMB interacts with what is under the cursor, E is an alias. Belt 1–6 or wheel. Inventory Esc / I / C (Esc is being removed, PG2). P pause and settings. J journal. G drop. F eat. V parka vent. X senses. R dome mode. Ctrl smart cursor. Ctrl+wheel and +/− zoom. Shift+click quick move. Auto-pickup of loose items within about 10 cells.
- **Controls (phone, landscape).** Left stick walks; right cluster: action, jump, take or use, belt wheel, bag, journal, parka. The phone in portrait shows a "turn your phone" overlay.
- **Tone.** Quiet, cold, beautiful and tense. Warm amber only for flame and lamplight. Lore in notes of an earlier failed 1890s expedition (ship «Заря»), fictional.

## 7. Backlog, in priority order

**(a) «С нуля» redesign.** Read `design/from-scratch.md` (sections 1–5). The owner's answers (2026-11-10): start with the snow knife **and the shovel** in the belt (the document still says knife only, update it); body drain must be 1.5 game days for water and 2 for food (the code is at half: `player.ts` drain values, 100/900 and 100/1200 seconds, want 100/1800 and 100/2400); the derelict station is found and revived mid-game (not the starting shelter). Open numbers for the owner: double fuel burn time (`design/from-scratch.md` §3.3), shorten the first storm to 4 game hours (§2). Status: plan only. Not built.

**(b) Noita-like physics wiring.** Read `design/noita-audit.md`. The cell engine has fire, burning, gas, melting and support with 40/40 unit tests, but cell fire never starts in the game: `ignite()` and `explode()` are not called from game code, and no oil or lava is placed. Wave 1 is the fix: torch, match, campfire and flare ignite flammable cells, embers and sparks, the player can burn. Wave 2: diesel spill and burn, drum blast. Wave 3: falling-block rotation. Status: not started.

**(c) Playtest findings not yet re-verified.** `playtest/v13/FIXES.md`. Commit `52396c7` says X1 is done (goal text stays, stove takes fuel, cold guidance), X2 and X3 are merged. Each item must be checked by playing (real input, desktop and 810×253). Known open items: bag panel overlap at 810×253 (X2.8), auto-pickup radius (X2.3, the claim "only works when standing on the pile" is not confirmed), tap-aim far-click feedback (X2.2), drop visibility (X2.4), chest search time (X2.7). Personas rated fun 4, 4, 4, 4, 6 before the fixes (target 7 or more). No re-playtest recorded after the fixes.

**(d) Balance.** `tests/balance/report.md`. Medians: Мягкая 10.0 days (target over 30), Обычная 8.2 (target 15–20), Суровая 13.1 (target 8–12). Cause in the report: the bot's fuel economy and driftwood supply, not the numbers. Raising the driftwood stock to 150 per ring gives Обычная 19.1 days. The bot does not model the generator or the electric heater. A closed stove damper produces carbon monoxide in a locked house (found by the bot). Owner decides the numbers (owner-decisions D15).

**(e) Known fragile checks.** No maintained flaky list exists. Watch: timing-based self-tests (the runner waits 0.8 s after load), the balance bot (per seed), screenshot tests that depend on the title state. The e2e and play-through scripts were not run in this review, so treat their results as unknown.

**Playgama blockers (before any upload).** From `playgama/risks.md`: R1 sound, R2 storage, R3 Bridge, R4 untranslated strings, R5 Esc, R7 AI-generated visuals (human refinement).

## 8. Owner decisions and constraints (do not change without the owner)

Full list with dates: `playgama/owner-decisions.md`. The ones that shape every task:

- **Originality.** The game's own art, names, world and text. No Terraria, Noita or other brand names in any player-facing text or art. Terraria controls are a scheme only.
- **Simple.** When in doubt, cut a feature (DESIGN §16). No methane, no gas explosions, no mine vent door, no ore or trees.
- **Top principle.** The player must be able to play and enjoy it. Judge every change by the first 15 minutes of a real player (DESIGN §19). Tests green is necessary, never enough.
- **Language.** Russian is the source. Ten languages. English is the default and fallback for Playgama (rule 3.4.1). Store texts are in `playgama/store-listing.md`.
- **Endless.** No win, no ending, only death (DESIGN §18).
- **Controls.** Terraria-style mouse scheme on desktop. Phone keeps its layout. Esc must go (Playgama 1.5.2); the replacement key is still the owner's choice (D9).
- **FPS.** Only the owner measures it, on a real phone. No FPS tests in the cloud.
- **Agents.** Haiku-first. Brief answers. Each agent owns its own files and does not commit or touch `.claude/`.
- **Costs.** Remind the owner about token, usage-limit and credit use when long work starts. Keep agent runs and screenshot batches small.
- **Publishing.** Ask before every publishing step. Nothing is uploaded, published, or sent to catalog without the owner's explicit «да» (see §9).

## 9. What NOT to do without the owner's explicit «да»

Each of these is irreversible or spends something. Ask first, and wait for a clear yes, each time:

- `publish_sandbox` (a public page without moderation)
- `start_sandbox_traffic` (spends the traffic bonus)
- `replace_in_app_products` (deletes every product not listed)
- `send_playgama_catalog_update` (updates the live catalog game for all players)
- `create_application` (creates a Playgama application)
- `start_archive_upload`, `confirm_archive_upload`, `start_cover_upload`, `confirm_cover_upload` (uploads)
- `update_application_form` (changes the public form)
- Anything that spends money, credits or referral credit (`apply_referral_code`, `create_leaderboard`, `update_leaderboard`)
- Submitting for moderation (a human does this in the console, not by a tool)

Read-only Playgama calls are safe: `list_applications`, `get_application`, `get_game_checklist`, `get_game_categories`, `get_game_guides`, `get_bridge_sdk_docs`, `get_launch_steps`, `get_archive_status`, `get_archive_qa_tool_link`, `get_local_game_qa_tool_link`, `get_submission_state`, `get_publications`, `get_sandbox_state`, `get_sandbox_share`, `get_game_telemetry_*`, `list_leaderboards`, `list_in_app_products`, `list_moderation_comments`, `get_referral_program`.

In the repo: never `git commit`, `git stash`, `git reset`, `git checkout` or `git clean` in a shared tree. The harness commits. Do not edit the `.claude/` folder. Do not change source files for the store copy: the store texts are documents, not code.

Never publish a page or text that uses another brand, name or platform as if it were theirs.

## 10. First 30 minutes in the new chat

1. Read this file, then `playgama/compliance-matrix.md` (summary and section A), then `playgama/risks.md` (top five). Do not read the whole repo.
2. Run `git status` and `git log --oneline | head -5` in the repo. Note which files PG1 and PG2 are changing. Do not edit them.
3. Run `npm run check` and the three headless tests (§4). Expect green. Report any red line with the file name.
4. Read the Playgama state with read-only calls: `get_game_checklist` (no page, for the index), `get_bridge_sdk_docs` with `page: api` (required steps), and `list_applications` (is the game already created?).
5. If the game has no application yet, do **not** create it. Show the owner the plan from `playgama/store-listing.md` section 1 and wait for «да». When the owner says yes, `get_game_categories` first, then `create_application` with the owner's confirmation.
6. After creation, `get_launch_steps` for the game id. Follow its steps in order. Each step that uploads, publishes or changes the public form needs its own «да».
7. Read `playgama/qa-checklist.md` section 1 and run the technical checks on the **archive** (PG1's pack output), not on the preview build.
8. Ask the owner the decisions marked **open** in `playgama/owner-decisions.md` (D5, D6, D7, D9, D12–D14, D15, D17, D18). Do not guess them.
9. Report back in ten lines or fewer: what passed, what is blocked, which decisions are waiting for the owner.
