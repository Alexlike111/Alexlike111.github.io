// Round-2 fixes for module D: torn-road look, readable wrecks, snow barrier, flower clusters, low preset, GPU leak. No WebGL needed.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CONFIG } from '../src/config';
import { FxManager, type FxContext } from '../src/fx/fxManager';
import { CarFleet, buildCarGeometries, type CarPose } from '../src/render/car';
import { buildDecor } from '../src/render/decor';
import { roadHoleGeometry } from '../src/render/destructibles';
import { Materials } from '../src/render/materials';
import { PALETTES } from '../src/render/palette';
import { WALL_BASE_LEN, scarGeometry, wallGeometry, wallVisual } from '../src/render/structures';
import { buildTrackGeometry } from '../src/track/spline';
import { trackById } from '../src/track/tracks';
import { ZONES, type CarState, type SimEvent, type ZoneId } from '../src/types';

function carState(id: number, health: number, hp: Partial<Record<ZoneId, number>> = {}): CarState {
  const full = Object.fromEntries(ZONES.map((z) => [z, CONFIG.damage.zoneMaxHp])) as Record<ZoneId, number>;
  return {
    id, isPlayer: id === 0, colorIndex: 1, name: 'c' + id, x: 0, y: 0, angle: 0, vx: 0, vy: 0, angularVel: 0, speed: 0, steer: 0,
    throttle: 0, brake: 0, handbrake: false, rpm: 0.2, drifting: false, slip: 0, hp: { ...full, ...hp }, zoneMaxHp: CONFIG.damage.zoneMaxHp,
    health, effects: { powerMul: 1, topSpeedMul: 1, gripMul: 1, steerPull: 0, smoke: 0, sparks: 0 }, detachedParts: [], wrecked: false,
    lap: 0, progress: 0, place: id + 1, finished: false, finishTime: 0, lastLapTime: 0, bestLapTime: 0, onCurb: false, offRoad: false,
  };
}

/** mean luminance of the vertex colours of a geometry */
function meanLuma(g: THREE.BufferGeometry): number {
  const c = g.getAttribute('color');
  let sum = 0;
  for (let i = 0; i < c.count; i++) sum += 0.2126 * c.getX(i) + 0.7152 * c.getY(i) + 0.0722 * c.getZ(i);
  return sum / c.count;
}
const minLuma = (g: THREE.BufferGeometry): number => {
  const c = g.getAttribute('color');
  let m = Infinity;
  for (let i = 0; i < c.count; i++) m = Math.min(m, 0.2126 * c.getX(i) + 0.7152 * c.getY(i) + 0.0722 * c.getZ(i));
  return m;
};

describe('torn road decals', () => {
  it('the crater is earth coloured, never a black void, on every theme, and differs per theme', () => {
    const lumas: number[] = [];
    for (const theme of ['meadow', 'desert', 'snow'] as const) {
      const { hole } = roadHoleGeometry(PALETTES[theme]);
      // linear-space luminance of a "black" 0x090605 is ~0.002; the earth core 0x5a4636 is ~0.07
      expect(minLuma(hole)).toBeGreaterThan(0.03);
      lumas.push(meanLuma(hole));
    }
    expect(new Set(lumas.map((l) => l.toFixed(3))).size).toBe(3);
    // the lip fades lighter than the core: the lightest vertex colour is clearly above the darkest
    const { hole } = roadHoleGeometry(PALETTES.meadow);
    const c = hole.getAttribute('color');
    let hi = 0, lo = Infinity;
    for (let i = 0; i < c.count; i++) { const l = c.getX(i); hi = Math.max(hi, l); lo = Math.min(lo, l); }
    expect(hi).toBeGreaterThan(lo * 1.8);
  });

  it('the crack is a short jagged fissure (1-2 cracks), darker than the road but not black', () => {
    for (const theme of ['meadow', 'desert', 'snow'] as const) {
      const { crack } = roadHoleGeometry(PALETTES[theme]);
      crack.computeBoundingBox();
      const sz = crack.boundingBox!.getSize(new THREE.Vector3());
      expect(sz.x).toBeGreaterThan(1.2);
      expect(sz.x).toBeLessThan(2.4);
      expect(sz.z).toBeLessThan(1.6);
      const road = new THREE.Color(PALETTES[theme].road);
      const roadL = 0.2126 * road.r + 0.7152 * road.g + 0.0722 * road.b;
      const l = minLuma(crack);
      expect(l).toBeLessThan(roadL * 0.8);   // reads as a crack
      expect(l).toBeGreaterThan(roadL * 0.2); // ... but not a black sticker
    }
  });
});

