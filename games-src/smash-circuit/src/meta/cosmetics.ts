// Cosmetics: premium paints and liveries, bought per car with coins and equipped per car.
// PURE (no DOM, no three.js). Stored in `save.cosmetics`, defaulted when missing. The free base colours stay in
// save.carColor; an equipped premium paint overrides it for that car only.
import type { SaveData } from '../types';
import { CAR_IDS, carIdOr } from './cars';

export interface PaintDef { id: string; color: number; price: number }
export interface LiveryDef { id: string; price: number; accent: number }

export const PAINTS: PaintDef[] = [
  { id: 'lava', color: 0xd7261e, price: 300 },
  { id: 'mint', color: 0x7fe3b5, price: 300 },
  { id: 'midnight', color: 0x27306b, price: 400 },
  { id: 'gold', color: 0xd9a92b, price: 600 },
  { id: 'toxic', color: 0x9bf02a, price: 500 },
  { id: 'graphite', color: 0x3b3f47, price: 400 },
];

export const LIVERIES: LiveryDef[] = [
  { id: 'none', price: 0, accent: 0xffffff },
  { id: 'stripes', price: 250, accent: 0xffffff },
  { id: 'racing', price: 350, accent: 0x14213d },
  { id: 'flames', price: 500, accent: 0xffb21e },
];

/** colorIndex values >= this select PAINTS[index - base] (the renderer resolves them in render/paintLayer.ts). */
export const PREMIUM_BASE = 100;

export interface CosmeticsState {
  /** owned item ids per car ('p:<paint>' / 'l:<livery>') */
  owned: Record<string, string[]>;
  /** equipped premium paint id per car (absent = the free base colour) */
  paint: Record<string, string>;
  /** equipped livery id per car (absent = none) */
  livery: Record<string, string>;
}

export function defaultCosmetics(): CosmeticsState { return { owned: {}, paint: {}, livery: {} }; }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const paintIds = PAINTS.map((p) => p.id);
const liveryIds = LIVERIES.map((l) => l.id);
const validItem = (s: unknown): s is string =>
  typeof s === 'string' && ((s.startsWith('p:') && paintIds.includes(s.slice(2))) || (s.startsWith('l:') && liveryIds.includes(s.slice(2))));

export function sanitizeCosmetics(v: unknown): CosmeticsState {
  const out = defaultCosmetics();
  if (!isObj(v)) return out;
  const owned = isObj(v.owned) ? v.owned : {}, paint = isObj(v.paint) ? v.paint : {}, livery = isObj(v.livery) ? v.livery : {};
  for (const id of CAR_IDS) {
    const o = owned[id];
    const list = Array.isArray(o) ? [...new Set(o.filter(validItem))] : [];
    if (list.length) out.owned[id] = list;
    const p = paint[id], l = livery[id];
    if (typeof p === 'string' && list.includes('p:' + p)) out.paint[id] = p;
    if (typeof l === 'string' && l !== 'none' && list.includes('l:' + l)) out.livery[id] = l;
  }
  return out;
}

export function cosmeticsOf(save: SaveData): CosmeticsState { return sanitizeCosmetics(save.cosmetics); }

export type Item = { type: 'paint' | 'livery'; id: string };
const key = (it: Item): string => (it.type === 'paint' ? 'p:' : 'l:') + it.id;
export function priceOf(it: Item): number | null {
  const d = it.type === 'paint' ? PAINTS.find((p) => p.id === it.id) : LIVERIES.find((l) => l.id === it.id);
  return d ? d.price : null;
}

export function owns(save: SaveData, carId: string, it: Item): boolean {
  if (it.type === 'livery' && it.id === 'none') return true;
  return (cosmeticsOf(save).owned[carIdOr(carId)] ?? []).includes(key(it));
}

/** Buys (and equips) an item for car `carId`. null when unknown, already owned or not affordable. */
export function buyCosmetic(save: SaveData, carId: string, it: Item): SaveData | null {
  const id = carIdOr(carId);
  const price = priceOf(it);
  if (price === null || owns(save, id, it) || save.money < price) return null;
  const c = cosmeticsOf(save);
  const owned = { ...c.owned, [id]: [...(c.owned[id] ?? []), key(it)] };
  return equipCosmetic({ ...save, money: save.money - price, cosmetics: { ...c, owned } }, id, it);
}

/** Equips an owned item (paint id '' = back to the free base colour). null when not owned. */
export function equipCosmetic(save: SaveData, carId: string, it: Item): SaveData | null {
  const id = carIdOr(carId);
  const c = cosmeticsOf(save);
  if (it.type === 'paint') {
    const paint = { ...c.paint };
    if (it.id === '') delete paint[id];
    else if (owns(save, id, it)) paint[id] = it.id;
    else return null;
    return { ...save, cosmetics: { ...c, paint } };
  }
  if (!owns(save, id, it)) return null;
  const livery = { ...c.livery };
  if (it.id === 'none') delete livery[id]; else livery[id] = it.id;
  return { ...save, cosmetics: { ...c, livery } };
}

/** Render colour index for car `carId`: the equipped premium paint (PREMIUM_BASE + i) or the free colour. */
export function paintIndexFor(save: SaveData, carId: string = save.car): number {
  const p = cosmeticsOf(save).paint[carIdOr(carId)];
  const i = p ? paintIds.indexOf(p) : -1;
  return i >= 0 ? PREMIUM_BASE + i : save.carColor;
}

export function liveryFor(save: SaveData, carId: string = save.car): string {
  return cosmeticsOf(save).livery[carIdOr(carId)] ?? 'none';
}
