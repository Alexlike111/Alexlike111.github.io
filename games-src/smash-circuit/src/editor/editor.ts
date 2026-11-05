// Dev-only track editor (served at /editor.html by `npm run dev`; not part of the production build).
// 2D canvas: click to add / drag / delete control points and props, live spline preview with width, walls,
// curbs and validation (length, min radius, self-clearance), export / import TrackDef JSON.
// No storage of any kind: the document lives in memory only (export before leaving).
import { CONFIG } from '../config';
import type { PropDef, PropType, TrackDef, TrackGeometry, Vec2 } from '../types';
import { analyseTrack, buildTrackGeometry, requiredClearance, type TrackStats } from '../track/spline';
import { TRACKS, autoProps } from '../track/tracks';

const D = CONFIG.destruction;

const PROP_TYPES: PropType[] = ['cone', 'barrel', 'crate', 'tireStack', 'hayBale', 'sign', 'tree', 'rock'];
const PROP_COLOR: Record<PropType, string> = {
  cone: '#ff7a1a', barrel: '#d8402f', crate: '#b8864b', tireStack: '#222', hayBale: '#e6d04a', sign: '#ffffff', tree: '#2e9a4a', rock: '#8e969c',
};
const THEME_GROUND: Record<TrackDef['theme'], string> = { meadow: '#4f8f45', desert: '#c9a566', snow: '#dfe9f1' };
const WALL_COLOR: Record<TrackDef['wallStyle'], string> = { concrete: '#9aa3a8', tires: '#2b2b2b', fence: '#9b6b3a' };

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error('missing #' + id);
  return el as T;
};

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }
const r1 = (v: number): number => Math.round(v * 10) / 10;
const r2 = (v: number): number => Math.round(v * 100) / 100;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

// ---------------------------------------------------------------------------------------------
// document state
// ---------------------------------------------------------------------------------------------

let def: TrackDef = clone(TRACKS[0]);
let geom: TrackGeometry = buildTrackGeometry(def);
let stats: TrackStats;
let ctrlS: number[] = [];
let dirty = false;

const undoStack: string[] = [];
const redoStack: string[] = [];

type Tool = 'points' | 'props';
let tool: Tool = 'points';
let propType: PropType = 'barrel';
let selPoint = -1;
let selProp = -1;
let flipY = false; // false: physics +y is up on screen

interface Drag { kind: 'point' | 'prop' | 'pan'; idx: number; moved: boolean; sx: number; sy: number; vx: number; vy: number }
let drag: Drag | null = null;
let spaceDown = false;
const view = { x: 0, y: 0, k: 2.2 }; // world point at the canvas centre, pixels per metre

const cv = $<HTMLCanvasElement>('cv');
const ctx = cv.getContext('2d') as CanvasRenderingContext2D;
let cw = 1, ch = 1, dpr = 1;

// ---------------------------------------------------------------------------------------------
// maths helpers
// ---------------------------------------------------------------------------------------------

function w2s(x: number, y: number): [number, number] {
  return [cw / 2 + (x - view.x) * view.k, ch / 2 + (flipY ? 1 : -1) * (y - view.y) * view.k];
}
function s2w(px: number, py: number): Vec2 {
  return { x: view.x + (px - cw / 2) / view.k, y: view.y + ((flipY ? 1 : -1) * (py - ch / 2)) / view.k };
}

function propSize(t: PropType): { w: number; h: number; circle: boolean } {
  const p = D.props[t];
  return { w: p.w, h: p.h, circle: p.shape === 'circle' };
}

// ---------------------------------------------------------------------------------------------
// rebuild / validation
// ---------------------------------------------------------------------------------------------

function rebuild(): void {
  try {
    geom = buildTrackGeometry(def);
  } catch {
    return;
  }
  const req = requiredClearance(def.width, D.wallOffset, D.wall.thickness);
  stats = analyseTrack(geom, req, 400);
  ctrlS = def.points.map((p, i) => (i === 0 ? 0 : geom.nearest(p.x, p.y).s));
  updateStats(req);
  draw();
}

