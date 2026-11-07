// Mine atmosphere and hazards (the mine has no ore to grind: its danger is air, rock and timber).
//  - frozen timbers creak in the hut; with one prop gone the roof sags (dust, louder creaks), with both gone it comes down (structure solver);
//  - a drip or two in the tunnels, a rumble and a shake when the roof slab loses cells.
// Called from stepQuest (quest.ts) every frame; everything here is cosmetic or a hint: the physics is the solver's.
import { G, toast } from './state';
import { strings, fmt } from '../content/i18n';
import { LOC, worldInfo } from './locations';
import { learn } from './lore';
import { mat, W } from '../engine/grid';
import { MAT } from '../content/materials';
import { spawnFx } from '../engine/particles';
import { addShake } from '../engine/camera';
import { sfx } from '../engine/audio';

const S = strings('mine', {
  creak: 'Мёрзлая кровля скрипит. Она держится на двух стойках — не выбивай обе.',
  sag: 'Кровля просела: одна стойка уже не держит. Вторую не трогай!',
  down: 'Кровля обрушилась!',
});

const say = (name: string, vol: number, pitch = 1) => { try { sfx.play(name, { vol, pitch }); } catch { /* audio is optional */ } };
let acc = 0, creakT = 6, lastSlab = -1, sagTold = false, creakTold = false, doomT = 0;

/** SNOWCRAFT has no gas explosions: a sealed gas box left by the generator becomes plain empty air. */
export function purgeMethane() { for (let i = 0; i < mat.length; i++) if (mat[i] === MAT.METHANE) mat[i] = MAT.AIR; }

export function resetMine() { acc = 0; creakT = 6; lastSlab = -1; sagTold = false; creakTold = false; doomT = 0; }

/** How many of the lower leg cells (head-height band) of each prop are still standing: [west, east]. */
export function propsLeft(): [number, number] {
  const ts = worldInfo.timberSets[0]; if (!ts) return [0, 0];
  const lim = LOC.mine.floorB - 28;
  let w = 0, e = 0, wt = 0, et = 0;
  for (const i of ts.west) if ((i / W | 0) >= lim) { wt++; if (mat[i] === MAT.LOG) w++; }
  for (const i of ts.east) if ((i / W | 0) >= lim) { et++; if (mat[i] === MAT.LOG) e++; }
  return [wt ? w / wt : 0, et ? e / et : 0];
}
function slabNow(): number {
  const R = worldInfo.roof; let n = 0;
  for (let y = R.y0; y < R.y1; y += 2) for (let x = R.x0; x < R.x1; x += 2) if (mat[y * W + x] === MAT.DIRT) n++;
  return n;
}

export function stepMine(dt: number) {
  const p = G.player; if (!p || !p.alive || G.paused) return;
  const M = LOC.mine;
  const onB = p.y > M.floorB - 40 && p.y < M.floorB + 8 && p.x > M.pocket[0] - 10 && p.x < M.rampBot + 30;
  const inHut = onB && p.x > M.hut[0] - 4 && p.x < M.hut[1] + 4;
  // the roof of the hut: creaking timbers, sag with one prop gone
  const [w, e] = propsLeft();
  if (inHut && worldInfo.timberSets.length) {
    creakT -= dt;
    const stressed = w < 0.5 || e < 0.5;
    if (creakT <= 0) {
      creakT = stressed ? 2.5 + Math.random() * 3 : 7 + Math.random() * 9;
      say('door_open', stressed ? 0.35 : 0.2, 0.5 + Math.random() * 0.15);
      const R = worldInfo.roof;
      spawnFx('dust', R.x0 + 8 + Math.random() * (R.x1 - R.x0 - 16), R.y1 + 1, (Math.random() - 0.5) * 4, 4, 0.9, 0xb8c4d0);
      if (!creakTold) { creakTold = true; toast(S.creak, 'warn'); }
      else if (stressed && !sagTold) { sagTold = true; toast(S.sag, 'bad'); learn('timber', 'exp'); }
    }
  }
  // the roof slab loses cells: rumble, shake, a word
  acc += dt;
  if (acc >= 0.5) {
    acc = 0;
    if (onB || lastSlab >= 0) {
      const n = slabNow();
      if (lastSlab < 0) lastSlab = n;
      if (n < lastSlab - 6) {
        say('collapse', 0.9); addShake(5); toast(S.down, 'bad'); doomT = 3;
      }
      lastSlab = n;
    }
  }
  if (doomT > 0) { doomT -= dt; if (Math.random() < dt * 8) { const R = worldInfo.roof; spawnFx('dust', R.x0 + Math.random() * (R.x1 - R.x0), R.y1, 0, 10, 1.2, 0xb8c4d0); } }
}
void fmt;
