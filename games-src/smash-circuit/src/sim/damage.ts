// PURE damage model: zones, impulse -> hp, hp -> effects.
import { CONFIG } from '../config';
import { ZONES } from '../types';
import type { CarPart, DamageEffects, ZoneHp, ZoneId } from '../types';

const D = CONFIG.damage;
const CAR = CONFIG.car;

export function createZoneHp(max: number = D.zoneMaxHp): ZoneHp {
  const hp = {} as ZoneHp;
  for (const z of ZONES) hp[z] = max;
  return hp;
}

const WHEEL_IDS: ZoneId[] = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];
const WHEEL_SX = [1, 1, -1, -1], WHEEL_SY = [1, -1, 1, -1];

/** Hitbox of a car (m). Absent = the reference car. */
export interface CarDims { length: number; width: number }

/**
 * Car frame: +x nose, +y left. Returns 1-2 zones: [primary body zone, secondary (wheel or engine)].
 * `dims`: the car's hitbox; the wheels scale with it (wheelbase ~62% of the length, track = width - 0.4 m).
 */
export function zoneForLocalPoint(lx: number, ly: number, dims?: CarDims): ZoneId[] {
  const L = dims?.length ?? CAR.length, W = dims?.width ?? CAR.width;
  const hl = L / 2, hw = W / 2;
  const alongX = Math.abs(lx) / hl >= Math.abs(ly) / hw;
  const body: ZoneId = alongX ? (lx >= 0 ? 'front' : 'rear') : (ly >= 0 ? 'left' : 'right');
  const wx = (CAR.wheelBase / 2) * (L / CAR.length), wy = W / 2 - 0.2;
  let best = 0, bd = Infinity;
  for (let k = 0; k < 4; k++) {
    const d = Math.hypot(lx - WHEEL_SX[k] * wx, ly - WHEEL_SY[k] * wy);
    if (d < bd) { bd = d; best = k; }
  }
  const bestId = WHEEL_IDS[best];
  const nearWheel = bd <= D.wheelRadius;
  if (body === 'front') return [body, nearWheel ? bestId : 'engine'];
  if (body === 'rear') return nearWheel ? [body, bestId] : [body];
  return nearWheel ? [body, bestId] : [body];
}

/**
 * Subtract hp for an impact. Below CONFIG.damage.impulseThreshold: no damage.
 * `damage` = total hp actually removed. `mul` scales (e.g. car-vs-car). Armor divides.
 */
export function applyImpulseDamage(
  hp: ZoneHp, lx: number, ly: number, impulse: number, armor: number, mul = 1, dims?: CarDims,
): { zones: ZoneId[]; damage: number } {
  const zones = zoneForLocalPoint(lx, ly, dims);
  if (!(impulse > D.impulseThreshold)) return { zones, damage: 0 };
  const total = ((impulse - D.impulseThreshold) * D.impulseToDamage * mul) / Math.max(0.1, armor);
  let removed = 0;
  for (let i = 0; i < zones.length; i++) {
    const share = zones.length === 1 ? 1 : i === 0 ? D.bodyShare : 1 - D.bodyShare;
    const z = zones[i];
    const before = hp[z];
    hp[z] = Math.max(0, before - total * share);
    removed += before - hp[z];
  }
  return { zones, damage: removed };
}

function loss(hp: ZoneHp, z: ZoneId, max: number): number {
  return 1 - Math.min(1, Math.max(0, hp[z] / max)); // 0 healthy .. 1 destroyed
}

export function totalHealth(hp: ZoneHp, max: number): number {
  let sum = 0;
  for (const z of ZONES) sum += hp[z];
  const mean = sum / (ZONES.length * max);
  const minBody = Math.min(hp.front, hp.rear, hp.left, hp.right, hp.engine) / max;
  return Math.min(1, Math.max(0, 0.5 * mean + 0.5 * minBody));
}

export function missingHp(hp: ZoneHp, max: number): number {
  let m = 0;
  for (const z of ZONES) m += Math.max(0, max - hp[z]);
  return m;
}

/**
 * Effects of the zone damage. `pullDir` (+1 right, -1 left, 0 none) is the side a car remembers its first real hit came from:
 * it decides which way a symmetric front / nose loss pulls (no built-in default to the right).
 */
