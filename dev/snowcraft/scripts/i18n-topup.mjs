// node scripts/i18n-topup.mjs todo  : after `node scripts/i18n-dump.cjs dist/index.html`, writes src/content/lang/_todo/<code>.json = {key: RU} for every key missing/empty in <code>.json
// node scripts/i18n-topup.mjs apply : merges src/content/lang/_todo/<code>_done.json into <code>.json, drops keys that no longer exist in _source.json, sorts by _source order
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/content/lang'); const todo = path.join(dir, '_todo'); fs.mkdirSync(todo, { recursive: true });
const src = JSON.parse(fs.readFileSync(path.join(dir, '_source.json'), 'utf8')); const codes = ['en', 'zh', 'hi', 'es', 'ar', 'fr', 'bn', 'pt', 'id'];
const mode = process.argv[2];
for (const c of codes) {
  const f = path.join(dir, c + '.json'); const t = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
  if (mode === 'todo') {
    const need = {}; for (const k of Object.keys(src)) if (src[k].trim() && !(typeof t[k] === 'string' && t[k].trim())) need[k] = src[k];
    fs.writeFileSync(path.join(todo, c + '.json'), JSON.stringify(need, null, 1) + '\n'); console.log(c, Object.keys(need).length, 'to translate');
  } else if (mode === 'apply') {
    const d = path.join(todo, c + '_done.json'); const done = fs.existsSync(d) ? JSON.parse(fs.readFileSync(d, 'utf8')) : {};
    const out = {}; for (const k of Object.keys(src)) { const v = typeof done[k] === 'string' && done[k].trim() ? done[k] : t[k]; if (typeof v === 'string') out[k] = v; }
    fs.writeFileSync(f, JSON.stringify(out, null, 1) + '\n'); console.log(c, 'applied', Object.keys(done).length, 'total', Object.keys(out).length);
  } else { console.error('usage: todo | apply'); process.exit(2); }
}
