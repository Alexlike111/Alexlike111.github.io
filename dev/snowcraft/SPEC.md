# SNOWCRAFT — spec & engineering contract

**Game design lives in `DESIGN.md` (v2, authoritative): an original High-Arctic survival game — polar night, snowcraft shelters, the body, drifting sea ice. Not a forest/ore/mining sandbox.** This file is the engineering contract (engine, modules, process). Where they disagree on gameplay, DESIGN.md wins.

Language of all player-facing text: **Russian**. Code, comments, this spec: English.
Target: browser on PC and phones (landscape), 60 fps on a mid phone, one self-contained HTML file (Vite + vite-plugin-singlefile), no network at runtime. Fonts bundled via @fontsource (Pixelify Sans = display/HUD/numbers, Jura = longer text). Everything (art, sound) procedural or hand-written in code. No external assets.

## 0. Contract files (do not change shapes without need; if you must, keep backward compatible and note it in your report)
- `src/engine/grid.ts` — world arrays (`mat`, `aux`, `shade`, `flags`, per-tile `bg`, `seen`), chunk sleep `awake`, `wake()`, `setCell()`, `getM()`, `edited()`/`onEdit()` hooks, deterministic RNG + noise.
- `src/content/materials.ts` — materials as data + typed lookup tables (`PHASE`, `DENS`, `FLAM`, `MELT_AT`…). Systems use properties, not per-material branches, except where truly special (tree felling, snow compaction).
- `src/game/state.ts` — shared runtime state `G`, entity types (`Player`, `Drop`, `Fixture`, `Animal`, `Light`, `Slot`), `toast()`.

Scale: world 2048 × 768 cells, 1 cell ≈ 9 cm, y grows **down**. Tile = 4×4 cells (TS) = dig/place/heat/light unit (512 × 192 tiles). Chunk = 32×32 cells for sim sleep. Player AABB 8 × 20 cells (5 tiles tall). Sim tick = fixed 60 Hz (accumulate dt, max 3 ticks/frame).

## 1. Module map & public APIs
Engine never imports `src/game/*` or `src/ui/*` except `game/state.ts` (G) — engine may read `content/*`.

