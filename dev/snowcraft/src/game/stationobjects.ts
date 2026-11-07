// Placement of the interactive objects of DESIGN §15 (called once from worldgen.ts right after stampLocations()). It only reads the stamped world
// (LOC, worldInfo, the fixtures already in G.fixtures and the grid) and uses its own RNG (stationkit.lcg), never the grid's rand(): the random
// stream of the world and every existing world test stay as they were. Solid objects write MAT.FIXTURE cells like locations.addFixture().
//   house   : two ceiling lamps, an electric heater, a first-aid cabinet, kettle on the stove, a damper lever on the pipe, a gramophone on the table,
//             shutters on both windows (the cord hangs down to reach), a ladder to the roof on the west wall, a weather-balloon part in the shelf
//   shed    : the diesel generator in place of the second drum (with a real exhaust pipe through the roof), a lamp, a ladder, the balloon in the bench chest
//   outside : the weather-balloon pad, a bell on the west side; the displaced drum stands beside the others
//   mine    : the carts become pushable;  ship : the bell;  beach : frozen barrels;  tundra : the fox den with tracks and its cache
import { G, newId, type Fixture, type FixtureKind, type Slot } from './state';
import { W, H, TS, mat, aux, flags, F_FIXTURE } from '../engine/grid';
import { MAT, WALK } from '../content/materials';
import { LOC, box, bgT } from './locations';
import { lcg } from './stationkit';

function mk(kind: FixtureKind, tx: number, ty: number, tw: number, th: number, data?: Record<string, unknown>, o: { solid?: boolean; items?: Slot[]; fuel?: number } = {}): Fixture {
  const f: Fixture = { id: newId(), kind, tx, ty, tw, th };
  if (o.fuel !== undefined) { f.fuel = o.fuel; f.lit = false; }
  if (o.items) f.items = o.items;
  f.data = { ...(data ?? {}) };
  G.fixtures.push(f);
  if (o.solid) box(tx * TS, ty * TS, (tx + tw) * TS, (ty + th) * TS, MAT.FIXTURE, 0, F_FIXTURE);
  return f;
}
const surfaceY = (x: number, from: number) => { let y = from; while (y < H - 2 && !WALK[mat[y * W + x]]) y++; return y; };
/** Highest and lowest ground row under the columns [x0,x1) searching down from `from`. */
function groundSpan(x0: number, x1: number, from: number) {
  let lo = 1e9, hi = -1e9;
  for (let x = x0; x < x1; x++) { const y = surfaceY(x, from); lo = Math.min(lo, y); hi = Math.max(hi, y); }
  return { lo, hi };
}
/** Tile row for a th-tall footprint standing on the ground under tx..tx+tw: the bottom sits on the HIGHEST ground cell (floor to a tile), and the
 *  gaps under the lower columns are filled with the surface material of that column, so the object stands flush (dy stays 0). */
function onGround(tx: number, tw: number, th: number, from: number) {
  const g = groundSpan(tx * TS, (tx + tw) * TS, from);
  const bottom = Math.floor(g.lo / TS) * TS;
  for (let x = tx * TS; x < (tx + tw) * TS; x++) {
    const sy = surfaceY(x, from), m = mat[sy * W + x], a = aux[sy * W + x];
    for (let y = bottom; y < sy; y++) { const i = y * W + x; if (mat[i] === MAT.AIR) { mat[i] = m; aux[i] = a; flags[i] = 0; } }
  }
  return { ty: bottom / TS - th, dy: 0 };
}
const airBox = (x0: number, y0: number, x1: number, y1: number) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (mat[y * W + x] !== MAT.AIR) return false;
  return true;
};
function removeFixtureCells(f: Fixture) {
  for (let y = f.ty * TS; y < (f.ty + f.th) * TS; y++) for (let x = f.tx * TS; x < (f.tx + f.tw) * TS; x++) { const i = y * W + x; if (mat[i] === MAT.FIXTURE) { mat[i] = MAT.AIR; flags[i] = 0; } }
}

