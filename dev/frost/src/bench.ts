// In-game automatic benchmark: a deterministic sequence of scripted scenarios driven through the normal game loop
// (same tools / sim / render code paths as play). Per scenario: frame-time percentiles, jank count, per-subsystem ms/frame
// (prof.ts), GPU pass times (a short synced phase), probes (particles / bodies / awake chunks).
// Entry points: title card + pause menu button, `?bench` / `?bench=quick` in the URL, `__frost.bench({quick, only})` (Promise of the JSON).
import { M, mat, dens, bond, body as bodyGrid, awake, CH, CW, CHH, idx, inb, set, wake, surfaceAt, trees, START_X, groundY } from './world';
import { G, FORCE } from './state';
import { pl } from './player';
import { tool, inv, TOOLS } from './tools';
import { P, PK, PMAX, spawn } from './particles';
import { engine, setEngine, allBodies, spawnStressTest } from './phys';
import { markStruct } from './structure';
import { prof, pacc } from './prof';
import { el, ico } from './ui';
import type { UI } from './ui';
import type { Renderer } from './render';

// ------------------------------------------------------------------ types
export interface BenchHost {
  ui: UI; renderer: Renderer;
  newGame(seed: number): void;
  setLoop(running: boolean, paused: boolean): void;
  snapCam(): void;
  /** touch device held upright: the game loop waits, so does the benchmark clock */
  blocked(): boolean;
  setQuality(q: number): void;
  getViewport(): { w: number; h: number; dpr: number };
  setViewport(v: { w: number; h: number; dpr: number; mobile: boolean } | null): void;
  mute(on: boolean): void;
  noAdapt(on: boolean): void;
  mobile(): boolean;
  fps(): number;
  /** results card closed: fresh game + title */
  closed(): void;
}
export interface BenchOpts { source: 'title' | 'pause' | 'url' | 'api'; quick?: boolean; only?: string[] }

export interface ScnResult {
  id: string; name: string; group: string; note: string;
  skipped?: string;
  engine: string; quality: number; dyn: number; canvas: [number, number]; view: [number, number];
  frames: number; seconds: number;
  fps: number; p50: number; p95: number; p99: number; max: number; jank33: number; jank50: number;
  work: { avg: number; p95: number; max: number };
  /** ms per frame, every instrumented subsystem (children included) */
  sub: Record<string, number>;
  /** worst single call, ms */
  peak: Record<string, number>;
  /** frames >33 ms by the subsystem that dominated them ('gpu' = JS finished early: GPU / compositor bound) */
  jankBy: Record<string, number>;
  gpu: Record<string, number> | null;
  probes: { particles: [number, number]; bodies: [number, number]; awake: [number, number]; fires: number };
  /** what the script actually did (cells changed in the world + scenario-specific counters): proves the scenario ran */
  outcome: string;
  flag: 'ok' | 'warn' | 'bad';
  top: string[];
  /** the same ranking over CPU subsystems only (GPU passes excluded): the part a software renderer cannot distort */
  topCpu: string[];
  retried?: boolean;
}
export interface BenchResult {
  version: 1; build: string; date: string; quick: boolean; aborted: boolean; seconds: number;
  device: Record<string, string | number | boolean>;
  scenarios: ScnResult[];
  summary: { worst: string; worstP95: number; worstSub: string; worstSubMs: number; worstSubIn: string; cpuRank: [string, number, number, string][]; jankTotal: number; frames: number; hz: number; throttle: string };
}

// ------------------------------------------------------------------ labels
const SUB_LABEL: Record<string, string> = {
  weatherMain: 'Время и погода', tools: 'Инструменты', survival: 'Тело и камера', fires: 'Костры', player: 'Игрок: коллизии', heat: 'Тепло и ветер',
  weather: 'Снегопад и позёмка', ca: 'Снег-КА (осыпание)', slow: 'Уплотнение и спекание', particles: 'Частицы (CPU)', bodies: 'Тела (физика)', structure: 'Статика построек',
  audio: 'Звук', hud: 'HUD (DOM)', upload: 'Загрузка мира в GPU', cellSubmit: 'Рендер: клетки (CPU)', scrSubmit: 'Рендер: экран (CPU)', particleDraw: 'Рендер: частицы (CPU)',
  overlay: 'Оверлей 2D', other: 'Прочее (DOM, браузер)',
  gpuCell: 'GPU: проход клеток', gpuScr: 'GPU: экранный проход', gpuPart: 'GPU: частицы',
  hCompose: 'сборка поля', hWind: 'ветер', hPhase: 'фазы / таяние', hCond: 'теплопроводность', bColl: 'коллайдеры', bStep: 'шаг движка', bSync: 'синхронизация', bStamp: 'штамп в сетку',
};
const CHILDREN: Record<string, string[]> = { heat: ['hCompose', 'hWind', 'hPhase', 'hCond'], bodies: ['bColl', 'bStep', 'bSync', 'bStamp'] };
const TOP = ['weatherMain', 'tools', 'survival', 'fires', 'player', 'heat', 'weather', 'ca', 'slow', 'particles', 'bodies', 'structure', 'audio', 'hud', 'upload', 'cellSubmit', 'scrSubmit', 'particleDraw', 'overlay'];
const GPU_KEYS = ['gpuCell', 'gpuScr', 'gpuPart'];
const GPU_OF: Record<string, string> = { cellSubmit: 'gpuCell', scrSubmit: 'gpuScr', particleDraw: 'gpuPart' };
const ALL_KEYS = [...TOP, ...GPU_KEYS, ...Object.values(CHILDREN).flat()];
const label = (k: string) => SUB_LABEL[k] ?? k;

// thresholds (ms): a 5 % tolerance on the vsync interval for timer jitter
const T_OK = 17.5, T_WARN = 33.8;
const flagOf = (p95: number): 'ok' | 'warn' | 'bad' => (p95 <= T_OK ? 'ok' : p95 <= T_WARN ? 'warn' : 'bad');

