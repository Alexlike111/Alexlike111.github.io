// Turns sim events and car state into visuals: debris, tyre smoke, dust, sparks, fire, confetti, skid marks.
import * as THREE from 'three';
import { CONFIG, type Quality } from '../config';
import { WHEEL_LIST, carColor, wheelLayout, type CarPose } from '../render/car';
import type { Materials } from '../render/materials';
import type { ThemePalette } from '../render/palette';
import { clamp, makeRng } from '../render/util';
import type { WallVisual } from '../render/structures';
import type { CarPart, DestructibleKind, PropType, SimEvent, TrackDef, ZoneId } from '../types';
import { DebrisPool } from './debris';
import { DriftFx } from './driftFx';
import { MATERIAL_FX, extraCount, materialOf, type FxMaterial } from './materials';
import { ParticleSystem } from './particles';
import { ShockwavePool } from './shockwave';
import { SkidMarks } from './skidmarks';

const FX = CONFIG.render.fx;
const CR = CONFIG.render.car;
const SPARK_COLORS = [0xffe27a, 0xffb02e, 0xff7a1a, 0xffffff];
const BOX_COLORS = [0xffe27a, 0x7ad9ff, 0xff7ac6, 0x9bff9c, 0xffffff];
const CONFETTI = [0xff4d4d, 0xffd23c, 0x3a9bff, 0x3ccf6e, 0xff7ac6, 0xffffff];
const PART_DIMS: Record<CarPart, [number, number, number]> = {
  bumperF: [0.5, 0.4, 1.7], bumperR: [0.5, 0.4, 1.7], hood: [1.35, 0.14, 1.55], doorL: [1.5, 0.36, 0.2], doorR: [1.5, 0.36, 0.2],
  spoiler: [0.62, 0.3, 1.8], mirrorL: [0.2, 0.12, 0.3], mirrorR: [0.2, 0.12, 0.3],
  wheelFL: [CR.wheelRadius * 2, CR.wheelWidth, CR.wheelRadius * 2], wheelFR: [CR.wheelRadius * 2, CR.wheelWidth, CR.wheelRadius * 2],
  wheelRL: [CR.wheelRadius * 2, CR.wheelWidth, CR.wheelRadius * 2], wheelRR: [CR.wheelRadius * 2, CR.wheelWidth, CR.wheelRadius * 2],
};
/** zone whose damage scorches a flying part */
const PART_ZONE: Record<CarPart, ZoneId> = {
  bumperF: 'front', bumperR: 'rear', hood: 'front', doorL: 'left', doorR: 'right', spoiler: 'rear', mirrorL: 'left', mirrorR: 'right',
  wheelFL: 'wheelFL', wheelFR: 'wheelFR', wheelRL: 'wheelRL', wheelRR: 'wheelRR',
};
const BURNT = 0x3a2f29;
const FLAME = [0xff8a1a, 0xffc93c, 0xff5a1a, 0xffe08a];
/** car-local (x forward, z left) corner of each wheel instance k (WHEEL_LIST order) */
const WHEEL_Z = [1, -1, 1, -1];

export interface FxContext {
  playerId: number;
  /** camera centre on the ground (x, z) and view radius in metres */
  camX: number; camZ: number; radius: number;
  addTrauma(t: number): void;
  carById(id: number): CarPose | undefined;
}

export class FxManager {
  readonly group = new THREE.Group();
  readonly debris: DebrisPool;
  readonly smoke: ParticleSystem;
  readonly sparks: ParticleSystem;
  readonly skids: SkidMarks;
  readonly rings: ShockwavePool;
  /** seconds of visual hit-stop left (fx time runs slowed); game code may also use this to freeze its own presentation */
  hitStopLeft = 0;
  private pal!: ThemePalette;
  private wallStyle: WallVisual = 'concrete';
  private rng = makeRng(2468);
  /** ambient particles (dust, tyre smoke, confetti): 0 on the low preset */
  private share = 1;
  /** sparks, damage smoke and fire keep a reduced budget even on low, so damage stays readable (REQUIREMENTS: smoke and sparks at low HP) */
  private essential = 1;
  private acc: Float32Array;
  /** boost / nitro flame emitter accumulators, one per car */
  private accFlame: Float32Array;
  /** hard-braking tyre smoke accumulators, one per car */
  private accBrake: Float32Array;
  /** trauma the breaks added lately (decays): bounds the shake of a cascade */
  private recentBreakTrauma = 0;
  /** drift tier sparks, exit boost jet, speed streaks (driftFx.ts) */
  private driftFx!: DriftFx;
  private tmpC = new THREE.Color();
  private tmpC2 = new THREE.Color();

  constructor(mats: Materials, private carCount = 8) {
    this.debris = new DebrisPool(mats);
    this.smoke = new ParticleSystem(CONFIG.render.particleCapacity, false, 0.72);
    this.sparks = new ParticleSystem(CONFIG.render.sparkCapacity, true, 0.15);
    this.driftFx = new DriftFx(this.sparks, this.smoke, carCount);
    this.skids = new SkidMarks(CONFIG.render.skidCapacity.high, carCount * 4);
    this.acc = new Float32Array(carCount * 6);
    this.accFlame = new Float32Array(carCount);
    this.accBrake = new Float32Array(carCount);
    this.rings = new ShockwavePool();
    this.group.add(this.skids.mesh, ...this.debris.meshes, this.rings.mesh, this.smoke.mesh, this.sparks.mesh);
  }

  setTheme(pal: ThemePalette, wallStyle: WallVisual): void {
    this.pal = pal; this.wallStyle = wallStyle;
    this.skids.setTint(pal.skid);
  }

  setQuality(level: Quality): void {
    const q = CONFIG.render.quality[level];
    this.share = q.particles;
    this.essential = Math.max(q.particles, q.essential);
    this.smoke.setShare(this.essential);
    this.sparks.setShare(this.essential);
    this.skids.setLimit(CONFIG.render.skidCapacity[level]);
  }