function updateStats(req: number): void {
  const minR = def.width / 2 + D.wallOffset + D.wall.thickness / 2 + 1;
  const lenOk = stats.length >= 600 && stats.length <= 1100;
  const sepOk = stats.conflicts.length === 0;
  const radOk = stats.minRadius > minR;
  const counts: Record<string, number> = {};
  for (const p of def.props) counts[p.type] = (counts[p.type] ?? 0) + 1;
  const row = (k: string, v: string, cls = ''): string => `<div><span>${k}</span><span class="${cls}">${v}</span></div>`;
  const ok = lenOk && sepOk && radOk;
  $('stats').innerHTML =
    `<div id="verdict" class="${ok ? 'ok' : 'bad'}">${ok ? 'VALID' : 'INVALID'}</div>` +
    row('length', `${stats.length.toFixed(0)} m (600-1100)`, lenOk ? 'ok' : 'bad') +
    row('min turn radius', `${stats.minRadius.toFixed(1)} m (need > ${minR.toFixed(1)})`, radOk ? 'ok' : 'bad') +
    row('min clearance', `${isFinite(stats.minSeparation) ? stats.minSeparation.toFixed(1) : '-'} m (need ${req.toFixed(1)})`, sepOk ? 'ok' : 'bad') +
    row('clearance conflicts', String(stats.conflicts.length) + (sepOk ? '' : ' (magenta)'), sepOk ? 'ok' : 'bad') +
    row('control points', String(def.points.length)) +
    row('props', `${def.props.length} (${Object.entries(counts).map(([k, v]) => k + ' ' + v).join(', ')})`);
}

// ---------------------------------------------------------------------------------------------
// history
// ---------------------------------------------------------------------------------------------

function snapshot(): void {
  undoStack.push(JSON.stringify(def));
  if (undoStack.length > 150) undoStack.shift();
  redoStack.length = 0;
  dirty = true;
}
function restore(s: string): void {
  def = JSON.parse(s) as TrackDef;
  selPoint = -1; selProp = -1;
  syncFields();
  rebuild();
}
function undo(): void {
  const s = undoStack.pop();
  if (s === undefined) return;
  redoStack.push(JSON.stringify(def));
  restore(s);
}
function redo(): void {
  const s = redoStack.pop();
  if (s === undefined) return;
  undoStack.push(JSON.stringify(def));
  restore(s);
}

// ---------------------------------------------------------------------------------------------
// drawing
// ---------------------------------------------------------------------------------------------

function strokeOffset(lat: number, width: number, color: string, dash: number[] = []): void {
  const S = geom.samples;
  ctx.beginPath();
  for (let i = 0; i <= S.length; i++) {
    const s = S[i % S.length];
    const [px, py] = w2s(s.x + s.nx * lat, s.y + s.ny * lat);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.lineWidth = Math.max(1, width * view.k);
  ctx.strokeStyle = color;
  ctx.setLineDash(dash);
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawGrid(): void {
  // adaptive grid: 10 / 50 / 100 m
  const tl = s2w(0, 0), br = s2w(cw, ch);
  const x0 = Math.min(tl.x, br.x), x1 = Math.max(tl.x, br.x), y0 = Math.min(tl.y, br.y), y1 = Math.max(tl.y, br.y);
  const step = view.k > 4 ? 10 : view.k > 1.2 ? 50 : 100;
  ctx.lineWidth = 1;
  ctx.font = '10px system-ui';
  for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
    const [px] = w2s(x, 0);
    ctx.strokeStyle = x === 0 ? '#ffffff55' : '#ffffff1c';
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, ch); ctx.stroke();
    ctx.fillStyle = '#ffffff66'; ctx.fillText(String(x), px + 3, ch - 4);
  }
  for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
    const [, py] = w2s(0, y);
    ctx.strokeStyle = y === 0 ? '#ffffff55' : '#ffffff1c';
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(cw, py); ctx.stroke();
    ctx.fillStyle = '#ffffff66'; ctx.fillText(String(y), 3, py - 3);
  }
}

