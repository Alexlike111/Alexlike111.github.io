// CONTRACT FILE — materials as data. Engine systems read ONLY these tables (no per-material branches
// where a property would do). Adding a material = adding a row. Hot loops use the typed lookup arrays.
export type Phase = 0 | 1 | 2 | 3 | 4 | 5;
export const P_EMPTY = 0, P_SOLID = 1, P_POWDER = 2, P_LIQUID = 3, P_GAS = 4, P_FIRE = 5;
export type ToolKind = 'shovel' | 'pick' | 'axe' | 'any' | 'none';
export type Tex = 'flat' | 'noise' | 'snow' | 'grain' | 'brick' | 'speckle' | 'crystal' | 'strata' | 'liquid' | 'gas' | 'fire' | 'metal' | 'plank' | 'log';
export type Snd = 'snow' | 'ice' | 'stone' | 'wood' | 'dirt' | 'metal' | 'water' | 'soft' | 'none';

export interface MatDef {
  key: string; name: string; phase: Phase;
  dens: number;                 // relative density for displacement (heavier sinks through lighter fluids/gases). AIR = 1
  color: [number, number, number]; vary: number; tex: Tex; speck?: [number, number, number]; // speck = ore/inclusion colour
  hard: number;                 // seconds to dig one tile with the right tool at the minimum tier (Infinity = never)
  tool: ToolKind; tier: number; // tool kind that digs it fast; minimum tier of that tool (0 hand/shovel, 1 stone, 2 iron)
  drop?: string; dropN?: number;// item id dropped per dug tile (dropN default 1, fractional = chance)
  span: number;                 // structure: max cantilever distance (cells) it can carry sideways; 0 = no structural role
  anchor?: boolean;             // natural (non-F_PLACED) cells of this material never fall and anchor others
  flam: number; burnTo?: string; burnLife?: number; // chance/tick to ignite next to fire; material after burning; fire life (ticks)
  meltAt?: number; meltTo?: string; freezeAt?: number; freezeTo?: string; boilAt?: number; boilTo?: string;
  heat?: number;                // intrinsic temperature °C (heat source while present)
  k: number; cap: number;       // heat conductivity 0..1, relative heat capacity
  light: number;                // light attenuation 0..1 (1 = opaque)
  wind: number;                 // wind blocking 0..1
  slide?: number;               // powder: chance per tick to slide diagonally (0..1, lower = steeper piles)
  flow?: number;                // liquid: max lateral cells per tick; gas: drift strength
  life?: [number, number];      // gas/fire lifetime range in ticks (aux counts down)
  glow?: [number, number, number]; glowR?: number; // emitted light colour (0..1) and radius in tiles
  fric: number;                 // ground friction for walkers (ice low)
  walk: boolean;                // true = blocks player/animals (solid or powder ground)
  snd: Snd;
}

const S = (o: Partial<MatDef> & Pick<MatDef, 'key' | 'name' | 'phase' | 'color'>): MatDef => ({
  dens: 100, vary: 0.08, tex: 'noise', hard: 1, tool: 'any', tier: 0, span: 0, flam: 0, k: 0.3, cap: 10,
  light: 1, wind: 1, fric: 1, walk: true, snd: 'stone', ...o,
});

