import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { EN, RU, initLang, lang, langSetting, resolveLang, setLangSetting, t } from '../src/i18n';
import { TRACKS } from '../src/track/tracks';

describe('dictionaries', () => {
  it('en and ru have exactly the same keys', () => {
    const en = Object.keys(EN).sort(), ru = Object.keys(RU).sort();
    expect(ru.filter((k) => !(k in EN))).toEqual([]);
    expect(en.filter((k) => !(k in RU))).toEqual([]);
  });

  it('no empty strings; ru is really translated (not a copy of en) except for shared tokens', () => {
    const shared = new Set(['hud.repairKey']);
    for (const k of Object.keys(EN)) {
      expect(EN[k].trim().length, k).toBeGreaterThan(0);
      expect(RU[k].trim().length, k).toBeGreaterThan(0);
      if (!shared.has(k)) expect(RU[k], k).not.toBe(EN[k]);
    }
  });

  it('placeholders match between languages', () => {
    const ph = (s: string): string[] => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of Object.keys(EN)) expect(ph(RU[k]), k).toEqual(ph(EN[k]));
  });

  it('every track name key exists', () => {
    for (const tr of TRACKS) { expect(EN[tr.nameKey]).toBeDefined(); expect(RU[tr.nameKey]).toBeDefined(); }
  });

  it('dynamic key families used by the UI exist', () => {
    for (const k of ['speed', 'accel', 'grip', 'armor']) expect(EN['stat.' + k]).toBeDefined();
    for (const b of ['engine', 'grip', 'armor']) { expect(EN['up.' + b]).toBeDefined(); expect(EN['up.' + b + '.desc']).toBeDefined(); }
  });

  it('has ordinals for all places', () => {
    for (let p = 1; p <= CONFIG.race.cars; p++) expect(EN['ordinal.' + p]).toBeDefined();
  });

  it('every t(\'literal\') key used in src/ is defined', () => {
    const sources = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    const missing: string[] = [];
    for (const [f, src] of Object.entries(sources)) {
      for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'\s*[,)]/g)) if (!(m[1] in EN)) missing.push(`${f}: ${m[1]}`);
      for (const m of src.matchAll(/data-t="([a-zA-Z0-9_.]+)"/g)) if (!(m[1] in EN)) missing.push(`${f}: ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });
});

describe('t() and language resolution', () => {
  it('uses the platform language when set to auto', () => {
    initLang('ru', 'auto');
    expect(lang()).toBe('ru');
    expect(t('menu.play')).toBe(RU['menu.play']);
    initLang('en-US', 'auto');
    expect(lang()).toBe('en');
    initLang('pt', 'auto');
    expect(lang()).toBe('en');                      // fallback
    initLang('uk', 'auto');
    expect(lang()).toBe('ru');                      // Russian-speaking regions
  });

  it('explicit setting beats the platform language and can change later', () => {
    initLang('ru', 'en');
    expect(lang()).toBe('en');
    setLangSetting('ru');
    expect(lang()).toBe('ru');
    expect(langSetting()).toBe('ru');
    setLangSetting('auto');
    expect(lang()).toBe('ru');                      // platform language was ru
    expect(resolveLang('de', 'auto')).toBe('en');
    expect(resolveLang('', 'auto')).toBe('en');
  });

  it('interpolates params and falls back to the key for unknown keys', () => {
    initLang('en', 'en');
    expect(t('track.laps', { n: 3 })).toBe('Laps: 3');
    expect(t('results.unlocked', { track: 'X' })).toBe('New track unlocked: X');
    expect(t('no.such.key')).toBe('no.such.key');
    expect(t('track.laps')).toBe('Laps: {n}');      // missing param stays visible, no crash
    initLang('en', 'ru');
    expect(t('track.laps', { n: 2 })).toBe('Кругов: 2');
  });
});
