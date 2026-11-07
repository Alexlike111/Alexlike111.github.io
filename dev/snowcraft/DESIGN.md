# SNOWCRAFT · Полярная ночь — game design v2 (authoritative; supersedes SPEC §4–§7)

**An original survival game about the High Arctic.** Not a mining-and-ore-tiers sandbox, not a roguelike. You are alone at a remote polar station when the polar night falls. The sun is gone for **12 days**. Snow is your building material, heat is your currency, fuel is scarce, the sea ice under the coast is alive, and a polar bear follows the wind. Survive until the first sunrise — or repair the radio and bring the icebreaker earlier.

Three pillars:
1. **Snowcraft** — snow is the craft. Probe its density, cut blocks with a snow knife, lay spiral courses that lean inward into a dome, pile and hollow a quinzhee, bank snow against drafty walls. The physics (support solver, heat, wind, snow load) judges the result. Every blizzard is an exam for your shelter, graded with stars.
2. **The cold is a body, not a bar** — core temperature plus hands, feet and face that frostbite separately, hydration (melting snow costs fuel), food and fat, fatigue, and wetness (work too hard in a warm parka and you sweat; sweat freezes later). Heat sources are physical: a seal-fat lamp in a closed igloo keeps you alive — and without a vent hole it slowly poisons you with carbon monoxide.
3. **The Arctic is alive** — the polar night calendar (a growing noon twilight band until sunrise), storms by forecast, pack ice that drifts and cracks with leads opening and refreezing, seals breathing at holes, a fox that robs caches, a bear that tracks your scent downwind, and Север, your husky, who barks before you can see the danger and sleeps against you for warmth.

Tone: quiet, cold, beautiful, tense. Long blue twilight, moonlit snow, aurora, the amber glow of an igloo lit from inside. Lore through notes of an earlier, failed wintering expedition (1890s, the ship «Заря») that the player gradually understands — and avoids repeating.

Visual identity (must NOT read as a forest/ore sandbox): **no trees anywhere** (above the tree line); rocky cape, tundra with lichen, a station, a gravel beach with driftwood and a whale skeleton, flat sea ice with pressure ridges, icebergs, a ghost ship. Palette: indigo/teal/blue-black night, moon-silver snow, aurora green/magenta, pink-orange twilight band on the southern horizon at noon that grows every day; warm amber is reserved for flame and lamplight (igloos glow through their walls). Ground blizzard: wind visibly streams snow along surfaces. Breath vapour. Frost creeping over the screen edges as the face freezes.

---

