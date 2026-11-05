// DEV ONLY (render-preview.html): drives the renderer with a fake moving sim so visuals can be screenshotted.
// URL params: track=t1|t2|t3  q=low|medium|high|auto  mode=race|menu  freeze=1 (no rAF loop, use window.__preview.advance)
//             warm=<seconds simulated before the first screenshot>  breaks=1 (auto break cadence)  color=<0..7> (menu)
import { CONFIG, type Quality } from '../config';
import { baseStats } from '../sim/carModel';
import { DestructionSystem } from '../sim/destruction';
import { createSim } from '../sim/sim';
import { PhysicsWorld } from '../sim/world';
import { buildTrackGeometry } from '../track/spline';
import { trackById } from '../track/tracks';
import {
  ZONES, type CarInput, type CarPart, type CarState, type DestructibleState, type GhostData, type ISim, type RaceState,
  type SimEvent, type TrackGeometry, type ZoneId,
} from '../types';
import { GameRenderer } from './renderer';
import { makeRng } from './util';

const params = new URLSearchParams(location.search);
const trackId = params.get('track') ?? 't1';
const qParam = (params.get('q') ?? 'high') as Quality | 'auto';
const mode = params.get('mode') ?? 'race';
const freeze = params.get('freeze') === '1';
const s0 = Number(params.get('s0') ?? 30);
/** models=<n>: the 8 preview cars are roster cars n.. n+7 (default 0: one of each of the first 8 models) */
const modelOffset = Number(params.get('models') ?? 0) || 0;

function fullHp(): Record<ZoneId, number> {
  return Object.fromEntries(ZONES.map((z) => [z, CONFIG.damage.zoneMaxHp])) as Record<ZoneId, number>;
}

interface Driver { s: number; lat: number; speed: number; slipAngle: number }

class PreviewSim implements ISim {
  readonly track: TrackGeometry;
  readonly cars: CarState[] = [];
  readonly destructibles: DestructibleState[];
  readonly race: RaceState;
  alpha = 0;
  stepMs = 0;
  private events: SimEvent[] = [];
  private drivers: Driver[] = [];
  private pw: PhysicsWorld;
  private rng = makeRng(11);
  private time = 0;
  private breakTimer = 0;
  private auto: boolean;

  constructor(id: string, auto: boolean) {
    this.auto = auto;
    this.track = buildTrackGeometry(trackById(id));
    this.pw = new PhysicsWorld();
    const ds = new DestructionSystem(this.pw, this.track);
    this.destructibles = ds.states;
    this.race = { phase: 'racing', countdown: 0, time: 0, totalLaps: 3, playerFinished: false, results: [] };
    for (let i = 0; i < 8; i++) {
      this.cars.push({
        id: i, isPlayer: i === 0, colorIndex: i, name: 'Car' + i, modelId: CONFIG.cars.order[(i + modelOffset) % CONFIG.cars.order.length], x: 0, y: 0, angle: 0, vx: 0, vy: 0, angularVel: 0, speed: 0, steer: 0,
        throttle: 1, brake: 0, handbrake: false, rpm: 0.6, drifting: false, slip: 0, hp: fullHp(), zoneMaxHp: CONFIG.damage.zoneMaxHp,
        health: 1, effects: { powerMul: 1, topSpeedMul: 1, gripMul: 1, steerPull: 0, smoke: 0, sparks: 0 }, detachedParts: [], wrecked: false,
        lap: 0, progress: 0, place: i + 1, finished: false, finishTime: 0, lastLapTime: 0, bestLapTime: 0, onCurb: false, offRoad: false,
      });
      // player in front of the pack, rest spread out behind / ahead
      this.drivers.push({ s: s0 + (i === 0 ? 0 : (i % 2 ? 1 : -1) * (6 + i * 5)), lat: ((i % 3) - 1) * 3.2, speed: 24 + (i % 4) * 3, slipAngle: 0 });
    }
    // scripted visual states
    const c = this.cars;
    // 1: drifting hard
    this.drivers[1].slipAngle = 0.4; c[1].slip = 0.85; c[1].drifting = true; c[1].handbrake = true; c[1].brake = 0;
    // 2: smoking, hood & spoiler gone, front dented
    c[2].hp.front = 18; c[2].hp.engine = 30; c[2].hp.left = 40; c[2].hp.wheelFL = 20; c[2].health = 0.35;
    c[2].detachedParts = ['hood', 'spoiler', 'mirrorL']; c[2].effects.smoke = 0.7; c[2].effects.sparks = 0.8;
    // 3: wrecked and burning
    for (const z of ZONES) c[3].hp[z] = 6; c[3].health = 0.05; c[3].wrecked = true; c[3].detachedParts = ['bumperF', 'doorL', 'doorR', 'bumperR'];
    this.drivers[3].speed = 9;
    // 4: off-road dust
    c[4].offRoad = true; this.drivers[4].lat = 12; this.drivers[4].speed = 20;
    // 5: braking
    c[5].brake = 1; c[5].throttle = 0;
    // 6: lightly damaged
    c[6].hp.rear = 55; c[6].hp.right = 60; c[6].health = 0.75; c[6].detachedParts = ['mirrorR'];
    // 0: player, scuffed
    c[0].hp.front = 70; c[0].hp.wheelFR = 55; c[0].health = 0.85; c[0].effects.sparks = 0.35;
    this.step(0);
    this.cars.forEach((car) => { car.speed = Math.max(car.speed, 1); });
  }

