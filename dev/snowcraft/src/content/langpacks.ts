// Translation packs (src/content/lang/<code>.json, key -> text; RU is the source, see i18n.ts). Browser entry only (main.ts): import.meta.glob is not available in the tsx unit tests.
import { addPack, LANGS, type Lang } from './i18n';
const mods = import.meta.glob('./lang/[a-z][a-z].json', { eager: true, import: 'default' }) as Record<string, Record<string, string>>;
for (const [path, pack] of Object.entries(mods)) {
  const code = path.slice(path.lastIndexOf('/') + 1, -5) as Lang;
  if ((LANGS as readonly string[]).includes(code) && code !== 'ru') addPack(code, pack);
}
