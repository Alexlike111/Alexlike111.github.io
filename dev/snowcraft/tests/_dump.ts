import { generateWorld } from '../src/game/worldgen';
import { G } from '../src/game/state';
import { W, mat } from '../src/engine/grid';
import { MAT } from '../src/content/materials';
generateWorld(1);
for (const f of G.fixtures) if (f.tx > 130 && f.tx < 260 && f.ty > 40) console.log(f.kind, f.tx, f.ty, f.tw, f.th, JSON.stringify(f.data ?? {}).slice(0, 60));
// ascii of shed and house, rows 48..72 (tiles), cols 140..220 tile -> sample each tile as center cell
const ch = (m: number) => m === 0 ? '.' : m === MAT.FIXTURE ? 'F' : m === MAT.GLASS ? 'g' : m === MAT.PLANK ? 'p' : m === MAT.STONE ? 'S' : m === MAT.SNOW ? 's' : m === MAT.PACKED ? 'k' : m === MAT.LOG ? 'L' : m === MAT.METAL ? 'm' : '?';
for (let ty = 44; ty < 72; ty++) { let s = String(ty).padStart(3) + ' '; for (let tx = 148; tx < 216; tx++) { let n = 0, best = 0; const cnt = new Map<number, number>(); for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const m = mat[(ty * 4 + j) * W + tx * 4 + i]; cnt.set(m, (cnt.get(m) ?? 0) + 1); } let bm = 0, bc = -1; for (const [m, c] of cnt) if (c > bc) { bc = c; bm = m; } s += ch(bm); } console.log(s); }
