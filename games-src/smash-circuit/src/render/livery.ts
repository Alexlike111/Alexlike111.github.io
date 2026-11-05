// Livery helpers for the procedural cars: race-number roundels drawn as 7-segment digits (a handful of thin boxes merged into the
// body / panel geometry, so they cost no draw call). Car-local axes: +x nose, +y up, +z left. Digits are upright for a viewer who
// looks along the car (the top of a digit points to the nose, the digit reads left to right over the car's right side).
import { GeoBuilder } from './geo';

/** segments of a 7-segment digit: a top, b top right, c bottom right, d bottom, e bottom left, f top left, g middle */
const GLYPHS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg', '5': 'acdfg', '6': 'acdefg', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg',
};

export interface PlateOpts {
  /** disc colour (default white) and digit colour (default near-black) */
  bg?: number;
  fg?: number;
  /** outline colour of the disc (default dark) */
  rim?: number;
  /** tint the disc with the car paint (aPaint) instead of a fixed colour */
  paint?: boolean;
}

/** Radius of the roundel that `numberPlate` builds for `num` at scale `s` (for fitting it on a roof). */
export function plateRadius(num: number, s = 1): number {
  const n = String(num).length;
  const h = 0.5 * s, w = 0.3 * s, W = n * w + (n - 1) * 0.07 * s;
  return Math.hypot(h / 2, W / 2) + 0.07 * s;
}

/**
 * A flat race-number roundel lying at height `y` (its underside) centred on car-local (x, z): rim ring, disc, then the digits.
 * `s` scales everything (1 = digits 0.5 m tall).
 */
export function numberPlate(b: GeoBuilder, num: number, x: number, y: number, z: number, s = 1, o: PlateOpts = {}): void {
  const bg = o.bg ?? 0xffffff, fg = o.fg ?? 0x16181e, rim = o.rim ?? 0x16181e;
  const str = String(num);
  const n = str.length;
  const h = 0.5 * s, w = 0.3 * s, t = 0.085 * s, gap = 0.07 * s;
  const W = n * w + (n - 1) * gap;
  const R = plateRadius(num, s);
  b.cyl(R + 0.05 * s, R + 0.05 * s, 0.03, 14, { pos: [x, y + 0.015, z], color: rim, noBottom: true });
  b.cyl(R, R, 0.02, 14, { pos: [x, y + 0.04, z], color: bg, paint: o.paint ? 1 : 0, noBottom: true });
  const top = y + 0.058;
  for (let i = 0; i < n; i++) {
    const seg = GLYPHS[str[i]] ?? '';
    const u0 = -W / 2 + w / 2 + i * (w + gap);   // digit centre, to the right of the car's axis (right = -z)
    // segment boxes in digit space (u right, v up) -> car space (x = x0 + v, z = z0 - u)
    const put = (c: string, u: number, v: number, horiz: boolean): void => {
      if (!seg.includes(c)) return;
      const len = horiz ? w : (h - t) / 2 + t * 0.5;
      b.box(horiz ? t : len, 0.016, horiz ? len : t, { pos: [x + v, top, z - (u0 + u)], color: fg, noBottom: true });
    };
    put('a', 0, h / 2 - t / 2, true);
    put('g', 0, 0, true);
    put('d', 0, -h / 2 + t / 2, true);
    put('f', -w / 2 + t / 2, h / 4, false);
    put('e', -w / 2 + t / 2, -h / 4, false);
    put('b', w / 2 - t / 2, h / 4, false);
    put('c', w / 2 - t / 2, -h / 4, false);
  }
}
