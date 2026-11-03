// Player driving assist, PURE: a gentle steer back toward the road when the car is about to run off the edge.
// It never acts on a deliberate move (nose far off the track direction: smashing a wall, a U-turn), while drifting,
// off-road or when slow, and it is weak against a player who steers the other way.
import { CONFIG } from '../config';
import type { CarInput, CarState, TrackGeometry } from '../types';

const C = CONFIG.car;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Steer correction (-assistMax..assistMax, + = right) for the car's current state. */
export function edgeAssist(st: CarState, track: TrackGeometry, hintS?: number): number {
  const v = st.speed;
  if (v < 8 || st.driftActive || st.offRoad) return 0;
  const near = track.nearest(st.x, st.y, hintS);
  const smp = track.sampleAt(near.s);
  const he = wrap(Math.atan2(smp.ty, smp.tx) - st.angle);   // + = the nose must turn left to follow the road
  if (Math.abs(he) > C.assistMaxAngle) return 0;
  const latRate = v * Math.sin(-he);                         // + = drifting toward the left edge
  const pred = near.lateral + latRate * C.assistLook;
  const limit = track.def.width / 2 - C.assistMargin;
  if (Math.abs(pred) <= limit || Math.sign(pred) !== Math.sign(latRate)) return 0;
  const over = clamp((Math.abs(pred) - limit) / 2.5, 0, 1);
  return Math.sign(pred) * over * C.assistMax;              // left edge -> steer right (+)
}

/** The player's input with the assist blended in. */
export function assistedInput(input: CarInput, st: CarState, track: TrackGeometry, hintS?: number): CarInput {
  const d = edgeAssist(st, track, hintS);
  if (d === 0) return input;
  const s = input.steer;
  let steer: number;
  if (s === 0 || Math.sign(s) === Math.sign(d)) steer = Math.sign(d) * Math.max(Math.abs(s), Math.abs(d));
  else steer = s + d * (1 - 0.7 * Math.abs(s));
  return { ...input, steer: clamp(steer, -1, 1) };
}
