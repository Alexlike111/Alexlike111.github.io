// The pull-cord meter above a generator (DESIGN §15): a small bar in world space, drawn on top of the lighting. Fed by fixtures_station.ts every step.
import type { Fixture } from './state';
import { addLayer } from '../engine/render';
import { TS } from '../engine/grid';

const st = { f: null as Fixture | null, v: 0, chance: 1 };
let layered = false;
export function renderPull(f: Fixture | null, v: number, chanceOf: (f: Fixture) => number) {
  if (!layered) {
    layered = true;
    addLayer(141, (ctx, vw) => {
      if (!st.f || st.v <= 0) return;
      const f2 = st.f, cx = f2.tx * TS + (f2.tw * TS) / 2 - vw.x0, y = f2.ty * TS - 8 - vw.y0, w = 26, x = Math.round(cx - w / 2);
      ctx.fillStyle = 'rgba(8,14,26,0.85)'; ctx.fillRect(x - 1, y - 1, w + 2, 5);
      const k = Math.min(1, st.v);
      ctx.fillStyle = k < 0.7 ? '#e6c25a' : '#ffe9a0'; ctx.fillRect(x, y, Math.round(w * k), 3);
      ctx.fillStyle = st.chance > 0.66 ? '#6fd98a' : st.chance > 0.33 ? '#f0c050' : '#e5604f';     // the tick at the right end shows the odds of the catch
      ctx.fillRect(x + w - 1, y - 2, 2, 7);
    });
  }
  st.f = f; st.v = v; st.chance = f ? chanceOf(f) : 1;
}
