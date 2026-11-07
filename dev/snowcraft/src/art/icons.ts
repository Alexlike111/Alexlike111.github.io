// 16×16 item icons (one per item id in DESIGN §8) and UI icons. Authored as ≤14×14 text grids (PAL chars from sprites.ts) that get an automatic
// dark outline, or built with the Grid painter for diagonal tools. Keys: item id → icon(id); UI icons → 'ui.<key>' (uiIcon()).
import { defSprite, outline, compose, PAL, spriteCanvas, tintMultiply, newCanvas, hasSprite, type Rows, type Palette } from '../engine/sprites';
import { Grid } from './grid';

export const ICON_IDS: string[] = [];
function ic(id: string, rows: Rows, pal: Palette = PAL) {
  const o = outline(rows);
  const w = Math.max(...o.map(r => r.length));
  defSprite(id, pal, compose(16, 16, [[o, Math.floor((16 - w) / 2), Math.floor((16 - o.length) / 2)]]));
  ICON_IDS.push(id);
}
const grid = (fn: (g: Grid) => void, w = 14, h = 14): Rows => { const g = new Grid(w, h); fn(g); return g.rows(); };
/** Diagonal tool helper: handle from (hx0,hy0) toward (hx1,hy1). */
const handle = (g: Grid, x0: number, y0: number, x1: number, y1: number) => { g.line(x0, y0, x1, y1, 'W'); g.line(x0 + 1, y0, x1 + 1, y1, 'w'); };