```
src/main.ts                boot, quality detect, fixed-step loop, window.__sc dev/test API
src/engine/
  grid.ts        CONTRACT
  sim.ts         initSim(); stepSim(dt) — CA over awake chunks inside G.win; snowfall deposition; reactions;
                 surfaceY(x): number (topmost cell that is not AIR/gas/fire; cached, lazy-updated); ignite(x,y)
  heat.ts        temp: Float32Array(TW*TH) °C; wind: Float32Array(TW*TH) local wind m/s (+ = east); sky: Uint8Array(TW*TH) 1 = open to sky
                 initHeat(); stepHeat(dt); tempAt(x,y); windAt(x,y); addHeat(x,y,power); shelterAt(x,y): 0..1;
                 enclosure(x,y): {closed:boolean, tiles:number} (flood fill of air tiles ≤ 900 tiles)
  structure.ts   initStructure(); stepStructure(dt) (time-sliced, ≤2.5 ms/frame); subscribes grid.onEdit;
                 supportPreview(cells:{x,y,m}[]): {ok:boolean, margin:number /*0..1*/, reason?:string}
  bodies.ts      clusters: Cluster[]; makeCluster(cellIdx:number[], vx=0, vy=0): Cluster|null; stepBodies(dt): {impacts:{x,y,mass,speed}[]};
                 fellTree(x,y,dir:1|-1): boolean  (captures connected F_TREE cells → toppling rotating sprite → lands → breaks into drops via callback)
                 onTreeLanded(fn:(x,y,logs,boughs)=>void); clusterHitsBox(x,y,w,h): {hit:boolean, speed:number}
  particles.ts   FX: spawnFx(kind,x,y,vx,vy,life,rgb?); flying cells: throwCell(x,y,mat,aux,vx,vy) (re-enters grid where it lands);
                 stepParticles(dt); arrays readable by renderer. Kinds: 'flake','spark','smoke','dust','chip','blood','steam','breath','debris'
  explode.ts     explode(x,y,radius,power): {destroyed:number} — throws cells as flying cells, fire, heat, damage callback onBlast(fn)
  phys.ts        moveBox(b:{x,y,vx,vy,w,h,onGround}, dt, o?:{stepUp?:number, swim?:boolean}) → {hitWall, hitCeil, landedSpeed, inWater};
                 boxFree(x,y,w,h): boolean (x,y = feet centre); solidAt(x,y) (WALK cells + body cells)
  light.ts       computeLight(view) per frame for visible tiles (+margin): sky light (from G.daylight, aurora, moon) propagated down open
                 columns and spread sideways, point lights G.lights, glowing materials; lightR/G/B Float32Array(view tiles); lightAt(x,y):[r,g,b]
  render.ts      initRender(canvas); resize(); render(dt); screenToWorld(sx,sy):[x,y]; worldToScreen(x,y):[sx,sy];
                 addLayer(z, fn: DrawFn) — modules draw in CELL coordinates on the low-res canvas (View/DrawFn + z rules in game/state.ts)
                 bodies.ts exports drawBodies(ctx,v) (z −20); particles.ts exports drawParticles(ctx,v,emissive) (z −10 / z 10); main registers them
  sprites.ts     pixel-art sprites as string grids + palettes; drawSprite(ctx,key,x,y,{frame,flip,tint,alpha,rot}); icon(key):HTMLCanvasElement (UI icons)
  camera.ts      updateCamera(dt, tx, ty, snap?) (smooth follow, look-ahead, clamp, shake decay)
  input.ts       input: InputState (below); initInput(canvas); endFrame(); touch UI (ui/touch.ts) writes into the same state
  audio.ts       sfx: init() on first gesture, mute, play(name,{vol,pitch,x?}), dig(mat), place(mat), step(mat,run), hit(), ambient({wind,storm,fire,underground,night,core}); music bed
  save.ts        saveGame(): Promise; loadGame(): Promise<boolean>; hasSave(); RLE-compressed grid + JSON state in IndexedDB
  prof.ts        prof.t(name, ms); overlay text; perf counters
src/game/
  worldgen.ts    generateWorld(seed): {spawnX, spawnY} — terrain, snowpack, caves, ores, gas/oil/lava pockets, trees, bg walls, calls locations
  locations.ts   sites: Site[] {key,name,x,y,w,h,found}; stampers for each location; chest loot tables
  weather.ts     stepWeather(dt) — clock, daylight, ambient temp, wind, snowfall, storms (+warnings), aurora
  player.ts      initPlayer(x,y); stepPlayer(dt); damage(n,cause); heal; vitals model; respawn(); breath/footstep events
  items.ts       ITEMS: Record<id, ItemDef>  (data, §5)
  recipes.ts     RECIPES: Recipe[] (data, §5); canCraft(r, stations): {ok, missing}; craft(r): boolean
  inventory.ts   inv = { slots: (Slot|null)[36] (0..8 = hotbar), sel: number, wear: {body?: string, feet?: string} };
                 add(id,n): number(left over); remove(id,n): boolean; count(id): number; selected(): Slot|null; select(i); onChange(fn)
  tools.ts       stepTools(dt) — uses input.primary on target; target(): {tx,ty,mode:'dig'|'place'|'attack'|'use'|'none', ok, reason?, progress};
                 dig / chop / place / attack / fell; drops; dig damage per tile (Map), crack stages; ghost preview data for render
  fixtures.ts    placeFixture(kind,tx,ty): boolean; removeFixture(f); stepFixtures(dt) (fuel, heat, light, smoke, snares); nearStation(kind,x,y);
                 interact(f) (fuel fire, open chest, door, sleep in bed, radio)
  fauna.ts       stepFauna(dt) — spawn/despawn around player, AI, footprints in snow, drops
  events.ts      stepEvents(dt) — avalanche, lake ice cracking, gas ignition, cave-in, blizzard fronts, rescue finale
  quest.ts       objectives chain (§6), journal entries, discoveries (materials learned), stats
  lore.ts        diary notes (RU text)
src/ui/
  hud.ts, panels.ts (inventory+craft, journal with map), menus.ts (title, pause, settings, death, win), touch.ts, wheel.ts, ui.css
```

