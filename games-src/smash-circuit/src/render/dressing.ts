// Track dressing: a skid-worn racing line on the asphalt, sponsor boards along the start straight, big soft tone patches on the
// ground and the themed scenery pieces (hay bales, market tents, ice spikes). Everything is merged geometry on shared materials:
// the racing line is one extra draw call, the boards one, the ground patch costs nothing (a shader patch on the ground material).
import * as THREE from 'three';
import { CONFIG } from '../config';
import type { TrackGeometry } from '../types';
import { GeoBuilder, concat } from './geo';
import type { Materials } from './materials';
import type { ThemePalette } from './palette';
import { makeRng } from './util';

const D = CONFIG.destruction;

// ------------------------------------------------------------------------------------------------ racing line

/** Smoothed lateral offset (m, along the sample normal) of the "dry line": it cuts to the inside of long curves. */
function racingLineOffsets(track: TrackGeometry): { off: Float32Array; heat: Float32Array } {
  const S = track.samples, n = S.length;
  const off = new Float32Array(n), heat = new Float32Array(n);
  const win = Math.max(4, Math.round(16 / (track.length / n)));
  const maxOff = Math.max(0, track.def.width / 2 - 1.6);
  const G = 52;
  for (let i = 0; i < n; i++) {
    let sk = 0, ak = 0;
    for (let j = -win; j <= win; j++) { const k = S[(i + j + n * 4) % n].curvature; const w = 1 - Math.abs(j) / (win + 1); sk += k * w; ak += Math.abs(k) * w; }
    const norm = win;   // sum of the triangular weights ~ win
    off[i] = Math.max(-maxOff, Math.min(maxOff, (sk / norm) * G));
    heat[i] = Math.min(1, (ak / norm) * 38);
  }
  // light smoothing so the strip never kinks
  const tmp = new Float32Array(n);
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < n; i++) tmp[i] = (off[(i + n - 1) % n] + off[i] * 2 + off[(i + 1) % n]) / 4;
    off.set(tmp);
  }
  return { off, heat };
}

