// ALL tunable numbers live here (balance, physics, economy, render quality).
// Modules read from CONFIG; never hard-code balance values elsewhere.
import type { CarTraits, RivalMode, UpgradeBranch, ZoneId } from './types';

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
    baseEnginePower: 13.0,    // m/s^2 at full throttle from standstill (arcade: 0-100 km/h ~2.5 s, 0-120 ~3.2 s); falls off with speed (powerFalloff)
    baseTopSpeed: 60,         // m/s: start of the speed ceiling; the last 10% tapers and air drag settles the base car at ~57 m/s (~205 km/h) on a long straight
    baseGrip: 18,             // 1/s: how fast the velocity swings back onto the nose (high = planted, arcade; 18: full-lock slip stays ~6 deg at 120 km/h)
    handbrakeGripMul: 0.25,   // grip while handbrake held -> drift
    brakeDecel: 14,           // m/s^2 -> 80-0 km/h in ~17 m, 200-0 in ~1/4 of a long straight (arcade brakes match the higher speeds)
    reverseMax: 8,            // m/s
    reversePower: 5,
    rollingDrag: 0.3,         // m/s^2 constant (lift-off slows the car a little: easy speed control without braking)
    airDrag: 0.0011,          // * v^2
    maxSteerAngle: 0.6,       // rad of front wheels at low speed (sets the low-speed turn radius)
    minSteerAngleAtTop: 0.16, // (legacy, no longer read: at speed the steering is a linear fraction of the grip-limited turn rate, see carModel)
    wheelBase: 2.6,
    steerSpeed: 20,           // how fast steering input follows target, 1/s (0.05 s to full lock: light, immediate steering)
    yawDamping: 28,           // angular velocity correction toward the steering target, 1/s (also the stability control: spins die in ~0.1 s);
                              // with steerSpeed: a key press reaches 90% of the full turn rate in ~0.11 s
    driftSlipThreshold: 3.5,  // m/s lateral speed -> drifting flag (smoke) outside the drift mechanic
    curbSlowdown: 0.985,      // speed multiplier per step*120 on curbs (applied as per-second factor ^dt)
    curbShake: 0.6,
    offRoadDrag: 2.2,         // m/s^2 extra drag on grass/holes
    offRoadGripMul: 0.6,
    holeDrag: 4.0,            // torn road chunk
    bullet: true,             // CCD [4.14]
    // --- appended by module A (physics & car) ---
    maxLatAccel: 40,          // m/s^2 arcade cornering on healthy road with no speed loss (real cars ~10): up to ~70% stick at any speed
    fullLockLatMul: 1.4,      // full lock turns harder than that (56 m/s^2) and pays for it with tyre scrub (fullLockScrub): the car goes where it is
                              // pointed and sheds the speed it needs (lifting is only needed for hairpins)
    fullLockScrub: 0.6,       // m/s^2 of deceleration per m/s^2 of cornering beyond maxLatAccel
    maxYawRate: 3.2,          // rad/s absolute cap
    handbrakeYawMul: 1.35,    // yaw authority multiplier while handbrake held (rear steps out)
    handbrakeDecel: 3.2,      // m/s^2 extra forward drag while handbrake held
    cornerScrub: 0.08,        // fraction of slip speed bled per grip correction (tyre scrub ~0.08 x lateral accel; low = corners keep the speed)
    curbDrag: 1.2,            // m/s^2 (reference) on curb: mild (rubbing a curb costs ~15 km/h per second at 100 km/h), grass (offRoadDrag) is the real penalty
    curbGripMul: 0.9,
    holeGripMul: 0.4,
    driftExitMul: 0.7,        // drifting flag releases below threshold * this
    steerReturnMul: 1.6,      // steering recentres faster than it turns in
    lowSpeedSteerFade: 1.5,   // m/s below which yaw authority fades (stability at standstill)
    gears: 5, idleRpm: 0.16,
    impactEventMin: 700,      // N*s below: no impact event (only scrape)
    scrapeMin: 90,            // N*s below: nothing
    impactStrengthFull: 50000, // N*s mapped to SimEvent.impact.strength = 1 (~1200 N*s per m/s of normal speed: 180 km/h)
    impactStrengthCurve: 0.8,  // strength = (impulse / full) ^ curve; < 1 keeps taps (30 km/h) audible, 100 km/h ~0.7, saturates at ~180 km/h
    scrapeInterval: 0.06,     // s between scrape events per car
    // ---- arcade feel pass (driving model) ----
    powerFalloff: 0.55,       // engine force at the ceiling = (1 - this) of the standstill force (strong launch, still pulls at the top)
    lowSpeedGripBoost: 1.0,   // extra lateral grip at standstill (x2), fading out by lowSpeedGripUntil
    lowSpeedGripUntil: 22,    // m/s
    steerExpo: 0,             // 0 = linear steering; > 0 softens small inputs (touch has its own curve: controls.touchSteerCurve)
    // player-only assist: a gentle steer away from the road edge when the nose points out of the road
    assistLook: 0.75,         // s of travel looked ahead for the road edge
    assistMargin: 1.2,        // m inside the edge where the assist starts
    assistMax: 0.2,           // max steer added (only ever adds to the player's steering, never takes turn-in away)
    assistMaxAngle: 0.6,      // rad: heading error above which the assist stays out (deliberate smashes, U-turns)
    // ---- appended: impact layer (audit #13, P1/P2) ----
    // what a collision does to the car is kept apart from the arcade model, so grip and yaw damping cannot erase it at once:
    // the sideways part of the solver's velocity change (car frame) and its spin decay on their own
    impact: {
      minDv: 2,               // m/s: a step's sideways velocity change from contacts at least this big (a real hit, not a rub) goes to the impact layer
      decay: 6,               // 1/s decay of the impact velocity (a 10 m/s shove slides ~1.7 m before the tyres bite)
      maxFrac: 0.6,           // |impact velocity| <= this x the car's speed
      minDw: 0.8,             // rad/s: a step's spin change from contacts at least this big goes to the impact spin
      spinDecay: 3,           // 1/s decay of the impact spin (yaw damping used to kill it in ~0.15 s; a hard hit now turns the car ~20-40 deg)
      spinMax: 3.5,           // rad/s cap of the impact spin
      slideFull: 8000,        // N*s: a hit this hard keeps its whole sideways shove in the impact layer (a light touch: a share)
      spinFull: 20000,        // N*s (~60 km/h square): a hit this hard keeps its whole spin (a glancing touch hardly turns the car)
      lowSpeed: [0.5, 1.5] as [number, number], // m/s forward speed band below which the model only damps sideways speed (never turns it into forward / reverse)
      crashImpulse: 12000,    // N*s of one solver hit (~36 km/h square into a wall) that starts the crash state (car-car x crashCarMul)
      crashCarMul: 1.5,
      crashTime: [0.25, 0.4] as [number, number], // s of crash state, from crashImpulse to 2x crashImpulse
      crashGripMul: 0.5,      // grip (re-alignment of the velocity onto the nose) during the crash state
      crashSteerMul: 0.3,     // share of the steering input that still acts during the crash state
    },
  },
  damage: {
    zoneMaxHp: 100,
    impulseThreshold: 2500,   // N*s below this: no damage (curb rubbing, light taps) [4.13]
    impulseToDamage: 0.0035,  // hp per N*s above threshold
    carVsCarMul: 0.7,
    wreckPowerMul: 0.25,      // power when totally wrecked
    partOffHp: 35,            // zone hp below which its part flies off
    // effect strength at zone hp = 0 (linear in-between)
    frontPowerLoss: 0.35, frontSteerPull: 0.15,
    sidePull: 0.18,
    rearGripLoss: 0.35,
    engineTopSpeedLoss: 0.4, enginePowerLoss: 0.3,
    wheelGripLoss: 0.15,      // per wheel
    smokeBelow: 0.5,          // health below -> smoke
    sparksBelow: 0.35,
    // --- appended by module A ---
    wreckedBelow: 0.12,       // total health below -> wrecked (limps)
    bodyShare: 0.65,          // share of damage taken by the primary body zone (rest to the second zone)
    wheelRadius: 1.0,         // m: a hit this close to a wheel also damages it
    partKick: 6,              // m/s extra velocity of detaching parts
    // ---- appended: visible crash damage (parts knocked off by one hard hit, wheels at heavy damage) ----
    knockOffImpulse: 15000,   // N*s of ONE solver hit (~1200 per m/s of normal speed: ~45 km/h square into a wall) that knocks the outermost part of the hit side off, whatever the zone hp
    knockOffSecond: 26000,    // N*s (~80 km/h) from which the hit also knocks the next part of that side off (bumper + hood)
    wheelOffHp: 0.5,          // wheel zone hp at or below which that wheel comes off
    maxWheelsOff: 2,          // a car never loses more wheels than this (it must still read as a car)
    // ---- appended: fair damage (audit #14 / #19) ----
    toast: { power: 0.85, speed: 0.9, grip: 0.8, pull: 0.1, cooldown: 4 },   // effect toasts: shown once effects fall past these (re-armed on repair), min gap in s
    gripFloor: 0.3,           // effects.gripMul never drops below this (a battered car still steers)
    hitWindow: 0.1,           // s: contact impulses of one car on one barrier (walls + guardrails) or one prop are summed over this window and
                              // the no-damage threshold applies once per window (a glancing hit's 3-4 solver steps count as one hit)
                              // plow-through (see destruction.plowKeep): the impulse that breaks the piece is charged in full and
                              // only the part of the hit above it is softened, so a harder hit never costs less (no cliff)
  },
  destruction: {
    // HP of segments; a hit subtracts (impulse - threshold) * impulseToDamage. Measured contact impulse ~ 1200 * normal speed (m/s)
    // (normal speed = speed component into the wall). Break at: guardrail ~10 m/s (35 km/h), wall ~14 m/s (50 km/h),
    // road chunk ~19 m/s (70 km/h). Glancing rubs add scrape damage (hp per metre driven along the piece, see `scrape`).
    wall: { hp: 220, threshold: 4000, segmentLength: 4, thickness: 1.4 },
    guardrail: { hp: 170, threshold: 3000, segmentLength: 4, thickness: 0.8 },
    curb: { hp: 40, segmentLength: 3, width: 1.0 },        // sensor: slow + shake; hp loss visual only [4.4]
    road: { hp: 320, threshold: 7000, chunkLength: 6 },     // road tears into chunks [4.2, 11.6 default: chunks fly off]
    prop: { hp: 20, threshold: 800 },
    impulseToDamage: 0.02,
    debrisPerBreak: [2, 3] as [number, number],             // [4.6]
    maxDebris: 60,                                          // [4.5, 10.5]
    debrisLife: 1.5,                                        // s [11.7 default 1-2 s]
    debrisFade: 0.5,
    maxBreaksPerStep: 4,       // deferred removal after world step [4.9]
    wallOffset: 2.2,           // distance from road edge to wall centre
    // ---- appended by module B (track/destruction) ----
    cornerCurvature: 0.011,    // |curvature| (1/m) above which a stretch is a corner: curbs + 'wall' kind (else 'guardrail')
    roadLanes: 3,              // road chunks per cross-section (a torn chunk is one lane wide)
    splash: 0.3,               // fraction of a wall/guardrail hit passed on to both neighbour segments
    curbScuffPerMetre: 0.8,    // hp lost per metre driven over a curb segment above curbScuffMinSpeed (visual wear)
    curbScuffMinSpeed: 14,     // m/s
    roadHitRadius: 1.5,        // m beyond the wall centre line within which a heavy hit still tears road
    roadSplash: 0.25,          // fraction of road damage passed on to the neighbouring chunks along the track
    // Tangential (scraping) damage: a car sliding along a wall/guardrail at >= minSpeed (m/s) wears it down per metre driven.
    scrape: { minSpeed: 7, wall: 2.2, guardrail: 3.5 },
    // Plow-through (round 2): a static piece (wall, guardrail, sign, tree, rock) that BREAKS under a car must not stop it dead.
    // After the break the car keeps `plowKeep` of the speed it had into the piece before the solver bounced it, and the
    // damage it takes is the impulse of that smaller speed change, capped at `plowDamageCap` x the impulse that just breaks the piece
    // (so a flimsy sign costs little at any speed).
    plowKeep: 0.62,
    plowDamageCap: 1.4,
    plowSoftHp: 40,            // pieces with at most this much hp (signs, cones) are flimsy ...
    plowSoftKeep: 0.88,        // ... and the car keeps this much of its approach speed through them
    boundaryMargin: 150,       // m: unbreakable invisible fence around the track bounding box
    boundaryThickness: 8,
    wallFriction: 0.2, wallRestitution: 0.15,
    propKick: { minSpeed: 2, forwardMul: 1.35, sideMul: 0.6, spin: 9 }, // dynamic props are thrown clear of the car
    propBody: { linearDamping: 2.5, angularDamping: 2.2, friction: 0.35, restitution: 0.3 },
    // Light props receive tiny contact impulses (~ m*v), so each type has its own threshold and damage multiplier.
    // damage = (impulse - threshold) * impulseToDamage * dmgMul. shape: box w x h, circle diameter w. mass 0 = static.
    props: {
      cone:      { shape: 'circle', w: 0.5, h: 0.5, mass: 4,  hp: 10,  threshold: 40,   dmgMul: 9.6 },
      barrel:    { shape: 'circle', w: 0.9, h: 0.9, mass: 30, hp: 30,  threshold: 200,  dmgMul: 3.0 },
      crate:     { shape: 'box',    w: 1.1, h: 1.1, mass: 50, hp: 40,  threshold: 300,  dmgMul: 2.4 },
      tireStack: { shape: 'circle', w: 1.1, h: 1.1, mass: 45, hp: 70,  threshold: 350,  dmgMul: 1.8 },
      hayBale:   { shape: 'box',    w: 1.8, h: 1.0, mass: 70, hp: 50,  threshold: 400,  dmgMul: 1.8 },
      sign:      { shape: 'box',    w: 0.4, h: 0.4, mass: 0,  hp: 25,  threshold: 2500, dmgMul: 0.6 },
      tree:      { shape: 'circle', w: 1.6, h: 1.6, mass: 0,  hp: 220, threshold: 5000, dmgMul: 0.6 },
      rock:      { shape: 'circle', w: 2.2, h: 2.2, mass: 0,  hp: 450, threshold: 7000, dmgMul: 0.6 },
    } as const,
    // ---- appended: anti-shortcut walls (audit #8, X1) ----
    // a wall / guardrail with a centre-line point more than `arc` m away along the lap within `dist` m on its outer side
    // faces another part of the track: it is indestructible (breaking it would open a shortcut)
    lock: { dist: 45, arc: 100 },
    // ---- appended: proximity scrape wear (audit #20, X3) ----
    // each step, a car corner within `gap` m of a wall / guardrail face sliding along it at >= scrape.minSpeed wears the
    // piece by scrape[kind] hp per metre (and makes sparks); independent of the solver impulse
    scrapeGap: 0.15,
  },
  race: {
    cars: 8,                   // [3.3]
    laps: 3,
    countdown: 3,
    startGridSpacing: 7,
    ghostHz: 20,
    // ---- appended by module C (race) ----
    finishGrace: 6,            // s the race goes on after the player finishes, then unfinished cars get estimated times (<= 15)
    playerGridSlot: 5,         // 0-based grid slot of the player (0 = pole)
    gridSideFraction: 0.2,     // grid column offset as fraction of road width
    maxProgressJump: 25,       // (legacy, no longer read: progress is credited only by driving, see gateMaxStep)
    jumpConfirmTime: 1.0,      // (legacy, no longer read)
    ghostMinLap: 1,            // ghost recording starts after this many completed laps (flying start)
    ghostHold: 2,              // s the ghost waits at the line after its lap
    // ---- appended: gate-based lap progress (audit #8, R1/R2) ----
    gates: 4,                  // ordered gates per lap (gate 0 = start / finish line); every gate must be crossed forward for a lap
    gateMaxStep: 3,            // m of along-track change per update credited as driving; bigger = a jump (cut / leg switch), not credited
    gateLateral: 8,            // m beyond the road edge inside which a gate crossing still counts (past the walls, on the run-off)
    creditLateral: 2,          // m beyond the road edge inside which driven distance is credited as progress (the walls stand at ~2.2)
    gateJumpTolerance: 40,     // m: a forward hop up to this (stuck reset, respawn) still passes the gates in it, but the lap is not clean
    cutTolerance: 6,           // m of a lap that may be jumped instead of driven and still be a clean lap (best lap, ghost, leaderboard)
  },
  ai: {
    lookAhead: 14,             // metres base
    lookAheadPerSpeed: 0.55,   // extra metres per m/s
    cornerSpeedK: 1.0,         // v_max = sqrt(latAccel / curvature)
    maxLatAccel: 38,           // m/s^2 the AI plans cornering with: the car sustains 40 on healthy road (car.maxLatAccel); the top AI nearly matches it
    avoidRadius: 7,
    overtakeOffset: 0.55,      // fraction of half width
    rubberBand: 0.08,          // mild catch-up (fraction of speed) for cars far behind / ahead
    skillSpeedRange: [0.86, 1.0] as [number, number],
    // ---- appended by module C (AI) ----
    decisionHz: 60,            // AI re-decides this often (inputs held in between)
    brakeSafety: 0.85,         // fraction of the real braking deceleration the AI plans with
    laneMargin: 1.6,           // m from the road edge the AI never aims beyond
    offsetRate: [1.8, 3.3] as [number, number], // m/s lateral line change speed [low skill, high skill]
    apexBias: 0.55,            // fraction of free half-width the racing line moves to the inside of a bend
    followGap: 3,              // m: gap kept behind a car that cannot be passed
    followGapPerSpeed: 0.25,   // extra gap per m/s
    passClearance: 2.6,        // m lateral centre distance when passing (2.35 before audit #22: packs touched in corners)
    passClearanceAggr: 0.35,   // minus this * aggression
    formAmp: 0.075,             // slow pace wobble of a driver (fraction of cornering speed, scaled by 1.3 - skill)
    lineRateMin: 2.5,          // m/s: line changes at low speed are never slower than this
    lineSlope: 0.06,           // max lateral line-change speed as a fraction of forward speed (rad-ish)
    candidates: 11,            // lateral lines tried when choosing around other cars
    lineHysteresis: 0.35,      // cost per metre away from the line currently held (stops dithering)
    carPenalty: 8,             // cost of a line fully blocked by a neighbour
    creepSpeed: 4,             // m/s a car may creep forward to steer around a stopped car
    closeFollow: 12,           // m: within this distance a car ahead also blocks us by our current position
    alongsideBehind: 5,        // m behind us a car still counts as a neighbour
    horizon: [40, 260] as [number, number],   // m look-ahead window for the speed profile [min, max]
    // per-track multiplier on the planned cornering speed (difficulty ramp). > 1 because the AI plans for the centre line while the road is wide enough
    // for a larger-radius racing line; with skill 1 the top AI laps t1/t2/t3 in ~26.5/30.5/33 s (a clean crude-bot human: 27.2/30.7/33.3)
    trackSpeed: { t1: 1.09, t2: 1.12, t3: 1.14 } as Record<string, number>,
    dragMaxSpeed: 12,          // m/s: above this a car that is not gaining speed is cornering / at its limit, not pushing something (no jink)
    dragTime: 2,               // s of pinned throttle without gaining speed before the AI jinks sideways
    shedTime: 0.9,             // s that jink lasts
    stuckSpeed: 1.2,           // m/s below which a car counts as stuck
    stuckTime: 1.2,            // s of being stuck before reversing
    reverseTime: [0.9, 1.6] as [number, number],
    respawnAfter: 6,           // s without 6 m of progress -> Sim puts the AI car back on the road
    mistakeScale: 0.6,         // AiPersonality.mistakeRate * this = mistakes per second
    mistakeDuration: [1.3, 2.2] as [number, number],
    offroadSpeedCap: 16,       // m/s while off the road
    finishedCruise: 22,        // m/s an AI car cruises at after finishing
    rubberStart: 40,           // m the human may be BEHIND before an AI car ahead of it eases off (mild, rubberBand * 0.7 at most)
    rubberFull: 190,           // m of gap for the full ease-off
    // chase: an AI car that is behind the human by more than rubberChaseStart speeds up (round 2: the human must not run away)
    rubberChaseStart: 80,      // m
    rubberChaseFull: 220,      // m for the full chase
    rubberChase: 0.1,          // fraction of planned cornering speed gained at the full chase
    rubberPower: 0.2,          // engine power assist of the Sim at the full chase (fraction)
    rubberTop: 0.07,           // top speed assist at the full chase (fraction)
    // ---- appended: AI race quality (audit #10 / #22) ----
    lateBrakeMul: 1.5,         // 'lateBrake' mistake: plans with this x its real braking, so it brakes too late (was inverted: 0.5 + a speed buff)
    tightRadius: 25,           // m: bends tighter than this make the outer of two cars side by side lift ...
    outerLift: 0.9,            // ... to this fraction of its target speed instead of being squeezed into the wall
    recoverBeyond: 1.7,        // m beyond the road edge (past the wall line: through a gap) from which the car drives back to where it left the road
    recoverAhead: 3,           // m past the gap it aims for on the way back in
    recoverOut: 2.5,           // m outside the wall line it first lines up at, in front of the gap
    recoverSpeed: 5,           // m/s base speed when driving back through the gap (+0.4 per m of distance)
  },
  upgrades: {
    maxLevel: 5,
    // cost per next level (index = current level)
    cost: [250, 600, 1200, 2200, 3800],
    engine: { powerPerLevel: 0.07, topSpeedPerLevel: 0.04 },
    grip: { gripPerLevel: 0.07, latPerLevel: 0.04 },   // tyres: grip rate and the cornering limit (car roster)
    armor: { armorPerLevel: 0.18 },
  } as const,
  economy: {
    startMoney: 300,
    prizeByPlace: [600, 420, 300, 220, 160, 120, 90, 60],
    trackPrizeMul: { t1: 1, t2: 1.4, t3: 1.9 } as Record<string, number>,
    destructionBonus: 6,       // money per broken segment by player (curbs excluded)
    repairCostPerHp: 0.9,      // per missing zone hp summed over zones
    repairMinCost: 20,
    rewardedMultiplier: 2,     // doubled reward [6.5]
    unlockPlace: 3,            // finish top-3 to unlock next track
    // ---- audit #12: smash payoff by object type (money per piece broken by the player; curbs pay nothing) ----
    smashPay: {
      kind: { wall: 6, guardrail: 6, road: 8, prop: 3, curb: 0 } as Record<string, number>,
      prop: { cone: 0, barrel: 3, crate: 4, tireStack: 5, sign: 2, tree: 8, rock: 8, hayBale: 3 } as Record<string, number>,
      cap: 150,                // max smash money per race
    },
  },
  // ---- audit #21: repair is a decision ----
  repair: {
    showBelowHealth: 0.75,     // the HUD repair chip appears only below this health (0..1)
    raceMaxSpeed: 3,           // m/s: in a race the car must be nearly stopped to repair
    holdS: 1.8,                // s the hold must last while stopped
    cooldownS: 20,             // s of race time between two repairs
    maxPerRace: 2,
  },
  render: {
    carColors: [0xff5a36, 0x2f8cff, 0xffc93c, 0x3ccf6e, 0xb26bff, 0xff7ac6, 0x2fd6d6, 0xf2f2f2],
    cameraHeight: 80,
    cameraTilt: 0.32,          // rad from vertical (slight 3/4 look, still top-down ortho)
    viewMetres: { portrait: 26, landscape: 56 }, // visible width at rest (portrait 26 m: the car is ~60 px long on a 390 px wide phone)
    zoomOutAtSpeed: 0.42,      // +42% view at top speed (the faster car needs to see further ahead)
    lookAhead: 0.6,            // seconds of velocity
    quality: {
      // particles = ambient dust / tyre smoke / confetti (OFF on low, REQUIREMENTS: particles off on weak devices);
      // essential = sparks, damage smoke and fire, which keep a reduced budget on low so damage stays readable
      // low pixelRatio 1.25: on a 2x phone the renderer uses min(dpr, 1.25) (sharper cars and curb stripes at a small cost); dpr 1 stays 1
      low:    { pixelRatio: 1.25, shadows: false, particles: 0, essential: 0.35, shadowMap: 0 },
      medium: { pixelRatio: 1.5, shadows: true, particles: 0.7, essential: 0.7, shadowMap: 1024 },
      high:   { pixelRatio: 2, shadows: true, particles: 1, essential: 1, shadowMap: 2048 },
    },
    autoQualityFpsDown: 50,    // drop a level when avg FPS under this for 3 s
    // ---- appended by module D (render & fx) ----
    autoQualityFpsUp: 57,      // avg FPS at/above this for autoQualityUpWindow s lets auto-quality climb one level back
    autoQualityUpWindow: 12,
    autoQualityUpCooldown: 45, // s after a drop before a step up (and a drop within it after a step up caps the level)
    autoQualityWindow: 3,      // s of low FPS before the level drops
    decorDensity: { low: 0.4, medium: 0.75, high: 1 },          // share of decor instances shown (trees, flowers, ...)
    skidCapacity: { low: 160, medium: 420, high: 800 },         // skid mark quads
    particleCapacity: 900,     // smoke/dust/confetti pool at particles = 1
    sparkCapacity: 420,        // additive pool (sparks, fire) at particles = 1
    shadowExtent: 64,          // half-size (m) of the shadow frustum around the camera target
    lightDir: [-0.5, 1.0, -0.42] as [number, number, number],   // direction TO the sun (x, up, z)
    camera: {
      follow: 16,              // 1/s position smoothing (7 lagged ~8 m behind the car at 200 km/h and ate the look-ahead)
      zoomFollow: 2.2,         // 1/s zoom smoothing (zooming back in)
      zoomOutFollow: 4,        // 1/s ... zooming out is quicker so the road ahead never waits for the zoom
      lookAheadMaxX: 0.42,     // max look-ahead as fraction of half view width
      lookAheadMaxY: 0.5,      // ... of half view height
      lookAheadSmooth: 2.5,    // 1/s smoothing of the velocity used for look-ahead
      introZoom: 0.22,         // extra zoom-out during the countdown (fraction)
      shakeDecay: 1.9,         // trauma per second
      shakeMax: 1.3,           // metres at full trauma
      shakeFromImpact: 1.4,    // trauma added at impact strength 1 (player)
      portraitAspect: 0.8,     // aspect <= this uses the portrait view width
      landscapeAspect: 1.35,   // aspect >= this uses the landscape view width
      // ---- framing (track-aware look-ahead, rotating camera) ----
      lookTime: 1.5,           // s of road ahead the view must show (also the look-ahead distance per m/s)
      lookMin: 12,             // m of road ahead used for framing at rest (the grid)
      needMin: 3,              // m added to speed * lookTime for the "must be visible" point
      lookGain: 0.6,           // view centre moves this fraction of the way to the road ahead (before the clamp)
      maxShift: 0.52,          // the view centre may sit at most this fraction of half the view away from the car
      safeEdge: 0.58,          // hard limit: the car never leaves the central 58% box (the follow lag fits in the gap to maxShift)
      aheadFit: 1.4,           // the road point lookTime ahead must fit within this many half views from the car
      shiftSmooth: 3,          // 1/s smoothing of the look-ahead shift (screen space)
      speedSmooth: 4,          // 1/s smoothing of the speed that sets the look-ahead distance (crashes do not jerk the view)
      zoomMax: 2.4,            // upper bound of the zoom factor (the forward-visibility rule may ask for more)
      minPxPerMetre: 8,        // zoom never goes out past this many CSS px per metre (the car stays >= ~36 px long)
      maxRadius: 70,           // m, upper bound of the view half diagonal (keeps decor / shadow coverage)
      rotFollow: 6,            // 1/s azimuth following the track tangent
      rotMaxRate: 1.6,         // rad/s cap of the azimuth rate
      rotLook: 0.35,           // the tangent is read this fraction of the look distance ahead of the car
      rotAspectFrom: 0.95,     // the rotating camera fades out between these aspects (landscape stays north-up)
      rotAspectTo: 1.3,
      glideTime: 0.9,          // s of slow follow after a teleport (respawn / reset): the view glides instead of jumping
      glideFollow: 5,          // 1/s position smoothing during the glide
    },
    car: {
      wheelRadius: 0.46, wheelWidth: 0.42, wheelX: 1.3, wheelZ: 0.82,
      maxSteerVisual: 0.6,     // rad of front wheel yaw at steer = 1
      rollPerLatAccel: 0.0035, // body roll (rad) per m/s^2 of lateral acceleration
      maxRoll: 0.085,
      hitPitch: 0.1,           // rad of nose pitch kick at impact strength 1 (hit at the nose / tail), damped spring, render only
      hitRoll: 0.14,           // rad of roll kick at strength 1 for a hit on a flank
      hitKickRate: 10,         // initial spring rate (1/s) per rad of kick amplitude
      hitStiffness: 190,       // 1/s^2 spring (about 2.2 Hz)
      hitDamping: 13,          // 1/s (settles in about 0.4 s)
      hitMax: 0.2,             // rad cap of the kick on pitch and roll
      hitFlashTime: 0.08,      // s of paint flash on an impact event
      hitFlashMix: 0.85,       // paint share lerped to white at the start of the flash
      partDebrisLife: 9,       // s, flying car parts lie on the road for a while (oldest recycled first when the debris pool is full)
      ghostColor: 0x9ff0ff, ghostOpacity: 0.38,
    },
    fx: {
      gravity: 24,             // m/s^2 of visual debris
      debrisUp: [5, 10] as [number, number],      // initial upward speed range
      debrisSpread: 7,         // random horizontal speed
      smokeBelow: 0.7,         // smoke emitters start under this health (also uses effects.smoke)
      wispBelow: 0.88,         // light white wisps from the bonnet between this and smokeBelow (moderate damage is visible)
      skidSlip: 0.3,           // slip above which skid marks / tyre smoke appear
      skidWidth: 0.26,
      emitRange: 1.15,         // emit only for cars within this * view radius from the camera
      shakeNearRadius: 38,     // m, break/impact shake falls off to 0 at this distance
      // ---- destruction feedback (round 1 fix) ----
      debrisScale: 1.6,        // size multiplier of break debris (chunky, readable at race zoom)
      breakPieces: [2, 3] as [number, number],        // debris pieces per ordinary break (REQUIREMENTS: 2-3 per break)
      breakPiecesStrong: [3, 3] as [number, number],  // ... per strong break (wall, road chunk, fast hit): still <= 3, but bigger chunks (strongScale)
      strongScale: 1.3,        // extra size multiplier of the chunks of a strong break (fewer pieces, same punch)
      strongBreakSpeed: 13,    // m/s of the break velocity from which a break counts as strong
      shakeFromBreak: { wall: 0.2, guardrail: 0.12, road: 0.28, curb: 0.03, prop: 0.05 } as Record<string, number>, // trauma per break at distance 0
      dustBurst: [6, 9] as [number, number],          // dust puffs per wall / guardrail break
      sparkFan: [16, 26] as [number, number],         // sparks per heavy break (fanned along the travel direction)
      hitStopMinStrength: 0.45,  // impact strength / break weight from which the visual hit-stop applies
      hitStopTime: 0.1,        // s of slowed fx time after a heavy impact (the debris and sparks hang for a beat)
      hitStopScale: 0.2,       // fx time scale during the hit-stop
      shockwaveCapacity: 10,   // ground flash rings alive at once
      shockwaveLife: 0.38,     // s
      shockwaveRadius: 5.5,    // m at the end of the ring expansion for weight 1
      // ---- car damage look ----
      dirtPower: 0.5,          // body dirt = (1 - health)^dirtPower, so moderate damage already shows
      wreckSmokeBelow: 0.2,    // health below which the damage plume shrinks (so it does not hide the car)
      wreckSmokeShrink: 0.4,   // plume size reduction at health 0
      smokeAlphaMax: 0.55,     // damage smoke opacity cap (over the car body)
      dirtMax: 0.55,           // max mix towards the burnt colour (a wreck keeps ~45% of its paint so it still reads as a car)
      bendStart: 0.12,         // part bend starts at (1 - zone hp fraction) above this (bumpers / hood bend from ~0.85 hp)
      dentDepth: 0.6,          // metres of body crumple at a destroyed zone (the cabin and wheels always stay)
      // ---- appended: visible car damage (soot / scratches, fire, lost wheels, parts lying on the road) ----
      sootMax: 0.82,           // max mix of the burnt patches over a destroyed zone (per pixel and patchy: paint survives between patches)
      scrapeSparks: 9,         // sparks fanned per scrape event at strength ~0.6 (metal grinding along a wall)
      fireBelow: 0.3,          // health below which the engine end burns (flames grow to full at a wreck)
      steamFromLoss: 0.3,      // front / engine / rear zone loss above which that end steams (white wisps) whatever the total health
      fireMinShare: 0.75,      // fire and lost-wheel sparks keep at least this emission share on the low preset (few particles, high signal)
      hubSparks: 34,           // sparks per second from the dragging hub of a lost wheel (at ~55 km/h)
      wheelOffSag: 0.07,       // rad of body roll / pitch toward a lost wheel
      debrisGroundFriction: 2.4, // 1/s sliding friction of debris on the ground (parts skid to a stop and stay on the road)
      debrisKickRadius: 1.9,   // m: a car driving over a lying part kicks it along (visual only)
      debrisKickMinSpeed: 4,   // m/s
    },
    // ---- drift / speed visuals (src/fx/driftFx.ts) ----
    driftFx: {
      tierColors: [0x4fc3ff, 0xff9a2a, 0xc061ff] as [number, number, number],   // blue, orange, purple
      sparkRate: [26, 40, 58] as [number, number, number],   // sparks per second while drifting at each tier
      boostRate: 70,           // jet particles per second during the exit boost
      streakSpeed: 25,         // m/s (90 km/h) from which ground streaks appear around the player
      streakFull: 52,          // m/s at full strength
      streakRate: 55,          // specks per second at full strength
      streakAlpha: 0.32,
    },
    // ---- player marker (the player car is one of eight similar cars) ----
    marker: {
      ringRadius: 3.05,        // m, dashed ground ring around the player car
      ringWidth: 0.3,          // m
      idleAlpha: 0.34,         // ring opacity once the intro boost is over
      strongSeconds: 6,        // s after GO during which the marker (ring + arrow) is at full strength
      pingSeconds: 2.2,        // s the marker is boosted again after the player is hit
      arrowHeight: 3.4,        // m, floating chevron above the player
      roofColor: 0xffffff,
    },
  },
  // ---- appended by module E (meta / audio / ui) ----
  meta: {
    trackOrder: ['t1', 't2', 't3'] as string[],
    opponents: {
      skill: [[0.6, 0.95], [0.8, 1.0], [0.92, 1.0]] as [number, number][],      // [slowest, fastest] AI skill per track (round 2: base car ~3rd on t1, ~4th on t2, ~7th on t3 vs a crude keyboard bot)
      statScale: [[0.92, 1.04], [1.0, 1.12], [1.14, 1.28]] as [number, number][],  // AI power/grip multiplier range per track (rivals on later tracks are upgraded cars)
      followPlayer: 0.35,        // share of the player's upgrade advantage the AI mirrors
      aggression: [0.15, 0.85] as [number, number],
      laneSpread: 0.6,
      mistakeBase: 0.9,          // mistakeRate = (1 - skill) * mistakeBase
      skillJitter: 0.1,          // per-race random +-skillJitter/2 on top of the ranked skill
      scaleJitter: 0.05,         // per-race random spread of the power/grip multiplier (fraction)
    },
  },
  // ---- career mode: cups, points, stars, rewards (module: src/meta/career.ts) ----
  career: {
    /** championship points by finishing place (index 0 = 1st); a place beyond the table scores 0 */
    points: [10, 8, 6, 5, 4, 3, 2, 1] as number[],
    /** total stars needed to open cup k (the previous cup must also have been completed once) */
    unlockStars: [0, 5, 13, 22] as number[],
    /** coins for the final cup standing: base per cup x factor by final position (4th and below: `otherFactor`) */
    cupBonusBase: [1000, 1700, 2500, 3600] as number[],
    cupBonusFactor: [1, 0.6, 0.35] as number[],
    cupBonusOtherFactor: 0.12,
    /** one-time coins for every star earned for the first time */
    starBonus: 80,
    /** AI strength shift per cup (>1 = stronger rivals): applied on top of the track tier */
    ai: { skillShift: 0.8, statShift: 0.6 },
    /** health at the finish (0..1) counted as "no heavy damage" */
    cleanHealth: 0.6,
  },
  audio: {
    master: 0.8, music: 0.32, sfx: 0.9,
    engineGain: 0.5, engineRateMin: 0.55, engineRateMax: 2.1,   // playbackRate range over rpm 0..1
    skidGain: 0.55, skidRateMin: 0.9, skidRateMax: 1.15,
    smoothing: 0.06,           // s time constant for gain/rate changes
    impactMinInterval: 0.07,   // s between impact sounds
    scrapeMinInterval: 0.18,
    breakMinInterval: 0.09,
    maxVoices: 14,
    pausedDuck: 0.0,
  },
  ui: {
    toastMs: 2200,
    tutorialSeconds: 6,
    hudFpsDebug: false,
    countdownPopMs: 700,
    // ---- audit #5 / #16 ----
    tutorialHideAfterGoS: 3,   // the first-run hint sheet hides this long after GO (or at the first input)
    lapPillMs: 2200,           // lap time pill duration
    smashFloatMs: 1100,        // in-race "+N" smash float
  },
  controls: {
    gasButtonSize: 0.26,       // fraction of min(screen w,h)
    steerDeadZone: 0.025,      // fraction of screen width (~10 px on a phone: small slides already steer)
    steerFullAt: 0.2,          // finger offset (fraction of screen width) for full lock
    // ---- appended by module E (input) ----
    brakePull: 0.4,            // GAS finger this many button-sizes below the button centre = brake / reverse (must stay < (0.5 + buttonMargin/gasButtonSize) so it is reachable before the screen edge)
    brakeButtonSize: 0.17,     // fraction of min(screen w,h): optional BRAKE button (bottom-left, second finger)
    buttonMargin: 0.04,        // fraction of min(screen w,h): gap of touch buttons from the screen edge
    keySteerRise: 25,          // 1/s: how fast keyboard steering ramps to full lock (0.04 s; the car model smooths too)
    keySteerReturn: 28,        // 1/s: and back to centre
    touchSteerCurve: 0.6,      // touch steer = offset^this (offset 0..1 between dead zone and full lock): more authority at small finger offsets
                               // (one-finger play: 10% of the full-lock distance already gives 25% steer, half the distance 66%)
    itemFlickUp: 0.55,         // GAS thumb moved up by this many button sizes = use item (re-arms at half)
    driftSteer: 0.8,           // touch: |steer| from which the input layer asks for the auto drift (no DRIFT button)
    driftHoldS: 0.25,          // touch: a digital steer (button / tap zone) must be held this long to ask for it
    // ---- audit #4 / #15 ----
    gasDeadBand: 0.25,         // GAS finger: dead band around its landing x, in button sizes (no steering jump on touch-down)
    gasDeadBandMin: 0.1,       // ... but never smaller than this (landing near the right screen edge has little room)
    pullHold: 0.15,            // s a steering finger must stay below the brake line before auto-gas brakes
    // ---- control schemes (src/input/schemes.ts) ----
    buttonSteerRise: 10,       // 1/s: steer buttons ramp to full lock in 0.1 s
    buttonSteerReturn: 14,     // 1/s: and back to centre
    slideFull: 0.15,           // Slide: finger offset (fraction of screen width) for full lock
    slideDead: 0.012,          // Slide: dead band (fraction of screen width)
    slideCurve: 0.8,           // Slide / Joystick response exponent
    joyRadius: 0.16,           // Joystick ring radius, fraction of min(screen w,h)
    joyDead: 0.1,              // Joystick dead band, fraction of the radius
    joyGrab: 1.5,              // Joystick: a touch within this x radius of its centre grabs it
    joyBrakePull: 0.55,        // Joystick: pulling down this far (x radius, from its centre) brakes / reverses
    tiltFullDeg: 25,           // Tilt: tilt angle for full lock
    tiltDeadDeg: 3,            // Tilt: dead band
    tiltCurve: 0.9,
    tiltSmooth: 14,            // 1/s smoothing of the tilt steering
    tiltCheckMs: 1500,         // no orientation event within this long after choosing Tilt = unavailable
    sensMin: 0.5, sensMax: 1.5,   // steering sensitivity slider
    homeYDrift: 0.35,          // button sizes per second the steering finger's home Y follows a slow downward creep
  },
  // ---- appended by module F (integration) ----
  game: {
    resultsDelay: 2.5,         // s of real time between the player's finish and the results screen
    maxFrameDt: 0.15,          // s clamp of one frame's dt (game time = wall time down to ~7 fps; the sim step costs < 1 ms)
    maxTimeScale: 20,          // debug time scale limit
    leaderboardPrefix: 'best_lap_',   // + track id; score = best lap in milliseconds
    seedMask: 0x7fffffff,
    // ---- round 2 (ui/integration) ----
    stuckHintAfter: 2.2,       // s a trying-to-drive player may stay below stuckSpeed before the 'hold brake to reverse' hint
    stuckResetAfter: 4,        // s below stuckSpeed (while on the gas / brake) before the free reset onto the road
    stuckSpeed: 1.5,           // m/s
    stuckMinRaceTime: 2,       // s after GO before the stuck watch starts
    resetAhead: 2,             // m ahead of the wedged car's nearest track point
    resetClearRadius: 6,       // m free of other cars for the reset spot
  },
  save: {
    maxGhostChars: 240000,     // total size of the ghost storage record; thinned above this
    // ---- audit #1 (save loading) ----
    retryDelaysMs: [1500, 3000, 6000, 12000, 30000] as number[],   // backoff between reload attempts after a failed load (the last delay repeats)
    initWaitMs: 8000,          // how long one load attempt waits for a slow Bridge init
  },
  // ---- appended by power-ups (boost pads, item boxes, items) ----
  items: {
    // Boost stack: pad and nitro multiply, capped (GDD 7.1: power x2.0, ceiling x1.30).
    caps: { power: 2.0, ceil: 1.25 },
    pad: {
      length: 6, width: 4.6,       // m (along travel x across the road)
      kick: 6,                     // m/s added along the nose x cos(heading - pad direction)
      powerMul: 1.6, ceilMul: 1.14, time: 0.9,
      cooldown: 0.8,               // s per car per pad
      exitOffset: 13,              // m after the end of a corner
      straightOffset: 14,          // m after the start of the longest straight
      minFromLine: 70,             // m from the start/finish line (both sides)
      minSpacing: 50,              // m between two pads
      cornersPerTrack: { t1: 2, t2: 2, t3: 3 } as Record<string, number>,
      cornersDefault: 2,
      straightMaxCurv: 0.003,
    },
    box: {
      radius: 1.8,                 // m pickup radius
      respawn: 8,                  // s
      rowEvery: 340,               // m of track per row
      perRow: 4, lane: 0.22,       // boxes per row, lateral spacing as a fraction of the road width
      calmCurv: 0.004,            // |curvature| allowed within +-calmSpan of a row
      calmSpan: 25,
      search: 60,                  // m a row may slide to find a calm spot
      minFromLine: 50,
      padClear: 30,                // m from any pad
    },
    nitro: { time: 2.2, kick: 3, powerMul: 1.8, ceilMul: 1.18, gripMul: 0.92 },
    shield: { time: 5, damageTaken: 0.25, dealMul: 2, massMul: 2, wallImpulseMul: 2.6, popBlink: 1 },
    repair: { frac: 0.5, minHp: 25 },
    oil: {
      time: 9, maxHits: 2, radius: 2.3, dropBack: 3.4, max: 16, ownerImmune: 1.0,
      spinTime: 0.9, spinTurns: 1, gripMul: 0.06, gripTime: 1.15, cooldown: 2.5,   // one full spin-out (the nose ends up pointing the way it started, so the car keeps going)
    },
    shock: { radius: 9, push: 5.5, damage: 12, propRadius: 6, propMul: 1.4 },
    // Item roll weights by race position: [nitro, shield, repair, oil, shockwave]. Trailing cars get the stronger tools (catch-up).
    weights: [
      { upTo: 1, w: [40, 30, 10, 16, 4] },
      { upTo: 3, w: [36, 22, 13, 15, 14] },
      { upTo: 6, w: [30, 13, 17, 12, 28] },
      { upTo: 99, w: [28, 8, 20, 10, 34] },
    ] as { upTo: number; w: number[] }[],
    repairLowHealth: 0.5, repairLowMul: 2.5, repairSkipHealth: 0.9,
    ai: {
      thinkEvery: 0.1,             // s between item decisions of one AI car
      reaction: [1.2, 0.3] as [number, number],   // s after pickup before use [itemIQ 0, itemIQ 1]
      maxHold: 8,                  // s: use anyway
      noShockBefore: 8,            // s of race time (fairness: no opening-seconds wipe-out)
      nitroLook: 2, nitroCurv: 0.004, nitroFree: 25,
      shieldBehind: 10, shieldClose: 4, shieldHealth: 0.4,
      repairHealth: 0.55, repairHealthLow: 0.85,
      oilBehindMin: 4, oilBehindMax: 22, oilLane: 3,
      oilMaxSpeed: 36, oilMaxPack: 1, oilNoStack: 90,                      // at most this many rivals behind; no new slick within this many metres of an old one
      oilCalmBehind: 40, oilCalmAhead: 100, oilCalmCurv: 0.003,           // m of road behind that must be straight, and what counts as straight
      shockCount: 2, shockRadius: 7, shockSingle: 4, shockCalmCurv: 0.006,
    },
    fx: {
      boxSize: 2.1, boxBob: 0.25, boxSpin: 1.6, boxHeight: 1.6,
      padColorA: 0x19e6ff, padColorB: 0xfff25a,
      zoomBoost: 0.08, zoomIn: 14, zoomOut: 3.5, punch: 0.06, punchDecay: 7, shakePad: 0.14,
      speedLinesFull: 1,           // boost level at which the speed lines are at full strength
      shieldColor: 0x58a8ff, nitroColor: 0xff9a2a, padFlame: 0x4cf2ff,
    },
  },
  // ---- appended by the driving-model pass: drift mechanic (src/sim/drift.ts + carModel drift dynamics) ----
  drift: {
    minSpeed: 11,             // m/s (~40 km/h): a held drift (Space / DRIFT button) starts above this
    autoSpeed: 16.7,          // m/s (~60 km/h): a hard touch steer starts a drift above this
    autoSteer: 0.8,           // |steer| that counts as a hard touch steer (80% of full lock)
    brakeTapSpeed: 15,        // m/s: brake + hard steer at speed starts a drift (player, keyboard)
    brakeTapSteer: 0.6,
    brakeTapMax: 0.3,         // s: only a short brake TAP starts a drift (on release); ordinary braking into a corner never does
    holdSteer: 0.3,           // steer into the turn that keeps an auto / brake-tap drift alive
    keepSpeed: 7,             // m/s: below this the drift ends
    exitDelay: 0.12,          // s without a drift request before an auto / brake-tap drift ends (debounce of a wobbling thumb)
    holdExitDelay: 0.02,      // s after Space / DRIFT is released (practically at once: the boost fires on release)
    autoReentry: 0.35,        // s after any drift before a hard touch steer starts the next one (a hard counter-steer straightens, not flicks)
    counterExit: 0.3,         // s of counter-steer that straightens the car out of the drift
    angleMin: 0.14,           // rad slip angle with full counter-steer (8 deg)
    angleMid: 0.42,           // rad with neutral steer (24 deg)
    angleMax: 0.62,           // rad with full steer into the turn (36 deg)
    angleRate: 6,             // 1/s: how fast the slip angle follows the target (no spin: it can never overshoot)
    latAccel: 64,             // m/s^2 path curvature at full steer (tighter than grip at full lock, 56, without its scrub: drifting is the hairpin tool)
    maxPathRate: 2.4,         // rad/s cap of the drift path's turn rate (a full-lock touch drift at 60-80 km/h is a slide, never a spin round)
    pathMin: 0.25,            // fraction of latAccel with full counter-steer
    pathMid: 0.6,             // ... with neutral steer
    powerMul: 0.8,            // engine power while sliding
    angleDrag: 2.2,           // m/s^2 extra drag at angleMax (speed loss stays small)
    brakeMul: 0.6,            // brake effect while drifting
    // charge and exit boost tiers (1 blue, 2 orange, 3 purple)
    tierTime: [0.7, 1.6, 2.8] as [number, number, number],   // s of drift charge for each tier
    minChargeAngle: 0.18,     // rad: below this slip angle the drift charges slowly (0.3x)
    boostKick: [2.5, 4.5, 7] as [number, number, number],   // m/s added along the nose on a clean exit
    boostTime: [0.5, 0.9, 1.3] as [number, number, number],  // s of extra engine power after the exit
    boostPowerMul: 1.5, boostCeilMul: 1.1,
    // points / combo
    pointsRate: 90,           // points per second at 100 km/h and full angle
    minPointsTime: 0.35,      // s: shorter drifts score nothing
    comboWindow: 2.2,         // s after a clean exit in which the next drift raises the combo
    comboMax: 5,
    coinsPerPoint: 0.05,      // drift points -> coins at the race end
    maxCoins: 400,
    cancelImpulse: 700,       // N*s: a hit this hard (walls, cars, props) cancels the drift: no boost, points and combo lost
    // AI
    aiRadius: 25,             // m: AI drifts corners tighter than this ...
    aiMinSpeed: 15,           // m/s ... when going at least this fast
    aiSkill: 0.55,            // ... and its skill is at least this
  },
  // ---- appended by the car roster (src/meta/cars.ts, render/carModels.ts): 10 cars, every one selectable ----
  // Each car: stock stats (upgrades multiply them, see `upgrades`), hitbox L x W (m), drift ease and ONE trait (numeric hooks,
  // see CarTraits in types.ts). 'scrapper' is the reference car: exactly the CONFIG.car numbers.
  // `pace` = measured AI lap time relative to the scrapper (skill 1, t1-t3, tests/carRoster.test.ts prints it); the rival field
  // uses it so an AI car of any model is as fast as the player's model (fair with any combination).
  cars: {
    starter: 'scrapper',
    order: ['scrapper', 'gravel', 'sandhopper', 'brawler', 'glint', 'scorcher', 'needle', 'bruiser', 'brick', 'mammoth'] as string[],
    defs: {
      scrapper:   { power: 13.0, top: 60, grip: 12, lat: 25.0, brake: 14, mass: 1000, armor: 1.0, length: 4.2, width: 2.0, drift: 1.0, pace: 1,
        traits: { regen: { delay: 3, perSec: 2.5, cap: 0.75 } } },
      gravel:     { power: 13.6, top: 57.5, grip: 11.5, lat: 24.5, brake: 14, mass: 950, armor: 0.9, length: 4.0, width: 1.95, drift: 1.45, pace: 0.998,
        traits: { driftCharge: 1.7 } },
      sandhopper: { power: 15.6, top: 56.5, grip: 12.5, lat: 24.0, brake: 14.5, mass: 760, armor: 0.8, length: 3.7, width: 2.15, drift: 1.25, pace: 0.995,
        traits: { offroadDragMul: 0.3, offroadGripMul: 1.45 } },
      brawler:    { power: 14.2, top: 64, grip: 10.5, lat: 23.5, brake: 12.5, mass: 1300, armor: 1.2, length: 4.6, width: 2.05, drift: 1.3, pace: 1.009,
        traits: { launch: { mul: 1.45, until: 24 } } },
      glint:      { power: 13.8, top: 62.5, grip: 12.5, lat: 24.8, brake: 15, mass: 980, armor: 0.85, length: 4.4, width: 1.95, drift: 1.05, pace: 0.987,
        traits: { draft: { range: 18, power: 0.3, ceil: 0.08 } } },
      scorcher:   { power: 16.5, top: 62, grip: 11, lat: 23.0, brake: 12, mass: 1150, armor: 1.0, length: 4.4, width: 2.1, drift: 1.15, pace: 1.004,
        traits: { boostTimeMul: 1.6 } },
      needle:     { power: 13.8, top: 64.5, grip: 13.5, lat: 25.8, brake: 16.5, mass: 800, armor: 0.7, length: 4.6, width: 1.85, drift: 0.7, pace: 0.967,
        traits: { downforce: 0.15 } },
      bruiser:    { power: 13.5, top: 59, grip: 11.5, lat: 23.8, brake: 13, mass: 1450, armor: 1.75, length: 4.7, width: 2.15, drift: 0.9, pace: 1.016,
        traits: { ramDealMul: 1.8, ramFrontOnly: true, frontTakenMul: 0.45 } },
      brick:      { power: 12.4, top: 57, grip: 11, lat: 23.3, brake: 12, mass: 1700, armor: 1.6, length: 4.9, width: 2.25, drift: 0.75, pace: 1.039,
        traits: { ramDealMul: 1.7 } },
      mammoth:    { power: 13.8, top: 57, grip: 11.5, lat: 23.3, brake: 12.5, mass: 2000, armor: 2.1, length: 5.0, width: 2.5, drift: 0.7, pace: 1.025,
        traits: { plowKeep: 0.9, shockImmune: true } },
    } as Record<string, CarDefConfig>,
    // damage is computed from the impulse normalised to this mass (impulse / mass * massRef = a velocity change): in a car-vs-car hit
    // both cars get the same impulse, so the lighter car takes more damage; a heavy car hitting a wall is not punished for its mass
    massRef: 1000,
    // drift ease (CarStats.drift) d: entry speeds / d^entryPow, slide drag / d, boost charge x d^chargePow
    driftEntryPow: 0.5, driftChargePow: 0.6,
    // garage bars: 1..10 across the roster; the race-pace number is shown as is
    bars: 10,
    // cosmetic badges per car (never a lock): races driven for 1 / 2 stars, wins for 3 stars
    badge: { races1: 1, races2: 5, wins3: 3 },
  },
  rivals: {
    default: 'mixed' as RivalMode,
    // a rival car's speed is scaled by its pace relative to the player's model, clamped here (fairness with any combination)
    paceClamp: [0.9, 1.1] as [number, number],
  },
} as const;

/** One car of the roster in CONFIG.cars.defs (stock values before upgrades). */
export interface CarDefConfig {
  power: number; top: number; grip: number; lat: number; brake: number; mass: number; armor: number;
  length: number; width: number; drift: number; pace: number; traits: CarTraits;
}

export const UPGRADE_BRANCHES: UpgradeBranch[] = ['engine', 'grip', 'armor'];
export const FRONT_ZONES: ZoneId[] = ['front', 'wheelFL', 'wheelFR'];
export type Quality = keyof typeof CONFIG.render.quality;
