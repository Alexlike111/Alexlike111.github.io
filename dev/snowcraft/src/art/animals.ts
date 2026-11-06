// Animals: husky «Север», ringed seal, arctic fox, ptarmigan, polar bear, cod. Frames are generated lazily from text-grid parts + a tiny
// quadruped rig (sin-driven gaits), outlined and cached as canvases. Anchor = bottom-centre of the frame. Sprites face RIGHT; flip with Animal.face.
// Supported Animal.state strings: 'idle','walk','run','sit','sleep','bark','sniff','lie','surface','dive','fly','rear','charge','swipe','dead'
// (anything else falls back: 'flee'/'hurt'/'chase' → run, 'eat'/'dig'/'peck' → sniff, 'stalk' → walk, 'swim' → idle).
import { outline, rowsCanvas, compose, type Rows, type Palette } from '../engine/sprites';
import { Grid } from './grid';

export interface AnimalFrame { c: HTMLCanvasElement; ax: number }
interface Builder { n: number; make: (f: number) => Rows; pal: Palette; ol?: string; cut?: boolean }
const REG: Record<string, Record<string, Builder>> = {};
const cache = new Map<string, AnimalFrame>();
function reg(kind: string, state: string, n: number, pal: Palette, make: (f: number) => Rows, o: { cut?: boolean } = {}) {
  (REG[kind] ??= {})[state] = { n, make, pal, ...o };
}
export function frameCount(kind: string, state: string): number { return REG[kind]?.[state]?.n ?? 1; }
export function states(kind: string): string[] { return Object.keys(REG[kind] ?? {}); }
export const ANIMAL_KINDS = ['dog', 'bear', 'seal', 'fox', 'ptarmigan', 'fish'];

/** Frame canvas (outlined, cached). */
export function animalFrame(kind: string, state: string, f: number): AnimalFrame | null {
  const b = REG[kind]?.[state]; if (!b) return null;
  f = ((f % b.n) + b.n) % b.n;
  const key = kind + '|' + state + '|' + f;
  let r = cache.get(key); if (r) return r;
  let rows = outline(b.make(f));
  if (b.cut) rows = rows.slice(0, rows.length - 1);
  const c = rowsCanvas(rows, b.pal);
  r = { c, ax: Math.floor(c.width / 2) };
  cache.set(key, r); return r;
}

// ---- quadruped rig --------------------------------------------------------------------------------------------------------------------
type LegPose = [number, number];                       // dx, lift
interface Gait { nF: LegPose; nH: LegPose; fF: LegPose; fH: LegPose; dy: number }
const rnd = Math.round;
/** Sin-driven gait: phase 0..1. */
function gait(ph: number, amp: number, lift: number, mode: 'walk' | 'run'): Gait {
  const leg = (off: number): LegPose => { const a = 2 * Math.PI * (ph + off); return [rnd(Math.sin(a) * amp), rnd(Math.max(0, Math.cos(a)) * lift)]; };
  if (mode === 'walk') return { nF: leg(0), fH: leg(0.25), fF: leg(0.5), nH: leg(0.75), dy: rnd(Math.abs(Math.sin(ph * 4 * Math.PI)) * 0) };
  // gallop: fore pair together, hind pair together, body arcs
  return { nF: leg(0), fF: leg(0.07), nH: leg(0.5), fH: leg(0.57), dy: -rnd(Math.max(0, Math.sin(2 * Math.PI * (ph + 0.25))) * 1.5) };
}
function leg(g: Grid, hx: number, hy: number, fx: number, ground: number, lift: number, thick: number, col: string, paw: string, pawW: number) {
  const ay = ground - lift - 1;
  for (let k = 0; k < thick; k++) g.line(hx + k, hy, fx + k, ay, col);
  g.rect(fx, ay + 1 - 0, pawW, 1, paw);
  if (lift === 0) g.rect(fx, ground, pawW, 0, paw);
}

