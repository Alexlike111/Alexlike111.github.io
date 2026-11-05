# Release checklist: Smash Circuit on Playgama

Maps the Playgama Game Requirements (wiki, numbered items) and the Bridge SDK "Required steps" to what the repo does today.
Status: **done** (in the code, covered by a test or a script), **owner** (needs the owner or a human in the Playgama console, or a real device),
**missing** (a gap the repo should still close).

Last reviewed against the live wiki on 2026-11-05 (Bridge 2.4.0).

## How to run the gates

All commands run from `games-src/smash-circuit`.

| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit tests (sim, economy, i18n, platform with a mocked Bridge) |
| `npm run build` | `prebuild` runs the source checks, then `tsc --noEmit && vite build` |
| `npm run e2e:player` | `node e2e/player-checks.mjs`, the player-view checks in headless Chromium. Needs a fresh `dist/` (run `npm run build` first) |
| `npm run e2e` | `node e2e/run.mjs`, a longer smoke run with screenshots and the layout audit |
| `npm run check-release` | `scripts/check-release.mjs`: source checks plus dist checks and the bundle budget |
| `npm run check-release:strict` | same, but open owner actions (placeholder token, synthesized audio) also fail the run |
| `npm run release` | typecheck, test, build, e2e:player, check-release (what `deploy` runs before copying `dist/` to `play-test/smash`) |

CI: `.github/workflows/smash-circuit.yml` runs the same gates on pushes and pull requests that touch `games-src/smash-circuit/**`.
Run it by hand with "strict" ticked before a real release.

`check-release` fails (always) on: missing required files, no `#ver` build label or a label that differs from `package.json`,
`console.log/debug/info/trace` in `src`, `localStorage`/`sessionStorage`/IndexedDB/cookies, a bound Esc key, external analytics,
external resources in html/css, a Bridge script that is not the first plain `<script>` in `<head>`, a missing `playgama-bridge-config.json`,
a track without a leaderboard id in the config, missing or unpaired (ogg + mp3) sound files, and a bundle over budget
(gzip: JS 340 KB, CSS 20 KB, all game files 365 KB; dist 15 MB; any file 5 MB; sfx 8 MB; 0.1.7 is at about 295 / 12 / 308 KB).
It reports as **owner blockers** (warnings, failures with `--strict`): any `REPLACE_WITH...` placeholder and the PLACEHOLDERS status in `docs/AUDIO.md`.

## Owner actions still needed (blockers first)

1. **Audio (blocker, rules 3.3.1 and 3.3.2).** Every file in `public/sfx` is synthesized by code. Replace them with recorded CC0 or licensed files
   (same names, ogg + mp3), add a 60-120 s music loop, fill the licence table in `docs/AUDIO.md` and change its status line. `check-release` clears the blocker when the PLACEHOLDERS status is gone.
2. **Create the game in the Playgama console.** The account has no "Smash Circuit" application yet (checked 2026-11-05 with `list_applications`). Create it; the title must match the title in the game (rule 3.5.1: "Smash Circuit").
3. **SaaS leaderboards (blocker for the leaderboard UI).** In the console under Bridge SaaS > Leaderboards, create `best_lap_t1`, `best_lap_t2`, `best_lap_t3`
   (score = best lap in **milliseconds**, so a **smaller score is better**: sort ascending). Copy the game's public token into
   `public/playgama-bridge-config.json` (`saas.publicToken`, currently `REPLACE_WITH_GAME_PUBLIC_TOKEN`). Until then Playgama reports `leaderboards.type = not_available` and the game hides every leaderboard control (required step 8).
4. **Publication request.** Fill in title "Smash Circuit", languages **English and Russian** (rule 3.4.3: the game ships exactly these two), devices, orientation (rule 1.4.3: the game adapts to both, pick both), categories, description, covers and screenshots. Covers and screenshots, the archive upload and the moderation submit are done by a human in the console (there is no tool for them).
5. **Upload the archive** (the contents of `dist/`, with `index.html` at the root; about 2 MB) and run the Playgama QA tool on it (`get_archive_qa_tool_link` / the console). Fix whatever the automatic build check reports.
6. **Real-device pass** (rules 1.4, 1.6, 1.7.3): a phone in portrait and landscape, a tablet, a square window (1:1, rule 1.6.8), Safari/iOS (mp3 fallback, touch callout, audio unlock), Firefox, and an ad round-trip on the Playgama sandbox (sound and gameplay stop while the ad is open, resume after).
7. **Decide on rule 4.3.1** (generative AI). The code, tuning and procedural art are AI-assisted; moderation rejects titles that are built wholly by generative AI without substantial human refinement of the visuals. Plan a human art/UI pass (car silhouettes, logo, icons, covers) and keep the interface free of emoji (4.3.2, already true).
8. **Optional:** whether to keep the local Bridge copy (105 KB gzip, all platform adapters) or load the CDN build is the owner's call; the local copy satisfies rule 1.2.5 (no external resources).

