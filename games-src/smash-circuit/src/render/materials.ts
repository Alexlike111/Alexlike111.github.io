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

/**
 * Car body variant of the paint material. Reads a per-instance attribute aDmg (front, rear, left, right crumple 0..1, written by
 * CarFleet on a cloned body geometry): vertices near a damaged end are pulled in (dents) and scuffed dark, so moderate damage is
 * visible on the car itself, not only in the HUD. Car-local axes: +x nose, +z left.
 */
export function patchBodyDamage(m: THREE.Material, depth: number): void {
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = `attribute float aPaint;
attribute vec4 aDmg;
float dmgHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
vec4 dmgField(vec3 p) {
  return vec4(smoothstep(0.35, 1.8, p.x) * aDmg.x, smoothstep(0.35, 1.8, -p.x) * aDmg.y, smoothstep(0.2, 0.85, p.z) * aDmg.z, smoothstep(0.2, 0.85, -p.z) * aDmg.w);
}
` + shader.vertexShader.replace(
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
      {
        vec4 dz = dmgField( position );
        float dm = max( max( dz.x, dz.y ), max( dz.z, dz.w ) );
        float hv = dmgHash( position * 3.1 );
        // scuffed paint near damaged zones: grey primer showing through first, sooty black as it gets worse; patchy per vertex
        vec3 scuff = mix( vec3( 0.62, 0.6, 0.57 ), vec3( 0.2, 0.17, 0.15 ), smoothstep( 0.25, 0.65, dm ) );
        vColor.rgb = mix( vColor.rgb, scuff, clamp( dm * ( 0.75 + 0.7 * hv ), 0.0, 0.6 ) );   // never fully overpaints: the body colour survives a wreck
      }`,
    ).replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        vec4 dz = dmgField( position );
        float h1 = dmgHash( position * 3.1 );
        float h2 = dmgHash( position.zxy * 5.3 + 1.7 );
        float d = ${depth.toFixed(3)};
        transformed.x -= dz.x * d * ( 0.35 + 0.65 * h1 );
        transformed.x += dz.y * d * ( 0.35 + 0.65 * h2 );
        transformed.z += ( h2 - 0.5 ) * ( dz.x + dz.y ) * d * 0.9;
        transformed.z -= dz.z * d * 0.5 * ( 0.3 + 0.7 * h2 );
        transformed.z += dz.w * d * 0.5 * ( 0.3 + 0.7 * h1 );
        transformed.y -= max( max( dz.x, dz.y ), max( dz.z, dz.w ) ) * 0.12 * h2;
      }`,
    );
  };
  m.customProgramCacheKey = () => 'paint-dmg';
}

export class Materials {
  readonly gradient = makeGradientMap();
  /** vertex coloured, instance colour multiplies everything (decor tint) */
  readonly toon: THREE.MeshToonMaterial;
  /** vertex coloured; instance colour tints only aPaint vertices */
  readonly paint: THREE.MeshToonMaterial;
  /** car body: paint + per-instance crumple (aDmg) */
  readonly body: THREE.MeshToonMaterial;
  readonly paintBasic: THREE.MeshBasicMaterial;
  readonly basic: THREE.MeshBasicMaterial;
  readonly ghost: THREE.MeshBasicMaterial;
  private all: THREE.Material[] = [];
  private blobMat: THREE.MeshBasicMaterial | null = null;

  constructor() {
    this.toon = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: this.gradient });
    this.paint = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: this.gradient });
    patchPaint(this.paint);
    this.body = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: this.gradient });
    patchBodyDamage(this.body, CONFIG.render.fx.dentDepth);
    this.paintBasic = new THREE.MeshBasicMaterial({ vertexColors: true });
    patchPaint(this.paintBasic);
    this.basic = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.ghost = new THREE.MeshBasicMaterial({ vertexColors: false, transparent: true, depthWrite: false, opacity: 0.4 });
    this.all.push(this.toon, this.paint, this.body, this.paintBasic, this.basic, this.ghost);
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
