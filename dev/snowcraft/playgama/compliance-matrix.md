# SNOWCRAFT · Playgama compliance matrix

Snapshot of 2026-11-10, written while PG1 (Bridge integration, save format, build:pg and pack script) and PG2 (Esc removal, long-press, mute button, layout audit) are implementing. The lead updates the status column at the end. Until then, each row shows the planned state with its owner tag: **PG1**, **PG2** or **lead**.

Status key:
- **DONE**: the code or the setting meets the rule, with evidence.
- **DONE-verify**: the code looks right, but no test or device proof was run in this review.
- **PLANNED-PG1 / PLANNED-PG2 / lead**: work in progress or owner-assigned, not yet in the code.
- **BLOCKER**: moderation would reject the game as it is.
- **RISK**: may fail moderation or hurt the player, and needs a decision or proof.
- **N/A**: the game does not do this.
- **verify**: unknown, must be checked on a device or in the build.

Requirement texts are short paraphrases of the Playgama pages read on 2026-11-10. Numbers are the official ones.

## Summary of blockers (fix before any upload)

1. **3.3.2 sound is generated in code**, not recorded or produced files. BLOCKER. Owner: lead and owner (decision on audio production). See risks R1.
2. **3.2.1 saves go through IndexedDB and localStorage**, and the built HTML contains both. BLOCKER. Owner: PG1. See risks R2.
3. **Bridge not integrated**: no SDK, no `game_ready`, no interstitial, no pause or audio events. BLOCKER. Owner: PG1.
4. **1.5.2 Esc is used** for inventory and panels. BLOCKER. Owner: PG2.
5. **3.4.2 language comes from the browser** (`src/content/i18n.ts` line 35), not from Bridge. BLOCKER. Owner: PG1.
6. **3.4.3 six keys are missing in all nine packs**, so players see Russian. BLOCKER. Owner: lead (translation fix). See risks R4.

## A. Bridge SDK required steps (rule 1.1.2, from `get_bridge_sdk_docs` page `api`)

| # | Required step | Status | Evidence in code | Action (owner) |
|---|---|---|---|---|
| RS1 | Ship `playgama-bridge-config.json` next to `index.html` in the archive | PLANNED-PG1 | no config file in the repo (verify) | PG1 adds it to the pack script; read `bridge-sdk/config` before writing it (verify) |
| RS2 | SDK is the first script in `<head>`, not async; init finishes before the game loads | PLANNED-PG1 | `index.html` loads `src/main.ts` as a module at the end of `<body>` | PG1 moves the SDK script to `<head>` and gates boot on init |
| RS3 | Localise from `platform.language`, read once after init | PLANNED-PG1 | `src/content/i18n.ts` line 35 reads `navigator.languages` | PG1 switches the source to the Bridge value |
| RS4 | Storage only; one `get` at start; batched `set` on meaningful change | PLANNED-PG1 | `src/platform/store.ts` is the seam (cache + backend); `src/game/save.ts` line 73 uses IndexedDB | PG1 writes `src/platform/bridge.ts` and moves the save format to the store |
| RS5 | Handle pause and audio state (`isAudioEnabled`, events) | PLANNED-PG1 | `src/engine/audio.ts` line 668 suspends the audio context on its own `visibilitychange`; no Bridge call | PG1 adds `isAudioEnabled` at start and the Bridge events |
| RS6 | `platform.sendMessage('game_ready')` when the first playable frame is ready, never while loading | PLANNED-PG1 | no call in `src` | PG1 sends it after the first interactive frame. Owner decides whether the title screen counts (owner-decisions.md D12). |
| RS7 | `showInterstitial()` at natural pauses; no own timers | PLANNED-PG1 + lead | none | PG1 adds the call; lead picks the placement (death card, new game) |
| RS8 | Hide unsupported features (rewarded, store, leaderboard, sign-in, external links) | N/A today, PLANNED-PG1 when a module is added | the game has none of these (verify no external link) | PG1 checks each module flag before showing it |

## B. Technical requirements (1.x)

