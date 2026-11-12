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
import { Enemy, EnemyKind, Slug, ANCHOR_R } from './enemies';
import { GR } from '../phys/world';
import { Chunk, Cluster } from '../phys/structure';
import { vrng } from '../core/rng';
import { rectPoly } from '../phys/fracture';
import { baseStats } from './stats';
import { Level, buildTestLevel } from './level';
import { drawBackdrop } from '../gfx/backdrop';

const H = 1 / 60;

export class Game {
  fx = new Fx(); cam = new Camera(); st: Structures; player: Player;
  enemies: Enemy[] = []; slugs: Slug[] = []; timers: { t: number; fn: () => void }[] = [];
  enemyHpK = 1; enemySpeedK = 1; sandbox = true; kills = 0; private respawnT = 2;
  level!: Level;
  time = 0; realTime = 0; timeScale = 1; acc = 0; alpha = 1;
  private stopT = 0; private kx = 0; private ky = 0; private kvx = 0; private kvy = 0; private desatT = 0; private flashT = 0;
  reviveUsed = false; paused = false; deadT = 0;
  frameMs = 0; fps = 60;
  constructor(public R: Renderer, public phys: Phys, public input: Input) {
    this.st = new Structures(phys, this.fx, 1);
    this.player = new Player(this); this.player.s = baseStats();
  }
  loadTest() {
    this.phys.reset(); this.st = new Structures(this.phys, this.fx, 7); this.fx.clear(); this.enemies.length = 0; this.slugs.length = 0; this.timers.length = 0;
    this.st.onShatter = (ch, cl, wx, wy) => { if (cl.tag === 'barrel') this.timers.push({ t: 0.06, fn: () => this.explode(wx, wy, 3.4, 1) }); };
    this.level = buildTestLevel(this);
    this.fx.groundY = this.level.groundY;
    this.player.spawn(this.level.spawnX, this.level.spawnY); this.player.fullRestore();
    this.cam.bounds(this.level.x0, this.level.y0, this.level.x1, this.level.groundY + 2.2); this.cam.snap(this.player.x, this.player.y - 2);
    this.st.spawnBody([rectPoly(-6.2, -1.06, 0.72, 1.05)], 'barrel', 0, 0, 'barrel'); this.st.spawnBody([rectPoly(10, -1.06, 0.72, 1.05)], 'barrel', 0, 0, 'barrel');
    this.spawnEnemy('grunt', 6, -1, false); this.spawnEnemy('shooter', 20, -9, false); this.spawnEnemy('grunt', -11, -1, false);
  }
  // ---- hooks used by entities
  jammed(x: number, y: number) { for (const e of this.enemies) if (e.jamming && hypot(e.x - x, e.y - y) < e.jamR) return true; return false; }
  spawnEnemy(kind: EnemyKind, x: number, y: number, elite: boolean) { const e = new Enemy(this, kind, x, y, elite); this.enemies.push(e); return e; }
  shoot(x: number, y: number, ang: number, owner: Enemy | null) { this.slugs.push({ x, y, vx: Math.cos(ang) * 17, vy: Math.sin(ang) * 17, life: 3, owner, friendly: false, r: 0.14, portalCd: 0 }); }
  onEnemyDie(_e: Enemy, _cause: string) { this.kills++; this.hitstop(0.06); }
  pushPlayer(x: number, y: number, r: number, v: number) { const p = this.player; const dx = p.x - x, dy = p.y - y; const d = hypot(dx, dy); if (d > r || !p.alive) return; const f = 1 - d / r; p.rb.setLinvel({ x: p.vx + (dx / (d || 1)) * v * f, y: p.vy + (dy / (d || 1)) * v * f - 3 * f }, true); }
  deflectSlugs(x: number, y: number, r: number) { for (const s of this.slugs) { const dx = s.x - x, dy = s.y - y; const d = hypot(dx, dy); if (d < r) { const sp = hypot(s.vx, s.vy); s.vx = (dx / (d || 1)) * sp; s.vy = (dy / (d || 1)) * sp; s.friendly = true; s.owner = null; } } }
  explode(x: number, y: number, r: number, power: number) {
    this.st.blast(x, y, r, 2600 * power, 1500 * power); this.pushEnemies(x, y, r, 13 * power, 85 * power, 0.5, 'explosion');
    const p = this.player; if (hypot(p.x - x, p.y - y) < r * 0.6) p.hurt(1, x, 'explosion'); else this.pushPlayer(x, y, r * 1.3, 12);
    this.fx.warp(x, y, 0.3, r * 2.2, 1.0, 0.5); this.fx.ring(x, y, 0.3, r * 1.3, 0.5, 0.35, ink(0, 1, 0)); this.fx.ring(x, y, 0.2, r, 0.9, 0.22, ink(0, 0, 0)); this.fx.ring(x, y, 0.4, r * 1.7, 0.2, 0.5, ink(1, 0, 0));
    this.fx.burst(x, y, 26, 22, ink(0, 1, 0), 'spark'); this.fx.burst(x, y, 14, 12, ink(0, 0, 1), 'scrap'); for (let i = 0; i < 5; i++) this.fx.dust(x + vrng.range(-1, 1) * r * 0.5, y + vrng.range(-1, 1) * r * 0.5, r * 0.5, ink(0.4, 0.2, 0));
    this.cam.shake(0.75); this.hitstop(0.05); this.kickPlates(vrng.range(-1, 1), -1, 12); this.flash(0.35);
    bus.emit('explode', { x, y, r });
  }
  private impacts(h: number) {
    const evs = this.phys.forceEvts; const g = this.phys.gravity;
    for (const e of evs) {
      for (let s = 0; s < 2; s++) {
        const me = s ? e.b : e.a, ot = s ? e.a : e.b;
        if (me.kind === 'enemy') {
          const en = me.obj as Enemy; let mo = Infinity; let type: 'static' | 'debris' | 'enemy' | 'prop' = 'static';
          if (ot.kind === 'chunk') { const cl = (ot.obj as Chunk).cl; if (!cl.fixed) { mo = cl.rb.mass(); type = (cl as any).thrownT > 0 ? 'prop' : 'debris'; if (cl.held) continue; } }
          else if (ot.kind === 'enemy') { mo = (ot.obj as Enemy).rb.mass(); type = 'enemy'; } else if (ot.kind === 'player') continue;
          const jx = e.j - T.impact.restK * g * h * Math.min(en.rb.mass(), mo);
          if (jx > T.impact.enemyJMin) en.impact(jx, type);
        } else if (me.kind === 'player' && ot.kind === 'chunk') {
          const cl = (ot.obj as Chunk).cl; if (cl.fixed || cl.held) continue; const m = cl.rb.mass(); if (m < 160) continue;
          const v = cl.rb.linvel(); if (hypot(v.x, v.y) < 5) continue;
          if (e.j - T.impact.restK * g * h * 70 > T.impact.playerJMin) this.player.hurt(1, cl.rb.worldCom().x, 'crush');
        }
      }
    }
  }
  private updateSlugs(h: number) {
    const p = this.player, ph = this.phys;
    for (let i = this.slugs.length - 1; i >= 0; i--) {
      const s = this.slugs[i]; s.life -= h; if (s.portalCd > 0) s.portalCd -= h; let dead = s.life <= 0;
      const sp = hypot(s.vx, s.vy); const dx = s.vx / sp, dy = s.vy / sp; const step = sp * h;
      if (!dead && ph.castRay(s.x, s.y, dx, dy, step, GR.qSolid)) {
        const r = ph.rayHit; if (r.ref && r.ref.kind === 'chunk') this.st.damage(r.ref.obj as Chunk, 300, r.x, r.y, s.vx * 0.2, s.vy * 0.2);
        this.fx.burst(r.x, r.y, 6, 9, ink(0, 0, 1), 'spark', -dx, -dy, 2); dead = true;
      }
      if (!dead) {
        const nx = s.x + s.vx * h, ny = s.y + s.vy * h;
        if (!s.friendly && p.alive && hypot(nx - p.x, (ny - p.y) * 0.6) < 0.42) { if (p.hurt(1, s.x, 'slug')) dead = true; }
        if (!dead) for (const e of this.enemies) { if (!e.alive || e === s.owner || e.state === 'dive') continue; if (hypot(nx - e.x, (ny - e.y) * 0.7) < e.radius + 0.1) { e.hit(s.friendly ? 55 : 30, s.vx * 0.3, s.vy * 0.3, 'bullet'); dead = true; break; } }
        if (!dead && p.s.scarPortal > 0 && s.portalCd <= 0) for (const sc of p.scars) { if (!sc.pair || hypot(nx - sc.x, ny - sc.y) > 0.85) continue; s.x = sc.pair.x; s.y = sc.pair.y; s.friendly = true; s.owner = null; s.portalCd = 0.6; let best: Enemy | null = null, bd = 16; for (const e of this.enemies) { if (!e.alive) continue; const d = hypot(e.x - s.x, e.y - s.y); if (d < bd) { bd = d; best = e; } } if (best) { s.vx = ((best.x - s.x) / bd) * sp; s.vy = ((best.y - s.y) / bd) * sp; } this.fx.burst(s.x, s.y, 6, 8, ink(0, 1, 0), 'spark'); break; }
        if (s.portalCd < 0.55) { s.x += s.vx * h; s.y += s.vy * h; }
      }
      if (dead) { this.slugs[i] = this.slugs[this.slugs.length - 1]; this.slugs.pop(); }
    }
  }
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
    for (let i = this.timers.length - 1; i >= 0; i--) { const t = this.timers[i]; t.t -= h; if (t.t <= 0) { this.timers.splice(i, 1); t.fn(); } }
    p.pre(h);
    for (const e of this.enemies) e.pre(h);
    this.updateSlugs(h);
    this.phys.step(h);
    this.st.handleForces(h);
    this.impacts(h);
    p.post();
    for (const e of this.enemies) e.post();
    for (let i = this.enemies.length - 1; i >= 0; i--) { const e = this.enemies[i]; if (!e.alive && e.deadT > 0.6) { this.phys.removeBody(e.rb); this.enemies.splice(i, 1); } }
    for (const cl of this.st.clusters) { const c = cl as any; if (c.thrownT > 0) c.thrownT -= h; }
    this.st.update(h);
    this.st.sync();
    if (this.sandbox) {
      // prototype sandbox: hunters keep printing in, the hero is reprinted on death
      this.respawnT -= h; let alive = 0; for (const e of this.enemies) if (e.alive) alive++;
      if (this.respawnT <= 0 && alive < 4) { this.respawnT = 3.5; const L = this.level; const kinds: EnemyKind[] = ['grunt', 'grunt', 'shooter', 'shield', 'tracer', 'heavy', 'anchor']; const k = kinds[Math.min(kinds.length - 1, Math.floor(vrng.range(0, Math.min(kinds.length, 2 + this.kills / 2))))]; let x = vrng.range(L.x0 + 3, L.x1 - 3); if (Math.abs(x - p.x) < 7) x = p.x + (x < p.x ? -8 : 8); this.spawnEnemy(k, Math.max(L.x0 + 2, Math.min(L.x1 - 2, x)), k === 'anchor' ? -7 : -1.2, false); }
      if (!p.alive) { this.deadT += h; if (this.deadT > 1.6) { this.deadT = 0; this.loadTest(); this.kills = 0; } }
    }
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
    for (const e of this.enemies) e.draw(R, this.alpha);
    p.drawScars(R);
    p.draw(R, this.alpha, dtReal * this.timeScale);
    for (const s of this.slugs) { const sp = hypot(s.vx, s.vy); const dx = s.vx / sp, dy = s.vy / sp; R.taper(s.x - dx * 0.9, s.y - dy * 0.9, s.x, s.y, 0.02, 0.2, s.friendly ? ink(0, 1, 0) : ink(0, 0, 1)); R.circle(s.x, s.y, 0.15, ink(1, 0, 0), 10); R.circle(s.x, s.y, 0.07, s.friendly ? ink(0, 1, 0) : ink(0, 0, 1), 8); }
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
