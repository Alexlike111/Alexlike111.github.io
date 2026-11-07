import { generateWorld } from '../src/game/worldgen';
import { G } from '../src/game/state';
import { W, mat } from '../src/engine/grid';
import { MAT } from '../src/content/materials';
generateWorld(1);
const NEW = new Set(['generator','ceiling_lamp','heater','medkit','kettle','sonde','gramophone','hatch','shutter','damper','bell']);
for (const f of G.fixtures) if (NEW.has(f.kind) || (f.kind==='chest' && (f.data?.look==='barrel'||f.data?.look==='den')) || f.kind==='drum') console.log(f.kind, f.tx, f.ty, f.tw, f.th, JSON.stringify(f.data));
const gen = G.fixtures.find(f=>f.kind==='generator')!;
console.log('exhaust', gen.data!.exX, gen.data!.exY);
const ch = (m: number) => m === 0 ? '.' : m === MAT.FIXTURE ? 'F' : m === MAT.GLASS ? 'g' : m === MAT.PLANK ? 'p' : m === MAT.STONE ? 'S' : m === MAT.SNOW ? 's' : m === MAT.PACKED ? 'k' : m === MAT.LOG ? 'L' : m === MAT.METAL ? 'M' : '?';
for (let y = 200; y < 276; y += 2) { let s = String(y).padStart(3) + ' '; for (let x = 780; x < 850; x++) s += ch(mat[y * W + x]); console.log(s); }