  setPlayerInput(_i: CarInput): void { /* preview cars are scripted */ }
  repairPlayer(): void { /* n/a */ }
  ghostPose(): { x: number; y: number; a: number } | null {
    const t = this.track.sampleAt(this.drivers[0].s - 14);
    return { x: t.x + t.nx * 1.5, y: t.y + t.ny * 1.5, a: Math.atan2(t.ty, t.tx) };
  }
  bestGhost(): GhostData | null { return null; }
  drainEvents(): SimEvent[] { const e = this.events; this.events = []; return e; }
  dispose(): void { /* n/a */ }

  update(frameDt: number): number { this.step(frameDt); return 1; }

  private step(dt: number): void {
    this.time += dt;
    this.race.time += dt;
    for (let i = 0; i < this.cars.length; i++) {
      const d = this.drivers[i], c = this.cars[i];
      d.s += d.speed * dt;
      const t = this.track.sampleAt(d.s);
      const lookT = this.track.sampleAt(d.s + 6);
      const lat = d.lat + Math.sin(this.time * 0.7 + i) * 0.8;
      c.x = t.x + t.nx * lat; c.y = t.y + t.ny * lat;
      const heading = Math.atan2(t.ty, t.tx);
      c.angle = heading + d.slipAngle * (c.drifting ? Math.sign(t.curvature || 1) : 0);
      c.speed = d.speed;
      c.vx = Math.cos(heading) * d.speed; c.vy = Math.sin(heading) * d.speed;
      c.angularVel = t.curvature * d.speed;
      const target = clamp(-(lookT.curvature * 2.6 / CONFIG.car.maxSteerAngle) * 0.8, -1, 1);
      c.steer += (target - c.steer) * Math.min(1, dt * 8);
      c.progress = d.s;
      c.onCurb = Math.abs(lat) > this.track.def.width / 2 - 0.6 && !c.offRoad;
      if (c.id === 5) { d.speed = 14 + Math.sin(this.time) * 2; }
    }
    this.alpha = 0.5;
    if (this.auto) {
      this.breakTimer -= dt;
      if (this.breakTimer <= 0) { this.breakTimer = 0.9; this.breakNear(1 + Math.floor(this.rng() * 3)); }
    }
  }

  /** Break pieces just ahead of the player (and emit the matching events). */
  breakNear(n: number, kinds?: string[], maxDs = 26): void {
    const p = this.cars[0];
    const ps = this.track.nearest(p.x, p.y).s;
    let done = 0;
    for (let tries = 0; tries < 400 && done < n; tries++) {
      const s = this.destructibles[Math.floor(this.rng() * this.destructibles.length)];
      if (s.broken || s.kind === 'curb' && this.rng() > 0.2) continue;
      if (kinds && !kinds.includes(s.kind)) continue;
      const ns = this.track.nearest(s.x, s.y).s;
      let ds = ns - ps; if (ds > this.track.length / 2) ds -= this.track.length; if (ds < -this.track.length / 2) ds += this.track.length;
      if (Math.abs(ds) > maxDs) continue;
      s.broken = true; s.hp = 0; s.crack = 1;
      this.events.push({ type: 'break', id: s.id, kind: s.kind, propType: s.propType, x: s.x, y: s.y, angle: s.angle, w: s.w, h: s.h, vx: p.vx * 0.6 + (this.rng() - 0.5) * 8, vy: p.vy * 0.6 + (this.rng() - 0.5) * 8 });
      done++;
    }
    const c = this.cars[0];
    this.events.push({ type: 'impact', x: c.x + 4, y: c.y, strength: 0.6 + this.rng() * 0.4, carId: 0, other: 'wall' });
  }

  /** Slowly crack a stretch of walls, for the crack visuals. */
  crackNear(): void {
    const p = this.cars[0];
    const ps = this.track.nearest(p.x, p.y).s;
    for (const s of this.destructibles) {
      if (s.broken || (s.kind !== 'wall' && s.kind !== 'guardrail' && s.kind !== 'road' && s.kind !== 'curb')) continue;
      const ns = this.track.nearest(s.x, s.y).s;
      let ds = ns - ps; if (ds > this.track.length / 2) ds -= this.track.length; if (ds < -this.track.length / 2) ds += this.track.length;
      if (Math.abs(ds) < 40 && this.rng() < 0.5) { s.crack = 0.2 + this.rng() * 0.7; s.hp = s.maxHp * (1 - s.crack); }
    }
  }

