// Level container + builders. (Procedural sheets live in levelgen.ts)
import { RAPIER, GR } from '../phys/world';
import type { Game } from './game';
import { rectPoly } from '../phys/fracture';

export interface Level { x0: number; x1: number; y0: number; groundY: number; spawnX: number; spawnY: number; biome: string; name: string }

export function makeBounds(g: Game, L: Level) {
  const w = g.phys.world, f = g.phys.fixed; const W = L.x1 - L.x0;
  const mk = (cx: number, cy: number, hx: number, hy: number) => { const c = w.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy).setTranslation(cx, cy).setFriction(0.9).setCollisionGroups(GR.static), f); g.phys.ref(c, 'bedrock', null); };
  mk((L.x0 + L.x1) / 2, L.groundY + 5, W / 2 + 12, 5);
  mk(L.x0 - 5, L.groundY - 30, 5, 60); mk(L.x1 + 5, L.groundY - 30, 5, 60);
  mk((L.x0 + L.x1) / 2, L.y0 - 5, W / 2 + 12, 5);
}

export function buildTestLevel(g: Game): Level {
  const L: Level = { x0: -22, x1: 26, y0: -30, groundY: 0, spawnX: -3, spawnY: -1, biome: 'press', name: 'TEST' };
  makeBounds(g, L);
  const st = g.st;
  // a three-storey block
  const bx = 3, bw = 11, fh = 3.4, th = 0.5;
  for (let f = 0; f < 3; f++) {
    const y1 = -f * fh, y0 = y1 - fh;
    st.addRect(bx, y0 + th, 0.6, fh - th, f === 1 ? 'brick' : 'concrete');
    st.addRect(bx + bw - 0.6, y0 + th, 0.6, fh - th - (f === 0 ? 2.2 : 0), 'concrete');
    if (f === 0) st.addRect(bx + bw - 0.5, -2.2, 0.4, 2.2, 'glass');
    st.addRect(bx + 4.2, y0 + th, 0.35, fh - th, f === 2 ? 'glass' : 'plaster');
    st.addRect(bx, y0, bw, th, f === 1 ? 'wood' : 'concrete');
  }
  st.addRect(bx + 6.5, -3 * fh - 1.6, 3, 1.6, 'brick');
  // free-standing brick wall + glass wall
  st.addRect(-9, -4.2, 0.7, 4.2, 'brick');
  st.addRect(-13, -3, 0.25, 3, 'glass'); st.addRect(-13.6, -3.3, 3.2, 0.3, 'wood'); st.addRect(-16, -3, 0.25, 3, 'glass');
  // tower with a plank bridge
  st.addRect(18, -7, 0.8, 7, 'concrete'); st.addRect(21.5, -7, 0.8, 7, 'concrete'); st.addRect(17.5, -7.5, 5.3, 0.5, 'concrete'); st.addRect(14, -7.4, 4, 0.3, 'wood');
  st.finalize(L.groundY);
  // loose crates
  for (let i = 0; i < 5; i++) st.spawnBody([rectPoly(-1 + i * 0.05 - 0.4 + (i % 2) * 0.9, -0.8 - Math.floor(i / 2) * 0.8, 0.8, 0.8)], 'crate', 0, 0, 'crate');
  st.spawnBody([rectPoly(8, -0.9 - 3.4, 0.9, 0.9)], 'crate', 0, 0, 'crate');
  return L;
}
