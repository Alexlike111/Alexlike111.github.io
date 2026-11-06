# SNOWCRAFT — spec & engineering contract

A 2D pixel survival-and-building sandbox in an endless polar winter. **Terraria's loop** (explore → mine → build → craft → discover, precise tile digging, a home you built) inside **a Noita-style world where every pixel is a material** with phase, density and temperature. Snow piles and packs, water flows and freezes, fire warms, melts and spreads, unsupported structures fall. Original game: original names, art and story (no assets, names or levels from any existing game).

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

## 4. World (game/worldgen.ts, locations.ts)
Left→right (x in cells, surface ≈ y 240–300): far-left **hunter's hut** (x≈260) in forest; **frozen lake** (x≈520–800, thin ice in the middle that cracks); forest; **Weather station** — start (x≈1000, flat plateau): small wooden house (LOG/PLANK) with door, stove, bed, chest (starter loot), broken **radio**, a **helipad** marked outside; hills; **hot spring** (x≈1250) in a hollow: warm water, steam, no snow around; **watchtower** on a hill (x≈1420, ladder-free: built with steps/platforms) with a chest; **avalanche ridge** (x≈1500–1800): steep slopes, deep packed snow slabs; beyond it the **plane wreck** (x≈1900): METAL fuselage half buried, chest with the **battery**. Spruce forests (trees 60–140 cells tall, F_TREE trunk WOOD + NEEDLES crown with snow on boughs) in patches, gaps around sites.
Snowpack 8–40 cells: loose fresh top, packed below, deeper drifts in lee (east) of hills. Under it frozen DIRT 10–30 cells, then STONE. Caves: noise worms + chambers; upper **ice caves** (ICE walls, icicles, frozen pools); mid caverns with **coal** (common, shallow), **copper** (mid), **iron** (mid-deep), **gravel** pockets, sealed **methane pockets** (5–8, faint green shimmer — a torch near them = explosion), **oil** pockets; a **warm grotto** with a hot pool (safe warm spot, notes); deep zone (y > 560): HARDROCK, **lava** pools, BASALT, **crystal geode** chambers (glowing quartz, iron pick needed) — the deepest goal. Bedrock bottom 6 rows and world edges. 6–9 caches (chests) in caves and sites with loot tables. bg walls set for everything below the original surface.

## 5. Items & recipes (game/items.ts, recipes.ts)
ItemDef: `{ id, name, kind:'block'|'tool'|'fixture'|'food'|'mat'|'wear'|'quest', stack, icon /*sprite key*/, desc,
  place?: matKey | FixtureKind, tool?: {type:'shovel'|'pick'|'axe'|'spear', tier, speed, dmg, dur}, food?: {food, warm?, hp?}, wear?: {slot:'body'|'feet', insul?, snowshoe?}, light?: rad, fuel?: minutes }`

Blocks (place material, F_PLACED): snow (Снег→SNOW), snowbrick (Снежный кирпич→SNOWBLOCK), ice (Лёд→ICE), dirt (Земля→DIRT), gravel (Щебень→GRAVEL), stone (Камень→STONE), log (Бревно→LOG), plank (Доски→PLANK), brick (Кладка→BRICK), glass (Стекло→GLASS). Stack 99.
Materials: stick (Палка), bough (Лапник), coal (Уголь), copper_ore (Медная руда), iron_ore (Железная руда), copper (Медь), iron (Железо), scrap (Металлолом), crystal (Кварц), hide (Шкура), feather (Перо), fat (Жир), rope (Верёвка).
Tools (dur = uses): shovel Лопата (shovel t0, start), hatchet Топорик (axe t1, dmg 8, start), pick_stone Каменная кирка (pick t1), pick_iron Железная кирка (pick t2), axe_iron Железный топор (axe t2, dmg 14), spear Копьё (spear dmg 18, reach +1 tile), torch Факел (held = light 7 tiles, placeable fixture, burns 2 game h when placed), lantern Фонарь (held light 10, no fuel).
Wear: fur_coat Меховая куртка (insul +0.8), snowshoes Снегоступы (no sinking in loose snow, +25 % speed on snow).
Food: can Консервы (+35), cracker Сухари (+15), choc Шоколад (+20, warm +0.3 °C), meat_raw Сырое мясо (+8), meat Жареное мясо (+35, hp +10), tea Хвойный чай (+5, warm +1.5 °C over 60 s).
Fixtures: campfire Костёр (2×1), workbench Верстак (3×2), furnace Горн (2×2), anvil Наковальня (2×1), chest Сундук (2×2), door Дверь (1×5, open = passable), bed Лежанка (4×1; sleep at night when sheltered & warm → skip to 07:00, sets respawn), snare Силок (1×1, catches hares over time), stove Печка (2×2, burns 6× longer than campfire, more heat), torch.
Quest: coil Медная катушка, battery Аккумулятор, resonator Кварцевый резонатор, flare Сигнальная ракета.

