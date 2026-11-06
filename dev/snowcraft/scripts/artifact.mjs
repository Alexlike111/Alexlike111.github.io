// Turn the single-file Vite build into an Artifact page body (the host adds doctype/head/body).
// usage: node scripts/artifact.mjs <out.html>
import { readFileSync, writeFileSync } from 'node:fs';
const out = process.argv[2];
let s = readFileSync(process.argv[3] || new URL('../dist/index.html', import.meta.url), 'utf8');
const title = (s.match(/<title>[\s\S]*?<\/title>/) || ['<title>SNOWCRAFT</title>'])[0];
s = s.replace(/<title>[\s\S]*?<\/title>/, '')
  .replace(/<!doctype html>/i, '').replace(/<\/?html[^>]*>/gi, '').replace(/<\/?head[^>]*>/gi, '').replace(/<\/?body[^>]*>/gi, '')
  .replace(/<meta charset[^>]*>/i, '').replace(/<meta name="viewport"[^>]*>/i, '');
const page = `${title}\n<style>html,body{height:100%;margin:0;background:#0b1220;overflow:hidden}</style>\n${s.trim()}\n`;
writeFileSync(out, page);
console.log(out, (page.length / 1024 / 1024).toFixed(2) + ' MB');
