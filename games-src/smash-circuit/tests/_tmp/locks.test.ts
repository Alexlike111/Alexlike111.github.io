import { it } from 'vitest';
import { PhysicsWorld } from '../../src/sim/world';
import { DestructionSystem } from '../../src/sim/destruction';
import { buildTrackGeometry } from '../../src/track/spline';
import { TRACKS } from '../../src/track/tracks';
it('locks', () => {
  for (const def of TRACKS) {
    const ds = new DestructionSystem(new PhysicsWorld(), buildTrackGeometry(def));
    const walls = ds.states.filter((s) => s.kind === 'wall' || s.kind === 'guardrail');
    const locked = walls.filter((s) => ds.isLocked(s.id));
    console.log(def.id, 'walls', walls.length, 'locked', locked.length, locked.map((s) => s.id).join(','));
  }
});
