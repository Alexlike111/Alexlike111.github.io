// Save in Bridge storage (cloud on YouTube / Playgama). One JSON object; unknown fields are kept.
import { platform } from './bridge';
import { isLang, type Lang } from './i18n';

export interface KitSave {
  lang?: Lang;
  sound: boolean;
  music: boolean;
  newsSeen: string; // last "What's new" version the player opened
  runs: number; // finished runs, all time
  hintShown: boolean; // first-launch controls hint
  fb: Record<string, number>; // shared/feedback module state
}

export const KIT_DEFAULTS: KitSave = { sound: true, music: true, newsSeen: '', runs: 0, hintShown: false, fb: {} };

/** Load JSON from storage and merge it over the defaults; a broken save falls back to the defaults. */
export async function loadSave<T extends KitSave>(defaults: T): Promise<T> {
  try {
    const raw = await platform.loadData();
    if (!raw) return { ...defaults };
    const o = JSON.parse(raw);
    const s = { ...defaults, ...o } as T;
    if (!isLang(s.lang)) delete s.lang;
    return s;
  } catch {
    return { ...defaults };
  }
}

let timer = 0;
/** Debounced: many calls in a burst become one write. `now` flushes at once (end of a run). */
export function persist<T extends KitSave>(s: T, now = false): void {
  clearTimeout(timer);
  const go = () => void platform.saveData(JSON.stringify(s));
  if (now) go();
  else timer = window.setTimeout(go, 600);
}