| Rule | Requirement (short) | Status | Evidence | Action (owner) |
|---|---|---|---|---|
| 1.1.1 | Integrates the current Bridge SDK | PLANNED-PG1 (BLOCKER) | see RS1–RS8 | PG1 |
| 1.1.2 | Every required step done | PLANNED-PG1 (BLOCKER) | section A | PG1 |
| 1.2.1 | No registration needed to play | DONE | no account or login code found in `src` | none |
| 1.2.2 | Never forces or prompts sign-in at launch | DONE | as above | none |
| 1.2.3 | If sign-in exists, it works and never blocks | N/A | no sign-in | none |
| 1.2.4 | No external analytics (GA4 etc.) | DONE-verify | no analytics code in `src` or in `dist/index.html` (grep: none) | verify in the network log |
| 1.2.5 | No external resources: everything in the archive | DONE-verify | `dist/index.html` has no `http(s)://` URLs; fonts come from `@fontsource` packages, bundled | verify in the network log; the Playgama bundle must not load anything |
| 1.2.6 | External links only when `isExternalLinksAllowed` | N/A-verify | no links found in `src` | verify after PG1 |
| 1.2.7 | No technical limit by the URL it is opened from | verify | no URL check found (not searched in depth) | verify |
| 1.3.1 | Archive size ≤ 300 MB | DONE-verify | `dist/index.html` 1.9 MB (single file, without audio files) | recheck after sound replacement |
| 1.3.2 | `index.html` at archive root; Latin file and folder names | PLANNED-PG1 | `dist/index.html` is single-file; pack script not written yet | PG1 pack script (`release/snowcraft-playgama.zip`) |
| 1.3.3 | Memory under 2 GB while starting | verify | not measured; world is 2048×768 cells (`src/engine/grid.ts` line 5) with several typed arrays | owner on phone or desktop profile |
| 1.4.1 | Full screen during gameplay or start (mobile) | RISK | Shift+Enter only (`src/ui/menu.ts` hint); no phone control | lead decides; PG2 if a button is added |
| 1.4.2 | Keyboard appears on input fields | N/A | no text input (zoom slider is a range input) | verify no text input in any panel |
| 1.4.3 | One orientation: set it in the draft; placeholder in the other | DONE | landscape game; portrait overlay in `src/ui/touch.ts` (`#rotate`, lines 143–145, 234) | set landscape in the draft |
| 1.4.4 | Gestures and touch controls work reliably | RISK-verify | touch layout in `src/ui/touch.ts`; owner phone playtests exist (`playtest/phone-touch.md`) | verify on real phones |
| 1.4.5 | Long press on play field: no text selection, no browser menu, no iOS magnifier | PLANNED-PG2 | `src/engine/input.ts` line 95 blocks `contextmenu`; `user-select:none` on `<html>`; no `-webkit-touch-callout` on the play field (verify) | PG2 long-press work |
| 1.4.6 | No WebGL or engine warning on mobile | DONE-verify | 2D canvas; no such warning code | verify on phone |
| 1.5.1 | Fully controllable by mouse and/or keyboard | DONE | Terraria-style mapping (`TERRARIA_CONTROLS.md`) | none |
| 1.5.2 | Does not use Esc | PLANNED-PG2 (BLOCKER) | Esc used in `src/engine/input.ts` line 48, `src/ui/menu.ts` line 293, `src/ui/devhud.ts` line 341, `src/game/search.ts` line 147 | PG2 removes it; owner picks the new key (owner-decisions.md D9) |
| 1.5.3 | If mobile is supported, both schemes work | DONE-verify | `src/ui/touch.ts` plus desktop input | verify on phone and laptop touch |
| 1.6.1 | Adapts to every size, aspect ratio and orientation | verify (RISK) | `src/engine/zoom.ts`, `src/ui/layout.selftest.ts` exist; no device proof | PG2 layout audit |
| 1.6.2 | Field scale stays inside the screen | verify | `zoom.ts` chooses scale on resize | verify |
| 1.6.3 | No browser page scroll | DONE-verify | `index.html` style: `overflow:hidden; touch-action:none` | verify on iOS Safari |
| 1.6.4 | No overlaps between elements | PLANNED-PG2 (RISK) | playtest X2.8: bag panel overlap at 810×253 (`playtest/v13/FIXES.md`) | PG2 layout audit |
| 1.6.5 | Every pop-up has a close control | verify | close controls exist in menu, bag, search; death card and storm card to check | PG2 audit |
| 1.6.6 | One-hand play without scrolling | RISK | left stick plus right cluster (`src/ui/touch.ts`) | verify on phone |
| 1.6.7 | Text readable at every size | RISK | pixel and Jura fonts at 810×253 | PG2 audit |
| 1.6.8 | Square window: fills, no bars, no overlap | verify | layout selftests exist (`src/ui/layout.selftest.ts`); no 1:1 run in this review | run the square-window check |
| 1.7.1 | No errors, crashes or freezes | verify (RISK) | `tests/e2e.mjs` and the self-test check console errors; not run in this review | run e2e and a 30-minute manual session |
| 1.7.2 | Playable through; nothing gets stuck | RISK | unstuck code exists (`src/game/unstuck.ts`, key U); balance bot deaths 8–13 days median (`tests/balance/report.md`) | manual play-through |
| 1.7.3 | Works in current Chrome, Firefox, Opera, Safari, Edge on Windows, macOS, Android, iOS | RISK | only headless Chromium used in automation; nothing else tested | browser matrix (qa-checklist 1.7.3) |
| 1.8.1 | No system video player | N/A | no video | none |
| 1.8.2 | Videos embedded, no external players | N/A | no video | none |

