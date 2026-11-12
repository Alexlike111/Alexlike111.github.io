// Game: owns all systems, the fixed-step loop and the render order.
import { Renderer, ink, Blend } from '../gfx/gl';
import { Fx } from '../gfx/fx';
import { Camera } from '../gfx/camera';
import { Phys } from '../phys/world';
import { Structures } from '../phys/structure';
import { Input } from './input';
import { Player } from './player';
import { T } from '../core/tune';
import { bus } from '../core/bus';
import { damp, clamp, hypot, spring } from '../core/math';
import type { Hittable } from './types';
import { baseStats } from './stats';
import { Level, buildTestLevel } from './level';
import { drawBackdrop } from '../gfx/backdrop';

const H = 1 / 60;

export class Game {
  fx = new Fx(); cam = new Camera(); st: Structures; player: Player;
  enemies: Hittable[] = [];
  level!: Level;
  time = 0; realTime = 0; timeScale = 1; acc = 0; alpha = 1;
  private stopT = 0; private kx = 0; private ky = 0; private kvx = 0; private kvy = 0; private desatT = 0; private flashT = 0;
  reviveUsed = false; paused = false;
  frameMs = 0; fps = 60;
  constructor(public R: Renderer, public phys: Phys, public input: Input) {
    this.st = new Structures(phys, this.fx, 1);
    this.player = new Player(this); this.player.s = baseStats();
  }
  loadTest() {
    this.phys.reset(); this.st = new Structures(this.phys, this.fx, 7); this.fx.clear(); this.enemies.length = 0;
    this.level = buildTestLevel(this);
    this.fx.groundY = this.level.groundY;
    this.player.spawn(this.level.spawnX, this.level.spawnY); this.player.fullRestore();
    this.cam.bounds(this.level.x0, this.level.y0, this.level.x1, this.level.groundY + 2.2); this.cam.snap(this.player.x, this.player.y - 2);
  }
  // ---- hooks used by entities
  jammed(_x: number, _y: number) { return false; }
  hitstop(t: number) { this.stopT = Math.max(this.stopT, t); }
  kickPlates(nx: number, ny: number, px: number) { this.kvx += nx * px * 60; this.kvy += ny * px * 60; }
  flashDesat(t: number) { this.desatT = Math.max(this.desatT, t); }
  flash(a: number) { this.flashT = Math.max(this.flashT, a); }
  onPlayerJump(_fx: number, _fy: number, _tx: number, _ty: number, _heavy: boolean) { }
  pushEnemies(x: number, y: number, r: number, v: number, dmg: number, stun: number, cause = 'burst') {
    for (const e of this.enemies) {
      if (!e.alive || e.held) continue; const dx = e.x - x, dy = e.y - y; const d = hypot(dx, dy); if (d > r + e.radius) continue;
      const f = clamp(1 - d / (r + e.radius), 0.2, 1); const nx = d > 0.05 ? dx / d : 0, ny = d > 0.05 ? dy / d : -1;
      e.hit(dmg * f, nx * v * f, ny * v * f - (v > 0 ? 2.5 * f : 0), cause);
    }
  }

  // ---- loop
  frame(dtReal: number) {
    dtReal = Math.min(dtReal, 0.05); this.realTime += dtReal;
    const I = this.input; I.w = window.innerWidth; I.h = window.innerHeight; I.poll(dtReal);
    const p = this.player;
    // time scale: slow-mo while aiming (as long as focus lasts), freeze frames on hits
    let ts = 1;
    if (p.aim.on) ts = p.focus > 0 ? T.tp.aimSlow : 0.55;
    if (!p.alive) ts = 0.35;
    this.timeScale += (ts - this.timeScale) * damp(ts < this.timeScale ? 30 : 9, dtReal);
    let scale = this.timeScale;
    if (this.stopT > 0) { this.stopT -= dtReal; scale = 0.04; }
    if (this.paused) scale = 0;
    const dt = dtReal * scale; this.time += dt;
    p.frame(dtReal, dt);
    this.acc += dt; let n = 0;
    while (this.acc >= H && n < 4) { this.fixed(H); this.acc -= H; n++; }
    if (n === 4) this.acc = 0;
    this.alpha = this.acc / H;
    this.fx.update(dt);
    // camera
    const lookX = clamp(p.vx * 0.22, -2.5, 2.5) + (p.aim.on ? (p.aim.x - p.x) * 0.3 : 0), lookY = clamp(p.vy * 0.1, -1.5, 3) + (p.aim.on ? (p.aim.y - p.y) * 0.3 : 0) - 1.4;
    this.cam.tx = p.x + lookX; this.cam.ty = p.y + lookY; this.cam.tzoom = p.aim.on ? 0.88 : 1;
    this.cam.update(dtReal, p.lastJumpT < 0.35 ? 11 : 6);
    // plate misregistration spring
    [this.kx, this.kvx] = spring(this.kx, this.kvx, 0, 620, 30, dtReal); [this.ky, this.kvy] = spring(this.ky, this.kvy, 0, 620, 30, dtReal);
    if (this.desatT > 0) this.desatT -= dtReal; if (this.flashT > 0) this.flashT -= dtReal * 5;
    I.endFrame();
  }
  fixed(h: number) {
    const p = this.player;
    p.pre(h);
    this.phys.step(h);
    this.st.handleForces(h);
    p.post();
    this.st.update(h);
    this.st.sync();
  }

