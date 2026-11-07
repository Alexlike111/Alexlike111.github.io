// CONTRACT FILE — tiny event bus between game modules (quest, journal, audio, UI listen; gameplay emits).
// Event names used so far (add more freely, document them here):
//  'crafted' {id}  'placed' {kind|item}  'dug' {mat,x,y}  'picked' {item,n}  'ate' {item}  'drank' {}
//  'fire_lit' {kind}  'shelter' {stars}  'storm_start' {n}  'storm_end' {n, report}  'site_found' {key}
//  'note_found' {id}  'hurt' {cause,n}  'died' {cause}  'respawn' {}  'slept' {hours}  'radio_part' {id}  'radio_fixed' {}
//  'seal_caught' {}  'fish_caught' {}  'bear_seen' {}  'day' {n}  'ending' {kind:'dawn'|'icebreaker'}
// Added by the gameplay core (game/*): 'dig' {mat,x,y} (while digging, for sfx)  'cut_block' {density,cls}  'fine_work' {t}  'fire_out' {fixture}  'door' {fixture,open}
//  'sleep_request' {fixture}  'snare_set' / 'snare_caught' / 'snare_taken'  'harpoon' {x,y,dir,tx,ty}  'fishing' {x,y}  'fish_bite'  'flare' {x,y}  'animal_hit' {id,dmg,x,y,by}
//  'jump' 'land' {speed,mat} 'splash' 'step' {mat,run} 'bump' {dir,x,y} 'frostbite' {part} 'drank' {item} 'pot_water' 'mast_up' 'drum_brazier' 'barometer' {text}
//  'storm_start' {n,peak} 'storm_end' {n,report: StormReport}  'shelter' {stars,closed,vent} (when the player's shelter rating changes)  'new_game' {seed}
// Knowledge (lore.ts): 'note_read' {id} (a note's page was read for the first time)  'tech_learned' {id,how:'start'|'note'|'exp',ref}  'fact_learned' {id} (a material fact was probed)
//  'note_found' {id:'note_n3'} is emitted by chests and pickups; lore.ts turns the item into a journal page and removes it from the bag.
type Fn = (d: any) => void;
const subs = new Map<string, Fn[]>();
export function on(evt: string, fn: Fn) { let a = subs.get(evt); if (!a) subs.set(evt, (a = [])); a.push(fn); return () => { const i = a!.indexOf(fn); if (i >= 0) a!.splice(i, 1); }; }
export function emit(evt: string, data: any = {}) { const a = subs.get(evt); if (a) for (const f of a.slice()) f(data); const all = subs.get('*'); if (all) for (const f of all.slice()) f({ evt, data }); }
