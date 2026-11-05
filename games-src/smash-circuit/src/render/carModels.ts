// The 10 procedural low-poly car models (one per roster car, CONFIG.cars). Car-local axes: +x nose, +y up, +z left.
// Every model fills the same slots, so the damage system works for all of them: a non-detachable body (with what a lost
// panel uncovers), 8 detachable parts (bumpers, hood, doors, spoiler, mirrors), lamps and 4 wheels (position, radius, width).
// Silhouettes are made to read from the top-down race camera at ~50 px: cabin glass shape and position, wheels sticking
// out, wings, bull bars, beds and roof racks are what the player sees.
import type * as THREE from 'three';
import { GeoBuilder } from './geo';
import { numberPlate } from './livery';

export type BodyPartId = 'bumperF' | 'bumperR' | 'hood' | 'doorL' | 'doorR' | 'spoiler' | 'mirrorL' | 'mirrorR';

/** One wheel: car-local centre (x, z), radius, width. Order FL (+x,+z), FR (+x,-z), RL (-x,+z), RR (-x,-z). */
export interface WheelSpec { x: number; z: number; r: number; w: number }

export interface ModelGeo {
  body: THREE.BufferGeometry;
  parts: Record<BodyPartId, THREE.BufferGeometry>;
  lights: THREE.BufferGeometry;
  wheels: WheelSpec[];
}

export const DARK = 0x1c1f27, GLASS = 0x2f5273, CHROME = 0xdfe6f1, STRIPE = 0xffffff, STEEL = 0x5b616d, RUBBER = 0x2a2c31;
const LAMP = 0xfff7c4, TAIL = 0xff2a1a, AMBER = 0xffb02e;
const P = 1;   // paint

const g = (): GeoBuilder => new GeoBuilder();
const sym = (f: (s: number) => void): void => { f(1); f(-1); };
const wheels4 = (fx: number, rx: number, fz: number, rz: number, fr: number, rr: number, fw: number, rw: number): WheelSpec[] => [
  { x: fx, z: fz, r: fr, w: fw }, { x: fx, z: -fz, r: fr, w: fw }, { x: rx, z: rz, r: rr, w: rw }, { x: rx, z: -rz, r: rr, w: rw },
];

/** Brake hubs inside the wheels (seen when a wheel comes off) and the dark wheel wells. */
function hubs(b: GeoBuilder, w: WheelSpec[]): void {
  for (const k of w) b.cyl(k.r * 0.5, k.r * 0.5, 0.1, 8, { pos: [k.x, k.r, Math.sign(k.z) * (Math.abs(k.z) + k.w * 0.25)], rot: [Math.PI / 2, 0, 0], color: 0xa3a7ae });
}

/** Engine bay under a hood spanning [x0, x1] at height y (what a lost hood uncovers). */
function engineBay(b: GeoBuilder, x0: number, x1: number, y: number, wid: number): void {
  const cx = (x0 + x1) / 2, l = x1 - x0;
  b.box(l, 0.1, wid, { pos: [cx, y, 0], color: 0x24262c });
  b.box(l * 0.45, 0.08, wid * 0.42, { pos: [cx - l * 0.05, y + 0.03, 0.08], color: 0x8d939e });
  b.box(0.1, 0.07, wid * 0.65, { pos: [x1 - 0.1, y + 0.03, 0], color: 0x3a3d45 });
}

function door(sz: number, x: number, len: number, y: number, h: number, z: number, extra?: (b: GeoBuilder) => void): THREE.BufferGeometry {
  const b = g().box(len, h, 0.18, { pos: [x, y, sz * z], color: 0xffffff, paint: P, vgrad: [y - h / 2, y + h / 2, 0.85, 1] })
    .box(len * 0.3, 0.05, 0.02, { pos: [x + len * 0.12, y + h * 0.2, sz * (z + 0.1)], color: DARK });
  extra?.(b);
  return b.build();
}

function mirror(sz: number, x: number, y: number, z: number, scale = 1, stalk = 0): THREE.BufferGeometry {
  const b = g().box(0.2 * scale, 0.12 * scale, 0.28 * scale, { pos: [x, y, sz * z], color: 0xffffff, paint: P })
    .box(0.08, 0.1 * scale, 0.14, { pos: [x, y - 0.05, sz * (z - 0.13 * scale)], color: DARK });
  if (stalk > 0) b.box(0.05, 0.05, stalk, { pos: [x, y - 0.04, sz * (z - 0.14 - stalk / 2)], color: DARK });
  return b.build();
}

function lamps(front: [number, number, number][], tail: [number, number, number][], extra?: (b: GeoBuilder) => void): THREE.BufferGeometry {
  const b = g();
  for (const [x, y, z] of front) sym((s) => b.box(0.12, 0.14, 0.32, { pos: [x, y, s * z], color: LAMP }));
  for (const [x, y, z] of tail) sym((s) => b.box(0.1, 0.15, 0.4, { pos: [x, y, s * z], color: TAIL, paint: P }));
  extra?.(b);
  return b.build();
}