describe('wrecked cars keep their identity', () => {
  const mats = new Materials();
  const fleet = new CarFleet(buildCarGeometries(), mats, 2);
  const allDown: Partial<Record<ZoneId, number>> = Object.fromEntries(ZONES.map((z) => [z, 6]));
  const wreck = carState(1, 0.05, allDown);
  wreck.wrecked = true;
  wreck.detachedParts = ['bumperF', 'bumperR', 'hood', 'doorL', 'doorR'];
  fleet.update([{ x: 0, y: 0, angle: 0, state: carState(0, 1) }, { x: 8, y: 0, angle: 0, state: wreck } as CarPose], 1 / 60);
  const f = fleet as unknown as { body: THREE.InstancedMesh; wheels: THREE.InstancedMesh };

  it('the body colour of a wreck is at most ~55% burnt: a good share of the paint survives', () => {
    const c = new THREE.Color();
    f.body.getColorAt(1, c);
    const paint = new THREE.Color(CONFIG.render.carColors[1]);
    // blue paint: the blue channel must stay clearly dominant (the old 85% burn turned every car brown)
    expect(c.b).toBeGreaterThan(c.r * 1.25);
    expect(c.b).toBeGreaterThan(paint.b * 0.4);
  });

  it('the wheels of a wreck are all drawn (never hidden)', () => {
    const m = new THREE.Matrix4(), s = new THREE.Vector3();
    for (let k = 0; k < 4; k++) {
      f.wheels.getMatrixAt(4 + k, m);
      s.setFromMatrixScale(m);
      expect(s.x).toBeGreaterThan(0.5);
    }
  });

  it('the crumple never overpaints the body in the shader (scuff mix capped) and the dent depth leaves the cabin', () => {
    expect(CONFIG.render.fx.dirtMax).toBeLessThanOrEqual(0.56);
    expect(CONFIG.render.fx.dentDepth).toBeLessThanOrEqual(0.65);
  });

  it('a nearly dead car emits a smaller, more see-through plume than a half-dead one', () => {
    const emit = (health: number): { n: number; size: number; alpha: number } => {
      const fx = new FxManager(mats, 8);
      fx.setTheme(PALETTES.meadow, 'concrete');
      fx.setQuality('high');
      const st = carState(0, health, {});
      st.effects.smoke = 1;
      st.speed = 20; st.vx = 20;
      const ctx: FxContext = { playerId: 0, camX: 0, camZ: 0, radius: 40, addTrauma: () => undefined, carById: () => undefined };
      fx.updateCars([{ x: 0, y: 0, angle: 0, state: st }], 0.5, ctx);
      const sm = fx.smoke as unknown as { n: number; s1: Float32Array; base: Float32Array };
      let size = 0, alpha = 0;
      for (let i = 0; i < sm.n; i++) { size = Math.max(size, sm.s1[i]); alpha = Math.max(alpha, sm.base[i * 4 + 3]); }
      return { n: sm.n, size, alpha };
    };
    const half = emit(0.4), dead = emit(0.04);
    expect(dead.n).toBeGreaterThan(0);
    expect(dead.size).toBeLessThan(half.size);
    expect(dead.alpha).toBeLessThanOrEqual(CONFIG.render.fx.smokeAlphaMax + 1e-6);
    expect(half.alpha).toBeLessThanOrEqual(CONFIG.render.fx.smokeAlphaMax + 1e-6);
  });
});

