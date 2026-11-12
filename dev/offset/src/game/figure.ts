// Procedural 2D figure: pose solver + printed-silhouette drawing. Shared by the hero and the Register.
import { Renderer, Ink, ink, inkAlpha } from '../gfx/gl';
import { clamp, lerp, TAU } from '../core/math';

export interface PoseIn {
  x: number; y: number;        // capsule centre
  face: number;                // -1 | 1
  rot: number;                 // whole-body rotation (tumbling)
  phase: number;               // run cycle phase (rad)
  speed: number;               // |vx| normalised 0..1
  vy: number; grounded: boolean;
  aim: number | null;          // aim angle (world) or null
  strike: number;              // 0..1 progress (0 = none)
  strikeAng: number;
  carry: boolean;
  squash: number;              // landing squash 0..1
  hurt: number;                // flinch 0..1
  t: number;                   // time for idle motion
  scale: number;
  flail?: number;              // 0..1 ragdoll-ish limb flail
  guard?: boolean;             // shield stance
  windup?: number;             // 0..1 attack telegraph (arm raised)
  crouch?: number;
}
export const J = { hip: 0, chest: 1, head: 2, shL: 3, elL: 4, haL: 5, shR: 6, elR: 7, haR: 8, knL: 9, ftL: 10, knR: 11, ftR: 12, N: 13 } as const;
export type Pose = Float32Array; // 2*N

const L_UP = 0.4, L_LO = 0.42, A_UP = 0.29, A_LO = 0.3;

function ik(out: Float32Array, jo: number, rx: number, ry: number, tx: number, ty: number, l1: number, l2: number, bend: number) {
  let dx = tx - rx, dy = ty - ry; let d = Math.hypot(dx, dy); const max = l1 + l2 - 0.001;
  if (d > max) { dx *= max / d; dy *= max / d; d = max; } if (d < 0.02) { d = 0.02; dy = 0.02; }
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d); const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const mx = rx + (dx * a) / d, my = ry + (dy * a) / d;
  out[jo * 2] = mx + (-dy / d) * h * bend; out[jo * 2 + 1] = my + (dx / d) * h * bend;
  return d;
}