// ------------------------------------------------------------------------------------------------ 1 scrapper: compact hatch
// short boxy 3-door hatch: long glass cabin reaching the tail, stubby bonnet, chunky dark rubber bumpers, roof stripes
function scrapper(): ModelGeo {
  const W = wheels4(1.28, -1.3, 0.82, 0.82, 0.46, 0.46, 0.42, 0.42);
  const b = g();
  b.box(3.6, 0.16, 1.5, { pos: [0, 0.36, 0], color: DARK });
  b.box(3.5, 0.52, 1.76, { pos: [0, 0.62, 0], color: 0xffffff, paint: P, vgrad: [0.3, 0.9, 0.78, 1], seg: [10, 2, 5], noBottom: true });
  b.box(3.3, 0.12, 1.6, { pos: [0, 0.93, 0], color: 0xffffff, paint: P, seg: [10, 1, 5], noBottom: true });
  engineBay(b, 0.75, 1.75, 0.95, 1.3);
  sym((s) => b.box(0.16, 0.2, 1.5, { pos: [s * 1.8, 0.56, 0], color: 0x2b2d33 }));
  hubs(b, W);
  for (const k of W) b.box(1.0, 0.15, 0.3, { pos: [k.x, 0.98, Math.sign(k.z) * 0.74], color: 0xffffff, paint: P });
  // long hatch cabin: glass all round, the roof stops short of the tail glass
  b.frustum(2.35, 1.6, 1.95, 1.24, 0.5, { pos: [-0.45, 1.24, 0], color: GLASS, vgrad: [1.0, 1.5, 0.8, 1.15] });
  b.box(1.75, 0.07, 1.18, { pos: [-0.3, 1.5, 0], color: 0xffffff, paint: P });
  sym((s) => b.box(1.7, 0.012, 0.12, { pos: [-0.3, 1.54, s * 0.5], color: STRIPE }));
  numberPlate(b, 7, -0.3, 1.535, 0, 0.95);                                              // roof roundel
  sym((s) => b.box(2.6, 0.06, 0.05, { pos: [-0.1, 0.5, s * 0.9], color: 0xffffff }));
  return {
    wheels: W,
    body: b.build(),
    parts: {
      hood: g().box(1.05, 0.12, 1.58, { pos: [1.27, 0.98, 0], color: 0xffffff, paint: P })
        .box(0.3, 0.05, 0.42, { pos: [1.15, 1.05, 0], color: DARK }).build(),
      bumperF: g().box(0.38, 0.4, 1.86, { pos: [1.93, 0.58, 0], color: RUBBER, vgrad: [0.4, 0.8, 0.8, 1.1] })
        .box(0.06, 0.16, 0.8, { pos: [2.13, 0.64, 0], color: 0x15171c }).build(),
      bumperR: g().box(0.38, 0.4, 1.86, { pos: [-1.93, 0.58, 0], color: RUBBER, vgrad: [0.4, 0.8, 0.8, 1.1] })
        .cyl(0.08, 0.08, 0.3, 7, { pos: [-2.15, 0.45, 0.5], rot: [0, 0, Math.PI / 2], color: CHROME }).build(),
      doorL: door(1, 0.15, 1.45, 0.66, 0.38, 0.93),
      doorR: door(-1, 0.15, 1.45, 0.66, 0.38, 0.93),
      spoiler: g().box(0.35, 0.07, 1.3, { pos: [-1.6, 1.52, 0], rot: [0, 0, 0.12], color: 0xffffff, paint: P }).build(),
      mirrorL: mirror(1, 0.62, 1.05, 0.98, 1.2),
      mirrorR: mirror(-1, 0.62, 1.05, 0.98, 1.2),
    },
    lights: lamps([[1.76, 0.88, 0.58]], [[-1.77, 0.9, 0.62]]),
  };
}

// ------------------------------------------------------------------------------------------------ 2 gravel: rally hatch
// hatch with a 4-lamp light pod on the bonnet, roof scoop, wide rally wing over the tail, flared arches, mud flaps, door roundels
function gravel(): ModelGeo {
  const W = wheels4(1.22, -1.24, 0.84, 0.84, 0.45, 0.45, 0.44, 0.44);
  const b = g();
  b.box(3.4, 0.16, 1.45, { pos: [0, 0.38, 0], color: DARK });
  b.box(3.3, 0.5, 1.68, { pos: [0, 0.64, 0], color: 0xffffff, paint: P, vgrad: [0.3, 0.9, 0.78, 1], seg: [10, 2, 5], noBottom: true });
  b.box(3.1, 0.12, 1.52, { pos: [0, 0.94, 0], color: 0xffffff, paint: P, seg: [9, 1, 5], noBottom: true });
  engineBay(b, 0.75, 1.65, 0.96, 1.25);
  sym((s) => b.box(0.16, 0.2, 1.42, { pos: [s * 1.7, 0.58, 0], color: 0x2b2d33 }));
  hubs(b, W);
  // flared arches (wider than the body) and mud flaps behind every wheel
  for (const k of W) {
    b.box(1.05, 0.2, 0.36, { pos: [k.x, 0.96, Math.sign(k.z) * 0.86], color: 0xffffff, paint: P });
    b.box(0.06, 0.32, 0.4, { pos: [k.x - 0.6, 0.42, Math.sign(k.z) * 0.86], color: DARK });
  }
  b.frustum(2.05, 1.5, 1.7, 1.18, 0.5, { pos: [-0.4, 1.24, 0], color: GLASS, vgrad: [1.0, 1.5, 0.8, 1.15] });
  b.box(1.55, 0.07, 1.12, { pos: [-0.3, 1.5, 0], color: 0xffffff });                   // white roof (livery)
  b.box(0.5, 0.14, 0.5, { pos: [0.2, 1.58, 0], color: DARK });                          // roof scoop
  b.box(0.5, 0.06, 0.16, { pos: [0.2, 1.66, 0], color: 0xffffff, paint: P });
  numberPlate(b, 22, -0.62, 1.535, 0, 0.9, { bg: DARK, fg: 0xffffff, rim: AMBER });     // dark roundel on the white roof
  return {
    wheels: W,
    body: b.build(),
    parts: {
      hood: g().box(1.0, 0.12, 1.52, { pos: [1.2, 0.99, 0], color: 0xffffff, paint: P })
        .box(0.95, 0.012, 0.32, { pos: [1.2, 1.06, 0], color: 0xffffff })
        .box(0.3, 0.12, 1.2, { pos: [1.55, 1.11, 0], color: DARK }).build(),           // light pod frame (lamps are in `lights`)
      bumperF: g().box(0.36, 0.38, 1.72, { pos: [1.83, 0.6, 0], color: 0xffffff, paint: P, vgrad: [0.4, 0.8, 0.8, 1] })
        .box(0.5, 0.06, 1.66, { pos: [1.86, 0.4, 0], color: DARK }).build(),
      bumperR: g().box(0.36, 0.38, 1.72, { pos: [-1.83, 0.6, 0], color: 0xffffff, paint: P, vgrad: [0.4, 0.8, 0.8, 1] })
        .cyl(0.09, 0.09, 0.35, 7, { pos: [-2.03, 0.45, -0.5], rot: [0, 0, Math.PI / 2], color: CHROME }).build(),
      doorL: door(1, 0.1, 1.35, 0.67, 0.38, 0.87, (d) => d.cyl(0.24, 0.24, 0.02, 10, { pos: [0.0, 0.68, 0.98], rot: [Math.PI / 2, 0, 0], color: 0xffffff })),
      doorR: door(-1, 0.1, 1.35, 0.67, 0.38, 0.87, (d) => d.cyl(0.24, 0.24, 0.02, 10, { pos: [0.0, 0.68, -0.98], rot: [Math.PI / 2, 0, 0], color: 0xffffff })),
      // wide rally wing overhanging the tail on two pylons
      spoiler: g().box(0.62, 0.08, 2.1, { pos: [-1.82, 1.58, 0], rot: [0, 0, 0.08], color: 0xffffff, paint: P })
        .box(0.66, 0.3, 0.06, { pos: [-1.82, 1.5, 1.05], color: DARK }).box(0.66, 0.3, 0.06, { pos: [-1.82, 1.5, -1.05], color: DARK })
        .box(0.12, 0.42, 0.1, { pos: [-1.7, 1.3, 0.5], color: DARK }).box(0.12, 0.42, 0.1, { pos: [-1.7, 1.3, -0.5], color: DARK }).build(),
      mirrorL: mirror(1, 0.55, 1.05, 0.92),
      mirrorR: mirror(-1, 0.55, 1.05, 0.92),
    },
    lights: lamps([[1.68, 0.88, 0.56]], [[-1.67, 0.9, 0.58]], (l) => {
      for (const z of [-0.45, -0.15, 0.15, 0.45]) l.cyl(0.13, 0.13, 0.08, 8, { pos: [1.62, 1.18, z], rot: [0, 0, Math.PI / 2], color: LAMP });
    }),
  };
}

