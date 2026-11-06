// Shared runtime state. Every module may read; only the owner noted writes.
export interface Light { x: number; y: number; r: number; power: number; color: [number, number, number]; }
export interface Fire { x: number; y: number; fuel: number; /* game minutes left */ power: number; /* W */ lit: boolean; id: number; }

export const G = {
  // clock (owner: main) — game minutes since day 1 00:00. 1 real s = 1 game min.
  time: 9 * 60,
  timeScale: 1,     // >1 while waiting in shelter
  frame: 0,
  realTime: 0,      // seconds since boot
  // weather (owner: weather in main)
  ambientT: -24,    // °C open-air temperature
  wind: 3,          // m/s at 10 m height, signed (+ blows toward +x / east)
  storm: 0,         // 0..1
  snowfall: 0.04,   // m/h of fresh snow depth
  daylight: 1,      // 0 night .. 1 full day
  sunAngle: 0.3,    // radians above horizon (negative = below)
  moon: 0.6,        // 0..1 moon light at night
  // camera (owner: main) — in cells
  cam: { x: 600, y: 380, zoom: 3, vw: 640, vh: 360 },
  // simulation window in cells (owner: main) — fast processes run only here
  win: { x0: 0, y0: 0, x1: 0, y1: 0 },
  lights: [] as Light[],  // max 8, refreshed each frame (owner: main)
  fires: [] as Fire[],    // campfires (owner: tools/main)
  xray: 0,          // 0 off, 1 density, 2 bond, 3 temperature
  mobile: false,
  quality: 1,       // 0 low (phone), 1 high
  player: { x: 600, y: 380, w: 10, h: 34, heat: 100 /* W given to air */ },
};

/** Number of game seconds per real second (time compression). */
export const gameSecPerReal = () => 60 * G.timeScale;
