// Procedural 64×64 tileable textures per material (by MatDef.tex kind) and per background-wall type.
// Output: TEX[matId] = Uint32Array(4096) packed 0xAABBGGRR (little-endian ImageData order), sampled at (x & 63, y & 63) in WORLD cells
// so textures are world-locked. 'fire' / 'liquid' / 'gas' textures are intensity maps the renderer animates.
import { MATS, MatDef } from '../content/materials';

export const TS64 = 64;
export const TEX: Uint32Array[] = [];
export const BGTEX: Uint32Array[] = [];   // index = bg id (0 unused)

const pack = (r: number, g: number, b: number) => (255 << 24) | ((b < 0 ? 0 : b > 255 ? 255 : b | 0) << 16) | ((g < 0 ? 0 : g > 255 ? 255 : g | 0) << 8) | (r < 0 ? 0 : r > 255 ? 255 : r | 0);

function h2(x: number, y: number, s: number) {
  let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** wrapped value noise: `f` lattice cells across the tile; fx/fy allow anisotropic stretch (lattice cells across in x / y). */
function vn(px: number, py: number, fx: number, fy: number, s: number) {
  const u = (px * fx) / 64, v = (py * fy) / 64;
  const ix = Math.floor(u), iy = Math.floor(v), tx = u - ix, ty = v - iy;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const x0 = ((ix % fx) + fx) % fx, x1 = (x0 + 1) % fx, y0 = ((iy % fy) + fy) % fy, y1 = (y0 + 1) % fy;
  const a = h2(x0, y0, s), b = h2(x1, y0, s), c = h2(x0, y1, s), d = h2(x1, y1, s);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}
const fbm = (x: number, y: number, f: number, s: number) => (vn(x, y, f, f, s) * 0.55 + vn(x, y, f * 2, f * 2, s + 7) * 0.3 + vn(x, y, f * 4, f * 4, s + 13) * 0.15);

/** Voronoi on a wrapped grid: returns [distance to nearest, distance gap to second nearest, cell id hash]. */
const vor: [number, number, number] = [0, 0, 0];
function voronoi(px: number, py: number, n: number, s: number) {
  const cs = 64 / n, gx = Math.floor(px / cs), gy = Math.floor(py / cs);
  let d1 = 1e9, d2 = 1e9, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = gx + i, cy = gy + j;
    const wx = ((cx % n) + n) % n, wy = ((cy % n) + n) % n;
    const fx = (cx + h2(wx, wy, s)) * cs, fy = (cy + h2(wx, wy, s + 5)) * cs;
    const d = Math.hypot(px - fx, py - fy);
    if (d < d1) { d2 = d1; d1 = d; id = h2(wx, wy, s + 11); } else if (d < d2) d2 = d;
  }
  vor[0] = d1; vor[1] = d2 - d1; vor[2] = id;
}