// ------------------------------------------------------------------------------------------------ 3 sandhopper: dune buggy
// minimal tub in a dark roll cage (an X from above), seat visible, narrow nose, huge rear wheels outside the body
function sandhopper(): ModelGeo {
  const W = wheels4(1.18, -1.15, 0.78, 0.86, 0.42, 0.56, 0.32, 0.54);
  const b = g();
  b.box(3.0, 0.14, 1.0, { pos: [-0.1, 0.44, 0], color: DARK });
  // tub: narrow at the nose, wider at the seats
  b.box(1.6, 0.36, 1.2, { pos: [-0.35, 0.68, 0], color: 0xffffff, paint: P, vgrad: [0.5, 0.86, 0.8, 1], seg: [5, 1, 4], noBottom: true });
  b.frustum(0.36, 1.0, 0.3, 0.7, 1.0, { pos: [0.95, 0.62, 0], rot: [0, 0, -Math.PI / 2], color: 0xffffff, paint: P });
  b.box(0.6, 0.12, 0.8, { pos: [-0.4, 0.92, 0], color: 0x3a2e28 });            // seats
  b.box(0.18, 0.4, 0.8, { pos: [-0.7, 1.05, 0], color: 0x3a2e28 });
  engineBay(b, -1.6, -0.95, 0.75, 0.9);                                         // rear engine
  b.box(0.5, 0.2, 0.5, { pos: [-1.3, 0.92, 0], color: 0x8d939e });
  numberPlate(b, 3, -1.3, 1.02, 0, 0.55, { bg: 0xffd23a });                           // plate on the engine cover
  // roll cage: hoops + an X over the top (thin dark tubes)
  const T = 0x23262c;
  sym((s) => {
    b.box(0.08, 0.75, 0.08, { pos: [0.25, 1.15, s * 0.58], rot: [0, 0, -0.3], color: T });
    b.box(0.08, 0.8, 0.08, { pos: [-0.95, 1.18, s * 0.58], color: T });
    b.box(1.3, 0.08, 0.08, { pos: [-0.38, 1.56, s * 0.58], color: T });
  });
  b.box(0.08, 0.08, 1.24, { pos: [0.03, 1.5, 0], color: T });
  b.box(0.08, 0.08, 1.24, { pos: [-0.95, 1.58, 0], color: T });
  b.box(1.58, 0.07, 0.07, { pos: [-0.46, 1.6, 0], rot: [0, 0.69, 0], color: T });
  b.box(1.58, 0.07, 0.07, { pos: [-0.46, 1.6, 0], rot: [0, -0.69, 0], color: T });
  // axles to the wheels that stick far out
  sym((s) => {
    b.box(0.1, 0.1, 0.5, { pos: [W[0].x, 0.45, s * 0.6], color: T });
    b.box(0.12, 0.12, 0.5, { pos: [W[2].x, 0.56, s * 0.66], color: T });
  });
  hubs(b, W);
  return {
    wheels: W,
    body: b.build(),
    parts: {
      hood: g().box(0.6, 0.22, 0.6, { pos: [0.95, 0.9, 0], color: 0xffffff, paint: P })           // fuel tank on the nose
        .cyl(0.08, 0.08, 0.06, 7, { pos: [0.95, 1.03, 0], color: CHROME }).build(),
      bumperF: g().box(0.1, 0.32, 1.1, { pos: [1.6, 0.56, 0], color: T })                         // nerf bar
        .box(0.3, 0.08, 0.08, { pos: [1.5, 0.5, 0.5], color: T }).box(0.3, 0.08, 0.08, { pos: [1.5, 0.5, -0.5], color: T }).build(),
      bumperR: g().cyl(0.4, 0.4, 0.26, 10, { pos: [-1.72, 0.85, 0], rot: [0, 0, Math.PI / 2], color: RUBBER })   // spare tyre
        .cyl(0.2, 0.2, 0.28, 8, { pos: [-1.72, 0.85, 0], rot: [0, 0, Math.PI / 2], color: CHROME }).build(),
      doorL: g().box(1.0, 0.36, 0.05, { pos: [-0.35, 0.95, 0.6], color: 0x111317 })              // side nets
        .box(1.0, 0.04, 0.06, { pos: [-0.35, 1.13, 0.6], color: 0xffffff, paint: P }).build(),
      doorR: g().box(1.0, 0.36, 0.05, { pos: [-0.35, 0.95, -0.6], color: 0x111317 })
        .box(1.0, 0.04, 0.06, { pos: [-0.35, 1.13, -0.6], color: 0xffffff, paint: P }).build(),
      // whip pole with a pennant
      spoiler: g().box(0.04, 1.4, 0.04, { pos: [-1.05, 1.9, -0.5], color: T })
        .box(0.42, 0.24, 0.03, { pos: [-1.27, 2.45, -0.5], color: 0xffffff, paint: P }).build(),
      mirrorL: mirror(1, 0.15, 1.2, 0.68, 0.9, 0.1),
      mirrorR: mirror(-1, 0.15, 1.2, 0.68, 0.9, 0.1),
    },
    lights: lamps([[1.42, 0.82, 0.3]], [[-1.95, 0.85, 0.42]], (l) => {
      sym((s) => l.cyl(0.11, 0.11, 0.08, 8, { pos: [0.3, 1.62, s * 0.3], rot: [0, 0, Math.PI / 2], color: LAMP }));   // cage lamps
    }),
  };
}

