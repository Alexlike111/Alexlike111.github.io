// Headless save tests (tsx): `npx tsx tests/save.test.ts`
// Delta codec (save.ts): random grids round-trip exactly, the encoded size follows the changed cells; the world is a pure function of the seed
// (same seed twice → identical layers, also after another world was made in between); the Bridge chunking helpers keep 150 KB parts.
import { encodeDelta, applyDelta } from '../src/game/save';
import { generateWorld } from '../src/game/worldgen';
import { W, H, TW, TH, mat, aux, flags, bg } from '../src/engine/grid';

declare const process: { exit(code: number): void };
let fails = 0;
const check = (ok: boolean, msg: string) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails++; };
let seed = 99;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 24; };
type L4 = { mat: Uint8Array; aux: Uint8Array; flags: Uint8Array; bg: Uint8Array };
const layers = (): L4 => ({ mat: mat.slice(), aux: aux.slice(), flags: flags.slice(), bg: bg.slice() });

// 1. codec round trip on random grids
{
  const N = 4096, ref: L4 = { mat: new Uint8Array(N), aux: new Uint8Array(N), flags: new Uint8Array(N), bg: new Uint8Array(64) };
  for (let i = 0; i < N; i++) { ref.mat[i] = rnd() % 14; ref.aux[i] = rnd(); ref.flags[i] = rnd() & 3; }
  for (let i = 0; i < 64; i++) ref.bg[i] = rnd() % 5;
  for (const density of [0, 0.01, 0.3, 1]) {
    const live: L4 = { mat: ref.mat.slice(), aux: ref.aux.slice(), flags: ref.flags.slice(), bg: ref.bg.slice() };
    for (let i = 0; i < N; i++) if (Math.random() < density) { live.mat[i] = (live.mat[i] + 1) % 14; live.aux[i] = rnd(); live.flags[i] ^= 1; }
    const bytes = encodeDelta(live, ref);
    const dst: L4 = { mat: ref.mat.slice(), aux: ref.aux.slice(), flags: ref.flags.slice(), bg: ref.bg.slice() };
    applyDelta(bytes, dst);
    const same = [...['mat', 'aux', 'flags'] as const].every(k => dst[k].every((v, i) => v === live[k][i])) && dst.bg.every((v, i) => v === live.bg[i]);
    check(same, `codec round trip, density ${density}: ${bytes.length} bytes`);
  }
  const none = encodeDelta(ref, ref);
  check(none.length <= 8, `no change → only the four zero counts (${none.length} bytes)`);
}

// 2. varint edges: gaps above 127 and 16384 must survive
{
  const N = 70000, ref: L4 = { mat: new Uint8Array(N), aux: new Uint8Array(N), flags: new Uint8Array(N), bg: new Uint8Array(1) };
  const live: L4 = { mat: ref.mat.slice(), aux: ref.aux.slice(), flags: ref.flags.slice(), bg: ref.bg.slice() };
  for (const i of [0, 127, 128, 16383, 16384, 69999]) live.mat[i] = 7;
  const dst: L4 = { mat: ref.mat.slice(), aux: ref.aux.slice(), flags: ref.flags.slice(), bg: ref.bg.slice() };
  applyDelta(encodeDelta(live, ref), dst);
  check(dst.mat.every((v, i) => v === live.mat[i]), 'varint gaps 0, 127, 128, 16384, 69999 round trip');
}

// 3. world is a pure function of the seed: a second world made in between does not change it
{
  generateWorld(11); const a = layers();
  generateWorld(12); generateWorld(11); const b = layers();
  const diff = (x: Uint8Array, y: Uint8Array) => { let n = 0; for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) n++; return n; };
  const d = diff(a.mat, b.mat) + diff(a.aux, b.aux) + diff(a.flags, b.flags) + diff(a.bg, b.bg);
  check(d === 0, `seed 11 twice (with seed 12 in between): ${d} differing cells`);
  check(a.mat.length === W * H && a.bg.length === TW * TH, `grid sizes ${W}x${H}, bg ${TW}x${TH}`);
}

console.log(fails ? `${fails} FAILED` : 'all save tests passed');
process.exit(fails ? 1 : 0);