### InputState (engine/input.ts)
```ts
{ moveX:-1..1, moveY:-1..1, run, jumpHeld, jumpPressed, primary /*held*/, primaryPressed, secondaryPressed /*RMB/use*/,
  interactPressed /*E*/, eatPressed /*F*/, craftPressed /*C or I*/, journalPressed /*J, M opens map tab*/, pausePressed /*Esc*/,
  wheelOpen /*Q held*/, smartToggle /*R*/, hotbar:-1|0..8, scroll:-1|0|1,
  aimX, aimY /*screen px*/, hasAim, aimMode:'mouse'|'touch'|'smart', touchActive }
```
Desktop: A/D move, W/Space jump, Shift run, mouse aim, LMB hold = use selected item, RMB / E = interact, 1–9 & wheel = hotbar, Q = radial quick menu, R = smart cursor toggle, C/I = inventory+craft, J = journal, M = map, F = eat, Esc = pause.
Phone (landscape only; portrait shows "поверни телефон"): left floating stick (up = jump, far = run). Right side separate buttons ≥ 56 px: **Действие** (big, hold), **Прыжок**, **Взять/Исп.** (E), **Еда**, **Инструменты** (opens radial wheel — tools/items only), **Сумка** (inventory+craft), **Журнал**. Touching the world (not on a control) aims there and holds the action. Smart cursor always on for the action button. Safe-area insets respected. Haptics via navigator.vibrate on hits/collapse where available.

## 2. Simulation (engine/sim.ts, heat.ts, structure.ts, bodies.ts)
CA rules (bottom-up scan, alternate x direction each row/tick, F_TICK parity to avoid double moves):
- **Powder** (SNOW, GRAVEL, ASH, EMBER): fall (up to 2 cells/tick through AIR/gas/lighter liquid), else slide diagonally with chance `SLIDE[m]` (wet snow ×0.3). SNOW: `aux` = compaction 0..255. Resting snow with something below gains compaction (sintering, faster under load & near 0 °C, much slower below −25 °C); at ≥ 200 it becomes PACKED (solid). Snow touched by water becomes F_WET. Snow landing in water floats (density 9 < 10) and freezes into a crust when cold.
- **Liquid** (WATER, OIL, LAVA): fall, diagonal, then spread up to `FLOW[m]` cells; denser sinks (displacement by `DENS`). Water at tile temp < FREEZE_AT freezes (surface-first: cells with air/ice above freeze faster). LAVA + WATER → BASALT + STEAM; LAVA ignites flammables, melts snow/ice to water/steam, cools to BASALT under FREEZE_AT.
- **Gas** (SMOKE, STEAM, METHANE): rise with jitter, drift with local wind; `aux` life counts down (METHANE never decays). STEAM condenses: < 0 °C → SNOW (it snows from steam!), else WATER drops when life ends near a ceiling.
- **Fire**: FIRE cells live `aux` ticks, rise, flicker, ignite neighbours with chance `FLAM[m]`; burning solids get F_BURN, emit FIRE above them, burn down `BURN_LIFE` then turn into `BURN_TO`. Fire is extinguished by water (→ STEAM) and melts adjacent snow/ice. METHANE touching fire → explode() chain (small radius per gas cell group, batched).
- **Phase changes from temperature**: per tile, using heat.temp: melt (SNOW/PACKED/SNOWBLOCK/ICE → WATER) when > MELT_AT (probabilistic, exposed cells first, consumes heat), freeze, boil.
- **Snowfall**: G.snowfall 0..1 → deposit fresh SNOW (compaction 0) on the surface of columns inside G.win with a rate up to ~1 cell per column per 4 s in a heavy storm; outside the window accumulate per-column counters and deposit when the column enters the window. Snow is caught by NEEDLES (snow on spruce boughs). Optional (nice): wind lifts loose surface snow (> 8 m/s) as flying cells and drops it in the lee → drifts.
- **Sleep**: only chunks with `awake>0` inside G.win (+½ screen margin) are processed; a chunk that moved anything stays awake; still chunks count down to sleep. Budget: ≤ 4 ms per frame on desktop for sim+heat at 60 Hz in a typical surface view.
- **Mass conservation** for liquids/powders (except intended phase changes/burning). Must be tested.

Heat (heat.ts): per-tile temperature. Conduction between tiles weighted by mean `COND` of their cells; capacity by mean `CAP`. Sky-open air tiles relax fast to G.ambientT (+ faster with wind); enclosed air tiles leak slowly (so a closed room with a fire gets warm — the core survival mechanic). Ground deep below the surface relaxes to a geothermal profile: −4 °C a few tiles down, rising to ~+8 °C in deep caverns, ~+30 °C near lava. Sources: cells with `HEAT[m]` (fire, embers, lava), fixtures (campfire/stove/torch via addHeat), player body (small). Wind field per tile row: ambient wind attenuated behind blocking tiles (shelter shadow) and by vertical profile near the ground. `shelterAt` combines sky openness and wind.

