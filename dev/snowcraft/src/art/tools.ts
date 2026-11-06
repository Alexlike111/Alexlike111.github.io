// Held-tool sprites. Authored horizontally pointing RIGHT (+x), outlined; (gx,gy) is the grip cell (the hand) in the outlined sprite.
// art/player.ts rotates them about the grip toward the aim angle. Palette = sprites.ts PAL.
import { defSprite, outline, spriteSize, PAL, type Rows } from '../engine/sprites';

export interface HeldDef { key: string; gx: number; gy: number; w: number; h: number; swing: 'chop' | 'saw' | 'thrust' | 'dig' | 'none' | 'hang' | 'wave' }
export const HELD: Record<string, HeldDef> = {};
function held(id: string, rows: Rows, gx: number, gy: number, swing: HeldDef['swing']) {
  const key = 'held.' + id;
  defSprite(key, PAL, outline(rows));
  const sz = spriteSize(key);
  HELD[id] = { key, gx: gx + 1, gy: gy + 1, w: sz.w, h: sz.h, swing };
}

held('snow_knife', [
  '.....zSSSSSSSs.',
  'WWWWwzsssssssSS',
  '.....zzzzzzSS..',
], 2, 1, 'saw');
held('shovel', [
  '............ssss',
  '............sSSSs',
  'WWWWWWWWWWWWsssSz',
  '............sSSSs',
  '............ssss',
], 3, 2, 'dig');
held('ice_chisel', [
  'WWWWWWWWWWWWWWzSSSSSs',
  'WwWwWwWwWwWwWwzzSSs',
], 3, 0, 'thrust');
held('axe', [
  '..........zSSs',
  '..........zSSSs',
  'WWWWWWWWWWzzSSs',
  '..........zSSSs',
  '..........zSSs.',
], 3, 2, 'chop');
held('pick', [
  '.........zS....',
  '........zSSs...',
  'WWWWWWWWzSSSSSS',
  '........zSSs...',
  '.........zS....',
], 3, 2, 'chop');
held('saw', [
  'WWWzSSSSSSSSSSSs',
  'WwWzzzzzzzzzzzzz',
  '....S.S.S.S.S.S.',
], 1, 0, 'saw');
held('harpoon', [
  '...................zS..',
  'WWWWWWWWWWWWWWWWWWWzSSs',
  'wWwWwWwWwWwWwWwWwWwzzS.',
  '...................zS..',
], 4, 1, 'thrust');
held('fishing_line', [
  'hhdWWWWWWWWWWWWWw',
], 2, 0, 'wave');
held('torch', [
  'WwWwWwWwUUUU',
  'WWWWWWWWuUUu',
], 2, 0, 'none');
held('flare_gun', [
  '.ooooo..',
  'ooRooorr',
  'RR.oo...',
  '..oo....',
  '..OO....',
], 2, 3, 'none');
held('barometer', [
  '.hhhh.',
  'hnnnnh',
  'hnrnnh',
  'hnnnnh',
  '.hhhh.',
], 2, 2, 'none');
held('lantern', [
  '..hhh..',
  '.h...h.',
  'hSSSSSh',
  'SyeEeyS',
  'SyEeEyS',
  'SyeEeyS',
  'zSSSSSz',
], 3, 0, 'hang');