## Bridge SDK "Required steps"

| # | Step | Status | Where |
|---|---|---|---|
| 1 | `playgama-bridge-config.json` ships next to `index.html` | done (token placeholder: owner, see above) | `public/playgama-bridge-config.json`, Vite `playgamaBridge` plugin; `check-release` verifies it in `dist/` |
| 2 | Bridge script first in `<head>`, normal load, initialise before the game starts | done | `dist/index.html` (checked by `check-release`), `platform.init()` is the first call in `Game.boot` |
| 3 | Language from `platform.language`, read once after init | done | `platform.language()` (never the browser while the Bridge is not ready), `initLang` in `src/game.ts`; re-applied on a late init |
| 4 | Storage only through the Bridge, one `get` for all keys at start, one `set` per meaningful change | done | `src/meta/save.ts`, `platform.load` / `platform.save`; writes are blocked until a real load finished; `check-release` forbids `localStorage` and friends |
| 5 | Pause and audio: check `isAudioEnabled` at start, handle both events | done | `platform.onPause`, `platform.onAudio`, `platform.isAudioEnabled` in `Game.boot`; tab hidden pauses too |
| 6 | `game_ready` when the first playable frame is ready | done | `platform.gameReady()` after the second rendered frame, after the boot overlay is removed |
| 7 | Interstitial at natural pauses, no own timers | done | results "Continue", "Race again", "Next track", and quitting or restarting from the pause menu; the Bridge decides if an ad shows (`advertisement.initialInterstitialDelay` 30 s, `minimumDelayBetweenInterstitial` 60 s in the config) |
| 8 | Hide what the platform does not support | done | rewarded button only if `isRewardedSupported`; leaderboard controls only if `leaderboards.type` is `in_game` (read) or `native_popup`; no payments, no sign-in, no external links in the game |

Optional modules in use: rewarded (double race reward), leaderboards (best lap per track, top 10 read), `level_*` messages.
Not used: payments, banners, achievements, tasks, daily rewards, notifications, social, cross-promo, remote config, analytics.

## Game Requirements

### 1. Technical

| Rule | Status | Notes |
|---|---|---|
| 1.1.1 Current Bridge SDK | done | `@playgama/bridge` 2.4.0 |
| 1.1.2 All Required steps | done / owner | see the table above; the SaaS token is an owner action |
| 1.2.1 No registration needed | done | no sign-in anywhere |
| 1.2.2, 1.2.3 No forced sign-in | done | no sign-in |
| 1.2.4 No external analytics | done | `check-release` greps source and bundle |
| 1.2.5 No external resources | done | all fonts, sounds and models ship in the archive; `check-release` checks html, css and URL literals |
| 1.2.6 External links only if allowed | done | the game has no external links |
| 1.2.7 No URL locks | done | none |
| 1.3.1 Size under 300 MB | done | about 2 MB |
| 1.3.2 `index.html` at the root, Latin file names | done | checked on `dist/` |
| 1.3.3 Under 2 GB at start | done | checked by Playgama's build check; a small WebGL scene and 2 MB of files (owner: confirm with the QA tool) |
| 1.4.1 Full screen on mobile | done | fixed full-viewport canvas |
| 1.4.2 Keyboard for text input | done | no text input |
| 1.4.3 Orientation | owner | the game adapts to both; select both in the publication request |
| 1.4.4 Touch controls, five schemes | done | buttons (default), slide, joystick, tilt, two-side tap; first-run picker |
| 1.4.5 Long press does not select or open menus | done | `user-select: none`, `-webkit-touch-callout: none`, `oncontextmenu="return false"` |
| 1.4.6 No WebGL warnings | owner | no warning is shown by the game; confirm on iOS Safari |
| 1.5.1 Keyboard | done | keyboard driving, `P` pause, repair and item keys (see the in-game tutorial) |
| 1.5.2 No Esc | done | `check-release` greps for it |
| 1.5.3 Both control schemes | done | touch/keyboard switch automatically |
| 1.6.1 to 1.6.7 Display | done / owner | `e2e/run.mjs` layout audit covers phone and desktop; real devices still owner |
| 1.6.8 Square 1:1 window | missing | not covered by the e2e layout audit; add a 700x700 profile |
| 1.7.1 Stability | done / owner | `e2e/player-checks.mjs` plays real races; ad, rotation and minimise round-trips need a device pass |
| 1.7.2 Can be played through | done | three tracks, unlock chain, career economy |
| 1.7.3 Browsers | owner | Chrome is tested; Firefox, Safari, Edge, Opera on real browsers |
| 1.8 Video | done | no video |

### 2. Advertising and payments

