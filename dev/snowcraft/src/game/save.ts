// Save / continue (DESIGN §10 title "Продолжить"). One slot in IndexedDB (localStorage cannot hold the grid): the world grid (mat / aux / flags / bg,
// gzip-compressed when CompressionStream exists) + a JSON state blob (clock, player, body, inventory, fixtures, drops, objectives, found sites)
// with a version field. The world is regenerated from the seed first (so static data like shade / sites / worldInfo are in place) and then the saved
// cells are laid over it; heat / structure caches are rebuilt by main.newGame after applySave(). Everything is try/catch: private windows and
// blocked storage just mean "no save".
import { huntSave, huntLoad } from './hunt';
import { G } from './state';
import { mat, aux, flags, bg } from '../engine/grid';
import { inv, dropDur, backpacks } from './inventory';
import { body } from './player';
import { setClock, resyncWeather } from './weather';
import { sites } from './locations';
import { questSave, questLoad } from './quest';
import { resetShelter } from './shelter';
import { searchSave, searchLoad } from './search';

export const SAVE_VERSION = 1;
const DB = 'snowcraft', STORE = 'save';
const KEY = 'main';        // default slot; the self-test uses its own slot so it never touches the player's save

export interface SaveMeta { v: number; savedAt: number; seed: number; diff: 0 | 1 | 2; hardcore: boolean; day: number; time: number; core: number; cycle?: number /* seasons ring (absent in old saves: derived from day) */ }
export interface SaveData { meta: SaveMeta; state: any; grid: { mat: Uint8Array; aux: Uint8Array; flags: Uint8Array; bg: Uint8Array } }

// ---- capture / apply ------------------------------------------------------------------------------------------------------------
export function captureState() {
  const p = G.player;
  return {
    seed: G.seed, cycle: G.cycle, diff: { ...G.diff }, time: G.time, nextId: G.nextId,
    player: JSON.parse(JSON.stringify(p)),
    body: { respawnX: body.respawnX, respawnY: body.respawnY, scar: { ...body.scar }, stats: { ...body.stats } },
    inv: JSON.parse(JSON.stringify({ slots: inv.slots, sel: inv.sel, wear: inv.wear, sled: inv.sled })),
    dropDur: G.drops.filter(d => dropDur.has(d.id)).map(d => [d.id, dropDur.get(d.id)]),
    backpacks: [...backpacks].map(([id, slots]) => [id, JSON.parse(JSON.stringify(slots))]),
    fixtures: JSON.parse(JSON.stringify(G.fixtures)), drops: JSON.parse(JSON.stringify(G.drops)),
    sites: sites.map(s => s.found),
    search: searchSave(),      // DESIGN §12: which containers have been searched how far / chipped free
    quest: questSave(),
    hunt: huntSave(),          // fish stocks of holes, ptarmigan flocks, tracks (hunt.ts)
  };
}
export function capture(): SaveData {
  const p = G.player;
  const meta: SaveMeta = { v: SAVE_VERSION, savedAt: Date.now(), seed: G.seed, diff: G.diff.level, hardcore: G.diff.hardcore, day: G.day, time: G.time, core: p.core, cycle: G.cycle };
  return { meta, state: captureState(), grid: { mat: mat.slice(), aux: aux.slice(), flags: flags.slice(), bg: bg.slice() } };
}
/** Lay a loaded save over a freshly generated world (call between generateWorld/initPlayer and initSim). */
export function applySave(d: SaveData) {
  const s = d.state;
  mat.set(d.grid.mat); aux.set(d.grid.aux); flags.set(d.grid.flags); bg.set(d.grid.bg);
  Object.assign(G.player, s.player);
  Object.assign(body.scar, s.body.scar); Object.assign(body.stats, s.body.stats); body.respawnX = s.body.respawnX; body.respawnY = s.body.respawnY;
  inv.slots.fill(null); for (let i = 0; i < s.inv.slots.length && i < inv.slots.length; i++) inv.slots[i] = s.inv.slots[i];
  inv.sel = s.inv.sel; Object.assign(inv.wear, s.inv.wear); inv.sled = s.inv.sled;
  G.fixtures.length = 0; for (const f of s.fixtures) G.fixtures.push(f);
  G.drops.length = 0; for (const x of s.drops) G.drops.push(x);
  dropDur.clear(); for (const [id, v] of s.dropDur) dropDur.set(id, v);
  backpacks.clear(); for (const [id, slots] of s.backpacks ?? []) backpacks.set(id, slots);
  G.nextId = Math.max(G.nextId, s.nextId);
  sites.forEach((x, i) => { x.found = !!s.sites?.[i]; });
  questLoad(s.quest);
  searchLoad(s.search);
  huntLoad(s.hunt);            // before initFauna: fish and flocks come back as saved
  setClock(s.time); resyncWeather();           // day, ring (G.cycle) and the ramp are derived from the clock: old saves (with endDay) load as endless
  resetShelter();
}

