// Plate renderer: the scene is drawn as ink DENSITY of three printing plates (R,G,B channels),
// then a composite pass "prints" the plates onto paper (halftone, grain, misregistration, warps).
import { TAU } from '../core/math';

export type Ink = number; // packed ABGR uint32 (little endian → bytes r,g,b,a)
/** ink densities 0..1 for plate A (key), B (accent), C (third), alpha */
export const ink = (a: number, b: number, c: number, al = 1): Ink =>
  (((al * 255) & 255) << 24 | ((c * 255) & 255) << 16 | ((b * 255) & 255) << 8 | ((a * 255) & 255)) >>> 0;
export const inkAlpha = (k: Ink, al: number): Ink => ((k & 0x00ffffff) | (((al * 255) & 255) << 24)) >>> 0;
export const PAPER = ink(0, 0, 0, 1);

export const enum Blend { Alpha = 0, Add = 1 }

const VS = `#version 300 es
layout(location=0) in vec2 aPos; layout(location=1) in vec4 aInk;
uniform vec4 uCam; // sx, sy, ox, oy  → clip = pos*s + o
out vec4 vInk;
void main(){ vInk = aInk; gl_Position = vec4(aPos*uCam.xy + uCam.zw, 0.0, 1.0); }`;
const FS = `#version 300 es
precision mediump float; in vec4 vInk; out vec4 o;
void main(){ o = vInk; }`;

const PVS = `#version 300 es
layout(location=0) in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.0,1.0); }`;
const PFS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uPlates;
uniform vec2 uRes;        // drawing buffer px
uniform float uPx;        // device px per css px
uniform vec3 uInkA, uInkB, uInkC, uPaper;
uniform vec2 uOffA, uOffB, uOffC; // misregistration in px
uniform float uTime, uGrain, uFlash, uDesat, uVig;
uniform vec4 uWarp[6];    // x,y (px), radius(px), strength(px)
uniform vec2 uScroll;     // world scroll in px (so paper texture sticks to the world a bit)

