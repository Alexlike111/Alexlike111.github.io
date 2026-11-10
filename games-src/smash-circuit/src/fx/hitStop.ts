// Hit-stop: the simulation freezes for 40-60 ms when the player takes a heavy car-vs-car hit (nothing else triggers it).
// Pure and DOM-free: game.ts feeds it the events and asks how much sim time one real frame may advance.
import { CONFIG } from '../config';
import type { SimEvent } from '../types';

export class HitStop {
  /** seconds of freeze left */
  left = 0;
  private cooldown = 0;
  /** off for players who ask for reduced motion */
  enabled = true;

  /** Look for a heavy hit on the player's car by another car. */
  onEvents(events: SimEvent[], playerId: number): void {
    const H = CONFIG.damage.hitStop;
    if (!this.enabled || this.cooldown > 0) return;
    for (const e of events) {
      if (e.type !== 'impact' || e.other !== 'car' || e.carId !== playerId || e.strength < H.minStrength) continue;
      const f = Math.min(1, (e.strength - H.minStrength) / (1 - H.minStrength));
      this.left = Math.max(this.left, H.time[0] + (H.time[1] - H.time[0]) * f);
      this.cooldown = H.cooldown;
      return;
    }
  }

  /** Real frame time in, simulation time out: 0 while frozen, the remainder on the frame the freeze ends. */
  advance(dt: number): number {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.left <= 0) return dt;
    const used = Math.min(this.left, dt);
    this.left -= used;
    return dt - used;
  }

  reset(): void { this.left = 0; this.cooldown = 0; }
}
