// What a smashed thing is made of decides how it breaks: wood throws splinters and tan dust, concrete throws chunks, pebbles
// and grey dust, metal throws sparks, plastic throws bright shards, rubber bounces. Pure data, no three.js (tests/fxMaterials.test.ts).
import type { DestructibleKind, PropType } from '../types';
import type { WallVisual } from '../render/structures';

export type FxMaterial = 'concrete' | 'metal' | 'wood' | 'plastic' | 'rubber' | 'stone' | 'foliage' | 'straw' | 'tarmac';

export interface MaterialFx {
  /** dust colour of the puff (null = the theme's own dust) */
  dust: number | null;
  /** extra fleck groups on top of the normal 2-3 debris chunks: [min, max] (x3 particles each), drawn from the pooled smoke particles */
  splinters: [number, number];   // thin, long, spinning: wood
  pebbles: [number, number];     // small, dense, dark: concrete, stone, tarmac
  shards: [number, number];      // small flat bright pieces: plastic
  /** metal ring: extra sparks per break */
  sparks: number;
  /** colours of the extra pieces */
  colors: number[];
}

const NONE: [number, number] = [0, 0];

export const MATERIAL_FX: Record<FxMaterial, MaterialFx> = {
  concrete: { dust: 0xc9c5bd, splinters: NONE, pebbles: [2, 3], shards: NONE, sparks: 0, colors: [0xd9dde5, 0xaeb4bf, 0x8d93a0] },
  metal:    { dust: 0xaab0ba, splinters: NONE, pebbles: NONE, shards: [1, 2], sparks: 8, colors: [0xdfe6f0, 0x9aa3b2, 0x7d8594] },
  wood:     { dust: 0xd2ad74, splinters: [3, 4], pebbles: NONE, shards: NONE, sparks: 0, colors: [0xd6a15a, 0xb97e45, 0x9b6a34] },
  plastic:  { dust: null, splinters: NONE, pebbles: NONE, shards: [3, 4], sparks: 0, colors: [0xff7a1a, 0xffffff, 0xe03b3b, 0xffd23c] },
  rubber:   { dust: 0x6d6a72, splinters: NONE, pebbles: [1, 2], shards: NONE, sparks: 0, colors: [0x2a2d35, 0x3a3e48] },
  stone:    { dust: 0xb5aa98, splinters: NONE, pebbles: [3, 4], shards: NONE, sparks: 0, colors: [0x8a8478, 0x6e685d, 0xa39c8e] },
  foliage:  { dust: 0x9bc46a, splinters: [1, 2], pebbles: NONE, shards: NONE, sparks: 0, colors: [0x5fae4a, 0x3f8f3a, 0x7a5a37] },
  straw:    { dust: 0xe3c76a, splinters: [2, 3], pebbles: NONE, shards: NONE, sparks: 0, colors: [0xeccb55, 0xb98a2b, 0xd9b448] },
  tarmac:   { dust: null, splinters: NONE, pebbles: [2, 3], shards: NONE, sparks: 0, colors: [0x6b6256, 0x4a453d] },
};

export function materialOf(kind: DestructibleKind, prop: PropType | undefined, wallStyle: WallVisual): FxMaterial {
  switch (kind) {
    case 'wall':
    case 'guardrail':
      if (wallStyle === 'tires') return 'rubber';
      if (wallStyle === 'fence') return 'wood';
      return kind === 'guardrail' ? 'metal' : 'concrete';
    case 'curb': return 'concrete';
    case 'road': return 'tarmac';
    case 'prop':
      switch (prop) {
        case 'cone': case 'barrel': return 'plastic';
        case 'crate': return 'wood';
        case 'tireStack': return 'rubber';
        case 'sign': return 'metal';
        case 'tree': return 'foliage';
        case 'rock': return 'stone';
        case 'hayBale': return 'straw';
        default: return 'plastic';
      }
  }
}

/** Number of extra pieces for a [min, max] range, scaled by the particle share (0 = none) and a roll in [0, 1). */
export function extraCount(range: [number, number], share: number, roll: number): number {
  if (share <= 0 || range[1] <= 0) return 0;
  const n = range[0] + Math.floor(roll * (range[1] - range[0] + 1));
  return Math.max(0, Math.min(range[1], Math.round(n * Math.min(1, share))));
}