  partOff(): void {
    const c = this.cars[6];
    const parts: CarPart[] = ['spoiler', 'doorR', 'bumperR'];
    for (const p of parts) {
      if (!c.detachedParts.includes(p)) { c.detachedParts.push(p); this.events.push({ type: 'partOff', carId: 6, part: p, x: c.x, y: c.y, vx: c.vx * 0.5 + 6, vy: c.vy * 0.5 - 4 }); }
    }
  }

  sparks(): void {
    const c = this.cars[0];
    for (let i = 0; i < 4; i++) this.events.push({ type: 'scrape', x: c.x + i, y: c.y + 1, carId: 0, strength: 1 });
    this.events.push({ type: 'impact', x: c.x + 2, y: c.y - 1, strength: 1, carId: 0, other: 'car' });
  }
}

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

async function main(): Promise<void> {
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const hud = document.getElementById('hud')!;
  const renderer = new GameRenderer(canvas, qParam);
  const real = params.get('real') === '1';
  const fake = new PreviewSim(trackId, params.get('breaks') === '1');
  let sim: ISim = fake;
  if (real) {
    const cars = Array.from({ length: 8 }, (_, i) => ({
      id: i, isPlayer: i === 0, name: 'Car' + i, colorIndex: i, stats: baseStats(),
      ai: { skill: 0.6 + 0.05 * i, aggression: 0.6, laneOffset: ((i % 3) - 1) * 0.4, mistakeRate: 0.15 },
    }));
    sim = createSim({ track: trackById(trackId), cars, seed: 7, laps: 3 });
  }
  // tiny autopilot for the player in real mode: aim at a point ahead on the spline
  const autopilot = (): void => {
    if (!real) return;
    const c = sim.cars[0];
    const near = sim.track.nearest(c.x, c.y);
    const t = sim.track.sampleAt(near.s + 10 + Math.abs(c.speed) * 0.5);
    let d = Math.atan2(t.y - c.y, t.x - c.x) - c.angle;
    while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    const k = Math.abs(sim.track.sampleAt(near.s + 25).curvature);
    sim.setPlayerInput({ throttle: Math.abs(c.speed) > 30 / (1 + k * 60) ? 0 : 1, brake: 0, steer: clamp(-d * 1.8, -1, 1), handbrake: false });
  };
  let last = performance.now();
  let frames = 0;

  const advance = (seconds: number, step = 1 / 60): void => {
    const n = Math.max(1, Math.round(seconds / step));
    for (let i = 0; i < n; i++) {
      autopilot();
      sim.update(step);
      renderer.frame(sim, sim.drainEvents(), step);
    }
  };

  if (mode === 'menu') renderer.showMenuScene(Number(params.get('color') ?? 0), params.get('car') ?? undefined);
  else { renderer.loadRace(sim); }

  const api = {
    ready: true, sim, renderer, advance,
    breakNear: (n = 4, kinds?: string[], maxDs = 26) => fake.breakNear(n, kinds, maxDs),
    crack: () => fake.crackNear(),
    partOff: () => fake.partOff(),
    sparks: () => fake.sparks(),
    stress: () => { if (!real) { fake.breakNear(10); fake.partOff(); fake.sparks(); } },
    inspect: () => renderer.inspect(),
    stats: () => ({ ...(window.__render ?? {}) }),
    menu: (c = 0, car?: string) => renderer.showMenuScene(c, car),
    race: () => renderer.loadRace(sim),
  };
  (window as unknown as { __preview: typeof api }).__preview = api;

  const warm = Number(params.get('warm') ?? 0);
  if (warm > 0 && mode !== 'menu') advance(warm);

  if (!freeze) {
    const loop = (now: number): void => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (mode === 'menu') { renderer.frame(sim, [], dt); }
      else { autopilot(); sim.update(dt); renderer.frame(sim, sim.drainEvents(), dt); }
      frames++;
      if (frames % 20 === 0) {
        const s = window.__render;
        hud.textContent = s ? `fps ${s.fps.toFixed(0)}  calls ${s.drawCalls}  tris ${s.triangles}  debris ${s.debrisActive}  fx ${s.particles}  q ${s.quality}` : '';
      }
    };
    requestAnimationFrame(loop);
  } else if (mode !== 'menu') renderer.frame(sim, [], 0.0001);
}

main().catch((e) => { console.error(e); (window as unknown as { __previewError: string }).__previewError = String(e?.stack ?? e); });
