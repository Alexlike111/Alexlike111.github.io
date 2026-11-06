import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { CameraRig } from '../src/render/camera';
import { buildTrackGeometry } from '../src/track/spline';
import { trackById } from '../src/track/tracks';

const DT = 1 / 60;
const VIEWS = { 'phone 390x844': [390, 844], 'phone 360x640': [360, 640], 'desktop 1280x720': [1280, 720], 'phone landscape 844x390': [844, 390] } as const;

interface Run { maxCar: number; maxAheadMiss: number; maxJump: number; azRate: number; rig: CameraRig }

/** Drive a car along the spline at `v` m/s with a lateral wobble and run the camera for `laps` laps. */
function drive(trackId: string, w: number, h: number, rotating: boolean, v: number, wobble = 3): Run {
  const tr = buildTrackGeometry(trackById(trackId));
  const rig = new CameraRig();
  rig.setAspect(w / h); rig.setViewport(w, h); rig.rotating = rotating; rig.track = tr;
  const p0 = tr.sampleAt(0);
  rig.snap(p0.x, p0.y);
  rig.update(0, p0.x, p0.y, 0, 0, 0, 0);
  let s = 0, t = 0, settled = 0, maxCar = 0, maxAheadMiss = 0, maxJump = 0, azRate = 0, prevAz = rig.viewAz;
  let prev = rig.target;
  const topSpeed = CONFIG.car.baseTopSpeed;
  while (s < tr.length * 0.98) {
    const sp = Math.min(v, 6 + t * 12);               // accelerate from the grid
    s += sp * DT; t += DT;
    const c = tr.sampleAt(s), lat = Math.sin(t * 1.7) * wobble;
    const x = c.x + c.nx * lat, y = c.y + c.ny * lat;
    const tg = tr.sampleAt(s + 2);
    rig.update(DT, x, y, c.tx * sp, c.ty * sp, sp / topSpeed, 0);
    const car = rig.project(x, y);
    maxCar = Math.max(maxCar, Math.abs(car.x), Math.abs(car.y));
    if (sp >= v - 0.1) settled += DT;
    if (settled > 1.5) {          // after the zoom has caught up with the speed
      const a = tr.sampleAt(s + sp * CONFIG.render.camera.lookTime), q = rig.project(a.x, a.y, 0);
      maxAheadMiss = Math.max(maxAheadMiss, Math.abs(q.x), Math.abs(q.y));
    }
    const tgt = rig.target; maxJump = Math.max(maxJump, Math.hypot(tgt.x - prev.x, tgt.z - prev.z) - sp * DT); prev = tgt;
    azRate = Math.max(azRate, Math.abs(Math.atan2(Math.sin(rig.viewAz - prevAz), Math.cos(rig.viewAz - prevAz))) / DT); prevAz = rig.viewAz;
    void tg;
  }
  return { maxCar, maxAheadMiss, maxJump, azRate, rig };
}

describe('camera framing', () => {
  for (const [name, [w, h]] of Object.entries(VIEWS)) {
    for (const trackId of ['t1', 't3']) {
      it(`${name} ${trackId}: the car stays in the central 60% box and the camera never jumps`, () => {
        const r = drive(trackId, w, h, w < h, 30);
        expect(r.maxCar).toBeLessThan(0.6);
        expect(r.maxJump).toBeLessThan(0.5);        // metres per frame beyond the car's own motion
      });
    }
  }

  it('portrait rotating: the road 1.5 s ahead is on screen at 30 m/s (390x844 and 360x640)', () => {
    for (const [w, h] of [[390, 844], [360, 640]]) {
      const r = drive('t1', w, h, true, 30);
      expect(r.maxAheadMiss, `${w}x${h}`).toBeLessThan(1);
    }
  });

  it('desktop fixed: the road 1.5 s ahead is on screen at 24 m/s', () => {
    expect(drive('t1', 1280, 720, false, 24).maxAheadMiss).toBeLessThan(1);
  });

  it('the azimuth follows the track tangent smoothly (rate cap) and is 0 when fixed or on landscape', () => {
    const r = drive('t3', 390, 844, true, 30);
    expect(r.azRate).toBeLessThanOrEqual(CONFIG.render.camera.rotMaxRate + 1e-6);
    expect(drive('t1', 390, 844, false, 30).rig.viewAz).toBe(0);
    expect(drive('t1', 844, 390, true, 30).rig.viewAz).toBe(0);
  });

  it('the car stays big on a phone: view width keeps >= minPxPerMetre at any speed', () => {
    const r = drive('t1', 390, 844, true, 55);
    expect((390 / (r.rig.halfW * 2))).toBeGreaterThanOrEqual(CONFIG.render.camera.minPxPerMetre * 0.99 * 0.99);
  });

  it('a respawn teleport glides: no frame moves the view more than glideFollow allows and the car is back in the box afterwards', () => {
    const tr = buildTrackGeometry(trackById('t1'));
    const rig = new CameraRig();
    rig.setAspect(390 / 844); rig.setViewport(390, 844); rig.rotating = true; rig.track = tr;
    const p = tr.sampleAt(100);
    rig.snap(p.x, p.y); rig.update(0, p.x, p.y, 0, 0, 0, 0);
    for (let i = 0; i < 60; i++) rig.update(DT, p.x, p.y, p.tx * 30, p.ty * 30, 0.5, 0);
    const q = tr.sampleAt(400);
    let worst = 0, prev = rig.target;
    for (let i = 0; i < 120; i++) {
      rig.update(DT, q.x, q.y, 0, 0, 0, 0);
      const tgt = rig.target; worst = Math.max(worst, Math.hypot(tgt.x - prev.x, tgt.z - prev.z)); prev = tgt;
    }
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    expect(worst).toBeLessThan(d * 0.25);           // never a single-frame jump across the gap
    const c = rig.project(q.x, q.y);
    expect(Math.max(Math.abs(c.x), Math.abs(c.y))).toBeLessThan(0.6);
  });
});
