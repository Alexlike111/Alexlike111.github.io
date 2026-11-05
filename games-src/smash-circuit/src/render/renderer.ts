// GameRenderer: owns the WebGL renderer and the whole scene. Reads ISim state only; never mutates the sim.
import * as THREE from 'three';
import { CONFIG, type Quality } from '../config';
import { buildTrackGeometry } from '../track/spline';
import { FxManager } from '../fx/fxManager';
import type { CarState, ISim, SimEvent, TrackDef } from '../types';
import { CameraRig } from './camera';
import { CarFleets, disposeCarGeometries, getCarGeometries, type CarPose } from './car';
import { buildDecor, type DecorVisual } from './decor';
import { DestructibleRenderer } from './destructibles';
import { Materials } from './materials';
import { MenuScene } from './menuScene';
import { PlayerMarker } from './playerMarker';
import { PowerUpVisuals } from './powerups';
import { PALETTES, type ThemePalette } from './palette';
import { wallVisual } from './structures';
import { buildTrackVisual, type TrackVisual } from './trackBuilder';
import { clamp } from './util';

const programCount = (gl: THREE.WebGLRenderer): number => gl.info.programs?.length ?? 0;
const QUALITY_ORDER: Quality[] = ['low', 'medium', 'high'];

interface RaceScene {
  sim: ISim;
  group: THREE.Group;
  pal: ThemePalette;
  track: TrackVisual;
  decor: DecorVisual;
  destr: DestructibleRenderer;
  fleet: CarFleets;
  marker: PlayerMarker;
  ghost: THREE.Mesh;
  powerups: PowerUpVisuals;
  visKey: string;
}

export interface RenderDebug {
  fps: number; drawCalls: number; debrisActive: number; triangles: number; quality: Quality; particles: number; breaksShown: number;
  /** ms spent in JS preparing a frame (sync, fx, camera) before the draw submit */
  cpuMs: number;
  /** ms of the last loadRace by phase (track, decor, destr, fleet, rest, compile, first = first draw); a cached track shows no track / decor */
  load?: Record<string, number>;
  /** ms of the idle-time warm-up behind the menu by piece (visual:<track>, scene, programs, textures, total); absent until it finished */
  warm?: Record<string, number>;
  /** linked shader programs so far: it should not grow at race start once the menu warm-up ran */
  programs?: number;
  programList?: () => string[];
  /** triangle budget per mesh name for what the main pass draws (see GameRenderer.inspect) */
  inspect?: () => { name: string; tris: number; instances: number; cast: boolean }[];
  /** race camera state for tests: azimuth (0 = north-up), view half size (m), and a ground point (physics x, y) projected to NDC */
  camera?: { azimuth: number; halfW: number; halfH: number; project(x: number, y: number): { x: number; y: number } };
}

declare global { interface Window { __render?: RenderDebug } }

export class GameRenderer {
  readonly canvas: HTMLCanvasElement;
  private gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private rig = new CameraRig();
  private mats = new Materials();
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private fx: FxManager;
  private menu: MenuScene;
  private race: RaceScene | null = null;
  /** built static visuals (track mesh + decor) per track, oldest first: a retry or a track warmed up in the menu does not rebuild them */
  private visCache = new Map<string, { track: TrackVisual; decor: DecorVisual }>();
  private warming = false;
  private warmed = false;
  private mode: 'menu' | 'race' = 'menu';
  private poses: CarPose[] = [];
  private byId = new Map<number, CarPose>();
  private requested: Quality | 'auto';
  private level: Quality;
  private fpsAvg = 60;
  private lowFor = 0;
  private sinceChange = 0;
  private lastExternal = -1e9;
  private menuRaf = 0;
  private menuLast = 0;
  private disposed = false;
  /** something visible changed (resize, quality, palette, new scene): the next frame must draw even when the game is frozen */
  private dirty = true;
  private ceiling: Quality = 'high';   // highest level auto-quality may climb back to
  private okFor = 0;                   // s of healthy fps (counts toward a step up)
  private lastUp = -1e9;               // clock of the last step up
  private clock = 0;
  private lastDrop = -1e9;
  private ro: ResizeObserver | null = null;
  private lightDir = new THREE.Vector3(...CONFIG.render.lightDir).normalize();
  private tF = new THREE.Vector3(); private tR = new THREE.Vector3(); private tU = new THREE.Vector3(); private tT = new THREE.Vector3();
  private tY = new THREE.Vector3(0, 1, 0);
  private debug: RenderDebug = { fps: 60, drawCalls: 0, debrisActive: 0, triangles: 0, quality: 'high', particles: 0, breaksShown: 0, cpuMs: 0 };
  private onLost = (e: Event): void => { e.preventDefault(); };

