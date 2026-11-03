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
    baseEnginePower: 8.0,     // m/s^2 at full throttle (tuned so 0-100 km/h ~ 4.1 s with drag)
    baseTopSpeed: 50,         // m/s: start of the speed ceiling; the last 10% tapers and air drag settles the base car at ~45.5 m/s (~164 km/h) on a straight
    baseGrip: 8,              // GRIP = 8 [4.10 default]
    handbrakeGripMul: 0.25,   // grip while handbrake held -> drift
    brakeDecel: 9.7,          // m/s^2 -> 80-0 km/h in ~23 m
    reverseMax: 8,            // m/s
    reversePower: 5,
    rollingDrag: 0.15,        // m/s^2 constant
    airDrag: 0.0034,          // * v^2
    maxSteerAngle: 0.6,       // rad of front wheels at low speed
    minSteerAngleAtTop: 0.16, // steering narrows with speed (arcade stability)
    wheelBase: 2.6,
    steerSpeed: 6,            // how fast steering input follows target, 1/s
    yawDamping: 9,            // angular velocity correction toward bicycle model, 1/s
    driftSlipThreshold: 2.5,  // m/s lateral speed -> drifting
    curbSlowdown: 0.985,      // speed multiplier per step*120 on curbs (applied as per-second factor ^dt)
    curbShake: 0.6,
    offRoadDrag: 2.2,         // m/s^2 extra drag on grass/holes
    offRoadGripMul: 0.6,
    holeDrag: 4.0,            // torn road chunk
    bullet: true,             // CCD [4.14]
    // --- appended by module A (physics & car) ---
    maxLatAccel: 19,          // m/s^2 lateral acceleration limit on healthy road (steady-state slip ~ maxLatAccel/grip)
    maxYawRate: 4.2,          // rad/s absolute cap
    handbrakeYawMul: 1.35,    // yaw authority multiplier while handbrake held (rear steps out)
    handbrakeDecel: 3.2,      // m/s^2 extra forward drag while handbrake held
    cornerScrub: 0.25,        // fraction of slip speed bled per grip correction (tyre scrub)
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
    maxProgressJump: 25,       // m of along-track change per update accepted at once
    jumpConfirmTime: 1.0,      // s a bigger jump must be stable to be accepted
    ghostMinLap: 1,            // ghost recording starts after this many completed laps (flying start)
    ghostHold: 2,              // s the ghost waits at the line after its lap
  },
  ai: {
    lookAhead: 14,             // metres base
    lookAheadPerSpeed: 0.55,   // extra metres per m/s
    cornerSpeedK: 1.0,         // v_max = sqrt(latAccel / curvature)
    maxLatAccel: 19,           // m/s^2 the AI plans cornering with: the car sustains ~19 on healthy road (car.maxLatAccel); the top AI now matches it
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
    passClearance: 2.35,       // m lateral centre distance when passing
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
    horizon: [40, 180] as [number, number],   // m look-ahead window for the speed profile [min, max]
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
    destructionBonus: 6,       // money per broken segment by player (curbs excluded)
    repairCostPerHp: 0.9,      // per missing zone hp summed over zones
    repairMinCost: 20,
    rewardedMultiplier: 2,     // doubled reward [6.5]
    unlockPlace: 3,            // finish top-3 to unlock next track
  },
  render: {
    carColors: [0xff5a36, 0x2f8cff, 0xffc93c, 0x3ccf6e, 0xb26bff, 0xff7ac6, 0x2fd6d6, 0xf2f2f2],
    cameraHeight: 80,
    cameraTilt: 0.32,          // rad from vertical (slight 3/4 look, still top-down ortho)
    viewMetres: { portrait: 35, landscape: 56 }, // visible width at rest (portrait 35 m: the car is ~50 px long on a 390 px wide phone)
    zoomOutAtSpeed: 0.25,      // +25% view at top speed
    lookAhead: 0.5,            // seconds of velocity
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
    autoQualityWindow: 3,      // s of low FPS before the level drops
    decorDensity: { low: 0.4, medium: 0.75, high: 1 },          // share of decor instances shown (trees, flowers, ...)
    skidCapacity: { low: 160, medium: 420, high: 800 },         // skid mark quads
    particleCapacity: 900,     // smoke/dust/confetti pool at particles = 1
    sparkCapacity: 420,        // additive pool (sparks, fire) at particles = 1
    shadowExtent: 52,          // half-size (m) of the shadow frustum around the camera target
    lightDir: [-0.5, 1.0, -0.42] as [number, number, number],   // direction TO the sun (x, up, z)
    camera: {
      follow: 7,               // 1/s position smoothing
      zoomFollow: 2.2,         // 1/s zoom smoothing
      lookAheadMaxX: 0.3,      // max look-ahead as fraction of half view width
      lookAheadMaxY: 0.38,     // ... of half view height
      lookAheadSmooth: 3,      // 1/s smoothing of the velocity used for look-ahead
      introZoom: 0.22,         // extra zoom-out during the countdown (fraction)
      shakeDecay: 1.9,         // trauma per second
      shakeMax: 1.3,           // metres at full trauma
      shakeFromImpact: 1.4,    // trauma added at impact strength 1 (player)
      portraitAspect: 0.8,     // aspect <= this uses the portrait view width
      landscapeAspect: 1.35,   // aspect >= this uses the landscape view width
    },
    car: {
      wheelRadius: 0.46, wheelWidth: 0.42, wheelX: 1.3, wheelZ: 0.82,
      maxSteerVisual: 0.6,     // rad of front wheel yaw at steer = 1
      rollPerLatAccel: 0.0035, // body roll (rad) per m/s^2 of lateral acceleration
      maxRoll: 0.085,
      partDebrisLife: 2.4,     // s, flying car parts live a bit longer than other debris
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
  },
  controls: {
    gasButtonSize: 0.26,       // fraction of min(screen w,h)
    steerDeadZone: 0.04,       // fraction of screen width
    steerFullAt: 0.22,         // finger offset (fraction of screen width) for full lock
    // ---- appended by module E (input) ----
    brakePull: 0.4,            // GAS finger this many button-sizes below the button centre = brake / reverse (must stay < (0.5 + buttonMargin/gasButtonSize) so it is reachable before the screen edge)
    brakeButtonSize: 0.17,     // fraction of min(screen w,h): optional BRAKE button (bottom-left, second finger)
    buttonMargin: 0.04,        // fraction of min(screen w,h): gap of touch buttons from the screen edge
    keySteerRise: 9,           // 1/s: how fast keyboard steering ramps to full lock
    keySteerReturn: 14,        // 1/s: and back to centre
  },
  // ---- appended by module F (integration) ----
  game: {
    resultsDelay: 2.5,         // s of real time between the player's finish and the results screen
    maxFrameDt: 0.1,           // s clamp of one frame's dt
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
  },
} as const;

export const UPGRADE_BRANCHES: UpgradeBranch[] = ['engine', 'grip', 'armor'];
export const FRONT_ZONES: ZoneId[] = ['front', 'wheelFL', 'wheelFR'];
export type Quality = keyof typeof CONFIG.render.quality;