/** Dark rubbered-in strip following the racing line (soft edges, darker in the corners). One transparent draw call. */
export function buildRacingLine(track: TrackGeometry, pal: ThemePalette): THREE.Mesh {
  const S = track.samples, n = S.length;
  const { off, heat } = racingLineOffsets(track);
  const lat = [-1.2, 0, 1.2];
  const alphaAt = [0, 1, 0];
  const stride = 2;                                  // a row every 2 m is plenty for a soft strip (keeps it to ~2 triangles per metre)
  const rows = Math.ceil(n / stride) + 1;
  const pos = new Float32Array(rows * 3 * 3), col = new Float32Array(rows * 3 * 4), idx: number[] = [];
  const c = new THREE.Color(pal.roadWear).multiplyScalar(0.28);
  const rng = makeRng(track.def.id.length * 131 + 9);
  const phase = rng() * 6.28;
  for (let r = 0; r < rows; r++) {
    const i = Math.min(r * stride, n);
    const sm = S[i % n];
    const wear = 0.22 + 0.17 * heat[i % n] + 0.05 * Math.sin(i * 0.11 + phase) + 0.04 * Math.sin(i * 0.37 + phase * 2);
    for (let j = 0; j < 3; j++) {
      const l = off[i % n] + lat[j];
      const v = r * 3 + j;
      pos.set([sm.x + sm.nx * l, 0.047, sm.y + sm.ny * l], v * 3);
      col.set([c.r, c.g, c.b, wear * alphaAt[j]], v * 4);
      if (r < rows - 1 && j < 2) { const a = v; idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4); }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  m.renderOrder = 1;
  m.name = 'racingLine';
  return m;
}

// ------------------------------------------------------------------------------------------------ sponsor boards

/**
 * Advertising boards behind the walls on both sides of the start straight (outside the stands): coloured panels with a
 * white band and a dark frame, on two posts. Boards that would stand where the track bends are skipped.
 */
export function buildBoards(track: TrackGeometry, pal: ThemePalette, mats: Materials): THREE.Mesh | null {
  const def = track.def, L = track.length;
  const parts: { geo: THREE.BufferGeometry; matrix?: THREE.Matrix4 }[] = [];
  const lat0 = def.width / 2 + D.wallOffset + 2.0;
  const rng = makeRng(991 + def.id.length * 17);
  let count = 0;
  const straight = (s: number): boolean => {
    for (let q = -4; q <= 4; q += 2) if (Math.abs(track.sampleAt(s + q).curvature) > 0.0035) return false;
    return true;
  };
  const slots: number[] = [];
  for (let s = -64; s <= -10; s += 6.4) slots.push(s);
  for (let s = 40; s <= 96; s += 6.4) slots.push(s);
  for (const s0 of slots) {
    const s = ((s0 % L) + L) % L;
    if (!straight(s)) continue;
    const t = track.sampleAt(s);
    for (const side of [1, -1]) {
      if (rng() < 0.12) continue;
      const col = pal.accent[Math.floor(rng() * pal.accent.length)];
      const band = pal.accent[(Math.floor(rng() * pal.accent.length) + 2) % pal.accent.length];
      const yaw = -Math.atan2(t.ty, t.tx);
      const cx = t.x + t.nx * side * lat0, cy = t.y + t.ny * side * lat0;
      const b = new GeoBuilder();
      b.box(5.6, 1.5, 0.14, { pos: [0, 1.25, 0], color: col, vgrad: [0.5, 1.8, 0.85, 1.05] });
      b.box(5.8, 0.1, 0.2, { pos: [0, 2.0, 0], color: 0x2a2f3a });
      b.box(5.8, 0.1, 0.2, { pos: [0, 0.48, 0], color: 0x2a2f3a });
      b.box(3.4, 0.6, 0.05, { pos: [0, 1.3, side * -0.08], color: 0xf4f6fb });          // light band facing the road
      b.box(1.2, 0.4, 0.05, { pos: [1.0, 1.3, side * -0.11], color: band });
      for (const px of [-2.5, 2.5]) b.box(0.14, 0.5, 0.14, { pos: [px, 0.25, 0], color: 0x2a2f3a });
      const geo = b.build();
      // leaned back so the face shows from the top-down camera
      const matrix = new THREE.Matrix4().compose(new THREE.Vector3(cx, 0, cy), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1))
        .multiply(new THREE.Matrix4().makeRotationX(side * 0.5));
      parts.push({ geo, matrix });
      count++;
    }
  }
  if (!count) return null;
  const geo = concat(parts);
  for (const p of parts) p.geo.dispose();
  const m = new THREE.Mesh(geo, mats.toon);
  m.name = 'boards';
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

// ------------------------------------------------------------------------------------------------ ground tone patches

/**
 * Big soft tone patches (about 40 m and 15 m across) on the ground, in world space, so the huge ground plane does not read as one
 * repeating tile. A few fragment instructions on the ground material only; no texture, no draw call.
 */
export function patchGroundMacro(mat: THREE.MeshToonMaterial, pal: ThemePalette): void {
  const warm = new THREE.Color(pal.groundAlt).lerp(new THREE.Color(0xfff2c0), 0.35), cool = new THREE.Color(pal.groundDark);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uMacroA = { value: new THREE.Vector3(warm.r / Math.max(0.05, new THREE.Color(pal.ground).r), warm.g / Math.max(0.05, new THREE.Color(pal.ground).g), warm.b / Math.max(0.05, new THREE.Color(pal.ground).b)) };
    shader.uniforms.uMacroB = { value: new THREE.Vector3(cool.r / Math.max(0.05, new THREE.Color(pal.ground).r), cool.g / Math.max(0.05, new THREE.Color(pal.ground).g), cool.b / Math.max(0.05, new THREE.Color(pal.ground).b)) };
    shader.vertexShader = 'varying vec2 vMacroP;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vMacroP = ( modelMatrix * vec4( position, 1.0 ) ).xz;');
    shader.fragmentShader = `varying vec2 vMacroP;
uniform vec3 uMacroA;
uniform vec3 uMacroB;
float mcH( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float mcN( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mcH( i ), mcH( i + vec2( 1.0, 0.0 ) ), f.x ), mix( mcH( i + vec2( 0.0, 1.0 ) ), mcH( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
` + shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      {
        float big = mcN( vMacroP * 0.026 ) * 0.62 + mcN( vMacroP * 0.071 + 7.3 ) * 0.38;
        vec3 tone = mix( uMacroB, uMacroA, smoothstep( 0.3, 0.7, big ) );
        diffuseColor.rgb *= mix( vec3( 1.0 ), tone, 0.85 );
      }`,
    );
  };
  mat.customProgramCacheKey = () => 'ground-macro';
}

// ------------------------------------------------------------------------------------------------ themed scenery pieces

const wrapGeo = (b: GeoBuilder): THREE.BufferGeometry => b.build();

/** meadow: a round hay bale lying on its side with a twine band, and a small stacked pair */
export function hayGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const bale = (x: number, z: number, y: number, rot: number): void => {
    b.cyl(0.62, 0.62, 0.95, 10, { pos: [x, y + 0.62, z], rot: [Math.PI / 2, 0, rot], color: 0xe9c75a, vgrad: [0, 1.3, 0.8, 1.05] });
    b.cyl(0.635, 0.635, 0.08, 10, { pos: [x, y + 0.62, z], rot: [Math.PI / 2, 0, rot], color: 0xb98a2e });
    b.cyl(0.4, 0.4, 0.97, 8, { pos: [x, y + 0.62, z], rot: [Math.PI / 2, 0, rot], color: 0xd9b043 });
  };
  bale(0, 0, 0, 0); bale(1.25, 0.2, 0, 0.5); bale(0.62, 0.08, 1.0, 0.2);
  return wrapGeo(b);
}

/** desert: a striped market tent (pyramid roof over a box) with a crate beside it */
export function tentGeometry(pal: ThemePalette): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const [c1, c2] = [pal.accent[0], pal.accent[3] ?? 0xffffff];
  b.box(3.2, 0.12, 3.2, { pos: [0, 0.06, 0], color: 0xb9884a });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.12, 1.5, 0.12, { pos: [sx * 1.4, 0.8, sz * 1.4], color: 0x7b5230 });
  const roof = new THREE.CylinderGeometry(0.01, 2.45, 1.0, 8, 1);
  roof.rotateY(Math.PI / 8);
  b.add(roof, { pos: [0, 2.0, 0], colorFn: (_nx, _ny, _nz, x, _y, z) => (Math.floor((Math.atan2(z, x) + Math.PI) / (Math.PI / 4)) % 2 ? c2 : c1) });
  roof.dispose();
  b.box(0.9, 0.7, 0.9, { pos: [2.5, 0.35, 0.8], color: 0xb07a3c, vgrad: [0, 0.7, 0.8, 1] });
  b.box(0.7, 0.5, 0.7, { pos: [2.6, 0.95, 0.9], color: 0xc58a46 });
  return wrapGeo(b);
}

/** snow: a cluster of pale blue ice spikes */
export function iceGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const spikes: [number, number, number, number][] = [[0, 0, 1.3, 0.42], [0.55, 0.3, 0.8, 0.3], [-0.5, 0.35, 0.95, 0.34], [0.2, -0.55, 0.7, 0.28], [-0.35, -0.35, 0.5, 0.22]];
  for (const [x, z, h, r] of spikes) b.cyl(0.02, r, h, 5, { pos: [x, h / 2, z], rot: [0, x * 3, (x - z) * 0.12], color: 0xbfe3fb, vgrad: [0, h, 0.82, 1.1] });
  b.cyl(0.85, 0.95, 0.12, 8, { pos: [0, 0.06, 0], color: 0xe9f5ff });
  return wrapGeo(b);
}
