// Item registry (no imports from items.ts at runtime, so items_a.ts / items_b.ts can define items without an import cycle).
import { registerSource } from '../content/i18n';
import type { ItemDef, ItemKind } from './items';

export const I: Record<string, ItemDef> = {};
export function def(id: string, name: string, kind: ItemKind, w: number, stack: number, o: Partial<ItemDef> = {}) {
  I[id] = { id, name, kind, w, stack, icon: id, ...o };
  registerSource('item.' + id, name);
  if (o.desc) registerSource('itemdesc.' + id, o.desc);
}
