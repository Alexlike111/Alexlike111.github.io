// Round-1 fixes for module D: player marker, destruction feedback, visible car damage, triangle budget. No WebGL needed.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CONFIG } from '../src/config';
import { FxManager, type FxContext } from '../src/fx/fxManager';
import { ShockwavePool } from '../src/fx/shockwave';
import { CarFleet, buildCarGeometries, type CarPose } from '../src/render/car';
import { buildDecor } from '../src/render/decor';
import { DestructibleRenderer } from '../src/render/destructibles';
import { Materials } from '../src/render/materials';
import { PALETTES } from '../src/render/palette';
import { PlayerMarker } from '../src/render/playerMarker';
import { curbGeometry, propGeometry, rockGeometry, scarGeometry, treeGeometry } from '../src/render/structures';
import { DestructionSystem } from '../src/sim/destruction';
import { PhysicsWorld } from '../src/sim/world';
import { buildTrackGeometry } from '../src/track/spline';
import { trackById } from '../src/track/tracks';
import { ZONES, type CarState, type SimEvent, type ZoneId } from '../src/types';

const tris = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.getAttribute('position').count) / 3;

function carState(id: number, isPlayer: boolean, health = 1, hp: Partial<Record<ZoneId, number>> = {}): CarState {
  const full = Object.fromEntries(ZONES.map((z) => [z, CONFIG.damage.zoneMaxHp])) as Record<ZoneId, number>;
  return {
    id, isPlayer, colorIndex: id, name: 'c' + id, x: 0, y: 0, angle: 0, vx: 0, vy: 0, angularVel: 0, speed: 0, steer: 0,
    throttle: 0, brake: 0, handbrake: false, rpm: 0.2, drifting: false, slip: 0, hp: { ...full, ...hp }, zoneMaxHp: CONFIG.damage.zoneMaxHp,
    health, effects: { powerMul: 1, topSpeedMul: 1, gripMul: 1, steerPull: 0, smoke: 0, sparks: 0 }, detachedParts: [], wrecked: false,
    lap: 0, progress: 0, place: id + 1, finished: false, finishTime: 0, lastLapTime: 0, bestLapTime: 0, onCurb: false, offRoad: false,
  };
}

