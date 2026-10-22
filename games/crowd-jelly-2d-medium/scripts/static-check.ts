// Static rules that need the TypeScript sources: run by check.mjs through tsx. Prints JSON { fails, warns }.
import { readFileSync } from 'node:fs';
import { LANGS, allDicts } from '../src/kit/i18n';
import '../src/kit/strings';
import '../src/strings';
import { CHANGELOG } from '../src/changelog';
import { FB_DICTS } from '../src/feedback/feedback-i18n';

const fails: string[] = [];
const warns: string[] = [];
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// 1. every string in all 10 languages, no empty value, same {placeholders} as English
for (const d of allDicts()) {
  for (const [key, v] of Object.entries(d)) {
    for (const l of LANGS) {
      if (!v[l] || !v[l].trim()) fails.push(`string "${key}" has no ${l}`);
    }
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const l of LANGS) if (v[l] && ph(v[l]) !== ph(v.en)) fails.push(`string "${key}" ${l}: placeholders differ from en`);
  }
}

// 2. What's new: top entry = package.json version, dated, 10 languages, same line count
if (CHANGELOG[0].v !== pkg.version) fails.push(`changelog top is ${CHANGELOG[0].v}, package.json is ${pkg.version}`);
const seen = new Set<string>();
for (const r of CHANGELOG) {
  if (seen.has(r.v)) fails.push(`changelog: duplicate ${r.v}`);
  seen.add(r.v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) fails.push(`changelog ${r.v}: date must be YYYY-MM-DD`);
  for (const l of LANGS) {
    const lines = r.lines[l];
    if (!lines || !lines.length) fails.push(`changelog ${r.v}: no ${l}`);
    else if (lines.length !== r.lines.en.length) fails.push(`changelog ${r.v} ${l}: ${lines.length} lines, en has ${r.lines.en.length}`);
  }
}

// 3. feedback module has its 10 languages too
for (const l of LANGS) if (!(FB_DICTS as any)[l]) fails.push(`feedback-i18n: no ${l}`);

if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) fails.push(`package.json version "${pkg.version}" is not x.y.z`);
console.log(JSON.stringify({ fails, warns }));