// ORDER = ids. Never reorder (saves store ids). Append new materials at the end.
export const MATS: MatDef[] = [
  S({ key: 'AIR', name: 'воздух', phase: P_EMPTY, color: [0, 0, 0], dens: 1, hard: 0, light: 0, wind: 0, k: 0.02, cap: 1, walk: false, snd: 'none', tex: 'flat' }),
  S({ key: 'SNOW', name: 'снег', phase: P_POWDER, color: [232, 240, 250], vary: 0.05, tex: 'snow', dens: 9, hard: 0.08, tool: 'shovel', drop: 'snow', slide: 0.55, meltAt: 0.5, meltTo: 'WATER', k: 0.05, cap: 6, light: 0.55, snd: 'snow' }),
  S({ key: 'PACKED', name: 'наст', phase: P_SOLID, color: [208, 221, 238], vary: 0.05, tex: 'snow', hard: 0.25, tool: 'shovel', drop: 'snowbrick', span: 6, meltAt: 0.5, meltTo: 'WATER', k: 0.1, cap: 7, light: 0.7, snd: 'snow' }),
  S({ key: 'SNOWBLOCK', name: 'снежный блок', phase: P_SOLID, color: [222, 232, 246], vary: 0.04, tex: 'brick', hard: 0.3, tool: 'shovel', drop: 'snowbrick', span: 12, meltAt: 1, meltTo: 'WATER', k: 0.08, cap: 7, light: 0.6, snd: 'snow' }),
  S({ key: 'ICE', name: 'лёд', phase: P_SOLID, color: [150, 200, 236], vary: 0.06, tex: 'crystal', hard: 0.6, tool: 'pick', drop: 'ice', span: 16, meltAt: 1.5, meltTo: 'WATER', k: 0.4, cap: 10, light: 0.25, fric: 0.12, snd: 'ice' }),
  S({ key: 'WATER', name: 'вода', phase: P_LIQUID, color: [38, 104, 178], vary: 0.04, tex: 'liquid', dens: 10, hard: 0, flow: 4, freezeAt: -1.5, freezeTo: 'ICE', boilAt: 100, boilTo: 'STEAM', k: 0.3, cap: 20, light: 0.15, wind: 0, walk: false, snd: 'water' }),
  S({ key: 'DIRT', name: 'мёрзлая земля', phase: P_SOLID, color: [88, 68, 56], tex: 'noise', hard: 0.5, tool: 'shovel', drop: 'dirt', span: 20, anchor: true, k: 0.3, cap: 12, snd: 'dirt' }),
  S({ key: 'GRAVEL', name: 'щебень', phase: P_POWDER, color: [118, 116, 114], vary: 0.14, tex: 'speckle', speck: [80, 78, 76], dens: 20, hard: 0.3, tool: 'shovel', drop: 'gravel', slide: 0.8, k: 0.4, cap: 12, snd: 'stone' }),
  S({ key: 'STONE', name: 'камень', phase: P_SOLID, color: [104, 110, 122], tex: 'strata', hard: 1.0, tool: 'pick', tier: 1, drop: 'stone', span: 48, anchor: true, k: 0.5, cap: 12, snd: 'stone' }),
  S({ key: 'HARDROCK', name: 'гранит', phase: P_SOLID, color: [72, 74, 90], tex: 'speckle', speck: [120, 110, 125], hard: 1.6, tool: 'pick', tier: 2, drop: 'stone', span: 64, anchor: true, k: 0.5, cap: 12, snd: 'stone' }),
  S({ key: 'BEDROCK', name: 'коренная порода', phase: P_SOLID, color: [32, 30, 40], tex: 'strata', hard: Infinity, tool: 'none', span: 255, anchor: true, k: 0.5, cap: 12, snd: 'stone' }),
  S({ key: 'WOOD', name: 'ствол', phase: P_SOLID, color: [104, 70, 46], tex: 'grain', hard: 0.9, tool: 'axe', drop: 'log', span: 40, flam: 0.015, burnTo: 'EMBER', burnLife: 260, k: 0.08, cap: 8, snd: 'wood' }),
  S({ key: 'NEEDLES', name: 'хвоя', phase: P_SOLID, color: [36, 78, 60], vary: 0.18, tex: 'noise', hard: 0.1, tool: 'any', drop: 'bough', dropN: 0.35, flam: 0.25, burnTo: 'AIR', burnLife: 40, k: 0.05, cap: 3, light: 0.3, wind: 0.5, walk: false, snd: 'soft' }),
  S({ key: 'LOG', name: 'бревно', phase: P_SOLID, color: [126, 86, 54], tex: 'log', hard: 0.8, tool: 'axe', drop: 'log', span: 40, flam: 0.03, burnTo: 'EMBER', burnLife: 240, k: 0.07, cap: 8, snd: 'wood' }),
  S({ key: 'PLANK', name: 'доски', phase: P_SOLID, color: [158, 114, 70], tex: 'plank', hard: 0.5, tool: 'axe', drop: 'plank', span: 28, flam: 0.06, burnTo: 'EMBER', burnLife: 160, k: 0.08, cap: 8, snd: 'wood' }),
  S({ key: 'BRICK', name: 'кладка', phase: P_SOLID, color: [126, 120, 116], tex: 'brick', hard: 1.2, tool: 'pick', tier: 1, drop: 'brick', span: 40, k: 0.45, cap: 12, snd: 'stone' }),
  S({ key: 'COAL', name: 'уголь', phase: P_SOLID, color: [96, 98, 108], tex: 'speckle', speck: [24, 24, 28], hard: 0.9, tool: 'pick', tier: 1, drop: 'coal', span: 40, anchor: true, flam: 0.008, burnTo: 'EMBER', burnLife: 900, k: 0.4, cap: 12, snd: 'stone' }),
  S({ key: 'COPPER', name: 'медная руда', phase: P_SOLID, color: [104, 108, 118], tex: 'speckle', speck: [206, 120, 62], hard: 1.1, tool: 'pick', tier: 1, drop: 'copper_ore', span: 40, anchor: true, k: 0.6, cap: 12, snd: 'stone' }),
  S({ key: 'IRON', name: 'железная руда', phase: P_SOLID, color: [100, 98, 104], tex: 'speckle', speck: [176, 112, 90], hard: 1.4, tool: 'pick', tier: 1, drop: 'iron_ore', span: 40, anchor: true, k: 0.6, cap: 12, snd: 'stone' }),
  S({ key: 'CRYSTAL', name: 'кварц', phase: P_SOLID, color: [150, 226, 255], vary: 0.1, tex: 'crystal', hard: 1.5, tool: 'pick', tier: 2, drop: 'crystal', dropN: 0.5, span: 30, anchor: true, k: 0.4, cap: 10, light: 0.3, glow: [0.35, 0.75, 1.0], glowR: 6, snd: 'ice' }),
  S({ key: 'ASH', name: 'зола', phase: P_POWDER, color: [92, 90, 94], vary: 0.12, tex: 'noise', dens: 5, hard: 0.05, tool: 'any', slide: 0.9, k: 0.1, cap: 4, snd: 'soft' }),
  S({ key: 'FIRE', name: 'огонь', phase: P_FIRE, color: [255, 150, 50], vary: 0.25, tex: 'fire', dens: 0.6, hard: 0, life: [18, 48], heat: 420, k: 0.5, cap: 2, light: 0, wind: 0, walk: false, glow: [1.0, 0.62, 0.28], glowR: 9, snd: 'none' }),
  S({ key: 'EMBER', name: 'угли', phase: P_POWDER, color: [214, 84, 30], vary: 0.2, tex: 'fire', dens: 6, hard: 0.05, tool: 'any', slide: 0.3, life: [200, 600], heat: 260, k: 0.5, cap: 6, glow: [0.85, 0.32, 0.1], glowR: 4, snd: 'soft' }),
  S({ key: 'SMOKE', name: 'дым', phase: P_GAS, color: [62, 62, 68], vary: 0.15, tex: 'gas', dens: 0.5, hard: 0, flow: 0.6, life: [90, 260], k: 0.02, cap: 1, light: 0.25, wind: 0, walk: false, snd: 'none' }),
  S({ key: 'STEAM', name: 'пар', phase: P_GAS, color: [206, 214, 224], vary: 0.1, tex: 'gas', dens: 0.6, hard: 0, flow: 0.8, life: [160, 420], freezeAt: -2, freezeTo: 'SNOW', k: 0.05, cap: 2, light: 0.1, wind: 0, walk: false, snd: 'none' }),
  S({ key: 'METHANE', name: 'рудничный газ', phase: P_GAS, color: [126, 160, 112], vary: 0.1, tex: 'gas', dens: 0.4, hard: 0, flow: 0.4, flam: 1, burnTo: 'FIRE', k: 0.02, cap: 1, light: 0.03, wind: 0, walk: false, snd: 'none' }),
  S({ key: 'LAVA', name: 'магма', phase: P_LIQUID, color: [255, 104, 26], vary: 0.2, tex: 'fire', dens: 30, hard: 0, flow: 1, heat: 1100, freezeAt: 650, freezeTo: 'BASALT', k: 0.6, cap: 30, light: 1, wind: 0, walk: false, glow: [1.0, 0.45, 0.14], glowR: 8, snd: 'water' }),
  S({ key: 'BASALT', name: 'базальт', phase: P_SOLID, color: [56, 52, 60], tex: 'speckle', speck: [86, 70, 70], hard: 1.3, tool: 'pick', tier: 1, drop: 'stone', span: 48, anchor: true, k: 0.5, cap: 12, snd: 'stone' }),
  S({ key: 'OIL', name: 'нефть', phase: P_LIQUID, color: [30, 24, 22], vary: 0.05, tex: 'liquid', dens: 8, hard: 0, flow: 2, flam: 0.35, burnTo: 'FIRE', k: 0.1, cap: 10, light: 0.9, wind: 0, walk: false, snd: 'water' }),
  S({ key: 'METAL', name: 'обшивка', phase: P_SOLID, color: [148, 156, 166], tex: 'metal', hard: 1.8, tool: 'pick', tier: 1, drop: 'scrap', span: 64, k: 0.9, cap: 6, snd: 'metal' }),
  S({ key: 'FIXTURE', name: 'предмет', phase: P_SOLID, color: [0, 0, 0], tex: 'flat', hard: Infinity, tool: 'none', span: 30, k: 0.1, cap: 8, light: 0.6, snd: 'wood' }),
  S({ key: 'GLASS', name: 'стекло', phase: P_SOLID, color: [190, 220, 230], vary: 0.03, tex: 'crystal', hard: 0.4, tool: 'pick', drop: 'glass', span: 10, k: 0.4, cap: 8, light: 0.05, snd: 'ice' }),
];

