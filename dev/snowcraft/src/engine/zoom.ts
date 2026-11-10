// View zoom (DESIGN §14). The world canvas is 1 canvas pixel = 1 cell, upscaled by an INTEGER number of device pixels per cell, so the pixel art
// stays crisp at every zoom. The valid scales are the integers s for which the screen shows between ZOOM_MIN_CELLS and ZOOM_MAX_CELLS cells across.
// The player's choice is stored as "cells across the width" (not as s), so it survives a window resize, a rotation and a different device.
// Pure state + localStorage (try/catch); render.ts asks chooseScale() on every resize(), input / touch / settings call stepZoom() / setZoomIndex().
import { storeGet, storeSet, storeRemove } from '../platform/store';
import { G } from '../game/state';

export const ZOOM_MIN_CELLS = 200;          // most zoomed in: at least this many cells across the width
export const ZOOM_MAX_CELLS = 700;          // most zoomed out
export const ZOOM_DEFAULT_DESKTOP = 400;
export const ZOOM_DEFAULT_PHONE = 320;      // a phone screen is small and the finger is fat, but the landscape window is short: ~320 cells across (integer scale: 324 cells on an 810 px, 2x phone)
const KEY = 'sc.zoom';

let devW = 1600;                            // device pixels across the window (set by render.resize)
let want = 0;                               // wanted cells across the width; 0 = the default of the device
let forceDefault = false;                   // the title screen ignores the saved zoom
const listeners: (() => void)[] = [];

function load() {
  try { const v = Number(storeGet(KEY)); if (isFinite(v) && v >= ZOOM_MIN_CELLS * 0.9 && v <= ZOOM_MAX_CELLS * 1.1) want = v; } catch { /* no storage: the default */ }
}
let loaded = false;
function ensureLoaded() { if (!loaded) { loaded = true; load(); } }
function save() { try { storeSet(KEY, String(Math.round(want))); } catch { /* private window */ } }

export const defaultCells = () => (G.mobile ? ZOOM_DEFAULT_PHONE : ZOOM_DEFAULT_DESKTOP);

/** Integer device-pixel-per-cell scales that fit the window, ascending (small s = zoomed out = many cells across). Never empty. */
export function zoomScales(w = devW): number[] {
  const out: number[] = [];
  for (let s = 1; s <= 24; s++) { const c = w / s; if (c >= ZOOM_MIN_CELLS - 1e-6 && c <= ZOOM_MAX_CELLS + 1e-6) out.push(s); }
  if (!out.length) out.push(Math.max(1, Math.round(w / ((ZOOM_MIN_CELLS + ZOOM_MAX_CELLS) / 4))));       // absurdly small / large window: one sensible step
  return out;
}
const nearest = (list: number[], cells: number) => {
  let best = list[0], bd = 1e9;
  for (const s of list) { const d = Math.abs(Math.log(devW / s / cells)); if (d < bd) { bd = d; best = s; } }
  return best;
};
/** The integer scale to render at, for a window `w` device pixels wide. */
export function chooseScale(w: number): number {
  ensureLoaded();
  devW = Math.max(1, w);
  return nearest(zoomScales(devW), forceDefault || want <= 0 ? defaultCells() : want);
}
export const currentScale = () => chooseScale(devW);
/** Index of the current scale in zoomScales() (0 = most zoomed out). */
export function zoomIndex(): number { return Math.max(0, zoomScales().indexOf(currentScale())); }
export const zoomCount = () => zoomScales().length;
/** Cells across the width at the current zoom. */
export const zoomCells = () => Math.round(devW / currentScale());

/** Select a step by index (clamped). Persists the choice. */
export function setZoomIndex(i: number) {
  const list = zoomScales(); const k = Math.max(0, Math.min(list.length - 1, Math.round(i)));
  ensureLoaded();
  want = devW / list[k]; forceDefault = false; save();
  for (const f of listeners) f();
}
/** One step: dir > 0 closer (bigger pixels, fewer cells), dir < 0 farther. Returns true when the zoom changed. */
export function stepZoom(dir: number): boolean {
  const before = zoomIndex();
  setZoomIndex(before + (dir > 0 ? 1 : -1));
  return zoomIndex() !== before;
}
export function onZoomChange(f: () => void) { listeners.push(f); }
/** The title screen shows the default framing whatever the player chose. */
export function setZoomForcedDefault(on: boolean): boolean { if (on === forceDefault) return false; forceDefault = on; return true; }
/** Forget the saved choice (tests). */
export function resetZoom() { want = 0; forceDefault = false; try { storeRemove(KEY); } catch { /* ignore */ } for (const f of listeners) f(); }
