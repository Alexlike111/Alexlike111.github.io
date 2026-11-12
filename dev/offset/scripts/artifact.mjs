// dist/index.html → body fragment for publishing as an artifact (the host wraps it in its own skeleton)
import fs from 'node:fs';
const out = process.argv[2];
let s = fs.readFileSync('dist/index.html', 'utf8');
s = s.replace(/<!doctype html>/i, '').replace(/<\/?html[^>]*>/gi, '').replace(/<\/?head>/gi, '').replace(/<\/?body>/gi, '').replace(/<meta[^>]*>/gi, '');
s = s.replace(/<title>[^<]*<\/title>/i, '<title>СДВИГ OFFSET</title>');
// keep the title within the first bytes: move it to the very top
s = '<title>СДВИГ OFFSET</title>\n' + s.replace(/<title>[^<]*<\/title>/i, '').trim() + '\n';
fs.writeFileSync(out, s);
console.log('wrote', out, (s.length / 1024).toFixed(0) + ' kB');