Recipes (station: hand = anywhere; others = within 6 tiles of the fixture; campfire/furnace/stove must be lit):
| result ×n | ingredients | station |
|---|---|---|
| stick ×4 | log 1 | hand |
| campfire | log 3, stone 3 | hand |
| torch ×3 | stick 1, coal 1 | hand |
| torch ×1 | stick 1, bough 2 | hand |
| workbench | log 4 | hand |
| bed | bough 10 | hand |
| plank ×4 | log 1 | workbench |
| brick ×2 | stone 2 | workbench |
| pick_stone | stone 3, stick 2 | workbench |
| spear | stick 2, stone 1 | workbench |
| rope ×2 | hide 1 | workbench |
| snare | rope 1, stick 2 | workbench |
| snowshoes | stick 4, rope 2 | workbench |
| fur_coat | hide 5, rope 2 | workbench |
| chest | plank 6 | workbench |
| door | plank 6 | workbench |
| furnace | stone 12, coal 3 | workbench |
| copper | copper_ore 2, coal 1 | furnace |
| iron | iron_ore 2, coal 1 | furnace |
| iron | scrap 2 | furnace |
| glass ×2 | gravel 3, coal 1 | furnace |
| anvil | iron 5 | workbench |
| pick_iron | iron 3, stick 2 | anvil |
| axe_iron | iron 3, stick 2 | anvil |
| lantern | iron 2, glass 1, coal 1 | anvil |
| stove | iron 6, stone 4 | anvil |
| coil | copper 4 | anvil |
| resonator | crystal 2, copper 1 | anvil |
| meat | meat_raw 1 | campfire |
| tea | bough 1, snow 1 | campfire |
| flare | fat 1, coal 1, stick 1 | anvil |
Start kit: shovel, hatchet, 3 cans, 2 torches, 4 logs. Station chest: 3 crackers, 1 choc, 6 stone, note #1.

Tool rules: dig time = `hard × 3` with the wrong tool kind, `× 1/speed` with the right kind; tier below `tier` → cannot ("нужна каменная кирка" / "нужна железная кирка"). Hands-only digging allowed for powders and needles (×4 time). Reach 5.5 tiles from the chest. Durability wears per dug tile; broken tool disappears with a toast. Mined tile → its `drop` item as a Drop entity that pops out and magnets to the player within 3 tiles. Placing: 0.12 s per tile, tile must be free of solids/powders/creatures, adjacent (4-neighbour) to a WALK tile or a fixture; structure preview colours the ghost.

## 6. Survival, goal and pacing (player.ts, weather.ts, quest.ts, events.ts, fauna.ts)
Clock: 1 real second = 1.2 game minutes (day = 20 real minutes). Daylight 08:00–18:00, 1 h twilight. Ambient: day −12…−18 °C, night −24…−30 °C, storms −6 more, slowly colder each day (−1 °C/day).
Body: core temperature heat balance. Losses ∝ (36 − feelT) / (insul × (1 − 0.45·shelter)) × (1 + 0.8·wet); gains: metabolism (walking/digging generate heat; shivering below 36 °C adds some), fires (radiant by distance and line of sight; strong within 4 tiles), warm air (tile temp). Tuning targets: night in the open without fire 37 → 35 °C in ~2 real min, death (≤ 30 °C) in ~5 real min; daytime while working ≈ neutral; standing at a fire warms ~+1 °C per 15 real s; a closed shelter with a lit fire stays comfortable; fur coat halves losses; wet ×1.8 (wet from water, from melting snow in a warm room if covered in snow, from snowfall over time outside). Feels-like uses the Environment-Canada wind-chill formula. Below 35 °C: blue frost vignette, slower, HP loss; below 32 °C stumbling. Food 100 → 0 in 2 game days; starving drains HP. Stamina for run/jump/dig. HP regen when fed & warm. Death screen names the cause ("замёрз", "упал", "завалило", "волки", "взрыв газа", "утонул в ледяной воде", "голод") and respawns at the bed (or station) with a dropped backpack of the inventory at the death spot (marker on HUD/map). "No death for nothing": every danger is telegraphed (barometer warning before storms, rumble + cracks before avalanches/cave-ins, ice crack sounds and visuals, wolves howl first, gas shimmer + hint "здесь пахнет газом").

