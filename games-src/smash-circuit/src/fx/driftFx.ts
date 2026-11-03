// Drift and speed visuals: boost-tier sparks from the rear wheels while drifting (blue / orange / purple), a flame burst
// behind the car during the exit boost, and ground streaks around the player at speed (world-fixed specks stream past
// the car, so speed reads from straight above even on plain tarmac). Reads car state only.
import { CONFIG } from '../config';
import { wheelLayout, type CarPose } from '../render/car';
import type { ParticleSystem } from './particles';

const CR = CONFIG.render.car;
const DF = CONFIG.render.driftFx;

export class DriftFx {
  private acc: Float32Array;
  private seed = 1357;

  constructor(private sparks: ParticleSystem, private smoke: ParticleSystem, carCount: number) {
    this.acc = new Float32Array(carCount * 3);
  }

  private rnd(a: number, b: number): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return a + (b - a) * (this.seed / 4294967296);
  }

  /** i = car index, share = particle budget (0 on low quality), essential = budget that stays on low. */
  update(i: number, P: CarPose, dt: number, isPlayer: boolean, share: number, essential: number): void {
    const st = P.state;
    const cos = Math.cos(P.angle), sin = Math.sin(P.angle);
    const wx = (lx: number, lz: number): number => P.x + cos * lx - sin * lz;
    const wz = (lx: number, lz: number): number => P.y + sin * lx + cos * lz;
    const a = i * 3;
    const speed = Math.hypot(st.vx, st.vy);

    // ---- tier sparks from the rear wheels while drifting
    const tier = st.driftActive ? (st.driftTier ?? 0) : 0;
    if (tier > 0) {
      this.acc[a] += dt * DF.sparkRate[tier - 1] * Math.max(essential, 0.5);
      const col = DF.tierColors[tier - 1];
      while (this.acc[a] >= 1) {
        this.acc[a] -= 1;
        const side = this.rnd(0, 1) > 0.5 ? 1 : -1;
        const rw = wheelLayout(st.modelId)[2];
        const lx = rw.x - 0.1, lz = side * Math.abs(rw.z);
        this.sparks.spawn(wx(lx, lz), 0.2, wz(lx, lz), st.vx * 0.25 - cos * this.rnd(2, 5) + this.rnd(-1.5, 1.5), this.rnd(1, 3.5), st.vy * 0.25 - sin * this.rnd(2, 5) + this.rnd(-1.5, 1.5), {
          life: this.rnd(0.18, 0.38), size0: this.rnd(0.16, 0.28) * (0.8 + 0.15 * tier), size1: 0.04, color: col, alpha: 1, drag: 2, gravity: 10, mode: 1,
        });
      }
    } else this.acc[a] = 0;

    // ---- exit boost: a short flame jet from the back of the car in the tier colour
    const bt = st.driftBoostT ?? 0;
    if (bt > 0 && (st.driftBoostTier ?? 0) > 0) {
      this.acc[a + 1] += dt * DF.boostRate * Math.max(essential, 0.5);
      const col = DF.tierColors[(st.driftBoostTier ?? 1) - 1];
      while (this.acc[a + 1] >= 1) {
        this.acc[a + 1] -= 1;
        const lz = this.rnd(-0.5, 0.5), lx = -(st.length ?? CONFIG.car.length) / 2 - 0.2;
        this.sparks.spawn(wx(lx, lz), 0.5, wz(lx, lz), st.vx * 0.55 - cos * this.rnd(4, 8), this.rnd(0.2, 1), st.vy * 0.55 - sin * this.rnd(4, 8), {
          life: this.rnd(0.14, 0.3), size0: this.rnd(0.45, 0.8), size1: 0.1, color: this.rnd(0, 1) > 0.4 ? col : 0xffffff, alpha: 0.95, drag: 3, mode: 1,
        });
      }
    } else this.acc[a + 1] = 0;

    // ---- ground streaks at speed (player only): faint world-fixed specks around the car stream past it
    if (isPlayer && share > 0 && speed > DF.streakSpeed) {
      const k = Math.min(1, (speed - DF.streakSpeed) / (DF.streakFull - DF.streakSpeed));
      this.acc[a + 2] += dt * DF.streakRate * k * share;
      while (this.acc[a + 2] >= 1) {
        this.acc[a + 2] -= 1;
        // ahead and to the sides, so each speck has time to sweep past the car
        const lx = this.rnd(-4, 22), lz = this.rnd(-9, 9);
        if (Math.abs(lz) < 1.4 && lx > -3 && lx < 3) continue;
        this.smoke.spawn(wx(lx, lz), 0.08, wz(lx, lz), 0, 0, 0, {
          life: this.rnd(0.35, 0.6), size0: this.rnd(0.12, 0.2), size1: this.rnd(0.18, 0.3), color: 0xffffff, alpha: DF.streakAlpha * (0.5 + 0.5 * k), drag: 0,
        });
      }
    } else this.acc[a + 2] = 0;
  }
}