Structure (structure.ts): cells of materials with `SPAN>0` that are **not anchors** (anchor = ANCHOR material without F_PLACED, plus BEDROCK, plus tree trunks rooted in ground) need support. Dijkstra-like support flow from anchors through structural cells: going up/straight down costs little, sideways costs 1 per cell (a cell may be at most `SPAN[m]` cells of horizontal travel from vertical support), diagonal in between, so arches and corbelled igloo domes hold while flat wide snow roofs fail. Failing connected groups that touch nothing structural become **falling clusters** (bodies.ts); failing groups still attached crumble: snow types → loose SNOW, others → cluster. Triggered by `edited()` regions (dig/place/explosion/melt events) + a slow sweep around the player. Time-sliced. `supportPreview` lets the build ghost show green/amber/red with a reason ("нет опоры", "слишком длинный пролёт").

Bodies (bodies.ts): a cluster = cell list with float position & velocity, translation only (no rotation), gravity, collides with WALK cells, stamps back into the grid on landing. Hard landings (speed > threshold) break fragile materials (snow types → SNOW powder burst, ICE → some shards as flying cells). While falling, clusters are drawn by the renderer from their cell list. Damage to player/animals on contact by mass×speed. **Tree felling** is special: fellTree captures the tree (connected F_TREE cells) into an offscreen sprite, animates a rotation about the base toward `dir` (accelerating like a real topple, ~1.2 s), throws snow off the crown (flying cells), on impact: thump, shake, dust/needle burst, then calls onTreeLanded → game spawns drops (logs ≈ trunk cells / 40, boughs) along the fallen length.

## 3. Rendering (engine/light.ts, render.ts, sprites.ts, camera.ts)
- The world canvas is **low resolution: 1 canvas pixel = 1 cell**, CSS-upscaled with `image-rendering: pixelated` by an integer factor s (2..6 device px per cell, chosen so ~380–440 cells fit the screen width; phones ≥ 2). Canvas is 2 cells larger than the view; sub-cell camera offset is applied with a CSS transform so motion is smooth. DOM UI sits above at native resolution.
- Per-cell colour: material base colour × procedural texture (64×64 per material generated at boot by `tex` kind: snow sparkle, wood grain, plank/log/brick patterns, strata, ore specks, crystal facets, metal panels) × `shade` variation. Edge shading: top surface of solids/powders brighter (snow rim), undersides darker, depth-from-air AO darkening (cheap distance-to-air per tile).
- Liquids: animated surface highlight; water slightly translucent over background. Fire/lava/embers: animated flicker colours. Gases: alpha by life.
- **Light**: tile light map (RGB) computed each frame for the visible tiles + margin: sky light enters open columns (strength = G.daylight, moon, aurora tint) and spreads/attenuates through cells by `LIGHT[m]` (snow walls glow softly from a fire inside an igloo; ice is translucent); point lights (G.lights: fires, torches, lantern, crystals, lava) by flood fill with falloff. Upscale the light map smoothly (bilinear) and multiply onto the world; then additive glow pass for emissive cells (fire, lava, crystals) and a soft bloom around bright lights. The player always has a faint personal light (radius ~2 tiles) so they never vanish at night. Underground without light is black.
- Background: sky gradient by time of day (dawn/dusk colours), stars, moon/sun, **aurora curtains** at night (animated, signature visual), 3 parallax layers of procedural mountains and distant spruce forest silhouettes, tinted by daylight. Underground: bg wall texture by `bg` tile type (darkened, lit by light map).
- Overlays (via addLayer from game code): player & animal sprites lit by lightAt, held tool rotating toward the aim, target tile frame, dig cracks (4 stages), build ghost (green/amber/red + reason label), drops (bobbing icons), fixtures (campfire flames animated, torch, workbench, furnace glow, chest, door, bed, radio, helipad, helicopter), falling clusters, toppling trees, particles, weather (layered snowflakes with parallax; blizzard streaks + white fog by G.visibility), frost vignette when core < 35.5 °C, red flash on damage, screen shake.
- Camera: smooth follow with look-ahead toward movement/aim, vertical dead zone, clamp to world.

## 4–7. World, items, survival, UI
Replaced by DESIGN.md (v2). Engine-level notes kept: fixtures with solid footprints write MAT.FIXTURE + F_FIXTURE cells; non-solid fixtures (campfire, lamp, torch, bed, snare, cache, rack) are entities only. Player-facing text only via i18n `strings()`.