// ===================================================================================================================================
// HUSKY «Север»
const DOGP: Palette = { K: '#2a2632', d: '#5f6779', g: '#8d96a8', w: '#eaf0f7', W: '#b6c2d1', n: '#14111a', t: '#e0707e', r: '#b8404e', y: '#d8b26a', z: '#d6e2f0' };
const DOG_BODY: Rows = [
  '..dddddddd.',
  '.ddgdddgddd',
  'ddggggggwww',
  'gwwwwwwwwww',
  '.wWwwwwwWw.',
];
const DOG_HEAD: Rows = [
  '.d..d..',
  'dddddd.',
  'dwwKwww',
  'gwwwwwn',
  '.wwwww.',
  '..wwW..',
];
const DOG_HEAD_BARK: Rows = [
  '.d..d..',
  'dddddd.',
  'dwwKwww',
  'gwwwwwn',
  '.wwwrrr',
  '..wWr..',
];
const DOG_HEAD_SNIFF: Rows = [
  '..dd.d.',
  '.ddddd.',
  '.dwwKw.',
  '..wwwww',
  '..wwwwn',
  '...www.',
];
const DOG_TAIL: Rows[] = [
  ['.dd.', 'dwwd', 'dw..'],
  ['..dd', '.dwd', 'dwd.'],
];
function dogRows(p: { g: Gait; head: Rows; hx: number; hy: number; tail: number; dy?: number; bodyDy?: number }): Rows {
  const G = new Grid(18, 12), dy = p.dy ?? p.g.dy;
  const hipF = 12, hipH = 5, hy = 8 + dy;
  leg(G, hipF, hy, hipF + p.g.fF[0], 11, p.g.fF[1], 2, 'g', 'W', 3);
  leg(G, hipH, hy, hipH + p.g.fH[0], 11, p.g.fH[1], 2, 'g', 'W', 3);
  G.blit(DOG_BODY, 3, 4 + dy);
  leg(G, hipF - 1, hy, hipF - 1 + p.g.nF[0], 11, p.g.nF[1], 2, 'w', 'W', 3);
  leg(G, hipH - 1, hy, hipH - 1 + p.g.nH[0], 11, p.g.nH[1], 2, 'w', 'W', 3);
  G.blit(DOG_TAIL[p.tail], 0, 1 + dy);
  G.blit(p.head, p.hx, p.hy + dy);
  return G.rows();
}
const STAND = (): Gait => ({ nF: [0, 0], nH: [0, 0], fF: [-1, 0], fH: [-1, 0], dy: 0 });
reg('dog', 'idle', 2, DOGP, f => dogRows({ g: STAND(), head: DOG_HEAD, hx: 11, hy: 0, tail: f }));
reg('dog', 'walk', 4, DOGP, f => dogRows({ g: gait(f / 4, 2, 1, 'walk'), head: DOG_HEAD, hx: 11, hy: 0, tail: f % 2 }));
reg('dog', 'run', 4, DOGP, f => dogRows({ g: gait(f / 4, 4, 3, 'run'), head: DOG_HEAD, hx: 11, hy: 1, tail: f % 2 }));
reg('dog', 'sniff', 2, DOGP, f => dogRows({ g: gait(f / 2 * 0.5, 1, 1, 'walk'), head: DOG_HEAD_SNIFF, hx: 11, hy: 4 + (f % 2), tail: 0 }));
reg('dog', 'bark', 2, DOGP, f => {
  const r = dogRows({ g: { nF: [1, 0], nH: [-1, 0], fF: [0, 0], fH: [-2, 0], dy: 0 }, head: f ? DOG_HEAD_BARK : DOG_HEAD, hx: 11, hy: f ? -1 : 0, tail: 1 });
  return f ? compose(18, 12, [[r, 0, 0]]) : r;
});
reg('dog', 'sit', 2, DOGP, f => compose(14, 14, [[[
  '.dd.d.....', 'dddddd....', 'dwwKwww...', 'gwwwwwn...', '.wwwww....', '..wwWd....', '..dddddd..', '.ddgddgdd.', '.dggggggg.', 'dgwwwwwww.', 'dwwwwwwwwd', 'dWwwwwwWwd', 'dwWwwwwWw.',
].map(r => r.padEnd(10, '.')), 1, 0], [DOG_TAIL[f], 0, 10]]));
reg('dog', 'sleep', 2, DOGP, f => compose(17, 8, [[[
  '..ddddddd.....',
  '.dddgdddgdd...',
  'dgggggggggdd..',
  'gwwwwwwwwwdddd',
  'WwwwwwwwwwwKwn',
  '.WwwWWwwwwwwww',
  '..WWWWWWWWWW..',
].map((r, i) => (i === 4 && f ? r.replace('K', 'w') : r)), 1, 0 + (f ? 0 : 0)]]).slice(f ? 1 : 0), { cut: true });
reg('dog', 'dead', 1, DOGP, () => compose(18, 7, [[[
  '..dddddddd.....',
  '.ddgdddgddd.dd.',
  'ddggggggwwwwddw',
  'gwwwwwwwwwwwwKn',
  '.wWwwwwwWw.wwww',
  'WW.WW...WW.WW..',
], 1, 1]]), { cut: true });