Objectives (quest tracker always visible top-centre; journal lists all; each completion toasts + chime):
1. Наруби дров — get 3 logs (chop a spruce) → 2. Разведи костёр (craft + place campfire; first win < 5 min) → 3. Построй укрытие (closed space around you with a lit fire; HUD chip "Укрытие ✓") → 4. Сделай верстак и каменную кирку → 5. Найди медь (dig copper ore) → 6. Построй горн → 7. Сделай медную катушку → 8. Найди аккумулятор в обломках самолёта (east, beyond the ridge) → 9. Добудь железо и сделай железную кирку → 10. Спустись к кристаллам и сделай кварцевый резонатор → 11. Почини рацию на метеостанции (interact with all three parts) → call: "Вертолёт прилетит на рассвете. Продержись." — a blizzard and wolf night follows → 12. На рассвете зажги сигнальную ракету на площадке / meet the helicopter at the helipad → **win** screen with stats; option to keep playing (free sandbox).
Storms: night 2 (day 2 20:00 → day 3 04:00) then every ~1.5 days, warned 2 game hours ahead. Fauna: hares (surface, flee, leave footprints in snow, snares), ptarmigans (flocks, fly up when approached), foxes (rare), wolves (night/blizzard, packs of 2–3, howl first, flank, bite 8–12, fear fire within 8 tiles and the held torch, flee at low hp). Drops: meat_raw, hide, feather, fat.
Events: avalanche on the ridge (deep slabs on steep slopes released by explosions, loud digging under them or occasionally during storms; slab turns to rushing snow as flying cells + powder, buries what is below; rumble 3 s before), lake ice cracking under the player (thin ice: cracks spread with sound, break into floating ice + water; cold water = soaked + rapid cooling), methane explosions (fire/torch/lava touching gas), cave-ins (unsupported cave ceilings after digging, dust + rumble first), rescue finale. Discovering a site: toast + journal note + map marker.

## 7. UI (src/ui/*) — "field instrument" style
Dark navy panels (#0b1220 / #121c2b, 1 px #24364c borders, 6 px radius), ice blue accent (#7cc6ee), ember orange (#f0894a) for warmth/fire, ok green (#6cc59a), warn amber (#e6b84f), bad red (#e5604f). Pixelify Sans for labels/numbers/headings, Jura for longer text. Hand-drawn pixel icons from sprites.ts (no emoji). Everything readable on a 6" phone in landscape; touch targets ≥ 48 px; respects safe-area insets.
- Top-left vitals: HP, thermometer (core °C coloured), food, stamina, wet drop; line with air °C, feels-like °C, wind arrow + m/s; shelter chip.
- Top-right: day + clock + sun/moon, barometer/weather warning, small minimap (explored only, sites marked).
- Top-centre: current objective + toasts.
- Bottom-centre: hotbar (9 on desktop; on phones the selected item + quick slots), item name pop on change; durability bars.
- Cursor tooltip: target material/fixture name, tool requirement, ghost reason.
- Panels: Inventory + Crafting (one panel; recipes filtered by available stations, craftable first, missing items highlighted; drag/tap to move items; equip wear), Journal (objectives, notes, map tab, "Вещества" — materials learned with properties), Pause (resume, settings: sound/music volume, quality auto/low/high, x-ray toggle, controls help; new game), Title (logo "SNOWCRAFT" pixel title over a live animated world background, "Новая игра" / "Продолжить" if save exists), Death, Win.
- Hints: contextual one-liners for the first minutes (controls per device), never blocking.

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