describe('snow barrier', () => {
  it('snow tracks use quiet jersey blocks instead of tyre stacks; other themes keep their style', () => {
    expect(wallVisual(trackById('t3'))).toBe('jersey');
    expect(wallVisual(trackById('t1'))).toBe('fence');
    expect(wallVisual(trackById('t2'))).toBe('concrete');
  });

  it('jersey pieces fit the collider footprint, have no red / white stripes and few triangles', () => {
    for (const kind of ['wall', 'guardrail'] as const) {
      const g = wallGeometry('jersey', kind, PALETTES.snow);
      g.computeBoundingBox();
      const s = g.boundingBox!.getSize(new THREE.Vector3());
      expect(s.x).toBeGreaterThan(WALL_BASE_LEN * 0.9);
      expect(s.x).toBeLessThan(WALL_BASE_LEN + 0.35);
      expect(s.z).toBeGreaterThan(CONFIG.destruction[kind].thickness * 0.6);
      expect(s.z).toBeLessThan(CONFIG.destruction[kind].thickness + 0.5);
      const tris = g.getAttribute('position').count / 3;
      expect(tris).toBeLessThanOrEqual(90);
      const c = g.getAttribute('color');
      const red = new THREE.Color(0xe8383a);
      for (let i = 0; i < c.count; i++) expect(c.getX(i) > red.r * 0.9 && c.getY(i) < red.g * 3).toBe(false);
      expect(scarGeometry('jersey', kind).getAttribute('position').count).toBeGreaterThan(0);
    }
  });
});

describe('flowers are clustered and high-preset only', () => {
  const track = buildTrackGeometry(trackById('t1'));
  const decor = buildDecor(track, PALETTES.meadow, new Materials(), [], 1);
  const total = (decor.group.children as THREE.InstancedMesh[]).find((c) => c.name === 'decor:flower')!.userData.total as number;

  it('far fewer flowers than before (was ~1.1 per metre of track)', () => {
    expect(total).toBeLessThan(track.length * 0.45);
    expect(total).toBeGreaterThan(20);
  });

  it('shown on high, hidden on medium and low density', () => {
    const near = (): number => {
      decor.update(track.samples[40].x, track.samples[40].y, 90);
      return (decor.group.children as THREE.InstancedMesh[]).find((c) => c.name === 'decor:flower')!.count;
    };
    decor.setDensity(CONFIG.render.decorDensity.high);
    expect(near()).toBeGreaterThan(0);
    decor.setDensity(CONFIG.render.decorDensity.medium);
    expect(near()).toBe(0);
    decor.setDensity(CONFIG.render.decorDensity.low);
    expect(near()).toBe(0);
  });

  it('uses 2-3 colours per cluster: neighbours share a palette', () => {
    decor.setDensity(1);
    decor.update(track.samples[40].x, track.samples[40].y, 90);
    const mesh = (decor.group.children as THREE.InstancedMesh[]).find((c) => c.name === 'decor:flower')!;
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), c = new THREE.Color();
    const items: { x: number; z: number; hex: number }[] = [];
    for (let i = 0; i < mesh.count; i++) { mesh.getMatrixAt(i, m); p.setFromMatrixPosition(m); mesh.getColorAt(i, c); items.push({ x: p.x, z: p.z, hex: c.getHex() }); }
    expect(items.length).toBeGreaterThan(3);
    // each flower's neighbours within 2.6 m use at most 3 distinct colours in total
    for (const a of items) {
      const near = items.filter((b) => Math.hypot(a.x - b.x, a.z - b.z) < 2.6);
      expect(new Set(near.map((b) => b.hex)).size).toBeLessThanOrEqual(4);   // a cluster plus the edge of a neighbouring cluster
    }
  });
});

