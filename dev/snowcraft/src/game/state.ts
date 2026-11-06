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
}

export interface Drop { id: number; item: string; n: number; x: number; y: number; vx: number; vy: number; age: number } // item lying in the world (magnet to player)

export type FixtureKind = 'campfire' | 'torch' | 'workbench' | 'furnace' | 'anvil' | 'chest' | 'door' | 'bed' | 'snare' | 'radio' | 'stove' | 'helipad' | 'sign' | 'lantern';
export interface Fixture {
  id: number; kind: FixtureKind;
  tx: number; ty: number; tw: number; th: number; // footprint in TILES (top-left)
  fuel?: number;        // game minutes of burning left (campfire, torch, furnace, stove)
  lit?: boolean;
  open?: boolean;       // door
  items?: Slot[];       // chest contents
  data?: Record<string, unknown>;
}

export type AnimalKind = 'hare' | 'ptarmigan' | 'wolf' | 'fox';
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
};
export const newId = () => G.nextId++;
export function toast(text: string, kind: Toast['kind'] = 'info') { G.toasts.push({ text, t: 3.5, kind }); }