export function solvePose(p: PoseIn, out: Pose): Pose {
  const f = p.face; const sp = p.speed; const ph = p.phase;
  const idle = Math.sin(p.t * 2.1) * 0.012;
  const sq = p.squash; const cr = p.crouch ?? 0;
  // local space: origin = capsule centre, feet at +0.8
  let hipY = 0.06 + sq * 0.2 + cr * 0.16 + (p.grounded ? Math.abs(Math.sin(ph)) * 0.035 * sp : 0) - idle;
  const lean = p.grounded ? sp * 0.2 * f : clamp(-p.vy * 0.008, -0.12, 0.2) * f;
  const hipX = 0;
  let chX = hipX + lean * 0.9 + (p.hurt ? -f * 0.1 * p.hurt : 0), chY = hipY - 0.4 + sq * 0.06 + cr * 0.05 + idle;
  let hdX = chX + lean * 0.55, hdY = chY - 0.31 + sq * 0.03;
  // ---- legs
  let fLx: number, fLy: number, fRx: number, fRy: number;
  const floor = 0.8;
  if (p.grounded) {
    const stride = 0.44 * sp; const lift = 0.24 * sp;
    fLx = hipX + Math.cos(ph) * stride * f; fLy = floor - Math.max(0, Math.sin(ph)) * lift;
    fRx = hipX + Math.cos(ph + Math.PI) * stride * f; fRy = floor - Math.max(0, Math.sin(ph + Math.PI)) * lift;
    if (sp < 0.05) { fLx = hipX - 0.13; fRx = hipX + 0.13; fLy = fRy = floor; }
  } else {
    const up = clamp(-p.vy / 14, -1, 1); // 1 rising, -1 falling
    fLx = hipX + f * (0.2 + 0.1 * up); fLy = hipY + 0.5 - 0.14 * Math.max(0, up);
    fRx = hipX - f * (0.24 - 0.05 * up); fRy = hipY + 0.62 + 0.1 * Math.min(0, up);
  }
  // strike = kick with the front leg
  if (p.strike > 0) {
    const k = Math.sin(Math.min(1, p.strike * 1.35) * Math.PI); const a = p.strikeAng;
    const tx = hipX + Math.cos(a) * 0.86, ty = hipY + Math.sin(a) * 0.86;
    fLx = lerp(fLx, tx, k); fLy = lerp(fLy, ty, k);
    chX -= Math.cos(a) * 0.14 * k; chY += 0.03 * k; hdX -= Math.cos(a) * 0.1 * k;
  }
  const fl = p.flail ?? 0;
  if (fl > 0) {
    const a1 = p.t * 13, a2 = p.t * 11 + 2;
    fLx = lerp(fLx, hipX + Math.cos(a1) * 0.6, fl); fLy = lerp(fLy, hipY + 0.3 + Math.sin(a1) * 0.45, fl);
    fRx = lerp(fRx, hipX + Math.cos(a2) * 0.6, fl); fRy = lerp(fRy, hipY + 0.3 + Math.sin(a2) * 0.45, fl);
  }
  const o = out;
  o[J.hip * 2] = hipX; o[J.hip * 2 + 1] = hipY; o[J.chest * 2] = chX; o[J.chest * 2 + 1] = chY; o[J.head * 2] = hdX; o[J.head * 2 + 1] = hdY;
  ik(o, J.knL, hipX, hipY, fLx, fLy, L_UP, L_LO, -f); ik(o, J.knR, hipX, hipY, fRx, fRy, L_UP, L_LO, -f);
  o[J.ftL * 2] = fLx; o[J.ftL * 2 + 1] = fLy; o[J.ftR * 2] = fRx; o[J.ftR * 2 + 1] = fRy;
  // clamp feet to reach
  for (const [kn, ft] of [[J.knL, J.ftL], [J.knR, J.ftR]] as const) {
    const dx = o[ft * 2] - hipX, dy = o[ft * 2 + 1] - hipY; const d = Math.hypot(dx, dy); const m = L_UP + L_LO - 0.001;
    if (d > m) { o[ft * 2] = hipX + (dx * m) / d; o[ft * 2 + 1] = hipY + (dy * m) / d; }
  }
  // ---- arms
  const shX = chX, shY = chY - 0.02;
  o[J.shL * 2] = shX; o[J.shL * 2 + 1] = shY; o[J.shR * 2] = shX; o[J.shR * 2 + 1] = shY;
  let hLx: number, hLy: number, hRx: number, hRy: number;
  if (p.grounded) {
    const sw = Math.cos(ph) * 0.34 * sp;
    hLx = shX - sw * f + 0.03 * f; hLy = shY + 0.48 - Math.abs(sw) * 0.35;
    hRx = shX + sw * f + 0.03 * f; hRy = shY + 0.48 - Math.abs(sw) * 0.35;
  } else {
    const up = clamp(-p.vy / 14, -1, 1);
    hLx = shX + f * 0.3; hLy = shY + 0.25 - 0.3 * Math.max(0, -up) - 0.05;
    hRx = shX - f * 0.36; hRy = shY + 0.1 - 0.42 * Math.max(0, -up);
  }
  if (p.aim !== null) { const a = p.aim; hLx = shX + Math.cos(a) * 0.57; hLy = shY + Math.sin(a) * 0.57; hRx = shX - f * 0.2; hRy = shY + 0.42; }
  if (p.carry) { hLx = shX + f * 0.42; hLy = shY - 0.42; hRx = shX + f * 0.2; hRy = shY - 0.5; }
  if (p.guard) { hLx = shX + f * 0.44; hLy = shY + 0.1; hRx = shX + f * 0.3; hRy = shY + 0.3; }
  const wu = p.windup ?? 0;
  if (wu > 0) { hLx = lerp(hLx, shX - f * 0.25, wu); hLy = lerp(hLy, shY - 0.55, wu); }
  if (p.strike > 0) { const k = Math.sin(Math.min(1, p.strike * 1.35) * Math.PI); hLx = lerp(hLx, shX - Math.cos(p.strikeAng) * 0.4, k); hLy = lerp(hLy, shY + 0.1, k); hRx = lerp(hRx, shX - Math.cos(p.strikeAng) * 0.3, k); hRy = lerp(hRy, shY - 0.2, k); }
  if (fl > 0) { const a1 = p.t * 12 + 1, a2 = p.t * 10 + 4; hLx = lerp(hLx, shX + Math.cos(a1) * 0.5, fl); hLy = lerp(hLy, shY + Math.sin(a1) * 0.5, fl); hRx = lerp(hRx, shX + Math.cos(a2) * 0.5, fl); hRy = lerp(hRy, shY + Math.sin(a2) * 0.5, fl); }
  ik(o, J.elL, shX, shY, hLx, hLy, A_UP, A_LO, f); ik(o, J.elR, shX, shY, hRx, hRy, A_UP, A_LO, f);
  o[J.haL * 2] = hLx; o[J.haL * 2 + 1] = hLy; o[J.haR * 2] = hRx; o[J.haR * 2 + 1] = hRy;
  for (const [el, ha] of [[J.elL, J.haL], [J.elR, J.haR]] as const) {
    const dx = o[ha * 2] - shX, dy = o[ha * 2 + 1] - shY; const d = Math.hypot(dx, dy); const m = A_UP + A_LO - 0.001;
    if (d > m) { o[ha * 2] = shX + (dx * m) / d; o[ha * 2 + 1] = shY + (dy * m) / d; }
  }
  // ---- to world
  const c = Math.cos(p.rot) * p.scale, s = Math.sin(p.rot) * p.scale;
  for (let i = 0; i < J.N; i++) { const lx = o[i * 2], ly = o[i * 2 + 1]; o[i * 2] = p.x + lx * c - ly * s; o[i * 2 + 1] = p.y + lx * s + ly * c; }
  return o;
}

