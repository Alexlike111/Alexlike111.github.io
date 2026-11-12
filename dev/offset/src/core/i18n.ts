// Tiny i18n. Content data carries {ru,en} pairs (type L); UI strings live in ui/strings.ts.
export type Lang = 'ru' | 'en';
export interface L { ru: string; en: string }
let lang: Lang = 'ru';
export function detectLang(): Lang { const n = (navigator.language || 'en').toLowerCase(); return /^(ru|uk|be|kk)/.test(n) ? 'ru' : 'en'; }
export function setLang(l: Lang) { lang = l; document.documentElement.lang = l; }
export function getLang(): Lang { return lang; }
export const tr = (s: L): string => s[lang];
