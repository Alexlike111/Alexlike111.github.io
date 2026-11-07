// node scripts/i18n-split.mjs : splits _source.json into 6 parts src/content/lang/_parts/src_partN.json for translation
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/content/lang'); fs.mkdirSync(path.join(dir, '_parts'), { recursive: true });
const src = JSON.parse(fs.readFileSync(path.join(dir, '_source.json'), 'utf8')); const keys = Object.keys(src); const N = 6, per = Math.ceil(keys.length / N);
for (let i = 0; i < N; i++) { const o = {}; for (const k of keys.slice(i * per, (i + 1) * per)) o[k] = src[k]; fs.writeFileSync(path.join(dir, '_parts', `src_part${i + 1}.json`), JSON.stringify(o, null, 1) + '\n'); }
console.log(keys.length, 'strings in', N, 'parts of ≤', per);