function gen(d: MatDef, seed: number): Uint32Array {
  const out = new Uint32Array(4096);
  const [cr, cg, cb] = d.color, v = d.vary;
  const sp = d.speck;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    let r = cr, g = cg, b = cb;
    const fine = h2(x, y, seed);
    switch (d.tex) {
      case 'flat': break;
      case 'noise': {
        if (d.key === 'NEEDLES') {
          // short diagonal needle strokes
          const n = fbm(x, y, 8, seed), st = h2((x + (y >> 1)) >> 1, y >> 1, seed + 3);
          let l = 0.75 + n * 0.5;
          if (st > 0.82) l += 0.38; else if (st < 0.22) l -= 0.3;
          if (h2(x, y, seed + 9) > 0.96) l += 0.5;
          r = cr * l * 0.92; g = cg * l * 1.05; b = cb * l * 0.95;
        } else if (d.key === 'DIRT') {
          const n = fbm(x, y, 8, seed), clod = vn(x, y, 16, 16, seed + 2);
          let l = 0.82 + n * 0.34 + (clod - 0.5) * 0.22;
          if (fine > 0.93) l *= 1.28; else if (fine < 0.06) l *= 0.62;
          r = cr * l * 1.04; g = cg * l; b = cb * l * 0.92;
        } else {
          const l = 1 + (fbm(x, y, 8, seed) - 0.5) * v * 3 + (fine - 0.5) * v;
          r *= l; g *= l; b *= l;
        }
        break;
      }
      case 'snow': {
        const n = vn(x, y, 4, 4, seed), m = vn(x, y, 8, 8, seed + 1), wv = Math.sin((y + n * 9) * 0.45) * 0.012;
        const l = 0.955 + n * 0.04 + m * 0.03 + wv + (fine - 0.5) * 0.02;
        r = cr * l * 0.985; g = cg * l; b = cb * (0.7 + 0.3 * l) + (1 - l) * 40;
        if (d.hard > 0.2) { const ly = Math.sin(y * 0.8 + n * 6) * 0.018; r += cr * ly; g += cg * ly; b += cb * ly; }
        if (fine > 0.988) { r = 255; g = 255; b = 255; }
        break;
      }
      case 'grain': {
        // vertical wood grain with bark fissures
        const s1 = vn(x, y, 32, 3, seed), s2 = vn(x, y, 16, 6, seed + 4);
        let l = 0.7 + s1 * 0.38 + s2 * 0.22;
        if (h2(x, 0, seed + 9) > 0.86) l *= 0.62;            // fissure column
        if (fine > 0.97) l *= 0.8;
        r *= l; g *= l; b *= l;
        break;
      }
      case 'brick': {
        const bh = 8, bw = 16, row = Math.floor(y / bh), off = (row & 1) * (bw / 2);
        const bx = (x + off) % 64, col = Math.floor(bx / bw), lx = bx % bw, ly = y % bh;
        const tint = (h2(col, row, seed) - 0.5) * (v * 3 + 0.04);
        let l = 1 + tint + (fine - 0.5) * 0.04;
        if (ly === 0) l += 0.06; else if (ly === bh - 1) l -= 0.1;
        if (lx === 0) l += 0.03; else if (lx === bw - 1) l -= 0.07;
        if (ly === bh - 1 || lx === bw - 1) { r *= 0.9; g *= 0.92; b *= 1.0; }
        r *= l; g *= l; b *= l * (1 + (ly === bh - 1 ? 0.03 : 0));
        break;
      }
      case 'speckle': {
        const n = fbm(x, y, 8, seed);
        let l = 1 + (n - 0.5) * v * 2.4 + (fine - 0.5) * v * 0.8;
        r *= l; g *= l; b *= l;
        if (sp) {
          const lumB = (cr + cg + cb) / 3, lumS = (sp[0] + sp[1] + sp[2]) / 3;
          const dens = 0.045 + 0.09 * Math.min(1, Math.abs(lumS - lumB) / 130);
          // 2×2 clusters
          const hx = x >> 1, hy = y >> 1;
          const hc = h2(hx, hy, seed + 21);
          if (hc < dens) {
            const k = h2(x, y, seed + 22);
            if (k > 0.2) {
              const ll = 0.85 + h2(hx, hy, seed + 23) * 0.4;
              r = sp[0] * ll; g = sp[1] * ll; b = sp[2] * ll;
              if (lumS > lumB && (x & 1) === 0 && (y & 1) === 0) { r += 40; g += 40; b += 40; }   // glint
            }
          }
        }
        break;
      }
      case 'crystal': {
        voronoi(x, y, 6, seed);
        const [d1, gap, id] = vor;
        let l = 0.86 + id * 0.26;
        if (gap < 1.3) l += 0.2; else if (gap < 2.2) l -= 0.05;
        const diag = (x + y * 2 + Math.floor(id * 40)) % 29;
        if (diag < 2) l += 0.16;
        l += (fine - 0.5) * 0.04;
        r = cr * l * (0.95 + id * 0.1); g = cg * l; b = Math.min(255, cb * l * 1.03);
        if (gap < 1.3) { r += 24; g += 24; b += 20; }
        void d1;
        break;
      }
      case 'strata': {
        const yy = y + Math.sin(x * 0.1 + seed) * 2.5 + vn(x, y, 4, 4, seed) * 7;
        const band = Math.floor(yy / 6.5), bl = 0.9 + h2(band & 15, 0, seed) * 0.2;
        let l = bl + (fbm(x, y, 8, seed + 3) - 0.5) * v * 2 + (fine - 0.5) * v * 0.7;
        const crack = Math.abs(vn(x + (y >> 2), y, 16, 5, seed + 5) - 0.5), crack2 = Math.abs(vn(x, y, 6, 22, seed + 9) - 0.5);
        if (crack < 0.012 || crack2 < 0.01) l *= 0.72;
        r *= l * 0.98; g *= l; b *= l * 1.03;
        break;
      }
      case 'liquid': {
        const n = vn(x, y, 8, 16, seed), m = vn(x, y, 16, 8, seed + 3);
        const l = 0.82 + n * 0.22 + m * 0.2 + Math.sin((y + n * 6) * 0.9) * 0.04;
        r *= l; g *= l; b *= l;
        break;
      }
      case 'gas': {
        const n = fbm(x, y, 8, seed), l = 0.55 + n * 0.8;
        r *= l; g *= l; b *= l;
        break;
      }
      case 'fire': {
        // intensity map (renderer palette-maps it)
        const n = fbm(x, y, 8, seed) * 0.75 + vn(x, y, 16, 16, seed + 1) * 0.25;
        const k = Math.max(0, Math.min(1, (n - 0.2) * 1.6)) * 255;
        r = g = b = k;
        break;
      }
      case 'metal': {
        const pw = 16, px = x % pw, py = y % pw, pid = h2(x >> 4, y >> 4, seed);
        let l = 0.9 + pid * 0.14 + (vn(x, y, 2, 32, seed) - 0.5) * 0.12 + (fine - 0.5) * 0.04;
        if (px === 0 || py === 0) l *= 0.62; else if (px === 1 || py === 1) l *= 1.1;
        if ((px === 3 || px === 12) && (py === 3 || py === 12)) l = 1.28;
        r = cr * l; g = cg * l; b = cb * l * 1.03;
        const rust = vn(x, y, 8, 8, seed + 9);
        if (rust > 0.7) { const k = (rust - 0.7) * 3; r += k * 70; g -= k * 14; b -= k * 40; }
        break;
      }
      case 'plank': {
        const ph = 6, row = Math.floor(y / ph), ly = y % ph, seam = (row * 13 + 5) % 32;
        const lx = (x - seam + 64) % 32;
        let l = 0.95 + (h2(row, Math.floor((x - seam + 64) / 32), seed) - 0.5) * 0.18;
        l += (vn(x, y, 3, 32, seed + row) - 0.5) * 0.12;
        if (ly === 0) l *= 1.1; else if (ly === ph - 1) l *= 0.72;
        if (lx === 0) l *= 0.66;
        if (ly === 2 && (lx === 3 || lx === 29)) l *= 0.55;     // nails
        r *= l; g *= l; b *= l;
        break;
      }
      case 'log': {
        const lh = 8, ly = y % lh, row = Math.floor(y / lh);
        const prof = [0.74, 0.92, 1.04, 1.1, 1.08, 1.0, 0.86, 0.66][ly];
        let l = prof * (0.94 + h2(row, 0, seed) * 0.12) + (vn(x, y, 4, 40, seed + row) - 0.5) * 0.14;
        if (h2(x >> 2, row, seed + 3) > 0.96 && ly > 1 && ly < 6) l *= 0.7;  // knot
        r *= l; g *= l; b *= l;
        break;
      }
    }
    out[y * 64 + x] = pack(r, g, b);
  }
  return out;
}

