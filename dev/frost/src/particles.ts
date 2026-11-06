// Particle store (struct of arrays). Positions in cells (float), velocities in cells/s.
// Owner of simulation: sim.ts (stepParticles). Renderer reads P.* for i < P.n.
export const enum PK {
  FLAKE = 0,   // falling snowflake, carries mass m (cells of fresh snow)
  DRIFT = 1,   // wind-blown snow grain (saltation/suspension), carries 1 cell of snow, d = density
  CLUMP = 2,   // thrown snow clump, carries 1 cell, d = density
  SPARK = 3,   // fire ember
  SMOKE = 4,
  STEAM = 5,
  CHIP = 6,    // wood chip
  BREATH = 7,  // exhaled vapour
  FLAME = 8,
  DUST = 9,    // fine snow dust from impacts/digging (no mass)
}
export const PMAX = 24000;
export const P = {
  n: 0,
  x: new Float32Array(PMAX), y: new Float32Array(PMAX),
  vx: new Float32Array(PMAX), vy: new Float32Array(PMAX),
  life: new Float32Array(PMAX),   // seconds left
  life0: new Float32Array(PMAX),  // initial life
  m: new Float32Array(PMAX),      // mass (cells) for FLAKE; size multiplier for others
  d: new Uint16Array(PMAX),       // density for DRIFT/CLUMP
  kind: new Uint8Array(PMAX),
  layer: new Uint8Array(PMAX),    // 0 = in world plane (collides), 1 = background flake, 2 = foreground flake (decor)
  seed: new Float32Array(PMAX),   // 0..1 random per particle (flutter phase, size jitter)
};

export function spawn(kind: number, x: number, y: number, vx: number, vy: number, life: number, m = 1, d = 0, layer = 0): number {
  if (P.n >= PMAX) return -1;
  const i = P.n++;
  P.x[i] = x; P.y[i] = y; P.vx[i] = vx; P.vy[i] = vy; P.life[i] = life; P.life0[i] = life;
  P.m[i] = m; P.d[i] = d; P.kind[i] = kind; P.layer[i] = layer; P.seed[i] = Math.random();
  return i;
}
/** Remove particle i by swapping with the last one. Caller must not advance i after kill. */
export function kill(i: number) {
  const j = --P.n;
  if (i === j) return;
  P.x[i] = P.x[j]; P.y[i] = P.y[j]; P.vx[i] = P.vx[j]; P.vy[i] = P.vy[j]; P.life[i] = P.life[j]; P.life0[i] = P.life0[j];
  P.m[i] = P.m[j]; P.d[i] = P.d[j]; P.kind[i] = P.kind[j]; P.layer[i] = P.layer[j]; P.seed[i] = P.seed[j];
}
