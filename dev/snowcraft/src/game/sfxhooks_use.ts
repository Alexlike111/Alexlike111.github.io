// Sounds of the usable items (DESIGN §17), agent U2: the bus events of the use actions (group 1 and group 2) mapped to the existing procedural sounds of
// engine/audio.ts. Kept apart from sfxhooks.ts (its own owner edits that file). Imported from main.ts next to sfxhooks. No-op without audio.
import { on } from './bus';

const mods = import.meta.glob('../engine/audio.ts', { eager: true }) as Record<string, { sfx?: Record<string, (...a: any[]) => any> }>;
const sfx = Object.values(mods)[0]?.sfx;
const play = (name: string, vol: number, pitch = 1) => { try { sfx?.play?.(name, { vol, pitch }); } catch { /* audio must never break the game */ } };

// use_item {id}: the click every use makes. null = silent here, because the item has its own event below (or the sip is already a drink)
const USE_SND: Record<string, [string, number, number] | null> = {
  compass: ['ui_click', 0.5, 1], binoculars: ['ui_open', 0.6, 1], probe_pole: ['chisel', 0.6, 1.1], ice_cleats: ['craft', 0.6, 1.4],
  smoke_flare: ['match_strike', 0.8, 1], frost_balm: ['ui_open', 0.5, 1.2], belt_pouch: ['pickup', 0.5, 1], big_pack: ['pickup', 0.5, 0.8],
  thermos: null, hand_warmer: null, bandage: null, sack: null, spirit: null, whistle: null,
};
on('use_item', (d: { id: string }) => {
  const s = USE_SND[d.id];
  if (s === null) return;
  if (s) play(s[0], s[1], s[2]); else play('ui_click', 0.5);
});
// the group 1 events (game/useitems_a.ts)
on('thermos_fill', () => play('pour', 0.7));
on('hand_warmer_lit', () => play('fire_ignite', 0.8));
on('bandage', (d: { spirit?: boolean }) => play('ui_open', 0.5, d.spirit ? 0.8 : 1.1));
on('sack_fill', () => play('shovel_scoop', 0.7, 1.2));
on('sack_dump', () => play('shovel_throw', 0.7));
// the group 2 events (game/useitems_b.ts): the flare gun and the smoke flare reach sfxhooks.ts as 'flare'
on('compass_target', () => play('ui_click', 0.5, 1.2));
on('compass_mark', () => play('ui_open', 0.6, 1.3));
on('whistle', (d: { stay?: boolean }) => play('dog_whine', 0.8, d.stay ? 0.8 : 1.15));