export function placeStationObjects() {
  const rnd = lcg(0x51a7e);
  const F = LOC.station.y / TS, { L, R } = LOC.house, SH = LOC.shed;
  const top = F - 8;                                                   // first interior row (60)
  // ---------------------------------------------------------------- house
  mk('ceiling_lamp', L + 6, top, 1, 2, {});
  mk('ceiling_lamp', L + 12, top, 1, 2, {});
  mk('heater', L + 1, F - 1, 2, 1, {});
  mk('medkit', L + 8, F - 6, 2, 2, { bandage: 4, spirit: 2 });
  mk('kettle', L + 15, F - 3, 1, 1, { water: 0, tea: 0, hot: 0 });
  mk('damper', L + 14, F - 4, 1, 1, { d: 1 });
  mk('gramophone', L + 9, F - 3, 2, 1, { rec: 1, dy: 2 });
  mk('shutter', L + 1, top - 1, 1, 8, { wx: L + 1, wy: top - 1, closed: false });
  mk('shutter', R - 1, top - 1, 1, 8, { wx: R - 1, wy: top - 1, closed: false });
  mk('hatch', L - 1, top, 1, 8, { roof: 'house' });
  const shelf = G.fixtures.find(f => f.kind === 'chest' && f.tx === L + 7 && f.ty === F - 2);
  if (shelf?.items) shelf.items.push({ id: 'sonde_probe', n: 1 });
  // ---------------------------------------------------------------- shed: the generator takes the second drum's place
  const drum = G.fixtures.find(f => f.kind === 'drum' && f.tx === SH.L + 5 && f.ty === F - 2);
  if (drum) { G.fixtures.splice(G.fixtures.indexOf(drum), 1); removeFixtureCells(drum); }
  const gx = SH.L + 5;                                                 // 201..203
  const gen = mk('generator', gx, F - 2, 3, 2, { warm: 0 }, { solid: true, fuel: 240 });
  // exhaust: a dark strip behind the player up to the ceiling and a solid metal pipe through the roof (like the stove's), ending above the snow
  const px = (gx + 2) * TS + 1;
  bgT(gx + 2, top, gx + 2, F - 3, 7);
  let y = 60; while (y < 240 && mat[y * W + px] === MAT.AIR && mat[y * W + px + 1] === MAT.AIR) y++;
  const pipeTop = y - 6;
  box(px, pipeTop, px + 2, top * TS, MAT.METAL);
  gen.data!.exX = px; gen.data!.exY = pipeTop;
  mk('ceiling_lamp', SH.L + 3, top, 1, 2, {});
  mk('hatch', SH.L - 1, top, 1, 8, { roof: 'shed' });
  const bench = G.fixtures.find(f => f.kind === 'chest' && f.tx === SH.L + 8 && f.ty === F - 2);
  if (bench?.items) bench.items.push({ id: 'sonde_balloon', n: 1 });
  // ---------------------------------------------------------------- outside the station
  { const tx = SH.L - 4, g = onGround(tx, 2, 4, 240); mk('sonde', tx, g.ty, 2, 4, { st: 0, dy: g.dy }); }
  { const tx = L - 4, g = onGround(tx, 1, 2, 230); mk('bell', tx, g.ty, 1, 2, { dy: g.dy, name: 'station' }); }
  { const tx = SH.R + 9, g = onGround(tx, 2, 2, 240); mk('drum', tx, g.ty, 2, 2, { fuel: 'diesel', n: 8, dy: g.dy }, { solid: true }); }
  // ---------------------------------------------------------------- mine: carts roll
  for (const f of G.fixtures) if (f.kind === 'cart') { f.data = { ...(f.data ?? {}), pushable: true, v: 0, ox: 0 }; }
  // ---------------------------------------------------------------- ship's bell on the stern deck
  { const tx = (LOC.ship.x - 12) >> 2, g = onGround(tx, 1, 2, 240); mk('bell', tx, g.ty, 1, 2, { dy: g.dy, name: 'ship' }); }
  // ---------------------------------------------------------------- frozen barrels on the beach (ordinary frozen containers: chip free with the chisel)
  const barrels: Slot[][] = [[{ id: 'diesel', n: 2 }, { id: 'rope', n: 1 }], [{ id: 'rope', n: 2 }, { id: 'tin', n: 1 }, { id: 'matches', n: 2 }], [{ id: 'diesel', n: 1 }, { id: 'fat', n: 1 }, { id: 'rope', n: 1 }]];
  let placed = 0;
  for (let k = 0; k < 80 && placed < barrels.length; k++) {
    const tx = Math.floor((LOC.beach.x0 + 30 + rnd() * 140) / TS);
    if (G.fixtures.some(f => Math.abs(f.tx - tx) < 12 && f.kind === 'chest' && f.data?.look === 'barrel')) continue;
    const gs = groundSpan(tx * TS, (tx + 2) * TS, 200);
    if (gs.hi - gs.lo > 7 || gs.lo > 285) continue;                    // gravel above the tide crack, not on a steep face
    const top0 = Math.floor(gs.lo / TS) - 2;
    if (!airBox(tx * TS, top0 * TS, (tx + 2) * TS, (top0 + 2) * TS)) continue;
    const g = onGround(tx, 2, 2, 200);
    if (G.drops.some(d => Math.abs(d.x - (tx + 1) * TS) < 14)) continue;
    const items = barrels[placed].map(s => ({ ...s, n: Math.max(1, Math.round(s.n * G.diff.loot)) }));
    mk('chest', tx, g.ty, 2, 2, { look: 'barrel', frozen: true, dy: g.dy }, { solid: true, items });
    placed++;
  }
  // ---------------------------------------------------------------- the fox den: next to the fox's home (x 888), cache inside, tracks drawn around it
  { const tx = 224, gs = groundSpan(tx * TS, (tx + 2) * TS, 230), top0 = Math.floor(gs.lo / TS) - 2;
    if (airBox(tx * TS, top0 * TS, (tx + 2) * TS, (top0 + 2) * TS)) {
      const g = onGround(tx, 2, 2, 230);
      const items: Slot[] = [{ id: 'ptarmigan', n: 2 }, { id: 'fat', n: 2 }, { id: 'matches', n: 3 }, { id: 'fox_fur', n: 1 }, { id: 'tin', n: 1 }];
      mk('chest', tx, g.ty, 2, 2, { look: 'den', dy: g.dy }, { solid: true, items });
      }
  }
}