// ===================================================================================================================================
// ARCTIC FOX
const FOXP: Palette = { K: '#3b4766', d: '#202636', w: '#f3f8fd', W: '#c4d2e4', g: '#9fb1c8', n: '#15121a', y: '#e8b0a0' };
const FOX_BODY: Rows = [
  '.wwwwwww.',
  'wwwWwwwww',
  'wwwwwwwww',
  '.WwwwwwW.',
];
const FOX_HEAD: Rows = [
  'w..w..',
  'wwwwww',
  'wKwwww',
  'wwwwwn',
  '.wwww.',
];
const FOX_HEAD_SNIFF: Rows = [
  '.w..w.',
  '.wwwww',
  '.wKwww',
  '..wwwn',
  '..www.',
];
const FOX_TAIL: Rows[] = [
  ['.www..', 'wwwWww', '.wwww.', '..ww..'],
  ['..ww..', '.wwWww', 'wwwwww', 'www...'],
];
function foxRows(p: { g: Gait; head: Rows; hx: number; hy: number; tail: number; dy?: number }): Rows {
  const G = new Grid(16, 11), dy = p.dy ?? p.g.dy;
  leg(G, 10, 7 + dy, 10 + p.g.fF[0], 10, p.g.fF[1], 1, 'W', 'g', 2);
  leg(G, 4, 7 + dy, 4 + p.g.fH[0], 10, p.g.fH[1], 1, 'W', 'g', 2);
  G.blit(FOX_BODY, 3, 3 + dy);
  leg(G, 11, 7 + dy, 11 + p.g.nF[0], 10, p.g.nF[1], 2, 'w', 'W', 2);
  leg(G, 5, 7 + dy, 5 + p.g.nH[0], 10, p.g.nH[1], 2, 'w', 'W', 2);
  G.blit(FOX_TAIL[p.tail], 0, 3 + dy);
  G.blit(p.head, p.hx, p.hy + dy);
  return G.rows();
}
reg('fox', 'idle', 2, FOXP, f => foxRows({ g: STAND(), head: FOX_HEAD, hx: 10, hy: 1, tail: f }));
reg('fox', 'walk', 4, FOXP, f => foxRows({ g: gait(f / 4, 2, 1, 'walk'), head: FOX_HEAD, hx: 10, hy: 1, tail: f % 2 }));
reg('fox', 'run', 4, FOXP, f => foxRows({ g: gait(f / 4, 4, 3, 'run'), head: FOX_HEAD, hx: 10, hy: 2, tail: 0 }));
reg('fox', 'sniff', 2, FOXP, f => foxRows({ g: gait(f * 0.25, 1, 1, 'walk'), head: FOX_HEAD_SNIFF, hx: 10, hy: 4 + (f % 2), tail: f }));
reg('fox', 'sleep', 2, FOXP, f => compose(15, 6, [[[
  '..wwwwwww....',
  '.wwwWwwwwwww.',
  'wwwwwwwwwwKwn',
  'wWwwwwwwwwwww',
  '.WWWWWWWWWW..',
].map((r, i) => (i === 2 && f ? r.replace('K', 'w') : r)), 1, 1]]), { cut: true });
reg('fox', 'dead', 1, FOXP, () => compose(15, 5, [[[
  '.wwwwwww..ww.',
  'wwwWwwwwwwKwn',
  'wwwwwwwwwwwww',
  'WW.WW..WW.WW.',
], 1, 1]]), { cut: true });