// ------------------------------------------------------------------------------------------------ 4 brawler: muscle car
// very long bonnet with a raised scoop, small cabin set back, short ducktail, fat rear tyres, twin stripes nose to tail
function brawler(): ModelGeo {
  const W = wheels4(1.5, -1.42, 0.84, 0.86, 0.47, 0.52, 0.42, 0.56);
  const b = g();
  b.box(4.0, 0.16, 1.55, { pos: [0, 0.36, 0], color: DARK });
  b.box(3.9, 0.48, 1.8, { pos: [0, 0.6, 0], color: 0xffffff, paint: P, vgrad: [0.3, 0.88, 0.78, 1], seg: [12, 2, 5], noBottom: true });
  b.box(3.7, 0.12, 1.66, { pos: [0, 0.9, 0], color: 0xffffff, paint: P, seg: [12, 1, 5], noBottom: true });
  engineBay(b, 0.35, 2.05, 0.93, 1.4);
  sym((s) => b.box(0.16, 0.2, 1.55, { pos: [s * 2.0, 0.55, 0], color: 0x2b2d33 }));
  hubs(b, W);
  for (const k of W) b.box(1.1, 0.16, 0.34, { pos: [k.x, 0.95, Math.sign(k.z) * 0.76], color: 0xffffff, paint: P });
  // small cabin set back
  b.frustum(1.55, 1.56, 0.95, 1.2, 0.44, { pos: [-0.75, 1.17, 0], color: GLASS, vgrad: [1.0, 1.4, 0.8, 1.15] });
  b.box(0.85, 0.07, 1.16, { pos: [-0.8, 1.41, 0], color: 0xffffff, paint: P });
  sym((s) => {
    b.box(0.75, 0.012, 0.18, { pos: [-1.55, 0.97, s * 0.2], color: STRIPE });
  });
  b.box(0.9, 0.1, 1.58, { pos: [-1.55, 0.92, 0], color: 0xffffff, paint: P, seg: [3, 1, 4], noBottom: true });
  numberPlate(b, 99, -0.8, 1.445, 0, 0.62);                                              // roof roundel (the twin stripes run bonnet and tail)
  return {
    wheels: W,
    body: b.build(),
    parts: {
      hood: g().box(1.8, 0.12, 1.66, { pos: [1.2, 0.96, 0], color: 0xffffff, paint: P })
        .box(1.75, 0.012, 0.18, { pos: [1.2, 1.03, 0.2], color: STRIPE }).box(1.75, 0.012, 0.18, { pos: [1.2, 1.03, -0.2], color: STRIPE })
        .box(0.8, 0.2, 0.6, { pos: [1.05, 1.1, 0], color: 0xffffff, paint: P }).box(0.1, 0.12, 0.5, { pos: [1.48, 1.12, 0], color: DARK }).build(),
      bumperF: g().box(0.32, 0.34, 1.82, { pos: [2.12, 0.58, 0], color: CHROME })
        .box(0.06, 0.2, 1.2, { pos: [2.3, 0.62, 0], color: 0x15171c }).build(),
      bumperR: g().box(0.32, 0.34, 1.82, { pos: [-2.12, 0.58, 0], color: CHROME })
        .cyl(0.1, 0.1, 0.36, 7, { pos: [-2.32, 0.44, 0.55], rot: [0, 0, Math.PI / 2], color: CHROME })
        .cyl(0.1, 0.1, 0.36, 7, { pos: [-2.32, 0.44, -0.55], rot: [0, 0, Math.PI / 2], color: CHROME }).build(),
      doorL: door(1, -0.4, 1.4, 0.64, 0.36, 0.96),
      doorR: door(-1, -0.4, 1.4, 0.64, 0.36, 0.96),
      spoiler: g().box(0.3, 0.12, 1.66, { pos: [-1.95, 1.02, 0], rot: [0, 0, 0.3], color: 0xffffff, paint: P }).build(),   // ducktail lip
      mirrorL: mirror(1, -0.2, 1.0, 1.02),
      mirrorR: mirror(-1, -0.2, 1.0, 1.02),
    },
    lights: lamps([[1.98, 0.84, 0.66]], [[-1.97, 0.86, 0.6]], (l) => sym((s) => l.cyl(0.11, 0.11, 0.08, 8, { pos: [2.0, 0.84, s * 0.38], rot: [0, 0, Math.PI / 2], color: LAMP }))),
  };
}

/** glint's bonnet: white panel, dark vent and the number roundel (the number leaves with the panel) */
function glintHood(): THREE.BufferGeometry {
  const b = g().box(1.2, 0.06, 1.05, { pos: [0.95, 0.76, 0], color: 0xffffff, paint: P })
    .box(0.4, 0.04, 0.5, { pos: [0.75, 0.8, 0], color: DARK });
  numberPlate(b, 5, 1.3, 0.79, 0, 0.6);
  return b.build();
}

