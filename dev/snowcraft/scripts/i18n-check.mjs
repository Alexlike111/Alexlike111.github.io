// node scripts/i18n-check.mjs [code ...] : checks src/content/lang/<code>.json against _source.json (all keys, same {placeholders}, no empty values)
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/content/lang');
const src = JSON.parse(fs.readFileSync(path.join(dir, '_source.json'), 'utf8'));
const codes = process.argv.slice(2).length ? process.argv.slice(2) : ['en', 'zh', 'hi', 'es', 'ar', 'fr', 'bn', 'pt', 'id'];
const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
let bad = 0;
for (const c of codes) {
  const f = path.join(dir, c + '.json'); if (!fs.existsSync(f)) { console.log(c, 'MISSING FILE'); bad++; continue; }
  let t; try { t = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { console.log(c, 'INVALID JSON', e.message); bad++; continue; }
  const miss = Object.keys(src).filter(k => src[k].trim() && (!(k in t) || typeof t[k] !== 'string' || !t[k].trim()));   // keys whose Russian source is empty may stay empty
  const extra = Object.keys(t).filter(k => !(k in src));
  const phBad = Object.keys(src).filter(k => typeof t[k] === 'string' && ph(t[k]) !== ph(src[k]));
  const same = Object.keys(src).filter(k => t[k] === src[k] && /[А-Яа-я]/.test(src[k])).length;
  console.log(c, `missing ${miss.length}, extra ${extra.length}, placeholder mismatches ${phBad.length}, still-Russian ${same}`);
  if (miss.length) console.log('   missing e.g.', miss.slice(0, 5).join(' ')); if (phBad.length) console.log('   ph e.g.', phBad.slice(0, 5).map(k => k + ' | ' + src[k] + ' | ' + t[k]).join('\n       '));
  if (miss.length || phBad.length) bad++;
}
process.exit(bad ? 1 : 0);