// ---------------------------------------------------------------------------------------------------------------------------------- materials
ic('snow_block', [
  'nnnnnnnnnnnnnn',
  'niiiiiiiiiiiiN',
  'niiiiIiiiiiiiN',
  'niiiiiiiiiIiiN',
  'niIiiiiiiiiiiN',
  'niiiiiiiiiiiIN',
  'niiiIiiiiiiiiN',
  'niiiiiiiiiiIiN',
  'NIIIIIIIIIIIIN',
  'NNNNNNNNNNNNNN',
]);
ic('snow', [
  '......nn......',
  '....nnnnnn....',
  '...nnnnnnnn...',
  '..nnnNnnnnnn..',
  '.nnnnnnnNnnnn.',
  'nnNnnnnnnnnnNn',
  'iiiiiiiiiiiiii',
  'NNNNNNNNNNNNNN',
]);
ic('ice', [
  '.....iI.......',
  '....iibI.b....',
  '...iibbbIbbI..',
  '..iibbBbbbbbI.',
  '.iibbbbbBbbbBI',
  '.ibbbbbBBbbBBI',
  '..IbbbBBBBBBI.',
  '...IIBBBBBII..',
]);
ic('log', [
  '..UUUUUUUUUCCC',
  '.UuuxuuuuuCccC',
  'UuxuuUuuuuCcCc',
  'UuuuuuuxuuCccC',
  '.UuuuUuuuuUCCC',
  '..UUUUUUUUU...',
]);
ic('plank', [
  'tttttttttttttt',
  'tcwwwwwwwwwwcW',
  'wzwwhwwwwhwwzW',
  'WWWWWWWWWWWWWW',
  '.tttttttttttttt',
  '.tcwwwwwwwwwcWW',
  '.wzwhwwwwhwwzWW',
  '.WWWWWWWWWWWWWW',
]);
ic('bone', grid(g => {
  g.line(2, 11, 11, 2, 'C', 3); g.line(3, 11, 12, 2, 'c', 1); g.line(4, 12, 12, 4, 'c', 1);
  g.disc(2, 10, 2.2, 'c'); g.disc(4, 12, 2.2, 'c'); g.disc(10, 1.5, 2.2, 'c'); g.disc(12, 3.5, 2.2, 'c');
  g.set(2, 10, 'C'); g.set(4, 12, 'C'); g.set(10, 1, 'C'); g.set(12, 3, 'C');
}));
ic('stone', [
  '....hhhhhh....',
  '..hhHHHHHHhh..',
  '.hHHHHHHHHHhh.',
  'hHHHHSHHHHHHhh',
  'hHHHHHHHHSHHhh',
  'hhHHHHHHHHHhll',
  '.hhhhhhhhhhll.',
  '..llllllllll..',
]);
ic('soapstone', [
  '....SSSSSS....',
  '..SSgggggSSS..',
  '.SggggGggggSS.',
  'SgggSSSgggGggS',
  'SggGgSSSgggggS',
  'SSgggggggGggzz',
  '.SSzzzzzzzzzz.',
  '..zzzzzzzzzz..',
].map(r => r.replace(/S/g, 'H')));
ic('coal', [
  '...kkkkk......',
  '..kllllkkk....',
  '.kllHllllkkk..',
  'kllllllllllkk.',
  'klllllHlllllk.',
  'kkllllllllllkk',
  '.kkkllllllkkk.',
  '...kkkkkkkk...',
]);
ic('lichen', [
  '..g...G...g...',
  '.gGg.gGg.gGg..',
  '..gGgGGgGgg...',
  '.ggGGgGGGgGg..',
  'gGgGgGGgGgGgg.',
  'GGgGGgGGGgGGg.',
  '.GGGjGGGjGGG..',
  '..jjjjjjjjj...',
].map(r => r.replace(/g/g, 'x').replace(/G/g, 'g')));
ic('canvas', [
  '..cccccccccc..',
  '.cCCCCCCCCCCc.',
  'cCcccccccccCCc',
  'cCcCCCCCCCCcCc',
  'cCcCccccccCcCc',
  'cCcCCCCCCCCcCc',
  'cCcccccccccCCc',
  '.cCCCCCCCCCCc.',
  '..cccccccccc..',
]);
ic('rope', grid(g => {
  g.ell(7, 7, 6, 5, 't'); g.ell(7, 7, 3.2, 2.6, '.');
  for (let a = 0; a < 16; a++) { const an = a / 16 * Math.PI * 2; g.set(7 + Math.cos(an) * 5, 7 + Math.sin(an) * 4, a % 2 ? 'W' : 'w'); }
  g.set(7, 3, 'T'); g.set(7, 11, 'T');
}));
ic('sinew', [
  '..c.c.c.c.c...',
  '.cCcCcCcCcCc..',
  'cCcCcCcCcCcCc.',
  'CcCcCcCcCcCcC.',
  '.cCcCcCcCcCc..',
  '..c.c.c.c.c...',
].map(r => r.replace(/c/g, 'x').replace(/C/g, 'c')));
ic('fat', [
  '..cccccccccc..',
  '.cnnnnnnnnnnc.',
  'cnnyyyyyyyynnc',
  'cnyyyyyyyyyync',
  'cnnyyyyyyyynnc',
  '.cYYYYYYYYYYc.',
  '..YYYYYYYYYY..',
]);
ic('sealskin', [
  '.hh........hh.',
  'hSuuhhhhhhuuSh',
  'huuuuuuuuuuuuh',
  'hUuKuuuuuKuuUh',
  'huuuuuKuuuuuuh',
  'hUuuuuuuuKuuUh',
  '.huuKuuuuuuuh.',
  '..huuuuuuuuh..',
  '...hhh..hhh...',
]);
ic('fox_fur', [
  '..........o...',
  '........ooOo..',
  '.......ooooOo.',
  '.....oooooOOo.',
  '...oooooooOO..',
  '..ooooooOOO...',
  '.ooooooOOO....',
  'noooOOOO......',
  'nnnOO.........',
  '.nn...........',
]);
ic('bear_fur', [
  '.UU.......UU..',
  'UuuUUUUUUUuuU.',
  'UuxuuuuuuuxuU.',
  '.UuuuxuuuxuuU.',
  '.UuxuuuuuuuuU.',
  'UuuuuuxuuxuuuU',
  'UuxuuuuuuuuxuU',
  '.UuuuxuuuUuuU.',
  '.UU.UU..UU.UU.',
  '.U...U..U...U.',
]);
ic('scrap', grid(g => {
  g.rect(1, 8, 6, 4, 'S'); g.rect(1, 8, 6, 1, 's'); g.set(2, 10, 'K'); g.set(5, 10, 'K');
  g.disc(10, 4, 3, 'z'); g.disc(10, 4, 1.2, '.'); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g.set(10 + Math.cos(a) * 3.6, 4 + Math.sin(a) * 3.6, 'z'); }
  g.line(7, 12, 13, 9, 'h', 2); g.set(13, 9, 'H');
}));
ic('tin', [
  '.sssssssssss..',
  'sSSSSSSSSSSSs.',
  'sSsssssssssSs.',
  'sSssSSSSSssSs.',
  'sSssSSSSSssSs.',
  'sSsssssssssSs.',
  'sSSSSSSSSSSSs.',
  '.zzzzzzzzzzz..',
]);
ic('matches', [
  '....r.r.r.....',
  '...rRrRrRr....',
  '...W.W.W.W....',
  '.rrrrrrrrrrr..',
  '.rRRRRRRRRRr..',
  '.rRyyyRyyyRr..',
  '.rRRRRRRRRRr..',
  '.RRRRRRRRRRR..',
]);
ic('flint', grid(g => {
  g.ell(9, 9, 4, 3, 'H'); g.ell(8, 8, 2.5, 1.6, 'S'); g.set(7, 7, 's');
  g.line(1, 3, 3, 3, 'z', 1); g.line(3, 3, 3, 8, 'z', 1); g.line(3, 8, 6, 10, 'z', 1);
  g.line(1, 4, 2, 4, 'S'); g.rect(0, 2, 5, 1, 'z');
  g.set(11, 4, 'E'); g.set(12, 3, 'e'); g.set(10, 3, 'E'); g.set(12, 5, 'e');
}));
ic('flare', grid(g => {
  g.rect(5, 2, 5, 10, 'r'); g.rect(5, 2, 1, 10, 'o'); g.rect(9, 2, 1, 10, 'R'); g.rect(5, 6, 5, 2, 'y'); g.rect(4, 11, 7, 2, 'z');
  g.rect(6, 0, 3, 2, 'S'); g.set(7, 1, 'e');
}));
ic('diesel', [
  '..zzzz........',
  '..zSSz..zz....',
  'jjjjjjjjjjjj..',
  'jGGGGGGGGGGj..',
  'jGgggggggggj..',
  'jGgGGGGGGggj..',
  'jGgGyyyyGggj..',
  'jGgGGGGGGggj..',
  'jGgggggggggj..',
  'jjjjjjjjjjjj..',
]);
ic('radio_triode', [
  '....SSSS......',
  '...SnIIbS.....',
  '..SnIbbbbS....',
  '..SIbbEEbS....',
  '..SIbEEEbS....',
  '..SIbbEEbS....',
  '...SBbbbBS....',
  '....SSSSS.....',
  '...yyyyyyy....',
  '...yYYYYYy....',
  '...h.h.h.h....',
  '...h.h.h.h....',
]);
ic('radio_coil', [
  '..............',
  '.TTTTTTTTTTTT.',
  'TOoOoOoOoOoOoT',
  'TooOoOoOoOoOoT',
  'TOoOoOoOoOoOoT',
  'TooOoOoOoOoOoT',
  '.TTTTTTTTTTTT.',
  'y..........y..',
  'Y..........Y..',
]);
ic('battery', [
  '..zz....zz....',
  '.zrrz..zhhz...',
  'zzzzzzzzzzzz..',
  'zLLLLLLLLLLz..',
  'zLLLyyyLLLLz..',
  'zLLLLyyLLLLz..',
  'zLLLyyLLLLLz..',
  'zLLLLLLLLLLz..',
  'zzzzzzzzzzzz..',
]);
ic('note', [
  '..ttttttttt...',
  '.tcccccccccT..',
  '.tcKKKKKKKcT..',
  '.tcccccccccT..',
  '.tcKKKKKKccT.',
  '.tcccccccccT..',
  '.tcKKKKKcccT..',
  '.tcccccccrrT..',
  '.tcKKKKccrrT..',
  '..TTTTTTTTT...',
]);
ic('pot', [
  '...zzzzzzzz...',
  '..z........z..',
  '.z..........z.',
  'zzzzzzzzzzzzzz',
  'zllllllllllllz',
  'zlhllllllllllz',
  'zlhllllllllllz',
  'zllllllllllllz',
  '.zllllllllllz.',
  '..zzzzzzzzzz..',
]);
ic('flask', [
  '....zzzz......',
  '....zSSz......',
  '...zzzzzz.....',
  '..zjjjjjjz....',
  '.zjGGGGGGjz...',
  '.zjGgggGGjz...',
  '.zjGgGGGGjz...',
  '.zjGgGyyGjz...',
  '.zjGgGGGGjz...',
  '..zjjjjjjz....',
]);
ic('water', [
  '......bb......',
  '.....bbbb.....',
  '....bbbbbb....',
  '...bbiibbbb...',
  '..bbbibbbbbB..',
  '..bbbbbbbbbB..',
  '..bbbbbbbbBB..',
  '...bbbbbbBB...',
  '....BBBBBB....',
]);
ic('hot_tea', [
  '...N..N..N....',
  '..N..N..N.....',
  '.N..N..N......',
  'zzzzzzzzzzz...',
  'zOOOOOOOOOzzz.',
  'zOooooooooOzSz',
  'zOooooooooOzSz',
  'zOOOOOOOOOOzzz',
  '.zOOOOOOOOz...',
  '..zzzzzzzz....',
]);
ic('tea', [
  '..zzzzzzzz....',
  '.zyyyyyyyyz...',
  '.zGGGGGGGGz...',
  '.zGnnnnnnGz...',
  '.zGnggggnGz...',
  '.zGnnnnnnGz...',
  '.zGGGGGGGGz...',
  '.zjjjjjjjjz...',
  '..zzzzzzzz....',
]);
// ---------------------------------------------------------------------------------------------------------------------------------- food
ic('seal_meat', [
  '..MMMMMMMMM...',
  '.MmmmmmmmmmM..',
  'MmmpmmmmmpmmM.',
  'MmmmmmmmmmmmM.',
  'MnnnnnnnnnnmM.',
  'MnccnnnnncnmM.',
  'MmmmmmmmmmmmM.',
  '.MmmpmmmpmmM..',
  '..MMMMMMMMM...',
]);
ic('fish', [
  '.........ss...',
  '..zzzzzz..ss..',
  '.zSSSSSSzz.ss.',
  'zSsssSSSSSzzs.',
  'zSkSsSSSSSSz..',
  'zSSsSSSSSSzzs.',
  '.zNNNNNNzz.ss.',
  '..zzzzzz..ss..',
].map(r => r.replace(/k/g, 'K').replace(/S/g, 'A').replace(/s/g, 'a').replace(/N/g, 'c')));
ic('ptarmigan', [
  '.....nnn.......',
  '....nnnnn......',
  '....nKnnnr.....',
  '....nnnnnoo....',
  '...nnnnnn......',
  '.nnnnnnnnn.....',
  'nnNnnnnnnn.....',
  'nNNnnnnnnn.....',
  '.NNNnnnnN......',
  '..NNNNNN.......',
  '...o..o........',
]);
ic('cooked_meat', [
  '..TTTTTTTTT...',
  '.TWWWWWWWWWT..',
  'TWoWWWWWWoWWT.',
  'TWWWWWWWWWWWT.',
  'TWoWWKKWWWoWT.',
  'TWWWKWWKWWWWT.',
  'TWWWWWWWWWWWT.',
  '.TWWoWWWWoWT..',
  '..TTTTTTTTT...',
]);
ic('fish_cooked', [
  '.........oo...',
  '..TTTTTT..oo..',
  '.TOOOOOOTT.oo.',
  'TOoOOOOOOOTTo.',
  'TOKOKOKOKOOT..',
  'TOOoOOOOOOTTo.',
  '.TyyyyyyTT.oo.',
  '..TTTTTT..oo..',
]);
ic('can', [
  '.zzzzzzzzzz...',
  'zSsssssssSSz..',
  'zzzzzzzzzzzz..',
  'zrrrrrrrrrrz..',
  'zrRRRRRRRRrz..',
  'zrRyyyyyyRrz..',
  'zrRRRRRRRRrz..',
  'zrrrrrrrrrrz..',
  'zzzzzzzzzzzz..',
  '.zSSSSSSSSz...',
]);
ic('biscuit', [
  '.wwwwwwwwwwww.',
  'wttttttttttttW',
  'wtKtttKtttKttW',
  'wttttttttttttW',
  'wtKtttKtttKttW',
  'wttttttttttttW',
  'wtKtttKtttKttW',
  'WWWWWWWWWWWWWW',
]);
// ---------------------------------------------------------------------------------------------------------------------------------- tools
ic('snow_knife', grid(g => {
  handle(g, 1, 12, 5, 8);
  g.line(5, 9, 12, 2, 'S', 3); g.line(6, 8, 13, 1, 's', 1); g.line(5, 10, 12, 3, 'z', 1);
  g.set(5, 8, 'z'); g.set(4, 9, 'z'); g.set(6, 7, 'z');
}));
ic('shovel', grid(g => {
  handle(g, 1, 13, 8, 6);
  g.line(0, 12, 2, 14, 'd'); g.line(9, 5, 11, 3, 'z');
  g.rect(9, 0, 5, 1, 'z'); g.rect(8, 1, 1, 1, 'z');
  for (let i = 0; i < 5; i++) g.line(9 + i, 5 - i, 9 + i + 0, 5 - i, 'S');
  g.disc(11, 3, 3.3, 'S'); g.disc(10.5, 2.5, 1.7, 's'); g.set(8, 5, 'z');
}));
ic('ice_chisel', grid(g => {
  g.line(1, 13, 10, 4, 'W', 1); g.line(2, 13, 11, 4, 'w', 1);
  g.line(10, 5, 13, 0, 'S', 2); g.line(11, 3, 12, 1, 's'); g.set(9, 6, 'z'); g.set(10, 6, 'z'); g.set(9, 5, 'z');
  g.rect(0, 12, 3, 2, 'z');
}));
ic('axe', grid(g => {
  handle(g, 1, 13, 10, 4);
  g.rect(8, 0, 4, 1, 'z');
  g.line(8, 4, 12, 0, 'S', 3); g.line(7, 6, 13, 3, 'S', 2); g.line(11, 5, 13, 2, 's'); g.line(12, 0, 13, 3, 's'); g.set(7, 6, 'z'); g.set(9, 3, 'z'); g.set(8, 4, 'z');
}));
ic('pick', grid(g => {
  handle(g, 1, 13, 9, 5);
  g.line(5, 2, 12, 5, 'S', 2); g.line(4, 3, 5, 2, 'S'); g.line(12, 5, 13, 8, 'S'); g.line(5, 1, 11, 3, 's'); g.line(4, 3, 4, 4, 'z'); g.line(13, 7, 13, 8, 'z'); g.set(8, 4, 'z'); g.set(9, 4, 'z');
}));
ic('saw', grid(g => {
  g.rect(0, 9, 4, 4, 'W'); g.rect(0, 9, 4, 1, 'w'); g.set(1, 11, 'T');
  g.line(4, 9, 13, 2, 'S', 3); g.line(4, 8, 12, 1, 's'); g.line(5, 11, 13, 4, 'z', 1);
  for (let i = 0; i < 4; i++) g.set(6 + i * 2, 11 - i * 2 + 1, 'z');
}));
ic('harpoon', grid(g => {
  g.line(0, 13, 10, 3, 'W', 1); g.line(1, 13, 11, 3, 'w', 1);
  g.line(10, 4, 13, 0, 'S', 2); g.set(8, 3, 'S'); g.set(9, 2, 'S'); g.set(12, 4, 'S'); g.set(13, 5, 'S'); g.set(10, 5, 'z'); g.set(11, 4, 'z');
  g.line(2, 12, 4, 13, 't'); g.line(4, 13, 6, 12, 't');
}));
ic('fishing_line', grid(g => {
  g.line(1, 13, 11, 2, 'W', 1); g.line(2, 13, 12, 2, 'w', 1); g.rect(3, 9, 2, 2, 'z');
  g.line(12, 2, 12, 9, 'n'); g.set(12, 10, 'S'); g.set(11, 11, 'S'); g.set(11, 12, 'S'); g.set(12, 12, 'S');
}));
ic('torch', grid(g => {
  g.line(1, 13, 8, 6, 'W', 1); g.line(2, 13, 9, 6, 'w', 1); g.line(7, 7, 10, 4, 'U', 2);
  g.disc(11, 3, 2.2, 'e'); g.disc(11, 2.5, 1.3, 'E'); g.set(12, 0, 'e'); g.set(11, 1, 'e'); g.set(13, 2, 'o');
}));
ic('lantern', [
  '....zzzz......',
  '...z....z.....',
  '..zzzzzzzz....',
  '..zSSSSSSz....',
  '..zyEEEEyz....',
  '..zyEeeEyz....',
  '..zyEeeEyz....',
  '..zyEEEEyz....',
  '..zSSSSSSz....',
  '..zzzzzzzz....',
]);
ic('flare_gun', [
  '..oooooooo....',
  '.oOOOOOOOoo...',
  '.oOOooooooo...',
  '.oOOO.........',
  '..oOOO........',
  '...oOO........',
  '...oOO........',
  '...RRR........',
]);
ic('barometer', grid(g => {
  g.disc(7, 7, 6, 'y'); g.disc(7, 7, 4.6, 'n'); g.disc(7, 7, 6, 'y');
  g.disc(7, 7, 4.6, 'n'); g.line(7, 7, 10, 4, 'r'); g.set(7, 7, 'K'); g.set(7, 2, 'K'); g.set(7, 12, 'K'); g.set(2, 7, 'K'); g.set(12, 7, 'K');
  g.set(3, 3, 'k'); g.set(11, 3, 'k'); g.set(3, 11, 'k'); g.set(11, 11, 'k');
}));
// ---------------------------------------------------------------------------------------------------------------------------------- wear
ic('wool_mittens', [
  '.SSS..SSS.....',
  'SsssS.SsssS...',
  'SsssS.SsssS...',
  'SsssSSSsssS...',
  'SssssSssssS...',
  '.SssssSssS....',
  '.zzzzzzzzz....',
  '.zhhzzzhhz....',
  '.zzzzzzzzz....',
]);
ic('fur_mittens', [
  '.cCc..cCc.....',
  'cCcxCccCcxC...',
  'cxxxCccxxxC...',
  'cxxxxCxxxxC...',
  'CxxxxxxxxxC...',
  '.CxxxxxxxC....',
  '.uuuuuuuuu....',
  '.uUuUuuUuUu...',
  '.UUUUUUUUUU...',
]);
ic('felt_boots', [
  '...uuuuu......',
  '...uxxxu......',
  '...uxxxu......',
  '...uxxxu......',
  '...uuuuu......',
  '...uuuuu......',
  '...uuuuuuuu...',
  '..uuuuuuuuuu..',
  '..UUUUUUUUUU..',
].map(r => r.replace(/u/g, 'x').replace(/x(?=x)/g, 'x')));
ic('kamiks', [
  '...nnnnn......',
  '...nnnnn......',
  '...kkkkk......',
  '...kllkk......',
  '...kllkk......',
  '...kllkk......',
  '...kllkkkk....',
  '..kllllllkk...',
  '..cccccccccc..',
]);
ic('wool_hat', [
  '......nn......',
  '.....nnnn.....',
  '...AAAAAAAA...',
  '..AAaAAaAAAA..',
  '.AAAaAAaAAAAA.',
  '.AAAaAAaAAAAA.',
  '.NNNNNNNNNNNN.',
  '.nNnNnNnNnNnN.',
  '.NNNNNNNNNNNN.',
]);
ic('fur_hood', [
  '...UUUUUU.....',
  '..UuuuuuuU....',
  '.UuuuuuuuuU...',
  'UuuccccccuuU..',
  'UucCCCCCCcuU..',
  'UucCkkkkCcuU..',
  'UucCCkkCCcuU..',
  'UuccCkkCccuU..',
  '.UucccCcccU...',
  '..UUUUUUUU....',
]);
ic('station_parka', [
  '..cccrrccc....',
  '.ccCrrrrCcc...',
  'rrrCrrrrCrrr..',
  'rrRrrzrrrRrr..',
  'rrRrrzrrrRrr..',
  'rrRrrzrrrRrr..',
  'rrRoooooooRr..'.replace('rrRoooooooRr..', 'rrRooozooRrr..'),
  'rrRrrzrrrRrr..',
  'RRRrrzrrrRRR..',
  '.RRRRRRRRRR...',
]);
ic('fur_parka', [
  '..cccuuccc....',
  '.ccCuuuuCcc...',
  'uuuCuuuuCuuu..',
  'uuUuxuuxuUuu..',
  'uuUuuxuuuUuu..',
  'uuUxuuuxuUuu..',
  'uuUuuxuuuUuu..',
  'uuUuxuuxuUuu..',
  'UUUuuuuuuUUU..',
  'ccccccccccc...',
]);
// ---------------------------------------------------------------------------------------------------------------------------------- fixtures as kits
ic('campfire', [
  '.....e........',
  '....eeE.e.....',
  '...eeEEee.....',
  '..eeEyyEee....',
  '..eEEyyEEe....',
  '.WWeeEEeeWW...',
  'WwWWWeeWWWwW..',
  'dWwwWWWWwwWd..',
  '.ddWwwwwWdd...',
]);
ic('fat_lamp', [
  '......e.......',
  '.....eEe......',
  '.....eEe......',
  '......y.......',
  '.hhhhhhhhhhh..',
  'hHHHHHHHHHHHh.',
  'hHYYYYYYYYYHh.',
  '.hHHHHHHHHHh..',
  '..hhhhhhhhh...',
]);
ic('brazier', [
  '..e..eE..e....',
  '.eEe.eEeeEe...',
  '.eEEeEEEEEe...',
  '.llllllllll...',
  'lzzzzzzzzzzl..',
  'lhhhhhhhhhhl..',
  'lzzzzzzzzzzl..',
  'lhhhhhhhhhhl..',
  'lzzzzzzzzzzl..',
  '.llllllllll...',
]);
ic('drying_rack', [
  'WWWWWWWWWWWWWW',
  'WwwwwwwwwwwwwW',
  'W.cc..N..cc.W.',
  'W.cc..N..cc.W.',
  'W.cc..N..cc.W.',
  'W.cC..N..cC.W.',
  'W..C..N..C..W.',
  'W............W',
  'W............W',
  'W............W',
]);
ic('skin_bed', [
  '.xxxxxxxxxxxx.',
  'xXxxxXxxxxXxxx',
  'xxxxxxxxxxxxxx',
  'xxXxxxxxXxxxxx',
  'uuuuuuuuuuuuuu',
  'uUuUuUuUuUuUuU',
  'WWWWWWWWWWWWWW',
]);
ic('hide_door', [
  'WWWWWWWWWWWWWW',
  'W.u.u.u.u.u.uW',
  'WuuuuuuuuuuuuW',
  'WuUuuuuuuuuuuW',
  'WuuuuUuuuuuuuW',
  'WuuuuuuuuUuuuW',
  'WuuUuuuuuuuuuW',
  'WuuuuuuuuuUuuW',
  'W.UUuuuuuUUu.W',
]);
ic('cache', [
  '....hhhh......',
  '..hhHHHHhh....',
  '.hHHHHHHHHh...',
  'hhHHhhhHHHHhh.',
  'hHHhHHHhHHHHHh',
  'hHHHHHHHHhHHHh',
  'hhhhhhhhhhhhhh',
]);
ic('snare', grid(g => {
  g.line(1, 13, 1, 3, 'W'); g.line(2, 13, 2, 3, 'w');
  g.line(2, 3, 7, 2, 't'); g.ell(9, 7, 4, 4, 't'); g.ell(9, 7, 2.2, 2.2, '.'); g.set(13, 11, 'S'); g.set(12, 12, 'S');
  g.line(5, 12, 12, 12, 'h');
}));
ic('sled', [
  '.WWWWWWWWWWWW.',
  '.wttttttttttw.',
  '.WWWWWWWWWWWW.',
  '..d..d..d..d..',
  '..d..d..d..d..',
  'zzzzzzzzzzzzzz',
  'zSSSSSSSSSSSSz',
  '.zzzzzzzzzzzzz',
].map((r, i) => (i === 6 ? 'ssSSSSSSSSSSSs' : r)));
ic('mast', grid(g => {
  g.line(7, 13, 7, 0, 'S', 1); g.line(8, 13, 8, 0, 's', 1);
  g.line(3, 3, 12, 3, 'S'); g.line(4, 6, 11, 6, 'S'); g.line(5, 9, 10, 9, 'S');
  g.set(7, 0, 'r'); g.set(8, 0, 'r'); g.rect(5, 13, 6, 1, 'W');
}));
ic('backpack', [
  '...zzzzzzz....',
  '..zrrrrrrrz...',
  '.zrrRRRRRrrz..',
  '.zrRrrrrrRrz..',
  '.zrRzzzzzRrz..',
  '.zrRzyyyzRrz..',
  '.zrRzzzzzRrz..',
  '.zrrRRRRRrrz..',
  '.zrrrrrrrrrz..',
  '..zzzzzzzzz...',
]);

