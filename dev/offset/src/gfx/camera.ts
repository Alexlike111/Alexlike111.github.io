import { damp, clamp } from '../core/math';
import { vrng } from '../core/rng';
export class Camera {
  x = 0; y = 0; tx = 0; ty = 0;
  zoom = 1; tzoom = 1;
  ppm = 40;           // device px per metre (after zoom)
  viewW = 20; viewH = 12; // metres visible
  trauma = 0; shx = 0; shy = 0;
  bx0 = -1e9; by0 = -1e9; bx1 = 1e9; by1 = 1e9;
  w = 1; h = 1; dpr = 1;
  /** metres that must fit on the short axis / long axis */
  fitH = 12; fitW = 11.5;
  resize(w: number, h: number, dpr: number) { this.w = w; this.h = h; this.dpr = dpr; }
  bounds(x0: number, y0: number, x1: number, y1: number) { this.bx0 = x0; this.by0 = y0; this.bx1 = x1; this.by1 = y1; }
  snap(x: number, y: number) { this.tx = this.x = x; this.ty = this.y = y; this.clampPos(); }
  private base() { // px per metre before zoom
    const land = this.w >= this.h;
    return land ? Math.min(this.h / this.fitH, this.w / 17) : Math.min(this.w / this.fitW, this.h / 17);
  }
  private clampPos() {
    const hw = this.viewW * 0.5, hh = this.viewH * 0.5;
    if (this.bx1 - this.bx0 > this.viewW) this.x = clamp(this.x, this.bx0 + hw, this.bx1 - hw); else this.x = (this.bx0 + this.bx1) * 0.5;
    if (this.by1 - this.by0 > this.viewH) this.y = clamp(this.y, this.by0 + hh, this.by1 - hh); else this.y = this.by1 - hh;
  }
  update(dt: number, rate = 7) {
    this.zoom += (this.tzoom - this.zoom) * damp(6, dt);
    this.ppm = this.base() * this.zoom;
    this.viewW = this.w / this.ppm; this.viewH = this.h / this.ppm;
    const k = damp(rate, dt);
    this.x += (this.tx - this.x) * k; this.y += (this.ty - this.y) * k;
    this.clampPos();
    this.trauma = Math.max(0, this.trauma - dt * 1.9);
    const s = this.trauma * this.trauma;
    this.shx = vrng.range(-1, 1) * s * 0.42; this.shy = vrng.range(-1, 1) * s * 0.42;
  }
  shake(a: number) { this.trauma = Math.min(1, this.trauma + a); }
  get cx() { return this.x + this.shx; } get cy() { return this.y + this.shy; }
  /** world → device px */
  sx(wx: number) { return (wx - this.cx) * this.ppm + this.w * 0.5; }
  sy(wy: number) { return (wy - this.cy) * this.ppm + this.h * 0.5; }
  /** css px → world */
  wx(cssX: number) { return (cssX * this.dpr - this.w * 0.5) / this.ppm + this.cx; }
  wy(cssY: number) { return (cssY * this.dpr - this.h * 0.5) / this.ppm + this.cy; }
  get x0() { return this.cx - this.viewW * 0.5; } get x1() { return this.cx + this.viewW * 0.5; }
  get y0() { return this.cy - this.viewH * 0.5; } get y1() { return this.cy + this.viewH * 0.5; }
}