// ------------------------------------------------------------------ small helpers
function mulberry(a: number) { return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pct = (sorted: ArrayLike<number>, q: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const T = (d: number, h: number) => (d - 1) * 1440 + h * 60;
const tidx = (id: string) => TOOLS.findIndex((t) => t.id === id);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Synthetic input: same shape as input.ts InputState, plus the world-space aim the scripts steer. */
export interface BenchIn {
  moveX: number; jump: boolean; run: boolean; aimX: number; aimY: number; hasAim: boolean; aim: [number, number] | null;
  primary: boolean; secondaryPressed: boolean; interactPressed: boolean; eatPressed: boolean; waitHeld: boolean; firePressed: boolean;
  rotatePressed: boolean; xrayPressed: boolean; pausePressed: boolean; toolSelect: number;
}
const newInput = (): BenchIn => ({ moveX: 0, jump: false, run: false, aimX: 0, aimY: 0, hasAim: false, aim: null, primary: false, secondaryPressed: false, interactPressed: false, eatPressed: false, waitHeld: false, firePressed: false, rotatePressed: false, xrayPressed: false, pausePressed: false, toolSelect: -1 });

// ------------------------------------------------------------------ scenarios
interface Kit {
  bi: BenchIn; host: BenchHost; rnd: () => number; data: Record<string, number | number[] | undefined>;
  stand(x: number): void; useTool(id: string): void; pressTool(id: string): void; aim(x: number, y: number): void; clock(min: number): void;
}
interface Scn {
  id: string; name: string; group: string; note: string;
  fresh?: boolean; mode?: 'title' | 'pause'; engine?: 'rapier' | 'planck';
  quality?: 0 | 1; dyn?: 'min' | 1; view?: 'phone' | 'desktop';
  force?: Partial<typeof FORCE>;
  setup?(k: Kit): void;
  tick?(k: Kit, t: number, tm: number): void;
  teardown?(k: Kit): void;
  /** short Russian summary of what the script achieved, for the report */
  outcome?(k: Kit): string;
}

/** window of `span` cells holding the most trees: [start x, count] */
function densestForest(span: number): [number, number] {
  const xs = trees.map((t) => t.x).sort((a, b) => a - b);
  let best = 0, bx = xs[0] ?? 900, j = 0;
  for (let i = 0; i < xs.length; i++) { while (xs[i] - xs[j] > span) j++; if (i - j + 1 > best) { best = i - j + 1; bx = xs[j]; } }
  return [Math.max(80, bx - 30), best];
}
/** crest of the big lee drift (the dugout site): column with the highest snow above the original ground */
function driftCrest(): number {
  let bx = START_X + 190, bh = -1;
  for (let x = START_X + 90; x < START_X + 300; x++) { const h = groundY[x] - surfaceAt(x); if (h > bh) { bh = h; bx = x; } }
  return bx;
}
const free = (x: number, y: number) => inb(x, y) && mat[idx(x, y)] === M.AIR;
function spawnMix(n: number, cx: number, cy: number, vw: number, vh: number, rnd: () => number) {
  for (let i = 0; i < n; i++) {
    const x = cx + (rnd() - 0.5) * vw, y = cy + (rnd() - 0.5) * vh, r = rnd();
    if (r < 0.34) spawn(PK.FLAKE, x, y, (rnd() - 0.5) * 20, 14 + rnd() * 14, 8 + rnd() * 6, 0, 0, 1 + ((rnd() * 2) | 0));
    else if (r < 0.58) spawn(PK.DUST, x, y, (rnd() - 0.5) * 60, -rnd() * 40, 3 + rnd() * 4, 1 + rnd(), 0, 0);
    else if (r < 0.72) spawn(PK.SMOKE, x, y, (rnd() - 0.5) * 8, -14, 6 + rnd() * 3, 1 + rnd(), 0, 0);
    else if (r < 0.82) spawn(PK.STEAM, x, y, (rnd() - 0.5) * 8, -14, 5 + rnd() * 3, 1 + rnd(), 0, 0);
    else if (r < 0.92) spawn(PK.SPARK, x, y, (rnd() - 0.5) * 30, -20 - rnd() * 30, 2 + rnd() * 2, 1.5, 0, 0);
    else spawn(PK.FLAME, x, y, (rnd() - 0.5) * 10, -30 - rnd() * 20, 1.5 + rnd(), 2, 0, 0);
  }
}
function addFire(x: number, k: Kit) {
  const y = surfaceAt(x);
  G.fires.push({ x, y, fuel: 400, power: 0, lit: true, id: 100 + G.fires.length });
  void k;
}
function loadShovel() { tool.load = 46; tool.loadDens = 240; }

const SCENARIOS: Scn[] = [
  // ---------------- overlays
  { id: 'title', name: 'Титульный экран (блюр поверх мира)', group: 'Оверлеи', note: 'карточка «Белая Мгла» с backdrop-filter поверх живого мира; симуляция стоит',
    mode: 'title', setup: (k) => { k.clock(12 * 60); k.stand(START_X); } },
  { id: 'pause', name: 'Меню паузы (блюр 6 px)', group: 'Оверлеи', note: 'пауза: мир не считается, рисуется под размытием',
    mode: 'pause', fresh: false, setup: (k) => { k.clock(12 * 60); } },
  // ---------------- baseline + weather
  { id: 'idle', name: 'Покой, ясно, снег минимальный', group: 'База', note: 'герой стоит, снегопад выключен (остаётся лишь декоративная пороша): чистая цена кадра',
    force: { snowfall: 0, storm: 0, wind: 3 }, setup: (k) => { k.clock(12 * 60); k.stand(START_X); } },
  { id: 'snow_light', name: 'Лёгкий снегопад', group: 'Погода', note: 'естественный снегопад по модели погоды',
    setup: (k) => { k.clock(12 * 60); k.stand(START_X); } },
  { id: 'snow_heavy', name: 'Сильный снегопад (без бури)', group: 'Погода', note: 'снегопад 0,12 м/ч, ветер 6 м/с: максимум хлопьев и осаждения',
    force: { snowfall: 0.12, storm: 0, wind: 6 }, setup: (k) => { k.clock(12 * 60); k.stand(START_X); } },
  { id: 'storm_day', name: 'Буря днём (ветер, позёмка, сугробы)', group: 'Погода', note: 'буря 1,0: позёмка, сальтация, шейдер бури',
    force: { storm: 1 }, setup: (k) => { k.clock(T(3, 14)); k.stand(START_X); } },
  { id: 'storm_night', name: 'Буря ночью', group: 'Погода', note: 'буря + ночной шейдер, туман',
    force: { storm: 1 }, setup: (k) => { k.clock(T(2, 23)); k.stand(START_X); } },
  // ---------------- movement
  { id: 'walk', outcome: (k) => `прошёл ${Math.round(pl.x - 260)} кл.`, name: 'Ходьба и бег по равнине', group: 'Движение', note: 'идти, бежать, прыгать на восток: камера, догрузка чанков мира',
    setup: (k) => { k.clock(12 * 60); k.stand(260); },
    tick: (k, t) => { const b = k.bi; b.moveX = 1; b.run = t > 1.2 && t < 4.2; b.jump = Math.sin(t * 2.3) > 0.94; } },
  { id: 'forest', outcome: (k) => `прошёл ${Math.round(pl.x - (k.data.x0 as number))} кл., ёлок в окне ${k.data.n}`, name: 'Пролёт камеры над густым лесом', group: 'Движение', note: 'бег через самый плотный участок ёлок',
    setup: (k) => { const [x, n] = densestForest(520); k.data.n = n; k.data.x0 = x; k.clock(12 * 60); k.stand(x); },
    tick: (k, t) => { const b = k.bi; b.moveX = 1; b.run = t > 0.4; b.jump = Math.sin(t * 2.7) > 0.95; } },
  // ---------------- granular snow
  { id: 'dig_shaft', outcome: (k) => `глубина шахты ${Math.round(pl.y - (k.data.y0 as number))} кл., выбросов ${tool.ins + tool.outs}`, name: 'Копание шахты (КА + выброс снега)', group: 'Снег', note: 'лопата вниз без перерыва: клеточный автомат, авто-бросок, планировщик отвала',
    setup: (k) => { k.clock(12 * 60); k.stand(START_X + 40); k.data.y0 = pl.y; k.useTool('shovel'); },
    tick: (k) => { k.bi.primary = true; k.aim(pl.x, pl.y + 8); } },
  { id: 'dig_tunnel', outcome: (k) => `проход ${Math.round(pl.x - (k.data.x0 as number))} кл., выбросов по BFS ${tool.outs}, внутрь ${tool.ins}`, name: 'Копание тоннеля в сугробе', group: 'Снег', note: 'лопата горизонтально в наветренный склон большого сугроба: ползком, спойл по BFS',
    setup: (k) => {
      k.clock(12 * 60);
      const c = driftCrest(); let x = c - 70; while (x < c && groundY[x] - surfaceAt(x) < 34) x++;
      k.data.x = x; k.stand(x - 14); k.data.x0 = pl.x; k.useTool('shovel');
    },
    tick: (k) => { const b = k.bi; b.primary = true; b.moveX = 0.6; k.aim(pl.x + 16, pl.y - 10); } },
  { id: 'throw', outcome: (k) => `бросков ${Number(k.data.n ?? 0)}`, name: 'Бросок снега лопатой', group: 'Снег', note: 'полная лопата каждые 0,4 с: 46 комков в полёте, посадка и осаждение',
    setup: (k) => { k.clock(12 * 60); k.stand(START_X); k.useTool('shovel'); },
    tick: (k, t) => {
      const n = Math.floor(t / 0.4); if (k.data.n === n) return; k.data.n = n;
      loadShovel(); const s = n % 2 ? 1 : -1;
      k.aim(pl.x + s * (26 + (n % 4) * 7), pl.y - 26); k.bi.secondaryPressed = true;
    } },
  { id: 'collapse', outcome: (k) => `тел ${allBodies().size}`, name: 'Обрушение сугроба и лавина', group: 'Снег', note: 'подкоп большого сугроба: солвер статики, плиты-тела, осыпь клеточного автомата',
    setup: (k) => { k.clock(12 * 60); const c = driftCrest(); k.data.c = c; k.stand(c - 62); },
    tick: (k, t, tm) => {
      const c = k.data.c as number;
      const base = groundY[c], y1 = base - 1;
      const carve = (x0: number, x1: number, h: number) => {
        let n = 0;
        for (let x = x0; x <= x1; x++) for (let y = y1 - h; y <= y1; y++) if (inb(x, y) && mat[idx(x, y)] === M.SNOW && !bodyGrid[idx(x, y)]) { set(x, y, M.AIR); n++; }
        if (n) markStruct(x0 - 4, y1 - h - 4, x1 + 4, y1 + 4);
      };
      if (tm > -0.3 && !k.data.a) { k.data.a = 1; carve(c - 34, c - 6, 16); }
      if (tm > 0.9 && !k.data.b) { k.data.b = 1; carve(c - 6, c + 22, 22); }
      if (tm > 2.0 && !k.data.d) {
        k.data.d = 1;   // loosen the flank: sintered crust breaks, the slope runs
        for (let x = c - 40; x <= c + 10; x++) { const s = surfaceAt(x); for (let y = s; y < s + 26; y++) { const i = idx(x, y); if (mat[i] === M.SNOW && !bodyGrid[i]) { bond[i] = 0; dens[i] = Math.min(dens[i], 220); } } }
        markStruct(c - 44, surfaceAt(c) - 6, c + 14, groundY[c]);
        for (let x = c - 40; x <= c + 10; x += 8) { const s = surfaceAt(x); for (let y = s; y < s + 26; y += 6) wake(x, y); }
      }
      void t;
    } },
  // ---------------- building
  { id: 'saw_igloo', outcome: (k) => `блоков в руках ${inv.blocks.length}, кладка ${tool.built.has('snow') ? 'есть' : 'нет'}`, name: 'Пила: блоки и кладка иглу', group: 'Постройки', note: 'пилим наст сугроба, затем 8 блоков в кладку: пила, solver, markStruct',
    setup: (k) => { k.clock(12 * 60); const c = driftCrest(); k.data.c = c; k.stand(c - 4); k.useTool('saw'); for (let i = 0; i < 6; i++) inv.blocks.push(330); },
    tick: (k, t) => {
      const b = k.bi;
      if (t < 1.8) { k.useTool('saw'); b.primary = true; k.aim(pl.x + 12, pl.y + 9); return; }
      b.primary = false;
      const n = Math.floor((t - 1.8) / 0.34); if (k.data.n === n) return; k.data.n = n;
      if (n === 0) { k.useTool('block'); tool.rot = 0; }
      if (inv.blocks.length === 0) for (let i = 0; i < 4; i++) inv.blocks.push(330);
      const row = n % 3, course = Math.floor(n / 3);
      k.aim(pl.x - 18 + row * 12, pl.y - 2 - course * 5.5); b.secondaryPressed = true;
    } },
  { id: 'cabin', outcome: (k) => `брёвен потрачено ${40 - inv.logs}, постройка ${tool.built.has('wood') ? 'есть' : 'нет'}`, name: 'Сруб: брусья и статика', group: 'Постройки', note: 'стойки и крыша из брёвен, затем подрубаем опору: ПКМ-кладка, солвер, обрушение',
    setup: (k) => { k.clock(12 * 60); k.stand(START_X - 120); inv.logs = 40; k.useTool('beam'); },
    tick: (k, t) => {
      const b = k.bi;
      const n = Math.floor(t / 0.5); if (k.data.n === n) return; k.data.n = n;
      const x0 = Math.round(pl.x), g = surfaceAt(x0);
      const put = (rot: number, ax: number, ay: number) => { tool.rot = rot; k.aim(ax, ay); b.secondaryPressed = true; };
      switch (n) {
        case 0: k.useTool('beam'); put(3, x0 - 22, g - 20); break;     // left post, 2 m
        case 1: put(3, x0 + 16, g - 20); break;                        // right post
        case 2: put(1, x0 - 3, g - 42); break;                         // 2 m roof beam on top
        case 3: put(2, x0 - 22, g - 54); break;                        // second storey posts (1 m)
        case 4: put(2, x0 + 16, g - 54); break;
        case 5: put(1, x0 - 3, g - 64); break;
        case 6: put(0, x0 - 12, g - 72); break;
        case 7: put(0, x0 + 6, g - 72); break;
        case 8: {                                                       // knock out the right-hand post: the solver brings the roof down
          for (let y = g - 60; y <= g; y++) for (let x = x0 + 14; x <= x0 + 19; x++) if (inb(x, y) && mat[idx(x, y)] === M.PLANK) set(x, y, M.AIR);
          markStruct(x0 + 6, g - 80, x0 + 28, g + 2); break;
        }
        default: break;
      }
    } },
  { id: 'fell_trees', outcome: (k) => `брёвен ${inv.logs}, хвороста ${inv.branches}, тел ${allBodies().size}`, name: 'Валка деревьев (жёсткие тела)', group: 'Постройки', note: 'топор по трём елям подряд: падающие деревья — тела физики, ветки, хворост',
    setup: (k) => {
      const [x0] = densestForest(520);
      const list = trees.filter((t) => t.alive && t.x >= x0 && t.x <= x0 + 520).sort((a, b) => a.x - b.x).slice(0, 3);
      k.data.t = list.map((t) => t.x); k.data.tb = list.map((t) => t.base); k.data.tm = list.map((t) => t.height);
      k.clock(12 * 60); k.stand((list[0]?.x ?? x0) - 16); k.useTool('axe');
    },
    tick: (k, t) => {
      const xs = k.data.t as number[], bs = k.data.tb as number[];
      const i = Math.min(xs.length - 1, Math.floor(t / 1.9)); if (i < 0) return;
      if (k.data.i !== i) { k.data.i = i; k.stand(xs[i] - 14); k.useTool('axe'); }
      k.bi.primary = true; k.aim(xs[i], bs[i] - 7);
    } },
  // ---------------- fire & light
  { id: 'fire', outcome: (k) => `костров ${G.fires.length}, дров осталось ${inv.logs}`, name: 'Костёр: пламя, дым, пар, таяние', group: 'Огонь и свет', note: 'два костра у снежной стенки, подкидываем дрова: частицы огня, таяние, вода, пар',
    setup: (k) => { k.clock(12 * 60); k.stand(START_X); inv.logs = 8; inv.branches = 14; inv.matches = 8; k.useTool('fire'); },
    tick: (k, t) => {
      const b = k.bi, n = Math.floor(t / 1.2); if (k.data.n === n) return; k.data.n = n;
      if (n === 0) { k.aim(pl.x + 14, pl.y); b.firePressed = true; }
      else if (n === 1) { k.aim(pl.x - 14, pl.y); b.firePressed = true; }
      else b.interactPressed = true;
    } },
  { id: 'fire_wait', outcome: (k) => `костров ${G.fires.length}, игровое время +${Math.round(G.time - 720)} мин`, name: 'Ожидание у костра (время ×12)', group: 'Огонь и свет', note: 'костёр + ждать (T): теплопередача и таяние идут в 12 раз быстрее',
    setup: (k) => { k.clock(12 * 60); k.stand(START_X); inv.logs = 8; inv.branches = 14; inv.matches = 8; k.useTool('fire'); k.aim(pl.x + 10, pl.y); },
    tick: (k, t) => { const b = k.bi; if (t < 0.1) { k.aim(pl.x + 12, pl.y); b.firePressed = true; } b.waitHeld = t > 0.5; if (t > 0.5) { b.primary = false; b.moveX = 0; } } },
  { id: 'night_dark', name: 'Ночь без огней (звёзды, луна)', group: 'Огонь и свет', note: 'ночной шейдер: небо, луна, снег при лунном свете',
    force: { storm: 0 }, setup: (k) => { k.clock(T(2, 1)); k.stand(START_X); } },
  { id: 'night_fires', name: 'Ночь и четыре костра (динамический свет)', group: 'Огонь и свет', note: '4 костра в кадре: освещение клеток с источниками + пламя и искры',
    force: { storm: 0 }, setup: (k) => { k.clock(T(2, 1)); k.stand(START_X); for (const dx of [-70, -24, 28, 76]) addFire(START_X + dx, k); } },
  { id: 'xray', name: 'Рентген снега (плотность, спекание, температура)', group: 'Режимы', note: 'X ×3: по 1,5 с на режим; температурный режим перезаливает поле тепла',
    setup: (k) => { k.clock(12 * 60); k.stand(START_X + 40); k.useTool('shovel'); },
    tick: (k, t, tm) => {
      const b = k.bi;
      if (tm > -0.4 && !k.data.a) { k.data.a = 1; b.xrayPressed = true; }
      if (tm > 1.1 && !k.data.b) { k.data.b = 1; b.xrayPressed = true; }
      if (tm > 2.6 && !k.data.c) { k.data.c = 1; b.xrayPressed = true; }
      void t;
    },
    teardown: (k) => { G.xray = 0; (k.host.ui as unknown as { setXray?: (n: number) => void }).setXray?.(0); } },
  { id: 'particles', name: 'Насыщение частицами (24 000)', group: 'Нагрузка', note: 'буфер частиц добит до предела: шаг частиц CPU, выборка, отрисовка точек',
    setup: (k) => { k.clock(12 * 60); k.stand(START_X); },
    tick: (k) => { const c = G.cam; if (P.n < PMAX * 0.96) spawnMix(Math.min(2400, PMAX * 0.97 - P.n), c.x, c.y, c.vw, c.vh, k.rnd); } },
  // ---------------- rigid bodies, both engines
  { id: 'rigid_rapier', name: 'Жёсткие тела: Rapier (wasm), 40+30 тел', group: 'Физика тел', note: 'брёвна и снежные плиты падают в кадр; тот же сценарий на planck ниже',
    engine: 'rapier', setup: (k) => { k.clock(12 * 60); k.stand(START_X); },
    tick: (k, t, tm) => { if (tm > -0.05 && !k.data.a) { k.data.a = 1; k.data.m = spawnStressTest(40, pl.x, pl.y - 140); } if (tm > 2.4 && !k.data.b) { k.data.b = 1; spawnStressTest(30, pl.x + 20, pl.y - 140); } void t; } },
  { id: 'rigid_planck', name: 'Жёсткие тела: planck.js, 40+30 тел', group: 'Физика тел', note: 'то же, что выше, на planck.js',
    engine: 'planck', setup: (k) => { k.clock(12 * 60); k.stand(START_X); },
    tick: (k, t, tm) => { if (tm > -0.05 && !k.data.a) { k.data.a = 1; k.data.m = spawnStressTest(40, pl.x, pl.y - 140); } if (tm > 2.4 && !k.data.b) { k.data.b = 1; spawnStressTest(30, pl.x + 20, pl.y - 140); } void t; } },
  // ---------------- render cost matrix: night storm + two fires at each quality / resolution
  { id: 'rq0_d1', name: 'Рендер: качество 0, полное разрешение', group: 'Рендер', note: 'ночная буря + 2 костра: самый тяжёлый путь шейдеров',
    quality: 0, dyn: 1, force: { storm: 1 }, setup: (k) => { k.clock(T(2, 23)); k.stand(START_X); addFire(START_X - 22, k); addFire(START_X + 30, k); } },
  { id: 'rq1_d1', name: 'Рендер: качество 1, полное разрешение', group: 'Рендер', note: 'то же, высокое качество',
    quality: 1, dyn: 1, force: { storm: 1 }, setup: (k) => { k.clock(T(2, 23)); k.stand(START_X); addFire(START_X - 22, k); addFire(START_X + 30, k); } },
  { id: 'rq0_dmin', name: 'Рендер: качество 0, мин. динамическое разрешение', group: 'Рендер', note: 'то же, разрешение сцены на нижней границе адаптивного режима',
    quality: 0, dyn: 'min', force: { storm: 1 }, setup: (k) => { k.clock(T(2, 23)); k.stand(START_X); addFire(START_X - 22, k); addFire(START_X + 30, k); } },
  { id: 'rq1_dmin', name: 'Рендер: качество 1, мин. динамическое разрешение', group: 'Рендер', note: 'то же, высокое качество на нижней границе разрешения',
    quality: 1, dyn: 'min', force: { storm: 1 }, setup: (k) => { k.clock(T(2, 23)); k.stand(START_X); addFire(START_X - 22, k); addFire(START_X + 30, k); } },
  { id: 'view_phone', name: 'Рендер: окно телефона 844×390 (качество 0)', group: 'Рендер', note: 'то же, но канвас размером как на телефоне в ландшафте',
    quality: 0, dyn: 1, view: 'phone', force: { storm: 1 }, setup: (k) => { k.clock(T(2, 23)); k.stand(START_X); addFire(START_X - 22, k); addFire(START_X + 30, k); } },
  { id: 'view_desktop', name: 'Рендер: окно 1280×720 (качество 1)', group: 'Рендер', note: 'то же, но канвас как на ПК',
    quality: 1, dyn: 1, view: 'desktop', force: { storm: 1 }, setup: (k) => { k.clock(T(2, 23)); k.stand(START_X); addFire(START_X - 22, k); addFire(START_X + 30, k); } },
  // ---------------- everything at once + throttling check
  { id: 'all_in', name: 'Всё сразу: ночная буря, костры, копание, тела, частицы', group: 'Нагрузка', note: 'худший реальный случай: всё включено одновременно',
    force: { storm: 1 },
    setup: (k) => { k.clock(T(2, 23)); k.stand(START_X + 40); addFire(START_X + 10, k); addFire(START_X + 90, k); k.useTool('shovel'); },
    tick: (k, t, tm) => {
      const b = k.bi; b.primary = true; k.aim(pl.x + 6, pl.y + 8);
      if (tm > -0.05 && !k.data.a) { k.data.a = 1; spawnStressTest(30, pl.x, pl.y - 140); }
      if (P.n < 9000) { const c = G.cam; spawnMix(500, c.x, c.y, c.vw, c.vh, k.rnd); }
      void t;
    } },
  { id: 'idle_end', name: 'Повтор покоя (проверка троттлинга)', group: 'База', note: 'тот же «Покой», что в начале: если медленнее — устройство перегрелось',
    force: { snowfall: 0, storm: 0, wind: 3 }, setup: (k) => { k.clock(12 * 60); k.stand(START_X); } },
];

// ------------------------------------------------------------------ the runner
type Phase = 'idle' | 'warm' | 'measure' | 'gpu' | 'done';
declare const __BUILD__: string | undefined;
const BUILD = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';

class Bench {
  active = false;
  input = newInput();
  private lastRes: BenchResult | null = null;
  private promise: Promise<BenchResult> | null = null;
  private cancelled = false;
  private phase: Phase = 'idle';
  private sc: Scn | null = null;
  private kit!: Kit;
  private t0 = -1; private tc = 0; private lastNow = 0; private raw = 16.7; private hiccup = false;
  private dur = { warm: 0.9, measure: 4.5, gpu: 0.8 };
  private done: (() => void) | null = null;
  // measuring buffers
  private ft = new Float32Array(6000); private wk = new Float32Array(6000); private nf = 0;
  private jankBy: Record<string, number> = {};
  private probe = { p: [0, 0, 0], b: [0, 0, 0], a: [0, 0, 0], n: 0, fires: 0 };
  private gpuSum: Record<string, number> = {}; private gpuN = 0;
  private strip: HTMLElement | null = null; private stripT = 0;
  private idx = 0; private total = 0;
  private opts: BenchOpts = { source: 'api' };
  private saved!: { profOn: number; nosync: number; rnd: () => number; engine: 'planck' | 'rapier'; q: number; dyn: number; vp: { w: number; h: number; dpr: number } };

  constructor(private host: BenchHost) {}

  last(): BenchResult | null {
    if (this.lastRes) return this.lastRes;
    try { const s = localStorage.getItem('frost.bench'); return s ? (JSON.parse(s) as BenchResult) : null; } catch { return null; }
  }
  cancel() { this.cancelled = true; if (this.done) { const d = this.done; this.done = null; d(); } }

  start(o: BenchOpts): Promise<BenchResult> {
    if (this.promise) return this.promise;
    this.opts = o;
    this.promise = this.run(o).finally(() => { this.promise = null; });
    return this.promise;
  }

  // ---- called from the game loop
  beginFrame(now: number) {
    const raw = this.lastNow ? now - this.lastNow : 16.7;
    this.lastNow = now; this.raw = raw;
    if (!this.sc || this.phase === 'idle' || this.phase === 'done') return;
    if (this.host.blocked()) { if (this.t0 >= 0) this.t0 += raw; this.raw = -1; return; }    // phone held upright: the game waits, so does the clock
    if (raw > 1500) this.hiccup = true;                                                       // tab was hidden / OS stall
    if (this.t0 < 0) { this.t0 = now; this.tc = 0; }
    // script clock = simulated seconds (the game clamps its step to 50 ms, so a slow device would otherwise get a script that outruns the sim);
    // a wall-clock cap (2.2x the phase) keeps a very slow device from taking forever
    this.tc += Math.min(raw, 50) / 1000;
    const t = Math.max(this.tc, (now - this.t0) / 2200), d = this.dur, tm = t - d.warm;
    if (this.phase === 'warm' && t >= d.warm) {
      this.phase = 'measure'; this.nf = 0; this.jankBy = {}; this.probe = { p: [0, 0, 0], b: [0, 0, 0], a: [0, 0, 0], n: 0, fires: 0 };
      pacc.sum = {}; pacc.max = {}; pacc.cur = {}; pacc.on = true;
    }
    if (this.phase === 'measure' && tm >= d.measure) {
      this.phase = 'gpu'; pacc.on = false; this.snapshot = { sum: pacc.sum, max: pacc.max, n: this.nf };
      pacc.sum = {}; pacc.max = {}; pacc.cur = {}; pacc.on = true; prof.nosync = 0; this.gpuSum = {}; this.gpuN = 0;
    }
    if (this.phase === 'gpu' && tm >= d.measure + d.gpu) {
      this.phase = 'done'; pacc.on = false; prof.nosync = 1;
      for (const k of GPU_KEYS) this.gpuSum[k] = pacc.sum[k] || 0;
      const dn = this.done; this.done = null; dn?.();
      return;
    }
    const k = this.kit;
    this.keepAlive();
    this.sc.tick?.(k, t, tm);
    if (now - this.stripT > 250) { this.stripT = now; this.paintStrip(t); }
  }
  private matSnap = new Uint8Array(mat.length);
  private snapshot: { sum: Record<string, number>; max: Record<string, number>; n: number } = { sum: {}, max: {}, n: 0 };

  endFrame(workMs: number) {
    const bi = this.input;
    bi.secondaryPressed = false; bi.interactPressed = false; bi.eatPressed = false; bi.firePressed = false; bi.rotatePressed = false; bi.xrayPressed = false; bi.pausePressed = false; bi.toolSelect = -1;
    if (this.phase === 'gpu') { this.gpuN++; for (const k in pacc.cur) pacc.cur[k] = 0; return; }
    if (this.phase !== 'measure' || this.raw < 0) { for (const k in pacc.cur) pacc.cur[k] = 0; return; }
    if (this.nf < this.ft.length) {
      this.ft[this.nf] = this.raw; this.wk[this.nf] = workMs; this.nf++;
      if (this.raw > 33.4) {
        let bk = '', bv = 0;
        for (const k of TOP) { const v = pacc.cur[k] || 0; if (v > bv) { bv = v; bk = k; } }
        if (workMs < this.raw * 0.55) bk = 'gpu'; else if (bv < workMs * 0.25) bk = 'other';
        this.jankBy[bk] = (this.jankBy[bk] || 0) + 1;
      }
      if ((this.nf & 7) === 0) {                                      // cheap probes every 8th frame
        const pr = this.probe, b = allBodies().size, w = G.win;
        let a = 0; const cx0 = Math.max(0, (w.x0 / CH) | 0), cx1 = Math.min(CW - 1, (w.x1 / CH) | 0), cy0 = Math.max(0, (w.y0 / CH) | 0), cy1 = Math.min(CHH - 1, (w.y1 / CH) | 0);
        for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) if (awake[cy * CW + cx]) a++;
        pr.p[0] += P.n; pr.p[1] = Math.max(pr.p[1], P.n); pr.b[0] += b; pr.b[1] = Math.max(pr.b[1], b); pr.a[0] += a; pr.a[1] = Math.max(pr.a[1], a); pr.n++; pr.fires = G.fires.length;
      }
    }
    for (const k in pacc.cur) pacc.cur[k] = 0;
  }

  private keepAlive() {
    pl.core = Math.max(pl.core, 36.9); pl.stamina = 1; pl.food = Math.max(pl.food, 0.6); pl.wet = Math.min(pl.wet, 0.2);
  }

  // ---- orchestration
  private async run(o: BenchOpts): Promise<BenchResult> {
    const h = this.host, t00 = performance.now();
    this.cancelled = false;
    const quick = !!o.quick;
    this.dur = quick ? { warm: 0.5, measure: 2.0, gpu: 0.4 } : { warm: 0.9, measure: 4.5, gpu: 0.8 };
    let list = SCENARIOS.slice();
    if (o.only?.length) list = list.filter((s) => o.only!.includes(s.id));
    const vp0 = h.getViewport();
    this.saved = { profOn: prof.on, nosync: prof.nosync, rnd: Math.random, engine, q: G.quality, dyn: h.renderer.getDyn(), vp: vp0 };
    h.ui.hide();
    h.mute(true); h.noAdapt(true);
    prof.on = 1; prof.nosync = 1; pacc.on = false;
    Math.random = mulberry(20261106);
    h.setLoop(true, false);
    h.renderer.setDyn(1);
    this.mountStrip(); this.total = list.length;
    this.active = true;
    await sleep(120);
    const results: ScnResult[] = [];
    // device info is taken at the very start: the real baseline configuration
    for (let i = 0; i < list.length && !this.cancelled; i++) {
      this.idx = i;
      let r = await this.runOne(list[i], vp0);
      if (this.hiccup && !this.cancelled) { r = await this.runOne(list[i], vp0); r.retried = true; }   // tab hidden / OS stall during the measurement: once more
      if (this.cancelled) break;
      results.push(r);
    }
    const aborted = this.cancelled;
    this.active = false; this.phase = 'idle'; this.sc = null; pacc.on = false;
    // ---- restore the player's configuration, then a fresh game
    Math.random = this.saved.rnd;
    prof.on = this.saved.profOn; prof.nosync = this.saved.nosync;
    FORCE.storm = FORCE.snowfall = FORCE.wind = NaN; G.xray = 0; G.timeScale = 1;
    h.setViewport(null); h.setQuality(this.saved.q); h.renderer.setDyn(Math.min(1, this.saved.dyn));
    if (engine !== this.saved.engine) { try { await setEngine(this.saved.engine); } catch { /* keep the other engine */ } }
    h.noAdapt(false); h.mute(false);
    h.newGame(20261106 + Math.floor(Math.random() * 1000));
    h.setLoop(false, false);
    this.unmountStrip();
    const res = this.finish(results, aborted, quick, (performance.now() - t00) / 1000);
    this.lastRes = res;
    try { localStorage.setItem('frost.bench', JSON.stringify(res)); } catch { /* storage unavailable */ }
    try { (window as unknown as { __frostBenchResult?: BenchResult }).__frostBenchResult = res; } catch { /* ignore */ }
    this.showResults(res);
    return res;
  }

  private async runOne(sc: Scn, vp0: { w: number; h: number; dpr: number }): Promise<ScnResult> {
    const h = this.host;
    this.hiccup = false;
    // ---- configuration
    let skip: string | null = null;
    let vp: { w: number; h: number; dpr: number; mobile: boolean } | null = null;
    if (sc.view === 'phone') { vp = { w: 844, h: 390, dpr: 2, mobile: true }; if (Math.abs(vp0.w - 844) < 90 && Math.abs(vp0.h - 390) < 60) skip = 'окно уже телефонного размера: см. «Рендер: качество 0»'; }
    if (sc.view === 'desktop') { vp = { w: 1280, h: 720, dpr: 1, mobile: false }; if (Math.abs(vp0.w - 1280) < 120 && Math.abs(vp0.h - 720) < 90) skip = 'окно уже десктопного размера'; }
    const baseQ = this.saved.q;
    const wantQ = sc.quality ?? baseQ;
    if (skip) return this.emptyResult(sc, skip);
    if (sc.engine && engine !== sc.engine) { try { await setEngine(sc.engine); } catch { return this.emptyResult(sc, 'движок недоступен'); } }
    else if (!sc.engine && engine !== this.saved.engine) { try { await setEngine(this.saved.engine); } catch { /* ignore */ } }
    h.setViewport(vp); h.setQuality(wantQ);
    h.renderer.setDyn(sc.dyn === 'min' ? h.renderer.dynMin() : 1);
    FORCE.storm = sc.force?.storm ?? NaN; FORCE.snowfall = sc.force?.snowfall ?? NaN; FORCE.wind = sc.force?.wind ?? NaN;
    // ---- world
    this.input = newInput();
    const rnd = mulberry(7000 + this.idx);
    Math.random = mulberry(20261106 + this.idx * 131);
    if (sc.fresh !== false) { h.newGame(20261106); }
    P.n = 0;
    this.kit = {
      bi: this.input, host: h, rnd, data: {},
      stand: (x) => { pl.x = x; pl.y = surfaceAt(x) - 1; pl.vx = 0; pl.vy = 0; h.snapCam(); },
      useTool: (id) => { tool.cur = Math.max(0, tidx(id)); },
      pressTool: (id) => { this.input.toolSelect = tidx(id); },
      aim: (x, y) => { this.input.aim = [x, y]; },
      clock: (m) => { G.time = m; G.timeScale = 1; },
    };
    G.xray = 0;
    this.keepAlive();
    sc.setup?.(this.kit);
    this.keepAlive();
    this.matSnap.set(mat);
    // overlay modes
    if (sc.mode === 'title') { h.setLoop(false, false); h.ui.showTitle(() => {}); }
    else if (sc.mode === 'pause') { h.setLoop(true, true); h.ui.showPause(() => {}, () => {}); }
    else h.setLoop(true, false);
    this.paintStrip(0, true);
    if (this.cancelled) return this.emptyResult(sc, 'прервано');
    // ---- run: warm-up → measure → synced GPU phase
    this.sc = sc; this.phase = 'warm'; this.t0 = -1; this.nf = 0;
    prof.nosync = 1;
    await new Promise<void>((res) => { this.done = res; });
    this.phase = 'idle';
    const out = this.collect(sc, vp ? { w: vp.w, h: vp.h } : null);
    { let ch = 0; const a = this.matSnap; for (let i = 0; i < a.length; i++) if (a[i] !== mat[i]) ch++; out.outcome = `мир изменён на ${ch} кл.` + (sc.outcome ? '; ' + sc.outcome(this.kit) : ''); }
    // ---- teardown
    sc.teardown?.(this.kit);
    if (sc.mode) { h.ui.hide(); }
    h.setLoop(true, false);
    G.xray = 0; G.timeScale = 1;
    if (!this.cancelled) await sleep(sc.mode ? 520 : 30);
    return out;
  }

  private emptyResult(sc: Scn, why: string): ScnResult {
    return { id: sc.id, name: sc.name, group: sc.group, note: sc.note, skipped: why, engine: engine, quality: G.quality, dyn: 1, canvas: [0, 0], view: [0, 0], frames: 0, seconds: 0, fps: 0, p50: 0, p95: 0, p99: 0, max: 0, jank33: 0, jank50: 0, work: { avg: 0, p95: 0, max: 0 }, sub: {}, peak: {}, jankBy: {}, gpu: null, probes: { particles: [0, 0], bodies: [0, 0], awake: [0, 0], fires: 0 }, outcome: '', flag: 'ok', top: [], topCpu: [] };
  }

  private collect(sc: Scn, vp: { w: number; h: number } | null): ScnResult {
    const n = this.nf, h = this.host;
    const ft = Array.from(this.ft.subarray(0, n)).sort((a, b) => a - b), wk = Array.from(this.wk.subarray(0, n)).sort((a, b) => a - b);
    const sum = ft.reduce((a, b) => a + b, 0), wsum = wk.reduce((a, b) => a + b, 0);
    const sub: Record<string, number> = {}, peak: Record<string, number> = {};
    const sn = Math.max(1, this.snapshot.n);
    for (const k of ALL_KEYS) { if (GPU_KEYS.includes(k)) continue; const v = this.snapshot.sum[k]; if (v) { sub[k] = r2(v / sn); peak[k] = r2(this.snapshot.max[k] || 0); } }
    let tsum = 0; for (const k of TOP) tsum += sub[k] || 0;
    const wavg = wsum / Math.max(1, n);
    sub.other = r2(Math.max(0, wavg - tsum));
    const gn = Math.max(1, this.gpuN);
    const gpu: Record<string, number> = {}; let gAny = false;
    for (const k of GPU_KEYS) { const v = (this.gpuSum[k] || 0) / gn; gpu[k] = r2(v); if (v > 0) gAny = true; }
    // bottleneck ranking: CPU subsystems, with the GPU pass replacing its CPU submit row
    const cand: [string, number][] = [];
    for (const k of TOP) { const g = GPU_OF[k]; const v = g && gAny ? Math.max(sub[k] || 0, gpu[g] || 0) : sub[k] || 0; cand.push([g && gAny ? g : k, v]); }
    cand.push(['other', sub.other]);
    cand.sort((a, b) => b[1] - a[1]);
    const p95 = pct(ft, 0.95);
    const pr = this.probe, pn = Math.max(1, pr.n);
    return {
      id: sc.id, name: sc.name, group: sc.group, note: sc.note, engine, quality: G.quality, dyn: r2(h.renderer.getDyn()),
      canvas: h.renderer.size(), view: [vp?.w ?? h.getViewport().w, vp?.h ?? h.getViewport().h],
      frames: n, seconds: r2(sum / 1000),
      fps: r2(n / Math.max(0.001, sum / 1000)), p50: r2(pct(ft, 0.5)), p95: r2(p95), p99: r2(pct(ft, 0.99)), max: r2(ft[n - 1] || 0),
      jank33: ft.filter((v) => v > 33.4).length, jank50: ft.filter((v) => v > 50).length,
      work: { avg: r2(wavg), p95: r2(pct(wk, 0.95)), max: r2(wk[n - 1] || 0) },
      sub, peak, jankBy: { ...this.jankBy }, gpu: gAny ? gpu : null,
      probes: { particles: [Math.round(pr.p[0] / pn), pr.p[1]], bodies: [r2(pr.b[0] / pn), pr.b[1]], awake: [Math.round(pr.a[0] / pn), pr.a[1]], fires: pr.fires },
      outcome: '', flag: flagOf(p95), top: cand.slice(0, 3).filter((c) => c[1] > 0.01).map((c) => c[0]),
      topCpu: [...TOP, 'other'].map((k) => [k, sub[k] || 0] as [string, number]).sort((a, b) => b[1] - a[1]).slice(0, 3).filter((c) => c[1] > 0.01).map((c) => c[0]),
    };
  }

  // ---- result assembly
  private finish(scn: ScnResult[], aborted: boolean, quick: boolean, seconds: number): BenchResult {
    const h = this.host, rdr = { gpu: h.renderer.gpu, canvas: { width: h.renderer.size()[0], height: h.renderer.size()[1] } };
    const nav = navigator as Navigator & { deviceMemory?: number };
    const done = scn.filter((s) => !s.skipped && s.frames > 0);
    const worst = done.slice().sort((a, b) => b.p95 - a.p95)[0];
    let ws = '', wsv = 0, wsi = '';
    for (const s of done) for (const k of Object.keys(s.sub)) { if (k === 'other' || CHILD_SET.has(k)) continue; const v = s.sub[k]; if (v > wsv) { wsv = v; ws = k; wsi = s.name; } }
    for (const s of done) if (s.gpu) for (const k of GPU_KEYS) { if (s.gpu[k] > wsv) { wsv = s.gpu[k]; ws = k; wsi = s.name; } }
    const base = done.find((s) => s.id === 'idle'), end = done.find((s) => s.id === 'idle_end');
    const hz = base ? Math.round(1000 / Math.max(1, base.p50)) : 0;
    let throttle = '—';
    if (base && end) { const a = base.work.avg, b = end.work.avg; throttle = b > a * 1.25 + 0.5 ? `да: CPU-кадр покоя ${a.toFixed(1)} → ${b.toFixed(1)} мс` : 'нет'; }
    const dev: Record<string, string | number | boolean> = {
      ua: navigator.userAgent, dpr: window.devicePixelRatio || 1, screen: `${screen.width}×${screen.height}`, window: `${window.innerWidth}×${window.innerHeight}`,
      canvas: `${rdr.canvas.width}×${rdr.canvas.height}`, gpu: rdr.gpu || '(скрыт браузером)', cores: navigator.hardwareConcurrency || 0, memoryGB: nav.deviceMemory || 0,
      touch: h.mobile(), quality: this.saved.q, dynStart: r2(this.saved.dyn), engine: this.saved.engine, hz, lang: navigator.language,
    };
    const rank: [string, number, number, string][] = [];
    const pool = done.filter((s) => s.id !== 'title' && s.id !== 'pause');
    for (const k of [...TOP, 'other']) {
      let sum = 0, mx = 0, mi = '';
      for (const s of pool) { const v = s.sub[k] || 0; sum += v; if (v > mx) { mx = v; mi = s.name; } }
      rank.push([k, r2(sum / Math.max(1, pool.length)), r2(mx), mi]);
    }
    rank.sort((a, b) => b[1] - a[1]);
    return {
      version: 1, build: BUILD, date: new Date().toISOString(), quick, aborted, seconds: Math.round(seconds), device: dev, scenarios: scn,
      summary: { worst: worst?.name ?? '', worstP95: worst?.p95 ?? 0, worstSub: ws, worstSubMs: r2(wsv), worstSubIn: wsi, cpuRank: rank, jankTotal: done.reduce((a, s) => a + s.jank33, 0), frames: done.reduce((a, s) => a + s.frames, 0), hz, throttle },
    };
  }

  // ------------------------------------------------------------ progress strip (during the run)
  private mountStrip() {
    const s = el('div', 'bench-strip');
    s.innerHTML = `<div class="bs-row"><span class="bs-cap">${ico('timer')}<span>Тест производительности</span></span><span class="bs-n mono"></span></div>
      <div class="bs-name"></div>
      <div class="bs-bars"><i class="bs-all"><b></b></i><i class="bs-one"><b></b></i></div>
      <div class="bs-row"><span class="bs-live mono"></span><button type="button" class="bs-stop">${ico('stop')}<span>Прервать</span></button></div>`;
    (s.querySelector('.bs-stop') as HTMLElement).addEventListener('click', () => this.cancel());
    this.host.ui.host.appendChild(s);
    this.strip = s;
  }
  private unmountStrip() { this.strip?.remove(); this.strip = null; }
  private paintStrip(t: number, force = false) {
    const s = this.strip; if (!s) return;
    const d = this.dur, tot = d.warm + d.measure + d.gpu, f1 = Math.min(1, t / tot);
    (s.querySelector('.bs-n') as HTMLElement).textContent = `${String(this.idx + 1).padStart(2, '0')} / ${String(this.total).padStart(2, '0')}`;
    (s.querySelector('.bs-name') as HTMLElement).textContent = this.host.blocked() ? 'Поверни телефон горизонтально' : this.sc?.name ?? 'Подготовка мира…';
    (s.querySelector('.bs-all b') as HTMLElement).style.transform = `scaleX(${((this.idx + (force ? 0 : f1)) / Math.max(1, this.total)).toFixed(3)})`;
    (s.querySelector('.bs-one b') as HTMLElement).style.transform = `scaleX(${force ? 0 : f1.toFixed(3)})`;
    (s.querySelector('.bs-live') as HTMLElement).textContent = `${this.phase === 'warm' ? 'прогрев' : this.phase === 'gpu' ? 'GPU' : 'замер'} · ${Math.round(this.host.fps())} к/с`;
  }

  // ------------------------------------------------------------ results overlay
  private showResults(res: BenchResult) {
    const h = this.host;
    const ov = el('div', 'overlay bench');
    const card = el('div', 'card bench-card');
    const sm = res.summary;
    const f1 = (v: number) => v.toFixed(1).replace('.', ',');
    const dev = res.device;
    const done = res.scenarios.filter((s) => !s.skipped);
    const worstLine = sm.worst
      ? `Худший сценарий — <b>${esc(sm.worst)}</b>: p95 ${f1(sm.worstP95)} мс. Главное узкое место — <b>${esc(label(sm.worstSub))}</b>, ${f1(sm.worstSubMs)} мс/кадр (в «${esc(sm.worstSubIn)}»).`
      : 'Нет данных.';
    card.innerHTML = `
      <div class="kicker"><i></i><span>Стенд · журнал замеров</span><i></i></div>
      <h2 class="card-title">Результаты${res.aborted ? ' <small>прервано</small>' : ''}</h2>
      <p class="bench-sum">${worstLine}</p>
      <div class="bench-dev mono">${esc(String(dev.gpu))} · dpr ${dev.dpr} · канвас ${dev.canvas} · ${dev.cores || '?'} ядер · качество ${dev.quality} · ${dev.engine === 'rapier' ? 'Rapier' : 'planck'}${sm.hz ? ' · ≈' + sm.hz + ' Гц' : ''}${sm.throttle !== '—' ? ' · троттлинг: ' + esc(sm.throttle) : ''}</div>
      <div class="bench-legend"><span class="lg ok"></span>p95 ≤ 16,7<span class="lg warn"></span>≤ 33<span class="lg bad"></span>&gt; 33 мс <em>· тап по строке — подсистемы</em></div>
      <div class="bench-scroll"><div class="bench-table" role="table"></div></div>
      <textarea class="bench-ta mono" readonly hidden aria-label="Отчёт"></textarea>
      <div class="bench-actions"></div>`;
    const tbl = card.querySelector('.bench-table') as HTMLElement;
    tbl.innerHTML = `<div class="bt-row bt-head" role="row"><span></span><span>Сценарий</span><span>к/с</span><span class="c-p50">p50</span><span>p95</span><span class="c-p99">p99</span><span>max</span><span>&gt;33</span><span>CPU</span><span>Узкое место</span></div>`;
    let lastGroup = '';
    for (const s of res.scenarios) {
      if (s.group !== lastGroup) { lastGroup = s.group; tbl.insertAdjacentHTML('beforeend', `<div class="bt-group cap">${esc(s.group)}</div>`); }
      const row = el('div', 'bt-item');
      if (s.skipped) { row.innerHTML = `<div class="bt-row skipped"><i class="led"></i><span class="nm">${esc(s.name)}</span><span class="why">${esc(s.skipped)}</span></div>`; tbl.appendChild(row); continue; }
      const hot = s.flag !== 'ok';
      const chips = s.top.map((k, i) => `<b class="chip${hot ? ' hot' : ''}${i === 0 ? ' first' : ''}">${esc(label(k))} <i>${f1(topMs(s, k))}</i></b>`).join('');
      const cpuFlag = s.work.p95 <= 10 ? 'ok' : s.work.p95 <= 16.7 ? 'warn' : 'bad';
      row.innerHTML = `<div class="bt-row" role="row" tabindex="0"><i class="led ${s.flag}"></i><span class="nm">${esc(s.name)}</span><span class="mono">${Math.round(s.fps)}</span><span class="mono c-p50">${f1(s.p50)}</span><span class="mono v ${s.flag}">${f1(s.p95)}</span><span class="mono c-p99">${f1(s.p99)}</span><span class="mono">${f1(s.max)}</span><span class="mono ${s.jank33 ? 'jk' : ''}">${s.jank33}</span><span class="mono v ${cpuFlag}">${f1(s.work.avg)}</span><span class="chips">${chips}</span></div><div class="bt-detail" hidden></div>`;
      const rowEl = row.querySelector('.bt-row') as HTMLElement, det = row.querySelector('.bt-detail') as HTMLElement;
      const toggle = () => { if (det.hidden && !det.firstChild) det.innerHTML = detailHtml(s); det.hidden = !det.hidden; row.classList.toggle('open', !det.hidden); };
      rowEl.addEventListener('click', toggle);
      rowEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') toggle(); });
      tbl.appendChild(row);
    }
    // actions
    const text = makeReport(res);
    const ta = card.querySelector('.bench-ta') as HTMLTextAreaElement;
    ta.value = text;
    const acts = card.querySelector('.bench-actions') as HTMLElement;
    const mk = (labelTxt: string, cls: string, icon: string, fn: () => void) => { const b = el('button', `btn ${cls}`, `${ico(icon)}<span>${labelTxt}</span>`); b.type = 'button'; b.addEventListener('click', fn); return b; };
    const copy = mk('Копировать отчёт', 'btn-bench-main', 'copy', () => {
      const lab = copy.querySelector('span') as HTMLElement;
      const ok = (m: string) => { lab.textContent = m; copy.classList.add('done'); window.setTimeout(() => { lab.textContent = 'Копировать отчёт'; copy.classList.remove('done'); }, 2600); };
      const fallback = () => {
        ta.hidden = false; ta.value = text; ta.focus({ preventScroll: true }); ta.select(); ta.setSelectionRange(0, text.length);
        let okc = false; try { okc = document.execCommand('copy'); } catch { okc = false; }
        if (okc) ok('Скопировано'); else ok('Выделено: удерживай → «Копировать»');
        ta.scrollIntoView({ block: 'nearest' });
      };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => ok('Скопировано'), fallback);
        else fallback();
      } catch { fallback(); }
    });
    const again = mk('Повторить', 'btn-ghost', 'rotate', () => { h.ui.hide(); window.setTimeout(() => { void this.start(this.opts); }, 480); });
    const close = mk('Закрыть', 'btn-ghost', 'stop', () => { h.ui.hide(); h.closed(); });
    acts.append(copy, again, close);
    ov.appendChild(card);
    h.ui.mountOverlay(ov, 'bench');
    window.setTimeout(() => copy.focus({ preventScroll: true }), 80);
  }
}