## C. Advertising and payments (2.x)

| Rule | Requirement (short) | Status | Evidence | Action (owner) |
|---|---|---|---|---|
| 2.1.1 | No third-party ads, static or text | DONE | no ad code in `src` or `dist` | none |
| 2.1.2 | Shows Bridge interstitials | PLANNED-PG1 (BLOCKER) | none | PG1 (RS7) |
| 2.1.3 | Ads only at logical pauses, never during active play | PLANNED-PG1 + lead | none | lead chooses placements: death card, new game, pause (D13) |
| 2.1.4 | Ad block not over a clickable element | PLANNED-PG1 | none | verify when placed |
| 2.1.5 | Ad orientation matches game (landscape) | PLANNED-PG1 | none | verify |
| 2.1.6 | Sound and gameplay pause during full-screen ad, resume after | PLANNED-PG1 | `audio.ts` can mute; no pause hook on ad event | PG1 wires ad events to pause and mute |
| 2.1.7 | Failed or unavailable ads: game continues | PLANNED-PG1 | none | PG1 |
| 2.2.1–2.2.5 | Rewarded ads: opt-in, can decline, reward is a bonus, granted only after a full watch | N/A | none planned | if the owner adds revive or double rewards, add a section (2.2.4: revive at most once per attempt) |
| 2.3.1–2.3.2 | Bridge banners only; never over interactive elements | N/A | none planned | owner decides |
| 2.4.1–2.4.6 | Payments only through Bridge; grant after success; restore at launch | N/A | no purchases in the design | owner decides (D14) |
| 2.5.1–2.5.2 | No real money, prizes, gambling | DONE | none | none |

## D. User experience (3.x)