// ===================================================================================================================================
// PTARMIGAN (winter plumage)
const PTP: Palette = { K: '#3a4766', n: '#fbfdff', N: '#cdd9e8', g: '#9aabc2', k: '#14111a', r: '#d4423a', o: '#e0a050', t: '#2a2630' };
const PT_BODY: Rows = [
  '..nnnn..',
  '.nnnnnnn',
  'nnnnnnnn',
  'NNnnnnnn',
  '.NNNNNN.',
];
const PT_HEAD: Rows = ['.nnn', 'nrkn'.replace('r', 'n'), 'nnnoo'];
function ptRows(p: { legs: number; fly?: number; dy?: number; bob?: number }): Rows {
  const G = new Grid(14, 11), dy = p.dy ?? 0;
  if (!p.fly) {
    G.set(5, 8 + dy, 'o'); G.set(5, 9 + dy, 'o'); G.set(8, 8 + dy, 'o'); G.set(8, 9 + dy, 'o');
    if (p.legs === 1) { G.set(4, 9 + dy, 'o'); G.set(9, 9 + dy, 'o'); G.set(5, 9 + dy, '.'); G.set(8, 9 + dy, '.'); }
    G.set(6, 10 + dy, 'o'); G.set(9, 10 + dy, 'o');
  } else { G.set(6, 8 + dy, 'o'); G.set(7, 8 + dy, 'o'); }
  G.blit(PT_BODY, 3, 4 + dy);
  G.blit(['..t.', '.tt.'], 0, 6 + dy);                                // tail tips
  G.blit(['NNN', 'nnn'], 0, 4 + dy);
  G.blit(['.nn.', 'nnkn', 'nnnn', '..oo'].map(r => r), 9 + (p.bob ?? 0), 1 + dy);
  G.set(11 + (p.bob ?? 0), 1 + dy, 'r');
  return G.rows();
}
reg('ptarmigan', 'idle', 2, PTP, f => ptRows({ legs: 0, dy: 0, bob: f }));
reg('ptarmigan', 'walk', 4, PTP, f => ptRows({ legs: f % 2, dy: f % 2 ? -1 : 0, bob: f % 2 }));
reg('ptarmigan', 'sniff', 2, PTP, f => ptRows({ legs: 0, dy: 1, bob: f }));
reg('ptarmigan', 'fly', 4, PTP, f => {
  const G = new Grid(16, 12);
  const wing = [
    ['.nn', 'nnnn', 'Nnnn'], ['', 'nnnnn', 'NNNN'], ['', '', 'nnnnnn'], ['', 'NNNN', 'nnnnn'],
  ][f] ?? [];
  G.blit(ptRows({ legs: 0, fly: 1, dy: 0 }).map(r => r.slice(0, 14)), 1, 0);
  const wy = [0, 3, 6, 8][f];
  // wings: up (f0), mid (f1), down (f2/3)
  const up = f === 0 || f === 3;
  G.rect(4, up ? 1 : 6, 5, up ? 4 : 2, 'n'); G.rect(4, up ? 4 : 7, 5, 1, 'N'); void wing; void wy;
  return G.rows();
});
reg('ptarmigan', 'dead', 1, PTP, () => compose(12, 6, [[[
  '..NNNNNN....', '.nnnnnnnnn..', 'nnnnnnnnnkn.', '.oo..oo.....',
], 0, 0]]), { cut: true });