export function computeEffects(hp: ZoneHp, max: number, pullDir = 0): DamageEffects {
  const lf = loss(hp, 'front', max), lr = loss(hp, 'rear', max);
  const ll = loss(hp, 'left', max), lrt = loss(hp, 'right', max), le = loss(hp, 'engine', max);
  const wFL = loss(hp, 'wheelFL', max), wFR = loss(hp, 'wheelFR', max);
  const wRL = loss(hp, 'wheelRL', max), wRR = loss(hp, 'wheelRR', max);

  const powerMul = 1 - D.frontPowerLoss * lf - D.enginePowerLoss * le;
  const topSpeedMul = 1 - D.engineTopSpeedLoss * le;
  // never below the floor: a battered car still steers (the drift and AI paths clamp the same way)
  const gripMul = Math.max(D.gripFloor, 1 - D.rearGripLoss * lr - D.wheelGripLoss * (wFL + wFR + wRL + wRR));

  // pull toward the damaged side; the front zone adds pull in the direction already pulling, or the remembered side of
  // the first hit when the loss is symmetric (no pull at all when there is neither)
  const lateral = D.sidePull * (lrt - ll) + D.frontSteerPull * 0.6 * (wFR - wFL);
  const dir = Math.abs(lateral) > 1e-9 ? Math.sign(lateral) : Math.sign(pullDir);
  const steerPull = Math.max(-1, Math.min(1, lateral + dir * D.frontSteerPull * lf * 0.7));

  const health = totalHealth(hp, max);
  const smokeH = health < D.smokeBelow ? (D.smokeBelow - health) / D.smokeBelow : 0;
  const smokeE = Math.max(0, (le - 0.4) / 0.6);
  const smoke = Math.min(1, Math.max(smokeH, smokeE));
  const sparksH = health < D.sparksBelow ? (D.sparksBelow - health) / D.sparksBelow : 0;
  const sparksW = Math.max(wFL, wFR, wRL, wRR) >= 1 ? 0.5 : 0;
  const sparks = Math.min(1, Math.max(sparksH, sparksW));

  return { powerMul, topSpeedMul, gripMul, steerPull, smoke, sparks };
}

/** Which visual part flies off when its zone hp falls below partOffHp * factor. */
const PART_TABLE: { part: CarPart; zone: ZoneId; factor: number }[] = [
  { part: 'bumperF', zone: 'front', factor: 1 },
  { part: 'hood', zone: 'engine', factor: 1 },
  { part: 'hood', zone: 'front', factor: 0.4 },
  { part: 'bumperR', zone: 'rear', factor: 1 },
  { part: 'spoiler', zone: 'rear', factor: 0.5 },
  { part: 'mirrorL', zone: 'left', factor: 1 },
  { part: 'doorL', zone: 'left', factor: 0.5 },
  { part: 'mirrorR', zone: 'right', factor: 1 },
  { part: 'doorR', zone: 'right', factor: 0.5 },
];

export const WHEEL_PARTS: CarPart[] = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];

export function partsToDetach(hp: ZoneHp, already: CarPart[]): CarPart[] {
  const out: CarPart[] = [];
  for (const e of PART_TABLE) {
    if (already.includes(e.part) || out.includes(e.part)) continue;
    if (hp[e.zone] < D.partOffHp * e.factor) out.push(e.part);
  }
  // wheels: only a wrecked corner loses its wheel, and never more than maxWheelsOff per car
  let wheelsOff = 0;
  for (const w of WHEEL_PARTS) if (already.includes(w)) wheelsOff++;
  for (const w of WHEEL_PARTS) {
    if (wheelsOff >= D.maxWheelsOff) break;
    if (already.includes(w)) continue;
    if (hp[w as ZoneId] <= D.wheelOffHp) { out.push(w); wheelsOff++; }
  }
  return out;
}

/** Outermost-first parts of each body side: what one hard hit on that side knocks off. */
const SIDE_PARTS: Partial<Record<ZoneId, CarPart[]>> = {
  front: ['bumperF', 'hood'], rear: ['bumperR', 'spoiler'], left: ['mirrorL', 'doorL'], right: ['mirrorR', 'doorR'],
};

/**
 * A single hard hit (solver impulse, N*s) on body side `zone` knocks parts off whatever the zone hp:
 * >= knockOffImpulse the outermost part still on, >= knockOffSecond also the next one. Deterministic.
 */
export function partsKnockedOff(zone: ZoneId, impulse: number, already: CarPart[]): CarPart[] {
  const list = SIDE_PARTS[zone];
  if (!list || !(impulse >= D.knockOffImpulse)) return [];
  const n = impulse >= D.knockOffSecond ? 2 : 1;
  const out: CarPart[] = [];
  for (const p of list) {
    if (out.length >= n) break;
    if (!already.includes(p)) out.push(p);
  }
  return out;
}

/** Local offset of each part on the car (for the fly-off kick). */
export const PART_OFFSET: Record<CarPart, { x: number; y: number }> = {
  bumperF: { x: 2.0, y: 0 }, hood: { x: 1.1, y: 0 }, bumperR: { x: -2.0, y: 0 }, spoiler: { x: -1.8, y: 0 },
  doorL: { x: 0.1, y: 1.0 }, doorR: { x: 0.1, y: -1.0 }, mirrorL: { x: 0.7, y: 1.05 }, mirrorR: { x: 0.7, y: -1.05 },
  wheelFL: { x: 1.3, y: 0.82 }, wheelFR: { x: 1.3, y: -0.82 }, wheelRL: { x: -1.3, y: 0.82 }, wheelRR: { x: -1.3, y: -0.82 },
};
