// 16×16 icons of the usable items (DESIGN §17, groups «Тепло и здоровье» and «Хранение и переноска»). Same recipe as art/icons.ts.
import { defSprite, outline, compose, recolorRows, PAL, type Rows, type Palette } from '../engine/sprites';

function ic(id: string, rows: Rows, pal: Palette = PAL) {
  const o = outline(rows), w = Math.max(...o.map(r => r.length));
  defSprite(id, pal, compose(16, 16, [[o, Math.floor((16 - w) / 2), Math.floor((16 - o.length) / 2)]]));
}
ic('thermos', [
  '..zzzz..',
  '..zrrz..',
  '.zzzzzz.',
  'zbbbbbbz',
  'zbHHHHbz',
  'zbbbbbbz',
  'zbHHHHbz',
  'zbbbbbbz',
  'zbHHHHbz',
  'zbbbbbbz',
  'zBBBBBBz',
  '.zzzzzz.',
]);
const FLASK: Rows = [
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
];
ic('flask_frozen', recolorRows(FLASK, { j: 'B', G: 'I', g: 'n', y: 'i', S: 'N', z: 'v' }));
ic('hand_warmer', [
  '.zzzzzzzzzz.',
  'zSsssssssssz',
  'zsEEoeeoEEsz',
  'zsEeorroeEsz',
  'zsEEoeeoEEsz',
  'zSsssssssSSz',
  '.zzzzzzzzzz.',
]);
ic('bandage', [
  '..nnnnnnnn..',
  '.nCCCCCCCCn.',
  'nCrrrCCrrrCn',
  'nCrrrCCrrrCn',
  'nCCCCCCCCCCn',
  '.nCCCCCCCCn.',
  '..nnnnnnnn..',
]);
ic('spirit', [
  '...zzzz...',
  '...zddz...',
  '..zzzzzz..',
  '.zIIIIIIz.',
  '.zIbbbbIz.',
  '.zIbnnbIz.',
  '.zIbbbbIz.',
  '.zIbbbbIz.',
  '.zIbbbbIz.',
  '.zIIIIIIz.',
  '..zzzzzz..',
]);
ic('frost_balm', [
  '..zzzzzzzz..',
  '.zSSSSSSSSz.',
  '.zzzzzzzzzz.',
  'zyyyyyyyyyyz',
  'zyYYYYYYYYyz',
  'zyYnnnnnnYyz',
  'zyYYYYYYYYyz',
  'zyyyyyyyyyyz',
  '.zzzzzzzzzz.',
]);
ic('snow_goggles', [
  '.dd........dd.',
  'dddzzzzzzzzddd',
  'dzbbbzzzzbbbzd',
  'zbIInbzzbnIIbz',
  'zbInnbzzbnnIbz',
  'zbbbbzzzzbbbbz',
  '.zzzz....zzzz.',
]);
ic('belt_pouch', [
  '..tttttttt..',
  '.tTTTTTTTTt.',
  'wwwwwwwwwwww',
  'wTTTyyyTTTww',
  'wwwwyyywwwwW',
  'wwwwwwwwwwwW',
  'wwwwwwwwwwwW',
  '.WWWWWWWWWW.',
]);
ic('big_pack', [
  '...zzzzzz...',
  '..zddddddz..',
  '.zdwwwwwwdz.',
  'zdwTTTTTTwdz',
  'zdwwwwwwwwdz',
  'zdwyyyyyywdz',
  'zdwwwwwwwwdz',
  'zdwTTTTTTwdz',
  'zdwwwwwwwwdz',
  'zdWWWWWWWWdz',
  '.zzzzzzzzzz.',
]);
ic('sack', [
  '...dd..dd...',
  '....dddd....',
  '...xxxxxx...',
  '..xCCCCCCx..',
  '.xCCCCCCCCx.',
  'xCCCuCCCCCCx',
  'xCCCCCCCuCCx',
  'xCCCCCCCCCCx',
  '.xCCCCCCCCx.',
  '..xxxxxxxx..',
]);