| Rule | Status | Notes |
|---|---|---|
| 2.1.1 Only Bridge ads | done | no other ads |
| 2.1.2 Interstitials shown | done | see step 7; with no Bridge (standalone, the claude.ai artifact) `showInterstitial` resolves at once and nothing is shown |
| 2.1.3 Only at logical pauses | done | after a finished race, and from the pause menu; never during a race |
| 2.1.4 Not under the finger | done | ads are full screen and opened by the Bridge |
| 2.1.5 Orientation | done | full screen ads, Bridge handles it |
| 2.1.6 Sound and gameplay paused during full-screen ads | done | `beginAd`/`endAd` suspend audio and freeze the sim; `platform.watchAds` covers platform-initiated ads and an ad already open at boot |
| 2.1.7 Ad failure never blocks the game | done | watchdogs in `bridge.ts` (5 s with no state, 20 s in `loading`, 10 min after `opened`); covered by `tests/platformAds.test.ts` |
| 2.2.1 Rewarded is opt-in, button says ad and reward | done | results button: tag "AD", "Watch ad: x2 reward", "Plays a video ad, +N coins" (en and ru) |
| 2.2.2 Can decline | done | the button is optional; "Continue" and "Race again" are always there |
| 2.2.3 Reward is an extra | done | doubled race reward only |
| 2.2.4 Recover-from-failure ads at most once per attempt | done | not used (no revive, no free repair). A rewarded free repair was considered and left out: repair economics are still being rebalanced (audit #21) |
| 2.2.5 Reward only when watched to the end | done | granted only in the Bridge `rewarded` state; a closed or failed ad grants nothing (`tests/platformAds.test.ts`) |
| 2.3 Banners | done | none used |
| 2.4 Payments | done | none used |
| 2.5 Real money | done | none |

### 3. User experience

| Rule | Status | Notes |
|---|---|---|
| 3.1.1, 3.1.2 Progress, rising difficulty | done | career with 3 tracks, 10 cars, upgrades, AI skill ramp |
| 3.1.3 Tutorial | done | first-race hint sheet that never blocks the countdown, controls picker on touch |
| 3.2.1 Bridge storage only | done | `check-release` forbids the browser storage APIs |
| 3.2.2 Saves progress | done | money, upgrades, unlocks, best laps, ghosts, settings |
| 3.2.3 Survives reload, rotation, ad | done | save status model (`ok`, `empty`, `failed`), retry with backoff, never overwrites unknown progress |
| 3.3.1 Music and sound effects | owner | the game plays them, but they are synthesized placeholders: replace (blocker) |
| 3.3.2 Recorded, compressed audio | owner | same blocker; ogg + mp3 are shipped |
| 3.3.3 Mute button | done | pause menu and settings |
| 3.3.4 Honour platform audio and pause | done | initial `isAudioEnabled`, `audio_state_changed`, `pause_state_changed` |
| 3.3.5 Silent when hidden | done | `visibilitychange` pauses the race and suspends the AudioContext |
| 3.4.1 English default and fallback | done | `EN` dictionary |
| 3.4.2 Language only from the Bridge | done | `platform.language()`; `en` while the Bridge is not ready; the `ru` family maps to Russian |
| 3.4.3 All text translated | done | `tests/i18n.test.ts` enforces equal keys and placeholders |
| 3.4.4 Language selector | done | settings, with "Auto, English, Russian" |
| 3.5.1 Title matches the request | owner | the game says "Smash Circuit" (`CONFIG.title`, `<title>`); use exactly this in the request |

### 4. Content

| Rule | Status | Notes |
|---|---|---|
| 4.1 Restricted content | done | cartoon car racing and prop destruction, no people or animals |
| 4.2.1 to 4.2.5 Rights | done / owner | no third-party names or brands (invented car names such as Scrapper, Needle, Mammoth); owner confirms the audio licences when recorded files arrive |
| 4.3.1 Not wholly generative-AI | owner | see owner action 7 |
| 4.3.2 Custom interface, no emoji icons | done | inline SVG icons, designed UI |
| 4.4 User data | done | none collected; the repo root has `privacy.html` and `terms.html` for the site |

### 5. Engine-specific

Not applicable (TypeScript, Vite, Three.js; no Unity).

## Leaderboard contract (for the console and the code)

- Ids: `best_lap_<trackId>` (`CONFIG.game.leaderboardPrefix` + track id). `t1` is the main board.
- Score: best lap in whole milliseconds, **lower is better**. Only laps that passed every gate count (a cut lap does not set the best lap, see audit #8).
- Written once per race, only when the player improved their stored best lap (`Game.onPlayerFinish`).
- Read: `platform.leaderboardTop(id, 10)` returns the top 10 as `{ rank, name, score, isPlayer }` when `leaderboards.type` is `in_game`
  (the case on Playgama once SaaS leaderboards are enabled); on `native_popup` platforms the game opens the platform overlay instead;
  on `native` platforms the platform draws the board and the game shows nothing; on `not_available` the controls are hidden.

## Known gaps in this checklist

- No automated test runs against the real Bridge or the Playgama QA tool; `tests/platform*.test.ts` use a mocked Bridge.
- The e2e suite does not play a full ad round trip in a browser (the Bridge is the local no-op copy there).
- A rewarded free repair and a revive are deliberately not offered (see 2.2.4).
