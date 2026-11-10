# SNOWCRAFT 0.14.0: status against the project rules and Playgama requirements (lead, measured)

UPDATE: on the owner's explicit instruction the archive was uploaded (Playgama build check PASSED), placeholder covers were uploaded and the SANDBOX WAS PUBLISHED: https://playgama.ai/play/q4wus3iavhanwx (game id cmwajeosz1jkfog0hdkosflqm, archive id cmwam8ifv1oc8og0hc426xycr). Catalog/moderation: not submitted; blockers for them: code-synthesized sound, AI-art risk, certification in the QA tool, verify-build not run.

Original assessment (before the upload): one hard blocker (sound) and verify-build was not run.

| Project rule (owner's list) | Status | Evidence |
|---|---|---|
| 1 HTML5 zip | DONE | release/snowcraft-playgama-v0.14.0.zip (index.html, playgama-bridge.js, playgama-bridge-config.json; 725 KB) |
| 1 Bridge ≥ 2.4.1 | DONE | @playgama/bridge 2.4.1 in the zip; initialises in the live test |
| 1 no Esc | DONE | Escape is not bound; I / C / Tab, P, ✕ buttons replace it (PG2) |
| 1 no Google Fonts / external resources | DONE | zero external requests in the live test; fonts are inlined |
| 1 sound not code | **BLOCKER** | all audio is Web Audio synthesis (src/engine/audio.ts); real ogg/mp3 needed, 99 cues listed in risks.md |
| 2 verify-build PASS + passport | PARTIAL | the verify-build tool and handoff/RELEASE-CHECKLIST.md are not in this chat's repo; passport verify/snowcraft-v0.14.0.json is hand-written with measured results |
| 2 live Playwright 1280×720 and 390×844 | DONE | scripts in this chat: no console errors, no scroll, Bridge init; 844×390 and 600×600 also checked |
| 3 interstitial after loss / «Ещё раз» | DONE in code | after the death card, before a new run (src/platform/bridge.ts); not seen on the real platform |
| 3 rewarded only opt-in | N/A | the game has no rewarded ads |
| 4 archive + passport to the shared project folder | NOT POSSIBLE here | games/ and verify/ are not reachable from this repo; both files are in release/ and verify/ and inside the single handoff archive |
| 5 upload only by the release thread | RESPECTED | no archive uploaded by this chat. NOTE: before the rules were known, this chat created the DRAFT game (id cmwajeosz1jkfog0hdkosflqm) and filled its form on the owner's yes: reuse it, do not create a second one |
| 6 catalog / submit / moderation | NOT TOUCHED | owner only |
| 7 covers | NOT DONE | 8 store screenshots are in playgama/screenshots/; covers (square 800×800, portrait 1080×1920, landscape 1920×1080) are for the covers thread |

Do NOT say «залить SNOWCRAFT 0.14.0 в песочницу» until the sound blocker is resolved and verify-build is PASS.

Other measured facts: tsc clean; sim 40/40; world 191/191; mine 20/20; in-game self-test 324/324 (desktop); Bridge storage backend replaces localStorage/IndexedDB in the PG build (no localStorage/indexedDB strings in the game bundle); language from Bridge, English fallback; 1308 strings × 9 languages (Bengali is not a Playgama language: not declared).