export interface FigStyle {
  body: Ink; back: Ink; accent: Ink;
  kind: 'hero' | 'grunt' | 'shooter' | 'shield' | 'heavy' | 'tracer';
  bulk: number; // limb thickness multiplier
}
/** draw the silhouette. ox,oy = offset (for ghost prints / misregistered layers) */
export function drawFigure(R: Renderer, P: Pose, st: FigStyle, face: number, scale: number, ox = 0, oy = 0, override: Ink | 0 = 0, alpha = 1) {
  const b = st.bulk * scale; const body = override ? override : st.body, back = override ? override : st.back;
  const kb = alpha < 1 ? inkAlpha(body, alpha) : body, kk = alpha < 1 ? inkAlpha(back, alpha) : back;
  const X = (j: number) => P[j * 2] + ox, Y = (j: number) => P[j * 2 + 1] + oy;
  // back limbs
  R.capsule(X(J.hip), Y(J.hip), X(J.knR), Y(J.knR), 0.105 * b, 0.085 * b, kk); R.capsule(X(J.knR), Y(J.knR), X(J.ftR), Y(J.ftR), 0.085 * b, 0.06 * b, kk);
  R.capsule(X(J.shR), Y(J.shR), X(J.elR), Y(J.elR), 0.075 * b, 0.06 * b, kk); R.capsule(X(J.elR), Y(J.elR), X(J.haR), Y(J.haR), 0.06 * b, 0.05 * b, kk);
  // torso: tapered quad hip→chest (+ coat tail for the hero)
  const hx = X(J.hip), hy = Y(J.hip), cx = X(J.chest), cy = Y(J.chest);
  let dx = cx - hx, dy = cy - hy; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l; const nx = -dy, ny = dx;
  const wh = 0.15 * b, wc = (st.kind === 'heavy' ? 0.27 : st.kind === 'shield' ? 0.22 : 0.19) * b;
  R.quad(hx + nx * wh, hy + ny * wh, cx + nx * wc + dx * 0.08, cy + ny * wc + dy * 0.08, cx - nx * wc + dx * 0.08, cy - ny * wc + dy * 0.08, hx - nx * wh, hy - ny * wh, kb);
  R.circle(hx, hy, wh, kb, 10); R.circle(cx + dx * 0.04, cy + dy * 0.04, wc * 0.98, kb, 12);
  if (st.kind === 'hero') {
    // coat tail trailing behind
    const tx = hx - face * 0.3 * scale - dx * 0.1, ty = hy + 0.3 * scale;
    R.tri(hx - nx * wh * face, hy - ny * wh * face, hx + nx * wh * face * 0.4, hy + ny * wh * 0.4 + 0.1 * scale, tx, ty, kb);
  }
  // head
  const ex = X(J.head), ey = Y(J.head);
  if (st.kind === 'hero') {
    R.circle(ex, ey, 0.165 * scale, kb, 14);
    // hood peak pointing back
    R.tri(ex - face * 0.05 * scale, ey - 0.165 * scale, ex - face * 0.31 * scale, ey + 0.02 * scale, ex - face * 0.03 * scale, ey + 0.15 * scale, kb);
    if (!override) R.quad(ex + face * 0.03 * scale, ey - 0.035 * scale, ex + face * 0.17 * scale, ey - 0.05 * scale, ex + face * 0.165 * scale, ey + 0.015 * scale, ex + face * 0.04 * scale, ey + 0.02 * scale, ink(0, 0, 0, alpha));
  } else {
    // Register: squared helmet with a registration cross
    const hs = (st.kind === 'heavy' ? 0.2 : 0.17) * scale; const hc = Math.cos(0), a = Math.atan2(ey - cy, ex - cx) + Math.PI / 2; const c = Math.cos(a), s = Math.sin(a);
    const q = (lx: number, ly: number): [number, number] => [ex + lx * c - ly * s, ey + lx * s + ly * c];
    const p0 = q(-hs, -hs), p1 = q(hs, -hs), p2 = q(hs, hs * 0.9), p3 = q(-hs, hs * 0.9);
    R.quad(p0[0], p0[1], p1[0], p1[1], p2[0], p2[1], p3[0], p3[1], kb);
    if (!override) {
      const ac = alpha < 1 ? inkAlpha(st.accent, alpha) : st.accent;
      const v0 = q(face * hs * 0.1, -hs * 0.28), v1 = q(face * hs * 1.02, -hs * 0.28), v2 = q(face * hs * 1.02, hs * 0.18), v3 = q(face * hs * 0.1, hs * 0.18);
      R.quad(v0[0], v0[1], v1[0], v1[1], v2[0], v2[1], v3[0], v3[1], ink(0, 0, 0, alpha)); R.quad(v0[0], v0[1], v1[0], v1[1], v2[0], v2[1], v3[0], v3[1], ac);
    }
  }
  // front limbs
  R.capsule(X(J.hip), Y(J.hip), X(J.knL), Y(J.knL), 0.11 * b, 0.09 * b, kb); R.capsule(X(J.knL), Y(J.knL), X(J.ftL), Y(J.ftL), 0.09 * b, 0.065 * b, kb);
  R.capsule(X(J.shL), Y(J.shL), X(J.elL), Y(J.elL), 0.08 * b, 0.065 * b, kb); R.capsule(X(J.elL), Y(J.elL), X(J.haL), Y(J.haL), 0.065 * b, 0.055 * b, kb);
  // feet
  R.capsule(X(J.ftL), Y(J.ftL), X(J.ftL) + face * 0.12 * scale, Y(J.ftL) + 0.01, 0.06 * b, 0.045 * b, kb);
  R.capsule(X(J.ftR), Y(J.ftR), X(J.ftR) + face * 0.12 * scale, Y(J.ftR) + 0.01, 0.055 * b, 0.04 * b, kk);
}