/** Background-wall textures (darkened, slightly cool). */
function genBg(kind: number): Uint32Array {
  const out = new Uint32Array(4096);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const fine = h2(x, y, 90 + kind), n = fbm(x, y, 8, 40 + kind);
    let r = 0, g = 0, b = 0;
    if (kind === 1) { // frozen dirt
      let l = 0.7 + n * 0.5 + (fine - 0.5) * 0.1; if (fine > 0.95) l *= 1.25;
      r = 62 * l; g = 50 * l; b = 46 * l;
    } else if (kind === 2) { // stone
      const yy = y + Math.sin(x * 0.12) * 2 + vn(x, y, 4, 4, 33) * 6;
      let l = 0.78 + n * 0.38 + (h2(Math.floor(yy / 7), 0, 7) - 0.5) * 0.14 + (fine - 0.5) * 0.06;
      if (Math.abs(vn(x + (y >> 2), y, 16, 5, 35) - 0.5) < 0.011 || Math.abs(vn(x, y, 6, 22, 36) - 0.5) < 0.009) l *= 0.72;
      r = 64 * l; g = 72 * l; b = 90 * l;
    } else if (kind === 3) { // packed snow / ice wall: pale blue with layer lines
      let l = 0.85 + n * 0.3 + Math.sin((y + n * 8) * 0.6) * 0.04 + (fine - 0.5) * 0.04;
      r = 108 * l; g = 134 * l; b = 168 * l;
    } else if (kind === 4) { // deep rock
      let l = 0.7 + n * 0.5 + (fine - 0.5) * 0.12;
      if (fine > 0.96) l *= 1.3;
      r = 50 * l; g = 46 * l; b = 62 * l;
    } else { // 5: wooden interior wall, vertical boards
      const bw = 8, col = Math.floor(x / bw), lx = x % bw;
      let l = 0.92 + (h2(col, 0, 61) - 0.5) * 0.2 + (vn(x, y, 32, 3, 62) - 0.5) * 0.14;
      if (lx === 0) l *= 0.62; else if (lx === 1) l *= 1.08;
      if (y % 32 === 6 && (lx === 3)) l *= 0.6;
      r = 120 * l; g = 84 * l; b = 56 * l;
    }
    out[y * 64 + x] = pack(r, g, b);
  }
  return out;
}

let done = false;
export function initTextures() {
  if (done) return; done = true;
  for (let i = 0; i < MATS.length; i++) TEX.push(gen(MATS[i], 100 + i * 17));
  BGTEX.push(new Uint32Array(4096));
  for (let k = 1; k <= 5; k++) BGTEX.push(genBg(k));
}
