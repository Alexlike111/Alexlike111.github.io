# Audio sources and licenses

All files below were taken from OpenGameArt.org content pages whose license field
shows **CC0 1.0 Universal** only (verified on each page, 2026-11-03). CC0 needs no
attribution; the table is kept for the record.

Files are OGG Vorbis (libvorbis, quality 3). SFX are mono. Music is stereo.

| Output file | Event in game (audio.ts) | Source page (OpenGameArt) | Author | Source file in pack | Source length | Output length |
|---|---|---|---|---|---|---|
| twang.ogg | twang() bow release | https://opengameart.org/content/medieval-sound-effects-weapon-textures | Ben Jaszczak & Brian Nelson (Still North Media), submitted by MedicineStorm | English Longbow Shoot.wav | 4.00 s | 2.50 s (trimmed) |
| bow_draw_creak.ogg | creak() bow draw | https://opengameart.org/content/50-rpg-sound-effects | Kenney (kenney.nl) | OGG/creak1.ogg | 0.66 s | 0.66 s |
| arrow_hit_flesh.ogg | thwack() arrow hits body | https://opengameart.org/content/nes-sounds | Baŝto | sounds/arrow_hit.ogg | 0.95 s | 0.95 s |
| wood_hit.ogg | wood() arrow hits wood or ground | https://opengameart.org/content/100-cc0-sfx-2 | rubberduck | sfx100v2_wood_hit_01.ogg | 0.35 s | 0.35 s |
| wood_crack_break.ogg | crack() wood breaks | https://opengameart.org/content/35-wooden-crackshitsdestructions | Independent.nu (submitted by qubodup) | wood_impact/crack01.mp3.flac | 2.14 s | 1.20 s (trimmed) |
| explosion.ogg | boom() explosion | https://opengameart.org/content/synthesized-explosion | qubodup | synthetic_explosion_1.flac | 1.18 s | 1.18 s |
| splash_small.ogg | splash(false) water splash | https://opengameart.org/content/40-cc0-water-splash-slime-sfx | rubberduck | splash_02.ogg | 0.72 s | 0.72 s |
| splash_big.ogg | splash(true) big splash, KO | https://opengameart.org/content/40-cc0-water-splash-slime-sfx | rubberduck | splash_05.ogg | 1.18 s | 1.18 s |
| clang_helmet.ogg | clang() helmet hit | https://opengameart.org/content/100-cc0-sfx-2 | rubberduck | sfx100v2_metal_hit_01.ogg | 0.81 s | 0.81 s |
| hurt.ogg | hurt() player hit | https://opengameart.org/content/nes-sounds | Baŝto | sounds/hurt.ogg | 0.95 s | 1.00 s |
| slow_whoosh.ogg | slow() slow-motion whoosh | https://opengameart.org/content/swish-bamboo-stick-weapon-swhoshes | qubodup | swosh-03.flac | 0.58 s | 0.58 s |
| wind_loop.ogg | (not used by the game; wind loop requested) | https://opengameart.org/content/wind | IgnasD | wind/Wind.ogg | 6.64 s | 6.64 s |
| coin.ogg | coin() coin pickup, upgrade | https://opengameart.org/content/10-8bit-coin-sounds | Luke.RUSTLTD | coin1.wav | 0.36 s | 0.36 s |
| ui_click.ogg | click() UI button | https://opengameart.org/content/51-ui-sound-effects-buttons-switches-and-clicks | Kenney (kenney.nl) | click1.wav | 0.09 s | 0.09 s |
| win_jingle.ogg | win() level won | https://opengameart.org/content/victory | celestialghost8 | Victory.wav | 4.88 s | 4.88 s |
| lose_jingle.ogg | lose() level lost | https://opengameart.org/content/game-over-theme | CleytonKauffman | GameOver-Music/No Hope.ogg | 13.10 s | 4.50 s (trimmed) |
| sting.ogg | sting() studio logo (intro) | https://opengameart.org/content/85-short-music-jingles | Kenney (kenney.nl) | OGG/jingles_NES/jingles_NES00.ogg | 1.76 s | 1.76 s |
| music_calm_flowerbed.ogg | music loop, mood 0 (calm) | https://opengameart.org/content/flowerbed-fields-loop | Zane Little Music | flowerbed_fields.ogg | 105.93 s | 106.00 s |

Other sources checked and found CC0 but left out of the final set (size cap):
- Town Theme RPG, cynicmusic, https://opengameart.org/content/town-theme-rpg, CC0, TownTheme.mp3, 97.49 s.

## Notes
- Short files (under 0.4 s) cannot be measured for LUFS. Their gain is capped so the peak stays at or below -1 dBFS.
- Some transients are quieter than -16 LUFS because of that cap. Measured levels are in the report.
- The wind loop has not been checked for a seamless loop point.
- Trimmed files are cut from the source. Nothing else is changed except format and level.
