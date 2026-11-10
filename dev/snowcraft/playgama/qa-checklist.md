# SNOWCRAFT · manual QA checklist for Playgama

Run this before every archive upload, not only the first one. Each row is one check. Mark it PASS, FAIL or NOT RUN, and write the build name and date next to it. Groups follow the Playgama requirement numbers (technical 1.x, advertising 2.x, user experience 3.x, content 4.x). Rule texts are in `compliance-matrix.md`.

## 0. Setup

| Device | Setup |
|---|---|
| Desktop | Chrome (latest), window 1280×720 and 1600×900, plus a 1:1 window (rule 1.6.8) |
| Desktop other browsers | Firefox, Edge, Safari on macOS (rule 1.7.3). Not yet tested by anyone. |
| Phone | Real Android phone and real iPhone, landscape. Emulated 844×390 touch in Chrome DevTools is a stopgap, not a pass. |
| Phone portrait | Check the "turn your phone" overlay appears (rule 1.4.3) |

Build to test: the Playgama archive (`release/snowcraft-playgama.zip`, once PG1 delivers it) unpacked and opened from `index.html` through a local server, and the same build through the Playgama QA tool link (section 7). Test the preview build (single HTML file) only as a regression check, never as the pass for the store.

Record for every run: build name, browser and version, device, language set in the game, and the result of the in-game self-test (`#selftest`, or the title button, on desktop) with its report file.

## 1. Technical (1.x)

### 1.1 Bridge SDK (1.1.1, 1.1.2)
- [ ] Open the page, watch the network panel: the Bridge script loads first in `<head>`, not async (RS2).
- [ ] No gameplay code runs before `bridge.initialize()` resolves. A slow network does not show the game early.
- [ ] `playgama-bridge-config.json` is next to `index.html` in the archive (RS1).
- [ ] Hand-check each of the 8 required steps in the matrix. Mark each one.

### 1.2 External services (1.2.1–1.2.7)
- [ ] Start a new game with no sign-in: no prompt, no account wall (1.2.1, 1.2.2).
- [ ] Network log over a full session: no request leaves the archive's own origin, except Bridge and the Playgama host (1.2.5). Fonts and sounds come from the archive.
- [ ] No link to any social network or other website is visible, or it is hidden when `platform.isExternalLinksAllowed` is false (1.2.6).
- [ ] The game runs the same from a different URL or domain (1.2.7).

