// 10 languages, English is the default and the fallback. `npm run check` fails if any string misses a language.

export const LANGS = ['en', 'ru', 'uk', 'es', 'pt', 'de', 'fr', 'tr', 'id', 'hi'] as const;
export type Lang = (typeof LANGS)[number];
/** Native names for the language switcher. */
export const LANG_NAMES: Record<Lang, string> = {
  en: 'English', ru: 'Русский', uk: 'Українська', es: 'Español', pt: 'Português',
  de: 'Deutsch', fr: 'Français', tr: 'Türkçe', id: 'Indonesia', hi: 'हिन्दी',
};

export type Dict = Record<string, Record<Lang, string>>;

export const isLang = (s: unknown): s is Lang => typeof s === 'string' && (LANGS as readonly string[]).includes(s);

/** 'pt-BR' -> 'pt', unknown -> 'en'. */
export function pickLang(code: string | undefined): Lang {
  const c = (code || 'en').toLowerCase().split(/[-_]/)[0];
  return isLang(c) ? c : 'en';
}

let current: Lang = 'en';
const dicts: Dict[] = [];
const listeners: (() => void)[] = [];

export function addDict(d: Dict): void {
  dicts.push(d);
}
export const getLang = (): Lang => current;
export function setLang(l: Lang): void {
  current = l;
  document.documentElement.lang = l;
  listeners.forEach((f) => f());
}
export const onLang = (f: () => void): void => void listeners.push(f);

/** t('play'), t('score', { n: 5 }) replaces {n}. */
export function t(key: string, vars?: Record<string, string | number>): string {
  let s = '';
  for (const d of dicts) {
    const e = d[key];
    if (e) {
      s = e[current] ?? e.en;
      break;
    }
  }
  if (!s) return key;
  if (vars) for (const k in vars) s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(vars[k]));
  return s;
}

export const allDicts = (): Dict[] => dicts;
