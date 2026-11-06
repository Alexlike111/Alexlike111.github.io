// CONTRACT FILE — localisation. Source language is Russian, written inline next to the code that uses it:
//   const S = strings('hud', { warmth: 'Тепло', feels: 'Ощущается {t}°' });
//   el.textContent = S.warmth;  el.textContent = fmt(S.feels, { t: -31 });
// Keys become 'hud.warmth'. Translations live in src/content/lang/<code>.json ({ "hud.warmth": "Warmth", ... }).
// Material/item names: matName(id) / itemName(id) look up 'mat.<KEY>' / 'item.<id>' and fall back to the RU data.
// NEVER hard-code player-facing text without strings(); never build sentences by concatenating translated fragments.
export const LANGS = ['ru', 'en', 'zh', 'hi', 'es', 'ar', 'fr', 'bn', 'pt', 'id'] as const;
export type Lang = typeof LANGS[number];
export const LANG_NAMES: Record<Lang, string> = { ru: 'Русский', en: 'English', zh: '中文', hi: 'हिन्दी', es: 'Español', ar: 'العربية', fr: 'Français', bn: 'বাংলা', pt: 'Português', id: 'Bahasa Indonesia' };
export const RTL: Partial<Record<Lang, boolean>> = { ar: true };

const source: Record<string, string> = {};          // key -> RU text (registered at import time)
let table: Record<string, string> = {};             // key -> current language text
let lang: Lang = 'ru';
const packs: Partial<Record<Lang, Record<string, string>>> = {};
const listeners: (() => void)[] = [];

/** Register RU source strings under a namespace; returns a live object whose properties read the current language. */
export function strings<T extends Record<string, string>>(ns: string, ru: T): T {
  for (const k in ru) source[ns + '.' + k] = ru[k];
  const out = {} as T;
  for (const k in ru) Object.defineProperty(out, k, { enumerable: true, get: () => table[ns + '.' + k] ?? ru[k] });
  return out;
}
/** Fill {name} placeholders. */
export function fmt(s: string, vars: Record<string, string | number>) { return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : '{' + k + '}')); }
/** Lookup by full key with RU fallback (for data-driven names). */
export function tr(key: string, fallback: string) { return table[key] ?? source[key] ?? fallback; }
export function registerSource(key: string, ru: string) { source[key] = ru; }
export function addPack(l: Lang, p: Record<string, string>) { packs[l] = p; if (l === lang) table = p; }
export function setLang(l: Lang) { lang = l; table = l === 'ru' ? {} : packs[l] ?? {}; if (typeof document !== 'undefined') { document.documentElement.lang = l; document.documentElement.dir = RTL[l] ? 'rtl' : 'ltr'; } for (const f of listeners) f(); }
export function getLang() { return lang; }
export function onLang(f: () => void) { listeners.push(f); }
export function detectLang(): Lang {
  const nav = (typeof navigator !== 'undefined' ? navigator.languages?.[0] || navigator.language : 'ru') || 'ru';
  const c = nav.slice(0, 2).toLowerCase() as Lang;
  return (LANGS as readonly string[]).includes(c) ? c : 'en';
}
/** All registered RU source strings (used by tests/i18n-dump to produce the translation source file). */
export function dumpSource() { return { ...source }; }