### 1.3 Build (1.3.1–1.3.3)
- [ ] Archive size is under 300 MB (today's single HTML is about 1.9 MB; the audio files will add to it).
- [ ] `index.html` sits at the archive root. All file and folder names use Latin letters and no spaces (1.3.2).
- [ ] Memory while starting: check in the browser task view. No measurement exists yet (1.3.3, verify).

### 1.4 Mobile (1.4.1–1.4.6)
- [ ] Full screen during gameplay on a phone (1.4.1). Today the only full-screen toggle is Shift+Enter on desktop (`menu.ts` hint). Decide how the phone gets it.
- [ ] Phone landscape: the keyboard does not appear anywhere (no text fields, 1.4.2).
- [ ] Turn the phone to portrait: the overlay appears, and turning back resumes the game with no state loss.
- [ ] Touch: walk, jump, use, interact, belt, bag, journal, parka. Each responds on the first tap (1.4.4).
- [ ] Long press on the play field (hold for 2 s): no text selection, no browser menu, no iOS magnifier (1.4.5). Known gap, PG2 work.
- [ ] No WebGL or engine warning appears on start (1.4.6).

### 1.5 Desktop (1.5.1–1.5.3)
- [ ] Every action works with mouse and keyboard only.
- [ ] Esc does not exit or cause any problem (1.5.2). Known fault today: Esc opens and closes the inventory. This must be checked again after PG2 changes it.
- [ ] Phone and desktop controls both work on a laptop with a touch screen (1.5.3).

### 1.6 Display (1.6.1–1.6.8)
- [ ] Resize the window slowly from 1600 wide to 320 wide. Game field fills the area. Nothing is cut off. (1.6.1, 1.6.2)
- [ ] No browser scrollbar or page scroll at any size (1.6.3). Try a mouse wheel and a touch swipe on the page.
- [ ] Inventory, journal, pause, container and near-list panels: none overlaps another element at 810×253 and 844×390 (1.6.4). Known fault from the playtest: the bag panel's "sort by weight" text and the second row overlap at 810×253 (FIXES X2.8). PG2 layout audit.
- [ ] Every pop-up has a visible close button or cross (1.6.5). Check: pause panel, journal, container, near list, death card, storm card.
- [ ] One-hand reach on a phone: walk, act, open the bag, close it, all without scrolling (1.6.6). Hold the phone in one hand for 3 minutes.
- [ ] Text stays readable at 810×253 and 844×390 (1.6.7). Check the goal line, the toasts and the body panel.
- [ ] Square window (1:1, e.g. 720×720): the game fills it, with no empty bars, no overlaps (1.6.8).

### 1.7 Stability (1.7.1–1.7.3)
- [ ] Play 30 minutes of game time on desktop. No error in the console (1.7.1). Note any console message.
- [ ] Rotate the phone 10 times during play; minimize and restore the browser 5 times; open and close every panel; use the browser back button once. No freeze, no crash (1.7.1).
- [ ] Play to a death, then start a new game from the death card. Nothing stays stuck (1.7.2). Check the unstuck key `U` after being buried in snow.
- [ ] Browser matrix (1.7.3): Chrome, Firefox, Edge, Opera, Safari on macOS, Chrome on Android, Safari on iOS. Record each result. Not yet done for any browser other than headless Chromium.

### 1.8 Video (1.8.1, 1.8.2)
- [ ] The game has no video. Confirm no video element or file is in the archive (N/A).

## 2. Advertising and payments (2.x)

These checks apply only once Bridge ads are integrated (PG1). Until then, check that no ad, banner or payment code exists in the archive (2.1.1).

- [ ] Interstitials appear only at a natural pause: the death card, the start of a new game, the pause screen. Never during active play (2.1.3).
- [ ] An interstitial pauses the game and the sound, and the game continues exactly where it stopped (2.1.6).
- [ ] Ads that fail or are unavailable: the game keeps playing with no visible error (2.1.7).
- [ ] No ad block sits under the player's cursor or finger on a clickable element (2.1.4).
- [ ] Ads match the landscape orientation (2.1.5).
- [ ] Rewarded ads, banners and purchases: not designed, so not tested. If the owner adds any, add a full section.

## 3. User experience (3.x)

### 3.1 Gameplay (3.1.1–3.1.3)
- [ ] Within 10 minutes of real time, a new player can say what to do next, without reading a page of text (3.1.3). Test with someone who has never seen the game.
- [ ] Controls are taught by doing (goal line, arrows, short hints), not by a list of keys on the first screen.
- [ ] The difficulty and the setting are clear: a polar station, polar night, a survival goal. The ring ramp makes later seasons harder (3.1.2).

### 3.2 Progress saving (3.2.1–3.2.3)
- [ ] After a page reload, the game continues from the saved state, or the title offers "Continue" with the correct day (3.2.3).
- [ ] Reload during a storm: the storm does not replay, the player is not stuck (3.2.3).
- [ ] Rotate the phone and open an interstitial (once PG1 adds them): progress survives (3.2.3).
- [ ] Best score: the personal record survives a reload (3.2.2).
- [ ] Storage: only the Bridge storage is used. Check the bundle for `localStorage`, `sessionStorage`, `indexedDB` and cookies. Today the built HTML contains 15 `localStorage` and 1 `indexedDB` references (see risks R2). This check must be a FAIL until PG1 is done.

### 3.3 Sound (3.3.1–3.3.5)
- [ ] Background music and sound effects play during normal play (3.3.1).
- [ ] Sound quality: the sounds are compressed audio files in the archive, not generated in code (3.3.2). Today: all sounds are generated in code, so this is a FAIL (see risks R1).
- [ ] The mute button works in the pause panel and on the HUD (3.3.3). HUD button is PG2 work.
- [ ] Start with the Bridge reporting audio off: the game starts muted and stays muted after a reload (3.3.4).
- [ ] Minimize the browser or switch tabs: sound stops. Return: sound resumes, progress is intact (3.3.5).

### 3.4 Language (3.4.1–3.4.4)
- [ ] With the Bridge language set to `en`, the game starts in English (3.4.2).
- [ ] With the Bridge language set to an unsupported value (e.g. `de`), the game starts in English, not Russian (3.4.1).
- [ ] Walk through every menu and HUD label in each of the 10 declared languages. No Russian text in any non-Russian language (3.4.3). Known gap: six keys fall back to Russian in all nine packs (see risks R4).
- [ ] Arabic: the layout is right-to-left in panels, the text is readable, nothing is clipped.
- [ ] The language selector: findable without reading, shows each language name in its own language (3.4.4). Verify that the selector has a universal icon (globe or gear).
- [ ] Long texts: switch to German-length text in one menu to check the 40 % growth allowance (no clipping).

### 3.5 Title (3.5.1)
- [ ] The title on the title screen, the window title and the store title are all exactly `SNOWCRAFT`.

## 4. Content (4.x)

- [ ] Read every string in the English pack and the Russian source for: profanity (4.1.7), religion (4.1.3), politics (4.1.2), sexual content (4.1.5), insults (4.1.6), suicide (4.1.8), instructions for crime (4.1.9). Result: PASS or FAIL per language.
- [ ] Death texts and frostbite texts do not predict when or how the player will die (4.1.4). Check every line that mentions dying.
- [ ] Violence (4.1.1): play through one seal hunt, one ptarmigan hunt, one bear encounter. Note every visible hit effect and blood particle. Blood particles exist today (`src/game/tools.ts` line 644, `src/game/fauna.ts` line 293).
- [ ] Originality (4.2.2, 4.2.3): search the archive text and the built code for brand or game names (Terraria, Noita, Minecraft and similar). Expected: none in the shipped text.
- [ ] Generative AI (4.3.1): record which assets are human-made and which are procedural. Procedural is the default today. Human refinement is required before submission (see risks R7).
- [ ] Interface (4.3.2): no emoji used as icons. Check every panel and the title.
- [ ] Rights (4.2.1): every font has a licence file in the archive or the store text, and every sound has a documented source.
- [ ] User data (4.4.1): the game asks for no permission, collects nothing that identifies a player, and has no privacy policy or licence text unless the owner adds one.

## 5. Partner platforms (only those the owner chooses)

Platform-specific rules are listed in `compliance-matrix.md`, section F. Before publishing to any partner, check its page again.

- [ ] Game Distribution, GameSnacks, YouTube Playables, TikTok: no external calls at all, including analytics. The current build has none (verify in the network log).
- [ ] Game Distribution: no violence or blood on screen. Check every frame of a bear attack and a seal hunt.
- [ ] VK and Yandex/Playhop: Russian is the default. Our game defaults to English. Decide with the owner whether to publish to these at all.
- [ ] MSN: landscape is supported.
- [ ] YouTube Playables and TikTok: portrait is required. Not supported today. Do not select them without the owner's decision.

## 6. Self-test and regression

- [ ] Unit tests: `npx tsx tests/sim.test.ts`, `tests/world.test.ts`, `tests/mine.test.ts`. Current results: 40/40, 191/191, 20/20 (run 2026-11-10 on the working tree).
- [ ] Type check: `npx tsc --noEmit`. Current result: no errors (2026-11-10).
- [ ] In-game self-test in a fresh page: `node tests/play/selftest.cjs <abs path to built index.html> report.txt`. Phone viewport: `VIEW=810x253`. Not run in this review.
- [ ] Play-through: `node tests/play/play3.cjs <abs path to built index.html> <out dir>`. Not run in this review.
- [ ] End-to-end: `node tests/e2e.mjs`. Not run in this review.
- [ ] FPS on a real phone: owner only. Cloud browsers have no GPU and are not valid for FPS.

## 7. Playgama QA tools

- Local build: `get_local_game_qa_tool_link` gives the link to the QA tool for a local build. Use it for a first look before upload.
- Archive: `get_archive_qa_tool_link` gives the link after an archive upload. Use it for the final check.
- Both links are read-only. Never build a link by hand; take it from the answer.

## 8. Sign-off

| Field | Value |
|---|---|
| Build name and date | |
| Tester | |
| Devices and browsers | |
| Open FAILs | |
| Owner approval to upload (the owner must write "да") | |
