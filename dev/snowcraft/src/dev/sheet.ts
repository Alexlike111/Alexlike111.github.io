// Sprite-sheet page (dev tool): every sprite / animation frame / icon at 4× with labels.
// Serve with `npx vite --port 5182` and open http://localhost:5182/tests/sheet.html  (?s=section,section filters; ?z=3 changes zoom; ?bg=night)
import { PLAYER_POSES, newPose, renderPose, type Look, DEFAULT_LOOK } from '../art/player';
import { HELD } from '../art/tools';
import { UI_KEYS, uiIcon } from '../art/icons';
import { ANIMAL_KINDS, animalFrame, frameCount, states } from '../art/animals';
import { FIXTURE_SHEET } from '../art/fixtures';
import { drawFixture, drawFixtureEmissive, drawAnimal, drawDrop, drawTarget, drawSled, setPlayerLook, type TargetInfo } from '../game/draw';
import type { Fixture, View, Animal, Drop } from '../game/state';
import { ITEMS } from '../game/items';
import { spriteCanvas, hasSprite } from '../engine/sprites';

const q = new URLSearchParams(location.search);
const ZOOM = +(q.get('z') ?? 4);
const only = q.get('s')?.split(',');
const root = document.getElementById('root')!;
const BG: Record<string, string> = { snow: '#c9d6e6', dusk: '#6c7f9e', night: '#26324a', ice: '#7fb0d4', rock: '#4c4f5c' };
let bg = BG[q.get('bg') ?? 'dusk'];
const cells: { cv: HTMLCanvasElement; fn: (ctx: CanvasRenderingContext2D) => void; label: HTMLElement }[] = [];

function section(name: string, key: string): HTMLElement | null {
  if (only && !only.includes(key)) return null;
  const h = document.createElement('h2'); h.textContent = name; root.appendChild(h);
  const row = document.createElement('div'); row.className = 'row'; root.appendChild(row);
  return row;
}
function cell(row: HTMLElement, label: string, w: number, h: number, fn: (ctx: CanvasRenderingContext2D) => void, zoom = ZOOM) {
  const d = document.createElement('div'); d.className = 'cell';
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.style.width = w * zoom + 'px'; cv.style.height = h * zoom + 'px';
  const sp = document.createElement('span'); sp.textContent = label;
  d.appendChild(cv); d.appendChild(sp); row.appendChild(d);
  cells.push({ cv, fn, label: sp }); paint(cells[cells.length - 1]);
}
function paint(c: { cv: HTMLCanvasElement; fn: (ctx: CanvasRenderingContext2D) => void }) {
  const ctx = c.cv.getContext('2d')!; ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, c.cv.width, c.cv.height); ctx.fillStyle = bg; ctx.fillRect(0, 0, c.cv.width, c.cv.height);
  c.fn(ctx);
}
document.querySelectorAll<HTMLButtonElement>('#bar button').forEach(b => b.onclick = () => { bg = BG[b.dataset.bg!]; cells.forEach(paint); });

