// Shared materials. Toon shading with a 4-step gradient gives the cartoon look at Lambert cost.
import * as THREE from 'three';
import { CONFIG } from '../config';

export function makeGradientMap(): THREE.DataTexture {
  // 4 bands: shadow side stays fairly bright (cartoon, no heavy darks)
  const data = new Uint8Array([150, 190, 225, 255]);
  const t = new THREE.DataTexture(data, 4, 1, THREE.RedFormat);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** Patch a material so the instance colour only tints vertices with aPaint > 0 (car paint vs. trim/glass/tyres). */
export function patchPaint(m: THREE.Material): void {
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = 'attribute float aPaint;\n' + shader.vertexShader.replace(
      '#include <color_vertex>',
      `#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR )
        vColor = vec4( 1.0 );
      #endif
      #ifdef USE_COLOR
        vColor.rgb *= color.rgb;
      #endif
      #ifdef USE_INSTANCING_COLOR
        vColor.rgb *= mix( vec3( 1.0 ), instanceColor.rgb, aPaint );
      #endif`,
    );
  };
  m.customProgramCacheKey = () => 'paint-patch';
}

/** How the car damage shader treats a mesh: body shell (dents + scuffs), detachable panels (scuffs only, they bend on the CPU), lamps (sink + crack). */
export type DamageLook = 'body' | 'part' | 'lamp';

const DMG_COMMON = /* glsl */`
attribute float aPaint;
attribute vec4 aDmg;
varying vec3 vDmgP;
varying vec4 vDmgF;
varying float vDmgPaint;
float dmgHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
vec4 dmgField(vec3 p) {
  return vec4(smoothstep(0.35, 1.8, p.x) * aDmg.x, smoothstep(0.35, 1.8, -p.x) * aDmg.y, smoothstep(0.2, 0.85, p.z) * aDmg.z, smoothstep(0.2, 0.85, -p.z) * aDmg.w);
}
`;