## 1. World (side view, left → right, 2048 × 768 cells; sea level ≈ y 300)
| zone (x cells) | content |
|---|---|
| 0–60 | cliff wall (world edge) |
| 60–360 **Cape & mine** | rocky hill/cliff; adit of the abandoned **coal mine «Шахта №3»** going into permafrost and rock: timbered tunnels (LOG/PLANK supports), rails, a cart, coal seams (COAL), a soapstone vein (SOAPSTONE), a collapsed section to dig through, a miner's hut chamber with a chest (lamp, pick, notes). Deeper: rock, an underground ice lake. |
| 360–520 **Old cairn** | hill with a stone cairn + tin box (note #1 of the 1890s expedition); lichen patches (LICHEN) on tundra; ptarmigan. |
| 520–900 **Station «Мыс Безмолвия»** | main house (LOG walls, PLANK floor/roof, GLASS window, door): stove (coal), bed, table (workbench), shelves (chest), **radio** (broken — 3 parts missing); generator shed with **fuel drums** (fixtures; diesel; a drum can become a brazier); meteo mast with anemometer + **barometer** (interact = forecast); kennel (Север starts here); a flag pole; supplies for ~2 days only. Wind gaps: the house is drafty until snow is banked against its walls (heat sim does this naturally — gaps are tiles of PLANK with low insulation; banking snow outside fixes it). |
| 900–1100 **Beach** | gravel shore (GRAVEL), **driftwood** logs half-buried in snow (WOOD, the main firewood), a **whale skeleton** (WHALEBONE ribs: strong, light structural material), shore ice piled into blocks (ICE), a tide crack. |
| 1100–1450 **Fast ice** | thick ICE over sea WATER (≥ 1.5 m), snow on top with wind-packed drifts (best block snow), **seal breathing holes** (small vertical shafts through the ice, rimmed with snow), an **iceberg** frozen in (tall ICE mass with an **ice cave** inside: shelter option, occasional calving), fishing spots. |
| 1450–1950 **Pack ice (drift)** | floes of varying thickness separated by cracks; **pressure ridges** (piled ICE blocks); **leads** of open water that open and close daily; thin new ice (cracks under you); the **ghost ship «Заря»** frozen in at x≈1750: METAL+PLANK hull listing in the ice, deck, cabin, hold: chest with radio part #1 and tools, captain's log (notes), coal bunker, sail CANVAS, timber. |
| 1950–2048 | open sea edge (deadly cold water), world edge. |
Below the sea: water column with fish (Arctic cod), seabed of gravel/rock. Below land: snow → permafrost (DIRT) → rock (STONE) → bedrock. Snowpack: fresh loose snow on top, wind slabs (PACKED with high density) in the lee of hills and ridges — the right places to cut blocks; scoured thin snow on windward crests.
Radio parts (for the icebreaker ending): **#1 лампа-триод** in the ship's chest; **#2 катушка** in the mine hut chest; **#3 аккумулятор** lies in the generator shed buried under a deep drift (dig it out). Plus the antenna wire: repair the fallen meteo mast/antenna (place 3 PLANK/WHALEBONE as a mast + rope).

## 2. Time, light, weather
> **SUPERSEDED by §18 (endless sandbox):** the 12-day polar-night calendar, the dawn win on day 12 and the fixed storm list below are the first ring only. The game is a seasons ring (night 12 d → twilight 6 d → night …) that never ends; storms are generated per ring (`ringStorms` in weather.ts), the ring-0 list below is the tutorial set.
- 1 real second = 2.4 game minutes → a day = 10 real minutes. Sleeping (warm + sheltered + bed/skins) runs time ×20.
- **Polar night calendar**: the sun's noon elevation rises from −9° on day 1 to +0.5° on day 12. Daylight = twilight function of elevation (civil twilight −6°…0°): day 1 gives a dim blue noon (~1.5 h of murky light), each day the twilight band on the southern horizon gets wider and warmer, day 10–11 the sky blushes pink-orange, **day 12 ≈ 12:00 the sun's rim appears → win** (cinematic: first light crawls over the ice, music swells, stats screen).
- Moon: phases over the 12 days (full around day 5–7: bright nights, readable); aurora on clear nights (some nights strong).
- Ambient: −22 °C (mild day, windy) … −40 °C (clear calm night); colder in clear calm, a little warmer in storms but windy. Wind 0–8 m/s normally; storms 15–25 m/s.
- **Storms («пурга»)**: scheduled fronts: night of day 2 (first exam, moderate), day 5 (24 h), day 8 (night), day 10–11 (the big one, 30 h). Each is forecast 6–10 game hours ahead by the barometer (station) and felt by the player (HUD barometer arrow once the player owns the pocket barometer, otherwise a hint "ветер меняется, небо затягивает"). During a storm: visibility drops (whiteout), ground blizzard, snowfall heavy, wind erodes loose snow walls on the windward side, drifts bury entrances on the lee side.
- **Storm exam**: when a storm starts, the shelter the player is in (or nearest built shelter) gets graded live and at the end: ★ insulation (wall thickness × density), ★ wind-tightness (wind inside), ★ warmth (inside temp held), ★ structure (support margin, damage taken); vent ok/CO. Result card + journal record; a run summary shows the best shelter of each storm.

## 3. The body (player.ts)
- **Core** °C (37 normal): heat balance = metabolism (rest 1, walk 2.5, hard work 5 relative; shivering adds below 36) − losses ∝ (34 − feelT)/(insulation × shelter factor) × (1 + wet). Feels-like = Environment-Canada wind chill. Targets (normal difficulty): clear night −35 °C, standing still in base clothes in the open: 37 → 35 in ~90 real s, death below 30 in ~4 real min; while working hard: neutral-ish; inside a closed igloo with a lamp: slowly warming; inside the station with stove: comfortable. Below 35: shivering (aim sway), slower; below 32: stumbles, confusion (screen frost, muffled sound).
- **Extremities** hands/feet/face 0–100 frost: rise when feelT is low and the part is uncovered/wet (mittens, kamiks, face mask/hood reduce a lot); fine work bare-handed (crafting, fishing, sewing) cools hands fast (crafting outside in −35 is a real decision). 40+ frostnip (warning, white patches on the body icon), 80+ frostbite: hands → actions ×0.6 speed, can't craft fine items; feet → walk ×0.7; face → frost vignette narrows view. Warming near heat recovers slowly; frostbite damage leaves a lasting penalty (scar) until treated (rest in warmth for hours).
- **Hydration** 100 → 0 over 1.5 days; drink water (melt snow/ice in the **pot** over fire/lamp/stove — fuel cost), eating snow directly restores a little but drops core by 0.3 °C each; tea gives water + warmth.
- **Food** (kcal) 100 → 0 over 2 days; fat-rich food (seal blubber, fat) gives a long warming effect; starving drains HP and lowers metabolism.
- **Fatigue**: work and cold drain energy; sleep restores; sleeping cold is dangerous (core keeps dropping while asleep — wake-up warning if core < 35.5).
- **Wetness**: falling into water (instant soak + cold shock: get out within ~20 s; rolling in powder snow afterwards blots water — real technique, works as an action), melting snow on clothes in warm rooms, **sweating**: core > 37.4 while working → sweat → wet. Toggle the parka open/closed (V / button) to vent heat. Dry at a fire/stove or drying rack.
- **HP** for injuries (bear, falls, collapses, explosion). Regen when fed, hydrated, warm and resting.
- Death causes named: «замёрз», «обморожение и истощение», «утонул в полынье», «медведь», «угарный газ», «обвал в шахте», «упал», «голод», «жажда».

## 4. Snowcraft & building (tools.ts, fixtures.ts)
- **Probe** (always): the cursor tooltip shows the material and, for snow/ice, **density in kg/m³** (snow aux → density) and ice thickness under the cursor (ice chisel needed for thickness of sea ice). Learning to read snow is the skill.
- **Snow knife** (start): cuts a **snow block** (2×1 tiles) from PACKED snow; block quality = density: < 220 crumbles to loose snow when cut; 250–380 ideal; > 420 hard to cut, heavy. Blocks are items carrying their density (stack by quality class: рыхлый/хороший/плотный).
- **Placing blocks**: tile-snapped, may lean: in **dome mode** (R) a block placed above and inward of a lower course is shaved to lean (structure solver treats corbelled courses as supported). Ghost shows support margin colour + reason, and the shelter preview (enclosed? vent?).
- **Shovel** (start): digs loose snow and carries a load (visible on the blade, ~1 tile), throws/places it (piles) — pile loose snow, wait for it to sinter (time + "disturbed snow sinters faster"), then hollow it = **quinzhee**. Bank snow on walls to insulate.
- **Ice chisel (пешня)**: opens holes in sea ice (for fishing/seal holes/water), tests thickness (tooltip), breaks ice blocks (ICE → ice item: melt for water — better than snow).
- **Axe**: driftwood, ship timber, whalebone; **pick** (mine hut): rock, coal, soapstone, ice faster; **saw** (ship): fast blocks and timber.
- **Other building materials**: driftwood logs (LOG), planks (PLANK from ship/station), whalebone ribs (WHALEBONE: long spans), stones (STONE), ice blocks (ICE: translucent windows), canvas (hide/canvas door = fixture), skins on floors (sleeping platform).
- **Shelter detection & rating** (shared with the storm exam): enclosure flood fill around the player; reports enclosed / vent present / wind inside / temp / CO. A **raised sleeping platform** above the entrance level keeps warm air (heat sim does it: warm air rises; an entrance tunnel lower than the floor is a cold trap) — the rating explains this in plain words when it applies ("вход ниже лежанки: тепло не уходит").
- **Carbon monoxide**: any flame (lamp, fire, stove without chimney) inside a closed enclosure without a vent tile (an air tile in the enclosure's top open to the sky through a small opening) accumulates CO for that enclosure; effects: headache warning → drowsiness → death if asleep. HUD shows a CO warning icon; the rating lists "отдушина: нет".

## 5. Fire, fuel & light
| source | fuel | heat | light | notes |
|---|---|---|---|---|
| костёр (campfire) | driftwood log 2 h, planks 1 h, coal 3 h | strong, wind-sensitive (open sky + wind cut it) | big | smoky; melts snow around it; can't be inside a snow shelter |
| жировая лампа (fat lamp: soapstone or tin) | fat/blubber 1 = 4 h | low (good in a small closed igloo) | small, warm | needs vent; the Inuit-style heart of the igloo |
| печка станции (stove) | coal 4 h, logs 2 h | strong, chimney (no CO) | medium | fixed at the station (and the ship cabin has one) |
| бочка-жаровня (drum brazier) | logs/coal/diesel | strong | medium | craftable from an empty drum; portable-ish (heavy item) |
| факел (torch) | — burns 1 h | tiny | medium, held | scares the bear a bit |
| фонарь (kerosene lantern) | diesel 6 h | none | good, held | found at the station |
Fire starting needs **matches** (limited box of 20 at start, a few more in caches) or the **flint and steel (огниво)** from the ship (unlimited, slower), plus tinder (lichen/canvas/paper) for logs/coal. Wind blows out a weak flame in the open.

## 6. Food, water, hunting & animals (fauna.ts)
- **Station rations**: a few cans/biscuits/tea — enough for ~3 days.
- **Seals** at breathing holes (fast ice): stand still near a hole, wait (the seal comes up every few game minutes; moving or noise scares it); harpoon when it surfaces (timing). Yields meat ×6, **fat/blubber ×4** (fuel + food), sealskin ×2. Seals also haul out near leads in calm weather.
- **Fishing** through a chiselled hole with a line: wait, tug minigame (simple timing). Cod.
- **Ptarmigan** on the tundra (thrown stones, snares). **Arctic fox**: scavenger, follows the bear, steals from unprotected caches (stone cache stops it), can be snared for fur.
- **Polar bear** (one, maybe a second late): roams the ice and coast. Has **scent tracking**: a coarse scent field (food, blood, fat, the player) advected by the wind field; the bear moves toward strong scent and investigates. Visibility & sound also count. Stages: wander → curious (approaches, sniffs) → stalk → charge. Deterrents: lit fire, flare gun (3 flares), loud noise (bang the pot), the dog's barking, being inside a strong building (logs/stone; it can **break snow-block walls** and lamp-lit igloos with weak walls), harpoon wounds. Running is bad. Killing it is possible but very dangerous. The bear telegraphs: tracks in snow, distant roars, the dog's growl/bark, a scent HUD hint.
- **Север (husky)**: follows, sniffs (shows scent direction when he points), barks at the bear 30–60 s before it's visible, retrieves ptarmigan, sleeps beside the player (+warmth), needs food (fish/meat) once a day; can be told stay/follow (interact). If hungry and cold he whines; he can die (avoidable; never randomly).

## 7. Drift & sea ice (events.ts / drift)
- The pack-ice zone is divided into floes separated by crack lines. Once or twice a game day (and during storms), wind drift **shifts floes horizontally by whole cells** (region move of all cells above the seabed between crack lines, including snow, structures and entities on top; tiles of water open on one side = a **lead**, on the other side floes press together and build a **pressure ridge** of piled ice blocks). Visual + loud cracking, the ground shakes; never under the player's feet without warning (the crack line glows/cracks first, sound 5–10 s earlier).
- Leads refreeze: open water → thin ice (new ICE crust, low thickness) → thick over days; thin ice cracks under weight (tooltip thickness, crack overlay, sound) and breaks.
- The ship drifts slowly within the pack; reaching it may require waiting for a lead to close or crossing new ice.
- Fast ice is stable; the tide crack near the shore opens a little at times.
- Iceberg calving occasionally drops ice chunks (cluster bodies) and a small wave.

## 8. Items & crafting (items.ts, recipes.ts)
Inventory: **belt** of 6 tool/quick slots (1–6, wheel) + **pack** 18 slots, weight limit (heavy items like logs, blocks, drums slow you; a **sled** (craft) carries 30 extra slots when dragged). **Clothing slots**: head (hood/mask), body (parka), hands (mittens), feet (kamiks/boots). Start: snow knife, shovel, wool mittens, felt boots, station parka (medium), wool hat; matches ×20; 2 cans, 1 tea.
Items (id → RU name): snow_block Снежный блок (quality), snow Снег (loose, in shovel), ice Лёд, log Плавник, plank Доска, bone Китовая кость, stone Камень, soapstone Мыльный камень, coal Уголь, lichen Ягель/мох (tinder), canvas Парусина, rope Верёвка, sinew Жилы, fat Жир, seal_meat Тюленина, fish Треска, ptarmigan Куропатка, cooked_meat Жареное мясо, fish_cooked Печёная рыба, can Консервы, biscuit Галеты, tea Чай (dry), water Талая вода (in pot/flask), sealskin Тюленья шкура, fox_fur Песцовый мех, bear_fur Медвежья шкура, scrap Железяки, tin Жесть, matches Спички, flint Огниво, flare Ракета, diesel Солярка (can), radio_triode Радиолампа, radio_coil Катушка, battery Аккумулятор, note Записка (lore id), pot Котелок, flask Фляга.
Tools: snow_knife Снежный нож, shovel Лопата, ice_chisel Пешня, axe Топор, pick Кирка, saw Пила, harpoon Гарпун, fishing_line Леска с крючком, torch Факел, lantern Фонарь, flare_gun Ракетница, barometer Карманный барометр.
Wear: wool_mittens / fur_mittens Меховые рукавицы, felt_boots / kamiks Камики, wool_hat / fur_hood Меховой капюшон+маска, station_parka / fur_parka Меховая парка; drying makes wet wear dry.
Fixtures: campfire Костёр, fat_lamp Жировая лампа, brazier Бочка-жаровня, pot_stand (котелок над огнём: put snow/ice in → water over time), drying_rack Сушилка, skin_bed Лежанка из шкур, hide_door Полог, cache Каменный тайник, snare Силок, sled Нарты (entity you drag), torch, mast (antenna), and existing: stove, workbench(table), shelf(chest), radio, drum, bed.
Recipes (station = within 5 tiles of the table/fire; **"тонкая работа"** marks hand-cooling bare-handed work):
| result | ingredients | where |
|---|---|---|
| campfire | log 2 + lichen 1 | anywhere (needs matches/flint to light) |
| fat_lamp | soapstone 1 + fat 1 + lichen 1 (wick) | table · тонкая |
| tin lamp (fat_lamp) | tin 1 + canvas 1 + fat 1 | table · тонкая |
| torch ×2 | log 1 + fat 1 (or diesel) + canvas 1 | anywhere |
| pot | tin 2 | table |
| brazier | drum (empty) + axe/pick use | at drum |
| drying_rack | log 2 + rope 1 | anywhere |
| skin_bed | sealskin 2 or fur 2 + lichen 2 | anywhere |
| hide_door | sealskin 1 + bone 1 | anywhere |
| cache | stone 6 | placed by hand |
| snare ×2 | rope 1 + log 1 | anywhere · тонкая |
| harpoon | bone 1 + log 1 + rope 1 + scrap 1 | table |
| ice_chisel | scrap 2 + log 1 | table |
| fishing_line | bone 1 + sinew 1 | anywhere · тонкая |
| rope ×2 | canvas 1 / sinew 2 | anywhere · тонкая |
| sinew ×2 | seal_meat (butchering yields it) | — |
| fur_mittens | fox_fur 1 or sealskin 1 + sinew 1 | table · тонкая |
| kamiks | sealskin 2 + sinew 1 | table · тонкая |
| fur_hood | fox_fur 2 + sinew 1 | table · тонкая |
| fur_parka | sealskin 3 + fox_fur 2 + sinew 2 (or bear_fur 1 + sinew 2) | table · тонкая |
| sled | plank 4 + rope 2 + bone 2 | table |
| cooked_meat / fish_cooked | raw 1 | at fire/stove |
| water | snow 2 or ice 1 in pot | at fire/lamp/stove (takes time + fuel) |
| tea (drink) | tea 1 + water 1 | at fire/stove |
| mast | plank 3 or bone 3 + rope 2 | at the fallen antenna |
| radio repair | radio_triode + radio_coil + battery (+ mast standing) | at radio → icebreaker ETA 2 days, must light a signal fire on the cape hill when it arrives (night) |

## 9. Objectives & pacing (quest.ts) — always visible top-centre, never more than one line
> **SUPERSEDED in part by §18:** the day-1 onboarding chain stays; «Запасы на 12 дней», «до рассвета» and the endings **Рассвет** / **Ледокол** are gone (the game has no win). After the chain the line is a rotating «next sensible thing»; the icebreaker only drops a supply crate.
Day 1 (tutorial, ~5 min to first win): 1 «Растопи печь» (coal from the shed, matches) → 2 «Проверь барометр» (forecast: storm tomorrow night) → 3 «Утепли дом: обложи стены снегом» or «Построй иглу» (shelter rating ≥ ★★) → 4 «Запасы на 12 дней»: soft goals tracked as gauges — fuel (hours), food (days), water. Then open goals list in the journal: «Найди жир: тюлени у лунок», «Уголь в шахте», «Плавник на берегу», «Корабль во льдах», «Почини рацию (0/3 детали)», «Сшей меховую одежду». Storm cards. Day counter + sun clock always visible. Endings: **Рассвет** (day 12 sunrise) and **Ледокол** (radio repaired → 2 days later the icebreaker's searchlight appears; signal fire → rescue). Free play after the ending is optional (the sun returns, light days).
Notes (lore.ts): ~14 notes from the 1890s «Заря» expedition (diary of the ship's doctor) scattered: cairn, mine, ship, iceberg cave, beach. They tell a story (the crew split, the ones who built snow houses and kept lamps lived longest, the ones who burnt the ship for heat early ran out by midwinter) and double as hints. Plus station log entries from the previous station keeper (modern).

**Status (merged playability line, v2.5):** the day-1 chain is a list of single steps, one line at a time: coal sack at the diesel shed (E; the arrow `objectiveTarget()` leads there, PICK_R 10 / AIM_R 5 in nearby.ts) → «Откопай дверь» (the east door is buried under the lee drift, DESIGN §13; a SOFT step: it is done by digging the door out, by getting into the house another way, or by lighting the stove, so a buried door never blocks) → stove (matches sit on the belt, slot 3) → barometer (west of the house, E beside the post) → keeper's log (shelf chest) → shelter ★★ built OUTSIDE the station out of cut snow blocks (arrow to the dense snow field west of the station) → doctor's diary → supplies as gauges. Shovel digs a tile in ~0.25 s (the door pit is ~20 tiles, under a minute), the knife cuts a block in ~0.5 s once the loose crown is shovelled off («сначала откопай снег»), blocks go straight to the BELT (inventory.ts `order`) so cut-place needs no trip into the bag. `unstuck.ts` frees a player buried in snow (hint after 1.5 s, automatic exit after 6 s; the U key).

## 10. UI identity (ui/*)
Instrument/expedition style but our own: dark night-blue glass panels, ice-blue lines, amber for heat. HUD:
- **Body figure** (top-left): a small pixel silhouette whose head/hands/feet tint from normal → white (frostnip) → grey-blue (frostbite); thermometer bar for core; drops for hydration, food ration icon, energy; wet indicator; CO icon when relevant.
- **Sun clock** (top-right): a semicircle dial showing the sun's noon depth below the horizon and the day "День 4 / 12", clock time, moon phase, barometer arrow (rising/falling) with forecast text when known.
- **Wind & scent** (top-right under the dial): wind direction arrow + speed + feels-like temperature; a faint scent cone hint when the dog points.
- **Shelter chip** (top-centre under the objective): «Укрытие ★★☆☆ · +3° · отдушина ✓».
- **Belt** (bottom centre): 6 slots with icons and durability; pack/clothes in the inventory panel.
- **Cursor tooltip**: material + density / ice thickness, action verb, reason when impossible.
- Panels: Inventory & crafting (belt, pack grid, clothes slots, weight, recipe list grouped: Огонь, Еда и вода, Одежда, Охота, Стройка; "тонкая работа" icon), Journal (objectives, storm reports, notes, map of discovered zones, "Как устроен снег" knowledge cards unlocked by doing), Pause/Settings (language, sound, quality, difficulty shown, hardcore flag), Title (live polar-night scene with an igloo glowing, "SNOWCRAFT" title in our pixel font, Новая игра: difficulty + hardcore + language, Продолжить, Самотест), Storm report card, Death, Ending.
Touch: left stick; right buttons: Действие (big), Прыжок, Взять/Исп., Пояс (wheel of belt), Сумка, Журнал, Парка (vent toggle) in a compact cluster; long-press Действие on a block ghost = rotate/dome mode.

## 11. What changes vs SPEC v1 (for agents)
- SPEC §4 (world), §5 (items/recipes), §6 (survival/objectives), §7 (UI) are REPLACED by this document. Engine sections (§1–§3) stay; tree felling stays available in the engine but is unused (no trees). Ore tiers, lava, crystals, forests, furnace/anvil progression are gone.
- New materials appended: WHALEBONE, SOAPSTONE, LICHEN (see materials.ts). WATER is sea water (freezes at −1.9 °C). OIL is used as spilled diesel.
- New systems: snow density in aux for SNOW/PACKED (density ≈ 60 + aux × 1.6 kg/m³ — sim compaction raises it), CO per enclosure, scent field, floe drift, extremities, hydration, sweat.

## 12. Inventory & looting (owner request, v2.1 — supersedes the inventory lines of §8)
- **Stacks + weight** (chosen by the owner): the pack is a list of slots holding stacks (no grid shapes). Every item has a weight (kg) and a stack limit; the pack holds up to **100 kg** (owner request): comfortable up to 60 kg, heavier = slower walk, more sweat, faster stamina drain, above 80 kg no running, at 100 kg nothing more can be lifted. The **belt** keeps tools/quick items (still 6). **Clothing** slots on the body figure. The **sled** is a second container with its own slots and higher limit while hitched.
- Panel operations, mouse and touch: drag & drop between pack / belt / clothes / sled / open container, tap-to-select then tap-to-place on phones, split a stack (half / one), merge, sort (by kind/weight), drop to the ground, quick-move (Shift+click / long-press), equip/unequip, use/eat/drink from the panel. Weight bar with the effect stated in words ("тяжело: медленнее, потеешь").
- **Searching containers takes time** (chosen): chests, shelves, carts, ship holds, cabinets, the backpack of a previous death. Opening shows "обыскиваю…" with progress; items appear one by one (each found item 0.6–1.5 s; bigger containers longer); the rest stays unknown ("… ещё что-то на дне") until searched. Outside in the cold, bare-hands searching cools the hands (fine work). Frozen containers (ship hold crates, iced lids) must first be chipped free with the ice chisel/axe. Searched state persists (saved). Buttons: Взять (selected), Взять всё, Положить (from the pack), close.
- **Nearby items**: items lying around (drops, sacks of coal, driftwood pieces, notes) within reach are highlighted; E takes the nearest one in front of the player; when several are near, a "Рядом" list (E held / button on phone) lets you choose. Small light items are picked up by walking over them only if the pack has room/weight; heavy items never auto-pick.

## 13. Snow amount (owner request, v2.1)
"По крышу в сугробах": open plains 1.5–2.5 m of snow (≈ 17–28 cells), drifts in the lee of hills, ridges and buildings up to 4–5 m (≈ 45–55 cells); the station is half-buried on its lee side — its door must be dug out at the start (a first, natural shovel task); snow cornices overhanging cliff edges and the iceberg (can break off), sastrugi ripples on wind-scoured flats; wind slabs (best block snow) inside drifts; snow on roofs. Storms visibly add snow and re-shape drifts. Fast ice keeps 0.3–0.8 m of snow (holes stay findable). Keep the sim cheap: deep snow is mostly PACKED below the top loose layer, so it sleeps.
**Status (implemented):** `src/game/snowpack.ts` (own hash noise, no `rand()` draws). Lee drift of the house = 30 cells above the floor, the spawn stands on it, the east door is buried (first objective «Откопай дверь», quest `door`); the barometer moved to the windward side. Lee snow field east of the cairn hill (up to ~3 m, ramp down to the station), deep cape lee ending in a snow cliff with a cornice (cut the root and it drops; none on the iceberg crest: a lip there closes the only way across the fast ice), lichen patches stay bare bowls (buried under the field east of x 494), thick roof snow, fast ice 0.3-0.8 m. Deposition scale `snowCfg` in `sim.ts` (game: rate 0.12, curve 2: a storm ~0.03 cells/s per column, calm weather ~nothing).

## 14. Owner requests queued (v2.2)
> **SUPERSEDED in part by §18:** «Balance over 12 days» and «Endings & atmosphere» (cinematic sunrise, icebreaker rescue end card) are replaced by the endless ring, the ramp and the death card; the other items stand.
- **Zoom**: the player can change the view scale. Desktop: Ctrl+wheel and +/− keys (plain wheel stays the belt); phone: pinch with two fingers on the world and small +/− buttons; Settings slider. Steps keep the pixel art crisp (integer device-px-per-cell scales, e.g. 2…7, clamped so at least ~200 cells and at most ~700 cells fit the width); the choice is remembered (localStorage, try/catch). Zoom out is useful for planning shelters and spotting the bear; zoom in for precise block work.
  **Status (implemented):** `src/engine/zoom.ts` (steps, default 400 cells on desktop / 250 on phones, `localStorage` key `sc.zoom` = cells across), Ctrl+wheel and +/- in `input.ts`, pinch and +/- buttons in `ui/touch.ts`, slider in the pause panel (`ui/zoomui.ts`), the title screen always uses the default framing.
- **Balance over 12 days**: an autoplay bot (scripted via __sc, time-compressed) plays full runs on each difficulty with a sensible strategy (stove + banked station, seal hunting, fishing, driftwood, coal sacks, igloo near holes, sleeping in warmth) and logs per day: fuel hours, food days, water, core min, frost peaks, storms survived, deaths. Tune so that Мягкая is comfortably winnable, Обычная is winnable with planning (resources tight around days 6–9 and the day-10 storm is the climax), Суровая is hard but possible. Report the curves.
- **Endings & atmosphere**: cinematic sunrise on day 12 (first ray crawling over the sea ice, the twilight band turning gold, music swells, Север howls, stats); icebreaker arrival with searchlight sweeping the pack ice and horn (signal-fire scene); storm report cards after every storm (stars, what held, what failed, one tip); musical moments (first aurora, first seal, first night in a warm igloo).
- **Live hunting**: fish (cod) and ptarmigan become real creatures (no timers): fish swim under the ice and gather near holes, a simple bite/strike timing; ptarmigan flocks on tundra lichen, flush when approached, stones/snares; tracks in the snow (fox, bear, ptarmigan, seal drag marks); Север retrieves birds and points at fish holes; animal state (dog hunger, bear position, seal holes) is saved.

## 15. Interactive objects (owner request, v2.3): «станция оживает» + a mix of extras chosen by the designer
Principle: every object is a small system with a state, a visible/audible reaction and a gameplay consequence (never decoration). Each has an interaction prompt, a sound, a save state, a self-test, and a journal/hint line.
**Station comes alive (all required)**
- **Дизель-генератор** (shed): needs diesel (drum/can), start pull (hold E, may fail in the cold: choke/warm it with a lamp nearby), runs N hours burning diesel; powers lights in the house (windows glow), the radio receiver and a small electric heater (strong heat, no CO). Loud: scares the dog slightly, carries sound (the bear can hear it). Stalls in a storm if the exhaust is buried by drift (dig it out).
- **Рация**: tune with ←/→ (dial minigame), hear forecasts (feeds G.forecast), strange numbers-station voices, the 1890s expedition echo (lore, subtle), distress call to the icebreaker after repair (existing ending flow).
- **Аптечка/шкафчик**: bandages and spirit; treat frostnip/frostbite (hold on the part in the body panel), spirit to disinfect; limited charges.
- **Чайник/плитка**: tea with water + warmth over time, shares the stove.
- **Метеозонд**: assemble (balloon + payload) and release to get a precise storm forecast and a map reveal of drifting floes for a day; consumable, found in the shed.
- **Патефон** (граммофон): plays a record (3 diegetic tracks, our own synthesized music); sleeping/resting near it restores morale/energy a bit faster; the dog likes it.
- **Двери, люки и ставни**: the house door opens/closes (draft sim), a roof hatch with a ladder to the roof (clear snow load!), window shutters to cut heat loss at night.
- **Печная заслонка**: stove damper (open = hotter/faster burn, closed = longer burn, risk of CO if closed with a flame and no vent).
**Extras (designer's pick, scoped small)**
- **Ship «Заря»**: ship's bell (ring to scare the bear for a while, also attracts the fox), hatch-shelter (enter the hold: wind-proof, cold), cabin stove, the captain's chronometer (a collectible key to a note).
- **Mine**: coal cart on rails (push along the rail to move coal; can run away downhill — danger), timber supports (knock out = cave-in).
- **Nature/ice**: torosy (ice hummocks — chop into ice blocks for walls/water), snow cornices (cut to drop them on purpose or by accident), whale ribs (take bone; the skeleton is an arch shelter with skins), frozen barrels on the beach (chip free, contents: diesel/rope), the fox's den with its cache (reward for tracking).
Implementation notes: reuse Fixture (state.ts) with `data` for state; add FixtureKind entries (generator, radio_dial, medkit, kettle, sonde, gramophone, hatch, shutter, damper, bell, cart, vent_door, torosa, cornice, barrel, den); art via src/art + draw.ts; behaviour in src/game/fixtures.ts (split big ones into src/game/fixtures_*.ts); sounds through the bus + sfxhooks; place them in locations.ts; self-tests for each.

**E priority around the stove (v2.5):** the kettle, the damper and the shutter hang within a step of the stove, so `pickUsableFixture` (tools.ts) ranks them behind it (+12): standing at the stove lights the stove; to use them point at them (the cursor / the hover label) or stand right under them. A CLOSED door the player faces wins over the roof ladder beside it, the barometer post wins over the ladder, the ladder is used when pointed at. **Play-checked (real input, desktop + 844x390 touch):** generator (hold E, the lamps come on, smoke from the roof pipe), radio dial (tune, lock, forecast; ◀ ▶ buttons on the phone), medkit, kettle (water + tea -> hot_tea into the pack), damper, gramophone (records), shutter, roof ladder, weather balloon (assemble, release, forecast), bells (station and ship), pushable coal cart. Nothing of §15 was cut.

**Status (implemented, v2.3):** `fixtures_station.ts` (generator, electric lamps + heater, medkit, kettle, gramophone, shutters, ladder, damper), `fixtures_radio.ts` (receiver dial, weather balloon, forecast hooks in weather.ts `wxHooks`), `fixtures_world.ts` (bells, pushable coal cart), `stationobjects.ts` (placement, own RNG), `stationui.ts` (dial), art in `art/fixtures_station.ts`, 3 synthesised records in `engine/audio.ts`. State lives in `fixture.data` (saved with the fixtures). The generator replaces the shed's second drum (that drum moved outside); its exhaust pipe goes through the roof and is buried by snow (stall). Beach barrels and the fox den are frozen / ordinary `chest` containers (looks `barrel`, `den`, 4 cells high). Cut as too small to be solid: torosy (the existing pressure ridges and shore ice blocks already give ice), ship hatch shelter (the ship already has a closed cabin below deck with its own stove), door draft sim (doors already toggle real cells). Old saves do not get the new objects.

## 16. Simplification (owner request): NO METHANE
Methane gas, gas pockets, gas explosions and the mine ventilation door are removed from the game. The mine stays dark and dangerous only through cave-ins (knock out timber supports), cold and the dark. Agents: do not generate METHANE or OIL pockets, do not build the vent door, drop the "взрыв метана" death cause and any methane hints/notes/tests. The engine material may stay in materials.ts (unused). Keep the design simple: when in doubt, cut a feature rather than add a system. Carbon monoxide in closed igloos stays (it is the "make a vent hole" mechanic).

## 17. Usable and carried items (owner request, v2.4) — all four groups chosen
Rule: every item is a real thing, not filler: ItemDef with weight (kg) and stack size, an icon (16×16), a name/description (i18n), a "Использовать" action (tap/hold on the belt or from the bag panel) with a visible effect and a sound cue, a source (start kit / station shelf, cabinet, shed / mine hut / ship chests / beach / craft via a technique from notes or experience), a self-test, and a first-use journal hint. Keep the list small and solid (~18 items); if one cannot be made meaningful, cut it. Items must work with the pack weight system and container search (§12).
**Тепло и здоровье**
- Термос (thermos): fill with hot water/tea at a fire or kettle; drink in 3 sips: warmth +1 °C over a minute and hydration; stays hot ~6 game h, then cools.
- Фляга (flask): carries water; freezes after ~25 real min outside at −25 °C unless kept inside the parka (stowed in the pack's "inside pocket" = body slot; shown with a frost overlay on the icon).
- Грелка (hand_warmer): a tin with a live coal; held in the hands slot it slows hand/face frost gain and warms hands for ~4 h; needs a coal and a lit fire to start; burns out.
- Бинт (bandage) + Спирт (spirit) from the cabinet/shelves: use on a frostnipped/frostbitten part in the body panel (treatment; frostbite scar heals in hours of warmth instead of days). Spirit only disinfects: drinking it feels warm but actually drops core temperature (hint in the item text, lore note).
- Жир-мазь (frost_balm): rub on hands and face before going out: frost gain −40 % for ~2 game h; costs a little fat (scarce).
- Очки (snow_goggles): needed against snow blindness in the bright twilight of days 10–12 and cut blowing-snow visibility loss in storms; worn in the new "face" wear slot (the only new slot; keep it simple).
**Ориентиры и безопасность**
- Компас (compass): HUD arrow/bearing to station, ship and marked spots; in whiteout it is the only way to know where you are going.
- Бинокль (binoculars): hold to look far ahead (camera look-ahead ×2); animals appear as markers within a larger radius when there is some light (moon/aurora/twilight).
- Шест-щуп (probe_pole): shows ice thickness and hidden voids/thin snow bridges 6 tiles ahead on use; fast to craft (log + rope).
- Ледоступы (ice_cleats): wear (gear slot with goggles? no — separate toggle on boots): no slipping on bare ice, faster on glare ice; slower on soft snow.
- Страховочная верёвка (safety_line): optional, only if cheap: tie to an anchor (door frame, mast, ship rail); if you fall in a lead within its length you climb out faster.
**Свет и сигналы**
- Фонарь «летучая мышь» (lantern): diesel, held light radius bigger than the torch, wind can blow it out in the open (relight).
- Ракетница (flare_gun) + Ракета (flare, 3 found: ship chest, station, mine hut): fired into the sky: lights the area 30 s, scares the bear for ~60 s, counts as a signal for the icebreaker finale.
- Дымовая шашка (smoke_flare): daytime marker visible from far; alternative way to guide the icebreaker.
- Свисток (whistle): calls Север; he comes, follows or stays (hold = stay).
**Хранение и переноска**
- Поясной подсумок (belt_pouch): +3 quick slots usable from the belt wheel.
- Усиленный рюкзак (big_pack): +6 pack slots and +20 kg limit, but +20 % sweat (sewn from sealskin/canvas, technique from a note).
- Мешок (sack): holds one bulk material (snow/ice/coal/lichen) up to 12 per slot at half weight; carrying wet snow makes your clothes wet.
Placement/wiring: new ItemDefs and recipes live in items.ts/recipes.ts (or items_extra.ts), found items are added to station/ship/mine chests in locations.ts, the use actions live in tools.ts (use-item handler) and the body/vitals hooks in player.ts, fixtures (kettle/cabinet) supply some sources.

## 18. ENDLESS SANDBOX (owner decision, v3.0) — supersedes the 12-day structure of §2, §9, §14 (balance/endings)
The owner does not want a 12-day game. SNOWCRAFT is an **endless survival sandbox: it lasts as long as the player lives**. There is no win and no end screen except death.
- **Seasons ring** (`src/game/seasons.ts`): a cycle repeats forever: polar night 12 days (sun never rises, stars/aurora) → 6 days of twilight «day» (low sun, short bright band, glare/snow-blindness risk) → night again. `G.cycle` (0,1,2…) counts completed rings and `G.day` keeps counting forever (no `endDay` cap; remove every use of the 12-day end: the «День N/12» HUD becomes «День N · Ночь/Сумерки · круг C»; no `ending` event for 'dawn').
- **Ramp**: each ring makes the world a little harder, capped: storm frequency and peak wind +8 %/ring (cap +80 %), ice drifts more often, thin-ice share up, bear aggression/speed +5 %/ring (cap +40 %), a second bear from ring 3. Difficulty levels (Мягкая/Обычная/Суровая, hardcore) still scale the base values and the ramp.
- **Goals**: only the day-1 onboarding chain (coal → door → stove → barometer → log → shelter ★★ → …) stays, to teach the loop. After it the top line shows a **rotating "next sensible thing"** (stock fuel for the next storm, hunt before food runs out, build a bigger shelter, find a site/note not yet found, craft something not yet crafted) instead of "до рассвета". No quest ever ends the game.
- **Radio / icebreaker / ship**: stay as optional content, NOT endings: the repaired radio gives storm and drift forecasts and sometimes a voice (lore), the signal fire / flares can call the icebreaker which **passes, drops a supply crate (fuel, food, a note, 1 flare) and leaves** (once per ring). Remove/replace the 'ending' event and the dawn/icebreaker end cards.
- **Death card** (the only end): days survived, ring, best/personal record (localStorage `sc.best`, try/catch), what you built / hunted / found, cause of death; buttons «Новая игра» / «Заново тот же мир». **Milestones** («вехи») toasts: 5 / 10 / 20 / 30 / 50 days, first ring finished, first twilight day, …
- **Balance target**: a prepared player can live >30 days on Мягкая and ~15–20 on Обычная; Суровая 8–12; resources (fuel, food) regenerate slowly through hunting, fishing, driftwood, icebreaker crates, so a skilled player can last indefinitely.
- Save/load keeps `cycle`, `day`, records. Old saves with endDay load as endless.

**Status (implemented, v3.0):** `src/game/seasons.ts` = ring math (`cycleOf`, `phaseOfDay`, `phaseName()`, `noonElevAtTime`), `ramp` (`rampAt(c, level)`, +8 %/ring storm and wind capped 1.8, drift +12 % cap 2.0, thinIce +10 % cap 2.0, bear +5 % cap 1.4; difficulty scales the increments ×0.7 / 1 / 1.25), `bearCount()` (2 from ring 3), `seasonLabel()` («День N · Ночь/Сумерки · круг C», C counts from 1), personal record `loadBest/saveBest` (localStorage `sc.best`). `G.cycle` is derived from `G.day` (`recomputeRamp()` on every day change and after load); `G.endDay` stays only as a dead field. Noon sun: -9° deep night, a smooth bell over days 12-18 with the maximum +0.6° on days 15-16 (day 13/18 ≈ -4.7°, 14/17 ≈ -1.4°). Twilight is up to 7° warmer, 35 % calmer, aurora -55 %. Weather events: `day`, `season {phase,cycle,day}`, `storm_*`; **no `ending` event any more**. Quest: milestones 5/10/20/30/50/75/100 days, first twilight, each finished ring (`wins` flags); `icebreakerPasses()` drops coal, logs, cans, a flare and an unread note at the signal fire and leaves (`questState.crateRing`, again after the next ring starts if the radio works). Death card (overlay.ts): days, ring, record, built / hunted / found, storms, best shelter, cause; «Новая игра» (new seed, same difficulty) / «Заново тот же мир» / «Вернуться на станцию» (not hardcore). Tests: `seasons.selftest.ts`.
