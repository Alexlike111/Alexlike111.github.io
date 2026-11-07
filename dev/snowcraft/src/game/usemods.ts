// Body modifiers set every frame by the usable items (useitems.ts / items_a.ts) and read by player.ts. No imports on purpose (no cycles).
export const mods = {
  frostHands: 1,     // multiplier of the frost gain of the hands (hand warmer, balm)
  frostFace: 1,      // ... of the face (balm, goggles, warmer)
  frostFeet: 1,
  sweat: 1,          // multiplier of sweat gain (big pack)
  warmHands: 0,      // frost points per body second taken off the hands while a warmer burns
  coreAdd: 0,        // °C per body second added to the core (thermos sips, spirit: negative); player.ts applies it and the item code drains its pool
  glare: 0,          // 0..1 snow blindness; the overlay and the vision penalty read it
};
export function resetMods() { mods.frostHands = mods.frostFace = mods.frostFeet = mods.sweat = 1; mods.warmHands = 0; mods.coreAdd = 0; }
