// 16×16 item icons of the interactive objects (DESIGN §15): the two weather-balloon parts. Same recipe as art/icons.ts (outlined ≤14×14 grid on a 16×16 canvas).
import { defSprite, outline, compose, PAL, type Rows, type Palette } from '../engine/sprites';
import { Grid } from './grid';

function ic(id: string, rows: Rows, pal: Palette = PAL) {
  const o = outline(rows), w = Math.max(...o.map(r => r.length));
  defSprite(id, pal, compose(16, 16, [[o, Math.floor((16 - w) / 2), Math.floor((16 - o.length) / 2)]]));
}
{
  const g = new Grid(10, 14);
  g.ell(5, 4.2, 4.6, 4.2, 'c'); g.rect(5, 0, 5, 9, 'c');
  g.ell(5, 4.2, 4.6, 4.2, 'c');
  for (let y = 0; y < 9; y++) for (let x = 5; x < 10; x++) if (g.get(x, y) === 'c') g.set(x, y, 'o');
  for (let y = 1; y < 6; y++) g.set(2, y, 'n');                                  // highlight
  g.set(4, 8, 'O'); g.set(5, 8, 'O'); g.set(4, 9, 'O'); g.set(5, 9, 'O');         // the neck
  g.line(5, 9, 5, 13, 'x');                                                      // string
  ic('sonde_balloon', g.rows(), { ...PAL, o: '#e0703c', c: '#f6efe0', O: '#a8481e' });
}
{
  const g = new Grid(10, 12);
  g.rect(1, 4, 8, 7, 'n'); g.rect(1, 4, 8, 1, 'N'); g.rect(1, 10, 8, 1, 'S'); g.rect(1, 4, 1, 7, 'N'); g.rect(8, 4, 1, 7, 'S');
  g.line(5, 3, 5, 0, 'S'); g.set(5, 0, 'r');                                     // aerial
  g.rect(2, 6, 3, 2, 'k'); g.set(3, 6, 'g'); g.rect(6, 6, 2, 1, 'b'); g.rect(6, 8, 2, 1, 'y');
  ic('sonde_probe', g.rows(), { ...PAL, r: '#d8362a' });
}