  constructor(canvas: HTMLCanvasElement, quality: Quality | 'auto') {
    this.canvas = canvas;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false, stencil: false });
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.shadowMap.enabled = true;   // never toggled: quality switches flip sun.castShadow only, so no material is invalidated
    this.gl.setClearColor(PALETTES.meadow.background);
    this.requested = quality;
    this.level = quality === 'auto' ? this.guessLevel() : quality;
    this.ceiling = this.level;

    this.hemi = new THREE.HemisphereLight(0xffffff, 0xaaccaa, 1.3);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.9);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 320;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.05;
    this.sun.shadow.radius = 2.5;
    // Physics is right-handed in (x, y) and maps to scene (x, height, y). Seen from above that is a mirror image,
    // which made the player's right turn show as a left turn. Mirror the whole scene back along z
    // (three.js flips face winding for negative-determinant world matrices, shadows included).
    this.scene.scale.z = -1;
    this.scene.add(this.hemi, this.sun, this.sun.target);

    this.fx = new FxManager(this.mats, CONFIG.race.cars);
    this.scene.add(this.fx.group);
    this.menu = new MenuScene(this.mats, PALETTES.meadow);
    this.scene.add(this.menu.group);
    this.applyPalette(PALETTES.meadow);

    this.applyLevel(this.level, true);
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(canvas);
    }
    canvas.addEventListener('webglcontextlost', this.onLost);
    this.debug.inspect = () => this.inspect();
    this.debug.programList = () => (this.gl.info.programs ?? []).map((p) => p.name + '|' + p.cacheKey.length + '|' + p.cacheKey.slice(0, 600));
    window.__render = this.debug;
  }

  // ------------------------------------------------------------------ quality / size

  /** heading-up (rotating) camera on / off; landscape screens stay north-up whatever this says */
  setCameraRotating(on: boolean): void { this.rig.rotating = on; this.dirty = true; }

  get fps(): number { return this.fpsAvg; }
  get quality(): Quality { return this.level; }
  /** seconds of visual hit-stop left after a heavy hit (effects run slowed); the game loop may use it to hold its own presentation too */
  get hitStop(): number { return this.fx.hitStopLeft; }

  /** world metres per screen pixel at the current zoom (marker / ring sizes stay readable on a phone) */
  private metresPerPixel(): number {
    const w = this.canvas.clientWidth || this.canvas.width || 1;
    return (this.rig.halfW * 2) / w;
  }

  private guessLevel(): Quality {
    const nav = navigator as Navigator & { deviceMemory?: number };
    const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
    const small = Math.min(screen.width, screen.height) < 700;
    const weak = (nav.deviceMemory ?? 8) <= 3 || (nav.hardwareConcurrency ?? 8) <= 4;
    if (weak) return 'low';
    if (coarse || small) return 'medium';
    return 'high';
  }

  setQuality(q: Quality | 'auto'): void {
    this.requested = q;
    const lvl = q === 'auto' ? this.guessLevel() : q;
    this.ceiling = lvl;
    this.applyLevel(lvl, false);
  }

  private applyLevel(level: Quality, first: boolean): void {
    const q = CONFIG.render.quality[level];
    this.level = level;
    this.dirty = true;
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.sun.castShadow = q.shadows;
    if (q.shadows) {
      const size = q.shadowMap || 1024;
      if (this.sun.shadow.mapSize.x !== size || first) {
        this.sun.shadow.mapSize.set(size, size);
        this.sun.shadow.map?.dispose();
        this.sun.shadow.map = null;
      }
      const e = CONFIG.render.shadowExtent;
      const c = this.sun.shadow.camera;
      c.left = -e; c.right = e; c.top = e; c.bottom = -e;
      c.updateProjectionMatrix();
    }
    this.fx.setQuality(level);
    this.race?.decor.setDensity(CONFIG.render.decorDensity[level]);
    this.race?.destr.setWallShadows(level === 'high');
    this.race?.fleet.setBlobShadows(!q.shadows);
    this.menu.setBlobShadows(!q.shadows);
    this.sinceChange = 0; this.lowFor = 0; this.okFor = 0;
    this.debug.quality = level;
    if (!first) this.resize();
  }

  resize(): void {
    if (this.disposed) return;
    const w = Math.max(1, this.canvas.clientWidth || this.canvas.width || 1);
    const h = Math.max(1, this.canvas.clientHeight || this.canvas.height || 1);
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.render.quality[this.level].pixelRatio));
    this.gl.setSize(w, h, false);
    this.dirty = true;
    this.rig.setAspect(w / h);
    this.rig.setViewport(w, h);
    if (this.mode === 'menu') this.rig.update(0, 0, 0, 0, 0, 0, 0);
  }

  private trackFps(dt: number): void {
    if (dt <= 0 || dt > 0.5 || this.warming) return;   // the menu warm-up's own hitches must not push auto-quality down
    const inst = 1 / dt;
    this.fpsAvg += (inst - this.fpsAvg) * Math.min(1, dt * 2.5);
    this.sinceChange += dt;
    this.clock += dt;
    if (this.requested !== 'auto' || this.sinceChange < 2) return;
    const R = CONFIG.render;
    if (this.fpsAvg < R.autoQualityFpsDown) this.lowFor += dt; else this.lowFor = Math.max(0, this.lowFor - dt * 2);
    if (this.lowFor >= R.autoQualityWindow) {
      const i = QUALITY_ORDER.indexOf(this.level);
      // dropped again soon after a step up: that level does not hold, stop climbing back to it
      if (this.clock - this.lastUp < R.autoQualityUpCooldown && i > 0) this.ceiling = QUALITY_ORDER[i - 1];
      if (i > 0) this.applyLevel(QUALITY_ORDER[i - 1], false);
      this.lastDrop = this.clock;
      this.lowFor = 0; this.sinceChange = 0;
      return;
    }
    // healthy for a long stretch (a transient spike dropped us): climb back one level, with a cooldown
    if (this.fpsAvg >= R.autoQualityFpsUp && this.lowFor === 0) this.okFor += dt; else this.okFor = 0;
    const i = QUALITY_ORDER.indexOf(this.level);
    if (this.okFor >= R.autoQualityUpWindow && i < QUALITY_ORDER.indexOf(this.ceiling) && this.clock - this.lastDrop >= R.autoQualityUpCooldown) {
      this.applyLevel(QUALITY_ORDER[i + 1], false);
      this.lastUp = this.clock;
      this.okFor = 0;
    }
  }

  // ------------------------------------------------------------------ scene setup

  private applyPalette(pal: ThemePalette): void {
    this.gl.setClearColor(pal.background);
    this.scene.background = new THREE.Color(pal.background);
    this.hemi.color.setHex(pal.hemiSky); this.hemi.groundColor.setHex(pal.hemiGround); this.hemi.intensity = pal.hemiIntensity;
    this.sun.color.setHex(pal.sun); this.sun.intensity = pal.sunIntensity;
  }

  private placeSun(x: number, z: number): void {
    const E = CONFIG.render.shadowExtent;
    const f = this.tF.copy(this.lightDir).negate();
    const right = this.tR.crossVectors(f, this.tY).normalize();
    const up = this.tU.crossVectors(right, f).normalize();
    const t = this.tT.set(x, 0, z);
    const size = this.sun.shadow.mapSize.x || 1024;
    const texel = (2 * E) / size;
    const a = t.dot(right), b = t.dot(up);
    t.addScaledVector(right, Math.round(a / texel) * texel - a).addScaledVector(up, Math.round(b / texel) * texel - b);
    this.sun.target.position.copy(t);
    this.sun.position.copy(t).addScaledVector(this.lightDir, 150);
    this.sun.target.updateMatrixWorld();
  }

  private unloadRace(): void {
    if (!this.race) return;
    this.scene.remove(this.race.group);
    this.releaseRace(this.race);
    this.race = null;
    this.fx.clear();
  }

  /** free what belongs to one race; the (expensive) track visual and decor go back into the per-track cache */
  private releaseRace(rs: RaceScene): void {
    rs.destr.dispose();
    this.storeVis(rs.visKey, rs.track, rs.decor);
    rs.fleet.dispose();
    rs.marker.dispose();
    rs.powerups.dispose();
  }

  private dropVisCache(): void {
    for (const v of this.visCache.values()) { v.decor.dispose(); v.track.dispose(); }
    this.visCache.clear();
  }

  /** newest last; the oldest entries beyond CONFIG.render.visCacheMax are freed */
  private storeVis(key: string, track: TrackVisual, decor: DecorVisual): void {
    const old = this.visCache.get(key);
    if (old && (old.track !== track || old.decor !== decor)) { old.decor.dispose(); old.track.dispose(); }
    this.visCache.delete(key);
    this.visCache.set(key, { track, decor });
    while (this.visCache.size > CONFIG.render.visCacheMax) {
      const k = this.visCache.keys().next().value as string;
      const v = this.visCache.get(k)!;
      v.decor.dispose(); v.track.dispose();
      this.visCache.delete(k);
    }
  }

  /** Everything one race scene is made of, not yet attached to the scene (loadRace activates it; warmUp only compiles it). */
  private buildRace(sim: ISim, prof?: Record<string, number>): RaceScene {
    const def = sim.track.def;
    const pal = PALETTES[def.theme];
    const group = new THREE.Group();
    const visKey = JSON.stringify(def);
    let tp = performance.now();
    const lap = (k: string): void => { if (!prof) return; const n = performance.now(); prof[k] = +(n - tp).toFixed(1); tp = n; };
    let track: TrackVisual, decor: DecorVisual;
    const hit = this.visCache.get(visKey);
    if (hit) {
      ({ track, decor } = hit);   // same track again (retry / restart) or warmed up in the menu: reuse the built meshes
      this.visCache.delete(visKey);
      decor.setDensity(CONFIG.render.decorDensity[this.level]);
    } else {
      track = buildTrackVisual(sim.track, pal, this.mats);
      lap('track');
      decor = buildDecor(sim.track, pal, this.mats, track.exclusions, CONFIG.render.decorDensity[this.level]);
      lap('decor');
    }
    const destr = new DestructibleRenderer(sim.destructibles, def, pal, this.mats);
    destr.setWallShadows(this.level === 'high');
    lap('destr');
    // one instanced fleet per car model on the grid (a Same-as-mine field is one fleet, a Mixed field up to 8)
    const fleet = new CarFleets(this.mats, sim.cars.map((c) => c.modelId));
    fleet.setBlobShadows(!CONFIG.render.quality[this.level].shadows);
    lap('fleet');
    const ghostMat = this.mats.ghost;
    ghostMat.color.setHex(CONFIG.render.car.ghostColor);
    ghostMat.opacity = CONFIG.render.car.ghostOpacity;
    const playerCar = sim.cars.find((c) => c.isPlayer) ?? sim.cars[0];
    const ghost = new THREE.Mesh(getCarGeometries(playerCar?.modelId).ghost, ghostMat);
    ghost.visible = false;
    ghost.frustumCulled = false;
    ghost.renderOrder = 5;
    const marker = new PlayerMarker();
    const powerups = new PowerUpVisuals(sim, Math.max(CONFIG.race.cars, sim.cars.length));
    group.add(track.group, powerups.group, decor.group, destr.group, destr.rubble, fleet.group, ghost, marker.group);
    return { sim, group, pal, track, decor, destr, fleet, marker, ghost, powerups, visKey };
  }

  loadRace(sim: ISim): void {
    this.stopMenuLoop();
    this.unloadRace();
    const pal = PALETTES[sim.track.def.theme];
    this.applyPalette(pal);
    this.dirty = true;
    const prof: Record<string, number> = {};
    const t0 = performance.now();
    const rs = this.buildRace(sim, prof);
    const { decor, destr, fleet, marker, group } = rs;
    this.scene.add(group);
    this.race = rs;
    this.menu.group.visible = false;
    this.mode = 'race';
    this.rig.setMenu(false);
    this.fx.setTheme(pal, wallVisual(sim.track.def));
    this.fx.clear();
    this.poses = sim.cars.map((c) => ({ x: c.x, y: c.y, angle: c.angle, state: c }));
    this.byId.clear();
    for (const p of this.poses) this.byId.set(p.state.id, p);
    destr.sync(sim.destructibles);
    const player = sim.cars.find((c) => c.isPlayer) ?? sim.cars[0];
    this.rig.track = sim.track;
    this.rig.snap(player.x, player.y);
    this.resize();
    this.rig.update(0, player.x, player.y, 0, 0, 0, 1);
    decor.update(player.x, player.y, this.rig.radius + 8);
    fleet.update(this.poses, 0);
    marker.update(0, player.x, player.y, player.angle, true, this.metresPerPixel());
    this.placeSun(player.x, player.y);
    const tc = performance.now();
    this.precompile();
    prof.compile = +(performance.now() - tc).toFixed(1);
    prof.total = +(performance.now() - t0).toFixed(1);
    this.debug.load = prof;
  }

  /**
   * Compile the shaders for the current shadow state and for the opposite one (programs link in parallel with
   * KHR_parallel_shader_compile), so a later auto-quality drop or step up never stalls on a shader compile.
   */
  private precompile(): void {
    const cam = this.rig.camera;
    this.gl.compile(this.scene, cam);
    const sh = this.sun.castShadow;
    this.sun.castShadow = !sh;
    try { this.gl.compile(this.scene, cam); } finally { this.sun.castShadow = sh; }
  }


  // ------------------------------------------------------------------ warm-up behind the menu (audit #23)

  /**
   * Idle-time warm-up while the menu is up. Builds the track visual + decor of each of `defs` into the cache (one idle slot per
   * piece, likely track first) and, for the first one, a whole race scene from a throwaway sim: its shader programs are compiled
   * with compileAsync (KHR_parallel_shader_compile) and its textures uploaded, then the scene is dropped again. The first real
   * loadRace then finds its meshes cached and its programs linked instead of stalling on both. Stops as soon as a race loads.
   */
  warmUp(defs: TrackDef[], makeSim: (def: TrackDef) => ISim): void {
    if (this.warming || this.warmed || this.disposed || !defs.length) return;
    this.warming = true;
    this.runWarm(defs, makeSim)
      .catch((e: unknown) => { console.warn('[render] warm-up failed', e); })
      .finally(() => { this.warming = false; });
  }

  private canWarm(): boolean { return !this.disposed && !this.race && this.mode === 'menu'; }

  /** resolves when the browser is idle (a menu has nothing else to do), after a short delay at the latest */
  private idleSlot(): Promise<void> {
    return new Promise((res) => {
      const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
      if (w.requestIdleCallback) w.requestIdleCallback(() => res(), { timeout: 400 });
      else setTimeout(res, 50);
    });
  }

  private async runWarm(defs: TrackDef[], makeSim: (def: TrackDef) => ISim): Promise<void> {
    const t0 = performance.now();
    const prof: Record<string, number> = {};
    let programs = false;
    for (const def of defs) {
      const key = JSON.stringify(def);
      if (!this.visCache.has(key)) {
        await this.idleSlot();
        if (!this.canWarm()) return;
        const geo = buildTrackGeometry(def);
        const pal = PALETTES[def.theme];
        const ts = performance.now();
        const track = buildTrackVisual(geo, pal, this.mats);
        await this.idleSlot();
        if (!this.canWarm()) { track.dispose(); return; }
        const decor = buildDecor(geo, pal, this.mats, track.exclusions, CONFIG.render.decorDensity[this.level]);
        this.storeVis(key, track, decor);
        prof['visual:' + def.id] = +(performance.now() - ts).toFixed(1);
      }
      if (!programs) {
        programs = true;
        await this.warmPrograms(def, makeSim, prof);
        if (!this.canWarm()) return;
      }
    }
    prof.total = +(performance.now() - t0).toFixed(1);
    this.warmed = true;
    this.debug.warm = prof;
  }

  /** build one race scene off-screen, link its programs without blocking, upload its textures, drop it */
  private async warmPrograms(def: TrackDef, makeSim: (def: TrackDef) => ISim, prof: Record<string, number>): Promise<void> {
    await this.idleSlot();
    if (!this.canWarm()) return;
    const sim = makeSim(def);
    let rs: RaceScene | null = null;
    try {
      const tb = performance.now();
      rs = this.buildRace(sim);
      prof.scene = +(performance.now() - tb).toFixed(1);
      const cam = this.rig.camera;
      // programs for the other shadow state are only submitted here (they link in parallel); the current state is awaited
      const tc = performance.now();
      // (the particle / debris / skid materials live in the permanent fx group, which loadRace's own precompile would otherwise link)
      const roots = [rs.group, this.fx.group];
      const sh = this.sun.castShadow;
      this.sun.castShadow = !sh;
      try { for (const r of roots) this.gl.compile(r, cam, this.scene); } finally { this.sun.castShadow = sh; }
      // never wait forever (lost context, a driver that never reports the link): the warm-up is an optimisation only
      const linked = Promise.all(roots.map((r) => this.gl.compileAsync(r, cam, this.scene)));
      linked.catch(() => { /* an optimisation only: the real loadRace compiles whatever is missing */ });
      await Promise.race([linked, new Promise<void>((res) => setTimeout(res, 6000))]);
      prof.programs = +(performance.now() - tc).toFixed(1);
      await this.idleSlot();
      if (!this.canWarm()) return;
      const tu = performance.now();
      rs.group.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material & { map?: THREE.Texture | null } | undefined;
        if (m && !Array.isArray(m) && m.map) this.gl.initTexture(m.map);
      });
      prof.textures = +(performance.now() - tu).toFixed(1);
    } finally {
      if (rs) this.releaseRace(rs);
      sim.dispose();
    }
  }

  /** Garage / menu turntable: the car `modelId` (default: keep the current one) in paint `colorIndex`. */
  showMenuScene(colorIndex: number, modelId?: string): void {
    this.dirty = true;
    this.unloadRace();
    this.mode = 'menu';
    this.applyPalette(PALETTES.meadow);
    this.fx.setTheme(PALETTES.meadow, 'concrete');
    this.menu.group.visible = true;
    this.menu.setColor(colorIndex);
    if (modelId) this.menu.setModel(modelId);
    this.rig.setMenu(true);
    this.rig.setMenuView(11, new THREE.Vector3(0, 0.9, 0));
    this.resize();
    this.menu.update(0);
    this.renderMenuFrame(0);
    this.startMenuLoop();
  }

  private startMenuLoop(): void {
    if (this.menuRaf || this.disposed) return;
    this.menuLast = performance.now();
    const tick = (now: number): void => {
      this.menuRaf = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - this.menuLast) / 1000);
      this.menuLast = now;
      if (now - this.lastExternal < 250) return;   // the game loop is driving frames
      this.renderMenuFrame(dt);
    };
    this.menuRaf = requestAnimationFrame(tick);
  }

  private stopMenuLoop(): void { if (this.menuRaf) cancelAnimationFrame(this.menuRaf); this.menuRaf = 0; }

  private renderMenuFrame(dt: number): void {
    this.trackFps(dt);
    this.menu.update(dt);
    this.rig.update(dt, 0, 0, 0, 0, 0, 0);
    this.placeSun(0, 0);
    this.fx.update(dt, this.rig.camera);
    this.gl.render(this.scene, this.rig.camera);
    this.dirty = false;
    this.publish();
  }

  // ------------------------------------------------------------------ per frame

  frame(sim: ISim, events: SimEvent[], frameDt: number): void {
    if (this.disposed) return;
    const t0 = performance.now();
    this.lastExternal = t0;
    const dt = clamp(frameDt, 0, 0.1);
    if (this.mode === 'menu' && !this.race) { this.renderMenuFrame(dt); return; }
    if (!this.race || this.race.sim !== sim) this.loadRace(sim);
    const R = this.race!;
    // frozen (pause, results, ads, tutorial hold) and nothing changed since the last drawn frame: skip the whole frame
    if (frameDt <= 0 && !this.dirty && events.length === 0) { this.publish(); return; }
    this.trackFps(frameDt);

    // ---- interpolated car poses
    const back = (1 - sim.alpha) * CONFIG.physics.dt;
    const cars = sim.cars;
    if (this.poses.length !== cars.length) {
      this.poses = cars.map((c) => ({ x: c.x, y: c.y, angle: c.angle, state: c }));
      this.byId.clear();
      for (const p of this.poses) this.byId.set(p.state.id, p);
    }
    let player: CarState = cars[0];
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i], p = this.poses[i];
      p.state = c;
      p.x = c.x - c.vx * back; p.y = c.y - c.vy * back; p.angle = c.angle - c.angularVel * back;
      if (c.isPlayer) player = c;
    }
    const pp = this.byId.get(player.id) ?? this.poses[0];

    // ---- camera (before fx so emission range uses the current view)
    const topSpeed = CONFIG.car.baseTopSpeed;
    // boost camera: widen the view while a pad / nitro boost runs and kick it on the trigger
    this.rig.boostTarget = ((player.boostT ?? 0) > 0 || (player.nitroT ?? 0) > 0) ? 1 : 0;
    for (const ev of events) {
      if (ev.type === 'boost' && ev.carId === player.id) { this.rig.addPunch(CONFIG.items.fx.punch); this.rig.addTrauma(CONFIG.items.fx.shakePad); }
    }
    const intro = R.sim.race.phase === 'countdown' ? clamp(R.sim.race.countdown / CONFIG.race.countdown, 0, 1) : 0;
    this.rig.update(dt, pp.x, pp.y, player.vx, player.vy, Math.abs(player.speed) / topSpeed, intro);
    const tgt = this.rig.target;
    const ctx = {
      playerId: player.id, camX: tgt.x, camZ: tgt.z, radius: this.rig.radius,
      addTrauma: (t: number) => this.rig.addTrauma(t),
      carById: (id: number) => this.byId.get(id),
    };

    // ---- scene content
    R.destr.sync(sim.destructibles);
    R.decor.update(tgt.x, tgt.z, this.rig.radius + 8);
    R.fleet.update(this.poses, dt);
    R.powerups.update(dt, sim, this.poses);
    const gp = sim.ghostPose();
    if (gp) {
      R.ghost.visible = true;
      R.ghost.position.set(gp.x, 0, gp.y);
      R.ghost.rotation.set(0, -gp.a, 0);
    } else R.ghost.visible = false;

    // player marker: ring + arrow stay strong through the countdown and the first seconds, and flash again when the player is hit
    for (const ev of events) {
      if (ev.type !== 'impact') continue;
      if (ev.carId === player.id && ev.strength > 0.25) R.marker.ping();
      const hi = this.poses.findIndex((p) => p.state.id === ev.carId);
      if (hi >= 0 && dt > 0) {
        const hp = this.poses[hi], dx = ev.x - hp.x, dy = ev.y - hp.y, c = Math.cos(hp.angle), sn = Math.sin(hp.angle);
        R.fleet.hit(hi, ev.strength, dx * c + dy * sn, -dx * sn + dy * c);
      }
    }
    R.marker.update(dt, pp.x, pp.y, pp.angle, R.sim.race.phase === 'countdown', this.metresPerPixel());

    if (dt > 0) {
      this.fx.handleEvents(events, ctx);
      this.fx.updateCars(this.poses, dt, ctx);
    }
    this.fx.update(dt, this.rig.camera);
    this.placeSun(tgt.x, tgt.z);
    this.debug.cpuMs += (performance.now() - t0 - this.debug.cpuMs) * 0.1;
    const tr = performance.now();
    this.gl.render(this.scene, this.rig.camera);
    if (this.debug.load && this.debug.load.first === undefined) this.debug.load.first = +(performance.now() - tr).toFixed(1);
    this.dirty = false;
    this.publish();
  }

  /** Debug: triangle budget per mesh name (tris x instances, summed over spatial chunks; frustum-culled chunks left out), biggest first. */
  inspect(): { name: string; tris: number; instances: number; cast: boolean }[] {
    const acc = new Map<string, { name: string; tris: number; instances: number; cast: boolean }>();
    const cam = this.rig.camera;
    const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.visible) return;
      if (m.frustumCulled && !fr.intersectsObject(m)) return;   // what the main pass actually draws
      const g = m.geometry;
      const per = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      const inst = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1;
      const name = (m.name || (m.parent?.type ?? '') + '/' + g.type) + '#' + (g.getAttribute('position')?.count ?? 0);
      const e = acc.get(name) ?? { name, tris: 0, instances: 0, cast: m.castShadow };
      e.tris += per * inst; e.instances += inst;
      acc.set(name, e);
    });
    return [...acc.values()].sort((a, b) => b.tris - a.tris);
  }

  private publish(): void {
    const d = this.debug, info = this.gl.info.render;
    d.fps = this.fpsAvg; d.drawCalls = info.calls; d.triangles = info.triangles;
    d.debrisActive = this.fx.debris.active;
    d.particles = this.fx.smoke.active + this.fx.sparks.active;
    d.breaksShown = this.race?.destr.brokenShown ?? 0;
    d.quality = this.level;
    d.programs = programCount(this.gl);
    const rig = this.rig;
    d.camera = { azimuth: rig.viewAz, halfW: rig.halfW, halfH: rig.halfH, project: (x, y) => rig.project(x, y) };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopMenuLoop();
    this.ro?.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.unloadRace();
    this.dropVisCache();
    this.fx.dispose();
    this.menu.dispose();
    this.mats.dispose();
    disposeCarGeometries();
    this.gl.dispose();
    if (window.__render === this.debug) delete window.__render;
  }
}
