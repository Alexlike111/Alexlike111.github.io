// 16×16 icons of the group 2 usable items (DESIGN §17: «Ориентиры и безопасность», «Свет и сигналы»). Same recipe as icons_use.ts:
// a ≤14×14 text grid (PAL chars from engine/sprites.ts) painted with the Grid helper, plus the automatic dark outline.
import { defSprite, outline, compose, PAL, type Rows, type Palette } from '../engine/sprites';
import { Grid } from './grid';

function ic(id: string, rows: Rows, pal: Palette = PAL) {
  const o = outline(rows), w = Math.max(...o.map(r => r.length));
  defSprite(id, pal, compose(16, 16, [[o, Math.floor((16 - w) / 2), Math.floor((16 - o.length) / 2)]]));
}
const grid = (fn: (g: Grid) => void, w = 14, h = 14): Rows => { const g = new Grid(w, h); fn(g); return g.rows(); };

ic('compass', grid(g => {
  g.disc(7, 7, 6.2, 'z'); g.disc(7, 7, 5, 'n'); g.disc(7, 7, 4.2, 'i');
  g.line(7, 7, 7, 2, 'r', 2); g.line(7, 7, 7, 12, 'S', 2);       // a red north needle, a pale south one
  g.set(7, 2, 'R'); g.set(7, 7, 'K');
}));

ic('binoculars', grid(g => {
  g.rect(2, 1, 4, 5, 'z'); g.rect(8, 1, 4, 5, 'z'); g.rect(3, 2, 2, 3, 'l'); g.rect(9, 2, 2, 3, 'l');
  g.rect(5, 2, 4, 2, 'z');
  g.disc(4, 10, 3, 'z'); g.disc(10, 10, 3, 'z'); g.disc(4, 10, 2, 'b'); g.disc(10, 10, 2, 'b');
  g.set(3, 9, 'i'); g.set(9, 9, 'i');
}));

ic('probe_pole', grid(g => {
  g.line(1, 12, 11, 2, 'W', 1); g.line(2, 12, 12, 2, 'w', 1);
  g.line(0, 13, 2, 11, 'S', 1);                              // the steel tip in the ice
  g.disc(10, 4, 1.4, 'C'); g.set(10, 4, 'x');                // a rope loop near the top
  g.set(12, 1, 'i'); g.set(11, 0, 'i');                      // a chip of ice on the top
}));

ic('ice_cleats', grid(g => {
  g.rect(1, 2, 12, 3, 'L'); g.rect(2, 2, 10, 1, 'z');        // rubber strap and sole
  for (const x of [2, 5, 8, 11]) g.line(x, 5, x, 9, 'S', 1); // spikes down
  for (const x of [2, 5, 8, 11]) g.set(x, 9, 'n');            // the bright tips
}));

ic('smoke_flare', grid(g => {
  g.rect(4, 8, 8, 4, 'r'); g.rect(4, 8, 8, 1, 'o'); g.rect(3, 8, 1, 4, 'R'); g.rect(4, 11, 8, 1, 'R');
  g.ell(6, 4, 2.2, 1.6, 'S'); g.ell(9, 3, 2.2, 2, 's'); g.ell(4, 2, 1.6, 1.3, 'n'); g.ell(11, 5, 1.5, 1.2, 'S');
  g.set(9, 9, 'y');
}));

ic('whistle', grid(g => {
  g.rect(3, 6, 7, 4, 'y'); g.rect(3, 9, 7, 1, 'Y'); g.rect(1, 7, 2, 2, 'y');
  g.set(6, 7, 'K'); g.set(7, 7, 'K');
  g.ell(11, 5, 2.4, 2.4, 'S'); g.ell(11, 5, 1.2, 1.2, '.');
}));
