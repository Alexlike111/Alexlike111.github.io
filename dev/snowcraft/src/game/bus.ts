// CONTRACT FILE — tiny event bus between game modules (quest, journal, audio, UI listen; gameplay emits).
// Event names used so far (add more freely, document them here):
//  'crafted' {id}  'placed' {kind|item}  'dug' {mat,x,y}  'picked' {item,n}  'ate' {item}  'drank' {}
//  'fire_lit' {kind}  'shelter' {stars}  'storm_start' {n}  'storm_end' {n, report}  'site_found' {key}
//  'note_found' {id}  'hurt' {cause,n}  'died' {cause}  'respawn' {}  'slept' {hours}  'radio_part' {id}  'radio_fixed' {}
//  'seal_caught' {}  'fish_caught' {}  'bear_seen' {}  'day' {n}  'ending' {kind:'dawn'|'icebreaker'}
type Fn = (d: any) => void;
const subs = new Map<string, Fn[]>();
export function on(evt: string, fn: Fn) { let a = subs.get(evt); if (!a) subs.set(evt, (a = [])); a.push(fn); return () => { const i = a!.indexOf(fn); if (i >= 0) a!.splice(i, 1); }; }
export function emit(evt: string, data: any = {}) { const a = subs.get(evt); if (a) for (const f of a.slice()) f(data); const all = subs.get('*'); if (all) for (const f of all.slice()) f({ evt, data }); }
