// node scripts/i18n-merge.mjs <code> : merges src/content/lang/_parts/<code>_partN.json into src/content/lang/<code>.json (then run i18n-check.mjs <code>)
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/content/lang'); const code = process.argv[2];
if (!code) { console.error('usage: node scripts/i18n-merge.mjs <code>'); process.exit(2); }
const out = {}; let n = 0;
for (let i = 1; i <= 6; i++) { const f = path.join(dir, '_parts', `${code}_part${i}.json`); if (!fs.existsSync(f)) { console.log('missing', path.basename(f)); continue; } Object.assign(out, JSON.parse(fs.readFileSync(f, 'utf8'))); n++; }
fs.writeFileSync(path.join(dir, code + '.json'), JSON.stringify(out, null, 1) + '\n'); console.log(code, 'merged', n, 'parts,', Object.keys(out).length, 'strings');