// ------------------------------------------------------------------------------------------------ 5 glint: sports coupe
// low arrowhead wedge: tapered nose, teardrop canopy far back, flat wide wing on struts, side intakes, pop-up lamps
function glint(): ModelGeo {
  const W = wheels4(1.42, -1.38, 0.8, 0.82, 0.42, 0.46, 0.38, 0.46);
  const b = g();
  b.box(3.6, 0.14, 1.4, { pos: [-0.1, 0.32, 0], color: DARK });
  // rear block + tapered nose (frustum lying along x: its top end is the nose)
  b.box(2.2, 0.42, 1.84, { pos: [-0.8, 0.55, 0], color: 0xffffff, paint: P, vgrad: [0.3, 0.8, 0.78, 1], seg: [7, 2, 5], noBottom: true });
  b.frustum(0.42, 1.84, 0.26, 0.9, 1.9, { pos: [1.25, 0.5, 0], rot: [0, 0, -Math.PI / 2], color: 0xffffff, paint: P, vgrad: [0.3, 0.75, 0.8, 1] });
  engineBay(b, -2.0, -1.0, 0.8, 1.3);                                            // mid / rear engine
  sym((s) => b.box(0.16, 0.18, 1.4, { pos: [s * 1.95, 0.48, 0], color: 0x2b2d33 }));
  hubs(b, W);
  for (const k of W) b.box(0.95, 0.12, 0.3, { pos: [k.x, 0.82, Math.sign(k.z) * 0.78], color: 0xffffff, paint: P });
  // teardrop canopy far back
  b.frustum(1.7, 1.3, 0.9, 0.9, 0.36, { pos: [-0.45, 0.95, 0], color: GLASS, vgrad: [0.8, 1.15, 0.8, 1.2] });
  b.box(0.5, 0.05, 0.7, { pos: [-0.55, 1.14, 0], color: 0xffffff, paint: P });
  return {
    wheels: W,
    body: b.build(),
    parts: {
      hood: glintHood(),
      bumperF: g().frustum(0.2, 1.0, 0.16, 0.6, 0.35, { pos: [2.05, 0.42, 0], rot: [0, 0, -Math.PI / 2], color: DARK }).build(),   // splitter
      bumperR: g().box(0.3, 0.32, 1.84, { pos: [-2.04, 0.52, 0], color: 0xffffff, paint: P })
        .box(0.08, 0.14, 1.2, { pos: [-2.2, 0.48, 0], color: 0x15171c }).build(),
      doorL: door(1, -0.35, 1.3, 0.56, 0.3, 0.93, (d) => d.box(0.5, 0.18, 0.04, { pos: [-0.75, 0.58, 1.03], color: DARK })),   // intake
      doorR: door(-1, -0.35, 1.3, 0.56, 0.3, 0.93, (d) => d.box(0.5, 0.18, 0.04, { pos: [-0.75, 0.58, -1.03], color: DARK })),
      spoiler: g().box(0.5, 0.06, 2.0, { pos: [-1.95, 1.16, 0], color: 0xffffff, paint: P })
        .box(0.1, 0.4, 0.08, { pos: [-1.9, 0.94, 0.55], color: DARK }).box(0.1, 0.4, 0.08, { pos: [-1.9, 0.94, -0.55], color: DARK }).build(),
      mirrorL: mirror(1, 0.3, 0.9, 0.84, 0.85),
      mirrorR: mirror(-1, 0.3, 0.9, 0.84, 0.85),
    },
    lights: lamps([], [[-2.0, 0.7, 0.62]], (l) => sym((s) => l.box(0.36, 0.06, 0.3, { pos: [1.35, 0.75, s * 0.55], color: LAMP }))),   // pop-up lamps
  };
}

// ------------------------------------------------------------------------------------------------ 6 scorcher: hot rod
// narrow nose with an exposed chrome engine and exhaust stacks, tiny cabin at the rear, giant rear wheels, thin front wheels
function scorcher(): ModelGeo {
  const W = wheels4(1.5, -1.3, 0.8, 0.86, 0.38, 0.6, 0.24, 0.52);
  const b = g();
  b.box(3.8, 0.14, 0.8, { pos: [0, 0.4, 0], color: DARK });                                 // frame rails
  b.box(1.9, 0.5, 1.4, { pos: [-1.0, 0.7, 0], color: 0xffffff, paint: P, vgrad: [0.4, 0.95, 0.8, 1], seg: [6, 2, 4], noBottom: true });
  b.box(1.9, 0.3, 0.9, { pos: [0.9, 0.62, 0], color: 0xffffff, paint: P, seg: [6, 1, 3], noBottom: true });   // narrow nose
  b.box(1.1, 0.08, 0.8, { pos: [0.85, 0.82, 0], color: 0x24262c });
  // front axle + visible suspension
  b.box(0.12, 0.1, 1.5, { pos: [W[0].x, 0.38, 0], color: CHROME });
  sym((s) => b.box(0.9, 0.06, 0.06, { pos: [1.05, 0.42, s * 0.42], color: CHROME }));
  hubs(b, W);
  sym((s) => b.box(1.25, 0.16, 0.3, { pos: [W[2].x, 1.08, s * 0.82], color: 0xffffff, paint: P }));   // rear fenders over the big tyres
  // tiny chopped cabin
  b.frustum(1.05, 1.3, 0.75, 1.05, 0.4, { pos: [-1.25, 1.15, 0], color: GLASS, vgrad: [0.95, 1.35, 0.8, 1.15] });
  b.box(0.68, 0.07, 1.0, { pos: [-1.3, 1.37, 0], color: 0xffffff, paint: P });
  numberPlate(b, 13, -1.3, 1.405, 0, 0.55, { bg: 0xffd23a });
  return {
    wheels: W,
    body: b.build(),
    parts: {
      // exposed engine: chrome block, blower and two rows of exhaust stacks
      hood: g().box(1.05, 0.34, 0.66, { pos: [0.75, 1.0, 0], color: CHROME })
        .box(0.5, 0.22, 0.4, { pos: [0.85, 1.27, 0], color: 0x9aa1ad }).box(0.26, 0.08, 0.36, { pos: [0.85, 1.42, 0], color: DARK })
        .cyl(0.06, 0.07, 0.38, 6, { pos: [0.55, 1.12, 0.42], color: CHROME }).cyl(0.06, 0.07, 0.38, 6, { pos: [0.85, 1.12, 0.42], color: CHROME })
        .cyl(0.06, 0.07, 0.38, 6, { pos: [0.55, 1.12, -0.42], color: CHROME }).cyl(0.06, 0.07, 0.38, 6, { pos: [0.85, 1.12, -0.42], color: CHROME }).build(),
      bumperF: g().box(0.3, 0.42, 0.8, { pos: [2.0, 0.66, 0], color: CHROME })                     // grille shell
        .box(0.04, 0.3, 0.6, { pos: [2.16, 0.66, 0], color: 0x15171c }).build(),
      bumperR: g().box(0.2, 0.16, 1.5, { pos: [-2.05, 0.55, 0], color: CHROME }).build(),
      doorL: door(1, -0.9, 1.1, 0.72, 0.4, 0.72, (d) => d.box(0.9, 0.2, 0.02, { pos: [-0.8, 0.72, 0.82], color: 0xffa21a })
        .box(0.5, 0.12, 0.02, { pos: [-0.5, 0.72, 0.83], color: 0xffe14a })),                    // flame decal
      doorR: door(-1, -0.9, 1.1, 0.72, 0.4, 0.72, (d) => d.box(0.9, 0.2, 0.02, { pos: [-0.8, 0.72, -0.82], color: 0xffa21a })
        .box(0.5, 0.12, 0.02, { pos: [-0.5, 0.72, -0.83], color: 0xffe14a })),
      spoiler: g().box(0.2, 0.08, 1.1, { pos: [-1.95, 1.02, 0], rot: [0, 0, 0.35], color: 0xffffff, paint: P }).build(),
      mirrorL: mirror(1, -0.75, 1.12, 0.74, 0.9),
      mirrorR: mirror(-1, -0.75, 1.12, 0.74, 0.9),
    },
    lights: lamps([], [[-2.0, 0.78, 0.55]], (l) => sym((s) => l.cyl(0.15, 0.15, 0.12, 9, { pos: [1.9, 0.92, s * 0.55], rot: [0, 0, Math.PI / 2], color: LAMP }))),
  };
}

