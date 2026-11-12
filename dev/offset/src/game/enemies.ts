// The Register: hunters that keep the world "in register". Physical bodies — most kills come from impacts.
import { RAPIER, GR, G, groups } from '../phys/world';
import { T } from '../core/tune';
import { clamp, approach, hypot, TAU, lerp } from '../core/math';
import { bus } from '../core/bus';
import { vrng } from '../core/rng';
import { Renderer, ink, inkAlpha, Ink } from '../gfx/gl';
import { solvePose, drawFigure, Pose, PoseIn, J, FigStyle } from './figure';
import type { Game } from './game';
import type { Hittable } from './types';

export type EnemyKind = 'grunt' | 'shooter' | 'shield' | 'heavy' | 'tracer' | 'anchor' | 'boss';
export interface EnemyDef {
  kind: EnemyKind; hp: number; speed: number; mass: number; scale: number; bulk: number; ink: number; // ink reward
  fig: FigStyle['kind']; windup: number; recover: number; cooldown: number; threat: number;
}
export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  grunt: { kind: 'grunt', hp: 60, speed: 4.4, mass: 80, scale: 1, bulk: 1.05, ink: 6, fig: 'grunt', windup: 0.46, recover: 0.6, cooldown: 0.5, threat: 1 },
  shooter: { kind: 'shooter', hp: 45, speed: 3.4, mass: 70, scale: 0.98, bulk: 0.92, ink: 8, fig: 'shooter', windup: 0.8, recover: 0.35, cooldown: 1.9, threat: 1.5 },
  shield: { kind: 'shield', hp: 95, speed: 2.5, mass: 110, scale: 1.06, bulk: 1.2, ink: 11, fig: 'shield', windup: 0.55, recover: 0.8, cooldown: 0.7, threat: 2 },
  tracer: { kind: 'tracer', hp: 50, speed: 6.6, mass: 62, scale: 1.02, bulk: 0.8, ink: 12, fig: 'tracer', windup: 0.3, recover: 0.5, cooldown: 0.45, threat: 2.2 },
  heavy: { kind: 'heavy', hp: 210, speed: 2.9, mass: 230, scale: 1.34, bulk: 1.5, ink: 20, fig: 'heavy', windup: 0.85, recover: 1.6, cooldown: 1.4, threat: 3.5 },
  boss: { kind: 'boss', hp: 1000, speed: 2.7, mass: 520, scale: 1.85, bulk: 1.65, ink: 160, fig: 'heavy', windup: 0.8, recover: 1.9, cooldown: 1.1, threat: 30 },
  anchor: { kind: 'anchor', hp: 34, speed: 1.9, mass: 40, scale: 1, bulk: 1, ink: 14, fig: 'grunt', windup: 0, recover: 0, cooldown: 0, threat: 2.5 },
};
type State = 'spawn' | 'chase' | 'windup' | 'attack' | 'recover' | 'knocked' | 'held' | 'dive' | 'dead';
const STYLE: Record<string, FigStyle> = {
  grunt: { body: ink(1, 0, 0), back: ink(1, 0, 0.35), accent: ink(0, 0, 1), kind: 'grunt', bulk: 1.05 },
  shooter: { body: ink(1, 0, 0), back: ink(1, 0, 0.35), accent: ink(0, 0, 1), kind: 'shooter', bulk: 0.92 },
  shield: { body: ink(1, 0, 0), back: ink(1, 0, 0.35), accent: ink(0, 0, 1), kind: 'shield', bulk: 1.2 },
  tracer: { body: ink(1, 0, 0.5), back: ink(1, 0, 0.7), accent: ink(0, 0, 1), kind: 'tracer', bulk: 0.8 },
  heavy: { body: ink(1, 0, 0), back: ink(1, 0, 0.35), accent: ink(0, 0, 1), kind: 'heavy', bulk: 1.5 },
  boss: { body: ink(1, 0, 0), back: ink(1, 0, 0.5), accent: ink(0, 1, 0), kind: 'heavy', bulk: 1.65 },
};
export const ANCHOR_R = 4.3;
export const BOSS_PULSE_R = 8;

