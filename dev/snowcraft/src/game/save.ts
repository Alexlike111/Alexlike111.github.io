// Save / continue (DESIGN §10 title "Продолжить"). Two backends with one capture / apply code:
//  - preview build (localStorage store, the default): one IndexedDB slot holding the whole grid (mat / aux / flags / bg, gzip-compressed when
//    CompressionStream exists) + a JSON state blob. Unchanged from before.
//  - Playgama build (Bridge storage, Playgama rule 3.2.1 / 3.2.3): the grid is NOT stored whole (≈5 MB, too big for the storage). The base world
//    is regenerated from the seed (deterministic: snapshotBase() keeps a copy right after generation), and only the cells that differ from it
//    are stored: per array a varint count, then (varint gap, value byte) pairs. The delta + the JSON state go through gzip and base64 and are
//    split into chunks of ≤150 KB under sc.save.<n>, with a small JSON meta under sc.save.meta (what the Continue button needs). One storage
//    call writes meta + all chunks; stale chunks of a longer older save are removed in one more call.
// Saves never run more often than once per 20 s (MIN_GAP_MS); the periodic autosave in title.ts asks autosaveDue() (PG build: 2 game hours
// passed since the last save). Everything is try/catch: blocked storage just means "no save".
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
import { storeGet, storeReadMany, storeWriteBatch, storeKind } from '../platform/store';

export const SAVE_VERSION = 1;
const DB = 'snowcraft', STORE = 'save';
const KEY = 'main';        // default slot; the self-test uses its own slot so it never touches the player's save
const MIN_GAP_MS = 20000;  // a save never starts less than this after the previous one (rule: storage is not written on every frame)
const AUTO_GAME_MIN = 120; // Bridge build: the periodic autosave writes only after this much game time (2 game hours) since the last save
const CHUNK = 150000;      // characters of base64 per storage value

export interface SaveMeta { v: number; savedAt: number; seed: number; diff: 0 | 1 | 2; hardcore: boolean; day: number; time: number; core: number; cycle?: number /* seasons ring (absent in old saves: derived from day) */; chunks?: number /* Bridge build: number of sc.save.<n> chunks */; z?: 0 | 1 /* gzip used */ }
export interface SaveData { meta: SaveMeta; state: any; grid?: { mat: Uint8Array; aux: Uint8Array; flags: Uint8Array; bg: Uint8Array }; delta?: Uint8Array }
type Arr4 = { mat: Uint8Array; aux: Uint8Array; flags: Uint8Array; bg: Uint8Array };
const LAYERS = ['mat', 'aux', 'flags', 'bg'] as const;

/** Sizes of the last Bridge save (bytes; for the report and the size guard). */
export let lastSaveInfo = { cells: 0, jsonBytes: 0, rawBytes: 0, packedBytes: 0, b64Chars: 0, chunks: 0 };
let lastSavedTime = -1;     // game minute of the last successful save / load (Bridge autosave gating)

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

// base world of the current run, taken right after the deterministic generation (newGame, before applySave / the player acts)
let base: Arr4 | null = null;
export function snapshotBase(): void { base = { mat: mat.slice(), aux: aux.slice(), flags: flags.slice(), bg: bg.slice() }; }