// ===================================================================================================================================
// RINGED SEAL
const SEALP: Palette = { K: '#2a3144', g: '#8c97a6', G: '#6a7587', w: '#d9e1ea', W: '#aab6c6', k: '#10141c', s: '#4f5a6c', n: '#e8f0f8', r: '#7a4350', b: '#2f66a0', B: '#1a3d66' };
const SEAL_BODY: Rows = [
  '...GGGGGGGGGGG.......',
  '..GggGgggGgggGGG.....',
  '.GgGggggGgggggGgGG...',
  'GgggGggggggGgggggGGg.',
  'GggggggGggggggggggGg.',
  'WgggggggggggggggggWw.',
  '.WwwwwwwwwwwwwwwwwW..',
];
const SEAL_HEAD: Rows = [
  '.GGG..',
  'GgggG.',
  'GgkgGg',
  'WgggggK'.slice(0, 6),
  '.WwwwW',
];
reg('seal', 'lie', 2, SEALP, f => {
  const G = new Grid(24, 10);
  G.blit(SEAL_BODY, 0, 3 + 0);
  G.blit([' .G', ' GgG', 'gggg'].map(r => r.replace(/^ /, '.')), 17, 3);                    // head rest
  G.blit(SEAL_HEAD, 17, 0);
  G.blit(['..ww', 'wwWW'], 0, 7 + 1);                                   // rear flippers
  G.set(19, 2, f ? 'g' : 'k');
  G.blit(['..w', 'ww.'], 22, 6);
  return G.rows();
}, { cut: false });
reg('seal', 'walk', 2, SEALP, f => {
  const G = new Grid(24, 10);
  G.blit(SEAL_BODY, 0, 3 + (f ? 0 : 1));
  G.blit(SEAL_HEAD, 17, 0 + (f ? 0 : 1));
  G.blit(['..ww', 'wwWW'], 0, 8 + (f ? 0 : 1)); G.rect(16, 8, 4, 1, 'W');
  return G.rows();
});
reg('seal', 'surface', 2, SEALP, f => {
  const G = new Grid(12, 14), d = f ? 0 : 1;
  G.rect(3, 9, 6, 5, 'G'); G.rect(4, 9, 4, 5, 'g'); G.rect(5, 11, 2, 3, 'W');
  G.blit(['..GGGGG..', '.GggggggG.', 'GggggggggG', 'GgkkggkkgG', 'GggggggggG', '.WwwKKwwW.', '..wnnnnw..'], 1, 2 + d);
  G.set(0, 7 + d, 'n'); G.set(10, 7 + d, 'n'); G.set(11, 8 + d, 'n'); G.set(1, 8 + d, 'n');
  return G.rows();
}, { cut: true });
reg('seal', 'dive', 3, SEALP, f => {
  const G = new Grid(12, 8);
  if (f === 0) { G.blit(['.GGGGG.', 'GgkgkgG', 'GgggggG'], 2, 1); }
  else if (f === 1) { G.blit(['.GGGG.', 'GggggG'], 3, 3); }
  else { G.blit(['GGG', 'ggg'], 4, 5); }
  return G.rows();
}, { cut: true });
reg('seal', 'dead', 1, SEALP, () => {
  const G = new Grid(24, 9);
  G.blit(SEAL_BODY, 0, 2); G.blit(SEAL_HEAD, 17, 0); G.set(19, 2, 'W'); G.blit(['rr', 'rr'], 8, 7);
  return G.rows();
});

// ===================================================================================================================================
// COD
const FISHP: Palette = { K: '#2c4046', a: '#6f8a6c', A: '#4f6a52', c: '#d8dcc2', k: '#10141c', y: '#c7a05a' };
const FISH_BODY: Rows = [
  '..aaaaaa..',
  '.aAaaAaaa.',
  'aaaaaaaaaaa'.slice(0, 10),
  'ccccccccc.',
];
reg('fish', 'idle', 2, FISHP, f => {
  const G = new Grid(14, 7);
  G.blit(FISH_BODY, 3, 1); G.set(10, 2, 'k'); G.set(9, 4 - 1, 'y');
  G.blit(f ? ['aa', '.a', 'aa'] : ['.a', 'aa', '.a'], 0, 1 + (f ? 1 : 0));
  G.blit(['.a.', 'aaa'], 5, 0); G.set(2 + 1, 3, 'a');
  return G.rows();
});
reg('fish', 'dead', 1, FISHP, () => { const G = new Grid(14, 5); G.blit(FISH_BODY.slice().reverse(), 2, 1); G.set(9, 2, 'K'); return G.rows(); });
REG.fish.walk = REG.fish.idle; REG.fish.swim = REG.fish.idle;