export class Enemy implements Hittable {
  rb: RAPIER.RigidBody; col: RAPIER.Collider;
  x = 0; y = 0; px = 0; py = 0; vx = 0; vy = 0; rot = 0; prot = 0;
  face = 1; state: State = 'spawn'; st = 0; hp: number; maxHp: number; alive = true; radius: number; kind: string;
  held = false; grabbable = false; movable = true; elite = false;
  grounded = false; phase = 0; flashT = 0; cd = 0; leapCd = 0; faceT = 0; aimAng = 0; heldT = 0; thrown = 0; lastCause = 'impact';
  big = false; phaseN = 1; atk: 'charge' | 'stomp' | 'volley' = 'charge'; impactCd = 0; summonT = 9; pulseT = 6; jamT = 0;
  deadT = 0; hpShow = 0; t = vrng.range(0, 10); stuckT = 0; losT = 0; chargeDir = 1; diveX = 0; diveY = 0; didHit = false;
  pose: Pose = new Float32Array(J.N * 2);
  def: EnemyDef;
  constructor(public g: Game, kind: EnemyKind, x: number, y: number, elite = false) {
    const d = (this.def = ENEMIES[kind]); this.kind = kind; this.elite = elite;
    this.maxHp = this.hp = d.hp * (elite ? 1.8 : 1) * g.enemyHpK; this.radius = 0.5 * d.scale;
    const w = g.phys.world; const fly = kind === 'anchor';
    const bd = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y).setCcdEnabled(true).setLinearDamping(fly ? 2.5 : 0).setAngularDamping(1.2).setCanSleep(false);
    if (fly) bd.setGravityScale(0);
    this.rb = w.createRigidBody(bd); this.rb.lockRotations(true, true);
    const cd = fly ? RAPIER.ColliderDesc.ball(0.42) : RAPIER.ColliderDesc.capsule(0.48 * d.scale, 0.33 * d.scale);
    this.col = w.createCollider(cd.setMass(d.mass).setFriction(0.05).setRestitution(0.05).setCollisionGroups(GR.enemy)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(T.impact.enemyJMin * 30), this.rb);
    g.phys.ref(this.col, 'enemy', this);
    this.x = this.px = x; this.y = this.py = y; this.big = kind === 'heavy' || kind === 'boss'; this.movable = kind !== 'boss';
    bus.emit('enemyAlert', { x, y, kind });
  }
  private set(s: State) { this.state = s; this.st = 0; this.didHit = false; }
  teleported(_dx: number, _dy: number) { const t = this.rb.translation(); this.x = this.px = t.x; this.y = this.py = t.y; if (this.state !== 'held' && this.state !== 'dead') this.knock(0.9); }
  onGrab() { this.held = true; this.heldT = 0; this.set('held'); this.col.setCollisionGroups(groups(G.ENEMY, G.STATIC)); this.rb.lockRotations(true, true); this.rb.setRotation(0, true); }
  onRelease(vx: number, vy: number) {
    this.held = false; this.col.setCollisionGroups(GR.enemy); this.rb.setLinvel({ x: vx, y: vy }, true); this.thrown = 1.5; this.lastCause = 'throw'; this.knock(1.0);
  }
  knock(minT = 0.7) {
    if (this.state === 'dead' || this.state === 'held') return;
    this.set('knocked'); this.st = -minT; this.grabbable = !this.big;
    if (this.kind !== 'anchor') { this.rb.lockRotations(false, true); this.rb.setAngvel(vrng.range(-9, 9), true); this.col.setFriction(0.55); }
    else this.rb.setGravityScale(1, true);
  }
  private standUp() {
    this.grabbable = false; this.col.setFriction(0.05);
    if (this.kind === 'anchor') { this.rb.setGravityScale(0, true); this.set('chase'); return; }
    const t = this.rb.translation(); this.rb.setRotation(0, true); this.rb.setAngvel(0, true); this.rb.lockRotations(true, true);
    this.rb.setTranslation({ x: t.x, y: t.y - 0.35 }, true); this.set('recover'); this.st = this.def.recover * 0.5;
  }
  /** from player strikes/bursts and explosions */
  hit(dmg: number, vx: number, vy: number, cause: string) {
    if (!this.alive) return;
    const sp = hypot(vx, vy);
    if (this.kind === 'shield' && (cause === 'strike' || cause === 'burst') && this.state !== 'knocked' && this.state !== 'held' && this.state !== 'recover' && sp > 0.1 && Math.sign(vx) === -this.face && Math.abs(vy) < Math.abs(vx) * 1.4) {
      // blocked by the platen
      this.rb.setLinvel({ x: vx * 0.22, y: Math.min(this.vy, 0) }, true); this.flashT = 0.08;
      this.g.fx.burst(this.x + this.face * 0.5, this.y, 7, 9, ink(0, 0, 1), 'spark', this.face, -0.3, 1.6);
      bus.emit('enemyHit', { x: this.x, y: this.y, dmg: 0, kind: this.kind, cause: 'block' }); return;
    }
    if (this.kind === 'boss') { const dazed = this.state === 'recover'; dmg *= dazed ? 1.25 : 0.3; vx *= 0.08; vy *= 0.08; }
    else if (this.kind === 'heavy' && this.state !== 'recover' && this.state !== 'knocked') { dmg *= 0.6; vx *= 0.3; vy *= 0.3; }
    this.lastCause = cause;
    if (sp > 0.1) { const m = this.state === 'held' ? 0 : 1; this.rb.setLinvel({ x: this.vx * 0.25 + vx * m, y: Math.min(this.vy, 0) * 0.25 + vy * m }, true); }
    if ((sp > 4.5 || dmg >= 18) && !this.big) { if (this.state !== 'held') this.knock(); if (cause === 'strike' || cause === 'throw') this.thrown = 1.2; }
    else if (this.kind === 'heavy' && (sp > 12 || dmg > 60) && this.state !== 'knocked') this.knock(1.0);
    if (this.kind === 'boss' && cause !== 'strike' && cause !== 'burst' && cause !== 'slam') dmg = Math.min(dmg, this.maxHp * 0.12);
    this.damage(dmg, cause);
  }
  damage(dmg: number, cause: string) {
    if (!this.alive || dmg <= 0) return;
    this.hp -= dmg; this.flashT = 0.12; this.hpShow = 2.5; this.lastCause = cause;
    bus.emit('enemyHit', { x: this.x, y: this.y, dmg, kind: this.kind, cause });
    this.g.fx.burst(this.x, this.y, 3 + Math.min(8, dmg / 10), 8, ink(1, 0, 0), 'scrap');
    if (this.kind === 'boss' && this.alive) { const ph = this.hp < this.maxHp * 0.33 ? 3 : this.hp < this.maxHp * 0.66 ? 2 : 1; if (ph > this.phaseN && this.hp > 0) { this.phaseN = ph; this.cd = 1.2; this.g.st.blast(this.x, this.y, 5, 1200, 900); this.g.pushPlayer(this.x, this.y, 5.5, 13); this.g.cam.shake(0.8); this.g.fx.warp(this.x, this.y, 0.5, 9, 0.9, 0.6); bus.emit('bossPhase', { phase: ph }); } }
    if (this.hp <= 0) this.die(cause);
  }
  die(cause: string) {
    if (!this.alive) return; this.alive = false; this.set('dead'); this.grabbable = false;
    if (this.held) { this.g.player.held = null; this.held = false; }
    this.col.setCollisionGroups(GR.corpse); this.rb.lockRotations(false, true); this.rb.setGravityScale(1, true);
    const fx = this.g.fx;
    for (let i = 0; i < 16; i++) fx.scrap(this.x + vrng.range(-0.3, 0.3), this.y + vrng.range(-0.7, 0.7), this.vx * 0.5 + vrng.range(-6, 6), this.vy * 0.5 + vrng.range(-8, 2), vrng.range(0.06, 0.16), i % 3 ? ink(1, 0, 0) : ink(0, 0, 1), vrng.range(0.8, 1.6));
    for (let i = 0; i < 5; i++) fx.sheet(this.x, this.y - 0.2, vrng.range(-5, 5), vrng.range(-7, -1), vrng.range(0.14, 0.24), i & 1 ? ink(0, 0, 1) : ink(0.5, 0, 0));
    fx.ring(this.x, this.y, 0.3, 1.9, 0.25, 0.3, ink(0, 0, 1));
    bus.emit('enemyDie', { x: this.x, y: this.y, kind: this.kind, cause, elite: this.elite });
    this.g.onEnemyDie(this, cause);
  }
  /** physical impact (J excess already thresholded by game) */
  impact(j: number, other: 'static' | 'debris' | 'enemy' | 'prop') {
    if (!this.alive) return;
    let dmg = (j - T.impact.enemyJMin) * T.impact.enemyK; if (dmg <= 0) return;
    if (this.thrown > 0) dmg *= 1.35;
    if (this.kind === 'heavy') dmg *= this.state === 'attack' ? 0.12 : 0.55;
    if (this.kind === 'boss') { if (this.impactCd > 0 || (this.state === 'attack' && other === 'static')) return; dmg = Math.min(dmg * 1.4, this.maxHp * 0.2); if (dmg > 40) { this.impactCd = 0.7; if (this.state !== 'recover') { this.set('recover'); this.st = 0.4; } } }
    if (this.kind === 'shield' && this.state !== 'knocked') dmg *= 0.6;
    const cause = other === 'prop' ? 'throw' : other === 'debris' ? 'debris' : other === 'enemy' ? 'bowling' : this.thrown > 0 ? this.lastCause === 'throw' ? 'throw' : 'slam' : 'fall';
    if (dmg > 14 && this.state !== 'held' && !this.big) { if (this.state !== 'knocked') this.knock(0.5); }
    this.damage(dmg, cause);
  }

  // ------------------------------------------------------------------ AI (fixed step)
  pre(h: number) {
    const g = this.g, p = g.player, d = this.def, ph = g.phys;
    const v = this.rb.linvel(); this.vx = v.x; this.vy = v.y; this.st += h; this.t += h;
    if (this.flashT > 0) this.flashT -= h; if (this.hpShow > 0) this.hpShow -= h; if (this.cd > 0) this.cd -= h; if (this.leapCd > 0) this.leapCd -= h; if (this.thrown > 0) this.thrown -= h; if (this.impactCd > 0) this.impactCd -= h; if (this.jamT > 0) this.jamT -= h;
    if (this.state === 'dead') { this.deadT += h; return; }
    const t = this.rb.translation();
    if (t.y > g.level.groundY + 6 || t.x < g.level.x0 - 6 || t.x > g.level.x1 + 6) { this.die('fall'); return; }
    const dx = p.x - t.x, dy = p.y - t.y; const dist = hypot(dx, dy); const sgn = Math.sign(dx) || 1;
    const sp = d.speed * (this.elite ? 1.15 : 1) * g.enemySpeedK;
    if (this.kind === 'anchor') { this.aiAnchor(h, dx, dy, dist, sp); return; }
    const feet = t.y + 0.8 * d.scale - 0.1;
    this.grounded = this.vy > -2 && ph.castRay(t.x, feet, 0, 1, 0.22, GR.qSolid, this.rb);
    let want = 0; let setV = true;
    switch (this.state) {
      case 'spawn': if (this.st > 0.75) this.set('chase'); setV = false; this.rb.setLinvel({ x: 0, y: Math.min(this.vy, 3) }, true); break;
      case 'held': {
        this.heldT += h; setV = false;
        if (this.heldT > 3.4) { p.dropHeld(); }
        break;
      }
      case 'knocked': {
        setV = false;
        if (this.st > 0 && hypot(this.vx, this.vy) < 1.6 && this.st > 0.15) { this.stuckT += h; if (this.stuckT > 0.45) { this.stuckT = 0; this.standUp(); } } else this.stuckT = 0;
        if (this.st > 4) this.standUp();
        break;
      }
      case 'recover': if (this.st > d.recover) { this.set('chase'); this.grabbable = false; } else this.grabbable = !this.big; want = 0; break;
      case 'dive': { // tracer inside a scar
        setV = false; this.rb.setLinvel({ x: 0, y: 0 }, true);
        if (this.st > 0.5) { this.rb.setTranslation({ x: this.diveX, y: this.diveY }, true); this.px = this.x = this.diveX; this.py = this.y = this.diveY; this.col.setCollisionGroups(GR.enemy); this.rb.setGravityScale(1, true); this.face = Math.sign(p.x - this.diveX) || 1; this.set('windup'); this.st = d.windup * 0.35; g.fx.ring(this.diveX, this.diveY, 0.2, 1.6, 0.2, 0.25, ink(0, 0, 1)); bus.emit('enemyTelegraph', { x: this.x, y: this.y, kind: this.kind }); }
        break;
      }
      case 'chase': {
        if (!p.alive) { want = 0; break; }
        // facing (the shield turns slowly — that is the opening)
        if (this.kind === 'shield') { if (sgn !== this.face) { this.faceT += h; if (this.faceT > 0.6) { this.face = sgn; this.faceT = 0; } } else this.faceT = 0; }
        else this.face = sgn;
        if (this.kind === 'shooter') {
          const los = !ph.castRay(t.x, t.y - 0.3, dx / dist, dy / dist, Math.max(0.1, dist - 0.6), GR.qStaticDebris);
          if (los) this.losT = 0; else this.losT += h;
          if (dist < 4.2) want = -sgn * sp; else if (dist > 10.5 || this.losT > 1.4) want = sgn * sp; else want = 0;
          if (los && this.cd <= 0 && dist < 15) { this.set('windup'); this.aimAng = Math.atan2(dy, dx); bus.emit('enemyTelegraph', { x: this.x, y: this.y, kind: this.kind }); }
        } else if (this.kind === 'boss') {
          want = Math.abs(dx) > 2.6 ? sgn * sp * (this.phaseN === 3 ? 1.35 : 1) : 0;
          this.summonT -= h; this.pulseT -= h;
          if (this.phaseN >= 2 && this.summonT <= 0 && g.enemies.length < 6) { this.summonT = 13; g.spawnEnemy(this.phaseN === 3 ? 'shooter' : 'grunt', t.x - 5 * sgn, t.y - 1, false); g.spawnEnemy('grunt', t.x + 4 * sgn, t.y - 1, false); }
          if (this.phaseN >= 3 && this.pulseT <= 0) { this.pulseT = 9.5; this.jamT = 4; bus.emit('enemyTelegraph', { x: this.x, y: this.y, kind: 'pulse' }); }
          if (this.cd <= 0 && this.grounded) {
            if (dist < 4.6) this.atk = 'stomp'; else if (this.phaseN >= 2 && (dist > 9 || Math.abs(dy) > 3)) this.atk = 'volley'; else if (Math.abs(dy) < 3.2) this.atk = 'charge'; else this.atk = this.phaseN >= 2 ? 'volley' : 'stomp';
            this.set('windup'); this.chargeDir = sgn; this.face = sgn; this.aimAng = Math.atan2(dy, dx); bus.emit('enemyTelegraph', { x: this.x, y: this.y, kind: this.kind });
          }
        } else if (this.kind === 'heavy') {
          want = Math.abs(dx) > 2.2 ? sgn * sp : 0;
          if (this.cd <= 0 && Math.abs(dy) < 2.2 && Math.abs(dx) < 9.5 && this.grounded) { this.set('windup'); this.chargeDir = sgn; this.face = sgn; bus.emit('enemyTelegraph', { x: this.x, y: this.y, kind: this.kind }); }
        } else {
          const reach = this.kind === 'shield' ? 1.5 : 1.35;
          want = Math.abs(dx) > reach * 0.7 ? this.face * sp : 0;
          if (this.cd <= 0 && Math.abs(dx) < reach && Math.abs(dy) < 1.5) { this.set('windup'); bus.emit('enemyTelegraph', { x: this.x, y: this.y, kind: this.kind }); }
          else if (this.grounded && this.leapCd <= 0 && dy < -1.6 && dy > -5.2 && Math.abs(dx) < 4.5 && this.kind !== 'shield') { this.vy = -Math.min(15.5, 6.5 + Math.sqrt(-dy) * 5.2); this.vx = sgn * Math.min(6, Math.abs(dx) * 1.6); this.rb.setLinvel({ x: this.vx, y: this.vy }, true); this.leapCd = 1.8; setV = false; }
        }
        // obstacle ahead → hop over; no ground ahead → stop unless the hero is below
        if (want !== 0 && this.grounded) {
          const dir = Math.sign(want);
          if (ph.castRay(t.x, t.y + 0.25, dir, 0, 0.7, GR.qSolid, this.rb)) { if (!ph.castRay(t.x, t.y - 1.6, dir, 0, 0.9, GR.qSolid, this.rb) && this.leapCd <= 0) { this.vy = -10.5; this.leapCd = 0.7; } else { this.stuckT += h; if (this.stuckT > 1.2 && this.leapCd <= 0) { this.vy = -12; this.leapCd = 1; this.stuckT = 0; } } }
          else if (dy < 1 && !ph.castRay(t.x + dir * 0.7, feet, 0, 1, 2.6, GR.qSolid, this.rb)) want = 0;
        }
        break;
      }
      case 'windup': {
        want = 0;
        if (this.kind === 'shooter') {
          // track the hero, but lazily → a jump breaks the aim
          const ta = Math.atan2(dy, dx); let da = ta - this.aimAng; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU; this.aimAng += clamp(da, -1.5 * h, 1.5 * h); this.face = Math.cos(this.aimAng) >= 0 ? 1 : -1;
          if (this.st > d.windup) { g.shoot(t.x + Math.cos(this.aimAng) * 0.7, t.y - 0.3 + Math.sin(this.aimAng) * 0.7, this.aimAng, this); this.cd = d.cooldown * vrng.range(0.85, 1.2) / g.enemySpeedK; this.set('recover'); this.rb.setLinvel({ x: -Math.cos(this.aimAng) * 2.5, y: this.vy }, true); setV = false; bus.emit('enemyShoot', { x: this.x, y: this.y, kind: this.kind }); }
        } else if (this.kind === 'boss' && this.atk !== 'charge') {
          if (this.st > d.windup * (this.phaseN === 3 ? 0.8 : 1)) {
            if (this.atk === 'stomp') { const fy = t.y + 0.8 * d.scale; g.st.blast(t.x, fy, 5, 1500, 1100); g.cam.shake(0.7); g.fx.warp(t.x, fy, 0.4, 7, 0.8, 0.5); g.fx.ring(t.x, fy, 0.5, 5.2, 0.4, 0.4, ink(0, 0, 1)); if (Math.abs(dx) < 5 && dy > -2.2 && dy < 2.5 && p.grounded) p.hurt(1, t.x, 'stomp'); else g.pushPlayer(t.x, fy, 5.5, 9); bus.emit('explode', { x: t.x, y: fy, r: 5 }); }
            else { const n = this.phaseN === 3 ? 7 : 5; for (let i = 0; i < n; i++) g.shoot(t.x + Math.cos(this.aimAng) * 1.2, t.y - 0.8 + Math.sin(this.aimAng) * 1.2, this.aimAng + (i - (n - 1) / 2) * 0.14, this); bus.emit('enemyShoot', { x: this.x, y: this.y, kind: this.kind }); }
            this.cd = d.cooldown * (this.phaseN === 3 ? 0.7 : 1); this.set('recover'); this.st = d.recover * 0.55;
          }
        } else if (this.st > d.windup) { this.set('attack'); if (this.big) this.face = this.chargeDir; }
        break;
      }
      case 'attack': {
        if (this.big) {
          want = this.chargeDir * (this.kind === 'boss' ? 15 : 13.5); this.vx = want; // bull charge: walls are not an argument
          if (!this.didHit && Math.abs(dx) < 1.5 * d.scale && Math.abs(dy) < 1.6 * d.scale && p.hurt(1, t.x, 'charge')) this.didHit = true;
          if (this.st > 0.2 && Math.abs(v.x) < 3.5) { // stopped by something solid → dazed
            this.set('recover'); this.cd = d.cooldown; g.cam.shake(0.35); g.fx.burst(t.x + this.chargeDir * 0.6, t.y, 10, 9, ink(0, 0, 1), 'spark'); bus.emit('impact', { x: t.x, y: t.y, force: 3000, mat: 'metal' });
          } else if (this.st > 1.25) { this.set('recover'); this.st = d.recover * 0.5; this.cd = d.cooldown; }
        } else {
          want = this.face * (this.kind === 'tracer' ? 13 : 9);
          if (!this.didHit && Math.abs(dx) < 1.55 && Math.abs(dy) < 1.5 && Math.sign(dx) === this.face) { if (p.hurt(1, t.x, this.kind)) this.didHit = true; }
          if (this.st > 0.16) { this.set('recover'); this.cd = d.cooldown; }
        }
        break;
      }
    }
    if (setV) {
      const acc = this.grounded ? 40 : 12;
      this.vx = this.state === 'attack' ? want : approach(this.vx, want, acc * h);
      this.rb.setLinvel({ x: this.vx, y: this.vy }, true);
    }
    if (this.grounded && Math.abs(this.vx) > 0.3) this.phase += Math.abs(this.vx) * h * 1.5;
  }
  private aiAnchor(h: number, dx: number, dy: number, dist: number, sp: number) {
    if (this.state === 'spawn') { if (this.st > 0.75) this.set('chase'); this.rb.setLinvel({ x: 0, y: 0 }, true); return; }
    if (this.state === 'held') { this.heldT += h; if (this.heldT > 3.4) this.g.player.dropHeld(); return; }
    if (this.state === 'knocked') { if (this.st > 1.3) this.standUp(); return; }
    // hover: keep above and near the hero, bob gently
    const tx = dx, ty = dy - 2.6 + Math.sin(this.t * 1.7) * 0.5; const l = hypot(tx, ty) || 1;
    const k = l > 1.2 ? sp : sp * l / 1.2; this.rb.setLinvel({ x: lerp(this.vx, (tx / l) * k, 0.06), y: lerp(this.vy, (ty / l) * k, 0.06) }, true);
  }
  get jamming() { return this.alive && ((this.kind === 'anchor' && this.state === 'chase') || (this.kind === 'boss' && this.jamT > 0 && this.jamT < 3)); }
  get jamR() { return this.kind === 'boss' ? BOSS_PULSE_R : ANCHOR_R; }
  post() {
    this.px = this.x; this.py = this.y; this.prot = this.rot; const t = this.rb.translation(); this.x = t.x; this.y = t.y; this.rot = this.rb.rotation();
    const v = this.rb.linvel();
    if (this.big && this.state === 'attack') { for (const r of this.g.st.punched) if (r.obj === this) { this.rb.setLinvel({ x: this.chargeDir * 12.5, y: v.y }, true); this.g.cam.shake(0.25); break; } }
    else if (this.thrown > 0) { for (const r of this.g.st.punched) if (r.obj === this) { this.rb.setLinvel({ x: this.vx * 0.7, y: this.vy * 0.7 }, true); break; } }
    this.vx = v.x; this.vy = v.y;
  }
  /** tracer: follow the hero through a fresh scar */
  tryDive(sx: number, sy: number, ex: number, ey: number) {
    if (this.kind !== 'tracer' || !this.alive || this.state !== 'chase') return;
    if (hypot(this.x - sx, this.y - sy) > 9 || this.cd > 0.2) return;
    this.set('dive'); this.diveX = ex + vrng.sign() * 1.3; this.diveY = ey - 0.1; this.cd = 2.2;
    this.col.setCollisionGroups(groups(G.CORPSE, 0)); this.rb.setGravityScale(0, true);
    this.g.fx.burst(this.x, this.y, 10, 12, ink(0, 0, 1), 'spark', sx - this.x, sy - this.y, 0.6);
    this.g.fx.ring(ex, ey, 1.6, 0.3, 0.12, 0.5, ink(0, 0, 1));
  }

  // ------------------------------------------------------------------ draw
  private pin: PoseIn = { x: 0, y: 0, face: 1, rot: 0, phase: 0, speed: 0, vy: 0, grounded: true, aim: null, strike: 0, strikeAng: 0, carry: false, squash: 0, hurt: 0, t: 0, scale: 1 };
  draw(R: Renderer, alpha: number) {
    const d = this.def; const x = this.px + (this.x - this.px) * alpha, y = this.py + (this.y - this.py) * alpha; const rot = this.prot + (this.rot - this.prot) * alpha;
    if (this.state === 'dive') return;
    let a = 1; if (this.state === 'dead') { a = 1 - this.deadT / 0.55; if (a <= 0) return; }
    const flash = this.flashT > 0;
    if (this.kind === 'anchor') { this.drawAnchor(R, x, y, a, flash); return; }
    const st = STYLE[d.kind]; const p = this.pin;
    p.x = x; p.y = y; p.face = this.face; p.rot = rot; p.phase = this.phase; p.speed = clamp(Math.abs(this.vx) / d.speed, 0, 1.2); p.vy = this.vy; p.grounded = this.grounded && this.state !== 'knocked';
    p.t = this.t; p.scale = d.scale; p.flail = this.state === 'knocked' || this.state === 'held' || this.state === 'dead' ? 1 : 0; p.guard = this.kind === 'shield' && (this.state === 'chase' || this.state === 'windup');
    p.aim = this.kind === 'shooter' && (this.state === 'windup' || this.state === 'chase') ? (this.state === 'windup' ? this.aimAng : (this.face > 0 ? 0.25 : Math.PI - 0.25)) : null;
    p.windup = this.state === 'windup' && this.kind !== 'shooter' ? clamp(this.st / d.windup, 0, 1) : 0;
    p.strike = this.state === 'attack' && !this.big ? clamp(this.st / 0.16, 0.01, 1) * 0.6 : 0; p.strikeAng = this.face > 0 ? -0.1 : Math.PI + 0.1;
    p.crouch = this.big && this.state === 'windup' ? 0.8 : this.state === 'recover' ? 0.5 : 0; p.hurt = 0; p.squash = 0; p.carry = false;
    solvePose(p, this.pose);
    // print-in: registration cross, then the sun plate, then the key plate
    if (this.state === 'spawn') {
      const k = this.st / 0.75; const r = 0.5 * d.scale; const kk = ink(0, 0, 1);
      R.ring(x, y, r * (1.6 - 0.6 * k), 0.05, kk, 18); R.line(x - r * 2, y, x + r * 2, y, 0.04, kk); R.line(x, y - r * 2, x, y + r * 2, 0.04, kk);
      if (k > 0.3) drawFigure(R, this.pose, st, this.face, d.scale, (1 - k) * 0.5, 0, ink(0, 0, 0.9));
      if (k > 0.65) drawFigure(R, this.pose, st, this.face, d.scale, 0, 0, 0, (k - 0.65) / 0.35);
      return;
    }
    if (this.elite) drawFigure(R, this.pose, st, this.face, d.scale, 0.06, -0.05, ink(0, 0, 1));
    drawFigure(R, this.pose, st, this.face, d.scale, 0, 0, flash ? ink(0, 0, 0) : 0, a);
    if (a < 1) return;
    const P = this.pose; const hx = P[J.haL * 2], hy = P[J.haL * 2 + 1];
    if (this.kind === 'shooter') {
      const ang = this.state === 'windup' ? this.aimAng : (this.face > 0 ? 0.25 : Math.PI - 0.25); const c = Math.cos(ang), s = Math.sin(ang);
      R.line(hx - c * 0.25, hy - s * 0.25, hx + c * 0.65, hy + s * 0.65, 0.11, ink(1, 0, 0)); R.line(hx + c * 0.3, hy + s * 0.3, hx + c * 0.65, hy + s * 0.65, 0.05, ink(0, 0, 1));
      if (this.state === 'windup') {
        // sight line: dashed sun-plate rule that tightens before the shot
        const k = this.st / d.windup; const len = 16; const n = 26;
        for (let i = 0; i < n; i += 2) R.line(this.x + c * (0.9 + (i / n) * len), this.y - 0.3 + s * (0.9 + (i / n) * len), this.x + c * (0.9 + ((i + 1) / n) * len), this.y - 0.3 + s * (0.9 + ((i + 1) / n) * len), 0.03 + 0.07 * k, k > 0.75 ? ink(0, 1, 0) : ink(0, 0, 1));
      }
    } else if (this.kind === 'shield' && this.state !== 'knocked' && this.state !== 'held') {
      const sx = x + this.face * 0.52 * d.scale; const w = 0.14, hh = 0.86 * d.scale;
      R.rect(sx - w * 0.5, y - hh * 0.75, w, hh * 1.5, ink(0, 0, 0)); R.rect(sx - w * 0.5, y - hh * 0.75, w, hh * 1.5, ink(0.35, 0, 1));
      R.rect(sx - w * 0.5 - 0.03, y - hh * 0.75, 0.03, hh * 1.5, ink(1, 0, 0)); R.rect(sx + w * 0.5, y - hh * 0.75, 0.03, hh * 1.5, ink(1, 0, 0));
    } else if (this.kind === 'grunt' || this.kind === 'tracer') {
      // baton / blade
      const ex = P[J.elL * 2], ey = P[J.elL * 2 + 1]; let ux = hx - ex, uy = hy - ey; const l = hypot(ux, uy) || 1; ux /= l; uy /= l;
      R.line(hx, hy, hx + ux * (this.kind === 'tracer' ? 0.7 : 0.5), hy + uy * (this.kind === 'tracer' ? 0.7 : 0.5), this.kind === 'tracer' ? 0.05 : 0.09, this.kind === 'tracer' ? ink(0, 0, 1) : ink(1, 0, 0));
    }
    // attack telegraph: a sun-plate ring that closes in
    if (this.state === 'windup' && this.kind !== 'shooter') { const k = clamp(this.st / d.windup, 0, 1); R.ring(x, y - 0.1, (1.7 - k * 0.9) * d.scale, 0.06 + k * 0.05, k > 0.7 ? ink(0, 1, 0) : ink(0, 0, 1), 26); if (this.big && (this.kind === 'heavy' || this.atk === 'charge')) { const q = d.scale; R.tri(x + this.chargeDir * 1.4 * q, y - 0.35 * q, x + this.chargeDir * 1.4 * q, y + 0.35 * q, x + this.chargeDir * 2.2 * q, y, ink(0, 0, 1)); } if (this.kind === 'boss' && this.atk === 'stomp') R.ring(x, y + 0.8 * d.scale, 5 * k, 0.12, ink(0, 0, 1), 40); if (this.kind === 'boss' && this.atk === 'volley') { const n = this.phaseN === 3 ? 7 : 5; for (let i = 0; i < n; i++) { const a = this.aimAng + (i - (n - 1) / 2) * 0.14; R.line(x + Math.cos(a) * 1.4, y - 0.8 + Math.sin(a) * 1.4, x + Math.cos(a) * 14, y - 0.8 + Math.sin(a) * 14, 0.03 + 0.05 * k, k > 0.75 ? ink(0, 1, 0) : ink(0, 0, 1)); } } }
    if (this.grabbable && this.state !== 'held') { const r = 0.2; R.ring(x, y - 1.25 * d.scale, r, 0.045, ink(0, 1, 0), 12); R.circle(x, y - 1.25 * d.scale, 0.07, ink(0, 1, 0), 8); }
    if (this.kind === 'boss' && this.jamT > 0) { const on = this.jamT < 3; const n = 56; const a0 = this.t * 0.6; for (let i = 0; i < n; i += 2) R.ring(x, y, BOSS_PULSE_R, on ? 0.1 : 0.04, ink(0, 0, 1), 4, a0 + (i / n) * TAU, a0 + ((i + 1) / n) * TAU); if (on) R.circle(x, y, BOSS_PULSE_R, ink(0, 0, 0.16, 0.6), 56); }
    if (this.kind !== 'boss') this.drawHp(R, x, y - 1.15 * d.scale);
  }
  private drawHp(R: Renderer, x: number, y: number) {
    if (this.hpShow <= 0 || !this.alive) return; const n = this.maxHp > 150 ? 8 : 5; const w = 0.16, gap = 0.05; const tot = n * w + (n - 1) * gap; const k = clamp(this.hp / this.maxHp, 0, 1);
    for (let i = 0; i < n; i++) { const f = (i + 0.5) / n < k + 0.001; R.rect(x - tot / 2 + i * (w + gap), y - 0.12, w, 0.09, f ? ink(1, 0, 0) : ink(0.25, 0, 0)); }
  }
  private drawAnchor(R: Renderer, x: number, y: number, a: number, flash: boolean) {
    const on = this.jamming; const t = this.t;
    if (this.state === 'spawn') { const k = this.st / 0.75; R.ring(x, y, 0.5 + (1 - k), 0.05, ink(0, 0, 1), 18); if (k < 0.5) return; }
    if (on) {
      // the jam field: concentric dashed rules of the sun plate
      const n = 40; const a0 = t * 0.5; for (let i = 0; i < n; i += 2) R.ring(x, y, ANCHOR_R, 0.07, ink(0, 0, 1), 4, a0 + (i / n) * TAU, a0 + ((i + 1) / n) * TAU);
      R.circle(x, y, ANCHOR_R, ink(0, 0, 0.16, 0.6), 48);
      for (let i = 0; i < 3; i++) { const r = ((t * 0.9 + i / 3) % 1) * ANCHOR_R; R.ring(x, y, r, 0.03, ink(0, 0, 0.7, 1 - r / ANCHOR_R), 32); }
    }
    const kb = flash ? ink(0, 0, 0) : inkAlpha(ink(1, 0, 0), a);
    const rot = on ? t * 1.5 : this.rot; const c = Math.cos(rot), s = Math.sin(rot);
    R.circle(x, y, 0.42, kb, 18); R.circle(x, y, 0.27, inkAlpha(ink(0, 0, 1), a), 14); R.circle(x, y, 0.12, kb, 10);
    for (let i = 0; i < 4; i++) { const cc = Math.cos(rot + i * Math.PI / 2), ss = Math.sin(rot + i * Math.PI / 2); R.line(x + cc * 0.4, y + ss * 0.4, x + cc * 0.72, y + ss * 0.72, 0.09, kb); }
    this.drawHp(R, x, y - 0.75);
  }
}

// ---------------------------------------------------------------------- slugs (lead type)
export interface Slug { x: number; y: number; vx: number; vy: number; life: number; owner: Enemy | null; friendly: boolean; r: number; portalCd: number }
