// Race rules: countdown, progress along the spline, laps through ordered gates, finish, places. PURE (works on CarState objects).
//
// Progress is an "unwrapped" distance that only grows by DRIVING: per update a step of at most CONFIG.race.gateMaxStep metres
// along the track, inside the walls (|lateral| <= half width + creditLateral). Bigger jumps (the nearest centre-line point
// switching to another leg across an infield or a wall breach, a teleport) are not credited. A lap needs CONFIG.race.gates
// ordered gates (gate 0 = the start / finish line, the others evenly spaced along the lap), each crossed forward within
// half width + gateLateral of the centre line (a car on the run-off behind a breach still passes); crossing the line with every gate passed completes the lap and re-syncs the progress to the line. A lap is VALID
// (best lap, ghost, leaderboard) only when it was driven: at most CONFIG.race.cutTolerance metres of it were jumped.
import { CONFIG } from '../config';
import type { CarState, RaceState, SimEvent, TrackGeometry } from '../types';

function wrapDiff(d: number, L: number): number {
  d = d % L;
  if (d >= L / 2) d -= L; else if (d < -L / 2) d += L;
  return d;
}

function mod(d: number, L: number): number {
  d %= L;
  return d < 0 ? d + L : d;
}

export class RaceTracker {
  state: RaceState;
  /** Current track position s (0..length) of every car: use it as the hint for nearest() queries. */
  readonly hints: number[];
  /** Current lateral offset from the centre line of every car (+ = left). */
  readonly laterals: number[];
  /** Race time at which each car's current lap started. */
  readonly lapStart: number[];
  /** Whether each car's last completed lap was clean (gate-valid and not cut): only those count for best lap / ghost / leaderboard. */
  readonly lastLapValid: boolean[];
  /** Index of the gate each car has to cross next (0 = the finish line, after all the others). */
  readonly nextGate: number[];
  /** Track positions (s) of the gates; gates[0] = 0 is the start / finish line. */
  readonly gates: number[];

  private readonly track: TrackGeometry;
  private readonly laps: number;
  private readonly n: number;
  private readonly unwrapped: number[];
  private readonly prevS: number[];
  private readonly lapsDone: number[];
  private readonly rate: number[];          // smoothed progress speed, m/s
  private readonly debt: number[];          // metres of the current lap that were jumped, not driven
  private readonly finishOrder: number[] = [];
  /** cars that crossed the finish line in the current update (placed by their exact crossing time once all are known) */
  private readonly finishing: { i: number; t: number }[] = [];
  private inited = false;
  private lastCountdown = Number.POSITIVE_INFINITY;
  private grace = -1;

  constructor(track: TrackGeometry, laps: number, carCount: number) {
    this.track = track;
    this.laps = laps;
    this.n = carCount;
    this.hints = new Array(carCount).fill(0);
    this.laterals = new Array(carCount).fill(0);
    this.lapStart = new Array(carCount).fill(0);
    this.lastLapValid = new Array(carCount).fill(false);
    this.nextGate = new Array(carCount).fill(1);
    this.unwrapped = new Array(carCount).fill(0);
    this.prevS = new Array(carCount).fill(0);
    this.lapsDone = new Array(carCount).fill(0);
    this.rate = new Array(carCount).fill(0);
    this.debt = new Array(carCount).fill(0);
    const G = Math.max(2, Math.round(CONFIG.race.gates));
    this.gates = [];
    for (let g = 0; g < G; g++) this.gates.push((g * track.length) / G);
    this.state = {
      phase: 'countdown', countdown: CONFIG.race.countdown, time: 0, totalLaps: laps,
      playerFinished: false, results: [],
    };
  }

  /** Distance (m) of a car to the finish line along the track: negative before the start line. */
  distanceDone(i: number): number { return this.unwrapped[i]; }

