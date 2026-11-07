# Balance bot (DESIGN §18, endless sandbox)

`bot.cjs` plays one SNOWCRAFT run per process, time-compressed, with a fixed routine that models a
reasonable novice who follows the goals. It prints one line per game day and a `RES {json}` line at the end.
Results and the tuning history are in `report.md`.

## Usage

```
node tests/balance/bot.cjs <abs index.html> --diff 1 --seed 1 --days 40        # one run, day table on stdout
node tests/balance/bot.cjs <abs index.html> --matrix --par 3 --out <dir>       # 3 difficulties x 2 seeds (hardcore off)
node tests/balance/bot.cjs <index.html> --diff 2 --set stoveFeedBelow=240      # override a routine constant
```

Build first: `npx vite build --outDir $SP/B --emptyOutDir`. Playwright is taken from `playwright` or `/opt/node-tools`.

## How the page is driven

- The init script stubs `requestAnimationFrame`, so the game loop never runs by itself. The bot is the only clock:
  `window.__sc.stepFast(n)` (no rendering). One frame is 1/60 s of body time = 0.04 game minutes (`MIN_PER_SEC` 2.4).
- All decisions are made inside the page (`installBot`), through `window.__sc` and `__sc.mods`
  (`fixtures`, `inv`, `player`, `quest`, `seasons`). Nothing in the game code is changed by the bot.
- Walking is `__sc.teleport`. Its time is charged before the jump (`dist × 0.0889 game min per cell`,
  i.e. 27 cells per body second): a walking body makes heat, so the walk is not charged as standing in the cold.
- The game's own sleep warp (x20 while asleep) is used through the bed (`sleep_request` → `startSleep`, not forced).
- Game time moves only in `stepMin()`; each decision cycle is `chunk` = 10 game minutes.

## Routine

Day 1 chain (`chain()`): pick up the nearest coal sack, loot the shed chest (coal), light the stove with the matches
(`addFuel` + `tryLight`, the real code), read the barometer (`interact`), take the notes out of the station chest and read
them (keeper's log). The door is not dug out (we walk in) and no igloo is built; the chain stops there.

Every decision cycle (`cycle()`), in this order:

1. **Stove**: below 4 h of burn feed coal, then logs, then planks (`addFuel`) up to 7 h. Relight with matches when out.
   The stove is also topped up every 30 game min while the bot is away (trips) and filled to 9 h before sleeping.
2. **Damper**: half open all the time. It is opened (position 2) only while the shelter reports CO (`G.shelter.co > 5`).
   A closed damper is NOT used: with it closed the sealed house fills with CO (measured 0.6 -> 3.1 in 6 game minutes,
   almost no decay), and a first version of the bot died of CO on day 6 that way. Shutters do not vent the house.
3. **Cooking**: while the stove burns, raw fish / ptarmigan / seal turn into cooked food (5 game min each).
4. **Water** (below 40): drink a `water` item if carried; otherwise melt snow in a pot placed on the stove (real
   `placeFixture('pot')` + `interactPot`, 2 snow → 1 water in about 30 game min of heat); melted water is taken out.
5. **Food** (below 40): eat the best carried food (`eatSlot`): cooked meat, cooked fish, cans, biscuits, fat, raw fish…
   When the pack has no food the bot fetches it from the house chest at once. Food is counted from the pack only
   (`suppliesNow()` also counts chests the bot has not visited; an early version starved on a "3 days of food" reading).
6. **Sleep** (energy below 30 and core ≥ 35.5): walk to the bed and `interact` it; the game's `startSleep` decides.
7. **Supplies** (not in storm, no storm forecast within 90 min): fuel trip when stove + pack fuel is under 24 h; food trip
   when the pack holds less than 60 food points (about two days), or at once when hungry with no food. Trips have a
   6-hour cooldown (30 min when hungry). Fuel trip = loot coal and logs from
   chests and carts (the real stock: 14 coal in the shed, 4 per cart), pick up coal lying in the snow (4 per sack),
   then driftwood (model, below). Food trip = loot food from every chest holding food (real stock, cans, biscuits,
   fat, ptarmigan), then one fishing hour at the hole (model, below).
8. **Shelter**: the bot waits in the station house between trips. During a storm (`G.storm > 0.3`) it does not leave.
9. Advance the clock 10 game minutes.

## Model assumptions (the weakest part)

These are the only places where the bot is given resources instead of finding them in the world, or where a game
mechanic is simplified. Each one changes the answer; the report says which.

| Assumption | Value | Why |
|---|---|---|
| Driftwood (logs) | 24 logs per ring, 6 per trip, 12 game min per log, at the spawn beach | The beach log positions are not exposed to `__sc`; the stock is a guess |
| Fish | 1 fish per 30 game min standing at the spawn hole (a 60-min trip gives 2) | No hunting or fishing minigame in the bot |
| Snow for the pot | 4 snow per 4 game min of shovelling, near the house | Shovelling is not played; the pot melting is real |
| Container search | 1.5 game min per stack looted, hidden items not modelled | The search panel is not reachable from `__sc` |
| Walking | charged at the origin, no exposure on the way | See above; walking heat is in the game's metabolism |
| Icebreaker crates | not modelled (no radio repair) | The bot does not repair the radio |
| Clothing | start kit only (station parka, wool mittens, felt boots, wool hat); no fur, no crafted gear | The bot does not craft |
| Generator / electric heater | not used (pull-cord minigame); the stove is the only heat | Diesel therefore sits unused |
| Igloo / shelter ★★ | not built; the station house is the shelter | Snow-block cutting is not played |

Not modelled at all: the day 1 door dig, radio, ship, seals (harpoon), the diary, notes beyond the keeper's log,
tea (kettle), wolves/bears beyond what the game does on its own (bears do attack the bot at the hole), and any
player reaction to frost, hunger or thirst beyond the thresholds above.

## Results and sensitivity

See `report.md`. Short version: with the constants above the bot lives 8-14 game days on every difficulty, and it dies of
thirst (no fuel for the pot) or of a bear. With `--set logStockPerRing=150` (six times the driftwood) Обычная lives
19 days on both seeds, so the bot's limit is the fuel economy it is given, not the difficulty numbers.

## Output

Per game day: `day, ring, phase, core min, frost peaks (hands/feet/face), food/water/energy min, hp min, stove h, fuel h
(stove + pack), food days, storms survived / started, slept h, trips, alive`. `RES` holds `survivedDays`
(time from the 11:00 start of day 1 to death, or 40 when alive), `cause`, `ring`, `storms`, `trips`, `chain`.

The matrix writes `d<diff>-s<seed>.log` and `summary.json` to `--out`, and prints the median survived days per difficulty.