// ---- player ----
const looks: [string, Look][] = [
  ['старт: станц.парка+шапка', DEFAULT_LOOK],
  ['меховая парка+капюшон', { parka: 'fur', head: 'fur', hands: 'fur', feet: 'kamik' }],
  ['станц.+меховые рукавицы+камики', { parka: 'station', head: 'none', hands: 'fur', feet: 'kamik' }],
];
{
  for (const [ln, look] of looks) {
    const row = section('Игрок · ' + ln, 'player'); if (!row) break;
    for (const pe of PLAYER_POSES) {
      const w = pe.name.startsWith('sleep') || pe.name.startsWith('dead') ? 28 : 28;
      cell(row, pe.name, w, 34, ctx => { const s = newPose(); pe.build(s); s.t = 1.2; renderPose(ctx, w / 2, 30, s, look); });
    }
    if (ln !== looks[0][0]) continue;
    // rime
    for (const r of [1, 2] as const) cell(row, 'иней ' + r, 28, 34, ctx => { const s = newPose(); s.rime = r; s.t = 1; renderPose(ctx, 14, 30, s, look); });
  }
  const row = section('Игрок · инструменты в руке (aim → 4 направления)', 'tools');
  if (row) {
    for (const id of Object.keys(HELD)) {
      for (const [an, a] of [['→', 0], ['↘', 0.7], ['↑', -1.2]] as const) {
        cell(row, id + ' ' + an, 40, 40, ctx => {
          const s = newPose(); const def = HELD[id];
          const ang = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
          s.hand = [Math.round(Math.cos(ang) * 5), Math.round(-11 + Math.sin(ang) * 5)];
          s.tool = { item: id, ang, reach: 5, load: id === 'shovel' ? 0.7 : 0, flipY: false, using: false, t: 1 };
          void def; s.t = 1; renderPose(ctx, 14, 34, s, DEFAULT_LOOK);
        });
      }
    }
  }
}
// ---- item icons ----
{
  const groups: [string, (k: string) => boolean][] = [
    ['Иконки · материалы и еда', k => ['material', 'food', 'block', 'misc', 'note'].includes(ITEMS[k].kind)],
    ['Иконки · инструменты и одежда', k => ['tool', 'wear'].includes(ITEMS[k].kind)],
    ['Иконки · наборы (фикстуры)', k => ITEMS[k].kind === 'fixture'],
  ];
  for (const [name, f] of groups) {
    const row = section(name, 'icons'); if (!row) break;
    for (const id of Object.keys(ITEMS).filter(f)) {
      const ok = hasSprite(ITEMS[id].icon);
      cell(row, id + (ok ? '' : ' ✗'), 40, 20, ctx => { const c = spriteCanvas(ITEMS[id].icon); if (c) { ctx.drawImage(c, 2, 2); ctx.drawImage(c, 20, 2, 16, 16); } }, ZOOM);
    }
  }
  const row = section('Иконки UI', 'ui');
  if (row) for (const k of UI_KEYS) { const c = uiIcon(k); cell(row, k, Math.max(c.width, 16) * 2 + 4, Math.max(c.height, 16) + 4, ctx => { ctx.drawImage(c, 2, 2); ctx.drawImage(c, c.width + 4, 2); }, c.height > 20 ? 3 : ZOOM); }
  const row2 = section('Фигурка HUD (4 слоя, тинты)', 'ui');
  if (row2) {
    const tints = [['норма', '#ffffff'], ['обморож.', '#c8e8ff'], ['тяжёлое', '#8aa6c8'], ['тёплое', '#ffc56a']];
    for (const [tn, tc] of tints) cell(row2, tn, 16, 28, ctx => { for (const k of ['body_torso', 'body_hands', 'body_feet', 'body_head']) ctx.drawImage(uiIcon(k, tc), 2, 2); }, 6);
  }
}
// ---- animals ----
for (const kind of ANIMAL_KINDS) {
  const row = section('Животные · ' + kind, 'animals'); if (!row) break;
  for (const st of states(kind)) {
    for (let f = 0; f < frameCount(kind, st); f++) {
      const fr = animalFrame(kind, st, f); if (!fr) continue;
      const W = Math.max(fr.c.width + 6, 26), H = fr.c.height + 6;
      cell(row, st + ' ' + f, W, H, ctx => { ctx.drawImage(fr.c, Math.floor((W - fr.c.width) / 2), H - 3 - fr.c.height); }, kind === 'bear' ? 3 : ZOOM);
    }
  }
}
// ---- fixtures ----
{
  const view = (w: number, h: number, t: number): View => ({ x0: 0, y0: 0, w, h, scale: 1, t });
  for (const e of FIXTURE_SHEET) {
    const row = section('Фикстура · ' + e.kind, 'fixtures'); if (!row) break;
    for (const vr of e.variants) {
      const tw = (vr.patch.tw as number | undefined) ?? e.tw, th = (vr.patch.th as number | undefined) ?? e.th;
      const W = Math.max(tw * 4 + 24, 40), H = th * 4 + 34;
      cell(row, e.kind + ' ' + vr.name, W, H, ctx => {
        const f: Fixture = { id: 3, kind: e.kind, tx: 0, ty: 0, tw, th, ...vr.patch };
        f.tx = Math.floor((W - tw * 4) / 8); f.ty = Math.floor((H - 4 - th * 4) / 4);
        ctx.fillStyle = '#dfe9f4'; ctx.fillRect(0, (f.ty + th) * 4, W, H);               // snow floor
        const v = view(W, H, 1.3);
        drawFixture(ctx, v, f, v.t);
        if (f.lit) { ctx.globalCompositeOperation = 'lighter'; drawFixtureEmissive(ctx, v, f, v.t); ctx.globalCompositeOperation = 'source-over'; }
      }, 4);
    }
  }
}
// ---- misc: drops, targets, sled ----
{
  const row = section('Предметы на земле', 'misc');
  if (row) for (const id of ['snow_block', 'coal', 'fish', 'note', 'fat', 'battery', 'axe', 'cooked_meat']) cell(row, id, 24, 20, ctx => { const d: Drop = { id: 5, item: id, n: 1, x: 12, y: 16, vx: 0, vy: 0, age: 1 }; drawDrop(ctx, { x0: 0, y0: 0, w: 24, h: 20, scale: 1, t: 0.4 }, d, 0.4); });
  const row2 = section('Прицел (drawTarget)', 'misc');
  if (row2) {
    const T = (o: Partial<TargetInfo>): TargetInfo => ({ tx: 2, ty: 2, tw: 2, th: 1, mode: 'dig', ok: true, progress: 0, ...o });
    const variants: [string, TargetInfo][] = [
      ['dig 0.2', T({ progress: 0.2, tw: 1, th: 1 })], ['dig 0.6', T({ progress: 0.6, tw: 1, th: 1 })], ['dig 0.95', T({ progress: 0.95, tw: 1, th: 1 })],
      ['chisel 0.5', T({ mode: 'chisel', progress: 0.5, tw: 1, th: 1 })], ['cut 0.3', T({ mode: 'cut', progress: 0.3 })], ['cut 0.8', T({ mode: 'cut', progress: 0.8 })],
      ['place ok', T({ mode: 'place', ghostItem: 'snow_block', margin: 0.9 })], ['place amber', T({ mode: 'place', ghostItem: 'snow_block', margin: 0.3 })], ['place red', T({ mode: 'place', ghostItem: 'snow_block', margin: 0.05, ok: false })],
      ['lean -1', T({ mode: 'place', ghostItem: 'snow_block', margin: 0.8, lean: -1 })], ['lean +1', T({ mode: 'place', ghostItem: 'snow_block', margin: 0.8, lean: 1 })],
      ['ghost lamp', T({ mode: 'place', ghostItem: 'fat_lamp', tw: 1, th: 1, margin: 1 })], ['ghost campfire', T({ mode: 'place', ghostItem: 'campfire', tw: 2, th: 1, margin: 1 })],
      ['use', T({ mode: 'use', tw: 2, th: 2 })], ['attack', T({ mode: 'attack', tw: 2, th: 2 })], ['blocked', T({ ok: false, tw: 2, th: 2 })],
    ];
    for (const [n, t] of variants) cell(row2, n, 24, 22, ctx => { ctx.fillStyle = '#e2ecf6'; ctx.fillRect(0, 0, 24, 22); drawTarget(ctx, { x0: 0, y0: 0, w: 24, h: 22, scale: 1, t: 0.2 }, t); });
  }
  const row3 = section('Нарты', 'misc');
  if (row3) for (const l of [0, 0.3, 0.6, 1]) cell(row3, 'load ' + l, 50, 32, ctx => { drawSled(ctx, { x0: 0, y0: 0, w: 50, h: 32, scale: 1, t: 0 }, 24, 30, l); });
  const row4 = section('Игрок · вариации одежды и свет', 'misc');
  void drawAnimal; void setPlayerLook; void (null as unknown as Animal);
  void row4;
}
if (q.has('selftest')) {
  Promise.all([import('../game/selftest'), import('../game/art.selftest')]).then(async ([m]) => { (window as any).__artReport = await m.runSelfTest('art'); (window as any).__sheetReady = true; });
} else (window as any).__sheetReady = true;