// ------------------------------------------------------------------------------------------------ 7 needle: open-wheel racer
// cigar body narrower than the wheel track, 4 exposed wheels, front and tall rear wings, sidepods, open cockpit with a helmet
function needle(): ModelGeo {
  const W = wheels4(1.62, -1.5, 0.78, 0.78, 0.42, 0.46, 0.36, 0.44);
  const b = g();
  b.box(3.8, 0.12, 0.6, { pos: [0, 0.3, 0], color: DARK });
  b.box(2.2, 0.36, 0.7, { pos: [-0.5, 0.55, 0], color: 0xffffff, paint: P, vgrad: [0.35, 0.75, 0.8, 1], seg: [7, 1, 3], noBottom: true });
  b.frustum(0.3, 0.7, 0.16, 0.36, 1.75, { pos: [1.4, 0.5, 0], rot: [0, 0, -Math.PI / 2], color: 0xffffff, paint: P });   // pointed nose
  b.box(0.9, 0.06, 0.5, { pos: [-0.2, 0.74, 0], color: 0x111317 });                          // cockpit opening
  b.ico(0.2, 1, { pos: [-0.15, 0.92, 0], color: 0xffd23a });                                   // helmet
  b.box(0.7, 0.4, 0.5, { pos: [-0.95, 0.85, 0], color: 0xffffff, paint: P });                 // airbox
  numberPlate(b, 1, -0.95, 1.05, 0, 0.5, { bg: 0xffd23a });
  engineBay(b, -1.9, -1.3, 0.72, 0.5);
  // push rods to the exposed wheels
  for (const k of W) b.box(0.08, 0.06, Math.abs(k.z) - 0.25, { pos: [k.x, 0.5, Math.sign(k.z) * (Math.abs(k.z) / 2 + 0.12)], color: DARK });
  hubs(b, W);
  return {
    wheels: W,
    body: b.build(),
    parts: {
      hood: g().box(0.9, 0.08, 0.5, { pos: [0.75, 0.66, 0], color: 0xffffff, paint: P })
        .box(0.85, 0.012, 0.12, { pos: [0.75, 0.71, 0], color: STRIPE }).build(),
      bumperF: g().box(0.4, 0.05, 1.86, { pos: [2.1, 0.3, 0], color: 0xffffff, paint: P })     // front wing
        .box(0.4, 0.2, 0.05, { pos: [2.1, 0.36, 0.93], color: DARK }).box(0.4, 0.2, 0.05, { pos: [2.1, 0.36, -0.93], color: DARK }).build(),
      bumperR: g().box(0.2, 0.16, 0.7, { pos: [-1.95, 0.45, 0], color: DARK })                   // diffuser
        .cyl(0.07, 0.07, 0.2, 7, { pos: [-2.08, 0.6, 0], rot: [0, 0, Math.PI / 2], color: CHROME }).build(),
      doorL: g().box(1.2, 0.3, 0.32, { pos: [-0.45, 0.5, 0.48], color: 0xffffff, paint: P, vgrad: [0.35, 0.65, 0.85, 1] })   // sidepods
        .box(0.06, 0.18, 0.24, { pos: [0.16, 0.52, 0.48], color: DARK }).build(),
      doorR: g().box(1.2, 0.3, 0.32, { pos: [-0.45, 0.5, -0.48], color: 0xffffff, paint: P, vgrad: [0.35, 0.65, 0.85, 1] })
        .box(0.06, 0.18, 0.24, { pos: [0.16, 0.52, -0.48], color: DARK }).build(),
      // tall rear wing
      spoiler: g().box(0.5, 0.06, 1.6, { pos: [-2.0, 1.25, 0], color: 0xffffff, paint: P })
        .box(0.5, 0.42, 0.05, { pos: [-2.0, 1.08, 0.8], color: DARK }).box(0.5, 0.42, 0.05, { pos: [-2.0, 1.08, -0.8], color: DARK })
        .box(0.1, 0.6, 0.08, { pos: [-1.85, 0.85, 0], color: DARK }).build(),
      mirrorL: mirror(1, 0.2, 0.82, 0.55, 0.7, 0.12),
      mirrorR: mirror(-1, 0.2, 0.82, 0.55, 0.7, 0.12),
    },
    lights: lamps([], [[-2.02, 0.62, 0.0]], undefined),
  };
}