float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
float dots(vec2 px, float d, float ang, float cell){
  float c=cos(ang), s=sin(ang);
  vec2 p = vec2(c*px.x - s*px.y, s*px.x + c*px.y)/cell;
  vec2 g = fract(p)-0.5;
  float r = 0.78*sqrt(clamp(d,0.0,1.0));
  float aa = 0.9/cell;
  float dotv = smoothstep(r+aa, r-aa, length(g));
  return mix(dotv, 1.0, smoothstep(0.86, 0.97, d));
}
void main(){
  vec2 px = vUv*uRes;
  // radial warps (pressure waves / implosions)
  vec2 disp = vec2(0.0);
  for(int i=0;i<6;i++){
    vec4 w = uWarp[i]; if(w.z<=0.0) continue;
    vec2 d = px - w.xy; float l = length(d)+0.001;
    float t = (l - w.z)/(0.22*w.z+18.0*uPx);
    float prof = exp(-t*t);
    disp += (d/l)*prof*w.w;
  }
  px -= disp;
  vec2 uv = px/uRes;
  vec2 ipx = 1.0/uRes;
  float a = texture(uPlates, uv + uOffA*ipx).r;
  float b = texture(uPlates, uv + uOffB*ipx).g;
  float c = texture(uPlates, uv + uOffC*ipx).b;
  float cell = 4.3*uPx;
  vec2 wp = px + uScroll;
  float ca = dots(wp + uOffA, a, 0.262, cell);
  float cb = dots(wp + uOffB, b, 1.309, cell*0.94);
  float cc = dots(wp + uOffC, c, 0.785, cell*1.08);
  // ink is never laid evenly: grain + roller streaks
  float n1 = vnoise(wp*0.9/uPx), n2 = vnoise(wp*0.11/uPx + 7.0), n3 = vnoise(vec2(wp.x*0.013, wp.y*0.6)/uPx);
  float g = uGrain;
  ca *= 1.0 - g*(0.15*n1 + 0.09*n2 + 0.05*n3);
  cb *= 1.0 - g*(0.12*n1 + 0.10*vnoise(wp*0.09/uPx+31.0));
  cc *= 1.0 - g*(0.14*n1 + 0.10*vnoise(wp*0.1/uPx+57.0));
  // paper: fibres + mottling
  float fib = vnoise(vec2(wp.x*0.5, wp.y*0.06)/uPx)*0.5 + vnoise(wp*0.035/uPx)*0.5;
  vec3 col = uPaper*(0.955 + 0.06*fib) - 0.018*h21(floor(wp/uPx));
  col *= mix(vec3(1.0), uInkC, cc);
  col *= mix(vec3(1.0), uInkB, cb);
  col *= mix(vec3(1.0), uInkA, ca);
  // vignette as heavier paper tone at the edges
  vec2 q = vUv-0.5; col *= 1.0 - uVig*dot(q,q)*0.55;
  float lum = dot(col, vec3(0.3,0.59,0.11));
  col = mix(col, vec3(lum)*uPaper*1.08, uDesat);
  col = mix(col, uPaper*1.04, uFlash);
  o = vec4(col,1.0);
}`;

function sh(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
  return s;
}
function prog(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const p = gl.createProgram()!; gl.attachShader(p, sh(gl, gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
  return p;
}

export interface InkSet { a: [number, number, number]; b: [number, number, number]; c: [number, number, number]; paper: [number, number, number] }
export const hex = (h: string): [number, number, number] => { const n = parseInt(h.replace('#', ''), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

const MAXV = 120000, MAXI = 360000;

export class Renderer {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  w = 1; h = 1; dpr = 1;
  private p: WebGLProgram; private pp: WebGLProgram;
  private vbuf: WebGLBuffer; private ibuf: WebGLBuffer; private vao: WebGLVertexArrayObject; private qvao: WebGLVertexArrayObject;
  private f32 = new Float32Array(MAXV * 3); private u32 = new Uint32Array(this.f32.buffer);
  private idx = new Uint32Array(MAXI);
  private nv = 0; private ni = 0;
  private blend: Blend = Blend.Alpha;
  private cam = new Float32Array(4);
  private uCam: WebGLUniformLocation;
  private U: Record<string, WebGLUniformLocation | null> = {};
  private msFbo: WebGLFramebuffer | null = null; private msRb: WebGLRenderbuffer | null = null;
  private fbo: WebGLFramebuffer | null = null; private tex: WebGLTexture | null = null;
  private samples = 4;
  // post params
  inks: InkSet = { a: hex('#252A7C'), b: hex('#FF4F3F'), c: hex('#F5B915'), paper: hex('#EDE3CF') };
  offA = [0, 0]; offB = [0, 0]; offC = [0, 0];
  warps = new Float32Array(24);
  grain = 1; flash = 0; desat = 0; vig = 0.5; time = 0; scroll = [0, 0];
  drawCalls = 0; vertsDrawn = 0;
  lost = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.p = prog(gl, VS, FS); this.pp = prog(gl, PVS, PFS);
    this.uCam = gl.getUniformLocation(this.p, 'uCam')!;
    for (const n of ['uPlates', 'uRes', 'uPx', 'uInkA', 'uInkB', 'uInkC', 'uPaper', 'uOffA', 'uOffB', 'uOffC', 'uTime', 'uGrain', 'uFlash', 'uDesat', 'uVig', 'uWarp', 'uScroll'])
      this.U[n] = gl.getUniformLocation(this.pp, n);
    this.vbuf = gl.createBuffer()!; this.ibuf = gl.createBuffer()!;
    this.vao = gl.createVertexArray()!; gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbuf); gl.bufferData(gl.ARRAY_BUFFER, this.f32.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 12, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, true, 12, 8);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibuf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.idx.byteLength, gl.DYNAMIC_DRAW);
    this.qvao = gl.createVertexArray()!; gl.bindVertexArray(this.qvao);
    const qb = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) as number);
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => { location.reload(); });
  }

  resize(cssW: number, cssH: number, dpr: number) {
    const w = Math.max(2, Math.round(cssW * dpr)), h = Math.max(2, Math.round(cssH * dpr));
    if (w === this.w && h === this.h && this.fbo) return;
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = w; this.canvas.height = h;
    const gl = this.gl;
    if (this.tex) gl.deleteTexture(this.tex); if (this.fbo) gl.deleteFramebuffer(this.fbo);
    if (this.msRb) gl.deleteRenderbuffer(this.msRb); if (this.msFbo) gl.deleteFramebuffer(this.msFbo);
    this.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    this.msRb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, this.msRb);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.RGBA8, w, h);
    this.msFbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.msRb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  begin() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFbo);
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.p); gl.bindVertexArray(this.vao);
    gl.enable(gl.BLEND); this.blend = Blend.Alpha; gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.nv = 0; this.ni = 0; this.drawCalls = 0; this.vertsDrawn = 0;
  }
  /** world→clip: cx,cy = world centre, ppm = device px per metre */
  setCamera(cx: number, cy: number, ppm: number, rot = 0) {
    this.flush();
    const sx = (2 * ppm) / this.w, sy = (-2 * ppm) / this.h;
    this.cam[0] = sx; this.cam[1] = sy; this.cam[2] = -cx * sx; this.cam[3] = -cy * sy;
    this.gl.uniform4fv(this.uCam, this.cam);
  }
  setBlend(b: Blend) {
    if (b === this.blend) return; this.flush(); this.blend = b; const gl = this.gl;
    if (b === Blend.Alpha) gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); else gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  }
  flush() {
    if (!this.ni) { this.nv = 0; return; }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.f32, 0, this.nv * 3);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibuf); gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, this.idx, 0, this.ni);
    gl.drawElements(gl.TRIANGLES, this.ni, gl.UNSIGNED_INT, 0);
    this.drawCalls++; this.vertsDrawn += this.nv; this.nv = 0; this.ni = 0;
  }
  end() {
    this.flush();
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msFbo); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fbo);
    gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h); gl.disable(gl.BLEND);
    gl.useProgram(this.pp); gl.bindVertexArray(this.qvao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    const U = this.U, k = this.inks;
    gl.uniform1i(U.uPlates, 0); gl.uniform2f(U.uRes, this.w, this.h); gl.uniform1f(U.uPx, this.dpr);
    gl.uniform3fv(U.uInkA, k.a); gl.uniform3fv(U.uInkB, k.b); gl.uniform3fv(U.uInkC, k.c); gl.uniform3fv(U.uPaper, k.paper);
    const d = this.dpr;
    gl.uniform2f(U.uOffA, this.offA[0] * d, -this.offA[1] * d); gl.uniform2f(U.uOffB, this.offB[0] * d, -this.offB[1] * d); gl.uniform2f(U.uOffC, this.offC[0] * d, -this.offC[1] * d);
    gl.uniform1f(U.uTime, this.time); gl.uniform1f(U.uGrain, this.grain); gl.uniform1f(U.uFlash, this.flash); gl.uniform1f(U.uDesat, this.desat); gl.uniform1f(U.uVig, this.vig);
    gl.uniform4fv(U.uWarp, this.warps); gl.uniform2f(U.uScroll, this.scroll[0], this.scroll[1]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  // ---------------- primitives (world units) ----------------
  private room(v: number, i: number) { if (this.nv + v > MAXV || this.ni + i > MAXI) this.flush(); }
  tri(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, k: Ink) {
    this.room(3, 3); const f = this.f32, u = this.u32; let o = this.nv * 3; const b = this.nv;
    f[o] = x0; f[o + 1] = y0; u[o + 2] = k; f[o + 3] = x1; f[o + 4] = y1; u[o + 5] = k; f[o + 6] = x2; f[o + 7] = y2; u[o + 8] = k;
    const ix = this.idx; ix[this.ni++] = b; ix[this.ni++] = b + 1; ix[this.ni++] = b + 2; this.nv += 3;
  }
  quad(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, k: Ink) {
    this.room(4, 6); const f = this.f32, u = this.u32; const o = this.nv * 3; const b = this.nv;
    f[o] = x0; f[o + 1] = y0; u[o + 2] = k; f[o + 3] = x1; f[o + 4] = y1; u[o + 5] = k; f[o + 6] = x2; f[o + 7] = y2; u[o + 8] = k; f[o + 9] = x3; f[o + 10] = y3; u[o + 11] = k;
    const ix = this.idx; ix[this.ni++] = b; ix[this.ni++] = b + 1; ix[this.ni++] = b + 2; ix[this.ni++] = b; ix[this.ni++] = b + 2; ix[this.ni++] = b + 3; this.nv += 4;
  }
  /** quad with per-corner inks (gradients become halftone ramps) */
  quadG(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, k0: Ink, k1: Ink, k2: Ink, k3: Ink) {
    this.room(4, 6); const f = this.f32, u = this.u32; const o = this.nv * 3; const b = this.nv;
    f[o] = x0; f[o + 1] = y0; u[o + 2] = k0; f[o + 3] = x1; f[o + 4] = y1; u[o + 5] = k1; f[o + 6] = x2; f[o + 7] = y2; u[o + 8] = k2; f[o + 9] = x3; f[o + 10] = y3; u[o + 11] = k3;
    const ix = this.idx; ix[this.ni++] = b; ix[this.ni++] = b + 1; ix[this.ni++] = b + 2; ix[this.ni++] = b; ix[this.ni++] = b + 2; ix[this.ni++] = b + 3; this.nv += 4;
  }
  rect(x: number, y: number, w: number, h: number, k: Ink) { this.quad(x, y, x + w, y, x + w, y + h, x, y + h, k); }
  rectG(x: number, y: number, w: number, h: number, top: Ink, bot: Ink) { this.quadG(x, y, x + w, y, x + w, y + h, x, y + h, top, top, bot, bot); }
  /** convex polygon, flat [x,y,...] in world space */
  poly(p: ArrayLike<number>, k: Ink) {
    const n = p.length >> 1; if (n < 3) return; this.room(n, (n - 2) * 3);
    const f = this.f32, u = this.u32; let o = this.nv * 3; const b = this.nv;
    for (let i = 0; i < n; i++) { f[o] = p[i * 2]; f[o + 1] = p[i * 2 + 1]; u[o + 2] = k; o += 3; }
    const ix = this.idx; for (let i = 1; i < n - 1; i++) { ix[this.ni++] = b; ix[this.ni++] = b + i; ix[this.ni++] = b + i + 1; }
    this.nv += n;
  }
  /** convex polygon in local space transformed by (x,y,rot) and optional scale about local point */
  polyT(p: ArrayLike<number>, x: number, y: number, c: number, s: number, k: Ink, sc = 1) {
    const n = p.length >> 1; if (n < 3) return; this.room(n, (n - 2) * 3);
    const f = this.f32, u = this.u32; let o = this.nv * 3; const b = this.nv;
    for (let i = 0; i < n; i++) { const lx = p[i * 2] * sc, ly = p[i * 2 + 1] * sc; f[o] = x + lx * c - ly * s; f[o + 1] = y + lx * s + ly * c; u[o + 2] = k; o += 3; }
    const ix = this.idx; for (let i = 1; i < n - 1; i++) { ix[this.ni++] = b; ix[this.ni++] = b + i; ix[this.ni++] = b + i + 1; }
    this.nv += n;
  }
  circle(x: number, y: number, r: number, k: Ink, seg = 0) {
    if (!seg) seg = r < 0.12 ? 8 : r < 0.5 ? 14 : r < 2 ? 22 : 36;
    this.room(seg, (seg - 2) * 3); const f = this.f32, u = this.u32; let o = this.nv * 3; const b = this.nv;
    for (let i = 0; i < seg; i++) { const a = (i / seg) * TAU; f[o] = x + Math.cos(a) * r; f[o + 1] = y + Math.sin(a) * r; u[o + 2] = k; o += 3; }
    const ix = this.idx; for (let i = 1; i < seg - 1; i++) { ix[this.ni++] = b; ix[this.ni++] = b + i; ix[this.ni++] = b + i + 1; }
    this.nv += seg;
  }
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, k: Ink, seg = 16) {
    this.room(seg, (seg - 2) * 3); const f = this.f32, u = this.u32; let o = this.nv * 3; const b = this.nv; const c = Math.cos(rot), s = Math.sin(rot);
    for (let i = 0; i < seg; i++) { const a = (i / seg) * TAU; const lx = Math.cos(a) * rx, ly = Math.sin(a) * ry; f[o] = x + lx * c - ly * s; f[o + 1] = y + lx * s + ly * c; u[o + 2] = k; o += 3; }
    const ix = this.idx; for (let i = 1; i < seg - 1; i++) { ix[this.ni++] = b; ix[this.ni++] = b + i; ix[this.ni++] = b + i + 1; }
    this.nv += seg;
  }
  ring(x: number, y: number, r: number, w: number, k: Ink, seg = 0, a0 = 0, a1 = TAU) {
    if (!seg) seg = r < 0.5 ? 16 : r < 2 ? 28 : 44;
    const ri = Math.max(0, r - w * 0.5), ro = r + w * 0.5;
    this.room((seg + 1) * 2, seg * 6); const f = this.f32, u = this.u32; let o = this.nv * 3; const b = this.nv;
    for (let i = 0; i <= seg; i++) { const a = a0 + (i / seg) * (a1 - a0); const c = Math.cos(a), s = Math.sin(a); f[o] = x + c * ri; f[o + 1] = y + s * ri; u[o + 2] = k; f[o + 3] = x + c * ro; f[o + 4] = y + s * ro; u[o + 5] = k; o += 6; }
    const ix = this.idx; for (let i = 0; i < seg; i++) { const q = b + i * 2; ix[this.ni++] = q; ix[this.ni++] = q + 1; ix[this.ni++] = q + 3; ix[this.ni++] = q; ix[this.ni++] = q + 3; ix[this.ni++] = q + 2; }
    this.nv += (seg + 1) * 2;
  }
  line(x0: number, y0: number, x1: number, y1: number, w: number, k: Ink) {
    let dx = x1 - x0, dy = y1 - y0; const l = Math.hypot(dx, dy); if (l < 1e-6) return; const nx = (-dy / l) * w * 0.5, ny = (dx / l) * w * 0.5;
    this.quad(x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny, k);
  }
  /** tapered line */
  taper(x0: number, y0: number, x1: number, y1: number, w0: number, w1: number, k: Ink) {
    let dx = x1 - x0, dy = y1 - y0; const l = Math.hypot(dx, dy); if (l < 1e-6) return; const nx = -dy / l, ny = dx / l;
    this.quad(x0 + nx * w0 * 0.5, y0 + ny * w0 * 0.5, x1 + nx * w1 * 0.5, y1 + ny * w1 * 0.5, x1 - nx * w1 * 0.5, y1 - ny * w1 * 0.5, x0 - nx * w0 * 0.5, y0 - ny * w0 * 0.5, k);
  }
  /** capsule (limb) between two points */
  capsule(x0: number, y0: number, x1: number, y1: number, r0: number, r1: number, k: Ink) {
    this.taper(x0, y0, x1, y1, r0 * 2, r1 * 2, k);
    this.circle(x0, y0, r0, k, 10); this.circle(x1, y1, r1, k, 10);
  }
  /** polyline strip with per-point width */
  strip(pts: ArrayLike<number>, n: number, w0: number, w1: number, k: Ink) {
    for (let i = 0; i < n - 1; i++) {
      const t0 = i / (n - 1), t1 = (i + 1) / (n - 1);
      this.taper(pts[i * 2], pts[i * 2 + 1], pts[i * 2 + 2], pts[i * 2 + 3], w0 + (w1 - w0) * t0, w0 + (w1 - w0) * t1, k);
    }
  }
}