// ===================================================================================================================================
// POLAR BEAR (≈28×16 cells)
const BEARP: Palette = { K: '#5f5646', c: '#f6efdc', C: '#e0d4b6', u: '#bcae8c', U: '#9b8d6c', n: '#1c1720', r: '#c4505a', w: '#ffffff' };
function bearBody(g: Grid, x: number, y: number, w: number, h: number) {
  g.ell(x + w / 2, y + h / 2, w / 2, h / 2, 'C');
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const nx = (i + 0.5) / w * 2 - 1, ny = (j + 0.5) / h * 2 - 1;
    if (nx * nx + ny * ny > 1) continue;
    g.set(x + i, y + j, ny < -0.45 ? 'c' : ny < 0.18 ? ((i * 3 + j * 5) % 11 === 0 ? 'c' : 'C') : ny < 0.55 ? 'C' : (nx < -0.25 || (i + j) % 7 ? 'u' : 'U'));
  }
}
function bearLeg(g: Grid, hx: number, hy: number, fx: number, ground: number, lift: number, col: string, paw: string) {
  const ay = ground - lift - 2;
  for (let k = 0; k < 5; k++) g.line(hx + k, hy, fx + k, ay, col);
  g.rect(fx, ay + 1, 7, 2, paw); g.set(fx + 6, ay + 2, 'n'); g.set(fx + 5, ay + 2, 'n');
  if (paw === 'c') { g.set(fx + 6, ay + 1, 'C'); }
}
function bearHead(g: Grid, x: number, y: number, mouth = false, down = 0) {
  g.ell(x + 4, y + 4, 4.4, 3.8, 'c'); g.rect(x + 6, y + 4, 5, 3, 'C'); g.rect(x + 6, y + 4, 4, 2, 'c'); g.rect(x + 5, y + 6, 6, 1, 'C');
  g.rect(x + 10, y + 4, 2, 2, 'n'); g.set(x + 10, y + 5, 'n');
  g.rect(x + 1, y - 1, 3, 2, 'C'); g.set(x + 2, y, 'u');            // ear
  g.set(x + 6, y + 3, 'n'); g.set(x + 7, y + 3, 'n');                  // eye
  if (mouth) { g.rect(x + 6, y + 6, 5, 2, 'n'); g.rect(x + 7, y + 6, 3, 1, 'r'); g.set(x + 7, y + 5, 'w'); g.set(x + 10, y + 5, 'w'); }
  void down;
}
function bearRows(p: { g: Gait; dy?: number; headDx?: number; headDy?: number; mouth?: boolean }): Rows {
  const G = new Grid(34, 20), dy = p.dy ?? p.g.dy, hdx = p.headDx ?? 0, hdy = p.headDy ?? 0;
  const gnd = 19;
  bearLeg(G, 22, 10 + dy, 21 + p.g.fF[0] * 1, gnd, p.g.fF[1], 'U', 'u');
  bearLeg(G, 6, 10 + dy, 5 + p.g.fH[0], gnd, p.g.fH[1], 'U', 'u');
  bearBody(G, 3, 3 + dy, 25, 11);
  bearLeg(G, 24, 10 + dy, 23 + p.g.nF[0], gnd, p.g.nF[1], 'C', 'c');
  bearLeg(G, 8, 10 + dy, 7 + p.g.nH[0], gnd, p.g.nH[1], 'C', 'c');
  G.rect(1, 4 + dy, 3, 3, 'C');                                      // tail stub
  bearHead(G, 24 + hdx, 2 + hdy + dy, p.mouth);
  return G.rows();
}
const BSTAND = (): Gait => ({ nF: [0, 0], nH: [0, 0], fF: [-1, 0], fH: [-1, 0], dy: 0 });
reg('bear', 'idle', 2, BEARP, f => bearRows({ g: BSTAND(), headDy: f }));
reg('bear', 'walk', 4, BEARP, f => bearRows({ g: gait(f / 4, 3, 2, 'walk'), dy: f % 2 ? -1 : 0, headDy: f % 2 }));
reg('bear', 'sniff', 3, BEARP, f => bearRows({ g: gait(f / 3 * 0.5, 2, 1, 'walk'), headDx: 2, headDy: 6 + (f % 2), dy: 1 }));
reg('bear', 'charge', 4, BEARP, f => bearRows({ g: gait(f / 4, 6, 5, 'run'), headDx: 2, headDy: 1, mouth: f % 2 === 1 }));
reg('bear', 'sleep', 2, BEARP, f => {
  const G = new Grid(34, 14);
  bearBody(G, 2, 3, 28, 11); G.rect(4, 11, 9, 3, 'U');
  G.ell(27, 9, 4.2, 3.4, 'c'); G.rect(27, 9, 5, 3, 'C'); G.rect(31, 9, 2, 2, 'n'); G.set(27, 8, f ? 'C' : 'n'); G.set(28, 8, f ? 'C' : 'n');
  G.rect(24, 5, 3, 2, 'C');
  G.rect(22, 11, 8, 3, 'c'); G.set(29, 13, 'n');
  return G.rows();
});
reg('bear', 'dead', 1, BEARP, () => {
  const G = new Grid(34, 14);
  bearBody(G, 2, 4, 28, 10); G.ell(30, 10, 3.6, 3, 'c'); G.rect(30, 10, 3, 2, 'C'); G.set(31, 9, 'n'); G.rect(10, 12, 5, 2, 'U'); G.rect(20, 12, 5, 2, 'U');
  return G.rows();
});
// rearing: upright on hind legs, arms up (frame 0 = rising, 1 = full height), swipe: one paw sweeps down in front
function bearUpright(armPose: number, mouth: boolean): Rows {
  const G = new Grid(26, 30);
  G.ell(11, 18, 6.2, 8.4, 'C');
  for (let j = 0; j < 30; j++) for (let i = 0; i < 26; i++) { if (G.get(i, j) === 'C') { const ny = (j - 18) / 8.4, nx = (i - 11) / 6.2; G.set(i, j, nx > 0.45 ? 'c' : ny > 0.5 ? 'u' : ny < -0.4 ? 'c' : (i + j) % 9 === 0 ? 'c' : 'C'); } }
  // hind legs / feet
  G.rect(5, 24, 5, 6, 'C'); G.rect(11, 24, 5, 6, 'c'); G.rect(4, 28, 7, 2, 'u'); G.rect(11, 28, 8, 2, 'c'); G.set(18, 29, 'n'); G.set(10, 29, 'n');
  // head
  bearHead(G, 10, 2, mouth);
  // arms
  const arm = (x0: number, y0: number, x1: number, y1: number, col: string) => { for (let k = 0; k < 4; k++) G.line(x0 + k, y0, x1 + k, y1, col); G.rect(x1 - 1, y1 - 1, 6, 4, col === 'c' ? 'c' : 'C'); G.set(x1 + 3, y1 + 1, 'n'); G.set(x1 + 4, y1 + 2, 'n'); };
  if (armPose === 0) { arm(8, 12, 4, 8, 'C'); arm(14, 12, 19, 8, 'c'); }             // raised out to the sides
  else if (armPose === 1) { arm(8, 12, 3, 9, 'C'); arm(14, 12, 20, 6, 'c'); }
  else { arm(8, 12, 5, 16, 'C'); arm(14, 12, 21, 18, 'c'); }                          // swipe: far arm down-forward
  return G.rows();
}
reg('bear', 'rear', 2, BEARP, f => bearUpright(f, f === 1));
reg('bear', 'swipe', 3, BEARP, f => bearUpright(f === 0 ? 1 : 2, true));

