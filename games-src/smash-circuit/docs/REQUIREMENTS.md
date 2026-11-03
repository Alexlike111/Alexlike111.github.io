# Smash Circuit — game requirements (from Sasha, 2026-11-03)

Only game wishes and requirements are kept. Process rules of the old project are dropped.
Tags: [decided] = Sasha said it; [default] = chosen for her, to confirm; [rec] = recommendation.

## Platform
- Browser arcade top-down racing. Published only on Playgama via Playgama Bridge. [decided]
- Phone and PC equally, both checked from the start. Target 60 FPS on a mid Android. [decided]
- Focus: graphics, physics, destruction. Arcade, not a sim. Max content in v1, not a bare prototype. [decided]
- No player level editor, no online races. [decided]
- Languages: Russian and English from day one, all strings in a dictionary. [decided]

## Controls
- One finger on phone: GAS button bottom-right; steering = finger moves left/right of centre. [decided; conflict 11.3 → default: gas button]
- Auto-gas as an option, default manual gas. [rec]
- PC: arrows/WASD, Space = handbrake. [rec] (Esc is forbidden by Playgama 1.5.2 — pause on P.)

## Gameplay
- Lap race with timer, finish and places, 8 cars (player + 7 AI). [decided]
- Visible damage: smoke and sparks at low HP, power loss, steering pull, grip loss. [decided]
- Damage zones: front, rear, left, right, engine, 4 wheels, each with HP. Front → less power + pull; side → pull; rear → less grip; engine → lower top speed; wheel → less grip. [decided]
- Damage by contact impulse with threshold: rubbing a curb gives no damage. [rec]
- Repair for money, also on the pause screen. Repair by key (R). Flying-off car parts. [rec]
- Damage not kept between races. [default 11.11]

## Physics & destruction
- Everything on the map is destructible: walls, curbs, track, guardrails, props — one system, from the first step. [decided]
- Walls/curbs are segments with HP; impulse subtracts HP; HP ≤ 0 → segment breaks, a gap remains. [decided]
- Track tears in chunks that fly off. [default 11.6]
- Curbs are sensors: slow + shake, destruction is visual. [rec]
- Debris: visual, no physics, pooled, max 60, life 1–2 s, 2–3 pieces per break with fade. [decided / default 11.7]
- Light touch doesn't break a guardrail, a strong hit does. [rec]
- Bodies removed after the world step, not inside contact callbacks. [rec]
- Arcade car, strong lateral grip, GRIP = 8. planck.js. Fixed step 1/120 s. CCD on cars, walls thicker than per-step travel. [default]
- Physics targets: 0–100 km/h ≈ 4.1 s; brake 80–0 ≈ 23 m; handbrake drift; full lock at 15 km/h does not spin. [rec]
- 60 FPS on phone with 10 simultaneous breaks; physics step ≤ 4 ms. [rec]

## Graphics
- Three.js, orthographic top-down camera, low-poly 3D, cartoon style. [decided / default 11.4]
- Flat lighting, shadows, particles (dust, sparks, skid marks); quality presets, shadows/particles off on weak devices; pooling and instancing. [rec]

## Tracks & AI
- Fixed tracks from spline control points; 3 tracks in v1. [decided / default 11.5]
- Internal dev track editor (mouse points, export file), not for players. [decided]
- AI follows the spline; speed by curvature; avoids cars; simple overtakes; not predictable or dumb. [rec]

## Progression & money
- Upgrades: engine, grip, armor; 5 levels; values in config. One currency: repair + upgrades. [decided]
- Progress saved (Playgama storage). [decided]
- Rewarded ad doubles the race reward; interstitial between races; game paused during ads. [decided]
- In-app purchases: list not chosen → not built yet. Campaign leagues/stars: not chosen → only simple track unlock (top-3 opens next track). [default 11.10, 11.12]
- Local lap ghost (best lap), Playgama leaderboard for best lap. [decided]

## Sound
- Engine changing with RPM, impact sounds; Web Audio, unlocked by first touch. [decided]

## Conflicts with Playgama rules (found by coordinator)
- Playgama 3.3.2 rejects sound synthesized in code → ZzFX engine (7.5 default) is not allowed; real recorded ogg/mp3 files are needed.
- Playgama 3.3.1 requires background music → "music postponed" (7.4) blocks publication; music file needed before release.
- Playgama 3.2.1 forbids localStorage → progress only through Bridge storage.
- Playgama 2.1 / SDK step 7: interstitial at every natural pause, Bridge decides timing (no own timers).