/** Re-lay the objective progress after the 'new_game' event of a load (quest.ts resets itself on that event). */
export function applyQuestAgain(d: SaveData) { questLoad(d.state.quest); }

// ---- storage ----------------------------------------------------------------------------------------------------------------------
function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function gz(buf: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') return buf;
  const cs = new Blob([buf as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(cs).arrayBuffer());
}
async function gunzip(buf: Uint8Array, packed: boolean): Promise<Uint8Array> {
  if (!packed) return buf;
  const ds = new Blob([buf as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(ds).arrayBuffer());
}

let saving = false;
let saveGen = 0;     // bumped by deleteSave: a save that was in flight when the slot was deleted (hardcore death) must not land afterwards
/** Write the current game to the slot. Resolves true on success. */
export async function saveGame(slot = KEY): Promise<boolean> {
  if (saving || !G.player || !G.player.alive) return false;
  saving = true;
  const gen = saveGen;
  try {
    const d = capture();
    const sz = d.grid.mat.length;
    const all = new Uint8Array(sz * 3 + d.grid.bg.length);
    all.set(d.grid.mat, 0); all.set(d.grid.aux, sz); all.set(d.grid.flags, sz * 2); all.set(d.grid.bg, sz * 3);
    const packed = typeof CompressionStream !== 'undefined';
    const blob = await gz(all);
    const db = await open();
    if (gen !== saveGen) { db.close(); return false; }
    const tx = db.transaction(STORE, 'readwrite');
    await req(tx.objectStore(STORE).put({ meta: d.meta, json: JSON.stringify(d.state), grid: blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength), packed, sz }, slot));
    db.close();
    return true;
  } catch { return false; } finally { saving = false; }
}
async function readRaw(slot = KEY): Promise<any | null> {
  try { const db = await open(); const v = await req(db.transaction(STORE).objectStore(STORE).get(slot)); db.close(); return v ?? null; } catch { return null; }
}
/** Metadata of the slot, or null (no save / unreadable / other version). */
export async function peekSave(slot = KEY): Promise<SaveMeta | null> { const r = await readRaw(slot); return r && r.meta && r.meta.v === SAVE_VERSION ? r.meta : null; }
export async function loadGame(slot = KEY): Promise<SaveData | null> {
  const r = await readRaw(slot);
  if (!r || !r.meta || r.meta.v !== SAVE_VERSION) return null;
  try {
    const all = await gunzip(new Uint8Array(r.grid), !!r.packed), sz = r.sz as number;
    return { meta: r.meta, state: JSON.parse(r.json), grid: { mat: all.subarray(0, sz), aux: all.subarray(sz, sz * 2), flags: all.subarray(sz * 2, sz * 3), bg: all.subarray(sz * 3) } };
  } catch { return null; }
}
export async function deleteSave(slot = KEY): Promise<void> {
  saveGen++;
  try { const db = await open(); await req(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(slot)); db.close(); } catch { /* ignore */ }
}
