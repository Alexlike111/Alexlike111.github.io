# Audio

## STATUS: RECORDED CC0 / MIT SOUNDS (owner checks listed below)

Every file in `public/sfx/` is cut, layered, level-matched and loop-crossfaded from **recorded / pre-made library sounds**
(Kenney packs, CC0; Kenney Starter-Kit-Racing engine + skid, MIT; cynicmusic "Battle Theme A", CC0). Nothing is synthesised by
code at runtime or at build time any more. Playgama requirements 3.3.1 (real background music) and 3.3.2 (no code-synthesised
sound) are addressed by this set, with the **owner checks** below.

`node scripts/make-recorded.mjs --kenney <dir> --racing <dir> --music <file>` rebuilds `public/sfx/` from the source files (see "How the
files were built"). The old generators `scripts/make-sfx.sh` and `scripts/make-impacts.mjs` are a dev fallback only; they now refuse
to run without `ALLOW_PLACEHOLDER_SFX=1` because they would overwrite the recordings.

### Owner checks before upload (things this sandbox could not do)
1. **Network limits.** `kenney.nl`, `opengameart.org`, `freesound.org`, `itch.io`, `archive.org`, Sonniss, Pixabay, Mixkit, Wikimedia,
   `cdn.jsdelivr.net`, `unpkg.com` and `huggingface.co` all answered 403 from the build proxy. The files were taken from GitHub
   mirrors / npm (table below) that carry Kenney's own `License.txt` (CC0). Please re-download the original packs from kenney.nl
   once, confirm the same file names exist, and keep the page of each pack (and the OpenGameArt page of Battle Theme A) as proof for the reviewer.
2. **Battle Theme A licence** was confirmed only through the NOTICE of the `@netforge/asset-library-files` npm package ("page lists
   License(s): CC0; verified 2026-10-16"), not on opengameart.org itself. Open https://opengameart.org/content/battle-theme-a and
   check that it still says CC0. If it does not, replace `music.*` (race music).
3. **Digital Audio is synthesised.** Kenney's *Digital Audio* pack (retro bleeps) is made with a sound-effect generator by Kenney, then
   distributed as CC0 files. It is a delivered recording, not code in the game, but a strict reviewer might read 3.3.2 differently.
   Roles that use it: `countdown`, `go`, and half of `pickup`. If asked, swap those three for acoustic recordings of the same length.
4. **Sound design is by file name, not by ear.** The choice of Kenney files per role was made from duration, level and spectrum,
   not by listening in a browser. Play one race and one menu session with sound on and adjust the recipes in `scripts/make-recorded.mjs`
   (each role is one line) if anything sounds off; the gains in `MIX` (`src/audio/audio.ts`) and `CONFIG.audio` set the balance.

## Format
- `name.ogg` (Vorbis, primary) and `name.mp3` (fallback: Safari / iOS where decodeAudioData cannot read Ogg).
  `AudioManager` picks `ogg` when `canPlayType('audio/ogg; codecs="vorbis"')` is truthy, else `mp3`.
- 44.1 kHz. SFX are mono (ogg q3, mp3 80 kbps). Music is stereo, 64 kbps in both formats. Short sounds are soft-limited to -3 dBFS before encoding (the lossy encode can overshoot by a few dB, the master limiter covers it)
  with a soft-knee limiter (no hard clipping); loops are peak-capped at -3 dBFS (music -4.6).
- Loops (`engine`, `skid`, `scrape`, `music`, `music_menu`) are seamless: `scrape` and `music` have their seam crossfaded in the file,
  `engine` and `skid` are crossfaded at load by `seamlessLoop()` in `audio.ts`, `music_menu` is a Kenney loop used as delivered.
- Total: 2.8 MB for everything (ogg + mp3 of 41 sounds); the player downloads only one format.
- The collision families are delivered already at the RMS that `FAMILY_RMS` in `audio.ts` expects (first 0.3 s), so the load-time trim is about 1.

## Files and sources

All Kenney packs: author Kenney (https://kenney.nl), licence **CC0 1.0** (each pack's `License.txt`: "License: (Creative Commons Zero, CC0)",
credit not required, but given here). Source copy used for the build: the **Kenney Game Assets All-in-1 3.5.0** bundle committed in
the public GitHub repository `ArthurKValladares/SokobanGame` (commit `529ed651`, folder `assets/Kenney Game Assets All-in-1 3.5.0/Audio/`);
the Impact, Interface, Sci-Fi and Jingles packs were cross-checked against the Godot ports
`Boyquotes/kenney-impact-sounds-for-godot`, `Calinou/kenney-interface-sounds`, `Boyquotes/kenney-sci-fi-sounds-for-godot`,
`Boyquotes/kenney-music-jingles-for-godot` (same files, CC0 `LICENSE`).

| file(s) in `public/sfx/` | role / how the game uses it | made from (source file, layered in this order) | pack page | licence |
|---|---|---|---|---|
| `engine` | LOOP, player car, `playbackRate` 0.55..2.1 by rpm | `engine.ogg` (8 s, stereo to mono) | https://github.com/KenneyNL/Starter-Kit-Racing (commit `2f2e5f2`, `audio/engine.ogg`) | MIT, (c) 2023 Kenney |
| `skid` | LOOP, gain by slip | `skid.ogg` (3.5 s) | same repo, `audio/skid.ogg` | MIT, (c) 2023 Kenney |
| `scrape` | LOOP, car sliding along a wall | Foley `stoneDrag2` (1.4 s) + `platesSlide3` at -9 dB, 0.18 s seam crossfade | https://kenney.nl/assets/foley-sounds | CC0 |
| `music` | race music, 93.6 s loop (2 s seam crossfade built in) | "Battle Theme A" by **cynicmusic** (stereo) | https://opengameart.org/content/battle-theme-a | CC0 (see owner check 2) |
| `music_menu` | menu / results music, 30.8 s loop | Music Loops `Flowing Rocks` | https://kenney.nl/assets/music-loops | CC0 |
| `impact_light_1..3` | weak car-vs-car taps | Impact `impactMetal_light_001`, `impactMetal_light_002`, `impactTin_medium_003` | https://kenney.nl/assets/impact-sounds | CC0 |
| `impact_heavy_1..3` | layered under every strong hit | Impact `impactPlate_heavy_001/003`, `impactMetal_heavy_001` + `impactPunch_heavy_002/003/001` (thump) + Foley `stonesHit2/1` or Impact `impactPlate_heavy_004` (rattle) | Impact Sounds, Foley Sounds | CC0 |
| `impact_wood_1..3` | crate, barrel, tree, hay bale | Impact `impactWood_heavy_000/002/004` + `impactPlank_medium_000/002/003` | Impact Sounds | CC0 |
| `impact_metal_1..3` | guardrail, car-vs-car | Impact `impactPlate_medium_001/003/004` + `impactMetal_medium_000/003`, `impactMetal_light_003` | Impact Sounds | CC0 |
| `impact_concrete_1..2` | wall, curb, road chunk | Foley `stoneHit3/1` + Impact `impactMining_000/002` (low-passed 5 kHz) | Foley Sounds, Impact Sounds | CC0 |
| `impact_plastic_1..3` | cone, sign, tyre stack | Impact `impactSoft_medium_001/003/000` + `impactTin_medium_002/000`, `impactGeneric_light_001` | Impact Sounds | CC0 |
| `crunch_1..2` | strong hits, wall / guardrail break, part flying off | Impact `impactGlass_heavy_001/004` + `impactMetal_heavy_001` / `impactPlate_heavy_002` + Sci-Fi `explosionCrunch_000/003` (quiet) | Impact Sounds, https://kenney.nl/assets/sci-fi-sounds | CC0 |
| `debris_1..2` | prop / wall break, very strong hits | Foley `stonesHit1/2` + Impact `impactGlass_light_002` / Foley `platesHit5` (high-passed) | Foley Sounds, Impact Sounds | CC0 |
| `click` | UI button | UI Audio `click3` | https://kenney.nl/assets/ui-audio | CC0 |
| `buy` | purchase | RPG Audio `handleCoins` + Interface `confirmation_001` | https://kenney.nl/assets/rpg-audio, https://kenney.nl/assets/interface-sounds | CC0 |
| `error` | not enough money | Interface `error_003` | Interface Sounds | CC0 |
| `countdown` | start lights 3, 2, 1 | Digital Audio `pepSound3` (see owner check 3) | https://kenney.nl/assets/digital-audio | CC0 |
| `go` | GO | Digital Audio `powerUp8` (see owner check 3) | Digital Audio | CC0 |
| `finish` | player crosses the finish line | Music Jingles `jingles-steel_03` + `jingles-hit_09` | https://kenney.nl/assets/music-jingles | CC0 |
| `lap` | lap chime for the player (not on the final lap) | Interface `confirmation_002` | Interface Sounds | CC0 |
| `pickup` | item box pickup (AI cars: quiet, higher pitch) | Digital Audio `powerUp3` + Foley `pickup2` | Digital Audio, Foley Sounds | CC0 |
| `nitro` | nitro item used | Sci-Fi `thrusterFire_000` + Foley `woosh3` | Sci-Fi Sounds, Foley Sounds | CC0 |
| `boost` | boost pad | Foley `woosh3` + `woosh5` | Foley Sounds | CC0 |
| `shockwave` | shockwave item used | Sci-Fi `lowFrequency_explosion_001` + `explosionCrunch_000` | Sci-Fi Sounds | CC0 |
| `oil` | oil item used / car spins on oil | Sci-Fi `slime_000` + Foley `drip1` | Sci-Fi Sounds, Foley Sounds | CC0 |
| `shield` | shield item used | Sci-Fi `forceField_001` | Sci-Fi Sounds | CC0 |
| `shieldpop` | shield breaks | Impact `impactGlass_medium_001` + Sci-Fi `forceField_003` | Impact Sounds, Sci-Fi Sounds | CC0 |
| `repair` | in-race repair | RPG Audio `metalLatch` + `metalClick` + Interface `confirmation_003` | RPG Audio, Interface Sounds | CC0 |

Author of Battle Theme A: cynicmusic (OpenGameArt user "cynicmusic"). Local copy came from the npm package `@netforge/asset-library-files@0.2.0`
(`library/audio/music/battle_theme_a.mp3`, 96 s, 274 kbps), which lists the track as CC0 in its NOTICE.

`public/sfx/LICENSES.txt` ships the same list with the MIT text for the Starter-Kit-Racing files, so the notice travels with the build.

## Licences of the final files (for the Playgama form)

| source | author | licence | files |
|---|---|---|---|
| Kenney Impact Sounds, Interface Sounds, UI Audio, Foley Sounds, RPG Audio, Digital Audio, Sci-Fi Sounds, Music Jingles, Music Loops (kenney.nl) | Kenney | CC0 1.0 | all `impact_*`, `crunch_*`, `debris_*`, `scrape`, `click`, `buy`, `error`, `countdown`, `go`, `finish`, `lap`, `pickup`, `nitro`, `boost`, `shockwave`, `oil`, `shield`, `shieldpop`, `repair`, `music_menu` |
| Kenney Starter-Kit-Racing (github.com/KenneyNL/Starter-Kit-Racing) | Kenney | MIT | `engine`, `skid` |
| "Battle Theme A" (opengameart.org/content/battle-theme-a) | cynicmusic | CC0 1.0 | `music` |

## Behaviour (src/audio/audio.ts)
- **Music.** Two looping tracks, `music_menu` (menus, results) and `music` (live race). `update(player, dt)` decides: a live player car = race,
  no car for 0.35 s (and not paused) = menu. The two crossfade with a 0.55 s time constant (about 2 s). The race track restarts from its beginning each
  race (when it has been faded out for more than 2.2 s), the in-game pause menu keeps the current track (ducked to 45 %), a platform pause suspends the whole
  context. User music volume: `setMusicVolume(0..1)` (settings row Off / Low / Medium / Loud, stored as `settings.musicVol`, absent = full; `game.ts`
  `applyMute()` applies it). Tracks are decoded once and used without a second baked copy (a stereo 90 s buffer is about 33 MB).
- Collision pipeline (`onImpact`): material by `other` (wall/curb/road -> concrete, guardrail/car -> metal, prop -> plastic or wood; `break` events use
  `propType`), random variation (never the same twice in a row), +-4% random pitch plus lower pitch for stronger hits, volume ~ strength, heavy hits
  layer `impact_heavy` (+ `crunch` > 0.55, `debris` > 0.7).
- Loudness normalisation: each collision buffer is trimmed at load to its family's target RMS (`FAMILY_RMS`); the files already arrive there.
- Pile-ups: global min interval (`CONFIG.audio.impactMinInterval`), per-material interval, leaky energy bucket, max 6 impact voices (louder hit steals
  the quietest), master limiter instead of an impact-bus compressor.
- Ducking: every impact briefly dips the engine/skid/scrape bus (<= 45 %) and music (<= 35 %), then releases in ~0.3 s.
- AI-car impacts: volume x 0.6 x proximity^1.5 and a per-voice low-pass that closes with distance.
- Wall sliding: weak wall/guardrail/curb impacts are suppressed while `scrape` events arrive; a quiet looping `scrape` sample fades in/out instead.
- Race flow: `countdown` (3, 2, 1) and `go`, `lap` chime on each completed lap except the last (that one gets the `finish` fanfare), `repair`.
- Power-ups: `pickup` (own full volume, AI quiet), `nitro` (itemUse; the paired boost event is silent), `boost` (pads), `shockwave`, `oil` (item and spin-out),
  `shield`, `shieldpop`.
- The `AudioContext` is created lazily and unlocked by the first `pointerdown` / `keydown` / `touchend` / `click`.
- `setMuted(m)`: master gain (user setting and `platform.isAudioEnabled()`; the caller ORs them).
- `setPaused(p)`: hard pause = `AudioContext.suspend()` (platform pause event, ad open, tab hidden). Total silence.
  The manager also suspends itself on `document.hidden`.
- `setGameplayPaused(p)`: soft pause for the in-game pause menu: engine/skid silent, music ducked, UI sounds still play.
- `update(player, dt)` every frame (pass `null` in menus), `onEvents(events, playerId)` with the drained SimEvents.
  Impact/break/scrape volume falls off with distance from the player (`CONFIG.render.fx.shakeNearRadius * 1.4`).
- All volumes / rate ranges / rate limits: `CONFIG.audio` and `MIX` in `audio.ts`.
- Every method is a no-op when Web Audio or a file is missing.

## How the files were built (scripts/make-recorded.mjs)
```
node scripts/make-recorded.mjs --kenney "<...>/Kenney Game Assets All-in-1 3.5.0/Audio" \
  --racing "<Starter-Kit-Racing>/audio" --music <battle_theme_a.mp3> [--only name,name] [--dry]
```
Needs ffmpeg with libvorbis + libmp3lame. One recipe per output file: layers (source, offset, gain, optional low/high-pass), cut length,
fade, loop-seam crossfade (equal power), then a level stage (target RMS and a soft-knee limiter for the short sounds) and the ogg + mp3 encode.
No synthesis: only cutting, layering, filtering, fading, gain.
To swap a sound, edit its recipe (or drop in your own recording the same way) and re-run with `--only <name>`.