  update(cars: CarState[], dt: number, events: SimEvent[]): void {
    const st = this.state;
    if (!this.inited) this.init(cars);

    if (st.phase === 'countdown') {
      this.trackCars(cars, 0, events, false);
      st.countdown -= dt;
      if (st.countdown > 1e-9) {
        const v = Math.ceil(st.countdown - 1e-9);
        if (v < this.lastCountdown) {
          this.lastCountdown = v;
          events.push({ type: 'countdown', value: v });
        }
      } else {
        events.push({ type: 'countdown', value: 0 });
        st.phase = 'racing';
        st.time = -st.countdown;   // leftover of the step
        st.countdown = 0;
        for (let i = 0; i < this.n; i++) this.lapStart[i] = 0;
      }
      this.rank(cars);
      return;
    }

    if (st.phase === 'racing') st.time += dt;
    this.trackCars(cars, dt, events, true);

    if (st.phase === 'racing') {
      if (st.playerFinished) {
        if (this.grace < 0) this.grace = CONFIG.race.finishGrace;
        else this.grace -= dt;
        const allDone = cars.every((c) => c.finished);
        if (allDone || this.grace <= 0) this.finalize(cars, events);
      } else if (!cars.some((c) => c.isPlayer) && cars.every((c) => c.finished)) {
        this.finalize(cars, events); // AI-only race (tests / menu demo): ends when everybody is done
      }
    }
    this.rank(cars);
  }

  private init(cars: CarState[]): void {
    const L = this.track.length;
    this.inited = true;
    for (let i = 0; i < this.n; i++) {
      const c = cars[i];
      const near = this.track.nearest(c.x, c.y);
      this.hints[i] = near.s;
      this.laterals[i] = near.lateral;
      this.prevS[i] = near.s;
      // cars on the grid stand behind the line: negative distance
      this.unwrapped[i] = near.s > L / 2 ? near.s - L : near.s;
      c.progress = this.unwrapped[i];
    }
    this.rank(cars);
  }

  /** Lap-relative position (m from the line) up to which progress may be credited before gate `g` is crossed. */
  private gateLimit(g: number): number {
    return g === 0 ? this.track.length : this.gates[g];
  }

  private trackCars(cars: CarState[], dt: number, events: SimEvent[], racing: boolean): void {
    const L = this.track.length;
    const st = this.state;
    const P = CONFIG.race;
    const half = this.track.def.width / 2;
    const corridor = half + P.gateLateral, creditBand = half + P.creditLateral;
    for (let i = 0; i < this.n; i++) {
      const c = cars[i];
      if (c.finished) continue;
      const near = this.track.nearest(c.x, c.y, this.hints[i]);
      this.hints[i] = near.s;
      this.laterals[i] = near.lateral;
      const prev = this.prevS[i];
      const delta = wrapDiff(near.s - prev, L);
      this.prevS[i] = near.s;
      const aLat = Math.abs(near.lateral);
      const inside = aLat <= corridor;
      const small = Math.abs(delta) <= P.gateMaxStep;
      const driven = small && aLat <= creditBand;
      // beside the road (a breach, the run-off) the car still passes gates, but that distance is not credited as driven
      const beside = small && !driven && inside;
      // a short forward hop (a reset onto the road, a respawn) still passes the gates it skips, but it was not driven
      const hop = !driven && !beside && inside && delta > 0 && delta <= P.gateJumpTolerance;
      if (driven) {
        this.unwrapped[i] += delta;
        if (dt > 0) this.rate[i] += (delta / dt - this.rate[i]) * Math.min(1, dt * 0.6);
      } else if (small) {
        this.debt[i] += delta;                       // beside / far off the road: not credited, signed (back and forth nets out)
      } else if (delta < 0 && -delta <= P.gateJumpTolerance) {
        this.unwrapped[i] += delta;                  // a hop back (respawn behind) never helps: always charged
      } else if (delta > 0) {
        this.debt[i] += delta;                       // jumped forward (cut, leg switch, teleport): not credited
      }

      if (racing && (driven || beside || hop) && delta > 0) this.crossGates(c, i, prev, delta, dt, events);
      // never credited beyond the next gate the car still has to cross (a cut that skipped a gate earns nothing)
      if (!c.finished) {
        const cap = this.lapsDone[i] * L + this.gateLimit(this.nextGate[i]);
        if (this.unwrapped[i] > cap) this.unwrapped[i] = cap;
        c.progress = this.unwrapped[i];
      }
    }
    // two cars over the line in the same step: the earlier crossing gets the better place
    const fin = this.finishing;
    if (fin.length) {
      fin.sort((a, b) => a.t - b.t || a.i - b.i);
      for (const f of fin) {
        const c = cars[f.i];
        this.finishOrder.push(f.i);
        c.place = this.finishOrder.length;
        events.push({ type: 'finish', carId: c.id, place: c.place, time: f.t });
      }
      fin.length = 0;
    }
  }