  clear(): void {
    this.debris.clear(); this.smoke.clear(); this.sparks.clear(); this.skids.clear(); this.rings.clear(); this.acc.fill(0); this.accFlame.fill(0); this.accBrake.fill(0); this.hitStopLeft = 0; this.recentBreakTrauma = 0;
  }

  private rnd(a: number, b: number): number { return a + (b - a) * this.rng(); }
  private pick<T>(list: T[]): T { return list[Math.floor(this.rng() * list.length)]; }

  // ------------------------------------------------------------------ one-shot helpers

  private puff(x: number, y: number, z: number, count: number, color: number, size: number, speed: number, up = 1.2, alpha = 0.7, dirx = 0, dirz = 0): void {
    if (this.share <= 0) return;
    const n = Math.max(1, Math.round(count * this.share));
    for (let i = 0; i < n; i++) {
      const a = this.rng() * Math.PI * 2, v = this.rnd(0.3, 1) * speed;
      this.smoke.spawn(x + this.rnd(-0.3, 0.3), y, z + this.rnd(-0.3, 0.3), Math.cos(a) * v + dirx, this.rnd(0.4, 1) * up, Math.sin(a) * v + dirz, {
        life: this.rnd(0.55, 1.0), size0: size * 0.5, size1: size * this.rnd(1.2, 1.9), color, alpha, drag: 2.2,
      });
    }
  }

  private sparkBurst(x: number, y: number, z: number, count: number, speed: number, dirx = 0, dirz = 0): void {
    const n = Math.max(1, Math.round(count * this.essential));
    for (let i = 0; i < n; i++) {
      const a = this.rng() * Math.PI * 2, v = this.rnd(0.35, 1) * speed;
      this.sparks.spawn(x, y, z, Math.cos(a) * v + dirx, this.rnd(2, 7), Math.sin(a) * v + dirz, {
        life: this.rnd(0.22, 0.5), size0: this.rnd(0.14, 0.26), size1: 0.04, color: this.pick(SPARK_COLORS), alpha: 1, drag: 1.4, gravity: 16, mode: 1,
      });
    }
  }

  /** sparks thrown in a fan around the travel direction (dirx, dirz) */
  private sparkFan(x: number, y: number, z: number, count: number, speed: number, dirx: number, dirz: number, spread = 0.95): void {
    const n = Math.max(2, Math.round(count * this.essential));
    const base = Math.hypot(dirx, dirz) > 0.5 ? Math.atan2(dirz, dirx) : this.rng() * Math.PI * 2;
    const wide = Math.hypot(dirx, dirz) > 0.5 ? spread : Math.PI;
    for (let i = 0; i < n; i++) {
      const a = base + (this.rng() * 2 - 1) * wide, v = this.rnd(0.45, 1) * speed;
      this.sparks.spawn(x, y, z, Math.cos(a) * v, this.rnd(2.5, 8), Math.sin(a) * v, {
        life: this.rnd(0.28, 0.62), size0: this.rnd(0.18, 0.34), size1: 0.05, color: this.pick(SPARK_COLORS), alpha: 1, drag: 1.2, gravity: 16, mode: 1,
      });
    }
  }

  /** bright additive flash + expanding ground ring on a heavy hit; the camera reads it as a punch */
  private punch(x: number, z: number, weight: number, ctx: FxContext, near: number): void {
    const w = clamp(weight, 0, 1);
    this.sparks.spawn(x, 0.9, z, 0, 0.3, 0, { life: 0.15, size0: 0.8 + w * 0.6, size1: 2.2 + w * 2.0, color: 0xfff1c2, alpha: 0.8, drag: 0, mode: 1 });
    this.sparks.spawn(x, 0.8, z, 0, 0.2, 0, { life: 0.09, size0: 0.5, size1: 1.3 + w, color: 0xffffff, alpha: 0.9, drag: 0, mode: 1 });
    this.rings.spawn(x, z, w, 0xffe2a0);
    if (w >= FX.hitStopMinStrength && near > 0.25) this.hitStopLeft = Math.max(this.hitStopLeft, FX.hitStopTime * (0.6 + 0.4 * w));
    void ctx;
  }

  /** size is multiplied by this.chunk (FX.debrisScale for structures, a bit less for props) */
  private chunk: number = FX.debrisScale;
  private debrisPiece(x: number, y: number, z: number, vx: number, vz: number, sx: number, sy: number, sz: number, color: number, life?: number, up?: [number, number]): void {
    const u = up ?? FX.debrisUp;
    const k = this.chunk;
    this.debris.spawn({
      x, y: y * Math.max(1, k * 0.8), z, vx: vx + this.rnd(-FX.debrisSpread, FX.debrisSpread) * 0.7, vy: this.rnd(u[0], u[1]) * 1.1, vz: vz + this.rnd(-FX.debrisSpread, FX.debrisSpread) * 0.7,
      sx: sx * k, sy: sy * k, sz: sz * k, color, life,
    });
  }

  private near(ctx: FxContext, x: number, z: number): number {
    return clamp(1 - Math.hypot(x - ctx.camX, z - ctx.camZ) / FX.shakeNearRadius, 0, 1);
  }

  // ------------------------------------------------------------------ events

