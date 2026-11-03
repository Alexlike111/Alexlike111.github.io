// Race rules: countdown, progress along the spline, laps, finish, places. PURE (works on CarState objects).
// Progress is an "unwrapped" distance: it grows continuously along the track, so a lap is counted only when the car
// really covered the whole lap forward (reversing over the line and coming back never counts twice, and a car cannot
// skip the lap by jumping backwards and forwards at the line).
import { CONFIG } from '../config';
import type { CarState, RaceState, SimEvent, TrackGeometry } from '../types';

function wrapDiff(d: number, L: number): number {
  d = d % L;
  if (d >= L / 2) d -= L; else if (d < -L / 2) d += L;
  return d;
}

export class RaceTracker {
  state: RaceState;
  /** Current track position s (0..length) of every car: use it as the hint for nearest() queries. */
  readonly hints: number[];
  /** Current lateral offset from the centre line of every car (+ = left). */
  readonly laterals: number[];
  /** Race time at which each car's current lap started. */
  readonly lapStart: number[];

  private readonly track: TrackGeometry;
  private readonly laps: number;
  private readonly n: number;
  private readonly unwrapped: number[];
  private readonly prevS: number[];
  private readonly lapsDone: number[];
  private readonly rate: number[];          // smoothed progress speed, m/s
  private readonly pendingS: number[];      // candidate of a rejected big jump
  private readonly pendingT: number[];
  private readonly finishOrder: number[] = [];
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
    this.unwrapped = new Array(carCount).fill(0);
    this.prevS = new Array(carCount).fill(0);
    this.lapsDone = new Array(carCount).fill(0);
    this.rate = new Array(carCount).fill(0);
    this.pendingS = new Array(carCount).fill(-1);
    this.pendingT = new Array(carCount).fill(0);
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

  private trackCars(cars: CarState[], dt: number, events: SimEvent[], racing: boolean): void {
    const L = this.track.length;
    const st = this.state;
    const P = CONFIG.race;
    for (let i = 0; i < this.n; i++) {
      const c = cars[i];
      if (c.finished) continue;
      const near = this.track.nearest(c.x, c.y, this.hints[i]);
      this.hints[i] = near.s;
      this.laterals[i] = near.lateral;
      let delta = wrapDiff(near.s - this.prevS[i], L);
      if (Math.abs(delta) > P.maxProgressJump) {
        // far / implausible jump: accept only when the new position stays stable for a while
        if (this.pendingS[i] >= 0 && Math.abs(wrapDiff(near.s - this.pendingS[i], L)) < 15) {
          this.pendingT[i] += dt;
          if (this.pendingT[i] >= P.jumpConfirmTime) { this.pendingS[i] = -1; this.pendingT[i] = 0; } else delta = 0;
        } else { this.pendingS[i] = near.s; this.pendingT[i] = 0; delta = 0; }
        if (delta === 0) { c.progress = this.unwrapped[i]; continue; }
      } else this.pendingS[i] = -1;
      this.prevS[i] = near.s;
      this.unwrapped[i] += delta;
      if (dt > 0 && Math.abs(delta) <= P.maxProgressJump) this.rate[i] += (delta / dt - this.rate[i]) * Math.min(1, dt * 0.6);
      c.progress = this.unwrapped[i];

      if (!racing) continue;
      // lap crossings (the unwrapped distance must really reach the next multiple of L)
      while (this.unwrapped[i] >= (this.lapsDone[i] + 1) * L && !c.finished) {
        const over = this.unwrapped[i] - (this.lapsDone[i] + 1) * L;
        const speed = dt > 0 && delta > 0 ? delta / dt : Math.max(Math.abs(c.speed), 1);
        const tCross = Math.min(st.time, Math.max(this.lapStart[i], st.time - over / Math.max(speed, 1)));
        this.lapsDone[i]++;
        c.lap = this.lapsDone[i];
        const lapTime = tCross - this.lapStart[i];
        this.lapStart[i] = tCross;
        c.lastLapTime = lapTime;
        if (c.bestLapTime === 0 || lapTime < c.bestLapTime) c.bestLapTime = lapTime;
        events.push({ type: 'lap', carId: c.id, lap: c.lap, lapTime });
        if (c.lap >= this.laps) {
          c.finished = true;
          c.finishTime = tCross;
          c.progress = this.laps * L;
          this.finishOrder.push(i);
          c.place = this.finishOrder.length;
          events.push({ type: 'finish', carId: c.id, place: c.place, time: tCross });
          if (c.isPlayer) st.playerFinished = true;
        }
      }
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