/** verlet ribbon (scarf / tape) */
export class Ribbon {
  p: Float32Array; q: Float32Array; n: number;
  constructor(n: number, public seg: number) { this.n = n; this.p = new Float32Array(n * 2); this.q = new Float32Array(n * 2); }
  reset(x: number, y: number) { for (let i = 0; i < this.n; i++) { this.p[i * 2] = this.q[i * 2] = x; this.p[i * 2 + 1] = this.q[i * 2 + 1] = y + i * 0.01; } }
  shift(dx: number, dy: number) { for (let i = 0; i < this.n * 2; i += 2) { this.p[i] += dx; this.q[i] += dx; this.p[i + 1] += dy; this.q[i + 1] += dy; } }
  update(ax: number, ay: number, dt: number, windX: number, t: number, g = 9) {
    const p = this.p, q = this.q; p[0] = ax; p[1] = ay; q[0] = ax; q[1] = ay; const d2 = dt * dt;
    for (let i = 1; i < this.n; i++) {
      const x = p[i * 2], y = p[i * 2 + 1]; const vx = (x - q[i * 2]) * 0.965, vy = (y - q[i * 2 + 1]) * 0.965;
      q[i * 2] = x; q[i * 2 + 1] = y;
      p[i * 2] = x + vx + (windX + Math.sin(t * 9 + i * 1.3) * 5) * d2; p[i * 2 + 1] = y + vy + (g + Math.cos(t * 7 + i) * 3) * d2;
    }
    for (let k = 0; k < 2; k++) for (let i = 1; i < this.n; i++) {
      const dx = p[i * 2] - p[i * 2 - 2], dy = p[i * 2 + 1] - p[i * 2 - 1]; const d = Math.hypot(dx, dy) || 1e-4; const e = (d - this.seg) / d;
      if (i === 1) { p[i * 2] -= dx * e; p[i * 2 + 1] -= dy * e; } else { p[i * 2] -= dx * e * 0.5; p[i * 2 + 1] -= dy * e * 0.5; p[i * 2 - 2] += dx * e * 0.5; p[i * 2 - 1] += dy * e * 0.5; }
    }
  }
  draw(R: Renderer, w0: number, w1: number, k: Ink) { R.strip(this.p, this.n, w0, w1, k); for (let i = 1; i < this.n - 1; i++) R.circle(this.p[i * 2], this.p[i * 2 + 1], (w0 + (w1 - w0) * (i / (this.n - 1))) * 0.5, k, 6); }
}
