// The hero: platformer body + the jump (teleport) with conserved momentum, air displacement and volume swap.
import { RAPIER, GR, G, groups } from '../phys/world';
import { T } from '../core/tune';
import { clamp, approach, damp, hypot, TAU, lerp } from '../core/math';
import { bus } from '../core/bus';
import { vrng } from '../core/rng';
import { Renderer, ink, inkAlpha, Blend } from '../gfx/gl';
import { solvePose, drawFigure, Pose, PoseIn, J, Ribbon, FigStyle } from './figure';
import type { Game } from './game';
import type { Hittable, Stats } from './types';
import { Cluster } from '../phys/structure';

export interface Scar { x: number; y: number; ang: number; len: number; t: number; life: number; seed: number; pair: Scar | null; cut: number }
export interface Ghost { pose: Pose; face: number; t: number; life: number; dx: number; dy: number; plate: number }
export interface AimInfo { on: boolean; x: number; y: number; valid: boolean; enemy: Hittable | null; raw: number; reason: string }

const HERO: FigStyle = { body: ink(1, 0, 0), back: ink(1, 0, 0), accent: ink(0, 1, 0), kind: 'hero', bulk: 1 };

export class Player {
  rb!: RAPIER.RigidBody; col!: RAPIER.Collider; shape = new RAPIER.Capsule(T.player.halfH, T.player.r);
  x = 0; y = 0; px = 0; py = 0; vx = 0; vy = 0;
  face = 1; grounded = false; coyote = 0; jumpBuf = 0; phase = 0; squash = 0; hurtT = 0; iframes = 0; t = 0;
  hp = T.player.hp; alive = true;
  charges = T.tp.charges; chargeT = 0; chargeDelay = 0; focus = T.tp.focus; focusDelay = 0;
  heavyArmed = 0; // seconds left
  aim: AimInfo = { on: false, x: 0, y: 0, valid: false, enemy: null, raw: 0, reason: '' };
  aimHold = 0;
  held: Hittable | Cluster | null = null; heldCooldown = 0;
  strikeT = 0; strikeAng = 0; strikeCd = 0;
  scarf = new Ribbon(9, 0.13);
  pose: Pose = new Float32Array(J.N * 2);
  scars: Scar[] = []; ghosts: Ghost[] = [];
  lastJumpT = 99; airJumps = 0; stuckT = 0; fallPeak = 0; denyT = 0;
  wasGrounded = false; stepAcc = 0; freeJump = false;
  moveX = 0; jumpHeld = false; wantAction = false;
  s!: Stats;
  constructor(public g: Game) { }

