// Crowd Jelly 2D: a side-scrolling crowd runner. The crowd is ONE number (up to 1,000,000); the screen
// shows at most ~64 little jellies drawn from it. Pick one of 3 lanes per row: gates, saws, squads, boss.
import { perfFrame } from './kit/perf';
import { LANES, MAX_CROWD, MIN_CROWD, applyBoss, applyCell, bestLane, buildLevel, compact, type Cell, type Level } from './levels';

export interface RunResult { win: boolean; level: number; start: number; end: number; rows: number; mistakes: number; maxed: boolean }
export interface CellInfo { kind: Cell['kind']; before: number; after: number; good: boolean }
export interface Hooks {
  onCell(i: CellInfo): void;
  onBoss(win: boolean): void;
  onEnd(r: RunResult): void;
}

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; hue: number; r: number }
interface Float { text: string; x: number; y: number; life: number; color: string }

const SPEED = 270; // design units per second
const SPACING = 520;
const LEAD = 760;
const INK = '#2a1f3d';
const FONT = '"GK Nunito", system-ui, sans-serif';

interface Theme { top: string; bottom: string; hill1: string; hill2: string; lane: string; lane2: string }
const THEME_LIST: Theme[] = [
  { top: '#7be0ff', bottom: '#d6f7c8', hill1: '#8fdc86', hill2: '#5fc576', lane: '#9be08f', lane2: '#8bd47f' },
  { top: '#ffd77a', bottom: '#fff0c4', hill1: '#f3b94a', hill2: '#e69a2e', lane: '#ffd36b', lane2: '#f6c453' },
  { top: '#ffb4de', bottom: '#e9d4ff', hill1: '#d79cf5', hill2: '#b57fe6', lane: '#f6b6e6', lane2: '#eca4dc' },
  { top: '#241a5e', bottom: '#5a3fa8', hill1: '#4d3a96', hill2: '#3b2c7c', lane: '#6a55c4', lane2: '#5e49b8' },
];
const JELLY_HUES = [340, 190, 48, 130, 280, 18];

/** How many little jellies to draw for a crowd. Exact up to 14, then slow growth. */
export function visibleCount(n: number): number {
  if (n <= 14) return Math.max(1, n);
  return Math.min(64, Math.round(14 + 8 * Math.log10(n / 14)));
}

export class Game {
  private ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private s = 1; // design-unit scale
  private running = false;
  private paused = true;
  private last = 0;
  private lv: Level | null = null;
  private themeIdx = 0;
  private wx = 0; // world distance travelled (design units)
  private nextRow = 0;
  private lane = 1;
  private vy = 1; // displayed lane (float)
  private phase: 'run' | 'boss' | 'done' = 'run';
  private doneT = 0;
  private startCrowd = 0;
  private mistakes = 0;
  private particles: Particle[] = [];
  private floats: Float[] = [];
  private shake = 0;
  private flash = 0;
  private bossHit: boolean | null = null;
  crowd = MIN_CROWD;
  shown = MIN_CROWD; // count that eases toward `crowd`