function drawProp(p: PropDef, selected: boolean): void {
  const sz = propSize(p.type);
  const [px, py] = w2s(p.x, p.y);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate((flipY ? 1 : -1) * p.angle);
  const w = Math.max(3, sz.w * view.k), h = Math.max(3, sz.h * view.k);
  ctx.fillStyle = PROP_COLOR[p.type];
  ctx.strokeStyle = selected ? '#ffc93c' : '#0008';
  ctx.lineWidth = selected ? 2.5 : 1;
  ctx.beginPath();
  if (sz.circle) ctx.arc(0, 0, w / 2, 0, Math.PI * 2);
  else ctx.rect(-w / 2, -h / 2, w, h);
  ctx.fill(); ctx.stroke();
  if (p.type === 'tree') { ctx.fillStyle = '#1d6b33'; ctx.beginPath(); ctx.arc(0, 0, w * 0.32, 0, Math.PI * 2); ctx.fill(); }
  if (p.type === 'cone') { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, w * 0.22, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

function draw(): void {
  if (!geom || !stats) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = THEME_GROUND[def.theme];
  ctx.fillRect(0, 0, cw, ch);
  drawGrid();

  const half = def.width / 2;
  // walls (both sides), kind by corner / straight like the game does
  strokeOffset(half + D.wallOffset, D.wall.thickness, WALL_COLOR[def.wallStyle]);
  strokeOffset(-(half + D.wallOffset), D.wall.thickness, WALL_COLOR[def.wallStyle]);
  // road
  strokeOffset(0, def.width, '#3a3d42');
  // curbs on corners
  const S = geom.samples;
  for (const side of [1, -1]) {
    for (let i = 0; i < S.length; i += 1) {
      const a = S[i], b = S[(i + 1) % S.length];
      if (Math.abs(a.curvature) <= D.cornerCurvature) continue;
      const lat = side * (half + D.curb.width / 2);
      const [x1, y1] = w2s(a.x + a.nx * lat, a.y + a.ny * lat);
      const [x2, y2] = w2s(b.x + b.nx * lat, b.y + b.ny * lat);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.lineWidth = Math.max(1, D.curb.width * view.k);
      ctx.strokeStyle = Math.floor(i / 2) % 2 ? '#e8e8e8' : '#d8402f';
      ctx.stroke();
    }
  }
  strokeOffset(half, 0.25, '#ffffffcc');
  strokeOffset(-half, 0.25, '#ffffffcc');
  strokeOffset(0, 0.2, '#ffffff77', [Math.max(2, 3 * view.k), Math.max(2, 3 * view.k)]);

  // clearance conflicts
  ctx.fillStyle = '#ff2bd6';
  for (const c of stats.conflicts) {
    for (const idx of [c.i, c.j]) {
      const s = S[idx];
      const [px, py] = w2s(s.x, s.y);
      ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
    }
  }
  // tightest corner marker
  if (isFinite(stats.minRadius)) {
    let best = S[0];
    for (const s of S) if (Math.abs(s.curvature) > Math.abs(best.curvature)) best = s;
    const [px, py] = w2s(best.x, best.y);
    ctx.strokeStyle = '#ffa01a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ffa01a'; ctx.font = '11px system-ui';
    ctx.fillText('R ' + stats.minRadius.toFixed(0) + ' m', px + 12, py + 4);
  }

  // distance labels + direction arrows
  ctx.font = '11px system-ui';
  for (let s = 100; s < geom.length; s += 100) {
    const c = geom.sampleAt(s);
    const [px, py] = w2s(c.x, c.y);
    ctx.fillStyle = '#fff'; ctx.fillText(String(s) + ' m', px + 6, py - 6);
  }
  for (let s = 40; s < geom.length; s += 80) {
    const c = geom.sampleAt(s);
    const [px, py] = w2s(c.x, c.y);
    const a = (flipY ? 1 : -1) * Math.atan2(c.ty, c.tx);
    ctx.save(); ctx.translate(px, py); ctx.rotate(a);
    ctx.fillStyle = '#ffffffcc';
    ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, -5); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  // start / finish line
  {
    const c = geom.sampleAt(0);
    const [x1, y1] = w2s(c.x + c.nx * half, c.y + c.ny * half), [x2, y2] = w2s(c.x - c.nx * half, c.y - c.ny * half);
    ctx.setLineDash([4, 4]); ctx.strokeStyle = '#ffc93c'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#ffc93c'; ctx.font = 'bold 11px system-ui';
    const [lx, ly] = w2s(c.x + c.nx * (half + 4), c.y + c.ny * (half + 4));
    ctx.fillText('START', lx - 14, ly);
    // grid zone (behind the line)
    ctx.fillStyle = '#ffc93c22';
    ctx.beginPath();
    const g0 = geom.sampleAt(-60), g1 = geom.sampleAt(-1);
    const quad = [[g0, 1], [g1, 1], [g1, -1], [g0, -1]] as const;
    quad.forEach(([q, side], i) => {
      const [px, py] = w2s(q.x + q.nx * half * side, q.y + q.ny * half * side);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.closePath(); ctx.fill();
  }

  // props
  def.props.forEach((p, i) => drawProp(p, i === selProp));

  // control polygon + points
  ctx.strokeStyle = '#ffffff33'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
  ctx.beginPath();
  def.points.forEach((p, i) => { const [px, py] = w2s(p.x, p.y); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
  ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
  def.points.forEach((p, i) => {
    const [px, py] = w2s(p.x, p.y);
    ctx.beginPath(); ctx.arc(px, py, i === 0 ? 8 : 6, 0, Math.PI * 2);
    ctx.fillStyle = i === selPoint ? '#ffc93c' : i === 0 ? '#3ccf6e' : '#ff5a36';
    ctx.fill();
    ctx.strokeStyle = '#000a'; ctx.lineWidth = 1.5; ctx.stroke();
    if (view.k > 1.4 || i === selPoint) { ctx.fillStyle = '#fff'; ctx.font = '10px system-ui'; ctx.fillText(String(i), px + 9, py - 7); }
  });
}

// ---------------------------------------------------------------------------------------------
// interaction
// ---------------------------------------------------------------------------------------------

function mouse(e: MouseEvent | WheelEvent): [number, number] {
  const r = cv.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

function hitPoint(px: number, py: number): number {
  let best = -1, bd = 11;
  def.points.forEach((p, i) => {
    const [sx, sy] = w2s(p.x, p.y);
    const d = Math.hypot(sx - px, sy - py);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}
function hitProp(px: number, py: number): number {
  let best = -1, bd = Infinity;
  def.props.forEach((p, i) => {
    const [sx, sy] = w2s(p.x, p.y);
    const sz = propSize(p.type);
    const rad = Math.max(8, (Math.max(sz.w, sz.h) / 2) * view.k + 3);
    const d = Math.hypot(sx - px, sy - py);
    if (d < rad && d < bd) { bd = d; best = i; }
  });
  return best;
}

function insertIndexFor(x: number, y: number): number {
  const s = geom.nearest(x, y).s;
  let idx = 0;
  for (let k = 0; k < ctrlS.length; k++) if (ctrlS[k] <= s) idx = k;
  return idx + 1;
}

cv.addEventListener('mousedown', (e) => {
  cv.focus?.();
  const [px, py] = mouse(e);
  const w = s2w(px, py);
  if (e.button === 1 || (e.button === 0 && spaceDown)) {
    drag = { kind: 'pan', idx: -1, moved: false, sx: px, sy: py, vx: view.x, vy: view.y };
    e.preventDefault();
    return;
  }
  if (e.button === 2) { // delete
    if (tool === 'props') {
      const i = hitProp(px, py);
      if (i >= 0) { snapshot(); def.props.splice(i, 1); selProp = -1; rebuild(); }
    } else {
      const i = hitPoint(px, py);
      if (i >= 0) deletePoint(i);
    }
    return;
  }
  if (e.button !== 0) return;
  if (tool === 'points') {
    const i = hitPoint(px, py);
    if (i >= 0) {
      selPoint = i;
      snapshot();
      drag = { kind: 'point', idx: i, moved: false, sx: px, sy: py, vx: 0, vy: 0 };
    } else {
      snapshot();
      const at = e.shiftKey ? def.points.length : insertIndexFor(w.x, w.y);
      def.points.splice(at, 0, { x: r1(w.x), y: r1(w.y) });
      selPoint = at;
      rebuild();
    }
  } else {
    const i = hitProp(px, py);
    if (i >= 0) {
      selProp = i;
      snapshot();
      drag = { kind: 'prop', idx: i, moved: false, sx: px, sy: py, vx: 0, vy: 0 };
      syncFields();
      draw();
    } else {
      snapshot();
      const c = geom.sampleAt(geom.nearest(w.x, w.y).s);
      def.props.push({ type: propType, x: r2(w.x), y: r2(w.y), angle: r3(Math.atan2(c.ty, c.tx)) });
      selProp = def.props.length - 1;
      syncFields();
      rebuild();
    }
  }
});

window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  const [px, py] = mouse(e);
  if (Math.hypot(px - drag.sx, py - drag.sy) > 2) drag.moved = true;
  if (drag.kind === 'pan') {
    view.x = drag.vx - (px - drag.sx) / view.k;
    view.y = drag.vy + ((flipY ? -1 : 1) * (py - drag.sy)) / view.k;
    draw();
    return;
  }
  const w = s2w(px, py);
  if (drag.kind === 'point') {
    def.points[drag.idx] = { x: r1(w.x), y: r1(w.y) };
    scheduleRebuild();
  } else {
    const p = def.props[drag.idx];
    p.x = r2(w.x); p.y = r2(w.y);
    scheduleRebuild();
  }
});

window.addEventListener('mouseup', () => {
  if (drag && drag.kind !== 'pan' && !drag.moved) {
    // click without movement: drop the speculative snapshot
    undoStack.pop();
  }
  drag = null;
  rebuild();
});

let rebuildQueued = false;
function scheduleRebuild(): void {
  if (rebuildQueued) return;
  rebuildQueued = true;
  requestAnimationFrame(() => { rebuildQueued = false; rebuild(); });
}

cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  const [px, py] = mouse(e);
  const before = s2w(px, py);
  view.k = Math.min(30, Math.max(0.3, view.k * Math.pow(1.0015, -e.deltaY)));
  const after = s2w(px, py);
  view.x += before.x - after.x;
  view.y += before.y - after.y;
  draw();
}, { passive: false });

function deletePoint(i: number): void {
  if (def.points.length <= 4) { msg('A track needs at least 4 control points.'); return; }
  snapshot();
  def.points.splice(i, 1);
  selPoint = -1;
  rebuild();
}

window.addEventListener('keydown', (e) => {
  const tag = (document.activeElement?.tagName ?? '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
  if (e.code === 'Space' && !typing) { spaceDown = true; e.preventDefault(); return; }
  if (typing) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  switch (e.key) {
    case 'Delete': case 'Backspace': deleteSelected(); break;
    case '1': setTool('points'); break;
    case '2': setTool('props'); break;
    case '0': fitView(); break;
    case 's': case 'S': setStartAtSelected(); break;
    case 'q': case 'Q': rotateSelected(-15); break;
    case 'e': case 'E': rotateSelected(15); break;
    default: break;
  }
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceDown = false; });
window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

function deleteSelected(): void {
  if (tool === 'props' && selProp >= 0) { snapshot(); def.props.splice(selProp, 1); selProp = -1; syncFields(); rebuild(); }
  else if (tool === 'points' && selPoint >= 0) deletePoint(selPoint);
}

function rotateSelected(deg: number): void {
  if (selProp < 0) return;
  snapshot();
  const p = def.props[selProp];
  p.angle = r3(p.angle + (deg * Math.PI) / 180);
  syncFields();
  draw();
}

function setStartAtSelected(): void {
  if (selPoint <= 0) { msg(selPoint === 0 ? 'Point 0 is already the start line.' : 'Select a control point first (Points tool).'); return; }
  snapshot();
  def.points = [...def.points.slice(selPoint), ...def.points.slice(0, selPoint)];
  selPoint = 0;
  msg('Start/finish line moved to the selected point. The grid sits on the 60 m before it: keep it straight.');
  rebuild();
}

// ---------------------------------------------------------------------------------------------
// panel
// ---------------------------------------------------------------------------------------------

function msg(t: string): void { $('msg').textContent = t; }

function setTool(t: Tool): void {
  tool = t;
  $('toolPoints').classList.toggle('on', t === 'points');
  $('toolProps').classList.toggle('on', t === 'props');
  cv.style.cursor = t === 'points' ? 'crosshair' : 'copy';
  draw();
}

function buildPalette(): void {
  const pal = $('palette');
  pal.innerHTML = '';
  for (const t of PROP_TYPES) {
    const b = document.createElement('button');
    b.innerHTML = `<i style="background:${PROP_COLOR[t]}"></i>${t}`;
    b.title = `${D.props[t].w} x ${D.props[t].h} m, ${D.props[t].mass > 0 ? 'dynamic ' + D.props[t].mass + ' kg' : 'static'}`;
    b.classList.toggle('on', t === propType);
    b.addEventListener('click', () => {
      propType = t;
      setTool('props');
      Array.from(pal.children).forEach((c, i) => c.classList.toggle('on', PROP_TYPES[i] === t));
    });
    pal.appendChild(b);
  }
}

function syncFields(): void {
  ($('fId') as HTMLInputElement).value = def.id;
  ($('fName') as HTMLInputElement).value = def.nameKey;
  ($('fTheme') as HTMLSelectElement).value = def.theme;
  ($('fWall') as HTMLSelectElement).value = def.wallStyle;
  ($('fLaps') as HTMLInputElement).value = String(def.laps);
  ($('fWidth') as HTMLInputElement).value = String(def.width);
  const a = $('fAngle') as HTMLInputElement;
  if (selProp >= 0 && def.props[selProp]) {
    a.disabled = false;
    a.value = String(Math.round((def.props[selProp].angle * 180) / Math.PI));
  } else {
    a.disabled = true;
    a.value = '';
  }
}

function bindField(id: string, apply: (v: string) => void): void {
  $(id).addEventListener('change', (e) => {
    snapshot();
    apply((e.target as HTMLInputElement).value);
    rebuild();
  });
}

function loadDef(d: TrackDef): void {
  def = clone(d);
  selPoint = -1; selProp = -1;
  undoStack.length = 0; redoStack.length = 0; dirty = false;
  syncFields();
  rebuild();
  fitView();
}

function fitView(): void {
  const xs = def.points.map((p) => p.x), ys = def.points.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  view.x = (minX + maxX) / 2; view.y = (minY + maxY) / 2;
  const pad = 70;
  view.k = Math.max(0.3, Math.min(30, Math.min(cw / (maxX - minX + pad * 2), ch / (maxY - minY + pad * 2))));
  draw();
}

function fmtJson(d: TrackDef): string {
  const pts = d.points.map((p) => `    { "x": ${r1(p.x)}, "y": ${r1(p.y)} }`).join(',\n');
  const props = d.props.map((p) => `    { "type": "${p.type}", "x": ${r2(p.x)}, "y": ${r2(p.y)}, "angle": ${r3(p.angle)} }`).join(',\n');
  return `{\n  "id": ${JSON.stringify(d.id)},\n  "nameKey": ${JSON.stringify(d.nameKey)},\n  "theme": ${JSON.stringify(d.theme)},\n` +
    `  "laps": ${d.laps},\n  "width": ${d.width},\n  "wallStyle": ${JSON.stringify(d.wallStyle)},\n` +
    `  "points": [\n${pts}\n  ],\n  "props": [\n${props}\n  ]\n}\n`;
}

function parseDef(text: string): TrackDef {
  const o = JSON.parse(text) as Partial<TrackDef>;
  if (!o || typeof o !== 'object') throw new Error('not an object');
  if (!Array.isArray(o.points) || o.points.length < 3) throw new Error('points: need an array of at least 3 {x,y}');
  for (const p of o.points) if (typeof p.x !== 'number' || typeof p.y !== 'number') throw new Error('bad point');
  const props = Array.isArray(o.props) ? o.props : [];
  for (const p of props) if (!PROP_TYPES.includes(p.type) || typeof p.x !== 'number' || typeof p.y !== 'number') throw new Error('bad prop: ' + JSON.stringify(p));
  const themes = ['meadow', 'desert', 'snow'], walls = ['concrete', 'tires', 'fence'];
  return {
    id: String(o.id ?? 'tX'), nameKey: String(o.nameKey ?? 'track.tX'),
    theme: themes.includes(o.theme as string) ? (o.theme as TrackDef['theme']) : 'meadow',
    laps: Math.max(1, Math.round(Number(o.laps ?? 3))), width: Number(o.width ?? 12),
    wallStyle: walls.includes(o.wallStyle as string) ? (o.wallStyle as TrackDef['wallStyle']) : 'concrete',
    points: o.points.map((p) => ({ x: p.x, y: p.y })),
    props: props.map((p) => ({ type: p.type, x: p.x, y: p.y, angle: Number(p.angle ?? 0) })),
  };
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = $('json') as HTMLTextAreaElement;
    ta.value = text; ta.select();
    try { return document.execCommand('copy'); } catch { return false; }
  }
}

function initPanel(): void {
  const sel = $('trackSel') as HTMLSelectElement;
  sel.innerHTML = TRACKS.map((t) => `<option value="${t.id}">${t.id} - ${t.theme}</option>`).join('') + '<option value="__new">New blank track</option>';
  sel.addEventListener('change', () => {
    if (dirty && !window.confirm('Discard unsaved changes?')) { sel.value = def.id; return; }
    if (sel.value === '__new') {
      const pts: Vec2[] = [];
      for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; pts.push({ x: r1(140 * Math.cos(a)), y: r1(90 * Math.sin(a)) }); }
      loadDef({ id: 't4', nameKey: 'track.t4', theme: 'meadow', laps: 3, width: 12, wallStyle: 'concrete', points: pts, props: [] });
      return;
    }
    const t = TRACKS.find((x) => x.id === sel.value);
    if (t) loadDef(t);
  });
  bindField('fId', (v) => { def.id = v.trim() || def.id; });
  bindField('fName', (v) => { def.nameKey = v.trim() || def.nameKey; });
  bindField('fTheme', (v) => { def.theme = v as TrackDef['theme']; });
  bindField('fWall', (v) => { def.wallStyle = v as TrackDef['wallStyle']; });
  bindField('fLaps', (v) => { def.laps = Math.max(1, Math.round(Number(v) || 3)); });
  bindField('fWidth', (v) => { def.width = Math.min(24, Math.max(6, Number(v) || def.width)); });
  $('fAngle').addEventListener('change', (e) => {
    if (selProp < 0) return;
    snapshot();
    def.props[selProp].angle = r3((Number((e.target as HTMLInputElement).value) * Math.PI) / 180);
    draw();
  });
  $('toolPoints').addEventListener('click', () => setTool('points'));
  $('toolProps').addEventListener('click', () => setTool('props'));
  $('btnStart').addEventListener('click', setStartAtSelected);
  $('btnDel').addEventListener('click', deleteSelected);
  $('btnUndo').addEventListener('click', undo);
  $('btnRedo').addEventListener('click', redo);
  $('btnFit').addEventListener('click', fitView);
  $('btnAuto').addEventListener('click', () => {
    if (def.props.length && !window.confirm('Replace all props with auto-generated dressing?')) return;
    snapshot();
    def.props = autoProps(def, 1 + (undoStack.length % 97));
    selProp = -1;
    syncFields();
    rebuild();
    msg(`Generated ${def.props.length} props.`);
  });
  $('btnClear').addEventListener('click', () => {
    if (!def.props.length) return;
    snapshot(); def.props = []; selProp = -1; syncFields(); rebuild();
  });
  $('btnFlip').addEventListener('click', () => {
    flipY = !flipY;
    $('flipState').textContent = flipY ? 'down' : 'up';
    draw();
  });
  $('btnCopy').addEventListener('click', async () => {
    const text = fmtJson(def);
    ($('json') as HTMLTextAreaElement).value = text;
    msg((await copyText(text)) ? 'Copied TrackDef JSON to the clipboard.' : 'Clipboard blocked: copy from the box below.');
  });
  $('btnShow').addEventListener('click', () => { ($('json') as HTMLTextAreaElement).value = fmtJson(def); msg('JSON shown below.'); });
  $('btnDl').addEventListener('click', () => {
    const blob = new Blob([fmtJson(def)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${def.id}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    dirty = false;
    msg('Downloaded ' + a.download);
  });
  $('btnImport').addEventListener('click', () => {
    try {
      const d = parseDef(($('json') as HTMLTextAreaElement).value);
      loadDef(d);
      dirty = true;
      msg(`Imported ${d.id}: ${d.points.length} points, ${d.props.length} props.`);
    } catch (err) {
      msg('Import failed: ' + (err as Error).message);
    }
  });
  buildPalette();
  setTool('points');
  syncFields();
}

function resize(): void {
  const r = cv.getBoundingClientRect();
  dpr = Math.min(2, window.devicePixelRatio || 1);
  cw = Math.max(1, r.width); ch = Math.max(1, r.height);
  cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
  draw();
}
window.addEventListener('resize', resize);

initPanel();
resize();
rebuild();
fitView();

// debug / test hook (dev tool only)
(window as unknown as { __editor: unknown }).__editor = {
  get def() { return def; },
  get stats() { return stats; },
  json: () => fmtJson(def),
  load: (d: TrackDef) => loadDef(d),
};