  handleEvents(events: SimEvent[], ctx: FxContext): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'impact': {
          const s = clamp(ev.strength, 0, 1);
          const isPlayer = ev.carId === ctx.playerId;
          const near = this.near(ctx, ev.x, ev.y);
          ctx.addTrauma((isPlayer ? 1 : 0.5 * near) * s * CONFIG.render.camera.shakeFromImpact);
          const outside = Math.hypot(ev.x - ctx.camX, ev.y - ctx.camZ) < ctx.radius * 1.2;
          if (!outside) break;
          const car = ctx.carById(ev.carId);
          const dx = car ? car.state.vx : 0, dz = car ? car.state.vy : 0;
          const dl = Math.hypot(dx, dz) || 1;
          this.sparkFan(ev.x, 0.5, ev.y, 5 + s * 20, 6 + s * 10, dx / dl, dz / dl, 1.1);
          if (ev.other !== 'car') this.puff(ev.x, 0.4, ev.y, 2 + s * 5, this.dustColor(), 1.7 + s * 1.5, 2.8, 1.4, 0.8);
          else this.sparkBurst(ev.x, 0.6, ev.y, 3 + s * 10, 4 + s * 6);
          if (s >= 0.45) this.punch(ev.x, ev.y, s, ctx, isPlayer ? 1 : near);
          break;
        }
        case 'scrape': {
          if (Math.hypot(ev.x - ctx.camX, ev.y - ctx.camZ) > ctx.radius * 1.2) break;
          // metal on wall: a fan of sparks thrown along the car's travel, plus a few loose ones
          const car = ctx.carById(ev.carId);
          const vx = car ? car.state.vx : 0, vz = car ? car.state.vy : 0;
          const sp = Math.hypot(vx, vz);
          this.sparkFan(ev.x, 0.4, ev.y, FX.scrapeSparks * (0.4 + ev.strength), 3 + Math.min(12, sp * 0.4), sp > 1 ? vx / sp : 0, sp > 1 ? vz / sp : 0, 0.55);
          this.sparkBurst(ev.x, 0.35, ev.y, 1 + ev.strength * 3, 2.5 + ev.strength * 4);
          break;
        }
        case 'break': this.onBreak(ev, ctx); break;
        case 'partOff': this.onPartOff(ev, ctx); break;
        case 'wrecked': {
          const p = ctx.carById(ev.carId);
          if (p) { this.puff(p.x, 1.2, p.y, 8, 0x2a2a2f, 1.7, 3.5, 3); this.sparkBurst(p.x, 1, p.y, 12, 7); }
          if (ev.carId === ctx.playerId) ctx.addTrauma(0.4);
          break;
        }
        case 'repair': {
          const p = ctx.carById(ev.carId);
          if (!p) break;
          const n = Math.round(26 * this.essential);
          for (let i = 0; i < n; i++) {
            const a = this.rng() * Math.PI * 2, r = this.rnd(0.5, 1.9);
            this.sparks.spawn(p.x + Math.cos(a) * r, this.rnd(0.2, 0.8), p.y + Math.sin(a) * r, 0, this.rnd(2.5, 5), 0, {
              life: this.rnd(0.5, 0.9), size0: this.rnd(0.18, 0.3), size1: 0.05, color: this.pick([0x7dff9c, 0xffffff, 0xaef5ff]), alpha: 1, drag: 0.6, mode: 1,
            });
          }
          break;
        }
        case 'boost': this.onBoost(ev, ctx); break;
        case 'pickup': {
          if (Math.hypot(ev.x - ctx.camX, ev.y - ctx.camZ) > ctx.radius * 1.3) break;
          const n = Math.round(14 * this.essential);
          for (let i = 0; i < n; i++) {
            const a = this.rng() * Math.PI * 2, v = this.rnd(2, 6);
            this.sparks.spawn(ev.x, this.rnd(1, 2), ev.y, Math.cos(a) * v, this.rnd(1, 4), Math.sin(a) * v, {
              life: this.rnd(0.35, 0.65), size0: this.rnd(0.18, 0.3), size1: 0.05, color: this.pick(BOX_COLORS), alpha: 1, drag: 1.5, mode: 1,
            });
          }
          this.rings.spawn(ev.x, ev.y, 0.35, 0xffffff);
          break;
        }
        case 'itemUse': this.onItemUse(ev, ctx); break;
        case 'shieldPop': {
          this.rings.spawn(ev.x, ev.y, 0.7, CONFIG.items.fx.shieldColor, 5);
          this.sparkBurst(ev.x, 0.9, ev.y, 16, 8);
          if (ev.carId === ctx.playerId) ctx.addTrauma(0.25);
          break;
        }
        case 'oilSpin': {
          const near = this.near(ctx, ev.x, ev.y);
          this.puff(ev.x, 0.3, ev.y, 8, 0x2a2540, 2.4, 3.2, 1.0, 0.75);
          if (ev.carId === ctx.playerId) ctx.addTrauma(0.2); else ctx.addTrauma(0.1 * near);
          break;
        }
        case 'finish': {
          if (ev.carId !== ctx.playerId) break;
          const p = ctx.carById(ev.carId);
          if (!p) break;
          const n = Math.round(70 * this.share);
          for (let i = 0; i < n; i++) {
            const a = this.rng() * Math.PI * 2, v = this.rnd(3, 11);
            this.smoke.spawn(p.x, 1.5, p.y, Math.cos(a) * v, this.rnd(8, 16), Math.sin(a) * v, {
              life: this.rnd(1.2, 2.2), size0: this.rnd(0.22, 0.4), size1: 0.18, color: this.pick(CONFETTI), alpha: 1, drag: 1.2, gravity: 9, mode: 1,
            });
          }
          break;
        }
        default: break;
      }
    }
  }

  /** boost pad / nitro kick: ground ring + spark fan thrown backwards */
  private onBoost(ev: Extract<SimEvent, { type: 'boost' }>, ctx: FxContext): void {
    const X = CONFIG.items.fx;
    const near = this.near(ctx, ev.x, ev.y);
    if (near <= 0 && ev.carId !== ctx.playerId) return;
    const bx = -Math.cos(ev.angle), bz = -Math.sin(ev.angle);
    this.rings.spawn(ev.x, ev.y, 0.55, ev.source === 'pad' ? X.padColorA : X.nitroColor);
    this.sparkFan(ev.x, 0.5, ev.y, 18, 9, bx, bz, 0.5);
    this.puff(ev.x + bx * 2, 0.4, ev.y + bz * 2, 3, this.dustColor(), 2.0, 2.4, 1.0, 0.6, bx * 3, bz * 3);
  }

  private onItemUse(ev: Extract<SimEvent, { type: 'itemUse' }>, ctx: FxContext): void {
    const X = CONFIG.items.fx;
    const own = ev.carId === ctx.playerId;
    const near = this.near(ctx, ev.x, ev.y);
    if (!own && near <= 0) return;
    switch (ev.item) {
      case 'shockwave':
        this.rings.spawn(ev.x, ev.y, 1, 0xd9a0ff, CONFIG.items.shock.radius);
        this.rings.spawn(ev.x, ev.y, 0.8, 0xffffff, CONFIG.items.shock.radius * 0.6);
        this.sparkBurst(ev.x, 0.8, ev.y, 24, 11);
        this.puff(ev.x, 0.4, ev.y, 10, this.dustColor(), 3.0, 6.0, 1.2, 0.7);
        ctx.addTrauma(own ? 0.45 : 0.3 * near);
        break;
      case 'oil': {
        const bx = -Math.cos(ev.angle), bz = -Math.sin(ev.angle);
        this.puff(ev.x + bx * 3, 0.3, ev.y + bz * 3, 7, 0x2a2540, 2.2, 2.4, 0.8, 0.8);
        break;
      }
      case 'shield':
        this.rings.spawn(ev.x, ev.y, 0.6, X.shieldColor, 4.5);
        break;
      case 'nitro':
        this.rings.spawn(ev.x, ev.y, 0.5, X.nitroColor);
        break;
      default: break;   // repair: the sim also emits 'repair' (green sparks)
    }
  }

  /** dust colour brightened so the cloud reads against the ground */
  private dustColor(): number { return this.tmpC.setHex(this.pal.dust).lerp(this.tmpC2.setHex(0xffffff), 0.4).getHex(); }

  private onBreak(ev: Extract<SimEvent, { type: 'break' }>, ctx: FxContext): void {
    const x = ev.x, z = ev.y;
    const near = this.near(ctx, x, z);
    const sp = Math.hypot(ev.vx, ev.vy);
    const heavyKind = ev.kind === 'wall' || ev.kind === 'road';
    const strong = heavyKind || sp > FX.strongBreakSpeed;
    const weight = clamp(0.35 + sp / 26, 0.3, 1) * (heavyKind ? 1 : 0.85);
    const wantShake = (FX.shakeFromBreak[ev.kind] ?? 0.05) * (0.45 + 0.55 * weight) * near;
    const giveShake = Math.min(wantShake, Math.max(0, FX.breakShakeCap - this.recentBreakTrauma));   // a cascade shakes like one big hit
    this.recentBreakTrauma += giveShake;
    ctx.addTrauma(giveShake);
    const k = sp > 18 ? 18 / sp : 1;
    const vx = ev.vx * k * 0.55, vz = ev.vy * k * 0.55;
    const light = ev.kind === 'curb' || ev.kind === 'prop';
    const [lo, hi] = strong ? FX.breakPiecesStrong : light ? CONFIG.destruction.debrisPerBreak : FX.breakPieces;
    const n = lo + Math.floor(this.rng() * (hi - lo + 1));
    const cos = Math.cos(ev.angle), sin = Math.sin(ev.angle);
    this.chunk = ev.kind === 'prop' ? Math.min(FX.debrisScale, 1.2) : FX.debrisScale * (strong ? FX.strongScale : 1);
    for (let i = 0; i < n; i++) {
      const t = (n === 1 ? 0 : i / (n - 1) - 0.5) * Math.min(ev.w, 4);
      const px = x + cos * t, pz = z + sin * t;
      this.breakPiece(ev.kind, ev.propType, px, pz, vx, vz, ev, i);
    }
    this.chunk = FX.debrisScale;
    if (Math.hypot(x - ctx.camX, z - ctx.camZ) < ctx.radius * 1.25) {
      const mat = materialOf(ev.kind, ev.propType, this.wallStyle);
      const M = MATERIAL_FX[mat];
      const dust = M.dust ?? this.dustColor();
      const road = ev.kind === 'road';
      const dl = sp > 0.5 ? sp : 1;
      const dx = ev.vx / dl, dz = ev.vy / dl;
      if (road) {
        this.puff(x, 0.5, z, 9, 0x8a7d6c, 3.4, 3.6, 1.5, 0.85, ev.vx * 0.12, ev.vy * 0.12);
        this.puff(x, 0.4, z, 5, this.dustColor(), 3.0, 2.2, 1.0, 0.8);
      } else if (ev.kind === 'wall' || ev.kind === 'guardrail') {
        const [d0, d1] = FX.dustBurst;
        this.puff(x, 0.5, z, d0 + this.rng() * (d1 - d0), dust, 2.6 + weight, 3.4, 1.4, 0.85, ev.vx * 0.1, ev.vy * 0.1);
      } else this.puff(x, 0.4, z, light ? 2 : 3, dust, 1.7, 2.6, 1.2, 0.8);
      this.materialExtras(mat, x, z, vx, vz, strong ? 1 : 0.7);
      if (M.sparks > 0) this.sparkBurst(x, 0.7, z, M.sparks * (strong ? 1.5 : 1), 6 + weight * 4, dx * 3, dz * 3);
      if (heavyKind || ev.kind === 'guardrail') {
        const [f0, f1] = FX.sparkFan;
        this.sparkFan(x, 0.7, z, strong ? f0 + this.rng() * (f1 - f0) : f0 * 0.6, 7 + weight * 9, dx, dz);
      }
      if (strong) this.punch(x, z, weight, ctx, near);
    }
  }

  private breakPiece(kind: DestructibleKind, prop: PropType | undefined, x: number, z: number, vx: number, vz: number, ev: Extract<SimEvent, { type: 'break' }>, i: number): void {
    const pal = this.pal;
    const r = this.rng;
    switch (kind) {
      case 'wall':
      case 'guardrail': {
        const wall = kind === 'wall';
        if (this.wallStyle === 'concrete') {
          if (wall) this.debrisPiece(x, 0.7, z, vx, vz, this.rnd(0.7, 1.1), this.rnd(0.35, 0.6), this.rnd(0.6, 0.9), i % 2 ? 0xe8383a : 0xd9dde5);
          else this.debrisPiece(x, 0.7, z, vx, vz, i === 0 ? 1.8 : 0.5, 0.14, i === 0 ? 0.3 : 0.5, i === 0 ? 0xdfe6f0 : 0x7d8594);
        } else if (this.wallStyle === 'jersey') {
          this.debrisPiece(x, 0.7, z, vx, vz, this.rnd(0.7, 1.1), this.rnd(0.35, 0.55), this.rnd(0.5, 0.8), i % 2 ? 0x5a6a80 : 0xf4f8fc);
        } else if (this.wallStyle === 'tires') {
          this.debrisPiece(x, 0.7, z, vx, vz, 0.8, 0.42, 0.8, i % 2 ? 0x2a2d35 : (r() > 0.5 ? 0xe8383a : 0xf6f6f2), undefined, [6, 11]);
        } else {
          this.debrisPiece(x, 0.7, z, vx, vz, this.rnd(1.1, 1.7), 0.14, this.rnd(0.18, 0.28), i % 2 ? 0xb97e45 : (wall ? 0xe8383a : 0xd9a064));
        }
        break;
      }
      case 'curb': this.debrisPiece(x, 0.3, z, vx, vz, this.rnd(0.5, 0.9), 0.16, this.rnd(0.4, 0.6), i % 2 ? 0xe8383a : 0xf6f6f2); break;
      case 'road': {
        if (i === 0) this.debrisPiece(x, 0.4, z, vx * 0.3, vz * 0.3, Math.min(ev.w, 3.4), 0.24, Math.min(ev.h, 2.5), pal.road, 2.0, [9, 13]);
        else this.debrisPiece(x, 0.4, z, vx, vz, this.rnd(0.6, 1.1), 0.18, this.rnd(0.5, 0.9), i % 2 ? pal.road : 0x6b6256, undefined, [7, 11]);
        break;
      }
      case 'prop': {
        switch (prop) {
          case 'cone': this.debrisPiece(x, 0.4, z, vx, vz, 0.28, this.rnd(0.2, 0.45), 0.28, i % 2 ? 0xff7a1a : 0xffffff); break;
          case 'barrel': this.debrisPiece(x, 0.5, z, vx, vz, this.rnd(0.4, 0.8), this.rnd(0.3, 0.5), 0.5, i % 2 ? 0xe03b3b : 0xf3f3f3); break;
          case 'crate': this.debrisPiece(x, 0.5, z, vx, vz, this.rnd(0.6, 1.0), 0.14, 0.22, i % 2 ? 0xd6a15a : 0x9b6a34); break;
          case 'tireStack': this.debrisPiece(x, 0.5, z, vx, vz, 0.8, 0.36, 0.8, i % 2 ? 0x2a2d35 : (r() > 0.5 ? 0xe8383a : 0xf6f6f2)); break;
          case 'sign': this.debrisPiece(x, 1, z, vx, vz, i === 0 ? 0.9 : 0.12, i === 0 ? 0.9 : 1.4, i === 0 ? 0.08 : 0.12, i === 0 ? 0xffd23c : 0x8f98a6); break;
          case 'tree': this.debrisPiece(x, 1.2, z, vx, vz, this.rnd(1.0, 1.7), this.rnd(0.8, 1.3), this.rnd(1.0, 1.7), i === 0 ? pal.trunk : pal.foliage[i % pal.foliage.length]); break;
          case 'rock': this.debrisPiece(x, 0.6, z, vx * 0.5, vz * 0.5, this.rnd(0.6, 1.1), this.rnd(0.5, 0.8), this.rnd(0.6, 1.0), i % 2 ? pal.rock : pal.rockDark, undefined, [4, 8]); break;
          case 'hayBale': this.debrisPiece(x, 0.5, z, vx, vz, this.rnd(0.6, 1.0), this.rnd(0.3, 0.5), this.rnd(0.4, 0.7), i % 2 ? 0xeccb55 : 0xb98a2b); break;
          default: this.debrisPiece(x, 0.5, z, vx, vz, 0.5, 0.4, 0.5, 0xcccccc);
        }
        break;
      }
    }
  }

  /**
   * Material flavour on top of the normal 2-3 debris chunks (which stay the only debris-pool pieces of a break): flecks thrown from
   * the break in the material's colours, drawn as small solid particles from the pooled smoke system (so they follow the quality
   * preset's particle share and the pool cap, and never touch the debris budget). Wood and straw throw splinters, concrete / stone /
   * tarmac pebbles, plastic bright shards, rubber dark crumbs, foliage leaves.
   */
  private materialExtras(mat: FxMaterial, x: number, z: number, vx: number, vz: number, power: number): void {
    const M = MATERIAL_FX[mat];
    if (this.share <= 0) return;
    const sp = this.share * power;
    const fling = (n: number, size: number, up: [number, number], side: number, life: number, grav: number): void => {
      for (let i = 0; i < n * 3; i++) {
        const a = this.rng() * Math.PI * 2, v = this.rnd(0.4, 1) * side;
        this.smoke.spawn(
          x + this.rnd(-0.4, 0.4), 0.5 + this.rnd(0, 0.4), z + this.rnd(-0.4, 0.4),
          vx * 0.8 + Math.cos(a) * v, this.rnd(up[0], up[1]), vz * 0.8 + Math.sin(a) * v,
          { life: this.rnd(life * 0.7, life), size0: size * this.rnd(0.8, 1.25), size1: size * 0.5, color: this.pick(M.colors), alpha: 1, drag: 0.5, gravity: grav, mode: 1 },
        );
      }
    };
    fling(extraCount(M.splinters, sp, this.rng()), 0.2, [5, 10], 7, 0.9, 22);
    fling(extraCount(M.pebbles, sp, this.rng()), 0.26, [4, 8], 8, 0.8, 24);
    fling(extraCount(M.shards, sp, this.rng()), 0.22, [4, 9], 7, 0.85, 20);
  }

  private onPartOff(ev: Extract<SimEvent, { type: 'partOff' }>, ctx: FxContext): void {
    const p = ctx.carById(ev.carId);
    const d = PART_DIMS[ev.part];
    const wheel = WHEEL_LIST.includes(ev.part as typeof WHEEL_LIST[number]);
    let color = 0xffffff;
    if (!wheel) {
      // the panel keeps the car's paint, scorched as badly as its zone was
      const st = p?.state;
      const loss = st ? 1 - clamp(st.hp[PART_ZONE[ev.part]] / (st.zoneMaxHp || 100), 0, 1) : 0.5;
      color = this.tmpC.setHex(p ? carColor(st!.colorIndex) : 0xcccccc).lerp(this.tmpC2.setHex(BURNT), clamp(loss * 0.5, 0, FX.dirtMax)).getHex();
    }
    const sp = Math.hypot(ev.vx, ev.vy);
    const k = sp > 22 ? 22 / sp : 1;
    const big = d[0] * d[2] > 0.5;   // hood, doors, bumpers, spoiler, wheels: thrown high and spinning
    this.debris.spawn({
      x: ev.x, y: 0.9, z: ev.y, vx: ev.vx * k, vy: big ? this.rnd(6, 10) : this.rnd(4, 7), vz: ev.vy * k,
      sx: d[0], sy: d[1], sz: d[2], color, life: CR.partDebrisLife, spin: wheel ? 1.1 : 0.9, shape: wheel ? 'wheel' : 'panel',
      rot: [0, -(p ? p.angle : Math.atan2(ev.vy, ev.vx)), 0],
    });
    if (Math.hypot(ev.x - ctx.camX, ev.y - ctx.camZ) < ctx.radius * 1.3) {
      this.sparkBurst(ev.x, 0.8, ev.y, 14, 8);
      this.puff(ev.x, 0.7, ev.y, 3, 0x6b6b70, 1.6, 2.4, 1.4, 0.75);
    }
    ctx.addTrauma((ev.carId === ctx.playerId ? 0.16 : 0.08) * this.near(ctx, ev.x, ev.y));
  }

  // ------------------------------------------------------------------ continuous car effects

  /** Emit smoke / dust / sparks / fire and skid marks for the cars near the camera. */
  updateCars(poses: CarPose[], dt: number, ctx: FxContext): void {
    const pal = this.pal;
    const range = ctx.radius * FX.emitRange + 6;
    for (let i = 0; i < poses.length; i++) {
      const P = poses[i], st = P.state;
      const cos = Math.cos(P.angle), sin = Math.sin(P.angle);
      const wx = (lx: number, lz: number): number => P.x + cos * lx - sin * lz;
      const wz = (lx: number, lz: number): number => P.y + sin * lx + cos * lz;
      const inRange = Math.hypot(P.x - ctx.camX, P.y - ctx.camZ) < range;
      const speed = Math.abs(st.speed);
      // cars plough through the parts lying on the road (visual only)
      if (inRange && this.debris.active > 0) this.debris.kick(P.x, P.y, st.vx, st.vy, FX.debrisKickRadius);

      // ---- skid marks (also keeps trails closed when out of range)
      const slideMark = st.slip > FX.skidSlip || (st.handbrake && speed > 6) || (st.brake > 0.85 && speed > 14);
      const k0 = i * 4;
      const intensity = inRange && slideMark && !st.offRoad ? clamp(Math.max(st.slip, st.handbrake ? 0.7 : 0, st.brake > 0.85 ? 0.45 : 0), 0, 1) : 0;
      const WL = wheelLayout(st.modelId);   // the model's own wheels (FL, FR, RL, RR)
      this.skids.mark(k0 + 2, wx(WL[2].x, WL[2].z), wz(WL[2].x, WL[2].z), intensity);
      this.skids.mark(k0 + 3, wx(WL[3].x, WL[3].z), wz(WL[3].x, WL[3].z), intensity);
      const frontI = intensity > 0 && st.slip > 0.65 ? intensity * 0.8 : 0;
      this.skids.mark(k0 + 0, wx(WL[0].x, WL[0].z), wz(WL[0].x, WL[0].z), frontI);
      this.skids.mark(k0 + 1, wx(WL[1].x, WL[1].z), wz(WL[1].x, WL[1].z), frontI);
      if (!inRange) continue;
      this.driftFx.update(i, P, dt, st.id === ctx.playerId, this.share, this.essential);

      const a = i * 6;
      // ---- tyre smoke while sliding
      if (this.share > 0 && st.slip > FX.skidSlip && speed > 5) {
        this.acc[a] += dt * (22 + 60 * st.slip) * this.share;
        while (this.acc[a] >= 1) {
          this.acc[a] -= 1;
          const side = this.rng() > 0.5 ? 1 : -1;
          const lx = WL[2].x, lz = side * Math.abs(WL[2].z);
          this.smoke.spawn(wx(lx, lz), 0.25, wz(lx, lz), st.vx * 0.15 + this.rnd(-0.6, 0.6), this.rnd(0.5, 1.3), st.vy * 0.15 + this.rnd(-0.6, 0.6), {
            life: this.rnd(0.5, 0.95), size0: 0.5, size1: this.rnd(1.7, 2.6), color: pal.dust === 0xffffff ? 0xf2f6fb : 0xf0f0f0, alpha: 0.5, drag: 2.0,
          });
        }
      } else this.acc[a] = 0;

      // ---- hard braking: the front tyres smoke
      if (this.share > 0 && st.brake > 0.85 && speed > FX.brakeSmokeSpeed && !st.offRoad && st.slip <= FX.skidSlip) {
        this.accBrake[i] += dt * (16 + clamp((speed - FX.brakeSmokeSpeed) / 20, 0, 1) * 34) * this.share;
        while (this.accBrake[i] >= 1) {
          this.accBrake[i] -= 1;
          const w = WL[this.rng() > 0.5 ? 0 : 1];
          this.smoke.spawn(wx(w.x, w.z), 0.25, wz(w.x, w.z), st.vx * 0.2 + this.rnd(-0.5, 0.5), this.rnd(0.4, 1.0), st.vy * 0.2 + this.rnd(-0.5, 0.5), {
            life: this.rnd(0.4, 0.8), size0: 0.4, size1: this.rnd(1.3, 2.0), color: 0xeef0f3, alpha: 0.4, drag: 2.2,
          });
        }
      } else this.accBrake[i] = 0;

      // ---- off-road dust / snow spray
      if (this.share > 0 && st.offRoad && speed > 6) {
        this.acc[a + 1] += dt * (18 + speed * 1.1) * this.share;
        while (this.acc[a + 1] >= 1) {
          this.acc[a + 1] -= 1;
          const side = this.rng() > 0.5 ? 1 : -1;
          const lx = WL[2].x, lz = side * Math.abs(WL[2].z);
          this.smoke.spawn(wx(lx, lz), 0.3, wz(lx, lz), st.vx * -0.05 + this.rnd(-1.4, 1.4), this.rnd(0.9, 2.2), st.vy * -0.05 + this.rnd(-1.4, 1.4), {
            life: this.rnd(0.5, 1.0), size0: 0.5, size1: this.rnd(1.6, 2.8), color: pal.dust, alpha: 0.65, drag: 1.6,
          });
        }
      } else this.acc[a + 1] = 0;

      // ---- damage smoke: thin white wisps from moderate damage (health < wispBelow), dark smoke below smokeBelow
      const h = st.health;
      const base = h < FX.smokeBelow ? 0.15 + 0.85 * clamp((FX.smokeBelow - h) / FX.smokeBelow, 0, 1)
        : h < FX.wispBelow ? 0.15 * (FX.wispBelow - h) / (FX.wispBelow - FX.smokeBelow) : 0;
      // a smashed end steams on its own (radiator / exhaust), even while total health is still high
      const zm = st.zoneMaxHp || 100;
      const endLoss = 1 - Math.min(st.hp.front, st.hp.engine, st.hp.rear) / zm;
      const steam = endLoss > FX.steamFromLoss ? 0.1 + 0.25 * (endLoss - FX.steamFromLoss) / (1 - FX.steamFromLoss) : 0;
      const dmg = Math.max(st.effects.smoke, base, steam);
      if (dmg > 0.02) {
        // near-wreck: the plume stays small and see-through over the body so the car itself remains readable (alpha capped at smokeAlphaMax)
        const wreck = clamp((FX.wreckSmokeBelow - h) / FX.wreckSmokeBelow, 0, 1);
        const sizeK = clamp(0.6 + dmg * 3, 0.6, 1) * (1 - FX.wreckSmokeShrink * wreck);
        this.acc[a + 2] += dt * (2.2 + 26 * dmg * (1 - 0.35 * wreck)) * this.essential;
        while (this.acc[a + 2] >= 1) {
          this.acc[a + 2] -= 1;
          const col = this.tmpC.setHex(0xf0f2f5).lerp(this.tmpC2.setHex(0x23242a), clamp(dmg * 1.3 - 0.1, 0, 1));
          const sx = this.smokeEnd(st);
          this.smoke.spawn(wx(sx, this.rnd(-0.4, 0.4)), 1.0, wz(sx, this.rnd(-0.4, 0.4)), st.vx * 0.3 + this.rnd(-0.5, 0.5), this.rnd(1.6, 3), st.vy * 0.3 + this.rnd(-0.5, 0.5), {
            life: this.rnd(0.8, 1.4), size0: (0.4 + dmg * 0.2) * sizeK, size1: (1.3 + dmg * 0.9) * sizeK, color: col.getHex(), alpha: Math.min(FX.smokeAlphaMax, 0.4 + 0.2 * clamp(dmg * 3, 0, 1)), drag: 0.8,
          });
        }
      } else this.acc[a + 2] = 0;

      // ---- scraping sparks
      if (st.effects.sparks > 0.05 && speed > 6) {
        this.acc[a + 3] += dt * (8 + 22 * st.effects.sparks) * this.essential;
        while (this.acc[a + 3] >= 1) {
          this.acc[a + 3] -= 1;
          const lx = this.rnd(-1.8, 1.8), lz = (this.rng() > 0.5 ? 1 : -1) * 1.0;
          this.sparks.spawn(wx(lx, lz), 0.35, wz(lx, lz), this.rnd(-3, 3), this.rnd(1.5, 4), this.rnd(-3, 3), {
            life: this.rnd(0.18, 0.4), size0: this.rnd(0.12, 0.2), size1: 0.03, color: this.pick(SPARK_COLORS), alpha: 1, drag: 1, gravity: 14, mode: 1,
          });
        }
      } else this.acc[a + 3] = 0;

      // ---- fire at critical health (grows to full at a wreck): flames licking out of the engine end, black smoke above
      const fire = st.wrecked ? 1 : h < FX.fireBelow ? 0.35 + 0.65 * (FX.fireBelow - h) / FX.fireBelow : 0;
      if (fire > 0) {
        this.acc[a + 4] += dt * (10 + 26 * fire) * Math.max(this.essential, FX.fireMinShare);   // a burning car must read even on low
        const fx0 = this.smokeEnd(st);
        const lo = fx0 > 0 ? 0.7 : -1.9, hi = fx0 > 0 ? 1.9 : -0.7;
        while (this.acc[a + 4] >= 1) {
          this.acc[a + 4] -= 1;
          const lx = this.rnd(lo, hi), lz = this.rnd(-0.55, 0.55);
          this.sparks.spawn(wx(lx, lz), 1.0, wz(lx, lz), st.vx * 0.5 + this.rnd(-0.6, 0.6), this.rnd(2, 4) * (0.7 + 0.5 * fire), st.vy * 0.5 + this.rnd(-0.6, 0.6), {
            life: this.rnd(0.35, 0.65), size0: this.rnd(0.5, 0.85) * (0.7 + 0.5 * fire), size1: 0.12, color: this.pick(FLAME), alpha: 0.9, drag: 1.2, mode: 1,
          });
          if (this.rng() < 0.3) {   // small, high black puffs: the wreck under them stays readable (same shrink as the damage plume)
            const shrink = 1 - FX.wreckSmokeShrink * clamp((FX.wreckSmokeBelow - h) / FX.wreckSmokeBelow, 0, 1);
            this.smoke.spawn(wx(lx, lz), 1.6, wz(lx, lz), st.vx * 0.3 + this.rnd(-0.4, 0.4), this.rnd(2.2, 3.4), st.vy * 0.3 + this.rnd(-0.4, 0.4), {
              life: this.rnd(0.8, 1.3), size0: 0.4 * shrink, size1: this.rnd(1.1, 1.5) * shrink, color: 0x18181c, alpha: FX.smokeAlphaMax, drag: 0.8,
            });
          }
        }
      } else this.acc[a + 4] = 0;

      // ---- boost / nitro flames out of the exhaust
      if ((st.boostT ?? 0) > 0 || (st.nitroT ?? 0) > 0) {
        const nitro = (st.nitroT ?? 0) > 0;
        this.accFlame[i] += dt * (nitro ? 90 : 60) * this.essential;
        while (this.accFlame[i] >= 1) {
          this.accFlame[i] -= 1;
          const lz = this.rng() > 0.5 ? 0.5 : -0.5, lx = -2.25;
          const hot = this.rng();
          this.sparks.spawn(wx(lx, lz), 0.55, wz(lx, lz), st.vx * 0.55 - cos * this.rnd(3, 8), this.rnd(0.2, 0.9), st.vy * 0.55 - sin * this.rnd(3, 8), {
            life: this.rnd(0.14, 0.3), size0: this.rnd(0.35, 0.55), size1: 0.06, alpha: 0.9, drag: 1.2, mode: 1,
            color: nitro ? (hot > 0.6 ? 0xffe27a : hot > 0.2 ? 0xff9a2a : 0xff5a1a) : (hot > 0.55 ? 0xd9fbff : 0x4cf2ff),
          });
        }
      } else this.accFlame[i] = 0;

      // ---- a lost wheel: the hub drags on the tarmac and throws a stream of sparks
      if (st.detachedParts.length && speed > 3) {
        this.acc[a + 5] += dt * FX.hubSparks * clamp(speed / 15, 0.4, 1.3) * Math.max(this.essential, FX.fireMinShare);
        while (this.acc[a + 5] >= 1) {
          this.acc[a + 5] -= 1;
          let k = Math.floor(this.rng() * 4);
          for (let t = 0; t < 4 && !st.detachedParts.includes(WHEEL_LIST[k]); t++) k = (k + 1) % 4;
          if (!st.detachedParts.includes(WHEEL_LIST[k])) break;
          const lx = WL[k].x, lz = WL[k].z + WHEEL_Z[k] * 0.1;
          this.sparks.spawn(wx(lx, lz), 0.15, wz(lx, lz), st.vx * 0.55 + this.rnd(-2.5, 2.5), this.rnd(1.5, 4.5), st.vy * 0.55 + this.rnd(-2.5, 2.5), {
            life: this.rnd(0.2, 0.45), size0: this.rnd(0.14, 0.26), size1: 0.03, color: this.pick(SPARK_COLORS), alpha: 1, drag: 1.4, gravity: 14, mode: 1,
          });
        }
      } else this.acc[a + 5] = 0;
    }
  }

  /** car-local x of the end that smokes / burns: the engine (front) unless the rear is clearly the worse wreck */
  private smokeEnd(st: CarPose['state']): number {
    const m = st.zoneMaxHp || 100;
    const front = Math.min(st.hp.front, st.hp.engine) / m, rear = st.hp.rear / m;
    return rear < front - 0.25 ? -1.7 : 1.2;
  }

  update(dt: number, camera: THREE.Camera): void {
    // visual hit-stop: debris, sparks and rings run in slow motion for a beat after a heavy hit
    let k = 1;
    if (this.hitStopLeft > 0) { k = FX.hitStopScale; this.hitStopLeft = Math.max(0, this.hitStopLeft - dt); }
    const fdt = dt * k;
    this.recentBreakTrauma = Math.max(0, this.recentBreakTrauma - dt * FX.breakShakeDecay);
    this.debris.update(fdt);
    this.rings.update(fdt);
    this.smoke.setCamera(camera); this.sparks.setCamera(camera);
    this.smoke.update(fdt); this.sparks.update(fdt);
    this.skids.flush();
  }

  dispose(): void { this.debris.dispose(); this.smoke.dispose(); this.sparks.dispose(); this.skids.dispose(); this.rings.dispose(); }
}