// ------------------------------------------------------------------------------------------------ 8 bruiser: pickup
// cab in the front half, open bed behind with two barrels, big chrome bull bar wider than the body, light bar, tall tyres
function bruiser(): ModelGeo {
  const W = wheels4(1.5, -1.45, 0.88, 0.88, 0.52, 0.52, 0.46, 0.46);
  const b = g();
  b.box(4.2, 0.18, 1.6, { pos: [0, 0.46, 0], color: DARK });
  b.box(4.1, 0.55, 1.9, { pos: [0, 0.78, 0], color: 0xffffff, paint: P, vgrad: [0.45, 1.05, 0.78, 1], seg: [12, 2, 5], noBottom: true });
  engineBay(b, 0.95, 2.0, 1.08, 1.5);
  sym((s) => b.box(0.16, 0.22, 1.6, { pos: [s * 2.1, 0.66, 0], color: 0x2b2d33 }));
  hubs(b, W);
  for (const k of W) b.box(1.2, 0.18, 0.3, { pos: [k.x, 1.12, Math.sign(k.z) * 0.86], color: 0x30333a });   // black arch flares
  // cab
  b.frustum(1.45, 1.75, 1.15, 1.45, 0.55, { pos: [0.3, 1.33, 0], color: GLASS, vgrad: [1.05, 1.6, 0.8, 1.15] });
  b.box(1.05, 0.08, 1.42, { pos: [0.25, 1.62, 0], color: 0xffffff, paint: P });
  b.box(0.12, 0.6, 1.8, { pos: [-0.5, 1.33, 0], color: 0xffffff, paint: P });                    // cab back wall
  numberPlate(b, 8, 0.25, 1.66, 0, 1.0);                                                         // roof roundel
  // bed: dark floor inset, rails, two barrels
  b.box(1.75, 0.06, 1.55, { pos: [-1.4, 1.07, 0], color: 0x2a2c33 });
  sym((s) => b.box(1.8, 0.24, 0.12, { pos: [-1.4, 1.17, s * 0.88], color: 0xffffff, paint: P }));
  b.cyl(0.28, 0.28, 0.55, 9, { pos: [-1.1, 1.35, 0.38], color: 0x2f6fd0 });
  b.cyl(0.28, 0.28, 0.55, 9, { pos: [-1.6, 1.35, -0.32], color: 0xd04a2f });
  b.box(0.12, 0.42, 1.8, { pos: [-2.25, 1.0, 0], color: 0xffffff, paint: P });                 // tailgate
  return {
    wheels: W,
    body: b.build(),
    parts: {
      hood: g().box(1.2, 0.12, 1.75, { pos: [1.45, 1.12, 0], color: 0xffffff, paint: P })
        .box(0.4, 0.06, 0.9, { pos: [1.35, 1.2, 0], color: DARK }).build(),
      // bull bar: big chrome frame wider than the body
      bumperF: g().box(0.2, 0.2, 2.2, { pos: [2.3, 0.75, 0], color: CHROME })
        .box(0.2, 0.16, 1.6, { pos: [2.3, 1.12, 0], color: CHROME })
        .box(0.16, 0.5, 0.14, { pos: [2.3, 0.94, 0.55], color: CHROME }).box(0.16, 0.5, 0.14, { pos: [2.3, 0.94, -0.55], color: CHROME })
        .box(0.12, 0.42, 1.0, { pos: [2.12, 0.86, 0], color: 0x15171c }).build(),
      bumperR: g().box(0.3, 0.26, 1.9, { pos: [-2.34, 0.62, 0], color: CHROME })
        .box(0.3, 0.12, 0.4, { pos: [-2.42, 0.5, 0], color: DARK }).build(),
      doorL: door(1, 0.3, 1.3, 0.85, 0.42, 1.0),
      doorR: door(-1, 0.3, 1.3, 0.85, 0.42, 1.0),
      // roll bar with four lamps behind the cab
      spoiler: g().box(0.12, 0.1, 1.8, { pos: [-0.62, 1.9, 0], color: DARK })
        .box(0.1, 0.62, 0.1, { pos: [-0.62, 1.6, 0.85], color: DARK }).box(0.1, 0.62, 0.1, { pos: [-0.62, 1.6, -0.85], color: DARK }).build(),
      mirrorL: mirror(1, 0.85, 1.32, 1.06, 1.3),
      mirrorR: mirror(-1, 0.85, 1.32, 1.06, 1.3),
    },
    lights: lamps([[2.06, 1.0, 0.68]], [[-2.32, 1.02, 0.78]], (l) => {
      for (const z of [-0.6, -0.2, 0.2, 0.6]) l.cyl(0.12, 0.12, 0.1, 8, { pos: [-0.55, 2.0, z], rot: [0, 0, Math.PI / 2], color: AMBER });
    }),
  };
}

// ------------------------------------------------------------------------------------------------ 9 brick: van
// long tall box with a short sloped snout, roof rack with two crates, sliding side panels, step bumper, tall mirrors
function brick(): ModelGeo {
  const W = wheels4(1.62, -1.55, 0.92, 0.92, 0.48, 0.48, 0.42, 0.42);
  const b = g();
  b.box(4.4, 0.18, 1.7, { pos: [0, 0.4, 0], color: DARK });
  // the box
  b.box(3.5, 1.35, 2.16, { pos: [-0.55, 1.22, 0], color: 0xffffff, paint: P, vgrad: [0.55, 1.9, 0.8, 1], seg: [10, 3, 6], noBottom: true });
  b.box(1.1, 0.6, 2.1, { pos: [1.65, 0.82, 0], color: 0xffffff, paint: P, vgrad: [0.5, 1.1, 0.8, 1], seg: [3, 2, 6], noBottom: true });
  engineBay(b, 1.25, 2.15, 1.13, 1.7);
  // windscreen slanting up to the roof
  b.box(0.55, 0.62, 1.9, { pos: [1.02, 1.5, 0], rot: [0, 0, 0.5], color: GLASS });
  b.box(0.05, 0.4, 1.6, { pos: [-2.32, 1.45, 0], color: GLASS });                                // rear windows
  hubs(b, W);
  // roof rack (dark grid) on the flat roof
  b.box(2.8, 0.05, 1.8, { pos: [-0.7, 1.93, 0], color: 0x3a3d45 });
  for (const x of [-1.9, -1.2, -0.5, 0.2, 0.55]) b.box(0.06, 0.08, 1.8, { pos: [x, 1.98, 0], color: DARK });
  sym((s) => b.box(2.8, 0.1, 0.06, { pos: [-0.7, 2.0, s * 0.9], color: DARK }));
  numberPlate(b, 2, 0.36, 2.03, 0, 0.7, { bg: 0xffd23a });
  return {
    wheels: W,
    body: b.build(),
    parts: {
      hood: g().box(0.95, 0.1, 2.0, { pos: [1.7, 1.16, 0], rot: [0, 0, -0.18], color: 0xffffff, paint: P })
        .box(0.3, 0.04, 1.2, { pos: [1.85, 1.15, 0], rot: [0, 0, -0.18], color: DARK }).build(),
      bumperF: g().box(0.32, 0.36, 2.2, { pos: [2.3, 0.62, 0], color: RUBBER })
        .box(0.06, 0.22, 1.3, { pos: [2.24, 0.88, 0], color: 0x15171c }).build(),
      bumperR: g().box(0.45, 0.24, 2.0, { pos: [-2.42, 0.52, 0], color: STEEL })                  // step bumper
        .box(0.3, 0.06, 1.2, { pos: [-2.45, 0.66, 0], color: 0x8d939e }).build(),
      doorL: door(1, -0.6, 1.9, 1.25, 1.0, 1.1, (d) => d.box(1.7, 0.04, 0.03, { pos: [-0.6, 1.7, 1.2], color: DARK })),   // sliding panel + rail
      doorR: door(-1, -0.6, 1.9, 1.25, 1.0, 1.1, (d) => d.box(1.7, 0.04, 0.03, { pos: [-0.6, 1.7, -1.2], color: DARK })),
      // two crates on the rack
      spoiler: g().box(0.8, 0.5, 0.7, { pos: [-1.5, 2.28, 0.4], color: 0xb07a3c }).box(0.8, 0.06, 0.72, { pos: [-1.5, 2.54, 0.4], color: 0x8a5a28 })
        .box(0.7, 0.42, 0.62, { pos: [-0.55, 2.24, -0.42], color: 0xc58a46 }).box(0.72, 0.06, 0.64, { pos: [-0.55, 2.46, -0.42], color: 0x8a5a28 }).build(),
      mirrorL: mirror(1, 1.15, 1.48, 1.2, 1.5),
      mirrorR: mirror(-1, 1.15, 1.48, 1.2, 1.5),
    },
    lights: lamps([[2.18, 1.0, 0.72]], [[-2.32, 0.95, 0.86]]),
  };
}