| Rule | Requirement (short) | Status | Evidence | Action (owner) |
|---|---|---|---|---|
| 3.1.1 | Has progress, interaction mechanics or plot | DONE | survival loop, building, hunting, quest chain and milestones (`src/game/quest.ts`, `src/game/seasons.ts`) | none |
| 3.1.2 | Increasing difficulty and clear setting | DONE-verify | seasons ring ramp +8 % per ring, capped (`src/game/seasons.ts`); difficulty Мягкая/Обычная/Суровая (`src/game/state.ts` DIFFS). Balance targets not met (`tests/balance/report.md`). | owner accepts or re-tunes (D15) |
| 3.1.3 | Teaches controls and goal by tutorial, not a wall of text | RISK | playtests average 4/10 before fixes (`playtest/v13/FIXES.md`); design §20 replaces the day-1 chain with a from-scratch start, not yet built (`design/from-scratch.md`) | lead: fresh playtest after fixes; owner answers D5 |
| 3.2.1 | Progress saved only through Bridge storage | PLANNED-PG1 (BLOCKER) | `src/game/save.ts` line 73 IndexedDB; `src/platform/store.ts` localStorage backend; `dist` holds 15 localStorage references | PG1 |
| 3.2.2 | Saves progress; endless game saves best score | PLANNED-PG1 | `src/game/seasons.ts` line 43 stores the record in `sc.best` through `store` (verify the record uses the Bridge after PG1) | PG1 |
| 3.2.3 | Progress survives reload, rotation and an ad | verify (RISK) | autosave every 30 s and on hidden (`src/ui/title.ts` header); not tested after the Bridge change | verify after PG1 |
| 3.3.1 | Background music and sound effects present | DONE | 95 cue names plus 10 internal ones (`soundNames()`, see risks.md) | none |
| 3.3.2 | Sound recorded or produced; compressed audio files; no code-synthesised sound | BLOCKER | `src/engine/audio.ts` header: "Every sound is synthesised at runtime with WebAudio (no files)" | lead and owner: produce files (R1) |
| 3.3.3 | A mute button exists | PARTIAL → PLANNED-PG2 | mute in the pause panel (`src/ui/menu.ts` line 237); no HUD button | PG2 HUD mute button |
| 3.3.4 | Starts muted if platform audio is off; handles audio events; stays muted after reload | PLANNED-PG1 | none (no `isAudioEnabled`) | PG1 |
| 3.3.5 | Sound stops when page minimized or hidden; resumes correctly | PARTIAL → verify | `src/engine/audio.ts` line 668 suspends and resumes the audio context; autosave on hidden | verify on mobile; PG1 adds Bridge events |
| 3.4.1 | English localisation required; English is default and fallback | RISK (PLANNED-PG1, lead) | `src/content/i18n.ts` line 35: default from browser, falls back to `en` only in `detectLang`; `tr()` falls back to the Russian source, not to English | PG1 default from Bridge; lead changes the fallback to English |
| 3.4.2 | Player's language only from Bridge `platform.language` | PLANNED-PG1 (BLOCKER) | `src/content/i18n.ts` line 35 uses `navigator.languages` | PG1 (RS3) |
| 3.4.3 | All text translated into every declared language | BLOCKER | six keys missing in all nine packs: `drift.warn`, `hunt.flockHint`, `note.n14_x`, `note.n2_x`, `tools.digLooseFirst`, `tools.shovelFull` (`src/content/lang/*.json` vs `_source.json`: 1308 keys, packs 1302) | lead: translate the six keys and run `scripts/i18n-check.mjs` |
| 3.4.4 | Selector findable, language names in their own language | DONE-verify | names in `src/content/i18n.ts` line 9 (Русский, English, 中文 …); selector on title and pause | verify the icon (globe or gear) |
| 3.5.1 | Title in the game matches the publication title | DONE | `name: 'SNOWCRAFT'` (`src/ui/title.ts` line 33); `<title>SNOWCRAFT</title>` in `index.html` | keep the store title identical |

## E. Content (4.x)

| Rule | Requirement (short) | Status | Evidence | Action (owner) |
|---|---|---|---|---|
| 4.1.1 | No realistic violence to people or animals | RISK | bear attacks (death cause "медведь"); harpoon hits on seals with blood burst (`src/game/tools.ts` line 644); blood at the fauna kill (`src/game/fauna.ts` line 293); seal butchering | lead: remove or reduce blood and hit effects; keep the bear at a distance on screenshots |
| 4.1.2 | No politics, political figures or conflicts | DONE-verify | none found; the "Заря" expedition and station names are fictional | verify in the 10 languages |
| 4.1.3 | No religion | DONE-verify | none found in `en` and Russian | verify in all 10 languages |
| 4.1.4 | No predictions about the player's life, health or death | RISK-verify | death and frostbite texts not yet read for this rule; storm forecast is weather, not health | lead reads every death and frost text |
| 4.1.5 | No erotic content | DONE | none | none |
| 4.1.6 | No insults, hate or fascist material | DONE-verify | none found | verify in all languages |
| 4.1.7 | No obscene language | DONE-verify | none found in `en` and Russian | verify in all languages |
| 4.1.8 | No suicide descriptions | DONE-verify | death causes are cold, hunger, thirst, bear, CO, drowning, collapse, fall | verify death card text |
| 4.1.9 | No misleading or criminal instructions | DONE-verify | survival tips only | verify |
| 4.1.10 | No extremist or illegal material | DONE | none | none |
| 4.2.1 | Materials are the creator's | DONE-verify | owner's code and procedural art; fonts Pixelify Sans and Jura (`@fontsource`, OFL licence); all sound synthesised in code | record licences; replace sound (R1) |
| 4.2.2 | Not a copy of a catalog game | RISK-verify | genre inspired by sandbox and falling-sand games; controls follow a Terraria-style mapping, not its assets | publishing chat searches the catalog before publish |
| 4.2.3 | No other games' or brands' names, music or characters | DONE-verify | no brand strings in `src` or `dist` (grep: none); docs and code comments mention Terraria and Noita (not shipped as text) | final grep on the Playgama build |
| 4.2.4 | Not pretending to be an official product | DONE | none | none |
| 4.2.5 | No unrelated brands to attract players | DONE | none | none |
| 4.3.1 | Not built entirely from generative AI without human refinement of visuals | RISK (high) | code, pixel art (procedural, in code) and text were AI-assisted; no human-drawn asset yet | lead and owner: human art refinement (cover-brief.md section 5; R7) |
| 4.3.2 | Interface designed for this game; no emoji icons; not a default template | DONE-verify | custom pixel UI; no emoji found in UI sources (grep); check the built output | verify on screenshots |
| 4.4.1 | Explicit permission for any user data use; privacy and licence text if needed | DONE-verify | no personal data collected; saves are the player's own; no account | decide if a privacy text is needed (D16) |