const CHILD_SET = new Set(Object.values(CHILDREN).flat());
function topMs(s: ScnResult, k: string): number { return GPU_KEYS.includes(k) ? s.gpu?.[k] ?? 0 : s.sub[k] ?? 0; }

function detailHtml(s: ScnResult): string {
  const f1 = (v: number) => v.toFixed(2).replace('.', ',');
  const rows: [string, number, boolean][] = [];
  for (const k of TOP) { if ((s.sub[k] || 0) >= 0.03) rows.push([k, s.sub[k], false]); for (const c of CHILDREN[k] ?? []) if ((s.sub[c] || 0) >= 0.03) rows.push([c, s.sub[c], true]); }
  if ((s.sub.other || 0) >= 0.03) rows.push(['other', s.sub.other, false]);
  if (s.gpu) for (const k of GPU_KEYS) rows.push([k, s.gpu[k], false]);
  const scale = Math.max(16.7, ...rows.map((r) => r[1]));
  const bars = rows.map(([k, v, child]) => `<div class="bd${child ? ' child' : ''}${s.top.includes(k) ? ' hot' : ''}${k.startsWith('gpu') ? ' gpu' : ''}"><span>${esc(label(k))}</span><i><b style="width:${Math.min(100, (v / scale) * 100).toFixed(1)}%"></b></i><em class="mono">${f1(v)}</em></div>`).join('');
  const jb = Object.entries(s.jankBy).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k === 'gpu' ? 'ГПУ / композитор' : label(k)} ×${n}`).join(' · ');
  const pr = s.probes;
  return `<div class="bd-wrap"><p class="bd-note">${esc(s.note)}<br><span class="mono">${esc(s.outcome)}</span></p><div class="bd-grid">${bars}</div>
    <p class="bd-meta mono">кадров ${s.frames} · CPU-кадр avg ${f1(s.work.avg)} / p95 ${f1(s.work.p95)} / max ${f1(s.work.max)} мс · частицы ср. ${pr.particles[0]} (макс ${pr.particles[1]}) · тела ср. ${pr.bodies[0]} (макс ${pr.bodies[1]}) · активных чанков ср. ${pr.awake[0]} · костров ${pr.fires} · канвас ${s.canvas[0]}×${s.canvas[1]} · dyn ${s.dyn} · q${s.quality} · ${s.engine}${jb ? ' · дёрги: ' + jb : ''}</p></div>`;
}

// ------------------------------------------------------------------ plain-text / markdown report
export function makeReport(res: BenchResult): string {
  const n = (v: number, d = 1) => v.toFixed(d);
  const d = res.device, sm = res.summary;
  const L: string[] = [];
  L.push(`# Белая Мгла — тест производительности${res.aborted ? ' (ПРЕРВАН)' : ''}`);
  L.push(`build ${res.build} · ${res.date} · ${res.quick ? 'быстрый' : 'полный'} · ${res.seconds} с`);
  L.push(`UA: ${d.ua}`);
  L.push(`GPU: ${d.gpu} · dpr ${d.dpr} · экран ${d.screen} · окно ${d.window} · канвас ${d.canvas} · ядер ${d.cores}${d.memoryGB ? ' · ' + d.memoryGB + ' ГБ' : ''} · touch ${d.touch} · качество ${d.quality} · dyn ${d.dynStart} · физика ${d.engine}${sm.hz ? ' · ~' + sm.hz + ' Гц' : ''}`);
  L.push(`Итог: худший сценарий «${sm.worst}» p95 ${n(sm.worstP95)} мс; узкое место «${label(sm.worstSub)}» ${n(sm.worstSubMs)} мс/кадр (в «${sm.worstSubIn}»); дёрг >33 мс: ${sm.jankTotal} из ${sm.frames} кадров; троттлинг: ${sm.throttle}`);
  L.push(`Флаги: G p95≤16.7, Y ≤33, R >33 мс. CPU = среднее время JS за кадр. «>33» = кадров дольше 33 мс.`);
  L.push('');
  L.push('| # | Сценарий | кадр | к/с | p50 | p95 | p99 | max | >33 | CPU | флаг | узкие места, мс/кадр |');
  L.push('|--|--|--|--|--|--|--|--|--|--|--|--|');
  res.scenarios.forEach((s, i) => {
    if (s.skipped) { L.push(`| ${i + 1} | ${s.name} | — | — | — | — | — | — | — | — | — | пропущен: ${s.skipped} |`); return; }
    const fl = s.flag === 'ok' ? 'G' : s.flag === 'warn' ? 'Y' : 'R';
    L.push(`| ${i + 1} | ${s.name} | ${s.frames} | ${Math.round(s.fps)} | ${n(s.p50)} | ${n(s.p95)} | ${n(s.p99)} | ${n(s.max)} | ${s.jank33} | ${n(s.work.avg)} | ${fl} | ${s.top.map((k) => `${label(k)} ${n(topMs(s, k))}`).join('; ')} |`);
  });
  L.push('');
  L.push('## Что сделал сценарий');
  for (const s of res.scenarios) if (!s.skipped) L.push(`- ${s.id}: ${s.outcome}`);
  L.push('');
  L.push('## Подсистемы по сценариям (мс/кадр, ≥0.05; в скобках — худший одиночный вызов)');
  for (const s of res.scenarios) {
    if (s.skipped) continue;
    const parts: string[] = [];
    for (const k of TOP) { const v = s.sub[k] || 0; if (v >= 0.05) { parts.push(`${k} ${n(v, 2)}(${n(s.peak[k] || 0)})`); for (const c of CHILDREN[k] ?? []) if ((s.sub[c] || 0) >= 0.05) parts.push(`  ${c} ${n(s.sub[c], 2)}`); } }
    if ((s.sub.other || 0) >= 0.05) parts.push(`other ${n(s.sub.other, 2)}`);
    if (s.gpu) parts.push(`GPU[cell ${n(s.gpu.gpuCell)} scr ${n(s.gpu.gpuScr)} part ${n(s.gpu.gpuPart)}]`);
    const jb = Object.entries(s.jankBy).sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k}×${c}`).join(' ');
    L.push(`- ${s.id} CPU-топ: ${s.topCpu.map((k) => `${k} ${n(s.sub[k] || 0, 2)}`).join(', ')} | [q${s.quality} dyn${s.dyn} ${s.canvas[0]}x${s.canvas[1]} ${s.engine}] part ${s.probes.particles[0]}/${s.probes.particles[1]} bodies ${s.probes.bodies[0]}/${s.probes.bodies[1]} awake ${s.probes.awake[0]}: ${parts.join(', ')}${jb ? ' | jank: ' + jb : ''}`);
  }
  L.push('');
  L.push('## Рейтинг CPU-подсистем (среднее по всем игровым сценариям, мс/кадр; максимум и где)');
  for (const [k, mean, mx, where] of sm.cpuRank) if (mean >= 0.03) L.push(`- ${label(k)} (${k}): ср. ${n(mean, 2)}, макс ${n(mx, 2)} в «${where}»`);
  const rr = res.scenarios.find((s) => s.id === 'rigid_rapier'), rp = res.scenarios.find((s) => s.id === 'rigid_planck');
  if (rr && rp && !rr.skipped && !rp.skipped) {
    L.push('');
    L.push('## Rapier vs planck (тот же сценарий)');
    L.push(`- Rapier: p95 ${n(rr.p95)} / max ${n(rr.max)} мс, к/с ${Math.round(rr.fps)}, тела ${n(rr.sub.bodies || 0, 2)} мс (шаг ${n(rr.sub.bStep || 0, 2)}, синхр. ${n(rr.sub.bSync || 0, 2)}, штамп ${n(rr.sub.bStamp || 0, 2)}, коллайдеры ${n(rr.sub.bColl || 0, 2)}), статика ${n(rr.sub.structure || 0, 2)}`);
    L.push(`- planck: p95 ${n(rp.p95)} / max ${n(rp.max)} мс, к/с ${Math.round(rp.fps)}, тела ${n(rp.sub.bodies || 0, 2)} мс (шаг ${n(rp.sub.bStep || 0, 2)}, штамп ${n(rp.sub.bStamp || 0, 2)}, коллайдеры ${n(rp.sub.bColl || 0, 2)}), статика ${n(rp.sub.structure || 0, 2)}`);
  }
  const rq = ['rq0_d1', 'rq1_d1', 'rq0_dmin', 'rq1_dmin', 'view_phone', 'view_desktop'].map((id) => res.scenarios.find((s) => s.id === id)).filter((s): s is ScnResult => !!s && !s.skipped);
  if (rq.length) {
    L.push('');
    L.push('## Качество / разрешение (ночная буря + 2 костра)');
    for (const s of rq) L.push(`- ${s.id}: канвас ${s.canvas[0]}x${s.canvas[1]}, p95 ${n(s.p95)} мс, к/с ${Math.round(s.fps)}, CPU ${n(s.work.avg)}${s.gpu ? `, GPU cell ${n(s.gpu.gpuCell)} scr ${n(s.gpu.gpuScr)} part ${n(s.gpu.gpuPart)}` : ''}`);
  }
  return L.join('\n');
}

export function createBench(host: BenchHost) { return new Bench(host); }
void set; void free; void dens; void bond;