// ------------------------------------------------------------------------------------------------ 10 mammoth: armoured monster truck
// huge wheels at the corners outside the body, high flat roof, riveted armour plates, wide angled plow blade, roof cage, stacks
function mammoth(): ModelGeo {
  const W = wheels4(1.62, -1.62, 1.02, 1.02, 0.74, 0.74, 0.6, 0.6);
  const b = g();
  // raised chassis between the huge wheels
  b.box(3.8, 0.3, 1.2, { pos: [0, 0.8, 0], color: DARK });
  sym((s) => b.box(0.18, 0.18, 2.0, { pos: [s * 1.62, 0.74, 0], color: STEEL }));                // axles
  b.box(4.0, 0.7, 1.9, { pos: [0, 1.35, 0], color: 0xffffff, paint: P, vgrad: [1.0, 1.7, 0.8, 1], seg: [12, 2, 5], noBottom: true });
  engineBay(b, 0.9, 1.95, 1.72, 1.6);
  hubs(b, W);
  // high cab with slit windows and a flat armoured roof
  b.frustum(1.9, 1.85, 1.75, 1.7, 0.55, { pos: [-0.35, 1.97, 0], color: 0x35383f });
  b.box(1.95, 0.12, 1.15, { pos: [-0.35, 2.06, 0], color: GLASS });                            // slit glass band
  b.box(1.7, 0.08, 1.66, { pos: [-0.35, 2.28, 0], color: 0xffffff, paint: P });
  numberPlate(b, 66, -0.7, 2.32, 0, 0.7);                                                        // roof roundel between the cage bars
  // twin exhaust stacks behind the cab
  sym((s) => b.cyl(0.11, 0.11, 1.1, 7, { pos: [-1.45, 2.2, s * 0.62], color: CHROME }));
  b.box(0.9, 0.12, 1.7, { pos: [-1.65, 1.76, 0], color: STEEL });                               // rear deck plate
  return {
    wheels: W,
    body: b.build(),
    parts: {
      hood: g().box(1.15, 0.14, 1.8, { pos: [1.42, 1.76, 0], color: 0xffffff, paint: P })
        .box(0.9, 0.06, 0.12, { pos: [1.4, 1.85, 0.5], color: STEEL }).box(0.9, 0.06, 0.12, { pos: [1.4, 1.85, -0.5], color: STEEL }).build(),
      // wide angled plow blade with hazard stripes
      bumperF: g().box(0.22, 0.75, 2.7, { pos: [2.35, 0.95, 0], rot: [0, 0, 0.32], color: STEEL })
        .box(0.06, 0.18, 2.6, { pos: [2.52, 1.12, 0], rot: [0, 0, 0.32], colorFn: (_nx, _ny, _nz, _x, _y, z) => (Math.floor((z + 4) * 2.2) % 2 ? 0xffc93c : 0x1c1f27) })
        .box(0.5, 0.12, 0.2, { pos: [2.05, 0.9, 0.6], color: DARK }).box(0.5, 0.12, 0.2, { pos: [2.05, 0.9, -0.6], color: DARK }).build(),
      bumperR: g().box(0.34, 0.4, 2.0, { pos: [-2.15, 1.05, 0], color: STEEL })
        .cyl(0.12, 0.12, 0.4, 7, { pos: [-2.38, 1.05, 0], rot: [0, 0, Math.PI / 2], color: DARK }).build(),
      // riveted armour plates
      doorL: door(1, -0.2, 2.6, 1.32, 0.62, 1.0, (d) => { for (const x of [-1.3, -0.7, -0.1, 0.5, 0.9]) d.box(0.08, 0.08, 0.04, { pos: [x, 1.55, 1.1], color: CHROME }); }),
      doorR: door(-1, -0.2, 2.6, 1.32, 0.62, 1.0, (d) => { for (const x of [-1.3, -0.7, -0.1, 0.5, 0.9]) d.box(0.08, 0.08, 0.04, { pos: [x, 1.55, -1.1], color: CHROME }); }),
      // roof cage
      spoiler: g().box(1.5, 0.08, 0.08, { pos: [-0.35, 2.55, 0.8], color: DARK }).box(1.5, 0.08, 0.08, { pos: [-0.35, 2.55, -0.8], color: DARK })
        .box(0.08, 0.08, 1.6, { pos: [0.35, 2.55, 0], color: DARK }).box(0.08, 0.08, 1.6, { pos: [-1.05, 2.55, 0], color: DARK })
        .box(0.08, 0.08, 1.6, { pos: [-0.35, 2.55, 0], color: DARK })
        .box(0.08, 0.3, 0.08, { pos: [0.35, 2.42, 0.8], color: DARK }).box(0.08, 0.3, 0.08, { pos: [0.35, 2.42, -0.8], color: DARK })
        .box(0.08, 0.3, 0.08, { pos: [-1.05, 2.42, 0.8], color: DARK }).box(0.08, 0.3, 0.08, { pos: [-1.05, 2.42, -0.8], color: DARK }).build(),
      mirrorL: mirror(1, 0.55, 2.0, 1.02, 1.4),
      mirrorR: mirror(-1, 0.55, 2.0, 1.02, 1.4),
    },
    lights: lamps([[1.98, 1.5, 0.66]], [[-2.02, 1.5, 0.7]], (l) => {
      for (const z of [-0.45, 0, 0.45]) l.box(0.14, 0.12, 0.26, { pos: [0.6, 2.36, z], color: AMBER });
    }),
  };
}

export const MODEL_BUILDERS: Record<string, () => ModelGeo> = {
  scrapper, gravel, sandhopper, brawler, glint, scorcher, needle, bruiser, brick, mammoth,
};
