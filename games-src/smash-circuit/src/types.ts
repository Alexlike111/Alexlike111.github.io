// SHARED CONTRACTS. Every module codes against these. Change only via the coordinator.
// World units: metres, seconds, radians. Physics plane is 2D (x, y).
// Render mapping: physics (x, y) -> three.js (x, height, y). Ground is the XZ plane, Y is up.
// Angle 0 = car nose points to +x; positive angle = counter-clockwise in physics coords.

import type { ControlScheme } from './input/schemes';

export interface Vec2 { x: number; y: number }

// ---------- Input ----------
export interface CarInput {
  throttle: number;   // 0..1
  brake: number;      // 0..1 (brake, then reverse when nearly stopped)
  steer: number;      // -1 (left) .. +1 (right)
  handbrake: boolean;
  drift?: number;     // drift request (src/sim/drift.ts): 0 none, 1 auto (hard touch steer), 2 hold (DRIFT button)
}

// ---------- Damage ----------
export type ZoneId = 'front' | 'rear' | 'left' | 'right' | 'engine' | 'wheelFL' | 'wheelFR' | 'wheelRL' | 'wheelRR';
export const ZONES: ZoneId[] = ['front', 'rear', 'left', 'right', 'engine', 'wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];
export type ZoneHp = Record<ZoneId, number>; // 0..zoneMaxHp
/** Visual parts that can fly off the car when a zone is badly damaged. */
export type CarPart = 'bumperF' | 'bumperR' | 'hood' | 'doorL' | 'doorR' | 'spoiler' | 'mirrorL' | 'mirrorR'
  // wheels come off only at heavy damage (wheel zone hp ~0, at most CONFIG.damage.maxWheelsOff per car)
  | 'wheelFL' | 'wheelFR' | 'wheelRL' | 'wheelRR';

/** Multipliers derived from damage, applied by the car model. 1 = healthy. */
export interface DamageEffects {
  powerMul: number;      // engine force multiplier (front, engine)
  topSpeedMul: number;   // top speed ceiling multiplier (engine)
  gripMul: number;       // overall lateral grip multiplier (rear, wheels)
  steerPull: number;     // constant steering bias -1..1 (front, sides, front wheels)
  smoke: number;         // 0..1 visual smoke intensity
  sparks: number;        // 0..1 visual sparks intensity (scraping metal)
}

// ---------- Cars ----------
export interface CarStats {   // final stats after upgrades, used by car model
  enginePower: number;  // N of drive force per kg (m/s^2 at full throttle, before drag)
  topSpeed: number;     // m/s
  grip: number;         // lateral grip rate, 1/s (GRIP = 8 default)
  armor: number;        // damage multiplier divisor (1 = base, 2 = takes half damage)
  mass: number;         // kg
  // ---- per-car model (car roster, src/meta/cars.ts). Optional: absent = the reference car (CONFIG.car)
  modelId?: string;     // roster id ('scrapper', 'mammoth', ...)
  latAccel?: number;    // m/s^2 cornering limit on healthy road (CONFIG.car.maxLatAccel)
  brakeDecel?: number;  // m/s^2 (CONFIG.car.brakeDecel)
  length?: number;      // m hitbox (CONFIG.car.length)
  width?: number;       // m hitbox (CONFIG.car.width)
  drift?: number;       // drift ease: > 1 enters drifts at lower speed, slides with less drag, charges the boost faster
  traits?: CarTraits;   // the car's one special trait, as numeric hooks (1 / absent = neutral)
}

/** Numeric trait hooks; each is read at exactly one code point of the sim. */
export interface CarTraits {
  /** self-repair: after `delay` s without damage every zone regains `perSec` hp/s up to `cap` (fraction of max) */
  regen?: { delay: number; perSec: number; cap: number };
  /** drift boost charges this much faster */
  driftCharge?: number;
  /** damage dealt to other cars in car-vs-car contacts (any side, or only with the nose when `ramFrontOnly`) */
  ramDealMul?: number;
  ramFrontOnly?: boolean;
  /** damage the front zone takes */
  frontTakenMul?: number;
  /** off-road (grass, torn road): extra drag multiplier and grip multiplier */
  offroadDragMul?: number;
  offroadGripMul?: number;
  /** extra engine power at low speed: `mul` at standstill fading to 1 at `until` m/s */
  launch?: { mul: number; until: number };
  /** slipstream: within `range` m behind another car: engine x(1 + power), ceiling x(1 + ceil) */
  draft?: { range: number; power: number; ceil: number };
  /** boost pads, Nitro and drift exit boosts last this much longer */
  boostTimeMul?: number;
  /** extra cornering at speed: latAccel x(1 + downforce) at top speed, from 50% of top speed */
  downforce?: number;
  /** speed kept when plowing through a wall / static prop that breaks (global CONFIG.destruction.plowKeep) */
  plowKeep?: number;
  /** a Shockwave does not push this car */
  shockImmune?: boolean;
}

export interface CarSetup {
  id: number;           // 0..7, 0 = player
  isPlayer: boolean;
  name: string;         // driver display name (not translated, short)
  colorIndex: number;   // 0..7 index into CONFIG.render.carColors
  stats: CarStats;      // stats.modelId = which car of the roster (render picks the model from it)
  ai?: AiPersonality;
  startDamage?: Partial<ZoneHp>;
}

export interface AiPersonality {
  skill: number;        // 0..1 how close to optimal line/speed
  aggression: number;   // 0..1 willingness to ram / overtake
  laneOffset: number;   // -1..1 preferred lateral offset on track
  mistakeRate: number;  // 0..1 chance per second of small error
}

export interface CarState {
  id: number;
  isPlayer: boolean;
  colorIndex: number;
  name: string;
  /** roster car id (absent on hand-built states = the reference car 'scrapper') and its hitbox size */
  modelId?: string;
  length?: number; width?: number;
  x: number; y: number; angle: number;
  vx: number; vy: number;
  angularVel: number;
  speed: number;           // m/s signed along nose direction
  steer: number;           // -1..1 actual (smoothed) steering, for front wheel visuals
  throttle: number; brake: number; handbrake: boolean;
  rpm: number;             // 0..1 for audio
  drifting: boolean;       // lateral slip above threshold
  slip: number;            // 0..1 lateral slip amount (skid marks, tire sound)
  hp: ZoneHp;
  zoneMaxHp: number;
  health: number;          // 0..1 total
  effects: DamageEffects;
  detachedParts: CarPart[];
  wrecked: boolean;        // health 0: car limps at very low power, can still finish
  // race
  lap: number;             // completed laps
  progress: number;        // total distance along track incl. laps (metres), for ranking
  place: number;           // 1..N
  finished: boolean;
  finishTime: number;      // seconds, 0 if not finished
  lastLapTime: number;
  bestLapTime: number;
  onCurb: boolean;
  offRoad: boolean;
  // power-ups (set by the sim every step; absent on hand-built states, read with `?? 0`)
  item?: ItemType | null;  // held item (one slot)
  boostT?: number;         // s of boost-pad boost left
  nitroT?: number;         // s of nitro left
  shieldT?: number;        // s of ram shield left
  spinT?: number;          // s of oil spin left
  // drift mechanic (set by SimCar every step; absent on hand-built states, read with `?? 0` / `?? false`)
  driftActive?: boolean;   // in a drift right now
  driftDir?: number;       // +1 drifting left (CCW), -1 right
  driftAngle?: number;     // rad |slip angle|
  driftTier?: number;      // 0..3 exit boost tier charged so far (1 blue, 2 orange, 3 purple)
  driftCharge?: number;    // s of charge
  driftPoints?: number;    // live points of the current drift incl. combo
  driftCombo?: number;     // combo multiplier of the current drift
  driftScore?: number;     // banked drift points this race
  driftBank?: number;      // last banked amount ...
  driftBankT?: number;     // ... and seconds since it was banked
  driftCancelT?: number;   // s since the last drift was cancelled by a hit
  driftBoostT?: number;    // s of drift exit boost left
  driftBoostTier?: number; // tier of that boost
}

// ---------- Track ----------
export interface TrackDef {
  id: string;              // 't1', 't2', 't3'
  nameKey: string;         // i18n key
  theme: 'meadow' | 'desert' | 'snow' | 'night';
  laps: number;
  width: number;           // road width, metres
  points: Vec2[];          // closed Catmull-Rom control points, clockwise or ccw
  props: PropDef[];        // decorative destructible props placed near the road
  wallStyle: 'concrete' | 'tires' | 'fence';
}

export interface PropDef { type: PropType; x: number; y: number; angle: number }
export type PropType = 'cone' | 'barrel' | 'crate' | 'tireStack' | 'sign' | 'tree' | 'rock' | 'hayBale';

export interface TrackSample {
  s: number;               // distance along centre line from start, metres
  x: number; y: number;
  tx: number; ty: number;  // unit tangent
  nx: number; ny: number;  // unit normal (left of travel direction)
  curvature: number;       // signed 1/m
}

/** Built from TrackDef by spline code. Shared by sim, AI and render. */
export interface TrackGeometry {
  def: TrackDef;
  length: number;
  samples: TrackSample[];  // evenly spaced, ~1 m apart, closed (last != first)
  sampleAt(s: number): TrackSample;              // s wraps
  nearest(x: number, y: number, hintS?: number): { s: number; lateral: number }; // lateral: + = left
  startS: number;          // start/finish line position (0)
}

// ---------- Destruction (one system for everything on the map) ----------
export type DestructibleKind = 'wall' | 'guardrail' | 'curb' | 'road' | 'prop';

export interface DestructibleState {
  id: number;
  kind: DestructibleKind;
  propType?: PropType;
  x: number; y: number; angle: number;   // centre
  w: number; h: number;                   // full length along angle, full thickness
  hp: number; maxHp: number;
  crack: number;          // 0..1 visual damage (1 - hp/maxHp)
  broken: boolean;        // broken = body removed (wall/guardrail/prop) or road chunk torn out
  // road chunk only: when broken, the chunk becomes a hole (slow "gravel" surface) and its slab flies off as debris
  dynamic?: boolean;      // props become light dynamic bodies when knocked (cones, barrels)
  vx?: number; vy?: number; angularVel?: number;
}

// ---------- Events produced by the sim each step (drained by renderer/audio/ui) ----------
export type SimEvent =
  | { type: 'impact'; x: number; y: number; strength: number; carId: number; other: 'car' | DestructibleKind }
  | { type: 'break'; id: number; kind: DestructibleKind; propType?: PropType; x: number; y: number; angle: number; w: number; h: number; vx: number; vy: number }
  | { type: 'scrape'; x: number; y: number; carId: number; strength: number }
  | { type: 'partOff'; carId: number; part: CarPart; x: number; y: number; vx: number; vy: number }
  | { type: 'lap'; carId: number; lap: number; lapTime: number }
  | { type: 'finish'; carId: number; place: number; time: number }
  | { type: 'wrecked'; carId: number }
  | { type: 'countdown'; value: number }   // 3,2,1,0(=GO)
  | { type: 'repair'; carId: number }
  // ---- power-ups (boost pads, item boxes, items)
  | { type: 'boost'; carId: number; x: number; y: number; angle: number; source: 'pad' | 'nitro' }
  | { type: 'pickup'; carId: number; boxId: number; x: number; y: number; item: ItemType }
  | { type: 'itemUse'; carId: number; item: ItemType; x: number; y: number; angle: number }
  | { type: 'shieldPop'; carId: number; x: number; y: number }
  | { type: 'oilSpin'; carId: number; x: number; y: number };

// ---------- Power-ups ----------
export type ItemType = 'nitro' | 'shield' | 'repair' | 'oil' | 'shockwave';
export const ITEMS: ItemType[] = ['nitro', 'shield', 'repair', 'oil', 'shockwave'];

/** Boost strip on the road. angle = travel direction (the chevrons point along it). */
export interface BoostPad { id: number; x: number; y: number; angle: number; length: number; width: number }
/** Pickup box. ready=false while respawning (timer = seconds left). */
export interface ItemBox { id: number; x: number; y: number; ready: boolean; timer: number }
/** Oil slick on the road; active=false slots are free. age/life in seconds. */
export interface OilSlick { x: number; y: number; radius: number; age: number; life: number; active: boolean; owner: number; hits: number }

export type RacePhase = 'countdown' | 'racing' | 'finished';

export interface RaceState {
  phase: RacePhase;
  countdown: number;     // seconds left before GO
  time: number;          // race time since GO
  totalLaps: number;
  playerFinished: boolean;
  results: { carId: number; place: number; time: number; bestLap: number }[];
}

export interface GhostFrame { t: number; x: number; y: number; a: number }
export interface GhostData { trackId: string; lapTime: number; frames: GhostFrame[] } // frames every 1/20 s

// ---------- Save data ----------
export type UpgradeBranch = 'engine' | 'grip' | 'armor';
export type UpgradeLevels = Record<UpgradeBranch, number>;
/** Which cars the 7 rivals drive: the player's model, all different models, random models, or one picked model. */
export type RivalMode = 'same' | 'mixed' | 'random' | 'pick';
export interface SaveData {
  version: 2;
  money: number;
  /** selected roster car id */
  car: string;
  /** upgrade levels per car id (level 0..max); v1 saves had one global record -> migrated to the starter car */
  carUpgrades: Record<string, UpgradeLevels>;
  /** races finished / won per car id (badges only; every car is always selectable) */
  carRaces: Record<string, number>;
  carWins: Record<string, number>;
  unlockedTracks: string[];                  // track ids
  bestPlace: Record<string, number>;         // trackId -> best place (1..8)
  bestLap: Record<string, number>;           // trackId -> seconds
  settings: { lang: 'en' | 'ru' | 'auto'; autoGas: boolean; quality: 'auto' | 'low' | 'medium' | 'high'; muted: boolean; tutorialDone: boolean; camera: 'auto' | 'rotating' | 'fixed';
    /** phone control scheme (default 'buttons'), steering sensitivity (0.5..1.5) and whether the first-run picker was shown */
    controls: ControlScheme; steerSens: number; controlsPicked: boolean;
    /** rival field (pre-race screen and settings); absent = 'mixed' */
    rivals?: RivalMode;
    /** model for RivalMode 'pick' */
    rivalCar?: string;
  };
  ghosts: Record<string, GhostData>;
  carColor: number;
  racesFinished: number;
}

// ---------- Sim interface (implemented in src/sim/sim.ts) ----------
export interface SimOptions {
  track: TrackDef;
  cars: CarSetup[];       // index 0 = player
  seed: number;
  ghost?: GhostData;      // playback ghost for player
  laps?: number;          // override
  powerUps?: boolean;      // false: no boost pads / item boxes (pure-driving tests); default true
}

export interface ISim {
  readonly track: TrackGeometry;
  readonly cars: CarState[];
  readonly destructibles: DestructibleState[];
  readonly race: RaceState;
  setPlayerInput(input: CarInput): void;
  /** Advance by real frame time; internally fixed steps of CONFIG.physics.dt with accumulator. Returns substeps done. */
  update(frameDt: number): number;
  drainEvents(): SimEvent[];
  repairPlayer(): void;               // full repair (money handled by caller)
  /** Boost strips, item boxes and oil slicks (power-ups). */
  readonly pads?: BoostPad[];
  readonly boxes?: ItemBox[];
  readonly oils?: OilSlick[];
  /** Use the player's held item (key E / Shift / HUD button). Returns true when something was used. */
  useItem?(): boolean;
  /** Interpolation alpha 0..1 of the accumulator for smooth rendering. */
  readonly alpha: number;
  /** Ghost position at current race time for the current lap, or null. */
  ghostPose(): { x: number; y: number; a: number } | null;
  /** Recorded best lap of the player in this race (for saving), or null. */
  bestGhost(): GhostData | null;
  /** Last step duration in ms (performance budget: <= 4 ms). */
  readonly stepMs: number;
  dispose(): void;
}
