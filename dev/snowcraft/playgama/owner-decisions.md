# SNOWCRAFT · owner decisions and preferences

Chronological list, taken from `DESIGN.md`, `SPEC.md`, `TERRARIA_CONTROLS.md`, `playtest/`, `design/`, `tests/balance/` and the owner's messages in this session. "Superseded" means a later decision replaces it. Items marked **open** still need an answer.

## Chronological decisions

| No | Date or version | Decision (owner's intent) | Source | Status |
|---|---|---|---|---|
| D1 | v2 design | An original Arctic survival game. Not a mining or ore-tier sandbox, not a roguelike. Snow is the building material, heat is the currency. No trees anywhere. | DESIGN header, §0, §1 | in force |
| D2 | v2 design | Three pillars: snowcraft (snow building judged by physics), the cold as a body (core, hands, feet, hydration, food, sweat), a living Arctic (storms, drifting ice, bear, dog). | DESIGN header | in force |
| D3 | SPEC §10 | Ten languages: ru (source), en, zh, hi, es, ar (RTL), fr, bn, pt, id. Default from the browser, switch in Settings and on the title screen. Russian is the source of all strings. | SPEC §10, `src/content/i18n.ts` | in force; default changes to Bridge for Playgama (D10) |
| D4 | SPEC §10 | Difficulty Мягкая, Обычная, Суровая, plus a Хардкор toggle (one life). | SPEC §10, DESIGN §18 | in force |
| D5 | v13 playtest | Playability first: the three pains are unclear goal, clumsy controls and nothing happens. | `playtest/PRIORITIES.md` (2026-11-07) | in force; **open**: fresh playtest after fixes (lead) |
| D6 | DESIGN §15 | Gramophone records are «our own synthesised music». | DESIGN §15 | **superseded for Playgama**: rule 3.3.2 forbids synthesised sound. **Open**: owner decides whether to commission real music. |
| D7 | DESIGN §17, §20 | Art and sound must be the owner's and «our own»; AI assistance is allowed, but there is no decision yet on human refinement of art. | DESIGN §17 (originality), Playgama 4.3.1 | **open**: who draws the art refinement, and budget |
| D8 | v2.1 | Stacks and a 100 kg pack limit. Searching containers takes time. Snow depth 1.5–2.5 m on plains, up to 4–5 m in drifts. | DESIGN §12, §13 | in force |
| D9 | v13 | Terraria-like mouse scheme: LMB use, RMB interact, Esc or I or C for inventory, P for pause, auto-pickup, belt of 6 cells. Phone layout unchanged. | `TERRARIA_CONTROLS.md` | in force, but **Esc conflicts with rule 1.5.2**. **Open**: which key replaces Esc (I and C already open the inventory; Tab is a candidate). |
| D10 | Playgama, 2026-11-10 | The language of the player comes only from the Bridge (`platform.language`), never from the browser. The game must start in English when the Bridge language is unknown. | Playgama rules 3.4.1, 3.4.2 | accepted (rule); implemented by PG1 |
| D11 | Playgama, 2026-11-10 | Progress is saved only through the Bridge storage. | Playgama rule 3.2.1 | accepted; PG1 |
| D12 | Playgama, 2026-11-10 | When `game_ready` is sent: at the first playable frame. **Open**: does the title screen count as playable? (The title has Start and New Game buttons, so it is interactive.) | Playgama required step 6 | **open** |
| D13 | Playgama, 2026-11-10 | Where interstitials appear. Recommended: death card, the start of a new game, the pause screen. Never during active play. **Open**: owner agrees or chooses others. | Playgama 2.1.2, 2.1.3 | **open** |
| D14 | Playgama, 2026-11-10 | Monetisation: none designed. **Open**: whether to add rewarded ads (e.g. one revive per attempt, a double reward) or purchases. | Playgama section 2 | **open** |
| D15 | DESIGN §18 | Balance target: a prepared player lives over 30 days on Мягкая, about 15–20 on Обычная, 8–12 on Суровая. | DESIGN §18, `tests/balance/report.md` | **open**: bot results missed all three (10.0, 8.2, 13.1 days). Owner decides whether to retune the numbers or the bot model. |
| D16 | Playgama, 2026-11-10 | Privacy and licence text: none added. **Open**: needed only if analytics, accounts or purchases are added. | Playgama 4.4.1 | **open** (low) |
| D17 | Playgama, 2026-11-10 | Partner platforms: none chosen. Options and their rules are in `compliance-matrix.md` section F. Russian-default partners (VK, Yandex) conflict with an English default. **Open**: which partners, if any. | Playgama platform-specific page | **open** |
| D18 | v13 | Self-test is shown on the title screen and in the pause menu. **Open**: hide it in the Playgama build? | SPEC §11, `src/ui/title.ts` | **open** (low) |
| D19 | DESIGN §16 | No methane, no gas explosions, no mine vent door. Keep the design simple: when in doubt, cut a feature. Carbon monoxide in closed shelters stays. | DESIGN §16 | in force; code still has leftovers (risks R18) |
| D20 | DESIGN §18 | Endless sandbox: no win, no ending except death. Milestones and the death card. Seasons ring: 12 nights, 6 twilight days, repeat. | DESIGN §18 | in force; the seasons ring is implemented |
| D21 | DESIGN §18 | The radio, icebreaker and ship are optional content, not endings. The icebreaker passes and drops a crate once per ring. | DESIGN §18 | in force |
| D22 | DESIGN §19 | The top principle: the player must be able to play and enjoy it. Judged by the first 15 minutes of a real player. Tests green is necessary, never sufficient. | DESIGN §19 | in force |
| D23 | DESIGN §20 | From scratch: the player wakes with almost nothing, builds an igloo first, and finds the station, ship and mine as expeditions. Physics as in Noita (fire, water, steam, collapse). | DESIGN §20, `design/from-scratch.md`, `design/noita-audit.md` | in force as the plan; **not built yet** |
| D24 | owner answer, 2026-11-10 (via lead) | Start with the snow knife **and the shovel** in the belt. (`design/from-scratch.md` section 1.1 still says knife only; it must be updated.) | owner answers (lead, brief for PG3) | in force; **doc to update** |
| D25 | owner answer, 2026-11-10 (via lead) | Body drain fixed to 1.5 days for water and 2 days for food (game days, not real seconds). Today the code uses half that. | owner answers; `design/from-scratch.md` section 1.1 | in force; **code not yet changed** (verify in `src/game/player.ts`) |
| D26 | owner answer, 2026-11-10 (via lead) | The derelict research station is found and revived mid-game (radio, generator, kettle). It is not the starting shelter. | owner answers; DESIGN §20 | in force; `design/from-scratch.md` section 1.3 |
| D27 | v13 | Phone keeps its layout (stick bottom-left, icon buttons). Only the desktop layout changes. | `TERRARIA_CONTROLS.md` | in force |
| D28 | SPEC §8 | FPS is measured only by the owner on a real phone. No FPS tests in the cloud. | SPEC §8, AGENTS_W5 | in force |

## Working preferences (from the repo and the brief)

- Simple first. When in doubt, cut a feature rather than add a system (DESIGN §16).
- Haiku-first agents. Each agent owns its own files, does not commit, and does not touch `.claude/`.
- Answers from agents are brief. Token, limit and credit use is reported as a reminder when long work starts.
- Ask before any publishing step. No upload, no publish, no sandbox, no application creation, no spending without the owner's explicit «да» (see HANDOFF.md section 8).
- Originality: the game's own art, names and world. Terraria is referenced only as a control scheme, never as content.
- Playtest with real input, not with scripts alone (AGENTS_W5 rule 4, DESIGN §19).
- The owner's language for talking to agents is Russian; store copy and in-game text follow the language table in `store-listing.md`.
