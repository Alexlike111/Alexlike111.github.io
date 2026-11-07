// A wind-packed drift next to the spawn, so the very first knife cut works: the lee of the station holds a slab of packed snow with a density
// of ~250-340 kg/m3 (the ideal block class) while the rest of the snowpack nearby is loose (< 220, crumbles when cut).
import { W, mat, aux, flags, shade, edited } from '../engine/grid';
import { MAT } from '../content/materials';

export function seedStarterDrift(spawnX: number) {
  const xa = spawnX + 34, xb = spawnX + 70;
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
}