## F. Engine and platform-specific (5.x and partner pages)

| Rule | Requirement (short) | Status | Evidence | Action (owner) |
|---|---|---|---|---|
| 5.1.1 | Unity: decompression fallback | N/A | not Unity | none |
| P-FB | Facebook: at least 2 of IAP, leaderboards, multiplayer, sharing; no ads at start; under 200 MB; under 500 files | not chosen | none of the features | owner decides whether to publish there (D17) |
| P-MSN | MSN: build under 50 MB; landscape or both | DONE-verify | 1.9 MB today; landscape | verify after audio |
| P-CG | CrazyGames: 13+, 20+ minutes engagement, loading under 5 s, no black bars in landscape | not published by Playgama | none | not planned |
| P-YANDEX | Yandex/Playhop: Russian language support; 10+ minutes engagement | DONE for language (Russian source) | Russian is declared | owner decides (D17) |
| P-GD | Game Distribution: no outgoing links, no GA; no violence or explicit blood on screen | RISK | blood effects and bear attacks (see 4.1.1) | lead decides before choosing this partner |
| P-VK | VK: Russian default; scale without cropping; regenerating lives; social features must be optional | RISK | Russian source; English default conflicts with "Russian default" | owner decides (D17) |
| P-DISCORD | Discord: in-app purchases and multiplayer | not chosen | none | owner decides |
| P-XIAOMI | Xiaomi: load under 15 s; Android; under 100 MB; 5 min average play | verify | not measured | owner decides |
| P-YT | YouTube Playables: no external calls, under 30 MB initial build, portrait and landscape, ≤ 8,000 files, names without spaces | not chosen | 1.9 MB; portrait not supported | not planned without portrait |
| P-TT | TikTok: portrait, under 30 MB, Home Screen Shortcut and Sidebar buttons | not chosen | portrait not supported | not planned |
| P-GS | GameSnacks: 9:16 portrait, under 15 MiB initial, saves under 3 MiB | not chosen | portrait not supported | not planned |

## G. Game self-check (the most common rejection reasons)

| Self-check item | Status | Evidence |
|---|---|---|
| Progress lost after reload, or saved outside Bridge | PLANNED-PG1 (BLOCKER) | row 3.2.1 |
| Interstitials missing or timed by the game itself | PLANNED-PG1 | row 2.1.2 |
| Sound during ads, after minimize, when muted | PLANNED-PG1 | rows 2.1.6, 3.3.4, 3.3.5 |
| Interface cut off or overlapping at some size | PLANNED-PG2 (RISK) | rows 1.6.1, 1.6.4 |
| Controls do not work on one device, Esc used, long press selects | PLANNED-PG2 (BLOCKER) | rows 1.4.4, 1.4.5, 1.5.2 |
| Rewarded ad grants without watching | N/A | none planned |
| No sound, no mute button, sound synthesised in code | BLOCKER | rows 3.3.1–3.3.3 |
| No tutorial, little gameplay or progression | RISK | row 3.1.3 |
| Purchases wrong | N/A | none |
| Text not translated, English not default, language not from Bridge | BLOCKER | rows 3.4.1–3.4.3 |
| Bridge not started first, `game_ready` missing or too early | PLANNED-PG1 (BLOCKER) | RS2, RS6 |
| Crashes, freezes, errors | verify | row 1.7.1 |
| Title differs from publication title | DONE | row 3.5.1 |
| Outgoing links or GA4 | DONE-verify | rows 1.2.4, 1.2.6 |
| Low-quality generative AI title or emoji interface | RISK | rows 4.3.1, 4.3.2 |
| Copyright or copy of a catalog game | RISK-verify | rows 4.2.2, 4.2.3 |
