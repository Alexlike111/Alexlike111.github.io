// Free "reset to track" for a wedged player (tyre wall, pile-up). PURE: no DOM, no three.js, no sim classes.
// The AI has its own respawn (CONFIG.ai.respawnAfter); the player gets this one, driven by the game loop:
//  - hint after CONFIG.game.stuckHintAfter s of trying to drive below stuckSpeed ("hold brake to reverse"),
//  - reset after CONFIG.game.stuckResetAfter s (car placed on the road centre just ahead, facing forward).
import { CONFIG } from './config';
import type { CarState, TrackGeometry } from './types';

const G = CONFIG.game;

export type StuckEvent = 'none' | 'hint' | 'reset';

export class StuckWatch {
  private t = 0;
  private hinted = false;

  /**
   * @param dt        real frame time of a LIVE (not paused) frame
   * @param speed     signed car speed, m/s
   * @param trying    the player is pressing gas or brake (a car left alone at the grid is not "stuck")
   * @param raceTime  seconds since GO; the watch starts G.stuckMinRaceTime after GO
   */
  update(dt: number, speed: number, trying: boolean, raceTime: number): StuckEvent {
    if (raceTime < G.stuckMinRaceTime || !trying || Math.abs(speed) >= G.stuckSpeed) {
      this.t = 0;
      this.hinted = false;
      return 'none';
    }
    this.t += dt;
    if (this.t >= G.stuckResetAfter) { this.t = 0; this.hinted = false; return 'reset'; }
    if (!this.hinted && this.t >= G.stuckHintAfter) { this.hinted = true; return 'hint'; }
    return 'none';
  }

  reset(): void { this.t = 0; this.hinted = false; }
  get seconds(): number { return this.t; }
}

/** Where to put the wedged car: road centre a few metres ahead of its nearest track point, on a spot free of other cars. */
export function pickResetPose(
  track: TrackGeometry, x: number, y: number, hintS: number | undefined, others: readonly CarState[],
): { x: number; y: number; angle: number } {
  const near = track.nearest(x, y, hintS);
  for (let k = 0; k < 8; k++) {
    const s = track.sampleAt(near.s + G.resetAhead + k * 5);
    let free = true;
    for (const o of others) {
      if (Math.hypot(o.x - s.x, o.y - s.y) < G.resetClearRadius) { free = false; break; }
    }
    if (free) return { x: s.x, y: s.y, angle: Math.atan2(s.ty, s.tx) };
  }
  const s = track.sampleAt(near.s);
  return { x: s.x, y: s.y, angle: Math.atan2(s.ty, s.tx) };
}