// ---- state resolution & selection -----------------------------------------------------------------------------------------------------
const ALIAS: Record<string, string> = { flee: 'run', hurt: 'run', chase: 'run', eat: 'sniff', dig: 'sniff', peck: 'sniff', stalk: 'walk', swim: 'idle', sleeping: 'sleep', lie: 'lie' };
export function resolveState(kind: string, state: string): string {
  const R = REG[kind]; if (!R) return state;
  if (R[state]) return state;
  const a = ALIAS[state]; if (a && R[a]) return a;
  if (kind === 'seal' && (state === 'idle' || state === 'sleep')) return 'lie';
  return R.idle ? 'idle' : Object.keys(R)[0];
}
export const KIND_FALLBACK: Record<string, string> = { hare: 'fox', wolf: 'dog' };
/** Which frame of which state to show. dist = x*face (distance-driven gaits), t seconds. */
export function pickFrame(kind: string, state: string, dist: number, t: number, id: number, speed: number): { state: string; f: number } {
  const st = resolveState(kind, state);
  const n = frameCount(kind, st);
  let f = 0;
  if (st === 'walk' || st === 'run' || st === 'charge') {
    const stride = st === 'walk' ? (kind === 'bear' ? 20 : kind === 'ptarmigan' ? 6 : 10) : (kind === 'bear' ? 34 : 18);
    f = speed > 1 ? Math.floor((((dist / stride) % 1) + 1) % 1 * n) : Math.floor(t * 4 + id) % n;
  } else if (st === 'fly') f = Math.floor(t * 14 + id) % n;
  else if (st === 'bark') f = Math.floor(t * 5 + id) % 2;
  else if (st === 'sniff') f = Math.floor(t * 3 + id) % n;
  else if (st === 'swipe') f = Math.min(n - 1, Math.floor((t % 0.6) / 0.2));
  else if (st === 'dive') f = Math.min(n - 1, Math.floor((t % 1.2) / 0.4));
  else if (n > 1) f = Math.floor(t * (st === 'sleep' ? 0.7 : st === 'idle' ? 1.6 : 2) + id) % n;
  return { state: st, f };
}
export function clearAnimalCache() { cache.clear(); }
void compose;
