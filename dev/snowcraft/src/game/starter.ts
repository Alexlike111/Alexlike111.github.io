// A wind-packed drift next to the spawn, so the very first knife cut works: the lee of the station holds a slab of packed snow with a density
// of ~250-340 kg/m3 (the ideal block class) while the rest of the snowpack nearby is loose (< 220, crumbles when cut).
// The slab sits east of the barometer post (x 714-728), clear of the coal sacks of the diesel shed (x 740-756): before, it buried them (ONB-1).
// The start kit's matches go onto the belt (ONB-3), so the first fire needs no digging through the pack.
import { W, mat, aux, flags, shade, edited } from '../engine/grid';
import { MAT } from '../content/materials';
import { DOOR } from './snowpack';
import { G, toast } from './state';
import { on } from './bus';
import { inv, swap, BELT } from './inventory';
import { strings, fmt } from '../content/i18n';

const S = strings('starter', {
  matchesBelt: 'Спички в поясе: клавиша {k}',
});

export function seedStarterDrift(spawnX: number) {
  // DESIGN §13: the spawn stands on the wind-slab lee drift of the house (snowpack.ts, aux 140-200 = 290-380 kg/m3): the first knife cut works right there. The old
  // extra slab east of the spawn buried the coal sacks in front of the generator shed (x 740-756), so it is only a fallback now (and sits clear of them).
  if (DOOR.crest > 0) { liftBuriedCoal(spawnX); return; }
  const xa = spawnX + 22, xb = spawnX + 36;
  for (let x = xa; x <= xb; x++) {
    let top = 200; while (top < 600 && mat[top * W + x] === MAT.AIR) top++;
    if (top >= 600) continue;
    const u = (x - xa) / (xb - xa);
    const h = Math.round(10 * Math.pow(Math.sin(Math.PI * u), 0.7));
    for (let y = top - h; y < top + 14; y++) {
      const i = y * W + x, m = mat[i];
      if (m !== MAT.AIR && m !== MAT.SNOW && m !== MAT.PACKED) break;      // stop at ice / rock / fixtures
      mat[i] = MAT.PACKED; aux[i] = 128 + ((x * 7 + y * 3) % 31); flags[i] = 0; shade[i] = (x * 13 + y * 7) & 255;
    }
  }
  edited(xa, 150, xb, 400);
  liftBuriedCoal(spawnX);
}

/** Coal sacks near the spawn that still sit inside snow are lifted to the first free cell above it (they lie on the surface, visible). */
function liftBuriedCoal(spawnX: number) {
  for (const d of G.drops) {
    if (d.item !== 'coal' || Math.abs(d.x - spawnX) > 120) continue;
    const x = Math.floor(d.x);
    let y = Math.floor(d.y);
    if (mat[y * W + x] === MAT.AIR) continue;
    while (y > 0 && mat[y * W + x] !== MAT.AIR) y--;
    d.y = y;
  }
}

/** ONB-3: the matches (a stack, so the game puts them in the pack first) go to the first free belt slot. Returns the belt slot or -1. */
export function beltMatches(): number {
  const from = inv.slots.findIndex((s, i) => i >= BELT && s?.id === 'matches');
  if (from < 0 || inv.slots.slice(0, BELT).some(s => s?.id === 'matches')) return -1;
  const to = inv.slots.findIndex((s, i) => i < BELT && !s);
  if (to < 0) return -1;
  swap(from, to);
  toast(fmt(S.matchesBelt, { k: to + 1 }), 'info');
  return to;
}
on('new_game', () => { beltMatches(); });
