// CONTRACT FILE — shared runtime state. Every module may READ; the owner noted in comments WRITES.
// Units: positions in cells (float), velocities cells/s, time in game minutes, temperatures °C.

export interface Light { x: number; y: number; r: number; g: number; b: number; rad: number } // rad in tiles

export interface Slot { id: string; n: number; dur?: number } // item stack; dur = remaining durability (tools)

export interface Player {
  x: number; y: number;           // feet centre (bottom-middle of the AABB)
  vx: number; vy: number;
  w: number; h: number;           // AABB size in cells (8 × 20)
  face: 1 | -1;
  onGround: boolean; inWater: number; // 0..1 submersion
  hp: number; maxHp: number;      // 100
  core: number;                   // body core temperature °C (37 normal, <35 hypothermia, <30 death)
  food: number;                   // 0..100 satiety
  stamina: number;                // 0..100
  wet: number;                    // 0..1 clothing wetness
  insul: number;                  // clothing insulation multiplier (1 base, more with gear)
  airT: number; feelT: number;    // air temperature at player, feels-like (wind chill)
  shelter: number;                // 0..1 how enclosed the player's spot is
  alive: boolean; cause: string;  // death cause text (RU)
  anim: { state: 'idle' | 'walk' | 'run' | 'jump' | 'fall' | 'swim' | 'dig' | 'swing' | 'hurt' | 'dead'; t: number };
  hurtT: number;                  // invulnerability/hurt flash timer
  // ---- DESIGN v2 body (owner: game/player) ----
  water: number;                  // 0..100 hydration
  energy: number;                 // 0..100 (fatigue; sleep restores)
  frost: { hands: number; feet: number; face: number }; // 0..100 per extremity (40 frostnip, 80 frostbite)
  co: number;                     // 0..100 carbon monoxide exposure
  parkaOpen: boolean;             // vent toggle (less insulation, less sweat)
  carry: number;                  // carried weight kg (slows)
  sleeping: boolean;
}

export interface Drop { id: number; item: string; n: number; x: number; y: number; vx: number; vy: number; age: number } // item lying in the world (magnet to player)

export type FixtureKind =
  // DESIGN v2
  | 'campfire' | 'fat_lamp' | 'brazier' | 'pot' | 'drying_rack' | 'skin_bed' | 'hide_door' | 'cache' | 'snare' | 'torch'
  | 'stove' | 'table' | 'shelf' | 'chest' | 'radio' | 'drum' | 'bed' | 'door' | 'mast' | 'barometer' | 'flag' | 'cairn' | 'cart' | 'kennel' | 'signal_fire'
  // v1 leftovers (do not use in new code)
  | 'workbench' | 'furnace' | 'anvil' | 'helipad' | 'sign' | 'lantern'
  // DESIGN §15 interactive objects (game/fixtures_station.ts, stationobjects.ts)
  | 'generator' | 'ceiling_lamp' | 'heater' | 'medkit' | 'kettle' | 'sonde' | 'gramophone' | 'hatch' | 'shutter' | 'damper' | 'bell';
export interface Fixture {
  id: number; kind: FixtureKind;
  tx: number; ty: number; tw: number; th: number; // footprint in TILES (top-left)
  fuel?: number;        // game minutes of burning left (campfire, torch, furnace, stove)
  lit?: boolean;
  open?: boolean;       // door
  items?: Slot[];       // chest contents
  data?: Record<string, unknown>;
}

export type AnimalKind = 'seal' | 'fox' | 'ptarmigan' | 'bear' | 'dog' | 'fish' | 'hare' | 'wolf'; // hare/wolf: v1 leftovers, unused
export interface Animal {
  id: number; kind: AnimalKind; x: number; y: number; vx: number; vy: number; w: number; h: number;
  face: 1 | -1; hp: number; state: string; t: number; onGround: boolean; target?: number;
}

export interface Toast { text: string; t: number; kind?: 'info' | 'good' | 'warn' | 'bad' }

export const G = {
  // clock (owner: game/weather) — game minutes since day 1 00:00
  time: 8 * 60, day: 1, timeScale: 1, frame: 0, realTime: 0, paused: false,
  // weather (owner: game/weather)
  ambientT: -18, wind: 2, storm: 0, snowfall: 0.2 /* 0..1 intensity */, visibility: 1, daylight: 1, moon: 0.5, aurora: 0,
  // polar night (owner: game/weather) — sun elevation at the current moment in degrees (negative = below horizon)
  sunElev: -12, noonElev: -9, cycle: 0 /* completed seasons rings (DESIGN §18), derived from day */, endDay: 0 /* legacy (old saves), unused: the game is endless */, moonPhase: 0 /* 0 new .. 0.5 full .. 1 */, forecast: { stormAt: -1, text: '' },
  shelter: null as null | { closed: boolean; tiles: number; temp: number; windIn: number; vent: boolean; co: number; stars: number; notes: string[] }, // owner: game/shelter
  // camera (owner: engine/camera) — centre in cells, scale = screen px per cell (device px)
  cam: { x: 1024, y: 300, scale: 3, shake: 0, viewW: 400, viewH: 200 },
  // simulation window in cells (owner: main) — fast processes only run here
  win: { x0: 0, y0: 0, x1: 0, y1: 0 },
  lights: [] as Light[],           // dynamic point lights this frame (owner: main collects from fixtures/player/fauna)
  player: null as unknown as Player, // set by game/player init
  drops: [] as Drop[], fixtures: [] as Fixture[], animals: [] as Animal[],
  toasts: [] as Toast[],
  mobile: false, quality: 2 as 0 | 1 | 2, // 0 low (old phones) .. 2 high
  xray: 0,                          // debug overlay: 0 off, 1 temperature, 2 support, 3 light
  nextId: 1,
  seed: 1,
  // difficulty preset chosen at New Game (owner: menus/main). Systems multiply their rates by these.
  diff: { level: 1 as 0 | 1 | 2, cold: 1, hunger: 1, wolves: 1, loot: 1, hardcore: false },
};
/** Difficulty presets: 0 мягкая, 1 обычная, 2 суровая. */
export const DIFFS = [
  { cold: 0.55, hunger: 0.7, wolves: 0.6, loot: 1.3 },
  { cold: 1, hunger: 1, wolves: 1, loot: 1 },
  { cold: 1.6, hunger: 1.3, wolves: 1.6, loot: 0.75 },
];
export const newId = () => G.nextId++;
export function toast(text: string, kind: Toast['kind'] = 'info') { G.toasts.push({ text, t: 3.5, kind }); }

/** Render view passed to draw layers. The low-res world canvas pixel (0,0) is world cell (x0,y0); 1 canvas px = 1 cell.
 *  Draw world things at (x - v.x0, y - v.y0). Layers (render.addLayer):
 *   z < 0        world space BEFORE lighting — gets lit by the light map (sprites, clusters, trees, fixtures, drops)
 *   0 ≤ z < 100  AFTER lighting with 'lighter' compositing — emissive (flames, sparks, glows)
 *   z ≥ 100      on top, normal blending, unlit (target frame, ghost, labels, weather fog, vignettes) */
export interface View { x0: number; y0: number; w: number; h: number; scale: number; t: number }
export type DrawFn = (ctx: CanvasRenderingContext2D, v: View) => void;