## 8. Quality bar, tests, critique
- 60 fps target; quality ladder: auto-lower sim window, light margin, particle counts, glow when fps < 50 for 3 s (G.quality).
- `window.__sc` dev/test API (main.ts): `{ G, start(), step(frames), teleport(x,y), give(id,n), setTime(min), setWeather(o), act(kind, x, y, seconds), place(id,tx,ty), craft(recipeIndexOrResult), kill(), stats(), fps(), shot? }` — keep it working; tests depend on it.
- `tests/sim.test.ts` (tsx, headless): mass conservation, pile angle, water levelling, freezing/melting, fire → ember → ash, steam → snow in cold, support: snow-block arch holds / flat span fails, cluster lands, explosion, performance timing.
- `tests/e2e.mjs` (Playwright Chromium, `require('playwright')` works globally): boots the built `dist/index.html` (or vite preview), fails on console errors, runs scripted scenarios through `__sc`, saves screenshots to `shots/` (desktop 1600×900 and phone 844×390 touch). **No FPS/performance measurement in the cloud browser** (headless, no GPU) — the owner measures FPS on a real phone via the self-test; agents just write efficient code.
- Critique & ratings rounds after integration: UI critic, game-design critic, player-rater (rubric 1–10). No perf tester (FPS is checked by the owner on a phone). Fix until no critical issues remain.

## 9. Agent rules
- Own only the files assigned to you; you may add small helper exports to contract files if strictly needed (note it). Do not rewrite other agents' modules — leave a `// TODO(owner):` note and mention it in your report.
- `npm run check` must pass for your files before you finish (ignore errors only in files owned by agents running in parallel with you, and say so).
- Prefer data over branches, typed arrays in hot loops, no per-frame allocations in hot paths.
- Report back: files written, public API deviations from this spec, known gaps, test results.

## 10. Localisation & difficulty (added)
- **i18n** (`src/content/i18n.ts`, CONTRACT): all player-facing text goes through `strings(ns, {key: 'Русский текст'})` declared in the module that uses it (RU is the source), `fmt()` for placeholders, `tr('mat.KEY'|'item.id', fallback)` / helpers for data names. 10 languages: ru, en, zh, hi, es, ar (RTL), fr, bn, pt, id; default = browser language, switch in Settings and on the title screen. Translations are JSON packs in `src/content/lang/<code>.json` produced later by translator agents from `dumpSource()`. Fonts: Pixelify Sans/Jura cover Latin + Cyrillic; other scripts fall back to system fonts (font stacks must include system-ui). UI must tolerate 40 % longer strings (no fixed-width text boxes that clip) and RTL for Arabic (dir=rtl on panels, HUD mirrored is NOT required).
- **Difficulty** (G.diff, DIFFS in state.ts): chosen on New Game — Мягкая / Обычная / Суровая — plus a **Хардкор** toggle (one life: death ends the run with a stats screen; otherwise respawn at bed with a backpack). Systems multiply rates: cold (body heat loss), hunger, wolves (pack size/aggression/damage), loot (cache amounts). Normal = the tuning targets in §6.

## 11. Built-in self-test (added — the player runs it on their own device and pastes the report)
`src/game/selftest.ts` (CONTRACT): `registerTest(group, name, async t => …)`, runner `runSelfTest(filter?)` with a live overlay and a copyable report (device, GPU, fps, metrics, pass/fail, console errors). Entry points: title screen button **«Самотест»** and URL hash `#selftest` (auto-runs after boot). Report/overlay text is developer-facing (RU, not translated).
**Every agent from wave 2 on registers tests for its own systems** in a `src/<area>/<module>.selftest.ts` file imported by main.ts (one file per owner, no shared edits). Cover every element: each material (dig time per tool, drop), every tool, every block placement, every recipe (craftable with ingredients, result appears), every fixture behaviour (campfire fuel/heat/light, torch, furnace smelting, anvil, door passable, chest store/take, bed sleep, snare catch, stove, radio repair), sim scenarios (pile, flow, freeze, melt, fire spread, steam→snow, collapse, cluster fall, tree felling, explosion), survival (cold at night outside, warming at fire, shelter detection, wetness, hunger, death causes, respawn/backpack, hardcore), fauna (spawn, flee, wolves attack, fear fire, drops), events (blizzard warning, avalanche, ice crack, gas explosion, cave-in), the whole quest chain fast-forwarded with `give`, save→load round trip, every UI panel opens/closes, touch + keyboard input paths, all 10 languages render the HUD/menus with no missing keys and no overflow, audio init, all difficulty presets, fps at surface day / night / cave / storm / big collapse. Tests must restore state (start a fresh world before destructive scenarios) and be deterministic where possible. The whole run should finish in ≤ 5 min on a phone.