  spawn(x: number, y: number) {
    const w = this.g.phys.world;
    if (this.rb) { /* world was reset → old handles are gone */ }
    this.rb = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y).lockRotations().setCcdEnabled(true).setLinearDamping(0).setCanSleep(false));
    this.col = w.createCollider(RAPIER.ColliderDesc.capsule(T.player.halfH, T.player.r).setMass(T.player.mass).setFriction(0).setRestitution(0)
      .setCollisionGroups(GR.player).setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(1500), this.rb);
    this.g.phys.ref(this.col, 'player', this);
    this.x = this.px = x; this.y = this.py = y; this.vx = this.vy = 0; this.alive = true; this.held = null; this.heavyArmed = 0;
    this.scarf.reset(x, y - 0.5); this.scars.length = 0; this.ghosts.length = 0; this.iframes = 0.6; this.strikeT = 0; this.aim.on = false; this.squash = 0;
  }
  fullRestore() { this.hp = this.s.maxHp; this.charges = this.s.charges; this.focus = this.s.focus; }

  // ------------------------------------------------------------------ per-frame (real time)
  frame(dtReal: number, dt: number) {
    const g = this.g, I = g.input, s = this.s;
    this.moveX = I.moveX; this.jumpHeld = I.jumpHeld;
    if (I.jumpEdge) this.jumpBuf = T.player.jumpBuffer;
    if (I.actionEdge) this.wantAction = true;
    if (I.heavyEdge) { if (this.heavyArmed > 0) this.heavyArmed = 0; else if (this.charges >= s.heavyCost) { this.heavyArmed = 5; bus.emit('uiClick', {}); } else this.deny('charges'); }
    if (this.heavyArmed > 0 && !I.aim.dragging) this.heavyArmed -= dtReal;
    // ---- aiming
    const a = I.aim; const wasOn = this.aim.on;
    if (a.active && a.dragging && this.alive) {
      if (!wasOn) { bus.emit('aimStart', {}); this.aimHold = 0; }
      this.aim.on = true; this.aimHold += dtReal;
      this.computeAim(a.relative, a.x, a.y, a.x - a.sx, a.y - a.sy, false);
      this.focus = Math.max(0, this.focus - dtReal); this.focusDelay = T.tp.focusRegenDelay;
    } else {
      if (wasOn) bus.emit('aimEnd', {});
      this.aim.on = false;
      if (this.focusDelay > 0) this.focusDelay -= dtReal; else this.focus = Math.min(s.focus, this.focus + T.tp.focusRegen * dtReal);
    }
    for (const r of I.releases) {
      if (!this.alive) break;
      if (r.kind === 'cancel') continue;
      if (r.kind === 'tap') { this.computeAim(false, r.x, r.y, 0, 0, true); this.tryJump(); }
      else { this.computeAim(r.relative, r.x, r.y, r.dx, r.dy, false); if (this.aim.raw > 0.7) this.tryJump(); }
    }
    // ---- cosmetics that should run in real time
    this.t += dt;
    if (this.denyT > 0) this.denyT -= dtReal;
    for (let i = this.scars.length - 1; i >= 0; i--) { const sc = this.scars[i]; sc.t += dt; if (sc.t >= sc.life) { if (sc.pair) sc.pair.pair = null; this.scars.splice(i, 1); } }
    for (let i = this.ghosts.length - 1; i >= 0; i--) { const gh = this.ghosts[i]; gh.t += dtReal; if (gh.t >= gh.life) this.ghosts.splice(i, 1); }
  }
  /** resolve where a jump would land */
  computeAim(relative: boolean, cssX: number, cssY: number, ddx: number, ddy: number, tap: boolean) {
    const g = this.g, cam = g.cam, s = this.s, A = this.aim;
    let tx: number, ty: number;
    if (relative && !tap) {
      // accelerated relative mapping: short drags are precise, long drags reach full range
      const l = Math.hypot(ddx, ddy); const gain = T.tp.dragGain * (0.75 + Math.min(1, l / 150) * 0.6);
      tx = this.x + ddx * gain; ty = this.y + ddy * gain;
    } else { tx = cam.wx(cssX); ty = cam.wy(cssY); }
    let dx = tx - this.x, dy = ty - this.y; let d = hypot(dx, dy);
    A.raw = d;
    if (d > s.range) { dx *= s.range / d; dy *= s.range / d; d = s.range; tx = this.x + dx; ty = this.y + dy; }
    // snap to an enemy → land beside it and strike
    A.enemy = null; let best = tap ? T.tp.snapEnemyR : 0.85;
    for (const e of g.enemies) {
      if (!e.alive || e.held) continue; const q = hypot(e.x - tx, e.y - ty) - e.radius * 0.5;
      if (q < best) { best = q; A.enemy = e; }
    }
    if (A.enemy) {
      const e = A.enemy; let sx = tx - e.x, sy = ty - e.y; let sl = hypot(sx, sy);
      if (tap || sl < 0.35) { sx = this.x - e.x; sy = (this.y - e.y) * 0.4; sl = hypot(sx, sy) || 1; }
      const off = e.radius + 0.5; tx = e.x + (sx / sl) * off; ty = e.y + (sy / sl) * off * 0.6;
    }
    // world bounds
    const L = g.level; tx = clamp(tx, L.x0 + 0.5, L.x1 - 0.5); ty = clamp(ty, L.y0 + 1, L.groundY - 0.85);
    A.reason = '';
    const r = this.resolveFree(tx, ty);
    A.valid = r; A.x = this.rx; A.y = this.ry;
    if (!r) A.reason = 'blocked';
    else if (g.jammed(A.x, A.y) || g.jammed(this.x, this.y)) { A.valid = false; A.reason = 'anchor'; }
  }
  private rx = 0; private ry = 0;
  /** nearest free capsule position around (tx,ty) */
  resolveFree(tx: number, ty: number): boolean {
    const ph = this.g.phys; this.rx = tx; this.ry = ty;
    if (ph.shapeFree(tx, ty, this.shape, GR.qSolid, this.rb)) return true;
    if (this.s.inset > 0) { const ref = ph.pointSolid(tx, ty, GR.qStaticDebris); if (ref && ref.kind === 'chunk' && !ref.obj.mat.unbreakable) return true; }
    for (let ring = 1; ring <= 7; ring++) {
      const r = ring * 0.32; const n = 8 + ring * 2; let bestD = 1e9, ok = false;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + ring; const x = tx + Math.cos(a) * r, y = ty + Math.sin(a) * r * 0.9;
        if (y > this.g.level.groundY - 0.82) continue;
        if (ph.shapeFree(x, y, this.shape, GR.qSolid, this.rb)) { const d = hypot(x - this.x, y - this.y); if (d < bestD) { bestD = d; this.rx = x; this.ry = y; ok = true; } }
      }
      if (ok) return true;
    }
    return false;
  }
  deny(reason: 'charges' | 'anchor' | 'blocked') { this.denyT = 0.3; bus.emit('jumpDenied', { reason }); }

  tryJump() {
    const A = this.aim, s = this.s;
    if (!A.valid) { this.deny(A.reason === 'anchor' ? 'anchor' : 'blocked'); return false; }
    const heavy = this.heavyArmed > 0;
    const cost = heavy ? s.heavyCost : this.freeJump ? 0 : 1; if (!heavy) this.freeJump = false;
    if (this.charges < cost) { this.deny('charges'); return false; }
    this.charges -= cost; this.chargeDelay = T.tp.rechargeDelay; this.heavyArmed = 0;
    this.jumpTo(A.x, A.y, heavy, A.enemy);
    return true;
  }

  // ------------------------------------------------------------------ THE JUMP
  jumpTo(tx: number, ty: number, heavy: boolean, target: Hittable | null) {
    const g = this.g, s = this.s, st = g.st, fx = g.fx;
    const fx0 = this.x, fy0 = this.y; const dx = tx - fx0, dy = ty - fy0; const dist = hypot(dx, dy) || 1; const nx = dx / dist, ny = dy / dist;
    const speed = hypot(this.vx, this.vy);
    // --- leave: a print of the body stays behind, air rushes into the hole
    this.snapshotGhost(0.34, 1);
    const scA = this.addScar(fx0, fy0, Math.atan2(ny, nx));
    let carried = 0;
    const moved: { rb: RAPIER.RigidBody; cl?: Cluster; e?: Hittable }[] = [];
    if (heavy) {
      const R = s.heavyR;
      st.takeSphere(fx0, fy0, R);
      for (const cl of st.clusters) { if (cl === this.held) continue; const c = cl.rb.worldCom(); if (hypot(c.x - fx0, c.y - fy0) < R + 0.15) moved.push({ rb: cl.rb, cl }); }
      for (const e of g.enemies) { if (e.alive && e !== this.held && hypot(e.x - fx0, e.y - fy0) < R + e.radius * 0.5 && e.grabbable) moved.push({ rb: e.rb, e }); }
      carried = moved.length;
      fx.ring(fx0, fy0, R, R * 0.2, 0.16, 0.3, ink(0, 1, 0));
    }
    // --- arrive: displaced air first (pushes what is already there), then the carried volume materialises
    const kin = speed > T.tp.kineticMin ? 1 + (speed - T.tp.kineticMin) / 18 * s.slamK : 1;
    if (s.inset > 0) { const ref = g.phys.pointSolid(tx, ty, GR.qStaticDebris); if (ref && ref.kind === 'chunk') st.blast(tx, ty, 1.15 + 0.25 * s.inset, 5000, 300); }
    this.arrivalBurst(tx, ty, kin, heavy);
    this.rb.setTranslation({ x: tx, y: ty }, true);
    if (s.vector > 0 && speed > 2) { const k = Math.min(1, 0.55 + 0.25 * s.vector); this.vx = lerp(this.vx, nx * speed, k); this.vy = lerp(this.vy, ny * speed, k); this.rb.setLinvel({ x: this.vx, y: this.vy }, true); }
    for (const m of moved) {
      const t = m.rb.translation(); m.rb.setTranslation({ x: t.x + dx, y: t.y + dy }, true);
      if (m.cl) m.cl.snap(); if (m.e) m.e.teleported(dx, dy);
    }
    if (this.held) this.moveHeld(dx, dy);
    this.scarf.shift(dx, dy);
    this.x = this.px = tx; this.y = this.py = ty;
    this.snapshotGhost(0.22, 2);
    const scB = this.addScar(tx, ty, Math.atan2(ny, nx) + Math.PI); scA.pair = scB; scB.pair = scA;
    // implosion at the origin: nearby loose things get sucked in
    st.blast(fx0, fy0, T.tp.implodeR, 0, T.tp.implodeImpulse, true);
    g.pushEnemies(fx0, fy0, T.tp.implodeR, -5, 0, 0);
    fx.warp(fx0, fy0, T.tp.implodeR * 1.2, 0.2, -0.5, 0.28);
    fx.ring(fx0, fy0, T.tp.implodeR * 0.9, 0.15, 0.1, 0.22, ink(1, 0, 0));
    for (let i = 0; i < 10; i++) { const a = vrng.range(0, TAU), r = vrng.range(0.8, 2.2); fx.spark(fx0 + Math.cos(a) * r, fy0 + Math.sin(a) * r, -Math.cos(a) * r * 7, -Math.sin(a) * r * 7, ink(0, 1, 0), 0.2, 0.05); }
    // feel
    g.kickPlates(nx, ny, T.tp.misreg * (heavy ? 1.6 : 1) * Math.min(1.4, 0.6 + dist / 10));
    g.hitstop(T.tp.hitstop * (heavy ? 1.8 : 1));
    g.cam.shake(heavy ? 0.42 : 0.16 + (kin - 1) * 0.2);
    this.iframes = Math.max(this.iframes, T.player.jumpIframes);
    this.lastJumpT = 0; this.face = Math.abs(nx) > 0.2 ? Math.sign(nx) : this.face; this.grounded = false; this.coyote = 0;
    bus.emit('jump', { fromX: fx0, fromY: fy0, toX: tx, toY: ty, heavy, carried, speed });
    g.onPlayerJump(fx0, fy0, tx, ty, heavy);
    // strike on arrival
    let e = target;
    if (!e) { let best = T.strike.r; for (const q of g.enemies) { if (!q.alive || q.held) continue; const d = hypot(q.x - tx, q.y - ty) - q.radius * 0.5; if (d < best) { best = d; e = q; } } }
    if (e) this.strike(e.x - tx, e.y - ty, true);
  }
  arrivalBurst(x: number, y: number, kin: number, heavy: boolean) {
    const g = this.g, s = this.s, fx = g.fx;
    const R = s.burstR * (heavy ? 1.25 : 1) * Math.min(1.8, 0.75 + 0.25 * kin);
    g.st.blast(x, y, R, s.burstDmg * kin * kin, s.burstImpulse * kin);
    g.deflectSlugs(x, y, R + 0.6);
    g.pushEnemies(x, y, R, 6.5 * kin, (kin - 1) * 26, 0.25, 'burst');
    fx.warp(x, y, 0.3, R * 1.9, 0.55 * Math.min(2, kin), 0.36);
    fx.ring(x, y, 0.3, R * 1.25, 0.2, 0.3, ink(0, 1, 0));
    fx.ring(x, y, 0.2, R * 0.9, 0.5, 0.2, ink(0, 0, 0));
    fx.burst(x, y, 12, 13, ink(0, 1, 0), 'spark');
    if (kin > 1.25) { g.cam.shake(0.35); fx.ring(x, y, 0.4, R * 1.8, 0.35, 0.42, ink(1, 0, 0)); }
  }
  private addScar(x: number, y: number, ang: number): Scar {
    const sc: Scar = { x, y, ang: ang + vrng.range(-0.5, 0.5) + Math.PI / 2, len: vrng.range(1.25, 1.7), t: 0, life: this.s.scarLife, seed: vrng.range(0, 100), pair: null, cut: 0 };
    this.scars.push(sc); if (this.scars.length > 10) this.scars.shift(); return sc;
  }
  private snapshotGhost(life: number, plate: number) {
    this.updatePose(1);
    this.ghosts.push({ pose: Float32Array.from(this.pose), face: this.face, t: 0, life, dx: 0, dy: 0, plate }); if (this.ghosts.length > 8) this.ghosts.shift();
  }

  // ------------------------------------------------------------------ strike / grab / throw
  strike(dx: number, dy: number, fromJump: boolean) {
    const g = this.g, s = this.s; const l = hypot(dx, dy) || 1; let nx = dx / l, ny = dy / l;
    this.strikeT = 0.001; this.strikeAng = Math.atan2(ny, nx); this.strikeCd = T.strike.cooldown; if (Math.abs(nx) > 0.15) this.face = Math.sign(nx);
    const speedAlong = Math.max(0, this.vx * nx + this.vy * ny); const spd = hypot(this.vx, this.vy);
    const power = s.strikeForce + speedAlong * T.strike.velK + (fromJump ? 2 : 0);
    const cx = this.x + nx * 0.75, cy = this.y + ny * 0.75; let hitAny = false, killed = false;
    for (const e of g.enemies) {
      if (!e.alive || e.held) continue; const d = hypot(e.x - cx, e.y - cy); if (d > T.strike.r * 0.8 + e.radius) continue;
      const was = e.alive; e.hit(s.strikeDmg + spd * T.strike.velDmg, nx * power, ny * power - T.strike.up, 'strike'); hitAny = true; if (was && !e.alive) killed = true;
      g.fx.burst(e.x - nx * 0.2, e.y - ny * 0.2, 8, 14, ink(0, 1, 0), 'spark', nx, ny, 1.4);
      g.fx.ring(e.x, e.y, 0.2, 1.1, 0.22, 0.16, ink(0, 0, 0));
    }
    g.st.blast(cx + nx * 0.25, cy + ny * 0.25, 1.0, T.strike.chunkDmg * (1 + spd * 0.06), 300 + power * 22);
    if (hitAny && s.chainStrike) this.freeJump = true;
    if (hitAny) { g.hitstop(T.strike.hitstop); g.cam.shake(0.3); g.kickPlates(nx, ny, 5); this.rb.setLinvel({ x: this.vx * 0.55 - nx * 1.5, y: Math.min(this.vy * 0.4, 0) - 3.5 }, true); this.vx = this.vx * 0.55 - nx * 1.5; this.vy = Math.min(this.vy * 0.4, 0) - 3.5; }
    bus.emit('strike', { x: cx, y: cy, power, kill: killed });
    return hitAny;
  }
  private action() {
    const g = this.g;
    if (this.held) { this.throwHeld(); return; }
    if (this.heldCooldown <= 0) {
      // nearest grabbable: stunned / light enemies first, then loose bodies
      let best: Hittable | Cluster | null = null, bd = T.grab.r;
      for (const e of g.enemies) { if (!e.alive || !e.grabbable) continue; const d = hypot(e.x - this.x, e.y - this.y) - e.radius; if (d < bd) { bd = d; best = e; } }
      if (!best) for (const cl of g.st.clusters) {
        if (cl.shard && cl.chunks.length === 1 && cl.chunks[0].area < 0.1) continue; const m = cl.rb.mass(); if (m > this.s.carryMass || m < 4) continue;
        const c = cl.rb.worldCom(); const d = hypot(c.x - this.x - this.face * 0.4, c.y - this.y); if (d < bd + 0.2) { bd = d - 0.2; best = cl; }
      }
      if (best) { this.grab(best); return; }
    }
    if (this.strikeCd <= 0) {
      // plain strike towards the nearest enemy in reach, else facing
      let dx = this.face, dy = -0.08; let bd2 = 2.2;
      for (const e of g.enemies) { if (!e.alive) continue; const d = hypot(e.x - this.x, e.y - this.y); if (d < bd2) { bd2 = d; dx = e.x - this.x; dy = e.y - this.y; } }
      this.strike(dx, dy, false);
    }
  }
  private setHeldGroups(on: boolean) {
    const h = this.held; if (!h) return;
    if (h instanceof Cluster) { h.held = on; h.life = Infinity; h.fade = 1; for (const ch of h.chunks) ch.col?.setCollisionGroups(on ? groups(G.DEBRIS, G.STATIC) : GR.debris); }
  }
  grab(o: Hittable | Cluster) {
    this.held = o; this.setHeldGroups(true);
    if (!(o instanceof Cluster)) o.onGrab();
    bus.emit('grab', { kind: o instanceof Cluster ? (o.tag ?? 'debris') : o.kind });
  }
  private heldBody(): RAPIER.RigidBody | null { const h = this.held; return h ? h.rb : null; }
  private moveHeld(dx: number, dy: number) {
    const h = this.held!; const rb = h.rb; const t = rb.translation(); rb.setTranslation({ x: t.x + dx, y: t.y + dy }, true);
    if (h instanceof Cluster) h.snap(); else h.teleported(dx, dy);
  }
  dropHeld() { if (!this.held) return; const h = this.held; this.setHeldGroups(false); if (!(h instanceof Cluster)) h.onRelease(this.vx, this.vy); this.held = null; this.heldCooldown = 0.25; }
  throwHeld() {
    const h = this.held; if (!h) return; const s = this.s;
    let dx = this.face, dy = -0.22;
    if (this.aim.on) { dx = this.aim.x - this.x; dy = this.aim.y - this.y; }
    else if (Math.abs(this.g.input.moveY) > 0.5 && this.g.input.stick.on) { dy = this.g.input.moveY; dx = this.moveX * 0.6; }
    const l = hypot(dx, dy) || 1; dx /= l; dy /= l;
    const rb = h.rb; const m = rb.mass(); const v = s.throwV * clamp(1.15 - m / 400, 0.55, 1.1);
    const vx = dx * v + this.vx * 0.6, vy = dy * v + this.vy * 0.5;
    this.setHeldGroups(false);
    if (h instanceof Cluster) { rb.setLinvel({ x: vx, y: vy }, true); rb.setAngvel(vrng.range(-5, 5), true); h.life = Infinity; (h as any).thrownT = 1.2; }
    else h.onRelease(vx, vy);
    this.held = null; this.heldCooldown = 0.3; this.strikeT = 0.001; this.strikeAng = Math.atan2(dy, dx);
    bus.emit('throwIt', { power: v });
  }

  hurt(dmg: number, fromX: number, cause: string) {
    if (this.iframes > 0 || !this.alive) return false;
    const g = this.g;
    this.hp -= dmg; this.iframes = T.player.iframes; this.hurtT = 0.35;
    const dir = Math.sign(this.x - fromX) || 1; this.vx = dir * 7; this.vy = Math.min(this.vy, -6); this.rb.setLinvel({ x: this.vx, y: this.vy }, true);
    g.kickPlates(dir, -0.3, 16); g.cam.shake(0.6); g.hitstop(0.09); g.flashDesat(0.5);
    g.fx.burst(this.x, this.y, 14, 9, ink(1, 0, 0), 'scrap');
    if (this.held) this.dropHeld();
    if (this.s.thorns > 0) this.arrivalBurst(this.x, this.y, 1.7, false);
    bus.emit('playerHurt', { hp: Math.max(0, this.hp), maxHp: this.s.maxHp, cause });
    if (this.hp <= 0) {
      if (this.s.revive > 0 && !g.reviveUsed) { g.reviveUsed = true; this.hp = Math.ceil(this.s.maxHp / 2); this.iframes = 2.2; this.arrivalBurst(this.x, this.y, 2, true); bus.emit('pickup', { kind: 'hp', amount: this.hp }); }
      else { this.alive = false; this.hp = 0; bus.emit('playerDie', {}); }
    }
    return true;
  }

  // ------------------------------------------------------------------ fixed step
  pre(h: number) {
    const P = T.player, ph = this.g.phys, s = this.s;
    const v = this.rb.linvel(); this.vx = v.x; this.vy = v.y;
    if (!this.alive) { this.rb.setLinvel({ x: this.vx * 0.9, y: this.vy }, true); return; }
    // ground probe
    const t = this.rb.translation(); const by = t.y + P.halfH + P.r - 0.12;
    let gnd = false;
    if (this.vy > -1.5) for (const ox of [-0.2, 0, 0.2]) { if (ph.castRay(t.x + ox, by, 0, 1, 0.2, GR.qSolid, this.rb)) { gnd = true; break; } }
    if (gnd && !this.grounded) {
      const sp = this.fallPeak; this.squash = clamp(sp / 22, 0.15, 0.8);
      bus.emit('playerLand', { speed: sp, x: t.x, y: t.y + 0.8 });
      this.g.fx.dust(t.x - 0.25, t.y + 0.75, 0.3 + sp * 0.02, ink(0.3, 0, 0), -1.4); this.g.fx.dust(t.x + 0.25, t.y + 0.75, 0.3 + sp * 0.02, ink(0.3, 0, 0), 1.4);
      const slamAt = 15 - 3 * s.quake;
      if (sp > slamAt) { // ground slam: momentum becomes a shock wave
        const k = (1 + (sp - slamAt) / 12 * s.slamK) * (1 + 0.3 * s.quake); this.g.st.blast(t.x, t.y + 0.9, 1.6 + k * 0.7, 520 * k * k, 420 * k);
        this.g.pushEnemies(t.x, t.y + 0.6, 2.2 + k * 0.8, 7 * k, 14 * k, 0.5, 'slam'); this.g.cam.shake(0.3 + 0.12 * k); this.g.fx.warp(t.x, t.y + 0.8, 0.3, 3.2 + k, 0.5, 0.4);
        this.g.fx.ring(t.x, t.y + 0.8, 0.3, 2.4 + k, 0.3, 0.3, ink(1, 0, 0));
      }
      this.fallPeak = 0;
    }
    if (!gnd) this.fallPeak = Math.max(this.fallPeak, this.vy);
    this.grounded = gnd;
    if (gnd) { this.coyote = P.coyote; } else this.coyote -= h;
    // horizontal
    const want = this.moveX * s.run; const acc = gnd ? P.accelGround : P.accelAir;
    if (Math.abs(this.moveX) > 0.05) {
      this.face = this.aim.on ? this.face : Math.sign(this.moveX);
      // never brake momentum that already points where the player wants to go
      if (Math.sign(this.vx) === Math.sign(want) && Math.abs(this.vx) > Math.abs(want)) this.vx = approach(this.vx, want, (gnd ? 14 : 2.5) * h);
      else this.vx = approach(this.vx, want, acc * h);
    } else this.vx = approach(this.vx, 0, (gnd ? P.friction : 4) * h);
    // jump
    this.jumpBuf -= h;
    if (this.jumpBuf > 0 && this.coyote > 0) { this.vy = -P.jumpV; this.jumpBuf = 0; this.coyote = 0; this.grounded = false; bus.emit('playerJump', {}); this.g.fx.dust(t.x, t.y + 0.75, 0.35, ink(0.3, 0, 0)); }
    if (!this.jumpHeld && this.vy < -P.jumpV * P.jumpCut && this.lastJumpT > 0.3) this.vy = -P.jumpV * P.jumpCut;
    if (this.vy > T.maxFall) this.vy = T.maxFall;
    // unstick: pushing into a low obstacle → little hop
    if (gnd && Math.abs(this.moveX) > 0.3 && Math.abs(v.x) < 0.4) { this.stuckT += h; if (this.stuckT > 0.1) { this.vy = -7.5; this.stuckT = 0; } } else this.stuckT = 0;
    this.rb.setLinvel({ x: this.vx, y: this.vy }, true);
    // timers
    if (this.strikeCd > 0) this.strikeCd -= h; if (this.heldCooldown > 0) this.heldCooldown -= h;
    if (this.iframes > 0) this.iframes -= h; if (this.hurtT > 0) this.hurtT -= h;
    this.lastJumpT += h;
    if (this.strikeT > 0) { this.strikeT += h / 0.26; if (this.strikeT >= 1) this.strikeT = 0; }
    this.squash = Math.max(0, this.squash - h * 4.5);
    // charges
    if (this.charges < s.charges) { if (this.chargeDelay > 0) this.chargeDelay -= h; else { this.chargeT += h / s.recharge; if (this.chargeT >= 1) { this.chargeT = 0; this.charges++; bus.emit('pickup', { kind: 'charge', amount: 1 }); } } } else this.chargeT = 0;
    if (this.wantAction) { this.wantAction = false; this.action(); }
    // carried thing follows the hands
    const hb = this.heldBody();
    if (hb) {
      const c = hb.worldCom(); const hx = t.x + this.face * 0.25, hy = t.y - 1.25;
      const dvx = (hx - c.x) * 22, dvy = (hy - c.y) * 22; hb.setLinvel({ x: clamp(dvx, -30, 30) + this.vx, y: clamp(dvy, -30, 30) + this.vy * 0.5 }, true); hb.setAngvel(hb.angvel() * 0.8, true);
      if (hypot(hx - c.x, hy - c.y) > 3.2) this.dropHeld();
      if (this.held && !(this.held instanceof Cluster) && !this.held.alive) this.held = null;
      if (this.held instanceof Cluster && this.held.life < 0) this.held = null;
    }
    // run cycle / footsteps
    if (gnd) { const sp = Math.abs(this.vx); this.phase += sp * h * 1.45; this.stepAcc += sp * h; if (this.stepAcc > 1.9) { this.stepAcc = 0; bus.emit('playerStep', { x: t.x, y: t.y + 0.8 }); } }
  }
  post() {
    this.px = this.x; this.py = this.y; const t = this.rb.translation(); this.x = t.x; this.y = t.y;
    const v = this.rb.linvel(); const pvx = this.vx, pvy = this.vy; this.vx = v.x; this.vy = v.y;
    // crashing through something that broke → keep most of the momentum
    for (const r of this.g.st.punched) if (r.kind === 'player') { const k = 0.82; this.vx = pvx * k; this.vy = pvy * k; this.rb.setLinvel({ x: this.vx, y: this.vy }, true); this.g.cam.shake(0.15); break; }
  }

  // ------------------------------------------------------------------ draw
  private pin: PoseIn = { x: 0, y: 0, face: 1, rot: 0, phase: 0, speed: 0, vy: 0, grounded: true, aim: null, strike: 0, strikeAng: 0, carry: false, squash: 0, hurt: 0, t: 0, scale: 1 };
  updatePose(alpha: number) {
    const p = this.pin; p.x = this.px + (this.x - this.px) * alpha; p.y = this.py + (this.y - this.py) * alpha; p.face = this.face; p.phase = this.phase;
    p.speed = clamp(Math.abs(this.vx) / T.player.run, 0, 1.25); p.vy = this.vy; p.grounded = this.grounded; p.strike = this.strikeT; p.strikeAng = this.strikeAng;
    p.aim = this.aim.on ? Math.atan2(this.aim.y - this.y, this.aim.x - this.x) : null; p.carry = !!this.held; p.squash = this.squash; p.hurt = Math.max(0, this.hurtT / 0.35); p.t = this.t;
    p.flail = this.alive ? 0 : 1;
    solvePose(p, this.pose); return p;
  }
  drawScars(R: Renderer) {
    for (const sc of this.scars) {
      const t = sc.t / sc.life; const open = t < 0.08 ? t / 0.08 : 1 - Math.pow(Math.max(0, (t - 0.25) / 0.75), 2);
      const c = Math.cos(sc.ang), s = Math.sin(sc.ang); const n = 7; const w = 0.2 * open + 0.02;
      // jagged tear: coral fringe + paper-white core
      for (let pass = 0; pass < 2; pass++) {
        const ww = pass ? w * 0.45 : w; const k = pass ? ink(0, 0, 0) : ink(0, 1, 0);
        for (let i = 0; i < n; i++) {
          const u0 = i / n - 0.5, u1 = (i + 1) / n - 0.5; const j0 = Math.sin(sc.seed + i * 2.4 + this.t * 22) * 0.07, j1 = Math.sin(sc.seed + (i + 1) * 2.4 + this.t * 22) * 0.07;
          const w0 = ww * (1 - Math.abs(u0) * 2) + 0.004, w1 = ww * (1 - Math.abs(u1) * 2) + 0.004;
          const x0 = sc.x + c * u0 * sc.len - s * j0, y0 = sc.y + s * u0 * sc.len + c * j0, x1 = sc.x + c * u1 * sc.len - s * j1, y1 = sc.y + s * u1 * sc.len + c * j1;
          R.taper(x0, y0, x1, y1, w0 * 2, w1 * 2, k);
        }
      }
    }
  }
  draw(R: Renderer, alpha: number, dt: number) {
    // ghost prints (one plate only, fading as a halftone)
    for (const gh of this.ghosts) {
      const t = gh.t / gh.life; const k = gh.plate === 1 ? ink(0, 1, 0) : ink(0, 0, 1);
      const off = gh.plate === 2 ? (1 - t) * 0.0 : 0;
      drawFigure(R, gh.pose, HERO, gh.face, 1, off, 0, inkAlpha(k, 1) as number, 1 - t * t);
    }
    const p = this.updatePose(alpha);
    const blink = this.iframes > 0.14 && this.hurtT <= 0 && Math.floor(this.t * 18) % 2 === 0;
    // scarf
    const nx = this.pose[J.chest * 2] - this.face * 0.08, ny = this.pose[J.chest * 2 + 1] - 0.12;
    this.scarf.update(nx, ny, Math.min(dt, 0.033), -this.face * 26 - this.vx * 5, this.t);
    if (!blink) {
      // the hero is a misprint: a sun-plate copy sits a few points off
      drawFigure(R, this.pose, HERO, this.face, 1, -0.045 * this.face, 0.03, ink(0, 0, 1));
      this.scarf.draw(R, 0.13, 0.05, ink(0, 1, 0));
      drawFigure(R, this.pose, HERO, this.face, 1);
      R.circle(nx + this.face * 0.03, ny + 0.03, 0.1, ink(0, 1, 0), 8);
    }
    if (this.heavyArmed > 0) {
      const R0 = this.s.heavyR; const a0 = this.t * 2.2;
      for (let i = 0; i < 12; i++) R.ring(p.x, p.y, R0, 0.06, ink(0, 1, 0), 5, a0 + (i / 12) * TAU, a0 + ((i + 0.55) / 12) * TAU);
    }
  }
  drawAim(R: Renderer) {
    const A = this.aim; if (!A.on && this.denyT <= 0) return;
    const s = this.s;
    if (A.on) {
      // range ring (dashed)
      const n = 48; for (let i = 0; i < n; i += 2) R.ring(this.x, this.y, s.range, 0.045, ink(1, 0, 0, 0.5), 3, (i / n) * TAU, ((i + 0.8) / n) * TAU);
    }
    const shake = this.denyT > 0 ? Math.sin(this.denyT * 90) * 0.12 : 0; const x = A.x + shake, y = A.y;
    const k = A.valid ? ink(0, 1, 0) : ink(1, 0, 0);
    if (A.valid && A.on) {
      // where the body will be printed
      const pin = this.pin; const sx = pin.x, sy = pin.y; pin.x = x; pin.y = y; const tmp = solvePose(pin, new Float32Array(J.N * 2)); pin.x = sx; pin.y = sy;
      drawFigure(R, tmp, HERO, this.face, 1, 0, 0, ink(0, 0, 0.9));
    }
    // registration mark
    const r = 0.36; R.ring(x, y, r, 0.055, k, 20); R.line(x - r * 1.7, y, x - r * 0.35, y, 0.05, k); R.line(x + r * 0.35, y, x + r * 1.7, y, 0.05, k); R.line(x, y - r * 1.7, x, y - r * 0.35, 0.05, k); R.line(x, y + r * 0.35, x, y + r * 1.7, 0.05, k);
    if (!A.valid) { R.line(x - r, y - r, x + r, y + r, 0.08, k); R.line(x - r, y + r, x + r, y - r, 0.08, k); }
    if (this.heavyArmed > 0 && A.valid) { const R0 = s.heavyR; const a0 = -this.t * 2.2; for (let i = 0; i < 12; i++) R.ring(x, y, R0, 0.05, ink(0, 1, 0), 5, a0 + (i / 12) * TAU, a0 + ((i + 0.55) / 12) * TAU); }
    if (A.enemy && A.valid) { const e = A.enemy; R.ring(e.x, e.y, e.radius + 0.35, 0.07, ink(0, 1, 0), 18); }
  }
}