/** Lay a loaded save over a freshly generated world (call between generateWorld/initPlayer and initSim). */
export function applySave(d: SaveData) {
  const s = d.state;
  if (d.delta) applyDelta(d.delta, { mat, aux, flags, bg });        // the live grid is the regenerated base here
  else if (d.grid) { mat.set(d.grid.mat); aux.set(d.grid.aux); flags.set(d.grid.flags); bg.set(d.grid.bg); }
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

// ---- delta codec (Bridge build) ---------------------------------------------------------------------------------------------------
class ByteOut {
  private a = new Uint8Array(1 << 16); private n = 0;
  byte(v: number) { if (this.n >= this.a.length) { const b = new Uint8Array(this.a.length * 2); b.set(this.a); this.a = b; } this.a[this.n++] = v; }
  varint(v: number) { while (v >= 0x80) { this.byte((v % 0x80) | 0x80); v = Math.floor(v / 128); } this.byte(v); }
  bytes(): Uint8Array { return this.a.slice(0, this.n); }
}
/** The cells of `live` that differ from `ref`, per layer: varint count, then (varint index gap, value byte). Deterministic, no allocation per cell. */
export function encodeDelta(live: Arr4, ref: Arr4): Uint8Array {
  const out = new ByteOut();
  for (const k of LAYERS) {
    const L = live[k], R = ref[k];
    let cnt = 0;
    for (let i = 0; i < L.length; i++) if (L[i] !== R[i]) cnt++;
    out.varint(cnt);
    let prev = 0;
    for (let i = 0; i < L.length; i++) if (L[i] !== R[i]) { out.varint(i - prev); out.byte(L[i]); prev = i; }
  }
  return out.bytes();
}
/** Write the changed cells of a delta over `dst` (in place). Returns the number of cells written. */
export function applyDelta(bytes: Uint8Array, dst: Arr4): number {
  let p = 0, written = 0;
  const rd = () => { let v = 0, s = 1, c: number; do { c = bytes[p++]; v += (c & 0x7f) * s; s *= 128; } while (c & 0x80); return v; };
  for (const k of LAYERS) {
    const A = dst[k], cnt = rd();
    let idx = 0;
    for (let j = 0; j < cnt; j++) { idx += rd(); A[idx] = bytes[p++]; written++; }
  }
  return written;
}
/** Payload = u32 length of the JSON, the JSON state (UTF-8), the delta. */
function pack(json: string, delta: Uint8Array): Uint8Array {
  const jb = new TextEncoder().encode(json);
  const out = new Uint8Array(4 + jb.length + delta.length);
  new DataView(out.buffer).setUint32(0, jb.length, true);
  out.set(jb, 4); out.set(delta, 4 + jb.length);
  return out;
}
function unpack(buf: Uint8Array): { json: string; delta: Uint8Array } {
  const n = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(0, true);
  return { json: new TextDecoder().decode(buf.subarray(4, 4 + n)), delta: buf.subarray(4 + n) };
}
function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(s: string): Uint8Array {
  const bin = atob(s), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

// ---- common -----------------------------------------------------------------------------------------------------------------------
let saving = false;
let saveGen = 0;     // bumped by deleteSave: a save that was in flight when the slot was deleted (hardcore death) must not land afterwards
let lastStart = -Infinity;
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
const remote = () => storeKind() !== 'local';
const keysOf = (slot: string) => {
  const pre = slot === KEY ? 'sc.save.' : 'sc.save.' + slot + '.';
  return { meta: pre + 'meta', chunk: (i: number) => pre + i };
};
function readMeta(slot: string): (SaveMeta & { chunks?: number; z?: 0 | 1 }) | null {
  try { const s = storeGet(keysOf(slot).meta); if (!s) return null; const m = JSON.parse(s); return m && typeof m === 'object' ? m : null; } catch { return null; }
}

/** Autosave gate for the periodic trigger (title.ts): always true with the localStorage store; the Bridge build saves after 2 game hours. */
export function autosaveDue(): boolean {
  if (!remote()) return true;
  if (!(lastSavedTime >= 0)) return true;
  return Math.abs(G.time - lastSavedTime) >= AUTO_GAME_MIN;
}

/** Write the current game to the slot. Resolves true on success. At most one save per MIN_GAP_MS: a call inside that gap is dropped (the last save is seconds old). */
export function saveGame(slot = KEY): Promise<boolean> {
  if (Date.now() - lastStart < MIN_GAP_MS) return Promise.resolve(false);
  lastStart = Date.now();
  if (!__PG__ && !remote()) return saveIdb(slot);
  return saveRemote(slot);
}
export async function peekSave(slot = KEY): Promise<SaveMeta | null> {
  if (!__PG__ && !remote()) return peekIdb(slot);
  const m = readMeta(slot);
  return m && m.v === SAVE_VERSION ? m : null;
}
export async function loadGame(slot = KEY): Promise<SaveData | null> {
  if (!__PG__ && !remote()) return loadIdb(slot);
  return loadRemote(slot);
}
export async function deleteSave(slot = KEY): Promise<void> {
  if (!__PG__ && !remote()) return deleteIdb(slot);
  saveGen++;
  const m = readMeta(slot), k = keysOf(slot);
  const removes = [k.meta];
  for (let i = 0; i < (m?.chunks ?? 0); i++) removes.push(k.chunk(i));
  await storeWriteBatch([], removes);
}

// ---- Bridge build -----------------------------------------------------------------------------------------------------------------
async function saveRemote(slot: string): Promise<boolean> {
  if (saving || !G.player || !G.player.alive || !base) return false;
  saving = true;
  const gen = saveGen;
  try {
    const delta = encodeDelta({ mat, aux, flags, bg }, base);
    const raw = pack(JSON.stringify(captureState()), delta);
    const z = typeof CompressionStream !== 'undefined';
    const packed = z ? await gz(raw) : raw;
    const b64 = toB64(packed);
    const n = Math.max(1, Math.ceil(b64.length / CHUNK));
    const k = keysOf(slot);
    const prev = readMeta(slot)?.chunks ?? 0;
    const meta: SaveMeta = { v: SAVE_VERSION, savedAt: Date.now(), seed: G.seed, diff: G.diff.level, hardcore: G.diff.hardcore, day: G.day, time: G.time, core: G.player.core, cycle: G.cycle, chunks: n, z: z ? 1 : 0 };
    if (gen !== saveGen) return false;
    const sets: [string, string][] = [[k.meta, JSON.stringify(meta)]];
    for (let i = 0; i < n; i++) sets.push([k.chunk(i), b64.slice(i * CHUNK, (i + 1) * CHUNK)]);
    const removes: string[] = [];
    for (let i = n; i < prev; i++) removes.push(k.chunk(i));
    const ok = await storeWriteBatch(sets, removes);
    lastSaveInfo = { cells: 0, jsonBytes: 0, rawBytes: raw.length, packedBytes: packed.length, b64Chars: b64.length, chunks: n };
    if (ok) lastSavedTime = G.time;
    return ok;
  } catch { return false; } finally { saving = false; }
}
async function loadRemote(slot: string): Promise<SaveData | null> {
  const m = readMeta(slot);
  if (!m || m.v !== SAVE_VERSION || !m.chunks) return null;
  const k = keysOf(slot);
  const keys = Array.from({ length: m.chunks }, (_, i) => k.chunk(i));
  const parts = await storeReadMany(keys);
  if (parts.some(p => p === null)) return null;
  try {
    const bytes = await gunzip(fromB64(parts.join('')), !!m.z);
    const { json, delta } = unpack(bytes);
    lastSavedTime = m.time;
    return { meta: m, state: JSON.parse(json), delta: delta.slice() };
  } catch { return null; }
}

// ---- preview build: IndexedDB (unchanged format) ----------------------------------------------------------------------------------
function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function saveIdb(slot: string): Promise<boolean> {
  if (saving || !G.player || !G.player.alive) return false;
  saving = true;
  const gen = saveGen;
  try {
    const d = capture();
    const sz = d.grid!.mat.length;
    const all = new Uint8Array(sz * 3 + d.grid!.bg.length);
    all.set(d.grid!.mat, 0); all.set(d.grid!.aux, sz); all.set(d.grid!.flags, sz * 2); all.set(d.grid!.bg, sz * 3);
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
async function readRaw(slot: string): Promise<any | null> {
  try { const db = await open(); const v = await req(db.transaction(STORE).objectStore(STORE).get(slot)); db.close(); return v ?? null; } catch { return null; }
}
async function peekIdb(slot: string): Promise<SaveMeta | null> { const r = await readRaw(slot); return r && r.meta && r.meta.v === SAVE_VERSION ? r.meta : null; }
async function loadIdb(slot: string): Promise<SaveData | null> {
  const r = await readRaw(slot);
  if (!r || !r.meta || r.meta.v !== SAVE_VERSION) return null;
  try {
    const all = await gunzip(new Uint8Array(r.grid), !!r.packed), sz = r.sz as number;
    return { meta: r.meta, state: JSON.parse(r.json), grid: { mat: all.subarray(0, sz), aux: all.subarray(sz, sz * 2), flags: all.subarray(sz * 2, sz * 3), bg: all.subarray(sz * 3) } };
  } catch { return null; }
}
async function deleteIdb(slot: string): Promise<void> {
  saveGen++;
  try { const db = await open(); await req(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(slot)); db.close(); } catch { /* ignore */ }
}
