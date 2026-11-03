// ALL tunable numbers live here (balance, physics, economy, render quality).
// Modules read from CONFIG; never hard-code balance values elsewhere.
import type { UpgradeBranch, ZoneId } from './types';

export const CONFIG = {
  title: 'Smash Circuit',
  physics: {
    dt: 1 / 120,              // fixed step [11.8 default]
    maxSubSteps: 8,           // per frame, drop extra time beyond this
    velocityIterations: 6,
    positionIterations: 2,
    stepBudgetMs: 4,          // perf criterion 10.6
  },
  car: {
    length: 4.2, width: 2.0,
    mass: 1000,
    baseEnginePower: 8.4,     // m/s^2 at full throttle (tuned so 0-100 km/h ~ 4.1 s with drag)
    baseTopSpeed: 50,         // m/s (180 km/h)
    baseGrip: 8,              // GRIP = 8 [4.10 default]
    handbrakeGripMul: 0.18,   // grip while handbrake held -> drift
    brakeDecel: 10.7,         // m/s^2 -> 80-0 km/h in ~23 m
    reverseMax: 8,            // m/s
    reversePower: 5,
    rollingDrag: 0.15,        // m/s^2 constant
    airDrag: 0.0034,          // * v^2
    maxSteerAngle: 0.6,       // rad of front wheels at low speed
    minSteerAngleAtTop: 0.16, // steering narrows with speed (arcade stability)
    wheelBase: 2.6,
    steerSpeed: 6,            // how fast steering input follows target, 1/s
    yawDamping: 6,            // angular velocity correction toward bicycle model, 1/s
    driftSlipThreshold: 2.5,  // m/s lateral speed -> drifting
    curbSlowdown: 0.985,      // speed multiplier per step*120 on curbs (applied as per-second factor ^dt)
    curbShake: 0.6,
    offRoadDrag: 2.2,         // m/s^2 extra drag on grass/holes
    offRoadGripMul: 0.6,
    holeDrag: 4.0,            // torn road chunk
    bullet: true,             // CCD [4.14]
  },
  damage: {
    zoneMaxHp: 100,
    impulseThreshold: 2500,   // N*s below this: no damage (curb rubbing, light taps) [4.13]
    impulseToDamage: 0.006,   // hp per N*s above threshold
    carVsCarMul: 0.7,
    wreckPowerMul: 0.25,      // power when totally wrecked
    partOffHp: 35,            // zone hp below which its part flies off
    // effect strength at zone hp = 0 (linear in-between)
    frontPowerLoss: 0.35, frontSteerPull: 0.25,
    sidePull: 0.18,
    rearGripLoss: 0.35,
    engineTopSpeedLoss: 0.4, enginePowerLoss: 0.3,
    wheelGripLoss: 0.15,      // per wheel
    smokeBelow: 0.5,          // health below -> smoke
    sparksBelow: 0.35,
  },
  destruction: {
    // HP of segments; a hit subtracts (impulse - threshold) * impulseToDamage
    wall: { hp: 120, threshold: 6000, segmentLength: 4, thickness: 1.4 },
    guardrail: { hp: 60, threshold: 3500, segmentLength: 4, thickness: 0.8 },
    curb: { hp: 40, segmentLength: 3, width: 1.0 },        // sensor: slow + shake; hp loss visual only [4.4]
    road: { hp: 140, threshold: 7000, chunkLength: 6 },     // road tears into chunks [4.2, 11.6 default: chunks fly off]
    prop: { hp: 20, threshold: 800 },
    impulseToDamage: 0.012,
    debrisPerBreak: [2, 3] as [number, number],             // [4.6]
    maxDebris: 60,                                          // [4.5, 10.5]
    debrisLife: 1.5,                                        // s [11.7 default 1-2 s]
    debrisFade: 0.5,
    maxBreaksPerStep: 4,       // deferred removal after world step [4.9]
    wallOffset: 2.2,           // distance from road edge to wall centre
  },
  race: {
    cars: 8,                   // [3.3]
    laps: 3,
    countdown: 3,
    startGridSpacing: 7,
    ghostHz: 20,
  },
  ai: {
    lookAhead: 14,             // metres base
    lookAheadPerSpeed: 0.55,   // extra metres per m/s
    cornerSpeedK: 1.0,         // v_max = sqrt(latAccel / curvature)
    maxLatAccel: 14,
    avoidRadius: 7,
    overtakeOffset: 0.55,      // fraction of half width
    rubberBand: 0.08,          // mild catch-up (fraction of speed) for cars far behind / ahead
    skillSpeedRange: [0.86, 1.0] as [number, number],
  },
  upgrades: {
    maxLevel: 5,
    // cost per next level (index = current level)
    cost: [250, 600, 1200, 2200, 3800],
    engine: { powerPerLevel: 0.07, topSpeedPerLevel: 0.04 },
    grip: { gripPerLevel: 0.07 },
    armor: { armorPerLevel: 0.18 },
  } as const,
  economy: {
    startMoney: 300,
    prizeByPlace: [600, 420, 300, 220, 160, 120, 90, 60],
    trackPrizeMul: { t1: 1, t2: 1.4, t3: 1.9 } as Record<string, number>,
    destructionBonus: 2,       // money per broken segment by player
    repairCostPerHp: 0.9,      // per missing zone hp summed over zones
    repairMinCost: 20,
    rewardedMultiplier: 2,     // doubled reward [6.5]
    unlockPlace: 3,            // finish top-3 to unlock next track
  },
  render: {
    carColors: [0xff5a36, 0x2f8cff, 0xffc93c, 0x3ccf6e, 0xb26bff, 0xff7ac6, 0x2fd6d6, 0xf2f2f2],
    cameraHeight: 80,
    cameraTilt: 0.32,          // rad from vertical (slight 3/4 look, still top-down ortho)
    viewMetres: { portrait: 44, landscape: 56 }, // visible width at rest
    zoomOutAtSpeed: 0.25,      // +25% view at top speed
    lookAhead: 0.5,            // seconds of velocity
    quality: {
      low:    { pixelRatio: 1, shadows: false, particles: 0.35, shadowMap: 0 },
      medium: { pixelRatio: 1.5, shadows: true, particles: 0.7, shadowMap: 1024 },
      high:   { pixelRatio: 2, shadows: true, particles: 1, shadowMap: 2048 },
    },
    autoQualityFpsDown: 50,    // drop a level when avg FPS under this for 3 s
  },
  controls: {
    gasButtonSize: 0.26,       // fraction of min(screen w,h)
    steerDeadZone: 0.04,       // fraction of screen width
    steerFullAt: 0.22,         // finger offset (fraction of screen width) for full lock
  },
} as const;

export const UPGRADE_BRANCHES: UpgradeBranch[] = ['engine', 'grip', 'armor'];
export const FRONT_ZONES: ZoneId[] = ['front', 'wheelFL', 'wheelFR'];
export type Quality = keyof typeof CONFIG.render.quality;