describe('player marker', () => {
  it('is at full strength through the countdown, decays after GO to a faint ring, and pings again on a hit', () => {
    const m = new PlayerMarker();
    for (let i = 0; i < 120; i++) m.update(1 / 60, 0, 0, 0, true, 0.05);
    expect(m.strength).toBeGreaterThan(0.98);
    const ring = m.group.children.find((c) => (c as THREE.Mesh).material && ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).color.getHex() === 0xffffff) as THREE.Mesh;
    expect(((ring.material as THREE.MeshBasicMaterial).opacity)).toBeGreaterThan(0.9);
    // GO: stays strong for strongSeconds, then settles
    for (let i = 0; i < 60 * (CONFIG.render.marker.strongSeconds + 2); i++) m.update(1 / 60, 0, 0, 0, false, 0.05);
    expect(m.strength).toBeLessThan(0.05);
    expect((ring.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(CONFIG.render.marker.idleAlpha, 1);
    expect((ring.material as THREE.MeshBasicMaterial).opacity).toBeGreaterThan(0.2);     // never disappears
    m.ping();
    for (let i = 0; i < 30; i++) m.update(1 / 60, 0, 0, 0, false, 0.05);
    expect(m.strength).toBeGreaterThan(0.9);
  });

  it('keeps the ring readable at phone scale (wider ring for more metres per pixel)', () => {
    const m = new PlayerMarker();
    m.update(0, 0, 0, 0, true, 0.02);
    const ring = m.group.children[1] as THREE.Mesh;
    const widthAt = (): number => {
      const p = ring.geometry.getAttribute('position');
      return Math.hypot(p.getX(1) - p.getX(0), p.getZ(1) - p.getZ(0));
    };
    const thin = widthAt();
    m.update(0, 0, 0, 0, true, 0.12);
    expect(widthAt()).toBeGreaterThan(thin);
  });
});

describe('car fleet: damage is visible on the car, player is distinguishable', () => {
  const mats = new Materials();
  const fleet = new CarFleet(buildCarGeometries(), mats, 3);
  const poses: CarPose[] = [
    { x: 0, y: 0, angle: 0, state: carState(0, true) },
    { x: 8, y: 0, angle: 0, state: carState(1, false, 0.84, { front: 70, wheelFL: 78, left: 82 }) },
    { x: 16, y: 0, angle: 0, state: carState(2, false, 0.35, { front: 20, rear: 30, left: 25, right: 40, engine: 30 }) },
  ];
  fleet.update(poses, 1 / 60);
  const f = fleet as unknown as { dmgAttr: THREE.InstancedBufferAttribute; blob: THREE.InstancedMesh; body: THREE.InstancedMesh };

  it('writes a crumple amount per end of the car, growing with zone damage and zero when healthy', () => {
    const a = f.dmgAttr.array as Float32Array;
    expect(Array.from(a.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(a[4]).toBeGreaterThan(0.25);            // moderate damage (84% health, front at 70%) is already clearly dented
    const heavy = a[8];
    expect(heavy).toBeGreaterThan(a[4]);
    expect(a[8 + 1]).toBeGreaterThan(0.3);         // rear
  });

  it('body paint turns noticeably darker already at moderate damage', () => {
    const c0 = new THREE.Color(), c1 = new THREE.Color();
    f.body.getColorAt(1, c1);
    f.body.getColorAt(1, c0);
    // car 1 (colour index 1, blue) vs the same colour undamaged
    const pristine = new THREE.Color(CONFIG.render.carColors[1]);
    expect(c1.r + c1.g + c1.b).toBeLessThan((pristine.r + pristine.g + pristine.b) * 0.88);
  });

  it('every car has the same neutral dark blob shadow (no saturated halo); the player is told apart by the ring only', () => {
    const p = new THREE.Color(), ai = new THREE.Color();
    f.blob.getColorAt(0, p);
    f.blob.getColorAt(1, ai);
    expect(p.getHex()).toBe(ai.getHex());
    const hsl = { h: 0, s: 0, l: 0 };
    ai.getHSL(hsl);
    expect(hsl.l).toBeLessThan(0.15);
    expect(hsl.s).toBeLessThan(0.45);   // the old navy 0x1c2f66 had s = 0.6
  });

  it('smoke starts earlier and light wisps cover moderate damage', () => {
    expect(CONFIG.render.fx.smokeBelow).toBeGreaterThanOrEqual(0.7);
    expect(CONFIG.render.fx.wispBelow).toBeGreaterThan(CONFIG.render.fx.smokeBelow);
    expect(CONFIG.render.fx.wispBelow).toBeLessThan(1);
  });
});

describe('destruction feedback', () => {
  const mats = new Materials();
  const makeFx = (): { fx: FxManager; ctx: FxContext; trauma: number[] } => {
    const fx = new FxManager(mats, 8);
    fx.setTheme(PALETTES.meadow, 'concrete');
    fx.setQuality('high');
    const trauma: number[] = [];
    const ctx: FxContext = { playerId: 0, camX: 0, camZ: 0, radius: 40, addTrauma: (t) => trauma.push(t), carById: () => undefined };
    return { fx, ctx, trauma };
  };
  const brk = (kind: 'wall' | 'guardrail' | 'road' | 'curb', speed: number): SimEvent => ({
    type: 'break', id: 1, kind, x: 3, y: 2, angle: 0.3, w: 4, h: 1, vx: speed, vy: 0,
  });

  it('a strong wall break throws 2-3 big chunks, a ring, a flash and a visual hit-stop', () => {
    const { fx, ctx, trauma } = makeFx();
    fx.handleEvents([brk('wall', 20)], ctx);
    expect(fx.debris.active).toBeGreaterThanOrEqual(CONFIG.render.fx.breakPiecesStrong[0]);
    expect(fx.debris.active).toBeLessThanOrEqual(CONFIG.render.fx.breakPiecesStrong[1]);
    expect(fx.rings.active).toBeGreaterThanOrEqual(1);
    expect(fx.hitStopLeft).toBeGreaterThan(0);
    expect(fx.sparks.active).toBeGreaterThan(10);
    expect(fx.smoke.active).toBeGreaterThan(5);
    expect(trauma.reduce((a, b) => a + b, 0)).toBeGreaterThan(0.12);
  });

  it('chunks are larger than the raw piece sizes', () => {
    const { fx, ctx } = makeFx();
    fx.handleEvents([brk('guardrail', 16)], ctx);
    const m = new THREE.Matrix4();
    let biggest = 0;
    for (let i = 0; i < fx.debris.active; i++) { fx.debris.mesh.getMatrixAt(i, m); biggest = Math.max(biggest, new THREE.Vector3().setFromMatrixScale(m).x); }
    fx.debris.update(0.001);
    for (let i = 0; i < fx.debris.active; i++) { fx.debris.mesh.getMatrixAt(i, m); biggest = Math.max(biggest, new THREE.Vector3().setFromMatrixScale(m).x); }
    expect(biggest).toBeGreaterThan(1.5);   // guardrail rail piece is 1.8 m * debrisScale
  });

  it('many simultaneous breaks never exceed the debris pool and curb breaks stay light', () => {
    const { fx, ctx } = makeFx();
    for (let i = 0; i < 30; i++) fx.handleEvents([brk(i % 2 ? 'wall' : 'road', 22)], ctx);
    expect(fx.debris.active).toBeLessThanOrEqual(CONFIG.destruction.maxDebris);
    expect(fx.rings.active).toBeLessThanOrEqual(CONFIG.render.fx.shockwaveCapacity);
    const light = makeFx();
    light.fx.handleEvents([brk('curb', 5)], light.ctx);
    expect(light.fx.debris.active).toBeLessThanOrEqual(CONFIG.destruction.debrisPerBreak[1]);
    expect(light.fx.hitStopLeft).toBe(0);
  });

  it('the hit-stop slows effect time and then ends', () => {
    const { fx, ctx } = makeFx();
    fx.handleEvents([{ type: 'impact', x: 1, y: 1, strength: 1, carId: 0, other: 'wall' }], ctx);
    expect(fx.hitStopLeft).toBeGreaterThan(0);
    const cam = new THREE.OrthographicCamera();
    for (let i = 0; i < 30; i++) fx.update(0.016, cam);
    expect(fx.hitStopLeft).toBe(0);
  });

  it('shockwave rings expand, fade and are pooled', () => {
    const p = new ShockwavePool(4);
    for (let i = 0; i < 10; i++) p.spawn(i, 0, 1);
    expect(p.active).toBe(4);
    p.update(0.05);
    const m = new THREE.Matrix4(); p.mesh.getMatrixAt(0, m);
    const r0 = new THREE.Vector3().setFromMatrixScale(m).x;
    p.update(0.1); p.mesh.getMatrixAt(0, m);
    expect(new THREE.Vector3().setFromMatrixScale(m).x).toBeGreaterThan(r0);
    for (let i = 0; i < 40; i++) p.update(0.02);
    expect(p.active).toBe(0);
    expect(p.mesh.visible).toBe(false);
  });
});

describe('destructible scars and holes', () => {
  const def = trackById('t1');
  const track = buildTrackGeometry(def);
  const ds = new DestructionSystem(new PhysicsWorld(), track);
  const dr = new DestructibleRenderer(ds.states, def, PALETTES.meadow, new Materials());
  dr.sync(ds.states);
  const holeMesh = dr.group.children.find((c) => c.name === 'destr:hole') as THREE.InstancedMesh;
  const crackMesh = dr.group.children.find((c) => c.name === 'destr:crack') as THREE.InstancedMesh;

  it('draws no hole / crack / rubble instances while nothing is broken (no hidden zero-scale instances)', () => {
    expect(holeMesh.count).toBe(0);
    expect(crackMesh.count).toBe(0);
    for (const m of dr.rubble.children as THREE.InstancedMesh[]) expect(m.count).toBe(0);
  });

  it('a broken wall leaves a ground scar with stumps; a torn road chunk gets a crater; cracked chunks get wide fissures', () => {
    const wall = ds.states.find((s) => s.kind === 'wall')!;
    wall.broken = true; wall.hp = 0; wall.crack = 1;
    const road = ds.states.find((s) => s.kind === 'road')!;
    road.broken = true; road.crack = 1;
    const road2 = ds.states.filter((s) => s.kind === 'road')[5];
    road2.crack = 0.7; road2.hp = road2.maxHp * 0.3;
    dr.sync(ds.states);
    const scar = (dr.rubble.children as THREE.InstancedMesh[]).find((m) => m.name === 'rubble:wall')!;
    expect(scar.count).toBe(1);
    const mat = new THREE.Matrix4(); scar.getMatrixAt(0, mat);
    const p = new THREE.Vector3().setFromMatrixPosition(mat);
    expect(p.x).toBeCloseTo(wall.x, 3); expect(p.z).toBeCloseTo(wall.y, 3);
    expect(holeMesh.count).toBe(1);
    expect(crackMesh.count).toBe(1);
    // repeated sync does not allocate more slots
    dr.sync(ds.states);
    expect(holeMesh.count).toBe(1); expect(scar.count).toBe(1);
  });

  it('crack decals are a visible fissure with a lighter torn rim (>= 0.2 m across at the rim), not hairline scratches', () => {
    const g = crackMesh.geometry;
    g.computeBoundingBox();
    const sz = g.boundingBox!.getSize(new THREE.Vector3());
    expect(sz.x).toBeGreaterThan(1.2);
    expect(sz.x).toBeLessThan(2.4);   // 1-2 jagged cracks, not a star spread over the whole chunk
    // the narrowest box of the decal is >= 0.2 m wide in z: sample the position attribute of the first fissure (12 side verts of a box)
    const pos = g.getAttribute('position');
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < 36; i++) { minZ = Math.min(minZ, pos.getZ(i)); maxZ = Math.max(maxZ, pos.getZ(i)); }
    expect(maxZ - minZ).toBeGreaterThan(0.2);
  });

  it('hole faces point up (visible from the top-down camera)', () => {
    const g = holeMesh.geometry;
    const n = g.getAttribute('normal');
    let up = 0, down = 0;
    for (let i = 0; i < n.count; i++) { if (n.getY(i) > 0.5) up++; else if (n.getY(i) < -0.5) down++; }
    expect(up).toBeGreaterThan(down);
    const wound = scarGeometry('fence', 'wall');
    const wn = wound.getAttribute('normal');
    let wUp = 0;
    for (let i = 0; i < wn.count; i++) if (wn.getY(i) > 0.5) wUp++;
    expect(wUp).toBeGreaterThan(30);
  });
});

describe('triangle budget', () => {
  it('scenery geometry is lean', () => {
    expect(tris(treeGeometry('meadow', PALETTES.meadow))).toBeLessThanOrEqual(80);
    expect(tris(treeGeometry('snow', PALETTES.snow))).toBeLessThanOrEqual(80);
    expect(tris(treeGeometry('desert', PALETTES.desert))).toBeLessThanOrEqual(200);
    expect(tris(rockGeometry(PALETTES.meadow))).toBeLessThanOrEqual(45);
    expect(tris(curbGeometry())).toBeLessThanOrEqual(12);
    expect(tris(propGeometry('tireStack', 'meadow', PALETTES.meadow))).toBeLessThanOrEqual(100);
  });

  it('car wheels are lean', () => {
    expect(tris(buildCarGeometries().wheel)).toBeLessThanOrEqual(170);
  });

  it('decor never draws more than the per-kind cap however far the view reaches', () => {
    const track = buildTrackGeometry(trackById('t1'));
    const decor = buildDecor(track, PALETTES.meadow, new Materials(), [], 1);
    decor.update(track.samples[40].x, track.samples[40].y, 400);   // huge view: every cell is a candidate
    const per = new Map<string, number>();
    for (const c of decor.group.children as THREE.InstancedMesh[]) per.set(c.name, c.count);
    expect(per.get('decor:tree')!).toBeLessThanOrEqual(36);
    expect(per.get('decor:flower')!).toBeLessThanOrEqual(130);
    expect(per.get('decor:bush')!).toBeLessThanOrEqual(46);
    decor.setDensity(0.4);
    decor.update(track.samples[40].x, track.samples[40].y, 400);
    expect((decor.group.children as THREE.InstancedMesh[]).find((c) => c.name === 'decor:tree')!.count).toBeLessThanOrEqual(Math.ceil(36 * 0.4));
  });
});
