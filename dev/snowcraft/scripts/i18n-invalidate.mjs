// node scripts/i18n-invalidate.mjs <key> [key ...] : deletes these keys from all language packs so `i18n-topup.mjs todo` asks for a fresh translation (use after changing the Russian text of a key)
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/content/lang'); const keys = process.argv.slice(2);
if (!keys.length) { console.error('usage: node scripts/i18n-invalidate.mjs <key> ...'); process.exit(2); }
for (const c of ['en', 'zh', 'hi', 'es', 'ar', 'fr', 'bn', 'pt', 'id']) { const f = path.join(dir, c + '.json'); const t = JSON.parse(fs.readFileSync(f, 'utf8')); let n = 0; for (const k of keys) if (k in t) { delete t[k]; n++; } fs.writeFileSync(f, JSON.stringify(t, null, 1) + '\n'); console.log(c, 'removed', n); }
