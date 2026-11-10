// All persistent key-value data of the game (settings, hints memory, records, language choice, the save in the PG build) goes through this module.
// Playgama rule 3.2.1: progress and settings are saved ONLY through the Bridge storage module — never localStorage / IndexedDB / cookies.
// So: reads are synchronous from an in-memory cache that storeInit() fills once at boot; writes update the cache at once and reach the backend
// (the Bridge in the Playgama build, localStorage in the plain preview/artifact build and in the tests) coalesced into one call.
// In the PG build the localStorage backend is not even compiled in (PG is a compile-time constant, see globals.d.ts).
import { PG } from './pg';

export interface StoreBackend {
  /** true: writes go through immediately (localStorage); false: batched after a short delay (the Bridge: «write only on meaningful change, all keys in one call») */
  immediate: boolean;
  get(keys: string[]): Promise<(string | null)[]>;
  set(keys: string[], values: string[]): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

const cache = new Map<string, string>();
const dirty = new Set<string>(), removed = new Set<string>();
let timer = 0;

const localBackend: StoreBackend | null = PG ? null : {
  immediate: true,
  async get(keys) { return keys.map(k => { try { return localStorage.getItem(k); } catch { return null; } }); },
  async set(keys, values) { keys.forEach((k, i) => { try { localStorage.setItem(k, values[i]); } catch { /* blocked: the value lives in the cache until the page closes */ } }); },
  async remove(keys) { for (const k of keys) { try { localStorage.removeItem(k); } catch { /* ignore */ } } },
};
// PG build without a Bridge (the SDK script did not load): values live in memory for the page's lifetime only
const memoryBackend: StoreBackend = {
  immediate: true,
  async get(keys) { return keys.map(k => cache.get(k) ?? null); },
  async set() { /* the cache already holds the values */ },
  async remove() { /* the cache already dropped them */ },
};
let backend: StoreBackend = localBackend ?? memoryBackend;

/** The Playgama build installs the Bridge backend here (src/platform/bridge.ts) before storeInit(). */
export function setStoreBackend(b: StoreBackend) { backend = b; }
export function getStoreBackend(): StoreBackend { return backend; }
export const storeBackendIsLocal = () => localBackend !== null && backend === localBackend;
/** 'local' = localStorage (preview build), 'bridge' = any other backend (the Bridge, or the memory fallback of the PG build). */
export const storeKind = (): 'local' | 'bridge' => (storeBackendIsLocal() ? 'local' : 'bridge');

/** Keys the game reads synchronously later; call once at boot and await it before the UI is built. Never throws. */
export async function storeInit(keys: string[]): Promise<void> {
  try {
    const vals = await backend.get(keys);
    keys.forEach((k, i) => { const v = vals[i]; if (typeof v === 'string') cache.set(k, v); });
  } catch { /* storage unavailable: defaults are used */ }
}
export function storeGet(k: string): string | null { return cache.get(k) ?? null; }
export function storeSet(k: string, v: string): void {
  cache.set(k, v); dirty.add(k); removed.delete(k); schedule();
}
export function storeRemove(k: string): void {
  cache.delete(k); dirty.delete(k); removed.add(k); schedule();
}
function schedule() {
  if (backend.immediate) { void flush(); return; }
  if (!timer) timer = window.setTimeout(() => { timer = 0; void flush(); }, 400);
}
/** Write everything pending in as few backend calls as possible (also used before the page is hidden). */
export async function flush(): Promise<void> {
  const ks = [...dirty], rs = [...removed]; dirty.clear(); removed.clear();
  try {
    if (ks.length) await backend.set(ks, ks.map(k => cache.get(k) ?? ''));
    if (rs.length) await backend.remove(rs);
  } catch { for (const k of ks) dirty.add(k); for (const k of rs) removed.add(k); }
}
/** A big value (the save) written explicitly; resolves when the backend has it. */
export async function storeSetNow(k: string, v: string): Promise<boolean> {
  cache.set(k, v); dirty.delete(k);
  try { await backend.set([k], [v]); return true; } catch { return false; }
}
export async function storeGetNow(k: string): Promise<string | null> {
  try { const [v] = await backend.get([k]); if (typeof v === 'string') { cache.set(k, v); return v; } } catch { /* ignore */ }
  return null;
}
export async function storeRemoveNow(k: string): Promise<void> {
  cache.delete(k); dirty.delete(k);
  try { await backend.remove([k]); } catch { /* ignore */ }
}
/** Read keys that are not cached (the save chunks), one backend call. Never throws: null for every key on failure. */
export async function storeReadMany(keys: string[]): Promise<(string | null)[]> {
  try { const v = await backend.get(keys); return keys.map((_, i) => (typeof v[i] === 'string' ? v[i] : null)); } catch { return keys.map(() => null); }
}
/** One save written in ONE backend call (sets) plus one call for the keys to drop (removes). Keeps the cache in step. Resolves false on failure. */
export async function storeWriteBatch(sets: [string, string][], removes: string[]): Promise<boolean> {
  for (const [k, v] of sets) { cache.set(k, v); dirty.delete(k); removed.delete(k); }
  for (const k of removes) { cache.delete(k); dirty.delete(k); }
  try {
    if (sets.length) await backend.set(sets.map(s => s[0]), sets.map(s => s[1]));
    if (removes.length) await backend.remove(removes);
    return true;
  } catch { return false; }
}
