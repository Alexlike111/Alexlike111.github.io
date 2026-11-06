// Per-material break flavour: every destructible maps to a material, budgets stay small, quality scales them away.
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { MATERIAL_FX, extraCount, materialOf } from '../src/fx/materials';
import type { DestructibleKind, PropType } from '../src/types';

const PROPS = Object.keys(CONFIG.destruction.props) as PropType[];
const KINDS: DestructibleKind[] = ['wall', 'guardrail', 'curb', 'road'];
const STYLES = ['concrete', 'tires', 'fence', 'jersey'] as const;

describe('fx materials', () => {
  it('every kind, prop and wall style maps to a known material', () => {
    for (const style of STYLES) {
      for (const k of KINDS) expect(MATERIAL_FX[materialOf(k, undefined, style)]).toBeDefined();
      for (const p of PROPS) expect(MATERIAL_FX[materialOf('prop', p, style)]).toBeDefined();
    }
  });

  it('wood splinters, plastic shards, concrete pebbles and metal sparks: the looks are distinct', () => {
    expect(materialOf('prop', 'crate', 'concrete')).toBe('wood');
    expect(materialOf('prop', 'cone', 'concrete')).toBe('plastic');
    expect(materialOf('wall', undefined, 'concrete')).toBe('concrete');
    expect(materialOf('guardrail', undefined, 'concrete')).toBe('metal');
    expect(materialOf('wall', undefined, 'tires')).toBe('rubber');
    expect(MATERIAL_FX.wood.splinters[1]).toBeGreaterThan(0);
    expect(MATERIAL_FX.plastic.shards[1]).toBeGreaterThan(0);
    expect(MATERIAL_FX.concrete.pebbles[1]).toBeGreaterThan(0);
    expect(MATERIAL_FX.metal.sparks).toBeGreaterThan(0);
  });

  it('extras are capped per break and vanish with the particle share (low preset)', () => {
    for (const m of Object.values(MATERIAL_FX)) {
      const total = m.splinters[1] + m.pebbles[1] + m.shards[1];
      expect(total).toBeLessThanOrEqual(4);                       // a break never floods the 60-piece debris pool
      expect(extraCount(m.splinters, 0, 0.99)).toBe(0);
      expect(extraCount(m.splinters, 1, 0.99)).toBeLessThanOrEqual(m.splinters[1]);
      expect(extraCount(m.splinters, 0.7, 0.5)).toBeLessThanOrEqual(extraCount(m.splinters, 1, 0.5));
    }
    expect(CONFIG.render.quality.low.particles).toBe(0);
  });
});