/** Material ids by key, e.g. MAT.SNOW. */
export const MAT = Object.fromEntries(MATS.map((m, i) => [m.key, i])) as Record<
  'AIR' | 'SNOW' | 'PACKED' | 'SNOWBLOCK' | 'ICE' | 'WATER' | 'DIRT' | 'GRAVEL' | 'STONE' | 'HARDROCK' | 'BEDROCK' | 'WOOD' | 'NEEDLES' | 'LOG' | 'PLANK' | 'BRICK' |
  'COAL' | 'COPPER' | 'IRON' | 'CRYSTAL' | 'ASH' | 'FIRE' | 'EMBER' | 'SMOKE' | 'STEAM' | 'METHANE' | 'LAVA' | 'BASALT' | 'OIL' | 'METAL' | 'FIXTURE' | 'GLASS', number>;
export const NMAT = MATS.length;
const id = (k?: string) => (k ? (MAT as Record<string, number>)[k] ?? 0 : 0);

// ---- typed lookup tables for hot loops (index = material id) ----
export const PHASE = new Uint8Array(256), DENS = new Float32Array(256), WALK = new Uint8Array(256), FLAM = new Float32Array(256);
export const BURN_TO = new Uint8Array(256), BURN_LIFE = new Uint16Array(256), SLIDE = new Float32Array(256), FLOW = new Float32Array(256);
export const MELT_AT = new Float32Array(256).fill(1e9), MELT_TO = new Uint8Array(256), FREEZE_AT = new Float32Array(256).fill(-1e9), FREEZE_TO = new Uint8Array(256);
export const BOIL_AT = new Float32Array(256).fill(1e9), BOIL_TO = new Uint8Array(256), HEAT = new Float32Array(256).fill(NaN);
export const COND = new Float32Array(256), CAP = new Float32Array(256), LIGHT = new Float32Array(256), WIND = new Float32Array(256), FRIC = new Float32Array(256);
export const SPAN = new Uint8Array(256), ANCHOR = new Uint8Array(256), LIFE_MIN = new Uint16Array(256), LIFE_MAX = new Uint16Array(256);
export const GLOW_R = new Float32Array(256), GLOW_G = new Float32Array(256), GLOW_B = new Float32Array(256), GLOW_RAD = new Float32Array(256);
MATS.forEach((m, i) => {
  PHASE[i] = m.phase; DENS[i] = m.dens; WALK[i] = m.walk ? 1 : 0; FLAM[i] = m.flam;
  BURN_TO[i] = id(m.burnTo); BURN_LIFE[i] = m.burnLife ?? 0; SLIDE[i] = m.slide ?? 0; FLOW[i] = m.flow ?? 0;
  if (m.meltAt !== undefined) { MELT_AT[i] = m.meltAt; MELT_TO[i] = id(m.meltTo); }
  if (m.freezeAt !== undefined) { FREEZE_AT[i] = m.freezeAt; FREEZE_TO[i] = id(m.freezeTo); }
  if (m.boilAt !== undefined) { BOIL_AT[i] = m.boilAt; BOIL_TO[i] = id(m.boilTo); }
  if (m.heat !== undefined) HEAT[i] = m.heat;
  COND[i] = m.k; CAP[i] = m.cap; LIGHT[i] = m.light; WIND[i] = m.wind; FRIC[i] = m.fric;
  SPAN[i] = Math.min(255, m.span); ANCHOR[i] = m.anchor ? 1 : 0;
  if (m.life) { LIFE_MIN[i] = m.life[0]; LIFE_MAX[i] = m.life[1]; }
  if (m.glow) { GLOW_R[i] = m.glow[0]; GLOW_G[i] = m.glow[1]; GLOW_B[i] = m.glow[2]; GLOW_RAD[i] = m.glowR ?? 4; }
});
export const isSolid = (m: number) => PHASE[m] === P_SOLID;
export const isPowder = (m: number) => PHASE[m] === P_POWDER;
export const isLiquid = (m: number) => PHASE[m] === P_LIQUID;
export const isGas = (m: number) => PHASE[m] === P_GAS || m === 0;
export const isFluid = (m: number) => PHASE[m] === P_LIQUID || PHASE[m] === P_GAS || m === 0 || PHASE[m] === P_FIRE;
