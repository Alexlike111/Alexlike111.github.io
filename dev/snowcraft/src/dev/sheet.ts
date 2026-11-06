// Sprite-sheet page (dev tool): every sprite / animation frame / icon at 4× with labels.
// Serve with `npx vite --port 5182` and open http://localhost:5182/tests/sheet.html  (?s=section,section filters; ?z=3 changes zoom; ?bg=night)
import { PLAYER_POSES, newPose, renderPose, type Look, DEFAULT_LOOK } from '../art/player';
import { HELD } from '../art/tools';

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
(window as any).__sheetReady = true;