  render(dtReal: number) {
    const R = this.R, cam = this.cam, p = this.player; const t0 = performance.now();
    const aimK = clamp((1 - this.timeScale) / (1 - T.tp.aimSlow), 0, 1);
    R.offA = [this.kx * 0.2, this.ky * 0.2]; R.offB = [0.7 + this.kx, -0.5 + this.ky]; R.offC = [-0.6 - this.kx * 0.65, 0.6 - this.ky * 0.65];
    R.desat = clamp(this.desatT * 1.6, 0, 0.75) + aimK * 0.0; R.flash = clamp(this.flashT, 0, 1); R.time = this.realTime; R.vig = 0.5 + aimK * 0.9;
    R.scroll = [cam.cx * cam.ppm, -cam.cy * cam.ppm];
    this.fx.applyWarps(R, (x) => cam.sx(x), (y) => cam.sy(y), cam.ppm);
    R.begin();
    drawBackdrop(R, cam, this.level, this.realTime);
    R.setCamera(cam.cx, cam.cy, cam.ppm);
    const lw = Math.max(0.045, 1.6 / cam.ppm * cam.dpr);
    const x0 = cam.x0 - 1, x1 = cam.x1 + 1, y0 = cam.y0 - 1, y1 = cam.y1 + 1;
    // ground
    R.rect(this.level.x0 - 40, this.level.groundY, this.level.x1 - this.level.x0 + 80, 30, ink(1, 0, 0));
    R.rect(this.level.x0 - 40, this.level.groundY + 0.16, this.level.x1 - this.level.x0 + 80, 0.07, ink(1, 0, 1));
    this.st.draw(R, x0, y0, x1, y1, lw);
    this.fx.drawStains(R);
    this.st.drawDynamic(R, x0, y0, x1, y1, lw, this.alpha);
    p.drawScars(R);
    p.draw(R, this.alpha, dtReal * this.timeScale);
    this.fx.draw(R);
    p.drawAim(R);
    this.drawTouch(R);
    R.end();
    this.frameMs += (performance.now() - t0 - this.frameMs) * 0.1;
  }
  /** on-screen stick, drawn as a registration mark (screen space) */
  private drawTouch(R: Renderer) {
    const I = this.input; if (!I.touchMode) return;
    const d = this.cam.dpr; R.setCamera(this.cam.w / 2, this.cam.h / 2, 1);
    const k = ink(1, 0, 0, 0.55), kc = ink(0, 1, 0, 0.9);
    if (I.stick.on) {
      const ox = I.stick.ox * d, oy = I.stick.oy * d; const r = 52 * d;
      R.ring(ox, oy, r, 2.5 * d, k, 40); R.line(ox - r * 1.25, oy, ox - r * 0.8, oy, 2 * d, k); R.line(ox + r * 0.8, oy, ox + r * 1.25, oy, 2 * d, k); R.line(ox, oy - r * 1.25, ox, oy - r * 0.8, 2 * d, k); R.line(ox, oy + r * 0.8, ox, oy + r * 1.25, 2 * d, k);
      let dx = I.stick.x - I.stick.ox, dy = I.stick.y - I.stick.oy; const l = Math.hypot(dx, dy); if (l > 65) { dx *= 65 / l; dy *= 65 / l; }
      R.circle(ox + dx * d, oy + dy * d, 20 * d, kc, 24); R.circle(ox + dx * d, oy + dy * d, 9 * d, ink(0, 0, 0), 16);
    }
    if (I.aim.active && I.aim.relative) {
      const sx = I.aim.sx * d, sy = I.aim.sy * d, x = I.aim.x * d, y = I.aim.y * d;
      R.ring(sx, sy, 16 * d, 2 * d, k, 24); if (I.aim.dragging) { R.taper(sx, sy, x, y, 5 * d, 1.5 * d, ink(0, 1, 0, 0.7)); R.circle(x, y, 7 * d, kc, 14); }
    }
  }
}