  /** Forward step prev -> prev + delta: pass the next gate(s) in order; the line completes the lap. */
  private crossGates(c: CarState, i: number, prev: number, delta: number, dt: number, events: SimEvent[]): void {
    const L = this.track.length;
    const st = this.state;
    const G = this.gates.length;
    for (let guard = 0; guard < G && !c.finished; guard++) {
      const g = this.nextGate[i];
      const d0 = mod(this.gates[g] - prev, L);
      if (!(d0 > 0 && d0 <= delta)) return;
      if (g !== 0) { this.nextGate[i] = (g + 1) % G; continue; }
      // the line with every gate passed: lap
      const over = delta - d0;
      const speed = dt > 0 ? delta / dt : Math.max(Math.abs(c.speed), 1);
      const tCross = Math.min(st.time, Math.max(this.lapStart[i], st.time - over / Math.max(speed, 1)));
      this.lapsDone[i]++;
      this.nextGate[i] = 1 % G;
      this.unwrapped[i] = this.lapsDone[i] * L + over;
      const valid = this.debt[i] <= CONFIG.race.cutTolerance;
      this.debt[i] = 0;
      this.lastLapValid[i] = valid;
      c.lap = this.lapsDone[i];
      const lapTime = tCross - this.lapStart[i];
      this.lapStart[i] = tCross;
      c.lastLapTime = lapTime;
      if (valid && (c.bestLapTime === 0 || lapTime < c.bestLapTime)) c.bestLapTime = lapTime;
      events.push({ type: 'lap', carId: c.id, lap: c.lap, lapTime });
      if (c.lap >= this.laps) {
        c.finished = true;
        c.finishTime = tCross;
        c.progress = this.laps * L;
        this.finishing.push({ i, t: tCross });
        if (c.isPlayer) st.playerFinished = true;
      }
      return;
    }
  }

  /** Assigns c.place: finished cars by finish order, then by progress. */
  private rank(cars: CarState[]): void {
    const idx: number[] = [];
    for (let i = 0; i < this.n; i++) idx.push(i);
    const fo = this.finishOrder;
    idx.sort((a, b) => {
      const fa = fo.indexOf(a), fb = fo.indexOf(b);
      if (fa >= 0 || fb >= 0) {
        if (fa >= 0 && fb >= 0) return fa - fb;
        return fa >= 0 ? -1 : 1;
      }
      const d = cars[b].progress - cars[a].progress;
      return d !== 0 ? d : cars[a].id - cars[b].id;
    });
    for (let r = 0; r < idx.length; r++) cars[idx[r]].place = r + 1;
  }

  /** The player is done and the grace time is over: unfinished cars get estimated finish times (ordered by ETA). */
  private finalize(cars: CarState[], events: SimEvent[]): void {
    const L = this.track.length;
    const st = this.state;
    const rest: { i: number; eta: number }[] = [];
    for (let i = 0; i < this.n; i++) {
      if (cars[i].finished) continue;
      const remaining = Math.max(0, this.laps * L - this.unwrapped[i]);
      const v = Math.max(this.rate[i], 14);
      rest.push({ i, eta: st.time + remaining / v });
    }
    rest.sort((a, b) => a.eta - b.eta || cars[a.i].id - cars[b.i].id);
    let last = st.time;
    for (const r of rest) {
      const c = cars[r.i];
      last = Math.max(last, r.eta);
      c.finished = true;
      c.finishTime = last;
      this.finishOrder.push(r.i);
      c.place = this.finishOrder.length;
      events.push({ type: 'finish', carId: c.id, place: c.place, time: c.finishTime });
    }
    st.phase = 'finished';
    st.results = this.finishOrder.map((i) => ({
      carId: cars[i].id, place: cars[i].place, time: cars[i].finishTime, bestLap: cars[i].bestLapTime,
    }));
  }
}
