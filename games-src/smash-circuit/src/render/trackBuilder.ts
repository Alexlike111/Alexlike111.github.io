// Static track visuals: themed ground, textured road ribbon (edge lines, lane dashes), start/finish, grid slots,
// gantry arch and crowd stands. Everything is merged: ground 1 + road 1 + paint 1 + gantry/stands 2 draw calls.
import * as THREE from 'three';
import { CONFIG } from '../config';
import type { TrackGeometry } from '../types';
import { GeoBuilder, concat } from './geo';
import type { Materials } from './materials';
import type { ThemePalette } from './palette';
import { GROUND_TILE, ROAD_TILE, makeGroundTexture, makeRoadTexture } from './textures';
import { makeRng } from './util';

export interface Exclusion { x: number; y: number; r: number }

export interface TrackVisual {
  group: THREE.Group;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  exclusions: Exclusion[];
  dispose(): void;
}

const D = CONFIG.destruction;
const SKIN = [0xf4cfa6, 0xe0a979, 0xa86f48, 0xffe2c4];

export function shoulderWidth(): number { return D.wallOffset + 1.0; }

export function buildTrackVisual(track: TrackGeometry, pal: ThemePalette, mats: Materials): TrackVisual {
  const group = new THREE.Group();
  const def = track.def;
  const exclusions: Exclusion[] = [];
  const disposables: { dispose(): void }[] = [];

  // ---- bounds
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of track.samples) { minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x); minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y); }

  // ---- ground
  {
    const size = Math.max(maxX - minX, maxY - minY) + 900;
    const geo = new THREE.PlaneGeometry(size, size);
    geo.rotateX(-Math.PI / 2);
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * size / GROUND_TILE, uv.getY(i) * size / GROUND_TILE);
    const tex = makeGroundTexture(def.theme, pal);
    const mat = new THREE.MeshToonMaterial({ map: tex, gradientMap: mats.gradient });
    const m = new THREE.Mesh(geo, mat);
    m.position.set((minX + maxX) / 2, 0, (minY + maxY) / 2);
    m.receiveShadow = true;
    group.add(m);
    disposables.push(geo, tex, mat);
  }

  // ---- road ribbon
  const sh = shoulderWidth();
  {
    const half = def.width / 2 + sh;
    const n = track.samples.length;
    const pos = new Float32Array((n + 1) * 2 * 3);
    const nor = new Float32Array((n + 1) * 2 * 3);
    const uvs = new Float32Array((n + 1) * 2 * 2);
    const idx: number[] = [];
    const y = 0.04;
    for (let i = 0; i <= n; i++) {
      const sm = track.samples[i % n];
      const k = sm.curvature;
      // clamp the inner edge so tight hairpins do not fold over themselves
      const latL = k > 0 ? Math.min(half, 0.85 / k) : half;
      const latR = k < 0 ? Math.min(half, 0.85 / -k) : half;
      const v = (i * track.length / n) / ROAD_TILE;
      const a = i * 2;
      pos.set([sm.x + sm.nx * latL, y, sm.y + sm.ny * latL], a * 3);
      pos.set([sm.x - sm.nx * latR, y, sm.y - sm.ny * latR], (a + 1) * 3);
      nor.set([0, 1, 0, 0, 1, 0], a * 3);
      uvs.set([1, v, 0, v], a * 2);
      if (i < n) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const tex = makeRoadTexture(def.width, sh, D.roadLanes, pal);
    const mat = new THREE.MeshToonMaterial({ map: tex, gradientMap: mats.gradient });
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    m.frustumCulled = false;
    group.add(m);
    disposables.push(geo, tex, mat);
  }

  // ---- paint: start/finish checker + grid slots (flat quads, vertex coloured)
  {
    const b = new GeoBuilder();
    const quad = (s: number, lat: number, lenS: number, wLat: number, color: number, y: number): void => {
      const t = track.sampleAt(s);
      const g = new THREE.PlaneGeometry(lenS, wLat);
      g.rotateX(-Math.PI / 2);
      b.add(g, { pos: [t.x + t.nx * lat, y, t.y + t.ny * lat], rot: [0, -Math.atan2(t.ty, t.tx), 0], color });
    };
    // checker line, 2 rows
    const cols = Math.max(6, Math.round(def.width / 1.0));
    const cw = (def.width - 0.8) / cols;
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < cols; c++) {
        const lat = -def.width / 2 + 0.4 + (c + 0.5) * cw;
        quad(-0.55 + r * 1.1, lat, 1.1, cw, (c + r) % 2 ? 0x1b1d24 : 0xffffff, 0.06);
      }
    }
    // grid slots
    const sp = CONFIG.race.startGridSpacing;
    for (let slot = 0; slot < CONFIG.race.cars; slot++) {
      const row = Math.floor(slot / 2), col = slot % 2;
      const s = -(sp * (row + 1)) - (col ? sp * 0.5 : 0);
      const lat = (col ? -1 : 1) * def.width * CONFIG.race.gridSideFraction;
      quad(s + 2.7, lat, 0.16, 2.5, 0xffffff, 0.058);
      quad(s + 2.1, lat - 1.17, 1.3, 0.14, 0xffffff, 0.058);
      quad(s + 2.1, lat + 1.17, 1.3, 0.14, 0xffffff, 0.058);
    }
    const geo = b.build();
    const m = new THREE.Mesh(geo, mats.basic);
    m.frustumCulled = false;
    group.add(m);
    disposables.push(geo);
  }

  // ---- gantry + stands (merged into one mesh with the shaded toon material)
  {
    const parts: { geo: THREE.BufferGeometry; matrix?: THREE.Matrix4 }[] = [];
    const rng = makeRng(2024 + def.id.length);

    // gantry arch over the start line
    {
      const g = new GeoBuilder();
      const span = def.width / 2 + D.wallOffset + 1.8;
      const H = 5.4;
      for (const sz of [-1, 1]) {
        g.box(0.8, H, 0.8, { pos: [0, H / 2, sz * span], color: 0xdfe3ec, vgrad: [0, H, 0.8, 1.05] });
        g.box(1.1, 0.5, 1.1, { pos: [0, 0.25, sz * span], color: 0x7d8594 });
        g.box(0.06, 1.2, 0.06, { pos: [0, H + 0.9, sz * span], color: 0x7d8594 });
        g.box(0.04, 0.4, 0.7, { pos: [0, H + 1.3, sz * span - sz * 0.4], color: sz > 0 ? 0xff4d4d : 0x3a9bff });
      }
      g.box(1.1, 0.7, span * 2 + 0.8, { pos: [0, H + 0.2, 0], color: 0xdfe3ec });
      // checker on top of the beam, visible from above
      const cells = Math.round(span * 2 / 0.8);
      for (let i = 0; i < cells; i++) for (let r = 0; r < 2; r++) {
        g.box(0.5, 0.02, (span * 2) / cells - 0.02, { pos: [-0.27 + r * 0.54, H + 0.56, -span + (i + 0.5) * (span * 2 / cells)], color: (i + r) % 2 ? 0x1b1d24 : 0xffffff });
      }
      // banner blocks on the front face
      for (let i = 0; i < 6; i++) {
        g.box(0.1, 0.55, (span * 2 - 1) / 6 - 0.1, { pos: [0.6, H + 0.2, -span + 0.5 + (i + 0.5) * ((span * 2 - 1) / 6)], color: pal.accent[i % pal.accent.length] });
      }
      const t = track.sampleAt(3.2);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(t.x, 0, t.y), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.atan2(t.ty, t.tx)), new THREE.Vector3(1, 1, 1));
      parts.push({ geo: g.build(), matrix: m });
      exclusions.push({ x: t.x, y: t.y, r: span + 6 });
    }

    // stands: next to the start line on both sides, + one on the straightest far stretch
    const buildStand = (len: number, tiers: number): THREE.BufferGeometry => {
      const g = new GeoBuilder();
      const stepD = 2.0, stepH = 0.85;
      for (let k = 0; k < tiers; k++) {
        g.box(len, stepH * (k + 1), stepD, { pos: [0, (stepH * (k + 1)) / 2, k * stepD + stepD / 2], color: pal.stand, vgrad: [0, stepH * tiers, 0.82, 1.04] });
        const top = stepH * (k + 1);
        const per = Math.floor(len / 0.72);
        for (let i = 0; i < per; i++) {
          const x = -len / 2 + (i + 0.5) * (len / per);
          if (rng() < 0.1) continue;
          const shirt = pal.accent[Math.floor(rng() * pal.accent.length)];
          const skin = SKIN[Math.floor(rng() * SKIN.length)];
          const z = k * stepD + stepD * 0.62;
          g.box(0.46, 0.55, 0.38, { pos: [x, top + 0.28, z], color: shirt, vgrad: [top, top + 0.6, 0.8, 1.05] });
          g.box(0.3, 0.3, 0.3, { pos: [x, top + 0.7, z], color: skin });
          if (rng() < 0.22) {
            g.box(0.1, 0.4, 0.1, { pos: [x - 0.3, top + 0.7, z - 0.05], rot: [0, 0, 0.25], color: skin });
            g.box(0.1, 0.4, 0.1, { pos: [x + 0.3, top + 0.7, z - 0.05], rot: [0, 0, -0.25], color: skin });
          }
        }
      }
      const back = tiers * stepD;
      g.box(len + 0.6, stepH * tiers + 1.6, 0.4, { pos: [0, (stepH * tiers + 1.6) / 2, back + 0.2], color: 0x8e99ad });
      const seg = Math.round(len / 4);
      for (let i = 0; i < seg; i++) {
        g.box(len / seg - 0.15, 1.1, 0.12, { pos: [-len / 2 + (i + 0.5) * (len / seg), stepH * tiers + 0.6, back - 0.05], color: pal.accent[(i + 1) % pal.accent.length] });
      }
      for (const sx of [-1, 1]) {
        g.box(0.2, 5, 0.2, { pos: [sx * (len / 2 + 0.2), 2.5, back + 0.4], color: 0x7d8594 });
        g.box(0.8, 0.3, 0.8, { pos: [sx * (len / 2 + 0.2), 5.1, back + 0.4], color: 0xfff6c8 });
      }
      return g.build();
    };

    const place = (s: number, side: number, len: number): void => {
      const t = track.sampleAt(s);
      const lat = side * (def.width / 2 + D.wallOffset + 2.4);
      const cx = t.x + t.nx * lat, cy = t.y + t.ny * lat;
      const yaw = -Math.atan2(t.ty, t.tx) + (side < 0 ? Math.PI : 0);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(cx, 0, cy), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
      parts.push({ geo: buildStand(len, 3), matrix: m });
      const ex = cx + t.nx * side * 3, ey = cy + t.ny * side * 3;
      exclusions.push({ x: ex, y: ey, r: len / 2 + 5 });
    };
    // do not put stands where the start straight bends
    const straightAt = (s: number, len: number): boolean => {
      for (let q = -len / 2; q <= len / 2; q += 4) if (Math.abs(track.sampleAt(s + q).curvature) > 0.0045) return false;
      return true;
    };
    const L = track.length;
    for (const s of [12, 22, 6, 30]) if (straightAt(s, 34)) { place(s, 1, 30); place(s, -1, 30); break; }
    // far stand
    let bestS = -1, bestScore = Infinity;
    for (let s = L * 0.25; s < L * 0.8; s += 8) {
      let worst = 0;
      for (let q = -18; q <= 18; q += 4) worst = Math.max(worst, Math.abs(track.sampleAt(s + q).curvature));
      if (worst < bestScore) { bestScore = worst; bestS = s; }
    }
    if (bestS >= 0 && bestScore < 0.004) place(bestS, rng() > 0.5 ? 1 : -1, 26);

    // one mesh per structure (gantry, each stand): the stands are only drawn while they are near the camera
    for (const p of parts) {
      const geo = concat([p]);
      p.geo.dispose();
      const m = new THREE.Mesh(geo, mats.toon);
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = true;
      group.add(m);
      disposables.push(geo);
    }
  }

  return {
    group, bounds: { minX, maxX, minY, maxY }, exclusions,
    dispose() { for (const d of disposables) d.dispose(); },
  };
}