// ---------------------------------------------------------------------------------------------------------------------------------- UI icons ('ui.<key>')
export const UI_KEYS: string[] = [];
function ui(key: string, rows: Rows, pal: Palette = PAL, size = 16, auto = true) {
  const o = auto ? outline(rows) : rows;
  const w = Math.max(...o.map(r => r.length));
  defSprite('ui.' + key, pal, size === 0 ? o : compose(size, size, [[o, Math.floor((size - w) / 2), Math.floor((size - o.length) / 2)]]));
  UI_KEYS.push(key);
}
ui('sun', grid(g => {
  g.disc(7, 7, 3.4, 'y'); g.disc(6.5, 6.5, 1.8, 'E');
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g.set(7 + Math.cos(a) * 5.4, 7 + Math.sin(a) * 5.4, 'y'); g.set(7 + Math.cos(a) * 6.2, 7 + Math.sin(a) * 6.2, 'Y'); }
}));
// moon phases: 0 new .. 4 full .. 7 waning crescent
export const MOON_PHASES = 8;
for (let k = 0; k < MOON_PHASES; k++) {
  const g = new Grid(14, 14), phase = k / MOON_PHASES, cx = 6.5, cy = 6.5, r = 6.3, t = Math.cos(2 * Math.PI * phase);
  for (let y = 0; y < 14; y++) for (let x = 0; x < 14; x++) {
    const nx = (x - cx) / r, ny = (y - cy) / r; if (nx * nx + ny * ny > 1) continue;
    const w = Math.sqrt(Math.max(0, 1 - ny * ny));
    const lit = phase < 0.5 ? nx > t * w : nx < -t * w;
    g.set(x, y, lit ? ((x * 7 + y * 13) % 11 === 0 ? 'C' : 'c') : ((x + y) % 5 === 0 ? 'L' : 'v'));
  }
  ui('moon' + k, g.rows());
}
ui('wind_arrow', [
  '.........b....',
  '..........bb..',
  'NNNNNNNNNNNNb.',
  'iiiiiiiiiiiiib',
  'NNNNNNNNNNNNb.',
  '..........bb..',
  '.........b....',
]);
ui('drop', [
  '......bb......',
  '.....bbbb.....',
  '....bbbbbb....',
  '...bbiibbbb...',
  '..bbbibbbbbB..',
  '..bbbbbbbbbB..',
  '..bbbbbbbbBB..',
  '...bbbbbbBB...',
  '....BBBBBB....',
]);
ui('food', [
  '..zzzzzzzz....',
  '.zSsssssSSz...',
  '.zzzzzzzzzz...',
  '.zoooooooooz..',
  '.zoOOOOOOOoz..',
  '.zoOyyyyyOoz..',
  '.zoOOOOOOOoz..',
  '.zooooooooz...',
  '.zzzzzzzzzz...',
]);
ui('energy', [
  '.....yyy.....',
  '....yyyY.....',
  '...yyyY......',
  '..yyyyyyyy...',
  '..YYYyyyY....',
  '.....yyY.....',
  '....yyY......',
  '...yyY.......',
  '...yY........',
  '...Y.........',
]);
ui('co', [
  '...HHHH.......',
  '..HhhhhHHH....',
  '.HhhhhhhhhHH..',
  'HhhhhhhhhhhhH.',
  'HhrrhhhrrrhhH.',
  'HhrhhhhrhhrhH.',
  'HhrrhhhrrrhhH.',
  '.HHHHHHHHHHH..',
  '..hh......hh..',
]);
ui('star_full', [
  '......yy......',
  '......yy......',
  '.....yyyy.....',
  'yyyyyyyyyyyyyy',
  '.yyyEyyyyEyyy.',
  '..yyyyyyyyyy..',
  '...yyyyyyyy...',
  '..yyyyyyyyyy..',
  '..yyyy..yyyy..',
  '.yyy......yyy.',
].map(r => r.replace(/E/g, 'E')));
ui('star_empty', [
  '......hh......',
  '......hh......',
  '.....h..h.....',
  'hhhhhh..hhhhhh',
  '.h..........h.',
  '..h........h..',
  '...h......h...',
  '..h..hhhh..h..',
  '..hhhh..hhhh..',
  '.hhh......hhh.',
]);
ui('warning', [
  '......yy......',
  '.....yyyy.....',
  '.....yKKy.....',
  '....yyKKyy....',
  '....yyKKyy....',
  '...yyyKKyyy...',
  '...yyyyyyyy...',
  '..yyyyKKyyyy..',
  '.yyyyyyyyyyyy.',
  'YYYYYYYYYYYYYY',
]);
ui('lock', [
  '...zzzzzz.....',
  '..zSS..SSz....',
  '..zS....Sz....',
  '..zS....Sz....',
  '.yyyyyyyyyy...',
  '.yYYYYYYYYy...',
  '.yYYYKKYYYy...',
  '.yYYYKKYYYy...',
  '.yYYYYKYYYy...',
  '.yyyyyyyyyy...',
]);
ui('storm', [
  '...nnnn.......',
  '..nNNNNnnn....',
  '.nNNNNNNNNnn..',
  'nNNNNNNNNNNNn.',
  'NNNNNNNNNNNNN.',
  '.hhhhhhhhhhh..',
  '..i..i..i..i..',
  '.i..i..i..i...',
  '..i..i..i..i..',
]);
ui('scent', grid(g => {
  for (const x0 of [3, 7, 11]) for (let y = 0; y < 8; y++) g.set(x0 + Math.round(Math.sin(y * 0.9 + x0) * 1.2), 7 - y, y > 5 ? 'Y' : 'o');
  g.ell(7, 11.5, 4, 2, 'T'); g.ell(7, 11, 3.5, 1.6, 't'); g.set(5, 11, 'K'); g.set(9, 11, 'K');
}));
ui('dog', [
  '.H.........H..',
  'HhH.......HhH.',
  'HhhH.....HhhH.',
  'HhhhHHHHHhhhH.',
  'HhhhhhhhhhhhH.',
  'HhhnnhhhnnhhH.',
  '.HhnKnhnKnhH..',
  '.HhhnnnnnhhH..',
  '..HhhnnKnhH...',
  '...HhhnnhhH...',
  '....HHhhHH....',
].map(r => r.replace(/h/g, 'S').replace(/H/g, 'z')));
ui('heart', [
  '.rrr..rrr.....',
  'rrRrrrrrrrr...',
  'rRrrrrrrrrr...',
  'rrrrrrrrrrr...',
  '.rrrrrrrrr....',
  '..rrrrrrr.....',
  '...rrrrr......',
  '....rrr.......',
  '.....r........',
]);
ui('flame', [
  '.....e........',
  '....ee..e.....',
  '...eee.ee.....',
  '..eeeEeee.....',
  '.eeeEEEeee....',
  '.eeEEyEEee....',
  '.eeEyyyEee....',
  '..eEyyyEe.....',
  '...eEyEe......',
  '....eee.......',
]);
ui('thermo', [
  '....KK....',
  '...KnnK...',
  '...KnrK...',
  '...KnrK...',
  '...KnrK...',
  '...KnrK...',
  '..KnrrrK..',
  '..KrrrrK..',
  '...KKKK...',
].map(r => r.replace(/K/g, 'z')));
ui('wet', [
  '..bb.....bb...',
  '.bbbb...bbbb..',
  '.bbib...bbib..',
  '..bb.....bb...',
  'bbbbbbbbbbbbb.',
  'bBbbbbbbbbbBb.',
  '.BBBBBBBBBBB..',
]);
ui('fine_work', grid(g => {
  g.line(2, 12, 11, 3, 'S'); g.line(3, 12, 12, 3, 's'); g.set(11, 3, 'K'); g.set(12, 2, 'S');
  for (let i = 0; i < 9; i++) g.set(3 + i, 12 - Math.round(Math.sin(i * 0.8) * 2) + 0, 'b');
  g.set(2, 12, 'B'); g.set(1, 13, 'B');
}));
ui('snowflake', grid(g => {
  g.line(7, 1, 7, 13, 'i'); g.line(1, 7, 13, 7, 'i'); g.line(2, 2, 12, 12, 'i'); g.line(12, 2, 2, 12, 'i');
  g.set(7, 2, 'n'); g.set(7, 12, 'n'); g.set(2, 7, 'n'); g.set(12, 7, 'n'); g.set(7, 7, 'n');
}));
ui('baro_up', [
  '.....nn.....',
  '....nnnn....',
  '...nnnnnn...',
  '..nnnnnnnn..',
  '....nnnn....',
  '....nnnn....',
  '....nnnn....',
]);
ui('baro_down', [
  '....nnnn....',
  '....nnnn....',
  '....nnnn....',
  '..nnnnnnnn..',
  '...nnnnnn...',
  '....nnnn....',
  '.....nn.....',
]);
ui('check', [
  '..........gg',
  '.........gg.',
  'gg......gg..',
  '.gg....gg...',
  '..gg..gg....',
  '...gggg.....',
  '....gg......',
]);
ui('cross', [
  'rr......rr',
  '.rr....rr.',
  '..rr..rr..',
  '...rrrr...',
  '...rrrr...',
  '..rr..rr..',
  '.rr....rr.',
  'rr......rr',
]);
// ---- HUD stat icons (DESIGN §10): hydration drop, food ration, energy bolt, warning
ui('drop', [
  '.....b.....',
  '....bib....',
  '...bibbb...',
  '...bibbb...',
  '..bibbbbb..',
  '.bibbbbbbb.',
  '.bbbbbbbBb.',
  '.bbbbbbBBb.',
  '..bbBBBBb..',
  '...bbbbb...',
], PAL, 12);
ui('food', [
  '.....GG.....',
  '....Gg......',
  '.CCCCCCCCC..',
  'CcccccccccC.',
  'CcOOOOOOocC.',
  'CcOooooOocC.',
  'CcOOOOOOocC.',
  'CcccccccccC.',
  '.CCCCCCCCC..',
], PAL, 12);
ui('bolt', [
  '....yyy.',
  '...yyy..',
  '..yyy...',
  '.yyyyyy.',
  '...yyy..',
  '..yy....',
  '.yy.....',
  'y.......',
], PAL, 12);
ui('warn', [
  '.....rr.....',
  '....rRRr....',
  '....rRRr....',
  '...rrKKrr...',
  '...rrKKrr...',
  '..rrrKKrrr..',
  '..rrrrrrrr..',
  '.rrrrKKrrrr.',
  '.rrrrrrrrrr.',
  'RRRRRRRRRRRR',
], PAL, 12);
// ---- HUD body figure: four 12×24 layers that stack at the same origin; tint with uiIcon(key, tintColour)
{
  const figure = (draw: (g: Grid) => void) => { const g = new Grid(12, 24); draw(g); return g.rows(); };
  const bodyPal: Palette = { n: '#f2f6fb', N: '#b9c6d8', h: '#7c8aa2', K: '#1b1726' };
  ui('body_head', figure(g => {
    g.ell(5.5, 4, 4.2, 4.4, 'n'); g.rect(4, 8, 4, 1, 'N');
    g.set(3, 4, 'h'); g.set(8, 4, 'h'); g.rect(3, 7, 6, 1, 'N');
    for (let y = 0; y < 24; y++) for (let x = 0; x < 12; x++) if (g.get(x, y) === 'n' && (x < 3 || y < 1)) g.set(x, y, 'N');
  }), bodyPal, 0, false);
  ui('body_torso', figure(g => {
    g.rect(2, 9, 8, 7, 'n'); g.rect(2, 9, 8, 1, 'N'); g.rect(1, 10, 1, 6, 'N'); g.rect(10, 10, 1, 6, 'N'); g.rect(0, 10, 2, 5, 'N'); g.rect(10, 10, 2, 5, 'N');
    g.rect(3, 16, 3, 5, 'n'); g.rect(6, 16, 3, 5, 'n'); g.rect(5, 16, 1, 5, 'N'); g.rect(2, 15, 8, 1, 'N');
  }), bodyPal, 0, false);
  ui('body_hands', figure(g => { g.rect(0, 15, 2, 3, 'n'); g.rect(10, 15, 2, 3, 'n'); g.set(0, 17, 'N'); g.set(11, 17, 'N'); }), bodyPal, 0, false);
  ui('body_feet', figure(g => { g.rect(2, 21, 4, 3, 'n'); g.rect(6, 21, 4, 3, 'n'); g.rect(2, 23, 4, 1, 'N'); g.rect(6, 23, 4, 1, 'N'); }), bodyPal, 0, false);
}

const uiCache = new Map<string, HTMLCanvasElement>();
/** UI icon canvas (cached). `tint` multiplies the colours (e.g. frost states of the body parts: '#ffffff', '#9fb4cc'). Unknown key → placeholder. */
export function uiIcon(key: string, tint?: string): HTMLCanvasElement {
  const ck = key + '|' + (tint ?? '');
  let c = uiCache.get(ck); if (c) return c;
  const base = spriteCanvas('ui.' + key);
  if (!base) { c = newCanvas(16, 16); const x = c.getContext('2d')!; x.fillStyle = '#35618f'; x.fillRect(0, 0, 16, 16); x.fillStyle = '#0b1220'; x.fillRect(2, 2, 12, 12); }
  else c = tint ? tintMultiply(base, tint, 'ui.' + key) : base;
  uiCache.set(ck, c); return c;
}
/** Moon icon for a phase in 0..1 (0 new, 0.5 full). */
export function moonIcon(phase: number, tint?: string): HTMLCanvasElement { return uiIcon('moon' + (((Math.round(phase * MOON_PHASES) % MOON_PHASES) + MOON_PHASES) % MOON_PHASES), tint); }
export const hasIcon = (id: string) => hasSprite(id);
