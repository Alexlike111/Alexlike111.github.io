import { KIT_DEFAULTS, type KitSave } from './kit/save';
import { LEVEL_COUNT, MIN_CROWD } from './levels';

/** Game save = kit fields + the game's own. The crowd carries over between rounds. */
export interface Save extends KitSave {
  crowd: number; // jellies you have right now, 10..1,000,000
  sel: number; // map picked for the next round (0-based)
  best: number[]; // best crowd you finished each map with (0 = not cleared)
  topCrowd: number; // most jellies ever
  maxed: boolean; // reached 1,000,000
}

export const DEFAULTS: Save = { ...KIT_DEFAULTS, crowd: MIN_CROWD, sel: 0, best: Array(LEVEL_COUNT).fill(0), topCrowd: MIN_CROWD, maxed: false };