describe('low quality preset', () => {
  it('ambient particles are off on low, essential damage effects stay, pixel ratio is raised for 2x screens', () => {
    const q = CONFIG.render.quality;
    expect(q.low.particles).toBe(0);
    expect(q.low.essential).toBeGreaterThan(0);
    expect(q.low.pixelRatio).toBeGreaterThanOrEqual(1.25);
    expect(q.low.shadows).toBe(false);
  });

  it('on low there is no tyre smoke / dust / dust puffs on a break, but damage smoke and impact sparks still appear', () => {
    const fx = new FxManager(new Materials(), 8);
    fx.setTheme(PALETTES.meadow, 'concrete');
    fx.setQuality('low');
    const ctx: FxContext = { playerId: 0, camX: 0, camZ: 0, radius: 40, addTrauma: () => undefined, carById: () => undefined };
    const slide = carState(0, 1);
    slide.slip = 0.9; slide.speed = 25; slide.vx = 25; slide.offRoad = true;
    fx.updateCars([{ x: 0, y: 0, angle: 0, state: slide }], 0.5, ctx);
    expect(fx.smoke.active).toBe(0);
    const brk: SimEvent = { type: 'break', id: 1, kind: 'wall', x: 3, y: 2, angle: 0.3, w: 4, h: 1, vx: 20, vy: 0 };
    fx.handleEvents([brk], ctx);
    expect(fx.smoke.active).toBe(0);
    expect(fx.sparks.active).toBeGreaterThan(0);
    const hurt = carState(0, 0.3);
    hurt.effects.smoke = 0.8; hurt.effects.sparks = 0.8; hurt.speed = 20; hurt.vx = 20;
    fx.updateCars([{ x: 0, y: 0, angle: 0, state: hurt }], 0.5, ctx);
    expect(fx.smoke.active).toBeGreaterThan(0);
  });
});

describe('debris counts follow REQUIREMENTS (2-3 pieces per break)', () => {
  it('config ranges and every kind of break stay within 2-3 pieces', () => {
    expect(CONFIG.render.fx.breakPieces[1]).toBeLessThanOrEqual(3);
    expect(CONFIG.render.fx.breakPiecesStrong[1]).toBeLessThanOrEqual(3);
    expect(CONFIG.render.fx.breakPieces[0]).toBeGreaterThanOrEqual(2);
    const ctx: FxContext = { playerId: 0, camX: 0, camZ: 0, radius: 40, addTrauma: () => undefined, carById: () => undefined };
    for (const kind of ['wall', 'guardrail', 'road', 'curb'] as const) {
      for (const speed of [4, 12, 24]) {
        const fx = new FxManager(new Materials(), 8);
        fx.setTheme(PALETTES.meadow, 'concrete');
        fx.setQuality('high');
        fx.handleEvents([{ type: 'break', id: 1, kind, x: 3, y: 2, angle: 0.3, w: 4, h: 1, vx: speed, vy: 0 }], ctx);
        expect(fx.debris.active).toBeGreaterThanOrEqual(2);
        expect(fx.debris.active).toBeLessThanOrEqual(3);
      }
    }
    for (const propType of ['cone', 'tree', 'barrel'] as const) {
      const fx = new FxManager(new Materials(), 8);
      fx.setTheme(PALETTES.meadow, 'concrete');
      fx.setQuality('high');
      fx.handleEvents([{ type: 'break', id: 1, kind: 'prop', propType, x: 3, y: 2, angle: 0, w: 1, h: 1, vx: 20, vy: 0 }], ctx);
      expect(fx.debris.active).toBeGreaterThanOrEqual(2);
      expect(fx.debris.active).toBeLessThanOrEqual(3);
    }
  });
});

describe('GPU resources of a car fleet', () => {
  it('dispose releases the blob-shadow geometry too (was leaking one plane per race)', () => {
    const fleet = new CarFleet(buildCarGeometries(), new Materials(), 8);
    const blobGeo = (fleet as unknown as { blob: THREE.InstancedMesh }).blob.geometry;
    let disposed = 0;
    blobGeo.addEventListener('dispose', () => { disposed++; });
    const bodyGeo = (fleet as unknown as { bodyGeo: THREE.BufferGeometry }).bodyGeo;
    bodyGeo.addEventListener('dispose', () => { disposed++; });
    fleet.dispose();
    expect(disposed).toBe(2);
  });
});

describe('portrait zoom', () => {
  it('a phone in portrait shows <= 36 m at rest so the cars are big enough to tell apart', () => {
    expect(CONFIG.render.viewMetres.portrait).toBeLessThanOrEqual(36);
    expect(CONFIG.render.viewMetres.portrait).toBeGreaterThanOrEqual(30);
  });
});
