# Smash Circuit — handoff to the Playgama publishing chat

## Game
Top-down arcade destruction racer, browser (TypeScript, Vite 8, Three.js, planck.js, @playgama/bridge 2.4.1). Languages: EN, RU. Single-player.
Modes: Career (4 tracks, cups, upgrades, repairs), Demolition Arena (ram rivals for points), daily missions, cosmetics.
Controls: touch (Point = default, Buttons, Slide, tilt) and keyboard (WASD/arrows, Space drift, P pause, M mute). No Esc (Playgama 1.5.2).

## Where everything is
- Repo: alexlike111/alexlike111.github.io, branch `ccr-817202c6-chvkwr` (latest commit is the newest; no PR open).
- Source: `games-src/smash-circuit/` (README-level docs in its `docs/`: GDD.md, ARCHITECTURE.md, RELEASE.md, AUDIO.md, CONTROLS_RESEARCH.md, QA_REPORT_v017.md).
- Ready build zip (v0.1.15, 3.1 MB, index.html at the root): `store/smash-circuit-0.1.15.zip`.
- Covers (jpg): `store/covers/` -> square 800x800, portrait 1080x1920, landscape 1920x1080.
- Test artifact (private claude.ai page): https://claude.ai/artifact/6AZ5Xtm28CQrZZZK5JPS6P (a copy of the build in `play-test/smash/`).

## Playgama state (console)
- Game: "Smash Circuit", id `cmw5vlyz104dlmt0hlrpnfhk0`, status DRAFT, engine js, category driving, devices ANDROID/IOS/DESKTOP, EN+RU, horizontal+vertical, leaderboards flag false, multiplayer false.
- Archive v0.1.15: id `cmwaloo6o1ni9og0hgq37u9hv`, build check PASSED, Bridge 2.4.1 found. (Older archive 0.1.14: `cmw5vqwzk04gmmt0h7jfjeddu`.)
- Sandbox NOT published: Playgama refuses with COVERS_INCOMPLETE. The three covers must be uploaded by the owner by hand in the console (no API tool for it).
- Form text filled (description, how-to-play). `story` field (150-900 chars, English, developer voice) is NOT written yet.
- Title decision: "Smash Circuit". The owner asked for "Real Racing", but that is EA's brand (Playgama rule 4.2.3 forbids other brands in titles; in-game title must match, rule 3.5.1). Rename only if the owner insists, and change the in-game title too.

## Next steps
1. Owner uploads the 3 covers in the console.
2. Write `story` via update_application_form; then publish_sandbox for archive v0.1.15 (ask the owner first). Give the sandbox link.
3. Owner QA on a real phone (portrait + landscape) and desktop.
4. Owner presses Submit (only a human can).

## Open owner questions / known issues
- `public/playgama-bridge-config.json` has `publicToken: REPLACE_WITH_GAME_PUBLIC_TOKEN`; the owner says no token is needed. `scripts/check-release.mjs` reports it as an "owner blocker" (not a failure).
- Config declares leaderboards best_lap_t1..t3, but the form says leaderboards=false and none are created in the console. Either create them (create_leaderboard) and set the flag, or remove them from the config.
- Arena: in one test the player car drove out of the arena ring (possible hole in the outer wall). Not investigated.
- Portrait phone: tutorial covers the player's car during the countdown; "Point" turns slower in portrait.
- Not verified on a real device: tilt controls, hit-kick strength, track t4 "Neon Harbour".
- Bundle: main JS 1.2 MB (could be split).
- Flaky e2e checks in headless Chromium: "straight points up the screen", "no auto drift when slow", "[phone-*] left turns left".

## How to work on the code
```
cd games-src/smash-circuit
npm install
npx tsc --noEmit
npx vitest run                 # 797 tests
npm run build                  # then: node e2e/run.mjs, node e2e/player-checks.mjs, node e2e/arena.mjs
node scripts/check-release.mjs --src
```
Do NOT run `npm run deploy` (long full release suite). Release flow used so far: bump version in package.json -> tsc -> build -> `rm -rf ../../play-test/smash && cp -r dist ../../play-test/smash` -> update label in play-test/index.html -> publish artifact -> commit/push. Zip for Playgama: `cd dist && zip -qr ../smash.zip .` (index.html at root, relative paths, Latin file names).
Chromium for Playwright in the cloud: `chromium.launch({executablePath:'/opt/pw-browsers/chromium'})`.

## Rules to respect
Playgama requirements (get_game_checklist): Bridge only (storage, ads, language, audio), no localStorage, no Esc, no external resources, English default, sound from audio files, mute button, interstitial after loss only (>=60-90 s apart), rewarded only on player's choice, no brands in title.
Owner preferences: answer briefly in Russian, no filler; remind about token/limit/credit usage at the end of tasks; economise (Haiku for trivial work, Sonnet medium/high for complex, no Opus, <=10 sub-agents); always republish and open the artifact after changes, write the build version in it.
Commit trailers used: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