const DMG_FRAG_COMMON = /* glsl */`
varying vec3 vDmgP;
varying vec4 vDmgF;
varying float vDmgPaint;
float dmgH3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float dmgNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dmgH3(i), dmgH3(i + vec3(1, 0, 0)), f.x), mix(dmgH3(i + vec3(0, 1, 0)), dmgH3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(dmgH3(i + vec3(0, 0, 1)), dmgH3(i + vec3(1, 0, 1)), f.x), mix(dmgH3(i + vec3(0, 1, 1)), dmgH3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;

/**
 * Car damage look. Reads a per-instance attribute aDmg (front, rear, left, right crumple 0..1, written by CarFleet; one buffer shared
 * by the body, the panels and the lamps of a fleet). Car-local axes: +x nose, +z left.
 * - body: vertices near a damaged end are pulled in (dents; the shell is subdivided and flat shaded so the crumple shows as facets),
 *   paint is scuffed grey -> sooty per vertex;
 * - every look: per-pixel soot patches and bright bare-metal scratches grow over the damaged zone (readable from the top-down camera);
 * - lamp: sinks with the dented body and the glass goes dark and cracked.
 */
export function patchBodyDamage(m: THREE.Material, depth: number, look: DamageLook = 'body'): void {
  const sootMax = look === 'lamp' ? 0.92 : CONFIG.render.fx.sootMax;
  m.onBeforeCompile = (shader) => {
    let vs = DMG_COMMON + shader.vertexShader.replace(
      '#include <color_vertex>',
      `#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR )
        vColor = vec4( 1.0 );
      #endif
      #ifdef USE_COLOR
        vColor.rgb *= color.rgb;
      #endif
      #ifdef USE_INSTANCING_COLOR
        vColor.rgb *= mix( vec3( 1.0 ), instanceColor.rgb, aPaint );
      #endif
      vDmgP = position;
      vDmgF = dmgField( position );
      vDmgPaint = aPaint;
      ${look === 'body' ? `{
        vec4 dz = vDmgF;
        float dm = max( max( dz.x, dz.y ), max( dz.z, dz.w ) );
        float hv = dmgHash( position * 3.1 );
        // scuffed paint near damaged zones: grey primer showing through first, sooty black as it gets worse; patchy per vertex
        vec3 scuff = mix( vec3( 0.62, 0.6, 0.57 ), vec3( 0.2, 0.17, 0.15 ), smoothstep( 0.25, 0.65, dm ) );
        vColor.rgb = mix( vColor.rgb, scuff, clamp( dm * ( 0.75 + 0.7 * hv ), 0.0, 0.6 ) );   // never fully overpaints: the body colour survives a wreck
      }` : ''}`,
    );
    if (look !== 'part') {
      vs = vs.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
      {
        vec4 dz = dmgField( position );
        ${look === 'lamp' ? 'float h1 = 1.0; float h2 = 0.5;' : 'float h1 = dmgHash( position * 3.1 ); float h2 = dmgHash( position.zxy * 5.3 + 1.7 );'}
        float d = ${depth.toFixed(3)};
        transformed.x -= dz.x * d * ( 0.35 + 0.65 * h1 );
        transformed.x += dz.y * d * ( 0.35 + 0.65 * h1 );
        transformed.z += ( h2 - 0.5 ) * ( dz.x + dz.y ) * d * 0.9;
        transformed.z -= dz.z * d * 0.5 * ( 0.3 + 0.7 * h2 );
        transformed.z += dz.w * d * 0.5 * ( 0.3 + 0.7 * h1 );
        transformed.y -= max( max( dz.x, dz.y ), max( dz.z, dz.w ) ) * 0.12 * h2;
      }`,
      );
    }
    shader.vertexShader = vs;
    shader.fragmentShader = DMG_FRAG_COMMON + shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      {
        float dm = max( max( vDmgF.x, vDmgF.y ), max( vDmgF.z, vDmgF.w ) );
        if ( dm > 0.002 ) {
          float n = dmgNoise( vDmgP * 2.4 );
          float n2 = dmgNoise( vDmgP * 6.5 + 3.1 );
          ${look === 'lamp' ? `
          // smashed lamp: dark glass with a few bright shards
          float crack = smoothstep( 0.15, 0.55, dm + ( n2 - 0.5 ) * 0.5 );
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.07, 0.07, 0.08 ) + step( 0.82, n2 ) * 0.35, crack * ${sootMax.toFixed(2)} );` : `
          // bare-metal scratches running along the car, broken up by noise (paint only)
          float line = abs( fract( vDmgP.z * 2.2 + vDmgP.x * 0.3 + n2 * 0.7 ) - 0.5 );
          float scratch = ( 1.0 - smoothstep( 0.05, 0.11, line ) ) * smoothstep( 0.42, 0.58, n ) * smoothstep( 0.06, 0.35, dm ) * vDmgPaint;
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.9, 0.88, 0.84 ), scratch * 0.8 );
          // burnt / torn patches spreading with the damage
          float soot = smoothstep( 0.58, 0.72, n * 0.7 + n2 * 0.3 + dm * 0.6 - 0.2 );
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.07, 0.06, 0.06 ), soot * ${sootMax.toFixed(2)} * ( 0.35 + 0.65 * vDmgPaint ) );`}
        }
      }`,
    );
  };
  m.customProgramCacheKey = () => 'car-dmg-' + look;
}

export class Materials {
  readonly gradient = makeGradientMap();
  /** vertex coloured, instance colour multiplies everything (decor tint) */
  readonly toon: THREE.MeshToonMaterial;
  /** vertex coloured; instance colour tints only aPaint vertices */
  readonly paint: THREE.MeshToonMaterial;
  /** car body: paint + per-instance crumple (aDmg) */
  readonly body: THREE.MeshToonMaterial;
  /** detachable car panels: paint + per-instance scuffs / soot (aDmg), no vertex dent (they bend on the CPU) */
  readonly carPart: THREE.MeshToonMaterial;
  /** car lamps: unlit, sink into a dented end and crack dark (aDmg) */
  readonly carLamp: THREE.MeshBasicMaterial;
  readonly paintBasic: THREE.MeshBasicMaterial;
  readonly basic: THREE.MeshBasicMaterial;
  readonly ghost: THREE.MeshBasicMaterial;
  private all: THREE.Material[] = [];
  private blobMat: THREE.MeshBasicMaterial | null = null;

  constructor() {
    this.toon = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: this.gradient });
    this.paint = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: this.gradient });
    patchPaint(this.paint);
    // flat shaded: a crumpled (displaced) facet catches the light differently, so the dents read even from straight above
    this.body = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: this.gradient });
    (this.body as unknown as { flatShading: boolean }).flatShading = true;   // toon shader honours FLAT_SHADED (derivative normals); the typings omit it
    patchBodyDamage(this.body, CONFIG.render.fx.dentDepth, 'body');
    this.carPart = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: this.gradient });
    patchBodyDamage(this.carPart, CONFIG.render.fx.dentDepth, 'part');
    this.carLamp = new THREE.MeshBasicMaterial({ vertexColors: true });
    patchBodyDamage(this.carLamp, CONFIG.render.fx.dentDepth, 'lamp');
    this.paintBasic = new THREE.MeshBasicMaterial({ vertexColors: true });
    patchPaint(this.paintBasic);
    this.basic = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.ghost = new THREE.MeshBasicMaterial({ vertexColors: false, transparent: true, depthWrite: false, opacity: 0.4 });
    this.all.push(this.toon, this.paint, this.body, this.carPart, this.carLamp, this.paintBasic, this.basic, this.ghost);
  }

  /** Soft ellipse used as a fake shadow when real shadows are off (created lazily: needs a DOM canvas). White map: CarFleet tints it per instance (one neutral dark for all cars). */
  blob(): THREE.MeshBasicMaterial {
    if (this.blobMat) return this.blobMat;
    let map: THREE.Texture | null = null;
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d')!;
      const gr = g.createRadialGradient(32, 32, 4, 32, 32, 31);
      gr.addColorStop(0, 'rgba(255,255,255,0.52)'); gr.addColorStop(0.65, 'rgba(255,255,255,0.34)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      map = new THREE.CanvasTexture(c);
    }
    this.blobMat = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.all.push(this.blobMat);
    return this.blobMat;
  }

  /** Force a recompile of every material (after toggling shadows). */
  refresh(): void { for (const m of this.all) m.needsUpdate = true; }

  dispose(): void { for (const m of this.all) m.dispose(); this.gradient.dispose(); }
}
