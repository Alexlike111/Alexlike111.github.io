// Procedural low-poly geometry building: many primitives -> one flat-shaded, vertex-coloured BufferGeometry.
// Attributes written: position, normal, color (linear rgb), aPaint (1 = multiplied by the instance colour = car paint).
import * as THREE from 'three';

export type RGB = THREE.ColorRepresentation;
export type ColorFn = (nx: number, ny: number, nz: number, x: number, y: number, z: number) => RGB;

export interface AddOpts {
  pos?: [number, number, number];
  rot?: [number, number, number];     // Euler XYZ
  scale?: [number, number, number];   // must stay positive (negative scale flips the winding)
  color?: RGB;
  colorFn?: ColorFn;                  // overrides color per vertex (after transform, normal is the face normal)
  paint?: number;                     // 0..1 how strongly the instance colour tints this part
  /** drop faces that point straight down (hidden under the part or on the ground; top-down camera never sees them) */
  noBottom?: boolean;
  /** vertical shading: multiplier goes from k0 at y0 to k1 at y1 (cheap ambient occlusion look) */
  vgrad?: [number, number, number, number];
}

const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export class GeoBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private paint: number[] = [];

  add(src: THREE.BufferGeometry, o: AddOpts = {}): this {
    const g = src.index ? src.toNonIndexed() : src.clone();
    const pr = o.pos ?? [0, 0, 0], ro = o.rot ?? [0, 0, 0], sc = o.scale ?? [1, 1, 1];
    _e.set(ro[0], ro[1], ro[2], 'XYZ');
    _q.setFromEuler(_e);
    _p.set(pr[0], pr[1], pr[2]);
    _s.set(sc[0], sc[1], sc[2]);
    _m.compose(_p, _q, _s);
    g.applyMatrix4(_m);
    g.computeVertexNormals(); // non-indexed -> flat face normals
    const P = g.getAttribute('position') as THREE.BufferAttribute;
    const N = g.getAttribute('normal') as THREE.BufferAttribute;
    const base = new THREE.Color(o.color ?? 0xffffff);
    const paint = o.paint ?? 0;
    for (let i = 0; i < P.count; i++) {
      if (o.noBottom && i % 3 === 0 && N.getY(i) < -0.9 && N.getY(i + 1) < -0.9 && N.getY(i + 2) < -0.9) { i += 2; continue; }
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      this.pos.push(x, y, z);
      const nx = N.getX(i), ny = N.getY(i), nz = N.getZ(i);
      this.nor.push(nx, ny, nz);
      if (o.colorFn) _c.set(o.colorFn(nx, ny, nz, x, y, z)); else _c.copy(base);
      let k = 1;
      if (o.vgrad) {
        const [y0, y1, k0, k1] = o.vgrad;
        const t = Math.min(1, Math.max(0, (y - y0) / (y1 - y0)));
        k = k0 + (k1 - k0) * t;
      }
      this.col.push(_c.r * k, _c.g * k, _c.b * k);
      this.paint.push(paint);
    }
    g.dispose();
    return this;
  }

  box(w: number, h: number, d: number, o: AddOpts = {}): this { return this.add(new THREE.BoxGeometry(w, h, d), o); }
  cyl(rTop: number, rBottom: number, h: number, seg: number, o: AddOpts = {}): this {
    return this.add(new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1), o);
  }
  ico(r: number, detail: number, o: AddOpts = {}): this { return this.add(new THREE.IcosahedronGeometry(r, detail), o); }
  /** Rectangular frustum (4-sided cone) with bottom size (wb x db) and top size (wt x dt). */
  frustum(wb: number, db: number, wt: number, dt: number, h: number, o: AddOpts = {}): this {
    const g = new THREE.CylinderGeometry(0.7071, 0.7071, h, 4, 1);
    g.rotateY(Math.PI / 4);
    // squash the unit cylinder into the frustum by moving vertices
    const P = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < P.count; i++) {
      const top = P.getY(i) > 0;
      P.setX(i, Math.sign(P.getX(i)) * 0.5 * (top ? wt : wb));
      P.setZ(i, Math.sign(P.getZ(i)) * 0.5 * (top ? dt : db));
    }
    P.needsUpdate = true;
    return this.add(g, o);
  }

  get vertexCount(): number { return this.pos.length / 3; }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aPaint', new THREE.Float32BufferAttribute(this.paint, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Concatenate already-built geometries (all must carry the GeoBuilder attributes). */
export function concat(parts: { geo: THREE.BufferGeometry; matrix?: THREE.Matrix4 }[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], pnt: number[] = [];
  const v = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  for (const { geo, matrix } of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const P = g.getAttribute('position'), N = g.getAttribute('normal'), C = g.getAttribute('color'), A = g.getAttribute('aPaint');
    if (matrix) nm.getNormalMatrix(matrix);
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P as THREE.BufferAttribute, i);
      if (matrix) v.applyMatrix4(matrix);
      pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(N as THREE.BufferAttribute, i);
      if (matrix) v.applyMatrix3(nm).normalize();
      nor.push(v.x, v.y, v.z);
      col.push((C as THREE.BufferAttribute).getX(i), (C as THREE.BufferAttribute).getY(i), (C as THREE.BufferAttribute).getZ(i));
      pnt.push((A as THREE.BufferAttribute).getX(i));
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setAttribute('aPaint', new THREE.Float32BufferAttribute(pnt, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/** Ground-plane helper: quad lying in XZ at height y, spanning [x0,x1]x[z0,z1]. */
export function groundQuad(g: GeoBuilder, x: number, z: number, w: number, d: number, y: number, color: RGB, rotY = 0): void {
  const pg = new THREE.PlaneGeometry(w, d);
  pg.rotateX(-Math.PI / 2);
  g.add(pg, { pos: [x, y, z], rot: [0, rotY, 0], color });
}