  constructor(private canvas: HTMLCanvasElement, private hooks: Hooks) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    canvas.addEventListener('pointermove', (e) => this.track(e));
    requestAnimationFrame((t) => this.frame(t));
  }

  private resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.w = r.width;
    this.h = r.height;
    this.s = Math.max(0.42, Math.min(this.laneH() / 137, this.w / 760, 2.4));
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private laneH(): number { return this.h * 0.19; }
  private laneTop(): number { return this.h * 0.34; }
  private laneY(i: number): number { return this.laneTop() + this.laneH() * (i + 0.5); }
  private crowdX(): number { return this.w * 0.2; }
  private rowX(i: number): number { return this.crowdX() + (LEAD + i * SPACING - this.wx) * this.s; }
  private bossWx(): number { return LEAD + (this.lv?.rows.length ?? 0) * SPACING + 120; }

  private track(e: PointerEvent): void {
    if (!this.running || this.paused || this.phase !== 'run') return;
    const r = this.canvas.getBoundingClientRect();
    this.pointerLane(e.clientY - r.top);
  }

  private pointerLane(y: number): void {
    this.lane = Math.max(0, Math.min(LANES - 1, Math.floor((y - this.laneTop()) / this.laneH())));
  }

  // ---- control surface for main.ts
  start(level: number, crowd: number): void {
    this.lv = buildLevel(level, crowd);
    this.themeIdx = this.lv.theme;
    this.crowd = this.shown = this.startCrowd = Math.max(MIN_CROWD, Math.min(MAX_CROWD, Math.floor(crowd)));
    this.wx = 0;
    this.nextRow = 0;
    this.lane = this.vy = 1;
    this.phase = 'run';
    this.mistakes = 0;
    this.particles = [];
    this.floats = [];
    this.bossHit = null;
    this.running = true;
    this.paused = false;
    this.last = 0;
  }
  get isRunning(): boolean { return this.running; }
  get isPaused(): boolean { return this.paused; }
  get currentLane(): number { return this.lane; }
  get level(): Level | null { return this.lv; }
  get progress(): number {
    if (!this.lv) return 0;
    return Math.max(0, Math.min(1, this.wx / this.bossWx()));
  }
  pause(): void { this.paused = true; }
  resume(): void { if (this.running) { this.paused = false; this.last = 0; } }
  /** Back to the idle backdrop (menu). */
  stop(): void { this.running = false; this.paused = true; this.lv = null; }
  setIdle(theme: number, crowd: number): void {
    if (this.running) return;
    this.themeIdx = theme % THEME_LIST.length;
    this.crowd = this.shown = crowd;
  }

  moveLane(d: number): void {
    if (this.running && !this.paused && this.phase === 'run') this.lane = Math.max(0, Math.min(LANES - 1, this.lane + d));
  }
  setLane(l: number): void {
    if (this.running && !this.paused && this.phase === 'run') this.lane = Math.max(0, Math.min(LANES - 1, l));
  }
  /** Mouse click or tap in canvas pixels: pick the lane under it. */
  pointer(_x: number, y: number): boolean {
    if (!this.running || this.paused || this.phase !== 'run') return false;
    this.pointerLane(y);
    return true;
  }

  /** QA: best lane for the next row, and a way to end the run at once. */
  qaNext(): { lane: number; best: number; kinds: string[] } | null {
    if (!this.lv || this.nextRow >= this.lv.rows.length) return null;
    const row = this.lv.rows[this.nextRow];
    return { lane: this.lane, best: bestLane(this.crowd, row), kinds: row.cells.map((c) => `${c.kind}:${c.v}`) };
  }
  qaFinish(win: boolean): void {
    if (!this.lv || this.phase !== 'run') return;
    this.nextRow = this.lv.rows.length;
    this.wx = this.bossWx() - 40;
    this.crowd = win ? Math.max(this.crowd, this.lv.boss * 2 + 5) : 1;
    this.shown = this.crowd;
  }
  qaSetCrowd(n: number): void { this.crowd = this.shown = n; }

  render(): void { this.draw(performance.now() / 1000); }

  // ---- loop
  private frame(now: number): void {
    requestAnimationFrame((t) => this.frame(t));
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0;
    this.last = now;
    if (this.running && !this.paused) {
      this.step(dt);
      perfFrame(dt * 1000, now);
    } else {
      this.last = 0;
    }
    this.draw(now / 1000);
  }

  private step(dt: number): void {
    const lv = this.lv;
    if (!lv) return;
    this.vy += (this.lane - this.vy) * Math.min(1, dt * 13);
    this.shown += (this.crowd - this.shown) * Math.min(1, dt * 9);
    if (Math.abs(this.crowd - this.shown) < 1) this.shown = this.crowd;
    this.shake = Math.max(0, this.shake - dt * 3);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    for (const p of this.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 520 * this.s * dt; p.life -= dt; }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const f of this.floats) { f.y -= 46 * this.s * dt; f.life -= dt; }
    this.floats = this.floats.filter((f) => f.life > 0);

    if (this.phase === 'done') {
      this.doneT -= dt;
      this.wx += SPEED * 0.25 * dt;
      if (this.doneT <= 0) {
        this.running = false;
        const win = this.bossHit === true;
        const maxed = win && lv.index === 11;
        this.hooks.onEnd({ win, level: lv.index, start: this.startCrowd, end: win ? (maxed ? MAX_CROWD : this.crowd) : 0, rows: lv.rows.length, mistakes: this.mistakes, maxed });
      }
      return;
    }

    this.wx += SPEED * dt;
    // rows are resolved when their centre reaches the crowd
    while (this.nextRow < lv.rows.length && LEAD + this.nextRow * SPACING <= this.wx) {
      const row = lv.rows[this.nextRow];
      const cell = row.cells[this.lane];
      const before = this.crowd;
      const best = applyCell(before, row.cells[bestLane(before, row)]);
      const o = applyCell(before, cell);
      if (!o.dead && o.crowd < best.crowd * 0.999) this.mistakes++;
      this.nextRow++;
      this.hitCell(cell, before, o.crowd, o.dead);
      if (o.dead) { this.finish(false); return; }
      this.crowd = o.crowd;
    }
    if (this.phase === 'run' && this.wx >= this.bossWx()) {
      const b = applyBoss(this.crowd, lv.boss);
      this.phase = 'boss';
      this.hooks.onBoss(!b.dead);
      this.shake = 1;
      this.burst(this.crowdX() + (this.bossWx() - this.wx) * this.s, this.h * 0.55, 70, b.dead ? 0 : 50);
      this.finish(!b.dead, b.crowd);
    }
  }

  private finish(win: boolean, after?: number): void {
    this.bossHit = win;
    if (win && after !== undefined) this.crowd = after;
    if (!win) { this.scatter(); this.crowd = 0; this.shown = 0; }
    this.phase = 'done';
    this.doneT = win ? 1.3 : 1.0;
  }

  private hitCell(c: Cell, before: number, after: number, dead: boolean): void {
    const good = after >= before && !dead;
    const x = this.crowdX() + 30 * this.s;
    const y = this.laneY(this.lane) - 70 * this.s;
    const d = after - before;
    const text = dead ? '!' : c.kind === 'mul' ? `×${c.v}` : c.kind === 'div' ? `÷${c.v}` : d >= 0 ? `+${compact(d)}` : `−${compact(-d)}`;
    if (c.kind !== 'empty') this.floats.push({ text, x, y, life: 0.9, color: good ? '#5dffc0' : '#ff7a7a' });
    if (good && c.kind !== 'empty') this.burst(this.crowdX(), this.laneY(this.lane), 12, JELLY_HUES[this.nextRow % JELLY_HUES.length]);
    if (!good) { this.shake = Math.max(this.shake, 0.4); this.flash = 0.4; this.scatterSome(); }
    if (c.kind !== 'empty') this.hooks.onCell({ kind: c.kind, before, after, good });
  }

  private burst(x: number, y: number, n: number, hue: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (80 + Math.random() * 240) * this.s;
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120 * this.s, life: 0.5 + Math.random() * 0.4, max: 0.9, hue: hue || Math.random() * 360, r: (3 + Math.random() * 4) * this.s });
    }
  }
  private scatterSome(): void { this.burst(this.crowdX() + 20 * this.s, this.laneY(this.lane), 10, 0); }
  private scatter(): void { this.burst(this.crowdX(), this.laneY(this.lane), 36, 0); }

  // ---------------------------------------------------------------- drawing
  private draw(t: number): void {
    const c = this.ctx;
    const th = THEME_LIST[this.themeIdx % THEME_LIST.length];
    const sx = this.shake > 0 ? (Math.random() - 0.5) * 10 * this.shake * this.s : 0;
    const sy = this.shake > 0 ? (Math.random() - 0.5) * 8 * this.shake * this.s : 0;
    c.save();
    c.translate(sx, sy);
    const g = c.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, th.top);
    g.addColorStop(0.5, th.bottom);
    g.addColorStop(1, th.hill1);
    c.fillStyle = g;
    c.fillRect(-20, -20, this.w + 40, this.h + 40);
    const dist = this.running ? this.wx : t * 90;
    this.drawSky(c, th, dist);
    this.drawTrack(c, th, dist);
    if (this.lv && this.running) {
      for (let i = 0; i < this.lv.rows.length; i++) {
        const x = this.rowX(i);
        if (x < -200 * this.s || x > this.w + 200 * this.s) continue;
        this.drawRow(c, i, x, i < this.nextRow, t);
      }
      this.drawBoss(c, t);
    }
    this.drawCrowd(c, t);
    for (const p of this.particles) {
      c.globalAlpha = Math.max(0, p.life / p.max);
      c.fillStyle = `hsl(${p.hue} 90% 62%)`;
      c.beginPath();
      c.arc(p.x, p.y, p.r, 0, 7);
      c.fill();
    }
    c.globalAlpha = 1;
    for (const f of this.floats) {
      c.globalAlpha = Math.min(1, f.life * 2);
      this.label(c, f.text, f.x, f.y, 30 * this.s, f.color);
    }
    c.globalAlpha = 1;
    if (this.flash > 0) { c.fillStyle = `rgba(255,70,70,${this.flash * 0.25})`; c.fillRect(-20, -20, this.w + 40, this.h + 40); }
    c.restore();
    if (this.running) this.drawProgress(c);
  }

  private drawSky(c: CanvasRenderingContext2D, th: Theme, dist: number): void {
    const s = this.s;
    if (this.themeIdx === 3) {
      c.fillStyle = 'rgba(255,255,255,.8)';
      for (let i = 0; i < 40; i++) {
        const x = (((i * 977 - dist * 0.05 * s) % (this.w + 40)) + this.w + 40) % (this.w + 40);
        const y = (i * 131) % (this.laneTop() * 0.95);
        c.fillRect(x, y, 2 * s + (i % 3), 2 * s + (i % 3));
      }
    } else {
      c.fillStyle = 'rgba(255,255,255,.75)';
      const span = this.w + 300 * s;
      for (let i = 0; i < 6; i++) {
        const x = ((((i * 330 - dist * 0.12) * s) % span) + span) % span - 150 * s;
        const y = this.h * (0.06 + (i % 3) * 0.07);
        c.beginPath();
        c.ellipse(x, y, 60 * s, 20 * s, 0, 0, 7);
        c.ellipse(x + 38 * s, y + 6 * s, 44 * s, 16 * s, 0, 0, 7);
        c.ellipse(x - 36 * s, y + 8 * s, 40 * s, 14 * s, 0, 0, 7);
        c.fill();
      }
    }
    const layers: [string, number, number, number, number][] = [[th.hill2, 0.006, 26, 0.3, 0.2], [th.hill1, 0.009, 34, 0.34, 0.45]];
    for (const [col, k, amp, base, par] of layers) {
      c.fillStyle = col;
      c.beginPath();
      c.moveTo(0, this.h);
      for (let x = 0; x <= this.w + 8; x += 8) {
        const q = (x / s + dist * par) * k;
        c.lineTo(x, this.h * base - amp * s * Math.sin(q) - amp * 0.5 * s * Math.sin(q * 2.3));
      }
      c.lineTo(this.w, this.h);
      c.fill();
    }
  }

  private drawTrack(c: CanvasRenderingContext2D, th: Theme, dist: number): void {
    const top = this.laneTop();
    const lh = this.laneH();
    c.fillStyle = INK;
    c.globalAlpha = 0.22;
    c.fillRect(0, top - 6 * this.s, this.w, lh * LANES + 12 * this.s);
    c.globalAlpha = 1;
    for (let i = 0; i < LANES; i++) {
      c.fillStyle = i % 2 ? th.lane2 : th.lane;
      c.fillRect(0, top + i * lh + 2, this.w, lh - 4);
    }
    c.strokeStyle = 'rgba(255,255,255,.55)';
    c.lineWidth = 3 * this.s;
    c.setLineDash([26 * this.s, 22 * this.s]);
    c.lineDashOffset = (dist * this.s) % (48 * this.s);
    for (let i = 1; i < LANES; i++) {
      c.beginPath();
      c.moveTo(0, top + i * lh);
      c.lineTo(this.w, top + i * lh);
      c.stroke();
    }
    c.setLineDash([]);
  }

  private drawRow(c: CanvasRenderingContext2D, i: number, x: number, passed: boolean, t: number): void {
    const row = this.lv!.rows[i];
    c.globalAlpha = passed ? 0.18 : 1;
    for (let l = 0; l < LANES; l++) this.drawCell(c, row.cells[l], x, this.laneY(l), t, !passed && l === this.lane && x - this.crowdX() < 520 * this.s);
    c.globalAlpha = 1;
  }

  private drawCell(c: CanvasRenderingContext2D, cell: Cell, x: number, y: number, t: number, hot: boolean): void {
    const s = this.s;
    const lh = this.laneH();
    if (cell.kind === 'empty') return;
    if (cell.kind === 'enemy') { this.drawSquad(c, cell.v, x, y, t); return; }
    if (cell.kind === 'saw') {
      const r = lh * 0.34;
      c.save();
      c.translate(x, y);
      c.rotate(t * 7);
      c.fillStyle = '#c9d2e0';
      c.strokeStyle = INK;
      c.lineWidth = 3 * s;
      c.beginPath();
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const rr = k % 2 ? r * 0.82 : r;
        c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      c.closePath();
      c.fill();
      c.stroke();
      c.fillStyle = '#7d8aa3';
      c.beginPath();
      c.arc(0, 0, r * 0.3, 0, 7);
      c.fill();
      c.restore();
      this.label(c, `−${Math.round(cell.v * 100)}%`, x, y - r - 12 * s, 24 * s, '#ffd0d0');
      return;
    }
    const hue = cell.kind === 'mul' ? ['#7a5cff', '#4f2fd1'] : cell.kind === 'add' ? ['#3fe0a8', '#1fa97a'] : cell.kind === 'div' ? ['#ffa23c', '#d9701a'] : ['#ff6d6d', '#cc3a3a'];
    const gw = 118 * s;
    const gh = lh * 0.82;
    const bob = Math.sin(t * 4 + x * 0.01) * 2 * s;
    c.save();
    c.translate(x, y + bob);
    c.fillStyle = hue[0];
    c.strokeStyle = INK;
    c.lineWidth = 4 * s;
    this.rr(c, -gw / 2, -gh / 2, gw, gh, 22 * s);
    c.fill();
    c.stroke();
    c.fillStyle = hue[1];
    this.rr(c, -gw / 2 + 4 * s, gh / 2 - 22 * s, gw - 8 * s, 18 * s, 10 * s);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,.4)';
    this.rr(c, -gw / 2 + 10 * s, -gh / 2 + 8 * s, gw - 20 * s, 14 * s, 7 * s);
    c.fill();
    if (hot) { c.strokeStyle = '#fff'; c.lineWidth = 3 * s; this.rr(c, -gw / 2 - 5 * s, -gh / 2 - 5 * s, gw + 10 * s, gh + 10 * s, 26 * s); c.stroke(); }
    c.restore();
    const txt = cell.kind === 'mul' ? `×${cell.v}` : cell.kind === 'div' ? `÷${cell.v}` : cell.kind === 'add' ? `+${compact(cell.v)}` : `−${compact(cell.v)}`;
    this.label(c, txt, x, y + bob, (txt.length > 5 ? 28 : 38) * s, '#fff');
  }

  private drawSquad(c: CanvasRenderingContext2D, n: number, x: number, y: number, t: number): void {
    const m = visibleCount(n);
    this.cluster(c, x, y, m, t, 0, 1.15, true);
    this.pill(c, compact(n), x, y - this.clusterR(m) * 1.15 * this.s - 12 * this.s, '#ff5a5a');
  }

  private drawBoss(c: CanvasRenderingContext2D, t: number): void {
    const lv = this.lv!;
    const x = this.crowdX() + (this.bossWx() - this.wx) * this.s;
    if (x > this.w + 300 * this.s) return;
    if (this.phase !== 'run' && this.bossHit === true) return;
    const s = this.s;
    const y = this.laneTop() + this.laneH() * 1.5;
    const R = this.laneH() * 1.25;
    c.save();
    c.translate(x + R * 0.1, y);
    c.fillStyle = '#9b5cff';
    c.strokeStyle = INK;
    c.lineWidth = 6 * s;
    c.beginPath();
    c.ellipse(0, 0, R * 0.78, R * 0.92 + Math.sin(t * 3) * 4 * s, 0, 0, 7);
    c.fill();
    c.stroke();
    c.fillStyle = 'rgba(255,255,255,.35)';
    c.beginPath();
    c.ellipse(-R * 0.3, -R * 0.45, R * 0.18, R * 0.1, -0.5, 0, 7);
    c.fill();
    for (const ex of [-1, 1]) {
      c.fillStyle = '#fff'; c.strokeStyle = INK; c.lineWidth = 4 * s;
      c.beginPath(); c.ellipse(ex * R * 0.28, -R * 0.12, R * 0.17, R * 0.2, 0, 0, 7); c.fill(); c.stroke();
      c.fillStyle = INK;
      c.beginPath(); c.arc(ex * R * 0.24, -R * 0.08, R * 0.08, 0, 7); c.fill();
      c.strokeStyle = INK; c.lineWidth = 6 * s;
      c.beginPath(); c.moveTo(ex * R * 0.45, -R * 0.42); c.lineTo(ex * R * 0.1, -R * 0.33); c.stroke();
    }
    c.fillStyle = INK;
    c.beginPath(); c.ellipse(0, R * 0.32, R * 0.22, R * 0.1, 0, 0, 7); c.fill();
    c.fillStyle = '#ffd23c'; c.strokeStyle = INK; c.lineWidth = 4 * s;
    c.beginPath();
    c.moveTo(-R * 0.34, -R * 0.82); c.lineTo(-R * 0.34, -R * 1.08); c.lineTo(-R * 0.16, -R * 0.94); c.lineTo(0, -R * 1.14); c.lineTo(R * 0.16, -R * 0.94); c.lineTo(R * 0.34, -R * 1.08); c.lineTo(R * 0.34, -R * 0.82);
    c.closePath(); c.fill(); c.stroke();
    c.restore();
    this.pill(c, compact(lv.boss), x + R * 0.1, y + R * 0.98, '#ff5a5a');
  }

  private clusterR(m: number): number { return 8 * Math.sqrt(m) + 14; }

  /** Draw m jellies in a sunflower pattern around (x, y). */
  private cluster(c: CanvasRenderingContext2D, x: number, y: number, m: number, t: number, hueShift: number, scale: number, angry: boolean): void {
    const s = this.s * scale;
    const spacing = Math.min(15, 150 / Math.sqrt(m) + 6.5) * s;
    const r = Math.min(13, 100 / Math.sqrt(m) + 6) * s;
    for (let i = m - 1; i >= 0; i--) {
      const a = i * 2.39996;
      const d = Math.sqrt(i + 0.5) * spacing * 0.78;
      const px = x + Math.cos(a) * d * 1.05;
      const hop = Math.abs(Math.sin(t * 9 + i * 1.7)) * 4 * s;
      const py = y + Math.sin(a) * d * 0.9 - hop;
      this.jelly(c, px, py, r, JELLY_HUES[(i + hueShift) % JELLY_HUES.length], angry, i);
    }
  }

  private jelly(c: CanvasRenderingContext2D, x: number, y: number, r: number, hue: number, angry: boolean, i: number): void {
    c.fillStyle = angry ? '#ff6666' : `hsl(${hue} 95% 66%)`;
    c.strokeStyle = INK;
    c.lineWidth = Math.max(1.5, r * 0.18);
    c.beginPath();
    c.ellipse(x, y, r, r * 0.92, 0, 0, 7);
    c.fill();
    c.stroke();
    if (r < 5) return;
    c.fillStyle = 'rgba(255,255,255,.55)';
    c.beginPath();
    c.ellipse(x - r * 0.35, y - r * 0.4, r * 0.22, r * 0.12, -0.5, 0, 7);
    c.fill();
    c.fillStyle = '#fff';
    c.beginPath();
    c.arc(x - r * 0.3, y - r * 0.08, r * 0.24, 0, 7);
    c.arc(x + r * 0.3, y - r * 0.08, r * 0.24, 0, 7);
    c.fill();
    c.fillStyle = INK;
    c.beginPath();
    c.arc(x - r * 0.26 + (i % 2) * 0.01, y - r * 0.05, r * 0.11, 0, 7);
    c.arc(x + r * 0.34, y - r * 0.05, r * 0.11, 0, 7);
    c.fill();
    if (angry && r > 7) {
      c.strokeStyle = INK;
      c.lineWidth = Math.max(1.5, r * 0.14);
      c.beginPath();
      c.moveTo(x - r * 0.55, y - r * 0.42); c.lineTo(x - r * 0.1, y - r * 0.25);
      c.moveTo(x + r * 0.55, y - r * 0.42); c.lineTo(x + r * 0.1, y - r * 0.25);
      c.stroke();
    }
  }

  private drawCrowd(c: CanvasRenderingContext2D, t: number): void {
    if (this.phase === 'done' && this.bossHit === false) return;
    const x = this.crowdX();
    const n = Math.max(1, Math.round(this.shown));
    const m = visibleCount(n);
    const yy = this.running ? this.laneY(this.vy) : this.laneY(1) + Math.sin(t * 2) * 3;
    this.cluster(c, x, yy, m, t, 0, 1.3, false);
    const top = yy - this.clusterR(m) * 1.3 * this.s - 14 * this.s;
    this.pill(c, compact(n) + (n >= MAX_CROWD ? ' MAX' : ''), x, top, INK);
  }

  private drawProgress(c: CanvasRenderingContext2D): void {
    const w = Math.min(this.w * 0.5, 420 * this.s);
    const x = (this.w - w) / 2;
    const y = this.h * 0.17;
    const hh = 10 * this.s;
    c.fillStyle = 'rgba(42,31,61,.55)';
    this.rr(c, x - 3, y - 3, w + 6, hh + 6, hh);
    c.fill();
    c.fillStyle = '#ffd23c';
    this.rr(c, x, y, Math.max(hh, w * this.progress), hh, hh / 2);
    c.fill();
  }

  // ---- little helpers
  private rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  private label(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, fill: string): void {
    c.font = `900 ${size}px ${FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineJoin = 'round';
    c.lineWidth = Math.max(3, size * 0.2);
    c.strokeStyle = INK;
    c.strokeText(text, x, y);
    c.fillStyle = fill;
    c.fillText(text, x, y);
  }

  private pill(c: CanvasRenderingContext2D, text: string, x: number, y: number, bg: string): void {
    const size = 26 * this.s;
    c.font = `900 ${size}px ${FONT}`;
    const w = c.measureText(text).width + 22 * this.s;
    const h = size * 1.35;
    c.fillStyle = bg;
    c.strokeStyle = '#fff';
    c.lineWidth = 3 * this.s;
    this.rr(c, x - w / 2, y - h / 2, w, h, h / 2);
    c.fill();
    c.stroke();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#fff';
    c.fillText(text, x, y + 1);
  }
}
